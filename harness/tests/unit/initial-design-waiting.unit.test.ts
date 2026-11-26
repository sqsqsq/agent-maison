import { beginUnitCase } from '../utils/unit-cases';
import '../utils/transpile-only-env';
import assert from 'assert';
import { type GoalRunManifest } from '../../scripts/utils/goal-manifest';
import { deliveryExternalWait } from '../../scripts/utils/delivery-origin';
import type { UnitCaseResult } from '../run-unit';

async function externalContinuationIdentity(): Promise<void> {
  const endedAt = '2026-11-24T12:00:00.000Z';
  const end = { type: 'run_end', status: 'HALTED', halt_reason: 'executor_waiting', run_wait_kind: 'external', ts: endedAt } as const;
  const stopped = { manifest: { run_id: 'child-a' } as GoalRunManifest, events: [end] };
  const previous = deliveryExternalWait(stopped);
  assert.deepEqual(previous, { runId: 'child-a', endedAt, eventIndex: 0 });
  assert.equal(deliveryExternalWait({ ...stopped, events: [end, { type: 'run_start', ts: '2026-11-24T12:00:01.000Z' }] }), undefined,
    'starting the previously waiting child spends the original continuation');
  assert.equal(deliveryExternalWait({ ...stopped, events: [{ ...end, run_wait_kind: 'human' }] }), undefined);
  assert.notDeepEqual(deliveryExternalWait({ ...stopped, manifest: { ...stopped.manifest, run_id: 'child-b' } }), previous);
  assert.notDeepEqual(deliveryExternalWait({ ...stopped, events: [end, { ...end, ts: '2026-11-24T12:00:02.000Z' }] }), previous);
  assert.notDeepEqual(deliveryExternalWait({ ...stopped, events: [end, { type: 'run_start', ts: endedAt }, { ...end }] }), previous,
    'an external wait after a restart has a new identity even at the same recorded time');
}

const cases = [
  { name: '77105c47 external continuation binds the original stopped child and expires when it starts', run: externalContinuationIdentity },
];
export function getCases() { return cases; }
const dailyPrefixes = [
  "77105c47 waiting author",
  "77105c47 external continuation",
  "d18f6c42 timeout invocation",
  "d18f6c42 terminal-failure invocation",
  "d18f6c42 transport invocation"
];
export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally {  endUnitCase(); }
  }
  return results;
}
if (require.main === module) void runAll().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.some(row => !row.ok) ? 1 : 0; });
