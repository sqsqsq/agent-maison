// ============================================================================
// exploration-strategy — default-on + trivial exemption + composite scoring
// ============================================================================

import * as YAML from 'yaml';
import type {
  ExplorationChangeSignals,
  ExplorationComplexityLevel,
  ExplorationModeDecision,
  ExplorationScoringConfig,
  ExplorationStrategy,
  ExplorationThresholds,
  PhaseRuleSpec,
  ScoringDimension,
  ScoringTier,
} from './types';
import { parseScope } from './scope-parser';
import { SpecLoader } from './spec-loader';
import { computeMaxDependencyFanOut, computeMaxInScopeModuleLoc } from './fan-out-scanner';

export type ContextExplorationPhase = 'prd' | 'design' | 'coding' | 'review' | 'ut';

/** frontmatter 子集（避免与 context-exploration 循环依赖） */
export interface ExplorationFrontmatterInput {
  change_intent?: unknown;
  estimated_loc_delta?: unknown;
  touches_layers?: unknown;
  adds_new_exports?: unknown;
  single_function_scope?: unknown;
  exploration_mode?: unknown;
}

const TRIVIAL_INTENTS = new Set([
  'rename',
  'extract_function',
  'move_file',
  'typo_fix',
  'docs',
  'config',
]);

export const DEFAULT_EXPLORATION_STRATEGY: Partial<
  Record<ContextExplorationPhase, ExplorationStrategy>
> = {
  design: {
    default_mode: 'subagent',
    trivial_exemption: {
      enabled: true,
      conditions_any: [
        { intent: ['rename', 'extract_function', 'move_file', 'typo_fix'] },
        { prd_loc_delta_lt: 30 },
        { single_function_scope: true },
      ],
    },
    sequential_multiplier: 2.0,
    sequential_min_files_inspected_add: 5,
  },
  coding: {
    default_mode: 'subagent',
    trivial_exemption: {
      enabled: true,
      conditions_any: [
        { intent: ['rename', 'extract_function', 'move_file', 'typo_fix'] },
        { prd_loc_delta_lt: 30 },
        { single_function_scope: true },
      ],
    },
    sequential_multiplier: 2.0,
    sequential_min_files_inspected_add: 5,
  },
  prd: {
    default_mode: 'sequential',
    scoring: {
      threshold: 60,
      dimensions: [
        {
          id: 'module_loc',
          weight: 25,
          tiers: [
            { gte: 50000, score: 25 },
            { gte: 20000, score: 15 },
            { gte: 5000, score: 8 },
          ],
        },
        {
          id: 'scope_breadth',
          weight: 20,
          tiers: [
            { gte: 3, score: 20 },
            { gte: 2, score: 12 },
            { gte: 1, score: 5 },
          ],
        },
        {
          id: 'cross_layer',
          weight: 20,
          signal: 'touches_multiple_outer_layers',
          score_if_true: 20,
        },
        {
          id: 'new_api_surface',
          weight: 15,
          signal: 'adds_exports_or_public_api',
          score_if_true: 15,
        },
        {
          id: 'dependency_fan_out',
          weight: 20,
          tiers: [
            { gte: 10, score: 20 },
            { gte: 5, score: 12 },
            { gte: 2, score: 5 },
          ],
        },
      ],
    },
    sequential_multiplier: 2.0,
    sequential_min_files_inspected_add: 5,
  },
  review: {
    default_mode: 'sequential',
    scoring: {
      threshold: 60,
      dimensions: [
        {
          id: 'module_loc',
          weight: 25,
          tiers: [
            { gte: 50000, score: 25 },
            { gte: 20000, score: 15 },
            { gte: 5000, score: 8 },
          ],
        },
        {
          id: 'scope_breadth',
          weight: 20,
          tiers: [
            { gte: 3, score: 20 },
            { gte: 2, score: 12 },
            { gte: 1, score: 5 },
          ],
        },
        {
          id: 'cross_layer',
          weight: 20,
          signal: 'touches_multiple_outer_layers',
          score_if_true: 20,
        },
        {
          id: 'new_api_surface',
          weight: 15,
          signal: 'adds_exports_or_public_api',
          score_if_true: 15,
        },
        {
          id: 'dependency_fan_out',
          weight: 20,
          tiers: [
            { gte: 10, score: 20 },
            { gte: 5, score: 12 },
            { gte: 2, score: 5 },
          ],
        },
      ],
    },
    sequential_multiplier: 2.0,
    sequential_min_files_inspected_add: 5,
  },
  ut: {
    default_mode: 'sequential',
    scoring: {
      threshold: 60,
      dimensions: [
        {
          id: 'module_loc',
          weight: 25,
          tiers: [
            { gte: 50000, score: 25 },
            { gte: 20000, score: 15 },
            { gte: 5000, score: 8 },
          ],
        },
        {
          id: 'scope_breadth',
          weight: 20,
          tiers: [
            { gte: 3, score: 20 },
            { gte: 2, score: 12 },
            { gte: 1, score: 5 },
          ],
        },
        {
          id: 'cross_layer',
          weight: 20,
          signal: 'touches_multiple_outer_layers',
          score_if_true: 20,
        },
        {
          id: 'new_api_surface',
          weight: 15,
          signal: 'adds_exports_or_public_api',
          score_if_true: 15,
        },
        {
          id: 'dependency_fan_out',
          weight: 20,
          tiers: [
            { gte: 10, score: 20 },
            { gte: 5, score: 12 },
            { gte: 2, score: 5 },
          ],
        },
      ],
    },
    sequential_multiplier: 2.0,
    sequential_min_files_inspected_add: 5,
  },
};

