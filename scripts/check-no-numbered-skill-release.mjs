#!/usr/bin/env node
// check-no-numbered-skill-release.mjs — 发布件 numbered skill 五 kind 硬门禁（纯 MJS，与 no-numbered-skill-scan.ts 对齐）
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

const NUMBERED_PROSE_RE = /Skill\s*(?:00|0|[1-6])(?!\d)(?:\s*[–—-]\s*[0-6])?/;
const NUMBERED_BARE_RE =
  /\b(?:00-framework-init|00b-framework-setup|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))\b/;
const NUMBERED_BACKTICK_RE = new RegExp(`\`(${NUMBERED_SKILL_ID})\``);

const RANGE_SPEC_RE = /spec[~~～][0-9]/;
const RANGE_SKILL_PAREN_RE = /Skill\s*[（(]\s*[0-6]\s*[~~～\-—–]\s*[0-6]/;
const RANGE_TREE_RE = /(?<![0-9.])(?:★)?00[‑‑-]?init|0[‑‑-]?catalog|(?<![0-9.])[1-6][~~～][1-6](?![0-9.])/;
const RANGE_STEP_RE = /Step\s+[0-6]\s*[~~～]\s*[0-6]/;
const FEATURE_SKILL_CONTEXT =
  /\/spec|\/plan|\/coding|\/code-review|\/business-ut|\/device-testing|\bspec\b|\bplan\b|\bcoding\b|\bcode-review\b|\bbusiness-ut\b|\bdevice-testing\b/;

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

const SCANNER_SELF_EXCLUDE = [
  /harness[/\\]scripts[/\\]utils[/\\]no-numbered-skill-scan\.ts$/i,
  /harness[/\\]scripts[/\\]utils[/\\]legacy-skill-bridge-cleanup\.ts$/i,
  /harness[/\\]scripts[/\\]utils[/\\]profile-skill-assets\.ts$/i,
];

/** @param {string} rel POSIX relative to frameworkRoot */
function isMigrationRel(rel) {
  const norm = rel.replace(/\\/g, '/');
  return norm === 'MIGRATION.md' || norm.endsWith('/MIGRATION.md');
}

/** @param {string[]} lines @param {number} lineIndex */
function isInProfileSkillAssetSection(lines, lineIndex) {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i -= 1) {
    if (/profile-skill-asset/.test(lines[i] ?? '')) return true;
  }
  return false;
}

/** @param {string} rel @param {string} line @param {string[]} lines @param {number} lineIndex */
function isLiveAliasDocLine(rel, line, lines, lineIndex) {
  if (!isMigrationRel(rel)) return false;
  if (!isInProfileSkillAssetSection(lines, lineIndex)) return false;
  if (!/^\|/.test(line.trim())) return false;
  return /`1-spec`|`2-plan`|`1-prd-design`|`2-requirement-design`/.test(line);
}

/** @param {string} rel POSIX path relative to framework root */
function matchNumberedSkillRelPath(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (NUMBERED_PATH_RE.test(norm)) return norm.match(NUMBERED_PATH_RE)?.[0] ?? norm;
  if (NUMBERED_PROFILE_SKILL_RE.test(norm)) return norm.match(NUMBERED_PROFILE_SKILL_RE)?.[0] ?? norm;
  if (NUMBERED_BRIDGE_SKILL_RE.test(norm)) return norm.match(NUMBERED_BRIDGE_SKILL_RE)?.[0] ?? norm;
  return null;
}

/** @param {string} line */
function matchRangeWithContext(line) {
  if (RANGE_SPEC_RE.test(line) && /skill|阶段|feature|check-/i.test(line)) {
    return line.match(RANGE_SPEC_RE)?.[0] ?? null;
  }
  const skillParen = line.match(RANGE_SKILL_PAREN_RE);
  if (skillParen) return skillParen[0];
  if (RANGE_TREE_RE.test(line) && /skills\/|Skill 正文|framework\//.test(line)) {
    return line.match(RANGE_TREE_RE)?.[0] ?? null;
  }
  if (RANGE_STEP_RE.test(line) && FEATURE_SKILL_CONTEXT.test(line)) {
    return line.match(RANGE_STEP_RE)?.[0] ?? null;
  }
  return null;
}

/** @param {string} name */
function isTextFile(name) {
  return (
    /\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template)$/i.test(name)
    || name === 'SKILL.md'
    || name === 'profile-addendum.md'
    || name === 'AGENTS.md'
    || name === 'MIGRATION.md'
    || name === 'README.md'
  );
}

/** @param {string} rel POSIX relative to frameworkRoot */
function isExcluded(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (SCANNER_SELF_EXCLUDE.some(re => re.test(norm))) return true;
  return NOISE_EXCLUDE.some(re => re.test(norm));
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
 * @param {string} rel @param {string} line @param {string[]} lines @param {number} lineIndex
 * @returns {{ kind: string, text: string, column: number } | null}
 */
function scanTextKindsOnLine(rel, line, lines, lineIndex) {
  if (isLiveAliasDocLine(rel, line, lines, lineIndex)) return null;

  NUMBERED_PROSE_RE.lastIndex = 0;
  const proseM = NUMBERED_PROSE_RE.exec(line);
  if (proseM) return { kind: 'prose', text: proseM[0], column: (proseM.index ?? 0) + 1 };

  NUMBERED_BACKTICK_RE.lastIndex = 0;
  const backtickM = NUMBERED_BACKTICK_RE.exec(line);
  if (backtickM) return { kind: 'backtick', text: backtickM[0], column: (backtickM.index ?? 0) + 1 };

  NUMBERED_BARE_RE.lastIndex = 0;
  const bareM = NUMBERED_BARE_RE.exec(line);
  if (bareM) return { kind: 'bare', text: bareM[0], column: (bareM.index ?? 0) + 1 };

  const rangeM = matchRangeWithContext(line);
  if (rangeM) return { kind: 'range', text: rangeM, column: line.indexOf(rangeM) + 1 };

  return null;
}

/**
 * @param {string} frameworkRoot
 * @returns {{ ok: boolean, hits: { file: string, line: number, kind: string, text: string }[] }}
 */
export function checkNoNumberedSkillRelease(frameworkRoot) {
  /** @type {{ file: string, line: number, kind: string, text: string }[]} */
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
      const textHit = scanTextKindsOnLine(rel, line, lines, i);
      if (textHit) {
        hits.push({ file: rel, line: lineNo, kind: textHit.kind, text: textHit.text });
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
