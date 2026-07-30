#!/usr/bin/env node
/**
 * Re-apply repository-specific patches after `openspec update`.
 * The operation is deliberately all-or-nothing: every generated target is read and
 * validated before any file is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const targets = [
  '.cursor/commands/opsx-propose.md',
  '.cursor/commands/opsx-apply.md',
  '.cursor/commands/opsx-archive.md',
  '.cursor/commands/opsx-explore.md',
  '.cursor/skills/openspec-propose/SKILL.md',
  '.cursor/skills/openspec-apply-change/SKILL.md',
  '.cursor/skills/openspec-archive-change/SKILL.md',
  '.cursor/skills/openspec-explore/SKILL.md',
  '.codex/skills/openspec-propose/SKILL.md',
  '.codex/skills/openspec-apply-change/SKILL.md',
  '.codex/skills/openspec-archive-change/SKILL.md',
  '.codex/skills/openspec-explore/SKILL.md',
];

const EXPECTED_ANCHOR = new Map(targets.map(rel => {
  const base = rel.includes('propose') ? 'openspec-propose'
    : rel.includes('apply') ? 'openspec-apply'
      : rel.includes('archive') ? 'openspec-archive'
        : 'openspec-explore';
  const name = rel.includes('/commands/') ? `name: /${base.replace('openspec-', 'opsx-')}`
    : `name: ${base}${base === 'openspec-apply' || base === 'openspec-archive' ? '-change' : ''}`;
  return [rel, name];
}));

const CLI_PREFIX = 'npm run openspec -- ';
const PATCHED_COMPAT = 'compatibility: Requires npm run openspec (pinned @fission-ai/openspec@1.3.1 in devDependencies).';
const RAW_CLI = /(?<![\w-])openspec (?=(?:archive|instructions|list|new|show|status|validate)\b)/g;
// 转换只维护已知命令；后验则对任意同一行的裸 `openspec <subcommand>` fail-closed。
// 只吃空格/Tab，不跨换行误伤 YAML `author: openspec` + `version:`。
const BARE_CLI_COMMAND = /(?<![\w-])openspec[ \t]+(?=[a-z][\w-]*\b)/g;
const OLD_OPSX = /\/opsx:(?:propose|apply|archive|explore|continue)\b/g;
const CORRUPT = /npm run\s+npm run openspec|npm run openspec --\s+--/;

export function patchCli(text) {
  let out = text
    .replace('compatibility: Requires openspec CLI.', PATCHED_COMPAT)
    .replace('compatibility: Requires npm run openspec -- CLI.', PATCHED_COMPAT);
  out = out.replace(RAW_CLI, CLI_PREFIX);
  return out
    .replace(/\/opsx:propose/g, '/opsx-propose')
    .replace(/\/opsx:apply/g, '/opsx-apply')
    .replace(/\/opsx:archive/g, '/opsx-archive')
    .replace(/\/opsx:explore/g, '/opsx-explore')
    .replace(/\/opsx:continue/g, '/opsx-continue');
}

function patchArchiveStep(text) {
  const archiveBlock = `5. **Perform the archive**

   Use the OpenSpec CLI (cross-platform; do not use \`mkdir -p\` / \`mv\`):

   \`\`\`bash
   ${CLI_PREFIX}archive "<name>"
   \`\`\`

   - To archive without merging delta specs: add \`--skip-specs\`
   - To skip prompts in scripted flows: add \`-y\`

   The CLI moves the change to \`openspec/changes/archive/YYYY-MM-DD-<name>/\` and merges delta specs when applicable.`;
  return text.replace(
    /5\. \*\*Perform the archive\*\*[\s\S]*?```bash\n   mv openspec\/changes\/<name> openspec\/changes\/archive\/YYYY-MM-DD-<name>\n   ```/,
    archiveBlock,
  );
}

const CODEX_PREAMBLE = `## Codex environment notes

- Run OpenSpec from the repository root via \`npm run openspec -- <subcommand>\` (no global CLI required).
- Ask clarifying questions directly in chat; do not invoke AskUserQuestion, TodoWrite, or Task by tool name.
- Track progress with a short checklist in your reply.
- Prefer \`npm run openspec -- archive "<name>"\` for cross-platform archive + spec merge.

`;

export function patchCodex(text) {
  let out = patchArchiveStep(patchCli(text))
    .replace(/use the \*\*AskUserQuestion tool\*\* to let the user select/gi, 'ask the user directly in chat to select a change')
    .replace(/Use the \*\*AskUserQuestion tool\*\* \(open-ended, no preset options\) to ask:/g, 'Ask the user directly in chat:')
    .replace(/Use the \*\*AskUserQuestion tool\*\* to let the user select\./g, 'Ask the user directly in chat to select a change.')
    .replace(/Use \*\*AskUserQuestion tool\*\* to confirm user wants to proceed/g, 'Ask the user directly in chat to confirm before proceeding')
    .replace(/Use \*\*AskUserQuestion tool\*\* to clarify/g, 'Ask the user directly in chat to clarify')
    .replace(/Use the \*\*TodoWrite tool\*\* to track progress through the artifacts\./g, 'Track artifact progress with a short checklist in your reply.')
    .replace(
      /If user chooses sync, use Task tool \(subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs for change '<name>'\. Delta spec analysis: <include the analyzed delta spec summary>"\)\. Proceed to archive regardless of choice\./,
      'If user chooses sync, merge delta specs into `openspec/specs/` following OpenSpec delta rules, then run `npm run openspec -- archive "<name>"`. If user skips sync, run `npm run openspec -- archive "<name>" --skip-specs`.',
    );
  if (!out.includes('## Codex environment notes')) {
    const marker = '---\n\n';
    const idx = out.indexOf(marker);
    if (idx !== -1) out = out.slice(0, idx + marker.length) + CODEX_PREAMBLE + out.slice(idx + marker.length);
  }
  return out;
}

export function patchCursor(text) {
  return patchArchiveStep(patchCli(text)).replace(
    /If user chooses sync, use Task tool \(subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs for change '<name>'\. Delta spec analysis: <include the analyzed delta spec summary>"\)\. Proceed to archive regardless of choice\./,
    'If user chooses sync, merge delta specs into `openspec/specs/` following OpenSpec delta rules, then run `npm run openspec -- archive "<name>"`. If user skips sync, run `npm run openspec -- archive "<name>" --skip-specs`.',
  );
}

function rawOrPatchedState(text) {
  RAW_CLI.lastIndex = 0;
  BARE_CLI_COMMAND.lastIndex = 0;
  OLD_OPSX.lastIndex = 0;
  const raw = RAW_CLI.test(text) || BARE_CLI_COMMAND.test(text) ||
    OLD_OPSX.test(text) || text.includes('compatibility: Requires openspec CLI.');
  const patched = text.includes(CLI_PREFIX) || text.includes(PATCHED_COMPAT) || /\/opsx-(?:propose|apply|archive|explore|continue)\b/.test(text);
  return raw || patched;
}

export function buildPatchPlan(rootDir, io = fs) {
  const originals = new Map();
  const failures = [];
  for (const rel of targets) {
    const file = path.join(rootDir, rel);
    let text;
    try { text = io.readFileSync(file, 'utf8'); }
    catch (err) { failures.push(`${rel}: missing or unreadable (${err.code ?? 'read error'})`); continue; }
    originals.set(rel, text);
    if (!text.includes(EXPECTED_ANCHOR.get(rel))) failures.push(`${rel}: expected anchor missing`);
    if (CORRUPT.test(text)) failures.push(`${rel}: known corrupted command prefix`);
    if (!rawOrPatchedState(text)) failures.push(`${rel}: unknown upstream shape`);
  }
  if (failures.length) throw new Error(`OpenSpec patch preflight failed before writes:\n- ${failures.join('\n- ')}`);

  const planned = [];
  for (const rel of targets) {
    const original = originals.get(rel);
    const patched = rel.startsWith('.codex/') ? patchCodex(original) : patchCursor(original);
    RAW_CLI.lastIndex = 0;
    BARE_CLI_COMMAND.lastIndex = 0;
    OLD_OPSX.lastIndex = 0;
    const postFailures = [];
    if (!patched.includes(EXPECTED_ANCHOR.get(rel))) postFailures.push('expected anchor lost');
    if (!patched.includes(CLI_PREFIX)) postFailures.push('patched CLI anchor missing');
    if (RAW_CLI.test(patched)) postFailures.push('raw CLI command remains');
    if (BARE_CLI_COMMAND.test(patched)) postFailures.push('bare OpenSpec subcommand remains');
    if (OLD_OPSX.test(patched)) postFailures.push('old opsx command remains');
    if (CORRUPT.test(patched)) postFailures.push('corrupted command prefix remains');
    if (postFailures.length) failures.push(`${rel}: ${postFailures.join(', ')}`);
    planned.push({ rel, file: path.join(rootDir, rel), original, patched });
  }
  if (failures.length) throw new Error(`OpenSpec patch post-validation failed before writes:\n- ${failures.join('\n- ')}`);
  return planned;
}

export function runPatch(rootDir, io = fs) {
  const planned = buildPatchPlan(rootDir, io);
  for (const item of planned) {
    if (item.patched !== item.original) {
      io.writeFileSync(item.file, item.patched, 'utf8');
      console.log(`patched ${item.rel}`);
    } else {
      console.log(`unchanged ${item.rel}`);
    }
  }
  return planned;
}

function cliRoot(argv) {
  const i = argv.indexOf('--root');
  if (i >= 0) {
    if (!argv[i + 1]) throw new Error('--root requires a directory');
    return path.resolve(argv[i + 1]);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runPatch(cliRoot(process.argv.slice(2))); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
