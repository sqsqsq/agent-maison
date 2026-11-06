// 受控短接线：真实入口函数、文件/zip身份和来源比较；耗时测试/工具命令在边界替身。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import { buildCandidate, promoteCandidate } from '../candidate-release.mjs';
import {
  collectReleaseFiles, loadReleaseExcludes, sanitizePackageJson, sanitizeHarnessPackageJson, stageReleaseFile,
} from '../release-pack-rules.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
const json = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);
const version = '9.9.9';
const reports = root => path.join(root, 'harness/reports/test-run');
const paths = root => ({ zip: path.join(root, `dist/candidates/framework-${version}-candidate.zip`), manifest: path.join(root, `dist/candidates/framework-${version}-candidate.manifest.json`) });

// 小型独立输入集，真实读取临时源文件；不调用耗时业务runner。
function snapshot(root) {
  const files = {};
  for (const file of fs.readdirSync(root, { recursive: true }).map(String).map(file => file.replace(/\\/g, '/')).sort()) {
    if (/^(?:dist|node_modules)\/|^harness\/(?:node_modules|reports)\//.test(file)) continue;
    if (fs.statSync(path.join(root, file)).isFile()) files[file] = hash(fs.readFileSync(path.join(root, file)));
  }
  const head = '0'.repeat(40);
  return { head, files, id: hash(JSON.stringify({ head, files })) };
}

function writeRun(root, scope, changes = {}) {
  const inputSnapshot = snapshot(root);
  const ids = scope === 'full' ? ['daily-sentinel', 'formal-sentinel'] : ['daily-sentinel'];
  const result = { scope, full: scope === 'full', ok: true, inputSnapshot, endingSnapshotId: inputSnapshot.id,
    plan: { scope, full: scope === 'full', selected: ids.map(id => ({ group: { id } })), reused: [] },
    groups: ids.map(id => ({ id, ok: true, status: 'completed' })), ...changes };
  json(path.join(reports(root), `${scope}.json`), result);
  if (scope === 'full') json(path.join(reports(root), 'results.json'), { completeRun: { snapshotId: inputSnapshot.id, ok: result.ok } });
  return result;
}

function stage(root, output) {
  const included = collectReleaseFiles(root, loadReleaseExcludes()).included;
  for (const file of included) stageReleaseFile(path.join(root, file), path.join(output, file), file);
  json(path.join(output, 'package.json'), sanitizePackageJson(readJson(path.join(root, 'package.json'))));
  json(path.join(output, 'harness/package.json'), sanitizeHarnessPackageJson(readJson(path.join(root, 'harness/package.json'))));
  const manifest = { schema_version: '1.0', version: readJson(path.join(root, 'package.json')).version,
    source_commit: '0'.repeat(40), built_at: new Date().toISOString(),
    files: included.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(output, file))) })) };
  json(path.join(output, 'RELEASE-MANIFEST.json'), manifest);
  const sha = hash(fs.readFileSync(path.join(output, 'RELEASE-MANIFEST.json')));
  write(path.join(output, 'RELEASE-MANIFEST.sha256'), `${sha}\n`);
  return { version: manifest.version, includedFiles: included, inZipManifest: { path: 'framework/RELEASE-MANIFEST.json', sha256: sha } };
}

