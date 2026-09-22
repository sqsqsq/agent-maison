// ============================================================================
// real-chain-seams.unit.test.ts — plan d4a1f7c3 §5：接缝的窄负例
// ----------------------------------------------------------------------------
// 与正例（`real-chain.unit.test.ts`）**共用构建代码、不共用冻结记录**：每条各自造工程，
// 只重跑受影响阶段（RC-2 走 runless 无 run 路径）。
//
// 断言口径统一为 plan §5 那一句：**链走得通；失败时 `owner` 与 `reason` 正确**。
// 不断言"结论正确"——本套件不冒充宿主验收，口径上限见 plan §1.1 / §8。
//
// **当前状态（2026-09-22）：本套件与正例一并从 `CORE_SUITES` 暂时退登记，未进发布门。**
// 夹具已从 `spec-driven`（1.1）纠偏到与真实宿主一致的 `obligation-driven`（1.2）——
// W1/W3 要回归的冻结范围分支只在 1.2 下存在，1.1 下跑绿等于没测。1.2 上 spec/plan 已
// PASS+closed，coding 起不来——`post_agent` 的 plan 授权门把 coding 自己改源码判成
// 「plan 冻结面漂移」（生产缺口，复现与行号见 plan §10.12），故六条用例当前 RED。
// 进度、逐轮 BLOCKER 演进、codex 五条待修阻断：plan §10.11 / §10.12。**不得靠改回 1.1 让它变绿。**
//
// 已写出的六条：RC-1 / RC-2 / RC-3 / RC-4 / RC-8a / RC-8b。
// RC-5 / RC-6a / RC-6b 未做——三条共用同一个前置：testing 必须真正驱动视觉采集链
//（`ui_change=new_or_changed` → `captureIfUiChanged` → nav 配置 → 截图/layout dump →
// `visual-diff.json`），而那条链在本仓从未被真实 harness 跑通过（正例链自述"视觉采集与 OCR
// 全链未驱动"）。RC-7 未做——四态各自给真实原因要真 goal-runner 子进程，成因依赖本机是否装了
// adapter CLI，按 §8「不许 SKIP 出包」这类环境依赖不得进发布门套件。理由与偏差全文见 plan §10.9。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { UnitCaseResult } from '../run-unit';
import {
  provisionRealChainProject,
  scaffoldRealChainHost,
  writeHostFile,
  REAL_CHAIN_REQUIREMENT,
  REAL_CHAIN_NEW_SOURCE,
  REAL_CHAIN_TEST,
  type RealChainProject,
} from '../utils/real-chain-host';
import {
  readSummary,
  dumpPhase,
  publishVerifier,
  writeSpecMaterials,
  writePlanMaterials,
  writeCodingMaterials,
  writeReviewMaterials,
  writeUtMaterials,
} from './real-chain.unit.test';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
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

interface MaterialView { files: Array<{ path: string; sha256: string | null }> }

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
function materialGenerations(p: RealChainProject, phase: string): Array<{ subject: string; files: MaterialView['files'] }> {
  const dir = featurePhaseReportsDir(p.root, p.feature, phase, p.frameworkRoot);
  return fs.readdirSync(dir)
    .filter(f => /^verifier\.material\.[0-9a-f]{64}\.json$/.test(f))
    .sort()
    .map(f => ({
      subject: f.slice('verifier.material.'.length, -'.json'.length),
      files: (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as MaterialView).files,
    }));
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
      if (ctx.attempt > 1) publishVerifier(project, 'plan');
    },
    // coding 只创建两个待创建文件里的一个——另一个是"真缺失"。
    onCoding: ctx => { project.runId = ctx.runId; writeCodingMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'coding'); },
  });

  // ① plan 走通：facts baseline 没抛、待创建文件没把同组绑定拖垮。
  const plan = readSummary(project, 'plan');
  assert(plan?.verdict === 'PASS', `plan 未 PASS：${dumpChain(project, ['spec', 'plan'])}`);
  assert(plan?.closure_status === 'closed', `plan closure_status=${plan?.closure_status}`);

  // ② 待创建文件**一个都不进** plan 的读集材料，也不以 `sha256: null` 的 absent 形态混进来
  //    ——W1 的根因正是把它们判 absent 后拖垮同组绑定；正确形态是「不存在就不进读集」。
  //
  //    **覆盖上限（plan §10.9 偏差 2，如实记）**：本夹具与正例链同跑 `spec-driven`（workflow
  //    schema **1.1**），`resolveCapabilityResolutionEntryInput` 的冻结范围分支只在 1.2 下进
  //    （`resolveEffectiveScopeSource` 无记录 → 整段跳过），所以 `codeTargets` / `factsContext`
  //    这条 1.2 的源码读集链在本链上根本没被行使，plan 材料里因此没有源码条目。
  //    "既有文件被读到"这一半改由 RC-2 的 runless 1.2 路径承担。
  const planMaterial = materialFiles(project, 'plan');
  const dump = JSON.stringify(planMaterial.map(f => `${f.path}:${f.sha256 ? 'sha' : 'null'}`));
  for (const pending of [REAL_CHAIN_NEW_SOURCE, RC1_NEVER_CREATED]) {
    const hit = planMaterial.find(f => f.path === pending);
    assert(!hit, `待创建文件混进 plan 读集（W1 的 absent 形态）：${JSON.stringify(hit)}；材料=${dump}`);
  }
  assert(planMaterial.every(f => !!f.sha256), `plan 读集里出现 absent 条目：${dump}`);

  // ③ 真缺失文件在 coding 仍 absent：coding 不得 PASS，且失败点须**点名**那一个文件，
  //    不得把已创建的 BankListItem.ets 一起拖下水（owner 正确、reason 正确）。
  const coding = readSummary(project, 'coding');
  assert(coding?.verdict !== 'PASS', `coding 不该 PASS（真缺失文件被放过）：${dumpPhase(project, 'coding')}`);
  const blockers = coding?.blockers ?? [];
  const named = blockers.filter(b => JSON.stringify(b).includes('BankBadge.ets'));
  assert(named.length > 0, `coding blockers 没点名真缺失文件：${JSON.stringify(blockers).slice(0, 800)}`);
  assert(
    !blockers.some(b => JSON.stringify(b).includes('BankListItem.ets')),
    `coding 把已创建的待创建文件也判缺失：${JSON.stringify(blockers).slice(0, 800)}`,
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
  const reportsDir = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({ checks: [revisionCheck] }), 'utf-8');

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
  // ③ 重解析不抛 stale（W2 里这一步直接异常）。
  const reResolved = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'coding', featuresDir: relFeaturesDir(root) });
  assert(reResolved.inputContext !== undefined, `coding 重解析没拿到 inputContext：${JSON.stringify(reResolved).slice(0, 400)}`);

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
  assert(acceptanceValue?.state === 'invalid' && /stale/.test((acceptanceValue as { detail?: string }).detail ?? ''),
    `改已满足的验收后重解析的结论变了：${JSON.stringify(acceptanceValue)}`);
}));

