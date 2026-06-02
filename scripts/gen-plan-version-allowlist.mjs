#!/usr/bin/env node
// gen-plan-version-allowlist.mjs — 扫描 plan，生成 legacy / pre-frontmatter allowlist
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isLegacyAllowlistEligible, loadAllPlans } from './plan-version-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const LEGACY_OUT = path.join(REPO_ROOT, 'scripts', 'plan-version-legacy-allowlist.json');
const PRE_FM_OUT = path.join(REPO_ROOT, 'scripts', 'plan-version-pre-frontmatter-allowlist.json');

const plans = loadAllPlans(REPO_ROOT);
/** @type {string[]} */
const legacyFiles = [];
/** @type {string[]} */
const preFrontmatterFiles = [];

for (const { basename, parsed } of plans) {
  if (!parsed.rawFrontmatter?.trim()) {
    preFrontmatterFiles.push(basename);
    continue;
  }
  if (isLegacyAllowlistEligible(parsed)) {
    legacyFiles.push(basename);
  }
}

const legacyManifest = {
  generatedAt: new Date().toISOString(),
  note: '有 frontmatter、todos 非空且全 completed/cancelled、无 version/deferred_to；已分版或顺延者走正常校验',
  files: legacyFiles.sort(),
};

const preFmManifest = {
  generatedAt: new Date().toISOString(),
  note: '无 YAML frontmatter 的史前 plan；显式登记以免空 todos 被误判为终态',
  files: preFrontmatterFiles.sort(),
};

fs.writeFileSync(LEGACY_OUT, `${JSON.stringify(legacyManifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(PRE_FM_OUT, `${JSON.stringify(preFmManifest, null, 2)}\n`, 'utf8');
console.log(`[gen-plan-version-allowlist] wrote ${LEGACY_OUT} (${legacyFiles.length} files)`);
console.log(`[gen-plan-version-allowlist] wrote ${PRE_FM_OUT} (${preFrontmatterFiles.length} files)`);
