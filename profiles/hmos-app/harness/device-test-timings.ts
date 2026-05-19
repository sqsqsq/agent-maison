/**
 * 从 testing 流水线 meta / log / trace 汇总耗时，供 device-test-timing.json 与 test-report 回填。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface DeviceTestTimingCase {
  id: string;
  duration_ms: number;
  step_count: number;
}

export interface DeviceTestTimingPipeline {
  build_ms: number | null;
  build_reused: boolean;
  install_ms: number | null;
  install_reused: boolean;
  hylyre_run_ms: number | null;
  page_save_ms: number | null;
  total_harness_ms: number | null;
  hap_built_at: string | null;
}

export interface DeviceTestTimingDocument {
  schema_version: '1.0';
  feature: string;
  generated_at: string;
  pipeline: DeviceTestTimingPipeline;
  cases: DeviceTestTimingCase[];
}

const COST_RE = /cost:\s*([\d.]+)s/gi;

function readJsonSafe<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 按 trace tool_calls 的 case 顺序，将 log 中 cost 行累加到各 TC。 */
export function parseCaseDurationsFromLogAndTrace(
  logContent: string,
  traceRaw: Record<string, unknown> | null,
): DeviceTestTimingCase[] {
  const costs: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(COST_RE.source, COST_RE.flags);
  while ((m = re.exec(logContent)) !== null) {
    const sec = parseFloat(m[1] ?? '0');
    if (Number.isFinite(sec)) costs.push(Math.round(sec * 1000));
  }

  const toolCalls = Array.isArray(traceRaw?.tool_calls)
    ? (traceRaw!.tool_calls as Array<{ case?: string }>)
    : [];
  const caseOrder: string[] = [];
  for (const tc of toolCalls) {
    const id = typeof tc?.case === 'string' ? tc.case.trim() : '';
    if (id && (caseOrder.length === 0 || caseOrder[caseOrder.length - 1] !== id)) {
      caseOrder.push(id);
    }
  }

  const casesFromTrace = Array.isArray(traceRaw?.cases)
    ? (traceRaw!.cases as Array<{ id?: string }>)
    : [];
  const allCaseIds =
    caseOrder.length > 0 ? caseOrder : casesFromTrace.map(c => c.id).filter(Boolean) as string[];

  if (allCaseIds.length === 0) {
    return [];
  }

  const perCaseSteps: number[] = new Array(allCaseIds.length).fill(0);
  const perCaseMs: number[] = new Array(allCaseIds.length).fill(0);

  let costIdx = 0;
  let caseIdx = 0;
  for (const tc of toolCalls) {
    const id = typeof tc?.case === 'string' ? tc.case.trim() : '';
    if (id) {
      const idx = allCaseIds.indexOf(id);
      if (idx >= 0) caseIdx = idx;
    }
    if (costIdx < costs.length) {
      perCaseMs[caseIdx] += costs[costIdx]!;
      perCaseSteps[caseIdx] += 1;
      costIdx += 1;
    }
  }

  while (costIdx < costs.length && caseIdx < allCaseIds.length) {
    perCaseMs[caseIdx] += costs[costIdx]!;
    perCaseSteps[caseIdx] += 1;
    costIdx += 1;
  }

  return allCaseIds.map((id, i) => ({
    id,
    duration_ms: perCaseMs[i] ?? 0,
    step_count: perCaseSteps[i] ?? 0,
  }));
}

export interface CollectDeviceTestTimingsOpts {
  projectRoot: string;
  feature: string;
  reportsDir: string;
  hylyreTracePath?: string | null;
}

export function collectDeviceTestTimings(opts: CollectDeviceTestTimingsOpts): DeviceTestTimingDocument {
  const buildResult = readJsonSafe<{
    reused?: boolean;
    hapBuiltAt?: string;
    hvigorDurationMs?: number;
  }>(path.join(opts.reportsDir, 'device-test-build.result.json'));

  const buildMeta = readJsonSafe<{ durationMs?: number }>(
    path.join(opts.reportsDir, 'hvigor-app-build.meta.json'),
  );
  const installMeta = readJsonSafe<{ durationMs?: number; reused?: boolean }>(
    path.join(opts.reportsDir, 'device-test-install.meta.json'),
  );
  const runMeta = readJsonSafe<{
    run_duration_ms?: number;
    hylyre_page_save?: { duration_ms?: number };
  }>(path.join(opts.reportsDir, 'device-test-run.meta.json'));

  const logPath = path.join(opts.reportsDir, 'device-test-run.log');
  const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';

  let traceRaw: Record<string, unknown> | null = null;
  if (opts.hylyreTracePath && fs.existsSync(opts.hylyreTracePath)) {
    traceRaw = readJsonSafe<Record<string, unknown>>(opts.hylyreTracePath);
  }

  const buildReused = Boolean(buildResult?.reused);
  const buildMs = buildReused ? 0 : (buildMeta?.durationMs ?? buildResult?.hvigorDurationMs ?? null);

  return {
    schema_version: '1.0',
    feature: opts.feature,
    generated_at: new Date().toISOString(),
    pipeline: {
      build_ms: buildMs,
      build_reused: buildReused,
      install_ms: installMeta?.reused ? 0 : (installMeta?.durationMs ?? null),
      install_reused: Boolean(installMeta?.reused),
      hylyre_run_ms: runMeta?.run_duration_ms ?? null,
      page_save_ms: runMeta?.hylyre_page_save?.duration_ms ?? null,
      total_harness_ms: null,
      hap_built_at: buildResult?.hapBuiltAt ?? null,
    },
    cases: parseCaseDurationsFromLogAndTrace(logContent, traceRaw),
  };
}

export function writeDeviceTestTimingJson(reportsDir: string, doc: DeviceTestTimingDocument): string {
  fs.mkdirSync(reportsDir, { recursive: true });
  const out = path.join(reportsDir, 'device-test-timing.json');
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return out;
}
