import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { runCompile } from '../../scripts/compile';
import { clearFrameworkConfigCache, enumerateFeatures, statefilePath } from '../../config';
import { runAdhocCorrection } from '../../scripts/utils/correction-commands';
import { buildCorrectionState, writeCorrectionState } from '../../scripts/utils/correction-state';
import { provisionFrameworkUnder } from '../utils/real-chain-host';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const HARNESS_ROOT = path.join(FRAMEWORK_ROOT, 'harness');

function fixture(mode = 'pass'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-compile-'));
  const ide = path.join(root, 'ide');
  const node = path.join(ide, 'tools/node', path.basename(process.execPath));
  const driver = path.join(ide, 'tools/hvigor/bin/hvigorw.js');
  for (const dir of [path.dirname(node), path.dirname(driver), path.join(ide, 'sdk'), path.join(root, 'entry')]) fs.mkdirSync(dir, { recursive: true });
  try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
  fs.writeFileSync(driver, `const fs=require('fs'),path=require('path');
const root=process.cwd(),file=path.join(root,'calls.txt');
const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8'))+1:1;fs.writeFileSync(file,String(count));
const mode=fs.readFileSync(path.join(root,'mode.txt'),'utf8');
if(mode==='diagnostics'){console.log(fs.readFileSync(path.join(root,'native-errors.txt'),'utf8'));process.exit(1);}
if(mode==='fail'){console.log('ERROR: fixture compile failure');process.exit(1);}
if(mode==='retry'&&count===1){console.log('> hvigor ERROR: 00303149 Configuration Error\\nError Message: path is invalid\\nAt file: '+path.join(root,'entry'));process.exit(1);}
if(mode!=='incomplete') console.log('BUILD SUCCESSFUL in 1 s');
`);
  fs.writeFileSync(path.join(root, 'mode.txt'), mode);
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0', project_name: 'compile-fixture', project_profile: { name: 'hmos-app' },
    toolchain: { preferredProduct: 'default' }, paths: { features_dir: 'doc/features' },
    architecture: { outer_layers: [{ id: 'entry', can_depend_on: [], intra_layer_deps: 'forbid' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' },
  }));
  fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', toolchain: { devEcoStudio: { installPath: ide, hvigorBin: driver } } }));
  fs.writeFileSync(path.join(root, 'build-profile.json5'), JSON.stringify({ app: { products: [{ name: 'default' }] }, modules: [{ name: 'entry', srcPath: './entry' }] }));
  clearFrameworkConfigCache();
  return root;
}

function compile(root: string, reportDir?: string) {
  return runCompile({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, reportDir });
}

