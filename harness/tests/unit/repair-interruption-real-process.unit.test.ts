import { bindControlledProcess } from '../utils/controlled-model-process';
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
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import {
  invokeAgentHeadless as nativeInvokeAgentHeadless,
  killProcessTree,
  type AgentInvokeOptions,
  type AgentInvokeResult,
} from '../../scripts/utils/agent-invoke';
const invokeAgentHeadless = bindControlledProcess(nativeInvokeAgentHeadless);
import { clearFrameworkConfigCache } from '../../config';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import {
  runGoalRuntimeChain, setupGoalRuntimeHost, PRODUCT_FILE,
} from './goal-runner-testing-integrity.unit.test';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';

/** complete：回放全部样本行后 exit 0；complete-then-linger：回放含 turn.completed 后不退出（等收口 kill）；
 *  exit-no-terminal：只回放非终态行后 exit 1；kill：只回放非终态行后挂住，由测试从外部杀进程树。 */
type Mode = 'complete' | 'complete-then-linger' | 'exit-no-terminal' | 'kill';

const COMPLETED_FIXTURE = path.join(__dirname, 'fixtures', 'codex-terminal-completed.real.jsonl');
const EXECUTOR_SCRIPT = [
  "const fs = require('fs');",
  'const [mode, fixture, ready, observed] = process.argv.slice(2);',
  'function emit() {',
  "const lines = fs.readFileSync(fixture, 'utf8').split(/\\r?\\n/).filter(Boolean);",
  "const terminal = lines.find(l => l.includes('\"turn.completed\"'));",
  "process.stdout.write(lines.filter(l => l !== terminal).join('\\n') + '\\n');",
  "if (mode === 'complete' || mode === 'complete-then-linger') process.stdout.write(terminal + '\\n');",
  "if (mode === 'kill') fs.writeFileSync(ready, String(process.pid));",
  "if (mode === 'kill' || mode === 'complete-then-linger') setInterval(() => {}, 1000);",
  "process.exitCode = mode === 'exit-no-terminal' ? 1 : 0;",
  '}',
  // A short-lived executor must remain queryable until the real containment observer returns.
  "if (mode !== 'complete' && mode !== 'exit-no-terminal') emit(); else {",
  '  const deadline = Date.now() + 10000;',
  '  const wait = setInterval(() => {',
  '    if (fs.existsSync(observed)) { clearInterval(wait); emit(); }',
  '    else if (Date.now() >= deadline) { clearInterval(wait); process.exitCode = 1; }',
  '  }, 10);',
  '}',
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
  const observed = path.join(dir, 'observed');
  fs.writeFileSync(script, EXECUTOR_SCRIPT, 'utf-8');
  let pid = 0;
  // This process replays terminal envelopes; it is not a resumable Codex CLI accepting vendor argv.
  const { providerSessionId: _nativeSession, ...processOptions } = o;
  try {
    const running = invokeAgentHeadless(
      { argv: [process.execPath, script, mode, COMPLETED_FIXTURE, ready, observed], label: 'scripted terminal replay', adapterName: 'terminal-replay-fixture' },
      cwd,
      { ...processOptions, terminalEventParser: 'codex_turn_jsonl', toolEventCapture: 'structured_events',
        onActiveChild: (child) => { pid = child.pid; o.onActiveChild?.(child); fs.writeFileSync(observed, 'observed'); } },
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
const REPAIR_ID = 'real_product_repair';
const FIXED = 'real-process-repaired';
const optionsFor = (root: string) => {
  const configPath = path.join(root, 'framework.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.active_workflow = 'obligation-driven';
  fs.writeFileSync(configPath, JSON.stringify(config)); clearFrameworkConfigCache();
  const requirement = `修复 ${PRODUCT_FILE} 当前实际模块断言，保留原实现与真实验证。`;
  const scope = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
    feature: 'bc-openCard', completionTarget: 'request', requestedResults: [`修复 ${PRODUCT_FILE} 的实际行为`],
    requestedPhases: ['coding'], requirement }).scope;
  assert.ok(scope.obligations.some(obligation => obligation.kind === 'implementation' && obligation.applicability === 'required'),
    'this real repair fixture must declare its actual source duty through the production resolver');
  return {
  adapter: 'codex', freshStartPhase: 'coding' as const, freshEndPhase: 'coding' as const,
  freshRequirement: requirement,
  freshManifestContent: YAML.stringify({ feature: 'bc-openCard', adapter: 'codex', requirement,
    execution_scope: scope, chain_override: scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }),
  onHarnessSummary: ({ phase }: { phase: string }) => {
    if (phase !== 'coding') return null;
    const bytes = fs.readFileSync(path.join(root, PRODUCT_FILE));
    const check: CheckResult = { id: REPAIR_ID, category: 'structure', description: 'actual product repair assertion',
      severity: 'BLOCKER', status: bytes.toString().includes(FIXED) ? 'PASS' : 'FAIL', repair_owner: 'coding', affected_files: [PRODUCT_FILE],
      details: 'The current product must contain the repaired behavior.',
      structured: { source_attempt_dependencies: [{ path: PRODUCT_FILE, exists: true, sha256: createHash('sha256').update(bytes).digest('hex'), role: 'artifact' }] } };
    return { checks: [check] };
  },
  };
};
const repair = (root: string) => fs.writeFileSync(path.join(root, PRODUCT_FILE), `struct AllBanksPage { build() { Text("${FIXED}") } }`);
const cases: Array<{ name: string; run: () => Promise<void> }> = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

for (const mode of ['kill', 'exit-no-terminal'] as const) {
  test(`[真实子进程：spawn/终止/事件解析，不等于真实 Codex CLI 已验] 原单元返修${mode === 'kill' ? '被外部 kill' : '无终态退出'}：保留原反馈与失败原件，恢复后真完成才复验`, async () => {
    const root = setupGoalRuntimeHost('codex', false).root;
    const runId = `real-interrupt-${mode}`;
    try {
      const options = optionsFor(root);
      const { value: first, invokes } = await withRealTransport(
        (phase, attempt) => phase === 'work-unit-author' && attempt === 2 ? mode : 'complete',
        () => runGoalRuntimeChain(root, { ...options, runId,
          onAuthor: ctx => { if (ctx.prompt.includes(REPAIR_ID)) assert.ok(!fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes(FIXED)); } }),
      );
      const interrupted = invokes.find(invoke => invoke.mode === mode);
      assert.ok(interrupted && (interrupted.result.pid ?? 0) > 0, JSON.stringify(invokes));
      assert.ok(interrupted.result.exitCode !== 0 && interrupted.result.completion_observed !== true && interrupted.result.timed_out !== true,
        'the actual external stop/nonterminal exit must not become completion or timeout');
      assert.ok(!completedRun(first.events) && !first.events.some(event => event.type === 'phase_backtrack_completed'), 'ordinary raw check cannot complete the interrupted author');
      assert.equal(first.events.filter(event => event.type === 'harness_start' && event.phase === 'coding').length, 1,
        'an unfinished repair cannot buy a PASS check or another phase author');
      if (process.platform === 'win32') {
        const bound = first.events.find(event => event.type === 'agent_process_bound' && event.phase === 'work-unit-author' && event.invoke_id === first.events.filter(row => row.type === 'agent_invoke_start').at(-1)?.invoke_id);
        assert.ok(bound, 'the interrupted process must retain its exact real guardian binding');
        assert.ok(first.events.some(event => event.type === 'agent_process_settled' && event.invoke_id === bound.invoke_id && event.exit_code !== 0), 'real child exit settles the original binding');
      }
      let delivered = false;
      const { value: resumed, invokes: resumedInvokes } = await withRealTransport(() => 'complete', () => runGoalRuntimeChain(root, {
        ...options, resume: runId,
        onAuthor: ctx => { assert.ok(ctx.prompt.includes(REPAIR_ID), 'the original unresolved feedback must actually reach the resumed unit'); delivered = true; repair(root); },
      }));
      assert.ok(delivered && resumedInvokes.length === 1 && resumedInvokes[0].result.completion_observed === true, 'real terminal completion, not fake end, permits repair verification');
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length, 3);
      assert.equal(resumed.events.filter(event => event.type === 'harness_start' && event.phase === 'coding').length, 2, 'only the affected producer is rechecked after real repair');
      assert.ok(completedRun(resumed.events), JSON.stringify(ofType(resumed.events, 'run_end')));
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('[真实子进程：spawn/终止/事件解析，不等于真实 Codex CLI 已验] 单元作者真完成后非零清理退出仍收口；检查崩溃恢复只补验证', async () => {
  const lingerAt = (phase: string, attempt: number): Mode => phase === 'work-unit-author' && attempt === 2 ? 'complete-then-linger' : 'complete';
  for (const crash of [false, true]) {
    const root = setupGoalRuntimeHost('codex', false).root;
    const runId = crash ? 'real-cleanup-crash' : 'real-cleanup-exit';
    let crashed = false;
    try {
      const options = optionsFor(root);
      const { value: first, invokes } = await withRealTransport(lingerAt, () => runGoalRuntimeChain(root, {
        ...options, runId,
        onAuthor: ctx => { if (ctx.prompt.includes(REPAIR_ID)) repair(root); },
        ...(crash ? { testControl: { expectedInterruption: 'gate crash after completed cleanup' },
          onHarnessSummary: ({ phase }: { phase: string }) => {
            if (phase === 'coding' && fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes(FIXED)) {
              crashed = true; throw new Error('gate crash after completed cleanup');
            }
            return options.onHarnessSummary({ phase });
          } } : {}),
      }));
      const ended = ofType(first.events, 'agent_invoke_end', 'work-unit-author');
      assert.equal(ended.length, 2, 'the completed unit author is not bought again');
      assert.ok(ended[1].exit_code !== 0 && ended[1].completion_observed === true && invokes[1].result.kill_attempted === true,
        'real turn.completed followed by cleanup kill stays a truthful completed nonzero exit');
      if (!crash) { assert.ok(completedRun(first.events)); continue; }
      assert.ok(crashed && !completedRun(first.events), 'a crashed actual checker never signs completion');
      const { value: resumed, invokes: resumedInvokes } = await withRealTransport(() => 'complete', () => runGoalRuntimeChain(root, {
        ...options, resume: runId, forceResume: true,
      }));
      assert.equal(resumedInvokes.length, 0, 'the real completed author is reused after checker recovery');
      assert.ok(resumed.harnessPhases.includes('coding'), 'only the interrupted check is actually completed');
      assert.ok(completedRun(resumed.events), JSON.stringify(ofType(resumed.events, 'run_end')));
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  }
});

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases) {
    if (!matchesUnitCase(c.name, selector)) continue;
    const finish = startCaseTiming([c.name], timings);
    try { await c.run(); results.push({ name: c.name, ok: true }); }
    catch (e) { results.push({ name: c.name, ok: false, error: String((e as Error).stack ?? (e as Error).message) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async (): Promise<UnitCaseResult[]> => (await runSelectedCases()).results;
export const listCaseGroups = () => unitCaseGroups(cases.map(c => c.name)).map(group => ({ ...group,
  releaseOnly: !group.caseNames.some(name => name.includes('返修被外部 kill')) }));
