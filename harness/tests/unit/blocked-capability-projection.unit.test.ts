// blocked-capability-projection.unit.test.ts — plan c8e5b3f1 t2
//
// blocked capability 可诊断投影 + mismatch 因果归因 + next_action + assess + merged-report。
// 核心不变式：blocked 仍是 pre-check fact、不产 CheckResult；本批只把已有事实投影到
// readiness_signals / next_action / assess / merged-report 出口，不重构领域模型。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertCapabilityConsumption,
  capabilityResolutionChecks,
  collectBlockedCapabilityFacts,
  resolveCapabilityReport,
  type CapabilityResolution,
  type CapabilityResolutionReport,
} from '../../scripts/utils/capability-resolution';
import {
  deriveSummaryVerdictLattice,
  resolveEffectiveVerdict,
} from '../../scripts/utils/quality-axes';
import { resolveVerdictFromChecks, generateMergedReport } from '../../scripts/utils/report-generator';
import { assessObservation, observeFeatureState, type AssessObservation, type AssessResult } from '../../scripts/utils/assess';
import {
  decideNextAction,
  capabilityBlockedReadinessSignals,
} from '../../harness-runner';
import type { CheckResult, ScriptReport, HarnessRunSummary } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const H = 'f'.repeat(64);

function chk(id: string, status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP', severity = 'BLOCKER'): CheckResult {
  return { id, category: 'structure', description: id, severity: severity as CheckResult['severity'], status, details: '' };
}

/** 构造一个 blocked capability（含 derive.requirement absent attempt，detail 带 requirement 专属话术）。 */
function mkBlockedCap(
  id: string,
  axis: CapabilityResolution['axis'],
  opts: { detail?: string; requirementSrc?: boolean } = {},
): CapabilityResolution {
  const detail = opts.requirementSrc === false
    ? 'derive.codebase 不可解'
    : (opts.detail ?? 'requirement 来源缺失：fidelity-intent-init --feature <f> --requirement "<文本>"（或 --requirement-file <path>）');
  return {
    id,
    axis,
    active: true,
    state: 'blocked',
    on_missing: 'fail',
    applicability_provider_id: null,
    applicability_dependencies: [],
    inputs: [{
      id: 'requirement',
      state: 'absent',
      selected_source: null,
      selected_source_fingerprint: null,
      attempts: [{
        kind: 'derive',
        source: 'derive.requirement',
        state: 'absent',
        dependencies: [],
        ...(detail ? { detail } : {}),
      }],
    }],
  };
}

