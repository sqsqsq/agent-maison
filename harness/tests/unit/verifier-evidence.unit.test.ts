// ============================================================================
// verifier-evidence.unit.test.ts — 报告即真源（plan d2f7a9c4）
// ============================================================================
// 冻结的是**裁决面**，不是实现。机器真源从 hook 发布的 canonical JSON 改回调用方写出的
// MD 之后，校验只剩三条：文件在、终态块回显的 subject 等于当前 subject、verdict 与
// blocker_count 一致。这一套把那三条与两条边界钉死：
//
//   · **恢复动作只有一种**——四种错误码的话术必须都指向"重跑 verifier 并重写报告"，
//     绝不指向改文书。这正是本轮病根的反面：旧口径把"发布手续失败"判成"检查不存在"，
//     宿主两轮无人值守 run 因此熔断。
//   · **闭环后改报告不 stale**——报告刻意不做防篡改（无结论指纹），因此它既不进 evidence
//     manifest、也不进 closure attestation。少删一处，就等于从那一处把 tamper 检测接回来，
//     与"改了查不出"自相矛盾。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveReceiptFilePath } from '../../config';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { snapshotPhaseHarness } from '../../scripts/utils/goal-phase-snapshot';
import {
  loadVerifierEvidence,
  loadVerifierEvidenceForSubject,
  deriveVerifierClosureRecord,
  findPriorPassVerifierEvidence,
  findPriorVerifierEvidence,
  findSameMaterialVerifierEvidence,
  planVerifierItemReview,
  verdictReportTextWithOriginals,
  readVerifierOriginalReference,
  verifierReportItemGaps,
} from '../../scripts/utils/verifier-evidence';
import { buildVerifierMaterialView, writeVerifierMaterial } from '../../scripts/utils/verifier-material';
import { assembleAIPrompt, generateScriptReport, readVerifierItemReviewPrompt } from '../../scripts/utils/report-generator';
import { resolveCompletionDisposition } from '../../scripts/utils/verify-feature-completion';
import { parseIssueVerificationBlock, verifierSemanticChecks } from '../../scripts/utils/repair-candidates';
import { writeRunSummaryBase } from '../../harness-runner';
import {
  PHASE_REPORTS_OUTPUT_FILES,
  resolvePhaseEvidenceManifest,
} from '../../scripts/utils/phase-evidence-manifest';
import { collectReceiptProjectionFacts } from '../../scripts/utils/receipt-scaffold';
import { verifierModeOf } from '../../scripts/utils/revalidate';
import {
  fixtureSubjectId,
  publishFixtureVerifierEvidence,
  renderResultBlock,
} from '../utils/verifier-evidence-fixture';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FEATURE = 'demo';
const PHASE = 'spec';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** 最小实例：framework.config.json + 阶段 reports 目录 + 一份 summary.json。 */
function makeHost(): { root: string; reportsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-verifier-evidence-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({ project_name: 'demo', agent_adapter: 'claude', active_workflow: 'spec-driven' }, null, 2),
  );
  const reportsDir = path.join(root, 'doc', 'features', FEATURE, PHASE, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, 'summary.json'),
    JSON.stringify({ schema_version: '1.3', feature: FEATURE, phase: PHASE, verdict: 'PASS' }, null, 2),
  );
  clearFrameworkConfigCache();
  return { root, reportsDir };
}

