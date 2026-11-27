import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import spawn from 'cross-spawn';

import {
  extensionActivationPathWithin, isExtensionActivationOutput, isExtensionNpmCommand,
  parseExtensionActivationResult, validateExtensionActivationOwnership,
  type ExtensionActivationOutput, type ExtensionActivationResult, type ExtensionActivationStep, type ExtensionActivationStepResult,
} from './extension-activation-contract';
import { ordinaryPath, relativeExtensionPath, removeExtensionFile, type ObserveExtensionWrite } from './extension-files';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, readPhaseRecoveryFile, type PhaseInvocationChange } from './phase-write-boundary';
import { isInsideProjectRoot } from './project-relative-path';

export * from './extension-activation-contract';

export interface ExtensionActivationPreview {
  ability: string;
  version?: string;
  input_sha256: string;
  commands: Array<{ id: string; action: 'run' | 'undo'; cwd: string; argv: string[]; outputs: string[] }>;
}

export interface ExtensionActivationContext {
  projectRoot: string;
  extensionRoot: string;
  ability: string;
  version?: string;
  persist: (result: ExtensionActivationResult) => void;
  preview?: (notice: ExtensionActivationPreview) => void;
  observeWrite?: ObserveExtensionWrite;
  protectedFiles?: Iterable<string>;
  sourceFiles?: Readonly<Record<string, string>>;
}

export interface ExtensionActivationDrift {
  path: string;
  kind: 'missing' | 'changed' | 'unverifiable';
  reason?: string;
}

function digest(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function outputPath(extensionRoot: string, relative: string): string {
  if (fs.lstatSync(extensionRoot).isSymbolicLink()) throw new Error('扩展根目录已重定向');
  return ordinaryPath(extensionRoot, relative, 'extension activation');
}

function regularFile(file: string): boolean {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  return Boolean(stat?.isFile() && stat.nlink === 1);
}

export function validateExtensionActivationFiles(
  extensionRoot: string, ability: string, steps: readonly ExtensionActivationStep[], protectedFiles: Iterable<string> = [],
): void {
  if (!steps.length) return;
  validateExtensionActivationOwnership(ability, steps, protectedFiles);
  for (const step of steps) {
    const cwd = outputPath(extensionRoot, step.cwd);
    if (!fs.lstatSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`步骤 ${step.id} 工作目录不存在：${step.cwd}`);
    for (const relative of step.outputs) outputPath(extensionRoot, relative);
    for (const argv of [step.run, step.undo]) {
      if (!argv) continue;
      if (isExtensionNpmCommand(argv) && argv[1] === 'ci') {
        for (const input of ['package.json', 'package-lock.json']) {
          if (!regularFile(outputPath(extensionRoot, `${step.cwd}/${input}`))) {
            throw new Error(`步骤 ${step.id} 缺少 npm ci 输入：${step.cwd}/${input}`);
          }
        }
      }
      const localScript = /^node(?:\.exe)?$/i.test(path.win32.basename(argv[0])) && argv[1]
        && !argv[1].startsWith('-') && !path.isAbsolute(argv[1]) && !path.win32.isAbsolute(argv[1]);
      if (!localScript) continue;
      const relative = relativeExtensionPath(extensionRoot, path.resolve(cwd, argv[1]));
      if (!extensionActivationPathWithin(relative, `skills/${ability}`)
        || !regularFile(outputPath(extensionRoot, relative)) && !isExtensionActivationOutput(steps, relative)) {
        throw new Error(`步骤 ${step.id} 的脚本不可用：${relative}`);
      }
    }
  }
}

export function extensionActivationInputDigest(
  context: Pick<ExtensionActivationContext, 'extensionRoot' | 'ability' | 'sourceFiles'>,
  steps: readonly ExtensionActivationStep[],
): string {
  const { extensionRoot, ability, sourceFiles } = context;
  const files: Array<[string, string]> = [];
  const add = (relative: string, expected?: string): void => {
    const file = outputPath(extensionRoot, relative);
    if (!regularFile(file)) throw new Error(`启用输入不是单链接普通文件：${relative}`);
    const hash = digest(fs.readFileSync(file));
    if (expected !== undefined && expected !== hash) throw new Error(`已安装源文件被改写：${relative}`);
    files.push([relative, hash]);
  };
  const walk = (relative: string): void => {
    if (isExtensionActivationOutput(steps, relative)) return;
    const file = outputPath(extensionRoot, relative);
    if (!fs.lstatSync(file).isDirectory()) return add(relative);
    for (const child of fs.readdirSync(file).sort()) walk(`${relative}/${child}`);
  };
  if (sourceFiles && Object.keys(sourceFiles).length) {
    for (const relative of Object.keys(sourceFiles).sort()) add(relative, sourceFiles[relative]);
  } else {
    walk(`skills/${ability}`);
  }
  return digest(JSON.stringify([steps, files]));
}

function treeMembers(directory: string, tree: string, allowLinks: boolean): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) return [name, digest(JSON.stringify(['directory', treeMembers(file, tree, allowLinks)]))];
    if (stat.isFile() && stat.nlink === 1) return [name, digest(`file:${digest(fs.readFileSync(file))}`)];
    if (allowLinks && stat.isSymbolicLink() && isInsideProjectRoot(tree, fs.realpathSync(file))) {
      return [name, digest(JSON.stringify(['symlink', fs.readlinkSync(file)]))];
    }
    throw new Error(`输出目录有不支持的文件类型或外部链接：${file}`);
  }));
}

