// ============================================================================
// codex-terminal-events.ts — Codex `exec --json` terminal 事件收口（plan e6b3f8d2 t1）
// ----------------------------------------------------------------------------
// 立项事故（宿主 run 20260825T011950Z-eddfb2）：coding i3 于 02:58:52Z 打完终稿并自证
// FAIL，此后 65 分钟零输出，空等到 90min 硬超时——FAIL turn 没有任何收口信号
//（完成探针只识别 PASS 形态闭环证据、codex 长 turn 自然退出不可依赖、watchdog 从未启用）。
//
// 契约边界（六轮评审钉死，实施不得放宽）：
//   · **只有两个契约终态**——`turn.completed` / `turn.failed`。
//     - `turn.completed` → completionObserved（「跑完了」，不含质量判断：完成≠通过）；
//     - `turn.failed`    → terminalFailureObserved（失败语义必须保住：
//       goal-runner-phase.ts `agentFailed = exitCode!==0 && completionObserved!==true`，
//       terminal 若吞并 failed 或 failed 后进程 exit 0 都会把失败洗白）。
//   · **顶层 `error` 事件只是诊断**，不是终态：`error → 重试成功 → turn.completed` 是
//     官方合法序列（本机 0.149.0 实采可见 error 与 turn.failed 成对出现，也可见 turn 内
//     item 级 error 后照常 turn.completed）。因此 error **不得**设 completionObserved、
//     不得触发 settle/kill、不得进 api_disconnected / failure classifier / retry 判据，
//     只登记进 `agent_invoke_end` 的诊断 excerpt。
//   · **item 级错误不是顶层 error**：`{"type":"item.completed","item":{"type":"error",…}}`
//     与 `item.error` 都属 turn 内部事实，本解析器一律归 other（实采样本里这类 item
//     之后 turn 照常 completed——当成错误会误杀正常 turn）。
//
// 解析器契约：只吃结构化 JSONL。JSON.parse 失败的行直接跳过，**不做任何文本正则回退**
//（与 critic 工具事件解析器同一条红线）。跨 chunk 半行由内部缓冲拼接。
// ============================================================================

/** 单行分类结果。'other' = 与终态收口无关（含 item 级错误、thread.started、turn.started…）。 */
export type CodexTerminalLineKind = 'completed' | 'failed' | 'error' | 'other';

export interface CodexTerminalLineClassification {
  kind: CodexTerminalLineKind;
  /** failed / error 行的人读摘要（已截断）；其余为 undefined。 */
  excerpt?: string;
}

export interface CodexTerminalState {
  /** `turn.completed` 出现过——独享 completionObserved 语义。 */
  completionObserved: boolean;
  /** `turn.failed` 出现过——失败终态事实（completionObserved 恒保持 false）。 */
  terminalFailureObserved: boolean;
  /** `turn.failed` 携带的错误摘要（首次命中即锁定）。 */
  failureExcerpt?: string;
  /** 顶层 `error` 事件摘要（纯诊断，按序保留前 N 条）。 */
  errorExcerpts: string[];
}

/** 单条摘要最大字符数——诊断够用即可，不把整段模型输出灌进事件。 */
export const CODEX_TERMINAL_EXCERPT_MAX_CHARS = 500;
/** 顶层 error 摘要最多保留条数（重试风暴时不无限增长）。 */
export const CODEX_TERMINAL_ERROR_EXCERPT_LIMIT = 5;
/**
 * 单行缓冲上限。JSONL 单行可以很长（实采里 mcp_tool_call 结果行数 KB），但没有换行的
 * 无界增长必须挡住——超限即丢弃当前残片（它本就不是可解析的完整行）。
 */
export const CODEX_TERMINAL_LINE_BUFFER_MAX_CHARS = 1_000_000;

function excerptOf(raw: unknown, fallback: string): string {
  const text =
    typeof raw === 'string' && raw.trim()
      ? raw.trim()
      : raw !== undefined && raw !== null
        ? (() => {
            try {
              return JSON.stringify(raw);
            } catch {
              return fallback;
            }
          })()
        : fallback;
  return String(text).slice(0, CODEX_TERMINAL_EXCERPT_MAX_CHARS);
}

/**
 * 单行分类（纯函数，供单测按真实落盘样本逐行断言）。
 * 非 JSON / 非对象 / 无 `type` 一律 'other'——解析失败不猜。
 */
export function classifyCodexTerminalLine(line: string): CodexTerminalLineClassification {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return { kind: 'other' };
  let doc: unknown;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    return { kind: 'other' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { kind: 'other' };
  const record = doc as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'turn.completed') return { kind: 'completed' };
  if (type === 'turn.failed') {
    const err = record.error as Record<string, unknown> | undefined;
    return {
      kind: 'failed',
      excerpt: excerptOf(err && typeof err === 'object' ? err.message ?? err : undefined, 'turn.failed'),
    };
  }
  if (type === 'error') {
    return { kind: 'error', excerpt: excerptOf(record.message, 'codex error event') };
  }
  // item.completed / item.started（含 item.type==='error' 与 item.error）、thread.started、
  // turn.started 等一律 other——turn 内部事实不是 turn 终态。
  return { kind: 'other' };
}