// ===========================================================================
// RC-3（墙 W3）：UT 改自己负责的测试不作废 coding
// ---------------------------------------------------------------------------
// 构造：ut 阶段经 `onUt` 回调在链上**真写一次**测试文件（不是夹具事前塞好）。
// 判据：coding 不被判 stale；产品源码真变化时 coding 仍须复核。
// ===========================================================================

test('RC-3 UT 在链上真写测试：coding 不 stale；产品源码变化时 coding 仍须复核', withProject(async (project, birthChain) => {
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

  // ③ **待补（codex 2026-09-22 裁定）**：原先这里锁的是「产品源码变了 coding 仍 fresh」
  //    并标 known-bug——该命题**已被推翻**：`phase-closure-finalizer.ts:164/306` 另有
  //    `capabilityResolutionEvidenceInputs` / `executedEvidenceInputs` 两条 extraInputs 登记通道，
  //    真实宿主 bc-openCard-2 的 coding/review/ut manifest 都登记了源码；我在 1.1 夹具上看到的
  //    「改源码仍 fresh」是 1.1 `legacyDesign` 回落 module catalog 的既定行为。
  //    反向哨兵已删（它锁的是一个不成立的命题）。
  //    **W3 的正向验收**改为：在 1.2 链上先证明 coding manifest 确实登记了源码，
  //    再断言源码变化使 coding stale 并向下游传播——等 1.2 的 coding→testing 跑通后落地
  //    （plan §10.11）。在那之前本条只验 ① ②，不对第三件事下任何结论。
}));

// ===========================================================================
// RC-4（墙 W4）：同一产物连跑两次，verifier subject 稳定
// ---------------------------------------------------------------------------
// 构造：同一条链里 ut 跑三轮，每轮换一个 `MAISON_TEST_AC_COVERAGE_NOW` 时钟；
// 第 2 轮同时改一次**真实业务内容**（UT 测试正文）。
// 判据：时钟变化不得换 subject（W4 的墙）；业务内容变化必须换 subject（反洗白）。
// ===========================================================================

const RC4_CLOCKS = ['2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z', '2026-03-03T00:00:00.000Z'];

