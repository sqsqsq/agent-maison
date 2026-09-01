#!/usr/bin/env node
// pack-release.mjs — 产出 framework-<semver>.zip + sidecar manifest
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import {
  collectReleaseFiles,
  loadReleaseExcludes,
  normalizeReleaseTextEol,
  sanitizeHarnessPackageJson,
  sanitizePackageJson,
  sanitizeVendorManifest,
  stageReleaseFile,
  toPosixPath,
} from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FRAMEWORK_DIR_NAME = 'framework';
const EXCLUDED_SAMPLE_LIMIT = 50;

/** @param {string[]} argv */
function parseArgs(argv) {
  let dryRun = false;
  let stageOnly = false;
  let outDir = path.join(REPO_ROOT, 'dist');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') dryRun = true;
    if (argv[i] === '--stage-only') stageOnly = true;
    if (argv[i] === '--out' && argv[i + 1]) {
      outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return { dryRun, stageOnly, outDir };
}

function readVersion() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error('package.json missing version');
  }
  return pkg.version;
}

// t7（f3a8c6d2）包身份：source_commit=打包源仓 HEAD commit（40 位小写 hex）。
// 发布件必须能追溯到打包时刻的源仓提交——缺 git 环境属于发布链配置错误，fail-fast。
function resolveSourceCommit() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.status !== 0 || !/^[0-9a-f]{40}$/.test((r.stdout ?? '').trim())) {
    throw new Error(`无法解析打包源仓 HEAD commit（source_commit）：${(r.stderr ?? r.stdout ?? '').trim() || '非 git 检出'}`);
  }
  return r.stdout.trim();
}

/**
 * @param {string} stagingRoot dist/release-staging/framework
 * @param {string[]} included paths relative repo root
 */
function writeStaging(stagingRoot, included) {
  fs.mkdirSync(stagingRoot, { recursive: true });
  for (const rel of included) {
    const src = path.join(REPO_ROOT, rel);
    const dest = path.join(stagingRoot, rel);
    stageReleaseFile(src, dest, rel);
  }

  const pkgSrc = path.join(REPO_ROOT, 'package.json');
  if (fs.existsSync(pkgSrc)) {
    const raw = JSON.parse(fs.readFileSync(pkgSrc, 'utf8'));
    const sanitized = sanitizePackageJson(raw);
    fs.writeFileSync(
      path.join(stagingRoot, 'package.json'),
      normalizeReleaseTextEol(`${JSON.stringify(sanitized, null, 2)}\n`),
      'utf8',
    );
  }

  const harnessPkgSrc = path.join(REPO_ROOT, 'harness/package.json');
  if (fs.existsSync(harnessPkgSrc)) {
    const raw = JSON.parse(fs.readFileSync(harnessPkgSrc, 'utf8'));
    const sanitized = sanitizeHarnessPackageJson(raw);
    fs.writeFileSync(
      path.join(stagingRoot, 'harness/package.json'),
      normalizeReleaseTextEol(`${JSON.stringify(sanitized, null, 2)}\n`),
      'utf8',
    );
  }

  const vendorManifestRel = 'profiles/hmos-app/vendor/hylyre/release.manifest.json';
  const vendorManifestDest = path.join(stagingRoot, vendorManifestRel);
  if (fs.existsSync(vendorManifestDest)) {
    const raw = JSON.parse(fs.readFileSync(vendorManifestDest, 'utf8'));
    const sanitized = sanitizeVendorManifest(raw);
    fs.writeFileSync(
      vendorManifestDest,
      normalizeReleaseTextEol(`${JSON.stringify(sanitized, null, 2)}\n`),
      'utf8',
    );
  }
}

/** @param {string} stagingRoot @param {string} zipPath @param {string} archiveDirName */
function zipDirectory(stagingRoot, zipPath, archiveDirName) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(stagingRoot, archiveDirName);
    archive.finalize();
  });
}

/** @param {string} filePath 任意文件（zip 或 staged 源文件），按原始字节算 sha256 */
function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const RELEASE_MANIFEST_NAME = 'RELEASE-MANIFEST.json';
const RELEASE_MANIFEST_SIDECAR_NAME = 'RELEASE-MANIFEST.sha256';