async function fixture(options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-candidate-gates-')); roots.push(temp);
  const root = path.join(temp, 'source');
  json(path.join(root, 'package.json'), { name: 'fixture', version, scripts: { test: 'npm --prefix harness test', 'test:daily': 'development only' } });
  json(path.join(root, 'harness/package.json'), { scripts: { test: 'full', 'test:daily': 'daily', 'check:global': 'global', typecheck: 'tsc' } });
  write(path.join(root, 'README.md'), 'release text\r\n');
  write(path.join(root, 'src/value.ts'), 'export const value = 1;\n');
  write(path.join(root, 'harness/node_modules/ts-node/dist/bin.js'), '');
  write(path.join(root, 'harness/node_modules/typescript/bin/tsc'), '');
  const prepared = path.join(temp, 'prepared');
  const sidecar = stage(root, path.join(prepared, 'framework'));
  const zip = path.join(temp, 'prepared.zip');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zip), archive = archiver('zip');
    out.on('close', resolve); archive.on('error', reject); archive.pipe(out); archive.directory(path.join(prepared, 'framework'), 'framework'); void archive.finalize();
  });
  sidecar.sha256 = hash(fs.readFileSync(zip));
  const calls = [];
  const runCommand = (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    const source = path.basename(cwd) === 'harness' ? path.dirname(cwd) : cwd;
    if (cmd === 'git' && args[0] === 'branch') return 'fixture-branch\n';
    if (args.includes('-e')) return JSON.stringify(snapshot(source));
    if (args[1] === 'run' && args[2] === 'test:daily') { writeRun(source, 'daily', options.dailyResult); return; }
    if (args[1] === 'test') { if (options.onFull) options.onFull(source); else writeRun(source, 'full'); return; }
    if (args[0] === 'scripts/pack-release.mjs') {
      const out = args[args.indexOf('--out') + 1];
      if (args.includes('--stage-only')) { stage(source, path.join(out, 'release-staging/framework')); return; }
      fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(zip, path.join(out, `framework-${version}.zip`));
      json(path.join(out, `framework-${version}.manifest.json`), sidecar); return;
    }
    if (args[0] === 'scripts/verify-release-pack.mjs') {
      assert.equal(hash(fs.readFileSync(args[args.indexOf('--zip') + 1])), sidecar.sha256);
      if (options.verifyFail) throw new Error('controlled verify failure'); return;
    }
    if (args[0] === 'scripts/smoke-consumer-lifecycle.mjs') {
      assert.equal(hash(fs.readFileSync(args[args.indexOf('--zip') + 1])), sidecar.sha256);
      if (options.smokeFail) throw new Error('controlled smoke failure'); return;
    }
    if (args[0] === 'scripts/check-plan-version.mjs') {
      options.onPlan?.(source); if (options.planFail) throw new Error('controlled pending plan'); return;
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
  const golden = path.join(temp, 'golden.json');
  json(golden, { verdict: 'PASS', installed_manifest_sha256: sidecar.inZipManifest.sha256 });
  return { root, temp, calls, runCommand, golden, sidecar, options,
    build: () => buildCandidate({ root, runCommand }),
    promote: (extra = []) => promoteCandidate(['--evaluator-report', golden, ...extra], { root, runCommand }) };
}
const fullCalls = f => f.calls.filter(call => call.args[1] === 'test');
const planCalls = f => f.calls.filter(call => call.args[0] === 'scripts/check-plan-version.mjs');

test('来源快照子进程stderr可见且stdout仍为可读JSON', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-candidate-capture-')); roots.push(temp);
  const root = path.join(temp, 'source'), npm = path.join(temp, 'npm.cjs');
  json(path.join(root, 'package.json'), { version }); write(npm, '');
  write(path.join(root, 'harness/node_modules/typescript/bin/tsc'), '');
  write(path.join(root, 'harness/node_modules/ts-node/dist/bin.js'),
    'process.stderr.write("SOURCE_CAPTURE_STDERR\\n");process.stdout.write(JSON.stringify({id:"private-capture-id",head:"0",files:{}}));');
  const driver = path.join(temp, 'driver.mjs');
  const entry = new URL('../candidate-release.mjs', import.meta.url).href;
  write(driver, `import { buildCandidate } from ${JSON.stringify(entry)};try { buildCandidate({root:${JSON.stringify(root)}}); } catch(error) { console.error('EXPECTED_CAPTURE_STOP:'+error.message);process.exitCode=1; }`);
  const result = spawnSync(process.execPath, [driver], { encoding: 'utf8', env: { ...process.env, npm_execpath: npm } });
  assert.equal(result.status, 1, '受控入口在缺daily报告处结束，不运行pack');
  assert.match(result.stderr, /SOURCE_CAPTURE_STDERR/);
  assert.match(result.stderr, /EXPECTED_CAPTURE_STOP:.*daily\.json/, 'JSON已正确解析并推进到读取日常证明');
  assert.ok(!result.stdout.includes('private-capture-id'), '快照stdout仅用于JSON解析');
});

test('候选构建实际选择日常全集，verify与smoke消费同一zip，并保留待补正式门禁', async () => {
  const f = await fixture(); f.build();
  assert.deepEqual(f.calls[0].args.slice(1), ['run', 'test:daily']); assert.equal(fullCalls(f).length, 0);
  const manifest = readJson(paths(f.root).manifest);
  assert.equal(manifest.candidate.complete, true); assert.equal(manifest.candidate.daily_test.scope, 'daily');
  assert.deepEqual(manifest.candidate.skipped_gates, ['npm test (full)', 'check-plan-version --release']);
  assert.equal(f.calls.filter(call => call.args[0] === 'scripts/verify-release-pack.mjs').length, 1);
  assert.equal(f.calls.filter(call => call.args[0] === 'scripts/smoke-consumer-lifecycle.mjs').length, 1);
});

