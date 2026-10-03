// design-authority-repair.unit.test.ts — plan 9c3d7e1a：设计权威修复的自动接手与同任务续跑（release-only，真 harness）
//
// 宿主 = 上一版快照（host-snapshot-3.1.0）+ git 基线；run 经 goal-runner 公开入口出生，阶段门由真 harness 产出，
// 测试只替代 agent 的产出（lifecycle-evolution 的作者材料）与宿主侧的蓝图升版，不手写事件、不注入 verdict。
//
// plan b0e0621c §3.3：S14–S16 主流程（A2 主线与两个反例、S15 四支、S16 主线与两个绑定失效支、S16-c1）的驱动与断言
// 在本文件导出的流程函数里，注册用例只在 reliability-scenarios 的 S14 / S15 / S16 里——单跑本套件不覆盖它们，
// 本地验证这几条要跑：RELIABILITY_SCENARIOS_ONLY=S14,S15,S16 + `--filter reliability-scenarios`。
// 共用前缀（handWrittenCompletion / derivedContractsCompletion）经 lifecycle-evolution 的同路径缓存，进程内首跑真跑。

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath, relFeaturesDir } from '../../config';
import { designRepairAttempted, outOfScopePaths } from '../../scripts/utils/design-repair-unattended';
import { foldBudgetLineage, loadAuthoritativeEvents, resolveResumedBudget } from '../../scripts/utils/goal-runner-phase';
import { readBoundInput } from '../../scripts/utils/capability-resolution';
import {
  BLUEPRINT_RECONCILE_LOCK_NAME, RECONCILE_BUSY_HINT, deriveDesignPreparationReadiness, reconcileChangeUnitBlueprintRefs,
} from '../../scripts/utils/change-unit-design-preparation';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit, pointerStaleCandidate } from '../../scripts/utils/change-unit-path';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { checkAuthoritativeContentAligned, classifyDesignAuthorityCodes, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { blockerIssues, validateComponentBlueprint, validateComponentBlueprintUpstream } from '../../scripts/utils/component-blueprint-validator';
import { deriveBlueprintAdmission } from '../../scripts/utils/blueprint-admission';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { decideRunContinuation, loadEffectiveExecutionScope, staleFrozenBindings } from '../../scripts/utils/goal-run-creation';
import { runConditionProbe } from '../../scripts/utils/condition-wait';
import * as supervise from '../../scripts/goal-supervise';
import { __testing_setLockHeartbeatMs, lockHeartbeatIntervalMs } from '../../scripts/goal-phase-runtime';
import { livenessBeaconPath, writeLivenessBeacon } from '../../scripts/utils/liveness-beacon';
import { requestVia, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { publishVerifier, writeCuCodingMaterials, writeCuReviewMaterials, writeCuUtMaterials } from './real-chain.unit.test';
import { FEATURE_LOCK_NAME, releaseLock, touchLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { evaluateDeviceReadinessProbe, runDeviceReadinessGate } from '../../scripts/utils/device-readiness-gate';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext } from '../../scripts/utils/types';
import { SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { handWriteProjections } from './component-design-handoff.unit.test';
import {
  BLUEPRINT_ID, assess, authorHooks, brief, bumpBlueprint, cachedPrefix, commit, handWrittenCompletion, project, specFirstCuHooks, successorChain, withHost, withSnapshot,
} from './lifecycle-evolution.unit.test';
import { NEW_EXPECTED_RESULT, changeProjectedAcceptance, readJson, runFile, runIds, supersede } from './successor-exit.unit.test';
import type { UnitCaseResult } from '../run-unit';

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
/** plan 责任方按当前设计权威改写手写 contracts（只补权威新增的授权文件，保留其余手写内容）。 */
function alignContracts(s: Snapshot, feature: string): void {
  const file = featureFilePath(s.root, feature, 'contracts.yaml');
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (doc.files.includes(NEW_CONTRACT_FILE)) return;
  doc.files.push(NEW_CONTRACT_FILE);
  fs.writeFileSync(file, YAML.stringify(doc));
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
  let injected = false;
  let planInvokes = 0;
  const before = new Set(runIds(s.root, feature));
  const next = await supersede(s, feature, completed, expected, {
    ...hooks,
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
      alignContracts(s, feature);
      hooks.onPlan(ctx);
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

const repairs = (run: StaleRun): Ev[] => run.events.filter(e => e.type === 'design_authority_repair');
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
  halted: string;
  /** 停机事件在停机 run 事件流里的下标（扰动点）。 */
  haltIndex: number;
  haltClass: string;
  interventions: RepairIntervention[];
  evidence: string;
}
interface Halted { feature: string; completed: string; halted: string; requirement: string; request: { start: string; end: string }; chain: string[]; events: Ev[]; saved: Ev }
/** 任务的原请求：上一次完成的 run 冻结的需求与起止（停机的 run 是它的后继，属于同一任务）。 */
const originalRequest = (s: Snapshot, feature: string, completed: string): Pick<Halted, 'requirement' | 'request'> => {
  const manifest = readJson<{ requirement: string; start_phase: string; end_phase: string }>(runFile(s.root, feature, completed, 'manifest.json'));
  return { requirement: manifest.requirement, request: { start: manifest.start_phase, end: manifest.end_phase } };
};

/** 宿主原始完成的替身（派生施工契约形状）：acceptance 去掉来源戳成为手写文件，contracts / use-cases 不落盘。 */
async function derivedContractsCompletion(s: Snapshot): Promise<string> {
  return cachedPrefix(s, 'derivedContractsCompletion', async () => {
    const feature = SNAPSHOT_CU_FEATURE;
    const file = featureFilePath(s.root, feature, 'acceptance.yaml');
    const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    delete doc.source;
    fs.writeFileSync(file, YAML.stringify(doc));
    for (const name of ['contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, feature, name));
    commit(s, 'spec wrote acceptance by hand; construction contract stays derived from the blueprint');
    const [snapshotRun] = runIds(s.root, feature);
    const original = await supersede(s, feature, snapshotRun, successorChain(s, feature, snapshotRun), {
      ...authorHooks(project(s, feature), { coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials }), noAutoForce: true,
    });
    assert(original.successor && assess(s, feature).complete, `前提：派生施工契约形状下的完成记录：${original.error} ${brief(assess(s, feature))}`);
    const contracts = boundSources(s, feature, original.successor!).find(x => x.startsWith('contracts<-'));
    assert.strictEqual(contracts, 'contracts<-derive.blueprint-contracts', '前提：施工契约绑定来自蓝图派生');
    return original.successor!;
  });
}
const boundSources = (s: Snapshot, feature: string, runId: string): string[] => {
  clearFrameworkConfigCache();
  const scope = loadEffectiveExecutionScope(s.root, feature, runId)!;
  return [...new Set(scope.obligations.flatMap(o => [...o.basis, ...(o.satisfied_by ?? [])]).filter((b): b is Parameters<typeof readBoundInput>[1] => 'input_id' in b)
    .map(b => `${b.input_id}<-${b.source.kind === 'artifact' ? b.source.artifact : b.source.provider_id}`))];
};

/**
 * 现有无效例的真 harness 版（全手写宿主）：手写派生文件下的完成 run → 设计 owner 把蓝图升版、内容写坏并调和、提交 →
 * 公开入口 `--supersede`（无人值守，不带 --force）出生后继 → spec 的真实门判设计权威无效 → 首次即停。
 */
async function haltBornInvalid(s: Snapshot): Promise<Halted> {
  const feature = SNAPSHOT_CU_FEATURE;
  const { predict, completed } = await handWrittenCompletion(s);
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); node.acceptance = TEXT_ACCEPTANCE; });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const chain = predict(completed);
  assert(chain[0] === 'spec' && chain.includes('plan'), `前提：出生链含 spec 与 plan：${JSON.stringify(chain)}`);
  // 权威此刻不可用，spec 责任方无从对齐（不改 acceptance）。
  const next = await supersede(s, feature, completed, chain, { ...specFirstCuHooks(project(s, feature), false), noAutoForce: true });
  assert(next.successor, `后继未出生：${next.error}`);
  return { feature, completed, halted: next.successor!, ...originalRequest(s, feature, completed), chain, events: eventsOf(s, feature, next.successor!), saved: saved! };
}

/**
 * run 出生并冻结绑定之后才出问题：蓝图先升到改了投影验收的 admitted revision（调和、提交）→ `--supersede` 真实出生后继 →
 * spec 首轮进行中，设计 owner 在另一会话把蓝图再升一个 revision 并写坏内容（只写蓝图，不调调和器）。
 */
async function haltAfterBirthAtSpec(s: Snapshot, completed: string, corrupt: (node: Ev) => void, extra: (saved: () => Ev | undefined) => Record<string, unknown> = () => ({})): Promise<Halted> {
  const feature = SNAPSHOT_CU_FEATURE;
  bumpBlueprint(s, changeProjectedAcceptance);
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint rev3 admitted');
  const chain = successorChain(s, feature, completed);
  assert(chain[0] === 'spec', `前提：出生链从 spec 开始：${JSON.stringify(chain)}`);
  const hooks = specFirstCuHooks(project(s, feature), true);
  let saved: Ev | undefined;
  const next = await supersede(s, feature, completed, chain, {
    ...hooks, noAutoForce: true,
    onSpec: ctx => {
      if (!saved) {
        bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); corrupt(node); });
        clearFrameworkConfigCache();
      }
      hooks.onSpec(ctx);
    },
    ...extra(() => saved),
  });
  assert(next.successor && saved, `后继未出生或未注入：${next.error}`);
  return { feature, completed, halted: next.successor!, ...originalRequest(s, feature, completed), chain, events: eventsOf(s, feature, next.successor!), saved: saved! };
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
    (bySpec ? specLed : codingLed)[key](ctx);
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
async function superviseOnce(s: Snapshot, feature: string, runId: string): Promise<{ code: number; spawned: string[][] }> {
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
  assert.strictEqual(onDisk.criteria.find(c => c.id === 'AC-1')?.expected_result, NEW_EXPECTED_RESULT, `${label}：最终验收应是当前设计权威的文本`);
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
 * S15 B1（派生绑定已 stale）：派生施工契约宿主，run 出生后蓝图被写坏 → 框架先在 run 内调和指针、再因内容无效停机 →
 * 设计 owner 的修复同时改了施工契约依赖的蓝图内容 → `via='resend'` 冷却期内重发同一请求 / `via='supervisor'` 由生产 supervisor 拉起 →
 * 运行时判定冻结绑定已失效 → 自动从停机 run 起后继并完成。
 */
export async function s15StaleFlow(s: Snapshot, via: 'resend' | 'supervisor'): Promise<RepairFlow> {
  const completed = await derivedContractsCompletion(s);
  const h = await haltAfterBirthAtSpec(s, completed, node => { node.acceptance = TEXT_ACCEPTANCE; });
  const { halt, haltIndex } = assertDesignOwnerHalt(s, h, { cls: 'B1', codes: ['authority_content_not_machine_structure'], phase: 'spec' });
  const [repair] = h.events.filter(e => e.type === 'design_authority_repair');
  assert(repair?.outcome === 'reconciled' && invokesOf(h.events, 'spec') === 2, `前提：指针过期先由 run 内调和修好，随后因内容无效停机：${JSON.stringify(verdictsOf(h.events))}`);
  const dir = reportDirOf(s, h.feature, h.halted);
  // 未修时探针不得就绪。派生施工契约此刻按生产输入路径解析不出来：对依赖它的阶段，门重评不了也必须是"未就绪"，不能当成阻断已消除。
  const unrepaired = runConditionProbe(s.root, dir, 'design_authority_projectable', 'spec');
  assert(unrepaired.ready === false && /authoritative_content_aligned/.test(String(unrepaired.reason)), `未修时探针不得就绪：${JSON.stringify(unrepaired)}`);
  const blind = runConditionProbe(s.root, dir, 'design_authority_projectable', 'coding');
  assert(blind.ready === false && /无法重评/.test(String(blind.reason)), `施工契约解析不出来时不得判就绪：${JSON.stringify(blind)}`);
  if (via === 'supervisor') {
    const asleep = await superviseOnce(s, h.feature, h.halted);
    assert(asleep.code === 0 && !asleep.spawned.length, `未修时 supervisor 不得拉起：${JSON.stringify(asleep)}`);
    assert(!eventsOf(s, h.feature, h.halted).some(e => e.type === 'supervisor_restart'), '未修时不得消耗 supervisor 的重启次数');
  }
  // 修复：验收改回机器结构，同时把一个已存在的源文件补进施工契约的授权写集（派生施工契约绑定依赖的蓝图内容变了）。
  repairViaReadiness(s, node => { restoreNode(node, h.saved); node.contracts.files.push(NEW_CONTRACT_FILE); }, 'blueprint: acceptance restored; write set extended');
  assert(runConditionProbe(s.root, dir, 'design_authority_projectable', 'spec').ready, '修好后探针应就绪');
  const stale = staleFrozenBindings(s.root, h.feature, h.halted, 'spec');
  assert(stale.length === 1 && stale[0].startsWith('contracts:'), `派生施工契约绑定应已失效：${JSON.stringify(stale)}`);
  const before = new Set(runIds(s.root, h.feature));
  const interventions: RepairIntervention[] = [
    { kind: 'manual_file_edit', necessary: true, content: '设计修复（B1，既有授权内）：设计 owner 把验收改回机器结构并补全施工契约写集，经 design-handoff readiness 入口调和并提交' },
  ];
  let evidence = `停机=${halt.halt_reason}@${halt.phase} 分类=B1 stale=${JSON.stringify(stale)}`;
  if (via === 'resend') {
    const repaired = await resend(s, h);
    evidence += `；重发 exit=${repaired.exitCode}`;
    interventions.push({ kind: 'rescue_command', necessary: true, content: '冷却期内重新发起同一请求（不带任何旗标）' });
  } else {
    const woke = await superviseOnce(s, h.feature, h.halted);
    assert.deepStrictEqual(woke.spawned, [['--feature', h.feature, '--resume', h.halted, '--force-resume', '--detach']], `supervisor 只拉起 --resume，不做判断：${JSON.stringify(woke)}`);
    // 计划任务拉起的那条命令由测试代为执行：同一恢复形态（--resume <run> --force-resume --detach，不带 --force）经 detach 入口；
    // 驱动层另带测试宿主需要的 --foreground-ok 与 --ack-unverified-ledgers（生产 supervisor 命令没有这两个）。子进程那一半在进程内跑，agent 由作者材料替身。
    const run = await requestVia('detach', s.root, { frameworkRoot: s.frameworkRoot, featureId: h.feature, resume: h.halted, forceResume: true, ...authorsForContinuation(s, h.feature) });
    evidence += `；supervisor 发出 ${woke.spawned[0].join(' ')}，runner exit=${run.exitCode} child=${JSON.stringify(run.childArgs)}`;
  }
  clearFrameworkConfigCache();
  const born = runIds(s.root, h.feature).filter(id => !before.has(id));
  assert.strictEqual(born.length, 1, `应自动起且只起一个后继：${JSON.stringify(born)}；${evidence}`);
  const [successor] = born;
  // 合同来源沿用既有的后继出生规则（当前持有范围转交的 run，没有转交记录时取上一次完成的 run）；停机的 run 由后继审计承接。
  const events = eventsOf(s, h.feature, successor);
  assert(events.some(e => e.type === 'supersede' && e.target_run_id === h.halted && e.superseding_run_id === successor), '后继须审计承接停机的 run');
  assert([h.halted, h.completed].includes(String(readJson<{ successor_of?: string }>(runFile(s.root, h.feature, successor, 'manifest.json')).successor_of)), '后继的合同来源属于同一任务');
  const haltedEvents = eventsOf(s, h.feature, h.halted);
  assert.strictEqual(haltedEvents.filter(e => e.type === 'run_start').length, 1, '绑定已失效时不得在原 run 上继续');
  assertCompletedBy(s, h.feature, successor, `S15 自动后继（${via}）`);
  assert(YAML.parse(fs.readFileSync(blueprintFile(s), 'utf8')) && boundSources(s, h.feature, successor).includes('contracts<-derive.blueprint-contracts'), '后继出生时按当前输入重新解析了派生绑定');
  if (via === 'supervisor') {
    // 重启上限不重置：原 run 上记的那一次重启，算进后继的已用次数。
    assert.strictEqual(haltedEvents.filter(e => e.type === 'supervisor_restart').length, 1);
    assert.strictEqual(supervise.__testing_inheritedSupervisorRestarts(path.join(s.root, reportDirOf(s, h.feature, successor))), 1, '起后继不得把 supervisor 重启次数清零');
  }
  return { feature: h.feature, runs: [h.halted, successor], halted: h.halted, haltIndex, haltClass: 'B1', interventions, evidence };
}

/** S15 B2：设计闭包内出现未决项（需要有权者裁决）→ 停机分类 B2、说明写清缺什么 → 有权者裁决后经 readiness 调和 → 重发同一请求 → 完成。 */
export async function s15AuthorityFlow(s: Snapshot): Promise<RepairFlow> {
  const { completed } = await handWrittenCompletion(s);
  const h = await haltAfterBirthAtSpec(s, completed, node => { node.knowledge_state = 'unknown'; });
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
  /** 编写方对被写坏节点的改法；缺省 = 还原原值并把 AC-1 改成当前设计意图。 */
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
        (opts.fix ?? ((n: Ev, original: Ev) => { restoreNode(n, original); n.acceptance.criteria[0].expected_result = NEW_EXPECTED_RESULT; }))(node, saved()!);
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

interface S16Born { feature: string; completed: string; runId: string; events: Ev[]; requirement: string; request: { start: string; end: string }; saved: Ev; baseRevision: number; chain: string[]; error?: string }
/**
 * S16 全手写宿主：完成 run → （可选）用户写下预授权 → 设计 owner 把蓝图升版、验收写成文字并调和、提交 →
 * 公开入口 `--supersede`（无人值守，不带 --force）出生后继 → spec 的真实门报 B1。spec 首轮的作者材料不对齐（权威此刻不可用），之后的轮次按当前权威对齐。
 */
async function s16Born(s: Snapshot, opts: {
  /** false = 不写预授权；其它值原样写进 design_repair.unattended_b1（缺省布尔 true）。 */
  preauth?: unknown; corrupt?: (node: Ev) => void; adapter?: Parameters<typeof repairAdapter>[2]; extra?: Record<string, unknown>;
  /** 写坏蓝图之前的宿主准备（如兄弟 CU 的运行范围）；随写坏一起提交。 */
  beforeCorrupt?: () => void;
  /** 提交之后、本 run 出生之前（如另一个 run 已在跑）。 */
  beforeBirth?: (saved: Ev) => Promise<void>;
} = {}): Promise<S16Born & { log: RepairAdapterLog }> {
  const feature = SNAPSHOT_CU_FEATURE;
  const { predict, completed } = await handWrittenCompletion(s);
  if (opts.preauth !== false) preauthorize(s, opts.preauth ?? true);
  opts.beforeCorrupt?.();
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); (opts.corrupt ?? (n => { n.acceptance = TEXT_ACCEPTANCE; }))(node); });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const baseRevision = Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision);
  const chain = predict(completed);
  assert(chain[0] === 'spec' && chain.includes('plan'), `前提：出生链含 spec 与 plan：${JSON.stringify(chain)}`);
  await opts.beforeBirth?.(saved!);
  const p = project(s, feature);
  const unaligned = specFirstCuHooks(p, false);
  const aligned = specFirstCuHooks(p, true);
  const adapter = repairAdapter(s, () => saved, opts.adapter);
  const before = new Set(runIds(s.root, feature));
  const next = await supersede(s, feature, completed, chain, {
    ...aligned, noAutoForce: true,
    onSpec: (ctx: { runId: string; attempt: number }) => (ctx.attempt === 1 ? unaligned : aligned).onSpec(ctx),
    onOutOfChain: adapter.onOutOfChain,
    ...opts.extra,
  });
  assert(next.successor, `后继未出生：${next.error}`);
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  assert.deepStrictEqual(born, [next.successor], `只应出生一个 run：${JSON.stringify(born)}`);
  return { feature, completed, runId: next.successor!, events: eventsOf(s, feature, next.successor!), ...originalRequest(s, feature, completed), saved: saved!, baseRevision, chain, log: adapter.log, ...(next.error ? { error: next.error } : {}) };
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
  assert(/修复简报/.test(authorPrompt) && /authority_content_not_machine_structure/.test(authorPrompt) && /不得写 `review_summary.admission`/.test(authorPrompt), '编写提示词须带简报与子契约');
  assert(!/修复简报/.test(questioningPrompt) && !/authority_content_not_machine_structure/.test(questioningPrompt) && /必答范围/.test(questioningPrompt), '质询提示词须与编写隔离，只给草稿与证据包');
  // 整个尝试在两层锁内（编写调用进行中蓝图锁与全部 CU 的 feature 锁都在）；attempted 在调用前已落盘。
  assert(b.log.lockedDuringAuthor?.blueprint && Object.values(b.log.lockedDuringAuthor.features).every(Boolean) && b.log.lockedDuringAuthor.attemptedBeforeInvoke, JSON.stringify(b.log.lockedDuringAuthor));
  assertAttemptCleanedUp(s);
  // 发布物：revision 与修订依据由运行时登记在根 provenance；旧派生结论标 stale、保留原输入版本；准入由机器写回为 pass；质询方不是编写方。
  const bp = readDoc(blueprintFile(s));
  assert(bp.revision === b.baseRevision + 1 && bp.provenance.source_kind === 'design_repair_unattended' && /design_repair\.unattended_b1/.test(bp.provenance.source_ref), JSON.stringify(bp.provenance));
  assert((bp.derived_results ?? []).every((r: Ev) => r.status === 'stale' && r.superseded_by_revision === bp.revision && r.input_revision !== bp.revision), `旧派生结论须标 stale、不得改输入版本：${JSON.stringify(bp.derived_results)}`);
  assert(bp.review_summary.admission.status === 'pass' && bp.review_summary.questioning.provider_id === 'design-repair-questioning' && bp.review_summary.questioning.provider_id !== bp.review_summary.authored_by, JSON.stringify(bp.review_summary.admission));
  assert(pointsAtCurrentBlueprint(s, CU), 'CU 指针已在同一锁内调和到新 revision');
  // 同一 run 续跑：spec 首轮 FAIL → 修复 → 原地重评 PASS；没有停机、没有新 run；任务由这个 run 正确完成。
  assert(!b.events.some(e => e.type === 'phase_halt'), `不得停机：${describeS16(b)}`);
  assert.strictEqual(b.events.filter(e => e.type === 'run_start').length, 1, '同一 run 内完成');
  assertCompletedBy(s, b.feature, b.runId, 'S16 主线');
  const report = fs.readFileSync(runFile(s.root, b.feature, b.runId, 'goal-report.md'), 'utf8');
  assert(/content_repair（蓝图 [^；]+；published rev \d+ recovered/.test(report), 'goal 报告应渲染无人值守修复');
  const haltIndex = b.events.findIndex(e => e.type === 'design_authority_repair' && e.stage === 'attempted');
  return { feature: b.feature, runs: [b.runId], halted: b.runId, haltIndex, haltClass: 'B1', interventions: [], evidence: `attempted→published rev ${published.new_revision}（recovered），同一 run 完成；verdicts=${JSON.stringify(verdictsOf(b.events))}` };
}

