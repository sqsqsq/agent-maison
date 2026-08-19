// ============================================================================
// repair-candidates.unit.test.ts — 责任阶段统一路由的共享事实层（plan b6e4c9f2 t1）
// 信任合取（逐条 verifier 验证/conditional receipt 抑制/负面两分支）、两层指纹、
// CorrectionCategory 归属（机器 check id 优先 + 路径域兜底 + 宁缺毋滥）。
// ============================================================================

import {
  buildSummaryRepairCandidates,
  collectPhaseRepairCandidates,
  collectReviewRepairCandidates,
  checkOwnedCandidate,
  deriveCategoryFromFiles,
  itemFingerprintOf,
  parseIssueVerificationBlock,
  parseVerifierCheckStatus,
  resolveInvalidatablePhases,
  restoreBacktrackCandidatesFromEvents,
  roundFingerprintOfCandidates,
  validateRepairCandidatesShape,
} from '../../scripts/utils/repair-candidates';
import { mapCategoryToChainPhase } from '../../scripts/utils/correction-routing';
import { selectRunnerActionFromAssess } from '../../scripts/utils/goal-assess-driver';
import { recommendationAuthorized } from '../../scripts/utils/goal-in-session-driver';
import { formatRepairCandidatesMenu } from '../../scripts/utils/assess-renderer';
import type { AssessRecommendation, AssessResult, ReconcileObservationV1 } from '../../scripts/utils/assess';
import type { UnitCaseResult } from '../run-unit';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 生产同构 review 报告（问题清单表 + 结论段） */
function reviewReport(opts: {
  verdict: string;
  rows: Array<{ id: string; sev: string; state: string; files: string; fix: string }>;
}): string {
  const rows = opts.rows
    .map(r => `| ${r.id} | ${r.sev} | 逻辑错误 | ${r.files} | ${r.fix} | ${r.state} |`)
    .join('\n');
  return [
    '# Review 报告', '',
    '## 问题清单', '',
    '| ID | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |',
    '|---|---|---|---|---|---|',
    rows, '',
    '## 结论', '',
    `结论：${opts.verdict}`, '',
  ].join('\n');
}

/** 无 evidence 的旧格式块（新鲜度判据下不被采信——R8.6 负例专用） */
function verifierWith(entries: Array<{ id: string; verdict: string }>): string {
  return [
    '# Verifier 报告', '',
    '```issue-verification',
    ...entries.flatMap(e => [`- issue: ${e.id}`, `  verdict: ${e.verdict}`]),
    '```', '',
  ].join('\n');
}

/** 带 evidence 的当前轮格式（evidence 绑定该 CR 的涉及文件——生产 prompt 契约） */
function verifierFresh(entries: Array<{ id: string; verdict: string; evidence: string }>): string {
  return [
    '# Verifier 报告', '',
    '```issue-verification',
    ...entries.flatMap(e => [`- issue: ${e.id}`, `  verdict: ${e.verdict}`, `  evidence: ${e.evidence}`]),
    '```', '',
  ].join('\n');
}

