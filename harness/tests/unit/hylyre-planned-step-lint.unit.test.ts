// ============================================================================
// hylyre-planned-step-lint.unit.test.ts
// ============================================================================

import { validatePlannedStepsArray } from '../../scripts/utils/hylyre-planned-step-lint';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'validatePlannedStepsArray: touch ok',
    run: () => {
      const r = validatePlannedStepsArray([{ touch: { by_text: '首页' } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for duration only FAIL',
    run: () => {
      const r = validatePlannedStepsArray([{ wait_for: { duration: 2000 } }]);
      if (r.ok) throw new Error('expected FAIL');
      if (!r.violations.some(v => v.rule_id === 'STEP-WAIT')) {
        throw new Error(`violations: ${JSON.stringify(r.violations)}`);
      }
    },
  },
  {
    name: 'validatePlannedStepsArray: wait_for with by_text ok',
    run: () => {
      const r = validatePlannedStepsArray([{ wait_for: { by_text: '首页', duration: 2000 } }]);
      if (!r.ok) throw new Error(JSON.stringify(r));
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
