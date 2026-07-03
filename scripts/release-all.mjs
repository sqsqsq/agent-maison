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

function main() {
  for (const [name, p] of [['ts-node', TSNODE], ['typescript', TSC]]) {
    if (!fs.existsSync(p)) throw new Error(`缺少 ${name}：${p}（先在 harness 下 npm install）`);
  }

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

    // 6. promote 到 dist/（verify 通过才落地）；修正 sidecar manifest.zipPath 指向最终路径
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

try {
  main();
} catch (err) {
  console.error(`\n[release:all] ${err.message}`);
  process.exit(1);
}
