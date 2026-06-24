#!/usr/bin/env ts-node
// ============================================================================
// Goal runner — tool-agnostic deterministic multi-phase orchestrator
// ============================================================================
// Usage (from repo root or instance root):
//   cd framework/harness && npx ts-node scripts/goal-runner.ts \
//     --feature <f> --requirement "..." --adapter claude \
//     [--start spec] [--end testing] [--dry-run] [--resume <run-id> --feature <f>]
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import minimist from 'minimist';
import {
  loadFrameworkConfig,
  loadFrameworkConfigWithSources,
  featurePhaseReportsDir,
} from '../config';
import { detectRepoLayout } from '../repo-layout';
import { loadResolvedProfile } from '../profile-loader';
import { resolveWorkflowSpec } from '../workflow-loader';
import {
  classifyPhaseVerdict,
  formatDeferredUpstreamNotice,
  resolveAutoChain,
  resolveGoalRunStatus,
  type FeaturePhase,
  type HarnessVerdict,
} from './utils/phase-transition-policy';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFile,
  loadGoalManifestFromRun,
  newRunId,
  writeGoalManifest,
  type GoalManifest,
} from './utils/goal-manifest';
import {
  generateGoalReportJson,
  loadGoalReportJson,
  writeGoalReport,
  type GoalPhaseOutcome,
} from './utils/goal-report-generator';
import {
  invokeAgentHeadless,
  createChildSettleWaiter,
  killProcessTree,
  resolveHeadlessInvokePlan,
  type InvokeTemplateVars,
} from './utils/agent-invoke';
import {
  buildHalfPhaseRecoveryEvents,
  checkRunBudget,
  checkTerminalResumeGuard,
  countAgentInvokeStarts,
  detectHalfCompletedPhaseRecovery,
  findLastRunEnd,
  getSummaryMtime,
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  resolveResumeFromEvents,
  resolveResumeState,
  resolveWallClockStartMs,
} from './utils/goal-runner-phase';
import { isGoalHeadlessEnv, MAISON_GOAL_RUNNER_ENV, MAISON_GOAL_ALLOWED_TOOLS_ENV } from './utils/phase-state';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
} from './utils/goal-preflight';
import {
  FEATURE_LOCK_NAME,
  RUN_LOCK_NAME,
  formatLockBlocker,
  isLockStale,
  isPidAlive,
  readLockRecord,
  releaseLock,
  touchLock,
  tryAcquireLock,
  type LockRecord,
} from './utils/goal-run-lock';
import { snapshotPhaseHarness } from './utils/goal-phase-snapshot';
import {
  applyManifestCliOverrides,
  validateManifestCliOverrides,
  type ManifestCliArgv,
} from './utils/goal-manifest-cli';
import {
  loadProgressContext,
  projectGoalProgress,
  shouldThrottleSnapshot,
  writeProgressSnapshotAtomic,
  type ProgressWriterState,
} from './utils/goal-progress';

const PHASE_SKILL_REL: Record<FeaturePhase, string> = {
  spec: 'skills/feature/spec/SKILL.md',
  plan: 'skills/feature/plan/SKILL.md',
  coding: 'skills/feature/coding/SKILL.md',
  review: 'skills/feature/code-review/SKILL.md',
  ut: 'skills/feature/business-ut/SKILL.md',
  testing: 'skills/feature/device-testing/SKILL.md',
};

const LOCK_HEARTBEAT_MS = 60_000;
const RESUME_COOLDOWN_MINUTES = 5;

export interface SummaryJson {
  verdict?: HarnessVerdict;
  blocking_class?: string;
  failure_kind?: string;
  blockers?: Array<{
    id?: string;
    blocking_class?: string;
    classification?: string;
    details_excerpt?: string;
    affected_files?: string[];
    suggestion?: string;
  }>;
}

/** Active agent tree-kill registered for SIGINT/SIGTERM orphan cleanup. */
let activeAgentKill: (() => Promise<void>) | null = null;
/** Active harness-runner tree-kill (runHarnessPhase async spawn). */
let activeHarnessKill: (() => Promise<void>) | null = null;
let featureLock: { path: string; ownerId: string; interval?: NodeJS.Timeout } | null = null;
let runLock: { path: string; ownerId: string } | null = null;

/** Runtime substep for heartbeat / progress projection. */
let progressSubstep: 'agent_invoke' | 'harness' | 'prompt' | 'verdict' | null = null;
let progressPhase: FeaturePhase | null = null;
let progressHeartbeatHook: (() => void) | null = null;

/** minimist ParsedArgs → ManifestCliArgv（避免 TS2559 索引签名不兼容）。 */
function toManifestCliArgv(argv: minimist.ParsedArgs): ManifestCliArgv {
  return {
    manifest: typeof argv.manifest === 'string' ? argv.manifest : undefined,
    start: typeof argv.start === 'string' ? argv.start : undefined,
    end: typeof argv.end === 'string' ? argv.end : undefined,
    adapter: typeof argv.adapter === 'string' ? argv.adapter : undefined,
    requirement: typeof argv.requirement === 'string' ? argv.requirement : undefined,
    'override-start': Boolean(argv['override-start']),
    'override-end': Boolean(argv['override-end']),
    'override-manifest': Boolean(argv['override-manifest']),
  };
}

