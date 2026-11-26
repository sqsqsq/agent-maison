import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import * as YAML from 'yaml';

import { loadFrameworkConfig } from '../../config';
import {
  extensionSkillIdsForBridge, loadInstanceExtensions, loadInstanceExtensionSource, validateExtensionManifestRoot,
} from '../../extension-loader';
import { scanExtensionSkills } from './instance-skill-bridge';
import { activeExtensionRequests, activeExtensionResourceRequests } from './extension-requests';
import { releaseLock, tryAcquireLock } from './goal-run-lock';
import { isInsideProjectRoot, realProjectPath, validateProjectRelativePath } from './project-relative-path';
import { ordinaryFile, ordinaryPath, relativeExtensionPath, removeExtensionFile, writeExtensionFileAtomic, type ObserveExtensionWrite } from './extension-files';

type Data = Record<string, unknown>;
type Document = ReturnType<typeof YAML.parseDocument>;
type Bundle = ReturnType<typeof loadInstanceExtensions>;
export type ExtensionMutation = 'install' | 'enable' | 'disable' | 'uninstall';

interface Installation {
  source: string;
  enabled: boolean;
  bindings: Record<string, boolean>;
  files: Record<string, string>;
  in_place?: true;
}

interface InstallFile {
  bytes: Buffer;
  sha256: string;
}

const TOKEN = /^[a-zA-Z0-9_-]+$/;
const BINDING_ID = /^[a-z][a-z0-9_-]*$/;
const MANIFEST = 'manifest.yaml';

