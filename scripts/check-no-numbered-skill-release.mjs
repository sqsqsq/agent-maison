#!/usr/bin/env node
// check-no-numbered-skill-release.mjs — 发布件 numbered skill 路径 + Skill N 文案硬门禁（纯 MJS）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NUMBERED_SKILL_ID =
  '(?:00-framework-init|00b-framework-setup|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))';

const NUMBERED_PATH_RE = new RegExp(`skills[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`);
const NUMBERED_PROFILE_SKILL_RE = new RegExp(
  `profiles[/\\\\][^/\\\\]+[/\\\\]skills[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`,
);
const NUMBERED_BRIDGE_SKILL_RE = new RegExp(`skills-bridge[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`);

/** Align with harness/scripts/utils/no-numbered-skill-scan.ts NUMBERED_PROSE_RE */
const NUMBERED_PROSE_RE = /Skill\s*(?:00|0|[1-6])(?!\d)(?:\s*[–—-]\s*[0-6])?/;

/** @param {string} rel POSIX path relative to framework root */
function matchNumberedSkillRelPath(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (NUMBERED_PATH_RE.test(norm)) return norm.match(NUMBERED_PATH_RE)?.[0] ?? norm;
  if (NUMBERED_PROFILE_SKILL_RE.test(norm)) return norm.match(NUMBERED_PROFILE_SKILL_RE)?.[0] ?? norm;
  if (NUMBERED_BRIDGE_SKILL_RE.test(norm)) return norm.match(NUMBERED_BRIDGE_SKILL_RE)?.[0] ?? norm;
  return null;
}

const TEXT_EXTENSIONS =
  /\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template)$/i;

const SCAN_ROOTS = [
  'skills',
  'profiles',
  'agents',
  'harness',
  'workflows',
  'docs',
  'templates',
  'specs',
  'README.md',
  'MIGRATION.md',
];

const NOISE_EXCLUDE = [
  /(?:^|[/\\])harness[/\\]tests[/\\]/,
  /(?:^|[/\\])profiles[/\\][^/\\]+[/\\]harness[/\\]tests[/\\]/,
  /(?:^|[/\\])harness[/\\]reports[/\\]/,
  /(?:^|[/\\])harness[/\\]state[/\\]/,
  /(?:^|[/\\])harness[/\\]dist[/\\]/,
  /(?:^|[/\\])node_modules[/\\]/,
];

/** @param {string} rel POSIX relative to frameworkRoot */
function isExcluded(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (norm === 'MIGRATION.md') return true;
  return NOISE_EXCLUDE.some(re => re.test(norm));
}

/** @param {string} name */
function isTextFile(name) {
  return (
    TEXT_EXTENSIONS.test(name)
    || name === 'SKILL.md'
    || name === 'profile-addendum.md'
    || name === 'AGENTS.md'
    || name === 'MIGRATION.md'
    || name === 'README.md'
  );
}

/**
 * @param {string} frameworkRoot absolute path to framework/ tree (staging or extracted)
 * @param {string[]} scanRoots
 * @returns {string[]} absolute file paths
 */
function collectFiles(frameworkRoot, scanRoots) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} abs */
  const walk = abs => {
    const rel = path.relative(frameworkRoot, abs).replace(/\\/g, '/');
    if (isExcluded(rel)) return;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (isTextFile(path.basename(abs))) out.push(abs);
      return;
    }
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      walk(path.join(abs, ent.name));
    }
  };
  for (const r of scanRoots) {
    const abs = path.join(frameworkRoot, r);
    if (!fs.existsSync(abs)) continue;
    walk(abs);
  }
  return out;
}

/**
 * @param {string} frameworkRoot
 * @returns {{ ok: boolean, hits: { file: string, line: number, kind: 'path' | 'prose', text: string }[] }}
 */
export function checkNoNumberedSkillRelease(frameworkRoot) {
  /** @type {{ file: string, line: number, kind: 'path' | 'prose', text: string }[]} */
  const hits = [];
  const files = collectFiles(frameworkRoot, SCAN_ROOTS);

  for (const abs of files) {
    const rel = path.relative(frameworkRoot, abs).replace(/\\/g, '/');
    const relMatch = matchNumberedSkillRelPath(rel);
    if (relMatch) {
      hits.push({ file: rel, line: 0, kind: 'path', text: relMatch });
      continue;
    }
    const lines = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      if (
        NUMBERED_PATH_RE.test(line)
        || NUMBERED_PROFILE_SKILL_RE.test(line)
        || NUMBERED_BRIDGE_SKILL_RE.test(line)
      ) {
        hits.push({ file: rel, line: lineNo, kind: 'path', text: line.trim().slice(0, 120) });
        continue;
      }
      const m = NUMBERED_PROSE_RE.exec(line);
      if (m) {
        hits.push({ file: rel, line: lineNo, kind: 'prose', text: m[0] });
      }
    }
  }

  return { ok: hits.length === 0, hits };
}

/** @param {{ file: string, line: number, kind: string, text: string }[]} hits */
export function formatNoNumberedSkillHits(hits) {
  return hits.map(h => `  ${h.file}:${h.line} [${h.kind}] ${h.text}`).join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node check-no-numbered-skill-release.mjs <frameworkRoot>');
    process.exit(2);
  }
  const { ok, hits } = checkNoNumberedSkillRelease(path.resolve(root));
  if (!ok) {
    console.error('[check-no-numbered-skill-release] FAIL:\n' + formatNoNumberedSkillHits(hits));
    process.exit(1);
  }
  console.log('[check-no-numbered-skill-release] PASS');
}
