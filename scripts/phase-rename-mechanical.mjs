#!/usr/bin/env node
/**
 * Mechanical prd→spec / design→plan rename (zero semantic change).
 * Dev-only; not shipped in release artifact.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.cursor',
]);

/** Paths we must not rewrite content in */
function shouldSkipContent(rel) {
  const n = rel.replace(/\\/g, '/');
  if (n.startsWith('.cursor/')) return true;
  if (n.includes('/node_modules/')) return true;
  // OpenSpec change design.md files keep their name
  if (/^openspec\/changes\/[^/]+\/design\.md$/.test(n)) return true;
  if (/^openspec\/changes\/archive\/[^/]+\/[^/]+\/design\.md$/.test(n)) return true;
  return false;
}

/** Directory renames: oldRel → newRel (deepest first) */
const DIR_RENAMES = [
  ['skills/feature/spec', 'skills/feature/spec'],
  ['skills/feature/plan', 'skills/feature/plan'],
  ['profiles/generic/skills/spec', 'profiles/generic/skills/spec'],
  ['profiles/generic/skills/plan', 'profiles/generic/skills/plan'],
  ['profiles/hmos-app/skills/spec', 'profiles/hmos-app/skills/spec'],
  ['profiles/hmos-app/skills/plan', 'profiles/hmos-app/skills/plan'],
  ['agents/shared/agent-bundle/templates/skills-bridge/spec', 'agents/shared/agent-bundle/templates/skills-bridge/spec'],
  ['agents/shared/agent-bundle/templates/skills-bridge/plan', 'agents/shared/agent-bundle/templates/skills-bridge/plan'],
  ['profiles/hmos-app/harness/tests/fixtures/prd', 'profiles/hmos-app/harness/tests/fixtures/spec'],
];

/** File renames: oldRel → newRel */
const FILE_RENAMES = [
  ['harness/scripts/check-spec.ts', 'harness/scripts/check-spec.ts'],
  ['harness/scripts/check-plan.ts', 'harness/scripts/check-plan.ts'],
  ['specs/phase-rules/spec-rules.yaml', 'specs/phase-rules/spec-rules.yaml'],
  ['specs/phase-rules/plan-rules.yaml', 'specs/phase-rules/plan-rules.yaml'],
  ['harness/prompts/verify-spec.md', 'harness/prompts/verify-spec.md'],
  ['harness/prompts/verify-plan.md', 'harness/prompts/verify-plan.md'],
  ['profiles/hmos-app/harness/prompts/verify-plan.overlay.md', 'profiles/hmos-app/harness/prompts/verify-plan.overlay.md'],
  ['profiles/hmos-app/phase-rules-overlays/spec-rules.overlay.yaml', 'profiles/hmos-app/phase-rules-overlays/spec-rules.overlay.yaml'],
  ['profiles/hmos-app/phase-rules-overlays/plan-rules.overlay.yaml', 'profiles/hmos-app/phase-rules-overlays/plan-rules.overlay.yaml'],
  ['agents/claude/templates/commands/spec.md', 'agents/claude/templates/commands/spec.md'],
  ['agents/claude/templates/commands/plan.md', 'agents/claude/templates/commands/plan.md'],
  ['profiles/hmos-app/harness/providers/spec-visual-handoff.ts', 'profiles/hmos-app/harness/providers/spec-visual-handoff.ts'],
  ['profiles/hmos-app/harness/spec-visual-handoff-check.ts', 'profiles/hmos-app/harness/spec-visual-handoff-check.ts'],
  ['scripts/restore-plan-skill.mjs', 'scripts/restore-plan-skill.mjs'],
  ['skills/project/framework-init/prompts/spec-harness-options.md', 'skills/project/framework-init/prompts/spec-harness-options.md'],
];

