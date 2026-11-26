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

function writeRun(root, changes = {}) {
  const inputSnapshot = snapshot(root);
  const result = {
    ok: true, inputSnapshot, endingSnapshot: inputSnapshot,
    registered: 2, executed: 2, passed: 2, failed: 0, missed: 0, skipped: 0, timedOut: 0, infrastructureFailed: 0,
    ...changes,
  };
  json(path.join(reports(root), 'full.json'), result);
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
  json(path.join(root, 'package.json'), { name: 'fixture', version, scripts: { test: 'npm --prefix harness test' } });
  json(path.join(root, 'harness/package.json'), { scripts: { test: 'full', 'check:global': 'global', typecheck: 'tsc' } });
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
    if (args.includes('-e')) return JSON.stringify(snapshot(source));
    if (args[1] === 'test') {
      if (options.onFull) options.onFull(source);
      else writeRun(source, options.fullResult);
      return;
    }
    if (args[0] === 'scripts/pack-release.mjs') {
      const out = args[args.indexOf('--out') + 1];
      if (args.includes('--stage-only')) { stage(source, path.join(out, 'release-staging/framework')); return; }
      fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(zip, path.join(out, `framework-${version}.zip`));
      json(path.join(out, `framework-${version}.manifest.json`), { ...sidecar, ...options.packManifest });
      options.afterPack?.(source); return;
    }
    if (args[0] === 'scripts/verify-release-pack.mjs') {
      assert.equal(hash(fs.readFileSync(args[args.indexOf('--zip') + 1])), sidecar.sha256);
      if (options.verifyFail) throw new Error('controlled verify failure'); return;
    }
    if (args[0] === 'scripts/smoke-consumer-lifecycle.mjs') {
      assert.equal(hash(fs.readFileSync(args[args.indexOf('--zip') + 1])), sidecar.sha256);
      if (options.smokeFail) throw new Error('controlled smoke failure');
      options.afterSmoke?.(args[args.indexOf('--zip') + 1]); return;
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

test('来源快照子进程 stderr 可见且 stdout 仍为可读 JSON', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-candidate-capture-')); roots.push(temp);
  const root = path.join(temp, 'source'), npm = path.join(temp, 'npm.cjs');
  json(path.join(root, 'package.json'), { version });
  const full = writeRun(root);
  write(npm, `require('fs').writeFileSync(${JSON.stringify(path.join(reports(root), 'full.json'))}, ${JSON.stringify(JSON.stringify(full))});`);
  write(path.join(root, 'harness/node_modules/typescript/bin/tsc'), '');
  write(path.join(root, 'harness/node_modules/ts-node/dist/bin.js'),
    'process.stderr.write("SOURCE_CAPTURE_STDERR\\\\n");process.stdout.write(JSON.stringify({id:"private-capture-id",head:"0",files:{}}));');
  const driver = path.join(temp, 'driver.mjs');
  const entry = new URL('../candidate-release.mjs', import.meta.url).href;
  write(driver, `import { buildCandidate } from ${JSON.stringify(entry)};try { buildCandidate({root:${JSON.stringify(root)}}); } catch(error) { console.error('EXPECTED_CAPTURE_STOP:'+error.message);process.exitCode=1; }`);
  const result = spawnSync(process.execPath, [driver], { encoding: 'utf8', env: { ...process.env, npm_execpath: npm } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SOURCE_CAPTURE_STDERR/);
  assert.match(result.stderr, /EXPECTED_CAPTURE_STOP:.*输入改变/);
  assert.ok(!result.stdout.includes('private-capture-id'));
});

test('候选构建执行一次根全量并记录同一 zip，晋升只消费既有证明', async () => {
  const f = await fixture();
  f.build();
  assert.equal(fullCalls(f).length, 1);
  assert.deepEqual(fullCalls(f)[0].args.slice(1), ['test']);
  assert.equal(fullCalls(f)[0].cwd, f.root);
  const { candidate } = readJson(paths(f.root).manifest);
  assert.equal(candidate.complete, true);
  assert.equal(candidate.full_test.snapshot_id, snapshot(f.root).id);
  assert.equal(candidate.full_test.ending_snapshot_id, candidate.full_test.snapshot_id);
  assert.equal(candidate.full_test.zip_sha256, f.sidecar.sha256);
  assert.deepEqual(candidate.skipped_gates, ['check-plan-version --release']);
  assert.equal(f.calls.filter(call => call.args[0] === 'scripts/verify-release-pack.mjs').length, 1);
  assert.equal(f.calls.filter(call => call.args[0] === 'scripts/smoke-consumer-lifecycle.mjs').length, 1);

  fs.rmSync(path.join(reports(f.root), 'full.json'));
  await f.promote();
  assert.equal(fullCalls(f).length, 1);
  assert.equal(planCalls(f).length, 1);
  assert.equal(hash(fs.readFileSync(path.join(f.root, `dist/framework-${version}.zip`))), f.sidecar.sha256);
  assert.equal(f.calls.filter(call => call.args[0] === 'scripts/pack-release.mjs' && !call.args.includes('--stage-only')).length, 1);
});

for (const [name, options, message] of [
  ['全量失败', { fullResult: { ok: false } }, /根全量证明无效/],
  ['有漏跑', { fullResult: { missed: 1 } }, /根全量证明无效/],
  ['输入起止不一致', { fullResult: { endingSnapshot: { id: 'different' } } }, /根全量证明无效/],
  ['全量退出后的输入漂移', { onFull: root => { writeRun(root); write(path.join(root, 'src/value.ts'), 'changed'); } }, /输入改变/],
  ['打包期间新增文件', { packManifest: { includedFiles: ['src/extra.ts'] }, afterPack: root => write(path.join(root, 'src/extra.ts'), 'added') }, /未被受测 InputSnapshot 覆盖/],
  ['打包期间其他测试输入漂移', { afterPack: root => write(path.join(root, 'scripts/new.unit.mjs'), 'changed') }, /输入改变/],
  ['校验失败', { verifyFail: true }, /controlled verify failure/],
  ['冒烟失败', { smokeFail: true }, /controlled smoke failure/],
  ['冒烟期间 zip 漂移', { afterSmoke: zip => fs.appendFileSync(zip, 'changed') }, /zip 字节身份失配/],
]) {
  test(`候选构建拒绝${name}`, async () => {
    const f = await fixture(options);
    assert.throws(f.build, message);
    assert.ok(!fs.existsSync(paths(f.root).manifest) || readJson(paths(f.root).manifest).candidate.complete === false);
    assert.equal(fullCalls(f).length, 1);
  });
}

test('候选构建要求本次根全量报告，旧报告或筛选结果不能补证', async () => {
  const f = await fixture({ onFull: root => json(path.join(reports(root), 'filtered.json'), { ok: true }) });
  writeRun(f.root);
  assert.throws(f.build, /缺少本次根全量报告/);
  assert.equal(fullCalls(f).length, 1);
  assert.equal(f.calls.some(call => call.args[0] === 'scripts/pack-release.mjs'), false);
});

for (const [name, edit] of [
  ['旧候选', candidate => { candidate.daily_test = candidate.full_test; delete candidate.full_test; }],
  ['另一快照', candidate => { candidate.full_test.ending_snapshot_id = '0'.repeat(64); }],
  ['另一 zip', candidate => { candidate.full_test.zip_sha256 = '0'.repeat(64); }],
  ['另一包内 manifest', candidate => { candidate.full_test.in_zip_manifest_sha256 = '0'.repeat(64); }],
  ['不同源码身份', candidate => { candidate.full_test.source_commit = '1'.repeat(40); }],
]) {
  test(`晋升拒绝${name}并保留原候选`, async () => {
    const f = await fixture();
    f.build();
    const file = paths(f.root).manifest, manifest = readJson(file);
    edit(manifest.candidate);
    json(file, manifest);
    await assert.rejects(f.promote, /需重新构建/);
    assert.equal(fullCalls(f).length, 1);
    assert.equal(planCalls(f).length, 0);
    assert.equal(readJson(file).candidate.status, 'built');
  });
}

test('仅发布 plan 未过时 eligible，更新 plan 后复用原构建的全量证明', async () => {
  const f = await fixture({ planFail: true });
  f.build();
  const file = paths(f.root).manifest, tested = readJson(file).candidate.full_test.snapshot_id;
  await assert.rejects(f.promote, /eligible/);
  assert.equal(readJson(file).candidate.status, 'eligible');
  write(path.join(f.root, '.cursor/plan.md'), 'completed\n');
  f.options.planFail = false;
  await f.promote();
  const promoted = readJson(path.join(f.root, `dist/framework-${version}.manifest.json`));
  assert.equal(promoted.candidate.full_test.snapshot_id, tested);
  assert.notEqual(promoted.candidate.full_test.snapshot_id, snapshot(f.root).id);
  assert.equal(fullCalls(f).length, 1);
});

for (const [name, change] of [
  ['内容变化', root => write(path.join(root, 'src/value.ts'), 'export const value = 2;\n')],
  ['增加文件', root => write(path.join(root, 'src/extra.ts'), 'extra\n')],
  ['减少文件', root => fs.rmSync(path.join(root, 'src/value.ts'))],
  ['版本失配', root => { const file = paths(root).manifest, manifest = readJson(file); manifest.version = '9.9.10'; json(file, manifest); }],
]) {
  test(`晋升前拒绝来源发布集合${name}`, async () => {
    const f = await fixture();
    f.build();
    change(f.root);
    await assert.rejects(f.promote, /发布集合与 candidate 不一致/);
    assert.equal(fullCalls(f).length, 1);
    assert.equal(planCalls(f).length, 0);
    assert.ok(fs.existsSync(paths(f.root).zip));
  });
}

test('检查 plan 期间 zip 失配不会标记 eligible', async () => {
  const f = await fixture({ planFail: true, onPlan: root => fs.appendFileSync(paths(root).zip, 'changed') });
  f.build();
  await assert.rejects(f.promote, /zip 字节身份失配/);
  assert.equal(readJson(paths(f.root).manifest).candidate.status, 'built');
});

test('主干已进入新版本时，保留旧来源可继续核查原候选', async () => {
  const f = await fixture();
  f.build();
  const retained = path.join(f.temp, 'retained');
  fs.cpSync(f.root, retained, { recursive: true });
  const pkg = readJson(path.join(f.root, 'package.json'));
  pkg.version = '9.9.10';
  json(path.join(f.root, 'package.json'), pkg);
  await f.promote(['--source-root', retained]);
  assert.equal(fullCalls(f).length, 1);
  assert.equal(planCalls(f)[0].cwd, fs.realpathSync(retained));
  assert.equal(readJson(path.join(f.root, 'package.json')).version, '9.9.10');
});

for (const [name, change, message] of [
  ['golden', f => json(f.golden, { verdict: 'PASS', installed_manifest_sha256: 'other' }), /不匹配/],
  ['smoke', f => { const file = paths(f.root).manifest, manifest = readJson(file); manifest.candidate.complete = false; json(file, manifest); }, /complete !== true/],
  ['zip', f => fs.appendFileSync(paths(f.root).zip, 'changed'), /字节身份失配/],
]) {
  test(`晋升拒绝 ${name} 失败`, async () => {
    const f = await fixture();
    f.build();
    change(f);
    await assert.rejects(f.promote, message);
    assert.equal(fullCalls(f).length, 1);
    assert.equal(planCalls(f).length, 0);
  });
}

test('候选命令拒绝本地测试筛选参数', () => {
  for (const operation of ['build', 'promote']) {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/candidate-release.mjs'), operation, '--filter', 'subset'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不接受参数|不支持的晋升参数/);
  }
});

test('sanitize移除所有开发测试与候选脚本，消费者harness npm test仍check:global', () => {
  const scripts = { test: 'full', 'test:development': 'unit', 'candidate:build': 'candidate', 'release:all': 'release', 'check:global': 'global' };
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
  const record = `const fs=require('fs'),path=require('path');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({file:__filename,args:process.argv.slice(2),cwd:process.cwd()})+'\\n');`;
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
  assert.equal(calls[1].cwd, fs.realpathSync(temp));
  assert.deepEqual(calls[1].args, ['test']);
  assert.equal(fs.readFileSync(path.join(temp, `dist/framework-${version}.zip`), 'utf8'), 'fixture-zip');
});
