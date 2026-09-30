import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath, relFeaturesDir } from '../../config';
import { resolveWorkflowSpec, workflowForExistingRun } from '../../workflow-loader';
import { classifyGoalRunsDir } from './fidelity-shared';
import { filterAuthoritativeEvents, loadEventsJsonl, resolveEffectiveRunEnd } from './goal-runner-phase';
import { featurePhasesFromWorkflow } from './phase-transition-policy';
import { loadFeatureTrackDecl } from './feature-track';
import { resolveBirthExecutionScope } from './feature-execution-scope';
import { resolveFeatureTrack } from './runtime-policy';
import { loadEffectiveExecutionScope } from './goal-run-creation';
import { inferRepoLayout } from '../../repo-layout';
import { executionCompletionPhases } from './execution-scope';
import { isInsideProjectRoot } from './project-relative-path';
import { resolvePhaseRunIds } from './verify-feature-completion';
import { assessFeature, assessmentReasons, type FeatureAssessment } from './feature-assessment';
import { SpecLoader } from './spec-loader';
import { resolveCapabilityResolutionEntryInput } from './capability-resolution-entry-input';
import { resolveCapabilityInputs, type ResolvedPhaseInputs } from './capability-resolution';
import { ChangeUnitArtifact } from './change-unit-model';
import {
  deriveChangeUnitFeatureId,
  inspectDerivedFeatureBinding,
} from './change-unit-path';

/** plan b2d7f4e9 §3.5：记录不可信 → INVALID；记录可信但仍有 uncovered / blocking → INCOMPLETE。 */
export type ChangeUnitCompletionState = 'ABSENT' | 'VALID' | 'INCOMPLETE' | 'INVALID';

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
  /** 单元级注入接缝（只限局部单测，§6 #14）；生产走 assessFeature。 */
  assess?: (input: {
    projectRoot: string;
    feature: string;
    expectedTrack: string;
    expectedChain: string[];
  }) => FeatureAssessment;
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
  /** 调用方已知的框架根（框架与工程分开放时必须传）；缺省按工程布局推断。 */
  frameworkRoot?: string,
): { expectedTrack: string; expectedChain: string[] } {
  let workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot });
  let frozenTrack: string | undefined;
  if (forNewRun && workflow.schema_version === '1.2') {
    // 第五轮阻断 2：新 run 的交接期望链必须与**出生入口**同源。原来直接从候选算
    //（`resolveFeatureExecutionScope`），feature 已 S0→S1 时交接给的是 S0、出生用的是 S1。
    const scope = resolveBirthExecutionScope(projectRoot, featureId, workflow, frameworkRoot).scope!;
    if (scope.completion_target !== 'feature') throw new Error('CU 施工交接需要 Feature 完成目标');
    return { expectedTrack: 'full', expectedChain: [...scope.phase_chain] };
  }
  const projectionFile = featureFilePath(projectRoot, featureId, 'feature-completion.json');
  if (fs.existsSync(projectionFile)) {
    const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8')) as { original_path?: string };
    if (projection.original_path) {
      const original = path.resolve(projectRoot, projection.original_path);
      // D1 §6.5 H4：原件落点**按目录二分**，且必须先于读 `record.run_id`——
      // `goal-runs/` 内 = run 载体（现状）；`<feature>/completion/` 内 = feature 载体（无 run）。
      // 两者都不是才是「原件不在 runner 拥有的落点」。
      const inRunDir = isInsideProjectRoot(featureFilePath(projectRoot, featureId, 'goal-runs'), original);
      const inFeatureCompletionDir = isInsideProjectRoot(featureFilePath(projectRoot, featureId, 'completion'), original);
      if (!inRunDir && !inFeatureCompletionDir) throw new Error('completion 原件不在该 Feature 的 run 目录或 completion 目录');
      const record = JSON.parse(fs.readFileSync(original, 'utf8')) as { run_id?: string | null; scope_source?: string };
      if (record.scope_source === 'feature' || (inFeatureCompletionDir && !record.run_id)) {
        // feature 载体：统一入口在无 run 时读冻结记录；CU 消费**不区分** scope_source。
        const scope = loadEffectiveExecutionScope(projectRoot, featureId);
        if (scope) return { expectedTrack: 'full', expectedChain: executionCompletionPhases(scope) };
      }
      if (record.run_id) {
        const scope = loadEffectiveExecutionScope(projectRoot, featureId, record.run_id);
        if (scope) return { expectedTrack: 'full', expectedChain: executionCompletionPhases(scope) };
        const manifestFile = featureFilePath(projectRoot, featureId, 'goal-runs/' + record.run_id + '/manifest.json');
        const legacy = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
        workflow = workflowForExistingRun(workflow, legacy, frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot);
        if (Array.isArray(legacy.phase_chain)) frozenTrack = resolveFeatureTrack(undefined, legacy.phase_chain);
      }
    }
  }
  const track = frozenTrack === 'lite' ? 'lite' : frozenTrack === 'full' ? 'full' : resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, featureId));
  return { expectedTrack: track, expectedChain: featurePhasesFromWorkflow(workflow, track) };
}

/**
 * 完成原件所属 run 的 id。D1：feature 载体**没有** run（返回 null 而不是放弃）——
 * `undefined` = 「没找到范围载体」，`null` = 「找到了，但它是 feature 载体」。
 */
function scopedCompletionRunId(projectRoot: string, feature: string, chain?: string[]): string | null | undefined {
  const phase = chain?.at(-1);
  const runId = phase ? resolvePhaseRunIds(projectRoot, feature, [phase]).runIds[phase] : undefined;
  if (runId && loadEffectiveExecutionScope(projectRoot, feature, runId)) return runId;
  return loadEffectiveExecutionScope(projectRoot, feature) ? null : undefined;
}

export function readCompletedFeatureDesign(projectRoot: string, feature: string, completion: ChangeUnitCompletionObservation) {
  let inputs: ResolvedPhaseInputs | undefined;
  // D1：`undefined` = 没有范围载体；`null` = feature 载体（无 run）。CU 消费**不区分** scope_source，
  // 所以这里认「有载体」而不是「有 run」。
  const carrier = completion.state === 'VALID' ? scopedCompletionRunId(projectRoot, feature, completion.expectedChain) : undefined;
  if (carrier !== undefined) {
    const runId = carrier ?? undefined;
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
  // CU revision / artifact hash 失配与 ID-only 映射完整性由 assessFeature 的 Feature↔CU 绑定核对判为 plan
  // 义务 uncovered/binding（plan b2d7f4e9 §3.1），不在这里另判一次。
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
  const assessment = (options.assess ?? (input => assessFeature(input.projectRoot, input.feature, input)))({
    projectRoot,
    feature: featureId,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
  });
  return {
    state: assessment.record.state === 'absent' ? 'ABSENT'
      : assessment.record.state === 'broken' ? 'INVALID'
      : assessment.complete ? 'VALID' : 'INCOMPLETE',
    featureId,
    expectedTrack: expected.expectedTrack,
    expectedChain: expected.expectedChain,
    reasons: assessment.complete ? [] : assessmentReasons(assessment),
  };
}
