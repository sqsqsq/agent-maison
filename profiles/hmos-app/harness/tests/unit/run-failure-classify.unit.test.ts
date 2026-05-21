// ============================================================================
// run-failure-classify.unit.test.ts
// ============================================================================

import { classifyRunFailure } from '../../providers/device-test-run';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classifyRunFailure: python_traceback',
    run: () => {
      const out = 'Traceback (most recent call last):\n  File "x.py"';
      assertEq(classifyRunFailure(out, 1), 'python_traceback', 'kind');
    },
  },
  {
    name: 'classifyRunFailure: hypium_timeout',
    run: () => {
      assertEq(classifyRunFailure('operation timed out', 1), 'hypium_timeout', 'kind');
    },
  },
  {
    name: 'classifyRunFailure: device_disconnect',
    run: () => {
      assertEq(classifyRunFailure('no devices found', 1), 'device_disconnect', 'kind');
    },
  },
  {
    name: 'classifyRunFailure: step_unrecognized',
    run: () => {
      assertEq(classifyRunFailure('unknown step type foo', 1), 'step_unrecognized', 'kind');
    },
  },
  {
    name: 'classifyRunFailure: step_field_invalid wait requires seconds',
    run: () => {
      const out = 'ValueError: wait requires seconds\nTraceback (most recent call last):';
      assertEq(classifyRunFailure(out, 1), 'step_field_invalid', 'kind');
    },
  },
  {
    name: 'classifyRunFailure: unknown',
    run: () => {
      assertEq(classifyRunFailure('generic failure', 1), 'unknown', 'kind');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
