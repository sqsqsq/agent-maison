#!/usr/bin/env node
/** Replace human-readable Skill N labels with semantic skill ids (dev-only). */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.cursor', 'openspec/changes/archive']);
const SKIP_GLOBS = [
  /harness\/tests\//,
  /profiles\/[^/]+\/harness\/tests\//,
  /harness\/reports\//,
  /\.cursor\//,
  /RELEASE-NOTES-v/,
  /MAINTAINER-CHANGELOG/,
  /scripts\/migrate-skill-prose\.mjs$/,
];

const SCAN_ROOTS = [
  'skills', 'profiles', 'agents', 'harness', 'workflows', 'docs', 'templates',
  'specs', 'openspec/specs', 'openspec/changes', 'scripts', 'README.md', 'AGENTS.md', 'MIGRATION.md',
];

/** Order matters: longer / more specific patterns first. */
const PROSE_REPLACEMENTS = [
  [/Skill\s*0\s*[–—-]\s*6/g, 'catalog-bootstrap … device-testing phase skills'],
  [/Skill\s*0～6/g, 'catalog-bootstrap … device-testing phase skills'],
  [/Skill\s*00/g, 'framework-init'],
  [/Skill\s*1\s*\(PRD\)/g, 'spec (PRD)'],
  [/Skill\s*2\s*\(Design\)/g, 'plan (Design)'],
  [/Skill\s*1/g, 'spec'],
  [/Skill\s*2/g, 'plan'],
  [/Skill\s*3/g, 'coding'],
  [/Skill\s*4/g, 'code-review'],
  [/Skill\s*5/g, 'business-ut'],
  [/Skill\s*6/g, 'device-testing'],
  [/Skill\s*0/g, 'catalog-bootstrap'],
];

const PROFILE_PATH_FIXES = [
  ['profiles/hmos-app/skills/feature/', 'profiles/hmos-app/skills/'],
  ['profiles/generic/skills/feature/', 'profiles/generic/skills/'],
  ['framework/profiles/hmos-app/skills/feature/', 'framework/profiles/hmos-app/skills/'],
  ['framework/profiles/generic/skills/feature/', 'framework/profiles/generic/skills/'],
  // Placeholder forms used in root SKILL.md (not concrete profile names)
  ['framework/profiles/<project_profile.name>/skills/feature/', 'framework/profiles/<project_profile.name>/skills/'],
  ['framework/profiles/<project_profile>/skills/feature/', 'framework/profiles/<project_profile>/skills/'],
  ['framework/profiles/<profile>/skills/feature/', 'framework/profiles/<profile>/skills/'],
  ['profiles/<project_profile.name>/skills/feature/', 'profiles/<project_profile.name>/skills/'],
  ['profiles/<project_profile>/skills/feature/', 'profiles/<project_profile>/skills/'],
  ['profiles/<profile>/skills/feature/', 'profiles/<profile>/skills/'],
];

function shouldSkip(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (norm === 'MIGRATION.md') return false;
  const parts = norm.split('/');
  if (parts.some(p => SKIP_DIRS.has(p))) return true;
  return SKIP_GLOBS.some(re => re.test(norm));
}

function walkFiles(base, out) {
  if (!fs.existsSync(base)) return;
  const stat = fs.statSync(base);
  if (stat.isFile()) {
    out.push(base);
    return;
  }
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    const abs = path.join(base, ent.name);
    const rel = path.relative(ROOT, abs);
    if (shouldSkip(rel)) continue;
    if (ent.isDirectory()) walkFiles(abs, out);
    else if (
      /\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template|txt)$/i.test(ent.name)
      || ent.name === 'AGENTS.md'
      || ent.name === 'MIGRATION.md'
      || ent.name === 'README.md'
      || ent.name === 'SKILL.md'
      || ent.name === 'profile-addendum.md'
    ) {
      out.push(abs);
    }
  }
}

const files = [];
for (const r of SCAN_ROOTS) {
  walkFiles(path.join(ROOT, r), files);
}

let changed = 0;
for (const abs of files) {
  let text = fs.readFileSync(abs, 'utf8');
  const orig = text;
  for (const [re, rep] of PROSE_REPLACEMENTS) {
    text = text.replace(re, rep);
  }
  for (const [from, to] of PROFILE_PATH_FIXES) {
    text = text.split(from).join(to);
  }
  if (text !== orig) {
    fs.writeFileSync(abs, text, 'utf8');
    changed++;
    console.log('updated:', path.relative(ROOT, abs));
  }
}
console.log(`done: ${changed} files`);