function mkScriptReport(over: Partial<ScriptReport> = {}): ScriptReport {
  return {
    phase: 'spec',
    feature: 'demo',
    timestamp: 't',
    project_root: '/tmp',
    assurance: 'blocked',
    capability_resolutions: [],
    capability_resolution_contract_fingerprint: null,
    checks: [],
    summary: { total: 0, pass: 0, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' },
    ...over,
  };
}

/** 归因统一走共享生产实现 deriveSummaryVerdictLattice（不抄算法——review F1：测试须测生产接线）。 */
function attribution(checks: CheckResult[], capReport?: { capabilities: CapabilityResolution[] }, phase = 'spec') {
  const lattice = deriveSummaryVerdictLattice(checks, { phase, visualApplicable: false, assetApplicable: false }, capReport);
  const legacy = resolveVerdictFromChecks(checks);
  return {
    pre: lattice.pre_projection_verdict,
    post: lattice.projected_verdict,
    legacy,
    hasBlocked: lattice.has_blocked,
    isMismatch: lattice.projected_verdict !== legacy && lattice.pre_projection_verdict !== legacy,
  };
}

function observe(phaseOverrides: Partial<import('../../scripts/utils/assess').AssessPhaseObservation> = {}): AssessObservation {
  return {
    schema_version: '1.0',
    feature: 'demo',
    workflow: 'spec-driven',
    track: 'full',
    goal_end: 'spec',
    phases: [{
      phase: 'spec',
      summary_state: 'current',
      schema_version: '1.2',
      verdict: 'PASS',
      closure: 'closed',
      assurance: 'full',
      required_assurance: null,
      assurance_satisfied: null,
      deferred: false,
      summary_fingerprint: H,
      evidence_fingerprint: H,
      ...phaseOverrides,
    }],
    fingerprints: { workflow: H, track: H, goal: H, run_attempt: H, summaries: H, evidence: H, reconcile: H, observed: H },
    reconcile: null,
  };
}

interface Case { name: string; run: () => void }
const cases: Case[] = [
  // ---- 契约零变化 ----
  {
    name: 't2 契约零变化：blocked 能力产 0 条 CheckResult，assertCapabilityConsumption 行为不变',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 't2-contract-'));
      try {
        fs.mkdirSync(path.join(root, 'doc', 'features'), { recursive: true });
        // spec 无 requirement → capability_spec_requirement blocked；capability_spec_codebase resolved
        const report = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'spec', track: 'full' });
        const blocked = report.capabilities.filter((c) => c.active && c.state === 'blocked');
        assert(blocked.length > 0, '须有 blocked 能力');
        const checks = capabilityResolutionChecks(report);
        // spec 契约：requirement blocked（0 条），codebase resolved（1 条）→ 总 1 条
        assert(checks.length === 1, `仅 resolved 能力产 check，实际=${checks.length}`);
        assert(checks.every((c) => c.id !== blocked[0]!.id), 'blocked 能力不得产 CheckResult');
        assertCapabilityConsumption(report, checks); // 不抛错
        // checks 数量 / blocker / fail / legacy verdict 由既有 legacy 派生（resolveVerdictFromChecks）
        // 承载，本批未触碰；此处确认 projection 不产生额外 check 面。
        assert(collectBlockedCapabilityFacts(report).length === blocked.length, 'blocked 事实逐个可提取');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  // ---- 因果归因四例 ----
  {
    name: 't2 因果(a)：functional blocked，pre===legacy → 不报 mismatch',
    run: () => {
      const a = attribution([chk('some_functional_pass', 'PASS')], { capabilities: [mkBlockedCap('capability_spec_requirement', 'functional')] });
      assert(a.pre === 'PASS' && a.legacy === 'PASS', `pre=${a.pre} legacy=${a.legacy}`);
      assert(a.post === 'INCOMPLETE', `post=${a.post}`);
      assert(a.isMismatch === false, 'pre===legacy → 不报 mismatch');
    },
  },
  {
    name: 't2 因果(b)：visual/asset blocked，post 靠钳制到 INCOMPLETE → 不报 mismatch（锁 post 含钳制，走生产投影）',
    run: () => {
      for (const axis of ['visual', 'asset'] as const) {
        const a = attribution([chk('some_functional_pass', 'PASS')], { capabilities: [mkBlockedCap(`cap_${axis}`, axis)] });
        assert(a.pre === 'PASS', `axis=${axis} pre=${a.pre}（投影前 visual/asset 不阻断）`);
        assert(a.post === 'INCOMPLETE', `axis=${axis} post=${a.post}（须靠 hasBlocked 顶层钳制——若非钳制 post 会是 PASS）`);
        assert(a.legacy === 'PASS', `axis=${axis} legacy=${a.legacy}`);
        assert(a.isMismatch === false, `axis=${axis} 不报 mismatch`);
      }
    },
  },
  {
    name: 't2 因果(F1 review)：硬 FAIL + functional blocked 同在 → axis 与 projected 均保持 FAIL（capability 投影不得覆盖既有 FAIL）',
    run: () => {
      // BLOCKER FAIL（ut 缺 acceptance 类）让 functional 轴 FAIL；functional blocked capability 投影
      // 不得把 axis FAIL 覆盖成 UNVERIFIED（否则顶层 FAIL / axis UNVERIFIED 分裂）。
      const lattice = deriveSummaryVerdictLattice(
        [chk('some_hard_fail', 'FAIL', 'BLOCKER')],
        { phase: 'spec', visualApplicable: false, assetApplicable: false },
        { capabilities: [mkBlockedCap('capability_spec_requirement', 'functional')] },
      );
      assert(lattice.pre_projection_verdict === 'FAIL', `pre=${lattice.pre_projection_verdict}`);
      assert(lattice.projected_verdict === 'FAIL', `projected=${lattice.projected_verdict}（axis FAIL 保留，不得降 INCOMPLETE）`);
      assert(lattice.quality_axes.functional.verdict === 'FAIL', `functional axis=${lattice.quality_axes.functional.verdict}（必须保持 FAIL）`);
      assert(lattice.has_blocked === true, 'has_blocked 仍 true（blocked 存在）');
      const legacy = resolveVerdictFromChecks([chk('some_hard_fail', 'FAIL', 'BLOCKER')]);
      assert(lattice.projected_verdict === legacy, 'projected===legacy（无分裂）');
    },
  },
  {
    name: 't2 因果(F1 review)：resolveEffectiveVerdict 纯函数五组合——更严侧/post 更宽/pre!==legacy/无差异/post===legacy 但 pre!==legacy',
    run: () => {
      // (1) pre===legacy && post 更严（PASS→INCOMPLETE，capability 合法收紧）→ verdict=INCOMPLETE，不报 mismatch
      let r = resolveEffectiveVerdict({ pre: 'PASS', post: 'INCOMPLETE', legacy: 'PASS' });
      assert(r.verdict === 'INCOMPLETE' && r.mismatch === false, `1: ${JSON.stringify(r)}`);
      // (2) post 更宽（FAIL+blocked：post=INCOMPLETE < legacy=FAIL）→ 更严侧取 FAIL，不报 mismatch
      r = resolveEffectiveVerdict({ pre: 'FAIL', post: 'INCOMPLETE', legacy: 'FAIL' });
      assert(r.verdict === 'FAIL' && r.mismatch === false, `2: ${JSON.stringify(r)}`);
      // (3) pre!==legacy（独立派生缺陷）→ 报 mismatch，verdict 取更严侧
      r = resolveEffectiveVerdict({ pre: 'INCOMPLETE', post: 'INCOMPLETE', legacy: 'PASS' });
      assert(r.verdict === 'INCOMPLETE' && r.mismatch === true, `3: ${JSON.stringify(r)}`);
      // (4) 无差异 → verdict=legacy，不报 mismatch
      r = resolveEffectiveVerdict({ pre: 'PASS', post: 'PASS', legacy: 'PASS' });
      assert(r.verdict === 'PASS' && r.mismatch === false, `4: ${JSON.stringify(r)}`);
      // (5) review：post===legacy 但 pre!==legacy（pre=PASS/post=INCOMPLETE/legacy=INCOMPLETE）→ 仍报 mismatch
      r = resolveEffectiveVerdict({ pre: 'PASS', post: 'INCOMPLETE', legacy: 'INCOMPLETE' });
      assert(r.verdict === 'INCOMPLETE' && r.mismatch === true, `5: ${JSON.stringify(r)}`);
    },
  },
  {
    name: 't2 因果(c)：blocked + 独立投影缺陷，pre!==legacy → 仍报 mismatch',
    run: () => {
      // functional 轴 0 executed（仅 evidence check）→ pre=INCOMPLETE（functional UNVERIFIED 阻断）；
      // legacy 无 BLOCKER FAIL → PASS。pre!==legacy = 独立派生缺陷，blocked 在场也照报。
      const a = attribution(
        [chk('device_test_pass_ok', 'PASS')],
        { capabilities: [mkBlockedCap('capability_spec_requirement', 'functional')] },
      );
      assert(a.pre === 'INCOMPLETE' && a.legacy === 'PASS', `pre=${a.pre} legacy=${a.legacy}`);
      assert(a.isMismatch === true, 'pre!==legacy 的真派生缺陷仍报 mismatch');
    },
  },
  {
    name: 't2 因果(d)：无 blocked 的人造 mismatch，pre!==legacy → 照报',
    run: () => {
      const a = attribution([chk('device_test_pass_ok', 'PASS')], undefined);
      assert(a.pre === 'INCOMPLETE' && a.legacy === 'PASS', `pre=${a.pre} legacy=${a.legacy}`);
      assert(a.isMismatch === true, '无 blocked 的独立 mismatch 照报');
    },
  },
  // ---- next_action 前置条件 ----
  {
    name: 't2 next_action：纯 capability blocked → resolve_capability_inputs_then_rerun',
    run: () => {
      const report = mkScriptReport();
      const signals: HarnessRunSummary['readiness_signals'] = [{ id: 'capability_input_unresolved', status: 'incomplete', message: 'x' }];
      const action = decideNextAction(report, [], [], [], signals, { effectiveVerdict: 'INCOMPLETE', capabilityBlocked: true });
      assert(action === 'resolve_capability_inputs_then_rerun', `action=${action}`);
    },
  },
  {
    name: 't2 next_action：具名 blocker + blocked → 真实 blocker 动作优先',
    run: () => {
      const blocker = { id: 'b', classification: 'project_dependency_missing', details_excerpt: 'x' } as unknown as HarnessRunSummary['blockers'][number];
      const action = decideNextAction(mkScriptReport(), [blocker], [], [], [], { capabilityBlocked: true });
      assert(action === 'resolve_project_dependencies_then_rerun', `action=${action}`);
    },
  },
  {
    name: 't2 next_action：未知 classification 的 FAIL blocker + blocked → 不返回 capability 动作',
    run: () => {
      const blocker = { id: 'b', classification: 'weird_unknown_class', details_excerpt: 'x' } as unknown as HarnessRunSummary['blockers'][number];
      const action = decideNextAction(mkScriptReport(), [blocker], [], [], [], { capabilityBlocked: true });
      assert(action !== 'resolve_capability_inputs_then_rerun', `不得给 capability 动作，action=${action}`);
    },
  },
  {
    name: 't2 next_action：独立 BLOCKER SKIP + blocked → 不返回 capability 动作',
    run: () => {
      const skip = { id: 's', details_excerpt: 'x' } as unknown as HarnessRunSummary['blocking_skips'][number];
      const action = decideNextAction(mkScriptReport(), [], [], [skip], [], { capabilityBlocked: true, effectiveVerdict: 'INCOMPLETE' });
      assert(action !== 'resolve_capability_inputs_then_rerun', `不得给 capability 动作，action=${action}`);
      assert(action === 'resolve_blocking_skips_then_rerun', `action=${action}`);
    },
  },
  {
    name: 't2 next_action：can_claim_done=false + blocked → run_status 动作优先',
    run: () => {
      const rs = { id: 'r', status: 'FAIL', can_claim_done: false, details: 'd' } as unknown as HarnessRunSummary['run_statuses'][number];
      const action = decideNextAction(mkScriptReport(), [], [rs], [], [], { capabilityBlocked: true });
      assert(action === 'fix_run_status_blockers_then_rerun', `action=${action}`);
    },
  },
  {
    name: 't2 next_action：device-external legacy INCOMPLETE → 仍返回 device_ready_then_rerun_*',
    run: () => {
      const report = mkScriptReport({ summary: { total: 0, pass: 0, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'INCOMPLETE' } });
      const action = decideNextAction(report, [], [], [], [], { capabilityBlocked: true });
      assert(action.startsWith('device_ready_then_rerun_'), `action=${action}`);
    },
  },
  // ---- assess ----
  {
    name: 't2 assess：本地 blocked → gap.kind=failed、recommendation=rerun_phase、detail 含 capability/input/attempt/修复动作',
    run: () => {
      const result: AssessResult = assessObservation(observe({
        verdict: 'INCOMPLETE',
        deferred: false,
        blocked_capabilities: [{
          capability: 'capability_spec_requirement',
          axis: 'functional',
          applicability_provider: null,
          applicability_dependencies: [],
          unresolved: [{ input: 'requirement', source: 'derive.requirement', detail: 'requirement 来源缺失：fidelity-intent-init --requirement', dependencies: [] }],
        }],
      }));
      const gap = result.gaps[0];
      assert(gap?.kind === 'failed', `gap.kind=${gap?.kind}`);
      assert(result.recommendation.action === 'rerun_phase', `recommendation=${result.recommendation.action}`);
      assert((gap?.detail ?? '').includes('capability_spec_requirement'), 'detail 含 capability');
      assert((gap?.detail ?? '').includes('input=requirement'), 'detail 含 input');
      assert((gap?.detail ?? '').includes('derive.requirement'), 'detail 含 attempt');
      assert((gap?.detail ?? '').includes('重跑'), 'detail 含修复动作');
      // AssessGap shape 不新增：仅 {phase, kind, detail}
      assert(Object.keys(gap as object).sort().join(',') === 'detail,kind,phase', `AssessGap shape=${Object.keys(gap as object)}`);
      // review P1：blocked_capabilities 是内部诊断数据，不得进入持久化 AssessResult.observed.phases / next.json
      const persisted = result.observed.phases[0] as unknown as Record<string, unknown>;
      assert(!('blocked_capabilities' in persisted), 'AssessResult.observed.phases 不得含 blocked_capabilities（零 schema 扩展）');
      assert(Object.keys(persisted).sort().join(',') === 'assurance,assurance_satisfied,closure,deferred,evidence_fingerprint,phase,required_assurance,schema_version,summary_fingerprint,summary_state,verdict',
        `observed.phases shape=${Object.keys(persisted)}`);
    },
  },
  {
    name: 't2 assess：真 deferred 场景保持 resolve_deferred（INCOMPLETE + deferred=true 不被重分类为 failed）',
    run: () => {
      const result = assessObservation(observe({ verdict: 'INCOMPLETE', deferred: true }));
      const gap = result.gaps[0];
      assert(gap?.kind === 'deferred', `gap.kind=${gap?.kind}`);
      assert(result.recommendation.action === 'resolve_deferred', `recommendation=${result.recommendation.action}`);
    },
  },
  {
    name: 't2 assess（F2 review）：穿 observeFeatureState 生产路径——INCOMPLETE + 本地 blocked capability → deferred=false（走 failed），非全局重分类',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 't2-observe-'));
      try {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 't2-observe', project_profile: { name: 'generic' },
          paths: { features_dir: 'doc/features', reports_dir_pattern: 'doc/features/<feature>/<phase>/reports', docs_committed: false },
        }), 'utf-8');
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
        fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'feature.yaml'), 'schema_version: "1.0"\ntrack: full\n', 'utf-8');
        const repDir = path.join(root, 'doc', 'features', 'demo', 'spec', 'reports');
        fs.mkdirSync(repDir, { recursive: true });
        fs.writeFileSync(path.join(repDir, 'summary.json'), JSON.stringify({
          schema_version: '1.2', phase: 'spec', feature: 'demo', verdict: 'INCOMPLETE',
          blocker_count: 0, fail_count: 0, warn_count: 0, closure_status: 'open',
          next_action: 'resolve_capability_inputs_then_rerun', readiness_signals: [],
          capability_resolutions: [mkBlockedCap('capability_spec_requirement', 'functional')],
          capability_resolution_contract_fingerprint: null,
        }), 'utf-8');
        const obs = observeFeatureState({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo' });
        const specPhase = obs.phases.find((p) => p.phase === 'spec');
        assert(specPhase, 'spec phase observed');
        // 本地 blocked capability → 不判 deferred（走 failed 而非 resolve_deferred）
        assert(specPhase!.deferred === false, `本地 blocked 不应判 deferred，deferred=${specPhase!.deferred}`);
        assert((specPhase!.blocked_capabilities ?? []).some((f) => f.capability === 'capability_spec_requirement'), 'blocked facts 已提取');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't2 assess（F2 review 混合）：external blocker + 本地 blocked 并存 → 保持 deferred（外部阻塞优先，不被本地重分类吞掉）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 't2-observe-mix-'));
      try {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 't2-observe-mix', project_profile: { name: 'generic' },
          paths: { features_dir: 'doc/features', reports_dir_pattern: 'doc/features/<feature>/<phase>/reports', docs_committed: false },
        }), 'utf-8');
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
        fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'feature.yaml'), 'schema_version: "1.0"\ntrack: full\n', 'utf-8');
        const repDir = path.join(root, 'doc', 'features', 'demo', 'spec', 'reports');
        fs.mkdirSync(repDir, { recursive: true });
        fs.writeFileSync(path.join(repDir, 'summary.json'), JSON.stringify({
          schema_version: '1.2', phase: 'spec', feature: 'demo', verdict: 'INCOMPLETE',
          blocker_count: 1, fail_count: 0, warn_count: 0, closure_status: 'open',
          blockers: [{ id: 'device_blocked', severity: 'BLOCKER', status: 'FAIL', blocking_class: 'device_blocked' }],
          capability_resolutions: [mkBlockedCap('capability_spec_requirement', 'functional')],
          capability_resolution_contract_fingerprint: null,
        }), 'utf-8');
        const obs = observeFeatureState({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo' });
        const specPhase = obs.phases.find((p) => p.phase === 'spec');
        assert(specPhase, 'spec phase observed');
        // external/device blocker + 本地 blocked 并存 → 仍 deferred（外部阻塞优先）
        assert(specPhase!.deferred === true, `external blocker 应保持 deferred，deferred=${specPhase!.deferred}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't2 assess（F2 review 混合）：completion_status=deferred + 本地 blocked 并存 → 仍保持 deferred（显式 deferred 不被本地重分类吞掉）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 't2-observe-deferred-'));
      try {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 't2-observe-deferred', project_profile: { name: 'generic' },
          paths: { features_dir: 'doc/features', reports_dir_pattern: 'doc/features/<feature>/<phase>/reports', docs_committed: false },
        }), 'utf-8');
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
        fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'feature.yaml'), 'schema_version: "1.0"\ntrack: full\n', 'utf-8');
        const repDir = path.join(root, 'doc', 'features', 'demo', 'spec', 'reports');
        fs.mkdirSync(repDir, { recursive: true });
        fs.writeFileSync(path.join(repDir, 'summary.json'), JSON.stringify({
          schema_version: '1.2', phase: 'spec', feature: 'demo', verdict: 'INCOMPLETE',
          blocker_count: 0, fail_count: 0, warn_count: 0, closure_status: 'open',
          completion_status: 'deferred',
          capability_resolutions: [mkBlockedCap('capability_spec_requirement', 'functional')],
          capability_resolution_contract_fingerprint: null,
        }), 'utf-8');
        const obs = observeFeatureState({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo' });
        const specPhase = obs.phases.find((p) => p.phase === 'spec');
        assert(specPhase, 'spec phase observed');
        assert(specPhase!.deferred === true, `completion_status=deferred 应保持 deferred，deferred=${specPhase!.deferred}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  // ---- readiness signals ----
  {
    name: 't2 readiness：capability_input_unresolved 按 capability 稳定排序；requirement 专属话术只来自 attempt.detail',
    run: () => {
      const reqDetail = 'fidelity-intent-init --feature <f> --requirement "<文本>"';
      const report = mkScriptReport({
        capability_resolutions: [
          mkBlockedCap('capability_spec_requirement', 'functional', { detail: reqDetail }),
          mkBlockedCap('capability_zzz', 'visual', { requirementSrc: false }),
        ],
      });
      const signals = capabilityBlockedReadinessSignals(report);
      assert(signals.length === 2, `信号数=${signals.length}`);
      assert(signals[0]!.source_check === 'capability_spec_requirement', '按 capability id 稳定排序（spec_requirement < zzz）');
      assert(signals[1]!.source_check === 'capability_zzz', `第二个=${signals[1]!.source_check}`);
      assert((signals[0]!.message ?? '').includes('capability_spec_requirement'), 'message 含 capability');
      assert((signals[0]!.message ?? '').includes('input=requirement source=derive.requirement'), 'message 含 input/attempt');
      // requirement 专属话术只能来自 attempt.detail（req 的 detail 带 fidelity-intent-init）
      assert((signals[0]!.message ?? '').includes('fidelity-intent-init'), 'requirement 建议经 detail 原样带出');
      assert(!(signals[1]!.message ?? '').includes('fidelity-intent-init'), '非 requirement capability 不得夹带专属话术');
    },
  },
  {
    name: 't2 readiness：applicability invalid 的 blocked 展示 provider + 全部 dependency path（review P2）',
    run: () => {
      const report = mkScriptReport({
        capability_resolutions: [{
          id: 'capability_ui_spec_invalid',
          axis: 'functional',
          active: true,
          state: 'blocked',
          on_missing: 'fail',
          applicability_provider_id: 'applicability.ui',
          applicability_dependencies: [{ path: '/p/spec.md', exists: true, sha256: 'a'.repeat(64), role: 'applicability' }],
          inputs: [], // applicability invalid 无普通 input attempt
        }],
      });
      const signals = capabilityBlockedReadinessSignals(report);
      assert(signals.length === 1, `信号数=${signals.length}`);
      const msg = signals[0]!.message ?? '';
      assert(msg.includes('applicability invalid'), 'applicability invalid 分支');
      assert(msg.includes('applicability.ui'), '含 provider');
      assert(msg.includes('/p/spec.md'), '含 applicability dependency path');
    },
  },
  // ---- merged-report ----
  {
    name: 't2 merged-report：blocked 明细可见；requirement 专属建议只来自 provider detail，其它 capability 不出现',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 't2-merged-'));
      try {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 't2-merged',
          project_profile: { name: 'generic' },
          paths: { features_dir: 'doc/features', reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
        }), 'utf-8');
        const reqDetail = 'requirement 来源缺失：fidelity-intent-init --feature <f> --requirement "<文本>"';
        const report = mkScriptReport({
          phase: 'plan',
          capability_resolutions: [
            mkBlockedCap('capability_spec_requirement', 'functional', { detail: reqDetail }),
            mkBlockedCap('capability_nonreq', 'visual', { requirementSrc: false }),
          ],
        });
        const md = generateMergedReport(path.join(FRAMEWORK_ROOT, 'harness'), root, 'plan', 'demo', report, undefined, FRAMEWORK_ROOT);
        assert(md.includes('blocked capability 明细'), 'merged-report 含 blocked 明细段头');
        assert(md.includes('capability_spec_requirement'), '含 req capability');
        assert(md.includes('capability_nonreq'), '含 other capability');
        assert(md.includes('fidelity-intent-init'), 'req 专属话术经 detail 转述');
        // requirement 专属话术只出现在 req capability 的明细块；other capability 的明细块不得含
        const nonreqIdx = md.indexOf('### capability: capability_nonreq');
        const specIdx = md.indexOf('### capability: capability_spec_requirement');
        assert(nonreqIdx >= 0 && specIdx >= 0, '两个 capability 明细块都在');
        const nonreqBlock = nonreqIdx < specIdx
          ? md.slice(nonreqIdx, specIdx)
          : md.slice(specIdx, nonreqIdx);
        const specBlock = md.slice(Math.max(nonreqIdx, specIdx));
        assert(!nonreqBlock.includes('fidelity-intent-init'), 'other capability 明细不得出现 req 专属话术');
        assert(specBlock.includes('fidelity-intent-init'), 'req capability 明细含 req 专属话术');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try { c.run(); return { name: `blocked-capability-projection: ${c.name}`, ok: true }; }
    catch (err) { return { name: `blocked-capability-projection: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message }; }
  });
}