test('候选日常结果、verify或smoke真实失败都不能宣称构建完整', async t => {
  for (const options of [{ dailyResult: { ok: false } }, { verifyFail: true }, { smokeFail: true }]) await t.test(JSON.stringify(options), async () => {
    const f = await fixture(options); assert.throws(f.build);
    assert.ok(!fs.existsSync(paths(f.root).manifest) || readJson(paths(f.root).manifest).candidate.complete === false);
    assert.equal(fullCalls(f).length, 0);
  });
});

test('晋升缺正式证明时在匹配来源补一次full，之后移动同一字节fixture zip', async () => {
  const f = await fixture(); f.build(); await f.promote();
  assert.equal(fullCalls(f).length, 1); assert.equal(planCalls(f).length, 1);
  assert.equal(hash(fs.readFileSync(path.join(f.root, `dist/framework-${version}.zip`))), f.sidecar.sha256);
  assert.equal(f.calls.filter(call => call.args[0] === 'scripts/pack-release.mjs' && !call.args.includes('--stage-only')).length, 1, '晋升不可重打候选zip');
});

test('daily/changed/phase及只改full头的报告均不能升级；失败时不碰plan/eligible', async t => {
  for (const scope of ['daily', 'changed', 'phase', 'forged-full', 'full-failed']) await t.test(scope, async () => {
    const f = await fixture({ onFull: source => {
      if (scope === 'full-failed') { writeRun(source, 'full', { ok: false }); return; }
      const result = writeRun(source, 'daily');
      if (scope === 'forged-full') { result.scope = 'full'; result.full = true; result.plan.scope = 'full'; result.plan.full = true; }
      else result.scope = scope;
      json(path.join(reports(source), 'full.json'), result);
    } });
    f.build(); await assert.rejects(f.promote, /测试证明无效|completeRun/);
    assert.equal(fullCalls(f).length, 1); assert.equal(planCalls(f).length, 0);
    assert.equal(readJson(paths(f.root).manifest).candidate.status, 'built');
  });
});

test('相同发布内容允许dev-only输入变化，复用其真实full；仅plan失败才eligible', async () => {
  const f = await fixture({ planFail: true }); f.build();
  write(path.join(f.root, '.cursor/plan.md'), 'completed\n'); const full = writeRun(f.root, 'full');
  await assert.rejects(f.promote, /eligible/);
  const candidate = readJson(paths(f.root).manifest).candidate;
  assert.equal(candidate.status, 'eligible'); assert.equal(candidate.full_test.snapshot_id, full.inputSnapshot.id);
  assert.notEqual(candidate.full_test.snapshot_id, candidate.daily_test.snapshot_id); assert.equal(fullCalls(f).length, 0);
});

test('同HEAD的源码变化、增删发布文件和版本差异都在full之前拒绝', async t => {
  for (const change of ['content', 'extra', 'missing', 'version', 'manifest-version']) await t.test(change, async () => {
    const f = await fixture(); f.build();
    if (change === 'content') write(path.join(f.root, 'src/value.ts'), 'export const value = 2;\n');
    if (change === 'extra') write(path.join(f.root, 'src/extra.ts'), 'extra\n');
    if (change === 'missing') fs.rmSync(path.join(f.root, 'src/value.ts'));
    if (change === 'version') { const pkg = readJson(path.join(f.root, 'package.json')); pkg.version = '9.9.10'; json(path.join(f.root, 'package.json'), pkg); }
    if (change === 'manifest-version') { const m = readJson(paths(f.root).manifest); m.version = '9.9.10'; json(paths(f.root).manifest, m); }
    await assert.rejects(f.promote, /发布集合与 candidate 不一致|无 candidate 产物/);
    assert.equal(fullCalls(f).length, 0); assert.equal(planCalls(f).length, 0); assert.ok(fs.existsSync(paths(f.root).zip));
  });
});

test('全量或plan期间来源漂移，或完整证明来自另一快照，都不得晋升或eligible', async t => {
  for (const mode of ['full-drift', 'plan-drift', 'stale-full']) await t.test(mode, async () => {
    const options = mode === 'plan-drift' ? { planFail: true, onPlan: root => write(path.join(root, 'src/value.ts'), 'changed\n') }
      : { onFull: root => { const full = writeRun(root, 'full');
        if (mode === 'full-drift') write(path.join(root, 'src/value.ts'), 'changed\n');
        else json(path.join(reports(root), 'full.json'), { ...full, endingSnapshotId: 'different' }); } };
    const f = await fixture(options); f.build(); await assert.rejects(f.promote, /输入已改变|测试证明无效/);
    assert.equal(readJson(paths(f.root).manifest).candidate.status, 'built'); assert.ok(fs.existsSync(paths(f.root).zip));
  });
});

