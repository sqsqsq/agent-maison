import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { runCompile } from '../../scripts/compile';
import { clearFrameworkConfigCache, statefilePath } from '../../config';
import { runAdhocCorrection } from '../../scripts/utils/correction-commands';
import { buildCorrectionState, writeCorrectionState } from '../../scripts/utils/correction-state';

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
    name: 'C1/C3 无 Feature、Git、diff 仍执行工程构建并派生 DevEco 环境；两次请求都运行',
    run(root) {
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
    run(root) {
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
    run(root) {
      fs.writeFileSync(path.join(root, 'mode.txt'), 'retry');
      const result = compile(root);
      assert(result.checks.every(check => check.status === 'PASS'), JSON.stringify(result.checks));
      assert.strictEqual(fs.readFileSync(path.join(root, 'calls.txt'), 'utf8'), '2');
      assert(result.execution?.command?.includes('--no-daemon'));
    },
  },
  {
    name: 'C4 非法报告目录在构建前拒绝；链接不能绕过宿主边界',
    run(root) {
      for (const report of ['../outside', '.git/reports', 'doc/features/borrowed/reports']) assert.throws(() => compile(root, report), /report-dir|project-root|outside project/);
      const link = path.join(root, 'framework');
      fs.symlinkSync(FRAMEWORK_ROOT, link, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => compile(root, 'framework/harness/reports'), /report-dir|outside project/);
      assert(!fs.existsSync(path.join(root, 'calls.txt')));
    },
  },
  {
    name: 'C2 generic 不支持编译时明确未执行',
    run(root) {
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
    run(root) {
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
