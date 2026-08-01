/**
 * Phase transition policy — manual default + batch_authorized heuristics + goal_mode helpers.
 * SSOT for user-confirmation-ux.md §8.2; consumed by goal-runner and lint/tests.
 */

import type { WorkflowSpec } from '../../workflow-loader';
import {
  LEGACY_FEATURE_PHASE_ORDER,
  effectiveRequires,
  isWorkflowFeaturePhase,
  workflowFeaturePhases,
  type FeatureTrack,
} from './runtime-policy';

export type TransitionPolicy = 'manual' | 'batch_authorized' | 'goal_mode';

/** Feature phase id（由 workflow 定义；不再限定 canonical 枚举——C0 runtime-policy-core 收编）。 */
export type FeaturePhase = string;

export type HarnessVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

export type PhaseVerdictAction =
  | 'advance'
  | 'retry'
  | 'halt'
  /**
   * plan d8c5f3a7 T4：带缺陷指纹回退 coding 修复（扩展既有 authorized_backtrack 语义，
   * 不新造机制）。2026-07-24 事故暴露的结构性缺口：转移策略只有「同阶段 retry ≤2 → halt」，
   * **不存在 testing FAIL → 回 coding → 再 testing 的环**；既有回退通道
   * （reconcileMutablePhaseSourceDrift）门槛又高到全程未触发。于是"真机发现问题→回码修复"
   * 这个用户最期待的循环从来没跑起来过。
   *
   * 触发与 strictness **解耦**（设计原则）：确定性 P0 缺陷（crash 嫌疑 / needs_fix 素材债 /
   * score_floor 崩塌 / 声明锚点缺失）即触发回修；`isHardPixelContract` 只决定这些缺口
   * 是否额外升 BLOCKER/求人，**不决定是否回修**——否则 best_effort 档（银行卡真实档位）
   * 永远只记 WARN 不修。
   */
  | 'backtrack_to_coding'
  | 'defer_external_and_continue_if_allowed'
  | 'defer_external_and_halt';

/**
 * goal-fakepass-hardening t8（openspec goal-runner delta）：非最终成功状态不得含裸
 * COMPLETED 语义——run 级成功=CHAIN_SLICE_COMPLETED（只证明本 run 的链切片，feature 级
 * 完成只认 verify-feature-completion=VALID）；存在待人工事项（pending must-review/
 * waiver/档位钳制）→ AWAITING_HUMAN_REVIEW 封顶。'COMPLETED' 仅为 legacy 事件读取兼容
 * （旧 run 的 events.jsonl），新代码不得写出。INTERRUPTED 由 goal-mode-unattended-survival
 * 管辖（异常退出终态，正交共存）。
 */
export type GoalRunStatus =
  | 'CHAIN_SLICE_COMPLETED'
  | 'AWAITING_HUMAN_REVIEW'
  | 'DEFERRED_CAPABILITY_MISSING'
  | 'PARTIAL'
  | 'DEFERRED'
  | 'HALTED'
  | 'COMPLETED';

export const DEFAULT_TRANSITION_POLICY: TransitionPolicy = 'manual';

/** 无 workflow 上下文时的顺序回退（SSOT = runtime-policy）；有 workflow 处一律用派生序。 */
export const FEATURE_PHASE_ORDER: readonly FeaturePhase[] = LEGACY_FEATURE_PHASE_ORDER;

const FEATURE_PHASE_SET = new Set<string>(FEATURE_PHASE_ORDER);

export interface DependencyPolicy {
  deferrable_blocking_classes?: string[];
  deferrable_failure_kinds?: string[];
  propagate_to_downstream?: boolean;
}

export const DEFAULT_DEPENDENCY_POLICY: DependencyPolicy = {
  deferrable_blocking_classes: ['externalBlocked'],
  deferrable_failure_kinds: ['device_blocked'],
  propagate_to_downstream: true,
};

export type AssessmentGapKind =
  | 'missing'
  | 'failed'
  | 'deferred'
  | 'stale'
  | 'unclosed'
  | 'legacy_unverified'
  | 'insufficient_depth'
  | 'deterministic_defects';

export type AssessmentRecommendationAction =
  | 'run_phase'
  | 'rerun_phase'
  | 'complete_closure'
  | 'resolve_deferred'
  | 'restore_inputs_and_rerun'
  | 'validate_feature_completion'
  | 'stop';

export interface ClassifyAssessmentGapInput {
  assessment_gap: AssessmentGapKind | null;
  fused?: boolean;
  target_state?: 'missing' | 'current';
}

