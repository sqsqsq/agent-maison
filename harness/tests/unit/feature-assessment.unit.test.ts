import { beginUnitCase } from '../utils/unit-cases';
// feature-assessment.unit.test.ts — plan b2d7f4e9 §3.1 / t1：唯一评估入口 assessFeature
//
// 夹具只用两类真实产物，不注入 verdict：
//   · 上一版宿主快照（原样识别失效；需当前完成时显式用正式 successor 迁移的副本）；
//   · completion-chain-seed（生产 writer 造 legacy 1.1 完成事实）+ 显式传入的合法范围。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { assessFeature, type AssessedObligation, type FeatureAssessment } from '../../scripts/utils/feature-assessment';
import { executionScopeEvidenceIssues, generateFeatureCompletion } from '../../scripts/utils/verify-feature-completion';
import type { ExecutionScope } from '../../scripts/utils/execution-scope';
import { seedCleanCompletionChain } from '../utils/completion-chain-seed';
import type { UnitCaseResult } from '../run-unit';
import { type CheckContext } from '../../scripts/utils/types';

const obligation = (a: FeatureAssessment, id: string): AssessedObligation => {
  const found = a.obligations.find(item => item.id === id);
  assert(found, `缺义务 ${id}：${JSON.stringify(a.obligations.map(item => item.id))}`);
  return found!;
};
const brief = (a: FeatureAssessment): string => JSON.stringify({ record: a.record, uncovered: a.obligations.filter(o => o.status === 'uncovered'), blocking: a.blocking });