function guardNestedGoalRunner(): void {
  if (isGoalHeadlessEnv() && process.env.MAISON_GOAL_ALLOW_NESTED !== '1') {
    console.error(
      '[goal-runner] BLOCKER: nested goal-runner from headless agent (MAISON_GOAL_HEADLESS=1). ' +
        'Phase agents must not invoke goal-runner / --resume / --manifest.',
    );
    process.exit(1);
  }
}

function setupSignalHandlers(): void {
  const handler = (): void => {
    void (async () => {
      if (activeAgentKill) {
        try {
          await activeAgentKill();
        } catch {
          /* best-effort */
        }
      }
      if (activeHarnessKill) {
        try {
          await activeHarnessKill();
        } catch {
          /* best-effort */
        }
      }
      releaseAllLocks();
      process.exit(130);
    })();
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

function releaseAllLocks(): void {
  if (featureLock?.interval) clearInterval(featureLock.interval);
  if (featureLock) releaseLock(featureLock.path, featureLock.ownerId);
  if (runLock) releaseLock(runLock.path, runLock.ownerId);
  featureLock = null;
  runLock = null;
}

function appendEvent(reportDir: string, projectRoot: string, event: Record<string, unknown>): void {
  const abs = path.join(projectRoot, reportDir, 'events.jsonl');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf-8');
}

function readPhaseSummary(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
): {
  summary: SummaryJson | null;
  summaryPath: string | null;
  summaryAbsPath: string | null;
  reportDir: string | null;
} {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase);
  const summaryPath = path.join(dir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    return { summary: null, summaryPath: null, summaryAbsPath: null, reportDir: dir };
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as SummaryJson;
    const rel = path.relative(projectRoot, summaryPath).replace(/\\/g, '/');
    const relDir = path.relative(projectRoot, dir).replace(/\\/g, '/');
    return { summary, summaryPath: rel, summaryAbsPath: summaryPath, reportDir: relDir };
  } catch {
    return { summary: null, summaryPath: null, summaryAbsPath: null, reportDir: dir };
  }
}

function extractBlockingMeta(summary: SummaryJson | null): {
  blocking_class?: string;
  failure_kind?: string;
} {
  if (!summary) return {};
  if (summary.blocking_class || summary.failure_kind) {
    return { blocking_class: summary.blocking_class, failure_kind: summary.failure_kind };
  }
  const b = summary.blockers?.[0];
  if (!b) return {};
  return { blocking_class: b.blocking_class, failure_kind: b.classification };
}

function truncateOneLine(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * 把上一轮 harness summary 的 BLOCKER 证据压缩成可回喂给 fresh-context agent 的文本块。
 * 让重试/续跑的 agent 看到「上轮失败在哪、动了哪些文件、harness 给了什么修复建议」，
 * 避免在自己上一轮改坏的现场反复打补丁（goal 模式每轮 fresh context，否则跨轮失忆）。
 */
export function extractPriorFailureContext(summary: SummaryJson): string {
  const verdict = summary.verdict ?? 'FAIL';
  const blockers = (summary.blockers ?? []).slice(0, 4);
  const lines: string[] = [];
  for (const b of blockers) {
    const id = b.id ?? '(unknown check)';
    const kind = b.classification ?? '';
    lines.push(kind ? `- ${id} [${kind}]` : `- ${id}`);
    if (b.details_excerpt) {
      lines.push(`  details: ${truncateOneLine(b.details_excerpt, 300)}`);
    }
    if (b.affected_files && b.affected_files.length > 0) {
      lines.push(`  affected_files: ${b.affected_files.slice(0, 6).join(', ')}`);
    }
    if (b.suggestion) {
      lines.push(`  suggestion: ${truncateOneLine(b.suggestion, 300)}`);
    }
  }
  if (lines.length === 0) {
    const meta = extractBlockingMeta(summary);
    if (meta.failure_kind) lines.push(`- failure_kind: ${meta.failure_kind}`);
  }
  return [`Verdict: ${verdict}`, ...lines].join('\n');
}

async function runHarnessPhase(
  projectRoot: string,
  frameworkRoot: string,
  phase: FeaturePhase,
  feature: string,
  dryRun: boolean,
  manifest?: GoalManifest,
): Promise<number> {
  if (dryRun) return 0;
  const harnessDir = path.join(frameworkRoot, 'harness');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [MAISON_GOAL_RUNNER_ENV]: '1',
  };
  const allowedTools = manifest?.unattended?.allowed_tools;
  if (allowedTools?.length) {
    childEnv[MAISON_GOAL_ALLOWED_TOOLS_ENV] = allowedTools.join(',');
  }
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', 'harness-runner.ts', '--phase', phase, '--feature', feature, '--summary'],
    {
      cwd: harnessDir,
      shell: process.platform === 'win32',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  activeHarnessKill = async () => {
    if (child.pid) {
      await killProcessTree(child.pid);
    }
  };
  child.stdout?.on('data', (chunk: Buffer | string) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk: Buffer | string) => process.stderr.write(chunk));

  const settleWaiter = createChildSettleWaiter(child, {});
  try {
    const settled = await settleWaiter.promise;
    activeHarnessKill = null;
    return settled.exitCode;
  } catch {
    activeHarnessKill = null;
    return 1;
  }
}

export function buildPhasePrompt(
  manifest: GoalManifest,
  phase: FeaturePhase,
  frameworkRoot: string,
  deferredUpstream: Array<{ phase: FeaturePhase; reason: string }>,
  priorFailure?: string,
): string {
  const skillAbs = path.join(frameworkRoot, PHASE_SKILL_REL[phase]);
  const parts = [
    `# Goal run phase: ${phase}`,
    '',
    `Feature: ${manifest.feature}`,
    manifest.requirement ? `Requirement:\n${manifest.requirement}` : '',
    '',
    formatDeferredUpstreamNotice(deferredUpstream),
    '## Orchestrator constraints (BLOCKER)',
    '',
    '- Do NOT invoke goal-runner, --resume, or --manifest; the orchestrator is already running this goal run.',
    '- goal-runs/ evidence directory is read-only for you: do NOT write, append, or patch events.jsonl or any run artifacts.',
    '',
    `Read and follow the phase skill: ${PHASE_SKILL_REL[phase]}`,
    `Skill absolute path: ${skillAbs}`,
    '',
    'After producing artifacts, run harness for this phase and ensure summary.json is written.',
    'Do NOT claim phase complete if harness verdict is INCOMPLETE or FAIL.',
    phase === 'coding'
      ? 'If coding artifacts are ready: report "coding phase complete — goal continues to review→ut→testing" (not "goal run finished").'
      : '',
  ].filter(Boolean);
  if (priorFailure) {
    parts.push(
      '',
      '## Prior attempt failure (retry context)',
      '',
      "Last attempt of this phase failed. The harness verdict and BLOCKER evidence:",
      '',
      '```',
      priorFailure,
      '```',
      '',
      '**These failures may have been introduced by a prior attempt in this same goal run.** Before making new changes:',
      '1. Inspect the files changed relative to the goal-run start commit (trace.json.start_commit) and judge whether one of them is the actual root cause;',
      '2. If a change a prior attempt made for troubleshooting itself broke things (e.g. turned a valid config into an invalid schema, deleted the wrong file), **revert that change first** rather than stacking new code on a broken state;',
      '3. Only after confirming the root cause, apply a minimal fix and re-run this phase harness to verify.',
    );
  }
  return parts.join('\n');
}

/**
 * Detect an orphaned-but-incomplete prior run for a feature: feature.lock is stale
 * (dead owner pid / heartbeat TTL) AND its run never reached a COMPLETED terminal
 * status. Returns the run to resume, or null when starting fresh is safe (no lock /
 * live runner / prior run already COMPLETED / run unidentifiable).
 */
export function resolveOrphanedIncompleteRun(
  featureRunsDirAbs: string,
): { runId: string; reason: string } | null {
  const featureLockPath = path.join(featureRunsDirAbs, FEATURE_LOCK_NAME);
  const existing = readLockRecord(featureLockPath);
  if (!existing) return null; // clean
  if (!isLockStale(existing)) return null; // live runner → acquireGoalLocks will BLOCK
  const runId = existing.run_id;
  if (!runId) return null; // unidentifiable owner → fall through (steal stale lock)
  const events = loadEventsJsonl(path.join(featureRunsDirAbs, runId, 'events.jsonl'));
  const end = resolveEffectiveRunEnd(events);
  if (end?.status === 'COMPLETED') return null; // prior run finished; only a leftover lock
  const reason = isPidAlive(existing.pid) ? 'lock 心跳超时（owner 未释放）' : 'owner 进程已退出';
  return { runId, reason };
}

/**
 * Fresh-start guard: refuse to spin up a brand-new run_id when an orphaned-but-
 * incomplete run already exists for this feature; guide `--resume` instead.
 * `--force` overrides (steal + fresh). No-op for `--resume`.
 */
function guardOrphanedFeatureRun(
  projectRoot: string,
  featuresDir: string,
  feature: string,
  force: boolean,
): void {
  if (force) return;
  const featureRunsDirAbs = path.join(projectRoot, featuresDir, feature, 'goal-runs');
  const orphan = resolveOrphanedIncompleteRun(featureRunsDirAbs);
  if (!orphan) return;
  console.error(
    `[goal-runner] BLOCKER: feature "${feature}" 有未完成的 goal-run "${orphan.runId}"` +
      `（疑似孤儿：${orphan.reason}）。\n` +
      `  续跑既有 run（推荐）: --resume ${orphan.runId} --feature ${feature} [--force-resume]\n` +
      `  确认放弃该 run 改起全新 run: 本次命令加 --force`,
  );
  process.exit(1);
}

function acquireGoalLocks(
  projectRoot: string,
  featuresDir: string,
  feature: string,
  runId: string,
): void {
  const featureRunsDir = path.join(projectRoot, featuresDir, feature, 'goal-runs');
  const featureLockPath = path.join(featureRunsDir, FEATURE_LOCK_NAME);
  const runLockPath = path.join(featureRunsDir, runId, RUN_LOCK_NAME);

  const fRecord = tryAcquireLock(featureLockPath, { run_id: runId });
  if (!fRecord) {
    const existing = readLockRecord(featureLockPath);
    console.error(formatLockBlocker(featureLockPath, existing));
    process.exit(1);
  }

  const rRecord = tryAcquireLock(runLockPath, { run_id: runId, ownerId: fRecord.ownerId });
  if (!rRecord) {
    releaseLock(featureLockPath, fRecord.ownerId);
    const existing = readLockRecord(runLockPath);
    console.error(formatLockBlocker(runLockPath, existing));
    process.exit(1);
  }

  featureLock = {
    path: featureLockPath,
    ownerId: fRecord.ownerId,
    interval: setInterval(() => {
      touchLock(featureLockPath, fRecord.ownerId);
      try {
        progressHeartbeatHook?.();
      } catch (err) {
        console.warn(
          `[goal-runner] progress heartbeat failed (non-fatal): ${(err as Error).message}`,
        );
      }
    }, LOCK_HEARTBEAT_MS),
  };
  runLock = { path: runLockPath, ownerId: rRecord.ownerId };
}

function emitMilestone(line: string): void {
  console.log(line);
}

function setupProgressHooks(
  manifest: GoalManifest,
  projectRoot: string,
  featuresDir: string,
  workflow: ReturnType<typeof resolveWorkflowSpec>,
  writerState: ProgressWriterState,
): (force?: boolean, writeMd?: boolean) => void {
  const flushProgress = (force = false, writeMd = false): void => {
    try {
      const now = Date.now();
      if (!force && shouldThrottleSnapshot(writerState, now)) return;
      const ctx = loadProgressContext(projectRoot, manifest, featuresDir);
      const snapshot = projectGoalProgress({
        projectRoot,
        manifest,
        events: ctx.events,
        workflow,
        featureLock: ctx.featureLock,
        runnerLock: ctx.runnerLock,
        nowMs: now,
        liveProbe: false,
      });
      writeProgressSnapshotAtomic(projectRoot, manifest.report_dir, snapshot, writeMd);
      writerState.lastWriteMs = now;
    } catch (err) {
      console.warn(
        `[goal-runner] progress snapshot failed (non-fatal): ${(err as Error).message}`,
      );
    }
  };

  const writeHeartbeat = (): void => {
    if (!progressPhase) return;
    try {
      const phaseDir = path.join(projectRoot, manifest.report_dir, 'phases', progressPhase);
      const outputLog = path.join(phaseDir, 'agent-output.log');
      let agentOutputMtime: string | null = null;
      let agentOutputBytes = 0;
      if (fs.existsSync(outputLog)) {
        const st = fs.statSync(outputLog);
        agentOutputMtime = new Date(st.mtimeMs).toISOString();
        agentOutputBytes = st.size;
      }
      const lockRec = featureLock ? readLockRecord(featureLock.path) : null;
      const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
      const events = loadEventsJsonl(eventsPath);
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'heartbeat',
        phase: progressPhase,
        substep: progressSubstep,
        elapsed_ms: Date.now() - resolveWallClockStartMs(events),
        turns_used: countAgentInvokeStarts(events),
        lock_updated_at: lockRec?.updated_at ?? null,
        agent_output_mtime: agentOutputMtime,
        agent_output_bytes: agentOutputBytes,
      });
      flushProgress();
    } catch (err) {
      console.warn(
        `[goal-runner] progress heartbeat failed (non-fatal): ${(err as Error).message}`,
      );
    }
  };

  progressHeartbeatHook = writeHeartbeat;

  return flushProgress;
}

