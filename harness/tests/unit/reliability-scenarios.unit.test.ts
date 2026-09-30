// ============================================================================
// reliability-scenarios.unit.test.ts — plan 1dbe4fa4 t2（§4）：十三个事故场景的确定性重放（release-only）
// ----------------------------------------------------------------------------
// 每个场景取自一次真实事故，复用既有真实链路 / 运行时链 / 子进程 / 函数级 helper 搭建；场景期望、前提、
// 驱动层、覆盖说明与基线实测登记在 `fixtures/reliability-scenarios/registry.json`（baseline 是报告，不是断言对象）。
//
// 口径（plan §4.2 / §4.3）：
//  · 三类事实、停止状态、候选、恢复成本、无影响阶段重跑一律取 t1 采集器 `collectReliability` 的输出；
//  · 独立验收由场景自己写，直接查产品源码或产物内容，不读框架的结论字段，作为入参交给采集器；
//  · 测试代码发出的 resume / supersede / 手工改文件，都作为操作者动作经观察记录形状交给采集器，不隐去；
//  · 扰动必须命中目标分支（每个分支都断言命中证据，没命中就不是这个场景）；
//  · 断言三种：`baseline_met`（基线已满足期望 → 断言期望）、`correct_stop`（期望本身是正确失败 / 暂停 / 交还
//    → 断言期望）、`gap_only`（基线未达期望 → 只打印差距，由修复它的 plan 补行为断言）。
//
// 设置环境变量 RELIABILITY_RESULTS_OUT 时把每个分支的实测（采集器 TaskReport + 场景元信息）写到该路径，
// 供 `node scripts/reliability-metrics.mjs --scenario-results <文件>` 出表；未设置时不写任何文件。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import type { UnitCaseResult } from '../run-unit';
import {
  collectReliability,
  deriveConclusion,
  type AcceptanceFact,
  type FunctionLevelPrediction,
  type Intervention,
  type ObservationTask,
  type StopState,
  type TaskReport,
  type UnaffectedSpec,
} from '../utils/reliability-metrics';
import { loadEventsJsonl } from '../../scripts/utils/goal-runner-phase';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { __testing_setCanaryProbeInvoke } from '../../scripts/goal-runner';
import { spawnSync } from 'child_process';
import { FEATURE_LOCK_NAME, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { FINALIZE_RESERVE_MS, resolveWallClockMs } from '../../scripts/utils/goal-timeout';
import { createCodexTerminalScanner } from '../../scripts/utils/codex-terminal-events';
import { AttendedGoalPhaseExecutor } from '../../scripts/utils/goal-phase-executor';
import { readScopeAcceptance } from '../../scripts/utils/feature-track';
import { loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import type { CheckResult } from '../../scripts/utils/types';
import {
  FEATURE as RT_FEATURE,
  PRODUCT_FILE as RT_PRODUCT_FILE,
  PRODUCT_ASSERTION_CHECK,
  GOAL_QUOTE,
  requestVia,
  declineFromPrompt,
  runGoalRuntimeChain,
  runRealVisualGate,
  setupGoalRuntimeHost,
  writeCleanTesting,
  writeFile as rtWriteFile,
} from './goal-runner-testing-integrity.unit.test';
import {
  REAL_CHAIN_NEW_SOURCE,
  REAL_CHAIN_REQUIREMENT,
  REAL_CHAIN_SOURCE,
  git,
  prepareRealChainScopeCandidate,
  writeHostFile,
  type RealChainProject,
} from '../utils/real-chain-host';
import {
  CU_SOURCE,
  CU_TEST,
  publishVerifier,
  writeCodingMaterials,
  writePlanMaterials,
  writeReviewMaterials,
  writeSpecMaterials,
  writeTestPlan,
  writeUtMaterials,
} from './real-chain.unit.test';
import { codingBacktrackRequested, withProject } from './real-chain-seams.unit.test';
import {
  BLUEPRINT_ID,
  assess,
  bumpAndReconcile,
  bumpBlueprint,
  commit,
  evolve,
  freshness,
  handWrittenCompletion,
  project as snapshotProject,
  specFirstCuHooks,
  successorChain,
  withHost,
  withSnapshot,
} from './lifecycle-evolution.unit.test';
import { changeProjectedAcceptance, freezeAndTransfer, NEW_EXPECTED_RESULT, runIds as snapshotRunIds, supersede } from './successor-exit.unit.test';
import { SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { changeUnconsumedBlueprintContent } from './phase-evidence-manifest.unit.test';
import { SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { A2_DONE, A2_EXCLUDED, A2_QUOTE, a2Collect, a2NfcDefect, withA2Runtime } from './goal-runner-repair-convergence.unit.test';
import { runDriver, sealLegacyInvokes } from './goal-park-resume.unit.test';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { setupMinimalHost, type GoalRunOutcome } from '../helpers/goal-run-driver';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const REGISTRY_PATH = path.join(__dirname, '..', 'fixtures', 'reliability-scenarios', 'registry.json');
const DEBUG = process.env.RELIABILITY_SCENARIOS_DEBUG === '1';

// ---------------------------------------------------------------------------
// 登记表
// ---------------------------------------------------------------------------

type AssertionPolicy = 'baseline_met' | 'correct_stop' | 'gap_only';

interface RegistryBranch {
  key: string;
  label: string;
  premise: string;
  recoverable_fault: boolean;
  unaffected_phases: string[];
  expected: string;
  assertion: AssertionPolicy;
  driver_layer?: string;
  coverage_note?: string;
  baseline: unknown;
}

interface RegistryEntry {
  id: string;
  title: string;
  source_incident: string;
  premise: string;
  driver_layer: string;
  coverage_note: string;
  unaffected_phases: string[];
  expected: string;
  branches: RegistryBranch[];
}

function loadRegistry(): Map<string, RegistryEntry> {
  const doc = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as { scenarios: RegistryEntry[] };
  return new Map(doc.scenarios.map(s => [s.id, s]));
}

// ---------------------------------------------------------------------------
// 场景驱动的共同形状
// ---------------------------------------------------------------------------

type Ev = Record<string, unknown>;

type Expectation = { met: boolean; detail: string };

interface BranchCommon {
  key: string;
  /** 扰动命中目标分支的证据（每个分支必断言）。 */
  hit: { ok: boolean; evidence: string };
  /** 额外说明（不进三类事实，只随结果文件输出）。 */
  extras?: Record<string, unknown>;
}

/** 执行了任务的分支：交给采集器的全部输入（驱动层负责造，collectBranch 负责求事实）。 */
interface TaskBranchInput extends BranchCommon {
  root: string;
  feature: string;
  frameworkRoot: string;
  runIds: string[];
  /** 显式数组（空 = 明确零次）；采集器把缺字段当作“动作未知”。 */
  interventions: Intervention[];
  acceptance: AcceptanceFact;
  /** 扰动点（无影响阶段精确计数的起点）；缺省 = 用采集器的代理值。 */
  after?: UnaffectedSpec['after'];
  /** 多个分支共用同一任务（同一工程同一组 run）时的任务标签。 */
  taskLabel?: string;
  /** 场景期望是否达成（在采集器事实之上判；只有断言策略允许时才断言）。 */
  expectation: (t: TaskReport) => Expectation;
}

/** 函数级分支：没有执行扰动后的任务，只有预判；不进任务、不进任何指标。 */
interface PredictionBranchInput extends BranchCommon {
  prediction: Pick<FunctionLevelPrediction, 'predicted_chain' | 'executed_phases' | 'predicted_reruns' | 'note'> & Record<string, unknown>;
  expectation: () => Expectation;
}

type BranchInput = TaskBranchInput | PredictionBranchInput;

interface BranchOutcome {
  id: string;
  key: string;
  label: string;
  task?: TaskReport;
  prediction?: FunctionLevelPrediction;
  hit: BranchInput['hit'];
  expectation: { met: boolean; detail: string };
  policy: AssertionPolicy;
  extras: Record<string, unknown>;
  /** 同一工程同一组 run = 同一任务（结果文件按它汇总）。 */
  taskKey?: string;
  /** 驱动层（分支级优先，否则场景级）。 */
  layer?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function runsDirOf(root: string, feature: string): string {
  return featureFilePath(root, feature, 'goal-runs');
}

function listRuns(root: string, feature: string): string[] {
  const dir = runsDirOf(root, feature);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => !n.startsWith('.')).sort() : [];
}

/** 与采集器同一口径（loadEventsJsonl 的 0 基下标 = event_index）。 */
function eventsOf(root: string, feature: string, runId: string): Ev[] {
  return loadEventsJsonl(path.join(runsDirOf(root, feature), runId, 'events.jsonl')) as Ev[];
}

function indexOf(events: Ev[], pred: (e: Ev) => boolean): number {
  return events.findIndex(pred);
}

function readText(root: string, rel: string): string {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
}

/** 产品源码（src/main/ets 下全部 .ets）拼接——独立断言只看产品本身。 */
function productSources(root: string, moduleRoot: string): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith('.ets')) out.push(fs.readFileSync(abs, 'utf-8'));
    }
  };
  walk(path.join(root, moduleRoot, 'src', 'main', 'ets'));
  return out.join('\n');
}

function collectBranch(entry: RegistryEntry, branch: RegistryBranch, b: TaskBranchInput): TaskReport {
  const unaffected: UnaffectedSpec | undefined = b.after && branch.unaffected_phases.length > 0
    ? { phases: branch.unaffected_phases, after: b.after }
    : undefined;
  const obs: ObservationTask = {
    label: b.taskLabel ?? `${entry.id}/${branch.key}`,
    scenarios: [entry.id],
    feature: b.feature,
    runs: b.runIds,
    interventions: b.interventions,
    independent_acceptance: b.acceptance,
    source: 'reliability-scenarios 确定性层：测试驱动如实补写（测试代码发出的命令与改动全部计为操作者动作）',
    recoverable_fault: branch.recoverable_fault,
    ...(unaffected ? { unaffected } : {}),
  };
  clearFrameworkConfigCache();
  const report = collectReliability({
    projectRoot: b.root, feature: b.feature, frameworkRoot: b.frameworkRoot, runIds: b.runIds,
    observations: [{ label: 'reliability-scenarios', tasks: [obs] }],
  });
  clearFrameworkConfigCache();
  assert(report.tasks.length === 1, `${entry.id}/${branch.key}：采集器应恰好给出一个任务，实得 ${report.tasks.length}`);
  return report.tasks[0];
}

type ScenarioRunner = (entry: RegistryEntry, done: (b: BranchInput) => void) => Promise<void>;

/** 驱动层在工程清理之前逐分支调 done(b)；这里立即求事实并记下结果。 */
function makeCollector(entry: RegistryEntry, outcomes: BranchOutcome[]): (b: BranchInput) => void {
  return (b) => {
    const branch = entry.branches.find(x => x.key === b.key);
    assert(branch, `${entry.id}：登记表缺分支 ${b.key}`);
    const common = { id: entry.id, key: b.key, label: branch.label, hit: b.hit, policy: branch.assertion, extras: b.extras ?? {}, layer: branch.driver_layer ?? entry.driver_layer };
    if ('prediction' in b) {
      outcomes.push({ ...common, prediction: { id: entry.id, branch: b.key, label: branch.label, ...b.prediction }, expectation: b.expectation() });
      return;
    }
    const task = collectBranch(entry, branch, b);
    outcomes.push({ ...common, task, expectation: b.expectation(task), taskKey: `${b.root}|${b.runIds.join(',')}` });
  };
}

// ---------------------------------------------------------------------------
// 共用扰动素材（真实形状，出处见各处注释）
// ---------------------------------------------------------------------------

/** 宿主 0457a6 / be091c 的 400 原文（agent_invoke_end.terminal_error_excerpt）。 */
const MODEL_UNSUPPORTED = "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";

/**
 * codex `turn.failed` 信封：stdout 为 codex exec --json 原形，摘要经生产 scanner 求出（与宿主事件同形）。
 * 400 是 [真实·宿主] 形状；其它状态码是 [合成]——同一真实信封逐字不变、只换 status（批一 §4 的标注口径）。
 */
function codex400Invoke(status = 400): Record<string, unknown> {
  const inner = JSON.stringify({ type: 'error', status, error: { type: 'invalid_request_error', message: MODEL_UNSUPPORTED } });
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'error', message: inner }),
    JSON.stringify({ type: 'turn.failed', error: { message: inner } }),
  ].join('\n') + '\n';
  const scanner = createCodexTerminalScanner();
  scanner.push(stdout);
  scanner.flush();
  const st = scanner.state();
  assert(st.terminalFailureObserved && st.failureExcerpt, '400 夹具须经生产 scanner 判 turn.failed');
  return {
    exitCode: 1, stdout, stderr: '', command: 'fake-codex',
    terminal_failure_observed: true,
    terminal_error_excerpt: [`turn.failed: ${st.failureExcerpt}`, ...st.errorExcerpts.map(e => `error: ${e}`)].join(' | '),
  };
}

/**
 * claude 内核 stream-json 断流信封：2026-07-29 codeagent 断网实采原形（字符串 "500" 的 api_retry ×3 +
 * 重试耗尽的终局 result，见 goal-headless-guard.unit.test.ts c7a9e2f4 #7b）。codeagent 与 claude 同源同 writer。
 */
const TRANSIENT_OUTPUT_LOG = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: '00000000-0000-0000-0000-000000000000' }),
  '{"type":"system","subtype":"api_retry","error_status":"500","error":"server_error"}',
  '{"type":"system","subtype":"api_retry","error_status":"500","error":"server_error"}',
  '{"type":"system","subtype":"api_retry","error_status":"500","error":"server_error"}',
  JSON.stringify({
    type: 'result', subtype: 'success', is_error: true, duration_ms: 413183, duration_api_ms: 0, num_turns: 1,
    result: 'API Error: 500 Unable to connect. Is the computer able to access the url?【00000000-0000-0000-0000-000000000000】',
    stop_reason: 'stop_sequence', session_id: '00000000-0000-0000-0000-000000000000', total_cost_usd: 0,
  }),
  '',
].join('\n');

const PRODUCT_DONE_MARKER = 'Text("开卡完成")';

function rtProduct(root: string): string {
  return readText(root, RT_PRODUCT_FILE);
}

function rtRunEnd(events: Ev[]): Ev | undefined {
  return [...events].reverse().find(e => e.type === 'run_end');
}

// ---------------------------------------------------------------------------
// S1 模型永久不兼容（运行时链；金丝雀缝 + 正式调用 400）
// ---------------------------------------------------------------------------

/** codex 调用计划 argv 里的 --model（未钉 = adapter 默认型号）——判断依据是实际调用的型号。 */
function modelOfArgv(argv: readonly string[] | undefined): string {
  const a = argv ?? [];
  return a.includes('--model') ? a[a.indexOf('--model') + 1] : '(default)';
}

