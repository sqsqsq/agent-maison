// ============================================================================
// resolve-main-ability.unit.test.ts — bm dump main ability parsing
// ============================================================================

import { discoverMainAbilityFromBmDumpDetailed } from '../../hdc-runner';

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
    name: 'discoverMainAbilityFromBmDump: JSON abilityInfos standard visible',
    run: () => {
      const dump = JSON.stringify({
        abilityInfos: [
          { name: 'MainAbility', launchType: 'standard', visible: true },
          { name: 'OtherAbility', launchType: 'standard', visible: false },
        ],
      });
      const r = discoverMainAbilityFromBmDumpDetailed(dump);
      assertEq(r.ability, 'MainAbility', 'ability');
    },
  },
  {
    name: 'discoverMainAbilityFromBmDump: text MainAbility fallback',
    run: () => {
      const dump = 'abilityInfos: [ { "name": "MainAbility" } ]';
      const r = discoverMainAbilityFromBmDumpDetailed(dump);
      assertEq(r.ability, 'MainAbility', 'ability');
    },
  },
  {
    name: 'discoverMainAbilityFromBmDump: empty → null',
    run: () => {
      const r = discoverMainAbilityFromBmDumpDetailed('');
      assertEq(r.ability, null, 'ability');
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
