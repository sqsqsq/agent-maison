// ============================================================================
// goal-budget-integration.unit.test.ts — 硬预算与证据卫生的**集成**断言
// （plan d6b1a8e3 t3 / t4）
// ----------------------------------------------------------------------------
// 为什么单测装不下、非要测试床：
//   t3 的核心不等式「agent + harness + backoff 三路径总时长 ≤ wall + resolveKillGraceMs()」
//   是**跨进程**性质——它断言的是「子进程被杀之后 invoke 真的会在有界时间内返回」，
//   纯函数层面根本观察不到。t4「kill 后 agent-output.log 字节不变」同理：要证明的是
//   进程被杀那一刻的落盘状态。
//
// 测试床形态（刻意保持最小，不引入框架）：
//   · 可控假 agent = 一个真的 node 子进程（永不自退，可选持续写 stdout）；
//   · 时钟推进 = 用**真实的小超时**（数百毫秒）而非 mock——mock 掉时钟就测不到
//     真实 kill/settle 的耗时，那正是本不等式要保护的东西；
//   · grace 一律由 resolveKillGraceMs() 派生，**禁止在此另造脱钩常量**
//     （否则不等式不是真上界，plan 硬约束 3）。
// ============================================================================

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canAffordBackoff, FINALIZE_RESERVE_MS } from '../../scripts/utils/goal-timeout';
import {
  DEFAULT_CHILD_SETTLE_GRACE_MS,
  DEFAULT_FORCE_SETTLE_AFTER_KILL_MS,
  DEFAULT_KILL_INFLIGHT_DRAIN_MS,
  DEFAULT_KILL_PROCESS_TREE_WAIT_MS,
  invokeAgentHeadless,
  resolveKillGraceMs,
  type HeadlessInvokePlan,
} from '../../scripts/utils/agent-invoke';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { assessFeature } from '../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { buildSupersedeAuditEvent, createGoalRun } from '../../scripts/utils/goal-run-creation';
import { foldBudgetLineage, loadAuthoritativeEvents, resolveResumedBudget, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { loadHostSnapshot, SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { completionOriginal, readJson, runFile, runIds, supersede } from './successor-exit.unit.test';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { resolveSuccessorExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveWorkflowSpec } from '../../workflow-loader';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => Promise<void> | void }

function withTmp(run: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-budget-'));
    try { await run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

/**
 * 可控假 agent：在测试预算内不自退；`chatty` 时持续写 stdout（证据卫生用例）。
 *
 * **自杀兜底 SUICIDE_MS 是硬要求**：本文件断言的正是「kill 有界」，一旦回归导致 kill
 * 失效，没有兜底的子进程会把整个测试套挂死（实测踩过：`timeoutMs: 0` 在实现里是
 * 「无超时」而非「零预算」，假 agent 于是永远跑下去，300s 超时才被外部掐断）。
 * 兜底远大于用例预算（400ms），不会掩盖真失败——只保证失败以「断言红」而非
 * 「整套挂死」的形式暴露。
 */
const SUICIDE_MS = 20_000;

function fakeAgentPlan(chatty: boolean): HeadlessInvokePlan {
  const suicide = `const t=setTimeout(()=>process.exit(0),${SUICIDE_MS}); if(t.unref) t.unref();`;
  const tick = chatty
    ? "setInterval(()=>process.stdout.write('tick\\n'),20);"
    : '';
  return {
    argv: [process.execPath, '-e', `${suicide}${tick}setInterval(()=>{},1000);`],
    label: 'fake-agent(bounded-by-suicide-fallback)',
    adapter: 'generic',
  } as unknown as HeadlessInvokePlan;
}

// ---------------------------------------------------------------------------
// plan c4e7a9b2 §3.3 B1：预算以可信完成为交付周期边界——宿主 ae92d8 形状的集成夹具。
// 上一版宿主快照（demo-card 完成 run = F，record ok）+ 生产 createGoalRun / 审计事件 builder 造两个失败 run：
//   F（成功，补 1 次回退）→ N=97af3f（失败，无 supersede）→ O=0457a6（失败，supersede F+N）→ 后继 S supersede F/N/O。
// 后继经公开入口 goal-runner `--supersede`（进程内 goalMain，假 agent 一律失败）出生；断言只看结果数字。
// ---------------------------------------------------------------------------
type Snapshot = ReturnType<typeof loadHostSnapshot>;
const B1_FEATURE = SNAPSHOT_FLAT_FEATURE;
const RUN_N = '20260926T090000Z-97af3f';
const RUN_O = '20260926T120000Z-0457a6';
const N_TURNS = 2;
const O_TURNS = 1;

const eventsOf = (s: Snapshot, runId: string): GoalRunEvent[] =>
  loadAuthoritativeEvents(runFile(s.root, B1_FEATURE, runId, 'events.jsonl'));
const countType = (events: readonly GoalRunEvent[], type: string): number => events.filter(e => e.type === type).length;

/** 生产 createGoalRun 建一个失败终态 run（manifest 取 F 的形状换身份），再按 runtime 的事件形状写入轮次与审计。 */
function seedFailedRun(s: Snapshot, source: string, runId: string, supersedes: string[], turns: number): void {
  const src = readJson<GoalManifest>(runFile(s.root, B1_FEATURE, source, 'manifest.json'));
  const manifest = { ...src, run_id: runId, report_dir: src.report_dir.replace(source, runId) } as GoalManifest;
  createGoalRun({ projectRoot: s.root, manifest, chain: src.phase_chain ?? [], resolveHead: () => 'a'.repeat(40) });
  const at = (): string => new Date().toISOString();
  const lines: Array<Record<string, unknown>> = [
    { ts: at(), type: 'run_start', dry_run: false, chain: src.phase_chain },
    ...supersedes.map(target => ({ ts: at(), ...buildSupersedeAuditEvent({ targetRunId: target, supersedingRunId: runId }) })),
    ...Array.from({ length: turns }, () => ({ ts: at(), type: 'agent_invoke_start', phase: 'ut' })),
    { ts: at(), type: 'run_end', status: 'HALTED', halt_reason: 'backtrack_limit' },
  ];
  fs.appendFileSync(runFile(s.root, B1_FEATURE, runId, 'events.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
}

/** F 自带 1 次回退：插在 run_end 之前（与真实 run 的事件次序一致）。 */
function addSourceBacktrack(s: Snapshot, source: string): void {
  const file = runFile(s.root, B1_FEATURE, source, 'events.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const end = lines.findIndex(line => JSON.parse(line).type === 'run_end');
  const ts = JSON.parse(lines[end - 1]).ts;
  lines.splice(end, 0, JSON.stringify({ ts, type: 'phase_backtrack_requested', from_phase: 'testing', to_phase: 'coding', invalidated_phases: ['coding'] }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function recordState(s: Snapshot): string {
  clearFrameworkConfigCache();
  return assessFeature(s.root, B1_FEATURE, { ...resolveChangeUnitExpectedExecution(s.root, B1_FEATURE), frameworkRoot: s.frameworkRoot }).record.state;
}

/** 捕获 runner 起步预算行（turns / 回退），其余 console 输出原样放行。 */
async function withRunnerBudgetLine<T>(run: () => Promise<T>): Promise<{ result: T; turns?: number; backtracks?: number }> {
  const prev = console.log;
  let turns: number | undefined;
  let backtracks: number | undefined;
  console.log = (...args: unknown[]): void => {
    const m = /(?:run_start|resume) 预算[^:]*: turns (\d+)\/\d+.*回退 (\d+) 次/.exec(args.map(String).join(' '));
    if (m) { turns = Number(m[1]); backtracks = Number(m[2]); }
    prev(...args);
  };
  try { return { result: await run(), turns, backtracks }; } finally { console.log = prev; }
}

/** 三处消费面：progress.json（生产投影落盘）、heartbeat（runtime writeHeartbeat 的同一折叠调用形状，读本 run 事件）。 */
function progressAndHeartbeatTurns(s: Snapshot, runId: string): { progress: number; heartbeat: number } {
  const progress = readJson<{ budget: { turns_used: number } }>(runFile(s.root, B1_FEATURE, runId, 'progress.json')).budget.turns_used;
  const lineage = foldBudgetLineage({ projectRoot: s.root, featuresDir: 'doc/features', feature: B1_FEATURE, currentEvents: eventsOf(s, runId) });
  return { progress, heartbeat: resolveResumedBudget(lineage.budgetFoldEvents, { nextSessionStartMs: Date.now() }).totalTurns };
}

async function withAe92d8(run: (s: Snapshot, source: string) => Promise<void>): Promise<void> {
  const s = loadHostSnapshot();
  try {
    clearFrameworkConfigCache();
    const [source] = runIds(s.root, B1_FEATURE);
    addSourceBacktrack(s, source);
    seedFailedRun(s, source, RUN_N, [], N_TURNS);
    seedFailedRun(s, source, RUN_O, [source, RUN_N], O_TURNS);
    // 后继只需重跑 ut（同 successor-exit #9），出生链非空
    fs.rmSync(featureFilePath(s.root, B1_FEATURE, 'ut/reports/phase-evidence-manifest.json'));
    await run(s, source);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(s.root, { recursive: true, force: true });
  }
}

/** ut 结果恒 FAIL：后继像宿主 ae92d8 一样停在失败终态（未封卷，可 resume）。 */
const utFails = {
  onHarnessSummary: ({ phase }: { phase: string }) => phase === 'ut'
    ? { blockers: [{ id: 'repair', severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression', details_excerpt: 'ut still failing', actionability: 'agent_fixable' }] }
    : null,
};

async function bornSuccessor(s: Snapshot, source: string, chain: string[] = ['ut']): Promise<{ successor: string; turns?: number; backtracks?: number }> {
  const { result, turns, backtracks } = await withRunnerBudgetLine(() => supersede(s, B1_FEATURE, source, chain, { supersede: [source, RUN_N, RUN_O], ...utFails }));
  assert(result.successor, `后继未出生：${result.error}`);
  return { successor: result.successor!, turns, backtracks };
}

const b1Cases: TestCase[] = [
  {
    name: 'B1-1 ae92d8 形状：record ok 的完成 run 为交付周期边界——出生回退 0、turns 不含 F；N/O 照计；runner / progress.json / heartbeat 三处一致',
    run: () => withAe92d8(async (s, source) => {
      assert(recordState(s) === 'ok', `前提：F 完成记录可信（record=${recordState(s)}）`);
      const F_TURNS = countType(eventsOf(s, source), 'agent_invoke_start');
      assert(countType(eventsOf(s, source), 'phase_backtrack_requested') === 1 && F_TURNS > 0, '前提：F 自带 1 次回退与若干轮');
      const { successor, turns, backtracks } = await bornSuccessor(s, source);
      const audits = eventsOf(s, successor).filter(e => e.type === 'supersede') as Array<GoalRunEvent & { target_run_id?: string; delivery_cycle_boundary?: string }>;
      assert(audits.length === 3 && audits.every(e => e.delivery_cycle_boundary === source), `每条 supersede 审计应带边界 ${source}：${JSON.stringify(audits)}`);
      assert(backtracks === 0, `runner 出生回退计数应为 0（上一周期 F 的回退不占额度），实得 ${backtracks}`);
      assert(turns === N_TURNS + O_TURNS, `runner 出生 turns 应只含 N+O=${N_TURNS + O_TURNS}（不含 F 的 ${F_TURNS}），实得 ${turns}`);
      const own = countType(eventsOf(s, successor), 'agent_invoke_start');
      const { progress, heartbeat } = progressAndHeartbeatTurns(s, successor);
      assert(progress === N_TURNS + O_TURNS + own, `progress.json turns_used 应为 N+O+本 run=${N_TURNS + O_TURNS + own}，实得 ${progress}`);
      assert(heartbeat === progress, `heartbeat 与 progress.json 应同源：${heartbeat} vs ${progress}`);
    }),
  },
  {
    name: 'B1-2 F 完成原件被篡改（record broken）→ 不设边界，按现状全链折叠',
    run: () => withAe92d8(async (s, source) => {
      // 篡改原件内容并同步投影哈希：记录仍指得出 run_id（F），但内容不可信（record broken）——
      // 这样「源 run 有完成记录即边界」与「record ok 才是边界」可区分
      const original = completionOriginal(s, B1_FEATURE);
      const tampered = JSON.stringify({ ...readJson<Record<string, unknown>>(original), phases: 'tampered' });
      fs.writeFileSync(original, tampered);
      const projectionFile = featureFilePath(s.root, B1_FEATURE, 'feature-completion.json');
      fs.writeFileSync(projectionFile, JSON.stringify({
        ...readJson<Record<string, unknown>>(projectionFile),
        original_sha256: createHash('sha256').update(tampered, 'utf-8').digest('hex'),
      }));
      clearFrameworkConfigCache();
      const inspected = assessFeature(s.root, B1_FEATURE, { ...resolveChangeUnitExpectedExecution(s.root, B1_FEATURE), frameworkRoot: s.frameworkRoot }).record;
      assert(inspected.state === 'broken' && inspected.run_id === source, `前提：record broken 且仍指向 F（实得 ${JSON.stringify(inspected)}）`);
      const F_TURNS = countType(eventsOf(s, source), 'agent_invoke_start');
      // record broken 后评估不再复用源证据，出生链由同一生产函数重解析（goal-runner 要求 --start/--end 与之逐字相等）
      const requirement = readJson<{ requirement: string }>(runFile(s.root, B1_FEATURE, source, 'manifest.json')).requirement;
      const chain = resolveSuccessorExecutionScope(s.root, B1_FEATURE, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement, source)!.phase_chain;
      const { successor, turns, backtracks } = await bornSuccessor(s, source, chain);
      const audits = eventsOf(s, successor).filter(e => e.type === 'supersede') as Array<GoalRunEvent & { delivery_cycle_boundary?: string }>;
      assert(audits.length === 3 && audits.every(e => e.delivery_cycle_boundary === undefined), `record broken 不得写边界：${JSON.stringify(audits)}`);
      assert(backtracks === 1, `全链折叠应继承 F 的 1 次回退，实得 ${backtracks}`);
      assert(turns === F_TURNS + N_TURNS + O_TURNS, `全链折叠 turns 应为 F+N+O=${F_TURNS + N_TURNS + O_TURNS}，实得 ${turns}`);
    }),
  },
  {
    name: 'B1-4 resume 同一后继：从本 run 事件的 delivery_cycle_boundary 得到同一结果（runner / progress.json / heartbeat）',
    run: () => withAe92d8(async (s, source) => {
      const { successor } = await bornSuccessor(s, source);
      const ownBefore = countType(eventsOf(s, successor), 'agent_invoke_start');
      // resume cooldown 是独立硬防线（判定早于 --force-resume）——与既有用例同法把 run_end 回拨 10 分钟
      const evFile = runFile(s.root, B1_FEATURE, successor, 'events.jsonl');
      fs.writeFileSync(evFile, fs.readFileSync(evFile, 'utf8').split('\n').map(line => {
        if (!line.includes('"run_end"')) return line;
        const e = JSON.parse(line) as { ts: string };
        return JSON.stringify({ ...e, ts: new Date(Date.parse(e.ts) - 10 * 60 * 1000).toISOString() });
      }).join('\n'));
      const { turns, backtracks } = await withRunnerBudgetLine(() => runGoalRuntimeChain(s.root, {
        frameworkRoot: s.frameworkRoot, featureId: B1_FEATURE, adapter: 'codex', resume: successor, forceResume: true,
        failExecutorFor: () => true, ...utFails,
      }));
      clearFrameworkConfigCache();
      assert(backtracks === 0, `resume 回退计数应为 0，实得 ${backtracks}`);
      assert(turns === N_TURNS + O_TURNS + ownBefore, `resume turns 应为 N+O+本 run 已用=${N_TURNS + O_TURNS + ownBefore}，实得 ${turns}`);
      const own = countType(eventsOf(s, successor), 'agent_invoke_start');
      const { progress, heartbeat } = progressAndHeartbeatTurns(s, successor);
      assert(progress === N_TURNS + O_TURNS + own && heartbeat === progress, `resume 后 progress/heartbeat 应为 ${N_TURNS + O_TURNS + own}：${progress}/${heartbeat}`);
    }),
  },
];

const cases: TestCase[] = [
  ...b1Cases,
  {
    name: 't3 不等式：agent 被 wall 超时杀死后，invoke 总时长 ≤ timeout + resolveKillGraceMs()（真子进程）',
    run: withTmp(async (dir) => {
      const timeoutMs = 400;
      const started = Date.now();
      const res = await invokeAgentHeadless(fakeAgentPlan(false), dir, {
        timeoutMs,
        outputLogPath: path.join(dir, 'agent-output.log'),
      });
      const elapsed = Date.now() - started;
      const bound = timeoutMs + resolveKillGraceMs();
      assert(res.timed_out === true, `假 agent 永不自退，应判超时：${JSON.stringify(res.timed_out)}`);
      assert(
        elapsed <= bound,
        `跨进程总时长越界：${elapsed}ms > ${bound}ms（= timeout ${timeoutMs} + grace ${resolveKillGraceMs()}）` +
        '——kill/settle 没有有界返回，wall 硬预算就不是硬的',
      );
    }),
  },
  {
    name: 't3 grace 同源：resolveKillGraceMs 必须由四常量派生，禁脱钩常量（否则不等式不是真上界）',
    run: () => {
      const expected =
        DEFAULT_CHILD_SETTLE_GRACE_MS +
        DEFAULT_FORCE_SETTLE_AFTER_KILL_MS +
        DEFAULT_KILL_PROCESS_TREE_WAIT_MS +
        DEFAULT_KILL_INFLIGHT_DRAIN_MS;
      assert(
        resolveKillGraceMs() === expected,
        `grace 与四常量脱钩：${resolveKillGraceMs()} ≠ ${expected}——` +
        '任一 kill/settle 参数改了而 grace 没跟上，不等式立刻失真',
      );
      // 四常量本身必须为正：任何一项归零都意味着该阶段无上界
      for (const [n, v] of [
        ['CHILD_SETTLE', DEFAULT_CHILD_SETTLE_GRACE_MS],
        ['FORCE_SETTLE_AFTER_KILL', DEFAULT_FORCE_SETTLE_AFTER_KILL_MS],
        ['KILL_PROCESS_TREE_WAIT', DEFAULT_KILL_PROCESS_TREE_WAIT_MS],
        ['KILL_INFLIGHT_DRAIN', DEFAULT_KILL_INFLIGHT_DRAIN_MS],
      ] as const) {
        assert(v > 0, `${n} 不得为 0——该阶段将无有界保证`);
      }
    },
  },
  {
    name: 't3 zero-budget / backoff 终局：剩余预算装不下配置 backoff 即不睡，直接终局',
    run: () => {
      // 纠正（实测得来）：invokeAgentHeadless 的 `timeoutMs: 0` 语义是**无超时**而非零预算
      //（`timeoutMs && timeoutMs > 0` 才装 timer），零预算判定根本不在 invoke 层。
      // 它的真实所在是 goal-timeout 的 canAffordBackoff——剩余预算装不下**配置的**
      // backoff 就不睡，直接 budget_wall_clock 终局（睡完残量也跑不动 attempt，
      // 只是把「卡到总超时」的体验再拖一截）。
      assert(canAffordBackoff(5_000, 10_000) === true, '预算充足应可 backoff');
      assert(canAffordBackoff(5_000, 5_000) === true, '恰好装下应可 backoff');
      assert(canAffordBackoff(5_000, 4_999) === false, '装不下必须不睡，直接终局');
      assert(canAffordBackoff(5_000, 0) === false, 'zero-budget 必须不睡');
      assert(canAffordBackoff(5_000, -1) === false, '负残量必须不睡');
      // 配置 backoff 本身为 0/负 → 无 backoff 可言，同样不得进入睡眠路径
      assert(canAffordBackoff(0, 10_000) === false, 'backoff=0 不构成可负担');
    },
  },
  {
    name: 't3 finalize_skipped：wall deadline 已过时收尾 pre-check 必须拦截（不得越界继续写）',
    run: () => {
      // 判据本体是 goal-runner 的 `Date.now() > wallDeadlineMs` pre-check。此处锁死它
      // 依赖的两件事：① 收尾预留是**具名常量**而非魔数；② 预留必须为正——预留归零
      // 等于「run 跑到最后一刻仍在跑」，收尾根本没有窗口，pre-check 必然恒真恒跳过。
      assert(FINALIZE_RESERVE_MS > 0, '收尾预留不得为 0——否则 finalize 永远无窗口');
      // 诚实边界（与 goal-runner 注释同源）：pre-check 只挡「开始前已超支」；已开始的
      // 同步收尾步骤没有进程内硬界（同步挂起时 timer 不运行），越界由 finalize_overrun
      // 如实留痕。本断言只覆盖 pre-check 侧，不假装覆盖硬中断。
      const wallDeadlineMs = 1_000_000;
      const skip = (nowMs: number): boolean => nowMs > wallDeadlineMs;
      assert(skip(wallDeadlineMs + 1) === true, '已超支必须跳过收尾');
      assert(skip(wallDeadlineMs) === false, '恰好抵达 deadline 不跳过（边界取 >，非 >=）');
      assert(skip(wallDeadlineMs - FINALIZE_RESERVE_MS) === false, '预留窗口内应正常收尾');
    },
  },
  {
    name: 't4 证据卫生：kill 之后 agent-output.log 字节数不再变化（进程被杀那一刻即封存）',
    run: withTmp(async (dir) => {
      const logPath = path.join(dir, 'agent-output.log');
      // chatty 假 agent 每 20ms 写一行——若 kill 后仍有写入，字节数必然继续涨
      await invokeAgentHeadless(fakeAgentPlan(true), dir, {
        timeoutMs: 400,
        outputLogPath: logPath,
      });
      const sizeAtReturn = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      await new Promise((r) => setTimeout(r, 500)); // 给「漏网的子进程」充分的写入机会
      const sizeLater = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      assert(
        sizeLater === sizeAtReturn,
        `kill 后日志仍在增长：${sizeAtReturn} → ${sizeLater} 字节——` +
        '说明子进程树没被真正杀干净，事后证据不可信（被杀 attempt 的日志会混入后续内容）',
      );
    }),
  },
];

export async function runAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const out: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      out.push({ name: testCase.name, ok: true });
    } catch (error) {
      out.push({ name: testCase.name, ok: false, error: (error as Error).message });
    }
  }
  return out;
}
