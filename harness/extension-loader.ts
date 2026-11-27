import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type {
  HarnessResolvedProfile,
  ProfileCapabilitySpec,
  CapabilitySeverityKeyword,
  ExtensionBinding,
  ExtensionBindingTiming,
  ExtensionBundle,
  ExtensionPlugin,
  ExtensionValidationError,
  ExtensionMcpAction,
} from './scripts/utils/types';
import { normalizeCapabilityKey, normalizeCapabilitiesMap } from './scripts/utils/capability-alias';
import { ordinaryFile, ordinaryPath } from './scripts/utils/extension-files';
import { normalizePhaseId } from './scripts/utils/phase-alias';
import { isInsideProjectRoot, realProjectPath, validateProjectRelativePath } from './scripts/utils/project-relative-path';
import { loadFrameworkConfig } from './config';
import { listWorkflowPhases, resolveWorkflowSpec } from './workflow-loader';
import { workflowFeaturePhases } from './scripts/utils/runtime-policy';
import { isExtensionActivationOutput, parseExtensionActivation } from './scripts/utils/extension-activation-contract';

export type { ExtensionBundle } from './scripts/utils/types';

const SEVERITY_SET = new Set<CapabilitySeverityKeyword>(['BLOCKER', 'SKIP', 'WARN', 'MAJOR', 'MINOR']);
const ACTION_SEVERITY_SET = new Set(['MAJOR', 'BLOCKER']);
const SAFE_ID = /^[a-z][a-z0-9_-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SKILL = /^[a-zA-Z0-9_-]+$/;
const FRAMEWORK_ROOT = path.resolve(__dirname, '..');

type TimingResource = NonNullable<ExtensionBinding['resource']>;
export interface ExtensionTiming {
  id: string;
  scope: 'project' | 'feature' | 'harness';
  description: string;
  resources: TimingResource[];
  consumer?: string;
  consumers?: Partial<Record<TimingResource, string>>;
  event?: string;
}

export function readExtensionTimings(frameworkRoot = FRAMEWORK_ROOT): Map<string, ExtensionTiming> {
  const file = path.join(frameworkRoot, 'specs', 'lifecycle-hooks-schema.yaml');
  const schema = YAML.parse(fs.readFileSync(file, 'utf8')) as {
    schema_version?: string;
    hook_events: Array<{ id: string; version: number; description: string }>;
    hook_contributions: Pick<ExtensionTiming, 'scope' | 'resources' | 'consumers'>;
    contribution_timings: ExtensionTiming[];
  };
  const invalid = () => new Error(`无法读取时点协议 ${file}（需要完整的 lifecycle-hooks schema_version 1.0）`);
  if (schema?.schema_version !== '1.0' || !Array.isArray(schema.hook_events)
    || !Array.isArray(schema.contribution_timings) || schema.hook_contributions?.scope !== 'harness') throw invalid();
  const resourceTypes = new Set<TimingResource>(['hook_markdown', 'hook_script', 'knowledge_file', 'skill', 'mcp']);
  const timings = new Map<string, ExtensionTiming>();
  const register = (timing: ExtensionTiming) => {
    if (!timing || typeof timing.id !== 'string' || !/^[a-z][a-z0-9_.-]*@[1-9]\d*$/.test(timing.id)
      || timings.has(timing.id) || typeof timing.description !== 'string' || !timing.description.trim()
      || !['project', 'feature', 'harness'].includes(timing.scope) || !Array.isArray(timing.resources)
      || !timing.resources.length || timing.resources.some(resource => !resourceTypes.has(resource)
        || (timing.event ? typeof timing.consumers?.[resource] !== 'string' : typeof timing.consumer !== 'string'))) throw invalid();
    timings.set(timing.id, timing);
  };
  for (const hook of schema.hook_events) {
    if (!hook || typeof hook.id !== 'string' || !SAFE_ID.test(hook.id) || !Number.isInteger(hook.version) || hook.version < 1) throw invalid();
    const id = `harness.${hook.id}@${hook.version}`;
    register({ ...schema.hook_contributions, id, event: hook.id, description: hook.description });
  }
  for (const timing of schema.contribution_timings) register(timing);
  return timings;
}


type LoadOptions = {
  frameworkRoot?: string;
  manifestRaw?: unknown;
  excludedPlugins?: ReadonlyMap<string, string>;
};

const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const own = <T>(record: Record<string, T>, key: string): T | undefined => has(record, key) ? record[key] : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unknownKeys = (value: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(value).filter(key => !allowed.includes(key));
const optionalString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

function emptyBundle(rootDir: string | null): ExtensionBundle {
  return {
    rootDir,
    manifestPath: null,
    manifestVersion: null,
    manifestUsable: true,
    bindings: [],
    activations: dict(),
    plugins: dict(),
    featurePhases: [],
    manualSkills: [],
    extensionCapabilities: dict(),
    phaseRuleOverlayPaths: dict(),
    skillAssetAbsPaths: dict(),
    errors: [],
  };
}

function diagnostic(code: string, message: string, file?: string): ExtensionValidationError {
  return { severity: 'MAJOR', code, message, path: file };
}

function safeResolve(root: string, relative: string): string {
  return realProjectPath(root, relative.trim(), 'extension 引用');
}

function existingFile(root: string, relative: string): string {
  const abs = safeResolve(root, relative);
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new Error(`引用文件不可用：${relative}`);
  return abs;
}

function bindingTiming(raw: unknown): ExtensionBindingTiming | undefined {
  if (!isRecord(raw) || unknownKeys(raw, ['at', 'phase']).length) return undefined;
  const at = optionalString(raw.at);
  const phase = optionalString(raw.phase);
  if (!at || raw.phase !== undefined && !phase) return undefined;
  return phase ? { at, phase } : { at };
}

export function validateExtensionManifestRoot(
  raw: unknown, manifestPath?: string, expectedKind: 'host' | 'plugin' = 'host',
): ExtensionValidationError[] {
  const fail = (code: string, message: string) => [diagnostic(code, message, manifestPath)];
  if (!isRecord(raw)) return fail('manifest_not_object', 'manifest 根必须是 object');
  if (raw.kind === undefined && raw.plugins === undefined && ['1.0', '1.1', '2.0', '2.1'].includes(String(raw.schema_version))
    && ['name', 'provides', 'installations', 'phase_bindings'].some(field => has(raw, field))) {
    return fail('manifest_legacy_layout', '旧版扩展未加载，请按需手工整理后重新接入。');
  }
  if (raw.schema_version !== '2.0') return fail('manifest_schema_version', 'schema_version 必须为字符串 "2.0"');
  if (raw.kind !== expectedKind) return fail('manifest_kind', `这里必须使用 kind: ${expectedKind} 的清单`);

  const fields = expectedKind === 'host' ? ['schema_version', 'kind', 'plugins']
    : ['schema_version', 'kind', 'name', 'version', 'description', 'framework_compat', 'provides', 'bindings', 'activation'];
  const extra = unknownKeys(raw, fields);
  if (extra.length) return fail('manifest_unknown_field', `manifest 不支持字段：${extra.join(', ')}`);
  if (expectedKind === 'host') return isRecord(raw.plugins) ? [] : fail('plugins_shape', 'plugins 必须是插件 ID 映射');
  if (typeof raw.name !== 'string' || !SAFE_ID.test(raw.name)) return fail('manifest_name', '插件 name 必须是小写 slug');
  if (!optionalString(raw.version)) return fail('manifest_version', '插件 version 必须是非空字符串');
  for (const name of ['description', 'framework_compat']) {
    if (raw[name] !== undefined && !optionalString(raw[name])) return fail('manifest_field', `${name} 必须是非空字符串`);
  }
  for (const name of ['provides', 'bindings', 'activation']) {
    if (raw[name] !== undefined && !isRecord(raw[name])) return fail(`${name}_shape`, `${name} 必须是 object`);
  }
  return [];
}

function readManifest(bundle: ExtensionBundle, root: string, kind: 'host' | 'plugin', options?: LoadOptions, id?: string) {
  const manifestPath = path.join(root, 'manifest.yaml');
  let raw: unknown;
  try {
    raw = options && has(options, 'manifestRaw')
      ? options.manifestRaw : YAML.parse(fs.readFileSync(ordinaryFile(root, 'manifest.yaml'), 'utf8'));
  } catch (error) {
    bundle.errors.push({ ...diagnostic('manifest_yaml_parse', `无法读取清单：${(error as Error).message}`, manifestPath), ability: id });
    return undefined;
  }
  const errors = validateExtensionManifestRoot(raw, manifestPath, kind);
  bundle.errors.push(...errors.map(error => ({ ...error, ability: id })));
  return errors.length ? undefined : raw as Record<string, unknown>;
}

type Registration = Pick<ExtensionPlugin, 'source' | 'enabled' | 'bindings' | 'files' | 'binding_overrides' | 'in_place'>;

function registration(raw: unknown, pluginRoot: string): Registration {
  if (!isRecord(raw) || unknownKeys(raw, ['source', 'enabled', 'bindings', 'binding_overrides', 'files', 'in_place']).length
    || !optionalString(raw.source) || typeof raw.enabled !== 'boolean' || !isRecord(raw.bindings) || !isRecord(raw.files)
    || raw.binding_overrides !== undefined && !isRecord(raw.binding_overrides) || raw.in_place !== undefined && raw.in_place !== true
    || Object.entries(raw.bindings).some(([id, enabled]) => !SAFE_ID.test(id) || typeof enabled !== 'boolean')) {
    throw new Error('登记须包含 source、enabled、bindings 和 files，绑定选择须为 boolean');
  }
  for (const [file, hash] of Object.entries(raw.files)) {
    if (typeof hash !== 'string' || !SHA256.test(hash) || path.posix.normalize(file) !== file
      || file === '.' || file.startsWith('./') || file.includes('\\') || file.endsWith('/')
      || validateProjectRelativePath(pluginRoot, file, 'plugins.files') !== file) {
      throw new Error(`无效的包内文件归属：${file}`);
    }
  }
  return raw as unknown as Registration;
}

export function loadInstanceExtensions(projectRoot: string, extensionDirRel?: string, options?: LoadOptions): ExtensionBundle {
  let root: string;
  try {
    const project = fs.realpathSync(projectRoot);
    root = ordinaryPath(project, extensionDirRel ?? loadFrameworkConfig(projectRoot).paths.extension_dir ?? 'doc/extensions', 'paths.extension_dir');
    const framework = path.resolve(options?.frameworkRoot ?? FRAMEWORK_ROOT);
    if (project !== framework && isInsideProjectRoot(framework, root)) throw new Error('paths.extension_dir 必须指向宿主内的独立扩展目录');
    const stat = fs.statSync(root, { throwIfNoEntry: false });
    if (!stat && !(options && has(options, 'manifestRaw'))) return emptyBundle(null);
    if (stat && !stat.isDirectory()) throw new Error('paths.extension_dir 必须指向目录');
  } catch (error) {
    const bundle = emptyBundle(null);
    bundle.manifestUsable = false;
    bundle.errors.push(diagnostic('extension_dir_path', (error as Error).message));
    return bundle;
  }

  const bundle = emptyBundle(root);
  const manifestPath = path.join(root, 'manifest.yaml');
  if (!(options && has(options, 'manifestRaw')) && !fs.lstatSync(manifestPath, { throwIfNoEntry: false })) return bundle;
  bundle.manifestPath = manifestPath;
  const manifest = readManifest(bundle, root, 'host', options);
  if (!manifest) {
    bundle.manifestUsable = false;
    return bundle;
  }
  bundle.manifestVersion = '2.0';
  const plugins = Object.entries(manifest.plugins as Record<string, unknown>);
  if (!plugins.length) return bundle;
  const context = loadContext(projectRoot, options, bundle);
  for (const [id, selection] of plugins) {
    try {
      if (!SAFE_ID.test(id)) throw new Error('插件 ID 须为小写 slug');
      const pluginRoot = path.join(root, id);
      const selected = registration(selection, pluginRoot);
      if (!fs.lstatSync(pluginRoot, { throwIfNoEntry: false })?.isDirectory()) throw new Error('已登记插件缺少独立目录');
      const raw = readManifest(bundle, pluginRoot, 'plugin', undefined, id);
      if (raw) readPlugin(bundle, context, pluginRoot, id, raw, selected, options?.excludedPlugins?.get(id));
    } catch (error) {
      bundle.errors.push({ ...diagnostic('plugin_registration', `${id}：${(error as Error).message}`, manifestPath), ability: id });
    }
  }
  return bundle;
}

/** 读取可安装的提供方包，绑定使用提供方默认值。 */
export function loadInstanceExtensionSource(sourceRoot: string, projectRoot: string, options?: LoadOptions): ExtensionBundle {
  const root = path.resolve(sourceRoot);
  const bundle = emptyBundle(root);
  bundle.manifestPath = path.join(root, 'manifest.yaml');
  const raw = readManifest(bundle, root, 'plugin', options);
  if (!raw) {
    bundle.manifestUsable = false;
    return bundle;
  }
  bundle.manifestVersion = '2.0';
  const id = raw.name as string;
  readPlugin(bundle, loadContext(projectRoot, options, bundle, true), root, id, raw,
    { source: id, enabled: true, bindings: {}, files: {} }, undefined, true);
  return bundle;
}

function loadContext(projectRoot: string, options: LoadOptions | undefined, bundle: ExtensionBundle, sourceOnly = false) {
  const frameworkRoot = options?.frameworkRoot ?? FRAMEWORK_ROOT;
  let harnessPhases = new Set<string>();
  let timings = new Map<string, ExtensionTiming>();
  try {
    const workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot });
    bundle.featurePhases = workflowFeaturePhases(workflow, 'full');
    harnessPhases = new Set(listWorkflowPhases(workflow));
  } catch (error) {
    bundle.errors.push(diagnostic('manifest_workflow_unresolvable', (error as Error).message, bundle.manifestPath ?? undefined));
  }
  try {
    timings = readExtensionTimings(frameworkRoot);
  } catch (error) {
    bundle.errors.push(diagnostic('extension_timings_unavailable', (error as Error).message, bundle.manifestPath ?? undefined));
  }
  return { projectRoot, harnessPhases, timings, hooksEnabled: sourceOnly || loadFrameworkConfig(projectRoot).lifecycle_hooks_enabled !== false };
}

