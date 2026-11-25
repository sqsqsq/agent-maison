import { unitCaseGroups } from '../utils/unit-case-selection';
// ============================================================================
// real-chain-seams.unit.test.ts — plan d4a1f7c3 §5：接缝的窄负例
// ----------------------------------------------------------------------------
// 与正例（`real-chain.unit.test.ts`）**共用构建代码、不共用冻结记录**：每条各自造工程，
// 只重跑受影响阶段（RC-2 走 runless 无 run 路径）。
//
// 断言口径统一为 plan §5 那一句：**链走得通；失败时 `owner` 与 `reason` 正确**。
// 不断言"结论正确"——本套件不冒充宿主验收，口径上限见 plan §1.1 / §8。
//
// **当前状态（2026-09-22）：六条全绿，按 `releaseOnly: true` 登记进 `CORE_SUITES`。**
// 夹具跑的是与真实宿主一致的 `obligation-driven`（workflow **1.2**）——W1/W3 要回归的冻结范围
// 分支只在 1.2 下存在，**不得靠改回 `spec-driven`（1.1）让它变绿**（1.1 下跑绿等于没测）。
// 曾挡住 coding 的那处生产缺口（goal 闭环不传 factsContext → 源码条目无 owner_phase →
// coding 按写集改源码即被 `post_agent` 门判 plan 漂移）已由 plan b5c1e9d7 修复（e128e07f）。
// 此后剩的两条红（RC-8a / RC-4 前提②）经复核**都是夹具把判据造错了地方，不是生产缺陷**，
// 改法与证据见 plan d4a1f7c3 §10.14；codex 五条阻断同笔落地。
//
// 已写出的六条：RC-1 / RC-2 / RC-3 / RC-4 / RC-8a / RC-8b（另 RC-9 见下）。
// RC-5 / RC-6a / RC-6b 未做——三条共用同一个前置：testing 必须真正驱动视觉采集链
//（`ui_change=new_or_changed` → `captureIfUiChanged` → nav 配置 → 截图/layout dump →
// `visual-diff.json`），而那条链在本仓从未被真实 harness 跑通过（正例链自述"视觉采集与 OCR
// 全链未驱动"）。RC-7 未做——四态各自给真实原因要真 goal-runner 子进程，成因依赖本机是否装了
// adapter CLI，按 §8「不许 SKIP 出包」这类环境依赖不得进发布门套件。理由与偏差全文见 plan §10.9。
// RC-9（plan 14771034 路径 1）2026-09-24 在 plan f3b8d261 生产修复上七条全过后登记；RC-9b（UT→coding）
// 2026-09-24 在 plan d7e3b9a4 生产修复上登记；之后追加 RC-8c/8d 和 5bddfc4a 的真实记录组合 RC-10。
// ============================================================================

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, type SelectedUnitCases } from '../utils/unit-case-selection';
import { rc10HostRuleCombination } from '../utils/host-rule-combination';
import {
  provisionRealChainProject,
  scaffoldRealChainHost,
  writeHostFile,
  REAL_CHAIN_REQUIREMENT,
  REAL_CHAIN_NEW_SOURCE,
  REAL_CHAIN_SOURCE,
  REAL_CHAIN_SOURCE_2,
  REAL_CHAIN_SERVICE,
  REAL_CHAIN_TEST,
  REAL_CHAIN_PNG_EXISTING,
  type RealChainProject,
} from '../utils/real-chain-host';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import {
  readSummary,
  assertCurrentPhaseClosed,
  assertCurrentOwnerEvidence,
  dumpPhase,
  signedVerifierDraftPath,
  publishRequestedVerifier,
  readDeliveredVerifierRequest,
  writeSpecMaterials,
  writePlanMaterials,
  writeCodingMaterials,
  writeReviewMaterials,
  writeUtMaterials,
  writeTestPlan,
  preserveChainFailure,
} from './real-chain.unit.test';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { executionRequestForInvoke } from '../../scripts/utils/session-execution-handoff';
import { resolvePhasePathOwnership } from '../../scripts/utils/phase-write-boundary';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { recomputePhaseEvidenceStaleness, loadPhaseEvidenceManifest, stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import {
  ensureFeatureExecutionScopeFrozen,
  readFeatureFrozenScope,
  featureEffectiveScope,
  applyFeatureScopeRevisionsThenMaybeComplete,
  appendFeatureScopeRevision,
} from '../../scripts/utils/feature-execution-scope';
import { prepareFeatureScopeCandidate, resolveScopeRevisionProposal } from '../../scripts/utils/feature-track';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs, type ResolvedInput } from '../../scripts/utils/capability-resolution';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { readPhaseRepairIssues } from '../../scripts/utils/repair-candidates';
import { sha256File } from '../../scripts/utils/effective-vision-context';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import {
  MAISON_GOAL_RUNNER_ENV,
  applyGoalModelPinEnv,
  applyGoalVisualProviderEnv,
} from '../../scripts/utils/phase-state';
import { sanitizeSpawnEnv, deleteEnvKeyCaseInsensitive } from '../../scripts/utils/process-integrity';
import { computeRequestSubjectId, type VerifierRequest } from '../../scripts/utils/verifier-request';
import { loadVerifierEvidence } from '../../scripts/utils/verifier-evidence';
import { resolveCompletionDisposition, readCurrentCheckObservation, readReusableCheckResult } from '../../scripts/utils/verify-feature-completion';
import { buildVerifierMaterialView, computeMaterialSha256, type VerifierMaterialView } from '../../scripts/utils/verifier-material';
import { readCurrentPhaseRepairCandidates } from '../../scripts/utils/phase-closure-finalizer';
import { loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { isCheckNotApplicable, type CheckResult, type Phase } from '../../scripts/utils/types';
import type { WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>): void { cases.push({ name, run }); }
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const DEBUG = process.env.REAL_CHAIN_DEBUG === '1';

/** 工程里有指向源仓的 junction；已实测 `fs.rmSync(recursive)` 不跟进目标。 */
export function withProject(body: (p: RealChainProject, birthChain: string[]) => Promise<void>): () => Promise<void> {
  return async () => {
    const project = provisionRealChainProject();
    try {
      // 1.2：出生链由候选解析得出（天然短，随范围修订延长）。`--start/--end` 必须与它的
      // 首尾逐字相等（goal-phase-runtime.ts:4988），**不能再用 --end 截断链**。
      const birthChain = scaffoldRealChainHost(project);
      clearFrameworkConfigCache();
      await body(project, birthChain);
    } catch (error) {
      preserveChainFailure(project, error);
      throw error;
    } finally {
      if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
      else console.log('--- kept root', project.root);
      clearFrameworkConfigCache();
    }
  };
}

function dumpChain(p: RealChainProject, phases: readonly string[]): string {
  return phases.map(ph => dumpPhase(p, ph)).join('\n');
}

function haltEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return events.filter(e => e.type === 'phase_halt');
}

type MaterialView = VerifierMaterialView;

/**
 * 「本阶段实际审了哪些材料」的生产记录：`verifier.material.<subject>.json`
 * （verifier-material.ts:112-165，由 **harness 子进程**用 resolvedInputs + factsContext 解析）。
 *
 * 它是「本轮 verifier 审了哪些材料」的逐文件账本，subject 由它派生，因此最适合断
 * 「读集里有什么 / 没有什么」。
 * **注意不要据此推断 manifest 里没有源码**：`phase-closure-finalizer.ts:164/306` 另有
 * `capabilityResolutionEvidenceInputs` / `executedEvidenceInputs` 两条 extraInputs 通道，
 * 真实宿主的 coding/review/ut manifest 都登记了源码（codex 2026-09-22 裁定，plan §10.9 缺陷 1）。
 */
function materialFiles(p: RealChainProject, phase: string): MaterialView['files'] {
  const subject = readSummary(p, phase)?.verifier_subject_id;
  assert(!!subject, `${phase}：summary 无 verifier_subject_id，取不到材料视图`);
  const abs = path.join(featurePhaseReportsDir(p.root, p.feature, phase, p.frameworkRoot), `verifier.material.${subject}.json`);
  assert(fs.existsSync(abs), `${phase}：verifier 材料视图未落盘 ${abs}`);
  return (JSON.parse(fs.readFileSync(abs, 'utf-8')) as MaterialView).files;
}

/** 该阶段 reports 目录下所有材料视图（一份 = 一代材料）。 */
function materialGenerations(p: RealChainProject, phase: string): Array<{ subject: string; view: MaterialView }> {
  const dir = featurePhaseReportsDir(p.root, p.feature, phase, p.frameworkRoot);
  return fs.readdirSync(dir)
    .filter(f => /^verifier\.material\.[0-9a-f]{64}\.json$/.test(f))
    .sort()
    .map(f => ({
      subject: f.slice('verifier.material.'.length, -'.json'.length),
      view: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as MaterialView,
    }));
}

/**
 * 本阶段**真实的轮次身份**：回执里的 `claimed_attempt_id`（`receipt-scaffold.ts:179/202` 写，
 * 值取自上一轮 gate harness 的 `MAISON_GOAL_ATTEMPT`）。
 * **不能从 events 的 `phase_start` 取**——默认 detached 路径发的 `phase_start` 不带
 * `attempt_id`，只有 attended 的视觉分支写（`goal-phase-runtime.ts:7472`），
 * 据此取值会静默漏注这一键（codex 2026-09-22 二轮）。
 */
function phaseAttemptIdFromReceipt(p: RealChainProject, phase: string): string {
  const abs = featureFilePath(p.root, p.feature, `${phase}/phase-completion-receipt.md`);
  assert(fs.existsSync(abs), `${phase}：回执不存在，取不到真实轮次身份 ${abs}`);
  const m = /^claimed_attempt_id:\s*"([^"]*)"/m.exec(fs.readFileSync(abs, 'utf-8'));
  assert(m && m[1], `${phase}：回执没有 claimed_attempt_id，取不到真实轮次身份`);
  return m![1];
}

/**
 * 再跑一轮**真实 gate harness**。命令行 / cwd / shell 与 `goal-phase-runtime.ts:1272` 一致；
 * 子进程环境按 `:1227-1269` **逐键重建**——那一段内联在 `runHarnessPhase` 里、提不出函数，
 * 所以这里逐键对照，并且**全部复用生产导出的常量与执行器**
 *（`sanitizeSpawnEnv` / `MAISON_GOAL_RUNNER_ENV` / `applyGoalModelPinEnv` /
 * `applyGoalVisualProviderEnv` / `deleteEnvKeyCaseInsensitive`）。
 *
 * **有生产导出常量的键一律复用常量，不写字面**：`MAISON_GOAL_RUNNER_ENV` 这个标识符的**值**是
 * `MAISON_GOAL_RUNNER`（`phase-state.ts:83`），照标识符名写成字面键会让子进程
 * `isGoalOrchestrationEnv()` 判 false，整轮落到 interactive/manual 分支
 *（`harness-runner.ts:934` / `:1589`）——测的就不是生产分支了（codex 2026-09-22 二轮实锤，
 * 本 helper 初版正是这个错）。没有导出常量的三个轮次身份键与 `MAISON_GOAL_GATE_HARNESS`，
 * 生产那段本身就是字面量（`goal-phase-runtime.ts:1238-1242` / `:1268`），逐字对照。
 *
 * `deviceEnv` 是就绪门冻结的设备目标，生产在 `goal-phase-runtime.ts:8244` 原样传给 gate
 *（父进程 profile 回落 hmos-app 后 `ut.run` 属设备能力，桩会给 `HARNESS_HDC_TARGET` /
 * `MAISON_DEVICE_TARGET_KIND`）。调用方经 `deviceGate` 注入点返回并复用同一个
 * `RC4_DEVICE_ENV` 常量（`probe.harnessDeviceEnvs` 是注入桩的记录，`realHarness` 下取不到），
 * 不另造一份，否则乙段跑的是与甲段不同的环境（codex 2026-09-22 三轮）。
 *
 * 唯一由调用方变的是 `MAISON_TEST_AC_COVERAGE_NOW`，即"只换时钟"。
 *
 * `role='agent'`（RC-9b）：agent 会话内自跑的 harness——同一组轮次身份键，**不带** gate 标
 * （`phase-state.ts:184` `isAgentSideGoalHarness` 的判据），时钟不注入（沿用进程环境）。
 */
