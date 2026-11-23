// ============================================================================
// verifier-evidence.ts — verifier 机器证据的**唯一**解析边界
// ============================================================================
// plan d2f7a9c4：真源从 hook 发布的 canonical JSON 改回 **调用方写出的 MD**。
//
// ─── 为什么反转 e5b8c3f7 的「MD 不解析」───────────────────────────────────────
// 那条边界（连同四方对账、conflict 状态机、结论指纹重算、16 种 bedside 分类）服务的是
// 一个目标：主 agent 不能伪造 PASS。用户 2026-09-03 已裁定防篡改不是优先级。代价是它把
// 「发布手续失败」判成「检查根本不存在」——宿主 bc-openCard-1 两轮无人值守 run，harness
// PASS、verifier 真跑且 PASS，只因 hook 在 MAISON_GOAL_HEADLESS=1 下一律落 bedside 而
// 熔断；codex 等无 SubagentStop 的 adapter 则被判 blocked、full track 事实不可用。
//
// ─── 现在只保留三样真正影响正确性的事实 ──────────────────────────────────────
//   1. 审的是哪份材料 → subject（材料变则 subject 变，verifier-request.ts 派生）
//   2. 结论是什么     → verdict + blocker_count（终态块，parseResultBlock 解析）
//   3. 属于哪个阶段   → 报告所在的 reports 目录
// 校验三条：文件在、终态块回显的 subject 等于当前 subject、verdict 与 blocker_count 一致。
// 任一不成立的**唯一**恢复动作是重跑 verifier 并重写报告——绝不指向"改文书"。
//
// ─── 单写者 ─────────────────────────────────────────────────────────────────
// 独立核验执行者只写本调用结果。运行时验收后按 subject 发布完整原答；旧版报告仍走兼容读取。
//
// ─── 放弃的准确性（plan d2f7a9c4 一、放弃项）─────────────────────────────────
// 报告可被伪造或事后修改而不被机器识别；同 subject 并发不再报 conflict。兜底靠下游阶段
// 门禁与人。**因此**报告也不得进 evidence manifest、不得进 closure attestation 哈希：
// 一份刻意不做防篡改的文件，不能同时充当"改一下就 stale"的绊线。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { featureFilePath, featurePhaseReportsDir } from '../../config';
import type { AcceptanceSpec, VerifierClosureRecord } from './types';
import { readVerifierMaterialOrNull, verifierMaterialsEquivalent, type VerifierMaterialView } from './verifier-material';
import { parseResultBlock, SUBJECT_ID_PATTERN, verifierReportMdFilename } from './verifier-subject';
import type { ResolvedPhaseInputs } from './capability-resolution';
import { computePromptSha256, parseVerifierRequest, verifierRequestFilename } from './verifier-request';
import { realProjectPath } from './project-relative-path';
import { isUnitUtLayer } from './acceptance-layering';
import { isBlockingCheck } from './check-disposition';

export function verifierReportMdPath(reportsDir: string, subjectId: string): string {
  return path.join(reportsDir, verifierReportMdFilename(subjectId));
}

export type VerifierEvidenceErrorCode =
  /** summary 没有 verifier_subject_id：本轮没有生成调用凭证（能力未启用，或 request 生成失败） */
  | 'subject_absent'
  /** 报告文件不存在——verifier 未跑，或跑了但调用方没把回复写下来 */
  | 'report_missing'
  | 'report_unaccepted'
  /** 终态块缺失 / 多于一个 / 字段非法 */
  | 'block_unparseable'
  /** 终态块回显的 subject 不是当前 subject（迟到、错位，或被手改） */
  | 'subject_mismatch'
  /** verdict 与 BLOCKER 计数自相矛盾 */
  | 'verdict_inconsistent';

export interface VerifierEvidence {
  feature: string;
  phase: string;
  subject_id: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
  /** verifier 结论全文（机器消费者要正文时只从这里取） */
  report_text: string;
  md_path_abs: string;
  md_path_rel: string;
}

export type LoadVerifierEvidenceResult =
  | { ok: true; evidence: VerifierEvidence }
  | { ok: false; code: VerifierEvidenceErrorCode; message: string };

export interface LoadVerifierEvidenceOptions {
  frameworkRoot?: string;
  resolvedInputs?: ResolvedPhaseInputs;
}

interface VerifierItemReviewInput extends LoadVerifierEvidenceOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  runId?: string;
  currentSubject?: string;
  diagnosisRequired?: boolean;
  unitEvidenceRequired?: boolean;
  verifierSubjectCurrent?: boolean;
  templateText?: string;
  phaseIssues?: import('./repair-candidates').PhaseRepairIssues | null;
  /** Current, still unresolved findings handed to this independent reviewer. */
  findings?: readonly { id: string; files?: readonly string[] }[];
}

