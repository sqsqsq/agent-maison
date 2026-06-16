// ============================================================================
// phase-personal-prerequisites.ts — phase → capability → personal prerequisite
// ============================================================================

import { isCapabilitySkipped } from '../../capability-registry';
import type { HarnessResolvedProfile, CapabilityKey } from '../../scripts/utils/types';
import type { PersonalPrerequisiteId } from './personal-prerequisite-registry';
import type { FeaturePhase } from './phase-transition-policy';

export type { PersonalPrerequisiteId } from './personal-prerequisite-registry';

/** 框架级 phase → 候选 capability（profile yaml 不承载此映射） */
const PHASE_CAPABILITY_MAP: Partial<Record<FeaturePhase, CapabilityKey[]>> = {
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
