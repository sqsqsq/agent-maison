// ============================================================================
// hylyre-entry-conformance.unit.test.ts — 发布关键入口的真实输出 conformance
//                                          （plan a6c4e9f2 T7b / tasks 6.7b）
// ----------------------------------------------------------------------------
// 范围按 plan §194 裁剪：**real plan / fake / steps-file 是发布关键入口，做完整
// conformance**；atomic CLI / MCP / session「因不产 Maison 正式证据，只要求共用 builder
// 与每入口一条 smoke」。
//
// 本套件覆盖 Maison 侧能在**无设备**条件下真实执行的发布关键入口：
//   - real plan + fake（`run --plan --use-fakes`）：已由
//     `testing-stepresult-evidence` 的 vendor fake runner 用例端到端覆盖到生产两道门；
//   - pre-run reject：本文件覆盖 stdout / exit / 零设备 / 零 trace-report 四要素；
//   - steps-file + fake：先对 vendored source 做源码级零设备证明，再真实执行 CLI，
//     输出必须同时通过 requireV1ForGate 与 native evidence gate。
//
// atomic / MCP / session 不重复塞进 Maison 默认套件：本次 source 所属 clean commit
// `0220b5d…` 自带 Phase 1 conformance，三入口分别用 FakeUiDriver / 注入 agent / 真实
// FastMCP client 做端到端 smoke，Maison 收包时按 source tree 绑定并实际执行；不是 import smoke，
// 也不把该要求口头搬进 T8。
//
// 判据方向：真实输出必须过**生产**入口（requireV1ForGate / native evidence gate），
// 不是只看信封——"信封正确、内容非法"正是本 plan 修掉的那类产物。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';

import { validateLiteSchema } from '../../scripts/utils/lite-json-schema';
import { loadHylyreOutputSchema } from '../../scripts/utils/hylyre-contract-schema';
import { requireV1ForGate } from '../../scripts/utils/hylyre-result-protocol';
import {
  evaluateHylyreNativeEvidenceGate,
  parseHylyreTrace,
} from '../../../profiles/hmos-app/harness/providers/device-test-run';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_ROOT = path.join(REPO_ROOT, 'profiles', 'hmos-app', 'vendor', 'hylyre', 'src');

function runHylyre(cwd: string, argv: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.env.MAISON_PYTHON || 'python', ['-B', '-m', 'hylyre', ...argv], {
    cwd,
    env: { ...process.env, PYTHONPATH: SRC_ROOT, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf-8',
    timeout: 120000,
    windowsHide: true,
  });
}

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

function pythonFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`def ${name}(`);
  assert.ok(start >= 0, `未找到 Python 函数 ${name}`);
  const next = source.indexOf('\ndef ', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

function assertStepsFileFakeIsDeviceFree(): void {
  const cliMain = fs.readFileSync(path.join(SRC_ROOT, 'hylyre', 'cli', '__main__.py'), 'utf-8');
  const runCmd = fs.readFileSync(
    path.join(SRC_ROOT, 'hylyre', 'cli', 'commands', 'run_cmd.py'),
    'utf-8',
  );
  const stepsCmd = fs.readFileSync(
    path.join(SRC_ROOT, 'hylyre', 'cli', 'commands', 'steps_cmd.py'),
    'utf-8',
  );

  const cliCall = cliMain.slice(
    cliMain.indexOf('run_cmd.execute_steps_scenario('),
    cliMain.indexOf(')', cliMain.indexOf('run_cmd.execute_steps_scenario(')) + 1,
  );
  assert.ok(cliCall.includes('use_fakes=use_fakes'), 'CLI steps-file 分支没有向 execute_steps_scenario 传 use_fakes');

  const scenario = pythonFunctionBody(runCmd, 'execute_steps_scenario');
  assert.match(scenario.slice(0, scenario.indexOf(')')), /\buse_fakes\s*:\s*bool/);
  assert.ok(scenario.includes('use_fakes=use_fakes'), 'execute_steps_scenario 没有把 use_fakes 传给 batch runner');
  assert.ok(!scenario.includes('use_fakes=False'), 'execute_steps_scenario 仍把 fake 写死为 false');

  const execute = pythonFunctionBody(stepsCmd, 'execute_run_steps');
  const fakeBranch = execute.indexOf('if use_fakes:');
  const fakeReturn = execute.indexOf('return run_steps_fake(', fakeBranch);
  const liveSessionBranch = execute.indexOf('if session_file is not None:', fakeReturn);
  const agentConstruction = execute.indexOf('_with_hypium_agent(');
  assert.ok(fakeBranch >= 0, 'execute_run_steps 缺 use_fakes 分支');
  assert.ok(fakeReturn > fakeBranch, 'fake 分支必须直接返回纯 fake runner');
  assert.ok(
    liveSessionBranch > fakeReturn && agentConstruction > fakeReturn,
    'fake return 必须先于 live session/device 分支',
  );
  assert.ok(
    execute.slice(fakeBranch, fakeReturn).includes('--use-fakes cannot be combined with --session'),
    'fake + live session 必须在进入设备分支前显式拒绝',
  );

  const fake = pythonFunctionBody(stepsCmd, 'run_steps_fake');
  for (const forbidden of ['_with_hypium_agent', '_session_ipc', 'create_hypium_agent', 'hdc ', 'EnvPool']) {
    assert.ok(!fake.includes(forbidden), `run_steps_fake 不得包含设备入口：${forbidden}`);
  }
}

test('steps-file + --use-fakes：零设备真实 CLI 输出通过 v1 两道生产门', () => {
  // 默认套件在执行 vendored CLI 之前先锁住源码级安全路径；证明不成立就绝不 spawn。
  assertStepsFileFakeIsDeviceFree();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-steps-fake-'));
  try {
    const steps = path.join(root, 'steps.json');
    const report = path.join(root, 'test-report.md');
    const trace = path.join(root, 'trace.json');
    fs.writeFileSync(steps, JSON.stringify([
      { touch: { by_id: 'entry' } },
      { wait_for: { by_id: 'target' } },
    ]), 'utf-8');

    const run = runHylyre(root, [
      'run', '--steps-file', steps, '--feature', 'fake-steps',
      '--report-out', report, '--trace-out', trace, '--use-fakes',
    ]);
    assert.strictEqual(
      run.status,
      1,
      `fake 无法观察 wait_for，必须以非 success 退出而不是伪造断言 PASS：${run.stdout}\n${run.stderr}`,
    );
    assert.ok(fs.existsSync(report), 'steps-file fake 必须产 report');
    assert.ok(fs.existsSync(trace), 'steps-file fake 必须产 trace');

    const combined = `${run.stdout}\n${run.stderr}`;
    for (const marker of ['hdc shell', 'hdc -t', 'Connected to device', 'aa start', 'using first device sn', 'EnvPool']) {
      assert.ok(!combined.includes(marker), `steps-file fake 不得触达设备：命中 ${marker}`);
    }

    const parsed = JSON.parse(fs.readFileSync(trace, 'utf-8')) as Record<string, any>;
    assert.strictEqual(parsed.schema_version, '0.4-p0');
    assert.strictEqual(parsed.result_protocol, 'hylyre.step-outcome/1');
    assert.strictEqual(parsed.artifacts?.use_fakes, true);
    assert.strictEqual(parsed.environment?.selector_engine, 'fake');
    assert.ok(Array.isArray(parsed.cases) && parsed.cases.length === 1, 'steps-file 应归约为一个 CaseResult');
    assert.strictEqual(parsed.cases[0].steps[0].outcome.status, 'passed', 'fake action 应走共享 builder 并通过');
    assert.strictEqual(parsed.cases[0].steps[1].outcome.status, 'blocked', 'fake assertion 不得伪造 PASS');
    assert.strictEqual(parsed.cases[0].steps[1].outcome.cause?.type, 'capability');

    const required = requireV1ForGate(parsed);
    assert.strictEqual(required.ok, true, `steps-file 真实输出未过 requireV1ForGate：${required.detail}`);
    const native = evaluateHylyreNativeEvidenceGate({
      trace: parseHylyreTrace(trace),
      readyMeta: {
        ok: true,
        doctorOk: true,
        installed_version: '0.5.0',
        manifest_version: '0.5.0',
        version_consistent: true,
      },
      manifestVersion: '0.5.0',
    });
    assert.strictEqual(native.native, true, `steps-file 真实输出未过 native gate：${native.reasons.join('；')}`);

    for (const step of parsed.cases[0].steps as Array<Record<string, any>>) {
      assert.strictEqual(step.device_session, false, 'fake step 不得声称 device session');
      assert.ok(step.outcome && typeof step.outcome.status === 'string', 'step 必须带 v1 outcome');
      for (const flat of ['status', 'failure_kind', 'failure_code', 'evidence', 'error']) {
        assert.strictEqual(step[flat], undefined, `StepResult 不得含 0.3 flat 字段 ${flat}`);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pre-run reject 四要素：结构化 stdout / 非零 exit / 零设备 / 零 trace-report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-prerun-'));
  try {
    // 计划里给一条**契约非法**的步骤：pre-run 校验应在任何设备动作之前拒绝。
    const plan = path.join(root, 'test-plan.md');
    fs.writeFileSync(plan, [
      '# reject',
      '',
      '## 测试用例清单',
      '',
      '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| TC-001 | reject | app | {"touch":{}} | done | P0 | AC-1 |',
      '',
    ].join('\n'), 'utf-8');
    const report = path.join(root, 'test-report.md');
    const trace = path.join(root, 'trace.json');

    // 哨兵：先放已知字节。只证明"没有新建"是不够的——若 reject 路径 **覆盖**了既有
    // trace/report，文件依然存在、`existsSync` 依然为 true，缺陷会整个漏掉。
    const traceSentinel = '{"sentinel":"must-not-be-touched"}';
    const reportSentinel = '# sentinel — must not be touched\n';
    fs.writeFileSync(trace, traceSentinel, 'utf-8');
    fs.writeFileSync(report, reportSentinel, 'utf-8');

    const run = runHylyre(root, [
      'run', '--plan', plan, '--feature', 'reject',      '--report-out', report, '--trace-out', trace, '--use-fakes', '--skip-assert-expected',
    ]);

    // ① 退出码是**约定值**，不是"随便非零"：调用方要能按码分流合法 reject 与崩溃。
    assert.strictEqual(run.status, 2, `pre-run reject 应 exit=2：status=${run.status}\n${run.stdout}\n${run.stderr}`);

    // ② stdout 必须是**单一 JSON 文档**，直接可 parse。
    //    此前从 stdout+stderr 里"搜"JSON 太宽松：日志里混一段 JSON 也能过，
    //    而调用方真正依赖的是"stdout 就是载荷"这条契约。
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    } catch (e) {
      assert.fail(`stdout 不是单一 JSON 载荷（${(e as Error).message}）：\n${run.stdout}`);
    }
    assert.strictEqual(payload!.result_protocol, 'hylyre.step-outcome/1');
    assert.strictEqual(payload!.command_status, 'rejected');
    assert.strictEqual(payload!.phase, 'pre_run_validation');
    const rejection = payload!.rejection as Record<string, unknown>;
    assert.strictEqual(rejection.domain, 'contract', 'pre-run reject 只能是 contract 域');
    assert.ok(
      typeof rejection.code === 'string' && rejection.code.startsWith('contract.'),
      `code 必须是 contract 命名空间：${String(rejection.code)}`,
    );
    assert.ok(typeof rejection.path === 'string' && rejection.path.length > 0, 'rejection 必须定位到 path');

    // ③ 零 trace / 零 report：**逐字节**证明既有文件未被触碰，而不只是"没新建"。
    assert.strictEqual(fs.readFileSync(trace, 'utf-8'), traceSentinel, 'pre-run reject 不得写/覆盖 trace');
    assert.strictEqual(fs.readFileSync(report, 'utf-8'), reportSentinel, 'pre-run reject 不得写/覆盖 report');

    // ④ 零设备动作：拒绝发生在执行之前，输出里不得有任何设备通道痕迹。
    const combined = `${run.stdout}\n${run.stderr}`;
    for (const marker of ['hdc shell', 'hdc -t', 'Connected to device', 'aa start', 'using first device sn', 'EnvPool']) {
      assert.ok(!combined.includes(marker), `pre-run reject 阶段不得触达设备：命中 ${marker}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pre-run reject 载荷与冻结 golden 同形（不是本仓自拟的形状）', () => {
  const contracts = path.join(SRC_ROOT, 'hylyre', 'contracts');
  const goldenDir = path.join(contracts, 'golden', 'pre-run-reject', 'valid');
  const goldens = fs.readdirSync(goldenDir).filter(f => f.endsWith('.json'));
  assert.ok(goldens.length >= 4, `pre-run-reject valid golden 数量异常：${goldens.length}`);
  const load = loadHylyreOutputSchema();
  assert.ok(load.ok, load.ok ? '' : load.detail);
  if (!load.ok) return;
  const preRunSchema = ((load.schema.$defs ?? {}) as Record<string, unknown>).pre_run_reject;
  // 冻结 schema 若把 pre-run reject 定义为独立 $def，则逐份 golden 必须过；
  // 若没有该 $def，则至少保证 golden 的四个判别字段齐备（形状来源仍是冻结包，不是本仓）。
  for (const name of goldens) {
    const doc = JSON.parse(fs.readFileSync(path.join(goldenDir, name), 'utf-8')) as Record<string, unknown>;
    if (preRunSchema && typeof preRunSchema === 'object') {
      const violations = validateLiteSchema(doc, preRunSchema as Record<string, unknown>, load.schema);
      assert.strictEqual(violations.length, 0, `${name}: ${violations.map(v => `${v.path} ${v.message}`).join('；')}`);
    }
    assert.strictEqual(doc.result_protocol, 'hylyre.step-outcome/1', name);
    assert.strictEqual(doc.command_status, 'rejected', name);
    assert.strictEqual(doc.phase, 'pre_run_validation', name);
    const rejection = doc.rejection as Record<string, unknown>;
    assert.strictEqual(rejection.domain, 'contract', name);
    assert.ok(String(rejection.code).startsWith('contract.'), name);
  }
});

export function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of CASES) {
    try {
      testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (e) {
      results.push({
        name: testCase.name,
        ok: false,
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    }
  }
  return Promise.resolve(results);
}