function verifierItemQuestions(input: VerifierItemReviewInput, applicableIds: readonly string[], report: VerifierEvidence | null): {
  requiredIds: string[]; recheckIds: string[]; recheckFindings: NonNullable<VerifierItemReviewInput['findings']>; diagnostics: string[];
} {
  const repairs = require('./repair-candidates') as typeof import('./repair-candidates');
  const { projectRoot, feature, phase, frameworkRoot, runId } = input;
  const text = report?.report_text ?? '';
  const design = phase === 'spec' || phase === 'plan';
  const issues = design && report
    ? repairs.readVerifierSemanticIssues(projectRoot, feature, phase, text, report.md_path_rel, frameworkRoot, runId)
    : input.phaseIssues === undefined && (input.diagnosisRequired || input.findings?.length)
      ? repairs.readPhaseRepairIssues(projectRoot, feature, phase, { frameworkRoot, runId, subjectId: input.currentSubject ?? null }) : input.phaseIssues;
  const requiresDiagnosis = design || input.diagnosisRequired;
  const diagnosisContext = (requiresDiagnosis || input.findings?.length) && report
    ? repairs.buildCurrentVerifierDiagnosisContext({ ...input, subjectId: input.currentSubject ?? null, phaseIssues: issues }) : undefined;
  const diagnostics = requiresDiagnosis && report ? repairs.findUnreadableDiagnosisChecks(phase, text, diagnosisContext) : [];
  const acceptanceInput = input.resolvedInputs?.values.acceptance;
  const acceptance = acceptanceInput?.state === 'resolved' ? acceptanceInput.value as AcceptanceSpec : undefined;
  const unitCriteria = [...acceptance?.criteria ?? [], ...acceptance?.boundaries ?? [], ...acceptance?.performance ?? []];
  const requiredUnitEvidence = phase === 'ut' && (input.unitEvidenceRequired
    || input.resolvedInputs?.context.obligations['unit-evidence'] === 'required' && unitCriteria.some(item => isUnitUtLayer(item.ut_layer)));
  const unitIds = ['end_to_end_driving', 'business_assertion_value'];
  const explicit = repairs.verifierSemanticChecks(text, phase, feature).flatMap(row => typeof row.id === 'string'
    && Array.isArray(row.acceptance_ids) && row.acceptance_ids.length && Array.isArray(row.affected_files) && row.affected_files.length ? [row.id] : []);
  const diagnosedIds = diagnostics.flatMap(detail => {
    const id = detail.split('：', 1)[0];
    if (applicableIds.includes(id)) return [id];
    if (phase === 'review' && issues?.rows.length) return ['issue_accuracy'];
    if (design && issues?.rows.length) return issues.rows.map(row => row.id);
    if (phase === 'ut' && (input.diagnosisRequired || requiredUnitEvidence)) return unitIds;
    return [];
  });
  const answered = text && input.findings?.length ? repairs.parseIssueVerificationBlock(text).entries : [];
  const findings = (input.findings ?? []).filter(({ id }) => applicableIds.includes(id) || issues?.rows.some(row => row.id === id)
    || answered.some(entry => entry.issue === id));
  const findingIds = findings.map(finding => finding.id);
  const missingDecisions = findings.flatMap(finding => {
    const row = issues?.rows.find(item => item.id === finding.id);
    const reason = row ? repairs.reviewIssueDiagnosis(row, answered, diagnosisContext ?? {})
      : !repairs.uniqueIssueVerification(answered, finding.id) ? `${finding.id}：缺本轮逐条结论` : null;
    return reason ? [{ finding, reason }] : [];
  });
  const required = new Set([...explicit, ...findingIds, ...(design ? issues?.rows.map(row => row.id) ?? [] : []),
    ...(phase === 'ut' && (input.diagnosisRequired || requiredUnitEvidence) ? unitIds : [])]);
  return { requiredIds: applicableIds.filter(id => required.has(id)), recheckIds: [...new Set(diagnosedIds)],
    recheckFindings: missingDecisions.map(item => item.finding), diagnostics: [...diagnostics, ...missingDecisions.map(item => item.reason)] };
}

