/**
 * Agent headless invoke — structured spawn for claude -p / codex exec / cursor-agent -p.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import crossSpawn from 'cross-spawn';
import type { UnattendedContract } from './goal-manifest';
import type { GoalCapabilitySpec } from './goal-adapter-capability';
import {
  formatHeadlessBinaryIssue,
  headlessBinarySpawnable,
  resolveHeadlessBinary,
  shouldUseCrossSpawn,
  type ResolvedHeadlessBinary,
} from './headless-binary-resolve';
import { MAISON_GOAL_HEADLESS_ENV } from './phase-state';
import { sanitizeSpawnEnv } from './process-integrity';

export interface InvokeTemplateVars {
  PROMPT_FILE: string;
  PROMPT: string;
  SKILL_PATH: string;
  PROJECT_ROOT: string;
  FRAMEWORK_ROOT: string;
  FEATURE: string;
  PHASE: string;
}

/** Tokenize templates with this sentinel, then swap for real prompt as a single argv element. */
export const PROMPT_ARGV_SENTINEL = '__MAISON_GOAL_PROMPT_ARGV__';

const KNOWN_STRUCTURED_ADAPTERS = new Set(['claude', 'codex', 'cursor', 'chrys', 'opencode']);

/** Cursor headless CLI candidates (official name first). */
export const CURSOR_HEADLESS_BINARY_CANDIDATES = ['cursor-agent', 'agent'] as const;
export const CLAUDE_HEADLESS_BINARY_CANDIDATES = ['claude'] as const;
export const CODEX_HEADLESS_BINARY_CANDIDATES = ['codex'] as const;
export const CHRYS_HEADLESS_BINARY_CANDIDATES = ['chrys'] as const;
export const OPENCODE_HEADLESS_BINARY_CANDIDATES = ['opencode'] as const;

const STRUCTURED_BINARY_CANDIDATES: Record<string, readonly string[]> = {
  cursor: CURSOR_HEADLESS_BINARY_CANDIDATES,
  claude: CLAUDE_HEADLESS_BINARY_CANDIDATES,
  codex: CODEX_HEADLESS_BINARY_CANDIDATES,
  chrys: CHRYS_HEADLESS_BINARY_CANDIDATES,
  opencode: OPENCODE_HEADLESS_BINARY_CANDIDATES,
};

/** Disabled by default — cursor-agent often streams little until phase end. Opt-in via silentWatchdogMs. */
export const DEFAULT_SILENT_WATCHDOG_MS = 0;

/** Grace after child `exit` before forcing resolve when `close` never arrives (lingering pipe). */
export const DEFAULT_CHILD_SETTLE_GRACE_MS = 3_000;

/** Hard deadline after kill requested when neither `exit` nor `close` arrives. */
export const DEFAULT_FORCE_SETTLE_AFTER_KILL_MS = 5_000;

/** Max wait for killProcessTree — kill is best-effort observability after this. */
export const DEFAULT_KILL_PROCESS_TREE_WAIT_MS = 10_000;

/** Max wait to drain in-flight kill after child settled — invoke must not hang here. */
export const DEFAULT_KILL_INFLIGHT_DRAIN_MS = 1_000;

/** Race promise against timeout; on timeout return fallback (kill path must never block settle). */
export async function awaitPromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** When streaming to outputLogPath, retain at most this much in memory for invoke result. */
export const INVOKE_OUTPUT_MEMORY_CAP = 64 * 1024;

export interface ChildSettledResult {
  exitCode: number;
  signal: string | null;
  lingering_pipe: boolean;
}

export interface AwaitChildSettledOptions {
  graceMs?: number;
  forceSettleAfterKillMs?: number;
  outputStream?: fs.WriteStream | null;
}

/** Normalize Node exit code — keep AgentInvokeResult.exitCode as number (null signal exit → 1). */
export function normalizeChildExitCode(code: number | null, sig: NodeJS.Signals | null): number {
  if (code === 0) return 0;
  if (code !== null && code !== undefined) return code;
  return 1;
}

export interface ChildSettleWaiter {
  promise: Promise<ChildSettledResult>;
  /** Arm hard deadline after timeout/silent kill when exit/close may never arrive. */
  armForceSettleAfterKill: () => void;
}

