import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import spawn from 'cross-spawn';

import {
  extensionActivationPathWithin, extensionActivationPathsOverlap, isExtensionActivationOutput, isExtensionNpmCommand,
  validateExtensionActivationOwnership, type ExtensionActivationStep,
} from './extension-activation-contract';
import { assertUnlinkedExtensionTree, extensionFingerprintMatcher, extensionGitPaths, ordinaryPath, relativeExtensionPath, removeExtensionFile, type ObserveExtensionWrite } from './extension-files';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, readPhaseRecoveryFile, type PhaseInvocationChange } from './phase-write-boundary';
import { isInsideProjectRoot } from './project-relative-path';

export * from './extension-activation-contract';

export interface ExtensionActivationPreview {
  ability: string;
  version: string;
  input_sha256: string;
  commands: Array<{ id: string; action: 'run' | 'undo'; cwd: string; argv: string[]; outputs: string[] }>;
}

export interface ExtensionActivationContext {
  projectRoot: string;
  extensionRoot: string;
  ability: string;
  version: string;
  preview?: (notice: ExtensionActivationPreview) => void;
  observeWrite?: ObserveExtensionWrite;
  sourceFiles?: Readonly<Record<string, string>>;
}

interface ExtensionStepState {
  id: string;
  status: 'ready' | 'pending' | 'applied' | 'undone' | 'failed';
  outputs: string[];
  failure?: string;
}

export interface ExtensionActivationResult {
  status: 'enabled' | 'disabled' | 'failed';
  steps: ExtensionStepState[];
  failure?: string;
  residuals?: PhaseInvocationChange[];
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function outputPath(extensionRoot: string, relative: string): string {
  const root = fs.lstatSync(extensionRoot, { throwIfNoEntry: false });
  if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error('插件根不是普通目录');
  return relative === '.' ? extensionRoot : ordinaryPath(extensionRoot, relative, 'extension activation');
}

function regularFile(file: string): boolean {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  return Boolean(stat?.isFile() && stat.nlink === 1);
}

function projectOutputs(context: ExtensionActivationContext, step: ExtensionActivationStep): string[] {
  const extensionDir = path.dirname(context.extensionRoot);
  return (step.project_outputs ?? []).map(relative => {
    const resolved = ordinaryPath(context.projectRoot, relative, 'extension 项目级输出');
    if (extensionActivationPathsOverlap(relativeExtensionPath(context.projectRoot, extensionDir), relative)
      || /(?:^|\/)\.(?:git|manifest[^/]*)(?:\/|$)/i.test(relative)
      || extensionActivationPathsOverlap('framework', relative)) throw new Error(`项目级输出触及框架或扩展管理路径：${relative}`);
    return resolved;
  });
}

function managedOutputs(context: ExtensionActivationContext, step: ExtensionActivationStep): string[] {
  return [...step.outputs.map(relative => outputPath(context.extensionRoot, relative)), ...projectOutputs(context, step)];
}

export function validateExtensionActivationFiles(
  extensionRoot: string, plugin: string, steps: readonly ExtensionActivationStep[], protectedFiles: Iterable<string> = [],
): void {
  validateExtensionActivationOwnership(plugin, steps, protectedFiles);
  for (const step of steps) {
    const cwd = outputPath(extensionRoot, step.cwd);
    if (!fs.lstatSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`步骤 ${step.id} 工作目录不存在：${step.cwd}`);
    for (const relative of step.outputs) outputPath(extensionRoot, relative);
    for (const argv of [step.run, step.undo, 'check' in step.ready ? step.ready.check : undefined]) {
      if (!argv) continue;
      if (isExtensionNpmCommand(argv) && argv[1] === 'ci') {
        for (const input of ['package.json', 'package-lock.json']) {
          if (!regularFile(ordinaryPath(cwd, input, 'npm ci'))) throw new Error(`步骤 ${step.id} 缺少 npm ci 输入：${input}`);
        }
      }
      const isScript = /^node(?:\.exe)?$/i.test(path.win32.basename(argv[0])) && argv[1] && !argv[1].startsWith('-');
      if (!isScript) continue;
      const script = path.resolve(cwd, argv[1]);
      const relative = relativeExtensionPath(extensionRoot, script);
      if (!isInsideProjectRoot(extensionRoot, script)
        || (!regularFile(outputPath(extensionRoot, relative)) && !isExtensionActivationOutput(steps, relative))) {
        throw new Error(`步骤 ${step.id} 的包内脚本不可用：${relative}`);
      }
    }
  }
}

function instanceId(context: ExtensionActivationContext): string {
  return digest(JSON.stringify([context.projectRoot, context.ability, context.version]));
}

function redactArguments(argv: readonly string[]): string[] {
  const secret = /(?:^|[-_])(?:token|password|passwd|secret|credential|api[-_]?key|authorization)(?:$|[=:])/i;
  return argv.map((arg, index) => {
    if (index > 0 && secret.test(argv[index - 1]) && !/[=:]/.test(argv[index - 1])) return '[redacted]';
    if (secret.test(arg) && /[=:]/.test(arg)) return arg.replace(/([=:]).*$/, '$1[redacted]');
    return arg.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[redacted]@');
  });
}

function preview(
  context: ExtensionActivationContext, input: string,
  commands: Array<{ step: ExtensionActivationStep; action: 'run' | 'undo' }>,
): void {
  if (!commands.length) return;
  const { ability, extensionRoot, version } = context;
  const notice = { ability, version, input_sha256: input,
    commands: commands.map(({ step, action }) => ({ id: step.id, action, cwd: path.join(extensionRoot, step.cwd),
      argv: redactArguments(action === 'run' ? step.run : step.undo!), outputs: step.outputs })) };
  if (context.preview) context.preview(notice);
  else fs.writeSync(2, `[extension activation] ${JSON.stringify(notice)}\n`);
}

function creationReceipts(stdout: string, instance: string): Map<string, string> {
  const prefix = 'extension-created: ';
  const receipts = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue;
    try {
      const row = JSON.parse(line.slice(prefix.length));
      if (row?.instance_id === instance && typeof row.path === 'string'
        && typeof row.postSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.postSha256)) {
        receipts.set(row.path, row.postSha256);
      }
    } catch { /* Unrelated or invalid stdout cannot confer ownership. */ }
  }
  return receipts;
}

