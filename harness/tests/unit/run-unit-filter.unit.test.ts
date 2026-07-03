// run-unit-filter.unit.test.ts — selectSuites filter 双语义（plan a7c3e1f9 P3）
import { selectSuites } from '../utils/select-suites';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const SAMPLE = [
  { id: 'goal-progress' },
  { id: 'goal-runner-phase' },
  { id: 'init-orchestrate' },
  { id: 'visual-fidelity' },
] as const;

function assert(name: string, cond: boolean, msg?: string): UnitCaseResult {
  return cond ? { name, ok: true } : { name, ok: false, error: msg ?? 'assertion failed' };
}

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];

  // 无 filter → 全跑，无 case 过滤
  {
    const r = selectSuites(undefined, SAMPLE);
    out.push(assert('no filter → 全部 suite', r.toRun.length === SAMPLE.length && r.caseNameFilter === undefined));
  }

  // 命中单个 suite id → 只跑该 suite（短路），不再 case 过滤
  {
    const r = selectSuites('init-orchestrate', SAMPLE);
    out.push(assert(
      'suite id 命中 → 短路只跑该 suite',
      r.toRun.length === 1 && r.toRun[0].id === 'init-orchestrate' && r.caseNameFilter === undefined,
      `toRun=${JSON.stringify(r.toRun.map(s => s.id))}`,
    ));
  }

  // 子串命中多个 suite → 只跑命中集
  {
    const r = selectSuites('goal-', SAMPLE);
    out.push(assert(
      'suite id 子串命中多个 → 只跑命中集',
      r.toRun.length === 2 && r.toRun.every(s => s.id.startsWith('goal-')) && r.caseNameFilter === undefined,
      `toRun=${JSON.stringify(r.toRun.map(s => s.id))}`,
    ));
  }

  // 无 suite id 命中（是 case 名）→ 回退 case-name 过滤：跑全部，caseNameFilter=filter（保 --filter parseHypium 老用法）
  {
    const r = selectSuites('parseHypium', SAMPLE);
    out.push(assert(
      'case 名（无 suite 命中）→ 回退 case-name 过滤',
      r.toRun.length === SAMPLE.length && r.caseNameFilter === 'parseHypium',
      `toRun.len=${r.toRun.length} caseNameFilter=${r.caseNameFilter}`,
    ));
  }

  return out;
}
