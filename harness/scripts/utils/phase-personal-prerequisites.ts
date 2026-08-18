// ============================================================================
// phase-personal-prerequisites.ts — phase → capability → personal prerequisite
// ============================================================================

import { loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { isCapabilitySkipped } from '../../capability-registry';
import type { HarnessResolvedProfile, CapabilityKey } from '../../scripts/utils/types';
import type { PersonalPrerequisiteId } from './personal-prerequisite-registry';
import type { FeaturePhase } from './phase-transition-policy';

export type { PersonalPrerequisiteId } from './personal-prerequisite-registry';

/** 框架级 phase → 候选 capability（profile yaml 不承载此映射） */
export const PHASE_CAPABILITY_MAP: Partial<Record<FeaturePhase, CapabilityKey[]>> = {
  coding: ['coding.compile'],
  ut: ['ut.compile', 'ut.run'],
  testing: ['device_test.build', 'device_test.install', 'device_test.run'],
};

export function resolvePhasePersonalPrerequisites(
  phase: string,
  resolved: HarnessResolvedProfile,
): Set<PersonalPrerequisiteId> {
  const out = new Set<PersonalPrerequisiteId>(['agent_adapter']);
  const caps = PHASE_CAPABILITY_MAP[phase as FeaturePhase] ?? [];
  const table = resolved.personalPrerequisites ?? {};
  for (const capKey of caps) {
    if (isCapabilitySkipped(resolved, capKey)) continue;
    const prereqs = table[capKey] ?? [];
    for (const p of prereqs) out.add(p);
  }
  return out;
}

export function unionPhasePersonalPrerequisites(
  phases: FeaturePhase[],
  resolved: HarnessResolvedProfile,
): Set<PersonalPrerequisiteId> {
  const out = new Set<PersonalPrerequisiteId>();
  for (const phase of phases) {
    for (const p of resolvePhasePersonalPrerequisites(phase, resolved)) {
      out.add(p);
    }
  }
  if (out.size === 0) out.add('agent_adapter');
  return out;
}

/** record-adapter / init 等无单一 phase 场景：coding+ut+testing 并集，显式含 agent_adapter */
const ALL_PERSONAL_SETUP_PHASES: FeaturePhase[] = ['coding', 'ut', 'testing'];

/**
 * 本 phase 是否需要解析/使用编译形态 product（plan a7c3f9e2 t4/t5）。
 *
 * 与 phaseRequiresDevice 同款派生链：capability 被 profile 声明为 SKIP 的不算。
 * product 相关 capability：coding.compile（代码编译）、ut.compile / ut.run（ohosTest
 * 出包与装机跑测）、device_test.build（testing 主 HAP 打包）。被跳过的 capability
 * 不产生 product 需求——与既有"跳过的能力不算数"口径一致。
 */
export function phaseRequiresProduct(phase: string, resolved: HarnessResolvedProfile): boolean {
  const caps = PHASE_CAPABILITY_MAP[phase as FeaturePhase] ?? [];
  return caps.some(capKey => {
    if (capKey !== 'coding.compile' && capKey !== 'ut.compile' && capKey !== 'ut.run' && capKey !== 'device_test.build') {
      return false;
    }
    return !isCapabilitySkipped(resolved, capKey);
  });
}

/** 链路中任一 phase 需要编译形态（goal 启动期决定是否做 product 前置检查） */
export function chainRequiresProduct(
  phases: readonly string[],
  resolved: HarnessResolvedProfile,
): boolean {
  return phases.some(p => phaseRequiresProduct(p, resolved));
}

export function resolveAllPersonalPrerequisites(projectRoot: string): Set<PersonalPrerequisiteId> {
  const cfg = loadFrameworkConfig(projectRoot);
  const resolved = loadResolvedProfile(projectRoot, cfg);
  return unionPhasePersonalPrerequisites(ALL_PERSONAL_SETUP_PHASES, resolved);
}
