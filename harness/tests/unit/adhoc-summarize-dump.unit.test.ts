import { runUnitCases } from '../utils/unit-cases';
// ============================================================================
// adhoc-summarize-dump.unit.test.ts
// ============================================================================

import { extractCardsFromDumpRaw } from '../../scripts/utils/adhoc-summarize-dump';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'extractCardsFromDumpRaw: finds card names',
    run: () => {
      const raw = `{"text":"绿城通","listIndex1":true,"text":"¥1.60"}`;
      const cards = extractCardsFromDumpRaw(raw);
      if (cards.length === 0) throw new Error('no cards');
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
