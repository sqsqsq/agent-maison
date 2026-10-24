// design-authority-repair.unit.test.ts — plan 9c3d7e1a：设计权威修复的自动接手与同任务续跑（release-only，真 harness）
//
// 历史绑定宿主用上一版快照 + git 基线；普通 S16 用无旧产物的 fresh CU。run 经公开入口出生，阶段门由真 harness 产出，
// 测试只替代 agent 的产出（lifecycle-evolution 的作者材料）与宿主侧的蓝图升版，不手写事件、不注入 verdict。
//
// plan b0e0621c §3.3：S14–S16 主流程（A2 主线与两个反例、S15 四支、S16 主线与两个绑定失效支、S16-c1）的驱动与断言
// 在本文件导出的流程函数里，注册用例只在 reliability-scenarios 的 S14 / S15 / S16 里——单跑本套件不覆盖它们，
// 本地验证 S14/S15/S16：分别三次 `--filter reliability-scenarios --case "S14 "`、
// `--filter reliability-scenarios --case "S15 "`、`--filter reliability-scenarios --case "S16 "`。
// 历史作者前缀使用 lifecycle-evolution 的缓存；普通 S16 从 fresh 请求出生，旧绑定分支按实际 owner 续跑或起后继。

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath, relFeaturesDir } from '../../config';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { designRepairAttempted, runUnattendedDesignRepair } from '../../scripts/utils/design-repair-unattended';
import { foldBudgetLineage, loadAuthoritativeEvents, resolveResumedBudget } from '../../scripts/utils/goal-runner-phase';
import { readBoundInput } from '../../scripts/utils/capability-resolution';
import {
  BLUEPRINT_RECONCILE_LOCK_NAME, RECONCILE_BUSY_HINT, deriveDesignPreparationReadiness, reconcileChangeUnitBlueprintRefs,
} from '../../scripts/utils/change-unit-design-preparation';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit, pointerStaleCandidate } from '../../scripts/utils/change-unit-path';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { checkAuthoritativeContentAligned, classifyDesignAuthorityCodes, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { blueprintReviewPath, inspectBlueprintReview } from '../../scripts/utils/blueprint-review-materialization';
import { blockerIssues, validateComponentBlueprint, validateComponentBlueprintUpstream } from '../../scripts/utils/component-blueprint-validator';
import { deriveBlueprintAdmission } from '../../scripts/utils/blueprint-admission';
import { featureScopeCandidateFingerprint, prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { createGoalRun, decideRunContinuation, loadEffectiveExecutionScope, staleFrozenBindings } from '../../scripts/utils/goal-run-creation';
import { freezeFeatureExecutionScope, readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { runConditionProbe } from '../../scripts/utils/condition-wait';
import * as supervise from '../../scripts/goal-supervise';
import { __testing_setLockHeartbeatMs, lockHeartbeatIntervalMs } from '../../scripts/goal-phase-runtime';
import { __testing_setPidProbeExecutor } from '../../scripts/utils/goal-containment-reconcile';
import { livenessBeaconPath, writeLivenessBeacon } from '../../scripts/utils/liveness-beacon';
import { requestVia, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { publishVerifier, writeCuFacts, writeCuSpecDraft, writeCuSpecMaterials, writeCuPlanMaterials, writeCuCodingMaterials, writeCuReviewMaterials, writeCuUtMaterials } from './real-chain.unit.test';
import { FEATURE_LOCK_NAME, releaseLock, touchLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { evaluateDeviceReadinessProbe, runDeviceReadinessGate } from '../../scripts/utils/device-readiness-gate';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext } from '../../scripts/utils/types';
import { SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { authorCurrentCuPlan, handWriteProjections } from './component-design-handoff.unit.test';
import {
  BLUEPRINT_ID, assess, authorHooks, brief, bumpBlueprint, cachedPrefix, commit, handWrittenCompletion, prepareFreshCuRequest, project, specFirstCuHooks, successorChain, withFreshCuHost, withHost, withSnapshot,
} from './lifecycle-evolution.unit.test';
import { NEW_EXPECTED_RESULT, changeProjectedAcceptance, readJson, runFile, runIds, supersede } from './successor-exit.unit.test';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, SelectedUnitCases, UnitExecutionTiming } from '../utils/unit-case-selection';

type Snapshot = Parameters<Parameters<typeof withHost>[0]>[0];
type Ev = Record<string, any>;
const CU = 'ledger-refresh';
const SIBLING = 'ledger-summary';

/** run 有效范围里全部输入绑定逐条经生产 readBoundInput 复读：ids = 绑定的 input_id，stale = 读不回来的。 */
export function boundInputs(s: Snapshot, feature: string, runId: string): { ids: string[]; stale: string[] } {
  clearFrameworkConfigCache();
  const scope = loadEffectiveExecutionScope(s.root, feature, runId);
  assert(scope, `run ${runId} 没有有效范围`);
  const bindings = scope!.obligations.flatMap(o => [...o.basis, ...(o.satisfied_by ?? [])])
    .filter((ref): ref is Parameters<typeof readBoundInput>[1] => 'input_id' in ref);
  const stale = bindings.flatMap(binding => {
    try {
      readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: 'coding', track: 'full' }, binding);
      return [];
    } catch (error) { return [`${binding.input_id}: ${(error as Error).message}`]; }
  });
  return { ids: [...new Set(bindings.map(b => b.input_id))].sort(), stale: [...new Set(stale)].sort() };
}

const blueprintFile = (s: Snapshot): string => path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), 'blueprint', 'component-blueprint.yaml');
const eventsOf = (s: Snapshot, feature: string, runId: string): Ev[] =>
  fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Ev);
const featureLockPath = (s: Snapshot, changeUnitId: string): string =>
  featureFilePath(s.root, deriveChangeUnitFeatureId(BLUEPRINT_ID, changeUnitId), path.join('goal-runs', FEATURE_LOCK_NAME));
const cuBytes = (s: Snapshot): Record<string, string> => Object.fromEntries(enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID)
  .map(u => [String(u.changeUnit.change_unit_id), u.artifactSha256]));
const pointsAtCurrentBlueprint = (s: Snapshot, changeUnitId: string): boolean => {
  const ref = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, changeUnitId).changeUnit.component_blueprint_ref as { revision?: number; artifact_sha256?: string };
  const current = loadCanonicalBlueprint(s.root, BLUEPRINT_ID);
  return ref.revision === Number(current.blueprint.revision) && ref.artifact_sha256 === current.artifactSha256;
};
const checkCtx = (s: Snapshot, feature: string): CheckContext => {
  clearFrameworkConfigCache();
  return { projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phaseRule: {}, featureSpec: new SpecLoader(s.root, undefined, undefined, s.frameworkRoot).loadFeatureSpec(feature) } as unknown as CheckContext;
};

/** 宿主里已存在、CU 事实已覆盖、但原施工契约未授权的文件：蓝图升版把它加进授权写集（plan 责任方据此对齐 contracts）。 */
const NEW_CONTRACT_FILE = 'src/ledger/LedgerSourceSeam.ts';
function ledgerDomain(bp: Record<string, unknown>): Ev {
  let hit: Ev | undefined;
  const visit = (v: unknown): void => {
    if (hit || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if ((v as { node_id?: string }).node_id === 'ledger-domain') { hit = v as Ev; return; }
    Object.values(v).forEach(visit);
  };
  visit(bp);
  assert(hit, '快照蓝图缺 ledger-domain');
  return hit!;
}
export interface StaleRun { successor: string; events: Ev[]; error?: string; planInvokes: number; injected: boolean }

/**
 * S14 的公共主线：手写派生文件下的完成 run（宿主原始完成的替身）→ 蓝图升版改验收并调和、提交 → 公开入口 `--supersede`
 * **真实出生**后继（出生时冻结的是当时的绑定）→ spec 过门之后、plan 首轮进行中，设计 owner 把蓝图再升一个 admitted revision
 *（只写蓝图，不调调和器）→ plan 的真实门报指针过期。`atInjection` 在升版的同时追加反例的宿主状态；
 * `onFirstPlan` 在 plan 首轮 agent 窗口内执行（此时运行时持有本 feature 的锁）。
 */
async function runWithStalePointerAtPlan(s: Snapshot, opts: {
  atInjection?: () => void;
  onFirstPlan?: () => void;
  /** plan 的 agent 每一轮写完常规材料之后追加的写入（作者材料的一部分）。 */
  afterPlanWrites?: () => void;
  afterRun?: () => void;
} = {}): Promise<StaleRun> {
  const feature = SNAPSHOT_CU_FEATURE;
  const p = project(s, feature);
  const { predict, completed } = await handWrittenCompletion(s);
  // 出生链要含 spec 与 plan：蓝图升版同时改进投影的验收（spec 对齐）与施工契约（plan 对齐）。
  bumpBlueprint(s, bp => { changeProjectedAcceptance(bp); ledgerDomain(bp).contracts.files.push(NEW_CONTRACT_FILE); });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint rev3 admitted');
  const expected = predict(completed);
  assert(expected[0] === 'spec' && expected.includes('plan'), `前提：出生链含 spec 与 plan：${JSON.stringify(expected)}`);
  const hooks = specFirstCuHooks(p, true);
  // 作者材料来自注入故障前仍有效的设计输入；故意坏掉的窗口由真实 gate 判断，不让 provider assert 抢先中断。
  const approved = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'contracts');
  assert.strictEqual(approved.state, 'resolved', approved.detail);
  const approvedAcceptance = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
  assert.strictEqual(approvedAcceptance.state, 'resolved', approvedAcceptance.detail);
  const approvedContracts = structuredClone(approved.value) as Ev;
  const approvedCases = structuredClone(approved.artifacts?.['use-cases@1']) as Ev | undefined;
  let injected = false;
  let planInvokes = 0;
  const before = new Set(runIds(s.root, feature));
  const next = await supersede(s, feature, completed, expected, {
    ...hooks,
    onSpec: ctx => {
      writeDoc(featureFilePath(s.root, feature, 'acceptance.yaml'), { ...(structuredClone(approvedAcceptance.value) as Ev), source: 'spec:approved-ledger-design' });
      p.runId = ctx.runId; writeCuFacts(p, 'spec');
      if (ctx.attempt > 1) publishVerifier(p, 'spec');
    },
    onPlan: ctx => {
      planInvokes += 1;
      // spec 已过门、run 的绑定已冻结；plan 首轮进行中，设计 owner 在另一会话把蓝图升了一个 admitted revision（run 外动作）。
      if (ctx.attempt === 1) {
        injected = true;
        bumpBlueprint(s);
        opts.atInjection?.();
        clearFrameworkConfigCache();
        opts.onFirstPlan?.();
      }
      const authored = { ...authorCurrentCuPlan(s.root, approvedContracts), source: 'plan:approved-ledger-design' };
      writeDoc(featureFilePath(s.root, feature, 'contracts.yaml'), authored);
      if (approvedCases) writeDoc(featureFilePath(s.root, feature, 'use-cases.yaml'), { ...approvedCases, source: 'plan:approved-ledger-design' });
      p.runId = ctx.runId; writeCuFacts(p, 'plan');
      if (ctx.attempt > 1) publishVerifier(p, 'plan');
      opts.afterPlanWrites?.();
    },
  });
  opts.afterRun?.();
  assert(next.successor, `后继未出生：${next.error}`);
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  assert.deepStrictEqual(born, [next.successor], `全程只应出生一个 run：${JSON.stringify(born)}`);
  return { successor: next.successor!, events: eventsOf(s, feature, next.successor!), planInvokes, injected, ...(next.error ? { error: next.error } : {}) };
}

export type S14Key = 'in-run-reconcile' | 'counter-own-skipped' | 'counter-sibling-skipped';
/** S14 三支在升版同时追加的宿主状态（本套件与 reliability-scenarios 共用同一驱动）。 */
function s14Injection(s: Snapshot, key: S14Key): (() => void) | undefined {
  // 反例一：新蓝图里本 CU 的设计闭包有未决项 → 调和器 carry-forward 不过、跳过本 CU。
  if (key === 'counter-own-skipped') return () => {
    const bp = YAML.parse(fs.readFileSync(blueprintFile(s), 'utf8'));
    ledgerDomain(bp).knowledge_state = 'unknown';
    fs.writeFileSync(blueprintFile(s), YAML.stringify(bp));
  };
  // 反例二：兄弟 CU 三处指针身份不一致（契约变化）→ 调和器只跳过它。
  if (key === 'counter-sibling-skipped') return () => {
    const sibling = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING);
    const doc = YAML.parse(sibling.bytes.toString('utf8'));
    doc.touches[0].design_ref.revision = Number(doc.touches[0].design_ref.revision) + 40;
    fs.writeFileSync(sibling.canonicalPath, YAML.stringify(doc));
  };
  return undefined;
}
/**
 * S14 三支的驱动与机制断言（plan b0e0621c §3.3：原 A2 主线与两个反例的注册用例并入这里，只在 reliability-scenarios 里跑）。
 *  · in-run-reconcile（原 A2 主线）：plan 首轮窗口内另一会话的 readiness 竞争退出；同一 run 内调和、plan 原地重评、任务完成；
 *  · counter-own-skipped（原 A2 反例一）：本 CU 被调和器跳过 → 不重评，落回设计 owner 停机，说明含跳过原因，不宣称完成；
 *  · counter-sibling-skipped（原 A2 反例二）：兄弟 CU 被跳过（三处指针不一致）→ 本 run 续跑并完成，跳过只在事件里披露。
 */
export async function s14Run(s: Snapshot, key: S14Key): Promise<StaleRun> {
  const feature = SNAPSHOT_CU_FEATURE;
  const atInjection = s14Injection(s, key);
  let interleave: { busy?: string; ready: boolean; unchanged: boolean } | undefined;
  const run = await runWithStalePointerAtPlan(s, {
    ...(atInjection ? { atInjection } : {}),
    // A4 交错反例：run 正持本 feature 的锁跑 plan——另一会话的 readiness 调和必须竞争退出，不得按旧快照写。
    ...(key === 'in-run-reconcile' ? { onFirstPlan: () => {
      const before = cuBytes(s);
      const contracts = fs.readFileSync(featureFilePath(s.root, feature, 'contracts.yaml'));
      const readiness = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      interleave = {
        busy: readiness.blueprintRefs.busy, ready: readiness.ready,
        unchanged: JSON.stringify(cuBytes(s)) === JSON.stringify(before) && fs.readFileSync(featureFilePath(s.root, feature, 'contracts.yaml')).equals(contracts),
      };
    } } : {}),
  });
  console.log(`[design-authority-repair] S14/${key} ${describeRun(run)} interleave=${JSON.stringify(interleave)}`);
  const [repair, ...rest] = repairs(run);
  if (key === 'counter-own-skipped') {
    assert(repair && repair.outcome === 'not_reconciled' && repair.skipped.some((x: Ev) => x.change_unit_id === CU) && !repair.bumped.length, describeRun(run));
    assert.strictEqual(run.planInvokes, 1, '本 CU 被跳过时不得重评');
    const halt = lastHalt(run);
    assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.phase === 'plan', describeRun(run));
    assert(/本 CU 被调和器跳过/.test(String(halt!.halt_guidance)) && /ledger-domain/.test(String(halt!.halt_guidance)), `说明须含跳过原因：${halt!.halt_guidance}`);
    assert(!pointsAtCurrentBlueprint(s, CU), '被跳过的 CU 不得被改写');
    const final = assess(s, feature);
    assert(!final.complete && !(final.record.state !== 'absent' && final.record.run_id === run.successor), `不得宣称完成：${brief(final)}`);
    return run;
  }
  if (key === 'counter-sibling-skipped') {
    assert(repair && repair.outcome === 'reconciled' && repair.bumped.some((b: Ev) => b.change_unit_id === CU)
      && repair.skipped.some((x: Ev) => x.change_unit_id === SIBLING && /blueprint_ref_identity_inconsistent/.test(x.reasons.join(' '))), describeRun(run));
    assert(!run.events.some(e => e.type === 'phase_halt' && e.halt_reason === 'execution_scope_unresolved'), describeRun(run));
    const final = assess(s, feature);
    assert(final.complete && final.record.state !== 'absent' && final.record.run_id === run.successor, `兄弟 CU 的跳过不得让本 run 停下：${brief(final)}\n${describeRun(run)}`);
    return run;
  }
  assert(run.injected, '前提：升版已在 spec 之后注入');
  assert(interleave?.busy?.includes(RECONCILE_BUSY_HINT) && interleave.ready === false && interleave.unchanged, `run 持锁期间 readiness 应报忙且零写入：${JSON.stringify(interleave)}`);
  assert(repair && !rest.length && repair.phase === 'plan' && repair.action === 'pointer_reconcile' && repair.outcome === 'reconciled'
    && repair.blueprint_id === BLUEPRINT_ID && repair.bumped.some((b: Ev) => b.change_unit_id === CU), describeRun(run));
  // plan 只有一轮 FAIL（指针过期），调和后原地重评即 PASS；其后的 PASS:retry 是既有的闭环补轮，与本修复无关。
  assert.deepStrictEqual(run.events.filter(e => e.type === 'phase_verdict' && e.phase === 'plan').map(e => `${e.verdict}:${e.action}`),
    ['FAIL:retry', 'PASS:retry', 'PASS:advance'], `plan 应原地重评一次：${describeRun(run)}`);
  assert(!run.events.some(e => e.type === 'phase_halt' && e.halt_reason === 'execution_scope_unresolved'), `不得停机等设计 owner：${describeRun(run)}`);
  assert(!run.error, `run 应正常结束：${describeRun(run)}`);
  // 写边界记账如实：调和是框架动作，发生在两次 agent 调用之间——canonical CU 不得被记成任何一次 agent 调用的写入。
  const attributed = run.events.filter(e => e.type === 'phase_write_observed' || e.type === 'phase_write_violation')
    .flatMap(e => [...(e.owned ?? []), ...(e.observations ?? []), ...(e.violations ?? [])] as Ev[]).map(row => String(row.path));
  assert(!attributed.some(p => p.endsWith('change-unit.yaml')), `CU 指针升版不得归因给 agent：${JSON.stringify(attributed)}`);
  const report = fs.readFileSync(runFile(s.root, feature, run.successor, 'goal-report.md'), 'utf8');
  assert(/设计侧修复.*pointer_reconcile.*本 CU 指针已原位升版/.test(report), 'goal 报告应渲染设计侧修复事件');
  assert(pointsAtCurrentBlueprint(s, CU), 'CU 指针应已指向当前蓝图');
  const final = assess(s, feature);
  assert(final.complete && final.record.state !== 'absent' && final.record.run_id === run.successor, `任务应在同一 run 完成：${brief(final)}\n${describeRun(run)}`);
  assert.deepStrictEqual(boundInputs(s, feature, run.successor).stale.filter(x => !x.startsWith('codebase:')), [], '同一 run 的设计类绑定在调和后仍有效');
  return run;
}

const repairs = (run: StaleRun): Ev[] => run.events.filter(e => e.type === 'design_authority_repair' && e.action === 'pointer_reconcile');
const lastHalt = (run: StaleRun): Ev | undefined => run.events.filter(e => e.type === 'phase_halt').at(-1);
const runEnd = (run: StaleRun): Ev | undefined => run.events.filter(e => e.type === 'run_end').at(-1);
const describeRun = (run: StaleRun): string => JSON.stringify({
  error: run.error, injected: run.injected, planInvokes: run.planInvokes, repairs: repairs(run), halt: lastHalt(run), end: runEnd(run),
  verdicts: run.events.filter(e => e.type === 'phase_verdict').map(e => `${e.phase}:${e.verdict}:${e.action ?? ''}`),
});

// ---- S15：B 类停机 → 修好 → 自动续跑 -------------------------------------------------------------
//
// 两种宿主形状：
//  · 全手写（宿主原始形状）：acceptance / contracts / use-cases 都是手写无戳文件，绑定是 artifact——蓝图内容变化后
//    由 spec / plan 在链内改写、经范围修订重签，所以修好后重新接入同一 run。
//  · 派生施工契约：acceptance 手写、contracts / use-cases 不落盘，施工契约绑定来自 `derive.blueprint-contracts`——
//    没有责任阶段能重签；修复改了它依赖的蓝图内容时同一 run 续不下去，要自动起后继。

const TEXT_ACCEPTANCE = '验收写成了一段文本';
/** 施工契约写成了文字，原文写明授权写集在原有文件之外还包括 NEW_CONTRACT_FILE（绑定失效支的原文依据）。 */
const TEXT_CONTRACTS = `施工契约写成了一段文本：模块、接口与测试映射照旧，授权写集在原有文件之外还包括 ${NEW_CONTRACT_FILE}`;
const reportDirOf = (s: Snapshot, feature: string, runId: string): string => path.relative(s.root, path.dirname(runFile(s.root, feature, runId, 'events.jsonl'))).replace(/\\/g, '/');
const haltOf = (events: Ev[]): Ev | undefined => events.filter(e => e.type === 'phase_halt').at(-1);
const endOf = (events: Ev[]): Ev | undefined => events.filter(e => e.type === 'run_end').at(-1);
const verdictsOf = (events: Ev[]): string[] => events.filter(e => e.type === 'phase_verdict').map(e => `${e.phase}:${e.verdict}:${e.action ?? ''}`);
const invokesOf = (events: Ev[], phase: string): number => events.filter(e => e.type === 'agent_invoke_start' && e.phase === phase).length;
const sha = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const restoreNode = (node: Ev, saved: Ev): void => { for (const key of Object.keys(node)) delete node[key]; Object.assign(node, structuredClone(saved)); };

/** 场景侧（reliability-scenarios）如实记下的人为动作：设计修复 / 有权者裁决 / 重新发起同一请求。 */
export interface RepairIntervention { kind: 'manual_file_edit' | 'product_decision' | 'rescue_command'; content: string; necessary: boolean; related_events?: Array<{ run_id: string; event_index: number }> }
export interface RepairFlow {
  feature: string;
  /** 本任务的全部 run（出生顺序）：停机的 run，以及框架自动起的后继。 */
  runs: string[];
  halted?: string;
  /** 停机事件在停机 run 事件流里的下标（扰动点）。 */
  haltIndex?: number;
  haltClass: string;
  interventions: RepairIntervention[];
  evidence: string;
}
interface Halted { feature: string; completed?: string; halted: string; requirement: string; request: { start: string; end: string }; chain: string[]; events: Ev[]; saved: Ev; birthManifest?: Buffer; oldContractsBinding?: Parameters<typeof readBoundInput>[1]; oldContractsStale?: boolean; planAuthored?: boolean }

