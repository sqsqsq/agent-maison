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

/** 可产回退候选的责任类别（verification 无回退语义） */
export type RepairOwnerCategory = Exclude<CorrectionCategory, 'verification'>;

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

// ---------------------------------------------------------------------------
// testing 侧 defect-review fenced 块（adjudicated-repair-loop M2 · plan e2b7c4a9 t2.2）
// ---------------------------------------------------------------------------
// 契约：testing 报告（test-report.md）可附带逐信号复核块——**裁决发生在候选物化之前**：
// ```defect-review
// - signal: 添加银行卡标题
//   verdict: confirmed     # confirmed（同向）| disputed（反对，须理由）
//   rationale: 截图/证据核对后确认为真缺陷
// ```
//  · 无块/块内无该信号条目 = unreviewed（fail-closed：actionable 未复核 → 停等）；
//  · verdict=disputed → 停等（原样呈理由），无自动 refuted；
//  · verdict=confirmed → 与 producer actionable 同向 → 物化为常规候选（signal@1）可回退。
// ---------------------------------------------------------------------------

export const DEFECT_REVIEW_FENCE = 'defect-review';

export interface DefectReviewEntry {
  /** 信号引用（producer 给出的信号身份/文本锚，与 uncertain_signals 的 target 呼应） */
  signal: string;
  verdict: 'confirmed' | 'disputed';
  rationale?: string;
}

const DEFECT_REVIEW_FENCE_RE = new RegExp(
  '```' + DEFECT_REVIEW_FENCE + '\\s*\\r?\\n([\\s\\S]*?)```',
  'i',
);

/**
 * 从 testing 报告解析 defect-review 块。无块/空块 → ok:false（unreviewed，fail-closed）。
 * verdict 非法值按 disputed 处理（不明确不产候选，停等）。
 */
export function parseDefectReviewBlock(text: string): {
  ok: boolean;
  entries: DefectReviewEntry[];
  reason: string;
} {
  if (!text || !text.trim()) return { ok: false, entries: [], reason: 'testing 报告为空' };
  const m = DEFECT_REVIEW_FENCE_RE.exec(text);
  if (!m) return { ok: false, entries: [], reason: `缺 ${DEFECT_REVIEW_FENCE} fenced 块` };
  const entries: DefectReviewEntry[] = [];
  const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const signalMatch = /^\s*-\s*signal:\s*(.+?)\s*$/.exec(lines[i]);
    if (!signalMatch) { i++; continue; }
    i++;
    const verdictMatch = i < lines.length ? /^\s*verdict:\s*(\S+)\s*$/.exec(lines[i]) : null;
    if (!verdictMatch) continue;
    const raw = verdictMatch[1].toLowerCase();
    i++;
    let rationale: string | undefined;
    if (i < lines.length) {
      const raMatch = /^\s*rationale:\s*(.+?)\s*$/.exec(lines[i]);
      if (raMatch) {
        rationale = raMatch[1].trim();
        i++;
      }
    }
    entries.push({
      signal: signalMatch[1].trim(),
      verdict: raw === 'confirmed' ? 'confirmed' : 'disputed',
      ...(rationale ? { rationale } : {}),
    });
  }
  if (entries.length === 0) return { ok: false, entries: [], reason: 'defect-review 块无合法条目' };
  return { ok: true, entries, reason: `${entries.length} 条逐信号复核` };
}

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
    files: (row[iFiles] ?? '')
      .split(/[,，;；\s]+/)
      .map(f => f.replace(/`/g, '').trim())
      .filter(f => f.length > 0 && f !== '-'),
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
  const confirmed = new Map(
    verification.entries.filter(e => e.verdict === 'confirmed').map(e => [e.issue, e]),
  );
  const out: RepairCandidate[] = [];
  for (const row of parseIssueRows(input.reportText)) {
    if (row.severity !== 'BLOCKER' && row.severity !== 'MAJOR') continue;
    if (/已关闭|已修复|closed|fixed/i.test(row.state)) continue;
    const verified = confirmed.get(row.id); // 未验证/refuted/unclear 一律留在 review
    if (!verified) continue;
    // 证据新鲜度（codex 冻结项⑥）：验证条目须绑定**当前**该 CR 的内容——同 ID 复用但
    // 内容已变（上一轮 verifier 产物残留）时不采信，留在 review 重新验证。
    if (!isVerificationEvidenceCurrent(verified.evidence, row)) continue;
    const category = deriveCategoryFromFiles(row.files);
    if (category === null) continue; // 归属推导不出——宁缺毋滥
    const files = normalizeFiles(row.files);
    out.push({
      id: row.id,
      category,
      files,
      summary: row.summary,
      item_fingerprint: itemFingerprintOf(row.id, files, row.summary),
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

/** 机器 check id 归属的候选（check FAIL 时由所在阶段的组装层调用；
 *  信任条件=该 check 自身的判定，不再叠加 verifier）。未注册 id → null。 */
export function checkOwnedCandidate(input: CheckOwnedCandidateInput): RepairCandidate | null {
  const category = CHECK_ID_OWNER_REGISTRY[input.checkId];
  if (!category) return null;
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
// verifier 报告 check 状态宽松解析（ut 侧 device_ac_delegation 消费——verifier YAML
// 形态：`- id: <check>` 后随 `status: PASS|FAIL|WARN`）
// ---------------------------------------------------------------------------

export function parseVerifierCheckStatus(
  text: string,
  checkId: string,
): 'PASS' | 'FAIL' | 'WARN' | null {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^\\s*-\\s*id:\\s*${checkId}\\s*$`).test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const m = /^\s*status:\s*(PASS|FAIL|WARN)\b/.exec(lines[j]);
      if (m) return m[1] as 'PASS' | 'FAIL' | 'WARN';
      if (/^\s*-\s*id:/.test(lines[j])) break;
    }
    return null;
  }
  return null;
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
      c => c.status === 'FAIL' && c.severity === 'BLOCKER' && c.id !== 'ut_hvigor_test',
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
    for (const failure of input.checks.filter(
      c => c.status === 'FAIL' && (
        (c.failure_kind === 'assertion' &&
          c.failure_code === 'assertion_mismatch' &&
          c.coding_candidate === true) ||
        (c.coding_candidate === true && c.repair_owner === 'coding') ||
        c.repair_owner === 'spec' ||
        c.repair_owner === 'plan'
      ),
    )) {
      const files = normalizeFiles(failure.affected_files ?? []);
      const summary = normalizeSummary(
        failure.details ?? '已执行 StepResult assertion_mismatch——默认回 coding/product 修复',
      );
      const category = failure.repair_owner === 'spec' || failure.repair_owner === 'plan'
        ? failure.repair_owner
        : 'coding';
      out.push({
        id: failure.id,
        category,
        files,
        summary,
        item_fingerprint: itemFingerprintOf(failure.id, files, summary),
        source_phase: 'testing',
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
    })),
  });
}

/**
 * 回退交接上下文的事件回放恢复**唯一实现**（goal-runner resume 与测试共用）：
 * 每条 `phase_backtrack_requested` 都**无条件覆盖**——非 repair 回退（无 candidates）
 * 自动清空，旧候选不泄漏到后续 prompt（codex 冻结项④）。
 */
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
