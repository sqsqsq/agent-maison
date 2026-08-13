#!/usr/bin/env node
// verify-release-pack.mjs — 规则单测 + 临时目录打包/解压/断言
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { packRelease } from './pack-release.mjs';
import { checkStaleInitRefs, formatStaleInitRefHits } from './check-stale-init-refs.mjs';
import { checkPlanVersions, formatPlanVersionHits } from './check-plan-version.mjs';
import {
  checkNoNumberedSkillRelease,
  formatNoNumberedSkillHits,
} from './check-no-numbered-skill-release.mjs';
import {
  checkStaleDevecoProjectGuidance,
  formatStaleDevecoProjectGuidanceHits,
  runSyntheticDevecoGuidanceTests,
} from './check-stale-deveco-project-guidance.mjs';
import {
  isProbablyBinaryBuffer,
  isReleaseBinaryRelPath,
  loadReleaseExcludes,
  matchGlob,
  runSyntheticRuleTests,
  toPosixPath,
} from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** @param {string} msg */
function fail(msg) {
  throw new Error(msg);
}

/** @param {string} root @param {string} rel */
function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

/** @param {string} dir */
function listAllFiles(dir, prefix = '') {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listAllFiles(abs, rel));
    } else {
      out.push(toPosixPath(rel));
    }
  }
  return out;
}

/** @param {string} frameworkRoot */
function assertReleaseTextUsesLf(frameworkRoot) {
  const offenders = [];
  for (const rel of listAllFiles(frameworkRoot)) {
    if (isReleaseBinaryRelPath(rel)) continue;
    const abs = path.join(frameworkRoot, rel);
    const buf = fs.readFileSync(abs);
    if (isProbablyBinaryBuffer(buf)) continue;
    if (buf.includes('\r')) offenders.push(rel);
  }
  if (offenders.length > 0) {
    const sample = offenders.slice(0, 10).join(', ');
    const suffix = offenders.length > 10 ? ` (+${offenders.length - 10} more)` : '';
    fail(`release text files must use LF only; CRLF found in: ${sample}${suffix}`);
  }
}

