// ============================================================================
// capability-resolution-entry-input.ts — goal/CLI input bridge for pre-check resolution
// ============================================================================

import { loadGoalManifestFromRun } from './goal-manifest';

export interface CapabilityResolutionEntryInputOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  featuresDir: string;
  goalRunId?: string;
  explicitAdhocCases?: string;
}

export interface CapabilityResolutionEntryInput {
  requirement?: string;
  /** plan c4e8a1f7 T2：goal manifest 冻结的 requirement source 列表（共享发现集合输入）。 */
  requirementSourceFiles?: string[];
  adhocCases?: string;
}

/**
 * The resolver receives only normalized, identity-bound entry input. Goal mode reads
 * the canonical run manifest; direct testing may provide an explicit adhoc fallback.
 */
export function resolveCapabilityResolutionEntryInput(
  options: CapabilityResolutionEntryInputOptions,
): CapabilityResolutionEntryInput {
  let requirement: string | undefined;
  let requirementSourceFiles: string[] | undefined;
  const goalRunId = options.goalRunId?.trim();
  if (goalRunId) {
    const manifest = loadGoalManifestFromRun(options.projectRoot, goalRunId, {
      feature: options.feature,
      featuresDir: options.featuresDir,
    });
    requirement = manifest.requirement?.trim() || undefined;
    requirementSourceFiles = manifest.requirement_source_files;
  }
  const explicitAdhocCases = options.explicitAdhocCases?.trim() || '';
  return {
    ...(requirement ? { requirement } : {}),
    ...(requirementSourceFiles && requirementSourceFiles.length > 0
      ? { requirementSourceFiles }
      : {}),
    ...(explicitAdhocCases ? { adhocCases: explicitAdhocCases } : {}),
  };
}
