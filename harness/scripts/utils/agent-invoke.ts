/**
 * Agent headless invoke — structured spawn for claude -p / codex exec / cursor-agent -p.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn, type ChildProcess } from 'child_process';
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
import { sanitizeSpawnEnv, stripTrustAnchorEnv } from './process-integrity';
import { deriveInvokeUsage, type AgentInvokeUsage, type UsageCaptureMethod } from './usage-capture';

export interface InvokeTemplateVars {
  PROMPT_FILE: string;
  PROMPT: string;
  SKILL_PATH: string;
  PROJECT_ROOT: string;
  FRAMEWORK_ROOT: string;
  FEATURE: string;
  PHASE: string;
}

/**
 * Tokenize templates with this sentinel, then swap for real prompt as a single argv element.
 * Argv-inline path is for CUSTOM external adapters only (planFromTemplate). Known structured
 * adapters (claude/codex/cursor) deliver the prompt via stdin instead — a multi-line prompt as an
 * argv element is truncated at the first newline by cmd.exe on Windows .cmd shims. A custom
 * headless_invoke that embeds {{PROMPT}} and runs through a .cmd on Windows can still hit this.
 */
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

/**
 * P0-4（plan d9b4f7e2 rev5/rev6）：wall 硬预算验收用的 kill grace——由真实 termination
 * 契约**四常量同源派生**（settle grace / force settle / tree-kill wait / inflight drain，
 * 缺一不可），取串行最坏情形的保守上界。**禁止在 goal-timeout.ts 等处另造脱钩常量**：
 * 验收不等式"进程总时长 ≤ wall 限 + resolveKillGraceMs()"只有在 grace 与实际 kill/settle
 * 参数同源时才是真上界（bounded Windows kill 落地为前提，见 killProcessTree）。
 */
export function resolveKillGraceMs(): number {
  return (
    DEFAULT_CHILD_SETTLE_GRACE_MS +
    DEFAULT_FORCE_SETTLE_AFTER_KILL_MS +
    DEFAULT_KILL_PROCESS_TREE_WAIT_MS +
    DEFAULT_KILL_INFLIGHT_DRAIN_MS
  );
}

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

/**
 * t3a（f7a3d9c2）：结构化事件/分流日志路径——与 agent-output.log 同目录。
 * attestation（t3b）绑定 agent-events.jsonl，不绑混合人读日志。
 */
export function agentEventsLogPath(outputLogPath: string): string {
  return path.join(path.dirname(outputLogPath), 'agent-events.jsonl');
}