function mapping(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function targetExtensionFrameworkRoot(projectRoot: string, invokingFrameworkRoot: string): string {
  const integrated = path.join(projectRoot, 'framework');
  if (fs.lstatSync(integrated, { throwIfNoEntry: false })) return integrated;
  return fs.existsSync(path.join(projectRoot, 'harness', 'harness-runner.ts')) ? projectRoot : invokingFrameworkRoot;
}

function verifyTargetManifestSupport(frameworkRoot: string): void {
  const schemaPath = path.join(frameworkRoot, 'specs', 'instance-extension-manifest.schema.yaml');
  let schema: Data;
  try { schema = mapping(YAML.parse(fs.readFileSync(schemaPath, 'utf8'))); }
  catch { throw new Error(`无法读取目标 Maison 发布件的扩展协议：${schemaPath}，宿主清单保留`); }
  const advertised = mapping(mapping(mapping(schema.root_object).properties).schema_version).enum;
  if (!Array.isArray(advertised) || !advertised.includes('2.0')) {
    throw new Error(`目标 Maison 发布件无法读取 extension manifest 2.0：${frameworkRoot}，宿主清单保留`);
  }
}

export function extensionLocation(projectRoot: string, frameworkRoot: string): { relative: string; root: string } {
  const relative = validateProjectRelativePath(projectRoot, loadFrameworkConfig(projectRoot).paths?.extension_dir
    ?? 'doc/extensions', 'paths.extension_dir');
  const root = realProjectPath(projectRoot, relative, 'paths.extension_dir');
  const project = fs.realpathSync(projectRoot);
  const framework = fs.realpathSync(frameworkRoot);
  if (root === project || (project !== framework && isInsideProjectRoot(framework, root))) {
    throw new Error('[extension_dir_path] paths.extension_dir 必须指向宿主内的独立扩展目录');
  }
  return { relative, root };
}

export function withExtensionWrite<T>(projectRoot: string, frameworkRoot: string, work: () => T): T {
  const { root } = extensionLocation(projectRoot, frameworkRoot);
  const lockPath = ordinaryFile(root, '.manifest.lock');
  const lock = tryAcquireLock(lockPath, {});
  if (!lock) throw new Error('同一宿主正在更新扩展，请在本次操作结束后重试');
  try { return work(); }
  finally { releaseLock(lockPath, lock.ownerId); }
}

function readManifest(root: string): Document {
  const file = ordinaryFile(root, MANIFEST);
  return YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
}

function rawManifest(doc: Document): Data {
  return mapping(doc.toJS());
}

function nativeBindings(doc: Document, ability: string): Data {
  return mapping(own(mapping(rawManifest(doc).bindings), ability));
}

function readInstallation(doc: Document, ability: string): Installation | undefined {
  const value = own(mapping(rawManifest(doc).installations), ability);
  if (value === undefined) return undefined;
  const item = mapping(value);
  const bindings = mapping(item.bindings);
  const files = mapping(item.files);
  if (typeof item.source !== 'string' || !item.source || typeof item.enabled !== 'boolean'
    || item.bindings !== bindings || item.files !== files
    || Object.values(bindings).some(value => typeof value !== 'boolean')
    || Object.values(files).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    || (item.in_place !== undefined && item.in_place !== true)
    || (item.in_place && Object.keys(files).length > 0)) {
    throw new Error(`installations.${ability} 形状无效，无法安全修改归属或开关`);
  }
  return item as unknown as Installation;
}

function declaredAbilities(bundle: Bundle, projectRoot: string, extensionDir: string, doc: Document): Set<string> {
  const raw = rawManifest(doc);
  const provided = mapping(raw.provides).skills;
  const skills = Array.isArray(provided) ? provided.filter((item): item is string => typeof item === 'string') : [];
  const legacySkills = bundle.manifestVersion === '1.0' || !bundle.manifestPath
    ? scanExtensionSkills(projectRoot, extensionDir).map(row => row.sourceSlug)
    : [];
  return new Set([
    ...skills, ...legacySkills,
    ...bundle.bindings.map(binding => binding.ability),
    ...Object.keys(mapping(raw.bindings)),
    ...Object.keys(mapping(raw.installations)),
  ]);
}

function migrateHost(doc: Document, bundle: Bundle, projectRoot: string, relative: string): void {
  if (bundle.manifestVersion === '2.0') return;
  if (!bundle.manifestPath) {
    doc.set('name', 'project-extensions');
    doc.set('provides', doc.createNode({}));
  }
  if (bundle.manifestVersion !== '1.1') {
    const skills = scanExtensionSkills(projectRoot, relative).map(row => row.sourceSlug);
    const provided = rawManifest(doc).provides;
    if (provided !== mapping(provided)) doc.set('provides', doc.createNode({}));
    doc.setIn(['provides', 'skills'], skills);
    if (bundle.manifestPath) {
      const knowledge = mapping(rawManifest(doc).provides).knowledge;
      if (Array.isArray(knowledge)) {
        doc.setIn(['provides', 'knowledge'], knowledge.map(item => typeof item === 'string'
          ? { path: item, audience: 'none' } : item));
      }
      doc.delete('phase_bindings');
      doc.deleteIn(['provides', 'mcp_actions']);
    }
  }
  doc.set('schema_version', '2.0');
  const errors = validateExtensionManifestRoot(doc.toJS());
  if (errors.length) {
    throw new Error(`无法迁移宿主扩展清单：${errors.map(item => item.message).join('；')}。已保留原清单及资源。`);
  }
}

function sourcesForInstall(input: {
  projectRoot: string;
  frameworkRoot: string;
  source: string;
  root: string;
  ability?: string;
}): {
  name: string;
  inPlace: boolean;
  abilities: Array<{ id: string; skill: boolean; bindings: unknown; mcpActions: Data; files: Map<string, InstallFile> }>;
} {
  const resolvedSource = path.resolve(input.source);
  if (!fs.lstatSync(resolvedSource, { throwIfNoEntry: false }) || !fs.statSync(resolvedSource).isDirectory()) {
    throw new Error('install 来源必须是包含 manifest.yaml 的本地目录');
  }
  const sourceRoot = fs.realpathSync(resolvedSource);
  const inPlace = input.root === sourceRoot;
  if (!inPlace && (isInsideProjectRoot(input.root, sourceRoot) || isInsideProjectRoot(sourceRoot, input.root))) {
    throw new Error('install 来源与宿主扩展目录不能互相包含');
  }
  const doc = readManifest(sourceRoot);
  const source = loadInstanceExtensionSource(sourceRoot, input.projectRoot, { frameworkRoot: input.frameworkRoot });
  if (!source.manifestPath || !source.manifestUsable || !source.manifestName) {
    throw new Error(`来源清单不可用：${source.errors.map(item => item.message).join('；') || '缺少 manifest.yaml'}`);
  }
  const raw = rawManifest(doc);
  const skills = new Set(source.manifestVersion === '1.0'
    ? scanExtensionSkills(sourceRoot, '.').map(row => row.sourceSlug)
    : source.skills);
  const rawSkills = mapping(raw.provides).skills;
  if (source.manifestVersion !== '1.0' && Array.isArray(rawSkills)) {
    for (const id of rawSkills) if (typeof id === 'string' && TOKEN.test(id)) skills.add(id);
  }
  const native = mapping(raw.bindings);
  const legacy = new Map<string, Data>();
  for (const binding of source.bindings) {
    if (!binding.legacy || !binding.kind || binding.issue) continue;
    legacy.set(binding.ability, {
      ...legacy.get(binding.ability),
      [binding.id]: {
        at: binding.at, kind: binding.kind, ref: binding.ref, phase: binding.phase, enabled_by_default: true,
      },
    });
  }
  const ids = input.ability ? [input.ability]
    : [...new Set([...skills, ...Object.keys(native), ...legacy.keys()])].sort();
  if (ids.length === 0) throw new Error('来源没有可安装的能力');
  const abilities = ids.map(id => {
    const skill = skills.has(id);
    const declared = own(native, id);
    const migrated = legacy.get(id);
    const value = input.root === sourceRoot ? declared
      : migrated && (declared === undefined || declared === mapping(declared)) ? { ...migrated, ...mapping(declared) } : declared;
    if (!TOKEN.test(id) || (value === undefined && !skill && !migrated)) throw new Error(`来源没有能力：${id}`);
    const mcpActions: Data = {};
    const files = new Map<string, InstallFile>();
    const addFile = (relative: string): void => {
      const file = ordinaryFile(sourceRoot, relative);
      const key = relativeExtensionPath(sourceRoot, file);
      if (key === MANIFEST || key.startsWith('.manifest.lock')) throw new Error(`绑定不可将管理文件声明为资源：${relative}`);
      if (!fs.existsSync(file)) return;
      const bytes = fs.readFileSync(file);
      files.set(key, { bytes, sha256: digest(bytes) });
    };
    const addSkill = (slug: string): void => {
      const readDirectory = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const candidate = path.join(directory, entry.name);
          const relative = relativeExtensionPath(sourceRoot, candidate);
          if (entry.isDirectory()) readDirectory(candidate);
          else addFile(relative);
        }
      };
      const directory = ordinaryPath(sourceRoot, `skills/${slug}`, 'extension skill');
      const exists = fs.lstatSync(directory, { throwIfNoEntry: false });
      if (!exists) return;
      if (!exists.isDirectory()) throw new Error(`skill 资源必须是目录：${slug}`);
      readDirectory(directory);
    };
    if (skill) addSkill(id);
    for (const [bindingId, rawBinding] of Object.entries(mapping(value))) {
      const { ref, kind } = mapping(rawBinding);
      if (typeof ref !== 'string' || !ref.trim()) continue;
      const normalized = source.bindings.find(row => row.ability === id && row.id === bindingId);
      const reference = ref.trim();
      const mcp = own(mapping(mapping(raw.provides).mcp_actions), reference);
      if (kind === 'action' && mcp !== undefined && normalized?.resource === 'mcp') {
        Object.defineProperty(mcpActions, reference, { value: mcp, enumerable: true });
      } else if (kind === 'action' && TOKEN.test(reference) && skills.has(reference)) {
        addSkill(reference);
      } else if (typeof normalized?.absPath === 'string') {
        addFile(relativeExtensionPath(sourceRoot, normalized.absPath));
      } else if (kind === 'knowledge' || (kind === 'action' && /[/\\.]/.test(ref))) {
        addFile(ref.trim());
      }
    }
    return { id, skill, bindings: value, mcpActions, files };
  });
  return { name: source.manifestName, inPlace, abilities };
}