export interface ClassifyPhaseVerdictInput {
  verdict: HarnessVerdict;
  blocking_class?: string;
  failure_kind?: string;
  dependency_policy?: DependencyPolicy;
  retries_used?: number;
  max_retries_per_phase?: number;
  /** 当前阶段（backtrack 只对 review 闭环后的可变阶段 ut/testing 有意义） */
  phase?: FeaturePhase;
  /**
   * plan d8c5f3a7 T4：本轮是否检出**确定性 P0 缺陷**且当前阶段无法零写入解决
   * （crash 嫌疑 / needs_fix 素材债 / score_floor 崩塌 / 声明锚点缺失）。
   * 由 runner 从 summary 的结构化缺陷指纹派生——**不看 strictness**。
   */
  deterministic_p0_defects?: boolean;
  /** 已用回退次数（预算 max_backtracks，默认 2；配合轮次指纹熔断防 ping-pong） */
  backtracks_used?: number;
  max_backtracks?: number;
}

export interface BatchAuthorizationResult {
  policy: TransitionPolicy;
  /** Inclusive end phase when batch_authorized; undefined when manual. */
  throughPhase?: FeaturePhase;
  /** Matched phrase for diagnostics. */
  matchedPhrase?: string;
}

const PHASE_ALIASES: Record<string, FeaturePhase> = {
  prd: 'spec',
  design: 'plan',
  设计: 'plan',
  coding: 'coding',
  编码: 'coding',
  review: 'review',
  cr: 'review',
  审查: 'review',
  ut: 'ut',
  testing: 'testing',
  真机: 'testing',
};

/** Goal mode NL triggers (goal_mode takes priority over batch_authorized). */
const GOAL_MODE_PHRASES: RegExp[] = [/目标模式/, /全自动/];

export interface GoalModeAuthorizationResult {
  policy: TransitionPolicy;
  matchedPhrase?: string;
}

/** Heuristic batch phrases → throughPhase (inclusive). */
const BATCH_PHRASES: Array<{ pattern: RegExp; through: FeaturePhase }> = [
  { pattern: /全链路|端到端交付|从\s*prd\s*到\s*真机|pr\s*d\s*到\s*真机/i, through: 'testing' },
  { pattern: /prd\s*到\s*ut|到\s*ut\s*为止|做到\s*ut/i, through: 'ut' },
  { pattern: /做到\s*review|做到\s*cr|coding\s*并\s*review|编码\s*并\s*审查|到\s*review\s*为止/i, through: 'review' },
  { pattern: /做到\s*design|到\s*设计\s*为止|prd\s*到\s*design/i, through: 'plan' },
  { pattern: /做到\s*testing|到\s*真机|真机测试\s*闭环/i, through: 'testing' },
];

function asFeaturePhase(phase: string, workflow?: WorkflowSpec): FeaturePhase | undefined {
  if (workflow && isWorkflowFeaturePhase(workflow, phase)) return phase;
  if (FEATURE_PHASE_SET.has(phase)) return phase as FeaturePhase;
  return PHASE_ALIASES[phase];
}

/**
 * Validate feature-phase chain respects workflow DAG requires.
 * Feature phases before startPhase are assumed satisfied (mid-chain entry).
 */
export function validateFeatureChainDag(
  workflow: WorkflowSpec,
  chain: FeaturePhase[],
  startPhase: FeaturePhase,
  track: FeatureTrack = 'full',
): void {
  const order = featurePhasesFromWorkflow(workflow, track);
  const startIdx = order.indexOf(startPhase);
  for (let i = 0; i < chain.length; i++) {
    const phase = chain[i];
    const artifact = workflow.artifacts.find((a) => a.id === phase);
    if (!artifact) continue;
    for (const req of effectiveRequires(workflow, artifact, track)) {
      if (!isWorkflowFeaturePhase(workflow, req)) continue;
      const reqPhase = req as FeaturePhase;
      const reqOrderIdx = order.indexOf(reqPhase);
      if (reqOrderIdx >= 0 && reqOrderIdx < startIdx) continue;
      const reqIdx = chain.indexOf(reqPhase);
      if (reqIdx < 0) {
        throw new Error(
          `[resolveAutoChain] phase "${phase}" requires feature phase "${req}" but it is missing from chain`,
        );
      }
      if (reqIdx >= i) {
        throw new Error(
          `[resolveAutoChain] phase "${phase}" requires "${req}" to precede it in chain`,
        );
      }
    }
  }
}

