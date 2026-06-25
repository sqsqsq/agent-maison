/**
 * goal-runner closure / receipt advance gate unit tests.
 */

import * as assert from 'assert';
import {
  resolveClosureAdvanceBlock,
  resolvePhaseHarnessVerdict,
} from '../../scripts/utils/goal-runner-phase';
import { resolveGoalRunStatus } from '../../scripts/utils/phase-transition-policy';

import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

test('resolveClosureAdvanceBlock: PASS + open closure → blocked', () => {
  const r = resolveClosureAdvanceBlock({
    verdict: 'PASS',
    closureStatus: 'open',
    receiptStatus: 'missing',
  });
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.reason, 'receipt_missing');
});

test('resolveClosureAdvanceBlock: PASS + closed → not blocked', () => {
  const r = resolveClosureAdvanceBlock({
    verdict: 'PASS',
    closureStatus: 'closed',
    receiptStatus: 'passed',
  });
  assert.strictEqual(r.blocked, false);
});

test('resolveClosureAdvanceBlock: headless_interaction takes precedence (closure blocked separately)', () => {
  const closure = resolveClosureAdvanceBlock({
    verdict: 'PASS',
    closureStatus: 'open',
    agentTimedOut: true,
  });
  assert.strictEqual(closure.reason, 'agent_timeout_unclosed');
});

test('resolvePhaseHarnessVerdict: fresh PASS + open receipt → advance_blocked', () => {
  const r = resolvePhaseHarnessVerdict({
    dryRun: false,
    agentExitCode: 1,
    harnessExitCode: 0,
    summaryBeforeMtime: 1000,
    summaryAfterMtime: 2000,
    summaryVerdict: 'PASS',
    closureStatus: 'open',
    receiptStatus: 'missing',
    agentTimedOut: true,
  });
  assert.strictEqual(r.verdict, 'PASS');
  assert.strictEqual(r.advance_blocked, true);
  assert.strictEqual(r.advance_block_reason, 'agent_timeout_unclosed');
});

test('resolveGoalRunStatus: timeout unclosed at end → PARTIAL not COMPLETED', () => {
  const status = resolveGoalRunStatus(
    [
      { phase: 'testing', agent_timed_out: true, advance_blocked: true },
    ],
    true,
  );
  assert.strictEqual(status, 'PARTIAL');
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