export function runGateHarness(
  p: RealChainProject, phase: string, clock: string | undefined, attemptId: string,
  deviceEnv: Record<string, string>, role: 'gate' | 'agent' = 'gate',
): { status: number | null; output: string } {
  // The CLI phase names the method; the environment must retain the real issued actor's phase.
  // P3 normally signs work-unit-author, so copying the method into this identity would change the invocation.
  const runId = process.env.MAISON_GOAL_RUN_ID ?? p.runId;
  const runDir = featureFilePath(p.root, p.feature, `goal-runs/${runId}`);
  const issued = [...loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'))].reverse()
    .filter(event => event.type === 'agent_invoke_start' && typeof event.invoke_id === 'string')
    .map(event => executionRequestForInvoke(runDir, String(event.invoke_id)))
    .find(original => original?.request.context.attemptId === attemptId && original.request.context.runId === runId
      && original.request.context.feature === p.feature && original.request.context.chain.includes(phase));
  assert(issued, 'gate replay must use the actual issued actor/attempt identity for this method');
  const sanitized = sanitizeSpawnEnv(clock === undefined ? { ...process.env } : { ...process.env, MAISON_TEST_AC_COVERAGE_NOW: clock });
  const childEnv: NodeJS.ProcessEnv = { ...sanitized.env, [MAISON_GOAL_RUNNER_ENV]: '1' };
  // 夹具无 model pin / 无 visual provider pin——生产此时同样是"只清不写"。
  applyGoalModelPinEnv(childEnv, undefined);
  applyGoalVisualProviderEnv(childEnv, undefined);
  deleteEnvKeyCaseInsensitive(childEnv, 'HARNESS_DIFF_BASE_REF');
  // 与生产同一个 `gateInjectedEnv`（`goal-phase-runtime.ts:1234-1249`）：轮次身份三键 + 设备目标，
  // 统一走"先清大小写变体再写唯一键"。
  for (const [k, v] of Object.entries({
    MAISON_GOAL_RUN_ID: runId ?? '',
    MAISON_GOAL_ATTEMPT: attemptId,
    MAISON_GOAL_ATTEMPT_PHASE: issued!.request.context.phase,
    ...deviceEnv,
  })) {
    deleteEnvKeyCaseInsensitive(childEnv, k);
    childEnv[k] = v;
  }
  deleteEnvKeyCaseInsensitive(childEnv, 'MAISON_GOAL_GATE_HARNESS');
  if (role === 'gate') childEnv.MAISON_GOAL_GATE_HARNESS = '1';
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', 'harness-runner.ts', '--phase', phase, '--feature', p.feature, '--summary'],
    { cwd: p.harnessDir, shell: process.platform === 'win32', encoding: 'utf-8', env: childEnv },
  );
  return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** 该 subject 的 verifier 调用凭证（subject 由它的字段派生，verifier-request.ts:77）。 */
function verifierRequestOf(p: RealChainProject, phase: string, subject: string): VerifierRequest {
  const abs = path.join(featurePhaseReportsDir(p.root, p.feature, phase, p.frameworkRoot), `verifier.request.${subject}.json`);
  assert(fs.existsSync(abs), `${phase}：subject ${subject.slice(0, 12)} 的 request 未落盘 ${abs}`);
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as VerifierRequest;
}

// ===========================================================================
// RC-1（墙 W1）：plan 开头链的源码读集
// ---------------------------------------------------------------------------
// 构造：`contracts.files` 同时含既有文件、**将在 coding 创建**的文件（BankListItem.ets）
// 与**永远不会创建**的文件（BankBadge.ets）；plan 阶段本身无写集。
// 判据（plan §5）：既有文件被读到、待创建文件不拖垮同组绑定、facts baseline 不 throw；
// **真缺失文件仍 absent**——宽容只作用在 plan 起步，不得泄漏到 coding 的完备性判定。
// ===========================================================================

const RC1_NEVER_CREATED = REAL_CHAIN_NEW_SOURCE.replace('BankListItem', 'BankBadge');

/** 在共用 plan 材料上追加一个永不创建的契约文件（契约与 plan 文件表两处同步）。 */
function addNeverCreatedContractFile(p: RealChainProject): void {
  const contractsAbs = featureFilePath(p.root, p.feature, 'contracts.yaml');
  const contracts = fs.readFileSync(contractsAbs, 'utf-8');
  assert(contracts.includes(`  - ${REAL_CHAIN_NEW_SOURCE}\n`), 'contracts.files 形状已变，RC-1 的追加点失效');
  fs.writeFileSync(
    contractsAbs,
    contracts.replace(`  - ${REAL_CHAIN_NEW_SOURCE}\n`, `  - ${REAL_CHAIN_NEW_SOURCE}\n  - ${RC1_NEVER_CREATED}\n`),
    'utf-8',
  );
  const planAbs = featureFilePath(p.root, p.feature, 'plan/plan.md');
  const plan = fs.readFileSync(planAbs, 'utf-8');
  const row = `| ${REAL_CHAIN_NEW_SOURCE} | 列表条目组件 | 新增 |\n`;
  assert(plan.includes(row), 'plan.md 文件表形状已变，RC-1 的追加点失效');
  fs.writeFileSync(planAbs, plan.replace(row, `${row}| ${RC1_NEVER_CREATED} | 银行标识角标 | 新增 |\n`), 'utf-8');
}

test('RC-1 plan 起步：待创建预测不拖垮绑定，未实现的预测位置只披露', withProject(async (project, birthChain) => {
  const planTimeSourceSha = sha256File(path.join(project.root, REAL_CHAIN_SOURCE));
  const { authorHooks } = await import('./lifecycle-evolution.unit.test');
  let activeAuthor: WorkUnitExecutionContext | undefined;
  let planRead: { material: VerifierMaterialView; contractsSha: string; invokeId: string } | undefined;
  const hooks = authorHooks(project, { spec: writeSpecMaterials,
    plan: p => { writePlanMaterials(p); addNeverCreatedContractFile(p); },
    coding: p => writeCodingMaterials(p), review: writeReviewMaterials, ut: writeUtMaterials, testing: writeTestPlan }, {
    plan: p => {
      if (planRead) return;
      assert(activeAuthor, 'the pre-construction reader must belong to the actual signed author');
      const context = activeAuthor!;
      const start = [...loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'))].reverse()
        .find(event => event.type === 'agent_invoke_start' && event.phase === context.phase);
      const issued = start?.invoke_id ? executionRequestForInvoke(context.runDir, String(start.invoke_id)) : null;
      assert(issued?.request.context.runId === context.runId && issued.request.context.attemptId === context.attemptId
        && issued.request.context.owner.owner_id === context.owner.owner_id && issued.request.context.owner.epoch === context.owner.epoch,
      'the plan/code consumer must retain its actual request and owner binding');
      assert(sha256File(path.join(p.root, REAL_CHAIN_SOURCE)) === planTimeSourceSha
        && [REAL_CHAIN_NEW_SOURCE, RC1_NEVER_CREATED].every(file => !fs.existsSync(path.join(p.root, file))),
      'capture actual plan inputs after its writer and before any predicted implementation exists');
      const entry = resolveCapabilityResolutionEntryInput({projectRoot:p.root, frameworkRoot:p.frameworkRoot, feature:p.feature,
        phase:'plan', goalRunId:context.runId, goalAttemptId:context.attemptId, featuresDir:relFeaturesDir(p.root)});
      const inputs = resolveCapabilityInputs({projectRoot:p.root, frameworkRoot:p.frameworkRoot, feature:p.feature, phase:'plan', track:'full', ...entry}).inputs;
      assert(inputs && !Object.values(inputs.values).some(value => value.state === 'invalid' && /stale/.test(value.detail ?? '')),
        'pending predictions must not make the actual pre-construction reader stale');
      planRead = {material:buildVerifierMaterialView({projectRoot:p.root, frameworkRoot:p.frameworkRoot, feature:p.feature, phase:'plan',
        runId:context.runId, factsContext:entry.factsContext, resolvedInputs:inputs!, gateFingerprint:null, phaseRuleText:'', templateText:'', checks:[], contextFiles:[]}),
        contractsSha:sha256File(featureFilePath(p.root,p.feature,'contracts.yaml'))!, invokeId:issued!.request.invoke_id};
    },
  });
  const probe = await runGoalRuntimeChain(project.root, {
    ...hooks,
    onAuthor: (ctx, context) => { activeAuthor = context; try { hooks.onAuthor(ctx, context); } finally { activeAuthor = undefined; } },
    frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec', freshEndPhase: birthChain[birthChain.length - 1], freshRequirement: REAL_CHAIN_REQUIREMENT,
  });
  const implementationWrite = probe.events.find(event => event.type === 'phase_write_observed'
    && ((event.owned ?? []) as Array<{path?: string; owner?: string; pre_sha256?: string; post_sha256?: string}>).some(write =>
      write.path === REAL_CHAIN_SOURCE && write.owner === 'coding' && write.pre_sha256 === planTimeSourceSha && write.post_sha256 !== planTimeSourceSha));
  const implementationAt = probe.events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === implementationWrite?.invoke_id);
  assert(implementationWrite && implementationAt >= 0 && planRead,
    'the actual author must consume its plan inputs before the observed implementation write');

  // ① plan 走通：facts baseline 没抛、待创建文件没把同组绑定拖垮。
  assertCurrentOwnerEvidence(project, 'plan');

  // ② 读集的**正反两面**都要成立，缺任何一面这条都会在源码集合全空时照样绿
  //    （codex 2026-09-22 阻断 1）：
  //    正面——1.2 的源码读集链真被行使：既有源码在 plan 材料里**存在且 sha 与盘上字节相等**；
  //    反面——待创建文件**一个都不进**读集，也不以 `sha256: null` 的 absent 形态混进来
  //          （W1 的根因正是把它们判 absent 后拖垮同组绑定；正确形态是「不存在就不进读集」）。
  const planMaterial = planRead!.material.files;
  const dump = JSON.stringify(planMaterial.map(f => `${f.path}:${f.sha256 ? 'sha' : 'null'}`));
  const existing = planMaterial.find(f => f.path === REAL_CHAIN_SOURCE);
  // 对的是 **plan 跑那一刻**的字节，不是现在盘上的——coding 已经按写集改写过这份源码，
  // 拿当下的盘面去比只会证明"coding 改过它"。
  assert(
    !!planTimeSourceSha && existing?.sha256 === planTimeSourceSha,
    `既有源码没进 plan 读集或 sha 不符（1.2 的 codeTargets 链没被行使）：${JSON.stringify(existing)}；`
    + `plan 期字节=${String(planTimeSourceSha).slice(0, 12)}；材料=${dump}`,
  );
  for (const pending of [REAL_CHAIN_NEW_SOURCE, RC1_NEVER_CREATED]) {
    const hit = planMaterial.find(f => f.path === pending);
    assert(!hit, `待创建文件混进 plan 读集（W1 的 absent 形态）：${JSON.stringify(hit)}；材料=${dump}`);
  }
  assert(planMaterial.every(f => !!f.sha256), `plan 读集里出现 absent 条目：${dump}`);

  // ③ 只有预测表提过、没有真实调用的文件不构成产品缺陷；仍在报告披露定位缺口。
  assertCurrentPhaseClosed(project, 'coding');
  assert(materialFiles(project, 'coding').some(file => file.path === path.relative(project.root,
    featureFilePath(project.root,project.feature,'contracts.yaml')).replace(/\\/g,'/') && file.sha256 === planRead!.contractsSha),
  'the real coding check must consume the actual plan writer\'s contracts bytes');
  const report = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(project.root, project.feature, 'coding', project.frameworkRoot), 'script-report.json'), 'utf8'));
  const completeness = report.checks.find((check: { id: string }) => check.id === 'file_completeness');
  assert(completeness?.status === 'WARN', JSON.stringify(completeness));
  assert(completeness.affected_files.includes(RC1_NEVER_CREATED), JSON.stringify(completeness));
  assert(!completeness.affected_files.includes(REAL_CHAIN_NEW_SOURCE), JSON.stringify(completeness));

}));

// ===========================================================================
// RC-2（墙 W2）：runless 下的范围修订不得把 implementation 义务的 basis 留空
// ---------------------------------------------------------------------------
// 构造：**无 run 的受管路径**（与本套件其余条目的 goal run 是两条路），
// **冻结时验收在场**（与 `execution-scope.unit.test.ts:1333` 先删验收的分支互补），
// 缺的是写集：`contracts.files` 为空 → 出生时 implementation 没有可核验 basis。
// 随后 plan 产出真契约并发修订。判据（plan §5 原文）：implementation 义务 basis
// **随新 contracts 刷新**、不留 `basis=[]`、重解析不抛 stale。
//
// **偏离 plan §5 的触发阶段（spec → plan），理由是实测的生产行为**（详见 plan §10.9 偏差 1）：
// 验收在冻结时已满足时，spec 再改 acceptance 不是修订路径——`resolveCapabilityInputs`
// 判该绑定 `state=invalid / "input binding stale; return to scope owner"`，
// `designScopeRevisionChecks`（blueprint-skill-projection.ts:51）因 `state !== 'resolved'`
// 直接早退，根本不发提案。本条末尾把这条"优雅拒绝而不是抛异常"的真实行为一并锁住。
// ===========================================================================