/** 与 S1 同一 UI 前提：spec 声明 UI 变化、本机没有金丝雀缓存（每次启动都会实测金丝雀）。 */
function uiHostWithoutCanaryCache(root: string, local: Record<string, unknown> = {}): void {
  rtWriteFile(root, `doc/features/${RT_FEATURE}/spec/spec.md`, ['# spec', '', '```yaml', 'ui_change: new_or_changed', '```', ''].join('\n'));
  const localAbs = path.join(root, 'framework.local.json');
  const cur = JSON.parse(fs.readFileSync(localAbs, 'utf-8')) as { vision?: Record<string, unknown> };
  delete cur.vision;
  fs.writeFileSync(localAbs, JSON.stringify({ ...cur, ...local }, null, 2));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'ui feature, no canary cache']);
}

const S1_REQUIREMENT = '银行卡开卡页面按参考图还原布局';
const RE_REQUEST = (content: string, related: Array<{ run_id: string; event_index: number }> = []): Intervention => ({
  kind: 'rescue_command', actor: 'reliability-scenarios（测试代码，模拟宿主重新发起同一请求）', necessary: true,
  content, related_events: related,
});
const writeDone = (ctx: { root: string }): void => rtWriteFile(ctx.root, RT_PRODUCT_FILE, `struct AllBanksPage { build() { ${PRODUCT_DONE_MARKER} } }`);
const productAcceptance = (root: string): AcceptanceFact => (rtProduct(root).includes(PRODUCT_DONE_MARKER)
  ? { result: 'pass', actor: 'reliability-scenarios', basis: `产品源码含 ${PRODUCT_DONE_MARKER}` }
  : { result: 'fail', actor: 'reliability-scenarios', basis: `产品源码不含 ${PRODUCT_DONE_MARKER}` });

