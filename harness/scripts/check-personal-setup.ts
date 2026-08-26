// ============================================================================
// check-personal-setup.ts — feature phase 前 personal setup 门控（exit 0/1）
// ============================================================================

import * as path from 'path';

import { detectRepoLayout } from '../repo-layout';
import { listVisualProviderAdapterNames } from './utils/adapter-catalog';
import { loadLocalConfig } from './utils/framework-local-config';
import {
  formatVisualProviderPrompt,
  resolveVisualProviderFromLocal,
  shouldPromptForVisualProvider,
} from './utils/visual-provider-identity';
import {
  ensurePersonalSetup,
  evaluatePersonalSetupGate,
  formatPersonalSetupGateStderr,
  resolveEnsurePrerequisites,
  runEnsureHumanReprobe,
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

/**
 * plan ab072691 t1③（返修）：只读视觉 provider 的**机器可读入口**。
 *
 * 纯 advisory：**永不**影响 `ok` / `code`——provider 从来不是 personal setup 的前置条件，
 * 跳过只意味着本轮 blind。它存在的意义是让「supported 不问、缺失/unsupported 问一次」
 * 成为确定性判定，而不是只靠文档提醒 agent。
 *
 * 字段：
 *  · `shouldPrompt` —— 是否该在本轮 UI 相关阶段问一次（local 缺失 或 现有 adapter 已失格）；
 *  · `state`        —— absent | ok | unsupported；
 *  · `supported[]`  —— catalog 现算的支持项（**唯一**支持列表来源，勿在别处枚举）；
 *  · `prompt`       —— shouldPrompt 时的现成提示语（含重选/跳过两条出路）。
 */
export function buildVisualProviderAdvisory(projectRoot: string): Record<string, unknown> {
  try {
    const frameworkRoot = detectRepoLayout(__dirname).frameworkRoot;
    const state = resolveVisualProviderFromLocal(loadLocalConfig(projectRoot), frameworkRoot);
    const shouldPrompt = shouldPromptForVisualProvider(state);
    return {
      state: state.kind,
      shouldPrompt,
      supported: listVisualProviderAdapterNames(frameworkRoot),
      ...(state.kind !== 'absent' ? { configured: state.ref } : {}),
      ...(shouldPrompt ? { prompt: formatVisualProviderPrompt(state, frameworkRoot) } : {}),
      decisionClass: 'setup.visual_provider',
      task: 'record-visual-provider',
    };
  } catch (e) {
    // advisory 出错不得影响门控结论——如实记一行原因即可。
    return { state: 'unavailable', shouldPrompt: false, reason: (e as Error).message };
  }
}

function emitJson(
  payload: PersonalSetupEnsureJson | ReturnType<typeof evaluatePersonalSetupGate>,
  projectRoot: string,
): void {
  console.log(JSON.stringify({ ...payload, visualProvider: buildVisualProviderAdvisory(projectRoot) }, null, 2));
}

if (require.main === module) {
  const opts = parseArgs(process.argv);

  if (opts.ensure) {
    const prereqs = resolveEnsurePrerequisites(opts.projectRoot, opts.phase);
    const payload = ensurePersonalSetup(opts.projectRoot, {
      requiredPrerequisites: prereqs,
      selectAdapter: opts.selectAdapter,
    });
    // v4 人工 reprobe（仅 --ensure CLI 层；preflight 消费的 ensurePersonalSetup 无权触达）：
    // 刷新 binary/cli_starts，且 cli 真实可启动时把 capability_failed 降级重置回 unknown。
    if (prereqs.has('deveco_toolchain')) {
      const reprobe = runEnsureHumanReprobe(opts.projectRoot);
      if (reprobe.reset) {
        process.stderr.write(
          '[check-personal-setup] 人工 reprobe：capability_failed 已重置为 unknown——' +
            '下一次真实编译定谳（resume/重跑即可）。\n',
        );
      }
    }
    if (opts.json) {
      emitJson(payload, opts.projectRoot);
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
      }, opts.projectRoot);
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
      }, opts.projectRoot);
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
