#!/usr/bin/env node
/** 按文件深度归一化 skills/** 内指向 skills/reference/ 的相对链接（幂等） */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS = path.join(ROOT, 'skills');
const REF = path.join(SKILLS, 'reference');

const REF_LINK_RE = /(\]\(|`)(?:\.\.\/)+reference\//g;

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else if (/\.md$/i.test(ent.name)) out.push(abs);
  }
}

function prefixToReference(fileAbs) {
  const dir = path.dirname(fileAbs);
  let rel = path.relative(dir, REF).replace(/\\/g, '/');
  if (rel === '') rel = '.';
  return rel.endsWith('/') ? rel : `${rel}/`;
}

const files = [];
for (const scope of ['project', 'feature']) {
  const base = path.join(SKILLS, scope);
  if (fs.existsSync(base)) walk(base, files);
}

let changed = 0;
for (const abs of files) {
  const prefix = prefixToReference(abs);
  const orig = fs.readFileSync(abs, 'utf8');
  const next = orig.replace(REF_LINK_RE, `$1${prefix}`);
  if (next !== orig) {
    fs.writeFileSync(abs, next, 'utf8');
    changed++;
    console.log('fixed:', path.relative(ROOT, abs), '→', prefix);
  }
}
console.log(`done: ${changed} files`);
