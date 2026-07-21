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
  relFeatureFile,
} from '../config';
import { detectRepoLayout } from '../repo-layout';
import { sanitizeSpawnEnv } from './utils/process-integrity';
import {
  buildAgentTimeoutRepeatedGuidance,
  buildAwaitHumanConfirmGuidance,
  buildClosureWallGuidance,
  buildFrameworkBugGuidance,
  buildFrameworkIntegrityGuidance,
} from './utils/await-confirm-guidance';
import { loadResolvedProfile } from '../profile-loader';
import { runCapabilityPreflight, emitHarnessPreflightGap } from './utils/capability-preflight';
import type { HarnessResolvedProfile } from './utils/types';
import { resolveWorkflowSpec } from '../workflow-loader';
import { resolveContextAdapterImageInput, isVisionCanaryFresh } from './utils/multimodal-probe';
import { loadLocalConfig as loadFrameworkLocalConfig } from './utils/framework-local-config';
import {
  clampFidelityByCapability,
  computeRunRequirementSha,
  dereferenceRequirementDocs,
  detectPixel1to1Intent,
  detectUiRelevantRequirement,
  discoverReferenceImagesForOcrPrescan,
  loadProfileOcrToolkit,
  loadSpecMarkdown,
  parseFidelityTargetFromHandoffDoc,
  resolveOcrAvailableForRun,
  type FidelityTarget,
} from './utils/fidelity-shared';
import {
  parseUiChangeFromSpecMarkdown,
  parseVisualHandoffYamlRoot,
  UI_CHANGE_REQUIRES_UI_SPEC,
  uiSpecAbsPath,
} from './utils/ui-spec-shared';
import {
  classifyPhaseVerdict,
  featurePhasesFromWorkflow,
  formatDeferredUpstreamNotice,
  resolveAutoChain,
  resolveGoalRunStatus,
  type FeaturePhase,
  type GoalRunStatus,
  type HarnessVerdict,
} from './utils/phase-transition-policy';
import { collectAutoDecisions, countPendingMustReview, loadHeadlessLedger } from './utils/headless-assumptions';
import { recomputePhaseEvidenceStaleness, stableStringify } from './utils/phase-evidence-manifest';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './utils/confirmation-receipt';
import { loadReviewClosureAttestation } from './utils/closure-attestation';
import {
  classifyCleanPassIssues,
  collectCleanPassIssues,
  generateFeatureCompletion,
  resolvePhaseRunIds,
} from './utils/verify-feature-completion';
import { resolveFeatureTrack } from './utils/runtime-policy';
import { loadFeatureTrackDecl } from './utils/feature-track';
import { mergeUsageIntoTraceFile } from './utils/usage-capture';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  computeManifestIdentityHash,
  diffManifestIdentityFields,
  loadGoalManifestFile,
  loadGoalManifestFromRun,
  newRunId,
  overrideAuthorizedIdentityFields,
  writeGoalManifest,
  type GoalManifest,
} from './utils/goal-manifest';
import {
  canAffordBackoff,
  collectPhaseTimeoutWarnings,
  extractTimeoutRatchetFromEvents,
  isExplicitPhaseTimeout,
  resolveEffectiveTimeoutMs,
  resolvePhaseTimeoutMs,
  resolveWallClockMs,
  CONSECUTIVE_TIMEOUT_ESCALATE_AFTER,
  CONSECUTIVE_TIMEOUT_HALT_AT,
  FINALIZE_RESERVE_MS,
  TIMEOUT_ESCALATION_FACTOR,
} from './utils/goal-timeout';
import {
  deriveResumeInspection,
  buildResumeSkipLines,
  deriveReportSections,
  deriveAndWriteCheckpoint,
} from './utils/goal-checkpoint';
import {
  generateGoalReportJson,
  loadGoalReportJson,
  writeGoalReport,
  type GoalPhaseOutcome,
} from './utils/goal-report-generator';
import {
  invokeAgentHeadless,
  agentEventsLogPath,
  createChildSettleWaiter,
  killProcessTree,
  probeAdapterVersion,
  resolveHeadlessInvokePlan,
  type InvokeTemplateVars,
} from './utils/agent-invoke';
import { extractClaudeFinalResultText, parseClaudeInitModel, planUsesClaudeStreamJson } from './utils/claude-envelope';
import {
  beginInvalidationTx,
  commitInvalidationTx,
  diffFrozenAgainstManifest,
  readFrozenManifest,
  loadTrustedSnapshotContext,
  phaseHasFrozenSurface,
  readPassSnapshotHead,
  recoverInvalidationJournal,
  resolveFrozenDeliverables,
  restoreFrozenFromSnapshot,
  passSnapshotPhaseDir,
  takePassSnapshot,
} from './utils/pass-snapshot';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import {
  produceCriticReceipt,
  produceSpecRefsReceipt,
  sha256FileFull,
  specRefsReceiptPath,
} from './utils/critic-receipt-producer';
import { collectAuthoritativeImagePaths } from './utils/multimodal-probe';
import {
  buildInlineCanaryBlock,
  classifyCanaryResponse,
  generateRandomCanaryAnswerKey,
  isCanaryAnswerComplete,
  renderCanaryImage,
  type CanaryAnswerKey,
} from './utils/vision-canary';
import * as os from 'os';
import {
  artifactAttestationsPath,
  capabilityReceiptPath,
  migrateLegacyVisionLedgers,
  policyDowngradesPath,
  resolveEffectiveVisionContext,
  writeCapabilityReceipt,
} from './utils/effective-vision-context';
import { reconcileSourceTreeAgainstAttestation } from './utils/closure-attestation';
import {
  classifySourceDrift,
  loadMutationAuthorizations,
  receiptsFromManifestEntries,
  sha256FileHex,
  type DriftClassification,
} from './utils/mutation-authorization';
import {
  intermediateRoundsJournalPath,
  replayJournalIntoLedger,
} from './utils/intermediate-rounds-journal';
import {
  buildHalfPhaseRecoveryEvents,
  checkRunBudget,
  checkTerminalResumeGuard,
  collectUncommittedVisualAttemptIds,
  collectVisualRoundRowHashes,
  countAgentInvokeStarts,
  countTransientApiRetries,
  detectHalfCompletedPhaseRecovery,
  findLastRunEnd,
  isAgentNoOutputSignal,
  lastPhaseVerdictTransientApiError,
  getSummaryMtime,
  isSummaryFresh,
  countConsecutiveAgentTimeouts,
  deriveContinuationFromEvents,
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  resolveResumeFromEvents,
  resolveResumeState,
  resolveWallClockStartMs,
  countCumulativeAdvanceBlocked,
  countRepeatedSignatureInFamily,
  classifyClosureKind,
  resolveClosureSyncOutcome,
  shouldHaltClosureTimeout,
  type ContinuationCause,
} from './utils/goal-runner-phase';
import {
  reconcileLedgerWithEvents,
  visualRoundsLedgerPath,
} from './utils/visual-rounds-ledger';
import {
  applyClosurePatchFromReceiptValidation,
  isGoalHeadlessEnv,
  MAISON_GOAL_RUNNER_ENV,
  MAISON_GOAL_ALLOWED_TOOLS_ENV,
  runSyncClosure,
  tryValidateReceipt,
} from './utils/phase-state';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
  reconcileRunAdapter,
  decideVisionCanaryProbe,
  runVisionCanaryProbe,
  evaluateFidelityTierPreflight,
  evaluateFidelityTransitionAuthorization,
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
  aggregateBlockerActionability,
  artifactsProgressed,
  buildEffectiveBlockerSignature,
  classifyFailureKind,
  classifyTimedOutWithFreshBlockers,
  resolveBlockerActionability,
  extractDeterministicAffectedFiles,
  extractIntegritySubtypes,
  isOperatorInterruptSignal,
  shouldHaltNoProgress,
  snapshotArtifacts,
  ADVANCE_BLOCKED_HALT_THRESHOLD,
  CUMULATIVE_HALT_FAMILY,
  CUMULATIVE_HALT_THRESHOLD,
  type ArtifactSnapshot,
  type FailureKind,
} from './utils/goal-failure-classifier';
import {
  parseHeadlessApiError,
  parseHeadlessInteractionSentinel,
} from './utils/goal-headless-sentinel';

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
    fidelity: typeof argv.fidelity === 'string' ? argv.fidelity : undefined,
    'fidelity-receipt': typeof argv['fidelity-receipt'] === 'string' ? argv['fidelity-receipt'] : undefined,
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
 * t3-min invoke 前能力 gate（v5 可测抽取——codex 第四轮 P1：宿主行为不宜仅靠代码结构推断）：
 * 真实链 runCapabilityPreflight（profile 前置解析→ensure 门→probe 深检）+ 机读
 * HARNESS_PREFLIGHT 落盘 + phase_halt 事件。缺口=返回 halted outcome（调用方 push 后
 * break——不产生 agent_invoke_start、不烧 agent 轮次）；齐备=null（调用方继续 invoke）。
 * emitEvent 注入：主循环传 appendEvent 闭包；单测传事件收集器断言序列。
 */
export function runInvokeCapabilityGate(opts: {
  projectRoot: string;
  phase: string;
  retries: number;
  resolvedProfile: HarnessResolvedProfile;
  emitEvent: (event: Record<string, unknown>) => void;
}): { outcome: GoalPhaseOutcome } | null {
  const capGap = runCapabilityPreflight(opts.projectRoot, opts.phase, opts.resolvedProfile);
  if (capGap.ok) return null;
  // t3-min v2（cursor MAJOR）：goal 路径同样落盘机读 HARNESS_PREFLIGHT（报告引导按它处置）。
  emitHarnessPreflightGap(opts.projectRoot, opts.phase, capGap);
  opts.emitEvent({
    type: 'phase_halt',
    phase: opts.phase,
    halt_reason: 'await_human_capability_gap',
    verdict: 'FAIL',
  });
  console.error(
    `\n===== await_human_capability_gap =====\n[${capGap.code}] ${capGap.message}\n` +
      `${capGap.guidance_install}\n${capGap.guidance_stop}\n` +
      '环境修好后 --resume 继续（配置/SDK/DevEco 变更会自动解除；其余先跑 --ensure 人工 reprobe）；' +
      '环境没修直接 resume 会再次在此拦截。\n',
  );
  // t3-min v2（codex P1）：halt_reason/guidance 进 outcome——goal-report 人读阶梯才可达。
  return {
    outcome: {
      phase: opts.phase,
      verdict: 'FAIL',
      halted: true,
      retries: opts.retries,
      halt_reason: 'await_human_capability_gap',
      halt_guidance: `[${capGap.code}] ${capGap.guidance_install} ${capGap.guidance_stop}`,
    },
  };
}

/**
 * run_end 终态 halt_reason 语义（v5 可测抽取）：取最后一个 halted outcome 的原因——
 * 消费方（goal-status/报告）无需回扫 phase_halt 事件即可分类终态。
 */
export function resolveLastHaltReason(outcomes: GoalPhaseOutcome[]): string | undefined {
  return [...outcomes].reverse().find(o => o.halted && o.halt_reason)?.halt_reason;
}

/**
 * 把上一轮 harness summary 的 BLOCKER 证据压缩成可回喂给 fresh-context agent 的文本块。
 * 让重试/续跑的 agent 看到「上轮失败在哪、动了哪些文件、harness 给了什么修复建议」，
 * 避免在自己上一轮改坏的现场反复打补丁（goal 模式每轮 fresh context，否则跨轮失忆）。
 */
export function extractPriorFailureContext(summary: SummaryJson): string {
  const verdict = summary.verdict ?? 'FAIL';
  // P0-4(b)（plan 7c4f2e9b）：重试回喂只含 agent_fixable 条目——human_only 已转人工队列，
  // 回喂只会诱导 agent 对着修不了的签字项空转（事故 i5 即全程逆向门禁）。operator_note
  // 永不入回喂（P1-7 受众分级）。
  const all = summary.blockers ?? [];
  const parked = all.filter(b => resolveBlockerActionability(b) === 'human_only');
  // post-impl review P2#8：严格 === 'agent_fixable'——toolchain_blocked 回喂只会诱导
  // agent「修环境」（它修不了）；toolchain 走 operator 队列单列。
  const toolchainParked = all.filter(b => resolveBlockerActionability(b) === 'toolchain_blocked');
  const feedable = all.filter(b => resolveBlockerActionability(b) === 'agent_fixable').slice(0, 4);
  const lines: string[] = [];
  for (const b of feedable) {
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
  if (parked.length > 0) {
    lines.push(
      `- (parked, human-only — do NOT attempt) ${parked.map(b => b.id ?? '?').join(', ')}: ` +
      'these require human signature/confirmation and are queued for a human; retrying them is task failure.',
    );
  }
  if (toolchainParked.length > 0) {
    lines.push(
      `- (parked, environment/toolchain — do NOT attempt) ${toolchainParked.map(b => b.id ?? '?').join(', ')}: ` +
      'these are environment failures queued for the operator; do not modify product code or artifacts to work around them.',
    );
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
  roundIdentity?: { runId: string; attemptId: string },
  // P0-4（plan d9b4f7e2 rev5）：harness 也在 wall deadline 内——旧实现无 timeout，agent
  // 停在 deadline 后 harness 仍可无限跑，"超支 ≤ grace"无从保证。返回结构化结果：
  // exitCode=1 无法区分门禁真失败与 wall 树杀，timedOut 单独承载。
  timeoutMs?: number,
): Promise<{ exitCode: number; timedOut: boolean }> {
  if (dryRun) return { exitCode: 0, timedOut: false };
  const harnessDir = path.join(frameworkRoot, 'harness');
  // P0-7①：harness 子进程须在干净环境运行——剥离 NODE_OPTIONS 预加载注入（2026-07-05 伪签事故向量）。
  const sanitized = sanitizeSpawnEnv(process.env);
  if (sanitized.stripped.length > 0) {
    console.warn(`[P0-7] 已剥离 NODE_OPTIONS 预加载注入（harness 子进程不继承）：${sanitized.stripped.join('; ')}`);
  }
  const childEnv: NodeJS.ProcessEnv = {
    ...sanitized.env,
    [MAISON_GOAL_RUNNER_ENV]: '1',
    // t1（f7a3d9c2）：外层脚本闸门与 agent 自跑共用同一轮次身份（round_key 去重/重放）
    ...(roundIdentity
      ? { MAISON_GOAL_RUN_ID: roundIdentity.runId, MAISON_GOAL_ATTEMPT: roundIdentity.attemptId }
      : {}),
    // S5（visual-capability-truth）：单写者标记——只有 runner 直接 spawn 的 gate harness
    // 可直写正式 visual-rounds ledger；agent 自跑 harness（无此标）写 journal proposal。
    MAISON_GOAL_GATE_HARNESS: '1',
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
      // P0-4 复审修复（codex P0）：POSIX 下须自成进程组——killProcessTree 的
      // process.kill(-pid) 以进程组为前提，不 detached 时组杀必然 ESRCH 回落单杀，
      // 孙进程（harness 再 spawn 的编译/设备子进程）漏杀。与 agent invoke 同口径。
      detached: process.platform !== 'win32',
    },
  );
  activeHarnessKill = async () => {
    if (child.pid) {
      await killProcessTree(child.pid);
    }
  };
  child.stdout?.on('data', (chunk: Buffer | string) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk: Buffer | string) => process.stderr.write(chunk));

  // P0-4：remaining-budget timeout + 进程树 kill（bounded，见 agent-invoke killProcessTree）。
  // 复审修复（codex P0/cursor 阻断1）：kill 必须与 agent 路径同构——**先 arm force-settle
  // 再杀**。否则 taskkill 超时/失败且目标存活时 child 永不 exit/close，settleWaiter.promise
  // 永久悬挂，hard wall 形同虚设（正是本 plan 要根治的"无界等待"在 harness 段的复刻）。
  const settleWaiter = createChildSettleWaiter(child, {});
  let timedOut = false;
  const killTimer =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          settleWaiter.armForceSettleAfterKill();
          if (child.pid) {
            // killProcessTree 自身有界（taskkill helper 超时会被结束）；即便它失败，
            // 上面的 force-settle 也保证 promise 在 FORCE_SETTLE 窗口内 resolve。
            void killProcessTree(child.pid);
          }
        }, timeoutMs)
      : null;

  try {
    const settled = await settleWaiter.promise;
    return { exitCode: timedOut && settled.exitCode === 0 ? 1 : settled.exitCode, timedOut };
  } catch {
    return { exitCode: 1, timedOut };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    activeHarnessKill = null;
  }
}

/**
 * E0（多模态降级阶梯 plan d4a8f3c6）：能力探测结果——由 resolvePhaseCapabilityAdvisory 计算，
 * buildCapabilityBlock/buildUnattendedExecutionBlock 都只读这一份数据（同源取值，cursor 采纳：
 * 防止能力块与 unattended 块各算一遍、互相矛盾）。null 表示本 phase 非 UI 相关，不注入任何能力信息。
 */
export interface CapabilityAdvisory {
  hasVision: boolean;
  ocrAvailable: boolean;
  effectiveFidelity: FidelityTarget;
  fidelityClamped: boolean;
  /** OCR 预扫描产出的 project-relative .ocr.json 路径（无参考图/OCR 不可用/有视觉时为空数组） */
  ocrJsonPaths: string[];
}

/**
 * E0：能力感知 phase prompt 块——案B chrys 实证：agent 收到的 phase prompt 里此前零降级
 * 信息，SKILL 又写死"必须用强 VL 模型"，盲 agent 会硬闯任务而非按能力工作法收口。
 * 本块把探测结果摆在 agent 面前，明确告诉它该走哪条工作法。
 */
export function buildCapabilityBlock(advisory: CapabilityAdvisory): string[] {
  const lines = [
    '## Visual capability advisory (auto-detected — trust this over assumptions or phase SKILL defaults)',
    '',
    `- Vision (can read images): **${advisory.hasVision ? 'YES' : 'NO'}**`,
    `- OCR assistance available: **${advisory.ocrAvailable ? 'YES' : 'NO'}**`,
    `- Effective fidelity target for this run: **${advisory.effectiveFidelity}**` +
      (advisory.fidelityClamped
        ? ' (auto-clamped down from a higher desired target by the capability above — this is expected, not a mistake; do not try to "fix" it by editing fidelity_target)'
        : ''),
    '',
  ];
  if (advisory.fidelityClamped) {
    lines.push(
      'This capability-based fidelity downgrade is itself a headless auto-decision: record it in',
      '`headless-assumptions.md` (see the Unattended execution block below for the exact path and provenance',
      'format) so a human reviewer can see why fidelity was clamped, even though this run does not stop to ask.',
      '',
    );
  }
  if (!advisory.hasVision) {
    lines.push(
      '**You do NOT have vision.** Do NOT pretend to look at reference images or describe their visual',
      'content from imagination — that is fabrication and will be caught by verification. Work like this instead:',
      '- Structure and screen layout: infer from the requirement text and any structured hints available.',
      '- Text copy and text positions: if OCR JSON files are listed below, treat them as ground truth — copy',
      '  text verbatim from there, do NOT invent wording.',
      '- Icons/logos/illustrations: use placeholder assets + asset-manifest.yaml (existing mechanism) — do NOT',
      '  claim to have visually verified their appearance.',
      '- Anything you genuinely cannot determine without seeing the image: register it in the structured',
      '  blind-review pending list (see phase SKILL reference/ui-spec.md「盲档工作法」) instead of guessing',
      '  or endlessly re-attempting — that is the correct way to close this out at your capability level.',
    );
    if (advisory.ocrJsonPaths.length > 0) {
      lines.push('', 'OCR JSON for reference images (text + confidence + normalized bbox per word):', '');
      for (const p of advisory.ocrJsonPaths) lines.push(`- ${p}`);
    } else {
      lines.push(
        '',
        '(No OCR JSON available for this run — no reference images were found, or OCR is not set up. Work',
        'from the requirement text only; the effective fidelity above already reflects this.)',
      );
    }
  }
  lines.push('');
  return lines;
}

