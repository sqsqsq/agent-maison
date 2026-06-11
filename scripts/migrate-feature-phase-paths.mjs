#!/usr/bin/env node
/**
 * 实例 doc/features/** 路径迁移：prd/PRD.md → spec/spec.md，design/design.md → plan/plan.md
 * Dev-only；默认 dry-run。
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const prRootIdx = args.indexOf('--project-root');
const projectRoot = prRootIdx >= 0 ? path.resolve(args[prRootIdx + 1]) : process.cwd();
const featuresDir = path.join(projectRoot, 'doc', 'features');

const MOVES = [
  { from: ['prd', 'PRD.md'], to: ['spec', 'spec.md'] },
  { from: ['prd', 'spec.md'], to: ['spec', 'spec.md'] },
  { from: ['design', 'design.md'], to: ['plan', 'plan.md'] },
  { from: ['design', 'plan.md'], to: ['plan', 'plan.md'] },
];

function walkFeatures() {
  if (!fs.existsSync(featuresDir)) return [];
  const out = [];
  for (const feat of fs.readdirSync(featuresDir, { withFileTypes: true })) {
    if (!feat.isDirectory()) continue;
    out.push(path.join(featuresDir, feat.name));
  }
  return out;
}

let planned = 0;
for (const featDir of walkFeatures()) {
  for (const { from, to } of MOVES) {
    const src = path.join(featDir, ...from);
    const dst = path.join(featDir, ...to);
    if (!fs.existsSync(src)) continue;
    if (path.resolve(src) === path.resolve(dst)) continue;
    if (fs.existsSync(dst)) {
      console.warn(`SKIP (target exists): ${path.relative(projectRoot, dst)}`);
      continue;
    }
    console.log(`${dryRun ? '[dry-run] ' : ''}mv ${path.relative(projectRoot, src)} → ${path.relative(projectRoot, dst)}`);
    planned++;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      try {
        fs.rmdirSync(path.dirname(src));
      } catch {
        /* not empty */
      }
    }
  }
}
console.log(`${dryRun ? 'Dry-run' : 'Applied'}: ${planned} move(s). ${dryRun ? 'Pass --apply to execute.' : ''}`);
