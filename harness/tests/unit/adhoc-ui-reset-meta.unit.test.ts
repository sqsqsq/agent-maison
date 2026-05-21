// ============================================================================
// adhoc-ui-reset-meta.unit.test.ts
// ============================================================================

import {
  computeLastFailedStepIndex,
  parseStepsBatchFromRunOut,
  readPreviousTraceOutcome,
  shouldEmitUiResetRecommended,
  uiResetHintForOutcome,
} from '../../scripts/utils/adhoc-ui-reset-meta';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const sampleOut = JSON.stringify({
  total: 3,
  executed: 2,
  results: [
    { index: 0, status: 'ok' },
    { index: 1, status: 'error', error: 'not found' },
  ],
});

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'parseStepsBatchFromRunOut',
    run: () => {
      const b = parseStepsBatchFromRunOut(`prefix ${sampleOut} suffix`);
      if (!b?.results || b.results.length !== 2) throw new Error(JSON.stringify(b));
    },
  },
  {
    name: 'computeLastFailedStepIndex',
    run: () => {
      const b = parseStepsBatchFromRunOut(sampleOut);
      const idx = computeLastFailedStepIndex(b);
      if (idx !== 1) throw new Error(String(idx));
    },
  },
  {
    name: 'shouldEmitUiResetRecommended: continue after failed',
    run: () => {
      if (!shouldEmitUiResetRecommended('failed', true)) throw new Error('expected true');
      if (shouldEmitUiResetRecommended('success', true)) throw new Error('expected false');
      if (shouldEmitUiResetRecommended('failed', false)) throw new Error('expected false');
    },
  },
  {
    name: 'uiResetHintForOutcome',
    run: () => {
      if (uiResetHintForOutcome('success', 1) !== null) throw new Error('success');
      const h = uiResetHintForOutcome('failed', 2);
      if (!h?.includes('2')) throw new Error(h ?? 'null');
    },
  },
  {
    name: 'readPreviousTraceOutcome',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-trace-'));
      const p = path.join(dir, 'trace.json');
      fs.writeFileSync(p, JSON.stringify({ outcome: 'aborted' }), 'utf-8');
      if (readPreviousTraceOutcome(p) !== 'aborted') throw new Error('read fail');
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
