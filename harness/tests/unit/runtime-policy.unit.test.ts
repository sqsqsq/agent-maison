// ============================================================================
// runtime-policy.unit.test.ts — C0 契约单测（plan d4a7c1e8）
// ============================================================================
// 锁死"default 等值不变式"：无 feature.yaml、无 evidence_profile、spec-driven
// workflow 下，各判定输出与收编前硬编码行为逐一等值；并验证新 phase 一等公民。

import * as fs from 'fs';
import * as path from 'path';
import { loadWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import {
  LEGACY_COMPAT_PHASES,
  LEGACY_EXPLORATION_PHASES,
  LEGACY_FEATURE_PHASE_ORDER,
  POLICY_SCHEMA_VERSION,
  assertWorkflowFeaturePhase,
  buildEvidencePolicySnapshot,
  buildPolicySnapshot,
  classifyRequestRoute,
  compatAllowedPhases,
  explorationPhases,
  parsePolicySnapshot,
  resolveEvidencePolicy,
  resolveFeatureTrack,
  resolvePhaseChain,
  resolvePhaseClosureSource,
  resolveProfileLabel,
  workflowFeaturePhases,
  type FeatureTrack,
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
  {
    name: 'resolveEvidencePolicy（C2）：lite 恒 minimal 矩阵，与 mode 无关（架构性 not_applicable）',
    run: () => {
      const expected = { verifier: 'off', receipt: 'not_applicable', trace: 'optional', exploration: 'not_applicable' };
      for (const mode of ['interactive', 'headless', 'goal'] as const) {
        eq(resolveEvidencePolicy('lite', ctx(mode)), expected, `lite/${mode}`);
      }
      // config 声明 balanced 也不改变 lite 结果——lite 不经这条轴
      eq(
        resolveEvidencePolicy('lite', ctx('interactive'), { evidence_profile: 'balanced' }),
        expected,
        'lite + balanced config 仍 minimal',
      );
    },
  },
  {
    name: 'resolveEvidencePolicy（C2）：full×interactive×balanced 保留集 required，其余 phase off',
    run: () => {
      const balancedCfg = { evidence_profile: 'balanced' };
      const specCtx: RuntimeContext = { ...ctx('interactive'), phase: 'spec' };
      const codingCtx: RuntimeContext = { ...ctx('interactive'), phase: 'coding' };
      const utCtx: RuntimeContext = { ...ctx('interactive'), phase: 'ut' };
      eq(
        resolveEvidencePolicy('full', specCtx, balancedCfg),
        { verifier: 'required', receipt: 'required', trace: 'optional', exploration: 'required' },
        'spec 在保留集内 required',
      );
      eq(
        resolveEvidencePolicy('full', codingCtx, balancedCfg),
        { verifier: 'required', receipt: 'required', trace: 'optional', exploration: 'required' },
        'coding 在保留集内 required',
      );
      eq(
        resolveEvidencePolicy('full', utCtx, balancedCfg),
        { verifier: 'off', receipt: 'required', trace: 'optional', exploration: 'required' },
        'ut 不在保留集 → verifier off',
      );
      // config 可覆写保留集
      eq(
        resolveEvidencePolicy('full', utCtx, { ...balancedCfg, balanced_verifier_retained_phases: ['ut'] }),
        { verifier: 'required', receipt: 'required', trace: 'optional', exploration: 'required' },
        '覆写保留集后 ut 变 required',
      );
    },
  },
  {
    name: 'resolveEvidencePolicy（C2）：headless/goal 恒 strict，balanced config 不生效',
    run: () => {
      const balancedCfg = { evidence_profile: 'balanced' };
      for (const mode of ['headless', 'goal'] as const) {
        eq(
          resolveEvidencePolicy('full', ctx(mode), balancedCfg),
          { verifier: 'required', receipt: 'required', trace: 'required', exploration: 'required' },
          `${mode} 强制 strict，忽略 balanced config`,
        );
      }
    },
  },
  {
    name: 'buildPolicySnapshot（C2）：lite track 输出 evidence.receipt=not_applicable（Stop hook gate 前提）',
    run: () => {
      const snap = buildPolicySnapshot('lite');
      eq(snap.track, 'lite', 'track');
      eq(snap.evidence.receipt, 'not_applicable', 'receipt 项——Stop hook policyRequires 据此放行 lite');
      eq(snap.evidence.verifier, 'off', 'verifier 项');
    },
  },
  {
    name: 'resolveProfileLabel：lite→minimal；full 按 mode/config 求解',
    run: () => {
      eq(resolveProfileLabel('lite', ctx('interactive')), 'minimal', 'lite');
      eq(resolveProfileLabel('lite', ctx('headless'), { evidence_profile: 'balanced' }), 'minimal', 'lite 恒 minimal');
      eq(resolveProfileLabel('full', ctx('interactive')), 'strict', 'full 缺省 strict');
      eq(resolveProfileLabel('full', ctx('interactive'), { evidence_profile: 'balanced' }), 'balanced', 'full balanced');
      eq(resolveProfileLabel('full', ctx('goal'), { evidence_profile: 'balanced' }), 'strict', 'goal 强制 strict 标签');
    },
  },
  {
    name: 'buildEvidencePolicySnapshot：off→skipped_by_policy；not_applicable 恒钉；required 取 observed',
    run: () => {
      const litePolicy = resolveEvidencePolicy('lite', ctx('interactive'));
      const snap = buildEvidencePolicySnapshot(litePolicy, 'minimal', {});
      eq(snap.items.verifier, { policy: 'off', validation_status: 'skipped_by_policy' }, 'off 项恒 skipped_by_policy（无视 observed）');
      eq(snap.items.receipt, { policy: 'not_applicable', validation_status: 'not_applicable' }, 'not_applicable 项恒钉');

      const strictPolicy = resolveEvidencePolicy('full', ctx('interactive'));
      const provided = buildEvidencePolicySnapshot(strictPolicy, 'strict', {
        verifier: 'provided',
        receipt: 'provided',
        trace: 'provided',
        exploration: 'provided',
      });
      eq(provided.items.trace, { policy: 'required', validation_status: 'provided' }, 'required 项取 observed');

      const missingDefault = buildEvidencePolicySnapshot(strictPolicy, 'strict', {});
      eq(missingDefault.items.trace, { policy: 'required', validation_status: 'missing' }, 'required 项未传 observed → missing 缺省');
    },
  },
  {
    name: '不降档红线（C2 design.md）：EvidencePolicy 输出结构上只有 4 项，任何 track/mode/config 组合都不含红线开关',
    run: () => {
      const allowedKeys = new Set(['verifier', 'receipt', 'trace', 'exploration']);
      const combos: Array<[FeatureTrack, RuntimeContext, { evidence_profile?: string } | undefined]> = [
        ['full', ctx('interactive'), undefined],
        ['full', ctx('interactive'), { evidence_profile: 'balanced' }],
        ['full', ctx('headless'), { evidence_profile: 'balanced' }],
        ['full', ctx('goal'), { evidence_profile: 'balanced' }],
        ['lite', ctx('interactive'), undefined],
        ['lite', ctx('goal'), { evidence_profile: 'balanced' }],
      ];
      for (const [track, c, cfg] of combos) {
        const keys = Object.keys(resolveEvidencePolicy(track, c, cfg)).sort();
        eq(keys, [...allowedKeys].sort(), `${track}/${c.mode}/${JSON.stringify(cfg)} 的 policy 键集`);
      }
    },
  },
  {
    name: '不降档红线（C2 design.md）：红线实现文件与 evidence_profile/resolveEvidencePolicy 零耦合（源码扫描锁死）',
    run: () => {
      const harnessRoot = path.resolve(__dirname, '..', '..');
      const redLineFiles = [
        'scripts/utils/framework-integrity.ts',
        'scripts/utils/process-integrity.ts',
        'scripts/utils/fidelity-shared.ts',
        'scripts/utils/diff-scope.ts',
        'scripts/utils/goal-failure-classifier.ts',
      ];
      const forbidden = /evidence_profile|resolveEvidencePolicy|EvidencePolicy|resolveProfileLabel/;
      for (const rel of redLineFiles) {
        const abs = path.join(harnessRoot, rel);
        const content = fs.readFileSync(abs, 'utf-8');
        if (forbidden.test(content)) {
          throw new Error(`${rel} 引用了 evidence policy 相关符号——红线检查不得与 evidence_profile/track 耦合`);
        }
      }
    },
  },
  {
    name: 'resolvePhaseClosureSource：lite 看 script verdict；full 看 receipt 状态',
    run: () => {
      eq(resolvePhaseClosureSource('lite', 'PASS', undefined), 'closed_by_exit_report', 'lite verdict=PASS');
      eq(resolvePhaseClosureSource('lite', 'FAIL', 'passed'), 'open', 'lite 无视 receipt，只看 verdict');
      eq(resolvePhaseClosureSource('lite', undefined, undefined), 'open', 'lite verdict 缺失');
      eq(resolvePhaseClosureSource('full', 'PASS', 'passed'), 'receipt_passed', 'full receipt passed');
      eq(resolvePhaseClosureSource('full', 'PASS', 'missing'), 'open', 'full 无视 verdict，只看 receipt');
      eq(resolvePhaseClosureSource('full', 'PASS', 'not_applicable'), 'open', 'full 下 not_applicable 不等于 passed');
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
