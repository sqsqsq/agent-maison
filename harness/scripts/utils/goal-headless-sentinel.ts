/**
 * Parse headless agent sentinels from agent-output.log.
 * - interaction sentinel: chrys --json envelope（结构化 JSON，近零误报）
 * - API 断流哨兵（P0-D b8f36a12）：adapter 感知 + 锚定 CLI 错误信封——绝不裸 grep 通用
 *   网络词（agent result 正文天然会讨论 HTTP 500/ECONNRESET，裸串必误报）。
 */

import * as fs from 'fs';
import { parseEnvelopeLine } from './claude-envelope';
import { isClaudeKernelAdapter } from './types';

export const HEADLESS_INTERACTION_CODE = 'headless_interaction_required';

export interface HeadlessInteractionSentinel {
  code: typeof HEADLESS_INTERACTION_CODE;
  error: string;
  lineIndex: number;
}

/**
 * Scan all lines for JSON objects with code=headless_interaction_required.
 * chrys may emit multi-line --json stdout; do not assume last line only.
 */
export function parseHeadlessInteractionSentinel(
  outputLogPath: string,
): HeadlessInteractionSentinel | null {
  if (!fs.existsSync(outputLogPath)) return null;
  const raw = fs.readFileSync(outputLogPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line) as { code?: string; error?: string };
      if (obj.code === HEADLESS_INTERACTION_CODE && typeof obj.error === 'string') {
        return { code: HEADLESS_INTERACTION_CODE, error: obj.error, lineIndex: i };
      }
    } catch {
      /* not JSON on this line */
    }
  }
  return null;
}

// ============================================================================
// P0-D：API 断流哨兵（transient_api_error）
// ============================================================================

export const TRANSIENT_API_ERROR_CODE = 'transient_api_error';

export interface HeadlessApiErrorSentinel {
  code: typeof TRANSIENT_API_ERROR_CODE;
  /** 命中的 CLI 错误信封行（诚实归因 api_error_excerpt 用） */
  matchedLine: string;
  lineIndex: number;
}

/**
 * claude CLI 错误信封：CLI 自己吐的错误行以 `API Error` 开头（实测样本：
 * `API Error: Connection closed mid-response. The response above may be incomplete.`）。
 * 行首锚定 + 断流特征措辞双条件，与 agent result 正文里"讨论网络错误"区分。
 */
const CLAUDE_API_ERROR_LINE = /^API Error\b/i;
const API_TRUNCATION_HINTS: readonly RegExp[] = [
  /connection closed mid-response/i,
  /response above may be incomplete/i,
  /connection (error|reset|refused)/i,
  /overloaded/i,
  /rate[ _-]?limit/i,
  /\b(429|500|502|503|529)\b/,
  /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i,
  /stream.{0,20}(interrupt|clos|abort)/i,
];

function matchesTruncationHint(line: string): boolean {
  return API_TRUNCATION_HINTS.some((re) => re.test(line));
}

/** 命中行之后是否还有实质输出（有 → 更像 result 正文引用，非"错误主导日志"） */
function isTailDominated(lines: string[], hitIndex: number): boolean {
  let substantiveAfter = 0;
  for (let i = hitIndex + 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) substantiveAfter++;
  }
  return substantiveAfter <= 3;
}

/** stream-json 断流特征 status 码（与文本路径 API_TRUNCATION_HINTS 的数字集对齐；401/403 属鉴权非断流） */
const STREAM_JSON_TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504, 529]);

/**
 * 结构化 status 字段数字化（plan c7a9e2f4 #7b-a）：真实 writer 吐的是**字符串**——
 * 2026-07-29 codeagent 断网实采 `{"type":"system","subtype":"api_retry","error_status":"500",...}`，
 * 原 `typeof === 'number'` 判定整行漏判（断流退化为整 attempt 干等超时，实采重试耗 ~7 分钟）。
 * claude 同源内核同一 writer，同样受益。非数字/缺失返回 null。
 */
function coerceStatusCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * t3a/f7a3d9c2：claude-kernel structured_events（stream-json）模式的结构化错误信封。
 * agent-output.log 仍是混合人读投影，但 stdout 行变 NDJSON——文本锚定 `^API Error` 不再
 * 出现，改认结构化事件：①{type:'system',subtype:'api_retry',error_status,error}；
 * ②{type:'result',is_error:true,…}。仅 429/5xx/网络类计 transient
 * （401/403 鉴权失败不盲 backoff——2026-07-11 宿主实采样本即 401，误归 transient 会空转）。
 * 2026-07-29 实采回灌（plan c7a9e2f4 #7b）：status 字段一律 coerceStatusCode 数字化；
 * 终局 result 事件可**不带 api_error_status**（错误全在 result 文本，如
 * "API Error: 500 Unable to connect…"）——状态缺失/非数时回退 result 文本过断流特征正则。
 */
