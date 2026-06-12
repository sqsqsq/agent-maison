#!/usr/bin/env node
// verify-release-pack.mjs — 规则单测 + 临时目录打包/解压/断言
import fs from 'fs';
import path from 'path';
import os from 'os';
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

  const allFiles = listAllFiles(frameworkRoot);
  for (const f of allFiles) {
    if (matchGlob('profiles/*/harness/tests/**', f)) {
      fail(`profile harness test leaked: ${f}`);
    }
    if (f.includes('node_modules/') || f.endsWith('package-lock.json')) {
      fail(`runtime artifact leaked: ${f}`);
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

export async function verifyReleasePack() {
  const rules = loadReleaseExcludes();

  console.log('[release:verify] typecheck (tsc --noEmit)...');
  const tc = spawnSync('npm', ['run', 'typecheck'], {
    cwd: path.join(REPO_ROOT, 'harness'),
    stdio: 'inherit',
    shell: true,
  });
  if (tc.status !== 0) fail('typecheck (tsc --noEmit) failed');
  console.log('[release:verify] typecheck PASS');

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

  console.log('[release:verify] plan version (--release)...');
  const planVer = checkPlanVersions({ mode: 'release' });
  if (!planVer.ok) {
    console.error('[release:verify] plan version FAIL:\n' + formatPlanVersionHits(planVer.hits));
    fail(`plan version: ${planVer.hits.length} hit(s)`);
  }
  console.log('[release:verify] plan version PASS');

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'am-release-verify-'));
  try {
    console.log(`[release:verify] packing to ${tmpOut}...`);
    const { zipPath } = await packRelease({ dryRun: false, outDir: tmpOut });
    if (!zipPath || !fs.existsSync(zipPath)) fail('pack did not produce zip');

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

      console.log('[release:verify] numbered skill path/prose scan...');
      const numbered = checkNoNumberedSkillRelease(frameworkRoot);
      if (!numbered.ok) {
        console.error(
          '[release:verify] numbered skill FAIL:\n' + formatNoNumberedSkillHits(numbered.hits),
        );
        fail(`numbered skill path/prose: ${numbered.hits.length} hit(s) in release zip`);
      }
      console.log('[release:verify] numbered skill path/prose PASS');

      console.log('[release:verify] zip content assertions PASS');
    } finally {
      fs.rmSync(extractRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }

  console.log('[release:verify] ALL PASS');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verifyReleasePack().catch(err => {
    console.error('[release:verify] FAIL:', err.message);
    process.exit(1);
  });
}
