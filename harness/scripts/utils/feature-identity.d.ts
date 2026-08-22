// ============================================================================
// feature-identity.d.ts — feature-identity.js（零依赖 CJS SSOT）的类型声明
// ============================================================================
// TypeScript harness 通过 `import { ... } from './feature-identity'` 解析到本
// declaration（runtime 落到 feature-identity.js）；plain-Node Hook 直接动态
// import 同源 .js——两者消费同一实现，Hook 不得自带 decoder 副本（plan e2a7c4b9
// §4.3 / P2 tasks 8.4）。
// ============================================================================

export const CU_PREFIX: string;
export const SAFE_SEGMENT_PATTERN: RegExp;

export class FeatureIdentityError extends Error {
  code: string;
  constructor(code: string, message: string);
}

/** 校验单个安全路径段（path-bearing 的 blueprint_id / change_unit_id 统一走此断言）。 */
export function assertSafeSegment(value: string, name: string): void;

/** 派生 CU Feature 逻辑键：`cu-` + base64url(blueprint_id \0 change_unit_id)。 */
export function encodeCuFeatureId(blueprintId: string, changeUnitId: string): string;

/** 解析 CU 派生 featureId；非 `cu-` 前缀 → 抛 FeatureIdentityError。 */
export function parseCuFeatureId(featureId: string): { blueprintId: string; changeUnitId: string };

/**
 * 宽松解析：非 `cu-` 前缀返回 null（legacy）；`cu-` 前缀但 payload 非法/非 canonical
 * → 抛 FeatureIdentityError（fail-closed，不回退平铺）。
 */
export function tryParseCuFeatureId(featureId: string): { blueprintId: string; changeUnitId: string } | null;

/** 唯一实现：逻辑 featureId → 物理 Feature 相对路径（legacy=<feature_id>，CU=<blueprint_id>/<change_unit_id>）。 */
export function featureRelativePath(featureId: string): string;

/** 判别分类：kind='cu' | 'legacy'；`cu-` + 非法 payload 抛错（fail-closed）。 */
export function classifyFeatureId(
  featureId: string,
): { kind: 'cu'; blueprintId: string; changeUnitId: string } | { kind: 'legacy' };
