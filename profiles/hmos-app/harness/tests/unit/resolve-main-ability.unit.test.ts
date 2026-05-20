// ============================================================================
// resolve-main-ability.unit.test.ts — bm dump main ability parsing
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverMainAbilityFromBmDumpDetailed } from '../../hdc-runner';
import { markAppMetaCacheStale } from '../../resolve-main-ability';

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
  {
    name: 'markAppMetaCacheStale: writes app-meta.stale sentinel',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-meta-stale-'));
      const cfgPath = path.join(root, 'framework.config.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          project_profile: 'hmos-app',
          tools: { hylyre: { app_snapshot_cache_dir: 'doc/app-snapshot-cache' } },
        }),
      );
      const bundle = 'com.test.app';
      const metaDir = path.join(root, 'doc', 'app-snapshot-cache', bundle);
      fs.mkdirSync(metaDir, { recursive: true });
      const metaPath = path.join(metaDir, 'app-meta.json');
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ bundleName: bundle, mainAbility: 'WrongAbility', source: 'bm_dump' }),
      );
      markAppMetaCacheStale(root, bundle);
      const stalePath = path.join(metaDir, 'app-meta.stale');
      if (!fs.existsSync(stalePath)) throw new Error('stale sentinel missing');
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
