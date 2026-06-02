#!/usr/bin/env node
// check-plan-version.mjs — plan 版本标签校验（default / --release）
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compareSemver,
  hasOpenTodos,
  isLegacyAllowlistEligible,
  isValidSemver,
  loadAllPlans,
  loadLegacyAllowlist,
  loadPreFrontmatterAllowlist,
  readCurrentVersion,
} from './plan-version-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * @typedef {{ file: string, reason: string }} Hit
 */

/**
 * @param {{ mode?: 'default' | 'release', repoRoot?: string }} [opts]
 * @returns {{ ok: boolean, hits: Hit[], current: string }}
 */
export function checkPlanVersions(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const mode = opts.mode ?? 'default';
  const current = readCurrentVersion(repoRoot);
  const allowlist = loadLegacyAllowlist(repoRoot);
  const preFrontmatterAllowlist = loadPreFrontmatterAllowlist(repoRoot);
  const plans = loadAllPlans(repoRoot);
  /** @type {Hit[]} */
  const hits = [];

  for (const { basename, rel, parsed } of plans) {
    const inAllowlist = allowlist.has(basename);
    const { version, deferred_to, todos, rawFrontmatter } = parsed;
    const open = hasOpenTodos(todos);

    if (!rawFrontmatter?.trim()) {
      if (preFrontmatterAllowlist.has(basename)) continue;
      hits.push({
        file: rel,
        reason:
          'plan 无 YAML frontmatter；须补 frontmatter+version 或列入 scripts/plan-version-pre-frontmatter-allowlist.json',
      });
      continue;
    }

    if (inAllowlist) {
      if (isLegacyAllowlistEligible(parsed)) continue;
      hits.push({
        file: rel,
        reason:
          'allowlist 项不再符合豁免条件（须 terminal + 无 version + 无 deferred_to）；重跑 gen-plan-version-allowlist 或改走正常校验',
      });
    }

    if (!version || !isValidSemver(version)) {
      hits.push({
        file: rel,
        reason: open
          ? '在研 plan 缺少合法 frontmatter version'
          : '非 allowlist plan 缺少合法 frontmatter version',
      });
      continue;
    }

    const cmp = compareSemver(version, current);

    if (cmp > 0) {
      if (!deferred_to || deferred_to !== version) {
        hits.push({
          file: rel,
          reason: `version > 当前 (${version} > ${current}) 须 deferred_to === version`,
        });
      }
      continue;
    }

    if (cmp < 0 && open) {
      hits.push({
        file: rel,
        reason: `version < 当前 (${version}) 仍有未完成 todo，须 completed/cancelled`,
      });
      continue;
    }

    if (mode === 'release' && cmp === 0 && open) {
      hits.push({
        file: rel,
        reason: `发布门禁：version === 当前 (${current}) 的 plan 仍有未完成 todo`,
      });
    }
  }

  return { ok: hits.length === 0, hits, current };
}

/**
 * @param {Hit[]} hits
 */
export function formatPlanVersionHits(hits) {
  return hits.map((h) => `  ${h.file}: ${h.reason}`).join('\n');
}

function parseArgs(argv) {
  const release = argv.includes('--release');
  return { mode: release ? 'release' : 'default' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { mode } = parseArgs(process.argv.slice(2));
  const result = checkPlanVersions({ mode });
  console.log(`[check-plan-version] mode=${mode} current=${result.current}`);
  if (!result.ok) {
    console.error('[check-plan-version] FAIL:\n' + formatPlanVersionHits(result.hits));
    process.exit(1);
  }
  console.log('[check-plan-version] PASS');
}
