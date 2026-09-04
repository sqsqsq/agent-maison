/**
 * Testing trace gates — Hylyre run outcome evaluation, report↔trace reconciliation,
 * and UI entry coverage from use-cases.yaml ui_bindings.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HylyreTrace, HylyreTraceCase } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { parseHylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { listExecutionKeyRuns } from '../../../profiles/hmos-app/harness/execution-key';
import {
  selectBestNonPlaceholderDerivedPlan,
  tryParseYamlFrontmatter,
} from './derived-hylyre-plan';
import { dispatchHylyreResult } from './hylyre-result-protocol';
import { getSectionContent, extractTables, extractDeclaredVerdict, type MdTable } from './markdown-parser';
import type { UseCaseDef, UseCasesSpec } from './types';
import type { DeviceTestTimingDocument } from '../../../profiles/hmos-app/harness/device-test-timings';

/** Normalize execution status labels for report↔trace comparison. */
function normalizeExecStatus(status: string): string {
  const s = status.trim();
  if (s === 'pass' || s === 'passed') return '通过';
  if (s === 'fail' || s === 'failed') return '失败';
  if (s === 'blocked') return '阻塞';
  if (s === 'skip' || s === 'skipped') return '跳过';
  return s;
}

function execStatusesMatch(reportStatus: string, traceStatus: string): boolean {
  return normalizeExecStatus(reportStatus) === normalizeExecStatus(traceStatus);
}

export type HylyreRunOutcomeVerdict = 'pass' | 'fail';

export interface HylyreRunOutcomeEvaluation {
  verdict: HylyreRunOutcomeVerdict;
  failedCount: number;
  blockedCount: number;
  skippedCount: number;
  passedCount: number;
  outcome: string | null;
  failedCaseIds: string[];
  blockedCaseIds: string[];
  reasonLines: string[];
}

const NON_SUCCESS_OUTCOMES = new Set(['partial', 'failed', 'aborted']);

function nativeCasePassed(caseValue: HylyreTraceCase): boolean {
  return caseValue.execution === 'completed' &&
    caseValue.verification === 'passed' &&
    caseValue.evidence === 'complete';
}

function nativeTraceCaseHasBlockedStep(caseValue: HylyreTraceCase): boolean {
  // v1 把成败收进 outcome；读 `step.status` 在真实 v1 上恒为 undefined，
  // 于是"有阻塞步骤"永远判不出来——这条只在已判 native 的分支上调用。
  return (caseValue.steps ?? []).some(step => step.outcome?.status === 'blocked');
}

