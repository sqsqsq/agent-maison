import { beginUnitCase, discoveryResult } from '../../../../../harness/tests/utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildChildEnv, buildCodingHvigorArgs, buildUtHvigorArgs, describeHvigorEnvironment,
  discoverAppHapArtifacts, isHvigorBuildSuccessful, runHvigorAssembleApp,
  runHvigorBuild, runHvigorTest, runHvigorVersionProbe,
} from '../../hvigor-runner';
import { discoverOhosTestArtifacts, runOnDeviceUt } from '../../hdc-runner';
import { runDeviceTestAppBuild } from '../../providers/device-test-build';
import { evaluateDeviceTestBuildReuse } from '../../device-test-build-reuse';
import { installCurrentBuildForAdhoc } from '../../../../../harness/scripts/utils/adhoc-repair-diagnosis';
import { checkDeviceTestBuildGate } from '../../../../../harness/scripts/check-testing';
import { loadFrameworkConfig, clearFrameworkConfigCache, featurePhaseReportsDir } from '../../../../../harness/config';
import { loadResolvedProfile } from '../../../../../harness/profile-loader';
import { resolveCurrentDisposition } from '../../../../../harness/scripts/utils/check-disposition';
import { buildUtHvigorTestFailDetails } from '../../ut-hvigor-test-failure';
import { evaluateUtReuseEligibility, utBuildCollectorKey } from '../../ut-host-impl';
import { compileProject } from '../../coding-host-rules';
import { recordBinaryAndCliStartsProbe, recordHvigorBuildOutcome } from '../../toolchain-probe';
import { runEnsureHumanReprobe } from '../../../../../harness/scripts/utils/personal-setup-gate';

export const layer = 'capability' as const;

