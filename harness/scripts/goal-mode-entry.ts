import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import * as readline from 'readline';
import minimist from 'minimist';
import type { InSessionRoundOptions, InSessionRoundResult } from './utils/goal-in-session-driver';
import { runInSessionRound } from './utils/goal-in-session-driver';
import { deriveReconcileObservation } from './utils/goal-reconcile-observation';
import { appendGoalEventFenced, readInSessionLoopState, writeInSessionLoopStateFenced } from './utils/goal-in-session-evidence';
import {
  assertFencedOwner,
  casAcquireRunOwner,
  ensureRunControl,
  forceTakeoverRunOwner,
  markExpiredSessionOrphaned,
  releaseRunOwner,
} from './utils/goal-run-control';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFromRun,
  resolveRequirementInput,
  writeGoalManifest,
  type GoalManifest,
} from './utils/goal-manifest';
import { resolveWorkflowSpec } from '../workflow-loader';
import { validateMinimumAssurance } from './utils/skill-contract';
import type { ReconcileObservationV1 } from './utils/assess';

export interface GoalModeInSessionOptions extends Omit<InSessionRoundOptions, 'round' | 'reconcile'> {
  maxRounds?: number;
  onRound?: (result: InSessionRoundResult) => void;
}

function releaseSessionBestEffort(options: GoalModeInSessionOptions): void {
  try {
    assertFencedOwner(options.runDir, options.token, 'session_entry_release');
    releaseRunOwner(options.runDir, options.token);
  } catch {
    // A phase exception may already have released the owner, or a newer epoch won.
  }
}

export function deriveInSessionFingerprint(result: InSessionRoundResult): string {
  const content = {
    assessment: result.assessment ? {
      gaps: result.assessment.gaps,
      recommendation: result.assessment.recommendation,
      stop: result.assessment.stop,
      run_status_candidate: result.assessment.run_status_candidate,
    } : null,
    outcome: result.outcome ? {
      status: result.outcome.status,
      phase: result.outcome.phase,
      details: result.outcome.details ?? null,
    } : null,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function fusedResult(
  options: GoalModeInSessionOptions,
  last: InSessionRoundResult,
  reason: string,
): InSessionRoundResult {
  try {
    appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
      type: 'phase_halt',
      phase: last.outcome?.phase ?? last.assessment?.recommendation.phase ?? null,
      halt_reason: 'in_session_reconcile_fused',
      details: reason,
      driver: 'session',
    });
  } finally {
    releaseSessionBestEffort(options);
  }
  return {
    ...last,
    status: 'fused',
    waiting_item: reason,
    status_line: `${last.status_line} | 等待=${reason}`,
  };
}

/**
 * Production entry used by the goal-mode skill/host bridge for attended runs.
 * It owns assess → authorize → execute one phase → reassess, supplies the same
 * retry/fingerprint fuse facts as the detached runner, and releases session
 * ownership on every terminal return.
 */