function buildUnattendedExecutionBlock(
  manifest: GoalManifest,
  phase: FeaturePhase,
  projectRoot: string,
  capabilityAdvisory?: CapabilityAdvisory,
): string[] {
  const approval = manifest.unattended?.approval_mode ?? 'never';
  const assumptionsRel = relFeatureFile(projectRoot, manifest.feature, `${phase}/headless-assumptions.jsonl`);
  const assumptionsMdRel = relFeatureFile(projectRoot, manifest.feature, `${phase}/headless-assumptions.md`);
  // E0（cursor 采纳：同 prompt 自相矛盾预防）——原文硬编码「唯一出路是 pixel_1to1 P0 屏人工
  // 确认」；盲档下 effective fidelity 根本到不了 pixel_1to1，这句话与能力块（若同时注入）自相
  // 矛盾。按 capabilityAdvisory（与能力块同源取值）分支措辞；未传入（非 UI phase）时保留原文。
  const pixelReachable = !capabilityAdvisory || capabilityAdvisory.effectiveFidelity === 'pixel_1to1';
  const deterministicDetectorLines = pixelReachable
    ? [
        '- Deterministic detectors (node_options_injection / visual_diff_tamper_artifact / receipt command scan /',
        '  drift approval validation) turn any attempt into BLOCKER evidence. The only path through pixel_1to1 P0',
        '  screens is: fix deterministic signals, then HALT for human per-screen confirmation.',
      ]
    : [
        '- Deterministic detectors (node_options_injection / visual_diff_tamper_artifact / receipt command scan /',
        '  drift approval validation) turn any attempt into BLOCKER evidence — this applies regardless of fidelity tier.',
        `  This run's effective fidelity is **${capabilityAdvisory!.effectiveFidelity}** (not pixel_1to1): there is no`,
        '  per-screen human pixel-confirmation path here. Register genuinely undecidable items in the blind-review',
        '  pending list (see phase SKILL) instead of fabricating a verdict or endlessly re-attempting.',
      ];
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
    `- Record **every** auto-decision as one JSON line in \`${assumptionsRel}\` (machine SSOT; check-receipt`,
    '  BLOCKER-validates schema and registry completeness — a gate without a ledger line fails the phase closure):',
    '  `{"decision_id":"<unique>","run_id":"<this run id>","phase":"<phase>","gate_id":"<registry id>",' +
      '"class":"<gate|enum|matrix|artifact_checkbox|freeform>","decision":"<what you chose, or n/a: reason>",' +
      '"must_review":true|false,"source":"agent","ts":"<ISO 8601>"}`',
    `- Optionally mirror a human-readable table in \`${assumptionsMdRel}\` (projection only — never the SSOT).`,
    '- Ledger records are **not** authorization: any hard-gate-lowering decision (fidelity downgrade, P0 skip',
    '  waiver, conditional-review authorization, behavior-switch waiver) requires an out-of-band confirmation',
    '  receipt; without one the run caps at AWAITING_HUMAN_REVIEW.',
    '- `freeform_approval` gates (scope expansion, src mutation): **conservative default** — do NOT expand scope / do NOT mutate protected src; log the deferred request as a ledger line (must_review=true).',
    '- Product source under test phases is attestation-locked: any product-code change after review closure',
    '  fails testing (`review_closure_attestation` BLOCKER). Test seams MUST NOT alter user-visible flows or',
    '  default behavior — a `*_FAST_PATH`-style switch defaulting to true is a blocker, not a workaround.',
    '',
    'After auto-resolving gates: **continue producing phase artifacts** and run harness. Do NOT halt at confirmation gates.',
    '',
    '**Gate-integrity red lines (BLOCKER — violations are task failure, not a path to completion):**',
    '- NEVER forge confirmation signatures: `confirmed_by` / `bbox_verified_by` / `approved_by` are human-only;',
    '  `user_requirement` is a requirement-level authorization sentinel (crop authorization only), NOT a verification signature.',
    '- NEVER tamper with gate artifacts (visual-diff.json / summary.json / receipts) via process injection',
    '  (NODE_OPTIONS --require/-r/--import/--loader, .node-options, .npmrc node-options, fs monkey-patching)',
    '  or verdict-filling/resetting scripts; never instruct the operator to set up such bypasses.',
    '- NEVER self-approve framework drift: integrity.drift_allowlist / allow_local_drift take effect only with',
    '  human-named {rationale, approved_by}; agent-added entries are void. Found a framework bug? HALT and report.',
    ...deterministicDetectorLines,
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

/** P0-D：断流 backoff 退避表（指数 5s→15s→45s，§六-5 拍板）。 */
export const TRANSIENT_API_BACKOFF_MS: readonly number[] = [5_000, 15_000, 45_000];

// P0-10a：await_human_visual_confirm 引导话术升级为按 run 上下文机器生成的 builder
// （buildAwaitHumanConfirmGuidance），见 utils/await-confirm-guidance.ts。旧静态常量已废除。

/**
 * P0-D §六-8：0 字节输出判 agent_no_output 的"极短时长"上限。正常 headless agent
 * 起步（加载 CLAUDE.md/skill）都远超 30s；即死型失败（认证/权限/CLI 参数）秒级退出。
 */
export const AGENT_NO_OUTPUT_MAX_DURATION_MS = 30_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * P0-B：agent_timeout 无 deterministic affected_files 时的进展监控清单——phase 主产物
 * + context-exploration.md 的**相对路径**（不做存在过滤：不存在→snapshot exists:false，
 * 下轮出现即 artifactsProgressed=true，guard 放行续作）。
 */
export function timeoutWatchArtifactPaths(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
): string[] {
  const out: string[] = [];
  const toRel = (abs: string): string => path.relative(projectRoot, abs).replace(/\\/g, '/');
  for (const fileName of TIMEOUT_RESUMABLE_ARTIFACT_BY_PHASE[phase] ?? []) {
    try {
      out.push(toRel(featureArtifactPath(projectRoot, feature, fileName)));
    } catch {
      /* 路径解析失败不阻断主流程 */
    }
  }
  try {
    out.push(toRel(path.join(receiptDirPath(projectRoot, feature, phase), 'context-exploration.md')));
  } catch {
    /* ignore */
  }
  return out;
}

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

/**
 * visual_gap 重试指导文案（P0-2·round6 收尾批：抽常量供单测断言——纯文案 nudge 的效力靠
 * 内容明确性，弃判禁令必须在场；硬 backstop 见 visual_diff_verdict_abandonment）。
 * 实锤背景：终局 run agent 以"headless 无法闭环"为由把确定性 fail_signals 在手的屏
 * 全留 pending，白烧 3 次 testing 重试而不回修。
 */
export const VISUAL_GAP_RETRY_GUIDANCE: readonly string[] = [
  '**This is a visual-fidelity gap (the rendered UI does not match the reference).** To make real progress:',
  '1. Read the SPECIFIC must_fix / layout-divergence regions / out-of-bounds elements in the BLOCKER evidence and fix exactly those;',
  '2. Deterministic fail_signals (text-placement divergence) mean the screen IS decidable headlessly: you MUST set that screen verdict=fail, copy the signals into screens[].must_fix, fix the code in THIS retry, and re-capture — do NOT leave such screens pending ("unattended cannot close the loop" is only true for PASS candidates awaiting human confirmed_by);',
  '3. Do NOT blindly move or restructure unrelated blocks hoping the score improves — a prior attempt did that (moved the card-pack description) and made it worse;',
  '4. If the same set of visual gates keeps failing with no change, the run will HALT for human review rather than spinning.',
];

/** 参考图 OCR 预扫描输出文件名 slug——core 不可 import profiles/hmos-app 的
 * sanitizeVisualDiffScreenSlug（层级边界），故本地重写。与 profile 版刻意不同：保留 CJK
 * 字符（宿主复验实证：中文参考图名"1-银行卡添卡首页"被清成匿名的"1-"后，8 张图变成
 * 1-/2-/…的编号盲盒，盲 agent 只能靠猜对应哪屏——ClaudeCode 案 7 条 authoritative_refs
 * 里 5 条接线错误的直接诱因。CJK 在现代文件系统均合法，无需替换）。 */
function sanitizeOcrPrescanSlug(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9_一-鿿-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return slug || 'screen';
}

/**
 * 宿主复验修复①：plan/coding 阶段不重跑 OCR（spec 是唯一生产者），但要把 spec 阶段已产出的
 * ocr.json 列给 agent——此前 coding 阶段 ocrJsonPaths 恒为空数组，能力块落入 else 分支打出
 * "no reference images were found"，8 份 ocr.json 明明在盘上却对 agent 说没有（宿主两环境
 * coding prompt 均实测命中此假话文案）。
 */
function listExistingOcrPrescanOutputs(
  projectRoot: string,
  frameworkRoot: string,
  feature: string,
): string[] {
  const ocrDirAbs = path.join(featurePhaseReportsDir(projectRoot, feature, 'spec', frameworkRoot), 'ocr');
  try {
    if (!fs.existsSync(ocrDirAbs)) return [];
    return fs
      .readdirSync(ocrDirAbs)
      .filter((f) => f.endsWith('.ocr.json'))
      .map((f) => path.relative(projectRoot, path.join(ocrDirAbs, f)).replace(/\\/g, '/'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * E0③（E6-min）：无视觉能力且 OCR 可用时，对 discoverReferenceImagesForOcrPrescan 找到的
 * 参考图逐张跑 OCR，落 `spec/reports/ocr/<screen>.ocr.json`（幂等——已存在则跳过，OCR 有
 * 耗时，重试不重复扫）。返回写入的 project-relative 路径，供 phase prompt 引用；
 * 无图源/OCR 不可用返回空数组（不阻塞、不造假分母）。
 */
function runOcrPrescanForSpec(
  projectRoot: string,
  frameworkRoot: string,
  resolvedProfile: HarnessResolvedProfile,
  manifest: GoalManifest,
  toolkit: NonNullable<ReturnType<typeof loadProfileOcrToolkit>>,
): string[] {
  const images = discoverReferenceImagesForOcrPrescan(projectRoot, manifest.feature, manifest.requirement);
  if (images.length === 0) return [];
  const ocrDirAbs = path.join(
    featurePhaseReportsDir(projectRoot, manifest.feature, 'spec', frameworkRoot),
    'ocr',
  );
  fs.mkdirSync(ocrDirAbs, { recursive: true });
  const usedSlugs = new Set<string>();
  const writtenRel: string[] = [];
  for (const imgAbs of images) {
    const base = sanitizeOcrPrescanSlug(path.basename(imgAbs, path.extname(imgAbs)));
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}_${n++}`;
    usedSlugs.add(slug);
    const outAbs = path.join(ocrDirAbs, `${slug}.ocr.json`);
    const rel = path.relative(projectRoot, outAbs).replace(/\\/g, '/');
    if (fs.existsSync(outAbs)) {
      writtenRel.push(rel);
      continue;
    }
    try {
      const result = toolkit.ocrImageWords(imgAbs);
      // E6①②：若 profile 实现了聚类/噪声过滤/候选提取（同源于 capture_completeness_external
      // 门禁的同一份函数），把 words 加工成聚类后的 lines 一并写入——agent 看到的是与门禁
      // 判定同一套切分结果的结构化行（含候选真文本+列分组提示），不必自己从原始词框重新聚类，
      // 也不会"agent 按一种方式分行、门禁按另一种方式判定"。profile 未实现这些扩展时
      // （ProfileOcrToolkit 的 E6 字段均可选）优雅降级为只写原始 words，不阻断。
      const rawWords = result.words ?? [];
      const clustered = toolkit.clusterOcrLines?.(rawWords);
      const audited = clustered && toolkit.collectAuditableOcrLines
        ? toolkit.collectAuditableOcrLines(clustered)
        : clustered;
      const lines = audited?.map((line) => {
        const candidate = toolkit.extractLikelyRealTextRun?.(line.text);
        const columnGroups = toolkit.detectColumnGroups?.(line);
        return {
          text: line.text,
          y: Number((line.box[1] + line.box[3] / 2).toFixed(4)),
          ...(candidate ? { candidate_text: candidate.candidate } : {}),
          ...(columnGroups && columnGroups.length > 1 ? { column_groups: columnGroups } : {}),
        };
      });
      // source_image：回指原参考图（project-relative）。宿主复验实证：没有这个字段时
      // 盲 agent 无法确定性对应"哪个 ocr.json 是哪张图/哪个屏"，只能靠文件名猜。
      const sourceImageRel = path.relative(projectRoot, imgAbs).replace(/\\/g, '/');
      const enriched = { ...result, source_image: sourceImageRel, ...(lines ? { lines } : {}) };
      fs.writeFileSync(outAbs, JSON.stringify(enriched, null, 2), 'utf-8');
      writtenRel.push(rel);
    } catch {
      /* 单图 OCR 失败不阻断其余——best-effort 上下文，非门禁产物 */
    }
  }
  return writtenRel;
}

/**
 * E0：UI 需求 spec/plan/coding phase 的能力感知计算——返回 null 表示非 UI 相关或非目标 phase，
 * 调用方不注入能力块。impure（探测 adapter/profile/spec.md、跑 OCR 预扫描）；
 * buildPhasePrompt/buildCapabilityBlock/buildUnattendedExecutionBlock 只读其结果，保持纯函数。
 * 宿主复验修复②：原范围只有 spec/coding，plan phase advisory=null 导致 unattended 块落回
 * 旧 pixel_1to1 人签措辞——盲档 run 的 plan prompt 里出现与实际档位自相矛盾的指令
 * （Chrys 案 plan prompt 实测命中），故扩到 plan。
 */
export function resolvePhaseCapabilityAdvisory(
  manifest: GoalManifest,
  projectRoot: string,
  frameworkRoot: string,
  resolvedProfile: HarnessResolvedProfile,
  phase: FeaturePhase,
): CapabilityAdvisory | null {
  if (phase !== 'spec' && phase !== 'plan' && phase !== 'coding') return null;

  // spec.md 存在（coding 阶段必然存在；spec 阶段重试时也可能已存在）→ 读真实声明（更权威）；
  // 否则（spec 阶段首次 invoke）退回需求文本启发式（宽松 UI 相关性 + 1:1 强意图探测）。
  const specMd = loadSpecMarkdown(projectRoot, manifest.feature);
  let isUiRelevant: boolean;
  let desired: FidelityTarget;
  if (specMd) {
    const uiChange = parseUiChangeFromSpecMarkdown(specMd);
    isUiRelevant = uiChange !== null && UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange);
    desired = parseFidelityTargetFromHandoffDoc(parseVisualHandoffYamlRoot(specMd));
  } else {
    // t6：意图检测在解引用后的合并文本上做——manifest 摘要只写 SSOT 路径+弱措辞而
    // 原始需求.md「完全参考」×7 是强信号（bc-openCard 事故原形）。
    const deref = dereferenceRequirementDocs(projectRoot, manifest.requirement);
    isUiRelevant = detectUiRelevantRequirement(deref.combined);
    desired = detectPixel1to1Intent(deref.combined) ? 'pixel_1to1' : 'semantic_layout';
  }
  if (!isUiRelevant) return null;

  const mmProbe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, manifest.adapter);
  const toolkit = loadProfileOcrToolkit(resolvedProfile.profileDir);
  // E1：金丝雀 verdict=ocr_capable 是补充信号（agent 自身展示了从图片提取文字的能力，即便
  // 判定其无视觉）——OR 进 ocrAvailable，不替代框架自身 OCR 环境探测（后者更可靠/确定性）。
  // cursor review（E6 后）：与 harness-runner.ts 门禁钳制共用同一口径，不再各算一遍。
  const ocrAvailable = resolveOcrAvailableForRun(projectRoot, resolvedProfile.profileDir, manifest.adapter);
  // visual-capability-truth S3：hasVision = meet(adapter/allowed_tools 探测, 三轴 effective_policy)
  // ——反证器降级 blind-safe 后，后续 phase（spec retry/plan/coding）的能力块与钳制同步转盲，
  // 消费面统一走 resolveEffectiveVisionContext（不再各读 local/canary 自行判级）。
  let policyVisual: boolean;
  try {
    // 四轮 review P1：ui-spec 在场时算当前 hash 传 meet；文件在但 hash 不可算 → 恒盲
    let policyArtifactHashes: string[] | undefined;
    const uiSpecAbsForPolicy = uiSpecAbsPath(projectRoot, manifest.feature);
    if (fs.existsSync(uiSpecAbsForPolicy)) {
      const h = sha256FileFull(uiSpecAbsForPolicy);
      if (!h) throw new Error('ui-spec 存在但 hash 不可算——fail-closed blind_safe');
      policyArtifactHashes = [h];
    }
    const vctx = resolveEffectiveVisionContext({
      projectRoot,
      feature: manifest.feature,
      runId: manifest.run_id,
      phase,
      adapter: manifest.adapter,
      frameworkRoot,
      // 四轮 review P1：ui-spec 已存在时以当前 hash 参与 meet——unverified 产物（含
      // unverified_clean）不再因"无独立降级行"漏出 visual（prompt 注入面同源收口）。
      ...(policyArtifactHashes ? { artifactHashes: policyArtifactHashes } : {}),
    });
    policyVisual =
      vctx.effective_policy.mode === 'visual' &&
      (vctx.vision_capability.verdict === 'tool_read' || vctx.vision_capability.verdict === 'native');
  } catch (e) {
    // codex 实施 review P0-1d：解析异常 fail-closed 默认盲（异常时默认 visual 会让
    // 非多模态模型重新进视觉链路——正是本 plan 要根治的 fail-open 形态）
    policyVisual = false;
    console.warn(`[S3] vision context 解析异常 → fail-closed blind_safe：${(e as Error).message}`);
  }
  const hasVision = mmProbe.supported && policyVisual;
  const clamp = clampFidelityByCapability(desired, { hasVision, ocrAvailable });

  // spec 是 OCR 预扫描的唯一生产者（有真实 OCR 耗时）；plan/coding 只列出盘上已有的产物
  // （宿主复验修复①——此前 plan/coding 恒为空数组，能力块对 agent 谎称"没找到参考图"）。
  const ocrJsonPaths = !hasVision && ocrAvailable
    ? phase === 'spec' && toolkit
      ? runOcrPrescanForSpec(projectRoot, frameworkRoot, resolvedProfile, manifest, toolkit)
      : listExistingOcrPrescanOutputs(projectRoot, frameworkRoot, manifest.feature)
    : [];

  return {
    hasVision,
    ocrAvailable,
    effectiveFidelity: clamp.effective,
    fidelityClamped: clamp.clamped,
    ocrJsonPaths,
  };
}

// ---------------------------------------------------------------------------
// visual-capability-truth S4：回退状态机纯函数（导出单测）
// ---------------------------------------------------------------------------

/** run_start 冻结 manifest hash：首个 run_start 事件的值优先（resume 不换锚），否则当前计算值。 */
export function resolveFrozenManifestHash(
  priorEvents: ReadonlyArray<{ type?: string; manifest_hash?: unknown }>,
  currentHash: string | null,
): string | null {
  for (const e of priorEvents) {
    if (e.type === 'run_start' && typeof e.manifest_hash === 'string' && e.manifest_hash) {
      return e.manifest_hash;
    }
  }
  return currentHash;
}

/**
 * resume 起点的 invalidation 过滤：phase_invalidated 事件之后（事件序）没有该 phase 新的
 * PASS phase_verdict → 该 phase 的旧 outcome 剔除、resume 起点回退到链上最早被剔除位。
 */
export function applyInvalidationsToResume(
  chain: readonly FeaturePhase[],
  outcomes: GoalPhaseOutcome[],
  events: ReadonlyArray<{ type?: string; phase?: string; verdict?: string }>,
): { outcomes: GoalPhaseOutcome[]; startIndex: number } {
  const stillInvalidated = new Set<string>();
  events.forEach((e, idx) => {
    if (e.type !== 'phase_invalidated' || typeof e.phase !== 'string') return;
    const revalidated = events
      .slice(idx + 1)
      .some(later => later.type === 'phase_verdict' && later.phase === e.phase && later.verdict === 'PASS');
    if (!revalidated) stillInvalidated.add(e.phase);
  });
  if (stillInvalidated.size === 0) return { outcomes, startIndex: chain.length };
  const filtered = outcomes.filter(o => !stillInvalidated.has(o.phase));
  const earliest = Math.min(
    ...[...stillInvalidated].map(p => chain.indexOf(p as FeaturePhase)).filter(i => i >= 0),
  );
  return { outcomes: filtered, startIndex: earliest };
}

// ---------------------------------------------------------------------------
// 四轮 review P0：vision 账本（attestations/downgrades）runner 控制边界——
// 行级 hash 链（effective-vision-context 写读两端）只保证 append-only 完整性；
// **写入者真实性**由此处保证：agent invoke 前快照两账本 sha256（并落 anchor 事件），
// invoke 结束后比对——agent 调用窗口内任何账本变更 = 篡改，phase 即刻 halt；
// resume 时先对当前账本与本 run 最后一条 anchor 比对（runner 停机窗口的篡改在续跑前拦截）。
// 合法写入只发生在 runner 编排的 gate harness 窗口（invoke 括号之外）。
// ---------------------------------------------------------------------------

export interface VisionLedgerSnapshot {
  file: string;
  sha256: string;
}

export function snapshotVisionLedgers(projectRoot: string, feature: string): VisionLedgerSnapshot[] {
  return [
    { file: 'artifact-attestations.jsonl', abs: artifactAttestationsPath(projectRoot, feature) },
    { file: 'policy-downgrades.jsonl', abs: policyDowngradesPath(projectRoot, feature) },
  ].map(l => ({ file: l.file, sha256: sha256FileFull(l.abs) ?? 'absent' }));
}

/** 返回快照间发生变更的账本文件名（空=未动）。 */
export function diffVisionLedgerSnapshots(
  before: readonly VisionLedgerSnapshot[],
  after: readonly VisionLedgerSnapshot[],
): string[] {
  return after
    .filter(a => before.find(b => b.file === a.file)?.sha256 !== a.sha256)
    .map(a => a.file);
}

// 五/六轮 review P0-2：resume 校验的真实性锚——events.jsonl 是 agent 可写文件，"最后一条
// anchor 事件"可与账本同时被伪造。checkpoint：
//   - 位置在 agent workspace 之外（用户主目录；env MAISON_GOAL_CHECKPOINT_DIR 覆盖，且该
//     env 已从 agent 子进程剥离——stripTrustAnchorEnv）。诚实边界：主目录并非 OS 级不可写
//     （Claude 等 adapter 有 Bash），位置只是防误碰；
//   - **writer authenticity 由 HMAC 承载**（MAISON_HMAC_GOAL_CHECKPOINT，沿用 MAISON_HMAC_
//     前缀模型——agent-invoke 恒剥离该前缀，密钥对 agent 不可读）：部署配置密钥后
//     缺 MAC/MAC 失配/损坏一律 invalid → fail-closed halt；未配密钥时如实降级为
//     ok_unauthenticated（显式事件，不冒充强信任）；
//   - namespace 绑定 project identity hash + feature + runId（六轮 P1：秒级 runId 跨工程
//     碰撞会互相覆盖/误报）；payload 另绑 manifest_hash；写入 tmp+rename 原子替换。
// 状态分立（六轮 P0-2）：absent（须显式 --ack-unverified-ledgers 才可弱信任续跑）/
// invalid（损坏/验签失败/身份失配——fail-closed 无旁路）/ mismatch / ok / ok_unauthenticated。

export const VISION_CHECKPOINT_HMAC_ENV = 'MAISON_HMAC_GOAL_CHECKPOINT';

function projectIdentityHash(projectRoot: string): string {
  return createHash('sha256')
    .update(path.resolve(projectRoot).replace(/\\/g, '/').toLowerCase(), 'utf-8')
    .digest('hex')
    .slice(0, 8);
}

function visionTrustDir(): string {
  const dirOverride = process.env.MAISON_GOAL_CHECKPOINT_DIR?.trim();
  return dirOverride
    ? path.resolve(dirOverride)
    : path.join(os.homedir(), '.maison', 'goal-checkpoints');
}

export function visionCheckpointPath(projectRoot: string, feature: string, runId: string): string {
  const safeFeature = feature.replace(/[^\w.-]/g, '_');
  return path.join(visionTrustDir(), projectIdentityHash(projectRoot), safeFeature, `${runId}.json`);
}

/** 七轮 P0-2：授权子集规范化哈希——manifest 全文件 hash 会被 runner 运行中合法写回改变，
 * 授权提升攻击面只在 pre_authorized_mutations；对该子集做 stableStringify 哈希绑定。 */
export function computeAuthSubsetSha256(preAuthorizedMutations: unknown): string {
  return createHash('sha256')
    .update(stableStringify(preAuthorizedMutations ?? []), 'utf-8')
    .digest('hex');
}

function visionMac(body: object): string | null {
  const key = process.env[VISION_CHECKPOINT_HMAC_ENV];
  if (!key) return null;
  return createHmac('sha256', key).update(JSON.stringify(body), 'utf-8').digest('hex');
}

function visionMacValid(body: object, mac: unknown): 'ok' | 'ok_unauthenticated' | 'invalid' {
  const key = process.env[VISION_CHECKPOINT_HMAC_ENV];
  if (key) {
    const expect = createHmac('sha256', key).update(JSON.stringify(body), 'utf-8').digest('hex');
    if (typeof mac !== 'string' || mac.length !== expect.length ||
        !timingSafeEqual(Buffer.from(mac, 'utf-8'), Buffer.from(expect, 'utf-8'))) {
      return 'invalid';
    }
    return 'ok';
  }
  return mac ? 'invalid' : 'ok_unauthenticated';
}

interface VisionCheckpointDoc {
  /** 1.2（十三轮 P1-3）：manifest_identity_fields 升为必填（缺失=invalid）。
   * 1.1=legacy：无逐字段身份（或旧全文件/聚合 hash 时代产物）——**不得静默当新基线**：
   * 聚合 hash 与当前身份哈希相等才允许一次性迁移，不等须显式 --override-manifest。 */
  schema_version: '1.1' | '1.2';
  run_id: string;
  project_root_hash: string;
  feature: string;
  manifest_hash: string | null;
  /** 十二轮 P0-a：authenticated checkpoint 是 rebase 冻结基线 SSOT（events 仅审计投影）——
   * 存逐字段身份，resume 时以此为可信旧基线做字段级 drift 授权。1.2 起必填。 */
  manifest_identity_fields?: Record<string, string>;
  /** 七轮 P0-2：pre_authorized_mutations 规范化哈希（resume 时与当前 manifest 比对——运行中扩权即 invalid） */
  auth_subset_sha256?: string;
  /** 七轮 P0-3：per-run checkpoint 引用 feature head 世代（head 才是跨 run 连续性锚） */
  head_generation?: number;
  updated_at: string;
  files: VisionLedgerSnapshot[];
  migrations?: unknown[];
  mac: string | null;
}

export function writeVisionCheckpoint(args: {
  projectRoot: string;
  feature: string;
  runId: string;
  manifestHash: string | null;
  files: readonly VisionLedgerSnapshot[];
  /** 十三轮 P1-3：1.2 起必填——checkpoint 是 drift 基线 SSOT，缺逐字段身份即 invalid */
  manifestIdentityFields: Record<string, string>;
  authSubsetSha256?: string;
  headGeneration?: number;
  migrations?: unknown[];
}): string {
  const p = visionCheckpointPath(args.projectRoot, args.feature, args.runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 八轮 P1-1：**不从磁盘继承** migrations——磁盘旧文件是 agent 可及面（删除/伪造后 runner
  // 重签即洗白）。migrations 由调用方（runner 内存可信态）作为权威全量传入。
  const mergedMigrations = [...(args.migrations ?? [])];
  const body: Omit<VisionCheckpointDoc, 'mac'> = {
    schema_version: '1.2',
    run_id: args.runId,
    project_root_hash: projectIdentityHash(args.projectRoot),
    feature: args.feature,
    manifest_hash: args.manifestHash,
    manifest_identity_fields: args.manifestIdentityFields,
    ...(args.authSubsetSha256 ? { auth_subset_sha256: args.authSubsetSha256 } : {}),
    ...(typeof args.headGeneration === 'number' ? { head_generation: args.headGeneration } : {}),
    updated_at: new Date().toISOString(),
    files: [...args.files],
    ...(mergedMigrations.length > 0 ? { migrations: mergedMigrations } : {}),
  };
  const doc: VisionCheckpointDoc = { ...body, mac: visionMac(body) };
  // 原子替换（六轮 P1：并发/中断不得留半份 checkpoint）
  const content = `${JSON.stringify(doc, null, 2)}\n`;
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);
  // 九轮 P1-2：返回写入后字节 digest（runner 存内存，下次覆盖前精确比对防重放）
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
}

export interface VisionCheckpointVerdict {
  state: 'ok' | 'ok_unauthenticated' | 'mismatch' | 'absent' | 'invalid';
  mismatched: string[];
  reason?: string;
  /** 八轮 P1-1：验真通过时带回 migrations（runner 收进内存可信态，写点不再读盘） */
  migrations?: unknown[];
}

export function verifyVisionCheckpoint(args: {
  projectRoot: string;
  feature: string;
  runId: string;
  current: readonly VisionLedgerSnapshot[];
  /** 九轮 P1-1：期望 head generation——per-run checkpoint 须与当前 feature head 世代咬合，
   * 防旧 checkpoint 与 head 脱节 */
  expectedHeadGeneration?: number;
}): VisionCheckpointVerdict {
  const p = visionCheckpointPath(args.projectRoot, args.feature, args.runId);
  if (!fs.existsSync(p)) return { state: 'absent', mismatched: [] };
  let doc: VisionCheckpointDoc;
  try {
    doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as VisionCheckpointDoc;
  } catch (e) {
    return { state: 'invalid', mismatched: [], reason: `checkpoint 损坏（JSON 解析失败：${(e as Error).message}）` };
  }
  if (
    (doc?.schema_version !== '1.1' && doc?.schema_version !== '1.2') ||
    doc.run_id !== args.runId ||
    doc.project_root_hash !== projectIdentityHash(args.projectRoot) ||
    doc.feature !== args.feature ||
    !Array.isArray(doc.files)
  ) {
    return { state: 'invalid', mismatched: [], reason: 'checkpoint 身份/形状失配（run/project/feature 绑定不符）' };
  }
  // 十三轮 P1-3：1.2 起逐字段身份必填——缺失即 invalid（1.1 legacy 交 drift 层显式迁移，不静默）
  if (doc.schema_version === '1.2' && !doc.manifest_identity_fields) {
    return { state: 'invalid', mismatched: [], reason: 'checkpoint 1.2 缺 manifest_identity_fields（必填）' };
  }
  const { mac, ...body } = doc;
  const macState = visionMacValid(body, mac);
  if (macState === 'invalid') {
    return {
      state: 'invalid', mismatched: [],
      reason: process.env[VISION_CHECKPOINT_HMAC_ENV]
        ? 'checkpoint MAC 验签失败（部署已配密钥——缺 MAC/失配一律拒）'
        : 'checkpoint 带 MAC 但当前部署无验证密钥——无法核实，fail-closed',
    };
  }
  // 十二轮 P0-a：manifest 身份/授权子集 drift **不在此处 force-equal**——rebase 后新 identity
  // 校验旧 checkpoint 必然 mismatch（自我判死）。checkpoint 是可信旧基线 SSOT：其 manifest_hash/
  // manifest_identity_fields/auth_subset 由 MAC 保护、由 readVisionCheckpointMeta 取出交调用方
  // 做字段级 drift 授权（override 授权后即成为新基线，本次 commit 写入新 identity）。
  // 配密钥后 auth_subset 字段仍须存在（结构完整性），但比对交 drift 授权层。
  if (process.env[VISION_CHECKPOINT_HMAC_ENV] && !doc.auth_subset_sha256) {
    return { state: 'invalid', mismatched: [], reason: 'checkpoint 缺 auth_subset_sha256（密钥部署下必填）' };
  }
  // 九轮 P1-1：head generation 咬合——旧 checkpoint 与当前 feature head 脱节即拒
  if (args.expectedHeadGeneration !== undefined && (doc.head_generation ?? -1) !== args.expectedHeadGeneration) {
    return {
      state: 'invalid', mismatched: [],
      reason: `checkpoint head_generation 与当前 feature head 脱节（${doc.head_generation ?? 'n/a'} ≠ ${args.expectedHeadGeneration}）`,
    };
  }
  const mismatched = diffVisionLedgerSnapshots(doc.files, args.current);
  if (mismatched.length > 0) return { state: 'mismatch', mismatched };
  const migrations = Array.isArray(doc.migrations) ? doc.migrations : [];
  return macState === 'ok'
    ? { state: 'ok', mismatched: [], migrations }
    : { state: 'ok_unauthenticated', mismatched: [], migrations };
}

/** 八/九轮 P1：checkpoint 覆盖前完整性 meta（MAC+身份 + **文件字节 digest**——九轮 P1-2：
 * runner 内存记住上次写入后的 digest，覆盖前精确比对，合法旧文件重放（身份+MAC 均过）
 * 因 digest 不符被拒；digest 供调用方存内存）。不比 files（账本可能已被 gate 合法推进）。 */
export function readVisionCheckpointMeta(args: {
  projectRoot: string;
  feature: string;
  runId: string;
}): {
  state: 'absent' | 'invalid' | 'valid' | 'valid_unauthenticated';
  digest?: string;
  manifestHash?: string | null;
  manifestIdentityFields?: Record<string, string>;
  /** 十三轮 P1-3：legacy=1.1 且无逐字段身份——不得静默当 drift 基线（聚合 hash 相等才
   * 允许一次性迁移，不等须显式 --override-manifest） */
  legacy?: boolean;
} {
  const p = visionCheckpointPath(args.projectRoot, args.feature, args.runId);
  if (!fs.existsSync(p)) return { state: 'absent' };
  try {
    const bytes = fs.readFileSync(p);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const doc = JSON.parse(bytes.toString('utf-8')) as VisionCheckpointDoc;
    if (
      (doc?.schema_version !== '1.1' && doc?.schema_version !== '1.2') ||
      doc.run_id !== args.runId ||
      doc.project_root_hash !== projectIdentityHash(args.projectRoot) ||
      doc.feature !== args.feature
    ) return { state: 'invalid', digest };
    if (doc.schema_version === '1.2' && !doc.manifest_identity_fields) return { state: 'invalid', digest };
    const { mac, ...body } = doc;
    const macState = visionMacValid(body, mac);
    if (macState === 'invalid') return { state: 'invalid', digest };
    // 十二轮 P0-a：MAC 验真后带回可信旧基线（manifest_hash + 逐字段身份）供 drift 授权
    return {
      state: macState === 'ok' ? 'valid' : 'valid_unauthenticated',
      digest,
      manifestHash: doc.manifest_hash ?? null,
      ...(doc.manifest_identity_fields ? { manifestIdentityFields: doc.manifest_identity_fields } : {}),
      legacy: !doc.manifest_identity_fields,
    };
  } catch {
    return { state: 'invalid' };
  }
}

/**
 * 十三轮 review P1-3：manifest 身份漂移决策（锁内、副作用前调用）——纯函数抽出供真路径测试。
 * 基线信任规则：
 *   - checkpoint absent/invalid → 无基线（交后续 vision 信任链 reseal/ack 处置），当前身份即 effective；
 *   - **legacy checkpoint（1.1 无逐字段身份）不得静默当新基线**：聚合 manifest_hash 与当前
 *     身份哈希相等 → 一次性 schema 迁移（本次 commit 写 1.2 全字段）；不等 → 须显式
 *     --override-manifest（无逐字段可 diff，只能整体确认），否则 halt——升级停机窗口的
 *     requirement/budget/allowed-tools 篡改不得借 schema 升级洗白；
 *   - valid_unauthenticated 基线照常比对（拦截未改 checkpoint 的天真篡改），但标记
 *     baselineUnauthenticated——调用方须走弱信任处置（resume ack + 终态封顶 + pre_run_manifest
 *     降级），**不得**将其视为可信 SSOT；
 *   - 字段级授权：changed ⊆ (override 旗标授权集 ∪ fidelity transition 验真授权集) 才 rebase。
 */
export function resolveManifestDriftDecision(args: {
  currentFields: Record<string, string>;
  currentHash: string;
  cpMeta: {
    state: 'absent' | 'invalid' | 'valid' | 'valid_unauthenticated';
    manifestHash?: string | null;
    manifestIdentityFields?: Record<string, string>;
    legacy?: boolean;
  };
  overrides: { 'override-manifest': boolean; 'override-start': boolean; 'override-end': boolean };
  fidelityTransitionFields: ReadonlySet<string>;
}): {
  currentFields: Record<string, string>;
  effectiveHash: string;
  rebaseApplied: boolean;
  rebaseAuthorizedBy: string | null;
  baselineUnauthenticated: boolean;
  legacyMigrated: boolean;
  halt: { message: string; changedFields: string[]; authorized: string[] | 'all' } | null;
} {
  const base = {
    currentFields: args.currentFields,
    effectiveHash: args.currentHash,
    rebaseApplied: false,
    rebaseAuthorizedBy: null as string | null,
    baselineUnauthenticated: false,
    legacyMigrated: false,
    halt: null as { message: string; changedFields: string[]; authorized: string[] | 'all' } | null,
  };
  const { cpMeta } = args;
  if (cpMeta.state === 'invalid' || cpMeta.state === 'absent') return base;
  const baselineUnauthenticated = cpMeta.state === 'valid_unauthenticated';
  if (cpMeta.legacy || !cpMeta.manifestIdentityFields) {
    if (cpMeta.manifestHash && cpMeta.manifestHash === args.currentHash) {
      // 聚合身份哈希相等=无漂移证据 → 一次性 schema 迁移（commit 写 1.2 全字段成新 SSOT）
      return { ...base, baselineUnauthenticated, legacyMigrated: true };
    }
    if (args.overrides['override-manifest']) {
      return { ...base, baselineUnauthenticated, rebaseApplied: true, rebaseAuthorizedBy: 'override-manifest' };
    }
    return {
      ...base,
      baselineUnauthenticated,
      halt: {
        message:
          'legacy checkpoint（无逐字段身份）聚合 hash 与当前 manifest 身份不符——升级停机窗口内 ' +
          'manifest 可能被改。无逐字段可 diff，须人工核对后以 --override-manifest 整体确认（fail-closed，' +
          '不静默 rebase）。',
        changedFields: ['<legacy_aggregate_mismatch>'],
        authorized: [],
      },
    };
  }
  const changed = diffManifestIdentityFields(cpMeta.manifestIdentityFields, args.currentFields);
  if (changed.length === 0) return { ...base, baselineUnauthenticated };
  const auth = overrideAuthorizedIdentityFields({
    'override-manifest': args.overrides['override-manifest'],
    'override-start': args.overrides['override-start'],
    'override-end': args.overrides['override-end'],
  });
  const authAll = auth === 'all';
  const authSet = authAll
    ? null
    : new Set<string>([...(auth as Set<string>), ...args.fidelityTransitionFields]);
  const authList = authAll ? ('all' as const) : [...authSet!].sort();
  const authorized = authAll || changed.every(f => authSet!.has(f));
  if (!authorized) {
    return {
      ...base,
      baselineUnauthenticated,
      halt: {
        message:
          `manifest 身份字段在停机窗口漂移且未被对应 override 授权（变更字段：${changed.join('、')}；` +
          `授权字段：${authAll ? 'all' : (authList as string[]).join('、') || '无'}）——resume 拒绝继续（fail-closed）。` +
          '合法变更：--override-manifest（整体）/ --override-start/--override-end（对应字段）/ ' +
          '--fidelity·--fidelity-receipt（档位，须过 transition 验真）。',
        changedFields: changed,
        authorized: authList,
      },
    };
  }
  return {
    ...base,
    baselineUnauthenticated,
    rebaseApplied: true,
    rebaseAuthorizedBy: authAll ? 'override-manifest' : [...(authSet ?? [])].sort().join(','),
  };
}

// ---------------------------------------------------------------------------
// 七轮 P0-3：feature 级 authenticated head——vision 账本是 feature 级共享文件，per-run
// checkpoint 只护同 run resume；跨 run 篡改（改完账本开新 run，runner 替攻击者重新签名
// baseline）须由 feature head 拦截：每次 fresh run/resume 先验 head，合法写点后单调
// generation 更新。head 与 checkpoint 同 MAC 模型。
// ---------------------------------------------------------------------------

export function visionFeatureHeadPath(projectRoot: string, feature: string): string {
  const safeFeature = feature.replace(/[^\w.-]/g, '_');
  return path.join(visionTrustDir(), 'vision-heads', projectIdentityHash(projectRoot), `${safeFeature}.json`);
}

interface VisionFeatureHeadDoc {
  /** 1.1（十三轮 P1-4）：新增 hwm_declared——head 声明 HWM 链已建立（MAC 保护）。
   * 1.0=legacy（HWM 机制落地前写出，缺声明）——用于区分"legacy 首建"与"HWM 被删除"。 */
  schema_version: '1.0' | '1.1';
  project_root_hash: string;
  feature: string;
  generation: number;
  files: VisionLedgerSnapshot[];
  last_run_id: string;
  updated_at: string;
  /** 1.1 写入恒 true：本 head 之后必须存在世代 ≥ generation 的 HWM 链——
   * head ok + HWM absent + 此声明 = 删除/丢失（fail-closed），不再静默重建新链洗白。 */
  hwm_declared?: true;
  mac: string | null;
}

export function writeVisionFeatureHead(args: {
  projectRoot: string;
  feature: string;
  runId: string;
  files: readonly VisionLedgerSnapshot[];
  /** 八轮 P1-1：要写入的世代——由调用方（runner 内存可信态）显式给出，**不读盘旧值**
   * （磁盘旧 head 是 agent 可及面，读盘续世代=为篡改/重置后的文件重新签名）。 */
  generation: number;
}): { generation: number; digest: string } {
  const p = visionFeatureHeadPath(args.projectRoot, args.feature);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body: Omit<VisionFeatureHeadDoc, 'mac'> = {
    schema_version: '1.1',
    project_root_hash: projectIdentityHash(args.projectRoot),
    feature: args.feature,
    generation: args.generation,
    files: [...args.files],
    last_run_id: args.runId,
    updated_at: new Date().toISOString(),
    // 十三轮 P1-4：写 head 的同一 commit 必写同世代 HWM 行——声明进 MAC 保护面，
    // 之后 HWM absent 即删除/丢失（fail-closed），不可静默重建。
    hwm_declared: true,
  };
  const doc: VisionFeatureHeadDoc = { ...body, mac: visionMac(body) };
  const content = `${JSON.stringify(doc, null, 2)}\n`;
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);
  // 九轮 P1-2：返回 {generation, digest}——digest 供 runner 内存记住防重放
  return { generation: body.generation, digest: createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex') };
}

/** 八/九轮 P1：head 覆盖前完整性 meta（MAC+身份+世代 + 文件字节 digest，不比 files）。 */
export function readVisionFeatureHeadMeta(args: {
  projectRoot: string;
  feature: string;
}): { state: 'absent' | 'invalid' | 'valid' | 'valid_unauthenticated'; generation?: number; digest?: string } {
  const p = visionFeatureHeadPath(args.projectRoot, args.feature);
  if (!fs.existsSync(p)) return { state: 'absent' };
  try {
    const bytes = fs.readFileSync(p);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const doc = JSON.parse(bytes.toString('utf-8')) as VisionFeatureHeadDoc;
    if (
      (doc?.schema_version !== '1.0' && doc?.schema_version !== '1.1') ||
      doc.project_root_hash !== projectIdentityHash(args.projectRoot) ||
      doc.feature !== args.feature ||
      typeof doc.generation !== 'number'
    ) return { state: 'invalid', digest };
    const { mac, ...body } = doc;
    const macState = visionMacValid(body, mac);
    if (macState === 'invalid') return { state: 'invalid', digest };
    return {
      state: macState === 'ok' ? 'valid' : 'valid_unauthenticated',
      generation: doc.generation,
      digest,
    };
  } catch {
    return { state: 'invalid' };
  }
}

export interface VisionFeatureHeadVerdict {
  state: 'ok' | 'ok_unauthenticated' | 'mismatch' | 'absent' | 'invalid';
  mismatched: string[];
  reason?: string;
  generation?: number;
  /** 十三轮 P1-4：head 是否声明 HWM 链已建立（1.1 恒 true；legacy 1.0 无声明=false）——
   * 供 assessHwmFreshness 区分"legacy 首建"与"HWM 被删除"。 */
  hwmDeclared?: boolean;
}

// ---------------------------------------------------------------------------
// 十/十一轮 review：HWM high-water mark——head/checkpoint 的 MAC 只证真实性不证新鲜度。
// **诚实能力边界（十一轮 P0-1 修正上轮过度宣称）**：HWM 与 head/checkpoint 位于同一信任
// 目录、同一权限边界——能回放前三者的攻击者同样能把 HWM **尾部截断**到对应旧世代，因此
// HWM **不构成密码学跨重启 anti-rollback**。HWM 实际保证：检测**非协调回滚/意外损坏/
// 非尾部删改/链断**（MAC'd append-only 链，世代单调 + prev_row_hash）——重启后只回放
// head/checkpoint 而未同步截断 HWM 即被抓。真正的 hardened anti-rollback 需独立不可回卷锚
// （权限隔离 broker / 远端 append-only store / 可信单调计数器），列 tasks 3.9j pending。
// ---------------------------------------------------------------------------

export function visionHwmPath(projectRoot: string, feature: string): string {
  const safeFeature = feature.replace(/[^\w.-]/g, '_');
  return path.join(visionTrustDir(), 'vision-heads', projectIdentityHash(projectRoot), `${safeFeature}.hwm.jsonl`);
}

interface VisionHwmRow {
  seq: number;
  generation: number;
  head_digest: string;
  prev_row_hash: string | null;
  at: string;
  mac: string | null;
}

/** 读并验 HWM 链：返回高水位（最大合法世代 + 对应 head digest）。任何链断/MAC 失效 → invalid。 */
export function readVisionHwmHighWater(args: {
  projectRoot: string;
  feature: string;
}): { state: 'absent' | 'invalid' | 'ok' | 'ok_unauthenticated'; maxGeneration?: number; lastHeadDigest?: string; reason?: string } {
  const p = visionHwmPath(args.projectRoot, args.feature);
  if (!fs.existsSync(p)) return { state: 'absent' };
  const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { state: 'absent' };
  let expectSeq = 1;
  let prevHash: string | null = null;
  let last: VisionHwmRow | null = null;
  let unauthenticated = false;
  for (const line of lines) {
    let row: VisionHwmRow;
    try {
      row = JSON.parse(line) as VisionHwmRow;
    } catch {
      return { state: 'invalid', reason: 'HWM 行 JSON 解析失败' };
    }
    const { mac, ...body } = row;
    if (row.seq !== expectSeq || (row.prev_row_hash ?? null) !== prevHash || typeof row.head_digest !== 'string' || typeof row.generation !== 'number') {
      return { state: 'invalid', reason: 'HWM 链断裂/形状失配（非尾部删/插/乱序/改）' };
    }
    const macState = visionMacValid(body, mac);
    if (macState === 'invalid') return { state: 'invalid', reason: 'HWM 行 MAC 验签失败/无密钥核实' };
    if (macState === 'ok_unauthenticated') unauthenticated = true;
    // 单调世代（回滚/重排在链内即被抓）
    if (last && row.generation <= last.generation) {
      return { state: 'invalid', reason: `HWM 世代非单调（${last.generation} → ${row.generation}）` };
    }
    prevHash = createHash('sha256').update(JSON.stringify(row), 'utf-8').digest('hex').slice(0, 16);
    expectSeq += 1;
    last = row;
  }
  return {
    state: unauthenticated ? 'ok_unauthenticated' : 'ok',
    maxGeneration: last!.generation,
    lastHeadDigest: last!.head_digest,
  };
}

// 十二/十三轮 review P0-2：reseal 事务日志 v2——十三轮修复三个不可恢复崩溃点：
// ① rename 后、quarantined 落盘前崩溃：v1 journal 仍是 prepared 且无备份路径可寻——v2 在
//    **rename 前**把 planned_bak + 旧三锚 hash + receipt 绑定全部写进 prepared（MAC 保护）；
// ② quarantined 后、head/checkpoint 重写前崩溃：v1 只设 resealTx.pending，但 head invalid
//    分支仍要 resealStrong，而旧 receipt 因 canonical HWM 变 absent 失配 → 死锁——v2 启动
//    **先恢复**：canonical 缺失 → 把备份 rename 回去（复验绑定 sha），原 receipt 复用可行；
// ③ 重入 transactionalQuarantineHwm 会把未完成 journal 覆盖为 prepared 破坏现场——v2 存在
//    非终态 journal 即抛（恢复必须先行，禁止覆盖）。
// 状态机：prepared → quarantined → committed | rolled_back；恢复按**内容**判别
// （canonical sha 是否等于事务绑定的旧链 sha），不只按状态旗标。
export function visionResealJournalPath(projectRoot: string, feature: string): string {
  const safeFeature = feature.replace(/[^\w.-]/g, '_');
  return path.join(visionTrustDir(), 'vision-heads', projectIdentityHash(projectRoot), `${safeFeature}.reseal.json`);
}

interface VisionResealJournal {
  schema_version: '2.0';
  run_id: string;
  state: 'prepared' | 'quarantined' | 'committed' | 'rolled_back';
  old_hwm_sha256: string;
  /** 十三轮：事务绑定旧三锚 + 授权 receipt 的 object_hash（审计+恢复语境） */
  old_head_sha256: string;
  old_checkpoint_sha256: string;
  receipt_object_hash: string;
  /** prepared 时（rename 前）即记录的计划备份名——崩溃后可定位已改名文件 */
  planned_bak: string | null;
  quarantined_as: string | null;
  /** 十四轮 P0：三锚事务——head/checkpoint 在 quarantine 时同步 copy 备份（'absent'=当时
   * 不存在，回滚语义=删除新写文件恢复缺位）。回滚须三锚全部复验等于旧 sha 才 rolled_back，
   * 否则 head/checkpoint 已换新 key 而只回滚 HWM = 三锚混合态，原 receipt 永失配。 */
  planned_head_bak: string | null;
  planned_checkpoint_bak: string | null;
  at: string;
  mac: string | null;
}

function writeResealJournal(projectRoot: string, feature: string, j: Omit<VisionResealJournal, 'mac'>): void {
  const p = visionResealJournalPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const doc: VisionResealJournal = { ...j, mac: visionMac(j) };
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, p);
}

export function readResealJournal(projectRoot: string, feature: string):
  | { verdict: 'absent' }
  | { verdict: 'invalid'; reason: string }
  | { verdict: 'ok' | 'ok_unauthenticated'; journal: VisionResealJournal } {
  const p = visionResealJournalPath(projectRoot, feature);
  if (!fs.existsSync(p)) return { verdict: 'absent' };
  let doc: VisionResealJournal;
  try {
    doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as VisionResealJournal;
  } catch (e) {
    return { verdict: 'invalid', reason: `reseal journal 损坏（${(e as Error).message}）` };
  }
  if (doc?.schema_version !== '2.0' || typeof doc.run_id !== 'string' ||
      !['prepared', 'quarantined', 'committed', 'rolled_back'].includes(doc.state)) {
    return { verdict: 'invalid', reason: 'reseal journal 形状/版本失配（v1 遗留须人工处置）' };
  }
  const { mac, ...body } = doc;
  const macState = visionMacValid(body, mac);
  if (macState === 'invalid') return { verdict: 'invalid', reason: 'reseal journal MAC 验签失败' };
  return { verdict: macState === 'ok' ? 'ok' : 'ok_unauthenticated', journal: doc };
}

/** 事务化 quarantine 旧 HWM + **三锚备份**（十四轮 P0）。前置：非终态 journal 在场即抛
 * （启动恢复必须先行，禁止覆盖）。顺序：copy 备份 head/checkpoint（copy 后 sha 复验）→
 * prepared（含 planned_bak/planned_head_bak/planned_checkpoint_bak+全绑定）→ rename →
 * quarantined；任一步失败即抛（fail-closed）。返回 HWM 备份文件名（无旧 HWM=null）。 */
export function transactionalQuarantineHwm(args: {
  projectRoot: string;
  feature: string;
  runId: string;
  oldHwmSha256: string;
  oldHeadSha256: string;
  oldCheckpointSha256: string;
  receiptObjectHash: string;
}): string | null {
  const hp = visionHwmPath(args.projectRoot, args.feature);
  const headP = visionFeatureHeadPath(args.projectRoot, args.feature);
  const cpP = visionCheckpointPath(args.projectRoot, args.feature, args.runId);
  const existing = readResealJournal(args.projectRoot, args.feature);
  if (existing.verdict === 'invalid') {
    throw new Error(`reseal journal 不可信（${existing.reason}）——中止 reseal（fail-closed，人工处置）`);
  }
  if (existing.verdict !== 'absent' &&
      existing.journal.state !== 'committed' && existing.journal.state !== 'rolled_back') {
    throw new Error(
      `存在未完成的 reseal 事务（state=${existing.journal.state}, run=${existing.journal.run_id}）——` +
      '启动恢复（recoverResealTransaction）必须先行，禁止覆盖现场（fail-closed）',
    );
  }
  const suffix = `rekey-${args.runId}-${process.pid}.bak`;
  // 十四轮 P0：head/checkpoint 先 copy 备份（后续 commitVisionAnchors 会用新 key 重写它们；
  // 崩溃回滚须能把三锚**全部**恢复到旧字节，否则原 receipt 绑定永失配=三锚混合态死局）。
  const backupAnchor = (src: string, expectSha: string, label: string): string | null => {
    if (!fs.existsSync(src)) {
      if (expectSha !== 'absent') {
        throw new Error(`${label} 文件缺失但绑定 sha 非 absent（${expectSha.slice(0, 12)}…）——现场与绑定不符，中止 reseal`);
      }
      return null;
    }
    const bakName = `${path.basename(src)}.${suffix}`;
    const bakAbs = path.join(path.dirname(src), bakName);
    if (fs.existsSync(bakAbs)) throw new Error(`${label} 备份名冲突（${bakName}）——中止 reseal（fail-closed）`);
    fs.copyFileSync(src, bakAbs);
    const got = createHash('sha256').update(fs.readFileSync(bakAbs)).digest('hex');
    if (got !== expectSha) {
      throw new Error(`${label} 备份 sha 与绑定不符（copy 期间被改？）——中止 reseal（fail-closed）`);
    }
    return bakName;
  };
  const plannedHeadBak = backupAnchor(headP, args.oldHeadSha256, 'head');
  const plannedCheckpointBak = backupAnchor(cpP, args.oldCheckpointSha256, 'checkpoint');
  const plannedBak = fs.existsSync(hp) ? `${path.basename(hp)}.${suffix}` : null;
  const bind = {
    schema_version: '2.0' as const,
    run_id: args.runId,
    old_hwm_sha256: args.oldHwmSha256,
    old_head_sha256: args.oldHeadSha256,
    old_checkpoint_sha256: args.oldCheckpointSha256,
    receipt_object_hash: args.receiptObjectHash,
    planned_bak: plannedBak,
    planned_head_bak: plannedHeadBak,
    planned_checkpoint_bak: plannedCheckpointBak,
  };
  // prepared：**rename 前**落全部绑定（崩溃后凭 planned_* 定位/回滚）
  writeResealJournal(args.projectRoot, args.feature, {
    ...bind, state: 'prepared', quarantined_as: null, at: new Date().toISOString(),
  });
  if (!plannedBak) {
    // 无旧 HWM（首配密钥）——无需搬移，直接 quarantined（commit 延后到新链首写复验后）
    writeResealJournal(args.projectRoot, args.feature, {
      ...bind, state: 'quarantined', quarantined_as: null, at: new Date().toISOString(),
    });
    return null;
  }
  const bakAbs = path.join(path.dirname(hp), plannedBak);
  if (fs.existsSync(bakAbs)) {
    throw new Error(`HWM quarantine 备份名冲突（${plannedBak}）——中止 reseal（fail-closed）`);
  }
  fs.renameSync(hp, bakAbs); // 失败即抛（fail-closed，不 warn 继续）
  writeResealJournal(args.projectRoot, args.feature, {
    ...bind, state: 'quarantined', quarantined_as: plannedBak, at: new Date().toISOString(),
  });
  return plannedBak;
}

/** reseal 事务提交（新 HWM 首写后立即复验通过时调用）——保留事务绑定字段。 */
export function commitResealJournal(projectRoot: string, feature: string, runId: string): void {
  const r = readResealJournal(projectRoot, feature);
  if (r.verdict !== 'ok' && r.verdict !== 'ok_unauthenticated') {
    throw new Error('commitResealJournal：journal 缺失/不可信——事务状态被破坏（fail-closed）');
  }
  writeResealJournal(projectRoot, feature, {
    ...(({ mac: _m, ...rest }) => rest)(r.journal),
    run_id: runId, state: 'committed', at: new Date().toISOString(),
  });
}

/**
 * 十三/十四轮 review P0：启动期 reseal 事务恢复——在读取旧锚 hash/验 receipt **之前**运行。
 * 十四轮 P0：恢复覆盖**三个锚**（HWM+head+checkpoint）。commitVisionAnchors 顺序为
 * head→checkpoint→HWM：若在 head/checkpoint 已换新 key、HWM 首写前崩溃，只回滚 HWM =
 * 三锚混合态（原 receipt 绑旧 head/checkpoint 字节永失配、旧 key HWM 在新 key 下 invalid）。
 * 判别与处置（全按内容，不只按状态旗标）：
 *   - **完成判定**：canonical HWM 在场且 ≠ 旧链 sha（新链已首写）且新链+head 在当前 key 下
 *     可信 → 补记 committed（head/checkpoint 写于 HWM 之前，同 commit 内必已换新）；
 *   - **回滚**：其余情形——三锚各自与 journal 绑定旧 sha 比对，不符者从各自备份恢复
 *     （备份 sha 复验**先于**恢复；旧 sha='absent' 的锚=删除新写文件恢复缺位）；三锚全部
 *     复验等于旧 sha 后才标 rolled_back（原 receipt 复用可行）；任一锚无法恢复 → blocked。
 */
export function recoverResealTransaction(args: { projectRoot: string; feature: string }): {
  outcome: 'none' | 'rolled_back' | 'completed' | 'blocked';
  detail?: string;
} {
  const r = readResealJournal(args.projectRoot, args.feature);
  if (r.verdict === 'absent') return { outcome: 'none' };
  if (r.verdict === 'invalid') return { outcome: 'blocked', detail: r.reason };
  const j = r.journal;
  if (j.state === 'committed' || j.state === 'rolled_back') return { outcome: 'none' };
  const hp = visionHwmPath(args.projectRoot, args.feature);
  const headP = visionFeatureHeadPath(args.projectRoot, args.feature);
  const cpP = visionCheckpointPath(args.projectRoot, args.feature, j.run_id);
  const shaOf = (p: string): string =>
    fs.existsSync(p) ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent';
  const reMac = (state: 'rolled_back' | 'committed'): void => {
    writeResealJournal(args.projectRoot, args.feature, {
      ...(({ mac: _m, ...rest }) => rest)(j), state, at: new Date().toISOString(),
    });
  };
  // ---- 完成判定（十五轮 P1）：与正常启动**同一套门**——①verifyVisionFeatureHead（head
  // MAC+与当前账本快照一致）②verifyVisionCheckpoint（存在+MAC+files+head_generation 咬合）
  // ③assessHwmFreshness===proceed（HWM 与 head 世代/digest 精确等值）四项全过才 committed。
  // 任一不满足=不完整提交——**不 commit 也不 blocked**（提前 committed 会把事务打成终态、
  // 永久放弃回滚资格，本可用三份备份自动恢复的现场退化成人工处置/重签 receipt），落回下方
  // 三锚回滚，原 receipt 复用可行。----
  if (fs.existsSync(hp) && shaOf(hp) !== j.old_hwm_sha256) {
    const snap = snapshotVisionLedgers(args.projectRoot, args.feature);
    const head = verifyVisionFeatureHead({ projectRoot: args.projectRoot, feature: args.feature, current: snap });
    const headOk = head.state === 'ok' || head.state === 'ok_unauthenticated';
    const cpOk = headOk && (() => {
      const cp = verifyVisionCheckpoint({
        projectRoot: args.projectRoot, feature: args.feature, runId: j.run_id, current: snap,
        expectedHeadGeneration: head.generation ?? 0,
      });
      return cp.state === 'ok' || cp.state === 'ok_unauthenticated';
    })();
    const hwmFreshOk = headOk && (() => {
      const headMeta = readVisionFeatureHeadMeta({ projectRoot: args.projectRoot, feature: args.feature });
      return assessHwmFreshness({
        headGeneration: head.generation ?? 0,
        headDigest: headMeta.digest,
        hwmDeclared: head.hwmDeclared === true,
        hwm: readVisionHwmHighWater({ projectRoot: args.projectRoot, feature: args.feature }),
      }).action === 'proceed';
    })();
    if (headOk && cpOk && hwmFreshOk) {
      reMac('committed');
      return { outcome: 'completed', detail: '三锚整体一致（head/checkpoint/HWM+账本快照四门全过）——补记 commit' };
    }
    // 不完整提交 → 保留回滚资格，走下方三锚回滚
  }
  // ---- 回滚：三锚统一"比对→不符者从备份恢复→全量复验" ----
  const restoreAnchor = (
    target: string,
    oldSha: string,
    bakName: string | null,
    label: string,
  ): string | null => {
    if (shaOf(target) === oldSha) return null; // 该锚未被改动
    if (oldSha === 'absent') {
      // 原状=缺位：新写文件删除即恢复
      try { fs.rmSync(target, { force: true }); } catch { /* 下方全量复验兜底 */ }
      return null;
    }
    const bakAbs = bakName ? path.join(path.dirname(target), bakName) : null;
    if (!bakAbs || !fs.existsSync(bakAbs)) return `${label} 已被改动且备份缺失`;
    const bakSha = createHash('sha256').update(fs.readFileSync(bakAbs)).digest('hex');
    if (bakSha !== oldSha) return `${label} 备份内容与事务绑定 sha 不符（备份被篡改）`;
    // 复验通过才恢复（copy 保留备份供审计；target 可能存在→先删再 copy）
    fs.rmSync(target, { force: true });
    fs.copyFileSync(bakAbs, target);
    return null;
  };
  const failures = [
    restoreAnchor(hp, j.old_hwm_sha256, j.quarantined_as ?? j.planned_bak, 'HWM'),
    restoreAnchor(headP, j.old_head_sha256, j.planned_head_bak, 'head'),
    restoreAnchor(cpP, j.old_checkpoint_sha256, j.planned_checkpoint_bak, 'checkpoint'),
  ].filter((x): x is string => x !== null);
  if (failures.length > 0) {
    return { outcome: 'blocked', detail: `三锚回滚失败：${failures.join('；')}——人工处置` };
  }
  // 全量复验：三锚都必须等于事务绑定旧 sha 才算回滚完成（防"只回滚一部分"的混合态）
  const finalMismatch = [
    [shaOf(hp), j.old_hwm_sha256, 'HWM'],
    [shaOf(headP), j.old_head_sha256, 'head'],
    [shaOf(cpP), j.old_checkpoint_sha256, 'checkpoint'],
  ].filter(([got, want]) => got !== want).map(([, , label]) => label as string);
  if (finalMismatch.length > 0) {
    return { outcome: 'blocked', detail: `三锚回滚后复验不符（${finalMismatch.join('、')}）——人工处置` };
  }
  reMac('rolled_back');
  return {
    outcome: 'rolled_back',
    detail: '三锚已全部恢复到事务绑定旧状态——原 reseal receipt 复用可行',
  };
}

/** 追加一行 HWM（每合法写点调用）。返回本行世代（用于事件留痕）。 */
export function appendVisionHwm(args: {
  projectRoot: string;
  feature: string;
  generation: number;
  headDigest: string;
}): void {
  const p = visionHwmPath(args.projectRoot, args.feature);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 续链：读现有**合法**尾（invalid 则从空续——启动段已对 invalid 做 halt/reseal 决策）
  let seq = 1;
  let prevHash: string | null = null;
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(l => l.trim());
    if (lines.length > 0) {
      try {
        const lastRow = JSON.parse(lines[lines.length - 1]) as VisionHwmRow;
        if (typeof lastRow.seq === 'number') {
          seq = lastRow.seq + 1;
          prevHash = createHash('sha256').update(JSON.stringify(lastRow), 'utf-8').digest('hex').slice(0, 16);
        }
      } catch { /* 尾行损坏——从头续（读端会判 invalid） */ }
    }
  }
  const body: Omit<VisionHwmRow, 'mac'> = {
    seq,
    generation: args.generation,
    head_digest: args.headDigest,
    prev_row_hash: prevHash,
    at: new Date().toISOString(),
  };
  const row: VisionHwmRow = { ...body, mac: visionMac(body) };
  fs.appendFileSync(p, `${JSON.stringify(row)}\n`, 'utf-8');
}

export function verifyVisionFeatureHead(args: {
  projectRoot: string;
  feature: string;
  current: readonly VisionLedgerSnapshot[];
}): VisionFeatureHeadVerdict {
  const p = visionFeatureHeadPath(args.projectRoot, args.feature);
  if (!fs.existsSync(p)) return { state: 'absent', mismatched: [] };
  let doc: VisionFeatureHeadDoc;
  try {
    doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as VisionFeatureHeadDoc;
  } catch (e) {
    return { state: 'invalid', mismatched: [], reason: `feature head 损坏（${(e as Error).message}）` };
  }
  if (
    (doc?.schema_version !== '1.0' && doc?.schema_version !== '1.1') ||
    doc.project_root_hash !== projectIdentityHash(args.projectRoot) ||
    doc.feature !== args.feature ||
    !Array.isArray(doc.files) ||
    typeof doc.generation !== 'number'
  ) {
    return { state: 'invalid', mismatched: [], reason: 'feature head 身份/形状失配' };
  }
  const { mac, ...body } = doc;
  const macState = visionMacValid(body, mac);
  if (macState === 'invalid') {
    return { state: 'invalid', mismatched: [], reason: 'feature head MAC 验签失败/无密钥核实' };
  }
  const mismatched = diffVisionLedgerSnapshots(doc.files, args.current);
  if (mismatched.length > 0) return { state: 'mismatch', mismatched, generation: doc.generation };
  return {
    state: macState === 'ok' ? 'ok' : 'ok_unauthenticated',
    mismatched: [],
    generation: doc.generation,
    hwmDeclared: doc.hwm_declared === true,
  };
}

/**
 * 十三轮 review P1-4：HWM 新鲜度评估（head 已验真后调用）——**absent 不再被静默忽略**。
 * 事故面：删除整个 HWM 文件 → head=ok + hwm=absent → 启动零报错 → 首个 commit 从 seq=1
 * 重建新链 = HWM 丢失被洗成合法新链（比尾部截断更简单的洗白通道）。三分处置：
 *   - head 声明 hwm_declared（1.1）+ HWM absent → **fail-closed halt**（删除/丢失；恢复=reseal）；
 *   - legacy head（1.0 无声明）+ HWM absent → 一次性显式 bootstrap（事件留痕，下个 commit
 *     写 1.1 head + 首行 HWM 后进入声明态）；
 *   - head 与 HWM 双 absent 的真首建不经过本函数（head absent 分支另行处理）。
 * 纯函数（真路径可测），rollback 判定沿用十/十一轮语义与诚实边界（非密码学 anti-rollback）。
 */
export function assessHwmFreshness(args: {
  headGeneration: number;
  /** 当前盘上 head 字节 digest（readVisionFeatureHeadMeta().digest） */
  headDigest: string | undefined;
  hwmDeclared: boolean;
  hwm: { state: 'absent' | 'invalid' | 'ok' | 'ok_unauthenticated'; maxGeneration?: number; lastHeadDigest?: string; reason?: string };
}): { action: 'proceed' | 'bootstrap_legacy' | 'halt_hwm_missing' | 'halt_hwm_invalid' | 'halt_rollback' | 'halt_incomplete_commit'; reason?: string } {
  if (args.hwm.state === 'invalid') {
    return { action: 'halt_hwm_invalid', reason: args.hwm.reason ?? 'HWM 链不可信' };
  }
  if (args.hwm.state === 'absent') {
    if (args.hwmDeclared) {
      return {
        action: 'halt_hwm_missing',
        reason:
          `head（世代 ${args.headGeneration}）声明 HWM 链已建立，但 HWM 文件缺失——删除/丢失不可静默重建新链` +
          '（洗白通道）。人工核查后走 --reseal-receipt 重铸。',
      };
    }
    return { action: 'bootstrap_legacy', reason: 'legacy head（1.0 无 hwm_declared）+ HWM 缺失——一次性显式 bootstrap' };
  }
  if (typeof args.hwm.maxGeneration === 'number') {
    if (args.headGeneration < args.hwm.maxGeneration ||
        (args.headGeneration === args.hwm.maxGeneration && args.headDigest !== args.hwm.lastHeadDigest)) {
      return {
        action: 'halt_rollback',
        reason:
          `head 世代 ${args.headGeneration} < HWM 高水位 ${args.hwm.maxGeneration}，或同世代 digest 不符——` +
          '非协调回滚/损坏拦截',
      };
    }
    // 十四轮 P1：**双向严格等值**——head 超前（headGeneration > maxGeneration）不再放行。
    // 正常运行的崩溃窗口（head/checkpoint 已写、HWM 追加前崩）会留下此态；若放行，下个
    // commit 写 N+2 行（严格递增校验放过跳档）即把未完成提交洗成正常历史，违背 spec
    // "启动时 head 必须等于 HWM 高水位"。归类 incomplete_anchor_commit，fail-closed。
    if (args.headGeneration > args.hwm.maxGeneration) {
      return {
        action: 'halt_incomplete_commit',
        reason:
          `head 世代 ${args.headGeneration} > HWM 高水位 ${args.hwm.maxGeneration}——上次锚提交未完成` +
          '（incomplete_anchor_commit）或 HWM 被单独截断。不得继续执行（洗档拦截）；人工核查后走 --reseal-receipt 重铸。',
      };
    }
  }
  return { action: 'proceed' };
}

/** 七轮 P1-1（ack receipt 绑定对象）：vision_ledger_ack 的 object_hash 口径。 */
export function visionLedgerAckObjectHash(args: {
  projectRoot: string;
  feature: string;
  runId: string;
  files: readonly VisionLedgerSnapshot[];
}): string {
  return createHash('sha256')
    .update(stableStringify({
      project_root_hash: projectIdentityHash(args.projectRoot),
      feature: args.feature,
      run_id: args.runId,
      files: [...args.files],
    }), 'utf-8')
    .digest('hex');
}

/** 八/九轮（rekey/reseal 协议绑定对象）：vision_trust_reseal 的 object_hash 口径——
 * 绑当前双账本 hash + 旧 head/旧 checkpoint 字节 hash + **当前授权子集哈希 + frozen
 * manifest hash** + project/feature/run。九轮 P0-2：不绑授权面 → 真人签 reseal 后模型改
 * manifest 授权子集仍被 reseal 放行（授权升级旁路），故授权子集与冻结锚必须入签名对象。 */
export function visionTrustResealObjectHash(args: {
  projectRoot: string;
  feature: string;
  runId: string;
  files: readonly VisionLedgerSnapshot[];
  oldHeadSha256: string;
  authSubsetSha256: string;
  frozenManifestHash: string | null;
  oldCheckpointSha256: string;
  oldHwmSha256: string;
}): string {
  return createHash('sha256')
    .update(stableStringify({
      project_root_hash: projectIdentityHash(args.projectRoot),
      feature: args.feature,
      run_id: args.runId,
      files: [...args.files],
      old_head_sha256: args.oldHeadSha256,
      old_checkpoint_sha256: args.oldCheckpointSha256,
      old_hwm_sha256: args.oldHwmSha256,
      auth_subset_sha256: args.authSubsetSha256,
      frozen_manifest_hash: args.frozenManifestHash ?? null,
    }), 'utf-8')
    .digest('hex');
}

/** 七轮 P0-1：vision 信任封顶（导出单测）——UI 相关 run 在无 authenticated checkpoint
 * （未配 HMAC 密钥）或仅弱 ack（CLI 旗标非真人凭证）时不得产出 clean completion，
 * 封顶 AWAITING_HUMAN_REVIEW。非 UI run 不受影响。 */
export function capRunStatusForVisionTrust(
  status: string,
  opts: { uiRelevant: boolean; hmacKeyPresent: boolean; ackWeak: boolean },
): { status: string; capped: boolean; reason?: string } {
  if (status !== 'CHAIN_SLICE_COMPLETED' || !opts.uiRelevant) return { status, capped: false };
  if (!opts.hmacKeyPresent) {
    return { status: 'AWAITING_HUMAN_REVIEW', capped: true, reason: 'vision_checkpoint_unauthenticated' };
  }
  if (opts.ackWeak) {
    return { status: 'AWAITING_HUMAN_REVIEW', capped: true, reason: 'vision_ledger_ack_unattested' };
  }
  return { status, capped: false };
}

/** ut/testing 期 source drift 对账 + 授权分类（attestation 缺失=review 未闭环，归上游门禁管，此处不判）。 */
export function reconcileMutablePhaseSourceDrift(args: {
  projectRoot: string;
  manifest: GoalManifest;
  phase: FeaturePhase;
  frozenManifestHash: string | null;
}): DriftClassification {
  const att = loadReviewClosureAttestation(args.projectRoot, args.manifest.feature);
  if (!att) return { kind: 'no_drift' };
  const rec = reconcileSourceTreeAgainstAttestation(args.projectRoot, att);
  if (rec.ok) return { kind: 'no_drift' };
  const receipts = [
    ...loadMutationAuthorizations(args.projectRoot, args.manifest.report_dir),
    ...receiptsFromManifestEntries(
      args.manifest.pre_authorized_mutations,
      args.manifest.run_id,
      args.frozenManifestHash,
    ),
  ];
  return classifySourceDrift(
    { added: rec.added, modified: rec.modified, deleted: rec.deleted },
    receipts,
    {
      runId: args.manifest.run_id,
      frozenManifestHash: args.frozenManifestHash,
      // codex P0-4 硬化：phase 匹配 + source_inventory_before 锚定 + human 源文件绑定
      phase: String(args.phase),
      expectedInventoryHash: att.inventory.aggregate_sha256 ?? null,
      projectRoot: args.projectRoot,
      // codex 二轮 P0-3：human 源 confirmation receipt 的 feature 绑定语境
      feature: args.manifest.feature,
      // 十三轮 P1-3：runner 进程持 key（子进程已剥离）——无 key 部署下 pre_run_manifest
      // 整链（manifest 文件+run_start 冻结事件）在 agent 可写面，不构成机器可信授权。
      manifestIdentityAuthenticated: Boolean(process.env[VISION_CHECKPOINT_HMAC_ENV]),
    },
  );
}

/** 回退后 review 的增量重点复审块（seam 变更不豁免——注入重审焦点而非跳过）。 */
export function buildBacktrackReviewFocusBlock(files: string[]): string {
  if (files.length === 0) return '';
  return [
    '',
    '## Incremental re-review focus (post-backtrack — REQUIRED)',
    '',
    'This review runs after an authorized source mutation triggered a backtrack. The following files',
    'changed AFTER the previous review closure and MUST be re-reviewed with priority (seam/glue changes',
    'are NOT exempt — authorization only means the change may exist, not that it is correct):',
    ...files.slice(0, 30).map(f => `- ${f}`),
    '',
  ].join('\n');
}

export function buildPhasePrompt(
  manifest: GoalManifest,
  projectRoot: string,
  phase: FeaturePhase,
  frameworkRoot: string,
  deferredUpstream: Array<{ phase: FeaturePhase; reason: string }>,
  priorFailure?: string,
  priorFailureKind?: FailureKind,
  partialResumeArtifacts?: string[],
  resumeSkipLines?: string[],
  capabilityAdvisory?: CapabilityAdvisory | null,
  // P0-1（plan d9b4f7e2）：continuation 双维度——续作块由 cause 驱动（PASS+timeout 也出块、
  // 断流不再谎称 TIMED OUT、进程重启加磁盘为准注记），不再依赖 partial 清单非空。
  continuation?: { cause: ContinuationCause; process_resumed: boolean } | null,
  /** 本次 invoke 的有效超时（ms）——注入续作块让 agent 有预算感知（P0-4 起为钳制/升档后的值）。 */
  effectiveTimeoutMs?: number,
  /** 本 phase 此前 attempt 的累计消耗（plan P0-1.6"已耗时"，复审补）。 */
  phasePrior?: { attempts: number; elapsedMs: number },
): string {
  const skillAbs = path.join(frameworkRoot, PHASE_SKILL_REL[phase]);
  const parts = [
    `# Goal run phase: ${phase}`,
    '',
    `Feature: ${manifest.feature}`,
    manifest.requirement ? `Requirement:\n${manifest.requirement}` : '',
    '',
    formatDeferredUpstreamNotice(deferredUpstream),
    ...(capabilityAdvisory ? buildCapabilityBlock(capabilityAdvisory) : []),
    ...buildUnattendedExecutionBlock(manifest, phase, projectRoot, capabilityAdvisory ?? undefined),
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
  const hasArtifacts = !!partialResumeArtifacts && partialResumeArtifacts.length > 0;
  const hasSkipLines = !!resumeSkipLines && resumeSkipLines.length > 0;
  // P0-1 rev3/rev6：续作块由 continuation.cause 驱动（不再依赖 partial 清单非空——
  // PASS+timeout 且 partial 为空时"空清单"本身就是信息：产物在、receipt/closure 未完）。
  const interruptedCause =
    continuation &&
    (continuation.cause === 'agent_timeout' ||
      continuation.cause === 'transient_api_error' ||
      continuation.cause === 'unknown')
      ? continuation.cause
      : null;
  if (interruptedCause) {
    const header =
      interruptedCause === 'agent_timeout'
        ? '## Prior attempt TIMED OUT — resume from partial work (NOT a content failure)'
        : interruptedCause === 'transient_api_error'
          ? '## Prior attempt hit an API CONNECTION DROP — resume from partial work (NOT a content failure)'
          : '## Prior attempt was INTERRUPTED (process crash / unknown) — resume from partial work';
    const intro =
      interruptedCause === 'agent_timeout'
        ? 'The previous attempt of this phase was interrupted by a wall-clock timeout, not by a content/quality failure. **Re-read the partial work first and CONTINUE the unfinished parts — do NOT redo exploration/analysis from scratch.**'
        : interruptedCause === 'transient_api_error'
          ? 'The previous attempt of this phase was interrupted by a model-API connection drop, not by a content/quality failure. **Re-read the partial work first and CONTINUE the unfinished parts — do NOT redo exploration/analysis from scratch.**'
          : 'The previous attempt of this phase was interrupted before a verdict was recorded (runner/process crash or unknown). **Inspect the partial work on disk first and CONTINUE the unfinished parts — do NOT redo exploration/analysis from scratch.**';
    parts.push('', header, '', intro);
    if (hasArtifacts) {
      parts.push('', 'Already (partially) written to disk:', '', ...partialResumeArtifacts!.map(f => `- ${f}`));
    } else {
      parts.push(
        '',
        'No partial phase artifacts were detected as freshly written — the interruption likely hit before writing, or only the closure steps (harness re-run / verifier / receipt) were left unfinished. Check the phase artifact directory, then finish the closure steps.',
      );
    }
    if (hasSkipLines) {
      parts.push(...resumeSkipLines!);
    }
    if (continuation!.process_resumed) {
      parts.push(
        '',
        'The runner process was restarted (--resume): trust the on-disk state over any assumption about the prior session.',
      );
    }
    if (typeof effectiveTimeoutMs === 'number' && effectiveTimeoutMs > 0) {
      const elapsedNote =
        phasePrior && phasePrior.elapsedMs > 0
          ? ` This phase has already consumed ~${Math.max(1, Math.round(phasePrior.elapsedMs / 60000))} minutes across ${phasePrior.attempts} prior attempt(s).`
          : '';
      parts.push(
        '',
        `Time budget: ~${Math.max(1, Math.round(effectiveTimeoutMs / 60000))} minutes before this attempt is forcibly killed — prioritize finishing artifacts + receipt/closure over re-exploration.${elapsedNote}`,
      );
    }
    parts.push('', 'Resume where the prior attempt left off, finish the remaining work, then re-run this phase harness.');
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
        'Do NOT revert or rewrite application code to "fix" it. Diagnose the environment: device connection / hdc / build toolchain / signing configuration (signingConfigs / custom signing task coverage) / screenshot permissions.',
        'If the same infrastructure failure repeats, the run will HALT for you to fix the environment — blind retries waste the budget and do not improve the UI.',
      );
    } else if (priorFailureKind === 'visual_gap') {
      parts.push('', ...VISUAL_GAP_RETRY_GUIDANCE);
    } else if (priorFailureKind === 'transient_api_error') {
      // P0-D.5：断流≠内容失败——指导续作而非"修 blocker"，堵住"把缺产物当自己错误去修复现场"。
      parts.push(
        '',
        '**The prior attempt was interrupted by a MODEL-API CONNECTION DROP (transient network failure) — NOT a content/quality failure and NOT a broken codebase.**',
        'The missing artifacts above simply were not finished when the stream dropped. Continue from the partial work on disk: do NOT redo exploration, do NOT revert files — finish the unfinished artifacts and re-run this phase harness.',
      );
    } else if (priorFailureKind === 'agent_timeout') {
      parts.push(
        '',
        '**The prior attempt hit the phase wall-clock budget (agent_timeout) — NOT a content failure.**',
        'Resume the unfinished work from the partial artifacts; do NOT revert or redo completed parts.',
      );
    } else if (priorFailureKind === 'framework_integrity_block') {
      // P0-5：本 kind 正常路径是 halt（不重试）——能走到这里只可能是人工处置后 --resume。
      // 铁律：不给任何"修复/回滚"指引，framework 发布件对 agent 只读。
      parts.push(
        '',
        '**The prior halt was a FRAMEWORK INTEGRITY block — human-only territory, NOT your artifacts.**',
        'Framework release files are READ-ONLY for you: do NOT modify, restore, or revert anything under framework/.',
        'A human should already have resolved it (drift_allowlist approval / restore / re-deploy). Just re-run this phase harness to confirm, then continue the phase work. If the integrity blocker persists, HALT — do not attempt workarounds.',
      );
    } else if (priorFailureKind === 'framework_bug') {
      // P0-3：门禁自身缺陷——agent 改产物绕不过去，也不得改 framework 发布件。
      parts.push(
        '',
        '**The prior halt was an INTERNAL GATE ERROR (framework bug) — NOT a defect in your artifacts.**',
        'Do NOT keep mutating your artifacts to appease the crashing checker, and do NOT modify framework release files.',
        'A human should already have fixed/redeployed the gate. Re-run this phase harness; if the same internal error reappears, HALT and report it.',
      );
    } else {
      parts.push(
        '',
        'Address the BLOCKER evidence above, then re-run harness for this phase.',
      );
    }
    // P1-7（plan 7c4f2e9b）：品牌无关的弱模型防护——上一轮失败含 schema 未知键类 BLOCKER
    // 时，附 ui-spec 屏级/节点级合法键清单（由 schema SSOT 生成，不引 profile 代码）。
    if (/非法字段/.test(priorFailure)) {
      try {
        const schemaAbs = path.join(frameworkRoot, 'harness', 'schemas', 'ui-spec.schema.json');
        const schema = JSON.parse(fs.readFileSync(schemaAbs, 'utf-8')) as {
          definitions?: Record<string, { properties?: Record<string, unknown> }>;
        };
        const screenKeys = Object.keys(schema.definitions?.screen?.properties ?? {});
        const nodeKeys = Object.keys(schema.definitions?.componentNode?.properties ?? {});
        if (screenKeys.length && nodeKeys.length) {
          parts.push(
            '',
            '## ui-spec legal keys (schema SSOT — the prior failure contained an unknown field)',
            '',
            `- screen-level: ${screenKeys.join(', ')}`,
            `- componentNode-level: ${nodeKeys.join(', ')}`,
            'Use EXACTLY these key names. Any other key fails schema validation.',
          );
        }
      } catch { /* schema 读取失败不阻断 prompt */ }
    }
    // P1-7 红线：产物级修复之外的路径一律非法
    parts.push(
      '',
      '**Red line: do NOT read or modify framework internals (harness/ sources, gate implementations, manifests) to get past a gate — that is task failure, not a fix path.**',
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
  if (
    end?.status === 'COMPLETED' || // legacy
    end?.status === 'CHAIN_SLICE_COMPLETED' ||
    end?.status === 'AWAITING_HUMAN_REVIEW'
  ) {
    return null; // prior run finished; only a leftover lock
  }
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
      // P0-7①：detach 重启的 goal-runner 也不得继承预加载注入（headless-assumptions 曾教操作者
      // "启动 goal 前设 NODE_OPTIONS"——此处剥离让该路径失效）。自身 -r ts-node/register 属白名单。
      env: sanitizeSpawnEnv(process.env).env,
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
    string: ['feature', 'requirement', 'adapter', 'adapter-source', 'start', 'end', 'resume', 'manifest', 'run-id', 'ack-receipt', 'reseal-receipt'],
    boolean: [
      'help', 'dry-run', 'force-resume', 'override-start', 'override-end', 'override-manifest',
      'override-adapter',
      'detach', 'detached-child', 'force', 'foreground-ok',
      'refresh-vision-probe',
      // 六轮 P0-1：resume 时 vision checkpoint 缺失（旧版升级/被删）的显式人工确认——
      // 无此旗标一律 halt（fail-closed），不静默回落弱信任
      'ack-unverified-ledgers',
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

  // P1-10（plan 7c4f2e9b）：foreign-file 防线可观测性——consumer 形态（framework/ 嵌套）
  // 却无 RELEASE-MANIFEST.json 时，framework_foreign_file BLOCKER 整线按 spec 设计 no-op
  // （source layout Scenario）。07-17 事故 agent 向 framework/harness/ 写 debug 脚本未被拦，
  // 每-harness 复扫机制在位（harness-runner 全模式入口直调），最可能根因即此部署形态。
  // 只告警不改门（改判会破 source-repo 开发契约）；宿主据此改用发布包部署。
  if (layout.frameworkRel && !fs.existsSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.json'))) {
    console.warn(
      '[goal-runner] ⚠ consumer 形态（framework/ 嵌套）但缺 RELEASE-MANIFEST.json——' +
      'framework 写保护/foreign-file BLOCKER 整线处于 no-op（source layout 语义）。' +
      '请改用发布包部署 framework（含 manifest 与 sidecar），否则 agent 写入 framework/** 不会被拦截。',
    );
  }

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

  // 十三轮 review P0-1：fidelity transition 独立前置校验——**fresh/resume 都执行**。
  // 此前 evaluateFidelityTierPreflight 全跳 resume，--resume --manifest --fidelity 降档
  // +垃圾凭证/垃圾枚举可绕过全部验证直落 authenticated checkpoint。枚举合法+降档 receipt
  // 验真通过才返回精确授权字段集（--fidelity→仅 fidelity；receipt 验真过→仅 fidelity_receipt，
  // 不互相搭车）；违规=BLOCKER。applied 判 string 过滤后的 manifestArgv（与
  // applyManifestCliOverrides 同一来源——裸旗标 --fidelity 没应用任何值，不进校验面）。
  let fidelityTransitionFields: ReadonlySet<string> = new Set<string>();
  if (argv.manifest) {
    applyManifestCliOverrides(manifest, manifestArgv);
    const ft = evaluateFidelityTransitionAuthorization({
      projectRoot,
      manifest,
      featuresDirRel: featuresDir,
      applied: {
        fidelity: Boolean(manifestArgv.fidelity),
        fidelityReceipt: Boolean(manifestArgv['fidelity-receipt']),
      },
    });
    if (ft.blockers.length > 0) {
      console.error(`[goal-runner] BLOCKER: fidelity transition 校验失败：\n- ${ft.blockers.join('\n- ')}`);
      process.exit(1);
    }
    fidelityTransitionFields = ft.authorizedFields;
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

  // 十二/十三轮 review：manifest 身份漂移检测——**锁内（防并发 TOCTOU/事件污染）+ 任何副作用
  // （回写 local/writeGoalManifest/canary/preflight）之前**执行；可信旧基线取自 **authenticated
  // checkpoint**（MAC 保护的 SSOT），events 仅审计投影。十三轮 P1-3：legacy checkpoint（无逐
  // 字段身份）不静默当基线（聚合 hash 相等才一次性迁移）；valid_unauthenticated 基线标记弱信任
  // （resume ack + 终态封顶 + pre_run_manifest 降级）。决策核心=resolveManifestDriftDecision
  // （纯函数，真路径可测）；未授权漂移 halt（drift 事件在锁内写，不污染他 run）。
  const manifestDrift = resolveManifestDriftDecision({
    currentFields: computeManifestIdentityFields(manifest),
    currentHash: computeManifestIdentityHash(manifest),
    cpMeta: readVisionCheckpointMeta({ projectRoot, feature: manifest.feature, runId: manifest.run_id }),
    overrides: {
      'override-manifest': Boolean(argv['override-manifest']),
      'override-start': Boolean(argv['override-start']),
      'override-end': Boolean(argv['override-end']),
    },
    fidelityTransitionFields,
  });
  if (manifestDrift.halt) {
    appendEvent(manifest.report_dir, projectRoot, {
      type: 'manifest_identity_drift',
      changed_fields: manifestDrift.halt.changedFields,
      authorized: manifestDrift.halt.authorized,
    });
    throw new Error(manifestDrift.halt.message);
  }
  if (manifestDrift.legacyMigrated) {
    appendEvent(manifest.report_dir, projectRoot, {
      type: 'vision_checkpoint_schema_migrated', from: '1.1', to: '1.2',
    });
  }

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
    // C1：按 feature 声明 track 解析链（lite 走 auto_chain_by_track.lite；缺省 full 零变化）
    const goalTrack = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, manifest.feature));
    const chain = resolveAutoChain(
      workflow,
      manifest.start_phase,
      manifest.end_phase,
      manifest.chain_override,
      goalTrack,
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

    // goal-fakepass-hardening t8：截断链 preflight——start_phase 非链首时机器核验上游
    // closure（血缘重算 + review attestation），manifest.requirement 的文本断言不作数
    // （bc-openCard 事故：run2 以"上游已 PASS"文本断言直接从 ut 起跑）。
    const fullWorkflowChain = featurePhasesFromWorkflow(workflow, goalTrack);
    if (!dryRun && !argv.resume && chain[0] !== fullWorkflowChain[0]) {
      const upstream = fullWorkflowChain.slice(0, fullWorkflowChain.indexOf(chain[0])).map(String);
      // P0-2（八轮）+九轮 P0：比对**当前 run** 的 requirement 与上游 closure 记录的——
      // 换需求起截断链时上游 closure 判 stale。当前 SHA 不可计算=无法证明需求血缘，
      // goal 环境直接 BLOCKER（fail-closed，不静默跳过比较）。
      const currentReqSha = computeRunRequirementSha(projectRoot, manifest.feature, manifest.run_id, featuresDir);
      if (currentReqSha === null) {
        console.error(
          '[goal-runner] BLOCKER: 截断链核验无法计算当前 run 的 requirement 血缘哈希' +
            `（goal-runs/${manifest.run_id}/manifest.json 缺失/不可读）——fail-closed，拒绝启动。`,
        );
        process.exit(1);
      }
      const staleness = recomputePhaseEvidenceStaleness(projectRoot, manifest.feature, upstream, {
        currentRequirementSha: currentReqSha,
      });
      const bad = staleness.filter((r) => r.verdict !== 'fresh');
      const missingAttestation =
        upstream.includes('review') && !loadReviewClosureAttestation(projectRoot, manifest.feature);
      if (bad.length > 0 || missingAttestation) {
        console.error('[goal-runner] BLOCKER: 截断链上游 closure 核验失败——拒绝启动：');
        for (const r of bad) {
          const detail =
            r.verdict === 'missing'
              ? '缺 phase-evidence-manifest（旧版产物/未闭环，须补跑该阶段闭环）'
              : r.propagated_from
                ? `传染自上游 ${r.propagated_from}`
                : `证据变更：${[...r.changed_paths, ...(r.receipt_changed ? ['<receipt>'] : []), ...(r.integrity_errors ?? [])].join('、')}`;
          console.error(`  - [${r.phase}] ${r.verdict}：${detail}`);
        }
        if (missingAttestation) {
          console.error('  - [review] 缺 review-closure-attestation.json（须回跑 review 闭环生成）');
        }
        console.error('  修复后重试，或从受影响的最上游阶段重新起链（--start）。');
        process.exit(1);
      }
      emitMilestone(
        `GOAL_RUN event=upstream_closure_verified phases=${upstream.join(',')} run_id=${manifest.run_id}`,
      );
    }

    // E1（多模态降级阶梯 plan d4a8f3c6）：UI 需求且无 local override/新鲜缓存时，探测层
    // 才刚被声明式 image_input 骗过（案A mx 2.7 套壳）——先跑一次金丝雀实测校准，
    // 结果缓存进 framework.local.json（adapter 变更即失效），后续 phase 的能力块直接读缓存。
    // 探测失败/异常不阻断 run（保守：让主流程走既有 adapter 声明路径继续）。
    const visionProbeDecision = decideVisionCanaryProbe({
      projectRoot,
      manifest,
      chain,
      dryRun,
      forceRefresh: Boolean(argv['refresh-vision-probe']),
    });
    if (visionProbeDecision.action === 'probe') {
      const probeResult = await runVisionCanaryProbe({ projectRoot, frameworkRoot, manifest });
      if (probeResult.ran && probeResult.outcome === 'valid_cached') {
        console.log(`[goal-runner] 视觉能力金丝雀实测完成：verdict=${probeResult.verdict}（已缓存至 framework.local.json）`);
      } else if (probeResult.ran) {
        // plan c7d2e9a4 t3（stale-if-error）：探测无效/调用失败**未写盘**——日志须与消费面
        // 实际行为一致（resolveBaseImageInput 只认盘）：盘上仍有当前版本 fresh 缓存（强刷
        // 失败场景）→ 沿用 last-known-good；否则回退 adapter 声明路径,下次 run 自动重探。
        let lkg: { probed_at: string; verdict: string } | null = null;
        try {
          const canary = loadFrameworkLocalConfig(projectRoot)?.vision?.canary;
          if (canary && isVisionCanaryFresh(canary, manifest.adapter ?? 'generic')) {
            lkg = { probed_at: canary.probed_at, verdict: canary.verdict };
          }
        } catch { /* local 读不出 → 按无缓存处理 */ }
        console.warn(
          lkg
            ? `[goal-runner] 视觉金丝雀探测失败（${probeResult.error}），未写缓存——沿用既有实测缓存（probed_at=${lkg.probed_at}, verdict=${lkg.verdict}）`
            : `[goal-runner] 视觉金丝雀探测无效/调用失败（${probeResult.error}），未缓存——本次 run 回退 adapter 声明路径，下次 run 自动重探`,
        );
      } else if (probeResult.error) {
        console.warn(`[goal-runner] 视觉能力金丝雀实测跳过/失败（不阻断 run）：${probeResult.error}`);
      }
    }

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

    // visual-capability-truth S4：run_start 冻结 manifest hash——pre_run_manifest 授权源
    // 只认此快照（运行中补写 manifest 不构成授权）；resume 沿用首个 run_start 的冻结值。
    // 十/十一轮 review：manifest 身份哈希漂移检测已提前到副作用前（见上方 manifestDrift 块），
    // 此处仅落 run_start 事件（携带逐字段身份 + rebase 记录）。
    const manifestFileAbs = path.join(projectRoot, manifest.report_dir, 'manifest.json');
    const frozenManifestHash = resolveFrozenManifestHash(priorEvents, sha256FileHex(manifestFileAbs));
    const effectiveFrozenManifestIdentityHash = manifestDrift.effectiveHash;
    if (manifestDrift.rebaseApplied) {
      // 审计投影（可信 rebase 基线由 authenticated checkpoint 承载，见 commitVisionAnchors）
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'manifest_identity_rebase',
        to_fields: manifestDrift.currentFields,
        authorized_by: manifestDrift.rebaseAuthorizedBy,
      });
    }
    appendEvent(manifest.report_dir, projectRoot, {
      type: 'run_start',
      dry_run: dryRun,
      chain,
      manifest_hash: frozenManifestHash,
      manifest_identity_hash: effectiveFrozenManifestIdentityHash,
      manifest_identity_fields: manifestDrift.currentFields,
    });
    flushProgress(true);

    // 六/七轮 review P0：vision 信任链启动序——**head 先验（跨 run 连续性）→ resume
    // checkpoint 校验（同 run 停机窗口 + 授权子集绑定）→ 迁移（验后迁）→ 基线锚**。
    // ack 语义（七轮 P1-1）：CLI 旗标可被模型拼出，不构成人工授权——仅受信 confirmation
    // receipt（action=vision_ledger_ack，绑 project/feature/run/两账本 hash）为强 ack；
    // 旗标为弱 ack：须 events anchor 比对可行且通过，且终态封顶 AWAITING_HUMAN_REVIEW。
    let visionAckWeak = false;
    const currentAuthSubsetSha256 = computeAuthSubsetSha256(manifest.pre_authorized_mutations);
    // 八/九轮 P1：runner 内存可信态——启动验真后 head 世代/migrations/**上次写入字节 digest**
    // 只活在进程内；后续写点以内存为权威，覆盖前既比对身份/MAC/世代（缺失/漂移 halt），
    // 又精确比对 digest——九轮 P1-2：**合法旧文件重放**（身份+MAC 均过但字节 != 内存最近值）
    // 亦判篡改，runner 不为其重签。
    const visionTrust: {
      headGeneration: number;
      migrations: unknown[];
      checkpointWritten: boolean;
      headDigest: string | null;
      checkpointDigest: string | null;
    } = {
      headGeneration: 0,
      migrations: [],
      checkpointWritten: false,
      headDigest: null,
      checkpointDigest: null,
    };
    // 十二/十三轮 P0-b/P0-2：reseal 事务待提交标记（quarantine 后、新 HWM 首写复验通过前）。
    // 十三轮：只在本 run 新开 quarantine 时置位——崩溃事务由 recoverResealTransaction 在启动
    // 期按内容恢复（rolled_back 后原 receipt 复用/completed 补 commit），不再靠"同 run 续跑"。
    const resealTx: { pending: boolean } = { pending: false };
    const commitVisionAnchors = (
      scope: string,
      files: readonly VisionLedgerSnapshot[],
      opts?: { skipIntegrityCheck?: boolean },
    ): void => {
      if (!opts?.skipIntegrityCheck) {
        const headMeta = readVisionFeatureHeadMeta({ projectRoot, feature: manifest.feature });
        const headOk =
          (headMeta.state === 'valid' || headMeta.state === 'valid_unauthenticated') &&
          headMeta.generation === visionTrust.headGeneration &&
          // 九轮 P1-2：字节 digest 须等于内存最近写入值（合法旧文件重放被拒）
          headMeta.digest === visionTrust.headDigest;
        const cpMeta = readVisionCheckpointMeta({ projectRoot, feature: manifest.feature, runId: manifest.run_id });
        const cpOk =
          (cpMeta.state === 'valid' || cpMeta.state === 'valid_unauthenticated') &&
          cpMeta.digest === visionTrust.checkpointDigest;
        if (!headOk || !cpOk) {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'vision_ledger_tamper',
            scope: `${scope}_anchor_meta`,
            head_state: headMeta.state,
            head_generation: headMeta.generation ?? null,
            expected_generation: visionTrust.headGeneration,
            head_digest_match: headMeta.digest === visionTrust.headDigest,
            checkpoint_state: cpMeta.state,
            checkpoint_digest_match: cpMeta.digest === visionTrust.checkpointDigest,
          });
          throw new Error(
            `vision 信任锚文件在运行中被删除/篡改/重放（scope=${scope}，head=${headMeta.state}/gen=${headMeta.generation ?? 'n/a'} ` +
            `期望 ${visionTrust.headGeneration}，checkpoint=${cpMeta.state}）——fail-closed halt；runner 不为被篡改/重放的锚重新签名。`,
          );
        }
      }
      visionTrust.headGeneration += 1;
      const headWrite = writeVisionFeatureHead({
        projectRoot, feature: manifest.feature, runId: manifest.run_id, files,
        generation: visionTrust.headGeneration,
      });
      visionTrust.headDigest = headWrite.digest;
      visionTrust.checkpointDigest = writeVisionCheckpoint({
        projectRoot,
        feature: manifest.feature,
        runId: manifest.run_id,
        manifestHash: effectiveFrozenManifestIdentityHash,
        manifestIdentityFields: manifestDrift.currentFields,
        files,
        authSubsetSha256: currentAuthSubsetSha256,
        headGeneration: visionTrust.headGeneration,
        migrations: visionTrust.migrations,
      });
      visionTrust.checkpointWritten = true;
      // 十/十一/十二轮：持久化 HWM——每合法写点追加一行（诚实边界见 readVisionHwmHighWater 头注）
      appendVisionHwm({
        projectRoot, feature: manifest.feature,
        generation: visionTrust.headGeneration, headDigest: headWrite.digest,
      });
      // 十二轮 P0-b：reseal 事务——新 HWM 首写后**立即复验**（新 key 链可读），通过才 commit
      // 日志；复验失败 fail-closed 抛（不留半事务态）。
      if (resealTx.pending) {
        const check = readVisionHwmHighWater({ projectRoot, feature: manifest.feature });
        if (check.state !== 'ok' && check.state !== 'ok_unauthenticated') {
          throw new Error(`reseal 后新 HWM 链复验失败（${check.reason ?? check.state}）——fail-closed，reseal 事务未提交。`);
        }
        commitResealJournal(projectRoot, manifest.feature, manifest.run_id);
        resealTx.pending = false;
      }
    };
    {
      const now = snapshotVisionLedgers(projectRoot, manifest.feature);
      const ledgersPresent = now.some(f => f.sha256 !== 'absent');
      const ackReceiptPath = typeof argv['ack-receipt'] === 'string' ? argv['ack-receipt'].trim() : '';
      const ackStrong = ackReceiptPath
        ? validateConfirmationReceiptFile(
            path.isAbsolute(ackReceiptPath) ? ackReceiptPath : path.resolve(projectRoot, ackReceiptPath),
            defaultTrustRegistryPath(projectRoot),
            {
              action: 'vision_ledger_ack',
              feature: manifest.feature,
              object_hash: visionLedgerAckObjectHash({
                projectRoot, feature: manifest.feature, runId: manifest.run_id, files: now,
              }),
              run_id: manifest.run_id,
            },
          ).valid
        : false;
      if (ackReceiptPath && !ackStrong) {
        console.warn('[S3] --ack-receipt 校验未通过（信任链/绑定失配）——按无强 ack 处理');
      }
      // 十三轮 P0-2：**先恢复未完成 reseal 事务**（在读取旧锚 hash/验 receipt 之前——恢复会
      // 改变盘上现场：rolled_back 把旧 HWM 搬回 canonical，原 receipt 绑定重新可验；completed
      // 补记 commit）。blocked=不可恢复，fail-closed 人工处置。
      const resealRecovery = recoverResealTransaction({ projectRoot, feature: manifest.feature });
      if (resealRecovery.outcome === 'blocked') {
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'vision_reseal_recovery_blocked', detail: resealRecovery.detail ?? null,
        });
        throw new Error(
          `reseal 事务恢复失败（${resealRecovery.detail ?? 'unknown'}）——拒绝启动（fail-closed，人工处置）。`,
        );
      }
      if (resealRecovery.outcome !== 'none') {
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'vision_reseal_recovered', mode: resealRecovery.outcome, detail: resealRecovery.detail ?? null,
        });
      }
      // 八/九/十一轮：rekey/reseal——无 key→有 key 升级、密钥轮换后 head/checkpoint/HWM 必然
      // invalid；仅绑定现场的强 receipt 可授权重铸。object_hash 绑当前授权子集哈希 +
      // **effective manifest 身份哈希（十一轮 P1-5：rebase 后须绑新 requirement/budget/…）** +
      // 旧 head/checkpoint/**HWM（十一轮 P0-2）**字节 hash——堵授权升级旁路 + 换钥不死锁。
      const resealReceiptPath = typeof argv['reseal-receipt'] === 'string' ? argv['reseal-receipt'].trim() : '';
      const oldHeadSha = sha256FileFull(visionFeatureHeadPath(projectRoot, manifest.feature)) ?? 'absent';
      const oldCheckpointSha = sha256FileFull(visionCheckpointPath(projectRoot, manifest.feature, manifest.run_id)) ?? 'absent';
      const oldHwmSha = sha256FileFull(visionHwmPath(projectRoot, manifest.feature)) ?? 'absent';
      const resealObjectHash = visionTrustResealObjectHash({
        projectRoot, feature: manifest.feature, runId: manifest.run_id, files: now,
        oldHeadSha256: oldHeadSha,
        authSubsetSha256: currentAuthSubsetSha256,
        frozenManifestHash: effectiveFrozenManifestIdentityHash,
        oldCheckpointSha256: oldCheckpointSha,
        oldHwmSha256: oldHwmSha,
      });
      const resealStrong = resealReceiptPath
        ? validateConfirmationReceiptFile(
            path.isAbsolute(resealReceiptPath) ? resealReceiptPath : path.resolve(projectRoot, resealReceiptPath),
            defaultTrustRegistryPath(projectRoot),
            {
              action: 'vision_trust_reseal',
              feature: manifest.feature,
              object_hash: resealObjectHash,
              run_id: manifest.run_id,
            },
          ).valid
        : false;
      if (resealReceiptPath && !resealStrong) {
        console.warn('[S3] --reseal-receipt 校验未通过（信任链/绑定失配）——按无 reseal 处理');
      }
      // 十一/十二/十三轮：受信 reseal 时**事务化** quarantine 旧 HWM（prepared 先落
      // planned_bak+旧三锚+receipt 绑定 → rename → quarantined；提交延后到新 HWM 首写复验后，
      // 见 commitVisionAnchors；非终态 journal 在场则 transactionalQuarantineHwm 抛=禁覆盖）。
      if (resealStrong) {
        const bak = transactionalQuarantineHwm({
          projectRoot, feature: manifest.feature, runId: manifest.run_id,
          oldHwmSha256: oldHwmSha,
          oldHeadSha256: oldHeadSha,
          oldCheckpointSha256: oldCheckpointSha,
          receiptObjectHash: resealObjectHash,
        });
        resealTx.pending = true;
        appendEvent(manifest.report_dir, projectRoot, { type: 'vision_hwm_resealed', old_hwm_sha256: oldHwmSha, quarantined_as: bak });
      }
      const requireAck = (context: string): void => {
        if (ackStrong) {
          appendEvent(manifest.report_dir, projectRoot, { type: 'vision_ledger_resume_ack', mode: 'receipt', context });
          return;
        }
        if (!argv['ack-unverified-ledgers']) {
          appendEvent(manifest.report_dir, projectRoot, { type: 'vision_ledger_checkpoint_absent', ack: false, context });
          throw new Error(
            `vision 信任锚缺失（${context}）——须人工核查账本后带 --ack-unverified-ledgers（弱 ack，终态封顶人工复核）` +
            '或提供 --ack-receipt <受信 confirmation receipt>（强 ack）后重试（fail-closed，不静默回落）。',
          );
        }
        visionAckWeak = true;
        appendEvent(manifest.report_dir, projectRoot, { type: 'vision_ledger_resume_ack', mode: 'flag_weak', context });
      };

      // ① feature 级 head（七轮 P0-3：跨 run 连续性——fresh run 与 resume 都先验）
      const head = verifyVisionFeatureHead({ projectRoot, feature: manifest.feature, current: now });
      if (head.state === 'mismatch') {
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'vision_ledger_tamper', scope: 'feature_head', files: head.mismatched,
        });
        throw new Error(
          `vision 账本与 feature head 失配（${head.mismatched.join('、')}）——跨 run 篡改拦截（fail-closed）。` +
          '人工核查后处置；不要删改账本/head 冒充原状。',
        );
      }
      if (head.state === 'invalid') {
        if (resealStrong) {
          // 八轮 P1-2：受信 reseal——按当前账本重铸信任锚（世代 best-effort 续接旧值，防回卷）
          let priorGen = 0;
          try {
            const priorDoc = JSON.parse(
              fs.readFileSync(visionFeatureHeadPath(projectRoot, manifest.feature), 'utf-8'),
            ) as { generation?: unknown };
            if (typeof priorDoc.generation === 'number' && priorDoc.generation > 0) priorGen = priorDoc.generation;
          } catch { /* 不可解析——从 0 重铸 */ }
          visionTrust.headGeneration = priorGen;
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'vision_trust_resealed', scope: 'feature_head', reason: head.reason, prior_generation: priorGen,
          });
        } else {
          appendEvent(manifest.report_dir, projectRoot, { type: 'vision_head_invalid', reason: head.reason });
          throw new Error(
            `vision feature head 不可信（${head.reason}）——拒绝启动（fail-closed）。密钥升级/轮换场景请走 ` +
            '--reseal-receipt <受信 confirmation receipt>（action=vision_trust_reseal，绑定当前账本与旧 head hash）。',
          );
        }
      }
      if (head.state === 'absent' && ledgersPresent) {
        // 账本在场但无 head：首次升级或 head 被删——须显式 ack
        requireAck('feature_head_absent_with_ledgers');
      }
      if (head.state === 'ok' || head.state === 'ok_unauthenticated') {
        visionTrust.headGeneration = head.generation ?? 0;
        // 十/十一/十三轮：HWM 新鲜度对账（**诚实边界**：检测非协调回滚/意外损坏/整链删除，
        // 非密码学跨重启 anti-rollback——协调回放会同时截断 HWM 尾部，须 hardened 独立锚，
        // 见 3.9j）。十三轮 P1-4：absent 三分——声明态缺失=删除拦截；legacy=显式 bootstrap。
        // reseal 场景由上面的 invalid 分支处理；此处只对 head 已 ok 的情形对账。
        if (!resealStrong) {
          const hwm = readVisionHwmHighWater({ projectRoot, feature: manifest.feature });
          const headMetaNow = readVisionFeatureHeadMeta({ projectRoot, feature: manifest.feature });
          const fresh = assessHwmFreshness({
            headGeneration: head.generation ?? 0,
            headDigest: headMetaNow.digest,
            hwmDeclared: head.hwmDeclared === true,
            hwm,
          });
          if (fresh.action === 'halt_hwm_invalid') {
            appendEvent(manifest.report_dir, projectRoot, { type: 'vision_hwm_invalid', reason: fresh.reason });
            throw new Error(
              `vision HWM 链不可信（${fresh.reason}）——拒绝启动（fail-closed）。密钥升级/轮换请走 --reseal-receipt。`,
            );
          }
          if (fresh.action === 'halt_hwm_missing') {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'vision_hwm_missing', head_generation: head.generation ?? 0,
            });
            throw new Error(`vision HWM 缺失拦截：${fresh.reason}（fail-closed）`);
          }
          if (fresh.action === 'halt_incomplete_commit') {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'vision_hwm_incomplete_commit',
              head_generation: head.generation ?? 0,
              hwm_generation: hwm.maxGeneration ?? null,
            });
            throw new Error(`vision 锚提交未完成拦截：${fresh.reason}（fail-closed）`);
          }
          if (fresh.action === 'halt_rollback') {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'vision_ledger_rollback',
              head_generation: head.generation ?? 0,
              hwm_generation: hwm.maxGeneration ?? null,
              head_digest_match: headMetaNow.digest === hwm.lastHeadDigest,
            });
            throw new Error(
              `vision 非协调回滚/损坏拦截（${fresh.reason}）——拒绝启动（fail-closed）。` +
              '诚实边界：协调回放（同步截断 HWM 尾部）不可密码学阻止，hardened anti-rollback ' +
              '需独立不可回卷锚（tasks 3.9j pending）。',
            );
          }
          if (fresh.action === 'bootstrap_legacy') {
            // legacy 1.0 head（HWM 机制落地前）——一次性显式迁移：事件留痕后继续；
            // 首个 commit 写 1.1 head（hwm_declared）+ 同世代 HWM 首行，进入声明态。
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'vision_hwm_bootstrap', head_generation: head.generation ?? 0, reason: fresh.reason,
            });
          }
        }
      }
      if (head.state === 'ok_unauthenticated') {
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'vision_checkpoint_unauthenticated', scope: 'feature_head',
          note: `未配置 ${VISION_CHECKPOINT_HMAC_ENV}——head 仅位置信任（UI 相关 run 终态将封顶人工复核）`,
        });
      }

      // ② resume：同 run checkpoint（六轮先验后迁 + head 世代咬合）。
      // 十二轮 P0-a：manifest 身份/授权子集 drift 已在锁内 manifestDrift 块以 checkpoint 为
      // 可信旧基线做字段级授权（rebase 后不自我判死）——此处不再 force-equal manifest/auth_subset。
      if (Boolean(argv.resume)) {
        const cp = verifyVisionCheckpoint({
          projectRoot, feature: manifest.feature, runId: manifest.run_id, current: now,
          // head 已验真时 checkpoint 须与其世代咬合（脱节=旧 checkpoint 冒充）；head absent/
          // reseal 场景不比（无可信世代基线）
          ...(head.state === 'ok' || head.state === 'ok_unauthenticated'
            ? { expectedHeadGeneration: head.generation ?? 0 }
            : {}),
        });
        if (cp.state === 'mismatch') {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'vision_ledger_tamper', scope: 'resume_checkpoint', files: cp.mismatched,
          });
          throw new Error(
            `vision 账本在 runner 停机窗口被修改（${cp.mismatched.join('、')}，checkpoint 锚失配）——resume 拒绝继续（fail-closed）。`,
          );
        }
        if (cp.state === 'invalid') {
          if (resealStrong) {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'vision_trust_resealed', scope: 'run_checkpoint', reason: cp.reason,
            });
            // 迁移凭证以内存重建（旧 checkpoint 不可信不读回）；后续 baseline 重写
          } else {
            appendEvent(manifest.report_dir, projectRoot, { type: 'vision_checkpoint_invalid', reason: cp.reason });
            throw new Error(
              `vision checkpoint 不可信（${cp.reason}）——resume 拒绝继续（fail-closed）。密钥升级/轮换场景请走 ` +
              '--reseal-receipt（action=vision_trust_reseal）。',
            );
          }
        }
        if (cp.state === 'absent') {
          requireAck('run_checkpoint_absent');
          const lastAnchor = [...priorEvents]
            .reverse()
            .find(e => (e as { type?: string }).type === 'vision_ledger_anchor') as
            | { files?: Array<{ file: string; sha256: string }> }
            | undefined;
          if (Array.isArray(lastAnchor?.files)) {
            const tampered = diffVisionLedgerSnapshots(lastAnchor!.files!, now);
            if (tampered.length > 0) {
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'vision_ledger_tamper', scope: 'resume', files: tampered,
              });
              throw new Error(
                `vision 账本与本 run 最后 anchor 失配（${tampered.join('、')}）——即便已 ack 也拒绝续跑（fail-closed）。`,
              );
            }
          } else if (!ackStrong) {
            // 七轮 P1-1：last anchor 缺失时弱 ack（旗标）不足以继续——须强 ack receipt
            appendEvent(manifest.report_dir, projectRoot, { type: 'vision_ledger_no_anchor', ack: 'weak_insufficient' });
            throw new Error(
              'vision 账本无任何可比对锚（checkpoint 缺失且本 run 无 anchor 事件）——弱 ack 旗标不足以继续，' +
              '须 --ack-receipt <受信 confirmation receipt> 强 ack（fail-closed）。',
            );
          }
        }
        if (cp.state === 'ok' || cp.state === 'ok_unauthenticated') {
          // 八轮 P1-1：验真通过的 migrations 收进内存可信态（写点不再读盘）
          visionTrust.migrations = cp.migrations ?? [];
        }
        if (cp.state === 'ok_unauthenticated') {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'vision_checkpoint_unauthenticated',
            note: `未配置 ${VISION_CHECKPOINT_HMAC_ENV}——checkpoint 仅位置信任（UI 相关 run 终态将封顶人工复核）`,
          });
        }
        // 十三轮 P1-3：无 writer authenticity 的 checkpoint 被用作 drift 基线 → **弱信任处置**，
        // 不能仅靠终态封顶（run 仍会按可能被扩的 budget/unattended/pre_authorized_mutations 执行）。
        // resume 须显式 ack：弱旗标可续（终态照旧封顶），强 receipt 免吵；无 ack 不启动。
        if (manifestDrift.baselineUnauthenticated) {
          requireAck('checkpoint_unauthenticated_baseline');
        }
      }
    }

    // 五轮 review P0-3（六轮收紧为"验后迁"）：legacy 无链账本升级迁移——事务化
    // （tmp 全量构建+验证+原子换名+崩溃恢复），downgrade/contradicted 保守继承，
    // verified/supersede 不升级；mixed/不可解析拒自动修复。
    const ledgerMigrations = migrateLegacyVisionLedgers(projectRoot, manifest.feature);
    for (const m of ledgerMigrations.filter(x => x.action !== 'none')) {
      appendEvent(manifest.report_dir, projectRoot, { type: 'vision_ledger_legacy_migration', ...m });
      if (m.action === 'manual_required') {
        console.warn(
          `[S3] vision 账本 ${m.file} 为 mixed/不可解析形态——不自动修复（读取端 corrupt fail-closed 兜底），须人工处置`,
        );
      } else {
        console.log(
          `[S3] vision 账本 ${m.file} legacy 迁移：quarantine=${m.quarantined_as}，保守继承 ${m.imported_rows} 行（verified/supersede 不升级，须重新铸造/签发）`,
        );
      }
    }

    // 基线：head（跨 run 连续性锚，单调 generation）→ checkpoint（run 态，引用 head 世代，
    // 迁移凭证并入内存可信态随每次写入持久）。写失败=完整性锚不可用——fail-closed 抛错。
    {
      visionTrust.migrations = [
        ...visionTrust.migrations,
        ...ledgerMigrations.filter(m => m.action === 'migrated'),
      ];
      const baseline = snapshotVisionLedgers(projectRoot, manifest.feature);
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'vision_ledger_anchor',
        scope: 'run_start',
        files: baseline,
      });
      // 启动段刚完成验真/reseal——本次写入跳过覆盖前验盘（后续写点恒验）
      commitVisionAnchors('run_start', baseline, { skipIntegrityCheck: true });
    }

    // goal-fakepass-hardening t8：--supersede <run_id>（可重复）——显式废弃 HALTED/PARTIAL
    // 旧 run，写审计事件；completion verify 只认经审计的 supersede（自报 Set 不生效）。
    const supersededRunIds: string[] = ([] as string[])
      .concat(argv.supersede ?? [])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    for (const target of supersededRunIds) {
      const targetEvents = path.join(projectRoot, featuresDir, manifest.feature, 'goal-runs', target, 'events.jsonl');
      if (!fs.existsSync(targetEvents)) {
        console.error(`[goal-runner] BLOCKER: --supersede 目标 run 不存在：${target}`);
        process.exit(1);
      }
      appendEvent(manifest.report_dir, projectRoot, { type: 'supersede', target_run_id: target });
      emitMilestone(`GOAL_RUN event=supersede target=${target} run_id=${manifest.run_id}`);
    }

    // goal-fakepass-hardening t6：保真档位 preflight（agent 尚未被调用，不烧 run）——
    // 强意图+缺视觉 → DEFERRED_CAPABILITY_MISSING；ambiguous+有图+未预授权 → halt 问人。
    if (!argv.resume && !dryRun) {
      const fidelityAction = evaluateFidelityTierPreflight({
        projectRoot,
        frameworkRoot,
        manifest,
        featuresDirRel: featuresDir,
        chainStartsAtSpec: chain[0] === fullWorkflowChain[0],
      });
      if (fidelityAction.action !== 'proceed') {
        const status: GoalRunStatus =
          fidelityAction.action === 'defer_capability_missing' ? 'DEFERRED_CAPABILITY_MISSING' : 'HALTED';
        console.error(`\n[goal-runner] fidelity preflight → ${status}：\n${fidelityAction.detail}\n`);
        const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, []);
        writeGoalReport(projectRoot, manifest.report_dir, report, {
          workflowChain: fullWorkflowChain.map(String),
        });
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'run_end',
          status,
          ...(fidelityAction.action === 'await_human_fidelity_tier'
            ? { halt_reason: 'await_human_fidelity_tier' }
            : {}),
        });
        runConcluded = true;
        emitMilestone(`GOAL_RUN event=end status=${status} run_id=${manifest.run_id}`);
        return fidelityAction.action === 'defer_capability_missing' ? 2 : 1;
      }
    }

    const cap = loadGoalCapability(frameworkRoot, manifest.adapter!);
    // P1-7（plan d9b4f7e2）：adapter 版本运行时探测——每 run 一次、5s 超时、失败 unknown
    // 不阻塞；进 events（版本随宿主环境漂移，不硬编码 adapter.yaml）。与 output_delivery
    // 一并落 adapter_probe 事件，排障者一眼可见"什么版本、什么输出交付方式"。
    if (!dryRun) {
      const headlessCmd = cap.capability?.external_runner?.headless_invoke ?? '';
      const adapterBinary = headlessCmd.trim().split(/\s+/)[0] || manifest.adapter!;
      const adapterVersion = await probeAdapterVersion(adapterBinary);
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'adapter_probe',
        adapter_version: adapterVersion,
        output_delivery: cap.capability?.output_delivery ?? 'unknown',
      });
    }
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
      // S4：invalidation 消费——resume 起点推导剔除已失效且未重新完成的 phase
      // （被失效旧 PASS 不得作为续跑依据；十消费面矩阵之 resume 项）。
      const inv = applyInvalidationsToResume(chain, outcomes, priorEvents);
      outcomes = inv.outcomes;
      chainStartIndex = Math.min(chainStartIndex, inv.startIndex);
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'resume',
        start_index: chainStartIndex,
        start_phase: chain[chainStartIndex],
      });
    }

    let halted = false;
    // S4 回退状态机：计数从 events 回放（进程重启不清零）；上限 1 次/run。
    let backtrackToIdx: number | null = null;
    let backtracksUsed = priorEvents.filter(e => (e as { type?: string }).type === 'phase_backtrack_requested').length;
    let backtrackReviewFocus: string[] = [];
    // wall 由 goal-timeout 派生：max(配置 wall, Σ链路 per-phase + 缓冲)，
    // 保证全链单次满 per-phase 预算能跑完，避免被总 wall 提前截断。
    const wallMs = resolveWallClockMs(manifest);
    // P0-4（plan d9b4f7e2，rev8 偏离① 定稿口径）：wall deadline 制——**硬上界覆盖
    // agent/harness/backoff 三路径**（可用预算一律先扣 FINALIZE_RESERVE_MS 收尾预留）；
    // run_end 后收尾为 pre-check 拦截的 best-effort（finalize_skipped/finalize_overrun）。
    // 07-13 案实锤：预算只在 attempt 启动前检查，review 在 ~580m 启动后跑满 32m，
    // 限 585m 实跑 612m。
    const wallDeadlineMs = wallClockStartMs + wallMs;
    // P0-A：显式 timeout 低于建议地板只 WARN 不抬升（尊重显式 override 契约）。
    for (const warn of collectPhaseTimeoutWarnings(manifest, chain)) {
      console.warn(warn);
    }

    // ------------------------------------------------------------------
    // P0-3（plan 7c4f2e9b）：PASS 快照同进程内存信任锚 + invalidation journal 恢复。
    // journal 恢复**先于任何 pass_snapshot head 读取**（codex 八轮 P0）：pending →
    // 续跑 head 更新并幂等补 phase_invalidated 事件；不可验证 → fail-closed halt。
    // ------------------------------------------------------------------
    const passSnapshotMemory = new Map<
      string,
      { epoch: number; memoryDigest: { manifestSha256: string; fileHashes: Record<string, string> } }
    >();
    if (!dryRun) {
      const jr = recoverInvalidationJournal(projectRoot, manifest.feature, manifest.run_id);
      if (jr.kind === 'fail_closed') {
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'phase_halt',
          phase: chain[chainStartIndex],
          halt_reason: 'pass_snapshot_journal_unverifiable',
          detail: jr.reason,
        });
        console.error(`\n===== pass_snapshot_journal_unverifiable =====\n${jr.reason}\n人工核查 trust-state 后 --resume。\n`);
        outcomes.push({
          phase: chain[chainStartIndex],
          verdict: 'FAIL',
          halted: true,
          retries: 0,
          halt_reason: 'pass_snapshot_journal_unverifiable',
        });
        halted = true;
      }
      if (jr.kind === 'pending_heads_applied') {
        // 与正常路径同构：heads 已幂等应用 → 幂等补事件 → **最后** commit（post-impl P0#1：
        // commit 提前会让「commit 后事件补齐前」的二次崩溃永久丢事件）。
        const priorEv = loadEventsJsonl(eventsPath);
        for (const ph of jr.invalidatedPhases) {
          const already = priorEv.some(
            e => e.type === 'phase_invalidated' && e.phase === ph && e.invalidation_tx_id === jr.txId,
          );
          if (!already) {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_invalidated',
              phase: ph,
              cause_phase: 'journal_recovery',
              reason: 'invalidation_journal_recovered',
              invalidation_tx_id: jr.txId,
            });
          }
        }
        commitInvalidationTx(projectRoot, manifest.feature, manifest.run_id, jr.txId);
      }
    }

    for (let phaseIdx = chainStartIndex; phaseIdx < chain.length && !halted; phaseIdx++) {
      const phase = chain[phaseIdx];
      let retries = 0;
      let phaseDone = false;
      let priorBlockerSignature: string | null = null;
      let priorArtifactSnapshot: ArtifactSnapshot | null = null;
      // P1-B：上一次 attempt 是否因超时被中断（非内容失败）——用于重试时复用 partial 产物。
      let priorAttemptTimedOut = false;
      // P0-D：transient 计数与"上轮断流"语义都从 events.jsonl 派生（跨 continue/--resume
      // 不清零/不丢——内存变量在新进程必然归零，codex P1）。
      const phaseStartEvents = loadEventsJsonl(
        path.join(projectRoot, manifest.report_dir, 'events.jsonl'),
      );
      let transientRetriesUsed = countTransientApiRetries(phaseStartEvents, phase);
      // P0-D：上一次 attempt 是否 API 断流（同样非内容失败，partial 产物照样复用）。
      // resume 首轮从最近一次 phase_verdict 恢复，否则 prompt 归因错向 deterministic、
      // partial 续作块打不开。
      let priorAttemptApiError =
        Boolean(argv.resume) &&
        phaseIdx === chainStartIndex &&
        lastPhaseVerdictTransientApiError(phaseStartEvents, phase);

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

        // t1/rev6（f7a3d9c2）+ review-fix（cursor Critical/codex P1-1）：gate/resume 启动的
        // events↔ledger integrity 对账——**无条件执行**（期望集恒空正是主路径失效形态：
        // agent 先写→gate 恒 duplicate；期望集现已含 duplicate 的 row_hash）。缺行/改行/
        // 损坏行/重复行/陈旧孤儿行 → halt 求人（删账本行=绕 fuse；损坏不解释成空历史）。
        // pending 收养仅限"已 start、未 commit"的 invocation。诚实边界：运行时一致性防护，
        // 非协同篡改双文件的密码学防护。
        if (!dryRun && phase === 'testing') {
          const eventsForIntegrity = loadEventsJsonl(eventsPath);
          const recon = reconcileLedgerWithEvents({
            ledgerPath: visualRoundsLedgerPath(projectRoot, manifest.feature),
            loopId: `goal:${manifest.run_id}`,
            expectedRowHashes: collectVisualRoundRowHashes(eventsForIntegrity),
            pendingAttemptIds: collectUncommittedVisualAttemptIds(eventsForIntegrity),
          });
          if (!recon.ok) {
            halted = true;
            const detail = recon.issues.map(i => `${i.kind}: ${i.detail}`).join('; ');
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_halt',
              phase,
              halt_reason: 'visual_ledger_integrity',
              verdict: 'FAIL',
            });
            console.error(`\n===== visual_ledger_integrity =====\n视觉轮次账本与 events 对账失败（须人工核查，不得删账本重跑绕过熔断）：\n${detail}\n`);
            outcomes.push({ phase, verdict: 'FAIL', halted: true, retries });
            break;
          }
          // review-fix 轮2（codex P1-1）：收养的 pending 行立即补写 recovery 事件——
          // 进入下次期望集并关闭该 attempt 的 pending 身份（不写=pending 永久存活、
          // 孤儿行可借其名义永续）。
          for (const a of recon.adopted) {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'visual_round',
              phase,
              loop_id: `goal:${manifest.run_id}`,
              visual_attempt: a.attempt_id,
              row_hash: a.row_hash,
              disposition: 'recovered',
              recovered: true,
            });
          }
        }

        totalTurns++;
        const phaseDir = path.join(projectRoot, manifest.report_dir, 'phases', phase);
        fs.mkdirSync(phaseDir, { recursive: true });
        const promptPath = path.join(phaseDir, 'prompt.md');

        // on-disk summary 同时服务两处：既有的 mtime 新鲜度判断，与跨轮失败上下文回喂。
        const priorSummaryRead = readPhaseSummary(projectRoot, manifest.feature, phase);
        const summaryMtimeBefore = getSummaryMtime(priorSummaryRead.summaryAbsPath);

        // P0-1（plan d9b4f7e2 rev6/rev7）：continuation {cause, process_resumed} 双维度，
        // 与 retries（内容重试配额）**彻底解耦**——P0-B.5 的免配额重试曾因 retries 恒 0
        // 拿不到任何回喂（07-13 chrys 案：spec 6 份字节级相同的冷 prompt，checkpoint 每轮
        // 落盘却从未被同进程消费）。派生三层：
        //   ① in-memory 上轮信号（同进程，最精确）；
        //   ② events 五态窗口（--resume 跨进程，见 deriveContinuationFromEvents）；
        //   ③ checkpoint timed_out（仅用于把 ② 的 unknown 升级为 agent_timeout——旧日志
        //      end 事件可能缺 timed_out 标记）。
        let continuation: { cause: ContinuationCause; process_resumed: boolean } | null = null;
        if (priorAttemptApiError) {
          continuation = { cause: 'transient_api_error', process_resumed: false };
        } else if (priorAttemptTimedOut) {
          continuation = { cause: 'agent_timeout', process_resumed: false };
        } else if (retries > 0) {
          continuation = { cause: 'content_retry', process_resumed: false };
        } else if (Boolean(argv.resume) && phaseIdx === chainStartIndex) {
          // rev6：resume 进入**全新 phase**（无历史 invoke）→ null，不注入任何续作块。
          // 复审修复（codex P1）：**不再用 checkpoint.timed_out 升级 unknown**——checkpoint
          // 是 phase 级、无 invoke_id、写在 harness 段之后：attempt A 超时留下的旧
          // checkpoint 会盖过"attempt B 正常结束后崩于 harness"的 unknown 结论，违反
          // 五态表"最新 attempt 优先/end 正常无 verdict → unknown"。events 五态窗口是
          // 唯一权威（end 事件自带 timed_out，无需 checkpoint 佐证）。
          const derived = deriveContinuationFromEvents(loadEventsJsonl(eventsPath), phase);
          if (derived) {
            continuation = { cause: derived.cause, process_resumed: true };
          }
        }
        const isPhaseContinuation = continuation !== null;

        // 上轮 BLOCKER 证据回喂。保守门控保留：仅 FAIL/INCOMPLETE 才注入，避免干净首跑
        // 被残留旧 summary 污染。
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
        // P0-B/P0-D + rev6 缺口 b：上轮 agent 级中断以 continuation cause 为准——summary
        // 重算只见症状 blocker（断流的 spec_file_exists 会被误算 deterministic_gate，
        // "revert first" 指导随之错向）。现在同进程与 --resume 跨进程同一来源，kind 不再丢。
        if (continuation?.cause === 'transient_api_error') priorFailureKind = 'transient_api_error';
        else if (continuation?.cause === 'agent_timeout') priorFailureKind = 'agent_timeout';

        // P1-B/P2：上轮被基建原因打断（超时/断流/进程崩死）而非内容失败时，把已落盘
        // partial 产物 + 已检视文件 skip-list 回喂，让重试续作而非从零重做探索。
        const interruptedForResume =
          continuation?.cause === 'agent_timeout' ||
          continuation?.cause === 'transient_api_error' ||
          continuation?.cause === 'unknown';
        const partialResumeArtifacts =
          isPhaseContinuation && interruptedForResume
            ? collectTimeoutResumableArtifacts(projectRoot, manifest.feature, phase, wallClockStartMs)
            : [];
        const resumeInspection =
          isPhaseContinuation && interruptedForResume
            ? deriveResumeInspection(projectRoot, manifest.feature, phase, wallClockStartMs)
            : null;
        const resumeSkipLines = resumeInspection
          ? buildResumeSkipLines(
              resumeInspection,
              deriveReportSections(projectRoot, partialResumeArtifacts),
            )
          : [];

        // P0-4（plan d9b4f7e2）：本 attempt 有效超时——**计算先于 buildPhasePrompt**，
        // 同一个值传 prompt/agent_invoke_start 事件/adapter invoke/progress（单一事实源）。
        // 连续第 2 次超时后默认表派生值升档 ×1.5（显式 override 不动，与 MIN 地板同一
        // 豁免契约）；agent 侧 zero-budget 禁启动（rev7：invoke timer 语义 timeoutMs>0
        // 才启用、checkRunBudget 只查原始 wall——"原始 remaining>0、扣 reserve 后 ≤0"
        // 时绝不把 0 交给 timer 无超时裸跑）。
        const phaseEventsNow = loadEventsJsonl(eventsPath);
        const consecutiveTimeouts = countConsecutiveAgentTimeouts(phaseEventsNow, phase);
        // 复审补（cursor，plan P0-1.6 的"已耗时"）：本 phase 此前各 attempt 的累计耗时，
        // 注入续作块给 agent 预算感知（"这个 phase 已经烧了 X 分钟"）。
        const priorAttemptDurationsMs = phaseEventsNow
          .filter(
            (e) =>
              e.type === 'agent_invoke_end' &&
              e.phase === phase &&
              typeof e.duration_ms === 'number',
          )
          .map((e) => e.duration_ms as number);
        const baseTimeoutMs = resolvePhaseTimeoutMs(phase, manifest);
        // P0-5（plan 7c4f2e9b）：授予高水位 + 实测棘轮——effective = max(base,
        // consecutive-escalation, granted_highwater, 1.2×max_completed)，events 重建
        // （resume 不丢）；显式配置=hard cap 不被棘轮突破（advisory 诚实提示预算过小）。
        // 事故实证：i3 已获授 67.5min 且 exit0@49.6min，i4/i5 仍回落 45min 被腰斩。
        const ratchetObs = extractTimeoutRatchetFromEvents(phaseEventsNow, String(phase));
        const timeoutResolution = resolveEffectiveTimeoutMs({
          baseMs: baseTimeoutMs,
          explicit: isExplicitPhaseTimeout(phase, manifest),
          consecutiveTimeouts,
          observations: ratchetObs,
        });
        if (timeoutResolution.advisory) {
          // post-impl review P2#9：advisory 入 events（detach/resume 后可追溯）；
          // goal-report 经 events 渲染（timeout_advisory 行）。
          console.warn(`[goal-timeout] ${timeoutResolution.advisory}`);
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'timeout_advisory',
            phase,
            detail: timeoutResolution.advisory,
          });
        }
        const escalatedTimeoutMs = timeoutResolution.effectiveMs;
        const availableForAgentMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
        if (availableForAgentMs <= 0) {
          halted = true;
          appendEvent(manifest.report_dir, projectRoot, { type: 'budget_wall_clock', phase });
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: 'budget_wall_clock',
          });
          break;
        }
        const effectiveAgentTimeoutMs = Math.min(escalatedTimeoutMs, availableForAgentMs);
        if (escalatedTimeoutMs > baseTimeoutMs) {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'timeout_escalated',
            phase,
            effective_timeout_ms: effectiveAgentTimeoutMs,
            // P0-5：升档来源（consecutive_timeouts | granted_highwater | observed_ratchet）
            source: timeoutResolution.source,
          });
        }

        // E0：UI 需求 spec/plan/coding phase 能力感知——非 UI 相关 / 其余 phase 返回 null，
        // 不注入能力块（不打扰无关 phase 的 prompt）。
        const capabilityAdvisory = resolvePhaseCapabilityAdvisory(
          manifest,
          projectRoot,
          frameworkRoot,
          resolvedProfile,
          phase,
        );

        // visual-capability-truth S3（路径 B）：spec 期 inline canary——runner 随机出题
        // （答案只在内存），业务产出与答题同 invocation；判卷通过才签 invocation_bound。
        let inlineCanaryKey: CanaryAnswerKey | null = null;
        let inlineCanaryBlock = '';
        if (!dryRun && phase === 'spec' && capabilityAdvisory?.hasVision) {
          try {
            inlineCanaryKey = generateRandomCanaryAnswerKey();
            const canaryPng = path.join(phaseDir, 'inline-canary.png');
            await renderCanaryImage(canaryPng, inlineCanaryKey);
            inlineCanaryBlock = buildInlineCanaryBlock(canaryPng);
          } catch (e) {
            inlineCanaryKey = null;
            console.warn(`[S3] inline canary 生成失败（不阻断，能力停留 run_probed）：${(e as Error).message}`);
          }
        }

        // post-impl round2 P0#2：**spawn agent 之前**做一次统一可信快照加载，整个 attempt
        // 复用内存副本（防 attempt 中途盘上换 manifest）；坏 MAC/shape/上下文绑定/
        // head↔manifest 绑定 → 在 agent 有机会碰产物**之前** halt。
        const psMemAnchor = passSnapshotMemory.get(String(phase));
        const trustedSnapshot = dryRun
          ? ({ kind: 'none' } as const)
          : loadTrustedSnapshotContext(
              projectRoot,
              manifest.feature,
              manifest.run_id,
              String(phase),
              // post-impl round3 P0#1：同进程内存锚在场时，盘上 head 消失/退位/换代
              // 一律 spawn 前 fail_closed（两轮绕过：先删 head 再改产物）
              psMemAnchor
                ? { epoch: psMemAnchor.epoch, manifestSha256: psMemAnchor.memoryDigest.manifestSha256 }
                : null,
            );
        if (trustedSnapshot.kind === 'fail_closed') {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'phase_halt',
            phase,
            halt_reason: 'pass_snapshot_unavailable',
            detail: `pre-spawn 可信快照加载失败：${trustedSnapshot.reason}`,
          });
          console.error(
            `\n===== pass_snapshot_unavailable =====\n可信快照加载失败（${trustedSnapshot.reason}）——在 agent 启动前拦截，不给它碰产物的机会。\n人工核查 trust-state 后 --resume。\n`,
          );
          outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'pass_snapshot_unavailable' });
          halted = true;
          phaseDone = true;
          continue;
        }
        // P1#5（post-impl review）：attempt 级 closure-only 状态——本 attempt 是否处于
        // 「PASS 已冻结、只许关环」上下文；超时分流据此走 closure_timeout（不回内容重试）。
        const closureOnlyAttempt = trustedSnapshot.kind === 'active';

        const prompt = buildPhasePrompt(
          manifest,
          projectRoot,
          phase,
          frameworkRoot,
          deferredUpstream,
          priorFailure,
          priorFailureKind,
          partialResumeArtifacts,
          resumeSkipLines,
          capabilityAdvisory,
          continuation,
          effectiveAgentTimeoutMs,
          priorAttemptDurationsMs.length > 0
            ? {
                attempts: priorAttemptDurationsMs.length,
                elapsedMs: priorAttemptDurationsMs.reduce((a, b) => a + b, 0),
              }
            : undefined,
        ) + inlineCanaryBlock +
          // S4：回退后 review 注入增量重点复审清单（授权 ≠ 免审）
          (phase === 'review' && backtrackReviewFocus.length > 0
            ? buildBacktrackReviewFocusBlock(backtrackReviewFocus)
            : '') +
          // P0-3（plan 7c4f2e9b）：closure-only attempt——frozen 清单只读声明。提示词只是
          // 第一道；硬保护在 harness 前的差异判定+恢复（提示词级约束对弱模型无约束力）。
          (() => {
            // post-impl round2 P0#2：frozen 清单取自 pre-spawn 可信加载的内存副本
            if (trustedSnapshot.kind !== 'active') return '';
            const frozenRels = trustedSnapshot.manifest.files.map(f => f.rel);
            if (frozenRels.length === 0) return '';
            return [
              '',
              '## PASS artifacts are FROZEN — closure-only attempt (BLOCKER)',
              '',
              'This phase already reached a PASS verdict; only the closure steps (receipt / harness re-run) remain.',
              'The following deliverables are FROZEN and READ-ONLY — any modification will be detected,',
              'reverted from a trusted snapshot, and counted as a violation (repeated violations halt the run):',
              '',
              ...frozenRels.map(r => `- ${r} (frozen)`),
              '',
              'Do NOT redo analysis or rewrite artifacts. Complete the phase closure only.',
              '',
            ].join('\n');
          })();
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
        // t1（f7a3d9c2，终审遗留②）：invoke_id 升级为 run 级持久序数（totalTurns 从 events
        // 回放恢复，跨 --resume 单调），不再只靠系统时钟。visualAttemptId=轮次账本的
        // attempt 身份：同一 invocation 的 agent 自跑 harness 与外层 gate 共用；任何
        // 下一次 invocation（retry/detach/resume）必不同；崩溃恢复不重用（事件已落盘
        // 则 totalTurns 回放计入）。禁 phase 内 retries+1（resume 归零会撞旧 round_key）。
        const visualAttemptId = `i${totalTurns}`;
        const invokeId = `${phase}-${visualAttemptId}`;

        // t3-min（openspec capability-gap-preflight）：invoke 前共享 preflight——每 phase
        // 每 attempt 重检（含 --resume）；缺口不产生 agent_invoke_start、不烧 agent 轮次，
        // 首触即 halt 求人（不进 CUMULATIVE_HALT_FAMILY：agent 未开跑，无累计语义）。
        // v5：逻辑抽取为 runInvokeCapabilityGate（真实链可测——goal-capability-gate 单测
        // 断言"缺口无 agent_invoke_start / resume 重检仍 halt / reprobe 后放行"事件序列）。
        if (!dryRun) {
          const capHalt = runInvokeCapabilityGate({
            projectRoot,
            phase,
            retries,
            resolvedProfile: loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot)),
            emitEvent: ev => appendEvent(manifest.report_dir, projectRoot, ev as Parameters<typeof appendEvent>[2]),
          });
          if (capHalt) {
            halted = true;
            outcomes.push(capHalt.outcome);
            break;
          }
        }

        progressSubstep = 'agent_invoke';
        // 四轮 review P0：agent 调用窗口括号——invoke 前快照 vision 账本并落 anchor 事件；
        // invoke 结束后比对，窗口内任何账本变更 = agent 篡改 → phase halt（fail-closed）。
        const preInvokeVisionSnap = snapshotVisionLedgers(projectRoot, manifest.feature);
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'vision_ledger_anchor',
          scope: 'pre_invoke',
          phase,
          invoke_id: invokeId,
          files: preInvokeVisionSnap,
        });
        // 六轮 P0-2：checkpoint 写失败不静默降级——fail-closed 抛错；八轮 P1-1：覆盖前
        // 验盘（head/checkpoint 被删/被改即 halt，runner 不为篡改锚重签）
        commitVisionAnchors('pre_invoke', preInvokeVisionSnap);
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'agent_invoke_start',
          phase,
          invoke_id: invokeId,
          command: invokePlan.label,
          // P0-4：timeout 单一事实源——progress/status/dead-man 优先读本字段判 liveness
          // （升档后 manifest 静态解析会把合法运行 attempt 误报 STALLED，脑裂实锤）。
          effective_timeout_ms: effectiveAgentTimeoutMs,
        });
        flushProgress();

        // P0-4 rev7：调用 adapter 前断言——0 传给 invoke timer = 关闭超时，结构性禁止。
        if (!(effectiveAgentTimeoutMs > 0)) {
          throw new Error(
            `[goal-runner] BUG: effectiveAgentTimeoutMs=${effectiveAgentTimeoutMs} 不得 ≤0 到达 adapter（zero-budget 应已在启动判据拦截）`,
          );
        }
        const invoke = await invokeAgentHeadless(invokePlan, projectRoot, {
          dryRun,
          timeoutMs: effectiveAgentTimeoutMs,
          outputLogPath,
          // t1（f7a3d9c2）：轮次身份注入——agent 会话内自跑 harness 与外层 gate 同轮
          extraEnv: {
            MAISON_GOAL_RUN_ID: manifest.run_id,
            MAISON_GOAL_ATTEMPT: visualAttemptId,
          },
          // t3a：adapter 声明 structured_events 时三文件分流（events/stderr/人读投影）
          toolEventCapture: cap.capability?.tool_event_provenance ?? 'none',
          // C-ab-eval：按 adapter goal_capability.usage_capture 声明采集（缺省 none → proxy）
          usageCapture: cap.capability?.usage_capture,
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
          usage: invoke.usage,
          // P1-7（plan d9b4f7e2 rev6）：kill 诊断走事件字段，**不写 agent-output.log**
          // （该文件是 interaction sentinel / critic outputHash / output bytes 三处证据源，
          // runner 写入=污染证据+消灭"0 字节"事实）。0 字节 + output_delivery=buffered/
          // unknown 即自解释：adapter 缓冲输出、被杀=日志空，非 agent 没干活。
          kill_reason: invoke.timed_out === true ? 'agent_timeout' : undefined,
          effective_timeout_ms: effectiveAgentTimeoutMs,
          output_bytes: fs.existsSync(outputLogPath) ? fs.statSync(outputLogPath).size : 0,
          output_delivery: cap.capability?.output_delivery ?? 'unknown',
        });
        // P1-9（plan 7c4f2e9b）：模型身份 telemetry——共享 parser 读**纯 events 文件**的
        // init 事件，append-only 新事件承载；不回写冻结 manifest / 不改 run 前 adapter_probe
        // / 不为 telemetry 造 capability receipt / 不参与能力真值与任何策略分支。
        if (!dryRun && (cap.capability?.tool_event_provenance ?? 'none') === 'structured_events') {
          try {
            const eventsAbsForModel = agentEventsLogPath(outputLogPath);
            const observedModel = fs.existsSync(eventsAbsForModel)
              ? parseClaudeInitModel(fs.readFileSync(eventsAbsForModel, 'utf-8'))
              : null;
            if (observedModel) {
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'adapter_model_observed',
                phase,
                invoke_id: invokeId,
                adapter: manifest.adapter ?? 'generic',
                model: observedModel,
                source: 'structured_event_init',
              });
            }
          } catch { /* telemetry 缺失不阻断 */ }
        }
        flushProgress();

        // 四轮 review P0：invoke 窗口闭合比对——agent 调用期间 vision 账本被写 = 篡改
        // （合法写入只发生在 runner 编排的 gate harness 窗口）。首触即 halt，不重试洗白。
        if (!dryRun) {
          const postInvokeVisionSnap = snapshotVisionLedgers(projectRoot, manifest.feature);
          const tamperedLedgers = diffVisionLedgerSnapshots(preInvokeVisionSnap, postInvokeVisionSnap);
          if (tamperedLedgers.length > 0) {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'vision_ledger_tamper',
              scope: 'agent_invoke',
              phase,
              invoke_id: invokeId,
              files: tamperedLedgers,
            });
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_halt',
              phase,
              halt_reason: 'vision_ledger_tampered',
              files: tamperedLedgers,
            });
            console.error(
              `\n===== vision_ledger_tampered =====\nagent 调用窗口内 vision 账本被修改（${tamperedLedgers.join('、')}）——` +
              'runner-owned 账本 agent 禁写（openspec feature-artifact-layout）。halt 求人：核查 events.jsonl 的 ' +
              'pre_invoke anchor 与账本差异，人工处置后 --resume；不要删改账本行冒充原状。\n',
            );
            outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'vision_ledger_tampered' });
            halted = true;
            phaseDone = true;
            continue;
          }
        }

        // C-ab-eval：usage 落盘进本 phase trace（agent 产出后 best-effort 合并；已有 usage 不覆盖）
        if (invoke.usage) {
          mergeUsageIntoTraceFile(
            path.join(featurePhaseReportsDir(projectRoot, manifest.feature, phase, frameworkRoot), 'trace.json'),
            invoke.usage,
          );
        }

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

        // t3b（f7a3d9c2）：goal 态 verified 回执生产——runner 从纯净事件文件（agent-events.jsonl）
        // 审计图片验读记录后签发 runner attestation 回执，在脚本闸门之前落盘（gate 消费）。
        // adapter 未声明 structured_events / 无注册解析器 / 覆盖不全 → 如实 unverified/不产出。
        if (!dryRun && phase === 'testing' && (cap.capability?.tool_event_provenance ?? 'none') === 'structured_events') {
          try {
            const produced = produceCriticReceipt({
              projectRoot,
              feature: manifest.feature,
              adapter: manifest.adapter ?? '',
              goalRunId: manifest.run_id,
              attemptId: visualAttemptId,
              eventsLogAbsPath: agentEventsLogPath(outputLogPath),
              promptHash: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
              outputHash: fs.existsSync(outputLogPath)
                ? createHash('sha256').update(fs.readFileSync(outputLogPath)).digest('hex').slice(0, 16)
                : null,
            });
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'critic_receipt_produced',
              phase,
              invoke_id: invokeId,
              status: produced.produced ? (produced.provenance ?? 'unverified') : 'skipped',
            });
            if (!produced.produced) {
              console.log(`[t3b] critic 回执未由 runner 签发（${produced.reason}）`);
            } else if (produced.provenance === 'unverified') {
              console.log(
                `[t3b] critic 回执签发为 unverified（验读覆盖不全）：unread_screenshots=${produced.unreadScreenshots?.length ?? 0} unread_crops=${produced.unreadCrops?.length ?? 0}`,
              );
            }
          } catch (e) {
            console.warn(`[t3b] critic 回执生产异常（不阻断）：${(e as Error).message}`);
          }
        }

        // 三轮 review P0-2：runner-owned receipt 的可信边界=顺序信任——每个 spec invocation
        // 结束后 runner **先清理**两张回执文件（agent 在 invocation 内伪造的文件被压尾清除），
        // 再按判卷/审计结果重签发，并把回执文件 sha256 写入事件；消费面校验"该 invoke 的
        // 最后一条 runner 事件 + 文件 hash 一致"，非 runner 签发即拒。
        if (!dryRun && phase === 'spec') {
          try {
            fs.rmSync(capabilityReceiptPath(projectRoot, manifest.feature), { force: true });
            fs.rmSync(specRefsReceiptPath(projectRoot, manifest.feature), { force: true });
          } catch (e) {
            console.warn(`[S3] 回执清理异常（不阻断，消费面 fail-closed）：${(e as Error).message}`);
          }
        }

        // visual-capability-truth S3（路径 B 判卷）：inline canary 答卷 → 签发/拒签
        // invocation_bound receipt。未答/答错/CANNOT_SEE_IMAGE → 不签（能力停留
        // run_probed，vl_multimodal 终签自然被拒）——不阻断 phase，走盲档工作法。
        if (!dryRun && phase === 'spec' && inlineCanaryKey) {
          try {
            // P0-1（plan 7c4f2e9b / 3.10）：structured adapter 判卷改读**纯 events 文件**
            // 并取终态 result 文本投影——混合 agent-output.log 里 stderr 可插进 JSON 行
            // 中间、答卷在信封字符串内永不成独立行（行锚判卷恒空 → 真视觉宿主永久盲档）。
            // 归一失败（残卷/错误 result/文件缺失）→ outRaw='' → 不签发，维持 fail-closed。
            const structuredStdout = planUsesClaudeStreamJson(
              manifest.adapter ?? 'generic',
              cap.capability?.tool_event_provenance,
            );
            let outRaw = '';
            if (structuredStdout) {
              const eventsAbs = agentEventsLogPath(outputLogPath);
              const eventsRaw = fs.existsSync(eventsAbs) ? fs.readFileSync(eventsAbs, 'utf-8') : '';
              outRaw = eventsRaw ? (extractClaudeFinalResultText(eventsRaw) ?? '') : '';
              if (!outRaw) {
                console.log('[S3] inline canary：structured envelope 无终态 success result（残卷/断流/events 缺失）——不判卷不签发');
              }
            } else {
              outRaw = fs.existsSync(outputLogPath) ? fs.readFileSync(outputLogPath, 'utf-8') : '';
            }
            let issued = false;
            if (outRaw && isCanaryAnswerComplete(outRaw, inlineCanaryKey)) {
              const cls = classifyCanaryResponse(outRaw, inlineCanaryKey);
              if (cls.verdict === 'tool_read') {
                writeCapabilityReceipt(projectRoot, manifest.feature, {
                  adapter: manifest.adapter ?? 'generic',
                  run_id: manifest.run_id,
                  invoke_id: invokeId,
                  binding_path: 'inline_canary',
                  verdict: 'tool_read',
                  model: 'unknown',
                });
                issued = true;
              }
            }
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'capability_receipt',
              phase,
              invoke_id: invokeId,
              status: issued ? 'issued_inline_canary' : 'not_issued',
              // P0-2 事件锚：签发态携带回执文件 sha256（消费面比对，agent 伪造文件即失配）
              ...(issued
                ? { receipt_sha256: sha256FileFull(capabilityReceiptPath(projectRoot, manifest.feature)) }
                : {}),
            });
            if (!issued) {
              console.log('[S3] inline canary 未通过/未作答——invocation_bound 不签发（vl_multimodal 终签将被拒，走盲档/human_gate）');
            }
          } catch (e) {
            console.warn(`[S3] inline canary 判卷异常（不签发，不阻断）：${(e as Error).message}`);
          }
        }

        // visual-capability-truth S3：spec 期参考图验读回执——vl_multimodal 终签的证据面
        // （canary 只证能看测试图；本回执证"逐张读过本需求参考图"）。无解析器 adapter →
        // 不产出 → 终签结构性被拒（正是 20260718 cursor 自签形态的解药）。
        if (!dryRun && phase === 'spec' && (cap.capability?.tool_event_provenance ?? 'none') === 'structured_events') {
          try {
            const specMdForRefs = loadSpecMarkdown(projectRoot, manifest.feature);
            const refAbsPaths = specMdForRefs
              ? collectAuthoritativeImagePaths(projectRoot, specMdForRefs, p =>
                  path.isAbsolute(p) ? p : path.resolve(projectRoot, p),
                )
              : [];
            if (refAbsPaths.length > 0) {
              const producedRefs = produceSpecRefsReceipt({
                projectRoot,
                feature: manifest.feature,
                adapter: manifest.adapter ?? '',
                goalRunId: manifest.run_id,
                invokeId,
                eventsLogAbsPath: agentEventsLogPath(outputLogPath),
                refAbsPaths,
              });
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'spec_refs_receipt_produced',
                phase,
                invoke_id: invokeId,
                status: producedRefs.produced
                  ? (producedRefs.unread?.length ? 'partial' : 'complete')
                  : 'skipped',
                // P0-2 事件锚：产出态携带回执文件 sha256
                ...(producedRefs.produced
                  ? { receipt_sha256: sha256FileFull(specRefsReceiptPath(projectRoot, manifest.feature)) }
                  : {}),
              });
              if (!producedRefs.produced) {
                console.log(`[S3] spec refs 回执未签发（${producedRefs.reason}）——vl_multimodal 不可签`);
              } else if (producedRefs.unread?.length) {
                console.log(`[S3] spec refs 回执：${producedRefs.unread.length} 张参考图无验读记录（unread）`);
              }
            }
          } catch (e) {
            console.warn(`[S3] spec refs 回执生产异常（不阻断）：${(e as Error).message}`);
          }
        }

        // visual-capability-truth S5（单写者收编）：agent invocation 结束后、gate harness
        // spawn 之前，把本 attempt 的 journal 中间轮**顺序重放重算**收编进正式 ledger
        // （时序保证中间轮行落在 gate 行之前——fuse"最后一有效行"语义正确）。
        // 重放不一致 → halt visual_ledger_integrity（journal 篡改/评估器漂移不得静默收编）。
        let journalReplayHalt = false;
        if (!dryRun && phase === 'testing') {
          try {
            const replay = replayJournalIntoLedger({
              ledgerPath: visualRoundsLedgerPath(projectRoot, manifest.feature),
              journalPath: intermediateRoundsJournalPath(projectRoot, manifest.feature, manifest.run_id),
              attemptId: visualAttemptId,
              runId: manifest.run_id,
            });
            for (const row of replay.committed) {
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'visual_round',
                phase,
                invoke_id: invokeId,
                loop_id: row.loop_id,
                visual_attempt: row.attempt_id,
                row_hash: row.row_hash,
                disposition: 'appended',
                intermediate: true,
                fused: row.decision.fused,
              });
            }
            if (!replay.ok) {
              console.error(
                `\n===== visual_ledger_integrity =====\n中间轮 journal 收编重放失败（不得静默收编，须人工核查）：\n${replay.mismatches.map(m => `  - ${m}`).join('\n')}\n`,
              );
              journalReplayHalt = true;
            } else if (replay.replayed > 0) {
              console.log(`[S5] journal 中间轮收编：${replay.replayed} 行重放入正式账本（events 已记）`);
            }
          } catch (e) {
            console.error(`[S5] journal 收编异常（不静默——按完整性失败处理）：${(e as Error).message}`);
            journalReplayHalt = true;
          }
          if (journalReplayHalt) {
            halted = true;
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_halt',
              phase,
              halt_reason: 'visual_ledger_integrity',
              verdict: 'FAIL',
            });
            outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'visual_ledger_integrity' });
            phaseDone = true;
            continue;
          }
        }

        // ------------------------------------------------------------------
        // P0-3（plan 7c4f2e9b）：closure-only 冻结差异判定与恢复（harness 之前——先恢复
        // 再评审，恢复后的产物若仍 PASS 则 advance_blocked 续计由事件回放统计自然封顶）。
        // 信任两层：同进程内存 digest 即可恢复；resume 后须 HMAC；恢复被拒 → halt 求人。
        // ------------------------------------------------------------------
        if (!dryRun) {
          const psMem = passSnapshotMemory.get(String(phase));
          // post-impl round2 P0#2：复用 pre-spawn 可信加载的内存副本——不再从盘上重读
          // head/manifest（attempt 中途盘上被换的 manifest 不参与保护判定；坏 MAC/绑定
          // 已在 spawn 前 halt）。
          if (trustedSnapshot.kind === 'active') {
            const psHeadBody = trustedSnapshot.head;
            const psManifest = { body: trustedSnapshot.manifest };
            if (psManifest.body) {
              const diffs = diffFrozenAgainstManifest({
                projectRoot, feature: manifest.feature, phase: String(phase), manifest: psManifest.body,
              });
              if (diffs.length > 0) {
                appendEvent(manifest.report_dir, projectRoot, {
                  type: 'pass_snapshot_violation',
                  phase,
                  invoke_id: invokeId,
                  pass_epoch: psHeadBody.pass_epoch,
                  diffs: diffs.slice(0, 30),
                });
                const outcome = restoreFrozenFromSnapshot({
                  projectRoot,
                  feature: manifest.feature,
                  runId: manifest.run_id,
                  phase: String(phase),
                  diffs,
                  trust: psMem ? { tier: 'in_process', memoryDigest: psMem.memoryDigest } : { tier: 'resume' },
                  // post-impl round3 P0#2：恢复资格以 attempt 级不可变上下文为依据（防
                  // diff 用快照 A、restore 被换成快照 B 的 TOCTOU）
                  context: trustedSnapshot,
                });
                if (outcome.refused) {
                  appendEvent(manifest.report_dir, projectRoot, {
                    type: 'phase_halt',
                    phase,
                    halt_reason: 'pass_snapshot_restore_refused',
                    detail: outcome.refused,
                  });
                  console.error(
                    `\n===== pass_snapshot_restore_refused =====\nPASS 冻结产物被改且无法自动恢复（${outcome.refused}）。\n` +
                    '人工核查产物与 trust-state 快照后 --resume（生产/无头部署建议配置 MAISON_HMAC_GOAL_CHECKPOINT，使 resume 场景也可自动恢复）。\n',
                  );
                  outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'pass_snapshot_restore_refused' });
                  halted = true;
                  phaseDone = true;
                  continue;
                }
                appendEvent(manifest.report_dir, projectRoot, {
                  type: 'pass_snapshot_restored',
                  phase,
                  invoke_id: invokeId,
                  pass_epoch: psHeadBody.pass_epoch,
                  restored: outcome.restored,
                  deleted_added: outcome.deletedAdded,
                });
                console.warn(
                  `[pass-snapshot] closure-only attempt 改动冻结产物已恢复（restored=${outcome.restored.length}, ` +
                  `removed_added=${outcome.deletedAdded.length}）——违规计入 advance_blocked 累计`,
                );
              }
            }
          }
        }

        // P0-4 rev6：harness 启动判据——扣除收尾预留后的可用预算 ≤0 即不 spawn，直接
        // budget_wall_clock 终局（"原始 remaining>0 但扣 reserve 后 ≤0"也不 spawn；
        // 不产半份 harness 证据，绝不把 0 传给 timer）。
        const availableForHarnessMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
        if (!dryRun && availableForHarnessMs <= 0) {
          halted = true;
          appendEvent(manifest.report_dir, projectRoot, { type: 'budget_wall_clock', phase });
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: 'budget_wall_clock',
            agent_exit_code: invoke.exitCode,
            agent_timed_out: invoke.timed_out,
          });
          phaseDone = true;
          break;
        }

        progressSubstep = 'harness';
        appendEvent(manifest.report_dir, projectRoot, {
          type: 'harness_start',
          phase,
          // P0-1 rev6：attempt 窗口按 invoke_id 精确切分（continuation 五态派生消费）。
          invoke_id: invokeId,
        });
        flushProgress();

        const harnessRun = await runHarnessPhase(
          projectRoot,
          frameworkRoot,
          phase,
          manifest.feature,
          dryRun,
          manifest,
          { runId: manifest.run_id, attemptId: visualAttemptId },
          availableForHarnessMs,
        );
        const harnessExit = harnessRun.exitCode;

        appendEvent(manifest.report_dir, projectRoot, {
          type: 'harness_end',
          phase,
          exit_code: harnessExit,
          invoke_id: invokeId,
          // P0-4 rev6：wall 树杀与门禁真失败分开承载（exit_code=1 二义）。
          timed_out: harnessRun.timedOut || undefined,
        });
        // 五轮 review P0-2：gate harness 是 vision 账本唯一合法写入窗口——harness 结束后
        // 立即落 post_harness anchor + checkpoint（此后任何 halt/early-exit，最后锚都
        // 代表最后一次合法 runner 写入；resume 不再误报"停机篡改"）。
        {
          const postHarnessSnap = snapshotVisionLedgers(projectRoot, manifest.feature);
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'vision_ledger_anchor',
            scope: 'post_harness',
            phase,
            invoke_id: invokeId,
            files: postHarnessSnap,
          });
          // 六轮 P0-2：写失败 fail-closed（不吞）；七轮 P0-3：head 同步推进（跨 run 锚）；
          // 八轮 P1-1：覆盖前验盘（gate 窗口内锚被删/被改即 halt）
          commitVisionAnchors('post_harness', postHarnessSnap);
        }
        flushProgress();

        // P0-4 rev6：harness 被 wall 杀 → 直接 budget_wall_clock 终局，**不读取/归因可能
        // 只写了一半的 summary**（半份证据比无证据更毒）。
        if (harnessRun.timedOut) {
          halted = true;
          appendEvent(manifest.report_dir, projectRoot, { type: 'budget_wall_clock', phase });
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: 'budget_wall_clock',
            agent_exit_code: invoke.exitCode,
            agent_timed_out: invoke.timed_out,
          });
          phaseDone = true;
          break;
        }

        // P2：本次 attempt 结束后，runner 对"盘上现实"派生 checkpoint.json（观测 + 跨进程 resume）。
        if (!dryRun) {
          deriveAndWriteCheckpoint({
            projectRoot,
            reportDir: manifest.report_dir,
            feature: manifest.feature,
            phase,
            sinceMs: wallClockStartMs,
            timedOut: invoke.timed_out === true,
            artifactRelPaths: collectTimeoutResumableArtifacts(
              projectRoot,
              manifest.feature,
              phase,
              wallClockStartMs,
            ),
          });
        }

        progressSubstep = 'verdict';
        let { summary, summaryPath, summaryAbsPath, reportDir } = readPhaseSummary(
          projectRoot,
          manifest.feature,
          phase,
        );
        const summaryMtimeAfter = getSummaryMtime(summaryAbsPath);
        const freshSummary = isSummaryFresh(summaryMtimeBefore, summaryMtimeAfter);

        // P0-5（plan 7c4f2e9b）：in-flow 探针结果 hoist——closure_kind 分类 fresh 路径
        // 复用本次控制流已取得的 receiptValidation，不重复 spawn（codex 五轮）。
        let inFlowReceiptValidation: ReturnType<typeof tryValidateReceipt> | null = null;
        if (!dryRun && freshSummary && summary?.verdict === 'PASS') {
          const harnessRoot = path.join(frameworkRoot, 'harness');
          const receiptValidation = tryValidateReceipt(
            harnessRoot,
            projectRoot,
            phase,
            manifest.feature,
          );
          inFlowReceiptValidation = receiptValidation;
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

        // t1（f7a3d9c2）：账本回执写入 events——integrity 对账的期望集来源；duplicate 也记
        // （重放裁决可观测），期望集只取 disposition=appended（collectVisualRoundRowHashes）。
        const visualRoundReceipt = (
          summary as {
            visual_round?: {
              loop_id: string;
              attempt?: string;
              row_hash?: string;
              disposition: 'appended' | 'duplicate' | 'append_failed';
              decision?: { fused: boolean };
            };
          } | null
        )?.visual_round;
        if (!dryRun && freshSummary && visualRoundReceipt) {
          appendEvent(manifest.report_dir, projectRoot, {
            type: 'visual_round',
            phase,
            invoke_id: invokeId,
            loop_id: visualRoundReceipt.loop_id,
            visual_attempt: visualRoundReceipt.attempt,
            row_hash: visualRoundReceipt.row_hash,
            disposition: visualRoundReceipt.disposition,
            fused: visualRoundReceipt.decision?.fused === true,
          });
          // review-fix（codex P1-2）：账本落盘失败=完整性事件——立即 fail-closed halt，
          // 不得让"events 声称评估过而账本无行"的成功运行溜走（末轮无下次对账兜底）。
          if (visualRoundReceipt.disposition === 'append_failed') {
            halted = true;
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_halt',
              phase,
              halt_reason: 'visual_ledger_integrity',
              verdict: 'FAIL',
            });
            console.error('\n===== visual_ledger_integrity =====\n视觉轮次账本追加失败（磁盘/权限）——本轮评估未持久化，fail-closed 求人；修复后重跑。\n');
            outcomes.push({ phase, verdict: 'FAIL', halted: true, retries });
            break;
          }
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
        // P0-D：API 断流哨兵（adapter 感知信封锚定）。B/D 并存取 agent_timeout 优先
        // （runner tree-kill 是确定性事实，断流串可能是被杀连带产生）→ timed_out 时不扫。
        const apiErrorSentinel =
          invoke.timed_out === true
            ? null
            : parseHeadlessApiError(outputLogPath, manifest.adapter ?? '');
        // P0-D §六-8：0 字节保守兜底——仅"真 spawn 过（duration 存在）+ 空输出 + 极短
        // 时长 + 非零退出"判 agent_no_output；invokeAgentHeadless 的 binary 短路路径无
        // duration/不写 log，排除之（否则 preflight 诊断被吞成泛化"空产出"，codex P2）。
        const outputLogBytes = fs.existsSync(outputLogPath)
          ? fs.statSync(outputLogPath).size
          : 0;
        const agentNoOutput = isAgentNoOutputSignal(
          invoke,
          outputLogBytes,
          AGENT_NO_OUTPUT_MAX_DURATION_MS,
        );
        // E4（案B chrys 实录：exit=3221225786 两次被误判 code_regression/agent_no_output）：
        // 用户手动 Ctrl+C，不是任何一种"失败"信号，最高优先单独识别。
        const operatorInterrupt = isOperatorInterruptSignal(invoke.exitCode, invoke.signal);
        const failureKind = classifyFailureKind(summary, manifest.dependency_policy, {
          agentTimedOut: invoke.timed_out === true,
          agentApiError: apiErrorSentinel !== null,
          agentNoOutput,
          operatorInterrupt,
          // P0-5/P0-3 freshness（决策表 SSOT）：fresh 超时轮的 integrity/framework_bug
          // 确定性证据优先于 agent_timeout（harness 在 tree-kill 之后新鲜跑出，可信）。
          staleSummary: resolved.stale_summary,
        });
        // P0-5：integrity subtype 多值收集（blocking_class 过滤 + classification 通道），
        // 透传 phase_verdict / halt guidance / outcome。
        const integritySubtypes =
          failureKind === 'framework_integrity_block' ? extractIntegritySubtypes(summary) : [];
        // P0-B §七.3：agent_timeout 无普通 blocker 时用专用 signature（agent_timeout@<phase>），
        // 否则空 signature 被 shouldHaltNoProgress 短路、零进展熔断恒不触发。
        const currentBlockerSignature = buildEffectiveBlockerSignature(
          summary,
          failureKind,
          phase,
        );
        const affectedFiles = extractDeterministicAffectedFiles(summary);
        // P0-B：agent_timeout 无 deterministic affected_files 时监控 phase 主产物
        // （spec.md 等 + context-exploration.md）——产物内容变化=有进展，guard 放行续作。
        const watchedFiles =
          affectedFiles.length > 0
            ? affectedFiles
            : failureKind === 'agent_timeout'
              ? timeoutWatchArtifactPaths(projectRoot, manifest.feature, phase)
              : [];
        const currentArtifactSnapshot =
          watchedFiles.length > 0 ? snapshotArtifacts(projectRoot, watchedFiles) : {};

        let action = classifyPhaseVerdict({
          verdict,
          ...meta,
          dependency_policy: manifest.dependency_policy,
          retries_used: retries,
          max_retries_per_phase: manifest.budget.max_retries_per_phase,
        });

        let haltReason: string | undefined;
        let awaitConfirmGuidance: string | undefined;
        // P0-D.3 哨兵优先级：operator_interrupt > agent_timeout > headless_interaction_required >
        // transient_api_error > blocker。E4：用户手动中断压过一切（含 verdict===PASS 的边缘情况——
        // 中断就是中断，不因为脚本恰好跑完就当没发生）。
        if (operatorInterrupt) {
          action = 'halt';
          haltReason = 'operator_interrupt';
        } else if (invoke.timed_out !== true && interactionSentinel && verdict !== 'PASS') {
          action = 'halt';
          haltReason = 'headless_interaction_required';
        } else if (agentNoOutput && verdict !== 'PASS') {
          // P0-D §六-8：空产出（疑似 spawn/权限/弱模型）第一次即 halt 求人——goal 无头
          // 没有 normal 模式的 Stop hook 逃生阀；不 backoff、不盲重试、不冒充断流。
          action = 'halt';
          haltReason = 'agent_no_output';
        } else if (failureKind === 'framework_integrity_block' && verdict !== 'PASS') {
          // P0-5（plan d9b4f7e2）：framework 完整性家族一律首触 halt——agent 修不了也不许修
          // （含"回滚可疑漂移"：07-13 chrys 案 goal agent 依 code_regression 通用话术回滚了
          // 宿主经用户批准的真修复）。guidance 按 subtype 分补救、多值按修复顺序逐条。
          action = 'halt';
          haltReason = 'framework_integrity_block';
          awaitConfirmGuidance = buildFrameworkIntegrityGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase,
            subtypes: integritySubtypes,
            harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
          }).join('\n');
          console.log(`\n===== framework_integrity_block =====\n${awaitConfirmGuidance}\n`);
        } else if (failureKind === 'framework_bug' && verdict !== 'PASS') {
          // P0-3（plan d9b4f7e2）：门禁脚本自身程序员错误——框架缺陷只能人修（回灌源仓），
          // agent 改产物绕不过去（案发现场 spec 前 5 轮空转实证），首触即 halt。
          action = 'halt';
          haltReason = 'framework_bug';
          const bugBlockers = (summary?.blockers ?? []).filter(
            (b) => b.classification === 'framework_bug',
          );
          const bugStackHead = bugBlockers
            .map((b) => (b.details_excerpt ?? '').split('\n').find((l) => l.trim()))
            .find((l) => l && l.trim());
          awaitConfirmGuidance = buildFrameworkBugGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase,
            checkerIds: bugBlockers.map((b) => b.id ?? '').filter(Boolean) as string[],
            stackHead: bugStackHead ? truncateOneLine(bugStackHead, 200) : undefined,
            harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
          }).join('\n');
          console.log(`\n===== framework_bug =====\n${awaitConfirmGuidance}\n`);
        } else if (failureKind === 'transient_api_error' && verdict !== 'PASS') {
          // P0-D：断流走独立 backoff 重试（与 max_retries_per_phase 解耦），耗尽才 halt。
          if (transientRetriesUsed < manifest.budget.max_transient_api_retries) {
            action = 'retry';
          } else {
            action = 'halt';
            haltReason = 'transient_api_error_exhausted';
          }
        } else if (failureKind === 'await_human_confirm' && verdict !== 'PASS') {
          // P0-9b：设计内求人时刻——agent 不能替人签 confirmed_by，重试无意义，首触即 halt。
          // P0-10a：引导话术按 run 上下文机器生成（feature/run_id/路径/layout 命令注入）。
          action = 'halt';
          haltReason = 'await_human_visual_confirm';
          awaitConfirmGuidance = buildAwaitHumanConfirmGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase,
            screenshotsDirRel: path.posix.join(featuresDir.replace(/\\/g, '/'), manifest.feature, 'device-testing', 'device-screenshots'),
            visualDiffJsonRel: path.posix.join(featuresDir.replace(/\\/g, '/'), manifest.feature, 'device-testing', 'device-screenshots', 'visual-diff.json'),
            harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
          }).join('\n');
          // P0-10a 补强②：halt 时 console/detach.log 原样打印（看日志者亦撞见）。
          console.log(`\n===== await_human_visual_confirm =====\n${awaitConfirmGuidance}\n`);
        } else if (failureKind === 'await_human_p0_skip' && verdict !== 'PASS') {
          // t5（goal-fakepass-hardening）：P0 用例 skip 无凭证 waiver——agent 不可自决
          // P0 去留，重试只会复现同 skip → 首触即 halt 求人；skip 清单与双口径在
          // blocker details（p0_coverage_integrity）。
          action = 'halt';
          haltReason = 'await_human_p0_skip';
          awaitConfirmGuidance = [
            '===== await_human_p0_skip（P0 用例被跳过，须真人裁决）=====',
            `feature=${manifest.feature} run_id=${manifest.run_id}`,
            '- 被跳过的 P0 用例与全分母双口径见 testing summary 的 p0_coverage_integrity blocker details。',
            '- 三条出路：①修复可测性后去 skip 重跑；②外部环境阻塞 → 按 DEFERRED 流程登记；',
            '  ③确需豁免 → 真人经带外体系签发 p0_skip_waiver receipt，写入 testing/skip-waivers.yaml',
            '  （逐条 tc_id + receipt_path），然后 --resume。waiver 只降级不洗白（run 封顶 AWAITING_HUMAN_REVIEW）。',
          ].join('\n');
          console.log(`\n${awaitConfirmGuidance}\n`);
        } else if (failureKind === 'no_progress_fuse' && verdict !== 'PASS') {
          // t1（f7a3d9c2）：指纹级无进展熔断——check 层已比对轮次账本判"两有效轮指纹集
          // 相等且仍有 loop-actionable 残差"（含 duplicate 重放，rev5）。重试只会复现同
          // 指纹 → 首触即 halt 求人，不烧重试预算；残差清单在 blocker details。
          action = 'halt';
          haltReason = 'no_progress_fuse';
        } else if (failureKind === 'verification_evidence_gap' && verdict !== 'PASS') {
          // C5-min 验证转嫁禁令：evidence 缺口属设计内求人时刻（与 await_human 系同构），
          // agent 不得以"已自测"替代真人/device 验证，重试无意义 → 首触即 halt，不计 no_progress。
          action = 'halt';
          haltReason = 'await_human_verification_evidence';
        } else if (
          // ==============================================================
          // P0-4(b)（plan 7c4f2e9b）：blocker actionability 聚合层（决策梯③层唯一插入位，
          // 位于安全终态/专用求人态/transient API 之后、no-progress/内容重试之前）。
          // timeout 四步分流（codex 九轮 P0）由此天然落地：timed_out + fresh blockers 时
          // ①integrity 已被上方安全终态吸收 → ②∃toolchain→await_operator_toolchain →
          // ③非空且全 human_only→await_human_gate_deferral → ④其余走下方 agent_timeout。
          // fresh 判据=summary 非 stale（stale summary 是上一 attempt 的症状，不据此分流）。
          verdict !== 'PASS' &&
          !resolved.stale_summary &&
          classifyTimedOutWithFreshBlockers(summary) !== null
        ) {
          const actionabilityRoute = classifyTimedOutWithFreshBlockers(summary)!;
          const agg = aggregateBlockerActionability(summary);
          action = 'halt';
          haltReason = actionabilityRoute;
          if (actionabilityRoute === 'await_operator_toolchain') {
            // 「修环境」不得描述成「签字确认」（codex 二轮 must-fix#2）
            awaitConfirmGuidance = [
              '===== await_operator_toolchain（环境/工具链阻塞，须 operator 修复）=====',
              `feature=${manifest.feature} run_id=${manifest.run_id} phase=${phase}`,
              `- 工具链 blocker：${agg.toolchainIds.join(', ')}`,
              '- 这不是产物内容问题：重试 agent 修不了环境。修复对应工具链（详见 blocker details）后 --resume。',
              ...(agg.humanOnlyIds.length ? [`- 另有待人工项（环境修复后再处置）：${agg.humanOnlyIds.join(', ')}`] : []),
            ].join('\n');
          } else {
            // 账本 deferred request 仅作佐证呈现（「账本不构成授权」契约），不参与触发
            let ledgerNote = '';
            try {
              const ledger = loadHeadlessLedger(projectRoot, manifest.feature, String(phase));
              const family = new Set<string>(agg.humanOnlyIds);
              if (agg.humanOnlyIds.includes('fidelity_deferrals_human_sign')) {
                family.add('capture_completeness_external'); // gate 族匹配（cursor 三轮）
              }
              const matched = (ledger?.entries ?? []).filter(
                it => it.must_review === true && typeof it.gate_id === 'string' && family.has(it.gate_id),
              );
              if (matched.length) {
                ledgerNote = `- agent 账本 deferred request 佐证（${matched.length} 条，仅供裁决参考，不构成授权）：` +
                  matched.map(m => m.gate_id).join(', ');
              }
            } catch { /* 账本读取失败不影响求人引导 */ }
            awaitConfirmGuidance = [
              '===== await_human_gate_deferral（仅剩需真人签字/确认项，内容重试无意义）=====',
              `feature=${manifest.feature} run_id=${manifest.run_id} phase=${phase}`,
              `- 待签字/确认 blocker：${agg.humanOnlyIds.join(', ')}`,
              '- 逐条处置：按各 blocker details 完成真人签字/确认（人签落点见 suggestion），然后 --resume。',
              '- 本 halt 不消耗内容重试预算；run 语义同 AWAITING_HUMAN_REVIEW（复核前不得视为最终确认）。',
              ...(ledgerNote ? [ledgerNote] : []),
            ].join('\n');
          }
          console.log(`\n${awaitConfirmGuidance}\n`);
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
          // T6/P0-B：分流 halt 原因——基建(toolchain/capture/agent_timeout)求人修环境
          // vs 视觉(visual_gap)同门禁无改善熔断求复核。
          haltReason =
            failureKind === 'visual_gap'
              ? 'no_progress_visual_gap'
              : failureKind === 'toolchain' ||
                  failureKind === 'capture' ||
                  failureKind === 'agent_timeout'
                ? `no_progress_${failureKind}`
                : 'no_progress_guard';
        } else if (
          // E4：CUMULATIVE（非仅连续）家族重复熔断——上面 shouldHaltNoProgress 只比"紧邻上一次"，
          // 会被 FAIL(真 blocker 串)↔PASS(合成 agent_timeout@phase signature) 边界打断
          // （chrys 案实证：signature 因 verdict 摆动而不同，guard 被绕过）。这里改从 events.jsonl
          // 回放**累计**同一 signature 在 CUMULATIVE_HALT_FAMILY 家族内出现次数，与紧邻性无关。
          CUMULATIVE_HALT_FAMILY.has(failureKind) &&
          currentBlockerSignature &&
          countRepeatedSignatureInFamily(
            loadEventsJsonl(eventsPath),
            phase,
            currentBlockerSignature,
            CUMULATIVE_HALT_FAMILY,
          ) +
            1 >=
            CUMULATIVE_HALT_THRESHOLD
        ) {
          action = 'halt';
          haltReason = `no_progress_cumulative_${failureKind}`;
        } else if (
          // P0-4（plan d9b4f7e2）：连续超时熔断——升档（第 2 次后 ×1.5）仍救不回的第
          // CONSECUTIVE_TIMEOUT_HALT_AT 次连续超时 → halt 求人。签名无关（07-13 案 FAIL
          // 签名每轮互异，签名基 guard 全绕过）；含 PASS+unclosed 型（advance_blocked），
          // 但"PASS 且闭环完成"的超时不拦（马上 advance，无需熔断）。
          failureKind === 'agent_timeout' &&
          (verdict !== 'PASS' || resolved.advance_blocked) &&
          countConsecutiveAgentTimeouts(loadEventsJsonl(eventsPath), phase) + 1 >=
            CONSECUTIVE_TIMEOUT_HALT_AT
        ) {
          action = 'halt';
          haltReason = 'agent_timeout_repeated';
          awaitConfirmGuidance = buildAgentTimeoutRepeatedGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase,
            // 复审修复（codex P2）：本次 invoke 的 agent_invoke_end 在 verdict 链之前已
            // 落盘 events——不再 concat 当前时长，否则末条重复、attempt 数虚高。
            attemptDurationsMs: loadEventsJsonl(eventsPath)
              .filter(
                (e) =>
                  e.type === 'agent_invoke_end' &&
                  e.phase === phase &&
                  typeof e.duration_ms === 'number',
              )
              .map((e) => e.duration_ms as number),
            effectiveTimeoutMs: effectiveAgentTimeoutMs,
            harnessPrefixRel: layout.frameworkRel
              ? path.posix.join(layout.frameworkRel, 'harness')
              : 'harness',
          }).join('\n');
          console.log(`\n===== agent_timeout_repeated =====\n${awaitConfirmGuidance}\n`);
        } else if (shouldHaltClosureTimeout(closureOnlyAttempt, failureKind, verdict)) {
          // P1#5（post-impl review）：closure-only attempt 超时 → closure_timeout 求人，
          // 不回内容重试（OpenSpec：closure timeout SHALL surface for human disposition）。
          action = 'halt';
          haltReason = 'closure_timeout';
          console.error(
            '\n===== closure_timeout =====\nclosure-only attempt（PASS 已冻结，仅补关环）超时——不回内容重试。\n' +
            '人工核查 receipt/closure 状态后 --resume（deterministic 关环由 runner 代办，超时通常意味 verifier 参与的 repair 被卡）。\n',
          );
        } else if (failureKind === 'agent_timeout' && verdict !== 'PASS') {
          // P0-B.5：超时+有进展（guard 未熔断）→ resume 续作，不吃内容重试预算；
          // 全局仍受 wall_clock + max_total_turns 兜底（checkRunBudget 每轮重查）。
          action = 'retry';
        } else if (resolved.advance_blocked) {
          // E4（案B chrys 实证：advance_blocked 两次分别以不同 reason 出现——closure_open 类走
          // max_retries_per_phase 兜底但慢，agent_timeout_unclosed 类曾**无任何上限**、真无限
          // 重试）。累计（含本次）达到 ADVANCE_BLOCKED_HALT_THRESHOLD 即 halt 求人，不看具体
          // reason：script 门禁反复"PASS 却关不了环"本身就是这个 phase 结构性关不了环的信号——
          // 给一次重试机会（也许只是没来得及关环），第二次即不再自证突破。
          const cumulativeAdvanceBlocked =
            countCumulativeAdvanceBlocked(loadEventsJsonl(eventsPath), phase) + 1;
          if (cumulativeAdvanceBlocked >= ADVANCE_BLOCKED_HALT_THRESHOLD) {
            action = 'halt';
            haltReason = 'closure_wall_repeated';
            awaitConfirmGuidance = buildClosureWallGuidance({
              feature: manifest.feature,
              runId: manifest.run_id,
              phase,
              receiptPathRel: relFeatureFile(projectRoot, manifest.feature, `${phase}/phase-completion-receipt.md`),
              harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
              receiptStatus: summary?.receipt_status,
              cumulativeBlockedCount: cumulativeAdvanceBlocked,
            }).join('\n');
            console.log(`\n===== closure_wall_repeated =====\n${awaitConfirmGuidance}\n`);
          } else if (resolved.advance_block_reason === 'agent_timeout_unclosed') {
            // P0-B.5/§七.1（062613Z 病灶）：PASS+超时+闭环未完成的首次续跑不受 max_retries
            // 闸控（给一次机会补关环）；第二次即上面的累计分支接管，不再无限重试。
            action = 'retry';
          } else if (retries < manifest.budget.max_retries_per_phase) {
            action = 'retry';
          } else {
            action = 'halt';
            haltReason = resolved.advance_block_reason ?? 'closure_open';
          }
          // P0-3（plan 7c4f2e9b）：PASS+advance_blocked → 冻结 frozen deliverables。
          // 事故 i2 正是此态被重试后产物遭 i3 冷启动重写毁掉——快照落 runner trust-state
          // 独立命名空间，内存 digest 为同进程信任锚；已有活跃快照（violation 循环）不重取。
          // post-impl review P0#2：**可信快照完整建立是 closure retry 的前置条件**——
          // head 损坏/建立失败/表非空却零产物 一律 fail-closed halt（无保护重试=重开
          // 「PASS 产物被毁」的洞）；仅"该 phase 本无 frozen 保护面"（coding/ut 源码树
          // 产出走 closure-attestation）时按设计跳过。
          if (action === 'retry' && !dryRun) {
            let protectionFailure: string | null = null;
            try {
              const headNow = readPassSnapshotHead(projectRoot, manifest.feature, manifest.run_id, String(phase));
              if (headNow.mac === 'invalid') {
                protectionFailure = 'pass_snapshot head 损坏/跨协议/验签失败——不得在无保护下 closure retry';
              } else if (!passSnapshotMemory.has(String(phase)) || headNow.body?.state !== 'active') {
                if (!phaseHasFrozenSurface(phase)) {
                  // 设计内不适用（产出表全空：源码树产出由 closure-attestation 承载）
                } else {
                  const frozen = resolveFrozenDeliverables({ projectRoot, feature: manifest.feature, phase });
                  if (frozen.length === 0) {
                    protectionFailure = 'frozen 产出表非空但磁盘零产物——PASS 无产物属不变量违例';
                  } else {
                    const epoch = (headNow.body?.pass_epoch ?? 0) + 1;
                    const taken = takePassSnapshot({
                      projectRoot,
                      feature: manifest.feature,
                      runId: manifest.run_id,
                      phase: String(phase),
                      epoch,
                      files: frozen,
                    });
                    passSnapshotMemory.set(String(phase), { epoch, memoryDigest: taken.memoryDigest });
                    appendEvent(manifest.report_dir, projectRoot, {
                      type: 'pass_snapshot_taken',
                      phase,
                      invoke_id: invokeId,
                      pass_epoch: epoch,
                      manifest_sha256: taken.manifestSha256,
                      files: frozen.map(f => ({ rel: f.rel, sha256: f.sha256 })),
                    });
                  }
                }
              }
            } catch (e) {
              protectionFailure = `快照建立失败：${(e as Error).message}`;
            }
            if (protectionFailure) {
              action = 'halt';
              haltReason = 'pass_snapshot_unavailable';
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'phase_halt',
                phase,
                halt_reason: 'pass_snapshot_unavailable',
                detail: protectionFailure,
              });
              console.error(
                `\n===== pass_snapshot_unavailable =====\nPASS 产物无法建立可信冻结保护（${protectionFailure}）。\n` +
                '不做无保护 closure retry（那会重开「PASS 产物被毁」的洞）；人工核查 trust-state/产物后 --resume。\n',
              );
            }
          }
          // ------------------------------------------------------------
          // P0-5（plan 7c4f2e9b）：closure_kind 确定性分类——探针真值 total function，
          // 不从 advance_block_reason 映射（其 agentTimedOut 先行返回会掩盖 receipt 真值，
          // 保留为 telemetry）。fresh 复用 in-flow 探针；缺失（如超时被杀路径）才重探，
          // subprocess timeout 受 remaining wall-clock/FINALIZE_RESERVE 约束。
          // ------------------------------------------------------------
          if (action === 'retry' && !dryRun) {
            // P1#6（post-impl review）：probe timeout 严格受 remaining wall/finalize reserve
            // 约束——剩余 ≤0 时不再"保底 30s"突破预算；直接跳过分类（下一轮预算判据会
            // budget_wall_clock 终局），保持 retry 语义不变。
            const probeRemainingMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
            const probe = inFlowReceiptValidation ?? (probeRemainingMs > 5_000
              ? tryValidateReceipt(
                  path.join(frameworkRoot, 'harness'),
                  projectRoot,
                  phase,
                  manifest.feature,
                  { timeoutMs: Math.min(300_000, probeRemainingMs) },
                )
              : null);
            if (probe === null) {
              // post-impl round2 P1#3：closure-only 超时且无预算探针 → 仍不得回内容重试
              if (closureOnlyAttempt && invoke.timed_out === true) {
                action = 'halt';
                haltReason = 'closure_timeout';
                console.error('\n===== closure_timeout =====\nclosure-only attempt 超时且剩余预算不足以探针——halt 求人，不回内容重试。\n');
              } else {
                console.warn('[closure] 剩余预算不足以运行 receipt 探针——跳过 closure 分类（wall-clock 判据接管）');
              }
            } else {
            const route = classifyClosureKind(probe.status);
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'closure_kind_classified',
              phase,
              invoke_id: invokeId,
              probe_status: probe.status,
              closure_kind: route.kind === 'halt' ? undefined : route.kind,
              halt_reason: route.kind === 'halt' ? route.reason : undefined,
              probe_reused: inFlowReceiptValidation !== null,
            });
            if (route.kind === 'halt') {
              // error=探针自身崩溃（framework/toolchain 坏，调 agent「修 receipt」只会空转）；
              // not_applicable+advance_blocked=状态机不变量违例（lite 本不产生 receipt）。
              action = 'halt';
              haltReason = route.reason;
              console.error(
                `\n===== ${route.reason} =====\n` +
                (route.reason === 'closure_probe_error'
                  ? `receipt 探针自身执行失败（${(probe.message ?? '').slice(0, 300)}）——framework/toolchain 问题，不派 agent 修 receipt；人工修复后 --resume。\n`
                  : 'lite track 不产生 receipt 却出现 advance_blocked——runner 状态机不变量违例，请回灌源仓核查。\n'),
              );
            } else if (route.kind === 'deterministic_recheck') {
              // runner 不调 agent：正式 receipt state sync/closure patch → 直接推进
              const syncExit = runSyncClosure(
                path.join(frameworkRoot, 'harness'),
                projectRoot,
                manifest.feature,
                String(phase),
                frameworkRoot,
              );
              // round3 P1#4 + round4 P1#3：分流收敛为纯函数（矩阵测试锁定契约）
              const syncOutcome = resolveClosureSyncOutcome(syncExit, closureOnlyAttempt, invoke.timed_out === true);
              if (syncOutcome === 'advance') {
                action = 'advance';
                haltReason = undefined;
                console.log('[closure] deterministic_recheck：receipt 已验真，runner 完成 sync-closure，phase 推进（不调 agent）');
              } else if (syncOutcome === 'closure_timeout') {
                action = 'halt';
                haltReason = 'closure_timeout';
                console.error(
                  `\n===== closure_timeout =====\ndeterministic sync-closure 非零退出（${syncExit}）且 closure-only attempt 已超时——halt 求人，不回内容重试。\n`,
                );
              } else {
                console.warn(`[closure] deterministic_recheck sync-closure 非零退出（${syncExit}）——回落 receipt_repair_with_verifier`);
              }
            }
            // receipt_repair_with_verifier：保持 retry；预算=该 phase 当前完整 effective
            // （P0-5 高水位棘轮已保证不回落），不虚构 verifier-only 校准值。
            // post-impl round2 P1#3：**closure-only attempt 已超时**时 repair 不得再 retry
            // ——OpenSpec：closure timeout 交人工处置 never re-enter retries（probe=passed
            // 的 deterministic 直通仍保留：runner 自己关环不消耗 agent attempt）。
            if (
              action === 'retry' &&
              route.kind === 'receipt_repair_with_verifier' &&
              closureOnlyAttempt &&
              invoke.timed_out === true
            ) {
              action = 'halt';
              haltReason = 'closure_timeout';
              console.error(
                '\n===== closure_timeout =====\nclosure-only attempt 超时且 receipt 需 repair——不回内容重试，halt 求人。\n',
              );
            }
            }
          }
        }

        const agentWarn = buildAgentWarn(invoke);

        appendEvent(manifest.report_dir, projectRoot, {
          type: 'phase_verdict',
          phase,
          // P0-1 rev6：attempt 窗口按 invoke_id 精确切分（continuation 五态派生消费）。
          invoke_id: invokeId,
          verdict,
          action,
          harness_exit: harnessExit,
          stale_summary: resolved.stale_summary,
          agent_failed: resolved.agent_failed,
          blocking_class: meta.blocking_class,
          failure_kind: meta.failure_kind,
          // P1-8（plan d9b4f7e2）：PASS+advance 不输出 failure_kind_classified——07-13 案
          // 全部 advance 事件带着 code_regression 字样，事后排障已实际造成误导。
          failure_kind_classified:
            verdict === 'PASS' && action === 'advance' ? undefined : failureKind,
          blocker_signature: currentBlockerSignature || undefined,
          // P0-5：integrity subtype 多值透传（事后排障/报告消费；空列表不写）。
          integrity_subtypes: integritySubtypes.length > 0 ? integritySubtypes : undefined,
          // E4：持久化 advance_blocked 状态，供下一次 attempt 的 countCumulativeAdvanceBlocked
          // 事件回放统计使用（events.jsonl 是唯一 SSOT，非内存计数，resume/detach 重启不丢）。
          advance_blocked: resolved.advance_blocked || undefined,
          advance_block_reason: resolved.advance_block_reason,
          // P1-6（plan 7c4f2e9b）：四轴时间线的 artifact delta 轴（watched artifact 快照对比；
          // restored 语义由 pass_snapshot_restored 事件承载，时间线侧优先）
          artifact_delta:
            priorArtifactSnapshot && Object.keys(currentArtifactSnapshot).length > 0
              ? (artifactsProgressed(priorArtifactSnapshot, currentArtifactSnapshot) ? 'changed' : 'unchanged')
              : undefined,
          halt_reason: haltReason,
          interaction_question: interactionSentinel?.error,
          // P0-B/P0-D 诚实归因：让下游排障者（人/AI）一眼见真因，不再有"缺 API key"式臆造空间。
          api_error_excerpt: apiErrorSentinel?.matchedLine,
          agent_duration_ms: invoke.duration_ms,
          timeout_budget_ms: invoke.timed_out === true ? effectiveAgentTimeoutMs : undefined,
          // codex P2：agent 非零退出时保真 stderr（binary 不可 spawn 的 preflight 诊断就在这里）。
          agent_stderr_excerpt:
            invoke.exitCode !== 0 && invoke.stderr.trim()
              ? truncateOneLine(invoke.stderr.trim(), 400)
              : undefined,
        });
        emitMilestone(`GOAL_PHASE phase=${phase} event=verdict result=${action}`);
        flushProgress();

        // visual-capability-truth S4：review 闭环后的可变阶段（ut/testing）在任何推进/
        // 重试决策生效前做 runner 级 source drift reconciliation——先分类后动作
        // （codex plan 审查一轮 B4：不见码就回退=给非法改码洗白的通道）：
        //   授权链命中 → 自动回退 coding（review/ut 失效，增量重点复审）；
        //   未授权/超界/无 receipt → HALT（人工裁决后可显式授权）。
        if (!dryRun && (phase === 'ut' || phase === 'testing') && action !== 'retry') {
          const driftDecision = reconcileMutablePhaseSourceDrift({
            projectRoot,
            manifest,
            phase,
            frozenManifestHash,
          });
          if (driftDecision.kind === 'authorized_backtrack') {
            if (backtracksUsed >= 1) {
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'phase_halt',
                phase,
                halt_reason: 'backtrack_limit',
                verdict,
              });
              console.error('\n===== backtrack_limit =====\n授权回退已达上限（1 次/run）——仍出现源码 drift，halt 求人（防回退震荡烧预算）。\n');
              outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'backtrack_limit' });
              halted = true;
              phaseDone = true;
              continue;
            }
            backtracksUsed++;
            const codingIdx = chain.indexOf('coding' as FeaturePhase);
            const invalidatedPhases = chain
              .slice(codingIdx >= 0 ? codingIdx : 0, phaseIdx + 1)
              .filter(p => outcomes.some(o => o.phase === p));
            // P0-3（plan 7c4f2e9b，codex 七/八轮）：失效走可恢复事务——journal pending →
            // 全部受影响 pass_snapshot head/tombstone → 幂等事件（携 tx_id）→ commit。
            // events 仅审计投影；恢复资格 SSOT 在 trust-state journal/head。
            const invalidationTxId = `${manifest.run_id}-bt${backtracksUsed}`;
            if (!dryRun) {
              beginInvalidationTx({
                projectRoot,
                feature: manifest.feature,
                runId: manifest.run_id,
                causePhase: String(phase),
                invalidatedPhases: invalidatedPhases.map(String),
                txId: invalidationTxId,
              });
              for (const p of invalidatedPhases) passSnapshotMemory.delete(String(p));
            }
            for (const p of invalidatedPhases) {
              appendEvent(manifest.report_dir, projectRoot, {
                type: 'phase_invalidated',
                phase: p,
                cause_phase: phase,
                reason: 'authorized_source_mutation_backtrack',
                invalidation_tx_id: invalidationTxId,
                files: driftDecision.files.slice(0, 20),
              });
            }
            if (!dryRun) commitInvalidationTx(projectRoot, manifest.feature, manifest.run_id, invalidationTxId);
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_backtrack_requested',
              from_phase: phase,
              to_phase: chain[Math.max(codingIdx, 0)],
              matched_receipts: driftDecision.matched.map(r => r.approved_by),
              files: driftDecision.files.slice(0, 20),
            });
            appendEvent(manifest.report_dir, projectRoot, { type: 'phase_backtrack_started', to_phase: chain[Math.max(codingIdx, 0)] });
            // 被失效 attempt 从 outcomes 剔除（goal report/resume 只见最新有效 attempt；
            // 常驻 summary 将被回退后的重跑覆盖，upstream gate 消费面天然新鲜化）
            outcomes = outcomes.filter(o => !invalidatedPhases.includes(o.phase));
            // 增量重点复审清单注入（回退后 review prompt 消费）
            backtrackReviewFocus = driftDecision.files;
            backtrackToIdx = Math.max(codingIdx, 0);
            appendEvent(manifest.report_dir, projectRoot, { type: 'phase_backtrack_completed', to_phase: chain[backtrackToIdx] });
            console.log(
              `[S4] 授权源码变更（${driftDecision.files.length} 文件，receipts=${driftDecision.matched.map(r => r.approved_by).join(',')}）` +
              `→ 回退 ${chain[backtrackToIdx]}→review→ut→${phase}（消耗回退预算 1/1）`,
            );
            phaseDone = true;
            continue;
          }
          if (driftDecision.kind === 'unauthorized') {
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'phase_halt',
              phase,
              halt_reason: 'unauthorized_source_mutation',
              verdict,
              files: driftDecision.files.slice(0, 20),
              violations: driftDecision.violations.slice(0, 10),
            });
            console.error(
              `\n===== unauthorized_source_mutation =====\n${phase} 期产品源码变更未命中可信授权链（不自动回退洗白）：\n` +
              driftDecision.violations.map(v => `  - ${v}`).join('\n') +
              '\n人工裁决：确属合法变更 → 写入授权 receipt（mutation-authorizations.jsonl，三源之一）后 --resume；否则还原变更。\n',
            );
            outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'unauthorized_source_mutation' });
            halted = true;
            phaseDone = true;
            continue;
          }
        }

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
          priorAttemptApiError = failureKind === 'transient_api_error';
          if (failureKind === 'transient_api_error') {
            // P0-D：backoff 重试——独立计数、不吃 max_retries_per_phase；事件先于 sleep
            // 落盘（用户看到"退避中"而非"卡住"；跨 resume 计数也靠它派生）。sleep 计入
            // wall_clock（下一轮 checkRunBudget 重查）。backoff 修不了断掉的 TCP——只买
            // 到几次自动重试 + 诚实归因，长会话必断的网络仍需换代理/交互跑。
            transientRetriesUsed++;
            const configuredBackoffMs =
              TRANSIENT_API_BACKOFF_MS[
                Math.min(transientRetriesUsed - 1, TRANSIENT_API_BACKOFF_MS.length - 1)
              ];
            // P0-4 rev6：backoff 是第四条等待路径——无条件 sleep 会在 wall 只剩几秒时
            // 先睡满 45s 突破 deadline。复审收紧（codex P2）：剩余预算装不下**配置值**
            // 就直接终局（canAffordBackoff 纯函数，单测钉行为），不睡截断的残量。
            const backoffAvailableMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
            const backoffMs = configuredBackoffMs;
            if (!canAffordBackoff(configuredBackoffMs, backoffAvailableMs)) {
              halted = true;
              appendEvent(manifest.report_dir, projectRoot, { type: 'budget_wall_clock', phase });
              outcomes.push({
                phase,
                verdict: 'FAIL',
                halted: true,
                retries,
                halt_reason: 'budget_wall_clock',
              });
              phaseDone = true;
              continue;
            }
            appendEvent(manifest.report_dir, projectRoot, {
              type: 'transient_api_retry_scheduled',
              phase,
              attempt: transientRetriesUsed,
              max_attempts: manifest.budget.max_transient_api_retries,
              backoff_ms: backoffMs,
              api_error_excerpt: apiErrorSentinel?.matchedLine,
            });
            flushProgress();
            await sleepMs(backoffMs);
          } else if (failureKind === 'agent_timeout') {
            // P0-B.5：超时+有进展的续跑不吃内容重试预算（零进展熔断由 guard 负责，
            // wall_clock + max_total_turns 全局兜底）。
          } else {
            retries++;
          }
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
          ...((haltReason === 'await_human_visual_confirm' ||
            haltReason === 'closure_wall_repeated' ||
            haltReason === 'await_human_p0_skip' ||
            haltReason === 'framework_integrity_block' ||
            haltReason === 'framework_bug' ||
            haltReason === 'agent_timeout_repeated') &&
          awaitConfirmGuidance
            ? { halt_guidance: awaitConfirmGuidance }
            : {}),
          // P0-5：integrity subtype 多值透传进最终报告。
          ...(integritySubtypes.length > 0 ? { integrity_subtypes: integritySubtypes } : {}),
          interaction_question: interactionSentinel?.error,
          // codex P3：诊断保真进最终报告——只读 goal-report 的下游也能看到真因原文。
          failure_kind_classified: failureKind,
          api_error_excerpt: apiErrorSentinel?.matchedLine,
          agent_duration_ms: invoke.duration_ms,
          agent_stderr_excerpt:
            invoke.exitCode !== 0 && invoke.stderr.trim()
              ? truncateOneLine(invoke.stderr.trim(), 400)
              : undefined,
        });
        halted = true;
        phaseDone = true;
      }

      if (halted) break;
      // S4：授权回退——跳回 coding（for 递增后落位），review/ut/testing 依链重走。
      if (backtrackToIdx !== null) {
        phaseIdx = backtrackToIdx - 1;
        backtrackToIdx = null;
      }
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
    // t8/P1-1/P1-2：全链跑完时消费真实门禁信号（与 completion 生成同源 issues 集）——
    // needs_human（flow_contract/waiver/档位钳制/待复核/运行时证据）→ AWAITING_HUMAN_REVIEW；
    // needs_fix（verdict FAIL/stale/tampered/attestation 失配）→ 不得 CHAIN_SLICE_COMPLETED
    // （codex 八轮 P1-2：needs_fix 之前被写成成功态是强错觉）。
    let pendingHumanReview = false;
    let blockingFix = false;
    if (reachedEnd) {
      const cls = classifyCleanPassIssues(
        collectCleanPassIssues({
          projectRoot,
          feature: manifest.feature,
          chain: fullWorkflowChain.map(String),
          currentRequirementSha: computeRunRequirementSha(projectRoot, manifest.feature, manifest.run_id, featuresDir),
        }),
      );
      pendingHumanReview = cls.needsHuman;
      blockingFix = cls.needsFix;
    } else {
      pendingHumanReview = countPendingMustReview(collectAutoDecisions(projectRoot, manifest.feature, chain.map(String))) > 0;
    }
    // 七轮 P0-1：vision 信任封顶——UI 相关 run 在无 authenticated checkpoint（未配 HMAC
    // 密钥）或仅弱 ack（旗标非真人凭证）时不得产出 clean completion。UI 相关性按运行末态
    // 判定（vision 账本已存在 或 spec 声明 UI 变更）；非 UI run 不受影响。
    const uiRelevantAtEnd = (() => {
      try {
        if (
          fs.existsSync(artifactAttestationsPath(projectRoot, manifest.feature)) ||
          fs.existsSync(policyDowngradesPath(projectRoot, manifest.feature))
        ) return true;
        const specMdAtEnd = loadSpecMarkdown(projectRoot, manifest.feature);
        const uc = specMdAtEnd ? parseUiChangeFromSpecMarkdown(specMdAtEnd) : null;
        return Boolean(uc && UI_CHANGE_REQUIRES_UI_SPEC.has(uc));
      } catch {
        return true; // 判定不了按 UI 相关处理（fail-closed 方向）
      }
    })();
    const rawStatus = resolveGoalRunStatus(phaseRecords, reachedEnd, { pendingHumanReview, blockingFix });
    const visionCap = capRunStatusForVisionTrust(rawStatus, {
      uiRelevant: uiRelevantAtEnd,
      hmacKeyPresent: Boolean(process.env[VISION_CHECKPOINT_HMAC_ENV]),
      ackWeak: visionAckWeak,
    });
    if (visionCap.capped) {
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'vision_trust_completion_cap',
        from: rawStatus,
        to: visionCap.status,
        reason: visionCap.reason,
      });
      console.warn(
        `[S3] vision 信任封顶：${rawStatus} → ${visionCap.status}（${visionCap.reason}）——` +
        `配置 ${VISION_CHECKPOINT_HMAC_ENV} 获得 authenticated checkpoint / 提供受信 ack receipt 后方可 clean completion`,
      );
    }
    const status = visionCap.status as ReturnType<typeof resolveGoalRunStatus>;
    const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, outcomes);
    writeGoalReport(projectRoot, manifest.report_dir, report, {
      workflowChain: fullWorkflowChain.map(String),
    });
    // t3-min v3（codex 高优6 / openspec capability-gap-preflight）：terminal event 携带
    // halt_reason——取最后一个 halted outcome 的原因（await_human_capability_gap 等），
    // 消费方无需回扫 phase_halt 事件即可分类终态。v5 抽 helper 使语义可单测。
    const lastHaltReason = resolveLastHaltReason(outcomes);
    appendEvent(manifest.report_dir, projectRoot, {
      type: 'run_end',
      status,
      ...(status === 'HALTED' && lastHaltReason ? { halt_reason: lastHaltReason } : {}),
    });

    // P0-4（rev8 偏离① 定稿口径）：硬上界只覆盖 agent/harness/backoff 三路径；run_end 后
    // 收尾为 **pre-check 拦截的 best-effort**——同步 fs 工作无进程内可执行 bound（同步
    // 挂起时 timer/watchdog 均不运行），硬中断=进程自杀会写坏 receipt。本 pre-check 挡
    // "开始前已超支"（finalize_skipped）；已开始步骤的越界由下方 finalize_overrun 事件
    // 如实记录（喂开放问题 4 的 reserve 取值回灌）。真硬界=worker/child 隔离，开放问题 5。
    const finalizeStartMs = Date.now();
    const finalizeDeadlineExceeded = finalizeStartMs > wallDeadlineMs;
    if (finalizeDeadlineExceeded) {
      appendEvent(manifest.report_dir, projectRoot, { type: 'finalize_skipped', phase: undefined });
      console.warn(
        '[goal-runner] wall deadline 已过——跳过 best-effort 收尾（completion receipt 等），事件已留痕 finalize_skipped',
      );
    }

    // t8：feature 完成凭证——仅当全链（按 track 解析）逐阶段 clean_pass 才生成；
    // 生成失败/不满足只记录，不改变 run 终局（feature 级状态由 verify-feature-completion 判）。
    if (!finalizeDeadlineExceeded && status === 'CHAIN_SLICE_COMPLETED') {
      try {
        const issues = collectCleanPassIssues({
          projectRoot,
          feature: manifest.feature,
          chain: fullWorkflowChain.map(String),
        });
        if (issues.length === 0) {
          const { runIds: phaseRunIds, attempts: phaseAttempts } = resolvePhaseRunIds(
            projectRoot, manifest.feature, fullWorkflowChain.map(String),
          );
          for (const o of outcomes) phaseRunIds[String(o.phase)] = manifest.run_id;
          const { originalAbs } = generateFeatureCompletion({
            projectRoot,
            feature: manifest.feature,
            chain: fullWorkflowChain.map(String),
            workflowTrack: goalTrack,
            runId: manifest.run_id,
            runDirAbs: path.join(projectRoot, manifest.report_dir),
            phaseRunIds,
            phaseAttempts,
            supersedes: supersededRunIds,
          });
          emitMilestone(
            `GOAL_RUN event=feature_completion_generated path=${path.relative(projectRoot, originalAbs).replace(/\\/g, '/')} run_id=${manifest.run_id}`,
          );
        } else {
          emitMilestone(
            `GOAL_RUN event=feature_completion_skipped reason=non_clean_pass pending=${issues.length} run_id=${manifest.run_id}`,
          );
        }
      } catch (err) {
        console.warn(`[goal-runner] feature completion 生成失败（不影响 run 终局）：${(err as Error).message}`);
      }
    }
    // P0-4 复审（codex P1）：收尾越过 deadline 的如实留痕——同步工作不可中断，超支量
    // 进 events 供 FINALIZE_RESERVE 取值回灌（开放问题 4）。
    if (!finalizeDeadlineExceeded && Date.now() > wallDeadlineMs) {
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'finalize_overrun',
        duration_ms: Date.now() - finalizeStartMs,
      });
      console.warn(
        `[goal-runner] 收尾越过 wall deadline（收尾耗时 ${Date.now() - finalizeStartMs}ms）——已留痕 finalize_overrun；如反复出现请上调 FINALIZE_RESERVE_MS`,
      );
    }
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
