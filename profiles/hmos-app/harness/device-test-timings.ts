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

/**
 * 以 trace cases[] 为全量 case 集合，tool_calls 只负责把 log cost 分配到对应 TC。
 * Hylyre 的 StepSkipped case 不会产生成功后的 tool_call，因此必须保留为 0/0，
 * 不能因 tool_calls 非空而从 timing 中消失。
 */
export function parseCaseDurationsFromLogAndTrace(
  logContent: string,
  traceRaw: Record<string, unknown> | null,
): DeviceTestTimingCase[] {
  // inventory §一 G12：native 口径改判 v1；legacy 才回落日志 cost 分配。
  if (traceRaw?.schema_version === '0.4-p0' && Array.isArray(traceRaw.cases)) {
    // Native StepResult.duration_ms is the execution-time SSOT. tool_calls and
    // log cost lines are compatibility projections and may include blocked,
    // skipped, or expected_check rows without a corresponding cost line.
    return (traceRaw.cases as Array<{ id?: unknown; steps?: unknown }>).map((traceCase) => {
      const steps = Array.isArray(traceCase.steps) ? traceCase.steps : [];
      const durationMs = steps.reduce((sum, step) => {
        const value = step && typeof step === 'object' && !Array.isArray(step)
          ? (step as Record<string, unknown>).duration_ms
          : null;
        return sum + (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
      }, 0);
      return {
        id: typeof traceCase.id === 'string' ? traceCase.id.trim() : '',
        duration_ms: Math.round(durationMs),
        step_count: steps.length,
      };
    });
  }

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

  const hasTraceCases = Array.isArray(traceRaw?.cases);
  const casesFromTrace = hasTraceCases
    ? (traceRaw!.cases as Array<{ id?: string }>)
    : [];
  const traceCaseIds: string[] = [];
  const traceCaseIdSet = new Set<string>();
  for (const c of casesFromTrace) {
    const id = typeof c?.id === 'string' ? c.id.trim() : '';
    const normalizedId = id.toUpperCase();
    if (id && !traceCaseIdSet.has(normalizedId)) {
      traceCaseIds.push(id);
      traceCaseIdSet.add(normalizedId);
    }
  }
  // 没有 cases[] 的旧/损坏输入才回退到 tool_calls；只要 cases[] 在场，哪怕为空，
  // 也必须尊重 trace 的权威集合，不能让日志反向扩充 timing case。
  const allCaseIds = hasTraceCases ? traceCaseIds : caseOrder;

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
      const idx = hasTraceCases
        ? allCaseIds.findIndex(caseId => caseId.toUpperCase() === id.toUpperCase())
        : allCaseIds.indexOf(id);
      if (idx < 0) {
        // tool_calls 不是 case SSOT；未知 case 的 cost 无法安全归属，丢弃这条
        // 分配而不污染前一个 trace case 的 duration。
        if (costIdx < costs.length) costIdx += 1;
        continue;
      }
      caseIdx = idx;
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
