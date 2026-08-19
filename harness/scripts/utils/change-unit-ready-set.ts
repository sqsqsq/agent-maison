import * as path from 'path';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { deriveChangeUnitBlockers, ChangeUnitBlockerProbeContext } from './change-unit-blockers';
import {
  ChangeUnitCompletionAdapterOptions,
  ChangeUnitCompletionObservation,
  observeChangeUnitCompletion,
} from './change-unit-completion';
import {
  ChangeUnitDependencyIssue,
  detectChangeUnitDependencyCycles,
  evaluateChangeUnitDependencies,
} from './change-unit-dependencies';
import { ChangeUnitArtifact } from './change-unit-model';
import {
  asChangeUnitArtifact,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
} from './change-unit-path';
import { ChangeUnitCarryForwardVerdict, evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { blockerChangeUnitIssues, validateChangeUnit } from './change-unit-validator';
import { SpecLoader } from './spec-loader';

export interface ChangeUnitReadyProjection {
  changeUnit: ChangeUnitArtifact;
  completion: ChangeUnitCompletionObservation;
  ready: boolean;
  blockers: Array<{ id: string; message: string; legal: boolean }>;
}

export interface ChangeUnitReadySet {
  units: ChangeUnitReadyProjection[];
  ready: ChangeUnitArtifact[];
  completionById: Map<string, ChangeUnitCompletionObservation>;
  carryForwardById: Map<string, ChangeUnitCarryForwardVerdict>;
  cycles: string[][];
  issues: ChangeUnitDependencyIssue[];
  silentProgressStall: boolean;
  allCompleted: boolean;
}

export interface DeriveChangeUnitReadySetOptions {
  units?: ChangeUnitArtifact[];
  completion?: ChangeUnitCompletionAdapterOptions;
  blockerProbe?: Omit<ChangeUnitBlockerProbeContext, 'projectRoot'>;
}

export function isSilentProgressStall(input: {
  unfinishedPredicateCount: number;
  readyCount: number;
  legalBlockerCount: number;
}): boolean {
  return input.unfinishedPredicateCount > 0
    && input.readyCount === 0
    && input.legalBlockerCount === 0;
}

function validateStaleReexecution(
  projectRoot: string,
  unit: ChangeUnitArtifact,
): Array<{ id: string; message: string; legal: boolean }> {
  try {
    const featureId = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
    const frameworkRoot = path.resolve(__dirname, '..', '..', '..');
    const featureSpec = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(featureId);
    if ((featureSpec.shape_issues ?? []).length > 0) {
      return [{
        id: 'change_unit_stale_reexecution_mapping_invalid',
        message: featureSpec.shape_issues!.join('；'),
        legal: true,
      }];
    }
    const projection = validateChangeUnitFeatureProjection(
      projectRoot,
      featureId,
      featureSpec.contracts,
      featureSpec.acceptance,
      Boolean(featureSpec.useCases),
      'plan',
    );
    if (!projection.applicable) {
      return [{
        id: 'change_unit_stale_reexecution_mapping_missing',
        message: 'STALE completion 只有在当前 Feature 重新绑定并通过 ID-only mapping/design gate 后才可重执行。',
        legal: true,
      }];
    }
    return projection.issues.map(item => ({ id: item.id, message: item.message, legal: true }));
  } catch (error) {
    return [{
      id: 'change_unit_stale_reexecution_mapping_invalid',
      message: (error as Error).message,
      legal: true,
    }];
  }
}

export function deriveChangeUnitReadySet(
  projectRoot: string,
  componentId: string,
  options: DeriveChangeUnitReadySetOptions = {},
): ChangeUnitReadySet {
  const entries = options.units
    ? options.units.map(changeUnit => ({ changeUnit, canonicalPath: undefined as string | undefined }))
    : enumerateCanonicalChangeUnits(projectRoot, componentId)
      .map(item => ({ changeUnit: asChangeUnitArtifact(item.changeUnit), canonicalPath: item.canonicalPath }));
  const units = entries.map(item => item.changeUnit);
  const artifactIssuesByUnit = new Map<ChangeUnitArtifact, ReturnType<typeof blockerChangeUnitIssues>>();
  for (const entry of entries) {
    artifactIssuesByUnit.set(entry.changeUnit, blockerChangeUnitIssues(validateChangeUnit(
      entry.changeUnit as unknown as Record<string, unknown>,
      { projectRoot, canonicalPath: entry.canonicalPath },
    )));
  }
  const validUnits = units.filter(unit => (artifactIssuesByUnit.get(unit)?.length ?? 0) === 0);
  const completionById = new Map<string, ChangeUnitCompletionObservation>();
  const carryForwardById = new Map<string, ChangeUnitCarryForwardVerdict>();
  for (const unit of units) {
    const artifactIssues = artifactIssuesByUnit.get(unit) ?? [];
    if (artifactIssues.length > 0) {
      let featureId = '';
      try {
        featureId = deriveChangeUnitFeatureId(String(unit.component_id), String(unit.change_unit_id));
      } catch { /* invalid identity is already reported by the CU validator */ }
      completionById.set(unit.change_unit_id, {
        state: 'INVALID',
        featureId,
        reasons: artifactIssues.map(item => `[${item.id}] ${item.message}`),
      });
      carryForwardById.set(unit.change_unit_id, { allowed: false, reasons: ['canonical CU invalid'] });
      continue;
    }
    const completion = observeChangeUnitCompletion(projectRoot, unit, options.completion);
    completionById.set(unit.change_unit_id, completion);
    carryForwardById.set(
      unit.change_unit_id,
      completion.state === 'VALID'
        ? evaluateChangeUnitCarryForward(projectRoot, unit)
        : { allowed: false, reasons: [`completion=${completion.state}`] },
    );
  }
  const cycles = detectChangeUnitDependencyCycles(validUnits);
  const cycleMembers = new Set(cycles.flat());
  const projections: ChangeUnitReadyProjection[] = [];
  const dependencyIssues: ChangeUnitDependencyIssue[] = [];
  for (const unit of units) {
    const completion = completionById.get(unit.change_unit_id)!;
    const blockers: ChangeUnitReadyProjection['blockers'] = [];
    const artifactIssues = artifactIssuesByUnit.get(unit) ?? [];
    for (const item of artifactIssues) {
      blockers.push({ id: item.id, message: item.message, legal: true });
    }
    if (completion.state === 'INVALID') {
      blockers.push({ id: `change_unit_completion_${completion.state.toLowerCase()}`, message: completion.reasons.join('；'), legal: true });
    }
    if (completion.state === 'VALID' && carryForwardById.get(unit.change_unit_id)?.allowed !== true) {
      blockers.push({
        id: 'change_unit_carry_forward_reconciliation_required',
        message: carryForwardById.get(unit.change_unit_id)?.reasons.join('；') ?? '历史 targets 未获准。',
        legal: true,
      });
    }
    if (completion.state === 'ABSENT') {
      const design = validateChangeUnitDesign(projectRoot, unit as unknown as Record<string, unknown>);
      for (const item of design.issues) blockers.push({ id: item.id, message: item.message, legal: true });
    }
    if (completion.state === 'STALE') {
      blockers.push(...validateStaleReexecution(projectRoot, unit));
    }
    if (artifactIssues.length === 0) {
      const dependencies = evaluateChangeUnitDependencies(unit, validUnits, completionById, carryForwardById);
      dependencyIssues.push(...dependencies.issues);
      for (const item of dependencies.issues) blockers.push({ id: item.id, message: item.message, legal: true });
      for (const item of deriveChangeUnitBlockers(unit, { projectRoot, ...options.blockerProbe })) {
        if (item.active) blockers.push({ id: item.blockerId, message: `${item.reason}；owner=${item.owner}；unlock=${item.unlockCondition}`, legal: item.legal });
      }
    }
    if (cycleMembers.has(unit.change_unit_id)) {
      blockers.push({ id: 'change_unit_dependency_cycle', message: `execution-precedence cycle: ${cycles.map(cycle => cycle.join(' -> ')).join('; ')}`, legal: true });
    }
    projections.push({
      changeUnit: unit,
      completion,
      ready: (completion.state === 'ABSENT' || completion.state === 'STALE') && blockers.length === 0,
      blockers,
    });
  }
  const unfinished = projections.filter(item => item.completion.state !== 'VALID');
  const ready = projections.filter(item => item.ready).map(item => item.changeUnit);
  const hasLegalBlocker = unfinished.some(item => item.blockers.some(blocker => blocker.legal));
  return {
    units: projections,
    ready,
    completionById,
    carryForwardById,
    cycles,
    issues: dependencyIssues,
    silentProgressStall: isSilentProgressStall({
      unfinishedPredicateCount: unfinished.reduce((sum, item) => (
        sum + (Array.isArray(item.changeUnit.target_predicates) ? item.changeUnit.target_predicates.length : 1)
      ), 0),
      readyCount: ready.length,
      legalBlockerCount: hasLegalBlocker ? 1 : 0,
    }),
    allCompleted: projections.length > 0
      && projections.every(item => item.blockers.length === 0
        && item.completion.state === 'VALID'
        && carryForwardById.get(item.changeUnit.change_unit_id)?.allowed),
  };
}