function withHost(fn: (host: { root: string; reportsDir: string }) => void): void {
  const host = makeHost();
  try {
    fn(host);
  } finally {
    fs.rmSync(host.root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

function material(root: string, rule = 'unchanged') {
  return buildVerifierMaterialView({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: FEATURE, phase: PHASE,
    gateFingerprint: null, phaseRuleText: rule, templateText: 'same template', checks: [], contextFiles: [] });
}

// --------------------------------------------------------------------------
// 1. 命中：调用方写下的报告全文就是 report_text
// --------------------------------------------------------------------------
function case1_hit(): void {
  withHost(({ root, reportsDir }) => {
    const published = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
      reportText: '# 报告\n\n发现：AC-3 缺少异常分支（WARN，不阻断）\n',
    });
    const loaded = loadVerifierEvidence(root, FEATURE, PHASE);
    assert(loaded.ok, `应命中，实得 ${loaded.ok ? '' : loaded.code}`);
    if (!loaded.ok) return;
    assert(loaded.evidence.verdict === 'PASS', `verdict=${loaded.evidence.verdict}`);
    assert(loaded.evidence.blocker_count === 0, `blocker_count=${loaded.evidence.blocker_count}`);
    assert(loaded.evidence.subject_id === published.subjectId, 'subject 应与 summary 一致');
    // **正文必须完整带出**：repair candidates 与多模态读图证据都从这里取文本。
    // 只写终态块的报告能过校验却把这些全丢掉，所以这条断言防的是"调用方偷懒只贴块"。
    assert(
      loaded.evidence.report_text.includes('AC-3 缺少异常分支'),
      'report_text 必须是报告全文，不能只剩终态块',
    );
    assert(loaded.evidence.md_path_rel.endsWith(`verifier.report.${published.subjectId}.md`), '路径应按 subject 分区');
  });
}

// --------------------------------------------------------------------------
// 2. 四种失败：各自独立错误码，且恢复话术**只**指向重跑
// --------------------------------------------------------------------------
function case2_failuresAllPointToRerun(): void {
  withHost(({ root, reportsDir }) => {
    const subject = fixtureSubjectId('missing');
    // ① 报告不存在（verifier 没跑，或跑了但调用方没写下来）
    const missing = loadVerifierEvidenceForSubject(root, FEATURE, PHASE, subject);
    assert(!missing.ok && missing.code === 'report_missing', `实得 ${missing.ok ? 'ok' : missing.code}`);

    // ② 终态块缺失：调用方只写了摘要
    fs.writeFileSync(path.join(reportsDir, `verifier.report.${subject}.md`), '# 报告\n\n看起来没问题。\n');
    const noBlock = loadVerifierEvidenceForSubject(root, FEATURE, PHASE, subject);
    assert(!noBlock.ok && noBlock.code === 'block_unparseable', `实得 ${noBlock.ok ? 'ok' : noBlock.code}`);

    // ③ 终态块多于一个：两份回答被拼在一起
    const dup = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
      subjectId: fixtureSubjectId('dup'),
      duplicateBlock: true,
    });
    const dupLoaded = loadVerifierEvidenceForSubject(root, FEATURE, PHASE, dup.subjectId);
    assert(!dupLoaded.ok && dupLoaded.code === 'block_unparseable', `实得 ${dupLoaded.ok ? 'ok' : dupLoaded.code}`);

    // ④ subject 回显不符：迟到 / 错位 / 被手改
    const stale = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
      subjectId: fixtureSubjectId('current'),
      echoSubjectId: fixtureSubjectId('other'),
    });
    const mismatch = loadVerifierEvidenceForSubject(root, FEATURE, PHASE, stale.subjectId);
    assert(!mismatch.ok && mismatch.code === 'subject_mismatch', `实得 ${mismatch.ok ? 'ok' : mismatch.code}`);

    // ⑤ verdict 与 blocker_count 自相矛盾
    const bad = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
      subjectId: fixtureSubjectId('inconsistent'),
      verdict: 'PASS',
      blockerCount: 3,
    });
    const inconsistent = loadVerifierEvidenceForSubject(root, FEATURE, PHASE, bad.subjectId);
    assert(
      !inconsistent.ok && inconsistent.code === 'verdict_inconsistent',
      `实得 ${inconsistent.ok ? 'ok' : inconsistent.code}`,
    );

    // **恢复动作唯一**：每条话术都必须指向重跑 verifier，且都不得指向"改回执/改报告"。
    for (const r of [missing, noBlock, dupLoaded, mismatch, inconsistent]) {
      assert(!r.ok, 'should be failure');
      if (r.ok) continue;
      assert(r.message.includes('投给 verifier'), `话术须指向重跑 verifier：${r.message}`);
      assert(!/改回执|手填/.test(r.message), `话术不得指向改文书：${r.message}`);
    }
  });
}

// --------------------------------------------------------------------------
// 3. subject 缺席 = 本轮没有调用凭证（不是"证据缺失"）
// --------------------------------------------------------------------------
function case3_subjectAbsent(): void {
  withHost(({ root }) => {
    const loaded = loadVerifierEvidence(root, FEATURE, PHASE);
    assert(!loaded.ok && loaded.code === 'subject_absent', `实得 ${loaded.ok ? 'ok' : loaded.code}`);
  });
}

// --------------------------------------------------------------------------
// 4. 既往 PASS 沿用（plan 07a41ec6 T7 行为不变）
// --------------------------------------------------------------------------
function case4_priorPassReuse(): void {
  withHost(({ root, reportsDir }) => {
    const prior = fixtureSubjectId('prior');
    const current = fixtureSubjectId('current');
    publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
      subjectId: prior,
      skipSummaryPatch: true,
    });
    // summary 指向新 subject，但新 subject 还没有报告
    const summaryPath = path.join(reportsDir, 'summary.json');
    const doc = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    doc.verifier_subject_id = current;
    fs.writeFileSync(summaryPath, JSON.stringify(doc, null, 2));

    const found = findPriorPassVerifierEvidence(root, FEATURE, PHASE, { excludeSubject: current });
    assert(found?.subject_id === prior, `应找到既往 PASS，实得 ${found?.subject_id ?? 'null'}`);

    assert(deriveVerifierClosureRecord(root, FEATURE, PHASE) === null, 'missing original material cannot be replaced by an old PASS');
    const before = material(root);
    writeVerifierMaterial(reportsDir, prior, before);
    writeVerifierMaterial(reportsDir, current, material(root, 'actually changed rule'));
    assert(deriveVerifierClosureRecord(root, FEATURE, PHASE) === null, 'changed material requires independent review');
    writeVerifierMaterial(reportsDir, current, before);
    const closure = deriveVerifierClosureRecord(root, FEATURE, PHASE);
    assert(closure?.mode === 'completed_with_prior_review', `实得 ${closure?.mode ?? 'null'}`);
    assert(closure?.reviewed_subject_id === prior && closure.current_subject_id === current, '两个 subject 都要如实登记');
    assert(closure?.current_material_not_reverified?.length === 0, 'exact material reuse carries no invented unreviewed change');
    fs.writeFileSync(path.join(reportsDir, `verifier.report.${current}.md`), '# Current substantive denial with an unfinished result envelope\n');
    assert(findSameMaterialVerifierEvidence(root, FEATURE, PHASE, current) === null,
      'a malformed current original must be repaired independently, not hidden behind an older PASS');
    assert(deriveVerifierClosureRecord(root, FEATURE, PHASE) === null, 'a malformed current report cannot produce a reused closure');

    // 从未 PASS 过 → 不得沿用（至少要完整审一次）
    const fail = fixtureSubjectId('failonly');
    publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir: path.join(root, 'doc', 'features', FEATURE, 'plan', 'reports'),
      feature: FEATURE,
      phase: 'plan',
      subjectId: fail,
      verdict: 'FAIL',
      blockerCount: 2,
      skipSummaryPatch: true,
    });
    assert(
      findPriorPassVerifierEvidence(root, FEATURE, 'plan', {}) === null,
      'FAIL 报告不得被当作可沿用的既往 PASS',
    );
  });
}

