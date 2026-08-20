import * as path from 'path';
import { featureFilePath } from '../../config';
import { classifyGoalRunsDir } from './fidelity-shared';
import { filterAuthoritativeEvents, loadEventsJsonl, resolveEffectiveRunEnd } from './goal-runner-phase';
import { ChangeUnitArtifact } from './change-unit-model';
import {
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  loadCanonicalChangeUnit,
} from './change-unit-path';
import { resolveChangeUnitExpectedExecution } from './change-unit-completion';
import {
  ChangeUnitReadySet,
  DeriveChangeUnitReadySetOptions,
  deriveChangeUnitReadySet,
} from './change-unit-ready-set';
import { selectNextChangeUnit } from './change-unit-selection';
import { validateChangeUnitProviderBoundary } from './change-unit-provider-boundary';

export type ChangeUnitProgressionAction = 'resume_active' | 'select_one' | 'blocked' | 'ready_for_component_closure';

export interface ActiveChangeUnitRun {
  featureId: string;
  runId: string;
}

export interface CorruptChangeUnitRun {
  featureId: string;
  runId: string;
  reason: string;
}

export interface ChangeUnitRunsInspection {
  active: ActiveChangeUnitRun[];
  corrupt: CorruptChangeUnitRun[];
}

export interface ChangeUnitProgressionDecision {
  action: ChangeUnitProgressionAction;
  selected?: ChangeUnitArtifact;
  activeRun?: ActiveChangeUnitRun;
  reasons: string[];
  readySet: ChangeUnitReadySet;
}

export interface ChangeUnitGoalHandoff {
  featureId: string;
  canonicalPath: string;
  changeUnitRef: ReturnType<typeof createChangeUnitRef>;
  componentBlueprintRef: ChangeUnitArtifact['component_blueprint_ref'];
  expectedTrack: string;
  expectedChain: string[];
  requirement: string;
}

export interface ChangeUnitGoalCallerResult {
  status: 'completed' | 'failed' | 'paused' | 'awaiting_human';
  runId?: string;
  reason?: string;
}

export type ChangeUnitGoalCaller = (handoff: ChangeUnitGoalHandoff) => Promise<ChangeUnitGoalCallerResult>;

export interface ChangeUnitProgressLoopOptions {
  ready?: DeriveChangeUnitReadySetOptions;
  inspectActiveRuns?: (projectRoot: string, units: ChangeUnitArtifact[]) => ChangeUnitRunsInspection;
  caller: ChangeUnitGoalCaller;
  buildHandoff?: (projectRoot: string, unit: ChangeUnitArtifact) => ChangeUnitGoalHandoff;
  maxUnits?: number;
}

export function inspectActiveChangeUnitRuns(
  projectRoot: string,
  units: ChangeUnitArtifact[],
): ChangeUnitRunsInspection {
  const active: ActiveChangeUnitRun[] = [];
  const corrupt: CorruptChangeUnitRun[] = [];
  for (const unit of units) {
    const featureId = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
    const runsDir = featureFilePath(projectRoot, featureId, 'goal-runs');
    const classified = classifyGoalRunsDir(runsDir);
    for (const item of classified.corruptRuns) corrupt.push({ featureId, runId: item.runId, reason: item.reason });
    for (const runId of [...classified.runs].reverse()) {
      const events = filterAuthoritativeEvents(loadEventsJsonl(path.join(runsDir, runId, 'events.jsonl')));
      if (events.length > 0 && !resolveEffectiveRunEnd(events)) {
        active.push({ featureId, runId });
        break;
      }
    }
  }
  return { active, corrupt };
}

