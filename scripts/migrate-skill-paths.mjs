#!/usr/bin/env node
/**
 * One-shot migration helper: replace numbered skill paths/ids in publishable + harness trees.
 * Dev-only; not part of release package.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

const REPLACEMENTS = [
  ['skills/00-framework-init/', 'skills/project/framework-init/'],
  ['skills/0-catalog-bootstrap/', 'skills/project/catalog-bootstrap/'],
  ['skills/1-spec/', 'skills/feature/spec/'],
  ['skills/2-plan/', 'skills/feature/plan/'],
  ['skills/3-coding/', 'skills/feature/coding/'],
  ['skills/4-code-review/', 'skills/feature/code-review/'],
  ['skills/5-business-ut/', 'skills/feature/business-ut/'],
  ['skills/6-device-testing/', 'skills/feature/device-testing/'],
  ['skills/00b-framework-setup/', 'skills/reference/personal-setup-gate.md'],
  ['profile-skill-asset:00-framework-init/', 'profile-skill-asset:framework-init/'],
  ['profile-skill-asset:0-catalog-bootstrap/', 'profile-skill-asset:catalog-bootstrap/'],
  ['profile-skill-asset:1-spec/', 'profile-skill-asset:spec/'],
  ['profile-skill-asset:2-plan/', 'profile-skill-asset:plan/'],
  ['profile-skill-asset:3-coding/', 'profile-skill-asset:coding/'],
  ['profile-skill-asset:4-code-review/', 'profile-skill-asset:code-review/'],
  ['profile-skill-asset:5-business-ut/', 'profile-skill-asset:business-ut/'],
  ['profile-skill-asset:6-device-testing/', 'profile-skill-asset:device-testing/'],
  ['skills/00-framework-init', 'skills/project/framework-init'],
  ['skills/0-catalog-bootstrap', 'skills/project/catalog-bootstrap'],
  ['skills/1-spec', 'skills/feature/spec'],
  ['skills/2-plan', 'skills/feature/plan'],
  ['skills/3-coding', 'skills/feature/coding'],
  ['skills/4-code-review', 'skills/feature/code-review'],
  ['skills/5-business-ut', 'skills/feature/business-ut'],
  ['skills/6-device-testing', 'skills/feature/device-testing'],
  ['00-framework-init', 'framework-init'],
  ['0-catalog-bootstrap', 'catalog-bootstrap'],
  ['1-spec', 'spec'],
  ['2-plan', 'plan'],
  ['3-coding', 'coding'],
  ['4-code-review', 'code-review'],
  ['5-business-ut', 'business-ut'],
  ['6-device-testing', 'device-testing'],
  ['00b-framework-setup', 'personal-setup-gate'],
];

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.cursor', 'openspec/changes/archive',
]);
const SKIP_GLOBS = [
  /harness\/tests\//,
  /profiles\/[^/]+\/harness\/tests\//,
  /harness\/reports\//,
  /\.cursor\/plans\//,
  /RELEASE-NOTES-v/,
  /scripts\/migrate-skill-paths\.mjs$/,
];

const SCAN_ROOTS = [
  'skills', 'profiles', 'agents', 'harness', 'workflows', 'docs', 'templates',
  'specs', 'openspec/specs', 'openspec/changes', 'README.md', 'AGENTS.md', 'MIGRATION.md',
];

function shouldSkip(rel) {
  const parts = rel.split(/[/\\]/);
  if (parts.some(p => SKIP_DIRS.has(p))) return true;
  return SKIP_GLOBS.some(re => re.test(rel.replace(/\\/g, '/')));
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
    else if (/\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template)$/i.test(ent.name) || ent.name === 'AGENTS.md' || ent.name === 'MIGRATION.md' || ent.name === 'README.md') {
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
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (text !== orig) {
    fs.writeFileSync(abs, text, 'utf8');
    changed++;
    console.log('updated:', path.relative(ROOT, abs));
  }
}
console.log(`done: ${changed} files`);