// --------------------------------------------------------------------------
// 5. 闭环后改报告**不**使 evidence manifest stale
// --------------------------------------------------------------------------
// 报告刻意不做防篡改（无结论指纹）。若 manifest 仍登记它的字节，就成了"改报告唯一还有机器
// 后果"的地方——与裁决规则自相矛盾，也会复活当初催生 subject 分区的那条 stale 级联。
function case5_reportNotInManifest(): void {
  withHost(({ root, reportsDir }) => {
    assert(
      !(PHASE_REPORTS_OUTPUT_FILES as readonly string[]).some(f => f.startsWith('verifier.report')),
      'verifier 报告不得进固定名保护表',
    );
    const published = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
    });
    const manifest = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: PHASE });
    const registered = manifest.outputs.map(e => e.path);
    assert(
      !registered.some(rel => rel.includes('verifier.report.')),
      `verifier 报告不得进 manifest 保护面，实得：${registered.filter(rel => rel.includes('verifier')).join(', ')}`,
    );
    // 改报告后 manifest 聚合哈希不变（连"它被登记过"这件事都不存在）
    fs.appendFileSync(published.mdPath, '\n（闭环后追加的说明）\n');
    const after = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: PHASE });
    assert(
      JSON.stringify(after.outputs.map(e => e.path)) === JSON.stringify(registered),
      '改报告不得改变 manifest 登记面',
    );
    assert(
      after.aggregate_sha256 === manifest.aggregate_sha256,
      '改报告不得改变 manifest 聚合哈希（否则闭环会被判 stale）',
    );
  });
}

// --------------------------------------------------------------------------
// 6. 终态块解析口径与生产渲染同源（fixture 不许自造格式）
// --------------------------------------------------------------------------
function case6_blockFormatIsShared(): void {
  withHost(({ root, reportsDir }) => {
    const subject = fixtureSubjectId('fmt');
    // 手写一份"正文 + 生产格式终态块"，走 loader 验证格式契约本身
    fs.writeFileSync(
      path.join(reportsDir, `verifier.report.${subject}.md`),
      `# 手写报告\n\n结论如下。\n\n${renderResultBlock(subject, 'FAIL', 2)}\n`,
    );
    const loaded = loadVerifierEvidenceForSubject(root, FEATURE, PHASE, subject);
    assert(loaded.ok, `生产格式终态块应可解析，实得 ${loaded.ok ? '' : loaded.code}`);
    if (!loaded.ok) return;
    assert(loaded.evidence.verdict === 'FAIL' && loaded.evidence.blocker_count === 2, 'FAIL/2 应如实带出');
  });
}

// --------------------------------------------------------------------------
// 7. summary.verifier_report 是**仓根相对**路径，且报告按它就能找到
// --------------------------------------------------------------------------
// codex review 实测到的夹具缺陷：按 reports 目录反推基准会写出 `spec/reports/…` 这种半截
// 路径。夹具与被测代码各自拼路径时能一起"通过"，而生产里调用方按这个指针去写/去找都会落空。
// 这条把指针钉成契约：从项目根解析 summary.verifier_report 必须命中真实报告文件。
function case7_reportPointerIsRepoRelative(): void {
  withHost(({ root, reportsDir }) => {
    const published = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
    });
    const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf-8')) as {
      verifier_report?: string;
    };
    const pointer = String(summary.verifier_report ?? '');
    assert(
      pointer.startsWith('doc/features/'),
      `verifier_report 必须是仓根相对路径，实得 ${pointer}`,
    );
    assert(
      fs.existsSync(path.join(root, pointer)),
      `按 summary.verifier_report 从项目根解析必须命中报告文件：${pointer}`,
    );
    assert(
      path.resolve(root, pointer) === path.resolve(published.mdPath),
      '指针与实际写入路径必须是同一个文件（不能各拼各的）',
    );
  });
}