export function extractChangeSignals(fm: ExplorationFrontmatterInput): ExplorationChangeSignals {
  const touchesRaw = fm.touches_layers;
  let touches_layers: string[] = [];
  if (Array.isArray(touchesRaw)) {
    touches_layers = touchesRaw.map(x => String(x).trim()).filter(Boolean);
  } else if (typeof touchesRaw === 'string' && touchesRaw.trim()) {
    touches_layers = [touchesRaw.trim()];
  }

  return {
    change_intent: fm.change_intent !== undefined ? String(fm.change_intent).trim().toLowerCase() : undefined,
    estimated_loc_delta:
      fm.estimated_loc_delta !== undefined ? Number(fm.estimated_loc_delta) : undefined,
    touches_layers,
    adds_new_exports:
      fm.adds_new_exports === true ||
      String(fm.adds_new_exports ?? '').toLowerCase() === 'true',
    single_function_scope:
      fm.single_function_scope === true ||
      String(fm.single_function_scope ?? '').toLowerCase() === 'true',
  };
}

export function resolveExplorationStrategy(
  phase: ContextExplorationPhase,
  phaseRule?: PhaseRuleSpec,
): ExplorationStrategy | undefined {
  void phase;
  return phaseRule?.exploration_strategy;
}

function countInScopeModules(projectRoot: string, feature: string, frameworkRoot?: string): number {
  const loader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
  const prd = loader.loadFeatureDoc(projectRoot, feature, 'PRD.md');
  if (!prd) return 0;
  const { scope } = parseScope(prd);
  return scope?.in_scope_modules?.length ?? 0;
}

function countContractFiles(projectRoot: string, feature: string, frameworkRoot?: string): number {
  const loader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
  const raw = loader.loadFeatureDoc(projectRoot, feature, 'contracts.yaml');
  if (!raw) return 0;
  try {
    const parsed = YAML.parse(raw) as { files?: unknown[] };
    return Array.isArray(parsed.files) ? parsed.files.length : 0;
  } catch {
    return 0;
  }
}

function countUseCases(projectRoot: string, feature: string, frameworkRoot?: string): number {
  const loader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
  const raw = loader.loadFeatureDoc(projectRoot, feature, 'use-cases.yaml');
  if (!raw) return 0;
  try {
    const parsed = YAML.parse(raw) as { use_cases?: unknown[] };
    return Array.isArray(parsed.use_cases) ? parsed.use_cases.length : 0;
  } catch {
    return 0;
  }
}