export async function runGoalModeInSession(
  options: GoalModeInSessionOptions,
): Promise<InSessionRoundResult> {
  const configuredRounds = Math.max(1, Math.trunc(options.maxRounds ?? 50));
  const maxTurns = Math.max(1, Math.min(configuredRounds, options.manifest.budget.max_total_turns));
  const persisted = readInSessionLoopState(options.runDir);
  const state = persisted ?? {
    schema_version: '1.0' as const,
    started_at_ms: Date.now(),
    total_rounds: 0,
    retries_by_phase: {},
    last_fingerprint: null,
    repeated_count: 0,
    last_phase: null,
    last_status: null,
    last_details: null,
    fuse_reason: null,
    reconcile: null,
  };
  // 会话内预算只累计当前宿主桥接调用中的活跃段；桥接返回后的离线等待不计时。
  let activeElapsedMs = Math.max(0, state.active_elapsed_ms ?? 0);
  let activeSegmentStartedAtMs = Date.now();
  const wallClockMs = Math.max(1, options.manifest.budget.wall_clock_minutes) * 60_000;
  const activeElapsedNow = (): number =>
    activeElapsedMs + Math.max(0, Date.now() - activeSegmentStartedAtMs);
  const settleActiveTime = (): void => {
    const now = Date.now();
    activeElapsedMs += Math.max(0, now - activeSegmentStartedAtMs);
    activeSegmentStartedAtMs = now;
    state.active_elapsed_ms = activeElapsedMs;
  };
  const retriesByPhase = new Map(Object.entries(state.retries_by_phase));
  let lastFingerprint: string | null = state.last_fingerprint;
  let repeatedCount = state.repeated_count;
  let reconcile: ReconcileObservationV1 | undefined = state.reconcile as ReconcileObservationV1 | null ?? undefined;
  let last: InSessionRoundResult | null = null;
  if (state.fuse_reason || state.total_rounds >= maxTurns || activeElapsedNow() >= wallClockMs) {
    const synthetic: InSessionRoundResult = {
      status: 'executed', assessment: null,
      outcome: state.last_phase ? {
        status: state.last_status === 'passed' ? 'passed' : 'failed',
        phase: state.last_phase, details: state.last_details ?? undefined,
      } : undefined,
      status_line: '会话账本已记录终止预算',
    };
    return fusedResult(options, synthetic,
      state.fuse_reason ?? (activeElapsedNow() >= wallClockMs ? '会话内 wall-clock 预算已耗尽' : '达到会话内执行预算 ' + maxTurns + ' 轮，等待人工复核'));
  }

  for (let round = state.total_rounds + 1; round <= maxTurns; round += 1) {
    if (activeElapsedNow() >= wallClockMs && last) {
      state.fuse_reason = '会话内 wall-clock 预算已耗尽';
      writeInSessionLoopStateFenced(options.runDir, options.token, state);
      return fusedResult(options, last, state.fuse_reason);
    }
    const result = await runInSessionRound({ ...options, round, reconcile });
    options.onRound?.(result);
    last = result;
    if (result.status !== 'executed') {
      settleActiveTime();
      writeInSessionLoopStateFenced(options.runDir, options.token, state);
      releaseSessionBestEffort(options);
      return result;
    }

    const phase = result.outcome?.phase ?? result.assessment?.recommendation.phase ?? '';
    const fingerprint = deriveInSessionFingerprint(result);
    repeatedCount = fingerprint && fingerprint === lastFingerprint ? repeatedCount + 1 : 0;
    lastFingerprint = fingerprint || null;
    const failed = result.outcome?.status === 'failed';
    const retriesUsed = failed ? (retriesByPhase.get(phase) ?? 0) + 1 : 0;
    if (failed) retriesByPhase.set(phase, retriesUsed);
    else retriesByPhase.delete(phase);
    const exhausted = failed && retriesUsed >= options.manifest.budget.max_retries_per_phase;
    const noProgress = repeatedCount >= options.manifest.budget.max_retries_per_phase;
    const reason = exhausted
      ? `phase ${phase} retry budget exhausted`
      : noProgress
        ? `phase ${phase} repeated fingerprint without progress`
        : undefined;
    reconcile = deriveReconcileObservation({
      phase,
      verdict: result.outcome?.status === 'passed' ? 'PASS' : failed ? 'FAIL' : 'INCOMPLETE',
      legacyAction: result.outcome?.status === 'passed' ? 'advance' : failed ? 'retry' : 'halt',
      retriesUsed,
      maxRetriesPerPhase: options.manifest.budget.max_retries_per_phase,
      backtracksUsed: 0,
      repeatedCount,
      residualFingerprints: fingerprint ? [fingerprint] : [],
      fused: exhausted || noProgress,
      fuseReason: reason,
    });
    state.total_rounds = round;
    state.retries_by_phase = Object.fromEntries(retriesByPhase);
    state.last_fingerprint = lastFingerprint;
    state.repeated_count = repeatedCount;
    state.last_phase = phase || null;
    state.last_status = result.outcome?.status ?? null;
    state.last_details = result.outcome?.details ?? null;
    state.reconcile = reconcile ?? null;
    state.fuse_reason = reason ?? null;
    writeInSessionLoopStateFenced(options.runDir, options.token, state);
    if (reason) return fusedResult(options, result, reason);
  }

  if (!last) throw new Error('[goal-mode-entry] no reconciliation round executed');
  state.fuse_reason = '达到会话内执行预算 ' + maxTurns + ' 轮，等待人工复核';
  writeInSessionLoopStateFenced(options.runDir, options.token, state);
  return fusedResult(options, last, state.fuse_reason);
}
export interface PrepareGoalModeRunOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId?: string;
  adapter: string;
  requirement: string;
  startPhase?: string;
  endPhase?: string;
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
      adapter,
      adapter_provenance: 'entry_declared',
      start_phase: options.startPhase ?? 'spec',
      end_phase: options.endPhase ?? 'testing',
      // plan a8e5c3f9 t6：headless 即全权限——新 manifest 直接写 effective 值
      //（此前 workspace-write + on-request 让 claude 连 dontAsk 都拿不到，与无人值守自相矛盾）。
      unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 30 },
    },
    { projectRoot: options.projectRoot },
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
  writeGoalManifest(manifest, options.projectRoot);
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
  executePhase: InSessionRoundOptions['executePhase'];
  authorization?: InSessionRoundOptions['authorization'];
  leaseMs?: number;
  maxRounds?: number;
  forceTakeover?: boolean;
  onRound?: (result: InSessionRoundResult) => void;
}

