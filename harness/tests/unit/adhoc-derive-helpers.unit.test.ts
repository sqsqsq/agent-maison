// ============================================================================
// adhoc-derive-helpers.unit.test.ts
// ============================================================================

import {
  buildMinimalTouchExample,
  classifyNavigationSteps,
  classifyObservationSteps,
  extractTouchByText,
  hasObservationIntent,
  STEPS_FILE_CONTRACT,
} from '../../scripts/utils/adhoc-derive-helpers';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classifyObservationSteps',
    run: () => {
      const steps = ['点击添加卡片', '查看页面所有卡片并汇总'];
      const obs = classifyObservationSteps(steps);
      if (obs.length !== 1 || !obs[0].includes('查看')) throw new Error(JSON.stringify(obs));
      const nav = classifyNavigationSteps(steps);
      if (nav.length !== 1) throw new Error(JSON.stringify(nav));
    },
  },
  {
    name: 'buildMinimalTouchExample: touch chain',
    run: () => {
      const ex = buildMinimalTouchExample(['打开应用', '点击添加卡片', '点击非本机卡片']);
      if (!ex || ex.steps.length !== 2) throw new Error(JSON.stringify(ex));
      if (!(ex.steps[0] as { touch: { by_text: string } }).touch.by_text.includes('添加')) {
        throw new Error('touch text');
      }
    },
  },
  {
    name: 'buildMinimalTouchExample: complex returns null',
    run: () => {
      const ex = buildMinimalTouchExample(['输入金额100', '点击确认']);
      if (ex !== null) throw new Error('expected null');
    },
  },
  {
    name: 'extractTouchByText',
    run: () => {
      if (extractTouchByText('点击首页的添加管理卡片') !== '首页的添加管理卡片') {
        throw new Error('extract failed');
      }
    },
  },
  {
    name: 'hasObservationIntent',
    run: () => {
      if (!hasObservationIntent('点击->查看所有', ['点击', '查看所有'])) throw new Error('obs');
    },
  },
  {
    name: 'STEPS_FILE_CONTRACT: canonical path fields',
    run: () => {
      if (STEPS_FILE_CONTRACT.recommended_write_path !== 'doc/features/_adhoc/testing/staging/test-steps.json') {
        throw new Error('recommended_write_path');
      }
      if (!STEPS_FILE_CONTRACT.forbidden_write_prefixes.includes('framework/harness/')) {
        throw new Error('forbidden_write_prefixes');
      }
      if (!STEPS_FILE_CONTRACT.run_output_dir_pattern.includes('doc/features/_adhoc/')) {
        throw new Error('run_output_dir_pattern');
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

if (require.main === module) {
  const r = runAll();
  for (const x of r) console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
