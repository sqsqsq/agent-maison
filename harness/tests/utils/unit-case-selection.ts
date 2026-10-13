import { performance } from 'perf_hooks';
import type { UnitCaseResult } from '../run-unit';

export interface UnitExecutionTiming { caseNames: string[]; durationMs: number }
export interface SelectedUnitCases {
  results: UnitCaseResult[];
  matchedCaseCount: number;
  executionTimings: UnitExecutionTiming[];
}
export interface SelectableUnitModule {
  runAll: () => UnitCaseResult[] | Promise<UnitCaseResult[]>;
  runSelectedCases?: (selector?: string) => SelectedUnitCases | Promise<SelectedUnitCases>;
}

export function matchesUnitCase(name: string, selector?: string): boolean {
  return selector === undefined || name.includes(selector);
}

export function isInfrastructureResult(result: UnitCaseResult): boolean {
  return result.infrastructure === true || result.name.startsWith('<suite-');
}

// 在 fixture 前开始，在原 finally 后结束；一个共同执行块只写一条时间。
export function startCaseTiming(caseNames: string[], timings: UnitExecutionTiming[]): () => void {
  const startedAt = performance.now();
  return () => { timings.push({ caseNames, durationMs: performance.now() - startedAt }); };
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
