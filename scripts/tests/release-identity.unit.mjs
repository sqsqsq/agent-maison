// release-identity.unit.mjs — t7（f3a8c6d2）包身份最小目标测试（dev-only 单测）
//
// 覆盖三者的"同一字段"契约：
//   ① 打包生成：writeInZipManifest（pack-release.mjs）写入 source_commit + built_at；
//   ② release verify：validateReleaseIdentityFields（verify-release-pack.mjs）逐字段
//      校验；二者同仓同字段，生成→校验直接互通；
//   ③ 消费者呈现侧（readFrameworkPackageIdentity / buildFrameworkIdentityResult）在
//      harness/tests/unit/framework-integrity.unit.test.ts 覆盖：manifest 三字段 + sidecar
//      声明的 manifest SHA 原样读取，legacy 缺字段只显示 unknown、不阻断。
//
// 跑法：npm run release:check-plans-test（= node --test scripts/tests/*.unit.mjs）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { writeInZipManifest } from '../pack-release.mjs';
import { validateReleaseIdentityFields } from '../verify-release-pack.mjs';
import { assertCleanWorktree } from '../release-all.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const createdRoots = [];
afterEach(() => {
  while (createdRoots.length) {
    const root = createdRoots.pop();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响断言，忽略 */
    }
  }
});

function repoHeadCommit() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, '测试须在 git 检出内运行');
  return r.stdout.trim();
}

test('t7 打包生成：writeInZipManifest 写入 source_commit（=打包源仓 HEAD）与 built_at（UTC ISO）；files[]/sidecar 链不变', () => {
  const staging = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'am-id-pack-')), 'framework');
  createdRoots.push(path.dirname(staging));
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'README.md'), 'hello identity\n', 'utf8');

  const manifestSha = writeInZipManifest(staging, '9.9.9', ['README.md']);

  const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'RELEASE-MANIFEST.json'), 'utf8'));
  // ① source_commit：非空 40 位小写 hex 且 == 打包源仓当前 HEAD
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/, 'source_commit 须 40 位小写 hex');
  assert.equal(manifest.source_commit, repoHeadCommit(), 'source_commit 须等于打包源仓 HEAD');
  // ② built_at：UTC ISO-8601（Date.parse 可解析且以 Z 结尾）
  assert.equal(typeof manifest.built_at, 'string');
  assert.ok(manifest.built_at.endsWith('Z'), `built_at 须 UTC（Z 结尾），实际=${manifest.built_at}`);
  assert.ok(!Number.isNaN(Date.parse(manifest.built_at)), 'built_at 须可解析');
  // 现有语义不变：逐文件 hash + sidecar 链
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  assert.deepEqual(manifest.files, [{ path: 'README.md', sha256: sha(Buffer.from('hello identity\n', 'utf8')) }]);
  const sidecar = fs.readFileSync(path.join(staging, 'RELEASE-MANIFEST.sha256'), 'utf8');
  assert.match(sidecar, /^[0-9a-f]{64}\n$/, 'sidecar 格式不变');
  const raw = fs.readFileSync(path.join(staging, 'RELEASE-MANIFEST.json'));
  assert.equal(sha(raw), manifestSha);
  assert.equal(sidecar.trim(), sha(raw));
});

test('t7 互通：writeInZipManifest 产物直接通过 validateReleaseIdentityFields（生成→verify 同一字段契约）', () => {
  const staging = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'am-id-pass-')), 'framework');
  createdRoots.push(path.dirname(staging));
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'a.ts'), 'x', 'utf8');
  writeInZipManifest(staging, '9.9.9', ['a.ts']);
  const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'RELEASE-MANIFEST.json'), 'utf8'));
  assert.deepEqual(validateReleaseIdentityFields(manifest), [], '打包产物必须零错误通过 verify 校验');
});