export function deriveChangeUnitProgressionDecision(
  readySet: ChangeUnitReadySet,
  inspection: ChangeUnitRunsInspection,
): ChangeUnitProgressionDecision {
  if (inspection.corrupt.length > 0) {
    return {
      action: 'blocked',
      reasons: inspection.corrupt.map(item =>
        `${item.featureId}: goal-run ${item.runId} 损坏：${item.reason}——人工核查该目录（恢复 manifest 或确认废弃）后重验`),
      readySet,
    };
  }
  const activeRuns = inspection.active;
  if (activeRuns.length > 0) {
    return { action: 'resume_active', activeRun: activeRuns[0], reasons: ['已有 Goal Mode run 未终局。'], readySet };
  }
  if (readySet.allCompleted) {
    return { action: 'ready_for_component_closure', reasons: ['所有 CU completion VALID 且历史 targets 当前仍获准；仅交给 P3 评估。'], readySet };
  }
  const selected = selectNextChangeUnit(readySet.ready);
  if (selected) return { action: 'select_one', selected, reasons: [`priority=${selected.priority}, stable_id=${selected.change_unit_id}`], readySet };
  const reasons = readySet.units.flatMap(item => item.blockers.map(blocker => `${item.changeUnit.change_unit_id}:${blocker.id}:${blocker.message}`));
  if (readySet.silentProgressStall) reasons.push('silent_progress_stall');
  return { action: 'blocked', reasons: reasons.length > 0 ? reasons : ['没有 ready CU，且未达到 component closure handoff。'], readySet };
}

export function buildChangeUnitGoalHandoff(projectRoot: string, unit: ChangeUnitArtifact): ChangeUnitGoalHandoff {
  const loaded = loadCanonicalChangeUnit(projectRoot, unit.component_id, unit.change_unit_id);
  const featureId = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
  const expected = resolveChangeUnitExpectedExecution(projectRoot, featureId);
  const ref = createChangeUnitRef(loaded);
  return {
    featureId,
    canonicalPath: loaded.canonicalPath,
    changeUnitRef: ref,
    componentBlueprintRef: unit.component_blueprint_ref,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
    requirement: [
      `Implement exactly canonical Change Unit ${loaded.canonicalPath}.`,
      `change_unit_ref=${JSON.stringify(ref)}`,
      `component_blueprint_ref=${JSON.stringify(unit.component_blueprint_ref)}`,
      'Read intent and obligations from the formal artifacts; do not copy, redefine, or infer missing blueprint/CU content.',
    ].join('\n'),
  };
}

export async function runChangeUnitProgression(
  projectRoot: string,
  componentId: string,
  options: ChangeUnitProgressLoopOptions,
): Promise<ChangeUnitProgressionDecision> {
  const providerBoundary = validateChangeUnitProviderBoundary();
  if (!providerBoundary.ok) {
    const readySet = deriveChangeUnitReadySet(projectRoot, componentId, options.ready);
    return { action: 'blocked', reasons: providerBoundary.blockers, readySet };
  }
  const maxUnits = options.maxUnits ?? Number.MAX_SAFE_INTEGER;
  let invoked = 0;
  while (true) {
    const readySet = deriveChangeUnitReadySet(projectRoot, componentId, options.ready);
    const units = readySet.units.map(item => item.changeUnit);
    const inspection = (options.inspectActiveRuns ?? inspectActiveChangeUnitRuns)(projectRoot, units);
    const decision = deriveChangeUnitProgressionDecision(readySet, inspection);
    if (decision.action !== 'select_one' || !decision.selected || invoked >= maxUnits) return decision;
    const result = await options.caller((options.buildHandoff ?? buildChangeUnitGoalHandoff)(projectRoot, decision.selected));
    invoked++;
    if (result.status !== 'completed') {
      return {
        action: result.status === 'paused' || result.status === 'awaiting_human' ? 'resume_active' : 'blocked',
        activeRun: result.runId ? { featureId: deriveChangeUnitFeatureId(decision.selected.component_id, decision.selected.change_unit_id), runId: result.runId } : undefined,
        reasons: [result.reason ?? `Goal Mode returned ${result.status}; no second CU was started.`],
        readySet: deriveChangeUnitReadySet(projectRoot, componentId, options.ready),
      };
    }
    const refreshed = deriveChangeUnitReadySet(projectRoot, componentId, options.ready);
    const selectedAfterCall = refreshed.units.find(item => (
      item.changeUnit.change_unit_id === decision.selected!.change_unit_id
    ));
    if (selectedAfterCall?.completion.state !== 'VALID') {
      return {
        action: 'blocked',
        reasons: [
          `change_unit_no_progress_after_completed:${decision.selected.change_unit_id}:completion=${selectedAfterCall?.completion.state ?? 'MISSING'}`,
        ],
        readySet: refreshed,
      };
    }
  }
}
