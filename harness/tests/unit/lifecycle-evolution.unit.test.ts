// lifecycle-evolution.unit.test.ts — plan b2d7f4e9 §6 / t4b：完成后演进的端到端回归（release-only）
//
// 与 feature-assessment / successor-exit / component-design-handoff 的局部单测不同，这里每条用例都从
// 公开入口走到「新的完成结论」：上一版宿主快照（host-snapshot-3.1.0）→ 宿主改动（生产 writer：蓝图升版调和、
// feature 冻结记录）→ goal-runner `--supersede <完成 run>`（进程内 goalMain）→ **真 harness** 跑完后继链
//（real-chain 的逐阶段作者材料）→ 生产 `assessFeature` 给结论。不注入 verdict。
//
// 出生链的期望值不硬编码：出生前用同一生产函数 `resolveSuccessorExecutionScope` 预判本次范围，
// 再由 `assessFeature(opts.scope = 该范围)` 判 uncovered 的责任阶段——实际出生链必须与之逐字相等。

import assert from 'assert';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { assessFeature, type FeatureAssessment } from '../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { readFeatureFrozenScope, resolveSuccessorExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { createGoalRun, loadEffectiveExecutionScope, loadFrozenExecutionScope } from '../../scripts/utils/goal-run-creation';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import { createChangeUnitRef, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit, resolveChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { handWriteProjections } from './component-design-handoff.unit.test';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { resolveGoalRunBaseline } from '../../scripts/utils/goal-run-baseline';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { git, writeHostFile, REAL_CHAIN_TEST, type RealChainProject } from '../utils/real-chain-host';
import {
  writeSpecMaterials, writePlanMaterials, writeCodingMaterials, writeReviewMaterials, writeUtMaterials, writeTestPlan,
  writeCuCodingMaterials, writeCuReviewMaterials, writeCuUtMaterials, publishVerifier, dumpPhase,
} from './real-chain.unit.test';
import {
  runIds, runFile, readJson, uncoveredOwnerPhases, freezeAndTransfer, supersede, successorScope, auditedBy, completionOriginal,
  changeProjectedAcceptance, NEW_EXPECTED_RESULT,
} from './successor-exit.unit.test';
import { readScopeAcceptance } from '../../scripts/utils/feature-track';
import { recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import { changeConsumedTargetContent, changeUnconsumedBlueprintContent } from './phase-evidence-manifest.unit.test';
import type { UnitCaseResult } from '../run-unit';

type Snapshot = ReturnType<typeof loadHostSnapshot>;
type Phase = 'spec' | 'plan' | 'coding' | 'review' | 'ut' | 'testing';
type Writer = (p: RealChainProject) => void;
const BLUEPRINT_ID = 'ledger-app-blueprint';
const FLAT_WRITERS: Record<Phase, Writer> = {
  spec: writeSpecMaterials, plan: writePlanMaterials, coding: writeCodingMaterials,
  review: writeReviewMaterials, ut: writeUtMaterials, testing: writeTestPlan,
};
const CU_WRITERS: Partial<Record<Phase, Writer>> = { coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials };

function project(s: Snapshot, feature: string): RealChainProject {
  return feature === SNAPSHOT_CU_FEATURE
    ? { root: s.root, frameworkRoot: s.frameworkRoot, harnessDir: s.harnessDir, feature, module: 'ledger', modulePath: 'src/ledger' }
    : { root: s.root, frameworkRoot: s.frameworkRoot, harnessDir: s.harnessDir, feature, module: 'FinancialCard', modulePath: '02-Feature/FinancialCard' };
}

function assess(s: Snapshot, feature: string): FeatureAssessment {
  clearFrameworkConfigCache();
  return assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot });
}
const brief = (a: FeatureAssessment): string =>
  JSON.stringify({ record: a.record, uncovered: a.obligations.filter(o => o.status === 'uncovered'), blocking: a.blocking });
const blueprintDirs = (s: Snapshot): string[] => fs.readdirSync(featureFilePath(s.root, BLUEPRINT_ID, '')).sort();

/** 快照原样加载（★1 基线用）。 */
async function withSnapshot(run: (s: Snapshot) => Promise<void> | void): Promise<void> {
  const s = loadHostSnapshot();
  try {
    clearFrameworkConfigCache();
    await run(s);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(s.root, { recursive: true, force: true });
  }
}

/**
 * 真宿主形态：快照 + git 基线（真 harness 按提交核闭环与写集）。父进程 preflight 的假 DevEco 在基线前补齐，
 * 与 successor-exit `supersede()` 的写法逐字节相同，使后继起跑时工作树干净。
 */
