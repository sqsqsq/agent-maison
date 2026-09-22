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

  // ── release-only（plan d4a1f7c3，用户 2026-09-22 裁决）──────────────────────
  // 语义两条，缺一条就有假绿：默认运行**不执行**它，但它**仍留在 toRun 里**
  //（run-unit 的"显式注册套件文件缺失即 FAIL"必须照常对它生效）。
  const WITH_RELEASE_ONLY = [
    { id: 'goal-progress' },
    { id: 'real-chain', releaseOnly: true },
  ] as const;

  {
    const r = selectSuites(undefined, WITH_RELEASE_ONLY);
    out.push(assert(
      '默认运行：release-only 套件不执行，但仍进 toRun（缺文件仍 FAIL）',
      r.toRun.length === 2 &&
        r.skipExecution.has('real-chain') &&
        !r.skipExecution.has('goal-progress'),
      `toRun=${JSON.stringify(r.toRun.map(s => s.id))} skip=${JSON.stringify([...r.skipExecution])}`,
    ));
  }

  {
    // 反假绿：run-unit 的"显式注册套件文件缺失即 FAIL"是在**遍历 toRun 时**做的
    //（run-unit.ts 的 `fs.existsSync(fullPath)` → `EXPLICIT_SUITE_IDS.has` → FAIL，
    // 之后才轮到 skipExecution）。所以 release-only 套件必须**留在 toRun 里**：
    // 一旦有人"优化"成在选择阶段就剔除它，删掉套件文件将不再变红。
    const r = selectSuites(undefined, WITH_RELEASE_ONLY);
    out.push(assert(
      'release-only 不得被提前剔除：缺文件仍走 missing-suite FAIL 路径',
      r.toRun.some(s => s.id === 'real-chain') && r.skipExecution.has('real-chain'),
      `toRun=${JSON.stringify(r.toRun.map(s => s.id))}`,
    ));
  }

  {
    const r = selectSuites(undefined, WITH_RELEASE_ONLY, { release: true });
    const byId = selectSuites('real-chain', WITH_RELEASE_ONLY);
    out.push(assert(
      '--release 全量执行；--filter <id> 单跑同样执行',
      r.skipExecution.size === 0 &&
        byId.toRun.length === 1 && byId.toRun[0].id === 'real-chain' && byId.skipExecution.size === 0,
      `release.skip=${JSON.stringify([...r.skipExecution])} byId.skip=${JSON.stringify([...byId.skipExecution])}`,
    ));
  }

  return out;
}
