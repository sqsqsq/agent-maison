import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import * as YAML from 'yaml';

import { loadFrameworkConfig } from '../../config';
import {
  loadInstanceExtensions, loadInstanceExtensionSource, readExtensionTimings, validateExtensionManifestRoot,
} from '../../extension-loader';
import { harnessRootFromLayout, inferRepoLayout } from '../../repo-layout';
import {
  extensionActivationDrift, extensionActivationInputDigest, runExtensionActivation, undoExtensionActivation, extensionActivationNeedsCleanup,
  isExtensionActivationOutput, validateExtensionActivationFiles, validateExtensionActivationOwnership,
  type ExtensionActivationPreview, type ExtensionActivationResult, type ExtensionActivationStep,
} from './extension-activation';
import { scanExtensionSkills } from './instance-skill-bridge';
import { extensionRequestsUsingAbility, extensionRequestsUsingResources, type InactiveExtensionRequest } from './extension-requests';
import { releaseLock, tryAcquireLock } from './goal-run-lock';
import { isInsideProjectRoot, realProjectPath, validateProjectRelativePath } from './project-relative-path';
import { ordinaryFile, ordinaryPath, relativeExtensionPath, removeExtensionFile, writeExtensionFileAtomic, type ObserveExtensionWrite } from './extension-files';
import type { ExtensionPendingCleanup as PendingCleanup } from './types';

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
  version?: string;
  binding_overrides?: Record<string, { at: string; phase?: string }>;
  pending_cleanup?: PendingCleanup;
  activation_result?: ExtensionActivationResult;
}

interface InstallFile {
  bytes: Buffer;
  sha256: string;
}

const TOKEN = /^[a-zA-Z0-9_-]+$/;
const BINDING_ID = /^[a-z][a-z0-9_-]*$/;
const MANIFEST = 'manifest.yaml';
const SHA256 = /^[a-f0-9]{64}$/;

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
  try {
    const layout = inferRepoLayout(projectRoot);
    if (layout.kind === 'consumer' || fs.existsSync(path.join(harnessRootFromLayout(layout), 'harness-runner.ts'))) {
      return layout.frameworkRoot;
    }
  } catch { /* An external test or project can explicitly supply its framework without a local tree. */ }
  return invokingFrameworkRoot;
}

function targetManifestVersions(frameworkRoot: string): unknown[] {
  const schemaPath = path.join(frameworkRoot, 'specs', 'instance-extension-manifest.schema.yaml');
  let schema: Data;
  try { schema = mapping(YAML.parse(fs.readFileSync(schemaPath, 'utf8'))); }
  catch { throw new Error(`无法读取目标 Maison 发布件的扩展协议：${schemaPath}，宿主清单保留`); }
  const advertised = mapping(mapping(mapping(schema.root_object).properties).schema_version).enum;
  if (!Array.isArray(advertised) || !advertised.includes('2.0')) {
    throw new Error(`目标 Maison 发布件无法读取 extension manifest 2.0：${frameworkRoot}，宿主清单保留`);
  }
  return advertised;
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

export class ExtensionWriteBusyError extends Error {}

export function withExtensionWrite<T>(projectRoot: string, frameworkRoot: string, work: () => T): T {
  const { root } = extensionLocation(projectRoot, frameworkRoot);
  const lockPath = ordinaryFile(root, '.manifest.lock');
  const lock = tryAcquireLock(lockPath, {});
  if (!lock) throw new ExtensionWriteBusyError('同一宿主正在更新扩展，请在本次操作结束后重试');
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

function deleteNativeBindings(doc: Document, ability: string): void {
  // YAML deleteIn throws when the optional bindings map is absent.
  if (own(mapping(rawManifest(doc).bindings), ability) !== undefined) doc.deleteIn(['bindings', ability]);
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
    || Object.values(files).some(value => typeof value !== 'string' || !SHA256.test(value))
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
    ...Object.keys(mapping(raw.activation)),
    ...Object.keys(mapping(raw.installations)),
  ]);
}

function legacyIgnoredFields(doc: Document): string[] {
  return [
    ...(doc.has('phase_bindings') ? ['phase_bindings'] : []),
    ...(doc.hasIn(['provides', 'mcp_actions']) ? ['provides.mcp_actions'] : []),
  ];
}

function migrateHost(doc: Document, bundle: Bundle, projectRoot: string, relative: string): string[] {
  if (bundle.manifestVersion === '2.0' || bundle.manifestVersion === '2.1') return [];
  const removed = bundle.manifestVersion === '1.0' ? legacyIgnoredFields(doc) : [];
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
  return removed;
}

interface IncomingAbility {
  id: string;
  skill: boolean;
  bindings?: unknown;
  activation?: unknown;
  steps: ExtensionActivationStep[];
  mcpActions: Data;
  files: Map<string, InstallFile>;
  issues?: string[];
}

