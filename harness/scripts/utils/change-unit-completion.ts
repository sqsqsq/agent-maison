import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { classifyGoalRunsDir } from './fidelity-shared';
import { filterAuthoritativeEvents, loadEventsJsonl, resolveEffectiveRunEnd } from './goal-runner-phase';
import { featurePhasesFromWorkflow } from './phase-transition-policy';
import { loadFeatureTrackDecl } from './feature-track';
import { resolveFeatureTrack } from './runtime-policy';
import { CompletionVerdict, verifyFeatureCompletion } from './verify-feature-completion';
import { ChangeUnitArtifact } from './change-unit-model';
import {
  deriveChangeUnitFeatureId,
  inspectDerivedFeatureBinding,
  loadCanonicalChangeUnit,
} from './change-unit-path';

export type ChangeUnitCompletionState = 'ABSENT' | 'VALID' | 'STALE' | 'INVALID';

export interface ChangeUnitCompletionObservation {
  state: ChangeUnitCompletionState;
  featureId: string;
  expectedTrack?: string;
  expectedChain?: string[];
  reasons: string[];
}

export interface ChangeUnitCompletionAdapterOptions {
  projectionExists?: (projectRoot: string, featureId: string) => boolean;
  resolveExpected?: (projectRoot: string, featureId: string) => { expectedTrack: string; expectedChain: string[] };
  verify?: (input: {
    projectRoot: string;
    feature: string;
    expectedTrack: string;
    expectedChain: string[];
  }) => CompletionVerdict;
  successfulTerminalRunExists?: (projectRoot: string, featureId: string) => boolean;
}

const SUCCESSFUL_RUN_END_STATUSES = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);

export function hasSuccessfulTerminalChangeUnitRun(projectRoot: string, featureId: string): boolean {
  const runsDir = featureFilePath(projectRoot, featureId, 'goal-runs');
  for (const runId of classifyGoalRunsDir(runsDir).runs) {
    const events = filterAuthoritativeEvents(loadEventsJsonl(path.join(runsDir, runId, 'events.jsonl')));
    const runEnd = resolveEffectiveRunEnd(events);
    if (runEnd?.status && SUCCESSFUL_RUN_END_STATUSES.has(runEnd.status)) return true;
  }
  return false;
}

export function resolveChangeUnitExpectedExecution(
  projectRoot: string,
  featureId: string,
): { expectedTrack: string; expectedChain: string[] } {
  const workflow = resolveWorkflowSpec(projectRoot);
  const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, featureId));
  return { expectedTrack: track, expectedChain: featurePhasesFromWorkflow(workflow, track) };
}

export function observeChangeUnitCompletion(
  projectRoot: string,
  changeUnit: ChangeUnitArtifact,
  options: ChangeUnitCompletionAdapterOptions = {},
): ChangeUnitCompletionObservation {
  const featureId = deriveChangeUnitFeatureId(changeUnit.blueprint_id, changeUnit.change_unit_id);
  const binding = inspectDerivedFeatureBinding(projectRoot, changeUnit.blueprint_id, changeUnit.change_unit_id, changeUnit.component_id);
  if (binding.status === 'conflict') {
    return { state: 'INVALID', featureId, reasons: [binding.reason] };
  }
  if (binding.status === 'matched'
    && (binding.ref.revision !== changeUnit.revision
      || binding.ref.artifact_sha256 !== changeUnitRefHash(projectRoot, changeUnit))) {
    return { state: 'STALE', featureId, reasons: ['Feature contracts 绑定的是不同 CU revision/artifact hash。'] };
  }
  const projectionExists = options.projectionExists
    ?? ((root: string, feature: string) => fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
  if (!projectionExists(projectRoot, featureId)) {
    // 曾启动却缺 manifest 的 corrupt run 在场 → fail-closed（与 verify-feature-completion
    // goal_run_identity_intact 同一文案契约），不得折叠为 ABSENT 后静默重开新 run。
    const corruptRuns = classifyGoalRunsDir(featureFilePath(projectRoot, featureId, 'goal-runs')).corruptRuns;
    if (corruptRuns.length > 0) {
      return {
        state: 'INVALID',
        featureId,
        reasons: corruptRuns.map(item =>
          `goal-run ${item.runId} 损坏：${item.reason}——人工核查该目录（恢复 manifest 或确认废弃）后重验`),
      };
    }
    const successfulTerminalRunExists = options.successfulTerminalRunExists
      ?? hasSuccessfulTerminalChangeUnitRun;
    if (successfulTerminalRunExists(projectRoot, featureId)) {
      return {
        state: 'INVALID',
        featureId,
        reasons: ['Goal run reducer 已确认成功终局，但 feature-completion 投影缺失；不得降级为 ABSENT。'],
      };
    }
    return { state: 'ABSENT', featureId, reasons: ['从未形成可验证 feature-completion 投影。'] };
  }
  let expected: { expectedTrack: string; expectedChain: string[] };
  try {
    expected = (options.resolveExpected ?? resolveChangeUnitExpectedExecution)(projectRoot, featureId);
  } catch (error) {
    return { state: 'INVALID', featureId, reasons: [`workflow/track SSOT 无法解析：${(error as Error).message}`] };
  }
  const verdict = (options.verify ?? verifyFeatureCompletion)({
    projectRoot,
    feature: featureId,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
  });
  return {
    state: verdict.verdict,
    featureId,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
    reasons: verdict.reasons,
  };
}

function changeUnitRefHash(projectRoot: string, changeUnit: ChangeUnitArtifact): string {
  try {
    return loadCanonicalChangeUnit(projectRoot, changeUnit.blueprint_id, changeUnit.change_unit_id).artifactSha256;
  } catch {
    return '';
  }
}