function buildAgentWarn(invoke: {
  exitCode: number;
  timed_out?: boolean;
  silent_killed?: boolean;
  duration_ms?: number;
}): string | undefined {
  if (invoke.exitCode === 0 && !invoke.timed_out && !invoke.silent_killed) return undefined;
  const parts: string[] = [];
  if (invoke.timed_out) parts.push('timed_out');
  if (invoke.silent_killed) parts.push('silent_killed');
  if (invoke.exitCode !== 0) parts.push(`exit=${invoke.exitCode}`);
  if (invoke.duration_ms != null) parts.push(`${invoke.duration_ms}ms`);
  return `agent observability: ${parts.join(', ')} (harness gate used fresh summary)`;
}

/**
 * Build the argv for the detached child: strip `--detach`, add `--detached-child`,
 * and (for a fresh run) thread the pre-generated `--run-id` so the child's manifest
 * matches the run_id the launcher already printed. Resume already carries its id.
 */
export function buildDetachedChildArgv(
  rawArgs: string[],
  runId: string,
  opts: { resume: boolean },
): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--detach') continue;
    if (a === '--run-id') {
      i++; // drop any pre-existing --run-id + its value; we re-add canonically
      continue;
    }
    out.push(a);
  }
  out.push('--detached-child');
  if (!opts.resume) out.push('--run-id', runId);
  return out;
}

