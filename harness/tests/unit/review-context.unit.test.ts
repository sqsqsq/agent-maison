import { matchesUnitCase, selectedUnitCases } from '../utils/unit-case-selection';
// ============================================================================
// review-context.unit.test.ts — review 阶段缺上下文引导回归
// ============================================================================

import { initializeFidelityRouting } from '../../scripts/utils/goal-preflight';
import { resolveFidelityContextFromFeature, loadFidelityIntentSsot } from '../../scripts/utils/fidelity-shared';
import { writeRunSummaryBase } from '../../harness-runner';
import { collectReviewRepairCandidates } from '../../scripts/utils/repair-candidates';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import checker from '../../scripts/check-review';
import { resolveCapabilityReport } from '../../scripts/utils/capability-resolution';
import { deriveSummaryVerdictLattice } from '../../scripts/utils/quality-axes';
import { CheckContext } from '../../scripts/utils/types';
import { inferRepoLayout } from '../../repo-layout';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

async function withTmpProject<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-context-'));
  ensureConsumerFrameworkTree(dir);
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify({ active_workflow: 'spec-driven' }));
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function ctx(root: string, featureSpec: CheckContext['featureSpec']): CheckContext {
  clearFrameworkConfigCache();
  const fw = loadFrameworkConfig(root);
  const resolvedProfile = loadResolvedProfile(root, fw);
  return {
    phase: 'review',
    feature: 'demo',
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: {
      phase: 'review',
      structure_checks: {},
      semantic_checks: {},
      traceability_checks: {},
    } as CheckContext['phaseRule'],
    featureSpec,
    resolvedProfile,
  };
}

const validReport = [
  '---',
  'feature: demo',
  'phase: review',
  '---',
  '# Review',
  '## 审查范围',
  'TaskDemo',
  '## 审查方法',
  '按规则审查',
  '## 问题清单',
  '无问题',
  '## 问题统计',
  'BLOCKER: 0',
  'MAJOR: 0',
  'MINOR: 0',
  '## 修复建议',
  '无',
  '## 结论',
  '**审查结论**: 通过',
].join('\n');

// 带 BLOCKER 计数的报告——用于裁决 vs BLOCKER 一致性回归。
function reportWith(verdictLine: string, blockerCount: number): string {
  const rows: string[] = [];
  for (let i = 0; i < blockerCount; i++) {
    rows.push(`| CR-00${i + 1} | BLOCKER | 逻辑错误 | 问题${i + 1} | src/a${i}.ets | 修复 |`);
  }
  return [
    '---', 'feature: demo', 'phase: review', '---',
    '# Review',
    '## 审查范围', 'TaskDemo',
    '## 审查方法', '按规则审查',
    '## 问题清单',
    '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |',
    '|------|---------|------|---------|---------|---------|',
    ...rows,
    '## 问题统计', `BLOCKER: ${blockerCount}`, 'MAJOR: 0', 'MINOR: 0',
    '## 修复建议', '见上',
    '## 结论', verdictLine,
  ].join('\n');
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: 'review context: 缺 review-report.md → missing_review_report',
    run: async () => withTmpProject(async root => {
      const results = await checker.check(ctx(root, { feature: 'demo' }));
      const hit = results.find(r => r.id === 'review_report_exists');
      assertTrue(hit?.failure_kind === 'missing_review_report', '应归因为 missing_review_report');
      assertTrue(hit?.blocking_class === 'review_context', '应标记 review_context');
    }),
  },
  {
    name: 'review context: 缺 contracts/acceptance/source → 输出明确上下文分类',
    run: async () => withTmpProject(async root => {
      writeFile(path.join(root, 'doc', 'features', 'demo', 'review-report.md'), validReport);
      const results = await checker.check(ctx(root, {
        feature: 'demo',
        contracts: {
          feature: 'demo',
          source: 'unit',
          version: '1.0',
          modules: [],
          files: ['02-Feature/Demo/src/main/ets/Missing.ets'],
          module_dependencies: {},
          data_models: [],
          interfaces: [],
          components: [],
        },
      }));
      const capabilityReport = resolveCapabilityReport({
        frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
        projectRoot: root,
        feature: 'demo',
        phase: 'review',
        track: 'full',
      });
      const acceptance = capabilityReport.capabilities.find(
        (capability) => capability.id === 'capability_review_acceptance_context',
      );
      assertTrue(acceptance?.state === 'pruned', `acceptance capability=${acceptance?.state}`);
      const opts = { phase: 'review', visualApplicable: false, assetApplicable: false };
      const baseline = deriveSummaryVerdictLattice([], opts);
      const lattice = deriveSummaryVerdictLattice([], opts, capabilityReport);
      assertTrue(lattice.projected_verdict === baseline.projected_verdict, 'pruned acceptance must not change projected verdict');
      assertTrue(lattice.release_readiness === baseline.release_readiness, 'pruned acceptance must not change release readiness');
      assertTrue(JSON.stringify(lattice.quality_axes) === JSON.stringify(baseline.quality_axes), 'pruned acceptance must not mutate quality axes');
      assertTrue(results.some(r => r.failure_kind === 'missing_source_from_contracts'), '应提示缺源码');
    }),
  },
  {
    name: 'conclusion: 不通过 + 2 BLOCKER → 自洽 PASS（修复前因子串误读会误判 FAIL）',
    run: async () => withTmpProject(async root => {
      writeFile(
        path.join(root, 'doc', 'features', 'demo', 'review-report.md'),
        reportWith('**审查结论**: 不通过', 2),
      );
      const results = await checker.check(ctx(root, { feature: 'demo' }));
      const hit = results.find(r => r.id === 'conclusion_with_verdict');
      assertTrue(hit?.status === 'PASS', `应 PASS，实际 ${hit?.status}：${hit?.details}`);
    }),
  },
  {
    name: 'conclusion: 通过 + 1 BLOCKER → 真不一致 FAIL（不放过谎报通过）',
    run: async () => withTmpProject(async root => {
      writeFile(
        path.join(root, 'doc', 'features', 'demo', 'review-report.md'),
        reportWith('**审查结论**: 通过', 1),
      );
      const results = await checker.check(ctx(root, { feature: 'demo' }));
      const hit = results.find(r => r.id === 'conclusion_with_verdict');
      assertTrue(hit?.status === 'FAIL', `应 FAIL，实际 ${hit?.status}`);
    }),
  },
];