// export（goal-fakepass-hardening t8）：goal-runner 截断链核验/completion 需要完整链。
export function featurePhasesFromWorkflow(spec: WorkflowSpec, track: FeatureTrack = 'full'): FeaturePhase[] {
  // workflow feature-scope 集（按 track 过滤，拓扑序）；新 phase 一等公民（C0/C1 收编）。
  return workflowFeaturePhases(spec, track);
}

/**
 * Resolve ordered feature phase chain between start and end (inclusive).
 * Uses workflow.auto_chain when set; otherwise derives from DAG topological order.
 */
export function resolveAutoChain(
  workflow: WorkflowSpec,
  startPhase: FeaturePhase | string,
  endPhase: FeaturePhase | string,
  overrideChain?: readonly string[],
  track: FeatureTrack = 'full',
): FeaturePhase[] {
  const start = asFeaturePhase(startPhase, workflow);
  const end = asFeaturePhase(endPhase, workflow);
  if (!start || !end) {
    throw new Error(`[resolveAutoChain] 非法 phase: start=${startPhase} end=${endPhase}`);
  }
  const order = featurePhasesFromWorkflow(workflow, track);
  const startIdx = order.indexOf(start);
  const endIdx = order.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`[resolveAutoChain] 非法 phase: start=${start} end=${end}`);
  }
  if (startIdx > endIdx) {
    throw new Error(`[resolveAutoChain] start (${start}) 不能晚于 end (${end})`);
  }

  let base: FeaturePhase[];
  if (overrideChain && overrideChain.length > 0) {
    base = [];
    for (const p of overrideChain) {
      const fp = asFeaturePhase(p, workflow);
      if (fp && !base.includes(fp)) base.push(fp);
    }
  } else {
    // 分轨显式链优先（C1：lite 用 auto_chain_by_track，不做隐式推导）
    const declaredChain =
      track === 'full' ? workflow.auto_chain : workflow.auto_chain_by_track?.[track];
    if (declaredChain && declaredChain.length > 0) {
      base = [];
      for (const p of declaredChain) {
        const fp = asFeaturePhase(p, workflow);
        if (fp && !base.includes(fp)) base.push(fp);
      }
    } else {
      base = featurePhasesFromWorkflow(workflow, track);
    }
  }

  const filtered = base.filter((p) => {
    const idx = order.indexOf(p);
    return idx >= startIdx && idx <= endIdx;
  });

  if (filtered.length === 0) {
    throw new Error('[resolveAutoChain] 解析结果为空');
  }
  validateFeatureChainDag(workflow, filtered, start, track);
  return filtered;
}

export function isDeferrableExternalBlock(
  blocking_class?: string,
  failure_kind?: string,
  policy: DependencyPolicy = DEFAULT_DEPENDENCY_POLICY,
): boolean {
  const classes = policy.deferrable_blocking_classes ?? DEFAULT_DEPENDENCY_POLICY.deferrable_blocking_classes!;
  const kinds = policy.deferrable_failure_kinds ?? DEFAULT_DEPENDENCY_POLICY.deferrable_failure_kinds!;
  if (blocking_class && classes.includes(blocking_class)) return true;
  if (failure_kind && kinds.includes(failure_kind)) return true;
  return false;
}

/**
 * Classify harness verdict into runner action. SSOT for goal-runner.
 */