function removeReportedAddition(
  context: ExtensionActivationContext, change: PhaseInvocationChange, occupied: Set<string>, receipts: Map<string, string>,
): boolean {
  if (change.how !== 'added' || occupied.has(process.platform === 'win32' ? change.path.toLowerCase() : change.path) || !change.postSha256
    || receipts.get(change.path) !== change.postSha256) return false;
  try {
    const file = ordinaryPath(context.projectRoot, change.path, 'extension 越界新增');
    const { actual, bytes } = readPhaseRecoveryFile(context.projectRoot, file);
    if (!bytes || digest(bytes) !== change.postSha256) return false;
    removeExtensionFile(actual);
    return true;
  } catch { return false; }
}

function invoke(
  context: ExtensionActivationContext, instance: string, step: ExtensionActivationStep, action: 'run' | 'undo' | 'check',
  allowedOutputs: readonly string[], argv = action === 'run' ? step.run : step.undo!,
): { failure?: string; violation?: true; residuals: PhaseInvocationChange[] } {
  const cwd = outputPath(context.extensionRoot, step.cwd);
  const resolution = { projectRoot: context.projectRoot, protectedRoots: [] };
  const occupied = new Set<string>();
  const pre = capturePhaseInvocationSnapshot(resolution, { wholeProject: true, onObservedPath: rel => {
    occupied.add(process.platform === 'win32' ? rel.toLowerCase() : rel);
  } });
  if (pre.failureReason) return { violation: true, failure: `${step.id} 步前项目快照失败：${pre.failureReason}`, residuals: [] };
  let failure: string | undefined;
  let stdout = '';
  try {
    const command = spawn.sync(argv[0], argv.slice(1), {
      cwd, input: '', encoding: 'utf8', windowsHide: true, shell: false, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, MAISON_EXTENSION_ROOT: context.extensionRoot, MAISON_EXTENSION_PROJECT_ROOT: context.projectRoot,
        MAISON_EXTENSION_INSTANCE_ID: instance, MAISON_EXTENSION_VERSION: context.version },
    });
    stdout = command.stdout ?? '';
    if (command.error) failure = `${step.id} ${action} 命令失败 (${(command.error as NodeJS.ErrnoException).code ?? 'spawn'})`;
    else if (command.signal) failure = `${step.id} ${action} 被 ${command.signal} 中断`;
    else if (command.status !== 0) failure = `${step.id} ${action} 退出码 ${command.status}`;
  } catch {
    failure = `${step.id} ${action} 命令启动失败`;
  }
  const post = capturePhaseInvocationSnapshot(resolution, { wholeProject: true });
  const diff = diffPhaseInvocationSnapshots(pre, post);
  if (diff.kind === 'unverifiable') {
    return { violation: true, failure: [failure, `${step.id} 步后项目快照无法核对：${diff.reason}`].filter(Boolean).join('；'), residuals: [] };
  }
  if (diff.kind === 'clean') return { failure, residuals: [] };
  const outside: PhaseInvocationChange[] = [];
  for (const change of diff.changes) {
    if (!allowedOutputs.some(out => extensionActivationPathWithin(change.path, out))) outside.push(change);
    else context.observeWrite?.({
      path: path.join(context.projectRoot, change.path), pre_sha256: change.preSha256, post_sha256: change.postSha256,
    });
  }
  if (!outside.length) return { failure, residuals: [] };
  const receipts = creationReceipts(stdout, instance);
  const residuals = outside.filter(change => !removeReportedAddition(context, change, occupied, receipts));
  return { violation: true, failure: [failure, `${step.id} ${action} 越界写入：${outside.map(change => change.path).join(', ')}`]
    .filter(Boolean).join('；'), residuals };
}