test('RC-2 runless：修订后 implementation basis 随新契约刷新、重解析不抛 stale（历史 reader；新独立出口不修订）', withProject(async project => {
  const { root, frameworkRoot, feature } = { root: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature };
  // 冻结 feature 记录只在 workflow 1.2 下存在（`resolveFeatureExecutionScope` 的前置）。
  const cfgPath = path.join(root, 'framework.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
  fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, active_workflow: 'obligation-driven' }, null, 2), 'utf-8');
  clearFrameworkConfigCache();
  // 冻结时**验收在场**（与 `execution-scope.unit.test.ts:1333` 先删验收的分支互补），
  // 缺的是设计：`contracts.yaml` 尚未产出 → design-context 是 plan 名下的出生缺口，
  // implementation 因此拿不到任何 basis。这就是 W2 那格的出生态。
  //
  // 为什么缺口必须在**设计**而不是验收：产物在冻结时已满足时，事后再改它不是修订路径——
  // `resolveCapabilityInputs` 判 `state=invalid / "input binding stale; return to scope owner"`，
  // `designScopeRevisionChecks`（blueprint-skill-projection.ts:51）因 `state !== 'resolved'`
  // 早退、根本不发提案（本条末尾 ④ 把这条真实行为一并锁住）。
  writeSpecMaterials(project);
  // 共用的作者材料里带一份 `established_by: spec` 的研究事实；本条是 runless，盘上没有
  // spec 阶段证据，留着它会让**另一条**新鲜度判据（facts baseline stale）先抛，把本条
  // 要验的 implementation basis 那格挡在后面。删掉它，保持单变量。
  fs.rmSync(featureFilePath(root, feature, 'context/facts.md'), { force: true });
  const contractsAbs = featureFilePath(root, feature, 'contracts.yaml');
  assert(!fs.existsSync(contractsAbs), '契约已在盘上，RC-2 的出生缺口不成立');

  prepareFeatureScopeCandidate({
    projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
    requestedResults: ['银行列表展示与开卡入口'], requestedPhases: ['plan', 'coding'],
    requirement: REAL_CHAIN_REQUIREMENT, overwrite: true,
  });
  const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
  assert(frozen.status === 'frozen', `冻结失败：${JSON.stringify(frozen.checks)}`);
  const born = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
  const dumpObligations = (s: typeof born): string => JSON.stringify({
    chain: s.phase_chain,
    obligations: s.obligations.map(o => ({ id: o.id, kind: o.kind, owner: o.owner_phase, applicability: o.applicability, basis: o.basis.map(b => b.input_id) })),
  });
  assert(born.phase_chain.includes('plan'), `冻结链缺 plan，本条无对象：${dumpObligations(born)}`);
  // 出生态：设计是缺口 → implementation 义务在场但 `basis: []`，coding 因此还排不进链。
  // 这正是 W2 那一格：修订若不把 basis 补上，coding 永远等不到可核验的施工依据。
  const bornImpl = born.obligations.filter(o => o.kind === 'implementation');
  assert(bornImpl.length > 0 && bornImpl.every(o => o.basis.length === 0),
    `出生时 implementation 不是"在场且 basis 为空"：${dumpObligations(born)}`);
  assert(!born.phase_chain.includes('coding'), `设计缺口未关而 coding 已排进链：${dumpObligations(born)}`);

  // plan 的真实产出：契约（既有文件 + 待创建文件，正是 W1 要的混合写集）。
  writePlanMaterials(project);
  fs.rmSync(featureFilePath(root, feature, 'context/facts.md'), { force: true });
  assert(fs.existsSync(contractsAbs), 'plan 未产出契约');

  // 提案由**生产**检查发布（feature 载体分支：factsContext.subject 无 run_id）。
  const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'plan', featuresDir: relFeaturesDir(root) });
  const resolvedInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'plan', track: 'full', ...bridge }).inputs!;
  const produced = designScopeRevisionChecks({
    projectRoot: root, frameworkRoot, feature, phase: 'plan',
    featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, resolvedInputs),
    resolvedInputs, factsContext: bridge.factsContext,
  } as never, []);
  const revisionCheck = produced.find(check => (check as { scope_revision_input?: unknown }).scope_revision_input);
  assert(revisionCheck, '生产设计检查未发布修订提案：' + JSON.stringify({
    produced,
    contracts: resolvedInputs.values.contracts,
    born: dumpObligations(born),
  }).slice(0, 1800));
  // 落盘走**生产 writer**（`report-generator.ts:116`），不是手拼 `{checks:[…]}`——手拼会绕开
  // `finalizeChecksForScriptReport` 的兼容降级/来源回填，于是修订在一份真实链上不会产生的
  // 报告形态里被消费（codex 2026-09-22 阻断 2）。
  generateScriptReport('', 'plan' as Phase, feature, root, [revisionCheck as CheckResult], frameworkRoot);

  const retired = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'plan', workflowTrack: 'full' });
  assert(retired.revisionApplied === false, `独立检查不能推进完整交付范围：${JSON.stringify(retired)}`);
  assert(readFeatureFrozenScope(root, feature)!.revisions.length === 0, 'new runless closing cannot act as a runner');
  // Historical revision fixture: the production readers retain this old representation.
  const historical = resolveScopeRevisionProposal({ projectRoot: root, frameworkRoot, feature,
    workflow: require('../../workflow-loader').resolveWorkflowSpec(root, { frameworkRoot }), previous: born,
    proposals: [revisionCheck!.scope_revision_input!], authorizedPhases: born.phase_chain, completedPhases: new Set(), currentPhase: 'plan' });
  assert(historical, 'the historical valid proposal must still resolve');
  appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: historical!.scope, trigger: { phase: 'plan' }, revisionInput: historical!.input });

  // ① implementation 义务 basis 随新契约刷新：既不留 `[]`，也不停在出生那代契约回落上
  //    ——写集里有既有文件之后，它必须绑到真实的 codebase 写集。
  const after = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
  const impl = after.obligations.filter(o => o.kind === 'implementation');
  assert(impl.length > 0, `修订后 implementation 义务消失了：${dumpObligations(after)}`);
  for (const o of impl) {
    assert(o.basis.length > 0, `修订后 implementation basis 为空（W2 的直接根因）：${JSON.stringify(o)}`);
    assert(
      o.basis.every((b: { dependencies?: unknown[] }) => (b.dependencies ?? []).length > 0),
      `implementation basis 没有任何可核验依赖：${JSON.stringify(o.basis)}`,
    );
  }
  assert(
    impl.some(o => o.basis.some((b: { input_id?: string }) => b.input_id === 'codebase')),
    `implementation basis 没有随新契约刷新到写集绑定：${dumpObligations(after)}`,
  );
  // basis 补上之后 coding 才排得进链——这是"不留 basis=[]"的下游后果，一并锁住。
  assert(after.phase_chain.includes('coding'), `修订后 coding 仍未排进链：${dumpObligations(after)}`);
  // ② 验收类义务只保留**本轮**那一代绑定（旧世代不得与新世代并存）。
  for (const o of after.obligations.filter(ob => ob.kind === 'acceptance-context')) {
    const acceptanceBindings = o.basis.filter((b: { input_id?: string }) => b.input_id === 'acceptance');
    assert(acceptanceBindings.length <= 1, `acceptance 旧世代未被替换：${JSON.stringify(acceptanceBindings)}`);
  }
  // ③ 重解析不抛 stale（W2 里这一步直接异常）。判据不能停在入口对象上——真正判
  //    `input binding stale` 的是后续 `resolveCapabilityInputs`（`capability-resolution.ts:666`
  //    把 expected_bindings 不符的输入改判 invalid），所以这里把 coding 的输入真解析一遍，
  //    逐项断**状态 / 绑定路径 / 内容**（codex 2026-09-22 阻断 2）。
  const codingBridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'coding', featuresDir: relFeaturesDir(root) });
  assert(codingBridge.inputContext !== undefined, `coding 重解析没拿到 inputContext：${JSON.stringify(codingBridge).slice(0, 400)}`);
  const codingInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'coding', track: 'full', ...codingBridge }).inputs!;
  const codingStates = JSON.stringify(Object.fromEntries(
    Object.entries(codingInputs.values).map(([id, v]) => [id, `${v.state}${v.state === 'resolved' ? '' : `/${(v as { detail?: string }).detail ?? ''}`}`]),
  ));
  const contractsValue = codingInputs.values.contracts;
  assert(contractsValue?.state === 'resolved',
    `修订后 coding 的 contracts 输入仍不可解析（W2 这一步当年直接抛 stale）：${codingStates}`);
  const contractsRefs = (contractsValue as { binding?: { source_refs?: string[] } }).binding?.source_refs ?? [];
  assert(contractsRefs.includes(`doc/features/${feature}/contracts.yaml`),
    `contracts 绑定没指向 plan 刚产出的契约文件：${JSON.stringify(contractsRefs)}`);
  assert(
    JSON.stringify((contractsValue as { value?: { files?: string[] } }).value?.files ?? []).includes(REAL_CHAIN_SOURCE),
    `contracts 解析出的内容里没有本轮写集：${JSON.stringify((contractsValue as { value?: unknown }).value).slice(0, 600)}`,
  );
  // W2 的失败形态是 `input binding stale`，逐个输入都不得出现它。（本条是 runless 单变量夹具，
  // 造材料时已删掉 `context/facts.md`——见本条开头；因此不做"任何 invalid 都不许有"的全称断言，
  // 只锁 stale 这一格。）
  const staleInputs = Object.entries(codingInputs.values)
    .filter(([, v]) => v.state === 'invalid' && /stale/.test((v as { detail?: string }).detail ?? ''));
  assert(staleInputs.length === 0, `coding 重解析出现 stale 绑定（W2 的失败形态）：${codingStates}`);

  // ④ 另一半真实行为（见本条头部偏离说明）：**已满足**的验收被 spec 再改时，
  //    重解析不抛异常，而是优雅判 invalid 并指回 scope owner。W2 当年是直接抛。
  const acceptanceAbs = featureFilePath(root, feature, 'acceptance.yaml');
  const acceptance = YAML.parse(fs.readFileSync(acceptanceAbs, 'utf-8')) as { criteria: Array<Record<string, unknown>> };
  acceptance.criteria.push({
    id: 'AC-3', feature: 'F1', description: '空列表展示空态', target: '银行列表', priority: 'P1',
    testable: true, verification_steps: ['打开全部银行页且列表为空'], expected_result: '展示空态提示',
    ut_layer: 'unit', ut_focus: 'AllBanksPage 空态分支',
  });
  fs.writeFileSync(acceptanceAbs, YAML.stringify(acceptance), 'utf-8');
  const specBridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'spec', featuresDir: relFeaturesDir(root) });
  const specInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'spec', track: 'full', ...specBridge }).inputs!;
  const acceptanceValue = specInputs.values.acceptance;
  // 判据核**原因**而不只是 `/stale/` 二字：这条锁的是「指回 scope owner」这条出路
  //（`capability-resolution.ts:666` 的原文），换成别的 stale 文案即归因换了人（codex 阻断 2）。
  assert(
    acceptanceValue?.state === 'invalid'
      && (acceptanceValue as { detail?: string }).detail === 'input binding stale; return to scope owner',
    `改已满足的验收后重解析的结论变了：${JSON.stringify(acceptanceValue)}`,
  );
}));

// ===========================================================================
// RC-3（墙 W3）：UT 改自己负责的测试不作废 coding
// ---------------------------------------------------------------------------
// 构造：真实单元作者经签名请求调用 UT 材料 writer 真写测试；方法检查仍走真实 harness。
// 判据：coding 不被判 stale；产品源码在上游读集里带施工归属，且施工豁免只给归属阶段。
// ===========================================================================

