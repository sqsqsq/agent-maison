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
  featureArtifactPath,
  receiptDirPath,
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
import { resolvePhaseTimeoutMs, resolveWallClockMs } from './utils/goal-timeout';
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
  isSummaryFresh,
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  resolveResumeFromEvents,
  resolveResumeState,
  resolveWallClockStartMs,
} from './utils/goal-runner-phase';
import {
  applyClosurePatchFromReceiptValidation,
  isGoalHeadlessEnv,
  MAISON_GOAL_RUNNER_ENV,
  MAISON_GOAL_ALLOWED_TOOLS_ENV,
  tryValidateReceipt,
} from './utils/phase-state';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
  reconcileRunAdapter,
} from './utils/goal-preflight';
import { recordAdapterToLocal } from './utils/personal-setup-gate';
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
import {
  classifyFailureKind,
  extractBlockerSignature,
  extractDeterministicAffectedFiles,
  shouldHaltNoProgress,
  snapshotArtifacts,
  type ArtifactSnapshot,
  type FailureKind,
} from './utils/goal-failure-classifier';
import { parseHeadlessInteractionSentinel } from './utils/goal-headless-sentinel';

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
  receipt_status?: string;
  closure_status?: string;
  next_action?: string;
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

/** Set once the manifest is loaded; lets signal/exit handlers locate events.jsonl. */
let terminalEventCtx: { reportDir: string; projectRoot: string } | null = null;
/** True once any run_end (normal or interrupted) is written — keeps terminal event idempotent. */
let runConcluded = false;

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

/**
 * Decide how to treat the launch's survival posture. A real (non-dry-run) unattended run
 * (`approval_mode=never`) started in the FOREGROUND — no `--detach`, and not the OS-detached
 * child — is session-bound: the host reaps it when the agent turn/session ends (the 2026-06
 * incident, where `is_background` left a "running" corpse). Block it unless `--foreground-ok`
 * is given (manual / short / deliberately-foreground run). The OS-detached child and dry-runs
 * are always fine.
 */
export function evaluateForegroundSurvival(opts: {
  detachedChild: boolean;
  dryRun: boolean;
  foregroundOk: boolean;
  approvalMode: string | undefined;
}): 'ok' | 'warn' | 'block' {
  if (opts.detachedChild || opts.dryRun) return 'ok';
  if (opts.approvalMode !== 'never') return 'ok';
  return opts.foregroundOk ? 'warn' : 'block';
}

