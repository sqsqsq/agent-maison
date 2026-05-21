/**
 * Ad-hoc device test trace placeholder + stderr anchors (anti-fabrication SSOT).
 */
import * as fs from 'fs';
import * as path from 'path';

export type AdhocOutcome = 'success' | 'partial' | 'failed' | 'aborted';
export type AdhocErrorKind =
  | 'ensure_failed'
  | 'main_ability_unresolved'
  | 'warmup_failed'
  | 'run_crashed'
  | 'plan_lint_blocker'
  | 'unknown';

export interface AdhocTracePlaceholder {
  schema_version: '0.2-p4';
  feature: string;
  phase: 'testing';
  outcome: AdhocOutcome;
  error_kind?: AdhocErrorKind;
  error_message?: string;
  generated_by: 'adhoc-device-test';
  generated_at: string;
  bundle: string;
  artifacts: {
    warmup_meta?: string;
    ensure_meta?: string;
    run_meta?: string;
    derived_plan?: string;
  };
  cases: never[];
}

export function writeAdhocTracePlaceholder(
  tracePath: string,
  payload: Omit<AdhocTracePlaceholder, 'schema_version' | 'generated_by' | 'generated_at' | 'cases'>,
): void {
  const full: AdhocTracePlaceholder = {
    schema_version: '0.2-p4',
    generated_by: 'adhoc-device-test',
    generated_at: new Date().toISOString(),
    cases: [],
    ...payload,
  };
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.writeFileSync(tracePath, `${JSON.stringify(full, null, 2)}\n`, 'utf-8');
}

export interface AdhocAnchors {
  trace: string;
  report: string;
  hylyreRunDir: string;
  warmupMeta: string;
  ensureMeta: string;
  runMeta: string;
}

export function printAdhocAnchors(anchors: AdhocAnchors): void {
  process.stderr.write(
    [
      `ADHOC_TRACE_FILE=${anchors.trace}`,
      `ADHOC_REPORT_FILE=${anchors.report}`,
      `ADHOC_HYLYRE_RUN_DIR=${anchors.hylyreRunDir}`,
      `ADHOC_WARMUP_META=${anchors.warmupMeta}`,
      `ADHOC_ENSURE_META=${anchors.ensureMeta}`,
      `ADHOC_RUN_META=${anchors.runMeta}`,
    ].join('\n') + '\n',
  );
}
