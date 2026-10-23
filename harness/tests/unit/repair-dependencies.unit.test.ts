import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { loadWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import { clearFrameworkConfigCache, receiptDirPath } from '../../config';
import { resolveExecutionScope, affectedScopePhases, authorizedScopePhases, scopeDependencyEdges, scopeProofHistory, projectScopeSchedule, effectiveScopeView } from '../../scripts/utils/execution-scope';
import { checkUpstreamVerdictGate, readUpstreamPhaseView } from '../../scripts/utils/upstream-verdict-gate';
import { resolvePhaseEvidenceManifest, writePhaseEvidenceManifest, phaseEvidenceManifestPath } from '../../scripts/utils/phase-evidence-manifest';
import { classifyCorrection, mapCategoryToPhase, mapCategoryToChainPhase } from '../../scripts/utils/correction-routing';
import { setupGoalRuntimeHost } from './goal-runner-testing-integrity.unit.test';
import type { InputBinding } from '../../scripts/utils/capability-resolution';

const FRAMEWORK = path.resolve(__dirname, '../../..');
const workflow = loadWorkflowSpec(FRAMEWORK, 'obligation-driven');
const scopeFor = (phases: string[]) => resolveExecutionScope({ request: { completion_target: 'request', requested_results: ['original requested result'], requested_phases: phases }, facts: [], contract_fingerprints: [] }, workflow);
function summary(root: string, phase: string, value: unknown): void {
  const dir = path.join(receiptDirPath(root, 'bc-openCard', phase), 'reports'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(value));
}
function gate(root: string, phase: string) { return checkUpstreamVerdictGate({ projectRoot: root, frameworkRoot: FRAMEWORK, feature: 'bc-openCard', phase }); }
export interface UnitCaseResult { name: string; ok: boolean; error?: string }
const cases: Array<{ name: string; run(): void }> = [
  { name: '真实requires使review与UT并列，UT返修只撤UT与testing，不撤spec/plan/review', run() {
    const scope = scopeFor(['coding', 'review', 'ut', 'testing']);
    assert.deepStrictEqual(affectedScopePhases(['ut'], workflow.auto_chain!, { scope, workflow }), ['ut', 'testing']);
    assert.deepStrictEqual(affectedScopePhases(['review'], workflow.auto_chain!, { scope, workflow }), ['review', 'testing']);
    assert.deepStrictEqual(affectedScopePhases(['coding'], workflow.auto_chain!, { scope, workflow }), ['coding', 'review', 'ut', 'testing']);
    const history = scopeProofHistory(scope, [{ type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'advance' }, { type: 'phase_verdict', phase: 'ut', verdict: 'FAIL' }], workflow.auto_chain!, undefined, workflow);
    assert(history.passed.has('review')); assert(!history.invalidated.has('review')); assert(history.invalidated.has('testing'));
  } },
  { name: '真实绑定和control edge可增加依赖；没有依赖上下文时不再按队列后缀作废', run() {
    const scope = scopeFor(['coding', 'review', 'ut']);
    const binding: InputBinding = { input_id: 'unit_source', source: { kind: 'derive', provider_id: 'derive.test-targets' }, dependencies: [{ path: 'test.ets', exists: true, sha256: 'a'.repeat(64), role: 'derive' }], source_refs: ['test.ets'], content_fingerprint: 'b'.repeat(64) };
    scope.obligations.find(item => item.owner_phase === 'review')!.basis.push(binding);
    assert(scopeDependencyEdges(scope, workflow, new Map([['test.ets', 'ut']])).some(edge => edge.before === 'ut' && edge.after === 'review'));
    assert.deepStrictEqual(affectedScopePhases(['ut'], workflow.auto_chain!), ['ut']);
    scope.control_edges = [{ before: 'ut', after: 'review', basis: [binding] }];
    assert.deepStrictEqual(affectedScopePhases(['ut'], workflow.auto_chain!, { scope, workflow }), ['review', 'ut', 'testing']);
    assert(projectScopeSchedule(scope, workflow).phase_chain.indexOf('ut') < projectScopeSchedule(scope, workflow).phase_chain.indexOf('review'));
  } },
  { name: 'pending review→UT派修与resume使用同一义务排序，owner完成或拒修后回原评审裁定', run() {
    const birth = scopeFor(['coding', 'review', 'ut', 'testing']);
    const events = [{ type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'ut' }];
    const pending = effectiveScopeView({ birth, events, workflow });
    assert.deepStrictEqual(pending.phase_chain, ['coding', 'ut', 'review', 'testing']);
    assert.deepStrictEqual(effectiveScopeView({ birth, events, workflow }).phase_chain, pending.phase_chain);
    const declinedEvents = [...events, { type: 'phase_backtrack_completed', to_phase: 'ut', result: 'declined' }];
    assert.deepStrictEqual(effectiveScopeView({ birth, events: declinedEvents, workflow }).phase_chain, ['coding', 'review', 'ut', 'testing']);
    birth.control_edges = [{ before: 'review', after: 'ut', basis: [{ input_id: 'review', source: { kind: 'derive', provider_id: 'derive.test-targets' }, dependencies: [], source_refs: [], content_fingerprint: 'a'.repeat(64) }] }];
    assert(effectiveScopeView({ birth, events, workflow }).phase_chain.indexOf('review') < effectiveScopeView({ birth, events, workflow }).phase_chain.indexOf('ut'));
  } },
  { name: '实际manifest输入边即使未重复在obligation.basis，也贯通重开、历史失效和调度', run() {
    const scope = scopeFor(['coding', 'review', 'ut']);
    const independent = { ...workflow, artifacts: workflow.artifacts.map(artifact => ({ ...artifact, requires: [] })) };
    const inputEdges = [{ before: 'ut', after: 'review' }];
    assert.deepStrictEqual(affectedScopePhases(['ut'], workflow.auto_chain!, { scope, workflow: independent, inputEdges }), ['review', 'ut']);
    const history = scopeProofHistory(scope, [{ type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'advance' }, { type: 'phase_verdict', phase: 'ut', verdict: 'FAIL' }], workflow.auto_chain!, undefined, independent, { inputEdges });
    assert(!history.passed.has('review'));
    assert(history.invalidated.has('review'));
    const view = effectiveScopeView({ birth: scope, events: [], workflow: independent, reopen: 'ut', inputEdges });
    assert(view.phase_chain.indexOf('ut') < view.phase_chain.indexOf('review'));
  } },
  { name: '原实现义务允许request必要验证；纯review request不能借队列/终点标签取得coding权限', run() {
    assert(authorizedScopePhases(scopeFor(['coding']), workflow).includes('ut'));
    assert(authorizedScopePhases(scopeFor(['coding']), workflow).includes('testing'));
    assert(!authorizedScopePhases(scopeFor(['review']), workflow).includes('coding'));
    const borrowedDesign = scopeFor(['review']);
    for (const owner of ['spec', 'plan']) borrowedDesign.obligations.push({ id: `borrowed-${owner}`, kind: owner === 'spec' ? 'acceptance-context' : 'design-context', owner_phase: owner,
      applicability: 'required', reason: 'borrowed context', basis: [], satisfied_by: [{ input_id: 'borrowed', source: { kind: 'artifact', artifact: owner === 'spec' ? 'acceptance@1' : 'contracts@1' }, dependencies: [], source_refs: [], content_fingerprint: 'a'.repeat(64) }] });
    assert(!authorizedScopePhases(borrowedDesign, workflow).includes('spec'));
    assert(!authorizedScopePhases(borrowedDesign, workflow).includes('plan'), 'borrowed design input is not a modification duty');
    const reviewCarrier = scopeFor(['review']); reviewCarrier.completion_target = 'feature'; reviewCarrier.requested_results = ['review'];
    assert(!authorizedScopePhases(reviewCarrier, workflow).includes('coding'), '明确review结果不因载体终点标签取得写源码许可');
    const reused = scopeFor(['ut']); reused.phase_chain = []; reused.reused_phases = [{ phase: 'ut', obligation_ids: reused.obligations.map(item => item.id), evidence_refs: [{ phase: 'ut', evidence_manifest_aggregate: 'a'.repeat(64) }] }];
    assert(authorizedScopePhases(reused, workflow).includes('ut'));
  } },
  { name: 'correction按真实provider或明确对象定位；缺少或多义verification不猜UT也不回队首', run() {
    assert.strictEqual(mapCategoryToPhase('verification', workflow, 'full'), null);
    assert.strictEqual(mapCategoryToChainPhase('spec', ['coding', 'review'], 'full'), null);
    const custom: WorkflowSpec = { schema_version: '1.2', name: 'custom', artifacts: [{ id: 'build', scope: 'feature', requires: [], obligation_provider_id: 'obligations.coding' }, { id: 'unit-check', scope: 'feature', requires: ['build'], obligation_provider_id: 'obligations.ut' }] };
    assert.strictEqual(mapCategoryToPhase('coding', custom, 'full'), 'build');
    assert.strictEqual(mapCategoryToPhase('verification', custom, 'full'), 'unit-check');
    const scope = scopeFor(['coding', 'review', 'ut', 'testing']);
    const routed = classifyCorrection({ answers: { requirement_changed: false, contract_changed: false, code_change_needed: false }, spec: workflow, track: 'full', closedPhases: ['review', 'ut', 'testing'], context: { executionScope: scope, target: { owner: 'ut' } } });
    assert.strictEqual(routed.root_layer, 'ut'); assert.deepStrictEqual(routed.revalidate.map(item => item.phase), ['ut', 'testing']);
  } },
  { name: '生产上游门允许UT处理review待修问题，testing仍保留真实review否决', run() {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      summary(root, 'review', { schema_version: '1.0', verdict: 'FAIL', blocker_count: 1, blockers: [{ id: 'negative_verdict_closure' }] });
      assert(!gate(root, 'ut').some(check => check.status === 'FAIL'));
      assert(gate(root, 'testing').some(check => check.status === 'FAIL' && check.details?.includes('[review]')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'coding只因待采纳测试失败时UT可承接；真实生产失败或混合blocker仍挡UT', run() {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const file = '02-Feature/FinancialCard/src/ohosTest/ets/test/Value.test.ets'; fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'export const fixture = true;');
      const adoption = { id: 'coding_existing_test_preserved', repair_owner: 'ut', affected_files: [file] };
      summary(root, 'coding', { schema_version: '1.0', verdict: 'FAIL', blocker_count: 1, blockers: [adoption] });
      const allowed = gate(root, 'ut'); assert(!allowed.some(check => check.status === 'FAIL'), JSON.stringify(allowed));
      summary(root, 'coding', { schema_version: '1.0', verdict: 'FAIL', blocker_count: 2, blockers: [adoption,
        { id: 'coding_run_status', details_excerpt: 'can_claim_done: NO\ncoding_compile: PASS\nblocker_fail_count: 1\ncritical_skip_count: 0\nblocking_warn_count: 0\nblocker_fail_ids: coding_existing_test_preserved' }] });
      assert(!gate(root, 'ut').some(check => check.status === 'FAIL'), '已由源失败表达的run_status聚合不能反挡真实UT修复');
      summary(root, 'coding', { schema_version: '1.0', verdict: 'FAIL', blocker_count: 2, blockers: [adoption, { id: 'production_compile', affected_files: ['02-Feature/FinancialCard/src/main/ets/Index.ets'] }] });
      assert(gate(root, 'ut').some(check => check.status === 'FAIL'));
      summary(root, 'coding', { schema_version: '1.0', verdict: 'FAIL', blocker_count: 1, blockers: [{ ...adoption, affected_files: ['02-Feature/FinancialCard/src/main/ets/Index.ets'] }] });
      assert(gate(root, 'ut').some(check => check.status === 'FAIL'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '真实旧PASS报告被当前测试FAIL覆盖时UT可工作，源码契约真stale或manifest篡改仍不可绕过', run() {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const testFile = '02-Feature/FinancialCard/src/ohosTest/ets/test/Value.test.ets';
      const production = '02-Feature/FinancialCard/src/main/ets/RuntimeInput.ets';
      for (const file of [testFile, production]) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'export const value = 1;'); }
      summary(root, 'coding', { schema_version: '1.0', verdict: 'PASS', blocker_count: 0, blockers: [] });
      const scriptReport = path.join(receiptDirPath(root, 'bc-openCard', 'coding'), 'reports/script-report.json');
      fs.writeFileSync(scriptReport, JSON.stringify({ summary: { verdict: 'PASS' } }));
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: 'bc-openCard', phase: 'coding', frameworkRoot: FRAMEWORK, extraInputs: [path.join(root, production)] }));
      summary(root, 'coding', { schema_version: '1.0', verdict: 'FAIL', blocker_count: 1,
        blocking_skips: [{ id: 'har_index_export', details_excerpt: '规则未声明，跳过' }, { id: 'named_business_handler', details_excerpt: 'use-cases.yaml不存在，跳过' }],
        blockers: [{ id: 'coding_existing_test_preserved', repair_owner: 'ut', affected_files: [testFile] }] });
      fs.writeFileSync(scriptReport, JSON.stringify({ summary: { verdict: 'FAIL' } }));
      const view = () => readUpstreamPhaseView(root, 'bc-openCard', 'coding', 'ut', undefined, FRAMEWORK);
      const reportOnly = view();
      assert.strictEqual(reportOnly.freshness, 'stale');
      assert(reportOnly.freshnessChangedPaths?.some(file => file.endsWith('summary.json')));
      assert(!gate(root, 'ut').some(check => check.status === 'FAIL'), '仅当前失败报告覆盖旧PASS不应反挡UT工作');
      assert.strictEqual(view().freshness, 'stale', '允许UT执行不能恢复旧coding PASS');
      fs.writeFileSync(path.join(root, production), 'export const value = 2;');
      assert(view().freshnessChangedPaths?.includes(production), '反例必须是真实业务源变化');
      assert(gate(root, 'ut').some(check => check.status === 'FAIL'), '业务源真stale不能借UT交接绕过');
      fs.writeFileSync(path.join(root, production), 'export const value = 1;');
      const contractsFile = path.join(root, 'doc/features/bc-openCard/contracts.yaml');
      const originalContracts = fs.readFileSync(contractsFile, 'utf8');
      fs.appendFileSync(contractsFile, '  - 02-Feature/FinancialCard/src/main/ets/NewInput.ets\n');
      assert(view().freshnessChangedPaths?.some(file => file.endsWith('contracts.yaml')), '契约反例必须真实变化');
      assert(gate(root, 'ut').some(check => check.status === 'FAIL'), '契约stale不能借UT交接绕过');
      fs.writeFileSync(contractsFile, originalContracts);
      const manifestFile = phaseEvidenceManifestPath(root, 'bc-openCard', 'coding');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); manifest.inputs[0].sha256 = 'f'.repeat(64); fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      assert.strictEqual(view().freshness, 'tampered');
      assert(gate(root, 'ut').some(check => check.status === 'FAIL'), '破损manifest不能因仅测试FAIL而放行');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
];
export function runAll(): UnitCaseResult[] { return cases.map(test => { try { test.run(); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: error instanceof Error ? error.stack : String(error) }; } }); }
