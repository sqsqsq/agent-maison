// ============================================================================
// verifier-subject.ts — verifier 证据身份（subject）的基础原语
// ============================================================================
// 职责收窄到两件事，其余全部裁撤（plan a9d4e7c2 T4，plan d2f7a9c4 再减一）：
//   1. subject 的形态契约（64 位小写 hex）与报告文件的**分区文件名**；
//   2. verifier 终态块（v1 格式不变）的唯一解析口径。
//
// **已删除，且不得恢复**（上一代「稳定 subject」承诺催生的整套投影子系统）：
//   · `computeVerifierSubjectId` / `canonicalVerifierInput` / `VerifierSubjectInputs`
//     —— subject 现由 verifier-request.ts 按**实际审查材料**派生；
//   · `canonicalScriptReportDigest` 与 `CheckResult.details_material` 排除式投影、
//     `check-telemetry.ts` 的双文本渲染 —— 直接哈希磁盘 ai-prompt.md 字节，
//     时间戳导致换 subject 属**合法结果**（subject 本就不承诺稳定）；
//   · `SUBJECT_BLOCK_*` / `renderSubjectBlock` / `withSubjectBlock` / `stripSubjectBlock`
//     / `parseSubjectBlock` —— 调用凭证改为短 request JSON（verifier-request.ts），
//     ai-prompt.md 不再被注入任何机器块。
//
// 终态块格式是**跨 adapter 的公共契约**：7 份 harness/prompts/verify-*.md 里的输出规定、
// 每个 adapter 的 verifier 子代理回复、以及本文件的解析器必须逐字一致。改格式须同步改那 7
// 份模板（plan d2f7a9c4：hook 侧的 .mjs 复刻已随 hook 一并删除）。
// ============================================================================

import * as crypto from 'crypto';

/** verifier 终态块标记（唯一版本化结论出口——废除全篇正则找第一个 verdict）。 */
export const RESULT_BLOCK_OPEN = '<!-- maison-verifier-result:v1 -->';
export const RESULT_BLOCK_CLOSE = '<!-- /maison-verifier-result:v1 -->';

const RESULT_BLOCK_RE =
  /<!-- maison-verifier-result:v1 -->([\s\S]*?)<!-- \/maison-verifier-result:v1 -->/g;

/** 64 位小写十六进制（subject 的唯一合法形态；宽松匹配会让手抄的短串蒙混过关）。 */
export const SUBJECT_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface VerifierResultBlock {
  subject_id: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** EOL 归一（plan b6d3f7a1：手写解析面一律先归一，跨平台 checkout 不得改变哈希）。 */
export function normalizeEol(text: string): string {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
}

/**
 * 证据文件按 **subject 分区**（保留自 plan e5b8c3f7 review 四轮 P0）。
 *
 * 此前所有 verifier 竞争同一个 `verifier.report.md`：无论把"我还有权限吗"这次复查放得
 * 多晚，它与"改共享文件"始终是两步，两步之间就能换代——授权检查只能把窗口往后挪，消不掉。
 * 分区之后窗口根本不存在：不同 subject 天然写不同文件，谁也没有能力移动、删除或覆盖另一个
 * subject 的文件；`summary.verifier_subject_id` 单独决定"当前机器证据是哪一个文件"。
 *
 * 只接受合法 64 位 subject——半截/伪造 id 不得凭空造出一个文件名。
 */
export function verifierReportMdFilename(subjectId: string): string {
  return `verifier.report.${assertSubjectId(subjectId)}.md`;
}

function assertSubjectId(subjectId: string): string {
  const v = typeof subjectId === 'string' ? subjectId.trim() : '';
  if (!SUBJECT_ID_PATTERN.test(v)) {
    throw new Error(`[verifier-subject] 非法 subject id（须 64 位小写 hex）：${JSON.stringify(subjectId)}`);
  }
  return v;
}

function readBlockField(body: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * 解析 verifier 终态块。**必须恰好一个**——零个=没按契约输出，多个=回答被拼接污染。
 * 模板内的示例块带 `PASS | FAIL` 占位，解析不出合法 verdict 自然落空，
 * 不会把模板回显当成结论。
 */
export function parseResultBlock(text: string | null | undefined): VerifierResultBlock | null {
  if (!text) return null;
  const src = normalizeEol(text);
  const bodies: string[] = [];
  RESULT_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RESULT_BLOCK_RE.exec(src)) !== null) bodies.push(m[1]);
  RESULT_BLOCK_RE.lastIndex = 0;
  if (bodies.length !== 1) return null;
  const body = bodies[0];
  const subjectId = readBlockField(body, 'verifier_subject_id');
  const verdictRaw = readBlockField(body, 'verdict');
  const blockerRaw = readBlockField(body, 'blocker_count');
  if (!subjectId || !SUBJECT_ID_PATTERN.test(subjectId)) return null;
  if (verdictRaw !== 'PASS' && verdictRaw !== 'FAIL') return null;
  if (blockerRaw === null || !/^\d+$/.test(blockerRaw)) return null;
  return { subject_id: subjectId, verdict: verdictRaw, blocker_count: Number(blockerRaw) };
}
