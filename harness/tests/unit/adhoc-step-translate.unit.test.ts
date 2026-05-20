// ============================================================================
// adhoc-step-translate.unit.test.ts
// ============================================================================

import {
  injectColdStartWaitFor,
  plannedStepsToCellJson,
  translateNaturalStepToPlanned,
  translateNaturalStepsToPlanned,
} from '../../scripts/utils/adhoc-step-translate';

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

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected to include ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'translateNaturalStepToPlanned: 点击 by_text',
    run: () => {
      const r = translateNaturalStepToPlanned('点击「首页」');
      assertEq(JSON.stringify(r), JSON.stringify({ touch: { by_text: '首页' } }), 'touch');
    },
  },
  {
    name: 'translateNaturalStepToPlanned: 返回',
    run: () => {
      const r = translateNaturalStepToPlanned('返回');
      assertEq(JSON.stringify(r), JSON.stringify({ back: {} }), 'back');
    },
  },
  {
    name: 'translateNaturalStepsToPlanned: 打开应用 skipped',
    run: () => {
      const r = translateNaturalStepsToPlanned(['打开应用', '点击首页']);
      assertEq(r.length, 1, 'count');
      assertEq(JSON.stringify(r[0]), JSON.stringify({ touch: { by_text: '首页' } }), 'touch');
    },
  },
  {
    name: 'injectColdStartWaitFor: prepends wait_for',
    run: () => {
      const r = injectColdStartWaitFor([{ touch: { by_text: '首页' } }], 2000);
      assertEq(r.length, 2, 'count');
      assertEq(JSON.stringify(r[0]), JSON.stringify({ wait_for: { duration: 2000 } }), 'wait');
    },
  },
  {
    name: 'injectColdStartWaitFor: empty planned still gets wait_for',
    run: () => {
      const r = injectColdStartWaitFor([], 1500);
      assertEq(r.length, 1, 'count');
      assertEq(JSON.stringify(r[0]), JSON.stringify({ wait_for: { duration: 1500 } }), 'wait');
    },
  },
  {
    name: 'plannedStepsToCellJson: semicolon joined',
    run: () => {
      const cell = plannedStepsToCellJson([{ back: {} }, { touch: { by_text: '首页' } }]);
      assertIncludes(cell, '{"back":{}}', 'back');
      assertIncludes(cell, '{"touch":{"by_text":"首页"}}', 'touch');
      assertIncludes(cell, ' ; ', 'separator');
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
