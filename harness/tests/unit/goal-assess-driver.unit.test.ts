import { beginUnitCase, discoveryResult } from '../utils/unit-cases';
import * as fs from 'fs';
import * as path from 'path';
import { checkAssessDrivenRunnerSource } from '../../scripts/utils/goal-assess-driver';
import { checkGoalReconcileBoundarySource, createGoalReconcileBoundary } from '../../scripts/utils/goal-reconcile-boundary';
import { assessObservation, type AssessObservation } from '../../scripts/utils/assess';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
const cases = [{
  name: 'current runtime consumes current work and cannot restore the retired phase selector',
  run() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/goal-phase-runtime.ts'), 'utf8');
    assert(!checkAssessDrivenRunnerSource(source).length, 'retired phase selection must not return');
    assert(!checkGoalReconcileBoundarySource(source).length, 'verdict publication must retain its single writer');
    for (const call of ['selectRunnerActionFromAssess({})', 'classifyPhaseVerdict({})']) {
      assert(checkAssessDrivenRunnerSource(call).length, 'source guard must actually reject ' + call);
    }
  },
}, {
  name: 'reconcile writer publishes actual verdicts verbatim without deciding the next author',
  run() {
    const events: Record<string, unknown>[] = [];
    const writer = createGoalReconcileBoundary(event => events.push(event));
    writer.emitPhaseVerdict({ phase: 'testing', verdict: 'FAIL', invoke_id: 'actual-tool', detail: 'original failure' });
    writer.emit({ type: 'phase_halt', halt_reason: 'executor_waiting', detail: 'actual producer unavailable' });
    assert(JSON.stringify(events) === JSON.stringify([
      { type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', invoke_id: 'actual-tool', detail: 'original failure' },
      { type: 'phase_halt', halt_reason: 'executor_waiting', detail: 'actual producer unavailable' },
    ]), 'writer must not rewrite verdicts, origins or reasons');
    assert(!('decideAndEmit' in writer), 'writer cannot dispatch phase actions');
  },
}, {
  name: 'assess reports the same current mixed repair and wait without granting a phase dispatch',
  run() {
    const currentDisposition = resolveCurrentDisposition({ endpoint: 'request', phases: [{ phase: 'testing', summaryPresent: true,
      schemaCurrent: true, closureCommitted: false, verdict: 'FAIL', checks: [
        { id: 'real_product_failure', status: 'FAIL', severity: 'BLOCKER', details: 'actual assertion failed' },
        { id: 'unavailable_device', status: 'FAIL', severity: 'BLOCKER', blocking_class: 'externalBlocked', failure_kind: 'device_blocked', details: 'device offline' },
      ] }] });
    const observation: AssessObservation = { schema_version: '1.0', feature: 'demo', workflow: 'wf', track: 'full', goal_end: 'testing',
      phases: [], currentDisposition, reconcile: null,
      fingerprints: { workflow: 'w', track: 't', goal: 'g', run_attempt: 'r', summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o' } };
    for (const mode of ['manual', 'goal_mode'] as const) {
      const assessed = assessObservation(observation, { mode });
      assert(assessed.recommendation.action === 'continue_work_unit' && assessed.recommendation.phase === null, 'current work stays in the dedicated unit');
      assert(assessed.recommendation.reason.includes('actual assertion failed') && assessed.recommendation.reason.includes('device offline'), 'first feedback must retain all determinate work and wait causes');
      assert(assessed.recommendation.runner_action === undefined, 'projection does not authorize dispatch');
      assert(!assessed.stop.fused && !assessed.run_status_candidate, 'mixed current failure cannot sign completion');
    }
  },
}];
export function runAll(): UnitCaseResult[] {
  return cases.map(test => { const endUnitCase = beginUnitCase(test.name);
                             if (!endUnitCase) return discoveryResult(test.name); try { test.run(); return { name: test.name, ok: true }; }
    catch (error) { return { name: test.name, ok: false, error: (error as Error).message }; } finally { endUnitCase(); } });
}
