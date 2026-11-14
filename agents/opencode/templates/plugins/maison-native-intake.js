import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const MaisonNativeIntake = async ({ directory }) => ({
  'shell.env': async (input, output) => {
    output.env.MAISON_OPENCODE_SESSION_ID = '';
    output.env.MAISON_OPENCODE_CALL_ID = '';
    if (input.sessionID && input.callID) {
      output.env.MAISON_OPENCODE_SESSION_ID = input.sessionID;
      output.env.MAISON_OPENCODE_CALL_ID = input.callID;
    }
  },
  'tool.execute.before': async (input, output) => {
    if (!['edit', 'write', 'apply_patch'].includes(input.tool)) return;
    // SQLite is read by Node, so loading this plugin does not couple Bun to Node's SQLite ABI.
    const run = spawnSync('node', [path.join(directory, 'framework/agents/opencode/guard-tool.cjs')], {
      cwd: directory, input: JSON.stringify({ projectRoot: directory, ...input, args: output.args }),
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    let result;
    try { result = JSON.parse(run.stdout); } catch { return; }
    if (result.decision === 'deny') throw new Error(result.reason);
  },
});
