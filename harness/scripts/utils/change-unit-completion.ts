import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath, relFeaturesDir } from '../../config';
import { resolveWorkflowSpec, workflowForExistingRun } from '../../workflow-loader';
import { classifyGoalRunsDir } from './fidelity-shared';
import { filterAuthoritativeEvents, loadEventsJsonl, resolveEffectiveRunEnd } from './goal-runner-phase';
import { featurePhasesFromWorkflow } from './phase-transition-policy';
import { loadFeatureTrackDecl, resolveFeatureExecutionScope } from './feature-track';
import { resolveFeatureTrack } from './runtime-policy';
import { loadFrozenExecutionScope } from './goal-run-creation';
import { inferRepoLayout } from '../../repo-layout';
import { executionCompletionPhases } from './execution-scope';
import { isInsideProjectRoot } from './project-relative-path';
import { CompletionVerdict, verifyFeatureCompletion, resolvePhaseRunIds } from './verify-feature-completion';
import { SpecLoader } from './spec-loader';
import { resolveCapabilityResolutionEntryInput } from './capability-resolution-entry-input';
import { resolveCapabilityInputs, type ResolvedPhaseInputs } from './capability-resolution';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
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
  forNewRun = false,
): { expectedTrack: string; expectedChain: string[] } {
  let workflow = resolveWorkflowSpec(projectRoot);
  let frozenTrack: string | undefined;
  if (forNewRun && workflow.schema_version === '1.2') {
    const scope = resolveFeatureExecutionScope(projectRoot, featureId, workflow)!;
    if (scope.completion_target !== 'feature') throw new Error('CU 施工交接需要 Feature 完成目标');
    return { expectedTrack: 'full', expectedChain: [...scope.phase_chain] };
  }
  const projectionFile = featureFilePath(projectRoot, featureId, 'feature-completion.json');
  if (fs.existsSync(projectionFile)) {
    const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8')) as { original_path?: string };
    if (projection.original_path) {
      const original = path.resolve(projectRoot, projection.original_path);
      if (!isInsideProjectRoot(featureFilePath(projectRoot, featureId, 'goal-runs'), original)) throw new Error('completion 原件不在该 Feature 的 run 目录');
      const record = JSON.parse(fs.readFileSync(original, 'utf8')) as { run_id?: string };
      if (record.run_id) {
        const scope = loadFrozenExecutionScope(projectRoot, featureId, record.run_id);
        if (scope) return { expectedTrack: 'full', expectedChain: executionCompletionPhases(scope) };
        const manifestFile = featureFilePath(projectRoot, featureId, 'goal-runs/' + record.run_id + '/manifest.json');
        const legacy = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
        workflow = workflowForExistingRun(workflow, legacy, inferRepoLayout(projectRoot).frameworkRoot);
        if (Array.isArray(legacy.phase_chain)) frozenTrack = resolveFeatureTrack(undefined, legacy.phase_chain);
      }
    }
  }
  const track = frozenTrack === 'lite' ? 'lite' : frozenTrack === 'full' ? 'full' : resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, featureId));
  return { expectedTrack: track, expectedChain: featurePhasesFromWorkflow(workflow, track) };
}

function scopedCompletionRunId(projectRoot: string, feature: string, chain?: string[]): string | undefined {
  const phase = chain?.at(-1);
  const runId = phase ? resolvePhaseRunIds(projectRoot, feature, [phase]).runIds[phase] : undefined;
  return runId && loadFrozenExecutionScope(projectRoot, feature, runId) ? runId : undefined;
}

export function readCompletedFeatureDesign(projectRoot: string, feature: string, completion: ChangeUnitCompletionObservation) {
  let inputs: ResolvedPhaseInputs | undefined;
  const runId = completion.state === 'VALID' ? scopedCompletionRunId(projectRoot, feature, completion.expectedChain) : undefined;
  if (runId) {
    const frameworkRoot = inferRepoLayout(projectRoot).frameworkRoot;
    const entry = resolveCapabilityResolutionEntryInput({ projectRoot, frameworkRoot, feature: feature, phase: 'review', goalRunId: runId, featuresDir: relFeaturesDir(projectRoot) });
    inputs = resolveCapabilityInputs({ projectRoot, frameworkRoot, feature: feature, phase: 'review', track: 'full', ...entry }).inputs;
    if (!inputs) throw new Error('modern Component design inputs unavailable');
    if (inputs.values.contracts?.state !== 'resolved') throw new Error('完成契约输入未解析：' + JSON.stringify(inputs.values.contracts));
  }
  const spec = new SpecLoader(projectRoot).loadFeatureSpec(feature, inputs);
  return { spec, scoped: !!inputs };
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
  if (verdict.verdict === 'VALID') {
    try {
      if (scopedCompletionRunId(projectRoot, featureId, expected.expectedChain)) {
        const { spec } = readCompletedFeatureDesign(projectRoot, featureId, { state: 'VALID', featureId, ...expected, reasons: [] });
        const projection = validateChangeUnitFeatureProjection(projectRoot, featureId, spec.contracts, spec.acceptance, !!spec.useCases, 'review', []);
        if (projection.issues.length) return { state: 'INVALID', featureId, ...expected, reasons: projection.issues.map(issue => issue.id + ': ' + issue.message) };
      }
    } catch (error) { return { state: 'INVALID', featureId, ...expected, reasons: ['完成目标输入不可验证：' + String(error)] }; }
  }
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
