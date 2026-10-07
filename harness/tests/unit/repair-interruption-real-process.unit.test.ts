// ============================================================================
// repair-interruption-real-process.unit.test.ts — plan a2f7c9e4 t6（§4.2「真实进程中断可恢复」）
// ----------------------------------------------------------------------------
// 验证范围（如实）：返修窗口里的阶段调用不再用替身结果，而是由**脚本化执行者**（node 脚本，
// 逐行回放 fixtures/codex-terminal-completed.real.jsonl 的真实 `codex exec --json` 样本行）作为
// **真实子进程**，经生产 `invokeAgentHeadless`（spawn、Windows guardian containment 与绑定、
// codex 终态 JSONL 解析、settle、完成后收口 kill）产出调用结果；runtime 照生产路径落
// agent_invoke_end / agent_process_settled、跑 gate、决定重试与恢复。
//
// 它验证的是 spawn、终止与事件解析，**不等于真实 Codex CLI 中断已通过**：真实 CLI 被杀 /
// 断流时的输出形态、退出码与残留子进程仍待宿主证据。
//
// 夹具：既有隔离宿主 `setupGoalRuntimeHost` + `runGoalRuntimeChain`（与 repair-continuity 同一套）。
// 唯一改变是调用传输：包装 `__testing_setInvokeAgent` 收到的替身——替身照旧执行产物回调、
// 记录提示词与计数，返回值改用真实子进程的结果。不改夹具文件、不改生产代码。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  invokeAgentHeadless,
  killProcessTree,
  type AgentInvokeOptions,
  type AgentInvokeResult,
} from '../../scripts/utils/agent-invoke';
import { clearFrameworkConfigCache } from '../../config';
import {
  runGoalRuntimeChain, setupGoalRuntimeHost, PRODUCT_ASSERTION_CHECK, writeCleanTesting,
} from './goal-runner-testing-integrity.unit.test';
import type { UnitCaseResult } from '../run-unit';

/** complete：回放全部样本行后 exit 0；complete-then-linger：回放含 turn.completed 后不退出（等收口 kill）；
 *  exit-no-terminal：只回放非终态行后 exit 1；kill：只回放非终态行后挂住，由测试从外部杀进程树。 */
type Mode = 'complete' | 'complete-then-linger' | 'exit-no-terminal' | 'kill';

const COMPLETED_FIXTURE = path.join(__dirname, 'fixtures', 'codex-terminal-completed.real.jsonl');
const EXECUTOR_SCRIPT = [
  "const fs = require('fs');",
  'const [mode, fixture, ready] = process.argv.slice(2);',
  "const lines = fs.readFileSync(fixture, 'utf8').split(/\\r?\\n/).filter(Boolean);",
  "const terminal = lines.find(l => l.includes('\"turn.completed\"'));",
  "process.stdout.write(lines.filter(l => l !== terminal).join('\\n') + '\\n');",
  "if (mode === 'complete' || mode === 'complete-then-linger') process.stdout.write(terminal + '\\n');",
  "if (mode === 'kill') fs.writeFileSync(ready, String(process.pid));",
  "if (mode === 'kill' || mode === 'complete-then-linger') setInterval(() => {}, 1000);",
  "process.exitCode = mode === 'exit-no-terminal' ? 1 : 0;",
  '',
].join('\n');

interface RealInvoke { phase: string; attempt: number; mode: Mode; result: AgentInvokeResult }

async function waitFor(cond: () => boolean, tries = 200, intervalMs = 50): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return cond();
}