test('RC-3 UT 在链上真写测试：coding 不 stale；上游源码带施工归属且豁免只给 coding', withProject(async (project, birthChain) => {
  const { authorHooks } = await import('./lifecycle-evolution.unit.test');
  let utMaterialWrites = 0;
  const utWrites: Array<{ invokeId: string; preSnapshot: string; preHash: string | null; postHash: string }> = [];
  const hooks = authorHooks(project, {
    spec: writeSpecMaterials, plan: writePlanMaterials, coding: p => writeCodingMaterials(p), review: writeReviewMaterials,
    ut: p => { utMaterialWrites++; writeUtMaterials(p); },
  });
  const probe = await runGoalRuntimeChain(project.root, {
    onOutOfChain: ctx => { assert(publishRequestedVerifier(project, ctx), `unexpected model purpose: ${ctx.phase}`); },
    frameworkRoot: project.frameworkRoot,
    featureId: project.feature,
    realHarness: true,
    adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec',
    freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: REAL_CHAIN_REQUIREMENT,
    onAuthor: (ctx, context) => {
      const start = [...loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'))].reverse()
        .find(event => event.type === 'agent_invoke_start' && event.phase === context.phase);
      assert(typeof start?.invoke_id === 'string', 'UT writer must run inside an actual author invocation');
      const issued = executionRequestForInvoke(context.runDir, String(start!.invoke_id));
      assert(issued?.request.context.phase === 'work-unit-author'
        && issued.request.context.runId === context.runId && issued.request.context.attemptId === context.attemptId
        && issued.request.context.owner.owner_id === context.owner.owner_id
        && issued.request.context.owner.epoch === context.owner.epoch, 'writer must consume the actual signed author request');
      const testAbs = path.join(project.root, REAL_CHAIN_TEST);
      const preHash = fs.existsSync(testAbs) ? sha256File(testAbs) : null;
      const writesBefore = utMaterialWrites;
      hooks.onAuthor(ctx, context);
      const postHash = fs.existsSync(testAbs) ? sha256File(testAbs) : null;
      if (postHash !== preHash) {
        assert(utMaterialWrites > writesBefore && postHash !== null, 'the existing UT writer must really create the test');
        assert(!!issued!.request.write_boundary && !!issued!.request.pre_snapshot, 'actual author request must bind its write boundary and pre-image');
        assert(resolvePhasePathOwnership(issued!.request.write_boundary!, REAL_CHAIN_TEST).owner === 'ut', 'the signed boundary must retain the UT source producer');
        utWrites.push({ invokeId: issued!.request.invoke_id, preSnapshot: issued!.request.pre_snapshot!.sha256, preHash, postHash: postHash! });
      }
    },
  });
  // 当前单元作者可准备多种方法；质量仍由真实方法检查与闭环原件判定。
  const chain = ['spec', 'plan', 'coding', 'review', 'ut'];
  for (const ph of chain) assertCurrentOwnerEvidence(project, ph);

  // 前提：UT 的测试文件确实是在链上写出来的，且 coding 已闭环。
  assert(fs.existsSync(path.join(project.root, REAL_CHAIN_TEST)), 'UT 测试文件未在链上写出');
  assert(readSummary(project, 'coding')?.closure_status === 'closed', 'coding 未闭环，本条证明不了新鲜度');

  // ① 当前 coding 独核实际消费测试强度材料；UT 归属不等于排除真实测试依赖。
  //    两个材料视图都是生产产物，均须精确绑定本轮测试正文。
  const codingMaterial = materialFiles(project, 'coding');
  const utMaterial = materialFiles(project, 'ut');
  const codingTest = codingMaterial.find(file => file.path === REAL_CHAIN_TEST);
  assert(codingTest?.sha256 === sha256File(path.join(project.root, REAL_CHAIN_TEST)),
    'coding independent test-strength material must bind the actual current UT source: ' + JSON.stringify(codingTest));
  assert(
    utMaterial.some(f => f.path === REAL_CHAIN_TEST),
    `UT 测试文件不在 ut 读集里，本条的前提不成立：${JSON.stringify(utMaterial.map(f => f.path))}`,
  );
  // ② 真实作者材料已检查且未再被外部改写时 coding 应 fresh；不把 UT 归属误作依赖豁免。
  const codingBefore = recomputePhaseEvidenceStaleness(project.root, project.feature, ['coding', 'review', 'ut'], { frameworkRoot: project.frameworkRoot })
    .find(r => r.phase === 'coding');
  assert(codingBefore?.verdict === 'fresh', `UT 改测试后 coding 被判 ${codingBefore?.verdict}：${JSON.stringify(codingBefore)}`);
  const creation = utWrites.find(write => write.preHash === null);
  assert(!!creation, 'the test must be created by a real signed author invocation, not pre-seeded by the fixture');
  const observedIndex = probe.events.findIndex(event => event.type === 'phase_write_observed'
    && event.phase === 'work-unit-author' && event.invoke_id === creation!.invokeId && event.pre_snapshot === creation!.preSnapshot
    && ((event.owned ?? []) as Array<{ path?: string; owner?: string; pre_sha256?: string | null; post_sha256?: string }>).some(write =>
      write.path === REAL_CHAIN_TEST && write.owner === 'ut' && write.pre_sha256 === null && write.post_sha256 === creation!.postHash));
  assert(observedIndex >= 0, 'the runtime must persist the actual UT-owned creation and its pre/post hashes');
  for (const phase of ['coding', 'ut']) assert(probe.events.some((event, index) => index > observedIndex
    && event.type === 'harness_end' && event.phase === phase && typeof event.exit_code === 'number' && event.timed_out !== true),
    phase + ' must really return its method check after the observed write; current closure is checked independently');

  // ③ W3 的正向验收（codex 2026-09-22 裁定后重写；原先那条「改源码仍 fresh」的 known-bug
  //    反向哨兵锁的是**已被推翻**的命题，已删）。三步，都在 1.2 链上：
  //    (a) **plan** 的 manifest 确实登记了产品源码，且条目带 `owner_phase='coding'`
  //        ——归属由 goal 闭环透传 factsContext 得出（plan b5c1e9d7 缺口 A，e128e07f 修；
  //        在那之前 spec/plan manifest 的源码条目 `owner_phase` 全是 undefined）；
  //    (b) 施工豁免：源码变化时，**归属阶段正在跑**（pendingOwnerPhase='coding'）plan 不算漂移
  //        ——`phase-evidence-manifest.ts:866`。这正是 coding 能改 plan 读集里源码的那条出路；
  //    (c) 反面：同一份变化换成 review/ut 在跑（pendingOwnerPhase='ut'）时 plan **仍 stale**
  //        ——豁免只给归属阶段，不是给所有人。(b)/(c) 唯一变量是 pendingOwnerPhase。
  const planManifest = loadPhaseEvidenceManifest(project.root, project.feature, 'plan');
  const sourceEntry = (planManifest?.manifest.inputs ?? []).find(e => e.path === REAL_CHAIN_SOURCE);
  assert(sourceEntry, `plan manifest 未登记产品源码：${JSON.stringify((planManifest?.manifest.inputs ?? []).map(e => e.path))}`);
  assert(sourceEntry!.owner_phase === 'coding',
    `plan manifest 的源码条目没有施工归属（b5c1e9d7 缺口 A 复发）：${JSON.stringify(sourceEntry)}`);

  const sourceAbs = path.join(project.root, REAL_CHAIN_SOURCE);
  fs.writeFileSync(sourceAbs, `${fs.readFileSync(sourceAbs, 'utf-8')}\n// W3 probe\n`, 'utf-8');
  const planVerdict = (pendingOwnerPhase: string): string | undefined =>
    recomputePhaseEvidenceStaleness(project.root, project.feature, ['plan'], { frameworkRoot: project.frameworkRoot, pendingOwnerPhase })
      .find(r => r.phase === 'plan')?.verdict;
  assert(planVerdict('coding') === 'fresh',
    `源码变化时 coding 正在施工却仍判 plan 漂移（施工豁免失效）：${JSON.stringify(planVerdict('coding'))}`);
  assert(planVerdict('ut') === 'stale',
    `源码变化时 ut 在跑也拿到了施工豁免（豁免泄漏给非归属阶段）：${JSON.stringify(planVerdict('ut'))}`);
}));

// ===========================================================================
// RC-4（墙 W4）：同一产物连跑两次，verifier subject 稳定
// ---------------------------------------------------------------------------
// 构造两段，各自单变量：
//   (甲) 真实作者材料闭环后，只改正式消费的 mock-plan 业务 preset，再跑真实 gate → 反洗白，必须换代；
//   (乙) 链后：**材料字节一个都不动**，只换 `MAISON_TEST_AC_COVERAGE_NOW`，把**真实 gate
//        harness** 再跑两轮（与 `goal-phase-runtime.ts:1272` 同一条命令与同一组注入键）
//        → W4 的墙：两轮落盘的 `verifier.request.*.json` 的 subject_id 必须逐字相同，
//        整份逐字段对账里**唯一**允许不等的是审计字段 `prompt_sha256`（按设计不进 subject）。
// 原 Goal 与重放入口的材料差异另记；时钟和业务断言只比较同一重放入口的受控轮次。
// ===========================================================================

const RC4_CLOCKS = ['2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z', '2026-03-03T00:00:00.000Z'];

/**
 * 甲乙两段**共用的同一个**设备环境对象。取值与 `goal-runner-testing-integrity.unit.test.ts:497`
 * 的默认就绪门桩逐字相同（本条只是把它显式化好让乙段拿到同一份，不改任何行为）。
 * 为什么必须共用：父进程 profile 回落 hmos-app（`profile-loader.ts:195`）后 `ut.run` 属设备能力，
 * 就绪门会冻结 HDC 目标，生产在 `goal-phase-runtime.ts:8244` 把它传给 gate harness；
 * 乙段若不带，跑的就是与甲段不同的环境（codex 2026-09-22 三轮）。
 * `probe.harnessDeviceEnvs` 取不到——那是**注入桩**的记录，`realHarness` 下不装桩
 * （`goal-runner-testing-integrity.unit.test.ts:538`），故改从就绪门注入点共享。
 */
const RC4_DEVICE_ENV: Record<string, string> = {
  HARNESS_HDC_TARGET: 'fake-device',
  MAISON_DEVICE_TARGET_KIND: 'physical',
};

test('RC-4 verifier subject：时钟漂移不换代，业务内容变化必须换代', withProject(async (project, birthChain) => {
  const prevClock = process.env.MAISON_TEST_AC_COVERAGE_NOW;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  /** Record actual UT material writer actions, independently of native actor labels. */
  const subjectBefore: Array<string | undefined> = [];
  let utMaterialWrites = 0;
  const businessAbs = featureFilePath(project.root, project.feature, 'ut/mock-plan.yaml');
  const businessRel = path.relative(project.root, businessAbs).replace(/\\/g, '/');
  const bindingsByMaterialHash = new Map<string, { digest: string; values: Record<string, ResolvedInput> }>();
  const bindingProjection = (values: Record<string, ResolvedInput>): unknown => Object.entries(values)
    .map(([id, value]) => [id, value.state === 'resolved' ? value.binding : value]);
  const captureBindings = (runId: string, goalAttemptId: string): void => {
    const entry = resolveCapabilityResolutionEntryInput({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
      feature: project.feature, phase: 'ut', featuresDir: relFeaturesDir(project.root), goalRunId: runId, goalAttemptId });
    const inputs = resolveCapabilityInputs({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
      feature: project.feature, phase: 'ut', track: 'full', ...entry }).inputs;
    assert(!!inputs, 'RC-4 必须核对实际阶段输入绑定');
    const projected = buildVerifierMaterialView({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
      phase: 'ut', runId, factsContext: entry.factsContext, resolvedInputs: inputs!, gateFingerprint: null,
      phaseRuleText: '', templateText: '', checks: [], contextFiles: [] });
    assert(!!projected.input_bindings_sha256, 'actual resolved inputs must have the production material binding digest');
    bindingsByMaterialHash.set(sha256File(businessAbs)!,
      { digest: projected.input_bindings_sha256!, values: structuredClone(inputs!.values) });
  };
  /** 就绪门实际被调用的阶段（本条自备——显式 deviceGate 覆盖后 probe 的那份不再记录）。 */
  const gatedPhases: string[] = [];
  const usedClocks = new Set<string>();
  try {
    const { authorHooks } = await import('./lifecycle-evolution.unit.test');
    const hooks = authorHooks(project, {
      spec: writeSpecMaterials, plan: writePlanMaterials, coding: p => writeCodingMaterials(p), review: writeReviewMaterials,
      ut: p => {
        subjectBefore.push(readSummary(p, 'ut')?.verifier_subject_id);
        utMaterialWrites++;
        process.env.MAISON_TEST_AC_COVERAGE_NOW = RC4_CLOCKS[0];
        usedClocks.add(RC4_CLOCKS[0]);
        writeUtMaterials(p);
      },
    });
    const probe = await runGoalRuntimeChain(project.root, {
      ...hooks,
      onOutOfChain: ctx => { assert(publishRequestedVerifier(project, ctx), `unexpected model purpose: ${ctx.phase}`); },
      frameworkRoot: project.frameworkRoot,
      featureId: project.feature,
      realHarness: true,
      adapter: 'codex',
      // Replay only a target actually selected for UT; a unit-only method gains no synthetic device env.
      deviceGate: (gateOpts: { phase: string }) => {
        gatedPhases.push(String(gateOpts.phase));
        return {
          env: RC4_DEVICE_ENV,
          target: { serial: 'fake-device', targetKind: 'physical' as const },
          notes: ['test seam'],
        };
      },
      freshStartPhase: birthChain[0] as 'spec',
      freshEndPhase: birthChain[birthChain.length - 1],
      freshRequirement: REAL_CHAIN_REQUIREMENT,
    });
    // Freeze the actual writer count after the real chain; later gates must not buy author rewrites.
    const utWritesAfterChain = utMaterialWrites;
    const utReplayDeviceEnv = gatedPhases.includes('ut') ? RC4_DEVICE_ENV : {};
    assert(utWritesAfterChain > 0, 'the real author must have produced UT materials');
    const original = assertCurrentPhaseClosed(project, 'ut');
    const utReportsDir = featurePhaseReportsDir(project.root, project.feature, 'ut', project.frameworkRoot);
    const utAttemptId = phaseAttemptIdFromReceipt(project, 'ut');
    const originalEvidence = loadVerifierEvidence(project.root, project.feature, 'ut', { frameworkRoot: project.frameworkRoot });
    if (!originalEvidence.ok) throw new Error('初始真实闭环必须有原 subject 的有效核实');
    const originalVerifierBytes = fs.readFileSync(originalEvidence.evidence.md_path_abs);
    const testAbs = path.join(project.root, REAL_CHAIN_TEST);
    const originalTest = fs.readFileSync(testAbs, 'utf8');
    const originalBusiness = fs.readFileSync(businessAbs, 'utf8');
    // Same-entry clock-only reference precedes the one business change.
    // ④ **W4 的墙本身**：先保业务正文不变，只改变两次真实重放的时钟。
    //    材料字节一个都不动，只换时钟，把真实 gate harness 再跑两轮——整条 subject 派生链
    //    （输入解析 → 材料视图 → material_sha256 → request）都由生产代码重走一遍。
    //    判据：两轮落盘的 request 整份逐字段对账、**唯一允许差异 `prompt_sha256`**，
    //    不是只比挑出来的几个字段，也不是拿确定性函数自我印证。
    // Reuse UT's actual target if selected; otherwise preserve the absence of added device variables.
    const clockRound = (clock: string): { subject: string; request: VerifierRequest; material: MaterialView } => {
      // 每轮先清掉旧凭证：轮末只要"该 subject 的 request 在盘上"即证明是本轮写的，
      // 不依赖时钟/文件系统 mtime 精度（codex 2026-09-22 三轮建议）。
      for (const fn of fs.readdirSync(utReportsDir).filter(x => /^verifier\.request\..*\.json$/.test(x))) {
        fs.rmSync(path.join(utReportsDir, fn), { force: true });
      }
      const r = runGateHarness(project, 'ut', clock, utAttemptId, utReplayDeviceEnv);
      usedClocks.add(clock);
      // 且必须真的**走了 goal 分支**：注入键名写错时子进程会静默落 interactive/manual
      //（`harness-runner.ts:1589` 据 `isGoalOrchestrationEnv()` 渲染 `mode=goal_mode|manual`），
      // 门禁照跑、断言照过，测的却不是生产路径。这一条就是那个错的哨兵。
      assert(/\bmode=goal_mode\b/.test(r.output),
        `重跑的 gate harness 没走 goal 分支（注入键名/常量对不上）：${r.output.slice(-2000)}`);
      const subject = readSummary(project, 'ut')?.verifier_subject_id;
      const expectedExit = subject === original.verifier_subject_id ? 0 : 1;
      assert(r.status === expectedExit, `same-entry replay must retain its actual current independent-proof state (exit=${r.status}, expected=${expectedExit}): ${r.output.slice(-2000)}`);
      assert(subject && /^[0-9a-f]{64}$/.test(subject),
        `只换时钟重跑 gate harness 后 summary 无合法 subject：${r.output.slice(-1500)}`);
      // 且必须是**本轮**落的盘：进轮前整片删过，凭证写入是无条件 `writeFileSync`
      //（harness-runner.ts:2524），文件重新出现即证明本轮真写了，没写就无从冒充。
      const abs = path.join(utReportsDir, `verifier.request.${subject}.json`);
      assert(fs.existsSync(abs), `本轮没有重新落盘 request（进轮前已清空该目录的凭证）：${abs}`);
      const currentMaterial = JSON.parse(fs.readFileSync(path.join(utReportsDir, `verifier.material.${subject}.json`), 'utf8')) as MaterialView;
      return { subject: subject!, request: verifierRequestOf(project, 'ut', subject!), material: currentMaterial };
    };
    const testBeforeClockRounds = fs.readFileSync(testAbs);
    const clockX = clockRound(RC4_CLOCKS[1]);
    const clockY = clockRound(RC4_CLOCKS[2]);
    assert(utMaterialWrites === utWritesAfterChain, 'clock-only gates must not call the UT material writer');
    assert(fs.readFileSync(testAbs).equals(testBeforeClockRounds), 'clock-only gates must not rewrite the actual UT test');
    assert(fs.readFileSync(testAbs, 'utf8') === originalTest && fs.readFileSync(businessAbs, 'utf8') === originalBusiness,
      'clock-only gates must preserve the original source and original business material');
    assert(clockX.subject === clockY.subject,
      `材料不变、只换时钟，subject 却换代了：${clockX.subject.slice(0, 12)} vs ${clockY.subject.slice(0, 12)}；same replay entry`);
    assert(stableStringify(clockX.material) === stableStringify(clockY.material), 'pure clock-only rounds must preserve the entire actual material, including every script check');
    //    整份逐字段对账，**唯一允许差异 `prompt_sha256`**：ai-prompt.md 每轮带运行时间戳，
    //    它按设计只作审计记录、不进 subject 派生——依据三处：文件头裁决
    //    （verifier-request.ts:22-23）、字段注释（:41）、派生串本身不含该字段
    //    （`canonicalRequestInput`，:65-79）。实测两轮正是它漂移（其余含 material_sha256 /
    //    gate_fingerprint / source_commit_sha / worktree_digest 全部逐字相同）——
    //    这条同时证明了「时间确实在动」，本轮对照不是空转；漂移的那一格没有到达 subject。
    const xr = clockX.request as unknown as Record<string, unknown>;
    const yr = clockY.request as unknown as Record<string, unknown>;
    const diffKeys = [...new Set([...Object.keys(xr), ...Object.keys(yr)])]
      .filter(k => JSON.stringify(xr[k]) !== JSON.stringify(yr[k]))
      .sort();
    assert(
      JSON.stringify(diffKeys) === JSON.stringify(['prompt_sha256']),
      `材料不变、只换时钟，request 的差异不止审计字段：${JSON.stringify(diffKeys)}\n`
      + `${JSON.stringify(clockX.request)}\n${JSON.stringify(clockY.request)}`,
    );
    //    两份凭证各自用**生产派生函数**重算，都落回同一个 subject（漂移的审计字段不参与）。
    assert(
      computeRequestSubjectId(clockX.request) === clockX.subject
      && computeRequestSubjectId(clockY.request) === clockX.subject,
      `两份凭证的 subject 与生产派生不一致：${JSON.stringify([computeRequestSubjectId(clockX.request), computeRequestSubjectId(clockY.request), clockX.subject])}`,
    );
    const goalMaterial = materialGenerations(project, 'ut').find(generation => generation.subject === original.verifier_subject_id);
    assert(goalMaterial, 'the actual initial closed material must remain available');
    const oldFiles = new Map(goalMaterial!.view.files.map(file => [file.path, file.sha256]));
    console.log('RC4_ENTRY_BASELINE ' + JSON.stringify({goalSubject: original.verifier_subject_id, replaySubject: clockY.subject,
      added: clockY.material.files.filter(file => !oldFiles.has(file.path)),
      changed: clockY.material.files.filter(file => oldFiles.has(file.path) && oldFiles.get(file.path) !== file.sha256),
      removed: goalMaterial!.view.files.filter(file => !clockY.material.files.some(current => current.path === file.path))}));
    captureBindings(project.runId!, utAttemptId);
    // Only this method's consumed business preset now changes, under the same replay entry and clock as clockY.
    assert(originalBusiness.includes('[] as string[]'), 'RC-4 business change must target the actual typed mock preset');
    fs.writeFileSync(businessAbs, originalBusiness.replace('[] as string[]', "['cmb'] as string[]"), 'utf8');
    captureBindings(project.runId!, utAttemptId);
    const businessRound = runGateHarness(project, 'ut', RC4_CLOCKS[2], utAttemptId, utReplayDeviceEnv);
    assert(businessRound.status === 1, `新业务 subject 必须等待当前独核，真实 gate 不得借旧 PASS 返回成功：${businessRound.output.slice(-2400)}`);
    assert(/\bmode=goal_mode\b/.test(businessRound.output), '业务扰动重评必须仍走原 Goal 身份路径');
    usedClocks.add(RC4_CLOCKS[2]);
    const final = readSummary(project, 'ut');
    const s3 = final!.verifier_subject_id ?? '';
    assert(/^[0-9a-f]{64}$/.test(s3), `ut summary 的 verifier_subject_id 形态非法：${s3}`);
    assert(s3 !== clockY.subject && s3 !== original!.verifier_subject_id, '真实业务变化必须签发新 subject，不能复用任一旧核实');
    const changedEvidence = loadVerifierEvidence(project.root, project.feature, 'ut', { frameworkRoot: project.frameworkRoot });
    const pending = resolveCompletionDisposition({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
      feature: project.feature, chain: ['ut'], runId: project.runId });
    assert(!changedEvidence.ok && pending.completionBlocking.length > 0, '旧核实不得闭合新业务材料；本例不宣称新断言已真机通过');
    assert(fs.readFileSync(originalEvidence.evidence.md_path_abs).equals(originalVerifierBytes), '初始核实原件必须保留');

    // 前提①：被改动的业务正文在 subject 材料里——否则"内容变化必须换代"
    // 是空转。材料视图由生产 writer 落盘。
    const materialAbs = path.join(utReportsDir, `verifier.material.${s3}.json`);
    assert(fs.existsSync(materialAbs), `verifier 材料视图未落盘：${materialAbs}`);
    const material = JSON.parse(fs.readFileSync(materialAbs, 'utf-8')) as { files: Array<{ path: string }> };
    assert(
      material.files.some(f => f.path === businessRel) && material.files.some(f => f.path === REAL_CHAIN_TEST),
      `actual UT business/test material is missing: ${JSON.stringify(material.files.map(f => f.path))}`,
    );

    // 前提②：`ac-coverage.json` **在** subject 材料里，这是**契约不是缺陷**
    //（codex 2026-09-22 裁定，撤回本条早先那句"进材料即 W4 复发"）：
    // `createRuntimeArtifactPredicate` 只作用在 `buildVerifierMaterialView` 的 manifest 那一路
    //（verifier-material.ts:129），显式经 `contextFiles` 送进来的运行期证据不受 `reports/`
    // 排除规则限制（`:145-148` 原文：那是 verifier 的实际读取面）。因此"时钟不换代"不靠
    // 把它挡在材料外，而靠它的内容本身对时钟稳定——即下面的前提③。
    assert(
      material.files.some(f => /\/ut\/reports\/ac-coverage\.json$/.test(f.path)),
      `ac-coverage.json 不在 subject 材料里，前提③锁的那一格失去对象：${JSON.stringify(material.files.map(f => f.path))}`,
    );
    // 前提③：时钟不换代的**真防线**——`writeAcCoverageReport` 在语义未变时沿用旧 generated_at
    //（ac-coverage-report.ts:143-147）。三轮各给一个不同时钟，盘上必须还是第一轮那个。
    const acCoverage = JSON.parse(fs.readFileSync(path.join(utReportsDir, 'ac-coverage.json'), 'utf-8')) as { generated_at?: string };
    assert(
      acCoverage.generated_at === RC4_CLOCKS[0],
      `ac-coverage.json 的 generated_at 随时钟漂移了：${acCoverage.generated_at}（应沿用首轮 ${RC4_CLOCKS[0]}）`,
    );

    // 判据面取**材料代数**而不是 agent 轮次：每换一代 subject，生产就多落一份
    // `verifier.material.<subject>.json`。harness 实际跑了几轮由 events 的 harness_start 数。
    const harnessRounds = probe.events.filter(e => e.type === 'harness_start' && e.phase === 'ut').length;
    const generations = materialGenerations(project, 'ut');
    const shaOf = (g: { view: MaterialView }): string | null =>
      g.view.files.find(f => f.path === businessRel)?.sha256 ?? null;
    const dump = JSON.stringify({
      harnessRounds: harnessRounds + 3, utMaterialWrites, clocksUsed: usedClocks.size,
      generations: generations.map(g => ({ subject: g.subject.slice(0, 12), businessSha: (shaOf(g) ?? '(none)').slice(0, 12) })),
      subjectBefore, finalSubject: s3.slice(0, 12),
    });

    // 原链与外部业务扰动都经过真实 gate；时钟注入不依赖重复作者。
    assert(harnessRounds >= 1, `原链必须真实检查 UT；新业务 gate 另已实际返回并等待独核：${dump}`);
    assert(utMaterialWrites === utWritesAfterChain, `业务 gate 对照不得重新运行作者材料 writer：${dump}`);
    assert(usedClocks.size >= 2, `实际 gate 必须收到两个不同时钟：${dump}`);

    // ① 反洗白：从稳定重放基线再只改 mock preset，真实业务材料必须换代。
    //（两代材料记录的该文件 sha 不同，末代与盘上字节一致）。
    assert(generations.length >= 2, `业务内容变化后 subject 未换代：${dump}`);
    assert(shaOf(generations.find(g => g.subject === s3)!) === sha256File(businessAbs),
      `最终 subject 的材料没对上盘上的业务正文：${dump}`);

    // ② 同一入口、同一时钟的业务对照：除了 preset 正文，实际材料逐文件必须相同。
    const genA = generations.find(g => g.subject === clockY.subject);
    const genB = generations.find(g => g.subject === s3);
    if (!genA || !genB || genA === genB) throw new Error(`必须按稳定重放基线与业务改动的新 subject 逐份对账：${dump}`);
    assert(shaOf(genA) !== shaOf(genB), `the two controlled real generations must differ in the actual preset body: ${dump}`);
    const preliminary = generations.filter(g => g !== genA && g !== genB);
    assert(preliminary.every(g => shaOf(g) === shaOf(genA)
      || (!shaOf(g) && subjectBefore.includes(g.subject))),
      `其它代只能是原 Goal 同业务正文的核验/闭合代或实际作者产物前代，不能忽略任意业务换代：${dump}`);
    assert(
      JSON.stringify(genA.view.files.map(f => f.path)) === JSON.stringify(genB.view.files.map(f => f.path)),
      `两代材料的文件集合不同，无法单变量对账：${dump}`,
    );
    const drifted = genA.view.files
      .filter((f, i) => f.sha256 !== genB.view.files[i].sha256)
      .map(f => f.path);
    assert(
      JSON.stringify(drifted) === JSON.stringify([businessRel]),
      `除真实业务正文外还有文件换 sha：${JSON.stringify(drifted)}；${dump}`,
    );
    // The current UT contract binds semantic code/acceptance/design inputs. Actual test body bytes
    // are separately addressed by material files, so an undeclared test_targets binding cannot be invented.
    const capturedA = bindingsByMaterialHash.get(shaOf(genA)!);
    const capturedB = bindingsByMaterialHash.get(shaOf(genB)!);
    assert(capturedA && capturedB && capturedA.digest === genA.view.input_bindings_sha256
      && capturedB.digest === genB.view.input_bindings_sha256,
    'both material originals must match their actual inputs via the current production projection');
    const inputsA = capturedA!.values, inputsB = capturedB!.values;
    assert(JSON.stringify(Object.keys(inputsA)) === JSON.stringify(Object.keys(inputsB)), 'input identities must not change with this body-only edit');
    for (const id of Object.keys(inputsA)) assert(stableStringify(bindingProjection({ [id]: inputsA[id] }))
      === stableStringify(bindingProjection({ [id]: inputsB[id] })), id + ' actual semantic input binding must remain unchanged');
    assert(genA.view.input_bindings_sha256 === genB.view.input_bindings_sha256,
      'actual stable semantic bindings must remain stable while the separately addressed test body changes');
    const beforeChecks = genA.view.script_checks.filter(check => !genB.view.script_checks.includes(check));
    const afterChecks = genB.view.script_checks.filter(check => !genA.view.script_checks.includes(check));
    assert(beforeChecks.length === 0 && afterChecks.length === 0,
      'same-entry preset-only change must preserve every actual script check: ' + JSON.stringify({beforeChecks, afterChecks}));
    for (const key of ['schema', 'gate_fingerprint', 'phase_rule_sha256',
      'template_sha256', 'lifecycle_sha256', 'extension_sha256'] as const) {
      assert(
        JSON.stringify(genA.view[key]) === JSON.stringify(genB.view[key]),
        `两代材料的 ${key} 随时钟变了：${JSON.stringify([genA.view[key], genB.view[key]])}`,
      );
    }

    // ③ 换代确实由**材料**驱动，且盘上凭证与生产派生自洽
    //    （subject = sha256(schema, feature, phase, prompt_path, material_sha256, gate_fingerprint)，
    //    `canonicalRequestInput`，verifier-request.ts:65-79）。
    const reqA = verifierRequestOf(project, 'ut', genA.subject);
    const reqB = verifierRequestOf(project, 'ut', genB.subject);
    assert(computeRequestSubjectId(reqB) === reqB.subject_id,
      `request 的 subject 与生产派生不符（凭证被改过）：${reqB.subject_id}`);
    assert(reqA.material_sha256 !== reqB.material_sha256, `两代 request 的 material_sha256 相同，换代与材料无关：${dump}`);
    assert(computeMaterialSha256(genA.view) === reqA.material_sha256 && computeMaterialSha256(genB.view) === reqB.material_sha256,
      'both real requests must bind their real material originals');
    // This in-memory causal control is never written or signed and is not a third gate observation.
    const sameInputsOldBody = { ...genB.view, files: genB.view.files.map(file => file.path === businessRel ? { ...file, sha256: shaOf(genA)! } : file) };
    const withoutSelfDigest = (view: MaterialView): unknown => Object.fromEntries(Object.entries(view).filter(([key]) => key !== 'material_sha256'));
    assert(stableStringify(withoutSelfDigest(genA.view)) === stableStringify(withoutSelfDigest(sameInputsOldBody)),
      'the two real same-entry materials must differ only in the actual business body and its derived digest');
    const oldBodyDigest = computeMaterialSha256(sameInputsOldBody);
    assert(oldBodyDigest === reqA.material_sha256, 'restoring only the real old body hash must restore the actual baseline material digest');
    assert(oldBodyDigest !== reqB.material_sha256 && computeRequestSubjectId({ ...reqB, material_sha256: oldBodyDigest }) !== reqB.subject_id,
      'holding the other actual new-material fields constant, the real business body alone must change the derived subject');
    const actualTestSha = genA.view.files.find(file => file.path === REAL_CHAIN_TEST)?.sha256;
    assert(actualTestSha && actualTestSha === sha256File(testAbs), 'the unchanged real test body must remain bound to the actual material');
    assert(originalTest.includes('expect(banks.length).assertEqual(0);'), 'the in-memory test-body control must target a real business assertion');
    const changedTestSha = crypto.createHash('sha256').update(originalTest.replace('expect(banks.length).assertEqual(0);',
      "expect(banks.length).assertEqual(0);\n    expect(typeof banks).assertEqual('object');")).digest('hex');
    const testBodyOnly = { ...genA.view, files: genA.view.files.map(file => file.path === REAL_CHAIN_TEST
      ? { ...file, sha256: changedTestSha } : file) };
    assert(computeRequestSubjectId({ ...reqA, material_sha256: computeMaterialSha256(testBodyOnly) }) !== reqA.subject_id,
      'an in-memory test-source-only change must also affect the subject; it is never written, signed or claimed as a real gate');

  } finally {
    if (prevClock === undefined) delete process.env.MAISON_TEST_AC_COVERAGE_NOW;
    else process.env.MAISON_TEST_AC_COVERAGE_NOW = prevClock;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
}));

// ===========================================================================
// RC-8（墙 W7b）：同签名无进展停机
// ---------------------------------------------------------------------------
// 在真 harness 链上制造同签名重复失败，两个分支各跑一条独立的链：
//   (a) 相关文件真换字节但安全约束未映射；(b) 相关字节不变、只换无关工作笔记。
// 两者均须在真实反馈/交回及当前有效检查后有界 no-progress 暂停，不把改字节当验收改善。
//
// **失败点为什么在 plan 而不是 spec**（codex 2026-09-22 裁定，撤回本条早先的 spec.md 构造）：
// 1.2 的范围里 spec 的 required_outputs **不含 `spec.md`**，于是 `check-spec.ts:1484` 走
// 早退分支——`checkTerminologyMappingTable` 那一整组以 spec.md 为载体的检查**根本不执行**。
// 早先"删掉术语映射表整章"因此是空动作：实跑里 spec 照常 PASS，真正停机的是随后**没有
// 契约**的 plan。也就是说 (a) 报的"生产误熔断"与 (b) 的"通过"都不是它们各自声称的东西。
// 改法：把失败点显式落在 1.2 下**真会执行**的那格，并先证明它确实到达了失败结果（见
// `assertPlanFailedOnRc8Target`），再做单变量对照。**不动生产熔断。**
//
// 越根引用属于不可解析输入，正确进入 executor_waiting。此处用可解析但未追溯的安全约束；
// traversal 的拒绝反例由 contract-reference-closure 套件保留，不修改熔断与输入准入规则。
// ===========================================================================

/** plan 期确定性业务失败点；相关 contracts 由真实当前输入绑定核对。 */
const RC8_CHECK_ID = 'spec_constraint_traceability';
/** 可解析验收中的安全约束。 */
const RC8_CONSTRAINT_ID = 'AC-8';

function rc8ContractsRel(p: RealChainProject): string {
  return `doc/features/${p.feature}/contracts.yaml`;
}

/** 写齐原 plan 材料但不补安全约束映射；marker 只换相关字节，不修实际问题。 */
function writePlanWithUnmappedConstraint(p: RealChainProject, marker?: string): void {
  writePlanMaterials(p);
  const abs = path.join(p.root, rc8ContractsRel(p));
  const body = fs.readFileSync(abs, 'utf-8').replace(/\s*$/, '\n');
  fs.writeFileSync(abs, body + (marker ? `# ${marker}\n` : ''), 'utf-8');
}

/** 两条共用：无关文件每轮都变（把"无关变化"这一项在 (a)/(b) 之间拉平）。 */
function writeUnrelatedNote(p: RealChainProject, attempt: number): void {
  writeHostFile(p.root, path.relative(p.root, featureFilePath(p.root, p.feature, 'plan/notes.md')), `# notes\n\nattempt ${attempt}\n`);
}

/**
 * 先证明失败触发到了预期契约：plan 因 `RC8_CHECK_ID` 失败，且**相关文件集合**里确实有
 * contracts.yaml；当前可复用的真实工具结果也必须保留这一 FAIL，不能只读旧盘上标签。
 * 这一格不成立时，
 * (a)/(b) 的结论各自都无从谈起。
 */
function assertPlanFailedOnRc8Target(p: RealChainProject): void {
  const plan = readSummary(p, 'plan');
  assert(plan?.verdict === 'FAIL', 'plan must retain its real current failure: ' + dumpPhase(p, 'plan'));
  const current = readReusableCheckResult({ projectRoot: p.root, frameworkRoot: p.frameworkRoot, feature: p.feature, runId: p.runId, phase: 'plan' });
  assert(current?.checks.some(check => check.id === RC8_CHECK_ID && check.status === 'FAIL' && check.details?.includes(RC8_CONSTRAINT_ID)), 'the current bound plan result must retain its actual unmapped constraint');
  const observation = readCurrentCheckObservation({ projectRoot: p.root, frameworkRoot: p.frameworkRoot, feature: p.feature, runId: p.runId!, phase: 'plan' });
  assert(observation.inputs[rc8ContractsRel(p)]?.exists, 'the actual plan comparison must bind the related contracts input');
}

interface Rc8WriterObservation {
  invokeId: string;
  instruction: string;
  preContractHash: string | null;
  contractHash: string;
  noteHash: string;
}

/** Same comparable business failure; only related-file byte changes differ between the two cases. */
async function runRc8NoProgress(project: RealChainProject, birthChain: string[], relatedChange: boolean): Promise<void> {
  const { authorHooks } = await import('./lifecycle-evolution.unit.test');
  const { executionRequestForInvoke } = await import('../../scripts/utils/session-execution-handoff');
  const { workUnitMayWritePath } = await import('../../scripts/utils/repair-responsibility');
  // A valid existing acceptance input leaves the plan method independently comparable.
  writeSpecMaterials(project);
  const uiFile = featureFilePath(project.root, project.feature, 'spec/ui-spec.yaml');
  const ui = YAML.parse(fs.readFileSync(uiFile, 'utf8'));
  delete ui.feature;
  ui.tokens = { gap: { kind: 'spacing', value: '16vp' } };
  ui.screens[0].root.children[0].type = 'list_row';
  ui.screens[1].root.children[0].type = 'content_display';
  fs.writeFileSync(uiFile, YAML.stringify(ui));
  const acceptanceFile = featureFilePath(project.root, project.feature, 'acceptance.yaml');
  const acceptance = YAML.parse(fs.readFileSync(acceptanceFile, 'utf8'));
  acceptance.criteria.push({ ...acceptance.criteria[1], id: RC8_CONSTRAINT_ID, category: 'security', description: '列表不得泄漏未授权数据，设计必须追溯此安全约束' });
  fs.writeFileSync(acceptanceFile, YAML.stringify(acceptance));
  // The negative concerns the plan's mapping, not a missing definition input.
  writePlanMaterials(project);
  fs.rmSync(featureFilePath(project.root, project.feature, 'context/facts.md'), { force: true });
  const prepared = prepareFeatureScopeCandidate({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, completionTarget: 'request',
    requestedResults: ['给定验收下的设计契约'], requestedPhases: ['plan'], requirement: REAL_CHAIN_REQUIREMENT, overwrite: true });
  // Request a real plan recheck: existing design bytes are its input, not a claim this new duty is already done.
  const declaration = YAML.parse(fs.readFileSync(prepared.path, 'utf8'));
  for (const fact of prepared.candidate.facts) if (fact.kind === 'design-context') delete fact.satisfied_by;
  declaration.execution_scope = prepared.candidate;
  fs.writeFileSync(prepared.path, YAML.stringify(declaration));
  const writes: Rc8WriterObservation[] = [];
  let planMaterialWrites = 0;
  const contractsRel = rc8ContractsRel(project), contractsAbs = path.join(project.root, contractsRel);
  const noteAbs = featureFilePath(project.root, project.feature, 'plan/notes.md');
  const hooks = authorHooks(project, {
    plan: p => {
      planMaterialWrites++;
      writePlanWithUnmappedConstraint(p, relatedChange ? 'plan material write ' + planMaterialWrites : undefined);
      writeUnrelatedNote(p, planMaterialWrites);
      const factsFile = featureFilePath(p.root, p.feature, 'context/facts.md');
      const { parseContextExploration } = require('../../scripts/utils/context-exploration') as typeof import('../../scripts/utils/context-exploration');
      const facts = parseContextExploration(fs.readFileSync(factsFile, 'utf8'));
      assert(!facts.error, 'the plan researcher must keep parseable actual facts');
      const sources = [...new Set([...(facts.fm.source_code_paths as string[]), ...['spec/spec.md', 'spec/ui-spec.yaml',
        'acceptance.yaml', 'contracts.yaml', 'plan/plan.md'].map(relative => path.relative(p.root, featureFilePath(p.root, p.feature, relative)).replace(/\\/g, '/'))])];
      // Inspect the actual implementation and the five definition inputs; no dummy files pad research.
      for (const source of sources) fs.readFileSync(path.join(p.root, source), 'utf8').indexOf('\n');
      for (const source of facts.fm.key_inputs_read as string[]) fs.readFileSync(path.join(p.root, source), 'utf8');
      fs.writeFileSync(factsFile, '---\n' + YAML.stringify({ ...facts.fm, source_code_paths: sources,
        files_inspected_count: sources.length + (facts.fm.key_inputs_read as string[]).length,
        searches_performed_estimate: sources.length }) + '---\n' + facts.body);
    },
  });
  const probe = await runGoalRuntimeChain(project.root, {
    onOutOfChain: ctx => { assert(publishRequestedVerifier(project, ctx), 'unexpected model purpose: ' + ctx.phase); },
    frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, adapter: 'codex',
    freshStartPhase: 'plan', freshEndPhase: 'plan', freshRequirement: REAL_CHAIN_REQUIREMENT,
    onAuthor: (ctx, context) => {
      const preContractHash = fs.existsSync(contractsAbs) ? sha256File(contractsAbs) : null;
      const countBefore = planMaterialWrites;
      hooks.onAuthor(ctx, context);
      if (planMaterialWrites === countBefore) return;
      const start = [...loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'))].reverse()
        .find(event => event.type === 'agent_invoke_start' && event.phase === context.phase);
      assert(typeof start?.invoke_id === 'string', 'the plan writer needs its actual author start');
      const issued = executionRequestForInvoke(context.runDir, String(start!.invoke_id));
      assert(issued?.request.context.phase === 'work-unit-author'
        && issued.request.context.runId === context.runId && issued.request.context.attemptId === context.attemptId
        && issued.request.context.owner.owner_id === context.owner.owner_id
        && issued.request.context.owner.epoch === context.owner.epoch, 'the writer must consume the actual signed request');
      assert(!!issued!.request.write_boundary && workUnitMayWritePath(issued!.request.write_boundary!, path.relative(project.root, noteAbs)),
        'the unrelated note must remain inside an actually authorized workspace');
      const contractHash = sha256File(contractsAbs), noteHash = sha256File(noteAbs);
      assert(contractHash !== null && noteHash !== null, 'the actual plan writer must leave both real files');
      writes.push({ invokeId: issued!.request.invoke_id, instruction: issued!.request.context.instruction ?? '', preContractHash,
        contractHash: contractHash!, noteHash: noteHash! });
    },
  });
  assertPlanFailedOnRc8Target(project);
  assert(planMaterialWrites >= 2, 'the fixture must include actual preparation and a real feedback handback');
  const feedbackWrites = writes.filter(write => write.instruction.includes(RC8_CHECK_ID) && write.instruction.includes(RC8_CONSTRAINT_ID));
  assert(feedbackWrites.length === 1, 'one actual handback of the same known unresolved problem must pause, not buy another plan rewrite: ' + feedbackWrites.length);
  const feedbackStartAt = probe.events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === feedbackWrites[0].invokeId);
  assert(feedbackStartAt >= 0 && probe.events.slice(0, feedbackStartAt).some(event => event.type === 'harness_end' && event.phase === 'plan' && event.timed_out !== true),
    'the actual plan checker must produce the failure before the signed repair request');
  assert(new Set(writes.map(write => write.noteHash)).size === writes.length, 'both cases must really change the same unrelated note');
  const contractGenerations = new Set(writes.map(write => write.contractHash)).size;
  assert(relatedChange ? contractGenerations >= 2 : contractGenerations === 1, 'related contract bytes must differ only in RC-8a');
  const currentContracts = YAML.parse(fs.readFileSync(contractsAbs, 'utf8'));
  assert(!JSON.stringify(currentContracts).includes(RC8_CONSTRAINT_ID), 'the actual security constraint must remain unmapped');
  for (const write of writes.filter(item => item.preContractHash !== item.contractHash)) {
    assert(probe.events.some(event => event.type === 'phase_write_observed' && event.phase === 'work-unit-author' && event.invoke_id === write.invokeId
      && ((event.owned ?? []) as Array<{ path?: string; owner?: string; pre_sha256?: string | null; post_sha256?: string }>).some(row =>
        row.path === contractsRel && row.owner === 'plan' && row.pre_sha256 === write.preContractHash && row.post_sha256 === write.contractHash)),
      'the runtime must record the actual authorized plan write, not a fabricated phase actor');
  }
  const planChecks = probe.events.filter(event => event.type === 'harness_end' && event.phase === 'plan' && event.timed_out !== true);
  assert(planChecks.length > 0, 'the real plan checker must execute; unchanged semantic inputs may reuse its current bound FAIL');
  const halt = haltEvents(probe.events).find(event => event.halt_reason === 'no_progress_guard');
  assert(!!halt, 'unresolved current facts must naturally reach the existing no-progress pause: ' + JSON.stringify(haltEvents(probe.events)));
  const detail = String(halt!.reason ?? '') + '\n' + String(halt!.halt_guidance ?? '');
  assert(detail.includes(RC8_CHECK_ID) && detail.includes(RC8_CONSTRAINT_ID), 'pause must preserve the actual target and constraint: ' + detail);
  assert(/无.*改善|同一反馈|当前有效完成检查/.test(detail), 'pause must explain the current unfinished work rather than an obsolete failure_kind: ' + detail);
  assert(!/没能解析出任何相关目标|相关目标未知/.test(detail), 'known contract evidence must not be relabeled as an unknown target');
  assert(probe.exitCode !== 0 && !probe.events.some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))),
    'an unresolved required constraint must never claim completion');
}