/**
 * Host-facing production bridge: resolves the persisted run, acquires a fenced
 * session epoch, and invokes the canonical in-session loop. Hosts provide only
 * the adapter's isolated phase callback; they never construct tokens or loops.
 */
export async function runGoalModeHostBridge(
  options: GoalModeHostBridgeOptions,
): Promise<InSessionRoundResult> {
  const manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, {
    feature: options.feature,
  });
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
      adapter: options.adapter,
      mode: 'attended',
      authorization: options.authorization ?? { mode: 'goal_mode' },
      executePhase: options.executePhase,
      leaseMs: options.leaseMs,
      maxRounds: options.maxRounds,
      onRound: options.onRound,
    });
  } finally {
    releaseSessionBestEffort({
      projectRoot: options.projectRoot,
      frameworkRoot: options.frameworkRoot,
      runDir,
      token: acquired.token,
      manifest,
      workflow,
      adapter: options.adapter,
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
      'authorization-mode', 'through-phase',
      // f9c2e6b4 t4：与 goal-runner 同名同义，共用同一读取函数（相对路径按 projectRoot 解析）
      'requirement-file',
    ],
    boolean: ['force-takeover', 'prepare-run', 'help'],
  });
  if (argv.help) {
    console.log(
      'Usage: goal-mode-entry.ts --feature <f> --run-id <id> --adapter <name> ' +
      '[--project-root <root>] [--framework-root <framework>] [--force-takeover]\n' +
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
  const projectRoot = path.resolve(String(argv['project-root'] ?? process.cwd()));
  const frameworkRoot = path.resolve(String(argv['framework-root'] ?? path.resolve(__dirname, '..')));
  if (Boolean(argv['prepare-run'])) {
    const prepared = prepareGoalModeRun({
      projectRoot,
      frameworkRoot,
      feature,
      runId: runId || undefined,
      adapter,
      // f9c2e6b4 t4：两个启动入口**共用** resolveRequirementInput——互斥判定、相对路径
      // 口径、空文件处置只有一份实现，不写两遍（codex 开工原则②）。
      requirement:
        resolveRequirementInput({
          requirement: argv.requirement,
          requirementFile: argv['requirement-file'],
          projectRoot,
        }) ?? '',
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
      forceTakeover: Boolean(argv['force-takeover']),
      authorization: {
        mode: mode as 'manual' | 'batch_authorized' | 'goal_mode',
        ...(argv['through-phase'] ? { through_phase: String(argv['through-phase']) } : {}),
      },
      onRound: (round) => console.error(round.status_line),
      executePhase: async (phase, recommendation) => {
        console.log(JSON.stringify({ type: 'phase_execute_request', phase, recommendation }));
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