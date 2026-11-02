// Real tool deadline: bounded process cleanup and frozen output after return.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_CHILD_SETTLE_GRACE_MS, DEFAULT_FORCE_SETTLE_AFTER_KILL_MS, DEFAULT_KILL_INFLIGHT_DRAIN_MS, DEFAULT_KILL_PROCESS_TREE_WAIT_MS, invokeAgentHeadless, resolveKillGraceMs, type HeadlessInvokePlan } from '../../scripts/utils/agent-invoke';

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
    name: 't3/t4 真子进程：kill 有界返回且 agent-output.log 在返回后封存',
    run: withTmp(async (dir) => {
      const timeoutMs = 400;
      const logPath = path.join(dir, 'agent-output.log');
      const started = Date.now();
      const res = await invokeAgentHeadless(fakeAgentPlan(true), dir, {
        timeoutMs,
        outputLogPath: logPath,
      });
      const elapsed = Date.now() - started;
      const bound = timeoutMs + resolveKillGraceMs();
      assert(res.timed_out === true, `假 agent 永不自退，应判超时：${JSON.stringify(res.timed_out)}`);
      assert(
        elapsed <= bound,
        `跨进程总时长越界：${elapsed}ms > ${bound}ms（= timeout ${timeoutMs} + grace ${resolveKillGraceMs()}）` +
        '——kill/settle 没有有界返回，实际工具截止与清理就没有上界',
      );
      const sizeAtReturn = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      await new Promise((r) => setTimeout(r, 500));
      const sizeLater = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      assert(sizeLater === sizeAtReturn, `kill 后日志仍在增长：${sizeAtReturn} → ${sizeLater} 字节`);
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