function bindingResource(timing: ExtensionTiming | undefined, binding: ExtensionBinding, actions: unknown): TimingResource | undefined {
  if (timing?.event) {
    const ext = path.extname(binding.ref).toLowerCase();
    if (binding.kind === 'knowledge' && ext === '.md') return 'hook_markdown';
    if (binding.kind === 'action' && ext === '.mjs') return 'hook_script';
    return undefined;
  }
  if (binding.kind === 'knowledge') return 'knowledge_file';
  if (binding.kind !== 'action') return undefined;
  if (isRecord(actions) && has(actions, binding.ref)
    || timing?.resources.includes('mcp') && !timing.resources.includes('skill')) return 'mcp';
  return 'skill';
}

function readPlugin(
  bundle: ExtensionBundle, context: ReturnType<typeof loadContext>, rootDir: string, id: string, raw: Record<string, unknown>,
  selection: Registration, unavailable?: string, sourceOnly = false,
): void {
  const manifestPath = path.join(rootDir, 'manifest.yaml');
  const error = (code: string, message: string, binding?: ExtensionBinding) => {
    bundle.errors.push({ ...diagnostic(code, `${id}：${message}`, manifestPath), source: selection.source,
      ability: id, ...(binding ? { bindingId: binding.id, at: binding.at } : {}) });
  };
  if (raw.name !== id) {
    error('plugin_identity', `目录和已登记 ID 必须与提供方 name ${String(raw.name)} 一致`);
    return;
  }
  const plugin: ExtensionPlugin = {
    ...selection, id, rootDir, manifestPath, version: raw.version as string, skills: [],
    mcpActions: dict(), capabilities: dict(), phaseRuleOverlayPaths: dict(), skillAssetAbsPaths: dict(),
  };
  bundle.plugins[id] = plugin;

  const provides = (raw.provides ?? {}) as Record<string, unknown>;
  const extra = unknownKeys(provides, ['skills', 'mcp_actions', 'capabilities', 'phase_rules_overlays', 'skill_assets']);
  if (extra.length) error('provides_unknown_field', `provides 不支持字段：${extra.join(', ')}`);
  if (raw.activation !== undefined) {
    try {
      bundle.activations[id] = parseExtensionActivation(id, raw.activation);
    } catch (err) {
      unavailable = (err as Error).message;
      error('activation_steps', unavailable);
    }
  }
  const steps = bundle.activations[id] ?? [];
  const relativeRef = (absolute: string) => path.relative(rootDir, absolute).replace(/\\/g, '/');
  const localSteps = steps.filter(step => step.scope === 'local');
  const generated = (relative: string) => isExtensionActivationOutput(steps, relativeRef(safeResolve(rootDir, relative)));
  if (!selection.enabled) unavailable = '插件已停用';
  if (unavailable && selection.enabled) error('plugin_unavailable', unavailable);

  if (provides.skills !== undefined) {
    if (!Array.isArray(provides.skills)) error('provides_skills', 'provides.skills 必须是字符串数组');
    else for (const skillId of new Set(provides.skills)) {
      try {
        if (typeof skillId !== 'string' || !SAFE_SKILL.test(skillId)) throw new Error(`非法 Skill ID：${String(skillId)}`);
        plugin.skills.push({ pluginId: id, skillId, absPath: existingFile(rootDir, `skills/${skillId}/SKILL.md`) });
      } catch (err) { error('skill_missing', (err as Error).message); }
    }
  }

  const readMap = (value: unknown, key: string, read: (key: string, entry: unknown) => void) => {
    if (value === undefined) return;
    if (!isRecord(value)) { error('provides_' + key, `${key} 必须是 object`); return; }
    for (const [name, entry] of Object.entries(value)) {
      try { read(name, entry); } catch (err) { error(key + '_entry', `${name}：${(err as Error).message}`); }
    }
  };
  readMap(provides.mcp_actions, 'mcp_actions', (name, entry) => {
    if (!SAFE_ID.test(name) || !isRecord(entry) || unknownKeys(entry, ['tool', 'required', 'severity', 'produces', 'usage']).length) {
      throw new Error('MCP 动作声明格式非法');
    }
    const tool = optionalString(entry.tool);
    const usage = optionalString(entry.usage);
    const severity = entry.severity ?? 'MAJOR';
    if (!tool || !usage || typeof entry.required !== 'boolean' || !ACTION_SEVERITY_SET.has(String(severity))
      || !Array.isArray(entry.produces) || !entry.produces.length || !entry.produces.every(item => optionalString(item))) {
      throw new Error('须包含 tool、usage、required、produces，severity 仅支持 MAJOR 或 BLOCKER');
    }
    const produces = (entry.produces as string[]).map(item => item.trim());
    plugin.mcpActions[name] = { id: name, tool, usage, required: entry.required, severity: severity as 'MAJOR' | 'BLOCKER',
      produces, produceAbsPaths: produces.map(item => realProjectPath(context.projectRoot, item, 'mcp_actions.produces')) };
  });

  const contributionPath = (relative: string): string => generated(relative) ? safeResolve(rootDir, relative) : existingFile(rootDir, relative);
  readMap(provides.capabilities, 'capabilities', (name, entry) => {
    if (!name.trim() || !isRecord(entry) || unknownKeys(entry, ['provider', 'severity']).length
      || typeof entry.provider !== 'string' || !SEVERITY_SET.has(entry.severity as CapabilitySeverityKeyword)) {
      throw new Error('能力须含有效 provider 和 severity');
    }
    plugin.capabilities[normalizeCapabilityKey(name)] = {
      provider: contributionPath(entry.provider), severity: entry.severity as CapabilitySeverityKeyword,
    };
  });
  readMap(provides.phase_rules_overlays, 'phase_rules_overlays', (phase, relative) => {
    const canonical = normalizePhaseId(phase, phase as 'spec');
    if (!context.harnessPhases.has(canonical) || typeof relative !== 'string') throw new Error('阶段或路径非法');
    plugin.phaseRuleOverlayPaths[canonical] = contributionPath(relative);
  });
  readMap(provides.skill_assets, 'skill_assets', (skillId, assets) => {
    if (!SAFE_SKILL.test(skillId) || !isRecord(assets)) throw new Error('Skill 资产须是名称到路径的映射');
    readMap(assets, 'skill_assets', (key, relative) => {
      if (!SAFE_SKILL.test(key) || typeof relative !== 'string' || skillId === 'component-design' && key === 'knowledge') {
        throw new Error('Skill 资产声明非法，设计知识使用 knowledge 绑定');
      }
      const file = safeResolve(rootDir, relative);
      if (!fs.existsSync(file) && !generated(relative)) throw new Error(`引用路径不可用：${relative}`);
      (plugin.skillAssetAbsPaths[skillId] ??= dict())[key] = file;
    });
  });

  const bindings = (raw.bindings ?? {}) as Record<string, unknown>;
  for (const [bindingId, value] of Object.entries(bindings)) {
    const data = isRecord(value) ? value : {};
    const at = optionalString(data.at) ?? '';
    const phase = optionalString(data.phase);
    const ref = optionalString(data.ref) ?? '';
    const kind = data.kind === 'knowledge' || data.kind === 'action' ? data.kind : undefined;
    const summary = optionalString(data.summary);
    const selected = selection.enabled && (sourceOnly ? data.enabled_by_default === true : own(selection.bindings, bindingId) === true);
    const binding: ExtensionBinding = { source: selection.source, ability: id, id: bindingId, at, phase, ref, kind, summary, rootDir, selected, enabled: false };
    const overrides = selection.binding_overrides;
    const override = overrides ? own(overrides, bindingId) : undefined;
    if (override !== undefined) {
      binding.override = bindingTiming(override);
      if (binding.override) {
        binding.at = binding.override.at;
        binding.phase = binding.override.phase;
      }
    }
    const timing = context.timings.get(binding.at);
    const resource = binding.resource = bindingResource(context.timings.get(at), binding, provides.mcp_actions);
    binding.hookEvent = timing?.event;
    binding.timingDescription = timing?.description;
    binding.consumer = timing?.event && resource ? timing.consumers?.[resource] : timing?.consumer;
    const action = resource === 'mcp' ? own(plugin.mcpActions, ref) : undefined;
    const declaredAction = resource === 'mcp' && isRecord(provides.mcp_actions) ? own(provides.mcp_actions, ref) : undefined;
    binding.action = action;
    if (data.required === true || isRecord(declaredAction) && declaredAction.required === true) {
      binding.required = true;
      binding.severity = isRecord(declaredAction) && declaredAction.severity === 'BLOCKER' ? 'BLOCKER' : 'MAJOR';
    }

    let code = 'extension_binding_invalid';
    try {
      if (!SAFE_ID.test(bindingId) || !at || !kind || !ref
        || unknownKeys(data, ['at', 'kind', 'ref', 'phase', 'enabled_by_default', 'required', 'summary']).length
        || data.phase !== undefined && !phase || data.summary !== undefined && (!summary || kind !== 'knowledge')
        || data.required !== undefined && typeof data.required !== 'boolean'
        || data.enabled_by_default !== undefined && typeof data.enabled_by_default !== 'boolean') {
        throw new Error('绑定须含合法 ID、at、kind、ref 和适用的 phase');
      }
      if (override !== undefined && !binding.override) throw new Error('宿主时点覆盖须含 at 和适用的 phase');
      if (!timing) {
        code = 'extension_binding_unknown_timing';
        throw new Error(`未知时点或版本：${binding.at}`);
      }
      const phases = timing.scope === 'feature' ? bundle.featurePhases : [...context.harnessPhases];
      if (timing.scope === 'project' ? binding.phase !== undefined : !binding.phase || !phases.includes(binding.phase)) {
        throw new Error(`时点 ${binding.at} 的 phase 不可用：${binding.phase ?? '未声明'}`);
      }
      if (!resource || !timing.resources.includes(resource)) throw new Error(`时点 ${binding.at} 不支持 ${kind}:${ref}`);
      if (resource === 'mcp') {
        if (!action) throw new Error(`缺少有效 provides.mcp_actions.${ref} 声明`);
      } else if (resource === 'skill') {
        binding.absPath = plugin.skills.find(item => item.skillId === ref)?.absPath;
        if (!binding.absPath) throw new Error(`缺少已声明的 Skill：${ref}`);
      } else {
        binding.absPath = safeResolve(rootDir, ref);
        const declaredOutput = relativeRef(binding.absPath);
        if (isExtensionActivationOutput(localSteps, declaredOutput)) binding.localOutput = true;
        if (binding.at === 'project.entry@1' && binding.localOutput) throw new Error('项目入口索引只能引用随仓知识');
        if (!fs.statSync(binding.absPath, { throwIfNoEntry: false })?.isFile()) {
          if (!isExtensionActivationOutput(steps, declaredOutput)) throw new Error(`引用文件不可用：${ref}`);
          binding.pendingGenerated = true;
        }
      }
    } catch (err) {
      binding.issue = (err as Error).message;
      error(override !== undefined ? 'installation_binding_override' : code, `${bindingId} (${binding.at})：${binding.issue}`, binding);
    }
    binding.reason = unavailable ?? binding.issue ?? (!selected ? '绑定未启用'
      : binding.hookEvent && !context.hooksEnabled ? 'lifecycle_hooks_enabled 已关闭'
      : binding.pendingGenerated ? '引用文件待准备步骤生成' : undefined);
    binding.enabled = !binding.reason;
    bundle.bindings.push(binding);
  }
  for (const bindingId of new Set([...Object.keys(selection.bindings), ...Object.keys(selection.binding_overrides ?? {})])) {
    if (!has(bindings, bindingId)) error('installation_binding_selection', `宿主选择找不到绑定 ${bindingId}`);
  }
  if (unavailable) return;

  for (const skill of plugin.skills) {
    const other = bundle.manualSkills.find(item => item.skillId === skill.skillId);
    if (other) error('plugin_skill_conflict', `Skill ${skill.skillId} 也由 ${other.pluginId} 提供，入口将按现有冲突规则分配`);
    bundle.manualSkills.push(skill);
  }
  for (const map of ['capabilities', 'phaseRuleOverlayPaths'] as const) {
    const output = map === 'capabilities' ? bundle.extensionCapabilities : bundle.phaseRuleOverlayPaths;
    for (const key of Object.keys(plugin[map])) {
      const previous = Object.values(bundle.plugins).find(other => other.id !== id && output[key] !== undefined
        && other[map][key] === output[key]);
      if (previous) error('plugin_contribution_conflict', `${map}.${key} 同时由 ${previous.id} 提供，当前使用 ${id}`);
    }
    if (map === 'capabilities') Object.assign(bundle.extensionCapabilities, plugin.capabilities);
    else Object.assign(bundle.phaseRuleOverlayPaths, plugin.phaseRuleOverlayPaths);
  }
  for (const [skillId, assets] of Object.entries(plugin.skillAssetAbsPaths)) {
    const existing = bundle.skillAssetAbsPaths[skillId] ??= dict();
    for (const [key, file] of Object.entries(assets)) {
      const previous = Object.values(bundle.plugins).find(other => other.id !== id && existing[key] !== undefined
        && other.skillAssetAbsPaths[skillId]?.[key] === existing[key]);
      if (previous) error('plugin_contribution_conflict', `skill_assets.${skillId}.${key} 同时由 ${previous.id} 提供，当前使用 ${id}`);
      existing[key] = file;
    }
  }
}

export function applyInstanceExtensions(
  resolved: HarnessResolvedProfile, projectRoot: string, extensionDirRel?: string, options?: LoadOptions,
): HarnessResolvedProfile {
  const bundle = loadInstanceExtensions(projectRoot, extensionDirRel, options);
  return {
    ...resolved,
    capabilities: normalizeCapabilitiesMap({ ...resolved.capabilities, ...bundle.extensionCapabilities }),
    extensionBundle: bundle,
  };
}