/** Preparing a design input is not a runtime Research invocation. Keep any real facts unchanged. */
function prepareSpecInput(s: Snapshot, write: (p: ReturnType<typeof project>) => void): void {
  const p = project(s, SNAPSHOT_CU_FEATURE);
  const file = featureFilePath(s.root, p.feature, 'context/facts.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  try { write(p); }
  finally {
    if (before) fs.writeFileSync(file, before);
    else fs.rmSync(file, { force: true });
  }
  assert(before ? fs.readFileSync(file).equals(before) : !fs.existsSync(file), '出生前准备只能保留已有真实facts，不得制造未执行阶段的建立身份');
}
/** 任务的原请求：上一次完成的 run 冻结的需求与起止（停机的 run 是它的后继，属于同一任务）。 */
const originalRequest = (s: Snapshot, feature: string, completed: string): Pick<Halted, 'requirement' | 'request'> => {
  const manifest = readJson<{ requirement: string; start_phase: string; end_phase: string }>(runFile(s.root, feature, completed, 'manifest.json'));
  return { requirement: manifest.requirement, request: { start: manifest.start_phase, end: manifest.end_phase } };
};

/** 有效设计与未对齐作者草稿形成真实 A1 gap；resolver 选择 spec，施工输入尚为 derive。 */
function prepareDerivedSpecRequest(s: Snapshot): { requirement: string; chain: string[]; contractsBinding: Parameters<typeof readBoundInput>[1] } {
  const feature = SNAPSHOT_CU_FEATURE;
  prepareSpecInput(s, writeCuSpecDraft);
  bumpBlueprint(s, changeProjectedAcceptance);
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'design owner updates acceptance; author draft has a real A1 gap');
  const request = prepareFreshCuRequest(s);
  assert.strictEqual(request.chain[0], 'spec', `实际 A1 gap 必须由 spec 承担：${JSON.stringify(request.chain)}`);
  const scope = readFeatureFrozenScope(s.root, feature)!.execution_scope;
  const refs = scope.obligations.flatMap(o => [...o.basis, ...(o.satisfied_by ?? [])]);
  const binding = refs.find((ref): ref is Parameters<typeof readBoundInput>[1] => 'input_id' in ref && ref.input_id === 'contracts'
    && ref.source.kind === 'derive' && ref.source.provider_id === 'derive.blueprint-contracts');
  assert(binding, '施工绑定必须来自真实冻结的 derive 输入');
  for (const name of ['contracts.yaml', 'use-cases.yaml']) assert(!fs.existsSync(featureFilePath(s.root, feature, name)), `${name} 尚未由 plan 交付`);
  return { ...request, contractsBinding: structuredClone(binding!) };
}
const boundSources = (s: Snapshot, feature: string, runId: string): string[] => {
  clearFrameworkConfigCache();
  const scope = loadEffectiveExecutionScope(s.root, feature, runId)!;
  return [...new Set(scope.obligations.flatMap(o => [...o.basis, ...(o.satisfied_by ?? [])]).filter((b): b is Parameters<typeof readBoundInput>[1] => 'input_id' in b)
    .map(b => `${b.input_id}<-${b.source.kind === 'artifact' ? b.source.artifact : b.source.provider_id}`))];
};

/**
 * 复用已验证的 fresh B1 入场：无旧物化产物，首 spec 新建作者草稿，真实门首次即停；没有伪造完成祖先。
 */
async function haltBornInvalid(s: Snapshot): Promise<Halted> {
  const b = await s16Born(s, { preauth: false, extra: { viaHostBridge: true } });
  return { feature: b.feature, halted: b.runId, requirement: b.requirement, request: b.request, chain: b.chain, events: b.events, saved: b.saved };
}

/**
 * run 出生并冻结绑定之后才出问题：蓝图先升到改了投影验收的 admitted revision（调和、提交）→ `--supersede` 真实出生后继 →
 * spec 首轮进行中，设计 owner 在另一会话把蓝图再升一个 revision 并写坏内容（只写蓝图，不调调和器）。
 */
async function haltAfterBirthAtSpec(s: Snapshot, completed: string | undefined, corrupt: (node: Ev) => void, extra: (saved: () => Ev | undefined) => Record<string, unknown> = () => ({})): Promise<Halted> {
  const feature = SNAPSHOT_CU_FEATURE;
  const fresh = completed ? undefined : prepareDerivedSpecRequest(s);
  if (completed) {
    bumpBlueprint(s, changeProjectedAcceptance);
    const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
    commit(s, 'blueprint rev3 admitted');
  }
  const chain = completed ? successorChain(s, feature, completed) : fresh!.chain;
  assert(chain[0] === 'spec', `前提：出生链从 spec 开始：${JSON.stringify(chain)}`);
  const p = project(s, feature);
  const hooks = specFirstCuHooks(p, true);
  let saved: Ev | undefined;
  let specDraft: Ev | undefined;
  let birthManifest: Buffer | undefined;
  let oldContractsStale = false;
  let planAuthored = false;
  const authors = {
    ...hooks, noAutoForce: true,
    onSpec: (ctx: { runId: string; attempt: number }): void => {
      birthManifest ??= fs.readFileSync(runFile(s.root, feature, ctx.runId, 'manifest.json'));
      if (!completed) {
        if (!specDraft) {
          const input = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
          assert.strictEqual(input.state, 'resolved', input.detail);
          specDraft = { ...(structuredClone(input.value) as Ev), source: 'spec:fixture-ledger-request' };
        }
        p.runId = ctx.runId; writeDoc(featureFilePath(s.root, feature, 'acceptance.yaml'), specDraft); writeCuFacts(p, 'spec');
        if (ctx.attempt > 1) publishVerifier(p, 'spec');
      }
      if (!saved) {
        bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); corrupt(node); });
        clearFrameworkConfigCache();
      }
      if (completed) hooks.onSpec(ctx);
    },
    onPlan: (ctx: { runId: string; attempt: number }): void => {
      if (fresh && !planAuthored) {
        assert.throws(() => readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature,
          phase: 'plan', track: 'full' }, fresh.contractsBinding), /input binding stale/);
        oldContractsStale = true;
      }
      hooks.onPlan(ctx);
      planAuthored = ['contracts.yaml', 'use-cases.yaml'].every(name => fs.existsSync(featureFilePath(s.root, feature, name)));
    },
    ...extra(() => saved),
  };
  const before = new Set(runIds(s.root, feature));
  let error: string | undefined;
  if (completed) {
    const next = await supersede(s, feature, completed, chain, authors);
    assert(next.successor, `后继未出生：${next.error}`);
    error = next.error;
  } else {
    const next = await runGoalRuntimeChain(s.root, { frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex',
      freshRequirement: fresh!.requirement, freshStartPhase: 'spec', freshEndPhase: chain[chain.length - 1], ...authors });
    if (next.exitCode) error = `exit=${next.exitCode}`;
  }
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  assert(born.length === 1 && saved, `run 未出生或未注入：${error} ${JSON.stringify(born)}`);
  const request = completed ? originalRequest(s, feature, completed)
    : { requirement: fresh!.requirement, request: { start: chain[0], end: chain[chain.length - 1] } };
  return { feature, ...(completed ? { completed } : {}), halted: born[0], ...request, chain, events: eventsOf(s, feature, born[0]), saved: saved!, birthManifest, oldContractsStale, planAuthored,
    ...(fresh ? { oldContractsBinding: fresh.contractsBinding } : {}) };
}

/** 设计 owner / 有权者（测试替身）改蓝图：升一个 revision、改内容，然后经**真实 readiness 入口**调和（要取蓝图锁与 feature 锁）并提交。 */
function repairViaReadiness(s: Snapshot, mutate: (node: Ev) => void, message?: string): void {
  bumpBlueprint(s, bp => mutate(ledgerDomain(bp)));
  clearFrameworkConfigCache();
  const readiness = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
  assert(!readiness.blueprintRefs.busy, `停放的 run 不得挡住设计 owner 的 readiness 调和：${readiness.blueprintRefs.busy}`);
  assert(readiness.blueprintRefs.bumped.some(b => b.change_unit_id === CU) && !readiness.blueprintRefs.skipped.some(x => x.change_unit_id === CU), JSON.stringify(readiness.blueprintRefs));
  if (message) commit(s, message);
  clearFrameworkConfigCache();
}

/**
 * 续跑 / 后继的作者材料（agent 产出的替身），按当前 run 的出生链选写法：
 *  · 链首是 spec：spec 责任方按当前权威对齐 acceptance，事实基线由 spec 建立（specFirstCuHooks）；
 *  · 链首是 coding（验收已对齐、后继只补后面的缺口）：上一个 run 的 spec 没过门，它写的事实基线未经验证——
 *    由本 run 的首个阶段重新建立事实（真实 agent 的做法），其余与 CU 源链相同。
 * 驱动层的 attempt 计数按一次调用重置，首轮按"非首轮"补 verifier 报告（publishVerifier 对没有 subject 的阶段是空操作）。
 */
function authorsForContinuation(s: Snapshot, feature: string): Record<string, unknown> {
  const p = project(s, feature);
  const specLed = specFirstCuHooks(p, true);
  const codingLed = authorHooks(p, { coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials });
  const chainHead = (runId: string): string => readJson<{ chain_override?: string[] }>(runFile(s.root, feature, runId, 'manifest.json')).chain_override?.[0] ?? '';
  const reestablished = new Set<string>();
  const hook = (key: 'onSpec' | 'onPlan' | 'onCoding' | 'onReview' | 'onUt' | 'onTesting') => (ctx: { runId: string; attempt: number; phase: string }): void => {
    const bySpec = chainHead(ctx.runId) === 'spec';
    if (!bySpec && !reestablished.has(ctx.runId)) {
      reestablished.add(ctx.runId);
      fs.rmSync(featureFilePath(s.root, feature, 'context/facts.md'), { force: true });
    }
    if (key === 'onSpec' && deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance').state !== 'resolved') {
      p.runId = ctx.runId;
      writeCuSpecDraft(p);
    } else (bySpec ? specLed : codingLed)[key](ctx);
    if (ctx.attempt === 1) publishVerifier(p, ctx.phase);
  };
  return { realHarness: true, failExecutorFor: undefined, onSpec: hook('onSpec'), onPlan: hook('onPlan'), onCoding: hook('onCoding'), onReview: hook('onReview'), onUt: hook('onUt'), onTesting: hook('onTesting') };
}

/** 重新发起同一请求：任务原请求的需求与起止，不带任何旗标（noAutoForce），不回拨事件时间。返回退出码与本次新出生的 run。 */
async function resend(s: Snapshot, h: Halted): Promise<{ exitCode: number; born: string[] }> {
  const before = new Set(runIds(s.root, h.feature));
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: h.feature, adapter: 'codex', freshRequirement: h.requirement,
    freshStartPhase: h.request.start as 'spec', freshEndPhase: h.request.end, noAutoForce: true, ...authorsForContinuation(s, h.feature),
  });
  clearFrameworkConfigCache();
  return { exitCode: probe.exitCode, born: runIds(s.root, h.feature).filter(id => !before.has(id)) };
}

/** 以生产 supervisor CLI 真跑一轮（真实探针）；spawn 注入只记录它发出的 runner 参数。beacon 删掉 = 停放 run 的进程已不在。 */
export async function superviseOnce(s: Snapshot, feature: string, runId: string): Promise<{ code: number; spawned: string[][] }> {
  const spawned: string[][] = [];
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  fs.rmSync(livenessBeaconPath(s.root, reportDirOf(s, feature, runId)), { force: true });
  try {
    supervise.__testing_setSpawnImpl((_file, args) => { spawned.push(args.slice(2)); return { pid: 4242, unref: () => undefined } as never; });
    process.argv = ['node', 'goal-supervise.ts', '--feature', feature, '--run-id', runId, '--project-root', s.root];
    process.chdir(s.root);
    clearFrameworkConfigCache();
    return { code: await supervise.__testing_main(), spawned };
  } finally {
    supervise.__testing_setSpawnImpl(null);
    process.argv = prevArgv;
    try { process.chdir(prevCwd); } catch { /* ignore */ }
  }
}

/** 设计 owner 停机的共同断言（B1 验收）：首次即停、带探针与分类 / 简报、run_end 同源带探针、feature 锁已释放、冷却期内。 */
function assertDesignOwnerHalt(s: Snapshot, h: Halted, expected: { cls: 'B1' | 'B2'; codes: string[]; phase: string }): { halt: Ev; haltIndex: number } {
  const haltIndex = h.events.map(e => e.type).lastIndexOf('phase_halt');
  const halt = h.events[haltIndex];
  assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.phase === expected.phase, `应以设计 owner 出口停机：${JSON.stringify(verdictsOf(h.events))} ${JSON.stringify(halt)}`);
  assert(halt.probe === 'design_authority_projectable' && halt.run_disposition === 'WAITING' && halt.run_wait_kind === 'external', `停机事件须带探针并落外部等待：${JSON.stringify(halt)}`);
  const brief_ = halt.design_authority as { class: string; items: Array<{ check: string; codes: string[]; class: string; artifacts: string[]; basis: string; needs: string[] }> };
  assert(brief_?.class === expected.cls && brief_.items.length > 0, `分类应为 ${expected.cls}：${JSON.stringify(brief_)}`);
  assert.deepStrictEqual(brief_.items.flatMap(item => item.codes), expected.codes, '修复简报的原因码');
  for (const item of brief_.items) {
    assert(item.check && item.basis && item.needs.length && item.artifacts.every(file => fs.existsSync(path.join(s.root, file))), `简报须写明检查、依据、缺什么与要修的产物：${JSON.stringify(item)}`);
  }
  const guidance = String(halt.halt_guidance);
  assert(guidance.includes(`分类：${expected.cls}`) && guidance.includes('修复简报') && brief_.items.every(item => guidance.includes(item.check) && item.needs.every(need => guidance.includes(need))), `停机说明须带分类与简报：${guidance}`);
  const end = endOf(h.events);
  assert(end?.status === 'HALTED' && end.probe === 'design_authority_projectable' && end.probe_phase === expected.phase, `run_end 须同源带探针与责任阶段：${JSON.stringify(end)}`);
  assert(!fs.existsSync(featureLockPath(s, CU)), '停放时须已释放本 run 的 feature 锁');
  assert(Date.now() - Date.parse(String(end.ts)) < 5 * 60_000, '前提：整个修复与重发都在冷却期内（不回拨事件时间）');
  return { halt, haltIndex };
}

function assertCompletedBy(s: Snapshot, feature: string, runId: string, label: string): void {
  const events = eventsOf(s, feature, runId);
  const final = assess(s, feature);
  assert(endOf(events)?.status === 'CHAIN_SLICE_COMPLETED' && final.complete && final.record.state !== 'absent' && final.record.run_id === runId,
    `${label}：任务应由 run ${runId} 正确完成：${JSON.stringify(verdictsOf(events))} halt=${JSON.stringify(haltOf(events)?.reason)} end=${JSON.stringify(endOf(events))}\n${brief(final)}`);
  const onDisk = YAML.parse(fs.readFileSync(featureFilePath(s.root, feature, 'acceptance.yaml'), 'utf8')) as { criteria: Array<{ id: string; expected_result: string }> };
  const authoritative = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
  assert.strictEqual(authoritative.state, 'resolved', `${label}：当前验收权威必须可用：${authoritative.detail}`);
  const expected = (authoritative.value as Ev).criteria.find((c: Ev) => c.id === 'AC-1')?.expected_result;
  assert.strictEqual(typeof expected, 'string', `${label}：当前权威须声明 AC-1 的 expected_result`);
  assert.strictEqual(onDisk.criteria.find(c => c.id === 'AC-1')?.expected_result, expected, `${label}：最终验收应是当前设计权威的文本`);
}

/** S15 B1（绑定仍有效）+ 反例"未修就重发"：现有无效例停机 → 未修重发保持停止 → 设计 owner 修 → 冷却期内重发 → 重新接入同一 run 并完成。 */
export async function s15RejoinFlow(s: Snapshot, opts: { repair?: boolean } = {}): Promise<RepairFlow> {
  const h = await haltBornInvalid(s);
  const { halt, haltIndex } = assertDesignOwnerHalt(s, h, { cls: 'B1', codes: ['authority_content_not_machine_structure'], phase: 'spec' });
  assert.strictEqual(invokesOf(h.events, 'spec'), 1, 'spec 不得在当前阶段重试');
  // 探针只读：未修时未就绪，且不动蓝图、CU、run 事件的任何字节。
  const watched = [blueprintFile(s), loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).canonicalPath, runFile(s.root, h.feature, h.halted, 'events.jsonl'), featureFilePath(s.root, h.feature, 'acceptance.yaml')];
  const before = watched.map(sha);
  const notReady = runConditionProbe(s.root, reportDirOf(s, h.feature, h.halted), 'design_authority_projectable', 'spec');
  assert(notReady.ready === false && /authoritative_content_aligned/.test(String(notReady.reason)), `未修时探针不得就绪：${JSON.stringify(notReady)}`);
  assert.deepStrictEqual(watched.map(sha), before, '探针必须只读');
  assert(!fs.existsSync(featureLockPath(s, CU)), '探针不得留下锁');
  // 反例：未修蓝图就重发同一请求 → 保持停止，不新建 run、不写事件（探针未就绪不越过冷却）。
  const unrepaired = await resend(s, h);
  assert(unrepaired.exitCode === 1 && !unrepaired.born.length, `未修就重发应保持停止：${JSON.stringify(unrepaired)}`);
  assert.strictEqual(sha(watched[2]), before[2], '保持停止时不得往停机 run 写事件');
  const flow: RepairFlow = { feature: h.feature, runs: [h.halted], halted: h.halted, haltIndex, haltClass: String((halt.design_authority as Ev).class), interventions: [], evidence: `停机=${halt.halt_reason}@${halt.phase} 分类=B1 未修重发 exit=${unrepaired.exitCode}` };
  if (opts.repair === false) {
    flow.interventions = [{ kind: 'rescue_command', necessary: false, content: '未修蓝图就重新发起同一请求（不带任何旗标）' }];
    return flow;
  }
  // 设计 owner 在既有授权内把写成文本的验收改回机器结构（内容按当前设计意图），经真实 readiness 入口调和。
  repairViaReadiness(s, node => { restoreNode(node, h.saved); node.acceptance.criteria[0].expected_result = NEW_EXPECTED_RESULT; }, 'blueprint: acceptance back to machine structure');
  assert.deepStrictEqual(staleFrozenBindings(s.root, h.feature, h.halted, 'spec'), [], '全手写宿主：冻结绑定都由 spec / plan 在链内重签，恢复判断应为重新接入');
  const repaired = await resend(s, h);
  const events = eventsOf(s, h.feature, h.halted);
  assert(!repaired.born.length && events.filter(e => e.type === 'run_start').length === 2, `应重新接入同一 run、不新建 run：${JSON.stringify(repaired)}`);
  assert(events.some(e => e.type === 'phase_verdict' && e.phase === 'spec' && e.verdict === 'PASS'), `spec 应按新权威重评通过：${JSON.stringify(verdictsOf(events))}`);
  assertCompletedBy(s, h.feature, h.halted, 'S15 重新接入');
  flow.interventions = [
    { kind: 'manual_file_edit', necessary: true, content: '设计修复（B1，既有授权内）：设计 owner 把蓝图里写成文本的验收改回机器结构，经 design-handoff readiness 入口调和并提交' },
    { kind: 'rescue_command', necessary: true, content: '冷却期内重新发起同一请求（不带任何旗标）', related_events: [{ run_id: h.halted, event_index: events.map(e => e.type).lastIndexOf('run_start') }] },
  ];
  flow.evidence += `；修后重发 exit=${repaired.exitCode} 同一 run 第二段 verdicts=${JSON.stringify(verdictsOf(events))}`;
  return flow;
}

/**
 * S15 实体绑定失效：plan 已通过后进入设备等待，作者合法补充施工步骤，原实体绑定真实 stale。
 * 无剩余 plan owner 可在原 run 重签；探针未就绪不拉起，就绪后重发 / supervisor 经原接续判断起后继并完成。
 */
