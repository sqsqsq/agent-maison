#!/usr/bin/env node
/**
 * Restore feature SKILL.md from pre-corruption commit (96c6e0e) using legacy numbered paths.
 * Corruption was introduced in 876b9e1 refactor when blobs were not read as UTF-8 buffer.
 */
import { execSync } from 'child_process';
import fs from 'fs';

const REV = process.env.GIT_REV || '96c6e0e3999c071b6e54eba48f9c399ce1a55801';

/** [gitPath@REV, workspaceOutPath] */
const RESTORES = [
  ['skills/1-prd-design/SKILL.md', 'skills/feature/spec/SKILL.md'],
  ['skills/2-requirement-design/SKILL.md', 'skills/feature/plan/SKILL.md'],
  ['skills/3-coding/SKILL.md', 'skills/feature/coding/SKILL.md'],
  ['skills/4-code-review/SKILL.md', 'skills/feature/code-review/SKILL.md'],
  ['skills/5-business-ut/SKILL.md', 'skills/feature/business-ut/SKILL.md'],
  ['skills/6-device-testing/SKILL.md', 'skills/feature/device-testing/SKILL.md'],
];

for (const [gitPath, outPath] of RESTORES) {
  const buf = execSync(`git show ${REV}:${gitPath}`, { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024 });
  const text = buf.toString('utf8');
  const fffd = (text.match(/\uFFFD/g) || []).length;
  if (fffd > 0) {
    console.error(`still U+FFFD (${fffd}) in ${REV}:${gitPath}`);
    process.exit(1);
  }
  fs.mkdirSync(outPath.split('/').slice(0, -1).join('/'), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf8');
  console.log('restored', outPath, 'from', `${REV}:${gitPath}`);
}
