import { runUnitCases } from '../utils/unit-cases';
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
    name: 'flatten touch preserves 0.6.0 mode, press_time, rich selector and wait_time',
    run: () => {
      const touch = { by_text: 'menu', match: 'exact', mode: 'long', press_time: 3, wait_time: 0.2, scope: 'top_overlay' };
      const result = normalizePlannedStepsInput([{ action: { type: 'touch', ...touch } }]);
      if (JSON.stringify(result.steps) !== JSON.stringify([{ touch }])) throw new Error(JSON.stringify(result));
    },
  },
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
  return runUnitCases(cases);
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