function protectedLocalOutputs(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[],
): void {
  const outputPaths = steps.filter(step => step.scope === 'local').flatMap(step => step.outputs);
  if (!outputPaths.length) return;
  const prefix = relativeExtensionPath(context.projectRoot, context.extensionRoot);
  const tracked = extensionGitPaths(context.projectRoot, ['ls-files', '-z', '--', prefix]) ?? [];
  const owned = Object.keys(context.sourceFiles ?? {});
  validateExtensionActivationOwnership(context.ability, steps.filter(step => step.scope === 'local'),
    [...tracked.map(file => path.posix.relative(prefix, file)), ...owned]);
}

function checkStep(
  context: ExtensionActivationContext, step: ExtensionActivationStep,
): { failure?: string; violation?: true; residuals: PhaseInvocationChange[] } {
  for (const output of managedOutputs(context, step)) {
    const stat = fs.lstatSync(output, { throwIfNoEntry: false });
    if (!stat || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) {
      return { failure: `步骤 ${step.id} 缺少有效产物：${relativeExtensionPath(context.projectRoot, output)}`, residuals: [] };
    }
  }
  if ('check' in step.ready) {
    return invoke(context, instanceId(context), step, 'check', [], step.ready.check);
  }
  const relative = step.ready.version_file;
  const file = outputPath(context.extensionRoot, relative);
  try {
    if (regularFile(file)) {
      const index: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      const key = step.ready.version_field ?? 'plugin_version';
      if (index && typeof index === 'object' && !Array.isArray(index) && Object.prototype.hasOwnProperty.call(index, key)
        && (index as Record<string, unknown>)[key] === context.version) return { residuals: [] };
    }
  } catch { /* A missing or unreadable version is insufficient evidence to reuse the output. */ }
  return { failure: `步骤 ${step.id} 的 ${relative} 未声明当前插件版本 ${context.version}`, residuals: [] };
}

export function inspectExtensionActivation(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[],
): ExtensionActivationResult {
  const rows: ExtensionStepState[] = [];
  for (const step of steps) {
    try {
      const { failure } = checkStep(context, step);
      rows.push({ id: step.id, status: failure ? 'pending' : 'ready', outputs: step.outputs, ...(failure ? { failure } : {}) });
    } catch (error) {
      rows.push({ id: step.id, status: 'failed', outputs: step.outputs, failure: (error as Error).message });
    }
  }
  const failure = rows.find(step => step.failure)?.failure;
  return { status: failure ? 'failed' : 'enabled', steps: rows, ...(failure ? { failure } : {}) };
}

function removeLocalOutputs(context: ExtensionActivationContext, step: ExtensionActivationStep, prune = false): void {
  const outputs = managedOutputs(context, step);
  for (const output of outputs) assertUnlinkedExtensionTree(output, true);
  for (const output of outputs) {
    const entries = context.observeWrite ? capturePhaseInvocationSnapshot({ projectRoot: context.projectRoot, protectedRoots: [] },
      { wholeProject: true }).entries : [];
    fs.rmSync(output, { recursive: true, force: true });
    if (context.observeWrite) {
      const relative = relativeExtensionPath(context.projectRoot, output);
      for (const file of entries.filter(entry => entry.kind === 'file' && extensionActivationPathWithin(entry.path, relative))) {
        context.observeWrite({ path: path.join(context.projectRoot, file.path), pre_sha256: file.sha256 ?? null, post_sha256: null });
      }
    }
    if (!prune) continue;
    let parent = path.dirname(output);
    while (parent !== context.extensionRoot) {
      if (!fs.existsSync(parent)) { parent = path.dirname(parent); continue; }
      if (fs.readdirSync(parent).length) break;
      fs.rmdirSync(parent);
      parent = path.dirname(parent);
    }
  }
}

export function removeDisabledExtensionOutputs(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[],
): void {
  const local = steps.filter(step => step.scope === 'local');
  protectedLocalOutputs(context, local);
  for (const step of [...local].reverse()) removeLocalOutputs(context, step, true);
}

function allowedPaths(context: ExtensionActivationContext, step: ExtensionActivationStep): string[] {
  return managedOutputs(context, step).map(file => relativeExtensionPath(context.projectRoot, file));
}

