// ============================================================================
// check-personal-setup.ts — feature phase 前 personal setup 门控（exit 0/1）
// ============================================================================

import * as path from 'path';

import {
  ensurePersonalSetup,
  evaluatePersonalSetupGate,
  formatPersonalSetupGateStderr,
  resolveEnsurePrerequisites,
  type PersonalSetupEnsureJson,
} from './utils/personal-setup-gate';

export interface PersonalSetupCliOptions {
  projectRoot: string;
  json: boolean;
  ensure: boolean;
  /** 与 harness-runner 当前 phase 对齐时，--ensure 会纳入 deveco_toolchain 等 prerequisite */
  phase?: string;
  /** goal-mode：多 adapter 时确定性写入 active adapter */
  selectAdapter?: string;
}

function parseArgs(argv: string[]): PersonalSetupCliOptions {
  let projectRoot = process.cwd();
  let json = false;
  let ensure = false;
  let phase: string | undefined;
  let selectAdapter: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root' && argv[i + 1]) {
      projectRoot = path.resolve(argv[++i]);
    } else if (a === '--json') {
      json = true;
    } else if (a === '--ensure') {
      ensure = true;
    } else if (a === '--phase' && argv[i + 1]) {
      phase = String(argv[++i]).trim();
    } else if (a === '--select-adapter' && argv[i + 1]) {
      selectAdapter = String(argv[++i]).trim();
    }
  }
  return { projectRoot, json, ensure, phase, selectAdapter };
}

function emitJson(payload: PersonalSetupEnsureJson | ReturnType<typeof evaluatePersonalSetupGate>): void {
  console.log(JSON.stringify(payload, null, 2));
}

if (require.main === module) {
  const opts = parseArgs(process.argv);

  if (opts.ensure) {
    const prereqs = resolveEnsurePrerequisites(opts.projectRoot, opts.phase);
    const payload = ensurePersonalSetup(opts.projectRoot, {
      requiredPrerequisites: prereqs,
      selectAdapter: opts.selectAdapter,
    });
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
          `${payload.ensured ? ` ensured=${payload.ensured}` : ''}` +
          `${opts.phase ? ` phase=${opts.phase}` : ''}\n`,
      );
    }
    process.exit(0);
  }

  const gateOpts = opts.phase
    ? { requiredPrerequisites: resolveEnsurePrerequisites(opts.projectRoot, opts.phase) }
    : {};
  const result = evaluatePersonalSetupGate(opts.projectRoot, gateOpts);
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
      `personal setup ok: agent_adapter=${result.activeAdapter} source=${result.status.source}` +
        `${opts.phase ? ` phase=${opts.phase}` : ''}\n`,
    );
  }
  process.exit(0);
}

export {
  parseArgs as parsePersonalSetupArgs,
  evaluatePersonalSetupGate,
  ensurePersonalSetup,
  resolveEnsurePrerequisites,
};