test('RC-8a 同签名重复失败但相关字节真修改：实际问题未改善时有界暂停', withProject((project, birthChain) => runRc8NoProgress(project, birthChain, true)));

test('RC-8b 同签名重复失败且只改无关文件：走既有 no-progress 停机并说清理由', withProject((project, birthChain) => runRc8NoProgress(project, birthChain, false)));

// ===========================================================================
// RC-8c（plan 3abca824 t4 · A7 公开入口）：plan 是非建立阶段（facts 由 spec 建立）；plan 材料齐全，
// 只是本阶段增量小节缺失 / 为空。登记为账本披露后：原始 FAIL 仍在脚本报告里，plan 这一轮结论 PASS、
// 该失败进 `disclosed_failures`，链越过 plan 继续推进。对照：去向表去掉该条时 plan 应 FAIL（反向变异）。
// ===========================================================================

function stripPlanDelta(p: RealChainProject, mode: 'missing' | 'empty'): void {
  const abs = featureFilePath(p.root, p.feature, 'context/facts.md');
  const raw = fs.readFileSync(abs, 'utf-8');
  const at = raw.search(/^##\s*phase_delta:\s*plan\b/m);
  assert(at >= 0, `writePlanMaterials 未写 plan 增量节，夹具前提不成立：\n${raw}`);
  const rest = raw.slice(at).replace(/^##\s*phase_delta:\s*plan\b[^\n]*\n/, '');
  const next = rest.search(/^##\s/m);
  const tail = next >= 0 ? rest.slice(next) : '';
  fs.writeFileSync(abs, raw.slice(0, at) + (mode === 'empty' ? '## phase_delta: plan\n\n' : '') + tail, 'utf-8');
}

async function rc8cPlanDeltaDisclosed(mode: 'missing' | 'empty', id: string): Promise<void> {
  {
    await withProject(async (project, birthChain) => {
      const { authorHooks } = await import('./lifecycle-evolution.unit.test');
      const { parseContextExploration } = await import('../../scripts/utils/context-exploration');
      const { researchSnapshotFacts } = await import('../fixtures/host-snapshot-3.1.0/migrate');
      assert(birthChain[0] === 'spec', 'this delta-shape negative needs a real earlier establishing method');
      let planMaterialWrites = 0;
      const hooks = authorHooks(project, {
        spec: writeSpecMaterials, plan: p => { planMaterialWrites++; writePlanMaterials(p); },
        coding: p => writeCodingMaterials(p), review: writeReviewMaterials, ut: writeUtMaterials, testing: writeTestPlan,
      });
      const probe = await runGoalRuntimeChain(project.root, {
        onOutOfChain: ctx => { assert(publishRequestedVerifier(project, ctx), `unexpected model purpose: ${ctx.phase}`); },
        frameworkRoot: project.frameworkRoot,
        featureId: project.feature,
        realHarness: true,
        adapter: 'codex',
        freshStartPhase: birthChain[0] as 'spec',
        freshEndPhase: birthChain[birthChain.length - 1],
        freshRequirement: REAL_CHAIN_REQUIREMENT,
        onAuthor: (ctx, context) => {
          const writesBefore = planMaterialWrites;
          hooks.onAuthor(ctx, context);
          if (!context.factsContext?.baseline && context.factsContext?.first_phase === 'spec') {
            // This is still the first author handback, before any baseline is admitted. Preserve every real method delta.
            const factsFile = featureFilePath(project.root, project.feature, 'context/facts.md');
            const raw = fs.readFileSync(factsFile, 'utf8'), facts = parseContextExploration(raw);
            assert(!facts.error, 'the original writers must produce a readable research record');
            const declared = Array.isArray(facts.fm.source_code_paths) ? facts.fm.source_code_paths.filter((source): source is string => typeof source === 'string') : [];
            const targets = (YAML.parse(fs.readFileSync(featureFilePath(project.root, project.feature, 'contracts.yaml'), 'utf8')) as { files: string[] }).files;
            const researched = [...new Set([...declared, ...targets])].filter(source => fs.existsSync(path.join(project.root, source)) && fs.statSync(path.join(project.root, source)).isFile());
            for (const source of researched) fs.readFileSync(path.join(project.root, source));
            const methodDeltas = raw.match(/^##\s*phase_delta:[\s\S]*/m)?.[0] ?? '';
            fs.writeFileSync(factsFile, '---\n' + YAML.stringify({ ...facts.fm,
              source_code_paths: researched }) + '---\n' + facts.body, 'utf8');
            researchSnapshotFacts(project.root, factsFile, 'spec', context.factsContext);
            if (methodDeltas) fs.appendFileSync(factsFile, '\n' + methodDeltas);
          }
          // Apply the original negative only after the real writer and shared facts preparation have finished.
          if (planMaterialWrites > writesBefore || /^##\s*phase_delta:\s*plan\b/m.test(fs.readFileSync(featureFilePath(project.root, project.feature, 'context/facts.md'), 'utf8'))) {
            const researched = parseContextExploration(fs.readFileSync(featureFilePath(project.root, project.feature, 'context/facts.md'), 'utf8'));
            assert(Array.isArray(researched.fm.source_code_paths) && researched.fm.source_code_paths.includes(REAL_CHAIN_PNG_EXISTING),
              'existing resource coverage must survive independently of the intentionally missing/empty plan delta');
            stripPlanDelta(project, mode);
          }
        },
      });
      assert(planMaterialWrites > 0, 'the actual author must prepare plan materials before the delta negative');
      const script = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(project.root, project.feature, 'plan'), 'script-report.json'), 'utf-8')) as { checks: CheckResult[] };
      const raw = script.checks.filter(c => c.status === 'FAIL').map(c => `${c.id}/${c.severity}`).sort();
      assert(raw.includes(`${id}/BLOCKER`), `${mode}：目标原始 FAIL 必须保留：${JSON.stringify(raw)}\n${dumpPhase(project, 'plan')}`);
      const plan = readSummary(project, 'plan') as (ReturnType<typeof readSummary> & { disclosed_failures?: Array<{ id: string }> }) | null;
      assert(script.checks.filter(c => c.status === 'FAIL').every(c => plan?.disclosed_failures?.some(d => d.id === c.id)),
        `${mode}：所有原始 FAIL 都须有共同处置的披露依据，不能忽略其它必修：${JSON.stringify(raw)}`);
      assert(plan?.verdict === 'PASS', `${mode}：披露后 plan 应通过：${dumpPhase(project, 'plan')}`);
      assert((plan?.disclosed_failures ?? []).some(d => d.id === id), `${mode}：${id} 应进 disclosed_failures：${JSON.stringify(plan?.disclosed_failures)}`);
      assert(!(plan?.blockers ?? []).some(b => (b.id ?? b.check_id) === id), `${mode}：${id} 不应再进 blockers`);
      const planPassedAt = probe.events.findIndex(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict === 'PASS');
      const codingStartAt = probe.events.findIndex((event, index) => index > planPassedAt && event.type === 'harness_start' && event.phase === 'coding');
      assert(planPassedAt >= 0 && codingStartAt > planPassedAt, mode + ': plan disclosure must really advance to the coding method');
      const codingStart = probe.events[codingStartAt];
      assert(typeof codingStart.invoke_id === 'string' && probe.events.slice(codingStartAt + 1).some(event => event.type === 'harness_end' && event.phase === 'coding'
        && event.invoke_id === codingStart.invoke_id && typeof event.exit_code === 'number' && event.timed_out !== true),
        mode + ': the actual coding method must return; a native actor label is not execution evidence');
    })();
  }
}

// 缺节与空节各一条独立用例：目标原始 FAIL 必须保留，其他原始 FAIL 也须逐条合法披露。
test('RC-8c plan 增量小节缺失：原始 FAIL 仍在，plan 通过、进披露清单，链继续推进（A7）', () => rc8cPlanDeltaDisclosed('missing', 'context_exploration_facts_phase_delta_missing'));
test('RC-8d plan 增量小节为空：原始 FAIL 仍在，plan 通过、进披露清单，链继续推进（A7）', () => rc8cPlanDeltaDisclosed('empty', 'context_exploration_facts_phase_delta_empty'));

// ===========================================================================
// RC-9（plan 14771034 §2.1 路径 1）：testing 回退 coding 后 review/ut 重验、再进 testing
// ---------------------------------------------------------------------------
// 宿主 run 的形态（ev:362-442）：testing FAIL → `phase_backtrack_requested from=testing to=coding
// reason=repair_candidates invalidated=[coding,review,ut]` → coding/review/ut 各重跑一次 PASS → 再进 testing。
// 走 attended（`viaHostBridge`，宿主同构 driver=session；T0-A 实测六阶段可跑完）。
//
// **唯一变量**：真实回退发生之前，coding 每次调用（含补 verifier 的那次重试）都不写
// `.id('open_card_title')`；只有本 run 权威事件里已有 `phase_backtrack_requested to_phase=coding`
// 时才写全。触发只读既有事件、不按调用次数。device_test.run 替身按产品源码字面渲染
// （`real-chain-providers/device-test-run.js`），故缺 id → 断言 StepResult 失败 → 生产责任路由 →
// `testing_failure_routing_*` coding 候选 → 生产回退。
//
// 放弃的准确性：宿主回退由 visual_diff 候选驱动，本条由 hylyre 断言路由驱动——两个生产者
// 汇入同一 backtrack_to_phase，视觉候选分流不在本条（plan §2.1 末）。
//
// **已登记（2026-09-24）**：本条首次实跑撞出生产角色不一致——回退后的 coding 被 `diff_within_scope`
// （run 基线累计 diff）判越界，越界项恰是 ut 阶段本 run 新建的 UT 测试文件（plan 14771034 §10.1）。
// 修复见 plan f3b8d261（UT 调用的自有源码写随 `phase_write_observed.owned` 落盘，check-coding 只扣除
// 字节未变、无他阶段改写的那份）。末尾另断「承接不免 UT 重验」。
// UT→coding 回退见下方 RC-9b（plan d7e3b9a4 修复后登记）。
// ===========================================================================

export function codingBacktrackRequested(p: RealChainProject): boolean {
  if (!p.runId) return false;
  const eventsAbs = path.join(featureFilePath(p.root, p.feature, 'goal-runs'), p.runId, 'events.jsonl');
  return fs.existsSync(eventsAbs) && loadAuthoritativeEvents(eventsAbs)
    .some(e => e.type === 'phase_backtrack_requested' && (e as { to_phase?: string }).to_phase === 'coding');
}

export async function rc9TestingBacktrackThroughCoding(): Promise<void> {
  await withProject(async (project, birthChain) => {
    const { authorHooks } = await import('./lifecycle-evolution.unit.test');
    let repair: { invokeId: string; candidates: Array<Record<string, unknown>>; testHash: string;
      acceptanceHash: string; contractsHash: string } | undefined;
    const hooks = authorHooks(project, {
      spec: writeSpecMaterials, plan: writePlanMaterials,
      coding: p => writeCodingMaterials(p, { entryTitleId: !!repair }),
      review: writeReviewMaterials, ut: writeUtMaterials, testing: writeTestPlan,
    });
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, viaHostBridge: true, adapter: 'codex',
      freshStartPhase: birthChain[0] as 'spec', freshEndPhase: birthChain[birthChain.length - 1], freshRequirement: REAL_CHAIN_REQUIREMENT,
      onOutOfChain: ctx => { assert(publishRequestedVerifier(project, ctx), `unexpected model purpose: ${ctx.phase}`); },
      onAuthor: (ctx, context) => {
        const summary = readSummary(project, 'testing') as ReturnType<typeof readSummary> & { repair_candidates?: Array<Record<string, unknown>> };
        const candidates = summary?.repair_candidates?.filter(candidate => /^testing_failure_routing_/.test(String(candidate.id))
          && candidate.category === 'coding' && candidate.source_phase === 'testing') ?? [];
        if (!repair && candidates.length && candidates.every(candidate => context.instruction?.includes(String(candidate.id)))) {
          const start = [...loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'))].reverse()
            .find(event => event.type === 'agent_invoke_start' && event.phase === context.phase);
          const original = start?.invoke_id ? executionRequestForInvoke(context.runDir, String(start.invoke_id)) : null;
          assert(original?.request.context.attemptId === context.attemptId && original.request.context.runId === context.runId
            && original.request.context.owner.owner_id === context.owner.owner_id && original.request.context.owner.epoch === context.owner.epoch,
          'the coding repair must consume its actual signed unit request');
          assert(original!.request.write_boundary && resolvePhasePathOwnership(original!.request.write_boundary!, REAL_CHAIN_SOURCE).owner === 'coding',
            'the actual request must grant the source implementation owner');
          assert(summary?.verdict === 'FAIL', 'the delivered repair must originate in the actual testing failure');
          repair = { invokeId: original!.request.invoke_id, candidates, testHash: sha256File(path.join(project.root, REAL_CHAIN_TEST))!,
            acceptanceHash: sha256File(featureFilePath(project.root, project.feature, 'acceptance.yaml'))!,
            contractsHash: sha256File(featureFilePath(project.root, project.feature, 'contracts.yaml'))! };
        }
        hooks.onAuthor(ctx, context);
      },
    });
    assert(repair, `actual testing defect was never delivered to its implementation owner: ${probe.invokedPhases.join(',')}`);
    const events = probe.events;
    const startAt = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === repair!.invokeId);
    const returnedAt = events.findIndex((event, index) => index > startAt && event.type === 'agent_invoke_end' && event.invoke_id === repair!.invokeId);
    assert(startAt >= 0 && returnedAt > startAt, 'the actual owner must really return before checks can accept its repair');
    const failureAt = events.findIndex(event => event.type === 'phase_verdict' && event.phase === 'testing' && event.verdict === 'FAIL');
    assert(failureAt >= 0 && failureAt < startAt, 'the actual testing FAIL must precede the repair request');
    const sourceWrites = events.filter(event => event.type === 'phase_write_observed' && event.invoke_id === repair!.invokeId)
      .flatMap(event => (event.owned ?? []) as Array<{ path?: string; owner?: string; pre_sha256?: string; post_sha256?: string }>);
    assert(sourceWrites.some(write => write.path === REAL_CHAIN_SOURCE && write.owner === 'coding' && write.pre_sha256 !== write.post_sha256),
      'the actual implementation owner must change the defective source, not only report a repair');
    assert(sha256File(path.join(project.root, REAL_CHAIN_TEST)) === repair!.testHash, 'source repair must preserve the already produced test bytes');
    assert(sha256File(featureFilePath(project.root, project.feature, 'acceptance.yaml')) === repair!.acceptanceHash
      && sha256File(featureFilePath(project.root, project.feature, 'contracts.yaml')) === repair!.contractsHash,
    'the implementation repair cannot rewrite accepted upstream definitions');
    const codingCheck = events.findIndex((event, index) => index > returnedAt && event.type === 'harness_end'
      && event.phase === 'coding' && typeof event.exit_code === 'number' && event.timed_out !== true);
    const reviewCheck = events.findIndex((event, index) => index > codingCheck && event.type === 'harness_end'
      && event.phase === 'review' && typeof event.exit_code === 'number' && event.timed_out !== true);
    const utCheck = events.findIndex((event, index) => index > reviewCheck && event.type === 'harness_end'
      && event.phase === 'ut' && typeof event.exit_code === 'number' && event.timed_out !== true);
    const testingCheck = events.findIndex((event, index) => index > utCheck && event.type === 'harness_end'
      && event.phase === 'testing' && typeof event.exit_code === 'number' && event.timed_out !== true);
    assert(codingCheck > returnedAt && reviewCheck > codingCheck && utCheck > reviewCheck && testingCheck > utCheck,
      'new implementation must really receive coding, review, UT and testing checks after the owner returns');
    assert(events.filter(event => event.type === 'harness_end' && event.phase === 'testing').length >= 2,
      'the original failed testing check must really be repeated after repair');
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) assertCurrentOwnerEvidence(project, phase);
    const current = resolveCompletionDisposition({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
      runId: project.runId, chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] });
    assert(current.completionEligible, `the actual final common completion remains unfinished: ${JSON.stringify(current.completionBlocking)}`);
  })();
}

