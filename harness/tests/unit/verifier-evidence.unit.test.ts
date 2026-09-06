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

import { clearFrameworkConfigCache, featurePhaseReportsDir, resolveReceiptFilePath } from '../../config';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { snapshotPhaseHarness } from '../../scripts/utils/goal-phase-snapshot';
import {
  loadVerifierEvidence,
  loadVerifierEvidenceForSubject,
  deriveVerifierClosureRecord,
  findPriorPassVerifierEvidence,
} from '../../scripts/utils/verifier-evidence';
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

    const closure = deriveVerifierClosureRecord(root, FEATURE, PHASE);
    assert(closure?.mode === 'completed_with_prior_review', `实得 ${closure?.mode ?? 'null'}`);
    assert(closure?.reviewed_subject_id === prior && closure.current_subject_id === current, '两个 subject 都要如实登记');

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
  fs.writeFileSync(
    path.join(reportsDir, 'summary.json'),
    JSON.stringify({
      schema_version: '1.2', phase: PHASE, feature: FEATURE, verdict: 'PASS',
      blocker_count: 0, fail_count: 0, warn_count: 0,
      script_report: 'script-report.json', merged_report: 'merged-report.md',
      summary_json: 'summary.json',
      run_statuses: [], readiness_signals: [], blocking_warnings: [], blocking_skips: [], blockers: [],
      next_action: 'run_receipt', closure_status: 'open', assurance: 'full',
    }, null, 2),
    'utf8',
  );
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

function caseB04V5_snapshotArchivesReusedReport(): void {
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
      ((copied.readiness_signals ?? []) as Array<{ id?: string }>).some(s => s.id === 'semantic_not_reverified'),
      'summary 副本须保留 semantic_not_reverified（材料未重审）',
    );
  });
}

function caseB04V6_snapshotFallbackGuards(): void {
  // ① 当前 subject 自己有验真 PASS 报告 → 取当前证据，不得标沿用（回落不得抢在当前证据之前）
  withClosureHost(({ root, reportsDir }) => {
    const current = fixtureSubjectId('b04-self');
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
    closeWithRealFinalizer(root);
    const snap = snapshotPhaseHarness(root, FEATURE, PHASE as never, RUN_REPORT_DIR, FRAMEWORK_ROOT);
    assert(snap.verifier_evidence === null, `从未 PASS 过不得回落出证据：${JSON.stringify(snap.verifier_evidence)}`);
    assert(snap.snapshot_files['verifier.report.md'] === null, '不得归档一份 FAIL 或不存在的报告');
  });
}

const CASES: Array<{ name: string; fn: () => void }> = [
  { name: '① 命中：report_text 是报告全文（不是只剩终态块）', fn: case1_hit },
  { name: '② 四类失败各自独立错误码，恢复话术只指向重跑 verifier', fn: case2_failuresAllPointToRerun },
  { name: '③ summary 无 subject = 本轮没有调用凭证', fn: case3_subjectAbsent },
  { name: '④ 既往 PASS 沿用 + 未重审材料如实登记；从未 PASS 不沿用', fn: case4_priorPassReuse },
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
