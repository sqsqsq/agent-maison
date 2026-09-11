// ============================================================================
// capability-resolution-entry-input.ts — goal/CLI input bridge for pre-check resolution
// ============================================================================

import type { PhaseInputContext } from './capability-resolution';
import type { FactsInvocationContext } from './context-facts';
import { loadGoalManifestFromRun } from './goal-manifest';

export interface CapabilityResolutionEntryInputOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  featuresDir: string;
  goalRunId?: string;
  explicitAdhocCases?: string;
  invocation?: { inputContext: PhaseInputContext; factsContext: FactsInvocationContext; requirement?: string; testTargets?: string[] };
}

export interface CapabilityResolutionEntryInput {
  inputContext?: PhaseInputContext;
  factsContext?: FactsInvocationContext;
  testTargets?: string[];
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
  if (options.invocation) {
    const { inputContext, factsContext, requirement, testTargets } = options.invocation;
    const subject = inputContext.subject;
    if ('feature' in subject ? subject.feature !== options.feature : !!options.feature || !/^[0-9a-f]{64}$/.test(subject.request_sha256)) {
      throw new Error('capability entry subject mismatch');
    }
    const factsSubject = factsContext.subject;
    if ('feature' in subject
      ? !('feature' in factsSubject) || factsSubject.feature !== subject.feature
      : !('request_sha256' in factsSubject) || factsSubject.request_sha256 !== subject.request_sha256) throw new Error('capability/facts subject mismatch');
    if (testTargets?.some(target => !factsContext.source_paths.includes(target))) throw new Error('facts do not cover explicit request targets');
    if (options.goalRunId) {
      const manifest = loadGoalManifestFromRun(options.projectRoot, options.goalRunId, { feature: options.feature, featuresDir: options.featuresDir });
      if (!('run_id' in factsSubject) || factsSubject.run_id !== options.goalRunId) throw new Error('facts run identity mismatch');
      if (!factsContext.baseline && manifest.phase_chain?.[0] !== factsContext.first_phase) throw new Error('facts establishing phase differs from frozen run');
      if (requirement !== undefined && requirement.trim() !== manifest.requirement?.trim()) throw new Error('explicit requirement differs from frozen run');
    }
    return { inputContext, factsContext, requirement, testTargets, adhocCases: options.explicitAdhocCases };
  }
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