/** 无 exploration_strategy 时的 legacy 计数逻辑 */
export function legacyRequiresSubagent(
  phase: ContextExplorationPhase,
  projectRoot: string,
  feature: string,
  thresholds: ExplorationThresholds,
  frameworkRoot?: string,
): boolean {
  if (phase === 'prd' || phase === 'design') {
    const gte = thresholds.require_subagent_when_scope_gte;
    if (gte === undefined || gte <= 0) return false;
    return countInScopeModules(projectRoot, feature, frameworkRoot) >= gte;
  }
  if (phase === 'coding') {
    const gt = thresholds.require_subagent_when_contract_files_gt;
    if (gt === undefined) return false;
    return countContractFiles(projectRoot, feature, frameworkRoot) > gt;
  }
  if (phase === 'review') {
    const gt = thresholds.require_subagent_when_review_files_gt;
    if (gt === undefined) return false;
    return countContractFiles(projectRoot, feature, frameworkRoot) > gt;
  }
  if (phase === 'ut') {
    const gt = thresholds.require_subagent_when_use_cases_gt;
    if (gt === undefined) return false;
    return countUseCases(projectRoot, feature, frameworkRoot) > gt;
  }
  return false;
}

export function classifyExplorationComplexity(
  signals: ExplorationChangeSignals,
): ExplorationComplexityLevel {
  const intent = (signals.change_intent ?? 'feature').toLowerCase();
  const loc = Number.isFinite(signals.estimated_loc_delta)
    ? Number(signals.estimated_loc_delta)
    : 9999;
  const layerCount = signals.touches_layers?.length ?? 0;
  const addsExports = signals.adds_new_exports === true;

  if (
    TRIVIAL_INTENTS.has(intent) &&
    loc < 20 &&
    layerCount <= 1
  ) {
    return 'L1_trivial';
  }

  if (layerCount >= 3 || (addsExports && loc > 200)) {
    return 'L4_architectural';
  }

  if (loc < 50 && layerCount <= 1 && !addsExports) {
    return 'L2_small';
  }

  return 'L3_moderate';
}

function scoreFromTiers(value: number, tiers: ScoringTier[] | undefined, cap?: number): number {
  if (!tiers || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => b.gte - a.gte);
  for (const tier of sorted) {
    if (value >= tier.gte) {
      const s = tier.score;
      return cap !== undefined ? Math.min(s, cap) : s;
    }
  }
  return 0;
}

function resolveDimensionValue(
  dim: ScoringDimension,
  projectRoot: string,
  feature: string,
  signals: ExplorationChangeSignals,
  frameworkRoot?: string,
): number {
  switch (dim.id) {
    case 'module_loc':
      return computeMaxInScopeModuleLoc(projectRoot, feature, frameworkRoot);
    case 'scope_breadth':
      return countInScopeModules(projectRoot, feature, frameworkRoot);
    case 'dependency_fan_out':
      return computeMaxDependencyFanOut(projectRoot, feature, frameworkRoot);
    default:
      return 0;
  }
}

function resolveSignalScore(
  dim: ScoringDimension,
  signals: ExplorationChangeSignals,
): number {
  const signal = dim.signal ?? '';
  if (signal === 'touches_multiple_outer_layers') {
    const n = signals.touches_layers?.length ?? 0;
    return n > 1 ? (dim.score_if_true ?? 0) : 0;
  }
  if (signal === 'adds_exports_or_public_api') {
    return signals.adds_new_exports ? (dim.score_if_true ?? 0) : 0;
  }
  return 0;
}

export function computeExplorationScore(
  scoring: ExplorationScoringConfig,
  projectRoot: string,
  feature: string,
  signals: ExplorationChangeSignals,
  frameworkRoot?: string,
): number {
  let total = 0;
  for (const dim of scoring.dimensions) {
    if (dim.signal) {
      total += resolveSignalScore(dim, signals);
      continue;
    }
    const value = resolveDimensionValue(dim, projectRoot, feature, signals, frameworkRoot);
    total += scoreFromTiers(value, dim.tiers, dim.weight);
  }
  return total;
}

function matchesTrivialExemption(
  strategy: ExplorationStrategy,
  signals: ExplorationChangeSignals,
): boolean {
  const cfg = strategy.trivial_exemption;
  if (!cfg?.enabled) return false;
  const conditions = cfg.conditions_any ?? [];
  if (conditions.length === 0) return false;

  const intent = (signals.change_intent ?? '').toLowerCase();
  const loc = Number.isFinite(signals.estimated_loc_delta)
    ? Number(signals.estimated_loc_delta)
    : undefined;

  for (const cond of conditions) {
    if (cond.intent?.some(i => intent === i.toLowerCase())) return true;
    if (
      cond.prd_loc_delta_lt !== undefined &&
      loc !== undefined &&
      loc < cond.prd_loc_delta_lt
    ) {
      return true;
    }
    if (cond.single_function_scope === true && signals.single_function_scope === true) {
      return true;
    }
  }
  return false;
}

