import { beginUnitCase } from '../utils/unit-cases';
import assert from 'assert';
import { designRepairNeedsContinuation, inheritRunProcessArgs } from '../../scripts/goal-phase-runtime';
import type { GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run(): Promise<void> }> = [
  { name: 'design continuation uses current causal halt, never a historical halt or a later unrelated stage', run: async () => {
    // Controlled observations exercise production dispatch, not rewritten historical logs.
    const repair = { type: 'design_authority_repair', phase: 'plan', stage: 'published', outcome: 'recovered' };
    const halt = { type: 'phase_halt', phase: 'plan', halt_reason: 'execution_scope_unresolved' };
    const end = { type: 'run_end', status: 'HALTED', halt_reason: 'execution_scope_unresolved' };
    const probe = (events: unknown[]) => designRepairNeedsContinuation(events as GoalRunEvent[], ['spec', 'plan', 'coding']);
    assert(probe([{ type: 'run_start' }, repair, halt, end]));
    assert(!probe([{ type: 'run_start' }, halt, end, { type: 'run_start' }, repair, { type: 'run_end', status: 'COMPLETED' }]));
    assert(!probe([{ type: 'run_start' }, repair, { ...halt, phase: 'coding' }, end]));
    assert(!probe([{ type: 'run_start' }, repair, { type: 'agent_invoke_start', phase: 'plan' }, halt, end]));
    assert.deepStrictEqual(inheritRunProcessArgs({}), []);
    assert.deepStrictEqual(inheritRunProcessArgs({ unattended: true, detach: true }), [], 'an unattended request does not grant process posture');
    assert.deepStrictEqual(inheritRunProcessArgs({ 'foreground-ok': false, 'detached-child': false }), []);
    assert.deepStrictEqual(inheritRunProcessArgs({ 'foreground-ok': true }), ['--foreground-ok']);
    assert.deepStrictEqual(inheritRunProcessArgs({ 'detached-child': true }), ['--detached-child']);
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); } finally { endUnitCase(); }
  }
  return results;
}