function setupSignalHandlers(): void {
  const handler = (signal: NodeJS.Signals): void => {
    // Synchronous + first: a host kill may not grant async time, so the terminal event
    // must land (appendFileSync) before the async tree-kills below.
    writeTerminalEvent(`signal:${signal}`);
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
  // Windows: SIGTERM is delivered as an uncatchable terminate; SIGBREAK (Ctrl-Break /
  // console close) is the catchable signal that actually fires there.
  process.on('SIGBREAK', handler);
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

/**
 * Write a terminal `run_end{status:INTERRUPTED}` on any abnormal exit (catchable signal /
 * crash / process exit) so an interrupted run is never silent — projection then shows
 * INTERRUPTED instead of a frozen RUNNING. Idempotent: a normal run_end sets `runConcluded`
 * and suppresses this; multiple exit hooks firing only write once. Best-effort and never
 * throws (exit paths must not blow up).
 */
function writeTerminalEvent(reason: string): void {
  if (runConcluded || !terminalEventCtx) return;
  runConcluded = true;
  try {
    appendEvent(terminalEventCtx.reportDir, terminalEventCtx.projectRoot, {
      type: 'run_end',
      status: 'INTERRUPTED',
      reason,
    });
  } catch {
    /* best-effort */
  }
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

function buildUnattendedExecutionBlock(manifest: GoalManifest, phase: FeaturePhase): string[] {
  const approval = manifest.unattended?.approval_mode ?? 'never';
  const assumptionsRel = `doc/features/${manifest.feature}/${phase}/headless-assumptions.md`;
  return [
    '## Unattended execution (headless goal-mode) (BLOCKER — overrides phase SKILL stop-and-ask)',
    '',
    'This run is **headless / unattended**. There is **no interactive user** in this session.',
    `- approval_mode: **${approval}**`,
    '',
    '**BLOCKER**: You MUST NOT stop to ask the user for confirmation, clarification, or approval.',
    'Stopping to ask the user in headless mode = **task failure** (runner will halt the goal run).',
    '',
    'This block **overrides** every phase SKILL instruction that says "停下来等用户确认",',
    '"不启用 auto-approve", "must wait for user", or equivalent — **including spec Step 1.5**.',
    '',
    'For every **in-phase** confirmation gate (registry class gate/enum/matrix/artifact_checkbox):',
    '- Resolve automatically per `skills/reference/user-confirmation-ux.md` **§9 Goal/headless**.',
    `- Record **every** auto-decision in \`${assumptionsRel}\` with provenance \`auto-approved (goal-mode), pending human review\`.`,
    '- `freeform_approval` gates (scope expansion, src mutation): **conservative default** — do NOT expand scope / do NOT mutate protected src; log deferred request in headless-assumptions.md.',
    '',
    'After auto-resolving gates: **continue producing phase artifacts** and run harness. Do NOT halt at confirmation gates.',
  ];
}

/**
 * P1-B：收集"超时可续作"的 partial 产物（项目相对路径）。
 * 仅列已落盘者：各 phase 的主产物 + context-exploration.md（探索缓存，最值得复用）。
 * coding 的源码在工作树天然持久，不在此列。
 */
const TIMEOUT_RESUMABLE_ARTIFACT_BY_PHASE: Record<FeaturePhase, string[]> = {
  spec: ['spec.md'],
  plan: ['plan.md'],
  coding: [],
  review: ['review-report.md'],
  ut: [],
  testing: ['test-report.md'],
};

export function collectTimeoutResumableArtifacts(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
  sinceMs = 0,
): string[] {
  const out: string[] = [];
  const toRel = (abs: string): string => path.relative(projectRoot, abs).replace(/\\/g, '/');
  // mtime 守卫：只复用本 run 起始之后产出的产物，过滤跨 run/feature 的陈旧报告，
  // 避免把旧结论当作"本次 partial work"回喂（codex P2）。
  const freshEnough = (abs: string): boolean => {
    try {
      return fs.statSync(abs).mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  };
  for (const fileName of TIMEOUT_RESUMABLE_ARTIFACT_BY_PHASE[phase] ?? []) {
    try {
      const abs = featureArtifactPath(projectRoot, feature, fileName);
      if (fs.existsSync(abs) && freshEnough(abs)) out.push(toRel(abs));
    } catch {
      /* 路径解析失败不阻断主流程 */
    }
  }
  try {
    const ce = path.join(receiptDirPath(projectRoot, feature, phase), 'context-exploration.md');
    if (fs.existsSync(ce) && freshEnough(ce)) out.push(toRel(ce));
  } catch {
    /* ignore */
  }
  return out;
}

export function buildPhasePrompt(
  manifest: GoalManifest,
  phase: FeaturePhase,
  frameworkRoot: string,
  deferredUpstream: Array<{ phase: FeaturePhase; reason: string }>,
  priorFailure?: string,
  priorFailureKind?: FailureKind,
  partialResumeArtifacts?: string[],
): string {
  const skillAbs = path.join(frameworkRoot, PHASE_SKILL_REL[phase]);
  const parts = [
    `# Goal run phase: ${phase}`,
    '',
    `Feature: ${manifest.feature}`,
    manifest.requirement ? `Requirement:\n${manifest.requirement}` : '',
    '',
    formatDeferredUpstreamNotice(deferredUpstream),
    ...buildUnattendedExecutionBlock(manifest, phase),
    '',
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
  if (partialResumeArtifacts && partialResumeArtifacts.length > 0) {
    parts.push(
      '',
      '## Prior attempt TIMED OUT — resume from partial work (NOT a content failure)',
      '',
      'The previous attempt of this phase was interrupted by a wall-clock timeout, not by a content/quality failure. The following artifacts were already (partially) written to disk. **Re-read them first and CONTINUE the unfinished parts — do NOT redo exploration/analysis from scratch:**',
      '',
      ...partialResumeArtifacts.map(f => `- ${f}`),
      '',
      'Resume where the prior attempt left off, finish the remaining work, then re-run this phase harness.',
    );
  }
  if (priorFailure) {
    parts.push(
      '',
      '## Prior attempt failure (retry context)',
      '',
      'Last attempt of this phase failed. The harness verdict and BLOCKER evidence:',
      '',
      '```',
      priorFailure,
      '```',
    );
    if (priorFailureKind === 'code_regression') {
      parts.push(
        '',
        '**These failures may have been introduced by a prior attempt in this same goal run.** Before making new changes:',
        '1. Inspect the files changed relative to the goal-run start commit (trace.json.start_commit) and judge whether one of them is the actual root cause;',
        '2. If a change a prior attempt made for troubleshooting itself broke things (e.g. turned a valid config into an invalid schema, deleted the wrong file), **revert that change first** rather than stacking new code on a broken state;',
        '3. Only after confirming the root cause, apply a minimal fix and re-run this phase harness to verify.',
      );
    } else if (priorFailureKind === 'deterministic_gate_or_artifact_missing') {
      parts.push(
        '',
        '**This failure is a missing artifact / confirmation gate — not a broken codebase.**',
        'Do NOT revert unrelated files. Apply §9 headless auto-resolution, write missing artifacts, and complete the phase.',
      );
    } else if (priorFailureKind === 'toolchain' || priorFailureKind === 'capture') {
      parts.push(
        '',
        '**This is a device toolchain / screenshot-capture (infrastructure) failure — NOT a code defect.**',
        'Do NOT revert or rewrite application code to "fix" it. Diagnose the environment: device connection / hdc / build toolchain / screenshot permissions.',
        'If the same infrastructure failure repeats, the run will HALT for you to fix the environment — blind retries waste the budget and do not improve the UI.',
      );
    } else if (priorFailureKind === 'visual_gap') {
      parts.push(
        '',
        '**This is a visual-fidelity gap (the rendered UI does not match the reference).** To make real progress:',
        '1. Read the SPECIFIC must_fix / layout-divergence regions / out-of-bounds elements in the BLOCKER evidence and fix exactly those;',
        '2. Do NOT blindly move or restructure unrelated blocks hoping the score improves — a prior attempt did that (moved the card-pack description) and made it worse;',
        '3. If the same set of visual gates keeps failing with no change, the run will HALT for human review rather than spinning.',
      );
    } else {
      parts.push(
        '',
        'Address the BLOCKER evidence above, then re-run harness for this phase.',
      );
    }
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
    string: ['feature', 'requirement', 'adapter', 'adapter-source', 'start', 'end', 'resume', 'manifest', 'run-id'],
    boolean: [
      'help', 'dry-run', 'force-resume', 'override-start', 'override-end', 'override-manifest',
      'override-adapter',
      'detach', 'detached-child', 'force', 'foreground-ok',
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
          // 不再硬编码扁平 timeout_seconds：开箱走 goal-timeout 的 per-phase 默认表
          // （spec 15m / plan·coding 90m / review·testing 120m / ut 60m），由 wall_clock 兜底。
          // 如需统一覆盖，显式设 unattended.timeout_seconds 或 phase_timeout_seconds。
        },
      },
      { projectRoot, featuresDir },
    );
  }

  if (argv.manifest) {
    applyManifestCliOverrides(manifest, manifestArgv);
  }

  // 运行身份对账（G1）：framework.local.json agent_adapter 为权威 SSOT。用 raw argv.adapter（不归一）
  // 与 local 对账——冲突 / 双缺 / override-无requested / local 损坏 → reconcile 抛 BLOCKER，在写 manifest 到盘 +
  // 加锁之前 STOP，不让 agent 的 --adapter 猜测覆盖你记录的运行身份。决策在此（纯计算，无副作用），
  // 但 override 回写 local 是副作用 → 延后到所有启动前置 gate + preflight 通过、写 manifest 之前（见下），
  // 避免"run 因 --detach 缺失 / 孤儿 run / capability 校验失败等 BLOCKER 退出却已把 local 切走"。
  let pendingAdapterWriteback: string | null = null;
  {
    const rawRequestedAdapter = argv.adapter
      ? String(argv.adapter).trim()
      : argv.manifest || argv.resume
        ? manifest.adapter
        : undefined;
    const adapterDecision = reconcileRunAdapter({
      projectRoot,
      requestedAdapter: rawRequestedAdapter,
      override: Boolean(argv['override-adapter']),
      adapterSource: argv['adapter-source'] ? String(argv['adapter-source']).trim() : undefined,
    });
    manifest.adapter = adapterDecision.effectiveAdapter;
    manifest.adapter_provenance = adapterDecision.provenance;
    if (adapterDecision.writeLocal) pendingAdapterWriteback = adapterDecision.effectiveAdapter;
  }

  const dryRun = Boolean(argv['dry-run']);
  const forceResume = Boolean(argv['force-resume']);

  // Survival guard (code-level enforcement of the launch contract): block a real unattended
  // run started in the foreground without --detach — it would be reaped when the host
  // session/turn ends (the 2026-06 incident). --foreground-ok downgrades it to a warning.
  const survivalPosture = evaluateForegroundSurvival({
    detachedChild: Boolean(argv['detached-child']),
    dryRun,
    foregroundOk: Boolean(argv['foreground-ok']),
    approvalMode: manifest.unattended?.approval_mode,
  });
  if (survivalPosture === 'block') {
    console.error(
      '[goal-runner] BLOCKER: unattended run (approval_mode=never) started in the FOREGROUND ' +
        'without --detach. It will be reaped when the host session/turn ends (2026-06 incident: ' +
        'is_background left a "running" corpse). Relaunch with --detach for unattended survival, ' +
        'or pass --foreground-ok to override (manual / short / deliberate foreground run).',
    );
    process.exit(1);
  }
  if (survivalPosture === 'warn') {
    console.error(
      '[goal-runner] ⚠ foreground unattended run (--foreground-ok): it will be reaped when the ' +
        'host session/turn ends; use --detach for real unattended survival.',
    );
  }

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
    // override 回写延后至此：survival guard / orphan guard / lock / preflight 全过，run 即将 commit 才切 local，
    // 避免任一启动前置 BLOCKER 退出却已把 framework.local.json 切走（run 没真启动 local 却变了）。
    if (pendingAdapterWriteback) {
      recordAdapterToLocal(projectRoot, pendingAdapterWriteback);
      console.error(
        `[goal-runner] 按 --override-adapter 切到 adapter=${pendingAdapterWriteback}，` +
          '已回写 framework.local.json（个人级、gitignored）。',
      );
    }
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

    // Arm the terminal-event safety net now that report_dir is known: any abnormal exit
    // from here on writes run_end{INTERRUPTED} instead of dying silently.
    terminalEventCtx = { reportDir: manifest.report_dir, projectRoot };

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
    // wall 由 goal-timeout 派生：max(配置 wall, Σ链路 per-phase + 缓冲)，
    // 保证全链单次满 per-phase 预算能跑完，避免被总 wall 提前截断。
    const wallMs = resolveWallClockMs(manifest);

    for (let phaseIdx = chainStartIndex; phaseIdx < chain.length; phaseIdx++) {
      const phase = chain[phaseIdx];
      let retries = 0;
      let phaseDone = false;
      let priorBlockerSignature: string | null = null;
      let priorArtifactSnapshot: ArtifactSnapshot | null = null;
      // P1-B：上一次 attempt 是否因超时被中断（非内容失败）——用于重试时复用 partial 产物。
      let priorAttemptTimedOut = false;

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
        let priorFailureKind: FailureKind | undefined;
        if (isPhaseContinuation && priorSummaryRead.summary) {
          const v = priorSummaryRead.summary.verdict;
          if (v === 'FAIL' || v === 'INCOMPLETE') {
            priorFailure = extractPriorFailureContext(priorSummaryRead.summary);
            priorFailureKind = classifyFailureKind(
              priorSummaryRead.summary,
              manifest.dependency_policy,
            );
          }
        }

        // P1-B：上轮因超时中断（非内容失败）时，把已落盘的 partial 产物回喂，
        // 让重试 fresh-context 续作而非从零重做探索。
        const partialResumeArtifacts =
          isPhaseContinuation && priorAttemptTimedOut
            ? collectTimeoutResumableArtifacts(projectRoot, manifest.feature, phase, wallClockStartMs)
            : [];

        const prompt = buildPhasePrompt(
          manifest,
          phase,
          frameworkRoot,
          deferredUpstream,
          priorFailure,
          priorFailureKind,
          partialResumeArtifacts,
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
          timeoutMs: resolvePhaseTimeoutMs(phase, manifest),
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

        const interactionSentinel = parseHeadlessInteractionSentinel(outputLogPath);
        if (interactionSentinel) {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'agent_interaction_required',
            phase,
            invoke_id: invokeId,
            code: interactionSentinel.code,
            question: interactionSentinel.error,
            line_index: interactionSentinel.lineIndex,
          });
        }

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
        let { summary, summaryPath, summaryAbsPath, reportDir } = readPhaseSummary(
          projectRoot,
          manifest.feature,
          phase,
        );
        const summaryMtimeAfter = getSummaryMtime(summaryAbsPath);
        const freshSummary = isSummaryFresh(summaryMtimeBefore, summaryMtimeAfter);

        if (!dryRun && freshSummary && summary?.verdict === 'PASS') {
          const harnessRoot = path.join(frameworkRoot, 'harness');
          const receiptValidation = tryValidateReceipt(
            harnessRoot,
            projectRoot,
            phase,
            manifest.feature,
          );
          applyClosurePatchFromReceiptValidation(
            projectRoot,
            manifest.feature,
            phase,
            receiptValidation,
            frameworkRoot,
          );
          ({ summary, summaryPath, summaryAbsPath, reportDir } = readPhaseSummary(
            projectRoot,
            manifest.feature,
            phase,
          ));
        }

        const resolved = resolvePhaseHarnessVerdict({
          dryRun,
          agentExitCode: invoke.exitCode,
          agentSkipped: invoke.skipped,
          harnessExitCode: harnessExit,
          summaryBeforeMtime: summaryMtimeBefore,
          summaryAfterMtime: summaryMtimeAfter,
          summaryVerdict: summary?.verdict as HarnessVerdict | undefined,
          receiptRequired: true,
          closureStatus: summary?.closure_status,
          receiptStatus: summary?.receipt_status,
          agentTimedOut: invoke.timed_out,
        });
        const verdict = resolved.verdict;
        const meta = extractBlockingMeta(summary);
        const failureKind = classifyFailureKind(summary, manifest.dependency_policy);
        const currentBlockerSignature = extractBlockerSignature(summary);
        const affectedFiles = extractDeterministicAffectedFiles(summary);
        const currentArtifactSnapshot =
          affectedFiles.length > 0
            ? snapshotArtifacts(projectRoot, affectedFiles)
            : {};

        let action = classifyPhaseVerdict({
          verdict,
          ...meta,
          dependency_policy: manifest.dependency_policy,
          retries_used: retries,
          max_retries_per_phase: manifest.budget.max_retries_per_phase,
        });

        let haltReason: string | undefined;
        if (interactionSentinel && verdict !== 'PASS') {
          action = 'halt';
          haltReason = 'headless_interaction_required';
        } else if (
          shouldHaltNoProgress({
            failureKind,
            priorBlockerSignature,
            currentBlockerSignature,
            priorArtifactSnapshot,
            currentArtifactSnapshot,
          })
        ) {
          action = 'halt';
          // T6：分流 halt 原因——基建(toolchain/capture)求人修环境 vs 视觉(visual_gap)同门禁无改善熔断求复核。
          haltReason =
            failureKind === 'visual_gap'
              ? 'no_progress_visual_gap'
              : failureKind === 'toolchain' || failureKind === 'capture'
                ? `no_progress_${failureKind}`
                : 'no_progress_guard';
        } else if (resolved.advance_blocked) {
          if (retries < manifest.budget.max_retries_per_phase) {
            action = 'retry';
          } else {
            action = 'halt';
            haltReason = resolved.advance_block_reason ?? 'closure_open';
          }
        }

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
          failure_kind_classified: failureKind,
          blocker_signature: currentBlockerSignature || undefined,
          halt_reason: haltReason,
          interaction_question: interactionSentinel?.error,
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
            advance_blocked: resolved.advance_blocked,
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
          priorBlockerSignature = currentBlockerSignature || priorBlockerSignature;
          priorArtifactSnapshot =
            Object.keys(currentArtifactSnapshot).length > 0
              ? currentArtifactSnapshot
              : priorArtifactSnapshot;
          priorAttemptTimedOut = invoke.timed_out === true;
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
          halt_reason: haltReason,
          interaction_question: interactionSentinel?.error,
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
      agent_timed_out: o.agent_timed_out,
      advance_blocked: o.advance_blocked,
    }));
    const status = resolveGoalRunStatus(phaseRecords, reachedEnd);
    const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, outcomes);
    writeGoalReport(projectRoot, manifest.report_dir, report);
    appendEvent(manifest.report_dir, projectRoot, { type: 'run_end', status });
    runConcluded = true; // normal terminal written → suppress the INTERRUPTED safety net
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
    // Backstop for any JS-observable exit (crash, process.exit) that didn't already
    // conclude — no-op once a run_end (normal or interrupted) was written.
    writeTerminalEvent('process_exit');
    releaseAllLocks();
  });

  void main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error((err as Error)?.message ?? err);
      writeTerminalEvent('uncaught_exception');
      releaseAllLocks();
      process.exit(1);
    });
}
