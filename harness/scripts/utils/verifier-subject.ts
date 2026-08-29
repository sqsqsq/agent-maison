// ============================================================================
// verifier-subject.ts — verifier 证据身份（subject）的唯一生产/解析 SSOT
// ============================================================================
// 背景（plan e5b8c3f7）：SubagentStop hook 自 2026-04-27 起以**触发时的共享状态文件**
// 推断报告归属，并发 verifier 交错结束时必然错位——闭环后错写 → 证据链 stale 级联重跑；
// 闭环前错写 → manifest 忠实封存错误证据（假闭环）。根治不是加锁，而是给每次 harness run
// 一个**跨闭环稳定**的身份指纹，由 runner 单点生成、经 ai-prompt.md 机器投递、由 hook
// 在发布时三重等值绑定。
//
// 本模块只做三件事，不做 I/O 之外的裁决：
//   1. computeVerifierSubjectId：从 run 的机器输入派生稳定 subject；
//   2. renderSubjectBlock / parseSubjectBlock：ai-prompt.md 机器块的**唯一**格式；
//   3. parseResultBlock：verifier 终态块的**唯一**格式（废除全篇正则找第一个 verdict）。
//
// 输入面刻意不是"产物原文哈希"（review P1-2）：script-report 走结构化投影、prompt 走
// 装配侧同源的规范化摘要，两处 runner telemetry（墙钟时间戳、耗时、绝对路径）在格式化
// **之前**就被排除。曾经的"对最终自由文本叠 ISO 正则"两头都不准，已整体删除。
//
// 禁用整份 summary SHA（plan v2 P1-1，本轮实证）：base summary 先以 closure_status=open
// 落盘（harness-runner.ts writeRunSummaryBase），receipt 过后 finalizer 改写为 closed +
// closure_commit（phase-closure-finalizer.ts）。若把整份 summary SHA 纳入 subject，
// **正常闭环即自锁**（subject 换代 → 刚发布的 verifier JSON 立刻 stale）。因此输入面只取
// open→closed 期间不变的量。
//
// 跨语言复刻约定：hook 是纯 .mjs（不落 TS），必须复刻本模块的块格式与正则。
// 任何格式变更须同步 agents/claude/templates/hooks/record-verifier-report.mjs
// （codeagent 共享同一份 hook 模板），并由 verifier-evidence-identity 单测守护。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';

/** subject 派生契约版本——输入面或算法变更必须提版本（旧 subject 自然换代）。 */
export const VERIFIER_SUBJECT_SCHEMA = 'verifier-subject@2';

/** ai-prompt.md 机器块标记（open/close 成对，块内一切内容不参与 subject 哈希）。 */
export const SUBJECT_BLOCK_OPEN = '<!-- maison-verifier-subject:v1 -->';
export const SUBJECT_BLOCK_CLOSE = '<!-- /maison-verifier-subject:v1 -->';

/** verifier 终态块标记（唯一版本化结论出口）。 */
export const RESULT_BLOCK_OPEN = '<!-- maison-verifier-result:v1 -->';
export const RESULT_BLOCK_CLOSE = '<!-- /maison-verifier-result:v1 -->';

const SUBJECT_BLOCK_RE =
  /(?:\r?\n)*<!-- maison-verifier-subject:v1 -->[\s\S]*?<!-- \/maison-verifier-subject:v1 -->(?:\r?\n)*/g;
const RESULT_BLOCK_RE =
  /<!-- maison-verifier-result:v1 -->([\s\S]*?)<!-- \/maison-verifier-result:v1 -->/g;

/** 64 位小写十六进制（subject 的唯一合法形态；宽松匹配会让人手抄的短串蒙混过关）。 */
export const SUBJECT_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface VerifierSubjectInputs {
  feature: string;
  phase: string;
  /**
   * 门禁事实的**规范化投影**摘要（`canonicalScriptReportDigest`）；不可得为 null。
   * 不是 script-report.json 的原文哈希——原文携带 runner telemetry（见该函数注释）。
   */
  script_report_material: string | null;
  /**
   * 交给 verifier 的 **prompt 语义内容**摘要，由装配侧（`assembleAIPrompt`）与写盘文本
   * 同源产出，两处 runner telemetry 已换成占位符；不可得为 null。
   */
  ai_prompt_material: string | null;
  /** computeGateFingerprint 输出（framework 版本 + 门禁集内容） */
  gate_fingerprint: string | null;
  /** git HEAD（worktree/source identity 之一）；不可得为 null */
  source_commit_sha: string | null;
  /** 产品层 dirty worktree 摘要（HEAD 不动但源码已改时同样换代）；不可得为 null */
  worktree_digest: string | null;
}

