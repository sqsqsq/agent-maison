import * as fs from 'fs';
import * as path from 'path';
import { exactCaseSelector, matchesUnitCase, UnitCaseGroup } from './unit-case-selection';
import { runSuiteProcesses, UnitSuiteTask } from './unit-suite-processes';
import type { RegisteredUnitSuite } from './unit-suite-registry';
import type { TestGroup } from './test-impact';

export interface UnitTimingResult { id: string; totalMs: number | null; executionTimings?: Array<{ caseNames: string[]; durationMs: number }> }
export function readExecutionTimingResults(file?: string): UnitTimingResult[] {
  if (!file) return [];
  try {
    const report = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const rows = Array.isArray(report.groups) ? report.groups : Array.isArray(report.suites) ? report.suites
      : report.groups && typeof report.groups === 'object' ? Object.values(report.groups).map((fact: any) => fact?.result) : [];
    return rows.filter((row: any) => typeof row?.id === 'string').map((row: any) => ({ id: row.id,
      totalMs: typeof row.totalMs === 'number' && Number.isFinite(row.totalMs) && row.totalMs >= 0 ? row.totalMs : null,
      executionTimings: (Array.isArray(row.executionTimings) ? row.executionTimings : []).filter((block: any) =>
        Array.isArray(block?.caseNames) && block.caseNames.every((name: unknown) => typeof name === 'string')
        && typeof block.durationMs === 'number' && Number.isFinite(block.durationMs) && block.durationMs >= 0),
    }));
  } catch (error) { console.warn(`[TIMINGS] ignored unavailable result ${file}: ${String(error)}`); return []; }
}

// Equal names cannot be selected independently by the legacy display-name protocol.
export function mergeOverlappingGroups(groups: UnitCaseGroup[]): UnitCaseGroup[] {
  const out: UnitCaseGroup[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.caseNames) || !group.caseNames.length || group.caseNames.some(name => typeof name !== 'string')) throw new Error('invalid case-group enumeration');
    const overlaps = out.filter(item => item.caseNames.some(name => group.caseNames.includes(name)));
    if (!overlaps.length) out.push({ ...group, caseNames: [...group.caseNames] });
    else {
      const first = overlaps[0];
      first.caseNames.push(...group.caseNames);
      first.serialResources = [...new Set([...(first.serialResources ?? []), ...(group.serialResources ?? [])])];
      for (const other of overlaps.slice(1)) {
        first.caseNames.push(...other.caseNames); out.splice(out.indexOf(other), 1);
      }
    }
  }
  return out;
}

export async function enumerateUnitGroups(suites: RegisteredUnitSuite[], workers: number, selector?: string, requirePreselection = false): Promise<TestGroup[]> {
  const root = path.resolve(__dirname, '..');
  const candidates = suites.filter(suite => !suite.serialReason && fs.existsSync(path.resolve(root, suite.modulePath + '.ts'))
    && /export\s+(?:(?:async\s+)?function\s+listCaseGroups|const\s+listCaseGroups)/.test(fs.readFileSync(path.resolve(root, suite.modulePath + '.ts'), 'utf8')));
  const enumeration = new Map((await runSuiteProcesses(candidates.map(suite => ({ id: suite.id, modulePath: path.resolve(root, suite.modulePath + '.ts'), enumerate: true, layer: suite.layer })), workers)).map(result => [result.id, result]));
  const groups: TestGroup[] = [];
  for (const suite of suites) {
    const base = { suiteId: suite.id, modulePath: path.resolve(root, suite.modulePath + '.ts'), layer: suite.layer, releaseOnly: suite.releaseOnly, serialResources: suite.serialResources, selector, requirePreselection };
    const result = enumeration.get(suite.id);
    if (result && (!result.ok || !result.caseGroups)) throw new Error(`suite ${suite.id} case enumeration failed: ${result.error ?? 'missing groups'}`);
    if (!result) { groups.push({ ...base, id: suite.id }); continue; }
    for (const group of mergeOverlappingGroups(result.caseGroups!)) {
      if (selector !== undefined && !group.caseNames.some(name => matchesUnitCase(name, selector))) continue;
      groups.push({ ...base, id: `${suite.id}::${JSON.stringify(group.caseNames)}`, caseNames: group.caseNames,
        selector: exactCaseSelector(group.caseNames), requirePreselection: true,
        serialResources: [...new Set([...(suite.serialResources ?? []), ...(group.serialResources ?? [])])] });
    }
  }
  return groups;
}

export function groupTimingHints(groups: TestGroup[], previous: UnitTimingResult[], suiteTimings: Record<string, number>): Record<string, number> {
  const timings = { ...suiteTimings };
  for (const group of groups) {
    const exact = previous.find(result => result.id === group.id);
    if (exact?.totalMs != null) { timings[group.id] = exact.totalMs; continue; }
    const blocks = previous.filter(result => result.id === group.suiteId).flatMap(result => result.executionTimings ?? []);
    const matched = blocks.filter(block => group.caseNames?.some(name => block.caseNames.includes(name)));
    if (matched.length) timings[group.id] = matched.reduce((sum, block) => sum + block.durationMs, 0);
    else if (suiteTimings[group.suiteId] !== undefined) timings[group.id] = suiteTimings[group.suiteId] / groups.filter(candidate => candidate.suiteId === group.suiteId).length;
  }
  return timings;
}