function readOutput(extensionRoot: string, relative: string): ExtensionActivationOutput | undefined {
  const file = outputPath(extensionRoot, relative);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (stat.isDirectory()) {
    const members = treeMembers(file, file, path.basename(file) === 'node_modules');
    return { path: relative, kind: 'directory', sha256: digest(JSON.stringify(members)), members };
  }
  if (stat.isFile() && stat.nlink === 1) return { path: relative, kind: 'file', sha256: digest(fs.readFileSync(file)) };
  throw new Error(`启用输出不是单链接普通文件或独占目录：${relative}`);
}

function outputDrift(expected: ExtensionActivationOutput, observed: ExtensionActivationOutput | undefined): ExtensionActivationDrift | undefined {
  const result = { path: expected.path };
  if (!observed) return { ...result, kind: 'missing' };
  if (observed.kind !== expected.kind) return { ...result, kind: 'changed' };
  if (observed.sha256 === expected.sha256) return undefined;
  if (expected.members && observed.members && Object.entries(observed.members)
    .every(([key, hash]) => expected.members?.[key] === hash)) return { ...result, kind: 'missing' };
  return { ...result, kind: 'changed' };
}

export function extensionActivationDrift(extensionRoot: string, result: ExtensionActivationResult): ExtensionActivationDrift[] {
  return result.steps.filter(step => step.status === 'applied').flatMap(step => step.outputs.flatMap(out => {
    try {
      const drift = outputDrift(out, readOutput(extensionRoot, out.path));
      return drift ? [drift] : [];
    } catch (error) {
      return [{ path: out.path, kind: 'unverifiable' as const, reason: (error as Error).message }];
    }
  }));
}

