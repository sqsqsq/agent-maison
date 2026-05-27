#!/usr/bin/env node
/**
 * One-time patch for OpenSpec-generated skills/commands in agent-maison.
 * Re-run after `openspec update` if upstream regenerates files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
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

const CLI_PREFIX = 'npm run openspec -- ';

function patchCli(text) {
  let out = text.replace(
    'compatibility: Requires openspec CLI.',
    'compatibility: Requires npm run openspec (pinned @fission-ai/openspec@1.3.1 in devDependencies).'
  );
  out = out.replace(
    'compatibility: Requires npm run openspec -- CLI.',
    'compatibility: Requires npm run openspec (pinned @fission-ai/openspec@1.3.1 in devDependencies).'
  );
  return out
    .replace(/(?<!npm run openspec -- )(?<!npm run openspec:validate)(?<![\w-])openspec /g, CLI_PREFIX)
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
    archiveBlock
  );
}

const CODEX_PREAMBLE = `## Codex environment notes

- Run OpenSpec from the repository root via \`npm run openspec -- <subcommand>\` (no global CLI required).
- Ask clarifying questions directly in chat; do not invoke AskUserQuestion, TodoWrite, or Task by tool name.
- Track progress with a short checklist in your reply.
- Prefer \`npm run openspec -- archive "<name>"\` for cross-platform archive + spec merge.

`;

function patchCodex(text) {
  let out = patchCli(text);
  out = patchArchiveStep(out);
  out = out
    .replace(/use the \*\*AskUserQuestion tool\*\* to let the user select/gi, 'ask the user directly in chat to select a change')
    .replace(/Use the \*\*AskUserQuestion tool\*\* \(open-ended, no preset options\) to ask:/g, 'Ask the user directly in chat:')
    .replace(/Use the \*\*AskUserQuestion tool\*\* to let the user select\./g, 'Ask the user directly in chat to select a change.')
    .replace(/Use \*\*AskUserQuestion tool\*\* to confirm user wants to proceed/g, 'Ask the user directly in chat to confirm before proceeding')
    .replace(/Use \*\*AskUserQuestion tool\*\* to clarify/g, 'Ask the user directly in chat to clarify')
    .replace(/Use the \*\*TodoWrite tool\*\* to track progress through the artifacts\./g, 'Track artifact progress with a short checklist in your reply.')
    .replace(
      /If user chooses sync, use Task tool \(subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs for change '<name>'\. Delta spec analysis: <include the analyzed delta spec summary>"\)\. Proceed to archive regardless of choice\./,
      'If user chooses sync, merge delta specs into `openspec/specs/` following OpenSpec delta rules, then run `npm run openspec -- archive "<name>"`. If user skips sync, run `npm run openspec -- archive "<name>" --skip-specs`.'
    );
  if (!out.includes('## Codex environment notes')) {
    const marker = '---\n\n';
    const idx = out.indexOf(marker);
    if (idx !== -1) {
      out = out.slice(0, idx + marker.length) + CODEX_PREAMBLE + out.slice(idx + marker.length);
    }
  }
  return out;
}

function patchCursor(text) {
  let out = patchCli(text);
  out = patchArchiveStep(out);
  out = out.replace(
    /If user chooses sync, use Task tool \(subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs for change '<name>'\. Delta spec analysis: <include the analyzed delta spec summary>"\)\. Proceed to archive regardless of choice\./,
    'If user chooses sync, merge delta specs into `openspec/specs/` following OpenSpec delta rules, then run `npm run openspec -- archive "<name>"`. If user skips sync, run `npm run openspec -- archive "<name>" --skip-specs`.'
  );
  return out;
}

for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.warn(`skip missing: ${rel}`);
    continue;
  }
  const original = fs.readFileSync(file, 'utf8');
  const patched = rel.startsWith('.codex/') ? patchCodex(original) : patchCursor(original);
  if (patched !== original) {
    fs.writeFileSync(file, patched);
    console.log(`patched ${rel}`);
  } else {
    console.log(`unchanged ${rel}`);
  }
}