export function applySequentialMultiplier(
  thresholds: ExplorationThresholds,
  strategy: ExplorationStrategy,
): ExplorationThresholds {
  const mult = strategy.sequential_multiplier ?? 2.0;
  const addFiles = strategy.sequential_min_files_inspected_add ?? 0;
  return {
    ...thresholds,
    min_source_code_paths: Math.ceil((thresholds.min_source_code_paths ?? 0) * mult),
    min_code_facts: Math.ceil((thresholds.min_code_facts ?? 0) * mult),
    min_searches: Math.ceil((thresholds.min_searches ?? 0) * mult),
    min_files_inspected: (thresholds.min_files_inspected ?? 0) + addFiles,
  };
}

export function determineExplorationMode(
  phase: ContextExplorationPhase,
  projectRoot: string,
  feature: string,
  fm: ExplorationFrontmatterInput,
  thresholds: ExplorationThresholds,
  phaseRule?: PhaseRuleSpec,
  frameworkRoot?: string,
): ExplorationModeDecision {
  const strategy = resolveExplorationStrategy(phase, phaseRule);
  const mode = String(fm.exploration_mode ?? '').trim().toLowerCase();

  if (!strategy) {
    const legacy = legacyRequiresSubagent(phase, projectRoot, feature, thresholds, frameworkRoot);
    return {
      requiresSubagent: legacy,
      applySequentialMultiplier: legacy && mode === 'sequential',
      complexity: 'L3_moderate',
      reason: 'legacy exploration_thresholds fallback',
      usedLegacyFallback: true,
    };
  }

  const signals = extractChangeSignals(fm);
  const complexity = classifyExplorationComplexity(signals);

  if (complexity === 'L4_architectural') {
    return {
      requiresSubagent: true,
      applySequentialMultiplier: mode === 'sequential',
      complexity,
      reason: 'L4_architectural — 全阶段强制深度探索',
      usedLegacyFallback: false,
    };
  }

  if (complexity === 'L1_trivial' && matchesTrivialExemption(strategy, signals)) {
    return {
      requiresSubagent: false,
      applySequentialMultiplier: false,
      complexity,
      reason: 'L1_trivial — trivial_exemption 命中',
      usedLegacyFallback: false,
    };
  }

  const defaultMode = strategy.default_mode ?? 'sequential';
  const scoring = strategy.scoring;

  if (defaultMode === 'subagent') {
    if (complexity === 'L2_small' && scoring) {
      const score = computeExplorationScore(scoring, projectRoot, feature, signals, frameworkRoot);
      if (score < scoring.threshold) {
        return {
          requiresSubagent: false,
          applySequentialMultiplier: false,
          complexity,
          score,
          scoreThreshold: scoring.threshold,
          reason: 'L2_small — 复合评分低于阈值，豁免 subagent',
          usedLegacyFallback: false,
        };
      }
      return {
        requiresSubagent: true,
        applySequentialMultiplier: mode === 'sequential',
        complexity,
        score,
        scoreThreshold: scoring.threshold,
        reason: 'L2_small — 评分达阈，design/coding 须深度探索',
        usedLegacyFallback: false,
      };
    }

    return {
      requiresSubagent: true,
      applySequentialMultiplier: mode === 'sequential',
      complexity,
      reason: 'default_mode=subagent — 默认须 subagent（非 trivial）',
      usedLegacyFallback: false,
    };
  }

  if (scoring) {
    const score = computeExplorationScore(scoring, projectRoot, feature, signals, frameworkRoot);
    const requires = score >= scoring.threshold;
    return {
      requiresSubagent: requires,
      applySequentialMultiplier: requires && mode === 'sequential',
      complexity,
      score,
      scoreThreshold: scoring.threshold,
      reason: requires
        ? `scoring ${score} >= ${scoring.threshold}`
        : `scoring ${score} < ${scoring.threshold}`,
      usedLegacyFallback: false,
    };
  }

  const legacy = legacyRequiresSubagent(phase, projectRoot, feature, thresholds, frameworkRoot);
  return {
    requiresSubagent: legacy,
    applySequentialMultiplier: legacy && mode === 'sequential',
    complexity,
    reason: 'exploration_strategy 无 scoring，回落 legacy 计数',
    usedLegacyFallback: true,
  };
}