/** Plan a request from public originals and the currently bound material, before it is dispatched. */
export function planVerifierItemReview(input: VerifierItemReviewInput & { currentMaterial: VerifierMaterialView; templateText: string }) {
  const { selectVerifierItemScope, verifierTemplateCheckIds, readVerifierUtSourcePaths } = require('./verifier-item-scope') as typeof import('./verifier-item-scope');
  const { projectRoot, feature, phase, currentMaterial } = input;
  const exact = input.currentSubject ? loadVerifierEvidenceForSubject(projectRoot, feature, phase, input.currentSubject, input) : null;
  const issued = exact?.ok ? readIssuedVerifierItemScope(input, exact.evidence) : null;
  const repairs = require('./repair-candidates') as typeof import('./repair-candidates');
  const rows = exact?.ok && issued ? repairs.readVerifierSummaryRows(exact.evidence.report_text) ?? [] : [];
  const missingCarried = exact?.ok && issued && (issued.reusedRows.some(expected => !sameVerifierSummaryRow(expected, rows.find(row => row.id === expected.id)))
    || carriedVerifierDetails(input, exact.evidence, issued.reusedRows).missing.length > 0);
  const same = exact?.ok && !missingCarried ? exact.evidence
    : findPriorVerifierEvidence(projectRoot, feature, phase, { ...input, excludeSubject: input.currentSubject, material: currentMaterial });
  const previousReport = same ?? findPriorVerifierEvidence(projectRoot, feature, phase, { ...input, excludeSubject: input.currentSubject });
  const dir = resolveReportsDir(projectRoot, feature, phase, input.frameworkRoot);
  const previousMaterial = same ? currentMaterial : previousReport && readVerifierMaterialOrNull(dir, previousReport.subject_id);
  const applicableIds = verifierTemplateCheckIds(input.templateText);
  const previousText = previousReport ? verdictReportTextWithOriginals({ ...input, currentSubject: previousReport.subject_id }, previousReport) : null;
  const questions = verifierItemQuestions(input, applicableIds, previousReport && previousText !== null ? { ...previousReport, report_text: previousText } : null);
  if (issued && !missingCarried) questions.requiredIds = [...new Set([...questions.requiredIds, ...issued.reviewIds])];
  return { previousReport, scope: selectVerifierItemScope({ previousMaterial, currentMaterial,
    previousReportText: previousText, applicableIds, ...questions,
    ...(phase === 'ut' && previousMaterial && previousReport ? { utSourcePaths: readVerifierUtSourcePaths({ ...input,
      frameworkRoot: input.frameworkRoot ?? path.resolve(__dirname, '../../..'),
      material: previousMaterial, reportText: previousReport.report_text }) } : {}) }) };
}

/** An existing transport-level verdict can still owe a specific current semantic answer. */
export function verifierDiagnosisRequired(phase: string, summary?: {
  next_action?: unknown; readiness_signals?: unknown;
} | null): boolean {
  if (phase === 'spec' || phase === 'plan' || summary?.next_action === 'run_verifier_for_repair') return true;
  return Array.isArray(summary?.readiness_signals) && summary.readiness_signals.some(signal =>
    signal?.id === 'verifier_repair_diagnosis' && signal.status === 'incomplete');
}

export function verifierReportItemGaps(input: VerifierItemReviewInput, evidence: VerifierEvidence): string[] {
  const { readVerifierSummaryRows } = require('./repair-candidates') as typeof import('./repair-candidates');
  const { verifierTemplateCheckIds } = require('./verifier-item-scope') as typeof import('./verifier-item-scope');
  const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
  const { loadResolvedProfile } = require('../../profile-loader') as typeof import('../../profile-loader');
  const { resolveWorkflowSpec } = require('../../workflow-loader') as typeof import('../../workflow-loader');
  const { workflowVerifierPrompt } = require('./verifier-plan') as typeof import('./verifier-plan');
  const { loadVerifierPromptTemplate } = require('./report-generator') as typeof import('./report-generator');
  const frameworkRoot = input.frameworkRoot ?? path.resolve(__dirname, '../../..');
  const template = input.templateText === undefined ? workflowVerifierPrompt(resolveWorkflowSpec(input.projectRoot, { frameworkRoot }), input.phase) : null;
  const profile = template ? loadResolvedProfile(input.projectRoot, loadFrameworkConfig(input.projectRoot), frameworkRoot) : undefined;
  const templateText = input.templateText ?? (template
    ? loadVerifierPromptTemplate(path.join(frameworkRoot, 'harness'), input.phase, profile, template) : '');
  const applicableIds = verifierTemplateCheckIds(templateText);
  const scope = readIssuedVerifierItemScope(input, evidence);
  const carried = carriedVerifierDetails(input, evidence, scope?.reusedRows);
  const reified = { ...evidence, report_text: withCarriedVerifierDetails(input, evidence, carried) };
  const { diagnostics, requiredIds } = verifierItemQuestions(input, applicableIds, reified);
  if (!requiredIds.length && !scope) return diagnostics;
  const rows = new Map((readVerifierSummaryRows(evidence.report_text) ?? []).map(row => [row.id, row]));
  const missing = [...requiredIds, ...scope?.reviewIds ?? []].filter(id => !rows.get(id)?.evidence.trim());
  const drift = scope?.reusedRows.flatMap(row => {
    const actual = rows.get(row.id);
    return sameVerifierSummaryRow(row, actual) ? [] : [`${row.id}：须保留已核实的原结论和依据`];
  }) ?? [];
  // The terminal blocker count describes the report before workspace disposition rules are applied.
  if (scope && rows.size && [...rows.values()].filter(({ id, status, severity }) =>
    isBlockingCheck({ id, status, severity }, [])).length !== evidence.blocker_count) {
    drift.push('终态 blocker_count 未包含当前及沿用的 BLOCKER FAIL');
  }
  return [...new Set([...diagnostics, ...missing, ...drift, ...carried.missing])];
}