export function extensionActivationNeedsCleanup(result: ExtensionActivationResult | undefined): boolean {
  return result?.steps.some(step => step.status !== 'undone') ?? false;
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
  const notice = { ability, ...(version ? { version } : {}), input_sha256: input,
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
  context: ExtensionActivationContext, instance: string, step: ExtensionActivationStep, action: 'run' | 'undo',
  allowedOutputs: readonly string[],
): { failure?: string; residuals: PhaseInvocationChange[] } {
  const argv = action === 'run' ? step.run : step.undo!;
  const cwd = outputPath(context.extensionRoot, step.cwd);
  const resolution = { projectRoot: context.projectRoot, protectedRoots: [] };
  const occupied = new Set<string>();
  const pre = capturePhaseInvocationSnapshot(resolution, { wholeProject: true, onObservedPath: rel => {
    occupied.add(process.platform === 'win32' ? rel.toLowerCase() : rel);
  } });
  if (pre.failureReason) return { failure: `${step.id} 步前项目快照失败：${pre.failureReason}`, residuals: [] };
  let failure: string | undefined;
  let stdout = '';
  try {
    const command = spawn.sync(argv[0], argv.slice(1), {
      cwd, input: '', encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, MAISON_EXTENSION_ROOT: context.extensionRoot, MAISON_EXTENSION_PROJECT_ROOT: context.projectRoot,
        MAISON_EXTENSION_INSTANCE_ID: instance },
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
    return { failure: [failure, `${step.id} 步后项目快照无法核对：${diff.reason}`].filter(Boolean).join('；'), residuals: [] };
  }
  if (diff.kind === 'clean') return { failure, residuals: [] };
  const relativeRoot = relativeExtensionPath(context.projectRoot, context.extensionRoot);
  const allowed = allowedOutputs.map(out => `${relativeRoot}/${out}`);
  const outside: PhaseInvocationChange[] = [];
  for (const change of diff.changes) {
    if (!allowed.some(out => extensionActivationPathWithin(change.path, out))) outside.push(change);
    else context.observeWrite?.({
      path: path.join(context.projectRoot, change.path), pre_sha256: change.preSha256, post_sha256: change.postSha256,
    });
  }
  if (!outside.length) return { failure, residuals: [] };
  const receipts = creationReceipts(stdout, instance);
  const residuals = outside.filter(change => !removeReportedAddition(context, change, occupied, receipts));
  return { failure: [failure, `${step.id} ${action} 越界写入：${outside.map(change => change.path).join(', ')}`]
    .filter(Boolean).join('；'), residuals };
}

function addResiduals(result: ExtensionActivationResult, rows: readonly PhaseInvocationChange[]): void {
  if (!rows.length) return;
  const seen = new Map((result.residuals ?? []).map(row => [row.path, row]));
  for (const row of rows) if (!seen.has(row.path)) seen.set(row.path, row);
  result.residuals = [...seen.values()];
}

function persistenceFailure(error: unknown, result: ExtensionActivationResult): Error {
  return new Error(`启用记录写入失败：${(error as Error).message}。当前补偿结果：${JSON.stringify({
    failure: result.failure, steps: result.steps.map(({ id, status }) => ({ id, status })), residuals: result.residuals,
  })}`);
}

function readAppliedOutputs(
  context: ExtensionActivationContext, step: ExtensionActivationStep, row: ExtensionActivationStepResult,
  result: ExtensionActivationResult, requireAll: boolean,
): string[] {
  const failures: string[] = [];
  for (const relative of step.outputs) {
    try {
      const output = readOutput(context.extensionRoot, relative);
      if (output) row.outputs.push(output);
      else if (requireAll) failures.push(`缺少声明输出 ${relative}`);
    } catch (error) {
      failures.push((error as Error).message);
      addResiduals(result, [{ path: relativeExtensionPath(context.projectRoot, path.join(context.extensionRoot, relative)),
        how: 'added', preSha256: null, postSha256: null }]);
    }
  }
  return failures;
}

function removeOutput(context: ExtensionActivationContext, output: ExtensionActivationOutput): PhaseInvocationChange | undefined {
  const file = path.join(context.extensionRoot, output.path);
  let observed: ExtensionActivationOutput | undefined;
  try {
    observed = readOutput(context.extensionRoot, output.path);
    if (!observed) return undefined;
    const drift = outputDrift(output, observed);
    if (!drift || drift.kind === 'missing') {
      if (observed.kind === 'file') removeExtensionFile(file, context.observeWrite);
      else {
        const resolution = { projectRoot: context.projectRoot, protectedRoots: [relativeExtensionPath(context.projectRoot, file)] };
        const snapshot = context.observeWrite ? capturePhaseInvocationSnapshot(resolution) : undefined;
        fs.rmSync(file, { recursive: true });
        for (const entry of snapshot?.entries ?? []) context.observeWrite?.({
          path: path.join(context.projectRoot, entry.path), pre_sha256: entry.sha256, post_sha256: null,
        });
      }
      return undefined;
    }
  } catch (error) {
    if (observed) throw error;
  }
  return {
    path: relativeExtensionPath(context.projectRoot, file), how: observed && output.kind !== observed.kind ? 'type-changed' : 'modified',
    preSha256: output.sha256, postSha256: observed?.sha256 ?? null,
  };
}

export function undoExtensionActivation(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[], previous: ExtensionActivationResult,
): ExtensionActivationResult {
  parseExtensionActivationResult(context.ability, previous, steps);
  const result = structuredClone(previous);
  const pending = [...result.steps].reverse().filter(row => row.status !== 'undone');
  const declarations = new Map(steps.map(step => [step.id, step]));
  const changed = pending.find(row => row.declaration_sha256 !== digest(JSON.stringify(declarations.get(row.id))));
  if (changed) {
    result.status = 'failed';
    result.failure = `撤销待重试：步骤 ${changed.id} 的声明已改动，请恢复本次启用的声明后重试`;
    context.persist(result);
    return result;
  }
  result.status = 'running';
  let persistError: unknown;
  const remember = (): void => {
    if (persistError) return;
    try { context.persist(result); }
    catch (error) { persistError = error; }
  };
  const finish = (): ExtensionActivationResult => {
    remember();
    if (persistError) throw persistenceFailure(persistError, result);
    return result;
  };
  const commands = pending.flatMap(row => {
    const step = declarations.get(row.id)!;
    return step.undo && !row.undo_done ? [{ step, action: 'undo' as const }] : [];
  });
  preview(context, result.input_sha256, commands);
  for (const row of pending) {
    const step = declarations.get(row.id)!;
    if (row.status === 'running') readAppliedOutputs(context, step, row, result, false);
    row.status = 'undoing';
    remember();
    if (step.undo && !row.undo_done) {
      const allowed = row.outputs.filter(out => {
        try { return !outputDrift(out, readOutput(context.extensionRoot, out.path)); }
        catch { return false; }
      }).map(out => out.path);
      let execution: ReturnType<typeof invoke>;
      try {
        execution = invoke(context, result.instance_id, step, 'undo', allowed);
      } catch (error) { execution = { failure: (error as Error).message, residuals: [] }; }
      addResiduals(result, execution.residuals);
      if (execution.failure) {
        result.status = 'failed';
        result.failure = [previous.failure, `撤销待重试：${execution.failure}`].filter(Boolean).join('；');
        return finish();
      }
      row.undo_done = true;
      remember();
    }
    try {
      for (const output of [...row.outputs].reverse()) {
        const residual = removeOutput(context, output);
        if (residual) addResiduals(result, [residual]);
      }
    } catch (error) {
      result.status = 'failed';
      result.failure = [previous.failure, `清理待重试：${(error as Error).message}`].filter(Boolean).join('；');
      return finish();
    }
    row.status = 'undone';
    remember();
  }
  result.status = 'disabled';
  delete result.failure;
  return finish();
}

export function runExtensionActivation(
  context: ExtensionActivationContext, steps: readonly ExtensionActivationStep[], previous?: ExtensionActivationResult,
): ExtensionActivationResult {
  const failed = (result: ExtensionActivationResult, failure: string): ExtensionActivationResult => {
    const state: ExtensionActivationResult = { ...result, status: 'failed', failure };
    context.persist(state);
    return state;
  };
  parseExtensionActivationResult(context.ability, previous, steps);
  const attempt: ExtensionActivationResult = { instance_id: randomUUID(), status: 'running', input_sha256: digest(JSON.stringify(steps)), steps: [] };
  const remember = (draft: ExtensionActivationResult, currentNotStarted = false): void => {
    try { context.persist(draft); }
    catch (error) {
      if (currentNotStarted) draft.steps.pop();
      const undone = undoExtensionActivation({ ...context, persist: () => {} }, steps, draft);
      throw persistenceFailure(error, undone);
    }
  };
  try {
    validateExtensionActivationFiles(context.extensionRoot, context.ability, steps, context.protectedFiles);
    attempt.input_sha256 = extensionActivationInputDigest(context, steps);
  } catch (error) { return failed(previous ?? attempt, (error as Error).message); }
  if (previous?.status === 'enabled') {
    const drift = extensionActivationDrift(context.extensionRoot, previous);
    if (!drift.length && attempt.input_sha256 === previous.input_sha256) return previous;
    const conflicts = drift.filter(row => row.kind !== 'missing');
    if (conflicts.length) return failed(previous, `启用输出发生改写，先处理冲突：${conflicts.map(row => row.path).join(', ')}`);
  }
  if (previous && extensionActivationNeedsCleanup(previous)) {
    previous = undoExtensionActivation(context, steps, previous);
    if (extensionActivationNeedsCleanup(previous)) return previous;
  }
  addResiduals(attempt, previous?.residuals ?? []);
  try {
    for (const step of steps) {
      for (const relative of step.outputs) {
        if (fs.lstatSync(outputPath(context.extensionRoot, relative), { throwIfNoEntry: false })) {
          throw new Error(`声明输出已存在，未获本次启用独占归属：${relative}`);
        }
      }
    }
  } catch (error) { return failed(attempt, (error as Error).message); }
  preview(context, attempt.input_sha256, [
    ...steps.map(step => ({ step, action: 'run' as const })),
    ...[...steps].reverse().flatMap(step => step.undo ? [{ step, action: 'undo' as const }] : []),
  ]);
  for (const step of steps) {
    const row: ExtensionActivationStepResult = {
      id: step.id, declaration_sha256: digest(JSON.stringify(step)), status: 'running', outputs: [],
    };
    attempt.steps.push(row);
    remember(attempt, true);
    let execution: ReturnType<typeof invoke>;
    try { execution = invoke(context, attempt.instance_id, step, 'run', step.outputs); }
    catch (error) { execution = { failure: (error as Error).message, residuals: [] }; }
    addResiduals(attempt, execution.residuals);
    const failures = [execution.failure, ...readAppliedOutputs(context, step, row, attempt, !execution.failure)].filter(Boolean);
    row.status = 'applied';
    if (failures.length) {
      row.failure = failures.join('；');
      const pending: ExtensionActivationResult = { ...attempt, status: 'failed', failure: row.failure };
      remember(pending);
      const undone = undoExtensionActivation(context, steps, pending);
      return failed(undone, undone.failure ?? row.failure);
    }
    remember(attempt);
  }
  attempt.status = 'enabled';
  remember(attempt);
  return attempt;
}
