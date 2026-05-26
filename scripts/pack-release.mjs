#!/usr/bin/env node
// pack-release.mjs — 产出 framework-<semver>.zip + sidecar manifest
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import {
  collectReleaseFiles,
  loadReleaseExcludes,
  sanitizePackageJson,
  toPosixPath,
} from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FRAMEWORK_DIR_NAME = 'framework';
const EXCLUDED_SAMPLE_LIMIT = 50;

/** @param {string[]} argv */
function parseArgs(argv) {
  let dryRun = false;
  let outDir = path.join(REPO_ROOT, 'dist');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') dryRun = true;
    if (argv[i] === '--out' && argv[i + 1]) {
      outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return { dryRun, outDir };
}

function readVersion() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error('package.json missing version');
  }
  return pkg.version;
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
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  const pkgSrc = path.join(REPO_ROOT, 'package.json');
  if (fs.existsSync(pkgSrc)) {
    const raw = JSON.parse(fs.readFileSync(pkgSrc, 'utf8'));
    const sanitized = sanitizePackageJson(raw);
    fs.writeFileSync(
      path.join(stagingRoot, 'package.json'),
      `${JSON.stringify(sanitized, null, 2)}\n`,
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

/** @param {string} zipPath */
function sha256File(zipPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(zipPath));
  return hash.digest('hex');
}

/**
 * @param {{ dryRun: boolean, outDir: string }} opts
 * @returns {Promise<{ version: string, zipPath: string | null, manifestPath: string | null, included: string[], excluded: string[] }>}
 */
export async function packRelease(opts = parseArgs(process.argv.slice(2))) {
  const { dryRun, outDir } = opts;
  const version = readVersion();
  const zipName = `framework-${version}.zip`;
  const manifestName = `framework-${version}.manifest.json`;
  const rules = loadReleaseExcludes();

  const { included, excluded, excludedCountsByRule } = collectReleaseFiles(REPO_ROOT, rules);

  console.log(`[release:pack] version=${version} dryRun=${dryRun}`);
  console.log(`[release:pack] included=${included.length} excluded=${excluded.length}`);

  if (dryRun) {
    for (const [rule, count] of Object.entries(excludedCountsByRule).sort()) {
      console.log(`  excluded ${rule}: ${count}`);
    }
    return { version, zipPath: null, manifestPath: null, included, excluded };
  }

  const stagingParent = path.join(outDir, 'release-staging');
  const stagingRoot = path.join(stagingParent, FRAMEWORK_DIR_NAME);
  fs.rmSync(stagingParent, { recursive: true, force: true });
  writeStaging(stagingRoot, included);

  const zipPath = path.join(outDir, zipName);
  const bytes = await zipDirectory(stagingRoot, zipPath, FRAMEWORK_DIR_NAME);
  const sha256 = sha256File(zipPath);

  const manifest = {
    version,
    zipName,
    zipPath: toPosixPath(path.relative(REPO_ROOT, zipPath)),
    sha256,
    createdAt: new Date().toISOString(),
    includedFileCount: included.length,
    excludedFileCount: excluded.length,
    excludedCountsByRule,
    includedFiles: included,
    excludedSample: excluded.slice(0, EXCLUDED_SAMPLE_LIMIT),
  };

  const manifestPath = path.join(outDir, manifestName);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

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
