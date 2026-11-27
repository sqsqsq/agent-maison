import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import * as YAML from 'yaml';

import { loadFrameworkConfig } from '../../config';
import { loadInstanceExtensions, loadInstanceExtensionSource, readExtensionTimings, validateExtensionManifestRoot } from '../../extension-loader';
import { harnessRootFromLayout, inferRepoLayout } from '../../repo-layout';
import {
  extensionActivationPathWithin, extensionActivationPathsOverlap, isExtensionActivationOutput, removeDisabledExtensionOutputs,
  runExtensionActivation, undoExtensionActivation,
  validateExtensionActivationFiles, type ExtensionActivationContext, type ExtensionActivationPreview,
  type ExtensionActivationResult, type ExtensionActivationStep,
} from './extension-activation';
import { extensionRequestsUsingAbility, extensionRequestsUsingResources, type InactiveExtensionRequest } from './extension-requests';
import { releaseLock, tryAcquireLock } from './goal-run-lock';
import { isInsideProjectRoot, validateProjectRelativePath } from './project-relative-path';
import {
  assertUnlinkedExtensionTree, extensionFingerprintMatcher, extensionGitPaths, ordinaryFile, ordinaryPath, relativeExtensionPath,
  removeExtensionFile, writeExtensionFileAtomic, type ObserveExtensionWrite,
} from './extension-files';
import type { ExtensionBundle, ExtensionPlugin } from './types';

type Data = Record<string, unknown>;
type Document = ReturnType<typeof YAML.parseDocument>;
export type ExtensionMutation = 'install' | 'enable' | 'disable' | 'uninstall';

interface PluginSelection {
  source: string;
  enabled: boolean;
  bindings: Record<string, boolean>;
  binding_overrides?: Record<string, unknown>;
  files: Record<string, string>;
  in_place?: true;
}

interface InstallFile {
  bytes: Buffer;
  sha256: string;
}

interface InstallSource {
  id: string;
  source: string;
  sourceRoot: string;
  version: string;
  files: Map<string, InstallFile>;
  defaults: Record<string, boolean>;
  steps: ExtensionActivationStep[];
  inPlace: boolean;
}

const TOKEN = /^[a-zA-Z0-9_-]+$/;
const BINDING_ID = /^[a-z][a-z0-9_-]*$/;
const MANIFEST = 'manifest.yaml';
const UPGRADES = '.manifest-upgrades';
const IGNORE_START = '# BEGIN AgentMaison extension management';
const IGNORE_END = '# END AgentMaison extension management';
const LOCAL_DIRECTORIES = new Set(['node_modules', '.npm-cache']);

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
    if (layout.kind === 'consumer' || fs.existsSync(path.join(harnessRootFromLayout(layout), 'harness-runner.ts'))) return layout.frameworkRoot;
  } catch { /* An external project can supply the invoking release. */ }
  return invokingFrameworkRoot;
}

export function assertExtensionTargetProtocol(frameworkRoot: string): void {
  const schemaPath = path.join(frameworkRoot, 'specs', 'instance-extension-manifest.schema.yaml');
  const schema = mapping(YAML.parse(fs.readFileSync(schemaPath, 'utf8')));
  const definitions = mapping(schema.$defs);
  const valid = ['host', 'plugin'].every(kind => {
    const properties = mapping(mapping(definitions[kind]).properties);
    return mapping(properties.kind).const === kind && mapping(properties.schema_version).const === '2.0';
  });
  if (!valid) throw new Error(`目标 Maison 发布件不支持按插件的扩展清单 2.0：${schemaPath}，宿主清单保留`);
}

export function extensionLocation(projectRoot: string, frameworkRoot: string): { relative: string; root: string } {
  const configured = loadFrameworkConfig(projectRoot).paths?.extension_dir ?? 'doc/extensions';
  const relative = validateProjectRelativePath(projectRoot, configured, 'paths.extension_dir');
  const project = fs.realpathSync(projectRoot);
  const root = ordinaryPath(project, relative, 'paths.extension_dir');
  const framework = fs.realpathSync(frameworkRoot);
  if (root === project || project !== framework && isInsideProjectRoot(framework, root)) {
    throw new Error('[extension_dir_path] paths.extension_dir 必须指向宿主内的独立扩展目录');
  }
  return { relative, root };
}

export class ExtensionWriteBusyError extends Error {}

export function withExtensionWrite<T>(projectRoot: string, frameworkRoot: string, work: () => T, wait = false): T {
  const { root } = extensionLocation(projectRoot, frameworkRoot);
  const lockPath = ordinaryFile(root, '.manifest.lock');
  let lock = tryAcquireLock(lockPath, {});
  if (!lock && wait) {
    const clock = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 65_000;
    while (!lock && Date.now() < deadline) {
      Atomics.wait(clock, 0, 0, 60);
      lock = tryAcquireLock(lockPath, {});
    }
  }
  if (!lock) throw new ExtensionWriteBusyError('同一宿主正在更新扩展，请在本次操作结束后重试');
  try { return work(); }
  finally { releaseLock(lockPath, lock.ownerId); }
}

function readManifest(root: string): Document {
  const file = ordinaryFile(root, MANIFEST);
  const document = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  if (document.errors.length) throw new Error(`扩展清单无法解析：${file}：${document.errors.map(error => error.message).join('；')}`);
  return document;
}

function manifestData(doc: Document): Data {
  return mapping(doc.toJS());
}

