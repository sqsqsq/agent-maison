// ============================================================================
// phase-personal-prerequisites.ts — phase → capability → personal prerequisite
// ============================================================================

import { isCapabilitySkipped } from '../../capability-registry';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';
import type { FeaturePhase } from './phase-transition-policy';

export type PersonalPrerequisiteId = 'agent_adapter' | 'deveco_toolchain';

const PHASE_CAPABILITY_MAP: Partial<Record<FeaturePhase, string[]>> = {
  coding: ['coding.compile'],
  ut: ['ut.compile', 'ut.run'],
  testing: ['device_test.build', 'device_test.install', 'device_test.run'],
};

const CAPABILITY_PREREQUISITES: Record<string, PersonalPrerequisiteId[]> = {
  'coding.compile': ['deveco_toolchain'],
  'ut.compile': ['deveco_toolchain'],
  'ut.run': ['deveco_toolchain'],
  'device_test.build': ['deveco_toolchain'],
  'device_test.install': ['deveco_toolchain'],
  'device_test.run': ['deveco_toolchain'],
};

export function resolvePhasePersonalPrerequisites(
  phase: string,
  resolved: HarnessResolvedProfile,
): Set<PersonalPrerequisiteId> {
  const out = new Set<PersonalPrerequisiteId>(['agent_adapter']);
  const caps = PHASE_CAPABILITY_MAP[phase as FeaturePhase] ?? [];
  for (const capKey of caps) {
    if (isCapabilitySkipped(resolved, capKey as never)) continue;
    const prereqs = CAPABILITY_PREREQUISITES[capKey] ?? [];
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
