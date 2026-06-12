#!/usr/bin/env node
// rename-tail-inventory.mjs — prd/design + numbered-skill 改名尾巴盘点（allowlist 九类）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectReleaseFiles,
  isProbablyBinaryBuffer,
  isReleaseBinaryRelPath,
  loadReleaseExcludes,
} from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** @typedef {{ file: string, line: number, kind: string, text: string }} Hit */

const PRD_RE = /\bprd\b/i;
const DESIGN_PHASE_RE =
  /(?:--phase\s+design\b|check:design\b|(?:^|[^\w])design\s+阶段|phase\s*[=:]\s*['"]design['"])/;
const NUMBERED_PATH_RE =
  /skills[/\\](?:00-framework-init|00b-framework-setup|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))(?:[/\\]|$)/;
const NUMBERED_PROSE_RE = /Skill\s*(?:00|0|[1-6])(?!\d)(?:\s*[–—-]\s*[0-6])?/;

/** 九类 allowlist — 路径级（POSIX rel）；见 docs/skills/rename-tail-allowlist.md */
const PATH_ALLOWLIST = [
  /^MIGRATION\.md$/,
  /^RELEASE-NOTES/i,
  /^README\.md$/,
  /^harness\/package\.json$/,
  /^harness\/schemas\/summary\.schema\.json$/,
  /^harness\/compat-loader\.ts$/,
  /^harness\/trace\/trace\.schema\.json$/,
  /^harness\/scripts\/utils\/phase-alias\.ts$/,
  /^harness\/scripts\/utils\/capability-alias\.ts$/,
  /^harness\/scripts\/utils\/phase-transition-policy\.ts$/,
  /^harness\/scripts\/utils\/context-exploration\.ts$/,
  /^harness\/scripts\/utils\/config-field-merger\.ts$/,
  /^harness\/scripts\/utils\/scope-parser\.ts$/,
  /^harness\/scripts\/check-spec\.ts$/,
  /^harness\/scripts\/check-plan\.ts$/,
  /^harness\/scripts\/check-receipt\.ts$/,
  /^harness\/scripts\/check-catalog\.ts$/,
  /^harness\/scripts\/backfill-context-exploration\.ts$/,
  /^harness\/scripts\/check-skills-confirmation-ux\.ts$/,
  /^harness\/config\.ts$/,
  /^harness\/harness-runner\.ts$/,
  /^harness\/README\.md$/,
  /^harness\/scripts\/utils\/exploration-strategy\.ts$/,
  /^harness\/scripts\/utils\/fan-out-scanner\.ts$/,
  /^harness\/scripts\/utils\/profile-skill-assets\.ts$/,
  /^harness\/scripts\/render-agents-md\.mjs$/,
  /^profiles\/[^/]+\/harness\/spec-visual-handoff-check\.ts$/,
  /^profiles\/[^/]+\/harness\/README\.md$/,
  /^profiles\/README\.md$/,
  /^docs\/concepts\/phase-terminology\.md$/,
  /^docs\/skills\/rename-tail-allowlist\.md$/,
  /^docs\/visual-handoff-config-migration\.md$/,
  /^docs\/overview\.md$/,
  /^docs\/evolution\/compat-protocol-v1\.md$/,
  /^docs\/evolution\/extension-protocol-v1\.md$/,
  /^docs\/evolution\/extension-e2e-acceptance\.md$/,
  /^skills\/reference\/confirmation-registry\.yaml$/,
  /^skills\/project\/framework-init\//,
  /^skills\/project\/catalog-bootstrap\/SKILL\.md$/,
  /^specs\/feature-compat\.schema\.yaml$/,
  /^workflows\/README\.md$/,
  /^agents\/claude\/templates\/agents\/verifier\.md$/,
  /^harness\/tests\//,
  /^profiles\/[^/]+\/harness\/tests\//,
  /^harness\/reports\//,
  /^scripts\//,
  /^openspec\//,
  /^\.cursor\//,
  /^MAINTAINER-CHANGELOG/i,
];

/** @param {string} rel */
function isPathAllowlisted(rel) {
  const norm = rel.replace(/\\/g, '/');
  return PATH_ALLOWLIST.some((re) => re.test(norm));
}

/**
 * @param {string} repoRoot
 * @param {{ releaseOnly?: boolean }} opts
 */
export function scanRenameTail(repoRoot = REPO_ROOT, opts = {}) {
  const rules = loadReleaseExcludes();
  const { included } = collectReleaseFiles(repoRoot, rules);
  /** @type {Hit[]} */
  const hits = [];

  for (const rel of included) {
    if (isReleaseBinaryRelPath(rel)) continue;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const buf = fs.readFileSync(abs);
    if (isProbablyBinaryBuffer(buf)) continue;

    const allowlisted = isPathAllowlisted(rel);
    const lines = buf.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      if (PRD_RE.test(line)) {
        hits.push({ file: rel, line: lineNo, kind: 'prd_word', text: line.trim(), allowlisted });
      }
      if (DESIGN_PHASE_RE.test(line)) {
        hits.push({ file: rel, line: lineNo, kind: 'design_phase', text: line.trim(), allowlisted });
      }
      if (NUMBERED_PATH_RE.test(line) || NUMBERED_PROSE_RE.test(line)) {
        hits.push({ file: rel, line: lineNo, kind: 'numbered_skill', text: line.trim(), allowlisted });
      }
    }
  }

  const nonAllowlisted = hits.filter((h) => !h.allowlisted);
  return { hits, nonAllowlisted, allowlistedCount: hits.length - nonAllowlisted.length };
}

function main() {
  const failOn = process.argv.includes('--fail-on-non-allowlisted');
  const jsonOut = process.argv.includes('--json');
  const { hits, nonAllowlisted, allowlistedCount } = scanRenameTail();

  if (jsonOut) {
    console.log(JSON.stringify({ total: hits.length, allowlistedCount, nonAllowlisted }, null, 2));
  } else {
    console.log(`rename-tail inventory: ${hits.length} hit(s), ${allowlistedCount} allowlisted, ${nonAllowlisted.length} non-allowlisted`);
    for (const h of nonAllowlisted) {
      console.log(`  [${h.kind}] ${h.file}:${h.line}  ${h.text.slice(0, 120)}`);
    }
  }

  if (failOn && nonAllowlisted.length > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