test('RC-9 testing 回退 coding：review/ut 重验、再进 testing（coding 承接 ut 本 run 产出的测试文件）', rc9TestingBacktrackThroughCoding);

// ===========================================================================
// RC-9b（plan d7e3b9a4 笔二，f3b8d261 §4.2）：UT 产品断言失败回退 coding
// ---------------------------------------------------------------------------
// **唯一变量**：真实回退之前 coding 把 BankService 写成恒放行（`!!id` → `true`），本 run 权威事件里
// 已有 `phase_backtrack_requested to_phase=coding` 后写回 `!!id`。UT 执行替身按源码字面判
// （real-chain-host.ts `checkUtHvigorTest`）：UT 调 `openCard(` 而源码缺 `!!id` → FAIL/code_regression。
// ut 同轮内（agent 自检取得 subject 后）发布的 verifier 报告给 `end_to_end_driving` / `business_assertion_value` 两项 PASS
// （verify-ut.md 诊断口径）。于是 `ut_product_assertion_failure`（repair-candidates.ts:600-632）的
// 三条合取全部来自生产产物：执行 FAIL/code_regression + 无其它 BLOCKER FAIL + verifier 语义 PASS。
// 前提是诊断 verifier 能签发（verifier-plan.ts `canProduceVerifierRequest`）——ut 报告里只剩已确认
// 不适用（带标注）的 BLOCKER SKIP；DAG 类九项未打标 SKIP 由本条 UT 回调写的最小 DAG 消除，
// `ut_mock_plan_contracts_consistent` 由本条 plan 回调补的 contracts 接口声明消除（见下）。
//
// **诊断在 ut 同一轮内完成**：UT 回调像宿主 agent 那样自跑一次 harness（agent 侧，无 gate 标）拿到本轮
// subject、发布 verifier 报告，外层 gate 以同一 subject 读到它 → 候选 → 第 1 轮即回退。
// 放弃的准确性（plan d7e3b9a4 §8.3 实测）：报告留到**下一轮**才发布的两轮形态不覆盖——第 2 轮
// blocker 签名不变、watched 集（候选文件=BankService，UT 无权改）零变化，`shouldHaltNoProgress`
// （goal-phase-runtime.ts:9006）先于回退路由停机 `no_progress_guard`。
// ===========================================================================