cases.push({ name: 'c6a3d918 shared visual disposition crosses conclusion closure candidates without erasing counts', run: async () => withTmpProject(async root => {
  const init = (hard: boolean) => initializeFidelityRouting({ projectRoot: root, frameworkRoot: root, feature: 'demo',
    requirement: hard ? '必须像素级完全还原 UI' : '尽量与参考图一致 UI', featuresDirRel: 'doc/features', executionIdentity: 'review-test', requirementProvenance: 'explicit_cli' });
  init(false);
  fs.mkdirSync(path.join(root, 'doc/features/demo/review/reports'), { recursive: true });
  const report = (classification: string, severity: string, verdict: string) => [
    '# Review', '## 审查范围', 'src/UI.ts', '## 审查方法', '视觉保真：差异披露，尚未设备验真',
    '## 问题清单', '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 | 状态 |', '|---|---|---|---|---|---|---|',
    `| CR-1 | ${severity} | ${classification} | 协议颜色细节 | src/UI.ts | 调整协议颜色 | 未关闭 |`,
    '## 问题统计', `BLOCKER: ${severity === 'BLOCKER' ? 1 : 0} MAJOR: ${severity === 'MAJOR' ? 1 : 0} MINOR: 0 INFO: 0`,
    '## 修复建议摘要', '允许披露项保留原数量，真实缺陷交责任方', '## 结论', `**审查结论**: ${verdict}` ].join('\n');
  writeFile(path.join(root, 'src/UI.ts'), 'export const color = "blue";');
  const verified = '```issue-verification\n- issue: CR-1\n  verdict: confirmed\n  evidence: UI.ts | 调整协议颜色\n```';
  for (const [classification, severity, verdict, hard, expected] of [
    ['视觉保真', 'MAJOR', '通过', false, true], ['视觉保真', 'MAJOR', '有条件通过', false, true],
    ['逻辑错误', 'MAJOR', '有条件通过', false, false], ['视觉保真', 'BLOCKER', '不通过', false, false],
    ['视觉保真', 'MAJOR', '有条件通过', true, false], ['其他', 'MAJOR', '有条件通过', false, false],
    ['视觉保真', 'MAJOR', '不通过', false, false],
  ] as const) {
    init(hard); const body = report(classification, severity, verdict);
    writeFile(path.join(root, 'doc/features/demo/review-report.md'), body);
    const result = await checker.check(ctx(root, { feature: 'demo' }));
    const checks = result.filter(r => ['conclusion_with_verdict', 'conditional_pass_closure', 'negative_verdict_closure'].includes(r.id));
    assertTrue(checks.every(r => r.status !== 'FAIL') === expected, `${classification}/${severity}/${verdict}/${hard}: ${JSON.stringify(checks)}`);
    const candidates = collectReviewRepairCandidates({ reportText: body, verifierReportText: verified, reportValidityBlocked: false, reviewFidelity: loadFidelityIntentSsot(root, 'demo') });
    assertTrue(candidates.length === (classification === '视觉保真' && severity === 'MAJOR' && !hard ? 0 : 1), '候选处置必须同源');
    if (expected) {
      assertTrue(body.includes('MAJOR: 1') && body.includes('未关闭'), '不得抹统计或假闭合');
      writeFile(path.join(root, 'doc/features/demo/spec/spec.md'), '```yaml\nui_change: new_or_changed\n```');
      const summary = writeRunSummaryBase(root, { phase: 'review', feature: 'demo', project_root: root, timestamp: new Date().toISOString(),
        assurance: 'full', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
        checks: [{ id: 'visual_fidelity_review', category: 'structure', description: 'visual review', severity: 'MAJOR', status: 'PASS', details: '差异披露' },
          { id: 'negative_verdict_closure', category: 'structure', description: '真实结论', severity: 'BLOCKER', status: 'PASS', details: '非负面' }],
        summary: { total: 2, pass: 2, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' } }, DEFAULT_LAYOUT.frameworkRoot);
      assertTrue(summary.quality_axes?.visual.resolution?.class !== 'needs_fix' && summary.release_readiness === 'BLOCKED' && summary.readiness_signals.some(signal => signal.id === 'visual_debt_disclosure' && signal.status === 'unknown'), 'review 不得预签设备视觉或发布');
    }
  }
  init(false);
  writeFile(path.join(root, 'doc/features/demo/spec/spec.md'), '```yaml\nui_change: new_or_changed\nfidelity_deferrals:\n  - element_id: bank-search\n    reason: 搜索区域延后\n  - element_id: bank-count-100\n    reason: 100家扩展延后\n```');
  writeFile(path.join(root, 'doc/features/demo/spec/ref-elements.yaml'), 'elements: [{element_id: bank-search, disposition: defer}, {element_id: bank-count-100, disposition: defer}]');
  assertTrue(resolveFidelityContextFromFeature(root, 'demo').fidelityDeferrals.length === 2, '复用既有延后读取');
  const negative = report('其他', 'MAJOR', '不通过');
  const refuted = verified.replace('confirmed', 'refuted');
  assertTrue(collectReviewRepairCandidates({ reportText: negative, verifierReportText: refuted, reportValidityBlocked: false }).length === 0, '有效 defer 被逐条驳回后不派 coding');
  writeFile(path.join(root, 'doc/features/demo/review-report.md'), negative);
  assertTrue((await checker.check(ctx(root, { feature: 'demo' }))).some(r => r.id === 'negative_verdict_closure' && r.status === 'FAIL'), '驳回不直接洗绿负面报告');
  const corrected = validReport.replace('TaskDemo', 'src/UI.ts');
  writeFile(path.join(root, 'doc/features/demo/review-report.md'), corrected);
  assertTrue((await checker.check(ctx(root, { feature: 'demo' }))).find(r => r.id === 'negative_verdict_closure')?.status === 'PASS', '责任方更正报告后才推进');
  const summary = writeRunSummaryBase(root, { phase: 'review', feature: 'demo', project_root: root, timestamp: new Date().toISOString(),
    assurance: 'full', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
    checks: [{ id: 'visual_fidelity_review', category: 'structure', description: 'review', severity: 'MAJOR', status: 'PASS', details: '有效延后已披露' },
      { id: 'negative_verdict_closure', category: 'structure', description: '真实结论', severity: 'BLOCKER', status: 'PASS', details: '非负面' }],
    summary: { total: 2, pass: 2, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' } }, DEFAULT_LAYOUT.frameworkRoot);
  assertTrue(summary.release_readiness === 'BLOCKED' && summary.quality_axes?.visual.resolution?.class !== 'needs_fix' && summary.readiness_signals.some(signal => signal.id === 'visual_debt_disclosure' && signal.status === 'unknown'), '延后仍保留发布阻断');
  // Existing debt source is retained; review does not create or settle testing evidence.
  assertTrue(!fs.existsSync(path.join(root, 'doc/features/demo/visual-debt.yaml')), 'review 不另造债务账');
}) });

cases.push({ name: 'postreview successor rereview uses direct predecessor report and latest candidates, current run wins', run: async () => withTmpProject(async root => {
  const { buildRereviewContext } = await import('../../scripts/goal-phase-runtime');
  const { buildGoalManifestFromInput } = await import('../../scripts/utils/goal-manifest');
  const previous = buildGoalManifestFromInput({ feature: 'demo', run_id: 'previous', requirement: 'repair existing defect' }, { projectRoot: root });
  const current = { ...buildGoalManifestFromInput({ feature: 'demo', run_id: 'current', requirement: 'repair existing defect' }, { projectRoot: root }), successor_of: previous.run_id };
  const previousRoot = path.join(root, previous.report_dir);
  writeFile(path.join(previousRoot, 'manifest.json'), JSON.stringify(previous));
  writeFile(path.join(previousRoot, 'phases/review/harness/review-report.md'), 'ACTUAL PREDECESSOR REPORT: existing data defect');
  writeFile(path.join(previousRoot, 'events.jsonl'), [
    { type: 'phase_backtrack_requested', candidates: [{ id: 'older-candidate' }] },
    { type: 'phase_backtrack_requested', candidates: [{ id: 'latest-candidate', summary: 'ACTUAL PREDECESSOR REPAIR', files: ['src/logic.ts'] }] },
  ].map(event => JSON.stringify(event)).join('\n') + '\n');
  const inherited = buildRereviewContext(root, current, [], DEFAULT_LAYOUT.frameworkRoot);
  assertTrue(inherited.includes('ACTUAL PREDECESSOR REPORT') && inherited.includes('ACTUAL PREDECESSOR REPAIR') && inherited.includes('latest-candidate'), '后继首 review 须读真实前继报告和最后候选');
  assertTrue(!inherited.includes('older-candidate'), '不拼更早回退候选');
  const report = path.join(root, current.report_dir, 'phases/review/harness/review-report.md');
  writeFile(report, 'ACTUAL CURRENT REPORT');
  const events = [{ type: 'phase_verdict', phase: 'review' }, { type: 'phase_backtrack_requested', candidates: [{ id: 'current-candidate' }] }] as import('../../scripts/utils/goal-runner-phase').GoalRunEvent[];
  const own = buildRereviewContext(root, current, events, DEFAULT_LAYOUT.frameworkRoot);
  assertTrue(own.includes('ACTUAL CURRENT REPORT') && own.includes('current-candidate') && !own.includes('PREDECESSOR'), '本 run 前轮优先，不偷换前继');
  fs.unlinkSync(report);
  assertTrue(buildRereviewContext(root, current, events, DEFAULT_LAYOUT.frameworkRoot).includes('missing; no prior findings') && !buildRereviewContext(root, current, events, DEFAULT_LAYOUT.frameworkRoot).includes('PREDECESSOR'), '本轮已有 verdict 但快照缺失，不替换前继证据');
  fs.unlinkSync(path.join(previousRoot, 'manifest.json'));
  assertTrue(buildRereviewContext(root, current, [], DEFAULT_LAYOUT.frameworkRoot).includes('missing; no prior findings'), '读不到前继须如实 missing');
}) });

cases.push({ name: 'repair1 visual classification alone is not a review dimension', run: async () => withTmpProject(async root => {
  writeFile(path.join(root, 'doc/features/demo/spec/spec.md'), '```yaml\nui_change: new_or_changed\n```');
  const { checkVisualFidelityReview } = await import('../../scripts/check-review');
  const classificationOnly = '## 问题清单\n| 编号 | 分类 |\n|---|---|\n| CR-1 | 视觉保真 |\n## 修复建议\nvisible_text 已核对';
  const missing = checkVisualFidelityReview(ctx(root, { feature: 'demo' }), classificationOnly);
  assertTrue(missing[0].status !== 'PASS' && missing[0].details.includes('缺「视觉保真」维度'), '分类值不能冒充维度');
  const real = checkVisualFidelityReview(ctx(root, { feature: 'demo' }), '## 审查方法\n视觉保真：visible_text 已核对\n' + classificationOnly);
  assertTrue(real[0].status === 'PASS', '实际维度不得被误伤');
  const standalone = checkVisualFidelityReview(ctx(root, { feature: 'demo' }), '## 视觉保真核验\nvisible_text 已核对\n## 结论\n通过');
  assertTrue(standalone[0].status === 'PASS', '独立章节标题已证明维度，正文无需重复标题关键词');
}) });

cases.push({ name: 'repair1 closure candidates reuse writer classification and subject boundaries', run: async () => withTmpProject(async root => {
  const { UT_REAL_ASSERTION_CHECK } = await import('./repair-candidates.unit.test');
  const { __testing_recomputeClosureRepairCandidates } = await import('../../scripts/utils/phase-closure-finalizer');
  const { renderResultBlock } = await import('../utils/verifier-evidence-fixture');
  const dir = path.join(root, 'doc/features/demo/ut/reports'); fs.mkdirSync(dir, { recursive: true });
  const legacy = { ...UT_REAL_ASSERTION_CHECK, failure_kind: undefined, details: UT_REAL_ASSERTION_CHECK.details + '\n失败归因：code_regression', category: 'structure', description: 'legacy classified assertion check' } as import('../../scripts/utils/types').CheckResult;
  const report = { phase: 'ut', feature: 'demo', project_root: root, timestamp: new Date().toISOString(), assurance: 'full', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
    checks: [{ id: 'ut_hvigor_build', severity: 'BLOCKER', status: 'PASS', category: 'structure', description: 'compiled', details: 'PASS' }, legacy],
    summary: { total: 2, pass: 1, fail: 1, warn: 0, skip: 0, blockers: 1, verdict: 'FAIL' } } as import('../../scripts/utils/types').ScriptReport;
  const verifierPlan = { mode: 'enabled' as const, reason: 'policy_required' as const, verifier_prompt: 'harness/prompts/verify-ut.md', message: 'D1' };
  fs.writeFileSync(path.join(dir, 'ai-prompt.md'), 'UT current diagnosis'); fs.writeFileSync(path.join(dir, 'script-report.json'), JSON.stringify(report));
  const issued = writeRunSummaryBase(root, report, DEFAULT_LAYOUT.frameworkRoot, { verifierPlan });
  const body = '| id | status |\n|---|---|\n| end_to_end_driving | PASS |\n| business_assertion_value | PASS |\n';
  fs.writeFileSync(path.join(root, issued.verifier_report!), body + renderResultBlock(issued.verifier_subject_id!, 'PASS', 0));
  const base = writeRunSummaryBase(root, report, DEFAULT_LAYOUT.frameworkRoot, { verifierPlan });
  const opts = { projectRoot: root, frameworkRoot: DEFAULT_LAYOUT.frameworkRoot, feature: 'demo', phase: 'ut', persistPhaseState: () => undefined };
  const viaClosure = __testing_recomputeClosureRepairCandidates(opts, dir, base);
  assertTrue(base.repair_candidates?.length === 1 && JSON.stringify(viaClosure) === JSON.stringify(base.repair_candidates), 'finalizer 不能丢 legacy classification');
  fs.writeFileSync(path.join(root, base.verifier_report!), body.replace('end_to_end_driving | PASS', 'end_to_end_driving | FAIL') + renderResultBlock(base.verifier_subject_id!, 'FAIL', 1));
  assertTrue(__testing_recomputeClosureRepairCandidates(opts, dir, base)?.length === 0, '合法否定不能沿用旧候选');
  const withoutExisting = { ...base, repair_candidates: undefined };
  fs.writeFileSync(path.join(root, base.verifier_report!), body + renderResultBlock('f'.repeat(64), 'PASS', 0));
  assertTrue(__testing_recomputeClosureRepairCandidates(opts, dir, withoutExisting) === undefined, '错 subject 不得重新产生候选');
}) });

async function executeCases(selector?: string): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    if (!matchesUnitCase(c.name, selector)) continue;
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}

export const runAll = () => executeCases();
export const runSelectedCases = async (selector?: string) => selectedUnitCases(await executeCases(selector), selector, []);
