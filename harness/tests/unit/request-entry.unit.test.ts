import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { spawnSync, execFileSync } from 'child_process';
import { prepareExplicitRequest, type PreparedRequest } from '../../scripts/utils/capability-resolution-entry-input';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';
import { fixture as blueprintFixture } from './blueprint-skill-projection.unit.test';
import { materializeBlueprintSkillInputs } from '../../scripts/utils/blueprint-skill-projection';
import { resolveRequestInputs } from '../../scripts/utils/capability-resolution';

const repo = path.resolve(__dirname, '../../..');
export function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (dir: string): void => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); result[path.relative(root, file)] = item.isDirectory() ? 'directory' : fs.readFileSync(file).toString('base64'); if (item.isDirectory()) visit(file); } };
  visit(root); return result;
}
export function fixture(phase = 'review') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-request-'));
  const framework = path.join(root, 'framework'); fs.mkdirSync(framework);
  for (const folder of ['harness', 'skills', 'specs', 'docs', 'agents']) fs.symlinkSync(path.join(repo, folder), path.join(framework, folder), process.platform === 'win32' ? 'junction' : 'dir');
  fs.cpSync(path.join(repo, 'workflows'), path.join(framework, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(framework, 'profiles/request-test/harness/providers'), { recursive: true });
  fs.writeFileSync(path.join(framework, 'profiles/request-test/profile.yaml'), YAML.stringify({ name: 'request-test', phases_disabled: [], capabilities: { 'ut.run': { provider: 'native-request', severity: 'BLOCKER' }, 'device_test.run': { provider: 'native-request', severity: 'BLOCKER' } }, personal_prerequisites: {} }));
  fs.writeFileSync(path.join(framework, 'profiles/request-test/harness/providers/native-request.js'), `
const fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('assert');
exports.provider = { id: 'native-request', capability: ${JSON.stringify(phase === 'testing' ? 'device_test.run' : 'ut.run')}, exports: ['runRequestTests'] };
exports.runRequestTests = ctx => {
  assert.equal(ctx.subject, 'request'); assert(!('feature' in ctx)); assert(!('featureSpec' in ctx));
  assert(!Object.keys(process.env).some(k => /^MAISON_(GOAL_|FEATURE)/i.test(k)));
  const run = cp.spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...ctx.request.targets.tests.map(f => path.join(ctx.projectRoot, f))], { cwd: ctx.projectRoot, encoding: 'utf8' });
  const output = run.stdout + run.stderr; fs.writeFileSync(path.join(ctx.reportDir, 'native-test.log'), output);
  const count = /# tests (\\d+)/.exec(output), failures = /# fail (\\d+)/.exec(output);
  return { executed: run.status !== null, total: count ? Number(count[1]) : 0, failed: failures ? Number(failures[1]) : 1, checks: [], evidence_paths: ['native-test.log'] };
};`);
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'request fixture', project_profile: { name: 'request-test' }, paths: { features_dir: 'doc/features' } }));
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/value.js'), 'exports.value = 42;\n');
  fs.mkdirSync(path.join(root, 'tests')); fs.writeFileSync(path.join(root, 'tests/value.test.cjs'), "const test=require('node:test'),assert=require('node:assert/strict');test('value',()=>assert.equal(require('../src/value.js').value,42));\n");
  fs.mkdirSync(path.join(root, 'doc/features/live/context'), { recursive: true });
  fs.writeFileSync(path.join(root, 'doc/features/live/context/facts.md'), 'active Feature evidence\n');
  fs.writeFileSync(path.join(root, '.current-phase.json'), '{"feature":"live","phase":"coding"}');
  fs.mkdirSync(path.join(root, 'doc/requests'), { recursive: true });
  const request = { schema_version: '1.0', phase, requested_result: 'check selected value behavior', targets: { files: ['src/value.js'], tests: phase === 'ut' ? ['tests/value.test.cjs'] : [] }, baseline: { head: 'WORKTREE' }, inputs: {}, allowed_test_writes: [] };
  fs.writeFileSync(path.join(root, 'doc/requests/task.json'), JSON.stringify(request));
  const options = { projectRoot: root, frameworkRoot: framework, phase, requestFile: 'doc/requests/task.json', reportDir: 'doc/reports/task' };
  return { root, framework, request, options };
}
function cli(f: ReturnType<typeof fixture>, extra: string[] = []) {
  return spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/harness-runner.ts'), '--project-root', f.root, '--framework-root', f.framework, '--phase', f.options.phase, '--request-file', f.options.requestFile, '--report-dir', f.options.reportDir, ...extra], { cwd: path.join(f.framework, 'harness'), encoding: 'utf8', timeout: 60000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: 'ambient-run', MAISON_GOAL_RUNNER: '1', MAISON_GOAL_ATTEMPT: 'ambient-attempt', MAISON_FEATURE: 'live' } });
}
/** 写好目标 / 授权集合后跑一次真实请求，返回脚本报告与 `request_expectation_source` 结论（R2）。 */
function runUt(f: ReturnType<typeof fixture>, tests: string[], allowed: string[] = []) {
  const raw = { ...f.request, targets: { files: ['src/value.js'], tests }, allowed_test_writes: allowed };
  fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify(raw));
  const prepared = prepareExplicitRequest(f.options); facts(prepared, f.root);
  const run = cli(f);
  const report = JSON.parse(fs.readFileSync(path.join(prepared.reportDir, 'script-report.json'), 'utf8')) as {
    checks: Array<{ id: string; status: string; details: string; suggestion?: string; structured?: { expectation_classes?: Array<{ file: string; it: string; class: string; ref?: string; ref_kind?: string; ref_sha256?: string; scope: string }> } }>;
    summary: { verdict: string };
  };
  const expectation = report.checks.find(check => check.id === 'request_expectation_source')!;
  assert(expectation, 'UT 专项请求必须产出 request_expectation_source：' + JSON.stringify(report.checks.map(check => check.id)));
  return { status: run.status, report, expectation, verdict: report.summary.verdict };
}

