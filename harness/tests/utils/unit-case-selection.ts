import { performance } from 'perf_hooks';
import { beginTestCase } from './runtime-test-control';
import type { UnitCaseResult } from '../run-unit';

export interface UnitExecutionTiming { caseNames: string[]; durationMs: number }
export interface UnitCaseGroup { caseNames: string[]; releaseOnly?: boolean; serialResources?: string[]; serialReason?: string }
const EXACT_PREFIX = '\u001eexact:';
export function exactCaseSelector(names: string[]): string { return EXACT_PREFIX + JSON.stringify(names); }
export function unitCaseGroups(names: string[]): UnitCaseGroup[] {
  const groups = new Map<string, UnitCaseGroup>();
  for (const name of names) {
    if (!groups.has(name)) groups.set(name, { caseNames: [] });
    groups.get(name)!.caseNames.push(name);
  }
  return [...groups.values()];
}
export interface SelectedUnitCases {
  results: UnitCaseResult[];
  matchedCaseCount: number;
  executionTimings: UnitExecutionTiming[];
}
export interface SelectableUnitModule {
  runAll: () => UnitCaseResult[] | Promise<UnitCaseResult[]>;
  runSelectedCases?: (selector?: string) => SelectedUnitCases | Promise<SelectedUnitCases>;
  listCaseGroups?: () => UnitCaseGroup[] | Promise<UnitCaseGroup[]>;
}

let blockSelection: { selector?: string; enumerate: boolean; names: string[]; timings: UnitExecutionTiming[] } | undefined;
export function selectExecutionBlock(name: string): boolean {
  if (!blockSelection) return true;
  blockSelection.names.push(name);
  return !blockSelection.enumerate && matchesUnitCase(name, blockSelection.selector);
}
export function timeExecutionBlock(name: string): () => void {
  return blockSelection ? startCaseTiming([name], blockSelection.timings) : () => undefined;
}
export async function selectedExecutionBlocks(run: () => UnitCaseResult[] | Promise<UnitCaseResult[]>, selector?: string, enumerate = false): Promise<SelectedUnitCases & { groups: UnitCaseGroup[] }> {
  if (blockSelection) throw new Error('nested execution-block selection is unsupported');
  const selection = { selector, enumerate, names: [] as string[], timings: [] as UnitExecutionTiming[] };
  blockSelection = selection;
  try {
    const results = await run();
    return { ...selectedUnitCases(enumerate ? [] : filterLegacyCases(results, selector), selector, selection.timings), groups: unitCaseGroups(selection.names) };
  } finally { blockSelection = undefined; }
}

export function matchesUnitCase(name: string, selector?: string): boolean {
  if (selector?.startsWith(EXACT_PREFIX)) return (JSON.parse(selector.slice(EXACT_PREFIX.length)) as string[]).includes(name);
  return selector === undefined || name.includes(selector);
}

export function isInfrastructureResult(result: UnitCaseResult): boolean {
  return result.infrastructure === true || result.name.startsWith('<suite-');
}

// 在 fixture 前开始，在原 finally 后结束；一个共同执行块只写一条时间。
export function startCaseTiming(caseNames: string[], timings: UnitExecutionTiming[], options: { timeoutMs?: number } = {}): () => void {
  const startedAt = performance.now();
  const endCase = beginTestCase(caseNames, options.timeoutMs);
  return () => { timings.push({ caseNames, durationMs: performance.now() - startedAt }); endCase(); };
}

export function selectedUnitCases(
  results: UnitCaseResult[], selector: string | undefined, executionTimings: UnitExecutionTiming[],
): SelectedUnitCases {
  return { results, executionTimings,
    matchedCaseCount: results.filter(r => !isInfrastructureResult(r) && matchesUnitCase(r.name, selector)).length };
}

export async function executeUnitModule(
  mod: SelectableUnitModule, id: string, selector?: string, requirePreselection = false,
): Promise<SelectedUnitCases> {
  if (typeof mod.runAll !== 'function') throw new Error('未导出 runAll()');
  if (requirePreselection && typeof mod.runSelectedCases !== 'function') {
    throw new Error(`suite ${id} 不支持执行前 --case 筛选`);
  }
  console.log(`[SELECT] suite ${id}：${selector === undefined ? '全量' : mod.runSelectedCases ? '前置筛选' : '后置筛选（仍执行全套）'}${selector === undefined ? '' : `，case=${JSON.stringify(selector)}`}`);
  if (mod.runSelectedCases) return mod.runSelectedCases(selector);
  const results = await mod.runAll();
  return selectedUnitCases(results, selector, []);
}

export function filterLegacyCases(results: UnitCaseResult[], selector?: string): UnitCaseResult[] {
  return selector === undefined ? results : results.filter(r => matchesUnitCase(r.name, selector)
    || (!r.ok && isInfrastructureResult(r)));
}
