#!/usr/bin/env node
// candidate-release.mjs — candidate 发布模式（plan c4e8b1d3 Todo 4）
//
// candidate = **持久化 zip + sidecar manifest + zip sha256**（不是可变 staging 目录）。
// 现状不能原样复用的三条已核实：--stage-only 只建目录无 zip/hash；正常 pack 打完 zip 即删
// staging；release:all 第一步就是 check-plan-version --release（被在研 plan 拦截）且 verify
// 通过立即 promote。
//
// 两个子命令：
//   build   日常全集 + pack + 同 zip verify/smoke；正式全量与最终 plan 门禁留给 promote。
//           产出持久化 candidate zip 到
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
const reportPath = (root, scope) => path.join(root, 'harness', 'reports', 'test-run', `${scope}.json`);

// 使用 runner 自己的 InputSnapshot 算法，不维护第二份输入排除或哈希规则。
function readInputSnapshot(root, runCommand) {
  const loader = path.join(root, 'harness', 'node_modules', 'ts-node', 'dist', 'bin.js');
  const code = "process.stdout.write(JSON.stringify(require('./tests/utils/test-impact').snapshotTestInputs()))";
  return JSON.parse(runCommand(process.execPath, [loader, '--transpile-only', '-e', code], path.join(root, 'harness'), { capture: true }));
}

function readPassingRun(root, scope, snapshot, runCommand) {
  const file = reportPath(root, scope);
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  const selected = result.plan?.selected?.map(item => item.group.id);
  const actual = result.groups;
  if (result.scope !== scope || result.full !== (scope === 'full') || result.ok !== true
    || result.inputSnapshot?.id !== snapshot.id || result.endingSnapshotId !== snapshot.id
    || result.plan?.scope !== scope || result.plan?.full !== (scope === 'full')
    || !Array.isArray(selected) || selected.length === 0 || !Array.isArray(result.plan?.reused) || result.plan.reused.length
    || !Array.isArray(actual) || actual.length !== selected.length
    || new Set(selected).size !== selected.length
    || actual.some(group => !selected.includes(group.id) || group.ok !== true || group.status !== 'completed')
    || new Set(actual.map(group => group.id)).size !== actual.length
    || result.inputSnapshot?.head !== snapshot.head
    || JSON.stringify(Object.entries(result.inputSnapshot?.files ?? {}).sort()) !== JSON.stringify(Object.entries(snapshot.files).sort())) {
    throw new Error(`${scope} 测试证明无效：需要本次同一稳定输入、完整执行且通过的 ${scope} 结果（${file}）`);
  }
  if (scope === 'full') {
    let state;
    try { state = JSON.parse(fs.readFileSync(path.join(root, 'harness/reports/test-run/results.json'), 'utf8')); }
    catch { throw new Error('正式全量缺少可读取的 results.json completeRun 通过事实，daily/changed 不能升级为 full'); }
    if (state.completeRun?.snapshotId !== snapshot.id || state.completeRun?.ok !== true) {
      throw new Error('正式全量缺少同一 InputSnapshot 的 completeRun 通过事实，daily/changed 不能升级为 full');
    }
  }
  const branch = runCommand('git', ['branch', '--show-current'], root, { capture: true }).trim();
  return { scope, snapshot_id: snapshot.id, source_root: root, source_commit: snapshot.head, source_branch: branch || '(detached)', result_path: file };
}

function assertReleaseInputs(snapshot, root, files) {
  const missing = files.filter(file => snapshot.files[file] !== sha256File(path.join(root, file)));
  if (missing.length) throw new Error(`发布源文件未被受测 InputSnapshot 覆盖：${missing.slice(0, 5).join(', ')}`);
}

function assertFrozenSource(root, snapshot, cand, zipSha, runCommand) {
  if (readInputSnapshot(root, runCommand).id !== snapshot.id) throw new Error('正式测试后来源输入已改变，不得晋升');
  if (sha256File(cand.zip) !== zipSha) throw new Error('正式测试期间 candidate zip 已改变，不得晋升');
}

