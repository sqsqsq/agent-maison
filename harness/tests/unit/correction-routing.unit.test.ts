// ============================================================================
// correction-routing.unit.test.ts — C5-min 契约单测（correction-routing，
// plan d4a7c1e8）
// ============================================================================
// 覆盖：三问分层短路序 / 组合修正 touched / track 投影 / revalidate 级联清单 /
// 归属三态 / enforcement 分档 mode 优先 / correction state roundtrip 与 staleness /
// verification_evidence_gap 的 goal 分类（不入 no_progress 口径）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { loadWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import {
  classifyCorrection,
  mapCategoryToPhase,
  resolveCorrectionCategory,
  resolveCorrectionTarget,
  shouldAutoConfirmCorrectionLayer,
  touchedCategories,
} from '../../scripts/utils/correction-routing';
import {
  assessCorrectionStaleness,
  buildCorrectionState,
  correctionStatePath,
  readCorrectionState,
  resolveCurrentSessionSignal,
  writeCorrectionState,
} from '../../scripts/utils/correction-state';
import { closedPhasesFor, runCorrectionInit } from '../../scripts/utils/correction-commands';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import {
  featurePhaseReportsDir,
  resolveReceiptFilePath,
  statefilePath,
} from '../../config';
import { resolveEnforcementTier } from '../../scripts/utils/runtime-policy';
import {
  classifyFailureKind,
  SIGNATURE_HALT_KINDS,
} from '../../scripts/utils/goal-failure-classifier';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function specDriven(): WorkflowSpec {
  return loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, shell: false });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr?.toString() ?? r.error?.message ?? 'unknown'}`);
  }
}

/** 真实 git 工程 + demo-feat feature 目录（未声明 feature.yaml → 默认 full track）。 */
function mkGitFeatureProject(evidenceProfile?: 'balanced'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-autoconfirm-'));
  fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'doc', 'features', 'demo-feat'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0',
    project_name: 'correction-autoconfirm-fixture',
    project_profile: { name: 'generic' },
    ...(evidenceProfile ? { evidence_profile: evidenceProfile } : {}),
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'baseline.txt'), 'baseline\n', 'utf-8');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'baseline']);
  return dir;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '三问短路序：Q1>Q2>Q3>纯验证',
    run: () => {
      eq(
        resolveCorrectionCategory({ requirement_changed: true, contract_changed: true, code_change_needed: true }),
        'spec', 'Q1 优先',
      );
      eq(
        resolveCorrectionCategory({ requirement_changed: false, contract_changed: true, code_change_needed: true }),
        'plan', 'Q2 次之',
      );
      eq(
        resolveCorrectionCategory({ requirement_changed: false, contract_changed: false, code_change_needed: true }),
        'coding', 'Q3',
      );
      eq(
        resolveCorrectionCategory({ requirement_changed: false, contract_changed: false, code_change_needed: false }),
        'verification', '纯验证',
      );
    },
  },
  {
    name: '组合修正 touched：改 spec 同轮改代码 → [spec, coding]',
    run: () => {
      eq(
        touchedCategories({ requirement_changed: true, contract_changed: false, code_change_needed: true }),
        ['spec', 'coding'], 'touched',
      );
      eq(
        touchedCategories({ requirement_changed: false, contract_changed: false, code_change_needed: false }),
        ['verification'], '纯验证 touched',
      );
    },
  },
  {
    name: 'track 投影：full spec/plan/coding/ut；lite change/change/coding/exit',
    run: () => {
      const spec = specDriven();
      eq(mapCategoryToPhase('spec', spec, 'full'), 'spec', 'full spec');
      eq(mapCategoryToPhase('plan', spec, 'full'), 'plan', 'full plan');
      eq(mapCategoryToPhase('verification', spec, 'full'), 'ut', 'full verification');
      eq(mapCategoryToPhase('spec', spec, 'lite'), 'change', 'lite spec→change');
      eq(mapCategoryToPhase('plan', spec, 'lite'), 'change', 'lite plan→change');
      eq(mapCategoryToPhase('coding', spec, 'lite'), 'coding', 'lite coding');
      eq(mapCategoryToPhase('verification', spec, 'lite'), 'exit', 'lite verification→exit');
    },
  },
  {
    name: 'classifyCorrection full：coding 根因 + 下游仅已闭环 phase 进 revalidate',
    run: () => {
      const cls = classifyCorrection({
        answers: { requirement_changed: false, contract_changed: false, code_change_needed: true },
        spec: specDriven(),
        track: 'full',
        closedPhases: ['spec', 'plan', 'coding', 'ut'], // review/testing 未闭环
      });
      eq(cls.root_layer, 'coding', 'root');
      eq(cls.touched_layers, ['coding'], 'touched');
      eq(cls.revalidate.map((r) => r.phase), ['coding', 'ut'], 'revalidate：根因 + 已闭环下游（跳过未闭环 review/testing）');
      eq(cls.revalidate.every((r) => r.status === 'pending'), true, '初始 pending');
    },
  },
  {
    name: 'classifyCorrection lite：需求变 → change 根因，级联 coding/exit（已闭环时）',
    run: () => {
      const cls = classifyCorrection({
        answers: { requirement_changed: true, contract_changed: false, code_change_needed: false },
        spec: specDriven(),
        track: 'lite',
        closedPhases: ['change', 'coding', 'exit'],
      });
      eq(cls.root_layer, 'change', 'root');
      eq(cls.revalidate.map((r) => r.phase), ['change', 'coding', 'exit'], 'lite 级联');
    },
  },
  {
    name: 'resolveCorrectionTarget：点名存在/点名不存在→ask_user/活跃 state/no_feature',
    run: () => {
      const exists = (f: string) => f === 'real-feature';
      eq(
        resolveCorrectionTarget({ requestedFeature: 'real-feature', featureDirExists: exists }),
        { kind: 'feature', feature: 'real-feature' }, '点名存在',
      );
      const ask = resolveCorrectionTarget({ requestedFeature: 'ghost', featureDirExists: exists });
      eq(ask.kind, 'ask_user', '点名不存在须问人（禁止猜）');
      eq(
        resolveCorrectionTarget({ activeStateFeature: 'real-feature', featureDirExists: exists }),
        { kind: 'feature', feature: 'real-feature' }, '活跃 state 归属',
      );
      eq(resolveCorrectionTarget({ featureDirExists: exists }), { kind: 'no_feature' }, 'no_feature');
    },
  },
  {
    name: 'resolveEnforcementTier：mode 优先（goal/headless 下有 hooks 也判 headless_runner）',
    run: () => {
      const withHooks = { settings_file: { path: '.claude/settings.json' }, hooks: { target_dir: '.claude/hooks' } };
      eq(resolveEnforcementTier(withHooks, { mode: 'goal' }), 'headless_runner', 'goal 优先');
      eq(resolveEnforcementTier(withHooks, { mode: 'headless' }), 'headless_runner', 'headless 优先');
      eq(resolveEnforcementTier(withHooks, { mode: 'interactive' }), 'hard_hook', 'settings+hooks → hard_hook');
      eq(resolveEnforcementTier({ hooks: withHooks.hooks }, { mode: 'interactive' }), 'soft_rule_only', '缺 settings_file → soft');
      eq(resolveEnforcementTier(null, { mode: 'interactive' }), 'soft_rule_only', '无 manifest → soft');
      eq(resolveEnforcementTier({ settings_file: '', hooks: {} }, { mode: 'interactive' }), 'soft_rule_only', '空字段 → soft');
    },
  },
  {
    name: 'correction state：build→write→read roundtrip + staleness 三态',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-state-'));
      try {
        const state = buildCorrectionState({
          feature: null,
          root_layer: 'coding',
          touched_layers: ['coding'],
          revalidate: [{ phase: 'adhoc', status: 'pending' }],
          base_commit: 'abc1234',
          request_text: '修一下按钮颜色',
          enforcement_tier: 'soft_rule_only',
        });
        writeCorrectionState(root, state);
        const back = readCorrectionState(root);
        if (!back) throw new Error('roundtrip 应成功');
        eq(back.root_layer, 'coding', 'root_layer');
        eq(back.request_fingerprint.length, 16, 'fingerprint 长度');
        eq(assessCorrectionStaleness(back).stale, false, 'fresh');
        eq(
          assessCorrectionStaleness(back, { now: new Date(Date.parse(back.expires_at) + 1000) }),
          { stale: true, reason: 'expired' }, '过期',
        );
        const withSid = { ...back, session_id: 'sid-A' };
        eq(
          assessCorrectionStaleness(withSid, { currentSessionId: 'sid-B' }),
          { stale: true, reason: 'session_mismatch' }, '串会话',
        );
        eq(assessCorrectionStaleness(withSid, { currentSessionId: 'sid-A' }).stale, false, '同会话');
        // 损坏/版本不符 → null
        fs.writeFileSync(correctionStatePath(root), '{"schema_version":"9.9"}', 'utf-8');
        eq(readCorrectionState(root), null, '版本不符 null');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveCurrentSessionSignal：last_seen 优先于 session_id；缺 state/信号 → null（codex 批次 2 P1 回归钉）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-session-'));
      try {
        eq(resolveCurrentSessionSignal(root), null, '无 state');
        const stateAbs = statefilePath(root);
        fs.mkdirSync(path.dirname(stateAbs), { recursive: true });
        fs.writeFileSync(stateAbs, JSON.stringify({ session_id: 'sid-task' }), 'utf-8');
        eq(resolveCurrentSessionSignal(root), 'sid-task', 'session_id 次选可用');
        fs.writeFileSync(
          stateAbs,
          JSON.stringify({ session_id: 'sid-task', last_seen_session_id: 'sid-now' }),
          'utf-8',
        );
        eq(resolveCurrentSessionSignal(root), 'sid-now', 'last_seen 优先');
        fs.writeFileSync(stateAbs, '{"session_id": null}', 'utf-8');
        eq(resolveCurrentSessionSignal(root), null, '无信号 → null（TTL 兜底）');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'closedPhasesFor：full 只认 receipt；lite 另认 script-report PASS（cursor 批次 2 P1）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-closed-'));
      try {
        // spec：receipt 在场（两轨都算闭环）
        const receiptAbs = resolveReceiptFilePath(root, 'f', 'spec').path;
        fs.mkdirSync(path.dirname(receiptAbs), { recursive: true });
        fs.writeFileSync(receiptAbs, 'receipt', 'utf-8');
        // exit：仅 script-report PASS（lite 过渡闭环判据）
        const exitReports = featurePhaseReportsDir(root, 'f', 'exit', FRAMEWORK_ROOT);
        fs.mkdirSync(exitReports, { recursive: true });
        fs.writeFileSync(
          path.join(exitReports, 'script-report.json'),
          JSON.stringify({ summary: { verdict: 'PASS' } }),
          'utf-8',
        );
        // coding：script-report FAIL（两轨都不算）
        const codingReports = featurePhaseReportsDir(root, 'f', 'coding', FRAMEWORK_ROOT);
        fs.mkdirSync(codingReports, { recursive: true });
        fs.writeFileSync(
          path.join(codingReports, 'script-report.json'),
          JSON.stringify({ summary: { verdict: 'FAIL' } }),
          'utf-8',
        );
        const phases = ['spec', 'coding', 'exit'];
        eq(closedPhasesFor(root, 'f', phases, 'full', FRAMEWORK_ROOT), ['spec'], 'full 只认 receipt');
        eq(
          closedPhasesFor(root, 'f', phases, 'lite', FRAMEWORK_ROOT),
          ['spec', 'exit'],
          'lite 认 report PASS，FAIL 不算',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'listAvailablePhaseRules：约定派生 phase 进发现面（codex 批次 2 P3）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-rules-list-'));
      try {
        const rulesDir = path.join(root, 'rules');
        fs.mkdirSync(rulesDir, { recursive: true });
        fs.writeFileSync(path.join(rulesDir, 'spec-rules.yaml'), 'phase: spec\n', 'utf-8');
        fs.writeFileSync(path.join(rulesDir, 'change-rules.yaml'), 'phase: change\n', 'utf-8');
        fs.writeFileSync(path.join(rulesDir, 'exit-rules.yaml'), 'phase: exit\n', 'utf-8');
        fs.writeFileSync(path.join(rulesDir, 'not-a-rule.txt'), 'x', 'utf-8');
        const loader = new SpecLoader(root, rulesDir, path.join(root, 'features'), FRAMEWORK_ROOT);
        const listed = loader.listAvailablePhaseRules();
        eq(listed.includes('spec'), true, '既有映射 phase');
        eq(listed.includes('change'), true, '约定派生 change');
        eq(listed.includes('exit'), true, '约定派生 exit');
        eq(listed.includes('not-a-rule' as never), false, '非规则文件不进');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'shouldAutoConfirmCorrectionLayer：balanced+纯验证+未触及 coding → true（窄范围免确认）',
    run: () => {
      eq(
        shouldAutoConfirmCorrectionLayer({
          profileLabel: 'balanced',
          category: 'verification',
          touchedLayers: ['ut'],
        }),
        true, 'balanced 纯验证不触 coding 应免确认',
      );
    },
  },
  {
    name: 'shouldAutoConfirmCorrectionLayer：即便纯验证，touched 含 coding → false（组合修正仍须确认）',
    run: () => {
      eq(
        shouldAutoConfirmCorrectionLayer({
          profileLabel: 'balanced',
          category: 'verification',
          touchedLayers: ['ut', 'coding'],
        }),
        false, 'touched 含 coding 不得免确认',
      );
    },
  },
  {
    name: 'shouldAutoConfirmCorrectionLayer：category 非 verification（改代码/改契约/改需求）→ false',
    run: () => {
      for (const category of ['coding', 'plan', 'spec'] as const) {
        eq(
          shouldAutoConfirmCorrectionLayer({ profileLabel: 'balanced', category, touchedLayers: [category] }),
          false, `category=${category} 不得免确认`,
        );
      }
    },
  },
  {
    name: 'shouldAutoConfirmCorrectionLayer：profileLabel 非 balanced（strict/minimal）→ false，即便纯验证不触 coding',
    run: () => {
      for (const profileLabel of ['strict', 'minimal'] as const) {
        eq(
          shouldAutoConfirmCorrectionLayer({ profileLabel, category: 'verification', touchedLayers: ['ut'] }),
          false, `profileLabel=${profileLabel} 不得免确认`,
        );
      }
    },
  },
  {
    name: 'runCorrectionInit 端到端：evidence_profile=balanced + 纯验证修正 → state.auto_confirm_eligible=true',
    run: () => {
      const dir = mkGitFeatureProject('balanced');
      try {
        const code = runCorrectionInit(dir, {
          requestedFeature: 'demo-feat',
          answers: { requirement_changed: false, contract_changed: false, code_change_needed: false },
          requestText: '补一个遗漏的验证用例',
          frameworkRoot: FRAMEWORK_ROOT,
        });
        eq(code, 0, 'correction-init 应成功');
        const state = readCorrectionState(dir);
        eq(state?.auto_confirm_eligible, true, 'balanced+纯验证+未触及 coding 应免确认');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'runCorrectionInit 端到端：evidence_profile=balanced 但要改产品代码 → state.auto_confirm_eligible=false',
    run: () => {
      const dir = mkGitFeatureProject('balanced');
      try {
        runCorrectionInit(dir, {
          requestedFeature: 'demo-feat',
          answers: { requirement_changed: false, contract_changed: false, code_change_needed: true },
          requestText: '按钮颜色改一下',
          frameworkRoot: FRAMEWORK_ROOT,
        });
        const state = readCorrectionState(dir);
        eq(state?.auto_confirm_eligible, false, '改产品代码（root_layer=coding）不得免确认');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'runCorrectionInit 端到端：未配置 evidence_profile（strict）+ 纯验证修正 → state.auto_confirm_eligible=false',
    run: () => {
      const dir = mkGitFeatureProject();
      try {
        runCorrectionInit(dir, {
          requestedFeature: 'demo-feat',
          answers: { requirement_changed: false, contract_changed: false, code_change_needed: false },
          requestText: '补一个遗漏的验证用例',
          frameworkRoot: FRAMEWORK_ROOT,
        });
        const state = readCorrectionState(dir);
        eq(state?.auto_confirm_eligible, false, 'strict 档纯验证仍须停等确认');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal 分类：verification_evidence_gap 独立 kind 且不入 no_progress 口径',
    run: () => {
      const kind = classifyFailureKind({
        verdict: 'FAIL',
        blockers: [{ id: 'adhoc_verification_evidence', classification: 'verification_evidence_gap' }],
      });
      eq(kind, 'verification_evidence_gap', 'kind');
      eq(SIGNATURE_HALT_KINDS.has('verification_evidence_gap'), false, '不入 signature halt（no_progress）口径');
      eq(SIGNATURE_HALT_KINDS.has('await_human_confirm'), false, '同构参照：await_human 也不在');
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
