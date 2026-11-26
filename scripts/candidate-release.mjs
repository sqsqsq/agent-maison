#!/usr/bin/env node
// 候选构建先通过根全量，再打包并用同一 zip 校验及冒烟。
// 晋升只核查原构建证据、同一 zip、consumer golden 和当前版本的发布 plan 门禁。
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import extractZip from 'extract-zip';
import { assertInZipManifest } from './verify-release-pack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd, { capture = false } = {}) {
  const rel = path.relative(REPO_ROOT, cwd) || '.';
  console.log(`\n[candidate] $ ${path.basename(cmd)} ${args.join(' ')}  (cwd=${rel})`);
  const r = spawnSync(cmd, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false });
  if (r.error) throw new Error(`spawn 失败：${cmd} — ${r.error.message}`);
  if (r.status !== 0) throw new Error(`FAIL at: ${path.basename(cmd)} ${args.join(' ')} (exit=${r.status})`);
  return r.stdout;
}

function readVersion(root = REPO_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

/** @param {string} abs */
function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function candidatesDir(root = REPO_ROOT) {
  return path.join(root, 'dist', 'candidates');
}

function candidatePaths(version, root = REPO_ROOT) {
  return {
    zip: path.join(candidatesDir(root), `framework-${version}-candidate.zip`),
    manifest: path.join(candidatesDir(root), `framework-${version}-candidate.manifest.json`),
  };
}

const npmCli = () => process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const fullReportPath = root => path.join(root, 'harness', 'reports', 'test-run', 'full.json');
const isSha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function readInputSnapshot(root, runCommand) {
  const harness = path.join(root, 'harness');
  const loader = path.join(harness, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const code = "process.stdout.write(JSON.stringify(require('./tests/utils/test-input-snapshot').snapshotTestInputs()))";
  return JSON.parse(runCommand(process.execPath, [loader, '--transpile-only', '-e', code], harness, { capture: true }));
}

function hasPassingCounts(run) {
  return run?.ok === true && Number.isSafeInteger(run.registered) && run.registered > 0
    && run.executed === run.registered && run.passed === run.registered
    && [run.failed, run.missed, run.skipped, run.timedOut, run.infrastructureFailed].every(count => count === 0);
}

function readPassingRun(file) {
  let result;
  try { result = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`候选构建缺少本次根全量报告（${file}）`); }
  if (!hasPassingCounts(result) || !isSha256(result.inputSnapshot?.id)
    || result.endingSnapshot?.id !== result.inputSnapshot.id
    || !result.inputSnapshot.files || !result.endingSnapshot.files) {
    throw new Error(`根全量证明无效：需要本次完整通过且开始、结束输入一致的报告（${file}）`);
  }
  return result;
}

function assertSnapshotUnchanged(root, snapshot, phase, runCommand) {
  if (readInputSnapshot(root, runCommand).id !== snapshot.id) {
    throw new Error(`候选${phase}期间测试输入改变，需重新构建`);
  }
}

function assertReleaseInputs(snapshot, root, files) {
  const missing = files.filter(file => snapshot.files[file] !== sha256File(path.join(root, file)));
  if (missing.length) throw new Error(`发布源文件未被受测 InputSnapshot 覆盖：${missing.slice(0, 5).join(', ')}`);
}

function assertZipUnchanged(file, zipSha) {
  if (sha256File(file) !== zipSha) throw new Error('候选 zip 字节身份失配，需重新构建');
}

async function assertMatchingReleaseSource(root, cand, manifest, runCommand) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-candidate-source-'));
  try {
    const extracted = path.join(tmp, 'candidate');
    await extractZip(cand.zip, { dir: extracted });
    const framework = path.join(extracted, 'framework');
    assertInZipManifest(framework, cand.manifest);
    const packaged = JSON.parse(fs.readFileSync(path.join(framework, 'RELEASE-MANIFEST.json'), 'utf8'));
    // stage-only 复用 pack 的发布集合、sanitize 和 LF 规则；不重新生成 candidate zip。
    const staged = path.join(tmp, 'source');
    runCommand(process.execPath, ['scripts/pack-release.mjs', '--stage-only', '--out', staged], root);
    const source = JSON.parse(fs.readFileSync(path.join(staged, 'release-staging', 'framework', 'RELEASE-MANIFEST.json'), 'utf8'));
    const files = value => JSON.stringify(value.files.map(entry => [entry.path, entry.sha256]).sort((a, b) => a[0].localeCompare(b[0])));
    if (packaged.version !== manifest.version || source.version !== packaged.version || files(source) !== files(packaged)) {
      throw new Error('受测来源的实际发布集合与 candidate 不一致（含 sanitize/LF）；同 HEAD 不能替代内容一致，需回到候选构建');
    }
    if (manifest.candidate.full_test.source_commit !== packaged.source_commit) {
      throw new Error('候选构建的全量证明与包内源码身份不匹配，需重新构建');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export function buildCandidate({ root = REPO_ROOT, runCommand = run } = {}) {
  const harness = path.join(root, 'harness');
  for (const [name, p] of [['ts-node', path.join(harness, 'node_modules/ts-node/dist/bin.js')], ['typescript', path.join(harness, 'node_modules/typescript/bin/tsc')]]) {
    if (!fs.existsSync(p)) throw new Error(`缺少 ${name}：${p}（先在 harness 下 npm install）`);
  }
  const version = readVersion(root);
  const stagingDir = path.join(candidatesDir(root), '.staging');
  const zipName = `framework-${version}.zip`;
  const stagedZip = path.join(stagingDir, zipName);
  const stagedManifest = path.join(stagingDir, `framework-${version}.manifest.json`);
  const finalPaths = candidatePaths(version, root);

  console.log(`[candidate] build version=${version}（根全量、打包和同 zip 校验及冒烟）`);

  const reportPath = fullReportPath(root);
  fs.rmSync(reportPath, { force: true });
  runCommand(process.execPath, [npmCli(), 'test'], root);
  const result = readPassingRun(reportPath);
  const testedSnapshot = result.inputSnapshot;
  assertSnapshotUnchanged(root, testedSnapshot, '全量结束至打包', runCommand);
  if (readVersion(root) !== version) throw new Error('测试期间候选版本改变，需重新构建');

  // 2–4. pack → verify（跳过发布 plan 门禁）→ 持久化 candidate（staging 生命周期 try/finally 兜住）
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    runCommand(process.execPath, ['scripts/pack-release.mjs', '--out', stagingDir], root);
    const manifest = JSON.parse(fs.readFileSync(stagedManifest, 'utf8'));
    assertReleaseInputs(testedSnapshot, root, manifest.includedFiles);
    const zipSha = manifest.sha256;
    assertZipUnchanged(stagedZip, zipSha);

    runCommand(
      process.execPath,
      [
        'scripts/verify-release-pack.mjs', '--skip-typecheck', '--skip-plan-release-gate',
        '--zip', stagedZip, '--manifest', stagedManifest,
      ],
      root,
    );
    assertZipUnchanged(stagedZip, zipSha);
    assertSnapshotUnchanged(root, testedSnapshot, '打包与校验', runCommand);
    // 持久化：同一字节 zip 改名落 candidates/（rename 不改字节；sha 落 manifest 供 promote 验身份）
    fs.mkdirSync(candidatesDir(root), { recursive: true });
    for (const p of [finalPaths.zip, finalPaths.manifest]) {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
    fs.renameSync(stagedZip, finalPaths.zip);
    manifest.zipPath = `dist/candidates/framework-${version}-candidate.zip`;
    manifest.candidate = {
      status: 'built',
      complete: false,
      built_at: new Date().toISOString(),
      zip_sha256: zipSha,
      full_test: {
        ok: result.ok,
        registered: result.registered,
        executed: result.executed,
        passed: result.passed,
        failed: result.failed,
        missed: result.missed,
        skipped: result.skipped,
        timedOut: result.timedOut,
        infrastructureFailed: result.infrastructureFailed,
        snapshot_id: testedSnapshot.id,
        ending_snapshot_id: result.endingSnapshot.id,
        source_root: root,
        source_commit: testedSnapshot.head,
        zip_sha256: zipSha,
        in_zip_manifest_sha256: manifest.inZipManifest.sha256,
      },
      skipped_gates: ['check-plan-version --release'],
      note: '请保留候选来源及版本窗口直至发布；晋升核查构建全量、包身份、consumer golden 与发布 plan 门禁。',
    };
    fs.writeFileSync(finalPaths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    // T4 收口：candidate 必须先用**刚刚产出的同一字节 zip**跑完整 consumer
    // lifecycle；repack 快速模式不能替代这条证据。smoke 失败时保留 complete=false
    // 的 candidate，promote 永远不能把它当作可发布产物。
    console.log('\n[candidate] consumer lifecycle smoke（同一字节 zip）...');
    runCommand(
      process.execPath,
      ['scripts/smoke-consumer-lifecycle.mjs', '--zip', finalPaths.zip],
      root,
    );
    assertZipUnchanged(finalPaths.zip, zipSha);
    assertSnapshotUnchanged(root, testedSnapshot, '冒烟', runCommand);
    manifest.candidate.complete = true;
    manifest.candidate.smoke_checked_at = new Date().toISOString();
    fs.writeFileSync(finalPaths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(`\n[candidate] BUILT → ${path.relative(root, finalPaths.zip)}`);
    console.log(`[candidate] zip sha256          = ${zipSha}`);
    console.log(`[candidate] in-zip manifest sha = ${manifest.inZipManifest.sha256}`);
    const contractRel = 'framework/harness/scripts/consumer-golden/bc-opencard.golden-contract.json';
    console.log('[candidate] 宿主 golden 回归入口（三步，缺一不可）：');
    console.log('  1) 安装该 zip（非可变 staging 目录）到宿主 framework/；');
    console.log('  2) 核对随包 golden 契约与原始需求一致，再在同一 shell 设采集 env 并跑 goal run：');
    console.log(`     PowerShell:  $env:MAISON_GOLDEN_CONTRACT = '${contractRel}'`);
    console.log(`     bash:        export MAISON_GOLDEN_CONTRACT='${contractRel}'`);
    console.log('     （相对宿主 projectRoot；当前基线为收起态、展开态、全部银行三屏。');
    console.log('       只采契约声明的目标，不要求旧需求的短信、完成页或 HomeTab 专项证据）');
    console.log('  3) 回归完成后用包内 evaluator 裁决（PASS 才回来 candidate:promote）：');
    console.log('       npx ts-node harness/scripts/consumer-golden/evaluate-bc-opencard.ts \\');
    console.log(`         --project-root <hostRoot> --run-id <goalRunId> --feature <宿主 feature 目录名> --expected-manifest-sha ${manifest.inZipManifest.sha256}`);
    console.log('     （`--feature` 缺省 `bc-openCard`——宿主 doc/features/ 下的目录名不是它时必须显式传，');
    console.log('       否则 featureDir / build 指纹 / coding 素材门三处都读不存在的路径，run_binding 必 FAIL）');
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// promote
// ---------------------------------------------------------------------------

/** @param {string[]} argv */
export async function promoteCandidate(argv, { root = REPO_ROOT, runCommand = run } = {}) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const option = argv[i];
    const value = argv[i + 1];
    if (option !== '--evaluator-report' && option !== '--source-root') throw new Error(`不支持的晋升参数：${option}`);
    if (!value || value.startsWith('--') || values.has(option)) throw new Error(`${option} 需要且只接受一个路径`);
    values.set(option, path.resolve(value));
  }
  const rootForVersion = values.get('--source-root') ?? root;
  let version;
  try { version = readVersion(rootForVersion); }
  catch { throw new Error('无法读取候选来源的 package.json，请指定候选对应的来源目录'); }
  const cand = candidatePaths(version, root);
  const evalReportPath = values.get('--evaluator-report');

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

  const full = manifest.candidate.full_test;
  if (!hasPassingCounts(full) || !isSha256(full.snapshot_id) || full.ending_snapshot_id !== full.snapshot_id
    || full.zip_sha256 !== zipSha || !isSha256(full.in_zip_manifest_sha256)
    || full.in_zip_manifest_sha256 !== manifest.inZipManifest?.sha256) {
    throw new Error('候选缺少与此 zip 绑定的构建全量通过证明，需重新构建候选');
  }

  // ② consumer golden evaluator PASS（G3：evaluator PASS → promote 同一 candidate）
  if (manifest.candidate?.complete !== true) {
    throw new Error(
      'candidate complete !== true：必须先用同一字节 zip 通过 consumer lifecycle smoke，禁止 promote',
    );
  }

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

  let sourceRoot;
  try { sourceRoot = fs.realpathSync(values.get('--source-root') ?? full.source_root); }
  catch { throw new Error('候选来源不存在，请用 --source-root 指定对应版本及发布内容的来源目录'); }
  await assertMatchingReleaseSource(sourceRoot, cand, manifest, runCommand);
  assertZipUnchanged(cand.zip, zipSha);

  console.log('\n[candidate] promote：执行 check-plan-version --release ...');
  try {
    runCommand(process.execPath, ['scripts/check-plan-version.mjs', '--release'], sourceRoot);
  } catch (error) {
    assertZipUnchanged(cand.zip, zipSha);
    manifest.candidate.status = 'eligible';
    manifest.candidate.eligible_at = new Date().toISOString();
    manifest.candidate.eligible_note =
      `正式全量、consumer golden 与 zip 身份已过，但全局发布 plan 门禁未过：${error.message}；只标 eligible，待 plan 完结后重跑 promote。`;
    fs.writeFileSync(cand.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.error('\n[candidate] 发布 plan 门禁未过：candidate 保留 eligible。');
    throw new Error('发布 plan 门禁未过，candidate 保留 eligible');
  }

  // 晋升移动原 zip，保持宿主验收过的字节。
  assertZipUnchanged(cand.zip, zipSha);
  const distDir = path.join(root, 'dist');
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
  manifest.candidate.skipped_gates = [];
  manifest.candidate.promoted_at = new Date().toISOString();
  manifest.candidate.evaluator_report = path.resolve(evalReportPath).replace(/\\/g, '/');
  fs.writeFileSync(finalManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.rmSync(cand.manifest, { force: true });

  console.log(`\n[candidate] PROMOTED（同一字节 zip，sha=${promotedSha.slice(0, 12)}…）→ dist/framework-${version}.zip`);
}

// ---------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const sub = process.argv[2];
    if (sub === 'build') {
      if (process.argv.length !== 3) throw new Error('candidate build 不接受参数');
      buildCandidate();
    }
    else if (sub === 'promote') await promoteCandidate(process.argv.slice(3));
    else {
      console.error('用法：node scripts/candidate-release.mjs <build|promote> [promote: --evaluator-report <path> --source-root <受测源目录>]');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`\n[candidate] ${err.message}`);
    process.exitCode = 1;
  }
}