export interface CodexTerminalScannerHandlers {
  /** `turn.completed` 首次命中（至多回调一次）。 */
  onCompleted?: () => void;
  /** `turn.failed` 首次命中（至多回调一次）。 */
  onFailed?: () => void;
}

export interface CodexTerminalScanner {
  /** 喂一段 stdout chunk（可含半行）。 */
  push(chunk: string): void;
  /** 流结束：把缓冲里最后一行不带换行的残片也走一遍分类。 */
  flush(): void;
  /** 当前观测事实快照（拷贝，调用方不可改内部状态）。 */
  state(): CodexTerminalState;
}

/**
 * 创建行缓冲扫描器。**直接消费 stdout chunk**，不要求产出 agent-events.jsonl
 *（那是 critic 工具证据的三文件分流契约，与本条无关）。
 */
export function createCodexTerminalScanner(
  handlers: CodexTerminalScannerHandlers = {},
): CodexTerminalScanner {
  let buffer = '';
  const state: CodexTerminalState = {
    completionObserved: false,
    terminalFailureObserved: false,
    errorExcerpts: [],
  };

  const consumeLine = (line: string): void => {
    if (!line.trim()) return;
    const c = classifyCodexTerminalLine(line);
    if (c.kind === 'completed') {
      // 结构化防御：若异常流同时出现两个终态，failed 优先；scanner 自身也不输出双真。
      if (state.completionObserved || state.terminalFailureObserved) return;
      state.completionObserved = true;
      handlers.onCompleted?.();
      return;
    }
    if (c.kind === 'failed') {
      if (state.terminalFailureObserved) return;
      state.terminalFailureObserved = true;
      state.completionObserved = false;
      if (c.excerpt) state.failureExcerpt = c.excerpt;
      handlers.onFailed?.();
      return;
    }
    if (c.kind === 'error') {
      if (c.excerpt && state.errorExcerpts.length < CODEX_TERMINAL_ERROR_EXCERPT_LIMIT) {
        state.errorExcerpts.push(c.excerpt);
      }
    }
  };

  return {
    push(chunk: string): void {
      if (!chunk) return;
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        consumeLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
      if (buffer.length > CODEX_TERMINAL_LINE_BUFFER_MAX_CHARS) buffer = '';
    },
    flush(): void {
      const rest = buffer;
      buffer = '';
      if (rest) consumeLine(rest);
    },
    state(): CodexTerminalState {
      return { ...state, errorExcerpts: [...state.errorExcerpts] };
    },
  };
}

/**
 * adapter → terminal 解析器选择。**只有 codex** 有已实证的 terminal JSONL 契约；
 * 其余 adapter 一律 none——无契约的 FAIL 诚实接受 hard timeout 兜底，不造假信号。
 */
export type TerminalEventParser = 'none' | 'codex_turn_jsonl';

export function resolveTerminalEventParser(adapterName?: string): TerminalEventParser {
  return adapterName === 'codex' ? 'codex_turn_jsonl' : 'none';
}

/**
 * 判卷投影（plan e6b3f8d2 t1 连带修复）：codex `exec --json` 的 stdout 是 JSONL 信封，
 * 行锚 `^KEY=value$` 在其上恒空——金丝雀/inline 判卷若直接扫原始 stdout，会把
 * 「作答了」误判成「没作答」（与 claude stream-json 同一类问题，见
 * claude-envelope.extractClaudeFinalResultText）。
 *
 * 投影规则：按序拼接全部 `item.completed` 的 `agent_message.text`——刻意**不只取最后一条**，
 * 以复现 `--json` 之前纯文本 stdout 的形态（判卷侧 `lastLegalAssignment` 本就取最后一次
 * 合法赋值，早期 echo 不会盖过后来的真答卷）。
 *
 * 返回 null 的唯一情形：**没有 `turn.completed`**（无成功终态即不判卷、不落缓存），
 * 与 claude 侧「无终态 success result → 不判卷」严格同构。
 */
export function extractCodexAgentMessageText(raw: string): string | null {
  let sawCompleted = false;
  const texts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
    const record = doc as Record<string, unknown>;
    if (record.type === 'turn.completed') {
      sawCompleted = true;
      continue;
    }
    if (record.type !== 'item.completed') continue;
    const item = record.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') continue;
    if (item.type !== 'agent_message') continue;
    if (typeof item.text === 'string' && item.text.length > 0) texts.push(item.text);
  }
  if (!sawCompleted) return null;
  return texts.join('\n');
}
