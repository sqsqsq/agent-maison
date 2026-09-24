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
// 2026-09-24 在 plan d7e3b9a4 生产修复上登记，共八条。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import type { UnitCaseResult } from '../run-unit';
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
  type RealChainProject,
} from '../utils/real-chain-host';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import {
  readSummary,
  dumpPhase,
  publishVerifier,
  writeSpecMaterials,
  writePlanMaterials,
  writeCodingMaterials,
  writeReviewMaterials,
  writeUtMaterials,
  writeTestPlan,
} from './real-chain.unit.test';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { recomputePhaseEvidenceStaleness, loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import {
  ensureFeatureExecutionScopeFrozen,
  readFeatureFrozenScope,
  featureEffectiveScope,
  applyFeatureScopeRevisionsThenMaybeComplete,
} from '../../scripts/utils/feature-execution-scope';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { sha256File } from '../../scripts/utils/effective-vision-context';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import {
  MAISON_GOAL_RUNNER_ENV,
  applyGoalModelPinEnv,
  applyGoalVisualProviderEnv,
} from '../../scripts/utils/phase-state';
import { sanitizeSpawnEnv, deleteEnvKeyCaseInsensitive } from '../../scripts/utils/process-integrity';
import { computeRequestSubjectId, type VerifierRequest } from '../../scripts/utils/verifier-request';
import type { VerifierMaterialView } from '../../scripts/utils/verifier-material';
import { isCheckNotApplicable, type CheckResult, type Phase } from '../../scripts/utils/types';

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>): void { cases.push({ name, run }); }
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const DEBUG = process.env.REAL_CHAIN_DEBUG === '1';