function writePluginSelection(document: Document, id: string, selection: PluginSelection): void {
  const keys = ['plugins', id];
  const update = (field: string[], old: unknown, next: unknown): void => {
    if (isDeepStrictEqual(old, next)) return;
    if (next !== undefined && next === mapping(next) && YAML.isMap(document.getIn(field, true))) {
      const prior = mapping(old);
      const values = mapping(next);
      for (const key of new Set([...Object.keys(prior), ...Object.keys(values)])) {
        update([...field, key], own(prior, key), own(values, key));
      }
    } else if (next === undefined) {
      document.deleteIn(field);
    } else {
      document.setIn(field, next);
    }
  };
  update(keys, own(mapping(manifestData(document).plugins), id), selection);
}

export function assertExtensionHostWritable(root: string): void {
  if (!fs.existsSync(root)) return;
  const manifest = ordinaryFile(root, MANIFEST);
  if (fs.existsSync(manifest)) {
    const errors = validateExtensionManifestRoot(readManifest(root).toJS(), manifest, 'host');
    if (errors.length) throw new Error(errors.map(item => item.message).join('；'));
  } else if (fs.readdirSync(root).some(name => name !== '.gitignore' && name !== '.manifest.lock')) {
    throw new Error(`旧版扩展未加载，请按需手工整理后重新接入：${root}`);
  }
}

function extensionTextEol(current: string): string {
  return current.match(/\r?\n/)?.[0] ?? '\n';
}

function managedIgnore(root: string): { current: string; start: number; end: number; rules: Map<string, Set<string>> } {
  const file = ordinaryFile(root, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const start = current.search(/^# BEGIN AgentMaison extension management\r?$/m);
  const end = current.search(/^# END AgentMaison extension management\r?$/m);
  if ((start < 0) !== (end < 0) || start >= 0 && end <= start) throw new Error('扩展根 .gitignore 管理标记不完整');
  const rules = new Map<string, Set<string>>();
  let plugin: string | undefined;
  for (const line of (start < 0 ? '' : current.slice(start, end)).split(/\r?\n/)) {
    const marker = /^# plugin: ([a-zA-Z0-9_-]+)$/.exec(line);
    if (marker) {
      plugin = marker[1];
      if (!rules.has(plugin)) rules.set(plugin, new Set());
    } else if (plugin && line.startsWith('/' + plugin + '/')) {
      rules.get(plugin)!.add(line.slice(plugin.length + 2));
    }
  }
  return { current, start, end, rules };
}

export function maintainExtensionIgnore(
  root: string, plugins: Iterable<readonly [string, readonly ExtensionActivationStep[], (readonly string[])?]> = [], observeWrite?: ObserveExtensionWrite,
): boolean {
  const { current, start, end, rules } = managedIgnore(root);
  for (const [id, steps, shared = []] of plugins) {
    const outputs = rules.get(id) ?? new Set<string>();
    const sharedPaths = [...shared, ...steps.filter(step => step.scope === 'repo').flatMap(step => step.outputs)];
    for (const output of outputs) if (sharedPaths.some(file => extensionActivationPathsOverlap(output, file))) outputs.delete(output);
    for (const step of steps) if (step.scope === 'local') for (const output of step.outputs) outputs.add(output);
    rules.set(id, outputs);
  }
  const block = [
    IGNORE_START, '/.manifest.lock*', '/' + UPGRADES + '/', ...[...LOCAL_DIRECTORIES].map(dir => '**/' + dir + '/'),
    ...[...rules].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, paths]) =>
      ['# plugin: ' + id, ...[...paths].sort().map(output => '/' + id + '/' + output)]), IGNORE_END,
  ].join('\n');
  const blockEnd = end + IGNORE_END.length;
  if (start >= 0 && current.slice(start, blockEnd).replace(/\r\n/g, '\n') === block) return false;
  const eol = extensionTextEol(current);
  const rendered = block.replace(/\n/g, eol);
  const updated = start < 0 ? current + (current && !current.endsWith('\n') ? eol : '') + rendered + eol
    : current.slice(0, start) + rendered + current.slice(blockEnd);
  writeExtensionFileAtomic(ordinaryFile(root, '.gitignore'), updated, !fs.existsSync(path.join(root, '.gitignore')), observeWrite);
  return true;
}

export interface ExtensionCleanupEntry {
  plugin: string;
  path: string;
  state: 'removed' | 'retained';
  reason?: string;
}

