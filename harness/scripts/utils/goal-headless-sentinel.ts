/**
 * Parse headless agent sentinels from agent-output.log.
 * - interaction sentinel: chrys --json envelope（结构化 JSON，近零误报）
 * - API 断流哨兵（P0-D b8f36a12）：adapter 感知 + 锚定 CLI 错误信封——绝不裸 grep 通用
 *   网络词（agent result 正文天然会讨论 HTTP 500/ECONNRESET，裸串必误报）。
 */

import * as fs from 'fs';

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
  return null;
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
  if (adapter === 'claude') return parseClaudeApiError(lines);
  if (adapter === 'chrys') return parseChrysApiError(lines);
  return null;
}
