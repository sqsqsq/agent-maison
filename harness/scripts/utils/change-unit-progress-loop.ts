import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath } from '../../config';
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
  inspectActiveRuns?: (projectRoot: string, units: ChangeUnitArtifact[]) => ActiveChangeUnitRun[];
  caller: ChangeUnitGoalCaller;
  buildHandoff?: (projectRoot: string, unit: ChangeUnitArtifact) => ChangeUnitGoalHandoff;
  maxUnits?: number;
}

export function inspectActiveChangeUnitRuns(
  projectRoot: string,
  units: ChangeUnitArtifact[],
): ActiveChangeUnitRun[] {
  const active: ActiveChangeUnitRun[] = [];
  for (const unit of units) {
    const featureId = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
    const runsDir = featureFilePath(projectRoot, featureId, 'goal-runs');
    if (!fs.existsSync(runsDir)) continue;
    const runIds = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort();
    for (const runId of runIds.reverse()) {
      const events = filterAuthoritativeEvents(loadEventsJsonl(path.join(runsDir, runId, 'events.jsonl')));
      if (events.length > 0 && !resolveEffectiveRunEnd(events)) {
        active.push({ featureId, runId });
        break;
      }
    }
  }
  return active;
}

export function deriveChangeUnitProgressionDecision(
  readySet: ChangeUnitReadySet,
  activeRuns: ActiveChangeUnitRun[],
): ChangeUnitProgressionDecision {
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
    const activeRuns = (options.inspectActiveRuns ?? inspectActiveChangeUnitRuns)(projectRoot, units);
    const decision = deriveChangeUnitProgressionDecision(readySet, activeRuns);
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
  }
}
