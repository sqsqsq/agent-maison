// ============================================================================
// check-contract-consistency.ts — feature contract / workflow consistency gate
// ============================================================================

import * as path from 'path';
import {
  loadWorkflowSpec,
  type WorkflowArtifact,
  type WorkflowSpec,
} from '../workflow-loader';
import {
  artifactInTrack,
  effectiveRequires,
  type FeatureTrack,
} from './utils/runtime-policy';
import {
  loadArtifactInventory,
  loadFeatureContracts,
  phaseContractIndex,
  type ContractInput,
  type PhaseContract,
  type SkillContract,
} from './utils/skill-contract';
import {
  PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE,
  PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE,
  PHASE_OUTPUT_FILES_BY_PHASE,
} from './utils/phase-evidence-manifest';

export interface ContractConsistencyIssue {
  code:
    | 'phase_missing'
    | 'phase_extra'
    | 'skill_doc'
    | 'check_provider'
    | 'track_mismatch'
    | 'unregistered_artifact'
    | 'missing_producer'
    | 'control_dependency'
    | 'evidence_ownership';
  message: string;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const aa = sorted(a);
  const bb = sorted(b);
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function inputArtifacts(input: ContractInput): string[] {
  if (input.artifact) return [input.artifact];
  return (input.alternatives ?? [])
    .map((alternative) => alternative.artifact)
    .filter((artifact): artifact is string => typeof artifact === 'string');
}

function phaseInputArtifacts(phase: PhaseContract, track: FeatureTrack): Set<string> {
  const applies = (input: ContractInput): boolean => !input.tracks || input.tracks.includes(track);
  return new Set(
    [...phase.inputs.required, ...phase.inputs.optional]
      .filter(applies)
      .flatMap(inputArtifacts),
  );
}

function phaseOutputArtifacts(phase: PhaseContract): Set<string> {
  return new Set(
    phase.produces
      .map((output) => output.artifact)
      .filter((artifact): artifact is string => typeof artifact === 'string'),
  );
}

function ancestorClosure(
  workflow: WorkflowSpec,
  phaseId: string,
  track: FeatureTrack,
): Set<string> {
  const byId = new Map(workflow.artifacts.map((artifact) => [artifact.id, artifact]));
  const out = new Set<string>();
  const visit = (id: string): void => {
    const artifact = byId.get(id);
    if (!artifact) return;
    for (const required of effectiveRequires(workflow, artifact, track)) {
      if (out.has(required)) continue;
      out.add(required);
      visit(required);
    }
  };
  visit(phaseId);
  return out;
}

function workflowTracks(artifact: WorkflowArtifact): FeatureTrack[] {
  return (artifact.tracks ?? ['full']) as FeatureTrack[];
}

function phaseOwnsInventoryPath(phaseName: string, relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  const direct = [
    ...(PHASE_OUTPUT_FILES_BY_PHASE[phaseName] ?? []),
    ...(PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phaseName] ?? []),
  ];
  const relative = PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phaseName] ?? [];
  return direct.includes(basename) || relative.includes(normalized);
}
function producerMap(contracts: readonly SkillContract[]): Map<string, Set<string>> {
  const producers = new Map<string, Set<string>>();
  for (const contract of contracts) {
    for (const [phaseName, phase] of Object.entries(contract.phases)) {
      for (const artifact of phaseOutputArtifacts(phase)) {
        const phases = producers.get(artifact) ?? new Set<string>();
        phases.add(phaseName);
        producers.set(artifact, phases);
      }
    }
  }
  return producers;
}