export async function s15StaleFlow(s: Snapshot, via: 'resend' | 'supervisor'): Promise<RepairFlow> {
  const { feature, runId, deviceDeps, setDeviceReady } = await parkOnStaleBindingWait(s);
  const eventsBefore = fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl'));
  const manifestBefore = fs.readFileSync(runFile(s.root, feature, runId, 'manifest.json'));
  const current = eventsOf(s, feature, runId);
  const haltIndex = current.map(event => event.type).lastIndexOf('phase_halt');
  const halt = current[haltIndex];
  assert(halt?.halt_reason === 'device_not_ready' && halt.probe === 'device_readiness' && halt.run_disposition === 'WAITING', JSON.stringify(halt));
  const stale = staleFrozenBindings(s.root, feature, runId, 'ut');
  assert(stale.length > 0 && stale.every(item => item.startsWith('contracts:')), `实体施工绑定必须真实 stale：${JSON.stringify(stale)}`);
  setDeviceReady(false);
  assert(!s15DeviceProbe(deviceDeps, 'device_readiness').ready, '设备未就绪时探针不得放行');
  if (via === 'supervisor') {
    supervise.__testing_setConditionProbe(name => s15DeviceProbe(deviceDeps, name));
    try {
      const asleep = await superviseOnce(s, feature, runId);
      assert(asleep.code === 0 && !asleep.spawned.length, `未就绪时 supervisor 不得拉起：${JSON.stringify(asleep)}`);
      assert(!eventsOf(s, feature, runId).some(event => event.type === 'supervisor_restart'), '未就绪时不得消耗 supervisor 重启次数');
    } finally { supervise.__testing_setConditionProbe(null); }
  }
  setDeviceReady(true);
  const before = new Set(runIds(s.root, feature));
  const interventions: RepairIntervention[] = [];
  let evidence = `停机=${halt.halt_reason}@${halt.phase}；plan 已兑现，artifact stale=${JSON.stringify(stale)}`;
  const manifest = readJson<Ev>(runFile(s.root, feature, runId, 'manifest.json'));
  const authors = s15ContinuationAuthors(s, feature, deviceDeps);
  if (via === 'resend') {
    const repaired = await runGoalRuntimeChain(s.root, { frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex',
      freshRequirement: manifest.requirement, freshStartPhase: manifest.start_phase, freshEndPhase: manifest.end_phase, noAutoForce: true, ...authors });
    evidence += `；重发 exit=${repaired.exitCode}`;
    interventions.push({ kind: 'rescue_command', necessary: true, content: '冷却期内重新发起同一请求（不带任何旗标）' });
  } else {
    supervise.__testing_setConditionProbe(name => s15DeviceProbe(deviceDeps, name));
    let woke: Awaited<ReturnType<typeof superviseOnce>>;
    try { woke = await superviseOnce(s, feature, runId); } finally { supervise.__testing_setConditionProbe(null); }
    assert.deepStrictEqual(woke!.spawned, [['--feature', feature, '--resume', runId, '--force-resume', '--detach']], `supervisor 只发原 resume 命令：${JSON.stringify(woke!)}`);
    const run = await requestVia('detach', s.root, { frameworkRoot: s.frameworkRoot, featureId: feature, resume: runId, forceResume: true, ...authors });
    evidence += `；supervisor 发出 ${woke.spawned[0].join(' ')}，runner exit=${run.exitCode} child=${JSON.stringify(run.childArgs)}`;
  }
  clearFrameworkConfigCache();
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  assert.strictEqual(born.length, 1, `应自动起且只起一个后继：${JSON.stringify(born)}；${evidence}`);
  const [successor] = born;
  const events = eventsOf(s, feature, successor);
  assert(events.some(event => event.type === 'supersede' && event.target_run_id === runId && event.superseding_run_id === successor), '后继须审计承接停机 run');
  assert.strictEqual(readJson<Ev>(runFile(s.root, feature, successor, 'manifest.json')).successor_of, runId, '后继出生来源必须是原停放 run');
  const haltedEvents = eventsOf(s, feature, runId);
  assert.strictEqual(haltedEvents.filter(e => e.type === 'run_start').length, 1, '绑定已失效时不得在原 run 上继续');
  assert(fs.readFileSync(runFile(s.root, feature, runId, 'manifest.json')).equals(manifestBefore), '原 manifest 字节不得改写');
  assert(fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl')).subarray(0, eventsBefore.length).equals(eventsBefore), '原事件历史必须保留');
  assertCompletedBy(s, feature, successor, `S15 自动后继（${via}）`);
  assert(boundSources(s, feature, successor).includes('contracts<-contracts@1'), '后继必须重新解析真实实体施工输入');
  assertS15BudgetInherited(s, feature, runId, successor);
  if (via === 'supervisor') {
    assert.strictEqual(haltedEvents.filter(e => e.type === 'supervisor_restart').length, 1);
    assert.strictEqual(supervise.__testing_inheritedSupervisorRestarts(path.join(s.root, reportDirOf(s, feature, successor))), 1, 'supervisor 重启次数不得清零');
  }
  return { feature, runs: [runId, successor], halted: runId, haltIndex, haltClass: String(halt.halt_reason), interventions, evidence };
}

/** S15 B2：设计闭包内出现未决项（需要有权者裁决）→ 停机分类 B2、说明写清缺什么 → 有权者裁决后经 readiness 调和 → 重发同一请求 → 完成。 */
export async function s15AuthorityFlow(s: Snapshot): Promise<RepairFlow> {
  const h = await haltAfterBirthAtSpec(s, undefined, node => { node.knowledge_state = 'unknown'; });
  // 未决项让调和器的 carry-forward 不过：本 CU 指针留在旧 revision，检查报的原因码是指针过期，分类表把它归 B2。
  const { halt, haltIndex } = assertDesignOwnerHalt(s, h, { cls: 'B2', codes: ['change_unit_blueprint_ref_stale'], phase: 'spec' });
  const guidance = String(halt.halt_guidance);
  assert(/本 CU 被调和器跳过/.test(guidance) && /ledger-domain/.test(guidance), `B2 说明须写清缺什么（哪一项未决）：${guidance}`);
  assert.strictEqual(invokesOf(h.events, 'spec'), 1, '本 CU 被跳过时不得重评');
  repairViaReadiness(s, node => restoreNode(node, h.saved), 'blueprint: open item decided with authority');
  const before = new Set(runIds(s.root, h.feature));
  const repaired = await resend(s, h);
  const born = runIds(s.root, h.feature).filter(id => !before.has(id));
  const final = born[0] ?? h.halted;
  assertCompletedBy(s, h.feature, final, 'S15 B2');
  return {
    feature: h.feature, runs: [h.halted, ...born], halted: h.halted, haltIndex, haltClass: 'B2',
    interventions: [
      { kind: 'product_decision', necessary: true, content: '有权者裁决：设计闭包里的未决项给出结论，蓝图升版并经 design-handoff readiness 入口调和、提交' },
      { kind: 'rescue_command', necessary: true, content: '冷却期内重新发起同一请求（不带任何旗标）' },
    ],
    evidence: `停机=${halt.halt_reason}@${halt.phase} 分类=B2；裁决后重发 exit=${repaired.exitCode} 完成于 ${final === h.halted ? '同一 run' : '自动后继'}`,
  };
}

// ---- S16：无人值守 B1 由框架派设计修复自动接手 ---------------------------------------------------------
//
// 只有 adapter 的两次链外调用由测试替身（driver 的 onOutOfChain）扮演：编写方在草稿里改、质询方在草稿里写质询结果。
// 锁、草稿、写归因核对、准入派生与写回、真实校验、发布、调和、探针、恢复判断全部是生产路径。

const LOCAL_FILE = (s: Snapshot): string => path.join(s.root, 'framework.local.json');
/** 用户在个人配置里写下预授权（宿主动作，属前提，不计入故障后的操作者动作）。 */
function preauthorize(s: Snapshot, value: unknown = true): void {
  const local = readJson<Record<string, unknown>>(LOCAL_FILE(s));
  local.design_repair = { unattended_b1: value };
  fs.writeFileSync(LOCAL_FILE(s), JSON.stringify(local, null, 2));
}
const draftPathOf = (prompt: string): string => {
  const hit = /草稿文件[^：\n]*：(.+)$/m.exec(prompt);
  assert(hit, `链外调用的提示词须写明草稿文件：${prompt.slice(0, 300)}`);
  return hit![1].trim();
};
const readDoc = (file: string): Ev => YAML.parse(fs.readFileSync(file, 'utf8')) as Ev;
const writeDoc = (file: string, doc: Ev): void => fs.writeFileSync(file, YAML.stringify(doc));

type OutOfChainCtx = { phase: string; prompt: string; attempt: number; runId: string };
interface RepairAdapterLog { prompts: Record<string, string[]>; lockedDuringAuthor?: { blueprint: boolean; features: Record<string, boolean>; attemptedBeforeInvoke: boolean } }
/**
 * 假 adapter（两次链外调用的产出替身）：
 *  · 编写方：默认把被写坏的节点按原意改回机器结构（`h.saved`），可由 `author` 改写行为（越界写入、自报准入……）；
 *  · 质询方：默认按必答范围产出完整质询结果——内容取 canonical 里原有的质询项、换成质询方标识；`questioning` 可改写（不可用、无结果……）。
 * 编写调用进行中顺带记下：两层锁是否都在、attempted 是否已落盘（"落盘成功后才派发"的直接证据）。
 */
function repairAdapter(s: Snapshot, saved: () => Ev | undefined, opts: {
  author?: (doc: Ev, draft: string) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  questioning?: (doc: Ev, draft: string) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  /** 编写方对被写坏节点的改法；缺省仅还原原值，不顺带改变设计事实。 */
  fix?: (node: Ev, saved: Ev) => void;
} = {}): { log: RepairAdapterLog; onOutOfChain: (ctx: OutOfChainCtx) => Promise<Record<string, unknown> | void> } {
  const log: RepairAdapterLog = { prompts: {} };
  return {
    log,
    onOutOfChain: async ctx => {
      (log.prompts[ctx.phase] ??= []).push(ctx.prompt);
      const draft = draftPathOf(ctx.prompt);
      const doc = readDoc(draft);
      if (ctx.phase === 'design-repair-author') {
        const reportDir = path.dirname(path.dirname(draft));
        log.lockedDuringAuthor = {
          blueprint: fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)),
          features: Object.fromEntries(enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID).map(u => [String(u.changeUnit.change_unit_id), fs.existsSync(featureLockPath(s, String(u.changeUnit.change_unit_id)))])),
          attemptedBeforeInvoke: fs.readFileSync(path.join(reportDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Ev)
            .some(e => e.type === 'design_authority_repair' && e.stage === 'attempted'),
        };
        const node = ledgerDomain(doc);
        (opts.fix ?? restoreNode)(node, saved()!);
        const override = await opts.author?.(doc, draft);
        writeDoc(draft, doc);
        return override ?? undefined;
      }
      const canonicalQuestioning = readDoc(blueprintFile(s)).review_summary.questioning;
      doc.review_summary.questioning = { ...structuredClone(canonicalQuestioning), provider_id: 'design-repair-questioning' };
      const override = await opts.questioning?.(doc, draft);
      writeDoc(draft, doc);
      return override ?? undefined;
    },
  };
}

interface S16Born { feature: string; completed?: string; runId: string; events: Ev[]; requirement: string; request: { start: string; end: string }; saved: Ev; baseRevision: number; chain: string[]; error?: string }
/**
 * S16 从 fresh CU 的坏设计请求入场；祖先事件场景先真实停在 B1/HALTED，再公开起后继。
 * spec 首轮从同需求 fixture 新建作者验收草稿与事实，内容修复后的重试按当前 provider 写正式阶段产物。
 */
async function s16Born(s: Snapshot, opts: {
  /** false = 不写预授权；其它值原样写进 design_repair.unattended_b1（缺省布尔 true）。 */
  preauth?: unknown; corrupt?: (node: Ev) => void; adapter?: Parameters<typeof repairAdapter>[2]; extra?: Record<string, unknown>;
  /** 真实 B1/HALTED 首 run 为事件与累计预算祖先，不伪称完成。 */
  ancestor?: boolean;
  allowSuccessors?: boolean;
  requestOnly?: boolean;
  /** 写坏蓝图之前的宿主准备（如兄弟 CU 的运行范围）；随写坏一起提交。 */
  beforeCorrupt?: () => void;
  /** 提交之后、本 run 出生之前（如另一个 run 已在跑）。 */
  beforeBirth?: (saved: Ev) => Promise<void>;
} = {}): Promise<S16Born & { log: RepairAdapterLog }> {
  const feature = SNAPSHOT_CU_FEATURE;
  if (opts.preauth !== false && !opts.ancestor) preauthorize(s, opts.preauth ?? true);
  opts.beforeCorrupt?.();
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); (opts.corrupt ?? (n => { n.acceptance = TEXT_ACCEPTANCE; }))(node); });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const baseRevision = Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision);
  const freshRequest = prepareFreshCuRequest(s, opts.requestOnly ? 'request' : 'feature');
  let chain = freshRequest.chain;
  assert(chain[0] === 'spec' && chain.includes('plan'), `前提：出生链含 spec 与 plan：${JSON.stringify(chain)}`);
  const p = project(s, feature);
  const aligned = specFirstCuHooks(p, true);
  let ancestor: string | undefined;
  if (opts.ancestor) {
    preauthorize(s, false);
    commit(s, 'ancestor request has no unattended repair authorization');
    const parent = await runGoalRuntimeChain(s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex', realHarness: true, noAutoForce: true, viaHostBridge: true,
      freshRequirement: freshRequest.requirement, freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1],
      onSpec: (ctx: { runId: string }): void => { p.runId = ctx.runId; writeCuSpecDraft(p); },
    });
    [ancestor] = runIds(s.root, feature);
    assert(ancestor, `真实祖先未出生：exit=${parent.exitCode}`);
    const events = eventsOf(s, feature, ancestor);
    assertNotDispatched({ events }, '真实 HALTED 祖先');
    assert.strictEqual(haltOf(events)?.design_authority?.class, 'B1', '祖先实际门命中 B1');
    assert.strictEqual(endOf(events)?.status, 'HALTED', '祖先没有完成事实');
    preauthorize(s, opts.preauth === false ? false : opts.preauth ?? true);
    commit(s, 'child request keeps the real halted ancestor');
    chain = successorChain(s, feature, ancestor);
    assert(chain[0] === 'spec' && chain.includes('plan'), `真实祖先后的出生链：${JSON.stringify(chain)}`);
  }
  await opts.beforeBirth?.(saved!);
  const adapter = repairAdapter(s, () => saved, opts.adapter);
  const before = new Set(runIds(s.root, feature));
  const hooks = {
    ...aligned, noAutoForce: true,
    onSpec: (ctx: { runId: string; attempt: number }): void => {
      if (ctx.attempt === 1) { p.runId = ctx.runId; writeCuSpecDraft(p); }
      else aligned.onSpec(ctx);
    },
    onOutOfChain: adapter.onOutOfChain,
    ...opts.extra,
  };
  let error: string | undefined;
  let expectedRunId: string | undefined;
  if (ancestor) {
    const next = await supersede(s, feature, ancestor, chain, hooks);
    assert(next.successor, `后继未出生：${next.error}`);
    expectedRunId = next.successor;
    error = next.error;
  } else {
    const run = await runGoalRuntimeChain(s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex',
      freshRequirement: freshRequest.requirement, freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1], ...hooks,
    });
    if (run.exitCode !== 0) error = `runner exit ${run.exitCode}`;
  }
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  if (expectedRunId) assert.deepStrictEqual(born, [expectedRunId], `只应出生一个 run：${JSON.stringify(born)}`);
  else if (!opts.allowSuccessors) assert.strictEqual(born.length, 1, `fresh 请求只应出生一个 run：exit=${error ?? 0} ${JSON.stringify(born)}`);
  const current = born[born.length - 1];
  return { feature, runId: current, events: born.flatMap(id => eventsOf(s, feature, id)), requirement: freshRequest.requirement,
    request: { start: chain[0], end: chain[chain.length - 1] }, saved: saved!, baseRevision, chain, log: adapter.log, ...(error ? { error } : {}) };
}
/** Child-only physical crash: canonical rename succeeds, no published event can be written. */
export async function __nonresidentDesignPublicationFaultWorker(metadataFile: string): Promise<void> {
  await withFreshCuHost(async s => {
    const nodeFs = require('fs') as typeof fs;
    const rename = nodeFs.renameSync;
    const canonical = blueprintFile(s);
    fs.writeFileSync(metadataFile, JSON.stringify({ ...s, feature: SNAPSHOT_CU_FEATURE }));
    nodeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
      rename(from, to);
      if (path.resolve(String(to)) === path.resolve(canonical) && String(from).includes('.tmp-')) {
        const revision = Number(readDoc(canonical).revision);
        fs.writeFileSync(metadataFile, JSON.stringify({ ...s, feature: SNAPSHOT_CU_FEATURE, cutRevision: revision, cutAt: new Date().toISOString() }));
        process.exit(77);
      }
    }) as typeof fs.renameSync;
    await s16Born(s, { allowSuccessors: true, extra: { viaSessionStep: true, sessionSelfCheck: true, hostAuthorization: { mode: 'goal_mode', autonomyAuthorized: true } } });
    throw new Error('publication fault cut was not reached');
  });
}

const contentRepairs = (events: Ev[]): Ev[] => events.filter(e => e.type === 'design_authority_repair' && e.action === 'content_repair');
const outOfChainStarts = (events: Ev[]): Ev[] => events.filter(e => e.type === 'agent_invoke_start' && String(e.phase).startsWith('design-repair-'));
const describeS16 = (b: { events: Ev[]; error?: string }): string => JSON.stringify({
  error: b.error, repairs: contentRepairs(b.events), halt: haltOf(b.events), end: endOf(b.events), verdicts: verdictsOf(b.events),
  invokes: outOfChainStarts(b.events).map(e => e.invoke_id),
}).slice(0, 4000);
/** 停机前提共同断言：没有派发（没有 content_repair 事件、没有链外调用），停在设计 owner 出口。 */
function assertNotDispatched(b: { events: Ev[]; error?: string }, label: string): void {
  assert(!contentRepairs(b.events).length && !outOfChainStarts(b.events).length, `${label}：不得派发：${describeS16(b)}`);
  assert.strictEqual(haltOf(b.events)?.halt_reason, 'execution_scope_unresolved', `${label}：应停在设计 owner 出口：${describeS16(b)}`);
}
/** 锁与草稿收尾：尝试结束后不留蓝图锁、兄弟 CU 的 feature 锁与空目录。 */
function assertAttemptCleanedUp(s: Snapshot): void {
  assert(!fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)), '尝试结束后不得留下蓝图锁');
  for (const u of enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID)) {
    const id = String(u.changeUnit.change_unit_id);
    const dir = path.dirname(featureLockPath(s, id));
    assert(!fs.existsSync(featureLockPath(s, id)), `${id} 不得留下 feature 锁`);
    assert(!fs.existsSync(dir) || fs.readdirSync(dir).length > 0, `${id} 不得留下只为取锁而建的空 goal-runs 目录`);
  }
}

