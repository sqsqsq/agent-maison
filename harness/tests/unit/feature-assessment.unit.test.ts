// feature-assessment.unit.test.ts — plan b2d7f4e9 §3.1 / t1：唯一评估入口 assessFeature
//
// 夹具只用两类真实产物，不注入 verdict：
//   · 上一版宿主快照（host-snapshot-3.1.0，real-chain 生产链产出，换目录加载）；
//   · completion-chain-seed（生产 writer 造 legacy 1.1 完成事实）+ 显式传入的合法范围。

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { assessFeature, type AssessedObligation, type FeatureAssessment } from '../../scripts/utils/feature-assessment';
import { executionScopeEvidenceIssues, generateFeatureCompletion } from '../../scripts/utils/verify-feature-completion';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import type { ExecutionScope } from '../../scripts/utils/execution-scope';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { seedCleanCompletionChain } from '../utils/completion-chain-seed';
import type { UnitCaseResult } from '../run-unit';

function withSnapshot(run: (root: string, frameworkRoot: string) => void): void {
  const snapshot = loadHostSnapshot();
  try {
    clearFrameworkConfigCache();
    run(snapshot.root, snapshot.frameworkRoot);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(snapshot.root, { recursive: true, force: true });
  }
}

function assessOnSnapshot(root: string, frameworkRoot: string, feature: string): FeatureAssessment {
  clearFrameworkConfigCache();
  return assessFeature(root, feature, { ...resolveChangeUnitExpectedExecution(root, feature), frameworkRoot });
}

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

const cases: Array<{ name: string; run: () => void }> = [
  { name: '★1 上一版快照换目录加载：两个已完成 Feature record ok、义务全覆盖、complete', run: () => withSnapshot((root, fw) => {
    for (const feature of [SNAPSHOT_FLAT_FEATURE, SNAPSHOT_CU_FEATURE]) {
      const a = assessOnSnapshot(root, fw, feature);
      assert.strictEqual(a.record.state, 'ok', `${feature}：${brief(a)}`);
      assert(a.obligations.length > 0 && a.obligations.every(o => o.status === 'covered'), `${feature}：${brief(a)}`);
      assert.deepStrictEqual(a.blocking, []);
      assert.strictEqual(a.complete, true, `${feature}：${brief(a)}`);
    }
  }) },
  { name: '执行结果按 owner_phase 摊回：CU 施工源码后改 → coding 义务 uncovered，记录仍可信', run: () => withSnapshot((root, fw) => {
    fs.appendFileSync(path.join(root, 'src', 'ledger', 'LedgerFeature.ets'), '\n// changed after completion\n');
    const a = assessOnSnapshot(root, fw, SNAPSHOT_CU_FEATURE);
    assert.strictEqual(a.record.state, 'ok', brief(a));
    const coding = obligation(a, 'implementation:request');
    assert(coding.status === 'uncovered' && (coding.reason ?? '').includes('LedgerFeature.ets'), brief(a));
    assert.strictEqual(a.complete, false);
  }) },
  { name: '★2 只改 change-unit.yaml（contracts.yaml 字节不变）→ plan 义务 uncovered/binding，原因为 CU 绑定失配', run: () => withSnapshot((root, fw) => {
    const dir = featureFilePath(root, SNAPSHOT_CU_FEATURE, '');
    const contracts = fs.readFileSync(path.join(dir, 'contracts.yaml'));
    const cuFile = path.join(dir, 'change-unit.yaml');
    const before = fs.readFileSync(cuFile, 'utf8');
    fs.writeFileSync(cuFile, before.replace(/^(purpose:\s*)(.*)$/m, '$1$2 (reworded)'));
    assert.notStrictEqual(fs.readFileSync(cuFile, 'utf8'), before, '前提：CU 描述字段已改');
    const a = assessOnSnapshot(root, fw, SNAPSHOT_CU_FEATURE);
    assert(fs.readFileSync(path.join(dir, 'contracts.yaml')).equals(contracts), 'contracts.yaml 字节被改');
    assert.strictEqual(a.record.state, 'ok', brief(a));
    const design = obligation(a, 'design-context:candidate');
    assert(design.owner_phase === 'plan' && design.status === 'uncovered' && design.class === 'binding'
      && (design.reason ?? '').includes('CU 绑定失配'), brief(a));
    assert.strictEqual(a.complete, false);
  }) },
  { name: '★3 手改完成原件 phases[].run_id（同步投影哈希）→ record broken，义务不因此 uncovered', run: () => withSnapshot((root, fw) => {
    const projectionFile = featureFilePath(root, SNAPSHOT_CU_FEATURE, 'feature-completion.json');
    const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
    const originalFile = path.join(root, projection.original_path);
    const original = JSON.parse(fs.readFileSync(originalFile, 'utf8'));
    original.phases[1].run_id = '20260101T000000Z-f0f0f0';
    const text = JSON.stringify(original, null, 2) + '\n';
    fs.writeFileSync(originalFile, text);
    fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, original_sha256: crypto.createHash('sha256').update(text, 'utf-8').digest('hex') }));
    const a = assessOnSnapshot(root, fw, SNAPSHOT_CU_FEATURE);
    assert.strictEqual(a.record.state, 'broken', brief(a));
    assert(a.record.state === 'broken' && a.record.reasons.some(r => r.includes('20260101T000000Z-f0f0f0')), brief(a));
    assert(a.obligations.every(o => o.status === 'covered'), brief(a));
    assert.strictEqual(a.complete, false);
  }) },
  { name: '#18 只改 acceptance.yaml（CU 链首为 coding）→ 验收义务 uncovered/binding；coding 义务不得被判 uncovered/result', run: () => withSnapshot((root, fw) => {
    const acceptance = featureFilePath(root, SNAPSHOT_CU_FEATURE, 'acceptance.yaml');
    fs.appendFileSync(acceptance, '# reviewer note: wording only\nextra_note: changed\n');
    const a = assessOnSnapshot(root, fw, SNAPSHOT_CU_FEATURE);
    assert.strictEqual(a.record.state, 'ok', brief(a));
    const context = obligation(a, 'acceptance-context:candidate');
    assert(context.status === 'uncovered' && context.class === 'binding', brief(a));
    const coding = obligation(a, 'implementation:request');
    assert(!(coding.status === 'uncovered' && coding.class === 'result'), `coding 被判产品失败：${JSON.stringify(coding)}`);
    assert(!(coding.reason ?? '').includes('[execution_scope]'), JSON.stringify(coding));
    assert.strictEqual(a.complete, false);
  }) },
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
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: `feature-assessment: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `feature-assessment: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
