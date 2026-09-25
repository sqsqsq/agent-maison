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
import {
  asChangeUnitArtifact,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
} from './change-unit-path';
import { ChangeUnitCarryForwardVerdict, evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { blockerChangeUnitIssues, validateChangeUnit } from './change-unit-validator';
import { retiredChangeUnitIds } from './component-closure-inputs';

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

export function deriveChangeUnitReadySet(
  projectRoot: string,
  blueprintId: string,
  options: DeriveChangeUnitReadySetOptions = {},
): ChangeUnitReadySet {
  // M5A §8.5：注入 seams 同样 fail-closed——options.units 出现 foreign workspace 的
  // CU（含同 component_id 的早期演进）直接拒绝，不依赖默认枚举“碰巧同域”。
  if (options.units) {
    const foreign = options.units.filter(unit => unit.blueprint_id !== blueprintId);
    if (foreign.length > 0) {
      throw new Error(
        `[deriveChangeUnitReadySet] options.units 含 foreign workspace CU：`
        + foreign.map(unit => `${unit.blueprint_id}/${unit.change_unit_id}`).join('、') + `；仅允许同一 blueprint_id=${blueprintId} 工作区。`,
      );
    }
  }
  // 推进只看活动 CU：被精确 supersede 的历史 CU 已退役，不进 ready、不计 allCompleted（与 closure 同一退役判定）。
  const retired = retiredChangeUnitIds(projectRoot, blueprintId);
  const entries = (options.units
    ? options.units.map(changeUnit => ({ changeUnit, canonicalPath: undefined as string | undefined }))
    : enumerateCanonicalChangeUnits(projectRoot, blueprintId)
      .map(item => ({ changeUnit: asChangeUnitArtifact(item.changeUnit), canonicalPath: item.canonicalPath })))
    .filter(item => !retired.has(String(item.changeUnit.change_unit_id)));
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
        featureId = deriveChangeUnitFeatureId(String(unit.blueprint_id), String(unit.change_unit_id));
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
    if (completion.state === 'INCOMPLETE') {
      // plan b2d7f4e9 §3.5：记录可信但仍有 uncovered 义务 / blocking——逐条作 legal blocker（修正出口由 successor 承接）。
      for (const reason of completion.reasons) blockers.push({ id: 'change_unit_completion_incomplete', message: reason, legal: true });
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
