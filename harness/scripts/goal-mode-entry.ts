import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import minimist from 'minimist';
import type {
  InSessionPhaseRequestContext,
  InSessionRoundOptions,
  InSessionRoundResult,
  GoalModeInSessionOptions,
} from './utils/goal-phase-runtime';
import {
  deriveInSessionFingerprint,
  releaseAttendedRuntimeOwnerBestEffort,
  runAttendedGoalPhaseRuntime,
} from './utils/goal-phase-runtime';
import {
  casAcquireRunOwner,
  ensureRunControl,
  forceTakeoverRunOwner,
  markExpiredSessionOrphaned,
} from './utils/goal-run-control';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFromRun,
  resolveRequirementInput,
  RUN_ADAPTER_PROVENANCES,
  type GoalManifest,
  type RunAdapterProvenance,
} from './utils/goal-manifest';
import { assertGoalRunAttachable, createGoalRun } from './utils/goal-run-creation';
import { loadLocalConfig } from './utils/framework-local-config';
import {
  resolveUnattendedVisualProviderPin,
} from './utils/visual-provider-identity';
import { resolveWorkflowSpec } from '../workflow-loader';
import { relFeaturesDir } from '../config';
import { resolveAutoChain } from './utils/phase-transition-policy';
import { loadFeatureTrackDecl } from './utils/feature-track';
import { resolveFeatureTrack } from './utils/runtime-policy';
import { validateMinimumAssurance } from './utils/skill-contract';
export type { GoalModeInSessionOptions } from './utils/goal-phase-runtime';
export { deriveInSessionFingerprint } from './utils/goal-phase-runtime';

/** Host bridge: lifecycle progression is owned by GoalPhaseRuntime. */
export async function runGoalModeInSession(
  options: GoalModeInSessionOptions,
): Promise<InSessionRoundResult> {
  return runAttendedGoalPhaseRuntime(options);
}
export interface PrepareGoalModeRunOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId?: string;
  adapter: string;
  adapterSource?: RunAdapterProvenance;
  requirement: string;
  /** plan c4e8a1f7 T2：--requirement-file 来源列表（goal-mode-entry 与 goal-runner 同源解析） */
  requirementSourceFiles?: string[];
  startPhase?: string;
  endPhase?: string;
}

/** harness/scripts → framework root；standalone 与 consumer 的目录层级一致。 */
export function defaultGoalModeFrameworkRoot(scriptDir = __dirname): string {
  return path.resolve(scriptDir, '..', '..');
}