function sourceTreeFiles(sourceRoot: string, directory: string, excludes: readonly string[], addFile: (relative: string) => void): void {
  const sourceDirectory = directory ? ordinaryPath(sourceRoot, directory, 'extension skill') : sourceRoot;
  const entry = fs.lstatSync(sourceDirectory, { throwIfNoEntry: false });
  if (!entry) return;
  if (!entry.isDirectory()) throw new Error(`skill 资源必须是目录：${directory}`);
  for (const child of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const resource = path.posix.join(directory, child.name);
    if (excludes.includes(resource)) continue;
    if (child.isDirectory()) sourceTreeFiles(sourceRoot, resource, excludes, addFile);
    else addFile(resource);
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
  root: string;
  version?: string;
  bare?: true;
  inPlace: boolean;
  ignoredFields: string[];
  abilities: IncomingAbility[];
} {
  const resolvedSource = path.resolve(input.source);
  if (!fs.lstatSync(resolvedSource, { throwIfNoEntry: false }) || !fs.statSync(resolvedSource).isDirectory()) {
    throw new Error('install 来源必须是包含 manifest.yaml 或 SKILL.md 的本地目录');
  }
  const sourceRoot = fs.realpathSync(resolvedSource);
  const inPlace = input.root === sourceRoot;
  if (!inPlace && (isInsideProjectRoot(input.root, sourceRoot) || isInsideProjectRoot(sourceRoot, input.root))) {
    throw new Error('install 来源与宿主扩展目录不能互相包含');
  }
  if (!fs.lstatSync(path.join(sourceRoot, MANIFEST), { throwIfNoEntry: false })) {
    const bareFile = ordinaryFile(sourceRoot, 'SKILL.md');
    if (inPlace || !fs.existsSync(bareFile)) throw new Error('来源清单不可用：缺少 manifest.yaml 或裸 Skill SKILL.md');
    const markdown = fs.readFileSync(bareFile, 'utf8');
    const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
    let id: unknown;
    if (frontmatter) id = mapping(YAML.parse(frontmatter[1])).name;
    if (typeof id !== 'string' || !TOKEN.test(id) || markdown.slice(frontmatter?.[0].length).trim() === '') {
      throw new Error('裸 Skill 的 SKILL.md 须包含合法的 frontmatter name 和使用说明');
    }
    if (input.ability && input.ability !== id) throw new Error(`来源没有能力：${input.ability}`);
    const files = new Map<string, InstallFile>();
    sourceTreeFiles(sourceRoot, '', [], relative => {
      const bytes = fs.readFileSync(ordinaryFile(sourceRoot, relative));
      files.set(path.posix.join('skills', id, relative), { bytes, sha256: digest(bytes) });
    });
    return { name: `bare-skill:${id}`, root: sourceRoot, bare: true, inPlace, ignoredFields: [],
      abilities: [{ id, skill: true, steps: [], mcpActions: {}, files }] };
  }
  const doc = readManifest(sourceRoot);
  const source = loadInstanceExtensionSource(sourceRoot, input.projectRoot, { frameworkRoot: input.frameworkRoot });
  if (!source.manifestPath || !source.manifestUsable || !source.manifestName) {
    throw new Error(`来源清单不可用：${source.errors.map(item => item.message).join('；') || '缺少 manifest.yaml'}`);
  }
  const raw = rawManifest(doc);
  const activation = mapping(raw.activation);
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
    : [...new Set([...skills, ...Object.keys(native), ...legacy.keys(), ...Object.keys(activation)])].sort();
  if (ids.length === 0) throw new Error('来源没有可安装的能力');
  const abilities: IncomingAbility[] = ids.map(id => {
    try {
    const skill = skills.has(id);
    const declared = own(native, id);
    const migrated = legacy.get(id);
    const activationDefinition = own(activation, id);
    const steps = own(source.activations, id) ?? [];
    if (!TOKEN.test(id) || (declared === undefined && !skill && !migrated && activationDefinition === undefined)) {
      throw new Error(`来源没有能力：${id}`);
    }
    const issues = source.errors.filter(error => error.ability === id && error.code.startsWith('activation_'))
      .map(error => error.message);
    const value = input.root === sourceRoot ? declared
      : migrated && (declared === undefined || declared === mapping(declared)) ? { ...migrated, ...mapping(declared) } : declared;
    const mcpActions: Data = {};
    const files = new Map<string, InstallFile>();
    const outputs = steps.flatMap(step => step.outputs);
    const generated = (relative: string): boolean => outputs.some(output => relative === output || relative.startsWith(output + '/'));
    const addFile = (relative: string): void => {
      if (generated(relative)) return;
      const file = ordinaryFile(sourceRoot, relative);
      const key = relativeExtensionPath(sourceRoot, file);
      if (key === MANIFEST || key.startsWith('.manifest.lock')) throw new Error(`绑定不可将管理文件声明为资源：${relative}`);
      if (!fs.existsSync(file)) return;
      const bytes = fs.readFileSync(file);
      files.set(key, { bytes, sha256: digest(bytes) });
    };
    const addSkill = (slug: string): void => {
      sourceTreeFiles(sourceRoot, `skills/${slug}`, outputs, addFile);
    };
    if (skill || steps.length) addSkill(id);
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
    return { id, skill, bindings: value, activation: activationDefinition, steps, mcpActions, files, issues };
    } catch (error) {
      return { id, skill: false, steps: [], mcpActions: {}, files: new Map(), issues: [(error as Error).message] };
    }
  });
  const ignoredFields = !inPlace && source.manifestVersion === '1.0' ? legacyIgnoredFields(doc) : [];
  return { name: source.manifestName, root: sourceRoot, version: typeof raw.version === 'string' ? raw.version.trim() || undefined : undefined,
    inPlace, ignoredFields, abilities };
}

export interface ExtensionLifecycleResult {
  abilities: string[];
  changed: boolean;
  filesWritten: string[];
  filesRemoved: string[];
  retained: Array<{ path: string; reason: string }>;
  outcomes: Array<{
    ability: string;
    state: 'installed' | 'enabled' | 'disabled' | 'pending' | 'failed' | 'uninstalled';
    reason?: string;
    activation?: ExtensionActivationResult;
    pending?: PendingCleanup;
    incompatibleBindings?: Array<{ id: string; issue: string }>;
  }>;
  requestIds?: string[];
  inactiveRequests?: InactiveExtensionRequest[];
  migration?: { hostRemoved?: string[]; sourceIgnored?: string[] };
}

interface ChangeOptions {
  projectRoot: string;
  frameworkRoot: string;
  source?: string;
  ability?: string;
  binding?: string;
  noEnable?: boolean;
  at?: string;
  phase?: string;
  observeWrite?: ObserveExtensionWrite;
  preview?: (notice: ExtensionActivationPreview) => void;
  closeEntries?: () => void;
}

function resourceTarget(root: string, resource: string): string {
  const target = ordinaryFile(root, resource);
  const relative = relativeExtensionPath(root, target);
  if (relative.toLowerCase() === MANIFEST || relative.toLowerCase().startsWith('.manifest.')) {
    throw new Error(`资源路径属于扩展管理入口：${resource}`);
  }
  return target;
}

function ownedResource(projectRoot: string, root: string, hostRelative: string): string {
  const target = path.resolve(projectRoot, validateProjectRelativePath(projectRoot, hostRelative, '归属文件'));
  return relativeExtensionPath(root, resourceTarget(root, relativeExtensionPath(root, target)));
}

interface ReplacementFile {
  path: string;
  before?: InstallFile;
  after?: InstallFile;
}

function existingFile(target: string): InstallFile | undefined {
  if (!fs.existsSync(target)) return;
  const bytes = fs.readFileSync(target);
  return { bytes, sha256: digest(bytes) };
}

function applyReplacement(root: string, files: ReplacementFile[], observe?: ObserveExtensionWrite): void {
  for (const { path: resource, before, after } of files) {
    const target = resourceTarget(root, resource);
    if (existingFile(target)?.sha256 !== before?.sha256) throw new Error(`安装期间文件已变化，保留：${resource}`);
    if (after) writeExtensionFileAtomic(target, after.bytes, !before, observe);
    else removeExtensionFile(target, observe);
  }
}

function replacementStage(ability: string): string {
  return `.manifest.replacement-${ability}`;
}

function clearReplacementStage(root: string, ability: string): void {
  const directory = ordinaryPath(root, replacementStage(ability), '扩展升级暂存目录');
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) {
    if (!/^\d+\.backup$/.test(entry)) throw new Error(`保留升级暂存目录内的未知文件：${entry}`);
    fs.unlinkSync(ordinaryFile(directory, entry));
  }
  fs.rmdirSync(directory);
}