export interface ExtensionLifecycleResult {
  abilities: string[];
  changed: boolean;
  filesWritten: string[];
  filesRemoved: string[];
  retained: Array<{ path: string; reason: string }>;
  requestIds?: string[];
}

interface ChangeOptions {
  projectRoot: string;
  frameworkRoot: string;
  source?: string;
  ability?: string;
  binding?: string;
  observeWrite?: ObserveExtensionWrite;
}

export function changeExtension(action: ExtensionMutation, options: ChangeOptions): ExtensionLifecycleResult {
  const { projectRoot } = options;
  const frameworkRoot = targetExtensionFrameworkRoot(projectRoot, options.frameworkRoot);
  verifyTargetManifestSupport(frameworkRoot);
  const { relative, root } = extensionLocation(projectRoot, frameworkRoot);
  const doc = readManifest(root);
  const before = doc.toJS();
  const bundle = loadInstanceExtensions(projectRoot, relative, { frameworkRoot });
  if (!bundle.manifestUsable) throw new Error(`宿主扩展清单不可用：${bundle.errors.map(item => item.message).join('；')}`);
  const result: ExtensionLifecycleResult = { abilities: [], changed: false, filesWritten: [], filesRemoved: [], retained: [] };
  const manifestPath = ordinaryFile(root, MANIFEST);
  const save = (): void => {
    if (isDeepStrictEqual(before, doc.toJS())) return;
    writeExtensionFileAtomic(manifestPath, doc.toString(), false, options.observeWrite);
    result.changed = true;
  };
  const declared = declaredAbilities(bundle, projectRoot, relative, doc);
  const owners = (): Array<[string, Installation]> => Object.keys(mapping(rawManifest(doc).installations))
    .map(id => [id, readInstallation(doc, id)!]);
  const setSkill = (id: string, provided: boolean): void => {
    const raw = mapping(rawManifest(doc).provides).skills;
    const current = Array.isArray(raw) ? raw : [];
    doc.setIn(['provides', 'skills'], provided ? [...new Set([...current, id])] : current.filter(value => value !== id));
  };

  if (action === 'install') {
    if (!options.source) throw new Error('用法：install <本地目录> [能力ID]');
    const input = sourcesForInstall({ ...options, projectRoot, frameworkRoot, root, source: options.source });
    const plannedFiles = new Map<string, InstallFile & { target: string; prior?: string }>();
    const changedOwnedResources = new Set<string>();
    migrateHost(doc, bundle, projectRoot, relative);
    for (const ability of input.abilities) {
      const { id } = ability;
      const previous = readInstallation(doc, id);
      if (previous && (previous.source !== input.name || Boolean(previous.in_place) !== input.inPlace)) {
        throw new Error(`能力 ${id} 已来自 ${previous.source}，请保留原来源或先卸载其归属`);
      }
      if (!previous && declared.has(id) && !input.inPlace) {
        throw new Error(`能力 ${id} 已有宿主声明，保留该声明及文件`);
      }
      let files = { ...previous?.files };
      for (const [sourceRel, item] of ability.files) {
        if (input.inPlace) {
          result.retained.push({ path: relativeExtensionPath(projectRoot, path.join(root, sourceRel)), reason: '原地来源文件' });
          continue;
        }
        const target = ordinaryFile(root, sourceRel);
        const hostRel = relativeExtensionPath(projectRoot, target);
        const prior = own(previous?.files ?? {}, hostRel);
        const other = owners().filter(([owner, entry]) => owner !== id && own(entry.files, hostRel));
        if (other.some(([, entry]) => entry.files[hostRel] !== item.sha256)) {
          throw new Error(`文件被其他能力拥有，保留：${hostRel}`);
        }
        const actual = fs.existsSync(target) ? digest(fs.readFileSync(target)) : undefined;
        if (actual && !prior && !other.length) throw new Error(`已有文件无本次安装归属，保留：${hostRel}`);
        if (actual && actual !== item.sha256 && actual !== prior) {
          if (item.sha256 === prior) {
            result.retained.push({ path: hostRel, reason: '文件已被宿主修改，来源内容未变' });
            continue;
          }
          throw new Error(`文件已被宿主修改且来源已有不同内容，保留：${hostRel}`);
        }
        if (plannedFiles.get(hostRel)?.sha256 !== undefined && plannedFiles.get(hostRel)?.sha256 !== item.sha256) {
          throw new Error(`多个能力声明了不同的文件内容：${hostRel}`);
        }
        if (actual !== item.sha256) {
          plannedFiles.set(hostRel, { ...item, target, prior: actual });
          if (prior && prior !== item.sha256) changedOwnedResources.add(hostRel);
        }
        files = { ...files, [hostRel]: item.sha256 };
      }
      for (const [actionId, definition] of Object.entries(ability.mcpActions)) {
        const existing = own(mapping(mapping(rawManifest(doc).provides).mcp_actions), actionId);
        if (existing === undefined) doc.setIn(['provides', 'mcp_actions', actionId], definition);
        else if (!isDeepStrictEqual(existing, definition)) throw new Error(`宿主已有不同的 provides.mcp_actions.${actionId}`);
      }
      const selections = { ...previous?.bindings };
      for (const [id, raw] of Object.entries(mapping(ability.bindings))) {
        if (BINDING_ID.test(id) && own(selections, id) === undefined) {
          Object.defineProperty(selections, id, { value: !previous && mapping(raw).enabled_by_default === true, enumerable: true });
        }
      }
      doc.setIn(['installations', id], {
        source: input.name, enabled: previous?.enabled ?? true, bindings: selections, files,
        ...(input.inPlace ? { in_place: true } : {}),
      });
      if (ability.skill) setSkill(id, true);
      if (ability.bindings !== undefined) doc.setIn(['bindings', id], ability.bindings);
      else if (previous && !input.inPlace) doc.deleteIn(['bindings', id]);
      result.abilities.push(id);
    }
    const blockers = activeExtensionResourceRequests(projectRoot, [...changedOwnedResources]);
    if (blockers.requestIds.length) return {
      ...result, requestIds: blockers.requestIds,
      retained: blockers.paths.map(file => ({ path: file, reason: '在途请求仍使用已安装资源' })),
    };
    // Existing files retain their old receipt until replacement. New targets get a receipt before creation.
    for (const [hostRel, item] of plannedFiles) {
      if (!item.prior) continue;
      if (digest(fs.readFileSync(item.target)) !== item.prior) throw new Error(`安装期间文件已变化，保留：${hostRel}`);
      writeExtensionFileAtomic(item.target, item.bytes, false, options.observeWrite);
      result.filesWritten.push(hostRel);
    }
    save();
    for (const [hostRel, item] of plannedFiles) {
      if (item.prior) continue;
      writeExtensionFileAtomic(item.target, item.bytes, true, options.observeWrite);
      result.filesWritten.push(hostRel);
    }
    return result;
  }

  const ability = options.ability;
  if (!ability || !TOKEN.test(ability)) throw new Error(`用法：${action} <能力ID>${action === 'uninstall' ? '' : ' [绑定ID]'}`);
  result.abilities.push(ability);
  if (!declared.has(ability)) {
    if (action === 'uninstall') return result;
    throw new Error(`宿主没有能力：${ability}`);
  }

  const previous = readInstallation(doc, ability);
  const selection: Installation = previous ?? { source: bundle.manifestName ?? 'project-extensions', enabled: true, bindings: {}, files: {}, in_place: true };

  if (action === 'uninstall') {
    const requestIds = activeExtensionRequests(projectRoot, ability, selection.source);
    if (requestIds.length > 0) return { ...result, requestIds };
    migrateHost(doc, bundle, projectRoot, relative);
    for (const [hostRel, sha256] of Object.entries(selection.files)) {
      let target: string;
      try {
        const hostPath = path.resolve(projectRoot, validateProjectRelativePath(projectRoot, hostRel, '归属文件'));
        const resource = relativeExtensionPath(root, hostPath);
        if (resource === MANIFEST || resource.startsWith('.manifest.lock')) throw new Error('管理文件');
        target = ordinaryFile(root, resource);
      } catch {
        result.retained.push({ path: hostRel, reason: '归属路径不可安全清理' });
        continue;
      }
      if (!fs.existsSync(target)) continue;
      if (owners().some(([id, entry]) => id !== ability && own(entry.files, hostRel))) {
        result.retained.push({ path: hostRel, reason: '共享归属' });
      } else if (digest(fs.readFileSync(target)) !== sha256) {
        result.retained.push({ path: hostRel, reason: '文件已被宿主修改' });
      } else {
        removeExtensionFile(target, options.observeWrite);
        result.filesRemoved.push(hostRel);
      }
    }
    for (const binding of bundle.bindings.filter(row => row.ability === ability && row.resource === 'mcp' && own(bundle.mcpActions, row.ref))) {
      const ref = `${relativeExtensionPath(projectRoot, manifestPath)}#provides.mcp_actions.${binding.ref}`;
      if (!result.retained.some(item => item.path === ref)) result.retained.push({ path: ref, reason: '保留可能由其他宿主声明使用的 MCP 配置' });
    }
    // Leave compatibility declarations intact; their original meaning is preserved by the host selection.
    const legacyBindings = bundle.bindings.some(row => row.ability === ability && own(nativeBindings(doc, ability), row.id) === undefined);
    const skillDirectory = path.join(root, 'skills', ability);
    const listRemaining = (directory: string): void => {
      if (!fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const hostRel = relativeExtensionPath(projectRoot, file);
        if (entry.isDirectory()) listRemaining(file);
        else if (!own(selection.files, hostRel)) {
          result.retained.push({ path: hostRel, reason: '原地来源或不属于本次安装' });
        }
      }
    };
    try { listRemaining(ordinaryPath(root, relativeExtensionPath(root, skillDirectory), 'extension skill')); }
    catch {
      result.retained.push({ path: relativeExtensionPath(projectRoot, skillDirectory), reason: '无法安全枚举，保留原路径' });
    }
    if (legacyBindings || selection.in_place) {
      doc.setIn(['installations', ability], { ...selection, enabled: false, files: {}, in_place: true });
    } else {
      doc.deleteIn(['installations', ability]);
      setSkill(ability, false);
      doc.deleteIn(['bindings', ability]);
    }
    save();
    return result;
  }

  const binding = options.binding;
  const native = nativeBindings(doc, ability);
  if (binding && (!BINDING_ID.test(binding) || own(native, binding) === undefined
    && !bundle.bindings.some(row => row.ability === ability && row.id === binding))) {
    throw new Error(`能力 ${ability} 没有绑定：${binding}`);
  }
  const enabled = action === 'enable';
  // Explicitly seed a manual v2 ability's existing defaults when it acquires a host selection.
  const bindings = previous ? selection.bindings : Object.fromEntries(Object.entries(native).filter(([key]) => BINDING_ID.test(key)).map(([key, value]) => [
    key, mapping(value).enabled_by_default === true,
  ]));
  migrateHost(doc, bundle, projectRoot, relative);
  doc.setIn(['installations', ability], binding
    ? { ...selection, bindings: { ...bindings, [binding]: enabled } }
    : { ...selection, bindings, enabled });
  save();
  return result;
}
