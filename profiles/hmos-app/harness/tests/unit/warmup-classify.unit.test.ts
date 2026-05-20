// ============================================================================
// warmup-classify.unit.test.ts
// ============================================================================

import { classifyWarmupFailure } from '../../app-snapshot-warmup';

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
    name: 'classifyWarmupFailure: device_locked',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: false, output: 'screen is locked need unlock' },
        { ok: false, lastDumpExcerpt: '' },
        { exitCode: 2, stderr: '' },
        { exitCode: 2, stderr: '' },
      );
      assertEq(k, 'device_locked', 'kind');
    },
  },
  {
    name: 'classifyWarmupFailure: app_not_foreground',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: true, output: '' },
        { ok: false, lastDumpExcerpt: '' },
        { exitCode: 2, stderr: '' },
        { exitCode: 2, stderr: '' },
      );
      assertEq(k, 'app_not_foreground', 'kind');
    },
  },
  {
    name: 'classifyWarmupFailure: ability_wrong',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: true, output: '' },
        { ok: true, lastDumpExcerpt: 'bundle name com.app' },
        { exitCode: 2, stderr: 'ability not found' },
        { exitCode: 0, stderr: '' },
      );
      assertEq(k, 'ability_wrong', 'kind');
    },
  },
  {
    name: 'classifyWarmupFailure: dump_ui_failed',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: true, output: '' },
        { ok: true, lastDumpExcerpt: '' },
        { exitCode: 2, stderr: 'generic dump error' },
        { exitCode: 0, stderr: '' },
      );
      assertEq(k, 'dump_ui_failed', 'kind');
    },
  },
  {
    name: 'classifyWarmupFailure: no_hdc_target',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: false, output: 'error: no targets found' },
        { ok: false, lastDumpExcerpt: '' },
        { exitCode: null, stderr: '' },
        { exitCode: null, stderr: '' },
      );
      assertEq(k, 'no_hdc_target', 'kind');
    },
  },
  {
    name: 'classifyWarmupFailure: aa_start_failed',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: false, output: 'aa start failed generic' },
        { ok: false, lastDumpExcerpt: '' },
        { exitCode: 2, stderr: '' },
        { exitCode: 2, stderr: '' },
      );
      assertEq(k, 'aa_start_failed', 'kind');
    },
  },
  {
    name: 'classifyWarmupFailure: page_save_failed',
    run: () => {
      const k = classifyWarmupFailure(
        { ok: true, output: '' },
        { ok: true, lastDumpExcerpt: 'bundle name com.app' },
        { exitCode: 0, stderr: '' },
        { exitCode: 2, stderr: 'page save error' },
      );
      assertEq(k, 'page_save_failed', 'kind');
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
