// ============================================================================
// phase-device-requirement.ts — phase 是否需要真实设备（openspec device-readiness-and-completion t3）
// ----------------------------------------------------------------------------
// 为何存在：设备就绪门只能在**确实需要设备**的 phase 执行。若硬编码
// `phase === 'ut' || 'testing'`，未来出现 host-only UT profile（纯 JVM/Node 跑单测、
// 不连手机）时会被错误要求连设备——而且 spec/plan/coding 每个 attempt 都去探测/唤醒/
// 解锁手机本身就是越权副作用。
//
// 派生链（全部复用现成机制，不新造映射）：
//   phase --PHASE_CAPABILITY_MAP--> capability[] --profile.device_capabilities--> 需要设备?
//
// profile 侧只需在 `device_capabilities` 列出"这条 capability 要连真机"的 key；
// 未声明 = 不需要设备（generic profile 天然全 false，行为与本改动前一致）。
// ============================================================================

import { isCapabilitySkipped } from '../../capability-registry';
import type { CapabilityKey, HarnessResolvedProfile } from './types';
import type { FeaturePhase } from './phase-transition-policy';
import { PHASE_CAPABILITY_MAP } from './phase-personal-prerequisites';

/** profile.yaml 顶层键：声明哪些 capability 必须有真实设备/模拟器才能执行 */
export const PROFILE_DEVICE_CAPABILITIES_KEY = 'device_capabilities';

/** 读 profile 声明的"需设备 capability"集合；未声明 → 空集（= 该 profile 不需要设备） */
export function declaredDeviceCapabilities(resolved: HarnessResolvedProfile): Set<CapabilityKey> {
  const raw = (resolved.yaml as Record<string, unknown>)[PROFILE_DEVICE_CAPABILITIES_KEY];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((k): k is CapabilityKey => typeof k === 'string' && k.trim().length > 0));
}

/**
 * 本 phase 是否需要设备。
 *
 * **被跳过的 capability 不算**（与 resolvePhasePersonalPrerequisites 同款语义）——
 * capability 已 skip 说明该能力在本工程不执行，自然不需要设备。
 */
export function phaseRequiresDevice(
  phase: string,
  resolved: HarnessResolvedProfile,
): boolean {
  const declared = declaredDeviceCapabilities(resolved);
  if (declared.size === 0) return false;
  const caps = PHASE_CAPABILITY_MAP[phase as FeaturePhase] ?? [];
  return caps.some(capKey => declared.has(capKey) && !isCapabilitySkipped(resolved, capKey));
}

/** 链路中任一 phase 需要设备（goal 启动期决定是否需要 device policy 授权） */
export function chainRequiresDevice(
  phases: readonly string[],
  resolved: HarnessResolvedProfile,
): boolean {
  return phases.some(p => phaseRequiresDevice(p, resolved));
}