/** S16 主线（绑定仍有效）：同一 run 内修好并续跑完成，操作者动作 0。返回给 reliability-scenarios 用的流程摘要。 */
export async function s16MainFlow(s: Snapshot): Promise<RepairFlow> {
  const b = await s16Born(s);
  console.log(`[design-authority-repair] S16 ${describeS16(b)}`);
  const [attempted, published, ...rest] = contentRepairs(b.events);
  assert(attempted?.stage === 'attempted' && published?.stage === 'published' && published.outcome === 'recovered' && !rest.length, `事件应为 attempted → published：${describeS16(b)}`);
  assert.strictEqual(published.new_revision, b.baseRevision + 1, '新 revision 由运行时登记');
  // D1：草稿旧质询整份作废后机器派生的准入未过；独立质询重新生成后机器派生为 pass（canonical 原本就是 pass，历史保留）。
  assert(published.admission_after_invalidation === 'blocker' && published.admission_after_questioning === 'pass', describeS16(b));
  // D3：两次真实的、相互独立的调用——不同 invoke、不同用途标识；质询提示词不含编写方的修复简报；各自只改允许的字段（运行时已核，否则不会发布）。
  const starts = outOfChainStarts(b.events);
  assert.deepStrictEqual(starts.map(e => e.phase), ['design-repair-author', 'design-repair-questioning'], describeS16(b));
  assert(new Set(starts.map(e => e.invoke_id)).size === 2 && starts.every(e => e.chain_phase === 'spec'), describeS16(b));
  const [authorPrompt] = b.log.prompts['design-repair-author'];
  const [questioningPrompt] = b.log.prompts['design-repair-questioning'];
  assert(/修复简报/.test(authorPrompt) && /authority_content_not_machine_structure/.test(authorPrompt) && /不(?:得)?写 ?`?review_summary.admission/.test(authorPrompt), '编写提示词须带简报与子契约');
  assert(!/修复简报/.test(questioningPrompt) && !/authority_content_not_machine_structure/.test(questioningPrompt) && /必答范围/.test(questioningPrompt), '质询提示词须与编写隔离，只给草稿与证据包');
  // 整个尝试在两层锁内（编写调用进行中蓝图锁与全部 CU 的 feature 锁都在）；attempted 在调用前已落盘。
  assert(b.log.lockedDuringAuthor?.blueprint && Object.values(b.log.lockedDuringAuthor.features).every(Boolean) && b.log.lockedDuringAuthor.attemptedBeforeInvoke, JSON.stringify(b.log.lockedDuringAuthor));
  assertAttemptCleanedUp(s);
  // 发布物：revision 与修订依据由运行时登记在根 provenance；旧派生结论标 stale、保留原输入版本；准入由机器写回为 pass；质询方不是编写方。
  const bp = readDoc(blueprintFile(s));
  assert(bp.revision === b.baseRevision + 1 && bp.provenance.source_kind === 'design_repair_unattended' && /manifest\.json#requirement/.test(bp.provenance.source_ref), JSON.stringify(bp.provenance));
  assert((bp.derived_results ?? []).every((r: Ev) => r.status === 'stale' && r.superseded_by_revision === bp.revision && r.input_revision !== bp.revision), `旧派生结论须标 stale、不得改输入版本：${JSON.stringify(bp.derived_results)}`);
  assert(bp.review_summary.admission.status === 'pass' && bp.review_summary.questioning.provider_id === 'design-repair-questioning' && bp.review_summary.questioning.provider_id !== bp.review_summary.authored_by, JSON.stringify(bp.review_summary.admission));
  assert(pointsAtCurrentBlueprint(s, CU), 'CU 指针已在同一锁内调和到新 revision');
  // 同一 run 续跑：spec 首轮 FAIL → 修复 → 原地重评 PASS；没有停机、没有新 run；任务由这个 run 正确完成。
  assert(!b.events.some(e => e.type === 'phase_halt'), `不得停机：${describeS16(b)}`);
  assert.strictEqual(b.events.filter(e => e.type === 'run_start').length, 1, '同一 run 内完成');
  assertCompletedBy(s, b.feature, b.runId, 'S16 主线');
  const report = fs.readFileSync(runFile(s.root, b.feature, b.runId, 'goal-report.md'), 'utf8');
  assert(/content_repair（蓝图 [^；]+；published rev \d+ recovered/.test(report), 'goal 报告应渲染无人值守修复');
  return { feature: b.feature, runs: [b.runId], haltClass: 'B1', interventions: [], evidence: `attempted→published rev ${published.new_revision}（recovered），同一 run 完成；verdicts=${JSON.stringify(verdictsOf(b.events))}` };
}

/**
 * S16 未来 plan 重签支：真实 A1/spec 入场窗口冻结 derive contracts，出生后机器结构被写坏。
 * B1 修复改变原文明确授权的施工内容，旧 binding 真实 stale；待做 plan 正式交付并重签，同 run 完成。
 * supervisor 变体检查已完成 run 不重复拉起；两变体都没有停机、后继或人工救援。
 */
export async function s16StaleFlow(s: Snapshot, via: 'supervisor' | 'resend'): Promise<RepairFlow> {
  preauthorize(s);
  commit(s, 'developer pre-authorizes unattended B1 design repair');
  let adapter: ReturnType<typeof repairAdapter> | undefined;
  const h = await haltAfterBirthAtSpec(s, undefined, node => { node.acceptance = TEXT_ACCEPTANCE; node.contracts = TEXT_CONTRACTS; }, saved => {
    // 按原文改回：验收还原；施工契约还原并按原文写明的写集补上那个文件。
    adapter = repairAdapter(s, saved, { fix: (node, original) => { restoreNode(node, original); node.contracts.files.push(NEW_CONTRACT_FILE); } });
    // 本窗口先调和指针，再修 B1，最后回应真实 verifier request；预算在出生前明确给足这三次重试。
    return { onOutOfChain: adapter.onOutOfChain, freshManifestContent: YAML.stringify({ feature: SNAPSHOT_CU_FEATURE,
      budget: { max_retries_per_phase: 3, max_total_turns: 30, wall_clock_minutes: 480 },
      unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 } }) };
  });
  const b = { events: h.events };
  console.log(`[design-authority-repair] S16-stale ${describeS16(b)}`);
  const [attempted, published] = contentRepairs(h.events);
  assert(attempted?.stage === 'attempted' && published?.stage === 'published' && published.outcome === 'recovered', `修复应已发布并恢复：${describeS16(b)}`);
  assert(h.oldContractsStale && h.planAuthored, '旧 derive 必须真实 stale，待做 plan 必须正式产出当前实体并重签');
  assert(h.birthManifest && fs.readFileSync(runFile(s.root, h.feature, h.halted, 'manifest.json')).equals(h.birthManifest), '出生 manifest 原字节不变');
  assert.deepStrictEqual(runIds(s.root, h.feature), [h.halted], '待做 plan 可重签时不得多生 run');
  assert(!h.events.some(e => e.type === 'phase_halt') && h.events.filter(e => e.type === 'run_start').length === 1, '同 run 自动完成，不制造停机/重发');
  const replay = resolveResumedBudget(loadAuthoritativeEvents(runFile(s.root, h.feature, h.halted, 'events.jsonl')), { nextSessionStartMs: Date.now() });
  const invocations = h.events.filter(e => e.type === 'agent_invoke_start').length;
  assert.strictEqual(replay.totalTurns, invocations, '预算逐实际调用连续回放，不重置');
  assertCompletedBy(s, h.feature, h.halted, 'S16 待做 plan 重签');
  let evidence = `旧 contracts derive 真实 stale；spec/plan 同 run 重签完成；turns=${replay.totalTurns}`;
  if (via === 'supervisor') {
    const woke = await superviseOnce(s, h.feature, h.halted);
    assert(woke.code === 0 && !woke.spawned.length, '已完成 run 不得被 supervisor 重复拉起');
    evidence += '；supervisor 不重复拉起';
  }
  assertAttemptCleanedUp(s);
  return { feature: h.feature, runs: [h.halted], haltClass: 'B1', interventions: [], evidence };
}

// ---- S16 反例六：两个真实 run 竞争同一蓝图的修复 ------------------------------------------------------
// 兄弟 CU（ledger-summary）的 run 跑在同一进程的另一个线程里：goal 运行时与测试缝都是模块级状态，线程之间互相隔离；
// 两层锁是同一套文件锁（持有者 pid 相同且存活 = 别人持有），所以这是两个真实 run 之间的真实竞争，不是手工占锁。

const SIBLING_FEATURE = deriveChangeUnitFeatureId(BLUEPRINT_ID, SIBLING);
const SIBLING_REQUIREMENT = '账本汇总卡片';
/** 用户经生产入口（goal-mode-entry --prepare-scope 同一函数）为兄弟 CU 准备运行范围。 */
function prepareSiblingScope(s: Snapshot): Array<'spec' | 'plan'> {
  clearFrameworkConfigCache();
  const prepared = prepareFeatureScopeCandidate({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature: SIBLING_FEATURE, completionTarget: 'feature',
    requestedResults: [SIBLING_REQUIREMENT], requestedPhases: ['spec'], requirement: SIBLING_REQUIREMENT, overwrite: true });
  assert.deepStrictEqual(prepared.scope.phase_chain, ['spec', 'plan'], '前提：兄弟 CU 的出生链');
  freezeFeatureExecutionScope({ projectRoot: s.root, feature: SIBLING_FEATURE, scope: prepared.scope,
    candidateFingerprint: featureScopeCandidateFingerprint(s.root, SIBLING_FEATURE) });
  return prepared.scope.phase_chain as Array<'spec' | 'plan'>;
}

/** 兄弟 CU 首轮新建作者草稿，不读取或换戳主 CU 的阶段文件。 */
function writeSiblingSpecDraft(s: Snapshot, runId: string): void {
  writeCuSpecDraft({ ...project(s, SNAPSHOT_CU_FEATURE), feature: SIBLING_FEATURE, runId });
}

/**
 * 兄弟 CU 的 fresh run（需要出生期参数时用：后继的预算继承源 run、按交付周期累计，host bridge 上本 CU 的后继出生受快照里
 * 历史绝对路径的影响依据所限）：（预授权）→ 坏设计输入、调和 → 准备并冻结兄弟 CU 的运行范围 →
 * 公开入口 fresh 出生 → spec 的真实门报 B1。
 */
async function siblingFreshRun(s: Snapshot, extra: Record<string, unknown> = {}): Promise<{ b: S16Born; adapter: ReturnType<typeof repairAdapter>; exitCode: number }> {
  preauthorize(s);
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); node.acceptance = TEXT_ACCEPTANCE; });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(!r.skipped.length, JSON.stringify(r));
  const chain = prepareSiblingScope(s);
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const baseRevision = Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision);
  const adapter = repairAdapter(s, () => saved);
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1],
    realHarness: true, noAutoForce: true, onOutOfChain: adapter.onOutOfChain, onSpec: (ctx: { runId: string }) => writeSiblingSpecDraft(s, ctx.runId), ...extra,
  });
  const [runId] = runIds(s.root, SIBLING_FEATURE);
  assert(runId, `兄弟 run 未出生：exit=${probe.exitCode}`);
  return { b: { feature: SIBLING_FEATURE, runId, events: eventsOf(s, SIBLING_FEATURE, runId), baseRevision, saved: saved!, chain,
    requirement: SIBLING_REQUIREMENT, request: { start: chain[0], end: chain[chain.length - 1] } }, adapter, exitCode: probe.exitCode };
}

/**
 * worker 线程一侧：兄弟 CU 的真实 run（公开入口出生、真 harness）。spec 首轮的 agent 调用里先写手写验收，然后停在这里
 *（此时它持有自己的 feature 锁）等主线程放行；之后照常走真实门、派发与发布。
 */
export async function __siblingRunInWorker(): Promise<{ exitCode: number; runIds: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { workerData, parentPort } = require('worker_threads') as typeof import('worker_threads');
  const data = workerData as { root: string; frameworkRoot: string; signal: SharedArrayBuffer; saved: Ev };
  const s = { root: data.root, frameworkRoot: data.frameworkRoot, harnessDir: path.join(data.frameworkRoot, 'harness') } as Snapshot;
  const adapter = repairAdapter(s, () => data.saved);
  const p = { ...project(s, SNAPSHOT_CU_FEATURE), feature: SIBLING_FEATURE };
  const hooks = authorHooks(p, { spec: writeCuSpecMaterials, plan: writeCuPlanMaterials,
    coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials });
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: 'spec', freshEndPhase: 'plan',
    ...hooks, noAutoForce: true, onOutOfChain: adapter.onOutOfChain,
    onSpec: (ctx: { runId: string; attempt: number }) => {
      if (ctx.attempt !== 1) { hooks.onSpec(ctx); return; }
      p.runId = ctx.runId; writeSiblingSpecDraft(s, ctx.runId);
      parentPort!.postMessage({ type: 'blocked' });
      Atomics.wait(new Int32Array(data.signal), 0, 0, 10 * 60_000);
    },
  });
  return { exitCode: probe.exitCode, runIds: runIds(s.root, SIBLING_FEATURE) };
}

/** 主线程：起 worker 跑兄弟 run，等它停在 spec 的 agent 调用里（持锁）再返回；`release()` 放行，`done` 是它的结果。 */
async function startSiblingRun(s: Snapshot, saved: Ev): Promise<{ release: () => void; done: Promise<{ exitCode: number; runIds: string[] }>; worker: import('worker_threads').Worker }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Worker } = require('worker_threads') as typeof import('worker_threads');
  const signal = new SharedArrayBuffer(4);
  const boot = [
    "const { workerData, parentPort } = require('worker_threads');",
    // 工作目录是进程共享的（主线程已切到宿主根）；worker 不支持 chdir，驱动层的 chdir 在这里是空操作。
    'process.chdir = () => {};',
    'require(workerData.tsNode).register({ transpileOnly: true, project: workerData.tsconfig });',
    "require(workerData.module).__siblingRunInWorker().then(r => parentPort.postMessage({ type: 'done', result: r }), e => parentPort.postMessage({ type: 'error', error: String((e && e.stack) || e) }));",
  ].join('\n');
  // boot 自行注册 harness ts-node；不继承外层套件进程在临时 cwd 下的预加载。
  const worker = new Worker(boot, { eval: true, execArgv: [], workerData: {
    root: s.root, frameworkRoot: s.frameworkRoot, signal, saved,
    tsNode: require.resolve('ts-node'), tsconfig: path.resolve(__dirname, '..', '..', 'tsconfig.json'), module: __filename,
  } });
  let blockedResolve: () => void = () => undefined;
  const blocked = new Promise<void>(resolve => { blockedResolve = resolve; });
  const done = new Promise<{ exitCode: number; runIds: string[] }>((resolve, reject) => {
    worker.on('message', (m: { type: string; result?: { exitCode: number; runIds: string[] }; error?: string }) => {
      if (m.type === 'blocked') blockedResolve();
      else if (m.type === 'done') resolve(m.result!);
      else if (m.type === 'error') { blockedResolve(); reject(new Error(`兄弟 run 失败：${m.error}`)); }
    });
    worker.on('error', error => { blockedResolve(); reject(error); });
  });
  done.catch(() => undefined);
  const release = (): void => { const gate = new Int32Array(signal); Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); };
  await Promise.race([blocked, done]);
  return { release, done, worker };
}

/**
 * 停机 run 的两条生产回放：resume（当前 run 的权威事件 + 祖先折叠）与后继出生（以停机 run 为种子折叠）——各自的 attempted 判重与
 * 预算 reducer 的调用计数。有完成祖先时取原交付周期边界；fresh 请求不传完成边界。
 */
function replayedBudget(s: Snapshot, b: S16Born): Record<'resume' | 'successor', { attempted: boolean; turns: number }> {
  clearFrameworkConfigCache();
  const featuresDir = relFeaturesDir(s.root);
  const signature = String(contentRepairs(b.events)[0]?.signature);
  const current = loadAuthoritativeEvents(runFile(s.root, b.feature, b.runId, 'events.jsonl'));
  const boundary = b.completed ? { cycleBoundary: b.completed } : {};
  const resume = foldBudgetLineage({ projectRoot: s.root, featuresDir, feature: b.feature, currentEvents: current, ...boundary });
  const successor = foldBudgetLineage({ projectRoot: s.root, featuresDir, feature: b.feature, seedTargets: [b.runId], currentEvents: [], ...boundary });
  const turns = (events: Parameters<typeof resolveResumedBudget>[0]): number => resolveResumedBudget(events, { nextSessionStartMs: Date.now() }).totalTurns;
  return {
    resume: { attempted: designRepairAttempted([...resume.ancestorEvents, ...current], signature), turns: turns(resume.budgetFoldEvents) },
    successor: { attempted: designRepairAttempted(successor.ancestorEvents, signature), turns: turns(successor.budgetFoldEvents) },
  };
}

/** S16 授权反例：局部请求没有完整交付授权，不自动扩大到设计修订。 */
export async function s16NoPreauthFlow(s: Snapshot): Promise<RepairFlow & { events: Ev[]; runId: string }> {
  const b = await s16Born(s, { preauth: false, requestOnly: true });
  assertNotDispatched(b, '局部请求');
  assert(!String(haltOf(b.events)?.halt_guidance).includes('下一步：框架沿设计责任链'), '局部请求的停机说明不能承诺未授权的自动设计修订');
  // 原注册用例 S16-c1 的外层断言（plan b0e0621c §3.3 并入）。
  assert.strictEqual(haltOf(b.events)?.design_authority?.class, 'B1', '前提：停机分类为 B1');
  const haltIndex = b.events.map(e => e.type).lastIndexOf('phase_halt');
  return { feature: b.feature, runs: [b.runId], halted: b.runId, haltIndex, haltClass: String(b.events[haltIndex]?.design_authority?.class), interventions: [],
    evidence: `停机=${String(b.events[haltIndex]?.halt_reason)} 分类=${String(b.events[haltIndex]?.design_authority?.class)} 局部请求、content_repair 事件 0、链外调用 0`, events: b.events, runId: b.runId };
}

/** 修复尝试没有发布（发布前失败）：canonical 蓝图字节与质询历史不变、草稿已丢弃、事件披露失败步骤。 */
function assertNotPublished(s: Snapshot, b: S16Born, step: string, label: string): Ev {
  const repairs_ = contentRepairs(b.events);
  const failed = repairs_.find(e => e.stage === 'failed');
  assert(repairs_[0]?.stage === 'attempted' && failed?.failed_step === step && !repairs_.some(e => e.stage === 'published'), `${label}：应在 ${step} 失败且不发布：${describeS16(b)}`);
  const bp = readDoc(blueprintFile(s));
  assert(bp.revision === b.baseRevision && bp.review_summary.questioning.provider_id !== 'design-repair-questioning', `${label}：canonical 不得变（不伪造质询报告）：rev=${bp.revision}`);
  assert(!fs.existsSync(path.join(path.dirname(runFile(s.root, b.feature, b.runId, 'events.jsonl')), 'design-repair')), `${label}：草稿应已丢弃`);
  assertAttemptCleanedUp(s);
  return failed!;
}

// ---- 两处真实时间等待的测试缝（plan b0e0621c §3.2）---------------------------------------------------
// 冷却：只在目标调用期间包装既有恢复守卫 checkTerminalResumeGuard、传短冷却，finally 还原；不加全局冷却配置。
// 心跳：运行时 __testing_setLockHeartbeatMs 只缩短真实心跳定时器的间隔（回调不变），由目标调用之前安装，
//       驱动层 finally 的 __testing_resetGoalRunnerSeams 复位（前缀真跑的复位清不到它：它装在前缀之后）。

/** 用例里起的空转子进程：结束后等它真正退出再离开用例，不漏到下一例（plan b0e0621c §3.1 状态核对表）。 */
const childExited = (child: import('child_process').ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', () => resolve()));

const SHORT_RESUME_COOLDOWN_MS = 3_000;
const TEST_LOCK_HEARTBEAT_MS = 1_000;
/** goal-phase-runtime.ts 的 LOCK_HEARTBEAT_MS（生产缺省，未导出）。 */
const PRODUCTION_LOCK_HEARTBEAT_MS = 60_000;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const runnerPhase = require('../../scripts/utils/goal-runner-phase') as Pick<typeof import('../../scripts/utils/goal-runner-phase'), 'checkTerminalResumeGuard'>;
/** 模块加载时的原守卫（V5：未安装 = 这个函数、生产传的 5 分钟冷却）。 */
const productionResumeGuard = runnerPhase.checkTerminalResumeGuard;

async function withResumeCooldown<T>(cooldownMs: number, call: () => Promise<T>): Promise<{ value: T; guardCalls: number }> {
  const real = runnerPhase.checkTerminalResumeGuard;
  let guardCalls = 0;
  runnerPhase.checkTerminalResumeGuard = input => { guardCalls += 1; return real({ ...input, cooldownMinutes: cooldownMs / 60_000 }); };
  try {
    return { value: await call(), guardCalls };
  } finally {
    runnerPhase.checkTerminalResumeGuard = real;
  }
}

/**
 * S15 停放现场：真实 plan 先交付 contracts/use-cases，coding/review 通过后进入设备等待；
 * 等待期间作者补充不冲突的通知步骤，使实际 artifact 冻结绑定失效。plan 已兑现，不能由未来 owner 在原 run 重签。
 */
async function parkOnStaleBindingWait(s: Snapshot): Promise<{ feature: string; runId: string; gateCalls: number; probes: number;
  deviceDeps: { listTargets: () => string[]; isLocked: () => boolean; wake: () => undefined; attestPhysical: () => boolean }; setDeviceReady: (ready: boolean) => void }> {
  const feature = SNAPSHOT_CU_FEATURE;
  prepareSpecInput(s, writeCuSpecMaterials);
  const request = prepareFreshCuRequest(s);
  const chain = request.chain;
  assert.strictEqual(chain[0], 'plan', `有效 fresh 设计由真实 plan 首先施工：${JSON.stringify(chain)}`);
  assert(chain.at(-1) === 'ut', `前提：出生链到 ut：${JSON.stringify(chain)}`);
  const p = project(s, feature);
  const hooks = authorHooks(p, { plan: writeCuPlanMaterials, coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials });
  const before = new Set(runIds(s.root, feature));
  let contractsBinding: Parameters<typeof readBoundInput>[1] | undefined;
  let gateCalls = 0;
  let probes = 0;
  // 只替身设备状态（没有真设备）：先不在线，等待期间上线且未锁屏。停机事件、outcome 与探针结论都由生产代码产出——
  // 门是真实的 runDeviceReadinessGate（只换掉它读设备状态的 deps），探针是真实的 evaluateDeviceReadinessProbe。
  const device = { online: false };
  const deviceDeps = {
    listTargets: () => (device.online ? ['FAKE-SERIAL'] : []),
    isLocked: () => false,
    wake: () => undefined,
    attestPhysical: () => true,
  };
  const next = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex', freshRequirement: request.requirement,
    freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1], ...hooks, noAutoForce: true,
    // 若恢复判断被绕过，设备门会被重查——此时设备已上线，真实的门放行，run 就会在失效的绑定上继续。
    deviceGate: (o: Parameters<typeof runDeviceReadinessGate>[0]) => {
      gateCalls += 1;
      const runId = runIds(s.root, feature).find(id => !before.has(id))!;
      const effective = loadEffectiveExecutionScope(s.root, feature, runId)!;
      assert(eventsOf(s, feature, runId).some(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict === 'PASS'), '设备等待前真实 plan 必须已通过');
      contractsBinding = effective.obligations.flatMap(obligation => [...obligation.basis, ...(obligation.satisfied_by ?? [])])
        .find((ref): ref is Parameters<typeof readBoundInput>[1] => 'input_id' in ref && ref.input_id === 'contracts' && ref.source.kind === 'artifact');
      assert(contractsBinding, '必须冻结真实实体 contracts 输入');
      readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: 'ut', track: 'full' }, contractsBinding!);
      return runDeviceReadinessGate({ ...o, input: { ...o.input, configuredSerial: null, credentialRef: null, emulatorFallback: 'disabled', existingManaged: null, deps: deviceDeps } });
    },
    conditionWait: {
      maxWaitMs: 5_000, pollMs: 50,
      // 原写集不变，只补充已授权施工的通知步骤；loader/alignment 仍须接受真实实体文件。
      runProbe: (name: string) => {
        probes += 1;
        if (probes === 1) {
          const file = featureFilePath(s.root, feature, 'contracts.yaml');
          const contracts = readDoc(file); contracts.state_management[0].ordered_steps.push('notify observers'); writeDoc(file, contracts);
          clearFrameworkConfigCache();
          assert(checkAuthoritativeContentAligned(checkCtx(s, feature), 'contracts').every(check => check.status !== 'FAIL'), '补充后的真实施工契约仍须对齐设计');
          assert.throws(() => readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: 'ut', track: 'full' }, contractsBinding!), /stale|binding|fingerprint/);
          device.online = true;
        }
        return evaluateDeviceReadinessProbe({ targets: deviceDeps.listTargets(), snapshot: { locked: false, cooldown: { state: 'not_cooldown' } } as never }, name as 'device_readiness');
      },
    },
  });
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  assert.strictEqual(born.length, 1, `fresh 实体施工 run 应出生：exit=${next.exitCode} ${JSON.stringify(born)}`);
  const runId = born[0];
  return { feature, runId, gateCalls, probes, deviceDeps, setDeviceReady: ready => { device.online = ready; } };
}

/** Only the S15 fixture's device transport changes; the production readiness evaluator decides the probe. */
function s15DeviceProbe(deviceDeps: Awaited<ReturnType<typeof parkOnStaleBindingWait>>['deviceDeps'], name: string) {
  return evaluateDeviceReadinessProbe({ targets: deviceDeps.listTargets(), snapshot: { locked: false, cooldown: { state: 'not_cooldown' } } as never }, name as 'device_readiness');
}

function s15ContinuationAuthors(s: Snapshot, feature: string, deviceDeps: Awaited<ReturnType<typeof parkOnStaleBindingWait>>['deviceDeps']) {
  const p = project(s, feature);
  return { ...authorHooks(p, { spec: writeCuSpecMaterials, plan: writeCuPlanMaterials, coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials }),
    conditionWait: { runProbe: (name: string) => s15DeviceProbe(deviceDeps, name) },
    deviceGate: (o: Parameters<typeof runDeviceReadinessGate>[0]) => runDeviceReadinessGate({ ...o,
      input: { ...o.input, configuredSerial: null, credentialRef: null, emulatorFallback: 'disabled', existingManaged: null, deps: deviceDeps } }),
  };
}

/** Reuse the original lineage reducer; the successor inherits the source budget and counts all calls. */
function assertS15BudgetInherited(s: Snapshot, feature: string, source: string, successor: string): void {
  const a = readJson<Ev>(runFile(s.root, feature, source, 'manifest.json'));
  const b = readJson<Ev>(runFile(s.root, feature, successor, 'manifest.json'));
  assert.deepStrictEqual(b.budget, a.budget, '后继不得重置出生预算');
  const folded = foldBudgetLineage({ projectRoot: s.root, featuresDir: relFeaturesDir(s.root), feature, seedTargets: [source], currentEvents: [] });
  const sourceTurns = resolveResumedBudget(folded.budgetFoldEvents, { nextSessionStartMs: Date.now() }).totalTurns;
  const next = loadAuthoritativeEvents(runFile(s.root, feature, successor, 'events.jsonl'));
  const combined = foldBudgetLineage({ projectRoot: s.root, featuresDir: relFeaturesDir(s.root), feature, currentEvents: next });
  const cumulative = resolveResumedBudget(combined.budgetFoldEvents, { nextSessionStartMs: Date.now() }).totalTurns;
  const own = resolveResumedBudget(next, { nextSessionStartMs: Date.now() }).totalTurns;
  assert(sourceTurns > 0 && cumulative >= sourceTurns + own, `原消耗必须带入后继：${sourceTurns}+${own}, cumulative=${cumulative}`);
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: 'S16-r1804 a resumed published transaction preserves its draft and publication fact when a replay input is unavailable',
    run: () => withFreshCuHost(async s => {
      const runId = 'published-tail-unit';
      const runDir = runFile(s.root, SNAPSHOT_CU_FEATURE, runId, '');
      fs.mkdirSync(runDir, { recursive: true });
      const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
      const input = { projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature: SNAPSHOT_CU_FEATURE, phase: 'spec', runId,
        reportDir: path.relative(s.root, runDir).replace(/\\/g, '/'), signature: 'a'.repeat(64), brief: { class: 'B1' as const, items: [] },
        heldFeatureLock: null, runtimeWrites: [], emit, registerLockRelease: () => {}, recordEventLines: () => () => [] };
      const prepared = await runUnattendedDesignRepair({ ...input, invoke: async () => ({ started: true, ok: false, detail: 'request yielded', handoff: true }) });
      assert.equal(prepared.outcome, 'handoff');
      const draft = path.join(runDir, 'design-repair/component-blueprint.yaml');
      const published = readDoc(draft); published.revision = Number(published.revision) + 1;
      const bytes = YAML.stringify(published); fs.writeFileSync(draft, bytes); fs.writeFileSync(blueprintFile(s), bytes);
      const resumed = await runUnattendedDesignRepair({ ...input, invoke: async () => ({ started: false, ok: false, detail: 'original report temporarily unreadable' }) });
      assert(resumed.outcome === 'published' && resumed.recovered === false, JSON.stringify(resumed));
      assert(fs.existsSync(draft) && fs.readFileSync(blueprintFile(s), 'utf8') === bytes, 'already-published bytes and recovery originals must survive the tail failure');
      const events = eventsOf(s, SNAPSHOT_CU_FEATURE, runId);
      assert(!contentRepairs(events).some(event => event.stage === 'failed'), 'a publication cannot be reclassified as an unpublished failed draft');
      assert(contentRepairs(events).some(event => event.stage === 'published' && event.outcome === 'unrecovered'));
    }),
  },

  {
    name: 'A3 探针：真 harness 写出的 run 冻结的输入绑定，在蓝图纯身份升版并经调和器原位升版 CU 指针之后仍全部可复读（不放宽绑定校验）',
    run: () => withHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const { completed } = await handWrittenCompletion(s);
      const before = boundInputs(s, feature, completed);
      console.log(`[design-authority-repair] A3 before=${JSON.stringify(before)}`);
      // 设计类绑定（验收 / 施工契约）升版前有效；codebase 等源码观察类绑定随 run 自己写码而变，不属本断言。
      for (const id of ['acceptance', 'contracts']) assert(before.ids.includes(id) && !before.stale.some(x => x.startsWith(id + ':')), `前提：${id} 绑定在场且有效：${JSON.stringify(before)}`);
      bumpBlueprint(s);
      // 反向：只升蓝图、不调和——手写 contracts 的身份指针指向旧 CU / 旧蓝图，施工契约绑定读不回来（探针对失效敏感）。
      const unreconciled = boundInputs(s, feature, completed);
      console.log(`[design-authority-repair] A3 unreconciled=${JSON.stringify(unreconciled)}`);
      assert(unreconciled.stale.some(x => x.startsWith('contracts:')), `未调和时 contracts 绑定应读不回来：${JSON.stringify(unreconciled)}`);
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
      const after = boundInputs(s, feature, completed);
      console.log(`[design-authority-repair] A3 after=${JSON.stringify(after)}`);
      assert.deepStrictEqual(after, before, '指针升版不得让任何冻结绑定由有效变 stale');
    }),
  },
  {
    name: 'A1 原因区分：指针过期 → 投影 invalid 带 reason=blueprint_ref_stale；plan 门的 CU 投影走 reconcile_blueprint、带 external 与同一 structured；内容坏 → reason=other；判别函数只在 BLOCKER 仅为指针过期时为真',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      handWriteProjections(s.root);
      assert.strictEqual(pointerStaleCandidate(s.root, feature), false, '未升版时不是调和候选');
      bumpBlueprint(s);
      clearFrameworkConfigCache();
      const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
      assert(projected.state === 'invalid' && projected.reason === 'blueprint_ref_stale', JSON.stringify({ state: projected.state, reason: projected.reason, detail: projected.detail }));
      assert.strictEqual(pointerStaleCandidate(s.root, feature), true);
      const gate = checkAuthoritativeContentAligned(checkCtx(s, feature), 'acceptance').find(c => c.id === 'authoritative_content_aligned');
      assert(gate?.status === 'FAIL' && gate.repair_owner === 'external', JSON.stringify(gate));
      assert.deepStrictEqual(gate!.structured, { kind: 'design_authority', reason: 'blueprint_ref_stale', codes: ['change_unit_blueprint_ref_stale'] });
      // plan 阶段：手写 contracts 的 change_unit_ref 解析到 canonical CU，CU 的 BLOCKER 只有指针过期 → 路线取验证器 issue 的 route。
      const plan = checkChangeUnitFeatureProjection(checkCtx(s, feature), 'plan');
      const invalid = plan.find(c => c.id === 'change_unit_invalid');
      assert(invalid?.status === 'FAIL' && invalid.repair_owner === 'external' && /P1 调和/.test(invalid.suggestion ?? ''), JSON.stringify(plan.map(c => [c.id, c.status, c.repair_owner, c.details.slice(0, 160)])));
      assert.deepStrictEqual(invalid!.structured, { kind: 'design_authority', reason: 'blueprint_ref_stale', codes: ['change_unit_blueprint_ref_stale'] });
      // 反例：调和后把蓝图内容写坏（验收写成文本）→ 仍是 invalid，但原因不是指针过期，也不是调和候选。
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === CU), JSON.stringify(r));
      bumpBlueprint(s, bp => {
        const visit = (v: unknown): boolean => {
          if (Array.isArray(v)) return v.some(visit);
          if (!v || typeof v !== 'object') return false;
          if ((v as { node_id?: string }).node_id === 'ledger-domain') { (v as { acceptance?: unknown }).acceptance = '验收写成了一段文本'; return true; }
          return Object.values(v).some(visit);
        };
        assert(visit(bp), '快照蓝图缺 ledger-domain');
      });
      const again = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(again.bumped.some(b => b.change_unit_id === CU), JSON.stringify(again));
      clearFrameworkConfigCache();
      const broken = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
      assert(broken.state === 'invalid' && broken.reason === 'other', JSON.stringify({ state: broken.state, reason: broken.reason, detail: broken.detail }));
      assert.strictEqual(pointerStaleCandidate(s.root, feature), false, '内容坏不是调和候选');
      const gate2 = checkAuthoritativeContentAligned(checkCtx(s, feature), 'acceptance').find(c => c.id === 'authoritative_content_aligned');
      // codex t6 第五轮：同一 structured 通道带出 B1 的位置（哪个目标的哪个字段）。
      assert.deepStrictEqual(gate2?.structured, { kind: 'design_authority', reason: 'other', codes: ['authority_content_not_machine_structure'],
        locations: [{ blueprint_id: BLUEPRINT_ID, target: { kind: 'node', view_id: 'logical', id: 'ledger-domain' }, field: 'acceptance' }] });
      // 反例：指针过期同时三处指针身份不一致（契约变化）→ 验证器另有阻断项，不是调和候选（不会交给调和器）。
      bumpBlueprint(s);
      const own = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
      const doc = YAML.parse(own.bytes.toString('utf8'));
      doc.touches[0].design_ref.revision = Number(doc.touches[0].design_ref.revision) + 40;
      fs.writeFileSync(own.canonicalPath, YAML.stringify(doc));
      clearFrameworkConfigCache();
      assert.strictEqual(pointerStaleCandidate(s.root, feature), false, '指针身份不一致不是调和候选');
    }),
  },
  {
    name: 'A4 写入所有权（函数级，真实锁原语）：蓝图锁被占 / 待写 feature 的锁被另一执行者持有 → 调和竞争退出、一个字节不写、readiness 报忙；借出的锁可进行；不留锁文件与空目录',
    run: () => withSnapshot(s => {
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, SNAPSHOT_CU_FEATURE, name), { force: true });
      bumpBlueprint(s);
      const before = cuBytes(s);
      const workspace = featureFilePath(s.root, BLUEPRINT_ID, '');
      const listing = () => fs.readdirSync(workspace).sort();
      const dirs = listing();
      // ① 另一次调和正持有蓝图锁
      const blueprintLock = path.join(workspace, BLUEPRINT_RECONCILE_LOCK_NAME);
      const other = tryAcquireLock(blueprintLock, {})!;
      const busy1 = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(busy1.busy?.includes(RECONCILE_BUSY_HINT) && !busy1.bumped.length && !busy1.skipped.length, JSON.stringify(busy1));
      assert.deepStrictEqual(cuBytes(s), before, '蓝图锁被占时不得写');
      releaseLock(blueprintLock, other.ownerId);
      // ② 兄弟 feature 的锁被另一 run 持有
      const siblingLock = tryAcquireLock(featureLockPath(s, SIBLING), { run_id: 'another-run' })!;
      const busy2 = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(busy2.busy?.includes(SIBLING) && !busy2.bumped.length, JSON.stringify(busy2));
      assert.deepStrictEqual(cuBytes(s), before, '兄弟 feature 持锁时不得写（含本 CU）');
      const readiness = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(readiness.ready === false && readiness.blueprintRefs.busy && readiness.perUnit.length === 0, JSON.stringify(readiness));
      // ③ 同一把锁由调用方借出（owner 复用）→ 可进行；借出的锁不被调和器释放
      const lent = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, SIBLING), ownerId: siblingLock.ownerId }] });
      assert(!lent.busy && lent.bumped.length === Object.keys(before).length && !lent.skipped.length, JSON.stringify(lent));
      assert(fs.existsSync(featureLockPath(s, SIBLING)), '借出的锁不得被调和器释放');
      // 反向：ownerId 不符的"借出"不算持有
      bumpBlueprint(s);
      const wrong = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, SIBLING), ownerId: 'not-the-owner' }] });
      assert(wrong.busy, JSON.stringify(wrong));
      releaseLock(featureLockPath(s, SIBLING), siblingLock.ownerId);
      fs.rmSync(path.dirname(featureLockPath(s, SIBLING)), { recursive: true, force: true });
      const done = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(!done.busy && done.bumped.length === Object.keys(before).length, JSON.stringify(done));
      assert.deepStrictEqual(listing(), dirs, '调和后工作区不得多出锁文件');
      for (const id of Object.keys(before).filter(id => id !== CU)) assert(!fs.existsSync(path.dirname(featureLockPath(s, id))), `${id} 不得留下空 goal-runs 目录`);
    }),
  },
  {
    name: 'A4 两次读取之间蓝图升版（codex 批一 P1）：取锁时本 CU 指针未过期、plan 正持其 feature 锁；取锁之后蓝图升版 → 调和器重定写集时发现本 CU 不在已持锁范围 → 竞争退出，CU 与 plan 写出的 contracts 一个字节不动',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      handWriteProjections(s.root);
      // 兄弟 CU 的 owner 指针不等于当前蓝图身份 → 第一次读取时只有它进取锁范围；本 CU 指针此刻是当前身份。
      const sibling = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING);
      const doc = YAML.parse(sibling.bytes.toString('utf8'));
      doc.component_blueprint_ref.revision = Number(doc.component_blueprint_ref.revision) + 40;
      fs.writeFileSync(sibling.canonicalPath, YAML.stringify(doc));
      const planLock = tryAcquireLock(featureLockPath(s, CU), { run_id: 'plan-in-flight' })!;
      const contractsFile = featureFilePath(s.root, feature, 'contracts.yaml');
      const before = cuBytes(s);
      // 交错点：调和器为兄弟 feature 落锁文件的那一刻（第一次读取之后、重定写集之前），另一设计会话把蓝图升版，
      // 同时 plan 写出新版 contracts。只拦这一次文件创建，不改任何生产行为。
      const siblingLock = path.resolve(featureLockPath(s, SIBLING));
      // import * 的命名空间对象只读；补丁打在真实 fs 模块上（生产代码经 live binding 读到）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = require('fs') as { openSync: unknown };
      const openSync = fs.openSync;
      let interleaved = false;
      let planBytes: Buffer | undefined;
      realFs.openSync = (file: fs.PathLike, ...rest: unknown[]) => {
        if (!interleaved && path.resolve(String(file)) === siblingLock) {
          interleaved = true;
          bumpBlueprint(s);
          const contracts = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
          contracts.files.push('src/ledger/PlanAddedDuringReconcile.ets');
          fs.writeFileSync(contractsFile, YAML.stringify(contracts));
          planBytes = fs.readFileSync(contractsFile);
        }
        return (openSync as (...args: unknown[]) => number)(file, ...rest);
      };
      let result: ReturnType<typeof reconcileChangeUnitBlueprintRefs>;
      try { result = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID); } finally { realFs.openSync = openSync; }
      assert(interleaved && planBytes, '前提：交错已发生');
      assert(result.busy?.includes(RECONCILE_BUSY_HINT) && result.busy.includes(CU) && !result.bumped.length, JSON.stringify(result));
      assert.deepStrictEqual(cuBytes(s), before, '未持锁的 CU 不得被写');
      assert(fs.readFileSync(contractsFile).equals(planBytes!), 'plan 的新写入不得被覆盖');
      assert(fs.existsSync(featureLockPath(s, CU)), 'plan 的锁仍在');
      assert(!fs.existsSync(siblingLock), '调和器自己取的锁已释放');
      // plan 结束放锁后重试：照常升版，plan 的新增内容保留（调和器只动身份行）。
      releaseLock(featureLockPath(s, CU), planLock.ownerId);
      const retry = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(!retry.busy && retry.bumped.some(b => b.change_unit_id === CU), JSON.stringify(retry));
      assert(YAML.parse(fs.readFileSync(contractsFile, 'utf8')).files.includes('src/ledger/PlanAddedDuringReconcile.ets'), '重试后 plan 的新增内容仍在');
    }),
  },
  // A2 主线与两个反例：只在 reliability-scenarios 的 S14 里跑（plan b0e0621c §3.3，断言并入 s14Run）。
  {
    name: 'A4 兄弟 feature 反例（真实 run）：run 内调和遇到兄弟 feature 被另一 run 持锁 → 竞争退出、不写任何 CU，落回停机并说明"竞争解除后重发即可，不需要改设计内容"',
    run: () => withHost(async s => {
      let held: { ownerId: string } | null = null;
      let before: Record<string, string> = {};
      const run = await runWithStalePointerAtPlan(s, {
        atInjection: () => { held = tryAcquireLock(featureLockPath(s, SIBLING), { run_id: 'sibling-run' }); before = cuBytes(s); },
        afterRun: () => { if (held) releaseLock(featureLockPath(s, SIBLING), held.ownerId); },
      });
      console.log(`[design-authority-repair] A4-sibling ${describeRun(run)}`);
      assert(held, '前提：兄弟 feature 的锁已被占');
      const [repair] = repairs(run);
      assert(repair && repair.outcome === 'not_reconciled' && !repair.bumped.length && String(repair.reason).includes(RECONCILE_BUSY_HINT), describeRun(run));
      assert.deepStrictEqual(cuBytes(s), before, '竞争退出时不得写任何 CU');
      const halt = lastHalt(run);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && String(halt.halt_guidance).includes(RECONCILE_BUSY_HINT), describeRun(run));
      assert.strictEqual(run.planInvokes, 1);
    }),
  },
  {
    name: 'B4-table 分类表：机器内容文字归 B1；需要裁决、缺事实、扩大范围与混合原因码归 B2；空集、未登记及已退役映射码一律 B2',
    run: async () => {
      assert.strictEqual(classifyDesignAuthorityCodes(['authority_content_not_machine_structure']).class, 'B1');
      for (const code of ['a_code_added_later', 'authority_cu_mapping_stale', 'authority_cu_mapping_conflict']) {
        const unlisted = classifyDesignAuthorityCodes([code]);
        assert(unlisted.class === 'B2' && /未登记/.test(unlisted.needs.join()), `未列入的原因码默认 B2：${JSON.stringify(unlisted)}`);
      }
      assert.strictEqual(classifyDesignAuthorityCodes([]).class, 'B2', '没有原因码不得当成 B1');
      for (const code of [
        'change_unit_current_design_unresolved', 'change_unit_contract_not_admitted', 'cu_architecture_impact_not_effective', 'cu_scope_matches_blueprint',
        'change_unit_schema_invalid', 'change_unit_design_ref_unresolvable', 'change_unit_blueprint_unresolvable', 'authority_contract_files_missing',
        'authority_content_conflict', 'authority_target_provenance_missing', 'change_unit_blueprint_ref_stale', 'component_blueprint_invalid', 'change_unit_missing',
        'authority_content_missing', 'authority_projection_shape_invalid',
      ]) {
        const verdict = classifyDesignAuthorityCodes([code]);
        assert(verdict.class === 'B2' && verdict.needs.length === 1 && !/未登记/.test(verdict.needs[0]), `${code} 应登记为 B2 并写清缺什么：${JSON.stringify(verdict)}`);
      }
      const mixed = classifyDesignAuthorityCodes(['authority_content_not_machine_structure', 'change_unit_current_design_unresolved']);
      assert(mixed.class === 'B2' && mixed.needs.length === 2, `B1 与 B2 混合按 B2：${JSON.stringify(mixed)}`);
    },
  },
  {
    name: 'B4-codes 原因码由真实投影生产者给出：整段内容写成文字 → B1；内容为 null / 数字或缺路径且无替代 → 不得判 B1',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      // Pure design has no stage outputs to refresh; stamped-file supplementation has its own tests.
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, feature, name), { force: true });
      let base: Ev | undefined;
      /** 设计 owner 升一个 revision 并改 ledger-domain（其余保持原样），调和指针后取真实投影的原因码与分类。 */
      const project_ = (kind: 'acceptance' | 'contracts', mutate: (node: Ev) => void): { codes: string[]; cls: string; detail: string; locations: unknown } => {
        bumpBlueprint(s, bp => { const node = ledgerDomain(bp); base ??= structuredClone(node); restoreNode(node, base); mutate(node); });
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.some(x => x.change_unit_id === CU), JSON.stringify(r));
        clearFrameworkConfigCache();
        const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, kind);
        assert.strictEqual(projected.state, 'invalid', `前提：投影无效：${JSON.stringify({ state: projected.state, detail: projected.detail })}`);
        return { codes: projected.codes ?? [], cls: classifyDesignAuthorityCodes(projected.codes ?? []).class, detail: String(projected.detail), locations: projected.locations };
      };
      // 正例：完整内容写成了一段文字 → 有原文可依。
      const prose = project_('acceptance', node => { node.acceptance = TEXT_ACCEPTANCE; });
      assert(prose.cls === 'B1' && prose.codes.join() === 'authority_content_not_machine_structure', JSON.stringify(prose));
      // codex t6 第五轮：B1 发现项带位置（哪个 design_ref 目标的哪个字段），无人值守修复只许改这里。
      const ledgerTarget = (cu: Ev): Ev => (cu.design_refs as Ev[]).find(ref => ref.target.id === 'ledger-domain')!.target;
      const target = ledgerTarget(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).changeUnit as Ev);
      assert.deepStrictEqual(prose.locations, [{ blueprint_id: BLUEPRINT_ID, target, field: 'acceptance' }], `文字位置：${JSON.stringify(prose.locations)}`);
      // 反例：内容是 null / 数字 / 空串——没有可恢复的内容。
      for (const empty of [null, 3, '  ']) {
        const missing = project_('acceptance', node => { node.acceptance = empty; });
        assert(missing.cls === 'B2' && missing.codes.join() === 'authority_content_missing', `${JSON.stringify(empty)} 不得判 B1：${JSON.stringify(missing)}`);
      }
      // 反例：施工契约缺必填路径（modules[].package_path），没有确定的替代值。
      const noPath = project_('contracts', node => { delete node.contracts.modules[0].package_path; });
      assert(noPath.cls === 'B2' && noPath.codes.length > 0, `缺路径且无替代不得判 B1：${JSON.stringify(noPath)}`);
      console.log(`[design-authority-repair] B4-codes 缺路径=${JSON.stringify(noPath)}`);
    }),
  },
  {
    name: 'R3 legacy 蓝图映射不再触发 B1（真实快照 + 真实调和）：旧 revision 或其它 CU 的映射不进入设计投影，也不删改 canonical 旧材料',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, feature, name), { force: true });
      const currentCuRef = (): Ev => {
        const loaded = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
        const cu = loaded.changeUnit as Ev;
        return { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: loaded.artifactSha256 };
      };
      const oldRef = currentCuRef();
      for (const ref of [oldRef, { ...oldRef, change_unit_id: SIBLING }]) {
        bumpBlueprint(s, bp => { ledgerDomain(bp).contracts.change_unit.change_unit_ref = ref; });
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.some(x => x.change_unit_id === CU), JSON.stringify(r));
        clearFrameworkConfigCache();
        const before = fs.readFileSync(blueprintFile(s));
        const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'contracts');
        assert.strictEqual(projected.state, 'resolved', projected.detail);
        assert.strictEqual((projected.value as Ev).change_unit, undefined, '专属映射不再来自蓝图');
        assert(!projected.codes?.some(code => code.startsWith('authority_cu_mapping')), JSON.stringify(projected.codes));
        assert(!projected.locations?.length, '合法设计不产生蓝图映射修复位置');
        assert(fs.readFileSync(blueprintFile(s)).equals(before), '设计投影不得删改 canonical 旧映射');
        assert.deepStrictEqual(ledgerDomain(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint).contracts.change_unit.change_unit_ref, ref);
      }
    }),
  },
  {
    name: 'B1-mixed 机器内容形状与真实DSL冲突：两条原因都解除才就绪，续跑或后继仍由既有绑定判断',
    run: () => withHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const contractsFile = featureFilePath(s.root, feature, 'contracts.yaml');
      const configFile = path.join(s.root, 'framework.config.json');
      const configBytes = fs.readFileSync(configFile);
      let saved: Ev | undefined;
      const run = await runWithStalePointerAtPlan(s, {
        atInjection: () => {
          const bp = YAML.parse(fs.readFileSync(blueprintFile(s), 'utf8'));
          saved = structuredClone(ledgerDomain(bp));
          ledgerDomain(bp).acceptance = TEXT_ACCEPTANCE;
          bp.decisions_and_gaps.decisions.push({ decision_id: 'mixed-remove-edge', kind: 'architecture_impact', change: 'dependency_edge',
            from: 'ledger', to: 'FinancialCard', direction: 'remove', status: 'decided_with_authority', owner: 'design-owner',
            rationale: '领域不依赖页面', verification_refs: ['view:development'], provenance: structuredClone(bp.provenance) });
          fs.writeFileSync(blueprintFile(s), YAML.stringify(bp));
        },
      });
      const runId = run.successor;
      assert(repairs(run)[0]?.outcome === 'reconciled', describeRun(run));
      const halt = haltOf(run.events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.phase === 'plan' && halt.probe === 'design_authority_projectable', JSON.stringify(halt));
      const items = halt!.design_authority as { class: string; items: Array<{ check: string; class: string; codes: string[] }> };
      assert.deepStrictEqual(items.items.map(item => item.check + ':' + item.class + ':' + item.codes.join(',')).sort(),
        ['authoritative_content_aligned:B1:authority_content_not_machine_structure', 'cu_architecture_impact_not_effective:B2:cu_architecture_impact_not_effective'], JSON.stringify(items));
      assert.equal(items.class, 'B2');
      const dir = reportDirOf(s, feature, runId);
      const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, runId, 'manifest.json')).requirement;
      const probe = () => { clearFrameworkConfigCache(); return runConditionProbe(s.root, dir, 'design_authority_projectable', 'plan'); };
      const decide = (extra: Partial<Parameters<typeof decideRunContinuation>[0]> = {}, call: Record<string, unknown> = {}) => {
        clearFrameworkConfigCache(); return decideRunContinuation({ projectRoot: s.root, feature, call: { requirement, ...call }, ...extra });
      };
      const both = probe();
      assert(!both.ready && /authoritative_content_aligned/.test(both.reason!) && /cu_architecture_impact_not_effective/.test(both.reason!), JSON.stringify(both));
      assert(!/external_condition_ready/.test(JSON.stringify(decide())), '原因未解除不能声称探针就绪');
      repairViaReadiness(s, node => restoreNode(node, saved!), 'restore structured acceptance, keep the real DSL mismatch');
      const one = probe();
      assert(!one.ready && /cu_architecture_impact_not_effective/.test(one.reason!), JSON.stringify(one));
      const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'contracts');
      assert(!projected.codes?.includes('authority_content_not_machine_structure'), '第一条结构问题已经实际修复');
      assert(!/external_condition_ready/.test(JSON.stringify(decide())), '只修一条不能放行');
      const model = decide({}, { model: 'another-model' });
      assert(model.kind === 'successor' && model.change === 'model_changed', JSON.stringify(model));
      // 设计 owner 撤回原需求未要求的删边决定，保留原有效架构；不是 plan 自改许可。
      bumpBlueprint(s, bp => { const decisions = bp.decisions_and_gaps as Ev; decisions.decisions = decisions.decisions.filter((decision: Ev) => decision.decision_id !== 'mixed-remove-edge'); });
      const readiness = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(!readiness.blueprintRefs.busy && readiness.blueprintRefs.bumped.some(row => row.change_unit_id === CU), JSON.stringify(readiness.blueprintRefs));
      assert(fs.readFileSync(configFile).equals(configBytes), '没有修改DSL或伪造环境新鲜度');
      clearFrameworkConfigCache();
      const writer = tryAcquireLock(featureLockPath(s, CU), { run_id: 'plan-owner-rebind' });
      assert(writer, '停放后才能由责任方重签');
      try { writeDoc(contractsFile, authorCurrentCuPlan(s.root, readDoc(contractsFile))); }
      finally { releaseLock(featureLockPath(s, CU), writer!.ownerId); }
      const ready = probe(); assert(ready.ready, JSON.stringify(ready));
      const resumed = decide();
      assert(resumed.kind === 'rejoin' || resumed.kind === 'successor', JSON.stringify(resumed));
      assert(!/external_condition_ready/.test(JSON.stringify(decide({ runProbe: () => ({ ready: false }) }))), '探针假值不能成为外部恢复事实');
    }),
  },
  // S15 四支、S16 主线与两个绑定失效支、S16-c1 无预授权：只在 reliability-scenarios 的 S15 / S16 里跑（plan b0e0621c §3.3，断言在共享流程函数里）。
  {
    name: 'S16-c1804p physical exit after publication before event resumes original transaction without a second revision',
    run: async () => {
      const { spawn } = require('child_process') as typeof import('child_process');
      const metadataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-publication-cut-'));
      const metadataFile = path.join(metadataDir, 'cut.json');
      const reportDir = path.resolve(__dirname, '../../reports/1804ac3b');
      fs.mkdirSync(reportDir, { recursive: true });
      let restored: Snapshot | undefined;
      try {
        const child = spawn(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--project', path.resolve(__dirname, '../../tsconfig.json'), path.resolve(__dirname, '../utils/design-publication-fault-worker.ts'), metadataFile],
          { cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let output = ''; child.stdout?.on('data', chunk => { output = (output + chunk).slice(-8000); }); child.stderr?.on('data', chunk => { output = (output + chunk).slice(-8000); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
        const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        clearTimeout(timer);
        assert.strictEqual(code, 77, `must cut the actual process at canonical rename: ${output}`);
        const metadata = readJson<Snapshot & { feature: string; cutRevision: number; cutAt: string }>(metadataFile); restored = metadata;
        const feature = metadata.feature;
        const [runId] = runIds(metadata.root, feature);
        const before = eventsOf(metadata, feature, runId);
        assert(contentRepairs(before).some(event => event.stage === 'attempted') && !contentRepairs(before).some(event => event.stage === 'published'), 'publication event must actually be absent at the physical crash');
        await runGoalModeSessionStep({ projectRoot: metadata.root, frameworkRoot: metadata.frameworkRoot, feature, runId, adapter: 'codex', runMode: 'attended',
          authorization: { mode: 'goal_mode', autonomyAuthorized: true } });
        const recoveredPrefix = eventsOf(metadata, feature, runId);
        assert.strictEqual(contentRepairs(recoveredPrefix).filter(event => event.stage === 'published').length, 1, `the original publication must be finalized before scope continuation: ${describeS16({ events: recoveredPrefix })}`);
        const p = project(metadata, feature);
        const hooks = specFirstCuHooks(p, true);
        const resumed = await runGoalRuntimeChain(metadata.root, { frameworkRoot: metadata.frameworkRoot, featureId: feature, adapter: 'codex', resume: runId,
          ...hooks, viaSessionStep: true, sessionSelfCheck: true, skipLegacySeal: true,
          hostAuthorization: { mode: 'goal_mode', autonomyAuthorized: true } });
        const all = runIds(metadata.root, feature).flatMap(id => eventsOf(metadata, feature, id));
        assert.strictEqual(Number(loadCanonicalBlueprint(metadata.root, BLUEPRINT_ID).blueprint.revision), metadata.cutRevision, 'publication recovery must not bump canonical twice');
        assert.strictEqual(outOfChainStarts(all).length, 2, 'publication recovery must consume both original reports without another design invocation');
        assert.strictEqual(contentRepairs(all).filter(event => event.stage === 'attempted').length, 1);
        assert.strictEqual(contentRepairs(all).filter(event => event.stage === 'published').length, 1);
        assert(contentRepairs(all).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16({ events: all }));
        assert.strictEqual(resumed.exitCode, 0, describeS16({ events: all }));
        fs.writeFileSync(path.join(reportDir, 'design-publication-fault.json'), JSON.stringify({ physical_exit: code, cut_at: metadata.cutAt,
          cut_revision: metadata.cutRevision, final_revision: Number(loadCanonicalBlueprint(metadata.root, BLUEPRINT_ID).blueprint.revision),
          design_invokes: outOfChainStarts(all).length, attempted: 1, published: 1, final_status: endOf(all)?.status,
          boundary: 'author and independent-verifier outputs are deterministic model substitutes; original CLI/runtime, filesystem publication, native harness, CU reconciliation and finalizers are real; no device' }, null, 2) + '\n');
      } catch (error) {
        const diagnostic = restored ? { root: restored.root, runs: runIds(restored.root, SNAPSHOT_CU_FEATURE).map(id => ({ run_id: id, events: eventsOf(restored!, SNAPSHOT_CU_FEATURE, id) })) } : {};
        fs.writeFileSync(path.join(reportDir, 'design-publication-fault-diagnostic.json'), JSON.stringify({ error: String((error as Error).stack ?? error), ...diagnostic }, null, 2) + '\n');
        throw error;
      } finally {
        clearFrameworkConfigCache();
        if (restored) fs.rmSync(restored.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        fs.rmSync(metadataDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'S16-c1c 有人在场（会话 owner，host bridge）+ 预授权 + B1 → 不派发，交会话里的设计 owner',
    run: () => withFreshCuHost(async s => {
      // 用兄弟 CU 的 fresh run：会话 owner 经 host bridge 出生（本 CU 的后继出生在 host bridge 上受快照里历史绝对路径的影响依据所限）。
      const { b } = await siblingFreshRun(s, { viaHostBridge: true });
      console.log(`[design-authority-repair] S16-c1c ${describeS16(b)}`);
      assert(!contentRepairs(b.events).length && !outOfChainStarts(b.events).length, `有人在场不得派发：${describeS16(b)}`);
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.design_authority?.class === 'B1', `应停在设计 owner 出口：${describeS16(b)}`);
    }),
  },
  {
    name: 'S16-c1b 旧个人预授权字符串不再阻断原需求内无人值守设计修订',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { preauth: 'true' });
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16(b));
      assertCompletedBy(s, b.feature, b.runId, '旧个人开关不替代原任务授权');
    }),
  },
  {
    name: 'S16-c5bdd 原需求内架构和CU内容借锁修订、正式发布并自动接续施工',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { preauth: false, allowSuccessors: true,
        adapter: { author: (doc, draft) => {
          const architectureFile = path.join(path.dirname(draft), 'architecture.json');
          const architecture = readJson<Ev>(architectureFile);
          const layer = architecture.outer_layers.find((row: Ev) => row.id === '02-Feature');
          layer.intra_layer_deps = 'sublayer';
          layer.sublayers = [
            { id: 'ledger-domain', members_pattern_or_list: ['ledger'], can_depend_on_sublayers: [] },
            { id: 'card-view', members_pattern_or_list: ['FinancialCard'], can_depend_on_sublayers: ['ledger-domain'] },
          ];
          fs.writeFileSync(architectureFile, JSON.stringify(architecture));
          const decision = { decision_id: 'ledger-dependency', kind: 'architecture_impact', change: 'dependency_edge', from: 'ledger', to: 'FinancialCard', direction: 'remove',
            status: 'decided_with_authority', rationale: '原账务需求中领域不依赖页面，实现既有领域职责', owner: 'design-owner', verification_refs: ['view:development'], provenance: structuredClone(doc.provenance) };
          doc.decisions_and_gaps.decisions.push(decision);
          doc.decisions_and_gaps.decisions.push({ ...decision, decision_id: 'ledger-responsibility', change: 'responsibility_rewrite',
            module: 'ledger', rationale: '账务领域只维护稳定账目投影，展示和导航职责仍归页面模块' });
          ledgerDomain(doc).target_state = 'Stable ledger domain projection; presentation and navigation remain in FinancialCard';
          (ledgerDomain(doc).design_basis_refs ??= []).push('decision:ledger-dependency', 'decision:ledger-responsibility');
        } },
      });
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered' && event.architecture_changed === true), describeS16(b));
      const cu = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).changeUnit;
      assert((cu.design_refs as Ev[]).some(ref => ref.target.id === 'ledger-dependency'), 'content revision must run through the real CU consumer while borrowing feature locks');
      assert((cu.design_refs as Ev[]).some(ref => ref.target.id === 'ledger-responsibility'), 'module responsibility revision must use the same closure and content consumer');
      const config = readJson<Ev>(path.join(s.root, 'framework.config.json'));
      assert.equal(config.architecture.outer_layers.find((row: Ev) => row.id === '02-Feature').intra_layer_deps, 'sublayer');
      assert(b.events.some(event => event.type === 'agent_invoke_start' && event.phase === 'coding'), describeS16(b));
      assertCompletedBy(s, b.feature, b.runId, '架构/CU修订后自动继续');
      assertAttemptCleanedUp(s);
    }),
  },
  {
    name: 'S16-c2 草稿外改动：编写调用改了需求、契约与个人配置 → 不发布，走既有违规处置（phase_write_violation + 违规停机出口，不降为设计等待），事件披露路径与前后哈希；被改文件不还原',
    run: () => withFreshCuHost(async s => {
      const touched = ['requirements/ledger.md', 'contracts/ledger-api.yaml', 'framework.local.json', 'context/ledger-api.yaml'];
      const b = await s16Born(s, {
        ancestor: true,
        // 工作区外、位于通常排除目录（context/）里的实际引用输入：蓝图的契约来源指向它（内容与原契约文件相同，校验照常通过）。
        beforeCorrupt: () => {
          fs.mkdirSync(path.join(s.root, 'context'), { recursive: true });
          fs.copyFileSync(path.join(s.root, 'contracts', 'ledger-api.yaml'), path.join(s.root, 'context', 'ledger-api.yaml'));
          const text = fs.readFileSync(blueprintFile(s), 'utf8').split('source_ref: contracts/ledger-api.yaml#').join('source_ref: context/ledger-api.yaml#');
          fs.writeFileSync(blueprintFile(s), text);
          const blockers = blockerIssues(validateComponentBlueprint(YAML.parse(text), { projectRoot: s.root }));
          assert(!blockers.length, `前提：改指 context/ 下的契约来源后蓝图仍合法：${blockers.map(i => i.id).join(',')}`);
        },
        adapter: { author: (_doc, draft) => {
        for (const rel of touched.slice(0, 2)) fs.appendFileSync(path.join(s.root, rel), '\n# 修复调用顺手改的\n');
        // 只改注释：契约语义校验仍会通过，必须靠核对范围检出。
        fs.appendFileSync(path.join(s.root, 'context', 'ledger-api.yaml'), '\n# 修复调用顺手改的注释\n');
        const local = readJson<Record<string, unknown>>(LOCAL_FILE(s));
        (local.vision as Ev).canary.probed_at = '2026-10-01T00:00:00.000Z';
        fs.writeFileSync(LOCAL_FILE(s), JSON.stringify(local, null, 2));
        // 本任务在 goal-runs 下的实际输入：本 run 的 manifest、祖先 run 的事件（判重与预算回放读它们）。
        const runDir = path.dirname(path.dirname(draft));
        const ancestor = fs.readdirSync(path.dirname(runDir)).map(id => path.join(path.dirname(runDir), id))
          .find(dir => dir !== runDir && fs.existsSync(path.join(dir, 'events.jsonl')))!;
        for (const file of [path.join(runDir, 'manifest.json'), path.join(ancestor, 'events.jsonl')]) {
          fs.appendFileSync(file, '\n');
          touched.push(path.relative(s.root, file).replace(/\\/g, '/'));
        }
        // 本 run 的事件只许运行时追加自己的事件：调用追加一条伪造的阶段结论也算越界。
        const ownEvents = path.join(runDir, 'events.jsonl');
        fs.appendFileSync(ownEvents, `${JSON.stringify({ ts: new Date().toISOString(), type: 'phase_verdict', phase: 'spec', verdict: 'PASS' })}\n`);
        touched.push(path.relative(s.root, ownEvents).replace(/\\/g, '/'));
      } } });
      console.log(`[design-authority-repair] S16-c2 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '越界写入');
      assert.deepStrictEqual((failed.files as Ev[]).map(f => f.path).sort(), [...touched].sort(), `事件须披露被改路径：${JSON.stringify(failed.files)}`);
      assert((failed.files as Ev[]).every(f => /^[0-9a-f]{64}$/.test(f.pre_sha256) && /^[0-9a-f]{64}$/.test(f.post_sha256) && f.pre_sha256 !== f.post_sha256), '事件须带前后哈希');
      const violation = b.events.find(e => e.type === 'phase_write_violation');
      assert(violation && violation.phase === 'design-repair-author' && (violation.violations as Ev[]).map(v => v.path).sort().join() === [...touched].sort().join(), `应落既有违规事件：${JSON.stringify(violation)}`);
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'backtrack_target_absent' && !halt.probe && /请用户核对并恢复工程文件/.test(String(halt.halt_guidance)), `应走既有违规停机出口、不挂探针：${JSON.stringify(halt)}`);
      assert(endOf(b.events)?.status !== 'CHAIN_SLICE_COMPLETED', '不得完成');
      // "不发布"与"未发生越界改写"是两个断言：canonical 没变，但被改的文件仍是改后的样子（只检测、不还原）。
      assert(/修复调用顺手改的/.test(fs.readFileSync(path.join(s.root, touched[0]), 'utf8')) && readJson<Ev>(LOCAL_FILE(s)).vision.canary.probed_at === '2026-10-01T00:00:00.000Z', '框架不替操作者还原');
    }),
  },
  {
    name: 'S16-c2b 必需快照不可验证：编写调用之后草稿外某个文件读不出来 → 不当作干净继续，不发布，同样走违规停机出口',
    run: () => withFreshCuHost(async s => {
      const target = path.resolve(s.root, 'requirements', 'ledger.md');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = require('fs') as { readFileSync: unknown };
      const readFileSync = fs.readFileSync;
      const b = await s16Born(s, { adapter: { author: () => {
        // 只让调用之后的第一次读取失败（权限 / 占用的替身），随即恢复——不改任何生产行为。
        realFs.readFileSync = (file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
          if (typeof file === 'string' && path.resolve(file) === target) {
            realFs.readFileSync = readFileSync;
            throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
          }
          return (readFileSync as (...a: unknown[]) => unknown)(file, ...rest);
        };
      } } }).finally(() => { realFs.readFileSync = readFileSync; });
      console.log(`[design-authority-repair] S16-c2b ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '快照不可验证');
      assert(/不可核实/.test(String(failed.reason)) && !failed.files, JSON.stringify(failed));
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'backtrack_target_absent' && /无法核对/.test(String(halt.halt_guidance)), `不可验证也不得降为设计等待：${JSON.stringify(halt)}`);
    }),
  },
  {
    name: 'S16-c3a 质询 provider 不可用（非正常退出）→ 不发布、不伪造质询报告，停等并披露失败步骤；c5 同一签名：显式 --resume 再次停在同一处、起后继，都不再派发',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { questioning: doc => { delete doc.review_summary.questioning; return { exitCode: 1, stdout: '', stderr: 'questioning provider unavailable' }; } } });
      console.log(`[design-authority-repair] S16-c3a ${describeS16(b)}`);
      assertNotPublished(s, b, 'questioning', '质询不可用');
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && /尝试失败（步骤 questioning）/.test(String(halt.halt_guidance)) && /唯一一次自动修复机会/.test(String(halt.halt_guidance)), `停等并披露：${JSON.stringify(halt?.halt_guidance)}`);
      // c5 同一签名第二次停机（同一 run）：显式 --resume 对 HALTED run 有冷却（生产 5 分钟，--force 也不越过），等冷却过去再由操作者
      // 显式 --resume --force-resume——同一 run 重评同一阶段、再次停在同一签名，按本 run 的事件回放读到 attempted → 不再派发。
      // plan b0e0621c §3.2：只在这一次调用期间包装既有恢复守卫、传短冷却（生产缺省值不变），等的仍是真实冷却。
      const endTs = Date.parse(String(endOf(b.events)?.ts));
      const waitMs = endTs + SHORT_RESUME_COOLDOWN_MS + 2_000 - Date.now();
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      const { value: resumed, guardCalls } = await withResumeCooldown(SHORT_RESUME_COOLDOWN_MS, () =>
        runGoalRuntimeChain(s.root, { frameworkRoot: s.frameworkRoot, featureId: b.feature, resume: b.runId, forceResume: true, noAutoForce: true, ...authorsForContinuation(s, b.feature) }));
      assert.strictEqual(guardCalls, 1, '显式 resume 经过恢复守卫一次（短冷却已生效）');
      const sameRun = eventsOf(s, b.feature, b.runId);
      console.log(`[design-authority-repair] S16-c5 resume exit=${resumed.exitCode} ${describeS16({ events: sameRun })}`);
      assert(sameRun.filter(e => e.type === 'run_start').length === 2, `前提：resume 确实重评了同一阶段：${describeS16({ events: sameRun })}`);
      assert(contentRepairs(sameRun).filter(e => e.stage === 'attempted').length === 1 && outOfChainStarts(sameRun).length === 2, `resume 后同签名不得再派发：${describeS16({ events: sameRun })}`);
      assert.strictEqual(haltOf(sameRun)?.halt_reason, 'execution_scope_unresolved', '再次停在设计 owner 出口');
      // c5：起后继（承接停机 run，操作者显式 --supersede）→ 后继出生时按既有祖先事件回放读到同一签名的 attempted → 不派发。
      const next = await supersede(s, b.feature, b.runId, b.chain, { ...authorsForContinuation(s, b.feature), noAutoForce: true });
      assert(next.successor, `后继未出生：${next.error}`);
      const succ = eventsOf(s, b.feature, next.successor!);
      console.log(`[design-authority-repair] S16-c5 successor ${describeS16({ events: succ })}`);
      assert(!contentRepairs(succ).length && !outOfChainStarts(succ).length && haltOf(succ)?.halt_reason === 'execution_scope_unresolved', `后继不得再派发：${describeS16({ events: succ })}`);
    }),
  },
  {
    name: 'S16-c3b 质询调用正常退出但没有合法新结果 → 不沿用旧报告，不发布',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { questioning: doc => { delete doc.review_summary.questioning; } } });
      console.log(`[design-authority-repair] S16-c3b ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '质询无结果');
      assert(/没有产出质询结果/.test(String(failed.reason)), JSON.stringify(failed));
    }),
  },
  {
    name: 'S16-c3c 编写调用自报准入（改了 review_summary.admission）→ 不予采信，不发布',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { author: doc => { doc.review_summary.admission.current_slice.controlled_fakes = ['self-asserted-pass']; } } });
      console.log(`[design-authority-repair] S16-c3c ${describeS16(b)}`);
      assertNotPublished(s, b, 'self_reported', '自报准入');
      assert(!b.log.prompts['design-repair-questioning'], '自报之后不得再派质询调用');
    }),
  },
  {
    name: 'S16-c3d 修复后准入不通过（质询结果缺必答范围）→ 机器派生不过，不发布',
    run: () => withFreshCuHost(async s => {
      // codex t6 第五轮之后，编写调用改指纹等定位之外的内容在授权边界就被拒（见 S16-r7）；准入派生不过改由质询结果触发。
      const b = await s16Born(s, { adapter: { questioning: doc => { doc.review_summary.questioning.items = []; } } });
      console.log(`[design-authority-repair] S16-c3d ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'validation', '准入不过');
      assert(/准入（blocker）/.test(String(failed.reason)) && failed.admission_after_questioning === 'blocker', JSON.stringify(failed));
    }),
  },
  {
    name: 'S16-c3e 预算：编写调用之后剩余调用次数不足 → 不启动质询调用（实际启动一次计一次，与事件回放同步），不发布',
    // 后继的预算继承源 run（且按交付周期累计），所以用兄弟 CU 的 fresh run：出生时 max_total_turns=2（spec 一次 + 编写一次）。
    run: () => withFreshCuHost(async s => {
      const { b, adapter, exitCode } = await siblingFreshRun(s, { freshBudget: { max_total_turns: 2 } });
      const probe = { exitCode };
      console.log(`[design-authority-repair] S16-c3e exit=${probe.exitCode} ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '预算不足');
      assert(/未启动/.test(String(failed.reason)) && outOfChainStarts(b.events).length === 1 && !adapter.log.prompts['design-repair-questioning'], JSON.stringify(failed));
      assert.strictEqual(b.events.filter(e => e.type === 'agent_invoke_start').length, 2, '调用次数 = 实际启动的调用（spec 一次 + 编写一次）');
    }),
  },
  {
    name: 'S16-c4 B2 原需求内缺口由设计责任方修订并继续',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { corrupt: node => { node.acceptance = null; } });
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16(b));
      assertCompletedBy(s, b.feature, b.runId, 'B2 原需求内修订');
    }),
  },
  {
    name: 'S16-c7a 发布成功、探针不过（修法把内容写成了空）→ 不回滚发布，记未恢复，按发布后的新状态（B2）停机并披露已发布 rev 与卡点',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { fix: node => { node.acceptance = null; } } });
      console.log(`[design-authority-repair] S16-c7a ${describeS16(b)}`);
      const published = contentRepairs(b.events).find(e => e.stage === 'published');
      assert(published?.outcome === 'unrecovered' && published.failed_step === 'probe' && published.new_revision === b.baseRevision + 1, describeS16(b));
      assert.strictEqual(readDoc(blueprintFile(s)).revision, b.baseRevision + 1, '发布不回滚');
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.design_authority?.class === 'B2' && /已发布 rev \d+、探针未通过/.test(String(halt.halt_guidance)), `按新状态停机并披露：${JSON.stringify(halt)}`);
      const final = assess(s, b.feature);
      assert(!(final.complete && final.record.state !== 'absent' && final.record.run_id === b.runId), `不得宣称完成：${brief(final)}`);
    }),
  },
  {
    name: 'S16-c7b 蓝图已发布、CU内容提交失败 → 不回滚发布，如实记未恢复并停机',
    run: () => withFreshCuHost(async s => {
      // 内容 consumer 先于指针调和；在真正提交 CU 的入口注入失败，不能只拦后面的重复升指针。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const preparation = require('../../scripts/utils/change-unit-design-preparation') as { reviseChangeUnitContent: (...args: unknown[]) => unknown };
      const real = preparation.reviseChangeUnitContent;
      let b: Awaited<ReturnType<typeof s16Born>>;
      try {
        b = await s16Born(s, { adapter: { questioning: () => {
          preparation.reviseChangeUnitContent = () => { preparation.reviseChangeUnitContent = real; throw new Error('injected: CU content commit failed'); };
        } } });
      } finally {
        preparation.reviseChangeUnitContent = real;
      }
      console.log(`[design-authority-repair] S16-c7b ${describeS16(b)}`);
      const repairs_ = contentRepairs(b.events);
      const published = repairs_.find(e => e.stage === 'published');
      assert(published?.outcome === 'unrecovered' && published.failed_step === 'reconcile' && !repairs_.some(e => e.stage === 'failed'), describeS16(b));
      assert(readDoc(blueprintFile(s)).revision === b.baseRevision + 1 && !pointsAtCurrentBlueprint(s, CU), '蓝图已发布、CU 仍指旧 revision（不回滚）');
      assert(/已发布 rev \d+、调和未完成/.test(String(haltOf(b.events)?.halt_guidance)), JSON.stringify(haltOf(b.events)));
      assertAttemptCleanedUp(s);
    }),
  },
  {
    name: 'D5 草稿对象校验与发布后一致：同一合法蓝图内容在 canonical 位置与草稿对象上（真实宿主根作 context）校验结果相同；反例：把草稿目录当 projectRoot 会误报',
    run: () => withSnapshot(s => {
      const loaded = loadCanonicalBlueprint(s.root, BLUEPRINT_ID);
      const context = { projectRoot: s.root, canonicalPath: loaded.canonicalPath };
      const atCanonical = validateComponentBlueprint(loaded.blueprint, context).map(i => `${i.severity}:${i.id}@${i.path}`).sort();
      const draftDir = fs.mkdtempSync(path.join(s.root, 'draft-'));
      fs.copyFileSync(loaded.canonicalPath, path.join(draftDir, 'component-blueprint.yaml'));
      const draft = YAML.parse(fs.readFileSync(path.join(draftDir, 'component-blueprint.yaml'), 'utf8'));
      const asDraft = validateComponentBlueprint(draft, context).map(i => `${i.severity}:${i.id}@${i.path}`).sort();
      assert.deepStrictEqual(asDraft, atCanonical, '草稿对象 + 真实宿主根与 canonical 校验结果一致');
      assert(!atCanonical.some(x => x.startsWith('BLOCKER:')), `前提：夹具蓝图合法：${JSON.stringify(atCanonical)}`);
      const wrongRoot = blockerIssues(validateComponentBlueprint(draft, { projectRoot: draftDir }));
      console.log(`[design-authority-repair] D5 草稿目录当根的 BLOCKER=${wrongRoot.length}`);
      assert(wrongRoot.length > 0, '反例：以草稿目录为根会因找不到宿主里的需求 / 合同而误报');
      // 准入写回同源：派生函数对合法蓝图给出的值与盘上准入一致。
      const derived = deriveBlueprintAdmission(loaded.blueprint, validateComponentBlueprintUpstream(loaded.blueprint, context));
      const admission = (loaded.blueprint.review_summary as Ev).admission;
      assert(derived.status === admission.status && derived.root_questions_complete === admission.root_questions_complete
        && derived.contracts_ready === admission.current_slice.contracts_ready && derived.design_refs_ready === admission.current_slice.design_refs_ready, JSON.stringify({ derived, admission }));
    }),
  },
  {
    name: 'S16-c6 两个真实 run 竞争同一蓝图的修复：兄弟 CU 的 run 正持锁时本 run 取不到两层锁 → 不派发、停放、不消耗本签名的机会；兄弟 run 随后派发并发布；本 run 冷却期内重发时探针已就绪 → 重新接入并完成（计一次人工重发）；蓝图只发布一次、没有覆盖',
    run: () => withFreshCuHost(async s => {
      const prevCwd = process.cwd();
      process.chdir(s.root);
      let sibling: Awaited<ReturnType<typeof startSiblingRun>> | undefined;
      try {
        const b = await s16Born(s, {
          beforeBirth: async saved => {
            prepareSiblingScope(s);
            sibling = await startSiblingRun(s, saved);
            assert(fs.existsSync(featureLockPath(s, SIBLING)), '前提：兄弟 run 正在 spec 的 agent 调用里、持有自己的 feature 锁');
          },
        });
        console.log(`[design-authority-repair] S16-c6 本 run ${describeS16(b)}`);
        // 本 run：取不到两层锁 → 不派发（没有 attempted、没有链外调用），停在设计 owner 出口，说明写明竞争。
        assertNotDispatched(b, '竞争退出');
        const guidance = String(haltOf(b.events)?.halt_guidance);
        assert(/取不到两层锁，未派发/.test(guidance) && guidance.includes(SIBLING), `说明须写明竞争：${guidance}`);
        assert.strictEqual(readDoc(blueprintFile(s)).revision, b.baseRevision, '竞争退出时蓝图一个字节不写');
        sibling!.release();
        const other = await sibling!.done;
        const [otherRun] = other.runIds;
        const otherEvents = eventsOf(s, SIBLING_FEATURE, otherRun);
        console.log(`[design-authority-repair] S16-c6 兄弟 run exit=${other.exitCode} ${describeS16({ events: otherEvents })}`);
        const published = contentRepairs(otherEvents).find(e => e.stage === 'published');
        assert(published && published.new_revision === b.baseRevision + 1, `兄弟 run 应在本 run 停放后取到锁并发布：${describeS16({ events: otherEvents })}`);
        // 本 run 冷却期内重发同一请求：探针已就绪 → 重新接入同一 run 并完成；不再派发，也不再发布。
        const repaired = await resend(s, { feature: b.feature, requirement: b.requirement, request: b.request } as Halted);
        const events = eventsOf(s, b.feature, b.runId);
        console.log(`[design-authority-repair] S16-c6 重发 exit=${repaired.exitCode} ${describeS16({ events })}`);
        assert(!repaired.born.length && events.filter(e => e.type === 'run_start').length === 2, `应重新接入同一 run：${JSON.stringify(repaired)}`);
        assert(!contentRepairs(events).length && !outOfChainStarts(events).length, '本 run 自始至终没有派发');
        assertCompletedBy(s, b.feature, b.runId, 'S16-c6 竞争后重发');
        assert.strictEqual(readDoc(blueprintFile(s)).revision, b.baseRevision + 1, '蓝图只发布了一次');
      } finally {
        sibling?.release();
        await sibling?.done.catch(() => undefined);
        await sibling?.worker.terminate();
        process.chdir(prevCwd);
      }
    }),
  },
  {
    name: 'S16-r1a 本次调用删掉自己的起始事件（codex t6 确认轮 A）：编写调用只删本次写出的 agent_invoke_start → 按整文件期望值检出越界并写回；恢复与后继的预算回放不少算、attempted 判重仍在',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { author: (_doc, draft) => {
        const events = path.join(path.dirname(path.dirname(draft)), 'events.jsonl');
        const kept = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean)
          .filter(line => { const e = JSON.parse(line) as Ev; return !(e.type === 'agent_invoke_start' && e.phase === 'design-repair-author'); });
        fs.writeFileSync(events, `${kept.join('\n')}\n`);
      } } });
      console.log(`[design-authority-repair] S16-r1a ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '删本次起始');
      const eventsFile = runFile(s.root, b.feature, b.runId, 'events.jsonl');
      assert.deepStrictEqual((failed.files as Ev[] | undefined)?.map(f => f.path), [path.relative(s.root, eventsFile).replace(/\\/g, '/')], `只应检出事件文件：${JSON.stringify(failed)}`);
      assert.strictEqual(haltOf(b.events)?.halt_reason, 'backtrack_target_absent', '走既有违规停机出口');
      const budget = replayedBudget(s, b);
      assert(budget.resume.attempted && budget.successor.attempted, `判重：${JSON.stringify(budget)}`);
      assert(budget.resume.turns === 2 && budget.successor.turns === 2, `预算回放应计 spec 与编写调用各一次：${JSON.stringify(budget)}`);
    }),
  },
  {
    name: 'S16-r1 本 run 与祖先 run 的事件被调用删改（codex t6 首轮 1 / 确认轮 B）：质询调用删掉 run_start、attempted、编写与本次调用的起始，并删掉祖先 run 的一条调用起始、且不给结果 → 检出越界走违规停机；各事件文件整文件写回期望值（会话分段不变）→ resume 与后继的判重和预算回放都不少，后继不再派发',
    run: () => withFreshCuHost(async s => {
      const captured: { own?: Buffer; ancestor?: Buffer; ancestorFile?: string } = {};
      const b = await s16Born(s, { ancestor: true, adapter: { questioning: (doc, draft) => {
        delete doc.review_summary.questioning;
        const runDir = path.dirname(path.dirname(draft));
        const events = path.join(runDir, 'events.jsonl');
        captured.own = fs.readFileSync(events);
        const kept = captured.own.toString('utf8').split('\n').filter(Boolean).filter(line => {
          const e = JSON.parse(line) as Ev;
          return e.type !== 'run_start' && !(e.type === 'design_authority_repair' && e.stage === 'attempted') && !(e.type === 'agent_invoke_start' && String(e.phase).startsWith('design-repair-'));
        });
        fs.writeFileSync(events, `${kept.join('\n')}\n`);
        captured.ancestorFile = fs.readdirSync(path.dirname(runDir)).map(id => path.join(path.dirname(runDir), id, 'events.jsonl'))
          .find(file => file !== events && fs.existsSync(file) && /"agent_invoke_start"/.test(fs.readFileSync(file, 'utf8')))!;
        captured.ancestor = fs.readFileSync(captured.ancestorFile);
        const lines = captured.ancestor.toString('utf8').split('\n').filter(Boolean);
        lines.splice(lines.findIndex(line => (JSON.parse(line) as Ev).type === 'agent_invoke_start'), 1);
        fs.writeFileSync(captured.ancestorFile, `${lines.join('\n')}\n`);
      } } });
      console.log(`[design-authority-repair] S16-r1 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '删改事件');
      const eventsFile = runFile(s.root, b.feature, b.runId, 'events.jsonl');
      const rel = (file: string): string => path.relative(s.root, file).replace(/\\/g, '/');
      assert.deepStrictEqual((failed.files as Ev[] | undefined)?.map(f => f.path).sort(), [rel(eventsFile), rel(captured.ancestorFile!)].sort(), `两份事件文件都须检出：${JSON.stringify(failed)}`);
      assert.strictEqual(haltOf(b.events)?.halt_reason, 'backtrack_target_absent', '走既有违规停机出口');
      // 整文件写回：祖先 run 与删改前逐字节相同；本 run 以删改前的字节为前缀（之后只有运行时自己写的行）。
      assert(fs.readFileSync(captured.ancestorFile!).equals(captured.ancestor!), '祖先 run 的事件应写回调用前的字节');
      assert(fs.readFileSync(eventsFile).subarray(0, captured.own!.length).equals(captured.own!), '本 run 的事件应写回期望值（顺序与会话分段不变）');
      const budget = replayedBudget(s, b);
      assert(budget.resume.attempted && budget.successor.attempted, `判重：${JSON.stringify(budget)}`);
      assert(budget.resume.turns === 4 && budget.successor.turns === 4, `预算回放应计祖先 spec、本 run spec、编写、质询各一次：${JSON.stringify(budget)}`);
      const next = await supersede(s, b.feature, b.runId, b.chain, { ...authorsForContinuation(s, b.feature), noAutoForce: true });
      assert(next.successor, `后继未出生：${next.error}`);
      const succ = eventsOf(s, b.feature, next.successor!);
      console.log(`[design-authority-repair] S16-r1 successor ${describeS16({ events: succ })}`);
      assert(!contentRepairs(succ).length && !outOfChainStarts(succ).length, `后继不得获得第二次机会：${describeS16({ events: succ })}`);
      assert.strictEqual(haltOf(succ)?.halt_reason, 'execution_scope_unresolved', '后继必须实际走原设计 owner 门，不能靠作者异常绕过判重');
      assert.strictEqual(haltOf(succ)?.design_authority?.class, 'B1', '后继真实门仍为同一 B1');
    }),
  },
  {
    name: 'S16-r5 编写调用新引用了通常排除目录里的文件（codex t6 确认轮 C）：调用前它不在核对范围、调用期间是否被改无从核实 → 不当作干净继续，走违规停机、不发布',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, {
        beforeCorrupt: () => {
          fs.mkdirSync(path.join(s.root, 'context'), { recursive: true });
          fs.writeFileSync(path.join(s.root, 'context', 'ledger-notes.md'), '# 账本领域说明\n');
        },
        adapter: { author: doc => {
          const node = ledgerDomain(doc);
          node.provenance = { ...node.provenance, source_ref: 'context/ledger-notes.md' };
          fs.appendFileSync(path.join(s.root, 'context', 'ledger-notes.md'), '补一句\n');
        } },
      });
      console.log(`[design-authority-repair] S16-r5 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '新引用无从核实');
      assert(/新引用了调用前未核对的输入文件/.test(String(failed.reason)) && /context\/ledger-notes\.md/.test(String(failed.reason)), JSON.stringify(failed));
      assert.strictEqual(haltOf(b.events)?.halt_reason, 'backtrack_target_absent', '不当作干净继续，走违规停机出口');
    }),
  },
  {
    name: 'S16-r3 正常心跳不算越界（codex t6 首轮 1、3）：编写调用进行中本 run 的真实心跳（事件追加、beacon、进度、锁）与另一 feature 的 run 的运行时输出都照常写 → 修复照常发布并完成',
    run: () => withFreshCuHost(async s => {
      // 独立生产 run 载体只提供运行时输入，不声明业务 PASS 或完成。
      const otherFeature = 'heartbeat-side-task';
      const otherRunId = '20261011T000001Z-b0beef';
      const manifest = buildGoalManifestFromInput({ feature: otherFeature, run_id: otherRunId, requirement: '独立运行时心跳',
        start_phase: 'testing', end_phase: 'testing', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: s.root });
      const otherRun = createGoalRun({ projectRoot: s.root, manifest, chain: ['testing'] });
      const otherRunDir = path.dirname(otherRun.eventsPath);
      writeLivenessBeacon({ projectRoot: s.root, reportDir: path.relative(s.root, otherRunDir).replace(/\\/g, '/'), runId: otherRunId });
      const otherLock = path.join(featureFilePath(s.root, otherFeature, ''), 'goal-runs', FEATURE_LOCK_NAME);
      const before = { events: sha(path.join(otherRunDir, 'events.jsonl')), beacon: sha(path.join(otherRunDir, 'liveness.json')) };
      let heartbeatsDuringAuthor = 0;
      let ownUpdated: Record<string, boolean> = {};
      try {
        const b = await s16Born(s, {
          // plan b0e0621c §3.2：本 run 出生前缩短真实心跳定时器的间隔（回调不变）；驱动层 finally 复位，用例 finally 兜底。
          beforeBirth: async () => { __testing_setLockHeartbeatMs(TEST_LOCK_HEARTBEAT_MS); },
          adapter: { author: async (_doc, draft) => {
            // 另一 feature 的 run 正常运行：取它自己的 feature 锁并刷新、追加心跳事件、写 beacon 与进度、刷新阶段状态。
            const lock = tryAcquireLock(otherLock, { run_id: otherRunId });
            assert(lock, '前提：另一 feature 的锁可取');
            const runDir = path.dirname(path.dirname(draft));
            const ownEvents = path.join(runDir, 'events.jsonl');
            const ownBefore = fs.readFileSync(ownEvents, 'utf8').split('\n').filter(Boolean).length;
            // 等本 run 的真实心跳定时器实际走过：心跳事件、本 feature 锁、beacon、progress.json 都已更新（进度快照有 4 秒节流）。
            const watched: Record<string, string> = {
              lock: featureLockPath(s, CU), beacon: livenessBeaconPath(s.root, path.relative(s.root, runDir).replace(/\\/g, '/')), progress: path.join(runDir, 'progress.json'),
            };
            const digest = (file: string): string => (fs.existsSync(file) ? sha(file) : '');
            const start = Object.fromEntries(Object.entries(watched).map(([k, file]) => [k, digest(file)]));
            const heartbeats = (): number => fs.readFileSync(ownEvents, 'utf8').split('\n').filter(Boolean).slice(ownBefore).map(line => JSON.parse(line) as Ev).filter(e => e.type === 'heartbeat').length;
            for (const deadline = Date.now() + 30_000; ;) {
              ownUpdated = { heartbeat: heartbeats() > 0, ...Object.fromEntries(Object.entries(watched).map(([k, file]) => [k, digest(file) !== start[k]])) };
              if (Object.values(ownUpdated).every(Boolean) || Date.now() > deadline) break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            touchLock(otherLock, lock!.ownerId);
            fs.appendFileSync(path.join(otherRunDir, 'events.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), type: 'heartbeat', phase: 'testing' })}\n`);
            writeLivenessBeacon({ projectRoot: s.root, reportDir: path.relative(s.root, otherRunDir).replace(/\\/g, '/'), runId: otherRunId });
            fs.writeFileSync(path.join(otherRunDir, 'progress.json'), `${JSON.stringify({ heartbeat: Date.now() })}\n`);
            fs.writeFileSync(featureFilePath(s.root, otherFeature, 'next.json'), `${JSON.stringify({ phase: 'testing', at: Date.now() })}\n`);
            releaseLock(otherLock, lock!.ownerId);
            heartbeatsDuringAuthor = heartbeats();
          } },
        });
        console.log(`[design-authority-repair] S16-r3 heartbeats=${heartbeatsDuringAuthor} updated=${JSON.stringify(ownUpdated)} ${describeS16(b)}`);
        assert(heartbeatsDuringAuthor >= 1 && Object.values(ownUpdated).every(Boolean), `前提：编写调用进行中本 run 的真实心跳更新了心跳事件、锁、beacon、progress.json：${JSON.stringify(ownUpdated)}`);
        assert(sha(path.join(otherRunDir, 'events.jsonl')) !== before.events && sha(path.join(otherRunDir, 'liveness.json')) !== before.beacon, '前提：另一 run 的运行时输出确实变了');
        const published = contentRepairs(b.events).find(e => e.stage === 'published');
        assert(published?.outcome === 'recovered' && !b.events.some(e => e.type === 'phase_write_violation'), `正常心跳不得判越界：${describeS16(b)}`);
        assertCompletedBy(s, b.feature, b.runId, 'S16-r3');
        assert.strictEqual(lockHeartbeatIntervalMs(), PRODUCTION_LOCK_HEARTBEAT_MS, '目标调用结束后心跳间隔已复位为生产缺省值');
      } finally {
        __testing_setLockHeartbeatMs(null);
      }
    }),
  },
  {
    name: 'S16-r6 修复调用期间生产 supervisor 处理兄弟 CU 的停放 run（codex t6 第三轮）：兄弟 run 等的条件已就绪、supervisor 本会拉起；修复持有兄弟 CU 的 feature 锁 → 本轮不写事件、不拉起；修复照常发布、不判越界、本 run 完成；修复结束后下一轮实际拉起，重启计数为 1',
    run: () => withFreshCuHost(async s => {
      let siblingRun = '';
      let siblingEvents = '';
      let during: { code: number; spawned: string[][]; before: Buffer; after: Buffer } | undefined;
      const b = await s16Born(s, {
        preauth: false,
        beforeBirth: async () => {
          const siblingChain = prepareSiblingScope(s);
          // 兄弟 CU 先跑：此刻还没有预授权 → 真实门报 B1，停在设计 owner 出口（停放、挂探针）。
          const probe = await runGoalRuntimeChain(s.root, {
            frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: siblingChain[0], freshEndPhase: siblingChain[siblingChain.length - 1],
            realHarness: true, noAutoForce: true, onSpec: (ctx: { runId: string }) => writeSiblingSpecDraft(s, ctx.runId),
          });
          clearFrameworkConfigCache();
          [siblingRun] = runIds(s.root, SIBLING_FEATURE);
          siblingEvents = runFile(s.root, SIBLING_FEATURE, siblingRun, 'events.jsonl');
          assert.strictEqual(haltOf(eventsOf(s, SIBLING_FEATURE, siblingRun))?.halt_reason, 'execution_scope_unresolved', `前提：兄弟 run 停放：exit=${probe.exitCode}`);
          // 兄弟 run 的进程已不在（同进程测试里它的 beacon 指向仍存活的测试进程，删掉才是真实现场；在修复开始前删，不算调用期间的写入）。
          fs.rmSync(livenessBeaconPath(s.root, reportDirOf(s, SIBLING_FEATURE, siblingRun)), { force: true });
          preauthorize(s);
        },
        adapter: { author: async () => {
          // 兄弟 run 等的条件已就绪（探针注入代表与蓝图无关的等待条件，如设备）——不持锁的 supervisor 此刻会写 supervisor_restart 并拉起。
          const before = fs.readFileSync(siblingEvents);
          supervise.__testing_setConditionProbe(() => ({ ready: true, reason: 'sibling wait condition satisfied' }));
          try {
            const r = await superviseOnce(s, SIBLING_FEATURE, siblingRun);
            during = { ...r, before, after: fs.readFileSync(siblingEvents) };
          } finally {
            supervise.__testing_setConditionProbe(null);
          }
        } },
      });
      console.log(`[design-authority-repair] S16-r6 during=${JSON.stringify({ code: during?.code, spawned: during?.spawned })} ${describeS16(b)}`);
      const published = contentRepairs(b.events).find(e => e.stage === 'published');
      assert(published?.outcome === 'recovered' && !b.events.some(e => e.type === 'phase_write_violation'), `修复不得被判越界：${describeS16(b)}`);
      assert(during && during.code === 0 && !during.spawned.length && during.after.equals(during.before), `修复持锁期间 supervisor 不得写兄弟 run 的事件、不得拉起：${JSON.stringify({ spawned: during?.spawned })}`);
      assertCompletedBy(s, b.feature, b.runId, 'S16-r6');
      // 修复结束、锁已放：同一前提（兄弟 run 等的条件已就绪）下的下一轮实际拉起，重启计数为 1。
      supervise.__testing_setConditionProbe(() => ({ ready: true, reason: 'sibling wait condition satisfied' }));
      let woke: Awaited<ReturnType<typeof superviseOnce>>;
      try {
        woke = await superviseOnce(s, SIBLING_FEATURE, siblingRun);
      } finally {
        supervise.__testing_setConditionProbe(null);
      }
      assert.deepStrictEqual(woke.spawned, [['--feature', SIBLING_FEATURE, '--resume', siblingRun, '--force-resume', '--detach']], `修复之后 supervisor 应实际拉起：${JSON.stringify(woke)}`);
      const restarts = eventsOf(s, SIBLING_FEATURE, siblingRun).filter(e => e.type === 'supervisor_restart');
      assert.deepStrictEqual(restarts.map(e => e.restart_seq), [1], `重启计数：${JSON.stringify(restarts)}`);
    }),
  },
  {
    name: 'S16-r7 原需求内补施工文件，经独立质询和CU内容修订，不再按旧B1单字段拒绝',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, {
        allowSuccessors: true,
        adapter: { fix: (node, original) => { restoreNode(node, original); node.contracts.files.push(NEW_CONTRACT_FILE); } },
      });
      console.log(`[design-authority-repair] S16-r7 ${describeS16(b)}`);
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16(b));
      assert(ledgerDomain(readDoc(blueprintFile(s))).contracts.files.includes(NEW_CONTRACT_FILE));
      assert(b.log.prompts['design-repair-questioning']?.length === 1, '扩大施工范围仍经独立质询');
      assertCompletedBy(s, b.feature, b.runId, '施工范围修订后接续');
    }),
  },
  {
    name: 'S16-r2 编写调用的子进程收容绑定失败（codex t6 首轮 2）：未证明消失 → 走既有 agent_containment_unresolved 停机，不发布、不启动质询、不挂设计探针；已证明消失 → 按普通尝试失败收口（设计 owner 停机）',
    run: () => withFreshCuHost(async s => {
      if (process.platform !== 'win32') { console.log('[design-authority-repair] S16-r2 跳过：收容只在 Windows 上启用'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process') as typeof import('child_process') & { spawnSync: unknown };
      const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      const spawnSync = cp.spawnSync;
      try {
        const b = await s16Born(s, { adapter: { author: () => {
          // 只让对这个 pid 的 taskkill 失败（结束不了的替身）；身份探测与存活探测照常走真实系统调用。
          cp.spawnSync = ((file: string, args: readonly string[] = [], ...rest: unknown[]) =>
            /taskkill/i.test(String(file)) && args.includes(String(dummy.pid))
              ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 0, output: [], signal: null }
              : (spawnSync as (...a: unknown[]) => unknown)(file, args, ...rest)) as never;
          return { activeChildPid: dummy.pid };
        } } });
        cp.spawnSync = spawnSync;
        console.log(`[design-authority-repair] S16-r2 未证明消失 ${describeS16(b)}`);
        const halt = haltOf(b.events);
        assert(halt?.halt_reason === 'agent_containment_unresolved' && !halt.probe, `应走既有收容停机、不挂设计探针：${JSON.stringify(halt)}`);
        assertNotPublished(s, b, 'author', '收容未证明消失');
        assert(!b.log.prompts['design-repair-questioning'] && outOfChainStarts(b.events).length === 1, '不得启动质询调用');
        assert(!b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-author'), '未证明消失时不落 invoke_end（留给恢复对账）');
      } finally {
        cp.spawnSync = spawnSync;
        try { dummy.kill(); } catch { /* 已不在 */ }
        await childExited(dummy);
      }
    }),
  },
  {
    name: 'S16-r2b 同上，但收容绑定失败后已证明子进程消失 → 按普通尝试失败收口：设计 owner 停机（挂探针），不发布',
    run: () => withFreshCuHost(async s => {
      if (process.platform !== 'win32') { console.log('[design-authority-repair] S16-r2b 跳过：收容只在 Windows 上启用'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process') as typeof import('child_process');
      const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      try {
        const b = await s16Born(s, { adapter: { author: () => ({ activeChildPid: dummy.pid }) } });
        console.log(`[design-authority-repair] S16-r2b 已证明消失 ${describeS16(b)}`);
        const halt = haltOf(b.events);
        assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.probe === 'design_authority_projectable', `应按普通尝试失败落设计 owner 停机：${JSON.stringify(halt)}`);
        const failed = assertNotPublished(s, b, 'author', '收容失败但已消失');
        assert(/guardian/.test(String(failed.reason)) && !b.log.prompts['design-repair-questioning'], JSON.stringify(failed));
        assert(dummy.exitCode !== null || dummy.signalCode !== null || !(() => { try { process.kill(dummy.pid!, 0); return true; } catch { return false; } })(), '子进程已被结束');
      } finally {
        try { dummy.kill(); } catch { /* 已不在 */ }
        await childExited(dummy);
      }
    }),
  },
  ...(['absent', 'query-failure'] as const).map(existence => ({
    name: `S16-r2c 终止命令失败但独立存在探针 ${existence}：${existence === 'absent' ? '已证明消失按调用失败收口' : '查询失败仍阻断续跑'}，不发布、不派质询`,
    run: () => withFreshCuHost(async s => {
      if (process.platform !== 'win32') { console.log('[design-authority-repair] S16-r2c 跳过：收容只在 Windows 上启用'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process') as typeof import('child_process');
      const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      const spawnSync = cp.spawnSync;
      let terminateCalls = 0;
      let existenceQueries = 0;
      try {
        const b = await s16Born(s, { adapter: { author: async () => {
          // ABSENT 用真实已退出子进程；查询失败用仍活子进程与既有 OS 探针注入缝。
          if (existence === 'absent') { dummy.kill(); await childExited(dummy); }
          else __testing_setPidProbeExecutor(() => { existenceQueries++; return { status: 1, stdout: '' }; });
          cp.spawnSync = ((file: string, args: readonly string[] = [], ...rest: unknown[]) => {
            if (/taskkill/i.test(String(file)) && args.includes(String(dummy.pid))) {
              terminateCalls++;
              return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 0, output: [], signal: null };
            }
            return (spawnSync as (...a: unknown[]) => unknown)(file, args, ...rest);
          }) as never;
          return { activeChildPid: dummy.pid };
        } } });
        assert(terminateCalls > 0, '实际生产绑定路径仍须尝试终止');
        const halt = haltOf(b.events);
        if (existence === 'absent') {
          assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.probe === 'design_authority_projectable', `已证明消失不得标为收容未解决：${describeS16(b)}`);
          assert(b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-author'), '绑定失败仍按普通调用失败收口');
        } else {
          assert(existenceQueries > 0 && halt?.halt_reason === 'agent_containment_unresolved' && !halt.probe, `查询失败不得作为消失证明：${describeS16(b)}`);
          assert(!b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-author'), '未证明消失时不落 invoke_end');
        }
        assertNotPublished(s, b, 'author', `收容 ${existence}`);
        assert(!b.log.prompts['design-repair-questioning'] && outOfChainStarts(b.events).length === 1, '绑定失败不得继续质询调用');
      } finally {
        cp.spawnSync = spawnSync;
        __testing_setPidProbeExecutor(null);
        try { dummy.kill(); } catch { /* 已不在 */ }
        await childExited(dummy);
      }
    }),
  })),
  {
    name: 'S16-r4 取锁中途 I/O 异常（codex t6 首轮 4）：第二把 feature 锁注入一次 EACCES → 本次自取的锁全部放掉、借来的锁仍在、原异常抛出；同进程重试成功',
    run: () => withSnapshot(s => {
      // 纯锁原语场景不带待刷新的阶段产物；不把历史内容证明混入借锁/I/O 断言。
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, SNAPSHOT_CU_FEATURE, name), { force: true });
      bumpBlueprint(s);
      const lent = tryAcquireLock(featureLockPath(s, CU), { run_id: 'caller-run' })!;
      const target = path.resolve(featureLockPath(s, 'ledger-recovery'));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = require('fs') as { openSync: unknown };
      const openSync = fs.openSync;
      let injected = false;
      realFs.openSync = (file: fs.PathLike, ...rest: unknown[]) => {
        if (!injected && path.resolve(String(file)) === target) {
          injected = true;
          throw Object.assign(new Error('EACCES: permission denied (injected)'), { code: 'EACCES' });
        }
        return (openSync as (...args: unknown[]) => number)(file, ...rest);
      };
      let thrown: Error | undefined;
      try { reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, CU), ownerId: lent.ownerId }] }); } catch (error) { thrown = error as Error; } finally { realFs.openSync = openSync; }
      assert(injected && /EACCES/.test(String(thrown?.message)), `前提：注入的异常原样抛出：${thrown?.message}`);
      assert(!fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)), '自取的蓝图锁须已放掉');
      for (const id of ['ledger-consumer', 'ledger-recovery', 'ledger-summary']) assert(!fs.existsSync(featureLockPath(s, id)), `${id} 的自取锁须已放掉`);
      assert(fs.existsSync(featureLockPath(s, CU)), '借来的锁不得被放掉');
      const retry = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, CU), ownerId: lent.ownerId }] });
      assert(!retry.busy && retry.bumped.length === 4, `同进程重试应成功：${JSON.stringify(retry)}`);
      releaseLock(featureLockPath(s, CU), lent.ownerId);
    }),
  },
  {
    name: 'S16-c8 发布前 canonical 被别处改动（非阻断建议）：质询调用之后、发布之前另一写入者改了 canonical 蓝图 → 基线复核不等，不发布',
    run: () => withFreshCuHost(async s => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const validator = require('../../scripts/utils/component-blueprint-validator') as { validateComponentBlueprint: typeof validateComponentBlueprint };
      const original = validator.validateComponentBlueprint;
      let touchedAt: string | undefined;
      try {
        const b = await s16Born(s, { adapter: { questioning: () => {
          // 下一次校验（运行时对草稿的发布前校验）之前，另一会话手工改了 canonical 蓝图。
          validator.validateComponentBlueprint = ((value: unknown, context: Parameters<typeof validateComponentBlueprint>[1]) => {
            validator.validateComponentBlueprint = original;
            fs.appendFileSync(blueprintFile(s), '\n# 另一会话手工改动\n');
            touchedAt = sha(blueprintFile(s));
            return original(value, context);
          }) as typeof validateComponentBlueprint;
        } } });
        console.log(`[design-authority-repair] S16-c8 ${describeS16(b)}`);
        const repairs_ = contentRepairs(b.events);
        assert(repairs_.find(e => e.stage === 'failed')?.failed_step === 'publish' && !repairs_.some(e => e.stage === 'published'), `应在发布前复核时失败：${describeS16(b)}`);
        assert(touchedAt && sha(blueprintFile(s)) === touchedAt, 'canonical 保持别处写入的字节，不被草稿覆盖');
      } finally {
        validator.validateComponentBlueprint = original;
      }
    }),
  },
  {
    name: 'S15-wake 进程内探针唤醒也经同一恢复判断：plan 已兑现后实体绑定失效 → 探针就绪也不在本进程继续（不重查、立即停放）；操作者手工 --resume 改为起后继并完成',
    run: () => withFreshCuHost(async s => {
      const { feature, runId, gateCalls, probes, deviceDeps } = await parkOnStaleBindingWait(s);
      const events = eventsOf(s, feature, runId);
      const manifestBefore = fs.readFileSync(runFile(s.root, feature, runId, 'manifest.json'));
      const eventsBefore = fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl'));
      console.log(`[design-authority-repair] S15-wake gateCalls=${gateCalls} probes=${probes} verdicts=${JSON.stringify(verdictsOf(events))} end=${JSON.stringify(endOf(events))}`);
      assert(events.some(e => e.type === 'condition_wait_started' && e.probe === 'device_readiness'), '前提：设备类等待在进程内进行');
      assert.strictEqual(gateCalls, 1, '冻结绑定已失效时不得重查放行、在原 run 上继续');
      assert(probes >= 1 && probes <= 3, `探针就绪后应立即停放，而不是空等到上限：probes=${probes}`);
      assert(!events.some(e => e.type === 'condition_wait_ready') && events.some(e => e.type === 'condition_wait_timeout'), '应按未恢复收尾并停放');
      const parked = haltOf(events);
      assert(parked?.halt_reason === 'device_not_ready' && parked.probe === 'device_readiness' && parked.run_disposition === 'WAITING' && endOf(events)?.status !== 'CHAIN_SLICE_COMPLETED',
        `应按设备类等待原样停放（事件仍带原探针）：${JSON.stringify(parked)} ${JSON.stringify(endOf(events))}`);
      // 下一次恢复入口：探针就绪后，已兑现 owner 的实体绑定失效必须从停机 run 起后继。
      clearFrameworkConfigCache();
      const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, runId, 'manifest.json')).requirement;
      const decided = decideRunContinuation({ projectRoot: s.root, feature, call: { requirement }, runProbe: () => ({ ready: true }) });
      assert(decided.kind === 'successor' && decided.change === 'external_condition_ready' && decided.targets.includes(runId) && /contracts/.test(decided.reason), JSON.stringify(decided));
      // 设备门现在真实停放为 HALTED/WAITING；未恢复时保留冷却，不再次启动未就绪设备。
      const waiting = decideRunContinuation({ projectRoot: s.root, feature, call: { requirement }, runProbe: () => ({ ready: false }) });
      assert(waiting.kind === 'hold' && !/external_condition_ready/.test(waiting.reason), JSON.stringify(waiting));
      // 操作者手工 `--resume`（前台、不带 --force）也经同一判断：设备探针就绪、绑定已失效 → 不在原 run 上继续，改为起后继并完成。
      const before = new Set(runIds(s.root, feature));
      const resumed = await runGoalRuntimeChain(s.root, {
        frameworkRoot: s.frameworkRoot, featureId: feature, resume: runId, noAutoForce: true,
        ...s15ContinuationAuthors(s, feature, deviceDeps),
      });
      clearFrameworkConfigCache();
      const born = runIds(s.root, feature).filter(id => !before.has(id));
      assert(born.length === 1 && eventsOf(s, feature, runId).filter(e => e.type === 'run_start').length === 1,
        `显式 --resume 在绑定失效时应改为起后继、不得在原 run 上继续：exit=${resumed.exitCode} born=${JSON.stringify(born)}`);
      assert(eventsOf(s, feature, born[0]).some(e => e.type === 'supersede' && e.target_run_id === runId), '后继须审计承接停放的 run');
      assertCompletedBy(s, feature, born[0], 'S15 显式 --resume 改起后继');
      assert(fs.readFileSync(runFile(s.root, feature, runId, 'manifest.json')).equals(manifestBefore), '原 manifest 字节保留');
      assert(fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl')).subarray(0, eventsBefore.length).equals(eventsBefore), '原事件历史保留');
      assertS15BudgetInherited(s, feature, runId, born[0]);
    }),
  },
  // plan a2f7c9e4 §3.7（codex r1 B3-1）：材料按调用方原始参数判合法；显式 --resume 经同一恢复判断改起后继时，两入口都不得因内部去掉 --resume 而用法错误
  ...(['foreground', 'detach'] as const).map(entry => ({
    name: `S15-notes [${entry}] 显式 --resume 带 --repair-notes、探针就绪而绑定失效 → 改起后继并完成（材料随本次调用进入后继，不因改写后的参数被判 fresh）`,
    run: () => withFreshCuHost(async s => {
      const { feature, runId, deviceDeps } = await parkOnStaleBindingWait(s);
      clearFrameworkConfigCache();
      const manifestBefore = fs.readFileSync(runFile(s.root, feature, runId, 'manifest.json'));
      const eventsBefore = fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl'));
      fs.writeFileSync(path.join(s.root, 'repair-notes.md'), '驱动方假设：设备上线后首屏布局与蓝图新契约不一致\n', 'utf-8');
      const before = new Set(runIds(s.root, feature));
      const opts = {
        frameworkRoot: s.frameworkRoot, featureId: feature, resume: runId, noAutoForce: true,
        resumeExtraArgs: ['--repair-notes', 'repair-notes.md'],
        ...s15ContinuationAuthors(s, feature, deviceDeps),
      };
      // 子进程那一半在本进程跑：用法错误的 process.exit 换成抛错，失败是普通断言失败而不是打断整套
      const realExit = process.exit;
      process.exit = ((code?: number) => { throw new Error(`process.exit(${code})`); }) as typeof process.exit;
      let resumed: Awaited<ReturnType<typeof requestVia>>;
      try {
        resumed = entry === 'detach' ? await requestVia('detach', s.root, opts) : await runGoalRuntimeChain(s.root, opts);
      } finally { process.exit = realExit; }
      clearFrameworkConfigCache();
      const born = runIds(s.root, feature).filter(id => !before.has(id));
      assert(resumed.exitCode === 0 && born.length === 1 && eventsOf(s, feature, runId).filter(e => e.type === 'run_start').length === 1,
        `${entry}：应改为起后继、不得用法错误或在原 run 上继续：exit=${resumed.exitCode} born=${JSON.stringify(born)}`);
      if (entry === 'detach') {
        assert(!!resumed.childArgs?.includes('--repair-notes') && !resumed.childArgs.includes('--resume'),
          `detach 子进程参数已按恢复判断去掉 --resume、保留材料：${JSON.stringify(resumed.childArgs)}`);
      }
      assert(eventsOf(s, feature, born[0]).some(e => e.type === 'supersede' && e.target_run_id === runId), '后继须审计承接停放的 run');
      assertCompletedBy(s, feature, born[0], `S15-notes ${entry}`);
      assert(fs.readFileSync(runFile(s.root, feature, runId, 'manifest.json')).equals(manifestBefore), '原 manifest 字节保留');
      assert(fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl')).subarray(0, eventsBefore.length).equals(eventsBefore), '原事件历史保留');
      assertS15BudgetInherited(s, feature, runId, born[0]);
    }),
  })),
  {
    name: 'T2-cooldown 冷却测试缝（plan b0e0621c §3.2 / V5）：不安装时恢复守卫即原函数、按生产 5 分钟冷却拒绝；安装只在目标调用期间生效；调用异常退出后已还原',
    run: async () => {
      const recent = { priorStatus: 'HALTED', lastRunEndTs: new Date(Date.now() - 10_000).toISOString(), forceResume: true, cooldownMinutes: 5 };
      assert.strictEqual(runnerPhase.checkTerminalResumeGuard, productionResumeGuard, '未安装：模块导出即原守卫');
      assert(!runnerPhase.checkTerminalResumeGuard(recent).allowed, '未安装：生产冷却（5 分钟）内拒绝');
      await assert.rejects(withResumeCooldown(SHORT_RESUME_COOLDOWN_MS, async () => {
        assert(runnerPhase.checkTerminalResumeGuard(recent).allowed, '安装期间：短冷却已过即放行');
        throw new Error('目标调用异常退出');
      }), /目标调用异常退出/);
      assert.strictEqual(runnerPhase.checkTerminalResumeGuard, productionResumeGuard, '异常退出后已还原为原守卫');
      assert(!runnerPhase.checkTerminalResumeGuard(recent).allowed, '还原后仍按生产冷却拒绝');
    },
  },
  {
    name: 'T2-heartbeat 心跳测试缝（plan b0e0621c §3.2 / V5）：不安装时取生产缺省 60 秒；安装后目标调用异常退出，驱动层复位回缺省值',
    run: async () => {
      assert.strictEqual(lockHeartbeatIntervalMs(), PRODUCTION_LOCK_HEARTBEAT_MS, '未安装：生产缺省值');
      __testing_setLockHeartbeatMs(TEST_LOCK_HEARTBEAT_MS);
      try {
        assert.strictEqual(lockHeartbeatIntervalMs(), TEST_LOCK_HEARTBEAT_MS, '安装后生效');
        await assert.rejects(runGoalRuntimeChain(path.join(os.tmpdir(), `maison-absent-host-${process.pid}`), {}), '目标调用应异常退出（宿主根不存在）');
        assert.strictEqual(lockHeartbeatIntervalMs(), PRODUCTION_LOCK_HEARTBEAT_MS, '目标调用异常退出后已复位为生产缺省值');
      } finally {
        __testing_setLockHeartbeatMs(null);
      }
    },
  },
];

