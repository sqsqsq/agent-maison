/**
 * Testing trace gates — Hylyre run outcome evaluation, report↔trace reconciliation,
 * and UI entry coverage from use-cases.yaml ui_bindings.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HylyreTrace, HylyreTraceCase } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { parseHylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import {
  selectBestNonPlaceholderDerivedPlan,
  tryParseYamlFrontmatter,
} from './derived-hylyre-plan';
import { getSectionContent, extractTables, type MdTable } from './markdown-parser';
import type { UseCaseDef, UseCasesSpec } from './types';

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

/** Evaluate whether Hylyre trace represents a passing device test run (gate semantics). */
export function evaluateHylyreRunOutcome(trace: HylyreTrace | null): HylyreRunOutcomeEvaluation {
  const cases = trace?.cases ?? [];
  const failed = cases.filter(c => c.status === '失败');
  const blocked = cases.filter(c => c.status === '阻塞');
  const skipped = cases.filter(c => c.status === '跳过');
  const passed = cases.filter(c => c.status === '通过');
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

  const fail =
    (outcome !== null && NON_SUCCESS_OUTCOMES.has(outcome)) ||
    failed.length > 0 ||
    blocked.length > 0;

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

/** Parse top-level test-report.md execution result table → TC id → status. */
export function parseReportExecutionResults(reportMd: string): Map<string, string> {
  const section =
    getSectionContent(reportMd, '测试执行结果') ?? getSectionContent(reportMd, '执行结果');
  if (!section) return new Map();

  const tables = extractTables(section);
  if (tables.length === 0) return new Map();

  const table = tables[0];
  const iId = pickColumnIndex(table, ['用例编号', '编号']);
  const iStatus = pickColumnIndex(table, ['执行状态', '结果', '状态']);

  const out = new Map<string, string>();
  for (const row of table.rows) {
    const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
    const m = tcRaw.match(/TC-\d+/i);
    if (!m) continue;
    const tcId = m[0].toUpperCase();
    const status = (iStatus >= 0 ? row[iStatus] : '').trim();
    if (status) out.set(tcId, status);
  }
  return out;
}

/** Extract conclusion verdict keyword from test-report.md. */
export function parseReportConclusionVerdict(reportMd: string): string | null {
  const section = getSectionContent(reportMd, '结论') ?? getSectionContent(reportMd, '测试结论');
  if (!section) return null;
  if (section.includes('不达标')) return '不达标';
  if (section.includes('有条件达标')) return '有条件达标';
  if (section.includes('达标')) return '达标';
  return null;
}

export interface ReportTraceReconciliationResult {
  ok: boolean;
  tracePath: string | null;
  mismatches: string[];
  warnings: string[];
}

/** Full reconciliation: top-level test-report vs authoritative hylyre trace. */
export function reconcileReportWithHylyreTrace(
  reportMd: string,
  tracePath: string | null,
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

  for (const [tcId, reportStatus] of reportStatuses) {
    const traceCase = traceCases.find(c => c.id.toUpperCase() === tcId);
    if (!traceCase) {
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
