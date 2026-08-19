import { validateChangeUnitDesign } from './change-unit-design-gate';
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
import { asChangeUnitArtifact, enumerateCanonicalChangeUnits } from './change-unit-path';
import { ChangeUnitCarryForwardVerdict, evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { validateProviderEvolutionSequence } from './change-unit-evolution-seam';

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
  activeRunCount: number;
  legalBlockerCount: number;
}): boolean {
  return input.unfinishedPredicateCount > 0
    && input.readyCount === 0
    && input.activeRunCount === 0
    && input.legalBlockerCount === 0;
}

export function deriveChangeUnitReadySet(
  projectRoot: string,
  componentId: string,
  options: DeriveChangeUnitReadySetOptions = {},
): ChangeUnitReadySet {
  const units = options.units ?? enumerateCanonicalChangeUnits(projectRoot, componentId)
    .map(item => asChangeUnitArtifact(item.changeUnit));
  const completionById = new Map<string, ChangeUnitCompletionObservation>();
  const carryForwardById = new Map<string, ChangeUnitCarryForwardVerdict>();
  for (const unit of units) {
    const completion = observeChangeUnitCompletion(projectRoot, unit, options.completion);
    completionById.set(unit.change_unit_id, completion);
    carryForwardById.set(
      unit.change_unit_id,
      completion.state === 'VALID'
        ? evaluateChangeUnitCarryForward(projectRoot, unit)
        : { allowed: false, reasons: [`completion=${completion.state}`] },
    );
  }
  const cycles = detectChangeUnitDependencyCycles(units);
  const cycleMembers = new Set(cycles.flat());
  const evolutionIssues = validateProviderEvolutionSequence(units);
  const projections: ChangeUnitReadyProjection[] = [];
  const dependencyIssues: ChangeUnitDependencyIssue[] = [];
  for (const unit of units) {
    const completion = completionById.get(unit.change_unit_id)!;
    const blockers: ChangeUnitReadyProjection['blockers'] = [];
    if (completion.state === 'STALE' || completion.state === 'INVALID') {
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
    const dependencies = evaluateChangeUnitDependencies(unit, units, completionById, carryForwardById);
    dependencyIssues.push(...dependencies.issues);
    for (const item of dependencies.issues) blockers.push({ id: item.id, message: item.message, legal: true });
    for (const item of deriveChangeUnitBlockers(unit, { projectRoot, ...options.blockerProbe })) {
      if (item.active) blockers.push({ id: item.blockerId, message: `${item.reason}；owner=${item.owner}；unlock=${item.unlockCondition}`, legal: item.legal });
    }
    if (cycleMembers.has(unit.change_unit_id)) {
      blockers.push({ id: 'change_unit_dependency_cycle', message: `execution-precedence cycle: ${cycles.map(cycle => cycle.join(' -> ')).join('; ')}`, legal: true });
    }
    for (const item of evolutionIssues.filter(issue => issue.changeUnitId === unit.change_unit_id)) {
      blockers.push({ id: item.id, message: item.message, legal: true });
    }
    projections.push({
      changeUnit: unit,
      completion,
      ready: completion.state === 'ABSENT' && blockers.length === 0,
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
      unfinishedPredicateCount: unfinished.reduce((sum, item) => sum + item.changeUnit.target_predicates.length, 0),
      readyCount: ready.length,
      activeRunCount: 0,
      legalBlockerCount: hasLegalBlocker ? 1 : 0,
    }),
    allCompleted: projections.length > 0
      && projections.every(item => item.completion.state === 'VALID' && carryForwardById.get(item.changeUnit.change_unit_id)?.allowed),
  };
}
