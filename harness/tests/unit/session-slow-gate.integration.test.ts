import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { spawn, spawnSync } from 'child_process';
import { prepareSessionCliProject } from '../utils/session-cli-project';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import type { SessionExecutionRequest } from '../../scripts/utils/session-execution-handoff';
import type { UnitCaseResult } from '../run-unit';

const { instrumentSlowCompile, observeAndInterrupt } = require('../utils/session-cli-interruption.cjs') as {
  instrumentSlowCompile(root: string): void; observeAndInterrupt(root: string, evidence: string, timeoutMs: number): Promise<Record<string, unknown>>;
};

const SOURCE_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = 'session-cli';
const FEATURE = 'clamp';
const SOURCE = 'src/math/src/main/clamp.ts';
const TEST = 'src/math/src/test/clamp.test.ts';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function readJson(file: string): any { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(root: string, file: string, text: string): void {
  const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text, 'utf8');
}
function rows(file: string): Array<Record<string, any>> {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function parseCli(stdout: string): any {
  const line = stdout.trim().split(/\r?\n/).reverse().find(value => value.trim().startsWith('{'));
  if (!line) throw new Error('CLI returned no JSON: ' + stdout.slice(-3000));
  return JSON.parse(line);
}
function cliArgs(root: string, entry: 'goal-mode-entry' | 'harness-runner', args: string[]): string[] {
  const harness = path.join(root, 'framework/harness');
  return [path.join(harness, 'node_modules/ts-node/dist/bin.js'), '--project', path.join(harness, 'tsconfig.json'),
    path.join(harness, entry === 'goal-mode-entry' ? 'scripts/goal-mode-entry.ts' : 'harness-runner.ts'),
    '--project-root', root, '--framework-root', path.join(root, 'framework'), ...args];
}
function environment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') };
  for (const key of Object.keys(env)) if (/^MAISON_GOAL_(?!CHECKPOINT_DIR)/i.test(key)) delete env[key];
  return env;
}
function controlArgs(action: string[]): string[] {
  return ['--feature', FEATURE, '--run-id', RUN_ID, '--adapter', 'claude', '--run-mode', 'attended', '--authorize-autonomy', ...action];
}
function run(root: string, entry: 'goal-mode-entry' | 'harness-runner', args: string[], label: string) {
  const result = spawnSync(process.execPath, cliArgs(root, entry, args), { cwd: path.join(root, 'framework/harness'), env: environment(root), encoding: 'utf8', timeout: 90_000, windowsHide: true });
  write(root, `observations/${label}.stdout.log`, result.stdout ?? ''); write(root, `observations/${label}.stderr.log`, result.stderr ?? '');
  if (result.error) throw result.error;
  return { ...result, value: entry === 'goal-mode-entry' && result.status === 0 ? parseCli(result.stdout) : undefined };
}
function authorMaterials(root: string, request: SessionExecutionRequest): void {
  const phase = request.context.phase;
  if (phase === 'coding') {
    write(root, SOURCE, 'export function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n');
    const inputs = [SOURCE, 'src/math/src/main/index.ts', 'src/math/src/main/limits.ts', 'src/math/src/test/expect.ts', 'doc/requirement.md', 'doc/architecture.md',
      'doc/module-catalog.yaml', 'doc/glossary.yaml', 'doc/features/clamp/contracts.yaml', 'doc/features/clamp/acceptance.yaml', 'framework.config.json'];
    for (const file of inputs) fs.readFileSync(path.join(root, file), 'utf8');
    write(root, 'doc/features/clamp/context/facts.md', '---\n' + YAML.stringify({ schema_version: '1.1', feature: FEATURE, run_id: RUN_ID,
      established_by: 'coding', ready_to_produce: true, has_blocker_coverage_risk: false, exploration_mode: 'sequential', change_intent: 'bugfix',
      estimated_loc_delta: 1, single_function_scope: true, source_code_paths: inputs.slice(0, 4), key_inputs_read: inputs,
      files_inspected_count: inputs.length, searches_performed_estimate: 5, decisions_unlocked: ['restore the approved clamp contract'], subagents_used: 'none' }) +
      '---\n\n## Code Facts\n\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + inputs.slice(0, 4).map(file => `| ${file} | ${fs.readFileSync(path.join(root, file), 'utf8').split('\n')[0].replace(/\|/g, '/')} | Preserve the approved contract |`).join('\n') + '\n');
  } else if (phase === 'review') {
    for (const file of [SOURCE, 'src/math/src/main/index.ts', 'src/math/src/main/limits.ts', 'doc/features/clamp/contracts.yaml', 'doc/features/clamp/acceptance.yaml']) fs.readFileSync(path.join(root, file));
    write(root, 'doc/features/clamp/review/review-report.md', [
      '# clamp Code Review', '> **模块标识**: clamp', '> **审查日期**: 2026-10-24', '> **审查版本**: 1.0', '> **审查人**: deterministic model substitute',
      '', '## 一、审查范围', '', SOURCE, 'src/math/src/main/index.ts', 'src/math/src/main/limits.ts', '对照 doc/features/clamp/contracts.yaml 与 acceptance.yaml；没有 plan.md，不补造设计。',
      '', '## 二、审查方法', '', '检查架构、接口、编码规范、业务逻辑、数据层。clamp 是无副作用纯函数，不读取数据。',
      '静态核对：clamp(-2,0,10)=0；clamp(12,0,10)=10；clamp(4,0,10)=4。运行时断言由 UT 阶段实际执行。',
      '', '## 三、问题清单', '', '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |', '|---|---|---|---|---|---|',
      '', '本次未发现问题。', '', '## 四、问题统计', '', '| 严重程度 | 数量 |', '|---|---|', '| BLOCKER | 0 |', '| MAJOR | 0 |', '| MINOR | 0 |', '| INFO | 0 |',
      '', '## 五、修复建议', '', '无。', '', '## 六、结论', '', '**审查结论**: 通过', '',
    ].join('\n'));
  } else if (phase === 'ut') {
    write(root, TEST, ["import { it } from 'node:test';", "import { expect } from './expect';", "import { clamp } from '../main/clamp';", '',
      "it('[AC-1] below lower bound', () => { expect(clamp(-2, 0, 10)).toBe(0); });",
      "it('[AC-2] above upper bound', () => { expect(clamp(12, 0, 10)).toBe(10); });",
      "it('[AC-3] inside range', () => { expect(clamp(4, 0, 10)).toBe(4); });", '',
    ].join('\n'));
    write(root, 'doc/features/clamp/ut/testability-audit.md', '# Testability\n\n```yaml\n' + YAML.stringify({ records: ['AC-1', 'AC-2', 'AC-3'].map(acceptance_id => ({ acceptance_id,
      entry_point: { file: SOURCE, symbol: 'clamp' }, testability_level: 'L1', dependencies: [{ name: 'Math', kind: 'pure' }], verdict: 'testable' })) }) + '```\n');
    write(root, 'doc/features/clamp/ut/reports/coverage-evidence.json', JSON.stringify({ schema_version: '1.0', feature: FEATURE, primary_evidence_source: 'ut_tags', sources: { ut_tags: [TEST] },
      mappings: ['AC-1', 'AC-2', 'AC-3'].map(scope_id => ({ scope_id, scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' })) }, null, 2));
  } else throw new Error('Unexpected author phase: ' + phase);
  if (phase !== 'coding') fs.appendFileSync(path.join(root, 'doc/features/clamp/context/facts.md'), `\n## phase_delta: ${phase}\n\n` + (phase === 'ut'
    ? `| 路径 | 事实 | 影响 |\n|---|---|---|\n| ${TEST} | Three real node:test assertions cover AC-1, AC-2 and AC-3 | UT only; product source unchanged |\n`
    : 'The reviewed implementation remains unchanged; the review report records the source and contract inspection.\n'));
  fs.appendFileSync(path.join(root, 'observations/author-calls.jsonl'), JSON.stringify({ phase, invoke: request.invoke_id, at: new Date().toISOString(), boundary: 'deterministic author output substitute; no runtime events or verdicts written' }) + '\n');
}
function selfCheck(root: string, request: SessionExecutionRequest): void {
  const ctx = request.context;
  const args = ['--phase', ctx.phase, '--feature', FEATURE, '--goal-run-id', ctx.runId, '--goal-attempt-id', ctx.attemptId,
    '--goal-owner-id', ctx.owner.owner_id, '--goal-owner-epoch', String(ctx.owner.epoch)];
  run(root, 'harness-runner', [...args, '--summary'], ctx.phase + '-selfcheck');
  const reports = path.join(root, `doc/features/${FEATURE}/${ctx.phase}/reports`);
  const summary = readJson(path.join(reports, 'summary.json'));
  if (summary.verdict !== 'PASS') throw new Error(`Real ${ctx.phase} self-check failed: ${JSON.stringify(readJson(path.join(reports, 'script-report.json')).checks.filter((check: any) => check.status === 'FAIL'))}`);
  assert(summary.verifier_subject_id, 'real self-check must issue its verifier subject');
  publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports, feature: FEATURE, phase: ctx.phase, subjectId: summary.verifier_subject_id,
    reportText: 'Deterministic verifier model substitute for a process-containment regression. Product source and native compiler/tests remain real; this is not a model-quality acceptance.', skipSummaryPatch: true });
  const closed = run(root, 'harness-runner', [...args, '--sync-closure'], ctx.phase + '-sync-closure');
  assert.equal(closed.status, 0, closed.stderr + closed.stdout);
}
async function interruptedReport(root: string, requestPath: string, runDir: string): Promise<void> {
  const stdout = fs.openSync(path.join(root, 'observations/killed-report.stdout.log'), 'w');
  const stderr = fs.openSync(path.join(root, 'observations/killed-report.stderr.log'), 'w');
  const child = spawn(process.execPath, cliArgs(root, 'goal-mode-entry', controlArgs(['--request', requestPath, '--report-result', JSON.stringify({ phase: 'coding', status: 'passed' })])),
    { cwd: path.join(root, 'framework/harness'), env: environment(root), stdio: ['ignore', stdout, stderr], windowsHide: true });
  fs.closeSync(stdout); fs.closeSync(stderr);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  const deadline = Date.now() + 30_000;
  let binding: Record<string, any> | undefined;
  while (Date.now() < deadline) {
    const native = rows(path.join(root, 'observations/native-gates.jsonl'));
    binding = rows(path.join(runDir, 'events.jsonl')).find(event => event.type === 'harness_start' && event.process_role === 'harness' && event.phase === 'coding');
    if (native.some(event => event.kind === 'enter') && binding) break;
    if (child.exitCode !== null) throw new Error('Report exited before the delayed real gate: ' + fs.readFileSync(path.join(root, 'observations/killed-report.stderr.log'), 'utf8'));
    await pause(50);
  }
  assert(binding, 'must observe the production harness process binding');
  assert(rows(path.join(root, 'observations/native-gates.jsonl')).some(event => event.kind === 'enter'));
  const before = rows(path.join(runDir, 'events.jsonl'));
  assert.equal(before.filter(event => event.type === 'agent_invoke_end' && event.handoff_report).length, 1, 'executor report must be accepted before the external kill');
  assert(!before.some(event => event.type === 'harness_end' && event.phase === 'coding'), 'kill must happen while the real gate is running');
  assert(child.pid && alive(child.pid));
  const evidence = process.platform === 'win32'
    ? await observeAndInterrupt(root, path.join(root, 'observations/external-kill.json'), 30_000)
    : { kill_status: child.kill('SIGKILL') ? 0 : 1, kill_argv: ['SIGKILL', child.pid] };
  assert.equal(evidence.kill_status, 0, JSON.stringify(evidence));
  const result = await exited;
  write(root, 'observations/external-kill.json', JSON.stringify({ ...evidence, reporter_pid: child.pid,
    binding, reporter_exit: result, at_ms: Date.now(), old_guardian_alive_when_reconnecting: alive(Number(binding.pid)) }, null, 2));
}

async function execute(): Promise<void> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-slow-gate-'));
  const root = path.join(temporary, 'host');
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  try {
    prepareSessionCliProject(root, 'claude', false);
    fs.mkdirSync(path.join(root, 'observations'));
    instrumentSlowCompile(root);
    const runDir = path.join(root, `doc/features/${FEATURE}/goal-runs/${RUN_ID}`);
    let step = run(root, 'goal-mode-entry', controlArgs(['--next']), 'first-next').value;
    let killed = false;
    for (let turn = 0; turn < 6 && step?.type === 'phase_execute_request'; turn++) {
      const requestPath = step.request.path as string; const request = readJson(requestPath) as SessionExecutionRequest;
      authorMaterials(root, request); selfCheck(root, request);
      if (!killed) {
        assert.equal(request.context.phase, 'coding');
        await interruptedReport(root, requestPath, runDir); killed = true;
        const resumed = run(root, 'goal-mode-entry', controlArgs(['--next']), 'resume-after-external-kill');
        assert.equal(resumed.status, 0, resumed.stderr + resumed.stdout); step = resumed.value;
      } else {
        const reported = run(root, 'goal-mode-entry', controlArgs(['--request', requestPath, '--report-result', JSON.stringify({ phase: request.context.phase, status: 'passed' })]), request.context.phase + '-report');
        assert.equal(reported.status, 0, reported.stderr + reported.stdout); step = reported.value;
      }
    }
    assert(killed); assert.notEqual(step?.type, 'phase_execute_request', 'must reach a real terminal result');
    const events = rows(path.join(runDir, 'events.jsonl')); const native = rows(path.join(root, 'observations/native-gates.jsonl'));
    assert.equal(events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'coding').length, 1, 'accepted author must never execute again after the gate interruption');
    assert.equal(events.filter(event => event.type === 'agent_invoke_end' && event.phase === 'coding' && event.handoff_report).length, 1);
    assert.equal(events.filter(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'PASS').length, 1);
    assert(native.filter(event => event.kind === 'enter').length >= 2, 'recovery must reach the real compiler again');
    assert(native.every(event => !event.live_prior_pids?.length), JSON.stringify(native));
    const controlLog = fs.readFileSync(path.join(runDir, 'session-control.log'), 'utf8');
    assert.equal((controlLog.match(/^GOAL_RUN event=feature_completion_generated /gm) ?? []).length, 1, 'the real finalizer must generate exactly one completion original');
    assert.equal(events.filter(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED').length, 1);
    assert.equal(events.filter(event => event.type === 'harness_start' && event.process_role === 'harness' && event.phase === 'coding').length, 2);
    assert.equal(events.filter(event => event.type === 'harness_end' && event.phase === 'coding').length, 1);
    assert(!events.some(event => event.type === 'agent_process_settled'), 'session recovery cannot manufacture an agent process settlement');
    assert(fs.existsSync(path.join(runDir, 'feature-completion.json')));
    assert.equal(rows(path.join(root, 'observations/author-calls.jsonl')).length, 3);
    assert.equal(readJson(path.join(root, 'doc/features/clamp/ut/reports/summary.json')).verdict, 'PASS');
    const report = { status: 'PASS', root, final: step, native_gate_observations: native, external_kill: readJson(path.join(root, 'observations/external-kill.json')),
      event_counts: { coding_author: 1, accepted_coding_report: 1, coding_pass: 1, feature_completion: 1 },
      boundary: 'Author and verifier text are deterministic model substitutes. Original goal-mode-entry, harness CLI, tsc, node:test, report writers, gate process containment and finalizer run unchanged from the materialized production copy. No device.' };
    write(SOURCE_ROOT, 'harness/reports/1804ac3b/session-slow-gate-result.json', JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    write(SOURCE_ROOT, 'harness/reports/1804ac3b/session-slow-gate-result.json', JSON.stringify({ status: 'FAIL', root, error: (error as Error).stack }, null, 2) + '\n');
    throw new Error(`${(error as Error).stack}\nIsolated acceptance root: ${root}`);
  } finally {
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const name = '1804 original CLI slow gate survives external reporter kill without overlapping gates, author replay or duplicate final completion';
  try { await execute(); return [{ name, ok: true }]; } catch (error) { return [{ name, ok: false, error: (error as Error).stack }]; }
}