function validateExecution(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[], assertSources: boolean,
): void {
  validateExtensionActivationFiles(context.extensionRoot, context.ability, steps, Object.keys(context.sourceFiles ?? {}));
  protectedLocalOutputs(context, steps);
  for (const step of steps) managedOutputs(context, step);
  if (!assertSources) return;
  const matches = extensionFingerprintMatcher(context.extensionRoot);
  for (const [relative, expected] of Object.entries(context.sourceFiles ?? {})) {
    const file = outputPath(context.extensionRoot, relative);
    if (!regularFile(file) || !matches(relative, fs.readFileSync(file), expected)) throw new Error(`已安装源文件被改写：${relative}`);
  }
}

export function runExtensionActivation(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[], mode: 'management' | 'local',
  canRebuild: () => void = () => {},
): ExtensionActivationResult {
  const rows: ExtensionStepState[] = [];
  const touched: Array<{ step: ExtensionActivationStep; row: ExtensionStepState }> = [];
  const residuals: PhaseInvocationChange[] = [];
  const id = instanceId(context);
  try {
    validateExecution(context, steps, false);
    const commands: Array<{ step: ExtensionActivationStep; action: 'run' }> = [];
    for (const step of steps) {
      const row: ExtensionStepState = { id: step.id, status: 'pending', outputs: step.outputs };
      rows.push(row);
      const before = checkStep(context, step);
      residuals.push(...before.residuals);
      if (before.violation) throw new Error(before.failure);
      if (!before.failure) { row.status = 'ready'; continue; }
      if (step.scope === 'repo' && mode === 'local') {
        throw new Error(`${before.failure}。请由维护者运行 extension enable ${context.ability}`);
      }
      if (!touched.length) { canRebuild(); validateExecution(context, steps, true); }
      if (step.scope === 'local') removeLocalOutputs(context, step);
      if (mode === 'management') {
        commands.splice(0, commands.length, { step, action: 'run' });
        preview(context, id, commands);
      }
      touched.push({ step, row });
      const run = invoke(context, id, step, 'run', allowedPaths(context, step));
      residuals.push(...run.residuals);
      if (run.failure) throw new Error(run.failure);
      if (step.scope === 'local') for (const output of managedOutputs(context, step)) assertUnlinkedExtensionTree(output, true);
      const after = checkStep(context, step);
      residuals.push(...after.residuals);
      if (after.failure) throw new Error(after.failure);
      row.status = 'applied';
    }
    return { status: 'enabled', steps: rows };
  } catch (error) {
    const failure = (error as Error).message;
    const undoFailures = [];
    for (const { step, row } of touched.reverse()) {
      try {
        if (step.scope === 'local') removeLocalOutputs(context, step);
        else {
          preview(context, id, [{ step, action: 'undo' }]);
          const undone = invoke(context, id, step, 'undo', allowedPaths(context, step));
          residuals.push(...undone.residuals);
          if (undone.failure) throw new Error(undone.failure);
        }
        row.status = 'undone';
      } catch (undoError) {
        row.status = 'failed';
        row.failure = (undoError as Error).message;
        undoFailures.push(row.failure);
      }
    }
    return { status: 'failed', steps: rows, failure: [failure, ...undoFailures].join('；'), ...(residuals.length ? { residuals } : {}) };
  }
}

export function undoExtensionActivation(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[],
): ExtensionActivationResult {
  const rows: ExtensionStepState[] = [];
  const residuals: PhaseInvocationChange[] = [];
  const id = instanceId(context);
  try {
    validateExecution(context, steps, false);
    for (const step of [...steps].reverse()) {
      const row: ExtensionStepState = { id: step.id, status: 'pending', outputs: step.outputs };
      rows.push(row);
      if (step.scope === 'local') removeLocalOutputs(context, step, true);
      else {
        const check = checkStep(context, step);
        residuals.push(...check.residuals);
        if (check.violation) throw new Error(check.failure);
        if (!check.failure || managedOutputs(context, step).some(output => fs.existsSync(output))) {
          validateExecution(context, steps, true);
          preview(context, id, [{ step, action: 'undo' }]);
          const undo = invoke(context, id, step, 'undo', allowedPaths(context, step));
          residuals.push(...undo.residuals);
          if (undo.failure) throw new Error(undo.failure);
          const remaining = checkStep(context, step);
          residuals.push(...remaining.residuals);
          if (!remaining.failure || remaining.violation) throw new Error(`步骤 ${step.id} 撤回后效果仍在或无法核对`);
        }
      }
      row.status = 'undone';
    }
    return { status: 'disabled', steps: rows };
  } catch (error) {
    return { status: 'failed', steps: rows, failure: (error as Error).message, ...(residuals.length ? { residuals } : {}) };
  }
}