/** Evaluate whether Hylyre trace represents a passing device test run (gate semantics). */
export function evaluateHylyreRunOutcome(trace: HylyreTrace | null): HylyreRunOutcomeEvaluation {
  const cases = trace?.cases ?? [];
  // inventory §二 F/§一 G8：旧实现在 schema 不是 0.3-p0 时**回落到中文 case status**
  // （失败/阻塞/跳过/通过）来判 run outcome——这正是 plan T5 第 20 条点名的 legacy fallback。
  //
  // plan a6c4e9f2 T4 返修：上一轮只把注释改成"legacy 不再产 native 判定"，代码里
  // `: cases.filter(c => c.status === '失败')` 那一路**原样留着**——非 v1 时依然靠中文
  // status 算通过数，全通过就 verdict='pass'。中文 status 在 v1 里是**派生投影**、
  // 可以与 steps 完全脱节，拿它当独立事实源正是必须消灭的那条回落路径。
  // 现在改成：非 v1 直接 fail，且不产出任何计数——不给"看起来全通过"留出口。
  const native = dispatchHylyreResult(trace).kind === 'v1';
  if (trace && !native) {
    return {
      verdict: 'fail',
      failedCount: 0,
      blockedCount: 0,
      skippedCount: 0,
      passedCount: 0,
      outcome: trace.outcome ?? null,
      failedCaseIds: [],
      blockedCaseIds: [],
      reasonLines: [
        `authoritative trace 的结果协议不是 ${'hylyre.step-outcome/1'}（schema_version=${String(trace.schema_version)}），` +
        '不得据此判定 run outcome：中文 case status 是派生投影，不是独立事实源。',
      ],
    };
  }
  const failed = cases.filter(c => c.execution !== 'completed' || c.verification === 'failed');
  const blocked = cases.filter(c => c.execution === 'infrastructure_failed' || nativeTraceCaseHasBlockedStep(c));
  const skipped = cases.filter(c => c.verification === 'inconclusive');
  const passed = cases.filter(nativeCasePassed);
  const outcome = trace?.outcome ?? null;

  const reasonLines: string[] = [];
  if (!trace) {
    reasonLines.push('无有效 Hylyre trace.json');
    return {
      verdict: 'fail',
      failedCount: 0,
      blockedCount: 0,
      skippedCount: 0,
      passedCount: 0,
      outcome: null,
      failedCaseIds: [],
      blockedCaseIds: [],
      reasonLines,
    };
  }

  if (outcome && NON_SUCCESS_OUTCOMES.has(outcome)) {
    reasonLines.push(`trace.outcome=${outcome}（非 success）`);
  }
  if (failed.length > 0) {
    reasonLines.push(`失败用例 ${failed.length} 条：${failed.map(c => c.id).join(', ')}`);
  }
  if (blocked.length > 0) {
    reasonLines.push(`阻塞用例 ${blocked.length} 条：${blocked.map(c => c.id).join(', ')}`);
  }
  if (native) {
    const notPassed = cases.filter(c => !nativeCasePassed(c));
    if (notPassed.length > 0 && failed.length === 0 && blocked.length === 0 && skipped.length === 0) {
      reasonLines.push(`native CaseResult 三轴未全通过：${notPassed.map(c => c.id).join(', ')}`);
    }
  }

  const fail =
    (outcome !== null && NON_SUCCESS_OUTCOMES.has(outcome)) ||
    failed.length > 0 ||
    blocked.length > 0 ||
    (native && (cases.length === 0 || passed.length !== cases.length));

  return {
    verdict: fail ? 'fail' : 'pass',
    failedCount: failed.length,
    blockedCount: blocked.length,
    skippedCount: skipped.length,
    passedCount: passed.length,
    outcome,
    failedCaseIds: failed.map(c => c.id),
    blockedCaseIds: blocked.map(c => c.id),
    reasonLines,
  };
}

/** Resolve authoritative hylyre/trace.json from selected derived plan (never top-level backfill). */
export function resolveAuthoritativeHylyreTracePath(reportsBase: string): string | null {
  const latestAttempt = listExecutionKeyRuns(reportsBase)[0];
  if (latestAttempt) {
    return fs.existsSync(latestAttempt.record.trace_path) ? latestAttempt.record.trace_path : null;
  }
  const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
  if (!pick.selected) return null;
  const hylyreDir = path.dirname(pick.selected.hylyrePath);
  const tracePath = path.join(hylyreDir, 'trace.json');
  return fs.existsSync(tracePath) ? tracePath : null;
}

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

export interface ReportExecutionResultRow {
  id: string;
  status: string;
  durationMs: number | null;
  durationRaw: string;
}

function normalizeReportCell(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDurationCell(value: string): { valid: boolean; ms: number | null } {
  const clean = normalizeReportCell(value);
  if (!clean) return { valid: false, ms: null };
  if (/^(?:—|-|n\/a|na|不适用)$/i.test(clean)) return { valid: true, ms: null };
  // 报告 SSOT 使用精确整数毫秒；接受合法千分位只为兼容历史人工报告。
  const m = clean.match(/^((?:\d+|\d{1,3}(?:,\d{3})+))\s*(ms|毫秒)$/i);
  if (!m) return { valid: false, ms: null };
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return { valid: false, ms: null };
  return { valid: true, ms: n };
}

/** Parse top-level test-report.md execution result table into rows. */
export function parseReportExecutionRows(reportMd: string): ReportExecutionResultRow[] {
  const section =
    getSectionContent(reportMd, '测试执行结果') ?? getSectionContent(reportMd, '执行结果');
  if (!section) return [];

  const tables = extractTables(section);
  if (tables.length === 0) return [];

  const table = tables[0];
  const iId = pickColumnIndex(table, ['用例编号', '编号']);
  const iStatus = pickColumnIndex(table, ['执行状态', '结果', '状态']);
  const iDuration = pickColumnIndex(table, ['耗时', 'duration']);

  const out: ReportExecutionResultRow[] = [];
  for (const row of table.rows) {
    const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
    const m = tcRaw.match(/TC-\d+/i);
    if (!m) continue;
    const tcId = m[0].toUpperCase();
    const status = (iStatus >= 0 ? row[iStatus] : '').trim();
    const durationRaw = (iDuration >= 0 ? row[iDuration] : '').trim();
    out.push({
      id: tcId,
      status,
      durationRaw,
      durationMs: iDuration >= 0 ? parseDurationCell(durationRaw).ms : null,
    });
  }
  return out;
}

/** Parse top-level test-report.md execution result table → TC id → status. */
export function parseReportExecutionResults(reportMd: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of parseReportExecutionRows(reportMd)) {
    if (row.status) out.set(row.id, row.status);
  }
  return out;
}

