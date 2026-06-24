// ============================================================================
// no-numbered-skill-scan — 迁移边界扫描（path + prose + backtick + bare + range）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import type { RepoLayout } from '../../repo-layout';

export type ScanMode = 'dev' | 'consumer';

export type ScanHitKind = 'path' | 'prose' | 'backtick' | 'bare' | 'range';

/** Match path segment boundary at start or after a separator (standalone `harness/...` roots). */
function seg(re: string): RegExp {
  return new RegExp(`(?:^|[/\\\\])${re}`);
}

const NOISE_EXCLUDE_GLOBS = [
  seg('harness[/\\\\]tests[/\\\\]'),
  seg('profiles[/\\\\][^/\\\\]+[/\\\\]harness[/\\\\]tests[/\\\\]'),
  seg('harness[/\\\\]reports[/\\\\]'),
  seg('harness[/\\\\]state[/\\\\]'),
  seg('harness[/\\\\]dist[/\\\\]'),
  seg('node_modules[/\\\\]'),
  seg('oh_modules[/\\\\]'),
  seg('\\.hylyre[/\\\\]'),
  seg('tmp_hypium[/\\\\]'),
];

const HISTORY_EXCLUDE_GLOBS = [
  seg('openspec[/\\\\]changes[/\\\\]archive[/\\\\]'),
  seg('\\.cursor[/\\\\]'),
  /RELEASE-NOTES-v.*\.md$/i,
  /MAINTAINER-CHANGELOG\.md$/i,
];

/** Scanner SSOT + runtime alias implementation — not subject to bare/backtick/range hits. */
const SCANNER_SELF_EXCLUDE = [
  /harness[/\\]scripts[/\\]utils[/\\]no-numbered-skill-scan\.ts$/i,
  /harness[/\\]scripts[/\\]utils[/\\]legacy-skill-bridge-cleanup\.ts$/i,
  /harness[/\\]scripts[/\\]utils[/\\]profile-skill-assets\.ts$/i,
];

const DEV_SCAN_ROOTS = [
  'skills',
  'profiles',
  'agents',
  'harness',
  'workflows',
  'docs',
  'templates',
  'specs',
  'openspec/specs',
  'openspec/changes',
  'scripts',
  'README.md',
  'AGENTS.md',
  'MIGRATION.md',
];

const CONSUMER_SCAN_ROOTS = [
  'skills',
  'profiles',
  'agents',
  'harness',
  'workflows',
  'docs',
  'templates',
  'specs',
  'README.md',
];

export const NUMBERED_SKILL_ID =
  '(?:00-framework-init|00b-framework-setup|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))';

const NUMBERED_PATH_RE = new RegExp(`skills[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`);
const NUMBERED_PROFILE_SKILL_RE = new RegExp(
  `profiles[/\\\\][^/\\\\]+[/\\\\]skills[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`,
);
const NUMBERED_BRIDGE_SKILL_RE = new RegExp(`skills-bridge[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`);

/** Explicit branches: 00 before 0; (?!\d) avoids double-digit false prefix on framework-init vs catalog-bootstrap. */
export const NUMBERED_PROSE_RE = /Skill\s*(?:00|0|[1-6])(?!\d)(?:\s*[–—-]\s*[0-6])?/;

/** Bare numeric-prefix legacy ids only — does not match prd-design / requirement-design. */
export const NUMBERED_BARE_RE =
  /\b(?:00-framework-init|00b-framework-setup|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))\b/;

export const NUMBERED_BACKTICK_RE = new RegExp(`\`(${NUMBERED_SKILL_ID})\``);

