// reliability-metrics.unit.mjs — dev-only 单测（plan 1dbe4fa4 t1 / §3、§7 A2–A6、A10）
//
// 跑法：npm run release:check-plans-test（= node --test scripts/tests/*.unit.mjs）。
// 被测对象是入口 scripts/reliability-metrics.mjs（它再用 harness 的 ts-node 起采集器子进程），
// 所以每个用例都走真实入口，不绕过 CLI 直接调 TS。
//
// 夹具 scripts/tests/fixtures/reliability/<run>/ 是宿主 run（be091c、0457a6、ae92d8、f829b8、97af3f）的 events.jsonl 与 manifest.json 原样副本
// （不裁剪、不改写、heartbeat 保留），只读。§3.6 的反例在临时目录里用这些真实事件对象拼装，
// 少数生产 writer 事件（supervisor_restart / supersede / manifest_identity_rebase / resume）按 writer 字面形状构造，
// 每处注明 writer 位置。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = path.join(REPO, 'scripts', 'reliability-metrics.mjs');
const FIX = path.join(REPO, 'scripts', 'tests', 'fixtures', 'reliability');
const ID = {
  be: '20260928T043051Z-be091c',
  p0457: '20260926T134302Z-0457a6',
  ae: '20260926T154226Z-ae92d8',
  f8: '20260920T100035Z-f829b8',
  p97: '20260924T135354Z-97af3f',
};