const cases: Array<{ name: string; run(root: string): void | Promise<void> }> = [
  {
    name: 'P2 native compiler objects survive real producers writers and reader while line noise and missing identity do not fake progress',
    async run(root) {
      const gc = require('../../scripts/utils/goal-failure-classifier') as typeof import('../../scripts/utils/goal-failure-classifier');
      const { generateScriptReport } = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
      const { writeRunSummaryBase } = require('../../harness-runner') as typeof import('../../harness-runner');
      const { readCurrentDispositionInput } = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
      const { resolveCurrentDisposition } = require('../../scripts/utils/check-disposition') as typeof import('../../scripts/utils/check-disposition');
      const { featurePhaseReportsDir } = require('../../config') as typeof import('../../config');
      const { runUtGateInPlace } = require('./ut-module-selection.unit.test') as typeof import('./ut-module-selection.unit.test');
      const source = 'entry/src/main/ets/Calc.ets', absolute = path.join(root, source), feature = 'compiler-object';
      fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, 'export const missingFirst = true;\n');
      fs.writeFileSync(path.join(root, 'mode.txt'), 'diagnostics');
      const firstMessage = "Property 'firstValue' does not exist on type 'Ledger'.";
      const secondMessage = "Property 'secondValue' does not exist on type 'Ledger'.";
      const nativeLine = (line: number, message: string) => `${source}(${line},3): error TS2339: ${message}`;
      const round = (log: string) => {
        fs.writeFileSync(path.join(root, 'native-errors.txt'), log);
        const result = compile(root);
        assert(result.execution?.executed && result.execution.exitCode !== 0);
        const native = result.execution as typeof result.execution & { errors: Array<{ file?: string; line?: number; code?: string; message: string }> };
        assert(native.errors.length > 0 && result.checks.every(check => check.status === 'FAIL'));
        for (const check of result.checks) assert.deepStrictEqual((check.structured as { compiler_diagnostics: unknown }).compiler_diagnostics, native.errors,
          'the producer must preserve every native diagnostic field, not just its first display line');
        const report = generateScriptReport('', 'coding', feature, root, result.checks, FRAMEWORK_ROOT);
        const summary = writeRunSummaryBase(root, report, FRAMEWORK_ROOT);
        const disk = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'coding', FRAMEWORK_ROOT), 'script-report.json'), 'utf8')) as typeof report;
        assert.deepStrictEqual(disk.checks.map(check => check.structured), result.checks.map(check => check.structured));
        const input = readCurrentDispositionInput({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature, chain: ['coding'], endpoint: 'request',
          currentResults: [{ phase: 'coding', summary, checks: disk.checks }] });
        const disposition = resolveCurrentDisposition(input);
        assert(disposition.completionBlocking.length && disposition.completionBlocking.every(problem => problem.action === 'repair'), JSON.stringify(disposition));
        return { result, disposition, evaluation: { acceptanceKey: 'current-native-compile', inputs: gc.snapshotArtifacts(root, [source]),
          disposition, completed: true, checkFamilies: ['coding'] } };
      };
      const first = round(nativeLine(1, firstMessage));
      assert(first.disposition.completionBlocking.every(problem => problem.evidence?.some(ref => ref.startsWith('compiler:'))), 'the real reader must project native object refs');
      fs.writeFileSync(absolute, 'export const firstValue = true;\nexport const missingSecond = true;\n');
      const second = round(nativeLine(2, secondMessage));
      assert.notDeepStrictEqual(first.disposition.completionBlocking.map(problem => problem.evidence), second.disposition.completionBlocking.map(problem => problem.evidence));
      assert(!gc.evaluateCompletionProgress({ previous: first.evaluation, current: second.evaluation, feedbackDelivered: true }).halt,
        'a different verified suberror in the same file cannot be reduced to the compile check ID');
      fs.writeFileSync(absolute, '\nexport const firstValue = true;\nexport const missingSecond = true;\n');
      const relocated = round(nativeLine(3, secondMessage));
      assert.deepStrictEqual(second.disposition.completionBlocking.map(problem => problem.evidence), relocated.disposition.completionBlocking.map(problem => problem.evidence));
      assert(relocated.result.checks.every(check => check.details.includes(':3') && check.details.includes(secondMessage)), 'display line/message must remain native');
      assert(gc.evaluateCompletionProgress({ previous: second.evaluation, current: relocated.evaluation, feedbackDelivered: true }).halt,
        'line and report path changes cannot pretend to improve the same native error object');
      fs.appendFileSync(absolute, '// actual edit with an ambiguous compiler result\n');
      const missing = round('ERROR: opaque native compiler failure');
      assert.deepStrictEqual(gc.nativeCompileDiagnosticRefs(missing.result.checks[0], root), []);
      assert(!gc.evaluateCompletionProgress({ previous: relocated.evaluation, current: missing.evaluation, feedbackDelivered: true }).halt, 'missing native objects must remain unknown');
      const duplicate = round([nativeLine(3, secondMessage), nativeLine(4, secondMessage)].join('\n'));
      assert.deepStrictEqual(gc.nativeCompileDiagnosticRefs(duplicate.result.checks[0], root), []);
      assert(!gc.evaluateCompletionProgress({ previous: relocated.evaluation, current: duplicate.evaluation, feedbackDelivered: true }).halt, 'duplicate objects cannot acquire line/index identities');
      assert.strictEqual(gc.nativeCompileDiagnosticRefs({ id: 'authoritative_content_aligned' }, root), undefined);
      fs.mkdirSync(path.join(root, 'entry/src/ohosTest/ets/test'), { recursive: true });
      fs.writeFileSync(path.join(root, 'entry/src/ohosTest/ets/test/List.test.ets'), '// current UT input\n');
      fs.writeFileSync(path.join(root, 'entry/src/main/module.json5'), JSON.stringify({ module: { name: 'entry', type: 'har' } }));
      fs.writeFileSync(path.join(root, 'entry/src/ohosTest/module.json5'), JSON.stringify({ module: { name: 'entry_test', type: 'feature' } }));
      const ut = await runUtGateInPlace(root, feature, [{ name: 'entry', package_path: 'entry' }], { buildFailModules: ['entry'], buildFailLog: nativeLine(3, secondMessage) });
      const utFailure = ut.find(check => check.id === 'ut_hvigor_build')!;
      assert(utFailure?.status === 'FAIL' && utFailure.details.includes(secondMessage), JSON.stringify(ut));
      assert.deepStrictEqual((utFailure.structured as { compiler_diagnostics: unknown }).compiler_diagnostics,
        [{ file: source, line: 3, code: 'TS2339', message: secondMessage }]);
      assert.deepStrictEqual(gc.nativeCompileDiagnosticRefs(utFailure, root), gc.nativeCompileDiagnosticRefs(relocated.result.checks[0], root));
      assert(utFailure.affected_files?.includes(source) && utFailure.affected_files.includes('entry/src/ohosTest'), 'the original affected-files contract must be retained');
    },
  },
  {
    name: 'P3 project compile enumerates a blueprint workspace with root records and a real CU while an empty design root stays a container',
    async run(root) {
      const put = (relative: string, text: string): void => {
        const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
      };
      put('doc/features/orders/blueprint/component-blueprint.yaml', 'artifact: component-blueprint@1\nblueprint_id: orders\n');
      put('doc/features/orders/open/change-unit.yaml', 'artifact: change-unit@1\nblueprint_id: orders\nchange_unit_id: open\n');
      put('doc/features/orders/goal-runs/root/manifest.json', JSON.stringify({ initial_design: {}, run_id: 'root' }));
      put('doc/features/draft/goal-runs/root/manifest.json', JSON.stringify({ initial_design: {}, run_id: 'root' }));
      const entries = enumerateFeatures(root);
      assert.strictEqual(entries.length, 1, JSON.stringify(entries));
      assert.strictEqual(entries[0].relativePath, 'orders/open');
      assert.strictEqual(entries[0].kind, 'cu');
      const cli = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', 'scripts/compile.ts',
        '--project-root', root, '--json'], { cwd: HARNESS_ROOT, encoding: 'utf8', timeout: 30000 });
      assert.strictEqual(cli.status, 0, cli.stderr + cli.stdout);
      const result = JSON.parse(cli.stdout);
      assert.strictEqual(result.status, 'PASS'); assert.strictEqual(result.executed, true);
      assert.strictEqual(fs.readFileSync(path.join(root, 'calls.txt'), 'utf8'), '1');
      assert(fs.existsSync(path.resolve(HARNESS_ROOT, result.logPath)));
    },
  },
  {
    name: 'P3 project compile retains real workspace mixed products and orphan construction failures before running a provider',
    async run(root) {
      const workspace = path.join(root, 'doc/features/orders');
      fs.mkdirSync(path.join(workspace, 'blueprint'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'blueprint/component-blueprint.yaml'), 'blueprint_id: orders\n');
      fs.mkdirSync(path.join(workspace, 'goal-runs/root'), { recursive: true });
      const rejected = (message: RegExp): void => {
        const cli = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', 'scripts/compile.ts',
          '--project-root', root, '--json'], { cwd: HARNESS_ROOT, encoding: 'utf8', timeout: 30000 });
        assert.strictEqual(cli.status, 1, cli.stderr + cli.stdout);
        const result = JSON.parse(cli.stdout); assert.strictEqual(result.executed, false); assert.match(result.message, message);
        assert(!fs.existsSync(path.join(root, 'calls.txt')), 'enumeration failure must not be hidden behind a fake compile result');
      };
      fs.mkdirSync(path.join(workspace, 'spec')); fs.writeFileSync(path.join(workspace, 'spec/spec.md'), '# actual flat product\n');
      rejected(/歧义/);
      fs.rmSync(path.join(workspace, 'spec'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'orphan/spec'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'orphan/spec/spec.md'), '# actual orphan product\n');
      rejected(/孤儿 Feature/);
    },
  },
  {
    name: 'C1/C3 无 Feature、Git、diff 仍执行工程构建并派生 DevEco 环境；两次请求都运行',
    async run(root) {
      const before = JSON.stringify({ feature: 'old-completed', phase: 'coding' });
      fs.mkdirSync(path.dirname(statefilePath(root)), { recursive: true });
      fs.writeFileSync(statefilePath(root), before);
      const result = compile(root);
      assert(result.execution?.executed);
      assert(result.checks.every(check => check.status === 'PASS'));
      const meta = JSON.parse(fs.readFileSync(path.resolve(result.execution!.metaPath!), 'utf8'));
      assert.strictEqual(meta.envProbe.DEVECO_SDK_HOME_PATH, path.join(root, 'ide/sdk'));
      assert(meta.command.includes('assembleHap'));
      assert.strictEqual(meta.cwd, root);
      compile(root);
      assert.strictEqual(fs.readFileSync(path.join(root, 'calls.txt'), 'utf8'), '2');
      assert.strictEqual(fs.readFileSync(statefilePath(root), 'utf8'), before);
      assert(!fs.existsSync(path.join(root, 'doc/features')));
      assert(!fs.existsSync(path.join(root, '.current-correction.json')));
      assert(result.reportDir.startsWith(path.join(root, 'doc/reports/compile')));
    },
  },
  {
    name: 'C2 真实失败与缺成功标记不能签发编译通过',
    async run(root) {
      for (const mode of ['fail', 'incomplete']) {
        fs.writeFileSync(path.join(root, 'mode.txt'), mode);
        const result = compile(root);
        assert(result.execution?.executed);
        assert(result.checks.every(check => check.status === 'FAIL'));
        assert(fs.existsSync(path.resolve(result.execution!.logPath!)));
      }
    },
  },
  {
    name: 'C3 工程环境矛盾复用已有一次事务重跑',
    async run(root) {
      fs.writeFileSync(path.join(root, 'mode.txt'), 'retry');
      const result = compile(root);
      assert(result.checks.every(check => check.status === 'PASS'), JSON.stringify(result.checks));
      assert.strictEqual(fs.readFileSync(path.join(root, 'calls.txt'), 'utf8'), '2');
      assert(result.execution?.command?.includes('--no-daemon'));
    },
  },
  {
    name: 'C4 非法报告目录在构建前拒绝；链接不能绕过宿主边界',
    async run(root) {
      for (const report of ['../outside', '.git/reports', 'doc/features/borrowed/reports']) assert.throws(() => compile(root, report), /report-dir|project-root|outside project/);
      const link = path.join(root, 'framework');
      fs.symlinkSync(FRAMEWORK_ROOT, link, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => compile(root, 'framework/harness/reports'), /report-dir|outside project/);
      assert(!fs.existsSync(path.join(root, 'calls.txt')));
    },
  },
  {
    name: 'C2 generic 不支持编译时明确未执行',
    async run(root) {
      const file = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      config.project_profile = { name: 'generic' };
      fs.writeFileSync(file, JSON.stringify(config)); clearFrameworkConfigCache();
      assert.throws(() => compile(root), /本次未执行编译/);
      assert(!fs.existsSync(path.join(root, 'calls.txt')));
    },
  },
  {
    name: 'C1 CLI 从 harness cwd 执行并返回真实 JSON，拒绝模块编译参数',
    async run(root) {
      const args = [require.resolve('ts-node/dist/bin.js'), '--transpile-only', 'scripts/compile.ts', '--project-root', root, '--json'];
      const result = spawnSync(process.execPath, args, { cwd: HARNESS_ROOT, encoding: 'utf8', timeout: 30000 });
      assert.strictEqual(result.status, 0, result.stderr + result.stdout);
      const summary = JSON.parse(result.stdout);
      assert.strictEqual(summary.status, 'PASS'); assert.strictEqual(summary.executed, true);
      assert(fs.existsSync(path.resolve(HARNESS_ROOT, summary.logPath)));
      const rejected = spawnSync(process.execPath, [...args, '--module', 'entry'], { cwd: HARNESS_ROOT, encoding: 'utf8', timeout: 30000 });
      assert.strictEqual(rejected.status, 1); assert.strictEqual(JSON.parse(rejected.stdout).executed, false);
    },
  },
  {
    name: 'adhoc 公共入口分析跨模块和已提交候选，精确报告架构未证实与实际违规',
    run(root) {
      const write = (file: string, contents: string) => {
        const absolute = path.join(root, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, contents);
      };
      const configFile = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      config.paths.state_file = '.fixture-state/current-phase.json';
      config.architecture.outer_layers = [
        { id: 'entry', can_depend_on: ['common'], intra_layer_deps: 'forbid' },
        { id: 'common', can_depend_on: [], intra_layer_deps: 'forbid' },
      ];
      fs.writeFileSync(configFile, JSON.stringify(config));
      const product = 'entry/Search/index.ets', helper = 'common/Filter/index.ets';
      write(product, 'import { filter } from "../../common/Filter/index.ets"; export const value = filter(1);');
      write(helper, 'export const filter = (x: number) => x;');
      write('doc/module-catalog.yaml', [
        'schema_version: "1.0"', 'modules:',
        `  - { name: Search, layer: entry, entry_file: "${product}" }`,
        `  - { name: Filter, layer: common, entry_file: "${helper}" }`, '',
      ].join('\n'));
      write('.gitignore', ['ide/', 'framework/', 'doc/reports/', 'calls.txt', '.fixture-state/', '*.log', ''].join('\n'));
      const { frameworkRoot: installedFramework } = provisionFrameworkUnder(root);
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
      git('init', '-q');
      git('add', '-A');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
      const cli = (...args: string[]) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only',
        path.join(HARNESS_ROOT, 'harness-runner.ts'), '--project-root', root, '--framework-root', installedFramework, ...args],
        { cwd: HARNESS_ROOT, encoding: 'utf8', timeout: 30_000 });
      const init = (request: string) => {
        const result = cli('--correction-init', '--correction-request', request, '--q-requirement', 'n', '--q-contract', 'n', '--q-code', 'y');
        assert.equal(result.status, 0, result.stdout + result.stderr);
      };
      const check = () => {
        const result = cli('--adhoc-correction');
        const reports = path.join(root, 'doc/reports/_adhoc');
        const last = fs.readdirSync(reports).sort().at(-1)!;
        const data = JSON.parse(fs.readFileSync(path.join(reports, last, 'correction-report.json'), 'utf8'));
        const architecture = data.results.find((check: { id: string }) => check.id === 'adhoc_architecture_rules');
        assert.equal(data.results.find((check: { id: string }) => check.id === 'adhoc_coding_compile')?.status, 'PASS');
        return { exit: result.status, verdict: data.verdict, architecture, output: result.stdout + result.stderr };
      };
      init('修正筛选行为');
      const empty = check();
      assert.equal(empty.exit, 1, empty.output);
      assert.equal(empty.verdict, 'INCOMPLETE');
      assert.equal(empty.architecture.status, 'SKIP');
      const parallel = 'common/Filter/Parallel.ets';
      write(product, 'import { filter } from "../../common/Filter/index.ets"; export const value = filter(2);');
      write(parallel, 'export const independent = true;');
      const concurrent = check();
      assert.equal(concurrent.exit, 0, concurrent.output);
      assert.deepEqual([...concurrent.architecture.affected_files].sort(), [parallel, product].sort());
      fs.unlinkSync(path.join(root, parallel));
      write(helper, 'export const filter = (x: number) => x + 1;');
      const cross = check();
      assert.equal(cross.exit, 0, cross.output);
      assert.deepEqual([...cross.architecture.affected_files].sort(), [helper, product].sort());
      git('add', '-A');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'actual correction');
      const status = git('status', '--porcelain');
      assert.equal(status, '', `fixture has no worktree delta after the correction commit: ${status}`);
      const committed = check();
      assert.equal(committed.exit, 0, committed.output);
      assert.deepEqual([...committed.architecture.affected_files].sort(), [helper, product].sort());

      write(parallel, 'import { value } from "../../entry/Search/index.ets"; export const bad = value;');
      const ambiguous = check();
      assert.equal(ambiguous.verdict, 'INCOMPLETE', ambiguous.output);
      assert.equal(ambiguous.architecture.status, 'SKIP');
      assert.deepEqual(ambiguous.architecture.affected_files, [parallel]);
      init(`修正 \`${product}\``);
      assert.equal(check().exit, 0, 'a proven independent change is outside this correction');
      init(`修正 \`${parallel}\``);
      const invalid = check();
      assert.equal(invalid.exit, 1, invalid.output);
      assert.equal(invalid.verdict, 'FAIL');
      assert.equal(invalid.architecture.status, 'FAIL');
      assert.deepEqual(invalid.architecture.affected_files, [parallel]);
    },
  },
  {
    name: 'C4 旧 adhoc 的真实编译不再依赖空 contracts，所有日志落在宿主',
    async run(root) {
      const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
      git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.com']);
      git(['add', 'mode.txt']); git(['commit', '-qm', 'baseline']);
      writeCorrectionState(root, buildCorrectionState({ feature: null, root_layer: 'coding', touched_layers: ['coding'], revalidate: [], base_commit: git(['rev-parse', 'HEAD']), request_text: 'check maintenance', enforcement_tier: 'soft_rule_only' }));
      await runAdhocCorrection(root, HARNESS_ROOT, FRAMEWORK_ROOT);
      const base = path.join(root, 'doc/reports/_adhoc');
      const reportDir = path.join(base, fs.readdirSync(base)[0]);
      const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'correction-report.json'), 'utf8'));
      assert.strictEqual(report.results.find((r: { id: string }) => r.id === 'adhoc_coding_compile').status, 'PASS');
      assert(fs.existsSync(path.join(reportDir, 'hvigor-build.log')));
      assert(!fs.existsSync(path.join(root, 'doc/features')));
    },
  },
];

export async function runAll() {
  const results = [];
  const keys = ['DEVECO_SDK_HOME', 'HARNESS_SKIP_HVIGOR', 'HARNESS_SKIP_DEPS_INSTALL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    for (const item of cases) {
      const root = fixture();
      try { await item.run(root); results.push({ name: item.name, ok: true }); }
      catch (error) { results.push({ name: item.name, ok: false, error: String((error as Error).stack ?? error) }); }
      finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
  return results;
}