/**
 * S16 绑定失效支：派生施工契约宿主，run 出生后蓝图被写坏——同一节点的验收与施工契约都写成了文字，施工契约的原文写明授权写集另含一个文件 →
 * 框架先 run 内调和指针、再判 B1（两处文字都在本次发现项的位置里）→ 派发修复，编写方按原文把两处改回机器结构，施工契约因此与旧绑定内容不同
 *（派生施工契约绑定依赖的蓝图内容变了，不靠扩大写集）→ 发布、调和、探针都过，但冻结绑定已失效 → 不在本 run 继续，停放（探针已就绪）。
 * `via='supervisor'`：生产 supervisor 实际拉起、恢复入口起后继并完成——操作者动作 0；`via='resend'`：没有 supervisor 拉起，需重发同一请求（如实计一次人工动作）。
 */
export async function s16StaleFlow(s: Snapshot, via: 'supervisor' | 'resend'): Promise<RepairFlow> {
  const completed = await derivedContractsCompletion(s);
  preauthorize(s);
  commit(s, 'developer pre-authorizes unattended B1 design repair');
  let adapter: ReturnType<typeof repairAdapter> | undefined;
  const h = await haltAfterBirthAtSpec(s, completed, node => { node.acceptance = TEXT_ACCEPTANCE; node.contracts = TEXT_CONTRACTS; }, saved => {
    // 按原文改回：验收还原；施工契约还原并按原文写明的写集补上那个文件。
    adapter = repairAdapter(s, saved, { fix: (node, original) => { restoreNode(node, original); node.contracts.files.push(NEW_CONTRACT_FILE); } });
    return { onOutOfChain: adapter.onOutOfChain };
  });
  const b = { events: h.events };
  console.log(`[design-authority-repair] S16-stale ${describeS16(b)}`);
  const [attempted, published] = contentRepairs(h.events);
  assert(attempted?.stage === 'attempted' && published?.stage === 'published' && published.outcome === 'recovered', `修复应已发布并恢复：${describeS16(b)}`);
  const haltIndex = h.events.map(e => e.type).lastIndexOf('phase_halt');
  const halt = h.events[haltIndex];
  assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.probe === 'design_authority_projectable' && /冻结的输入绑定已失效/.test(String(halt.halt_guidance)),
    `绑定失效时应停放（挂探针）而不是在本 run 继续：${describeS16(b)}`);
  assert(!fs.existsSync(featureLockPath(s, CU)), '停放时 feature 锁已释放');
  const dir = reportDirOf(s, h.feature, h.halted);
  assert(runConditionProbe(s.root, dir, 'design_authority_projectable', 'spec').ready, '发布后探针应已就绪');
  const stale = staleFrozenBindings(s.root, h.feature, h.halted, 'spec');
  assert(stale.length === 1 && stale[0].startsWith('contracts:'), `派生施工契约绑定应已失效：${JSON.stringify(stale)}`);
  const before = new Set(runIds(s.root, h.feature));
  const interventions: RepairIntervention[] = [];
  let evidence = `attempted→published rev ${published.new_revision}（recovered）、绑定失效停放 stale=${JSON.stringify(stale)}`;
  if (via === 'supervisor') {
    const woke = await superviseOnce(s, h.feature, h.halted);
    assert.deepStrictEqual(woke.spawned, [['--feature', h.feature, '--resume', h.halted, '--force-resume', '--detach']], `supervisor 应实际拉起：${JSON.stringify(woke)}`);
    // 计划任务拉起的那条命令由测试代为执行（同 S15 supervisor 支）。
    const run = await requestVia('detach', s.root, { frameworkRoot: s.frameworkRoot, featureId: h.feature, resume: h.halted, forceResume: true, ...authorsForContinuation(s, h.feature), onOutOfChain: adapter!.onOutOfChain });
    evidence += `；supervisor 发出 ${woke.spawned[0].join(' ')}，runner exit=${run.exitCode}`;
  } else {
    const repaired = await resend(s, h);
    evidence += `；重发 exit=${repaired.exitCode}`;
    interventions.push({ kind: 'rescue_command', necessary: true, content: '未启用 supervisor（或未实际拉起）：冷却期内重新发起同一请求（不带任何旗标）' });
  }
  clearFrameworkConfigCache();
  const born = runIds(s.root, h.feature).filter(id => !before.has(id));
  assert.strictEqual(born.length, 1, `应自动起且只起一个后继：${JSON.stringify(born)}；${evidence}`);
  const [successor] = born;
  const events = eventsOf(s, h.feature, successor);
  assert(events.some(e => e.type === 'supersede' && e.target_run_id === h.halted), '后继须审计承接停放的 run');
  assert(!contentRepairs(events).length && !outOfChainStarts(events).length, '后继不得再派发（B1 已修好；同签名也已用掉）');
  assertCompletedBy(s, h.feature, successor, `S16 绑定失效支（${via}）`);
  return { feature: h.feature, runs: [h.halted, successor], halted: h.halted, haltIndex, haltClass: 'B1', interventions, evidence };
}