export interface ReportTimingReconciliationResult {
  ok: boolean;
  mismatches: string[];
}

export interface ReportTimingReconciliationInput {
  timing: DeviceTestTimingDocument;
  /** The final build meta timestamp; when supplied it must be copied verbatim into the report. */
  buildTimestamp?: string | null;
  /**
   * plan a6c4e9f2 T3：顶层声明 `execution_channel=hylyre` 的 TC 集合（大写）。
   * 提供时，timing 精确集合只与该子集闭合——visual/manual/provider TC 由各自证据链
   * 对账，不得被误报成"不在最终 timing 中"。缺省=legacy 计划（无通道列），沿旧口径。
   */
  hylyreTcIds?: string[];
}

function isReportNullMarker(value: string): boolean {
  return /^(?:—|-|n\/a|na|不适用)$/i.test(normalizeReportCell(value));
}

function tableRowValue(table: MdTable, label: string): string | null {
  const row = table.rows.find(cells => normalizeReportCell(cells[0] ?? '').includes(label));
  return row && row.length > 1 ? row[1]!.trim() : null;
}

function reportStageRow(table: MdTable, label: string): string[] | null {
  return table.rows.find(cells => normalizeReportCell(cells[0] ?? '').includes(label)) ?? null;
}

function compareReportDuration(
  mismatches: string[],
  label: string,
  raw: string | undefined,
  expectedMs: number | null,
): void {
  if (raw === undefined) {
    mismatches.push(`报告流水线缺少阶段：${label}`);
    return;
  }
  const parsed = parseDurationCell(raw);
  if (!parsed.valid) {
    mismatches.push(`报告流水线阶段 ${label} 耗时非法：${raw || '(empty)'}`);
    return;
  }
  if (expectedMs === null) {
    if (parsed.ms !== null) {
      mismatches.push(`报告流水线阶段 ${label} 应为无数据占位，实际=${raw}`);
    }
    return;
  }
  if (parsed.ms === null || Math.abs(parsed.ms - expectedMs) > 1) {
    mismatches.push(`报告流水线阶段 ${label}=${raw}，最终 timing=${expectedMs}ms`);
  }
}

function compareReportTimestamp(
  mismatches: string[],
  label: string,
  raw: string | null,
  expected: string | null | undefined,
): void {
  if (raw === null) {
    mismatches.push(`报告元数据缺少：${label}`);
    return;
  }
  const clean = normalizeReportCell(raw);
  if (expected === null || expected === undefined) {
    if (!isReportNullMarker(clean)) mismatches.push(`报告元数据 ${label} 无法与最终来源对账：${raw}`);
    return;
  }
  if (clean !== expected) mismatches.push(`报告元数据 ${label}=${clean}，最终来源=${expected}`);
}

