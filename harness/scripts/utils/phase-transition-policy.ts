/**
 * Phase transition policy — manual default + batch_authorized heuristics.
 * SSOT for user-confirmation-ux.md §8.2; consumed by lint/tests (not runtime harness yet).
 */

export type TransitionPolicy = 'manual' | 'batch_authorized' | 'goal_mode';

export type FeaturePhase = 'prd' | 'design' | 'coding' | 'review' | 'ut' | 'testing';

export const DEFAULT_TRANSITION_POLICY: TransitionPolicy = 'manual';

/** Ordered feature phases for batch range parsing. */
export const FEATURE_PHASE_ORDER: readonly FeaturePhase[] = [
  'prd',
  'design',
  'coding',
  'review',
  'ut',
  'testing',
] as const;

export interface BatchAuthorizationResult {
  policy: TransitionPolicy;
  /** Inclusive end phase when batch_authorized; undefined when manual. */
  throughPhase?: FeaturePhase;
  /** Matched phrase for diagnostics. */
  matchedPhrase?: string;
}

const PHASE_ALIASES: Record<string, FeaturePhase> = {
  prd: 'prd',
  design: 'design',
  设计: 'design',
  coding: 'coding',
  编码: 'coding',
  review: 'review',
  cr: 'review',
  审查: 'review',
  ut: 'ut',
  testing: 'testing',
  真机: 'testing',
};

/** Heuristic batch phrases → throughPhase (inclusive). */
const BATCH_PHRASES: Array<{ pattern: RegExp; through: FeaturePhase }> = [
  { pattern: /全链路|端到端交付|从\s*prd\s*到\s*真机|pr\s*d\s*到\s*真机/i, through: 'testing' },
  { pattern: /prd\s*到\s*ut|到\s*ut\s*为止|做到\s*ut/i, through: 'ut' },
  { pattern: /做到\s*review|做到\s*cr|coding\s*并\s*review|编码\s*并\s*审查|到\s*review\s*为止/i, through: 'review' },
  { pattern: /做到\s*design|到\s*设计\s*为止|prd\s*到\s*design/i, through: 'design' },
  { pattern: /做到\s*testing|到\s*真机|真机测试\s*闭环/i, through: 'testing' },
];

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
    case 'prd':
      return 'requirement-design 技术设计';
    case 'design':
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