// ---- S16 反例六：两个真实 run 竞争同一蓝图的修复 ------------------------------------------------------
// 兄弟 CU（ledger-summary）的 run 跑在同一进程的另一个线程里：goal 运行时与测试缝都是模块级状态，线程之间互相隔离；
// 两层锁是同一套文件锁（持有者 pid 相同且存活 = 别人持有），所以这是两个真实 run 之间的真实竞争，不是手工占锁。

const SIBLING_FEATURE = deriveChangeUnitFeatureId(BLUEPRINT_ID, SIBLING);
const SIBLING_REQUIREMENT = '账本汇总卡片';
/** 用户经生产入口（goal-mode-entry --prepare-scope 同一函数）为兄弟 CU 准备运行范围。 */
function prepareSiblingScope(s: Snapshot): void {
  clearFrameworkConfigCache();
  const prepared = prepareFeatureScopeCandidate({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature: SIBLING_FEATURE, completionTarget: 'feature',
    requestedResults: [SIBLING_REQUIREMENT], requestedPhases: ['spec'], requirement: SIBLING_REQUIREMENT, overwrite: true });
  assert.deepStrictEqual(prepared.scope.phase_chain, ['spec', 'plan'], '前提：兄弟 CU 的出生链');
}

/** 兄弟 CU 的手写验收（spec 责任方写的手写文件，内容取本 CU 的验收）。 */
function writeSiblingAcceptance(s: Snapshot): void {
  const doc = readDoc(featureFilePath(s.root, SNAPSHOT_CU_FEATURE, 'acceptance.yaml'));
  doc.feature = SIBLING_FEATURE;
  delete doc.source;
  writeDoc(featureFilePath(s.root, SIBLING_FEATURE, 'acceptance.yaml'), doc);
}