const tmpRoots = [];
after(() => {
  for (const root of tmpRoots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

function cli(args) {
  const r = spawnSync(process.execPath, [ENTRY, ...args, '--format', 'json'], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `入口退出码 ${r.status}\nstderr:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** 目录文件清单 + 每个文件 sha256（A5）。 */
function treeDigest(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else out.push(`${path.relative(dir, abs)} ${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.sort();
}

const fixtureEvents = (id) =>
  fs.readFileSync(path.join(FIX, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const fixtureManifest = (id) => JSON.parse(fs.readFileSync(path.join(FIX, id, 'manifest.json'), 'utf8'));

/** 临时 runs 目录：{ runId: { events, manifest } }；可选观察记录。 */
function mkRunsDir(runs, observation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-metrics-'));
  tmpRoots.push(root);
  const runsDir = path.join(root, 'goal-runs');
  for (const [id, run] of Object.entries(runs)) {
    fs.mkdirSync(path.join(runsDir, id), { recursive: true });
    fs.writeFileSync(path.join(runsDir, id, 'manifest.json'), JSON.stringify({ ...run.manifest, run_id: id }, null, 2), 'utf8');
    fs.writeFileSync(path.join(runsDir, id, 'events.jsonl'), run.events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
  const args = ['--runs-dir', runsDir];
  if (observation) {
    const obsPath = path.join(root, 'observation.json');
    fs.writeFileSync(obsPath, JSON.stringify(observation, null, 2), 'utf8');
    args.push('--observations', obsPath);
  }
  return { root, runsDir, args };
}

/** 原样复制夹具 run 目录（不改写）。 */
function copyFixtureRun(runsDir, id) {
  fs.mkdirSync(path.join(runsDir, id), { recursive: true });
  for (const f of ['events.jsonl', 'manifest.json']) fs.copyFileSync(path.join(FIX, id, f), path.join(runsDir, id, f));
}

const allRuns = (report) => report.tasks.flatMap((t) => t.runs);
const runOf = (report, id) => {
  const r = allRuns(report).find((x) => x.run_id === id);
  assert.ok(r, `报告中找不到 run ${id}`);
  return r;
};
const taskOf = (report, id) => {
  const t = report.tasks.find((x) => x.runs.some((r) => r.run_id === id));
  assert.ok(t, `报告中找不到包含 ${id} 的任务`);
  return t;
};

// ---------------------------------------------------------------------------
// 夹具整目录跑一次：A2/A3/A4 与 §3.5 各坑共用；A5 在同一次运行前后比对哈希。
// ---------------------------------------------------------------------------
let fixtureRun;
function fixtureReport() {
  if (!fixtureRun) {
    const before = treeDigest(FIX);
    const report = cli(['--runs-dir', FIX]);
    fixtureRun = { before, after: treeDigest(FIX), report };
  }
  return fixtureRun.report;
}

test('A5：采集器不向被分析目录写任何文件（清单与哈希前后一致）', () => {
  fixtureReport();
  assert.ok(fixtureRun.before.length === 10, `夹具应为 5 个 run × 2 个文件，实际 ${fixtureRun.before.length}`);
  assert.deepEqual(fixtureRun.after, fixtureRun.before);
});

test('夹具保留 heartbeat（未裁剪）', () => {
  const hb = (id) => fixtureEvents(id).filter((e) => e.type === 'heartbeat').length;
  assert.equal(hb(ID.ae), 65);
  assert.equal(hb(ID.f8), 322);
});

test('A2：be091c 未宣称完成；HALTED/canary_cli_hard_failure；WAITING+external 不带探针；无 run_start；正式调用 0、正式活跃 0', () => {
  const report = fixtureReport();
  const task = taskOf(report, ID.be);
  assert.deepEqual(task.runs.map((r) => r.run_id), [ID.be], 'be091c 没有 supersede 事件，按血缘应是独立任务');
  assert.equal(task.facts.claimed_complete, false);
  assert.equal(task.conclusion, 'incomplete');
  const s = task.stop_state;
  assert.equal(s.status, 'HALTED');
  assert.equal(s.halt_reason, 'canary_cli_hard_failure');
  assert.equal(s.run_disposition, 'WAITING');
  assert.equal(s.run_wait_kind, 'external');
  assert.equal(s.has_probe, false);
  assert.equal(s.has_run_end, true);
  assert.equal(s.reading, 'waiting_external_no_wake');
  assert.equal(s.incident_class, 'external', 'INCIDENT_REGISTRY 原样类别');
  const run = runOf(report, ID.be);
  assert.equal(run.run_start_count, 0);
  assert.equal(run.agent_invocations.total, 0);
  assert.equal(run.formal_active_ms, 0);
  // 坑：没有 run_start 的 run，0 指正式执行计时，不代表启动没有耗时（孤儿段本身有时长）。
  assert.equal(run.sessions.length, 1);
  assert.equal(run.sessions[0].formal, false);
  assert.ok(run.sessions[0].active_ms > 0, '孤儿段时长应如实保留（非正式执行）');
  // successor_of 只作线索
  assert.deepEqual(task.successor_clues, [{ run_id: ID.be, successor_of: ID.f8, in_task: false }]);
  // 只有 events/manifest 的输入：记录与当前义务无法评估
  assert.equal(task.facts.record.evaluable, false);
  assert.match(task.facts.record.reason, /完整工程/);
});

test('A3：f829b8 会话 5 段（1 段无 run_end）；resume 候选 4 条；有效终态 CHAIN_SLICE_COMPLETED', () => {
  const report = fixtureReport();
  const run = runOf(report, ID.f8);
  assert.equal(run.sessions.length, 5);
  assert.equal(run.sessions.filter((x) => !x.has_run_end).length, 1);
  assert.equal(run.effective_run_end.status, 'CHAIN_SLICE_COMPLETED');
  const task = taskOf(report, ID.f8);
  const resumes = task.operator.candidates.filter((c) => c.signal === 'resume_without_supervisor' && c.ref.run_id === ID.f8);
  assert.equal(resumes.length, 4);
  assert.ok(resumes.every((c) => c.status === 'unconfirmed'), '无观察记录时候选一律未确认');
  assert.equal(task.operator.known, false, '无观察记录 → 操作者动作未知');
});

test('坑：一个 run 多个 run_end，以 resolveEffectiveRunEnd 为准', () => {
  const run = runOf(fixtureReport(), ID.f8);
  assert.equal(run.run_end_count, 4);
  assert.equal(run.effective_run_end.status, 'CHAIN_SLICE_COMPLETED');
  assert.equal(run.effective_run_end.event_index, 508);
});

test('坑：run_end 缺 halt_reason 时回退到同一会话段最后一条 phase_halt', () => {
  const run = runOf(fixtureReport(), ID.f8);
  const seg = run.sessions[3];
  assert.equal(seg.run_end.status, 'HALTED');
  assert.equal(seg.run_end.halt_reason, 'visual_ledger_integrity');
  assert.equal(seg.run_end.halt_reason_source, 'phase_halt');
  assert.equal(run.sessions[0].run_end.halt_reason_source, 'run_end');
});

test('A4：ae92d8 调用 8；本 run 实际回退 1（不读累计字段）；backtrack_limit；恢复成本未恢复', () => {
  const report = fixtureReport();
  const run = runOf(report, ID.ae);
  assert.equal(run.agent_invocations.total, 8);
  assert.equal(run.backtracks.requested_events, 1);
  assert.equal(run.backtracks.cumulative_field_last, 2, '累计字段原样输出但不是本 run 的值');
  assert.equal(run.stop_state.halt_reason, 'backtrack_limit');
  assert.equal(run.stop_state.run_disposition, 'TERMINAL');
  // testing FAIL → 回退 → coding/review/ut PASS → testing FAIL → 停机：中途 PASS 不作终点
  const rc = run.recovery_cost;
  assert.equal(rc.status, 'unrecovered');
  assert.equal(rc.measured_to, 'task_end');
  assert.equal(rc.faults.length, 1, '同一阶段在 PASS 前的两次 FAIL 与其后的停机是同一条故障');
  assert.equal(rc.faults[0].phase, 'testing');
  assert.equal(rc.faults[0].event_index, 84);
  assert.equal(rc.faults[0].status, 'unrecovered');
  assert.equal(rc.faults[0].endpoint, null);
});

test('坑：phase_verdict.action 不等于实际转移（读其后的停机/回退事件）', () => {
  const run = runOf(fixtureReport(), ID.ae);
  const last = run.verdict_transitions[run.verdict_transitions.length - 1];
  assert.equal(last.declared_action, 'backtrack_to_phase');
  assert.equal(last.actual, 'halt');
  const first = run.verdict_transitions.find((t) => t.event_index === 84);
  assert.equal(first.actual, 'backtrack');
});

test('坑：heartbeat 累计值是血缘折叠值，不当作本 run 的值', () => {
  const run = runOf(fixtureReport(), ID.ae);
  assert.equal(run.heartbeat_last.turns_used, 27);
  assert.notEqual(run.agent_invocations.total, run.heartbeat_last.turns_used);
  assert.ok(run.formal_active_ms < run.heartbeat_last.elapsed_ms, '本 run 活跃时长应小于血缘折叠的 elapsed_ms');
});

test('坑：按阶段数调用用 agent_invoke_start，不用 phase_start.attempt', () => {
  const run = runOf(fixtureReport(), ID.f8);
  assert.equal(run.agent_invocations.by_phase.testing, 9);
  const phaseStartTesting = fixtureEvents(ID.f8).filter((e) => e.type === 'phase_start' && e.phase === 'testing');
  assert.notEqual(phaseStartTesting.length, 9);
  assert.equal(Math.max(...phaseStartTesting.map((e) => e.attempt)), 2);
});

test('坑：归因字段只原样输出，不参与结论', () => {
  const report = fixtureReport();
  const run = runOf(report, ID.ae);
  assert.equal(run.attribution_raw.recovery.reason, 'backtrack_limit');
  assert.equal(run.stop_state.incident_class, 'recoverable', 'INCIDENT_REGISTRY 原样类别（structurally_terminal 另见原始 disposition）');
  assert.ok(!('root_cause' in run), '不产出根因字段');
});

test('夹具默认分组：以审计 supersede 血缘为主，ae92d8 的任务含 f829b8/97af3f/0457a6', () => {
  const task = taskOf(fixtureReport(), ID.ae);
  assert.deepEqual(task.runs.map((r) => r.run_id), [ID.f8, ID.p97, ID.p0457, ID.ae]);
  assert.ok(task.runs.every((r) => r.source === 'lineage'));
  assert.deepEqual(task.missing_runs, []);
});

test('返修：多 run 任务按故障逐条算恢复，任务未完成时任务级不得为已恢复', () => {
  const report = cli(['--runs-dir', FIX, '--runs', [ID.p97, ID.p0457, ID.ae].join(',')]);
  assert.equal(report.tasks.length, 1);
  const task = report.tasks[0];
  assert.equal(task.facts.claimed_complete, false);
  const rc = task.recovery_cost;
  assert.equal(rc.status, 'unrecovered');
  assert.equal(rc.measured_to, 'task_end');
  const brief = rc.faults.map((f) => [f.run_id, f.event_index, f.phase, f.status, f.endpoint ? [f.endpoint.run_id, f.endpoint.event_index, f.endpoint.kind] : null]);
  assert.deepEqual(brief, [
    // 97af3f ut 停机（executor_waiting）→ ae92d8 ut PASS（下标 49）
    [ID.p97, 21, 'ut', 'recovered', [ID.ae, 49, 'phase_pass']],
    // 0457a6 coding FAIL(retry) → FAIL(halt) → phase_halt 同一条 → ae92d8 coding PASS（下标 17）
    [ID.p0457, 23, 'coding', 'recovered', [ID.ae, 17, 'phase_pass']],
    // ae92d8 testing FAIL → 回退 → 中途 coding/review/ut PASS 不作终点 → testing FAIL → 停机
    [ID.ae, 84, 'testing', 'unrecovered', null],
  ]);
  assert.equal(rc.faults[1].halt_reason, 'no_progress_guard', '同阶段紧随的停机并入该故障，停机原因附上');
});

test('返修：宣称完成的封卷态与 verify-feature-completion 一致，legacy COMPLETED 也算', () => {
  const f8 = fixtureEvents(ID.f8);
  const L = '20260920T100035Z-legacy';
  // legacy writer 的成功终态写 COMPLETED（verify-feature-completion.ts RUN_END_LINEAGE_OK / NON_TERMINAL_OK 同时接受两种）
  const events = f8.map((e, i) => (i === 508 ? { ...e, status: 'COMPLETED' } : e));
  const { args } = mkRunsDir({ [L]: { events, manifest: fixtureManifest(ID.f8) } }, null);
  const task = cli(args).tasks[0];
  assert.equal(task.facts.claimed_complete, true);
  assert.equal(task.facts.claimed_basis, 'run_end');
  assert.equal(task.stop_state.reading, null);
  assert.equal(task.recovery_cost.status, 'recovered');
});

test('--runs 显式指定：ae92d8 单独成任务，任务级恢复成本未恢复', () => {
  const report = cli(['--runs-dir', FIX, '--runs', ID.ae]);
  assert.equal(report.tasks.length, 1);
  assert.equal(report.tasks[0].recovery_cost.status, 'unrecovered');
  assert.equal(report.tasks[0].unaffected_reruns.exact, null);
  assert.match(report.tasks[0].unaffected_reruns.note, /代理/);
});

test('无影响阶段重跑：给定阶段与扰动点时数其后的 agent_invoke_start（精确值）', () => {
  const { args } = mkRunsDir({}, null);
  const runsDir = args[1];
  copyFixtureRun(runsDir, ID.f8);
  const obs = path.join(path.dirname(runsDir), 'obs.json');
  fs.writeFileSync(obs, JSON.stringify({
    tasks: [{ runs: [ID.f8], interventions: [], unaffected: { phases: ['review', 'ut'], after: { run_id: ID.f8, event_index: 362 } } }],
  }), 'utf8');
  const report = cli([...args, '--observations', obs]);
  // 362 之后 review-i13、ut-i14 各一次
  assert.equal(report.tasks[0].unaffected_reruns.exact, 2);
});

// ---------------------------------------------------------------------------
// §3.6 六个反例
// ---------------------------------------------------------------------------

test('反例 1：attended 会话自行恢复 → 候选 1 条，已确认人工救场 0', () => {
  const f8 = fixtureEvents(ID.f8);
  const R = '20260920T100035Z-aaaaa1';
  // 真实事件：第 1 段 HALTED(content_retry_exhausted) + 第 2 段 run_start/resume（宿主桥自行恢复，无 supervisor_restart）
  const { args } = mkRunsDir({ [R]: { events: f8.slice(1, 134), manifest: fixtureManifest(ID.f8) } }, {
    tasks: [{ runs: [R], interventions: [], independent_acceptance: { result: 'not_accepted' } }],
  });
  const task = cli(args).tasks[0];
  assert.equal(task.operator.candidates.length, 1);
  assert.equal(task.operator.candidates[0].signal, 'resume_without_supervisor');
  assert.equal(task.operator.candidates[0].status, 'unconfirmed');
  assert.equal(task.operator.known, true);
  assert.equal(task.operator.rescue_count, 0);
});

test('反例 2：supervisor 自动拉起后继 → 候选 1 条，已确认人工救场 0', () => {
  const f8 = fixtureEvents(ID.f8);
  const ae = fixtureEvents(ID.ae);
  const S = '20260920T100035Z-sssss1';
  const N = '20260926T154226Z-nnnnn1';
  // supervisor_restart：goal-supervise.ts appendSupervisorEvent({type:'supervisor_restart', action:'resume', ...}) 字面形状
  const restart = {
    ts: '2026-09-20T10:45:00.000Z', type: 'supervisor_restart', action: 'resume', run_id: S,
    restart_seq: 1, backoff_ms: 0, reason: 'beacon 陈旧（进程已死）且 run_disposition=RESUME_READY——可续跑',
    successor_required: true, successor_start_phase: 'coding',
  };
  // supersede：goal-run-creation.ts buildSupersedeAuditEvent 字面形状（真实 ae92d8[2] 同形）
  const supersede = { ts: ae[2].ts, type: 'supersede', target_run_id: S, superseding_run_id: N };
  const { args } = mkRunsDir({
    [S]: { events: [...f8.slice(1, 110), restart], manifest: fixtureManifest(ID.f8) },
    // 后继沿用源 run 的 manifest 配置（supervisor 拉起不改模型钉值），否则会多出一条 model_pin_change 候选
    [N]: { events: [ae[1], supersede, ...ae.slice(5)], manifest: fixtureManifest(ID.f8) },
  }, { tasks: [{ runs: [N], interventions: [] }] });
  const report = cli(args);
  assert.equal(report.tasks.length, 1);
  const task = report.tasks[0];
  assert.deepEqual(task.runs.map((r) => [r.run_id, r.source]), [[S, 'lineage'], [N, 'lineage']]);
  assert.equal(task.operator.candidates.length, 1);
  assert.equal(task.operator.candidates[0].signal, 'supersede_successor');
  assert.equal(task.operator.candidates[0].status, 'unconfirmed');
  assert.equal(task.operator.rescue_count, 0);
});

test('反例 3：启动即失败的 run 由观察记录补入任务 → 任务含该 run，操作者动作按观察记录计', () => {
  const { runsDir, root } = mkRunsDir({}, null);
  copyFixtureRun(runsDir, ID.p0457);
  copyFixtureRun(runsDir, ID.be);
  const obs = path.join(root, 'obs.json');
  fs.writeFileSync(obs, JSON.stringify({
    tasks: [{
      runs: [ID.p0457, ID.be],
      interventions: [{
        kind: 'rescue_command', actor: 'operator', necessary: true, content: '重新起跑',
        related_events: [{ run_id: ID.be, event_index: 2 }],
      }],
    }],
  }), 'utf8');
  const report = cli(['--runs-dir', runsDir, '--observations', obs]);
  assert.equal(report.tasks.length, 1);
  const task = report.tasks[0];
  assert.deepEqual(task.runs.map((r) => [r.run_id, r.source]), [[ID.p0457, 'lineage'], [ID.be, 'observation']]);
  assert.equal(task.operator.known, true);
  assert.equal(task.operator.rescue_count, 1);
  // 任务最后一个 run 是 be091c：停止状态取它
  assert.equal(task.stop_state.halt_reason, 'canary_cli_hard_failure');
});

test('反例 4：一条动作关联恢复、身份改写、模型变化三个信号 → 已确认人工救场 1', () => {
  const be = fixtureEvents(ID.be);
  const f8 = fixtureEvents(ID.f8);
  const Q = '20260928T050000Z-qqqqq1';
  const at = (e, ts) => ({ ...e, ts });
  const qEvents = [
    at(f8[1], '2026-09-28T05:00:01.000Z'), // run_start
    at(be[1], '2026-09-28T05:00:10.000Z'), // phase_halt canary_cli_hard_failure
    at(be[2], '2026-09-28T05:00:10.000Z'), // run_end HALTED
    // manifest_identity_rebase：goal-phase-runtime.ts goalEvents.emit({type:'manifest_identity_rebase', to_fields, authorized_by, changed_fields}) 字面形状
    { ts: '2026-09-28T05:10:00.000Z', type: 'manifest_identity_rebase', to_fields: be[0].manifest_identity_fields, authorized_by: '--force-resume', changed_fields: ['adapter_model_pin'] },
    at(f8[110], '2026-09-28T05:10:00.100Z'), // run_start
    at(f8[112], '2026-09-28T05:10:00.200Z'), // resume
  ];
  const { runsDir, root } = mkRunsDir({ [Q]: { events: qEvents, manifest: fixtureManifest(ID.ae) } }, null);
  copyFixtureRun(runsDir, ID.be);
  const obs = path.join(root, 'obs.json');
  fs.writeFileSync(obs, JSON.stringify({
    tasks: [{
      runs: [ID.be, Q],
      interventions: [{
        kind: 'config_change', actor: 'operator', necessary: true, content: '钉可用模型后续跑',
        related_events: [{ run_id: Q, event_index: 5 }, { run_id: Q, event_index: 3 }, { run_id: Q, event_index: 0 }],
      }],
    }],
  }), 'utf8');
  const task = cli(['--runs-dir', runsDir, '--observations', obs]).tasks[0];
  const signals = task.operator.candidates.map((c) => c.signal).sort();
  assert.deepEqual(signals, ['manifest_identity_rebase', 'model_pin_change', 'resume_without_supervisor']);
  assert.ok(task.operator.candidates.every((c) => c.status === 'confirmed'));
  assert.equal(task.operator.rescue_count, 1);
});

/** 取真实采集器对 f829b8 的任务输出，改写记录与独立验收两类事实，写成 scenario-results。 */
function completedTaskWith(record, acceptance) {
  const task = structuredClone(cli(['--runs-dir', FIX, '--runs', ID.f8]).tasks[0]);
  assert.equal(task.facts.claimed_complete, true, 'f829b8 有效 run_end 为 CHAIN_SLICE_COMPLETED');
  task.facts.record = record;
  task.facts.acceptance = acceptance;
  task.conclusion = 'correct_completion'; // 故意写错：聚合必须按事实重新推导，不信存量结论
  return task;
}

test('反例 5/6：宣称完成且独立验收失败 → 错误完成，与完成记录有效与否无关', () => {
  const ok = completedTaskWith({ evaluable: true, state: 'ok', run_id: ID.f8, issued_in_task: true, reasons: [], uncovered: [], blocking: [], complete: true }, { result: 'fail', actor: 'test', basis: 'fixture' });
  const broken = completedTaskWith({ evaluable: true, state: 'broken', run_id: ID.f8, issued_in_task: true, reasons: ['x'], uncovered: [], blocking: [], complete: false }, { result: 'fail', actor: 'test', basis: 'fixture' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-metrics-'));
  tmpRoots.push(root);
  const file = path.join(root, 'scenario-results.json');
  fs.writeFileSync(file, JSON.stringify({ tasks: [ok, broken] }), 'utf8');
  const report = cli(['--scenario-results', file]);
  assert.deepEqual(report.tasks.map((t) => t.conclusion), ['wrong_completion', 'wrong_completion']);
  assert.equal(report.metrics.observed_wrong_completions, 2);
  assert.equal(report.metrics.correct_autonomous_completion.numerator, 0);
});

test('宣称完成、独立验收失败、记录无法评估（只有 events/manifest）→ 仍为错误完成', () => {
  const { runsDir, root } = mkRunsDir({}, null);
  copyFixtureRun(runsDir, ID.f8);
  const obs = path.join(root, 'obs.json');
  fs.writeFileSync(obs, JSON.stringify({
    tasks: [{ runs: [ID.f8], interventions: [], independent_acceptance: { result: 'fail', actor: 'operator', basis: '人工核对' } }],
  }), 'utf8');
  const task = cli(['--runs-dir', runsDir, '--observations', obs]).tasks[0];
  assert.equal(task.facts.record.evaluable, false);
  assert.equal(task.conclusion, 'wrong_completion');
});

test('口径修正：重复运行稳定性按"场景 + 分支"分组，不同分支不算重复运行，单次运行为未测', () => {
  const base = completedTaskWith({ evaluable: false, reason: 'fixture' }, { result: 'pass', actor: 'test', basis: 'fixture' });
  const branch = (scenario, key, acceptance) => ({
    ...structuredClone(base), scenarios: [scenario], facts: { ...base.facts, acceptance: { result: acceptance, actor: 'test', basis: 'fixture' } },
    scenario_meta: { id: scenario, branch: key },
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-metrics-'));
  tmpRoots.push(root);
  const file = path.join(root, 'scenario-results.json');
  fs.writeFileSync(file, JSON.stringify({
    tasks: [
      branch('S1', 'no_substitute', 'fail'), branch('S1', 'substitute', 'pass'), // 同场景不同分支：各一次，未测
      branch('S2', 'main', 'pass'), branch('S2', 'main', 'fail'), // 同场景同分支两次：分布
    ],
  }), 'utf8');
  const stability = cli(['--scenario-results', file]).metrics.repeat_stability;
  assert.deepEqual(stability, {
    'S1/no_substitute': '未测',
    'S1/substitute': '未测',
    'S2/main': { correct_completion: 1, wrong_completion: 1 },
  });
});

// ---------------------------------------------------------------------------
// codex 实现 review 首轮返修（2026-09-28）
// ---------------------------------------------------------------------------

/** dry-run 会话：goal-phase-runtime.ts setAppendEventBaseFields({ dry_run: true }) 使全段事件带 dry_run:true。 */
function drySession(t0, endStatus) {
  const at = (s) => new Date(Date.parse(t0) + s * 1000).toISOString();
  return [
    { ts: at(0), type: 'run_start', dry_run: true, chain: ['coding', 'review', 'ut', 'testing'], manifest_hash: 'dry' },
    { ts: at(1), type: 'phase_start', phase: 'coding', attempt: 1, dry_run: true },
    { ts: at(2), type: 'run_end', status: endStatus, dry_run: true },
  ];
}

test('返修 1：正式 HALTED 之后追加 dry 会话，正式结论不变（有效终态、最后会话取 authoritative 视图）', () => {
  const ae = fixtureEvents(ID.ae);
  const R = '20260926T154226Z-dry001';
  const { args } = mkRunsDir({ [R]: { events: [...ae, ...drySession('2026-09-27T00:00:00.000Z', 'CHAIN_SLICE_COMPLETED')], manifest: fixtureManifest(ID.ae) } }, null);
  const task = cli(args).tasks[0];
  assert.equal(task.facts.claimed_complete, false, 'dry 会话的 run_end 不得算宣称完成');
  assert.equal(task.stop_state.status, 'HALTED');
  assert.equal(task.stop_state.halt_reason, 'backtrack_limit');
  assert.equal(task.stop_state.has_run_end, true);
  assert.equal(task.stop_state.reading, 'terminal');
  const run = task.runs[0];
  assert.equal(run.sessions.length, 2, '原始会话保留作明细（含 dry 段）');
  assert.equal(run.sessions[1].mode, 'dry');
});

test('返修 1：完成之后追加 HALTED 的 dry 会话，仍是宣称完成', () => {
  const f8 = fixtureEvents(ID.f8);
  const R = '20260920T100035Z-dry002';
  const { args } = mkRunsDir({ [R]: { events: [...f8, ...drySession('2026-09-25T00:00:00.000Z', 'HALTED')], manifest: fixtureManifest(ID.f8) } }, null);
  const task = cli(args).tasks[0];
  assert.equal(task.facts.claimed_complete, true);
  assert.equal(task.stop_state.status, 'CHAIN_SLICE_COMPLETED');
  assert.equal(task.stop_state.reading, null);
});

test('返修 2：同秒的源 run HALTED、字典序更小的后继完成 → 输出后继终态与正向恢复时间', () => {
  const ae = fixtureEvents(ID.ae);
  const f8 = fixtureEvents(ID.f8);
  const S = '20260928T050000Z-zzzzz9'; // 源：字典序大
  const N = '20260928T050000Z-aaaaa1'; // 后继：同秒、字典序小
  const at = (e, ms, extra = {}) => ({ ...e, ts: `2026-09-28T05:00:00.${String(ms).padStart(3, '0')}Z`, ...extra });
  const source = [at(ae[0], 100), at(ae[1], 110), at(ae[84], 200), at(ae[162], 210), at(ae[163], 220)];
  // supersede：goal-run-creation.ts buildSupersedeAuditEvent 字面形状（ae92d8[2] 同形）
  const successor = [at(ae[0], 600), at(ae[1], 610), { ts: '2026-09-28T05:00:00.620Z', type: 'supersede', target_run_id: S, superseding_run_id: N },
    at(ae[84], 700, { verdict: 'PASS' }), at(f8[508], 900)];
  const man = (created) => ({ ...fixtureManifest(ID.ae), created_at: created });
  const { args } = mkRunsDir({
    [S]: { events: source, manifest: man('2026-09-28T05:00:00.050Z') },
    [N]: { events: successor, manifest: man('2026-09-28T05:00:00.550Z') },
  }, null);
  const report = cli(args);
  assert.equal(report.tasks.length, 1);
  const task = report.tasks[0];
  assert.deepEqual(task.runs.map((r) => r.run_id), [S, N], '任务内顺序按血缘与创建时间，不按随机后缀');
  assert.equal(task.facts.claimed_complete, true);
  assert.equal(task.stop_state.status, 'CHAIN_SLICE_COMPLETED');
  const rc = task.recovery_cost;
  assert.equal(rc.status, 'recovered');
  assert.ok(rc.wall_ms > 0, `恢复墙钟应为正：${rc.wall_ms}`);
  assert.ok(rc.faults.every((f) => f.wall_ms === null || f.wall_ms >= 0), JSON.stringify(rc.faults.map((f) => f.wall_ms)));
});

test('返修 3：观察记录只写了 runs 与独立验收、没有 interventions 字段 → 操作者动作未知，不计入自主完成分子', () => {
  const { runsDir, root } = mkRunsDir({}, null);
  copyFixtureRun(runsDir, ID.f8);
  const obs = path.join(root, 'obs.json');
  fs.writeFileSync(obs, JSON.stringify({
    tasks: [{ runs: [ID.f8], independent_acceptance: { result: 'pass', actor: 'operator', basis: '人工核对' }, recoverable_fault: true }],
  }), 'utf8');
  const report = cli(['--runs-dir', runsDir, '--observations', obs]);
  const task = report.tasks[0];
  assert.equal(task.conclusion, 'correct_completion');
  assert.equal(task.operator.known, false, '缺 interventions 字段 = 没有提供动作信息');
  assert.equal(task.operator.rescue_count, null);
  assert.equal(report.metrics.correct_autonomous_completion.numerator, 0);
  assert.equal(report.metrics.correct_autonomous_completion.unknown, 1);
  assert.equal(report.metrics.auto_recovery.numerator, 0);
  assert.equal(report.metrics.auto_recovery.unknown, 1);
});

test('返修 3：显式 interventions: [] 才是零次', () => {
  const { runsDir, root } = mkRunsDir({}, null);
  copyFixtureRun(runsDir, ID.f8);
  const obs = path.join(root, 'obs.json');
  fs.writeFileSync(obs, JSON.stringify({
    tasks: [{ runs: [ID.f8], interventions: [], independent_acceptance: { result: 'pass', actor: 'operator', basis: '人工核对' } }],
  }), 'utf8');
  const report = cli(['--runs-dir', runsDir, '--observations', obs]);
  assert.equal(report.tasks[0].operator.known, true);
  assert.equal(report.tasks[0].operator.rescue_count, 0);
  assert.equal(report.metrics.correct_autonomous_completion.numerator, 1);
});

test('返修 4：场景结果里的函数级预判不进任务与指标，Markdown 单列为"函数级预判，未执行任务"', () => {
  const executed = completedTaskWith({ evaluable: false, reason: 'fixture' }, { result: 'pass', actor: 'test', basis: 'fixture' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-metrics-'));
  tmpRoots.push(root);
  const file = path.join(root, 'scenario-results.json');
  fs.writeFileSync(file, JSON.stringify({
    tasks: [executed],
    predictions: [{ id: 'S10', branch: 'old-snapshot', label: '旧快照', predicted_chain: ['coding', 'review', 'ut'], executed_phases: ['coding', 'review', 'ut'], predicted_reruns: 3, note: '出生链预判' }],
  }), 'utf8');
  const report = cli(['--scenario-results', file]);
  assert.equal(report.tasks.length, 1, '函数级预判不是任务');
  assert.equal(report.metrics.correct_autonomous_completion.denominator, 1);
  assert.equal(report.function_level_predictions.length, 1);
  assert.equal(report.function_level_predictions[0].predicted_reruns, 3);
  const md = spawnSync(process.execPath, [ENTRY, '--scenario-results', file, '--format', 'md'], { encoding: 'utf8' });
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /函数级预判，未执行任务/);
  assert.match(md.stdout, /S10\/old-snapshot/);
});

test('批二确认轮遗留：两次启动提前退出之后恢复，恢复成本按真实活动区间求交集（不当作连续区间）', () => {
  // 事件形状取自 goal-phase-runtime.ts 的生产 writer：run_start{dry_run,session_started_at,chain,manifest_hash}；
  // writeTerminalEvent 的 run_end{INTERRUPTED,reason}；金丝雀提前退出的 phase_halt + run_end{HALTED,session_started_at}（带写盘层投影）；
  // decideAndEmit 的 phase_verdict{phase,verdict,action}。
  const T0 = Date.parse('2026-09-29T00:00:00.000Z');
  const at = (s) => new Date(T0 + s * 1000).toISOString();
  const chain = ['spec'];
  const earlyExit = (from, to) => [
    { ts: at(to), type: 'phase_halt', phase: 'spec', halt_reason: 'canary_cli_hard_failure', verdict: 'FAIL', reason: 'model not supported',
      halt_guidance: '视觉金丝雀探测遇 CLI/adapter 兼容性问题', run_disposition: 'WAITING', run_wait_kind: 'external' },
    { ts: at(to), type: 'run_end', status: 'HALTED', halt_reason: 'canary_cli_hard_failure', session_started_at: at(from),
      error: 'model not supported', run_disposition: 'WAITING', run_wait_kind: 'external' },
  ];
  const events = [
    { ts: at(0), type: 'run_start', dry_run: false, session_started_at: at(0), chain, manifest_hash: 'h' },
    { ts: at(10), type: 'run_end', status: 'INTERRUPTED', reason: 'SIGTERM' },
    ...earlyExit(600, 610),
    ...earlyExit(1200, 1230),
    { ts: at(1800), type: 'run_start', dry_run: false, session_started_at: at(1800), chain, manifest_hash: 'h' },
    { ts: at(1801), type: 'phase_start', phase: 'spec', attempt: 1 },
    { ts: at(1810), type: 'phase_verdict', phase: 'spec', verdict: 'PASS', action: 'advance' },
    { ts: at(1811), type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
  ];
  const R = '20260929T000000Z-gap001';
  const { args } = mkRunsDir({ [R]: { events, manifest: fixtureManifest(ID.f8) } }, null);
  const task = cli(args).tasks[0];
  const fault = task.recovery_cost.faults[0];
  assert.equal(fault.phase, 'spec');
  assert.equal(fault.status, 'recovered');
  // [610, 1810] ∩ 真实活动区间：600–610 → 0，1200–1230 → 30 秒，1800–1810 → 10 秒
  assert.equal(fault.active_ms, 40_000, `恢复成本应按真实区间求交集：${fault.active_ms}`);
});

test('Markdown 输出可渲染（含三类事实与六项指标标题）', () => {
  const r = spawnSync(process.execPath, [ENTRY, '--runs-dir', FIX, '--format', 'md'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /宣称完成/);
  assert.match(r.stdout, /正确自主完成/);
  assert.match(r.stdout, /恢复成本/);
});
