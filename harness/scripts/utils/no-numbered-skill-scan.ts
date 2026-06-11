// ============================================================================
// no-numbered-skill-scan — 迁移边界扫描（路径 + 文案）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import type { RepoLayout } from '../../repo-layout';

export type ScanMode = 'dev' | 'consumer';

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

const NUMBERED_SKILL_ID =
  '(?:00-framework-init|00b-framework-setup|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))';

const NUMBERED_PATH_RE = new RegExp(`skills[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`);
const NUMBERED_PROFILE_SKILL_RE = new RegExp(
  `profiles[/\\\\][^/\\\\]+[/\\\\]skills[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`,
);
const NUMBERED_BRIDGE_SKILL_RE = new RegExp(`skills-bridge[/\\\\]${NUMBERED_SKILL_ID}(?:[/\\\\]|$)`);

const NUMBERED_PROSE_RE = /Skill\s*[0-6](?:\s*[–—-]\s*[0-6])?/;

const TEXT_EXTENSIONS =
  /\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template)$/i;

export interface ScanHit {
  file: string;
  line: number;
  column: number;
  match: string;
  kind: 'path' | 'prose';
}

function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/');
}

function isExcluded(rel: string, allowMigrationDoc: boolean): boolean {
  const norm = rel.replace(/\\/g, '/');
  if (allowMigrationDoc && norm === 'MIGRATION.md') return true;
  if (NOISE_EXCLUDE_GLOBS.some(re => re.test(norm))) return true;
  if (HISTORY_EXCLUDE_GLOBS.some(re => re.test(norm))) return true;
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
    if (isExcluded(rel, true)) return;
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

function scanFile(
  abs: string,
  scanRoot: string,
  reportRelPrefix: string,
  kind: 'path' | 'prose',
): ScanHit[] {
  const rel = reportRelPrefix + relPosix(scanRoot, abs);
  if (isExcluded(rel, kind === 'path' ? false : true)) return [];
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  const hits: ScanHit[] = [];
  const re = kind === 'path' ? null : NUMBERED_PROSE_RE;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (kind === 'path') {
      if (
        NUMBERED_PATH_RE.test(line)
        || NUMBERED_PROFILE_SKILL_RE.test(line)
        || NUMBERED_BRIDGE_SKILL_RE.test(line)
      ) {
        hits.push({
          file: rel,
          line: i + 1,
          column: 0,
          match: line.trim().slice(0, 120),
          kind: 'path',
        });
      }
      continue;
    }
    const m = re!.exec(line);
    if (m) {
      hits.push({
        file: rel,
        line: i + 1,
        column: (m.index ?? 0) + 1,
        match: m[0],
        kind: 'prose',
      });
    }
  }
  return hits;
}

function scanWithLayout(layout: RepoLayout, mode: ScanMode, kind: 'path' | 'prose'): ScanHit[] {
  const { scanRoot, reportRelPrefix } = resolveNumberedSkillScanTarget(layout, mode);
  const roots = mode === 'dev' ? DEV_SCAN_ROOTS : CONSUMER_SCAN_ROOTS;
  const files = collectFiles(scanRoot, roots);
  const hits: ScanHit[] = [];
  for (const abs of files) {
    hits.push(...scanFile(abs, scanRoot, reportRelPrefix, kind));
  }
  return hits;
}

export function scanNoNumberedSkillPaths(layout: RepoLayout, mode: ScanMode = 'dev'): ScanHit[] {
  return scanWithLayout(layout, mode, 'path');
}

export function scanNoNumberedSkillProse(layout: RepoLayout, mode: ScanMode = 'dev'): ScanHit[] {
  return scanWithLayout(layout, mode, 'prose');
}

