// ============================================================================
// hdc-foreground-probe.unit.test.ts — aa dump -l foreground parse (no hdc)
// ============================================================================

import { isBundleForegroundInAaDump } from '../../hdc-foreground-probe';

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
    name: 'isBundleForegroundInAaDump: bundle name bracket form',
    run: () => {
      const dump = 'AbilityList:\n  bundle name [com.huawei.hmos.wallet] state RUNNING';
      assertEq(isBundleForegroundInAaDump(dump, 'com.huawei.hmos.wallet'), true, 'match');
    },
  },
  {
    name: 'isBundleForegroundInAaDump: bundle name colon form',
    run: () => {
      const dump = 'bundle name: com.example.app\nother bundle name: com.other.app';
      assertEq(isBundleForegroundInAaDump(dump, 'com.example.app'), true, 'match');
    },
  },
  {
    name: 'isBundleForegroundInAaDump: CRLF + inactive bundle only',
    run: () => {
      const dump = 'bundle name [com.other.app]\r\nno match here';
      assertEq(isBundleForegroundInAaDump(dump, 'com.huawei.hmos.wallet'), false, 'no match');
    },
  },
  {
    name: 'isBundleForegroundInAaDump: hdc error stderr',
    run: () => {
      assertEq(isBundleForegroundInAaDump('error: no targets', 'com.app'), false, 'stderr');
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
