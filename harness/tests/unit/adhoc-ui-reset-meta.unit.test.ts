import { runUnitCases } from '../utils/unit-cases';
// ============================================================================
// adhoc-ui-reset-meta.unit.test.ts
// ============================================================================

import {
  computeLastFailedStepIndex,
  parseStepsBatchFromRunOut,
  parseStepsRunOut,
  readPreviousRunOutcome,
  readPreviousTraceOutcome,
  shouldEmitUiResetRecommended,
  uiResetHintForOutcome,
} from '../../scripts/utils/adhoc-ui-reset-meta';
import * as fs from 'fs';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { synthesizeTraceFromStepsBatchRun } from '../../../profiles/hmos-app/harness/providers/device-test-run';

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
      assert.equal(parseStepsBatchFromRunOut(`{"payload":${sampleOut}}`), null);
      assert.equal(parseStepsBatchFromRunOut(`[0,${sampleOut}]`), null);
      assert.equal(parseStepsBatchFromRunOut(`${sampleOut}\n${sampleOut}`), null);
      const legacy = parseStepsBatchFromRunOut('prefix {"results":[{"index":0,"status":"error"}]} suffix');
      assert.equal(computeLastFailedStepIndex(legacy), 0);
      assert.equal(parseStepsRunOut('{"results":[]}', { native: true }), null);
      const native = JSON.stringify({ result_protocol: 'hylyre.step-outcome/1', ...JSON.parse(sampleOut) });
      assert.equal(parseStepsRunOut(`diagnostic body: ${native}`, { native: true }), null);
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
    name: 'steps-file synthesis preserves real failure and never reports an unreadable, rejected or empty batch as success',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-batch-'));
      const tracePath = path.join(dir, 'trace.json'), reportPath = path.join(dir, 'report.md');
      const rejected = JSON.stringify({ result_protocol: 'hylyre.step-outcome/1', command_status: 'rejected', phase: 'pre_run_validation',
        rejection: { domain: 'contract', code: 'contract.invalid_step', summary: 'invalid step' } });
      try {
        for (const [runOut, reason, index] of [
          ['extend value: {}\n{"unrelated":true}', /batch missing/, null],
          [rejected, /contract\.invalid_step/, null],
          ['{"total":0,"executed":0,"results":[]}', /No steps executed/, null],
          ['prefix {"results":[{"index":0,"status":"error","error":"legacy step failed"}]} suffix', /legacy step failed/, 0],
        ] as const) {
          const result = synthesizeTraceFromStepsBatchRun({ runOut, feature: 'adhoc', tracePath, reportPath });
          const trace = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
          assert.equal(trace.outcome, 'failed');
          assert.equal(result.lastStepIndex, index);
          assert.match(trace.cases[0].notes, reason);
          if (index === null) assert.match(fs.readFileSync(reportPath, 'utf-8'), reason);
        }
      } finally {
        fs.rmSync(tracePath, { force: true }); fs.rmSync(reportPath, { force: true }); fs.rmdirSync(dir);
      }
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
  {
    name: 'readPreviousRunOutcome from device-test-run.meta.json',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-meta-'));
      const meta = path.join(dir, 'device-test-run.meta.json');
      fs.writeFileSync(
        meta,
        JSON.stringify({ trace_summary: { outcome: 'failed' } }),
        'utf-8',
      );
      if (readPreviousRunOutcome(meta) !== 'failed') throw new Error('meta summary fail');
    },
  },
  {
    name: 'readPreviousRunOutcome falls back to trace_path',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-meta2-'));
      const trace = path.join(dir, 'trace.json');
      fs.writeFileSync(trace, JSON.stringify({ outcome: 'aborted' }), 'utf-8');
      const meta = path.join(dir, 'device-test-run.meta.json');
      fs.writeFileSync(meta, JSON.stringify({ trace_path: trace }), 'utf-8');
      if (readPreviousRunOutcome(meta) !== 'aborted') throw new Error('meta trace_path fail');
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