/** @param {string} frameworkRoot */
function assertZipContents(frameworkRoot) {
  const mustNotExist = [
    'AGENTS.md',
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    'openspec',
    'scripts',
    'harness/tests',
    'RELEASE-NOTES-v1.0.md',
    'RELEASE-NOTES-v2.0.md',
    'MAINTAINER-CHANGELOG.md',
  ];
  for (const rel of mustNotExist) {
    if (exists(frameworkRoot, rel)) {
      fail(`must not exist in zip: ${rel}`);
    }
  }

  if (exists(frameworkRoot, '.cursor')) {
    fail('must not exist in zip: .cursor/');
  }
  if (exists(frameworkRoot, 'temp')) {
    fail('must not exist in zip: temp/');
  }

  const allFiles = listAllFiles(frameworkRoot);
  for (const f of allFiles) {
    if (matchGlob('profiles/*/harness/tests/**', f)) {
      fail(`profile harness test leaked: ${f}`);
    }
    if (f.includes('node_modules/') || f.endsWith('package-lock.json')) {
      fail(`runtime artifact leaked: ${f}`);
    }
    if (
      f.startsWith('profiles/hmos-app/vendor/hylyre/')
      && f.endsWith('.md')
      && f !== 'profiles/hmos-app/vendor/hylyre/README.md'
    ) {
      fail(`vendor handover md leaked: ${f}`);
    }
  }

  const vendorManifestPath = path.join(
    frameworkRoot,
    'profiles/hmos-app/vendor/hylyre/release.manifest.json',
  );
  if (fs.existsSync(vendorManifestPath)) {
    const vendorManifest = JSON.parse(fs.readFileSync(vendorManifestPath, 'utf8'));
    if (vendorManifest.integration_docs) {
      fail('staging vendor manifest must not contain integration_docs');
    }
  }

  const mustExist = [
    'README.md',
    'MIGRATION.md',
    'harness/tsconfig.typecheck.json',
    'harness/scripts/check-init.ts',
    'harness/reports/.gitkeep',
    'harness/state/.gitkeep',
    'harness/trace/trace.schema.json',
    'harness/trace/gap-notes.template.md',
    'templates/AGENTS.md.template',
    'profiles/hmos-app/vendor/hylyre/release.manifest.json',
  ];
  for (const rel of mustExist) {
    if (!exists(frameworkRoot, rel)) {
      fail(`must exist in zip: ${rel}`);
    }
  }

  if (!exists(frameworkRoot, 'harness/schemas') && !allFiles.some(f => f.startsWith('harness/schemas/'))) {
    const schemasDir = path.join(REPO_ROOT, 'harness/schemas');
    if (fs.existsSync(schemasDir)) {
      fail('harness/schemas/ missing from zip');
    }
  }

  const pkgPath = path.join(frameworkRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) fail('package.json missing');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const key of Object.keys(pkg.scripts ?? {})) {
    if (key.startsWith('release:')) fail(`sanitized package.json still has script: ${key}`);
  }
  if (pkg.devDependencies?.archiver || pkg.devDependencies?.['extract-zip']) {
    fail('sanitized package.json still has release devDependencies');
  }
  if (!pkg.scripts?.test || !pkg.scripts?.['harness:install']) {
    fail('sanitized package.json missing consumer scripts');
  }

  const harnessPkgPath = path.join(frameworkRoot, 'harness/package.json');
  if (!fs.existsSync(harnessPkgPath)) fail('harness/package.json missing');
  const harnessPkg = JSON.parse(fs.readFileSync(harnessPkgPath, 'utf8'));
  if (harnessPkg.scripts?.['test:unit']) {
    fail('sanitized harness/package.json still has test:unit');
  }
  if (harnessPkg.scripts?.['test:fixtures']) {
    fail('sanitized harness/package.json still has test:fixtures');
  }
  if (!harnessPkg.scripts?.['check:global']) {
    fail('sanitized harness/package.json missing check:global');
  }
  if (harnessPkg.scripts?.test !== 'npm run check:global') {
    fail(`sanitized harness/package.json test must be "npm run check:global", got: ${harnessPkg.scripts?.test}`);
  }
  if (!harnessPkg.scripts?.typecheck) {
    fail('sanitized harness/package.json must retain typecheck script for consumer self-diagnosis');
  }
  if (harnessPkg.scripts.typecheck !== 'tsc --noEmit -p tsconfig.typecheck.json') {
    fail(`sanitized harness/package.json typecheck must point at tsconfig.typecheck.json, got: ${harnessPkg.scripts.typecheck}`);
  }
}

/** @param {string} filePath */
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * t7（f3a8c6d2）包身份字段校验（纯函数，供单测直接驱动）：
 * - source_commit：非空 40 位小写 hex（打包源仓 HEAD commit）；
 * - built_at：**严格** UTC ISO-8601——形状须为 `YYYY-MM-DDTHH:mm:ss(.mmm)?Z` 且
 *   日期确实有效时 `new Date(v).toISOString() === v` 往返一致。杜绝 Date.parse 的
 *   宽松归一：`2026-08-13Z`、`08/13/2026 07:00:00Z`、以及 `2026-02-30T00:00:00.000Z`
 *   （被归一到三月）全部判非法；**形状合法但日期无效（如 `2026-13-01T00:00:00.000Z`
 *   的 13 月）必须先经 `Number.isNaN(date.getTime())` 判定为非法再比较往返**——
 *   Date 无效时直接 `.toISOString()` 会抛 RangeError 而非返回 identity 错误。
 *   生成端固定写 toISOString()，合法值必含毫秒；往返校验要求的值域 == 生成端值域，
 *   无平行格式。
 * 两项任一缺失/格式非法即禁止该包通过发布门；旧包缺字段按 FAIL 处理（旧包不再
 * 走本门，重新发布即可带上身份），消费者侧则只如实显示 unknown、不阻断。
 * @param {unknown} manifest 包内 RELEASE-MANIFEST.json 已解析对象
 * @returns {string[]} 错误列表；空数组=合法
 */