/** Create the persisted manifest/control skeleton for a fresh attended run. */
export function prepareGoalModeRun(options: PrepareGoalModeRunOptions): {
  manifest: GoalManifest;
  manifestPath: string;
  runDir: string;
} {
  const feature = options.feature.trim();
  const adapter = options.adapter.trim();
  const requirement = options.requirement.trim();
  if (!feature || !adapter || !requirement) {
    throw new Error('--prepare-run requires --feature, --adapter, and --requirement');
  }
  const workflow = resolveWorkflowSpec(options.projectRoot, { frameworkRoot: options.frameworkRoot });
  const manifest = buildGoalManifestFromInput(
    {
      feature,
      run_id: options.runId,
      requirement,
      ...(options.requirementSourceFiles && options.requirementSourceFiles.length > 0
        ? { requirement_source_files: options.requirementSourceFiles }
        : {}),
      adapter,
      ...(options.adapterSource ? { adapter_provenance: options.adapterSource } : {}),
      start_phase: options.startPhase ?? 'spec',
      end_phase: options.endPhase ?? 'testing',
      // plan a8e5c3f9 t6：headless 即全权限——新 manifest 直接写 effective 值
      //（此前 workspace-write + on-request 让 claude 连 dontAsk 都拿不到，与无人值守自相矛盾）。
      unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 30 },
      // plan ab072691 t1③(b)：attended goal 在**创建 manifest 前**冻结只读视觉 provider。
      // 询问/重选发生在宿主会话里（registry setup.visual_provider → init-orchestrate
      // record-visual-provider 机器写盘）；这里只读 local 的既成结果并冻结进 manifest。
      // local 缺失或旧配置失去资格时不伪造 provider；严格需求与能力不足的冲突由
      // fidelity/capability 门禁裁决，optional 视觉轴保持 advisory。
      ...(() => {
        let local: ReturnType<typeof loadLocalConfig> = null;
        try {
          local = loadLocalConfig(options.projectRoot);
        } catch (error) {
          console.warn(
            `[visual-provider] WARN: 读取个人级视觉 provider 配置失败，按无 provider 处理：` +
              `${(error as Error).message}。严格视觉需求将由 capability 门禁诚实 defer。`,
          );
        }
        const resolved = resolveUnattendedVisualProviderPin(local, options.frameworkRoot);
        if (resolved.warning) console.warn(resolved.warning);
        return resolved.pin ? { visual_provider_pin: resolved.pin } : {};
      })(),
    },
    { projectRoot: options.projectRoot, featuresDir: relFeaturesDir(options.projectRoot) },
  );
  validateMinimumAssurance(
    options.frameworkRoot,
    manifest.minimum_assurance,
    new Set(workflow.artifacts.filter((item) => item.scope === 'feature').map((item) => item.id)),
  );
  const manifestPath = path.resolve(options.projectRoot, manifest.report_dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-mode-entry] run manifest already exists: ${manifestPath}`);
  }
  const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, feature));
  const chain = resolveAutoChain(
    workflow,
    manifest.start_phase,
    manifest.end_phase,
    manifest.chain_override,
    track,
  );
  createGoalRun({ projectRoot: options.projectRoot, manifest, chain });
  const runDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
  ensureRunControl(runDir, manifest.run_id);
  return { manifest, manifestPath, runDir };
}

export interface GoalModeHostBridgeOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId: string;
  adapter: string;
  runMode?: string;
  executePhase: InSessionRoundOptions['executePhase'];
  authorization?: InSessionRoundOptions['authorization'];
  leaseMs?: number;
  maxRounds?: number;
  forceTakeover?: boolean;
  onRound?: (result: InSessionRoundResult) => void;
}

export function assertAttendedRunMode(runMode: string | undefined): void {
  if (runMode?.trim() !== 'attended') {
    throw new Error('[goal-mode-entry] attended attach requires --run-mode attended');
  }
}

export function buildPhaseExecuteRequest(
  context: InSessionPhaseRequestContext,
  recommendation: unknown,
): {
  type: 'phase_execute_request'; run_id: string; phase: string; attempt_id: string;
  owner_id: string; owner_epoch: number; recommendation: unknown;
} {
  return {
    type: 'phase_execute_request',
    run_id: context.runId,
    phase: context.phase,
    attempt_id: context.attemptId,
    owner_id: context.ownerId,
    owner_epoch: context.ownerEpoch,
    recommendation,
  };
}

/**
 * Host-facing production bridge: resolves the persisted run, acquires a fenced
 * session epoch, and invokes the canonical in-session loop. Hosts provide only
 * the adapter's isolated phase callback; they never construct tokens or loops.
 */
export async function runGoalModeHostBridge(
  options: GoalModeHostBridgeOptions,
): Promise<InSessionRoundResult> {
  // Caller declaration is only a startup assertion. It is deliberately not persisted as mode state.
  assertAttendedRunMode(options.runMode);
  const manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, {
    feature: options.feature,
    featuresDir: relFeaturesDir(options.projectRoot),
  });
  // 出生契约必须在 owner CAS 前成立；attach 永不补造 run_created。
  assertGoalRunAttachable(options.projectRoot, manifest);
  const callerAdapter = options.adapter.trim();
  if (!callerAdapter || callerAdapter !== manifest.adapter) {
    throw new Error(
      `[goal-mode-entry] attach adapter mismatch: caller=${callerAdapter || '<empty>'}, manifest=${manifest.adapter}`,
    );
  }
  const adapter = manifest.adapter;
  const workflow = resolveWorkflowSpec(options.projectRoot, {
    frameworkRoot: options.frameworkRoot,
  });
  validateMinimumAssurance(
    options.frameworkRoot,
    manifest.minimum_assurance,
    new Set(workflow.artifacts.filter((item) => item.scope === 'feature').map((item) => item.id)),
  );
  const runDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
  let control = ensureRunControl(runDir, manifest.run_id);
  control = markExpiredSessionOrphaned(runDir, manifest.run_id);
  const owner = {
    kind: 'session' as const,
    owner_id: `host-session-${process.pid}-${Date.now()}`,
    lease_ms: options.leaseMs ?? 60_000,
  };
  const acquired = options.forceTakeover && control.owner?.state === 'orphaned_session'
    ? { ok: true as const, ...forceTakeoverRunOwner(
        runDir, manifest.run_id, control.current_epoch, owner,
      ) }
    : casAcquireRunOwner(runDir, manifest.run_id, control.current_epoch, owner);
  if (!acquired.ok) {
    throw new Error(
      `[goal-mode-entry] run-control owner busy/orphaned at epoch ${acquired.control.current_epoch}; ` +
      'expired session takeover requires explicit forceTakeover',
    );
  }
  try {
    return await runGoalModeInSession({
      projectRoot: options.projectRoot,
      frameworkRoot: options.frameworkRoot,
      runDir,
      token: acquired.token,
      manifest,
      workflow,
      adapter,
      mode: 'attended',
      authorization: options.authorization ?? { mode: 'goal_mode' },
      executePhase: options.executePhase,
      leaseMs: options.leaseMs,
      maxRounds: options.maxRounds,
      onRound: options.onRound,
    });
  } finally {
    releaseAttendedRuntimeOwnerBestEffort({
      projectRoot: options.projectRoot,
      frameworkRoot: options.frameworkRoot,
      runDir,
      token: acquired.token,
      manifest,
      workflow,
      adapter,
      mode: 'attended',
      authorization: options.authorization ?? { mode: 'goal_mode' },
      executePhase: options.executePhase,
      leaseMs: options.leaseMs,
      maxRounds: options.maxRounds,
      onRound: options.onRound,
    });
  }
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: [
      'project-root', 'framework-root', 'feature', 'run-id', 'adapter', 'requirement', 'start', 'end',
      'authorization-mode', 'through-phase', 'run-mode', 'adapter-source',
      // f9c2e6b4 t4：与 goal-runner 同名同义，共用同一读取函数（相对路径按 projectRoot 解析）
      'requirement-file',
    ],
    boolean: ['force-takeover', 'prepare-run', 'help'],
  });
  if (argv.help) {
    console.log(
      'Usage: goal-mode-entry.ts --feature <f> --run-id <id> --adapter <name> ' +
      '--run-mode attended [--project-root <root>] [--framework-root <framework>] [--force-takeover]\n' +
      'Fresh attended run: add --prepare-run --requirement "<text>" (optionally --run-id/--start/--end).\n' +
      'Long / multi-line requirement: use --requirement-file <path> (mutually exclusive with --requirement).\n' +
      'Protocol: stdout emits one JSON phase_execute_request per round; stdin supplies ' +
      'one JSON {status:"passed|failed|waiting",phase,details?} response.',
    );
    return;
  }
  const feature = String(argv.feature ?? '').trim();
  const runId = String(argv['run-id'] ?? '').trim();
  const adapter = String(argv.adapter ?? '').trim();
  const runMode = String(argv['run-mode'] ?? '').trim();
  assertAttendedRunMode(runMode || undefined);
  const prepareRun = Boolean(argv['prepare-run']);
  const adapterSourceRaw = String(argv['adapter-source'] ?? '').trim();
  const adapterSources = new Set<string>(RUN_ADAPTER_PROVENANCES);
  if (adapterSourceRaw && !adapterSources.has(adapterSourceRaw)) {
    throw new Error(`--adapter-source 非法：${adapterSourceRaw}`);
  }
  const projectRoot = path.resolve(String(argv['project-root'] ?? process.cwd()));
  const frameworkRoot = path.resolve(String(argv['framework-root'] ?? defaultGoalModeFrameworkRoot()));
  if (prepareRun) {
    const prepared = prepareGoalModeRun({
      projectRoot,
      frameworkRoot,
      feature,
      runId: runId || undefined,
      adapter,
      ...(adapterSourceRaw
        ? { adapterSource: adapterSourceRaw as RunAdapterProvenance }
        : {}),
      // f9c2e6b4 t4：两个启动入口**共用** resolveRequirementInput——互斥判定、相对路径
      // 口径、空文件处置只有一份实现，不写两遍（codex 开工原则②）。
      // plan c4e8a1f7 T2：来源列表一并透传（frozen requirement 的 provenance）。
      ...(() => {
        const resolved = resolveRequirementInput({
          requirement: argv.requirement,
          requirementFile: argv['requirement-file'],
          projectRoot,
        });
        return {
          requirement: resolved.text ?? '',
          ...(resolved.sources.length > 0 ? { requirementSourceFiles: resolved.sources } : {}),
        };
      })(),
      startPhase: String(argv.start ?? 'spec'),
      endPhase: String(argv.end ?? 'testing'),
    });
    console.log(JSON.stringify({
      type: 'goal_run_prepared',
      run_id: prepared.manifest.run_id,
      manifest: prepared.manifestPath,
      run_dir: prepared.runDir,
      next: 'rerun without --prepare-run to attach the attended host bridge',
    }));
    return;
  }
  if (!feature || !runId || !adapter) {
    throw new Error('--feature, --run-id, and --adapter are required');
  }
  const mode = String(argv['authorization-mode'] ?? 'goal_mode');
  if (!['manual', 'batch_authorized', 'goal_mode'].includes(mode)) {
    throw new Error(`authorization mode 非法：${mode}`);
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  try {
    const result = await runGoalModeHostBridge({
      projectRoot,
      frameworkRoot,
      feature,
      runId,
      adapter,
      runMode,
      forceTakeover: Boolean(argv['force-takeover']),
      authorization: {
        mode: mode as 'manual' | 'batch_authorized' | 'goal_mode',
        ...(argv['through-phase'] ? { through_phase: String(argv['through-phase']) } : {}),
      },
      onRound: (round) => console.error(round.status_line),
      executePhase: async (phase, recommendation, context) => {
        console.log(JSON.stringify(buildPhaseExecuteRequest(context, recommendation)));
        const next = await lines.next();
        if (next.done) throw new Error('phase executor protocol EOF');
        const response = JSON.parse(next.value) as {
          status?: string; phase?: string; details?: string;
        };
        if (!['passed', 'failed', 'waiting'].includes(response.status ?? '')) {
          throw new Error('phase executor response.status 非法');
        }
        if (response.phase && response.phase !== phase) {
          throw new Error(`phase executor response phase mismatch: ${response.phase} != ${phase}`);
        }
        return {
          status: response.status as 'passed' | 'failed' | 'waiting',
          phase,
          details: response.details,
        };
      },
    });
    console.log(JSON.stringify({ type: 'goal_session_result', result }));
  } finally {
    input.close();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(`[goal-mode-entry] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