function cleanupDeleted(projectRoot: string, bundle: ExtensionBundle, observe?: ObserveExtensionWrite): ExtensionCleanupEntry[] {
  if (!bundle.manifestUsable || !bundle.rootDir || !bundle.manifestPath) return [];
  // Read registration keys even when the installed manifest is malformed or absent.
  const registered = mapping(manifestData(readManifest(bundle.rootDir)).plugins);
  const { rules } = managedIgnore(bundle.rootDir);
  const results: ExtensionCleanupEntry[] = [];
  for (const [id, outputs] of rules) {
    if (own(registered, id) !== undefined) continue;
    const dir = path.join(bundle.rootDir, id);
    const found = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!found) continue;
    const relative = relativeExtensionPath(projectRoot, dir);
    try {
      if (!found.isDirectory() || found.isSymbolicLink()) throw new Error('候选不是普通插件目录');
      const tracked = extensionGitPaths(projectRoot, ['ls-files', '-z', '--', relative]);
      if (!tracked) throw new Error('无法用 Git 确认删除归属');
      if (tracked.length) throw new Error('仍有 Git 跟踪资料');
      if (fs.existsSync(path.join(dir, MANIFEST))) throw new Error('仍有插件清单，无法确认为已删除插件');
      const other = extensionGitPaths(projectRoot, ['ls-files', '-z', '--others', '--exclude-standard', '--', relative]);
      if (!other) throw new Error('无法用 Git 核对未忽略资料');
      if (other.length) throw new Error('仍有未忽略资料');
      const visit = (root: string): void => {
        for (const name of fs.readdirSync(root)) {
          const file = path.join(root, name);
          const inside = relativeExtensionPath(dir, file);
          if ([...outputs].some(output => extensionActivationPathWithin(inside, output)) || LOCAL_DIRECTORIES.has(name)) continue;
          const stat = fs.lstatSync(file);
          if (stat.isDirectory()) visit(file);
          else throw new Error(`仍有非受管资料：${inside}`);
        }
      };
      visit(dir);
      assertUnlinkedExtensionTree(dir, true);
      const usage = extensionRequestsUsingAbility(projectRoot, id);
      const resources = extensionRequestsUsingResources(projectRoot, [relative], true);
      const active = [...new Set([...usage.requestIds, ...resources.requestIds])];
      if (active.length) throw new Error(`在途请求仍占用：${active.join(', ')}`);
      if (observe) {
        const walk = (parent: string): void => {
          for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
            const target = path.join(parent, entry.name);
            if (entry.isDirectory()) walk(target);
            else if (entry.isFile()) observe({ path: target, pre_sha256: digest(fs.readFileSync(target)), post_sha256: null });
          }
        };
        // Snapshot only regular files that occur in the same write-observation window.
        walk(dir);
      }
      fs.rmSync(dir, { recursive: true });
      results.push({ plugin: id, path: relative, state: 'removed' });
    } catch (error) {
      results.push({ plugin: id, path: relative, state: 'retained', reason: (error as Error).message });
    }
  }
  return results;
}

function hasDeletedPluginCandidates(bundle: ExtensionBundle): boolean {
  if (!bundle.manifestUsable || !bundle.manifestPath || !bundle.rootDir) return false;
  const root = bundle.rootDir;
  const registered = mapping(manifestData(readManifest(root)).plugins);
  return [...managedIgnore(root).rules.keys()].some(id =>
    own(registered, id) === undefined && fs.lstatSync(path.join(root, id), { throwIfNoEntry: false }));
}

export function cleanupDeletedExtensionPlugins(projectRoot: string, frameworkRoot: string): ExtensionCleanupEntry[] {
  const bundle = loadInstanceExtensions(projectRoot, undefined, { frameworkRoot });
  try {
    if (!hasDeletedPluginCandidates(bundle)) return [];
  } catch (error) {
    return [{ plugin: '', path: bundle.rootDir ?? '', state: 'retained', reason: (error as Error).message }];
  }
  return withExtensionWrite(projectRoot, frameworkRoot, () =>
    cleanupDeleted(projectRoot, loadInstanceExtensions(projectRoot, undefined, { frameworkRoot })), true);
}

function readInstallFile(file: string): InstallFile | undefined {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`扩展来源或归属不是单链接普通文件：${file}`);
  const bytes = fs.readFileSync(file);
  return { bytes, sha256: digest(bytes) };
}

function localPath(relative: string, steps: readonly ExtensionActivationStep[]): boolean {
  return relative.split('/').some(part => LOCAL_DIRECTORIES.has(part))
    || isExtensionActivationOutput(steps.filter(step => step.scope === 'local'), relative);
}

function sourceForInstall(options: ChangeOptions, root: string, before: ExtensionBundle): InstallSource {
  if (!options.source) throw new Error('用法：install <本地目录> [插件ID]');
  const { projectRoot, frameworkRoot } = options;
  const requested = path.resolve(projectRoot, options.source);
  if (!fs.lstatSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('install 来源必须是包含 manifest.yaml 或 SKILL.md 的本地普通目录');
  }
  const sourceRoot = fs.realpathSync(requested);
  if (sourceRoot === root || isInsideProjectRoot(sourceRoot, root)) throw new Error('安装来源不可包含宿主扩展根');
  const manifest = readInstallFile(ordinaryFile(sourceRoot, MANIFEST));
  let raw: Data;
  let id: string;
  let source: string;
  let steps: ExtensionActivationStep[] = [];
  if (manifest) {
    const bundle = loadInstanceExtensionSource(sourceRoot, projectRoot, { frameworkRoot });
    const plugin = Object.values(bundle.plugins)[0];
    const invalidActivation = bundle.errors.find(issue => issue.code.startsWith('activation_'));
    if (!bundle.manifestUsable || !plugin || invalidActivation) {
      throw new Error(`来源清单不可用：${bundle.errors.map(item => item.message).join('；') || sourceRoot}`);
    }
    raw = manifestData(readManifest(sourceRoot));
    id = plugin.id;
    source = isInsideProjectRoot(projectRoot, sourceRoot) ? relativeExtensionPath(projectRoot, sourceRoot) : sourceRoot;
    steps = bundle.activations[id] ?? [];
  } else {
    const skill = readInstallFile(ordinaryFile(sourceRoot, 'SKILL.md'))?.bytes.toString('utf8') ?? '';
    const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(skill);
    const name = frontmatter && mapping(YAML.parse(frontmatter[1])).name;
    if (typeof name !== 'string' || !TOKEN.test(name) || !skill.slice(frontmatter?.[0].length).trim()) {
      throw new Error('裸 Skill 的 SKILL.md 须包含合法的 frontmatter name 和使用说明');
    }
    id = name;
    source = 'bare-skill:' + id;
    const previous = own(before.plugins, id);
    raw = previous?.source === source
      ? manifestData(readManifest(previous.rootDir))
      : { schema_version: '2.0', kind: 'plugin', name: id, version: '0.0.0', provides: { skills: [id] } };
    steps = previous?.source === source ? before.activations[id] ?? [] : [];
  }
  if (options.ability && options.ability !== id) throw new Error(`来源没有插件：${options.ability}`);
  const inPlace = sourceRoot === path.join(root, id);
  if (!inPlace && isInsideProjectRoot(root, sourceRoot)) throw new Error('安装来源位于其他插件或扩展管理目录');
  if (inPlace && !manifest) throw new Error('原地插件须提供包清单');
  const files = new Map<string, InstallFile>();
  const scan = (directory: string): void => {
    const parent = directory ? ordinaryPath(sourceRoot, directory, '插件资源') : sourceRoot;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      const key = manifest ? relative : path.posix.join('skills', id, relative);
      if (entry.name.toLowerCase() === '.git' || localPath(key, steps)) continue;
      if (entry.isDirectory()) scan(relative);
      else files.set(key, readInstallFile(ordinaryFile(sourceRoot, relative))!);
    }
  };
  scan('');
  if (!manifest) {
    const bytes = Buffer.from(YAML.stringify(raw));
    files.set(MANIFEST, { bytes, sha256: digest(bytes) });
  } else {
    const sourceLocal = steps.filter(step => step.scope === 'local').flatMap(step => step.outputs);
    const tracked = extensionGitPaths(sourceRoot, ['ls-files', '-z', '--', '.']) ?? [];
    if (tracked.some(file => sourceLocal.some(output => extensionActivationPathWithin(file, output)))) {
      throw new Error('来源包的 local 输出包含 Git 跟踪文件');
    }
    validateExtensionActivationFiles(sourceRoot, id, steps, files.keys());
  }
  const defaults = Object.fromEntries(Object.entries(mapping(raw.bindings)).map(([key, value]) =>
    [key, mapping(value).enabled_by_default === true]));
  return { id, source, sourceRoot, version: String(raw.version), files, defaults, steps, inPlace };
}

