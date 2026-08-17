import type {
  AssessRecommendation,
  AssessResult,
  ReconcileObservationV1,
} from './assess';
import type { PhaseVerdictAction } from './phase-transition-policy';

export type DriverGuardAction = PhaseVerdictAction | 'none';

export interface SelectRunnerActionInput {
  assessment: AssessResult;
  observation: ReconcileObservationV1;
  currentPhase: string;
  chain: string[];
  /**
   * Process/safety result produced by the existing runner guards. Only terminal
   * and policy-owned defer results are authoritative here; retry/advance/
   * backtrack do not select cross-phase work.
   */
  driverGuardAction: DriverGuardAction;
}

function targetRelation(
  recommendation: AssessRecommendation,
  currentPhase: string,
  chain: string[],
): 'same' | 'earlier' | 'later' | 'none' | 'invalid' {
  if (!recommendation.phase) return 'none';
  const current = chain.indexOf(currentPhase);
  const target = chain.indexOf(recommendation.phase);
  if (current < 0 || target < 0) return 'invalid';
  if (target === current) return 'same';
  return target < current ? 'earlier' : 'later';
}

/**
 * The only runner boundary that converts assess@1's cross-phase recommendation
 * into the legacy execution action vocabulary.
 */
export function selectRunnerActionFromAssess(
  input: SelectRunnerActionInput,
): PhaseVerdictAction {
  const guard = input.driverGuardAction;
  if (guard === 'halt') return 'halt';
  if (
    guard === 'defer_external_and_continue_if_allowed' ||
    guard === 'defer_external_and_halt'
  ) {
    return guard;
  }
  if (guard === 'retry' && (
    input.observation.phase_outcome?.verdict === 'PASS' ||
    input.observation.signals?.timed_out === true ||
    input.observation.signals?.api_disconnected === true
  )) {
    // Closure and process-safety retries remain driver-owned. Content retries
    // are selected by assess through classifyPhaseVerdict.
    return 'retry';
  }

  const recommendation = input.assessment.recommendation;
  if (recommendation.action === 'stop' || input.assessment.stop.fused) return 'halt';
  if (recommendation.action === 'resolve_deferred') {
    // The phase-transition SSOT already selected whether downstream propagation
    // is allowed. Preserve that exact action; the driver adds no content policy.
    if (
      recommendation.runner_action === 'defer_external_and_continue_if_allowed' ||
      recommendation.runner_action === 'defer_external_and_halt'
    ) {
      return recommendation.runner_action;
    }
    return 'halt';
  }
  if (recommendation.action === 'validate_feature_completion') return 'advance';

  const relation = targetRelation(recommendation, input.currentPhase, input.chain);
  // 责任阶段统一路由（plan b6e4c9f2）：**唯一**回退动作是 backtrack_to_phase——目标缺席
  // （phase:null 或不在链内）时保留回退意图，由 runner 落既有 backtrack_target_absent。
  // 旧的 deterministic_defects → backtrack_to_coding fallback 已删除（缺陷路由不得有
  // 第二条路；源码漂移等其它恢复机制仍可使用 backtrack_to_coding 动作，与本路由无关）。
  if ((relation === 'invalid' || relation === 'none') && recommendation.runner_action === 'backtrack_to_phase') {
    return 'backtrack_to_phase';
  }
  if (relation === 'same') return 'retry';
  if (relation === 'later') return 'advance';
  if (relation === 'earlier') {
    const target = recommendation.phase;
    // 可信=assess 已从 phase summary（唯一真源）判出候选并给出 backtrack_to_phase 意图，
    // 且失效面覆盖目标（不再硬编码只允许 coding）。
    if (
      recommendation.runner_action === 'backtrack_to_phase' &&
      target !== null &&
      input.observation.invalidatable_phases?.includes(target)
    ) {
      return 'backtrack_to_phase';
    }
    return 'halt';
  }
  return 'halt';
}

/** Static regression guard: runner must retain one explicit assess boundary. */
export function checkAssessDrivenRunnerSource(source: string): string[] {
  const errors: string[] = [];
  const boundaries = source.match(/\.decideAndEmit\s*\(/g) ?? [];
  if (boundaries.length !== 1) {
    errors.push(`expected one goal reconcile decision boundary, found ${boundaries.length}`);
  }
  if (source.includes('preserveLegacyAction')) {
    errors.push('legacy action passthrough must not remain in goal-runner');
  }
  if (/classifyPhaseVerdict\s*\(/.test(source)) {
    errors.push('goal-runner must not classify content verdicts before assess');
  }
  if (/action\s*=\s*['"]backtrack_to_coding['"]/.test(source)) {
    errors.push('inline backtrack selection regrew outside assess boundary');
  }
  if (!source.includes('const driverActionableDefects = envBlocked ? [] : actionableDefects')) {
    errors.push('envBlocked defects must be filtered before assess input');
  }
  if (source.includes('deterministicDefects: actionableDefects.map')) {
    errors.push('unfiltered actionable defects reached reconcile observation');
  }
  return errors;
}
