// ============================================================================
// runtime-policy.unit.test.ts — C0 契约单测（plan d4a7c1e8）
// ============================================================================
// 锁死"default 等值不变式"：无 feature.yaml、无 evidence_profile、spec-driven
// workflow 下，各判定输出与收编前硬编码行为逐一等值；并验证新 phase 一等公民。

import * as path from 'path';
import { loadWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import {
  LEGACY_COMPAT_PHASES,
  LEGACY_EXPLORATION_PHASES,
  LEGACY_FEATURE_PHASE_ORDER,
  POLICY_SCHEMA_VERSION,
  assertWorkflowFeaturePhase,
  buildPolicySnapshot,
  classifyRequestRoute,
  compatAllowedPhases,
  explorationPhases,
  parsePolicySnapshot,
  resolveEvidencePolicy,
  resolveFeatureTrack,
  resolvePhaseChain,
  workflowFeaturePhases,
  type RuntimeContext,
} from '../../scripts/utils/runtime-policy';
import { resolveAutoChain } from '../../scripts/utils/phase-transition-policy';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function specDriven(): WorkflowSpec {
  return loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
}

function ctx(mode: RuntimeContext['mode']): RuntimeContext {
  return {
    mode,
    adapter: 'claude',
    phase: 'coding',
    workflow: 'spec-driven',
    can_prompt_user: mode === 'interactive',
    can_collect_usage: mode !== 'interactive',
  };
}

/** 合成 workflow：含 lite 新 phase（change/exit），验证新 phase 一等公民。 */
function syntheticLiteWorkflow(): WorkflowSpec {
  return {
    schema_version: '1.0',
    name: 'synthetic-lite',
    auto_chain: ['change', 'coding', 'exit'],
    artifacts: [
      { id: 'change', scope: 'feature', requires: [] },
      { id: 'coding', scope: 'feature', requires: ['change'] },
      { id: 'exit', scope: 'feature', requires: ['coding'] },
    ],
  };
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'workflowFeaturePhases(spec-driven) == legacy canonical order（default 等值）',
    run: () => {
      eq(workflowFeaturePhases(specDriven()), [...LEGACY_FEATURE_PHASE_ORDER], 'feature phases');
    },
  },
  {
    name: 'resolvePhaseChain(full).idSet 含全部 workflow phase（global+feature）',
    run: () => {
      const chain = resolvePhaseChain(specDriven(), 'full');
      for (const p of ['init', 'catalog', 'glossary', 'docs', ...LEGACY_FEATURE_PHASE_ORDER]) {
        if (!chain.idSet.has(p)) throw new Error(`idSet 缺 ${p}`);
      }
      eq(chain.featureOrdered, [...LEGACY_FEATURE_PHASE_ORDER], 'featureOrdered');
    },
  },
  {
    name: 'explorationPhases：无 spec 回退 == 有 spec 派生 == 传统 5 阶段',
    run: () => {
      const expected = ['spec', 'plan', 'coding', 'review', 'ut'];
      eq([...LEGACY_EXPLORATION_PHASES], expected, 'legacy 常量');
      eq([...explorationPhases()], expected, '无 spec');
      eq([...explorationPhases(specDriven())], expected, '有 spec');
    },
  },
  {
    name: 'compatAllowedPhases == 传统集合（含 prd/design alias）',
    run: () => {
      const expected = new Set(['spec', 'plan', 'coding', 'review', 'ut', 'prd', 'design']);
      const actual = compatAllowedPhases();
      eq([...actual].sort(), [...expected].sort(), 'compat set');
      eq([...LEGACY_COMPAT_PHASES].sort(), [...expected].sort(), 'legacy 常量');
    },
  },
  {
    name: 'resolveEvidencePolicy：interactive/headless/goal 三态恒 strict（C0）',
    run: () => {
      for (const mode of ['interactive', 'headless', 'goal'] as const) {
        const p = resolveEvidencePolicy('full', ctx(mode));
        eq(p, { verifier: 'required', receipt: 'required', trace: 'required', exploration: 'required' }, mode);
      }
    },
  },
  {
    name: 'resolveFeatureTrack：缺失/空/非 lite → full；显式 lite → lite',
    run: () => {
      eq(resolveFeatureTrack(null), 'full', 'null');
      eq(resolveFeatureTrack(undefined), 'full', 'undefined');
      eq(resolveFeatureTrack({}), 'full', '{}');
      eq(resolveFeatureTrack({ track: 'weird' }), 'full', 'weird');
      eq(resolveFeatureTrack({ track: 'lite' }), 'lite', 'lite');
    },
  },
  {
    name: 'classifyRequestRoute：targets_feature 分流 direct|feature',
    run: () => {
      eq(classifyRequestRoute({ targets_feature: false }), 'direct', 'direct');
      eq(classifyRequestRoute({ targets_feature: true }), 'feature', 'feature');
    },
  },
  {
    name: 'policy 快照：build→parse 往返；版本不符/垃圾 → null（hook fail-safe 前提）',
    run: () => {
      const snap = buildPolicySnapshot('full');
      eq(snap.policy_schema_version, POLICY_SCHEMA_VERSION, 'version');
      const parsed = parsePolicySnapshot(JSON.parse(JSON.stringify(snap)));
      if (!parsed) throw new Error('roundtrip 应成功');
      eq(parsed, snap, 'roundtrip');
      if (parsePolicySnapshot({ ...snap, policy_schema_version: '9.9' }) !== null) {
        throw new Error('版本不符应 null');
      }
      if (parsePolicySnapshot('garbage') !== null) throw new Error('垃圾应 null');
      if (parsePolicySnapshot(null) !== null) throw new Error('null 应 null');
      if (parsePolicySnapshot({ ...snap, evidence: { verifier: 'nope' } }) !== null) {
        throw new Error('非法 evidence 档应 null');
      }
    },
  },
  {
    name: 'assertWorkflowFeaturePhase：合法通过、global/未知拒绝',
    run: () => {
      const spec = specDriven();
      assertWorkflowFeaturePhase(spec, 'coding');
      for (const bad of ['catalog', 'nonsense']) {
        let threw = false;
        try {
          assertWorkflowFeaturePhase(spec, bad);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error(`${bad} 应被拒`);
      }
    },
  },
  {
    name: 'resolveAutoChain(spec-driven, spec→testing) == 传统全链（收编后等值）',
    run: () => {
      eq(
        resolveAutoChain(specDriven(), 'spec', 'testing'),
        [...LEGACY_FEATURE_PHASE_ORDER],
        'full chain',
      );
      eq(resolveAutoChain(specDriven(), 'coding', 'ut'), ['coding', 'review', 'ut'], 'sub chain');
      // legacy alias 仍可作端点
      eq(resolveAutoChain(specDriven(), 'prd', 'design'), ['spec', 'plan'], 'alias endpoints');
    },
  },
  {
    name: '新 phase 一等公民：合成 lite workflow 的 change→exit 链可解析（C0 spec Scenario）',
    run: () => {
      const spec = syntheticLiteWorkflow();
      eq(workflowFeaturePhases(spec), ['change', 'coding', 'exit'], 'feature phases');
      eq(resolveAutoChain(spec, 'change', 'exit'), ['change', 'coding', 'exit'], 'lite chain');
      assertWorkflowFeaturePhase(spec, 'change');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