const runS1: ScenarioRunner = async (_entry, done) => {
  // 分支一：无获准替代（金丝雀 400，未钉模型）→ 带明确理由交还；重发同一请求且什么都没变 → 不新建 run，同一原因再停。
  // 显式新型号分支：同一宿主、同一段历史里，宿主随后显式给出新型号重发同一请求 → 起后继、承接启动失败的 run（重演 be091c 第三现场，前台入口）。
  const { root } = setupGoalRuntimeHost('codex');
  try {
    uiHostWithoutCanaryCache(root);
    const canaryModels: string[] = [];
    const canary = (async (plan: { argv?: string[] }) => {
      const model = modelOfArgv(plan.argv);
      canaryModels.push(model);
      return model === 'gpt-5.5' ? { exitCode: 0, stdout: 'ok', stderr: '', command: 'fake-codex' } : codex400Invoke();
    }) as never;
    __testing_setCanaryProbeInvoke(canary);
    await requestVia('foreground', root, { freshRequirement: S1_REQUIREMENT, onCoding: writeDone });
    const [run] = listRuns(root, RT_FEATURE);
    assert(run, 'S1 无替代：须创建 run 目录');
    const eventsFirst = eventsOf(root, RT_FEATURE, run);
    const halt = eventsFirst.find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure');
    const endError = String(rtRunEnd(eventsFirst)?.error ?? '');
    const guidance = String(halt?.halt_guidance ?? '');
    __testing_setCanaryProbeInvoke(canary);
    const repeat = await requestVia('foreground', root, { freshRequirement: S1_REQUIREMENT, onCoding: writeDone });
    const eventsRepeat = eventsOf(root, RT_FEATURE, run);
    const canaryHalts = eventsRepeat.filter(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure').length;
    const runsAfterRepeat = listRuns(root, RT_FEATURE);
    done({
      key: 'canary-no-alternative', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [{ ...RE_REQUEST('重新发起同一请求（不带任何旗标，什么都没变）'), necessary: false }],
      acceptance: { result: 'fail', actor: 'reliability-scenarios', basis: '未交付：金丝雀阶段即停机，产品源码未变化（交还理由另由期望判定）' },
      hit: { ok: !!halt, evidence: halt ? `phase_halt canary_cli_hard_failure @${eventsFirst.indexOf(halt)}` : '未出现 canary_cli_hard_failure' },
      expectation: (t) => {
        const reasons = [
          !t.facts.claimed_complete || '宣称了完成',
          t.stop_state?.halt_reason === 'canary_cli_hard_failure' || `停机原因=${t.stop_state?.halt_reason}`,
          endError.includes(MODEL_UNSUPPORTED) || 'run_end 未带 400 原文',
          (guidance.includes('未换型号') && guidance.includes('approved_models')) || `说明未写明为何没换型号：${guidance.slice(-200)}`,
          t.runs.every(r => r.agent_invocations.total === 0) || '出现了正式调用',
          runsAfterRepeat.length === 1 || `重发同一请求新建了 run：${runsAfterRepeat.join(',')}`,
          canaryHalts === 2 || `重发后须由金丝雀这项原检查以同一原因再停一次，实得 ${canaryHalts} 次`,
          repeat.invokedPhases.length === 0 || `重发后出现了正式调用：${repeat.invokedPhases.join(',')}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : '未宣称完成；原文与"未配置获准替代"交还；重发同一请求不新建 run、以同一原因再停、零正式调用' };
      },
      extras: { run_end_error_head: endError.slice(0, 200), repeat_exit: repeat.exitCode },
    });

    __testing_setCanaryProbeInvoke(canary);
    const next = await requestVia('foreground', root, { freshRequirement: S1_REQUIREMENT, onCoding: writeDone, launchArgs: ['--adapter-model', 'gpt-5.5'] });
    const run2 = listRuns(root, RT_FEATURE).find(r => r !== run);
    const ev2 = run2 ? eventsOf(root, RT_FEATURE, run2) : [];
    const supersedeIdx = indexOf(ev2, e => e.type === 'supersede' && e.target_run_id === run);
    const m2 = run2 ? JSON.parse(fs.readFileSync(path.join(runsDirOf(root, RT_FEATURE), run2, 'manifest.json'), 'utf-8')) as { successor_of?: string; adapter_model_pin?: { value?: string } } : null;
    done({
      key: 'explicit-model-successor', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: run2 ? [run, run2] : [run],
      interventions: [
        { ...RE_REQUEST('重新发起同一请求（不带任何旗标，什么都没变）'), necessary: false },
        RE_REQUEST('重新发起同一请求并显式给新型号 --adapter-model gpt-5.5（未枚举 run，未带 --supersede/--resume/--force）',
          run2 ? [{ run_id: run2, event_index: 0 }] : []),
      ],
      acceptance: productAcceptance(root),
      after: halt ? { run_id: run, event_index: eventsFirst.indexOf(halt) } : undefined,
      hit: { ok: !!halt && !!run2, evidence: `run1 金丝雀 400；后继=${run2 ?? '无'}` },
      expectation: (t) => {
        const reasons = [
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
          m2?.successor_of === run || `后继须承接启动失败的 run：successor_of=${m2?.successor_of}`,
          m2?.adapter_model_pin?.value === 'gpt-5.5' || `后继须钉新型号：${JSON.stringify(m2?.adapter_model_pin)}`,
          supersedeIdx >= 0 || '承接须写审计事件',
          canaryModels.at(-1) === 'gpt-5.5' || `后继须以新型号过金丝雀：${canaryModels.join(',')}`,
          next.invokedPhases.includes('coding') || `后继须执行：${next.invokedPhases.join(',')}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `起后继 ${run2}（承接 ${run}，钉 gpt-5.5）并正确完成；操作者动作=${t.operator.rescue_count}（含 1 次不必要的重发），未枚举 run` };
      },
      extras: { successor: run2 ?? null, canary_models: canaryModels },
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const runS1Formal: ScenarioRunner = async (_entry, done) => {
  // 有获准替代（正式调用 400）：本机配置 adapters.codex.approved_models 给出 gpt-5.5，框架自动换型号继续，操作者动作 0。
  const { root } = setupGoalRuntimeHost('codex');
  try {
    const localAbs = path.join(root, 'framework.local.json');
    const local = JSON.parse(fs.readFileSync(localAbs, 'utf-8')) as Record<string, unknown>;
    fs.writeFileSync(localAbs, JSON.stringify({ ...local, adapters: { codex: { approved_models: ['gpt-5.5'] } } }, null, 2));
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'approved model alternatives']);
    const codingModels: string[] = [];
    let lastModel = '(default)';
    __testing_setCanaryProbeInvoke((async () => ({ exitCode: 0, stdout: 'ok', stderr: '', command: 'fake-codex' })) as never);
    await requestVia('foreground', root, {
      onCoding: (ctx) => {
        lastModel = /--model\n(\S+)/.exec(ctx.prompt)?.[1] ?? '(default)';
        codingModels.push(lastModel);
        if (lastModel === 'gpt-5.5') writeDone(ctx);
      },
      invokeResultFor: (phase) => (phase === 'coding' && lastModel !== 'gpt-5.5' ? codex400Invoke() : null),
    });
    const [run] = listRuns(root, RT_FEATURE);
    const events = eventsOf(root, RT_FEATURE, run);
    const sub = events.find(e => e.type === 'adapter_model_substituted');
    const subIdx = sub ? events.indexOf(sub) : -1;
    done({
      key: 'formal-with-alternative', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: productAcceptance(root),
      after: subIdx >= 0 ? { run_id: run, event_index: subIdx } : undefined,
      hit: { ok: codingModels[0] === '(default)' && !!sub, evidence: `coding 实际调用型号=${codingModels.join('→')}；替代事件=${sub ? `${String(sub.from)}→${String(sub.to)}@${subIdx}` : '无'}` },
      expectation: (t) => {
        const reasons = [
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
          t.operator.rescue_count === 0 || `操作者动作=${t.operator.rescue_count}`,
          codingModels.at(-1) === 'gpt-5.5' || `最后一次实际调用须是替代型号：${codingModels.join('→')}`,
          (sub?.to === 'gpt-5.5' && sub?.trigger === 'invoke') || `替代事件=${JSON.stringify(sub)}`,
          listRuns(root, RT_FEATURE).length === 1 || '不得新建 run',
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `同一 run 内自动换用 gpt-5.5 并正确完成，操作者动作 0；调用型号=${codingModels.join('→')}` };
      },
      extras: { coding_models: codingModels },
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** 回拨最近一段已结束会话：活跃时长 = consumedMs，run_end 早于现在 10 分钟（过冷却）。只动时间。 */
function backdateSession(root: string, runId: string, consumedMs: number): void {
  const p = path.join(runsDirOf(root, RT_FEATURE), runId, 'events.jsonl');
  const events = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Ev);
  const lastEnd = events.map(e => e.type).lastIndexOf('run_end');
  const lastStart = events.map(e => e.type).lastIndexOf('run_start');
  assert(lastEnd > lastStart && lastStart >= 0, '夹具：须是一个已结束的会话');
  const endMs = Date.now() - 10 * 60_000;
  events[lastStart].ts = new Date(endMs - consumedMs).toISOString();
  if (typeof events[lastStart].session_started_at === 'string') events[lastStart].session_started_at = events[lastStart].ts;
  events[lastEnd].ts = new Date(endMs).toISOString();
  fs.writeFileSync(p, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

const runS1Budget: ScenarioRunner = async (_entry, done) => {
  // 预算：剩余墙钟预算短于金丝雀固定时长 → 金丝雀按剩余额度结束；额度用尽后不再试下一个获准替代型号。
  const { root } = setupGoalRuntimeHost('codex');
  try {
    uiHostWithoutCanaryCache(root, { adapters: { codex: { approved_models: ['gpt-alt-1'] } } });
    __testing_setCanaryProbeInvoke((async () => ({ exitCode: 1, stdout: '', stderr: 'boom', command: 'fake-codex' })) as never);
    await requestVia('foreground', root, {
      freshRequirement: S1_REQUIREMENT, freshEndPhase: 'spec',
      invokeResultFor: () => ({ exitCode: 1, stdout: '', stderr: '', command: 'fake', spawn_error: { code: 'ENOENT', message: 'spawn ENOENT' } }),
    });
    const [run] = listRuns(root, RT_FEATURE);
    const first = eventsOf(root, RT_FEATURE, run);
    const firstHalt = first.find(e => e.type === 'phase_halt' && e.halt_reason === 'adapter_cli_hard_failure');
    const manifest = JSON.parse(fs.readFileSync(path.join(runsDirOf(root, RT_FEATURE), run, 'manifest.json'), 'utf-8')) as { phase_chain?: string[] };
    const leftMs = 12_000;
    backdateSession(root, run, resolveWallClockMs(manifest as never, manifest.phase_chain) - FINALIZE_RESERVE_MS - leftMs);
    const canaryTimeouts: number[] = [];
    __testing_setCanaryProbeInvoke((async (_plan: unknown, _root: unknown, opts: { timeoutMs?: number }) => {
      const t = Number(opts?.timeoutMs ?? 0);
      canaryTimeouts.push(t);
      await new Promise(r => setTimeout(r, Math.max(0, t) + 50));
      return codex400Invoke();
    }) as never);
    await requestVia('foreground', root, { freshRequirement: S1_REQUIREMENT, freshEndPhase: 'spec' });
    const events = eventsOf(root, RT_FEATURE, run);
    const halt = [...events].reverse().find(e => e.type === 'phase_halt' && e.halt_reason === 'canary_cli_hard_failure');
    const guidance = String(halt?.halt_guidance ?? '');
    // 重复请求（无人值守）：刚停下、什么都没变，无人脚本连续两次重发 → 保持停止，run 数与事件都不增加。
    const repeatExits: number[] = [];
    for (let i = 0; i < 2; i++) repeatExits.push((await requestVia('foreground', root, { freshRequirement: S1_REQUIREMENT, freshEndPhase: 'spec' })).exitCode);
    const eventsAfterRepeat = eventsOf(root, RT_FEATURE, run).length;
    done({
      key: 'budget', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [RE_REQUEST('重新发起同一请求（不带任何旗标）'), ...repeatExits.map(() => ({ ...RE_REQUEST('无人脚本重复同一请求（什么都没变）'), necessary: false }))],
      acceptance: { result: 'fail', actor: 'reliability-scenarios', basis: '未交付：预算已尽（交还是否正确由期望判定）' },
      hit: { ok: !!firstHalt && !!halt, evidence: `首段 adapter_cli_hard_failure=${!!firstHalt}；重新接入后金丝雀停机=${!!halt}` },
      expectation: (t) => {
        const reasons = [
          !t.facts.claimed_complete || '宣称了完成',
          canaryTimeouts.length === 1 || `预算尽后不得再试下一个型号：金丝雀调用 ${canaryTimeouts.length} 次`,
          (canaryTimeouts[0] > 0 && canaryTimeouts[0] <= leftMs) || `金丝雀允许时长须取剩余额度（≤${leftMs}ms）：${canaryTimeouts[0]}`,
          !events.some(e => e.type === 'adapter_model_substituted') || '预算尽后换了型号',
          guidance.includes('预算已尽') || `说明须写明预算已尽：${guidance.slice(-200)}`,
          listRuns(root, RT_FEATURE).length === 1 || '不得新建 run',
          (repeatExits.every(c => c === 1) && eventsAfterRepeat === events.length) || `无人脚本重复请求须保持停止且不写事件：exits=${repeatExits.join(',')} events ${events.length}→${eventsAfterRepeat}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `无人脚本两次重复请求保持停止；金丝雀按剩余额度 ${canaryTimeouts[0]}ms 结束、不再换型号、说明写明预算已尽` };
      },
      extras: { canary_timeouts: canaryTimeouts },
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const runBe091cOrphan: ScenarioRunner = async (_entry, done) => {
  // 重演 be091c 第一现场（detach 入口）：进程中断、feature 锁的持有进程已死；宿主重新发起同一请求（带 --detach，不带任何技术旗标）。
  const { root } = setupGoalRuntimeHost('codex');
  try {
    await requestVia('detach', root, { onCoding: () => { throw new Error('injected crash inside coding'); } }).catch(() => undefined);
    const [run] = listRuns(root, RT_FEATURE);
    const crashEnd = run ? indexOf(eventsOf(root, RT_FEATURE, run), e => e.type === 'run_end') : -1;
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    const lock = run ? tryAcquireLock(path.join(runsDirOf(root, RT_FEATURE), FEATURE_LOCK_NAME), {
      run_id: run, run_mode: 'authoritative', report_dir: `doc/features/${RT_FEATURE}/goal-runs/${run}`, pid: dead,
    }) : null;
    const again = await requestVia('detach', root, { onCoding: writeDone });
    done({
      key: 'be091c-orphan-lock', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: run ? [run] : [],
      interventions: [RE_REQUEST('重新发起同一请求（--detach，不带 --resume/--force；未枚举 run）')],
      acceptance: productAcceptance(root),
      after: crashEnd >= 0 ? { run_id: run, event_index: crashEnd } : undefined,
      hit: { ok: !!run && !!lock && crashEnd >= 0, evidence: `中断 run=${run}；已死进程的 feature 锁写下=${!!lock}` },
      expectation: (t) => {
        const args = again.childArgs ?? [];
        const reasons = [
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
          listRuns(root, RT_FEATURE).length === 1 || '孤儿 run 须被重新接入，不新建',
          !args.some(a => ['--resume', '--force', '--force-resume', '--supersede'].includes(a)) || `子进程 argv 带了技术旗标：${args.join(' ')}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `detach 重发同一请求即重新接入孤儿 run 并正确完成；操作者动作=${t.operator.rescue_count}` };
      },
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/**
 * be091c 第二现场的独立验收：只看该任务的独立预期与产物——被扰动删掉的 UT 阶段证据重新产出、UT 结果为 PASS（测试侧 harness 桩写下）。
 * 不读 run_end.status 等框架的完成宣称；第三个参数只为自检锁定这一点（改变它，独立验收不得变）。
 */
export function beScopeAcceptance(root: string, feature: string, _frameworkClaim?: { status?: string }): AcceptanceFact {
  const evidence = readText(root, `doc/features/${feature}/ut/reports/phase-evidence-manifest.json`) !== '';
  const utPass = (() => {
    try { return (JSON.parse(readText(root, `doc/features/${feature}/ut/reports/summary.json`) || '{}') as { verdict?: string }).verdict === 'PASS'; } catch { return false; }
  })();
  return evidence && utPass
    ? { result: 'pass', actor: 'reliability-scenarios', basis: 'UT 阶段证据重新产出、UT 结果 PASS（产物，不读框架完成宣称）' }
    : { result: 'fail', actor: 'reliability-scenarios', basis: `UT 证据在=${evidence}，UT 结果 PASS=${utPass}` };
}

const runBe091cScope: ScenarioRunner = async (_entry, done) => {
  // 重演 be091c 第二现场（有人在场入口）：feature 范围已转交给一个中断的后继；宿主重新发起同一请求（prepare-run + 附着）。
  await withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = snapshotRunIds(s.root, feature);
    freezeAndTransfer(s, feature, source);
    fs.rmSync(featureFilePath(s.root, feature, 'ut/reports/phase-evidence-manifest.json'));
    const requirement = (JSON.parse(fs.readFileSync(path.join(runsDirOf(s.root, feature), source, 'manifest.json'), 'utf-8')) as { requirement: string }).requirement;
    const { successor: holder } = await supersede(s, feature, source, ['ut'], {
      failExecutorFor: () => false, onUt: () => { throw new Error('injected crash inside ut'); },
    });
    assert(holder, 'be091c 第二现场：夹具须先有一个接管了范围、随后中断的后继');
    // 测试桩代际补丁：假 agent 不落 Job 绑定事件（与驱动 resume 路径同一个），不是对故障的预修。
    sealLegacyInvokes(s.root, feature, holder!);
    const again = await requestVia('attended', s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: requirement, freshStartPhase: 'ut', freshEndPhase: 'ut',
    });
    clearFrameworkConfigCache();
    const endStatus = String(rtRunEnd(eventsOf(s.root, feature, holder!))?.status ?? '');
    done({
      key: 'be091c-scope-transfer', root: s.root, feature, frameworkRoot: s.frameworkRoot, runIds: [holder!],
      interventions: [
        { kind: 'manual_file_edit', actor: 'reliability-scenarios sealLegacyInvokes（测试代码）', necessary: true,
          content: '附着前向 events.jsonl 追补一对闭合 agent_process_bound/settled（测试桩代际补丁：桩调用不落绑定事件）' },
        RE_REQUEST('有人在场入口重新发起同一请求（prepare-run + 附着；未枚举 run、未带技术旗标）'),
      ],
      acceptance: beScopeAcceptance(s.root, feature, { status: endStatus }),
      hit: { ok: !!holder, evidence: `范围已转交给中断的后继 ${holder}` },
      expectation: (t) => {
        const reasons = [
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
          /COMPLETED/.test(endStatus) || `持有者须完成：${endStatus}`,
          snapshotRunIds(s.root, feature).length === 2 || `不得新建 run：${snapshotRunIds(s.root, feature).join(',')}`,
          again.invokedPhases.includes('ut') || `重新接入后须执行 ut：${again.invokedPhases.join(',')}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `有人在场重发同一请求即重新接入持有范围的中断后继并完成；操作者动作=${t.operator.rescue_count}（其中 1 次为测试桩代际补丁）` };
      },
    });
  });
};

// ---------------------------------------------------------------------------
// S2 瞬时 API 失败（运行时链；claude 内核真实断流信封）
// ---------------------------------------------------------------------------

const runS2: ScenarioRunner = async (_entry, done) => {
  const { root } = setupGoalRuntimeHost('claude');
  try {
    // claude 的入口文件是 CLAUDE.md（agents/claude/adapter.yaml）；宿主夹具只写了 AGENTS.md。
    rtWriteFile(root, 'CLAUDE.md', '# CLAUDE\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'claude entry']);
    await runGoalRuntimeChain(root, {
      adapter: 'claude',
      onCoding: (ctx) => {
        if (ctx.attempt === 1) {
          fs.mkdirSync(path.dirname(ctx.outputLogPath), { recursive: true });
          fs.writeFileSync(ctx.outputLogPath, TRANSIENT_OUTPUT_LOG, 'utf-8');
        } else {
          rtWriteFile(ctx.root, RT_PRODUCT_FILE, `struct AllBanksPage { build() { ${PRODUCT_DONE_MARKER} } }`);
        }
      },
      invokeResultFor: (phase, n) => (phase === 'coding' && n === 1 ? { exitCode: 1, stdout: '', stderr: '' } : null),
      // 断流那一轮 agent 没写完产物，gate 如实判缺（真实 writer 落 FAIL）。
      onHarnessSummary: ({ phase, attempt }) => (phase === 'coding' && attempt === 1 ? {
        checks: [{
          id: 'file_completeness', category: 'structure', description: 'contracts.files 须在盘且被实现',
          severity: 'BLOCKER', status: 'FAIL', details: `${RT_PRODUCT_FILE} 未实现开卡完成态（agent 中途断流）`,
          affected_files: [RT_PRODUCT_FILE],
        } as CheckResult],
      } : null),
    });
    const [run] = listRuns(root, RT_FEATURE);
    const events = eventsOf(root, RT_FEATURE, run);
    const retryIdx = indexOf(events, e => e.type === 'transient_api_retry_scheduled');
    done({
      key: 'transient', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: rtProduct(root).includes(PRODUCT_DONE_MARKER)
        ? { result: 'pass', actor: 'reliability-scenarios', basis: `产品源码含 ${PRODUCT_DONE_MARKER}` }
        : { result: 'fail', actor: 'reliability-scenarios', basis: `产品源码不含 ${PRODUCT_DONE_MARKER}` },
      after: retryIdx >= 0 ? { run_id: run, event_index: retryIdx } : undefined,
      hit: { ok: retryIdx >= 0, evidence: retryIdx >= 0 ? `transient_api_retry_scheduled @${retryIdx}` : '未命中瞬时重试分支' },
      expectation: (t) => ({
        met: t.conclusion === 'correct_completion' && t.operator.rescue_count === 0 && t.unaffected_reruns.exact === 0,
        detail: `结论=${t.conclusion}，操作者动作=${t.operator.rescue_count}，无影响重跑=${t.unaffected_reruns.exact}`,
      }),
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** S2 codex 支：coding 首轮终态 429（[合成]：宿主真实 400 信封只换 status）→ 瞬时重试 → 恢复。 */
const runS2Codex: ScenarioRunner = async (_entry, done) => {
  const { root } = setupGoalRuntimeHost('codex');
  try {
    await requestVia('foreground', root, {
      onCoding: (ctx) => { if (ctx.attempt > 1) writeDone(ctx); },
      invokeResultFor: (phase, n) => (phase === 'coding' && n === 1 ? codex400Invoke(429) : null),
      onHarnessSummary: ({ phase, attempt }) => (phase === 'coding' && attempt === 1 ? {
        checks: [{
          id: 'file_completeness', category: 'structure', description: 'contracts.files 须在盘且被实现',
          severity: 'BLOCKER', status: 'FAIL', details: `${RT_PRODUCT_FILE} 未实现开卡完成态（codex 终态 429）`,
          affected_files: [RT_PRODUCT_FILE],
        } as CheckResult],
      } : null),
    });
    const [run] = listRuns(root, RT_FEATURE);
    const events = eventsOf(root, RT_FEATURE, run);
    const retryIdx = indexOf(events, e => e.type === 'transient_api_retry_scheduled');
    done({
      key: 'codex-synthetic-429', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: productAcceptance(root),
      after: retryIdx >= 0 ? { run_id: run, event_index: retryIdx } : undefined,
      hit: { ok: retryIdx >= 0, evidence: retryIdx >= 0 ? `[合成] codex 429 → transient_api_retry_scheduled @${retryIdx}` : '未命中瞬时重试分支' },
      expectation: (t) => ({
        met: t.conclusion === 'correct_completion' && t.operator.rescue_count === 0 && t.unaffected_reruns.exact === 0,
        detail: `[合成] 结论=${t.conclusion}，操作者动作=${t.operator.rescue_count}，无影响重跑=${t.unaffected_reruns.exact}`,
      }),
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// S3 完成后蓝图升版（真实链路：lifecycle evolve）+ S10 新格式（同一宿主，函数级）
// ---------------------------------------------------------------------------

/** 纯身份漂移（改本 CU 未消费的蓝图内容）→ 调和原位升版后的函数级事实。 */
function identityDriftFacts(
  s: Parameters<typeof freshness>[0], feature: string, source: string, executed: string[], bump: () => void,
): { chain: string[]; freshness: string[]; productUnchanged: boolean; reconciled: boolean; completeAfterDrift: boolean } {
  const product = [CU_SOURCE, CU_TEST].map(rel => readText(s.root, rel));
  let reconciled = true;
  try { bump(); } catch (e) { reconciled = false; if (DEBUG) console.log('[reliability-scenarios] identity bump', (e as Error).message); }
  const chain = successorChain(s, feature, source);
  return {
    chain, freshness: freshness(s, feature, executed),
    productUnchanged: [CU_SOURCE, CU_TEST].every((rel, i) => readText(s.root, rel) === product[i]),
    reconciled,
    completeAfterDrift: assess(s, feature).complete,
  };
}

let s10Entry: RegistryEntry | undefined;
let s10Outcomes: BranchOutcome[] | undefined;

const runS3: ScenarioRunner = async (_entry, done) => {
  await withHost(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const p = snapshotProject(s, feature);
    const o = await evolve(s, {
      feature,
      change: () => {
        bumpBlueprint(s, changeProjectedAcceptance);
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
      },
    });
    const events = eventsOf(s.root, feature, o.successor);
    const supersedeIdx = indexOf(events, e => e.type === 'supersede');
    const acceptanceDoc = YAML.parse(readText(s.root, path.relative(s.root, featureFilePath(s.root, feature, 'acceptance.yaml')))) as { criteria?: Array<{ id: string; expected_result?: string }> } | null;
    const cu = readText(s.root, CU_SOURCE);
    const ok = cu.includes('add(') && cu.includes('restore(') && readText(s.root, CU_TEST).includes('[AC-1]')
      && acceptanceDoc?.criteria?.find(c => c.id === 'AC-1')?.expected_result === NEW_EXPECTED_RESULT;
    done({
      key: 'blueprint-bump', root: s.root, feature, frameworkRoot: s.frameworkRoot, runIds: [o.successor],
      interventions: [
        {
          kind: 'product_decision', actor: 'reliability-scenarios（测试代码，宿主改动替身）',
          content: `蓝图 ${BLUEPRINT_ID} 升版并改投影验收内容，生产调和原位升版 CU 指针并提交`,
        },
        {
          kind: 'rescue_command', actor: 'reliability-scenarios（测试代码）', necessary: true,
          content: `goal-runner --supersede ${o.source}（起后继；按任务书口径计入操作者动作）`,
          related_events: supersedeIdx >= 0 ? [{ run_id: o.successor, event_index: supersedeIdx }] : [],
        },
      ],
      acceptance: ok
        ? { result: 'pass', actor: 'reliability-scenarios', basis: 'CU 源码实现 add/restore、UT 含 [AC-1]、盘上验收为新文本' }
        : { result: 'fail', actor: 'reliability-scenarios', basis: 'CU 源码 / UT / 盘上验收新文本任一不符' },
      // 扰动点取后继首个 run_start（run_created 不在 authoritative 时间线里，采集器找不到它）。
      after: { run_id: o.successor, event_index: indexOf(events, e => e.type === 'run_start') },
      hit: { ok: supersedeIdx >= 0 && o.chain.length > 0, evidence: `后继 ${o.successor} chain=${JSON.stringify(o.chain)} supersede@${supersedeIdx}` },
      expectation: (t) => ({
        met: t.conclusion === 'correct_completion' && t.unaffected_reruns.exact === 0,
        detail: `结论=${t.conclusion}，出生链=${JSON.stringify(o.chain)}，无影响阶段重跑=${t.unaffected_reruns.exact}`,
      }),
      extras: { successor_chain: o.chain, reused_phases: o.reused, source_run: o.source },
    });
    // S10 新格式：上面的后继已由当前代码写出新格式记录——再做一次纯身份升版（函数级）。
    if (s10Entry && s10Outcomes) {
      const collect10 = makeCollector(s10Entry, s10Outcomes);
      const facts = identityDriftFacts(s, feature, o.successor, o.chain,
        () => bumpAndReconcile(s, changeUnconsumedBlueprintContent, 'blueprint: unconsumed wording'));
      const reruns = facts.chain.filter(ph => o.chain.includes(ph)).length;
      collect10({
        key: 'new-format',
        prediction: {
          predicted_chain: facts.chain, executed_phases: o.chain, predicted_reruns: reruns,
          note: `函数级预判，未执行任务：出生链由 resolveSuccessorExecutionScope 预判；升版后完成结论=${facts.completeAfterDrift}；产品字节不变=${facts.productUnchanged}`,
          freshness: facts.freshness, complete_after_drift: facts.completeAfterDrift, product_unchanged: facts.productUnchanged,
        },
        hit: { ok: facts.reconciled, evidence: `纯身份升版调和=${facts.reconciled}；freshness=${JSON.stringify(facts.freshness)}` },
        expectation: () => ({
          met: reruns === 0 && facts.completeAfterDrift,
          detail: `预判出生链=${JSON.stringify(facts.chain)}，预判重跑已执行阶段 ${reruns} 个（预判，未执行任务），升版后完成结论=${facts.completeAfterDrift}`,
        }),
      });
    }
    void p;
  });
};

// ---------------------------------------------------------------------------
// S10 旧快照（函数级）；新格式分支由 S3 的同一宿主给出
// ---------------------------------------------------------------------------

const runS10: ScenarioRunner = async (_entry, done) => {
  await withSnapshot(s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const [source] = snapshotRunIds(s.root, feature);
    const manifest = JSON.parse(fs.readFileSync(path.join(runsDirOf(s.root, feature), source, 'manifest.json'), 'utf-8')) as { execution_scope?: { phase_chain?: string[] } };
    const executed = (manifest.execution_scope?.phase_chain ?? []).map(String);
    const facts = identityDriftFacts(s, feature, source, executed, () => {
      bumpBlueprint(s, changeUnconsumedBlueprintContent);
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
    });
    const reruns = facts.chain.filter(ph => executed.includes(ph)).length;
    done({
      key: 'old-snapshot',
      prediction: {
        predicted_chain: facts.chain, executed_phases: executed, predicted_reruns: reruns,
        note: `函数级预判，未执行任务：旧格式记录（3.1.0 快照）；升版后完成结论=${facts.completeAfterDrift}；产品字节不变=${facts.productUnchanged}`,
        freshness: facts.freshness, complete_after_drift: facts.completeAfterDrift, product_unchanged: facts.productUnchanged,
      },
      hit: { ok: facts.reconciled, evidence: `纯身份升版调和=${facts.reconciled}；freshness=${JSON.stringify(facts.freshness)}` },
      expectation: () => ({
        met: reruns === 0,
        detail: `预判出生链=${JSON.stringify(facts.chain)}，预判重跑已执行阶段 ${reruns} 个（预判，未执行任务），升版后完成结论=${facts.completeAfterDrift}`,
      }),
    });
  });
};

// ---------------------------------------------------------------------------
// S4 验收实质变化（真实链路：lifecycle L1b；L1c 反例）
// ---------------------------------------------------------------------------

function acceptanceChangeBranch(align: boolean): ScenarioRunner {
  return async (_entry, done) => {
    await withHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const p = snapshotProject(s, feature);
      const { predict, completed } = await handWrittenCompletion(s);
      bumpBlueprint(s, changeProjectedAcceptance);
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length, JSON.stringify(r));
      commit(s, 'blueprint rev3 admitted');
      const pre = assess(s, feature);
      const oldEvidenceAutoValid = pre.complete;
      const expected = predict(completed);
      const next = await supersede(s, feature, completed, expected, specFirstCuHooks(p, align));
      assert(next.successor, `后继未出生：${next.error}`);
      const events = eventsOf(s.root, feature, next.successor);
      const supersedeIdx = indexOf(events, e => e.type === 'supersede');
      const onDisk = YAML.parse(readText(s.root, path.relative(s.root, featureFilePath(s.root, feature, 'acceptance.yaml')))) as { criteria: Array<{ id: string; expected_result: string }> };
      const diskNew = onDisk.criteria.find(c => c.id === 'AC-1')?.expected_result === NEW_EXPECTED_RESULT;
      const effective = loadEffectiveExecutionScope(s.root, feature, next.successor);
      const bound = effective
        ? readScopeAcceptance(s.root, { facts: effective.obligations } as unknown as Parameters<typeof readScopeAcceptance>[1], { feature, frameworkRoot: s.frameworkRoot })
        : null;
      const boundNew = bound?.value.criteria.find(c => c.id === 'AC-1')?.expected_result === NEW_EXPECTED_RESULT;
      const gate = (JSON.parse(readText(s.root, path.relative(s.root, featureFilePath(s.root, feature, 'spec/reports/script-report.json'))) || '{"checks":[]}') as { checks: Array<{ id: string; status: string }> })
        .checks.find(c => c.id === 'authoritative_content_aligned');
      done({
        key: align ? 'aligned' : 'counter-unaligned', root: s.root, feature, frameworkRoot: s.frameworkRoot, runIds: [next.successor],
        interventions: [
          { kind: 'product_decision', actor: 'reliability-scenarios（测试代码，宿主改动替身）', content: '蓝图升版改投影验收 AC-1.expected_result，调和原位升版并提交' },
          {
            kind: 'rescue_command', actor: 'reliability-scenarios（测试代码）', necessary: true,
            content: `goal-runner --supersede ${completed}（起后继；按任务书口径计入操作者动作）`,
            related_events: supersedeIdx >= 0 ? [{ run_id: next.successor, event_index: supersedeIdx }] : [],
          },
        ],
        acceptance: diskNew && boundNew
          ? { result: 'pass', actor: 'reliability-scenarios', basis: '盘上 acceptance 与后继 run 绑定的验收均为新文本' }
          : { result: 'fail', actor: 'reliability-scenarios', basis: `盘上新文本=${diskNew}，后继绑定新文本=${boundNew}` },
        after: { run_id: next.successor, event_index: indexOf(events, e => e.type === 'run_start') },
        hit: {
          ok: expected.includes('spec') && supersedeIdx >= 0 && !!gate,
          evidence: `出生链预判=${JSON.stringify(expected)}；spec 门 authoritative_content_aligned=${gate?.status ?? '未执行'}`,
        },
        expectation: align
          ? (t) => ({
              met: t.conclusion === 'correct_completion' && !oldEvidenceAutoValid,
              detail: `结论=${t.conclusion}，升版后旧证据自动有效=${oldEvidenceAutoValid}，无影响重跑=${t.unaffected_reruns.exact}`,
            })
          : (t) => ({
              met: !t.facts.claimed_complete && t.facts.acceptance.result === 'fail',
              detail: `不对齐：宣称完成=${t.facts.claimed_complete}，独立验收=${t.facts.acceptance.result}（期望不得完成）`,
            }),
        extras: { predicted_chain: expected, old_evidence_auto_valid: oldEvidenceAutoValid, spec_gate: gate?.status ?? null },
      });
    });
  };
}

// ---------------------------------------------------------------------------
// S5 参考图与需求排除冲突（函数级 + 运行时链）
// ---------------------------------------------------------------------------

const S5_SCREEN = 'add_card_result';
const S5_NFC = 'result_nfc_card';

function seedS5Host(root: string): void {
  const f = `doc/features/${RT_FEATURE}`;
  rtWriteFile(root, `${f}/spec/spec.md`, ['# spec', '', '```yaml', 'ui_change: new_or_changed', '```', ''].join('\n'));
  rtWriteFile(root, `${f}/spec/ui-spec.yaml`, [
    "schema_version: '1.0'", 'screens:', `- id: ${S5_SCREEN}`, '  priority: P0', `  ref_id: ${S5_SCREEN}`, '  must_have_elements:',
    '  - result_status', '  - result_title', '  - result_done', '',
  ].join('\n'));
  rtWriteFile(root, `${f}/spec/ref-elements.yaml`, JSON.stringify({ schema_version: '1.0', elements: [A2_EXCLUDED, A2_DONE] }));
}

/** testing 执行者写的 visual-diff：参考图上有 NFC 卡、截图没有（身份齐全，缺陷锚在需求排除项上）。 */
function writeS5VisualDiff(root: string, buildFp: string, hashOf: (abs: string) => string): void {
  const shotRel = `doc/features/${RT_FEATURE}/device-testing/device-screenshots/shot-${S5_SCREEN}.png`;
  rtWriteFile(root, shotRel, `png-bytes-${S5_SCREEN}-${fs.existsSync(path.join(root, RT_PRODUCT_FILE)) ? rtProduct(root).length : 0}`);
  const h = hashOf(path.join(root, shotRel));
  rtWriteFile(root, `doc/features/${RT_FEATURE}/device-testing/device-screenshots/visual-diff.json`, JSON.stringify({
    schema_version: '1.1', feature: RT_FEATURE,
    screens: [{
      screen_id: S5_SCREEN, verdict: 'fail', ref_id: S5_SCREEN, screenshot_path: shotRel,
      screenshot_hash: h, evaluated_screenshot_hash: h, evaluated_build_fingerprint: buildFp,
      must_fix: ['Add the NFC activation card above result_done'],
      defects: [a2NfcDefect()],
      reverse_missing: [],
      region_attest: [{ region: 'result_done', verdict: 'diff_logged', method: 'vl_screening' }],
    }],
  }, null, 2));
}

/**
 * S5 命中：运行时这份 visual gate 的产出里有排除证据——`[requirement_excluded]` 且点名被排除的元素。
 * 只看 gate 是否执行、或只看函数级夹具的 warn，都证明不了运行时排除分支生效。
 */
export function s5ExclusionHit(gates: CheckResult[]): boolean {
  return gates.some(g => String(g.details ?? '').includes('[requirement_excluded]') && String(g.details ?? '').includes(S5_NFC));
}

const runS5: ScenarioRunner = async (_entry, done) => {
  // 函数级：候选生成对需求排除项不产候选（withA2Runtime，宿主 ae92d8 add_card_result 形态）。
  let fnFacts: Record<string, unknown> = {};
  withA2Runtime([a2NfcDefect()], [A2_EXCLUDED, A2_DONE], (r) => {
    const { res, warns } = a2Collect(r);
    fnFacts = { candidates: res.defects.length, unverified: res.unverified.length, excluded_warn: warns.some(l => l.includes('需求排除项')) };
  });
  // 运行时链：真实 visual gate + 真实 writer 决定 testing 推进；coding 执行者照提示词字面行事。
  const { root } = setupGoalRuntimeHost('codex');
  try {
    seedS5Host(root);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 's5 ui-spec + ref-elements']);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveCurrentBuildFingerprint } = require('../../../profiles/hmos-app/harness/build-fingerprint') as { resolveCurrentBuildFingerprint: (r: string, f: string, ph?: string) => string | null };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hashScreenshotFile } = require('../../../profiles/hmos-app/harness/visual-diff-check') as { hashScreenshotFile: (abs: string) => string };
    const gates: CheckResult[] = [];
    let nfcRequestedToCoding = false;
    const requirement = `开卡结果页展示开卡结果与完成按钮；${A2_QUOTE}`;
    const probe = await runGoalRuntimeChain(root, {
      adapter: 'codex',
      freshRequirement: requirement,
      onCoding: (ctx) => {
        // 执行者替身：提示词里出现 NFC 返修指令就照做（ae92d8 的真实行为）。
        const nfc = /NFC activation card/i.test(ctx.prompt);
        nfcRequestedToCoding = nfcRequestedToCoding || nfc;
        rtWriteFile(ctx.root, RT_PRODUCT_FILE, [
          'struct AddCardResult { build() { Column() {',
          "  Text('开卡成功').id('result_title')",
          ...(nfc ? ["  Text('激活NFC').id('result_nfc_card')"] : []),
          "  Button('完成').id('result_done')",
          '} } }',
        ].join('\n'));
      },
      onTesting: (ctx) => {
        const fp = resolveCurrentBuildFingerprint(ctx.root, RT_FEATURE, 'testing');
        assert(fp, 'S5：夹具须能算出 build fingerprint');
        writeS5VisualDiff(ctx.root, fp, hashScreenshotFile);
      },
      testingGateChecks: ({ root: r, feature, fields }) => {
        const gate = runRealVisualGate(r, feature, fields);
        gates.push(gate);
        return [
          { id: 'test_plan_exists', category: 'structure', description: 'functional fact（替身）', severity: 'BLOCKER', status: 'PASS', details: 'fake functional fact' },
          gate,
        ];
      },
    });
    const [run] = listRuns(root, RT_FEATURE);
    const events = eventsOf(root, RT_FEATURE, run);
    const firstTesting = indexOf(events, e => e.type === 'phase_verdict' && e.phase === 'testing');
    const hasNfc = /nfc/i.test(rtProduct(root));
    // plan 33784ed1 §7：裁判（testing 执行者）输入里有需求原文与排除项；没有产出补排除内容的候选
    const exclusionLine = `- 参考图元素 ${S5_NFC}：「${A2_QUOTE}」`;
    const judgeInputOk = probe.testingPrompts.length > 0
      && probe.testingPrompts.every(p => p.includes(requirement) && p.includes('### 明确不做') && p.includes(exclusionLine));
    const nfcCandidates = events.filter(e => e.type === 'phase_backtrack_requested' && /nfc/i.test(JSON.stringify(e.candidates ?? []))).length;
    done({
      key: 'excluded-reference', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: hasNfc
        ? { result: 'fail', actor: 'reliability-scenarios', basis: '产品源码含需求排除的 NFC 元素' }
        : rtProduct(root).includes("id('result_done')")
          ? { result: 'pass', actor: 'reliability-scenarios', basis: '产品源码无 NFC 元素且含 result_done' }
          : { result: 'fail', actor: 'reliability-scenarios', basis: '产品源码缺 result_done' },
      after: firstTesting >= 0 ? { run_id: run, event_index: firstTesting } : undefined,
      hit: {
        ok: s5ExclusionHit(gates),
        evidence: `真实 visual gate 执行 ${gates.length} 轮（首轮 ${gates[0]?.status ?? '-'}）；函数级排除项 warn=${String(fnFacts.excluded_warn)}；NFC 指令到达 coding=${nfcRequestedToCoding}`,
      },
      expectation: (t) => ({
        met: t.conclusion === 'correct_completion' && !hasNfc && judgeInputOk && nfcCandidates === 0 && !nfcRequestedToCoding,
        detail: `结论=${t.conclusion}，产品含 NFC=${hasNfc}，裁判输入含需求原文与排除项=${judgeInputOk}（testing 提示词 ${probe.testingPrompts.length} 轮），`
          + `补排除内容的候选=${nfcCandidates}，NFC 指令到达 coding=${nfcRequestedToCoding}，函数级候选=${String(fnFacts.candidates)}`,
      }),
      extras: { function_level: fnFacts, gates: gates.map(g => ({ status: g.status, details: String(g.details ?? '').slice(0, 400) })), nfc_requested_to_coding: nfcRequestedToCoding },
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// 真实链路的公共件（S6 / S7 / S11）
// ---------------------------------------------------------------------------

const REAL_PHASES = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function realChainHooks(project: RealChainProject, overrides: {
  coding?: (ctx: { runId: string; attempt: number }) => void;
  testing?: (ctx: { runId: string; attempt: number }) => void;
} = {}): Partial<Parameters<typeof runGoalRuntimeChain>[1]> {
  return {
    onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
    onPlan: ctx => { project.runId = ctx.runId; writePlanMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'plan'); },
    onCoding: ctx => {
      project.runId = ctx.runId;
      if (overrides.coding) overrides.coding(ctx); else writeCodingMaterials(project);
      if (ctx.attempt > 1) publishVerifier(project, 'coding');
    },
    onReview: ctx => { project.runId = ctx.runId; writeReviewMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'review'); },
    onUt: ctx => { project.runId = ctx.runId; writeUtMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'ut'); },
    onTesting: ctx => {
      project.runId = ctx.runId;
      writeTestPlan(project);
      overrides.testing?.(ctx);
      if (ctx.attempt > 1) publishVerifier(project, 'testing');
    },
  };
}

function realRun(project: RealChainProject, birthChain: string[], requirement: string, hooks: Partial<Parameters<typeof runGoalRuntimeChain>[1]>, extra: Partial<Parameters<typeof runGoalRuntimeChain>[1]> = {}): ReturnType<typeof runGoalRuntimeChain> {
  return runGoalRuntimeChain(project.root, {
    frameworkRoot: project.frameworkRoot, featureId: project.feature, realHarness: true, adapter: 'codex',
    freshStartPhase: birthChain[0] as 'spec', freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: requirement, ...hooks, ...extra,
  });
}

function scriptReportChecks(p: RealChainProject, phase: string): Array<{ id?: string; status?: string; details?: string; severity?: string }> {
  const text = readText(p.root, `doc/features/${p.feature}/${phase}/reports/script-report.json`);
  return text ? ((JSON.parse(text) as { checks?: Array<{ id?: string; status?: string; details?: string }> }).checks ?? []) : [];
}

// ---------------------------------------------------------------------------
// S6 排除内容已被实现（真实链路）
// ---------------------------------------------------------------------------

const S6_EXCLUSION = '开卡结果里的激活NFC部分本次先不需要';
const S6_ISSUE_FIX = '删除 AllBanksPage 中需求排除的激活NFC元素 nfc_activation_card';

function reviewReportRel(p: RealChainProject): string {
  return `doc/features/${p.feature}/review/review-report.md`;
}

/**
 * review 裁判替身的"多做核对"（verify-review 检查 1）：在 real-chain 的干净报告上追加一条 MAJOR「其他」，
 * 涉及文件写产品源码，统计与结论随之改为有条件通过。其余章节沿用 writeReviewMaterials。
 */
function writeReviewWithIssue(p: RealChainProject, issue: { id: string; category: string; desc: string; files: string; fix: string }): void {
  writeReviewMaterials(p);
  const rel = reviewReportRel(p);
  const text = readText(p.root, rel);
  const r1 = `| R-1 | 可读性 | MINOR | 组件缺少用途注释 | ${REAL_CHAIN_NEW_SOURCE} | 补充组件用途注释 |`;
  assert(text.includes(r1) && text.includes('| MAJOR | 0 |') && text.includes('**审查结论**: 通过'), 'review 报告形状已变，问题注入点失效');
  writeHostFile(p.root, rel, text
    .replace(r1, `${r1}\n| ${issue.id} | ${issue.category} | MAJOR | ${issue.desc} | ${issue.files} | ${issue.fix} |`)
    .replace('| MAJOR | 0 |', '| MAJOR | 1 |')
    .replace('**审查结论**: 通过', '**审查结论**: 有条件通过'));
}

/** verifier 替身：就 review 盘上 summary 的当前 subject 出报告，逐条确认该问题（evidence = 文件名 | 修复建议原文）。 */
function publishReviewConfirmation(p: RealChainProject, issue: { id: string; fileBase: string; fix: string }): boolean {
  const summary = JSON.parse(readText(p.root, `doc/features/${p.feature}/review/reports/summary.json`) || '{}') as { verifier_subject_id?: string };
  if (!summary.verifier_subject_id) return false;
  publishFixtureVerifierEvidence({
    projectRoot: p.root, reportsDir: path.join(p.root, 'doc/features', p.feature, 'review', 'reports'), feature: p.feature, phase: 'review',
    subjectId: summary.verifier_subject_id, skipSummaryPatch: true,
    reportText: [
      `# verifier — ${p.feature} / review`, '',
      '```issue-verification',
      `- issue: ${issue.id}`,
      '  verdict: confirmed',
      `  evidence: ${issue.fileBase} | ${issue.fix}`,
      '```', '',
    ].join('\n'),
  });
  return true;
}

const runS6: ScenarioRunner = async (_entry, done) => {
  await withProject(async (project) => {
    // 宿主需求加一句排除；候选按新需求重新生成（与 goal run 的 --requirement 逐字相同），提交基线。
    const requirement = `${REAL_CHAIN_REQUIREMENT}；${S6_EXCLUSION}`;
    const reqRel = `doc/features/${project.feature}/requirements/requirement.md`;
    writeHostFile(project.root, reqRel, `${readText(project.root, reqRel).trimEnd()}\n\n${S6_EXCLUSION}。\n`);
    const prepared = prepareRealChainScopeCandidate(project, {
      requirement, requestedResults: ['银行列表展示与开卡入口'], requestedPhases: REAL_PHASES,
    });
    git(project.root, ['add', '-A']);
    git(project.root, ['commit', '-qm', 'requirement excludes NFC activation']);
    clearFrameworkConfigCache();
    let introduced = false;
    let reviewSawExclusion = false;
    let reviewFlagged = 0;
    const hooks = realChainHooks(project, {
      coding: () => {
        writeCodingMaterials(project);
        // 回退之后的 coding 按候选移除（writeCodingMaterials 即不含排除元素的实现）。
        if (codingBacktrackRequested(project)) return;
        // 执行者多写一个需求排除的元素（ae92d8 之后的宿主形态）。
        const abs = path.join(project.root, REAL_CHAIN_SOURCE);
        const src = fs.readFileSync(abs, 'utf-8');
        const anchor = "Text('开卡申请').id('open_card_title')";
        assert(src.includes(anchor), 'S6：AllBanksPage 形状已变，排除元素注入点失效');
        fs.writeFileSync(abs, src.replace(anchor, `${anchor}\n      Text('激活NFC').id('nfc_activation_card')`), 'utf-8');
        introduced = true;
      },
    })!;
    // review 裁判替身：只有提示词里送到了需求的排除句，且产品里有该元素，才按"多做核对"记问题。
    hooks.onReview = ctx => {
      project.runId = ctx.runId;
      const nfcInProduct = /nfc_activation_card/.test(readText(project.root, REAL_CHAIN_SOURCE));
      reviewSawExclusion = reviewSawExclusion || ctx.prompt.includes(S6_EXCLUSION);
      if (nfcInProduct && ctx.prompt.includes(S6_EXCLUSION)) {
        reviewFlagged++;
        writeReviewWithIssue(project, {
          id: 'R-2', category: '其他', desc: `实现了需求明确排除的激活NFC元素（需求：「${S6_EXCLUSION}」）`, files: REAL_CHAIN_SOURCE, fix: S6_ISSUE_FIX,
        });
        if (ctx.attempt > 1) publishReviewConfirmation(project, { id: 'R-2', fileBase: path.basename(REAL_CHAIN_SOURCE), fix: S6_ISSUE_FIX });
        return;
      }
      writeReviewMaterials(project);
      if (ctx.attempt > 1) publishVerifier(project, 'review');
    };
    await realRun(project, prepared.scope.phase_chain.map(String), requirement, hooks);
    const [run] = listRuns(project.root, project.feature);
    const events = eventsOf(project.root, project.feature, run);
    const firstCoding = indexOf(events, e => e.type === 'phase_verdict' && e.phase === 'coding');
    const hasNfc = /nfc/i.test(productSources(project.root, project.modulePath));
    const reviewBacktrack = events.some(e => e.type === 'phase_backtrack_requested' && e.to_phase === 'coding'
      && ((e.candidates as Array<{ source_phase?: string; summary?: string }> | undefined) ?? []).some(c => c.source_phase === 'review' && String(c.summary ?? '').includes('nfc_activation_card')));
    done({
      key: 'excluded-implemented', root: project.root, feature: project.feature, frameworkRoot: project.frameworkRoot, runIds: [run],
      interventions: [],
      acceptance: hasNfc
        ? { result: 'fail', actor: 'reliability-scenarios', basis: '产品源码（src/main/ets）仍含需求排除的 NFC 元素' }
        : { result: 'pass', actor: 'reliability-scenarios', basis: '产品源码无 NFC 元素' },
      after: firstCoding >= 0 ? { run_id: run, event_index: firstCoding } : undefined,
      hit: { ok: introduced, evidence: `coding 注入排除元素=${introduced}；review 提示词含排除句=${reviewSawExclusion}；review 记问题 ${reviewFlagged} 轮；run_end=${String(rtRunEnd(events)?.status)}` },
      expectation: (t) => ({
        met: t.conclusion === 'correct_completion' && !hasNfc && reviewBacktrack,
        detail: `结论=${t.conclusion}，产品仍含 NFC=${hasNfc}，review 发现进入返修（review 候选驱动回退到 coding）=${reviewBacktrack}（期望：发现并移除）`,
      }),
    });
  })();
};

// ---------------------------------------------------------------------------
// S7 非关键描述冲突（真实链路；冲突 A 披露 + 冲突 B 由执行者按目标裁决、裁决记录送到下一轮裁判）
// ---------------------------------------------------------------------------

const S7_DERIVED_PLAN = (f: string): string => `doc/features/${f}/testing/reports/20260101T000000Z/hylyre/test-plan.hylyre.md`;
/** 冲突 B 的裁判提法（review 替身）与执行者裁决依据的引文（逐字取自 REAL_CHAIN_REQUIREMENT）。 */
const S7_B_FIX = '统一 F1 优先级：acceptance.yaml 中 AC-2 的 priority 与 spec.md 功能清单 F1=P0 保持一致';
const S7_B_QUOTE = '银行列表展示';

type ReportCheck = { id?: string; status?: string; details?: string };
/** 冲突 A 的定位：details 点名 all_banks。 */
const S7_CONFLICT_A = (details: string): boolean => details.includes('all_banks');
/** 独立断言：某冲突是否被披露 = 有非 PASS 检查的 details 命中该冲突的定位。 */
export function s7Disclosed(checks: ReportCheck[], conflict: (details: string) => boolean): boolean {
  return checks.some(c => c.status !== 'PASS' && conflict(c.details ?? ''));
}
/**
 * 分支期望：disclosed = 宣称完成且冲突 A 被披露；undisclosed-in-chain（键名沿用 P1）= 冲突 B 由执行者按目标裁决、
 * 裁决记录出现在下一轮裁判输入里，且任务正确完成（plan 33784ed1 §7）。
 * 独立断言本身能否区分“未披露”由自检里的固定输入证明，不靠真实链路里框架的当前行为。
 */
export function s7Expectation(key: string, t: TaskReport, disclosure: { a: boolean; b: boolean }): { met: boolean; detail: string } {
  if (key === 'disclosed') {
    return { met: t.facts.claimed_complete && disclosure.a, detail: `宣称完成=${t.facts.claimed_complete}，冲突 A 披露=${disclosure.a}（任务结论=${t.conclusion}）` };
  }
  return {
    met: disclosure.b && t.conclusion === 'correct_completion',
    detail: `冲突 B（F1 优先级）裁决记录到达下一轮裁判=${disclosure.b}，任务结论=${t.conclusion}`,
  };
}

const runS7: ScenarioRunner = async (_entry, done) => {
  await withProject(async (project, birthChain) => {
    let conflictWritten = false;
    let bRaised = 0;
    let bDeclined: string[] = [];
    let judgeSawDecline = false;
    const specRel = `doc/features/${project.feature}/spec/spec.md`;
    const acceptanceRel = `doc/features/${project.feature}/acceptance.yaml`;
    const hooks = realChainHooks(project, {
      testing: () => {
        // 冲突 A（位置：派生 Hylyre 计划 TC-002 第 1 步）：用屏 id `all_banks` 当元素 id——两套命名
        // （ui-spec 屏 id 与节点 id）对同一对象的描述不一致，非关键（动作步，不是身份断言）。
        const rel = S7_DERIVED_PLAN(project.feature);
        const text = readText(project.root, rel);
        assert(text.includes('{"back":{}}'), 'S7：派生计划形状已变，冲突注入点失效');
        writeHostFile(project.root, rel, text.replace('{"back":{}}', '{"touch":{"by_id":"all_banks"}}'));
        conflictWritten = true;
      },
    })!;
    // 冲突 B 的裁判（review 替身）：没看到执行者的裁决记录就提出；看到了（下一轮提示词「已裁决的冲突」）即接受。
    hooks.onReview = ctx => {
      project.runId = ctx.runId;
      const sawDecline = ctx.prompt.includes('### 已裁决的冲突') && ctx.prompt.includes(`「${S7_B_QUOTE}」`);
      judgeSawDecline = judgeSawDecline || sawDecline;
      if (!sawDecline) {
        bRaised++;
        writeReviewWithIssue(project, {
          id: 'R-2', category: '其他', desc: 'spec.md 功能清单 F1=P0，acceptance 中 F1 的 AC-2 priority=P1，两处优先级不一致',
          files: `${specRel}, ${acceptanceRel}`, fix: S7_B_FIX,
        });
        if (ctx.attempt > 1) publishReviewConfirmation(project, { id: 'R-2', fileBase: 'spec.md', fix: S7_B_FIX });
        return;
      }
      writeReviewMaterials(project);
      if (ctx.attempt > 1) publishVerifier(project, 'review');
    };
    // 冲突 B 的执行者（spec 替身）：返修候选段里有候选即按目标拒修，逐候选追加到 spec 账本（写法取自候选段）。
    const onSpec = hooks.onSpec!;
    hooks.onSpec = ctx => {
      onSpec(ctx);
      const fps = [...new Set([...ctx.prompt.matchAll(/item_fingerprint: ([0-9a-f]{64})/g)].map(m => m[1]))];
      if (fps.length === 0) return;
      const ledger = path.join(project.root, `doc/features/${project.feature}/spec/headless-assumptions.jsonl`);
      for (const fp of fps) {
        fs.appendFileSync(ledger, JSON.stringify({
          decision_id: `s7-decline-${ctx.attempt}-${fp.slice(0, 12)}`, run_id: ctx.runId, phase: 'spec',
          gate_id: `repair_candidate:${fp}`, class: 'goal_conflict',
          decision: `declined: 需求要的是「${S7_B_QUOTE}」，F1 按 P0 交付；AC-2 的 P1 是该条验收用例的执行优先级，与功能优先级不是同一口径，不改`,
          must_review: true, source: 'agent', ts: new Date().toISOString(),
        }) + '\n', 'utf-8');
      }
      bDeclined = [...bDeclined, ...fps];
    };
    await realRun(project, birthChain, REAL_CHAIN_REQUIREMENT, hooks);
    const [run] = listRuns(project.root, project.feature);
    const events = eventsOf(project.root, project.feature, run);
    // 披露落点：testing 的 script-report（derived_selector_contract 等非 PASS 检查）或 summary 的 readiness 信号。
    const testingChecks = scriptReportChecks(project, 'testing');
    const summaryText = readText(project.root, `doc/features/${project.feature}/testing/reports/summary.json`);
    const disclosedA = s7Disclosed(testingChecks, S7_CONFLICT_A);
    // 冲突 B：执行者账本里有针对该候选的拒修记录（引文逐字取自需求），且下一轮裁判提示词里出现了它。
    const ledgerText = readText(project.root, `doc/features/${project.feature}/spec/headless-assumptions.jsonl`);
    const recordedB = bDeclined.length > 0 && bDeclined.every(fp => ledgerText.includes(`repair_candidate:${fp}`)) && ledgerText.includes(`「${S7_B_QUOTE}」`);
    const adjudicatedB = recordedB && judgeSawDecline;
    const specBacktrack = events.some(e => e.type === 'phase_backtrack_requested' && e.to_phase === 'spec');
    const selector = testingChecks.find(c => c.id === 'derived_selector_contract');
    // 同一工程同一 run 只有一个任务：独立验收涵盖冲突 A 被披露与冲突 B 的裁决记录到达下一轮裁判两项（任一不成立即失败）。
    const acceptance: AcceptanceFact = disclosedA && adjudicatedB
      ? { result: 'pass', actor: 'reliability-scenarios', basis: '冲突 A（all_banks）在非 PASS 检查中被点名；冲突 B（F1 优先级）的执行者裁决记录在账本且出现在下一轮 review 提示词' }
      : { result: 'fail', actor: 'reliability-scenarios', basis: `冲突 A 披露=${disclosedA}（testing script-report 点名 all_banks）；冲突 B 裁决记录在账本=${recordedB}、到达下一轮裁判=${judgeSawDecline}` };
    const base = { root: project.root, feature: project.feature, frameworkRoot: project.frameworkRoot, runIds: [run], interventions: [] as Intervention[], acceptance, taskLabel: 'S7' };
    done({
      ...base, key: 'disclosed',
      hit: { ok: conflictWritten, evidence: `派生计划冲突写入=${conflictWritten}；derived_selector_contract=${selector?.status ?? '无'}` },
      expectation: (t) => s7Expectation('disclosed', t, { a: disclosedA, b: adjudicatedB }),
      extras: { derived_selector_contract: selector ?? null, summary_mentions_all_banks: summaryText.includes('all_banks') },
    });
    done({
      ...base, key: 'undisclosed-in-chain',
      hit: {
        ok: /\| F1 \| 银行列表展示 \| P0 \|/.test(readText(project.root, specRel))
          && /feature: F1\n\s+description: 银行列表展示\n[\s\S]*?priority: P1/.test(readText(project.root, acceptanceRel))
          && bRaised > 0 && specBacktrack,
        evidence: `冲突 B 在盘（spec.md F1=P0，acceptance AC-2（F1）=P1）；review 提出 ${bRaised} 轮；回退到 spec=${specBacktrack}；spec 拒修 ${bDeclined.length} 条`,
      },
      expectation: (t) => s7Expectation('undisclosed-in-chain', t, { a: disclosedA, b: adjudicatedB }),
    });
  })();
};

// ---------------------------------------------------------------------------
// S11 真实产品回归（真实链路 RC-9：修好 / 始终不修）
// ---------------------------------------------------------------------------

function runS11Branch(fixes: boolean): ScenarioRunner {
  return async (_entry, done) => {
    await withProject(async (project, birthChain) => {
      await realRun(project, birthChain, REAL_CHAIN_REQUIREMENT, realChainHooks(project, {
        coding: () => writeCodingMaterials(project, { entryTitleId: fixes && codingBacktrackRequested(project) }),
      }), { viaHostBridge: true });
      const [run] = listRuns(project.root, project.feature);
      const events = eventsOf(project.root, project.feature, run);
      const bt = events.find(e => e.type === 'phase_backtrack_requested' && e.from_phase === 'testing' && e.to_phase === 'coding');
      const firstTestingFail = indexOf(events, e => e.type === 'phase_verdict' && e.phase === 'testing' && e.verdict === 'FAIL');
      const fixed = productSources(project.root, project.modulePath).includes("id('open_card_title')");
      done({
        key: fixes ? 'fixed' : 'never-fixed', root: project.root, feature: project.feature, frameworkRoot: project.frameworkRoot, runIds: [run],
        interventions: [],
        acceptance: fixed
          ? { result: 'pass', actor: 'reliability-scenarios', basis: "产品源码含 .id('open_card_title')（开卡页标题可被断言）" }
          : { result: 'fail', actor: 'reliability-scenarios', basis: "产品源码缺 .id('open_card_title')，开卡页标题断言必失败" },
        after: firstTestingFail >= 0 ? { run_id: run, event_index: firstTestingFail } : undefined,
        hit: {
          ok: !!bt && ((bt.candidates as Array<{ id?: string }> | undefined) ?? []).some(c => /^testing_failure_routing_/.test(String(c.id))),
          evidence: bt ? `phase_backtrack_requested testing→coding @${events.indexOf(bt)}` : '未发生 testing→coding 回退',
        },
        expectation: fixes
          ? (t) => ({ met: t.conclusion === 'correct_completion' && t.unaffected_reruns.exact === 0, detail: `结论=${t.conclusion}，无影响重跑=${t.unaffected_reruns.exact}` })
          : (t) => ({
              met: !t.facts.claimed_complete,
              detail: `宣称完成=${t.facts.claimed_complete}（不得宣称完成），停止=${t.stop_state?.status}/${t.stop_state?.halt_reason}/${t.stop_state?.run_disposition}`,
            }),
      });
    })();
  };
}

// ---------------------------------------------------------------------------
// S8 进程中断 / S9 真机暂不可用（子进程驱动）
// ---------------------------------------------------------------------------

const DRIVER_PRODUCT = '02-Feature/SampleFeature/src/main/ets/SamplePage.ets';
const DRIVER_OUT_OF_SCOPE = '01-Product/ProductShell/src/main/ets/pages/OutOfScopePage.ets';

const runS8: ScenarioRunner = async (_entry, done) => {
  const feature = 'reliability-crash';
  const host = setupMinimalHost(feature, 'hmos-app');
  try {
    const crashed = runDriver('crash_scope_in_run', feature, host);
    assert(crashed.runId, `S8：崩溃段须产出 run：${JSON.stringify({ ...crashed, eventTypes: undefined })}`);
    const run = crashed.runId as string;
    const crashEvents = eventsOf(host, feature, run);
    const crashEnd = indexOf(crashEvents, e => e.type === 'run_end');
    // plan 4e6fb3b6 §8 S8：重新发起同一请求（不带 --resume/--force，也不手工修 contracts）——接续决策重新接入同一 run；
    // plan 执行者（替身）在回退后的 plan 轮里把 contracts 收回范围内文件（plan 阶段自己的工作）。
    const resumed = runDriver('crash_rerequest', feature, host);
    const events = eventsOf(host, feature, run);
    const rejoinIdx = events.findIndex((e, i) => i > crashEnd && e.type === 'run_start');
    const contracts = readText(host, `doc/features/${feature}/contracts.yaml`);
    const product = readText(host, DRIVER_PRODUCT);
    const ok = product.includes('struct SamplePage') && contracts.includes(DRIVER_PRODUCT) && !contracts.includes(DRIVER_OUT_OF_SCOPE);
    const runs = listRuns(host, feature);
    done({
      key: 'crash-resume', root: host, feature, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [
        RE_REQUEST('重新发起同一请求（不带 --resume/--force，未手工修 contracts；supervisor 自动拉起段未覆盖）',
          rejoinIdx >= 0 ? [{ run_id: run, event_index: rejoinIdx }] : []),
      ],
      acceptance: ok
        ? { result: 'pass', actor: 'reliability-scenarios', basis: '产品源码在、contracts 只含范围内文件' }
        : { result: 'fail', actor: 'reliability-scenarios', basis: 'contracts 含范围外文件或产品源码缺失' },
      after: crashEnd >= 0 ? { run_id: run, event_index: crashEnd } : undefined,
      hit: {
        ok: crashed.runEndReason === 'uncaught_exception' && crashed.eventTypes.includes('phase_backtrack_requested'),
        evidence: `崩溃段 run_end.reason=${crashed.runEndReason}；重发段 exit=${resumed.exitCode} phase_start=${JSON.stringify(resumed.phaseStartsThisCall)}`,
      },
      expectation: (t) => ({
        met: t.conclusion === 'correct_completion' && t.operator.rescue_count === 1 && runs.length === 1 && rejoinIdx >= 0,
        detail: `结论=${t.conclusion}，操作者动作=${t.operator.rescue_count}（期望 1：重发同一请求），run 数=${runs.length}，同一 run 重新接入=${rejoinIdx >= 0}`,
      }),
      extras: { crash_exit: crashed.exitCode, rerequest_exit: resumed.exitCode },
    });
  } finally {
    try { fs.rmSync(host, { recursive: true, force: true }); } catch { /* 占用即留 OS */ }
  }
};

const S9_FEATURE = 'reliability-park';

/**
 * S9 独立验收：只看产品源码与测试侧的独立结果（驱动的 testing 桩写下的结果文件），
 * 不读框架返回码与阶段事件——第二个参数只为自检锁定这一点（改变它，独立验收不得变）。
 */
export function s9Acceptance(host: string, _frameworkOutcome: Pick<GoalRunOutcome, 'exitCode' | 'phaseStartsThisCall'>): AcceptanceFact {
  const product = readText(host, DRIVER_PRODUCT).includes('struct SamplePage');
  const testing = (() => {
    try { return (JSON.parse(readText(host, `doc/features/${S9_FEATURE}/testing/reports/summary.json`) || '{}') as { verdict?: string }).verdict === 'PASS'; } catch { return false; }
  })();
  return product && testing
    ? { result: 'pass', actor: 'reliability-scenarios', basis: '产品源码在；testing 桩（测试侧）写下的 testing 结果为 PASS' }
    : { result: 'fail', actor: 'reliability-scenarios', basis: `产品源码在=${product}，testing 结果 PASS=${testing}` };
}

const runS9: ScenarioRunner = async (entry, done) => {
  const feature = S9_FEATURE;
  const host = setupMinimalHost(feature, 'hmos-app');
  try {
    const parked = runDriver('device_park', feature, host);
    assert(parked.runId, `S9：停放段须产出 run：${JSON.stringify({ ...parked, eventTypes: undefined })}`);
    const run = parked.runId as string;
    // 停放时刻的停止状态（采集器，同一 run）。
    const parkedTask = collectBranch(entry, entry.branches[0], {
      key: 'park-snapshot', root: host, feature, frameworkRoot: REPO_ROOT, runIds: [run], interventions: [],
      acceptance: { result: 'not_accepted' }, hit: { ok: true, evidence: '' }, expectation: () => ({ met: true, detail: '' }),
    });
    const parkStop: StopState | null = parkedTask.stop_state;
    const parkEvents = eventsOf(host, feature, run);
    const parkEnd = indexOf(parkEvents, e => e.type === 'run_end');
    const waitTimeout = parkEvents.find(e => e.type === 'condition_wait_timeout' && e.probe === 'device_readiness');
    const parkHalt = parkEvents.find(e => e.type === 'phase_halt' && e.halt_reason === 'device_not_ready');
    // plan 4e6fb3b6 §8 S9 超时一支：停放后由实际的 supervisor（生产 CLI，探针注入为就绪）消费停放事件并发出恢复；
    // 恢复本身按 supervisor 发出的命令执行（测试代替计划任务把它跑起来，不是操作者动作）。
    const woke = runDriver('supervisor_probe_wake', feature, host, run);
    const supervisorArgs = woke.supervisorRunnerArgs ?? [];
    const sealedAt = eventsOf(host, feature, run).length;
    const resumed = runDriver('resume_with_device_ready', feature, host, run);
    const events = eventsOf(host, feature, run);
    const resumeIdx = events.findIndex((e, i) => i >= sealedAt && e.type === 'resume');
    const halt = events.find(e => e.type === 'phase_halt' && e.halt_reason === 'device_not_ready');
    done({
      key: 'park-resume', root: host, feature, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: s9Acceptance(host, resumed),
      after: parkEnd >= 0 ? { run_id: run, event_index: parkEnd } : undefined,
      hit: { ok: !!halt && parked.exitCode === 2 && !!waitTimeout, evidence: `停放 exit=${parked.exitCode}；进程内等待超时=${!!waitTimeout}；device_not_ready 停机=${!!halt}；停放时停止状态=${parkStop?.reading}` },
      expectation: (t) => {
        const reasons = [
          parkStop?.reading === 'waiting_external_wakeable' || `停放读法=${parkStop?.reading}`,
          (parkHalt?.probe === 'device_readiness' && parkHalt?.phase === 'ut') || `停放事件须带探针与责任阶段：${JSON.stringify({ probe: parkHalt?.probe, phase: parkHalt?.phase })}`,
          (woke.supervisorAction === 'resume' && supervisorArgs.includes('--resume') && supervisorArgs.includes(run)) || `supervisor 须发出恢复：action=${woke.supervisorAction} args=${supervisorArgs.join(' ')}`,
          (resumed.exitCode === 0 && resumed.phaseStartsThisCall.includes('ut') && resumed.phaseStartsThisCall.includes('testing')) || `恢复段 exit=${resumed.exitCode} phase_start=${JSON.stringify(resumed.phaseStartsThisCall)}`,
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
          t.operator.rescue_count === 0 || `操作者动作=${t.operator.rescue_count}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `进程内等待超时后停放（可唤醒等待）→ supervisor 探针就绪发出 --resume ${run} → 同一 run 完成，操作者动作 0` };
      },
      extras: { park_stop_state: parkStop, supervisor_args: supervisorArgs, resume_event: resumeIdx },
    });
  } finally {
    try { fs.rmSync(host, { recursive: true, force: true }); } catch { /* 占用即留 OS */ }
  }
};

/** S9 进程内等待一支：设备门首次 BLOCKED（带探针），进程内等待期间探针就绪、原设备门重查放行 → 同一 attempt 继续，操作者动作 0。 */
const runS9Wait: ScenarioRunner = async (_entry, done) => {
  const feature = S9_FEATURE;
  const host = setupMinimalHost(feature, 'hmos-app');
  try {
    const out = runDriver('device_wait_ready', feature, host);
    assert(out.runId, `S9 等待支：须产出 run：${JSON.stringify({ ...out, eventTypes: undefined })}`);
    const run = out.runId as string;
    const events = eventsOf(host, feature, run);
    const started = events.find(e => e.type === 'condition_wait_started' && e.probe === 'device_readiness');
    const ready = events.find(e => e.type === 'condition_wait_ready');
    done({
      key: 'in-process-wait', root: host, feature, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: s9Acceptance(host, out),
      after: started ? { run_id: run, event_index: events.indexOf(started) } : undefined,
      hit: { ok: !!started, evidence: started ? `condition_wait_started(device_readiness) @${events.indexOf(started)}` : '设备门未进入进程内等待' },
      expectation: (t) => {
        const reasons = [
          !!ready || '探针就绪后须落 condition_wait_ready',
          !events.some(e => e.type === 'phase_halt' && e.halt_reason === 'device_not_ready' && events.indexOf(e) > events.indexOf(started!))
            || '恢复后不得再以 device_not_ready 停放',
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
          t.operator.rescue_count === 0 || `操作者动作=${t.operator.rescue_count}`,
          listRuns(host, feature).length === 1 || '不得新建 run',
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `进程内等待 ${String(ready?.waited_ms)}ms 后设备就绪、原设备门放行、同一 run 完成，操作者动作 0` };
      },
    });
  } finally {
    try { fs.rmSync(host, { recursive: true, force: true }); } catch { /* 占用即留 OS */ }
  }
};

// ---------------------------------------------------------------------------
// S12 合法人工暂停 / S13 执行者错误拒修后被纠正（运行时链）
// ---------------------------------------------------------------------------

const runS12: ScenarioRunner = async (_entry, done) => {
  // 三个分支各用一个宿主：同一 run 在不同时刻的观察若共用一个任务，结果文件会把它们合并成一条（取最早的停止状态）。
  let root = setupGoalRuntimeHost('codex').root;
  const detail = '安装到真机前需要设备所有者授权（执行者停在授权确认处，等待用户输入）';
  // attended 执行器（helper 的 executorMode:'attended'）在 coding 返回 waiting：临时替换 AttendedGoalPhaseExecutor.execute
  // （测试侧打桩，不改生产文件；detached 执行器会把 status 按退出码重写，waiting 只能从 attended 传输到达）。
  // plan 4e6fb3b6 §8：授权补上之前一律 waiting；补上之后执行者照常执行（产品写入完成态）。
  const proto = AttendedGoalPhaseExecutor.prototype;
  const original = proto.execute;
  let authorized = false;
  proto.execute = async function (this: AttendedGoalPhaseExecutor, ctx: Parameters<typeof original>[0]) {
    if (ctx.phase === 'coding' && !authorized) {
      return { status: 'waiting', phase: ctx.phase, details: detail, exitCode: 0, stdout: '', stderr: '', command: 'phase_execute_request' };
    }
    return original.call(this, ctx);
  };
  const request = (): ReturnType<typeof runGoalRuntimeChain> =>
    runGoalRuntimeChain(root, { adapter: 'codex', executorMode: 'attended', noAutoForce: true, onCoding: writeDone });
  const stoppedHost = async (): Promise<{ run: string; events: Ev[]; halt?: Ev }> => {
    fs.rmSync(root, { recursive: true, force: true });
    clearFrameworkConfigCache();
    root = setupGoalRuntimeHost('codex').root;
    authorized = false;
    await request();
    const [r] = listRuns(root, RT_FEATURE);
    const ev = eventsOf(root, RT_FEATURE, r);
    return { run: r, events: ev, halt: ev.find(e => e.type === 'phase_halt' && e.halt_reason === 'executor_waiting') };
  };
  try {
    await request();
    const [run] = listRuns(root, RT_FEATURE);
    const events = eventsOf(root, RT_FEATURE, run);
    const halt = events.find(e => e.type === 'phase_halt' && e.halt_reason === 'executor_waiting');
    const passedBefore = ['spec', 'plan'].every(ph => events.some(e => e.type === 'phase_verdict' && e.phase === ph && e.verdict === 'PASS'));
    const codingPassed = events.some(e => e.type === 'phase_verdict' && e.phase === 'coding' && e.verdict === 'PASS');
    const manifestOk = fs.existsSync(path.join(runsDirOf(root, RT_FEATURE), run, 'manifest.json'));
    const control = JSON.parse(readText(root, path.relative(root, path.join(runsDirOf(root, RT_FEATURE), run, 'run-control.json'))) || '{}') as { owner?: { state?: string } };
    done({
      key: 'human-authorization', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: { result: 'fail', actor: 'reliability-scenarios', basis: '未交付：停在授权确认处（暂停是否正确由期望判定）' },
      hit: { ok: !!halt, evidence: halt ? `phase_halt executor_waiting @${events.indexOf(halt)}` : '未出现 executor_waiting' },
      expectation: (t) => {
        const reasons = [
          !t.facts.claimed_complete || '宣称了完成',
          t.stop_state?.reading === 'waiting_human' || `停止读法=${t.stop_state?.reading}`,
          String(halt?.detail ?? '').includes('授权') || '停机未带授权原因',
          passedBefore || 'spec/plan 的 PASS 未保留',
          !codingPassed || '被暂停阶段出现 PASS',
          manifestOk || 'manifest 缺失',
          control.owner?.state === 'released' || `run-control.owner.state=${control.owner?.state}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : '等人；原因、已过阶段、manifest、run-control 释放均在，可 --resume' };
      },
    });

    // 重复请求（有人在场，未补授权）：调度方 2026-09-29 裁定有人在场不设冷却——每次重发都重新接入、由原授权检查以同一原因再停，run 数不增加。
    // 无人值守的"保持停止、不写事件"由 S1/budget 分支的连续重发覆盖。
    const rep1 = await stoppedHost();
    const waitsOf = (id: string): number => eventsOf(root, RT_FEATURE, id).filter(e => e.type === 'phase_halt' && e.halt_reason === 'executor_waiting').length;
    const repeatExits: number[] = [];
    for (let i = 0; i < 3; i++) repeatExits.push((await request()).exitCode);
    const runsAfterRepeat = listRuns(root, RT_FEATURE);
    done({
      key: 'repeat-unchanged', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [rep1.run],
      interventions: repeatExits.map(() => ({ ...RE_REQUEST('有人在场重复同一请求（未补授权，什么都没变）'), necessary: false })),
      acceptance: { result: 'fail', actor: 'reliability-scenarios', basis: '未交付：仍停在授权确认处' },
      hit: { ok: !!rep1.halt, evidence: `首次停在 executor_waiting；重复请求 ${repeatExits.length} 次，退出码 ${repeatExits.join(',')}` },
      expectation: () => {
        const reasons = [
          runsAfterRepeat.length === 1 || `重复请求新建了 run：${runsAfterRepeat.join(',')}`,
          waitsOf(rep1.run) === 1 + repeatExits.length || `每次重发都须以授权确认再停：${waitsOf(rep1.run)}`,
          repeatExits.every(c => c !== 0) || `每次都须停下：${repeatExits.join(',')}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : '三次重复请求均重新接入并以授权确认再停，run 数 1' };
      },
    });

    // 有人在场、立即重发仍未补授权 → 重新接入后执行者仍停在授权确认处（不新建 run）；补上授权立即重发 → 重新接入并完成。
    const re = await stoppedHost();
    await request();
    const waitsWithoutAuth = eventsOf(root, RT_FEATURE, re.run).filter(e => e.type === 'phase_halt' && e.halt_reason === 'executor_waiting').length;
    authorized = true;
    const resumed = await request();
    const finalEvents = eventsOf(root, RT_FEATURE, re.run);
    done({
      key: 'reauthorized', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [re.run],
      interventions: [
        { ...RE_REQUEST('有人在场立即重发同一请求（仍未补授权）'), necessary: false },
        { kind: 'reauthorization', actor: 'reliability-scenarios（测试代码，模拟设备所有者）', necessary: true, content: '设备所有者给出授权' },
        RE_REQUEST('补上授权后重新发起同一请求（未带任何旗标）'),
      ],
      acceptance: productAcceptance(root),
      after: re.halt ? { run_id: re.run, event_index: re.events.indexOf(re.halt) } : undefined,
      hit: { ok: !!re.halt && waitsWithoutAuth === 2, evidence: `未补授权的重发后停在授权确认 ${waitsWithoutAuth} 次` },
      expectation: (t) => {
        const reasons = [
          waitsWithoutAuth === 2 || `未补授权的重发须以原因再停一次：${waitsWithoutAuth}`,
          listRuns(root, RT_FEATURE).length === 1 || '不得新建 run',
          resumed.invokedPhases.includes('coding') || `补授权后须执行 coding：${resumed.invokedPhases.join(',')}`,
          /COMPLETED/.test(String(rtRunEnd(finalEvents)?.status ?? '')) || `终态=${String(rtRunEnd(finalEvents)?.status)}`,
          t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
        ].filter((x): x is string => typeof x === 'string');
        return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `未补授权仍停（不新建 run）；补授权后重新接入同一 run 并正确完成；操作者动作=${t.operator.rescue_count}` };
      },
    });
  } finally {
    proto.execute = original;
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const S13_FIX = 'Text("已开卡")';
const S13_DEFECT = 'TC-001 step 2：已执行 assertion 失败（期望文本「已开卡」未出现），且同 case 较小 index 有已通过 action';

/**
 * S13（plan 33784ed1 §7）：执行者按返修候选段的写法在账本里拒修（引文逐字取自本 run 需求），不改产品。
 * refusal-corrected：第一次拒修后裁判再提 → 反驳轮 → 修复 → 完成；refusal-twice（反面）：两轮都拒、裁判两轮都提 →
 * 既有停机原因、未宣称完成、停机说明并列双方原文。
 */
function runS13Branch(declineTwice: boolean): ScenarioRunner {
  return async (_entry, done) => {
  const { root } = setupGoalRuntimeHost('codex');
  let refusedWithoutChange = false;
  let backtracksSeenByCoding = 0;
  const declines: string[][] = [];
  try {
    const productFixed = (): boolean => rtProduct(root).includes(S13_FIX);
    const backtracks = (runId: string): number => (runId
      ? eventsOf(root, RT_FEATURE, runId).filter(e => e.type === 'phase_backtrack_requested' && e.to_phase === 'coding').length
      : 0);
    const probe = await runGoalRuntimeChain(root, {
      adapter: 'codex',
      onTesting: ({ root: r }) => writeCleanTesting(r),
      // 证据由产品现状求出：源码没有开卡完成文案 → 已执行断言失败（一档产品真值，真实 writer 落 FAIL + 候选）。
      onHarnessSummary: ({ phase }) => (phase === 'testing' && !productFixed() ? {
        checks: [{
          ...PRODUCT_ASSERTION_CHECK,
          id: 'testing_failure_routing_TC-001_s2',
          affected_files: [RT_PRODUCT_FILE],
          details: S13_DEFECT,
        } as CheckResult],
      } : null),
      onCoding: (ctx) => {
        const n = backtracks(ctx.runId);
        backtracksSeenByCoding = Math.max(backtracksSeenByCoding, n);
        if (n === 0) {
          rtWriteFile(ctx.root, RT_PRODUCT_FILE, 'struct AllBanksPage { build() { Text("x") } }');
        } else if (n === 1 || declineTwice) {
          // 执行者错误拒修：认定断言有误，不改产品；按候选段写法逐候选落账本（引文取自本 run 需求）。
          refusedWithoutChange = true;
          declines.push(declineFromPrompt(ctx, GOAL_QUOTE));
        } else {
          rtWriteFile(ctx.root, RT_PRODUCT_FILE, `struct AllBanksPage { build() { ${S13_FIX} } }`);
        }
      },
    });
    const [run] = listRuns(root, RT_FEATURE);
    const events = eventsOf(root, RT_FEATURE, run);
    const bts = events.filter(e => e.type === 'phase_backtrack_requested' && e.to_phase === 'coding');
    const firstTestingFail = indexOf(events, e => e.type === 'phase_verdict' && e.phase === 'testing' && e.verdict === 'FAIL');
    const halts = events.filter(e => e.type === 'phase_halt');
    const guidance = halts.map(e => String(e.halt_guidance ?? '')).join('\n');
    // 反驳轮提示词（第二次回退的 coding）：逐条写明上一轮依据与"裁判看过依据后仍然提出"
    const rebuttalPrompt = probe.codingPrompts[2] ?? '';
    const rebuttalShown = rebuttalPrompt.includes('反驳轮') && rebuttalPrompt.includes(`「${GOAL_QUOTE}」`);
    const firstDeclineHalted = halts.some(e => events.indexOf(e) < events.indexOf(bts[1] ?? events[events.length - 1]));
    done({
      key: declineTwice ? 'refusal-twice' : 'refusal-corrected', root, feature: RT_FEATURE, frameworkRoot: REPO_ROOT, runIds: [run],
      interventions: [],
      acceptance: productFixed()
        ? { result: 'pass', actor: 'reliability-scenarios', basis: `产品源码含 ${S13_FIX}` }
        : { result: 'fail', actor: 'reliability-scenarios', basis: `产品源码不含 ${S13_FIX}` },
      after: firstTestingFail >= 0 ? { run_id: run, event_index: firstTestingFail } : undefined,
      hit: {
        ok: bts.length >= 1 && refusedWithoutChange && declines.length >= 1 && declines.every(d => d.length === 1),
        evidence: `testing→coding 回退 ${bts.length} 次；拒修轮 ${declines.length} 次（每轮账本行数 ${declines.map(d => d.length).join('/')}）`,
      },
      expectation: declineTwice
        ? (t) => {
          const reasons = [
            !t.facts.claimed_complete || '宣称了完成',
            ['repair_not_converging', 'backtrack_fingerprint_repeat', 'backtrack_limit'].includes(String(t.stop_state?.halt_reason)) || `停机原因=${t.stop_state?.halt_reason}`,
            bts.length === 2 || `反驳轮只放行一次，回退应恰 2 次，实得 ${bts.length}`,
            (guidance.includes('执行者拒修依据') && guidance.includes(`「${GOAL_QUOTE}」`)) || '停机说明缺执行者拒修依据原文',
            guidance.includes(S13_DEFECT) || '停机说明缺裁判缺陷描述原文（S13_DEFECT 全文）',
          ].filter((x): x is string => typeof x === 'string');
          return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `停在 ${t.stop_state?.halt_reason}；未宣称完成；停机说明并列双方原文` };
        }
        : (t) => {
          const reasons = [
            t.conclusion === 'correct_completion' || `结论=${t.conclusion}`,
            !firstDeclineHalted || '第一轮拒修即终局',
            bts.length === 2 || `拒修后裁判再提应进入反驳轮（回退 2 次），实得 ${bts.length}`,
            rebuttalShown || '反驳轮提示词未写明上一轮拒修依据',
          ].filter((x): x is string => typeof x === 'string');
          return { met: reasons.length === 0, detail: reasons.length ? reasons.join('；') : `第一轮拒修不终局；裁判再提进入反驳轮；反驳轮修复；结论=${t.conclusion}（coding 所见最大回退数 ${backtracksSeenByCoding}）` };
        },
      extras: { halt_guidance_head: guidance.slice(0, 400) },
    });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
  };
}

// ---------------------------------------------------------------------------
// 场景表与执行
// ---------------------------------------------------------------------------

/** 顺序即执行顺序；S10 的新格式分支在 S3 的宿主里产出，故 S10 先登记、S3 执行时写入。 */
export const SCENARIOS: Array<{ id: string; run: ScenarioRunner[] }> = [
  { id: 'S1', run: [runS1, runS1Formal, runS1Budget, runBe091cOrphan, runBe091cScope] },
  { id: 'S2', run: [runS2, runS2Codex] },
  { id: 'S10', run: [runS10] },
  { id: 'S3', run: [runS3] },
  { id: 'S4', run: [acceptanceChangeBranch(true), acceptanceChangeBranch(false)] },
  { id: 'S5', run: [runS5] },
  { id: 'S6', run: [runS6] },
  { id: 'S7', run: [runS7] },
  { id: 'S8', run: [runS8] },
  { id: 'S9', run: [runS9Wait, runS9] },
  { id: 'S11', run: [runS11Branch(true), runS11Branch(false)] },
  { id: 'S12', run: [runS12] },
  { id: 'S13', run: [runS13Branch(false), runS13Branch(true)] },
];

/** 按断言策略评估一个分支：命中恒断言；baseline_met / correct_stop 断言期望；gap_only 只打印差距。 */
export function evaluateOutcome(o: BranchOutcome): void {
  assert(o.hit.ok, `扰动未命中目标分支：${o.hit.evidence}`);
  if (o.layer === '函数级') assert(!o.task && !!o.prediction, '函数级预判没有执行扰动后的任务，不得产出任务实测（只能进 predictions）');
  if (o.policy === 'gap_only') {
    if (!o.expectation.met) console.log(`[reliability-scenarios] 差距 ${o.id}/${o.key}：${o.expectation.detail}`);
  } else {
    assert(o.expectation.met, `期望未达成（${o.policy}）：${o.expectation.detail}`);
  }
}

const ACCEPT_RANK: Record<AcceptanceFact['result'], number> = { fail: 2, not_accepted: 1, pass: 0 };

/**
 * 结果文件（RELIABILITY_RESULTS_OUT）：
 *  · tasks：实际执行的任务，同一工程同一组 run（taskKey）只汇总一次；独立验收取各分支检查中最差的一项
 *    （任一失败即失败），结论由采集器按事实重算；
 *  · predictions：函数级预判（未执行任务），不进任何指标；
 *  · branches：每个登记分支的检查结果（命中、期望、策略），指回所属任务或预判。
 */
export function buildResultsDoc(outcomes: BranchOutcome[]): Record<string, unknown> {
  const groups = new Map<string, BranchOutcome[]>();
  for (const o of outcomes) {
    if (!o.task) continue;
    const key = o.taskKey ?? `${o.id}/${o.key}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const tasks = [...groups.values()].map((group) => {
    const first = group[0];
    const worst = group.map(o => o.task!.facts.acceptance).reduce((a, b) => (ACCEPT_RANK[b.result] > ACCEPT_RANK[a.result] ? b : a));
    const acceptance: AcceptanceFact = group.length === 1 ? worst : {
      result: worst.result, actor: 'reliability-scenarios',
      basis: [...new Set(group.map(o => o.task!.facts.acceptance.basis ?? ''))].filter(Boolean).join('；'),
    };
    const facts = { ...first.task!.facts, acceptance };
    return {
      ...first.task!,
      facts,
      conclusion: deriveConclusion(facts),
      scenario_meta: {
        id: first.id,
        ...(group.length === 1 ? { branch: first.key } : {}),
        branches: group.map(o => o.key),
        labels: group.map(o => o.label),
      },
    };
  });
  return {
    schema: 'reliability-scenario-results/2',
    recorded_at: new Date().toISOString(),
    tasks,
    predictions: outcomes.filter(o => o.prediction).map(o => o.prediction),
    branches: outcomes.map(o => ({
      id: o.id, branch: o.key, label: o.label, policy: o.policy, layer: o.layer ?? null, hit: o.hit, expectation: o.expectation, extras: o.extras,
      task_id: o.task?.task_id ?? null, function_level_prediction: !!o.prediction,
    })),
  };
}

// ---------------------------------------------------------------------------
// 自检（纯函数，秒级；每次 runScenarios 都先跑，不受场景过滤影响）
// ---------------------------------------------------------------------------

function fakeTask(label: string, acceptance: AcceptanceFact, extra: Partial<TaskReport> = {}): TaskReport {
  return {
    task_id: label, source: 'collector', scenarios: [label.split('/')[0]], recoverable_fault: false, runs: [], missing_runs: [], successor_clues: [],
    facts: { claimed_complete: true, claimed_basis: 'run_end', record: { evaluable: false, reason: 'self-check' }, acceptance },
    conclusion: acceptance.result === 'pass' ? 'correct_completion' : 'wrong_completion', stop_state: null,
    operator: { known: true, candidates: [], interventions: [], rescue_count: 0, unnecessary_count: 0, necessity_unknown: 0, product_decisions: 0 },
    recovery_cost: { status: 'no_failure', measured_to: null, wall_ms: null, active_ms: null, agent_invocations: null, faults: [] },
    unaffected_reruns: { exact: null, proxy: null, note: 'self-check' }, ...extra,
  };
}

const SELF_CHECKS: Array<{ name: string; run: (registry: Map<string, RegistryEntry>) => void }> = [
  {
    name: '自检 返修 5：同一工程同一 run 的两个分支只汇总一个任务，独立验收涵盖两项（A 通过、B 失败 → 不计正确完成）',
    run: () => {
      const task = (key: string, result: AcceptanceFact['result']): BranchOutcome => ({
        id: 'S7', key, label: key, policy: 'gap_only', hit: { ok: true, evidence: '' }, expectation: { met: true, detail: '' }, extras: {},
        task: fakeTask(`S7/${key}`, { result, actor: 'self-check', basis: key }), taskKey: 'root|run-1',
      } as BranchOutcome);
      const doc = buildResultsDoc([task('a', 'pass'), task('b', 'fail')]) as { tasks: TaskReport[] };
      assert(doc.tasks.length === 1, `同一 run 应只汇总一个任务，实得 ${doc.tasks.length}`);
      assert(doc.tasks[0].facts.acceptance.result === 'fail', `任务独立验收应涵盖两项（B 失败 → 失败）：${doc.tasks[0].facts.acceptance.result}`);
      const report = collectReliability({ scenarioResults: [doc as { tasks: TaskReport[] }] });
      assert(report.metrics.correct_autonomous_completion.numerator === 0 && report.metrics.correct_autonomous_completion.denominator === 1,
        `不得贡献正确完成分子：${JSON.stringify(report.metrics.correct_autonomous_completion)}`);
    },
  },
  {
    name: '自检 返修 6：S7 独立断言的反例用固定输入（缺少披露 → 判未披露）；框架以后正确披露时真实链路分支不转红',
    run: (registry) => {
      const lacking = [{ id: 'derived_selector_contract', status: 'PASS', details: '无 selector 问题' }, { id: 'hylyre_evidence_gate', status: 'PASS', details: 'native evidence gate PASS' }];
      const withWarn = [{ id: 'derived_selector_contract', status: 'WARN', details: '- TC-002 step 0 by_id=all_banks: by_id 不在当前 feature ui-spec' }];
      assert(!s7Disclosed(lacking, S7_CONFLICT_A), '固定的缺少披露的输入须判未披露');
      assert(s7Disclosed(withWarn, S7_CONFLICT_A), '固定的带披露的输入须判已披露');
      const entry = registry.get('S7');
      assert(entry, '登记表缺 S7');
      for (const b of entry.branches.filter(x => x.key !== 'disclosed')) {
        const t = fakeTask(`S7/${b.key}`, { result: 'pass', actor: 'self-check', basis: '假设框架已正确披露冲突 B' });
        const o: BranchOutcome = { id: 'S7', key: b.key, label: b.label, policy: b.assertion, hit: { ok: true, evidence: '' },
          expectation: s7Expectation(b.key, t, { a: true, b: true }), extras: {}, task: t };
        evaluateOutcome(o);
      }
    },
  },
  {
    name: '自检 返修 7：S5 命中须在运行时 gate 产出上看到排除证据（[requirement_excluded] 与 result_nfc_card）',
    run: () => {
      const plain = { id: 'visual_diff', category: 'structure', description: 'visual diff', severity: 'MAJOR', status: 'PASS', details: 'screens=1；pass=1；defects=0' } as CheckResult;
      const excluded = { ...plain, details: 'screens=1；pass=1；defects=1\n[requirement_excluded] 需求排除项（引文「…」）：1 条缺陷不返修（add_card_result/result_nfc_card）' } as CheckResult;
      assert(!s5ExclusionHit([plain]), '只有 gate 执行、没有排除证据时不得判命中');
      assert(s5ExclusionHit([excluded]), '运行时 gate 带排除证据时须判命中');
    },
  },
  {
    name: '自检 批三返修 R6：be091c 第二现场的独立验收只看产物，框架完成宣称改变时不变；产物不对时即使宣称完成也判失败',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-be091c-'));
      try {
        const f = 'demo-card';
        writeHostFile(root, `doc/features/${f}/ut/reports/phase-evidence-manifest.json`, '{}');
        writeHostFile(root, `doc/features/${f}/ut/reports/summary.json`, JSON.stringify({ verdict: 'PASS' }));
        const a = beScopeAcceptance(root, f, { status: 'CHAIN_SLICE_COMPLETED' });
        const b = beScopeAcceptance(root, f, { status: 'HALTED' });
        assert(a.result === 'pass' && a.result === b.result, `只改 run_end.status 不得改变独立验收：${a.result} vs ${b.result}`);
        fs.rmSync(path.join(root, `doc/features/${f}/ut/reports/phase-evidence-manifest.json`));
        assert(beScopeAcceptance(root, f, { status: 'CHAIN_SLICE_COMPLETED' }).result === 'fail', '产物不对时即使框架宣称完成也须判失败');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '自检 返修 8：S9 独立验收只由产品与独立结果决定，框架返回码改变时不变',
    run: () => {
      const host = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-s9-'));
      try {
        writeHostFile(host, DRIVER_PRODUCT, 'struct SamplePage { build() { Text("x") } }');
        writeHostFile(host, `doc/features/${S9_FEATURE}/testing/reports/summary.json`, JSON.stringify({ verdict: 'PASS' }));
        const a = s9Acceptance(host, { exitCode: 0, phaseStartsThisCall: ['ut', 'testing'] });
        const b = s9Acceptance(host, { exitCode: 1, phaseStartsThisCall: [] });
        assert(a.result === b.result, `框架返回码改变不得改变独立验收：${a.result} vs ${b.result}`);
        assert(a.result === 'pass', `产品在、testing 结果在即通过：${a.basis}`);
      } finally {
        fs.rmSync(host, { recursive: true, force: true });
      }
    },
  },
];

function line(o: BranchOutcome, ms: number): string {
  const t = o.task;
  if (!t) {
    const p = o.prediction!;
    return `[reliability-scenarios] ${o.id}/${o.key} 函数级预判，未执行任务：预判出生链=${JSON.stringify(p.predicted_chain)}`
      + ` 预判重跑已执行阶段=${p.predicted_reruns} 期望达成=${o.expectation.met ? '是' : '否'} 策略=${o.policy} 耗时=${(ms / 1000).toFixed(1)}s`;
  }
  const s = t.stop_state;
  const stop = s ? `${s.status ?? '无 run_end'}/${s.halt_reason ?? '-'}/${s.run_disposition}${s.run_wait_kind ? `+${s.run_wait_kind}` : ''}${s.reading ? `(${s.reading})` : ''}` : '-';
  return `[reliability-scenarios] ${o.id}/${o.key} 宣称完成=${t.facts.claimed_complete ? '是' : '否'} 独立验收=${t.facts.acceptance.result}`
    + ` 结论=${t.conclusion} 停止=${stop} 操作者动作=${t.operator.rescue_count ?? '未知'} 候选=${t.operator.candidates.length}`
    + ` 无影响重跑=${t.unaffected_reruns.exact ?? `代理 ${t.unaffected_reruns.proxy ?? '-'}`} 期望达成=${o.expectation.met ? '是' : '否'} 策略=${o.policy} 耗时=${(ms / 1000).toFixed(1)}s`;
}

export async function runScenarios(only?: string[]): Promise<{ results: UnitCaseResult[]; outcomes: BranchOutcome[] }> {
  const registry = loadRegistry();
  const results: UnitCaseResult[] = [];
  const outcomes: BranchOutcome[] = [];
  s10Entry = registry.get('S10');
  const s10Pending: BranchOutcome[] = [];
  s10Outcomes = s10Pending;
  for (const check of SELF_CHECKS) {
    try { check.run(registry); results.push({ name: check.name, ok: true }); } catch (e) { results.push({ name: check.name, ok: false, error: (e as Error).message }); }
  }
  for (const scenario of SCENARIOS.filter(x => !only || only.includes(x.id))) {
    const entry = registry.get(scenario.id);
    if (!entry) { results.push({ name: `${scenario.id} <registry>`, ok: false, error: '登记表缺该场景' }); continue; }
    const mine: BranchOutcome[] = [];
    const collect = makeCollector(entry, mine);
    for (const runner of scenario.run) {
      const started = Date.now();
      const before = mine.length;
      // 生产代码在进程内偶有 process.exit（启动期 BLOCKER）：拦成异常，不让它带走整个 run-unit。
      const realExit = process.exit;
      process.exit = ((code?: number) => {
        throw new Error(`process.exit(${code}) 被场景拦截（进程内 goalMain 的启动期退出）`);
      }) as typeof process.exit;
      try {
        await runner(entry, collect);
      } catch (e) {
        results.push({ name: `${entry.id} ${entry.title} <driver>`, ok: false, error: (e as Error).stack ?? (e as Error).message });
      } finally {
        process.exit = realExit;
      }
      const ms = Date.now() - started;
      const produced = [...mine.slice(before), ...(scenario.id === 'S3' ? s10Pending.splice(0) : [])];
      for (const o of produced) {
        console.log(line(o, ms));
        outcomes.push(o);
        const name = `${o.id} ${registry.get(o.id)?.title ?? entry.title} / ${o.label}`;
        try {
          evaluateOutcome(o);
          results.push({ name, ok: true });
        } catch (e) {
          results.push({ name, ok: false, error: (e as Error).message });
        }
      }
    }
  }
  // 每个登记分支都须有一条实测（S10 新格式分支产自 S3 的宿主，只跑 S10 时不要求）。
  const ran = new Set(SCENARIOS.map(x => x.id).filter(id => !only || only.includes(id)));
  for (const id of ran) {
    const entry = registry.get(id);
    for (const b of entry?.branches ?? []) {
      if (id === 'S10' && b.key === 'new-format' && !ran.has('S3')) continue;
      if (!outcomes.some(o => o.id === id && o.key === b.key)) {
        results.push({ name: `${id} ${entry!.title} / ${b.label} <missing>`, ok: false, error: '分支未产出实测' });
      }
    }
  }
  s10Entry = undefined;
  s10Outcomes = undefined;
  const out = process.env.RELIABILITY_RESULTS_OUT;
  if (out) {
    const doc = buildResultsDoc(outcomes);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
    console.log(`[reliability-scenarios] 实测已写入 ${path.resolve(out)}`);
  }
  return { results, outcomes };
}

export async function runAll(): Promise<UnitCaseResult[]> {
  return (await runScenarios()).results;
}
