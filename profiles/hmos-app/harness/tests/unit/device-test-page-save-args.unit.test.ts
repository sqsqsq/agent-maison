import { buildHylyreAppPageSaveArgv, resolveHylyrePageSaveSlug } from '../../device-test-page-save';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'buildHylyreAppPageSaveArgv: BUNDLE + PAGE_NAME 位置参数，无 --bundle',
    run: () => {
      const argv = buildHylyreAppPageSaveArgv({
        bundleName: 'com.example.app',
        deviceSn: 'SN001',
        abilityName: 'PhoneAbility',
        pageSlug: 'home_tab',
      });
      if (argv.includes('--bundle')) throw new Error('must not use --bundle flag');
      if (!argv.includes('com.example.app')) throw new Error('bundle positional missing');
      if (!argv.includes('home_tab')) throw new Error('page slug positional missing');
      if (!argv.includes('--device-sn') || !argv.includes('SN001')) throw new Error('device sn');
      if (!argv.includes('--ability') || !argv.includes('PhoneAbility')) throw new Error('ability');
    },
  },
  {
    name: 'resolveHylyrePageSaveSlug: 默认 home',
    run: () => {
      if (resolveHylyrePageSaveSlug(null) !== 'home') throw new Error('default slug');
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