/** `--prepare-request` 的 stdout 是纯 JSON：准备期产物（含 gaps）只由它呈现，不写盘。 */
function preparedJson(f: ReturnType<typeof fixture>): PreparedRequest & { gaps: string[] } {
  const run = cli(f, ['--prepare-request']);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  return JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))) as PreparedRequest & { gaps: string[] };
}
export function facts(p: PreparedRequest, root: string) {
  fs.mkdirSync(path.dirname(p.factsPath), { recursive: true });
  const files = [...new Set([...p.bindings.filter(binding => binding.exists).map(binding => binding.path), ...Object.entries(p.inputs).filter(([id, file]) => id !== 'review_report' && fs.existsSync(file)).map(([, file]) => path.relative(root, file).replace(/\\/g, '/'))])];
  fs.writeFileSync(p.factsPath, '---\n' + YAML.stringify({ schema_version: '1.1', request_sha256: p.request_sha256, established_by: p.phase, ready_to_produce: true, has_blocker_coverage_risk: false, source_code_paths: files, key_inputs_read: files, files_inspected_count: files.length, searches_performed_estimate: Math.max(1, files.length), decisions_unlocked: ['checked selected behavior'], exploration_mode: 'sequential', change_intent: 'read_only', estimated_loc_delta: 0, single_function_scope: true }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n' + files.map(file => `| ${file} | bound request input was read | inspect requested behavior |`).join('\n'));
}
function review(p: PreparedRequest, verdict = '通过') {
  fs.writeFileSync(p.inputs.review_report, `# Review\n## 审查范围\nsrc/value.js\n## 审查方法\nRead source and compare selected baseline.\n## 问题清单\n无问题\n## 问题统计\n| 严重程度 | 数量 |\n|---|---|\n| BLOCKER | 0 |\n| MAJOR | 0 |\n| MINOR | 0 |\n| INFO | 0 |\n## 修复建议\n无\n## 结论\n**审查结论**: ${verdict}\n`);
}
const cases: Array<{ name: string; phase?: string; run(f: ReturnType<typeof fixture>): void }> = [
  { name: 'custom Feature reports and receipts are protected before creation while sibling requests run', run(f) {
    const configFile = path.join(f.root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.paths.reports_dir_pattern = 'doc/reports/<feature>/<phase>';
    config.paths.receipt_dir_pattern = 'doc/receipts/<feature>/<phase>';
    fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    for (const reportDir of ['doc/reports/live/review', 'doc/receipts/live/review', 'doc/features/live/goal-runs/request']) {
      f.options.reportDir = reportDir;
      const result = cli(f);
      assert.notEqual(result.status, 0); assert.match(result.stderr + result.stdout, /protected/);
      assert(!fs.existsSync(path.join(f.root, reportDir)));
    }
    f.options.reportDir = 'doc/reports/independent/review';
    const prepared = cli(f, ['--prepare-request']); assert.equal(prepared.status, 0, prepared.stderr + prepared.stdout);
    const p = JSON.parse(prepared.stdout); facts(p, f.root); review(p);
    const result = cli(f); assert.equal(result.status, 0, result.stderr + result.stdout);
  } },
  { name: 'testing reconciliation flag fails before provider execution and ordinary testing still executes', phase: 'testing', run(f) {
    fs.writeFileSync(path.join(f.root, 'doc/requests/cases.txt'), 'open value -> check value equals 42');
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, targets: { ...f.request.targets, tests: ['tests/value.test.cjs'] }, inputs: { cases: 'doc/requests/cases.txt' } }));
    const p = prepareExplicitRequest(f.options); facts(p, f.root);
    const before = tree(p.reportDir);
    const rejected = cli(f, ['--report-reconcile-only']);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr + rejected.stdout, /cannot be combined with --report-reconcile-only/);
    assert.deepStrictEqual(tree(p.reportDir), before);
    const result = cli(f); assert.equal(result.status, 0, result.stderr + result.stdout + fs.readFileSync(path.join(p.reportDir, 'script-report.json'), 'utf8'));
    assert.match(fs.readFileSync(path.join(p.reportDir, 'native-test.log'), 'utf8'), /# pass 1/);
  } },
  { name: 'historical review prepares and checks deleted worktree sources against the selected commit', run(f) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-q']); git(['add', 'src/value.js']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'source']);
    const head = git(['rev-parse', 'HEAD']);
    fs.unlinkSync(path.join(f.root, 'src/value.js'));
    assert.throws(() => prepareExplicitRequest(f.options), /target missing/);
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, baseline: { head } }));
    const prepared = cli(f, ['--prepare-request']); assert.equal(prepared.status, 0, prepared.stderr + prepared.stdout);
    const p = JSON.parse(prepared.stdout); facts(p, f.root); review(p);
    const result = cli(f); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.reportDir, 'summary.json'), 'utf8')).verdict, 'PASS');
    assert(!fs.existsSync(path.join(f.root, 'src/value.js')));
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, phase: 'ut', baseline: { head } }));
    assert.throws(() => prepareExplicitRequest({ ...f.options, phase: 'ut', reportDir: 'doc/reports/ut-history' }), /target missing/);
    git(['add', '-u']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'delete source']);
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, baseline: { head: 'HEAD' } }));
    f.options.reportDir = 'doc/reports/missing-history';
    assert.notEqual(cli(f, ['--prepare-request']).status, 0);
  } },
  { name: 'explicit blueprint-backed input validates its real source without becoming the request subject', run() {
    const b = blueprintFixture();
    try {
      const written = materializeBlueprintSkillInputs(b.root, b.feature, repo);
      fs.mkdirSync(path.join(b.root, 'src'), { recursive: true }); fs.writeFileSync(path.join(b.root, 'src/value.js'), 'exports.value=42;');
      const requestFile = path.join(b.root, 'request.json');
      fs.writeFileSync(requestFile, JSON.stringify({ schema_version: '1.0', phase: 'review', requested_result: 'review with approved acceptance', targets: { files: ['src/value.js'], tests: [] }, inputs: { acceptance: path.relative(b.root, written.find(file => path.basename(file) === 'acceptance.yaml')!) }, allowed_test_writes: [] }));
      const p = prepareExplicitRequest({ projectRoot: b.root, frameworkRoot: repo, phase: 'review', requestFile: 'request.json', reportDir: 'doc/reports/explicit-source' });
      const before = tree(path.join(b.root, 'doc/features'));
      const inputs = resolveRequestInputs(b.root, repo, p);
      assert('request_sha256' in inputs.context.subject); assert.equal(inputs.values.acceptance.state, 'resolved');
      assert.deepStrictEqual(tree(path.join(b.root, 'doc/features')), before);
    } finally { fs.rmSync(b.root, { recursive: true, force: true }); }
  } },
  { name: 'real prepare/run review ignores ambient Goal and preserves active Feature bytes', run(f) {
    fs.writeFileSync(path.join(f.root, 'src/outside-request.js'), 'exports.other = 1;');
    const before = tree(path.join(f.root, 'doc/features'));
    const prepared = cli(f, ['--prepare-request']); assert.equal(prepared.status, 0, prepared.stderr + prepared.stdout);
    const p = JSON.parse(prepared.stdout) as PreparedRequest; assert(p.request_sha256); assert(!fs.existsSync(p.reportDir));
    assert.deepStrictEqual(p.targets.files, ['src/value.js']); assert(!p.bindings.some(binding => binding.path === 'src/outside-request.js'));
    facts(p, f.root); review(p); const result = cli(f); assert.equal(result.status, 0, result.stderr + result.stdout);
    const summary = JSON.parse(fs.readFileSync(path.join(p.reportDir, 'summary.json'), 'utf8'));
    assert.equal(summary.subject, 'request'); assert.equal(summary.completion_target, 'request'); assert(!('feature' in summary)); assert(!('closed' in summary));
    assert.equal(summary.verdict, 'PASS'); assert.deepStrictEqual(tree(path.join(f.root, 'doc/features')), before);
    assert.equal(fs.readFileSync(path.join(f.root, '.current-phase.json'), 'utf8'), '{"feature":"live","phase":"coding"}');
    assert.deepStrictEqual(fs.readdirSync(path.join(f.root, 'doc/features')), ['live']);
  } },
  { name: 'real UT provider executes selected Node tests through the same checker', phase: 'ut', run(f) {
    const before = tree(path.join(f.root, 'doc/features'));
    const p = prepareExplicitRequest(f.options); facts(p, f.root); const result = cli(f); assert.equal(result.status, 0, result.stderr + result.stdout + (fs.existsSync(path.join(p.reportDir, 'native-test.log')) ? fs.readFileSync(path.join(p.reportDir, 'native-test.log'), 'utf8') : ''));
    assert(fs.readFileSync(path.join(p.reportDir, 'native-test.log'), 'utf8').includes('# pass 1'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.reportDir, 'summary.json'), 'utf8')).verdict, 'PASS');
    assert(!fs.existsSync(path.join(f.root, 'doc/features/live/ut')));
    assert.deepStrictEqual(tree(path.join(f.root, 'doc/features')), before);
  } },
  { name: 'real failed tests and missing request provider cannot claim execution success', phase: 'ut', run(f) {
    fs.writeFileSync(path.join(f.root, 'tests/value.test.cjs'), "const test=require('node:test'),assert=require('node:assert/strict');test('fails',()=>assert.equal(1,2));\n");
    const p = prepareExplicitRequest(f.options); facts(p, f.root); assert.notEqual(cli(f).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.reportDir, 'summary.json'), 'utf8')).verdict, 'FAIL');
    fs.writeFileSync(path.join(f.framework, 'profiles/request-test/harness/providers/native-request.js'), "exports.provider={id:'native-request',capability:'ut.run',exports:[]};");
    assert.notEqual(cli(f).status, 0);
    assert(fs.readFileSync(path.join(p.reportDir, 'script-report.json'), 'utf8').includes('request_provider_unavailable'));
  } },
  { name: 'provider-time source changes are rejected rather than rebound after a passing execution', phase: 'ut', run(f) {
    const file = path.join(f.framework, 'profiles/request-test/harness/providers/native-request.js');
    fs.appendFileSync(file, "\nconst execute=exports.runRequestTests;exports.runRequestTests=ctx=>{const result=execute(ctx);fs.appendFileSync(path.join(ctx.projectRoot,'src/value.js'),'// changed after tests\\n');return result;};\n");
    const p = prepareExplicitRequest(f.options); facts(p, f.root); assert.notEqual(cli(f).status, 0);
    const report = JSON.parse(fs.readFileSync(path.join(p.reportDir, 'script-report.json'), 'utf8'));
    assert.equal(report.summary.verdict, 'FAIL'); assert(report.checks.some((check: { id: string }) => check.id === 'request_execution_inputs_changed'));
  } },
  { name: 'testing uses P1 cases and cannot turn an unexecuted provider result into PASS', phase: 'testing', run(f) {
    fs.writeFileSync(path.join(f.root, 'doc/requests/cases.txt'), 'open home -> tap login');
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, inputs: { cases: 'doc/requests/cases.txt' } }));
    fs.writeFileSync(path.join(f.framework, 'profiles/request-test/harness/providers/native-request.js'), "exports.provider={id:'native-request',capability:'device_test.run',exports:['runRequestTests']};exports.runRequestTests=ctx=>{if(ctx.resolvedInputs.values.cases.state!=='resolved')throw Error('missing P1 cases');return {executed:false,total:0,failed:0,checks:[],evidence_paths:[]}};");
    const p = prepareExplicitRequest(f.options); facts(p, f.root); assert.notEqual(cli(f).status, 0);
    const report = JSON.parse(fs.readFileSync(path.join(p.reportDir, 'script-report.json'), 'utf8'));
    assert(report.checks.some((check: { id: string }) => check.id === 'request_test_not_executed'));
  } },
  { name: 'real-path aliases cannot point reports into Feature state or let outputs escape', run(f) {
    const outside = path.join(f.root, 'doc/provider-history'); fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(f.root, 'doc/features/live/linked-reports'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => prepareExplicitRequest({ ...f.options, reportDir: 'doc/provider-history' }), /protected/);
    const reportDir = path.join(f.root, f.options.reportDir); fs.mkdirSync(reportDir, { recursive: true });
    fs.symlinkSync(path.join(f.root, 'src'), path.join(reportDir, 'native'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => prepareExplicitRequest(f.options), /escaping link/);
  } },
  { name: 'negative review and stale facts never succeed', run(f) {
    const p = prepareExplicitRequest(f.options); facts(p, f.root); review(p, '不通过'); assert.notEqual(cli(f).status, 0);
    fs.appendFileSync(path.join(f.root, 'src/value.js'), '// changed\n');
    assert.throws(() => prepareExplicitRequest(f.options), /another request/);
    f.options.reportDir = 'doc/reports/changed'; const changed = prepareExplicitRequest(f.options);
    fs.mkdirSync(path.dirname(changed.factsPath), { recursive: true }); fs.copyFileSync(p.factsPath, changed.factsPath); review(changed);
    assert.notEqual(cli(f).status, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(changed.reportDir, 'summary.json'), 'utf8')).verdict, 'FAIL');
  } },
  { name: 'Git refs resolve to immutable commits and WORKTREE changes alter request identity', run(f) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-q']); git(['add', 'src/value.js', 'tests/value.test.cjs']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base']);
    const raw = { ...f.request, baseline: { base: 'HEAD', head: 'WORKTREE' } }; fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify(raw));
    const p = prepareExplicitRequest(f.options); assert.equal(p.baseline.base, git(['rev-parse', 'HEAD']));
    fs.appendFileSync(path.join(f.root, 'src/value.js'), '// changed\n'); assert.notEqual(prepareExplicitRequest(f.options).request_sha256, p.request_sha256);
  } },
  { name: 'protected report paths, identity mixing and command injection fail before writes', run(f) {
    for (const reportDir of ['framework/reports', '.git/report', 'doc/features/live/reports', 'src', '../outside']) assert.throws(() => prepareExplicitRequest({ ...f.options, reportDir }));
    assert.notEqual(cli(f, ['--feature', 'live', '--prepare-request']).status, 0);
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, command: 'echo forged' }));
    assert.throws(() => prepareExplicitRequest(f.options), /unknown field/); assert(!fs.existsSync(path.join(f.root, 'doc/reports')));
  } },
  { name: 'active workflow checker selection is honored and wrong phase metadata is rejected', run(f) {
    const workflow = YAML.parse(fs.readFileSync(path.join(f.framework, 'workflows/spec-driven.workflow.yaml'), 'utf8'));
    workflow.name = 'wrong-route'; workflow.artifacts.find((artifact: { id: string }) => artifact.id === 'review').check = 'check-ut.ts';
    fs.writeFileSync(path.join(f.framework, 'workflows/wrong-route.workflow.yaml'), YAML.stringify(workflow));
    const p = prepareExplicitRequest(f.options); facts(p, f.root); review(p);
    assert.notEqual(cli(f, ['--workflow', 'wrong-route']).status, 0);
    assert(fs.readFileSync(path.join(p.reportDir, 'script-report.json'), 'utf8').includes('request_checker_unsupported'));
  } },
  { name: 'authorized missing test is an explicit gap and can be authored without changing the request boundary', phase: 'ut', run(f) {
    const raw = { ...f.request, targets: { files: ['src/value.js'], tests: ['tests/new.test.cjs'] }, allowed_test_writes: ['tests/new.test.cjs'] };
    fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify(raw)); const p = prepareExplicitRequest(f.options); assert(p.gaps.includes('tests/new.test.cjs'));
    fs.copyFileSync(path.join(f.root, 'tests/value.test.cjs'), path.join(f.root, 'tests/new.test.cjs')); assert.equal(prepareExplicitRequest(f.options).request_sha256, p.request_sha256);
  } },
  // ==========================================================================
  // 预期来源登记（plan a9f3c7d2 第二笔 · R2）
  // 事故形态：characterization 断言被呈现成与「正确性通过」无差别的 PASS。
  // 机器只证明**登记有效**；语义（现状记载 vs 授权要求）由 business-ut 的四步核对承担。
  // ==========================================================================
  { name: 'ut request separates sourced assertions from characterization ones', phase: 'ut', run(f) {
    fs.writeFileSync(path.join(f.root, 'doc/basis.md'), '# 授权预期\n短输入必须整串遮蔽。\n');
    fs.writeFileSync(path.join(f.root, 'tests/mixed.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '// expectation: doc/basis.md',
      "test('[BD-1] sourced by path', () => assert.equal(1, 1));",
      "test('[AC-2] sourced by tag only', () => assert.equal(1, 1));",
      '// characterization',
      "test('records current shape', () => assert.equal(1, 1));",
      "test('[CHAR-short] records current shape by tag', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/mixed.test.cjs'], ['tests/mixed.test.cjs']);
    assert.equal(run.expectation.status, 'PASS', run.expectation.details);
    // 三栏分列；来源形态两分（路径已核 / 仅标签）可辨。
    assert(run.expectation.details.includes('已登记来源 2 条（路径已核 1、仅标签 1）'), run.expectation.details);
    assert(run.expectation.details.includes('现状记录 2 条'), run.expectation.details);
    assert(run.expectation.details.includes('历史未登记 0 条'), run.expectation.details);
    // **不得按类写「通过 M 条」**——provider 只给聚合结果，没有逐用例归属。
    assert(!/通过 \d+ 条/.test(run.expectation.details), run.expectation.details);
    const rows = run.expectation.structured!.expectation_classes!;
    assert.equal(rows.filter(row => row.class === 'sourced' && row.ref_sha256).length, 1, JSON.stringify(rows));
    assert.equal(rows.filter(row => row.class === 'characterization').length, 2, JSON.stringify(rows));
    // 两种来源形态各断言到 `ref_kind`：路径来源核过文件并记指纹，标签来源只记标签本身。
    const byPath = rows.find(row => row.ref_kind === 'path');
    assert(byPath?.ref === 'doc/basis.md' && byPath.ref_sha256, JSON.stringify(rows));
    const byTag = rows.find(row => row.ref_kind === 'tag');
    assert(byTag?.ref?.startsWith('[AC-') && !byTag.ref_sha256, JSON.stringify(rows));
  } },
  { name: 'a fully characterization request passes and is reported as recorded behavior', phase: 'ut', run(f) {
    // 复现宿主补齐逐条标注后的请求：全部标 characterization → 合法交付，不判 FAIL。
    fs.writeFileSync(path.join(f.root, 'tests/mask.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "test('[CHAR-maskPhone_8digits] records current shape', () => assert.equal(1, 1));",
      '// characterization',
      "test('maskPhone_7digits returned unmasked', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/mask.test.cjs'], ['tests/mask.test.cjs']);
    assert.equal(run.expectation.status, 'PASS', run.expectation.details);
    assert.equal(run.verdict, 'PASS', JSON.stringify(run.report.summary));
    assert(run.expectation.details.includes('现状记录 2 条'), run.expectation.details);
    assert(!run.expectation.details.includes('正确性通过'), '现状记录不得被呈现成正确性通过');
  } },
  { name: 'ut request flags an authorized assertion with neither a source nor a characterization mark', phase: 'ut', run(f) {
    // 宿主那份测试的真实形态：只有**文件头**注释，逐条断言上什么都没有。
    fs.writeFileSync(path.join(f.root, 'tests/unmarked.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '// 固化当前实现行为（先不改实现）。短输入用例记录的是现状。',
      "test('maskPhone_8digits only hides one digit', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/unmarked.test.cjs'], ['tests/unmarked.test.cjs']);
    assert.equal(run.expectation.status, 'FAIL', run.expectation.details);
    assert.equal(run.verdict, 'FAIL', '未登记的新增断言必须压住 verdict');
    assert(run.expectation.details.includes('既无预期来源、也未标注 characterization'), run.expectation.details);
    // 补齐方法逐字进 suggestion——宿主 agent 拿到的就是这几句。
    for (const hint of ['文件头或 describe 上的标注不算登记', '在每条用例名前加 [CHAR-…]，或在紧邻该行上方加 // characterization', '保留原测试与期望值，不要为过检查改断言']) {
      assert(run.expectation.suggestion?.includes(hint), hint + ' 缺失：' + run.expectation.suggestion);
    }
  } },
  { name: 'only per-assertion annotations count as registration', phase: 'ut', run(f) {
    // describe / 文件头标注一律不继承；回调体里的 `{`、模板字面量、`// {` 不影响分类（不做括号配平）；
    // 注释里的 `it(` 不算声明行。
    fs.writeFileSync(path.join(f.root, 'tests/scope.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '// characterization',
      "const suite = 'outer';",
      "test('inherits nothing from the file header', () => { const brace = '{'; const tpl = `x{y`; assert.ok(brace && tpl && suite); });",
      '// characterization',
      "test('[CHAR-own] carries its own mark', () => { // {",
      '  assert.ok(true);',
      '});',
      "// it('commented out declaration does not count', () => {});",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/scope.test.cjs'], ['tests/scope.test.cjs']);
    assert.equal(run.expectation.status, 'FAIL', run.expectation.details);
    const rows = run.expectation.structured!.expectation_classes!;
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.equal(rows.filter(row => row.class === 'unregistered').length, 1, '文件头标注被继承了：' + JSON.stringify(rows));
    assert.equal(rows.filter(row => row.class === 'characterization').length, 1, JSON.stringify(rows));
    assert(!rows.some(row => /commented out/.test(row.it)), '注释里的声明被当成断言：' + JSON.stringify(rows));
  } },
  { name: 'declaration count must match the executor extractor', phase: 'ut', run(f) {
    // 第一道对账：同一行写两条 it( → 行扫描只认 1 条，执行器同源提取器数 2 条。
    fs.writeFileSync(path.join(f.root, 'tests/sameline.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "it('[CHAR-a] first', 0, () => {}); it('second', 0, () => {});",
      '',
    ].join('\n'));
    const first = runUt(f, ['tests/sameline.test.cjs'], ['tests/sameline.test.cjs']);
    assert.equal(first.expectation.status, 'FAIL', first.expectation.details);
    assert(first.expectation.details.includes('声明条数对账不等'), first.expectation.details);
    assert(first.expectation.details.includes('分类器识别 1 条 it(，执行器同源提取器 2 条'), first.expectation.details);
    assert(first.expectation.suggestion?.includes('每条断言单独成行'), first.expectation.suggestion);
    // 第二道对账：普通声明与 skip 变体**分行**混排——两侧都数 1，第一道相等；靠 provider total 抓。
    fs.writeFileSync(path.join(f.root, 'tests/skipmix.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "test('[CHAR-a] runs', () => assert.equal(1, 1));",
      "test.skip('skipped variant escapes the line scan', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    f.options.reportDir = 'doc/reports/skipmix';
    const second = runUt(f, ['tests/skipmix.test.cjs'], ['tests/skipmix.test.cjs']);
    assert.equal(second.expectation.status, 'FAIL', second.expectation.details);
    assert(second.expectation.details.includes('识别总数 1 与 provider 实际执行 total=2 不等'), second.expectation.details);
    assert(second.expectation.suggestion?.includes('每条断言单独成行'), '第二道对账也须给出版式补齐方法：' + second.expectation.suggestion);
    assert.equal(second.verdict, 'FAIL', '第二道对账不等必须压住 verdict');
  } },
  { name: 'a block comment neither annotates nor hides a real declaration', phase: 'ut', run(f) {
    // 第二笔代码 review 必改 2 的反例：块注释里的假声明（+1）与真实多行声明被漏认（-1）如果互相抵消，
    // 两道对账都会相等，未登记的真实测试就被呈现成「现状记录」。这里两件事同时发生：
    //   · 块注释里的 `// characterization` **不得**标注紧随其后的真实声明（否则未登记被洗成现状记录）；
    //   · 名字不在同一行的真实声明**不得静默丢弃**，要记成「无法分类」并让第一道对账不等。
    fs.writeFileSync(path.join(f.root, 'tests/blockcomment.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '/* 这一段整体是块注释，里面的一切都不算声明、也不算标注：',
      "it('fake declaration inside a block comment', () => { assert.ok(true); });",
      '// characterization */',
      "it('real assertion right below the block comment', () => { assert.equal(1, 1); });",
      'it(',
      "  'name on the next line',",
      '  () => { assert.equal(1, 1); }',
      ');',
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/blockcomment.test.cjs'], ['tests/blockcomment.test.cjs']);
    assert.equal(run.expectation.status, 'FAIL', run.expectation.details);
    const rows = run.expectation.structured!.expectation_classes!;
    assert(!rows.some(row => row.it.includes('fake declaration inside a block comment')), '块注释里的声明被当成断言：' + JSON.stringify(rows));
    const real = rows.find(row => row.it === 'real assertion right below the block comment');
    assert.equal(real?.class, 'unregistered', '块注释里的 characterization 标注了它下面的真实声明：' + JSON.stringify(rows));
    assert.equal(rows.filter(row => row.class === 'unclassifiable').length, 1, '名字不在同一行的真实声明被静默丢弃：' + JSON.stringify(rows));
    assert(run.expectation.details.includes('现状记录 0 条'), '未登记被洗成现状记录：' + run.expectation.details);
    // 抵消不成立的凭据：分类器 2 条（真实 1 + 无法分类 1）对执行器同源提取器 3 条（多数了块注释那条）。
    assert(run.expectation.details.includes('分类器识别 2 条 it(，执行器同源提取器 3 条'), run.expectation.details);
    assert(run.expectation.details.split('\n').some(line => line.startsWith('BLOCKER: ') && line.includes('无法分类')), run.expectation.details);
  } },
  { name: 'an ambiguous comment boundary on a declaration line is not silently classified', phase: 'ut', run(f) {
    // 第二轮必改 C：`/* 关了 */ /*` 同行先关后开 + `*/ test(...)` 同行收尾，正好制造
    // 「多认一条假的（注释里那条被当真）+ 漏认一条真的（行首规则认不出 `*/ test(`）」的抵消，
    // 两道计数对账都相等。确定性兜底：**注释边界可疑且这行还带声明**时不尝试解析，走 unclassifiable。
    fs.writeFileSync(path.join(f.root, 'tests/ambiguous.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '/* 先关 */ /*',
      '// characterization',
      "it('fake declaration smuggled through a reopened comment', () => { assert.ok(true); });",
      "*/ test('real assertion hidden behind a same-line comment close', () => { assert.equal(1, 1); });",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/ambiguous.test.cjs'], ['tests/ambiguous.test.cjs']);
    assert.equal(run.expectation.status, 'FAIL', run.expectation.details);
    const rows = run.expectation.structured!.expectation_classes!;
    const ambiguous = rows.filter(row => row.class === 'unclassifiable' && row.it.includes('注释边界可疑'));
    assert.equal(ambiguous.length, 1, '同行关注释后的真实声明被静默吞掉：' + JSON.stringify(rows));
    assert(run.expectation.details.split('\n').some(line => line.startsWith('BLOCKER: ') && line.includes('注释边界可疑')),
      '可疑行必须以 BLOCKER 出现（只判 FAIL 会被别的判据掩盖）：' + run.expectation.details);
    assert(run.expectation.details.includes('现状记录 0 条'), '注释里的假声明被洗成现状记录：' + run.expectation.details);
    // 抵消不成立的凭据：第一道对账也不等（分类器 0 条 it(，执行器同源提取器仍数到注释里那条）。
    assert(run.expectation.details.includes('声明条数对账不等'), run.expectation.details);
    // 正例（第三轮必改的回归面）：**回调体里**的普通块注释不算可疑——声明独占一行、名字是字面量、
    // 自带 `[CHAR-…]` 标签，必须照常判成现状记录并通过。判据一旦放宽到整行，这条立刻变 BLOCKER。
    fs.writeFileSync(path.join(f.root, 'tests/inlinecomment.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "test('[CHAR-value] records current value', () => { /* 保留现有默认值 */ assert.equal(require('../src/value.js').value, 42); });",
      '',
    ].join('\n'));
    f.options.reportDir = 'doc/reports/inlinecomment';
    const inline = runUt(f, ['tests/inlinecomment.test.cjs'], ['tests/inlinecomment.test.cjs']);
    assert.equal(inline.expectation.status, 'PASS', '回调体里的块注释把正常测试判成了无法分类：' + inline.expectation.details);
    assert.equal(inline.expectation.structured!.expectation_classes![0].class, 'characterization', JSON.stringify(inline.expectation.structured));
    assert.equal(inline.verdict, 'PASS', JSON.stringify(inline.report.summary));
  } },
  { name: 'a dead source reference is blocking only in the file this request authorized', phase: 'ut', run(f) {
    // 必改 3：`// expectation:` 指向的文件不存在——**同一份内容**在两种身份下结论不同。
    // 授权写入＝本次请求的责任，BLOCKER；只读历史目标引用的文档可能早已删除，只 WARN。
    const body = [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '// expectation: doc/已删除的依据.md',
      "test('cites a source document that no longer exists', () => assert.equal(1, 1));",
      '',
    ].join('\n');
    fs.writeFileSync(path.join(f.root, 'tests/deadref-owned.test.cjs'), body);
    fs.writeFileSync(path.join(f.root, 'tests/deadref-legacy.test.cjs'), body);
    const owned = runUt(f, ['tests/deadref-owned.test.cjs'], ['tests/deadref-owned.test.cjs']);
    assert.equal(owned.expectation.status, 'FAIL', owned.expectation.details);
    assert(owned.expectation.details.split('\n').some(line => line.startsWith('BLOCKER: ') && line.includes('登记的来源不可核验')), owned.expectation.details);
    assert.equal(owned.expectation.structured!.expectation_classes![0].class, 'unregistered', '死引用仍被记成已登记来源');
    assert.equal(owned.verdict, 'FAIL', JSON.stringify(owned.report.summary));
    f.options.reportDir = 'doc/reports/deadref-legacy';
    const legacy = runUt(f, ['tests/deadref-legacy.test.cjs'], []);
    assert.equal(legacy.expectation.status, 'WARN', legacy.expectation.details);
    assert(legacy.expectation.details.split('\n').some(line => line.startsWith('WARN: ') && line.includes('登记的来源不可核验')), legacy.expectation.details);
    assert(legacy.expectation.details.includes('历史未登记 1 条（只读目标，不问责）'), legacy.expectation.details);
    assert.equal(legacy.verdict, 'PASS', '只读历史目标的死引用不得新增阻断：' + JSON.stringify(legacy.report.summary));
  } },
  { name: 'an unparsable target is blocking only when this request authorized it', phase: 'ut', run(f) {
    // 授权面：零解析。**注意重叠**——授权文件零解析时第二道对账（识别 0 ≠ provider total）必然同时触发，
    // 光断言 status=FAIL 会被那条掩盖（变异 P6 就是这么漏过去的）。所以这里**断言到具体那一行的级别**：
    // 零解析必须以 `BLOCKER:` 出现；一旦被降级成 WARN，本断言立刻红。
    fs.writeFileSync(path.join(f.root, 'tests/nodecl.test.cjs'), [
      "const assert=require('node:assert/strict');",
      'assert.ok(true);',
      '',
    ].join('\n'));
    const authorized = runUt(f, ['tests/nodecl.test.cjs'], ['tests/nodecl.test.cjs']);
    assert.equal(authorized.expectation.status, 'FAIL', authorized.expectation.details);
    assert(
      authorized.expectation.details.split('\n').some(line => line.startsWith('BLOCKER: ') && line.includes('解析不到可识别的断言声明')),
      '授权文件零解析必须是 BLOCKER（WARN 压不住 verdict）：' + authorized.expectation.details,
    );
    // 只读面：同样认不出声明（用例被包在 forEach 里），但执行照常 —— 只 WARN，不得新增阻断。
    fs.writeFileSync(path.join(f.root, 'tests/wrapped.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "['wrapped'].forEach((name) => test(name, () => assert.equal(1, 1)));",
      '',
    ].join('\n'));
    f.options.reportDir = 'doc/reports/readonly';
    const readOnly = runUt(f, ['tests/wrapped.test.cjs'], []);
    assert.equal(readOnly.expectation.status, 'WARN', readOnly.expectation.details);
    assert.equal(readOnly.verdict, 'PASS', '只读历史目标不得新增阻断：' + JSON.stringify(readOnly.report.summary));
  } },
  { name: 'a read-only characterization target is presented without new blocking', phase: 'ut', run(f) {
    // 「只跑已有 [CHAR-*] 测试」的请求：现状记录那一栏必须有内容，历史未登记不问责。
    fs.writeFileSync(path.join(f.root, 'tests/legacy.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "test('[CHAR-legacy] existing recorded behavior', () => assert.equal(1, 1));",
      "test('legacy assertion without any mark', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/legacy.test.cjs'], []);
    assert.equal(run.expectation.status, 'PASS', run.expectation.details);
    assert.equal(run.verdict, 'PASS', JSON.stringify(run.report.summary));
    assert(run.expectation.details.includes('现状记录 1 条'), run.expectation.details);
    assert(run.expectation.details.includes('历史未登记 1 条（只读目标，不问责）'), run.expectation.details);
  } },
  { name: 'a failing sourced assertion keeps its failure and produces no passing count', phase: 'ut', run(f) {
    fs.writeFileSync(path.join(f.root, 'doc/basis.md'), '# 授权预期\n值必须等于 42。\n');
    fs.writeFileSync(path.join(f.root, 'tests/failing.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '// expectation: doc/basis.md',
      "test('[AC-1] value must equal 42', () => assert.equal(1, 42));",
      '',
    ].join('\n'));
    const failing = runUt(f, ['tests/failing.test.cjs'], ['tests/failing.test.cjs']);
    // 执行失败照常由 request_test_execution 说；来源检查只报登记数，并追加「不代表通过数」。
    const execution = failing.report.checks.find(check => check.id === 'request_test_execution');
    assert.equal(execution?.status, 'FAIL', JSON.stringify(execution));
    assert.equal(failing.expectation.status, 'PASS', failing.expectation.details);
    assert(failing.expectation.details.includes('本次存在失败用例，登记数不代表通过数（逐用例归属不可得）。'), failing.expectation.details);
    assert(!/通过 \d+ 条/.test(failing.expectation.details), failing.expectation.details);
    // 未执行分支：provider 缺导出 → 来源检查照常产出，并写「本次用例未执行」。
    fs.writeFileSync(path.join(f.framework, 'profiles/request-test/harness/providers/native-request.js'), "exports.provider={id:'native-request',capability:'ut.run',exports:[]};");
    f.options.reportDir = 'doc/reports/not-executed';
    const notRun = runUt(f, ['tests/failing.test.cjs'], ['tests/failing.test.cjs']);
    assert(notRun.expectation.details.includes('本次用例未执行，登记数不代表通过数（逐用例归属不可得）。'), notRun.expectation.details);
  } },
  { name: 'expectation source must resolve to a readable file inside the project', phase: 'ut', run(f) {
    fs.writeFileSync(path.join(f.root, 'tests/badref.test.cjs'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      '// expectation: ../outside/basis.md',
      "test('[AC-9] points outside the project', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    const run = runUt(f, ['tests/badref.test.cjs'], ['tests/badref.test.cjs']);
    assert.equal(run.expectation.status, 'FAIL', run.expectation.details);
    assert(run.expectation.details.includes('登记的来源不可核验'), run.expectation.details);
  } },
  // ==========================================================================
  // 准备期能力缺口（plan a9f3c7d2 第一笔 · R3）
  // 事故形态：落点不兼容与「模块没有测试载体」原先只在**执行期**抛错，agent 写测试时无从得知。
  // ==========================================================================
  { name: 'prepare-request reports capability gaps before any test is written', phase: 'ut', run(f) {
    // 未导出只读探测的 provider（= 现有形态）：准备期不产生 capability gap，现状原样保持。
    const before = preparedJson(f);
    assert(!before.gaps.some(gap => gap.startsWith('capability:')), `未适配探测的 provider 不应产生能力 gap: ${JSON.stringify(before.gaps)}`);
    // 导出探测后：provider 给出的 gap 必须出现在 `--prepare-request` 的输出里（写测试之前就能看到）。
    const providerPath = path.join(f.framework, 'profiles/request-test/harness/providers/native-request.js');
    fs.writeFileSync(providerPath, fs.readFileSync(providerPath, 'utf8')
      .replace("exports: ['runRequestTests']", "exports: ['runRequestTests', 'inspectRequestTargets']")
      + "\nexports.inspectRequestTargets = (projectRoot, tests) => ({ groups: new Map(), gaps: tests.map(file => 'capability:ut.run:' + file + ' 不在任何已配置模块的 src/ohosTest/ 下') });\n");
    const after = preparedJson(f);
    assert(after.gaps.some(gap => gap === 'capability:ut.run:tests/value.test.cjs 不在任何已配置模块的 src/ohosTest/ 下'),
      `探测 gap 未进入 prepare 输出: ${JSON.stringify(after.gaps)}`);
    // 既有的路径类 gap 不受影响（两类共用同一数组，靠 `capability:` 前缀区分）。
    assert(after.gaps.filter(gap => !gap.startsWith('capability:')).length === before.gaps.length, '路径类 gap 被能力 gap 改写');
  } },
  { name: 'disabled phase surfaces at prepare time instead of only at execution', phase: 'ut', run(f) {
    const profilePath = path.join(f.framework, 'profiles/request-test/profile.yaml');
    const profile = YAML.parse(fs.readFileSync(profilePath, 'utf8')) as { phases_disabled: string[] };
    profile.phases_disabled = ['ut'];
    fs.writeFileSync(profilePath, YAML.stringify(profile));
    const prepared = preparedJson(f);
    assert(prepared.gaps.some(gap => gap.startsWith('capability:phase_disabled:ut')),
      `phase 被关闭时准备期应报 gap（此前只在执行期出现）: ${JSON.stringify(prepared.gaps)}`);
  } },
  { name: 'the real generic profile reports ut as not enabled at prepare time', phase: 'ut', run(f) {
    // 用**仓库里真实的** profiles/generic（不是夹具自造的 request-test），否则证不了 generic 的行为。
    fs.cpSync(path.join(repo, 'profiles/generic'), path.join(f.framework, 'profiles/generic'), { recursive: true });
    const configPath = path.join(f.root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { project_profile: { name: string } };
    config.project_profile = { name: 'generic' };
    fs.writeFileSync(configPath, JSON.stringify(config));
    clearFrameworkConfigCache();
    const prepared = preparedJson(f);
    // 两条来源都要在：profile.yaml 的 phases_disabled 与 capability 的 SKIP 声明。
    assert(prepared.gaps.some(gap => gap.startsWith('capability:phase_disabled:ut')),
      `generic 的 phases_disabled 未在准备期呈现: ${JSON.stringify(prepared.gaps)}`);
    assert(prepared.gaps.some(gap => gap.startsWith('capability:ut.run:capability_skipped')),
      `generic 的 ut.run SKIP 未在准备期呈现: ${JSON.stringify(prepared.gaps)}`);
    // 行为与今天一致：执行期照旧拒绝，只是把结论提前到准备期呈现。
    assert.notEqual(cli(f).status, 0, 'generic 下执行仍应失败');
  } },
];
export function runAll(): UnitCaseResult[] {
  return cases.map(test => { const f = fixture(test.phase); try { test.run(f); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: String(error) }; } finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); } });
}