for (const finalFailure of [false, true]) cases.push({
  name: `review-delivery B1 ${finalFailure ? '最后补生成失败仍保留内部实际写入路径且 recovered 不变' : '内部持锁刷新后外层同字节不重写，最终仍记已刷新与实际 files'}`,
  run: () => withFreshCuHost(async s => {
    const materialization = require('../../scripts/utils/blueprint-review-materialization') as typeof import('../../scripts/utils/blueprint-review-materialization');
    const real = materialization.materializeBlueprintReview;
    const preparation = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
    const reconcile = preparation.reconcileHeldBlueprintRefs;
    const nodeFs = require('fs') as typeof fs; const rename = nodeFs.renameSync;
    const reviewPath = blueprintReviewPath(s.root, BLUEPRINT_ID);
    let calls = 0; let writes = 0; let held = false;
    let reconciled = false; let stableReads = 0;
    try {
      const b = await s16Born(s, { beforeBirth: async () => {
        preparation.reconcileHeldBlueprintRefs = (...args) => { const result = reconcile(...args); reconciled = true; return result; };
        nodeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
          if (String(to) === reviewPath) {
            writes++;
            held = fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)) && fs.existsSync(featureLockPath(s, CU));
          }
          return rename(from, to);
        }) as typeof fs.renameSync;
        materialization.materializeBlueprintReview = (root, id) => {
          calls++;
          if (finalFailure && reconciled) return { path: reviewPath, status: 'failed', writtenPaths: [], sourceGaps: [], reason: 'injected final materialization failure', rebuildCommand: 'check:component-blueprint --write-review' };
          const before = fs.existsSync(reviewPath) ? sha(reviewPath) : undefined;
          const result = real(root, id);
          if (before && before === sha(reviewPath)) { stableReads++; assert.equal(result.writtenPaths.length, 0, '同字节渲染不得重写'); }
          return result;
        };
      } });
      const published = contentRepairs(b.events).find(e => e.stage === 'published');
      assert(published?.outcome === 'recovered' && published.review_document?.status === (finalFailure ? 'failed' : 'refreshed'), describeS16(b));
      assert(calls >= 2 && writes >= 1 && held && (finalFailure || stableReads > 0), `内容修订/指针调和可改变文档，外层同字节必须不重写：${JSON.stringify({calls,writes,held,stableReads})}`);
      assert(published.files.includes(path.relative(s.root, reviewPath).split(path.sep).join('/')) && published.review_document.writtenPaths.includes(reviewPath), JSON.stringify(published));
      assert(published.review_projection_stale === finalFailure, '最终状态被外层是否写入或内层成功掩盖');
      assert(pointsAtCurrentBlueprint(s, CU) && inspectBlueprintReview(s.root, BLUEPRINT_ID).status === 'current', '原调和或真实文档被破坏');
      assertAttemptCleanedUp(s);
      assertCompletedBy(s, b.feature, b.runId, 'B1 文档不参与 recovered');
    } finally { materialization.materializeBlueprintReview = real; preparation.reconcileHeldBlueprintRefs = reconcile; nodeFs.renameSync = rename; }
  }),
});

export async function runSelectedCases(selector?: string, group?: 'content' | 'continuation' | 'runtime' | 'other'): Promise<SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases) {
    const name = `design-authority-repair: ${c.name}`;
    const category = c.name.startsWith('S16-c') ? 'content'
      : c.name.startsWith('S15-') ? 'continuation'
      : c.name.startsWith('S16-r') ? 'runtime' : 'other';
    if ((group && group !== category) || !matchesUnitCase(name, selector)) continue;
    const endTiming = startCaseTiming([name], timings);
    const started = Date.now();
    try {
      await c.run();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally { endTiming(); }
    console.log(`[design-authority-repair] ${c.name.split('：')[0]} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return selectedUnitCases(results, selector, timings);
}

export async function runAll(group?: 'content' | 'continuation' | 'runtime' | 'other'): Promise<UnitCaseResult[]> {
  return (await runSelectedCases(undefined, group)).results;
}
