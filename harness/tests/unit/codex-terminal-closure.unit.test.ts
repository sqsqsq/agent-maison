// ============================================================================
// codex-terminal-closure.unit.test.ts — Codex terminal 收口（plan e6b3f8d2 t1）
// ----------------------------------------------------------------------------
// fixture 纪律：**事件形态一律取自真实 `codex exec --json` 落盘样本**（见
// fixtures/codex-terminal-README.md），不得凭记忆手写。半行分块由真实样本按字节切分模拟。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  CODEX_TERMINAL_ERROR_EXCERPT_LIMIT,
  CODEX_TERMINAL_EXCERPT_MAX_CHARS,
  classifyCodexTerminalLine,
  createCodexTerminalScanner,
  resolveTerminalEventParser,
} from '../../scripts/utils/codex-terminal-events';
import * as os from 'os';
import {
  defaultHeadlessInvokePlan,
  invokeAgentHeadless,
  resolveHeadlessInvokePlan,
  type AgentInvokeResult,
} from '../../scripts/utils/agent-invoke';
import { deriveInvokeUsage } from '../../scripts/utils/usage-capture';
import { extractCodexAgentMessageText } from '../../scripts/utils/codex-terminal-events';
import {
  parseCanaryAnswer,
  resolveCanaryStdoutEnvelope,
  resolveInvokeHardCliFailure,
  type CanaryAnswerKey,
} from '../../scripts/utils/vision-canary';
import { codexTerminalFailureStatus, parseHeadlessApiError } from '../../scripts/utils/goal-headless-sentinel';
import { classifyFailureKind } from '../../scripts/utils/goal-failure-classifier';
import { loadGoalCapability } from '../../scripts/utils/goal-adapter-capability';
import { resolvePhaseHarnessVerdict } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
async function runAsync(
  results: UnitCaseResult[],
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const FIXTURES = path.join(__dirname, 'fixtures');
function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

/** 把整段样本按固定块大小切开——真实 chunk 边界随机，半行分块是常态而非例外。 */
function chunksOf(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function scanAll(text: string, chunkSize?: number): ReturnType<
  ReturnType<typeof createCodexTerminalScanner>['state']
> & { completedCalls: number; failedCalls: number } {
  let completedCalls = 0;
  let failedCalls = 0;
  const scanner = createCodexTerminalScanner({
    onCompleted: () => { completedCalls++; },
    onFailed: () => { failedCalls++; },
  });
  for (const c of chunkSize ? chunksOf(text, chunkSize) : [text]) scanner.push(c);
  scanner.flush();
  return { ...scanner.state(), completedCalls, failedCalls };
}

/**
 * 受控 fixture 驱动的**真子进程** E2E：用 node 脚本按真实 codex JSONL 样本回放 stdout。
 * 不赌真实模型——"FAIL 分钟级收口"不能靠等一个真会失败的模型来验。
 */
const tmpRoots: string[] = [];
function fakeCodexScript(body: string): { argv: string[]; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-codex-term-'));
  tmpRoots.push(dir);
  const scriptAbs = path.join(dir, 'fake-codex.js');
  fs.writeFileSync(scriptAbs, body, 'utf-8');
  return {
    argv: [process.execPath, scriptAbs],
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } },
  };
}
function emitFixtureJs(fixtureAbs: string, tail: string): string {
  return [
    "const fs = require('fs');",
    'const text = fs.readFileSync(' + JSON.stringify(fixtureAbs) + ", 'utf-8');",
    'process.stdout.write(text);',
    tail,
  ].join(String.fromCharCode(10));
}
function assertPhaseEventAgentFailed(r: AgentInvokeResult, label: string): void {
  const resolved = resolvePhaseHarnessVerdict({
    dryRun: false,
    agentExitCode: r.exitCode,
    agentSkipped: r.skipped,
    harnessExitCode: 1,
    summaryBeforeMtime: null,
    summaryAfterMtime: null,
    agentTimedOut: r.timed_out,
    completionObserved: r.completion_observed,
  });
  // goal-runner 的 phase_verdict 事件直接写 `agent_failed: resolved.agent_failed`。
  const phaseEvent = { type: 'phase_verdict', agent_failed: resolved.agent_failed };
  assertEq(phaseEvent.agent_failed, true, `${label} phase_verdict.agent_failed`);
}
async function invokeFake(
  body: string,
  opts: Parameters<typeof invokeAgentHeadless>[2],
  adapterName = 'codex',
): Promise<AgentInvokeResult> {
  const script = fakeCodexScript(body);
  try {
    return await invokeAgentHeadless(
      { argv: script.argv, label: 'fake-' + adapterName + ' exec --json', adapterName },
      process.cwd(),
      opts,
    );
  } finally {
    script.cleanup();
  }
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];

  // --------------------------------------------------------------------
  // 单行分类（真实样本逐行）
  // --------------------------------------------------------------------
  run(results, 'turn.completed 独享 completed 分类（真实样本行）', () => {
    const line = fixture('codex-terminal-completed.real.jsonl')
      .split('\n')
      .find(l => l.includes('"turn.completed"'))!;
    assertEq(classifyCodexTerminalLine(line).kind, 'completed', 'turn.completed');
  });

  run(results, 'turn.failed → failed 分类并带 error.message 摘要（真实样本行）', () => {
    const line = fixture('codex-terminal-failed.real.jsonl')
      .split('\n')
      .find(l => l.includes('"turn.failed"'))!;
    const c = classifyCodexTerminalLine(line);
    assertEq(c.kind, 'failed', 'turn.failed');
    assert(!!c.excerpt && c.excerpt.includes('invalid_request_error'), `摘要须取自 error.message：${c.excerpt}`);
  });

  run(results, '顶层 error → error 分类（纯诊断，非终态）', () => {
    const line = fixture('codex-terminal-failed.real.jsonl')
      .split('\n')
      .find(l => l.startsWith('{"type":"error"'))!;
    assertEq(classifyCodexTerminalLine(line).kind, 'error', '顶层 error');
  });

  run(results, 'item 级错误一律 other——item.completed(item.type=error) / item.error 都不是 turn 终态', () => {
    const itemError = fixture('codex-terminal-failed.real.jsonl')
      .split('\n')
      .find(l => l.includes('"type":"item.completed"') && l.includes('"type":"error"'))!;
    assertEq(classifyCodexTerminalLine(itemError).kind, 'other', 'item.completed 内的 error item');
    const mcpFailed = fixture('codex-terminal-item-error-then-completed.real.jsonl')
      .split('\n')
      .find(l => l.includes('"status":"failed"'))!;
    assertEq(classifyCodexTerminalLine(mcpFailed).kind, 'other', 'item.error + status=failed 的工具调用');
  });

  run(results, '非 JSON / 非对象 / 无 type 一律 other——解析失败不做文本正则回退', () => {
    for (const line of ['', '   ', 'Reading prompt from stdin...', '[1,2,3]', '{"no":"type"}', '{"type":42}', '{broken']) {
      assertEq(classifyCodexTerminalLine(line).kind, 'other', `非结构化行 ${JSON.stringify(line)}`);
    }
    // JSON 数组即使含 turn.completed 字样也不作数
    assertEq(classifyCodexTerminalLine('["turn.completed"]').kind, 'other', 'JSON 数组');
  });

  // --------------------------------------------------------------------
  // 流式扫描（含半行分块）
  // --------------------------------------------------------------------
  run(results, '真实 completed 样本 → completionObserved，且不产生任何失败事实', () => {
    const s = scanAll(fixture('codex-terminal-completed.real.jsonl'));
    assertEq(s.completionObserved, true, 'completionObserved');
    assertEq(s.terminalFailureObserved, false, 'failed 不得成立');
    assertEq(s.errorExcerpts.length, 0, '无 error 事件');
    assertEq(s.completedCalls, 1, 'onCompleted 恰一次');
  });

  run(results, '真实 failed 样本 → terminalFailureObserved 且 completionObserved 恒 false', () => {
    const s = scanAll(fixture('codex-terminal-failed.real.jsonl'));
    assertEq(s.terminalFailureObserved, true, 'terminalFailureObserved');
    assertEq(s.completionObserved, false, 'failed 不得冒充 completed');
    assertEq(s.failedCalls, 1, 'onFailed 恰一次');
    assertEq(s.errorExcerpts.length, 1, '同批顶层 error 只记诊断');
  });

  run(results, '半行分块：逐字节喂入结论与整段一致（跨 chunk 行缓冲）', () => {
    for (const size of [1, 3, 7, 17, 64, 4096]) {
      const done = scanAll(fixture('codex-terminal-completed.real.jsonl'), size);
      assertEq(done.completionObserved, true, `chunk=${size} completed`);
      assertEq(done.completedCalls, 1, `chunk=${size} 回调恰一次`);
      const failed = scanAll(fixture('codex-terminal-failed.real.jsonl'), size);
      assertEq(failed.terminalFailureObserved, true, `chunk=${size} failed`);
      assertEq(failed.completionObserved, false, `chunk=${size} failed 不得冒充 completed`);
    }
  });

  run(results, '末行无换行时 flush 仍补齐终态（进程被杀/管道截断形态）', () => {
    const text = fixture('codex-terminal-completed.real.jsonl').replace(/\n$/, '');
    const scanner = createCodexTerminalScanner();
    scanner.push(text);
    assertEq(scanner.state().completionObserved, false, 'flush 前不得据无换行残片判定');
    scanner.flush();
    assertEq(scanner.state().completionObserved, true, 'flush 后补齐');
  });

  run(results, 'error → 后续 turn.completed：error 只记诊断，completion 照常成立（官方合法序列）', () => {
    const s = scanAll(fixture('codex-terminal-error-then-completed.spliced.jsonl'));
    assertEq(s.completionObserved, true, 'error 之后的 turn.completed 须照常收口');
    assertEq(s.terminalFailureObserved, false, 'error 不得判失败终态');
    assertEq(s.errorExcerpts.length, 1, 'error 进诊断');
    assertEq(s.failedCalls, 0, 'error 不得触发 onFailed（=不得提前杀进程）');
  });

  run(results, '异常双终态流由 failed 仲裁优先，scanner 不得输出双真', () => {
    const completedLine = fixture('codex-terminal-completed.real.jsonl')
      .split(String.fromCharCode(10))
      .find(l => l.includes('"turn.completed"'))!;
    const failedLine = fixture('codex-terminal-failed.real.jsonl')
      .split(String.fromCharCode(10))
      .find(l => l.includes('"turn.failed"'))!;
    for (const text of [`${completedLine}\n${failedLine}\n`, `${failedLine}\n${completedLine}\n`]) {
      const s = scanAll(text);
      assertEq(s.terminalFailureObserved, true, 'failed 须优先');
      assertEq(s.completionObserved, false, 'scanner 终态须互斥');
    }
  });

  run(results, 'item 级错误贯穿全程但 turn.completed 收尾 → 仍判 completed（真实样本）', () => {
    const s = scanAll(fixture('codex-terminal-item-error-then-completed.real.jsonl'));
    assertEq(s.completionObserved, true, 'turn.completed 收尾');
    assertEq(s.terminalFailureObserved, false, 'item 级错误不是 turn 终态');
    assertEq(s.errorExcerpts.length, 0, 'item 级错误不进顶层 error 诊断清单');
  });

  run(results, '诊断摘要有界：条数与单条长度都封顶', () => {
    const long = 'x'.repeat(CODEX_TERMINAL_EXCERPT_MAX_CHARS * 3);
    const lines = Array.from({ length: CODEX_TERMINAL_ERROR_EXCERPT_LIMIT + 5 }, () =>
      JSON.stringify({ type: 'error', message: long }),
    ).join('\n');
    const s = scanAll(`${lines}\n`);
    assertEq(s.errorExcerpts.length, CODEX_TERMINAL_ERROR_EXCERPT_LIMIT, '条数封顶');
    assertEq(s.errorExcerpts[0].length, CODEX_TERMINAL_EXCERPT_MAX_CHARS, '单条长度封顶');
  });

  // --------------------------------------------------------------------
  // 解析器归属与 argv 契约
  // --------------------------------------------------------------------
  run(results, '四个内置 adapter 的终态归属，其余无契约不造假信号', () => {
    assertEq(resolveTerminalEventParser('codex'), 'codex_turn_jsonl', 'codex');
    for (const a of ['claude', 'codeagent']) assertEq(resolveTerminalEventParser(a), 'claude_result_jsonl', a);
    assertEq(resolveTerminalEventParser('cursor'), 'cursor_result_jsonl', 'cursor');
    for (const a of ['chrys', 'opencode', 'generic', undefined]) {
      assertEq(resolveTerminalEventParser(a), 'none', `adapter=${String(a)}`);
    }
  });

  for (const adapter of ['claude', 'codeagent', 'cursor']) {
    run(results, `${adapter} result parser：中间事件/半行不收口，成功与失败互斥`, () => {
      const scanner = createCodexTerminalScanner({}, resolveTerminalEventParser(adapter));
      scanner.push('{"type":"system","subtype":"api_retry","error_status":500}\n');
      scanner.push('{"type":"assistant","message":{"content":"done"}}\n');
      scanner.push('{"type":"result","subtype":"success","is_error":false,"result":');
      assertEq(scanner.state().completionObserved, false, '半行不能收口');
      scanner.push('"done"}\n');
      assertEq(scanner.state().completionObserved, true, '成功终态');
      scanner.push('{"type":"result","is_error":true,"result":"failed"}\n');
      assertEq(scanner.state().terminalFailureObserved, true, '失败优先');
      assertEq(scanner.state().completionObserved, false, '不得双真');
    });
    await runAsync(results, `${adapter} terminal result 后 CLI 存活：原 grace 有界收口而非长 timeout`, async () => {
      const result = await invokeFake('process.stdout.write(\'{"type":"result","subtype":"success","is_error":false,"result":"done"}\\n\');setInterval(()=>{},1000);',
        { timeoutMs: 5000, completionGraceMs: 50, deadlineMs: Date.now() + 5000 }, adapter);
      assertEq(result.completion_observed, true, '真实 stdout→scanner→收尾');
      assertEq(result.timed_out, undefined, '不冒充超时');
      assert((result.duration_ms ?? Infinity) < 5000, '不等完整 hard timeout');
    });
    await runAsync(results, `${adapter} result failed 自然 exit 0 仍保留失败`, async () => {
      const result = await invokeFake('process.stdout.write(\'{"type":"result","is_error":true,"result":"failed"}\\n\');process.exit(0);',
        { timeoutMs: 5000, completionGraceMs: 50, deadlineMs: Date.now() + 5000 }, adapter);
      assertEq(result.terminal_failure_observed, true, '失败终态');
      assertEq(result.completion_observed, undefined, '失败不完成');
      assert(result.exitCode !== 0, '自然 exit 0 不洗绿');
    });
    await runAsync(results, `${adapter} 无 result 的非零自然退出仍失败`, async () => {
      const result = await invokeFake('process.stderr.write("Authentication required"); process.exit(1);', { timeoutMs: 5000 }, adapter);
      assertEq(result.exitCode, 1, '真实 exit code');
      assertEq(result.completion_observed, undefined, '不从 stderr 合成成功');
      assertEq(result.timed_out, undefined, '无需等 hard timeout');
    });
  }
  for (const adapter of ['codex', 'claude', 'codeagent', 'cursor']) {
    await runAsync(results, `${adapter} 成功终态后 CLI 自然 exit 1 不能被 completion 洗绿`, async () => {
      const terminal = adapter === 'codex' ? { type: 'turn.completed' }
        : { type: 'result', subtype: 'success', is_error: false, result: 'done' };
      const r = await invokeFake(`process.stdout.write(${JSON.stringify(JSON.stringify(terminal) + '\n')});process.exit(1);`,
        { timeoutMs: 5000 }, adapter);
      assertEq(r.exitCode, 1, '自然非零退出保留');
      assertEq(r.completion_observed, undefined, '只有 completion cleanup 非零才可保留完成');
      assertPhaseEventAgentFailed(r, adapter);
    });
  }
  await runAsync(results, 'terminal completion→failed 撤销成功且恢复原 deadline；缺显式 deadline 不扩 grace', async () => {
    const r = await invokeFake('process.stdout.write(\'{"type":"turn.completed"}\\n\');setTimeout(()=>process.stdout.write(\'{"type":"turn.failed","error":{"message":"failed"}}\\n\'),50);setInterval(()=>{},1000);',
      { timeoutMs: 600, completionGraceMs: 5000 });
    assertEq(r.terminal_failure_observed, true, '失败撤销 completion');
    assertEq(r.completion_observed, undefined, '互斥');
    assert((r.duration_ms ?? Infinity) < 5000, '收尾不重置原 timeout');
    assert(r.exitCode !== 0, '失败不能洗绿');
  });

  run(results, 'codex argv 含 --json，且不依赖 tool_event_provenance 触发', () => {
    const plan = defaultHeadlessInvokePlan('codex', { write_mode: 'full-access', approval_mode: 'never' } as never, 'p');
    assert(plan.argv.includes('--json'), `argv 须含 --json：${plan.argv.join(' ')}`);
    // 工具证据字段无论怎么传，argv 都一样（--json 由 codexArgv 独立追加）
    const withProvenance = defaultHeadlessInvokePlan(
      'codex', { write_mode: 'full-access', approval_mode: 'never' } as never, 'p', 'structured_events',
    );
    assertEq(withProvenance.argv.join(' '), plan.argv.join(' '), '--json 不得借工具证据字段触发');
    // stream-json（claude 家族的工具证据旗标）绝不能出现在 codex argv 上
    assert(!plan.argv.includes('--output-format'), 'codex 不得带 claude 家族的 stream-json 旗标');
  });

  run(results, 'codex adapter 声明：output_delivery=streaming / usage_capture=stdout_json / tool_event_provenance 仍为 none', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const cap = loadGoalCapability(repoRoot, 'codex');
    assert(!!cap.capability, `codex adapter goal_capability 应可解析：${cap.issues.join('；')}`);
    assertEq(cap.capability!.output_delivery, 'streaming', 'output_delivery');
    assertEq(cap.capability!.usage_capture, 'stdout_json', 'usage_capture');
    assert(
      cap.capability!.tool_event_provenance === undefined || cap.capability!.tool_event_provenance === 'none',
      `tool_event_provenance 必须保持 none（现为 ${String(cap.capability!.tool_event_provenance)}）——` +
      'stdout 有 terminal JSONL ≠ 工具调用可审计',
    );
    // 声明面回归：codex 未进 critic 解析器注册表 ⇒ 不可能签发 verified 回执
    const producer = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'critic-receipt-producer.ts'),
      'utf-8',
    );
    const registry = /const IMAGE_READ_PARSERS[\s\S]*?\n};/.exec(producer);
    assert(registry !== null, '应能定位 critic 解析器注册表');
    assert(!/\bcodex\b/.test(registry![0]), 'codex 不得进 critic 图片读取解析器注册表');
  });

  run(results, 'resolveHeadlessInvokePlan(codex) 同样带 --json（运行时真值路径）', () => {
    const plan = resolveHeadlessInvokePlan(
      'codex',
      { mode: 'native_goal', usage_capture: 'stdout_json', output_delivery: 'streaming' } as never,
      { write_mode: 'full-access', approval_mode: 'never' } as never,
      'prompt',
      {
        PROMPT_FILE: '', PROMPT: 'prompt', SKILL_PATH: '', PROJECT_ROOT: '.',
        FRAMEWORK_ROOT: '', FEATURE: 'f', PHASE: 'coding',
      },
    );
    assert(plan.argv.includes('--json'), `argv 须含 --json：${plan.argv.join(' ')}`);
  });

  // --------------------------------------------------------------------
  // usage：turn.completed 的 usage 由既有 stdout_json 解析器直接读出（不新增枚举）
  // --------------------------------------------------------------------
  run(results, 'usage_capture=stdout_json 直读真实 turn.completed.usage（不新增枚举）', () => {
    const usage = deriveInvokeUsage('stdout_json', fixture('codex-terminal-completed.real.jsonl'), '');
    assertEq(usage.capture_method, 'stdout_json', 'capture_method');
    assertEq(usage.confidence, 'measured', 'confidence');
    assertEq(usage.input_tokens, 17509, 'input_tokens');
    assertEq(usage.output_tokens, 5, 'output_tokens');
  });

  // --------------------------------------------------------------------
  // invoke 边界：exit 0 规范化 + error 不进任何判据
  // --------------------------------------------------------------------
  run(results, 'invoke 边界源码锚定：terminal 失败终态在 exit 0 时规范化为非零', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'agent-invoke.ts'),
      'utf-8',
    );
    assert(
      /exitCode: timedOut \|\| terminalFailureObserved \? \(exitCode === 0 \? 1 : exitCode\) : exitCode,/.test(src),
      'exit 0 规范化须与 timedOut 同款（保住 agentFailed 语义）',
    );
    assert(/terminal_failure_observed: terminalFailureObserved \|\| undefined,/.test(src), '结果须回传 terminal_failure_observed');
  });

  run(results, 'error 事件不得进入 api_disconnected / failure classifier / retry 判据', () => {
    const invokeSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'agent-invoke.ts'),
      'utf-8',
    );
    // errorExcerpts 只被拼进 terminal_error_excerpt（诊断），不参与任何分支判定
    const uses = invokeSrc.split('errorExcerpts').length - 1;
    assertEq(uses, 1, `agent-invoke 中 errorExcerpts 只应出现在诊断拼装处（实际 ${uses} 处）`);
    // plan 4e6fb3b6 §4 调整：原断言"断流哨兵不得出现 turn.failed/turn.completed 字样"（codex 恒 null）。
    // 本 plan 让哨兵读 **turn.failed 终态段**的状态码（429/5xx 归瞬时）；本用例守的"顶层 error 不供给
    // 断流判据"不变，改为行为断言：error 段里的状态码一律不产生终态状态码。
    assertEq(codexTerminalFailureStatus('error: {"type":"error","status":429}'), null, 'error 段不得产生状态码');
    assertEq(
      codexTerminalFailureStatus('turn.failed: {"type":"error","status":400} | error: {"type":"error","status":429}'),
      400, '只取 turn.failed 段，不被其后的 error 段覆盖',
    );
    const sentinel = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'goal-headless-sentinel.ts'),
      'utf-8',
    );
    assert(!/turn\.completed/.test(sentinel), '断流哨兵不得消费 turn.completed');
  });

  // --------------------------------------------------------------------
  // 判卷信封投影（`--json` 的连带面：不投影会把"作答了"误判成"没作答"）
  // --------------------------------------------------------------------
  run(results, '判卷信封方言：codex 恒 codex_turn_jsonl；claude 家族仍随 tool_event_provenance', () => {
    assertEq(resolveCanaryStdoutEnvelope('codex', 'none'), 'codex_turn_jsonl', 'codex 恒 JSONL（--json 无条件追加）');
    assertEq(resolveCanaryStdoutEnvelope('claude', 'structured_events'), 'claude_stream_json', 'claude+structured');
    assertEq(resolveCanaryStdoutEnvelope('claude', 'none'), 'claude_stream_json', 'claude 终态不依赖工具审计资格');
    assertEq(resolveCanaryStdoutEnvelope('cursor', 'structured_events'), 'cursor_stream_json', 'Cursor 结果信封');
  });

  run(results, 'codex 投影：按序拼接 agent_message；无 turn.completed → null（不判卷）', () => {
    const projected = extractCodexAgentMessageText(fixture('codex-terminal-completed.real.jsonl'));
    assertEq(projected, 'OK', '单条 agent_message');
    const multi = extractCodexAgentMessageText(fixture('codex-terminal-item-error-then-completed.real.jsonl'));
    assert(multi !== null && multi.split(String.fromCharCode(10)).length >= 5, '多条 agent_message 须按序拼接');
    assertEq(extractCodexAgentMessageText(fixture('codex-terminal-failed.real.jsonl')), null, 'turn.failed 不判卷');
    assertEq(extractCodexAgentMessageText(''), null, '空 stdout 不判卷');
  });

  run(results, '金丝雀答卷经 codex 信封投影后可解析（回归：--json 不得把作答判成没作答）', () => {
    const key: CanaryAnswerKey = {
      geometry_questions: [{ id: 'Q1', prompt: 'q1', expected: 'red' }],
      text_token: 'TOKEN42',
    } as unknown as CanaryAnswerKey;
    const NLJS = String.fromCharCode(10);
    const answer = 'Q1=red' + NLJS + 'TEXT_TOKEN=TOKEN42';
    const stdout = [
      JSON.stringify({ type: 'thread.started', thread_id: 't' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: answer } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join(NLJS) + NLJS;
    // 不投影 → 行锚恒空（这正是 --json 引入的回归形态）
    assertEq(parseCanaryAnswer({ stdout }, key).canonicalAnswer, null, '未投影时 JSONL 上行锚恒空');
    // 投影后 → 正常解析出答卷
    const parsed = parseCanaryAnswer(
      { stdout, structured_stdout: true, structured_stdout_format: 'codex_turn_jsonl' },
      key,
    );
    assert(parsed.canonicalAnswer !== null, '投影后须解析出答卷：' + String(parsed.canonicalAnswer));
    assert(parsed.canonicalAnswer!.includes('Q1=red'), '答卷内容');

    // CANNOT_SEE_IMAGE（codex image_input=none 的预期答卷）同样须能被识别
    const blindStdout = [
      JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'CANNOT_SEE_IMAGE' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join(NLJS) + NLJS;
    const blind = parseCanaryAnswer(
      { stdout: blindStdout, structured_stdout: true, structured_stdout_format: 'codex_turn_jsonl' },
      key,
    );
    assertEq(blind.canonicalAnswer, 'CANNOT_SEE_IMAGE', '盲档答卷须照旧可判');
  });

  // --------------------------------------------------------------------
  // 受控 fixture 驱动的真子进程 E2E（FAIL 分钟级收口，不赌真实模型）
  // --------------------------------------------------------------------
  await runAsync(
    results,
    'E2E turn.completed 后进程钉住不退 → grace 内 tree-kill 收口，且不判超时/不判失败',
    async () => {
      const started = Date.now();
      const r = await invokeFake(
        emitFixtureJs(path.join(FIXTURES, 'codex-terminal-completed.real.jsonl'), 'setInterval(() => {}, 1000);'),
        { timeoutMs: 120_000, completionGraceMs: 300, deadlineMs: Date.now() + 120_000 },
      );
      const elapsed = Date.now() - started;
      assertEq(r.completion_observed, true, 'completion_observed');
      assertEq(r.timed_out, undefined, '收口不得记超时');
      assertEq(r.terminal_failure_observed, undefined, 'completed 不得记失败终态');
      assert(elapsed < 60_000, '收口须在秒级发生（实际 ' + elapsed + 'ms，hard timeout 是 120s）');
    },
  );

  await runAsync(results, '自检 PASS/closed 后继续实际编辑；只有 adapter 终态才收尾', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-selfcheck-'));
    try {
      const editPath = path.join(dir, 'product.txt');
      const summaryPath = path.join(dir, 'summary.json');
      const r = await invokeFake([
        "const fs=require('fs');",
        `fs.writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({verdict:'PASS',closure_status:'closed'}));`,
        `setTimeout(()=>{fs.writeFileSync(${JSON.stringify(editPath)}, '施工已落盘'); process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');}, 500);`,
      ].join('\n'), { timeoutMs: 5000, completionGraceMs: 50 });
      assertEq(fs.readFileSync(editPath, 'utf8'), '施工已落盘', '不得提前杀施工');
      assertEq(r.completion_observed, true, '真实终态已收尾');
      assertEq(r.timed_out, undefined, '不需长 hard timeout');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await runAsync(
    results,
    'E2E turn.failed + exit 0 → exitCode 规范化非零、completion 恒 false、诊断留痕',
    async () => {
      const r = await invokeFake(
        emitFixtureJs(path.join(FIXTURES, 'codex-terminal-failed.real.jsonl'), 'process.exit(0);'),
        { timeoutMs: 120_000, completionGraceMs: 300, deadlineMs: Date.now() + 120_000 },
      );
      assertEq(r.terminal_failure_observed, true, 'terminal_failure_observed');
      assertEq(r.completion_observed, undefined, 'failed 不得冒充 completed');
      assert(r.exitCode !== 0, 'exit 0 须规范化为非零（实际 ' + r.exitCode + '）');
      assertEq(r.timed_out, undefined, 'failed 不得冒充超时');
      assert(
        !!r.terminal_error_excerpt && r.terminal_error_excerpt.startsWith('turn.failed:'),
        '诊断摘要须留痕：' + r.terminal_error_excerpt,
      );
    },
  );

  await runAsync(
    results,
    'E2E error → 稍后 turn.completed：error 不提前杀进程，completed 照常收口',
    async () => {
      const errorLine = fixture('codex-terminal-failed.real.jsonl')
        .split(String.fromCharCode(10))
        .find(l => l.startsWith('{"type":"error"'))!;
      const completedLine = fixture('codex-terminal-completed.real.jsonl')
        .split(String.fromCharCode(10))
        .find(l => l.includes('"turn.completed"'))!;
      const NLJS = String.fromCharCode(10);
      const body = [
        'process.stdout.write(' + JSON.stringify(errorLine + NLJS) + ');',
        'setTimeout(() => {',
        '  process.stdout.write(' + JSON.stringify(completedLine + NLJS) + ');',
        '  setTimeout(() => process.exit(0), 50);',
        '}, 400);',
      ].join(NLJS);
      const r = await invokeFake(body, {
        timeoutMs: 120_000,
        completionGraceMs: 3_000,
        deadlineMs: Date.now() + 120_000,
      });
      assertEq(r.completion_observed, true, 'error 之后的 completed 须照常收口');
      assertEq(r.terminal_failure_observed, undefined, 'error 不是失败终态');
      assertEq(r.exitCode, 0, 'error 不得让正常退出的 invoke 变失败');
      assertEq(r.kill_attempted, false, 'error 不得触发提前 tree-kill');
      assert(
        !!r.terminal_error_excerpt && r.terminal_error_excerpt.startsWith('error:'),
        'error 须只进诊断：' + r.terminal_error_excerpt,
      );
    },
  );

  await runAsync(
    results,
    'E2E 非 codex adapter 不启用 terminal 解析器（同样输出也不收口）',
    async () => {
      const r = await invokeFake(
        emitFixtureJs(path.join(FIXTURES, 'codex-terminal-failed.real.jsonl'), 'process.exit(0);'),
        { timeoutMs: 60_000, deadlineMs: Date.now() + 60_000 },
        'claude',
      );
      assertEq(r.terminal_failure_observed, undefined, '无 terminal 契约的 adapter 不得据 codex 事件判失败');
      assertEq(r.exitCode, 0, '不得规范化非 codex adapter 的退出码');
    },
  );

  // --------------------------------------------------------------------
  // plan 4e6fb3b6 §4 / A5：codex 同一信封按状态码分流。样本来源逐条标注：
  //   [真实·宿主] scripts/tests/fixtures/reliability/20260926T134302Z-0457a6 的
  //              agent_invoke_end.terminal_error_excerpt（400 model is not supported）
  //   [真实·本机] fixtures/codex-terminal-failed.real.jsonl 经真实 writer（invokeAgentHeadless）
  //   [合成]     上面真实样本逐字不变、只把 status 换成 429 / 503 / 401 / 403——这四个码没有真实样本
  //   [合成·拼接] codex-terminal-error-then-completed.spliced.jsonl 的 error 行 status 换成 429
  //              （出现过错误但随后 turn.completed：终态契约下不算失败）
  // 路由面三处，全部是生产函数：CLI 硬失败 resolveInvokeHardCliFailure、瞬时识别
  // parseHeadlessApiError（codex 读 terminal_error_excerpt 的 turn.failed 段）、归因 classifyFailureKind。
  // --------------------------------------------------------------------
  const codexRoute = (r: { exitCode: number; stdout?: string; stderr?: string; terminal_error_excerpt?: string }) => {
    const hard = resolveInvokeHardCliFailure({
      exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '',
      ...(r.terminal_error_excerpt ? { terminal_error_excerpt: r.terminal_error_excerpt } : {}),
    }, { formalInvoke: true });
    const transient = parseHeadlessApiError(path.join(os.tmpdir(), 'no-such-agent-output.log'), 'codex', r.terminal_error_excerpt) !== null;
    const kind = classifyFailureKind({ verdict: 'FAIL', blockers: [{ id: 'spec_file_exists' }] }, undefined, { agentApiError: transient });
    return { hard, transient, kind };
  };
  const statusVariant = (fixtureName: string, status: number): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-codex-status-'));
    tmpRoots.push(dir);
    const src = fixture(fixtureName);
    assert(src.includes('\\"status\\":400'), `真实样本须含 status 400：${fixtureName}`);
    const out = path.join(dir, `synthetic-${status}-${fixtureName}`);
    fs.writeFileSync(out, src.split('\\"status\\":400').join(`\\"status\\":${status}`), 'utf-8');
    return out;
  };

  run(results, 'A5 [真实·宿主] 0457a6 的 400 model is not supported：保持现状（CLI 硬失败，不进瞬时重试）', () => {
    const eventsPath = path.resolve(__dirname, '../../../scripts/tests/fixtures/reliability/20260926T134302Z-0457a6/events.jsonl');
    const end = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { type?: string; exit_code?: number; terminal_error_excerpt?: string })
      .find((e) => e.type === 'agent_invoke_end' && typeof e.terminal_error_excerpt === 'string');
    assert(!!end, '宿主样本须有 terminal_error_excerpt');
    assertEq(codexTerminalFailureStatus(end!.terminal_error_excerpt), 400, '终态状态码');
    const route = codexRoute({ exitCode: end!.exit_code ?? 1, terminal_error_excerpt: end!.terminal_error_excerpt });
    assert(!!route.hard && route.hard.includes('Codex 模型不可用硬错误'), `400 须保持现状的硬失败定性：${route.hard}`);
    assertEq(route.transient, false, '400 不进瞬时重试');
  });

  await runAsync(results, 'A5 [真实·本机] codex-terminal-failed.real.jsonl 经真实 writer：400 保持现状', async () => {
    const r = await invokeFake(
      emitFixtureJs(path.join(FIXTURES, 'codex-terminal-failed.real.jsonl'), 'process.exit(1);'),
      { timeoutMs: 60_000, completionGraceMs: 300, deadlineMs: Date.now() + 60_000 },
    );
    const route = codexRoute(r);
    assert(!!route.hard && route.hard.includes('status=400'), `400 须保持现状：${route.hard}`);
    assertEq(route.transient, false, '400 不进瞬时重试');
  });

  for (const status of [429, 503]) {
    await runAsync(results, `A5 [合成] status=${status} 的 turn.failed 经真实 writer → 瞬时重试（transient_api_error），不计 CLI 硬失败`, async () => {
      const r = await invokeFake(
        emitFixtureJs(statusVariant('codex-terminal-failed.real.jsonl', status), 'process.exit(1);'),
        { timeoutMs: 60_000, completionGraceMs: 300, deadlineMs: Date.now() + 60_000 },
      );
      assertEq(r.terminal_failure_observed, true, '终态失败');
      assertEq(codexTerminalFailureStatus(r.terminal_error_excerpt), status, '终态状态码');
      const route = codexRoute(r);
      assertEq(route.hard, null, `${status} 不得计 CLI 硬失败`);
      assertEq(route.transient, true, `${status} 须进瞬时识别`);
      assertEq(route.kind, 'transient_api_error', `${status} 归因`);
    });
  }

  for (const status of [401, 403]) {
    await runAsync(results, `A5 [合成] status=${status} 的 turn.failed 经真实 writer → 计入 CLI 硬失败（外部），不进瞬时重试`, async () => {
      const r = await invokeFake(
        emitFixtureJs(statusVariant('codex-terminal-failed.real.jsonl', status), 'process.exit(1);'),
        { timeoutMs: 60_000, completionGraceMs: 300, deadlineMs: Date.now() + 60_000 },
      );
      const route = codexRoute(r);
      assert(!!route.hard && route.hard.includes(`status=${status}`), `${status} 须计 CLI 硬失败：${route.hard}`);
      assertEq(route.transient, false, `${status} 不得进瞬时重试`);
      assert(route.kind !== 'transient_api_error', `${status} 不得归 transient`);
    });
  }

  await runAsync(results, 'A5 [合成·拼接] error(status=429) 之后 turn.completed：出现过错误但随后成功，不算失败', async () => {
    const r = await invokeFake(
      emitFixtureJs(statusVariant('codex-terminal-error-then-completed.spliced.jsonl', 429), 'process.exit(0);'),
      { timeoutMs: 60_000, completionGraceMs: 300, deadlineMs: Date.now() + 60_000 },
    );
    assertEq(r.completion_observed, true, '随后成功');
    assert((r.terminal_error_excerpt ?? '').includes('429'), `error 诊断须留痕：${r.terminal_error_excerpt}`);
    assertEq(codexTerminalFailureStatus(r.terminal_error_excerpt), null, '非终态错误不产生终态状态码');
    const route = codexRoute(r);
    assertEq(route.hard, null, '不算 CLI 硬失败');
    assertEq(route.transient, false, '不算瞬时失败');
  });

  for (const d of tmpRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  return results;
}
