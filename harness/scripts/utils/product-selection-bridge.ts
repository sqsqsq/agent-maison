// ============================================================================
// product-selection-bridge.ts — goal 启动前置检查的 product 解析桥（plan a7c3f9e2 t4/t5）
// ============================================================================
// goal-runner 是 profile-neutral 的，不静态 import profile 代码；本桥沿用
// resolveFrozenDeviceTestConfig 同一模式：经 `resolvedProfile.profileDir/harness` 动态
// require profile 侧解析器。
//
// review P1 修正：
//   - purpose 按**链路中首个需要 product 的 phase** 决定（不是"含 testing 就用
//     device_test"）——避免 `HARNESS_DEVICE_TEST_PRODUCT`（testing-only env）在
//     coding 开头的完整链路上把启动预检放行、随后 coding 中途才 unresolved 停止；
//   - 解析器**缺失**（profile 无 product-selection 模块，如 generic）可以跳过；
//     解析器**执行失败**不得静默跳过——返回失败原因，goal-runner 必须 halt。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { HarnessResolvedProfile } from './types';
import { chainRequiresProduct } from './phase-personal-prerequisites';
import type { ProductSelectionPurpose } from '../../../profiles/hmos-app/harness/product-selection';

export { chainRequiresProduct };

/**
 * 链路中**首个**需要 product 的 phase 对应的解析目的。
 *（feature 链按 spec→plan→coding→review→ut→testing 顺序，首个构建 phase 即
 * 第一个会触发 product 解析的 phase；env 读取语义与各 phase 的真实门禁一致——
 * `HARNESS_DEVICE_TEST_PRODUCT` 只对 testing 生效，故只可解除 testing-only 链路。）
 */
export function goalProductPurpose(chain: readonly string[]): ProductSelectionPurpose {
  const buildOrder: Array<{ phase: string; purpose: ProductSelectionPurpose }> = [
    { phase: 'coding', purpose: 'coding' },
    { phase: 'ut', purpose: 'ut' },
    { phase: 'testing', purpose: 'device_test' },
  ];
  for (const { phase, purpose } of buildOrder) {
    if (chain.includes(phase as never)) return purpose;
  }
  return 'coding';
}

export type ProductSelectionProbeResult =
  | { ok: true; selection: { product: string | null; source: string; candidates: string[] } }
  | { ok: false; reason: 'missing' | 'error'; message?: string };

/**
 * 经 profile 解析一次 product selection。
 *   - `missing`：profile 无 product-selection 模块（generic 等无构建语义 profile）→
 *     调用方可跳过（结构上不适用）；
 *   - `error`：解析器存在但执行失败 → **不得跳过**，调用方须转既有 halt。
 */
export function resolveProductSelectionViaProfile(
  projectRoot: string,
  profileHarnessDir: string | null,
  purpose: ProductSelectionPurpose,
): ProductSelectionProbeResult {
  if (!profileHarnessDir) return { ok: false, reason: 'missing' };
  const moduleBase = path.join(profileHarnessDir, 'product-selection');
  let mod: { resolveProductSelection?: (input: {
    projectRoot: string;
    purpose: ProductSelectionPurpose;
  }) => { product: string | null; source: string; candidates: string[] } };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(moduleBase) as typeof mod;
  } catch (err) {
    // 模块文件物理不存在 → missing（可跳过）；存在但 require 失败（含语法/加载错误）
    // → error（不得静默跳过）。
    const fileExists = ['.ts', '.js', ''].some(ext => {
      try { return fs.existsSync(`${moduleBase}${ext}`); } catch { return false; }
    });
    if (!fileExists) return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
  if (typeof mod.resolveProductSelection !== 'function') {
    return { ok: false, reason: 'missing' };
  }
  try {
    return { ok: true, selection: mod.resolveProductSelection({ projectRoot, purpose }) };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
}