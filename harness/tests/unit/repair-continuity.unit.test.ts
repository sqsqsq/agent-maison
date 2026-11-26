import { beginUnitCase } from '../utils/unit-cases';
import * as assert from 'assert';
import { repairInvocationCompleted } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

const fp = 'a'.repeat(64);
const request = { type: 'phase_backtrack_requested', to_phase: 'coding', invalidated_phases: ['coding', 'review'],
  candidates: [{ identity_schema: 'signal@1', item_fingerprint: fp }] };
const start = { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'R-coding-i17' };
const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });

test('invocation completion and historical fallback are exact and reject missing facts', () => {
  for (const extra of [{ timed_out: true }, { terminal_failure_observed: true }, {}]) {
    const events = [request, start, { type: 'agent_invoke_end', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, ...extra },
      { type: 'agent_process_settled', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, ...extra }];
    assert.strictEqual(repairInvocationCompleted(events, 'coding'), false);
    const completed = [...events, { type: 'phase_verdict', phase: 'coding', invoke_id: start.invoke_id, completion_observed: true, agent_failed: false }];
    assert.strictEqual(repairInvocationCompleted(completed, 'coding'), Object.keys(extra).length === 0);
    assert.strictEqual(repairInvocationCompleted([...events, { type: 'phase_verdict', phase: 'coding', invoke_id: 'other', completion_observed: true }], 'coding', start.invoke_id), false);
  }
  assert.strictEqual(repairInvocationCompleted([{ type: 'agent_process_settled', phase: 'coding' }], 'coding'), false);
  const finished = [request, start, { type: 'agent_invoke_end', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, completion_observed: true },
    { type: 'agent_process_settled', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1 }];
  assert.strictEqual(repairInvocationCompleted(finished, 'coding'), true, '真实完成仍可复用；并未恢复旧阶段队列');
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    const endUnitCase = beginUnitCase(c.name);
    if (!endUnitCase) continue;
    try { await c.run(); results.push({ name: c.name, ok: true }); }
    catch (e) { results.push({ name: c.name, ok: false, error: String((e as Error).message) }); }
    finally {  endUnitCase(); }
  }
  return results;
}