function stagedRoot(root: string, id: string): string {
  return ordinaryPath(root, `${UPGRADES}/${id}`, '待升级插件');
}

export function pendingExtensionUpgrades(bundle: ExtensionBundle): Map<string, string> {
  const pending = new Map<string, string>();
  if (!bundle.rootDir) return pending;
  for (const plugin of Object.values(bundle.plugins)) {
    try {
      const stage = stagedRoot(bundle.rootDir, plugin.id);
      if (!fs.existsSync(stage)) continue;
      const raw = manifestData(readManifest(stage));
      const stagedHash = readInstallFile(ordinaryFile(stage, MANIFEST))?.sha256;
      if (raw.kind !== 'plugin' || raw.name !== plugin.id || typeof raw.version !== 'string'
        || !stagedHash || stagedHash === plugin.files[MANIFEST]) continue;
      pending.set(plugin.id, `插件 ${plugin.id} 的升级待完成（${plugin.version} → ${raw.version}），请重试原 install`);
    } catch { /* Damaged working copies cannot establish an accepted upgrade. */ }
  }
  return pending;
}

function saveStage(root: string, incoming: InstallSource): void {
  const target = stagedRoot(root, incoming.id);
  if (fs.existsSync(target)) {
    const staged = manifestData(readManifest(target));
    if (staged.name === incoming.id && staged.version === incoming.version
      && [...incoming.files].every(([relative, file]) => readInstallFile(ordinaryFile(target, relative))?.sha256 === file.sha256)) return;
    throw new Error(`插件 ${incoming.id} 已有不同的待升级来源，保留原暂存副本`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(target), '.incomplete-'));
  try {
    for (const [relative, file] of incoming.files) writeExtensionFileAtomic(ordinaryFile(temporary, relative), file.bytes, true);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function backupRoot(root: string, id: string): string {
  return ordinaryPath(root, `${UPGRADES}/.previous-${id}`, '替换前插件资源');
}

function backupReplacements(root: string, id: string, replacements: readonly Replacement[]): void {
  const backup = backupRoot(root, id);
  const temporary = fs.mkdtempSync(path.join(path.dirname(backup), '.incomplete-'));
  try {
    for (const { relative, before } of replacements) {
      if (before) writeExtensionFileAtomic(ordinaryFile(temporary, relative), before.bytes, true);
    }
    fs.renameSync(temporary, backup);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function clearUpgrade(root: string, id: string): void {
  fs.rmSync(backupRoot(root, id), { recursive: true, force: true });
  fs.rmSync(stagedRoot(root, id), { recursive: true, force: true });
}

function recoverInterruptedReplacement(
  root: string, incoming: InstallSource, previous: PluginSelection, observe?: ObserveExtensionWrite,
): void {
  const backup = backupRoot(root, incoming.id);
  if (!fs.existsSync(backup)) return;
  saveStage(root, incoming);
  const candidateManifest = incoming.files.get(MANIFEST);
  if (candidateManifest?.sha256 === previous.files[MANIFEST]) {
    clearUpgrade(root, incoming.id);
    return;
  }
  const target = ordinaryPath(root, incoming.id, '中断的插件替换');
  const changes: Replacement[] = [];
  for (const [relative, candidate] of incoming.files) {
    const expected = previous.files[relative];
    if (candidate.sha256 === expected) continue;
    const current = readInstallFile(ordinaryFile(target, relative));
    const original = readInstallFile(ordinaryFile(backup, relative));
    if (current?.sha256 === original?.sha256) continue;
    if (current && current.sha256 !== candidate.sha256) {
      throw new Error(`插件 ${incoming.id} 的中断替换与宿主改写冲突，保留：${relative}`);
    }
    changes.push({ relative, before: current, after: original });
  }
  for (const relative of Object.keys(previous.files)) {
    if (incoming.files.has(relative)) continue;
    const original = readInstallFile(ordinaryFile(backup, relative));
    if (!original) continue;
    const current = readInstallFile(ordinaryFile(target, relative));
    if (current?.sha256 === original.sha256) continue;
    if (current) throw new Error(`插件 ${incoming.id} 的中断替换与宿主改写冲突，保留：${relative}`);
    changes.push({ relative, after: original });
  }
  applyChanges(target, changes, () => fs.rmSync(backup, { recursive: true }), observe);
}

export function extensionActivationContext(
  projectRoot: string, plugin: ExtensionPlugin, options: Pick<ChangeOptions, 'observeWrite' | 'preview'> = {},
): ExtensionActivationContext {
  const files = { ...plugin.files };
  if (plugin.source.startsWith('bare-skill:')) delete files[MANIFEST];
  return { projectRoot, extensionRoot: plugin.rootDir, ability: plugin.id, version: plugin.version, sourceFiles: files, ...options };
}

function disabledLocalPlugins(bundle: ExtensionBundle): Array<{ plugin: ExtensionPlugin; steps: ExtensionActivationStep[] }> {
  return Object.values(bundle.plugins).flatMap(plugin => {
    if (plugin.enabled) return [];
    const steps = (bundle.activations[plugin.id] ?? []).filter(step => step.scope === 'local' && step.outputs.some(output =>
      fs.existsSync(path.join(plugin.rootDir, output))));
    return steps.length ? [{ plugin, steps }] : [];
  });
}

function cleanupDisabled(projectRoot: string, bundle: ExtensionBundle): ExtensionCleanupEntry[] {
  const cleaned: ExtensionCleanupEntry[] = [];
  for (const { plugin, steps } of disabledLocalPlugins(bundle)) {
    const relative = relativeExtensionPath(projectRoot, plugin.rootDir);
    try {
      const request = extensionRequestsUsingAbility(projectRoot, plugin.id, plugin.source);
      const usage = extensionRequestsUsingResources(projectRoot, [relative], true);
      if (request.requestIds.length || usage.requestIds.length) throw new Error('在途请求仍占用，保留停用插件本地产物');
      removeDisabledExtensionOutputs(extensionActivationContext(projectRoot, plugin), steps);
      cleaned.push({ plugin: plugin.id, path: relative, state: 'removed', reason: '已停用插件的本地产物' });
    } catch (error) {
      cleaned.push({ plugin: plugin.id, path: relative, state: 'retained', reason: (error as Error).message });
    }
  }
  return cleaned;
}

export function prepareExtensionPlugins(
  projectRoot: string, frameworkRoot: string, pluginIds: (bundle: ExtensionBundle) => Iterable<string>,
): { bundle: ExtensionBundle; cleaned: ExtensionCleanupEntry[] } {
  const read = (excludedPlugins?: ReadonlyMap<string, string>) =>
    loadInstanceExtensions(projectRoot, undefined, { frameworkRoot, excludedPlugins });
  const original = read();
  if (!original.manifestUsable || !original.manifestPath) return { bundle: original, cleaned: [] };
  const initiallySelected = [...new Set(pluginIds(original))];
  const hasDynamic = initiallySelected.some(id => original.plugins[id]?.enabled && original.activations[id]?.length);
  let needsCleanup = false;
  let cleanupIssue: ExtensionCleanupEntry[] = [];
  try { needsCleanup = hasDeletedPluginCandidates(original); }
  catch (error) {
    cleanupIssue = [{ plugin: '', path: original.rootDir ?? '', state: 'retained', reason: (error as Error).message }];
  }
  if (!hasDynamic && !needsCleanup && !disabledLocalPlugins(original).length) {
    const pending = pendingExtensionUpgrades(original);
    return { bundle: pending.size ? read(pending) : original, cleaned: cleanupIssue };
  }
  try {
    return withExtensionWrite(projectRoot, frameworkRoot, () => {
      const bundle = read();
      const cleaned = [...(cleanupIssue.length ? cleanupIssue : cleanupDeleted(projectRoot, bundle)), ...cleanupDisabled(projectRoot, bundle)];
      const excluded = pendingExtensionUpgrades(bundle);
      for (const id of new Set(pluginIds(bundle))) {
        const plugin = own(bundle.plugins, id);
        const steps = own(bundle.activations, id);
        if (!plugin?.enabled || !steps?.length || excluded.has(id)) continue;
        const ready = runExtensionActivation(extensionActivationContext(projectRoot, plugin), steps, 'local', () => {
          const requests = extensionRequestsUsingAbility(projectRoot, id, plugin.source);
          const usage = extensionRequestsUsingResources(projectRoot, [relativeExtensionPath(projectRoot, plugin.rootDir)], true);
          if (requests.requestIds.length || usage.requestIds.length) throw new Error('有在途请求使用本插件，保留现有本地产物');
        });
        if (ready.failure) excluded.set(id, ready.failure);
      }
      return { bundle: read(excluded), cleaned };
    }, hasDynamic);
  } catch (error) {
    if (!(error instanceof ExtensionWriteBusyError)) throw error;
    const excluded = pendingExtensionUpgrades(original);
    for (const id of pluginIds(original)) if (original.activations[id]?.length) excluded.set(id, error.message);
    return { bundle: read(excluded), cleaned: [] };
  }
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
    pending?: { operation: ExtensionMutation; binding?: string; command: string[] };
    incompatibleBindings?: Array<{ id: string; issue: string }>;
  }>;
  requestIds?: string[];
  inactiveRequests?: InactiveExtensionRequest[];
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

interface Replacement {
  relative: string;
  before?: InstallFile;
  after?: InstallFile;
}

function pruneEmpty(root: string, relative: string): void {
  let directory = path.dirname(path.join(root, relative));
  while (isInsideProjectRoot(root, directory) && directory !== root) {
    if (fs.existsSync(directory)) {
      if (fs.readdirSync(directory).length) break;
      fs.rmdirSync(directory);
    }
    directory = path.dirname(directory);
  }
}

class ExtensionReplacementRecoveryError extends Error {}

function applyChanges(root: string, replacements: readonly Replacement[], after: () => void, observe?: ObserveExtensionWrite): void {
  const finished: Replacement[] = [];
  const write = ({ relative, before, after }: Replacement): void => {
    const target = ordinaryFile(root, relative);
    if (readInstallFile(target)?.sha256 !== before?.sha256) throw new Error(`扩展文件已变更，保留：${relative}`);
    if (after) writeExtensionFileAtomic(target, after.bytes, !before, observe);
    else if (before) {
      removeExtensionFile(target, observe);
      pruneEmpty(path.dirname(root), relativeExtensionPath(path.dirname(root), target));
    }
  };
  try {
    for (const change of replacements) { write(change); finished.push(change); }
    after();
  } catch (error) {
    try {
      for (const change of finished.reverse()) write({ relative: change.relative, before: change.after, after: change.before });
    } catch (rollback) {
      throw new ExtensionReplacementRecoveryError(`${(error as Error).message}；恢复中断：${(rollback as Error).message}`);
    }
    throw error;
  }
}

/** The management entry holds the workspace write lock across selection, materialization and file changes. */
export function changeExtension(action: ExtensionMutation, options: ChangeOptions): ExtensionLifecycleResult {
  const { projectRoot, frameworkRoot, binding, at, phase, observeWrite } = options;
  const { root } = extensionLocation(projectRoot, frameworkRoot);
  assertExtensionTargetProtocol(frameworkRoot);
  assertExtensionHostWritable(root);
  const doc = readManifest(root);
  if (doc.contents === null) {
    doc.set('schema_version', '2.0');
    doc.set('kind', 'host');
    doc.set('plugins', doc.createNode({}));
  }

  const load = () => loadInstanceExtensions(projectRoot, undefined, { frameworkRoot });
  let bundle = load();
  const registrations = mapping(manifestData(doc).plugins);
  const result: ExtensionLifecycleResult = { abilities: [], changed: false, filesWritten: [], filesRemoved: [], retained: [], outcomes: [] };
  const commands = [action, ...(action === 'install' && options.source ? [options.source] : []),
    ...(options.ability ? [options.ability] : []), ...(binding ? [binding] : []), ...(options.noEnable ? ['--no-enable'] : [])];

  function save(candidate: Document = doc): void {
    const file = ordinaryFile(root, MANIFEST);
    const next = candidate.toJS();
    const errors = validateExtensionManifestRoot(next, file, 'host');
    if (errors.length) throw new Error(errors.map(item => item.message).join('；'));
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    if (current !== undefined && isDeepStrictEqual(YAML.parse(current), next)) return;
    const text = candidate.toString().replace(/\n/g, extensionTextEol(current ?? ''));
    writeExtensionFileAtomic(file, text, current === undefined, observeWrite);
    result.changed = true;
  }

  function addChanges(replacements: readonly Replacement[]): void {
    for (const change of replacements) {
      const relative = relativeExtensionPath(projectRoot, path.join(target, change.relative));
      (change.after ? result.filesWritten : result.filesRemoved).push(relative);
    }
    if (replacements.length) result.changed = true;
  }

  function pending(plugin: ExtensionPlugin, selectedBinding?: string): boolean {
    const exact = extensionRequestsUsingAbility(projectRoot, plugin.id, plugin.source, selectedBinding);
    const paths = selectedBinding ? undefined : extensionRequestsUsingResources(projectRoot,
      [relativeExtensionPath(projectRoot, plugin.rootDir)], true);
    const requestIds = [...new Set([...exact.requestIds, ...paths?.requestIds ?? []])].sort();
    const inactive = [...new Map([...exact.inactiveRequests, ...paths?.inactiveRequests ?? []]
      .map(request => [request.requestFile, request])).values()];
    if (inactive.length) result.inactiveRequests = inactive;
    if (!requestIds.length) return false;
    result.requestIds = requestIds;
    result.outcomes.push({ ability: plugin.id, state: 'pending',
      pending: { operation: action, ...(selectedBinding ? { binding: selectedBinding } : {}), command: commands } });
    return true;
  }

  function stop(plugin: ExtensionPlugin, steps: readonly ExtensionActivationStep[]): boolean {
    if (!steps.length) return true;
    const outcome = undoExtensionActivation(extensionActivationContext(projectRoot, plugin, { observeWrite, preview: options.preview }), steps);
    if (!outcome.failure) return true;
    result.outcomes.push({ ability: plugin.id, state: 'failed', reason: outcome.failure, activation: outcome });
    return false;
  }

  function start(plugin: ExtensionPlugin, steps: readonly ExtensionActivationStep[]): ExtensionActivationResult | undefined {
    if (!steps.length) return;
    return runExtensionActivation(extensionActivationContext(projectRoot, plugin, { observeWrite, preview: options.preview }), steps, 'management',
      () => {
        const usage = extensionRequestsUsingAbility(projectRoot, plugin.id, plugin.source);
        if (usage.requestIds.length) throw new Error(`有在途请求使用本插件：${usage.requestIds.join(', ')}`);
      });
  }

  function retain(dir: string, file: string, reason: string): void {
    result.retained.push({ path: relativeExtensionPath(projectRoot, path.join(dir, file)), reason });
  }

  const incoming = action === 'install' ? sourceForInstall(options, root, bundle) : undefined;
  const id = incoming?.id ?? options.ability;
  if (!id || !TOKEN.test(id)) throw new Error(`用法：${action} <插件ID>${action === 'uninstall' ? '' : ' [绑定ID]'}`);
  const registered = own(registrations, id);
  if (incoming && registered && fs.existsSync(backupRoot(root, id))) {
    const prior = registered as unknown as PluginSelection;
    if (prior.source !== incoming.source) throw new Error(`插件 ${id} 已来自 ${prior.source}，请用同一来源恢复`);
    recoverInterruptedReplacement(root, incoming, prior, observeWrite);
    bundle = load();
  }
  const previous = own(bundle.plugins, id);
  const previousSteps = own(bundle.activations, id) ?? [];
  const pendingUpgrade = pendingExtensionUpgrades(bundle).get(id);
  const target = ordinaryPath(root, id, '插件安装目录');
  if (!previous && registered !== undefined) throw new Error(`已登记插件 ${id} 的包清单或目录不可用，保留原文件与选择`);
  if (binding && !BINDING_ID.test(binding)) throw new Error(`绑定 ID 无效：${binding}`);
  result.abilities.push(id);

  if (incoming) {
    if (previous && (previous.source !== incoming.source || Boolean(previous.in_place) !== incoming.inPlace)) {
      throw new Error(`插件 ${id} 已来自 ${previous.source}，请保留原来源或先卸载归属`);
    }
    if (!previous && !incoming.inPlace && fs.existsSync(target)) throw new Error(`已有插件目录无本次安装归属，保留：${target}`);
    const upgrade = previous !== undefined && previous.version !== incoming.version && !incoming.inPlace;
    if (pendingUpgrade && !upgrade) throw new Error(pendingUpgrade);
    const bare = incoming.source.startsWith('bare-skill:');
    const sourceMatches = extensionFingerprintMatcher(incoming.sourceRoot);
    const installedMatches = extensionFingerprintMatcher(target);
    const hashes = incoming.inPlace ? {} : Object.fromEntries([...incoming.files].map(([relative, file]) => {
      const prior = previous && own(previous.files, relative);
      return [relative, !bare && prior && sourceMatches(relative, file.bytes, prior, file.sha256) ? prior : file.sha256];
    }));
    if (bare && previous) hashes[MANIFEST] = previous.files[MANIFEST];
    if (previous && !upgrade && !incoming.inPlace && !bare && !isDeepStrictEqual(previous.files, hashes)) {
      throw new Error(`插件 ${id} 同源同版本的来源内容已变化，请提供方先升版（${incoming.version}）`);
    }
    const selection: PluginSelection = {
      source: incoming.source, enabled: previous?.enabled ?? !options.noEnable,
      bindings: { ...previous?.bindings }, files: hashes,
      ...(previous?.binding_overrides ? { binding_overrides: previous.binding_overrides } : {}),
      ...(incoming.inPlace ? { in_place: true } : {}),
    };
    for (const [bindingId, value] of Object.entries(incoming.defaults)) {
      if (own(selection.bindings, bindingId) === undefined) selection.bindings[bindingId] = !previous && value;
    }
    for (const bindingId of Object.keys(selection.bindings)) {
      if (own(incoming.defaults, bindingId) !== undefined) continue;
      delete selection.bindings[bindingId];
      if (selection.binding_overrides) {
        selection.binding_overrides = { ...selection.binding_overrides };
        delete selection.binding_overrides[bindingId];
      }
    }

    const replacements: Replacement[] = [];
    if (!incoming.inPlace) for (const relative of new Set([...incoming.files.keys(), ...Object.keys(previous?.files ?? {})])) {
      if (bare && previous && relative === MANIFEST) continue;
      const retiredLocal = upgrade && previousSteps.some(step => step.scope === 'local'
        && step.outputs.some(output => extensionActivationPathsOverlap(relative, output)));
      const actual = retiredLocal ? undefined : readInstallFile(ordinaryFile(target, relative));
      const next = incoming.files.get(relative);
      const prior = previous && own(previous.files, relative);
      if (actual && !prior) throw new Error(`已有文件无本次安装归属，保留：${relative}`);
      if (actual && prior && !installedMatches(relative, actual.bytes, prior, actual.sha256)) {
        if (next && hashes[relative] !== prior) throw new Error(`宿主改写与来源升级冲突，保留：${relative}`);
        retain(target, relative, '已被宿主改写');
      } else if (actual && next ? !installedMatches(relative, actual.bytes, hashes[relative], actual.sha256) : actual || next) {
        replacements.push({ relative, before: actual, after: next });
      }
    }
    const candidate = doc.clone();
    writePluginSelection(candidate, id, selection);

    if (upgrade) {
      saveStage(root, incoming);
      options.closeEntries?.();
      if (pending(previous)) return result;
      if (!stop(previous, previousSteps)) return result;
      backupReplacements(root, id, replacements);
    } else if (previous && replacements.length && pending(previous)) return result;

    let activated: ExtensionActivationResult | undefined;
    const synthetic: ExtensionPlugin = { id, version: incoming.version, rootDir: target,
      manifestPath: path.join(target, MANIFEST), ...selection, skills: [], mcpActions: {}, capabilities: {},
      phaseRuleOverlayPaths: {}, skillAssetAbsPaths: {} };
    try {
      if (maintainExtensionIgnore(root, [[id, incoming.steps, [...incoming.files.keys()]]], observeWrite)) result.changed = true;
      applyChanges(target, replacements, () => {
        activated = selection.enabled && !bare ? start(synthetic, incoming.steps) : undefined;
        if (activated?.failure && upgrade) throw new Error(activated.failure);
        if (activated?.failure) {
          selection.enabled = false;
          writePluginSelection(candidate, id, selection);
        }
        save(candidate);
      }, observeWrite);
    } catch (error) {
      if (!upgrade || error instanceof ExtensionReplacementRecoveryError) throw error;
      maintainExtensionIgnore(root, [[id, previousSteps, Object.keys(previous.files)]], observeWrite);
      clearUpgrade(root, id);
      const restored = previous.enabled ? start(previous, previousSteps) : undefined;
      result.outcomes.push({ ability: id, state: 'failed', reason: [
        (error as Error).message, '旧版已恢复', restored?.failure && `旧版重新准备失败：${restored.failure}`,
      ].filter(Boolean).join('；'), activation: activated });
      return result;
    }
    if (upgrade) clearUpgrade(root, id);
    addChanges(replacements);
    const incompatibleBindings = load().bindings.filter(row => row.ability === id && row.issue)
      .map(row => ({ id: row.id, issue: row.issue! }));
    result.outcomes.push({ ability: id, state: activated?.failure ? 'failed' : selection.enabled ? 'enabled' : 'installed',
      ...(activated ? { activation: activated, reason: activated.failure } : {}), ...(incompatibleBindings.length ? { incompatibleBindings } : {}) });
    return result;
  }

  if (!previous) {
    if (action === 'uninstall') return result;
    throw new Error(`宿主未登记插件：${id}`);
  }
  if (pendingUpgrade) throw new Error(pendingUpgrade);
  const selection = { ...(registered as unknown as PluginSelection) };
  const declared = mapping(manifestData(readManifest(previous.rootDir)).bindings);
  const chosen = bundle.bindings.find(row => row.ability === id && row.id === binding);
  if (binding && own(declared, binding) === undefined) throw new Error(`插件 ${id} 没有绑定：${binding}`);

  if (action === 'enable') {
    if (binding) {
      selection.bindings = { ...selection.bindings, [binding]: true };
      if (at !== undefined || phase !== undefined) {
        const timingId = at?.trim() ?? chosen?.at;
        const timing = timingId && readExtensionTimings(frameworkRoot).get(timingId);
        if (!timing) throw new Error(`绑定 ${id}.${binding} 的时点不可用：${timingId ?? '未声明'}`);
        const chosenPhase = phase?.trim() ?? (timing.scope === 'project' ? undefined : chosen?.phase);
        if (timing.scope === 'project' ? chosenPhase : !chosenPhase) throw new Error(`绑定 ${id}.${binding} 的生效阶段不可用`);
        selection.binding_overrides = { ...selection.binding_overrides, [binding]: { at: timing.id, ...(chosenPhase ? { phase: chosenPhase } : {}) } };
        writePluginSelection(doc, id, selection);
        const proposed = loadInstanceExtensions(projectRoot, undefined, { frameworkRoot, manifestRaw: doc.toJS() })
          .bindings.find(row => row.ability === id && row.id === binding);
        if (!proposed || proposed.issue) throw new Error(`绑定 ${id}.${binding} 的生效阶段不可用：${proposed?.issue ?? timing.id}`);
      }
    } else {
      if (maintainExtensionIgnore(root, [[id, previousSteps, Object.keys(previous.files)]], observeWrite)) result.changed = true;
      const activated = start(previous, previousSteps);
      if (activated?.failure) {
        result.outcomes.push({ ability: id, state: 'failed', reason: activated.failure, activation: activated });
        return result;
      }
      selection.enabled = true;
      if (activated) result.outcomes.push({ ability: id, state: 'enabled', activation: activated });
    }
    writePluginSelection(doc, id, selection);
    save();
    if (!result.outcomes.length) result.outcomes.push({ ability: id, state: selection.enabled ? 'enabled' : 'installed' });
    return result;
  }

  if (binding) selection.bindings = { ...selection.bindings, [binding]: false };
  else selection.enabled = false;
  writePluginSelection(doc, id, selection);
  save();
  options.closeEntries?.();
  if (pending(previous, binding)) return result;
  if (!binding && !stop(previous, previousSteps)) return result;
  if (action === 'disable') {
    result.outcomes.push({ ability: id, state: 'disabled' });
    return result;
  }

  const replacements: Replacement[] = [];
  const installedMatches = extensionFingerprintMatcher(target);
  for (const [relative, expected] of Object.entries(previous.files)) {
    try {
      const actual = readInstallFile(ordinaryFile(target, relative));
      if (!actual) continue;
      if (installedMatches(relative, actual.bytes, expected, actual.sha256)) replacements.push({ relative, before: actual });
      else retain(target, relative, '已被宿主改写');
    } catch (error) {
      retain(target, relative, (error as Error).message);
    }
  }
  if (previous.in_place) retain(root, id, '原地自有插件');
  doc.deleteIn(['plugins', id]);
  applyChanges(target, replacements, () => save(), observeWrite);
  addChanges(replacements);
  if (!previous.in_place && fs.existsSync(target) && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
  result.outcomes.push({ ability: id, state: 'uninstalled' });
  return result;
}