/**
 * Wait for child process settlement — exit is termination truth; close flushes stdio.
 * When close never fires (inherited pipe held by detached helper), grace then destroy + resolve.
 */
export function createChildSettleWaiter(
  child: ChildProcess,
  opts: AwaitChildSettledOptions = {},
): ChildSettleWaiter {
  const graceMs = opts.graceMs ?? DEFAULT_CHILD_SETTLE_GRACE_MS;
  const forceSettleAfterKillMs = opts.forceSettleAfterKillMs ?? DEFAULT_FORCE_SETTLE_AFTER_KILL_MS;

  let settled = false;
  let exitCode = 1;
  let signal: string | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveFn!: (r: ChildSettledResult) => void;

  const promise = new Promise<ChildSettledResult>((resolve) => {
    resolveFn = resolve;
  });

  const finalize = async (lingering_pipe: boolean): Promise<void> => {
    if (settled) return;
    settled = true;
    if (graceTimer) clearTimeout(graceTimer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (opts.outputStream) {
      await new Promise<void>((r) => opts.outputStream!.end(() => r()));
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
    resolveFn({ exitCode, signal, lingering_pipe });
  };

  const armForceSettleAfterKill = (): void => {
    if (settled || forceKillTimer) return;
    forceKillTimer = setTimeout(() => {
      void finalize(true);
    }, forceSettleAfterKillMs);
  };

  child.on('error', () => {
    exitCode = 1;
    void finalize(false);
  });

  child.on('exit', (code, sig) => {
    exitCode = normalizeChildExitCode(code, sig);
    signal = sig;
    if (settled) return;
    graceTimer = setTimeout(() => {
      void finalize(true);
    }, graceMs);
  });

  child.on('close', (code, sig) => {
    if (!settled && code !== null) {
      exitCode = normalizeChildExitCode(code, sig);
    }
    if (sig) signal = sig;
    void finalize(false);
  });

  return { promise, armForceSettleAfterKill };
}

export function renderInvokeTemplate(template: string, vars: InvokeTemplateVars): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

/** Normalize legacy bash $(cat {{PROMPT_FILE}}) templates to {{PROMPT}}. */
export function normalizeHeadlessTemplate(template: string): string {
  return template
    .replace(/"\$\(cat\s+\{\{PROMPT_FILE\}\}\)"/g, '{{PROMPT}}')
    .replace(/\$\(cat\s+\{\{PROMPT_FILE\}\}\)/g, '{{PROMPT}}')
    .replace(/"\$\(cat\s+[^"]+\)"/g, '{{PROMPT}}');
}

export interface HeadlessInvokePlan {
  argv: string[];
  /** Pass prompt via stdin (generic pipe adapters only). */
  useStdin?: boolean;
  stdin?: string;
  /** Resolved binary metadata for preflight / spawn. */
  resolvedBinary?: ResolvedHeadlessBinary | null;
  /** Windows .cmd shim — use cross-spawn instead of spawnSync. */
  useCrossSpawn?: boolean;
  /** Human-readable label for logs / dry-run. */
  label: string;
}

function attachResolvedBinary(
  argv: string[],
  candidates: readonly string[],
  label: string,
): HeadlessInvokePlan {
  const resolved = resolveHeadlessBinary([...candidates]);
  const cmd = resolved?.path ?? argv[0];
  const finalArgv = [cmd, ...argv.slice(1)];
  return {
    argv: finalArgv,
    resolvedBinary: resolved,
    useCrossSpawn: shouldUseCrossSpawn(resolved),
    label,
  };
}

function claudeArgv(prompt: string, unattended: UnattendedContract): string[] {
  const tools = unattended.allowed_tools?.length
    ? unattended.allowed_tools
    : ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
  const argv = ['claude', '-p', prompt, '--allowedTools', tools.join(',')];
  if (unattended.approval_mode === 'never') {
    argv.push('--permission-mode', 'dontAsk');
  } else {
    argv.push('--permission-mode', 'acceptEdits');
  }
  return argv;
}

function codexArgv(prompt: string, unattended: UnattendedContract): string[] {
  const argv = ['codex', 'exec'];
  argv.push(
    '--sandbox',
    unattended.write_mode === 'full-access' ? 'danger-full-access' : 'workspace-write',
  );
  argv.push(
    '--ask-for-approval',
    unattended.approval_mode === 'never' ? 'never' : 'on-request',
  );
  argv.push(prompt);
  return argv;
}

/**
 * Cursor headless — positional prompt per CLI help; -p includes write/shell.
 * approval_mode=never → --force --trust (unattended workspace trust).
 */
export function cursorHeadlessPlan(
  unattended: UnattendedContract,
  prompt: string,
  resolved: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  const binary = resolved?.path ?? 'cursor-agent';
  const argv = [binary, '-p'];
  if (unattended.approval_mode === 'never') {
    argv.push('--force', '--trust');
  }
  argv.push(prompt);
  const base = path.basename(binary);
  return {
    argv,
    resolvedBinary: resolved,
    useCrossSpawn: shouldUseCrossSpawn(resolved),
    label: `${base} -p …`,
  };
}

function genericStdinPlan(prompt: string): HeadlessInvokePlan {
  return {
    argv: ['agent-cli', '-'],
    useStdin: true,
    stdin: prompt,
    label: 'agent-cli - (stdin)',
  };
}

/** Chrys headless — file prompt when PROMPT_FILE set; positional fallback for preflight. */
function chrysArgv(vars: InvokeTemplateVars, promptContent: string): string[] {
  const argv = ['chrys', 'run'];
  if (vars.PROMPT_FILE?.trim()) {
    argv.push('--task', vars.PROMPT_FILE);
  } else {
    argv.push(promptContent);
  }
  argv.push('-C', vars.PROJECT_ROOT, '--agent', 'Code', '--json');
  return argv;
}

function chrysHeadlessPlan(vars: InvokeTemplateVars, promptContent: string): HeadlessInvokePlan {
  const argv = chrysArgv(vars, promptContent);
  return attachResolvedBinary(argv, CHRYS_HEADLESS_BINARY_CANDIDATES, 'chrys run …');
}

/**
 * OpenCode headless — stdin prompt; must not use attachResolvedBinary (drops useStdin/stdin).
 */
export function opencodeHeadlessPlan(
  vars: InvokeTemplateVars,
  promptContent: string,
): HeadlessInvokePlan {
  const resolved = resolveHeadlessBinary([...OPENCODE_HEADLESS_BINARY_CANDIDATES]);
  const binary = resolved?.path ?? 'opencode';
  const argv = [binary, 'run', '--dangerously-skip-permissions', '--dir', vars.PROJECT_ROOT];
  const base = path.basename(binary);
  return {
    argv,
    useStdin: true,
    stdin: promptContent,
    resolvedBinary: resolved,
    useCrossSpawn: shouldUseCrossSpawn(resolved),
    label: `${base} run --dangerously-skip-permissions --dir … (stdin)`,
  };
}

/** Tokenize a simple command line; respects double-quoted segments. */
export function tokenizeInvokeCommand(command: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(c)) {
      if (cur.length > 0) {
        args.push(cur);
        cur = '';
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) args.push(cur);
  return args;
}

/** Replace sentinel tokens in argv with the full prompt string (single element). */
export function injectPromptIntoArgv(argv: string[], promptContent: string): string[] {
  return argv.map((a) => (a === PROMPT_ARGV_SENTINEL ? promptContent : a));
}

function planFromTemplate(
  template: string,
  promptContent: string,
  vars: Omit<InvokeTemplateVars, 'PROMPT'>,
): HeadlessInvokePlan {
  const normalized = normalizeHeadlessTemplate(template);
  const shellPreview = renderInvokeTemplate(normalized, {
    ...vars,
    PROMPT: promptContent,
  });
  if (shellPreview.includes('| agent-cli -') || shellPreview.trim().endsWith('| agent-cli -')) {
    return genericStdinPlan(promptContent);
  }
  const tokenized = renderInvokeTemplate(normalized, {
    ...vars,
    PROMPT: PROMPT_ARGV_SENTINEL,
  });
  const argv = injectPromptIntoArgv(tokenizeInvokeCommand(tokenized), promptContent);
  const label =
    argv[0] === 'claude' ||
    argv[0] === 'codex' ||
    argv[0] === 'cursor' ||
    argv[0] === 'cursor-agent' ||
    argv[0] === 'agent'
      ? `${argv.slice(0, 3).join(' ')} …`
      : `${argv[0]} …`;
  return { argv, label };
}

/** Built-in hardened plans when adapter omits headless_invoke. */
export function defaultHeadlessInvokePlan(
  adapterName: string,
  unattended: UnattendedContract,
  promptContent: string,
): HeadlessInvokePlan {
  if (adapterName === 'claude') {
    const argv = claudeArgv(promptContent, unattended);
    return attachResolvedBinary(argv, CLAUDE_HEADLESS_BINARY_CANDIDATES, argv.slice(0, 3).join(' ') + ' …');
  }
  if (adapterName === 'codex') {
    const argv = codexArgv(promptContent, unattended);
    return attachResolvedBinary(argv, CODEX_HEADLESS_BINARY_CANDIDATES, argv.slice(0, 2).join(' ') + ' …');
  }
  if (adapterName === 'cursor') {
    const resolved = resolveHeadlessBinary([...CURSOR_HEADLESS_BINARY_CANDIDATES]);
    return cursorHeadlessPlan(unattended, promptContent, resolved);
  }
  if (adapterName === 'chrys') {
    return chrysHeadlessPlan(
      {
        PROMPT_FILE: '',
        PROMPT: promptContent,
        SKILL_PATH: '',
        PROJECT_ROOT: '.',
        FRAMEWORK_ROOT: '',
        FEATURE: '',
        PHASE: '',
      },
      promptContent,
    );
  }
  if (adapterName === 'opencode') {
    return opencodeHeadlessPlan(
      {
        PROMPT_FILE: '',
        PROMPT: promptContent,
        SKILL_PATH: '',
        PROJECT_ROOT: '.',
        FRAMEWORK_ROOT: '',
        FEATURE: '',
        PHASE: '',
      },
      promptContent,
    );
  }
  return genericStdinPlan(promptContent);
}

/** @deprecated Use defaultHeadlessInvokePlan; kept for unit tests comparing flags. */
export function defaultHeadlessInvoke(adapterName: string, unattended: UnattendedContract): string {
  const plan = defaultHeadlessInvokePlan(adapterName, unattended, '{{PROMPT}}');
  return plan.label;
}

export function resolveHeadlessInvokePlan(
  adapterName: string,
  capability: GoalCapabilitySpec,
  unattended: UnattendedContract,
  promptContent: string,
  vars: InvokeTemplateVars,
): HeadlessInvokePlan {
  if (adapterName === 'chrys') {
    return chrysHeadlessPlan(vars, promptContent);
  }
  if (adapterName === 'opencode') {
    return opencodeHeadlessPlan(vars, promptContent);
  }
  if (KNOWN_STRUCTURED_ADAPTERS.has(adapterName)) {
    return defaultHeadlessInvokePlan(adapterName, unattended, promptContent);
  }
  const custom = capability.external_runner?.headless_invoke?.trim();
  if (custom) {
    const { PROMPT: _drop, ...rest } = vars;
    return planFromTemplate(custom, promptContent, rest);
  }
  return defaultHeadlessInvokePlan(adapterName, unattended, promptContent);
}

/** Preflight: same resolution semantics as invokeAgentHeadless. */
export function validateHeadlessBinaryForPlan(
  adapterName: string,
  plan: HeadlessInvokePlan,
): { ok: true } | { ok: false; message: string } {
  const candidates = STRUCTURED_BINARY_CANDIDATES[adapterName];
  if (!candidates) return { ok: true };

  const resolved = plan.resolvedBinary ?? resolveHeadlessBinary([...candidates]);
  const issue = formatHeadlessBinaryIssue(adapterName, [...candidates], resolved);
  if (issue) return { ok: false, message: issue };
  if (!headlessBinarySpawnable(resolved)) {
    return { ok: false, message: issue || `${adapterName} 无头 CLI 不可 spawn` };
  }
  return { ok: true };
}

/** @deprecated Use resolveHeadlessInvokePlan */
export function resolveHeadlessCommand(
  adapterName: string,
  capability: GoalCapabilitySpec,
  unattended: UnattendedContract,
  vars: InvokeTemplateVars,
): string {
  const plan = resolveHeadlessInvokePlan(
    adapterName,
    capability,
    unattended,
    vars.PROMPT || '',
    vars,
  );
  return plan.label;
}

export interface KillTreeResult {
  kill_attempted: boolean;
  kill_exit_code: number | null;
  kill_error: string | null;
}

/** Kill entire child process tree (Windows taskkill /T, POSIX process group). */
export async function killProcessTree(pid: number): Promise<KillTreeResult> {
  if (!pid || pid <= 0) {
    return { kill_attempted: false, kill_exit_code: null, kill_error: null };
  }

  try {
    if (process.platform === 'win32') {
      // spawnSync blocks the event loop — awaitPromiseWithTimeout cannot interrupt a hung taskkill.
      const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        encoding: 'utf-8',
        shell: true,
      });
      const err =
        r.error?.message ??
        (r.status !== 0 ? String(r.stderr ?? r.stdout ?? '').trim().slice(0, 500) || null : null);
      return {
        kill_attempted: true,
        kill_exit_code: r.status,
        kill_error: err,
      };
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {
        return {
          kill_attempted: true,
          kill_exit_code: 1,
          kill_error: (e as Error).message,
        };
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
    try {
      process.kill(-pid, 0);
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      /* already dead */
    }
    return { kill_attempted: true, kill_exit_code: 0, kill_error: null };
  } catch (e) {
    return {
      kill_attempted: true,
      kill_exit_code: 1,
      kill_error: (e as Error).message,
    };
  }
}

export interface AgentInvokeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  skipped?: boolean;
  pid?: number;
  duration_ms?: number;
  timed_out?: boolean;
  silent_killed?: boolean;
  signal?: string | null;
  lingering_pipe?: boolean;
  kill_attempted?: boolean;
  kill_exit_code?: number | null;
  kill_error?: string | null;
}

