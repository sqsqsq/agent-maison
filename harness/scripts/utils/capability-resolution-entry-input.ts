// ============================================================================
// capability-resolution-entry-input.ts — goal/CLI input bridge for pre-check resolution
// ============================================================================

import type { PhaseInputContext } from './capability-resolution';
import { isExecutionSourceBasis } from './execution-scope';
import type { FactsInvocationContext } from './context-facts';
import { loadGoalManifestFromRun } from './goal-manifest';
import * as fs from 'fs';
import * as path from 'path';
import { loadFrozenExecutionScope } from './goal-run-creation';
import { loadFeatureContracts, phaseContractIndex, loadArtifactInventory } from './skill-contract';
import { resolveFactsAbsPath, factsBaselineFingerprint } from './context-facts';
import { parseContextExploration } from './context-exploration';
import { loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';

export interface CapabilityResolutionEntryInputOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  featuresDir: string;
  goalRunId?: string;
  frameworkRoot?: string;
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
    const scope = loadFrozenExecutionScope(options.projectRoot, options.feature, goalRunId);
    if (scope) {
      const frameworkRoot = options.frameworkRoot ?? path.resolve(__dirname, '../../..');
      const indexed = phaseContractIndex(loadFeatureContracts(frameworkRoot)).get(options.phase);
      if (indexed?.contract.schema_version !== '1.1') throw new Error('execution scope requires phase contract 1.1');
      const bindings = scope.obligations.flatMap(obligation => obligation.basis);
      const expectedBindings = scope.obligations.flatMap(obligation => [
        ...obligation.basis.filter(binding => !binding.dependencies.length || !binding.dependencies.every(dep => isExecutionSourceBasis(options.projectRoot, scope, obligation, dep))),
        ...(obligation.satisfied_by ?? []).filter(ref => 'input_id' in ref),
      ]);
      const sourcePaths = [...new Set(bindings.flatMap(binding => binding.dependencies.filter(dep => dep.role === 'derive' && dep.exists).map(dep => path.relative(options.projectRoot, dep.path).replace(/\\/g, '/'))))];
      const factsContext: FactsInvocationContext = {
        subject: { feature: options.feature, run_id: goalRunId }, first_phase: scope.phase_chain[0],
        source_paths: sourcePaths, required_input_snippets: [],
      };
      const factsPath = resolveFactsAbsPath(options.projectRoot, options.feature);
      if (fs.existsSync(factsPath)) {
        const raw = fs.readFileSync(factsPath, 'utf8');
        const { fm, error } = parseContextExploration(raw);
        const establishing = (fm as Record<string, unknown>).established_by;
        if (!error && typeof establishing === 'string' && establishing !== options.phase) {
          const fresh = recomputePhaseEvidenceStaleness(options.projectRoot, options.feature, [establishing], { frameworkRoot })[0];
          const evidence = loadPhaseEvidenceManifest(options.projectRoot, options.feature, establishing);
          if (fresh.verdict !== 'fresh' || !evidence?.integrityOk) {
            if (options.phase !== scope.phase_chain[0]) throw new Error(`facts baseline stale: return to ${scope.phase_chain[0]} to establish current facts`);
          } else {
            const paths = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((p): p is string => typeof p === 'string') : [];
            factsContext.baseline = { established_by: establishing, fingerprint: factsBaselineFingerprint(raw), dependencies: [...evidence.manifest.inputs, ...evidence.manifest.outputs].filter(entry => paths.includes(entry.path)).map(entry => ({ path: path.join(options.projectRoot, entry.path), exists: entry.exists, sha256: entry.sha256, role: 'derive' })) };
          }
        }
      }
      const inventory = loadArtifactInventory(frameworkRoot);
      const obligations: PhaseInputContext['obligations'] = {};
      for (const obligation of scope.obligations) {
        const previous = obligations[obligation.kind];
        obligations[obligation.kind] = previous === 'required' || obligation.applicability === 'required' ? 'required'
          : previous === 'unknown' || obligation.applicability === 'unknown' ? 'unknown' : 'not_applicable';
      }
      return { requirement, requirementSourceFiles, testTargets: sourcePaths, factsContext,
        inputContext: { schema_version: '1.1', subject: { feature: options.feature },
          obligations,
          expected_bindings: expectedBindings.filter(binding => indexed.phase.inputs.some(input => input.id === binding.input_id)),
          required_outputs: indexed.phase.produces.flatMap(output => inventory.artifacts.find(artifact => artifact.id === output.artifact)?.paths ?? []),
        } };
    }
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
