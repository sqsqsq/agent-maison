// ============================================================================
// shape-guards.ts — agent 产 YAML/JSON 的形状防崩溃守卫（plan d9b4f7e2 P0-2）
// ----------------------------------------------------------------------------
// 病灶（07-13 chrys bc-openCard 实证）：`x ?? []` 只兜 null/undefined——agent 把
// assets/mappings 写成 `{}`/`""`（非数组真值）时，`for..of {}` / `.filter` / `.map`
// 直接 TypeError → [Harness 内部错误] BLOCKER，agent 误当自身产物问题反复修。
// 原则：**asArray 只防崩溃，不许静默洗形状**——每个消费面所在的主门禁必须配套
// 形状校验产出结构化 FAIL（期望形状 + 最小合法样例），"传了 {} 却安静 PASS"是缺陷。
// ============================================================================

/** 人读形状名（FAIL details 用）——区分 dict/string/number 等常见 agent 笔误形态。 */
export function shapeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object(dict)';
  return typeof v;
}

/** 非数组一律回空数组（含 `{}`/`""`/数字等非数组真值——`?? []` 兜不住的形态）。 */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * asArray + 形状留痕：值存在但不是数组时向 issues 追加一条可行动的形状错误
 * （期望形状 + 最小合法样例），供主门禁聚合成结构化 FAIL。
 * null/undefined（字段缺失）不算形状错误——缺失语义由各门禁自己的必填检查裁决。
 */
export function takeArray<T>(v: unknown, fieldLabel: string, issues: string[]): T[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v as T[];
  issues.push(
    `${fieldLabel} 应为数组（YAML list），实际是 ${shapeName(v)}——最小合法样例：\`${fieldLabel}: []\`（每项以 \`- \` 开头）`,
  );
  return [];
}
