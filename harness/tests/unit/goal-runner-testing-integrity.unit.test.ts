import { beginUnitCase } from '../utils/unit-cases';
import { repairInvocationCompleted, repairWindowCompleted } from '../../scripts/utils/goal-runner-phase';
import { resolveExecutionScope, scopeRevisionInvalidations } from '../../scripts/utils/execution-scope';
import type { UnitCaseResult } from '../run-unit';
import { resolveValidationOnlyEligibility } from '../../scripts/utils/goal-runner-phase';
import { type WorkflowSpec } from '../../workflow-loader';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [];

function test(name: string, run: () => Promise<void>): void { cases.push({ name, run }); }

test('T1-5 mixed-case env 清理：extraEnv 注入键唯一（父环境残留大小写变体被清除）', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildAgentSpawnEnv } = require('../../scripts/utils/agent-invoke') as {
    buildAgentSpawnEnv: (base: NodeJS.ProcessEnv, extra?: Record<string, string>) => NodeJS.ProcessEnv;
  };
  const base: NodeJS.ProcessEnv = { Harness_Device_Test_Product: 'stale', PATH: process.env.PATH };
  const env = buildAgentSpawnEnv(base, { HARNESS_DEVICE_TEST_PRODUCT: 'frozen' });
  const keys = Object.keys(env).filter(k => k.toLowerCase() === 'harness_device_test_product');
  assert(keys.length === 1 && keys[0] === 'HARNESS_DEVICE_TEST_PRODUCT' && env[keys[0]] === 'frozen',
    `注入键须唯一且为大写冻结值：${JSON.stringify(keys.map(k => [k, env[k]]))}`);
});

test('followup-20261006 S1 legacy validation-only outside repair does not invent invocation completion', async () => {
  const legacy = [
    { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'old-coding-i1', exit_code: 1 },
    { type: 'agent_process_settled', phase: 'coding', invoke_id: 'old-coding-i1', exit_code: 1 },
    { type: 'harness_end', phase: 'coding', invoke_id: 'old-coding-i1' },
    { type: 'phase_halt', phase: 'coding', run_disposition: 'WAITING' },
  ];
  assert(resolveValidationOnlyEligibility(legacy, { requireInterrupt: true })?.invoke_id === 'old-coding-i1', 'outside-window legacy revalidation must survive');
  assert(!repairInvocationCompleted(legacy, 'coding', 'old-coding-i1'), 'compatibility must not invent a successful invocation');
  const outsideRequest = { type: 'phase_backtrack_requested', to_phase: 'plan', invalidated_phases: ['plan', 'coding'] };
  const plan = [
    { type: 'agent_invoke_end', phase: 'plan', invoke_id: 'plan-i1', exit_code: 0 },
    { type: 'phase_verdict', phase: 'plan', invoke_id: 'plan-i1', verdict: 'PASS', action: 'advance', agent_failed: false },
  ];
  const request = { type: 'phase_backtrack_requested', to_phase: 'coding', invalidated_phases: ['coding'] };
  assert(resolveValidationOnlyEligibility([request, ...legacy], { requireInterrupt: true }) === null, 'repair unknown must return to its owner');
  const timeout = legacy.map(event => event.type === 'agent_process_settled' ? { ...event, timed_out: true, kill_reason: 'agent_timeout' } : event);
  assert(resolveValidationOnlyEligibility(timeout, { requireInterrupt: true }) === null, 'known timeout is never validation-only');
  assert(resolveValidationOnlyEligibility([...legacy, request], { requireInterrupt: true }) === null, 'new request supersedes old halt eligibility');
  assert(resolveValidationOnlyEligibility([...legacy, { type: 'phase_invalidated', phase: 'coding' }], { requireInterrupt: true }) === null, 'new invalidation supersedes old halt eligibility');
});

