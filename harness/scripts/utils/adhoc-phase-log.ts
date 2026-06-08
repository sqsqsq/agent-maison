/** stderr progress anchors for ad-hoc device test (device-testing Step 4.B). */
export function logAdhocPhase(phase: string, extra?: Record<string, string | number | boolean | null>): void {
  const parts = [`ADHOC_PHASE=${phase}`, `started_at=${new Date().toISOString()}`];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      parts.push(`${k}=${v ?? 'null'}`);
    }
  }
  console.error(parts.join(' '));
}

export function logAdhocRunDone(durationMs: number, casesCount: number): void {
  console.error(`ADHOC_RUN_DONE=1 duration_ms=${durationMs} cases_count=${casesCount}`);
}