async function withHost(run: (s: Snapshot) => Promise<void>): Promise<void> {
  await withSnapshot(async s => {
    const deveco = path.join(s.root, 'fake-deveco');
    const hvigorBin = path.join(deveco, 'tools', 'hvigor', 'bin', process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw');
    fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
    fs.writeFileSync(hvigorBin, '');
    const localFile = path.join(s.root, 'framework.local.json');
    const local = readJson<{ toolchain: { devEcoStudio: { installPath: string } } }>(localFile);
    local.toolchain.devEcoStudio.installPath = deveco.split(path.sep).join('/');
    fs.writeFileSync(localFile, JSON.stringify(local, null, 2));
    git(s.root, ['init', '-q', '-b', 'main']);
    git(s.root, ['config', 'user.email', 'lifecycle@test']);
    git(s.root, ['config', 'user.name', 'lifecycle']);
    git(s.root, ['config', 'commit.gpgsign', 'false']);
    // 快照不含 .git（README 排除项），源 run 的出生基线 commit 在这里不可达，而后继按 lineage 继承它作 diff 基线
    //（goal-run-creation `successor run_base_sha`；不可达时 coding 的 diff_within_scope 正确地 fail-closed）。
    // 宿主上历史俱在、它可达。近似：每个 Feature 的 lineage 基线 = 快照去掉**该 Feature 自己**的 UT 测试源
    //（源链里它们都是链上写的；另一 Feature 的文件在宿主基线里本就存在），完整快照作二者的合并提交；
    // 用 git replace ref 把源 run 的基线 commit 指到对应近似提交。生产路径与命令不变；
    // 放弃的准确性（基线内容不是源 run 出生前的原树）见 plan t4b 记录。
    const gitOut = (args: string[], env?: NodeJS.ProcessEnv): string =>
      execFileSync('git', args, { cwd: s.root, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
    git(s.root, ['add', '-A']);
    const full = gitOut(['write-tree']);
    const bases = [SNAPSHOT_FLAT_FEATURE, SNAPSHOT_CU_FEATURE].map(feature => {
      const index = { GIT_INDEX_FILE: path.join(s.root, '.git', `lineage-${feature.length}.index`) };
      gitOut(['read-tree', full], index);
      gitOut(['rm', '-r', '-q', '--cached', '--', `${project(s, feature).modulePath}/src/ohosTest`], index);
      const commitId = gitOut(['commit-tree', gitOut(['write-tree'], index), '-m', `lineage base of ${feature} (approximation)`]);
      const base = resolveGoalRunBaseline(s.root, feature, runIds(s.root, feature)[0]);
      assert(base.available, `源 run 基线不可解析：${JSON.stringify(base)}`);
      git(s.root, ['update-ref', `refs/replace/${base.baseSha}`, commitId]);
      return commitId;
    });
    git(s.root, ['update-ref', 'refs/heads/main', gitOut(['commit-tree', full, ...bases.flatMap(b => ['-p', b]), '-m', 'snapshot baseline'])]);
    await run(s);
  });
}
function commit(s: Snapshot, message: string): void {
  git(s.root, ['add', '-A']);
  git(s.root, ['commit', '-qm', message, '--allow-empty']);
}

interface Evolution {
  feature: string;
  /** 宿主在起后继前做的改动（其后提交一次）。 */
  change: (s: Snapshot, p: RealChainProject) => void;
  /** 作者在某阶段写完常规材料后追加的本次改动（阶段材料会重写同一文件时，保证新内容仍在）。 */
  after?: Partial<Record<Phase, Writer>>;
  /** 宿主改动已提交：起后继时走既有 `--rebaseline-to <当前 HEAD>`，后继基线 = 当前提交（plan t3c L2 裁决）。 */
  rebaseline?: boolean;
}
interface Outcome { source: string; successor: string; chain: string[]; reused: string[]; final: FeatureAssessment; error?: string }

/**
 * 公共主线：改动 → 冻结并转交给源 run（生产 writer）→ 提交 → 预判出生链 → `--supersede` 真跑后继链 → 断言通用不变量。
 * 通用不变量：出生链 = 预判 uncovered 责任阶段；新 completion 落后继 run 目录；旧原件字节不变；
 * `transfers` 追加为 [源, 后继]；无新 CU 目录；supersede 审计在后继 events。完成与否交调用方按场景断言。
 */
async function evolve(s: Snapshot, ev: Evolution): Promise<Outcome> {
  const { feature } = ev;
  const p = project(s, feature);
  const [source] = runIds(s.root, feature);
  const originalFile = completionOriginal(s, feature);
  const originalBytes = fs.readFileSync(originalFile);
  const dirs = blueprintDirs(s);
  ev.change(s, p);
  freezeAndTransfer(s, feature, source);
  commit(s, 'host change after completion');

  const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
  clearFrameworkConfigCache();
  const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement, source)!;
  const pre = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot, scope: born });
  assert.strictEqual(pre.record.state, 'ok', brief(pre));
  const expected = uncoveredOwnerPhases(pre);
  assert(expected.length > 0, `前提：改动后应有 uncovered 义务：${brief(pre)}`);
  console.log(`[lifecycle-evolution] ${feature} pre-birth uncovered=${JSON.stringify(pre.obligations.filter(o => o.status === 'uncovered').map(o => `${o.id}@${o.owner_phase}/${o.class}`))}`);

  const rebaselineTo = ev.rebaseline ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: s.root, encoding: 'utf8' }).trim() : undefined;
  const { successor, error } = await supersede(s, feature, source, expected, {
    ...authorHooks(p, feature === SNAPSHOT_CU_FEATURE ? CU_WRITERS : FLAT_WRITERS, ev.after),
    ...(rebaselineTo ? { rebaselineTo } : {}),
  });
  assert(successor, `后继未出生：${error}`);
  const scope = successorScope(s, feature, successor!);
  assert.strictEqual(scope.successor_of, source);
  if (rebaselineTo) {
    // 重基线按现有实现落三处：后继出生基线、run_created 的来源 run、supersede 审计事件的 rebaseline_to。
    const events = fs.readFileSync(runFile(s.root, feature, successor!, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    assert.strictEqual(readJson<{ run_base_sha?: string }>(runFile(s.root, feature, successor!, 'manifest.json')).run_base_sha, rebaselineTo, '后继基线应为当前提交');
    assert(events.some(e => e.type === 'run_created' && e.rebaseline_from_run_id === source), 'run_created 缺 rebaseline_from_run_id');
    assert(events.some(e => e.type === 'supersede' && e.target_run_id === source && e.rebaseline_to === rebaselineTo), 'supersede 审计缺 rebaseline_to');
  }
  assert.deepStrictEqual(scope.phase_chain, expected, `出生链应 = 预判 uncovered 责任阶段：${JSON.stringify(scope.phase_chain)} vs ${JSON.stringify(expected)}`);
  assert(auditedBy(s, feature, successor!, source), '后继缺 supersede 审计事件');
  assert(fs.readFileSync(originalFile).equals(originalBytes), '旧 completion 原件被改写');
  assert.deepStrictEqual(readFeatureFrozenScope(s.root, feature)!.transfers?.map(t => t.run_id), [source, successor], '转交记录应追加、旧转交保留');
  assert.deepStrictEqual(blueprintDirs(s), dirs, '出现了新 CU 目录');
  const final = assess(s, feature);
  const out: Outcome = { source, successor: successor!, chain: scope.phase_chain.map(String), reused: scope.reused_phases.map(r => r.phase), final, ...(error ? { error } : {}) };
  console.log(`[lifecycle-evolution] ${feature} chain=${JSON.stringify(out.chain)} reused=${JSON.stringify(out.reused)} complete=${final.complete} exit=${error ?? 0}`);
  return out;
}

/** 真 harness 跑后继链的逐阶段作者材料（`supersede()` 的 extra）。 */
function authorHooks(p: RealChainProject, writers: Partial<Record<Phase, Writer>>, after?: Partial<Record<Phase, Writer>>) {
  const hook = (phase: Phase) => (ctx: { runId: string; attempt: number }): void => {
    p.runId = factsIdentity(p, phase, ctx.runId);
    writers[phase]?.(p);
    after?.[phase]?.(p);
    if (ctx.attempt > 1) publishVerifier(p, phase);
  };
  return {
    realHarness: true, failExecutorFor: undefined,
    onSpec: hook('spec'), onPlan: hook('plan'), onCoding: hook('coding'), onReview: hook('review'), onUt: hook('ut'), onTesting: hook('testing'),
  };
}

/**
 * facts 身份位：real-chain 的 writer 每阶段都把 `run_id` 写成当前 run（源链同一 run，无差别）。
 * 后继 run 里，除建立阶段本身重跑外，事实走的是「经验证的已有基线」：基线段（含 `run_id`）一字不能动，
 * 只累积本阶段 delta（context-facts.ts `context_exploration_facts_baseline_stale`，run_id 核对对基线豁免）。
 * 真实 agent 的写法即如此，这里按同一规则给 writer 身份：建立阶段重跑 → 当前 run；否则沿用 facts 已记录的 run_id。
 */
function factsIdentity(p: RealChainProject, phase: Phase, runId: string): string {
  const file = featureFilePath(p.root, p.feature, 'context/facts.md');
  const head = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/^##\s*phase_delta:/m)[0] : '';
  const recorded = /^run_id:\s*(\S+)\s*$/m.exec(head)?.[1];
  const establishedBy = /^established_by:\s*(\S+)\s*$/m.exec(head)?.[1];
  return !recorded || establishedBy === phase ? runId : recorded;
}

/** 完成结论：新 completion 落后继 run 目录、整体 complete。失败时附各阶段结论便于归因。 */
function assertCompleted(s: Snapshot, feature: string, o: Outcome): void {
  const phases = o.chain.map(ph => dumpPhase(project(s, feature), ph)).join('\n');
  assert.strictEqual(o.final.complete, true, `后继链跑完后应完成：${brief(o.final)}\n${phases}\nexit=${o.error ?? 0}`);
  const projection = readJson<{ original_path: string }>(featureFilePath(s.root, feature, 'feature-completion.json'));
  assert(projection.original_path.split('\\').join('/').includes(`goal-runs/${o.successor}/`), `新 completion 应落后继 run 目录：${projection.original_path}`);
  assert.strictEqual(o.final.record.state === 'absent' ? null : o.final.record.run_id, o.successor);
}

// ---- 各场景的宿主改动 ----------------------------------------------------------------------------

const AC3 = {
  id: 'AC-3', feature: 'F1', description: '银行条目组件渲染银行名', target: '银行条目组件', priority: 'P1', testable: true,
  verification_steps: ['渲染 BankListItem'], expected_result: '条目文本为银行名', ut_layer: 'unit', ut_focus: 'BankListItem 渲染银行名',
};
const AC3_TEST = '02-Feature/FinancialCard/src/ohosTest/ets/test/BankListItem.test.ets';
function addAcceptance(p: RealChainProject, criterion: Record<string, unknown>): void {
  const file = featureFilePath(p.root, p.feature, 'acceptance.yaml');
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!doc.criteria.some((c: { id: string }) => c.id === criterion.id)) doc.criteria.push(criterion);
  fs.writeFileSync(file, YAML.stringify(doc));
}
/** #6 的 ut 作者材料追加：新用例文件入证据来源，AC-3 进可测性审计与覆盖映射。 */
function utCoversAc3(p: RealChainProject): void {
  writeHostFile(p.root, AC3_TEST, [
    "import { describe, it, expect } from '@ohos/hypium';",
    "import { BankRepository } from '../../../main/ets/BankRepository';",
    '',
    "describe('BankListItem', () => {",
    "  it('[AC-3] 条目渲染银行名', 0, () => {",
    '    const banks: string[] = new BankRepository().list();',
    '    expect(banks).not().assertNull();',
    '    expect(banks.length).assertEqual(0);',
    '  });',
    '});',
    '',
  ].join('\n'));
  const audit = featureFilePath(p.root, p.feature, 'ut/testability-audit.md');
  fs.writeFileSync(audit, fs.readFileSync(audit, 'utf8').replace('```\n', [
    '  - acceptance_id: AC-3',
    '    entry_point: {file: 02-Feature/FinancialCard/src/main/ets/BankRepository.ets, symbol: list}',
    '    testability_level: L1',
    '    dependencies:',
    '      - {name: Array, kind: pure}',
    '    verdict: testable',
    '```\n',
  ].join('\n')));
  const evidenceFile = featureFilePath(p.root, p.feature, 'ut/reports/coverage-evidence.json');
  const evidence = readJson<{ sources: { ut_tags: string[] }; mappings: unknown[] }>(evidenceFile);
  evidence.sources.ut_tags = [REAL_CHAIN_TEST, AC3_TEST];
  evidence.mappings.push({ scope_id: 'AC-3', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' });
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
}
const SPEC_OLD = '全部银行页展示可开卡银行列表，点击进入开卡流程。';
const SPEC_NEW = '全部银行页按开卡可用性展示银行列表，点击任一可开卡银行进入开卡流程。';
function rewordSpec(p: RealChainProject): void {
  const file = featureFilePath(p.root, p.feature, 'spec/spec.md');
  const text = fs.readFileSync(file, 'utf8');
  assert(text.includes(SPEC_OLD) || text.includes(SPEC_NEW), 'spec.md 缺待改段落');
  fs.writeFileSync(file, text.replace(SPEC_OLD, SPEC_NEW));
}
const AC9 = {
  id: 'AC-9', feature: 'F1', description: '完成后补一条设备断言', target: '银行列表', priority: 'P1', testable: true,
  verification_steps: ['打开全部银行页'], expected_result: '列表条目数与数据源一致', ut_layer: 'device', device_focus: '真机核对列表条目数',
};

function bumpBlueprint(s: Snapshot, mutate?: (bp: Record<string, unknown>) => void): void {
  const file = componentBlueprintPath(s.root, BLUEPRINT_ID);
  const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
  bp.revision = Number(bp.revision) + 1;
  for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
  mutate?.(bp);
  fs.writeFileSync(file, YAML.stringify(bp));
}

/** 宿主升蓝图（附改动）→ 生产调和原位升版 → 提交。 */
function bumpAndReconcile(s: Snapshot, mutate: (bp: Record<string, unknown>) => void, message: string): void {
  bumpBlueprint(s, mutate);
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
  commit(s, message);
}
/** 以 `source` 为源的后继出生范围（生产解析器预判，纯内存、不出生）。 */
function successorChain(s: Snapshot, feature: string, source: string): string[] {
  clearFrameworkConfigCache();
  const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
  return resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement, source)!.phase_chain.map(String);
}
const freshness = (s: Snapshot, feature: string, chain: string[]): string[] =>
  recomputePhaseEvidenceStaleness(s.root, feature, chain, { frameworkRoot: s.frameworkRoot }).map(r => `${r.phase}:${r.verdict}`);

/**
 * plan c4e7a9b2 §6 B2-1 / B2-2：`source` 的完成记录与各阶段证据是新代码写出的（新格式）。
 * ① 改蓝图中本 CU 未消费的内容 → 调和原位升版（CU / 蓝图 / 派生投影或手写 contracts 身份行字节全变）：各阶段证据 fresh、
 *    完成结论仍成立、后继出生链不含 coding / review / ut；② 再改本 CU 消费的 target 内容 → 依赖阶段照常重验。
 */
function assertIdentityOnlyReuse(s: Snapshot, feature: string, source: string, executed: string[]): void {
  assert.deepStrictEqual(freshness(s, feature, executed), executed.map(ph => `${ph}:fresh`), '前提：新格式证据当下 fresh');
  bumpAndReconcile(s, changeUnconsumedBlueprintContent, 'blueprint: unconsumed wording');
  const identity = assess(s, feature);
  console.log(`[lifecycle-evolution] B2-1 ${feature} freshness=${JSON.stringify(freshness(s, feature, executed))} ${brief(identity)}`);
  assert.deepStrictEqual(freshness(s, feature, executed), executed.map(ph => `${ph}:fresh`), '纯身份变化：各阶段证据应判 fresh');
  assert.strictEqual(identity.complete, true, `纯身份变化不应使完成结论失效：${brief(identity)}`);
  const idle = successorChain(s, feature, source);
  assert(!idle.some(ph => executed.includes(ph)), `纯身份变化：后继出生链不得含无影响阶段：${JSON.stringify(idle)}`);
  bumpAndReconcile(s, changeConsumedTargetContent, 'blueprint: consumed target content');
  const content = successorChain(s, feature, source);
  console.log(`[lifecycle-evolution] B2-2 ${feature} freshness=${JSON.stringify(freshness(s, feature, executed))} chain=${JSON.stringify(content)}`);
  assert.strictEqual(freshness(s, feature, executed)[0], `${executed[0]}:stale`, '消费 target 内容变化：首个执行阶段证据应 stale');
  assert.deepStrictEqual(content.filter(ph => executed.includes(ph)), executed, `消费 target 内容变化：依赖阶段应照常重验：${JSON.stringify(content)}`);
  assert.strictEqual(assess(s, feature).complete, false, '消费 target 内容变化后不得仍判完成');
}

/** 快照蓝图里带 `module` 的 development 节点（新准入规则要求它）。 */
function dropFirstDevelopmentModule(bp: Record<string, unknown>): string {
  let dropped = '';
  const visit = (value: unknown): void => {
    if (dropped || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.module === 'string' && typeof record.node_id === 'string') { dropped = record.node_id; delete record.module; return; }
    Object.values(record).forEach(visit);
  };
  visit(bp);
  assert(dropped, '快照蓝图没有带 module 的节点');
  return dropped;
}

/**
 * L1b / L1c 共用前半段：plan 阶段 agent 手写三份派生文件（无来源戳）→ 真 harness 跑一条后继，让完成记录绑定这些手写文件
 *（宿主原始完成的替身）。返回该完成 run 与出生链预判函数。
 */
async function handWrittenCompletion(s: Snapshot): Promise<{ completed: string; predict: (source: string) => string[] }> {
  const feature = SNAPSHOT_CU_FEATURE;
  const p = project(s, feature);
  const requirement = (runId: string) => readJson<{ requirement: string }>(runFile(s.root, feature, runId, 'manifest.json')).requirement;
  const predict = (source: string) => {
    clearFrameworkConfigCache();
    const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement(source), source)!;
    return uncoveredOwnerPhases(assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot, scope: born }));
  };
  const [snapshotRun] = runIds(s.root, feature);
  handWriteProjections(s.root);
  commit(s, 'plan-phase agent wrote the derived files by hand');
  const original = await supersede(s, feature, snapshotRun, predict(snapshotRun), authorHooks(p, CU_WRITERS));
  assert(original.successor && assess(s, feature).complete, `前提：手写文件下的完成记录（宿主原始完成替身）：${original.error} ${brief(assess(s, feature))}`);
  return { completed: original.successor!, predict };
}
/**
 * CU 源链首为 coding（facts `established_by: coding`）；后继链首变成 spec 时，spec 是本 run 的事实建立阶段：
 * 真实 agent 把既有事实基线改绑当前 run、`established_by: spec`，追加本阶段 delta（context-facts.ts 首阶段建立规则）。
 * 其后 CU writer（writeCuFacts 恒写 `established_by: coding`）重写的头部同步回 spec，使基线字节与 spec 建立时一致。
 */