function stageReplacement(root: string, ability: string, files: ReplacementFile[]): NonNullable<PendingCleanup['replacement']> {
  clearReplacementStage(root, ability);
  const stage = replacementStage(ability);
  return { stage, files: files.map(({ path: resource, before, after }, index) => {
    if (before) writeExtensionFileAtomic(ordinaryFile(root, `${stage}/${index}.backup`), before.bytes, true);
    return { path: resource, ...(before ? { before: before.sha256 } : {}), ...(after ? { after: after.sha256 } : {}) };
  }) };
}

function restoreReplacement(root: string, ability: string, replacement: NonNullable<PendingCleanup['replacement']>,
  observe?: ObserveExtensionWrite): void {
  if (replacement.stage !== replacementStage(ability)) throw new Error('升级暂存目录与能力归属不符');
  const changes: ReplacementFile[] = [];
  const conflicts: string[] = [];
  for (const [index, row] of replacement.files.entries()) {
    const target = resourceTarget(root, row.path);
    const current = existingFile(target);
    if (current?.sha256 === row.before) continue;
    if (current?.sha256 !== row.after) {
      conflicts.push(`升级中断后文件有人工修改，保留：${row.path}`);
      continue;
    }
    const backup = row.before && existingFile(ordinaryFile(root, `${replacement.stage}/${index}.backup`));
    if (row.before && (!backup || backup.sha256 !== row.before)) {
      conflicts.push(`无法核实升级备份：${row.path}`);
      continue;
    }
    changes.push({ path: row.path, before: current, after: backup || undefined });
  }
  applyReplacement(root, changes, observe);
  if (conflicts.length) throw new Error(conflicts.join('；'));
}

function samePending(a: PendingCleanup, b: PendingCleanup): boolean {
  return a.operation === b.operation && a.binding === b.binding && isDeepStrictEqual(a.command, b.command);
}