const RANGE_SPEC_RE = /spec[~~～][0-9]/;
const RANGE_SKILL_PAREN_RE = /Skill\s*[（(]\s*[0-6]\s*[~~～\-—–]\s*[0-6]/;
const RANGE_TREE_RE = /(?<![0-9.])(?:★)?00[‑‑-]?init|0[‑‑-]?catalog|(?<![0-9.])[1-6][~~～][1-6](?![0-9.])/;
const RANGE_STEP_RE = /Step\s+[0-6]\s*[~~～]\s*[0-6]/;

const FEATURE_SKILL_CONTEXT =
  /\/spec|\/plan|\/coding|\/code-review|\/business-ut|\/device-testing|\bspec\b|\bplan\b|\bcoding\b|\bcode-review\b|\bbusiness-ut\b|\bdevice-testing\b/;

function matchNumberedSkillRelPath(rel: string): string | null {
  const norm = rel.replace(/\\/g, '/');
  if (NUMBERED_PATH_RE.test(norm)) return norm.match(NUMBERED_PATH_RE)?.[0] ?? norm;
  if (NUMBERED_PROFILE_SKILL_RE.test(norm)) return norm.match(NUMBERED_PROFILE_SKILL_RE)?.[0] ?? norm;
  if (NUMBERED_BRIDGE_SKILL_RE.test(norm)) return norm.match(NUMBERED_BRIDGE_SKILL_RE)?.[0] ?? norm;
  return null;
}

const TEXT_EXTENSIONS =
  /\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template)$/i;

export interface ScanHit {
  file: string;
  line: number;
  column: number;
  match: string;
  kind: ScanHitKind;
}

function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/');
}

function isMigrationRel(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  return norm === 'MIGRATION.md' || norm.endsWith('/MIGRATION.md');
}

/** Section window: profile-skill-asset alias table in MIGRATION (content-based, no line numbers). */
export function isInProfileSkillAssetSection(lines: string[], lineIndex: number): boolean {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i -= 1) {
    if (/profile-skill-asset/.test(lines[i] ?? '')) return true;
  }
  return false;
}

export function isLiveAliasDocLine(
  relPath: string,
  line: string,
  lines: string[],
  lineIndex: number,
): boolean {
  if (!isMigrationRel(relPath)) return false;
  if (!isInProfileSkillAssetSection(lines, lineIndex)) return false;
  if (!/^\|/.test(line.trim())) return false;
  return /`1-spec`|`2-plan`|`1-prd-design`|`2-requirement-design`/.test(line);
}

/** Drift guard: MIGRATION live alias table must remain discoverable after edits. */
export function collectLiveAliasDocLines(migrationText: string): string[] {
  const lines = migrationText.replace(/\r\n?/g, '\n').split('\n');
  return lines.filter((line, i) => isLiveAliasDocLine('MIGRATION.md', line, lines, i));
}

export function assertLiveAliasDocDrift(migrationText: string): void {
  const rows = collectLiveAliasDocLines(migrationText).filter(l => /`1-spec`|`2-plan`/.test(l));
  if (rows.length < 2) {
    throw new Error(
      `live alias drift: expected >=2 MIGRATION profile-skill-asset rows with \`1-spec\`/\`2-plan\`, got ${rows.length}`,
    );
  }
}

function isExcluded(rel: string, forPathScan: boolean): boolean {
  const norm = rel.replace(/\\/g, '/');
  if (SCANNER_SELF_EXCLUDE.some(re => re.test(norm))) return true;
  if (NOISE_EXCLUDE_GLOBS.some(re => re.test(norm))) return true;
  if (HISTORY_EXCLUDE_GLOBS.some(re => re.test(norm))) return true;
  if (forPathScan && isMigrationRel(norm)) return false;
  return false;
}

function isTextFile(name: string): boolean {
  return (
    TEXT_EXTENSIONS.test(name)
    || name === 'SKILL.md'
    || name === 'profile-addendum.md'
    || name === 'AGENTS.md'
    || name === 'MIGRATION.md'
    || name === 'README.md'
  );
}

function collectFiles(root: string, scanRoots: string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    const rel = relPosix(root, abs);
    if (isExcluded(rel, false)) return;
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
    const abs = path.join(root, r);
    if (!fs.existsSync(abs)) continue;
    walk(abs);
  }
  return out;
}

/** dev：扫 projectRoot（standalone 即 framework 根）；consumer：扫 frameworkRoot，报告路径带 framework/ 前缀。 */
export function resolveNumberedSkillScanTarget(
  layout: RepoLayout,
  mode: ScanMode,
): { scanRoot: string; reportRelPrefix: string } {
  if (mode === 'consumer') {
    const prefix = layout.frameworkRel ? `${layout.frameworkRel}/` : '';
    return { scanRoot: layout.frameworkRoot, reportRelPrefix: prefix };
  }
  const prefix = layout.frameworkRel ? `${layout.frameworkRel}/` : '';
  return { scanRoot: layout.projectRoot, reportRelPrefix: prefix };
}