/** 用生产 options 原样（timeout / deadline / extraEnv / containment / onActiveChild …）起真实子进程。 */
async function scriptedInvoke(cwd: string, o: AgentInvokeOptions, mode: Mode): Promise<AgentInvokeResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-exec-'));
  const script = path.join(dir, 'scripted-executor.js');
  const ready = path.join(dir, 'ready');
  fs.writeFileSync(script, EXECUTOR_SCRIPT, 'utf-8');
  let pid = 0;
  try {
    const running = invokeAgentHeadless(
      { argv: [process.execPath, script, mode, COMPLETED_FIXTURE, ready], label: 'scripted-codex exec --json', adapterName: 'codex' },
      cwd,
      { ...o, onActiveChild: (child) => { pid = child.pid; o.onActiveChild?.(child); } },
    );
    if (mode !== 'kill') return await running;
    // 外部杀进程树（Windows 下 pid 是 guardian，KILL_ON_JOB_CLOSE 连带执行者）。就绪超时也照杀，保证有界。
    const readySeen = await waitFor(() => fs.existsSync(ready));
    const killed = await killProcessTree(pid);
    const result = await running;
    assert.ok(readySeen && killed.kill_attempted, `执行者未就绪或未能发起外部 kill：ready=${readySeen} pid=${pid}`);
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 在 body 执行期间，把 runGoalRuntimeChain 安装的替身调用包一层：替身先跑（产物回调、提示词与计数不变），
 * 返回值换成脚本化执行者真实子进程的结果。
 */
async function withRealTransport<T>(modeFor: (phase: string, attempt: number) => Mode, body: () => Promise<T>): Promise<{ value: T; invokes: RealInvoke[] }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const runtime = require('../../scripts/goal-phase-runtime') as { __testing_setInvokeAgent: (fn: unknown) => void };
  const original = runtime.__testing_setInvokeAgent;
  const invokes: RealInvoke[] = [];
  const attempts = new Map<string, number>();
  runtime.__testing_setInvokeAgent = (fn: unknown) => original(typeof fn !== 'function' ? fn : (async (plan: unknown, cwd: string, o: AgentInvokeOptions) => {
    await (fn as (...a: unknown[]) => Promise<unknown>)(plan, cwd, o);
    const phase = /\/phases\/([a-z-]+)\//.exec(String(o?.outputLogPath ?? '').split(path.sep).join('/'))?.[1] ?? '';
    const attempt = (attempts.get(phase) ?? 0) + 1;
    attempts.set(phase, attempt);
    const mode = modeFor(phase, attempt);
    const result = await scriptedInvoke(cwd, o, mode);
    invokes.push({ phase, attempt, mode, result });
    return result;
  }));
  try {
    return { value: await body(), invokes };
  } finally {
    runtime.__testing_setInvokeAgent = original;
  }
}

type Ev = Record<string, unknown>;
const ofType = (events: Ev[], type: string, phase?: string): Ev[] => events.filter(e => e.type === type && (phase === undefined || e.phase === phase));
const completedRun = (events: Ev[]): boolean => events.some(e => e.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(e.status)));
const testingFailsOnce = ({ phase, attempt }: { phase: string; attempt: number }) =>
  phase === 'testing' && attempt === 1 ? { checks: [PRODUCT_ASSERTION_CHECK] } : null;

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