export function classifyPhaseVerdict(input: ClassifyAssessmentGapInput): AssessmentRecommendationAction;
export function classifyPhaseVerdict(input: ClassifyPhaseVerdictInput): PhaseVerdictAction;
export function classifyPhaseVerdict(
  input: ClassifyAssessmentGapInput | ClassifyPhaseVerdictInput,
): AssessmentRecommendationAction | PhaseVerdictAction {
  if ('assessment_gap' in input) {
    if (input.fused) return 'stop';
    switch (input.assessment_gap) {
      case null:
        return 'validate_feature_completion';
      case 'missing':
        return 'run_phase';
      case 'unclosed':
        return 'complete_closure';
      case 'deferred':
        return 'resolve_deferred';
      case 'insufficient_depth':
        return 'restore_inputs_and_rerun';
      case 'deterministic_defects':
        return input.target_state === 'missing' ? 'run_phase' : 'rerun_phase';
      case 'failed':
      case 'stale':
      case 'legacy_unverified':
        return 'rerun_phase';
      default: {
        const exhaustive: never = input.assessment_gap;
        throw new Error(`[phase-transition-policy] unsupported assessment gap: ${exhaustive}`);
      }
    }
  }

  const {
    verdict,
    blocking_class,
    failure_kind,
    dependency_policy = DEFAULT_DEPENDENCY_POLICY,
    retries_used = 0,
    max_retries_per_phase = 2,
  } = input;

  // v23 F1：actionable 缺陷判据在 **PASS 判定之前**——这是回修环可达性的关键。
  // 旧顺序 `PASS 先行 return` 是第 6 轮 review 实锤的致命错误：best_effort（银行卡真实
  // 档位）下视觉缺陷表现为 WARN、verdict=PASS → 回修环从未可达。actionable 缺陷非空
  // 即回退，与 verdict 无关。只在 testing（UT 不读视觉产物；runner 侧同样只在 testing
  // 收集）。优先级序：安全 halt（在 runner 层先行 continue，根本到不了这里）→
  // actionable 回退（此处）→ 普通 PASS/FAIL。
  // 预算/指纹/回退目标的裁决**全部收归 runner 的统一回退分支**——policy 里不看预算。
  // review 第 10 轮实锤：旧写法预算耗尽后 PASS+actionable 掉到 advance、FAIL+actionable
  // 掉到 retry——残留缺陷被当成通过推进/原地空转，与"耗尽即 halt"相反。恒返回
  // backtrack_to_coding，runner 分支判 target/fingerprint/budget 并在那里 halt。
  if (input.deterministic_p0_defects === true && input.phase === 'testing') {
    return 'backtrack_to_coding';
  }

  if (verdict === 'PASS') return 'advance';

  if (verdict === 'INCOMPLETE') {
    if (isDeferrableExternalBlock(blocking_class, failure_kind, dependency_policy)) {
      if (dependency_policy.propagate_to_downstream === false) {
        return 'defer_external_and_halt';
      }
      return 'defer_external_and_continue_if_allowed';
    }
    return 'halt';
  }

  if (retries_used < max_retries_per_phase) return 'retry';
  return 'halt';
}

export interface PhaseAssessmentDecision {
  action: AssessmentRecommendationAction | null;
  target: 'current' | 'coding' | null;
  runner_action: PhaseVerdictAction;
}

/**
 * Translate the verdict SSOT into assess vocabulary. The mapping lives beside
 * classifyPhaseVerdict so assess and every driver consume one decision table.
 * `action=null` means normal workflow-gap reconciliation decides the next node.
 */
export function classifyPhaseAssessment(
  input: ClassifyPhaseVerdictInput,
): PhaseAssessmentDecision {
  const runnerAction = classifyPhaseVerdict(input);
  switch (runnerAction) {
    case 'advance':
      return { action: null, target: null, runner_action: runnerAction };
    case 'retry':
      return { action: 'rerun_phase', target: 'current', runner_action: runnerAction };
    case 'halt':
      return { action: 'stop', target: null, runner_action: runnerAction };
    case 'backtrack_to_coding':
      return { action: 'rerun_phase', target: 'coding', runner_action: runnerAction };
    case 'defer_external_and_continue_if_allowed':
    case 'defer_external_and_halt':
      return { action: 'resolve_deferred', target: 'current', runner_action: runnerAction };
    default: {
      const exhaustive: never = runnerAction;
      throw new Error(`[phase-transition-policy] unsupported runner action: ${exhaustive}`);
    }
  }
}
/** 回退预算缺省值（plan d8c5f3a7 T4；与轮次指纹熔断共同防 ping-pong） */
export const DEFAULT_MAX_BACKTRACKS = 2;

/**
 * Compute final goal run status from per-phase outcomes.
 * 成功终态=CHAIN_SLICE_COMPLETED（仅链切片语义）；opts.pendingHumanReview（待复核决议/
 * waiver/档位钳制）把否则成功的 run 封顶为 AWAITING_HUMAN_REVIEW——不再产出裸 COMPLETED。
 */
export function resolveGoalRunStatus(
  phases: Array<{
    phase: FeaturePhase;
    deferred?: boolean;
    halted?: boolean;
    agent_timed_out?: boolean;
    advance_blocked?: boolean;
  }>,
  reachedEnd: boolean,
  opts?: { pendingHumanReview?: boolean; blockingFix?: boolean },
): GoalRunStatus {
  const anyHalted = phases.some((p) => p.halted);
  if (anyHalted) return 'HALTED';
  const anyUnclosedTimeout = phases.some((p) => p.agent_timed_out && p.advance_blocked);
  if (anyUnclosedTimeout && reachedEnd) return 'PARTIAL';
  const anyDeferred = phases.some((p) => p.deferred);
  if (anyDeferred) return reachedEnd ? 'DEFERRED' : 'PARTIAL';
  if (!reachedEnd) return 'PARTIAL';
  // codex 八轮 P1-2：needs_fix（血缘 stale/tampered/verdict FAIL/attestation 失配）非人工
  // 确认事项，但同样不得 CHAIN_SLICE_COMPLETED（那声称链切片干净）——投 PARTIAL（修复重跑）。
  if (opts?.blockingFix) return 'PARTIAL';
  return opts?.pendingHumanReview ? 'AWAITING_HUMAN_REVIEW' : 'CHAIN_SLICE_COMPLETED';
}