function matchRangeWithContext(line: string): string | null {
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

function pushHit(
  hits: ScanHit[],
  rel: string,
  lineNo: number,
  column: number,
  match: string,
  kind: ScanHitKind,
): void {
  hits.push({ file: rel, line: lineNo, column, match, kind });
}

function scanTextKindsOnLine(
  rel: string,
  line: string,
  lines: string[],
  lineIndex: number,
  hits: ScanHit[],
  lineNo: number,
): void {
  if (isLiveAliasDocLine(rel, line, lines, lineIndex)) return;

  NUMBERED_PROSE_RE.lastIndex = 0;
  const proseM = NUMBERED_PROSE_RE.exec(line);
  if (proseM) {
    pushHit(hits, rel, lineNo, (proseM.index ?? 0) + 1, proseM[0], 'prose');
    return;
  }

  NUMBERED_BACKTICK_RE.lastIndex = 0;
  const backtickM = NUMBERED_BACKTICK_RE.exec(line);
  if (backtickM) {
    pushHit(hits, rel, lineNo, (backtickM.index ?? 0) + 1, backtickM[0], 'backtick');
    return;
  }

  NUMBERED_BARE_RE.lastIndex = 0;
  const bareM = NUMBERED_BARE_RE.exec(line);
  if (bareM) {
    pushHit(hits, rel, lineNo, (bareM.index ?? 0) + 1, bareM[0], 'bare');
    return;
  }

  const rangeM = matchRangeWithContext(line);
  if (rangeM) {
    pushHit(hits, rel, lineNo, line.indexOf(rangeM) + 1, rangeM, 'range');
  }
}

function scanFile(
  abs: string,
  scanRoot: string,
  reportRelPrefix: string,
  kinds: ScanHitKind[],
): ScanHit[] {
  const rel = reportRelPrefix + relPosix(scanRoot, abs);
  if (isExcluded(rel, kinds.includes('path'))) return [];
  const hits: ScanHit[] = [];

  if (kinds.includes('path')) {
    const relMatch = matchNumberedSkillRelPath(rel);
    if (relMatch) {
      pushHit(hits, rel, 0, 0, relMatch, 'path');
      return hits;
    }
  }

  const textKinds = kinds.filter(k => k !== 'path');
  if (textKinds.length === 0) return hits;

  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    if (kinds.includes('path')) {
      if (
        NUMBERED_PATH_RE.test(line)
        || NUMBERED_PROFILE_SKILL_RE.test(line)
        || NUMBERED_BRIDGE_SKILL_RE.test(line)
      ) {
        pushHit(hits, rel, lineNo, 0, line.trim().slice(0, 120), 'path');
        continue;
      }
    }

    scanTextKindsOnLine(rel, line, lines, i, hits, lineNo);
  }
  return hits;
}

function scanWithLayout(layout: RepoLayout, mode: ScanMode, kinds: ScanHitKind[]): ScanHit[] {
  const { scanRoot, reportRelPrefix } = resolveNumberedSkillScanTarget(layout, mode);
  const roots = mode === 'dev' ? DEV_SCAN_ROOTS : CONSUMER_SCAN_ROOTS;
  const files = collectFiles(scanRoot, roots);
  const hits: ScanHit[] = [];
  for (const abs of files) {
    hits.push(...scanFile(abs, scanRoot, reportRelPrefix, kinds));
  }
  return hits;
}

const ALL_TEXT_KINDS: ScanHitKind[] = ['prose', 'backtick', 'bare', 'range'];

export function scanNoNumberedSkillPaths(layout: RepoLayout, mode: ScanMode = 'dev'): ScanHit[] {
  return scanWithLayout(layout, mode, ['path']);
}

/** Prose + backtick + bare + range（check:docs 文案门禁 SSOT）。 */
export function scanNoNumberedSkillProse(layout: RepoLayout, mode: ScanMode = 'dev'): ScanHit[] {
  return scanWithLayout(layout, mode, ALL_TEXT_KINDS);
}

export function scanNoNumberedSkillAll(layout: RepoLayout, mode: ScanMode = 'dev'): ScanHit[] {
  return scanWithLayout(layout, mode, ['path', ...ALL_TEXT_KINDS]);
}
