// select-suites.ts — run-unit 的 filter 双语义纯函数（抽出便于单测，避免 import run-unit 触发其 main()）。
//
// 见 .cursor/plans 的 a7c3e1f9 P3：
//  - 命中任一 `suite.id.includes(filter)` → **只跑这些 suite**（跳过其余 require+runAll，秒级）；
//  - 无 suite id 命中 → 回退 case-name 过滤（跑全部 suite，按 case name 过滤显示，保 `--filter parseHypium` 老用法）。
export function selectSuites<T extends { id: string }>(
  filter: string | undefined,
  suites: readonly T[],
): { toRun: T[]; caseNameFilter: string | undefined } {
  if (!filter) return { toRun: [...suites], caseNameFilter: undefined };
  const byId = suites.filter(s => s.id.includes(filter));
  if (byId.length > 0) return { toRun: byId, caseNameFilter: undefined };
  return { toRun: [...suites], caseNameFilter: filter };
}