/** File renames inside already-renamed skill dirs (run after DIR_RENAMES) */
const POST_DIR_FILE_RENAMES = [
  ['profiles/generic/skills/spec/templates/spec-template.md', 'profiles/generic/skills/spec/templates/spec-template.md'],
  ['profiles/hmos-app/skills/spec/templates/spec-template.md', 'profiles/hmos-app/skills/spec/templates/spec-template.md'],
  ['profiles/generic/skills/plan/templates/plan-template.md', 'profiles/generic/skills/plan/templates/plan-template.md'],
  ['profiles/hmos-app/skills/plan/templates/plan-template.md', 'profiles/hmos-app/skills/plan/templates/plan-template.md'],
  ['profiles/generic/skills/spec/examples/example-spec.md', 'profiles/generic/skills/spec/examples/example-spec.md'],
  ['profiles/hmos-app/skills/spec/examples/example-spec.md', 'profiles/hmos-app/skills/spec/examples/example-spec.md'],
  ['profiles/generic/skills/spec/examples-spec-mapping.md', 'profiles/generic/skills/spec/examples-spec-mapping.md'],
  ['profiles/hmos-app/skills/spec/examples-spec-mapping.md', 'profiles/hmos-app/skills/spec/examples-spec-mapping.md'],
  ['profiles/generic/skills/plan/examples/example-plan.md', 'profiles/generic/skills/plan/examples/example-plan.md'],
  ['profiles/hmos-app/skills/plan/examples/example-plan.md', 'profiles/hmos-app/skills/plan/examples/example-plan.md'],
  ['profiles/generic/skills/plan/examples-plan-domain.md', 'profiles/generic/skills/plan/examples-plan-domain.md'],
  ['profiles/hmos-app/skills/plan/examples-plan-domain.md', 'profiles/hmos-app/skills/plan/examples-plan-domain.md'],
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function renameIfExists(oldRel, newRel) {
  const oldAbs = path.join(ROOT, oldRel);
  const newAbs = path.join(ROOT, newRel);
  if (!fs.existsSync(oldAbs)) {
    if (fs.existsSync(newAbs)) return 'skip-exists';
    return 'missing';
  }
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  fs.renameSync(oldAbs, newAbs);
  return 'ok';
}

function applyContentReplacements(text, rel) {
  let s = text;
  const n = rel.replace(/\\/g, '/');

  // Longest-first path/token replacements
  const pairs = [
    ['plan', 'plan'],
    ['spec', 'spec'],
    ['check-spec.ts', 'check-spec.ts'],
    ['check-plan.ts', 'check-plan.ts'],
    ['check-spec', 'check-spec'],
    ['check-plan', 'check-plan'],
    ['spec-rules.overlay.yaml', 'spec-rules.overlay.yaml'],
    ['plan-rules.overlay.yaml', 'plan-rules.overlay.yaml'],
    ['spec-rules.yaml', 'spec-rules.yaml'],
    ['plan-rules.yaml', 'plan-rules.yaml'],
    ['verify-spec.overlay.md', 'verify-spec.overlay.md'],
    ['verify-plan.overlay.md', 'verify-plan.overlay.md'],
    ['verify-spec.md', 'verify-spec.md'],
    ['verify-plan.md', 'verify-plan.md'],
    ['spec-visual-handoff', 'spec-visual-handoff'],
    ['spec-harness-options.md', 'spec-harness-options.md'],
    ['restore-plan-skill.mjs', 'restore-plan-skill.mjs'],
    ['examples-spec-mapping.md', 'examples-spec-mapping.md'],
    ['example-spec.md', 'example-spec.md'],
    ['example-plan.md', 'example-plan.md'],
    ['examples-plan-domain.md', 'examples-plan-domain.md'],
    ['spec-template.md', 'spec-template.md'],
    ['plan-template.md', 'plan-template.md'],
    ['scope_consistency_with_spec', 'scope_consistency_with_spec'],
    ['spec_p0_coverage', 'spec_p0_coverage'],
    ['spec_p1_coverage', 'spec_p1_coverage'],
    ['spec.feature_path', 'spec.feature_path'],
    ['spec.terminology', 'spec.terminology'],
    ['spec.freeze', 'spec.freeze'],
    ['plan.scope_expansion', 'plan.scope_expansion'],
    ['plan.ok_to_code', 'plan.ok_to_code'],
    ['doc/features/', 'doc/features/'], // noop anchor
  ];

  for (const [from, to] of pairs) {
    s = s.split(from).join(to);
  }

  // Artifact filenames (after path tokens)
  s = s.replace(/\bPRD\.md\b/g, 'spec.md');
  // design.md as artifact — but not openspec design.md
  if (!shouldSkipContent(n)) {
    s = s.replace(/\/design\/design\.md/g, '/plan/plan.md');
    s = s.replace(/\/prd\/PRD\.md/g, '/spec/spec.md');
    s = s.replace(/\/prd\/spec\.md/g, '/spec/spec.md');
    // fixture directory segments in paths
    s = s.replace(/\/prd\//g, '/spec/');
    s = s.replace(/\/design\//g, '/plan/');
  }

  // Phase ids in structured contexts (order: design before prd to avoid partial matches)
  s = s.replace(/"phase":\s*"design"/g, '"phase": "plan"');
  s = s.replace(/"phase":\s*"prd"/g, '"phase": "spec"');
  s = s.replace(/phase:\s*'design'/g, "phase: 'plan'");
  s = s.replace(/phase:\s*'prd'/g, "phase: 'spec'");
  s = s.replace(/phase:\s*"design"/g, 'phase: "plan"');
  s = s.replace(/phase:\s*"prd"/g, 'phase: "spec"');
  s = s.replace(/\--phase plan\b/g, '--phase plan');
  s = s.replace(/\--phase spec\b/g, '--phase spec');
  s = s.replace(/--start plan\b/g, '--start plan');
  s = s.replace(/--start spec\b/g, '--start spec');
  s = s.replace(/--end plan\b/g, '--end plan');
  s = s.replace(/--end spec\b/g, '--end spec');

  // Workflow yaml artifact ids and requires
  s = s.replace(/^(\s*-\s*id:\s*)prd\b/gm, '$1spec');
  s = s.replace(/^(\s*-\s*id:\s*)design\b/gm, '$1plan');
  s = s.replace(/requires:\s*\[([^\]]*)\bprd\b([^\]]*)\]/g, (m, a, b) => m.replace(/\bprd\b/g, 'spec'));
  s = s.replace(/requires:\s*\[([^\]]*)\bdesign\b([^\]]*)\]/g, (m, a, b) => m.replace(/\bdesign\b/g, 'plan'));
  s = s.replace(/auto_chain:\s*\[prd,\s*design/g, 'auto_chain: [spec, plan');
  s = s.replace(/requires:\s*\[design\]/g, 'requires: [plan]');
  s = s.replace(/requires:\s*\[prd\]/g, 'requires: [spec]');

  // KnownPhase type
  s = s.replace(/\|\s*'prd'\s*\n/g, "| 'spec'\n");
  s = s.replace(/\|\s*'design'\s*\n/g, "| 'plan'\n");

  // FeaturePhase
  s = s.replace(/FeaturePhase\s*=\s*'prd'/g, "FeaturePhase = 'spec'");
  s = s.replace(/'prd',\s*'design'/g, "'spec', 'plan'");
  s = s.replace(/\b'prd'\b/g, (match, offset, str) => {
    // Only replace quoted prd in phase lists
    const before = str.slice(Math.max(0, offset - 30), offset);
    if (/FEATURE_PHASE|auto_chain|phases|start_phase|default|KnownPhase|ALLOWED_COMPAT/.test(before)) return "'spec'";
    return match;
  });

  // trace schema enums
  if (n.endsWith('trace.schema.json')) {
    s = s.replace(/"prd"/g, '"spec"').replace(/"design"/g, '"plan"');
  }

  // compat-loader allowed phases
  if (n.includes('compat-loader.ts')) {
    s = s.replace(/'spec', 'plan'/g, "'spec', 'plan'");
  }

  return s;
}

