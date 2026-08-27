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
import { MAISON_GOAL_HEADLESS_ENV, MAISON_GOAL_MODEL_PIN_ENV, applyGoalModelPinEnv } from './phase-state';
import { deleteEnvKeyCaseInsensitive, sanitizeSpawnEnv, stripTrustAnchorEnv } from './process-integrity';
import { deriveInvokeUsage, type AgentInvokeUsage, type UsageCaptureMethod } from './usage-capture';
import {
  createCodexTerminalScanner,
  resolveTerminalEventParser,
  type CodexTerminalScanner,
  type TerminalEventParser,
} from './codex-terminal-events';

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

const KNOWN_STRUCTURED_ADAPTERS = new Set(['claude', 'codeagent', 'codex', 'cursor', 'chrys', 'opencode']);

/** Cursor headless CLI candidates (official name first). */
export const CURSOR_HEADLESS_BINARY_CANDIDATES = ['cursor-agent', 'agent'] as const;
export const CLAUDE_HEADLESS_BINARY_CANDIDATES = ['claude'] as const;
/** codeagent（Claude Code 内核 fork，plan c7a9e2f4）：CLI=codeagentcli，argv 与 claude -p 等价（2026-07-29 宿主实证）。 */
export const CODEAGENT_HEADLESS_BINARY_CANDIDATES = ['codeagentcli'] as const;
export const CODEX_HEADLESS_BINARY_CANDIDATES = ['codex'] as const;
export const CHRYS_HEADLESS_BINARY_CANDIDATES = ['chrys'] as const;
export const OPENCODE_HEADLESS_BINARY_CANDIDATES = ['opencode'] as const;

export const STRUCTURED_BINARY_CANDIDATES: Record<string, readonly string[]> = {
  cursor: CURSOR_HEADLESS_BINARY_CANDIDATES,
  claude: CLAUDE_HEADLESS_BINARY_CANDIDATES,
  codeagent: CODEAGENT_HEADLESS_BINARY_CANDIDATES,
  codex: CODEX_HEADLESS_BINARY_CANDIDATES,
  chrys: CHRYS_HEADLESS_BINARY_CANDIDATES,
  opencode: OPENCODE_HEADLESS_BINARY_CANDIDATES,
};

// 【静默看门狗生产链已删除 · plan e6b3f8d2 t1】
// 旧常量恒 0（禁用）且 goal-runner 从未 opt-in——一个从未生效的「第二判死权威」。
// 静默本就不是判据（cursor-agent「streams little until phase end」），FAIL 收口改由
// adapter terminal 契约承接（见 codex-terminal-events.ts）。
// 读侧兼容保留：AgentInvokeResult 的 `silent_killed?` 字段与历史事件仍可读，
// 但**写侧不再产生**该事实（源码锚定回归见 goal-runner-hardening.unit.test.ts）。

/** t4 完成观测：探针轮询间隔。2s 足够快（相对 90min 预算），又不至于打爆磁盘 IO。 */
export const DEFAULT_COMPLETION_POLL_MS = 2_000;
/**
 * t4 完成观测：命中后等待自然退出的宽限。
 * 给足一个正常收尾的窗口（agent 可能正在写最后一行日志），又不至于把"已完成"拖长——
 * 实际生效值再取 min(该值, deadlineMs - now)。
 */