/**
 * `--detach` launcher: spawn the real run as an independent background process and
 * return immediately. Critical Windows semantics (see chrys shell-tool host):
 *  - child stdio → log file, NEVER the parent's inherited stdout/stderr pipe, so a
 *    blocking host (chrys `communicate()`) sees EOF and the launcher "completes";
 *  - launcher exits 0 fast → host's clean-exit path does not tree-kill the child.
 */
function runDetachLauncher(argv: minimist.ParsedArgs): number {
  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDir = (cfg.paths.features_dir ?? 'doc/features').replace(/\\/g, '/');

  const feature = typeof argv.feature === 'string' ? argv.feature.trim() : '';
  const isResume = Boolean(argv.resume);
  if (!feature) {
    console.error('[goal-runner] BLOCKER: --detach 须配 --feature（用于定位 run 日志目录）');
    return 1;
  }

  // Same orphan guard as the foreground path — refuse a stillborn new run_id when an
  // orphaned-but-incomplete run exists (so --detach doesn't print run_id then die).
  if (!isResume) {
    guardOrphanedFeatureRun(projectRoot, featuresDir, feature, Boolean(argv.force));
  }

  const runId = isResume
    ? String(argv.resume)
    : typeof argv['run-id'] === 'string' && argv['run-id'].trim()
      ? String(argv['run-id']).trim()
      : newRunId();

  const reportDirRel = path.posix.join(featuresDir, feature, 'goal-runs', runId);
  const reportDirAbs = path.join(projectRoot, ...reportDirRel.split('/'));
  fs.mkdirSync(reportDirAbs, { recursive: true });
  const logPathAbs = path.join(reportDirAbs, 'detach.log');
  const logFd = fs.openSync(logPathAbs, 'a');

  const childArgs = buildDetachedChildArgv(process.argv.slice(2), runId, { resume: isResume });
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', __filename, ...childArgs],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      cwd: process.cwd(),
      env: process.env,
    },
  );
  // Parent must release the fd and the child reference: keeps no handle on the log
  // (so the host's pipe wait can't be extended) and lets the parent exit cleanly.
  child.unref();
  fs.closeSync(logFd);

  console.log(
    JSON.stringify({
      detached: true,
      run_id: runId,
      feature,
      report_dir: reportDirRel,
      log: path.relative(projectRoot, logPathAbs).replace(/\\/g, '/'),
      pid: child.pid ?? null,
    }),
  );
  return 0;
}

