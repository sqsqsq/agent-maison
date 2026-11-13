// Codex native PreToolUse shell. Published under <project>/framework/agents/codex/hooks/.
// Only patch targets are adapted here; all protection/entry/author rules remain shared.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { evaluateFrameworkWrite, evaluateProjectEntry } from '../../shared/guard-framework-write-core.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: reason } }) + '\n');
}
function main() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (payload.hook_event_name !== 'PreToolUse' || payload.tool_name !== 'apply_patch') return;
  const patch = payload.tool_input?.command;
  if (typeof patch !== 'string') return;
  const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd : projectRoot;
  const targets = [...new Set([...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)]
    .map(match => path.resolve(cwd, match[1].trim())))];
  // Check every framework target first, including a move destination and later files in a patch.
  for (const filePath of targets) {
    const result = evaluateFrameworkWrite({ projectRoot, filePath });
    if (result.decision === 'deny') { deny(result.reason); return; }
  }
  const context = new Set();
  for (const filePath of targets) {
    const result = evaluateProjectEntry({ projectRoot, filePath, payload });
    if (result.decision === 'deny') { deny(result.reason); return; }
    if (result.sessionRef) context.add(`Maison原生来源：--session-ref ${JSON.stringify(result.sessionRef)}`);
    if (result.note) context.add(result.note);
  }
  if (context.size) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', additionalContext: [...context].join('\n'),
  } }) + '\n');
  // No permissionDecision: allow. Exit 0 leaves original client permissions in control.
}
try { main(); } catch { /* Invalid input/unavailable native record follows the shared cooperative fail-open boundary. */ }