const frameworkRoot = path.resolve(__dirname, '../../../../..');
const harnessRoot = path.join(frameworkRoot, 'harness');
function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
}
function pair(root: string, product = 'demo', output = 'default', state = 'valid', name = 'entry'): string {
  const signed = path.join(root, 'entry/build', product, 'outputs', output, `${name}-signed.hap`);
  const unsigned = signed.replace('-signed.hap', '-unsigned.hap');
  write(unsigned, 'unsigned'); write(signed, 'signed');
  const old = Date.now() - 120_000;
  fs.utimesSync(unsigned, old / 1000, (old + (state === 'stale' ? 60_000 : 0)) / 1000);
  fs.utimesSync(signed, old / 1000, old / 1000);
  if (state === 'missing-pair') fs.unlinkSync(unsigned);
  return signed;
}
function fixture(run: (root: string, install: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hmos build closure '));
  const install = path.join(root, 'DevEco Studio');
  const saved = { ...process.env };
  try {
    for (const key of ['DEVECO_STUDIO_HOME', 'HUAWEI_DEVECO_STUDIO_HOME', 'HARNESS_DEVICE_TEST_FORCE_BUILD',
      'HARNESS_DEVICE_TEST_BUILD_MODE', 'HARNESS_DEVICE_TEST_PRODUCT', 'MAISON_GOAL_RUNNER', 'MAISON_GOAL_HEADLESS',
      'HARNESS_SKIP_DEVICE_TEST_BUILD', 'HARNESS_SKIP_HVIGOR']) delete process.env[key];
    write(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'HMOSFixture',
      project_profile: { name: 'hmos-app', sub_variant: 'app' }, paths: { features_dir: 'doc/features' },
      architecture: { outer_layers: [{ id: 'entry', can_depend_on: [], intra_layer_deps: 'forbid' }] },
      toolchain: { hvigor: { coding: { driver: 'node_hvigorw_js' }, daemon: true, incremental: true } } }));
    write(path.join(root, 'build-profile.json5'), JSON.stringify({ app: { products: [{ name: 'demo' }, { name: 'other' }] }, modules: [{ name: 'entry', srcPath: './entry' }] }));
    write(path.join(root, 'entry/src/main/module.json5'), '{"module":{"type":"entry"}}');
    write(path.join(root, 'entry/src/ohosTest/module.json5'), '{"module":{"name":"entry_test"}}');
    write(path.join(root, 'AppScope/app.json5'), '{"app":{"bundleName":"test.fixture","versionCode":1}}');
    write(path.join(root, 'scenario.json'), '{}');
    const node = path.join(install, 'tools/node', process.platform === 'win32' ? 'node.exe' : 'node');
    fs.mkdirSync(path.dirname(node), { recursive: true });
    try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
    const script = path.join(install, 'tools/hvigor/bin/hvigorw.js');
    write(script, `const fs=require('fs'),path=require('path'); const root=process.cwd();
      const args=process.argv.slice(2); fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args)+'\\n');
      const scenario=JSON.parse(fs.readFileSync(path.join(root,'scenario.json'),'utf8'));
      if(args.includes('--version')) { console.log('hvigor 5.0.1'); process.exit(0); }
      if(scenario.remove) fs.rmSync(scenario.remove,{force:true});
      if(scenario.sleep) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,scenario.sleep);
      console.log(scenario.log || '> hvigor ERROR: nonfatal plugin diagnostic\\nBUILD SUCCESSFUL');
      process.exit(scenario.exit || 0);`);
    const wrapper = path.join(install, 'tools/hvigor/bin', process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw');
    write(wrapper, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\n` : `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`);
    if (process.platform !== 'win32') fs.chmodSync(wrapper, 0o755);
    fs.mkdirSync(path.join(install, 'sdk'), { recursive: true });
    write(path.join(install, 'jbr/bin', process.platform === 'win32' ? 'java.exe' : 'java'), 'fixture-java');
    if (process.platform !== 'win32') fs.chmodSync(path.join(install, 'jbr/bin/java'), 0o755);
    write(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', toolchain: { devEcoStudio: { installPath: install } } }));
    clearFrameworkConfigCache(); run(root, install);
  } finally {
    process.env = saved; clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true });
  }
}
function app(root: string, options: { buildMode?: 'debug' | 'release'; feature?: string } = {}) {
  return runDeviceTestAppBuild({ projectRoot: root, frameworkRoot, harnessRoot, feature: options.feature ?? 'demo', phase: 'testing', product: 'demo', buildMode: options.buildMode });
}
function calls(root: string): string[][] {
  try { return fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}
function buildCount(root: string): number { return calls(root).filter(args => !args.includes('--version')).length; }
function olderInputs(root: string): void {
  for (const relative of ['build-profile.json5', 'entry/src/main/module.json5', 'entry/src/ohosTest/module.json5', 'AppScope/app.json5']) {
    const old = (Date.now() - 240_000) / 1000; fs.utimesSync(path.join(root, relative), old, old);
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  { name: '真实编译事务重试后仍矛盾交当前作者；已确认外部/框架缺口仍等待或补验', run: () => fixture(root => {
    write(path.join(root, 'build-profile.json5'), JSON.stringify({ app: { products: [{ name: 'demo' }] }, modules: [{ name: 'entry', srcPath: './entry' }] }));
    write(path.join(root, 'scenario.json'), JSON.stringify({ exit: 1, log: `> hvigor ERROR: 00303149 Configuration Error\nError Message: Path not found. At file: ${path.join(root, 'entry')}\nBUILD FAILED` }));
    const result = compileProject({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'compilecase',
      resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot) });
    assert.strictEqual(buildCount(root), 2);
    assert(calls(root)[0].includes('--daemon') && calls(root)[1].includes('--no-daemon'));
    const failed = result.checks.find(check => check.id === 'coding_compile')!;
    assert.strictEqual(failed.status, 'FAIL'); assert.notStrictEqual(failed.blocking_class, 'externalBlocked');
    assert(failed.details.includes('重跑结果：仍失败') && failed.details.includes('hvigor-build.log'));
    const current = resolveCurrentDisposition({ endpoint: 'request', phases: [{ phase: 'coding', verdict: 'FAIL', schemaCurrent: true, closureCommitted: false, checks: result.checks }] });
    assert(current.completionBlocking.some(problem => problem.id === 'coding_compile' && problem.action === 'repair'));
    const controls = resolveCurrentDisposition({ endpoint: 'request', phases: [{ phase: 'ut', verdict: 'FAIL', schemaCurrent: true, closureCommitted: false,
      checks: [{ id: 'ut_hvigor_test', severity: 'BLOCKER', status: 'FAIL', failure_kind: 'device_blocked', blocking_class: 'externalBlocked' },
        { id: 'ut_hvigor_build', severity: 'BLOCKER', status: 'FAIL', failure_kind: 'framework_bug', blocking_class: 'framework_internal' }] }] });
    assert(controls.completionBlocking.some(problem => problem.id === 'ut_hvigor_test' && problem.action === 'wait'));
    assert(controls.completionBlocking.some(problem => problem.action === 'verify' && problem.owner === 'framework'));
  }) },
  { name: '正式 testing 与即席装机拒绝 exit0/成功标记下的陈旧 signed，保留原日志/配对事实', run: () => fixture(root => {
    const signed = pair(root, 'demo', 'default', 'stale');
    process.env.HARNESS_DEVICE_TEST_PRODUCT = 'demo';
    const ctx = { projectRoot: root, frameworkRoot, harnessRoot, feature: 'formal', phase: 'testing',
      resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot), phaseRule: {}, featureSpec: {} } as never;
    const holder = { hapPath: null } as never;
    const checks = checkDeviceTestBuildGate(ctx, holder);
    assert(checks.some(check => check.status === 'FAIL' && check.details?.includes('签名产物陈旧') && check.details.includes('hvigor-app-build.log') && check.details.includes(signed)));
    assert.strictEqual((holder as { hapPath: string | null }).hapPath, null);
    let installs = 0;
    const adhoc = installCurrentBuildForAdhoc({ projectRoot: root, frameworkRoot, harnessRoot }, { install: (() => { installs++; throw new Error('不得装机'); }) as never });
    assert.strictEqual(adhoc.ok, false); assert.strictEqual(installs, 0);
    assert(adhoc.reason?.includes('签名产物陈旧') && adhoc.reason.includes('hvigor-app-build.log'));
  }) },
  { name: '主应用缺配对、读取失败、仅 unsigned、构建后删除 signed 均不能退回旧路径', run: () => fixture(root => {
    const signed = pair(root, 'demo', 'default', 'missing-pair');
    assert.strictEqual(app(root).artifactValidation?.status, 'unknown');
    fs.mkdirSync(signed.replace('-signed.hap', '-unsigned.hap'));
    assert.strictEqual(app(root).hapPath, null);
    fs.rmdirSync(signed.replace('-signed.hap', '-unsigned.hap'));
    pair(root); write(path.join(root, 'scenario.json'), JSON.stringify({ remove: signed }));
    const result = app(root); assert.strictEqual(result.hapPath, null);
    assert(result.candidates?.length === 0);
  }) },
  { name: '当前报告绑定完整摘要/路径/维度才复用；IDE 覆盖/旧记录/缺记录/变体请求正常构建', run: () => fixture(root => {
    const signed = pair(root); olderInputs(root);
    assert(app(root).hapPath); assert.strictEqual(buildCount(root), 1);
    assert.strictEqual(app(root).reused, true); assert.strictEqual(buildCount(root), 1);
    assert.strictEqual(app(root, { buildMode: 'release' }).reused, false); assert.strictEqual(buildCount(root), 2);
    fs.writeFileSync(signed, 'IDE overwrite');
    assert.strictEqual(app(root, { buildMode: 'release' }).reused, false); assert.strictEqual(buildCount(root), 3);
    const summary = path.join(featurePhaseReportsDir(root, 'demo', 'testing', frameworkRoot), 'device-test-build.result.json');
    fs.writeFileSync(summary, '{"hvigorExitCode":0}'); app(root, { buildMode: 'release' }); assert.strictEqual(buildCount(root), 4);
    fs.unlinkSync(summary); app(root, { buildMode: 'release' }); assert.strictEqual(buildCount(root), 5);
    app(root, { feature: 'different-feature', buildMode: 'release' }); assert.strictEqual(buildCount(root), 6);
  }) },
  { name: '源码仅 mtime 变更可复用，真实字节改变后重新构建', run: () => fixture(root => {
    const signed = pair(root); olderInputs(root); assert(app(root).hapPath);
    const source = path.join(root, 'entry/src/main/module.json5'); const now = Date.now() / 1000; fs.utimesSync(source, now, now);
    assert.strictEqual(app(root).reused, true);
    write(source, '{"module":{"type":"entry","name":"updated"}}');
    const result = app(root); assert.strictEqual(result.reused, false); assert.strictEqual(result.hapPath, signed);
    assert.strictEqual(buildCount(root), 2);
  }) },
  { name: '正式构建出口忽略四个标准 HAR 的 UT profile 重写，实际配置变化仍执行 Hvigor', run: () => fixture(root => {
    pair(root);
    const buildProfile = path.join(root, 'build-profile.json5');
    const catalog = JSON.parse(fs.readFileSync(buildProfile, 'utf8'));
    const names = ['WalletMain', 'AccountManager', 'CommUI', 'CommFunc'];
    write(path.join(root, 'hvigorfile.ts'), "import { appTasks } from '@ohos/hvigor-ohos-plugin';\nexport default {system: appTasks, plugins: []}");
    for (const name of names) {
      catalog.modules.push({ name, srcPath: `./${name}` });
      write(path.join(root, name, 'src/main/module.json5'), '{"module":{"type":"har"}}');
      write(path.join(root, name, 'oh-package.json5'), '{"version":"1.0.0"}');
      write(path.join(root, name, 'hvigorfile.ts'), "import { harTasks } from '@ohos/hvigor-ohos-plugin';\nexport default {system: harTasks, plugins: []}");
    }
    write(buildProfile, JSON.stringify(catalog));
    assert(app(root).hapPath);
    assert.strictEqual(buildCount(root), 1);
    const profile = ["export const HAR_VERSION = '1.0.0';", "export const BUILD_MODE_NAME = 'test';",
      'export const DEBUG = true;', "export const TARGET_NAME = 'default';", 'export default class BuildProfile {',
      ...['HAR_VERSION', 'BUILD_MODE_NAME', 'DEBUG', 'TARGET_NAME'].map(k => `  static readonly ${k} = ${k};`), '}'].join('\n');
    for (const name of names) write(path.join(root, name, 'BuildProfile.ets'), profile);
    assert.strictEqual(app(root).reused, true);
    assert.strictEqual(buildCount(root), 1);
    write(path.join(root, names[0], 'BuildProfile.ets'), profile.replace("'default'", "'other'"));
    assert.strictEqual(app(root).reused, false);
    assert.strictEqual(buildCount(root), 2);
  }) },
  { name: '正式构建仅跳过标准模块目标内与 SDK 原件相同的 UT staging 文件', run: () => fixture((root, install) => {
    pair(root);
    write(path.join(root, 'hvigorfile.ts'), "import { appTasks } from '@ohos/hvigor-ohos-plugin';\nexport default {system: appTasks, plugins: []}");
    write(path.join(root, 'entry/hvigorfile.ts'), "import { hapTasks } from '@ohos/hvigor-ohos-plugin';\nexport default {system: hapTasks, plugins: []}");
    const templateRoot = path.join(install, 'tools/hvigor/hvigor-ohos-plugin/node_modules/@ohos/coverage/res/template');
    const templates = {
      'ets/testability/TestAbility.ets': 'TestAbility_withKit.ets',
      'ets/testability/pages/Index.ets': 'Index.ets',
      'ets/testrunner/OpenHarmonyTestRunner.ets': 'OpenHarmonyTestRunner_mock.ets',
      'resources/base/element/color.json': 'resources/base/element/color.json',
      'resources/base/element/string.json': 'resources/base/element/string.json',
      'resources/base/profile/test_pages.json': 'resources/base/profile/test_pages.json',
    };
    const stage = 'entry/.test/default/intermediates/src/ohosTest';
    for (const [staged, template] of Object.entries(templates)) write(path.join(templateRoot, template), `SDK fixture ${staged}`);
    assert(app(root).hapPath);
    for (const [staged, template] of Object.entries(templates)) write(path.join(root, stage, staged), fs.readFileSync(path.join(templateRoot, template), 'utf8'));
    assert.equal(app(root).reused, true);
    assert.equal(buildCount(root), 1);
    const reportDir = featurePhaseReportsDir(root, 'demo', 'testing', frameworkRoot);
    const eligible = () => evaluateDeviceTestBuildReuse({ projectRoot: root, reportDir, product: 'demo' }).reuse;
    for (const impostor of ['entry/.test/other/intermediates/src/ohosTest/ets/testability/TestAbility.ets',
      'entry/src/.test/default/intermediates/src/ohosTest/ets/testability/TestAbility.ets', `${stage}/ets/Extra.ets`, 'entry/.cxx/input.c']) {
      const file = path.join(root, impostor);
      write(file, 'SDK fixture ets/testability/TestAbility.ets');
      assert.equal(eligible(), false, impostor);
      fs.unlinkSync(file);
      assert.equal(eligible(), true, impostor);
    }
    write(path.join(root, stage, 'ets/testability/TestAbility.ets'), 'handwritten at the expected path');
    assert.equal(eligible(), false);
  }) },
  { name: '真实资源字节变动保留 mtime 时显式禁用 Hvigor 增量，并防止 extraArgs 重新启用', run: () => fixture(root => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    config.toolchain.hvigor.coding.extraArgs = ['--incremental'];
    write(path.join(root, 'framework.config.json'), JSON.stringify(config)); clearFrameworkConfigCache();
    pair(root);
    const asset = path.join(root, 'entry/src/main/resources/rawfile/value.txt');
    write(asset, 'A fixture resource');
    assert(app(root).hapPath);
    assert.equal(app(root).reused, true);
    assert.equal(buildCount(root), 1);
    const before = fs.statSync(asset);
    write(asset, 'B fixture resource');
    fs.utimesSync(asset, before.atime, before.mtime);
    const rebuilt = app(root);
    assert(rebuilt.hapPath && !rebuilt.reused);
    assert.equal(buildCount(root), 2);
    const actual = calls(root).at(-1)!;
    assert(actual.includes('--no-incremental') && !actual.includes('--incremental'));
    assert.equal(app(root).reused, true);
    assert.equal(buildCount(root), 2);
  }) },
  { name: '所选 product 无包不跨 product；支持 outputs/default 和自定义 target', run: () => fixture(root => {
    pair(root, 'other'); assert.strictEqual(app(root).hapPath, null);
    assert.strictEqual(discoverAppHapArtifacts(root, 'demo').signedPath, null);
    const target = pair(root, 'demo', 'phoneTarget'); assert.strictEqual(app(root).hapPath, target);
    const ut = pair(root, 'other', 'ohosTest'); assert(ut);
    assert.strictEqual(discoverOhosTestArtifacts(root, 'entry', 'entry', 'demo').signedPath, null);
  }) },
  { name: '非零/超时不能借有效包通过，非致命 ERROR 不单独否决真实成功', run: () => fixture(root => {
    pair(root); write(path.join(root, 'scenario.json'), '{"exit":2}');
    const failure = app(root); assert.strictEqual(failure.hapPath, null);
    assert(!failure.hvigor.diagnostics?.some(line => line.includes('摘要读取失败')));
    write(path.join(root, 'scenario.json'), '{}'); const success = app(root);
    assert(success.hvigor.errors.length > 0 && success.hapPath);
    assert.strictEqual(isHvigorBuildSuccessful({ ...success.hvigor, timedOut: true }), false);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    config.toolchain.hvigor.timeoutMs = 100;
    write(path.join(root, 'framework.config.json'), JSON.stringify(config)); clearFrameworkConfigCache();
    write(path.join(root, 'scenario.json'), '{"sleep":1000}');
    const timeout = app(root); assert.strictEqual(timeout.hvigor.timedOut, true); assert.strictEqual(timeout.hapPath, null);
  }) },
  { name: '主应用 no-daemon 保留 incremental；UT 与纯编译的配置/goal 策略不变', run: () => fixture(root => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    config.toolchain.hvigor.coding.extraArgs = ['--daemon'];
    write(path.join(root, 'framework.config.json'), JSON.stringify(config)); clearFrameworkConfigCache();
    const result = app(root); const actual = calls(root)[0];
    assert(actual.includes('--no-daemon') && actual.includes('--incremental') && !actual.includes('--stop-daemon') && !actual.includes('--daemon'));
    const meta = JSON.parse(fs.readFileSync(path.resolve(result.hvigor.metaPath!), 'utf8'));
    assert(!('daemonStoppedBeforeBuild' in meta)); assert.deepStrictEqual(meta.daemonArgs, ['--no-daemon']);
    assert(buildUtHvigorArgs(root, 'entry', 'assembleHap', 'demo').includes('--daemon'));
    assert(buildCodingHvigorArgs(root, { product: 'demo' }).includes('--daemon'));
    process.env.MAISON_GOAL_RUNNER = '1';
    assert(buildUtHvigorArgs(root, 'entry', 'assembleHap', 'demo').includes('--no-daemon'));
    assert(buildUtHvigorArgs(root, 'entry', 'assembleHap', 'demo').includes('--incremental'));
  }) },
  { name: '设备安装的冻结维度在 extraArgs 后真实生效，普通 coding 仍允许配置覆盖', run: () => fixture(root => {
    pair(root); pair(root, 'other'); process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '1';
    const lastValue = (args: string[], key: string) => args.filter(arg => arg.startsWith(`${key}=`)).at(-1);
    for (const driver of ['node_hvigorw_js', 'assemble_app_project']) {
      const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
      config.toolchain.hvigor.coding = { driver, extraArgs: ['-p', 'product=other', '-p', 'buildMode=release'] };
      write(path.join(root, 'framework.config.json'), JSON.stringify(config)); clearFrameworkConfigCache();
      const packaged = app(root, { buildMode: 'debug' }); const installedArgs = calls(root).at(-1)!;
      assert.strictEqual(lastValue(installedArgs, 'product'), 'product=demo');
      assert.strictEqual(lastValue(installedArgs, 'buildMode'), 'buildMode=debug');
      assert(packaged.hapPath); assert.strictEqual(packaged.resolvedBuildMode, 'debug');
      const summary = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, 'demo', 'testing', frameworkRoot), 'device-test-build.result.json'), 'utf8'));
      assert.strictEqual(summary.resolvedProduct, 'demo'); assert.strictEqual(summary.resolvedBuildMode, 'debug');
      const compiled = runHvigorAssembleApp({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'coding-config', phase: 'coding', product: 'demo', buildMode: 'debug' });
      assert(isHvigorBuildSuccessful(compiled)); const codingArgs = calls(root).at(-1)!;
      assert.strictEqual(lastValue(codingArgs, 'product'), 'product=other');
      assert.strictEqual(lastValue(codingArgs, 'buildMode'), 'buildMode=release');
    }
  }) },
  { name: '人工 ensure 只以本次真实探针重置；工具缺失/启动失败不能复用磁盘旧成功', run: () => fixture((root, install) => {
    const localFile = path.join(root, 'framework.local.json');
    const failedCapability = () => recordHvigorBuildOutcome(root, { kind: 'capability_failed', fingerprint: 'fixture', failure_code: 'sdk_component_missing', evidence: ['fixture'] });
    const local = () => JSON.parse(fs.readFileSync(localFile, 'utf8'));
    const script = path.join(install, 'tools/hvigor/bin/hvigorw.js');
    failedCapability(); assert.strictEqual(runEnsureHumanReprobe(root).reset, true);
    assert.strictEqual(calls(root).filter(args => args.includes('--version')).length, 1);
    assert.strictEqual(local().toolchain.probe.binary.hvigor_bin, script);
    assert.strictEqual(local().toolchain.probe.project_compile.status, 'unknown');
    failedCapability(); write(script, 'invalid JavaScript !!!');
    assert.strictEqual(runEnsureHumanReprobe(root).reset, false);
    assert.strictEqual(local().toolchain.probe.cli_starts.ok, false);
    assert(local().toolchain.probe.cli_starts.error && local().toolchain.probe.cli_starts.command.includes('hvigorw.js'));
    assert.strictEqual(local().toolchain.probe.project_compile.status, 'capability_failed');
    const old = local(); old.toolchain.probe.cli_starts = { ok: true, observed_at: '2000-01-01' }; write(localFile, JSON.stringify(old));
    fs.unlinkSync(script); fs.unlinkSync(path.join(install, 'tools/hvigor/bin', process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw'));
    process.env.Path = ''; process.env.PATH = '';
    assert.strictEqual(runEnsureHumanReprobe(root).reset, false);
    assert.strictEqual(local().toolchain.probe.cli_starts.ok, false);
    assert(local().toolchain.probe.cli_starts.error.includes('未找到 hvigor'));
    assert.strictEqual(local().toolchain.probe.binary.hvigor_bin, undefined);
    assert.strictEqual(local().toolchain.probe.project_compile.status, 'capability_failed');
    const cached = local(); cached.toolchain.probe.cli_starts.ok = true; write(localFile, JSON.stringify(cached));
    const probeModule = require('../../toolchain-probe') as typeof import('../../toolchain-probe');
    const record = probeModule.recordBinaryAndCliStartsProbe;
    probeModule.recordBinaryAndCliStartsProbe = () => {}; // 模拟本轮记录未能写盘，旧成功仍在
    try { assert.strictEqual(runEnsureHumanReprobe(root).reset, false); }
    finally { probeModule.recordBinaryAndCliStartsProbe = record; }
    assert.strictEqual(local().toolchain.probe.project_compile.status, 'capability_failed');
  }) },
  { name: '探针/构建在含空格 Node 及显式 wrapper 配置下真实启动同一入口，保留失败事实', run: () => fixture((root, install) => {
    const probe = runHvigorVersionProbe(root); assert(probe.ok, JSON.stringify(probe)); assert('invocationDriver' in probe);
    const build = runHvigorAssembleApp({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'pure', phase: 'coding', product: 'demo' });
    assert(isHvigorBuildSuccessful(build)); assert.strictEqual(probe.invocationDriver, build.invocationDriver);
    assert.deepStrictEqual(probe.environment, build.environment);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    config.toolchain.hvigor.coding.driver = 'hvigorw_wrapper'; write(path.join(root, 'framework.config.json'), JSON.stringify(config)); clearFrameworkConfigCache();
    const wrapperProbe = runHvigorVersionProbe(root); assert(wrapperProbe.ok, JSON.stringify(wrapperProbe)); assert('invocationDriver' in wrapperProbe);
    const wrapperBuild = runHvigorAssembleApp({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'pure', phase: 'coding', product: 'demo' });
    assert(isHvigorBuildSuccessful(wrapperBuild)); assert.strictEqual(wrapperProbe.invocationDriver, wrapperBuild.invocationDriver);
    const wrapperMeta = JSON.parse(fs.readFileSync(path.resolve(wrapperBuild.metaPath!), 'utf8'));
    assert.deepStrictEqual(wrapperMeta.daemonArgs, ['--daemon']);
    assert(wrapperMeta.args.includes('product=demo'));
    recordBinaryAndCliStartsProbe(root, path.join(install, 'tools/hvigor/bin/hvigorw.bat'), () => ({ ...wrapperProbe, ok: false, error: 'fixture startup failure' }));
    const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf8'));
    assert.strictEqual(local.toolchain.probe.cli_starts.error, 'fixture startup failure');
    assert.strictEqual(local.toolchain.probe.project_compile.status, 'verified');
  }) },
  { name: '有效旧 JAVA_HOME 与 JBR PATH 分别保留/披露，失效 JAVA_HOME 回退且不泄漏信任锚', run: () => fixture((root, install) => {
    const oldHome = path.join(root, 'old JDK'); const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
    write(path.join(oldHome, 'bin', javaName), 'fixture'); process.env.JAVA_HOME = oldHome;
    process.env.MAISON_HMAC_KEY = 'private-fixture';
    const env = buildChildEnv(root); const facts = describeHvigorEnvironment(env, root);
    assert.strictEqual(env.JAVA_HOME, oldHome); assert.strictEqual(facts.pathJava, path.join(install, 'jbr/bin', javaName));
    assert.strictEqual(env.MAISON_HMAC_KEY, undefined);
    process.env.JAVA_HOME = path.join(root, 'missing'); assert.strictEqual(buildChildEnv(root).JAVA_HOME, path.join(install, 'jbr'));
    assert.strictEqual(describeHvigorEnvironment({ PATH: '', Path: '' }, root).pathJavaSource, 'unknown');
  }) },
  { name: 'UT 拒绝陈旧/错 basename 配对，生产 runHvigorTest 与直接 runOnDeviceUt 均不触发设备', run: () => fixture(root => {
    const signed = pair(root, 'demo', 'ohosTest', 'stale', 'entry-ohosTest');
    const build = runHvigorBuild({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'utcase', phase: 'ut', moduleName: 'entry', target: 'ohosTest', product: 'demo' });
    const result = runHvigorTest({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'utcase', phase: 'ut', moduleName: 'entry', moduleSrcPath: 'entry', product: 'demo', prebuild: build });
    assert.strictEqual(buildCount(root), 1); assert.strictEqual(result.onDeviceFailureEvidence?.artifactValidation?.status, 'stale');
    assert(result.logExcerpt.includes(signed) && result.logExcerpt.includes('hvigor-ut-build.entry.log'));
    fs.unlinkSync(signed.replace('-signed.hap', '-unsigned.hap'));
    write(path.join(path.dirname(signed), 'other-unsigned.hap'), 'different basename');
    const direct = runOnDeviceUt({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'direct', phase: 'ut', srcModuleName: 'entry', srcPath: 'entry', buildProduct: 'demo' });
    assert.strictEqual(direct.failedAt, 'hap_not_found'); assert.strictEqual(direct.artifactValidation?.status, 'unknown'); assert(!direct.install);
    const diag = buildUtHvigorTestFailDetails([{ module: 'entry', result }]);
    const disposition = resolveCurrentDisposition({ endpoint: 'request', phases: [{ phase: 'ut', verdict: 'FAIL', schemaCurrent: true, closureCommitted: false,
      checks: [{ id: 'ut_hvigor_test', status: 'FAIL', severity: 'BLOCKER', failure_kind: diag.failureKind, blocking_class: diag.blockingClass, details: diag.lines.join('\n') }] }] });
    assert(disposition.completionBlocking.some(problem => problem.id === 'ut_hvigor_test' && problem.action === 'repair'));
  }) },
  { name: 'UT 执行结果复用也核对当前配对和同调用摘要，不绕过安装前验证', run: () => fixture(root => {
    const signed = pair(root, 'demo', 'ohosTest', 'valid', 'entry-ohosTest');
    const build = runHvigorBuild({ projectRoot: root, frameworkRoot, harnessRoot, feature: 'utreuse', phase: 'ut', moduleName: 'entry', target: 'ohosTest', product: 'demo' });
    const key = utBuildCollectorKey(root, 'entry', 'demo')!;
    const builds = new Map<string, unknown>([[key, build]]);
    const ctx = { projectRoot: root } as never;
    const modules = [{ name: 'entry', package_path: 'entry' }];
    assert.strictEqual(evaluateUtReuseEligibility(ctx, modules, 'demo', builds).eligible, true);
    fs.writeFileSync(signed, 'IDE overwrite');
    assert.strictEqual(evaluateUtReuseEligibility(ctx, modules, 'demo', builds).eligible, false);
    pair(root, 'demo', 'ohosTest', 'stale', 'entry-ohosTest');
    assert.strictEqual(evaluateUtReuseEligibility(ctx, modules, 'demo', builds).eligible, false);
  }) },
];
export function runAll() {
  return cases.map(test => { const endUnitCase = beginUnitCase(test.name);
                             if (!endUnitCase) return discoveryResult(test.name); try { test.run(); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; } finally { endUnitCase(); } });
}