function renameFixtureArtifactDirs() {
  // Rename prd/spec.md → spec/spec.md and design/design.md → plan/plan.md inside fixtures
  const fixtureRoots = [
    'harness/tests/fixtures',
    'profiles/hmos-app/harness/tests/fixtures',
    'profiles/generic/harness/tests/fixtures',
  ];
  for (const fr of fixtureRoots) {
    const absFr = path.join(ROOT, fr);
    if (!fs.existsSync(absFr)) continue;
    for (const file of walk(absFr)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      // prd/spec.md or prd/spec.md
      if (/\/prd\/(PRD|spec)\.md$/.test(rel)) {
        const dir = path.dirname(file);
        const featDir = path.dirname(dir);
        const specDir = path.join(featDir, 'spec');
        fs.mkdirSync(specDir, { recursive: true });
        const target = path.join(specDir, 'spec.md');
        if (!fs.existsSync(target)) fs.renameSync(file, target);
        else fs.unlinkSync(file);
        try { fs.rmdirSync(dir); } catch { /* not empty */ }
      }
      if (/\/design\/(design|plan)\.md$/.test(rel)) {
        const dir = path.dirname(file);
        const featDir = path.dirname(dir);
        const planDir = path.join(featDir, 'plan');
        fs.mkdirSync(planDir, { recursive: true });
        const target = path.join(planDir, 'plan.md');
        if (!fs.existsSync(target)) fs.renameSync(file, target);
        else fs.unlinkSync(file);
        try { fs.rmdirSync(dir); } catch { /* not empty */ }
      }
      // flat spec.md at feature root in fixtures (non-legacy tests) → keep for legacy tests only
    }
  }
}

function main() {
  console.log('=== Phase rename: directories ===');
  for (const [oldR, newR] of DIR_RENAMES) {
    const r = renameIfExists(oldR, newR);
    console.log(`  ${oldR} → ${newR}: ${r}`);
  }

  console.log('=== Phase rename: files ===');
  for (const [oldR, newR] of FILE_RENAMES) {
    const r = renameIfExists(oldR, newR);
    console.log(`  ${oldR} → ${newR}: ${r}`);
  }

  console.log('=== Phase rename: post-dir files ===');
  for (const [oldR, newR] of POST_DIR_FILE_RENAMES) {
    const r = renameIfExists(oldR, newR);
    console.log(`  ${oldR} → ${newR}: ${r}`);
  }

  renameFixtureArtifactDirs();

  console.log('=== Phase rename: content ===');
  let changed = 0;
  for (const abs of walk(ROOT)) {
    const rel = path.relative(ROOT, abs);
    if (shouldSkipContent(rel)) continue;
    const ext = path.extname(abs).toLowerCase();
    if (!['.ts', '.yaml', '.yml', '.md', '.json', '.mjs', '.ets'].includes(ext)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const next = applyContentReplacements(raw, rel);
    if (next !== raw) {
      fs.writeFileSync(abs, next, 'utf8');
      changed++;
    }
  }
  console.log(`  ${changed} files updated`);

  // Write inventory summary
  const invPath = path.join(ROOT, 'scripts', 'phase-rename-inventory.json');
  fs.writeFileSync(
    invPath,
    JSON.stringify({ dir_renames: DIR_RENAMES, file_renames: FILE_RENAMES, content_files_changed: changed }, null, 2),
    'utf8',
  );
  console.log(`Inventory: ${invPath}`);
}

main();
