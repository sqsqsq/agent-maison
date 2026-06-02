#!/usr/bin/env node
// gen-changelog.mjs — 从 plan 生成 MAINTAINER-CHANGELOG.md
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compareSemver,
  isValidSemver,
  loadAllPlans,
  readCurrentVersion,
} from './plan-version-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'MAINTAINER-CHANGELOG.md');

function parseArgs(argv) {
  let from;
  let to;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from' && argv[i + 1]) {
      from = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--to' && argv[i + 1]) {
      to = argv[i + 1];
      i += 1;
    }
  }
  return { from, to };
}

function todoSummary(todos) {
  const total = todos.length;
  const done = todos.filter((t) => t.status === 'completed').length;
  return `${done}/${total} completed`;
}

function diffMode(plans, from, to) {
  if (!isValidSemver(from) || !isValidSemver(to)) {
    throw new Error('--from and --to must be valid semver');
  }
  const selected = plans.filter((p) => {
    const v = p.parsed.version;
    if (!v || !isValidSemver(v)) return false;
    return compareSemver(v, from) > 0 && compareSemver(v, to) <= 0;
  });
  selected.sort((a, b) => compareSemver(b.parsed.version, a.parsed.version));

  console.log(`# Changes (${from} → ${to}]\n`);
  for (const p of selected) {
    const { name, overview, version, todos } = p.parsed;
    console.log(`- **${name ?? p.basename}** (\`${version}\`) — ${overview ?? ''} [${todoSummary(todos)}]`);
  }
  if (selected.length === 0) console.log('_(no versioned plans in range)_');
}

function writeChangelog(repoRoot) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const current = readCurrentVersion(repoRoot);
  const plans = loadAllPlans(repoRoot);

  /** @type {Map<string, typeof plans>} */
  const byVersion = new Map();
  /** @type {typeof plans} */
  const legacy = [];

  for (const p of plans) {
    const v = p.parsed.version;
    if (!v || !isValidSemver(v)) {
      legacy.push(p);
      continue;
    }
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(p);
  }

  const versions = [...byVersion.keys()].sort((a, b) => compareSemver(b, a));
  const lines = [
    '# Maintainer Changelog (dev-only)',
    '',
    `> 由 \`npm run release:changelog\` 从 \`.cursor/plans/*.plan.md\` 自动生成。消费者向变更见 \`RELEASE-NOTES-v*.md\` 与 \`MIGRATION.md\`。`,
    '',
    `Generated: ${generatedAt} · current window: \`${current}\``,
    '',
  ];

  for (const v of versions) {
    lines.push(`## ${v}`, '');
    for (const p of byVersion.get(v)) {
      const { name, overview, todos } = p.parsed;
      lines.push(`- **${name ?? p.basename}** — ${overview ?? '(no overview)'} [${todoSummary(todos)}]`);
      lines.push(`  - \`${p.basename}\``);
    }
    lines.push('');
  }

  if (legacy.length) {
    lines.push('## (legacy / 未分版)', '');
    for (const p of legacy) {
      lines.push(`- **${p.parsed.name ?? p.basename}** — ${p.parsed.overview ?? ''}`);
    }
    lines.push('');
  }

  fs.writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[gen-changelog] wrote ${OUT}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { from, to } = parseArgs(process.argv.slice(2));
  const plans = loadAllPlans(REPO_ROOT);
  if (from && to) {
    diffMode(plans, from, to);
  } else {
    writeChangelog(REPO_ROOT);
  }
}
