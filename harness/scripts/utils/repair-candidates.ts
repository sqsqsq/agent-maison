// ============================================================================
// repair-candidates.ts — 责任阶段统一路由的单一共享事实层（plan b6e4c9f2 t1）
// ----------------------------------------------------------------------------
// 宿主实锤（run 20260816T125231Z-4a2d28）：review 发现 3 条可信 MAJOR 产品缺陷，
// 但「存在可回修缺陷」这一事实的唯一采集器写死在 goal-runner 的 testing 分支，
// assess 收到 deterministic_defects=[] 只能连推 rerun_phase:review 直到耗尽。
// 本模块把缺陷事实提升为 summary.repair_candidates[]（可选字段）——manual/batch/goal
// 三模式消费同一事实，goal 的 deterministic_defects 从此只是其指纹投影。
//
// 设计红线（codex 三轮定稿）：
// · 责任类别复用既有 CorrectionCategory（spec|plan|coding|verification），不新造枚举；
//   verification 类不产回退候选。
// · 归属优先级：①机器 check id 明确归属（scope_consistency_with_spec→spec、
//   device_ac_delegation→spec、ui_scope_violation→plan——即使 affected_files 是产品
//   源码也不误投 coding）；②无机器归属才按 affected_files 路径域兜底；③仍无法判断
//   → 不产 candidate（宁缺毋滥，落回既有原地 retry/halt）。不新增 agent 自报字段。
// · 两层指纹：item_fingerprint=hash(编号+规范化文件+规范化摘要)——缺陷身份；
//   round_fingerprint=排序后 item 集合 hash——整轮防震荡。不新增第三种指纹或账本。
// · review 侧信任合取：报告结构可信 + verifier 对该条**逐条**验证 confirmed
//   （issue_accuracy 抽样全局 PASS 不够——误报率≤10% 也 PASS，一个幻觉 CR 不得驱动
//   coding 改正确代码）；legacy conditional_review_authorization 不再抑制自动回退。
// ============================================================================

import * as fs from 'fs';
import { createHash } from 'crypto';
import { extractTables, getSectionContent, extractDeclaredVerdict } from './markdown-parser';
import { mapCategoryToChainPhase, type CorrectionCategory } from './correction-routing';
import type { ExecutionScopeInput } from './execution-scope';
import type { GoalRunEvent } from './goal-runner-phase';
import { isBlockingCheck, resultBasisOwner } from './check-disposition';

/** 可产回退候选的责任类别（verification 无回退语义） */
export type RepairOwnerCategory = Exclude<CorrectionCategory, 'verification'>;

/** 只读交接定位，不参与归属、指纹或修复进展；原 StepResult 仍是结果真源。 */
export interface RepairEvidenceRef {
  trace_path: string;
  case_id: string;
  step_index: number;
  derived_plan_path?: string;
  artifact_paths?: string[];
}

export interface RepairCandidate {
  /** 缺陷编号（review 表 ID 列，如 CR-001）或机器 check id */
  id: string;
  /** 责任类别（既有 CorrectionCategory 子集；phase 由 assess 按 workflow 映射） */
  category: RepairOwnerCategory;
  /** 规范化涉及文件（posix 相对路径，排序去重） */
  files: string[];
  /** 修复建议/问题描述摘要（单行截断） */
  summary: string;
  /** 缺陷身份指纹：hash(id + files + summary 规范化) */
  item_fingerprint: string;
  /** 生产阶段（审计与注入定位；不参与归属判定） */
  source_phase: string;
  evidence_refs?: RepairEvidenceRef[];
  /**
   * adjudicated-repair-loop（plan e2b7c4a9）：信号级候选标记。
   * 仅 testing 视觉信号候选携带 `'signal@1'`（identity = sha256(computeDefectFingerprint)）；
   * 无字段 = legacy check-domain 候选——可诊断/路由，但**不参与**累计 one-shot 收敛
   * 与 no-op 判定（新旧同为 64-hex，不可凭内容区分，只能凭本标记）。
   */
  identity_schema?: 'signal@1';
}

