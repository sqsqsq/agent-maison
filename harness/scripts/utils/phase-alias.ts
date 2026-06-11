/**
 * Phase id normalization — canonical spec/plan with legacy prd/design alias + WARN.
 */

import type { CheckResult } from './types';

/** Canonical feature phase ids (subset of workflow feature phases). */
export const CANONICAL_FEATURE_PHASES = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as const;

export type CanonicalFeaturePhase = (typeof CANONICAL_FEATURE_PHASES)[number];

const PHASE_ID_ALIASES: Readonly<Record<string, CanonicalFeaturePhase>> = {
  prd: 'spec',
  spec: 'spec',
  design: 'plan',
  plan: 'plan',
  coding: 'coding',
  review: 'review',
  ut: 'ut',
  testing: 'testing',
};

const CHECK_ID_ALIASES: Readonly<Record<string, string>> = {
  scope_consistency_with_prd: 'scope_consistency_with_spec',
  prd_file_exists: 'spec_file_exists',
  prd_p0_coverage: 'spec_p0_coverage',
  prd_p1_coverage: 'spec_p1_coverage',
  prd_visual_handoff: 'spec_visual_handoff',
  design_file_exists: 'plan_file_exists',
  prd_mapping_table: 'spec_mapping_table',
  design_to_architecture: 'plan_to_architecture',
  design_to_code: 'plan_to_code',
  design_file_plan_to_code: 'plan_file_to_code',
  code_to_design: 'code_to_plan',
  prd_acceptance_to_code: 'spec_acceptance_to_code',
};

const warnedPhaseIds = new Set<string>();
const warnedCheckIds = new Set<string>();

export function isLegacyPhaseId(id: string): boolean {
  return id === 'prd' || id === 'design';
}

/** Normalize phase id; legacy prd/design emit WARN once per process per id. */
export function normalizePhaseId(
  id: string | undefined,
  fallback: CanonicalFeaturePhase = 'spec',
): CanonicalFeaturePhase {
  const raw = (id ?? '').trim();
  if (!raw) return fallback;
  const mapped = PHASE_ID_ALIASES[raw];
  if (!mapped) return raw as CanonicalFeaturePhase;
  if (isLegacyPhaseId(raw) && !warnedPhaseIds.has(raw)) {
    warnedPhaseIds.add(raw);
    // eslint-disable-next-line no-console
    console.warn(
      `[phase-alias] 已弃用 phase id "${raw}"，请改用 "${mapped}"（alias 将保留 ≥2 个 minor 窗口）`,
    );
  }
  return mapped;
}

/** Normalize check id for overlay/compat lookup. */
export function normalizeCheckId(id: string): string {
  const mapped = CHECK_ID_ALIASES[id] ?? id;
  if (mapped !== id && !warnedCheckIds.has(id)) {
    warnedCheckIds.add(id);
    // eslint-disable-next-line no-console
    console.warn(`[phase-alias] 已弃用 check id "${id}"，请改用 "${mapped}"`);
  }
  return mapped;
}

export function phaseAliasWarnCheckResult(legacyId: string, canonicalId: string): CheckResult {
  return {
    id: 'phase_id_alias_deprecated',
    category: 'structure',
    description: `已弃用 phase id "${legacyId}"，请改用 "${canonicalId}"`,
    severity: 'MINOR',
    status: 'WARN',
    details:
      `本次运行已将 "${legacyId}" 规范化为 "${canonicalId}"。` +
      `alias 将保留 ≥2 个 minor 窗口；请更新 workflow、goal manifest 与实例 overlay。`,
  };
}

/** Reset warn-once sets (unit tests). */
export function resetPhaseAliasWarnings(): void {
  warnedPhaseIds.clear();
  warnedCheckIds.clear();
}