for (const mode of ['kill', 'exit-no-terminal'] as const) {
  test(`[真实子进程：spawn/终止/事件解析，不等于真实 Codex CLI 已验] 返修调用完成前${mode === 'kill' ? '被外部 kill' : '无终态退出'}：原返修窗口与任务保留、普通 gate PASS 不结束返修、在原窗口续跑到完成`, async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const { value: probe, invokes } = await withRealTransport(
        (phase, attempt) => (phase === 'coding' && attempt === 2 ? mode : 'complete'),
        () => runGoalRuntimeChain(root, {
          adapter: 'codex', runId: `real-interrupt-${mode}`, onCoding: () => {},
          onTesting: ({ root: r }) => writeCleanTesting(r), onHarnessSummary: testingFailsOnce,
        }),
      );
      const events = probe.events;
      assert.strictEqual(invokes.length, ofType(events, 'agent_invoke_start').length, '每次阶段调用都必须经真实子进程');
      const interruptedInvoke = invokes.find(i => i.mode === mode)!;
      assert.ok(interruptedInvoke && (interruptedInvoke.result.pid ?? 0) > 0, JSON.stringify(interruptedInvoke?.result));

      const requests = ofType(events, 'phase_backtrack_requested');
      assert.strictEqual(requests.length, 1, JSON.stringify(requests));
      const ends = ofType(events, 'agent_invoke_end', 'coding');
      assert.ok(ends.length >= 3, JSON.stringify(ends));
      const interrupted = ends[1];
      assert.ok(interrupted.exit_code !== 0 && interrupted.completion_observed !== true && interrupted.timed_out !== true,
        `真实中断结果须是"非零、未完成、非超时"：${JSON.stringify(interrupted)}`);
      if (process.platform === 'win32') {
        assert.ok(events.some(e => e.type === 'agent_process_bound' && e.invoke_id === interrupted.invoke_id), '真实 guardian 绑定事件');
        const settled = events.find(e => e.type === 'agent_process_settled' && e.invoke_id === interrupted.invoke_id);
        assert.ok(settled && settled.exit_code !== 0 && settled.timed_out !== true, JSON.stringify(settled));
      }
      const nextStart = events.findIndex(e => e.type === 'agent_invoke_start' && e.invoke_id === ends[2].invoke_id);
      const window = events.slice(events.indexOf(interrupted), nextStart);
      assert.ok(!window.some(e => e.type === 'phase_backtrack_completed'), `普通 gate PASS 不得提前结束返修：${JSON.stringify(window)}`);
      assert.ok(window.some(e => e.type === 'phase_verdict' && e.phase === 'coding' && e.action === 'retry' && e.verdict !== 'PASS'), JSON.stringify(window));
      assert.ok(!window.some(e => e.type === 'agent_invoke_start'), '中断后不得越过 coding 去调用其它阶段');
      assert.strictEqual(ends[2].completion_observed, true, '续跑由真实 turn.completed 解析判完成');
      const candidateId = String((requests[0].candidates as Array<{ id?: string }>)[0]?.id ?? '');
      assert.ok(candidateId && probe.codingPrompts[2].includes(candidateId), `续跑提示词仍须携带原返修任务 ${candidateId}`);
      const completedAt = events.findIndex(e => e.type === 'phase_backtrack_completed');
      assert.ok(completedAt > events.indexOf(ends[2]), '返修在续跑完成之后才结束');
      assert.ok(completedRun(events), JSON.stringify(ofType(events, 'run_end')));
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('[真实子进程：spawn/终止/事件解析，不等于真实 Codex CLI 已验] 返修调用确实完成后非零清理退出：不重复执行 coding、照常收口；gate 崩溃后恢复也只做验证', async () => {
  const lingerAt = (phase: string, attempt: number): Mode => (phase === 'coding' && attempt === 2 ? 'complete-then-linger' : 'complete');
  // a) 同一进程内照常收口
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const { value: probe, invokes } = await withRealTransport(lingerAt, () => runGoalRuntimeChain(root, {
      adapter: 'codex', runId: 'real-cleanup-exit', onCoding: () => {},
      onTesting: ({ root: r }) => writeCleanTesting(r), onHarnessSummary: testingFailsOnce,
    }));
    const events = probe.events;
    assert.strictEqual(invokes.length, ofType(events, 'agent_invoke_start').length, '每次阶段调用都必须经真实子进程');
    const ends = ofType(events, 'agent_invoke_end', 'coding');
    assert.strictEqual(ends.length, 2, `完成后的清理退出不得再调用 coding：${JSON.stringify(ends)}`);
    assert.ok(ends[1].exit_code !== 0 && ends[1].completion_observed === true && ends[1].kill_attempted === true,
      `真实收口：turn.completed 后宽限内不退 → 收口 kill → 非零但完成：${JSON.stringify(ends[1])}`);
    assert.strictEqual(ofType(events, 'phase_backtrack_requested').length, 1);
    assert.ok(events.findIndex(e => e.type === 'phase_backtrack_completed') > events.indexOf(ends[1]));
    assert.ok(completedRun(events), JSON.stringify(ofType(events, 'run_end')));
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }

  // b) 完成后清理退出 + coding gate 崩溃 → 显式恢复只重跑 gate、不再调用 coding
  const root2 = setupGoalRuntimeHost('codex').root;
  try {
    let crashed = false;
    const { value: first } = await withRealTransport(lingerAt, () => runGoalRuntimeChain(root2, {
      adapter: 'codex', runId: 'real-cleanup-crash', onCoding: () => {},
      onTesting: ({ root: r }) => writeCleanTesting(r), onHarnessSummary: testingFailsOnce,
      afterHarnessPass: ({ phase, root: r, runId }) => {
        if (phase !== 'coding') return;
        const rows = fs.readFileSync(path.join(r, `doc/features/bc-openCard/goal-runs/${runId}/events.jsonl`), 'utf8')
          .split('\n').filter(Boolean).map(l => JSON.parse(l) as Ev);
        const end = [...rows].reverse().find(e => e.type === 'agent_invoke_end' && e.phase === phase);
        if (end && end.exit_code !== 0 && end.completion_observed === true) { crashed = true; throw new Error('gate crash after completed cleanup'); }
      },
    }));
    assert.ok(crashed, 'gate 须在真实完成结果落盘后崩溃');
    assert.ok(ofType(first.events, 'agent_invoke_end', 'coding').some(e => e.completion_observed === true && e.exit_code !== 0));
    const { value: resumed, invokes } = await withRealTransport(() => 'complete', () => runGoalRuntimeChain(root2, {
      adapter: 'codex', resume: 'real-cleanup-crash', forceResume: true, onTesting: ({ root: r }) => writeCleanTesting(r),
    }));
    assert.ok(!resumed.invokedPhases.includes('coding') && !invokes.some(i => i.phase === 'coding'), JSON.stringify(resumed.invokedPhases));
    assert.ok(resumed.harnessPhases.includes('coding'), 'coding gate 真实重验');
    assert.strictEqual(ofType(resumed.events, 'agent_invoke_start', 'coding').length, 2);
    assert.strictEqual(ofType(resumed.events, 'phase_backtrack_requested').length, 1);
    assert.ok(completedRun(resumed.events), JSON.stringify(ofType(resumed.events, 'run_end')));
  } finally { clearFrameworkConfigCache(); fs.rmSync(root2, { recursive: true, force: true }); }
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try { await c.run(); results.push({ name: c.name, ok: true }); }
    catch (e) { results.push({ name: c.name, ok: false, error: String((e as Error).stack ?? (e as Error).message) }); }
  }
  return results;
}