/**
 * Parse user message for goal_mode authorization (目标模式 / 全自动).
 * Does not match batch-only phrases like「全链路」without goal keywords.
 */
export function parseGoalModeAuthorization(message: string): GoalModeAuthorizationResult {
  const text = message.trim();
  if (!text) {
    return { policy: DEFAULT_TRANSITION_POLICY };
  }
  for (const pattern of GOAL_MODE_PHRASES) {
    if (pattern.test(text)) {
      return { policy: 'goal_mode', matchedPhrase: pattern.source };
    }
  }
  return { policy: DEFAULT_TRANSITION_POLICY };
}

/**
 * Resolve transition policy: goal_mode first, then batch_authorized, else manual.
 */
export function resolveTransitionPolicy(message: string): TransitionPolicy {
  const goal = parseGoalModeAuthorization(message);
  if (goal.policy === 'goal_mode') return 'goal_mode';
  const batch = parseBatchAuthorization(message);
  if (batch.policy === 'batch_authorized') return 'batch_authorized';
  return DEFAULT_TRANSITION_POLICY;
}

/**
 * Parse user message for batch multi-phase authorization.
 * Default: manual (no auto chain).
 */
export function parseBatchAuthorization(message: string): BatchAuthorizationResult {
  const text = message.trim();
  if (!text) {
    return { policy: DEFAULT_TRANSITION_POLICY };
  }

  for (const { pattern, through } of BATCH_PHRASES) {
    if (pattern.test(text)) {
      return {
        policy: 'batch_authorized',
        throughPhase: through,
        matchedPhrase: pattern.source,
      };
    }
  }

  return { policy: DEFAULT_TRANSITION_POLICY };
}

/**
 * Whether transitioning from `fromPhase` to `toPhase` is allowed under batch auth ending at `throughPhase`.
 */
export function isPhaseWithinBatchRange(
  fromPhase: FeaturePhase,
  toPhase: FeaturePhase,
  throughPhase: FeaturePhase,
): boolean {
  const fromIdx = FEATURE_PHASE_ORDER.indexOf(fromPhase);
  const toIdx = FEATURE_PHASE_ORDER.indexOf(toPhase);
  const throughIdx = FEATURE_PHASE_ORDER.indexOf(throughPhase);
  if (fromIdx < 0 || toIdx < 0 || throughIdx < 0) return false;
  return toIdx === fromIdx + 1 && toIdx <= throughIdx;
}

/**
 * Workflow-derived compatibility label for phase.next_step renderers.
 * Cross-phase qualification itself comes from assess@1; this helper only
 * names the next workflow node and never authorizes execution.
 */
export function nextSkillLabelForPhase(
  workflow: WorkflowSpec,
  phase: FeaturePhase,
  track: FeatureTrack = 'full',
): string {
  const ordered = featurePhasesFromWorkflow(workflow, track);
  const last = ordered[ordered.length - 1];
  const chain = resolveAutoChain(workflow, ordered[0], last, undefined, track);
  const index = chain.indexOf(phase);
  if (index < 0) return 'assess recommendation';
  const next = chain[index + 1];
  return next ?? 'feature completion validation';
}

/** Dedicated ok_to_* registry id for phase closure (if any). */
export function dedicatedOkToRegistryId(phase: FeaturePhase): string | undefined {
  switch (phase) {
    case 'coding':
      return 'coding.ok_to_review';
    case 'review':
      return 'review.ok_to_ut';
    case 'ut':
      return 'ut.ok_to_testing';
    default:
      return undefined;
  }
}

/** Build upstream DEFERRED notice for downstream phase prompts. */
export function formatDeferredUpstreamNotice(
  deferred: Array<{ phase: FeaturePhase; reason: string }>,
): string {
  if (deferred.length === 0) return '';
  const lines = deferred.map((d) => `- ${d.phase}: ${d.reason}`);
  return [
    '## Upstream DEFERRED phases (未完成·待外部条件)',
    '以下上游阶段因外部阻塞未闭环，下游须知晓依赖未真正满足：',
    ...lines,
    '',
  ].join('\n');
}
