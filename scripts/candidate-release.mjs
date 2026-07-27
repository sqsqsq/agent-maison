#!/usr/bin/env node
// candidate-release.mjs — candidate 发布模式（plan c4e8b1d3 Todo 4）
//
// candidate = **持久化 zip + sidecar manifest + zip sha256**（不是可变 staging 目录）。
// 现状不能原样复用的三条已核实：--stage-only 只建目录无 zip/hash；正常 pack 打完 zip 即删
// staging；release:all 第一步就是 check-plan-version --release（被在研 plan 拦截）且 verify
// 通过立即 promote。
//
// 两个子命令：
//   build   完成测试 + pack + zip 内容校验（verify），**唯一跳过项 = 最终发布 plan 完成
//           门禁**（check-plan-version --release）；产出持久化 candidate zip 到
//           dist/candidates/，宿主装这个 zip（非可变目录）。
//   promote 对**已有 zip**补最终发布门禁并移动**同一字节对象**到 dist/ 正式名——禁止
//           重新 pack。前置：consumer golden evaluator 报告 verdict=PASS 且 manifest 绑定
//           一致（evaluator 属于发布内容，随 candidate zip 运行）。发布 plan 门禁被其他
//           在研 plan 拦截时：只标记 candidate eligible，**不绕过全局发布门禁**。
//
// 用法（仓库根）：
//   node scripts/candidate-release.mjs build
//   node scripts/candidate-release.mjs promote --evaluator-report <consumer-golden-report.json>
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HARNESS = path.join(REPO_ROOT, 'harness');
const TSNODE = path.join(HARNESS, 'node_modules', 'ts-node', 'dist', 'bin.js');
const TSC = path.join(HARNESS, 'node_modules', 'typescript', 'bin', 'tsc');

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  const rel = path.relative(REPO_ROOT, cwd) || '.';
  console.log(`\n[candidate] $ ${path.basename(cmd)} ${args.join(' ')}  (cwd=${rel})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.error) throw new Error(`spawn 失败：${cmd} — ${r.error.message}`);
  if (r.status !== 0) throw new Error(`FAIL at: ${path.basename(cmd)} ${args.join(' ')} (exit=${r.status})`);
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
}

/** @param {string} abs */
function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function candidatesDir() {
  return path.join(REPO_ROOT, 'dist', 'candidates');
}

function candidatePaths(version) {
  return {
    zip: path.join(candidatesDir(), `framework-${version}-candidate.zip`),
    manifest: path.join(candidatesDir(), `framework-${version}-candidate.manifest.json`),
  };
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function buildCandidate() {
  for (const [name, p] of [['ts-node', TSNODE], ['typescript', TSC]]) {
    if (!fs.existsSync(p)) throw new Error(`缺少 ${name}：${p}（先在 harness 下 npm install）`);
  }
  const version = readVersion();
  const stagingDir = path.join(candidatesDir(), '.staging');
  const zipName = `framework-${version}.zip`;
  const stagedZip = path.join(stagingDir, zipName);
  const stagedManifest = path.join(stagingDir, `framework-${version}.manifest.json`);
  const finalPaths = candidatePaths(version);

  console.log(`[candidate] build version=${version}（唯一跳过项=发布 plan 完成门禁；promote 时补跑）`);

  // 1. typecheck + 单测 + fixtures（candidate 不跳任何测试）
  run(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.typecheck.json'], HARNESS);
  run(process.execPath, [TSNODE, '--transpile-only', 'tests/run-unit.ts'], HARNESS);
  run(process.execPath, [TSNODE, '--transpile-only', 'tests/run-tests.ts'], HARNESS);

  // 2–4. pack → verify（跳过发布 plan 门禁）→ 持久化 candidate（staging 生命周期 try/finally 兜住）
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    run(process.execPath, ['scripts/pack-release.mjs', '--out', stagingDir], REPO_ROOT);
    run(
      process.execPath,
      [
        'scripts/verify-release-pack.mjs', '--skip-typecheck', '--skip-plan-release-gate',
        '--zip', stagedZip, '--manifest', stagedManifest,
      ],
      REPO_ROOT,
    );

    // 持久化：同一字节 zip 改名落 candidates/（rename 不改字节；sha 落 manifest 供 promote 验身份）
    fs.mkdirSync(candidatesDir(), { recursive: true });
    for (const p of [finalPaths.zip, finalPaths.manifest]) {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
    fs.renameSync(stagedZip, finalPaths.zip);
    const manifest = JSON.parse(fs.readFileSync(stagedManifest, 'utf8'));
    const zipSha = sha256File(finalPaths.zip);
    if (zipSha !== manifest.sha256) {
      throw new Error(`candidate zip sha 与 pack manifest 不一致：${zipSha} vs ${manifest.sha256}`);
    }
    manifest.zipPath = `dist/candidates/framework-${version}-candidate.zip`;
    manifest.candidate = {
      status: 'built',
      built_at: new Date().toISOString(),
      zip_sha256: zipSha,
      skipped_gates: ['check-plan-version --release'],
      note: 'candidate 未经最终发布 plan 门禁；宿主统一回归 + consumer golden evaluator PASS 后由 promote 补门禁并移动同一字节 zip。',
    };
    fs.writeFileSync(finalPaths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(`\n[candidate] BUILT → ${path.relative(REPO_ROOT, finalPaths.zip)}`);
    console.log(`[candidate] zip sha256          = ${zipSha}`);
    console.log(`[candidate] in-zip manifest sha = ${manifest.inZipManifest.sha256}`);
    const contractRel = 'framework/harness/scripts/consumer-golden/bc-opencard.golden-contract.json';
    console.log('[candidate] 宿主 golden 回归入口（三步，缺一不可）：');
    console.log('  1) 安装该 zip（非可变 staging 目录）到宿主 framework/；');
    console.log('  2) **设 golden 采集 env 后**在同一 shell 跑 goal run（否则采集仍是 P0-only，');
    console.log('     P1 屏 bank_card_list_sheet 不会被采、HomeTab 负向证据不会生产、evaluator 必然 FAIL）：');
    console.log(`     PowerShell:  $env:MAISON_GOLDEN_CONTRACT = '${contractRel}'`);
    console.log(`     bash:        export MAISON_GOLDEN_CONTRACT='${contractRel}'`);
    console.log('     （相对宿主 projectRoot；golden 模式同时强制十屏本 run 重采 + 生产 HomeTab');
    console.log('       UITree 负向证据——宿主 visual-diff-nav 配置须含 HomeTab 到达步骤）');
    console.log('  3) 回归完成后用包内 evaluator 裁决（PASS 才回来 candidate:promote）：');
    console.log('       npx ts-node harness/scripts/consumer-golden/evaluate-bc-opencard.ts \\');
    console.log(`         --project-root <hostRoot> --run-id <goalRunId> --expected-manifest-sha ${manifest.inZipManifest.sha256}`);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// promote
// ---------------------------------------------------------------------------

/** @param {string[]} argv */
function promoteCandidate(argv) {
  const version = readVersion();
  const cand = candidatePaths(version);
  const evalIdx = argv.indexOf('--evaluator-report');
  const evalReportPath = evalIdx >= 0 ? argv[evalIdx + 1] : undefined;

  if (!fs.existsSync(cand.zip) || !fs.existsSync(cand.manifest)) {
    throw new Error(`无 candidate 产物：${cand.zip}（先跑 candidate build）`);
  }
  const manifest = JSON.parse(fs.readFileSync(cand.manifest, 'utf8'));

  // ① 字节身份：现有 zip 必须与 build 时记录的 sha 一致（禁止重新 pack / 中途被换）
  const zipSha = sha256File(cand.zip);
  if (zipSha !== manifest.candidate?.zip_sha256 || zipSha !== manifest.sha256) {
    throw new Error(
      `candidate zip 字节身份失配：盘上 ${zipSha.slice(0, 12)}… vs 记录 ${String(manifest.candidate?.zip_sha256).slice(0, 12)}…——不得 promote（如需重建请重跑 candidate build）`,
    );
  }

  // ② consumer golden evaluator PASS（G3：evaluator PASS → promote 同一 candidate）
  if (!evalReportPath) {
    throw new Error('promote 需要 --evaluator-report <consumer-golden-report.json>（宿主统一回归后由包内 evaluator 产出）');
  }
  const evalReport = JSON.parse(fs.readFileSync(path.resolve(evalReportPath), 'utf8'));
  if (evalReport.verdict !== 'PASS') {
    throw new Error(`consumer golden evaluator verdict=${evalReport.verdict}——FAIL 不 promote`);
  }
  if (evalReport.installed_manifest_sha256 !== manifest.inZipManifest.sha256) {
    throw new Error(
      `evaluator 报告的安装 manifest sha（${String(evalReport.installed_manifest_sha256).slice(0, 12)}…）` +
      `与本 candidate（${manifest.inZipManifest.sha256.slice(0, 12)}…）不匹配——结果不是本 candidate 产出，不能复用`,
    );
  }

  // ③ 补最终发布 plan 门禁（唯一被 build 跳过的门）——被其他在研 plan 拦截时只标 eligible，不绕过
  console.log('\n[candidate] promote：补跑 check-plan-version --release ...');
  const gate = spawnSync(process.execPath, ['scripts/check-plan-version.mjs', '--release'], {
    cwd: REPO_ROOT, stdio: 'inherit', shell: false,
  });
  if (gate.status !== 0) {
    manifest.candidate.status = 'eligible';
    manifest.candidate.eligible_at = new Date().toISOString();
    manifest.candidate.eligible_note =
      'consumer golden PASS + zip 字节身份一致，但全局发布 plan 门禁仍被在研 plan 拦截——只标记 eligible，不绕过门禁；待 plan 完结后重跑 promote。';
    fs.writeFileSync(cand.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.error('\n[candidate] 发布 plan 门禁未过：candidate 标记为 **eligible**（不 promote，不绕过全局发布门禁）。');
    process.exit(1);
  }

  // ④ 移动同一字节对象到 dist/ 正式名（rename，不重新 pack）
  const distDir = path.join(REPO_ROOT, 'dist');
  const finalZip = path.join(distDir, `framework-${version}.zip`);
  const finalManifest = path.join(distDir, `framework-${version}.manifest.json`);
  fs.mkdirSync(distDir, { recursive: true });
  fs.renameSync(cand.zip, finalZip);
  const promotedSha = sha256File(finalZip);
  if (promotedSha !== zipSha) {
    throw new Error(`promote 后 zip sha 变化（${promotedSha} vs ${zipSha}）——移动非同一字节对象，立即人工核查`);
  }
  manifest.zipPath = `dist/framework-${version}.zip`;
  manifest.candidate.status = 'promoted';
  manifest.candidate.promoted_at = new Date().toISOString();
  manifest.candidate.evaluator_report = path.resolve(evalReportPath).replace(/\\/g, '/');
  fs.writeFileSync(finalManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.rmSync(cand.manifest, { force: true });

  console.log(`\n[candidate] PROMOTED（同一字节 zip，sha=${promotedSha.slice(0, 12)}…）→ dist/framework-${version}.zip`);
}

// ---------------------------------------------------------------------------

const sub = process.argv[2];
try {
  if (sub === 'build') {
    buildCandidate();
  } else if (sub === 'promote') {
    promoteCandidate(process.argv.slice(3));
  } else {
    console.error('用法：node scripts/candidate-release.mjs <build|promote> [promote: --evaluator-report <path>]');
    process.exit(2);
  }
} catch (err) {
  console.error(`\n[candidate] ${err.message}`);
  process.exit(1);
}