test('followup-20261006 S2 window completion survives later interruption but never crosses a new request or invalidation', async () => {
  const request = { type: 'phase_backtrack_requested', to_phase: 'coding', invalidated_phases: ['coding', 'review'],
    candidates: [{ identity_schema: 'signal@1', item_fingerprint: 'a'.repeat(64) }] };
  const first = [
    { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'first' },
    { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'first', exit_code: 0 },
    { type: 'agent_process_settled', phase: 'coding', invoke_id: 'first', exit_code: 0 },
    { type: 'phase_backtrack_completed', to_phase: 'coding' },
    { type: 'phase_verdict', phase: 'coding', invoke_id: 'first', verdict: 'FAIL', action: 'retry', agent_failed: false },
  ];
  const second = [
    { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'second' },
    { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'second', exit_code: 1, timed_out: true },
    { type: 'agent_process_settled', phase: 'coding', invoke_id: 'second', exit_code: 1, timed_out: true },
    { type: 'phase_verdict', phase: 'coding', invoke_id: 'second', verdict: 'PASS', action: 'advance', agent_failed: true },
  ];
  const window = [request, ...first, ...second];
  assert(!repairInvocationCompleted(window, 'coding', 'second'), 'current invocation must remain interrupted');
  assert(repairWindowCompleted(window, 'coding'), 'the earlier real owner completion remains a window fact');
  const outcomes = [{ phase: 'coding', verdict: 'PASS', retries: 1 }];
  for (const boundary of [request, { type: 'phase_invalidated', phase: 'coding' }]) {
    const cut = [request, ...first, boundary, ...second];
    assert(!repairWindowCompleted(cut, 'coding'), 'a new boundary cannot borrow old completion');
  }
  assert(!repairWindowCompleted([request, ...second], 'coding'), 'host timeout-only window remains unfinished');

  const proofWorkflow: WorkflowSpec = { schema_version: '1.2', name: 'proof-refresh', auto_chain: ['plan', 'coding'], artifacts: [
    { id: 'plan', scope: 'feature', requires: [], obligation_provider_id: 'obligations.plan' },
    { id: 'coding', scope: 'feature', requires: [], obligation_provider_id: 'obligations.coding' },
  ] };
  const priorScope = resolveExecutionScope({ contract_fingerprints: [], request: { completion_target: 'request', requested_results: ['current design and implementation'], requested_phases: ['plan', 'coding'] }, facts: [
    { id: 'design:cu', kind: 'design-context', applicability: 'required', reason: 'same unproved design duty', basis: [] },
    { id: 'design-decision:method', kind: 'design-decision', applicability: 'required', reason: 'current method evidence', basis: [],
      satisfied_by: [{ phase: 'plan', run_id: 'proof-window', evidence_manifest_aggregate: 'a'.repeat(64) }] },
    { id: 'implementation:source', kind: 'implementation', applicability: 'required', reason: 'same implementation duty', basis: [] },
  ] }, proofWorkflow);
  const refreshed = { ...priorScope, obligations: priorScope.obligations.map(obligation => obligation.id === 'design-decision:method'
    ? { ...obligation, satisfied_by: [{ phase: 'plan', run_id: 'proof-window', evidence_manifest_aggregate: 'b'.repeat(64) }] } : obligation) };
  const completed = new Set(['plan', 'coding']);
  assert(scopeRevisionInvalidations(priorScope, refreshed, ['plan', 'coding'], completed, proofWorkflow).length === 0,
    'refreshing one real proof cannot revoke another unchanged duty which never had a proof');
  const withdrawn = { ...refreshed, obligations: refreshed.obligations.map(obligation => obligation.id === 'design-decision:method' ? { ...obligation, satisfied_by: undefined } : obligation) };
  assert(scopeRevisionInvalidations(refreshed, withdrawn, ['plan', 'coding'], completed, proofWorkflow).includes('plan'), 'explicit withdrawal must still invalidate the old proof');
  const changedBasis = { ...refreshed, obligations: refreshed.obligations.map(obligation => obligation.id === 'design:cu' ? { ...obligation, basis: [{ input_id: 'contracts', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, dependencies: [], source_refs: [], content_fingerprint: 'c'.repeat(64) }] } : obligation) };
  assert(scopeRevisionInvalidations(refreshed, changedBasis, ['plan', 'coding'], completed, proofWorkflow).includes('plan'), 'a genuinely changed basis after a completed check must require new proof');
  const addedDuty = { ...refreshed, obligations: [...refreshed.obligations, { id: 'implementation:new', kind: 'implementation', owner_phase: 'coding', applicability: 'required' as const, reason: 'new actual duty', basis: [] }] };
  assert(scopeRevisionInvalidations(refreshed, addedDuty, ['plan', 'coding'], completed, proofWorkflow).includes('coding'), 'a new required duty must still invalidate its completed owner');
  assert(!refreshed.obligations.find(obligation => obligation.id === 'design:cu')?.satisfied_by?.length, 'avoiding a false invalidation must never manufacture satisfaction of the unknown design duty');
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const item of cases) {
    const endUnitCase = beginUnitCase(item.name);
    if (!endUnitCase) continue;
    try { await item.run(); results.push({ name: item.name, ok: true }); }
    catch (error) { results.push({ name: item.name, ok: false, error: (error as Error).stack }); } finally { endUnitCase(); }
  }
  return results;
}