const RC9B_SERVICE_OK = 'Promise.resolve(!!id)';
const RC9B_SERVICE_DEFECT = 'Promise.resolve(true)';

function writeRc9bService(p: RealChainProject, fixed: boolean): void {
  const abs = path.join(p.root, REAL_CHAIN_SERVICE);
  const src = fs.readFileSync(abs, 'utf-8');
  const current = [RC9B_SERVICE_OK, RC9B_SERVICE_DEFECT, 'Promise.resolve(id.length >= 0)'].find(value => src.includes(value));
  assert(current, `BankService 形状已变，RC-9b 的缺陷注入点失效：${src}`);
  fs.writeFileSync(abs, src.replace(current!, fixed ? RC9B_SERVICE_OK : RC9B_SERVICE_DEFECT), 'utf-8');
  const factsPath = featureFilePath(p.root, p.feature, 'context/facts.md');
  const facts = fs.readFileSync(factsPath, 'utf-8');
  fs.writeFileSync(factsPath, `${facts.trimEnd()}\n| ${REAL_CHAIN_SERVICE} | openCard 当前返回 ${fixed ? '!!id' : 'true'} | 用真实产品断言复验服务行为 |\n`, 'utf-8');
}

/** verify-ut.md 诊断口径的 verifier 报告：测试真在驱动业务、断言有业务价值。 */
function rc9bUtStrengthReport(p: RealChainProject): string {
  const source = fs.readFileSync(path.join(p.root, REAL_CHAIN_SERVICE), 'utf8').split(/\r?\n/);
  const test = fs.readFileSync(path.join(p.root, REAL_CHAIN_TEST), 'utf8').split(/\r?\n/);
  const method = source.findIndex(line => line.includes('openCard('));
  const rejected = test.findIndex(line => line.includes("service.openCard('')"));
  assert(method >= 0 && rejected >= 0 && test.some(line => line.includes("service.openCard('cmb')"))
    && test.some(line => line.includes('expect(opened).assertTrue()')) && test.some(line => line.includes('expect(rejected).assertFalse()')),
    'the independent UT decision requires the current openCard method and both business assertions');
  const result = source.find(line => line.includes('Promise.resolve('));
  assert(result, 'the bank fixture must expose the actual current return expression');
  const reference = (file: string, line: number): string => '`' + file + ':' + (line + 1) + '`';
  return [
    `# verifier — ${p.feature} / ut`, '',
    '| id | status | severity | 证据 |',
    '| --- | --- | --- | --- |',
    '| end_to_end_driving | PASS | BLOCKER | [AC-1] ' + reference(REAL_CHAIN_TEST, rejected) + ' 调用 '
      + reference(REAL_CHAIN_SERVICE, method) + '。当前实现 ' + result!.trim() + ' |',
    '| business_assertion_value | PASS | BLOCKER | ' + reference(REAL_CHAIN_TEST, rejected)
      + ' 核对有效 id 成功、空 id 被拒绝，两项均驱动实际服务。 |', '',
  ].join('\n');
}

/**
 * 最小 flow DAG（UT 自有目录 `ut/reports/flow-dag/`，ephemeral 默认落点）：消除正例链 ut 报告里九项
 * 「无 DAG 文件」的**未标注** BLOCKER SKIP（DAG 是 UT 自产工件，缺它属工件缺失，不属不适用，
 * plan d7e3b9a4 §2.2 M1）。节点源码指 BankRepository.list / BankService.openCard，AC-2（P1 both）
 * 是 acceptance_coverage 的唯一 UT 分母，spy preset 引 mock-plan 已声明的 `empty`。
 * 只在 RC-9b 写，正例链 `writeUtMaterials` 不变。
 */
