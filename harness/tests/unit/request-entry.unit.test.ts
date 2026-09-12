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
];
export function runAll(): UnitCaseResult[] {
  return cases.map(test => { const f = fixture(test.phase); try { test.run(f); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: String(error) }; } finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); } });
}