/**
 * 兄弟 CU 的 fresh run（需要出生期参数时用：后继的预算继承源 run、按交付周期累计，host bridge 上本 CU 的后继出生受快照里
 * 历史绝对路径的影响依据所限）：宿主手写派生文件 →（预授权）→ 准备兄弟 CU 的运行范围 → 蓝图验收写成文字、调和、提交 →
 * 公开入口 fresh 出生 → spec 的真实门报 B1。
 */
async function siblingFreshRun(s: Snapshot, extra: Record<string, unknown> = {}): Promise<{ b: S16Born; adapter: ReturnType<typeof repairAdapter>; exitCode: number }> {
  handWriteProjections(s.root);
  preauthorize(s);
  prepareSiblingScope(s);
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); node.acceptance = TEXT_ACCEPTANCE; });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(!r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const baseRevision = Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision);
  const adapter = repairAdapter(s, () => saved);
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: 'spec', freshEndPhase: 'plan',
    realHarness: true, noAutoForce: true, onOutOfChain: adapter.onOutOfChain, onSpec: () => writeSiblingAcceptance(s), ...extra,
  });
  const [runId] = runIds(s.root, SIBLING_FEATURE);
  assert(runId, `兄弟 run 未出生：exit=${probe.exitCode}`);
  return { b: { feature: SIBLING_FEATURE, runId, events: eventsOf(s, SIBLING_FEATURE, runId), baseRevision } as S16Born, adapter, exitCode: probe.exitCode };
}

/**
 * worker 线程一侧：兄弟 CU 的真实 run（公开入口出生、真 harness）。spec 首轮的 agent 调用里先写手写验收，然后停在这里
 *（此时它持有自己的 feature 锁）等主线程放行；之后照常走真实门、派发与发布。
 */
