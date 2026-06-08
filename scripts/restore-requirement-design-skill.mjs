#!/usr/bin/env node
/** Dev-only: restore skills/feature/requirement-design/SKILL.md from git HEAD + scope migration */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
let body = execSync('git show HEAD:skills/2-requirement-design/SKILL.md').toString('utf8');

const reps = [
  ['2-requirement-design', 'requirement-design'],
  ['00-framework-init', 'framework-init'],
  ['0-catalog-bootstrap', 'catalog-bootstrap'],
  ['[`00-framework-init`](../00-framework-init/SKILL.md)', '[`framework-init`](../../project/framework-init/SKILL.md)'],
  ['[`framework-init`](../framework-init/SKILL.md)', '[`framework-init`](../../project/framework-init/SKILL.md)'],
  ['[`0-catalog-bootstrap`](../0-catalog-bootstrap/SKILL.md)', '[`catalog-bootstrap`](../../project/catalog-bootstrap/SKILL.md)'],
  ['[Skill 0 catalog-bootstrap](../catalog-bootstrap/SKILL.md)', '[catalog-bootstrap](../../project/catalog-bootstrap/SKILL.md)'],
  ['../00-framework-init/', '../../project/framework-init/'],
  ['../0-catalog-bootstrap/', '../../project/catalog-bootstrap/'],
  ['../reference/', '../../reference/'],
  ['[`framework/harness/config.ts`](../../harness/config.ts)', '[`framework/harness/config.ts`](../../../harness/config.ts)'],
  ['[Profile skill asset protocol](../README.md', '[Profile skill asset protocol](../../../README.md'],
  ['[framework/agents/README.md](../../agents/README.md)', '[framework/agents/README.md](../../../agents/README.md)'],
  ['../../framework/harness/', '../../../harness/'],
  ['[`agent-behavioral-principles.md`](../reference/', '[`agent-behavioral-principles.md`](../../reference/'],
  ['profiles/<project_profile.name>/skills/2-requirement-design/', 'profiles/<project_profile.name>/skills/requirement-design/'],
  ['profile-skill-asset:5-business-ut/', 'profile-skill-asset:business-ut/'],
  ['profile-skill-asset:2-requirement-design/', 'profile-skill-asset:requirement-design/'],
  ['profile-skill-asset:1-prd-design/', 'profile-skill-asset:prd-design/'],
];
for (const [from, to] of reps) {
  body = body.split(from).join(to);
}

// consumer 布局：framework/skills/feature/requirement-design → host 根 4 层
body = body.replace(
  /\]\(\.\.\/\.\.\/\.\.\/(framework\.config\.json|doc\/[^)]+)\)/g,
  '](../../../../$1)',
);
body = body.replace(
  /\]\(\.\.\/\.\.\/(doc\/architecture\.md|doc\/module-catalog\.yaml)\)/g,
  '](../../../../$1)',
);

const out = path.join(ROOT, 'skills/feature/requirement-design/SKILL.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body, 'utf8');
execSync('node scripts/normalize-skill-repo-root-links.mjs', { cwd: ROOT, stdio: 'inherit' });
// git 旧版含 Skill N 编号正文，须转为扁平 skill id（no_numbered_skill_prose 门禁）
execSync('node scripts/migrate-skill-prose.mjs', { cwd: ROOT, stdio: 'inherit' });
console.log('wrote', path.relative(ROOT, out), 'lines', body.split('\n').length);