test('t7 release verify：处理缺字段/格式非法的包（legacy 包、错 hex、非严格 UTC ISO）→ 逐一报错', () => {
  const good = {
    schema_version: '1.0',
    version: '3.0.0',
    source_commit: 'abcdef0123456789abcdef0123456789abcdef01',
    built_at: '2026-08-13T07:00:00.000Z',
    files: [],
  };
  assert.deepEqual(validateReleaseIdentityFields(good), []);
  // legacy 包：无身份字段
  const legacy = { schema_version: '1.0', version: '3.0.0', files: [] };
  const legacyErrors = validateReleaseIdentityFields(legacy);
  assert.ok(legacyErrors.some(e => e.includes('source_commit')), `legacy 缺 source_commit 须报错：${legacyErrors}`);
  assert.ok(legacyErrors.some(e => e.includes('built_at')), `legacy 缺 built_at 须报错：${legacyErrors}`);
  // source_commit 格式非法逐项
  assert.ok(validateReleaseIdentityFields({ ...good, source_commit: 'ABC' }).some(e => e.includes('source_commit')));
  assert.ok(validateReleaseIdentityFields({ ...good, source_commit: 'abcd' }).some(e => e.includes('source_commit')), '非 40 位不得放行');
  assert.ok(validateReleaseIdentityFields({ ...good, source_commit: 42 }).some(e => e.includes('source_commit')));
  // built_at：Date.parse 宽松形态全部须拒绝（严格 UTC ISO——生成端 toISOString 值域）
  const badBuiltAt = [
    '2026-08-13 07:00:00',            // 无 T
    '2026-08-13T07:00:00',            // 无 Z
    '2026-08-13Z',                    // 仅日期 + Z（Date.parse 可解析，须拒）
    '08/13/2026 07:00:00Z',           // 美式日期 + Z（Date.parse 可解析，须拒）
    '2026-08-13T07:00:00.000+08:00',  // 非 UTC 偏移
    '2026-02-30T00:00:00.000Z',       // 不存在的日期被 Date 归一到三月，须拒（往返不等）
    '2026-13-01T00:00:00.000Z',       // 形状合法但 13 月无效——Date 无效，不得抛 RangeError，须判非法
    'now',
  ];
  for (const v of badBuiltAt) {
    assert.ok(
      validateReleaseIdentityFields({ ...good, built_at: v }).some(e => e.includes('built_at')),
      `built_at=${JSON.stringify(v)} 必须判非法（不应抛异常）`,
    );
  }
});

// ---------------------------------------------------------------------------
// 干净树硬闸——包身份契约的另一半
// ---------------------------------------------------------------------------
//
// `source_commit=HEAD` 只有在**工作区干净**时才代表包内容；脏树打出的包自称某 commit
// 而内容不是，无法由该提交复现（2026-09-03 实证：带 5 个未提交文件跑完整条链，
// verify 与 smoke 全绿而产物身份是假的）。这里真建临时仓跑两个分支，不留注入缝。
test('release:all 干净树硬闸：干净放行；有改动（含 untracked）即拒并点名文件', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'am-clean-gate-'));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    git('add', '-A');
    git('commit', '-qm', 'init');

    // ① 干净 → 放行
    assert.doesNotThrow(() => assertCleanWorktree(repo), '干净树必须放行');

    // ② tracked 改动 → 拒，且点名该文件
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v2\n');
    assert.throws(
      () => assertCleanWorktree(repo),
      /a\.txt/,
      'tracked 改动必须拒绝并点名文件',
    );
    git('checkout', '--', 'a.txt');
    assert.doesNotThrow(() => assertCleanWorktree(repo), '还原后须重新放行');

    // ③ untracked 新文件 → 同样拒（--untracked-files=all；新增未提交的进包文件
    //    与改动等价地让 source_commit 说谎）
    fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');
    assert.throws(
      () => assertCleanWorktree(repo),
      /b\.txt/,
      'untracked 文件必须同样拒绝',
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// codex review P1（已实证）：`git status` 默认不报告被 .gitignore 忽略的路径，而打包器
// 是按磁盘遍历的（release-pack-rules.mjs `fs.readdirSync`），从不咨询 git。于是「被忽略
// 但落在进包路径下」的文件能让 status 全绿却照样进 zip——包里出现 HEAD 中不存在的文件。
// 这一例正是那条通道：单靠 status 会放行，必须由「进包文件须受 Git 跟踪」这道闸拦下。
test('干净树硬闸：被 .gitignore 忽略但会进包的文件必须拒绝（status 看不见它）', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'am-clean-gate-ignored-'));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.mkdirSync(path.join(repo, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'skills', 'keep.md'), '# keep\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'skills/*.tmp\n');
    git('add', '-A');
    git('commit', '-qm', 'init');
    assert.doesNotThrow(() => assertCleanWorktree(repo), '前置：此时应干净');

    // `skills/` 会进包，`.tmp` 不在发布排除规则里 → 该文件确实会被收进 zip。
    fs.writeFileSync(path.join(repo, 'skills', 'hidden.tmp'), 'ignored but shipped\n');

    // 先证明这条通道确实绕过了 git status（否则本用例只是在重复上一例）。
    const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repo, encoding: 'utf8',
    });
    assert.equal(
      (st.stdout ?? '').trim(), '',
      'git status 本应看不见 ignored 文件——若这里非空，说明前提变了，本用例需重写',
    );

    assert.throws(
      () => assertCleanWorktree(repo),
      /hidden\.tmp/,
      'ignored 但会进包的文件必须被拒（它不存在于 HEAD，却会进 zip）',
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('干净树硬闸：非 git 检出须给出可判定的失败，而不是静默放行', () => {
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'am-clean-gate-nogit-'));
  try {
    assert.throws(
      () => assertCleanWorktree(notARepo),
      /无法确认工作区状态/,
      '状态不可判定时必须失败（发布件身份取自 HEAD）',
    );
  } finally {
    fs.rmSync(notARepo, { recursive: true, force: true });
  }
});