// --------------------------------------------------------------------------
// 8. 回执投影从 MD 取 report_path 与 verdict（不再读旧 canonical JSON）
// --------------------------------------------------------------------------
// 回执是闭环后的只读投影、无裁决权，但空 report_path / 空 verdict 会误导人；残留的旧 .json
// 更会让它展示上一代结论。投影必须走共享 loader。
function case8_receiptProjectionReadsMarkdown(): void {
  withHost(({ root, reportsDir }) => {
    const published = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
    });
    // 残留一份结论相反的旧 canonical JSON：它已退出读取面，不得被投影采信。
    fs.writeFileSync(
      path.join(reportsDir, `verifier.report.${published.subjectId}.json`),
      JSON.stringify({ schema_version: '2.0', state: 'published', verdict: 'FAIL' }, null, 2),
    );
    const facts = collectReceiptProjectionFacts(root, FEATURE, PHASE);
    assert(
      facts.verifier.report_path.endsWith(`verifier.report.${published.subjectId}.md`),
      `report_path 应指向 MD 报告，实得 ${facts.verifier.report_path}`,
    );
    assert(
      facts.verifier.verdict === 'PASS',
      `verdict 应取自 MD 终态块（残留旧 JSON 的 FAIL 不得被采信），实得 ${facts.verifier.verdict}`,
    );
  });
}

// --------------------------------------------------------------------------
// 9. 重验账本的 verifier 字段也走 MD（同材料复用不得被记成 missing）
// --------------------------------------------------------------------------
// revalidate 的 verifier 字段只是账本记录、不阻断，但记错会让人以为"复用失效了"。
// 它此前手拼 `verifier.report.<subject>.json` 读存在性——真源换成 MD 后必然记 missing。
function case9_revalidateLedgerReadsMarkdown(): void {
  withHost(({ root, reportsDir }) => {
    const published = publishFixtureVerifierEvidence({
      projectRoot: root,
      reportsDir,
      feature: FEATURE,
      phase: PHASE,
    });
    const summary = { verifier_subject_id: published.subjectId };
    assert(
      verifierModeOf(root, FEATURE, PHASE, summary) === 'reused_same_material',
      '同材料且报告校验通过 → 复用；实得 ' + verifierModeOf(root, FEATURE, PHASE, summary),
    );

    // 报告在但终态块坏 → 不可复用，与缺失同判（不能因为"文件存在"就宣称复用）。
    fs.writeFileSync(published.mdPath, "# 报告\n\n没有终态块。\n");
    assert(
      verifierModeOf(root, FEATURE, PHASE, summary) === 'missing',
      '终态块坏掉的报告不得算复用；实得 ' + verifierModeOf(root, FEATURE, PHASE, summary),
    );

    // 无 subject = 本阶段没有 verifier 这一环。
    assert(verifierModeOf(root, FEATURE, PHASE, {}) === 'not_applicable', '无 subject 应 not_applicable');
  });
}

// --------------------------------------------------------------------------
// B04-V5 / B04-V6（plan 2f8a6d40 D3）：goal 阶段快照对"沿用既往 PASS"的证据回落
// --------------------------------------------------------------------------
// 全程真实生产函数：publishFixtureVerifierEvidence（与生产同形的报告字节）→
// deriveVerifierClosureRecord（唯一派生口径）→ finalizePhaseClosure（真实闭环定稿，
// 写 verifier_closure 与 semantic_not_reverified）→ snapshotPhaseHarness（被测对象）。
// 不手拼 summary 的 verifier_closure / readiness_signals 字段。

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const RUN_REPORT_DIR = 'doc/goal-runs/run-b04';

/** 可过 finalizer 的最小 1.2 host（形状照 phase-closure-finalizer 套件的 mkProject）。 */
function makeClosureHost(): { root: string; reportsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-b04-snapshot-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'b04-snapshot',
      project_profile: { name: 'generic' },
      agent_adapter: 'generic',
      architecture: {
        outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['content'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ts',
      },
      paths: { features_dir: 'doc/features' },
    }),
    'utf8',
  );
  const featureRoot = path.join(root, 'doc', 'features', FEATURE);
  fs.mkdirSync(path.join(featureRoot, PHASE), { recursive: true });
  fs.writeFileSync(path.join(featureRoot, PHASE, 'spec.md'), '# Demo\n', 'utf8');
  fs.writeFileSync(path.join(featureRoot, 'acceptance.yaml'), 'criteria: []\n', 'utf8');
  const reportsDir = featurePhaseReportsDir(root, FEATURE, PHASE, FRAMEWORK_ROOT);
  fs.mkdirSync(reportsDir, { recursive: true });
  const controlledCheck = { id: 'fixture_spec_input', category: 'structure', severity: 'BLOCKER', description: 'controlled nonempty source for report binding',
    status: fs.readFileSync(path.join(featureRoot, PHASE, 'spec.md'), 'utf8').trim() ? 'PASS' : 'FAIL', details: 'Read the actual nonempty current spec/spec.md source.' } as const;
  const script = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), PHASE, FEATURE, root, [controlledCheck], FRAMEWORK_ROOT);
  writeRunSummaryBase(root, script, FRAMEWORK_ROOT);
  const receiptPath = resolveReceiptFilePath(root, FEATURE, PHASE).path;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, '# receipt\n\nclaimed: true\n', 'utf8');
  clearFrameworkConfigCache();
  return { root, reportsDir };
}

