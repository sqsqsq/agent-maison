#!/usr/bin/env node
/** Second-pass fixups after mechanical rename */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['harness', 'skills', 'specs', 'workflows', 'profiles', 'agents', 'docs', 'MIGRATION.md'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function fix(text, rel) {
  let s = text;
  // Artifact filenames
  s = s.replace(/'design\.md'/g, "'plan.md'");
  s = s.replace(/"design\.md"/g, '"plan.md"');
  s = s.replace(/`design\.md`/g, '`plan.md`');
  s = s.replace(/loadFeatureDoc\([^,]+,\s*[^,]+,\s*'design\.md'\)/g, (m) =>
    m.replace('design.md', 'plan.md'),
  );
  s = s.replace(/loadDoc\(ctx,\s*'design\.md'\)/g, "loadDoc(ctx, 'plan.md')");
  s = s.replace(/\['spec\.md',\s*'design\.md'\]/g, "['spec.md', 'plan.md']");
  s = s.replace(/featureArtifactLayoutWarnings\([^)]+\['spec\.md',\s*'design\.md'\]/g, (m) =>
    m.replace('design.md', 'plan.md'),
  );

  // Phase types / ids in harness code
  s = s.replace(/FeaturePhase = 'spec' \| 'design'/g, "FeaturePhase = 'spec' | 'plan'");
  s = s.replace(/'spec' \| 'design'/g, "'spec' | 'plan'");
  s = s.replace(/type Phase = 'prd' \| 'design'/g, "type Phase = 'spec' | 'plan'");
  s = s.replace(/ContextExplorationPhase = 'prd' \| 'design'/g, "ContextExplorationPhase = 'spec' | 'plan'");
  s = s.replace(/prd: 'prd'/g, "prd: 'spec'");
  s = s.replace(/design: 'design'/g, "design: 'plan'");
  s = s.replace(/设计: 'design'/g, "设计: 'plan'");
  s = s.replace(/normalizePhase\([^,]+,\s*'prd'\)/g, (m) => m.replace("'prd'", "'spec'"));
  s = s.replace(/argv\.start \?\? 'prd'/g, "argv.start ?? 'spec'");
  s = s.replace(/default: prd\b/g, 'default: spec');
  s = s.replace(/phase === 'design'/g, "phase === 'plan'");
  s = s.replace(/phase === 'prd'/g, "phase === 'spec'");
  s = s.replace(/\['design', 'coding', 'review'/g, "['plan', 'coding', 'review'");
  s = s.replace(/design: \['prd'/g, "plan: ['spec'");
  s = s.replace(/coding: \['design'/g, "coding: ['plan'");
  s = s.replace(/review: \[[^\]]*'design'\]/g, (m) => m.replace(/'design'/g, "'plan'"));
  s = s.replace(/checkContextExplorationArtifact\([^,]+,\s*[^,]+,\s*'prd'/g, (m) =>
    m.replace("'prd'", "'spec'"),
  );
  s = s.replace(/checkContextExplorationArtifact\([^,]+,\s*[^,]+,\s*'design'/g, (m) =>
    m.replace("'design'", "'plan'"),
  );
  s = s.replace(/sub === 'prd'/g, "sub === 'spec'");
  s = s.replace(/sub === 'design'/g, "sub === 'plan'");
  s = s.replace(/through: 'design'/g, "through: 'plan'");
  s = s.replace(/case 'prd':/g, "case 'spec':");
  s = s.replace(/case 'design':/g, "case 'plan':");
  s = s.replace(/if \(phase === 'prd'\)/g, "if (phase === 'spec')");
  s = s.replace(/ALLOWED_COMPAT_PHASES = new Set\(\['spec', 'plan'/g, match => match);
  s = s.replace(/'spec', 'design'/g, "'spec', 'plan'");

  // types.ts KnownPhase
  if (rel.endsWith('types.ts')) {
    s = s.replace(/\| 'prd'/g, "| 'spec'");
    s = s.replace(/\| 'design'/g, "| 'plan'");
  }

  // goal-manifest schema
  if (rel.includes('goal-manifest.schema')) {
    s = s.replace(/default: prd/g, 'default: spec');
  }

  // workflow description
  if (rel.includes('spec-driven.workflow.yaml')) {
    s = s.replace(/PRD → design/g, 'spec → plan');
  }

  // check-receipt
  if (rel.includes('check-receipt.ts')) {
    s = s.replace(/'prd' \| 'design'/g, "'spec' | 'plan'");
  }

  // harness-runner phase lists
  s = s.replace(/\['design', 'coding', 'review', 'ut', 'testing'\]/g, "['plan', 'coding', 'review', 'ut', 'testing']");

  // Comments referencing design.md as doc
  s = s.replace(/vs design\.md/g, 'vs plan.md');
  s = s.replace(/design\.md 中/g, 'plan.md 中');
  s = s.replace(/design\.md「/g, 'plan.md「');
  s = s.replace(/读取 design\.md/g, '读取 plan.md');
  s = s.replace(/doc\/features\/\{feature\}\/design\.md/g, 'doc/features/{feature}/plan/plan.md');

  return s;
}

let n = 0;
for (const t of TARGETS) {
  const base = path.join(ROOT, t);
  if (t === 'MIGRATION.md') {
    if (fs.existsSync(base)) {
      const raw = fs.readFileSync(base, 'utf8');
      const next = fix(raw, 'MIGRATION.md');
      if (next !== raw) { fs.writeFileSync(base, next); n++; }
    }
    continue;
  }
  for (const abs of walk(base)) {
    const ext = path.extname(abs).toLowerCase();
    if (!['.ts', '.yaml', '.yml', '.md', '.json'].includes(ext)) continue;
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const raw = fs.readFileSync(abs, 'utf8');
    const next = fix(raw, rel);
    if (next !== raw) {
      fs.writeFileSync(abs, next);
      n++;
    }
  }
}
console.log(`fixup: ${n} files`);