function verifierOriginalRunDirs(projectRoot: string, feature: string, phase: string, reportsDir: string, subject: string, runId?: string): string[] {
  const { standaloneVerifierRunDir } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
  const runsDir = featureFilePath(projectRoot, feature, 'goal-runs');
  let siblings: fs.Dirent[] = [];
  try { siblings = fs.readdirSync(runsDir, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const candidates = [...new Set([...(runId ? [runId] : []), ...siblings.filter(item => item.isDirectory()).map(item => item.name)])];
  const phased = candidates.filter(id => /^[a-zA-Z0-9-]+$/.test(id)).map(id => path.join(runsDir, id))
    .filter(dir => fs.existsSync(path.join(dir, 'phases', phase + '-verifier-format-repair')));
  return [standaloneVerifierRunDir(reportsDir, subject), ...phased];
}

function readIssuedVerifierItemScope(input: VerifierItemReviewInput, evidence: VerifierEvidence) {
  if (input.currentSubject !== evidence.subject_id) return null;
  const { projectRoot, feature, phase, frameworkRoot } = input;
  const reports = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  try {
    const request = parseVerifierRequest(fs.readFileSync(path.join(reports, verifierRequestFilename(evidence.subject_id)), 'utf8'));
    if (!request || request.subject_id !== evidence.subject_id || request.feature !== feature || request.phase !== phase) return null;
    const prompt = fs.readFileSync(realProjectPath(projectRoot, request.prompt_path, 'verifier prompt'), 'utf8');
    if (computePromptSha256(prompt) !== request.prompt_sha256) return null;
    const { readVerifierItemReviewPrompt } = require('./report-generator') as typeof import('./report-generator');
    const { stageVerifierHandbacks } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
    for (const runDir of verifierOriginalRunDirs(projectRoot, feature, phase, reports, evidence.subject_id, input.runId)) {
      for (const handback of stageVerifierHandbacks(runDir, request, evidence.md_path_abs)) {
        if (handback.bytes.toString('utf8') !== evidence.report_text) continue;
        const scoped = handback.instruction ? readVerifierItemReviewPrompt(handback.instruction) : null;
        if (scoped) return scoped;
        break;
      }
    }
    return readVerifierItemReviewPrompt(prompt);
  } catch { return null; }
}

/** The reference to the original adjudication is independent of local Markdown wording. */
export function readVerifierOriginalReference(evidence: string): { report: string; line: number; marker: string } | null {
  const refs = [...evidence.matchAll(/\[原核验\]\(\s*(?:<([^<>\r\n]+)#L([1-9]\d*)>|([^\s<>()]+)#L([1-9]\d*))\s*\)/g)];
  if (refs.length !== 1) return null;
  const [marker, anglePath, angleLine, plainPath, plainLine] = refs[0];
  return { report: anglePath ?? plainPath, line: Number(angleLine ?? plainLine), marker };
}

function sameVerifierSummaryRow(expected: import('./repair-candidates').VerifierSummaryRow,
  actual?: import('./repair-candidates').VerifierSummaryRow): boolean {
  if (!actual || expected.id !== actual.id || expected.status !== actual.status || expected.severity !== actual.severity) return false;
  const original = readVerifierOriginalReference(expected.evidence);
  if (!original) return expected.evidence.replace(/\s+/g, ' ').trim() === actual.evidence.replace(/\s+/g, ' ').trim();
  const referenced = readVerifierOriginalReference(actual.evidence);
  return referenced?.report === original.report && referenced.line === original.line;
}

function carriedVerifierDetails(input: VerifierItemReviewInput, evidence: VerifierEvidence,
  expected?: readonly import('./repair-candidates').VerifierSummaryRow[]) {
  const repairs = require('./repair-candidates') as typeof import('./repair-candidates');
  const { citesIssue } = require('./verifier-item-scope') as typeof import('./verifier-item-scope');
  const { projectRoot, feature, phase, frameworkRoot } = input;
  const details = new Map<string, Record<string, unknown>>();
  const issues = new Map<string, ReturnType<typeof repairs.parseIssueVerificationBlock>['entries'][number]>();
  const missing: string[] = [];
  if (!evidence.report_text.includes('[原核验](')) return { details, issues, missing };
  const rows = repairs.readVerifierSummaryRows(evidence.report_text) ?? [];
  const originals = new Map<string, LoadVerifierEvidenceResult>();
  const reports = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  for (const row of rows) {
    const link = readVerifierOriginalReference(row.evidence);
    const priorId = link && /^verifier\.report\.([0-9a-f]{64})\.md$/.exec(path.posix.basename(link.report))?.[1];
    if (!link || !priorId || priorId === evidence.subject_id) continue;
    const issued = expected?.some(item => sameVerifierSummaryRow(item, row));
    if (expected && !issued) continue;
    if (!originals.has(priorId)) originals.set(priorId, loadVerifierEvidenceForSubject(projectRoot, feature, phase, priorId, { frameworkRoot }));
    const previous = originals.get(priorId)!;
    if (!previous.ok || previous.evidence.md_path_rel !== link.report) {
      if (issued) missing.push(`${row.id}：原独立核验报告不可读`);
      continue;
    }
    const original = previous.evidence.report_text;
    const sourceRow = repairs.readVerifierSummaryRows(original)?.find(item => item.line === link.line && item.id === row.id);
    if (!sourceRow || sourceRow.status !== row.status || sourceRow.severity !== row.severity) {
      if (issued) missing.push(`${row.id}：找不到相同的原核验行`);
      continue;
    }
    if (!issued && !carriedVerifierMaterialApplies(input, reports, priorId, original, evidence.subject_id, rows, row.id)) continue;
    for (const detail of repairs.verifierSemanticChecks(original, phase, feature)) {
      if (detail.id === row.id && detail.status !== 'PASS') details.set(row.id, detail);
    }
    const entries = repairs.parseIssueVerificationBlock(original).entries;
    for (const entry of entries) {
      const referenced = entry.issue === row.id || citesIssue(sourceRow.evidence, entry.issue)
        || phase === 'review' && row.id === 'issue_accuracy' && /^CR-[0-9]+$/.test(entry.issue);
      if (referenced && repairs.uniqueIssueVerification(entries, entry.issue)) issues.set(entry.issue, entry);
    }
  }
  return { details, issues, missing };
}

function carriedVerifierMaterialApplies(input: VerifierItemReviewInput, reports: string, priorId: string, priorText: string,
  reportedSubject: string, rows: readonly import('./repair-candidates').VerifierSummaryRow[], id: string): boolean {
  const old = readVerifierMaterialOrNull(reports, priorId);
  const current = readVerifierMaterialOrNull(reports, input.currentSubject ?? reportedSubject);
  if (!old || !current) return false;
  if (verifierMaterialsEquivalent(old, current, input.projectRoot, input.resolvedInputs)) return true;
  const { selectVerifierItemScope, readVerifierUtSourcePaths } = require('./verifier-item-scope') as typeof import('./verifier-item-scope');
  const utSourcePaths = input.phase === 'ut' ? readVerifierUtSourcePaths({ ...input, material: old, reportText: priorText,
    frameworkRoot: input.frameworkRoot ?? path.resolve(__dirname, '../../..') }) : undefined;
  const scope = selectVerifierItemScope({ previousMaterial: old, currentMaterial: current, previousReportText: priorText,
    applicableIds: rows.map(row => row.id), utSourcePaths });
  return scope.reusedRows.some(row => row.id === id);
}

/** Reuse readable original non-PASS details without making a new reply reproduce them verbatim. */
export function verdictReportTextWithOriginals(input: VerifierItemReviewInput, evidence: VerifierEvidence): string {
  if (!evidence.report_text.includes('[原核验](')) return evidence.report_text;
  const scope = readIssuedVerifierItemScope(input, evidence);
  return withCarriedVerifierDetails(input, evidence, carriedVerifierDetails(input, evidence, scope?.reusedRows));
}

function withCarriedVerifierDetails(input: VerifierItemReviewInput, evidence: VerifierEvidence,
  carried: ReturnType<typeof carriedVerifierDetails>): string {
  const repairs = require('./repair-candidates') as typeof import('./repair-candidates');
  let text = evidence.report_text;
  if (carried.details.size) {
    const declared = new Set(repairs.verifierSemanticChecks(text, input.phase, input.feature).map(item => item.id));
    const missing = [...carried.details].filter(([id]) => !declared.has(id)).map(([, item]) => item);
    if (missing.length) text += '\n\n```yaml\n' + YAML.stringify({ verification_result: { phase: input.phase, feature: input.feature, checks: missing } }) + '```\n';
  }
  if (carried.issues.size) {
    const match = /```issue-verification\s*\r?\n[\s\S]*?```/i.exec(text);
    const current = repairs.parseIssueVerificationBlock(text);
    if (match && !current.ok) return text;
    const declared = new Set(current.entries.map(entry => entry.issue));
    const missing = [...carried.issues].filter(([id]) => !declared.has(id)).map(([, entry]) => entry);
    if (!missing.length) return text;
    const entries = [...current.entries, ...missing].map(({ invalid_reason, ...entry }) =>
      invalid_reason ? { ...entry, verdict: 'invalid' } : entry);
    const block = '```issue-verification\n' + YAML.stringify(entries) + '```';
    text = match ? text.slice(0, match.index) + block + text.slice(match.index + match[0].length) : text + '\n\n' + block + '\n';
  }
  return text;
}

/** 恢复原交回或补核由同一核验入口负责。 */
function rerunGuidance(): string {
  return '恢复：按当前阶段 NEXT 交回或执行原核验请求，核验执行器恢复原答或补核并消费完整报告。';
}

/**
 * 阶段 reports 目录**唯一**解析口径：一律走 `featurePhaseReportsDir`。
 * 这里曾经有一份 `receiptDirPath/reports` 的兜底，那就是路径真源的第三份意见——
 * 自定义 `reports_dir_pattern` 下它会指向另一个目录，导致证据写在 A、验真读 B。
 */
function resolveReportsDir(projectRoot: string, feature: string, phase: string, frameworkRoot?: string): string {
  return featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
}

function readJsonOrNull(abs: string): unknown {
  try {
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return undefined; // undefined = 存在但坏；null = 不存在
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * **身份锚**：当前 run 的 verifier 证据 subject。plan `enabled` 时由 runner 写入。
 */
export function readSummaryVerifierSubjectId(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string | null {
  const dir = resolveReportsDir(projectRoot, feature, phase, frameworkRoot);
  const parsed = readJsonOrNull(path.join(dir, 'summary.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = (parsed as { verifier_subject_id?: unknown }).verifier_subject_id;
  if (!nonEmptyString(raw)) return null;
  const v = raw.trim();
  return SUBJECT_ID_PATTERN.test(v) ? v : null;
}

/**
 * 身份验真后返回 verifier 机器证据；任一环节不成立返回结构化错误。
 * 锚是磁盘 summary 现值——**base summary 尚未落盘时不要用它**，改用
 * `loadVerifierEvidenceForSubject` 显式钉住本轮 subject。
 */
export function loadVerifierEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions,
): LoadVerifierEvidenceResult {
  const currentSubject = readSummaryVerifierSubjectId(projectRoot, feature, phase, opts?.frameworkRoot);
  if (!currentSubject) {
    return {
      ok: false,
      code: 'subject_absent',
      message:
        `summary.json 缺 verifier_subject_id（${feature}/${phase}）——本轮没有生成 verifier 调用凭证` +
        '（能力未启用，或启用了但 request 生成失败）。请重跑该 phase 的 harness：' +
        '启用时它会写出 verifier.request.<subject>.json 并在 summary.verifier_report 给出报告路径。',
    };
  }
  return loadVerifierEvidenceForSubject(projectRoot, feature, phase, currentSubject, opts);
}

/**
 * Latest public, validated report. FAIL is a useful review baseline and is never hidden by an older PASS.
 */
export function findPriorVerifierEvidence(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions & { excludeSubject?: string | null; verdict?: 'PASS' | 'FAIL'; material?: VerifierMaterialView },
): VerifierEvidence | null {
  const dir = resolveReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
  if (!fs.existsSync(dir)) return null;
  let best: { evidence: VerifierEvidence; mtime: number } | null = null;
  for (const name of fs.readdirSync(dir)) {
    const m = /^verifier\.report\.([0-9a-f]{64})\.md$/.exec(name);
    if (!m || m[1] === opts?.excludeSubject) continue;
    const loaded = loadVerifierEvidenceForSubject(projectRoot, feature, phase, m[1], opts);
    if (!loaded.ok || opts?.verdict && loaded.evidence.verdict !== opts.verdict) continue;
    if (opts?.material && !verifierMaterialsEquivalent(readVerifierMaterialOrNull(dir, m[1]), opts.material, projectRoot, opts.resolvedInputs)) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(loaded.evidence.md_path_abs).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (!best || mtime > best.mtime) best = { evidence: loaded.evidence, mtime };
  }
  return best?.evidence ?? null;
}

/** Compatibility reader for historical PASS baselines; this alone grants no current review. */
export function findPriorPassVerifierEvidence(projectRoot: string, feature: string, phase: string,
  opts?: LoadVerifierEvidenceOptions & { excludeSubject?: string | null }): VerifierEvidence | null {
  return findPriorVerifierEvidence(projectRoot, feature, phase, { ...opts, verdict: 'PASS' });
}

/** Same material may reuse the real original report, including a real FAIL; unrelated prior PASS is only context. */
export function findSameMaterialVerifierEvidence(projectRoot: string, feature: string, phase: string, currentSubject: string,
  opts?: LoadVerifierEvidenceOptions): VerifierEvidence | null {
  const currentReport = loadVerifierEvidenceForSubject(projectRoot, feature, phase, currentSubject, opts);
  if (currentReport.ok || currentReport.code !== 'report_missing') return null;
  const dir = resolveReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
  const current = readVerifierMaterialOrNull(dir, currentSubject);
  if (!current) return null;
  const previous = findPriorVerifierEvidence(projectRoot, feature, phase, { ...opts, excludeSubject: currentSubject, material: current });
  if (!previous) return null;
  const material = readVerifierMaterialOrNull(dir, previous.subject_id);
  return verifierMaterialsEquivalent(material, current, projectRoot, opts?.resolvedInputs) ? previous : null;
}

/** An equivalent public original carries its real verdict and report path into current consumption. */
export function loadCurrentVerifierEvidenceForSubject(projectRoot: string, feature: string, phase: string, currentSubject: string,
  opts?: LoadVerifierEvidenceOptions): LoadVerifierEvidenceResult {
  const exact = loadVerifierEvidenceForSubject(projectRoot, feature, phase, currentSubject, opts);
  if (exact.ok || exact.code !== 'report_missing') return exact;
  const same = findSameMaterialVerifierEvidence(projectRoot, feature, phase, currentSubject, opts);
  return same ? { ok: true, evidence: same } : exact;
}

/**
 * plan 07a41ec6 T7：闭环定稿时 verifier 结论来源的**唯一派生口径**（runner finalize /
 * check-receipt CLI / sync-closure 三条路径同一函数）：当前 subject 自身已验真 → null（不登记）；
 * Only an identical, readable material view may retain the existing reviewed original;
 * changed or unavailable material requires independent verification.
 * 其余（能力未启用 / 从未 PASS）→ null。
 */
export function deriveVerifierClosureRecord(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
  options?: Pick<LoadVerifierEvidenceOptions, 'resolvedInputs'>,
): VerifierClosureRecord | null {
  const current = readSummaryVerifierSubjectId(projectRoot, feature, phase, frameworkRoot);
  if (!current) return null;
  const loaded = loadVerifierEvidenceForSubject(projectRoot, feature, phase, current, { frameworkRoot });
  if (loaded.ok || loaded.code !== 'report_missing') return null;
  const prior = findSameMaterialVerifierEvidence(projectRoot, feature, phase, current, { frameworkRoot, ...options });
  if (!prior || prior.verdict !== 'PASS') return null;
  return {
    mode: 'completed_with_prior_review',
    reviewed_subject_id: prior.subject_id,
    current_subject_id: current,
    current_material_not_reverified: [],
  };
}

/**
 * 按**显式给定的 subject** 验真证据。
 *
 * `loadVerifierEvidence` 以磁盘 summary 现值为锚——那在 **base summary 尚未落盘**的时刻是
 * **上一轮**的值，按它取证据会把旧 subject 的结论算到新 run 头上。凡是"我已经知道自己要验
 * 哪个 subject"的调用点，一律走本函数。
 */
export function loadVerifierEvidenceForSubject(
  projectRoot: string,
  feature: string,
  phase: string,
  currentSubject: string,
  opts?: LoadVerifierEvidenceOptions,
): LoadVerifierEvidenceResult {
  const dir = resolveReportsDir(projectRoot, feature, phase, opts?.frameworkRoot);
  const mdAbs = verifierReportMdPath(dir, currentSubject);
  const mdRel = path.relative(projectRoot, mdAbs).replace(/\\/g, '/');

  let text: string;
  try {
    if (!fs.existsSync(mdAbs)) {
      return {
        ok: false,
        code: 'report_missing',
        message: `${mdRel} 不存在——verifier 未运行，或运行了但调用方没有把它的回复写下来。${rerunGuidance()}`,
      };
    }
    text = fs.readFileSync(mdAbs, 'utf-8');
  } catch (e) {
    return {
      ok: false,
      code: 'report_missing',
      message: `${mdRel} 不可读（${(e as Error).message}）。${rerunGuidance()}`,
    };
  }

  try {
    const { stageVerifierPublicReportQualified } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
    const runDirs = verifierOriginalRunDirs(projectRoot, feature, phase, dir, currentSubject);
    if (!stageVerifierPublicReportQualified(runDirs, { feature, phase, subject_id: currentSubject }, mdAbs, text)) {
      return { ok: false, code: 'report_unaccepted', message: mdRel + ' 尚未由拥有该已签请求的运行时接收。' };
    }
  } catch (error) {
    return { ok: false, code: 'report_unaccepted', message: mdRel + ' 的交回无法核实：' + (error as Error).message };
  }
  return parseVerifierEvidenceText({ feature, phase, currentSubject, text, mdAbs, mdRel });
}

/** Check returned original bytes with the same reader before restoring the public report. */
export function parseVerifierEvidenceText(input: { feature: string; phase: string; currentSubject: string;
  text: string; mdAbs: string; mdRel: string }): LoadVerifierEvidenceResult {
  const { feature, phase, currentSubject, text, mdAbs, mdRel } = input;
  // 终态块：**必须恰好一个**。零个 = verifier 没按契约输出，或调用方只写了摘要；
  // 多于一个 = 回答被拼接污染。两种都不是"能修的文书问题"，一律重跑。
  const block = parseResultBlock(text);
  if (!block) {
    return {
      ok: false,
      code: 'block_unparseable',
      message:
        `${mdRel} 里没有恰好一个合法终态块（<!-- maison-verifier-result:v1 --> ... 含 ` +
        `verifier_subject_id / verdict / blocker_count 三字段）。常见成因：调用方写入的不是 verifier ` +
        `回复全文（摘要、只贴终态块、或多份回答拼接）。${rerunGuidance()}`,
    };
  }

  if (block.subject_id !== currentSubject) {
    return {
      ok: false,
      code: 'subject_mismatch',
      message:
        `${mdRel} 的终态块回显 subject=${block.subject_id.slice(0, 12)}…，当前 subject=` +
        `${currentSubject.slice(0, 12)}…。该报告审的不是当前材料（迟到、错位，或字段被手改）。${rerunGuidance()}`,
    };
  }

  // verdict ⟺ blocker_count：PASS 当且仅当 0。自相矛盾按无效证据处理。
  const consistent = block.verdict === 'PASS' ? block.blocker_count === 0 : block.blocker_count > 0;
  if (!consistent) {
    return {
      ok: false,
      code: 'verdict_inconsistent',
      message:
        `${mdRel} 的 verdict=${block.verdict} 与 blocker_count=${block.blocker_count} 自相矛盾。${rerunGuidance()}`,
    };
  }

  return {
    ok: true,
    evidence: {
      feature,
      phase,
      subject_id: block.subject_id,
      verdict: block.verdict,
      blocker_count: block.blocker_count,
      report_text: text,
      md_path_abs: mdAbs,
      md_path_rel: mdRel,
    },
  };
}

/**
 * 只要正文的消费者（repair candidates / multimodal evidence / goal snapshot 机器字段）
 * 的统一入口：验真不通过 → null（各自既有的"无证据"通道，fail-closed 不猜）。
 */
export function loadVerifierReportTextOrNull(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: LoadVerifierEvidenceOptions & {
    /**
     * 显式锚定 subject。**在 base summary 落盘前调用时必须传**——否则读到的是上一轮
     * summary 的 subject，会把旧 verifier 正文算进本轮的 repair_candidates。
     * 传 `null` 表示"本轮没有可用 subject"，直接返回 null。
     */
    subjectId?: string | null;
  },
): string | null {
  if (opts && 'subjectId' in opts) {
    if (!opts.subjectId) return null;
    const pinned = loadVerifierEvidenceForSubject(projectRoot, feature, phase, opts.subjectId, opts);
    return pinned.ok ? verdictReportTextWithOriginals({ ...opts, projectRoot, feature, phase, currentSubject: opts.subjectId }, pinned.evidence) : null;
  }
  const res = loadVerifierEvidence(projectRoot, feature, phase, opts);
  return res.ok ? verdictReportTextWithOriginals({ ...opts, projectRoot, feature, phase, currentSubject: res.evidence.subject_id }, res.evidence) : null;
}
