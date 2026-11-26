// ============================================================================
// Instance extension loader — doc/extensions/manifest.yaml
// ============================================================================
//
// 无 manifest / 无目录 → 空 bundle（零副作用）。
// 根不可用时不加载任何贡献，条目错误仅隔离对应贡献。
//
// ============================================================================

import * as fs from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import * as YAML from 'yaml';
import type {
  HarnessResolvedProfile,
  ProfileCapabilitySpec,
  CapabilitySeverityKeyword,
  ExtensionBinding,
  ExtensionBundle,
  ExtensionValidationError,
  ExtensionKnowledgeEntry,
  ExtensionMcpAction,
  ExtensionPhaseBinding,
  ExtensionPhaseBindingSlot,
} from './scripts/utils/types';
import { normalizeCapabilityKey, normalizeCapabilitiesMap } from './scripts/utils/capability-alias';
import { normalizePhaseId } from './scripts/utils/phase-alias';
import { realProjectPath, validateProjectRelativePath } from './scripts/utils/project-relative-path';
import { loadFrameworkConfig } from './config';
import { listWorkflowPhases, resolveWorkflowSpec } from './workflow-loader';
import { workflowFeaturePhases } from './scripts/utils/runtime-policy';

export type { ExtensionBundle } from './scripts/utils/types';

const SEVERITY_SET = new Set<CapabilitySeverityKeyword>(['BLOCKER', 'SKIP', 'WARN', 'MAJOR', 'MINOR']);
const ACTION_SEVERITY_SET = new Set(['MAJOR', 'BLOCKER']);
const SAFE_ID = /^[a-z][a-z0-9_-]*$/;
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
  slot?: ExtensionPhaseBindingSlot;
  event?: string;
}

export function readExtensionTimings(frameworkRoot = FRAMEWORK_ROOT): Map<string, ExtensionTiming> {
  const file = path.join(frameworkRoot, 'specs', 'lifecycle-hooks-schema.yaml');
  const schema = YAML.parse(fs.readFileSync(file, 'utf8')) as {
    hook_events: Array<{ id: string; version: number; description: string }>;
    hook_contributions: Pick<ExtensionTiming, 'scope' | 'resources' | 'consumers'>;
    contribution_timings: Array<ExtensionTiming & { legacy_slot?: ExtensionPhaseBindingSlot }>;
  };
  const timings = new Map<string, ExtensionTiming>();
  for (const hook of schema.hook_events) {
    const id = `harness.${hook.id}@${hook.version}`;
    timings.set(id, { ...schema.hook_contributions, id, event: hook.id, description: hook.description });
  }
  for (const timing of schema.contribution_timings) {
    timings.set(timing.id, { ...timing, slot: timing.legacy_slot });
  }
  return timings;
}