function establishFactsAtSpec(p: RealChainProject, runId: string): void {
  const file = featureFilePath(p.root, p.feature, 'context/facts.md');
  const [head, ...deltas] = fs.readFileSync(file, 'utf8').split(/(?=^##\s*phase_delta:)/m);
  const baseline = head.replace(/^run_id:.*$/m, `run_id: ${runId}`).replace(/^established_by:.*$/m, 'established_by: spec');
  fs.writeFileSync(file, [baseline, ...deltas.filter(d => !/^##\s*phase_delta:\s*spec\b/.test(d)), '## phase_delta: spec\n\n本阶段研究结论已确认。\n'].join(''));
  p.runId = runId;
}
const keepSpecEstablished: Writer = p => {
  const file = featureFilePath(p.root, p.feature, 'context/facts.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^established_by: coding$/m, 'established_by: spec'));
};
/** 后继链首为 spec 的 CU 作者材料；`align` = spec 责任方是否按设计权威对齐 acceptance。 */
function specFirstCuHooks(p: RealChainProject, align: boolean) {
  const hooks = authorHooks(p, CU_WRITERS, { coding: keepSpecEstablished, review: keepSpecEstablished, ut: keepSpecEstablished });
  return { ...hooks, onSpec: (ctx: { runId: string; attempt: number }): void => {
    establishFactsAtSpec(p, ctx.runId);
    if (align) alignAcceptance(p);
    if (ctx.attempt > 1) publishVerifier(p, 'spec');
  } };
}
/** spec 责任方按当前设计权威改写手写 acceptance（只改被权威改动的字段，保留其余手写内容）。 */
function alignAcceptance(p: RealChainProject): void {
  const file = featureFilePath(p.root, p.feature, 'acceptance.yaml');
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  doc.criteria.find((c: { id: string }) => c.id === 'AC-1').expected_result = NEW_EXPECTED_RESULT;
  fs.writeFileSync(file, YAML.stringify(doc));
}

// ---- 用例 -----------------------------------------------------------------------------------------

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  // 发布门基线：本版任何规则让它变 false 即发布失败——除非 MIGRATION 登记可验证迁移路径并重生成快照（plan §5 / §6 ★1）。
  { name: 'L0 ★1 发布门基线：快照原样加载，两个 Feature assessFeature().complete', run: () => withSnapshot(s => {
    for (const feature of [SNAPSHOT_FLAT_FEATURE, SNAPSHOT_CU_FEATURE]) {
      const a = assess(s, feature);
      assert.strictEqual(a.complete, true, `${feature}：${brief(a)}`);
    }
  }) },

  { name: 'L1 ★2 宿主事故形状：蓝图升版且改进投影内容 → 调和原位升版 → --supersede → 真 harness 跑完后继链 → 新完成结论', run: () => withHost(async s => {
    const o = await evolve(s, { feature: SNAPSHOT_CU_FEATURE, change: () => {
      bumpBlueprint(s, changeProjectedAcceptance);
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
    } });
    assertCompleted(s, SNAPSHOT_CU_FEATURE, o);
    // plan c4e7a9b2 B2：上面的后继已在新代码下写出新格式绑定与证据——再做一次纯身份升版不重跑，改消费内容照常重验。
    assertIdentityOnlyReuse(s, SNAPSHOT_CU_FEATURE, o.successor, o.chain);
  }) },

  /** plan c4e7a9b2 B2-4 旧快照兼容：同样的纯身份升版落在 3.1.0 旧格式记录上（无投影标记 / 全值指纹）→ 仍按字节口径全链重跑。 */
  { name: 'L1 ★2b 旧快照兼容：纯身份升版（改本 CU 未消费的蓝图内容）落在 3.1.0 旧格式记录上 → 字节口径，出生链 [coding, review, ut]', run: () => withSnapshot(s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const [source] = runIds(s.root, feature);
    bumpBlueprint(s, changeUnconsumedBlueprintContent);
    const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
    const chain = successorChain(s, feature, source);
    console.log(`[lifecycle-evolution] L1 ★2b chain=${JSON.stringify(chain)} freshness=${JSON.stringify(freshness(s, feature, ['coding', 'review', 'ut']))}`);
    assert.deepStrictEqual(chain, ['coding', 'review', 'ut']);
    assert.strictEqual(freshness(s, feature, ['coding'])[0], 'coding:stale');
  }) },

  /**
   * L1b 宿主真实形状（bc-openCard-2 / open-card-flow-v2 盘点，2026-09-26 回灌）：三份派生文件由 plan 阶段 agent 手写、
   * 无 `derive.blueprint-*` 来源戳，contracts 带 change_unit_ref + design_ref_mappings；feature 目录无冻结记录；
   * 完成之后还有一个 HALTED run、一个无 manifest 的目录与 `.dry`。先以真 harness 跑一条后继让完成记录绑定这些手写文件
   *（宿主原始完成的替身），再走 (a) 评估 → (b) 蓝图升版调和 → (c) 评估 → (d) `--supersede` 跑完。
   */
  { name: 'L1b 宿主形状：无戳手写派生文件 + 蓝图升版 + 后继 → 调和只维护 contracts 身份指针，后继跑完 → 新完成结论', run: () => withHost(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const p = project(s, feature);
    const { predict, completed } = await handWrittenCompletion(s);
    // 晚于完成：一个 HALTED run（生产 createGoalRun + run_end HALTED）、一个无 manifest 的空目录、一个 .dry 子树
    const scope = loadFrozenExecutionScope(s.root, feature, completed)!;
    const halted = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-97af3f`;
    createGoalRun({ projectRoot: s.root, chain: scope.phase_chain, resolveHead: () => '0'.repeat(40), manifest: buildGoalManifestFromInput({
      feature, run_id: halted, adapter: 'codex', requirement: 'later run', unattended: { write_mode: 'full-access', approval_mode: 'never' },
      execution_scope: scope, chain_override: scope.phase_chain }, { projectRoot: s.root }) });
    fs.appendFileSync(runFile(s.root, feature, halted, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'run_end', status: 'HALTED', halt_reason: 'change_unit_invalid' }) + '\n');
    fs.mkdirSync(featureFilePath(s.root, feature, 'goal-runs/20260918T010101Z-0dead0'), { recursive: true });
    writeHostFile(s.root, path.relative(s.root, featureFilePath(s.root, feature, 'goal-runs/.dry/20260918T020202Z-0d0d0d/manifest.json')), '{}\n');
    commit(s, 'later runs');
    const completionFile = completionOriginal(s, feature);
    const completionBytes = fs.readFileSync(completionFile);
    const dirs = blueprintDirs(s);

    // (a) 无 run 身份评估：记录可信、义务全覆盖，只有晚到的 HALTED run 进 blocking（空目录与 .dry 不计）
    const a = assess(s, feature);
    console.log(`[lifecycle-evolution] L1b (a) ${brief(a)}`);
    assert(a.record.state === 'ok' && a.record.run_id === completed && a.obligations.every(o => o.status === 'covered'), brief(a));
    assert.deepStrictEqual(a.blocking, [`存在晚于凭证的未终局 run：${halted}（status=HALTED）`]);

    // (b) 蓝图升版（含进投影的内容）→ 调和：CU 原位升版；手写 acceptance / use-cases 字节不变，contracts 只动身份行
    const files = ['acceptance.yaml', 'use-cases.yaml', 'contracts.yaml'];
    const before = files.map(name => fs.readFileSync(featureFilePath(s.root, feature, name), 'utf8'));
    bumpBlueprint(s, changeProjectedAcceptance);
    const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    console.log(`[lifecycle-evolution] L1b (b) ${JSON.stringify(r)}`);
    assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
    const after = files.map(name => fs.readFileSync(featureFilePath(s.root, feature, name), 'utf8'));
    assert(after[0] === before[0] && after[1] === before[1], '手写 acceptance / use-cases 被改写');
    const changed = before[2].split('\n').flatMap((line, i) => line === after[2].split('\n')[i] ? [] : [after[2].split('\n')[i]!.trim()]);
    assert(changed.length > 0 && changed.every(line => /^(revision|source_fingerprint|artifact_sha256): /.test(line)), `contracts 身份指针未维护或非身份行被改：${JSON.stringify(changed)}`);
    const cu = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, 'ledger-refresh');
    assert.deepStrictEqual(YAML.parse(after[2]).change_unit.change_unit_ref, createChangeUnitRef(cu), 'contracts change_unit_ref 未跟随升版后 CU');
    commit(s, 'blueprint rev3 admitted');

    // (c) 再评估：本 CU 消费的验收内容变了（不只是身份）→ 手写 contracts 经 change_unit_ref 依赖的 CU 契约随之变化 →
    // plan 设计义务绑定 stale（plan c4e7a9b2 B2：内容变化仍重验；纯身份变化不重跑见 (e)），下游阶段证据按真实消费关系失效；
    // A1（plan c4e7a9b2）：手写 acceptance 仍是旧验收 → 验收义务 uncovered 且指名 AC-1.expected_result，不能完成
    const c = assess(s, feature);
    console.log(`[lifecycle-evolution] L1b (c) ${brief(c)}`);
    assert(c.record.state === 'ok' && c.obligations.some(o => o.owner_phase === 'plan' && o.status === 'uncovered' && o.class === 'binding'), brief(c));
    assert(!c.obligations.some(o => (o.reason ?? '').includes('CU 绑定失配')), `身份指针已维护，不应再报 CU 绑定失配：${brief(c)}`);
    assert(c.obligations.some(o => o.kind === 'acceptance-context' && o.owner_phase === 'spec' && o.status === 'uncovered' && (o.reason ?? '').includes('AC-1.expected_result')), `旧验收未对齐应 uncovered：${brief(c)}`);
    assert.strictEqual(c.complete, false, '旧 expected_result 仍在时不得完成');

    // (d) --supersede 完成 run：出生链 = 预判 uncovered 责任阶段（含 spec），spec 责任方按权威投影对齐验收，真 harness 跑完 → 新完成结论
    const expected = predict(completed);
    assert(expected.includes('spec'), `spec 应在出生链内对齐验收：${JSON.stringify(expected)}`);
    const next = await supersede(s, feature, completed, expected, specFirstCuHooks(p, true));
    assert(next.successor, `后继未出生：${next.error}`);
    const born = successorScope(s, feature, next.successor!);
    console.log(`[lifecycle-evolution] L1b (d) chain=${JSON.stringify(born.phase_chain)} reused=${JSON.stringify(born.reused_phases.map(item => item.phase))} exit=${next.error ?? 0}`);
    assert.strictEqual(born.successor_of, completed);
    assert.deepStrictEqual(born.phase_chain, expected);
    // A1-1 结果断言（与评估算法无关）：后继最终消费的 acceptance——磁盘 acceptance.yaml 与后继 run 有效范围里的验收绑定值——含新验收文本
    const onDisk = YAML.parse(fs.readFileSync(featureFilePath(s.root, feature, 'acceptance.yaml'), 'utf8')) as { criteria: Array<{ id: string; expected_result: string }> };
    assert.strictEqual(onDisk.criteria.find(item => item.id === 'AC-1')?.expected_result, NEW_EXPECTED_RESULT, '磁盘 acceptance 未含新验收');
    const effective = loadEffectiveExecutionScope(s.root, feature, next.successor!)!;
    const bound = readScopeAcceptance(s.root, { facts: effective.obligations } as unknown as Parameters<typeof readScopeAcceptance>[1], { feature, frameworkRoot: s.frameworkRoot });
    assert.strictEqual(bound?.value.criteria.find(item => item.id === 'AC-1')?.expected_result, NEW_EXPECTED_RESULT, `后继 run 绑定的 acceptance 未含新验收：${JSON.stringify(bound?.value.criteria)}`);
    assert(auditedBy(s, feature, next.successor!, completed), '后继缺 supersede 审计事件');
    assert(fs.readFileSync(completionFile).equals(completionBytes), '旧 completion 原件被改写');
    assert.deepStrictEqual(blueprintDirs(s), dirs, '出现了新 CU 目录');
    const final = assess(s, feature);
    assertCompleted(s, feature, { source: completed, successor: next.successor!, chain: born.phase_chain.map(String), reused: [], final, ...(next.error ? { error: next.error } : {}) });
    assert.deepStrictEqual(final.blocking, [], '晚到的 HALTED run 早于新完成，不再阻断');
    // (e) plan c4e7a9b2 B2（宿主手写形状）：新完成由新代码写出；纯身份升版只动手写 contracts 的身份行 → 不重跑，改消费内容 → 照常重验
    assertIdentityOnlyReuse(s, feature, next.successor!, ['coding', 'review', 'ut']);
  }) },

  /** A1-2（plan c4e7a9b2 §6）：同 L1b 但 spec 替身不改 acceptance → spec 责任阶段门 FAIL 指名 AC-1.expected_result，run 不得 COMPLETED。 */
  { name: 'L1c 手写验收未按设计权威对齐：蓝图升版改验收 → 后继 spec 不改 acceptance → authoritative_content_aligned FAIL，run 不完成', run: () => withHost(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const p = project(s, feature);
    const { predict, completed } = await handWrittenCompletion(s);
    bumpBlueprint(s, changeProjectedAcceptance);
    const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
    commit(s, 'blueprint rev3 admitted');
    const expected = predict(completed);
    assert(expected.includes('spec'), JSON.stringify(expected));
    const next = await supersede(s, feature, completed, expected, specFirstCuHooks(p, false));
    assert(next.successor, `后继未出生：${next.error}`);
    const events = fs.readFileSync(runFile(s.root, feature, next.successor!, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { type?: string; status?: string; phase?: string });
    const checks = readJson<{ checks: Array<{ id: string; status: string; details?: string }> }>(featureFilePath(s.root, feature, 'spec/reports/script-report.json')).checks;
    const gate = checks.find(c => c.id === 'authoritative_content_aligned');
    console.log(`[lifecycle-evolution] L1c exit=${next.error ?? 0} run_end=${JSON.stringify(events.filter(e => e.type === 'run_end'))} gate=${JSON.stringify(gate)}`);
    assert(gate?.status === 'FAIL' && (gate.details ?? '').includes('AC-1.expected_result'), `spec 门应指名 AC-1.expected_result：${JSON.stringify(gate)}`);
    assert.deepStrictEqual(checks.filter(c => c.status === 'FAIL').map(c => c.id), ['authoritative_content_aligned'], '失败应只因验收未对齐');
    assert(!events.some(e => e.type === 'run_end' && e.status === 'COMPLETED'), 'run 不得 COMPLETED');
    const final = assess(s, feature);
    assert.strictEqual(final.complete, false, brief(final));
    assert(final.record.state !== 'absent' && final.record.run_id === completed, `不得产生新完成记录：${JSON.stringify(final.record)}`);
  }) },

  { name: 'L2 #6 完成后补测试：宿主只在 acceptance 加一条 ut 层断言，测试交后继 ut 产出（沿用源 run 基线）→ 跑完 → 新完成结论', run: () => withHost(async s => {
    const o = await evolve(s, {
      feature: SNAPSHOT_FLAT_FEATURE,
      change: (_s, p) => addAcceptance(p, AC3),
      after: { spec: p => addAcceptance(p, AC3), ut: utCoversAc3 },
    });
    assertCompleted(s, SNAPSHOT_FLAT_FEATURE, o);
  }) },

  /**
   * L2b 立场断言（plan 423e5d0f 用户裁决的棘轮授权基线，不是缺陷）：本轮 UT 覆盖证据只认本轮基线之后产出的测试。
   * 宿主手写测试并提交后以 `--rebaseline-to HEAD` 起后继：coding 不再把该文件判越界；但它落在基线内，不计本轮覆盖，
   * ut 必须自己产出——夹具的 ut 作者只重写同样字节，故 ut 如实 FAIL、不完成。
   */
  { name: 'L2b #6 变体：宿主提交手写测试 → --rebaseline-to 当前 HEAD 起后继 → coding 不越界，ut 因基线内测试不计本轮覆盖而不完成', run: () => withHost(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const o = await evolve(s, {
      feature,
      change: (_s, p) => { addAcceptance(p, AC3); utCoversAc3(p); },
      after: { spec: p => addAcceptance(p, AC3), ut: utCoversAc3 },
      rebaseline: true,
    });
    const checks = (phase: Phase) => readJson<{ checks: Array<{ id: string; status: string; details?: string }> }>(featureFilePath(s.root, feature, `${phase}/reports/script-report.json`)).checks;
    const ran = (phase: Phase) => fs.readFileSync(runFile(s.root, feature, o.successor, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
      .some(line => { const e = JSON.parse(line) as { type?: string; phase?: string }; return e.type === 'harness_end' && e.phase === phase; });
    assert(ran('coding') && ran('ut'), '后继须真跑 coding 与 ut');
    assert.strictEqual(checks('coding').find(c => c.id === 'diff_within_scope')?.status, 'PASS', dumpPhase(project(s, feature), 'coding'));
    const ut = checks('ut');
    const failed = ut.filter(c => c.status === 'FAIL').map(c => c.id);
    assert(failed.includes('ut_coverage_evidence_resolves') && failed.includes('ut_coverage_evidence_mappings_complete'), dumpPhase(project(s, feature), 'ut'));
    assert(/新建 0 个文件 \+ 存量文件内新增 0 个用例.*锚=run_base_sha/s.test(ut.find(c => c.id === 'it_name_has_ac_or_branch_tag')?.details ?? ''), '失败原因应为「基线之后无新建/新增用例」');
    assert.strictEqual(o.final.record.state, 'ok', brief(o.final));
    assert.strictEqual(o.final.complete, false, `基线内测试不得计作本轮覆盖：${brief(o.final)}`);
  }) },

  { name: 'L3 #7 改文案：spec.md 改一段说明、acceptance 不变 → 后继跑完 → 新完成结论', run: () => withHost(async s => {
    const o = await evolve(s, { feature: SNAPSHOT_FLAT_FEATURE, change: (_s, p) => rewordSpec(p), after: { spec: rewordSpec } });
    assertCompleted(s, SNAPSHOT_FLAT_FEATURE, o);
  }) },

  { name: 'L4 #8 改验收：acceptance 新增设备层断言 → testing 入链 → 后继跑完，结论按框架既有语义（不得假 PASS）', run: () => withHost(async s => {
    const o = await evolve(s, { feature: SNAPSHOT_FLAT_FEATURE, change: (_s, p) => addAcceptance(p, AC9), after: { spec: p => addAcceptance(p, AC9) } });
    assert(o.chain.includes('testing'), JSON.stringify(o.chain));
    // testing 必须在后继里真的跑过（盘上 summary 可能仍是源 run 的）
    const ranTesting = fs.readFileSync(runFile(s.root, SNAPSHOT_FLAT_FEATURE, o.successor, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
      .some(line => { const e = JSON.parse(line) as { type?: string; phase?: string }; return e.type === 'harness_end' && e.phase === 'testing'; });
    assert(ranTesting, `后继未执行 testing：${brief(o.final)}`);
    const testing = readJson<{ verdict?: string }>(featureFilePath(s.root, SNAPSHOT_FLAT_FEATURE, 'testing/reports/summary.json'));
    const failed = readJson<{ checks: Array<{ id: string; status: string; details?: string }> }>(featureFilePath(s.root, SNAPSHOT_FLAT_FEATURE, 'testing/reports/script-report.json')).checks.filter(c => c.status === 'FAIL');
    console.log(`[lifecycle-evolution] L4 testing verdict=${testing.verdict} complete=${o.final.complete} failed=${JSON.stringify(failed.map(c => c.id))} ${brief(o.final).slice(0, 600)}`);
    // AC-9 无对应设备用例：testing 若判 PASS 且 feature complete，即为假 PASS。
    assert(!(testing.verdict === 'PASS' && o.final.complete), `AC-9 无设备证据却完成：${brief(o.final)}`);
    // 锁到具体覆盖缺口：不让无关失败替反例过关
    assert(failed.some(c => c.id === 'acceptance_to_test_case' && (c.details ?? '').includes('AC-9')), `testing 未因 AC-9 无设备用例判 FAIL：${JSON.stringify(failed.map(c => [c.id, (c.details ?? '').slice(0, 200)]))}`);
  }) },

  { name: 'L5 #9 证据损坏：删 ut 的 phase-evidence-manifest.json → 后继链 [ut] → 跑完 → 新完成结论', run: () => withHost(async s => {
    const o = await evolve(s, { feature: SNAPSHOT_FLAT_FEATURE, change: (_s, p) => fs.rmSync(featureFilePath(p.root, p.feature, 'ut/reports/phase-evidence-manifest.json')) });
    assertCompleted(s, SNAPSHOT_FLAT_FEATURE, o);
  }) },

  { name: 'L6 #10 晚于凭证的未终局 run（生产 createGoalRun、无 run_end）→ blocking 非空、complete=false、不路由阶段', run: () => withSnapshot(s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    const scope = loadFrozenExecutionScope(s.root, feature, source)!;
    const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-1a7e00`;
    const manifest = buildGoalManifestFromInput({
      feature, run_id: runId, adapter: 'codex', requirement: 'later run', unattended: { write_mode: 'full-access', approval_mode: 'never' },
      execution_scope: scope, chain_override: scope.phase_chain,
    }, { projectRoot: s.root });
    createGoalRun({ projectRoot: s.root, manifest, chain: scope.phase_chain, resolveHead: () => '0'.repeat(40) });
    const a = assess(s, feature);
    assert.strictEqual(a.record.state, 'ok', brief(a));
    assert(a.blocking.some(b => b.includes(runId)), brief(a));
    assert(a.obligations.every(o => o.status === 'covered'), `晚到 run 不应摊成义务缺口：${brief(a)}`);
    assert.strictEqual(a.complete, false);
  }) },

  { name: 'L7 #11 在途 CU 绑旧蓝图、新规则下不过准入：解析器仍抛 change_unit_invalid；已完成 CU 记录 ok、uncovered 如实', run: () => withSnapshot(s => {
    const inflight = enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID).filter(u => u.changeUnit.change_unit_id !== 'ledger-refresh');
    assert(inflight.length > 0, '快照缺在途 CU');
    const resolveAll = (): string[] => inflight.map(u => {
      const cu = u.changeUnit;
      try {
        resolveChangeUnitRef(s.root, { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: u.artifactSha256 });
        return `${cu.change_unit_id}:resolved`;
      } catch (e) { return `${cu.change_unit_id}:${(e as { code?: string }).code ?? (e as Error).message}`; }
    });
    assert(resolveAll().every(c => c.endsWith(':resolved')), `前提：规则追溯前在途 CU 可解析：${JSON.stringify(resolveAll())}`);
    const file = componentBlueprintPath(s.root, BLUEPRINT_ID);
    const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
    const node = dropFirstDevelopmentModule(bp);
    fs.writeFileSync(file, YAML.stringify(bp));
    clearFrameworkConfigCache();
    const codes = resolveAll();
    console.log(`[lifecycle-evolution] L7 dropped module of node ${node}; resolve=${JSON.stringify(codes)}`);
    assert(codes.every(c => c.endsWith(':change_unit_invalid')), `解析器应仍拒绝：${JSON.stringify(codes)}`);
    const a = assess(s, SNAPSHOT_CU_FEATURE);
    console.log(`[lifecycle-evolution] L7 completed CU record=${a.record.state} uncovered=${JSON.stringify(a.obligations.filter(o => o.status === 'uncovered').map(o => `${o.id}@${o.owner_phase}/${o.class}`))}`);
    assert.strictEqual(a.record.state, 'ok', `记录不得因规则追溯而 broken：${brief(a)}`);
  }) },

  { name: 'L8 #12 旧 CU 带 revises：可读、不报 schema 错；assess 与 reconcile 行为不变', run: () => withSnapshot(s => {
    const target = enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID).find(u => u.changeUnit.change_unit_id !== 'ledger-refresh')!;
    const cu = target.changeUnit;
    const revises = { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: target.artifactSha256 };
    const withRevises = { ...YAML.parse(fs.readFileSync(target.canonicalPath, 'utf8')), revises };
    fs.writeFileSync(target.canonicalPath, YAML.stringify(withRevises));
    clearFrameworkConfigCache();
    const loaded = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, String(cu.change_unit_id));
    assert.deepStrictEqual(loaded.changeUnit.revises, revises);
    const blockers = validateChangeUnit(loaded.changeUnit, { projectRoot: s.root, canonicalPath: loaded.canonicalPath }).filter(i => i.severity === 'BLOCKER');
    assert.deepStrictEqual(blockers, [], JSON.stringify(blockers));
    assert.strictEqual(assess(s, SNAPSHOT_CU_FEATURE).complete, true, 'revises 不得影响已完成 CU 的评估');
    const idle = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert.deepStrictEqual(idle, { bumped: [], skipped: [] }, JSON.stringify(idle));
    bumpBlueprint(s);
    const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert(r.bumped.some(b => b.change_unit_id === cu.change_unit_id) && !r.skipped.length, `带 revises 的 CU 应与其它 CU 同样原位升版：${JSON.stringify(r)}`);
    assert.deepStrictEqual(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, String(cu.change_unit_id)).changeUnit.revises, revises, 'revises 原样保留');
  }) },

  { name: 'L9 ★3 伪造记录：手改 completion 原件 phases[].run_id → record broken；successor 出生 reused_phases 为空、不新建 CU', run: () => withHost(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const [source] = runIds(s.root, feature);
    const projectionFile = featureFilePath(s.root, feature, 'feature-completion.json');
    const projection = readJson<Record<string, unknown> & { original_path: string }>(projectionFile);
    const original = readJson<{ phases: Array<{ run_id: string }> }>(path.join(s.root, projection.original_path));
    original.phases[1].run_id = '20260101T000000Z-f0f0f0';
    const text = JSON.stringify(original, null, 2) + '\n';
    fs.writeFileSync(path.join(s.root, projection.original_path), text);
    fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, original_sha256: crypto.createHash('sha256').update(text, 'utf-8').digest('hex') }));
    freezeAndTransfer(s, feature, source);
    commit(s, 'forged completion');
    assert.strictEqual(assess(s, feature).record.state, 'broken');
    const dirs = blueprintDirs(s);
    const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
    clearFrameworkConfigCache();
    const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement, source)!;
    // 记录不可信时 assess 不把它摊成义务缺口（★3「不进 uncovered」），出生链因此不等于 assess 的 uncovered 集合：
    // 出生解析器不从不可信记录取复用证据，链 = 本次范围全部 required 义务的责任阶段。
    const pre = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot, scope: born });
    assert.strictEqual(pre.record.state, 'broken');
    assert.deepStrictEqual(uncoveredOwnerPhases(pre), [], '不可信记录不得摊成义务缺口');
    const expected = ['spec', 'plan', 'coding', 'review', 'ut', 'testing']
      .filter(phase => born.obligations.some(o => o.owner_phase === phase && o.applicability === 'required' && !o.satisfied_by?.length));
    const { successor, error } = await supersede(s, feature, source, expected);
    assert(successor, `后继未出生：${error}`);
    const scope = successorScope(s, feature, successor!);
    assert.deepStrictEqual(scope.phase_chain, expected, '出生链应 = 本次范围中无满足依据的 required 义务的责任阶段');
    console.log(`[lifecycle-evolution] L9 chain=${JSON.stringify(scope.phase_chain)} reused=${JSON.stringify(scope.reused_phases)}`);
    assert.deepStrictEqual(scope.reused_phases, [], '不可信记录不得作复用证据');
    assert(!scope.obligations.some(o => o.satisfied_by?.some(ref => 'evidence_manifest_aggregate' in ref)), '义务不得引用旧阶段证据');
    assert.deepStrictEqual(blueprintDirs(s), dirs, '出现了新 CU 目录');
  }) },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      await c.run();
      results.push({ name: `lifecycle-evolution: ${c.name}`, ok: true });
    } catch (err) {
      results.push({ name: `lifecycle-evolution: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
    console.log(`[lifecycle-evolution] ${c.name.split(' ')[0]} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return results;
}
