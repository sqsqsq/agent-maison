import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import * as hvigor from '../../hvigor-runner';
import * as hdc from '../../hdc-runner';
import * as toolchain from '../../toolchain-probe';
import * as products from '../../product-selection';
import * as readiness from '../../../../../harness/scripts/utils/device-readiness-gate';
import * as setupGate from '../../../../../harness/scripts/utils/personal-setup-gate';
import * as native from '../../providers/device-test-run';
import * as spawn from '../../hylyre-spawn';
import { listExecutionKeyRuns } from '../../execution-key';
import { computeHapSha256Full, probeInstalledHapSha256 } from '../../build-fingerprint';
import { checkRequestTests, runExplicitRequest } from '../../../../../harness/scripts/utils/request-phase';
import { generateRequestScriptReport } from '../../../../../harness/scripts/utils/report-generator';
import type { RequestCheckContext, CheckResult } from '../../../../../harness/scripts/utils/types';
import { clearFrameworkConfigCache } from '../../../../../harness/config';
import { materializeAutomaticFacts, prepareAutomaticRequest } from '../../../../../harness/scripts/utils/automatic-request';
import { prepareExplicitRequest } from '../../../../../harness/scripts/utils/capability-resolution-entry-input';

const repo = path.resolve(__dirname, '../../../../..');
const golden = path.join(repo, 'profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden/step/valid');
function step(file: string, index = 0) { return { ...JSON.parse(fs.readFileSync(path.join(golden, file + '.json'), 'utf8')), index }; }
function fixture(phase: 'ut' | 'testing') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'request-execution-'));
  const reportDir = path.join(root, 'reports'); fs.mkdirSync(reportDir);
  const test = 'entry/src/ohosTest/ets/test/Selected.test.ets';
  const source = "describe('Selected', () => {\n  it('[CHAR-selected] keeps behavior', 0, () => { expect(1).assertEqual(1); });\n});\n";
  fs.mkdirSync(path.dirname(path.join(root, test)), { recursive: true }); fs.writeFileSync(path.join(root, test), source);
  fs.writeFileSync(path.join(root, 'entry/src/ohosTest/module.json5'), '{"module":{"name":"entry_test"}}');
  fs.mkdirSync(path.join(root, 'AppScope')); fs.writeFileSync(path.join(root, 'AppScope/app.json5'), '{"app":{"bundleName":"com.example.request"}}');
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: 'hmos-app' }));
  const ctx = { subject: 'request', phase, projectRoot: root, frameworkRoot: repo, frameworkRel: 'framework', harnessRoot: path.join(repo, 'harness'), reportDir,
    phaseRule: { structure_checks: {}, traceability_checks: {}, semantic_checks: {} },
    resolvedProfile: { name: 'hmos-app', profileDir: path.join(repo, 'profiles/hmos-app'), capabilities: { 'ut.run': { provider: 'hvigor_hypium', severity: 'BLOCKER' }, 'device_test.run': { provider: 'hylyre', severity: 'BLOCKER' } }, personalPrerequisites: {}, phasesDisabled: new Set() },
    request: { request_sha256: 'request-only', requested_result: 'check the selected behavior', reportDir, targets: { files: [], tests: phase === 'ut' ? [test] : [] },
      sourceContents: [{ path: test, content: source }], inputs: { test_plan: path.join(root, 'plan.md') }, bindings: [], baseline: {}, allowed_test_writes: [] },
    resolvedInputs: { values: {}, context: {} }, factsContext: {},
  } as unknown as RequestCheckContext;
  return { root, ctx };
}
function patch(object: object, key: string, value: unknown, restores: Array<() => void>) {
  const source = object as Record<string, unknown>; const prior = source[key]; source[key] = value; restores.push(() => { source[key] = prior; });
}
const cases: Array<{ name: string; run(): Promise<void> | void }> = [{
  name: 'ddcc7160 HMOS prepare grants same-module registration and execution counts only selected Hypium cases',
  async run() {
    const f = fixture('ut'), restores: Array<() => void> = [];
    const oldClaude = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = path.join(f.root, 'claude');
      const session = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects/fixture/registration.jsonl');
      fs.mkdirSync(path.dirname(session), { recursive: true });
      const test = 'entry/src/ohosTest/ets/spec/Selected.ets';
      fs.mkdirSync(path.dirname(path.join(f.root, test)), { recursive: true });
      fs.renameSync(path.join(f.root, f.ctx.request.targets.tests[0]), path.join(f.root, test));
      const registration = 'entry/src/ohosTest/ets/test/List.test.ets';
      const foreign = 'other/src/ohosTest/ets/test/List.test.ets';
      const helper = 'entry/src/ohosTest/ets/test/Helper.test.ets';
      const source = 'entry/src/main/ets/search.ets';
      for (const file of [foreign, source]) fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true });
      fs.writeFileSync(path.join(f.root, source), 'export const bankName = "Bank";');
      fs.writeFileSync(path.join(f.root, 'other/src/ohosTest/module.json5'), '{"module":{"name":"other_test"}}');
      const registrationSource = "import selected from '../spec/Selected';\nexport default function testsuite() { selected(); }\n";
      fs.writeFileSync(path.join(f.root, foreign), registrationSource);
      fs.writeFileSync(path.join(f.root, helper), 'export const helper = 1;');
      fs.writeFileSync(path.join(f.root, 'build-profile.json5'), JSON.stringify({ modules: [
        { name: 'entry', srcPath: './entry' }, { name: 'other', srcPath: './other' },
      ] }));
      fs.writeFileSync(path.join(f.root, '.gitignore'), 'claude/\nreports/\nentry.hap\nexplicit-request.json\n');
      const git = (...args: string[]) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      git('init', '-q');
      git('add', '.');
      git('-c', 'user.name=UT Fixture', '-c', 'user.email=ut@example.invalid', 'commit', '-qm', 'clean UT baseline');
      const rows: object[] = [];
      const event = (value: object) => rows.push({ sessionId: 'registration', cwd: f.root, timestamp: new Date().toISOString(), ...value });
      const tool = (name: string, input: object, output: string) => {
        const id = 'call-' + rows.length;
        event({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
        event({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } });
      };
      const flush = () => fs.writeFileSync(session, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      event({ type: 'user', uuid: 'same-request', message: { role: 'user', content: '验证银行搜索并维护 Hypium 注册。' } });
      tool('Bash', { command: 'git rev-parse HEAD' }, git('rev-parse', 'HEAD'));
      tool('Bash', { command: 'git status --porcelain' }, git('status', '--porcelain'));
      tool('Read', { file_path: path.join(f.root, source) }, fs.readFileSync(path.join(f.root, source), 'utf8'));
      event({ type: 'assistant', message: { role: 'assistant', content: `本请求验证银行搜索。依据 ${source}，Q1=否，Q2=否，Q3=否，依赖结果=否，跨部件=否，预期明确=是，做法唯一=是。` } });
      flush();
      const args = { phase: 'ut', target: source, 'test-target': test, 'allow-test-write': [test, registration],
        'session-ref': session + '#same-request', 'prepare-request': true, 'report-dir': 'reports/prepared' };
      const publicRequest = (args: Record<string, unknown>) => runExplicitRequest({ projectRoot: f.root, frameworkRoot: repo, args });
      assert.equal(await publicRequest(args), 0);
      const written = { requestFile: 'reports/prepared/request.json', reportDir: 'reports/prepared' };
      const parseOptions = { projectRoot: f.root, frameworkRoot: repo, phase: 'ut', ...written };
      const prepare = () => prepareExplicitRequest(parseOptions);
      const pending = prepare();
      assert.equal(pending.intake_context?.user.id, 'same-request', 'exercise the native writer path');
      assert.equal(pending.baseline.base, git('rev-parse', 'HEAD'));
      assert.deepEqual(pending.targets.tests, [test]);
      assert.deepEqual(pending.test_registrations, [registration]);
      assert.deepEqual(pending.allowed_test_writes, [registration, test].sort());
      assert.deepEqual(pending.bindings.find(binding => binding.path === registration), { path: registration, exists: false, sha256: null });
      for (const file of [foreign, helper, source]) assert.throws(() =>
        prepareAutomaticRequest(f.root, repo, { ...args, 'allow-test-write': [test, registration, file] }),
      (error: Error) => error.message.includes('allowed_test_writes') && error.message.includes(file));
      assert.deepEqual(prepare().allowed_test_writes, pending.allowed_test_writes, 'failed preparation keeps the prior request');

      fs.writeFileSync(path.join(f.root, registration), registrationSource);
      tool('Write', { file_path: path.join(f.root, registration), content: registrationSource }, 'File written');
      flush();
      assert(git('status', '--short', '--untracked-files=all').includes(registration));
      const prepared = prepare();
      assert(prepared.intake_context?.targets.includes(registration), 'the registration really returns through native and diff attribution');
      assert.deepEqual(prepared.targets.files, [source]);
      assert(prepared.bindings.find(binding => binding.path === registration)?.sha256);
      assert.equal(await publicRequest(args), 0, 'the native writer can prepare again after the recorded registration write');

      const shorthand = { ...args, 'test-target': undefined, 'report-dir': 'reports/shorthand' };
      const inferred = prepareAutomaticRequest(f.root, repo, shorthand);
      assert.deepEqual(prepareExplicitRequest({ ...parseOptions, ...inferred }).targets.tests, [test]);
      for (const file of [foreign, helper, source]) assert.throws(() => prepareAutomaticRequest(f.root, repo,
        { ...shorthand, 'report-dir': 'reports/refused', 'allow-test-write': [test, registration, file] }),
      (error: Error) => error.message.includes('allowed_test_writes') && error.message.includes(file));
      const original = JSON.parse(fs.readFileSync(path.join(f.root, written.requestFile), 'utf8'));
      fs.writeFileSync(path.join(f.root, written.requestFile), JSON.stringify({ ...original, targets: { ...original.targets, files: [source, registration] } }));
      assert.throws(prepare, /allowed_test_writes.*List\.test\.ets/, 'an explicit source declaration still conflicts with a write grant');
      fs.writeFileSync(path.join(f.root, written.requestFile), JSON.stringify({ ...original, targets: { ...original.targets, tests: [test, registration] } }));
      assert.deepEqual(prepare().targets.tests, [test], 'former combined target lists retain their roles');
      fs.writeFileSync(path.join(f.root, written.requestFile), JSON.stringify({ ...original, allowed_test_writes: [] }));
      const readOnly = prepare();
      assert.deepEqual(readOnly.test_registrations, [registration]);
      assert.deepEqual(readOnly.allowed_test_writes, []);
      fs.writeFileSync(path.join(f.root, written.requestFile), JSON.stringify(original));

      let executions = 0, builds = 0, total = 1;
      const hap = path.join(f.root, 'entry.hap'); fs.writeFileSync(hap, 'same built bytes across registration changes');
      patch(products, 'resolveProductSelection', () => ({ product: 'phone' }), restores);
      patch(readiness, 'applyPhaseEntryDeviceGate', async () => ({ ok: true, notes: [] }), restores);
      patch(hdc, 'resolveExecutionDeviceIdentity', () => ({ device: 'test-serial', display_env: '1080x1920' }), restores);
      patch(hdc, 'discoverOhosTestArtifacts', () => ({ signedPath: hap, artifactValidation: { status: 'valid' } }), restores);
      patch(toolchain, 'computeHvigorConfigDigest', () => 'actual-tools', restores);
      patch(hvigor, 'runHvigorBuild', (opts: { reportDir: string }) => {
        builds++; const logPath = path.join(opts.reportDir, 'build.log'); fs.writeFileSync(logPath, 'BUILD SUCCESSFUL');
        return { executed: true, exitCode: 0, successMarkerFound: true, durationMs: 1, logExcerpt: 'BUILD SUCCESSFUL', logPath, errors: [], builtHap: { path: hap, sha256: computeHapSha256Full(hap) } };
      }, restores);
      patch(hvigor, 'runHvigorTest', (opts: { reportDir: string; testClasses: string[] }) => {
        executions++; assert.deepEqual(opts.testClasses, ['bank_search_unit']);
        const logPath = path.join(opts.reportDir, 'hdc-test.entry.log'); fs.writeFileSync(logPath, 'OHOS_REPORT_RESULT: PASSED');
        return { executed: true, exitCode: 0, durationMs: 1, logExcerpt: 'native results', logPath, testResult: { total, passed: total, failed: 0, skipped: 0, failures: [] }, errors: [] };
      }, restores);
      const sourceText = prepared.sourceContents.find(file => file.path === test)!.content;
      const updateTest = (content: string) => fs.writeFileSync(path.join(f.root, test), content);
      const run = () => { f.ctx.request = prepare(); return checkRequestTests(f.ctx); };
      for (const [content, detail] of [
        [sourceText.replace("'Selected'", "'bank search unit'"), '"bank search unit" 非法，仅允许 ASCII 字母、数字及 ._-'],
        [sourceText.replace("'Selected'", 'groupName'), '缺少字符串字面量 Hypium 组名'],
        ["describe('bank_search_unit', () => {});\n", '缺少可执行的 Hypium it(...) 用例'],
      ]) {
        updateTest(content);
        const checks = await run();
        assert(checks.some(check => check.id === 'request_ut_native' && check.status === 'FAIL' && check.details.includes(test) && check.details.includes(detail)), JSON.stringify(checks));
      }
      assert.equal(builds, 0); assert.equal(executions, 0);
      updateTest(sourceText.replace("'Selected'", "'bank_search_unit'"));
      const first = await run();
      assert(first.some(check => check.id === 'request_test_execution' && check.status === 'PASS' && check.details.includes('total=1')), JSON.stringify(first));
      const expectation = first.find(check => check.id === 'request_expectation_source')!;
      assert.equal(expectation.status, 'PASS', expectation.details);
      assert.deepEqual(expectation.affected_files, [test]);
      await run(); assert.equal(executions, 1);
      patch(setupGate, 'ensurePersonalSetup', () => ({ ok: true }), restores);
      assert.equal(await publicRequest({ phase: 'ut', 'request-file': written.requestFile, 'report-dir': written.reportDir }), 0,
        'execute the same native request after the registration returns through intake');
      const report = JSON.parse(fs.readFileSync(path.join(f.root, written.reportDir, 'script-report.json'), 'utf8'));
      assert(report.checks.some((check: CheckResult) => check.id === 'request_test_execution' && check.status === 'PASS' && check.details.includes('total=1')));
      const oldRegistration = f.ctx.request.bindings.find(binding => binding.path === registration)?.sha256;
      fs.appendFileSync(path.join(f.root, registration), '// registration input changed\n');
      await run();
      assert.notEqual(f.ctx.request.bindings.find(binding => binding.path === registration)?.sha256, oldRegistration);
      assert.equal(executions, 3, 'registration bytes invalidate earlier execution even when built bytes match');

      const requestFile = 'explicit-request.json', reportDir = 'reports/explicit';
      fs.writeFileSync(path.join(f.root, requestFile), JSON.stringify({ schema_version: '1.0', phase: 'ut', requested_result: 'verify existing bank test',
        targets: { files: [source], tests: [test] }, allowed_test_writes: [] }));
      const legacy = prepareExplicitRequest({ projectRoot: f.root, frameworkRoot: repo, phase: 'ut', requestFile, reportDir });
      materializeAutomaticFacts({ ...legacy, origin_gap: 'fixture facts', bindings: legacy.bindings.filter(binding => binding.path !== registration) }, f.root);
      assert.equal(await runExplicitRequest({ projectRoot: f.root, frameworkRoot: repo, args: { phase: 'ut', 'request-file': requestFile, 'report-dir': reportDir } }), 0,
        'an existing readonly request with facts for the case and product inputs can still execute');

      f.ctx.forceDevice = true; total = 2;
      const mismatched = await run();
      assert(mismatched.some(check => check.id === 'request_ut_native' && check.status === 'FAIL' && check.details.includes('requested=1; actual=2')), JSON.stringify(mismatched));
    } finally {
      restores.reverse().forEach(restore => restore());
      if (oldClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = oldClaude;
      fs.rmSync(f.root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    }
  },
}, {
  name: '1804 UT request reuses only complete same-input success; fresh, input changes, failed and interrupted attempts execute',
  async run() {
    const f = fixture('ut'); const restores: Array<() => void> = [];
    const old = process.env.HARNESS_HDC_TARGET; process.env.HARNESS_HDC_TARGET = 'test-serial';
    try {
      let executions = 0, builds = 0, failed = false, crash = false, blocked = false, crashBuild = false;
      const hap = path.join(f.root, 'entry.hap'); fs.writeFileSync(hap, 'actual test package');
      patch(hvigor, 'listBuildProfileModules', () => [{ name: 'entry', srcPath: 'entry' }], restores);
      patch(products, 'resolveProductSelection', () => ({ product: 'phone', source: 'sole_candidate' }), restores);
      patch(readiness, 'applyPhaseEntryDeviceGate', async () => ({ ok: !blocked, reason: blocked ? 'device locked' : undefined, notes: [] }), restores);
      patch(hdc, 'resolveExecutionDeviceIdentity', () => ({ device: 'test-serial', display_env: '1080x1920' }), restores);
      patch(hdc, 'discoverOhosTestArtifacts', () => ({ signedPath: hap, artifactValidation: { status: 'valid' } }), restores);
      patch(toolchain, 'computeHvigorConfigDigest', () => 'actual-tools', restores);
      patch(hvigor, 'runHvigorBuild', (opts: { reportDir: string }) => {
        builds++; if (crashBuild) throw new TypeError('build transport crashed'); const logPath = path.join(opts.reportDir, 'build.log'); fs.writeFileSync(logPath, 'BUILD SUCCESSFUL current-build=' + builds);
        return { executed: true, exitCode: 0, successMarkerFound: true, durationMs: 1, logExcerpt: 'BUILD SUCCESSFUL', logPath, errors: [], builtHap: { path: hap, sha256: computeHapSha256Full(hap) },
          buildInvocation: { module: 'entry', target: 'ohosTest', task: 'assembleHap', product: 'phone', buildMode: 'test' } };
      }, restores);
      patch(hvigor, 'runHvigorTest', (opts: { reportDir: string; testClasses: string[]; prebuild: unknown }) => {
        executions++; assert.deepEqual(opts.testClasses, ['Selected']); assert(opts.prebuild);
        if (crash) throw new TypeError('native transport crashed');
        const logPath = path.join(opts.reportDir, 'hdc-test.entry.log'); fs.writeFileSync(logPath, failed ? 'OHOS_REPORT_RESULT: FAILED' : 'OHOS_REPORT_RESULT: PASSED');
        return { executed: true, exitCode: failed ? 1 : 0, durationMs: 1, logExcerpt: 'actual native results', logPath, testResult: { total: 1, passed: failed ? 0 : 1, failed: failed ? 1 : 0, skipped: 0, failures: [] }, errors: [] };
      }, restores);
      const run = () => checkRequestTests(f.ctx);
      assert((await run()).some(check => check.id === 'request_test_execution' && check.status === 'PASS'));
      await run(); assert.equal(executions, 1); assert.equal(builds, 2, 'current package must be rebuilt before reuse');
      assert.match(fs.readFileSync(path.join(listExecutionKeyRuns(f.ctx.reportDir, 'ut')[0].runDir, 'hvigor-build.entry.log'), 'utf8'), /current-build=2/, 'reused native test evidence cannot overwrite the current build log');
      assert((await run()).some(check => check.details.includes('reused_by_execution_key'))); assert.equal(executions, 1);
      const previous = listExecutionKeyRuns(f.ctx.reportDir, 'ut')[0];
      fs.unlinkSync(path.join(previous.runDir, 'frozen.hdc-test.entry.log'));
      await run(); assert.equal(executions, 2, 'missing native log reruns');
      fs.writeFileSync(hap, 'changed test package'); await run(); assert.equal(executions, 3);
      f.ctx.forceDevice = true; failed = true;
      const checks = await run(); assert(checks.some(check => check.id === 'request_test_execution' && check.status === 'FAIL'));
      f.ctx.forceDevice = false; await run(); assert.equal(executions, 5, 'a new request must never replay the old FAIL');
      failed = false; await run(); assert.equal(executions, 6, 'failure must not be hidden by older success');
      f.ctx.forceDevice = true; crash = true;
      const gap = await run(); assert(gap.some(check => check.failure_kind === 'framework_bug' && check.status === 'SKIP'));
      assert.equal(listExecutionKeyRuns(f.ctx.reportDir, 'ut')[0].record.outcome, 'started');
      f.ctx.forceDevice = false; crash = false; await run(); assert.equal(executions, 8, 'interrupted attempt must hide older success');
      f.ctx.forceDevice = true; blocked = true; const external = await run(); assert(external.some(check => check.failure_kind === 'device_blocked'));
      f.ctx.forceDevice = false; blocked = false; await run(); assert.equal(executions, 9, 'unlocking after a blocked request must not resurrect an older success');
      crashBuild = true; const buildGap = await run(); assert(buildGap.some(check => check.failure_kind === 'framework_bug'));
      crashBuild = false; await run(); assert.equal(executions, 10, 'a newer failed build must hide old success');
      assert(listExecutionKeyRuns(f.ctx.reportDir, 'ut').every(run => !run.record.goal_invocation));
    } finally { restores.reverse().forEach(restore => restore()); if (old === undefined) delete process.env.HARNESS_HDC_TARGET; else process.env.HARNESS_HDC_TARGET = old; fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '1804 installed HAP fingerprint reads native bundle JSON and byte digests, never local/version-only evidence',
  run() {
    const restores: Array<() => void> = []; let output = JSON.stringify({ name: 'com.example.request', versionCode: 1, hapModuleInfos: [{ name: 'entry', hapPath: '/data/app/el1/bundle/public/com.example.request/entry.hap' }] }); let denied = false;
    try {
      patch(hdc, 'resolveHdcExecutableSync', () => 'hdc', restores);
      patch(hdc, 'runHdcRaw', (_exe: string, argv: string[]) => { if (argv[3] === 'bm') { assert.deepEqual(argv, ['-t', 'serial', 'shell', 'bm', 'dump', '-n', 'com.example.request']); return { status: 0, stdout: output }; } assert.deepEqual(argv.slice(0, 5), ['-t', 'serial', 'shell', 'sha256sum', '/data/app/el1/bundle/public/com.example.request/entry.hap']); return { status: denied ? 1 : 0, stdout: 'a'.repeat(64) + '  ' + argv[4] }; }, restores);
      assert.match(probeInstalledHapSha256('com.example.request', 'serial')!, /^[a-f0-9]{64}$/);
      denied = true; assert.equal(probeInstalledHapSha256('com.example.request', 'serial'), null); denied = false;
      output = '{"name":"com.example.request","versionCode":1}'; assert.equal(probeInstalledHapSha256('com.example.request', 'serial'), null);
      output = '{"name":"wrong.bundle","hapModuleInfos":[{"name":"entry","hapPath":"/data/a.hap"}]}'; assert.equal(probeInstalledHapSha256('com.example.request', 'serial'), null);
      assert.equal(probeInstalledHapSha256('com.example.request', null), null);
    } finally { restores.reverse().forEach(restore => restore()); }
  },
}, {
  name: '1804 device request reuses complete native steps plus expected assertions and reruns changed inputs, gaps or new failures',
  async run() {
    const f = fixture('testing'); const restores: Array<() => void> = [];
    const old = process.env.HARNESS_HDC_TARGET; process.env.HARNESS_HDC_TARGET = 'serial';
    try {
      let executions = 0, assertions = 0, unreadable = false, packageByte = 'a', failed = false, blocked = false, nativeInternal = false;
      const plan = (expected = 'The title is visible') => ['## 测试用例清单', '', '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |', '|---|---|---|---|---|---|---|', '| TC-001 | title | already open | {"back":{}} ; {"wait_for":{"by_text":"Title","match":"exact"}} | ' + expected + ' | P0 | AC-1 |'].join('\n');
      f.ctx.resolvedInputs.values = { test_plan: { state: 'resolved', value: plan() }, cases: { state: 'resolved', value: [{ id: 'TC-001' }] } } as unknown as RequestCheckContext['resolvedInputs']['values'];
      fs.writeFileSync(f.ctx.request.inputs.test_plan, plan());
      patch(readiness, 'applyPhaseEntryDeviceGate', async () => ({ ok: !blocked, reason: blocked ? 'device locked' : undefined, notes: [] }), restores);
      patch(hdc, 'resolveExecutionDeviceIdentity', () => ({ device: 'serial', display_env: '1080x1920' }), restores);
      patch(hdc, 'resolveHdcExecutableSync', () => 'hdc', restores);
      patch(hdc, 'runHdcRaw', (_exe: string, argv: string[]) => argv[3] === 'bm' ? { status: 0, stdout: JSON.stringify({ name: 'com.example.request', hapModuleInfos: [{ name: 'entry', hapPath: '/data/app/el1/bundle/public/com.example.request/entry.hap' }] }) } : { status: unreadable ? 1 : 0, stdout: packageByte.repeat(64) + '  /data/app/el1/bundle/public/com.example.request/entry.hap' }, restores);
      patch(native, 'ensureHylyreReady', () => ({ ok: true, pythonPath: 'python', hylyreVersion: '0.5.0', manifestVersion: '0.5.0' }), restores);
      patch(native, 'runHylyreDeviceTest', (opts: { reportDir: string; stepsFilePath: string }) => {
        executions++; assert.equal(JSON.parse(fs.readFileSync(opts.stepsFilePath, 'utf8')).length, 2);
        const result = step(nativeInternal ? 'failed-internal-unexpected-exception' : failed ? 'failed-assertion-mismatch-presence' : 'passed-assertion-presence', 1);
        const setup = { ...step('passed-action-no-selector-wait'), kind: 'back' };
        const logPath = path.join(opts.reportDir, 'device-test-run.log');
        fs.writeFileSync(logPath, JSON.stringify({ result_protocol: native.NATIVE_RESULT_PROTOCOL, total: 2, executed: 2, results: [{ index: 0, step_result: setup }, { index: 1, step_result: result }] }));
        fs.writeFileSync(path.join(opts.reportDir, 'device-test-run.meta.json'), JSON.stringify({ exit_code: failed ? 1 : 0 }));
        fs.writeFileSync(path.join(opts.reportDir, 'native-trace.json'), JSON.stringify({ steps: [result] }));
        fs.writeFileSync(path.join(opts.reportDir, 'native-report.md'), 'native execution report');
        return { executed: true, exitCode: failed ? 1 : 0, logPath };
      }, restores);
      patch(spawn, 'resolveHylyreRuntimeWorkDir', () => ({ hypiumWorkDir: f.root }), restores);
      patch(spawn, 'spawnHylyre', (opts: { logPath: string }) => { assertions++; const stdout = JSON.stringify({ result_protocol: native.NATIVE_RESULT_PROTOCOL, step_result: step('passed-assertion-expected-vlm') }); fs.writeFileSync(opts.logPath, stdout); return { status: 0, stdout }; }, restores);
      const run = () => checkRequestTests(f.ctx);
      const first = await run(); assert(first.some(check => check.id === 'request_test_execution' && check.status === 'PASS'), JSON.stringify(first));
      const second = await run(); assert(second.some(check => check.details.includes('reused_by_execution_key'))); assert.equal(executions, 1); assert.equal(assertions, 1);
      const history = listExecutionKeyRuns(f.ctx.reportDir)[0]; fs.unlinkSync(path.join(history.runDir, 'frozen.case-1.expected-check.response.json'));
      await run(); assert.equal(executions, 2, 'missing expected native evidence must execute');
      packageByte = 'b'; await run(); assert.equal(executions, 3, 'changed installed HAP must execute');
      f.ctx.resolvedInputs.values.test_plan = { state: 'resolved', value: plan('The new expectation holds') } as RequestCheckContext['resolvedInputs']['values'][string]; await run(); assert.equal(executions, 4);
      f.ctx.forceDevice = true; failed = true;
      const failure = await run(); assert(failure.some(check => check.id === 'request_device_native' && check.status === 'FAIL' && !check.failure_kind));
      f.ctx.forceDevice = false; await run(); assert.equal(executions, 6, 'new request must rerun FAIL');
      failed = false; await run(); assert.equal(executions, 7, 'latest failed request must defeat old success');
      unreadable = true; await run(); await run(); assert.equal(executions, 9, 'unprovable installed package always executes');
      unreadable = false; await run(); assert.equal(executions, 10);
      f.ctx.forceDevice = true; blocked = true; const external = await run(); assert(external.some(check => check.failure_kind === 'device_blocked'));
      f.ctx.forceDevice = false; blocked = false; await run(); assert.equal(executions, 11, 'device recovery after a newer blocked request reruns');
      f.ctx.forceDevice = true; nativeInternal = true;
      const internal = await run(); assert.equal(generateRequestScriptReport(f.ctx, internal).verdict, 'INCOMPLETE', JSON.stringify(internal));
      assert(internal.some(check => check.id === 'request_device_native' && check.failure_kind === 'framework_bug'));
      nativeInternal = false; failed = false; f.ctx.forceDevice = true;
      let selectedB = false;
      patch(readiness, 'applyPhaseEntryDeviceGate', async () => { selectedB = true; process.env.HARNESS_HDC_TARGET = 'device-B'; return { ok: true, notes: [] }; }, restores);
      patch(hdc, 'resolveExecutionDeviceIdentity', () => ({ device: selectedB ? 'device-B' : 'device-A', display_env: '1080x1920' }), restores);
      patch(hdc, 'runHdcRaw', (_exe: string, argv: string[]) => argv[3] === 'bm' ? { status: 0, stdout: JSON.stringify({ name: 'com.example.request', hapModuleInfos: [{ name: 'entry', hapPath: '/data/app/entry.hap' }] }) }
        : { status: 0, stdout: (argv[1] === 'device-B' ? 'b' : 'a').repeat(64) + '  /data/app/entry.hap' }, restores);
      await run();
      const selectedRecord = listExecutionKeyRuns(f.ctx.reportDir)[0].record;
      assert.equal(selectedRecord.inputs.device, 'device-B'); assert.equal(selectedRecord.inputs.hap_sha256_full, require('crypto').createHash('sha256').update('entry:/data/app/entry.hap:' + 'b'.repeat(64)).digest('hex'), 'post-gate B cannot inherit A installed HAP identity');
      assert(listExecutionKeyRuns(f.ctx.reportDir).every(run => !run.record.goal_invocation));
      f.ctx.request.blueprint = { acceptance_ids: ['AC-1', 'AC-2', 'AC-3'] } as typeof f.ctx.request.blueprint;
      f.ctx.resolvedInputs.values.cases = { state: 'resolved', value: {
        criteria: [{ id: 'AC-1', ut_layer: 'device' }, { id: 'AC-2', ut_layer: 'both' }, { id: 'AC-3', ut_layer: 'unit' }],
        boundaries: [{ id: 'BD-1', priority: 'P2', ut_layer: 'device', scenario: 'Empty query', handling: 'Show title', expected_behavior: 'Title visible' }],
        performance: [{ id: 'NFR-LOOKUP', ut_layer: 'both', device_focus: 'Measure lookup', metric: 'Lookup p95', threshold: '<= 300', unit: 'ms' }],
      } } as unknown as RequestCheckContext['resolvedInputs']['values'][string];
      const bindPlan = (refs: string) => {
        f.ctx.resolvedInputs.values.test_plan = { state: 'resolved', value: plan().replace('AC-1 |', refs + ' |') } as RequestCheckContext['resolvedInputs']['values'][string];
      };
      const beforeGroup = executions;
      bindPlan('AC-1, AC-2, BD-1, NFR-LOOKUP');
      const grouped = await run();
      const row = grouped.find(check => check.id === 'request_device_native');
      assert.equal(row?.status, 'PASS', JSON.stringify(grouped));
      assert.deepEqual((row?.structured as { request_device_case: unknown }).request_device_case, {
        tc_id: 'TC-001', acceptance_ids: ['AC-1', 'AC-2', 'BD-1', 'NFR-LOOKUP'], expected: 'The title is visible',
      });
      assert(row?.affected_files?.some(file => file.endsWith('expected-check.response.json')));
      assert.equal(executions, beforeGroup + 1);
      bindPlan('AC-1, AC-3');
      const outside = await run();
      assert(outside.some(check => check.id === 'request_device_native' && check.status === 'FAIL' && check.details.includes('AC-3')));
      assert.equal(executions, beforeGroup + 1);
    } finally { restores.reverse().forEach(restore => restore()); if (old === undefined) delete process.env.HARNESS_HDC_TARGET; else process.env.HARNESS_HDC_TARGET = old; fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '1804 UT producer capability gaps are INCOMPLETE while unsupported targets stay input FAIL',
  async run() {
    const f = fixture('ut'); const old = process.env.HARNESS_SKIP_HVIGOR_TEST;
    try {
      process.env.HARNESS_SKIP_HVIGOR_TEST = '1';
      const external = await checkRequestTests(f.ctx);
      assert(external.some(check => check.id === 'request_ut_native' && check.status === 'SKIP' && check.failure_kind === 'capability_missing'));
      assert.equal(generateRequestScriptReport(f.ctx, external).verdict, 'INCOMPLETE');
      delete process.env.HARNESS_SKIP_HVIGOR_TEST;
      f.ctx.request.targets.tests = ['src/outside.test.ets'];
      const invalid = await checkRequestTests(f.ctx);
      assert(invalid.some(check => check.id === 'request_ut_native' && check.status === 'FAIL' && !check.failure_kind));
      assert.equal(generateRequestScriptReport(f.ctx, invalid).verdict, 'FAIL');
    } finally { if (old === undefined) delete process.env.HARNESS_SKIP_HVIGOR_TEST; else process.env.HARNESS_SKIP_HVIGOR_TEST = old; fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'B daily regression: a blueprint request with absent derived acceptance remains blocked without an artifacts TypeError',
  async run() {
    const f = fixture('ut'), old = process.env.HARNESS_SKIP_HVIGOR_TEST;
    try {
      process.env.HARNESS_SKIP_HVIGOR_TEST = '1';
      f.ctx.request.blueprint = { ref: { artifact: 'component-blueprint@1', component_id: 'missing-derived', blueprint_id: 'missing-derived', revision: 1,
        source_fingerprint: 'sha256:' + 'a'.repeat(64), artifact_sha256: 'sha256:' + 'b'.repeat(64), target: { kind: 'blueprint', id: 'missing-derived' } }, acceptance_ids: ['AC-1'] };
      const checks = await checkRequestTests(f.ctx);
      assert(checks.some(check => check.id === 'request_expectation_source' && check.status === 'FAIL' && check.details.includes('验收分层输入不可用')));
    } finally { if (old === undefined) delete process.env.HARNESS_SKIP_HVIGOR_TEST; else process.env.HARNESS_SKIP_HVIGOR_TEST = old; fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: '1804 request inputs, native product failures, environment gaps and legacy SKIP retain distinct conclusions',
  async run() {
    const f = fixture('testing');
    try {
      const checks = await checkRequestTests(f.ctx);
      assert(checks.some(check => check.id === 'request_cases_missing' && check.status === 'FAIL' && !check.failure_kind));
      const legacy = { id: 'legacy_skip', category: 'structure', severity: 'BLOCKER', status: 'SKIP', description: 'legacy', details: 'legacy verifier responsibility' } as CheckResult;
      assert.equal(generateRequestScriptReport(f.ctx, [legacy]).verdict, 'PASS');
      assert.equal(generateRequestScriptReport(f.ctx, [{ ...legacy, failure_kind: 'framework_bug', blocking_class: 'framework_internal' }]).verdict, 'INCOMPLETE');
      assert.equal(generateRequestScriptReport(f.ctx, [{ ...legacy, status: 'FAIL' }]).verdict, 'FAIL');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}];
export function getCases() { return cases; }
export async function runAll() {
  const out = [];
  for (const test of cases) { try { await test.run(); out.push({ name: test.name, ok: true }); } catch (error) { out.push({ name: test.name, ok: false, error: (error as Error).stack }); } }
  return out;
}
