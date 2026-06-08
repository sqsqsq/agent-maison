#!/usr/bin/env node
/** 归一化 skills/project|feature 内指向仓根的 ../ 前缀（幂等） */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS = path.join(ROOT, 'skills');

// 不含 framework/ —— 文件已在 framework 树内，href 须为 ../../../harness 而非 ../../../framework/harness
const TOP_TARGETS =
  '(?:harness|agents|templates|workflows|specs|docs|profiles|README\\.md)';

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else if (/\.md$/i.test(ent.name)) out.push(abs);
  }
}

function prefixToRoot(fileAbs) {
  const dir = path.dirname(fileAbs);
  const depth = path.relative(ROOT, dir).split(/[/\\]/).filter(Boolean).length;
  return '../'.repeat(Math.max(depth, 1));
}

const files = [];
for (const scope of ['project', 'feature']) {
  const base = path.join(SKILLS, scope);
  if (fs.existsSync(base)) walk(base, files);
}

const re = new RegExp(`(\\]|\\()((?:\\.\\./)+)(${TOP_TARGETS})`, 'g');

let changed = 0;
for (const abs of files) {
  const want = prefixToRoot(abs);
  const orig = fs.readFileSync(abs, 'utf8');
  const next = orig.replace(re, (m, open, _old, target) => `${open}${want}${target}`);
  if (next !== orig) {
    fs.writeFileSync(abs, next, 'utf8');
    changed++;
    console.log('fixed:', path.relative(ROOT, abs), '→', want);
  }
}
console.log(`done: ${changed} files`);
