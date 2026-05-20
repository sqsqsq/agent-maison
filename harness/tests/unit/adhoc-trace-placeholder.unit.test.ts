// ============================================================================
// adhoc-trace-placeholder.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  printAdhocAnchors,
  writeAdhocTracePlaceholder,
  type AdhocErrorKind,
} from '../../scripts/utils/adhoc-trace-placeholder';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const ERROR_KINDS: AdhocErrorKind[] = [
  'ensure_failed',
  'main_ability_unresolved',
  'warmup_failed',
  'run_crashed',
  'plan_lint_blocker',
  'unknown',
];

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'writeAdhocTracePlaceholder: schema + cases empty',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-trace-'));
      const tracePath = path.join(dir, 'trace.json');
      writeAdhocTracePlaceholder(tracePath, {
        feature: '_adhoc',
        phase: 'testing',
        outcome: 'aborted',
        error_kind: 'ensure_failed',
        bundle: 'com.example.app',
        artifacts: {},
      });
      const raw = JSON.parse(fs.readFileSync(tracePath, 'utf-8')) as Record<string, unknown>;
      if (raw.schema_version !== '0.2-p4') throw new Error('schema_version');
      if (raw.generated_by !== 'adhoc-device-test') throw new Error('generated_by');
      if (!Array.isArray(raw.cases) || (raw.cases as unknown[]).length !== 0) throw new Error('cases');
      if (raw.outcome !== 'aborted') throw new Error('outcome');
    },
  },
  {
    name: 'writeAdhocTracePlaceholder: error_kind values round-trip',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-trace-'));
      for (const kind of ERROR_KINDS) {
        const tracePath = path.join(dir, `${kind}.json`);
        writeAdhocTracePlaceholder(tracePath, {
          feature: '_adhoc',
          phase: 'testing',
          outcome: 'aborted',
          error_kind: kind,
          bundle: 'com.example.app',
          artifacts: {},
        });
        const raw = JSON.parse(fs.readFileSync(tracePath, 'utf-8')) as Record<string, unknown>;
        if (raw.error_kind !== kind) throw new Error(`error_kind ${kind}`);
      }
    },
  },
  {
    name: 'printAdhocAnchors: stderr five KEY=value lines',
    run: () => {
      const anchors = {
        trace: '/tmp/trace.json',
        report: '/tmp/report.md',
        warmupMeta: '/tmp/snapshot-warmup.meta.json',
        ensureMeta: '/tmp/hylyre-ready.meta.json',
        runMeta: '/tmp/device-test-run.meta.json',
      };
      let captured = '';
      const orig = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
        captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
        return true;
      }) as typeof process.stderr.write;
      try {
        printAdhocAnchors(anchors);
      } finally {
        process.stderr.write = orig;
      }
      const lines = captured.trim().split('\n');
      if (lines.length !== 5) throw new Error(`expected 5 lines, got ${lines.length}`);
      const expected = [
        'ADHOC_TRACE_FILE=/tmp/trace.json',
        'ADHOC_REPORT_FILE=/tmp/report.md',
        'ADHOC_WARMUP_META=/tmp/snapshot-warmup.meta.json',
        'ADHOC_ENSURE_META=/tmp/hylyre-ready.meta.json',
        'ADHOC_RUN_META=/tmp/device-test-run.meta.json',
      ];
      for (let i = 0; i < 5; i++) {
        if (lines[i] !== expected[i]) throw new Error(`line ${i}: ${lines[i]}`);
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
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
