#!/usr/bin/env node
/** profile 镜像路径保持扁平：profiles/<p>/skills/<id>/，不得含 project|feature 嵌套 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

const SKIP = [
  /[/\\]\.git[/\\]/,
  /[/\\]node_modules[/\\]/,
  /[/\\]harness[/\\]tests[/\\]/,
  /[/\\]\.cursor[/\\]/,
  /[/\\]openspec[/\\]changes[/\\]archive[/\\]/,
];

const SCAN_ROOTS = [
  'skills', 'profiles', 'agents', 'harness', 'workflows', 'docs', 'templates',
  'specs', 'openspec/specs', 'openspec/changes', 'README.md', 'MIGRATION.md',
];

const TEXT_RE = /\.(md|mdc|yaml|yml|ts|json|template\.md|md\.template|txt)$/i;

function shouldSkip(rel) {
  const n = rel.replace(/\\/g, '/');
  return SKIP.some((re) => re.test(n));
}

function walk(base, out) {
  if (!fs.existsSync(base)) return;
  const st = fs.statSync(base);
  if (st.isFile()) {
    out.push(base);
    return;
  }
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    const abs = path.join(base, ent.name);
    const rel = path.relative(ROOT, abs);
    if (shouldSkip(rel)) continue;
    if (ent.isDirectory()) walk(abs, out);
    else if (TEXT_RE.test(ent.name) || ent.name === 'SKILL.md' || ent.name === 'profile-addendum.md' || ent.name === 'README.md') {
      out.push(abs);
    }
  }
}

function fixProfileMirrorPaths(text) {
  let out = text;
  // 仅修正 profiles/ 下的镜像路径，不动根 skills/project|feature/
  out = out.replace(/profiles\/([A-Za-z0-9_.-]+)\/skills\/project\//g, 'profiles/$1/skills/');
  out = out.replace(/profiles\/([A-Za-z0-9_.-]+)\/skills\/feature\//g, 'profiles/$1/skills/');
  out = out.replace(/profiles\/\$\{[^}]+\}\/skills\/project\//g, (m) => m.replace('/skills/project/', '/skills/'));
  out = out.replace(/profiles\/\$\{[^}]+\}\/skills\/feature\//g, (m) => m.replace('/skills/feature/', '/skills/'));
  out = out.replace(/profiles\/<project_profile(?:\.name)?>\/skills\/project\//g, 'profiles/<project_profile.name>/skills/');
  out = out.replace(/profiles\/<project_profile(?:\.name)?>\/skills\/feature\//g, 'profiles/<project_profile.name>/skills/');
  out = out.replace(/profiles\/<profile>\/skills\/feature\//g, 'profiles/<profile>/skills/');
  out = out.replace(/profiles\/<目标 profile>\/skills\/feature\//g, 'profiles/<目标 profile>/skills/');
  out = out.replace(/profiles\/<宿主 project_profile>\/skills\/feature\//g, 'profiles/<宿主 project_profile>/skills/');
  return out;
}

const files = [];
for (const r of SCAN_ROOTS) walk(path.join(ROOT, r), files);

let changed = 0;
for (const abs of files) {
  const orig = fs.readFileSync(abs, 'utf8');
  const next = fixProfileMirrorPaths(orig);
  if (next !== orig) {
    fs.writeFileSync(abs, next, 'utf8');
    changed++;
    console.log('fixed:', path.relative(ROOT, abs));
  }
}
console.log(`done: ${changed} files`);
