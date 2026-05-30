// ============================================================================
// check-personal-setup.ts — feature phase 前 personal setup 门控（exit 0/1）
// ============================================================================

import * as path from 'path';

import {
  evaluatePersonalSetupGate,
  formatPersonalSetupGateStderr,
} from './utils/personal-setup-gate';

function parseArgs(argv: string[]): { projectRoot: string; json: boolean } {
  let projectRoot = process.cwd();
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root' && argv[i + 1]) {
      projectRoot = path.resolve(argv[++i]);
    } else if (a === '--json') {
      json = true;
    }
  }
  return { projectRoot, json };
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  const result = evaluatePersonalSetupGate(opts.projectRoot);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (!result.ok) {
    process.stderr.write(formatPersonalSetupGateStderr(result));
    process.exit(1);
  }
  if (!opts.json) {
    process.stdout.write(
      `personal setup ok: agent_adapter=${result.activeAdapter} source=${result.status.source}\n`,
    );
  }
  process.exit(0);
}

export { parseArgs as parsePersonalSetupArgs, evaluatePersonalSetupGate };
