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

const cases: TestCase[] = [
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