export const DEFAULT_COMPLETION_GRACE_MS = 5_000;

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
  /**
   * plan d7f3a9c4 t4：child spawn race 的结构化事实（binary preflight 通过后 spawn 仍失败）。
   * 与 resolvedBinary 短路路径（invokeAgentHeadless）产出**同一种**事实——不靠 stderr 猜
   * spawn failure。
   */
  spawn_error?: { code?: string; message: string };
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
  /** t4：进程是否已 settle——完成观测的 grace 到点后据此决定还要不要 tree-kill。 */
  isSettled: () => boolean;
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
  let spawnError: { code?: string; message: string } | undefined;
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
    resolveFn({
      exitCode,
      signal,
      lingering_pipe,
      ...(spawnError ? { spawn_error: spawnError } : {}),
    });
  };

  const armForceSettleAfterKill = (): void => {
    if (settled || forceKillTimer) return;
    forceKillTimer = setTimeout(() => {
      void finalize(true);
    }, forceSettleAfterKillMs);
  };

  // plan d7f3a9c4 t4：不再丢弃 spawn 错误对象——结构化保留 {code, message}（resolvedBinary
  // 短路与真实 child error 同构，见 invokeAgentHeadless）。spawn race 是 t4 新增硬失败之一。
  child.on('error', (err) => {
    const e = err as NodeJS.ErrnoException;
    spawnError = { code: e.code, message: e.message };
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

  return { promise, armForceSettleAfterKill, isSettled: () => settled };
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
  /**
   * 生成本 plan 的 adapter 名（plan c7a9e2f4 #5b）：诊断信息（binary 不可执行时的候选提示）
   * 优先取此字段，argv[0] 子串猜测仅作 custom headless_invoke 的兜底——
   * codeagentcli 不含任何旧子串，纯猜测会误报成 cursor。
   */
  adapterName?: string;
}

function attachResolvedBinary(
  argv: string[],
  candidates: readonly string[],
  label: string,
  preResolved?: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  // plan c4e8a1f7 T1a：session 级解析结果优先——probe/canary/formal invoke 同一绝对路径；
  // 未注入时才现场解析（兼容既有单测/直调方）。
  const resolved = preResolved ?? resolveHeadlessBinary([...candidates]);
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
// binary 参数化（plan c7a9e2f4）：codeagent（codeagentcli）与 claude argv 逐 flag 等价
//（-p / --output-format stream-json --verbose 均 2026-07-29 宿主实证可用），复用全套。
//
// plan a8e5c3f9 t1：headless 全权限契约——用户主动启动 Goal/headless 即授权
// non-interactive + no approval prompt + full execution，adapter 只翻译不降级：
// · --dangerously-skip-permissions 取代 --permission-mode dontAsk/acceptEdits
//   （dontAsk=「不询问、未批准即拒绝」并非 bypass——宿主实锤：prompt 要求自跑 harness，
//   npx 未预批准 → permission_denied，agent 只能盲猜退出烧 retry）；
// · --allowedTools 整体移除：它是审批清单，bypass 下无审批意义，保留只会延续错误抽象
//   （manifest 的 allowed_tools 字段 deprecated/ignored，不再影响任何执行面）。
// · 本函数不再读取 unattended 权限字段——argv 结构上不可能随 manifest 摇摆。
// （--dangerously-skip-permissions 于 claude CLI 2026-08-17 本机探针确认存在；
//   codeagentcli 旗标等价性沿 c7a9e2f4 宿主实证结论，最终以宿主实测为准。）
function claudeArgv(
  toolEventProvenance?: 'none' | 'structured_events' | 'session_transcript',
  binary: string = 'claude',
  modelPin?: string,
): string[] {
  const argv = [binary, '-p', '--dangerously-skip-permissions'];
  // t3a/f7a3d9c2：adapter 声明 structured_events → stdout 输出 NDJSON 事件流（含
  // tool_use/Read 验读记录，t3b runner attestation 的证据源）。2026-07-11 宿主实采样本
  // 确认事件形状；agent-output.log 仍为混合人读投影（三文件分流见 spawnHeadlessAsync），
  // 断流哨兵已适配结构化信封（goal-headless-sentinel parseClaudeStreamJsonApiError）。
  if (toolEventProvenance === 'structured_events') {
    argv.push('--output-format', 'stream-json', '--verbose');
  }
  // plan d7f3a9c4 t1：显式模型钉回放（claude 与 codeagent 共用本函数，仅 binary 不同）。
  if (modelPin !== undefined) {
    argv.push('--model', modelPin);
  }
  return argv;
}

function codexArgv(modelPin?: string): string[] {
  // 事故修复（plan c9f4e7a2 t2）：`--ask-for-approval` 是 **codex 顶层旗标**，必须放在
  // `exec` 之前。0.138.0 实测：`codex -a never exec --help` 成功；
  // `codex exec -a never --help` → `unexpected argument '-a' found`。
  // plan a8e5c3f9 t2：headless 全权限固定化——恒 approval never + danger-full-access，
  // 不再读取 manifest 的 write_mode/approval_mode 决定 argv（任意旧 unattended 输入
  // 最终 argv 相同）。
  const argv = ['codex', '--ask-for-approval', 'never', 'exec'];
  // plan d7f3a9c4 t1：显式模型钉回放——`--model` 置于 `exec` 与 `--sandbox` 之间
  // （位置随 c9 t2 修正后形态：exec --model <v> --sandbox <m>）。取消数据裸值陷阱：
  // 不使用 `-c model=<raw>`。
  if (modelPin !== undefined) {
    argv.push('--model', modelPin);
  }
  argv.push('--sandbox', 'danger-full-access');
  // plan e6b3f8d2 t1：terminal 收口——`--json` 让 exec 把事件按 JSONL 打到 stdout
  //（本机 codex-cli 0.149.0 实证，`--json` 置于既有旗标之后不影响 c9f4e7a2/d7f3a9c4
  // 已验证的 `exec [--model <v>] --sandbox <m>` 顺序）。**由 codexArgv 独立追加**：
  // 它与 `tool_event_provenance` 无关（那是「工具调用证据可审计」能力，codex 仍为 none），
  // 不得靠工具证据字段触发，也不因此签发 verified critic 回执。
  // 收口消费方=codex-terminal-events.createCodexTerminalScanner。
  argv.push('--json');
  // prompt 走 stdin（codex exec 读 stdin：实测 stderr "Reading prompt from stdin..."），不进 argv。
  return argv;
}

/**
 * Cursor headless — prompt via stdin (NOT argv: cursor-agent is a Windows .cmd shim,
 * argv prompt gets truncated at the first newline by cmd.exe). -p includes write/shell.
 * plan a8e5c3f9 t3：headless 恒 --force --trust（全权限契约，不再随旧 approval_mode 摇摆）。
 */
export function cursorHeadlessPlan(
  prompt: string,
  resolved: ResolvedHeadlessBinary | null,
  modelPin?: string,
): HeadlessInvokePlan {
  const binary = resolved?.path ?? 'cursor-agent';
  const argv = [binary, '-p', '--force', '--trust'];
  // plan d7f3a9c4 t1：显式模型钉回放——`--model <v>`。
  if (modelPin !== undefined) {
    argv.push('--model', modelPin);
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

/**
 * plan a8e5c3f9 t5：headless 全权限支持性判定（内建 adapter 由框架维护映射）。
 * · claude：bypass 旗标已固化且**宿主实跑验收通过**（2026-08-17：
 *   `claude -p --output-format stream-json --verbose --dangerously-skip-permissions`
 *   真实执行 `npx ts-node --version` 成功，permission_denials=[]——正是 cb1583 事故里
 *   被 dontAsk 拒绝的命令类型）；
 * · codex/cursor/opencode：bypass 旗标已固化在本文件 argv 构造中；
 * · codeagent：argv 与 claude 共用（claudeArgv，binary=codeagentcli）。用户已裁决放行
 *   （plan c4e8a1f7 T1b）：既有 --dangerously-skip-permissions / stdin / stream-json /
 *   Read parser 链全部复用，真实 CLI flag 风险由统一 hard-CLI 早停承接（不预猜签名）；
 *   宿主 smoke 记录 `codeagentcli --help`/version 后跑最短 Goal-mode。
 * · chrys：非交互全权限（bypass）参数**至今未经宿主核实**（adapter.yaml 自注「待核实」，
 *   2026-08-17 本机 PATH 无 chrys 可探）——契约要求 non-interactive + no approval +
 *   full execution，核实前不得宣称支持 Goal/headless 却以未知/残权限静默启动；
 * · 其余名字视为 custom adapter：external_runner.headless_invoke 即提供方契约
 *  （声明=断言该命令为 non-interactive full-permission 启动命令），Maison 不猜旗标、
 *   不加白名单、不新增 attestation schema。
 */
export function assertAdapterHeadlessFullPermission(
  adapterName: string,
): { ok: true } | { ok: false; reason: string } {
  if (adapterName === 'chrys') {
    return {
      ok: false,
      reason:
        'adapter_headless_permission_unsupported: chrys 的非交互全权限（bypass）CLI 参数未经核实。' +
        'Maison headless 契约=non-interactive + no approval prompt + full execution，' +
        '不得以未知/残权限静默启动。请在宿主运行 `chrys run --help` 核实等价旗标后接入' +
        '（agent-invoke.ts + agents/chrys/adapter.yaml），或改用 claude/codex/cursor/opencode/codeagent。',
    };
  }
  return { ok: true };
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

function chrysHeadlessPlan(
  vars: InvokeTemplateVars,
  promptContent: string,
  resolvedBinary?: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  const argv = chrysArgv(vars, promptContent);
  return attachResolvedBinary(argv, CHRYS_HEADLESS_BINARY_CANDIDATES, 'chrys run …', resolvedBinary);
}

/**
 * OpenCode headless — stdin prompt; must not use attachResolvedBinary (drops useStdin/stdin).
 */
export function opencodeHeadlessPlan(
  vars: InvokeTemplateVars,
  promptContent: string,
  modelPin?: string,
  resolvedBinary?: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  const resolved = resolvedBinary ?? resolveHeadlessBinary([...OPENCODE_HEADLESS_BINARY_CANDIDATES]);
  const binary = resolved?.path ?? 'opencode';
  const argv = [binary, 'run', '--dangerously-skip-permissions', '--dir', vars.PROJECT_ROOT];
  // plan d7f3a9c4 t1：显式模型钉回放——opencode 用 `-m <v>`（非 --model）。
  if (modelPin !== undefined) {
    argv.push('-m', modelPin);
  }
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
    argv[0] === 'codeagentcli' ||
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
  modelPin?: string,
  // plan c4e8a1f7 T1a：session 级 resolved binary 注入（probe/canary/formal invoke 同身份）
  resolvedBinary?: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  if (adapterName === 'claude') {
    const argv = claudeArgv(toolEventProvenance, 'claude', modelPin);
    const plan = attachResolvedBinary(argv, CLAUDE_HEADLESS_BINARY_CANDIDATES, 'claude -p …', resolvedBinary);
    return { ...plan, adapterName, useStdin: true, stdin: promptContent };
  }
  // codeagent（plan c7a9e2f4）：Claude Code 内核 fork，argv 全套复用（仅二进制名不同）；
  // prompt 走 stdin 同款铁律（codeagentcli 亦为 Windows cmd shim，实证 stdin 喂 prompt 可用）。
  if (adapterName === 'codeagent') {
    const argv = claudeArgv(toolEventProvenance, 'codeagentcli', modelPin);
    const plan = attachResolvedBinary(argv, CODEAGENT_HEADLESS_BINARY_CANDIDATES, 'codeagentcli -p …', resolvedBinary);
    return { ...plan, adapterName, useStdin: true, stdin: promptContent };
  }
  if (adapterName === 'codex') {
    const argv = codexArgv(modelPin);
    const plan = attachResolvedBinary(argv, CODEX_HEADLESS_BINARY_CANDIDATES, 'codex exec …', resolvedBinary);
    return { ...plan, adapterName, useStdin: true, stdin: promptContent };
  }
  if (adapterName === 'cursor') {
    const resolved = resolvedBinary ?? resolveHeadlessBinary([...CURSOR_HEADLESS_BINARY_CANDIDATES]);
    return { ...cursorHeadlessPlan(promptContent, resolved, modelPin), adapterName };
  }
  if (adapterName === 'chrys') {
    const plan = chrysHeadlessPlan(
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
      resolvedBinary,
    );
    return { ...plan, adapterName };
  }
  if (adapterName === 'opencode') {
    const plan = opencodeHeadlessPlan(
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
      modelPin,
      resolvedBinary,
    );
    return { ...plan, adapterName };
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
  modelPin?: string,
  // plan c4e8a1f7 T1a：session 级 resolved binary 注入（内建 adapter argv[0] 使用同一绝对路径）
  resolvedBinary?: ResolvedHeadlessBinary | null,
): HeadlessInvokePlan {
  if (adapterName === 'chrys') {
    return chrysHeadlessPlan(vars, promptContent, resolvedBinary);
  }
  if (adapterName === 'opencode') {
    return opencodeHeadlessPlan(vars, promptContent, modelPin, resolvedBinary);
  }
  if (KNOWN_STRUCTURED_ADAPTERS.has(adapterName)) {
    // t3a：structured_events 声明传导进内建 plan（claude 加 stream-json flags）；
    // d7f3a9c4 t1：显式模型钉随 modelPin 回放；c4e8a1f7 T1a：session binary 复用。
    return defaultHeadlessInvokePlan(
      adapterName, unattended, promptContent, capability.tool_event_provenance, modelPin, resolvedBinary,
    );
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
      // plan c4e8a1f7 T1a：probe 必须吃 session 解析出的**绝对路径**（含 .cmd shim）。
      // win32 下 .cmd/.bat 经 cross-spawn（免 shell 解析、路径含空格也安全）；
      // 其余走注入的 spawnImpl（shell 仅作遗留兜底——绝对路径裸名不再依赖 PATH）。
      const isWin = process.platform === 'win32';
      const isCmdShim = isWin && /\.(cmd|bat)$/i.test(key);
      const spawnImpl =
        isCmdShim
          ? (testSeams?.spawnImpl ?? crossSpawn as unknown as typeof spawn)
          : (testSeams?.spawnImpl ?? spawn);
      child = spawnImpl(key, ['--version'], {
        shell: isWin && !isCmdShim ? true : false,
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
  /**
   * t4：本次 invocation 因**完成证据确定性成立**而收口（非超时、非静默杀、非 agent 失败）。
   * 上层据此走正常 gate 流程，绝不按失败路径重试一个已完成的阶段。
   */
  completion_observed?: boolean;
  /**
   * plan e6b3f8d2 t1：adapter terminal 契约观测到**失败终态**（codex `turn.failed`）。
   * 与 completion_observed **互斥**——failed 恒不置 completion_observed，且最终
   * exitCode===0 时规范化为非零（复用 timedOut 同款），保住 goal-runner-phase
   * `agentFailed = exitCode!==0 && completionObserved!==true` 的失败语义。
   */
  terminal_failure_observed?: boolean;
  /**
   * plan e6b3f8d2 t1：terminal 事件里的**纯诊断**摘要——`turn.failed` 的错误正文与
   * 顶层 `error` 事件（后者非契约终态：error→重试成功→turn.completed 合法）。
   * 只进 `agent_invoke_end` 供排障，**不参与**任何 settle / classifier / retry 判据。
   */
  terminal_error_excerpt?: string;
  signal?: string | null;
  lingering_pipe?: boolean;
  kill_attempted?: boolean;
  kill_exit_code?: number | null;
  kill_error?: string | null;
  /** C-ab-eval：按 adapter 声明采集的用量（采集失败/none → confidence: proxy，token 字段 null） */
  usage?: AgentInvokeUsage;
  /**
   * plan d7f3a9c4 t4：child spawn race 的结构化事实（resolvedBinary 短路与真实 child error
   * 同一种 shape）——金丝雀硬失败分类据此判定，不靠 stderr 猜。
   */
  spawn_error?: { code?: string; message: string };
}

export interface AgentInvokeOptions {
  dryRun?: boolean;
  timeoutMs?: number;
  /**
   * plan e6b3f8d2 t1：terminal 事件解析器。缺省按 plan.adapterName 解析
   *（codex → codex_turn_jsonl，其余 none）；显式传入仅供单测注入。
   */
  terminalEventParser?: TerminalEventParser;
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
  /**
   * t2（plan c6a9e4d2）：Windows agent containment 上下文。非空且 win32 时，
   * agent 经 guardian（KILL_ON_JOB_CLOSE Job）启动：spawn 返回的 child.pid 即
   * **guardian** 的 pid，agent 是 Job 成员——kill guardian = 整树团灭。
   * 身份 token（t3）由 guardian argv 显式携带：`<runId>/<invokeId>`。
   */
  containment?: { runId: string; invokeId: string } | null;
  /**
   * openspec device-readiness-and-completion t4：**完成观测探针**。
   *
   * 背景（07-28 事故）：agent 的 turn 已 `turn_ended status=success`、receipt 四条件齐全
   * 在盘，但进程被自己拉起的后台模拟器钉住不退出——框架空等 84 分钟到 hard timeout，
   * 而超时后 gate harness 只用 13 秒就判了 PASS。判据一直可用，只是没人问。
   *
   * **分层**：本模块是通用进程层，只负责 timer/race/kill，**不得依赖 receipt schema**。
   * 判据由 goal-runner 以回调注入：返回 true = 本 attempt 的完成证据已确定性成立。
   * 探针须为纯只读（不得启动会写盘的 CLI），异常/半写入一律返回 false 由下轮重试。
   *
   * 命中后：等 `completionGraceMs` 让进程自然退出，仍存活则 tree-kill 本次 invocation，
   * 结果记 `completion_observed`（**不是** timed_out / silent_killed / agent_failed）。
   */
  completionProbe?: () => boolean;
  /** 探针轮询间隔（默认 2s） */
  completionPollMs?: number;
  /** 命中后等待自然退出的宽限（默认 5s；实际取 min(该值, deadlineMs-now)） */
  completionGraceMs?: number;
  /**
   * 本次 invocation 的**绝对** deadline（epoch ms）。grace 不得越过它——
   * 否则收口反而把 run 拖过 wall-clock 预算。
   */
  deadlineMs?: number;
}

/**
 * agent 子进程 env（b7e4d2a9 Todo3 顺序钉死，纯函数可测）：
 *   process.env + extraEnv 合并 → 强制 HEADLESS=1（角色位不由调用方覆盖）→
 *   最终 sanitize（NODE_OPTIONS 预加载）+ stripTrustAnchorEnv（HMAC/registry/
 *   checkpoint 路径/GATE 写权限标，大小写不敏感）→ 交 spawn。
 * 旧顺序 strip 在前、extraEnv 在后展开——extraEnv 可回带 GATE/HMAC，也可覆盖
 * HEADLESS 角色位（cursor 丢 env 事故的修复面之一）。
 */
export function buildAgentSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  extraEnv?: Record<string, string>,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...baseEnv };
  // d9e4b7c1 T1（v12 P2 泛化）：extraEnv 每个键先清大小写变体再写唯一键——父环境存在
  // `Harness_Device_Test_Product` 等 mixed-case 变体时，直接展开会留两个等价 Windows
  // env key，子进程读取哪个是未定义行为（HEADLESS 单键处理的既有教训推广到全部注入键）。
  for (const [k, v] of Object.entries(extraEnv ?? {})) {
    deleteEnvKeyCaseInsensitive(merged, k);
    merged[k] = v;
  }
  // plan d7f3a9c4 t3：model pin 只随 extraEnv 显式带入——无 pin（extraEnv 缺键/空值）时显式
  // 清理父环境残留（含大小写变体），不得让陈旧 pin 漏入 agent 子进程冒充"已钉"。走共享
  // 执行器 applyGoalModelPinEnv（与 gateInjectedEnv / goalIdentity child env 同源）。
  applyGoalModelPinEnv(merged, extraEnv?.[MAISON_GOAL_MODEL_PIN_ENV]);
  // Goal agents never receive a caller-provided diff baseline; manifest.run_base_sha is the SSOT.
  deleteEnvKeyCaseInsensitive(merged, 'HARNESS_DIFF_BASE_REF');
  // 角色位定档前先清大小写变体（extraEnv 注入 `maison_goal_headless=''` 会与大写键并存，
  // Windows 子进程读取哪个是未定义行为）——保证子进程 env 恰有一个大写 HEADLESS='1'。
  deleteEnvKeyCaseInsensitive(merged, MAISON_GOAL_HEADLESS_ENV);
  merged[MAISON_GOAL_HEADLESS_ENV] = '1';
  return stripTrustAnchorEnv(sanitizeSpawnEnv(merged).env).env;
}

function spawnGuardianFailureStub(message: string, code: string): ChildProcess {
  // containment 结构性不可用（powershell/脚本/binary 解析失败）——不 spawn，
  // 返回一个立即失败的桩 child（与 spawn error 同构，调用方按 spawn 失败处理）。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require('events') as typeof import('events');
  const stub = new EventEmitter() as ChildProcess;
  process.nextTick(() => {
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    stub.emit('error', err);
  });
  return stub;
}

// win32 + containment 时 child.pid 是 **guardian** 的 pid（agent 为 Job 成员）。
// guardian 自身不产生任何 stdout 消费（stdio 透传 agent），kill guardian =
// 整树团灭（KILL_ON_JOB_CLOSE），与 killProcessTree(pid) 的既有语义兼容。
export function spawnHeadlessChild(
  plan: HeadlessInvokePlan,
  cwd: string,
  opts: Pick<AgentInvokeOptions, 'extraEnv' | 'containment'>,
): ChildProcess {
  const isWin = process.platform === 'win32';
  const stdio: ['pipe' | 'ignore', 'pipe', 'pipe'] = plan.useStdin
    ? ['pipe', 'pipe', 'pipe']
    : ['ignore', 'pipe', 'pipe'];

  // t2（plan c6a9e4d2）：Windows containment 分支——agent 先入 KILL_ON_JOB_CLOSE
  // Job 再执行用户代码（guardian 内部 SUSPENDED → assign → resume，无竞态窗口）。
  // 失败=invoke 失败如实上浮（fail-closed），绝不绕过 containment 放行。
  // 非 Windows / attended / dry-run 零变化（本分支不进）。
  if (isWin && opts.containment) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const containment = require('./agent-containment') as typeof import('./agent-containment');
    const token = `${opts.containment.runId}/${opts.containment.invokeId}`;
    // P1-7/二轮 review：command line 组装/转义收在本层（标准 Windows argv quoting；
    // cmd shim 一律**解包到 direct 目标**，不经 cmd /C——%VAR% 展开在引号内仍生效
    // 且无可靠转义，实测），guardian 只做 CreateProcess(appName, commandLine)。
    const resolved = containment.resolveAgentCommand(plan.argv);
    if ('error' in resolved) {
      return spawnGuardianFailureStub(resolved.error, 'MAISON_GUARDIAN_BINARY_UNRESOLVED');
    }
    const invocation = containment.buildGuardianInvocation(
      {
        argv: plan.argv,
        cwd,
        commandLine: resolved.commandLine,
        appName: resolved.appName,
      },
      process.pid,
      token,
    );
    if ('error' in invocation) {
      return spawnGuardianFailureStub(invocation.error, 'MAISON_GUARDIAN_UNAVAILABLE');
    }
    return spawn(invocation.file, invocation.args, {
      cwd,
      env: buildAgentSpawnEnv(process.env, opts.extraEnv),
      stdio,
      shell: false as const,
      windowsHide: true,
    });
  }

  const opts2 = {
    cwd,
    // P0-7①：agent 子进程剥离 NODE_OPTIONS 预加载注入（防经 agent 环境二次传导进工具链）。
    // t10（codex 六轮 P0-2）：信任锚材料不进 agent env。
    // b7e4d2a9 Todo3：合并后统一 strip + HEADLESS 最后定档（见 buildAgentSpawnEnv）。
    env: buildAgentSpawnEnv(process.env, opts.extraEnv),
    stdio,
    detached: !isWin,
    shell: false as const,
    // plan c6a9e4d2 t4：spawn 卫生——每 invoke 不弹可见控制台窗（0xC000013A
    // 控制台中断类退出的预防面；guardian 分支见上方的 windowsHide）。
    windowsHide: true,
  };

  if (plan.useCrossSpawn) {
    return crossSpawn(plan.argv[0], plan.argv.slice(1), opts2) as ChildProcess;
  }
  return spawn(plan.argv[0], plan.argv.slice(1), opts2);
}

/**
 * plan c4e8a1f7 T1a：guardian 自有 containment 建立失败 → 投影为既有 spawn_error 事实。
 * 判据（绑定稳定 ASCII marker，不依赖可能乱码的本地化文本、不单凭 exitCode=2）：
 *   exitCode === 2 ∧ stderr 含 `[maison-guardian]` ∧ 含任一稳定 ASCII operation marker
 *   （CreateProcess( / AssignProcessToJobObject / ResumeThread）。
 * 正常收尾 guardian 会透传真实 agent exit code——同样的 2 若来自 agent 自身不得误判。
 */
export const MAISON_GUARDIAN_DIAG_PREFIX = '[maison-guardian]';
export const GUARDIAN_CONTAINMENT_MARKERS: ReadonlyArray<string> = [
  'CreateProcess(',
  'AssignProcessToJobObject',
  'ResumeThread',
] as const;

export function projectGuardianContainmentFailure(
  exitCode: number,
  stderr: string,
): { code: string; message: string } | null {
  if (exitCode !== 2) return null;
  if (!stderr.includes(MAISON_GUARDIAN_DIAG_PREFIX)) return null;
  if (!GUARDIAN_CONTAINMENT_MARKERS.some((m) => stderr.includes(m))) return null;
  const lines = stderr
    .split(/\r?\n/)
    .filter((l) => l.includes(MAISON_GUARDIAN_DIAG_PREFIX))
    .slice(0, 3);
  return {
    code: 'maison_guardian_containment_failed',
    message: lines.join(' | ').slice(0, 500) || 'guardian containment establishment failed',
  };
}

/**
 * plan c4e8a1f7 T1a：session 级 binary 解析（preflight 调用一次，probe/canary/invoke 复用）。
 * 返回 { binary, shadowed }；binary=null 时 shadowed 保留诊断。
 */
export interface SessionResolvedBinary {
  binary: ResolvedHeadlessBinary | null;
  shadowed: string[];
}

export function resolveSessionBinary(
  adapterName: string,
): SessionResolvedBinary {
  const candidates = STRUCTURED_BINARY_CANDIDATES[adapterName] ?? [];
  const resolved = resolveHeadlessBinary([...candidates]);
  return {
    binary: resolved,
    shadowed: resolved?.shadowed ?? [],
  };
}

async function spawnHeadlessAsync(
  plan: HeadlessInvokePlan,
  cwd: string,
  opts: AgentInvokeOptions,
): Promise<AgentInvokeResult> {
  const started = Date.now();
  const child = spawnHeadlessChild(plan, cwd, opts);
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
  let timedOut = false;
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

  const writeHumanLog = (chunk: string): void => {
    if (outputStream) outputStream.write(chunk);
  };

  // plan e6b3f8d2 t1：terminal 事件解析器——**直接消费 stdout chunk**（跨 chunk 行缓冲），
  // 不要求产出 agent-events.jsonl（那是 critic 工具证据的三文件分流契约，与本条无关）。
  // 只有声明了 terminal JSONL 契约的 adapter（现仅 codex）启用；其余 adapter 恒 null，
  // 其 FAIL 诚实接受 hard timeout 兜底，不造假信号。
  const terminalHooks: { onCompleted?: () => void; onFailed?: () => void } = {};
  const terminalParser: TerminalEventParser =
    opts.terminalEventParser ?? resolveTerminalEventParser(plan.adapterName);
  const terminalScanner: CodexTerminalScanner | null =
    terminalParser === 'codex_turn_jsonl'
      ? createCodexTerminalScanner({
          onCompleted: () => terminalHooks.onCompleted?.(),
          onFailed: () => terminalHooks.onFailed?.(),
        })
      : null;

  child.stdout?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    appendCaptured('stdout', s);
    if (splitStreams) splitStreams.events.write(s);
    terminalScanner?.push(s);
    writeHumanLog(s);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    appendCaptured('stderr', s);
    if (splitStreams) splitStreams.stderr.write(s);
    writeHumanLog(s);
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

  const killTree = (reason: 'timeout' | 'signal' | 'completion' | 'terminal_failure'): Promise<void> => {
    if (killTriggered && killInFlight) return killInFlight;
    killTriggered = true;
    if (reason === 'timeout') timedOut = true;
    // reason='completion' 刻意不置任何失败标记：证据已确定性完成，这不是超时也不是
    // agent 失败——归错类会让上层按失败路径重试一个已经完成的阶段。
    // reason='terminal_failure'（plan e6b3f8d2 t1）同理不置 timedOut：失败语义由
    // terminalFailureObserved + exitCode 规范化承载，**不得**冒充超时。
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

  // t4：完成观测——与 settle / hard timeout 竞争。
  // 判据是**确定性**的（证据在盘 / adapter terminal 事件），不是概率性的（静默/无输出）：
  // cursor-agent 本就 "streams little until phase end"，拿静默做判据会误杀正常长任务
  //（这正是 silent watchdog 从未启用、并已于 plan e6b3f8d2 t1 删除生产链的原因）。
  type InvokeClosureObservation = 'none' | 'completion' | 'terminal_failure';
  let closureObservation: InvokeClosureObservation = 'none';
  /** R8：completion 命中时取消了 hard timeout —— 用于断言二者互斥 */
  let timeoutCancelledByCompletion = false;

  // hard timeout 的**原到期时刻**。completion probe 可以暂时取消 timer；若随后收到
  // terminal failure，失败优先并按这个原时刻恢复 wall-clock backstop，不能从失败时刻
  // 重新起算一个完整 timeout（那会悄悄放大预算）。
  const timeoutMs = opts.timeoutMs;
  const hardTimeoutAtMs = timeoutMs && timeoutMs > 0 ? started + timeoutMs : null;
  let timeoutTimer: NodeJS.Timeout | null = null;
  const armHardTimeout = (): void => {
    if (hardTimeoutAtMs === null || timeoutTimer || timedOut) return;
    const remainingMs = Math.max(0, hardTimeoutAtMs - Date.now());
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null;
      // R8：只有仍由 completion 占有仲裁位时才豁免 hard timeout。terminal failure
      // 会先夺回仲裁位并恢复本 timer，因此不得被旧 completion 洗白。
      if (closureObservation === 'completion') return;
      void killTree('timeout');
    }, remainingMs);
  };
  armHardTimeout();

  /**
   * 收口共用原语：宽限内自然退出即最佳，仍存活才 tree-kill 本次 invocation。
   * grace 不得越过绝对 deadline——收口不能反过来把 run 拖过 wall-clock 预算。
   */
  const armSettleGrace = (reason: 'completion' | 'terminal_failure'): void => {
    const graceBudget = opts.completionGraceMs ?? DEFAULT_COMPLETION_GRACE_MS;
    const untilDeadline = opts.deadlineMs ? opts.deadlineMs - Date.now() : graceBudget;
    const grace = Math.max(0, Math.min(graceBudget, untilDeadline));
    setTimeout(() => {
      if (!settleWaiter.isSettled()) void killTree(reason);
    }, grace);
  };

  /**
   * plan e6b3f8d2 t1 review 收口：completion probe 与 adapter terminal 终态的**唯一仲裁入口**。
   * `terminal_failure` 优先于任何 completion：
   *   · completion 命中即取消 hard timeout，避免 deadline/grace 竞争制造双真；
   *   · failure 已成立后，probe / turn.completed 都不能再置 completion；
   *   · probe 先成立、随后收到 failure 时，撤销 completion 并按原到期时刻恢复 hard timeout；
    *   · 两路仍复用同一 settle/grace 原语，最终结果强制互斥。
   */
  const observeClosure = (observation: Exclude<InvokeClosureObservation, 'none'>): void => {
    if (observation === 'completion') {
      if (closureObservation !== 'none' || timedOut) return;
      closureObservation = 'completion';
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
        timeoutCancelledByCompletion = true;
      }
      armSettleGrace('completion');
      return;
    }

    if (closureObservation === 'terminal_failure') return;
    const supersededCompletion = closureObservation === 'completion';
    closureObservation = 'terminal_failure';
    if (supersededCompletion && timeoutCancelledByCompletion) {
      timeoutCancelledByCompletion = false;
      armHardTimeout();
    }
    // failed 之后进程若拒不退出且 grace kill 也没打死，恢复后的 hard timeout 仍是最后兜底。
    armSettleGrace('terminal_failure');
  };

  const observeCompletion = (): void => observeClosure('completion');
  const observeTerminalFailure = (): void => observeClosure('terminal_failure');

  // terminal 观测钩子在 stdout 监听注册时尚未定义（本函数体全程同步，无 await 间隔，
  // 故实际不会有 chunk 先到）；即便如此，下方仍做一次事实回放，结构上消除竞态。
  terminalHooks.onCompleted = observeCompletion;
  terminalHooks.onFailed = observeTerminalFailure;
  {
    const early = terminalScanner?.state();
    if (early?.completionObserved) observeCompletion();
    if (early?.terminalFailureObserved) observeTerminalFailure();
  }

  const completionTimer = opts.completionProbe
    ? setInterval(() => {
        if (closureObservation !== 'none' || killTriggered) return;
        let hit = false;
        try {
          hit = opts.completionProbe!() === true;
        } catch {
          // 半写入 / 解析错误 → 本轮视为未完成，下轮重试；**绝不**转判 completion，
          // 也不终止 agent（探针出错是探针的问题，不是 agent 的）
          hit = false;
        }
        if (!hit) return;
        observeCompletion();
      }, opts.completionPollMs ?? DEFAULT_COMPLETION_POLL_MS)
    : null;

  const settled = await settleWaiter.promise;

  // 终局补齐：先摘钩子再 flush——进程已 settle，残片里的终态只补事实，不得再 arm
  // 任何 grace/kill（那会白白吊住 event loop）。timedOut 已成立时不追认 terminal 事实：
  // 被 wall 杀掉的进程吐出的残片不能反过来洗成"正常收口"。
  terminalHooks.onCompleted = undefined;
  terminalHooks.onFailed = undefined;
  terminalScanner?.flush();
  const terminalState = terminalScanner?.state() ?? null;
  if (!timedOut) {
    // flush 可能补出末行终态；此时 child 已 settle，不再 arm grace/timer，只做最终事实仲裁。
    // failure 优先，确保 parser 状态即使同时含两终态也绝不把双真带出 invoke 边界。
    if (terminalState?.terminalFailureObserved) closureObservation = 'terminal_failure';
    else if (terminalState?.completionObserved && closureObservation === 'none') closureObservation = 'completion';
  }

  if (killInFlight) {
    await awaitPromiseWithTimeout(killInFlight, DEFAULT_KILL_INFLIGHT_DRAIN_MS, undefined);
  }

  if (timeoutTimer) clearTimeout(timeoutTimer);
  // t4：settle / timeout / abort 任一命中即取消 observer（不留悬挂 interval）
  if (completionTimer) clearInterval(completionTimer);

  exitCode = settled.exitCode;
  signal = settled.signal;

  opts.onChildExit?.();

  const duration_ms = Date.now() - started;

  // plan c4e8a1f7 T1a：guardian 自有的 CreateProcess/Assign/Resume 确定性建立失败在
  // agent-invoke 边界投影为同一 spawn_error 事实（消费侧共享 hard-CLI 分类据此早停）。
  // 普通 agent 内容失败（exit 2 无 guardian 诊断）保持原样（不投影、走既有 harness/retry）。
  let spawnError = settled.spawn_error;
  if (!spawnError && opts.containment && process.platform === 'win32') {
    const guardianProjection = projectGuardianContainmentFailure(exitCode, stderr);
    if (guardianProjection) spawnError = guardianProjection;
  }

  // plan e6b3f8d2 t1：terminal 诊断摘要——`turn.failed` 正文 + 顶层 `error` 事件。
  // **纯诊断**：只进 agent_invoke_end，不参与 settle / classifier / retry 任何判据。
  const terminalDiagnostics = [
    ...(terminalState?.failureExcerpt ? [`turn.failed: ${terminalState.failureExcerpt}`] : []),
    ...(terminalState?.errorExcerpts ?? []).map((e) => `error: ${e}`),
  ];
  const terminalErrorExcerpt =
    terminalDiagnostics.length > 0 ? terminalDiagnostics.join(' | ').slice(0, 2000) : undefined;

  // 唯一仲裁态投影为两个历史结果字段；结构上不可能双真。
  const completionObserved = closureObservation === 'completion';
  const terminalFailureObserved = closureObservation === 'terminal_failure';

  return {
    // plan e6b3f8d2 t1：terminal 失败终态在 exit 0 时规范化为非零——复用 timedOut 同款，
    // 否则 `agentFailed = exitCode!==0 && completionObserved!==true` 会把失败洗白。
    exitCode: timedOut || terminalFailureObserved ? (exitCode === 0 ? 1 : exitCode) : exitCode,
    stdout,
    stderr,
    command: plan.label,
    pid: pid || undefined,
    duration_ms,
    timed_out: timedOut || undefined,
    // silent_killed 写侧已删除（plan e6b3f8d2 t1）——字段仍在 interface 上供读侧兼容历史事件。
    completion_observed: completionObserved || undefined,
    terminal_failure_observed: terminalFailureObserved || undefined,
    ...(terminalErrorExcerpt ? { terminal_error_excerpt: terminalErrorExcerpt } : {}),
    signal,
    lingering_pipe: settled.lingering_pipe || undefined,
    // plan d7f3a9c4 t4 / c4e8a1f7 T1a：spawn race 与 guardian 建立失败统一结构化事实。
    ...(spawnError ? { spawn_error: spawnError } : {}),
    kill_attempted: killResult.kill_attempted,
    kill_exit_code: killResult.kill_exit_code,
    kill_error: killResult.kill_error,
    // usage 是旁路事实：按声明采集，失败降 proxy，不影响主流程
    usage: deriveInvokeUsage(opts.usageCapture, stdout, stderr),
  };
}

/**
 * binary 不可执行时的诊断归属（plan c7a9e2f4 #5b；导出供单测）：
 * 优先取 plan.adapterName（内建 plan 均显式携带）；argv[0] 子串猜测仅兜底
 * custom headless_invoke——codeagentcli 须在 codex/claude 之前判
 *（不含 'claude' 子串，纯猜测时代会误报 cursor）。
 */
export function diagnoseAdapterForBinaryIssue(
  plan: Pick<HeadlessInvokePlan, 'argv' | 'adapterName'>,
): string {
  return plan.adapterName && plan.adapterName in STRUCTURED_BINARY_CANDIDATES ? plan.adapterName
    : plan.argv[0]?.includes('codeagent') ? 'codeagent'
    : plan.argv[0]?.includes('claude') ? 'claude'
    : plan.argv[0]?.includes('codex') ? 'codex'
    : plan.argv[0]?.includes('chrys') ? 'chrys'
    : plan.argv[0]?.includes('opencode') ? 'opencode'
    : 'cursor';
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
    const adapterGuess = diagnoseAdapterForBinaryIssue(plan);
    const candidates = STRUCTURED_BINARY_CANDIDATES[adapterGuess] ?? [...CURSOR_HEADLESS_BINARY_CANDIDATES];
    const stderr = formatHeadlessBinaryIssue(adapterGuess, [...candidates], plan.resolvedBinary);
    // plan d7f3a9c4 t4：resolvedBinary 短路与真实 child error 产出**同一种** spawn_error 结构化
    // 事实（不靠 stderr 猜 spawn failure）——金丝雀硬失败分类据此统一判定。
    return {
      exitCode: 1,
      stdout: '',
      stderr,
      command,
      spawn_error: { code: 'resolved_binary_unspawnable', message: stderr },
    };
  }

  return spawnHeadlessAsync(plan, cwd, opts ?? {});
}