export function validateContractConsistency(
  frameworkRoot: string,
  workflow: WorkflowSpec,
  contracts: readonly SkillContract[],
  registeredArtifactIds: ReadonlySet<string>,
  artifactPathsById?: ReadonlyMap<string, readonly string[]>,
): ContractConsistencyIssue[] {
  const issues: ContractConsistencyIssue[] = [];
  const index = phaseContractIndex(contracts);
  const featureArtifacts = workflow.artifacts.filter((artifact) => artifact.scope === 'feature');
  const featurePhaseIds = new Set(featureArtifacts.map((artifact) => artifact.id));
  const producers = producerMap(contracts);

  for (const artifact of featureArtifacts) {
    const indexed = index.get(artifact.id);
    if (!indexed) {
      issues.push({
        code: 'phase_missing',
        message: `workflow feature phase "${artifact.id}" 缺 contract phase`,
      });
      continue;
    }
    const { contract, phase } = indexed;
    if (phase.verifies.check !== artifact.check) {
      issues.push({
        code: 'check_provider',
        message: `${artifact.id}: contract check=${phase.verifies.check}，workflow check=${String(artifact.check)}`,
      });
    }
    if (!sameSet(phase.tracks, workflowTracks(artifact))) {
      issues.push({
        code: 'track_mismatch',
        message: `${artifact.id}: contract tracks=[${phase.tracks.join(',')}]，workflow tracks=[${workflowTracks(artifact).join(',')}]`,
      });
    }
    if (!artifact.skill_doc) {
      issues.push({
        code: 'skill_doc',
        message: `${artifact.id}: workflow 缺 skill_doc`,
      });
    } else {
      const workflowDoc = path.resolve(frameworkRoot, 'workflows', artifact.skill_doc);
      const contractDoc = path.resolve(path.dirname(contract.source_path), contract.skill_doc);
      if (workflowDoc !== contractDoc) {
        issues.push({
          code: 'skill_doc',
          message: `${artifact.id}: workflow skill_doc 未指向 ${contract.skill}/SKILL.md`,
        });
      }
    }

    for (const output of phaseOutputArtifacts(phase)) {
      if (!registeredArtifactIds.has(output)) {
        issues.push({
          code: 'unregistered_artifact',
          message: `${artifact.id}: produced artifact "${output}" 未注册`,
        });
        continue;
      }
      const inventoryPaths = artifactPathsById?.get(output);
      if (inventoryPaths && !inventoryPaths.some((relativePath) =>
        phaseOwnsInventoryPath(artifact.id, relativePath))) {
        issues.push({
          code: 'evidence_ownership',
          message: `${artifact.id}: produced artifact "${output}" 未纳入该 phase evidence outputs`,
        });
      }
    }

    for (const track of phase.tracks) {
      const ancestors = ancestorClosure(workflow, artifact.id, track);
      const inputs = phaseInputArtifacts(phase, track);
      for (const input of inputs) {
        if (!registeredArtifactIds.has(input)) {
          issues.push({
            code: 'unregistered_artifact',
            message: `${artifact.id}: input artifact "${input}" 未注册`,
          });
          continue;
        }
        const candidateProducers = producers.get(input) ?? new Set<string>();
        const reachable = [...candidateProducers].some((producer) => ancestors.has(producer));
        if (!reachable) {
          issues.push({
            code: 'missing_producer',
            message:
              `${artifact.id}[${track}]: input "${input}" 无 effectiveRequires 可达 producer；` +
              `known=[${sorted(candidateProducers).join(',')}] ancestors=[${sorted(ancestors).join(',')}]`,
          });
        }
      }

      const controls = new Set(phase.control_dependencies ?? []);
      for (const required of effectiveRequires(workflow, artifact, track)) {
        const requiredPhase = index.get(required)?.phase;
        const transfersArtifact =
          requiredPhase !== undefined &&
          [...phaseOutputArtifacts(requiredPhase)].some((output) => inputs.has(output));
        if (!transfersArtifact && !controls.has(required)) {
          issues.push({
            code: 'control_dependency',
            message: `${artifact.id}[${track}]: workflow edge ${required} -> ${artifact.id} 不传 registry artifact，须声明 control_dependencies`,
          });
        }
      }
      for (const control of controls) {
        if (!effectiveRequires(workflow, artifact, track).includes(control)) {
          issues.push({
            code: 'control_dependency',
            message: `${artifact.id}[${track}]: control dependency "${control}" 不是直接 workflow edge`,
          });
        }
      }
    }
  }

  for (const phaseName of index.keys()) {
    if (!featurePhaseIds.has(phaseName)) {
      issues.push({
        code: 'phase_extra',
        message: `contract phase "${phaseName}" 不在 workflow feature phases`,
      });
    }
  }
  return issues;
}

export function checkContractConsistency(frameworkRoot: string): ContractConsistencyIssue[] {
  const workflow = loadWorkflowSpec(frameworkRoot, 'spec-driven');
  const contracts = loadFeatureContracts(frameworkRoot);
  const inventory = loadArtifactInventory(frameworkRoot);
  return validateContractConsistency(
    frameworkRoot,
    workflow,
    contracts,
    new Set(inventory.artifacts.map((artifact) => artifact.id)),
    new Map(inventory.artifacts.map((artifact) => [artifact.id, artifact.paths])),
  );
}

function main(): void {
  const frameworkRoot = path.resolve(__dirname, '..', '..');
  const issues = checkContractConsistency(frameworkRoot);
  if (issues.length > 0) {
    console.error('[contract-consistency] FAIL');
    for (const issue of issues) console.error(`- ${issue.code}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('[contract-consistency] PASS');
}

if (require.main === module) main();