const UTC_ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** 形状已通过时再验语义：构造 Date，无效日期（NaN）直接非法，有效再比往返一致。
 * 返回 true=非法。绝不抛异常——校验器是发布门，任何输入都须以错误数组回应。 */
function isInvalidUtcIso(value) {
  let date;
  try {
    date = new Date(value);
  } catch {
    return true;
  }
  if (Number.isNaN(date.getTime())) return true;
  return date.toISOString() !== value;
}

export function validateReleaseIdentityFields(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest 非对象'];
  }
  const { source_commit, built_at } = manifest;
  if (typeof source_commit !== 'string' || !/^[0-9a-f]{40}$/.test(source_commit.trim())) {
    errors.push(`source_commit 缺失或非 40 位小写 hex（实际=${JSON.stringify(source_commit)}）`);
  } else if (source_commit !== source_commit.trim()) {
    errors.push('source_commit 不得含首尾空白');
  }
  if (
    typeof built_at !== 'string' ||
    !UTC_ISO_SHAPE.test(built_at) ||
    isInvalidUtcIso(built_at)
  ) {
    errors.push(`built_at 缺失或非严格 UTC ISO-8601（实际=${JSON.stringify(built_at)}）`);
  }
  return errors;
}

/**
 * c1: 校验包内 RELEASE-MANIFEST.json —— 存在性 + 逐文件哈希自洽 + 覆盖完整 + sidecar 链式引用。
 * （导出供 G3b 单测直接驱动——release:verify 主流程的 plan 门禁在本断言之前，源仓有 open plan
 * 时走不到这里，测试需要独立入口。）
 * @param {string} frameworkRoot 解包后的 framework/ 根
 * @param {string} sidecarManifestPath dist sidecar manifest 绝对路径
 */