function emptyBundle(rootDir: string | null): ExtensionBundle {
  return {
    rootDir,
    manifestPath: null,
    manifestVersion: null,
    manifestName: null,
    manifestUsable: true,
    bindings: [],
    featurePhases: [],
    declaredSkills: [],
    skills: [],
    knowledgePaths: [],
    knowledge: [],
    mcpActions: Object.create(null) as ExtensionBundle['mcpActions'],
    phaseBindings: {},
    hooks: {},
    extensionCapabilities: {},
    phaseRuleOverlayPaths: {},
    skillAssetAbsPaths: {},
    errors: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeResolve(extRoot: string, rel: string): string {
  const safe = validateProjectRelativePath(extRoot, rel.trim().replace(/^\.\/+/, ''), 'extension 引用');
  return realProjectPath(extRoot, safe, 'extension 引用');
}

function safeResolveProject(projectRoot: string, rel: string): string {
  return realProjectPath(projectRoot, rel, 'mcp_actions.produces');
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return Object.keys(value).filter(key => !set.has(key));
}

function pushError(bundle: ExtensionBundle, code: string, message: string, p?: string,
  identity?: Pick<ExtensionValidationError, 'source' | 'ability' | 'bindingId' | 'at'>): void {
  bundle.errors.push({ severity: 'MAJOR', code, message, path: p, ...identity });
}

function rejectManifest(bundle: ExtensionBundle): ExtensionBundle {
  bundle.manifestUsable = false;
  return bundle;
}

function isFile(file: string): boolean {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

function legacyBindingId(domain: 'phase' | 'hook', ...parts: string[]): string {
  return `${domain}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)}`;
}

function hookResource(ref: string): 'hook_markdown' | 'hook_script' | undefined {
  const ext = path.extname(ref).toLowerCase();
  return ext === '.md' ? 'hook_markdown' : ext === '.mjs' ? 'hook_script' : undefined;
}

function nativeTimingResource(timing: ExtensionTiming | undefined, kind: ExtensionBinding['kind'],
  ref: string, rawMcpActions: unknown): TimingResource | undefined {
  if (timing?.event) {
    const resource = hookResource(ref);
    return kind === 'knowledge' && resource === 'hook_markdown' || kind === 'action' && resource === 'hook_script'
      ? resource : undefined;
  }
  if (kind === 'knowledge') return 'knowledge_file';
  if (kind !== 'action') return undefined;
  if (timing?.resources.includes('mcp') && (!timing.resources.includes('skill')
    || isRecord(rawMcpActions) && Object.prototype.hasOwnProperty.call(rawMcpActions, ref))) return 'mcp';
  return 'skill';
}

interface InstallationSelection {
  source?: string;
  enabled: boolean;
  bindings?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

function readInstallations(raw: unknown, bundle: ExtensionBundle, manifestPath: string): Map<string, InstallationSelection> {
  const installations = new Map<string, InstallationSelection>();
  if (!isRecord(raw)) return installations;
  for (const [ability, value] of Object.entries(raw)) {
    const source = isRecord(value) && typeof value.source === 'string' ? value.source.trim() : '';
    if (!SAFE_SKILL.test(ability) || !source || !isRecord(value) || typeof value.enabled !== 'boolean'
      || !isRecord(value.bindings) || !isRecord(value.files) || value.in_place !== undefined && value.in_place !== true
      || unknownKeys(value, ['source', 'enabled', 'bindings', 'files', 'in_place']).length
      || !Object.values(value.files).every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))) {
      pushError(bundle, 'installation_shape', `installations.${ability} 的来源、开关或文件归属格式非法`, manifestPath, { ability, source });
      installations.set(ability, { enabled: false });
      continue;
    }
    for (const [id, enabled] of Object.entries(value.bindings)) {
      if (!SAFE_ID.test(id) || typeof enabled !== 'boolean') {
        pushError(bundle, 'installation_binding_selection', `installations.${ability}.bindings.${id} 必须是绑定 ID 对应的 boolean`,
          manifestPath, { ability, source, bindingId: id });
      }
    }
    installations.set(ability, { source, enabled: value.enabled, bindings: value.bindings, files: value.files });
  }
  return installations;
}

type LoadOptions = { frameworkRoot?: string };

export function loadInstanceExtensions(projectRoot: string, extensionDirRel?: string, options?: LoadOptions): ExtensionBundle {
  const configured = extensionDirRel ?? 'doc/extensions';
  let extRoot: string;
  try {
    extRoot = realProjectPath(projectRoot, configured, 'paths.extension_dir');
    if (fs.existsSync(extRoot) && !fs.statSync(extRoot).isDirectory()) {
      throw new Error('paths.extension_dir 必须指向目录');
    }
  } catch (error) {
    const invalid = emptyBundle(null);
    pushError(invalid, 'extension_dir_path', (error as Error).message);
    return rejectManifest(invalid);
  }
  return readExtensionManifest(extRoot, projectRoot, options, false);
}

/** Read source defaults before installation; host selections are never read from the source package. */
export function loadInstanceExtensionSource(sourceRoot: string, projectRoot: string, options?: LoadOptions): ExtensionBundle {
  return readExtensionManifest(path.resolve(sourceRoot), projectRoot, options, true);
}

function readExtensionManifest(extRoot: string, projectRoot: string, options: LoadOptions | undefined,
  sourceOnly: boolean): ExtensionBundle {
  if (!fs.existsSync(extRoot) || !fs.statSync(extRoot).isDirectory()) return emptyBundle(null);
  const manifestPath = path.join(extRoot, 'manifest.yaml');
  if (!fs.lstatSync(manifestPath, { throwIfNoEntry: false })) return emptyBundle(extRoot);

  const bundle = emptyBundle(extRoot);
  bundle.manifestPath = manifestPath;

  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(safeResolve(extRoot, 'manifest.yaml'), 'utf-8'));
  } catch (e) {
    pushError(bundle, 'manifest_yaml_parse', `无法解析 YAML：${(e as Error).message}`, manifestPath);
    return rejectManifest(bundle);
  }

  if (!isRecord(raw)) {
    pushError(bundle, 'manifest_not_object', 'manifest 根必须是 object', manifestPath);
    return rejectManifest(bundle);
  }

  const sv = raw.schema_version;
  const schemaVersion = typeof sv === 'string' ? sv.trim() : '';
  if (!schemaVersion) {
    pushError(bundle, 'manifest_schema_version', '缺少或非法 schema_version（须为非空字符串）', manifestPath);
  } else if (schemaVersion !== '1.0' && schemaVersion !== '1.1' && schemaVersion !== '2.0') {
    pushError(
      bundle,
      'manifest_schema_version_unsupported',
      `不支持的 schema_version="${schemaVersion}"（当前支持 1.0 / 1.1 / 2.0）`,
      manifestPath,
    );
  }

  const name = raw.name;
  if (typeof name !== 'string' || !name.trim()) {
    pushError(bundle, 'manifest_name', 'name 必须为非空字符串', manifestPath);
  } else if (schemaVersion === '1.1' && !SAFE_ID.test(name.trim())) {
    pushError(bundle, 'manifest_name', 'manifest 1.1 name 必须是小写 slug', manifestPath);
  }

  if (bundle.errors.length > 0) {
    return rejectManifest(bundle);
  }
  const version = schemaVersion as '1.0' | '1.1' | '2.0';
  const modern = version !== '1.0';
  const native = version === '2.0';
  if (modern) {
    const allowed = ['schema_version', 'name', 'version', 'description', 'framework_compat', 'provides', 'phase_bindings'];
    if (native) allowed.push('bindings', 'installations');
    for (const key of unknownKeys(raw, allowed)) {
      pushError(bundle, 'manifest_unknown_field', `manifest ${version} 不支持字段：${key}`, manifestPath);
    }
  }
  if (native && raw.installations !== undefined && !isRecord(raw.installations)) {
    pushError(bundle, 'installations_shape', 'installations 必须是能力 ID 映射', manifestPath);
  }
  if (bundle.errors.length) return rejectManifest(bundle);

  bundle.manifestVersion = version;
  const manifestName = (name as string).trim();
  const legacyAbility = SAFE_SKILL.test(manifestName) ? manifestName : `legacy-${legacyBindingId('hook', manifestName).slice(5)}`;
  bundle.manifestName = manifestName;
  const frameworkRoot = options?.frameworkRoot ?? FRAMEWORK_ROOT;
  let featurePhases = new Set<string>();
  let harnessPhases = new Set<string>();
  const provides = isRecord(raw.provides) ? raw.provides : {};
  if (raw.provides !== undefined && (modern || raw.provides !== null) && !isRecord(raw.provides)) {
    pushError(bundle, 'provides_not_object', 'provides 必须是 object', manifestPath);
  }
  if (modern) {
    for (const key of unknownKeys(provides, ['skills', 'knowledge', 'hooks', 'capabilities', 'skill_assets', 'phase_rules_overlays', 'mcp_actions'])) {
      pushError(bundle, 'provides_unknown_field', `manifest ${version} provides 不支持字段：${key}`, manifestPath);
    }
  }
  if (modern || provides.hooks !== undefined) {
    try {
      const workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot });
      featurePhases = new Set(workflowFeaturePhases(workflow, 'full'));
      harnessPhases = new Set(listWorkflowPhases(workflow));
      bundle.featurePhases = [...featurePhases].sort();
    } catch (error) {
      pushError(bundle, 'manifest_workflow_unresolvable', (error as Error).message, manifestPath);
    }
  }
  let timings = new Map<string, ExtensionTiming>();
  if (provides.hooks !== undefined || (modern && raw.phase_bindings !== undefined) || (native && raw.bindings !== undefined)) {
    try {
      timings = readExtensionTimings(frameworkRoot);
    } catch (error) {
      pushError(bundle, 'extension_timings_unavailable', (error as Error).message, manifestPath);
    }
  }
  const phaseTimings = new Map([...timings.values()].filter(t => t.slot).map(t => [t.slot!, t]));
  const hookTimings = new Map([...timings.values()].filter(t => t.event).map(t => [t.event!, t]));
  const hookConfigEnabled = sourceOnly || (provides.hooks === undefined && !native)
    || loadFrameworkConfig(projectRoot).lifecycle_hooks_enabled !== false;
  const installations = native && !sourceOnly ? readInstallations(raw.installations, bundle, manifestPath) : new Map();
  const selectBinding = (binding: ExtensionBinding, byDefault: boolean, issue?: string, code = 'extension_binding_invalid') => {
    const installation = installations.get(binding.ability);
    const timing = timings.get(binding.at);
    binding.slot = timing?.slot;
    binding.timingDescription = timing?.description;
    binding.consumer = timing?.event ? timing.consumers?.[binding.kind === 'knowledge' ? 'hook_markdown' : 'hook_script'] : timing?.consumer;
    binding.source = installation?.source ?? manifestName;
    binding.issue = issue;
    const choices = installation?.bindings;
    const choice = choices && Object.prototype.hasOwnProperty.call(choices, binding.id) ? choices[binding.id] : undefined;
    if (choice !== undefined && typeof choice !== 'boolean' && !binding.issue) {
      binding.issue = '宿主绑定开关必须是 boolean';
    }
    if (binding.issue) {
      pushError(bundle, code, `${binding.ability}/${binding.id} (${binding.at || '未声明时点'})：${binding.issue}`, manifestPath,
        { source: binding.source, ability: binding.ability, bindingId: binding.id, at: binding.at });
    }
    const selected = (choice ?? (installation && !binding.legacy ? false : byDefault)) === true;
    binding.selected = installation?.enabled !== false && selected;
    if (installation?.enabled === false) binding.reason = '能力已停用';
    else if (binding.issue) binding.reason = binding.issue;
    else if (!selected) binding.reason = '绑定未启用';
    else if (timings.get(binding.at)?.event && !hookConfigEnabled) binding.reason = 'lifecycle_hooks_enabled 已关闭';
    binding.enabled = !binding.reason;
    bundle.bindings.push(binding);
  };

  const declaredSkills = new Set<string>();
  const skillsRaw = provides.skills;
  if (skillsRaw !== undefined) {
    if (!Array.isArray(skillsRaw)) {
      pushError(bundle, 'provides_skills', 'provides.skills 必须是字符串数组', manifestPath);
    } else {
      for (const s of skillsRaw) {
        if (typeof s !== 'string' || !s.trim()) {
          pushError(bundle, 'provides_skills_item', `非法 skill id：${String(s)}`, manifestPath);
        } else if (!modern || (native ? SAFE_SKILL : SAFE_ID).test(s.trim())) {
          const id = s.trim();
          if (!bundle.declaredSkills.includes(id)) bundle.declaredSkills.push(id);
          if (modern) {
            try {
              const skillPath = safeResolve(extRoot, `skills/${id}/SKILL.md`);
              if (!isFile(skillPath)) throw new Error(`manifest skill 缺少 skills/${id}/SKILL.md`);
            } catch (error) {
              pushError(bundle, 'skill_missing', (error as Error).message, manifestPath, { ability: id, source: manifestName });
              continue;
            }
          }
          declaredSkills.add(id);
          if (installations.get(id)?.enabled !== false && !bundle.skills.includes(id)) bundle.skills.push(id);
        } else {
          pushError(bundle, 'provides_skills_item', `manifest ${version} skill id 非法：${s.trim()}`, manifestPath);
        }
      }
    }
  }

  const knowRaw = provides.knowledge;
  if (knowRaw !== undefined) {
    if (!Array.isArray(knowRaw)) {
      pushError(bundle, 'provides_knowledge', 'provides.knowledge 必须是数组', manifestPath);
    } else {
      for (const k of knowRaw) {
        let entry: ExtensionKnowledgeEntry | null = null;
        if (typeof k === 'string' && k.trim()) {
          const itemPath = k.trim();
          entry = {
            path: itemPath,
            absPath: '',
            summary: '',
            audience: [],
            legacy: true,
          };
        } else if (modern && isRecord(k)) {
          const extra = unknownKeys(k, ['path', 'summary', 'audience']);
          if (extra.length > 0) {
            pushError(bundle, 'knowledge_unknown_field', `knowledge 条目不支持字段：${extra.join(', ')}`, manifestPath);
            continue;
          }
          const itemPath = typeof k.path === 'string' ? k.path.trim() : '';
          const summary = typeof k.summary === 'string' ? k.summary.trim() : '';
          const audienceRaw = k.audience;
          let audience: ExtensionKnowledgeEntry['audience'] | null = null;
          if (audienceRaw === 'global' || (native && audienceRaw === 'none')) audience = audienceRaw;
          else if (Array.isArray(audienceRaw) && audienceRaw.length > 0 && audienceRaw.every(item =>
            typeof item === 'string' && featurePhases.has(item))) {
            audience = [...new Set(audienceRaw as string[])];
          }
          if (!itemPath || (audience !== 'none' && !summary) || audience === null) {
            pushError(bundle, 'provides_knowledge_item', 'knowledge 对象须含 path/summary 与有效 audience（保留的 1.0 路径仅需 path 与 audience: none）', manifestPath);
            continue;
          }
          entry = { path: itemPath, absPath: '', summary, audience, legacy: false };
        } else {
          pushError(bundle, 'provides_knowledge_item', `非法 knowledge 项：${String(k)}`, manifestPath);
          continue;
        }
        try {
          const abs = safeResolve(extRoot, entry.path);
          if (!fs.existsSync(abs) || (modern && !fs.statSync(abs).isFile())) {
            pushError(bundle, 'knowledge_missing', `knowledge 文件不存在：${entry.path}`, abs);
          } else {
            bundle.knowledgePaths.push(abs);
            bundle.knowledge.push({ ...entry, absPath: abs });
          }
        } catch (e) {
          pushError(bundle, 'knowledge_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  if (modern && provides.mcp_actions !== undefined) {
    if (!isRecord(provides.mcp_actions)) {
      pushError(bundle, 'provides_mcp_actions', 'provides.mcp_actions 必须是 object', manifestPath);
    } else for (const [id, value] of Object.entries(provides.mcp_actions)) {
      if (!SAFE_ID.test(id) || !isRecord(value)) {
        pushError(bundle, 'mcp_action_shape', `mcp action 非法：${id}`, manifestPath);
        continue;
      }
      const extra = unknownKeys(value, ['tool', 'required', 'severity', 'produces', 'usage']);
      if (extra.length > 0) {
        pushError(bundle, 'mcp_action_forbidden_field', `mcp_actions.${id} 不支持字段：${extra.join(', ')}`, manifestPath);
        continue;
      }
      const tool = typeof value.tool === 'string' ? value.tool.trim() : '';
      const usage = typeof value.usage === 'string' ? value.usage.trim() : '';
      const required = value.required;
      const severity = value.severity ?? 'MAJOR';
      const produces = Array.isArray(value.produces)
        ? value.produces.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
        : [];
      if (!tool || !usage || typeof required !== 'boolean' || produces.length === 0 || produces.length !== (value.produces as unknown[] | undefined)?.length || !ACTION_SEVERITY_SET.has(String(severity))) {
        pushError(bundle, 'mcp_action_shape', `mcp_actions.${id} 须含 tool/required/produces/usage，severity 仅 MAJOR|BLOCKER`, manifestPath);
        continue;
      }
      try {
        const action: ExtensionMcpAction = {
          id, tool, usage, required, severity: severity as 'MAJOR' | 'BLOCKER', produces,
          produceAbsPaths: produces.map(item => safeResolveProject(projectRoot, item)),
        };
        bundle.mcpActions[id] = action;
      } catch (error) {
        pushError(bundle, 'mcp_action_produces_path', (error as Error).message, manifestPath);
      }
    }
  }

  const actionRequirement = (id: string) => {
    const actions = provides.mcp_actions;
    const action = isRecord(actions) ? actions[id] : undefined;
    return isRecord(action) && action.required === true
      ? { required: true, severity: (action.severity === 'BLOCKER' ? 'BLOCKER' : 'MAJOR') as 'BLOCKER' | 'MAJOR' }
      : {};
  };
  const addPhaseBinding = (phase: string, slot: ExtensionPhaseBindingSlot, item: ExtensionPhaseBinding) => {
    const slots = bundle.phaseBindings[phase] ??= {};
    (slots[slot] ??= []).push(item);
  };
  const addHook = (phase: string, event: string, file: string) => {
    const events = bundle.hooks[phase] ??= {};
    (events[event] ??= []).push(file);
  };

  if (modern && raw.phase_bindings !== undefined) {
    if (!isRecord(raw.phase_bindings)) {
      pushError(bundle, 'phase_bindings_shape', 'phase_bindings 必须是 Feature phase -> slot 映射', manifestPath);
    } else for (const [phase, slots] of Object.entries(raw.phase_bindings)) {
      if (!isRecord(slots)) {
        pushError(bundle, 'phase_binding_phase', `phase_bindings.${phase} 必须是槽位映射`, manifestPath);
        continue;
      }
      const knownPhase = featurePhases.has(phase);
      if (!knownPhase) pushError(bundle, 'phase_binding_phase', `phase_bindings 仅接受 Feature phase：${phase}`, manifestPath);
      for (const [slot, list] of Object.entries(slots)) {
        const timing = phaseTimings.get(slot as ExtensionPhaseBindingSlot);
        if (!timing) pushError(bundle, 'phase_binding_slot', `不支持 phase_bindings.${phase}.${slot}`, manifestPath);
        if (!Array.isArray(list)) {
          pushError(bundle, 'phase_binding_items', `phase_bindings.${phase}.${slot} 必须是数组`, manifestPath);
          continue;
        }
        for (const [index, value] of list.entries()) {
          const kind = isRecord(value) && (value.kind === 'knowledge' || value.kind === 'skill' || value.kind === 'mcp')
            ? value.kind : undefined;
          const ref = isRecord(value) && typeof value.ref === 'string' ? value.ref.trim() : '';
          const id = legacyBindingId('phase', phase, slot, kind ?? '', ref || String(index));
          const ability = (kind === 'skill' || kind === 'mcp') && SAFE_SKILL.test(ref) ? ref : legacyAbility;
          const binding: ExtensionBinding = {
            source: manifestName, ability, id, at: timing?.id ?? `${phase}.${slot}`, phase, ref,
            kind: kind === 'knowledge' ? 'knowledge' : kind ? 'action' : undefined,
            resource: kind === 'knowledge' ? 'knowledge_file' : kind, enabled: false, legacy: 'phase', ...(kind === 'mcp' ? actionRequirement(ref) : {}),
          };
          if (bundle.bindings.some(b => b.ability === ability && b.id === id)) continue;
          const validShape = isRecord(value) && kind && ref && unknownKeys(value, ['kind', 'ref']).length === 0;
          const knowledge = kind === 'knowledge' ? bundle.knowledge.find(item => item.path === ref) : undefined;
          const hasResource = kind === 'mcp' ? !!bundle.mcpActions[ref] : kind === 'skill' ? declaredSkills.has(ref) : !!knowledge;
          let issue: string | undefined;
          let code: string | undefined;
          if (!validShape) { issue = '条目须为 {kind,ref}'; code = 'phase_binding_item'; }
          else if (!knownPhase || !timing) { issue = '当前发布件不存在此 Feature phase 或槽位'; code = 'phase_binding_slot'; }
          else if (!hasResource) { issue = `引用不存在或不可用：${kind}:${ref}`; code = 'phase_binding_ref_missing'; }
          if (knowledge) binding.absPath = knowledge.absPath;
          if (kind === 'skill' && hasResource) binding.absPath = safeResolve(extRoot, `skills/${ref}/SKILL.md`);
          selectBinding(binding, true, issue, code);
          if (binding.enabled && timing?.slot && kind) addPhaseBinding(phase, timing.slot, { kind, ref });
        }
      }
    }
  }

  const hooksRaw = provides.hooks;
  if (hooksRaw !== undefined) {
    if (!isRecord(hooksRaw)) {
      pushError(bundle, 'provides_hooks', 'provides.hooks 必须是 object', manifestPath);
    } else for (const [ph, events] of Object.entries(hooksRaw)) {
      if (!isRecord(events)) {
        pushError(bundle, 'provides_hooks_phase', `hooks.${ph} 必须是 event->paths 映射`, manifestPath);
        continue;
      }
      const phase = normalizePhaseId(ph, ph as 'spec');
      if (phase !== ph) console.warn(`[extension-loader] hooks 已弃用 phase key "${ph}"，已规范化为 "${phase}"`);
      for (const [event, list] of Object.entries(events)) {
        if (!Array.isArray(list)) {
          pushError(bundle, 'provides_hooks_event', `hooks.${ph}.${event} 必须是路径数组`, manifestPath);
          continue;
        }
        for (const [index, value] of list.entries()) {
          const ref = typeof value === 'string' ? value.trim() : '';
          const id = legacyBindingId('hook', phase, event, ref || String(index));
          if (bundle.bindings.some(b => b.ability === legacyAbility && b.id === id)) continue;
          const resource = hookResource(ref);
          const timing = hookTimings.get(event);
          const binding: ExtensionBinding = {
            source: manifestName, ability: legacyAbility, id, at: timing?.id ?? `${phase}.${event}`, phase, ref,
            kind: resource === 'hook_markdown' ? 'knowledge' : 'action', resource, enabled: false, legacy: 'hook',
          };
          let issue: string | undefined;
          let code: string | undefined;
          if (!timing) { issue = `未知生命周期时点 ${event}`; code = 'extension_binding_unknown_timing'; }
          else if (!harnessPhases.has(phase)) { issue = `当前 workflow 不存在 phase ${phase}`; code = 'provides_hooks_phase'; }
          else if (!resource || !timing.resources.includes(resource)) { issue = `hook 必须是 .md 或 .mjs 文件：${ref}`; code = 'provides_hooks_path'; }
          else {
            try {
              binding.absPath = safeResolve(extRoot, ref);
              if (!isFile(binding.absPath)) {
                issue = `hook 文件不存在：${ref}`;
                code = 'hook_path_missing';
              }
            } catch (error) {
              issue = (error as Error).message;
              code = 'hook_resolve';
            }
          }
          selectBinding(binding, true, issue, code);
          if (binding.enabled && binding.absPath) addHook(phase, event, binding.absPath);
        }
      }
    }
  }

  if (native && raw.bindings !== undefined) {
    if (!isRecord(raw.bindings)) {
      pushError(bundle, 'bindings_shape', 'bindings 必须是能力 ID -> 绑定 ID 映射', manifestPath);
    } else for (const [ability, entries] of Object.entries(raw.bindings)) {
      if (!SAFE_SKILL.test(ability) || !isRecord(entries)) {
        pushError(bundle, 'bindings_ability_shape', `bindings.${ability} 必须是绑定 ID 映射`, manifestPath, { ability, source: manifestName });
        continue;
      }
      for (const [id, value] of Object.entries(entries)) {
        const data = isRecord(value) ? value : {};
        const at = typeof data.at === 'string' ? data.at.trim() : '';
        const ref = typeof data.ref === 'string' ? data.ref.trim() : '';
        const kind = data.kind === 'knowledge' || data.kind === 'action' ? data.kind : undefined;
        const phase = typeof data.phase === 'string' ? data.phase.trim() : undefined;
        const timing = timings.get(at);
        const resource = nativeTimingResource(timing, kind, ref, provides.mcp_actions);
        const binding: ExtensionBinding = { source: manifestName, ability, id, at, ref, kind, resource, phase, enabled: false };
        if (resource === 'mcp') Object.assign(binding, actionRequirement(ref));
        if (data.required === true) {
          binding.required = true;
          binding.severity ??= 'MAJOR';
        }
        let issue: string | undefined;
        let code: string | undefined;
        if (!isRecord(value) || !SAFE_ID.test(id) || !at || !kind || !ref
          || unknownKeys(data, ['at', 'kind', 'ref', 'phase', 'enabled_by_default', 'required']).length
          || data.phase !== undefined && !phase
          || data.required !== undefined && typeof data.required !== 'boolean'
          || data.enabled_by_default !== undefined && typeof data.enabled_by_default !== 'boolean') {
          issue = '绑定须含合法 ID 和 at/kind/ref，phase 为字符串，开关为 boolean';
        } else if (!timing) {
          issue = `未知时点或不支持的时点版本：${at}`;
          code = 'extension_binding_unknown_timing';
        } else if (timing.scope === 'project' ? phase !== undefined
          : !phase || !(timing.scope === 'feature' ? featurePhases : harnessPhases).has(phase)) {
          issue = `时点 ${at} 的 phase 不可用：${phase ?? '未声明'}`;
        } else if (!resource || !timing.resources.includes(resource)) {
          issue = `时点 ${at} 不支持该贡献：${kind}:${ref}`;
        } else if (resource === 'mcp') {
          if (!bundle.mcpActions[ref]) issue = `缺少有效 provides.mcp_actions.${ref} 声明`;
        } else {
          try {
            if (resource === 'skill' && !SAFE_SKILL.test(ref)) throw new Error(`无效 skill ID：${ref}`);
            const resourceRef = resource === 'skill' ? `skills/${ref}/SKILL.md` : ref;
            if (resource === 'skill' && !declaredSkills.has(ref)) {
              const files = installations.get(ability)?.files;
              const ownedPath = path.relative(projectRoot, path.resolve(extRoot, resourceRef)).replace(/\\/g, '/');
              if (!files || !Object.prototype.hasOwnProperty.call(files, ownedPath)) {
                throw new Error(`缺少 provides.skills 或安装归属中的 skill：${ref}`);
              }
            }
            binding.absPath = safeResolve(extRoot, resourceRef);
            if (!isFile(binding.absPath)) throw new Error(`引用文件不可用：${ref}`);
            if (resource === 'skill' && ref !== ability && installations.get(ref)?.enabled === false) {
              throw new Error(`引用的 skill 已停用：${ref}`);
            }
          } catch (error) {
            issue = (error as Error).message;
          }
        }
        if (bundle.bindings.some(b => b.ability === ability && b.id === id)) {
          code = 'extension_binding_duplicate';
          issue = '与已有绑定 ID 冲突';
        }
        selectBinding(binding, data.enabled_by_default === true, issue, code);
        if (!binding.enabled || !timing || !phase) continue;
        if (timing.event && binding.absPath) addHook(phase, timing.event, binding.absPath);
        if (timing.slot && (resource === 'mcp' || resource === 'skill' || resource === 'knowledge_file')) {
          const slotKind = resource === 'knowledge_file' ? 'knowledge' : resource;
          addPhaseBinding(phase, timing.slot, { kind: slotKind, ref });
          if (slotKind === 'knowledge' && binding.absPath && !bundle.knowledge.some(item => item.path === ref)) {
            bundle.knowledge.push({ path: ref, absPath: binding.absPath, summary: '', audience: [], legacy: false });
          }
        }
      }
    }
  }

  const capsRaw = provides.capabilities;
  if (capsRaw !== undefined) {
    if (!isRecord(capsRaw)) {
      pushError(bundle, 'provides_capabilities', 'provides.capabilities 必须是 object', manifestPath);
    } else {
      for (const [capKey, spec] of Object.entries(capsRaw)) {
        if (!capKey.trim()) continue;
        if (!isRecord(spec)) {
          pushError(bundle, 'capability_spec', `capability "${capKey}" 必须是 object`, manifestPath);
          continue;
        }
        const prov = spec.provider;
        const sev = spec.severity;
        if (typeof prov !== 'string' || !prov.trim()) {
          pushError(bundle, 'capability_provider', `capability "${capKey}" 缺少 provider`, manifestPath);
          continue;
        }
        if (typeof sev !== 'string' || !SEVERITY_SET.has(sev as CapabilitySeverityKeyword)) {
          pushError(
            bundle,
            'capability_severity',
            `capability "${capKey}" severity 非法：${String(sev)}`,
            manifestPath,
          );
          continue;
        }
        try {
          const absProv = safeResolve(extRoot, prov.trim());
          if (!fs.existsSync(absProv)) {
            pushError(bundle, 'capability_provider_missing', `provider 文件不存在：${prov.trim()}`, absProv);
            continue;
          }
          const canonKey = normalizeCapabilityKey(capKey.trim());
          bundle.extensionCapabilities[canonKey] = {
            provider: absProv,
            severity: sev as CapabilitySeverityKeyword,
          };
        } catch (e) {
          pushError(bundle, 'capability_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  const skillAssetsRaw = provides.skill_assets;
  if (skillAssetsRaw !== undefined) {
    if (!isRecord(skillAssetsRaw)) {
      pushError(bundle, 'provides_skill_assets', 'provides.skill_assets 必须是 object', manifestPath);
    } else {
      for (const [skillId, bucket] of Object.entries(skillAssetsRaw)) {
        const sid = skillId.trim();
        if (!sid) {
          pushError(bundle, 'skill_assets_skill_id', 'skill_assets skill id 不能为空', manifestPath);
          continue;
        }
        if (!isRecord(bucket)) {
          pushError(bundle, 'skill_assets_bucket', `skill_assets.${sid} 必须是 assetKey→path 映射`, manifestPath);
          continue;
        }
        const acc: Record<string, string> = {};
        for (const [assetKey, rel] of Object.entries(bucket)) {
          const key = assetKey.trim();
          if (!key || typeof rel !== 'string' || !rel.trim()) {
            pushError(bundle, 'skill_assets_entry', `skill_assets.${sid}.${assetKey} 非法`, manifestPath);
            continue;
          }
          try {
            const abs = safeResolve(extRoot, rel.trim());
            if (!fs.existsSync(abs)) {
              pushError(bundle, 'skill_assets_missing', `skill_assets 文件不存在：${rel.trim()}`, abs);
            } else {
              acc[key] = abs;
            }
          } catch (e) {
            pushError(bundle, 'skill_assets_resolve', (e as Error).message, manifestPath);
          }
        }
        if (Object.keys(acc).length > 0) {
          bundle.skillAssetAbsPaths[sid] = { ...(bundle.skillAssetAbsPaths[sid] ?? {}), ...acc };
        }
      }
    }
  }

  const overRaw = provides.phase_rules_overlays;
  if (overRaw !== undefined) {
    if (!isRecord(overRaw)) {
      pushError(bundle, 'provides_overlays', 'provides.phase_rules_overlays 必须是 object', manifestPath);
    } else {
      for (const [ph, p] of Object.entries(overRaw)) {
        if (typeof p !== 'string' || !p.trim()) {
          pushError(bundle, 'overlay_path', `phase "${ph}" overlay 路径非法`, manifestPath);
          continue;
        }
        try {
          const abs = safeResolve(extRoot, p.trim());
          if (!fs.existsSync(abs)) {
            pushError(bundle, 'overlay_missing', `phase_rules_overlay 文件不存在：${p.trim()}`, abs);
          } else {
            const rawPh = ph.trim();
            const canon = normalizePhaseId(rawPh, rawPh as 'spec');
            if (rawPh !== canon) {
              // eslint-disable-next-line no-console
              console.warn(
                `[extension-loader] phase_rules_overlays 已弃用 phase key "${rawPh}"，已规范化为 "${canon}"`,
              );
            }
            bundle.phaseRuleOverlayPaths[canon] = abs;
          }
        } catch (e) {
          pushError(bundle, 'overlay_resolve', (e as Error).message, manifestPath);
        }
      }
    }
  }

  return bundle;
}

/** undefined 表示无 manifest 或 1.0 的目录发现，数组表示清单的有效技能选择。 */
export function extensionSkillIdsForBridge(bundle: ExtensionBundle): readonly string[] | undefined {
  if (!bundle.manifestUsable) return [];
  return bundle.manifestVersion === '1.1' || bundle.manifestVersion === '2.0' ? bundle.skills : undefined;
}

/**
 * 将目录中有效的 extension capabilities 合并进 profile，同名 key 由扩展覆盖。
 */
export function applyInstanceExtensions(
  resolved: HarnessResolvedProfile,
  projectRoot: string,
  extensionDirRel?: string,
  options?: LoadOptions,
): HarnessResolvedProfile {
  const bundle = loadInstanceExtensions(projectRoot, extensionDirRel, options);
  const mergedCaps: Record<string, ProfileCapabilitySpec> = {
    ...(resolved.capabilities as Record<string, ProfileCapabilitySpec>),
  };
  Object.assign(mergedCaps, bundle.extensionCapabilities);
  return {
    ...resolved,
    capabilities: normalizeCapabilitiesMap(mergedCaps),
    extensionBundle: bundle,
  };
}