export async function __siblingRunInWorker(): Promise<{ exitCode: number; runIds: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { workerData, parentPort } = require('worker_threads') as typeof import('worker_threads');
  const data = workerData as { root: string; frameworkRoot: string; signal: SharedArrayBuffer; saved: Ev };
  const s = { root: data.root, frameworkRoot: data.frameworkRoot } as Snapshot;
  const adapter = repairAdapter(s, () => data.saved);
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: 'spec', freshEndPhase: 'plan',
    realHarness: true, noAutoForce: true, onOutOfChain: adapter.onOutOfChain,
    onSpec: (ctx: { attempt: number }) => {
      if (ctx.attempt !== 1) return;
      writeSiblingAcceptance(s);
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
  const worker = new Worker(boot, { eval: true, workerData: {
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
 * 预算 reducer 的调用计数。交付周期边界取上一次完成的 run（与出生时传的同一个）。
 */
function replayedBudget(s: Snapshot, b: S16Born): Record<'resume' | 'successor', { attempted: boolean; turns: number }> {
  clearFrameworkConfigCache();
  const featuresDir = relFeaturesDir(s.root);
  const signature = String(contentRepairs(b.events)[0]?.signature);
  const current = loadAuthoritativeEvents(runFile(s.root, b.feature, b.runId, 'events.jsonl'));
  const resume = foldBudgetLineage({ projectRoot: s.root, featuresDir, feature: b.feature, currentEvents: current, cycleBoundary: b.completed });
  const successor = foldBudgetLineage({ projectRoot: s.root, featuresDir, feature: b.feature, seedTargets: [b.runId], currentEvents: [], cycleBoundary: b.completed });
  const turns = (events: Parameters<typeof resolveResumedBudget>[0]): number => resolveResumedBudget(events, { nextSessionStartMs: Date.now() }).totalTurns;
  return {
    resume: { attempted: designRepairAttempted([...resume.ancestorEvents, ...current], signature), turns: turns(resume.budgetFoldEvents) },
    successor: { attempted: designRepairAttempted(successor.ancestorEvents, signature), turns: turns(successor.budgetFoldEvents) },
  };
}

/** S16 反例一（场景侧用）：没有预授权 → B1 停机照旧停等，不派发。 */
export async function s16NoPreauthFlow(s: Snapshot): Promise<RepairFlow & { events: Ev[]; runId: string }> {
  const b = await s16Born(s, { preauth: false });
  assertNotDispatched(b, '无预授权');
  // 原注册用例 S16-c1 的外层断言（plan b0e0621c §3.3 并入）。
  assert.strictEqual(haltOf(b.events)?.design_authority?.class, 'B1', '前提：停机分类为 B1');
  const haltIndex = b.events.map(e => e.type).lastIndexOf('phase_halt');
  return { feature: b.feature, runs: [b.runId], halted: b.runId, haltIndex, haltClass: String(b.events[haltIndex]?.design_authority?.class), interventions: [],
    evidence: `停机=${String(b.events[haltIndex]?.halt_reason)} 分类=${String(b.events[haltIndex]?.design_authority?.class)} 无预授权、content_repair 事件 0、链外调用 0`, events: b.events, runId: b.runId };
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

const cases: Array<{ name: string; run: () => Promise<void> }> = [
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
      const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance', 'pure');
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
      const broken = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance', 'pure');
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
    name: 'B4-table 分类表：形状 / 引用身份类原因码归 B1；需要裁决、缺事实、扩大范围与混合原因码归 B2；空集、未登记与 B1+B2 混合一律 B2',
    run: async () => {
      for (const code of ['authority_content_not_machine_structure', 'authority_cu_mapping_stale']) {
        assert.strictEqual(classifyDesignAuthorityCodes([code]).class, 'B1', code);
      }
      assert.strictEqual(classifyDesignAuthorityCodes(['authority_content_not_machine_structure', 'authority_cu_mapping_stale']).class, 'B1', '全部 B1 才是 B1');
      const unlisted = classifyDesignAuthorityCodes(['a_code_added_later']);
      assert(unlisted.class === 'B2' && /未登记/.test(unlisted.needs.join()), `未列入的原因码默认 B2：${JSON.stringify(unlisted)}`);
      assert.strictEqual(classifyDesignAuthorityCodes([]).class, 'B2', '没有原因码不得当成 B1');
      for (const code of [
        'change_unit_current_design_unresolved', 'change_unit_contract_not_admitted', 'cu_architecture_impact_not_effective', 'cu_scope_matches_blueprint',
        'change_unit_schema_invalid', 'change_unit_design_ref_unresolvable', 'change_unit_blueprint_unresolvable', 'authority_contract_files_missing',
        'authority_content_conflict', 'authority_target_provenance_missing', 'change_unit_blueprint_ref_stale', 'component_blueprint_invalid', 'change_unit_missing',
        'authority_content_missing', 'authority_projection_shape_invalid', 'authority_cu_mapping_conflict',
      ]) {
        const verdict = classifyDesignAuthorityCodes([code]);
        assert(verdict.class === 'B2' && verdict.needs.length === 1 && !/未登记/.test(verdict.needs[0]), `${code} 应登记为 B2 并写清缺什么：${JSON.stringify(verdict)}`);
      }
      const mixed = classifyDesignAuthorityCodes(['authority_content_not_machine_structure', 'change_unit_current_design_unresolved']);
      assert(mixed.class === 'B2' && mixed.needs.length === 2, `B1 与 B2 混合按 B2：${JSON.stringify(mixed)}`);
    },
  },
  {
    name: 'B4-codes 原因码由真实投影生产者给出：整段内容写成文字、映射指向本 CU 旧 revision → B1；内容为 null / 数字、缺路径且无替代、映射指向另一个 CU → 不得判 B1',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      handWriteProjections(s.root);
      let base: Ev | undefined;
      /** 设计 owner 升一个 revision 并改 ledger-domain（其余保持原样），调和指针后取真实投影的原因码与分类。 */
      const project_ = (kind: 'acceptance' | 'contracts', mutate: (node: Ev) => void): { codes: string[]; cls: string; detail: string; locations: unknown } => {
        bumpBlueprint(s, bp => { const node = ledgerDomain(bp); base ??= structuredClone(node); restoreNode(node, base); mutate(node); });
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.some(x => x.change_unit_id === CU), JSON.stringify(r));
        clearFrameworkConfigCache();
        const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, kind, 'pure');
        assert.strictEqual(projected.state, 'invalid', `前提：投影无效：${JSON.stringify({ state: projected.state, detail: projected.detail })}`);
        return { codes: projected.codes ?? [], cls: classifyDesignAuthorityCodes(projected.codes ?? []).class, detail: String(projected.detail), locations: projected.locations };
      };
      const currentCuRef = (): Ev => {
        const loaded = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
        const cu = loaded.changeUnit as Ev;
        return { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: loaded.artifactSha256 };
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
      // 正例：映射引用指向本 CU 的旧 revision（写进蓝图之后 CU 随调和升版）→ 删掉这条可省略的引用即可（见 R3 用例）。
      const staleRef = currentCuRef();
      const stale = project_('contracts', node => { node.contracts.change_unit.change_unit_ref = staleRef; });
      assert(stale.cls === 'B1' && stale.codes.join() === 'authority_cu_mapping_stale', JSON.stringify(stale));
      assert.deepStrictEqual(stale.locations, [{ blueprint_id: BLUEPRINT_ID, target, field: 'contracts.change_unit.change_unit_ref' }], `映射过期位置：${JSON.stringify(stale.locations)}`);
      // 修复的授权边界（映射过期）：只许删掉这条引用；改成别的值、或顺手改另一处，都是越权的位置。
      const canonicalNow = loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint;
      const items = [{ check: 'authoritative_content_aligned', codes: stale.codes, class: 'B1' as const, artifacts: [], basis: '', needs: [], locations: stale.locations as never }];
      const draftWith = (edit: (node: Ev) => void): string[] => { const draft = structuredClone(canonicalNow); edit(ledgerDomain(draft)); return outOfScopePaths(canonicalNow, draft, BLUEPRINT_ID, items); };
      assert.deepStrictEqual(draftWith(node => { delete node.contracts.change_unit.change_unit_ref; }), [], '删掉过期引用在授权内');
      assert(draftWith(node => { node.contracts.change_unit.change_unit_ref = currentCuRef(); }).some(p => p.endsWith('contracts.change_unit.change_unit_ref.revision') || p.includes('change_unit_ref')), '改指别的值是越权');
      assert(draftWith(node => { delete node.contracts.change_unit.change_unit_ref; node.contracts.files.push(NEW_CONTRACT_FILE); }).some(p => p.includes('contracts.files')), '顺手扩写集是越权');
      // 反例：映射引用指向另一个 CU → 归属冲突。
      const otherRef = { ...currentCuRef(), change_unit_id: SIBLING };
      const other = project_('contracts', node => { node.contracts.change_unit.change_unit_ref = otherRef; });
      assert(other.cls === 'B2' && other.codes.join() === 'authority_cu_mapping_conflict', `指向另一个 CU 不得判 B1：${JSON.stringify(other)}`);
    }),
  },
  {
    name: 'R3 映射过期的修法（真实快照 + 真实调和）：把蓝图里的 change_unit_ref 改指当前 CU，发布后调和把 CU 升一版、引用立即又过期；删掉这条可省略的引用、由投影填入当前引用，调和后仍稳定',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      handWriteProjections(s.root);
      const currentCuRef = (): Ev => {
        const loaded = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
        const cu = loaded.changeUnit as Ev;
        return { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: loaded.artifactSha256 };
      };
      /** 发布一个新 revision（蓝图改动 = mutate）→ 真实调和 → 真实投影的原因码。 */
      const publish = (mutate: (node: Ev) => void): string[] => {
        bumpBlueprint(s, bp => mutate(ledgerDomain(bp)));
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.some(x => x.change_unit_id === CU), JSON.stringify(r));
        clearFrameworkConfigCache();
        const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'contracts', 'pure');
        return projected.state === 'invalid' ? projected.codes ?? [] : [];
      };
      // 造出 B1：引用指向本 CU 当时的 revision，发布后 CU 随调和升版。
      const staleRef = currentCuRef();
      assert.deepStrictEqual(publish(node => { node.contracts.change_unit.change_unit_ref = staleRef; }), ['authority_cu_mapping_stale']);
      // 修法一"改指当前 CU"：写进蓝图那一刻是当前，发布后调和又把 CU 升一版 → 再次过期（蓝图字节含 CU 的 sha、CU 字节含蓝图的 sha）。
      const repointed = currentCuRef();
      const again = publish(node => { node.contracts.change_unit.change_unit_ref = repointed; });
      console.log(`[design-authority-repair] R3 改指当前 CU 发布后=${JSON.stringify(again)}`);
      assert.deepStrictEqual(again, ['authority_cu_mapping_stale'], 'K4：改指当前 CU 在发布后的调和里必然再次过期');
      // 修法二"删掉可省略的引用"：投影按当前 CU 填入，其余映射保留；调和后稳定。
      const removed = publish(node => { delete node.contracts.change_unit.change_unit_ref; });
      console.log(`[design-authority-repair] R3 删掉引用发布后=${JSON.stringify(removed)}`);
      assert(!removed.some(code => code.startsWith('authority_cu_mapping')), `删掉引用后不得再报映射问题：${JSON.stringify(removed)}`);
      assert(Object.keys(ledgerDomain(YAML.parse(fs.readFileSync(blueprintFile(s), 'utf8'))).contracts.change_unit).length > 0, '其余映射保留');
    }),
  },
  {
    name: 'B1-mixed 混合阻断逐条查 + B3 第七种变化只在探针就绪时成立（真 harness）：plan 的真实门同时报内容形状坏（B1）与施工范围越界（B2）→ 停机带两条简报、整体 B2；只修一条探针仍未就绪、不算外部条件就绪；两条都不再阻断才就绪并重新接入；显式换型号仍按原判据起后继',
    run: () => withHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const contractsFile = featureFilePath(s.root, feature, 'contracts.yaml');
      const widen = (on: boolean): void => {
        const doc = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
        doc.modules = doc.modules.filter((m: { name: string }) => m.name !== 'OutsideModule');
        if (on) doc.modules.push({ name: 'OutsideModule', layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: 'src/outside' });
        fs.writeFileSync(contractsFile, YAML.stringify(doc));
        clearFrameworkConfigCache();
      };
      let saved: Ev | undefined;
      // 与 S14 同一驱动：run 真实出生、spec 真实过门；plan 首轮进行中设计 owner 把蓝图升版并把验收写成了文字（未调和），
      // plan 的 agent 每一轮都把一个蓝图没授权的模块写进 contracts。框架先在 run 内调和指针，重评时 plan 的真实门报两条设计 owner 阻断。
      const run = await runWithStalePointerAtPlan(s, {
        atInjection: () => {
          const bp = YAML.parse(fs.readFileSync(blueprintFile(s), 'utf8'));
          const node = ledgerDomain(bp);
          saved = structuredClone(node);
          node.acceptance = TEXT_ACCEPTANCE;
          fs.writeFileSync(blueprintFile(s), YAML.stringify(bp));
        },
        afterPlanWrites: () => widen(true),
      });
      const runId = run.successor;
      const events = run.events;
      assert(repairs(run)[0]?.outcome === 'reconciled', `前提：指针过期先由 run 内调和修好：${describeRun(run)}`);
      const halt = haltOf(events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.phase === 'plan' && halt.probe === 'design_authority_projectable', JSON.stringify(halt));
      const items = (halt!.design_authority as { class: string; items: Array<{ check: string; class: string; codes: string[] }> });
      assert.deepStrictEqual(items.items.map(item => `${item.check}:${item.class}:${item.codes.join(',')}`).sort(),
        ['authoritative_content_aligned:B1:authority_content_not_machine_structure', 'cu_scope_matches_blueprint:B2:cu_scope_matches_blueprint'], JSON.stringify(items));
      assert.strictEqual(items.class, 'B2', '混合阻断整体按 B2（不得把需要决定的问题当成可直接修）');
      assert(/分类：B2/.test(String(halt!.halt_guidance)) && /扩大范围需要设计 owner 决定/.test(String(halt!.halt_guidance)), String(halt!.halt_guidance));
      const dir = reportDirOf(s, feature, runId);
      const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, runId, 'manifest.json')).requirement;
      const probe = (): { ready: boolean; reason?: string } => { clearFrameworkConfigCache(); return runConditionProbe(s.root, dir, 'design_authority_projectable', 'plan'); };
      const decide = (extra: Partial<Parameters<typeof decideRunContinuation>[0]> = {}, call: Record<string, unknown> = {}) => {
        clearFrameworkConfigCache();
        return decideRunContinuation({ projectRoot: s.root, feature, call: { requirement, ...call }, ...extra });
      };
      const both = probe();
      assert(!both.ready && /authoritative_content_aligned/.test(both.reason!) && /cu_scope_matches_blueprint/.test(both.reason!), JSON.stringify(both));
      const first = decide();
      // 这个现场里框架的 run 内调和改过 contracts.yaml，既有的 related_repair_changed 已让重发重新接入（与本批无关）；
      // 这里只核第七种变化：探针未就绪时不得出现。冷却期内保持停止的真实链路证据在 S15-rejoin 的未修重发一步。
      assert(!/external_condition_ready/.test(JSON.stringify(first)), `探针未就绪时不得算外部条件已就绪：${JSON.stringify(first).slice(0, 600)}`);
      // 只修 B1 那条（经 readiness 调和）→ 另一条仍阻断 → 未就绪。
      repairViaReadiness(s, node => restoreNode(node, saved!), 'blueprint: acceptance back to machine structure');
      const one = probe();
      assert(!one.ready && !/authoritative_content_aligned/.test(one.reason!) && /cu_scope_matches_blueprint/.test(one.reason!), `只修一条不得就绪：${JSON.stringify(one)}`);
      const held = decide();
      assert(!/external_condition_ready/.test(JSON.stringify(held)), `只修一条时不得算外部条件已就绪：${JSON.stringify(held).slice(0, 600)}`);
      // 其它变化事实的判定不变：显式换型号照旧起后继（与探针无关）。
      const model = decide({}, { model: 'another-model' });
      assert(model.kind === 'successor' && model.change === 'model_changed', JSON.stringify(model));
      // 探针就绪只能来自真实恢复：另一条也不再阻断 → 就绪 → 冷却期内重新接入。
      // plan 责任方把越界模块去掉：contracts.yaml 的写入边界是 feature 锁（与阶段写入、调和器同一把），先取锁再写。
      const writer = tryAcquireLock(featureLockPath(s, CU), { run_id: 'plan-owner-session' });
      assert(writer, '停放的 run 已释放 feature 锁，责任方才能取到写入锁');
      try { widen(false); } finally { releaseLock(featureLockPath(s, CU), writer!.ownerId); }
      const ready = probe();
      assert(ready.ready, JSON.stringify(ready));
      const rejoin = decide();
      assert(rejoin.kind === 'rejoin' && rejoin.runId === runId && /external_condition_ready/.test(rejoin.reason), JSON.stringify(rejoin));
      assert(!/external_condition_ready/.test(JSON.stringify(decide({ runProbe: () => ({ ready: false }) }))), '同一现场、探针未就绪时不算这种变化');
    }),
  },
  // S15 四支、S16 主线与两个绑定失效支、S16-c1 无预授权：只在 reliability-scenarios 的 S15 / S16 里跑（plan b0e0621c §3.3，断言在共享流程函数里）。
  {
    name: 'S16-c1c 有人在场（会话 owner，host bridge）+ 预授权 + B1 → 不派发，交会话里的设计 owner',
    run: () => withHost(async s => {
      // 用兄弟 CU 的 fresh run：会话 owner 经 host bridge 出生（本 CU 的后继出生在 host bridge 上受快照里历史绝对路径的影响依据所限）。
      const { b } = await siblingFreshRun(s, { viaHostBridge: true });
      console.log(`[design-authority-repair] S16-c1c ${describeS16(b)}`);
      assert(!contentRepairs(b.events).length && !outOfChainStarts(b.events).length, `有人在场不得派发：${describeS16(b)}`);
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.design_authority?.class === 'B1', `应停在设计 owner 出口：${describeS16(b)}`);
    }),
  },
  {
    name: 'S16-c1b 预授权写成字符串 "true"（宿主手写错）→ 不算授权，不派发',
    run: () => withHost(async s => {
      const b = await s16Born(s, { preauth: 'true' });
      assertNotDispatched(b, '字符串预授权');
      assert.strictEqual(haltOf(b.events)?.design_authority?.class, 'B1', '前提：停机分类为 B1');
    }),
  },
  {
    name: 'S16-c2 草稿外改动：编写调用改了需求、契约与个人配置 → 不发布，走既有违规处置（phase_write_violation + 违规停机出口，不降为设计等待），事件披露路径与前后哈希；被改文件不还原',
    run: () => withHost(async s => {
      const touched = ['requirements/ledger.md', 'contracts/ledger-api.yaml', 'framework.local.json', 'context/ledger-api.yaml'];
      const b = await s16Born(s, {
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
      assert(halt?.halt_reason === 'backtrack_target_absent' && !halt.probe && /版本控制/.test(String(halt.halt_guidance)), `应走既有违规停机出口、不挂探针：${JSON.stringify(halt)}`);
      assert(endOf(b.events)?.status !== 'CHAIN_SLICE_COMPLETED', '不得完成');
      // "不发布"与"未发生越界改写"是两个断言：canonical 没变，但被改的文件仍是改后的样子（只检测、不还原）。
      assert(/修复调用顺手改的/.test(fs.readFileSync(path.join(s.root, touched[0]), 'utf8')) && readJson<Ev>(LOCAL_FILE(s)).vision.canary.probed_at === '2026-10-01T00:00:00.000Z', '框架不替操作者还原');
    }),
  },
  {
    name: 'S16-c2b 必需快照不可验证：编写调用之后草稿外某个文件读不出来 → 不当作干净继续，不发布，同样走违规停机出口',
    run: () => withHost(async s => {
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
    run: () => withHost(async s => {
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
    run: () => withHost(async s => {
      const b = await s16Born(s, { adapter: { questioning: doc => { delete doc.review_summary.questioning; } } });
      console.log(`[design-authority-repair] S16-c3b ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '质询无结果');
      assert(/没有产出质询结果/.test(String(failed.reason)), JSON.stringify(failed));
    }),
  },
  {
    name: 'S16-c3c 编写调用自报准入（改了 review_summary.admission）→ 不予采信，不发布',
    run: () => withHost(async s => {
      const b = await s16Born(s, { adapter: { author: doc => { doc.review_summary.admission.current_slice.controlled_fakes = ['self-asserted-pass']; } } });
      console.log(`[design-authority-repair] S16-c3c ${describeS16(b)}`);
      assertNotPublished(s, b, 'self_reported', '自报准入');
      assert(!b.log.prompts['design-repair-questioning'], '自报之后不得再派质询调用');
    }),
  },
  {
    name: 'S16-c3d 修复后准入不通过（质询结果缺必答范围）→ 机器派生不过，不发布',
    run: () => withHost(async s => {
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
    run: () => withHost(async s => {
      const { b, adapter, exitCode } = await siblingFreshRun(s, { freshBudget: { max_total_turns: 2 } });
      const probe = { exitCode };
      console.log(`[design-authority-repair] S16-c3e exit=${probe.exitCode} ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '预算不足');
      assert(/未启动/.test(String(failed.reason)) && outOfChainStarts(b.events).length === 1 && !adapter.log.prompts['design-repair-questioning'], JSON.stringify(failed));
      assert.strictEqual(b.events.filter(e => e.type === 'agent_invoke_start').length, 2, '调用次数 = 实际启动的调用（spec 一次 + 编写一次）');
    }),
  },
  {
    name: 'S16-c4 B2 停机且预授权开启 → 不派发',
    run: () => withHost(async s => {
      const b = await s16Born(s, { corrupt: node => { node.acceptance = null; } });
      assertNotDispatched(b, 'B2');
      assert.strictEqual(haltOf(b.events)?.design_authority?.class, 'B2', JSON.stringify(haltOf(b.events)?.design_authority));
    }),
  },
  {
    name: 'S16-c7a 发布成功、探针不过（修法把内容写成了空）→ 不回滚发布，记未恢复，按发布后的新状态（B2）停机并披露已发布 rev 与卡点',
    run: () => withHost(async s => {
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
    name: 'S16-c7b 发布成功、调和未完成（本 CU 被调和器跳过）→ 不回滚发布、不落入草稿失败分支，如实记"已发布 rev N、调和未完成"并停机',
    run: () => withHost(async s => {
      // codex t6 第五轮之后，编写调用只许改定位到的字段，改不出让调和器跳过本 CU 的蓝图；这里在质询调用期间把锁内调和换成"跳过本 CU"的替身（只此一次）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const preparation = require('../../scripts/utils/change-unit-design-preparation') as { reconcileHeldBlueprintRefs: (...args: unknown[]) => unknown };
      const real = preparation.reconcileHeldBlueprintRefs;
      let b: Awaited<ReturnType<typeof s16Born>>;
      try {
        b = await s16Born(s, { adapter: { questioning: () => {
          preparation.reconcileHeldBlueprintRefs = () => { preparation.reconcileHeldBlueprintRefs = real; return { bumped: [], skipped: [{ change_unit_id: CU, reasons: ['injected: 调和器跳过本 CU'] }] }; };
        } } });
      } finally {
        preparation.reconcileHeldBlueprintRefs = real;
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
    run: () => withHost(async s => {
      const prevCwd = process.cwd();
      process.chdir(s.root);
      let sibling: Awaited<ReturnType<typeof startSiblingRun>> | undefined;
      try {
        const b = await s16Born(s, {
          beforeCorrupt: () => prepareSiblingScope(s),
          beforeBirth: async saved => {
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
    run: () => withHost(async s => {
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
    run: () => withHost(async s => {
      const captured: { own?: Buffer; ancestor?: Buffer; ancestorFile?: string } = {};
      const b = await s16Born(s, { adapter: { questioning: (doc, draft) => {
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
      assert(budget.resume.turns === 3 && budget.successor.turns === 3, `预算回放应计 spec、编写、质询各一次：${JSON.stringify(budget)}`);
      const next = await supersede(s, b.feature, b.runId, b.chain, { ...authorsForContinuation(s, b.feature), noAutoForce: true });
      assert(next.successor, `后继未出生：${next.error}`);
      const succ = eventsOf(s, b.feature, next.successor!);
      console.log(`[design-authority-repair] S16-r1 successor ${describeS16({ events: succ })}`);
      assert(!contentRepairs(succ).length && !outOfChainStarts(succ).length, `后继不得获得第二次机会：${describeS16({ events: succ })}`);
    }),
  },
  {
    name: 'S16-r5 编写调用新引用了通常排除目录里的文件（codex t6 确认轮 C）：调用前它不在核对范围、调用期间是否被改无从核实 → 不当作干净继续，走违规停机、不发布',
    run: () => withHost(async s => {
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
    run: () => withHost(async s => {
      const otherRunDir = path.join(featureFilePath(s.root, 'demo-card', ''), 'goal-runs', '20260925T043142Z-233c9c');
      const otherLock = path.join(featureFilePath(s.root, 'demo-card', ''), 'goal-runs', FEATURE_LOCK_NAME);
      const before = { events: sha(path.join(otherRunDir, 'events.jsonl')), beacon: sha(path.join(otherRunDir, 'liveness.json')) };
      let heartbeatsDuringAuthor = 0;
      let ownUpdated: Record<string, boolean> = {};
      try {
        const b = await s16Born(s, {
          // plan b0e0621c §3.2：本 run 出生前缩短真实心跳定时器的间隔（回调不变）；驱动层 finally 复位，用例 finally 兜底。
          beforeBirth: async () => { __testing_setLockHeartbeatMs(TEST_LOCK_HEARTBEAT_MS); },
          adapter: { author: async (_doc, draft) => {
            // 另一 feature 的 run 正常运行：取它自己的 feature 锁并刷新、追加心跳事件、写 beacon 与进度、刷新阶段状态。
            const lock = tryAcquireLock(otherLock, { run_id: '20260925T043142Z-233c9c' });
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
            writeLivenessBeacon({ projectRoot: s.root, reportDir: path.relative(s.root, otherRunDir).replace(/\\/g, '/'), runId: '20260925T043142Z-233c9c' });
            fs.writeFileSync(path.join(otherRunDir, 'progress.json'), `${JSON.stringify({ heartbeat: Date.now() })}\n`);
            fs.writeFileSync(featureFilePath(s.root, 'demo-card', 'next.json'), `${JSON.stringify({ phase: 'testing', at: Date.now() })}\n`);
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
    run: () => withHost(async s => {
      let siblingRun = '';
      let siblingEvents = '';
      let during: { code: number; spawned: string[][]; before: Buffer; after: Buffer } | undefined;
      const b = await s16Born(s, {
        preauth: false,
        beforeCorrupt: () => prepareSiblingScope(s),
        beforeBirth: async () => {
          // 兄弟 CU 先跑：此刻还没有预授权 → 真实门报 B1，停在设计 owner 出口（停放、挂探针）。
          const probe = await runGoalRuntimeChain(s.root, {
            frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: 'spec', freshEndPhase: 'plan',
            realHarness: true, noAutoForce: true, onSpec: () => writeSiblingAcceptance(s),
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
    name: 'S16-r7 授权边界（codex t6 第五轮）：编写调用按原意修好验收结构，同时给同一节点的 contracts.files 加了一个文件 → 越出本次 B1 发现项定位的字段，尝试失败、不发布、canonical 字节不变、不走越界违规出口，事件写明越权的路径',
    run: () => withHost(async s => {
      let before: Buffer | undefined;
      const b = await s16Born(s, {
        beforeBirth: async () => { before = fs.readFileSync(blueprintFile(s)); },
        adapter: { fix: (node, original) => { restoreNode(node, original); node.acceptance.criteria[0].expected_result = NEW_EXPECTED_RESULT; node.contracts.files.push(NEW_CONTRACT_FILE); } },
      });
      console.log(`[design-authority-repair] S16-r7 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author_scope', '扩大写集');
      assert(/定位之外/.test(String(failed.reason)) && /contracts.files/.test(String(failed.reason)) && !/acceptance/.test(String(failed.reason)), `事件须写明越权路径、不含被授权的验收：${failed.reason}`);
      assert(fs.readFileSync(blueprintFile(s)).equals(before!), 'canonical 字节不变');
      assert(!b.events.some(e => e.type === 'phase_write_violation') && haltOf(b.events)?.halt_reason === 'execution_scope_unresolved', `按其它发布前失败收口（设计 owner 停机），不走越界违规出口：${describeS16(b)}`);
      assert(!b.log.prompts['design-repair-questioning'], '越权之后不得再派质询调用');
      // 发现项带了位置，编写提示词里写明只许改的位置。
      assert(/只许改的位置：node:[^；]*ledger-domain.acceptance/.test(b.log.prompts['design-repair-author'][0]), '编写提示词须写明只许改的位置');
    }),
  },
  {
    name: 'S16-r2 编写调用的子进程收容绑定失败（codex t6 首轮 2）：未证明消失 → 走既有 agent_containment_unresolved 停机，不发布、不启动质询、不挂设计探针；已证明消失 → 按普通尝试失败收口（设计 owner 停机）',
    run: () => withHost(async s => {
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
    run: () => withHost(async s => {
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
  {
    name: 'S16-r4 取锁中途 I/O 异常（codex t6 首轮 4）：第二把 feature 锁注入一次 EACCES → 本次自取的锁全部放掉、借来的锁仍在、原异常抛出；同进程重试成功',
    run: () => withSnapshot(s => {
      handWriteProjections(s.root);
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
    run: () => withHost(async s => {
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
    name: 'S15-wake 进程内探针唤醒也经同一恢复判断：设备类等待期间蓝图变了、派生绑定失效 → 探针就绪也不在本进程继续（不重查、立即停放）；探针就绪后操作者手工 --resume 也改为起后继并完成',
    run: () => withHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const completed = await derivedContractsCompletion(s);
      bumpBlueprint(s, changeProjectedAcceptance);
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
      commit(s, 'blueprint rev3 admitted');
      const chain = successorChain(s, feature, completed);
      assert(chain.at(-1) === 'ut', `前提：出生链到 ut：${JSON.stringify(chain)}`);
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
      const next = await supersede(s, feature, completed, chain, {
        ...specFirstCuHooks(project(s, feature), true), noAutoForce: true,
        // 若恢复判断被绕过，设备门会被重查——此时设备已上线，真实的门放行，run 就会在失效的绑定上继续。
        deviceGate: (o: Parameters<typeof runDeviceReadinessGate>[0]) => {
          gateCalls += 1;
          return runDeviceReadinessGate({ ...o, input: { ...o.input, configuredSerial: null, credentialRef: null, emulatorFallback: 'disabled', existingManaged: null, deps: deviceDeps } });
        },
        conditionWait: {
          maxWaitMs: 5_000, pollMs: 50,
          // 等待期间设计 owner 在另一会话升了蓝图并改了施工契约内容（run 持锁，调和不了）；随后设备上线。
          runProbe: (name: string) => {
            probes += 1;
            if (probes === 1) { bumpBlueprint(s, bp => { ledgerDomain(bp).contracts.files.push(NEW_CONTRACT_FILE); }); clearFrameworkConfigCache(); device.online = true; }
            return evaluateDeviceReadinessProbe({ targets: deviceDeps.listTargets(), snapshot: { locked: false, cooldown: { state: 'not_cooldown' } } as never }, name as 'device_readiness');
          },
        },
      });
      assert(next.successor, `后继未出生：${next.error}`);
      const runId = next.successor!;
      const events = eventsOf(s, feature, runId);
      console.log(`[design-authority-repair] S15-wake gateCalls=${gateCalls} probes=${probes} verdicts=${JSON.stringify(verdictsOf(events))} end=${JSON.stringify(endOf(events))}`);
      assert(events.some(e => e.type === 'condition_wait_started' && e.probe === 'device_readiness'), '前提：设备类等待在进程内进行');
      assert.strictEqual(gateCalls, 1, '冻结绑定已失效时不得重查放行、在原 run 上继续');
      assert(probes >= 1 && probes <= 3, `探针就绪后应立即停放，而不是空等到上限：probes=${probes}`);
      assert(!events.some(e => e.type === 'condition_wait_ready') && events.some(e => e.type === 'condition_wait_timeout'), '应按未恢复收尾并停放');
      const parked = haltOf(events);
      assert(parked?.halt_reason === 'device_not_ready' && parked.probe === 'device_readiness' && parked.run_disposition === 'WAITING' && endOf(events)?.status !== 'CHAIN_SLICE_COMPLETED',
        `应按设备类等待原样停放（事件仍带原探针）：${JSON.stringify(parked)} ${JSON.stringify(endOf(events))}`);
      // 停放后设计 owner 的 readiness 能取到锁；下一次恢复入口（同一判断）：探针就绪 → 从停机 run 起后继；未就绪 → 冷却内保持停止。
      const readiness = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(!readiness.blueprintRefs.busy && readiness.blueprintRefs.bumped.some(b => b.change_unit_id === CU), JSON.stringify(readiness.blueprintRefs));
      clearFrameworkConfigCache();
      const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, runId, 'manifest.json')).requirement;
      const decided = decideRunContinuation({ projectRoot: s.root, feature, call: { requirement }, runProbe: () => ({ ready: true }) });
      assert(decided.kind === 'successor' && decided.change === 'external_condition_ready' && decided.targets.includes(runId) && /contracts/.test(decided.reason), JSON.stringify(decided));
      // 探针未就绪时判定照旧（这支停放的 run 以 PARTIAL 收尾，既有规则对它不设冷却）：重新接入，由原来的设备门判断。
      const waiting = decideRunContinuation({ projectRoot: s.root, feature, call: { requirement }, runProbe: () => ({ ready: false }) });
      assert(waiting.kind === 'rejoin' && !/external_condition_ready/.test(waiting.reason), JSON.stringify(waiting));
      // 操作者手工 `--resume`（前台、不带 --force）也经同一判断：设备探针就绪、绑定已失效 → 不在原 run 上继续，改为起后继并完成。
      const before = new Set(runIds(s.root, feature));
      const resumed = await runGoalRuntimeChain(s.root, {
        frameworkRoot: s.frameworkRoot, featureId: feature, resume: runId, noAutoForce: true,
        conditionWait: { runProbe: (name: string) => evaluateDeviceReadinessProbe({ targets: deviceDeps.listTargets(), snapshot: { locked: false, cooldown: { state: 'not_cooldown' } } as never }, name as 'device_readiness') },
        ...authorsForContinuation(s, feature),
      });
      clearFrameworkConfigCache();
      const born = runIds(s.root, feature).filter(id => !before.has(id));
      assert(born.length === 1 && eventsOf(s, feature, runId).filter(e => e.type === 'run_start').length === 1,
        `显式 --resume 在绑定失效时应改为起后继、不得在原 run 上继续：exit=${resumed.exitCode} born=${JSON.stringify(born)}`);
      assert(eventsOf(s, feature, born[0]).some(e => e.type === 'supersede' && e.target_run_id === runId), '后继须审计承接停放的 run');
      assertCompletedBy(s, feature, born[0], 'S15 显式 --resume 改起后继');
    }),
  },
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

export async function runAll(): Promise<UnitCaseResult[]> {
  const only = process.env.DESIGN_AUTHORITY_REPAIR_ONLY;
  const results: UnitCaseResult[] = [];
  for (const c of cases.filter(item => !only || only.split(',').some(prefix => item.name.startsWith(prefix)))) {
    const started = Date.now();
    try {
      await c.run();
      results.push({ name: `design-authority-repair: ${c.name}`, ok: true });
    } catch (err) {
      results.push({ name: `design-authority-repair: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
    console.log(`[design-authority-repair] ${c.name.split('：')[0]} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return results;
}