async function main(): Promise<number> {
  guardNestedGoalRunner();
  setupSignalHandlers();

  const argv = minimist(process.argv.slice(2), {
    string: ['feature', 'requirement', 'adapter', 'start', 'end', 'resume', 'manifest', 'run-id'],
    boolean: [
      'help', 'dry-run', 'force-resume', 'override-start', 'override-end', 'override-manifest',
      'detach', 'detached-child', 'force',
    ],
    alias: { f: 'feature', h: 'help' },
  });

  // `--detach`: fork the real run into the background and return immediately so a
  // blocking host shell (e.g. chrys TUI shell tool) is not held for the whole run.
  // The spawned child carries `--detached-child` and runs this same main() normally.
  if (argv.detach && !argv['detached-child']) {
    return runDetachLauncher(argv);
  }

  if (argv.help) {
    console.log(`
Goal runner — tool-agnostic multi-phase orchestrator

  npx ts-node scripts/goal-runner.ts --feature <f> --requirement "<text>" --adapter claude
    [--start spec] [--end testing] [--dry-run] [--resume <run-id> --feature <f>] [--manifest <file>]
    [--force-resume] [--override-start] [--override-end] [--override-manifest]
    [--detach]   fork the run into the background, print {run_id,...} JSON, exit 0
                 (for hosts whose shell tool blocks / can't background a long task)
`);
    process.exit(0);
  }

  const manifestArgv = toManifestCliArgv(argv);
  const manifestCliCheck = validateManifestCliOverrides(manifestArgv);
  if (!manifestCliCheck.ok) {
    console.error(manifestCliCheck.message);
    process.exit(1);
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const frameworkRoot = layout.frameworkRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const workflow = resolveWorkflowSpec(projectRoot, { config: cfg, frameworkRoot });

  const featuresDir = cfg.paths.features_dir ?? 'doc/features';

  let manifest: GoalManifest;
  if (argv.resume) {
    if (!argv.manifest && !argv.feature) {
      console.error('[goal-runner] BLOCKER: --resume 须配 --feature 或 --manifest');
      process.exit(1);
    }
    if (argv.manifest) {
      manifest = loadGoalManifestFile(String(argv.manifest), projectRoot, { featuresDir });
    } else {
      manifest = loadGoalManifestFromRun(projectRoot, String(argv.resume), {
        feature: String(argv.feature),
        featuresDir,
      });
    }
  } else if (argv.manifest) {
    manifest = loadGoalManifestFile(String(argv.manifest), projectRoot, { featuresDir });
  } else {
    manifest = buildGoalManifestFromInput(
      {
        start_phase: argv.start ?? 'spec',
        end_phase: argv.end ?? 'testing',
        feature: argv.feature,
        requirement: argv.requirement,
        adapter: argv.adapter ?? cfg.agent_adapter,
        // Detached child reuses the run_id the launcher already printed to the host.
        run_id:
          typeof argv['run-id'] === 'string' && argv['run-id'].trim()
            ? String(argv['run-id']).trim()
            : undefined,
        unattended: {
          write_mode: 'workspace-write',
          approval_mode: 'never',
          max_turns: 20,
          timeout_seconds: 3600,
        },
      },
      { projectRoot, featuresDir },
    );
  }

  if (argv.manifest) {
    applyManifestCliOverrides(manifest, manifestArgv);
  }

  const dryRun = Boolean(argv['dry-run']);
  const forceResume = Boolean(argv['force-resume']);

  // Fresh start (not --resume): if an orphaned-but-incomplete run exists for this
  // feature, refuse a brand-new run_id and guide --resume (--force overrides).
  if (!argv.resume) {
    guardOrphanedFeatureRun(projectRoot, featuresDir, manifest.feature, Boolean(argv.force));
  }

  acquireGoalLocks(projectRoot, featuresDir, manifest.feature, manifest.run_id);

  try {
    const { adapterStatus } = loadFrameworkConfigWithSources(projectRoot);
    const resolvedProfile = loadResolvedProfile(projectRoot, cfg);
    const provenance = resolveAdapterProvenance(
      {
        adapter: argv.adapter ? String(argv.adapter) : undefined,
        manifest: argv.manifest ? String(argv.manifest) : undefined,
        resume: argv.resume ? String(argv.resume) : undefined,
      },
      adapterStatus,
    );
    const chain = resolveAutoChain(
      workflow,
      manifest.start_phase,
      manifest.end_phase,
      manifest.chain_override,
    );
    runGoalPreflight({
      projectRoot,
      frameworkRoot,
      manifest,
      provenance,
      dryRun,
      chain,
      resolvedProfile,
    });
    writeGoalManifest(manifest, projectRoot);

    const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
    let priorEvents = loadEventsJsonl(eventsPath);

    if (argv.resume) {
      const halfRecovery = detectHalfCompletedPhaseRecovery(
        priorEvents,
        projectRoot,
        manifest.feature,
      );
      if (halfRecovery) {
        for (const ev of buildHalfPhaseRecoveryEvents(halfRecovery)) {
          appendEvent(manifest.report_dir, projectRoot, ev);
        }
        priorEvents = loadEventsJsonl(eventsPath);
      }

      const priorReport = loadGoalReportJson(projectRoot, manifest.report_dir);
      const lastRunEnd = findLastRunEnd(priorEvents);
      const guard = checkTerminalResumeGuard({
        priorStatus: priorReport?.status ?? lastRunEnd?.status,
        lastRunEndTs: lastRunEnd?.ts,
        forceResume,
        cooldownMinutes: RESUME_COOLDOWN_MINUTES,
      });
      if (!guard.allowed) {
        console.error(`[goal-runner] BLOCKER: ${guard.reason}`);
        return 1;
      }
    }

    const progressWriterState: ProgressWriterState = { lastWriteMs: 0 };
    const flushProgress = setupProgressHooks(
      manifest,
      projectRoot,
      featuresDir,
      workflow,
      progressWriterState,
    );

    appendEvent(manifest.report_dir, projectRoot, {
      type: 'run_start',
      dry_run: dryRun,
      chain,
    });
    flushProgress(true);

    const cap = loadGoalCapability(frameworkRoot, manifest.adapter!);
    let outcomes: GoalPhaseOutcome[] = [];
    let deferredUpstream: Array<{ phase: FeaturePhase; reason: string }> = [];
    let chainStartIndex = 0;

    const budgetBase = resolveResumedBudget(priorEvents);
    let totalTurns = budgetBase.totalTurns;
    const wallClockStartMs = budgetBase.wallClockStartMs;

    if (argv.resume) {
      const priorReport = loadGoalReportJson(projectRoot, manifest.report_dir);
      if (priorReport?.phases?.length) {
        const resume = resolveResumeState(chain, priorReport.phases);
        outcomes = [...resume.priorOutcomes];
        deferredUpstream = [...resume.deferredUpstream];
        chainStartIndex = resume.startIndex;
      } else {
        const resume = resolveResumeFromEvents(chain, priorEvents);
        outcomes = [...resume.priorOutcomes];
        deferredUpstream = [...resume.deferredUpstream];
        chainStartIndex = resume.startIndex;
      }
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'resume',
        start_index: chainStartIndex,
        start_phase: chain[chainStartIndex],
      });
    }

    let halted = false;
    const wallMs = manifest.budget.wall_clock_minutes * 60 * 1000;

    for (let phaseIdx = chainStartIndex; phaseIdx < chain.length; phaseIdx++) {
      const phase = chain[phaseIdx];
      let retries = 0;
      let phaseDone = false;

      progressPhase = phase;
      progressSubstep = null;

      appendEvent(manifest.report_dir, projectRoot, {
        type: 'phase_start',
        phase,
        phase_index: phaseIdx,
        phase_total: chain.length,
        attempt: retries + 1,
      });
      emitMilestone(
        `GOAL_PHASE phase=${phase} event=start index=${phaseIdx} total=${chain.length} attempt=${retries + 1}`,
      );
      flushProgress();

      if (featureLock) touchLock(featureLock.path, featureLock.ownerId);

      while (!phaseDone) {
        const budget = checkRunBudget(
          totalTurns,
          manifest.budget.max_total_turns,
          Date.now() - wallClockStartMs,
          wallMs,
        );
        if (budget !== 'ok') {
          halted = true;
          appendEvent(manifest.report_dir, projectRoot, {
            type: budget === 'wall_clock' ? 'budget_wall_clock' : 'budget_turns',
            phase,
          });
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
          });
          break;
        }

        totalTurns++;
        const phaseDir = path.join(projectRoot, manifest.report_dir, 'phases', phase);
        fs.mkdirSync(phaseDir, { recursive: true });
        const promptPath = path.join(phaseDir, 'prompt.md');

        // on-disk summary 同时服务两处：既有的 mtime 新鲜度判断，与跨轮失败上下文回喂。
        const priorSummaryRead = readPhaseSummary(projectRoot, manifest.feature, phase);
        const summaryMtimeBefore = getSummaryMtime(priorSummaryRead.summaryAbsPath);

        // 重试（retries>0）或 resume 续跑本 phase 首轮时，把上轮 BLOCKER 证据回喂给 fresh-context agent。
        // 保守门控：仅 FAIL/INCOMPLETE 才注入，避免干净首跑被残留旧 summary 污染。
        const isPhaseContinuation = retries > 0 || (argv.resume && phaseIdx === chainStartIndex);
        let priorFailure: string | undefined;
        if (isPhaseContinuation && priorSummaryRead.summary) {
          const v = priorSummaryRead.summary.verdict;
          if (v === 'FAIL' || v === 'INCOMPLETE') {
            priorFailure = extractPriorFailureContext(priorSummaryRead.summary);
          }
        }

        const prompt = buildPhasePrompt(
          manifest,
          phase,
          frameworkRoot,
          deferredUpstream,
          priorFailure,
        );
        fs.writeFileSync(promptPath, prompt, 'utf-8');
        progressSubstep = 'prompt';
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'prompt_written',
          phase,
          prompt_path: path.relative(projectRoot, promptPath).replace(/\\/g, '/'),
        });
        flushProgress();

        const vars: InvokeTemplateVars = {
          PROMPT_FILE: promptPath,
          PROMPT: prompt,
          SKILL_PATH: path.join(frameworkRoot, PHASE_SKILL_REL[phase]),
          PROJECT_ROOT: projectRoot,
          FRAMEWORK_ROOT: frameworkRoot,
          FEATURE: manifest.feature,
          PHASE: phase,
        };
        const invokePlan = resolveHeadlessInvokePlan(
          manifest.adapter!,
          cap.capability!,
          manifest.unattended,
          prompt,
          vars,
        );

        const outputLogPath = path.join(phaseDir, 'agent-output.log');
        const invokeId = `${phase}-${Date.now()}`;

        progressSubstep = 'agent_invoke';
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'agent_invoke_start',
          phase,
          invoke_id: invokeId,
          command: invokePlan.label,
        });
        flushProgress();

        const invoke = await invokeAgentHeadless(invokePlan, projectRoot, {
          dryRun,
          timeoutMs: (manifest.unattended.timeout_seconds ?? 3600) * 1000,
          outputLogPath,
          onActiveChild: ({ kill }) => {
            activeAgentKill = async () => {
              await kill();
            };
          },
          onChildExit: () => {
            activeAgentKill = null;
          },
        });

        appendEvent(manifest.report_dir, projectRoot, {
          type: 'agent_invoke_end',
          phase,
          invoke_id: invokeId,
          exit_code: invoke.exitCode,
          skipped: invoke.skipped,
          command: invoke.command,
          duration_ms: invoke.duration_ms,
          timed_out: invoke.timed_out,
          silent_killed: invoke.silent_killed,
          lingering_pipe: invoke.lingering_pipe,
          kill_attempted: invoke.kill_attempted,
          kill_exit_code: invoke.kill_exit_code,
          kill_error: invoke.kill_error,
        });
        flushProgress();

        progressSubstep = 'harness';
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'harness_start',
          phase,
        });
        flushProgress();

        const harnessExit = await runHarnessPhase(
          projectRoot,
          frameworkRoot,
          phase,
          manifest.feature,
          dryRun,
          manifest,
        );

        appendEvent(manifest.report_dir, projectRoot, {
          type: 'harness_end',
          phase,
          exit_code: harnessExit,
        });
        flushProgress();

        progressSubstep = 'verdict';
        const { summary, summaryPath, summaryAbsPath, reportDir } = readPhaseSummary(
          projectRoot,
          manifest.feature,
          phase,
        );
        const summaryMtimeAfter = getSummaryMtime(summaryAbsPath);
        const resolved = resolvePhaseHarnessVerdict({
          dryRun,
          agentExitCode: invoke.exitCode,
          agentSkipped: invoke.skipped,
          harnessExitCode: harnessExit,
          summaryBeforeMtime: summaryMtimeBefore,
          summaryAfterMtime: summaryMtimeAfter,
          summaryVerdict: summary?.verdict as HarnessVerdict | undefined,
        });
        const verdict = resolved.verdict;
        const meta = extractBlockingMeta(summary);
        const action = classifyPhaseVerdict({
          verdict,
          ...meta,
          dependency_policy: manifest.dependency_policy,
          retries_used: retries,
          max_retries_per_phase: manifest.budget.max_retries_per_phase,
        });

        const agentWarn = buildAgentWarn(invoke);

        appendEvent(manifest.report_dir, projectRoot, {
          type: 'phase_verdict',
          phase,
          verdict,
          action,
          harness_exit: harnessExit,
          stale_summary: resolved.stale_summary,
          agent_failed: resolved.agent_failed,
          blocking_class: meta.blocking_class,
          failure_kind: meta.failure_kind,
        });
        emitMilestone(`GOAL_PHASE phase=${phase} event=verdict result=${action}`);
        flushProgress();

        if (action === 'advance') {
          const snap = snapshotPhaseHarness(
            projectRoot,
            manifest.feature,
            phase,
            manifest.report_dir,
            frameworkRoot,
          );
          const snapshotSummary = snap.snapshot_files['summary.json'] ?? summaryPath ?? undefined;
          outcomes.push({
            phase,
            verdict,
            summary_path: snapshotSummary,
            report_dir: snap.snapshotDirRel,
            retries,
            agent_exit_code: invoke.exitCode,
            agent_timed_out: invoke.timed_out,
            agent_silent_killed: invoke.silent_killed,
            agent_warn: agentWarn,
            snapshot_files: snap.snapshot_files,
          });
          phaseDone = true;
          if (featureLock) touchLock(featureLock.path, featureLock.ownerId);
          continue;
        }

        if (
          action === 'defer_external_and_continue_if_allowed' ||
          action === 'defer_external_and_halt'
        ) {
          const reason = meta.failure_kind ?? meta.blocking_class ?? 'external_blocked';
          deferredUpstream.push({ phase, reason });
          const snap = snapshotPhaseHarness(
            projectRoot,
            manifest.feature,
            phase,
            manifest.report_dir,
            frameworkRoot,
          );
          outcomes.push({
            phase,
            verdict,
            deferred: true,
            deferred_reason: reason,
            summary_path: snap.snapshot_files['summary.json'] ?? summaryPath ?? undefined,
            report_dir: snap.snapshotDirRel,
            retries,
            agent_exit_code: invoke.exitCode,
            agent_timed_out: invoke.timed_out,
            agent_silent_killed: invoke.silent_killed,
            agent_warn: agentWarn,
            snapshot_files: snap.snapshot_files,
          });
          phaseDone = true;
          if (action === 'defer_external_and_halt') {
            halted = true;
          }
          if (featureLock) touchLock(featureLock.path, featureLock.ownerId);
          continue;
        }

        if (action === 'retry') {
          retries++;
          continue;
        }

        outcomes.push({
          phase,
          verdict,
          halted: true,
          summary_path: summaryPath ?? undefined,
          report_dir: reportDir ?? undefined,
          retries,
          agent_exit_code: invoke.exitCode,
          agent_timed_out: invoke.timed_out,
          agent_silent_killed: invoke.silent_killed,
          agent_warn: agentWarn,
        });
        halted = true;
        phaseDone = true;
      }

      if (halted) break;
    }

    const reachedEnd =
      !halted &&
      outcomes.length === chain.length &&
      outcomes[outcomes.length - 1]?.phase === chain[chain.length - 1];

    const phaseRecords = outcomes.map((o) => ({
      phase: o.phase,
      deferred: o.deferred,
      halted: o.halted,
    }));
    const status = resolveGoalRunStatus(phaseRecords, reachedEnd);
    const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, outcomes);
    writeGoalReport(projectRoot, manifest.report_dir, report);
    appendEvent(manifest.report_dir, projectRoot, { type: 'run_end', status });
    progressSubstep = null;
    progressPhase = null;
    progressHeartbeatHook = null;
    flushProgress(true, true);

    emitMilestone(`GOAL_RUN event=end status=${status} run_id=${manifest.run_id}`);
    console.log('');
    console.log('GOAL_RUN_SUMMARY');
    console.log(`run_id=${manifest.run_id}`);
    console.log(`status=${status}`);
    console.log(`report_dir=${manifest.report_dir}`);
    console.log(`phases=${outcomes.map((o) => o.phase).join(',')}`);
    console.log(`agent_invokes=${countAgentInvokeStarts(loadEventsJsonl(eventsPath))}`);

    if (status === 'HALTED') return 1;
    if (status === 'DEFERRED' || status === 'PARTIAL') return 2;
    return 0;
  } finally {
    if (activeHarnessKill) {
      void activeHarnessKill().catch(() => {
        /* best-effort — sync exit may not await */
      });
    }
    releaseAllLocks();
  }
}

// 仅作为 CLI 入口直接执行时自跑 main()；被单测 import（buildPhasePrompt /
// extractPriorFailureContext）时不触发 CLI，避免解析 process.argv 与 process.exit。
if (require.main === module) {
  process.on('exit', () => {
    releaseAllLocks();
  });

  void main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error((err as Error)?.message ?? err);
      releaseAllLocks();
      process.exit(1);
    });
}