/**
 * 证据文件按 **subject 分区**（review 四轮 P0）。
 *
 * 此前所有 verifier 竞争同一个 `verifier.report.json`：无论把"我还有权限吗"这次复查放得
 * 多晚，它与"改共享文件"始终是两步，两步之间就能换代——授权检查只能把窗口往后挪，消不掉。
 * 分区之后窗口根本不存在：不同 subject 天然写不同文件，谁也没有能力移动、删除或覆盖另一个
 * subject 的文件；`summary.verifier_subject_id` 单独决定"当前机器证据是哪一个文件"。
 * 同一 subject 的并发仍走 CAS + `published → conflict` 单调升级。
 *
 * 只接受合法 64 位 subject——半截/伪造 id 不得凭空造出一个文件名。
 */
export function verifierReportJsonFilename(subjectId: string): string {
  return `verifier.report.${assertSubjectId(subjectId)}.json`;
}

/** 人读投影的分区文件名（与 JSON 同 subject，机器不解析）。 */
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

export interface VerifierSubjectBlock {
  subject_id: string;
  feature: string;
  phase: string;
  /** runner 声明的 canonical JSON 相对路径——消费侧**只做等值核对**，绝不当写入目标 */
  report_path: string;
}

export interface VerifierResultBlock {
  subject_id: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** EOL 归一（plan b6d3f7a1：手写解析面一律先归一，跨平台 checkout 不得改变哈希）。 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * 从 ai-prompt.md 全文剥除 subject 机器块——**哈希前必调**。
 * 幂等：无块=原样；有块=替换为单个换行。这是"注入后重算仍得同一 subject"的前提。
 */
export function stripSubjectBlock(text: string): string {
  return normalizeEol(text).replace(SUBJECT_BLOCK_RE, '\n');
}

/**
 * subject 的**规范化输入串**（纯函数，无 I/O）——派生前的唯一真源。
 * 字段顺序固定在此，不依赖 JSON.stringify 的键序偶然性。
 */
export function canonicalVerifierInput(inputs: VerifierSubjectInputs): string {
  return [
    VERIFIER_SUBJECT_SCHEMA,
    `feature=${inputs.feature}`,
    `phase=${inputs.phase}`,
    `script_report_material=${inputs.script_report_material ?? '<absent>'}`,
    `ai_prompt_material=${inputs.ai_prompt_material ?? '<absent>'}`,
    `gate_fingerprint=${inputs.gate_fingerprint ?? '<absent>'}`,
    `source_commit=${inputs.source_commit_sha ?? '<absent>'}`,
    `worktree_digest=${inputs.worktree_digest ?? '<absent>'}`,
  ].join('\n');
}

/** 稳定序列化：键序固定，供 `structured` 等自由形状入摘要。 */
function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * check 层的规范化（排除式）：其余字段一律默认纳入，`details` 取 `details_material ?? details`。
 */
function canonicalizeChecks(checks: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(checks) ? checks : [];
  return list
    .map((c) => {
      const src = (c ?? {}) as Record<string, unknown>;
      const { details, details_material, ...rest } = src;
      return { ...rest, details: details_material ?? details ?? '' } as Record<string, unknown>;
    })
    .sort((a, b) => {
      const ai = String(a.id ?? '');
      const bi = String(b.id ?? '');
      if (ai !== bi) return ai < bi ? -1 : 1;
      const as = stableJson(a);
      const bs = stableJson(b);
      return as < bs ? -1 : as > bs ? 1 : 0;
    });
}

/**
 * 门禁事实的规范化投影摘要（review P1-2 → 四轮再收窄）。
 *
 * 为什么**不能**直接哈希 script-report.json 原文：它内嵌 runner telemetry——顶层
 * `timestamp`、绝对 `project_root`，以及 check 自由文本里的耗时。原文入 subject 会让
 * **零源码变化的重跑也换代 subject**，"跑完 verifier 再跑一次 harness 关环"必然失效
 * （与 plan v2 P1-1 的自锁同类）。为什么**也不能**对最终自由文本叠正则：两头都不准——
 * 抓不到 `耗时 1234 ms` 这种非 ISO 形态，却会抹掉业务正文里真实的 ISO 截止时间。
 *
 * 所以：**整份报告一律排除式投影**，顶层与 check 层都是"默认全进、只排显式 telemetry"。
 *   · 顶层排除 `timestamp` / `project_root`；其余现有与**将来新增**的顶层字段自动纳入。
 *   · check 层排除 `details_material`（它是投影载体），`details` 取
 *     `details_material ?? details`——易变量由生产端经 `renderDetailsWithTelemetry()` 拆出。
 *
 * 曾经这里是白名单，两层都栽过同一个跟头：check 层漏 `failure_kind`/`actionability`/
 * `affected_files`/`source`/`structured`，顶层漏 `capability_resolutions`/`compat_applied`/
 * `compat_expired`。白名单的失败模式是**静默的**——它对没听说过的字段一律不绑定，于是
 * ai-prompt.md 真变了、subject 却不变，旧 verifier PASS 被错误复用。绝不要再补白名单。
 */
export function canonicalScriptReportDigest(report: unknown): string | null {
  if (!report || typeof report !== 'object') return null;
  // 明确 telemetry 两项排除，其余顶层字段（含未知/未来字段）默认进入。
  const { timestamp, project_root, checks, ...topLevel } = report as Record<string, unknown>;
  void timestamp;
  void project_root;
  const material = { ...topLevel, checks: canonicalizeChecks(checks) };
  return sha256(`script-report-material@3\n${stableJson(material)}`);
}

/**
 * subject 派生：稳定序列化后 sha256。字段顺序固定在此，不依赖 JSON.stringify 的键序偶然性。
 */
export function computeVerifierSubjectId(inputs: VerifierSubjectInputs): string {
  return sha256(canonicalVerifierInput(inputs));
}

/**
 * 渲染 ai-prompt.md 机器块。**所有**追加内容（含分隔线与人读说明）都在块内——
 * 块外多一个字节，去块重算就得不到同一 ai_prompt_sha256，subject 会在重跑时漂移。
 */
export function renderSubjectBlock(block: VerifierSubjectBlock): string {
  return [
    '',
    '',
    SUBJECT_BLOCK_OPEN,
    '',
    '---',
    '',
    '## verifier 证据身份（机器块 · 原样投递，禁止改写或手抄）',
    '',
    '调用方（主 agent / goal runtime）必须把**本文件全文**作为 Task prompt 交给',
    '`subagent_type=verifier`：本块是 SubagentStop hook 绑定报告归属的唯一调用侧凭证，',
    '手抄、摘录或改写都会让绑定失败（fail-closed，报告落 bedside 不入闭环）。',
    '',
    `verifier_subject_id: ${block.subject_id}`,
    `verifier_subject_feature: ${block.feature}`,
    `verifier_subject_phase: ${block.phase}`,
    `verifier_subject_report_path: ${block.report_path}`,
    '',
    '审查结束时，回答的**最后**必须且只能出现一个终态块（格式固定，不得增删字段）：',
    '',
    '```',
    RESULT_BLOCK_OPEN,
    `verifier_subject_id: ${block.subject_id}`,
    'verdict: PASS | FAIL',
    'blocker_count: <BLOCKER 级 FAIL 数量，整数>',
    RESULT_BLOCK_CLOSE,
    '```',
    '',
    '`verdict=PASS` 当且仅当 `blocker_count=0`；两者不一致的报告一律判为无效证据。',
    '',
    SUBJECT_BLOCK_CLOSE,
    '',
  ].join('\n');
}

/** 把 subject 块注入 prompt 全文（先剥旧块再追加，重跑幂等）。 */
export function withSubjectBlock(promptText: string, block: VerifierSubjectBlock): string {
  return `${stripSubjectBlock(promptText).trimEnd()}\n${renderSubjectBlock(block)}`;
}

function readBlockField(body: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * 解析 subject 机器块。**必须恰好一个**——零个=未经机器投递（手抄/旧件），
 * 多个=prompt 被拼接污染，两者都不允许通过（fail-closed）。
 */
export function parseSubjectBlock(text: string | null | undefined): VerifierSubjectBlock | null {
  if (!text) return null;
  const src = normalizeEol(text);
  const bodies: string[] = [];
  const re = new RegExp(
    `${SUBJECT_BLOCK_OPEN.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')}([\\s\\S]*?)${SUBJECT_BLOCK_CLOSE.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')}`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) bodies.push(m[1]);
  if (bodies.length !== 1) return null;
  const body = bodies[0];
  const subjectId = readBlockField(body, 'verifier_subject_id');
  const feature = readBlockField(body, 'verifier_subject_feature');
  const phase = readBlockField(body, 'verifier_subject_phase');
  const reportPath = readBlockField(body, 'verifier_subject_report_path');
  if (!subjectId || !SUBJECT_ID_PATTERN.test(subjectId)) return null;
  if (!feature || !phase || !reportPath) return null;
  return { subject_id: subjectId, feature, phase, report_path: reportPath };
}

/**
 * 解析 verifier 终态块。同样**必须恰好一个**；模板内的示例块带 `PASS | FAIL` 占位，
 * 解析不出合法 verdict 自然落空，不会把模板回显当成结论。
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

/** 结论指纹：幂等/conflict 分治的判据（同 subject + 同 agent_id + 同 result hash = 幂等）。 */
export function computeVerifierResultSha256(input: {
  verdict: string;
  blocker_count: number;
  report_text: string;
}): string {
  return sha256(
    [
      `verdict=${input.verdict}`,
      `blocker_count=${input.blocker_count}`,
      'report_text:',
      normalizeEol(input.report_text),
    ].join('\n'),
  );
}