function parseClaudeStreamJsonApiError(lines: string[]): HeadlessApiErrorSentinel | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    // P0-1（plan 7c4f2e9b）：行级信封解析统一走 claude-envelope 共享语义
    const parsed = parseEnvelopeLine(lines[i]);
    if (!parsed) continue;
    const obj = parsed as {
      type?: string;
      subtype?: string;
      error_status?: number | string;
      error?: string;
      is_error?: boolean;
      api_error_status?: number | string;
      result?: string;
    };
    if (obj.type === 'system' && obj.subtype === 'api_retry') {
      const status = coerceStatusCode(obj.error_status);
      const transient =
        (status !== null && STREAM_JSON_TRANSIENT_STATUS.has(status)) ||
        (typeof obj.error === 'string' && matchesTruncationHint(obj.error) && !/authentication/i.test(obj.error));
      if (transient) {
        return {
          code: TRANSIENT_API_ERROR_CODE,
          matchedLine: `stream-json api_retry status=${status ?? obj.error_status ?? '?'} ${obj.error ?? ''}`.slice(0, 300),
          lineIndex: i,
        };
      }
    }
    if (obj.type === 'result' && obj.is_error === true) {
      const status = coerceStatusCode(obj.api_error_status);
      if (status !== null && STREAM_JSON_TRANSIENT_STATUS.has(status)) {
        return {
          code: TRANSIENT_API_ERROR_CODE,
          matchedLine: `stream-json result is_error api_error_status=${status} ${String(obj.result ?? '').slice(0, 120)}`.slice(0, 300),
          lineIndex: i,
        };
      }
      // #7b-b：终局行无 status 字段（实采确认）→ 回退 result 文本判定；
      // 鉴权措辞排除，沿用 api_retry 分支同款防线（401/403 不误归 transient）。
      if (status === null && typeof obj.result === 'string'
        && matchesTruncationHint(obj.result) && !/authentication/i.test(obj.result)) {
        return {
          code: TRANSIENT_API_ERROR_CODE,
          matchedLine: `stream-json result is_error ${obj.result.slice(0, 200)}`.slice(0, 300),
          lineIndex: i,
        };
      }
    }
  }
  return null;
}

function parseClaudeApiError(lines: string[]): HeadlessApiErrorSentinel | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!CLAUDE_API_ERROR_LINE.test(line)) continue;
    // 信封行本身须带断流特征措辞（避免把 result 里的"API Error 处理策略"章节误吞）
    if (!matchesTruncationHint(line)) continue;
    // 且错误主导日志尾部（CLI 报错后即退出；result 正文引用后面还有大量内容）
    if (!isTailDominated(lines, i)) continue;
    return { code: TRANSIENT_API_ERROR_CODE, matchedLine: line.slice(0, 300), lineIndex: i };
  }
  // stream-json 模式回退：文本锚定无命中时再试结构化信封（两模式共存期都覆盖）
  return parseClaudeStreamJsonApiError(lines);
}

/**
 * chrys --json envelope：结构化错误字段带断流特征时命中。
 * TODO(chrys)：chrys 断流的确切错误码待实测样本收敛；当前按 error 文本特征保守匹配。
 */
function parseChrysApiError(lines: string[]): HeadlessApiErrorSentinel | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line) as { code?: string; error?: string };
      // 交互哨兵优先级更高，不在这里吞掉它
      if (obj.code === HEADLESS_INTERACTION_CODE) continue;
      if (typeof obj.error === 'string' && matchesTruncationHint(obj.error)) {
        return {
          code: TRANSIENT_API_ERROR_CODE,
          matchedLine: obj.error.slice(0, 300),
          lineIndex: i,
        };
      }
    } catch {
      /* not JSON on this line */
    }
  }
  return null;
}

/**
 * API 断流哨兵（P0-D）。adapter 感知：claude 走纯文本 CLI 信封锚定、chrys 走 JSON
 * envelope 解析；其余 adapter（codex/cursor/opencode/generic）断流吐法未实测，
 * 不承诺检测（返回 null）——宁漏判走既有失败路径，不误报吞真 blocker。
 * 非空信封命中**不依赖 exit code**（实测断流 attempt 可 exit 0）。
 */
export function parseHeadlessApiError(
  outputLogPath: string,
  adapter: string,
): HeadlessApiErrorSentinel | null {
  if (!fs.existsSync(outputLogPath)) return null;
  const raw = fs.readFileSync(outputLogPath, 'utf-8');
  if (raw.trim().length === 0) return null; // 0 字节走 agent_no_output 兜底，不冒充断流
  const lines = raw.split(/\r?\n/);
  // 家族谓词（plan c7a9e2f4）：codeagent 信封三段（参数校验文案/api_retry/终局 result）
  // 2026-07-29 实采确认与 claude 同源，走同一解析器。
  if (isClaudeKernelAdapter(adapter)) return parseClaudeApiError(lines);
  if (adapter === 'chrys') return parseChrysApiError(lines);
  return null;
}