export function assertInZipManifest(frameworkRoot, sidecarManifestPath) {
  const manifestRel = 'RELEASE-MANIFEST.json';
  const manifestAbs = path.join(frameworkRoot, manifestRel);
  if (!fs.existsSync(manifestAbs)) fail('in-zip RELEASE-MANIFEST.json missing');
  const manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('in-zip manifest has no files[]');
  }

  // t7（f3a8c6d2）：包身份字段（source_commit / built_at）存在且格式合法
  const identityErrors = validateReleaseIdentityFields(manifest);
  if (identityErrors.length > 0) {
    fail(`in-zip manifest identity: ${identityErrors.join('; ')}`);
  }

  // per-file 哈希自洽：每个 files[] 与解包文件字节一致（防漂移门禁的 SSOT）
  const mismatches = [];
  for (const entry of manifest.files) {
    const abs = path.join(frameworkRoot, entry.path);
    if (!fs.existsSync(abs)) { mismatches.push(`missing: ${entry.path}`); continue; }
    if (sha256File(abs) !== entry.sha256) mismatches.push(`hash-mismatch: ${entry.path}`);
  }
  if (mismatches.length > 0) {
    fail(`in-zip manifest integrity: ${mismatches.length} issue(s): ${mismatches.slice(0, 10).join(', ')}`);
  }

  // 覆盖完整（G3b 排除集扩为双元素——包内 sidecar 不入 files[]，防 manifest↔sidecar 循环依赖）：
  // manifest.files 恰好 == 解包全部文件 \ {RELEASE-MANIFEST.json, RELEASE-MANIFEST.sha256}
  const inZipSidecarRel = 'RELEASE-MANIFEST.sha256';
  const shipped = new Set(
    listAllFiles(frameworkRoot).filter(f => f !== manifestRel && f !== inZipSidecarRel),
  );
  const covered = new Set(manifest.files.map(f => f.path));
  const uncovered = [...shipped].filter(f => !covered.has(f));
  const extra = [...covered].filter(f => !shipped.has(f));
  if (uncovered.length > 0) fail(`in-zip manifest missing coverage: ${uncovered.slice(0, 10).join(', ')}`);
  if (extra.length > 0) fail(`in-zip manifest lists non-shipped: ${extra.slice(0, 10).join(', ')}`);

  // G3b 包内 sidecar：存在 + 格式（一行 64 位小写 hex + 末尾 LF）+ 内容 = manifest 原始字节 sha256
  const inZipSidecarAbs = path.join(frameworkRoot, inZipSidecarRel);
  if (!fs.existsSync(inZipSidecarAbs)) fail('in-zip RELEASE-MANIFEST.sha256 sidecar missing');
  const sidecarText = fs.readFileSync(inZipSidecarAbs, 'utf8');
  if (!/^[0-9a-f]{64}\n$/.test(sidecarText)) {
    fail(`in-zip sidecar malformed (expect single 64-hex line + LF): ${JSON.stringify(sidecarText.slice(0, 80))}`);
  }
  if (sidecarText.trim() !== sha256File(manifestAbs)) {
    fail('in-zip RELEASE-MANIFEST.sha256 does not match manifest bytes');
  }

  // sidecar 链式引用：dist manifest.inZipManifest.sha256 == 包内 manifest 自身 hash
  const sidecar = JSON.parse(fs.readFileSync(sidecarManifestPath, 'utf8'));
  if (!sidecar.inZipManifest || sidecar.inZipManifest.sha256 !== sha256File(manifestAbs)) {
    fail('dist sidecar inZipManifest.sha256 mismatch with in-zip RELEASE-MANIFEST.json');
  }
  console.log(`[release:verify] in-zip manifest integrity PASS (${manifest.files.length} files, sidecar ok)`);
}

/**
 * @param {{ skipTypecheck?: boolean, externalZip?: string | null, externalManifest?: string | null, skipPlanReleaseGate?: boolean }} [opts]
 *   skipTypecheck：聚合链路（release:all）已单独跑 typecheck 时跳过，避免重复；
 *   externalZip/externalManifest：校验「已 pack 的产物」而非自 pack→extract（pack→verify 只打一次 zip）；
 *   skipPlanReleaseGate：candidate 模式（c4e8b1d3 Todo 4）**唯一**允许跳过的门——
 *     「最终发布 plan 完成门禁」；promote 时必须补跑（candidate-release.mjs promote 强制）。
 *     其余校验（zip 内容/manifest 链/文本 EOL/stale 扫描）一律照跑。
 */
