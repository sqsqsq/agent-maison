import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { loadScopeRevisions } from '../../scripts/utils/goal-run-creation';
import { effectiveScopeView, authorizedScopePhases } from '../../scripts/utils/execution-scope';
import type { WorkflowSpec } from '../../workflow-loader';
import type { GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import { auditHostHistory, type HistoryEvent } from '../utils/host-history-audit';
import type { UnitCaseResult } from '../run-unit';

export const historyRoot = path.resolve(__dirname, '../fixtures/host-recovery-history');
export function readHostHistory(suffix: string, group = '20261016') {
  const dir = path.join(historyRoot, group, fs.readdirSync(path.join(historyRoot, group)).find(name => name.endsWith(suffix))!);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)) as HistoryEvent[];
  return { dir, manifest, events };
}

const cases: Array<{ name: string; run(): void }> = [
  { name: 'production obligation projection replays CR introduction without allowing an older plan PASS', run() {
    const { manifest, events } = readHostHistory('b9ac66');
    const order = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const workflow: WorkflowSpec = { schema_version: '1.2', name: 'history', auto_chain: order, artifacts: order.map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
    for (const revision of [3, 4]) {
      const end = events.findIndex(event => event.type === 'scope_revised' && event.revision_index === revision);
      const prefix = events.slice(0, end + 1);
      const view = effectiveScopeView({ birth: manifest.execution_scope, events: prefix, workflow });
      assert.equal(view.phase_chain[0], 'plan');
      assert(!view.obligations.find(o => o.id === 'design-decision:CR-001')!.satisfied_by);
      assert(!view.phase_chain.includes('spec'), 'unaffected spec remains reused');
      assert(view.phase_chain.includes('coding'), 'downstream old coding cannot cover changed plan');
    }
  } },
  { name: 'production obligation projection reopens repeated owner and stale upstream on FAIL', run() {
    const order = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const workflow: WorkflowSpec = { schema_version: '1.2', name: 'history', auto_chain: order, artifacts: order.map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
    for (const [run, owner] of [['b5ada8', 'plan'], ['b23184', 'coding']] as const) {
      const { manifest, events } = readHostHistory(run);
      const end = events.findIndex(event => event.type === 'phase_halt' && event.halt_reason === 'backtrack_target_absent');
      const view = effectiveScopeView({ birth: manifest.execution_scope, events: events.slice(0, end), workflow, reopen: owner });
      assert(view.phase_chain.includes(owner));
      assert(!view.phase_chain.includes('spec'));
      assert(!view.reused_phases.some(item => item.phase === owner));
    }
  } },
  { name: 'new repair PASS is accepted while downstream proofs remain invalid and non-applicable work stays absent', run() {
    const { manifest, events } = readHostHistory('b9ac66');
    const order = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const workflow: WorkflowSpec = { schema_version: '1.2', name: 'history', auto_chain: order, artifacts: order.map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
    const end = events.findIndex(e => e.type === 'scope_revised' && e.revision_index === 3);
    // A controlled new observation is deliberately NOT stored as historical fixture data.
    const prefix = [...events.slice(0, end + 1), { type: 'phase_verdict', phase: 'plan', verdict: 'PASS', action: 'advance' }];
    const proof = { phase: 'plan', run_id: 'current', evidence_manifest_aggregate: 'f'.repeat(64) };
    const view = effectiveScopeView({ birth: manifest.execution_scope, events: prefix, workflow, proofs: new Map([['plan', proof]]) });
    assert(!view.phase_chain.includes('plan'));
    assert(!view.phase_chain.includes('spec'));
    assert(view.phase_chain.includes('coding'));
    assert(view.obligations.find(o => o.id === 'design-decision:CR-001')!.satisfied_by?.length);
    const halted = effectiveScopeView({ birth: manifest.execution_scope, events: [...prefix, { type: 'phase_halt', phase: 'plan' }], workflow });
    assert(halted.phase_chain.includes('plan'), 'a later halt cannot be hidden by the earlier PASS');
  } },
  { name: 'direct backtrack without a candidate uses authorization rather than the remaining queue', run() {
    const { manifest, events } = readHostHistory('b9ac66');
    const order = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const workflow: WorkflowSpec = { schema_version: '1.2', name: 'history', auto_chain: order, artifacts: order.map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
    const end = events.findIndex(e => e.type === 'scope_revised' && e.revision_index === 4);
    assert(!events[end].execution_scope.phase_chain.includes('plan'), 'real recorded remaining queue omitted plan');
    assert(authorizedScopePhases(manifest.execution_scope, workflow).includes('plan'));
    const resumed = effectiveScopeView({ birth: manifest.execution_scope, events: events.slice(0, end + 1), workflow, reopen: 'plan' });
    assert.equal(resumed.phase_chain[0], 'plan');
    const request = { ...manifest.execution_scope, completion_target: 'request', phase_chain: ['ut'], reused_phases: [], unresolved: [],
      obligations: manifest.execution_scope.obligations.filter((o: { owner_phase: string }) => o.owner_phase === 'ut') };
    assert.throws(() => effectiveScopeView({ birth: request, events: [], workflow, reopen: 'plan' }), /outside authorization/);
    assert.doesNotThrow(() => effectiveScopeView({ birth: request, events: [], workflow, reopen: 'ut' }));
      const noDuty = { ...request, completion_target: 'feature' as const, phase_chain: [], obligations: [], reused_phases: [] };
      assert.deepStrictEqual(effectiveScopeView({ birth: noDuty, events: [], workflow, reopen: 'plan' }).phase_chain, ['plan']);
      const backtrack = { type: 'phase_backtrack_requested', to_phase: 'plan', invalidated_phases: ['plan'] };
      assert.deepStrictEqual(effectiveScopeView({ birth: noDuty, events: [backtrack], workflow }).phase_chain, ['plan']);
      assert.deepStrictEqual(effectiveScopeView({ birth: noDuty, events: [backtrack, { type: 'phase_verdict', phase: 'plan', verdict: 'PASS', action: 'advance' }], workflow }).phase_chain, []);
  } },
  { name: '17 real runs preserve recorded source hashes and scope revision chains', run() {
    const sources = JSON.parse(fs.readFileSync(path.join(historyRoot, 'sources.json'), 'utf8'));
    for (const file of sources.files) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(historyRoot, file.file))).digest('hex'), file.sha256, file.file);
    assert.equal(sources.files.filter((f: { file: string }) => f.file.endsWith('/manifest.json')).length, 17);
    for (const group of ['20261016', 'r5']) for (const name of fs.readdirSync(path.join(historyRoot, group))) {
      const { manifest, events } = readHostHistory(name, group);
      loadScopeRevisions(events as GoalRunEvent[], manifest.execution_scope);
    }
  } },
  { name: 'immutable history keeps detecting skipped owner, false waiting and forbidden guidance', run() {
    for (const [suffix, kind, count] of [
      ['b9ac66', 'owner_skipped', 1], ['71c521', 'waiting_advanced', 1],
      ['b5ada8', 'unsafe_guidance', 1], ['b9ac66', 'unsafe_guidance', 1], ['b23184', 'unsafe_guidance', 1],
      ['b5ada8', 'owner_absent', 1], ['b9ac66', 'owner_absent', 1], ['b23184', 'owner_absent', 1],
      ['408844', 'waiting_advanced', 0],
    ] as const) {
      const { manifest, events } = readHostHistory(suffix);
      assert.equal(auditHostHistory(manifest.execution_scope, events).filter(f => f.kind === kind).length, count, `${suffix}/${kind}`);
    }
  } },
  { name: '65403a raw execution failure contradicts code_regression; missing evidence is not invented', run() {
    const { dir, manifest, events } = readHostHistory('65403a');
    const result = fs.readFileSync(path.join(dir, 'frozen.ut-result.WalletMain.json'), 'utf8');
    assert(result.includes('aa_test_no_result'));
    const log = fs.readFileSync(path.join(dir, 'frozen.hdc-test.WalletMain.log'), 'utf8');
    assert(log.includes('start ability successfully'));
    assert(!log.includes('OHOS_REPORT_RESULT'));
    assert.equal(auditHostHistory(manifest.execution_scope, events, 'aa_test_no_result').filter(f => f.kind === 'execution_misclassified').length, 2);
    assert.equal(auditHostHistory(manifest.execution_scope, events).filter(f => f.kind === 'execution_misclassified').length, 0);
  } },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(test => { try { test.run(); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; } });
}
