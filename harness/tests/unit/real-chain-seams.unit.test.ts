import { beginUnitCase } from '../utils/unit-cases';
// RC-2 直接验证 runless 范围修订后，现行契约成为源码依据。
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { UnitCaseResult } from '../run-unit';
import { provisionRealChainProject, scaffoldRealChainHost, REAL_CHAIN_REQUIREMENT, REAL_CHAIN_SOURCE, type RealChainProject } from '../utils/real-chain-host';
import { writeSpecMaterials, writePlanMaterials, preserveChainFailure } from './real-chain.unit.test';
import { clearFrameworkConfigCache, featureFilePath, relFeaturesDir } from '../../config';
import {
  ensureFeatureExecutionScopeFrozen,
  readFeatureFrozenScope,
  featureEffectiveScope,
  applyFeatureScopeRevisionsThenMaybeComplete,
  appendFeatureScopeRevision,
} from '../../scripts/utils/feature-execution-scope';
import { prepareFeatureScopeCandidate, resolveScopeRevisionProposal } from '../../scripts/utils/feature-track';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { type AcceptanceSpec, type CheckResult, type Phase } from '../../scripts/utils/types';

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

// ===========================================================================
// RC-2（墙 W2）：runless 下的范围修订不得把 implementation 义务的 basis 留空
// ---------------------------------------------------------------------------
// 构造：**无 run 的受管路径**（与本套件其余条目的 goal run 是两条路），
// **冻结时验收在场**（与 `execution-scope.unit.test.ts:1333` 先删验收的分支互补），
// 缺的是写集：`contracts.files` 为空 → 出生时 implementation 没有可核验 basis。
// 随后 plan 产出真契约并发修订。判据（plan §5 原文）：implementation 义务 basis
// **随新 contracts 刷新**、不留 `basis=[]`、重解析不抛 stale。
//
// 冻结的验收发生变更时，spec 要能读取当前内容重核；下游 review 继续核原签发的绑定。
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

  // ④ 同一次手改，分别从验收的原责任方和依赖其签发结果的下游读取。
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
  assert(acceptanceValue?.state === 'resolved' && (acceptanceValue.value as AcceptanceSpec).criteria.some(item => item.id === 'AC-3'),
    'spec must receive the changed criterion for revalidation');
  const reviewBridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'review', featuresDir: relFeaturesDir(root) });
  const review = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'review', track: 'full', ...reviewBridge }).inputs!.values.acceptance;
  assert(
    review?.state === 'invalid' && review.detail === 'input binding stale; return to scope owner',
    `review 必须等待原责任方重签已变更的验收：${JSON.stringify(review)}`,
  );
  assert(JSON.stringify(featureEffectiveScope(readFeatureFrozenScope(root, feature)!)) === JSON.stringify(after),
    'reading current acceptance must not re-sign the frozen scope');
}));

// Current resource ownership and upstream evidence boundaries live in phase-write-boundary/upstream-issues; RC10 keeps the real host integration.

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    // 每条各造一次工程、各跑一段真 harness 链，单条数十秒级；逐条报时是 plan §6.3
    // 的预算记账口径（套件合计由 run-unit 给，单条只能在这里量）。
    const started = Date.now();
    const endUnitCase = beginUnitCase(c.name);
    if (!endUnitCase) continue;
    try { await c.run(); out.push({ name: c.name, ok: true }); }
    catch (e) { out.push({ name: c.name, ok: false, error: (e as Error).message }); } finally { endUnitCase(); }
    console.log(`[real-chain-seams] ${c.name} — ${Date.now() - started} ms`);
  }
  return out;
}
