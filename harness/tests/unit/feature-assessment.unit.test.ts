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
import { observeChangeUnitCompletion, resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { asChangeUnitArtifact, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import type { ExecutionScope } from '../../scripts/utils/execution-scope';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { seedCleanCompletionChain } from '../utils/completion-chain-seed';
import type { UnitCaseResult } from '../run-unit';
import * as YAML from 'yaml';
import { resolveSuccessorExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext } from '../../scripts/utils/types';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { handWriteProjections } from './component-design-handoff.unit.test';
import { changeProjectedAcceptance } from './successor-exit.unit.test';

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

// ---- plan c4e7a9b2 A1：手写产物按稳定 ID 对齐规范化投影 -------------------------------------------------
// 夹具 = 快照 + 生产 writer（handWriteProjections 去戳成手写、蓝图升版调和）；断言走生产入口：
// successor 出生范围（resolveSuccessorExecutionScope）与 assessFeature，不直接调比较函数。
const BLUEPRINT_ID = 'ledger-app-blueprint';
function bumpAndReconcile(root: string, mutate: (bp: Record<string, unknown>) => void): void {
  const file = componentBlueprintPath(root, BLUEPRINT_ID);
  const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
  bp.revision = Number(bp.revision) + 1;
  for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
  mutate(bp);
  fs.writeFileSync(file, YAML.stringify(bp));
  const r = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
  clearFrameworkConfigCache();
}
function ledgerDomain(bp: Record<string, unknown>): Record<string, any> {
  let hit: Record<string, any> | undefined;
  const visit = (value: unknown): void => {
    if (hit || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if ((value as { node_id?: string }).node_id === 'ledger-domain') { hit = value as Record<string, any>; return; }
    Object.values(value).forEach(visit);
  };
  visit(bp);
  assert(hit, '快照蓝图缺 ledger-domain');
  return hit!;
}
function editHandwritten(root: string, name: string, edit: (doc: Record<string, any>) => void): void {
  const file = featureFilePath(root, SNAPSHOT_CU_FEATURE, name);
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  edit(doc);
  fs.writeFileSync(file, YAML.stringify(doc));
  clearFrameworkConfigCache();
}
function bornScope(root: string, fw: string): ExecutionScope {
  const [source] = fs.readdirSync(featureFilePath(root, SNAPSHOT_CU_FEATURE, 'goal-runs')).filter(name => !name.startsWith('.'));
  const requirement = JSON.parse(fs.readFileSync(featureFilePath(root, SNAPSHOT_CU_FEATURE, path.join('goal-runs', source, 'manifest.json')), 'utf8')).requirement;
  clearFrameworkConfigCache();
  return resolveSuccessorExecutionScope(root, SNAPSHOT_CU_FEATURE, resolveWorkflowSpec(root, { frameworkRoot: fw }), fw, requirement, source)!;
}
const duty = (scope: ExecutionScope, kind: string) => {
  const found = scope.obligations.find(o => o.kind === kind && o.applicability === 'required');
  assert(found, `出生范围缺 required ${kind}：${JSON.stringify(scope.obligations.map(o => [o.id, o.applicability]))}`);
  return found!;
};
/** 出生范围：该定义义务未兑现、原因含缺口文本、责任阶段在链内；assessFeature(同一范围) 判 uncovered 且不能完成。 */
function assertAuthorityGap(root: string, fw: string, kind: 'acceptance-context' | 'design-context', text: string): void {
  const born = bornScope(root, fw);
  const owner = kind === 'acceptance-context' ? 'spec' : 'plan';
  const d = duty(born, kind);
  assert(!d.satisfied_by?.length && d.reason.includes(text), `${kind} 应未兑现且原因含「${text}」：${JSON.stringify(d)}`);
  assert(born.phase_chain.includes(owner), `${owner} 应入出生链：${JSON.stringify(born.phase_chain)}`);
  const a = assessFeature(root, SNAPSHOT_CU_FEATURE, { ...resolveChangeUnitExpectedExecution(root, SNAPSHOT_CU_FEATURE), frameworkRoot: fw, scope: born });
  // 出生范围里该义务无 satisfied_by，evidence 缺口先入（class 取首条），A1 缺口作为 binding 明细并列在 reason 中。
  const row = a.obligations.find(o => o.kind === kind && o.status === 'uncovered' && (o.reason ?? '').includes(text));
  assert(row && row.owner_phase === owner, `assess 应判 ${kind} uncovered 并列出缺口：${brief(a)}`);
  assert.strictEqual(a.complete, false);
}
function assertAuthorityAligned(root: string, fw: string): void {
  const born = bornScope(root, fw);
  for (const kind of ['acceptance-context', 'design-context']) {
    const d = duty(born, kind);
    assert(d.satisfied_by?.length && !/与当前设计权威不一致|authority_projection_invalid/.test(d.reason), `${kind} 应由当前绑定兑现：${JSON.stringify(d)}`);
  }
  assert(!born.phase_chain.includes('spec') && !born.phase_chain.includes('plan'), JSON.stringify(born.phase_chain));
}
const planGate = (root: string, fw: string) => checkChangeUnitFeatureProjection({
  projectRoot: root, frameworkRoot: fw, feature: SNAPSHOT_CU_FEATURE, phaseRule: {},
  featureSpec: new SpecLoader(root, undefined, undefined, fw).loadFeatureSpec(SNAPSHOT_CU_FEATURE),
} as unknown as CheckContext, 'plan').find(check => check.id === 'authoritative_content_aligned');

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
  { name: 'A1-3 手写产物在投影之外多一条 AC、contracts 多一个 ordered_steps 元素与一个文件 → 不判 drift，spec/plan 义务由当前绑定兑现', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    editHandwritten(root, 'acceptance.yaml', doc => { doc.criteria.push({ ...doc.criteria[0], id: 'AC-77', description: '手写补充' }); });
    assertAuthorityAligned(root, fw);
    assert.strictEqual(planGate(root, fw)?.status, 'PASS', JSON.stringify(planGate(root, fw)));
  }) },
  { name: 'A1-4 蓝图不携带机器验收 / 设计（宿主形状，投影 absent）→ A1 不判：义务照旧由当前绑定兑现、plan 门不出行', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    bumpAndReconcile(root, bp => {
      const strip = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(strip); return; }
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        delete record.acceptance; delete record.contracts; delete record.use_cases;
        Object.values(record).forEach(strip);
      };
      strip(bp.design_views);
    });
    assertAuthorityAligned(root, fw);
    assert.strictEqual(planGate(root, fw), undefined, '投影 absent 时 A1 门不适用');
  }) },
  // 偏离 §6 A1-6 原夹具：投影侧 acceptance.performance 行被 checkAcceptanceContent 强制带 id（无 id 即投影 invalid），
  // 「无身份对象行」在可达投影里落在 contracts 的嵌套行上（如 state_management[].subscriptions：只有 subscription_id）。
  { name: 'A1-6 投影含无身份对象行（subscriptions 行）、手写删除或改写 → drift <canonical 行>.<missing>，plan 入链不能完成；手写多加一行 → 不判', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    const missing = '"subscription_id":"ledger-page-subscription"}.<missing>';
    editHandwritten(root, 'contracts.yaml', doc => { doc.state_management[0].subscriptions[0].cleanup = 'keep observer'; });
    assertAuthorityGap(root, fw, 'design-context', missing);
    editHandwritten(root, 'contracts.yaml', doc => { doc.state_management[0].subscriptions = []; });
    assertAuthorityGap(root, fw, 'design-context', missing);
    editHandwritten(root, 'contracts.yaml', doc => {
      doc.state_management[0].subscriptions = [
        { subscription_id: 'ledger-page-subscription', consumer_ref: 'consumer:ledger-page', publication_ref: 'publication:ledger-changed', replay_or_snapshot: 'latest', cleanup: 'detach observer' },
        { subscription_id: 'hand-extra', consumer_ref: 'consumer:ledger-page', publication_ref: 'publication:ledger-changed', replay_or_snapshot: 'latest', cleanup: 'detach observer' },
      ];
    });
    assertAuthorityAligned(root, fw);
  }) },
  { name: 'A1-7 手写产物 + 蓝图升版改验收（既有 use-cases 与新投影冲突）→ 纯投影读取仍判 drift AC-1.expected_result；蓝图投影自身坏 → authority_projection_invalid，spec/plan 入链、出生不拒绝', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    bumpAndReconcile(root, changeProjectedAcceptance);
    assertAuthorityGap(root, fw, 'acceptance-context', 'AC-1.expected_result');
    bumpAndReconcile(root, bp => { ledgerDomain(bp).acceptance = '验收写成了一段文本'; });
    assertAuthorityGap(root, fw, 'acceptance-context', 'authority_projection_invalid');
    assertAuthorityGap(root, fw, 'design-context', 'authority_projection_invalid');
    assert.strictEqual(planGate(root, fw)?.status, 'FAIL', JSON.stringify(planGate(root, fw)));
  }) },
  { name: 'A1 codex 三轮：默认调用方不传 frameworkRoot（observeChangeUnitCompletion）→ 同样判出 AC-1.expected_result；assessFeature 传与不传逐字段相等', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    bumpAndReconcile(root, changeProjectedAcceptance);
    const cu = asChangeUnitArtifact(loadCanonicalChangeUnit(root, BLUEPRINT_ID, 'ledger-refresh').changeUnit);
    const observed = observeChangeUnitCompletion(root, cu);
    assert(observed.state === 'INCOMPLETE' && (observed.reasons ?? []).some(r => r.includes('AC-1.expected_result')), `observer 未传 frameworkRoot 也须判出漂移：${JSON.stringify(observed)}`);
    clearFrameworkConfigCache();
    const expected = resolveChangeUnitExpectedExecution(root, SNAPSHOT_CU_FEATURE);
    const withFw = assessFeature(root, SNAPSHOT_CU_FEATURE, { ...expected, frameworkRoot: fw });
    clearFrameworkConfigCache();
    const withoutFw = assessFeature(root, SNAPSHOT_CU_FEATURE, expected);
    assert(withFw.obligations.some(o => (o.reason ?? '').includes('AC-1.expected_result')), `前提：显式传 frameworkRoot 判出漂移：${brief(withFw)}`);
    assert.deepStrictEqual(withoutFw, withFw, '传与不传 frameworkRoot 裁决应逐字段相等');
  }) },
  { name: 'A1-7b 蓝图投影自带的 change_unit_ref 过期（权威侧校验）→ 纯读取仍 invalid → design-context authority_projection_invalid，不被覆盖成当前 ref 洗白', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    bumpAndReconcile(root, bp => {
      ledgerDomain(bp).contracts.change_unit.change_unit_ref = {
        artifact: 'change-unit@1', component_id: 'ledger', blueprint_id: BLUEPRINT_ID, change_unit_id: 'ledger-refresh', revision: 1, artifact_sha256: '0'.repeat(64),
      };
    });
    assertAuthorityGap(root, fw, 'design-context', 'authority_projection_invalid');
    const gate = planGate(root, fw);
    assert(gate?.status === 'FAIL' && (gate.details ?? '').includes('CU 映射来源 stale'), JSON.stringify(gate));
  }) },
  { name: 'A1-8 ordered_steps 权威 A→B→C、手写 B→A→C → drift（顺序）；A→B→X→C 插入补充、files 顺序不同集合相同 → 不判', run: () => withSnapshot((root, fw) => {
    handWriteProjections(root);
    editHandwritten(root, 'contracts.yaml', doc => { const steps = doc.state_management[0].ordered_steps; [steps[0], steps[1]] = [steps[1], steps[0]]; });
    assertAuthorityGap(root, fw, 'design-context', 'ledger.ordered_steps');
    const gate = planGate(root, fw);
    assert(gate?.status === 'FAIL' && (gate.details ?? '').includes('ledger.ordered_steps: 期望='), JSON.stringify(gate));
    editHandwritten(root, 'contracts.yaml', doc => {
      const steps = doc.state_management[0].ordered_steps;
      [steps[0], steps[1]] = [steps[1], steps[0]];
      steps.splice(2, 0, '手写插入的补充步骤');
      doc.files.reverse();
    });
    assertAuthorityAligned(root, fw);
    assert.strictEqual(planGate(root, fw)?.status, 'PASS', JSON.stringify(planGate(root, fw)));
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
