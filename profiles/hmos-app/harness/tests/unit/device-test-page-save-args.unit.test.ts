import {
  buildHylyreAppPageSaveArgv,
  resolveHylyrePageSaveNames,
  resolveHylyrePageSaveSlug,
} from '../../device-test-page-save';

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
  {
    name: 'resolveHylyrePageSaveSlug: HARNESS_HYLYRE_PAGE_SAVE_NAME',
    run: () => {
      const prev = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
      process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME = 'bank-card-select';
      try {
        if (resolveHylyrePageSaveSlug(null) !== 'bank-card-select') throw new Error('env single name');
      } finally {
        if (prev === undefined) delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
        else process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME = prev;
      }
    },
  },
  {
    name: 'resolveHylyrePageSaveNames: NAMES env 优先于 NAME',
    run: () => {
      const prevName = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
      const prevNames = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES;
      process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME = 'ignored';
      process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES = 'home, bank-card-select , sms-sheet';
      try {
        const names = resolveHylyrePageSaveNames(null);
        if (names.length !== 3 || names[0] !== 'home' || names[1] !== 'bank-card-select') {
          throw new Error(`unexpected names: ${JSON.stringify(names)}`);
        }
      } finally {
        if (prevName === undefined) delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
        else process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME = prevName;
        if (prevNames === undefined) delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES;
        else process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES = prevNames;
      }
    },
  },
  {
    name: 'resolveHylyrePageSaveNames: 无 env 时回退单 home',
    run: () => {
      const prevName = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
      const prevNames = process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES;
      delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
      delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES;
      try {
        const names = resolveHylyrePageSaveNames(null);
        if (names.length !== 1 || names[0] !== 'home') throw new Error(`expected [home], got ${JSON.stringify(names)}`);
      } finally {
        if (prevName === undefined) delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME;
        else process.env.HARNESS_HYLYRE_PAGE_SAVE_NAME = prevName;
        if (prevNames === undefined) delete process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES;
        else process.env.HARNESS_HYLYRE_PAGE_SAVE_NAMES = prevNames;
      }
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