const CR1 = { id: 'CR-001', sev: 'MAJOR', state: '未关闭', files: '`02-Feature/F/src/main/ets/SelectBankCardPage.ets`', fix: '补 onDisappear 复位状态机' };
const CR2 = { id: 'CR-002', sev: 'MAJOR', state: '未关闭', files: '02-Feature/F/src/main/ets/OpenCardFlow.ets', fix: '消费 upsertCard 的 duplicated 字段并提示' };
const CR3 = { id: 'CR-003', sev: 'MAJOR', state: '未关闭', files: '02-Feature/F/src/main/ets/BankCardRepository.ets', fix: 'catch 块补 Logger.error' };

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  // --- 指纹两层 -----------------------------------------------------------

  run(results, 'item_fingerprint：编号/文件/摘要任一变化即变；规范化（顺序/空白）不影响', () => {
    const a = itemFingerprintOf('CR-001', ['b.ets', 'a.ets'], '修复  X');
    const b = itemFingerprintOf('CR-001', ['a.ets', 'b.ets'], '修复 X');
    assert(a === b, '文件顺序与空白规范化后应同指纹');
    assert(itemFingerprintOf('CR-002', ['a.ets', 'b.ets'], '修复 X') !== a, '编号变化应变指纹');
    assert(itemFingerprintOf('CR-001', ['a.ets'], '修复 X') !== a, '文件集变化应变指纹');
  });

  run(results, 'round_fingerprint：CR-001/002/003 与 +CR-014 集合不同；原样重现相同（熔断可比）', () => {
    const mk = (id: string) => ({ item_fingerprint: itemFingerprintOf(id, ['a.ets'], 'fix') });
    const round1 = roundFingerprintOfCandidates([mk('CR-001'), mk('CR-002'), mk('CR-003')]);
    const round1Replay = roundFingerprintOfCandidates([mk('CR-003'), mk('CR-001'), mk('CR-002')]);
    const round2 = roundFingerprintOfCandidates([mk('CR-014')]);
    assert(round1 === round1Replay, '同集合（乱序）应同整轮指纹——熔断判据');
    assert(round1 !== round2, '新缺陷集合应产生不同整轮指纹——允许再次回退');
  });

  // --- 归属推导（路径域兜底） --------------------------------------------

  run(results, '路径域归属：spec 件→spec；plan 件→plan；源码→coding；混合/空→null', () => {
    assert(deriveCategoryFromFiles(['doc/features/f/spec/ui-spec.yaml']) === 'spec', 'spec 目录');
    assert(deriveCategoryFromFiles(['doc/features/f/acceptance.yaml']) === 'spec', 'acceptance');
    assert(deriveCategoryFromFiles(['doc/features/f/contracts.yaml']) === 'plan', 'contracts');
    assert(deriveCategoryFromFiles(['doc/features/f/plan/plan.md']) === 'plan', 'plan 目录');
    assert(deriveCategoryFromFiles(['02-Feature/F/src/main/ets/A.ets']) === 'coding', '产品源码');
    assert(deriveCategoryFromFiles(['02-Feature/F/src/A.ets', 'doc/features/f/spec/spec.md']) === null, '混合域不产');
    assert(deriveCategoryFromFiles([]) === null, '空清单不产');
  });

  // --- 逐条验证块解析 -----------------------------------------------------

  run(results, 'issue-verification 块：合法解析/缺块 fail-closed/非法 verdict 归 unclear', () => {
    const ok = parseIssueVerificationBlock(verifierWith([
      { id: 'CR-001', verdict: 'confirmed' }, { id: 'CR-002', verdict: 'REFUTED' },
      { id: 'CR-003', verdict: 'maybe' },
    ]));
    assert(ok.ok && ok.entries.length === 3, `应解析 3 条：${JSON.stringify(ok)}`);
    assert(ok.entries[0].verdict === 'confirmed' && ok.entries[1].verdict === 'refuted', '大小写归一');
    assert(ok.entries[2].verdict === 'unclear', '非法值归 unclear（不产候选）');
    assert(!parseIssueVerificationBlock('# 报告无块').ok, '缺块 fail-closed');
    assert(!parseIssueVerificationBlock('').ok, '空文本 fail-closed');
  });

  run(results, 'verifier check 状态宽松解析（ut device_ac_delegation 消费）', () => {
    const text = ['checks:', '  - id: device_ac_delegation', '    status: FAIL', '  - id: other', '    status: PASS'].join('\n');
    assert(parseVerifierCheckStatus(text, 'device_ac_delegation') === 'FAIL', 'FAIL 解析');
    assert(parseVerifierCheckStatus(text, 'other') === 'PASS', 'PASS 解析');
    assert(parseVerifierCheckStatus(text, 'missing') === null, '缺席 null');
  });

  // --- review 侧信任合取 --------------------------------------------------

  const fullTrust = {
    conditionalReceiptValid: false,
    reportValidityBlocked: false,
  };

  run(results, 'review 正例：有条件通过+open MAJOR+逐条 confirmed → 三条 coding 候选', () => {
    const out = collectReviewRepairCandidates({
      ...fullTrust,
      reportText: reviewReport({ verdict: '有条件通过', rows: [CR1, CR2, CR3] }),
      // evidence 契约：`<涉及文件名> | <该行修复建议原文>`（原样复制，非概括）
      verifierReportText: verifierFresh([
        { id: 'CR-001', verdict: 'confirmed', evidence: `SelectBankCardPage.ets | ${CR1.fix}` },
        { id: 'CR-002', verdict: 'confirmed', evidence: `OpenCardFlow.ets | ${CR2.fix}` },
        { id: 'CR-003', verdict: 'confirmed', evidence: `BankCardRepository.ets | ${CR3.fix}` },
      ]),
    });
    assert(out.length === 3, `应产 3 条：${JSON.stringify(out.map(c => c.id))}`);
    assert(out.every(c => c.category === 'coding'), '产品源码缺陷归 coding');
    assert(out.every(c => /^[0-9a-f]{64}$/.test(c.item_fingerprint)), 'item 指纹成形');
  });

  run(results, 'review 负面分支：「不通过」+open BLOCKER 同样产候选（洞①对齐）', () => {
    const out = collectReviewRepairCandidates({
      ...fullTrust,
      reportText: reviewReport({ verdict: '不通过', rows: [{ ...CR1, sev: 'BLOCKER' }] }),
      verifierReportText: verifierFresh([
        { id: 'CR-001', verdict: 'confirmed', evidence: `SelectBankCardPage.ets | ${CR1.fix}` },
      ]),
    });
    assert(out.length === 1 && out[0].id === 'CR-001', `不通过分支应产：${JSON.stringify(out)}`);
  });

  run(results, 'review 逐条验证缺一不产：refuted/unclear/未列入块/整块缺失 → 零候选', () => {
    const report = reviewReport({ verdict: '有条件通过', rows: [CR1, CR2, CR3] });
    const partial = collectReviewRepairCandidates({
      ...fullTrust, reportText: report,
      verifierReportText: verifierWith([
        { id: 'CR-001', verdict: 'refuted' }, { id: 'CR-002', verdict: 'unclear' },
      ]),
    });
    assert(partial.length === 0, `refuted/unclear/未列（CR-003）都不得产：${JSON.stringify(partial)}`);
    assert(
      collectReviewRepairCandidates({ ...fullTrust, reportText: report, verifierReportText: '# 无块' }).length === 0,
      '无逐条验证块=全部未验证=零候选（抽样全局 PASS 不算数）',
    );
    assert(
      collectReviewRepairCandidates({ ...fullTrust, reportText: report, verifierReportText: null }).length === 0,
      'verifier 报告缺失=零候选',
    );
  });

  run(results, 'review 抑制条件：conditional receipt 有效/报告不可信/结论「通过」/已关闭行', () => {
    const report = reviewReport({ verdict: '有条件通过', rows: [CR1] });
    const verifier = verifierWith([{ id: 'CR-001', verdict: 'confirmed' }]);
    assert(
      collectReviewRepairCandidates({
        reportText: report, verifierReportText: verifier,
        conditionalReceiptValid: true, reportValidityBlocked: false,
      }).length === 0,
      '有效 receipt=人已显式接受风险，抑制自动回退',
    );
    assert(
      collectReviewRepairCandidates({
        reportText: report, verifierReportText: verifier,
        conditionalReceiptValid: false, reportValidityBlocked: true,
      }).length === 0,
      '报告不可信=零候选',
    );
    assert(
      collectReviewRepairCandidates({
        ...fullTrust, verifierReportText: verifier,
        reportText: reviewReport({ verdict: '通过', rows: [CR1] }),
      }).length === 0,
      '结论「通过」不产候选',
    );
    assert(
      collectReviewRepairCandidates({
        ...fullTrust, verifierReportText: verifier,
        reportText: reviewReport({ verdict: '有条件通过', rows: [{ ...CR1, state: '已关闭' }] }),
      }).length === 0,
      '已关闭行不产候选',
    );
  });

  run(results, 'review 归属兜底：MINOR 不产；混合域涉及文件不产（宁缺毋滥）', () => {
    const out = collectReviewRepairCandidates({
      ...fullTrust,
      reportText: reviewReport({ verdict: '有条件通过', rows: [
        { ...CR1, sev: 'MINOR' },
        { ...CR2, files: '02-Feature/F/src/A.ets doc/features/f/spec/spec.md' },
      ] }),
      verifierReportText: verifierWith([
        { id: 'CR-001', verdict: 'confirmed' }, { id: 'CR-002', verdict: 'confirmed' },
      ]),
    });
    assert(out.length === 0, `MINOR 与混合域都不得产：${JSON.stringify(out)}`);
  });

  // --- 机器 check id 归属 --------------------------------------------------

  run(results, '机器归属注册表：三锁定例 + ui_scope_violation 带产品源码文件仍归 plan + 未注册 null', () => {
    assert(checkOwnedCandidate({ checkId: 'scope_consistency_with_spec', sourcePhase: 'plan', detail: 'x' })?.category === 'spec', 'scope→spec');
    assert(checkOwnedCandidate({ checkId: 'device_ac_delegation', sourcePhase: 'ut', detail: 'x' })?.category === 'spec', 'device_ac→spec');
    const scope = checkOwnedCandidate({
      checkId: 'ui_scope_violation', sourcePhase: 'coding', detail: 'x',
      affectedFiles: ['01-Product/WalletMain/src/main/ets/pages/HomeTabPage.ets'],
    });
    assert(scope?.category === 'plan', 'ui_scope_violation 即使 affected_files 是产品源码也归 plan（机器归属优先于路径兜底）');
    assert(checkOwnedCandidate({ checkId: 'unknown_check', sourcePhase: 'x', detail: 'x' }) === null, '未注册 id 不产');
  });

  // --- 阶段级组装 ----------------------------------------------------------

  run(results, '组装闸（c7e4a2d9）：report_validity 只抑制 review 自由文本候选；机器 check / verifier 合取候选存活', () => {
    // review 候选依赖报告内容：report invalid → 仍零候选
    const review = collectPhaseRepairCandidates({
      phase: 'review',
      reviewReportText: reviewReport({ verdict: '有条件通过', rows: [CR1] }),
      verifierReportText: verifierWith([{ id: 'CR-001', verdict: 'confirmed' }]),
      reportValidity: 'FAIL',
      conditionalReceiptValid: false,
      checks: [],
    });
    assert(review.length === 0, '报告不可信 → review 自由文本候选被抑制');
    // 机器 check 候选（plan 生产点）：report invalid 不得清空
    const plan = collectPhaseRepairCandidates({
      phase: 'plan', reviewReportText: null, verifierReportText: null,
      reportValidity: 'FAIL', conditionalReceiptValid: false,
      checks: [{ id: 'scope_consistency_with_spec', status: 'FAIL', details: 'spec Scope 无法解析' }],
    });
    assert(plan.length === 1 && plan[0].category === 'spec', `机器候选不受报告结论抑制：${JSON.stringify(plan)}`);
    // verifier 合取候选（ut product assertion）：report invalid 同样存活
    const ut = collectPhaseRepairCandidates({
      phase: 'ut', reviewReportText: null,
      verifierReportText: [
        '  - id: end_to_end_driving', '    status: PASS',
        '  - id: business_assertion_value', '    status: PASS',
      ].join('\n'),
      reportValidity: 'FAIL', conditionalReceiptValid: false,
      checks: [{
        id: 'ut_hvigor_test', status: 'FAIL', severity: 'BLOCKER',
        classification: 'code_regression', details: '断言失败',
        affected_files: ['02-Feature/F/src/main/ets/BankCardRepository.ets'],
      }],
    });
    assert(ut.length === 1 && ut[0].category === 'coding', 'verifier 合取候选不得被负面结论整体清空');
  });

  run(results, '组装生产点：plan scope FAIL→spec；ut verifier device_ac FAIL→spec；coding scope 越界→plan', () => {
    const plan = collectPhaseRepairCandidates({
      phase: 'plan', reviewReportText: null, verifierReportText: null,
      reportValidity: 'PASS', conditionalReceiptValid: false,
      checks: [{ id: 'scope_consistency_with_spec', status: 'FAIL', details: 'spec Scope 无法解析' }],
    });
    assert(plan.length === 1 && plan[0].category === 'spec' && plan[0].source_phase === 'plan', `plan 生产点：${JSON.stringify(plan)}`);
    const ut = collectPhaseRepairCandidates({
      phase: 'ut', reviewReportText: null,
      verifierReportText: '  - id: device_ac_delegation\n    status: FAIL',
      reportValidity: 'PASS', conditionalReceiptValid: false, checks: [],
    });
    assert(ut.length === 1 && ut[0].category === 'spec' && ut[0].source_phase === 'ut', `ut 生产点：${JSON.stringify(ut)}`);
    const coding = collectPhaseRepairCandidates({
      phase: 'coding', reviewReportText: null, verifierReportText: null,
      reportValidity: 'PASS', conditionalReceiptValid: false,
      checks: [{ id: 'ui_diff_within_declared_files', status: 'FAIL', classification: 'ui_scope_violation', details: '越界 2 文件', affected_files: ['a.ets'] }],
    });
    assert(coding.length === 1 && coding[0].category === 'plan', `coding 生产点：${JSON.stringify(coding)}`);
  });

  run(results, 'c7e4a2d9 testing 生产点：p0_coverage_integrity FAIL+code_regression 合取 → coding 候选（report_validity=FAIL 仍存活）；仅 FAIL 不产；envBlocked 不误投', () => {
    // 事故组合（bc-openCard TC-018）：经生产 writer 共享实现 buildSummaryRepairCandidates
    // （与 harness-runner summary writer 同一函数），report_validity=FAIL 输入=真实事故条件
    const produced = buildSummaryRepairCandidates({
      phase: 'testing',
      reportValidity: 'FAIL',
      reviewReportText: null, verifierReportText: null,
      conditionalReceiptValid: false,
      checks: [{
        id: 'p0_coverage_integrity', status: 'FAIL', severity: 'BLOCKER',
        details: 'P0 用例被跳过且无有效凭证 waiver（1）：TC-018。\n全分母口径：P0 执行通过 15/16',
        failure_kind: 'code_regression',
      }],
    });
    assert(produced.length === 1, `P0 机器合取应产 1 条候选：${JSON.stringify(produced)}`);
    assert(produced[0].id === 'p0_coverage_integrity' && produced[0].category === 'coding', 'id/类别');
    assert(produced[0].source_phase === 'testing', 'source_phase');
    assert(/^[0-9a-f]{64}$/.test(produced[0].item_fingerprint), '指纹形状');
    // 同 check 仅 FAIL、无 code_regression → 不产 coding 候选（status 为空/未登记 skip 留 testing）
    const noKind = buildSummaryRepairCandidates({
      phase: 'testing', reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
      conditionalReceiptValid: false,
      checks: [{ id: 'p0_coverage_integrity', status: 'FAIL', severity: 'BLOCKER', details: 'TC-014 status 为空' }],
    });
    assert(noKind.length === 0, '无 code_regression 合取不得产 coding 候选');
    // 报告散文自称 external、无机器 envBlocked 信号 → 不抑制 explicit-only 机器候选
    const proseExternal = buildSummaryRepairCandidates({
      phase: 'testing', reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
      conditionalReceiptValid: false,
      checks: [{
        id: 'p0_coverage_integrity', status: 'FAIL', severity: 'BLOCKER',
        details: 'TC-018 explicit skip；报告自称外部环境阻塞',
        failure_kind: 'code_regression',
      }],
    });
    assert(proseExternal.length === 1, '无机器 envBlocked 信号时报告散文不得抑制机器候选');
    // 机器 envBlocked 归因（toolchain 等）→ 不产 coding 候选（runner 侧 envBlocked 前置 + 既有 DEFERRED）
    const envBlocked = collectPhaseRepairCandidates({
      phase: 'testing', reviewReportText: null, verifierReportText: null,
      reportValidity: 'PASS', conditionalReceiptValid: false,
      checks: [{
        id: 'p0_coverage_integrity', status: 'FAIL', severity: 'BLOCKER',
        classification: 'toolchain', details: '设备不可用',
      }],
    });
    assert(envBlocked.length === 0, 'envBlocked 归因不产 coding 候选（走既有 DEFERRED）');
  });

  // --- summary 形状校验 ----------------------------------------------------

  run(results, 'summary 形状校验：缺失合法；非法 category/指纹报错', () => {
    assert(validateRepairCandidatesShape(undefined).length === 0, '缺失合法');
    const good = checkOwnedCandidate({ checkId: 'ui_scope_violation', sourcePhase: 'coding', detail: 'x' })!;
    assert(validateRepairCandidatesShape([good]).length === 0, '合法条目过');
    assert(validateRepairCandidatesShape([{ ...good, category: 'verification' }]).length > 0, 'verification 不是回退类别');
    assert(validateRepairCandidatesShape([{ ...good, item_fingerprint: 'short' }]).length > 0, '坏指纹报错');
    assert(validateRepairCandidatesShape('nope').length > 0, '非数组报错');
  });

  // --- t2：workflow 严格映射 / 失效面 / driver 泛化 ------------------------

  run(results, 'mapCategoryToChainPhase 严格四态：full/lite/custom 缺节点→null（禁回链首）', () => {
    const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    assert(mapCategoryToChainPhase('spec', FULL, 'full') === 'spec', 'full spec');
    assert(mapCategoryToChainPhase('verification', FULL, 'full') === 'ut', 'full verification→ut');
    const LITE = ['change', 'coding', 'exit'];
    assert(mapCategoryToChainPhase('spec', LITE, 'lite') === 'change', 'lite spec→change');
    assert(mapCategoryToChainPhase('plan', LITE, 'lite') === 'change', 'lite plan→change');
    const CUSTOM = ['coding', 'review', 'testing'];
    assert(mapCategoryToChainPhase('spec', CUSTOM, 'full') === null, 'custom 缺 spec→null，不得回 chain[0]');
    assert(mapCategoryToChainPhase('plan', CUSTOM, 'full') === null, 'custom 缺 plan→null');
    assert(mapCategoryToChainPhase('coding', CUSTOM, 'full') === 'coding', 'custom 有 coding');
  });

  run(results, 'resolveInvalidatablePhases：最上游目标及其下游；映射不到=空（target absent）', () => {
    const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    assert(
      JSON.stringify(resolveInvalidatablePhases({ chain: FULL, hasActionable: false, candidateCategories: ['coding'], track: 'full' }))
        === JSON.stringify(['coding', 'review', 'ut', 'testing']),
      'coding 目标级联下游',
    );
    assert(
      JSON.stringify(resolveInvalidatablePhases({ chain: FULL, hasActionable: false, candidateCategories: ['coding', 'spec'], track: 'full' }))
        === JSON.stringify(FULL),
      'mixed-owner 取最上游（spec）',
    );
    assert(
      resolveInvalidatablePhases({ chain: ['coding', 'testing'], hasActionable: false, candidateCategories: ['spec'], track: 'full' }).length === 0,
      '目标不在链内=空（driver 判 target absent）',
    );
    assert(
      JSON.stringify(resolveInvalidatablePhases({ chain: FULL, hasActionable: true, candidateCategories: [], track: 'full' }))
        === JSON.stringify(['coding', 'review', 'ut', 'testing']),
      'testing 特例保持',
    );
  });

  run(results, 'driver 泛化：candidates+invalidatable→backtrack_to_phase；无 candidates→halt；目标缺席保留意图', () => {
    const mkAssess = (phase: string | null): AssessResult => ({
      recommendation: {
        action: 'rerun_phase', phase, reason: 'x',
        requires_driver_authorization: true, runner_action: 'backtrack_to_phase',
      },
      stop: { fused: false },
    } as unknown as AssessResult);
    const obs = (over: Partial<ReconcileObservationV1>): ReconcileObservationV1 => ({
      schema_version: '1.0', state: 'active', residual_fingerprints: [],
      phase_outcome: { phase: 'review', verdict: 'FAIL', legacy_action: 'retry' },
      ...over,
    } as ReconcileObservationV1);
    const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    assert(
      selectRunnerActionFromAssess({
        assessment: mkAssess('coding'),
        observation: obs({ invalidatable_phases: ['coding', 'review', 'ut', 'testing'] }),
        currentPhase: 'review', chain, driverGuardAction: 'none',
      }) === 'backtrack_to_phase',
      'earlier+assess 回退意图+失效面覆盖 → backtrack_to_phase',
    );
    assert(
      selectRunnerActionFromAssess({
        assessment: mkAssess(null),
        observation: obs({}),
        currentPhase: 'review', chain, driverGuardAction: 'none',
      }) === 'backtrack_to_phase',
      'phase:null（映射失败）保留回退意图——runner 落 backtrack_target_absent',
    );
    assert(
      selectRunnerActionFromAssess({
        assessment: mkAssess('spec'),
        observation: obs({ invalidatable_phases: [] }),
        currentPhase: 'review', chain, driverGuardAction: 'none',
      }) === 'halt',
      '失效面不覆盖目标 → halt（不无保护回退）',
    );
  });

  // --- t3：batch 授权区间下界 / manual 菜单 -------------------------------

  run(results, 'batch 授权区间：[start_phase, through_phase] 内自动、外转 manual、缺下界 fail-closed', () => {
    const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const rec = (phase: string | null): AssessRecommendation => ({
      action: 'rerun_phase', phase, reason: 'x',
      requires_driver_authorization: true, runner_action: 'backtrack_to_phase',
    } as AssessRecommendation);
    const batch = { mode: 'batch_authorized' as const, through_phase: 'testing' };
    assert(
      recommendationAuthorized(rec('coding'), batch, chain, { startPhase: 'coding' }) === true,
      '授权 coding→testing：review 回 coding 允许自动',
    );
    assert(
      recommendationAuthorized(rec('plan'), batch, chain, { startPhase: 'coding' }) === false,
      '同一授权：回 plan 超下界，转 manual',
    );
    assert(
      recommendationAuthorized(rec('spec'), batch, chain, { startPhase: 'coding' }) === false,
      '回 spec 同样超下界',
    );
    assert(
      recommendationAuthorized(rec('coding'), batch, chain, {}) === false,
      '缺 startPhase（无授权起点记录）fail-closed 不自动回退',
    );
    assert(
      recommendationAuthorized(rec('coding'), { mode: 'manual' }, chain, { startPhase: 'coding' }) === false,
      'manual 恒不自动执行',
    );
    // custom 链按实际顺序判断（不用固定全轨序）
    const custom = ['coding', 'review', 'testing'];
    assert(
      recommendationAuthorized(rec('coding'), { mode: 'batch_authorized', through_phase: 'testing' }, custom, { startPhase: 'coding' }) === true,
      'custom 链区间判定按实际 chain',
    );
  });

  run(results, 'manual 菜单：候选来自 assess 观测（同一真源）；goal 模式或零候选不渲染', () => {
    const mkResult = (candidates: unknown[]): Parameters<typeof formatRepairCandidatesMenu>[0] => ({
      observed: {
        phases: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].map(p => ({
          phase: p, ...(p === 'review' && candidates.length > 0 ? { repair_candidates: candidates } : {}),
        })),
      },
      track: 'full',
    } as unknown as Parameters<typeof formatRepairCandidatesMenu>[0]);
    const cand = { id: 'CR-001', category: 'coding', item_fingerprint: 'a'.repeat(64), summary: '半模态状态机未复位' };
    const menu = formatRepairCandidatesMenu(mkResult([cand]), { phase: 'review', mode: 'manual' });
    assert(menu !== null && menu.includes('责任阶段为 coding') && menu.includes('1. 返回 coding 修复'), `菜单应渲染：${menu}`);
    assert(menu!.includes('CR-001'), '菜单应列出候选');
    assert(
      formatRepairCandidatesMenu(mkResult([cand]), { phase: 'review', mode: 'goal_mode' }) === null,
      'goal 模式不渲染菜单（自动路径承载）',
    );
    assert(
      formatRepairCandidatesMenu(mkResult([]), { phase: 'review', mode: 'manual' }) === null,
      '零候选不渲染',
    );
  });

  // --- t4：决策链组合级验收（观测→assess→driver） -------------------------

  run(results, '验收①同构：review 三候选 → assess 推荐 rerun_phase:coding（backtrack_to_phase），不再 rerun_phase:review', () => {
    const { assessObservation } = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
    const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const mkPhase = (p: string) => ({
      phase: p, summary_state: 'current' as const, schema_version: '1.2', verdict: p === 'review' ? 'FAIL' : 'PASS',
      closure: 'closed' as const, assurance: 'full', required_assurance: null, assurance_satisfied: true,
      deferred: false, summary_fingerprint: 'x', evidence_fingerprint: 'x',
    });
    const cands = ['CR-001', 'CR-002', 'CR-003'].map(id => ({
      id, category: 'coding' as const, item_fingerprint: itemFingerprintOf(id, ['a.ets'], 'fix'),
    }));
    // 候选挂在 **phase 观测**（唯一真源=summary），不再经 reconcile 复制
    const observation = {
      schema_version: '1.0' as const, feature: 'f1', workflow: 'wf', track: 'full' as const,
      goal_end: 'testing',
      phases: FULL.map(p => (p === 'review' ? { ...mkPhase(p), repair_candidates: cands } : mkPhase(p))),
      fingerprints: { workflow: 'w', track: 't', goal: 'g', run_attempt: 'r', summaries: 's', evidence: 'e', reconcile: 'rc', observed: 'o' },
      reconcile: {
        schema_version: '1.0' as const, state: 'active' as const, residual_fingerprints: [],
        phase_outcome: { phase: 'review', verdict: 'FAIL', legacy_action: 'retry' },
        invalidatable_phases: ['coding', 'review', 'ut', 'testing'],
        budgets: { retries_used: 0, backtracks_used: 0 },
      },
    };
    const result = assessObservation(observation as never, { mode: 'goal_mode' });
    assert(
      result.recommendation.action === 'rerun_phase' && result.recommendation.phase === 'coding',
      `应推荐 rerun_phase:coding（不再原地 review），实得 ${result.recommendation.action}:${result.recommendation.phase}`,
    );
    assert(result.recommendation.runner_action === 'backtrack_to_phase', 'runner_action 应为 backtrack_to_phase');
    assert(
      selectRunnerActionFromAssess({
        assessment: result, observation: observation.reconcile as never,
        currentPhase: 'review', chain: FULL, driverGuardAction: 'none',
      }) === 'backtrack_to_phase',
      'driver 应放行回退',
    );
  });

  run(results, 'v23 F1 保证不丢：**PASS + 可信候选**仍须回退（best_effort 档视觉缺陷=WARN、verdict=PASS 的回修环可达性）', () => {
    const { assessObservation } = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
    const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const observation = {
      schema_version: '1.0' as const, feature: 'f1', workflow: 'wf', track: 'full' as const,
      goal_end: 'testing',
      phases: FULL.map(p => ({
        phase: p, summary_state: 'current' as const, schema_version: '1.2',
        // 关键：testing **verdict=PASS**（best_effort 下视觉缺陷只 WARN）
        verdict: 'PASS', closure: 'closed' as const,
        assurance: 'full', required_assurance: null, assurance_satisfied: true, deferred: false,
        summary_fingerprint: 'x', evidence_fingerprint: 'x',
        ...(p === 'testing'
          ? {
              repair_candidates: [{
                id: 'visual_diff:add_card_home', category: 'coding' as const,
                item_fingerprint: 'e'.repeat(64), summary: 'must_fix 原文',
              }],
            }
          : {}),
      })),
      fingerprints: { workflow: 'w', track: 't', goal: 'g', run_attempt: 'r', summaries: 's', evidence: 'e', reconcile: 'rc', observed: 'o' },
      reconcile: {
        schema_version: '1.0' as const, state: 'active' as const, residual_fingerprints: [],
        phase_outcome: { phase: 'testing', verdict: 'PASS', legacy_action: 'advance' },
        invalidatable_phases: ['coding', 'review', 'ut', 'testing'],
        budgets: { retries_used: 0, backtracks_used: 0 },
      },
    };
    const result = assessObservation(observation as never, { mode: 'goal_mode' });
    assert(
      result.recommendation.phase === 'coding' && result.recommendation.runner_action === 'backtrack_to_phase',
      `PASS+候选必须回退 coding（旧 v23 F1 教训的新归宿），实得 ${result.recommendation.action}:${result.recommendation.phase}/${result.recommendation.runner_action}`,
    );
    assert(
      selectRunnerActionFromAssess({
        assessment: result, observation: observation.reconcile as never,
        currentPhase: 'testing', chain: FULL, driverGuardAction: 'advance',
      }) === 'backtrack_to_phase',
      'driver 不得把 PASS+候选放行为 advance',
    );
  });

  run(results, '上游件目标：plan 的 spec 候选 → 推荐 spec；lite 轨映射 change（无幽灵 spec）', () => {
    const { assessObservation } = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
    const mk = (phases: string[], track: 'full' | 'lite', current: string) => ({
      schema_version: '1.0' as const, feature: 'f1', workflow: 'wf', track,
      goal_end: phases[phases.length - 1], phases: phases.map(p => ({
        phase: p, summary_state: 'current' as const, schema_version: '1.2', verdict: 'PASS',
        closure: 'closed' as const, assurance: 'full', required_assurance: null, assurance_satisfied: true,
        deferred: false, summary_fingerprint: 'x', evidence_fingerprint: 'x',
        ...(p === current
          ? { repair_candidates: [{ id: 'scope_consistency_with_spec', category: 'spec' as const, item_fingerprint: 'a'.repeat(64) }] }
          : {}),
      })),
      fingerprints: { workflow: 'w', track: 't', goal: 'g', run_attempt: 'r', summaries: 's', evidence: 'e', reconcile: 'rc', observed: 'o' },
      reconcile: {
        schema_version: '1.0' as const, state: 'active' as const, residual_fingerprints: [],
        phase_outcome: { phase: current, verdict: 'FAIL', legacy_action: 'retry' },
        invalidatable_phases: phases,
        budgets: { retries_used: 0, backtracks_used: 0 },
      },
    });
    const full = assessObservation(mk(['spec', 'plan', 'coding', 'review', 'ut', 'testing'], 'full', 'plan') as never, { mode: 'goal_mode' });
    assert(full.recommendation.phase === 'spec', `full 轨 spec 候选应推荐 spec，实得 ${full.recommendation.phase}`);
    const lite = assessObservation(mk(['change', 'coding', 'exit'], 'lite', 'coding') as never, { mode: 'goal_mode' });
    assert(lite.recommendation.phase === 'change', `lite 轨 spec 候选应映射 change（无幽灵 spec），实得 ${lite.recommendation.phase}`);
  });

  // --- R8：生产接线级回归（codex review 冻结项⑧——纯函数测试盖不住路径/schema/链路） ---

  run(results, 'R8.1 正式 review 路径：review/review-report.md → 生产读取 → 候选 → summary schema 校验通过', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-prod-'));
    try {
      // ① 报告落**canonical 正式路径**（<feature>/review/review-report.md）——手拼
      //    <feature>/review-report.md 的实现会读成 null（本条即该假绿的判别）
      const reviewDir = path.join(root, 'doc', 'features', 'f1', 'review');
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(
        path.join(reviewDir, 'review-report.md'),
        reviewReport({ verdict: '有条件通过', rows: [CR1] }),
        'utf-8',
      );
      const { resolveFeatureArtifact, clearFrameworkConfigCache } = require('../../config') as typeof import('../../config');
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.1', project_name: 'T',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        architecture: {
          outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
          module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features', docs_committed: false },
        materialized_adapters: ['cursor'],
      }));
      clearFrameworkConfigCache();
      // ② 走**生产 resolver**（harness-runner 同一入口），证明正式路径可读
      const resolved = resolveFeatureArtifact(root, 'f1', 'review-report.md');
      assert(resolved.exists, `正式 review 报告须被 artifact resolver 解析到：${resolved.canonicalPath}`);
      const reportText = fs.readFileSync(resolved.actualPath, 'utf-8');
      // ③ 组装候选：走 **summary writer 的共享实现**（harness-runner 调同一函数）
      const candidates = buildSummaryRepairCandidates({
        phase: 'review', reviewReportText: reportText,
        verifierReportText: verifierFresh([
          { id: 'CR-001', verdict: 'confirmed', evidence: 'SelectBankCardPage.ets 补 onDisappear 复位状态机' },
        ]),
        reportValidity: 'PASS', conditionalReceiptValid: false, checks: [],
      });
      assert(candidates.length === 1 && candidates[0].category === 'coding', `应产 coding 候选：${JSON.stringify(candidates)}`);
      // ④ 落进 summary 后必须过**正式 JSON schema**（additionalProperties:false 下）——
      //    用 check-receipt 同一把尺（lite-json-schema，仓内无 ajv 依赖）
      const { validateLiteSchema } = require('../../scripts/utils/lite-json-schema') as typeof import('../../scripts/utils/lite-json-schema');
      const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'summary.schema.json'), 'utf-8'));
      const summary = {
        schema_version: '1.2', phase: 'review', feature: 'f1', verdict: 'FAIL',
        blocker_count: 1, fail_count: 1, warn_count: 0,
        report_validity: 'PASS',
        quality_axes: Object.fromEntries(['functional', 'visual', 'asset', 'evidence'].map(axis => [axis, {
          applicable: true, required_for_release: true, verdict: 'PASS',
          blocking_class: null, source_checks: [], resolution: null,
        }])),
        release_readiness: 'BLOCKED', completion_status: 'blocked',
        script_report: 'a', merged_report: 'b', ai_prompt: 'c', summary_json: 'd',
        run_statuses: [], readiness_signals: [], blocking_warnings: [], blocking_skips: [], blockers: [],
        next_action: 'x', closure_status: 'open', assurance: 'full',
        capability_resolutions: [], capability_resolution_contract_fingerprint: null,
        repair_candidates: candidates,
      };
      const violations = validateLiteSchema(summary, schema);
      assert(
        violations.length === 0,
        `含 repair_candidates 的 summary 必须过正式 schema：${JSON.stringify(violations)}`,
      );
      // 判别性：坏形状必须被同一把尺拒绝（证明 schema 真在校验该字段，不是恒过）
      const bad = { ...summary, repair_candidates: [{ ...candidates[0], category: 'verification' }] };
      assert(validateLiteSchema(bad, schema).length > 0, 'schema 须拒绝非法 category');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run(results, 'R8.2 crash/resume：候选从事件流恢复；后续非 repair 回退清空（行为测试，生产共享实现）', () => {
    const cand = [{
      id: 'CR-001', category: 'coding' as const, files: ['a.ets'], summary: 'fix',
      item_fingerprint: 'c'.repeat(64), source_phase: 'review',
    }];
    // ① crash 前写过带候选的回退事件 → resume 必须恢复交接上下文
    const afterCrash = restoreBacktrackCandidatesFromEvents([
      { type: 'phase_start' },
      { type: 'phase_backtrack_requested', candidates: cand },
      { type: 'run_end' },
    ]);
    assert(afterCrash.length === 1 && afterCrash[0].id === 'CR-001', `crash 后须恢复候选：${JSON.stringify(afterCrash)}`);
    // ② 之后又发生非 repair 回退（授权/漂移，无 candidates）→ 旧候选必须被清空
    const afterOtherBacktrack = restoreBacktrackCandidatesFromEvents([
      { type: 'phase_backtrack_requested', candidates: cand },
      { type: 'phase_backtrack_requested', reason: 'unauthorized_source_mutation' } as never,
    ]);
    assert(afterOtherBacktrack.length === 0, `非 repair 回退须清空旧候选：${JSON.stringify(afterOtherBacktrack)}`);
    // ③ 无回退事件 → 空
    assert(restoreBacktrackCandidatesFromEvents([{ type: 'phase_start' }]).length === 0, '无回退事件应为空');
  });

  run(results, 'R8.3 batch/in-session：**磁盘真实 summary** → assessFeature 读取 → driver 授权 → rerun_phase:coding', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const { assessFeature } = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
    const { clearFrameworkConfigCache, featurePhaseReportsDir } = require('../../config') as typeof import('../../config');
    const { deriveReconcileObservation } = require('../../scripts/utils/goal-reconcile-observation') as typeof import('../../scripts/utils/goal-reconcile-observation');
    const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-batch-'));
    try {
      const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.1', project_name: 'T',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        architecture: {
          outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
          module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features', docs_committed: false },
        materialized_adapters: ['cursor'],
      }));
      clearFrameworkConfigCache();
      // **磁盘上的真实 summary.json**（含候选）——assessFeature 自己去读，不手工构造观测
      const cand = {
        id: 'CR-001', category: 'coding', files: ['02-Feature/F/src/A.ets'],
        summary: '半模态未复位', item_fingerprint: 'b'.repeat(64), source_phase: 'review',
      };
      const axis = (v: string) => ({
        applicable: true, required_for_release: true, verdict: v,
        blocking_class: null, source_checks: [], resolution: null,
      });
      for (const p of FULL) {
        const dir = featurePhaseReportsDir(root, 'f1', p, FRAMEWORK_ROOT);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
          schema_version: '1.2', phase: p, feature: 'f1',
          verdict: p === 'review' ? 'FAIL' : 'PASS',
          blocker_count: 0, fail_count: 0, warn_count: 0,
          report_validity: 'PASS',
          quality_axes: Object.fromEntries(['functional', 'visual', 'asset', 'evidence'].map(a => [a, axis('PASS')])),
          release_readiness: 'READY', completion_status: 'complete',
          script_report: 'a', merged_report: 'b', ai_prompt: 'c', summary_json: 'd',
          run_statuses: [], readiness_signals: [], blocking_warnings: [], blocking_skips: [], blockers: [],
          next_action: 'x', closure_status: 'closed', assurance: 'full',
          capability_resolutions: [], capability_resolution_contract_fingerprint: null,
          ...(p === 'review' ? { repair_candidates: [cand] } : {}),
        }, null, 2), 'utf-8');
      }
      // in-session/batch driver 的真实观测（**不带候选**——唯一真源是磁盘 summary）
      const reconcile = deriveReconcileObservation({
        phase: 'review', verdict: 'FAIL', legacyAction: 'retry',
        retriesUsed: 0, backtracksUsed: 0,
        invalidatablePhases: ['coding', 'review', 'ut', 'testing'],
      });
      const assessment = assessFeature({
        projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'f1',
        goalEnd: 'testing', authorization: { mode: 'batch_authorized', through_phase: 'testing' },
        reconcile, writeProjection: false,
      });
      assert(
        assessment.recommendation.action === 'rerun_phase' && assessment.recommendation.phase === 'coding',
        `batch 链路（磁盘 summary→assessFeature）应得 rerun_phase:coding，实得 ${assessment.recommendation.action}:${assessment.recommendation.phase}`,
      );
      assert(
        assessment.recommendation.runner_action === 'backtrack_to_phase',
        `runner_action 应为 backtrack_to_phase，实得 ${assessment.recommendation.runner_action}`,
      );
      assert(
        recommendationAuthorized(
          assessment.recommendation,
          { mode: 'batch_authorized', through_phase: 'testing' },
          FULL,
          { startPhase: 'coding' },
        ) === true,
        'batch 授权区间内应自动放行',
      );
      assert(
        recommendationAuthorized(
          assessment.recommendation,
          { mode: 'batch_authorized', through_phase: 'testing' },
          FULL,
          { startPhase: 'review' },
        ) === false,
        '授权起点晚于目标（review→testing）时不得自动回退 coding，须转 manual',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run(results, 'R8.4 ui_scope 生产接线：check 侧 failure_kind 经**生产 writer 共享实现**映射进候选', () => {
    // 输入=check-coding 的真实产出形态：failure_kind 带归因、details **不含**「失败归因：」
    // 文本（ui-scope-gate 只写 failure_kind）。走 buildSummaryRepairCandidates——
    // 与 harness-runner summary writer 同一函数，故本条覆盖真实接线而非手工 classification。
    const produced = buildSummaryRepairCandidates({
      phase: 'coding',
      reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
      conditionalReceiptValid: false,
      parseClassificationFromDetails: (d) => d.match(/失败归因：([a-zA-Z0-9_]+)/)?.[1],
      checks: [{
        id: 'ui_diff_within_declared_files', status: 'FAIL', severity: 'BLOCKER',
        details: '1 个 changed UI 文件不在冻结 contracts.files 白名单内',
        failure_kind: 'ui_scope_violation',
        affected_files: ['01-Product/WalletMain/src/main/ets/pages/HomeTabPage.ets'],
      }],
    });
    assert(
      produced.length === 1 && produced[0].category === 'plan',
      `真实 ui_scope_violation（仅 failure_kind、details 无归因文本）须产 plan 候选：${JSON.stringify(produced)}`,
    );
    // 判别性：若 writer 只读 details 文本（旧实现），本输入必产 0 条——上面的断言即该回归的钉
    const detailsOnly = buildSummaryRepairCandidates({
      phase: 'coding',
      reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
      conditionalReceiptValid: false,
      parseClassificationFromDetails: (d) => d.match(/失败归因：([a-zA-Z0-9_]+)/)?.[1],
      checks: [{
        id: 'ui_diff_within_declared_files', status: 'FAIL', severity: 'BLOCKER',
        details: '1 个 changed UI 文件不在冻结 contracts.files 白名单内',
        affected_files: ['01-Product/WalletMain/src/main/ets/pages/HomeTabPage.ets'],
      }],
    });
    assert(detailsOnly.length === 0, '无任何归因来源时不得凭空产候选（宁缺毋滥）');
  });

  run(results, 'R8.5 UT product assertion 生产点：信任合取满足才产 coding 候选，缺一不产', () => {
    const verifierOk = [
      '  - id: end_to_end_driving', '    status: PASS',
      '  - id: business_assertion_value', '    status: PASS',
    ].join('\n');
    const utFail = {
      id: 'ut_hvigor_test', status: 'FAIL', severity: 'BLOCKER',
      classification: 'code_regression', details: 'expect(actual).toBe(expected) 断言失败',
      affected_files: ['02-Feature/F/src/main/ets/BankCardRepository.ets'],
    };
    const ok = collectPhaseRepairCandidates({
      phase: 'ut', reviewReportText: null, verifierReportText: verifierOk,
      reportValidity: 'PASS', conditionalReceiptValid: false, checks: [utFail],
    });
    assert(ok.length === 1 && ok[0].category === 'coding', `合取满足应产 coding 候选：${JSON.stringify(ok)}`);
    // ① 环境类归因不产
    assert(
      collectPhaseRepairCandidates({
        phase: 'ut', reviewReportText: null, verifierReportText: verifierOk,
        reportValidity: 'PASS', conditionalReceiptValid: false,
        checks: [{ ...utFail, classification: 'toolchain' }],
      }).length === 0,
      'toolchain 归因不产候选',
    );
    // ② UT 结构门禁另有 BLOCKER FAIL 时不产（先修 UT 自身）
    assert(
      collectPhaseRepairCandidates({
        phase: 'ut', reviewReportText: null, verifierReportText: verifierOk,
        reportValidity: 'PASS', conditionalReceiptValid: false,
        checks: [utFail, { id: 'ut_it_blocks', status: 'FAIL', severity: 'BLOCKER', details: '结构不合规' }],
      }).length === 0,
      'UT 结构门禁未过不产候选',
    );
    // ③ verifier 未确认测试语义有效时不产
    assert(
      collectPhaseRepairCandidates({
        phase: 'ut', reviewReportText: null,
        verifierReportText: '  - id: end_to_end_driving\n    status: FAIL',
        reportValidity: 'PASS', conditionalReceiptValid: false, checks: [utFail],
      }).length === 0,
      'verifier 未确认测试语义有效不产候选',
    );
  });

  run(results, 'R8.6b 判别复现（codex 二/三轮）：同 CR、同文件、问题已变 → 旧 evidence 不得采信（含共享通用短语）', () => {
    const CURRENT_FIX = '修复短信验证状态机错误';
    const current = reviewReport({
      verdict: '有条件通过',
      rows: [{
        id: 'CR-001', sev: 'MAJOR', state: '未关闭',
        files: '`02-Feature/F/src/main/ets/SelectBankCardPage.ets`',
        fix: CURRENT_FIX,
      }],
    });
    // ① 完全不同的问题（codex 二轮复现）
    assert(
      collectReviewRepairCandidates({
        ...fullTrust, reportText: current,
        verifierReportText: verifierFresh([
          { id: 'CR-001', verdict: 'confirmed', evidence: 'SelectBankCardPage.ets | 缺 onDisappear 复位' },
        ]),
      }).length === 0,
      '同 CR/同文件但问题已变，旧证据不得驱动改码',
    );
    // ② **共享通用短语**的不同问题（codex 三轮复现：都含「状态机错误」）——
    //    片段匹配会误采信，完整包含判据必须挡住
    const sharedPhrase = collectReviewRepairCandidates({
      ...fullTrust, reportText: current,
      verifierReportText: verifierFresh([
        { id: 'CR-001', verdict: 'confirmed', evidence: 'SelectBankCardPage.ets | 修复下拉菜单状态机错误' },
      ]),
    });
    assert(
      sharedPhrase.length === 0,
      `共享通用短语（状态机错误）的不同缺陷不得采信：${JSON.stringify(sharedPhrase)}`,
    );
    // ③ 原样复制当前修复建议 → 采信
    const fresh = collectReviewRepairCandidates({
      ...fullTrust, reportText: current,
      verifierReportText: verifierFresh([
        { id: 'CR-001', verdict: 'confirmed', evidence: `SelectBankCardPage.ets | ${CURRENT_FIX}` },
      ]),
    });
    assert(fresh.length === 1, `原样复制当前修复建议应采信：${JSON.stringify(fresh)}`);
    // ④ 只照抄了一半（截断）→ 不采信（宁缺毋滥）
    assert(
      collectReviewRepairCandidates({
        ...fullTrust, reportText: current,
        verifierReportText: verifierFresh([
          { id: 'CR-001', verdict: 'confirmed', evidence: 'SelectBankCardPage.ets | 修复短信验证' },
        ]),
      }).length === 0,
      '摘要未完整照抄不得采信',
    );
  });

  run(results, 'R8.6 verifier 证据新鲜度：evidence 对不上当前 CR（旧轮产物）不采信；缺 evidence 同样不采信', () => {
    const report = reviewReport({ verdict: '有条件通过', rows: [CR1] });
    const stale = collectReviewRepairCandidates({
      ...fullTrust, reportText: report,
      verifierReportText: [
        '```issue-verification', '- issue: CR-001', '  verdict: confirmed',
        '  evidence: OpenCardFlow.ets 重复绑卡未提示', '```',
      ].join('\n'),
    });
    assert(stale.length === 0, `evidence 指向别的问题（旧轮产物）不得采信：${JSON.stringify(stale)}`);
    const missing = collectReviewRepairCandidates({
      ...fullTrust, reportText: report,
      verifierReportText: verifierWith([{ id: 'CR-001', verdict: 'confirmed' }]),
    });
    assert(missing.length === 0, '缺 evidence（旧格式）不得采信');
    const fresh = collectReviewRepairCandidates({
      ...fullTrust, reportText: report,
      verifierReportText: [
        '```issue-verification', '- issue: CR-001', '  verdict: confirmed',
        `  evidence: SelectBankCardPage.ets | ${CR1.fix}`, '```',
      ].join('\n'),
    });
    assert(fresh.length === 1, `evidence 含文件名且原样复制修复建议应采信：${JSON.stringify(fresh)}`);
  });

  return results;
}

if (require.main === module) {
  const result = runAll();
  for (const item of result) console.log(item.ok ? `PASS ${item.name}` : `FAIL ${item.name}: ${item.error}`);
  process.exit(result.every(item => item.ok) ? 0 : 1);
}