// ---------------------------------------------------------------------------
// 指纹（两层）
// ---------------------------------------------------------------------------

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function normalizeFiles(files: readonly string[]): string[] {
  return [...new Set(files.map(f => f.trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}

/** review 定位中的行号不属于文件身份；历史别名回放与当前问题表共用。 */
function normalizeReviewFiles(files: readonly string[]): string[] {
  return normalizeFiles(files.map(file => file.replace(/`/g, '').trim().replace(/:\d+(?:-\d+)?$/, ''))
    .filter(file => file && file !== '-'));
}

function normalizeSummary(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function itemFingerprintOf(id: string, files: readonly string[], summary: string): string {
  return sha256Hex([id.trim(), ...normalizeFiles(files), normalizeSummary(summary)].join('\n'));
}

/** 整轮防震荡指纹：排序后的 item_fingerprint 集合 hash（与 goal-runner
 *  roundFingerprintOf 同构——排序去重连接再 hash；同一轮缺陷集合恒同指纹）。 */
export function roundFingerprintOfCandidates(
  candidates: readonly Pick<RepairCandidate, 'item_fingerprint'>[],
): string {
  return sha256Hex([...new Set(candidates.map(c => c.item_fingerprint))].sort().join('\n'));
}

// ---------------------------------------------------------------------------
// 归属推导（路径域兜底——机器 check id 归属在各生产点显式给定，优先于此）
// ---------------------------------------------------------------------------

const SPEC_ARTIFACT_RE = /(^|\/)(spec\.md|acceptance\.yaml)$|(^|\/)spec\//;
const PLAN_ARTIFACT_RE = /(^|\/)(plan\.md|contracts\.yaml|use-cases\.yaml)$|(^|\/)plan\//;

/**
 * 按涉及文件路径域推导责任类别（codex 优先级②）。
 * 全部文件同域才归类；混合域/空清单 → null（不产 candidate）。
 * 判定域：spec 件 → spec；plan 件 → plan；其余仓内路径（产品源码/测试）→ coding。
 */
export function deriveCategoryFromFiles(files: readonly string[]): RepairOwnerCategory | null {
  const normalized = normalizeFiles(files);
  if (normalized.length === 0) return null;
  const categories = new Set<RepairOwnerCategory>(
    normalized.map((f): RepairOwnerCategory => {
      if (SPEC_ARTIFACT_RE.test(f)) return 'spec';
      if (PLAN_ARTIFACT_RE.test(f)) return 'plan';
      return 'coding';
    }),
  );
  return categories.size === 1 ? [...categories][0] : null;
}

// ---------------------------------------------------------------------------
// verifier 逐条验证块（issue-verification fenced block——与 read-image-evidence
// 同款「prompt 产出端与解析端共用 SSOT」契约）
// ---------------------------------------------------------------------------

export const ISSUE_VERIFICATION_FENCE = 'issue-verification';

export type IssueVerificationVerdict = 'confirmed' | 'refuted' | 'unclear';

export interface IssueVerificationEntry {
  issue: string;
  verdict: IssueVerificationVerdict;
  /**
   * 证据新鲜度绑定（codex review 冻结项⑥）：该条验证所依据的问题内容摘要。
   * 消费侧要求它与当前报告同一 CR 的内容一致——否则判为**上一轮旧产物**，不采信
   * （同一 CR ID 被复用但缺陷内容已变时，旧 confirmed 不得驱动自动回退）。
   * 缺失=旧格式=不采信（fail-closed），不新增 receipt/key/registry/ledger。
   */
  evidence?: string;
  /** 非法原始 verdict 不等同于合法 unclear，仅供同源诊断。 */
  invalid_reason?: string;
}

const ISSUE_FENCE_RE = new RegExp(
  '```' + ISSUE_VERIFICATION_FENCE + '\\s*\\r?\\n([\\s\\S]*?)```',
  'i',
);

/**
 * 从 verifier 报告解析逐条验证块。契约：
 * ```issue-verification
 * - issue: CR-001
 *   verdict: confirmed
 * ```
 * 无块/空块 → ok:false（消费方视为「未逐条验证」，零 candidate——fail-closed）。
 * verdict 非法值按 unclear 处理（不明确不产 candidate）。
 */
export function parseIssueVerificationBlock(text: string): {
  ok: boolean;
  entries: IssueVerificationEntry[];
  reason: string;
} {
  if (!text || !text.trim()) return { ok: false, entries: [], reason: 'verifier 报告为空' };
  const m = ISSUE_FENCE_RE.exec(text);
  if (!m) return { ok: false, entries: [], reason: `缺 ${ISSUE_VERIFICATION_FENCE} fenced 块` };
  const entries: IssueVerificationEntry[] = [];
  const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const issueMatch = /^\s*-\s*issue:\s*(.+?)\s*$/.exec(lines[i]);
    if (!issueMatch) { i++; continue; }
    i++;
    const verdictMatch = i < lines.length ? /^\s*verdict:\s*(\S+)\s*$/.exec(lines[i]) : null;
    if (!verdictMatch) continue;
    const raw = verdictMatch[1].toLowerCase();
    i++;
    // evidence 为可选后继行（证据新鲜度绑定）——不在则本条按旧格式处理（消费侧不采信）
    let evidence: string | undefined;
    if (i < lines.length) {
      const evMatch = /^\s*evidence:\s*(.+?)\s*$/.exec(lines[i]);
      if (evMatch) {
        evidence = evMatch[1].trim();
        i++;
      }
    }
    entries.push({
      issue: issueMatch[1].trim(),
      verdict: raw === 'confirmed' || raw === 'refuted' ? raw : 'unclear',
      ...(evidence ? { evidence } : {}),
      ...(['confirmed', 'refuted', 'unclear'].includes(raw) ? {} : { invalid_reason: `非法 verdict=${raw}` }),
    });
  }
  if (entries.length === 0) return { ok: false, entries: [], reason: '逐条验证块无合法条目' };
  return { ok: true, entries, reason: `${entries.length} 条逐条验证` };
}

// ---------------------------------------------------------------------------
// review 侧生产点
// ---------------------------------------------------------------------------

export interface ReviewCandidateInput {
  /** review-report.md 全文 */
  reportText: string;
  /** verifier.report.md 全文（缺失传 null——零 candidate） */
  verifierReportText: string | null;
  /** @deprecated legacy receipt flag, ignored; human authorization cannot suppress a defect. */
  conditionalReceiptValid?: boolean;
  /** 报告结构/引用/结论一致性等 report-validity 检查存在 BLOCKER FAIL → 抑制 */
  reportValidityBlocked: boolean;
  /**
   * plan 33784ed1 §4.5：有拒修在案的候选（resolveRepairDeclineState 的 declined_rounds>0）。
   * 与 verifierSubjectCurrent=false 合取时该行不成立——沿用的历史评审没看过拒修依据。
   */
  declinedFingerprints?: ReadonlySet<string>;
  /** 历史原料不全时只要求当前审查，不据此宣称指纹等价。来源仍是共享拒修回放。 */
  declinedIssues?: ReadonlyArray<Pick<RepairDeclineState, 'id' | 'summary'>>;
  /** verifier 正文是否属于本轮签发的 subject（false = 沿用历史 subject）；缺省视为 true */
  verifierSubjectCurrent?: boolean;
}

interface IssueRow {
  id: string;
  severity: string;
  state: string;
  files: string[];
  summary: string;
}

function parseIssueRows(reportText: string): IssueRow[] {
  const section = getSectionContent(reportText, '问题清单');
  if (!section) return [];
  const tables = extractTables(section);
  if (tables.length === 0) return [];
  const table = tables[0];
  const col = (pred: (h: string) => boolean): number => table.headers.findIndex(pred);
  const iId = col(h => h.trim() === 'ID' || h.includes('编号'));
  const iSev = col(h => h.includes('严重程度') || h.includes('严重等级'));
  const iState = col(h => h.includes('状态'));
  const iFiles = col(h => h.includes('涉及文件'));
  const iFix = col(h => h.includes('修复建议'));
  const iDesc = col(h => h.includes('问题描述') || h.includes('描述'));
  if (iId < 0 || iSev < 0 || iFiles < 0) return [];
  return table.rows.map(row => ({
    id: (row[iId] ?? '').trim(),
    severity: (row[iSev] ?? '').trim(),
    state: iState >= 0 ? (row[iState] ?? '').trim() : '',
    files: normalizeReviewFiles((row[iFiles] ?? '')
      .split(/[,，;；\s]+/)
      .filter(Boolean)),
    summary: normalizeSummary(
      (iFix >= 0 ? row[iFix] : undefined) || (iDesc >= 0 ? row[iDesc] : undefined) || '',
    ),
  })).filter(r => r.id.length > 0);
}

/**
 * 证据新鲜度判据（codex 二/三轮冻结项，零新增机制——无 receipt/hash 账本/key/registry）：
 * verifier 的 evidence 必须**同时**绑定当前该 CR 的两件事：
 *   ① 涉及文件（basename 命中；该行无涉及文件时此项不适用）；
 *   ② **完整包含**当前报告该行的修复建议/问题摘要（规范化后逐字包含）。
 *
 * 为什么是"完整包含"而不是片段匹配（codex 三轮判别复现）：模糊匹配挡不住共享通用
 * 短语的不同缺陷——「修复下拉菜单状态机错误」（旧轮）与「修复短信验证状态机错误」
 * （当前）共享「状态机错误」，片段匹配会把旧证据当成当前证据、驱动错误改码。
 * 代价是 verifier 必须**原样复制**该行摘要（prompt 已明文要求）；宁可因没照抄而不产
 * 候选（落回原地 retry），也不让模糊短语驱动改码。evidence 缺失一律不采信。
 */
function isVerificationEvidenceCurrent(
  evidence: string | undefined,
  row: { files: string[]; summary: string },
): boolean {
  if (!evidence || !evidence.trim()) return false;
  const ev = evidence.replace(/\s+/g, '').toLowerCase();
  if (row.files.length > 0) {
    const fileHit = row.files.some((f) => {
      const base = f.split('/').pop()?.replace(/\s+/g, '').toLowerCase() ?? '';
      return base.length > 0 && ev.includes(base);
    });
    if (!fileHit) return false; // 文件都对不上 → 必然不是当前证据
  }
  const current = row.summary.replace(/\s+/g, '').toLowerCase();
  if (current.length === 0) return false;
  return ev.includes(current);
}

function openReviewIssues(reportText: string): IssueRow[] {
  return parseIssueRows(reportText).filter(row => (row.severity === 'BLOCKER' || row.severity === 'MAJOR')
    && !/已关闭|已修复|closed|fixed/i.test(row.state));
}

export interface ReviewDiagnosisContext {
  reportText: string;
  declinedFingerprints?: ReadonlySet<string>;
  declinedIssues?: ReadonlyArray<Pick<RepairDeclineState, 'id' | 'summary'>>;
  verifierSubjectCurrent?: boolean;
}

/** 候选生产与失败诊断同一判据；合法 refuted/unclear 不因 verdict 本身被重投。 */
function reviewIssueDiagnosis(
  row: IssueRow,
  entries: readonly IssueVerificationEntry[],
  context: Pick<ReviewDiagnosisContext, 'declinedFingerprints' | 'declinedIssues' | 'verifierSubjectCurrent'>,
): string | null {
  const matches = entries.filter(entry => entry.issue === row.id);
  if (matches.length === 0) return `${row.id}：缺逐条验证条目`;
  if (matches.length !== 1) return `${row.id}：逐条验证条目重复/冲突`;
  const verified = matches[0];
  if (verified.invalid_reason) return `${row.id}：${verified.invalid_reason}`;
  if (!verified.evidence?.trim()) return `${row.id}：缺 evidence 绑定`;
  if (!isVerificationEvidenceCurrent(verified.evidence, row)) return `${row.id}：evidence 与当前文件/问题摘要不一致`;
  if (context.verifierSubjectCurrent === false
    && (context.declinedFingerprints?.has(itemFingerprintOf(row.id, row.files, row.summary))
      || context.declinedIssues?.some(issue => issue.id === row.id && normalizeSummary(issue.summary) === row.summary))) {
    return `${row.id}：拒修在案，沿用的旧 subject 无法作当前逐条确认`;
  }
  return null;
}

/**
 * review 侧候选组装（信任合取，缺一不产）：
 * · 结论 ∈ {有条件通过, 不通过}（负面裁决两分支都覆盖）；
 * · 该行 severity ∈ {BLOCKER, MAJOR} 且状态未关闭；
 * · verifier 逐条验证块存在且该条 verdict=confirmed（抽样全局 PASS 不算数）；
 * · 无 report-validity BLOCKER；人工授权不得抑制可信缺陷候选；
 * · 归属可推导（路径域一致；review 无机器 check id 归属，走兜底）。
 */
export function collectReviewRepairCandidates(input: ReviewCandidateInput): RepairCandidate[] {
  if (input.reportValidityBlocked) return [];
  const section = getSectionContent(input.reportText, '结论')
    ?? getSectionContent(input.reportText, '审查结论') ?? '';
  const { verdict } = extractDeclaredVerdict(section, ['有条件通过', '不通过', '通过']);
  if (verdict !== '有条件通过' && verdict !== '不通过') return [];
  const verification = parseIssueVerificationBlock(input.verifierReportText ?? '');
  if (!verification.ok) return [];
  const out: RepairCandidate[] = [];
  for (const row of openReviewIssues(input.reportText)) {
    if (reviewIssueDiagnosis(row, verification.entries, input)) continue;
    if (verification.entries.find(entry => entry.issue === row.id)?.verdict !== 'confirmed') continue;
    const category = deriveCategoryFromFiles(row.files);
    if (category === null) continue; // 归属推导不出——宁缺毋滥
    const files = normalizeFiles(row.files);
    const itemFingerprint = itemFingerprintOf(row.id, files, row.summary);
    out.push({
      id: row.id,
      category,
      files,
      summary: row.summary,
      item_fingerprint: itemFingerprint,
      source_phase: 'review',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 机器 check id 直接归属的生产点（codex 优先级①——路径域不参与）
// ---------------------------------------------------------------------------

/** check id → 责任类别的机器归属注册表（锁定例；ui_scope_violation 即使
 *  affected_files 是产品源码也归 plan——scope 越界是 plan 冻结面的裁决问题）。 */
export const CHECK_ID_OWNER_REGISTRY: Readonly<Record<string, RepairOwnerCategory>> = Object.freeze({
  scope_consistency_with_spec: 'spec',
  device_ac_delegation: 'spec',
  ui_scope_violation: 'plan',
});

export interface CheckOwnedCandidateInput {
  checkId: keyof typeof CHECK_ID_OWNER_REGISTRY | string;
  sourcePhase: string;
  /** 该 check FAIL 的人类可读明细（进 summary 与指纹） */
  detail: string;
  affectedFiles?: readonly string[];
}

/**
 * plan f7045213 §7：check id 的有效责任方——去向表登记的结果依据类读去向表，没登记的读既有注册表。
 * 'current_phase' = 当前阶段修复与重试，不产生回退候选。
 */
export function effectiveRepairOwner(checkId: string): RepairOwnerCategory | 'current_phase' | null {
  const owner = resultBasisOwner(checkId);
  if (owner) return owner;
  return CHECK_ID_OWNER_REGISTRY[checkId] ?? null;
}

/** 机器 check id 归属的候选（check FAIL 时由所在阶段的组装层调用；
 *  信任条件=该 check 自身的判定，不再叠加 verifier）。未注册 id 或当前阶段责任 → null。 */
export function checkOwnedCandidate(input: CheckOwnedCandidateInput): RepairCandidate | null {
  const category = effectiveRepairOwner(input.checkId);
  if (!category || category === 'current_phase' || category === input.sourcePhase) return null;
  const files = normalizeFiles(input.affectedFiles ?? []);
  const summary = normalizeSummary(input.detail);
  return {
    id: input.checkId,
    category,
    files,
    summary,
    item_fingerprint: itemFingerprintOf(input.checkId, files, summary),
    source_phase: input.sourcePhase,
  };
}

// ---------------------------------------------------------------------------
// verifier 报告 check 状态解析（D3 · plan 3a7f9c12）
// ---------------------------------------------------------------------------
// F02 实锤：`verify-*.md` §7.1 要求的**正式输出**是一张汇总表（每个检查项一行，PASS 也列），
// §7.2 的 YAML 明细**只列 status ≠ PASS 的项**。旧解析器只认 YAML 的 `- id: / status:`，
// 于是「PASS」这一半永远读不到——`end_to_end_driving` / `business_assertion_value` 的
// PASS 合取恒不成立，UT 的 coding 候选在规范报告下恒为零；只有写了非规范 PASS YAML 的报告
// 才碰巧能产出候选。两种形态给出**不同结论**，正是本 plan 要收口的等值缺口。
//
// 收口：先读正式汇总表（复用 markdown-parser.extractTables，不另写表格解析器），再叠加旧
// YAML 形态；两处口径合并去重。只认 PASS/FAIL/WARN；同条一致重复去重；**冲突或坏状态一律
// 不采信（null）**——不选择有利的那个 PASS。null 走各消费者既有的「未确认」通道。
// ---------------------------------------------------------------------------

type VerifierCheckStatus = 'PASS' | 'FAIL' | 'WARN';

/**
 * 单元格/字面量归一：只剥**允许的装饰**（反引号、加粗/斜体、删除线、首尾空白）后
 * **精确**匹配单一状态；其余（SKIP、`PASS / FAIL`、`NOT PASS`、`<PASS>`、空）= 坏状态。
 *
 * 旧实现用 `/\b(PASS|FAIL|WARN)\b/` 取**第一个**状态词，于是冲突态（`PASS / FAIL`）、
 * 否定态（`NOT PASS`）与占位符（`<PASS>`）全部被采信成 PASS，并据此产出 coding 候选
 * ——正是 D3 明令禁止的"选择有利的那个 PASS"（codex 一轮 medium）。
 */
function normalizeVerifierStatusCell(raw: string | undefined): VerifierCheckStatus | null {
  const token = (raw ?? '').replace(/[`*_~]/g, '').trim().toUpperCase();
  return token === 'PASS' || token === 'FAIL' || token === 'WARN' ? token : null;
}

/**
 * 表格 id 单元格归一（模型常写成 `` `end_to_end_driving` `` 或 **加粗**）。
 * **不剥下划线**——它是 check id 的一部分（`end_to_end_driving`），当成强调符号剥掉
 * 会让所有 id 永远匹配不上。
 */
function normalizeVerifierIdCell(raw: string | undefined): string {
  return (raw ?? '').replace(/[`*~\s]/g, '');
}

export function parseVerifierCheckStatus(
  text: string,
  checkId: string,
): VerifierCheckStatus | null {
  if (!text || !text.trim()) return null;
  const seen = new Set<VerifierCheckStatus>();
  let malformed = false;

  // ① 正式汇总表：**精确**列头 id + status（`| id | status | severity | 证据 |`）。
  //    列头不精确的表一概不看——prompt 里「本轮检查项与严重等级」表只有 id/severity，
  //    宽松匹配会把它当结论表读，凭空造出并不存在的状态。
  for (const table of extractTables(text)) {
    const iId = table.headers.findIndex(h => h.trim().toLowerCase() === 'id');
    const iStatus = table.headers.findIndex(h => h.trim().toLowerCase() === 'status');
    if (iId < 0 || iStatus < 0) continue;
    for (const row of table.rows) {
      if (normalizeVerifierIdCell(row[iId]) !== checkId) continue;
      const status = normalizeVerifierStatusCell(row[iStatus]);
      if (status) seen.add(status);
      else malformed = true; // SKIP / 空 / `<status>` 占位 / 乱写 → 不采信
    }
  }

  // ② 旧 YAML 形态（`- id: <check>` 后 3 行内的 `status:`）——继续兼容，不再首个即返回。
  //    值取**整行剩余部分**（归一函数自己 trim）而非首个非空白词：`(\S+)` 会先把
  //    `status: PASS / FAIL` 截成 `PASS` 再归一，整格精确匹配就白做了（codex 二轮 medium）。
  //    prompt 模板里的 `status: FAIL | WARN | SKIP` 占位行同理，照抄不改一律不采信。
  const lines = text.split(/\r?\n/);
  const idLine = new RegExp(`^\\s*-\\s*id:\\s*${checkId}\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (!idLine.test(lines[i])) continue;
    let status: VerifierCheckStatus | null = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const m = /^\s*status:\s*(.*)$/.exec(lines[j]);
      if (m) {
        status = normalizeVerifierStatusCell(m[1]);
        break;
      }
      if (/^\s*-\s*id:/.test(lines[j])) break;
    }
    if (status) seen.add(status);
    else malformed = true;
  }

  if (malformed || seen.size !== 1) return null;
  return [...seen][0];
}

/**
 * D3/D4（plan 3a7f9c12）：诊断轮的**必需检查项**能不能从当前 subject 的正文里读出来。
 *
 * loader 的终态校验只证明报告有一个自洽的结论块（PASS/0 或 FAIL/B），**不**证明这些
 * 项可采信。表格/YAML 缺项或冲突时，正确的出路是「按 verifier 的原始回复重写报告」——
 * 而不是把调用方指回"先修原始 blocker"（重复 harness 只会复用同一份坏正文，零候选）。
 *
 * 返回读不出来的必需项 id；空数组 = 正文可采信。两个分支都复用本文件已有解析器，
 * 不另写第二套判据：
 *  · ut：`end_to_end_driving` / `business_assertion_value`（候选合取的两项，D3 表 UT 行）；
 *  · review：`issue-verification` 逐条验证块（负面裁决必然有待核问题，块缺席=格式缺口）。
 */
export function findUnreadableDiagnosisChecks(
  phase: string,
  verifierReportText: string | null,
  review?: ReviewDiagnosisContext,
): string[] {
  if (!verifierReportText || !verifierReportText.trim()) return [];
  if (phase === 'ut') {
    return ['end_to_end_driving', 'business_assertion_value'].filter(
      id => parseVerifierCheckStatus(verifierReportText, id) === null,
    );
  }
  if (phase === 'review') {
    const verification = parseIssueVerificationBlock(verifierReportText);
    if (!verification.ok) return [ISSUE_VERIFICATION_FENCE];
    return review ? openReviewIssues(review.reportText)
      .flatMap(row => { const reason = reviewIssueDiagnosis(row, verification.entries, review); return reason ? [reason] : []; }) : [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 阶段级组装（harness-runner summary 落盘前调用——共享输入层，非 goal-runner 私有）
// ---------------------------------------------------------------------------

export interface PhaseCandidateInput {
  phase: string;
  /** review-report.md 全文（review 阶段；其余 null） */
  reviewReportText: string | null;
  /** reports/verifier.report.md 全文（agent 自跑轮可能尚无——零 candidate，gate 轮出现） */
  verifierReportText: string | null;
  /** summary.report_validity（harness 派生）——非 PASS 时**报告自由文本**派生候选抑制
   * （c7e4a2d9：机器 check / verifier 合取候选不受此闸，负面结论不得抹掉机器修复事实） */
  reportValidity: 'PASS' | 'FAIL' | 'UNVERIFIED';
  /** @deprecated legacy receipt flag, ignored. */
  conditionalReceiptValid?: boolean;
  /** §4.5：见 ReviewCandidateInput 同名字段 */
  declinedFingerprints?: ReadonlySet<string>;
  declinedIssues?: ReadonlyArray<Pick<RepairDeclineState, 'id' | 'summary'>>;
  verifierSubjectCurrent?: boolean;
  /** 本轮 checks（机器 check id 归属的生产点消费） */
  checks: ReadonlyArray<{
    id: string;
    status: string;
    severity?: string;
    details?: string;
    classification?: string;
    failure_kind?: string;
    failure_code?: string;
    repair_owner?: 'coding' | 'spec' | 'plan' | 'testing' | 'capability' | 'external';
    coding_candidate?: boolean;
    affected_files?: readonly string[];
    structured?: unknown;
  }>;
}

/**
 * 按阶段组装 repair_candidates。生产点（plan b6e4c9f2 t1 + c7e4a2d9）：
 * · review：问题表 × verifier 逐条 confirmed × 路径域归属（信任合取见 collectReview…）；
 * · plan：scope_consistency_with_spec FAIL → spec（机器归属）；
 * · ut：verifier device_ac_delegation FAIL → spec（机器归属）；
 *   （ut→coding 的 assertion 合取与 testing 缺陷并入在 t4 端到端接线时接入）
 * · testing：已执行 native StepResult assertion + assertion_mismatch 机器合取 → coding
 *  （不注册整个 check，只消费 gate 已写出的 failure pair；report_validity 不抑制机器事实）；
 * · coding：ui_diff_within_declared_files 的 ui_scope_violation 分类 → plan（机器归属）。
 * report_validity 只约束**依赖报告自由文本**的 review 候选（c7e4a2d9 §2.3）：机器 check /
 * verifier 合取候选不得因产品负面结论而被整体清空——负面结论恰恰是回修候选最需要存活的时刻。
 */
export function collectPhaseRepairCandidates(input: PhaseCandidateInput): RepairCandidate[] {
  const out: RepairCandidate[] = [];
  if (input.phase === 'review' && input.reviewReportText) {
    out.push(...collectReviewRepairCandidates({
      reportText: input.reviewReportText,
      verifierReportText: input.verifierReportText,
      // c7e4a2d9：review 候选依赖报告内容——report invalid 时继续抑制；机器候选不受此闸
      reportValidityBlocked: input.reportValidity !== 'PASS',
      declinedFingerprints: input.declinedFingerprints,
      declinedIssues: input.declinedIssues,
      verifierSubjectCurrent: input.verifierSubjectCurrent,
    }));
  }
  if (input.phase === 'plan') {
    const scope = input.checks.find(
      c => c.id === 'scope_consistency_with_spec' && c.status === 'FAIL',
    );
    if (scope) {
      const c = checkOwnedCandidate({
        checkId: 'scope_consistency_with_spec',
        sourcePhase: 'plan',
        detail: scope.details ?? 'spec Scope 声明缺陷',
        affectedFiles: scope.affected_files,
      });
      if (c) out.push(c);
    }
  }
  if (input.phase === 'ut' && input.verifierReportText) {
    if (parseVerifierCheckStatus(input.verifierReportText, 'device_ac_delegation') === 'FAIL') {
      const c = checkOwnedCandidate({
        checkId: 'device_ac_delegation',
        sourcePhase: 'ut',
        detail: 'UT verifier 判定 AC 属设备域、应回 spec 建模（device_ac_delegation FAIL）',
      });
      if (c) out.push(c);
    }
    // UT product assertion → coding（信任合取，缺一不产；不造 LLM 根因分类器——
    // 全部条件来自既有 verifier/门禁产物）：
    //   ① ut_hvigor_test FAIL 且归因 code_regression（真实断言失败，非 toolchain/
    //      build_config_invalid/device_blocked 等环境类）；
    //   ② UT 结构门禁通过（除 ut_hvigor_test 外无 BLOCKER FAIL——结构坏时先修 UT 自身）；
    //   ③ verifier 确认测试语义有效（end_to_end_driving 与 business_assertion_value
    //      均 PASS——测试真在驱动业务且断言有价值，否则失败可能是 UT 写错）。
    const utTest = input.checks.find(c => c.id === 'ut_hvigor_test');
    const utStructureClean = !input.checks.some(
      c => isBlockingCheck(c) && c.id !== 'ut_hvigor_test',
    );
    const semanticsValid =
      parseVerifierCheckStatus(input.verifierReportText, 'end_to_end_driving') === 'PASS' &&
      parseVerifierCheckStatus(input.verifierReportText, 'business_assertion_value') === 'PASS';
    if (
      utTest?.status === 'FAIL' &&
      utTest.classification === 'code_regression' &&
      utStructureClean &&
      semanticsValid
    ) {
      const files = normalizeFiles(utTest.affected_files ?? []);
      const summary = normalizeSummary(
        utTest.details ?? 'UT 真实断言失败且测试语义已验真——产品源码缺陷',
      );
      out.push({
        id: 'ut_product_assertion_failure',
        category: 'coding',
        files,
        summary,
        item_fingerprint: itemFingerprintOf('ut_product_assertion_failure', files, summary),
        source_phase: 'ut',
      });
    }
  }
  if (input.phase === 'testing') {
    // T3：coding candidate 只允许由已执行 StepResult 的冻结 pair 产生。
    // explicit skip/unexecuted 没有 failure_kind/code，不能通过 check id 或 status 猜测 coding。
    //
    // plan e7a2c4f1 §3.5（G26）：**第二档（账本/形状）失败不产生回退交接。**
    // 原先还有一条 `repair_owner === 'spec' | 'plan'` 分支。testing 期真正能落这两个值的
    // 只有一个生产点——`testing_channel_evidence_obligation` 把视觉 gate 的
    // `evidence_block_owner` 提上来（commit 8868988d）；Step Outcome v1 的路由只会给出
    // `coding`（`hylyre-failure-routing-v1.ts` 的 `repairCategory`）或 capability/external/testing。
    // 也就是说这条分支的唯一实际含义是"本轮视觉证据不可消费、责任在 spec"——账本/形状缺口，
    // 它没有上游产物需要作废，要的是对齐或披露。
    // **删掉的只是"生成回退交接候选"这一件事**：责任方与责任文件仍由该 check 的
    // `repair_owner` / `affected_files` → summary blocker → `classifyFailureKind`
    // （`spec_capture_gap`）如实披露，一个字未少。
    // 落在生产点而不是 runner 的回退调用点，是因为 assess 读的是**盘上 summary** 的
    // `repair_candidates`，在 runner 内存里过滤挡不住它的责任阶段推荐（实测：过滤后仍
    // `backtrack_to_phase → spec`）。`resolveInvalidatablePhases` 未动。
    for (const failure of input.checks.filter(
      c => c.status === 'FAIL' && (
        (c.failure_kind === 'assertion' &&
          c.failure_code === 'assertion_mismatch' &&
          c.coding_candidate === true) ||
        (c.coding_candidate === true && c.repair_owner === 'coding')
      ),
    )) {
      const files = normalizeFiles(failure.affected_files ?? []);
      const summary = normalizeSummary(
        failure.details ?? '已执行 StepResult assertion_mismatch——默认回 coding/product 修复',
      );
      const ref = (failure.structured as { repair_evidence?: unknown } | null)?.repair_evidence;
      out.push({
        id: failure.id,
        category: 'coding',
        files,
        summary,
        item_fingerprint: itemFingerprintOf(failure.id, files, summary),
        source_phase: 'testing',
        ...(ref && validateRepairEvidenceRef(ref).length === 0 ? { evidence_refs: [ref as RepairEvidenceRef] } : {}),
      });
    }
  }
  if (input.phase === 'coding') {
    const scopeViolation = input.checks.find(
      c => c.id === 'ui_diff_within_declared_files' && c.classification === 'ui_scope_violation',
    );
    if (scopeViolation) {
      const c = checkOwnedCandidate({
        checkId: 'ui_scope_violation',
        sourcePhase: 'coding',
        detail: scopeViolation.details ?? 'coding 改动超出 plan 冻结的 UI scope 白名单',
        affectedFiles: scopeViolation.affected_files,
      });
      if (c) out.push(c);
    }
  }
  // plan f7045213 §7：去向表登记的结果依据类失败——责任在上游（spec/plan/coding）的产生回退候选，由既有 assess
  // 推荐路由；责任在当前阶段的走既有的当前阶段修复与重试（checkOwnedCandidate 对 current_phase 返回 null）。
  for (const check of input.checks) {
    if (check.status !== 'FAIL' || !resultBasisOwner(check.id) || out.some(c => c.id === check.id)) continue;
    const c = checkOwnedCandidate({ checkId: check.id, sourcePhase: input.phase, detail: check.details ?? check.id, affectedFiles: check.affected_files });
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 生产接线（harness-runner summary writer 与测试**共用同一实现**——codex 二轮
// 冻结项③：禁止用源码正则或手工拼对象冒充生产接线验证）
// ---------------------------------------------------------------------------

/** CheckResult 的最小形状（types.ts CheckResult 的结构子集，避免循环依赖） */
export interface RepairCandidateCheckInput {
  id: string;
  status: string;
  severity?: string;
  details?: string;
  /** 机器归因（check 侧真实字段；ui-scope-gate 等只写它，details 未必含归因文本） */
  failure_kind?: string;
  failure_code?: string;
  repair_owner?: 'coding' | 'spec' | 'plan' | 'testing' | 'capability' | 'external';
  coding_candidate?: boolean;
  affected_files?: string[];
  structured?: unknown;
}

export interface SummaryRepairCandidatesInput {
  phase: string;
  checks: readonly RepairCandidateCheckInput[];
  reportValidity: 'PASS' | 'FAIL' | 'UNVERIFIED';
  reviewReportText: string | null;
  verifierReportText: string | null;
  /** @deprecated legacy receipt flag, ignored. */
  conditionalReceiptValid?: boolean;
  /** details 文本兜底归因解析器（harness-runner 既有实现注入，测试同款） */
  parseClassificationFromDetails?: (details: string) => string | undefined;
  /** §4.5：见 ReviewCandidateInput 同名字段 */
  declinedFingerprints?: ReadonlySet<string>;
  declinedIssues?: ReadonlyArray<Pick<RepairDeclineState, 'id' | 'summary'>>;
  verifierSubjectCurrent?: boolean;
}

/**
 * summary writer 侧的候选组装**唯一实现**：checks 的机器归因（failure_kind 优先、
 * details 文本兜底）→ 组装 → 候选。harness-runner 调它，测试也调它——
 * 生产接线因此可被行为测试真正覆盖（而非源码正则）。
 */
export function buildSummaryRepairCandidates(
  input: SummaryRepairCandidatesInput,
): RepairCandidate[] {
  return collectPhaseRepairCandidates({
    phase: input.phase,
    reviewReportText: input.reviewReportText,
    verifierReportText: input.verifierReportText,
    reportValidity: input.reportValidity,
    declinedFingerprints: input.declinedFingerprints,
    declinedIssues: input.declinedIssues,
    verifierSubjectCurrent: input.verifierSubjectCurrent,
    checks: input.checks.map((c) => ({
      id: c.id,
      status: c.status,
      severity: c.severity,
      details: c.details,
      // codex 冻结项⑤：check 侧真实机器归因优先，details 文本仅兜底
      classification: c.failure_kind
        ?? (c.details ? input.parseClassificationFromDetails?.(c.details) : undefined),
      failure_kind: c.failure_kind,
      failure_code: c.failure_code,
      repair_owner: c.repair_owner,
      coding_candidate: c.coding_candidate,
      affected_files: c.affected_files,
      structured: c.structured,
    })),
  });
}

/** runtime 的有界候选事件投影，证据与原身份同时保留。 */
export function serializeBacktrackRepairCandidate(candidate: RepairCandidate): RepairCandidate {
  return {
    id: candidate.id, category: candidate.category, files: candidate.files.slice(0, 10),
    summary: candidate.summary.length > 400 ? `${candidate.summary.slice(0, 400)}…` : candidate.summary,
    item_fingerprint: candidate.item_fingerprint, source_phase: candidate.source_phase,
    ...(candidate.identity_schema ? { identity_schema: candidate.identity_schema } : {}),
    ...(candidate.evidence_refs ? { evidence_refs: candidate.evidence_refs } : {}),
  };
}

/** 最后一条回退覆盖原候选；非 repair 回退自动清空，旧证据不泄漏到后续 prompt。 */
export function restoreBacktrackCandidatesFromEvents(
  events: ReadonlyArray<{ type?: string; candidates?: unknown }>,
): RepairCandidate[] {
  let out: RepairCandidate[] = [];
  for (const e of events) {
    if (e.type !== 'phase_backtrack_requested') continue;
    out = Array.isArray(e.candidates) ? (e.candidates as RepairCandidate[]) : [];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 拒修与反驳状态（plan 33784ed1 §4.3）——四处判定与目标简报的唯一来源
// ---------------------------------------------------------------------------
// 回修轮 = 一条 phase_backtrack_requested 及其窗口（到同 run 下一条同类事件；没有时到该 run 的有效
// run_end——resolveEffectiveRunEnd：没被其后 run_start/resume 取代的最后一条；没有则窗口开放）。
// 拒修动作 = 候选责任阶段账本里的一行：gate_id=repair_candidate:<fp>、decision 以 `declined:` 开头，
// run_id 等于回修轮所在 run 且 ts 落在窗口内；来源核验 = 依据里「」引文全部逐字出现在当前目标文本。
// 只读事件与账本：内存回退待办、完成事件上的清单都不是来源。

export const REPAIR_DECLINE_GATE_PREFIX = 'repair_candidate:';

export interface RepairDeclineRound { run_id: string; ts: string }

export interface RepairDeclineState {
  id: string;
  summary: string;
  /** 有来源核验通过的拒修动作的回修轮数 */
  declined_rounds: number;
  /** 是否已在一次拒修之后再次出现在回修轮里（反驳轮已用） */
  rebuttal_used: boolean;
  /** 最近一次拒修：依据原文、所在 run 与回修轮 */
  basis: { text: string; run_id: string; round: RepairDeclineRound } | null;
  /** 第一次拒修所在回修轮——已尝试记录只豁免这一轮 */
  first_declined_round: RepairDeclineRound | null;
}

export interface DeclineLedgerLine { run_id: string; gate_id: string; decision: string; ts: string }

/** 来源核验：返回依据原文；不是拒修或引文不逐字 → null。 */
function verifiedDeclineBasis(decision: string, requirementText: string): string | null {
  const m = /^\s*declined:\s*([\s\S]*\S)\s*$/.exec(decision);
  if (!m) return null;
  const quotes = [...m[1].matchAll(/「([^」]*)」/g)].map(q => q[1]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { checkRequirementQuote } = require('./fidelity-shared') as typeof import('./fidelity-shared');
  if (!quotes.length || quotes.some(q => checkRequirementQuote(q, requirementText) !== 'ok')) return null;
  return m[1];
}

/**
 * 候选在一个回修轮里的责任阶段：用责任路由同一张类别→阶段表（mapCategoryToChainPhase），链取该轮会重新执行的阶段。
 * full/lite 两种投影在 spec/plan 上互斥（spec|plan 对 change）、coding 同名，依次尝试结果唯一；不在重跑阶段内 → null。
 */
function roundOwnerPhase(category: unknown, roundPhases: readonly string[]): string | null {
  if (category !== 'spec' && category !== 'plan' && category !== 'coding') return null;
  return mapCategoryToChainPhase(category, roundPhases, 'full') ?? mapCategoryToChainPhase(category, roundPhases, 'lite');
}

export function resolveRepairDeclineState(input: {
  /** 交付周期内的 run（祖先在前与否不限，按回修事件 ts 排序） */
  runs: ReadonlyArray<{ run_id: string; events: ReadonlyArray<{ ts?: string; type?: string; to_phase?: unknown; invalidated_phases?: unknown; candidates?: unknown }> }>;
  /** 阶段 → 该阶段账本行（loadHeadlessLedger 的 entries）；每个候选只读它责任阶段的那份 */
  ledgers: Readonly<Record<string, ReadonlyArray<DeclineLedgerLine>>>;
  requirementText: string;
}): Map<string, RepairDeclineState> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveEffectiveRunEnd } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
  const rounds: Array<RepairDeclineRound & { end: number; candidates: Array<{ fp: string; id: string; summary: string; owner: string }> }> = [];
  const canonicalFingerprints = new Map<string, string>();
  for (const run of input.runs) {
    const bts = run.events.filter(e => e.type === 'phase_backtrack_requested' && typeof e.ts === 'string');
    // 窗口上界：同 run 下一条回修事件；没有时取 resolveEffectiveRunEnd（没被其后 run_start/resume 取代的
    // 最后一条 run_end，其后的 finalize_* 收尾事件不影响），有则以它关窗，否则保持开放
    //（停机后 resume 同一 run 会接着写同一个 events 文件、不重发回修事件，resume 后写的拒修仍属这一轮）。
    const effectiveEnd = resolveEffectiveRunEnd(run.events as GoalRunEvent[]);
    const runEnded = typeof effectiveEnd?.ts === 'string' ? Date.parse(effectiveEnd.ts) : Infinity;
    bts.forEach((e, i) => {
      const phases = [e.to_phase, ...(Array.isArray(e.invalidated_phases) ? e.invalidated_phases : [])]
        .filter((p): p is string => typeof p === 'string');
      // 本轮下发 = 候选的责任阶段在该轮会重新执行的阶段里；只认责任阶段自己的账本（同一张类别→阶段表）
      const candidates = (Array.isArray(e.candidates) ? e.candidates : [])
        .map(c => c as Record<string, unknown>)
        .filter(c => c && typeof c.item_fingerprint === 'string')
        .map(c => {
          const fp = String(c.item_fingerprint);
          // 只由原事件完整身份原料证明别名。截断/缺字段不能倒推旧 fp，native 原身份不变。
          if (c.source_phase === 'review' && typeof c.id === 'string' && typeof c.summary === 'string'
            && Array.isArray(c.files) && c.files.every(file => typeof file === 'string')
            && itemFingerprintOf(c.id, c.files, c.summary) === fp) {
            canonicalFingerprints.set(fp, itemFingerprintOf(c.id, normalizeReviewFiles(c.files), c.summary));
          }
          return { fp, id: String(c.id ?? ''), summary: String(c.summary ?? ''), owner: roundOwnerPhase(c.category, phases) };
        })
        .filter((c): c is { fp: string; id: string; summary: string; owner: string } => c.owner !== null);
      const next = bts[i + 1]?.ts;
      rounds.push({ run_id: run.run_id, ts: e.ts!, end: next ? Date.parse(next) : runEnded, candidates });
    });
  }
  rounds.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const out = new Map<string, RepairDeclineState>();
  for (const round of rounds) {
    const start = Date.parse(round.ts);
    const candidates = new Map<string, typeof round.candidates[number] & { originalFps: Set<string> }>();
    for (const candidate of round.candidates) {
      const fp = canonicalFingerprints.get(candidate.fp) ?? candidate.fp;
      const key = `${candidate.owner}:${fp}`;
      const grouped = candidates.get(key);
      if (grouped) grouped.originalFps.add(candidate.fp);
      else candidates.set(key, { ...candidate, fp, originalFps: new Set([candidate.fp]) });
    }
    for (const c of candidates.values()) {
      const lines = input.ledgers[c.owner] ?? [];
      let st = out.get(c.fp);
      if (!st) {
        st = { id: c.id, summary: c.summary, declined_rounds: 0, rebuttal_used: false, basis: null, first_declined_round: null };
        out.set(c.fp, st);
      }
      for (const fp of c.originalFps) out.set(fp, st);
      if (st.declined_rounds > 0) st.rebuttal_used = true;
      st.id = c.id;
      st.summary = c.summary;
      let latest: { text: string; at: number } | null = null;
      for (const line of lines) {
        if (!c.originalFps.has(line.gate_id.slice(REPAIR_DECLINE_GATE_PREFIX.length))
          || !line.gate_id.startsWith(REPAIR_DECLINE_GATE_PREFIX) || line.run_id !== round.run_id) continue;
        const at = Date.parse(line.ts);
        if (!(at >= start && at < round.end)) continue;
        const text = verifiedDeclineBasis(line.decision, input.requirementText);
        if (text !== null && (!latest || at >= latest.at)) latest = { text, at };
      }
      if (!latest) continue;
      const key = { run_id: round.run_id, ts: round.ts };
      st.declined_rounds += 1;
      st.first_declined_round ??= key;
      st.basis = { text: latest.text, run_id: round.run_id, round: key };
    }
  }
  return out;
}

/** 本次出现即反驳轮：拒修过一次且反驳轮未用（整轮重复判断排除它）。 */
export function isRebuttalAppearance(state: RepairDeclineState | undefined): boolean {
  return !!state && state.declined_rounds === 1 && !state.rebuttal_used;
}

/** 已尝试记录的豁免：只豁免该候选第一次拒修所在的回修轮。 */
export function declineAttemptExemption(
  states: ReadonlyMap<string, RepairDeclineState>,
  runId: string,
): (backtrackEvent: { ts?: string }, fingerprint: string) => boolean {
  return (e, fp) => {
    const first = states.get(fp)?.first_declined_round;
    return !!first && first.run_id === runId && first.ts === e.ts;
  };
}

/** 未收敛停机说明：并列执行者的拒修依据与裁判的缺陷描述（§4.5）。 */
export function declineDisputeLines(
  candidates: ReadonlyArray<Pick<RepairCandidate, 'id' | 'summary' | 'item_fingerprint'>>,
  states: ReadonlyMap<string, RepairDeclineState>,
): string[] {
  const rows = candidates.flatMap(c => {
    const b = states.get(c.item_fingerprint)?.basis;
    return b ? [`- ${c.id}：执行者拒修依据（run ${b.run_id}）：${b.text}；裁判缺陷描述：${c.summary}`] : [];
  });
  return rows.length ? ['双方依据（执行者按目标拒修、裁判仍然提出；是否修改需求由用户看过双方依据后决定）：', ...rows] : [];
}

/**
 * 从盘上读出交付周期内的事件（foldBudgetLineage，祖先 run 计入）、回修轮涉及阶段的账本与当前目标文本，
 * 交给 resolveRepairDeclineState。run 不存在或不可读 → 空状态。
 */
export function loadRepairDeclineState(projectRoot: string, feature: string, runId: string): Map<string, RepairDeclineState> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const pathMod = require('path') as typeof import('path');
  const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
  const { featureRelativePath } = require('./feature-identity') as typeof import('./feature-identity');
  const { foldBudgetLineage, loadAuthoritativeEvents } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
  const { loadHeadlessLedger } = require('./headless-assumptions') as typeof import('./headless-assumptions');
  const { collectCurrentRequirementText } = require('./fidelity-shared') as typeof import('./fidelity-shared');
  /* eslint-enable @typescript-eslint/no-require-imports */
  if (!runId.trim()) return new Map();
  let featuresDir = 'doc/features';
  try { featuresDir = (loadFrameworkConfig(projectRoot).paths?.features_dir ?? featuresDir).replace(/\\/g, '/'); } catch { /* 默认目录 */ }
  const runDir = pathMod.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs', runId);
  const eventsPath = pathMod.join(runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return new Map();
  let successorSeed: string[] = [];
  try {
    const m = JSON.parse(fs.readFileSync(pathMod.join(runDir, 'manifest.json'), 'utf8')) as { successor_of?: unknown; execution_scope?: unknown };
    if (m.execution_scope && typeof m.successor_of === 'string' && m.successor_of) successorSeed = [m.successor_of];
  } catch { /* 无 manifest → 只看事件里的 supersede */ }
  const events = loadAuthoritativeEvents(eventsPath);
  // 取法与预算折叠同源（runtime 的 budgetLineage 同一种子：事件里的 supersede ∪ successor_of）
  const fold = foldBudgetLineage({ projectRoot, featuresDir, feature, seedTargets: successorSeed, currentEvents: events });
  const runs = [...fold.ancestorRuns, { run_id: runId, events }];
  const phases = new Set<string>();
  for (const run of runs) for (const e of run.events) {
    const ev = e as { type?: string; to_phase?: unknown; invalidated_phases?: unknown };
    if (ev.type !== 'phase_backtrack_requested') continue;
    for (const p of [ev.to_phase, ...(Array.isArray(ev.invalidated_phases) ? ev.invalidated_phases : [])]) {
      if (typeof p === 'string' && p) phases.add(p);
    }
  }
  if (!phases.size) return new Map();
  const ledgers: Record<string, DeclineLedgerLine[]> = {};
  for (const p of phases) ledgers[p] = loadHeadlessLedger(projectRoot, feature, p)?.entries ?? [];
  return resolveRepairDeclineState({
    runs,
    ledgers,
    requirementText: collectCurrentRequirementText(projectRoot, feature, featuresDir, runId),
  });
}

// ---------------------------------------------------------------------------
// 证据链验真器产出的候选合并（testing actionable defects——收编统一路由）
// ---------------------------------------------------------------------------

/**
 * 把 testing 侧证据链验真器（collectActionableDefects：截图/build 身份/时间窗三重绑定）
 * 的产物转成候选形态。**验真器保留、路由统一**（codex review 冻结项⑦）：
 * item_fingerprint = sha256(验真器结构化锚指纹)——保留「文案微调不改指纹」的抗噪语义，
 * 同时满足候选契约的 64-hex 形状；category 恒 coding（真机缺陷要改产品源码）。
 */
export function actionableDefectsToCandidates(
  defects: ReadonlyArray<{
    source: string;
    screen_or_case_id: string;
    instructions: string[];
    fingerprint: string;
    evidence_path: string;
    /** adjudicated-repair-loop：仅结构化视觉信号进 signal@1；缺省=legacy */
    signal_identity?: boolean;
  }>,
  sourcePhase: string,
): RepairCandidate[] {
  return defects.map((d) => ({
    id: `${d.source}:${d.screen_or_case_id}`,
    category: 'coding' as const,
    files: normalizeFiles(d.evidence_path ? [d.evidence_path] : []),
    summary: normalizeSummary(d.instructions.join('；')),
    // M1（plan e2b7c4a9）：信号级身份——collectActionableDefects 已把 fingerprint 存为
    // 单条 computeDefectFingerprint(screen, defect)；这里 sha256 成 64-hex identity。
    item_fingerprint: sha256Hex(d.fingerprint),
    source_phase: sourcePhase,
    // review 修复：仅结构化视觉信号（signal_identity=true）标 signal@1；crash /
    // device_test / 纯文本 must_fix 兜底保持 legacy（不入累计收敛、不需 defect-review）。
    ...(d.signal_identity === true ? { identity_schema: 'signal@1' as const } : {}),
  }));
}

/**
 * 把候选合并回 phase summary（唯一真源）——runner 侧证据验真器产出的候选据此进入
 * assess 的统一裁决面，manual/batch 读同一份事实。按 item_fingerprint 去重，原子写；
 * 返回合并后的完整候选集。写失败抛出（调用方 fail-closed：候选丢失＝回退链断）。
 */
export function mergeRepairCandidatesIntoSummary(input: {
  summaryPath: string;
  candidates: readonly RepairCandidate[];
}): RepairCandidate[] {
  const raw = fs.readFileSync(input.summaryPath, 'utf-8');
  const summary = JSON.parse(raw) as { repair_candidates?: RepairCandidate[] };
  const merged = [...(summary.repair_candidates ?? [])];
  const seen = new Set(merged.map((c) => c.item_fingerprint));
  for (const c of input.candidates) {
    if (seen.has(c.item_fingerprint)) continue;
    seen.add(c.item_fingerprint);
    merged.push(c);
  }
  if (merged.length === (summary.repair_candidates?.length ?? 0)) return merged;
  const shapeErrors = validateRepairCandidatesShape(merged);
  if (shapeErrors.length > 0) {
    throw new Error(`[repair-candidates] 合并后形状违约：${shapeErrors.join('；')}`);
  }
  summary.repair_candidates = merged;
  const tmp = `${input.summaryPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(summary, null, 2), 'utf-8');
  fs.renameSync(tmp, input.summaryPath);
  return merged;
}

// ---------------------------------------------------------------------------
// 失效面推导（goal 观测组装消费；manual/batch 同语义可复用）
// ---------------------------------------------------------------------------

/**
 * 失效面 = testing 缺陷特例（coding 目标，既有语义）∪ repair candidates 的
 * **最上游**映射目标及其下游全部（级联失效覆盖 mixed-owner 的下游责任阶段）。
 * 目标映射不到链内（mapCategoryToChainPhase=null）不参与——全部失败返回空，
 * driver 据此判目标缺席（backtrack_target_absent），不静默回链首。
 */
export function resolveInvalidatablePhases(input: {
  chain: readonly string[];
  /** testing 缺陷特例在场（既有 collectActionableDefects 供给；t4 收编后并入候选） */
  hasActionable: boolean;
  candidateCategories: readonly RepairOwnerCategory[];
  track: 'full' | 'lite';
}): string[] {
  const targetIdx: number[] = [];
  if (input.hasActionable) {
    const i = input.chain.indexOf('coding');
    if (i >= 0) targetIdx.push(i);
  }
  for (const category of new Set(input.candidateCategories)) {
    const p = mapCategoryToChainPhase(category, input.chain, input.track);
    if (p !== null) {
      const i = input.chain.indexOf(p);
      if (i >= 0) targetIdx.push(i);
    }
  }
  if (targetIdx.length === 0) return [];
  return [...input.chain.slice(Math.min(...targetIdx))];
}

// ---------------------------------------------------------------------------
// summary 字段形状校验（validateSummaryV11 消费；可选字段——缺失合法）
// ---------------------------------------------------------------------------

const OWNER_CATEGORIES: ReadonlySet<string> = new Set(['spec', 'plan', 'coding']);

function evidencePathValid(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !/^[\\/]|^[A-Za-z]:|\\|\0/.test(value)
    && !value.split('/').includes('..');
}

function validateRepairEvidenceRef(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['证据引用非对象'];
  const ref = value as Record<string, unknown>;
  const errors: string[] = [];
  if (Object.keys(ref).some(key => !['trace_path', 'case_id', 'step_index', 'derived_plan_path', 'artifact_paths'].includes(key))) errors.push('证据引用含未知字段');
  if (!evidencePathValid(ref.trace_path)) errors.push('trace_path 须为工程相对路径');
  if (typeof ref.case_id !== 'string' || !ref.case_id.trim()) errors.push('case_id 缺失/空');
  if (!Number.isInteger(ref.step_index) || Number(ref.step_index) < 0) errors.push('step_index 非非负整数');
  if (ref.derived_plan_path !== undefined && !evidencePathValid(ref.derived_plan_path)) errors.push('derived_plan_path 须为工程相对路径');
  if (ref.artifact_paths !== undefined && (!Array.isArray(ref.artifact_paths) || !ref.artifact_paths.every(evidencePathValid))) errors.push('artifact_paths 须为工程相对路径数组');
  return errors;
}

/** executor prompt 的证据段；修复目标仍只来自 candidate.files。 */
export function formatRepairEvidenceRefs(candidate: Pick<RepairCandidate, 'evidence_refs' | 'files'>): string[] {
  const refs = Array.isArray(candidate.evidence_refs)
    ? candidate.evidence_refs.filter(ref => validateRepairEvidenceRef(ref).length === 0) : [];
  if (refs.length === 0) return [];
  return [
    ...refs.map(ref => `  只读证据：${ref.trace_path} → case=${ref.case_id} step=${ref.step_index}`
      + (ref.derived_plan_path ? `；派生计划=${ref.derived_plan_path}` : '')
      + (ref.artifact_paths?.length ? `；失败边界=${ref.artifact_paths.join('、')}` : '')),
    '  读取原 StepResult 的 selector request/resolution、outcome 与 diagnostic；证据路径不是修复目标或范围授权。',
    ...(candidate.files.length === 0 ? ['  产品源码尚未机器定位；在当前已授权范围内调查，不能把 trace/截图当作源码修改。'] : []),
  ];
}

export function validateRepairCandidatesShape(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return ['repair_candidates 非数组'];
  const errors: string[] = [];
  value.forEach((c, i) => {
    if (!c || typeof c !== 'object') { errors.push(`repair_candidates[${i}] 非对象`); return; }
    const r = c as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`repair_candidates[${i}].id 缺失/空`);
    if (typeof r.category !== 'string' || !OWNER_CATEGORIES.has(r.category)) {
      errors.push(`repair_candidates[${i}].category 非法（${String(r.category)}）`);
    }
    if (!Array.isArray(r.files)) errors.push(`repair_candidates[${i}].files 非数组`);
    if (r.evidence_refs !== undefined) {
      if (!Array.isArray(r.evidence_refs)) errors.push(`repair_candidates[${i}].evidence_refs 非数组`);
      else r.evidence_refs.forEach((ref, index) => errors.push(...validateRepairEvidenceRef(ref)
        .map(error => `repair_candidates[${i}].evidence_refs[${index}] ${error}`)));
    }
    if (typeof r.item_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(r.item_fingerprint)) {
      errors.push(`repair_candidates[${i}].item_fingerprint 非 sha256`);
    }
    // M1（plan e2b7c4a9 t1.2）：identity_schema 可选；存在时仅接受 'signal@1'（信号级）。
    if (r.identity_schema !== undefined && r.identity_schema !== null && r.identity_schema !== 'signal@1') {
      errors.push(`repair_candidates[${i}].identity_schema 非法（${String(r.identity_schema)}；仅允许 signal@1 或缺失）`);
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// D0.3 — 已归属的 spec / plan 候选 → 同 run 范围修订输入
// ---------------------------------------------------------------------------
// 单向数据流：**输入 = 既有归属层产出的候选，输出 = 设计事实**。这里不新增 check id、
// 不动 CHECK_ID_OWNER_REGISTRY、不判断意图——机器分不出「获准目标确有设计缺口」与
// 「coding 改错了文件」，那一步由 plan 的独立裁决兜底（D0.3 原文：修订提议不预设结论）。
// 触发条件只有一条：候选 category ∈ {spec, plan} 且 source_phase ∈ {coding, review}。

/** 允许产出修订输入的来源阶段（写集越界类未注册归属，结构上到不了这里）。 */
const SCOPE_REVISION_SOURCE_PHASES: ReadonlySet<string> = new Set(['coding', 'review']);

/** 候选类别 → 它要求的设计事实种类（review 归因 spec 时是验收定义）。 */
const SCOPE_REVISION_FACT_KIND: Readonly<Record<'spec' | 'plan', string>> = Object.freeze({
  plan: 'design-decision',
  spec: 'acceptance-definition',
});

export interface ScopeRevisionInputContext {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  /** 缺省取 MAISON_GOAL_RUN_ID；无 run（交互路径）时由统一入口读 feature 冻结记录。 */
  runId?: string;
}

/**
 * 由已归属候选生成一条范围修订输入；无合格候选、无有效范围或无可核验绑定时返回 null。
 *
 * 幂等：提议里的设计事实按 id（`<kind>:<candidate.id>`）去重，全部已在有效范围内 → 返回 null，
 * 重跑同一阶段不会反复产出同一条提议。
 */
export function scopeRevisionInputFromRepairCandidates(
  candidates: readonly RepairCandidate[],
  ctx: ScopeRevisionInputContext,
): { input: ExecutionScopeInput; candidateIds: string[] } | null {
  const owned = candidates.filter(candidate =>
    (candidate.category === 'spec' || candidate.category === 'plan')
    && SCOPE_REVISION_SOURCE_PHASES.has(candidate.source_phase)
    && candidate.files.length > 0);
  if (!owned.length) return null;
  const runId = ctx.runId ?? process.env.MAISON_GOAL_RUN_ID?.trim();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { loadEffectiveExecutionScope } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const { OBLIGATION_PROVIDERS } = require('./execution-scope') as typeof import('./execution-scope');
  const { resolveCapabilityInputs } = require('./capability-resolution') as typeof import('./capability-resolution');
  /* eslint-enable @typescript-eslint/no-require-imports */
  // 第五轮必修 1：无 run 时**不能**直接返回 null——那样 D0.3 的修订触发在交互路径上整条失效
  //（无 run 出口读到的提案永远是空）。统一入口自己按载体选来源：有 run 读 run 的有效范围，
  // 无 run 读 feature 冻结记录；两者皆无才不产提议。不新增第二套校验。
  const scope = loadEffectiveExecutionScope(ctx.projectRoot, ctx.feature, runId);
  if (!scope) return null;
  // 责任阶段取自**本 run 的有效范围**：同一 provider 家族里已有义务的 owner_phase 就是这一轮
  // 解析出来的责任映射。不重读当前 active workflow——workflow 漂移时那会选错阶段甚至选不到；
  // 范围里证明不了责任阶段就不产提议（fail-closed），不猜。
  const ownerPhase = (kind: string): string | undefined => {
    const family = Object.values(OBLIGATION_PROVIDERS).find(kinds => kinds.includes(kind)) ?? [];
    return scope.obligations.find(obligation => family.includes(obligation.kind))?.owner_phase;
  };

  const facts = scope.obligations.map(obligation => structuredClone(obligation) as ExecutionScopeInput['facts'][number]);
  const responsible: string[] = [];
  const candidateIds: string[] = [];
  for (const candidate of owned) {
    const kind = SCOPE_REVISION_FACT_KIND[candidate.category as 'spec' | 'plan'];
    const phase = ownerPhase(kind);
    if (!phase) continue;
    const id = `${kind}:${candidate.id}`;
    if (facts.some(fact => fact.id === id)) continue;
    // 触发文件绑定走生产解析器，指纹与 §4.1.0 的核验同源（不自行拼 InputBinding）。
    const resolved = resolveCapabilityInputs({
      projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, feature: ctx.feature, phase, track: 'full',
      testTargets: [...candidate.files],
      inputContext: { schema_version: '1.1', subject: { feature: ctx.feature }, obligations: {}, required_outputs: [] },
    }).inputs?.values?.codebase;
    if (!resolved || resolved.state !== 'resolved') continue;
    facts.push({
      id, kind, applicability: 'required',
      // 语义是「这项发现需要责任阶段裁决」，不是「机器已证明该扩展合理」——
      // OpenSpec 的 scenario 要求 reason 本身说清这一点，不能只转述候选摘要。
      reason: `需要 ${phase} 裁决：${candidate.summary}`,
      basis: [resolved.binding],
    });
    responsible.push(phase);
    candidateIds.push(candidate.id);
  }
  if (!candidateIds.length) return null;
  const remaining = scope.obligations
    .filter(obligation => obligation.applicability === 'required' && !obligation.satisfied_by?.length)
    .map(obligation => String(obligation.owner_phase));
  return {
    input: {
      request: {
        completion_target: scope.completion_target,
        requested_results: [...scope.requested_results],
        requested_phases: [...new Set([...responsible, ...remaining])],
        ...(scope.request_impact ? { impact: structuredClone(scope.request_impact) } : {}),
      },
      facts,
      contract_fingerprints: [],
      ...(scope.control_edges ? { control_edges: structuredClone(scope.control_edges) } : {}),
    },
    candidateIds,
  };
}

/**
 * 把修订输入回写进**磁盘** script-report.json —— runtime 只从那里读
 * （`goal-phase-runtime.ts` 的 `checks[].scope_revision_input`），内存 CheckResult 到不了消费方。
 *
 * 载体 check 取**产出该候选的那条 check**：机器归属候选的 id 是注册表键（如 `ui_scope_violation`），
 * 而产出它的 check id 是 `ui_diff_within_declared_files`，所以同时按 id 与 failure_kind 匹配；
 * 都匹配不上才退到首条（它只决定事件里的 `trigger.check_id`）。
 *
 * **失败即抛**：回写不成 = 载体不可确认 = runtime 看不到修订输入。调用方据此 fail-closed
 * （writer 让本次 summary 写入失败、finalizer 让闭环停在 open），不得静默吞掉。
 * 返回值区分 `written` 与 `unchanged`（内容已相同，字节不动）。
 */
export function writeScopeRevisionInputToScriptReport(
  scriptReportPath: string,
  input: ExecutionScopeInput,
  candidateIds: readonly string[],
): 'written' | 'unchanged' {
  if (!fs.existsSync(scriptReportPath)) throw new Error(`[scope-revision] script-report 不存在，修订输入无处落盘：${scriptReportPath}`);
  let report: { checks?: Array<Record<string, unknown>> };
  try {
    report = JSON.parse(fs.readFileSync(scriptReportPath, 'utf8')) as { checks?: Array<Record<string, unknown>> };
  } catch (error) {
    throw new Error(`[scope-revision] script-report 不可解析，修订输入无处落盘：${scriptReportPath}（${(error as Error).message}）`);
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  if (!checks.length) throw new Error(`[scope-revision] script-report 无 checks，修订输入无处挂载：${scriptReportPath}`);
  const carrier = checks.find(check => candidateIds.includes(String(check.id)) || candidateIds.includes(String(check.failure_kind))) ?? checks[0];
  if (JSON.stringify(carrier.scope_revision_input) === JSON.stringify(input)) return 'unchanged';
  for (const check of checks) if (check !== carrier) delete check.scope_revision_input;
  carrier.scope_revision_input = input;
  fs.writeFileSync(scriptReportPath, JSON.stringify(report, null, 2), 'utf-8');
  return 'written';
}