test('主干已进入新版本时可显式选择保留的旧来源，不改写主干且不重打候选', async () => {
  const f = await fixture({ planFail: true }); f.build();
  const retained = path.join(f.temp, 'retained'); fs.cpSync(f.root, retained, { recursive: true }); writeRun(retained, 'full');
  const pkg = readJson(path.join(f.root, 'package.json')); pkg.version = '9.9.10'; json(path.join(f.root, 'package.json'), pkg);
  await assert.rejects(() => f.promote(['--source-root', retained]), /eligible/);
  assert.equal(fullCalls(f).length, 0); assert.equal(readJson(path.join(f.root, 'package.json')).version, '9.9.10');
  assert.equal(readJson(paths(f.root).manifest).candidate.full_test.source_root, fs.realpathSync(retained));
});

test('golden、smoke完成标记和zip字节身份仍在正式测试前阻断', async t => {
  for (const mode of ['golden', 'smoke', 'zip']) await t.test(mode, async () => {
    const f = await fixture(); f.build();
    if (mode === 'golden') json(f.golden, { verdict: 'PASS', installed_manifest_sha256: 'other' });
    if (mode === 'smoke') { const m = readJson(paths(f.root).manifest); m.candidate.complete = false; json(paths(f.root).manifest, m); }
    if (mode === 'zip') fs.appendFileSync(paths(f.root).zip, 'changed');
    await assert.rejects(f.promote, /不匹配|complete !== true|字节身份失配/); assert.equal(fullCalls(f).length, 0);
  });
});

test('sanitize移除所有开发测试与候选脚本，消费者harness npm test仍check:global', () => {
  const scripts = { test: 'full', 'test:changed': 'changed', 'test:daily': 'daily', 'test:unit': 'unit', 'candidate:build': 'candidate', 'release:all': 'release', 'check:global': 'global' };
  const root = sanitizePackageJson({ scripts }); const harness = sanitizeHarnessPackageJson({ scripts });
  assert.ok(!Object.keys(root.scripts).some(key => /^(?:test:|candidate:|release:)/.test(key)));
  assert.ok(!Object.keys(harness.scripts).some(key => key.startsWith('test:'))); assert.equal(harness.scripts.test, 'npm run check:global');
});

test('release:all真实CLI仍选择npm test完整门禁，先verify/smoke再落fixture正式名', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-release-full-wiring-')); roots.push(temp);
  const log = path.join(temp, 'calls.jsonl');
  write(path.join(temp, '.gitignore'), 'node_modules/\nharness/node_modules/\ndist/\ncalls.jsonl\n');
  json(path.join(temp, 'package.json'), { version }); write(path.join(temp, 'README.md'), 'fixture\n');
  for (const file of ['release-all.mjs', 'release-pack-rules.mjs', 'release-excludes.json']) write(path.join(temp, 'scripts', file), fs.readFileSync(path.join(repo, 'scripts', file)));
  for (const file of ['ts-node/dist/bin.js', 'typescript/bin/tsc']) write(path.join(temp, 'harness/node_modules', file), '');
  const record = `const fs=require('fs'),path=require('path');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({file:__filename,args:process.argv.slice(2)})+'\\n');`;
  write(path.join(temp, 'npm.cjs'), record);
  write(path.join(temp, 'scripts/check-plan-version.mjs'), `import fs from 'fs';fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({file:'plan',args:process.argv.slice(2)})+'\\n');`);
  write(path.join(temp, 'scripts/pack-release.mjs'), `import fs from 'fs';import path from 'path';const out=process.argv[process.argv.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'framework-${version}.zip'),'fixture-zip');fs.writeFileSync(path.join(out,'framework-${version}.manifest.json'),'{}');`);
  for (const name of ['verify-release-pack', 'smoke-consumer-lifecycle']) write(path.join(temp, 'scripts', `${name}.mjs`), `import fs from 'fs';fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({file:'${name}',args:process.argv.slice(2)})+'\\n');`);
  const git = args => { const r = spawnSync('git', args, { cwd: temp, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git(['init', '-q']); git(['add', '-A']); git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  const result = spawnSync(process.execPath, ['scripts/release-all.mjs'], { cwd: temp, encoding: 'utf8', env: { ...process.env, npm_execpath: path.join(temp, 'npm.cjs') } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.args.includes('test') ? 'full' : call.file), ['plan', 'full', 'verify-release-pack', 'smoke-consumer-lifecycle']);
  assert.equal(fs.readFileSync(path.join(temp, `dist/framework-${version}.zip`), 'utf8'), 'fixture-zip');
});