async function assertMatchingReleaseSource(root, cand, manifest, snapshot, runCommand) {
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
    assertReleaseInputs(snapshot, root, source.files.map(entry => entry.path));
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

  console.log(`[candidate] build version=${version}（日常全集；正式全量与发布 plan 门禁由 promote 补齐）`);

  runCommand(process.execPath, [npmCli(), 'run', 'test:daily'], harness);
  const testedSnapshot = readInputSnapshot(root, runCommand);
  const daily = readPassingRun(root, 'daily', testedSnapshot, runCommand);

  // 2–4. pack → verify（跳过发布 plan 门禁）→ 持久化 candidate（staging 生命周期 try/finally 兜住）
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    runCommand(process.execPath, ['scripts/pack-release.mjs', '--out', stagingDir], root);
    runCommand(
      process.execPath,
      [
        'scripts/verify-release-pack.mjs', '--skip-typecheck', '--skip-plan-release-gate',
        '--zip', stagedZip, '--manifest', stagedManifest,
      ],
      root,
    );
    if (readInputSnapshot(root, runCommand).id !== testedSnapshot.id) throw new Error('候选打包期间测试输入改变，需重新构建');

    const manifest = JSON.parse(fs.readFileSync(stagedManifest, 'utf8'));
    assertReleaseInputs(testedSnapshot, root, manifest.includedFiles);
    const zipSha = sha256File(stagedZip);
    if (zipSha !== manifest.sha256) {
      throw new Error(`candidate zip sha 与 pack manifest 不一致：${zipSha} vs ${manifest.sha256}`);
    }
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
      daily_test: daily,
      skipped_gates: ['npm test (full)', 'check-plan-version --release'],
      note: 'candidate 已通过日常全集；正式全量、最终发布 plan 门禁及 consumer golden PASS 后才可晋升同一字节 zip。请保留此受测来源，含未提交改动时仅 source_commit 无法还原。',
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
    if (readInputSnapshot(root, runCommand).id !== testedSnapshot.id) throw new Error('候选冒烟期间测试输入改变，需重新构建');
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
  const sourceIdx = argv.indexOf('--source-root');
  if (sourceIdx >= 0 && (!argv[sourceIdx + 1] || argv[sourceIdx + 1].startsWith('--'))) throw new Error('--source-root 需要候选对应的受测源目录');
  const explicitSource = sourceIdx >= 0 ? path.resolve(argv[sourceIdx + 1]) : undefined;
  // 主干可已进入下一版本；显式来源决定所晋升候选的版本。
  let version;
  try { version = readVersion(explicitSource ?? root); }
  catch { throw new Error('无法读取候选来源的 package.json；请指定保留的受测来源，来源缺失时需重新构建'); }
  const cand = candidatePaths(version, root);
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

  // ③ 正式全量只接受候选对应的相同输入；主干前进时可指定保留的隔离副本。
  let sourceRoot;
  try { sourceRoot = fs.realpathSync(explicitSource ?? manifest.candidate?.daily_test?.source_root ?? root); }
  catch { throw new Error('候选受测来源不存在；请用 --source-root 指定保留副本，脏候选无法仅由 source_commit 还原，来源缺失时需重新构建'); }
  const expectedSnapshotId = manifest.candidate?.daily_test?.snapshot_id;
  if (!expectedSnapshotId) throw new Error('candidate 缺少日常受测输入来源，需重新构建候选');
  const snapshot = readInputSnapshot(sourceRoot, runCommand);
  // dev-only plan/测试可继续变化；完整证明仍必须绑定本次来源的全部稳定输入。
  // 发布文件则逐字节匹配候选，不能仅凭 daily 的 HEAD 或 source_commit 认定同源。
  await assertMatchingReleaseSource(sourceRoot, cand, manifest, snapshot, runCommand);
  assertFrozenSource(sourceRoot, snapshot, cand, zipSha, runCommand);
  let full;
  try { full = readPassingRun(sourceRoot, 'full', snapshot, runCommand); }
  catch {
    console.log('\n[candidate] promote：在匹配的受测来源补正式完整 npm test ...');
    runCommand(process.execPath, [npmCli(), 'test'], path.join(sourceRoot, 'harness'));
    full = readPassingRun(sourceRoot, 'full', snapshot, runCommand);
  }
  assertFrozenSource(sourceRoot, snapshot, cand, zipSha, runCommand);
  manifest.candidate.full_test = { ...full, checked_at: new Date().toISOString() };
  manifest.candidate.skipped_gates = ['check-plan-version --release'];

  // ④ 补最终发布 plan 门禁——只有正式全量已过才可标 eligible，不绕过门禁。
  console.log('\n[candidate] promote：补跑 check-plan-version --release ...');
  try {
    runCommand(process.execPath, ['scripts/check-plan-version.mjs', '--release'], sourceRoot);
  } catch (error) {
    assertFrozenSource(sourceRoot, snapshot, cand, zipSha, runCommand);
    manifest.candidate.status = 'eligible';
    manifest.candidate.eligible_at = new Date().toISOString();
    manifest.candidate.eligible_note =
      `正式全量、consumer golden 与 zip 身份已过，但全局发布 plan 门禁未过：${error.message}；只标 eligible，待 plan 完结后重跑 promote。`;
    fs.writeFileSync(cand.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.error('\n[candidate] 发布 plan 门禁未过：candidate 标记为 **eligible**（不 promote，不绕过全局发布门禁）。');
    throw new Error('发布 plan 门禁未过，candidate 保留 eligible');
  }

  // ⑤ 移动同一字节对象到 dist/ 正式名（rename，不重新 pack）
  assertFrozenSource(sourceRoot, snapshot, cand, zipSha, runCommand);
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
    if (sub === 'build') buildCandidate();
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
