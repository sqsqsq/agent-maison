#!/usr/bin/env node
// version-evolve.mjs — 版本窗口 status / bump
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkPlanVersions } from './check-plan-version.mjs';
import {
  bumpSemver,
  compareSemver,
  hasOpenTodos,
  isValidSemver,
  loadAllPlans,
  readCurrentVersion,
} from './plan-version-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  if (argv[0] === 'status') return { cmd: 'status' };
  if (argv[0] === 'bump') {
    const level = argv.find((a) => a === '--patch' || a === '--minor' || a === '--major');
    if (!level) throw new Error('bump requires --patch | --minor | --major');
    return { cmd: 'bump', level: level.slice(2) };
  }
  throw new Error('usage: version-evolve.mjs status | bump --patch|--minor|--major');
}

function status(repoRoot) {
  const current = readCurrentVersion(repoRoot);
  const plans = loadAllPlans(repoRoot);
  /** @type {Map<string, { total: number, open: number }>} */
  const byVersion = new Map();
  /** @type {typeof plans} */
  const future = [];

  for (const p of plans) {
    const v = p.parsed.version;
    if (!v || !isValidSemver(v)) continue;
    if (!byVersion.has(v)) byVersion.set(v, { total: 0, open: 0 });
    const bucket = byVersion.get(v);
    bucket.total += 1;
    if (hasOpenTodos(p.parsed.todos)) bucket.open += 1;
    if (compareSemver(v, current) > 0) future.push(p);
  }

  console.log(`[version-evolve] current window: ${current}`);
  const cur = byVersion.get(current);
  if (cur) {
    console.log(`  plans in window: ${cur.total} (${cur.open} with open todos)`);
  } else {
    console.log('  plans in window: 0');
  }

  const frozen = [...byVersion.keys()].filter((v) => compareSemver(v, current) < 0).sort((a, b) => compareSemver(b, a));
  if (frozen.length) {
    console.log(`  frozen versions: ${frozen.join(', ')}`);
  }

  if (future.length) {
    console.log('  future-window plans (deferred):');
    for (const p of future) {
      console.log(`    ${p.basename} → version=${p.parsed.version}`);
    }
  }
}

/**
 * @param {string} fm
 * @param {string} key
 */
function removeFrontmatterKey(fm, key) {
  return fm
    .split('\n')
    .filter((line) => !new RegExp(`^${key}:\\s`).test(line))
    .join('\n');
}

function clearDeferredToOnArrival(repoRoot, newCurrent) {
  const plans = loadAllPlans(repoRoot);
  let cleared = 0;
  for (const { abs, parsed } of plans) {
    if (parsed.version !== newCurrent || !parsed.deferred_to) continue;
    let content = fs.readFileSync(abs, 'utf8');
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!m) continue;
    const fm = removeFrontmatterKey(m[1], 'deferred_to');
    content = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${fm}\n---`);
    fs.writeFileSync(abs, content, 'utf8');
    cleared += 1;
  }
  if (cleared) console.log(`[version-evolve] cleared deferred_to on ${cleared} plan(s) now at ${newCurrent}`);
}

function warnFutureAboveNewCurrent(repoRoot, newCurrent) {
  const plans = loadAllPlans(repoRoot);
  const warnings = plans.filter(
    (p) => p.parsed.version && isValidSemver(p.parsed.version) && compareSemver(p.parsed.version, newCurrent) > 0,
  );
  if (warnings.length === 0) return;
  console.warn('[version-evolve] WARNING: 存在未来窗口 plan，未随本次 bump 进入当前窗口：');
  for (const p of warnings) {
    console.warn(`  ${p.basename} (version=${p.parsed.version})`);
  }
}

function writePackageVersion(repoRoot, next) {
  const pkgPath = path.join(repoRoot, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const updated = raw.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`);
  if (updated === raw) throw new Error('failed to update package.json version');
  fs.writeFileSync(pkgPath, updated, 'utf8');
}

function bump(repoRoot, level) {
  const current = readCurrentVersion(repoRoot);
  const check = checkPlanVersions({ mode: 'release', repoRoot });
  if (!check.ok) {
    console.error('[version-evolve] bump blocked — release 门禁未通过：\n' + check.hits.map((h) => `  ${h.file}: ${h.reason}`).join('\n'));
    console.error('请先 completed/cancelled，或标 deferred_to（同时 version 置未来版本）');
    process.exit(1);
  }

  const next = bumpSemver(level, current);
  writePackageVersion(repoRoot, next);
  clearDeferredToOnArrival(repoRoot, next);
  warnFutureAboveNewCurrent(repoRoot, next);

  console.log(`[version-evolve] bumped ${current} → ${next} (${level})`);
  console.log(`[version-evolve] 请为上一窗口补 RELEASE-NOTES-v${current}.md 并运行 npm run release:changelog`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.cmd === 'status') status(REPO_ROOT);
    else bump(REPO_ROOT, opts.level);
  } catch (err) {
    console.error('[version-evolve] FAIL:', err.message);
    process.exit(1);
  }
}