function writeRc9bDag(p: RealChainProject): void {
  writeHostFile(p.root, `doc/features/${p.feature}/ut/reports/flow-dag/open_card.dag.yaml`, [
    'flow_id: rc9b_open_card',
    'flow_name: 开卡服务与银行列表',
    `module: ${p.module}`,
    'linked_acceptance:',
    '  - AC-2',
    'entry_point:',
    `  module: ${p.module}`,
    `  file: ${REAL_CHAIN_SERVICE}`,
    '  function: openCard',
    'nodes:',
    '  - id: n_list',
    '    type: async_call',
    '    description: 读取银行列表（spy preset empty）',
    '    source:',
    `      file: ${REAL_CHAIN_SOURCE_2}`,
    '      class: BankRepository',
    '      function: list',
    '    stub_strategy: spy',
    '    spy_preset: empty',
    '    next:',
    '      - n_open',
    '  - id: n_open',
    '    type: code_execution',
    '    description: 开卡服务校验银行 id',
    '    source:',
    `      file: ${REAL_CHAIN_SERVICE}`,
    '      function: openCard',
    '    next:',
    '      - n_assert',
    '  - id: n_assert',
    '    type: assertion',
    '    description: 空列表与空 id 的业务结论',
    '    linked_acceptance:',
    '      - AC-2',
    '    assertions:',
    '      - type: state_check',
    '        target: banks.length',
    "        expected: '0'",
    '    next: []',
    '',
  ].join('\n'));
}

/**
 * 第 20 项 `ut_mock_plan_contracts_consistent`（check-ut.ts:3962，§2.2 M4 工件无效、不打标）：
 * 正例材料的 mock-plan 为 BankRepository 声明 spy，而 contracts.yaml `interfaces: []`。
 * 在 plan 产出上补一条 BankRepository.list 接口声明（写法同 RC-1 `addNeverCreatedContractFile`，
 * 只在 RC-9b；签名须过 `construction_content_complete` 的精确签名判据）。
 */
function addRc9bRepositoryInterface(p: RealChainProject): void {
  const contractsAbs = featureFilePath(p.root, p.feature, 'contracts.yaml');
  const contracts = fs.readFileSync(contractsAbs, 'utf-8');
  assert(contracts.includes('interfaces: []\n'), 'contracts.interfaces 形状已变，RC-9b 的追加点失效');
  fs.writeFileSync(contractsAbs, contracts.replace('interfaces: []\n', [
    'interfaces:',
    `  - module: ${p.module}`,
    '    layer: 02-Feature',
    `    file: ${REAL_CHAIN_SOURCE_2}`,
    '    class: BankRepository',
    '    methods:',
    '      - name: list',
    '        params: []',
    "        return: 'string[]'",
    '',
  ].join('\n')), 'utf-8');
}

/** ut 落盘报告里**未标注不适用**的 BLOCKER SKIP（诊断资格的阻断面，verifier-plan.ts:279）。 */
function unmarkedUtBlockerSkips(p: RealChainProject): string[] {
  const abs = path.join(featurePhaseReportsDir(p.root, p.feature, 'ut', p.frameworkRoot), 'script-report.json');
  if (!fs.existsSync(abs)) return ['<no ut script-report>'];
  const checks = (JSON.parse(fs.readFileSync(abs, 'utf-8')) as { checks?: CheckResult[] }).checks ?? [];
  return checks
    .filter(c => c.status === 'SKIP' && c.severity === 'BLOCKER' && !isCheckNotApplicable(c))
    .map(c => `${c.id}: ${String(c.details ?? '').slice(0, 160)}`);
}

export async function rc9bUtBacktrackThroughCoding(upstreamAudit = false): Promise<void> {
  await withProject(async (project, birthChain) => {
    const { authorHooks } = await import('./lifecycle-evolution.unit.test');
    const { installSnapshotUtProvider, repairSnapshotUtProduct, snapshotVerifierHooks } = await import('../fixtures/host-snapshot-3.1.0/migrate');
    installSnapshotUtProvider(project.frameworkRoot, { test: '[AC-1] 开卡入口', source: REAL_CHAIN_SERVICE });
    const independent = snapshotVerifierHooks(project, project.feature);
    const repairId = upstreamAudit ? 'UP-UT-8A' : 'ut_product_assertion_failure';
    const repairFix = '修复 BankService.openCard 对空 id 的实现缺口';
    const repairs: Array<{ invokeId: string; fingerprint: string; index: number; summary: NonNullable<ReturnType<typeof readSummary>>;
      candidates: NonNullable<ReturnType<typeof readCurrentPhaseRepairCandidates>>;
      preSourceHash: string; testHash: string; skips: string[] }> = [];
    let currentRepair = 0;
    const hasUpstreamGap = () => upstreamAudit && !fs.readFileSync(path.join(project.root, REAL_CHAIN_SERVICE), 'utf8').includes('!!id');
    const auditReport = (runId: string): string => {
      const issues = readPhaseRepairIssues(project.root, project.feature, 'ut', { frameworkRoot: project.frameworkRoot, runId });
      const issue = issues?.rows[0];
      if (!issue) throw new Error('本次 UT 调用身份必须读到可核实的上游问题行');
      return ['```issue-verification', `- issue: ${repairId}`, '  verdict: confirmed',
        `  evidence: BankService.ets | ${issue.summary}`, '```'].join('\n');
    };
    const hooks = authorHooks(project, {
      spec: (p, runId) => writeSpecMaterials(p, runId, { preserveUnchanged: true }),
      plan: p => { writePlanMaterials(p); addRc9bRepositoryInterface(p); },
      coding: p => {
        writeCodingMaterials(p);
        writeRc9bService(p, currentRepair > 0 && (upstreamAudit || currentRepair >= 2));
        if (!upstreamAudit && currentRepair === 1) {
          const file = path.join(p.root, REAL_CHAIN_SERVICE);
          fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(RC9B_SERVICE_DEFECT, 'Promise.resolve(id.length >= 0)'));
        }
      },
      review: writeReviewMaterials,
      ut: p => {
        writeUtMaterials(p); writeRc9bDag(p);
        const upstreamGap = hasUpstreamGap();
        if (upstreamGap) fs.appendFileSync(featureFilePath(p.root, p.feature, 'ut/testability-audit.md'), [
          '', '## 问题清单', '', '| ID | 严重程度 | 分类 | 涉及文件 | 问题描述 | 修复建议 | 状态 |', '|---|---|---|---|---|---|---|',
          `| ${repairId} | MAJOR | 实现缺口 | ${REAL_CHAIN_SERVICE} | 当前 \`${REAL_CHAIN_SERVICE}:1\` 的业务入口缺空 id 防护，UT实际驱动该入口失败 | ${repairFix} | 未关闭 |`, '',
        ].join('\n'));
      },
      testing: writeTestPlan,
    }, {
      coding: p => repairSnapshotUtProduct(p.root, p.feature, 'coding'),
      ut: p => repairSnapshotUtProduct(p.root, p.feature, 'ut'),
    });
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, adapter: 'codex',
      freshStartPhase: birthChain[0] as 'spec', freshEndPhase: birthChain[birthChain.length - 1], freshRequirement: REAL_CHAIN_REQUIREMENT,
      onReview: ctx => { hooks.onReview(ctx); independent.onReview?.(ctx); },
      onOutOfChain: ctx => {
        if (ctx.phase === 'ut-verifier-format-repair') {
          const request = readDeliveredVerifierRequest(project, ctx);
          if (request?.phase !== 'ut') throw new Error('UT diagnosis must consume the actually delivered current request');
          publishFixtureVerifierEvidence({ projectRoot: project.root, reportsDir: featurePhaseReportsDir(project.root, project.feature, 'ut', project.frameworkRoot),
            feature: project.feature, phase: 'ut', subjectId: request.subject_id, draftPath: signedVerifierDraftPath(project, ctx.runId, request),
            skipSummaryPatch: true, reportText: hasUpstreamGap() ? auditReport(ctx.runId) : rc9bUtStrengthReport(project) });
        } else assert(publishRequestedVerifier(project, ctx), `unexpected model purpose: ${ctx.phase}`);
      },
      onAuthor: (ctx, context) => {
        const summary = readSummary(project, 'ut');
        const candidates = summary ? readCurrentPhaseRepairCandidates({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
          feature: project.feature, phase: 'ut', goalRunId: context.runId,
          executionScope: loadEffectiveExecutionScope(project.root, project.feature, context.runId) ?? undefined,
          workflow: resolveWorkflowSpec(project.root, {frameworkRoot: project.frameworkRoot}) },
        featurePhaseReportsDir(project.root, project.feature, 'ut', project.frameworkRoot),
        summary as Parameters<typeof readCurrentPhaseRepairCandidates>[2]) ?? [] : [];
        const candidate = candidates.find(item => item.id === repairId && item.source_phase === 'ut' && item.category === 'coding');
        if (candidate && context.instruction?.includes(repairId) && context.instruction.includes(String(candidate.item_fingerprint))) {
          const events = loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'));
          const index = events.map((event,index) => ({event,index})).filter(({event}) => event.type === 'agent_invoke_start' && event.phase === context.phase).at(-1)?.index ?? -1;
          const issued = index >= 0 ? executionRequestForInvoke(context.runDir, String(events[index].invoke_id)) : null;
          assert(issued?.request.context.runId === context.runId && issued.request.context.attemptId === context.attemptId
            && issued.request.context.owner.owner_id === context.owner.owner_id && issued.request.context.owner.epoch === context.owner.epoch,
          'repair must consume its actual signed unit request');
          assert(issued?.request.write_boundary && resolvePhasePathOwnership(issued.request.write_boundary, REAL_CHAIN_SERVICE).owner === 'coding',
            'the actual owner request must grant the defective implementation path');
          assert(summary?.verdict === 'FAIL' && /^[a-f0-9]{64}$/.test(summary.verifier_subject_id ?? ''), 'the original UT FAIL and diagnostic subject must remain');
          if (!repairs.some(repair => repair.invokeId === issued!.request.invoke_id)) repairs.push({
            invokeId: issued!.request.invoke_id, fingerprint: String(candidate.item_fingerprint), index, summary: structuredClone(summary!), candidates: structuredClone(candidates),
            preSourceHash: sha256File(path.join(project.root, REAL_CHAIN_SERVICE))!, testHash: sha256File(path.join(project.root, REAL_CHAIN_TEST))!,
            skips: unmarkedUtBlockerSkips(project),
          });
          currentRepair = repairs.length;
        }
        hooks.onAuthor(ctx, context);
      },
    });
    const events = probe.events;
    const expectedRepairs = upstreamAudit ? 1 : 2;
    assert(repairs.length >= expectedRepairs, `trusted UT defect did not receive ${expectedRepairs} actual owner handbacks: ${JSON.stringify({ repairs, end: events.at(-1) })}`);
    const first = repairs[0];
    assert(first.skips.length === 0, `the diagnosed UT FAIL cannot retain unmarked blocker skips: ${JSON.stringify(first.skips)}`);
    assert(first.candidates.some(candidate => candidate.id === repairId && candidate.source_phase === 'ut'), 'the real current product/audit candidate must reach its owner');
    if (upstreamAudit) {
      assert(!first.candidates.some(candidate => candidate.id === 'ut_product_assertion_failure'), 'audit must not impersonate the old machine candidate');
      assert(probe.authorPrompts.some(prompt => prompt.includes(repairId) && prompt.includes(repairFix)), 'the actual unit author must receive the audit correction');
    } else {
      assert(repairs[1].fingerprint === first.fingerprint && /^[a-f0-9]{64}$/.test(first.fingerprint), 'the same trusted defect identity must reopen after a real but ineffective fix');
      const firstStart = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === first.invokeId);
      const secondStart = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === repairs[1].invokeId);
      assert(firstStart >= 0 && secondStart > firstStart, 'two repairs must be separate real signed invocations');
      assert(events.slice(firstStart + 1, secondStart).some(event => event.type === 'harness_end' && event.phase === 'ut' && event.timed_out !== true),
        'the ineffective source repair must actually receive another UT check before the same defect is handed back');
      assert(events.slice(firstStart + 1, secondStart).some(event => event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'FAIL'),
        'the first implementation attempt must remain a real UT failure');
      assert(!events.slice(0, firstStart).some(event => event.type === 'phase_halt' && String(event.halt_reason).startsWith('no_progress')),
        'the first verified owner handback cannot be preceded by an ignored no-progress halt');
    }
    for (const repair of repairs.slice(0, expectedRepairs)) {
      const written = events.filter(event => event.type === 'phase_write_observed' && event.invoke_id === repair.invokeId)
        .flatMap(event => (event.owned ?? []) as Array<{ path?: string; owner?: string; pre_sha256?: string; post_sha256?: string }>);
      assert(written.some(write => write.path === REAL_CHAIN_SERVICE && write.owner === 'coding'
        && write.pre_sha256 === repair.preSourceHash && write.post_sha256 !== repair.preSourceHash), 'each actual repair must change its authorized business source');
    }
    const finalRepair = repairs[Math.min(expectedRepairs, repairs.length) - 1];
    const returned = events.findIndex(event => event.type === 'agent_invoke_end' && event.invoke_id === finalRepair.invokeId);
    const coding = events.findIndex((event, index) => index > returned && event.type === 'harness_end' && event.phase === 'coding' && event.timed_out !== true);
    const review = events.findIndex((event, index) => index > coding && event.type === 'harness_end' && event.phase === 'review' && event.timed_out !== true);
    const ut = events.findIndex((event, index) => index > review && event.type === 'harness_end' && event.phase === 'ut' && event.timed_out !== true);
    assert(returned >= 0 && coding > returned && review > coding && ut > review, 'the responsible owner must return, then receive actual implementation, review and UT rechecks');
    assert(fs.readFileSync(path.join(project.root, REAL_CHAIN_SERVICE), 'utf8').includes(RC9B_SERVICE_OK), 'the final implementation must really reject an empty bank id');
    assert(sha256File(path.join(project.root, REAL_CHAIN_TEST)) === first.testHash, 'the business tests cannot be weakened to repair the source');
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut']) assertCurrentOwnerEvidence(project, phase);
    const completion = resolveCompletionDisposition({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
      feature: project.feature, runId: project.runId, chain: ['spec', 'plan', 'coding', 'review', 'ut'], endpoint: 'request' });
    assert(completion.completionEligible, `current required evidence must actually close: ${JSON.stringify(completion.completionBlocking)}`);
  })();
}

test('RC-9b ut 产品断言失败回退 coding：诊断 verifier 签发、coding 次轮 PASS、ut 重验', rc9bUtBacktrackThroughCoding);
test('RC-13 UT audit上游缺口：实际产物读取、逐条核实、责任coding修复与原UT正式复验', () => rc9bUtBacktrackThroughCoding(true));
test('RC-10 20261019真实输入：设计修订、入口声明补齐、coding资源归属及UT交接', () => rc10HostRuleCombination());
// Current resource ownership and upstream evidence boundaries live in phase-write-boundary/upstream-issues; RC10 keeps the real host integration.
for (const mode of ['design-decline'] as const) {
  test(`RC-12 upstream ${mode}: current artifact → verifier → owner → original coding recheck`, () => rc10HostRuleCombination('20261020', mode));
}

export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    if (!matchesUnitCase(c.name, selector)) continue;
    // 每条各造一次工程、各跑一段真 harness 链，单条数十秒级；逐条报时是 plan §6.3
    // 的预算记账口径（套件合计由 run-unit 给，单条只能在这里量）。
    const started = Date.now();
    try { await c.run(); out.push({ name: c.name, ok: true }); }
    catch (e) { out.push({ name: c.name, ok: false, error: (e as Error).message }); }
    console.log(`[real-chain-seams] ${c.name} — ${Date.now() - started} ms`);
  }
  return selectedUnitCases(out, selector, []);
}
export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }

export const listCaseGroups = () => unitCaseGroups(cases.map(c => c.name));
