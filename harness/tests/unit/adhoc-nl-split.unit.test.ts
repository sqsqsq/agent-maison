// ============================================================================
// adhoc-nl-split.unit.test.ts
// ============================================================================

import { splitNaturalLanguageSteps } from '../../scripts/utils/adhoc-nl-split';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'splitNaturalLanguageSteps: arrow',
    run: () => {
      const r = splitNaturalLanguageSteps('打开应用->点击首页');
      if (r.length !== 2 || r[0] !== '打开应用' || r[1] !== '点击首页') {
        throw new Error(`unexpected: ${JSON.stringify(r)}`);
      }
    },
  },
  {
    name: 'splitNaturalLanguageSteps: semicolon',
    run: () => {
      const r = splitNaturalLanguageSteps('返回;点击添加管理卡片');
      if (r.length !== 2) throw new Error(`count ${r.length}`);
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
