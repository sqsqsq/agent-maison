import * as fs from 'fs';
import * as crypto from 'crypto';
import { featureFilePath } from '../../config';
import { ComponentBlueprintRef } from './component-blueprint-model';
import { loadCanonicalBlueprint, resolveComponentBlueprintRef, sha256Bytes } from './component-blueprint-path';
import {
  currentScopeItems,
  requirementTraceability,
  resolveCurrentScopeSource,
} from './blueprint-requirement-traceability';
import { stableJson } from './blueprint-discovery';
import {
  ClosureChangeUnitInput,
  ClosureFeatureInput,
  ClosureInputManifest,
  ComponentClosureIssue,
  closureIssue,
  compareCodePoint,
  stableSortStrings,
} from './component-closure-model';
import {
  ChangeUnitCompletionAdapterOptions,
  ChangeUnitCompletionObservation,
  observeChangeUnitCompletion,
} from './change-unit-completion';
import { ChangeUnitArtifact, ChangeUnitRef, sameBlueprintIdentity } from './change-unit-model';
import {
  LoadedChangeUnit,
  asChangeUnitArtifact,
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
  resolveChangeUnitRef,
  inspectDerivedFeatureBinding,
} from './change-unit-path';
import { ChangeUnitCarryForwardVerdict, evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { SpecLoader } from './spec-loader';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { loadPhaseEvidenceManifest } from './phase-evidence-manifest';
import { blockerChangeUnitIssues, validateChangeUnit } from './change-unit-validator';
import { ContractsSpec } from './types';
import { ComponentBlueprintRef as BlueprintRef } from './component-blueprint-model';

export interface ComponentClosureInputOptions {
  completion?: ChangeUnitCompletionAdapterOptions;
  observeCompletion?: (projectRoot: string, changeUnit: ChangeUnitArtifact) => ChangeUnitCompletionObservation;
  evaluateCarryForward?: (projectRoot: string, changeUnit: ChangeUnitArtifact) => ChangeUnitCarryForwardVerdict;
}

export interface ResolvedClosureChangeUnit {
  loaded: LoadedChangeUnit;
  ref: ChangeUnitRef;
  changeUnit: ChangeUnitArtifact;
  input: ClosureChangeUnitInput;
  completionObservation: ChangeUnitCompletionObservation;
}

export interface ResolvedComponentClosureInputs {
  blueprint: ReturnType<typeof loadCanonicalBlueprint>;
  blueprintRef: ComponentBlueprintRef;
  units: ResolvedClosureChangeUnit[];
  currentUnits: ResolvedClosureChangeUnit[];
  manifest: ClosureInputManifest;
  issues: ComponentClosureIssue[];
}

function rawFileHash(filePath: string): string | null {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? sha256Bytes(fs.readFileSync(filePath))
    : null;
}

function featureInput(
  projectRoot: string,
  unit: ChangeUnitArtifact,
  completion: ChangeUnitCompletionObservation,
  currentBlueprintRef: ComponentBlueprintRef,
): ClosureFeatureInput {
  const featureId = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
  const spec = new SpecLoader(projectRoot).loadFeatureSpec(featureId);
  const historical = !sameBlueprintIdentity(unit.component_blueprint_ref, currentBlueprintRef);
  const projectionContracts = historical
    ? normalizeHistoricalContracts(spec.contracts, currentBlueprintRef)
    : spec.contracts;
  const projectionUnit = historical ? normalizeHistoricalUnit(unit, currentBlueprintRef) : undefined;
  const projection = validateChangeUnitFeatureProjection(
    projectRoot,
    featureId,
    projectionContracts,
    spec.acceptance,
    Boolean(spec.useCases),
    'review',
    [],
    { changeUnitOverride: projectionUnit },
  );
  const evidenceHashes = stableSortStrings((completion.expectedChain ?? []).flatMap(phase => {
    const loaded = loadPhaseEvidenceManifest(projectRoot, featureId, phase);
    return loaded ? [loaded.fileSha256, loaded.manifest.aggregate_sha256] : [];
  }));
  return {
    feature_id: featureId,
    change_unit_id: unit.change_unit_id,
    contracts_sha256: rawFileHash(featureFilePath(projectRoot, featureId, 'contracts.yaml')),
    acceptance_sha256: rawFileHash(featureFilePath(projectRoot, featureId, 'acceptance.yaml')),
    completion_sha256: rawFileHash(featureFilePath(projectRoot, featureId, 'feature-completion.json')),
    evidence_manifest_hashes: evidenceHashes,
    projection_issue_ids: stableSortStrings([
      ...(spec.shape_issues ?? []).map((_, index) => `feature_spec_shape:${index}`),
      ...projection.issues.map(item => item.id),
    ]),
    use_cases_required: projection.useCasesRequired,
    dag_required: projection.dagRequired,
  };
}

function currentRef(ref: BlueprintRef, owner: ComponentBlueprintRef): BlueprintRef {
  return { ...owner, target: { ...ref.target } };
}

function normalizeHistoricalUnit(unit: ChangeUnitArtifact, owner: ComponentBlueprintRef): ChangeUnitArtifact {
  return {
    ...unit,
    component_blueprint_ref: { ...owner, target: { ...owner.target } },
    design_refs: unit.design_refs.map(ref => currentRef(ref, owner)),
    touches: unit.touches.map(touch => ({ ...touch, design_ref: currentRef(touch.design_ref, owner) })),
  };
}

function normalizeHistoricalContracts(
  contracts: ContractsSpec | undefined,
  owner: ComponentBlueprintRef,
): ContractsSpec | undefined {
  if (!contracts) return contracts;
  const cloned = JSON.parse(JSON.stringify(contracts)) as ContractsSpec;
  for (const mapping of cloned.change_unit?.design_ref_mappings ?? []) mapping.design_ref = currentRef(mapping.design_ref, owner);
  for (const state of cloned.state_management ?? []) {
    if (state.design_ref) state.design_ref = currentRef(state.design_ref, owner);
  }
  return cloned;
}

function inspectRetirement(
  units: Array<{ loaded: LoadedChangeUnit; ref: ChangeUnitRef; changeUnit: ChangeUnitArtifact }>,
  issues: ComponentClosureIssue[],
): Map<string, string> {
  const byId = new Map(units.map(unit => [unit.changeUnit.change_unit_id, unit]));
  const retiredBy = new Map<string, string>();
  const supersedesGraph = new Map<string, string>();
  for (const unit of units) {
    const targetRef = unit.changeUnit.supersedes;
    if (!targetRef) continue;
    supersedesGraph.set(targetRef.change_unit_id, unit.changeUnit.change_unit_id);
    const target = byId.get(targetRef.change_unit_id);
    if (!target
      || targetRef.component_id !== unit.changeUnit.component_id
      || target.ref.revision !== targetRef.revision
      || target.ref.artifact_sha256 !== targetRef.artifact_sha256) {
      issues.push(closureIssue(
        'component_closure_supersedes_invalid',
        `change-unit:${unit.changeUnit.change_unit_id}.supersedes`,
        `supersedes 必须精确绑定同部件 canonical CU：${targetRef.change_unit_id}。`,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
      continue;
    }
    const prior = retiredBy.get(targetRef.change_unit_id);
    if (prior && prior !== unit.changeUnit.change_unit_id) {
      issues.push(closureIssue(
        'component_closure_supersedes_conflict',
        `change-unit:${targetRef.change_unit_id}`,
        `${targetRef.change_unit_id} 被 ${prior} 与 ${unit.changeUnit.change_unit_id} 同时 supersede。`,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
    }
    retiredBy.set(targetRef.change_unit_id, unit.changeUnit.change_unit_id);
  }
  for (const start of byId.keys()) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor && supersedesGraph.has(cursor)) {
      if (seen.has(cursor)) {
        issues.push(closureIssue(
          'component_closure_supersedes_cycle',
          `change-unit:${start}`,
          `supersedes 形成环：${[...seen, cursor].join(' -> ')}。`,
          'BLOCKER',
          'repair_or_add_change_unit',
        ));
        break;
      }
      seen.add(cursor);
      cursor = supersedesGraph.get(cursor);
    }
  }
  return retiredBy;
}

export function resolveComponentClosureInputs(
  projectRoot: string,
  componentId: string,
  options: ComponentClosureInputOptions = {},
): ResolvedComponentClosureInputs {
  const issues: ComponentClosureIssue[] = [];
  const blueprint = loadCanonicalBlueprint(projectRoot, componentId);
  const blueprintRef: ComponentBlueprintRef = {
    artifact: 'component-blueprint@1',
    component_id: componentId,
    blueprint_id: String(blueprint.blueprint.blueprint_id),
    revision: Number(blueprint.blueprint.revision),
    source_fingerprint: String(blueprint.blueprint.source_fingerprint),
    artifact_sha256: blueprint.artifactSha256,
    target: { kind: 'blueprint', id: String(blueprint.blueprint.blueprint_id) },
  };
  try {
    resolveComponentBlueprintRef(projectRoot, blueprintRef);
  } catch (error) {
    issues.push(closureIssue('component_closure_blueprint_invalid', 'component_blueprint_ref', (error as Error).message, 'BLOCKER', 'reconcile_blueprint'));
  }

  const exactMappings = new Map(requirementTraceability(blueprint.blueprint).map(item => [item.item_id, item.blueprint_refs]));
  const requirements = currentScopeItems(blueprint.blueprint)
    .map(item => {
      let actualSourceSha256: string | undefined;
      try {
        actualSourceSha256 = resolveCurrentScopeSource(projectRoot, item.source_ref).source_sha256;
      } catch {
        actualSourceSha256 = undefined;
      }
      return {
        item_id: item.item_id,
        kind: item.kind,
        source_ref: item.source_ref,
        ...(item.source_revision ? { source_revision: item.source_revision } : {}),
        ...(actualSourceSha256 ? { source_sha256: actualSourceSha256 } : {}),
        blueprint_refs: stableSortStrings(exactMappings.get(item.item_id) ?? []),
      };
    })
    .sort((a, b) => compareCodePoint(a.item_id, b.item_id));

  const rawUnits: Array<{ loaded: LoadedChangeUnit; ref: ChangeUnitRef; changeUnit: ChangeUnitArtifact }> = [];
  for (const loaded of enumerateCanonicalChangeUnits(projectRoot, componentId)) {
    try {
      const ref = createChangeUnitRef(loaded);
      const artifact = asChangeUnitArtifact(loaded.changeUnit);
      if (sameBlueprintIdentity(artifact.component_blueprint_ref, blueprintRef)) {
        const resolved = resolveChangeUnitRef(projectRoot, ref);
        rawUnits.push({ loaded: resolved, ref, changeUnit: asChangeUnitArtifact(resolved.changeUnit) });
      } else {
        const artifactIssues = blockerChangeUnitIssues(validateChangeUnit(loaded.changeUnit, { canonicalPath: loaded.canonicalPath }))
          .filter(item => item.id !== 'change_unit_provenance_context_missing');
        if (artifactIssues.length > 0) throw new Error(artifactIssues.map(item => `${item.id}@${item.path}`).join(', '));
        const binding = inspectDerivedFeatureBinding(projectRoot, artifact.component_id, artifact.change_unit_id);
        if (binding.status !== 'matched'
          || binding.ref.revision !== ref.revision
          || binding.ref.artifact_sha256 !== ref.artifact_sha256) {
          throw new Error(`historical CU 的 deterministic Feature binding 不精确：${binding.status}`);
        }
        rawUnits.push({ loaded, ref, changeUnit: artifact });
      }
    } catch (error) {
      issues.push(closureIssue(
        'component_closure_change_unit_invalid',
        `change-unit:${String(loaded.changeUnit.change_unit_id ?? '?')}`,
        (error as Error).message,
        'BLOCKER',
        'repair_or_add_change_unit',
      ));
    }
  }
  rawUnits.sort((a, b) => compareCodePoint(a.changeUnit.change_unit_id, b.changeUnit.change_unit_id));
  const retiredBy = inspectRetirement(rawUnits, issues);
  const observe = options.observeCompletion
    ?? ((root: string, unit: ChangeUnitArtifact) => observeChangeUnitCompletion(root, unit, options.completion));
  const carry = options.evaluateCarryForward ?? evaluateChangeUnitCarryForward;
  const units: ResolvedClosureChangeUnit[] = rawUnits.map(unit => {
    const completion = observe(projectRoot, unit.changeUnit);
    const historicalBlueprint = !sameBlueprintIdentity(unit.changeUnit.component_blueprint_ref, blueprintRef);
    const carryForward = historicalBlueprint ? carry(projectRoot, unit.changeUnit) : { allowed: true, reasons: [] };
    const input: ClosureChangeUnitInput = {
      ref: unit.ref,
      current: !retiredBy.has(unit.changeUnit.change_unit_id),
      ...(retiredBy.has(unit.changeUnit.change_unit_id) ? { retired_by: retiredBy.get(unit.changeUnit.change_unit_id) } : {}),
      feature_id: completion.featureId,
      completion: completion.state,
      completion_reasons: stableSortStrings(completion.reasons),
      carry_forward: carryForward.allowed,
      carry_forward_reasons: stableSortStrings(carryForward.reasons),
    };
    return { ...unit, input, completionObservation: completion };
  });
  const features = units
    .map(unit => featureInput(projectRoot, unit.changeUnit, unit.completionObservation, blueprintRef))
    .sort((a, b) => compareCodePoint(a.feature_id, b.feature_id));
  return {
    blueprint,
    blueprintRef,
    units,
    currentUnits: units.filter(unit => unit.input.current),
    manifest: {
      requirements,
      change_units: units.map(unit => unit.input),
      features,
    },
    issues,
  };
}

export function fingerprintComponentClosureInputs(value: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}
