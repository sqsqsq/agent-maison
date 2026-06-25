/**
 * Phase transition policy — manual default + batch_authorized heuristics + goal_mode helpers.
 * SSOT for user-confirmation-ux.md §8.2; consumed by goal-runner and lint/tests.
 */

import type { WorkflowSpec } from '../../workflow-loader';
import { listWorkflowPhases } from '../../workflow-loader';

export type TransitionPolicy = 'manual' | 'batch_authorized' | 'goal_mode';

export type FeaturePhase = 'spec' | 'plan' | 'coding' | 'review' | 'ut' | 'testing';

export type HarnessVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

export type PhaseVerdictAction =
  | 'advance'
  | 'retry'
  | 'halt'
  | 'defer_external_and_continue_if_allowed'
  | 'defer_external_and_halt';

export type GoalRunStatus = 'COMPLETED' | 'PARTIAL' | 'DEFERRED' | 'HALTED';

export const DEFAULT_TRANSITION_POLICY: TransitionPolicy = 'manual';

/** Ordered feature phases for batch range parsing. */
export const FEATURE_PHASE_ORDER: readonly FeaturePhase[] = [
  'spec', 'plan',
  'coding',
  'review',
  'ut',
  'testing',
] as const;

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

export interface ClassifyPhaseVerdictInput {
  verdict: HarnessVerdict;
  blocking_class?: string;
  failure_kind?: string;
  dependency_policy?: DependencyPolicy;
  retries_used?: number;
  max_retries_per_phase?: number;
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

function asFeaturePhase(phase: string): FeaturePhase | undefined {
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
): void {
  const startIdx = FEATURE_PHASE_ORDER.indexOf(startPhase);
  for (let i = 0; i < chain.length; i++) {
    const phase = chain[i];
    const artifact = workflow.artifacts.find((a) => a.id === phase);
    if (!artifact) continue;
    for (const req of artifact.requires) {
      if (!FEATURE_PHASE_SET.has(req)) continue;
      const reqPhase = req as FeaturePhase;
      const reqOrderIdx = FEATURE_PHASE_ORDER.indexOf(reqPhase);
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

function featurePhasesFromWorkflow(spec: WorkflowSpec): FeaturePhase[] {
  const ordered = listWorkflowPhases(spec);
  const out: FeaturePhase[] = [];
  for (const id of ordered) {
    const a = spec.artifacts.find((x) => x.id === id);
    if (a?.scope === 'feature' && FEATURE_PHASE_SET.has(id)) {
      out.push(id as FeaturePhase);
    }
  }
  return out;
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
): FeaturePhase[] {
  const start = asFeaturePhase(startPhase) ?? (FEATURE_PHASE_SET.has(startPhase) ? (startPhase as FeaturePhase) : undefined);
  const end = asFeaturePhase(endPhase) ?? (FEATURE_PHASE_SET.has(endPhase) ? (endPhase as FeaturePhase) : undefined);
  if (!start || !end) {
    throw new Error(`[resolveAutoChain] 非法 phase: start=${startPhase} end=${endPhase}`);
  }
  const startIdx = FEATURE_PHASE_ORDER.indexOf(start);
  const endIdx = FEATURE_PHASE_ORDER.indexOf(end);
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
      const fp = asFeaturePhase(p);
      if (fp && !base.includes(fp)) base.push(fp);
    }
  } else if (workflow.auto_chain && workflow.auto_chain.length > 0) {
    base = [];
    for (const p of workflow.auto_chain) {
      const fp = asFeaturePhase(p);
      if (fp && !base.includes(fp)) base.push(fp);
    }
  } else {
    base = featurePhasesFromWorkflow(workflow);
  }

  const filtered = base.filter((p) => {
    const idx = FEATURE_PHASE_ORDER.indexOf(p);
    return idx >= startIdx && idx <= endIdx;
  });

  if (filtered.length === 0) {
    throw new Error('[resolveAutoChain] 解析结果为空');
  }
  validateFeatureChainDag(workflow, filtered, start);
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
export function classifyPhaseVerdict(input: ClassifyPhaseVerdictInput): PhaseVerdictAction {
  const {
    verdict,
    blocking_class,
    failure_kind,
    dependency_policy = DEFAULT_DEPENDENCY_POLICY,
    retries_used = 0,
    max_retries_per_phase = 2,
  } = input;

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

/**
 * Compute final goal run status from per-phase outcomes.
 * COMPLETED only when no DEFERRED and not halted early.
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
): GoalRunStatus {
  const anyHalted = phases.some((p) => p.halted);
  if (anyHalted) return 'HALTED';
  const anyUnclosedTimeout = phases.some((p) => p.agent_timed_out && p.advance_blocked);
  if (anyUnclosedTimeout && reachedEnd) return 'PARTIAL';
  const anyDeferred = phases.some((p) => p.deferred);
  if (anyDeferred) return reachedEnd ? 'DEFERRED' : 'PARTIAL';
  return reachedEnd ? 'COMPLETED' : 'PARTIAL';
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

/** Next phase skill label for phase.next_step portable menu. */
export function nextSkillLabelForPhase(phase: FeaturePhase): string {
  switch (phase) {
    case 'spec':
      return 'plan 技术设计';
    case 'plan':
      return 'coding 编码';
    case 'coding':
      return 'code-review Code Review';
    case 'review':
      return 'business-ut 业务级 UT';
    case 'ut':
      return 'device-testing 真机测试';
    case 'testing':
      return '结束交付 / 归档';
    default:
      return '下一阶段 skill';
  }
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
