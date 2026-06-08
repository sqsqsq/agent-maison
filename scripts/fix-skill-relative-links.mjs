#!/usr/bin/env node
/** Fix relative markdown links after skills/project|feature/ nesting */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS = path.join(ROOT, 'skills');

const REPLACEMENTS = [
  ['../personal-setup-gate/SKILL.md', '../../reference/personal-setup-gate.md'],
  ['../personal-setup-gate.md', '../../reference/personal-setup-gate.md'],
  ['../framework-init/', '../../project/framework-init/'],
  ['../catalog-bootstrap/', '../../project/catalog-bootstrap/'],
  ['../requirement-design/', '../../feature/requirement-design/'],
  ['../prd-design/', '../../feature/prd-design/'],
  ['../coding/', '../../feature/coding/'],
  ['../code-review/', '../../feature/code-review/'],
  ['../business-ut/', '../../feature/business-ut/'],
  ['../device-testing/', '../../feature/device-testing/'],
  ['../prd-design/', '../prd-design/'],
  ['../requirement-design/', '../requirement-design/'],
  ['../coding/', '../coding/'],
  // reference/ 链接由 normalize-skill-reference-links.mjs 按深度幂等修正，此处不再替换
  ['../README.md', '../../README.md'],
  ['../../harness/', '../../../harness/'],
  ['../../agents/', '../../../agents/'],
  ['../../templates/', '../../../templates/'],
  ['../../profiles/', '../../../profiles/'],
  ['../../workflows/', '../../../workflows/'],
  ['../../specs/', '../../../specs/'],
  ['../../doc/', '../../../doc/'],
  ['../../docs/', '../../../docs/'],
  ['../../framework/', '../../../framework/'],
];

const PROMPT_EXTRA = [
  ['../../../agents/', '../../../../agents/'],
  ['../../../templates/', '../../../../templates/'],
  ['../../../workflows/', '../../../../workflows/'],
  ['../../../specs/', '../../../../specs/'],
  ['../../prd-design/', '../../../feature/prd-design/'],
];

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else if (/\.md$/i.test(ent.name)) out.push(abs);
  }
}

const files = [];
for (const scope of ['project', 'feature']) {
  const base = path.join(SKILLS, scope);
  if (fs.existsSync(base)) walk(base, files);
}

let changed = 0;
for (const abs of files) {
  let text = fs.readFileSync(abs, 'utf8');
  const orig = text;
  const isPrompt = abs.includes(`${path.sep}prompts${path.sep}`);
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (isPrompt) {
    for (const [from, to] of PROMPT_EXTRA) {
      text = text.split(from).join(to);
    }
  }
  if (text !== orig) {
    fs.writeFileSync(abs, text, 'utf8');
    changed++;
    console.log('fixed:', path.relative(ROOT, abs));
  }
}
console.log(`done: ${changed} files`);