export async function verifyReleasePack(opts = {}) {
  const { skipTypecheck = false, externalZip = null, externalManifest = null, skipPlanReleaseGate = false } = opts;
  const rules = loadReleaseExcludes();

  if (skipTypecheck) {
    console.log('[release:verify] typecheck SKIPPED (--skip-typecheck；聚合链路已单独跑)');
  } else {
    console.log('[release:verify] typecheck (tsc --noEmit)...');
    const tc = spawnSync('npm', ['run', 'typecheck'], {
      cwd: path.join(REPO_ROOT, 'harness'),
      stdio: 'inherit',
      shell: true,
    });
    if (tc.status !== 0) fail('typecheck (tsc --noEmit) failed');
    console.log('[release:verify] typecheck PASS');
  }

  console.log('[release:verify] adapter catalog consistency (source root)...');
  const catalogSrc = spawnSync(
    'npx',
    ['ts-node', '--transpile-only', 'scripts/check-adapter-catalog-consistency.ts', '--framework-root', REPO_ROOT],
    { cwd: path.join(REPO_ROOT, 'harness'), stdio: 'inherit', shell: true },
  );
  if (catalogSrc.status !== 0) fail('adapter catalog consistency (source root) failed');
  console.log('[release:verify] adapter catalog consistency (source root) PASS');

  console.log('[release:verify] skills.index init_next_steps lint (source root)...');
  const skillsIndexLint = spawnSync(
    'npx',
    ['ts-node', '--transpile-only', 'scripts/check-skills-index-init-steps.ts', '--framework-root', REPO_ROOT],
    { cwd: path.join(REPO_ROOT, 'harness'), stdio: 'inherit', shell: true },
  );
  if (skillsIndexLint.status !== 0) fail('skills.index init_next_steps lint (source root) failed');
  console.log('[release:verify] skills.index init_next_steps lint (source root) PASS');

  console.log('[release:verify] synthetic rule tests...');
  const synthErrors = runSyntheticRuleTests(REPO_ROOT, rules);
  if (synthErrors.length > 0) {
    for (const e of synthErrors) console.error(`  FAIL: ${e}`);
    fail(`synthetic rule tests: ${synthErrors.length} error(s)`);
  }
  console.log('[release:verify] synthetic rule tests PASS');

  console.log('[release:verify] stale init refs scan...');
  const stale = checkStaleInitRefs(REPO_ROOT);
  if (!stale.ok) {
    console.error('[release:verify] stale init refs FAIL:\n' + formatStaleInitRefHits(stale.hits));
    fail(`stale init refs: ${stale.hits.length} hit(s) in release content`);
  }
  console.log('[release:verify] stale init refs PASS');

  console.log('[release:verify] stale deveco project-guidance scan...');
  const devecoSynth = runSyntheticDevecoGuidanceTests();
  if (devecoSynth.length > 0) {
    for (const e of devecoSynth) console.error(`  FAIL: ${e}`);
    fail(`stale deveco project-guidance synthetic: ${devecoSynth.length} error(s)`);
  }
  const devecoGuidance = checkStaleDevecoProjectGuidance(REPO_ROOT);
  if (!devecoGuidance.ok) {
    console.error(
      '[release:verify] stale deveco project-guidance FAIL:\n' +
        formatStaleDevecoProjectGuidanceHits(devecoGuidance.hits),
    );
    fail(`stale deveco project-guidance: ${devecoGuidance.hits.length} hit(s) in release content`);
  }
  console.log('[release:verify] stale deveco project-guidance PASS');

  if (skipPlanReleaseGate) {
    console.log('[release:verify] plan version (--release) SKIPPED (--skip-plan-release-gate；candidate 模式，promote 时补跑)');
  } else {
    console.log('[release:verify] plan version (--release)...');
    const planVer = checkPlanVersions({ mode: 'release' });
    if (!planVer.ok) {
      console.error('[release:verify] plan version FAIL:\n' + formatPlanVersionHits(planVer.hits));
      fail(`plan version: ${planVer.hits.length} hit(s)`);
    }
    console.log('[release:verify] plan version PASS');
  }

  // 复用「已 pack 的产物」（externalZip，聚合链路 pack→verify 只打一次 zip），或自 pack 到临时目录（默认自包含）
  const tmpOut = externalZip ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'am-release-verify-'));
  try {
    let zipPath;
    let manifestPath;
    if (externalZip) {
      zipPath = path.resolve(externalZip);
      // sidecar manifest（assertInZipManifest 的链式校验需它）：--manifest 指定，或与 zip 同目录同名 .manifest.json
      manifestPath = externalManifest
        ? path.resolve(externalManifest)
        : zipPath.replace(/\.zip$/, '.manifest.json');
      if (!fs.existsSync(zipPath)) fail(`--zip 不存在：${zipPath}`);
      if (!fs.existsSync(manifestPath)) {
        fail(`sidecar manifest 不存在：${manifestPath}（用 --manifest 指定，或置于 zip 同目录同名 .manifest.json）`);
      }
      console.log(`[release:verify] verifying existing zip ${zipPath}`);
    } else {
      console.log(`[release:verify] packing to ${tmpOut}...`);
      const packed = await packRelease({ dryRun: false, outDir: tmpOut });
      zipPath = packed.zipPath;
      manifestPath = packed.manifestPath;
      if (!zipPath || !fs.existsSync(zipPath)) fail('pack did not produce zip');
    }

    const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-release-extract-'));
    try {
      const { default: extract } = await import('extract-zip');
      await extract(zipPath, { dir: extractRoot });

      const top = fs.readdirSync(extractRoot);
      if (top.length !== 1 || top[0] !== 'framework') {
        fail(`zip top-level must be only framework/, got: ${top.join(', ')}`);
      }

      const frameworkRoot = path.join(extractRoot, 'framework');
      assertZipContents(frameworkRoot);
      assertReleaseTextUsesLf(frameworkRoot);
      assertInZipManifest(frameworkRoot, manifestPath);

      console.log('[release:verify] numbered skill path/prose scan...');
      const numbered = checkNoNumberedSkillRelease(frameworkRoot);
      if (!numbered.ok) {
        console.error(
          '[release:verify] numbered skill FAIL:\n' + formatNoNumberedSkillHits(numbered.hits),
        );
        fail(`numbered skill path/prose: ${numbered.hits.length} hit(s) in release zip`);
      }
      console.log('[release:verify] numbered skill path/prose PASS');

      console.log('[release:verify] adapter catalog consistency (extracted framework root)...');
      const catalogZip = spawnSync(
        'npx',
        ['ts-node', '--transpile-only', 'scripts/check-adapter-catalog-consistency.ts', '--framework-root', frameworkRoot],
        { cwd: path.join(REPO_ROOT, 'harness'), stdio: 'inherit', shell: true },
      );
      if (catalogZip.status !== 0) fail('adapter catalog consistency (extracted framework root) failed');
      console.log('[release:verify] adapter catalog consistency (extracted framework root) PASS');

      console.log('[release:verify] skills.index init_next_steps lint (extracted framework root)...');
      const skillsIndexZip = spawnSync(
        'npx',
        ['ts-node', '--transpile-only', 'scripts/check-skills-index-init-steps.ts', '--framework-root', frameworkRoot],
        { cwd: path.join(REPO_ROOT, 'harness'), stdio: 'inherit', shell: true },
      );
      if (skillsIndexZip.status !== 0) {
        fail('skills.index init_next_steps lint (extracted framework root) failed');
      }
      console.log('[release:verify] skills.index init_next_steps lint (extracted framework root) PASS');

      console.log('[release:verify] zip content assertions PASS');
    } finally {
      fs.rmSync(extractRoot, { recursive: true, force: true });
    }
  } finally {
    if (tmpOut) fs.rmSync(tmpOut, { recursive: true, force: true });
  }

  console.log('[release:verify] ALL PASS');
}

/** @param {string[]} argv */
function parseVerifyArgs(argv) {
  const opts = { skipTypecheck: false, externalZip: null, externalManifest: null, skipPlanReleaseGate: false };
  /** 取 flag 的值参数；缺值或下一个又是 flag 时 fail-fast（避免 `--zip --manifest x` 把 `--manifest` 误当路径） */
  const takeValue = (flag, i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      console.error(`[release:verify] ${flag} 需要一个路径参数`);
      process.exit(2);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skip-typecheck') {
      opts.skipTypecheck = true;
    } else if (a === '--skip-plan-release-gate') {
      opts.skipPlanReleaseGate = true;
    } else if (a === '--zip') {
      opts.externalZip = takeValue('--zip', i);
      i += 1;
    } else if (a === '--manifest') {
      opts.externalManifest = takeValue('--manifest', i);
      i += 1;
    } else {
      console.error(`[release:verify] 未知参数：${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verifyReleasePack(parseVerifyArgs(process.argv.slice(2))).catch(err => {
    console.error('[release:verify] FAIL:', err.message);
    process.exit(1);
  });
}