/** legacy 1.1 完成事实（chain spec→plan）+ 显式传入的合法范围。 */
const SEED_FEATURE = 'assess-fixture';
function withSeededCompletion(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-assess-'));
  clearFrameworkConfigCache();
  try {
    const now = () => new Date('2026-07-13T00:00:00.000Z');
    seedCleanCompletionChain({ projectRoot: root, feature: SEED_FEATURE, chain: ['spec', 'plan'], now });
    generateFeatureCompletion({
      projectRoot: root, feature: SEED_FEATURE, chain: ['spec', 'plan'], workflowTrack: 'full', runId: 'RUN1',
      runDirAbs: featureFilePath(root, SEED_FEATURE, path.join('goal-runs', 'RUN1')), phaseRunIds: {}, now,
    });
    run(root);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const seededAssess = (root: string, scope?: ExecutionScope): FeatureAssessment =>
  assessFeature(root, SEED_FEATURE, { expectedChain: ['spec', 'plan'], expectedTrack: 'full', ...(scope ? { scope } : {}) });
const scopeOf = (over: Partial<ExecutionScope>): ExecutionScope => ({
  schema_version: '1.0', completion_target: 'feature', requested_results: ['assess probe'], obligations: [], phase_chain: [],
  reused_phases: [], unresolved: [], policy_fingerprint: '0'.repeat(64), ...over,
});

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  { name: '7d9c2e41 missing required conclusion is evidence; real FAIL and mixed FAIL remain result', run: () => {
    const { generateScriptReport } = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
    const { writeRunSummaryBase } = require('../../harness-runner') as typeof import('../../harness-runner');
    const { executeCheck } = require('../../scripts/utils/check-execution') as typeof import('../../scripts/utils/check-execution');
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const passed = { id: 'product_gate', category: 'structure' as const, description: 'product gate', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'checked' };
    const failed = { ...passed, status: 'FAIL' as const, details: 'actual product failure' };
    const missing = executeCheck({ phaseRule: {} } as CheckContext, () => { throw new Error('checker unavailable'); }, 'checker_execution');
    const scope = scopeOf({ phase_chain: ['spec', 'plan'], obligations: [
      { id: 'acceptance-context:probe', kind: 'acceptance-context', owner_phase: 'spec', applicability: 'required', reason: 'probe', basis: [] },
    ] });
    for (const [checks, expected] of [[[passed, ...missing], 'evidence'], [[failed], 'result'], [[failed, ...missing], 'result']] as const) {
      withSeededCompletion(root => {
        const report = generateScriptReport('', 'spec', SEED_FEATURE, root, [...checks], frameworkRoot);
        report.assurance = 'full';
        const summary = writeRunSummaryBase(root, report, frameworkRoot);
        assert.strictEqual(summary.verdict, expected === 'evidence' ? 'INCOMPLETE' : 'FAIL');
        const assessment = seededAssess(root, scope);
        const item = obligation(assessment, 'acceptance-context:probe');
        assert.strictEqual(item.class, expected, brief(assessment));
        assert.strictEqual(assessment.complete, false);
        if (checks.length === 2 && checks[0].status === 'FAIL') assert(assessment.obligations.some(gap => (gap.reason ?? '').includes('required_check_conclusion')),
          'the common view must preserve the separate checker gap alongside the real product failure: ' + brief(assessment));
      });
    }
  } },
  { name: 'codex P1-1：合法范围声明 required UT 义务、无 satisfied_by、无证据 → 绑定检查为空，但义务 uncovered/evidence', run: () => withSeededCompletion(root => {
    const scope = scopeOf({
      phase_chain: ['ut'],
      obligations: [{ id: 'unit-evidence:probe', kind: 'unit-evidence', owner_phase: 'ut', applicability: 'required', reason: 'probe', basis: [] }],
    });
    assert.deepStrictEqual(executionScopeEvidenceIssues(root, SEED_FEATURE, scope), [], '前提：绑定检查对无证据义务返回 []');
    assert.strictEqual(seededAssess(root).complete, true, '前提：不传范围时 legacy 记录完整');
    const a = seededAssess(root, scope);
    assert.strictEqual(a.record.state, 'ok', brief(a));
    const ut = obligation(a, 'unit-evidence:probe');
    assert(ut.status === 'uncovered' && ut.class === 'evidence', brief(a));
    assert.strictEqual(a.complete, false);
  }) },
  { name: 'P4 A11 结果依据类检查失败（ref_elements_excluded）：spec 义务保持未覆盖，assessFeature 不判完成；同链 PASS 时义务覆盖', run: () => {
    const { generateScriptReport } = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
    const { resolvePhaseVerdict } = require('../../harness-runner') as typeof import('../../harness-runner');
    const scope = scopeOf({
      phase_chain: ['spec', 'plan'],
      obligations: [{ id: 'acceptance-context:probe', kind: 'acceptance-context', owner_phase: 'spec', applicability: 'required', reason: 'probe', basis: [] }],
    });
    const failing = {
      id: 'ref_elements_excluded', category: 'structure' as const, description: 'ref-elements excluded', severity: 'BLOCKER' as const, status: 'FAIL' as const,
      details: 'result_nfc_card：requirement_quote 未逐字出现在需求原文',
    };
    for (const checks of [[failing], [{ ...failing, status: 'PASS' as const }]]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-assess-a11-'));
      clearFrameworkConfigCache();
      try {
        const now = () => new Date('2026-07-13T00:00:00.000Z');
        // spec 的结论由生产的共享结论函数对真实脚本报告求值
        const verdict = resolvePhaseVerdict(root, generateScriptReport('', 'spec', SEED_FEATURE, root, checks)).verdict;
        seedCleanCompletionChain({ projectRoot: root, feature: SEED_FEATURE, chain: ['spec', 'plan'], now, phaseVerdict: phase => (phase === 'spec' ? verdict : 'PASS') });
        let refused = false;
        try {
          generateFeatureCompletion({ projectRoot: root, feature: SEED_FEATURE, chain: ['spec', 'plan'], workflowTrack: 'full', runId: 'RUN1',
            runDirAbs: featureFilePath(root, SEED_FEATURE, path.join('goal-runs', 'RUN1')), phaseRunIds: {}, now });
        } catch { refused = true; }
        const a = seededAssess(root, scope);
        const spec = obligation(a, 'acceptance-context:probe');
        if (checks[0].status === 'FAIL') {
          assert.strictEqual(verdict, 'FAIL', '结果依据类失败保持阻断');
          assert(refused, '完成凭证拒绝生成');
          assert(spec.status === 'uncovered', brief(a));
          assert.strictEqual(a.complete, false);
        } else {
          assert.strictEqual(verdict, 'PASS');
          assert(spec.status === 'covered', `正对照：${brief(a)}`);
        }
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  } },
  { name: '#17 unknown 适用性 / unresolved 非空 → uncovered/unknown，complete=false', run: () => withSeededCompletion(root => {
    const scope = scopeOf({
      obligations: [{ id: 'device-evidence:probe', kind: 'device-evidence', owner_phase: 'testing', applicability: 'unknown', reason: 'probe', basis: [] }],
      unresolved: [{ obligation_id: 'device-evidence:probe', needed_by: ['testing'], owner: 'spec', reason: 'device layer undecided' }],
    });
    const a = seededAssess(root, scope);
    assert.strictEqual(a.record.state, 'ok', brief(a));
    const probe = obligation(a, 'device-evidence:probe');
    assert(probe.status === 'uncovered' && probe.class === 'unknown' && (probe.reason ?? '').includes('device layer undecided'), brief(a));
    assert.strictEqual(a.complete, false);
  }) },
  // 偏离 §6 A1-6 原夹具：投影侧 acceptance.performance 行被 checkAcceptanceContent 强制带 id（无 id 即投影 invalid），
  // 「无身份对象行」在可达投影里落在 contracts 的嵌套行上（如 state_management[].subscriptions：只有 subscription_id）。
];

export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    const endUnitCase = beginUnitCase(`feature-assessment: ${c.name}`);
    if (!endUnitCase) continue;
    try {
      await c.run();
      results.push({ name: `feature-assessment: ${c.name}`, ok: true });
    } catch (err) {
      results.push({ name: `feature-assessment: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally {  endUnitCase(); }
  }
  return results;
}

// Current completion facts stay daily; historical migrations and projection matrices are formal.
const dailyAssessmentPrefixes = [
  'feature-assessment: 7d9c2e41 missing required conclusion',
  'feature-assessment: codex P1-1',
  'feature-assessment: P4 A11',
  'feature-assessment: #17 unknown',
  'feature-assessment: #18 只改 acceptance.yaml',
  'feature-assessment: ★2 只改 change-unit.yaml',
];
