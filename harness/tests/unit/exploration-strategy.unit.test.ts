// ============================================================================
// exploration-strategy + fan-out-scanner unit tests
// ============================================================================

import assert from 'assert';
import * as path from 'path';
import {
  applySequentialMultiplier,
  classifyExplorationComplexity,
  computeExplorationScore,
  DEFAULT_EXPLORATION_STRATEGY,
  determineExplorationMode,
  extractChangeSignals,
} from '../../scripts/utils/exploration-strategy';
import { loadProfileExplorationSnippets } from '../../scripts/utils/context-exploration';
import { detectRepoLayout } from '../../repo-layout';
import type { ExplorationThresholds, PhaseRuleSpec } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const REPO_ROOT = detectRepoLayout(__dirname).projectRoot;

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classifyExplorationComplexity: rename + loc 10 → L1_trivial',
    run: () => {
      const level = classifyExplorationComplexity({
        change_intent: 'rename',
        estimated_loc_delta: 10,
        touches_layers: ['presentation'],
      });
      assert.strictEqual(level, 'L1_trivial');
    },
  },
  {
    name: 'classifyExplorationComplexity: 3 layers + exports → L4_architectural',
    run: () => {
      const level = classifyExplorationComplexity({
        change_intent: 'feature',
        estimated_loc_delta: 300,
        touches_layers: ['a', 'b', 'c'],
        adds_new_exports: true,
      });
      assert.strictEqual(level, 'L4_architectural');
    },
  },
  {
    name: 'classifyExplorationComplexity: small single-layer → L2_small',
    run: () => {
      const level = classifyExplorationComplexity({
        change_intent: 'bugfix',
        estimated_loc_delta: 30,
        touches_layers: ['domain'],
        adds_new_exports: false,
      });
      assert.strictEqual(level, 'L2_small');
    },
  },
  {
    name: 'applySequentialMultiplier: doubles paths/facts and adds files inspected',
    run: () => {
      const base: ExplorationThresholds = {
        min_source_code_paths: 3,
        min_code_facts: 2,
        min_files_inspected: 5,
        min_searches: 4,
      };
      const out = applySequentialMultiplier(base, {
        sequential_multiplier: 2.0,
        sequential_min_files_inspected_add: 5,
      });
      assert.strictEqual(out.min_source_code_paths, 6);
      assert.strictEqual(out.min_code_facts, 4);
      assert.strictEqual(out.min_files_inspected, 10);
      assert.strictEqual(out.min_searches, 8);
    },
  },
  {
    name: 'determineExplorationMode: design default-on requires subagent for feature',
    run: () => {
      const phaseRule: PhaseRuleSpec = {
        phase: 'plan',
        version: '1',
        applies_to: 'plan',
        structure_checks: {},
        semantic_checks: {},
        traceability_checks: {},
        exploration_strategy: DEFAULT_EXPLORATION_STRATEGY.plan,
      };
      const decision = determineExplorationMode(
        'plan',
        REPO_ROOT,
        'home-page',
        {
          change_intent: 'feature',
          estimated_loc_delta: 200,
          touches_layers: ['presentation', 'domain'],
          adds_new_exports: true,
          exploration_mode: 'subagent',
        },
        { min_source_code_paths: 5 },
        phaseRule,
      );
      assert.strictEqual(decision.requiresSubagent, true);
      assert.strictEqual(decision.usedLegacyFallback, false);
    },
  },
  {
    name: 'determineExplorationMode: design trivial rename exempts subagent',
    run: () => {
      const phaseRule: PhaseRuleSpec = {
        phase: 'plan',
        version: '1',
        applies_to: 'plan',
        structure_checks: {},
        semantic_checks: {},
        traceability_checks: {},
        exploration_strategy: DEFAULT_EXPLORATION_STRATEGY.plan,
      };
      const decision = determineExplorationMode(
        'plan',
        REPO_ROOT,
        'home-page',
        {
          change_intent: 'rename',
          estimated_loc_delta: 5,
          touches_layers: ['presentation'],
          exploration_mode: 'sequential',
        },
        { min_source_code_paths: 5 },
        phaseRule,
      );
      assert.strictEqual(decision.requiresSubagent, false);
      assert.strictEqual(decision.complexity, 'L1_trivial');
    },
  },
  {
    name: 'determineExplorationMode: no strategy falls back to legacy scope gte',
    run: () => {
      const decision = determineExplorationMode(
        'spec',
        REPO_ROOT,
        'home-page',
        { change_intent: 'feature', estimated_loc_delta: 10 },
        { require_subagent_when_scope_gte: 1 },
        undefined,
      );
      assert.strictEqual(decision.usedLegacyFallback, true);
      assert.strictEqual(typeof decision.requiresSubagent, 'boolean');
    },
  },
  {
    name: 'computeExplorationScore: cross_layer + api_surface signals',
    run: () => {
      const scoring = DEFAULT_EXPLORATION_STRATEGY.spec!.scoring!;
      const score = computeExplorationScore(
        scoring,
        REPO_ROOT,
        'home-page',
        {
          change_intent: 'feature',
          estimated_loc_delta: 100,
          touches_layers: ['presentation', 'domain'],
          adds_new_exports: true,
        },
      );
      assert.ok(score >= 35, `expected score >= 35, got ${score}`);
    },
  },
  {
    name: 'loadProfileExplorationSnippets: hmos-app spec/plan 键生效',
    run: () => {
      const specSnippets = loadProfileExplorationSnippets('hmos-app', 'spec');
      const planSnippets = loadProfileExplorationSnippets('hmos-app', 'plan');
      assert.ok(specSnippets.includes('build-profile'), 'spec has build-profile');
      assert.ok(planSnippets.includes('module.json5'), 'plan has module.json5');
    },
  },
  {
    name: 'extractChangeSignals: parses array and boolean fields',
    run: () => {
      const s = extractChangeSignals({
        change_intent: 'Feature',
        estimated_loc_delta: 42,
        touches_layers: ['presentation'],
        adds_new_exports: 'true',
        single_function_scope: true,
      });
      assert.strictEqual(s.change_intent, 'feature');
      assert.strictEqual(s.estimated_loc_delta, 42);
      assert.strictEqual(s.adds_new_exports, true);
      assert.strictEqual(s.single_function_scope, true);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