export interface AgentInvokeOptions {
  dryRun?: boolean;
  timeoutMs?: number;
  silentWatchdogMs?: number;
  outputLogPath?: string;
  /** Called when child spawns — register tree-kill for signal handlers. */
  onActiveChild?: (ctx: { pid: number; kill: () => Promise<KillTreeResult> }) => void;
  onChildExit?: () => void;
}

function spawnHeadlessChild(
  plan: HeadlessInvokePlan,
  cwd: string,
): ChildProcess {
  const isWin = process.platform === 'win32';
  const stdio: ['pipe' | 'ignore', 'pipe', 'pipe'] = plan.useStdin
    ? ['pipe', 'pipe', 'pipe']
    : ['ignore', 'pipe', 'pipe'];

  const opts = {
    cwd,
    // P0-7①：agent 子进程同样剥离 NODE_OPTIONS 预加载注入（防经 agent 环境二次传导进工具链）。
    env: { ...sanitizeSpawnEnv(process.env).env, [MAISON_GOAL_HEADLESS_ENV]: '1' },
    stdio,
    detached: !isWin,
    shell: false as const,
  };

  if (plan.useCrossSpawn) {
    return crossSpawn(plan.argv[0], plan.argv.slice(1), opts) as ChildProcess;
  }
  return spawn(plan.argv[0], plan.argv.slice(1), opts);
}