test('RC-4 verifier subject：时钟漂移不换代，业务内容变化必须换代', withProject(async (project, birthChain) => {
  const prevClock = process.env.MAISON_TEST_AC_COVERAGE_NOW;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  /** 每轮 ut 开始时盘上 summary 的 subject = **上一轮** harness 算出来的那个。 */
  const subjectBefore: Array<string | undefined> = [];
  try {
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

    // 前提②：W4 的那份时间戳产物**没有**进 subject 材料（`createRuntimeArtifactPredicate`
    // 把 `<phase>/reports/` 整片排除，见 verifier-material.ts:116-132）。这条是"时钟不换代"
    // 的第一道防线，写成断言是为了让它被删掉时当场红，而不是靠下面 ③ 间接发现。
    assert(
      !material.files.some(f => /\/ut\/reports\/ac-coverage\.json$/.test(f.path)),
      `ac-coverage.json 进了 subject 材料（W4 的时间戳漂移面重新打开）：${JSON.stringify(material.files.map(f => f.path))}`,
    );
    // 前提③：第二道防线——`writeAcCoverageReport` 在语义未变时**沿用旧 generated_at**
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
    const shaOf = (g: { files: MaterialView['files'] }): string | null =>
      g.files.find(f => f.path === REAL_CHAIN_TEST)?.sha256 ?? null;
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
      JSON.stringify(genA.files.map(f => f.path)) === JSON.stringify(genB.files.map(f => f.path)),
      `两代材料的文件集合不同，无法单变量对账：${dump}`,
    );
    const drifted = genA.files
      .filter((f, i) => f.sha256 !== genB.files[i].sha256)
      .map(f => f.path);
    assert(
      JSON.stringify(drifted) === JSON.stringify([REAL_CHAIN_TEST]),
      `时钟漂移带进了材料（除 UT 正文外还有文件换 sha）：${JSON.stringify(drifted)}；${dump}`,
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
//   (b) 仅 notes/无关文件变化 → 走既有 no-progress 停机。
// 判据是"停或不停 + 理由正确"，不是"结论正确"。
// ===========================================================================

/**
 * 把共用 spec 材料改成确定性失败：删掉「术语映射表」整章。
 * 取这一章而不是「功能清单」，是因为 `checkTerminologyMappingTable`（check-spec.ts:888-900）
 * 会把 `affected_files: spec.md` 带出来——**相关文件集合因此是"已知"的**，
 * (a)/(b) 两条才是单变量对照（唯一差别＝那个已知的相关文件到底有没有真变）。
 */
function breakSpecMaterials(p: RealChainProject): void {
  const abs = featureFilePath(p.root, p.feature, 'spec/spec.md');
  const text = fs.readFileSync(abs, 'utf-8');
  const stripped = text.replace(/## 0\. 术语映射表[\s\S]*?(?=## 1\. )/, '');
  assert(stripped !== text, 'spec.md 章节形状已变，RC-8 的破坏点失效');
  fs.writeFileSync(abs, stripped, 'utf-8');
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
    onSpec: ctx => {
      project.runId = ctx.runId;
      writeSpecMaterials(project);
      // 前两轮同一组门禁失败；第 2 轮**相关文件本身确实被改了**（真修复尝试的形态），
      // 第 3 轮起给出合法材料让链收敛，避免把用例变成重试预算耗尽测试。
      if (ctx.attempt <= 2) {
        breakSpecMaterials(project);
        if (ctx.attempt === 2) {
          const abs = featureFilePath(project.root, project.feature, 'spec/spec.md');
          fs.writeFileSync(abs, `${fs.readFileSync(abs, 'utf-8')}\n<!-- attempt 2 real edit -->\n`, 'utf-8');
        }
      }
      if (ctx.attempt > 1) publishVerifier(project, 'spec');
    },
  });
  const specAttempts = probe.invokedPhases.filter(x => x === 'spec').length;
  const noProgress = haltEvents(probe.events).filter(e => /^no_progress/.test(String(e.halt_reason ?? '')));
  assert(noProgress.length === 0, `真修改仍被判无进展停机：${JSON.stringify(noProgress)}`);
  assert(specAttempts >= 3, `相关文件真修改却只跑了 ${specAttempts} 轮：${JSON.stringify(haltEvents(probe.events))}`);
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
    onSpec: ctx => {
      project.runId = ctx.runId;
      writeSpecMaterials(project);
      breakSpecMaterials(project);
      // 与 RC-8a 的唯一差别：相关文件（spec.md）字节恒定，只有无关的 notes 每轮不同。
      writeHostFile(project.root, 'doc/notes.md', `# notes

attempt ${ctx.attempt}
`);
      if (ctx.attempt > 1) publishVerifier(project, 'spec');
    },
  });
  const halts = haltEvents(probe.events);
  const specAttempts = probe.invokedPhases.filter(x => x === 'spec').length;
  const noProgress = halts.filter(e => /^no_progress/.test(String(e.halt_reason ?? '')));
  assert(
    noProgress.length > 0,
    `无进展却没走 no-progress 停机（spec 跑了 ${specAttempts} 轮）：${JSON.stringify(halts)}
${dumpPhase(project, 'spec')}`,
  );
  // reason 必须说清"停在哪一类事实上"：同签名 + watched 产物零变化。
  assert(
    /零变化/.test(String(noProgress[0].reason ?? '')),
    `停机理由没说清无进展事实：${JSON.stringify(noProgress[0])}`,
  );
  // 相关集合在本条里是**已知**的（spec.md），故不得走 d84cd6de 的「相关目标未知」话术
  //——那条是相关集合为空时的另一支，混用即归因错位。
  assert(
    !/没能解析出任何相关目标|相关目标未知/.test(String(noProgress[0].halt_guidance ?? '')),
    `相关集合已知却报「相关目标未知」：${JSON.stringify(noProgress[0].halt_guidance)}`,
  );
  assert(specAttempts <= 3, `无进展停机太晚：spec 跑了 ${specAttempts} 轮`);
  assert(probe.exitCode !== 0, '停机后整条 run 仍报成功');
}));

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