/**
 * C-review P1a/P1b：写「包内 per-file 哈希 manifest」（**不含 zip sha**，避免 zip 自指循环）。
 * hash 基于 staging 后字节（sanitize + LF 归一），供 release verify 与明确集成边界校验。
 * 须在 writeStaging 之后、zipDirectory 之前调用，使本文件随包进 zip。
 * G3b（plan e8f5a2c7）：同时写包内 sidecar RELEASE-MANIFEST.sha256（一行 64 位小写 hex +
 * 末尾 LF = manifest 原始字节 sha256；**不入 manifest.files[]**——manifest hash ↔ sidecar
 * hash 循环依赖）。普通 consumer phase 不做 selfcheck；sidecar 也提供非阻断 package identity。
 * t7（f3a8c6d2）：包身份两字段只增不减——source_commit（打包源仓 HEAD）+ built_at
 * （打包 UTC 时间）；不加 worktree digest，files[] 哈希与 sidecar 链语义不变
 * （与 c2e9f4d7 的截图级 build 指纹链划界）。
 * @param {string} stagingRoot @param {string} version @param {string[]} included repo 相对路径（= framework 内相对路径）
 * @returns {string} 包内 manifest 自身 sha256（写进 dist sidecar 做链式校验）
 */
export function writeInZipManifest(stagingRoot, version, included) {
  const files = included.map(rel => ({
    path: rel,
    sha256: sha256File(path.join(stagingRoot, rel)),
  }));
  const manifest = {
    schema_version: '1.0',
    version,
    source_commit: resolveSourceCommit(),
    built_at: new Date().toISOString(),
    files,
  };
  const out = path.join(stagingRoot, RELEASE_MANIFEST_NAME);
  fs.writeFileSync(out, normalizeReleaseTextEol(`${JSON.stringify(manifest, null, 2)}\n`), 'utf8');
  const manifestSha = sha256File(out);
  fs.writeFileSync(path.join(stagingRoot, RELEASE_MANIFEST_SIDECAR_NAME), `${manifestSha}\n`, 'utf8');
  return manifestSha;
}

/**
 * @param {{ dryRun: boolean, outDir: string }} opts
 * @returns {Promise<{ version: string, zipPath: string | null, manifestPath: string | null, included: string[], excluded: string[] }>}
 */
export async function packRelease(opts = parseArgs(process.argv.slice(2))) {
  const { dryRun, stageOnly, outDir } = opts;
  const version = readVersion();
  const zipName = `framework-${version}.zip`;
  const manifestName = `framework-${version}.manifest.json`;
  const rules = loadReleaseExcludes();

  const { included, excluded, excludedCountsByRule } = collectReleaseFiles(REPO_ROOT, rules);

  console.log(`[release:pack] version=${version} dryRun=${dryRun} stageOnly=${stageOnly}`);
  console.log(`[release:pack] included=${included.length} excluded=${excluded.length}`);

  if (dryRun) {
    for (const [rule, count] of Object.entries(excludedCountsByRule).sort()) {
      console.log(`  excluded ${rule}: ${count}`);
    }
    return { version, zipPath: null, manifestPath: null, stagingRoot: null, included, excluded };
  }

  const stagingParent = path.join(outDir, 'release-staging');
  const stagingRoot = path.join(stagingParent, FRAMEWORK_DIR_NAME);
  fs.rmSync(stagingParent, { recursive: true, force: true });
  writeStaging(stagingRoot, included);
  // c1: 包内 per-file 哈希 manifest（须在 zip 前写进 stagingRoot）
  const inZipManifestSha = writeInZipManifest(stagingRoot, version, included);

  if (stageOnly) {
    console.log(`[release:pack] staged ${stagingRoot} (no zip)`);
    return { version, zipPath: null, manifestPath: null, stagingRoot, included, excluded };
  }

  const zipPath = path.join(outDir, zipName);
  const manifestPath = path.join(outDir, manifestName);
  for (const artifact of [zipPath, manifestPath]) {
    if (fs.existsSync(artifact)) fs.rmSync(artifact, { force: true });
  }

  const bytes = await zipDirectory(stagingRoot, zipPath, FRAMEWORK_DIR_NAME);
  const sha256 = sha256File(zipPath);

  const manifest = {
    version,
    zipName,
    zipPath: toPosixPath(path.relative(REPO_ROOT, zipPath)),
    sha256,
    inZipManifest: {
      path: `${FRAMEWORK_DIR_NAME}/${RELEASE_MANIFEST_NAME}`,
      sha256: inZipManifestSha,
    },
    createdAt: new Date().toISOString(),
    includedFileCount: included.length,
    excludedFileCount: excluded.length,
    excludedCountsByRule,
    includedFiles: included,
    excludedSample: excluded.slice(0, EXCLUDED_SAMPLE_LIMIT),
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  fs.rmSync(stagingParent, { recursive: true, force: true });

  console.log(`[release:pack] wrote ${zipPath} (${bytes} bytes)`);
  console.log(`[release:pack] manifest ${manifestPath}`);

  return { version, zipPath, manifestPath, included, excluded };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  packRelease().catch(err => {
    console.error('[release:pack] FAIL:', err.message);
    process.exit(1);
  });
}