async function spawnHeadlessAsync(
  plan: HeadlessInvokePlan,
  cwd: string,
  opts: AgentInvokeOptions,
): Promise<AgentInvokeResult> {
  const started = Date.now();
  const child = spawnHeadlessChild(plan, cwd);
  const pid = child.pid ?? 0;

  let stdout = '';
  let stderr = '';
  const retainInMemory = !opts.outputLogPath;
  const appendCaptured = (target: 'stdout' | 'stderr', chunk: string): void => {
    if (!retainInMemory) {
      const cur = target === 'stdout' ? stdout : stderr;
      const combined = cur + chunk;
      const trimmed =
        combined.length > INVOKE_OUTPUT_MEMORY_CAP
          ? combined.slice(-INVOKE_OUTPUT_MEMORY_CAP)
          : combined;
      if (target === 'stdout') stdout = trimmed;
      else stderr = trimmed;
      return;
    }
    if (target === 'stdout') stdout += chunk;
    else stderr += chunk;
  };
  let lastActivity = Date.now();
  let timedOut = false;
  let silentKilled = false;
  let exitCode = 1;
  let signal: string | null = null;
  let killResult: KillTreeResult = {
    kill_attempted: false,
    kill_exit_code: null,
    kill_error: null,
  };

  const outputStream = opts.outputLogPath
    ? fs.createWriteStream(opts.outputLogPath, { flags: 'w', encoding: 'utf-8' })
    : null;

  const bumpActivity = (chunk: string): void => {
    lastActivity = Date.now();
    if (outputStream) outputStream.write(chunk);
  };

  child.stdout?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    appendCaptured('stdout', s);
    bumpActivity(s);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    appendCaptured('stderr', s);
    bumpActivity(s);
  });

  if (plan.useStdin && plan.stdin && child.stdin) {
    child.stdin.write(plan.stdin);
    child.stdin.end();
  }

  let killInFlight: Promise<void> | null = null;
  let killTriggered = false;

  const settleWaiter = createChildSettleWaiter(child, { outputStream });

  const killTree = (reason: 'timeout' | 'silent' | 'signal'): Promise<void> => {
    if (killTriggered && killInFlight) return killInFlight;
    killTriggered = true;
    if (reason === 'timeout') timedOut = true;
    if (reason === 'silent') silentKilled = true;
    settleWaiter.armForceSettleAfterKill();
    killInFlight = (async () => {
      if (pid > 0) {
        killResult = await awaitPromiseWithTimeout(
          killProcessTree(pid),
          DEFAULT_KILL_PROCESS_TREE_WAIT_MS,
          {
            kill_attempted: true,
            kill_exit_code: null,
            kill_error: 'kill_process_tree_timeout',
          },
        );
      }
    })();
    return killInFlight;
  };

  if (pid > 0 && opts.onActiveChild) {
    opts.onActiveChild({
      pid,
      kill: async () => {
        await killTree('signal');
        return killResult;
      },
    });
  }

  const timeoutMs = opts.timeoutMs;
  const timeoutTimer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          void killTree('timeout');
        }, timeoutMs)
      : null;

  const silentMs = opts.silentWatchdogMs ?? DEFAULT_SILENT_WATCHDOG_MS;
  const silentTimer =
    silentMs != null && silentMs > 0
      ? setInterval(() => {
          if (Date.now() - lastActivity >= silentMs) {
            void killTree('silent');
          }
        }, 30_000)
      : null;

  const settled = await settleWaiter.promise;

  if (killInFlight) {
    await awaitPromiseWithTimeout(killInFlight, DEFAULT_KILL_INFLIGHT_DRAIN_MS, undefined);
  }

  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (silentTimer) clearInterval(silentTimer);

  exitCode = settled.exitCode;
  signal = settled.signal;

  opts.onChildExit?.();

  const duration_ms = Date.now() - started;

  return {
    exitCode: timedOut || silentKilled ? (exitCode === 0 ? 1 : exitCode) : exitCode,
    stdout,
    stderr,
    command: plan.label,
    pid: pid || undefined,
    duration_ms,
    timed_out: timedOut || undefined,
    silent_killed: silentKilled || undefined,
    signal,
    lingering_pipe: settled.lingering_pipe || undefined,
    kill_attempted: killResult.kill_attempted,
    kill_exit_code: killResult.kill_exit_code,
    kill_error: killResult.kill_error,
  };
}

export async function invokeAgentHeadless(
  plan: HeadlessInvokePlan,
  cwd: string,
  opts?: AgentInvokeOptions,
): Promise<AgentInvokeResult> {
  const command = plan.label;
  if (opts?.dryRun) {
    return { exitCode: 0, stdout: '[dry-run] agent invoke skipped', stderr: '', command, skipped: true };
  }

  if (plan.resolvedBinary && !headlessBinarySpawnable(plan.resolvedBinary)) {
    const adapterGuess =
      plan.argv[0]?.includes('claude') ? 'claude'
      : plan.argv[0]?.includes('codex') ? 'codex'
      : plan.argv[0]?.includes('chrys') ? 'chrys'
      : plan.argv[0]?.includes('opencode') ? 'opencode'
      : 'cursor';
    const candidates = STRUCTURED_BINARY_CANDIDATES[adapterGuess] ?? [...CURSOR_HEADLESS_BINARY_CANDIDATES];
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatHeadlessBinaryIssue(adapterGuess, [...candidates], plan.resolvedBinary),
      command,
    };
  }

  return spawnHeadlessAsync(plan, cwd, opts ?? {});
}