export function changeExtension(action: ExtensionMutation, options: ChangeOptions): ExtensionLifecycleResult {
  const { projectRoot } = options;
  const frameworkRoot = targetExtensionFrameworkRoot(projectRoot, options.frameworkRoot);
  const supports21 = targetManifestVersions(frameworkRoot).includes('2.1');
  const { relative, root } = extensionLocation(projectRoot, frameworkRoot);
  const doc = readManifest(root);
  let persisted = structuredClone(doc.toJS());
  const { at, phase, binding } = options;
  const hasTimingChoice = at !== undefined || phase !== undefined;
  const load = (candidate = doc, allowPendingGenerated = false): Bundle =>
    loadInstanceExtensions(projectRoot, relative, { frameworkRoot, manifestRaw: candidate.toJS(), allowPendingGenerated });
  const bundle = loadInstanceExtensions(projectRoot, relative, { frameworkRoot });
  if (!bundle.manifestUsable) throw new Error(`宿主扩展清单不可用：${bundle.errors.map(item => item.message).join('；')}`);
  if (!supports21 && (bundle.manifestVersion === '2.1' || hasTimingChoice)) {
    throw new Error(`目标 Maison 发布件无法读取 extension manifest 2.1：${frameworkRoot}，宿主清单保留`);
  }
  if (hasTimingChoice && (action !== 'enable' || !binding || at !== undefined && !at.trim() || phase !== undefined && !phase.trim())) {
    throw new Error('--at 和 --phase 仅用于 enable <能力ID> <绑定ID>');
  }
  const result: ExtensionLifecycleResult = { abilities: [], changed: false, filesWritten: [], filesRemoved: [], retained: [], outcomes: [] };
  const manifestPath = ordinaryFile(root, MANIFEST);
  let persistedDigest = existingFile(manifestPath)?.sha256;
  const save = (candidate = doc): void => {
    const raw = candidate.toJS();
    if (isDeepStrictEqual(persisted, raw)) return;
    if (existingFile(ordinaryFile(root, MANIFEST))?.sha256 !== persistedDigest) throw new Error('操作期间扩展清单已被外部修改，保留现有清单');
    const content = Buffer.from(candidate.toString());
    writeExtensionFileAtomic(manifestPath, content, false, options.observeWrite);
    persisted = structuredClone(raw);
    persistedDigest = digest(content);
    result.changed = true;
  };
  const declared = declaredAbilities(bundle, projectRoot, relative, doc);
  const owners = (candidate = doc): Array<[string, Installation]> => Object.keys(mapping(rawManifest(candidate).installations))
    .map(id => [id, readInstallation(candidate, id)!]);
  const setInstallation = (ability: string, installation: Installation, candidate = doc): void => {
    candidate.setIn(['installations', ability], candidate.createNode(installation));
  };
  const setSkill = (id: string, provided: boolean, candidate = doc): void => {
    const raw = mapping(rawManifest(candidate).provides).skills;
    const current = Array.isArray(raw) ? raw : [];
    const next = provided ? [...new Set([...current, id])] : current.filter(value => value !== id);
    if (raw !== undefined || next.length) candidate.setIn(['provides', 'skills'], next);
  };
  const observeResources: ObserveExtensionWrite = change => {
    options.observeWrite?.(change);
    const file = relativeExtensionPath(projectRoot, change.path);
    if (change.post_sha256 === null) result.filesRemoved.push(file);
    else result.filesWritten.push(file);
  };
  const addUsage = ({ requestIds, inactiveRequests }: ReturnType<typeof extensionRequestsUsingAbility>): void => {
    if (requestIds.length) result.requestIds = [...new Set([...(result.requestIds ?? []), ...requestIds])].sort();
    if (inactiveRequests.length) result.inactiveRequests = [...new Map([...(result.inactiveRequests ?? []), ...inactiveRequests]
      .map(row => [row.requestFile, row])).values()];
  };
  const pendingUsage = (ability: string, selection: Installation, pending: PendingCleanup): boolean => {
    const usage = extensionRequestsUsingAbility(projectRoot, ability, selection.source, pending.binding);
    addUsage(usage);
    if (!usage.requestIds.length) return false;
    result.outcomes.push({ ability, state: 'pending', pending });
    return true;
  };
  const relativeOwnership = (file: string): string => relativeExtensionPath(root,
    path.resolve(projectRoot, validateProjectRelativePath(projectRoot, file, '归属文件')));
  const protectedResources = (candidate = doc): string[] => owners(candidate).flatMap(([, item]) =>
    Object.keys(item.files).map(relativeOwnership));
  const context = (ability: string, selection: Installation) => ({
    projectRoot, extensionRoot: root, ability, version: selection.version, protectedFiles: protectedResources(),
    sourceFiles: Object.fromEntries(Object.entries(selection.files).map(([file, sha256]) => [relativeOwnership(file), sha256])),
    observeWrite: observeResources, preview: options.preview,
    persist: (latest: ExtensionActivationResult) => {
      selection.activation_result = latest;
      setInstallation(ability, selection);
      save();
    },
  });
  const retainedSteps = (activation?: ExtensionActivationResult): void => {
    for (const change of activation?.residuals ?? []) {
      result.retained.push({ path: change.path, reason: `启用命令越界写入：${change.how}` });
    }
  };
  const activate = (ability: string, selection: Installation, steps: ExtensionActivationStep[]): ExtensionActivationResult | undefined => {
    if (!steps.length) return undefined;
    const activated = runExtensionActivation(context(ability, selection), steps, selection.activation_result);
    retainedSteps(activated);
    return activated;
  };
  const deactivate = (ability: string, selection: Installation, steps: ExtensionActivationStep[]): ExtensionActivationResult | undefined => {
    if (!steps.length || !selection.activation_result) return undefined;
    const stopped = undoExtensionActivation(context(ability, selection), steps, selection.activation_result);
    retainedSteps(stopped);
    return stopped;
  };
  const selectAndSave = (ability: string, selection: Installation): void => {
    setInstallation(ability, selection);
    save();
  };
  const close = (ability: string, selection: Installation, pending: PendingCleanup): void => {
    if (pending.binding) selection.bindings = { ...selection.bindings, [pending.binding]: false };
    else selection.enabled = false;
    if (supports21) selection.pending_cleanup = pending;
    selectAndSave(ability, selection);
    if (!pending.binding && selection.activation_result) options.closeEntries?.();
  };
  const incompatible = (ability: string, selection: Installation, next = load(doc, true)) =>
    Object.keys(selection.binding_overrides ?? {}).flatMap(id => {
      const row = next.bindings.find(item => item.ability === ability && item.id === id);
      const issue = row?.issue ?? (!row ? '新版不再声明此绑定' : undefined);
      return issue ? [{ id, issue }] : [];
    });

  function enableAbility(ability: string, selection: Installation, steps: ExtensionActivationStep[]): boolean {
    if (!steps.length) {
      selection.enabled = true;
      delete selection.pending_cleanup;
      selectAndSave(ability, selection);
      return true;
    }
    if (selection.enabled && selection.activation_result?.status === 'enabled'
      && selection.activation_result.input_sha256 === extensionActivationInputDigest(context(ability, selection), steps)
      && !extensionActivationDrift(root, selection.activation_result).length) return true;
    const wasEnabled = selection.enabled;
    if (wasEnabled) {
      selection.enabled = false;
      selectAndSave(ability, selection);
      options.closeEntries?.();
    }
    if (selection.activation_result) {
      const usage = extensionRequestsUsingAbility(projectRoot, ability, selection.source);
      if (usage.requestIds.length) {
        selection.enabled = wasEnabled;
        selectAndSave(ability, selection);
        addUsage(usage);
        result.outcomes.push({ ability, state: 'pending', reason: '扩展效果仍被原请求占用，交回后重试启用' });
        return false;
      }
    }
    const activation = activate(ability, selection, steps);
    if (activation?.status === 'enabled') {
      const candidate = doc.clone();
      setInstallation(ability, { ...selection, enabled: true }, candidate);
      const actual = load(candidate);
      const unavailable = actual.bindings.filter(row => row.ability === ability && !row.enabled && row.selected && row.issue
        && (!own(selection.binding_overrides ?? {}, row.id) || row.absPath));
      if (!actual.manifestUsable || unavailable.length) {
        const failure = unavailable.length ? unavailable.map(row => `${row.id}：${row.issue}`).join('；')
          : actual.errors.map(row => row.message).join('；');
        const stopped = deactivate(ability, selection, steps)!;
        selection.activation_result = { ...stopped, status: 'failed', failure };
      } else selection.enabled = true;
    }
    delete selection.pending_cleanup;
    selectAndSave(ability, selection);
    if (!selection.enabled) {
      result.outcomes.push({ ability, state: 'failed', reason: selection.activation_result?.failure, activation: selection.activation_result });
      return false;
    }
    return true;
  }

  function installOne(input: ReturnType<typeof sourcesForInstall>, incoming: IncomingAbility): void {
    const { id } = incoming;
    if (incoming.issues?.length) throw new Error(incoming.issues.join('；'));
    const previous = readInstallation(doc, id);
    if (previous && (previous.source !== input.name || Boolean(previous.in_place) !== input.inPlace)) {
      throw new Error(`能力 ${id} 已来自 ${previous.source}，请保留原来源或先卸载其归属`);
    }
    if (!previous && declared.has(id) && !input.inPlace) throw new Error(`能力 ${id} 已有宿主声明，保留该声明及文件`);
    const command = ['install', input.root, ...(options.ability ? [id] : []), ...(options.noEnable ? ['--no-enable'] : [])];
    const pending: PendingCleanup = {
      operation: 'install', command, restore_enabled: previous?.pending_cleanup?.restore_enabled ?? previous?.enabled ?? !options.noEnable,
    };
    if (previous?.pending_cleanup) {
      const old = previous.pending_cleanup;
      if (!samePending(old, pending)) {
        if (old.operation === 'uninstall' && pendingUsage(id, previous, old)) return;
        throw new Error(`能力 ${id} 尚有待清理操作，请先重试 ${old.command.join(' ')}`);
      }
      if (old.replacement) {
        restoreReplacement(root, id, old.replacement, observeResources);
        delete old.replacement;
        selectAndSave(id, previous);
        clearReplacementStage(root, id);
      }
    }
    const oldSteps = own(load(doc, true).activations, id) ?? [];
    const version = supports21 ? input.version : undefined;
    const nextBindings = input.bare && previous ? own(mapping(rawManifest(doc).bindings), id) : incoming.bindings;
    const activation = input.bare && previous ? own(mapping(rawManifest(doc).activation), id) : incoming.activation;
    const steps = input.bare && previous ? oldSteps : incoming.steps;
    const incomingFiles = [...incoming.files].filter(([resource]) => !isExtensionActivationOutput(steps, resource));
    const incomingHashes = Object.fromEntries(incomingFiles.map(([file, item]) => [relativeExtensionPath(projectRoot, path.join(root, file)), item.sha256]));
    const newlyStaged = previous?.pending_cleanup?.operation === 'install' && !Object.keys(previous.files).length
      && !oldSteps.length && !bundle.skills.includes(id) && !Object.keys(nativeBindings(doc, id)).length;
    const upgrade = !!previous && !newlyStaged && (previous.version !== version || (oldSteps.length > 0 || steps.length > 0) && !input.bare
      && (!isDeepStrictEqual(previous.files, incomingHashes) && !input.inPlace || !isDeepStrictEqual(oldSteps, steps)
        || !isDeepStrictEqual(nativeBindings(doc, id), mapping(nextBindings))));
    const files = upgrade ? {} as Record<string, string> : { ...previous?.files };
    const priorOwners = owners().filter(([owner]) => owner !== id);
    const oldActivation = previous?.activation_result;
    const driftedOutputs = upgrade && oldActivation?.status === 'enabled' ? extensionActivationDrift(root, oldActivation) : [];
    const retiringOutputs = upgrade && oldActivation?.status === 'enabled'
      ? oldActivation.steps.flatMap(step => step.outputs).filter(out => !driftedOutputs.some(drift => drift.path === out.path)) : [];
    const replacements: ReplacementFile[] = [];
    const changedResources: string[] = [];
    for (const [resource, item] of incomingFiles) {
      const target = resourceTarget(root, resource);
      const hostRel = relativeExtensionPath(projectRoot, target);
      if (input.inPlace) {
        result.retained.push({ path: hostRel, reason: '原地来源文件' });
        continue;
      }
      const prior = own(previous?.files ?? {}, hostRel);
      const other = priorOwners.filter(([, entry]) => own(entry.files, hostRel));
      if (other.some(([, entry]) => entry.files[hostRel] !== item.sha256)) throw new Error(`文件被其他能力拥有，保留：${hostRel}`);
      const retired = retiringOutputs.some(out => resource === out.path || out.kind === 'directory' && resource.startsWith(out.path + '/'));
      const actual = retired ? undefined : existingFile(target);
      if (actual && !prior && !other.length) throw new Error(`已有文件无本次安装归属，保留：${hostRel}`);
      if (actual && actual.sha256 !== item.sha256 && actual.sha256 !== prior) {
        if (item.sha256 !== prior) throw new Error(`文件已被宿主修改且来源已有不同内容，保留：${hostRel}`);
        result.retained.push({ path: hostRel, reason: '文件已被宿主修改，来源内容未变' });
      } else if (actual?.sha256 !== item.sha256) {
        replacements.push({ path: resource, before: actual, after: item });
        if (actual) changedResources.push(hostRel);
      }
      files[hostRel] = item.sha256;
    }
    if (upgrade) for (const [hostRel, sha256] of Object.entries(previous!.files)) {
      if (own(files, hostRel)) continue;
      const resource = ownedResource(projectRoot, root, hostRel);
      const actual = existingFile(resourceTarget(root, resource));
      if (!actual) continue;
      if (priorOwners.some(([, entry]) => own(entry.files, hostRel))) {
        result.retained.push({ path: hostRel, reason: '共享归属' });
      } else if (actual.sha256 !== sha256) {
        result.retained.push({ path: hostRel, reason: '文件已被宿主修改' });
      } else {
        replacements.push({ path: resource, before: actual });
        changedResources.push(hostRel);
      }
    }
    if (activation !== undefined && !supports21) throw new Error(`目标 Maison 发布件无法读取 extension manifest 2.1：${frameworkRoot}，宿主清单保留`);
    const candidate = doc.clone();
    const currentBundle = loadInstanceExtensions(projectRoot, relative, { frameworkRoot });
    const hostRemoved = migrateHost(candidate, currentBundle, projectRoot, relative);
    if (activation !== undefined) candidate.set('schema_version', '2.1');
    if (activation !== undefined) candidate.setIn(['activation', id], activation);
    else if (own(mapping(rawManifest(candidate).activation), id) !== undefined) candidate.deleteIn(['activation', id]);
    for (const [actionId, definition] of Object.entries(incoming.mcpActions)) {
      const existing = own(mapping(mapping(rawManifest(candidate).provides).mcp_actions), actionId);
      if (existing === undefined) candidate.setIn(['provides', 'mcp_actions', actionId], definition);
      else if (!isDeepStrictEqual(existing, definition)) throw new Error(`宿主已有不同的 provides.mcp_actions.${actionId}`);
    }
    const selections = { ...previous?.bindings };
    for (const [bindingId, raw] of Object.entries(mapping(nextBindings))) {
      if (BINDING_ID.test(bindingId) && own(selections, bindingId) === undefined) {
        Object.defineProperty(selections, bindingId, { value: (!previous || newlyStaged) && mapping(raw).enabled_by_default === true, enumerable: true });
      }
    }
    if (incoming.skill) setSkill(id, true, candidate);
    else if (upgrade && !input.inPlace) setSkill(id, false, candidate);
    if (nextBindings !== undefined) candidate.setIn(['bindings', id], nextBindings);
    else if (previous && !input.inPlace) deleteNativeBindings(candidate, id);
    const wanted = pending.restore_enabled === true && !(options.noEnable && (!previous || upgrade));
    const needsActivation = steps.length > 0 && !input.bare && wanted;
    const current = previous ?? { source: input.name, enabled: false, bindings: {}, files: {}, ...(input.inPlace ? { in_place: true as const } : {}) };
    const next: Installation = {
      ...current, files, bindings: selections, source: input.name, enabled: needsActivation ? !upgrade && current.enabled : wanted,
    };
    if (version) next.version = version;
    else delete next.version;
    if (upgrade) delete next.activation_result;
    if (needsActivation && (!next.enabled || current.pending_cleanup)) next.pending_cleanup = pending;
    else delete next.pending_cleanup;
    setInstallation(id, next, candidate);
    const invalid = validateExtensionManifestRoot(candidate.toJS());
    if (invalid.length) throw new Error(invalid.map(error => error.message).join('；'));
    if (steps.length) validateExtensionActivationOwnership(id, steps, protectedResources(candidate));
    if (steps.length && !input.bare) validateExtensionActivationFiles(input.root, id, steps, incomingFiles.map(([file]) => file));
    if (upgrade) {
      close(id, current, pending);
    }
    const usage = extensionRequestsUsingResources(projectRoot, changedResources);
    addUsage(usage);
    if (upgrade ? pendingUsage(id, current, pending) || usage.requestIds.length : usage.requestIds.length) {
      result.retained.push(...usage.paths.map(file => ({ path: file, reason: '在途请求仍使用已安装资源' })));
      if (!result.outcomes.some(row => row.ability === id)) result.outcomes.push({ ability: id, state: 'pending', pending });
      return;
    }
    const durableSwap = supports21 && (upgrade || steps.length > 0);
    let stage: NonNullable<PendingCleanup['replacement']> | undefined;
    try {
      if (durableSwap && replacements.length) stage = stageReplacement(root, id, replacements);
      if (upgrade) {
        const stopped = deactivate(id, current, oldSteps);
        if (stopped && extensionActivationNeedsCleanup(stopped)) {
          clearReplacementStage(root, id);
          result.outcomes.push({ ability: id, state: 'failed', reason: stopped.failure, pending, activation: stopped });
          return;
        }
      }
      if (stage) {
        pending.replacement = stage;
        migrateHost(doc, currentBundle, projectRoot, relative);
        setInstallation(id, { ...current, enabled: false, pending_cleanup: pending });
        save();
      }
      applyReplacement(root, replacements, observeResources);
      if (steps.length) validateExtensionActivationFiles(root, id, steps, protectedResources(candidate));
      if (next.pending_cleanup) next.pending_cleanup = { operation: 'install', command, restore_enabled: wanted };
      setInstallation(id, next, candidate);
      save(candidate);
    } catch (error) {
      if (stage) restoreReplacement(root, id, stage, observeResources);
      else if (replacements.length) {
        const applied = replacements.flatMap(change => existingFile(resourceTarget(root, change.path))?.sha256 === change.after?.sha256
          ? [{ path: change.path, before: change.after, after: change.before }] : []);
        applyReplacement(root, applied, observeResources);
      }
      if (previous && !newlyStaged) {
        delete current.pending_cleanup;
        current.enabled = pending.restore_enabled === true && !oldSteps.length;
        selectAndSave(id, current);
        if (pending.restore_enabled && oldSteps.length) {
          const start = result.outcomes.length;
          const restored = enableAbility(id, current, oldSteps);
          if (!restored) {
            clearReplacementStage(root, id);
            const detail = result.outcomes[start]?.reason;
            result.outcomes.splice(start, 1, { ability: id, state: 'failed',
              reason: `${(error as Error).message}。旧版文件已恢复，旧版启用失败。${detail ?? ''}`, activation: current.activation_result });
            return;
          }
        }
      } else if (stage || newlyStaged) {
        doc.deleteIn(['installations', id]);
        save();
      }
      clearReplacementStage(root, id);
      if (upgrade) {
        result.outcomes.push({ ability: id, state: 'failed', reason: `${(error as Error).message}。已恢复旧版文件和原开关。`, activation: current.activation_result });
        return;
      }
      throw error;
    }
    // The host manifest is the commit point. Subsequent errors belong to the installed version.
    doc.contents = candidate.contents;
    clearReplacementStage(root, id);
    if (hostRemoved.length || input.ignoredFields.length) result.migration = {
      ...(hostRemoved.length ? { hostRemoved } : {}),
      ...(input.ignoredFields.length ? { sourceIgnored: input.ignoredFields } : {}),
    };
    if (needsActivation && !enableAbility(id, next, steps)) return;
    result.outcomes.push({ ability: id, state: next.enabled ? 'enabled' : 'installed', activation: next.activation_result,
      incompatibleBindings: incompatible(id, next) });
  }

  if (action === 'install') {
    if (!options.source) throw new Error('用法：install <本地目录> [能力ID]');
    const input = sourcesForInstall({ ...options, frameworkRoot, root, source: options.source });
    for (const incoming of input.abilities) {
      result.abilities.push(incoming.id);
      try { installOne(input, incoming); }
      catch (error) {
        if (input.abilities.length === 1) throw error;
        result.outcomes.push({ ability: incoming.id, state: 'failed', reason: (error as Error).message });
      }
    }
    return result;
  }

  const ability = options.ability;
  if (!ability || !TOKEN.test(ability)) throw new Error(`用法：${action} <能力ID>${action === 'uninstall' ? '' : ' [绑定ID]'}`);
  if (!declared.has(ability)) {
    if (action === 'uninstall') return result;
    throw new Error(`宿主没有能力：${ability}`);
  }
  result.abilities.push(ability);
  const previous = readInstallation(doc, ability);
  const native = nativeBindings(doc, ability);
  const selected = bundle.bindings.find(row => row.ability === ability && row.id === binding);
  if (binding && (!BINDING_ID.test(binding) || (!own(native, binding) && !selected))) {
    throw new Error(`能力 ${ability} 没有绑定：${binding}`);
  }
  const defaults = Object.fromEntries(Object.entries(native).filter(([id]) => BINDING_ID.test(id))
    .map(([id, value]) => [id, mapping(value).enabled_by_default === true]));
  const selection: Installation = previous ?? { source: bundle.manifestName ?? 'project-extensions', enabled: true,
    bindings: defaults, files: {}, in_place: true };
  const steps = own(bundle.activations, ability) ?? [];
  const pending = selection.pending_cleanup;

  if (action === 'enable') {
    if (pending && !(binding && pending.binding !== undefined && pending.binding !== binding)) {
      throw new Error(`能力 ${ability} 尚有待清理操作，请先重试 ${pending.command.join(' ')}`);
    }
    migrateHost(doc, bundle, projectRoot, relative);
    if (binding) {
      if (hasTimingChoice) {
        const timingId = at?.trim() ?? selected?.at;
        const timing = timingId && readExtensionTimings(frameworkRoot).get(timingId);
        if (!timing) throw new Error(`绑定 ${ability}.${binding} 的时点不可用：${timingId ?? '未声明'}`);
        const chosenPhase = phase?.trim() ?? (timing.scope === 'project' ? undefined : selected?.phase);
        if (timing.scope === 'project' ? chosenPhase : !chosenPhase) {
          throw new Error(`绑定 ${ability}.${binding} 的时点 ${timing.id} 不接受此阶段选择：${chosenPhase ?? '未声明'}`);
        }
        selection.binding_overrides = { ...selection.binding_overrides, [binding]: { at: timing.id, ...(chosenPhase ? { phase: chosenPhase } : {}) } };
        doc.set('schema_version', '2.1');
      }
      selection.bindings = { ...selection.bindings, [binding]: true };
      if (hasTimingChoice) {
        setInstallation(ability, selection);
        const next = load(doc, true).bindings.find(row => row.ability === ability && row.id === binding);
        if (!next || next.issue) throw new Error(`绑定 ${ability}.${binding} 生效阶段不可用：${next?.issue ?? '缺少原绑定声明'}`);
      }
      selectAndSave(ability, selection);
      result.outcomes.push({ ability, state: selection.enabled ? 'enabled' : 'installed' });
    } else if (enableAbility(ability, selection, steps)) {
      result.outcomes.push({ ability, state: 'enabled', activation: selection.activation_result });
    }
    return result;
  }

  const exit: PendingCleanup = { operation: action, ...(binding ? { binding } : {}), command: [action, ability, ...(binding ? [binding] : [])] };
  if (pending && !samePending(pending, exit) && (pending.operation !== 'disable' || action !== 'uninstall')) {
    throw new Error(`能力 ${ability} 尚有待清理操作，请先重试 ${pending.command.join(' ')}`);
  }
  migrateHost(doc, bundle, projectRoot, relative);
  close(ability, selection, exit);
  if (pendingUsage(ability, selection, exit)) return result;
  if (!binding) {
    const stopped = deactivate(ability, selection, steps);
    if (stopped && extensionActivationNeedsCleanup(stopped)) {
      result.outcomes.push({ ability, state: 'failed', reason: stopped.failure, pending: exit, activation: stopped });
      return result;
    }
  }
  delete selection.pending_cleanup;
  if (action === 'disable') {
    selectAndSave(ability, selection);
    result.outcomes.push({ ability, state: 'disabled', activation: selection.activation_result });
    return result;
  }

  const remainingOwners = owners().filter(([id]) => id !== ability);
  const remaining = Object.entries(selection.files).flatMap(([hostRel, sha256]) => {
    let resource: string;
    let target: string;
    try {
      resource = ownedResource(projectRoot, root, hostRel);
      target = resourceTarget(root, resource);
    } catch {
      result.retained.push({ path: hostRel, reason: '归属路径不可安全清理' });
      return [];
    }
    const actual = existingFile(target);
    if (!actual) return [];
    if (remainingOwners.some(([, entry]) => own(entry.files, hostRel))) {
      result.retained.push({ path: hostRel, reason: '共享归属' });
    } else if (actual.sha256 !== sha256) {
      result.retained.push({ path: hostRel, reason: '文件已被宿主修改' });
    } else return [{ path: resource, before: actual }];
    return [];
  });
  applyReplacement(root, remaining, observeResources);
  const legacyBindings = bundle.bindings.some(row => row.ability === ability && own(nativeBindings(doc, ability), row.id) === undefined);
  if (legacyBindings || selection.in_place) {
    setInstallation(ability, { ...selection, enabled: false, files: {}, in_place: true });
  } else {
    doc.deleteIn(['installations', ability]);
    setSkill(ability, false);
    deleteNativeBindings(doc, ability);
    if (doc.hasIn(['activation', ability])) doc.deleteIn(['activation', ability]);
  }
  for (const row of bundle.bindings.filter(item => item.ability === ability && item.resource === 'mcp' && own(bundle.mcpActions, item.ref))) {
    const ref = `${relativeExtensionPath(projectRoot, manifestPath)}#provides.mcp_actions.${row.ref}`;
    if (!result.retained.some(item => item.path === ref)) result.retained.push({ path: ref, reason: '保留可能由其他宿主声明使用的 MCP 配置' });
  }
  try {
    sourceTreeFiles(root, `skills/${ability}`, [], resource => {
      const file = relativeExtensionPath(projectRoot, path.join(root, resource));
      if (!own(selection.files, file)) result.retained.push({ path: file, reason: '原地来源或不属于本次安装' });
    });
  } catch {
    result.retained.push({ path: `${relative}/skills/${ability}`, reason: '无法安全枚举，保留原路径' });
  }
  save();
  result.outcomes.push({ ability, state: 'uninstalled', activation: selection.activation_result });
  return result;
}
