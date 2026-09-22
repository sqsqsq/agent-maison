// select-suites.ts — run-unit 的 filter 双语义纯函数（抽出便于单测，避免 import run-unit 触发其 main()）。
//
// 见 .cursor/plans 的 a7c3e1f9 P3：
//  - 命中任一 `suite.id.includes(filter)` → **只跑这些 suite**（跳过其余 require+runAll，秒级）；
//  - 无 suite id 命中 → 回退 case-name 过滤（跑全部 suite，按 case name 过滤显示，保 `--filter parseHypium` 老用法）。
//
// release-only（plan d4a1f7c3，用户 2026-09-22 裁决）：标了 `releaseOnly` 的套件**默认不执行**
// （真链回归一条就 ~63 s，与日常 4700 用例不成比例），只在 `--release` 或按 id 单跑时执行。
// **它们仍留在 `toRun` 里**——run-unit 必须照常校验套件文件存在（缺失即 FAIL），
// 跳过执行不等于跳过反假绿保护；本函数只回一份"跳过执行"的 id 集合。
export function selectSuites<T extends { id: string; releaseOnly?: boolean }>(
  filter: string | undefined,
  suites: readonly T[],
  opts?: { release?: boolean },
): { toRun: T[]; caseNameFilter: string | undefined; skipExecution: Set<string> } {
  const pick = (toRun: T[], caseNameFilter: string | undefined, selectedById: boolean) => ({
    toRun,
    caseNameFilter,
    skipExecution: new Set(
      opts?.release === true || selectedById ? [] : toRun.filter(s => s.releaseOnly === true).map(s => s.id),
    ),
  });
  if (!filter) return pick([...suites], undefined, false);
  const byId = suites.filter(s => s.id.includes(filter));
  if (byId.length > 0) return pick(byId, undefined, true);
  return pick([...suites], filter, false);
}
