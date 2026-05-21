// ============================================================================
// hylyre-steps-normalize.unit.test.ts
// ============================================================================

import { normalizePlannedStepsInput } from '../../scripts/utils/hylyre-steps-normalize';
import { validatePlannedStepsArray } from '../../scripts/utils/hylyre-planned-step-lint';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'unwrap steps wrapper',
    run: () => {
      const r = normalizePlannedStepsInput({
        steps: [{ touch: { by_text: 'OK' } }],
      });
      if (!r.changed || r.steps.length !== 1) throw new Error(JSON.stringify(r));
      const v = validatePlannedStepsArray(r.steps);
      if (!v.ok) throw new Error('lint fail');
    },
  },
  {
    name: 'flatten action wrapper',
    run: () => {
      const r = normalizePlannedStepsInput([
        { action: { type: 'touch', by_text: 'OK' } },
      ]);
      const v = validatePlannedStepsArray(r.steps);
      if (!v.ok) throw new Error(JSON.stringify(v));
    },
  },
  {
    name: 'strip note field',
    run: () => {
      const r = normalizePlannedStepsInput([{ touch: { by_text: 'OK' }, note: 'TC-001' }]);
      const v = validatePlannedStepsArray(r.steps);
      if (!v.ok) throw new Error(JSON.stringify(v));
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
  for (const x of r) console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