/** Reconcile the report's final pipeline/case values with device-test-timing.json. */
export function reconcileReportWithDeviceTestTiming(
  reportMd: string,
  input: ReportTimingReconciliationInput,
): ReportTimingReconciliationResult {
  const mismatches: string[] = [];
  const timing = input.timing;
  const section = getSectionContent(reportMd, '真机流水线耗时');
  const tables = section ? extractTables(section) : [];
  const stageTable = tables.find(table =>
    pickColumnIndex(table, ['阶段']) >= 0 && pickColumnIndex(table, ['耗时']) >= 0,
  );
  if (!stageTable) {
    mismatches.push('报告缺少「真机流水线耗时」阶段表');
  } else {
    const stageSpecs: Array<{ label: string; expectedMs: number | null; reused?: boolean }> = [
      { label: '打包', expectedMs: timing.pipeline.build_ms, reused: timing.pipeline.build_reused },
      { label: '装机', expectedMs: timing.pipeline.install_ms, reused: timing.pipeline.install_reused },
      { label: 'Hylyre', expectedMs: timing.pipeline.hylyre_run_ms },
      { label: '快照写入', expectedMs: timing.pipeline.page_save_ms },
      { label: '合计', expectedMs: timing.pipeline.total_harness_ms },
    ];
    for (const spec of stageSpecs) {
      const row = reportStageRow(stageTable, spec.label);
      const iDuration = pickColumnIndex(stageTable, ['耗时']);
      const iNote = pickColumnIndex(stageTable, ['说明']);
      compareReportDuration(
        mismatches,
        spec.label,
        row && iDuration >= 0 ? row[iDuration] : undefined,
        spec.expectedMs,
      );
      if (spec.reused !== undefined) {
        const note = row && iNote >= 0 ? normalizeReportCell(row[iNote] ?? '') : '';
        const reused = note.match(/\breused\s*=\s*(true|false)\b/i);
        if (!reused) {
          mismatches.push(`报告流水线阶段 ${spec.label} 缺少 reused=true|false`);
        } else if (reused[1]!.toLowerCase() !== String(spec.reused)) {
          mismatches.push(`报告流水线阶段 ${spec.label} reused=${reused[1]}，最终 timing=${String(spec.reused)}`);
        }
      }
    }

    const metadataTable = tables.find(table =>
      table.headers.some(header => header.includes('元数据')),
    );
    if (!metadataTable) {
      mismatches.push('报告缺少流水线元数据表');
    } else {
      compareReportTimestamp(
        mismatches,
        'HAP 落盘时间 (hapBuiltAt)',
        tableRowValue(metadataTable, 'HAP 落盘时间'),
        timing.pipeline.hap_built_at,
      );
      if (input.buildTimestamp !== undefined) {
        compareReportTimestamp(
          mismatches,
          '本次 harness 跑 build 门禁时刻',
          tableRowValue(metadataTable, '本次 harness 跑 build 门禁时刻'),
          input.buildTimestamp,
        );
      }
    }
  }

  const reportRows = parseReportExecutionRows(reportMd);
  const normalized = new Map<string, ReportExecutionResultRow[]>();
  for (const row of reportRows) {
    const rows = normalized.get(row.id) ?? [];
    rows.push(row);
    normalized.set(row.id, rows);
  }
  for (const timingCase of timing.cases) {
    const rows = normalized.get(timingCase.id.toUpperCase()) ?? [];
    if (rows.length !== 1) {
      mismatches.push(`报告对 case ${timingCase.id} 应有唯一执行行，实际=${rows.length}`);
      continue;
    }
    const row = rows[0]!;
    const parsed = parseDurationCell(row.durationRaw);
    if (!parsed.valid || parsed.ms === null || Math.abs(parsed.ms - timingCase.duration_ms) > 1) {
      mismatches.push(`报告 case ${timingCase.id} 耗时=${row.durationRaw || '(empty)'}，最终 timing=${timingCase.duration_ms}ms`);
    }
  }
  const timingIds = new Set(timing.cases.map(timingCase => timingCase.id.toUpperCase()));
  const hylyreScope = input.hylyreTcIds ? new Set(input.hylyreTcIds.map(id => id.toUpperCase())) : null;
  for (const row of reportRows) {
    if (timingIds.has(row.id)) continue;
    // 通道精确对账：顶层声明为 visual/manual/provider 的 TC 本就不进 Hylyre timing，
    // 由各自证据链裁决；它们仍留在报告总分母，但不在这里误报缺 timing。
    if (hylyreScope && !hylyreScope.has(row.id)) continue;
    // 顶层计划中未进入 Hylyre 的 explicit skip 可以出现在报告，但不能伪造
    // 一个来自 timing 的执行耗时；其它额外/执行行都说明报告拼接了旧轮数据。
    if (normalizeExecStatus(row.status) !== '跳过') {
      mismatches.push(`报告 case ${row.id} 不在最终 timing 中且状态不是跳过`);
      continue;
    }
    const parsed = parseDurationCell(row.durationRaw);
    if (!parsed.valid || parsed.ms !== null) {
      mismatches.push(`报告 explicit skip case ${row.id} 不应填入最终执行耗时：${row.durationRaw || '(empty)'}`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * 从 test-report.md「结论」段提取裁决。
 * 声明式提取：锚定「测试结论:」声明行 + 最长优先，杜绝 '达标'⊂'不达标' 子串
 * 与「下一步建议」枚举裁决词造成的整段污染（旧实现整段 includes 会被"若不达标"骗到）。
 */
export function parseReportConclusionVerdict(reportMd: string): string | null {
  const section = getSectionContent(reportMd, '结论') ?? getSectionContent(reportMd, '测试结论');
  if (!section) return null;
  return extractDeclaredVerdict(section, ['有条件达标', '不达标', '达标']).verdict;
}

export interface ReportTraceReconciliationResult {
  ok: boolean;
  tracePath: string | null;
  mismatches: string[];
  warnings: string[];
}

/** Full reconciliation: top-level test-report vs authoritative hylyre trace. */
export interface ReportTraceReconciliationOptions {
  /**
   * plan a6c4e9f2 T3：顶层声明 `execution_channel=hylyre` 的 TC 集合（大写）。
   * 提供时，报告中登记但不在 trace 的 TC 只有落在该子集内才算 mismatch。
   */
  hylyreTcIds?: string[];
}

export function reconcileReportWithHylyreTrace(
  reportMd: string,
  tracePath: string | null,
  options?: ReportTraceReconciliationOptions,
): ReportTraceReconciliationResult {
  const mismatches: string[] = [];
  const warnings: string[] = [];

  if (!tracePath || !fs.existsSync(tracePath)) {
    return {
      ok: false,
      tracePath,
      mismatches: ['无法定位本轮 hylyre/trace.json（device_test_run 派生目录）'],
      warnings,
    };
  }

  if (!tracePath.replace(/\\/g, '/').includes('/hylyre/trace.json')) {
    warnings.push(`trace 路径非 hylyre/ 子目录：${tracePath}（仍以此为准）`);
  }

  const trace = parseHylyreTrace(tracePath);
  if (!trace) {
    return {
      ok: false,
      tracePath,
      mismatches: [`hylyre/trace.json 无法解析：${tracePath}`],
      warnings,
    };
  }

  const reportStatuses = parseReportExecutionResults(reportMd);
  const traceCases = trace.cases ?? [];
  const conclusion = parseReportConclusionVerdict(reportMd);

  for (const tc of traceCases) {
    const tcId = tc.id.toUpperCase();
    const reportStatus = reportStatuses.get(tcId);
    if (!reportStatus) {
      if (tc.status === '失败' || tc.status === '阻塞') {
        mismatches.push(`${tcId}：trace=${tc.status}，报告未登记该用例`);
      }
      continue;
    }
    if (!execStatusesMatch(reportStatus, tc.status)) {
      mismatches.push(`${tcId}：报告=${reportStatus}，trace=${tc.status}`);
    }
  }

  const hylyreScope = options?.hylyreTcIds ? new Set(options.hylyreTcIds.map(id => id.toUpperCase())) : null;
  for (const [tcId, reportStatus] of reportStatuses) {
    const traceCase = traceCases.find(c => c.id.toUpperCase() === tcId);
    if (!traceCase) {
      // 通道精确对账：顶层声明为 visual/manual/provider 的 TC 不进 Hylyre trace，
      // 由各自证据链裁决；它们仍在报告总分母，但不在这里误报 trace missing。
      if (hylyreScope && !hylyreScope.has(tcId)) continue;
      // explicit_skip / 未进 Hylyre 派生表的 TC 在报告中标「跳过」，不要求 trace.cases 登记
      if (normalizeExecStatus(reportStatus) === '跳过') continue;
      mismatches.push(`${tcId}：报告=${reportStatus}，trace 无该用例记录`);
    }
  }

  if (trace.outcome !== 'success' && conclusion === '达标') {
    mismatches.push(`报告结论=达标，但 trace.outcome=${trace.outcome}`);
  }

  const outcomeEval = evaluateHylyreRunOutcome(trace);
  if (outcomeEval.verdict === 'fail' && conclusion === '达标') {
    if (!mismatches.some(m => m.includes('trace.outcome'))) {
      mismatches.push(`报告结论=达标，但 trace 含失败/阻塞或 outcome≠success`);
    }
  }

  return {
    ok: mismatches.length === 0,
    tracePath,
    mismatches,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// UI entry coverage (use-cases.yaml ui_bindings → derived Hylyre plan)
// ---------------------------------------------------------------------------

export interface UiEntryBinding {
  call: string;
  entryUi: string;
  useCaseId: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'unknown';
}

export interface DerivedHylyreCaseMeta {
  tcId: string;
  linkedFlow?: string;
  entryUi?: string;
  calls: string[];
}

/** Build call → entry UI bindings from use-cases.yaml. */
export function buildUiEntryBindings(
  spec: UseCasesSpec | null,
  acPriorityMap?: Map<string, string>,
): UiEntryBinding[] {
  if (!spec?.use_cases?.length) return [];
  const out: UiEntryBinding[] = [];
  for (const uc of spec.use_cases) {
    for (const ub of uc.ui_bindings ?? []) {
      for (const action of ub.user_actions ?? []) {
        const call = action.calls?.trim();
        if (!call) continue;
        out.push({
          call,
          entryUi: ub.ui,
          useCaseId: uc.id,
          priority: inferEntryPriority(uc, ub.ui, acPriorityMap),
        });
      }
    }
  }
  return out;
}

function inferEntryPriority(
  uc: UseCaseDef,
  entryUi: string,
  acPriorityMap?: Map<string, string>,
): 'P0' | 'P1' | 'P2' | 'P3' | 'unknown' {
  let best: 'P0' | 'P1' | 'P2' | 'P3' | 'unknown' = 'unknown';
  for (const br of uc.branches ?? []) {
    for (const ac of br.linked_acceptance ?? []) {
      const mapped = acPriorityMap?.get(ac.toUpperCase());
      if (mapped === 'P0') return 'P0';
      if (mapped === 'P1' && best === 'unknown') best = 'P1';
      if (mapped === 'P2' && best === 'unknown') best = 'P2';
      if (mapped === 'P3' && best === 'unknown') best = 'P3';
      if (!acPriorityMap && /P0/i.test(ac)) return 'P0';
    }
  }
  if (/P0/i.test(entryUi)) return 'P0';
  return best;
}

/** entry_ui → priority，从 acceptance.yaml linked_acceptance 解析（SSOT）。 */
export function buildEntryUiPriorityMap(
  spec: UseCasesSpec | null,
  acPriorityMap: Map<string, string>,
): Map<string, 'P0' | 'P1' | 'P2' | 'P3'> {
  const out = new Map<string, 'P0' | 'P1' | 'P2' | 'P3'>();
  for (const b of buildUiEntryBindings(spec, acPriorityMap)) {
    if (b.priority !== 'unknown') out.set(b.entryUi, b.priority);
  }
  return out;
}

/** Group bindings by business call symbol. */
export function groupUiEntriesByCall(
  bindings: UiEntryBinding[],
): Map<string, UiEntryBinding[]> {
  const map = new Map<string, UiEntryBinding[]>();
  for (const b of bindings) {
    const list = map.get(b.call) ?? [];
    list.push(b);
    map.set(b.call, list);
  }
  return map;
}

/** Parse derived Hylyre plan rows for structured entry_ui / linked_flow / calls. */
export function parseDerivedHylyreCaseMetas(derivedMd: string): DerivedHylyreCaseMeta[] {
  const fm = tryParseYamlFrontmatter(derivedMd);
  const fmCases = Array.isArray(fm?.derived_cases)
    ? (fm!.derived_cases as Array<Record<string, unknown>>)
    : null;

  const section = getSectionContent(derivedMd, '测试用例清单') ?? getSectionContent(derivedMd, '测试用例');
  const tables = section ? extractTables(section) : [];
  const table = tables[0];

  const metas: DerivedHylyreCaseMeta[] = [];

  if (fmCases) {
    for (const c of fmCases) {
      const tcId = String(c.tc_id ?? c.id ?? '').toUpperCase();
      if (!/^TC-\d+$/.test(tcId)) continue;
      const callsRaw = c.calls;
      const calls = Array.isArray(callsRaw)
        ? callsRaw.map(String)
        : typeof callsRaw === 'string'
          ? [callsRaw]
          : [];
      metas.push({
        tcId,
        linkedFlow: typeof c.linked_flow === 'string' ? c.linked_flow : undefined,
        entryUi: typeof c.entry_ui === 'string' ? c.entry_ui : undefined,
        calls,
      });
    }
  }

  if (table) {
    const iId = pickColumnIndex(table, ['用例编号', '编号']);
    const iFlow = pickColumnIndex(table, ['linked_flow', '关联流程', '流程']);
    const iEntry = pickColumnIndex(table, ['entry_ui', '入口', 'UI入口']);
    const iCalls = pickColumnIndex(table, ['calls', '业务调用', '调用']);

    for (const row of table.rows) {
      const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
      const m = tcRaw.match(/TC-\d+/i);
      if (!m) continue;
      const tcId = m[0].toUpperCase();
      const existing = metas.find(x => x.tcId === tcId);
      const linkedFlow = iFlow >= 0 ? row[iFlow]?.trim() : undefined;
      const entryUi = iEntry >= 0 ? row[iEntry]?.trim() : undefined;
      const callsCell = iCalls >= 0 ? row[iCalls]?.trim() : '';
      const calls = callsCell ? callsCell.split(/[,;，；]/).map(s => s.trim()).filter(Boolean) : [];
      if (existing) {
        if (linkedFlow) existing.linkedFlow = linkedFlow;
        if (entryUi) existing.entryUi = entryUi;
        if (calls.length) existing.calls = [...new Set([...existing.calls, ...calls])];
      } else {
        metas.push({ tcId, linkedFlow, entryUi, calls });
      }
    }
  }

  return metas;
}

export interface UiEntryCoverageResult {
  ok: boolean;
  blockers: string[];
  majors: string[];
  warnings: string[];
}

/** Check multi-entry business calls have derived Hylyre coverage per entry_ui. */
export function evaluateUiEntryCoverage(
  spec: UseCasesSpec | null,
  derivedMd: string,
  entryPriorities?: Map<string, 'P0' | 'P1' | 'P2' | 'P3'>,
): UiEntryCoverageResult {
  const bindings = buildUiEntryBindings(spec);
  const byCall = groupUiEntriesByCall(bindings);
  const derivedMetas = parseDerivedHylyreCaseMetas(derivedMd);

  const blockers: string[] = [];
  const majors: string[] = [];
  const warnings: string[] = [];

  for (const [call, entries] of byCall) {
    const uniqueEntries = [...new Map(entries.map(e => [e.entryUi, e])).values()];
    if (uniqueEntries.length <= 1) continue;

    const covered = new Set<string>();
    let structuredMatch = false;

    for (const entry of uniqueEntries) {
      const hit = derivedMetas.some(meta => {
        const callMatch =
          meta.calls.some(c => c.includes(call) || call.includes(c)) ||
          (meta.linkedFlow && meta.linkedFlow.includes(call));
        const entryMatch = meta.entryUi === entry.entryUi;
        if (callMatch && entryMatch) {
          structuredMatch = true;
          return true;
        }
        return false;
      });
      if (hit) covered.add(entry.entryUi);
    }

    const missing = uniqueEntries.filter(e => !covered.has(e.entryUi)).map(e => e.entryUi);
    if (missing.length === 0) continue;

    const isP0 = uniqueEntries.some(e => {
      const p = entryPriorities?.get(e.entryUi) ?? e.priority;
      return p === 'P0';
    });

    const msg = `${call}：缺入口派生覆盖 [${missing.join(', ')}]（共 ${uniqueEntries.length} 个入口）`;

    if (!structuredMatch && derivedMetas.some(m => m.entryUi)) {
      /* has some structured fields but not full coverage */
    } else if (!structuredMatch && derivedMetas.length > 0) {
      warnings.push(`${call}：派生计划未携带 entry_ui 结构化字段，无法精确判定多入口覆盖`);
      if (isP0) {
        blockers.push(`${msg}（P0 多入口须派生 entry_ui 字段）`);
      } else {
        majors.push(msg);
      }
      continue;
    }

    if (isP0) blockers.push(msg);
    else majors.push(msg);
  }

  return {
    ok: blockers.length === 0 && majors.length === 0,
    blockers,
    majors,
    warnings,
  };
}

/** Normalize trace cases for export in tests. */
export function traceCasesFromRaw(cases: HylyreTraceCase[]): HylyreTraceCase[] {
  return cases;
}
