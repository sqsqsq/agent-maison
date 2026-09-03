#!/usr/bin/env node
// release-all.mjs — 前台串联发布链路（见 .cursor/plans 的 a7c3e1f9 P4）。
//
// 目标：一条命令跑完发布，且
//   - typecheck 只跑一次（含 tests；test:unit/test:fixtures 走 transpile-only，verify 传 --skip-typecheck）；
//   - zip 只打一次（pack→verify --zip，verify 不再自 pack→extract）；
//   - 失败不留残留：先 pack 到 staging，verify 通过后才 promote 到 dist/；任一步失败均清理 staging（try/finally）。
//
// 用法（仓库根）：npm run release:all
// 前台顺序执行、任一步失败即中止并以非零码退出；请勿丢后台再粗粒度轮询。
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { collectReleaseFiles, loadReleaseExcludes, toPosixPath } from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HARNESS = path.join(REPO_ROOT, 'harness');
// 直接用 node 跑工具的 JS 入口，避开 npm/.cmd 与 shell（DEP0190 + Windows 对 .cmd 需 shell 的坑；
// 与 tests/unit/init-orchestrate 的 spawn 模式一致）。
const TSNODE = path.join(HARNESS, 'node_modules', 'ts-node', 'dist', 'bin.js');
const TSC = path.join(HARNESS, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * 跑一步；失败抛错（由主流程 try/catch 统一处理、finally 清 staging）。
 * shell:false —— 显式命令 + 参数数组，避免 shell 拼接与路径含空格/特殊字符的注入。
 * @param {string} cmd @param {string[]} args @param {string} cwd
 */
function run(cmd, args, cwd) {
  const rel = path.relative(REPO_ROOT, cwd) || '.';
  console.log(`\n[release:all] $ ${path.basename(cmd)} ${args.join(' ')}  (cwd=${rel})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.error) throw new Error(`spawn 失败：${cmd} — ${r.error.message}`);
  if (r.status !== 0) throw new Error(`FAIL at: ${path.basename(cmd)} ${args.join(' ')} (exit=${r.status})`);
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
}

/**
 * 打包前的干净树硬闸。
 *
 * 为什么必须有（2026-09-03 实证）：`pack-release.mjs` 把 `source_commit` 写成
 * `git rev-parse HEAD`，打包的却是**工作区当前字节**，两者之间没有任何一致性校验。
 * 于是脏树能铸出一个「自称来自某 commit、内容却不是该 commit」的发布件——拿着它回到
 * 那个 commit 复现不出来。本轮真出过：带 5 个未提交文件（3 个进 zip）跑完整条链，
 * verify 与 smoke 全绿，产物身份却是假的，最后是靠人读 `git status` 才发现。
 *
 * 闸放在链首而不是 pack 内：脏树时应当**一步都不跑**，而不是把几分钟测试跑完再拒。
 * **不提供 `--allow-dirty`**——本地脏树想验打包规则用 `npm run release:verify`；
 * 留逃生口等于把这道闸交还给"赶时间的人"，而它防的正是那一类事故。
 *
 * @param {string} repoRoot
 */
export function assertCleanWorktree(repoRoot) {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.error || r.status !== 0) {
    throw new Error(
      `无法确认工作区状态（发布件身份取自 git HEAD，必须可判定）：${(r.stderr ?? r.error?.message ?? '').trim() || '非 git 检出'}`,
    );
  }
  const dirty = (r.stdout ?? '').split('\n').map(l => l.trimEnd()).filter(Boolean);
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 20).join('\n  ');
    throw new Error(
      `工作区不干净，拒绝打包：产物会写入 source_commit=HEAD，但内容是工作区字节，` +
      `二者不一致的包无法由该提交复现。\n  ${shown}` +
      (dirty.length > 20 ? `\n  …另有 ${dirty.length - 20} 项` : '') +
      `\n先提交或还原上述改动再发布；只想验打包规则用 npm run release:verify。`,
    );
  }

  // 第二道：`git status` 独木桥堵不住 **ignored** 文件（codex review P1，已实证）。
  // Git 默认不报告被 `.gitignore` 忽略的路径，而 `collectReleaseFiles` 是**按磁盘遍历**
  // 的（release-pack-rules.mjs:213 `fs.readdirSync`），从不咨询 git。于是
  // `skills/hidden.tmp` 这类「被忽略但落在进包路径下」的文件，status 全绿却照样进 zip
  // ——包里出现 HEAD 中根本不存在的文件，`source_commit` 同样说谎。
  //
  // 因此直接钉住真正要保证的性质：**进包的每个文件都必须受 Git 跟踪**。拿实际发布集合
  // 与 `git ls-files` 求差集，比"再加 --ignored 扫一遍"精确——它只问责会进包的路径，
  // 不会被仓库里合法的 ignored 产物（dist/、node_modules/…）误伤。
  const ls = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (ls.error || ls.status !== 0) {
    throw new Error(`无法列出 Git 跟踪文件：${(ls.stderr ?? ls.error?.message ?? '').trim()}`);
  }
  const tracked = new Set((ls.stdout ?? '').split('\0').filter(Boolean).map(toPosixPath));
  const { included } = collectReleaseFiles(repoRoot, loadReleaseExcludes());
  const untrackedShipping = included.map(toPosixPath).filter(f => !tracked.has(f));
  if (untrackedShipping.length > 0) {
    const shown = untrackedShipping.slice(0, 20).join('\n  ');
    throw new Error(
      `发布集合含 ${untrackedShipping.length} 个不受 Git 跟踪的文件，拒绝打包：` +
      `它们会进 zip，却不存在于 source_commit=HEAD（.gitignore 忽略的文件 git status 不报告）。\n  ${shown}` +
      (untrackedShipping.length > 20 ? `\n  …另有 ${untrackedShipping.length - 20} 项` : '') +
      `\n提交它们，或让发布排除规则/.gitignore 把它们挡在包外。`,
    );
  }
}

function main() {
  for (const [name, p] of [['ts-node', TSNODE], ['typescript', TSC]]) {
    if (!fs.existsSync(p)) throw new Error(`缺少 ${name}：${p}（先在 harness 下 npm install）`);
  }

  // 0. 干净树硬闸（在任何耗时步骤之前）
  assertCleanWorktree(REPO_ROOT);

  const version = readVersion();
  const distDir = path.join(REPO_ROOT, 'dist');
  const stagingDir = path.join(distDir, '.release-all-staging');
  const zipName = `framework-${version}.zip`;
  const manifestName = `framework-${version}.manifest.json`;
  const stagedZip = path.join(stagingDir, zipName);
  const stagedManifest = path.join(stagingDir, manifestName);

  console.log(`[release:all] version=${version}`);

  // 1. plan 版本发布门禁（在研 plan 若含未完成 todo 会在此拦截）
  run(process.execPath, ['scripts/check-plan-version.mjs', '--release'], REPO_ROOT);

  // 2. typecheck 一次（含 tests；SSOT 类型把关，后续测试走 transpile-only）
  run(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.typecheck.json'], HARNESS);

  // 3. 单测 + fixtures（transpile-only；不再各自重复 typecheck）
  run(process.execPath, [TSNODE, '--transpile-only', 'tests/run-unit.ts'], HARNESS);
  run(process.execPath, [TSNODE, '--transpile-only', 'tests/run-tests.ts'], HARNESS);

  // 4–6. pack→verify→promote：staging 生命周期用 try/finally 兜住，任一步失败都清 staging（不留残留产物）
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    // 4. pack 到 staging（失败不碰 dist/）
    run(process.execPath, ['scripts/pack-release.mjs', '--out', stagingDir], REPO_ROOT);

    // 5. verify（跳过重复 typecheck，校验已 pack 产物，不再自 pack→extract）
    run(
      process.execPath,
      ['scripts/verify-release-pack.mjs', '--skip-typecheck', '--zip', stagedZip, '--manifest', stagedManifest],
      REPO_ROOT,
    );

    // verify 只证明发布包结构/清单正确；发布门还必须对**同一份 staged zip**跑
    // consumer lifecycle。smoke 通过后才允许 rename，避免 pack→verify→直接进 dist
    // 绕过整机闭环。
    run(
      process.execPath,
      ['scripts/smoke-consumer-lifecycle.mjs', '--zip', stagedZip],
      REPO_ROOT,
    );

    // 7. promote 到 dist/（verify + 同字节 smoke 都通过才落地）；修正 sidecar manifest.zipPath 指向最终路径
    fs.mkdirSync(distDir, { recursive: true });
    fs.renameSync(stagedZip, path.join(distDir, zipName));
    const manifest = JSON.parse(fs.readFileSync(stagedManifest, 'utf8'));
    manifest.zipPath = `dist/${zipName}`;
    fs.writeFileSync(path.join(distDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  console.log(`\n[release:all] DONE → dist/${zipName} (+ ${manifestName})`);
}

// 与 check-plan-version.mjs / verify-release-pack.mjs 同一守卫：直接执行才跑发布链，
// 被 import（单测取 assertCleanWorktree）时不得有副作用。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`\n[release:all] ${err.message}`);
    process.exit(1);
  }
}
