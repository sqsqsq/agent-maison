// ============================================================================
// check-personal-setup.ts — feature phase 前 personal setup 门控（exit 0/1）
// ============================================================================

import * as path from 'path';

import {
  ensurePersonalSetup,
  evaluatePersonalSetupGate,
  formatPersonalSetupGateStderr,
  type PersonalSetupEnsureJson,
} from './utils/personal-setup-gate';

export interface PersonalSetupCliOptions {
  projectRoot: string;
  json: boolean;
  ensure: boolean;
}

function parseArgs(argv: string[]): PersonalSetupCliOptions {
  let projectRoot = process.cwd();
  let json = false;
  let ensure = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root' && argv[i + 1]) {
      projectRoot = path.resolve(argv[++i]);
    } else if (a === '--json') {
      json = true;
    } else if (a === '--ensure') {
      ensure = true;
    }
  }
  return { projectRoot, json, ensure };
}

function emitJson(payload: PersonalSetupEnsureJson | ReturnType<typeof evaluatePersonalSetupGate>): void {
  console.log(JSON.stringify(payload, null, 2));
}

if (require.main === module) {
  const opts = parseArgs(process.argv);

  if (opts.ensure) {
    const payload = ensurePersonalSetup(opts.projectRoot);
    if (opts.json) {
      emitJson(payload);
    }
    if (!payload.ok) {
      if (!opts.json) {
        process.stderr.write(`[check-personal-setup] ${payload.message}\n`);
      }
      process.exit(1);
    }
    if (!opts.json) {
      process.stdout.write(
        `personal setup ok: agent_adapter=${payload.activeAdapter}` +
          `${payload.ensured ? ` ensured=${payload.ensured}` : ''}\n`,
      );
    }
    process.exit(0);
  }

  const result = evaluatePersonalSetupGate(opts.projectRoot);
  if (opts.json) {
    if (result.ok) {
      emitJson({
        ok: true,
        code: 'ok',
        status: result.status,
        activeAdapter: result.activeAdapter,
        materializedAdapters: result.materializedAdapters,
        ensured: null,
        candidates: [],
        message: 'personal setup 已就绪',
      });
    } else {
      emitJson({
        ok: false,
        code: result.code,
        status: result.status,
        activeAdapter: result.activeAdapter,
        materializedAdapters: result.materializedAdapters,
        ensured: null,
        candidates: [],
        message: result.message,
      });
    }
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

export {
  parseArgs as parsePersonalSetupArgs,
  evaluatePersonalSetupGate,
  ensurePersonalSetup,
};