function withClosureHost(fn: (host: { root: string; reportsDir: string }) => void): void {
  const host = makeClosureHost();
  try {
    fn(host);
  } finally {
    fs.rmSync(host.root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

/** 真实闭环定稿（verifier_closure 由 deriveVerifierClosureRecord 现算，不手写）。 */
function closeWithRealFinalizer(root: string): void {
  finalizePhaseClosure({
    projectRoot: root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: FEATURE,
    phase: PHASE,
    persistPhaseState: () => undefined,
    prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
    summaryPatch: { verifier_closure: deriveVerifierClosureRecord(root, FEATURE, PHASE) },
  });
}

function readSnapshotSummary(root: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(root, RUN_REPORT_DIR, 'phases', PHASE, 'harness', 'summary.json'), 'utf-8'),
  ) as Record<string, unknown>;
}

export function caseB04V5_snapshotArchivesReusedReport(): void {
  withClosureHost(({ root, reportsDir }) => {
    const priorSubject = fixtureSubjectId('b04-prior');
    const currentSubject = fixtureSubjectId('b04-current');
    // subject A：完整审过并 PASS
    const published = publishFixtureVerifierEvidence({
      projectRoot: root, reportsDir, feature: FEATURE, phase: PHASE,
      subjectId: priorSubject, skipSummaryPatch: true,
    });
    // 材料变更 → 当前 subject B，B 还没有报告
    const summaryPath = path.join(reportsDir, 'summary.json');
    const doc = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    doc.verifier_subject_id = currentSubject;
    fs.writeFileSync(summaryPath, JSON.stringify(doc, null, 2), 'utf-8');
    const view = material(root);
    writeVerifierMaterial(reportsDir, priorSubject, view); writeVerifierMaterial(reportsDir, currentSubject, view);

    closeWithRealFinalizer(root);
    const snap = snapshotPhaseHarness(root, FEATURE, PHASE as never, RUN_REPORT_DIR, FRAMEWORK_ROOT);

    // 快照必须归档"这次闭环真正依据的那份报告"，并标注它是沿用
    assert(
      snap.verifier_evidence?.subject_id === priorSubject,
      `快照应归档被沿用的 subject A，实得 ${snap.verifier_evidence?.subject_id ?? 'null'}`,
    );
    assert(snap.verifier_evidence?.verdict === 'PASS', `实得 ${snap.verifier_evidence?.verdict ?? 'null'}`);
    assert(
      snap.verifier_evidence?.reused_from_prior_review === true,
      '沿用既往 PASS 时必须标注 reused_from_prior_review',
    );
    const reportRel = snap.snapshot_files['verifier.report.md'];
    assert(reportRel !== null, '沿用闭环的存档不得缺 verifier.report.md');
    assert(
      fs.readFileSync(path.join(root, reportRel as string)).equals(fs.readFileSync(published.mdPath)),
      '存档报告字节须等于被沿用的那份 A',
    );
    // 三处并陈：同目录 summary 副本自证"沿用 + 未重审"
    const copied = readSnapshotSummary(root);
    const closure = copied.verifier_closure as { mode?: string; reviewed_subject_id?: string } | undefined;
    assert(closure?.mode === 'completed_with_prior_review', `实得 ${closure?.mode ?? 'null'}`);
    assert(closure?.reviewed_subject_id === priorSubject, 'closure 记录的 subject 须与快照 subject 一致');
    assert(
      !((copied.readiness_signals ?? []) as Array<{ id?: string }>).some(s => s.id === 'semantic_not_reverified'),
      'identical material does not invent an unreviewed semantic gap',
    );
  });
}

export function caseB04V6_snapshotFallbackGuards(): void {
  // ① 当前 subject 自己有验真 PASS 报告 → 取当前证据，不得标沿用（回落不得抢在当前证据之前）
  withClosureHost(({ root, reportsDir }) => {
    const current = fixtureSubjectId('b04-self');
    const script = JSON.parse(fs.readFileSync(path.join(reportsDir, 'script-report.json'), 'utf8'));
    const currentMaterial = buildVerifierMaterialView({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE, phase: PHASE,
      gateFingerprint: null, phaseRuleText: 'current controlled spec input', templateText: 'same template', checks: script.checks,
      contextFiles: [{ label: `doc/features/${FEATURE}/${PHASE}/spec.md`, content: fs.readFileSync(path.join(root, 'doc/features', FEATURE, PHASE, 'spec.md'), 'utf8') }] });
    writeVerifierMaterial(reportsDir, current, currentMaterial);
    publishFixtureVerifierEvidence({
      projectRoot: root, reportsDir, feature: FEATURE, phase: PHASE, subjectId: current,
    });
    closeWithRealFinalizer(root);
    const snap = snapshotPhaseHarness(root, FEATURE, PHASE as never, RUN_REPORT_DIR, FRAMEWORK_ROOT);
    assert(snap.verifier_evidence?.subject_id === current, '当前 subject 有报告时须取当前证据');
    assert(
      snap.verifier_evidence?.reused_from_prior_review === undefined,
      '当前材料自己审过时不得标 reused_from_prior_review',
    );
    assert(snap.snapshot_files['verifier.report.md'] !== null, '当前证据的报告须归档');
  });
  // ② 本 phase 从未 PASS 过 → 无 verifier_closure，快照仍是 null（不得凭空回落）
  withClosureHost(({ root, reportsDir }) => {
    const current = fixtureSubjectId('b04-never');
    const summaryPath = path.join(reportsDir, 'summary.json');
    const doc = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    doc.verifier_subject_id = current;
    fs.writeFileSync(summaryPath, JSON.stringify(doc, null, 2), 'utf-8');
    // 同 phase 只留一份 FAIL 报告——不得被当成可沿用的既往 PASS
    publishFixtureVerifierEvidence({
      projectRoot: root, reportsDir, feature: FEATURE, phase: PHASE,
      subjectId: fixtureSubjectId('b04-failonly'), verdict: 'FAIL', blockerCount: 2,
      skipSummaryPatch: true,
    });
    assert(deriveVerifierClosureRecord(root, FEATURE, PHASE) === null, 'FAIL-only 不得派生沿用闭环');
    let rejected = false;
    try { closeWithRealFinalizer(root); } catch { rejected = true; }
    assert(rejected, 'missing current or same-material verification cannot close the phase');
    const snap = snapshotPhaseHarness(root, FEATURE, PHASE as never, RUN_REPORT_DIR, FRAMEWORK_ROOT);
    assert(snap.verifier_evidence === null, `从未 PASS 过不得回落出证据：${JSON.stringify(snap.verifier_evidence)}`);
    assert(snap.snapshot_files['verifier.report.md'] === null, '不得归档一份 FAIL 或不存在的报告');
  });
}

const CASES: Array<{ name: string; fn: () => void }> = [
  { name: 'signed partial review retains unmodified denial through writer and completion', fn: () => {
    withClosureHost(({ root, reportsDir }) => {
      const oldId = fixtureSubjectId('partial-review-original');
      const rules = 'controlled fixture phase rules';
      const template = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'prompts', 'verify-spec.md'), 'utf8');
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'src/acceptance.ts'), 'export const acceptance = false;\n');
      fs.writeFileSync(path.join(root, 'src/navigation.ts'), 'export const navigation = "/entry";\n');
      const acceptance = `doc/features/${FEATURE}/acceptance.yaml`;
      const spec = `doc/features/${FEATURE}/spec/spec.md`;
      fs.writeFileSync(path.join(root, acceptance), 'criteria:\n  - id: AC-1\n    description: Validate the stored acceptance result.\n');
      const checks = JSON.parse(fs.readFileSync(path.join(reportsDir, 'script-report.json'), 'utf8')).checks;
      const script = generateScriptReport(path.join(FRAMEWORK_ROOT, 'harness'), PHASE, FEATURE, root, checks, FRAMEWORK_ROOT);
      const currentMaterial = (phaseRuleText = rules) => buildVerifierMaterialView({
        projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE, phase: PHASE, gateFingerprint: null,
        phaseRuleText, templateText: template, checks,
        contextFiles: ['src/acceptance.ts', 'src/navigation.ts', acceptance, spec].map(label => ({ label, content: fs.readFileSync(path.join(root, label), 'utf8') })),
      });
      const table = '| id | status | severity | 证据 |\n|---|---|---|---|\n';
      const details = `\`${acceptance}:2\` AC-1 要验证保存结论，\`${spec}:1\` 当前没有可执行的预期。`;
      const suggestion = '由 spec 责任方补可执行预期。';
      const originalIssue = { issue: 'acceptance_testable', verdict: 'confirmed', repair_owner: 'spec', evidence: `${spec} | ${details}；${suggestion}` };
      const originalDetail = { id: 'acceptance_testable', status: 'FAIL', severity: 'BLOCKER', acceptance_ids: ['AC-1'], affected_files: [spec], details, suggestion };
      writeVerifierMaterial(reportsDir, oldId, currentMaterial());
      const original = publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: FEATURE, phase: PHASE, subjectId: oldId,
        verdict: 'FAIL', blockerCount: 1, reportText: table + [
          '| acceptance_testable | FAIL | BLOCKER | src/acceptance.ts:1 当前无法验证预期。 |',
          '| scenario_to_page | PASS | MAJOR | src/navigation.ts:1 已定位入口。 |',
        ].join('\n') + '\n\n```yaml\n' + YAML.stringify({ verification_result: { phase: PHASE, feature: FEATURE, checks: [originalDetail] } }) + '```\n'
          + '\n```issue-verification\n' + YAML.stringify([originalIssue]) + '```\n', skipSummaryPatch: true });
      const plan = (view = currentMaterial()) => planVerifierItemReview({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
        feature: FEATURE, phase: PHASE, currentMaterial: view, templateText: template });
      const unlocalized = plan(currentMaterial('rules changed while files stayed identical'));
      assert(unlocalized.scope.mode === 'full' && unlocalized.scope.reviewIds.length > 2 && !unlocalized.scope.reusedRows.length,
        'an actual rules-only change must review all applicable items even when every file digest is unchanged');
      fs.writeFileSync(path.join(root, 'src/navigation.ts'), 'export const navigation = "/updated-entry";\n');
      const view = currentMaterial();
      const itemReview = plan(view);
      assert(itemReview.scope.mode === 'partial' && itemReview.scope.reviewIds.join(',') === 'scenario_to_page',
        'only the actual changed reference gets verification');
      const prompt = assembleAIPrompt(path.join(FRAMEWORK_ROOT, 'harness'), root, PHASE, FEATURE, [], JSON.stringify(script),
        rules, undefined, undefined, FRAMEWORK_ROOT, { templateText: template, itemReview });
      const scope = readVerifierItemReviewPrompt(prompt);
      const kept = scope?.reusedRows[0];
      assert(!!kept && kept.status === 'FAIL' && kept.evidence.includes(path.basename(original.mdPath)), 'prompt must carry the original public denial');
      const writerOptions = { verifierPlan: { mode: 'enabled' as const, reason: 'policy_required' as const,
        verifier_prompt: 'prompts/verify-spec.md', message: 'real request for partial review' }, verifierMaterial: view };
      const issued = writeRunSummaryBase(root, script, FRAMEWORK_ROOT, writerOptions);
      const publicPath = path.join(root, issued.verifier_report!);
      const observe = () => resolveCompletionDisposition({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE, chain: [PHASE] })
        .completionBlocking.filter(problem => problem.id === 'attestation_present');
      const currentRow = '| scenario_to_page | PASS | MAJOR | src/navigation.ts:1 复核更新入口。 |\n';
      fs.writeFileSync(publicPath, table + currentRow + renderResultBlock(issued.verifier_subject_id!, 'PASS', 0));
      assert(observe().some(problem => problem.action === 'verify' && problem.detail.includes('acceptance_testable')),
        'a partial report cannot erase a carried denial by omitting its row');
      assert(writeRunSummaryBase(root, script, FRAMEWORK_ROOT, writerOptions).next_action !== 'fill_receipt_then_sync_closure',
        'writer retry cannot short-circuit a thin current PASS');
      const reference = readVerifierOriginalReference(kept!.evidence);
      assert(!!reference, 'a carried row must record its own original report and line');
      const carried = table + currentRow + `| ${kept!.id} | ${kept!.status} | ${kept!.severity} | 原依据仍有效 [原核验]( <${reference!.report}#L${reference!.line}> )。 |\n`
        + renderResultBlock(issued.verifier_subject_id!, 'FAIL', 1);
      fs.writeFileSync(publicPath, carried);
      assert(observe().some(problem => problem.action === 'repair') && !observe().some(problem => problem.action === 'verify'),
        'the same valid original reference still advances repair after changing Markdown spacing and explanatory words');
      const loaded = loadVerifierEvidence(root, FEATURE, PHASE, { frameworkRoot: FRAMEWORK_ROOT });
      assert(loaded.ok, 'the current public report remains the original short reply');
      if (!loaded.ok) return;
      assert(!loaded.evidence.report_text.includes('issue-verification'), 'old evidence need not be copied into the new report');
      const interpreted = verdictReportTextWithOriginals({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
        feature: FEATURE, phase: PHASE, currentSubject: issued.verifier_subject_id }, loaded.evidence);
      const inherited = parseIssueVerificationBlock(interpreted).entries[0];
      assert(inherited?.issue === originalIssue.issue && inherited?.repair_owner === originalIssue.repair_owner
        && inherited?.verdict === originalIssue.verdict && inherited?.evidence === originalIssue.evidence
        && verifierSemanticChecks(interpreted, PHASE, FEATURE).some(row => row.details === details),
      'the original acceptance rationale, denial and responsibility come directly from the matched report row');
      const newEntry = { ...originalIssue, verdict: 'unclear', evidence: `${spec} | 当前独立判断需要额外已授权的反证。` };
      fs.writeFileSync(publicPath, carried + '\n```issue-verification\n' + YAML.stringify([newEntry]) + '```\n');
      const current = loadVerifierEvidence(root, FEATURE, PHASE, { frameworkRoot: FRAMEWORK_ROOT });
      assert(current.ok, 'the new independent decision has the issued subject');
      if (!current.ok) return;
      const decisions = parseIssueVerificationBlock(verdictReportTextWithOriginals({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
        feature: FEATURE, phase: PHASE, currentSubject: issued.verifier_subject_id }, current.evidence)).entries;
      assert(decisions.length === 1 && decisions[0].verdict === 'unclear' && decisions[0].evidence === newEntry.evidence,
        'the current explicit independent decision is authoritative for the named issue');
    });
  } },
  { name: 'outstanding reviewer issue keeps its own answer requirement outside the template check IDs', fn: () => {
    withClosureHost(({ root }) => {
      const phase = 'review';
      const reportsDir = featurePhaseReportsDir(root, FEATURE, phase, FRAMEWORK_ROOT);
      fs.mkdirSync(reportsDir, { recursive: true });
      const file = 'src/target.ts';
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, file), 'export const value = 12;\n');
      fs.writeFileSync(path.resolve(reportsDir, '../review-report.md'), [
        '# Review', '## 问题清单', '| 编号 | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |', '|---|---|---|---|---|---|',
        `| CR-137 | MAJOR | 逻辑错误 | ${file} | Verify the recorded concrete value | 未关闭 |`, '## 结论', '**审查结论**: 不通过',
      ].join('\n'));
      const subject = fixtureSubjectId('opaque-review-issue');
      const templateText = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness/prompts/verify-review.md'), 'utf8');
      const currentMaterial = buildVerifierMaterialView({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE,
        phase, gateFingerprint: null, phaseRuleText: 'review rules', templateText, checks: [], contextFiles: [{ label: file, content: 'export const value = 12;\n' }] });
      writeVerifierMaterial(reportsDir, subject, currentMaterial);
      const published = publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: FEATURE, phase, subjectId: subject, skipSummaryPatch: true });
      const input = { projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: FEATURE, phase, currentSubject: subject,
        findings: [{ id: 'CR-137', files: [file] }], currentMaterial, templateText };
      const loaded = loadVerifierEvidenceForSubject(root, FEATURE, phase, subject, input);
      assert(loaded.ok, 'historical transport PASS can be parsed');
      if (!loaded.ok) return;
      assert(verifierReportItemGaps(input, loaded.evidence).some(gap => gap.startsWith('CR-137：')), 'the actual unanswered issue blocks despite an otherwise valid thin PASS');
      const selected = planVerifierItemReview(input).scope;
      assert(selected.mode === 'partial' && selected.reviewIds.length === 2
        && ['issue_accuracy', 'false_positive_rate'].every(id => selected.reviewIds.includes(id)),
      'the existing review adjudication and its projection cover the concrete issue without reopening unrelated checks');
      const reply = (evidence: string) => loaded.evidence.report_text + '\n```issue-verification\n' + YAML.stringify([{
        issue: 'CR-137', verdict: 'confirmed', repair_owner: 'coding', evidence,
      }]) + '```\n';
      fs.writeFileSync(published.mdPath, reply('Generic confirmation with no actual reference.'));
      const unsupported = loadVerifierEvidenceForSubject(root, FEATURE, phase, subject, input);
      assert(unsupported.ok && verifierReportItemGaps(input, unsupported.evidence).some(gap => gap.startsWith('CR-137：')),
        'a matching issue ID and a generic sentence do not certify the recorded issue');
      fs.writeFileSync(published.mdPath, reply('`src/target.ts:1` Verify the recorded concrete value.'));
      const answered = loadVerifierEvidenceForSubject(root, FEATURE, phase, subject, input);
      assert(answered.ok && !verifierReportItemGaps(input, answered.evidence).some(gap => gap.startsWith('CR-137：')),
        'the concrete current independent answer closes only this diagnosis gap');
    });
  } },
  { name: 'P2 C current material reuses a real FAIL and public baselines never hide it behind an older PASS', fn: () => {
    withHost(({ root, reportsDir }) => {
      const prior = fixtureSubjectId('p2-prior-pass'), failed = fixtureSubjectId('p2-prior-fail'), current = fixtureSubjectId('p2-current');
      const passed = publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: FEATURE, phase: PHASE, subjectId: prior, skipSummaryPatch: true });
      const denied = publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: FEATURE, phase: PHASE, subjectId: failed, verdict: 'FAIL', blockerCount: 1, skipSummaryPatch: true });
      fs.utimesSync(passed.mdPath, new Date(1000), new Date(1000)); fs.utimesSync(denied.mdPath, new Date(2000), new Date(2000));
      const view = material(root);
      for (const subject of [prior, failed, current]) writeVerifierMaterial(reportsDir, subject, view);
      const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
      summary.verifier_subject_id = current; fs.writeFileSync(path.join(reportsDir, 'summary.json'), JSON.stringify(summary));
      assert(findPriorVerifierEvidence(root, FEATURE, PHASE, { excludeSubject: current })?.subject_id === failed, 'latest public denial is the baseline');
      assert(findSameMaterialVerifierEvidence(root, FEATURE, PHASE, current)?.verdict === 'FAIL', 'a repeated check returns the existing real FAIL');
      assert(deriveVerifierClosureRecord(root, FEATURE, PHASE) === null, 'old PASS cannot overwrite current same-material denial');
      writeVerifierMaterial(reportsDir, current, material(root, 'new acceptance semantics'));
      assert(findSameMaterialVerifierEvidence(root, FEATURE, PHASE, current) === null, 'real rule changes require new verification');
    });
  } },
  { name: '① 命中：report_text 是报告全文（不是只剩终态块）', fn: case1_hit },
  { name: '② 四类失败各自独立错误码，恢复话术只指向重跑 verifier', fn: case2_failuresAllPointToRerun },
  { name: '③ summary 无 subject = 本轮没有调用凭证', fn: case3_subjectAbsent },
  { name: '④ 仅同材料原件可复用；缺原件、真实变更或从未 PASS 均不沿用', fn: case4_priorPassReuse },
  { name: '⑤ 闭环后改报告不使 evidence manifest stale', fn: case5_reportNotInManifest },
  { name: '⑥ 终态块格式与生产渲染同源', fn: case6_blockFormatIsShared },
  { name: '⑦ summary.verifier_report 是仓根相对路径，按它能找到报告', fn: case7_reportPointerIsRepoRelative },
  { name: '⑧ 回执投影从 MD 取 report_path/verdict，残留旧 JSON 不被采信', fn: case8_receiptProjectionReadsMarkdown },
  { name: '⑨ 重验账本按 MD 判复用；终态块坏 = 不可复用', fn: case9_revalidateLedgerReadsMarkdown },
  { name: 'B04-V5 沿用既往 PASS 闭环 → goal 快照归档被沿用的报告并标注沿用', fn: caseB04V5_snapshotArchivesReusedReport },
  { name: 'B04-V6 快照回落反例：当前证据优先、从未 PASS 不得凭空回落', fn: caseB04V6_snapshotFallbackGuards },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.fn();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