export function agentStderrLogPath(outputLogPath: string): string {
  return path.join(path.dirname(outputLogPath), 'agent-stderr.log');
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

// Windows 铁律：prompt 不进 argv。claude 无 .exe 只有 claude.cmd → 必经 cmd.exe，
// 命令行遇换行即截断（实测多行 prompt 只剩 2 字符），故 prompt 一律走 stdin（见 defaultHeadlessInvokePlan）。
function claudeArgv(
  unattended: UnattendedContract,
  toolEventProvenance?: 'none' | 'structured_events' | 'session_transcript',
): string[] {
  const tools = unattended.allowed_tools?.length
    ? unattended.allowed_tools
    : ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
  const argv = ['claude', '-p', '--allowedTools', tools.join(',')];
  // t3a/f7a3d9c2：adapter 声明 structured_events → stdout 输出 NDJSON 事件流（含
  // tool_use/Read 验读记录，t3b runner attestation 的证据源）。2026-07-11 宿主实采样本
  // 确认事件形状；agent-output.log 仍为混合人读投影（三文件分流见 spawnHeadlessAsync），
  // 断流哨兵已适配结构化信封（goal-headless-sentinel parseClaudeStreamJsonApiError）。
  if (toolEventProvenance === 'structured_events') {
    argv.push('--output-format', 'stream-json', '--verbose');
  }
  if (unattended.approval_mode === 'never') {
    argv.push('--permission-mode', 'dontAsk');
  } else {
    argv.push('--permission-mode', 'acceptEdits');
  }
  return argv;
}

function codexArgv(unattended: UnattendedContract): string[] {
  const argv = ['codex', 'exec'];
  argv.push(
    '--sandbox',
    unattended.write_mode === 'full-access' ? 'danger-full-access' : 'workspace-write',
  );
  argv.push(
    '--ask-for-approval',
    unattended.approval_mode === 'never' ? 'never' : 'on-request',
  );
  // prompt 走 stdin（codex exec 读 stdin：实测 stderr "Reading prompt from stdin..."），不进 argv。
  return argv;
}

/**
 * Cursor headless — prompt via stdin (NOT argv: cursor-agent is a Windows .cmd shim,
 * argv prompt gets truncated at the first newline by cmd.exe). -p includes write/shell.
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
  const base = path.basename(binary);
  return {
    argv,
    useStdin: true,
    stdin: prompt,
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
  toolEventProvenance?: 'none' | 'structured_events' | 'session_transcript',
): HeadlessInvokePlan {
  if (adapterName === 'claude') {
    const argv = claudeArgv(unattended, toolEventProvenance);
    const plan = attachResolvedBinary(argv, CLAUDE_HEADLESS_BINARY_CANDIDATES, 'claude -p …');
    return { ...plan, useStdin: true, stdin: promptContent };
  }
  if (adapterName === 'codex') {
    const argv = codexArgv(unattended);
    const plan = attachResolvedBinary(argv, CODEX_HEADLESS_BINARY_CANDIDATES, 'codex exec …');
    return { ...plan, useStdin: true, stdin: promptContent };
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
    // t3a：structured_events 声明传导进内建 plan（claude 加 stream-json flags）
    return defaultHeadlessInvokePlan(adapterName, unattended, promptContent, capability.tool_event_provenance);
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

/** P1-7：adapter 版本探测结果缓存（每进程/每 binary 一次——版本探测自己不许卡 attempt）。 */
const adapterVersionCache = new Map<string, string>();

/**
 * P1-7（plan d9b4f7e2）：adapter CLI 版本**运行时探测**（`<binary> --version`，短超时、
 * 缓存、失败记 'unknown' 不阻塞）。版本随宿主环境漂移，**不硬编码进 adapter.yaml**
 * （静态能力如 output_delivery 才进 schema）。结果由 goal-runner 写入 adapter_probe
 * 事件供排障（如"哪个版本的 chrys 输出恒缓冲"这类归因）。
 */
/** probeAdapterVersion 的测试接缝（仅单测注入）。 */
export interface ProbeAdapterVersionTestSeams {
  spawnImpl?: typeof spawn;
  killTreeImpl?: (pid: number) => Promise<KillTreeResult>;
  /** 跳过缓存（单测隔离用）。 */
  noCache?: boolean;
}

export async function probeAdapterVersion(
  binary: string,
  timeoutMs = 5_000,
  testSeams?: ProbeAdapterVersionTestSeams,
): Promise<string> {
  const key = binary.trim();
  if (!key) return 'unknown';
  const cached = testSeams?.noCache ? undefined : adapterVersionCache.get(key);
  if (cached) return cached;
  const version = await new Promise<string>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (v: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    let child: ChildProcess;
    try {
      // win32 下 .cmd shim 须经 shell 解析；binary 来自 adapter.yaml 的 headless_invoke
      // 首 token（框架方维护的配置，非不可信输入）。
      child = (testSeams?.spawnImpl ?? spawn)(key, ['--version'], {
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish('unknown');
      return;
    }
    let out = '';
    child.stdout?.on('data', (c: Buffer | string) => {
      out += String(c);
    });
    child.on('error', () => finish('unknown'));
    child.on('close', (code) => {
      const line = out.split(/\r?\n/).find((l) => l.trim());
      finish(code === 0 && line ? line.trim().slice(0, 120) : 'unknown');
    });
    timer = setTimeout(() => {
      // 复审修复（codex P2）：win32 下 shell:true 时 child.kill 只杀 shell 壳，CLI 孙进程
      // 可能存活并持有 stdio 阻止根进程退出——改用 bounded killProcessTree（taskkill /T
      // 全树、helper 自身有界）+ 销毁 stdio/监听（与 bounded taskkill 同套收尾）。
      if (child.pid) {
        void (testSeams?.killTreeImpl ?? killProcessTree)(child.pid);
      } else {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
      try {
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {
        /* stdio 可能已关 */
      }
      child.removeAllListeners();
      child.unref();
      finish('unknown');
    }, timeoutMs);
    // 注意：不 unref timer——它是 resolve 兜底路径（同 killProcessTree 的教训）。
  });
  if (!testSeams?.noCache) {
    adapterVersionCache.set(key, version);
  }
  return version;
}

/** killProcessTree 的测试接缝（仅单测注入；生产调用一律走默认值）。 */
export interface KillProcessTreeTestSeams {
  /** 替换 taskkill 执行器（stub "永不退出的 helper" 场景）。 */
  execFileImpl?: typeof execFile;
  /** 替换有界等待上限（默认 DEFAULT_KILL_PROCESS_TREE_WAIT_MS，测试缩短避免 10s 等待）。 */
  waitMs?: number;
  /** 非 win32 平台强制走 win32 分支（bounded taskkill 逻辑的跨平台单测）。 */
  forceWin32?: boolean;
}

/** Kill entire child process tree (Windows taskkill /T, POSIX process group). */
export async function killProcessTree(
  pid: number,
  testSeams?: KillProcessTreeTestSeams,
): Promise<KillTreeResult> {
  if (!pid || pid <= 0) {
    return { kill_attempted: false, kill_exit_code: null, kill_error: null };
  }

  try {
    if (process.platform === 'win32' || testSeams?.forceWin32) {
      // P0-4 rev5/rev6（plan d9b4f7e2）：taskkill 有界化。旧实现 spawnSync 阻塞 event loop
      // ——外围 timeout 中断不了卡死的 taskkill，agent/harness 两条 hard wall 全部失界。
      // 现改异步 execFile（shell:false，路径/参数不过 cmd 解析）+ helper 自身有界等待；
      // 超时后**主动结束 helper 并销毁 stdio/监听**（存活 helper 持有 pipe/handle 仍会
      // 阻止 Node 退出，"放弃等待"不够）→ 返回 kill_process_tree_timeout（kill 转
      // best-effort 观测，与 DEFAULT_KILL_PROCESS_TREE_WAIT_MS 注释既有语义一致）。
      return await new Promise<KillTreeResult>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (r: KillTreeResult): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(r);
        };
        const execFileImpl = testSeams?.execFileImpl ?? execFile;
        let helper: ChildProcess;
        try {
          helper = execFileImpl(
            'taskkill.exe',
            ['/PID', String(pid), '/T', '/F'],
            { shell: false, windowsHide: true },
            (error, stdout, stderr) => {
              const code = (error as { code?: number | string } | null)?.code;
              const exit = error ? (typeof code === 'number' ? code : 1) : 0;
              const err = error
                ? String(stderr || stdout || error.message).trim().slice(0, 500) || null
                : null;
              finish({ kill_attempted: true, kill_exit_code: exit, kill_error: err });
            },
          );
        } catch (e) {
          finish({ kill_attempted: true, kill_exit_code: 1, kill_error: (e as Error).message });
          return;
        }
        timer = setTimeout(() => {
          try {
            helper.kill('SIGKILL');
          } catch {
            /* helper 可能已死 */
          }
          try {
            helper.stdout?.destroy();
            helper.stderr?.destroy();
            helper.stdin?.destroy();
          } catch {
            /* stdio 可能已关 */
          }
          helper.removeAllListeners();
          helper.unref();
          finish({
            kill_attempted: true,
            kill_exit_code: null,
            kill_error: 'kill_process_tree_timeout',
          });
        }, testSeams?.waitMs ?? DEFAULT_KILL_PROCESS_TREE_WAIT_MS);
        // 注意：本 timer **不得 unref**——它是 promise resolve 的唯一兜底路径；unref 后
        // 事件循环若只剩它，Node 会在 timer 到点前静默退出（code 0），await 方永久悬挂。
        // timer 本身有界（≤10s）且 finish 会 clearTimeout，不构成进程滞留风险。
      });
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
  /** C-ab-eval：按 adapter 声明采集的用量（采集失败/none → confidence: proxy，token 字段 null） */
  usage?: AgentInvokeUsage;
}

export interface AgentInvokeOptions {
  dryRun?: boolean;
  timeoutMs?: number;
  silentWatchdogMs?: number;
  outputLogPath?: string;
  /** adapter goal_capability.usage_capture 声明（缺省 none）；结果回填 AgentInvokeResult.usage */
  usageCapture?: UsageCaptureMethod;
  /**
   * t1（f7a3d9c2）：注入给 agent 子进程的额外 env（MAISON_GOAL_RUN_ID/MAISON_GOAL_ATTEMPT
   * ——agent 会话内自跑 harness 与外层 gate 共用同一轮次身份）。
   */
  extraEnv?: Record<string, string>;
  /**
   * t3a（f7a3d9c2）：adapter 声明 structured_events 时启用三文件分流——
   * agent-events.jsonl（仅 stdout，NDJSON 纯净，attestation 绑定对象）+
   * agent-stderr.log（stderr 分流）+ agent-output.log（人读混合投影，既有消费者不动）。
   * stdout/stderr 混写一个流会让 stderr 插行破坏 NDJSON（codex 实锤）。
   */
  toolEventCapture?: 'none' | 'structured_events' | 'session_transcript';
  /** Called when child spawns — register tree-kill for signal handlers. */
  onActiveChild?: (ctx: { pid: number; kill: () => Promise<KillTreeResult> }) => void;
  onChildExit?: () => void;
}

function spawnHeadlessChild(
  plan: HeadlessInvokePlan,
  cwd: string,
  extraEnv?: Record<string, string>,
): ChildProcess {
  const isWin = process.platform === 'win32';
  const stdio: ['pipe' | 'ignore', 'pipe', 'pipe'] = plan.useStdin
    ? ['pipe', 'pipe', 'pipe']
    : ['ignore', 'pipe', 'pipe'];

  const opts = {
    cwd,
    // P0-7①：agent 子进程同样剥离 NODE_OPTIONS 预加载注入（防经 agent 环境二次传导进工具链）。
    // t10（codex 六轮 P0-2）：信任锚材料（MAISON_HMAC_*/MAISON_TRUST_REGISTRY）不进 agent env。
    env: {
      ...stripTrustAnchorEnv(sanitizeSpawnEnv(process.env).env).env,
      [MAISON_GOAL_HEADLESS_ENV]: '1',
      ...(extraEnv ?? {}),
    },
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
  const child = spawnHeadlessChild(plan, cwd, opts.extraEnv);
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

  // t3a（f7a3d9c2）：structured_events 三文件分流——events 文件只收 stdout（NDJSON 纯净，
  // attestation 绑定对象）、stderr 单独分流；agent-output.log 保持混合人读投影（哨兵/
  // 心跳/no-output 等既有消费者行为不变）。
  const splitStreams =
    opts.toolEventCapture === 'structured_events' && opts.outputLogPath
      ? {
          events: fs.createWriteStream(agentEventsLogPath(opts.outputLogPath), { flags: 'w', encoding: 'utf-8' }),
          stderr: fs.createWriteStream(agentStderrLogPath(opts.outputLogPath), { flags: 'w', encoding: 'utf-8' }),
        }
      : null;

  const bumpActivity = (chunk: string): void => {
    lastActivity = Date.now();
    if (outputStream) outputStream.write(chunk);
  };

  child.stdout?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    appendCaptured('stdout', s);
    if (splitStreams) splitStreams.events.write(s);
    bumpActivity(s);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    appendCaptured('stderr', s);
    if (splitStreams) splitStreams.stderr.write(s);
    bumpActivity(s);
  });

  if (plan.useStdin && plan.stdin && child.stdin) {
    child.stdin.write(plan.stdin);
    child.stdin.end();
  }

  let killInFlight: Promise<void> | null = null;
  let killTriggered = false;

  const settleWaiter = createChildSettleWaiter(child, { outputStream });
  if (splitStreams) {
    child.on('close', () => {
      splitStreams.events.end();
      splitStreams.stderr.end();
    });
  }

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
    // usage 是旁路事实：按声明采集，失败降 proxy，不影响主流程
    usage: deriveInvokeUsage(opts.usageCapture, stdout, stderr),
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