/** 工程里有指向源仓的 junction；已实测 `fs.rmSync(recursive)` 不跟进目标。 */
function withProject(body: (p: RealChainProject, birthChain: string[]) => Promise<void>): () => Promise<void> {
  return async () => {
    const project = provisionRealChainProject();
    try {
      // 1.2：出生链由候选解析得出（天然短，随范围修订延长）。`--start/--end` 必须与它的
      // 首尾逐字相等（goal-phase-runtime.ts:4988），**不能再用 --end 截断链**。
      const birthChain = scaffoldRealChainHost(project);
      clearFrameworkConfigCache();
      await body(project, birthChain);
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
function runGateHarness(
  p: RealChainProject, phase: string, clock: string | undefined, attemptId: string,
  deviceEnv: Record<string, string>, role: 'gate' | 'agent' = 'gate',
): { status: number | null; output: string } {
  const sanitized = sanitizeSpawnEnv(clock === undefined ? { ...process.env } : { ...process.env, MAISON_TEST_AC_COVERAGE_NOW: clock });
  const childEnv: NodeJS.ProcessEnv = { ...sanitized.env, [MAISON_GOAL_RUNNER_ENV]: '1' };
  // 夹具无 model pin / 无 visual provider pin——生产此时同样是"只清不写"。
  applyGoalModelPinEnv(childEnv, undefined);
  applyGoalVisualProviderEnv(childEnv, undefined);
  deleteEnvKeyCaseInsensitive(childEnv, 'HARNESS_DIFF_BASE_REF');
  // 与生产同一个 `gateInjectedEnv`（`goal-phase-runtime.ts:1234-1249`）：轮次身份三键 + 设备目标，
  // 统一走"先清大小写变体再写唯一键"。
  for (const [k, v] of Object.entries({
    MAISON_GOAL_RUN_ID: p.runId ?? '',
    MAISON_GOAL_ATTEMPT: attemptId,
    MAISON_GOAL_ATTEMPT_PHASE: phase,
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

test('RC-1 plan 起步：待创建文件不拖垮绑定，真缺失文件在 coding 仍判 absent', withProject(async (project, birthChain) => {
  /** plan 跑的那一刻盘上既有源码的字节——coding 随后会改写它，事后再读取就对不上了。 */
  let planTimeSourceSha: string | null = null;
  const probe = await runGoalRuntimeChain(project.root, {
    frameworkRoot: project.frameworkRoot,
    featureId: project.feature,
    realHarness: true,
    adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec',
    freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: REAL_CHAIN_REQUIREMENT,
    onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
    onPlan: ctx => {
      project.runId = ctx.runId;
      writePlanMaterials(project);
      addNeverCreatedContractFile(project);
      planTimeSourceSha = sha256File(path.join(project.root, REAL_CHAIN_SOURCE));
      if (ctx.attempt > 1) publishVerifier(project, 'plan');
    },
    // coding 只创建两个待创建文件里的一个——另一个是"真缺失"。
    onCoding: ctx => { project.runId = ctx.runId; writeCodingMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'coding'); },
  });

  // ① plan 走通：facts baseline 没抛、待创建文件没把同组绑定拖垮。
  const plan = readSummary(project, 'plan');
  assert(plan?.verdict === 'PASS', `plan 未 PASS：${dumpChain(project, ['spec', 'plan'])}`);
  assert(plan?.closure_status === 'closed', `plan closure_status=${plan?.closure_status}`);

  // ② 读集的**正反两面**都要成立，缺任何一面这条都会在源码集合全空时照样绿
  //    （codex 2026-09-22 阻断 1）：
  //    正面——1.2 的源码读集链真被行使：既有源码在 plan 材料里**存在且 sha 与盘上字节相等**；
  //    反面——待创建文件**一个都不进**读集，也不以 `sha256: null` 的 absent 形态混进来
  //          （W1 的根因正是把它们判 absent 后拖垮同组绑定；正确形态是「不存在就不进读集」）。
  const planMaterial = materialFiles(project, 'plan');
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

  // ③ 真缺失文件在 coding 仍 absent：coding 不得 PASS，失败须落在**生产的缺失文件判据**
  //    （`check-coding.ts:107` 的 `file_completeness`，`affected_files` 即缺失清单）上，
  //    且清单**恰好**点名那一个文件——不得把已创建的 BankListItem.ets 一起拖下水。
  //    按 check id + affected_files 断言，而不是对整条 blocker 做 `JSON.stringify().includes()`
  //    ——后者被任意一处提到文件名的散文（suggestion / details 诊断行）满足（codex 阻断 1）。
  const coding = readSummary(project, 'coding');
  assert(coding?.verdict !== 'PASS', `coding 不该 PASS（真缺失文件被放过）：${dumpPhase(project, 'coding')}`);
  const blockers = coding?.blockers ?? [];
  const completeness = blockers.find(b => (b.id ?? b.check_id) === 'file_completeness');
  assert(completeness, `coding 没落在生产的 file_completeness 判据上：${JSON.stringify(blockers).slice(0, 800)}`);
  const missing = completeness!.affected_files ?? [];
  assert(
    missing.includes(RC1_NEVER_CREATED),
    `file_completeness 的缺失清单没点名真缺失文件：${JSON.stringify(completeness)}`,
  );
  assert(
    !missing.includes(REAL_CHAIN_NEW_SOURCE),
    `file_completeness 把已创建的待创建文件也判缺失：${JSON.stringify(completeness)}`,
  );
  assert(probe.exitCode !== 0, `coding 缺文件却整条 run 正常收尾：exit=${probe.exitCode}`);
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

test('RC-2 runless：修订后 implementation basis 随新契约刷新、重解析不抛 stale', withProject(async project => {
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

  const applied = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'plan', workflowTrack: 'full' });
  assert(applied.revisionApplied === true, `修订未被应用：${JSON.stringify(applied)}`);

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
// 构造：ut 阶段经 `onUt` 回调在链上**真写一次**测试文件（不是夹具事前塞好）。
// 判据：coding 不被判 stale；产品源码在上游读集里带施工归属，且施工豁免只给归属阶段。
// ===========================================================================

test('RC-3 UT 在链上真写测试：coding 不 stale；上游源码带施工归属且豁免只给 coding', withProject(async (project, birthChain) => {
  const probe = await runGoalRuntimeChain(project.root, {
    frameworkRoot: project.frameworkRoot,
    featureId: project.feature,
    realHarness: true,
    adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec',
    freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: REAL_CHAIN_REQUIREMENT,
    onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
    onPlan: ctx => { project.runId = ctx.runId; writePlanMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'plan'); },
    onCoding: ctx => { project.runId = ctx.runId; writeCodingMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'coding'); },
    onReview: ctx => { project.runId = ctx.runId; writeReviewMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'review'); },
    onUt: ctx => { project.runId = ctx.runId; writeUtMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'ut'); },
  });
  // 截断链（`--end ut`）以 `phase_closed_wait_user` 收尾，exitCode=2 是它的合法终态；
  // 判据落在逐阶段 verdict/closure 上，不拿退出码冒充。
  const chain = ['spec', 'plan', 'coding', 'review', 'ut'];
  for (const ph of chain) {
    assert(readSummary(project, ph)?.verdict === 'PASS',
      `${ph} 未 PASS（exit=${probe.exitCode}）：\n${dumpChain(project, chain)}`);
  }

  // 前提：UT 的测试文件确实是在链上写出来的，且 coding 已闭环。
  assert(fs.existsSync(path.join(project.root, REAL_CHAIN_TEST)), 'UT 测试文件未在链上写出');
  assert(readSummary(project, 'coding')?.closure_status === 'closed', 'coding 未闭环，本条证明不了新鲜度');

  // ① W3 的根因条目不得存在：coding 的读集里**没有** UT 测试文件（它归 ut 所有），
  //    而 ut 的读集里有——两个材料视图都是生产产物，不是夹具手写。
  const codingMaterial = materialFiles(project, 'coding');
  const utMaterial = materialFiles(project, 'ut');
  assert(
    !codingMaterial.some(f => f.path === REAL_CHAIN_TEST),
    `UT 测试文件被记成 coding 的输入（W3 复发）：${JSON.stringify(codingMaterial.map(f => f.path))}`,
  );
  assert(
    utMaterial.some(f => f.path === REAL_CHAIN_TEST),
    `UT 测试文件不在 ut 读集里，本条的前提不成立：${JSON.stringify(utMaterial.map(f => f.path))}`,
  );
  // ② UT 在链上写完自己的测试之后，coding 仍 fresh，链一路推进到 ut 而没有回退重跑 coding。
  const codingBefore = recomputePhaseEvidenceStaleness(project.root, project.feature, ['coding', 'review', 'ut'], { frameworkRoot: project.frameworkRoot })
    .find(r => r.phase === 'coding');
  assert(codingBefore?.verdict === 'fresh', `UT 改测试后 coding 被判 ${codingBefore?.verdict}：${JSON.stringify(codingBefore)}`);
  // **索引口径**：两边都用数组下标（早先左边误用 `join(',').indexOf` 的**字符位置**，
  // `['spec','plan','coding','review','ut','coding']` 会得到 24 > 5 照样过，UT 之后又跑
  // coding 根本抓不到）。
  assert(
    probe.invokedPhases.lastIndexOf('ut') > probe.invokedPhases.lastIndexOf('coding'),
    `UT 之后又回退重跑了 coding：${probe.invokedPhases.join(',')}`,
  );

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
//   (甲) 链内：ut 第 2 轮改一次**真实业务内容**（UT 测试正文）→ 反洗白，必须换代；
//   (乙) 链后：**材料字节一个都不动**，只换 `MAISON_TEST_AC_COVERAGE_NOW`，把**真实 gate
//        harness** 再跑两轮（与 `goal-phase-runtime.ts:1272` 同一条命令与同一组注入键）
//        → W4 的墙：两轮落盘的 `verifier.request.*.json` 的 subject_id 必须逐字相同，
//        整份逐字段对账里**唯一**允许不等的是审计字段 `prompt_sha256`（按设计不进 subject）。
// 甲段里时钟与正文一起变，**证不了**时钟不变量；乙段才是那一条（codex 2026-09-22 阻断）。
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
  /** 每轮 ut 开始时盘上 summary 的 subject = **上一轮** harness 算出来的那个。 */
  const subjectBefore: Array<string | undefined> = [];
  /** 就绪门实际被调用的阶段（本条自备——显式 deviceGate 覆盖后 probe 的那份不再记录）。 */
  const gatedPhases: string[] = [];
  try {
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot,
      featureId: project.feature,
      realHarness: true,
      adapter: 'codex',
      // 甲段的设备环境从这里出，乙段直接复用**同一个对象**（见 RC4_DEVICE_ENV 注释）。
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
      onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
      onPlan: ctx => { project.runId = ctx.runId; writePlanMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'plan'); },
      onCoding: ctx => { project.runId = ctx.runId; writeCodingMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'coding'); },
      onReview: ctx => { project.runId = ctx.runId; writeReviewMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'review'); },
      onUt: ctx => {
        project.runId = ctx.runId;
        subjectBefore[ctx.attempt] = readSummary(project, 'ut')?.verifier_subject_id;
        process.env.MAISON_TEST_AC_COVERAGE_NOW = RC4_CLOCKS[Math.min(ctx.attempt, RC4_CLOCKS.length) - 1];
        writeUtMaterials(project);
        // 第 2 轮起改一次业务内容并**保持不变**：第 2 轮换代、之后必须稳定。
        if (ctx.attempt >= 2) {
          const abs = path.join(project.root, REAL_CHAIN_TEST);
          fs.writeFileSync(abs, fs.readFileSync(abs, 'utf-8').replace(
            'expect(banks.length).assertEqual(0);',
            "expect(banks.length).assertEqual(0);\n    expect(typeof banks).assertEqual('object');",
          ), 'utf-8');
        }
        if (ctx.attempt > 1) publishVerifier(project, 'ut');
      },
    });
    // 截断链（--end ut）以 `phase_closed_wait_user` 收尾，exitCode=2 是它的合法终态；
    // 判据落在阶段 verdict/closure 与 subject 上，不拿退出码冒充。
    const utPhases = probe.invokedPhases.filter(x => x === 'ut').length;
    const final = readSummary(project, 'ut');
    assert(final?.verdict === 'PASS' && final?.closure_status === 'closed',
      `ut 未闭环：${dumpChain(project, ['spec', 'plan', 'coding', 'review', 'ut'])}`);
    const s3 = final!.verifier_subject_id ?? '';
    assert(/^[0-9a-f]{64}$/.test(s3), `ut summary 的 verifier_subject_id 形态非法：${s3}`);

    // 前提①：被改动的业务正文（UT 测试文件）在 subject 材料里——否则"内容变化必须换代"
    // 是空转。材料视图由生产 writer 落盘。
    const utReportsDir = featurePhaseReportsDir(project.root, project.feature, 'ut', project.frameworkRoot);
    const materialAbs = path.join(utReportsDir, `verifier.material.${s3}.json`);
    assert(fs.existsSync(materialAbs), `verifier 材料视图未落盘：${materialAbs}`);
    const material = JSON.parse(fs.readFileSync(materialAbs, 'utf-8')) as { files: Array<{ path: string }> };
    assert(
      material.files.some(f => f.path === REAL_CHAIN_TEST),
      `UT 测试正文不在 subject 材料里，反洗白那一半失去对象：${JSON.stringify(material.files.map(f => f.path))}`,
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
      g.view.files.find(f => f.path === REAL_CHAIN_TEST)?.sha256 ?? null;
    const dump = JSON.stringify({
      harnessRounds, agentAttempts: utPhases, clocksUsed: utPhases,
      generations: generations.map(g => ({ subject: g.subject.slice(0, 12), utTestSha: (shaOf(g) ?? '(none)').slice(0, 12) })),
      subjectBefore, finalSubject: s3.slice(0, 12),
    });

    // 前提④：ut 真的跑了多轮且**每轮换一个时钟**，否则下面两条都没有对象。
    assert(harnessRounds >= 2, `ut 的 harness 只跑了 ${harnessRounds} 轮，取不到多时钟对照：${dump}`);
    assert(utPhases >= 2, `ut 只调用了 ${utPhases} 次 agent，第二个时钟没被用上：${dump}`);

    // ① 反洗白：业务内容换过一代，且换代确实由那份被改的 UT 正文驱动
    //（两代材料记录的该文件 sha 不同，末代与盘上字节一致）。
    assert(generations.length >= 2, `业务内容变化后 subject 未换代：${dump}`);
    const shas = generations.map(shaOf);
    assert(new Set(shas).size === shas.length, `各代材料记录的 UT 正文 sha 相同，换代与内容无关：${dump}`);
    assert(shaOf(generations.find(g => g.subject === s3)!) === sha256File(path.join(project.root, REAL_CHAIN_TEST)),
      `最终 subject 的材料没对上盘上的 UT 正文：${dump}`);

    // ② W4 的墙：两轮时钟不同，**除了那份真变了的业务正文，材料逐文件 sha 必须完全相同**
    //    ——任何随时钟漂移的东西进了材料，这里立刻不等。
    assert(generations.length === 2, `本条按两代材料对账，实际 ${generations.length} 代：${dump}`);
    const [genA, genB] = generations;
    assert(
      JSON.stringify(genA.view.files.map(f => f.path)) === JSON.stringify(genB.view.files.map(f => f.path)),
      `两代材料的文件集合不同，无法单变量对账：${dump}`,
    );
    const drifted = genA.view.files
      .filter((f, i) => f.sha256 !== genB.view.files[i].sha256)
      .map(f => f.path);
    assert(
      JSON.stringify(drifted) === JSON.stringify([REAL_CHAIN_TEST]),
      `时钟漂移带进了材料（除 UT 正文外还有文件换 sha）：${JSON.stringify(drifted)}；${dump}`,
    );
    // 材料的**非文件字段**同样不得随时钟漂移——subject 经 material_sha256 把它们一起吃进去
    //（`computeMaterialSha256`，verifier-material.ts:74），只对 `files` 逐文件对账会漏掉这一格。
    for (const key of ['schema', 'input_bindings_sha256', 'gate_fingerprint', 'phase_rule_sha256',
      'template_sha256', 'lifecycle_sha256', 'extension_sha256', 'script_checks'] as const) {
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

    // ④ **W4 的墙本身**（codex 2026-09-22 阻断：甲段里时钟与正文一起变，证不了时钟不变量）。
    //    材料字节一个都不动，只换时钟，把真实 gate harness 再跑两轮——整条 subject 派生链
    //    （输入解析 → 材料视图 → material_sha256 → request）都由生产代码重走一遍。
    //    判据：两轮落盘的 request 整份逐字段对账、**唯一允许差异 `prompt_sha256`**，
    //    不是只比挑出来的几个字段，也不是拿确定性函数自我印证。
    //    设备目标用甲段就绪门交出去的**同一个对象** `RC4_DEVICE_ENV`，不另造——否则乙段跑的
    //    是与甲段不同的环境（父进程回落 hmos-app 后 `ut.run` 属设备能力，就绪门会冻结 HDC 目标，
    //    生产在 `goal-phase-runtime.ts:8244` 把它传给 gate harness）。
    const utAttemptId = phaseAttemptIdFromReceipt(project, 'ut');
    assert(gatedPhases.includes('ut'),
      `ut 没过就绪门，乙段带设备环境就失去依据：${JSON.stringify(gatedPhases)}`);
    const clockRound = (clock: string): { subject: string; request: VerifierRequest } => {
      // 每轮先清掉旧凭证：轮末只要"该 subject 的 request 在盘上"即证明是本轮写的，
      // 不依赖时钟/文件系统 mtime 精度（codex 2026-09-22 三轮建议）。
      for (const fn of fs.readdirSync(utReportsDir).filter(x => /^verifier\.request\..*\.json$/.test(x))) {
        fs.rmSync(path.join(utReportsDir, fn), { force: true });
      }
      const r = runGateHarness(project, 'ut', clock, utAttemptId, RC4_DEVICE_ENV);
      // 子进程必须真的跑成功——非 0 退出下面读到的全是上一轮的旧产物。
      assert(r.status === 0, `只换时钟重跑 gate harness 未 exit 0（exit=${r.status}）：${r.output.slice(-2000)}`);
      // 且必须真的**走了 goal 分支**：注入键名写错时子进程会静默落 interactive/manual
      //（`harness-runner.ts:1589` 据 `isGoalOrchestrationEnv()` 渲染 `mode=goal_mode|manual`），
      // 门禁照跑、断言照过，测的却不是生产路径。这一条就是那个错的哨兵。
      assert(/\bmode=goal_mode\b/.test(r.output),
        `重跑的 gate harness 没走 goal 分支（注入键名/常量对不上）：${r.output.slice(-2000)}`);
      const subject = readSummary(project, 'ut')?.verifier_subject_id;
      assert(subject && /^[0-9a-f]{64}$/.test(subject),
        `只换时钟重跑 gate harness 后 summary 无合法 subject：${r.output.slice(-1500)}`);
      // 且必须是**本轮**落的盘：进轮前整片删过，凭证写入是无条件 `writeFileSync`
      //（harness-runner.ts:2524），文件重新出现即证明本轮真写了，没写就无从冒充。
      const abs = path.join(utReportsDir, `verifier.request.${subject}.json`);
      assert(fs.existsSync(abs), `本轮没有重新落盘 request（进轮前已清空该目录的凭证）：${abs}`);
      return { subject: subject!, request: verifierRequestOf(project, 'ut', subject!) };
    };
    const clockX = clockRound(RC4_CLOCKS[1]);
    const clockY = clockRound(RC4_CLOCKS[2]);
    assert(clockX.subject === clockY.subject,
      `材料不变、只换时钟，subject 却换代了：${clockX.subject.slice(0, 12)} vs ${clockY.subject.slice(0, 12)}；${dump}`);
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
//   (a) 相关文件**真修改** → 允许继续（第 3 轮仍在跑）；
//   (b) 只改无关文件 → 走既有 no-progress 停机。
// 判据是"停或不停 + 理由正确"，不是"结论正确"。
//
// **失败点为什么在 plan 而不是 spec**（codex 2026-09-22 裁定，撤回本条早先的 spec.md 构造）：
// 1.2 的范围里 spec 的 required_outputs **不含 `spec.md`**，于是 `check-spec.ts:1484` 走
// 早退分支——`checkTerminologyMappingTable` 那一整组以 spec.md 为载体的检查**根本不执行**。
// 早先"删掉术语映射表整章"因此是空动作：实跑里 spec 照常 PASS，真正停机的是随后**没有
// 契约**的 plan。也就是说 (a) 报的"生产误熔断"与 (b) 的"通过"都不是它们各自声称的东西。
// 改法：把失败点显式落在 1.2 下**真会执行**的那格，并先证明它确实到达了失败结果（见
// `assertPlanFailedOnFactsDelta`），再做单变量对照。**不动生产熔断。**
// ===========================================================================

/** plan 期确定性失败点的 check id（`context-facts.ts:123`，BLOCKER，带 affected_files）。 */
const RC8_CHECK_ID = 'context_exploration_facts_phase_delta_missing';

/** 两条共用：无关文件每轮都变（把"无关变化"这一项在 (a)/(b) 之间拉平）。 */
function writeUnrelatedNote(p: RealChainProject, attempt: number): void {
  writeHostFile(p.root, 'doc/notes.md', `# notes\n\nattempt ${attempt}\n`);
}

/**
 * 先证明失败触发到了预期契约：plan 因 `RC8_CHECK_ID` 失败，且**相关文件集合**里确实有
 * `context/facts.md`——熔断的 watched 集合正来自 `blockers[].affected_files`
 * （`extractContentRelatedFiles`，goal-failure-classifier.ts:406）。这一格不成立时，
 * (a)/(b) 的结论各自都无从谈起。
 */
function assertPlanFailedOnFactsDelta(p: RealChainProject): void {
  const factsRel = `doc/features/${p.feature}/context/facts.md`;
  const plan = readSummary(p, 'plan');
  assert(plan?.verdict === 'FAIL', `plan 没按预期失败：${dumpPhase(p, 'plan')}`);
  const hit = (plan?.blockers ?? []).find(b => (b.id ?? b.check_id) === RC8_CHECK_ID);
  assert(hit, `plan 的失败不在目标检查 ${RC8_CHECK_ID} 上：${dumpPhase(p, 'plan')}`);
  assert(
    (hit!.affected_files ?? []).includes(factsRel),
    `目标检查没把相关文件带进失败结果，熔断的 watched 集合失去对象：${JSON.stringify(hit)}`,
  );
}

test('RC-8a 同签名重复失败但相关文件真修改：不停机，继续下一轮', withProject(async (project, birthChain) => {
  const probe = await runGoalRuntimeChain(project.root, {
    frameworkRoot: project.frameworkRoot,
    featureId: project.feature,
    realHarness: true,
    adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec',
    freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: REAL_CHAIN_REQUIREMENT,
    onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
    onPlan: ctx => {
      project.runId = ctx.runId;
      // 与 RC-8b 的**唯一**差别：相关文件（facts.md）每轮真换一次字节，但那一格仍没修好
      //——追加一个新的 `##` 标题节：`factsBaselineFingerprint`（首个 `## phase_delta:`
      // 之前的全部）不变，已闭环的 spec delta 段被下一个 `##` 截断因而也不变
      //（`findPhaseDeltaSection` 的 `(?=\n##\s|$)`），plan 自己的 delta 段依旧缺失 → 同一组 blocker。
      // 这正是"agent 动了被点名的文件、但没解决问题"那种真修复尝试的形态。
      const factsAbs = featureFilePath(project.root, project.feature, 'context/facts.md');
      fs.appendFileSync(factsAbs, `\n## attempt marker\n\nplan attempt ${ctx.attempt}\n`, 'utf-8');
      writeUnrelatedNote(project, ctx.attempt);
    },
  });
  assertPlanFailedOnFactsDelta(project);
  const planAttempts = probe.invokedPhases.filter(x => x === 'plan').length;
  // 判据只对 plan 说话：spec 已 PASS 推进，plan 之后没有别的阶段跑起来。
  const noProgress = haltEvents(probe.events)
    .filter(e => e.phase === 'plan' && /^no_progress/.test(String(e.halt_reason ?? '')));
  assert(noProgress.length === 0, `真修改仍被判无进展停机：${JSON.stringify(noProgress)}`);
  assert(planAttempts >= 3, `相关文件真修改却只跑了 ${planAttempts} 轮：${JSON.stringify(haltEvents(probe.events))}`);
}));

test('RC-8b 同签名重复失败且只改无关文件：走既有 no-progress 停机并说清理由', withProject(async (project, birthChain) => {
  const probe = await runGoalRuntimeChain(project.root, {
    frameworkRoot: project.frameworkRoot,
    featureId: project.feature,
    realHarness: true,
    adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec',
    freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: REAL_CHAIN_REQUIREMENT,
    onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
    onPlan: ctx => {
      project.runId = ctx.runId;
      // 与 RC-8a 的唯一差别：相关文件（facts.md）字节恒定；无关的 notes 变化两边一模一样。
      writeUnrelatedNote(project, ctx.attempt);
    },
  });
  assertPlanFailedOnFactsDelta(project);
  const halts = haltEvents(probe.events);
  const planAttempts = probe.invokedPhases.filter(x => x === 'plan').length;
  const noProgress = halts.filter(e => e.phase === 'plan' && /^no_progress/.test(String(e.halt_reason ?? '')));
  assert(
    noProgress.length > 0,
    `无进展却没走 no-progress 停机（plan 跑了 ${planAttempts} 轮）：${JSON.stringify(halts)}
${dumpPhase(project, 'plan')}`,
  );
  // halt_reason 要落**这一支**：`no_progress_toolchain/capture/agent_timeout` 与它共用同一句
  //「零变化」模板（goal-phase-runtime.ts:9004），只匹配 `/^no_progress/` + `/零变化/` 认不出走错支。
  const halt = noProgress[0];
  assert(halt.halt_reason === 'no_progress_guard', `停机走的不是内容失败那一支：${JSON.stringify(halt.halt_reason)}`);
  assert(
    /零变化/.test(String(halt.reason ?? '')) && /failure_kind=code_regression/.test(String(halt.reason ?? '')),
    `停机理由没说清无进展事实或失败分类不是内容失败：${JSON.stringify(halt.reason)}`,
  );
  // 相关集合在本条里是**已知**的（facts.md，由 assertPlanFailedOnFactsDelta 坐实），
  // 故不得走 d84cd6de 的「相关目标未知」话术——那条是相关集合为空时的另一支，混用即归因错位。
  assert(
    !/没能解析出任何相关目标|相关目标未知/.test(String(halt.halt_guidance ?? '')),
    `相关集合已知却报「相关目标未知」：${JSON.stringify(halt.halt_guidance)}`,
  );
  assert(planAttempts <= 3, `无进展停机太晚：plan 跑了 ${planAttempts} 轮`);
  assert(probe.exitCode !== 0, '停机后整条 run 仍报成功');
}));

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

function codingBacktrackRequested(p: RealChainProject): boolean {
  if (!p.runId) return false;
  const eventsAbs = path.join(featureFilePath(p.root, p.feature, 'goal-runs'), p.runId, 'events.jsonl');
  return fs.existsSync(eventsAbs) && loadAuthoritativeEvents(eventsAbs)
    .some(e => e.type === 'phase_backtrack_requested' && (e as { to_phase?: string }).to_phase === 'coding');
}

export async function rc9TestingBacktrackThroughCoding(): Promise<void> {
  await withProject(async (project, birthChain) => {
    /** testing 首次调用时 ut summary 的 mtime——回退前那份 ut 报告（「承接不免 UT 重验」的对照）。 */
    let utSummaryMtimeBeforeTesting: number | undefined;
    const utSummaryAbs = path.join(featurePhaseReportsDir(project.root, project.feature, 'ut', project.frameworkRoot), 'summary.json');
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot,
      featureId: project.feature,
      realHarness: true,
      viaHostBridge: true,
      adapter: 'codex',
      freshStartPhase: birthChain[0] as 'spec',
      freshEndPhase: birthChain[birthChain.length - 1],
      freshRequirement: REAL_CHAIN_REQUIREMENT,
      onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
      onPlan: ctx => { project.runId = ctx.runId; writePlanMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'plan'); },
      onCoding: ctx => {
        project.runId = ctx.runId;
        writeCodingMaterials(project, { entryTitleId: codingBacktrackRequested(project) });
        if (ctx.attempt > 1) publishVerifier(project, 'coding');
      },
      onReview: ctx => { project.runId = ctx.runId; writeReviewMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'review'); },
      onUt: ctx => { project.runId = ctx.runId; writeUtMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'ut'); },
      onTesting: ctx => {
        project.runId = ctx.runId;
        if (utSummaryMtimeBeforeTesting === undefined && fs.existsSync(utSummaryAbs)) utSummaryMtimeBeforeTesting = fs.statSync(utSummaryAbs).mtimeMs;
        writeTestPlan(project);
        if (ctx.attempt > 1) publishVerifier(project, 'testing');
      },
    });
    const events = probe.events;
    const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
    const dump = (): string => `${dumpChain(project, chain)}\nevents=${events.map(e => `${String(e.type)}${e.phase ? '@' + String(e.phase) : ''}`).join(',')}`;

    const btIdx = events.findIndex(e => e.type === 'phase_backtrack_requested');
    assert(btIdx >= 0, `没有发生回退：\n${dump()}`);
    // ④（先于事件形状断）：coding / review / ut 在回退后各有新的 phase_start——重验是**真跑了**，
    // 不只是事件里声称作废（变异「invalidated 去掉中段阶段」须在这里红，而不是只在 ② 的字段上红）。
    for (const ph of ['coding', 'review', 'ut'] as const) {
      assert(events.slice(btIdx).some(e => e.type === 'phase_start' && e.phase === ph), `${ph} 回退后没有重新开始：\n${dump()}`);
    }
    // ② 回退事件：宿主同形（from/to/reason，invalidated ⊇ {coding,review,ut}）。
    const bt = events[btIdx] as Record<string, unknown>;
    assert(bt.from_phase === 'testing' && bt.to_phase === 'coding' && bt.reason === 'repair_candidates',
      `回退事件形态不对：${JSON.stringify(bt).slice(0, 800)}`);
    const invalidated = (bt.invalidated_phases as string[] | undefined) ?? [];
    assert(['coding', 'review', 'ut'].every(ph => invalidated.includes(ph)), `invalidated_phases 缺中段阶段：${JSON.stringify(invalidated)}`);
    // 是否含 testing 如实记录、不断言（plan §2.1 ②）。
    if (DEBUG) console.log('RC-9 invalidated_phases', JSON.stringify(invalidated));

    // ① testing 首轮 FAIL，候选由 hylyre 断言路由产出（事件携带的是 summary 同一份候选）。
    const candidates = (bt.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    const routed = candidates.filter(c => /^testing_failure_routing_/.test(String(c.id)));
    assert(routed.length > 0 && routed.every(c => c.category === 'coding' && c.source_phase === 'testing'),
      `回退候选不是 testing 责任路由产出的 coding 候选：${JSON.stringify(candidates)}`);
    const firstTestingVerdict = events.find(e => e.type === 'phase_verdict' && e.phase === 'testing');
    assert(firstTestingVerdict && events.indexOf(firstTestingVerdict) < btIdx && firstTestingVerdict.verdict === 'FAIL',
      `testing 首轮不是 FAIL：${JSON.stringify(firstTestingVerdict)}`);

    // ③ 回退注入真的到达：回退后首次 coding 调用的指令含该候选 id。
    const codingCallsBeforeTesting = probe.invokedPhases
      .slice(0, probe.invokedPhases.indexOf('testing')).filter(x => x === 'coding').length;
    const codingAfterFirst = probe.codingPrompts[codingCallsBeforeTesting];
    assert(codingAfterFirst !== undefined, `回退后 coding 未被调用：${probe.invokedPhases.join(',')}`);
    assert(routed.every(c => codingAfterFirst.includes(String(c.id))),
      `回退后首次 coding 指令不含候选 id：${routed.map(c => c.id).join(',')}`);

    // ⑤ spec/plan 不重跑、仍 closed，链尾二者 fresh，全程无 live_drift / upstream_closure_gap。
    for (const ph of ['spec', 'plan'] as const) {
      assert(!events.slice(btIdx).some(e => e.type === 'phase_start' && e.phase === ph), `${ph} 在回退后被重跑：\n${dump()}`);
    }
    const upstream = recomputePhaseEvidenceStaleness(project.root, project.feature, ['spec', 'plan'], { frameworkRoot: project.frameworkRoot });
    assert(upstream.every(r => r.verdict === 'fresh'), `链尾 spec/plan 证据不新鲜：${JSON.stringify(upstream)}`);
    const flat = JSON.stringify(events);
    assert(!/live_drift|upstream_closure_gap/.test(flat), `出现 live_drift / upstream_closure_gap：\n${dump()}`);
    // ④⑤⑥ 终局：六阶段 PASS + closed（testing 次轮）。
    for (const ph of chain) {
      const s = readSummary(project, ph);
      assert(s?.verdict === 'PASS' && s.closure_status === 'closed', `${ph} 终局未 PASS+closed：\n${dump()}`);
    }
    assert(events.filter(e => e.type === 'phase_verdict' && e.phase === 'testing').length >= 2, `testing 没有第二轮：\n${dump()}`);
    // 承接不免 UT 重验（plan f3b8d261 §4.2）：coding 次轮之所以不被 UT 测试文件判越界，是扣除了
    // 「本 run UT 产出、字节未变」的那份文件——这只是归属，不等于 UT 结论仍然成立。回退后 ut 的
    // PASS 须晚于 coding 次轮的 PASS，且 ut 报告在回退后重写过（不要求旧 UT 证据 fresh）。
    const lastVerdictIdx = (ph: string): number => {
      for (let i = events.length - 1; i > btIdx; i--) {
        if (events[i].type === 'phase_verdict' && events[i].phase === ph && events[i].verdict === 'PASS') return i;
      }
      return -1;
    };
    const codingPassIdx = lastVerdictIdx('coding');
    const utPassIdx = lastVerdictIdx('ut');
    assert(codingPassIdx > btIdx && utPassIdx > codingPassIdx,
      `回退后 ut 的 PASS 不晚于 coding 次轮 PASS（coding=${codingPassIdx} ut=${utPassIdx} bt=${btIdx}）：\n${dump()}`);
    assert(utSummaryMtimeBeforeTesting !== undefined && fs.statSync(utSummaryAbs).mtimeMs > utSummaryMtimeBeforeTesting,
      `回退后 ut 报告没有重写（summary mtime ${utSummaryMtimeBeforeTesting} → ${fs.statSync(utSummaryAbs).mtimeMs}）`);
    // ⑦ 哨兵：本路径无视觉行，不得出现账本完整性停机（C3 才有意义）。
    assert(!/visual_ledger_integrity/.test(flat), `出现 visual_ledger_integrity：\n${dump()}`);
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
  const [from, to] = fixed ? [RC9B_SERVICE_DEFECT, RC9B_SERVICE_OK] : [RC9B_SERVICE_OK, RC9B_SERVICE_DEFECT];
  assert(src.includes(from) || src.includes(to), `BankService 形状已变，RC-9b 的缺陷注入点失效：${src}`);
  fs.writeFileSync(abs, src.replace(from, to), 'utf-8');
}

/** verify-ut.md 诊断口径的 verifier 报告：测试真在驱动业务、断言有业务价值。 */
function publishRc9bUtVerifier(p: RealChainProject): void {
  const subjectId = readSummary(p, 'ut')?.verifier_subject_id;
  if (!subjectId) return;
  publishFixtureVerifierEvidence({
    projectRoot: p.root,
    reportsDir: featurePhaseReportsDir(p.root, p.feature, 'ut', p.frameworkRoot),
    feature: p.feature, phase: 'ut', subjectId,
    reportText: [
      `# verifier — ${p.feature} / ut`,
      '',
      '| id | status | severity | 证据 |',
      '| --- | --- | --- | --- |',
      `| end_to_end_driving | PASS | BLOCKER | [AC-1] 经 BankService.openCard 真实驱动开卡业务 |`,
      `| business_assertion_value | PASS | BLOCKER | 空 id 不得开卡是业务规则断言，失败即产品缺陷 |`,
      '',
    ].join('\n'),
    skipSummaryPatch: true,
  });
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

export async function rc9bUtBacktrackThroughCoding(): Promise<void> {
  await withProject(async (project, birthChain) => {
    /** 回退发生后 coding 首次被调用时盘上的 ut summary / 未标注 SKIP——驱动回退的那一轮。 */
    let utAtBacktrack: (ReturnType<typeof readSummary> & { repair_candidates?: Array<Record<string, unknown>> }) | null = null;
    let skipsAtBacktrack: string[] = [];
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot,
      featureId: project.feature,
      realHarness: true,
      adapter: 'codex',
      freshStartPhase: birthChain[0] as 'spec',
      freshEndPhase: birthChain[birthChain.length - 1],
      freshRequirement: REAL_CHAIN_REQUIREMENT,
      onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
      onPlan: ctx => {
        project.runId = ctx.runId;
        writePlanMaterials(project);
        addRc9bRepositoryInterface(project);
        if (ctx.attempt > 1) publishVerifier(project, 'plan');
      },
      onCoding: ctx => {
        project.runId = ctx.runId;
        const backtracked = codingBacktrackRequested(project);
        if (backtracked && !utAtBacktrack) {
          utAtBacktrack = readSummary(project, 'ut');
          skipsAtBacktrack = unmarkedUtBlockerSkips(project);
        }
        writeCodingMaterials(project);
        writeRc9bService(project, backtracked);
        if (ctx.attempt > 1) publishVerifier(project, 'coding');
      },
      onReview: ctx => { project.runId = ctx.runId; writeReviewMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'review'); },
      onUt: ctx => {
        project.runId = ctx.runId;
        writeUtMaterials(project);
        writeRc9bDag(project);
        // 本轮内按 harness NEXT 指引完成诊断：自跑 harness 拿到本轮 subject → 发布 verifier 报告，
        // 外层 gate 以同一 subject 读到它（见段首「放弃的准确性」：报告留到下一轮才发布的两轮形态不覆盖）。
        runGateHarness(project, 'ut', undefined, ctx.goalAttemptId ?? '', RC4_DEVICE_ENV, 'agent');
        publishRc9bUtVerifier(project);
      },
    });
    const events = probe.events;
    const chain = ['spec', 'plan', 'coding', 'review', 'ut'];
    const dump = (): string => `${dumpChain(project, chain)}\nunmarked BLOCKER SKIP=${JSON.stringify(skipsAtBacktrack.length ? skipsAtBacktrack : unmarkedUtBlockerSkips(project), null, 1)}`
      + `\nevents=${events.map(e => `${String(e.type)}${e.phase ? '@' + String(e.phase) : ''}`).join(',')}`;

    const btIdx = events.findIndex(e => e.type === 'phase_backtrack_requested');
    assert(btIdx >= 0, `没有发生回退：\n${dump()}`);
    const bt = events[btIdx] as Record<string, unknown>;
    if (DEBUG) console.log('RC-9b backtrack', JSON.stringify(bt).slice(0, 1500), '\nskips', JSON.stringify(skipsAtBacktrack));
    assert(bt.from_phase === 'ut' && bt.to_phase === 'coding' && bt.reason === 'repair_candidates',
      `回退事件形态不对：${JSON.stringify(bt).slice(0, 800)}`);
    for (const ph of ['coding', 'review', 'ut'] as const) {
      assert(events.slice(btIdx).some(e => e.type === 'phase_start' && e.phase === ph), `${ph} 回退后没有重新开始：\n${dump()}`);
    }

    // ② 驱动回退的那份 ut summary：诊断 verifier 已签发（subject 在场），候选由 UT 产品断言合取产出；
    //    落盘报告里已无未标注不适用的 BLOCKER SKIP（诊断资格的前提）。
    const isUtProductCandidate = (c: Record<string, unknown>): boolean =>
      c.id === 'ut_product_assertion_failure' && c.category === 'coding' && c.source_phase === 'ut'
      && Array.isArray(c.files) && (c.files as string[]).includes(REAL_CHAIN_SERVICE);
    const utBt = utAtBacktrack as (ReturnType<typeof readSummary> & { repair_candidates?: Array<Record<string, unknown>> }) | null;
    assert(utBt?.verdict === 'FAIL' && /^[0-9a-f]{64}$/.test(utBt.verifier_subject_id ?? ''),
      `回退时 ut summary 无诊断 verifier subject：${JSON.stringify({ verdict: utBt?.verdict, subject: utBt?.verifier_subject_id })}`);
    assert((utBt?.repair_candidates ?? []).some(isUtProductCandidate),
      `回退时 ut summary 无 ut_product_assertion_failure 候选：${JSON.stringify(utBt?.repair_candidates)}`);
    assert(((bt.candidates as Array<Record<string, unknown>> | undefined) ?? []).some(isUtProductCandidate),
      `回退事件未携带 ut_product_assertion_failure 候选：${JSON.stringify(bt.candidates)}`);
    // 同一候选身份：summary 与回退事件里的 item_fingerprint 必须相等（不是只看固定 id/类别/文件）。
    const fpOf = (list: Array<Record<string, unknown>> | undefined): unknown => list?.find(isUtProductCandidate)?.item_fingerprint;
    const summaryFp = fpOf(utBt?.repair_candidates);
    const eventFp = fpOf(bt.candidates as Array<Record<string, unknown>> | undefined);
    assert(typeof summaryFp === 'string' && summaryFp.length > 0 && summaryFp === eventFp,
      `回退事件携带的候选与 ut summary 不是同一身份：summary=${String(summaryFp)} event=${String(eventFp)}`);
    assert(skipsAtBacktrack.length === 0, `回退时 ut 报告仍有未标注的 BLOCKER SKIP：${JSON.stringify(skipsAtBacktrack)}`);

    // ③ 回退注入到达 coding，coding 次轮 PASS；UT 在其后重验 PASS，终局 coding/review/ut PASS+closed。
    const codingAfterBt = probe.codingPrompts[probe.invokedPhases.slice(0, probe.invokedPhases.indexOf('ut')).filter(x => x === 'coding').length];
    assert(codingAfterBt?.includes('ut_product_assertion_failure'), `回退后 coding 指令不含候选 id：${probe.invokedPhases.join(',')}`);
    const firstVerdictAfter = (ph: string, from: number): number =>
      events.findIndex((e, i) => i > from && e.type === 'phase_verdict' && e.phase === ph);
    const codingIdx = firstVerdictAfter('coding', btIdx);
    assert(codingIdx > btIdx && events[codingIdx].verdict === 'PASS', `coding 次轮不是 PASS：${JSON.stringify(events[codingIdx])}\n${dump()}`);
    const utIdx = events.findIndex((e, i) => i > codingIdx && e.type === 'phase_verdict' && e.phase === 'ut' && e.verdict === 'PASS');
    assert(utIdx > codingIdx, `coding 次轮后 ut 没有重验 PASS：\n${dump()}`);
    for (const ph of ['coding', 'review', 'ut'] as const) {
      const s = readSummary(project, ph);
      assert(s?.verdict === 'PASS' && s.closure_status === 'closed', `${ph} 终局未 PASS+closed：\n${dump()}`);
    }
  })();
}

test('RC-9b ut 产品断言失败回退 coding：诊断 verifier 签发、coding 次轮 PASS、ut 重验', rc9bUtBacktrackThroughCoding);

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    // 每条各造一次工程、各跑一段真 harness 链，单条数十秒级；逐条报时是 plan §6.3
    // 的预算记账口径（套件合计由 run-unit 给，单条只能在这里量）。
    const started = Date.now();
    try { await c.run(); out.push({ name: c.name, ok: true }); }
    catch (e) { out.push({ name: c.name, ok: false, error: (e as Error).message }); }
    console.log(`[real-chain-seams] ${c.name} — ${Date.now() - started} ms`);
  }
  return out;
}
