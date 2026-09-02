#!/usr/bin/env ts-node
// ============================================================================
// Goal phase runtime (fenced session/process owner) — deterministic multi-phase orchestrator
// ============================================================================
// Usage (from repo root or instance root):
//   cd framework/harness && npx ts-node scripts/goal-runner.ts \
//     --feature <f> --requirement "..." --adapter claude \
//     [--start spec] [--end testing] [--dry-run] [--resume <run-id> --feature <f>]
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import minimist from 'minimist';
import {
  loadFrameworkConfig,
  loadFrameworkConfigWithSources,
  featurePhaseReportsDir,
  featureDir,
  featureArtifactPath,
  receiptDirPath,
  relFeatureFile,
  resolveFeatureArtifact,
} from '../config';
import { detectRepoLayout, type RepoLayout } from '../repo-layout';
import { deleteEnvKeyCaseInsensitive, sanitizeSpawnEnv } from './utils/process-integrity';
// d9e4b7c1 T2：device_test 缺陷进回修环——evidence schema/路径、权威 trace 二次核验、根/级联三分
import {
  deviceTestEvidencePath,
  type DeviceDefectClassification,
  type DeviceTestEvidenceCase,
  type DeviceTestEvidenceDoc,
} from './utils/device-test-evidence-shared';
import { resolveAuthoritativeHylyreTracePath } from './utils/testing-trace-gates';
import { parseTestCaseFlowBlock, triageCascade } from './utils/test-case-flow';
import {
  buildAgentTimeoutRepeatedGuidance,
  buildBudgetExhaustedGuidance,
  buildUnauthorizedMutationGuidance,
  buildClosureWallGuidance,
  buildFrameworkBugGuidance,
  buildFrameworkIntegrityGuidance,
} from './utils/await-confirm-guidance';
import {
  decide,
  NO_AUTHORITY,
  runDispositionFields,
  UNTRUSTED_DRIFT_REASON,
  withRunDisposition,
  type Decision,
} from './utils/adjudication';
import { writeLivenessBeacon } from './utils/liveness-beacon';
import { loadResolvedProfile } from '../profile-loader';
import { tryLoadUtSourceRootResolver } from '../profile-host-loader';
import { runCapabilityPreflight, emitHarnessPreflightGap } from './utils/capability-preflight';
import { preflightDeviceTestEvidenceCapability } from '../capability-registry';
import type { HarnessResolvedProfile, ProviderRef, VisionMode } from './utils/types';
import { resolveWorkflowSpec } from '../workflow-loader';
import { resolveContextAdapterImageInput, isFreshCanaryForExecution } from './utils/multimodal-probe';
import { loadLocalConfig as loadFrameworkLocalConfig } from './utils/framework-local-config';
import {
  clampFidelityByCapability,
  computeRequirementShaFromText,
  loadCapabilitySnapshot,
  loadFidelityIntentSsot,
  loadInertLegacyFidelityIntentSsot,
  listAuthoritativeGoalRuns,
  computeRunRequirementSha,
  dereferenceRequirementDocs,
  detectPixel1to1Intent,
  detectUiRelevantRequirement,
  loadProfileOcrToolkit,
  loadSpecMarkdown,
  parseFidelityTargetFromHandoffDoc,
  resolveOcrAvailableForRun,
  resolveRequirementReferenceImages,
  type FidelityTarget,
} from './utils/fidelity-shared';
import {
  parseUiChangeFromSpecMarkdown,
  parseVisualHandoffYamlRoot,
  UI_CHANGE_REQUIRES_UI_SPEC,
} from './utils/ui-spec-shared';
import {
  DEFAULT_MAX_BACKTRACKS,
  featurePhasesFromWorkflow,
  formatDeferredUpstreamNotice,
  recommendationAuthorized,
  resolveAutoChain,
  resolveGoalRunStatus,
  type FeaturePhase,
  type GoalRunStatus,
  type HarnessVerdict,
} from './utils/phase-transition-policy';
import { recomputePhaseEvidenceStaleness, stableStringify } from './utils/phase-evidence-manifest';
import { loadReviewClosureAttestation } from './utils/closure-attestation';
import {
  classifyCleanPassIssues,
  collectCleanPassIssues,
  generateFeatureCompletion,
  resolvePhaseRunIds,
} from './utils/verify-feature-completion';
import { resolveFeatureTrack } from './utils/runtime-policy';
import { loadAcceptanceFlowsDoc, isP0DeviceInteractive } from './utils/p0-semantic-gates';
import { loadFeatureTrackDecl } from './utils/feature-track';
import { mergeUsageIntoTraceFile } from './utils/usage-capture';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  computeManifestIdentityHash,
  diffManifestIdentityFields,
  inheritSuccessorManifest,
  loadGoalManifestFile,
  loadGoalManifestFromRun,
  newRunId,
  resolveGoalReportDir,
  resolvePersistedAdapterProvenance,
  resolveRawRunInput,
  resolveRequirementInput,
  restoreFrozenAdapterProvenance,
  type RawRunInput,
  isSuccessorRepairRequirement,
  mergeSuccessorRequirement,
  overrideAuthorizedIdentityFields,
  writeGoalManifest,
  effectiveHeadlessUnattended,
  type GoalManifest,
} from './utils/goal-manifest';
import {
  assertGoalRunAttachable,
  buildSupersedeAuditEvent,
  createGoalRun,
  inspectGoalRunCreation,
  inspectGoalRunCreationFiles,
  resolveActualGoalPhaseChainAtBirth,
  resolveGoalRunHeadSha,
  validateRebaselineRequest,
  type GoalRunCreationResult,
} from './utils/goal-run-creation';
import { resolveGoalRunBaseline } from './utils/goal-run-baseline';
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
// openspec device-readiness-and-completion t3：设备就绪门（独立异步门，排在 capability
// gate 之后、agent_invoke_start 之前；未 READY 不调 agent）
import { phaseRequiresDevice } from './utils/phase-device-requirement';
import {
  chainRequiresProduct,
  goalProductPurpose,
  resolveProductSelectionViaProfile,
} from './utils/product-selection-bridge';
import { runDeviceReadinessGate } from './utils/device-readiness-gate';
import { buildDeviceReadinessInput } from './utils/device-readiness-deps';
import {
  capsTestingConclusion,
  collectForeignManagedSessions,
  defaultProcessProbe,
  readDeviceSession,
  reclaimManagedDevice,
  registerManagedDeviceCleanup,
  writeDeviceSession,
  type DeviceTargetKind,
} from './utils/device-session';
import { createCompletionProbe } from './utils/phase-completion-probe';
import { tryCloseUpstreamPhase } from './utils/upstream-closure';
import {
  deriveResumeInspection,
  buildResumeSkipLines,
  deriveReportSections,
  deriveAndWriteCheckpoint,
} from './utils/goal-checkpoint';
import {
  generateGoalReportJson,
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
  type HeadlessInvokePlan,
  type InvokeTemplateVars,
} from './utils/agent-invoke';
import {
  createPhaseExecutionContext,
  DetachedGoalPhaseExecutor,
  validatePhaseExecutionContext,
  type GoalPhaseExecutor,
  type GoalPhaseExecutorResult,
  type PhaseExecutionContext,
} from './utils/goal-phase-executor';
import { parseClaudeInitModel, resolvePinVerifyMismatch } from './utils/claude-envelope';
import {
  deleteRunTrustState,
  isValidRunIdBasename,
} from './utils/pass-snapshot';
import {
  checkPlanAuthority,
  resolveScopeReplanContext,
  sanitizeScopeReplanFiles,
  tryScopeReplan,
  type ScopeReplanPromptContext,
} from './utils/scope-replan';
import { createHash } from 'crypto';
import {
  produceCriticReceipt,
  produceSpecRefsReceipt,
  sha256FileFull,
  specRefsReceiptPath,
} from './utils/critic-receipt-producer';
import { collectAuthoritativeImagePaths } from './utils/multimodal-probe';
import {
  buildInlineCanaryBlock,
  generateRandomCanaryAnswerKey,
  renderCanaryImage,
  resolveCanaryCacheDecision,
  resolveCanaryStdoutEnvelope,
  resolveInvokeHardCliFailure,
  type CanaryAnswerKey,
} from './utils/vision-canary';
import * as os from 'os';
import {
  capabilityReceiptPath,
  writeCapabilityReceipt,
} from './utils/effective-vision-context';
import { reconcileSourceTreeAgainstAttestation } from './utils/closure-attestation';
import {
  classifySourceDrift,
  computeCurrentDriftFingerprint,
  sha256FileHex,
  type DriftClassification,
  type DriftFingerprintEntry,
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
  findLatestInvokeHarnessFailure,
  isClosureOnlyRetryPending,
  loadAuthoritativeEvents,
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  foldBudgetLineage,
  collectSupersededAncestorEvents,
  resolveResumeFromEvents,
  rebuildOutcomesFromEvents,
  loadEventsJsonlStrict,
  countCumulativeAdvanceBlocked,
  countRepeatedSignatureInFamily,
  classifyClosureKind,
  resolveClosureSyncOutcome,
  shouldHaltClosureTimeout,
  type ContinuationCause,
} from './utils/goal-runner-phase';
import { finalizePhaseClosure } from './utils/phase-closure-finalizer';
import {
  awaitGuardianGone,
  identifyWithRetry,
  reconcileGuardianOwnership,
  terminateGuardianProcessOnly,
} from './utils/goal-containment-reconcile';
import {
  reconcileLedgerWithEvents,
  visualRoundsLedgerPath,
} from './utils/visual-rounds-ledger';
import {
  applyClosurePatchFromReceiptValidation,
  applyGoalModelPinEnv,
  applyGoalVisualProviderEnv,
  hasGoalExecutionSignal,
  isGoalHeadlessEnv,
  MAISON_GOAL_MODEL_PIN_ENV,
  MAISON_GOAL_RUNNER_ENV,
  runSyncClosureDetailed,
  syncPhaseStateOnReceiptPassStrict,
  tryValidateReceipt,
} from './utils/phase-state';
import { writeReceiptScaffold } from './utils/receipt-scaffold';
import {
  actionableDefectsToCandidates,
  mergeRepairCandidatesIntoSummary,
  resolveInvalidatablePhases,
  restoreBacktrackCandidatesFromEvents,
  roundFingerprintOfCandidates,
  type RepairCandidate,
} from './utils/repair-candidates';
import { mapCategoryToChainPhase } from './utils/correction-routing';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import { deriveReconcileObservation } from './utils/goal-reconcile-observation';
import { validateMinimumAssurance } from './utils/skill-contract';
import {
  assessFeature,
  type AssessAuthorizationContext,
  type AssessRecommendation,
} from './utils/assess';
import type { DriverGuardAction } from './utils/goal-assess-driver';
import { createGoalReconcileBoundary } from './utils/goal-reconcile-boundary';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
  reconcileRunAdapter,
  decideVisionCanaryProbe,
  runVisionCanaryProbe,
  evaluateFidelityTierPreflight,
  initializeFidelityRouting,
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
  setLockEpoch,
  touchLock,
  tryAcquireLock,
  type LockRecord,
} from './utils/goal-run-lock';
import {
  acceptConsumedHandoff,
  consumeHandoffAtBoundary,
  type HandoffMailboxQuarantine,
  readHandoffRequest,
} from './utils/goal-handoff';
import { quiesceRunOwner } from './utils/goal-run-control';
import {
  assertFencedOwner,
  casAcquireRunOwner,
  ensureRunControl,
  forceTakeoverRunOwner,
  markExpiredSessionOrphaned,
  readRunControl,
  releaseRunOwner,
  renewSessionLease,
  type RunFenceToken,
  type RunOwnerKind,
} from './utils/goal-run-control';
import { snapshotPhaseHarness } from './utils/goal-phase-snapshot';
import {
  applyManifestCliOverrides,
  validateManifestCliOverrides,
  normalizeAdapterModelCliValue,
  resolveFinalModelPin,
  normalizeVisualProviderCliPair,
  resolveFinalVisualProviderPin,
  type ManifestCliArgv,
} from './utils/goal-manifest-cli';
import {
  assertVisualProviderCliSupported,
  resolveUnattendedVisualProviderPin,
  resolveVisionModeForRun,
  reviewVisionForMode,
} from './utils/visual-provider-identity';
import {
  buildVisualProviderInvokeEvent,
  type VisualProviderInvocation,
} from './utils/visual-provider-invoke';
import {
  listVisualObservationOutputs,
  produceVisualObservationSidecars,
} from './utils/visual-observation-sidecar';
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
  stripRetiredFrameworkIntegrityForCurrentRun,
  isOperatorInterruptSignal,
  shouldHaltNoProgress,
  snapshotArtifacts,
  ADVANCE_BLOCKED_HALT_THRESHOLD,
  CUMULATIVE_HALT_FAMILY,
  CUMULATIVE_HALT_THRESHOLD,
  EXTERNAL_RETRY_RESPONSIBILITY_KINDS,
  resolveAssessHaltIncident,
  type ArtifactSnapshot,
  type FailureKind,
} from './utils/goal-failure-classifier';
import {
  parseHeadlessApiError,
  parseHeadlessInteractionSentinel,
} from './utils/goal-headless-sentinel';
// plan d8c5f3a7 T4：testing 零写入 enforcement 用的**精确**源码快照（不是轻量
// computeProductWorktreeDigest——后者仅 16 hex 且对二进制走文本 diff，恰好在本 plan
// 要保护的 PNG 素材上失明）
import {
  computeProductSourceSnapshotDetail,
  diffProductSourceSnapshots,
  isUsableSnapshot,
  type ProductSourceSnapshotDetail,
} from './utils/product-source-snapshot';
import {
  capturePhaseInvocationSnapshot,
  classifyPhaseInvocationChanges,
  diffPhaseInvocationSnapshots,
  renderPhaseWriteBoundaryGuidance,
  resolvePhaseWriteBoundary,
  type PhaseWriteBoundaryResolution,
  type PhaseInvocationChange,
} from './utils/phase-write-boundary';
// plan f4c8d2b7 t6：ut 阶段 prompt 注入机器产物格式契约（路径解析自 skill-assets SSOT）
import { renderUtFormatContractLines } from './utils/ut-template-paths';


/** features_dir 相对路径（写入边界判定用） */
function featuresDirRelOf(projectRoot: string): string {
  try {
    return (loadFrameworkConfig(projectRoot).paths.features_dir ?? 'doc/features').split(path.sep).join('/');
  } catch {
    return 'doc/features';
  }
}

/** 产品源码层目录（architecture.outer_layers）——快照范围；配置不可读 → 空集（消费点 fail-closed） */
function productLayerDirsOf(projectRoot: string): string[] {
  try {
    return (loadFrameworkConfig(projectRoot).architecture?.outer_layers ?? []).map(l => l.id);
  } catch {
    return [];
  }
}

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
  closure_commit?: {
    schema_version?: string;
    committed_at?: string;
    receipt_path?: string;
    evidence_manifest_path?: string;
  };
  next_action?: string;
  blockers?: Array<{
    id?: string;
    blocking_class?: string;
    classification?: string;
    details_excerpt?: string;
    affected_files?: string[];
    suggestion?: string;
  }>;
  repair_candidates?: RepairCandidate[];
}

/** Active agent tree-kill registered for SIGINT/SIGTERM orphan cleanup. */
let activeAgentKill: (() => Promise<void>) | null = null;
/** Active harness-runner tree-kill (runHarnessPhase async spawn). */
let activeHarnessKill: (() => Promise<void>) | null = null;
let featureLock: { path: string; ownerId: string; interval?: NodeJS.Timeout } | null = null;
let runLock: { path: string; ownerId: string } | null = null;
let runControl: { dir: string; token: RunFenceToken } | null = null;


/** Runtime substep for heartbeat / progress projection. */
let progressSubstep: 'agent_invoke' | 'harness' | 'prompt' | 'verdict' | null = null;
let progressPhase: FeaturePhase | null = null;
let progressHeartbeatHook: (() => void) | null = null;

/** Set once the manifest is loaded; lets signal/exit handlers locate events.jsonl. */
let terminalEventCtx: {
  reportDir: string; projectRoot: string;
  /** T1①：优雅收口要生成报告，须知道 run 身份 */
  runId: string; feature: string;
  /** codex 第九批 P1：报告阶段视图从 events 重建（不写空表抹掉 resume 进度）——须知道链 */
  chain: FeaturePhase[]; workflowChain: string[];
} | null = null;
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

/** codex 第九批收尾 P3：进程级幂等——`main()` 可被程序化多次调用（driver/测试），
 * 重复注册会累积 SIGINT/SIGTERM/SIGBREAK handler（全量 unit 已触发
 * MaxListenersExceededWarning）。布尔守卫即可，不引入新生命周期机制。 */
let signalHandlersInstalled = false;

function setupSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
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
  if (runControl) {
    try { releaseRunOwner(runControl.dir, runControl.token, { allowQuiescing: true }); }
    catch { /* stale owner or already released */ }
  }
  if (featureLock?.interval) clearInterval(featureLock.interval);
  if (featureLock) releaseLock(featureLock.path, featureLock.ownerId);
  if (runLock) releaseLock(runLock.path, runLock.ownerId);
  featureLock = null;
  runLock = null;
  runControl = null;
}

function assertGoalBoundary(boundary: string): void {
  if (runControl) assertFencedOwner(runControl.dir, runControl.token, boundary);
}

/** plan e7c2a4d8 T1b：dry-run 期所有事件全量携 dry_run:true（.dry 隔离外的双保险——
 * legacy 混写文件的会话过滤依赖它）。main 在解析 dry 形态后设置。 */
let appendEventBaseFields: Record<string, unknown> = {};
export function setAppendEventBaseFields(fields: Record<string, unknown>): void {
  appendEventBaseFields = fields;
}

function appendEvent(reportDir: string, projectRoot: string, event: Record<string, unknown>): void {
  assertGoalBoundary('event_append');
  const abs = path.join(projectRoot, reportDir, 'events.jsonl');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(
    abs,
    JSON.stringify({ ts: new Date().toISOString(), ...appendEventBaseFields, ...event }) + '\n',
    'utf-8',
  );
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

/**
 * T1①（e5d8a2c4）：**一切 terminal 出口必须经正常收口**——run_end 事件 + 报告落盘，
 * 禁 throw 逃逸出 `main()`。
 *
 * 在案实锤（宿主 run1/6a969a 与 fa0663 三连）：runChain 内裸 throw 逃逸，CLI 外层
 * catch 只补一条裸 `run_end{INTERRUPTED}`——**报告不生成**、退出方式与崩溃无异；
 * driver 直调 `main()` 时连那条兜底事件都没有（棘轮单测钉过这个形态）。
 *
 * 返回 false＝run 身份尚未建立（manifest 解析前的异常），只能照旧抛给 CLI。
 * 报告阶段视图**从 events 重建**（codex 第九批 P1：初版写空表会把 resume run 已有的
 * 真实进度抹掉——events 是权威来源，就该从 events 折叠，而不是"不可信所以清空"）。
 */
function concludeInterruptedRun(err: unknown): boolean {
  if (runConcluded || !terminalEventCtx) return false;
  const ctx = terminalEventCtx;
  runConcluded = true;
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);
  try {
    appendEvent(ctx.reportDir, ctx.projectRoot, {
      type: 'run_end',
      status: 'INTERRUPTED',
      reason: 'uncaught_exception',
      error: message,
    });
  } catch { /* best-effort：事件写不进也要试着写报告 */ }
  try {
    const evs = loadAuthoritativeEvents(
      path.join(ctx.projectRoot, ctx.reportDir, 'events.jsonl'));
    const outcomes = enrichOutcomesWithProjection(
      rebuildOutcomesFromEvents(evs, ctx.chain) as GoalPhaseOutcome[],
      evs as unknown as Array<Record<string, unknown>>,
    );
    const report = generateGoalReportJson(ctx.runId, ctx.feature, 'INTERRUPTED', outcomes);
    writeGoalReport(ctx.projectRoot, ctx.reportDir, report, { workflowChain: ctx.workflowChain });
  } catch { /* best-effort */ }
  return true;
}

/**
 * codex 第九批 P1：启动期 BLOCKER（run 身份已建立、run_start 已落，但在进入链执行前
 * 被参数/前置校验拒绝）也必须优雅收口——此前直接 `return 1`/`process.exit(1)`，
 * events 只有 run_start 没有 run_end，投影成僵尸 RUNNING。
 */
function concludeStartupBlocker(reason: string, detail: string): void {
  if (runConcluded || !terminalEventCtx) return;
  const ctx = terminalEventCtx;
  runConcluded = true;
  try {
    // codex 第九批收尾 P1：run_end 必须经统一投影——裸 HALTED 会被 reducer 退回
    // run_start 的 RESUME_READY，supervisor 把需要人修参数的 run 重新拉起
    appendEvent(ctx.reportDir, ctx.projectRoot, withRunDisposition({
      type: 'run_end', status: 'HALTED', halt_reason: reason, error: detail.slice(0, 1000),
    }) as Parameters<typeof appendEvent>[2]);
  } catch { /* best-effort */ }
  try {
    const report = generateGoalReportJson(ctx.runId, ctx.feature, 'HALTED', []);
    writeGoalReport(ctx.projectRoot, ctx.reportDir, report, { workflowChain: ctx.workflowChain });
  } catch { /* best-effort */ }
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

/**
 * A legacy-fidelity backtrack is committed only when the owner closure was
 * published after the request and still verifies fresh. Historical builds
 * emitted phase_backtrack_completed immediately after the harness returned,
 * before receipt validation/finalization; the event alone is therefore not a
 * trustworthy resume boundary.
 */
function hasTrustedPhaseClosureAfterRequest(input: {
  projectRoot: string;
  feature: string;
  phase: FeaturePhase;
  requestTs?: string;
  requirement: string;
  featuresDir: string;
}): boolean {
  if (!input.requestTs) return false;
  const requestMs = Date.parse(input.requestTs);
  if (!Number.isFinite(requestMs)) return false;
  const { summary } = readPhaseSummary(input.projectRoot, input.feature, input.phase);
  const committedAt = summary?.closure_commit?.committed_at;
  const committedMs = typeof committedAt === 'string' ? Date.parse(committedAt) : Number.NaN;
  if (
    summary?.verdict !== 'PASS' ||
    summary.closure_status !== 'closed' ||
    summary.receipt_status !== 'passed' ||
    summary.closure_commit?.schema_version !== '1.0' ||
    !Number.isFinite(committedMs) ||
    committedMs < requestMs
  ) {
    return false;
  }
  try {
    const currentRequirementSha = computeRequirementShaFromText(
      input.projectRoot,
      input.feature,
      input.requirement,
      input.featuresDir,
    );
    if (!currentRequirementSha) return false;
    const [staleness] = recomputePhaseEvidenceStaleness(
      input.projectRoot,
      input.feature,
      [String(input.phase)],
      { currentRequirementSha },
    );
    return staleness?.verdict === 'fresh';
  } catch {
    return false;
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

/**
 * Current-attempt event/signature projection. A legacy-only summary becomes a null
 * decisionSummary before this boundary; without an independent runtime failure fact it
 * therefore contributes no meta, synthetic timeout signature, or new event kind.
 */
export function buildCurrentAttemptFailureProjection(input: {
  decisionSummary: SummaryJson | null;
  failureKind: FailureKind;
  phase: string;
  hasRuntimeFailureEvidence: boolean;
}): {
  hasEvidence: boolean;
  blockingMeta: { blocking_class?: string; failure_kind?: string };
  blockerSignature: string;
  failureKindForEvent?: FailureKind;
} {
  const hasEvidence = input.decisionSummary !== null || input.hasRuntimeFailureEvidence;
  return {
    hasEvidence,
    blockingMeta: extractBlockingMeta(input.decisionSummary),
    blockerSignature: hasEvidence
      ? buildEffectiveBlockerSignature(input.decisionSummary, input.failureKind, input.phase)
      : '',
    ...(hasEvidence ? { failureKindForEvent: input.failureKind } : {}),
  };
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
    probe: 'capability_preflight_ready',
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

interface RuntimeEvidencePreflightCapability {
  mode?: 'native' | 'legacy' | 'unsupported';
  native?: boolean;
  legacy?: boolean;
  /** Backward-compatible test seam; production uses mode/native above. */
  supported?: boolean;
  reason?: string;
}

/**
 * P0 native evidence 静态预检。
 *
 * 与通用 capability gate 的区别是：这里的能力缺失不是产品缺陷，也不需要人工签字；
 * 它在 agent 启动前直接投影到既有 external/capability-missing defer。native provider 一旦
 * 声明支持，后续 trace 缺失/无效则由 testing 硬门判 FAIL，不能回到本分支伪装成能力缺失。
 */
export function runRuntimeTelemetryPreflightGate(opts: {
  projectRoot: string;
  feature: string;
  phase: FeaturePhase;
  retries: number;
  resolvedProfile: HarnessResolvedProfile;
  emitPhaseVerdict: (event: Record<string, unknown>) => void;
  probe?: (resolvedProfile: HarnessResolvedProfile, projectRoot: string) => unknown;
}): { outcome: GoalPhaseOutcome } | null {
  if (opts.phase !== 'testing') return null;
  const acceptance = loadAcceptanceFlowsDoc(opts.projectRoot, opts.feature);
  if (!acceptance?.criteria.some(isP0DeviceInteractive)) return null;

  let capability: RuntimeEvidencePreflightCapability;
  try {
    capability = (opts.probe ?? preflightDeviceTestEvidenceCapability)(
      opts.resolvedProfile,
      opts.projectRoot,
    ) as RuntimeEvidencePreflightCapability;
  } catch (error) {
    capability = {
      mode: 'unsupported',
      native: false,
      legacy: false,
      reason: `native evidence preflight 失败：${(error as Error).message}`,
    };
  }
  if (capability?.native === true || capability?.mode === 'native' || capability?.supported === true) return null;

  const reason = capability?.reason?.trim() || 'native CaseResult.steps[] unsupported/unavailable';
  const guidance =
    '当前 device_test.run provider/profile 未准备好 P0 native CaseResult.steps[]；' +
    `未启动 testing agent 或真机内容执行。${reason} ` +
    '请先由 ensureHylyreReady 对齐 Hylyre 0.4.0 后 --resume。';
  opts.emitPhaseVerdict({
    phase: opts.phase,
    verdict: 'INCOMPLETE',
    action: 'defer_external_and_halt',
    blocking_class: 'externalBlocked',
    failure_kind: 'capability_missing',
    deferred_reason: 'capability_missing',
    probe: 'native_step_evidence_preflight',
    detail: reason,
  });
  console.error(`\n===== DEFERRED_CAPABILITY_MISSING =====\n${guidance}\n`);
  return {
    outcome: {
      phase: opts.phase,
      verdict: 'INCOMPLETE',
      deferred: true,
      deferred_reason: 'capability_missing',
      retries: opts.retries,
      halt_guidance: guidance,
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
 * Project live phase outcomes through the same policy used to write run_end.
 * Keeping the mapping here prevents outcome fields such as deferred_reason
 * from being dropped by an ad-hoc projection at the final call site.
 */
export function resolveGoalRunStatusFromOutcomes(
  outcomes: readonly GoalPhaseOutcome[],
  reachedEnd: boolean,
  opts?: { pendingHumanReview?: boolean; blockingFix?: boolean },
): ReturnType<typeof resolveGoalRunStatus> {
  return resolveGoalRunStatus(
    outcomes.map((outcome) => ({
      phase: outcome.phase,
      deferred: outcome.deferred,
      deferred_reason: outcome.deferred_reason,
      halted: outcome.halted,
      agent_timed_out: outcome.agent_timed_out,
      advance_blocked: outcome.advance_blocked,
    })),
    reachedEnd,
    opts,
  );
}

/**
 * 把上一轮 harness summary 的 BLOCKER 证据压缩成可回喂给 fresh-context agent 的文本块。
 * 让重试/续跑的 agent 看到「上轮失败在哪、动了哪些文件、harness 给了什么修复建议」，
 * 避免在自己上一轮改坏的现场反复打补丁（goal 模式每轮 fresh context，否则跨轮失忆）。
 */
export function extractPriorFailureContext(summary: SummaryJson): string {
  const verdict = summary.verdict ?? 'FAIL';
  // P0-4(b)：重试回喂只含 agent_fixable 条目。legacy human_only 不得被描述为签名队列；
  // 它只能触发当前机器门禁重投影。operator_note
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
      `- (legacy human-only classification; revalidate, do not sign) ${parked.map(b => b.id ?? '?').join(', ')}: ` +
      're-run current machine gates and reproject to repair, capability-missing, or advisory; signatures and ordinary resume cannot change the verdict.',
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

// ===========================================================================
// 测试缝（plan d8c5f3a7 review 修正：runner 级集成测试）
// ---------------------------------------------------------------------------
// review 实锤：此前所有新增防线都只有**纯函数单测**，"污染轮不 spawn gate"「证据
// quarantine」「事务提交」「provenance 断链」这些**时序与副作用**断言一条都没有——
// 而它们恰恰是本 plan 的核心（2026-07-24 事故的成因就是时序错了）。
// 仓内既有先例（__testing_setDigestReadFile / __testing_setDetectScanForEnsure）：
// 注入点只在测试里被替换，生产路径零行为差异。
// ===========================================================================

/** agent 调用注入（测试用；null=走真实 invokeAgentHeadless） */
type InvokeAgentFn = typeof invokeAgentHeadless;
let injectedInvokeAgent: InvokeAgentFn | null = null;
export function __testing_setInvokeAgent(fn: InvokeAgentFn | null): void {
  injectedInvokeAgent = fn;
}

/**
 * plan d7f3a9c4 t4：金丝雀 probe 的 invoke 注入（测试用；null=走真实 invokeAgentHeadless）。
 * 与 injectedInvokeAgent 分立——probe 走 runVisionCanaryProbe 的 invokeFn 缝，phase invoke
 * 走 injectedInvokeAgent；不混用，避免集成测试里 probe 与 phase 的注入互相污染。
 */
let injectedCanaryProbeInvoke: InvokeAgentFn | null = null;
export function __testing_setCanaryProbeInvoke(fn: InvokeAgentFn | null): void {
  injectedCanaryProbeInvoke = fn;
}

// 【已删除 · runner-owned-machine-facts 裁剪（codex 定案）】scopeAnchorEnv（b3e8d4c7 t4
// 的 plan 快照锚跨进程注入）：ui-scope-gate 的白名单校验源已改为 plan closure 的
// phase-evidence-manifest（跨 run 稳定、回执指针锚定完整性），不再消费快照锚 env。

/** gate harness 注入（测试用；**spy 它有没有被调用**是"污染轮不 spawn"的核心断言） */
type RunHarnessFn = (
  projectRoot: string, frameworkRoot: string, phase: FeaturePhase, feature: string,
  dryRun: boolean, manifest?: GoalManifest,
  roundIdentity?: { runId: string; attemptId: string }, timeoutMs?: number,
  // d9e4b7c1 T2（v13 缝扩展）：gate 注入 env（设备元组/冻结配置/强装 flag）——不扩缝则
  // "设备身份透传到 gate"是测试盲区（假绿）
  deviceTargetEnv?: Record<string, string>,
) => Promise<{ exitCode: number; timedOut: boolean; outputTail?: string }>;
let injectedRunHarness: RunHarnessFn | null = null;
export function __testing_setRunHarnessPhase(fn: RunHarnessFn | null): void {
  injectedRunHarness = fn;
}

/**
 * repo layout 注入（测试用）。
 * `detectRepoLayout(__dirname)` 按**脚本自身位置**推 projectRoot——进程内测试因此永远
 * 解析到框架源仓而非临时宿主，集成测试无从下手。注入后可指向 tmp host。
 */
let injectedLayout: RepoLayout | null = null;
export function __testing_setRepoLayout(l: RepoLayout | null): void {
  injectedLayout = l;
}

type ResolveWorkflowFn = typeof resolveWorkflowSpec;
let injectedWorkflowResolver: ResolveWorkflowFn | null = null;
export function __testing_setWorkflowResolver(fn: ResolveWorkflowFn | null): void {
  injectedWorkflowResolver = fn;
}

/**
 * 闭环探针注入（测试用）。`tryValidateReceipt` 会 spawn 真 check-receipt 子进程——
 * 在 tmp host 里必然 error（无 node_modules/无完整工程），使链在 spec 就 halt
 * `closure_probe_error`。这是最后一个阻断 in-process 全链测试的子进程边界。
 */
type ValidateReceiptFn = typeof tryValidateReceipt;
let injectedValidateReceipt: ValidateReceiptFn | null = null;
export function __testing_setValidateReceipt(fn: ValidateReceiptFn | null): void {
  injectedValidateReceipt = fn;
}

/**
 * 设备就绪门注入（测试用）。
 *
 * 就绪门会真的跑 `hdc list targets` / 唤醒 / 探锁屏——在临时宿主里必然无设备，
 * 使所有 ut/testing 链路被判 BLOCKED。注入后可模拟 READY/BLOCKED/AMBIGUOUS 三态，
 * 从而在集成层验证"未 READY 不产生 agent_invoke_start"这条核心契约。
 */
type DeviceGateFn = typeof runDeviceReadinessGate;
let injectedDeviceGate: DeviceGateFn | null = null;
export function __testing_setDeviceReadinessGate(fn: DeviceGateFn | null): void {
  injectedDeviceGate = fn;
}

/**
 * invoke 前 capability gate 注入（测试用；e5d8a2c4 步骤 1）。
 *
 * 为什么需要它：capability gate 排在设备就绪门**之前**，而设备类 capability 的
 * provider 恰是设备工具链（hdc/hvigor）——临时宿主必然缺，于是"注入设备门造
 * WAITING 停放"的场景根本走不到设备门。桩掉 capability gate（返回 null=无缺口）
 * 是唯一薄解；这不改变两门的真实顺序与语义。
 */
type InvokeCapabilityGateFn = typeof runInvokeCapabilityGate;
let injectedCapabilityGate: InvokeCapabilityGateFn | null = null;
export function __testing_setInvokeCapabilityGate(fn: InvokeCapabilityGateFn | null): void {
  injectedCapabilityGate = fn;
}

/** 一次性清空所有测试注入（测试 finally 调用，防串味） */
export function __testing_resetGoalRunnerSeams(): void {
  injectedValidateReceipt = null;
  injectedInvokeAgent = null;
  injectedRunHarness = null;
  injectedLayout = null;
  injectedWorkflowResolver = null;
  injectedDeviceGate = null;
  injectedCapabilityGate = null;
  injectedCanaryProbeInvoke = null;
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
  /** P0-3：就绪门冻结的设备 env（serial/kind/session/credential_ref）——须与 agent 侧同源 */
  deviceTargetEnv: Record<string, string> = {},
): Promise<{ exitCode: number; timedOut: boolean; outputTail?: string }> {
  if (injectedRunHarness) {
    return injectedRunHarness(
      projectRoot, frameworkRoot, phase, feature, dryRun, manifest, roundIdentity, timeoutMs,
      deviceTargetEnv,
    );
  }
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
  };
  // d9e4b7c1 T1（v12 P2 泛化）：注入键统一"先清大小写变体再写唯一键"（父环境 mixed-case
  // 残留会与注入键并存，Windows 子进程读取哪个是未定义行为——GATE_HARNESS 单键处理的
  // 既有教训推广到轮次身份与设备/冻结配置全部注入键）。
  const gateInjectedEnv: Record<string, string> = {
    // t1（f7a3d9c2）：外层脚本闸门与 agent 自跑共用同一轮次身份（round_key 去重/重放）
    ...(roundIdentity
      ? {
          MAISON_GOAL_RUN_ID: roundIdentity.runId,
          MAISON_GOAL_ATTEMPT: roundIdentity.attemptId,
          // plan b3e8d4c7 t1：attempt 身份必须带**所属 phase**——否则下游 attempt 里
          // 复验上游回执时 attempt 等值恒不成立（i3≠i5 无解，宿主实锤死锁）。
          MAISON_GOAL_ATTEMPT_PHASE: String(phase),
        }
      : {}),
    // P0-3（device-readiness review 二轮）：**冻结的设备目标必须同时给外层 gate harness**。
    // 此前只注入 agent 的 extraEnv，而 gate harness 从 `process.env` 构造环境——多设备
    // 时它会退回 hdc 默认目标，于是"就绪门冻结了 A 机、UT/testing 却在 B 机上跑"。
    // 这里显式透传，与 agent 侧同源。
    ...deviceTargetEnv,
  };
  // plan d7f3a9c4 t3：model pin 注入链②（gate harness）——有 pin 才携带；无 pin 显式清理
  //（共享执行器：先清大小写变体再写唯一大写键，父环境残留不会漏入子进程）。
  applyGoalModelPinEnv(childEnv, manifest?.adapter_model_pin?.value);
  // plan ab072691 t5①：provider 身份注入 gate harness——provider 评审发生在 gate 进程里
  // （capture 之后、严格 dispatch 之前），而那个进程没有 manifest。同一条注入纪律：
  // 成对写、成对清；无 pin 时只清不写（gate 侧取不到即按未配置处理，落 blind）。
  applyGoalVisualProviderEnv(childEnv, manifest?.visual_provider_pin);
  deleteEnvKeyCaseInsensitive(childEnv, 'HARNESS_DIFF_BASE_REF');
  for (const [k, v] of Object.entries(gateInjectedEnv)) {
    deleteEnvKeyCaseInsensitive(childEnv, k);
    childEnv[k] = v;
  }
  // S5（visual-capability-truth）：单写者标记——只有 runner 直接 spawn 的 gate harness
  // 可直写正式 vision 账本；agent 自跑 harness（无此标）只算不写/写 journal proposal。
  // b7e4d2a9 Todo3：先清大小写变体再设唯一大写=1（父环境残留 mixed-case 键会与之并存，
  // Windows 子进程读取哪个是未定义行为）。
  deleteEnvKeyCaseInsensitive(childEnv, 'MAISON_GOAL_GATE_HARNESS');
  childEnv.MAISON_GOAL_GATE_HARNESS = '1';
  // MAISON_GOAL_ALLOWED_TOOLS 注入已退役（plan a8e5c3f9 t1）：allowed_tools 是审批清单，
  // headless 全权限下不存在审批面，也不再参与多模态能力判断。
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
      // plan c6a9e4d2 t4：gate-harness spawn 卫生——防每 invoke 弹可见控制台窗。
      windowsHide: true,
    },
  );
  activeHarnessKill = async () => {
    if (child.pid) {
      await killProcessTree(child.pid);
    }
  };
  let outputTail = '';
  const rememberOutput = (chunk: Buffer | string): void => {
    outputTail = (outputTail + chunk.toString()).slice(-8_000);
  };
  child.stdout?.on('data', (chunk: Buffer | string) => {
    rememberOutput(chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    rememberOutput(chunk);
    process.stderr.write(chunk);
  });

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
    return {
      exitCode: timedOut && settled.exitCode === 0 ? 1 : settled.exitCode,
      timedOut,
      outputTail,
    };
  } catch {
    return { exitCode: 1, timedOut, outputTail };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    activeHarnessKill = null;
  }
}

/**
 * e9d4b7a3 t1（review1 阻断修复）：backtrack_target_absent 的跨 run 修复任务交接指引——
 * 单点生成，phase_halt 事件 / outcome / console 三处消费同一文案（b3f7d9a2 硬学习：
 * 同一文案契约须枚举全部承载处含测试断言）。检测器只保证文案要素在场。
 */
export function buildBacktrackTargetAbsentGuidance(targetPhase: string | null): string {
  return (
    `责任阶段映射不到当前执行链（recommendation.phase=${targetPhase ?? '<unmapped>'}）——无处回退，本 run 终止。\n` +
    '修复任务交接：起 fresh successor run，用 `--supersede <本 run id>` 废弃本 run，并以 ' +
    '`--requirement-file <增量文件>` 携带本轮修复增量（须含：**任务点名** + **关键证据摘要**，' +
    '如缺陷 id / 责任文件路径 / 复现要点 / 必要素材清单）。增量会与源 requirement 合并，' +
    '成为 successor coding prompt 的唯一任务真源。'
  );
}

/** 把 gate 的真实末尾错误压缩成可直接回喂下一轮的有界文本。 */
export function formatHarnessFailureTail(raw: string | undefined, maxChars = 3_000): string | undefined {
  if (!raw?.trim()) return undefined;
  const clean = raw
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');
  return clean ? clean.slice(-maxChars) : undefined;
}

function readHarnessFailureFromDetachLog(logPathAbs: string): string | undefined {
  try {
    if (!fs.existsSync(logPathAbs)) return undefined;
    const size = fs.statSync(logPathAbs).size;
    const bytes = Math.min(size, 16_000);
    const fd = fs.openSync(logPathAbs, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      fs.readSync(fd, buf, 0, bytes, size - bytes);
      return formatHarnessFailureTail(buf.toString('utf-8'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
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
  /**
   * plan ab072691 t2①④：本 run 冻结的视觉路由三态。生产路径恒由
   * resolvePhaseCapabilityAdvisory 填入；**可选**是为了与既有 CapabilitySnapshot /
   * reviewVision 同一条兼容纪律——缺键=非委托，能力块行为逐字等于本改动前。
   * 'delegated' 时能力块额外说明「你无视觉，但有一个只读评审器会看图并回给你缺陷」。
   */
  visionMode?: VisionMode;
  /** delegated 时的 provider 身份（能力块如实点名，不含糊其辞） */
  visualProvider?: { adapter: string; model: string };
  /** 用户需求选定的合同档位；fidelity_target 必须投影这个值。 */
  selectedFidelity?: FidelityTarget;
  effectiveFidelity: FidelityTarget;
  fidelityClamped: boolean;
  /** OCR 预扫描产出的 project-relative .ocr.json 路径（无参考图/OCR 不可用/有视觉时为空数组） */
  ocrJsonPaths: string[];
  /**
   * plan ab072691 t4⑤：spec 期视觉观察 sidecar 的 project-relative 路径。
   * 与 ocrJsonPaths 同性质：**best-effort 上下文**，不是门禁产物、不产 check。
   * spec 生产、plan/coding 只列（与 OCR 预扫描同一条 dispatch 纪律）。
   */
  visualObservationPaths?: string[];
  /** plan f6b2d9a4：三轴 SSOT 下发（SSOT 缺失=best_effort/undefined 回落） */
  acceptanceStrictness?: 'best_effort' | 'hard';
  assetAcquisitionMode?: 'approximate' | 'auto_crop' | 'user_dir';
  /** e9d4b7a3 t3：继任 run 是否携带显式修复增量（requirement 合并标记在场）。增量中被
   * 点名要求物化的素材本轮为强契约（真裁或 FAIL），不可走 best_effort 逐项占位兜底。 */
  successorRepairRequirement?: boolean;
  /** post-impl3 P0-3：mid-chain vision 收紧触发 pixel∧hard∧clamped 真冲突——runner 须在 spawn 前 halt */
  deferTriggered?: boolean;
  /**
   * plan c4e8a1f7 T2：共享发现参考图集合（project-relative）——能力块的 authoritative
   * paths（有视觉时的确定性原图路径下发，fact #13）；T3：按 provenance 分轴的可达出口。
   */
  referenceImagePaths: string[];
  toolEventProvenance: 'none' | 'structured_events' | 'session_transcript';
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
    `- Selected fidelity contract (write this to fidelity_target): **${advisory.selectedFidelity ?? advisory.effectiveFidelity}**`,
    `- Effective execution fidelity ceiling for this run: **${advisory.effectiveFidelity}**` +
      (advisory.fidelityClamped
        ? ' (capability-limited for this execution only; keep fidelity_target at the selected contract above)'
        : ''),
    // plan f6b2d9a4：三轴 SSOT 下发——严格度与素材策略与门禁同源，agent 不得自行改判
    `- Acceptance strictness: **${advisory.acceptanceStrictness ?? 'best_effort'}**` +
      ((advisory.acceptanceStrictness ?? 'best_effort') === 'best_effort'
        ? ' (quality gaps are recorded as visual debt and do NOT hard-block; do not stop to ask about them)'
        : ' (hard contract: quality gaps escalate to BLOCKER until current machine evidence closes them)'),
    ...(advisory.assetAcquisitionMode
      ? [`- Asset acquisition mode (from fidelity-intent SSOT): **${advisory.assetAcquisitionMode}** — mirror this into ui-spec verbatim.`]
      : []),
    '',
  ];
  // plan c4e8a1f7 T2：authoritative 原图路径确定性下发（fact #13：此前有视觉时 prompt 无
  // 确定性原图路径，agent 只能猜/让 spec 自算分母）。与 refs receipt 期望分母同一集合。
  if (advisory.referenceImagePaths.length > 0) {
    lines.push(
      'Authoritative reference images (runner-discovered — the spec MUST declare and model ALL of',
      'them; omitting any fails verification; do not shrink this denominator):',
      '',
      ...advisory.referenceImagePaths.map(p => `- ${p}`),
      '',
    );
  }
  // plan c4e8a1f7 T3：能力与可审计性分轴——none-provenance adapter 能看图但不能审计逐图
  // Read：图片照常用，产物诚实写 verified: unverified；structured_events 才要求本 invoke
  // 逐图 Read 并争取 vl_multimodal 终签。
  if (advisory.hasVision && advisory.toolEventProvenance !== 'structured_events') {
    lines.push(
      'Your adapter does not emit auditable per-image Read events (tool_event_provenance=' +
      `${advisory.toolEventProvenance}). You can still look at the reference images to complete ` +
      'the work, but the per-image Read receipt (and therefore vl_multimodal final signing) is',
      'structurally unavailable: record `verified: unverified` in ui-spec. Best-effort/reachable',
      'tiers keep WARN semantics; the hard pixel contract FAILs on unverified — that threshold is',
      'unchanged. Do NOT fabricate `verified: verified` / `verified_method: vl_multimodal`.',
      '',
    );
  }
  if (advisory.fidelityClamped) {
    lines.push(
      'This capability-based fidelity downgrade is itself a headless auto-decision: record it in',
      '`headless-assumptions.md` (see the Unattended execution block below for the exact path and provenance',
      'format) so the run remains auditable, even though this run does not stop to ask.',
      '',
    );
  }
  // plan ab072691 t2④：delegated 分支——在**盲档工作法之上**追加委托说明。
  // 刻意不替换盲档段：你确实没有视觉，写法一个字都不变；只是多了一个只读评审器会在
  // 截图之后把逐屏缺陷回给你修。写者仍然只有你一个。
  if (advisory.visionMode === 'delegated' && advisory.visualProvider) {
    lines.push(
      `**Delegated visual review is active for this run** (provider: adapter=${advisory.visualProvider.adapter}, ` +
      `model=${advisory.visualProvider.model}).`,
      '- You still have NO vision. Everything in the blind working method below applies to you unchanged.',
      '- After each device capture, a **read-only** reviewer with that identity looks at every target screen',
      '  and returns structured per-screen defects + must_fix items for YOU to fix. It cannot write anything',
      '  in this project — not source, not artifacts, not gate files, and never a human confirmation signature.',
      ...(advisory.visualObservationPaths && advisory.visualObservationPaths.length > 0
        ? [
            '- Observation sidecars for the reference images (machine-produced context, NOT a verdict and NOT',
            '  your own seeing — treat them exactly like OCR JSON):',
            ...advisory.visualObservationPaths.map(p => `  - ${p}`),
          ]
        : [
            '- No observation sidecar is available for this round. That is normal and not an error: keep working',
            '  from the requirement text and any OCR JSON below.',
          ]),
      '- You remain the single writer of every project artifact. Do NOT wait for the reviewer, do NOT ask for it,',
      '  and do NOT claim you saw anything yourself. If a round produces no review, keep working blind.',
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
      // plan f6b2d9a4 P0-1：素材建议按 SSOT 素材轴分流——auto_crop 需求下再教 placeholder
      // 会直接顶撞路由决策（银行卡场景实证），一致性门禁必打回。
      ...(advisory.assetAcquisitionMode === 'auto_crop'
        ? [
            '- Icons/logos/illustrations: the requirement authorizes cropping them from the reference screenshots',
            '  (asset_acquisition_mode=auto_crop). Declare them as `acquisition: crop` with source/bbox in ui-spec;',
            '  the crop pipeline (asset_crop_validation) verifies artifacts — do NOT claim visual verification yourself.',
            '  Per-item fallback IS allowed and expected: when an item cannot pass trusted machine validation',
            '  verification available), mark THAT item `placeholder: true` + register it as visual debt and continue',
            '  — feature-level auto_crop does not mean every single item must crop successfully. Never loop retrying',
            '  an unverifiable crop.',
            ...(advisory.successorRepairRequirement
              ? [
                  // e9d4b7a3 t3：显式 successor repair requirement > best_effort 逐项 fallback。
                  // 增量点名项不存在「占位 + PASS」第三态；旧台账（needs_human/占位记录）不得
                  // carry-over 直接 PASS——环境已修好就必须本轮真裁。
                  '  **Priority rule (this round is a successor repair round)**: assets explicitly named in the',
                  '  requirement increment as must-materialize are a HARD contract this round — actually crop/deliver',
                  '  them (asset-manifest placeholder → false + media file present), or FAIL honestly with the',
                  '  blocking reason. "placeholder + PASS" is NOT a valid outcome for named items, and carry-over',
                  '  ledger notes from earlier rounds (prior needs_human / placeholder records) do NOT settle them:',
                  '  re-assess this round and execute if the environment supports it. Unnamed items keep the',
                  '  per-item fallback above.',
                ]
              : []),
          ]
        : [
            '- Icons/logos/illustrations: use placeholder assets + asset-manifest.yaml (existing mechanism) — do NOT',
            '  claim to have visually verified their appearance.',
          ]),
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
  // plan a8e5c3f9 t6：prompt 用 effective 权限（恒 never）——不再随旧 manifest 摇摆。
  const approval = effectiveHeadlessUnattended(manifest.unattended).approval_mode;
  const assumptionsRel = relFeatureFile(projectRoot, manifest.feature, `${phase}/headless-assumptions.jsonl`);
  const assumptionsMdRel = relFeatureFile(projectRoot, manifest.feature, `${phase}/headless-assumptions.md`);
  // E0：同 prompt 自相矛盾预防。按 capabilityAdvisory（与能力块同源取值）分支措辞；
  // pixel_1to1 只接受当前机器视觉证据，能力不可达时走既有 capability defer。
  // plan ab072691 t2④：pixel 可达性判据即**评审轴的结论**——effectiveFidelity 已由
  // clampFidelityByCapability 按 reviewVision 算出（native/delegated 不钳、blind 照旧钳）。
  // 故此处公式自动按 review 轴分支：delegated 下 pixel_1to1 可达，provider 证据仍须
  // 通过当前 identity/hash/freshness 门禁，不能靠任何人名补签。
  const pixelReachable = !capabilityAdvisory || capabilityAdvisory.effectiveFidelity === 'pixel_1to1';
  const deterministicDetectorLines = pixelReachable
    ? [
        '- Deterministic detectors (node_options_injection / visual_diff_tamper_artifact / receipt command scan /',
        '  drift approval validation) turn any attempt into BLOCKER evidence. The only path through pixel_1to1 P0',
        '  screens is: fix deterministic signals, then produce current native/delegated machine visual evidence.',
      ]
    : [
        '- Deterministic detectors (node_options_injection / visual_diff_tamper_artifact / receipt command scan /',
        '  drift approval validation) turn any attempt into BLOCKER evidence — this applies regardless of fidelity tier.',
        `  This run's effective fidelity is **${capabilityAdvisory!.effectiveFidelity}** (not pixel_1to1): there is no`,
        '  per-screen signature path. Register genuinely undecidable items in the blind-review',
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
    '- Ledger records are **not** authorization: hard quality gates cannot be lowered by fidelity/P0/review/',
    '  behavior waivers or any confirmation receipt. Repair the owning phase, defer for a real missing capability,',
    '  or submit a changed requirement as a correction/successor run.',
    '- `freeform_approval` gates (scope expansion, src mutation): **conservative default** — do NOT expand scope / do NOT mutate protected src; log the deferred request as a ledger line (must_review=true).',
    // plan e7c2a4d8 T4d：gap-notes 双账本冲突显式注入——fresh-context agent 读到自签
    // 「已批准」就复写 seam 的循环（宿主 ut-003 reject → ut-006 implement 实证）。
    '- gap-notes `approved_src_mutations[]` entries written by an agent are SELF-REPORTED intent, NOT',
    '  authorization: the runner three-source chain will still HALT on any protected-source change they',
    '  "approve". Even if a gap-note claims a seam was approved, do NOT (re-)implement it — log the request',
    '  as must_review and continue without the mutation.',
    '- Product source under test phases is attestation-locked: any product-code change after review closure',
    '  fails testing (`review_closure_attestation` BLOCKER). Test seams MUST NOT alter user-visible flows or',
    '  default behavior — a `*_FAST_PATH`-style switch defaulting to true is a blocker, not a workaround.',
    '',
    'After auto-resolving gates: **continue producing phase artifacts** and run harness. Do NOT halt at confirmation gates.',
    '',
    '**Gate-integrity red lines (BLOCKER — violations are task failure, not a path to completion):**',
    '- NEVER write legacy quality-signature fields such as `confirmed_by`; current quality conclusions require machine evidence.',
    '- `bbox_verified_by` / `approved_by` / `user_requirement` may only carry their narrowly defined provenance or external-authority semantics; they never override quality FAIL.',
    '- NEVER tamper with gate artifacts (visual-diff.json / summary.json / receipts) via process injection',
    '  (NODE_OPTIONS --require/-r/--import/--loader, .node-options, .npmrc node-options, fs monkey-patching)',
    '  or verdict-filling/resetting scripts; never instruct the operator to set up such bypasses.',
    '- NEVER modify the framework control plane. There is no approval field that unlocks it: integrity.drift_allowlist',
    '  and allow_local_drift are retired and ignored on read. Found a framework bug? HALT and report it upstream.',
    ...deterministicDetectorLines,
  ];
}

/**
 * e9d4b7a3 t5：budget-only 授权 rebase 后，**任何 review agent 启动之前**对受影响的
 * 已完成上游阶段执行一次**确定性 harness 刷新证据**（不启动 agent）——重放
 * 「599/600 撞墙 → 提预算 → resume」时，coding 等上游证据在预算 rebase 后重新闭环，
 * review 不再因 stale 白烧 invoke（i28/i29 实锤形态）。
 *
 * 复用既有执行原语：runHarnessPhase（gate+summary 重算）→ tryValidateReceipt →
 * finalizePhaseClosure（evidence manifest / 回执指针按当前 run 身份重新发布），与
 * 主循环 closure-only 段同一套函数，**不复制任何公式**。不做 verdict 推进：刷新只
 * 重发布证据，不产生新的 phase outcome。
 *
 * 二轮 review P1 修订：
 *  - **不伪造同阶段新 attempt**：旧回执仍绑定原 attempt（如 coding-i26），check-receipt
 *    对同阶段严格校验 claimed_attempt_id——伪造 refresh-* 必然 failed。本函数从 events
 *    恢复该 phase 的**原 attempt id** 复用于 harness/闭环节点（既有「跨阶段复验」语义：
 *    同 run 内用原 attempt 校验旧回执，不建 re-sign 系统）；events 中无法恢复 → 该阶段
 *    记为失败（fail-closed，不猜不造）。
 *  - **任一刷新失败 → review 前一次性 HALT**（调用方执行）：不得带着未刷新的真 stale
 *    证据继续烧 review（原样复发 i28/i29）。
 *  - 每阶段 wall 预算按绝对 deadline 逐次重算剩余（剩余≤0 即停），不再分配带 60 秒
 *    地板的均分预算（三阶段合计不得突破剩余 wall）。
 */
async function refreshCompletedUpstreamEvidenceDeterministic(opts: {
  projectRoot: string;
  frameworkRoot: string;
  manifest: GoalManifest;
  chain: FeaturePhase[];
  /** resume 起点（含）之前为已完成上游 */
  chainStartIndex: number;
  /** 绝对 wall deadline（与主循环 wallDeadlineMs 同源；逐阶段重算 remaining） */
  wallDeadlineMs: number;
  /** 当前 run 的历史事件（恢复各阶段原 attempt id；authoritative 视图） */
  events: ReadonlyArray<{ type?: string; phase?: string; invoke_id?: string }>;
  emit: (event: Record<string, unknown>) => void;
}): Promise<string[]> {
  const { projectRoot, frameworkRoot, manifest, chain } = opts;
  const upstream = chain.slice(0, opts.chainStartIndex);
  const completed = upstream.filter(ph => {
    try {
      return fs.existsSync(
        path.join(receiptDirPath(projectRoot, manifest.feature, String(ph)), 'reports', 'summary.json'),
      );
    } catch {
      return false;
    }
  });
  if (completed.length === 0) return [];
  opts.emit({
    type: 'upstream_evidence_deterministic_refresh',
    cause: 'budget_only_rebase',
    phases: completed.map(String),
  });
  console.log(
    `[goal-runner] budget-only rebase：对已完成上游阶段执行确定性 harness 刷新（不起 agent）：${completed.join(', ')}`,
  );
  const failures: string[] = [];
  for (const ph of completed) {
    const phase = ph;
    // --- 原 attempt 身份恢复（不伪造同阶段新 attempt；缺失即 fail-closed）---
    let originalAttempt: string | null = null;
    for (let i = opts.events.length - 1; i >= 0; i--) {
      const e = opts.events[i];
      if ((e.type !== 'agent_invoke' && e.type !== 'agent_invoke_start') || e.phase !== phase) continue;
      const m = String(e.invoke_id ?? '').match(/-(i\d+)$/);
      originalAttempt = m ? m[1] : null;
      break;
    }
    if (!originalAttempt) {
      failures.push(`${phase}：events 中无法恢复该阶段原 attempt id——拒绝伪造新 attempt（回执 identity 校验必失败）`);
      continue;
    }
    const remainingMs = opts.wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
    if (remainingMs <= 0) {
      failures.push(`${phase}：确定性刷新 wall 预算已耗尽（按绝对 deadline 重算，不得突破剩余预算）`);
      break;
    }
    try {
      // 与主循环同款 fresh 判定（summary mtime 窗口前后跃迁）——刷新必须真实重写证据
      const beforeMtime = getSummaryMtime(readPhaseSummary(projectRoot, manifest.feature, phase).summaryAbsPath);
      const harnessRun = await runHarnessPhase(
        projectRoot,
        frameworkRoot,
        phase,
        manifest.feature,
        false,
        manifest,
        { runId: manifest.run_id, attemptId: originalAttempt },
        remainingMs,
      );
      if (harnessRun.exitCode !== 0) {
        failures.push(`${phase}：harness 刷新失败（${formatHarnessFailureTail(harnessRun.outputTail, 600) ?? '无输出'}）`);
        continue;
      }
      const { summary, summaryAbsPath } = readPhaseSummary(projectRoot, manifest.feature, phase);
      if (summary?.verdict !== 'PASS' || !isSummaryFresh(beforeMtime, getSummaryMtime(summaryAbsPath))) {
        failures.push(`${phase}：harness 刷新后无 fresh PASS summary`);
        continue;
      }
      assertGoalBoundary('closure_finalizer');
      const receiptValidation = (injectedValidateReceipt ?? tryValidateReceipt)(
        path.join(frameworkRoot, 'harness'),
        projectRoot,
        phase,
        manifest.feature,
        {
          goalIdentity: {
            runId: manifest.run_id, attemptId: originalAttempt, attemptPhase: String(phase),
            ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
          },
        },
      );
      if (receiptValidation.status !== 'passed') {
        failures.push(`${phase}：原 attempt（${originalAttempt}）receipt 复验未过（status=${receiptValidation.status}）`);
        continue;
      }
      finalizePhaseClosure({
        projectRoot,
        frameworkRoot,
        feature: manifest.feature,
        phase,
        receipt: { ...receiptValidation, status: 'passed' },
        goalRunId: manifest.run_id,
        goalAttemptId: originalAttempt,
        blockerCount: summary?.blockers?.length ?? 0,
        persistPhaseState: () =>
          syncPhaseStateOnReceiptPassStrict(
            projectRoot,
            manifest.feature,
            phase,
            receiptValidation,
            { blocker_count: summary?.blockers?.length ?? 0, frameworkRoot },
          ),
        now: () => new Date(),
      });
    } catch (error) {
      failures.push(`${phase}：${(error as Error).message.slice(0, 300)}`);
    }
  }
  opts.emit({
    type: 'upstream_evidence_deterministic_refresh_complete',
    cause: 'budget_only_rebase',
    phases: completed.map(String),
    failures,
  });
  if (failures.length > 0) {
    console.error(
      `[goal-runner] budget-only rebase 确定性刷新存在失败（review 前一次性 halt，不烧 review invoke）：\n` +
        failures.map(f => `  - ${f}`).join('\n'),
    );
  }
  return failures;
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
  '2. Deterministic fail_signals (text-placement divergence) mean the screen IS decidable headlessly: you MUST set that screen verdict=fail, copy the signals into screens[].must_fix, fix the code in THIS retry, and re-capture — do NOT leave such screens pending;',
  '3. Do NOT blindly move or restructure unrelated blocks hoping the score improves — a prior attempt did that (moved the card-pack description) and made it worse;',
  '4. If the same set of visual gates keeps failing with no change, the convergence fuse will terminate this run honestly; a successor run needs new evidence or code changes.',
  '5. Only valid current machine evidence may establish PASS; missing, invalid, forged, or stale evidence remains FAIL/retry.',
];

/**
 * plan d8c5f3a7 T4：**testing 阶段专用**的视觉缺口指导。
 *
 * 矛盾指令实锤（2026-07-24 事故的成因之一）：上面那条通用指导里的
 * 「fix the code in THIS retry」与 device-testing SKILL.md:114「不修改源码」正面冲突。
 * agent 照着 runner 的话改码，随即被 review_closure_attestation 与 upstream stale 双锁
 * 判违规——两边都"按指示办事"，却互相打架。
 *
 * 分工冻结（三处契约统一）：
 *   · testing：只复现、采证、产结构化缺陷 + 请求 backtrack —— **零产品源码写入**；
 *   · coding：消费缺陷指纹并修复（本轮修码在 coding 侧仍然正确）；
 *   · runner：以源码完整性闸门 enforce（prompt 之外的兜底，不依赖 agent 自觉）。
 */
export const VISUAL_GAP_RETRY_GUIDANCE_TESTING: readonly string[] = [
  '**This is a visual-fidelity gap (the rendered UI does not match the reference).** In the TESTING phase your job is to make the gap MACHINE-ACTIONABLE — not to edit product code:',
  '1. Deterministic fail_signals mean the screen IS decidable headlessly: set that screen verdict=fail and copy the signals into screens[].must_fix — do NOT leave such screens pending;',
  '2. Record every defect as a structured entry (screen_id + observed vs expected + evidence path). These become the defect fingerprints that drive the fix.',
  '3. **Do NOT modify product source code, requirement SSOT (acceptance/ui-spec/contracts/spec.md/plan.md), or root build config in this phase — not even to add test anchors.** The runner snapshots all of these around your invocation; a hand-made write is a run-terminating violation (receipt not issued, journal not merged, gate not run; the run halts and --resume is refused). Build artifacts regenerated by the framework harness itself (e.g. module-root BuildProfile.ets rewritten by device_test.build) are auto-classified by the runner as legitimate side effects — running harness self-checks is safe and expected. Do NOT override HARNESS_DEVICE_TEST_PRODUCT/HARNESS_DEVICE_TEST_BUILD_MODE in your shell — the runner froze them for this attempt; a mismatching build artifact is treated as a violation. Missing `by_id` anchors are themselves a defect: record them in screens[].must_fix so coding implements them after backtrack.',
  '4. Every screen with non-empty must_fix (verdict warn/fail, fresh screenshot+build identity) is consumed by the runner as an actionable defect: it will backtrack to coding and inject your must_fix items into the coding prompt. Write them as concrete fix instructions.',
  '5. If the same set of visual gates keeps failing with no change, the convergence fuse will terminate this run honestly; a successor run needs new evidence or code changes.',
];

/**
 * ============================================================================
 * F1（plan d8c5f3a7 v23）：统一可回修缺陷收集 —— ActionableDefect
 * ----------------------------------------------------------------------------
 * 回修输入**只有两项已存在的可靠事实**（v22 已删通用指标契约——score_floor 系
 * reference_only 被实测证伪、blank_ratio 无区分力，那套只会打回好版本）：
 *   A) visual-diff.json 里**新鲜**的 must_fix（5 条谓词，见下）；
 *   B) 本轮导航**新增** faultlog 的 crash_suspected（F3 集合差归档，含 run_id）。
 * 结构性素材问题（悬空 $r / 物化缺失）不在此——F4 已做成 coding 侧确定性 FAIL，
 * coding 阶段就会失败，不需要绕到 testing 再发现一次。
 *
 * 【actionable 谓词（v23 冻结，5 条同时满足）】
 *   ① verdict ∈ {warn, fail}；② must_fix[] 非空；③ evaluated_screenshot_hash 与
 *   盘上截图一致；④ evaluated_build_fingerprint 与当前 build 一致（可算时）；
 *   ⑤ 未被判 stale / evaluation_invalidated。
 *   ③④⑤ 复用 profile 的 isStaleVisualDiffVerdict（同一判据，不另造）。
 *   **新鲜度由 identity 判定，不看 run_id**：上一 run 但 build+截图完全一致的缺陷
 *   仍是真缺陷（visual-diff 判定本就设计为同一构建下跨轮持久）；污染 invocation 遗留
 *   的产物由 ③④ 自动失效——不需要 quarantine。
 * ============================================================================
 */
export interface ActionableDefect {
  source: 'visual_diff' | 'crash' | 'device_test';
  screen_or_case_id: string;
  /** 修复指令（visual=must_fix 原文；crash=确定性指令），进 coding prompt */
  instructions: string[];
  /** 结构化锚优先（screen|class|element|bbox 桶，复用 computeDefectFingerprint）；
   * 无结构化锚时退回规范化文案哈希 */
  fingerprint: string;
  /** 证据路径——由 runner 按已知目录结构拼接，**不信任产物自报**（防指向任意文件） */
  evidence_path: string;
  /**
   * adjudicated-repair-loop（plan e2b7c4a9）：是否**结构化视觉信号**（来自 visual-diff
   * json 的结构化 defect，identity = sha256(computeDefectFingerprint(screen, defect))）。
   * 仅此类进入 signal@1 身份与 M2 物化前复核；crash / device_test / 纯文本 must_fix
   * 兜底保持既有 legacy 契约（不入累计收敛、不需 defect-review）。
   */
  signal_identity: boolean;
}

/** 整轮集合指纹：只有整轮 actionable 集合完全相同才算无进展（{A,B}→{B} 允许再回退） */
export function roundFingerprintOf(defects: readonly { fingerprint: string }[]): string {
  const h = createHash('sha256');
  h.update(defects.map(d => d.fingerprint).slice().sort().join('\n'), 'utf-8');
  return h.digest('hex').slice(0, 32);
}

export function evaluateUnverifiedRound(
  previous: { phase: string; fingerprint: string } | null,
  phase: string,
  entries: readonly { fingerprint: string }[],
): { fingerprint: string; repeatedWithoutProgress: boolean } {
  const fingerprint = roundFingerprintOf(entries);
  return {
    fingerprint,
    repeatedWithoutProgress: previous?.phase === phase && previous.fingerprint === fingerprint,
  };
}

// ---------------------------------------------------------------------------
// adjudicated-repair-loop M1（plan e2b7c4a9 t1.3）：累计 one-shot 收敛（纯函数层）
// ---------------------------------------------------------------------------
// attempted 派生规则（冻结公式，v4 修正）：候选身份从 `phase_backtrack_requested
// .candidates[]` 取（仅 identity_schema='signal@1'），但**仅当同一回退窗口之后出现
// 目标 phase 的 `agent_process_settled` 或 `phase_verdict` 事件**才计入 attempted——
// request 后、目标 phase 执行前崩溃的候选不算已修（既有 crash/resume 契约：request-only
// 候选恢复后必须执行）；目标 phase settled 后崩溃则已计入，resume 不得再自动修。
// 全部从既有 events 派生，零新账本/状态机。
// ---------------------------------------------------------------------------

export interface BacktrackWindowEvent {
  type?: string;
  phase?: unknown;
  to_phase?: unknown;
  candidates?: unknown;
}

function signalCandidateFingerprints(candidates: unknown): string[] {
  if (!Array.isArray(candidates)) return [];
  const out: string[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    if (r.identity_schema !== 'signal@1') continue; // legacy check-domain 候选不入收敛
    if (typeof r.item_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(r.item_fingerprint)) continue;
    out.push(r.item_fingerprint);
  }
  return out;
}

/**
 * 从既有 events 回放全部「已实际执行过自动修复」的信号级身份。
 * 窗口语义：一条 phase_backtrack_requested 开启窗口；窗口内出现目标 phase 的
 * agent_process_settled/phase_verdict 即关闭并累计；新 request（或 run 结束）时若
 * 窗口仍未关闭 → 该批候选**不计入**（request-only 崩溃，仍 eligible）。
 */
export function replayAttemptedSignalIdentities(
  events: ReadonlyArray<BacktrackWindowEvent>,
): Set<string> {
  const attempted = new Set<string>();
  let window: { toPhase: string; fingerprints: string[] } | null = null;
  const targetExecuted = (e: BacktrackWindowEvent): boolean => {
    if (!window) return false;
    if (typeof e.phase !== 'string' || e.phase !== window.toPhase) return false;
    return e.type === 'agent_process_settled' || e.type === 'phase_verdict';
  };
  for (const e of events) {
    if (e.type === 'phase_backtrack_requested') {
      // 上一窗口未执行即开启新窗口 → 丢弃（=request-only 崩溃，候选仍 eligible）
      window = {
        toPhase: typeof e.to_phase === 'string' ? e.to_phase : '',
        fingerprints: signalCandidateFingerprints(e.candidates),
      };
      continue;
    }
    if (window && targetExecuted(e)) {
      for (const fp of window.fingerprints) attempted.add(fp);
      window = null;
    }
  }
  return attempted;
}

/**
 * eligible = current open（信号级候选）× 尚未 attempted。
 * 仅作用于 identity_schema='signal@1'；legacy 候选（无字段）保持既有可能回退语义
 * （不参与本收敛判定）。返回可回退的候选子集。
 */
export function computeEligibleSignalIdentities(
  open: readonly RepairCandidate[],
  attempted: ReadonlySet<string>,
): RepairCandidate[] {
  return open.filter((c) => {
    if (c.identity_schema !== 'signal@1') return true; // legacy 保持原样
    return !attempted.has(c.item_fingerprint);
  });
}

export interface UnverifiedDefect {
  screen_or_case_id: string;
  reason: string;
  reason_code: string;
  source: 'visual' | 'device_test';
  fingerprint: string;
}

export interface ActionableCollectResult {
  defects: ActionableDefect[];
  /**
   * 身份不可核实的 must_fix（review 第 11 轮 P1）：warn/fail + 非空 must_fix 在场，但
   * 截图/build 身份缺失或不可算——**不可信缺陷不得触发回退**（改码方向可能是错的），
   * 但也**不等于没有缺陷**：调用方在 testing 内按 FAIL/retry 处置（引导重采补身份），
   * 耗尽后 halt。真实生产路径可达：install 成功但 install meta 写失败 → currentFp
   * 算不出 → 已知 must_fix 若静默丢弃，best_effort 下 gate 只 WARN、run 直接 advance。
   */
  unverified: UnverifiedDefect[];
  /**
   * f4b2c8e6 t1：仅在正式 device evidence 通过绑定校验后提供。test_case_flow 可用时只含
   * 根/独立失败；flow 缺失或 triage 失败时保守包含全部 failed case，这只会阻止 all-test_contract
   * 精修，不会造成错误精修。undefined = 无 evidence 或 evidence 不可信。
   */
  trustedDeviceRootClassifications?: DeviceDefectClassification[];
}

/** 只对已由 collector 验真的“非空且全 test_contract 根失败”做窄化精修。 */
export function refineFailureKindWithTrustedDeviceEvidence(
  base: FailureKind,
  rootClassifications: readonly DeviceDefectClassification[] | undefined,
): FailureKind {
  return base === 'code_regression' &&
    rootClassifications !== undefined &&
    rootClassifications.length > 0 &&
    rootClassifications.every((c) => c === 'test_contract')
    ? 'test_contract'
    : base;
}

/** d9e4b7c1 T2：collector 的 device_test 消费上下文（runner 内存直传，禁从事件反推） */
export interface DeviceTestCollectContext {
  attemptId: string;
  /** 当前 attempt 冻结的设备元组（a7 就绪门 deviceEnv 同源） */
  expectedTarget: { serial: string | null; target_kind: string | null; session_id: string | null };
  /** 本 attempt 的 gate harness 窗口（written_at / run meta 的唯一时间裁决窗口） */
  harnessWindow: { startMs: number; endMs: number };
  /** testing 阶段 reports 目录（evidence 与 run meta 所在） */
  reportsDir: string;
}

/**
 * d9e4b7c1 T1：attempt 级 device-test 构建配置冻结（testing 专属）。
 * 解析一次、经 deviceEnv 同发 agent 与 gate harness、直传生成物分类器——三方同源。
 * profileHarnessDir 由调用方从 **resolvedProfile.profileDir** 传入（review P2：硬编码
 * hmos-app 会让未来任何开启 testing 的 profile 错误获得 hmos 的源码例外；null / 模块
 * 缺失 → null，分类器同样不可用，行为与本改动前一致）。
 */
export function resolveFrozenDeviceTestConfig(
  projectRoot: string,
  profileHarnessDir: string | null,
): { product: string; buildMode: 'debug' | 'release' } | null {
  if (!profileHarnessDir) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const conv = require(path.join(profileHarnessDir, 'testing-build-conventions')) as {
      resolveDeviceTestProduct: (root: string) => string;
      resolveDeviceTestBuildMode: () => 'debug' | 'release';
    };
    return {
      product: conv.resolveDeviceTestProduct(projectRoot),
      buildMode: conv.resolveDeviceTestBuildMode(),
    };
  } catch {
    return null;
  }
}

/**
 * d9e4b7c1 T1：mutated diff 逐项过 profile 生成物分类器。
 * fail-closed：冻结配置缺失 / profile 目录缺失 / 分类器不可用 / 单条判定异常 → 该条按 violation。
 */
export function partitionGeneratedSourceChanges(
  projectRoot: string,
  changed: Array<{ path: string; how: 'added' | 'removed' | 'modified' | 'type-changed' }>,
  frozen: { product: string; buildMode: 'debug' | 'release' } | null,
  profileHarnessDir: string | null,
): {
  violations: Array<{ path: string; how: 'added' | 'removed' | 'modified' | 'type-changed' }>;
  generated: string[];
} {
  if (!frozen || !profileHarnessDir) return { violations: changed, generated: [] };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cls = require(path.join(profileHarnessDir, 'generated-source-classifier')) as {
      classifyGeneratedSourceChange: (
        root: string,
        change: { path: string; how: string },
        frozen: { product: string; buildMode: 'debug' | 'release' },
      ) => { kind: string };
    };
    const violations: Array<{ path: string; how: 'added' | 'removed' | 'modified' | 'type-changed' }> = [];
    const generated: string[] = [];
    for (const c of changed) {
      let verdict: { kind: string };
      try {
        verdict = cls.classifyGeneratedSourceChange(projectRoot, c, frozen);
      } catch {
        verdict = { kind: 'not_generated' };
      }
      if (verdict.kind === 'generated_legit') generated.push(c.path);
      else violations.push(c);
    }
    return { violations, generated };
  } catch {
    return { violations: changed, generated: [] };
  }
}

/**
 * d9e4b7c1 T2：evidence 绑定校验（纯函数导出供单测）。任一环不满足返回人读原因
 * （调用方把该轮全部失败 case 归 unverified）；全部通过返回 null。
 */
export function validateDeviceTestEvidenceBinding(
  doc: DeviceTestEvidenceDoc,
  runId: string,
  ctx: DeviceTestCollectContext,
): string | null {
  if (doc.schema_version !== '1.1') return `evidence schema_version 不受支持：${String(doc.schema_version)}`;
  if (doc.goal_run_id !== runId || doc.attempt_id !== ctx.attemptId) {
    return `evidence 身份不匹配（${String(doc.goal_run_id)}/${String(doc.attempt_id)} vs 当前 ${runId}/${ctx.attemptId}）`;
  }
  const t = doc.device_target ?? { serial: null, target_kind: null, session_id: null };
  const e = ctx.expectedTarget;
  if (
    (t.serial ?? null) !== (e.serial ?? null) ||
    (t.target_kind ?? null) !== (e.target_kind ?? null) ||
    (t.session_id ?? null) !== (e.session_id ?? null)
  ) {
    return 'evidence 设备元组与当前 attempt 冻结元组不一致（比完整三元组，不只比 serial）';
  }
  if (doc.install_executed !== true || doc.install_ok !== true) {
    return 'evidence 无本轮真实安装成功事实（install reuse/失败不作数）';
  }
  // trace 一致性：writer 直取本轮 holder；collector 以权威 resolver 二次核验两者一致
  const authoritative = resolveAuthoritativeHylyreTracePath(ctx.reportsDir);
  if (!authoritative || path.resolve(authoritative) !== path.resolve(String(doc.trace_path ?? ''))) {
    return 'evidence trace_path 与权威派生计划选择不一致';
  }
  // 时间窗：written_at 是唯一裁决字段（文件 mtime 仅诊断）；run meta 窗口须同落 harness 窗口
  const writtenAt = Date.parse(String(doc.written_at ?? ''));
  if (!Number.isFinite(writtenAt) || writtenAt < ctx.harnessWindow.startMs || writtenAt > ctx.harnessWindow.endMs) {
    return 'evidence written_at 不在本 attempt 的 harness 窗口内';
  }
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(ctx.reportsDir, 'device-test-run.meta.json'), 'utf-8'),
    ) as { run_started_at?: string; run_ended_at?: string };
    const rs = Date.parse(String(meta.run_started_at ?? ''));
    const re = Date.parse(String(meta.run_ended_at ?? ''));
    if (!Number.isFinite(rs) || !Number.isFinite(re) || rs < ctx.harnessWindow.startMs || re > ctx.harnessWindow.endMs) {
      return 'run meta 的 run_started_at/run_ended_at 不在本 attempt 的 harness 窗口内';
    }
  } catch {
    return 'device-test-run.meta.json 缺失或不可读（run 窗口无法核验）';
  }
  return null;
}

export function collectActionableDefects(
  projectRoot: string,
  feature: string,
  runId: string,
  deviceTest?: DeviceTestCollectContext,
): ActionableCollectResult {
  const out: ActionableDefect[] = [];
  const unverified: UnverifiedDefect[] = [];
  const pushVisualUnverified = (id: string, reasonCode: string, reason: string): void => {
    unverified.push({
      screen_or_case_id: id,
      reason,
      reason_code: reasonCode,
      source: 'visual',
      fingerprint: `visual|${id}|${reasonCode}`,
    });
  };
  let trustedDeviceRootClassifications: DeviceDefectClassification[] | undefined;

  // ---- A) visual_diff：新鲜 must_fix ----
  try {
    const profileDir = path.join(__dirname, '..', '..', 'profiles', 'hmos-app', 'harness');
    // 动态 require：core 不静态依赖 profile（层级边界；仓内既有先例）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vd = require(path.join(profileDir, 'visual-diff-check')) as {
      isStaleVisualDiffVerdict: (sc: unknown, root: string, o: { currentBuildFingerprint?: string | null }) => boolean;
      computeDefectFingerprint: (screenId: string, d: unknown) => string;
      hashScreenshotFile: (p: string) => string | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bf = require(path.join(profileDir, 'build-fingerprint')) as {
      resolveCurrentBuildFingerprint: (root: string, feature: string, phase?: string) => string | null;
    };
    const diffRel = path.posix.join(
      featuresDirRelOf(projectRoot), feature, 'device-testing', 'device-screenshots', 'visual-diff.json',
    );
    const diffAbs = path.join(projectRoot, ...diffRel.split('/'));
    if (fs.existsSync(diffAbs)) {
      const doc = JSON.parse(fs.readFileSync(diffAbs, 'utf-8')) as {
        screens?: Array<{
          screen_id?: string; verdict?: string; must_fix?: unknown[];
          evaluation_invalidated?: boolean; defects?: unknown[];
        }>;
      };
      const currentFp = bf.resolveCurrentBuildFingerprint(projectRoot, feature, 'testing');
      for (const sc of doc.screens ?? []) {
        const id = typeof sc.screen_id === 'string' ? sc.screen_id.trim() : '';
        if (!id) continue;
        // ⑤ 前置（review 第 13 轮）：evaluation_invalidated 的语义是"该屏评估整体不可信、
        // 待 critic 重评"——与 verdict/must_fix 无关。放在 ①② 之后的话，verdict=pass 的
        // 失效屏会在 ① 就被跳过，评估不可采信却照样完成。命中即进 unverified 通路
        //（不回退、retry 重评、耗尽 halt），无新状态机。
        if (sc.evaluation_invalidated === true) {
          pushVisualUnverified(id, 'evaluation_invalidated', '评估已被判无效（evaluation_invalidated，待 critic 重评）——该屏视觉评估尚不可采信');
          continue;
        }
        if (sc.verdict !== 'warn' && sc.verdict !== 'fail') continue;               // ①
        const mustFix = (sc.must_fix ?? []).filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
        if (mustFix.length === 0) continue;                                          // ②
        // ③④ 显式判定（review 第 10 轮：isStaleVisualDiffVerdict 对**缺** evaluated hash
        // 返回"不 stale"、currentFp 算不出时跳过 build 校验——缺身份的旧结论会触发错误
        // 回退。actionable 要求**身份齐备且匹配**，缺=不 actionable（fail-closed）：
        //   · evaluated_screenshot_hash 非空且等于盘上截图当前 hash；
        //   · 当前 build fingerprint 可算（无 HAP 身份 → 一律不回退）；
        //   · evaluated_build_fingerprint 非空且等于当前 build fingerprint。
        const evalShot = typeof (sc as { evaluated_screenshot_hash?: string }).evaluated_screenshot_hash === 'string'
          ? String((sc as { evaluated_screenshot_hash?: string }).evaluated_screenshot_hash).trim() : '';
        // 身份不可核实 ≠ 没缺陷：must_fix 在场时记 unverified（调用方 FAIL/retry，不静默丢）
        if (!evalShot) { pushVisualUnverified(id, 'evaluated_screenshot_hash_missing', '缺 evaluated_screenshot_hash（截图身份未绑定）'); continue; }   // ③
        const shotRel = typeof (sc as { screenshot_path?: string }).screenshot_path === 'string'
          ? String((sc as { screenshot_path?: string }).screenshot_path).trim() : '';
        if (!shotRel) { pushVisualUnverified(id, 'screenshot_path_missing', '缺 screenshot_path'); continue; }
        const shotNow = vd.hashScreenshotFile(
          path.isAbsolute(shotRel) ? shotRel : path.join(projectRoot, ...shotRel.split('/')),
        );
        // ③④ **一切身份失败统一进 unverified**（review 第 12 轮：此前把"明确不匹配"当
        // 正常代谢静默跳过——但"代谢"的前提是重评真的会发生；best_effort 下 stale gate
        // 只 WARN，若重评没发生，已知 must_fix 就假绿完成。持续 mismatch = 尚无当前身份
        // 的新判定 → 不驱动回退、也不允许完成，retry 引导重评，耗尽 halt。）
        if (!shotNow) { pushVisualUnverified(id, 'screenshot_unreadable', '绑定截图文件不可读（无法核验截图身份）'); continue; }
        if (shotNow !== evalShot) { pushVisualUnverified(id, 'screenshot_identity_mismatch', '截图身份不匹配（盘上截图已变但该屏尚未按当前截图重评）'); continue; }
        if (!currentFp) { pushVisualUnverified(id, 'current_build_fingerprint_unavailable', '当前 build fingerprint 不可算（install meta 缺失/损坏——install ok 但 meta 写失败的生产路径可达）'); continue; } // ④
        const evalFp = typeof (sc as { evaluated_build_fingerprint?: string }).evaluated_build_fingerprint === 'string'
          ? String((sc as { evaluated_build_fingerprint?: string }).evaluated_build_fingerprint).trim() : '';
        if (!evalFp) { pushVisualUnverified(id, 'evaluated_build_fingerprint_missing', '缺 evaluated_build_fingerprint（build 身份未绑定）'); continue; }
        if (evalFp !== currentFp) { pushVisualUnverified(id, 'build_identity_mismatch', 'build 身份不匹配（改码重装后该屏尚未按当前 HAP 重评）'); continue; } // ④
        if (vd.isStaleVisualDiffVerdict(sc, projectRoot, { currentBuildFingerprint: currentFp })) continue; // ⑤ stale
        // ---- adjudicated-repair-loop M1（plan e2b7c4a9 t1）：信号级候选 ----
        // 从「每屏一条聚合候选」改为「每结构化 defect 一条候选」：
        //   · identity = sha256(computeDefectFingerprint(screen, defect))——复用既有单条
        //     稳定指纹（screen|class|element|bbox_bucket[|producer#finding_id]），屏级集合
        //     拼接 hash 随缺陷集合/build 漂移、复发不可见，已废弃；
        //   · 指令=该 defect 的 note + 经既有 `defect.must_fix_refs` 反向解析出的 must_fix
        //     原文（门禁强制 must_fix 须被 refs 引用，refs 缺失由既有 BLOCKER 兜底）；
        //   · 纯文本 must_fix（无结构化 defect 锚）→ 保留既有整屏文案 hash 兜底（legacy
        //     语义，不入 signal@1 收敛判定——见 repair-candidates.ts identity_schema）。
        const scDefects = Array.isArray(sc.defects) ? sc.defects : [];
        const structural = scDefects
          .map((d) => {
            const fp = vd.computeDefectFingerprint(id, d);
            return fp ? { d, fp } : null;
          })
          .filter((x): x is { d: unknown; fp: string } => x !== null);
        if (structural.length > 0) {
          // 每信号一条候选；defect.must_fix_refs 反向解析到该屏 must_fix 原文作指令
          for (const { d, fp } of structural) {
            // plan ab072691 t5⑤：**provider 评审缺陷是独立的 critic candidate 源**，
            // 不是 producer 感知信号。它结构上恒「未经 primary defect-review 复核」——
            // provider 后于 primary 运行，而且让**盲的** primary 去复核视觉缺陷是伪制衡。
            // 若按 signal@1 走 primary 复核管线，盲 primary 会成为不具备证据的否决点。
            // 故合法 provider 证据直接物化
            // 驱动回修（legacy 语义：可回退、不入 signal@1 收敛、不需复核），
            // 收敛兜底交既有 no_progress_fuse。T8 信号一字不改。
            const fromVisualProvider =
              (d as { source?: { producer?: unknown } }).source?.producer === 'visual_provider';
            const refs = Array.isArray((d as { must_fix_refs?: unknown }).must_fix_refs)
              ? ((d as { must_fix_refs?: number[] }).must_fix_refs ?? [])
                .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < mustFix.length)
              : [];
            const linked = refs.map((i) => mustFix[i]).filter(Boolean);
            const note = typeof (d as { note?: unknown }).note === 'string'
              ? String((d as { note?: unknown }).note).trim() : '';
            const instructions: string[] = [];
            if (note) instructions.push(note);
            instructions.push(...linked.slice(0, 8));
            if (instructions.length === 0) instructions.push(...mustFix.slice(0, 8));
            out.push({
              source: 'visual_diff',
              screen_or_case_id: id,
              instructions: instructions.slice(0, 8),
              // 单条稳定指纹（screen|class|element|bbox_bucket[|producer#finding_id]）
              // ——不变拼接序、不排序聚合；identity=sha256 由 repair-candidates 层计算
              fingerprint: fp,
              evidence_path: `${diffRel}#${id}`,
              // 结构化视觉信号：进入 signal@1 身份 + M2 物化前复核。
              // provider 源例外（见上）：直接物化回修，不进复核/停等管线。
              signal_identity: !fromVisualProvider,
            });
          }
        } else {
          // 纯文本 must_fix 保底：整屏文案 hash（legacy；信号级收敛不作用于其后代候选）
          const fingerprint = `${id}|text:${createHash('sha256')
            .update(mustFix.map(m => m.trim().replace(/\s+/g, ' ')).slice().sort().join('\n'), 'utf-8')
            .digest('hex').slice(0, 16)}`;
          out.push({
            source: 'visual_diff',
            screen_or_case_id: id,
            instructions: mustFix.slice(0, 8),
            fingerprint,
            evidence_path: `${diffRel}#${id}`,
            // 纯文本兜底 = legacy：不入 signal@1 收敛、不需 defect-review 复核
            signal_identity: false,
          });
        }
      }
    }
  } catch (e) {
    // 读不出 visual-diff ≠ 干净——但"没有有效判定/P0 缺屏"由既有 visual_diff 门禁负责
    // 拦在 harness 侧（v22 已删 deterministic_signal_unavailable 人工阻断，不重造）。
    console.warn(`[actionable] visual-diff 读取失败（${(e as Error).message}）——本轮无 visual 回修信号`);
  }

  // ---- B) crash：本 run 的集合差归档 ----
  try {
    const diagRel = path.posix.join(
      featuresDirRelOf(projectRoot), feature, 'device-testing', 'reports', 'crash-diagnostics',
    );
    const diagAbs = path.join(projectRoot, ...diagRel.split('/'));
    if (fs.existsSync(diagAbs)) {
      for (const n of fs.readdirSync(diagAbs)) {
        if (!n.endsWith('.json')) continue;
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(diagAbs, n), 'utf-8')) as {
            screen_or_case?: string; run_id?: string | null;
            diagnosis?: { kind?: string; faultFiles?: string[] };
          };
          // 归档路径 feature 共享、跨 run 残留——只认本 run（F3 归档必写 run_id；无 run_id=过期）
          if (!doc.run_id || doc.run_id !== runId) continue;
          if (doc.diagnosis?.kind !== 'crash_suspected') continue;
          const id = String(doc.screen_or_case ?? n.replace(/\.json$/, ''));
          const faults = (doc.diagnosis.faultFiles ?? []).slice(0, 3).join(', ');
          out.push({
            source: 'crash',
            screen_or_case_id: id,
            instructions: [
              `进入「${id}」即崩溃（本轮 faultlog 新增：${faults || 'n/a'}）——修复崩溃本身而非导航/选择器；诊断摘要见 evidence_path`,
            ],
            // 同屏崩溃视为同一缺陷（faultlog 文件名含时间戳，入纹会让熔断永不命中）
            fingerprint: `crash|${id}`,
            evidence_path: `${diagRel}/${n}`,
            // crash 非结构化视觉：保持 legacy 契约（不入 signal@1 收敛、不需复核）
            signal_identity: false,
          });
        } catch { /* 单份诊断损坏 → 该文件不产信号（不拖垮整批） */ }
      }
    }
  } catch { /* 目录不可枚举 → 无 crash 信号 */ }

  // ---- C) device_test：正式 gate evidence（d9e4b7c1 T2）----
  // 只消费 runner pre-delete 后由 gate harness 写出的当前轮 evidence。缺文件 = 本轮无
  // device_test 信号（正式 gate 未达写入门槛时 run 门禁本身已 FAIL，重试路径接管），
  // 不制造 unverified 噪音；文件在场但任一身份/绑定校验不满足 → 该轮全部失败 case 进
  // unverified（不可信不得驱动改码，也不得装干净）。
  if (deviceTest) {
    try {
      const evPath = deviceTestEvidencePath(deviceTest.reportsDir);
      if (fs.existsSync(evPath)) {
        const pushUnverified = (
          id: string,
          reasonCode: string,
          reason: string,
          evidenceCase?: DeviceTestEvidenceCase,
        ): void => {
          const step = evidenceCase?.failing_step;
          unverified.push({
            screen_or_case_id: id,
            reason,
            reason_code: reasonCode,
            source: 'device_test',
            fingerprint: [
              'device_test',
              id,
              evidenceCase?.classification ?? 'evidence',
              step ? `step:${step.index}` : 'step:none',
              step ? `${step.selector_kind}:${step.selector}` : 'selector:none',
              reasonCode,
            ].join('|'),
          });
        };
        let doc: DeviceTestEvidenceDoc | null = null;
        try {
          doc = JSON.parse(fs.readFileSync(evPath, 'utf-8')) as DeviceTestEvidenceDoc;
        } catch (e) {
          pushUnverified('device-test-evidence', 'evidence_parse_failed', `evidence 不可解析：${(e as Error).message}`);
        }
        if (doc) {
          const failedCases = (doc.cases ?? []).filter(c => c && typeof c.case_id === 'string');
          const bindFailure = validateDeviceTestEvidenceBinding(doc, runId, deviceTest);
          if (bindFailure) {
            if (failedCases.length === 0) pushUnverified('device-test-evidence', 'evidence_binding_invalid', bindFailure);
            for (const c of failedCases) pushUnverified(c.case_id, 'evidence_binding_invalid', bindFailure, c);
          } else {
            // 根/级联三分复用 test_case_flow SSOT（级联 case 不产缺陷也不产 unverified——
            // 与既有 run gate 的 triage 语义一致）；无 flow 块 → 不归类，全部按根处理。
            const failedIds = failedCases.map(c => c.case_id);
            let rootSet: Set<string> | null = null;
            try {
              const planResolved = resolveFeatureArtifact(projectRoot, feature, 'test-plan.md');
              const planMd = fs.existsSync(planResolved.actualPath)
                ? fs.readFileSync(planResolved.actualPath, 'utf-8')
                : null;
              const parsedFlow = planMd ? parseTestCaseFlowBlock(planMd) : { flow: null };
              if (parsedFlow.flow) {
                const triage = triageCascade(parsedFlow.flow, failedIds);
                rootSet = new Set([...triage.rootFails, ...triage.independentFails]);
              }
            } catch {
              rootSet = null;
            }
            const rootCases = rootSet
              ? failedCases.filter((c) => rootSet!.has(c.case_id))
              : failedCases;
            trustedDeviceRootClassifications = rootCases.map((c) => c.classification);
            for (const c of failedCases) {
              if (rootSet && !rootSet.has(c.case_id)) continue; // 级联：根修好自然消失
              // plan e6b3f8d2 t3：锚点漂移分类已删除——它的回修指令要求产品注入已撤销的
              // framework 侧 canonical anchor（侵入宿主源码形态），随强制 UI kit 一并清除。
              const actionableClassification =
                c.classification === 'product_actionable' ||
                c.classification === 'product_state';
              if (
                actionableClassification &&
                doc.device_target?.target_kind === 'physical' &&
                c.failing_step
              ) {
                const evidenceLine = c.evidence?.ui_dump
                  ? `UI dump evidence: ${c.evidence.ui_dump}` +
                    (c.evidence.screenshot ? `; screenshot: ${c.evidence.screenshot}` : '')
                  : null;
                const instructions =
                  c.classification === 'product_state'
                    ? [
                        `On-device test case ${c.case_id} failed at step ${c.failing_step.index} ` +
                          `(${c.failing_step.action}): the element exists but its observable state ` +
                          `does not satisfy the retained predicate. ${c.reason ?? ''}`.trim(),
                        `Fix product state/binding logic; expected vs actual node observations are in device evidence.`,
                      ]
                    : [
                        `On-device test case ${c.case_id} failed at step ${c.failing_step.index} ` +
                          `(${c.failing_step.action}): ui-spec requires ` +
                          `${c.failing_step.selector_kind}=${c.failing_step.selector} on screen ` +
                          `${c.expected_screen ?? '(unknown)'}, but the whole attempt evidence pool has no exact hit.`,
                        `Implement the ui-spec-declared element id/text in product code for that screen.`,
                      ];
                if (evidenceLine) instructions.push(evidenceLine);
                if (c.diagnostics?.length) {
                  instructions.push(`Additional diagnostics: ${c.diagnostics.map(d => `${d.code}: ${d.message}`).join('; ')}`);
                }
                if (c.error_excerpt) instructions.push(`Machine error: ${c.error_excerpt.slice(0, 200)}`);
                out.push({
                  source: 'device_test',
                  screen_or_case_id: c.case_id,
                  instructions,
                  fingerprint:
                    `${c.classification}|${c.case_id}|step:${c.failing_step.index}|` +
                    `${c.failing_step.selector_kind}:${c.failing_step.selector}`,
                  evidence_path: `${path.relative(projectRoot, evPath).split(path.sep).join('/')}#${c.case_id}`,
                  // device_test 非结构化视觉：保持 legacy 契约（不入 signal@1 收敛、不需复核）
                  signal_identity: false,
                });
              } else if (actionableClassification) {
                pushUnverified(
                  c.case_id,
                  'actionable_requires_physical',
                  `${c.classification} 但 target_kind=${doc.device_target?.target_kind ?? 'null'} 非 physical——非真机结果不驱动回修`,
                  c,
                );
              } else {
                const availableNodes = c.classification === 'test_contract'
                  ? `；请改用该屏 ui-spec 声明的精确 node/text`
                  : '';
                pushUnverified(
                  c.case_id,
                  c.reason_code ?? `classification_${c.classification}`,
                  `${c.classification}${c.reason ? `（${c.reason}）` : ''}${availableNodes}——不属可回修产品缺陷`,
                  c,
                );
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[actionable] device-test-evidence 消费失败（${(e as Error).message}）——本轮无 device 回修信号`);
    }
  }

  return {
    defects: out,
    unverified,
    ...(trustedDeviceRootClassifications !== undefined
      ? { trustedDeviceRootClassifications }
      : {}),
  };
}

/** F1 缺陷交接：回退后注入下一次 coding prompt 的必做段 */
export function buildTestingDefectsBlock(defects: readonly ActionableDefect[]): string {
  if (defects.length === 0) return '';
  const lines: string[] = [
    '',
    '## Testing defects to fix (post-backtrack — REQUIRED)',
    '',
    'The previous TESTING round found the following actionable defects. The runner backtracked to',
    'coding because fixing them requires product-code changes (testing itself is forbidden from',
    'editing source). Fix EVERY item below, then the chain re-runs review/ut/testing:',
    '',
  ];
  for (const d of defects.slice(0, 20)) {
    lines.push(`### [${d.source}] ${d.screen_or_case_id}`);
    for (const ins of d.instructions) lines.push(`- ${ins}`);
    lines.push(`- Evidence: \`${d.evidence_path}\``);
    lines.push('');
  }
  if (defects.length > 20) lines.push(`(…and ${defects.length - 20} more defects — see events.jsonl)`);
  return lines.join('\n');
}

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
  // plan c4e8a1f7 T2：OCR 预扫消费与 capability/refs receipt/prompt 同一共享发现集合
  //（正文显式 ∪ source 直接父目录；仅空集回退 ux-reference）。
  const images = resolveRequirementReferenceImages(
    projectRoot,
    manifest.feature,
    manifest.requirement,
    { requirementSourceFiles: manifest.requirement_source_files },
  );
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
    const deref = dereferenceRequirementDocs(projectRoot, manifest.requirement, {
      excludePrefixes: [`doc/features/${manifest.feature}/`],
    });
    isUiRelevant = detectUiRelevantRequirement(deref.combined);
    desired = detectPixel1to1Intent(deref.combined) ? 'pixel_1to1' : 'semantic_layout';
  }
  if (!isUiRelevant) return null;

  // post-impl P0-1（plan f6b2d9a4）：SSOT-first——preflight/initializer 已产
  // fidelity-intent.json 时，档位（selected）/严格度/素材轴以 SSOT 为准（spec.md 投影
  // 与需求启发式仅作回落），prompt 与门禁同源；否则银行卡场景 preflight 判 auto_crop
  // 而 prompt 仍教 placeholder，agent 首轮产出即与一致性门禁相撞。
  const intentSsot = loadFidelityIntentSsot(projectRoot, manifest.feature);
  if (intentSsot) desired = intentSsot.selected_fidelity;
  const capSnap = loadCapabilitySnapshot(projectRoot, manifest.feature);
  // plan c4e8a1f7 T3：adapter 工具事件 provenance（能力块可审计分轴出口需要）
  const toolEventProvenance = loadGoalCapability(frameworkRoot, manifest.adapter ?? 'generic')
    .capability?.tool_event_provenance ?? 'none';

  const mmProbe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, manifest.adapter, {
    runId: manifest.run_id,
    ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
  });
  const toolkit = loadProfileOcrToolkit(resolvedProfile.profileDir);
  // E1：金丝雀 verdict=ocr_capable 是补充信号（agent 自身展示了从图片提取文字的能力，即便
  // 判定其无视觉）——OR 进 ocrAvailable，不替代框架自身 OCR 环境探测（后者更可靠/确定性）。
  // cursor review（E6 后）：与 harness-runner.ts 门禁钳制共用同一口径，不再各算一遍。
  const ocrAvailable = resolveOcrAvailableForRun(projectRoot, resolvedProfile.profileDir, manifest.adapter, {
    runId: manifest.run_id,
    ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
  });
  // 能力只回答当前执行是否能读图。产物质量由当次 gate 判断，不得反向致盲后续 attempt。
  const effectiveSnap = capSnap;
  const effectiveIntent = intentSsot;
  const hasVision = effectiveSnap ? effectiveSnap.vision.verdict : mmProbe.supported;
  const effectiveOcr = effectiveSnap ? effectiveSnap.ocr.verdict : ocrAvailable;
  // plan ab072691 t2①：vision_mode 优先取**冻结快照**（preflight 派生一次、run 内不可变）；
  // 无快照（legacy / 非 goal 现场）才按同一条纯规则现算。任何 provider 调用结果都不参与——
  // 这里只看静态资格，没有 provider 金丝雀。
  const visionMode: VisionMode = effectiveSnap?.vision_mode
    ?? resolveVisionModeForRun(frameworkRoot, hasVision, manifest.visual_provider_pin);
  const visualProvider = effectiveSnap?.visual_provider
    ?? (visionMode === 'delegated' ? manifest.visual_provider_pin : undefined);
  // t2③：钳制吃评审轴——delegated 与 native 同样不钳（pixel_1to1 放行），blind 逐字不变。
  const clamp = clampFidelityByCapability(desired, {
    hasVision,
    ocrAvailable: effectiveOcr,
    reviewVision: reviewVisionForMode(visionMode),
  });

  // spec 是 OCR 预扫描的唯一生产者（有真实 OCR 耗时）；plan/coding 只列出盘上已有的产物
  // （宿主复验修复①——此前 plan/coding 恒为空数组，能力块对 agent 谎称"没找到参考图"）。
  const ocrJsonPaths = !hasVision && effectiveOcr
    ? phase === 'spec' && toolkit
      ? runOcrPrescanForSpec(projectRoot, frameworkRoot, resolvedProfile, manifest, toolkit)
      : listExistingOcrPrescanOutputs(projectRoot, frameworkRoot, manifest.feature)
    : [];

  // plan c4e8a1f7 T2：共享发现集合（正文显式 ∪ source 直接父目录；仅空集回退 ux-reference）
  // ——capability/OCR/prompt/refs receipt 全消费面同一分母（project-relative、确定性排序）。
  const referenceImagePaths = resolveRequirementReferenceImages(
    projectRoot,
    manifest.feature,
    manifest.requirement,
    { requirementSourceFiles: manifest.requirement_source_files },
  ).map(p => path.relative(projectRoot, p).replace(/\\/g, '/'));

  // plan ab072691 t4④：本函数**只列不产**（它是同步的，provider 调用是异步的）。
  // 生产由 phase 循环在 spec 且 delegated 时显式 await 后回列——与 OCR「spec 生产、
  // plan/coding 只列」同一条纪律，只是生产点从同步函数内挪到了它的异步调用方。
  const visualObservationPaths = listVisualObservationOutputs(projectRoot, frameworkRoot, manifest.feature);

  return {
    hasVision,
    ocrAvailable: effectiveOcr,
    visionMode,
    ...(visualProvider ? { visualProvider: { ...visualProvider } } : {}),
    ...(visualObservationPaths.length > 0 ? { visualObservationPaths } : {}),
    selectedFidelity: desired,
    effectiveFidelity: clamp.effective,
    fidelityClamped: clamp.clamped,
    ocrJsonPaths,
    acceptanceStrictness: effectiveIntent?.acceptance_strictness ?? 'best_effort',
    assetAcquisitionMode: effectiveIntent?.asset_acquisition_mode,
    referenceImagePaths,
    toolEventProvenance,
    // e9d4b7a3 t3：显式 successor 修复增量判定（合并标记在场）——编码代理据此知道
    // 本轮增量点名素材为硬契约（见 buildCapabilityBlock 优先级段）。
    successorRepairRequirement: isSuccessorRepairRequirement(manifest.requirement),
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
 * resume 起点的 invalidation 过滤：新协议读取一条 phase_backtrack_requested 的
 * invalidated_phases[]；旧协议继续读取逐 phase 的 phase_invalidated。事件之后没有该
 * phase 新的 PASS phase_verdict → 该 phase 的旧 outcome 剔除、resume 起点回退到最早位。
 */
export function applyInvalidationsToResume(
  chain: readonly FeaturePhase[],
  outcomes: GoalPhaseOutcome[],
  events: ReadonlyArray<{
    type?: string;
    phase?: string;
    verdict?: string;
    invalidated_phases?: unknown;
  }>,
): { outcomes: GoalPhaseOutcome[]; startIndex: number; invalidatedPhases: string[]; postAgentPhases: string[]; postAgentAttemptIds: Record<string, string> } {
  const stillInvalidated = new Set<string>();
  // postAgentAttemptIds：phase → 原 settled invocation 的 invoke_id（主循环复用身份，
  // 不新建 attempt）——完全从既有 events 派生。
  const postAgentAttemptIds: Record<string, string> = {};
  // adjudicated-repair-loop（review 修复）：postAgentPhases **只从最新一条
  // phase_backtrack_requested 的窗口派生**——旧窗口的 settled 不得污染更新的 request-only
  // 窗口（request1→settled→FAIL→request2→crash 时，request2 是最新窗口且无 settled，
  // coding 必须重新 invoke）。stillInvalidated 仍按全部 request 累计（被失效且未重验的
  // phase 都要剔除/回退）。
  // 超时/被杀的 settled（agent_process_settled 带 timed_out/kill_reason）不算已完成。
  const postAgentPhases = new Set<string>();
  let lastRequestIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'phase_backtrack_requested') { lastRequestIdx = i; break; }
  }
  events.forEach((e, idx) => {
    const phases = e.type === 'phase_backtrack_requested' && Array.isArray(e.invalidated_phases)
      ? e.invalidated_phases.filter((p): p is string => typeof p === 'string')
      : e.type === 'phase_invalidated' && typeof e.phase === 'string'
        ? [e.phase]
        : [];
    for (const phase of phases) {
      // 窗口切片：本 request 之后、下一条 phase_backtrack_requested 之前的事件
      let windowEnd = events.length;
      for (let j = idx + 1; j < events.length; j++) {
        if (events[j].type === 'phase_backtrack_requested') {
          if (j === idx) continue;
          windowEnd = j;
          break;
        }
      }
      const later = events.slice(idx + 1, windowEnd);
      const revalidated = later.some(
        later => later.type === 'phase_verdict' && later.phase === phase && later.verdict === 'PASS',
      );
      // review 收口：**只看最新 request 窗口内该 target phase 的最后一条执行事件**——
      // 判据（与复用身份同一判据，消除「有 settled 即跳、却取最后一条」的不一致）：
      //   · 最后是**非超时** agent_process_settled 且带明确 invoke_id → validation-only
      //     恢复（复用该 ID）；
      //   · 最后是 agent_invoke_start / 超时或 kill 的 settled / FAIL phase_verdict /
      //     身份不完整（无 invoke_id）→ 不跳过 agent（正常恢复，候选上下文保留）。
      const phaseEvents = later.filter(
        (x) =>
          x.phase === phase &&
          (x.type === 'agent_invoke_start' ||
            x.type === 'agent_process_settled' ||
            x.type === 'phase_verdict'),
      );
      const lastExec = phaseEvents[phaseEvents.length - 1] ?? null;
      const settledOk =
        lastExec?.type === 'agent_process_settled' &&
        (lastExec as { timed_out?: boolean; kill_reason?: string }).timed_out !== true &&
        (lastExec as { kill_reason?: string }).kill_reason !== 'agent_timeout' &&
        typeof (lastExec as { invoke_id?: string }).invoke_id === 'string' &&
        (lastExec as { invoke_id?: string }).invoke_id!.length > 0 &&
        // settled 之后不得再有该 phase 的失败 verdict（FAIL 已判定=正常失败恢复）
        !later.some(
          (x) => x.type === 'phase_verdict' && x.phase === phase && x.verdict === 'FAIL',
        );
      if (!revalidated) {
        if (settledOk) {
          // 最新执行=已完成（非超时、身份齐）：agent 工作已完成（崩溃在 harness/verdict 边界）
          // ——outcomes 旧条目仍剔除（要重验），起点到该 phase（不再更深），resume 主循环
          // skip invoke 只走验证边界。**仅最新 request 窗口的 settled 计入 postAgent**。
          stillInvalidated.add(phase);
          if (idx === lastRequestIdx) {
            postAgentPhases.add(phase);
            postAgentAttemptIds[phase] = String((lastExec as { invoke_id?: string }).invoke_id);
          }
        } else {
          stillInvalidated.add(phase);
        }
      } else {
        stillInvalidated.delete(phase);
      }
    }
  });
  if (stillInvalidated.size === 0) {
    return { outcomes, startIndex: chain.length, invalidatedPhases: [], postAgentPhases: [...postAgentPhases], postAgentAttemptIds };
  }
  const filtered = outcomes.filter(o => !stillInvalidated.has(o.phase));
  const earliest = Math.min(
    ...[...stillInvalidated].map(p => chain.indexOf(p as FeaturePhase)).filter(i => i >= 0),
  );
  return { outcomes: filtered, startIndex: earliest, invalidatedPhases: [...stillInvalidated], postAgentPhases: [...postAgentPhases], postAgentAttemptIds };
}

/**
 * plan b5f1d9c3 t1：resume 验证优先——普通 `phase_halt` 停等（WAITING 投影）后 `--resume` 时，若事件窗口证明
 * “agent 工作已完成、只差验证（gate harness）”，则派生 validation-only 资格——复用既有
 * resumePostAgentPhases 机器（零新事件/状态/账本），跳过重新 invoke agent、直接进 gate harness
 * 重验（宿主 run 1c95e3：resume 的 51 分钟 agent 时间实为纯废，gate 一轮 2m41s 即 PASS）。
 *
 * 判据只消费既有 `run_disposition` 投影 + 事件形状，**不做第二张分类表**（仓库明令下游只读
 * run_disposition、不得按 halt_reason 再分类；INCIDENT_REGISTRY.class 表达责任归属而非“agent 是否
 * 已完成”，禁止用作判据）：
 *   1. 最新一条 `phase_halt` 事件的 `run_disposition === 'WAITING'`（字段在场且为 WAITING；
 *      RECOVERY_PENDING/TERMINAL/缺字段一律不派生）；
 *   2. halt phase 的**最新执行事件**是有效 `agent_process_settled`——带非空 `invoke_id`、
 *      `timed_out !== true`、`kill_reason !== 'agent_timeout'`（超时/被杀的 settled 不算已完成）；
 *   3. 同一 invoke_id 之后、halt 之前已有 `harness_end`（agent 退出后 gate harness 已跑过——
 *      agent 做到 harness 边界）；
 *   4. 该 settled 之后该 phase 无更新的 `agent_invoke_start`/`agent_process_settled`/`phase_verdict`
 *      （避免把旧 settled 误当最新工作）；
 *   5. **该 halt 之后无更新的 `phase_backtrack_requested`/`phase_invalidated`**（review P1：新回退/
 *      失效窗口优先，资格完全交给既有 applyInvalidationsToResume——否则旧 halt 资格会覆盖新的
 *      backtrack 窗口，导致 resume 重跑回退链却在目标 phase 误跳 agent）。
 *
 * 任一不满足 → 返回 null：**只是不从这个旧 halt 派生资格**，后续完全由既有 resume/invalidation
 * 路径决定（新窗口的 settled 仍可能由 applyInvalidationsToResume 独立派生 validation-only 资格）；
 * 本函数不修改任何 TERMINAL/RECOVERY_PENDING 投影的终态语义，也不触碰
 * checkTerminalResumeGuard 的 cooldown/--force-resume 契约。
 */
export function deriveHaltValidationOnlyEligibility(
  events: ReadonlyArray<{
    type?: string;
    phase?: string;
    run_disposition?: unknown;
    invoke_id?: unknown;
    timed_out?: unknown;
    kill_reason?: unknown;
    verdict?: unknown;
    action?: unknown;
    to_phase?: unknown;
  }>,
): { phase: string; invoke_id: string } | null {
  // 最新一条 phase_halt
  let lastHaltIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'phase_halt') { lastHaltIdx = i; break; }
  }
  if (lastHaltIdx < 0) return null;
  const halt = events[lastHaltIdx];
  // 5. halt 之后不得有更新的 backtrack/invalidation 窗口（review P1：新窗口优先，
  //    资格完全交给 applyInvalidationsToResume——旧 halt 不得覆盖新回退链）。
  for (let i = lastHaltIdx + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'phase_backtrack_requested' || e.type === 'phase_invalidated') {
      return null;
    }
  }
  // 1. WAITING 投影（缺字段/非 WAITING → 不派生；TERMINAL/RECOVERY_PENDING 语义本 change 不动）
  if (halt.run_disposition !== 'WAITING') return null;
  const phase = typeof halt.phase === 'string' && halt.phase.length > 0 ? halt.phase : null;
  if (!phase) return null;
  // 2. 该 phase 最新执行事件必须是有效 settled（倒序找第一条执行事件即最新）
  let settled: Record<string, unknown> | null = null;
  let settledIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.phase !== phase) continue;
    if (e.type !== 'agent_invoke_start' && e.type !== 'agent_process_settled' && e.type !== 'phase_verdict') {
      continue;
    }
    if (e.type === 'agent_process_settled') {
      const invokeId = typeof e.invoke_id === 'string' && e.invoke_id.length > 0 ? e.invoke_id : null;
      const timedOut = e.timed_out === true;
      const killTimeout = e.kill_reason === 'agent_timeout';
      if (invokeId && !timedOut && !killTimeout) {
        settled = e;
        settledIdx = i;
      }
    }
    break; // 最新执行事件已见（无论是否有效 settled）
  }
  if (!settled || settledIdx < 0) return null;
  const invokeId = String(settled.invoke_id);
  // 3. 同一 invoke 之后、halt 之前已有 harness_end
  let harnessEnded = false;
  for (let i = settledIdx + 1; i < lastHaltIdx; i++) {
    const e = events[i];
    if (e.type === 'harness_end' && e.phase === phase && e.invoke_id === invokeId) {
      harnessEnded = true;
      break;
    }
  }
  if (!harnessEnded) return null;
  // 4. settled 之后该 phase 无更新的执行事件（harness_end 不属执行事件，可存在）
  for (let i = settledIdx + 1; i < events.length; i++) {
    const e = events[i];
    if (e.phase !== phase) continue;
    if (e.type === 'agent_invoke_start' || e.type === 'agent_process_settled' || e.type === 'phase_verdict') {
      return null;
    }
  }
  return { phase, invoke_id: invokeId };
}

/**
 * T2 5a 收口刀（codex P1-1）：manifest **出生基线**解析——只认仓内 events，不认场外缓存。
 *
 * fold 语义（与 resolveFrozenManifestHash 同构，"首个 run_start
 * 说了算"）：首个 `run_start.manifest_identity_fields` 为出生基线；其后每条
 * `manifest_identity_rebase.to_fields`（授权 rebase 的审计事件）把基线前进到新值——
 * override rebase 过一次后，后续 resume 不再复报同一漂移。
 *
 * 无 run_start / 旧 schema 缺该字段 → null（无基线，按当前身份继续）；刻意不回落
 * 场外缓存，避免同一身份出现第二真源。
 */
export function resolveManifestIdentityBaseline(
  priorEvents: ReadonlyArray<{ type?: string; manifest_identity_fields?: unknown; to_fields?: unknown }>,
): Record<string, string> | null {
  const created = priorEvents.filter((event) => event.type === 'run_created');
  if (created.length > 1) {
    throw new Error('run_created 出生事件重复，无法确定唯一出生基线（creation_incomplete）。');
  }
  let baseline: Record<string, string> | null = null;
  const modernBirth = created[0];
  if (modernBirth) {
    if (!modernBirth.manifest_identity_fields || typeof modernBirth.manifest_identity_fields !== 'object') {
      throw new Error('run_created 缺少 manifest_identity_fields，无法恢复出生基线（creation_incomplete）。');
    }
    baseline = modernBirth.manifest_identity_fields as Record<string, string>;
  }
  for (const e of priorEvents) {
    if (!modernBirth && e.type === 'run_start' && baseline === null
        && e.manifest_identity_fields && typeof e.manifest_identity_fields === 'object') {
      baseline = e.manifest_identity_fields as Record<string, string>;
    } else if (e.type === 'manifest_identity_rebase'
        && e.to_fields && typeof e.to_fields === 'object') {
      const rebased = e.to_fields as Record<string, string>;
      if (modernBirth && baseline?.run_base_sha !== rebased.run_base_sha) {
        throw new Error('manifest_identity_rebase 试图改写 run_base_sha（baseline_corruption_or_tampering）。');
      }
      baseline = rebased;
    }
  }
  return baseline;
}

/**
 * manifest 身份漂移决策（锁内、副作用前调用）——纯函数抽出供真路径测试。
 * 基线信任规则（T2 5a 收口刀改版）：
 *   - 基线=events 出生基线（resolveManifestIdentityBaseline）；null → 无基线，当前身份即
 *     effective（场外缓存的存在与否**不得**出现在本决策的输入里）；
 *   - 字段级授权：changed ⊆ (override 旗标授权集 ∪ fidelity transition 验真授权集) 才 rebase；
 *     未授权漂移 halt（真冲突：出生意图与当前 manifest 不一致且无人授权）。
 *   - legacy checkpoint 聚合迁移分支已随 checkpoint 基线一并退役（events 无 legacy 形态问题）。
 */
export function resolveManifestDriftDecision(args: {
  currentFields: Record<string, string>;
  currentHash: string;
  /** events 出生基线（null=无基线，见 resolveManifestIdentityBaseline） */
  birthFields: Record<string, string> | null;
  overrides: { 'override-manifest': boolean; 'override-start': boolean; 'override-end': boolean };
  fidelityTransitionFields: ReadonlySet<string>;
}): {
  currentFields: Record<string, string>;
  effectiveHash: string;
  rebaseApplied: boolean;
  rebaseAuthorizedBy: string | null;
  /** e9d4b7a3 t5：**所有分支**的顶层字段级变更清单（无漂移=稳定空数组）——
   * 授权 rebase 的分支此前把 diffManifestIdentityFields 结果丢弃，emit 只写 to_fields
   * （完整哈希表非 diff）——budget-only 刷新判定无从谈起。 */
  changedFields: string[];
  halt: {
    message: string;
    changedFields: string[];
    authorized: string[] | 'all';
    classification?: 'baseline_corruption_or_tampering';
  } | null;
} {
  const base = {
    currentFields: args.currentFields,
    effectiveHash: args.currentHash,
    rebaseApplied: false,
    rebaseAuthorizedBy: null as string | null,
    changedFields: [] as string[],
    halt: null as {
      message: string;
      changedFields: string[];
      authorized: string[] | 'all';
      classification?: 'baseline_corruption_or_tampering';
    } | null,
  };
  if (args.birthFields === null) return base;
  const changed = diffManifestIdentityFields(args.birthFields, args.currentFields);
  if (changed.length === 0) return base;
  if (changed.includes('run_base_sha')) {
    return {
      ...base,
      changedFields: changed,
      halt: {
        message:
          'manifest.run_base_sha 与 run_created 出生基线不一致——该字段不可由 override/rebase 改写，' +
          '按 baseline_corruption_or_tampering 拒绝继续。',
        changedFields: changed,
        authorized: [],
        classification: 'baseline_corruption_or_tampering',
      },
    };
  }
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
      changedFields: changed,
      halt: {
        message:
          `manifest 身份字段在停机窗口漂移且未被对应 override 授权（变更字段：${changed.join('、')}；` +
          `授权字段：${authAll ? 'all' : (authList as string[]).join('、') || '无'}）——resume 拒绝继续（fail-closed）。` +
          '合法变更：--override-manifest（整体）/ --override-start/--override-end（对应字段）/ ' +
          '--fidelity（只允许升档；降档须以新需求从 spec 重验）。',
        changedFields: changed,
        authorized: authList,
      },
    };
  }
  return {
    ...base,
    changedFields: changed,
    rebaseApplied: true,
    rebaseAuthorizedBy: authAll ? 'override-manifest' : [...(authSet ?? [])].sort().join(','),
  };
}

/**
 * e9d4b7a3 t5：budget-only 授权 rebase 判定（precision 判据：非空 且 全部字段恰为 budget）。
 * 只有这种把 manifest 编辑降级为"纯预算提额、不影响任何产物语义"的 rebase 才允许
 * 确定性刷新上游证据；非 budget-only rebase（requirement/chain/fidelity 等变更）必须
 * 走正常 halt/重跑路径，不得顺带用刷新假装证据仍然可信。
 */
export function isBudgetOnlyIdentityChange(changedFields: readonly string[]): boolean {
  return changedFields.length === 1 && changedFields[0] === 'budget';
}

// ---------------------------------------------------------------------------
// feature 级 head（七轮 P0-3 起，收口后语义）：vision 账本是 feature 级共享文件，
// per-run checkpoint 只是同 run resume 的恢复缓存；head 是**跨 run 连续性观察锚**
// （无签名纯内容快照）——每次 fresh run/resume 先验，失配/损坏=自动 discontinuity
// 重建（记录断裂、撤销连续性主张），合法写点后单调 generation 更新。
// ---------------------------------------------------------------------------


/**
 * plan d6b1a8e3 t5④（codex 订正）：把**生产端已落盘的真实投影**回填进 outcome。
 *
 * 为什么不在 report 端算：报告只有 halt_reason 与中性上下文，按它重新 decide() 会丢掉
 * runner 当时掌握的结构事实（回退预算 / 截断链 / 重复 drift 指纹），把 TERMINAL 重算成
 * RECOVERY_PENDING——「运行器说本 run 已无法恢复、报告说正在自动恢复」。
 *
 * 为什么不逐个 outcomes.push 补：halt push 点有十几处，逐个补必漏；而事件写盘层
 * （withRunDisposition）已对**每一条** phase_halt 落了投影，取同 phase 最后一条即权威值。
 */
export function enrichOutcomesWithProjection<T extends { phase: unknown; halted?: boolean }>(
  outcomes: readonly T[],
  events: ReadonlyArray<Record<string, unknown>>,
): T[] {
  const byPhase = new Map<string, { run_disposition?: unknown; run_wait_kind?: unknown }>();
  // codex 第九批 P0：**有序覆盖语义**（与 rebuildOutcomesFromEvents 同规则）——
  // 后来的 phase_verdict{advance/defer} 清除该 phase 的旧 halt 投影。否则
  // 「ut WAITING 停放 → resume 重跑 PASS」会产出"ut PASS + run_disposition=WAITING"
  // 的自相矛盾报告，且下一次 resume 又把已成功的 ut 重新入队（纯函数回放实证）。
  const CLEARING_ACTIONS = new Set([
    'advance', 'defer_external_and_continue_if_allowed', 'defer_external_and_halt',
  ]);
  for (const e of events) {
    if (e?.type === 'phase_verdict' && CLEARING_ACTIONS.has(String(e.action))) {
      byPhase.delete(String(e.phase));
      continue;
    }
    if (e?.type !== 'phase_halt') continue;
    if (typeof e.run_disposition !== 'string') continue;
    byPhase.set(String(e.phase), { run_disposition: e.run_disposition, run_wait_kind: e.run_wait_kind });
  }
  return outcomes.map((o) => {
    const proj = byPhase.get(String(o.phase));
    if (!proj) return o;
    return {
      ...o,
      run_disposition: proj.run_disposition,
      ...(typeof proj.run_wait_kind === 'string' ? { run_wait_kind: proj.run_wait_kind } : {}),
    };
  });
}

export function capRunStatusForDeviceAuthenticity(
  status: string,
  opts: { testingRan: boolean; targetKind: DeviceTargetKind | null },
): { status: string; capped: boolean; reason?: string } {
  if (status !== 'CHAIN_SLICE_COMPLETED' || !opts.testingRan) return { status, capped: false };
  // targetKind=null：testing 未经设备就绪门（profile 未声明需设备 / dry-run）——该链路
  // 与设备无关，封顶无从谈起。**不得**把它当作 'unknown' 处理，否则所有非设备工程的
  // 正常完成都会被误降为 PARTIAL。
  if (opts.targetKind === null) return { status, capped: false };
  if (opts.targetKind === 'physical') return { status, capped: false };
  return {
    status: 'PARTIAL',
    capped: true,
    reason: `testing_on_${opts.targetKind}_device`,
  };
}

/** ut/testing 期 source drift 对账 + 授权分类（attestation 缺失=review 未闭环，归上游门禁管，此处不判）。 */
export type MutablePhaseDriftDecision = DriftClassification & {
  /** plan e7c2a4d8 T3b/c：当前 drift 内容 fingerprint 与条目（裁决请求单/比对消费；
   * no_drift 或不可计算时为 null）。 */
  driftFingerprint?: string | null;
  driftEntries?: DriftFingerprintEntry[] | null;
  /** T4d（v6 轮 P0）：goal 环境 attestation 缺失/损坏→不走 reconciliation 的 fail-closed
   * 信号（调用方发射 goal_review_closure_baseline_unavailable，本函数不再静默 no_drift）。 */
  baselineUnavailable?: boolean;
};

export function reconcileMutablePhaseSourceDrift(args: {
  projectRoot: string;
  manifest: GoalManifest;
  phase: FeaturePhase;
  frozenManifestHash: string | null;
  /** goal 编排环境（缺 attestation fail-closed）；非 goal 消费面维持现 fallback 语义。 */
  goalEnv?: boolean;
}): MutablePhaseDriftDecision {
  const att = loadReviewClosureAttestation(args.projectRoot, args.manifest.feature);
  if (!att) {
    // T4d：goal 环境无基线既判不了「review 后漂移」也不得放行——上抛 fail-closed 信号；
    // 非 goal 交互模式保持现行为（no_drift 回退）。
    if (args.goalEnv) return { kind: 'no_drift', baselineUnavailable: true };
    return { kind: 'no_drift' };
  }
  const rec = reconcileSourceTreeAgainstAttestation(args.projectRoot, att);
  if (rec.ok) return { kind: 'no_drift' };
  // 当前 drift 内容 fingerprint 只用于恢复去重与诊断，不再作为人工授权钥匙。
  const drift = { added: rec.added, modified: rec.modified, deleted: rec.deleted };
  const fp = computeCurrentDriftFingerprint(args.projectRoot, drift);
  const decision = classifySourceDrift(
    drift,
    [],
    {
      runId: args.manifest.run_id,
      frozenManifestHash: args.frozenManifestHash,
      // legacy classifier context：phase 与 source_inventory_before 仍用于责任诊断，
      // 不再参与任何人签授权。
      phase: String(args.phase),
      expectedInventoryHash: att.inventory.aggregate_sha256 ?? null,
      projectRoot: args.projectRoot,
      // feature 仅用于绑定诊断范围；旧 confirmation receipt 已无授权语义。
      feature: args.manifest.feature,
      // 十三轮 P1-3：runner 进程持 key（子进程已剥离）——无 key 部署下 pre_run_manifest
      // 整链（manifest 文件+run_start 冻结事件）在 agent 可写面，不构成机器可信授权。
      // 5a 完成刀：签名维度已删——身份字段不再有 authenticated/unauthenticated 之分
      manifestIdentityAuthenticated: false,
      currentDriftFingerprint: fp?.fingerprint ?? null,
    },
  );
  return { ...decision, driftFingerprint: fp?.fingerprint ?? null, driftEntries: fp?.entries ?? null };
}

/**
 * plan c4e8a1f7 T3（评审 P1 修复）：closure 读图块的“能看图 × 能审计”两轴判定（纯函数）。
 * 只有 `hasVision=true ∧ tool_event_provenance==='structured_events'` 才要求本 invoke
 * 逐图 Read（可签 refs receipt 争取终签）；其余象限（无视觉 / none-provenance /
 * 盲+structured）一律归一为 'none'——走既有诚实 unverified 出口，不要求不可达终签。
 * 返回值直接喂 buildClosureVisualEvidenceBlock（helper 只认 structured/none 二态）。
 */
export function resolveClosureReadRequirement(
  hasVision: boolean | undefined,
  provenance: 'none' | 'structured_events' | 'session_transcript' | undefined,
): 'structured_events' | 'none' {
  return hasVision === true && provenance === 'structured_events' ? 'structured_events' : 'none';
}

/** 回退后 review 的增量重点复审块（seam 变更不豁免——注入重审焦点而非跳过）。 */
/**
 * runner-owned-machine-facts 追补（codex review）：spec closure-only 轮的只读取证指令。
 * 冻结的是产物，不是只读视觉取证——vl_multimodal 终签 invocation-bound，只认**本次
 * invoke** 的逐张验读回执；closure 轮不读图 → refs 回执 partial → 终签结构性拒收
 * （宿主实锤 run 20260815T070732Z-013297：i3 零读图，content_retry_exhausted 终局）。
 *
 * plan c4e8a1f7 T3（评审 P1 修复）：入参是 `resolveClosureReadRequirement` 归一后的
 * 二态值（'structured_events' | 'none'）——
 *  · 'structured_events'（hasVision ∧ 可审计）：本 invoke 逐图 Read 是**可达且被要求**的
 *    （本 invoke 的 Read 事件可签 refs receipt，争取 vl_multimodal 终签）；
 *  · 'none'（无视觉 / none-provenance / 盲+structured）：要求"每张 Read"是结构性不可达
 *    的——图片照常可读可用，但产物必须诚实写 `verified: unverified`，不得宣称
 *    vl_multimodal（软档 WARN 可继续、hard contract 由既有 gate FAIL）。
 * 不放宽 gate、不复用旧 invocation 回执。
 */
export function buildClosureVisualEvidenceBlock(
  refRelPaths: string[],
  requireRead: 'structured_events' | 'none' = 'structured_events',
): string {
  if (refRelPaths.length === 0) return '';
  const isStructured = requireRead === 'structured_events';
  return [
    '',
    isStructured
      ? '## Mandatory read-only visual evidencing for THIS invocation (spec closure — REQUIRED)'
      : '## Visual evidencing for THIS invocation (spec closure — honest unverified exit)',
    '',
    'FROZEN applies to artifacts, NOT to read-only evidencing. The vl_multimodal final sign-off is',
    'invocation-bound: it only accepts reference images actually read during THIS invocation.',
    ...(isStructured
      ? [
          'Before filling the receipt, read EVERY authoritative reference image below with your file-read',
          'tool. Reading them is required and allowed; modifying any artifact remains forbidden:',
        ]
      : [
          'This invocation does not have both working vision and structured per-image Read auditing',
          '(tool_event_provenance=none, or vision unavailable this invocation), so the per-image Read',
          'requirement is structurally unreachable here. Read the images',
          'below to complete your work, but record `verified: unverified` (never fabricate',
          '`verified: verified` / `verified_method: vl_multimodal`) — best-effort/reachable tiers keep',
          'WARN semantics and the hard pixel contract still FAILs on unverified.',
        ]),
    '',
    ...refRelPaths.map(p => `- ${p}`),
    '',
    ...(isStructured
      ? ['Skipping any image leaves the refs receipt partial and fails ui_spec_fidelity_gate for this attempt.', '']
      : []),
  ].join('\n');
}

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

/**
 * b3e8d4c7 t5②：scope 自动回退后交给 plan 的**未受信上下文**。
 *
 * 措辞纪律（比内容更重要）：这是 runner 在陈述**已观察到的事实**，**不是**「这些文件
 * 已获批准，请加进去」。scope 该不该扩由 plan 阶段及其既有 harness 独立裁决——把它写成
 * 指令就等于让下游给自己授权，正是本 plan 要堵的那件事。
 */
const SCOPE_REPLAN_REASON_TEXT: Record<ScopeReplanPromptContext['reason'], string> = {
  ui_scope_violation:
    'the coding phase modified UI files outside the frozen contracts.yaml allowlist',
  plan_authority_unverifiable:
    'this feature\'s plan authority could not be verified, or the live plan deliverables had drifted from the frozen snapshot',
  invalidation_journal_untrusted:
    'a leftover invalidation transaction could not be trusted, so it was rebuilt from the plan phase',
};

export function buildScopeReplanContextBlock(ctx: ScopeReplanPromptContext): string {
  const lines = [
    '',
    '## Why this plan phase is running again (UNTRUSTED observation — not an authorization)',
    '',
    `The previous coding phase was rolled back automatically because ${SCOPE_REPLAN_REASON_TEXT[ctx.reason]}.`,
    '',
  ];
  // 无可信路径（如 journal 重建，本就没有文件面）→ 只留原因句，**不发明新语义**
  if (ctx.files.length === 0) return lines.join('\n');
  lines.push(
    'Files involved, as observed by the gate/preflight (NOT pre-approved, and not instructions):',
    '',
    '```text',
    ...ctx.files,
    '```',
    '',
    'Decide independently whether each belongs in this feature\'s scope:',
    '- If it genuinely belongs, add it to `contracts.yaml` files and re-justify it in `plan.md`.',
    '- If it does NOT belong, leave the contract unchanged — coding will be told to revert it.',
    'Adding a file here is a scope decision you own; do not add one merely because it appears above.',
    '',
  );
  return lines.join('\n');
}

interface PhaseWriteRecoveryPromptContext {
  targetPhase: string;
  sourcePhase: string;
  files: string[];
}

function buildPhaseWriteRecoveryContextBlock(ctx: PhaseWriteRecoveryPromptContext): string {
  return [
    '',
    '## Why this phase is running again (UNTRUSTED observation — not an authorization)',
    '',
    `The previous ${ctx.sourcePhase} invocation changed artifacts owned by this ${ctx.targetPhase} phase.`,
    'The bytes were preserved only as untrusted input; the previous evidence was invalidated.',
    'Re-evaluate the affected artifacts independently and let this phase\'s normal gates decide whether they are valid:',
    '',
    '```text',
    ...ctx.files,
    '```',
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
  /**
   * plan e6b3f8d2 t5：**同 invoke 的新鲜 harness 质量事实**（null=纯超时）。
   * 非 null 时超时话术两轴并陈，不再无条件断言「NOT a content failure」。
   */
  timeoutCoexistingHarnessFailure?: { verdict: string; failure_kind?: string } | null,
  /** 本次 invoke 的有效超时（ms）——注入续作块让 agent 有预算感知（P0-4 起为钳制/升档后的值）。 */
  effectiveTimeoutMs?: number,
  /** 本 phase 此前 attempt 的累计消耗（plan P0-1.6"已耗时"，复审补）。 */
  phasePrior?: { attempts: number; elapsedMs: number },
  phaseWriteBoundary?: PhaseWriteBoundaryResolution,
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
    ...(phaseWriteBoundary
      ? ['', ...renderPhaseWriteBoundaryGuidance(phaseWriteBoundary, String(phase))]
      : []),
    '',
    `Read and follow the phase skill: ${PHASE_SKILL_REL[phase]}`,
    `Skill absolute path: ${skillAbs}`,
    // plan f4c8d2b7 t6：仅 ut 阶段注入两产物格式契约与 SSOT 解析后的模板真实路径——
    // headless agent 拿不到 profile-skill-asset 多跳指针后面的 OUTPUT CONTRACT（宿主
    // 实锤：精准踩中模板明文禁止的 Markdown 表格）。通用注入属 d8f4b7e2 范围，落地后本块退役。
    ...(phase === 'ut' ? ['', ...renderUtFormatContractLines(projectRoot)] : []),
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
    // plan e6b3f8d2 t5：两轴正交——transport（超时/断流）与 quality（harness 裁决）各说各的。
    // 同 invoke 已有新鲜 harness FAIL 时**必须并陈**：旧文案无条件断言「NOT a content
    // failure」，会让 agent 以为上轮只是被时钟打断，从而原样续作已被判不合格的产物。
    const timeoutWithQualityFact =
      interruptedCause === 'agent_timeout' && timeoutCoexistingHarnessFailure != null;
    const header =
      timeoutWithQualityFact
        ? '## Prior attempt TIMED OUT **and** its harness run recorded a content '
          + `${timeoutCoexistingHarnessFailure!.verdict} — two independent facts`
        : interruptedCause === 'agent_timeout'
        ? '## Prior attempt TIMED OUT — resume from partial work (NOT a content failure)'
        : interruptedCause === 'transient_api_error'
          ? '## Prior attempt hit an API CONNECTION DROP — resume from partial work (NOT a content failure)'
          : '## Prior attempt was INTERRUPTED (process crash / unknown) — resume from partial work';
    const intro =
      timeoutWithQualityFact
        ? 'Two orthogonal facts hold for the previous attempt, and BOTH are true:\n'
          + '1. **Transport**: it was cut off by the wall-clock timeout — partial work is on disk, so do NOT redo exploration/analysis from scratch.\n'
          + `2. **Quality**: the harness that ran for that same attempt recorded **${timeoutCoexistingHarnessFailure!.verdict}**`
          + `${timeoutCoexistingHarnessFailure!.failure_kind ? ` (failure_kind: ${timeoutCoexistingHarnessFailure!.failure_kind})` : ''}`
          + ' — the artifacts as they stand were judged NOT acceptable.\n'
          + '**Do not treat this as "just a timeout".** Resume from the partial work, but FIX the recorded blockers below before finishing — re-running the same artifacts unchanged will fail again.'
        : interruptedCause === 'agent_timeout'
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
    if (priorFailureKind === 'test_contract') {
      parts.push(
        '',
        '**This is a TEST-CONTRACT failure, not a product-code regression.**',
        'Do NOT revert or modify application source to satisfy it. Inspect the testing selector / ui-spec anchor contract, regenerate or correct test-side artifacts as allowed by the testing phase, then re-run the testing harness.',
      );
    } else if (priorFailureKind === 'code_regression') {
      parts.push(
        '',
        '**These failures may have been introduced by a prior attempt in this same goal run.** Before making new changes:',
        '1. Inspect the files changed relative to the goal-run start commit (trace.json.start_commit) and judge whether one of them is the actual root cause;',
        '2. If a change a prior attempt made for troubleshooting itself broke things (e.g. turned a valid config into an invalid schema, deleted the wrong file), **revert that change first** rather than stacking new code on a broken state;',
        // adjudicated-repair-loop M2（plan e2b7c4a9 t2.5，review 修复）：**仅 review 阶段**
        // 不得代改产物——旧文案「apply a minimal fix」被宿主实录为 review 走私改码的授权
        // 依据（review/headless-assumptions.jsonl）；coding 等其余 phase 的编译/UT 重试
        // 仍保留「确认真因后应用最小修复并重跑」的正常指导（不改就永远修不好）。
        ...(phase === 'review'
          ? [
              '3. Only after confirming the root cause via review evidence, register the finding as a repair candidate with verifier-confirmed evidence so the adjudicated repair route drives the fix—do NOT modify application source from the review phase.',
            ]
          : [
              '3. Only after confirming the root cause, apply a minimal fix and re-run this phase harness to verify.',
            ]),
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
      // T4：phase-aware——testing 期不得再叫 agent 改码（与 SKILL「不修改源码」统一）
      parts.push('', ...(phase === 'testing' ? VISUAL_GAP_RETRY_GUIDANCE_TESTING : VISUAL_GAP_RETRY_GUIDANCE));
    } else if (priorFailureKind === 'transient_api_error') {
      // P0-D.5：断流≠内容失败——指导续作而非"修 blocker"，堵住"把缺产物当自己错误去修复现场"。
      parts.push(
        '',
        '**The prior attempt was interrupted by a MODEL-API CONNECTION DROP (transient network failure) — NOT a content/quality failure and NOT a broken codebase.**',
        'The missing artifacts above simply were not finished when the stream dropped. Continue from the partial work on disk: do NOT redo exploration, do NOT revert files — finish the unfinished artifacts and re-run this phase harness.',
      );
    } else if (priorFailureKind === 'agent_timeout') {
      // plan e6b3f8d2 t5：同 invoke 有新鲜 harness FAIL 时两轴并陈；纯超时保持既有文案。
      parts.push(
        '',
        ...(timeoutCoexistingHarnessFailure
          ? [
              '**Two independent facts about the prior attempt — do not collapse them:**',
              '- **Transport**: it hit the phase wall-clock budget (agent_timeout); partial artifacts are on disk.',
              `- **Quality**: the harness for that same attempt recorded **${timeoutCoexistingHarnessFailure.verdict}**`
                + `${timeoutCoexistingHarnessFailure.failure_kind ? ` (failure_kind: ${timeoutCoexistingHarnessFailure.failure_kind})` : ''}`
                + ' — the BLOCKER evidence above is real content feedback, not timeout noise.',
              'Resume from the partial artifacts AND address that evidence; do NOT revert or redo completed parts.',
            ]
          : [
              '**The prior attempt hit the phase wall-clock budget (agent_timeout) — NOT a content failure.**',
              'Resume the unfinished work from the partial artifacts; do NOT revert or redo completed parts.',
            ]),
      );
    } else if (priorFailureKind === 'framework_integrity_block') {
      // 当前机器 integrity（如 process injection）正常路径是 halt；历史 framework subtype
      // 只作 provenance。普通运行不再根据 framework Git dirty/HEAD 产生本 kind。
      parts.push(
        '',
        '**The prior halt was an INTEGRITY block — re-run the phase from a clean current environment.**',
        'Do not modify framework or gate artifacts. If the current report identifies process injection, remove NODE_OPTIONS/.node-options/.npmrc preload injection before retrying.',
        'Retired framework Git/hash classifications are historical provenance only: do not commit, restore, or rewrite files to satisfy them.',
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
  projectRootAbs?: string,
): { runId: string; reason: string; runMode: 'authoritative' | 'dry' | 'unknown' } | null {
  const featureLockPath = path.join(featureRunsDirAbs, FEATURE_LOCK_NAME);
  const existing = readLockRecord(featureLockPath);
  if (!existing) return null; // clean
  if (!isLockStale(existing)) return null; // live runner → acquireGoalLocks will BLOCK
  const runId = existing.run_id;
  if (!runId) return null; // unidentifiable owner → fall through (steal stale lock)
  // plan e7c2a4d8 T1b''/v23 P1-①：orphan 按 lock 的 run_mode/report_dir 定位与分流。
  // 新 writer 恒写两字段；legacy 记录（宿主升级现场）默认 goal-runs/<run_id>，再以
  // events 会话判别三态（仅 dry / 有 authoritative / 无法判断——不猜）。
  if (existing.run_mode === 'dry') {
    // stale dry orphan：不提示 resume（dry 无 resume 语义），真实 run 按既有
    // stale-lock 流程直接接管（acquireGoalLocks 会偷 stale 锁）。
    return null;
  }
  const eventsAbs =
    existing.report_dir && projectRootAbs
      ? path.join(projectRootAbs, ...existing.report_dir.split('/'), 'events.jsonl')
      : path.join(featureRunsDirAbs, runId, 'events.jsonl');
  const creation = inspectGoalRunCreationFiles(
    path.join(path.dirname(eventsAbs), 'manifest.json'),
    eventsAbs,
  );
  if (creation.state === 'creation_incomplete' || creation.state === 'absent') {
    // 创建残留不是已启动占位者：不引导 resume，也不阻止同 feature 重新创建。
    return null;
  }
  const events = loadEventsJsonl(eventsAbs); // T1c：orphan 分类须读 raw（自行判别 dry 会话）
  if (existing.run_mode === undefined && creation.state !== 'complete') {
    // legacy 三态判别（v23 P1-①）：run_start 会话形态。
    const starts = events.filter((e) => e.type === 'run_start');
    if (starts.length === 0) {
      return { runId, reason: 'legacy lock 无法判别 run 形态（events 缺失/无 run_start）', runMode: 'unknown' };
    }
    if (starts.every((e) => (e as { dry_run?: unknown }).dry_run === true)) {
      return null; // 仅 dry session → 按 stale dry orphan 处置
    }
  }
  const end = resolveEffectiveRunEnd(events);
  if (
    end?.status === 'COMPLETED' || // legacy
    end?.status === 'CHAIN_SLICE_COMPLETED'
  ) {
    return null; // prior run finished; only a leftover lock
  }
  const reason = isPidAlive(existing.pid) ? 'lock 心跳超时（owner 未释放）' : 'owner 进程已退出';
  return { runId, reason, runMode: 'authoritative' };
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
  const orphan = resolveOrphanedIncompleteRun(featureRunsDirAbs, projectRoot);
  if (!orphan) return;
  if (orphan.runMode === 'unknown') {
    // v23 P1-①：无法判别形态——不猜、不给 resume 指引，人工处置。
    console.error(
      `[goal-runner] BLOCKER: feature "${feature}" 有形态无法判别的孤儿 lock（run "${orphan.runId}"，` +
        `${orphan.reason}）。请人工核查 goal-runs/${orphan.runId}/ 后处置；确认放弃加 --force。`,
    );
    process.exit(1);
  }
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
  run: {
    runId: string;
    reportDir: string;
    runMode: 'authoritative' | 'dry';
    explicitTakeover?: boolean;
    ownerKind?: RunOwnerKind;
    leaseMs?: number;
  },
): void {
  const { runId, reportDir, runMode } = run;
  const featureRunsDir = path.join(projectRoot, featuresDir, feature, 'goal-runs');
  const featureLockPath = path.join(featureRunsDir, FEATURE_LOCK_NAME);
  // plan e7c2a4d8 T1b''：per-run lock 从 canonical manifest.report_dir 派生
  //（dry 落 goal-runs/.dry/<run_id>/）；feature 串行锁继续共享（同 feature 串行）。
  const runLockPath = path.join(projectRoot, ...reportDir.split('/'), RUN_LOCK_NAME);

  const fRecord = tryAcquireLock(featureLockPath, {
    run_id: runId, run_mode: runMode, report_dir: reportDir,
  });
  if (!fRecord) {
    const existing = readLockRecord(featureLockPath);
    console.error(formatLockBlocker(featureLockPath, existing));
    process.exit(1);
  }

  const runDir = path.dirname(runLockPath);
  let existingControl = ensureRunControl(runDir, runId);
  existingControl = markExpiredSessionOrphaned(runDir, runId);
  const ownerKind = run.ownerKind ?? 'process';
  const leaseMs = Math.max(1, Math.trunc(run.leaseMs ?? 60_000));
  const ownerInput = {
    kind: ownerKind,
    owner_id: fRecord.ownerId,
    ...(ownerKind === 'session' ? { lease_ms: leaseMs } : {}),
  };
  const acquiredControl =
    run.explicitTakeover && existingControl.owner?.state === 'orphaned_session'
      ? { ok: true as const, ...forceTakeoverRunOwner(
          runDir, runId, existingControl.current_epoch, ownerInput,
        ) }
      : casAcquireRunOwner(runDir, runId, existingControl.current_epoch, ownerInput);
  if (!acquiredControl.ok) {
    releaseLock(featureLockPath, fRecord.ownerId);
    console.error('[goal-runner] BLOCKER: run-control owner busy or epoch changed');
    process.exit(1);
  }
  setLockEpoch(featureLockPath, fRecord.ownerId, acquiredControl.token.epoch);
  const rRecord = tryAcquireLock(runLockPath, {
    run_id: runId, run_mode: runMode, report_dir: reportDir, ownerId: fRecord.ownerId,
    epoch: acquiredControl.token.epoch,
  });
  if (!rRecord) {
    releaseRunOwner(runDir, acquiredControl.token);
    releaseLock(featureLockPath, fRecord.ownerId);
    const existing = readLockRecord(runLockPath);
    console.error(formatLockBlocker(runLockPath, existing));
    process.exit(1);
  }

  runControl = { dir: runDir, token: acquiredControl.token };
  const heartbeatMs = ownerKind === 'session'
    ? Math.max(250, Math.min(LOCK_HEARTBEAT_MS, Math.trunc(leaseMs / 3)))
    : LOCK_HEARTBEAT_MS;
  featureLock = {
    path: featureLockPath,
    ownerId: fRecord.ownerId,
    interval: setInterval(() => {
      touchLock(featureLockPath, fRecord.ownerId);
      try {
        if (ownerKind === 'session' && runControl) {
          renewSessionLease(runControl.dir, runControl.token, leaseMs);
        }
        progressHeartbeatHook?.();
      } catch (err) {
        console.warn(
          `[goal-runner] owner/progress heartbeat failed (non-fatal): ${(err as Error).message}`,
        );
      }
    }, heartbeatMs),
  };
  runLock = { path: runLockPath, ownerId: rRecord.ownerId };
  // plan a4f7e2b1 t1（codex 订正）：**取锁后立即写一次 beacon**，不等 60s 首次心跳。
  // 否则新 run 启动到首次心跳之间 beacon 为 absent，supervisor 按「无可信证据即 stale」
  // 会去 --resume 一个**还活着**的 run：虽被 owner lock 拦下，但 supervisor_restart
  // 已记账，白白吃掉一次重启预算。定时器此后只负责刷新。
  try {
    writeLivenessBeacon({ projectRoot, reportDir: run.reportDir, runId: run.runId });
  } catch { /* 非致命：写不成按 stale 处置，方向保守 */ }
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
      assertGoalBoundary('progress_write');
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
        // e9d4b7a3 t4：progress.json 与 runner 熔断同一折叠入口（supersede lineage）
        featuresDir,
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
      const events = loadAuthoritativeEvents(eventsPath);
      // e9d4b7a3 t4：heartbeat 与 runner 熔断/progress.json 同源——先沿 supersede 链折叠，
      // 再 resolveResumedBudget（旧实现 countAgentInvokeStarts(当前 run) → supersede 链
      // 下显示 5/30 假象，宿主看不到余量撞墙）。
      const lineage = foldBudgetLineage({
        projectRoot, featuresDir, feature: manifest.feature, currentEvents: events,
      });
      const budget = resolveResumedBudget(lineage.budgetFoldEvents, { nextSessionStartMs: Date.now() });
      // 二轮 review P1：elapsed_ms 用**活跃段累计**（nextSessionStartMs 钳制后
      // priorActiveMs 已含当前直播段至 now）——旧 Date.now()-wallClockStartMs 会把
      // halt/人工介入/隔夜停摆计入（runner/progress 用活跃口径，三方须真同源）。
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'heartbeat',
        phase: progressPhase,
        substep: progressSubstep,
        elapsed_ms: budget.priorActiveMs,
        turns_used: budget.totalTurns,
        lock_updated_at: lockRec?.updated_at ?? null,
        agent_output_mtime: agentOutputMtime,
        agent_output_bytes: agentOutputBytes,
      });
      // plan a4f7e2b1 t1：随心跳刷新 liveness beacon。**写侧唯一归属 run 自己**——
      // 探针只读不写。刷新失败不致命（beacon 缺失按 stale 处理，方向保守）。
      try {
        writeLivenessBeacon({
          projectRoot, reportDir: manifest.report_dir, runId: manifest.run_id,
        });
      } catch { /* 非致命：缺 beacon 会被判 stale，不会被误判存活 */ }
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

  // plan e7c2a4d8 T1b（codex 六轮 P1-③）：parent 与 main 共用 resolveRawRunInput——
  // feature 仅在 manifest 时不再提前拒绝；CLI↔manifest 冲突 fail-closed；dry 派生
  // 同一 .dry 路径，parent/child 身份不分裂。
  let raw: RawRunInput;
  try {
    raw = resolveRawRunInput(argv as unknown as Record<string, unknown>, projectRoot);
  } catch (e) {
    console.error(`[goal-runner] BLOCKER: ${(e as Error).message}`);
    return 1;
  }
  const feature = raw.feature;
  const isResume = raw.isResume;

  // Same orphan guard as the foreground path — refuse a stillborn new run_id when an
  // orphaned-but-incomplete run exists (so --detach doesn't print run_id then die).
  // dry-run 隔离命名空间，不受真实 run 孤儿阻挡。
  if (!isResume && !raw.dryRun) {
    guardOrphanedFeatureRun(projectRoot, featuresDir, feature, Boolean(argv.force));
  }

  const runId = raw.runId ?? newRunId();

  const reportDirRel = resolveGoalReportDir({ featuresDir, feature, runId, dryRun: raw.dryRun });
  const reportDirAbs = path.join(projectRoot, ...reportDirRel.split('/'));
  fs.mkdirSync(reportDirAbs, { recursive: true });
  const logPathAbs = path.join(reportDirAbs, 'detach.log');
  const logFd = fs.openSync(logPathAbs, 'a');

  const childArgs = buildDetachedChildArgv(process.argv.slice(2), runId, { resume: isResume });
  const preloadPath = resolveDetachedPreloadPath();
  const child = spawn(
    process.execPath,
    ['-r', preloadPath, __filename, ...childArgs],
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

/** Resolve in the framework process; the detached child may start from a dependency-free consumer cwd. */
export function resolveDetachedPreloadPath(): string {
  return require.resolve('ts-node/register/transpile-only');
}

export interface GoalPhaseRuntimeLaunchOptions {
  /** Explicit argv for embedded callers; CLI callers omit it. */
  args?: readonly string[];
  /** Explicit layout keeps host bridges and fixture runs independent from process.cwd(). */
  layout?: RepoLayout;
  /** Owner identity changes fencing/handoff posture only; lifecycle policy remains shared. */
  ownerKind?: RunOwnerKind;
  /** Optional transport injection. The runtime remains the sole lifecycle owner. */
  executor?: GoalPhaseExecutor;
  /** Existing attended authorization contract, enforced by the runtime at phase boundaries. */
  authorization?: AssessAuthorizationContext;
  /** Session owner lease duration; ignored for process owners. */
  leaseMs?: number;
  /** Maximum number of phase boundaries this invocation may start. */
  maxRounds?: number;
}

/**
 * The single production phase lifecycle. Both attended and detached callers enter main();
 * only the supplied executor transport and fenced owner kind differ.
 */
export class GoalPhaseRuntime {
  constructor(private readonly options: GoalPhaseRuntimeLaunchOptions = {}) {}

  run(): Promise<number> {
    return main(this.options);
  }

  async executeExecutor(
    context: PhaseExecutionContext,
    executor: GoalPhaseExecutor,
  ): Promise<GoalPhaseExecutorResult> {
    validatePhaseExecutionContext(context);
    if (context.owner.owner_id !== 'dry-run') {
      assertFencedOwner(context.runDir, context.owner, 'runtime_pre_executor');
    }
    const result = await executor.execute(context);
    if (context.owner.owner_id !== 'dry-run') {
      assertFencedOwner(context.runDir, context.owner, 'runtime_post_executor');
    }
    return result;
  }
}

/**
 * 主入口。**导出供 runner 级集成测试直接调用**（配合 __testing_set* 注入缝）——
 * 生产路径仍由文件尾的 require.main 分支驱动，行为不变。
 */
export async function main(options: GoalPhaseRuntimeLaunchOptions = {}): Promise<number> {
  // Programmatic host bridges may run more than one lifecycle in the same Node process.
  // Reset only ephemeral process-local projection; persisted truth remains manifest/events/control.
  terminalEventCtx = null;
  runConcluded = false;
  appendEventBaseFields = {};
  progressSubstep = null;
  progressPhase = null;
  progressHeartbeatHook = null;
  guardNestedGoalRunner();
  setupSignalHandlers();

  const argv = minimist([...(options.args ?? process.argv.slice(2))], {
    string: [
      'feature', 'requirement', 'adapter', 'adapter-source', 'start', 'end', 'resume', 'manifest',
      'run-id', 'supersede', 'rebaseline-to', 'attach-created',
      // Internal host-bridge inputs. They select transport/owner and explicit repo layout;
      // none of them grant policy authority or alter lifecycle adjudication.
      'runtime-executor', 'runtime-owner', 'project-root', 'framework-root',
      // plan f9c2e6b4 t4：多行/长需求的推荐入口（与 --requirement 互斥）。
      // fresh 读取内容并冻结进 manifest；resume 只认已冻结值，不重读源文件。
      'requirement-file',
      // plan a5f9c3e2 t3①：vision lineage 处置的**唯一输入入口**（continue|reset）。
      // 是 recovery intent 不是授权——旗标可被模型拼出，故不进 AuthorityFacts。
      // plan d7f3a9c4 t1：显式模型钉（仅 headless runner 链路；in-session attended
      // 由宿主会话自跑不适用）。
      'adapter-model',
      // plan ab072691 t1④：只读视觉 provider 的显式身份（**成对必填**）。
      // 与 --adapter-model 对仗但独立：那是 primary 执行身份，这是第二个「只看图」endpoint。
      'visual-adapter', 'visual-model',
    ],
    boolean: [
      'help', 'dry-run', 'force-resume', 'override-start', 'override-end', 'override-manifest',
      'override-adapter',
      'detach', 'detached-child', 'force', 'foreground-ok',
      'refresh-vision-probe',
    ],
    alias: { f: 'feature', h: 'help' },
  });

  const executorMode = String(argv['runtime-executor'] ?? (options.executor ? 'attended' : 'detached'));
  if (executorMode !== 'attended' && executorMode !== 'detached') {
    console.error(`[goal-phase-runtime] BLOCKER: runtime executor 非法：${executorMode}`);
    return 1;
  }
  const runtimeOwnerKindRaw = String(argv['runtime-owner'] ?? options.ownerKind ??
    (executorMode === 'attended' ? 'session' : 'process'));
  if (runtimeOwnerKindRaw !== 'session' && runtimeOwnerKindRaw !== 'process') {
    console.error(`[goal-phase-runtime] BLOCKER: runtime owner 非法：${runtimeOwnerKindRaw}`);
    return 1;
  }
  const runtimeOwnerKind = runtimeOwnerKindRaw as RunOwnerKind;
  if (runtimeOwnerKind === 'session' && executorMode !== 'attended') {
    console.error('[goal-phase-runtime] BLOCKER: session owner 只能使用 attended executor');
    return 1;
  }
  const attachCreatedRunId = typeof argv['attach-created'] === 'string'
    ? argv['attach-created'].trim()
    : '';
  if (attachCreatedRunId && (executorMode !== 'attended' || runtimeOwnerKind !== 'session')) {
    console.error('[goal-phase-runtime] BLOCKER: --attach-created 仅供 attended session 首次接管');
    return 1;
  }
  if (attachCreatedRunId && argv.resume) {
    console.error('[goal-phase-runtime] BLOCKER: --attach-created 与 --resume 互斥');
    return 1;
  }
  if (executorMode === 'attended' && !options.executor) {
    console.error(
      '[goal-phase-runtime] BLOCKER: attended runtime 必须由 host bridge 注入 executor；' +
        '协议读写只允许由 goal-mode-entry 承担。',
    );
    return 1;
  }
  const attendedExecutor = executorMode === 'attended' ? options.executor! : null;

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
    [--adapter-model <id>]   play the explicit model into headless argv (codex/claude/codeagent/cursor/opencode)
    [--visual-adapter <a> --visual-model <id>]
                 pin the read-only visual provider (second, look-only endpoint) for this run.
                 Both flags are required together. Supported adapters are derived from the
                 adapter catalog (agents/<a>/adapter.yaml visual_provider); an unsupported
                  adapter fails fast and lists the supported ones. Omit for blind/native.
    [--supersede <old-run-id> --rebaseline-to <exact-40hex-sha>]
                 outside goal runtime only: create an audited successor at the exact current HEAD.
    [--detach]   fork the run into the background, print {run_id,...} JSON, exit 0
                 (for hosts whose shell tool blocks / can't background a long task)
`);
    process.exit(0);
  }

  const manifestArgv = toManifestCliArgv(argv);
  const detectedLayout = options.layout ?? injectedLayout ?? detectRepoLayout(__dirname);
  const projectRoot = argv['project-root']
    ? path.resolve(String(argv['project-root']))
    : detectedLayout.projectRoot;
  const frameworkRoot = argv['framework-root']
    ? path.resolve(String(argv['framework-root']))
    : detectedLayout.frameworkRoot;
  const layout: RepoLayout = { ...detectedLayout, projectRoot, frameworkRoot };

  // f9c2e6b4 t4：**fresh 才读源文件**——resume 一律只认 manifest 里已冻结的 requirement，
  // 这样"权威需求文件可长期复用"与"旧内容绝不悄悄进新 run"同时成立。
  // 位置：projectRoot 定下之后（相对路径按它解析）、manifest 构建之前——
  // 下游看到的就是最终值，不存在第二个真值来源。
  // resume **显式拒绝** --requirement-file，避免静默忽略显式输入：
  // resume 只认已冻结的 requirement，悄悄忽略一个用户明确给了的输入是最坏的形态。
  if (argv.resume && typeof argv['requirement-file'] === 'string' && argv['requirement-file'].trim()) {
    console.error(
      '[goal-runner] BLOCKER: --requirement-file 仅在 fresh run 生效——resume 只认 manifest ' +
      '中已冻结的 requirement。若确要换需求，请开新 run。',
    );
    process.exit(2);
  }
  if (!argv.resume) {
    try {
      const resolvedRequirement = resolveRequirementInput({
        requirement: argv.requirement,
        requirementFile: argv['requirement-file'],
        projectRoot,
      });
      if (resolvedRequirement.text !== undefined) {
        argv.requirement = resolvedRequirement.text;
        manifestArgv.requirement = resolvedRequirement.text;
        // plan c4e8a1f7 T2：来源列表随 frozen requirement 一并进 manifest（身份哈希条件包含）
        if (resolvedRequirement.sources.length > 0) {
          manifestArgv.requirement_source_files = resolvedRequirement.sources;
        }
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(2);
    }
  }
  // e9d4b7a3 t1（三轮 review P1）：显式增量判定以 **CLI 输入事实**为准（字段值 ≠ 显式
  // 授权）——--manifest 自带的不同 requirement 文本不得被误判为修复增量。此处**直接
  // 保存解析后的显式 CLI 文本**（--requirement 或 --requirement-file 内容），唯一合并点
  // 只消费该文本，不再读任何 manifest 字段（inherit/override 后字段值不可信）。
  const explicitRequirementIncrementText =
    !argv.resume && typeof argv.requirement === 'string'
      ? argv.requirement.trim() || undefined
      : undefined;
  // codex 复核订正：manifest override 校验必须在 requirement 解析**之后**——否则
  // `--manifest + --requirement-file`（未带 --override-manifest）不会被前置拦截，
  // 文件内容被静默忽略。
  const manifestCliCheck = validateManifestCliOverrides(manifestArgv);
  if (!manifestCliCheck.ok) {
    console.error(manifestCliCheck.message);
    process.exit(1);
  }

  // plan d7f3a9c4 t1：--adapter-model CLI 值归一 + fail-fast 校验（trim/非空/≤128/无控制
  // 字符；不做模型名白名单）。raw boolean 裸旗标（minimist 置 true）也拒绝。
  let cliAdapterModel: string | undefined;
  try {
    cliAdapterModel = normalizeAdapterModelCliValue(argv['adapter-model']);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // plan ab072691 t1④：--visual-adapter/--visual-model 成对归一 + 资格 fail-fast。
  // 资格判据只查 adapter catalog 的 visual_provider 完整声明；显式输入不受支持时**必须**
  // 停在这里并列出支持项——静默忽略用户明确给出的输入是最坏的形态。
  let cliVisualProvider: ProviderRef | undefined;
  try {
    cliVisualProvider = normalizeVisualProviderCliPair(argv['visual-adapter'], argv['visual-model']);
    if (cliVisualProvider) assertVisualProviderCliSupported(frameworkRoot, cliVisualProvider);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const cfg = loadFrameworkConfig(projectRoot);
  const workflow = (injectedWorkflowResolver ?? resolveWorkflowSpec)(
    projectRoot,
    { config: cfg, frameworkRoot },
  );

  const featuresDir = cfg.paths.features_dir ?? 'doc/features';

  // plan e7c2a4d8 T1b：dry/resume 互斥与 CLI↔manifest 一致性单点校验（与 detach parent
  // 同源 resolveRawRunInput——feature 仅在 manifest 合法、冲突 fail-closed）。
  let rawRunInput: RawRunInput;
  try {
    rawRunInput = resolveRawRunInput(argv as unknown as Record<string, unknown>, projectRoot);
  } catch (e) {
    console.error(`[goal-runner] BLOCKER: ${(e as Error).message}`);
    process.exit(1);
  }
  const dryRunMode = rawRunInput.dryRun;

  let manifest: GoalManifest;
  if (attachCreatedRunId) {
    manifest = loadGoalManifestFromRun(projectRoot, attachCreatedRunId, {
      feature: String(argv.feature),
      featuresDir,
    });
  } else if (argv.resume) {
    if (!argv.manifest && !argv.feature) {
      console.error('[goal-runner] BLOCKER: --resume 须配 --feature 或 --manifest');
      process.exit(1);
    }
    if (argv.manifest) {
      // 实施 round2 P1：resume+manifest 第二道身份校验——runId 传入后 manifest.run_id
      // 与 --resume 冲突在 buildGoalManifestFromInput fail-closed（resolveRawRunInput
      // 已拦一道；此处防绕过单点解析的直接加载面）。
      manifest = loadGoalManifestFile(String(argv.manifest), projectRoot, {
        featuresDir, runId: String(argv.resume).trim(),
      });
    } else {
      manifest = loadGoalManifestFromRun(projectRoot, String(argv.resume), {
        feature: String(argv.feature),
        featuresDir,
      });
    }
  } else if (argv.manifest) {
    manifest = loadGoalManifestFile(String(argv.manifest), projectRoot, {
      featuresDir, dryRun: dryRunMode, runId: rawRunInput.runId,
    });
  } else {
    manifest = buildGoalManifestFromInput(
      {
        start_phase: argv.start ?? 'spec',
        end_phase: argv.end ?? 'testing',
        feature: argv.feature,
        requirement: argv.requirement,
        // plan c4e8a1f7 T2（评审 P0 修复）：fresh 构造必须携带解析出的来源列表——
        // 此前只写 manifestArgv 未传字面量，`--requirement-file` 来源在正式无人值守
        // 入口丢失（宿主回灌后同目录图片会再次发现不到）。supersede 路径同样依赖
        // 此值：inheritSuccessorManifest 在 override 之前去重追加源+显式来源。
        ...(manifestArgv.requirement_source_files && manifestArgv.requirement_source_files.length > 0
          ? { requirement_source_files: manifestArgv.requirement_source_files }
          : {}),
        adapter: argv.adapter ?? cfg.agent_adapter,
        // fresh CLI 的 --fidelity 送入 parser（非法枚举 fail-closed；只允许升档）。
        fidelity:
          typeof argv.fidelity === 'string' && argv.fidelity.trim() ? argv.fidelity.trim() : undefined,
        // Detached child reuses the run_id the launcher already printed to the host.
        run_id:
          typeof argv['run-id'] === 'string' && argv['run-id'].trim()
            ? String(argv['run-id']).trim()
            : undefined,
        unattended: {
          // plan a8e5c3f9 t6：新 manifest 直接写 effective 值——headless 即全权限
          //（non-interactive + no approval + full execution），不再默认 workspace-write。
          write_mode: 'full-access',
          approval_mode: 'never',
          max_turns: 20,
          // 不再硬编码扁平 timeout_seconds：开箱走 goal-timeout 的 per-phase 默认表
          // （spec 15m / plan·coding 90m / review·testing 120m / ut 60m），由 wall_clock 兜底。
          // 如需统一覆盖，显式设 unattended.timeout_seconds 或 phase_timeout_seconds。
        },
      },
      { projectRoot, featuresDir, dryRun: dryRunMode },
    );
  }

  // T3①：自动后继的唯一 manifest 写入点继承源 run 的预算与指纹账本。
  // 审计权仍来自后续 fresh run 的 supersede 事件；这里仅把启动约束和防震荡
  // 指纹带入新 manifest，不能单独让旧 run 的阶段 PASS 跨 run 生效。
  // e9d4b7a3 t1（二轮 review P1）：`supersedeSourceRequirement` 只在此块成功加载源后
  // 赋值——合并单点（applyManifestCliOverrides 之后）以此判断是否处于 supersede 上下文。
  // **增量文本只取 CLI 解析结果**（explicitRequirementIncrementText）——绝不读
  // manifest 字段（--manifest 自带文本没有增量授权，inherit 后字段值更不可信）。
  let supersedeSourceRequirement: string | undefined;
  // plan c4e8a1f7 T2（评审 P1 三轮修复）：源 run 的需求来源列表（successor 来源重设用）
  let supersedeSourceSourceFiles: string[] | undefined;
  const requestedSupersedeTargets =
    Array.isArray(argv.supersede)
      ? argv.supersede.filter((value): value is string => typeof value === 'string')
      : typeof argv.supersede === 'string'
        ? [argv.supersede]
        : [];
  // A resumed run that supersedes itself must fail before locks, run_start, progress,
  // or any other event-producing startup work. The later loop keeps the same check as
  // defence in depth, while the resumed source remains strictly read-only here.
  if (requestedSupersedeTargets.includes(manifest.run_id)) {
    console.error(
      `[goal-runner] BLOCKER: --supersede 不得指向当前 run（${manifest.run_id}）` +
        '——运行中不得删除自身场外状态',
    );
    return 1;
  }
  if (!argv.resume && !dryRunMode) {
    const sourceRunId = requestedSupersedeTargets[0];
    if (sourceRunId && isValidRunIdBasename(sourceRunId)) {
      try {
        const source = loadGoalManifestFromRun(projectRoot, sourceRunId, {
          feature: manifest.feature,
          featuresDir,
        });
        const sourceCreation = inspectGoalRunCreation(projectRoot, source);
        if (sourceCreation.state !== 'complete' && sourceCreation.state !== 'legacy') {
          throw new Error(
            `源 run 为 CREATION_INCOMPLETE（${sourceCreation.state === 'creation_incomplete' ? sourceCreation.reason : '出生记录缺失'}），` +
              '不构成可 supersede 的 HALTED/PARTIAL 占位者',
          );
        }
        const sourceBaseline = resolveGoalRunBaseline(projectRoot, manifest.feature, sourceRunId);
        if (sourceBaseline.available) source.run_base_sha = sourceBaseline.baseSha;
        else delete source.run_base_sha;
        // e9d4b7a3 t1（二轮 review P1）：捕获源 requirement 供合并单点使用
        //（merge 在 applyManifestCliOverrides 之后统一执行，见下方合并块）。
        supersedeSourceRequirement = source.requirement;
        // plan c4e8a1f7 T2（评审 P1 三轮修复）：同步捕获源 run 的来源列表——
        // successor + manifest override 时继承来源会被 override 整体替换，须在合并块
        // 以「源来源 ∪ 显式增量来源」重设（忽略 manifest 自带旧来源）。
        supersedeSourceSourceFiles = source.requirement_source_files;
        const sourceEvents = collectSupersededAncestorEvents({
          projectRoot,
          featuresDir,
          feature: manifest.feature,
          seedTargets: requestedSupersedeTargets,
        });
        const round: string[] = [];
        const drift: string[] = [];
        for (const event of sourceEvents) {
          const record = event as unknown as {
            round_fingerprint?: unknown;
            drift_fingerprint?: unknown;
          };
          if (typeof record.round_fingerprint === 'string') round.push(record.round_fingerprint);
          if (typeof record.drift_fingerprint === 'string') drift.push(record.drift_fingerprint);
        }
        manifest = inheritSuccessorManifest(manifest, source, { round, drift });
      } catch (error) {
        // 后继 manifest 是新 run 唯一写入点的启动合同；继承失败不能静默退回默认
        // manifest，否则 --supersede 会悄悄刷新 end/预算/能力门。目标审计事件仍由
        // 下方既有校验负责，但本次启动先 fail-closed，不制造合同不完整的后继。
        throw new Error(
          `[goal-runner] BLOCKER: 无法构造 supersede 后继 manifest（源=${sourceRunId}）：` +
            `${(error as Error).message}`,
        );
      }
    }
  }
  let rebaselineRequest: { sourceRunId: string; baseSha: string } | null = null;
  if (Object.prototype.hasOwnProperty.call(argv, 'rebaseline-to')) {
    try {
      rebaselineRequest = validateRebaselineRequest({
        supersedeTargets: requestedSupersedeTargets,
        rebaselineTo: argv['rebaseline-to'],
        resume: Boolean(argv.resume),
        dryRun: dryRunMode,
        hasGoalExecutionSignal: hasGoalExecutionSignal(),
        currentHead: resolveGoalRunHeadSha(projectRoot),
      });
      if (!rebaselineRequest || manifest.successor_of !== rebaselineRequest.sourceRunId) {
        throw new Error('--rebaseline-to 的 --supersede 源 run 无法解析为当前 successor');
      }
      manifest.run_base_sha = rebaselineRequest.baseSha;
    } catch (error) {
      throw new Error(`[goal-runner] BLOCKER: rebaseline 请求非法：${(error as Error).message}`);
    }
  }

  validateMinimumAssurance(
    frameworkRoot,
    manifest.minimum_assurance,
    new Set(workflow.artifacts.filter((item) => item.scope === 'feature').map((item) => item.id)),
  );
  // 十三轮 review P0-1 + plan f6b2d9a4 T3：fidelity transition 独立前置校验——
  // **fresh/manifest/resume 三路径全部执行**（此前被 if(argv.manifest) 圈住：宿主实证
  // fresh CLI 的 --fidelity 被静默丢弃，被迫强化措辞 workaround）。枚举合法且只升不降
  // 才返回 fidelity 授权；违规=BLOCKER。applied 判 string 过滤后的 manifestArgv（与
  // applyManifestCliOverrides 同一来源——裸旗标 --fidelity 没应用任何值，不进校验面）。
  let fidelityTransitionFields: ReadonlySet<string> = new Set<string>();
  // plan d7f3a9c4 t2（codex P1）：adapter 变化判定须基于 **所有改写前** 的原始 adapter。
  // applyManifestCliOverrides（下方）可经 --adapter+--override-manifest 改写 manifest.adapter，
  // reconcile 又会读 local——若此刻才捕获，local 已被别窗切走时会把"换 adapter"误判为未变。
  // 故在 applyManifestCliOverrides 之前捕获 manifest 既有 adapter。
  const manifestAdapterBeforeCliOverrides = manifest.adapter;
  const manifestAdapterProvenanceBeforeCliOverrides = manifest.adapter_provenance;
  {
    applyManifestCliOverrides(manifest, manifestArgv);
    const ft = evaluateFidelityTransitionAuthorization({
      projectRoot,
      manifest,
      featuresDirRel: featuresDir,
      applied: {
        fidelity: Boolean(manifestArgv.fidelity),
        fidelityReceipt: false,
      },
    });
    if (ft.blockers.length > 0) {
      console.error(`[goal-runner] BLOCKER: fidelity transition 校验失败：\n- ${ft.blockers.join('\n- ')}`);
      process.exit(1);
    }
    fidelityTransitionFields = ft.authorizedFields;
  }

  // e9d4b7a3 t1（二轮 review P1，三轮订正）：successor 显式 requirement 增量**唯一合并点**
  // ——增量文本只认 CLI 解析结果（explicitRequirementIncrementText），与
  // --manifest/override/inherit 的字段状态完全解耦：显式文本为空或与源逐字相同 →
  // 逐字继承（无标记）；否则合并源正文 + 显式文本一次。三轮 review 阻断案例
  // （源=A、manifest 自带=B、显式文件内容=A）：显式文本=A == 源 → 不合并，B 不被
  // 冒充增量。
  if (supersedeSourceRequirement !== undefined && explicitRequirementIncrementText) {
    const sourceRequirement = (supersedeSourceRequirement ?? '').trim();
    const inc = explicitRequirementIncrementText;
    if (inc !== sourceRequirement && !isSuccessorRepairRequirement(inc)) {
      manifest.requirement = mergeSuccessorRequirement(supersedeSourceRequirement, inc);
      console.log(
        `[goal-runner] supersede 显式 requirement 增量已与源 requirement 合并（successor 任务真源=manifest.requirement）。`,
      );
    }
    // plan c4e8a1f7 T2（评审 P1 三轮修复）：successor 的来源语义 = **源 run 来源 + 显式
    // 增量来源**，忽略 manifest 自带旧来源（它属于被覆盖的旧需求文档——applyManifestCliOverrides
    // 在 `--override-manifest` 时已把 manifest 来源替换为显式增量来源，若不加处理源来源会丢）。
    // inline 增量无新来源（explicitFiles 空）时同样重设，保留源 run 来源（inheritSuccessorManifest
    // 的并集结果被 override 清空后必须在此恢复）。
    const sourceFiles = supersedeSourceSourceFiles ?? [];
    const explicitFiles = manifestArgv.requirement_source_files ?? [];
    const mergedSourceFiles = [...new Set([...sourceFiles, ...explicitFiles])];
    if (mergedSourceFiles.length > 0) {
      manifest.requirement_source_files = mergedSourceFiles;
    } else {
      delete manifest.requirement_source_files;
    }
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
    manifest.adapter_provenance = resolvePersistedAdapterProvenance({
      isResume: Boolean(argv.resume),
      originalAdapter: manifestAdapterBeforeCliOverrides,
      originalProvenance: manifestAdapterProvenanceBeforeCliOverrides,
      effectiveAdapter: adapterDecision.effectiveAdapter,
      decisionProvenance: adapterDecision.provenance,
    });
    if (adapterDecision.writeLocal) pendingAdapterWriteback = adapterDecision.effectiveAdapter;
  }

  // plan d7f3a9c4 t2：final pin **单点裁决**——接线位置在 adapter reconcile 之后、
  // manifest 身份哈希计算之前。只在此处产生 final adapter_model_pin；不散落修改。
  {
    const finalPin = resolveFinalModelPin({
      cliValue: cliAdapterModel,
      effectiveAdapter: manifest.adapter!,
      originalAdapter: manifestAdapterBeforeCliOverrides,
      manifestPin: manifest.adapter_model_pin,
      isResume: Boolean(argv.resume),
      hasManifestFlag: Boolean(argv.manifest),
      isSuccessor: Boolean(manifest.successor_of),
      overrideManifest: Boolean(argv['override-manifest']),
      overrideAdapter: Boolean(argv['override-adapter']),
    });
    if (!finalPin.ok) {
      console.error(finalPin.message);
      process.exit(1);
    }
    if (finalPin.pin) {
      manifest.adapter_model_pin = finalPin.pin;
    } else {
      // 无 pin：不落键（与旧 manifest 兼容 + 身份字段集条件纳入同源约束）。
      delete manifest.adapter_model_pin;
    }
  }

  // plan ab072691 t1④⑤：visual provider final pin **单点裁决**，同一位置、同一纪律。
  // 优先级：显式 CLI > manifest 冻结值 > 个人级 local（仅 fresh 兜底）。
  // **resume 一律不重读 local**——冻结值就是冻结值，停机期间改个人配置不得悄悄换掉本 run
  // 的视觉 endpoint（与 requirement/model pin 的既有纪律同源）。
  {
    const finalVisualPin = resolveFinalVisualProviderPin({
      cliRef: cliVisualProvider,
      manifestPin: manifest.visual_provider_pin,
      isResume: Boolean(argv.resume),
      hasManifestFlag: Boolean(argv.manifest),
      isSuccessor: Boolean(manifest.successor_of),
      overrideManifest: Boolean(argv['override-manifest']),
    });
    if (!finalVisualPin.ok) {
      console.error(finalVisualPin.message);
      process.exit(1);
    }
    let pin = finalVisualPin.pin;
    // 无显式输入也无冻结值时，fresh run 才回落个人级配置。goal-runner 是**无人值守**入口：
    // 不询问；旧 local 命中 unsupported 只 WARN + 忽略。视觉能力不足是否阻断由后续
    // fidelity preflight 依据 requirement strictness 与 capability facts 统一裁决。
    if (!pin && !argv.resume) {
      let local: ReturnType<typeof loadFrameworkLocalConfig> = null;
      try {
        local = loadFrameworkLocalConfig(projectRoot);
      } catch (error) {
        console.warn(
          `[visual-provider] WARN: 读取个人级视觉 provider 配置失败，按无 provider 处理：` +
            `${(error as Error).message}。严格视觉需求将由 capability preflight 诚实 defer。`,
        );
      }
      const fromLocal = resolveUnattendedVisualProviderPin(local, frameworkRoot);
      if (fromLocal.warning) console.warn(fromLocal.warning);
      pin = fromLocal.pin;
    }
    if (pin) {
      manifest.visual_provider_pin = pin;
    } else {
      delete manifest.visual_provider_pin;
    }
  }

  const dryRun = dryRunMode;
  if (dryRun) setAppendEventBaseFields({ dry_run: true }); // T1b：dry 事件全量打标
  const forceResume = Boolean(argv['force-resume']);
  const goalTrack = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, manifest.feature));
  if (Object.keys(process.env).some(key => key.toUpperCase() === 'HARNESS_DIFF_BASE_REF')) {
    console.warn(
      '[goal-runner] 已忽略并从 goal 子进程环境剥离 HARNESS_DIFF_BASE_REF；' +
        'goal run 只认 manifest.run_base_sha。',
    );
  }

  let attachedCreation: ReturnType<typeof assertGoalRunAttachable> | null = null;
  if (argv.resume || attachCreatedRunId) {
    try {
      attachedCreation = assertGoalRunAttachable(projectRoot, manifest);
    } catch (error) {
      console.error(`[goal-runner] BLOCKER: ${(error as Error).message}`);
      process.exit(1);
    }
  }
  const requestedChain = attachedCreation?.state === 'complete'
    ? [...attachedCreation.event.phase_chain]
    : resolveAutoChain(
        workflow,
        manifest.start_phase,
        manifest.end_phase,
        manifest.chain_override,
        goalTrack,
      );
  const fullWorkflowChain = featurePhasesFromWorkflow(workflow, goalTrack);
  // Receipt-derived legacy fidelity recovery changes which phases must actually execute. Resolve
  // that fact before a fresh modern run is born, then freeze the expanded chain in manifest and
  // run_created. Later resume/attach paths may validate this birth fact, but never recompute it.
  const freshLegacyFidelity = !argv.resume && !attachCreatedRunId
    ? loadInertLegacyFidelityIntentSsot(projectRoot, manifest.feature)
    : null;
  const actualBirthChain = resolveActualGoalPhaseChainAtBirth({
    requestedChain,
    fullWorkflowChain,
    requiresLegacyFidelityRecovery: freshLegacyFidelity !== null,
  });
  let freshCreation: GoalRunCreationResult | null = null;

  // Survival guard (code-level enforcement of the launch contract): block a real unattended
  // run started in the foreground without --detach — it would be reaped when the host
  // session/turn ends (the 2026-06 incident). --foreground-ok downgrades it to a warning.
  const survivalPosture = evaluateForegroundSurvival({
    detachedChild: Boolean(argv['detached-child']),
    dryRun,
    foregroundOk: Boolean(argv['foreground-ok']),
    // plan a8e5c3f9 t6：effective 恒 never——所有 headless run 均属无人值守，存活门一律适用。
    approvalMode: effectiveHeadlessUnattended(manifest.unattended).approval_mode,
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
  // dry-run 隔离命名空间不受真实 run 孤儿阻挡（T1b）。
  if (!argv.resume && !attachCreatedRunId && !dryRun) {
    guardOrphanedFeatureRun(projectRoot, featuresDir, manifest.feature, Boolean(argv.force));
  }

  acquireGoalLocks(projectRoot, featuresDir, manifest.feature, {
    runId: manifest.run_id,
    reportDir: manifest.report_dir,
    runMode: dryRun ? 'dry' : 'authoritative',
    explicitTakeover: Boolean(argv.resume || attachCreatedRunId) && forceResume,
    ownerKind: runtimeOwnerKind,
    ...(runtimeOwnerKind === 'session' && options.leaseMs !== undefined
      ? { leaseMs: options.leaseMs }
      : {}),
  });
  // d6 t5⓪：**投影注入点之一**——带 halt_reason 的事件在写盘那一层自动补
  // run_disposition/run_wait_kind（device-readiness-gate 的 emitEvent 也接在这里，
  // 故本处一并覆盖 delegated producer）。已显式携带投影的事件原样放行。
  const goalEvents = createGoalReconcileBoundary((event) =>
    appendEvent(
      manifest.report_dir,
      projectRoot,
      withRunDisposition(event as Record<string, unknown>) as typeof event,
    ),
  );

  // b7e4d2a9 Todo2：保护性 try 前移到紧跟 acquireGoalLocks——sealed guard 与 manifest
  // drift 检测都在持锁 try 内执行；此前两者位于 lock 与 try 之间的裸区，提前
  // return/throw 会漏锁（finally 的 releaseAllLocks 只盖 try 内；process.on('exit')
  // 仅为后备）。不加新锁机制。
  try {
  if (!argv.resume && !attachCreatedRunId) {
    freshCreation = createGoalRun({
      projectRoot,
      manifest,
      chain: actualBirthChain,
      ...(rebaselineRequest ? { rebaselineFromRunId: rebaselineRequest.sourceRunId } : {}),
    });
  }
  if (runControl) {
    const recordHandoffMailboxQuarantine = (notice: HandoffMailboxQuarantine): void => {
      goalEvents.emit({
        type: 'handoff_mailbox_quarantined',
        original_file: notice.original_file,
        quarantined_file: notice.quarantined_file,
        reason: notice.reason,
      });
    };
    const handoffRequestBeforeAccept = readHandoffRequest(runControl.dir, {
      on_quarantined: recordHandoffMailboxQuarantine,
    });
    const acceptedHandoff = acceptConsumedHandoff(runControl.dir, runControl.token, runtimeOwnerKind);
    if (acceptedHandoff) {
      goalEvents.emit({
        type: 'handoff_accepted',
        request_id: acceptedHandoff.request_id,
        from_epoch: acceptedHandoff.from_epoch,
        epoch: runControl.token.epoch,
        owner_kind: runtimeOwnerKind,
      });
    }
    if (handoffRequestBeforeAccept?.status === 'consumed') {
      const acceptanceValid = acceptedHandoff?.target_owner_kind === runtimeOwnerKind &&
        acceptedHandoff.accepted_epoch === runControl.token.epoch &&
        acceptedHandoff.from_epoch + 1 === runControl.token.epoch;
      if (!acceptanceValid) {
        quiesceRunOwner(runControl.dir, runControl.token);
        runConcluded = true;
        console.error(
          `[goal-runner] handoff mailbox 已消费但当前 ${runtimeOwnerKind} owner ` +
            '未完成目标/epoch/accepted 校验；保持静默等待',
        );
        return 0;
      }
    }
  }

  // b7e4d2a9 Todo2：**成功封卷（sealed）拒绝一切启动面**——任何解析到已封卷 run 的启动
  // （--resume 与 --manifest 都盖）一律拒绝；`--force`/`--force-resume` 不可绕过。
  // SSOT=最新 authoritative run_end 事件（不信可变 goal-report.status——report 被改成
  // PARTIAL 不得重开封卷；诚实边界：events 亦在仓内非密码学防篡改，取 append-only 惯例
  // 的相对强可信）。检查先于一切 manifest/config 写入、canary/preflight——封卷 run 绝不
  // 先走 drift/缺失确认流程再报 sealed。拒绝**只输出错误，不追加任何事件**（封卷后
  // 归档不再被修改）。COMPLETED 仅 legacy 读取兼容（新代码不得写出）。
  // 收口刀：本次装载同时供下方 manifest 出生基线解析（同一份 events，一次读取）。
  const startupEventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  // run_created precedes the first execution session, so the execution-session filter correctly
  // excludes it. Reattach that unique birth record to the authoritative execution view for
  // identity drift/replay while preserving legacy mixed-dry session filtering.
  const startupEvents = [
    ...loadEventsJsonl(startupEventsPath).filter((event) => event.type === 'run_created'),
    ...loadAuthoritativeEvents(startupEventsPath).filter((event) => event.type !== 'run_created'),
  ];
  {
    const sealedRunEnd = findLastRunEnd(startupEvents);
    if (sealedRunEnd?.status === 'CHAIN_SLICE_COMPLETED' || sealedRunEnd?.status === 'COMPLETED') {
      console.error(
        `[goal-runner] BLOCKER: run ${manifest.run_id} 已成功封卷（sealed，${sealedRunEnd.status}）——` +
        '同 run 不可再启动（--resume/--manifest/--force/--force-resume 均无效），其归档与场外状态不再变更。' +
        '如需继续请新开 run（--feature ... --start <phase>）。',
      );
      return 1;
    }
  }

  // 3.0.0 宿主回放修复：旧实现会在“adapter 值未变、仅用 --override-adapter 对账
  // local”时把出生 provenance 改为 override，污染被 phase evidence 收录的 manifest
  // 全文件 hash。仅当还原 provenance 后逐字命中首个 run_start.manifest_hash 才修复；
  // 任何其它字段漂移均不猜、不放行。真正落盘仍复用下方 writeGoalManifest 单点。
  if (argv.resume && manifestAdapterBeforeCliOverrides === manifest.adapter) {
    const provenanceRepair = restoreFrozenAdapterProvenance(
      manifest,
      resolveFrozenManifestHash(startupEvents, null),
    );
    if (provenanceRepair.repaired) {
      manifest = provenanceRepair.manifest;
      console.warn(
        `[goal-runner] 已恢复同 adapter resume 污染的 manifest.adapter_provenance：` +
          `override → ${provenanceRepair.to ?? '<absent>'}（完整 manifest hash 已命中 run_start 冻结值）。`,
      );
    }
  }

  // manifest 身份漂移检测——**锁内（防并发 TOCTOU/事件污染）+ 任何副作用
  // （回写 local/writeGoalManifest/canary/preflight）之前**执行。
  // T2 5a 收口刀（codex P1-1）：可信出生基线改由 **events** 承载（首个 run_start 逐字段
  // 身份 → 历次授权 rebase 事件前进基线，见 resolveManifestIdentityBaseline）——此前用
  // 场外 checkpoint 当基线，codex 实测"checkpoint 在场→halt / 删除→放行"：缓存的存在与否
  // 改变权限结果，且删缓存即可绕过出生意图。决策核心=resolveManifestDriftDecision
  // （纯函数，真路径可测）；未授权漂移 halt（drift 事件在锁内写，不污染他 run）。
  // plan e7c2a4d8 T1b'（v22 P0-1）沿承：dry-run 零 trust 读写、不与真实 run 事件基线
  // 纠缠——以 null 基线走「无基线」分支。
  const manifestDrift = resolveManifestDriftDecision({
    currentFields: computeManifestIdentityFields(manifest),
    currentHash: computeManifestIdentityHash(manifest),
    birthFields: dryRun ? null : resolveManifestIdentityBaseline(startupEvents),
    overrides: {
      'override-manifest': Boolean(argv['override-manifest']),
      'override-start': Boolean(argv['override-start']),
      'override-end': Boolean(argv['override-end']),
    },
    fidelityTransitionFields,
  });
  if (manifestDrift.halt) {
    goalEvents.emit({
      type: 'manifest_identity_drift',
      changed_fields: manifestDrift.halt.changedFields,
      authorized: manifestDrift.halt.authorized,
      ...(manifestDrift.halt.classification
        ? { classification: manifestDrift.halt.classification }
        : {}),
    });
    throw new Error(manifestDrift.halt.message);
  }
  // 【已删除 · 收口刀】legacy checkpoint 聚合迁移分支与 `vision_checkpoint_schema_migrated`
  // 事件——checkpoint 退出基线角色后无 schema 迁移语义。

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
    // Legacy receipt-derived fidelity bytes remain compatibility-readable but have no authority.
    // A downstream start cannot safely treat them as an ordinary missing/non-UI SSOT: doing so
    // would let the preflight recompute only in memory while the harness falls back to spec.md.
    // Reuse the existing backtrack transaction instead, so spec (the sole writer) rebuilds the
    // on-disk SSOT and every downstream consumer reads the same decision.
    let pendingLegacyFidelityBacktrack: {
      legacy_source?: string;
      requested_at?: string;
      completion_observed: boolean;
    } | null = null;
    for (const event of startupEvents) {
      const item = event as {
        type?: string;
        reason?: string;
        to_phase?: string;
        legacy_source?: string;
        ts?: string;
      };
      if (
        item.type === 'phase_backtrack_requested' &&
        item.reason === 'legacy_fidelity_ssot' &&
        item.to_phase === 'spec'
      ) {
        pendingLegacyFidelityBacktrack = {
          ...(item.legacy_source ? { legacy_source: item.legacy_source } : {}),
          ...(item.ts ? { requested_at: item.ts } : {}),
          completion_observed: false,
        };
      } else if (
        pendingLegacyFidelityBacktrack &&
        item.type === 'phase_backtrack_completed' &&
        item.to_phase === 'spec'
      ) {
        pendingLegacyFidelityBacktrack.completion_observed = true;
      }
    }
    if (
      pendingLegacyFidelityBacktrack?.completion_observed &&
      hasTrustedPhaseClosureAfterRequest({
        projectRoot,
        feature: manifest.feature,
        phase: 'spec',
        requestTs: pendingLegacyFidelityBacktrack.requested_at,
        requirement: manifest.requirement ?? '',
        featuresDir,
      })
    ) {
      pendingLegacyFidelityBacktrack = null;
    }
    // A fresh run must use the exact legacy-fidelity observation that participated in birth.
    // Re-reading after run_created would allow an external mutation to alter the live phase set.
    const inertLegacyFidelity = freshCreation
      ? freshLegacyFidelity
      : loadInertLegacyFidelityIntentSsot(projectRoot, manifest.feature);
    const recoveryRequestedStart = manifest.start_phase as FeaturePhase;
    const requestedStartIdx = fullWorkflowChain.indexOf(recoveryRequestedStart);
    const specIdx = fullWorkflowChain.indexOf('spec' as FeaturePhase);
    const legacyFidelityRecovery =
      recoveryRequestedStart !== ('spec' as FeaturePhase) &&
      specIdx >= 0 &&
      requestedStartIdx > specIdx &&
      (inertLegacyFidelity !== null || pendingLegacyFidelityBacktrack !== null)
        ? {
            requestedStart: String(recoveryRequestedStart),
            legacySource:
              inertLegacyFidelity?.decision.source ??
              pendingLegacyFidelityBacktrack?.legacy_source ??
              'legacy_receipt',
            requestAlreadyRecorded: pendingLegacyFidelityBacktrack !== null,
          }
        : null;
    const frozenChain = manifest.phase_chain ? [...manifest.phase_chain] : [...requestedChain];
    const modernBirth = freshCreation !== null || attachedCreation?.state === 'complete';
    if (legacyFidelityRecovery && modernBirth) {
      const requiredPrefix = fullWorkflowChain.slice(specIdx, requestedStartIdx);
      const frozenRecoveryPrefix = [
        ...requiredPrefix,
        recoveryRequestedStart,
      ];
      const prefixMatches = frozenRecoveryPrefix.every(
        (phase, index) => frozenChain[index] === phase,
      );
      if (!prefixMatches) {
        const detail =
          `modern run ${manifest.run_id} 的冻结 phase_chain 未包含出生时应有的 legacy fidelity ` +
          `恢复前缀（expected=${frozenRecoveryPrefix.join('→')}，` +
          `frozen=${frozenChain.join('→')}）。禁止在 resume/attach 时扩展出生事实；` +
          '请废弃该损坏 run，并从相同起点创建 successor run。';
        goalEvents.emit({
          type: 'phase_halt',
          phase: legacyFidelityRecovery.requestedStart,
          halt_reason: 'framework_integrity_block',
          reason: 'phase_chain_birth_mismatch',
          halt_guidance: detail,
        });
        console.error(`[goal-runner] BLOCKER: ${detail}`);
        return 1;
      }
    }
    const chain = modernBirth
      ? frozenChain
      : legacyFidelityRecovery
        ? [
            ...fullWorkflowChain.slice(specIdx, requestedStartIdx),
            ...frozenChain,
          ]
        : frozenChain;
    // plan c4e8a1f7 T1a：preflight 返回 session 级 resolved binary——probe/canary/
    // 正式 phase invoke 三个消费点复用同一绝对路径，从结构上保证 probe/invoke 同身份。
    const sessionBinary = runGoalPreflight({
      projectRoot,
      frameworkRoot,
      manifest,
      provenance,
      dryRun,
      chain,
      resolvedProfile,
      executorMode,
    });

    // goal-fakepass-hardening t8：截断链 preflight——start_phase 非链首时机器核验上游
    // closure（血缘重算 + review attestation），manifest.requirement 的文本断言不作数
    // （bc-openCard 事故：run2 以"上游已 PASS"文本断言直接从 ut 起跑）。
    if (!dryRun && !argv.resume && chain[0] !== fullWorkflowChain[0]) {
      const upstream = fullWorkflowChain.slice(0, fullWorkflowChain.indexOf(chain[0])).map(String);
      // P0-2（八轮）+九轮 P0：比对**当前 run** 的 requirement 与上游 closure 记录的——
      // 换需求起截断链时上游 closure 判 stale。plan e7c2a4d8 T1a：改用内存
      // manifest.requirement 的内容级口径（writeGoalManifest 在本 preflight 之后才落盘，
      // 读盘口径对新起截断链是鸡生蛋必死——be1c48 事故实锤）；requirement 缺失/空白
      // 仍 BLOCKER（goal run 无需求属不变量违例，不静默放行）。
      const requirementText = (manifest.requirement ?? '').trim();
      if (!requirementText) {
        console.error(
          '[goal-runner] BLOCKER: 截断链核验无法计算当前 run 的 requirement 血缘哈希' +
            '（manifest.requirement 缺失/空白）——fail-closed，拒绝启动。',
        );
        process.exit(1);
      }
      const currentReqSha = computeRequirementShaFromText(
        projectRoot, manifest.feature, manifest.requirement ?? '', featuresDir,
      );
      // T1d（v22 P1）：曾启动却缺 manifest 的 corrupt run 在场 → 截断链上游血缘不可信，
      // fail-closed（不得静默把权威改选到其他 run）。
      const corruptAtPreflight = listAuthoritativeGoalRuns(projectRoot, manifest.feature, featuresDir).corruptRuns;
      if (corruptAtPreflight.length > 0) {
        console.error(
          '[goal-runner] BLOCKER: 截断链核验发现损坏的 goal-run（曾启动但 manifest 缺失）：\n' +
            corruptAtPreflight.map((c) => `  - ${c.runId}: ${c.reason}`).join('\n') +
            '\n人工核查（恢复 manifest 或确认废弃该目录）后重试。',
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
      dryRun: dryRun || executorMode === 'attended',
      forceRefresh: Boolean(argv['refresh-vision-probe']),
    });
    // plan d7f3a9c4 t4：金丝雀 CLI 硬失败（spawn race / CLI·config 参数不兼容）**只有**在
    // 真实 action==='probe' 路径上记录并升 run 级 BLOCKER；终态发射在 manifest 落盘后
    //（见 writeGoalManifest 之后的 canary_cli_hard_failure 块），保证 run 有可监控终态。
    let canaryHardCliFailure: string | null = null;
    if (visionProbeDecision.action === 'probe') {
      const probeResult = await runVisionCanaryProbe({
        projectRoot, frameworkRoot, manifest,
        // plan c4e8a1f7 T1a：canary 复用 session binary（与正式 invoke 同一绝对路径）
        resolvedBinary: sessionBinary?.binary ?? null,
        ...(injectedCanaryProbeInvoke ? { invokeFn: injectedCanaryProbeInvoke } : {}),
      });
      if (probeResult.outcome === 'hard_cli_failure') {
        canaryHardCliFailure = probeResult.error ?? '视觉金丝雀探测遇 CLI/adapter 兼容性问题';
      } else if (probeResult.ran && probeResult.outcome === 'valid_cached') {
        console.log(`[goal-runner] 视觉能力金丝雀实测完成：verdict=${probeResult.verdict}（已缓存至 framework.local.json）`);
      } else if (probeResult.ran) {
        // plan c7d2e9a4 t3（stale-if-error）：探测无效/调用失败**未写盘**——日志须与消费面
        // 实际行为一致（resolveBaseImageInput 只认盘）：盘上仍有当前版本 fresh 缓存（强刷
        // 失败场景）→ 沿用 last-known-good；否则回退 adapter 声明路径,下次 run 自动重探。
        let lkg: { probed_at: string; verdict: string } | null = null;
        try {
          const canary = loadFrameworkLocalConfig(projectRoot)?.vision?.canary;
          // plan d7f3a9c4 t3：旁路规则 `fresh && (!modelPin || canaryAdmissibleForExecution)`——
          // 旧模型/跨 run 缓存在本 run 其实不可消费（image_input/OCR/tool_read/门禁都不采信），
          // LKG 日志必须与消费面口径一致，否则谎报"沿用旧缓存"。
          if (isFreshCanaryForExecution(canary, manifest.adapter ?? 'generic', {
            runId: manifest.run_id,
            ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
          })) {
            lkg = { probed_at: canary!.probed_at, verdict: canary!.verdict };
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
    // plan e7c2a4d8 T1b'（v23 P1-②）：dry-run 禁止 framework.local.json 写回——
    // --override-adapter --dry-run 组合不产生持久化副作用（config 只读）。
    if (pendingAdapterWriteback && !dryRun) {
      recordAdapterToLocal(projectRoot, pendingAdapterWriteback);
      console.error(
        `[goal-runner] 按 --override-adapter 切到 adapter=${pendingAdapterWriteback}，` +
          '已回写 framework.local.json（个人级本地配置）。',
      );
    }
    if (argv.resume) writeGoalManifest(manifest, projectRoot);

    // plan d7f3a9c4 t4：金丝雀 CLI 硬失败 BLOCKER——复用既有启动期 HALT 模式（与下方
    // declared_product_layer_missing 同款），**不在 probe 块内 process.exit**：
    // 先写 manifest（run 可监控、可表达 --resume），再落 phase_halt（含 halt_guidance）+
    // run_end{HALTED}，标记 runConcluded 后 return 1。fresh 由此有结构化终态；resume
    // 不会保留旧 disposition。
    if (canaryHardCliFailure) {
      const guidance =
        `视觉金丝雀探测遇 CLI/adapter 兼容性问题（非需求代码）：${canaryHardCliFailure}\n` +
        '这是 CLI/config 参数不兼容或 spawn race——请核对 adapter 版本/配置/环境后重跑' +
        '（--refresh-vision-probe 触发重探）；不是需求或产品代码问题，不进入正式 phase。';
      goalEvents.emit({
        type: 'phase_halt',
        phase: chain[0],
        halt_reason: 'canary_cli_hard_failure',
        verdict: 'FAIL',
        reason: canaryHardCliFailure,
        halt_guidance: guidance,
      });
      goalEvents.emit({ type: 'run_end', status: 'HALTED', halt_reason: 'canary_cli_hard_failure' });
      runConcluded = true;
      console.error(`\n===== canary_cli_hard_failure =====\n${guidance}\n`);
      return 1;
    }

    const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');

    // openspec device-readiness-and-completion t5：outer_layers 声明与文件系统对账**前移**。
    //
    // 事故（07-28）：framework.config.json 声明的 03-CommonBusiness 目录不存在，但该校验
    // 只在 testing 的 pre-invoke 跑，于是跑满 2.7 小时、烧完 spec/plan/coding/ut 才 HALT。
    //
    // 时点：run/manifest 已建（有可监控 run、能表达 --resume）→ **整个 run 的第一个 phase
    // agent invocation 之前**。不是"testing 自己的 invoke 前"——那等于没前移。
    // 条件：仅当链路含 testing（或确需 product snapshot）。无条件早检会让 spec-only /
    // plan-only / ut-only 任务因一个**永不访问**的目录失败。
    // 判据复用 computeProductSourceSnapshotDetail，与 testing pre-invoke 处**同源**，
    // 避免早晚两套规则漂移；后者保留作纵深防御（防运行期目录被删）。
    if (!dryRun && chain.includes('testing' as FeaturePhase)) {
      const declaredLayers = productLayerDirsOf(projectRoot);
      const earlySnap = computeProductSourceSnapshotDetail(projectRoot, declaredLayers, manifest.feature);
      if (!isUsableSnapshot(earlySnap.sha256)) {
        goalEvents.emit({
          type: 'phase_halt',
          phase: chain[0],
          halt_reason: 'declared_product_layer_missing',
          verdict: 'FAIL',
          reason: earlySnap.failureReason ?? earlySnap.sha256,
          declared_layers: declaredLayers,
        });
        goalEvents.emit({
          type: 'run_end', status: 'HALTED', halt_reason: 'declared_product_layer_missing',
        });
        runConcluded = true;
        console.error(
          '\n===== declared_product_layer_missing =====\n' +
            `${earlySnap.failureReason ?? earlySnap.sha256}\n` +
            `framework.config.json 的 architecture.outer_layers 声明：${declaredLayers.join('、') || '(空)'}\n` +
            '本链路含 testing，须对产品源码层做快照保护——声明的目录必须真实存在。\n' +
            '处置：修正配置声明或补建目录后重跑（--resume 会重检）。\n',
        );
        return 1;
      }
    }

    // t4/t5（plan a7c3f9e2）：编译形态启动前置检查——**第一个 phase agent invocation
    // 之前**（含 --resume）解析一次 product selection。链路含需 product 的 phase
    // （coding/ut/testing 任一非 skip capability）且结果为 unresolved（**构建形态无法
    // 确定**：多候选未确认 / build-profile 缺失 / products 为空 / build-profile 不可解析）
    // → 复用既有 phase_halt 通道停止
    // （halt_reason=product_selection_unresolved，不新造停止机制、不烧任何预算）；
    // 确认（record-product-selection / init.product_selection / env）后 --resume 重检。
    // 前置原因：错误 product 恰好编译成功时会直接签发 PASS——必须在选定阶段就要求可信来源，
    // 不允许跑到 coding 阶段中途才停。单候选与已确认工程零摩擦。
    if (!dryRun && chainRequiresProduct(chain as string[], resolvedProfile)) {
      const profileHarnessDir = path.join(resolvedProfile.profileDir, 'harness');
      const probe = resolveProductSelectionViaProfile(
        projectRoot,
        profileHarnessDir,
        goalProductPurpose(chain as string[]),
      );
      if (!probe.ok) {
        if (probe.reason === 'missing') {
          // profile 无 product-selection 模块（generic 等无构建语义）→ 结构上不适用，跳过
        } else {
          // 解析器执行失败：**不得静默跳过**（review P1——否则门禁可被绕过）；
          // 能逃到这里的只能是 profile 模块加载/运行时异常 = framework fault
          //（build-profile 缺失/空/不可解析已被解析器收敛为判别结果）。
          const guidance =
            `编译形态解析器执行失败（profile=${resolvedProfile.name}）：${probe.message ?? '(无详情)'}\n` +
            '这是框架侧缺陷（profile product-selection 模块异常），不是内容失败，也不是外部环境问题；' +
            '请更新/修复 framework 后重跑（--resume 会重检）。';
          goalEvents.emit({
            type: 'phase_halt',
            phase: chain[0],
            halt_reason: 'product_selection_probe_failed',
            verdict: 'FAIL',
            reason: probe.message ?? 'product selection 解析失败',
          });
          goalEvents.emit({
            type: 'run_end', status: 'HALTED', halt_reason: 'product_selection_probe_failed',
          });
          runConcluded = true;
          console.error(`\n===== product_selection_probe_failed =====\n${guidance}\n`);
          return 1;
        }
      } else if (probe.selection.source === 'unresolved') {
        const candidates = probe.selection.candidates.join(', ');
        const guidance =
          probe.selection.candidates.length > 0
            ? `编译形态无法确定：工程声明了多个 product（${candidates}），` +
              '且 toolchain.preferredProduct 未经本机确认（framework.local.json 无匹配确认记录）。'
            : '编译形态无法确定：build-profile.json5 未声明任何真实 product（缺失/为空/不可解析）。';
        const confirmLines =
          'framework 不替宿主猜测编译形态——请先确认一次（任选其一）：\n' +
          `  1. 机器写入：npx ts-node framework/harness/scripts/record-product-selection.ts --project-root ${projectRoot} --product <候选值>；\n` +
          '  2. 交互式：framework-init 的 registry `init.product_selection`；\n' +
          '  3. testing 无人值守：HARNESS_DEVICE_TEST_PRODUCT=<候选值>（仅 testing 起点链路生效，env 属显式确认）。\n' +
          (probe.selection.candidates.length > 0
            ? `本次可用候选：${candidates}。`
            : '请先修复构建配置（build-profile.json5 声明 app.products）或使用显式来源指定 product。') +
          '\n确认后 --resume 继续（会重新检查）。';
        goalEvents.emit({
          type: 'phase_halt',
          phase: chain[0],
          halt_reason: 'product_selection_unresolved',
          verdict: 'FAIL',
          reason: `编译形态无法确定（候选：${candidates || '(无)'}）`,
          candidates: probe.selection.candidates,
        });
        goalEvents.emit({
          type: 'run_end', status: 'HALTED', halt_reason: 'product_selection_unresolved',
        });
        runConcluded = true;
        console.error(`\n===== product_selection_unresolved =====\n${guidance}\n${confirmLines}\n`);
        return 1;
      }
    }

    // R10：**启动期对账回收**——上一个 run 若被硬杀（SIGKILL/断电），它的清理代码没机会
    // 执行，托管模拟器会成为孤儿。此处依 device-session.json 对账：四元组吻合才回收，
    // 用户自开实例与 PID 重用一律拒绝（reclaimManagedDevice 内判）。`--resume` 同样经过。
    if (!dryRun) {
      // S10：扫 **feature 下所有 run 目录**——上一个被硬杀的 run 的 session 躺在它自己的
      // 目录里，只看当前 report_dir 永远发现不了，于是每次崩溃留一个孤儿模拟器。
      const goalRunsRel = path.dirname(manifest.report_dir);
      for (const { session: stale, reportDirRel } of collectForeignManagedSessions(
        projectRoot,
        goalRunsRel,
        manifest.run_id,
      )) {
        const out = reclaimManagedDevice(stale, defaultProcessProbe());
        if (out.action === 'reclaimed') {
          console.log(
            `[device] 启动对账：回收了 run ${stale.started_by_run} 遗留的托管模拟器（pid=${out.pid}）`,
          );
          goalEvents.emit({
            type: 'managed_device_reclaimed',
            scope: 'startup_reconcile',
            prior_run_id: stale.started_by_run,
            pid: out.pid,
          });
          // 标记已释放，避免下次启动重复尝试
          try {
            writeDeviceSession(projectRoot, reportDirRel, {
              serial: null, target_kind: 'unknown', started_by_run: null, status: 'released',
            });
          } catch { /* best-effort */ }
        } else if (out.action === 'refused') {
          console.warn(`[device] 启动对账未回收（run ${stale.started_by_run}）：${out.reason}`);
        }
      }
    }

    // v23 F1：缺陷交接上下文——回退后注入下一次 coding prompt；进程重启从 events 恢复
    let backtrackCodingContext: ActionableDefect[] = [];
    // 责任阶段统一路由（plan b6e4c9f2）：repair candidates 整组交接（mixed-owner 不丢）；
    // prompt 注入按当前 phase 类别过滤——链重走到各责任阶段只注入属于它的候选。
    let backtrackRepairCandidates: RepairCandidate[] = [];
    // v23 F1：整轮集合指纹熔断——启动时从本 run 有效 events 初始化（进程重启后同集合
    // 不得再回退），随后内存实时更新
    const seenRoundFingerprints = new Set<string>();
    // plan a5f9c3e2 t3②：未受信漂移的保守恢复防震荡——同一 drift 内容指纹重现即判
    // terminal（回退→agent 又加同一处接缝→再回退，纯烧预算）。与 seenRoundFingerprints
    // 同款手法（含**从 events 回放**，见下方恢复循环），键空间不同（drift 内容 vs 整轮
    // 缺陷集合）故分立集合，共用回退预算。**必须跨 resume 记忆**：否则重启即失忆，
    // 同一漂移会再吃一次回退预算，违反「同 fingerprint 重现即 terminal」。
    const seenDriftFingerprints = new Set<string>();
    // 注：t5 的 scope 自动回退**刻意不设第三个指纹集**——收敛只由 DEFAULT_MAX_BACKTRACKS
    // 负责。上面两个集合针对「完全相同的不可修复结果再现」（terminal 语义）；scope 不足
    // 是正常演进，加指纹反而会在 plan 第一次没扩对时堵掉第二次重新裁决的机会。
    // b3e8d4c7 t5②：scope 自动回退的**未受信上下文**——回退后注入下一次 plan prompt。
    // 这是闭环最后一段电线：没有它，plan 回去了也不知道为何重跑、哪些文件要重新裁决，
    // 于是原样再跑一遍 → 再撞同一 scope → 烧完预算停机（与 v23 F1 缺陷交接同款教训）。
    // **只是"发现事实"，不构成任何授权**——是否纳入 scope 仍由 plan 及其既有 harness 裁决。
    //
    // **它是 LLM 输入面，所以只能装净化过的数据**（codex 三轮 P1）：字段刻意只剩
    // {reason(闭集), files(经校验路径)}，**没有自由文本**。散文说明只进事件与控制台。
    // 两条来源都过 resolveScopeReplanContext——events 无 MAC/agent 可写自不必说，
    // 同进程的 affectedFiles 也来自 watched_roots 目录清点（文件名由 agent 定），
    // 都不是可直接拼进提示词的可信输入。仅贴 "UNTRUSTED" 标签不是安全边界。
    let scopeReplanContext: ScopeReplanPromptContext | null = null;
    // 通用 phase 写边界回退的最小交接面：只把净化过的路径作为未受信观察交给 owner，
    // 不把下游写入变成授权，也不复制一套新的持久状态。
    let phaseWriteRecoveryContext: PhaseWriteRecoveryPromptContext | null = null;
    let priorEvents = loadAuthoritativeEvents(eventsPath);

    // t1（plan c6a9e4d2）：resume 决策面 events 必须**缺失/损坏即 fail-closed**——
    // 不静默跳过坏行、不回退 report、不猜测起点。authoritative events 是 resume 起点/
    // 预算/terminal guard 的唯一真源；损坏时继续 = 用截断历史做恢复决策。
    if (argv.resume) {
      const strictEvents = loadEventsJsonlStrict(eventsPath);
      if (strictEvents.missing) {
        console.error(
          `[goal-runner] BLOCKER: --resume 需要 events 真源，但文件缺失：${eventsPath}\n`
          + '  处置：不猜测起点——核对 run 目录完整性后手动处置（events 被删的 run 无法安全续跑）。',
        );
        return 1;
      }
      if (strictEvents.corruptLines.length > 0) {
        const corrupt = strictEvents.corruptLines
          .map((c) => `  - 第 ${c.line} 行：${c.snippet}`)
          .slice(0, 5)
          .join('\n');
        console.error(
          `[goal-runner] BLOCKER: events.jsonl 存在损坏行（共 ${strictEvents.corruptLines.length} 条），`
          + '其为 resume 决策真源，不得忽略：\n'
          + `${corrupt}\n`
          + `  文件：${eventsPath}\n`
          + '  处置：人工核查损坏原因与行内容后处置；绝不基于残缺 events 续跑。',
        );
        return 1;
      }
      // P1-8（review）：空文件/全空白/无有效 authoritative run_start 同样是“无真源”——
      // resume 从空历史猜起点=用猜测做恢复决策，fail-closed。
      if (strictEvents.events.length === 0) {
        console.error(
          `[goal-runner] BLOCKER: --resume 需要 events 真源，但文件为空（0 行）：${eventsPath}\n`
          + '  处置：不猜测起点——人工核查 run 目录完整性（events 被清空的 run 无法安全续跑）。',
        );
        return 1;
      }
      const authoritativeResumeEvents = strictEvents.events.filter((e) =>
        (e as { dry_run?: unknown }).dry_run !== true);
      if (!authoritativeResumeEvents.some((e) => (e as { type?: string }).type === 'run_start')) {
        console.error(
          `[goal-runner] BLOCKER: --resume 需要 events 含有效 authoritative run_start，`
          + `但该文件没有（raw=${strictEvents.events.length} 行，authoritative=${authoritativeResumeEvents.length} 行）：${eventsPath}\n`
          + '  处置：resume 起点无源可依——人工核查 run 目录（非本 run 的 events / 文件被整体替换/清空）。',
        );
        return 1;
      }
    }

    let previousUnverifiedRound: { phase: string; fingerprint: string } | null = null;
    for (const event of priorEvents) {
      const item = event as {
        type?: string;
        phase?: string;
        round_fingerprint?: string;
        action?: string;
      };
      if (
        item.type === 'unverifiable_must_fix' &&
        typeof item.phase === 'string' &&
        typeof item.round_fingerprint === 'string' &&
        item.round_fingerprint
      ) {
        previousUnverifiedRound = { phase: item.phase, fingerprint: item.round_fingerprint };
      } else if (
        item.type === 'phase_backtrack_requested' ||
        (item.type === 'phase_verdict' && item.action !== 'retry') ||
        item.type === 'run_end'
      ) {
        previousUnverifiedRound = null;
      }
    }
    // v23 F2：testing_write_violation 是 run 终止态——同 run resume 一律拒绝（否则 resume
    // 的新前快照会把上次遗留修改当合法基线，违规被洗白）。人工整理现场后必须新开 run。
    if (argv.resume && priorEvents.some(e =>
      (e as { type?: string }).type === 'testing_write_violation')) {
      // 判据是 violation **事件本身**而非 halt reason——ledger tamper 与 violation 并发时
      // halt reason 归 tamper，但 violation 事件仍在，终止态保护不得因此失效。
      goalEvents.emit({
        type: 'resume_rejected', reason: 'testing_write_violation_terminal',
      });
      console.error(
        '[goal-runner] BLOCKER: 本 run 曾检出 testing_write_violation（testing 越权写入'
        + '产品源码/需求 SSOT）——该状态为 run 终止态，不允许 resume。\n'
        + '  原因：resume 会把上次遗留的修改当成合法基线，违规即被洗白。\n'
        + '  处置：人工核查 events.jsonl 中 testing_write_violation 列出的文件、整理现场后**新开 run**。',
      );
      return 1;
    }
    for (const fingerprint of manifest.inherited_round_fingerprints ?? []) {
      if (typeof fingerprint === 'string' && fingerprint) seenRoundFingerprints.add(fingerprint);
    }
    for (const fingerprint of manifest.inherited_drift_fingerprints ?? []) {
      if (typeof fingerprint === 'string' && fingerprint) seenDriftFingerprints.add(fingerprint);
    }
    // v23 F1：整轮集合指纹从有效 events 恢复（直接读 round_fingerprint 字段，不从有界
    // defects[] 反算）；缺陷交接上下文取最近一条回退事件的 defects[]（一次遍历取两者）
    for (const e of priorEvents) {
      const ev = e as {
        type?: string; round_fingerprint?: string; drift_fingerprint?: string;
        to_phase?: string; reason?: string;
        files?: unknown;
        defects?: ActionableDefect[];
        candidates?: RepairCandidate[];
      };
      if (ev.type !== 'phase_backtrack_requested') continue;
      if (typeof ev.round_fingerprint === 'string' && ev.round_fingerprint) {
        seenRoundFingerprints.add(ev.round_fingerprint);
      }
      // t5②：plan 的未受信上下文跨 resume 恢复。**无条件覆盖**（对齐下方
      // backtrackCodingContext 的 review 第 10 轮教训）：后来的非 plan 回退意味着这份
      // 上下文已过期，留着会把早已裁决过的旧越界清单再喂给 plan。
      scopeReplanContext = ev.to_phase === 'plan'
        ? resolveScopeReplanContext({ projectRoot, reason: ev.reason, files: ev.files })
        : null;
      // plan a5f9c3e2 t3②：未受信漂移指纹同样回放——跨 resume 记住「这个漂移已回退过」，
      // 否则重启即失忆，同一漂移会再吃一次回退预算（违反「同 fingerprint 重现即 terminal」）。
      if (typeof ev.drift_fingerprint === 'string' && ev.drift_fingerprint) {
        seenDriftFingerprints.add(ev.drift_fingerprint);
      }
      // 无条件覆盖（review 第 10 轮）：授权回退事件不带 defects[]——只在非空时覆盖会让
      // 后续授权回退仍携带早已修好的旧缺陷。每条回退事件都重置 context 为其 defects ?? []。
      backtrackCodingContext = Array.isArray(ev.defects) ? ev.defects : [];
    }
    // 责任阶段统一路由（codex 冻结项④）：候选交接上下文跨 resume 恢复走**共享实现**
    // （测试调同一函数验证恢复与清空语义，不用源码正则）。
    // review 收口：**不再对恢复候选做 attempted 预过滤**——validation-only 分支（settled
    // 恢复）不调用 agent、无需候选；需要重新 invoke 的窗口（request-only 崩溃 / 超时 /
    // FAIL verdict）必须保留原候选上下文（否则 agent 重跑看不到修复任务）。eligible 过滤
    // 由 backtrack 决策点按 events 回放统一执行，此处过滤既重复又会误伤。
    backtrackRepairCandidates = restoreBacktrackCandidatesFromEvents(
      priorEvents as ReadonlyArray<{ type?: string; candidates?: unknown }>,
    );

    if (argv.resume) {
      const halfRecovery = detectHalfCompletedPhaseRecovery(
        priorEvents,
        projectRoot,
        manifest.feature,
      );
      if (halfRecovery) {
        for (const ev of buildHalfPhaseRecoveryEvents(halfRecovery)) {
          goalEvents.emit(ev);
        }
        priorEvents = loadAuthoritativeEvents(eventsPath);
      }

      // t1（plan c6a9e4d2）：terminal resume guard 的 priorStatus 只从**有效 events
      // 投影**取（run_end 事件），不再回退到 goal-report.json——report 纯展示投影，
      // 只 run_end 落盘，崩溃现场其状态陈旧（review/ut 已 advance 仍显示 halt）。
      const lastRunEnd = findLastRunEnd(priorEvents);
      const guard = checkTerminalResumeGuard({
        priorStatus: lastRunEnd?.status,
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
    terminalEventCtx = {
      reportDir: manifest.report_dir, projectRoot,
      runId: manifest.run_id, feature: manifest.feature,
      chain: [...chain], workflowChain: fullWorkflowChain.map(String),
    };

    // visual-capability-truth S4：run_start 冻结 manifest hash——pre_run_manifest 授权源
    // 只认此快照（运行中补写 manifest 不构成授权）；resume 沿用首个 run_start 的冻结值。
    // 十/十一轮 review：manifest 身份哈希漂移检测已提前到副作用前（见上方 manifestDrift 块），
    // 此处仅落 run_start 事件（携带逐字段身份 + rebase 记录）。
    const manifestFileAbs = path.join(projectRoot, manifest.report_dir, 'manifest.json');
    const frozenManifestHash = resolveFrozenManifestHash(priorEvents, sha256FileHex(manifestFileAbs));
    if (manifestDrift.rebaseApplied) {
      // 基线承载事件（收口刀）：resolveManifestIdentityBaseline 消费本事件把出生基线
      // 前进到 to_fields——授权 rebase 过一次后，后续 resume 不再复报同一漂移
      // e9d4b7a3 t5：同时写入 changed_fields（diff 而非完整哈希表）——budget-only
      // rebase 的确定性刷新判定在 resume 起点读取本事件字段。
      goalEvents.emit({
        type: 'manifest_identity_rebase',
        to_fields: manifestDrift.currentFields,
        authorized_by: manifestDrift.rebaseAuthorizedBy,
        ...(manifestDrift.changedFields.length > 0
          ? { changed_fields: manifestDrift.changedFields }
          : {}),
      });
    }
    goalEvents.emit({
      type: 'run_start',
      dry_run: dryRun,
      chain,
      manifest_hash: frozenManifestHash,
    });
    flushProgress(true);

    // openspec device-readiness-and-completion t2：最后一次 testing 经设备就绪门取得的目标类型。
    // **null = 本 run 的 testing 未经设备门**（profile 未声明 device_capabilities / dry-run），
    // 与 'unknown'（经过了门但判不出机型）**语义不同**：前者不参与封顶（该链路本就与设备无关），
    // 后者按模拟器同等封顶。混淆二者会把所有非设备链路误降为 PARTIAL。
    let lastTestingTargetKind: DeviceTargetKind | null = null;
    /** R10：托管模拟器的信号清理反注册句柄（正常回收后摘除，防重复回收） */
    let releaseManagedDeviceCleanup: (() => void) | null = null;
    // 视觉账本控制面已退役；当前执行仅使用 invocation-bound capability/reference receipts。
    // goal-fakepass-hardening t8：--supersede <run_id>（可重复）——显式废弃 HALTED/PARTIAL
    // 旧 run，写审计事件；completion verify 只认经审计的 supersede（自报 Set 不生效）。
    const supersededRunIds: string[] = ([] as string[])
      .concat(argv.supersede ?? [])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    for (const target of supersededRunIds) {
      // b7e4d2a9 Todo2：supersede 现在连带删除目标场外状态——新增两道前置：
      // ① target 来自原始 CLI 串，先过 runId 严格 basename 契约（禁 /\ 与 . ..）；
      // ② target ≠ 当前 run（运行中删自己的 checkpoint/pass snapshot 是新删除能力
      //   带来的新风险）——否则 BLOCKER。
      // codex 第九批 P1：三条 BLOCKER 统一走优雅收口（run_start 已落，直接 return/
      // process.exit 会留下无 run_end 的僵尸 RUNNING 投影）；process.exit 一并替换为
      // try 内 return（finally 释放锁，进程内调用可测——本区既有注释的约定）。
      if (!isValidRunIdBasename(target)) {
        const msg = `--supersede 目标 runId 非法（须为合法 basename）：${JSON.stringify(target)}`;
        console.error(`[goal-runner] BLOCKER: ${msg}`);
        concludeStartupBlocker('supersede_target_invalid', msg);
        return 1;
      }
      if (target === manifest.run_id) {
        const msg = `--supersede 不得指向当前 run（${target}）——运行中不得删除自身场外状态`;
        console.error(`[goal-runner] BLOCKER: ${msg}`);
        concludeStartupBlocker('supersede_target_invalid', msg);
        return 1;
      }
      const targetRunDir = path.join(projectRoot, featuresDir, manifest.feature, 'goal-runs', target);
      const targetEvents = path.join(targetRunDir, 'events.jsonl');
      if (!fs.existsSync(targetEvents)) {
        const msg = `--supersede 目标 run 不存在：${target}`;
        console.error(`[goal-runner] BLOCKER: ${msg}`);
        concludeStartupBlocker('supersede_target_invalid', msg);
        return 1;
      }
      // 目标 manifest 身份验证：仓内 manifest.run_id 必须精确等于 target——身份验证
      // 失败只拒删场外状态（审计事件照落：supersede 语义本身不依赖场外状态在场）。
      let targetIdentityOk = false;
      try {
        const tm = JSON.parse(fs.readFileSync(path.join(targetRunDir, 'manifest.json'), 'utf-8')) as { run_id?: string };
        targetIdentityOk = tm.run_id === target;
      } catch { targetIdentityOk = false; }
      // 审计事件**成功追加之后**才 best-effort 删除目标场外状态；appendEvent 抛错则
      // 循环中断、绝不删除（不建新事务/删除账本）。
      goalEvents.emit(buildSupersedeAuditEvent({
        targetRunId: target,
        supersedingRunId: manifest.run_id,
        ...(rebaselineRequest?.sourceRunId === target
          ? { rebaselineTo: rebaselineRequest.baseSha, creation: freshCreation }
          : {}),
      }));
      emitMilestone(`GOAL_RUN event=supersede target=${target} run_id=${manifest.run_id}`);
      if (!dryRun) {
        if (!targetIdentityOk) {
          console.warn(`[trust-gc] supersede 目标 ${target} 的 manifest 身份验证失败——场外状态保留不删（仅诊断）`);
        } else {
          const gc = deleteRunTrustState({ projectRoot, feature: manifest.feature, runId: target });
          if (gc.diagnostics.length > 0) console.warn(`[trust-gc] supersede ${target}：${gc.diagnostics.join('；')}`);
          if (gc.deleted.length > 0) console.log(`[trust-gc] supersede ${target}：已回收（${gc.deleted.join('、')}）`);
        }
      }
    }

    if (!dryRun && legacyFidelityRecovery && !legacyFidelityRecovery.requestAlreadyRecorded) {
      const recoveryBudget = foldBudgetLineage({
        projectRoot,
        featuresDir,
        feature: manifest.feature,
        seedTargets: supersededRunIds,
        currentEvents: priorEvents,
      }).budgetFoldEvents.filter(
        event => (event as { type?: string }).type === 'phase_backtrack_requested',
      ).length;
      if (recoveryBudget >= DEFAULT_MAX_BACKTRACKS) {
        const detail =
          `检测到 receipt 派生的 legacy fidelity SSOT，但现有回退预算已耗尽 ` +
          `(${recoveryBudget}/${DEFAULT_MAX_BACKTRACKS})；不得从 ${legacyFidelityRecovery.requestedStart} ` +
          '继续并回落到旧 spec.md 档位。请以 successor run 继承现有预算/事实后再重验。';
        goalEvents.emit({
          type: 'phase_halt',
          phase: legacyFidelityRecovery.requestedStart,
          halt_reason: 'backtrack_limit',
          reason: 'legacy_fidelity_ssot',
          halt_guidance: detail,
        });
        concludeStartupBlocker('backtrack_limit', detail);
        console.error(`\n===== backtrack_limit =====\n${detail}\n`);
        return 1;
      }
      const backtracksUsedForRecovery = recoveryBudget + 1;
      const invalidatedPhases = chain.map(String);
      const fingerprint = createHash('sha256').update(stableStringify({
        reason: 'legacy_fidelity_ssot',
        feature: manifest.feature,
        from_phase: legacyFidelityRecovery.requestedStart,
        to_phase: 'spec',
        legacy_source: legacyFidelityRecovery.legacySource,
      }), 'utf8').digest('hex');
      goalEvents.emit({
        type: 'phase_backtrack_requested',
        phase: legacyFidelityRecovery.requestedStart,
        from_phase: legacyFidelityRecovery.requestedStart,
        to_phase: 'spec',
        invalidated_phases: invalidatedPhases,
        reason: 'legacy_fidelity_ssot',
        authorized: false,
        legacy_source: legacyFidelityRecovery.legacySource,
        files: [relFeatureFile(projectRoot, manifest.feature, 'spec/reports/fidelity-intent.json')],
        fingerprint,
        round_fingerprint: fingerprint,
        backtracks_used: backtracksUsedForRecovery,
        backtracks_limit: DEFAULT_MAX_BACKTRACKS,
        invalidation_tx_id: `${manifest.run_id}-legacy-fidelity-bt${backtracksUsedForRecovery}`,
      });
      goalEvents.emit({ type: 'phase_backtrack_started', to_phase: 'spec' });
      // priorEvents was loaded before run_start. Refresh it so resume reconstruction and the shared
      // backtrack budget consume this transaction in the same process as every in-loop backtrack.
      priorEvents = loadAuthoritativeEvents(eventsPath);
      console.error(
        `\n===== backtrack_to_phase =====\n` +
        `检测到 ${legacyFidelityRecovery.legacySource} 派生的 fidelity SSOT；旧档位不再授权质量降级。\n` +
        `→ 自动从 ${legacyFidelityRecovery.requestedStart} 回退 spec，由唯一 writer 按冻结需求重建 SSOT，` +
        `再重走下游（${backtracksUsedForRecovery}/${DEFAULT_MAX_BACKTRACKS}）。\n`,
      );
    }

    // plan f6b2d9a4：保真路由 preflight（agent 尚未被调用，不烧 run）——三段式自动定档，
    // await_human 分支已删除（非关键冲突不阻塞）；唯一 DEFER=selected pixel ∧ hard ∧
    // clamp 降档。initializeFidelityRouting 同时落 capability-snapshot + fidelity-intent
    // SSOT（goal 模式的路由初始化唯一入口——agent invoke 前）。
    // resume 且 fidelity 升档字段被授权时必须重建路由——否则 manifest 已换档而
    // SSOT/snapshot/prompt/CheckContext 全用旧决策。
    // post-impl3 P1-5 → runner-owned-machine-facts 追补修订：非 dry 一律调用 preflight，
    // 但**写盘只在链首为 spec 时发生**——下游起点读取复用 spec 冻结的 SSOT/snapshot
    //（execution_identity 每 run 必变，旧"幂等重算"并不幂等：无条件重写会把上游 spec
    // closure 弄 stale → assess 推荐 rerun_phase:spec 无路由 → framework_bug halt，
    // 宿主实锤 run 20260815T112821Z-6cb1da）。能力变化在下游起点以内存重探判 DEFER。
    if (!dryRun) {
      const fidelityAction = evaluateFidelityTierPreflight({
        projectRoot,
        frameworkRoot,
        manifest,
        featuresDirRel: featuresDir,
        chainStartsAtSpec: chain[0] === fullWorkflowChain[0],
        profileDir: loadResolvedProfile(projectRoot, cfg).profileDir,
        fidelityFromCli: Boolean(manifestArgv.fidelity),
      });
      if (fidelityAction.action !== 'proceed') {
        const status: GoalRunStatus = 'DEFERRED_CAPABILITY_MISSING';
        console.error(`\n[goal-runner] fidelity preflight → ${status}：\n${fidelityAction.detail}\n`);
        const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, []);
        writeGoalReport(projectRoot, manifest.report_dir, report, {
          workflowChain: fullWorkflowChain.map(String),
        });
        goalEvents.emit({ type: 'run_end', status });
        runConcluded = true;
        emitMilestone(`GOAL_RUN event=end status=${status} run_id=${manifest.run_id}`);
        return 2;
      }
      if (fidelityAction.routing) {
        console.log(`[goal-runner] fidelity 路由：${fidelityAction.routing.decision.rationale}（source=${fidelityAction.routing.decision.source}）`);
      } else if (fidelityAction.action === 'proceed' && fidelityAction.note) {
        // codex 定点：下游起点零写盘复用分支只带 note 不带 routing——此前这行日志在该
        // 路径上结构性不可达（宿主实锤：detach.log「复用/零写盘」0 命中）。
        console.log(`[goal-runner] fidelity 路由：${fidelityAction.note}`);
      }
    }

    const cap = loadGoalCapability(frameworkRoot, manifest.adapter!);
    // P1-7（plan d9b4f7e2）：adapter 版本运行时探测——每 run 一次、5s 超时、失败 unknown
    // 不阻塞；进 events（版本随宿主环境漂移，不硬编码 adapter.yaml）。与 output_delivery
    // 一并落 adapter_probe 事件，排障者一眼可见"什么版本、什么输出交付方式"。
    // plan c4e8a1f7 T1a：探测吃 session 解析出的**绝对路径**（.cmd 走 cross-spawn）——
    // telemetry 与正式 invoke 结构性同一（不再用裸 token 探、另解析跑）。
    if (!dryRun && executorMode === 'detached') {
      const headlessCmd = cap.capability?.external_runner?.headless_invoke ?? '';
      const adapterBinary =
        (sessionBinary?.binary?.path ?? headlessCmd.trim().split(/\s+/)[0]) || manifest.adapter!;
      const adapterVersion = await probeAdapterVersion(adapterBinary);
      // plan a8e5c3f9 t6：审计可见 effective 权限——旧 manifest 写 workspace-write 而
      // 实际全权限时，排障者不被 manifest 原文误导（复用本事件，不建独立账本）。
      const eff = effectiveHeadlessUnattended(manifest.unattended);
      goalEvents.emit({
        type: 'adapter_probe',
        adapter_version: adapterVersion,
        output_delivery: cap.capability?.output_delivery ?? 'unknown',
        effective_write_mode: eff.write_mode,
        effective_approval_mode: eff.approval_mode,
        // plan c4e8a1f7 T1a：resolved binary 身份 + 被遮蔽候选诊断（多版本共存合法，
        // PATH 首选项决定执行身份，其余仅诊断展示）。
        ...(sessionBinary?.binary ? { resolved_binary: sessionBinary.binary.path, resolved_binary_kind: sessionBinary.binary.kind } : {}),
        ...(sessionBinary && sessionBinary.shadowed.length > 0
          ? { shadowed_candidates: sessionBinary.shadowed }
          : {}),
      });
    }
    let outcomes: GoalPhaseOutcome[] = [];
    let deferredUpstream: Array<{ phase: FeaturePhase; reason: string }> = [];
    let chainStartIndex = 0;
    // adjudicated-repair-loop（review 修复）：resume 不重新 invoke 已 settled 的失效窗口
    // phase——主循环对该集合内的 phase 跳过 agent invoke，直接从验证边界（harness）继续。
    let resumePostAgentPhases: Set<string> = new Set();
    // adjudicated-repair-loop：phase → 原 settled invoke_id（reducer 从 events 派生，
    // 主循环 resumePostAgent 时复用该 attempt 身份，不新建）
    let resumePostAgentAttemptIds: Record<string, string> = {};

    // plan e7c2a4d8 T2：wall-clock 预算改**活跃时间**累计——sessionStartMs 为当前进程
    // 起点；priorActiveMs 由 partitionExecutionSessions 从历史段求和（崩溃段保守补收
    // 一个心跳周期；dry 段剔除）；nextSessionStartMs 契约防最后未闭合历史段与当前段
    // 双计（codex 五轮 P1-②）。隔夜 resume 不再按日历跨度秒撞熔断（4035d4 事故）。
    const sessionStartMs = Date.now();
    // T1④（e5d8a2c4）：**预算沿 supersede 链折叠——supersede 不得刷新任何预算**。
    // 预算是 per-run 从各自 events 回放的，新 run_id 即清零；不折叠的话"废弃旧 run
    // 开后继"就是绕过 DEFAULT_MAX_BACKTRACKS 与 wall 熔断的无限循环通道。种子=
    // 本次 CLI 的 --supersede（fresh）∪ 本 run events 里的 audited supersede（resume）。
    // **阶段完成状态仍只读当前 run**（进度不跨 run 折叠，见 collectSupersededAncestorEvents 头注）。
    // e9d4b7a3 t4：折叠逻辑收敛到 foldBudgetLineage 唯一共享入口（runner 熔断 /
    // progress.json / heartbeat 同源，不再各自复制公式）。
    const budgetLineage = foldBudgetLineage({
      projectRoot, featuresDir, feature: manifest.feature,
      seedTargets: supersededRunIds, currentEvents: priorEvents,
    });
    const ancestorBudgetEvents = budgetLineage.ancestorEvents;
    const budgetFoldEvents = budgetLineage.budgetFoldEvents;
    const budgetBase = resolveResumedBudget(budgetFoldEvents, { nextSessionStartMs: sessionStartMs });
    let totalTurns = budgetBase.totalTurns;
    const priorActiveMs = budgetBase.priorActiveMs;
    // 真实时间线起点（sinceMs/partial 回喂消费面——绝不喂合成时间，否则跨夜 resume
    // 丢上一段落盘产物）；无历史段时=当前会话起点。
    const wallClockStartMs = budgetBase.firstAuthoritativeStartMs ?? sessionStartMs;

    if (argv.resume) {
      // t1（plan c6a9e4d2）：resume 起点/priorOutcomes 一律从 **authoritative events
      // 回放**（resolveResumeFromEvents）。goal-report.json 不再参与恢复决策——纯展示
      // 投影只在 run_end 落盘，旧 run 崩溃后其 phases 落后于 events（review/ut 已
      // advance 仍显示旧 halt），曾造成每次 resume 把已 PASS 闭环回滚重跑。事件缺失/
      // 损坏已在上方 fail-closed（本分支可达时 events 必完整）。
      const resume = resolveResumeFromEvents(chain, priorEvents);
      outcomes = [...resume.priorOutcomes];
      deferredUpstream = [...resume.deferredUpstream];
      chainStartIndex = resume.startIndex;
      // S4：invalidation 消费——resume 起点推导剔除已失效且未重新完成的 phase
      // （被失效旧 PASS 不得作为续跑依据；十消费面矩阵之 resume 项）。
      // pass snapshot 已退役：失效事件本身即事实全部，无缓存需要退位。
      const inv = applyInvalidationsToResume(chain, outcomes, priorEvents);
      outcomes = inv.outcomes;
      chainStartIndex = Math.min(chainStartIndex, inv.startIndex);
      resumePostAgentPhases = new Set(inv.postAgentPhases);
      resumePostAgentAttemptIds = inv.postAgentAttemptIds;
      // plan b5f1d9c3 t1：resume 验证优先——普通 phase_halt 停等（WAITING 投影）后 resume 时，
      // 若事件窗口证明 agent 已完成、只差验证，同样派生 validation-only 资格（复用同一机器）。
      // 仅当该 phase 尚未被 invalidation 窗口覆盖时并入（inv 的 settled 判定更严格，优先）；
      // 不派生（返回 null）= 只是不从旧 halt 派生资格，后续完全由既有 resume/invalidation 路径决定。
      const haltEligibility = deriveHaltValidationOnlyEligibility(priorEvents);
      if (haltEligibility && !resumePostAgentPhases.has(haltEligibility.phase)) {
        resumePostAgentPhases.add(haltEligibility.phase);
        resumePostAgentAttemptIds[haltEligibility.phase] = haltEligibility.invoke_id;
      }
      if (resumePostAgentPhases.size > 0) {
        console.warn(
          `[goal-runner] resume：${[...resumePostAgentPhases].join(',')} 已完成 agent 执行` +
            '（settled 在案）——不再重新 invoke agent，从验证边界（harness）继续',
        );
      }
      goalEvents.emit({
        type: 'resume',
        start_index: chainStartIndex,
        start_phase: chain[chainStartIndex],
        ...(resumePostAgentPhases.size > 0
          ? { post_agent_phases: [...resumePostAgentPhases] }
          : {}),
      });
    }

    // t2/t3（plan c6a9e4d2）：Windows guardian 接管对账——resume 起点前遗留的
    // 未闭合 agent_process_bound 必须**逐一对账**处置干净才允许续跑（设备安全域，
    // fail-closed；真实事故曾出现多个并发孤儿，只处理最后一个会漏掉更早者）：
    //   · 旧版 run（从未有绑定事件且存在**未闭合** invoke）→ 拒绝 resume，提示
    //     人工清理；人工完成后以 --force-resume 显式确认（可审计）——supervisor
    //     不代其自动确认；
    //   · guardian 已不存在 → 依「guardian=Job 唯一持柄」契约判定 Job 已关闭，无需回收；
    //   · guardian 身份四元组严格匹配且存活 → 新 epoch（本进程锁接管）已取得，终止
    //     guardian 由 Job 关闭团灭全部后代（只杀 owner，绝不逐个 killProcessTree）；
    //   · 身份不匹配/不可核实/命令行缺 token → 不杀不阻断，仅警告。
    // 任一匹配但杀不死 → 拒绝续跑（真冲突，勿自动覆盖）。
    // 所有拒绝路径经 concludeStartupBlocker 优雅收口（run_start 已落，直接 return
    // 会留僵尸 RUNNING 投影）。非 Windows 平台不启用（无 Job 语义，零变化）。
    if (argv.resume && !dryRun && process.platform === 'win32') {
      const reconcile = reconcileGuardianOwnership(priorEvents, defaultProcessProbe());
      if (reconcile.kind === 'legacy_run') {
        const msg =
          '[goal-runner] BLOCKER: 本 run 存在未闭合 agent invoke 记录但没有任何 Job 绑定事件\n'
          + '  （agent_process_bound）——旧版 run 的遗留进程无法按 guardian 身份契约接管。\n'
          + `  原因：${reconcile.reason}`;
        if (forceResume) {
          // P1-4 review：人工清理后以 --force-resume 显式确认（可审计指令）。
          goalEvents.emit({
            type: 'legacy_run_override',
            run_id: manifest.run_id,
            reason: 'operator acknowledged legacy run via --force-resume',
          });
          console.warn(
            `[goal-runner] ⚠ 旧版 run 经 --force-resume 显式确认放行（${reconcile.unclosedInvokes}`
            + ' 个未闭合 invoke 无 Job 绑定——请已按提示人工清理残留 CLI 进程）',
          );
        } else {
          console.error(`${msg}\n处置：人工核查进程树后清理残留 CLI 后代后，`
            + '以 --force-resume 显式确认（可审计）后 resume——不猜测、不自动回收、'
            + 'supervisor 不代其确认。');
          concludeStartupBlocker('legacy_run_requires_manual_cleanup', msg);
          return 1;
        }
      } else if (reconcile.kind === 'outcomes') {
        for (const item of reconcile.items) {
          if (item.kind === 'guardian_gone') {
            console.log(
              `[goal-runner] 接管对账：guardian(pid=${item.bound.pid}) 已不存在——`
              + '依唯一持柄契约判定 Job 已关闭，无需回收',
            );
          } else if (item.kind === 'guardian_alive_matching') {
            const pid = item.bound.pid;
            const killed = terminateGuardianProcessOnly(pid);
            if (!killed || !awaitGuardianGone(pid)) {
              const msg =
                `[goal-runner] BLOCKER: guardian(pid=${pid}) 身份严格匹配（token=` +
                `${item.bound.token}）但无法终止——拒绝续跑（真冲突，勿自动覆盖）。\n`
                + '  处置：人工核查该 guardian 终止失败原因（权限/句柄占用）后重试。';
              console.error(msg);
              concludeStartupBlocker('guardian_termination_failed', msg);
              return 1;
            }
            goalEvents.emit({
              type: 'orphan_reclaimed',
              run_id: manifest.run_id,
              invoke_id: item.bound.invoke_id,
              pid,
              method: 'terminate_job_owner',
            });
            console.log(
              `[goal-runner] 接管对账：已终止匹配 guardian(pid=${pid})，Job 关闭团灭其全部后代`
              + '（孤儿已回收）',
            );
          } else {
            console.warn(`[goal-runner] ⚠ 接管对账：${item.reason}（不杀、不阻断）`);
          }
        }
      }
    }

    let halted = false;
    // S4 回退状态机：计数从 events 回放（进程重启不清零）；上限 1 次/run。
    let backtrackToIdx: number | null = null;
    // T1④：回退计数同样沿 supersede 链折叠（budgetFoldEvents ⊇ priorEvents）
    let backtracksUsed = budgetFoldEvents.filter(e => (e as { type?: string }).type === 'phase_backtrack_requested').length;
    let backtrackReviewFocus: string[] = [];
    // wall 由 goal-timeout 派生：max(配置 wall, Σ链路 per-phase + 缓冲)，
    // 保证全链单次满 per-phase 预算能跑完，避免被总 wall 提前截断。
    const wallMs = resolveWallClockMs(manifest);
    // P0-4（plan d9b4f7e2，rev8 偏离① 定稿口径）：wall deadline 制——**硬上界覆盖
    // agent/harness/backoff 三路径**（可用预算一律先扣 FINALIZE_RESERVE_MS 收尾预留）；
    // run_end 后收尾为 pre-check 拦截的 best-effort（finalize_skipped/finalize_overrun）。
    // 07-13 案实锤：预算只在 attempt 启动前检查，review 在 ~580m 启动后跑满 32m，
    // 限 585m 实跑 612m。plan e7c2a4d8 T2：deadline 硬上界语义不变，只换基点——
    // 当前会话起点 + 剩余活跃预算（priorActiveMs 已扣）。
    const wallDeadlineMs = sessionStartMs + Math.max(0, wallMs - priorActiveMs);
    // P0-A：显式 timeout 低于建议地板只 WARN 不抬升（尊重显式 override 契约）。
    for (const warn of collectPhaseTimeoutWarnings(manifest, chain)) {
      console.warn(warn);
    }

    // e9d4b7a3 t4：run_start / resume 起步即打印 lineage 口径预算余量（turns + wall 两维
    // used/limit/remaining）——预算不足在阶段启动前可见，不再闭环后才改 manifest 撞墙。
    // 口径与熔断同源（foldBudgetLineage → resolveResumedBudget）。
    {
      const activeElapsedMs = budgetBase.priorActiveMs + (Date.now() - sessionStartMs);
      const remainingTurns = Math.max(0, manifest.budget.max_total_turns - budgetBase.totalTurns);
      const remainingWallMs = Math.max(0, wallMs - activeElapsedMs);
      const min = Math.round.bind(null);
      console.log(
        `[goal-runner] ${argv.resume ? 'resume' : 'run_start'} 预算（supersede lineage 折叠口径）: ` +
          `turns ${budgetBase.totalTurns}/${manifest.budget.max_total_turns}（remaining ${remainingTurns}）；` +
          `wall ${min(activeElapsedMs / 60000)}m/${min(wallMs / 60000)}m（remaining ~${min(remainingWallMs / 60000)}m）`,
      );
    }

    // e9d4b7a3 t5：**budget-only 授权 rebase**（--override-manifest 提额后 resume）——
    // 在任何 review agent 启动之前，对受影响的已完成上游阶段执行一次确定性 harness
    // 刷新证据（不起 agent）。重放「599/600 撞墙 → 提预算 → resume」时上游证据不再
    // stale，review 不被白烧（i28/i29）。非 budget-only rebase / 无 rebase / dry-run
    // 一律不走该路径（非 budget-only 漂移须 halt 或走正常重跑，不得用刷新假装可信）。
    // 二轮 review P1：**任一刷新失败 → review 前一次性 HALT**（继续烧 review=原样
    // 复发 i28/i29）；刷新只做 evidence 重发布，不伪造 attempt、不 re-sign、不加状态。
    if (!dryRun && argv.resume && manifestDrift.rebaseApplied
        && isBudgetOnlyIdentityChange(manifestDrift.changedFields)) {
      const refreshFailures = await refreshCompletedUpstreamEvidenceDeterministic({
        projectRoot,
        frameworkRoot,
        manifest,
        chain,
        chainStartIndex,
        wallDeadlineMs,
        events: startupEvents,
        emit: (e) => goalEvents.emit(e),
      });
      if (refreshFailures.length > 0) {
        halted = true;
        const haltPhase = chain[chainStartIndex];
        const guidance =
          `budget-only rebase 后上游证据确定性刷新失败（${refreshFailures.length} 项，` +
          `已在 review 之前 halt，未消耗任何 review invoke）：\n` +
          refreshFailures.map(f => `  - ${f}`).join('\n') +
          '\n处置：修复对应上游阶段证据（重跑其 harness 补齐 closure / 修复回执身份）后 --resume 继续。';
        const disposition = decide(
          { incident: 'upstream_closure_gap', phase: String(haltPhase), detail: guidance },
          NO_AUTHORITY,
          {
            orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session',
            invocation: 'resume',
          },
        );
        console.error(`\n===== upstream_closure_gap =====\n${guidance}\n`);
        goalEvents.emit({
          type: 'phase_halt',
          phase: haltPhase,
          halt_reason: 'upstream_closure_gap',
          halt_guidance: guidance,
          detail: guidance,
          ...runDispositionFields(disposition),
        });
        outcomes.push({
          phase: haltPhase,
          verdict: 'FAIL',
          halted: true,
          retries: 0,
          halt_reason: 'upstream_closure_gap',
          halt_guidance: guidance,
        });
      }
    }

    // T2(c)：wall 预算熔断统一发射器——reason+guidance 三处可见（phase_halt 事件/
    // outcome/console banner；run_end 经 resolveLastHaltReason 取 outcome）。
    const emitWallBudgetHaltGuidance = (phaseArg: string): string => {
      const activeElapsedMs = priorActiveMs + (Date.now() - sessionStartMs);
      const guidance = buildBudgetExhaustedGuidance({
        feature: manifest.feature,
        runId: manifest.run_id,
        phase: phaseArg,
        kind: 'budget_wall_clock',
        activeElapsedMs,
        limit: wallMs,
        harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
      }).join('\n');
      goalEvents.emit({
        type: 'phase_halt',
        phase: phaseArg,
        halt_reason: 'budget_wall_clock',
        halt_guidance: guidance,
      });
      console.error(`\n===== budget_wall_clock =====\n${guidance}\n`);
      return guidance;
    };

    // adjudicated-repair-loop M1（plan e2b7c4a9 t1.5/t1.6）：回退链完成跟踪（循环外内存态）。
    // phase_backtrack_completed 必须在回退链**真正完成后**发出（修 :7592 提前发射时序）：
    // 目标 phase 执行完毕（agent_process_settled/phase_verdict 在案）后补发；
    // repair+signal@1 时顺带做 no-op 快照判定（pre/post 相等 → 不重跑下游 +
    // result='noop' + 走空 eligible 停等）。resume 重启后内存态丢失——attempted 判定
    // 只依赖 settled/verdict 事件（不依赖 completed），crash 场景语义不破（1.3 契约）。
    let pendingBacktrackCompletion: {
      toPhase: string;
      signalDriven: boolean;
      preSnapshot: ProductSourceSnapshotDetail | null;
      /** Legacy fidelity recovery is complete only after a trusted owner closure commit. */
      requiresCommittedClosure?: boolean;
    } | null = legacyFidelityRecovery
      ? { toPhase: 'spec', signalDriven: false, preSnapshot: null, requiresCommittedClosure: true }
      : null;

    const runtimeAuthorization = options.authorization ?? { mode: 'goal_mode' as const };
    const runtimeMaxRounds = options.maxRounds === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.trunc(options.maxRounds));
    let runtimeRoundsStarted = 0;
    let runtimeBoundaryYielded = false;
    for (let phaseIdx = chainStartIndex; phaseIdx < chain.length && !halted; phaseIdx++) {
      const phase = chain[phaseIdx];
      const boundaryRecommendation: AssessRecommendation = {
        action: 'run_phase',
        phase: String(phase),
        reason: 'shared runtime phase boundary',
        requires_driver_authorization: true,
      };
      if (
        runtimeRoundsStarted >= runtimeMaxRounds ||
        !recommendationAuthorized(
          boundaryRecommendation,
          runtimeAuthorization,
          chain.map(String),
          { startPhase: String(manifest.start_phase) },
        )
      ) {
        runtimeBoundaryYielded = true;
        break;
      }
      runtimeRoundsStarted += 1;
      let retries = 0;
      let phaseDone = false;
      let priorBlockerSignature: string | null = null;
      let priorArtifactSnapshot: ArtifactSnapshot | null = null;
      // P1-B：上一次 attempt 是否因超时被中断（非内容失败）——用于重试时复用 partial 产物。
      let priorAttemptTimedOut = false;
      // 上一轮 gate 未能产出可读 summary 时，保留其真实末尾输出给下一轮修复。
      let priorHarnessFailure: string | undefined;
      // P0-D：transient 计数与"上轮断流"语义都从 events.jsonl 派生（跨 continue/--resume
      // 不清零/不丢——内存变量在新进程必然归零，codex P1）。
      const phaseStartEvents = loadAuthoritativeEvents(
        path.join(projectRoot, manifest.report_dir, 'events.jsonl'),
      );
      // T1④：transient 本就跨 resume 计数——跨 supersede 同样折叠（祖先同 phase 的断流重试计入）
      let transientRetriesUsed = countTransientApiRetries(
        ancestorBudgetEvents.length > 0 ? [...ancestorBudgetEvents, ...phaseStartEvents] : phaseStartEvents,
        phase,
      );
      // P0-D：上一次 attempt 是否 API 断流（同样非内容失败，partial 产物照样复用）。
      // resume 首轮从最近一次 phase_verdict 恢复，否则 prompt 归因错向 deterministic、
      // partial 续作块打不开。
      let priorAttemptApiError =
        Boolean(argv.resume) &&
        phaseIdx === chainStartIndex &&
        lastPhaseVerdictTransientApiError(phaseStartEvents, phase);

      progressPhase = phase;
      progressSubstep = null;

      goalEvents.emit({
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
        // T2：elapsed = 历史活跃 + 当前会话（活跃口径，非日历跨度）。
        const activeElapsedMs = priorActiveMs + (Date.now() - sessionStartMs);
        const budget = checkRunBudget(
          totalTurns,
          manifest.budget.max_total_turns,
          activeElapsedMs,
          wallMs,
        );
        if (budget !== 'ok') {
          halted = true;
          const budgetHaltReason = budget === 'wall_clock' ? 'budget_wall_clock' : 'budget_turns';
          // T2(c)：budget halt 全链可解释——reason + guidance 进 outcome/phase_halt/
          // run_end（resolveLastHaltReason 消费 outcome.halt_reason）+ console banner。
          const budgetGuidance = buildBudgetExhaustedGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase: String(phase),
            kind: budgetHaltReason,
            activeElapsedMs,
            limit: budget === 'wall_clock' ? wallMs : manifest.budget.max_total_turns,
            harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
          }).join('\n');
          goalEvents.emit({
            type: budgetHaltReason,
            phase,
          });
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: budgetHaltReason,
            halt_guidance: budgetGuidance,
          });
          console.error(`\n===== ${budgetHaltReason} =====\n${budgetGuidance}\n`);
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: budgetHaltReason,
            halt_guidance: budgetGuidance,
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
          const eventsForIntegrity = loadAuthoritativeEvents(eventsPath);
          const recon = reconcileLedgerWithEvents({
            ledgerPath: visualRoundsLedgerPath(projectRoot, manifest.feature),
            loopId: `goal:${manifest.run_id}`,
            expectedRowHashes: collectVisualRoundRowHashes(eventsForIntegrity),
            pendingAttemptIds: collectUncommittedVisualAttemptIds(eventsForIntegrity),
          });
          if (!recon.ok) {
            halted = true;
            const detail = recon.issues.map(i => `${i.kind}: ${i.detail}`).join('; ');
            goalEvents.emit({
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
            goalEvents.emit({
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

        // adjudicated-repair-loop（review 修复）：resume 不重新 invoke 已 settled 的
        // 失效窗口 phase——**在任何新 attempt 分配（totalTurns++/visualAttemptId）之前**
        // 决定，复用原 settled invocation 的身份（attempted 不变式不破、不产生无 start 的
        // 幽灵 attempt）。retry 边界：仅首 attempt（retries===0）跳过，消费即删。
        const resumePostAgent =
          argv.resume && resumePostAgentPhases.has(phase) && retries === 0;
        if (resumePostAgent) resumePostAgentPhases.delete(phase);

        if (!resumePostAgent) totalTurns++;
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
        const attemptHistory = loadAuthoritativeEvents(eventsPath);
        const persistedContinuation = deriveContinuationFromEvents(attemptHistory, phase);
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
          if (persistedContinuation) {
            continuation = { cause: persistedContinuation.cause, process_resumed: true };
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
            // 旧 framework_integrity/manifest/foreign/dirty 只供历史 renderer，不能重新
            // 进入当前 continuation prompt、halt 或 retry。若剥离后无当前 blocker，本 phase
            // 直接按当前发布件重验，不注入 code_regression/repair 指导。
            const currentSummary = stripRetiredFrameworkIntegrityForCurrentRun(priorSummaryRead.summary);
            if (currentSummary) {
              priorFailure = extractPriorFailureContext(currentSummary);
              priorFailureKind = classifyFailureKind(currentSummary, manifest.dependency_policy);
            }
          }
        }
        if (isPhaseContinuation && !priorFailure) {
          const fatal = priorHarnessFailure ?? readHarnessFailureFromDetachLog(
            path.join(projectRoot, manifest.report_dir, 'detach.log'),
          );
          if (fatal) {
            priorFailure = `Previous harness failed before producing a readable failure summary:\n${fatal}`;
            priorFailureKind = 'deterministic_gate_or_artifact_missing';
          }
        }
        // plan e6b3f8d2 t5：**同 invoke 的新鲜 harness 质量事实**（纯函数，窗口分法与
        // deriveContinuationFromEvents 同源）。只在超时续作时取用——两轴并陈的判据。
        const timeoutCoexistingHarnessFailure =
          continuation?.cause === 'agent_timeout'
            ? findLatestInvokeHarnessFailure(attemptHistory, String(phase))
            : null;
        // P0-B/P0-D + rev6 缺口 b：上轮 agent 级中断以 continuation cause 为准——summary
        // 重算只见症状 blocker（断流的 spec_file_exists 会被误算 deterministic_gate，
        // "revert first" 指导随之错向）。现在同进程与 --resume 跨进程同一来源，kind 不再丢。
        if (continuation?.cause === 'transient_api_error') priorFailureKind = 'transient_api_error';
        else if (continuation?.cause === 'agent_timeout') priorFailureKind = 'agent_timeout';
        else if (
          continuation?.cause === 'content_retry' &&
          persistedContinuation?.failureKind === 'test_contract'
        ) {
          // f4b2c8e6 t1：summary 不含 device evidence；同进程 retry / --resume 都从最新
          // attempt 的权威 phase_verdict 恢复精修 kind，防 prompt 退回 code_regression。
          priorFailureKind = 'test_contract';
          // 正式 device gate 可在 harness summary=PASS 后由 collector 判出 test_contract；
          // 此时 summary 没有 FAIL 正文，仍须给 prompt 一个固定、脱敏的上下文入口。
          priorFailure ??= 'Previous testing attempt has trusted device evidence classified as test_contract.';
        }

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
        const phaseEventsNow = loadAuthoritativeEvents(eventsPath);
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
          goalEvents.emit({
            type: 'timeout_advisory',
            phase,
            detail: timeoutResolution.advisory,
          });
        }
        const escalatedTimeoutMs = timeoutResolution.effectiveMs;
        const availableForAgentMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
        if (availableForAgentMs <= 0) {
          halted = true;
          goalEvents.emit({ type: 'budget_wall_clock', phase });
          const wallGuidance = emitWallBudgetHaltGuidance(String(phase));
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: 'budget_wall_clock',
            halt_guidance: wallGuidance,
          });
          break;
        }
        const effectiveAgentTimeoutMs = Math.min(escalatedTimeoutMs, availableForAgentMs);
        if (escalatedTimeoutMs > baseTimeoutMs) {
          goalEvents.emit({
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
        // plan ab072691 t4④：spec 期视觉观察 sidecar 生产——**唯一生产点**，
        // 与 OCR 预扫描同一条 dispatch（spec 产、plan/coding 只列）。
        // best-effort：单图失败不阻断其余，整体失败也只是少几份 sidecar，绝不阻断 spec。
        if (
          !dryRun && phase === 'spec' &&
          capabilityAdvisory?.visionMode === 'delegated' && capabilityAdvisory.visualProvider &&
          capabilityAdvisory.referenceImagePaths.length > 0
        ) {
          try {
            const produced = await produceVisualObservationSidecars({
              projectRoot,
              frameworkRoot,
              feature: manifest.feature,
              provider: capabilityAdvisory.visualProvider,
              referenceImages: capabilityAdvisory.referenceImagePaths.map(
                rel => path.resolve(projectRoot, rel),
              ),
              evidenceRoot: path.join(projectRoot, manifest.report_dir, 'visual-review'),
              runId: manifest.run_id,
              onInvocation: (inv: VisualProviderInvocation) =>
                goalEvents.emit({ ...buildVisualProviderInvokeEvent(inv) }),
            });
            // 生产后回列：prompt 看到的就是盘上最终结果（含复用的既有 sidecar）。
            capabilityAdvisory.visualObservationPaths = produced;
          } catch (e) {
            // 观察是 best-effort 上下文，不是门禁产物——异常只记一行，不改判、不阻断。
            console.warn(`[visual-provider] spec 观察 sidecar 生产异常（不阻断）：${(e as Error).message}`);
          }
        }
        // post-impl3 P0-3：mid-chain 能力收紧命中真冲突（pixel∧hard∧clamped）——spawn 前
        // 消费裁决（否则收紧发生在 plan/coding 时后续不重跑 spec pregate，hard pixel 静默继续）。
        if (capabilityAdvisory?.deferTriggered) {
          halted = true;
          goalEvents.emitPhaseVerdict({
            phase, verdict: 'INCOMPLETE',
            action: 'defer_external_and_halt',
            blocking_class: 'externalBlocked',
            failure_kind: 'capability_missing',
            deferred_reason: 'capability_missing',
            detail: 'vision policy 收紧后当前 provider 无法满足 pixel_1to1 + hard',
          });
          outcomes.push({
            phase, verdict: 'INCOMPLETE', deferred: true,
            deferred_reason: 'capability_missing', retries,
            halt_guidance:
              'vision policy 收紧后当前 provider 无法满足 pixel_1to1+hard——换用具备所需视觉能力的 provider/version 后 --resume；' +
              '若需求目标确需改变，请以 correction/successor run 冻结新需求。',
          });
          break;
        }

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

        // 【pass snapshot 已整体退役 · runner-owned-machine-facts（codex 审计定案）】
        // closure-only 是上一轮权威 phase_verdict 的流程状态（PASS+advance_blocked+retry）。
        // PASS 产物的防篡改不再靠冻结快照/恢复：改坏了下一轮 harness FAIL，改了仍合法则
        // 重新通过完整门禁，closure manifest 恒绑定当前字节——快照只徒增故障面。
        const closureOnlyAttempt = isClosureOnlyRetryPending(attemptHistory, String(phase));

        // ------------------------------------------------------------------
        // b3e8d4c7 t5④：**进 coding、agent_invoke_start 之前**的 plan 授权预检。
        // 不前移的话：无可信 plan 授权的 resume 会先跑完一轮 coding、再由 post-agent gate
        // 发现问题，白烧一次 attempt，且 agent 在授权未确认时已经动过代码。
        // ------------------------------------------------------------------
        // 两个边界共用同一实现（codex P1：不另建检测器）。返回 true = 已处置（回退或
        // halt），调用方须 `phaseDone = true; continue;`。
        const runPlanAuthorityGate = (boundary: 'pre_spawn' | 'post_agent'): boolean => {
          if (dryRun || phase !== ('coding' as FeaturePhase)) return false;
          // runner-owned-machine-facts 裁剪（codex 定案）：授权=仓内 fresh 的 plan
          // closure（recomputePhaseEvidenceStaleness 同一把尺），跨 run 稳定——fresh
          // --start coding 无需本 run 快照即可开工；pass snapshot 只承担同阶段
          // closure-retry 的 TOCTOU 保护，与授权彻底解耦（不再派生/不再写内存锚）。
          const authority = checkPlanAuthority({
            projectRoot,
            feature: manifest.feature,
            frameworkRoot,
          });
          if (authority.kind === 'ok') {
            return false;
          }
          const replan = tryScopeReplan({
            projectRoot,
            feature: manifest.feature,
            runId: manifest.run_id,
            chain: chain.map(String),
            endPhaseIdx: phaseIdx,
            phasesWithOutcome: outcomes.map(o => String(o.phase)),
            backtracksUsed,
            maxBacktracks: DEFAULT_MAX_BACKTRACKS,
            trigger: 'plan_authority_unverifiable',
            causePhase: String(phase),
            affectedFiles: authority.affectedFiles,
            detail: authority.detail,
            emit: (e: Record<string, unknown>) => goalEvents.emit(e),
          });
          if (replan.kind === 'replanned') {
            backtracksUsed++;
            // t5②：越界/漂移文件作为**未受信上下文**交给下一轮 plan（是"发现事实"，
            // 不是授权）——没有这一步，plan 回去了也不知道为何重跑，原样再跑一遍。
            scopeReplanContext = resolveScopeReplanContext({
              projectRoot,
              reason: 'plan_authority_unverifiable',
              files: authority.affectedFiles,
            });
            outcomes = outcomes.filter(o => !replan.invalidatedPhases.includes(String(o.phase)));
            console.error(
              `\n===== plan_authority_${authority.reason} =====\n${authority.detail}\n` +
              (boundary === 'pre_spawn'
                ? '→ **未启动 coding agent**，'
                : '→ **本轮 coding 产出不予采信、gate 不运行**，') +
              `自动回退 plan 重新裁决并重新签发快照（tx=${replan.txId}）。\n` +
              `（第 ${backtracksUsed} 次回退，共用预算 ${DEFAULT_MAX_BACKTRACKS} 次/run）\n`,
            );
            phaseIdx = replan.planIdx - 1; // for 循环 ++ 后落回 plan
            // adjudicated-repair-loop M1（review 修复）：scope-replan 回退路径同样记录
            // 完成跟踪——completed 在目标 plan 真正执行完（settled/verdict）后经统一补发点
            // 发出（此前 scope 路径缺发 completed，事件链不完整）。signalDriven=false。
            pendingBacktrackCompletion = {
              toPhase: 'plan',
              signalDriven: false,
              preSnapshot: null,
            };
            return true;
          }
          // runner-owned-machine-facts 收口（codex 三轮）：授权已是 closure 语义——链不含
          // plan 时的正名是 upstream_closure_gap（上游 closure 缺口/漂移，与截断链 preflight
          // 拒启同语义），不再借用已退役的 pass_snapshot_unavailable。它的裁决是
          // operator → WAITING(human)，supervisor 对 WAITING 恒 no_op——所以这里**诚实
          // 停下等人**，不带 successor_required/successor_start_phase（挂在 WAITING 事件上
          // 是永远不会被执行的死信，日志还谎称"等待自动恢复"）。显式 successor 起点机制
          // 保留给真正可自动恢复的路径（review 基线缺口的 RECOVERY_PENDING → coding）。
          const guidance = `${authority.detail}；自动回退不可用：${replan.detail}`;
          const budgetExhausted =
            replan.kind === 'unavailable' && replan.reason === 'backtrack_budget_exhausted';
          const haltReason = budgetExhausted ? 'backtrack_limit' : 'upstream_closure_gap';
          const authorityDecision = decide(
            { incident: haltReason, phase: String(phase) },
            NO_AUTHORITY,
            {
              orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session',
              invocation: argv.resume ? 'resume' : 'fresh',
            },
          );
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: haltReason,
            detail: guidance,
            halt_guidance: guidance,
            ...runDispositionFields(authorityDecision),
          });
          console.error(
            `\n===== ${haltReason} =====\n${guidance}\n` +
              (budgetExhausted
                ? '回退预算已耗尽，当前 run 终止。\n'
                : '请以 fresh goal run 从 plan 重新闭环（--start plan）后再从 coding 续跑。\n'),
          );
          outcomes.push({
            phase, verdict: 'FAIL', halted: true, retries,
            halt_reason: haltReason, halt_guidance: guidance,
          });
          halted = true;
          return true;
        };
        if (runPlanAuthorityGate('pre_spawn')) {
          phaseDone = true;
          continue;
        }

        let phaseWriteBoundary: PhaseWriteBoundaryResolution;
        try {
          phaseWriteBoundary = resolvePhaseWriteBoundary({
            projectRoot,
            frameworkRoot,
            feature: manifest.feature,
            phaseOrder: fullWorkflowChain.map(String),
            track: goalTrack,
            profileDir: resolvedProfile.profileDir,
            productLayerDirs: productLayerDirsOf(projectRoot),
            resolveUtSourceRoots: tryLoadUtSourceRootResolver(resolvedProfile.profileDir) ?? undefined,
          });
        } catch (error) {
          const detail = `phase write boundary resolution failed: ${(error as Error).message}`;
          goalEvents.emit({ type: 'phase_halt', phase, halt_reason: 'phase_write_boundary_unresolved', detail });
          outcomes.push({
            phase, verdict: 'FAIL', halted: true, retries,
            halt_reason: 'phase_write_boundary_unresolved', halt_guidance: detail,
          });
          console.error(`\n===== phase_write_boundary_unresolved =====\n${detail}\n`);
          halted = true;
          phaseDone = true;
          continue;
        }
        if (phaseWriteBoundary.unresolvedSourcePhases.includes(String(phase))) {
          const detail = phaseWriteBoundary.diagnostics.join('；');
          goalEvents.emit({ type: 'phase_halt', phase, halt_reason: 'phase_write_boundary_unresolved', detail });
          outcomes.push({
            phase, verdict: 'FAIL', halted: true, retries,
            halt_reason: 'phase_write_boundary_unresolved', halt_guidance: detail,
          });
          console.error(`\n===== phase_write_boundary_unresolved =====\n${detail}\n`);
          halted = true;
          phaseDone = true;
          continue;
        }

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
          // plan e6b3f8d2 t5：同 invoke 的新鲜 harness 质量事实（两轴并陈判据）
          timeoutCoexistingHarnessFailure,
          effectiveAgentTimeoutMs,
          priorAttemptDurationsMs.length > 0
            ? {
                attempts: priorAttemptDurationsMs.length,
                elapsedMs: priorAttemptDurationsMs.reduce((a, b) => a + b, 0),
              }
            : undefined,
          phaseWriteBoundary,
        ) + inlineCanaryBlock +
          // S4：回退后 review 注入增量重点复审清单（授权 ≠ 免审）
          (phase === 'review' && backtrackReviewFocus.length > 0
            ? buildBacktrackReviewFocusBlock(backtrackReviewFocus)
            : '') +
          // v23 F1：回退后 coding 注入缺陷必做段——闭环最后一段电线（没有它，coding
          // 回去了也不知道修什么 → 原样重跑 → 熔断）
          (phase === 'coding' && backtrackCodingContext.length > 0
            ? buildTestingDefectsBlock(backtrackCodingContext)
            : '') +
          // 责任阶段统一路由（plan b6e4c9f2）：repair candidates 按**当前 phase 类别**
          // 过滤注入（mixed-owner：spec 修不了 coding 的缺陷，coding 轮到时拿到自己的单）。
          // 未受信上下文措辞——只陈述发现的缺陷事实，不含授权语气。
          (() => {
            if (backtrackRepairCandidates.length === 0) return '';
            const mine = backtrackRepairCandidates.filter(
              c => mapCategoryToChainPhase(c.category, chain.map(String), goalTrack) === String(phase),
            );
            if (mine.length === 0) return '';
            return [
              '',
              '## Verified repair candidates for this phase (untrusted context — fix, then re-verify)',
              '',
              'A downstream phase found the following verified defects owned by this phase.',
              'They are findings, not authorization; your own gates re-judge everything.',
              '',
              ...mine.map(c => `- ${c.id}: ${c.summary}${c.files.length > 0 ? `（涉及：${c.files.slice(0, 5).join('、')}）` : ''}`),
              '',
            ].join('\n');
          })() +
          // b3e8d4c7 t5②：scope 自动回退后给 plan 的**未受信上下文**——同款"闭环最后一段
          // 电线"。措辞刻意不含任何授权语气：只陈述发现的事实，纳不纳入由 plan 自己裁决。
          (phase === 'plan' && scopeReplanContext
            ? buildScopeReplanContextBlock(scopeReplanContext)
            : '') +
          (phaseWriteRecoveryContext?.targetPhase === String(phase)
            ? buildPhaseWriteRecoveryContextBlock(phaseWriteRecoveryContext)
            : '') +
          // closure-only 提示由上一轮裁决决定（pass snapshot 已退役——"不要重写产物"仍是
          // 提示级约束；硬保护=改坏必被下一轮完整 harness 抓住，closure manifest 绑当前字节）。
          (closureOnlyAttempt
            ? [
                '',
                '## Closure-only attempt (BLOCKER)',
                '',
                'This phase already reached a PASS verdict; only the closure steps (receipt / harness re-run) remain.',
                '',
                'Do NOT redo analysis or rewrite artifacts. Complete the phase closure only.',
                '',
              ].join('\n')
            : '') +
          // runner-owned-machine-facts 追补（codex review）：spec closure-only 轮必须重新
          // 只读取证——冻结豁免的是"重做分析/改产物"，不豁免 invocation-bound 的视觉验读。
          // plan c4e8a1f7 T2：权威路径=共享发现集合（不再从 spec.md 自算较小分母）；
          // T3：按 provenance 分轴——结构化 adapter 才要求本 invoke 逐图 Read（争取终签），
          // none-provenance adapter 明示不可审计出口（诚实 unverified，不追逐不可达终签）。
          (() => {
            if (!closureOnlyAttempt || phase !== 'spec') return '';
            try {
              const refAbsForClosure = resolveRequirementReferenceImages(
                projectRoot,
                manifest.feature,
                manifest.requirement,
                { requirementSourceFiles: manifest.requirement_source_files },
              );
              const refRel = refAbsForClosure.map(p =>
                path.relative(projectRoot, p).replace(/\\/g, '/'));
              // plan c4e8a1f7 T3（评审 P1 修复 2 轮）："能看图 × 能审计"两轴由纯函数
              // resolveClosureReadRequirement 单点判定——hasVision=false + structured
              // 必须归一为 'none'（诚实 unverified），**不得**把原始 provenance 透传
              // （旧三元 `readRequired ? 'structured_events' : provenance` 会让判盲
              // structured adapter 仍输出 Mandatory Read，评审实锤复现）。
              const requireRead = resolveClosureReadRequirement(
                capabilityAdvisory?.hasVision,
                capabilityAdvisory?.toolEventProvenance,
              );
              return buildClosureVisualEvidenceBlock(refRel, requireRead);
            } catch {
              return ''; // best-effort：列不出路径时不阻断 prompt（gate 侧判定不变）
            }
          })();
        fs.writeFileSync(promptPath, prompt, 'utf-8');
        progressSubstep = 'prompt';
        goalEvents.emit({
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
        const invokePlan: HeadlessInvokePlan = executorMode === 'detached'
          ? resolveHeadlessInvokePlan(
              manifest.adapter!,
              cap.capability!,
              manifest.unattended,
              prompt,
              vars,
              manifest.adapter_model_pin?.value,
              // plan c4e8a1f7 T1a：正式 phase invoke 复用 session binary（probe/invoke 同一身份）
              sessionBinary?.binary ?? null,
            )
          : { argv: [], label: 'phase_execute_request', adapterName: manifest.adapter! };
        // plan d7f3a9c4 t1：dry-run 在 plan 输出回显 pin（用户权威输入可见）。
        if (dryRun) {
          console.log(
            `[goal-runner] [dry-run] ${phase} plan: ${invokePlan.label}` +
              (manifest.adapter_model_pin
                ? `（adapter_model_pin=${manifest.adapter_model_pin.adapter}:${manifest.adapter_model_pin.value}）`
                : ''),
          );
        }

        const outputLogPath = path.join(phaseDir, 'agent-output.log');
        // visualAttemptId=轮次账本的 attempt 身份：同一 invocation 的 agent 自跑 harness
        // 与外层 gate 共用；任何下一次 invocation（retry/detach/resume）必不同；崩溃恢复
        // 不重用（事件已落盘则 totalTurns 回放计入）。禁 phase 内 retries+1（resume 归零会
        // 撞旧 round_key）。adjudicated-repair-loop：resumePostAgent（已 settled 的验证边界
        // 恢复）**复用原 settled invocation 的 attempt 身份**——不从 events 取新序数、不产生
        // 幽灵 attempt（无 start 的 invoke_end）。
        const visualAttemptId = resumePostAgent
          ? (() => {
              // 复用 reducer 从既有 events 派生的原 settled invoke_id（postAgentAttemptIds——
              // 与 postAgent 判定同一判据；精确身份缺失时不应到本分支，兜底不用全局历史猜）
              const reuse = resumePostAgentAttemptIds[phase];
              if (reuse) {
                const m = /^[a-z-]+-i(\d+)$/.exec(reuse);
                if (m) return `i${m[1]}`;
                return reuse;
              }
              return `i${totalTurns}`;
            })()
          : `i${totalTurns}`;
        const invokeId = `${phase}-${visualAttemptId}`;

        // testing-stepresult-evidence：P0 native CaseResult.steps[] 能力在 testing agent
        // 启动前静态预检。未准备好时不烧 agent/content attempt，直接走 capability defer；
        // 静态预检通过后仍由 check-testing 按 ready/trace 三重判据二次核验，native evidence
        // 缺失/无效只能 FAIL/retry testing。
        if (!dryRun) {
          const runtimeTelemetryDefer = runRuntimeTelemetryPreflightGate({
            projectRoot,
            feature: manifest.feature,
            phase,
            retries,
            resolvedProfile,
            emitPhaseVerdict: ev => goalEvents.emitPhaseVerdict(ev),
          });
          if (runtimeTelemetryDefer) {
            outcomes.push(runtimeTelemetryDefer.outcome);
            halted = true;
            phaseDone = true;
            break;
          }
        }

        // t3-min（openspec capability-gap-preflight）：invoke 前共享 preflight——每 phase
        // 每 attempt 重检（含 --resume）；缺口不产生 agent_invoke_start、不烧 agent 轮次，
        // 首触即 halt 求人（不进 CUMULATIVE_HALT_FAMILY：agent 未开跑，无累计语义）。
        // v5：逻辑抽取为 runInvokeCapabilityGate（真实链可测——goal-capability-gate 单测
        // 断言"缺口无 agent_invoke_start / resume 重检仍 halt / reprobe 后放行"事件序列）。
        if (!dryRun) {
          const capHalt = (injectedCapabilityGate ?? runInvokeCapabilityGate)({
            projectRoot,
            phase,
            retries,
            resolvedProfile: loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot)),
            emitEvent: ev => goalEvents.emit(ev as Parameters<typeof appendEvent>[2]),
          });
          if (capHalt) {
            halted = true;
            outcomes.push(capHalt.outcome);
            break;
          }
        }

        // openspec device-readiness-and-completion t3：设备就绪门。
        // **必须排在 agent_invoke_start 之前**——未取得 READY 就不调 agent，agent 便
        // 根本不进入"发现锁屏后自行处置"的场景（07-28 事故里它在该场景对用户真机
        // 枚举了 10 组常见 PIN）。与 capability gate 是相邻的**独立**门：后者同步、
        // 固定 capability FAIL；设备不可用应走 external_block defer 契约。
        let deviceEnv: Record<string, string> = {};
        // null = 本 phase 未经设备门（与 'unknown'=经过门但判不出机型 语义不同，见封顶函数）
        let deviceKindThisPhase: DeviceTargetKind | null = null;
        if (!dryRun && phaseRequiresDevice(phase, loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot)))) {
          // P1（三轮 review）：把**本 run 已托管的模拟器**交给 gate 复用。
          // 不传的话，每个设备 phase 都会当作"从零开始"：真机若一直锁着，UT 起一个、
          // testing 再起一个，后写的 session 覆盖前一个 → 旧进程再也回收不掉。
          // `--resume` 走的也是这条路径（读的是本 run 自己的 report_dir）。
          const priorSession = readDeviceSession(projectRoot, manifest.report_dir);
          const reusableManaged =
            priorSession?.managed &&
            priorSession.started_by_run === manifest.run_id &&
            priorSession.status !== 'released'
              ? { serial: priorSession.serial, identity: priorSession.managed }
              : null;
          const decision = await (injectedDeviceGate ?? runDeviceReadinessGate)({
            phase,
            retries,
            sessionId: invokeId,
            input: { ...buildDeviceReadinessInput(projectRoot), existingManaged: reusableManaged },
            emitEvent: ev => goalEvents.emit(ev as Parameters<typeof appendEvent>[2]),
          });
          if (decision.outcome) {
            // S10：BLOCKED 但已启动了托管模拟器 → **先落 session 再退出**，
            // 否则那个进程没有任何回收凭证，会一直挂到用户手动关闭。
            if (decision.managed) {
              writeDeviceSession(projectRoot, manifest.report_dir, {
                serial: decision.target?.serial || null,
                target_kind: 'emulator',
                started_by_run: manifest.run_id,
                managed: decision.managed,
                status: 'failed',
                note: decision.outcome.halt_guidance,
              });
            }
            halted = decision.outcome.halted;
            outcomes.push(decision.outcome as GoalPhaseOutcome);
            console.error(
              `\n===== ${decision.outcome.halt_reason} =====\n${decision.outcome.halt_guidance ?? ''}\n` +
                `${decision.notes.join('\n')}\n`,
            );
            break;
          }
          deviceEnv = decision.env ?? {};
          deviceKindThisPhase = decision.target?.targetKind ?? 'unknown';
          if (phase === ('testing' as FeaturePhase)) lastTestingTargetKind = deviceKindThisPhase;
          // 托管实例落 session 供回收（崩溃残留由下次启动/--resume 对账，见 device-session.ts）
          if (decision.managed && decision.target) {
            // P1（三轮 review）：session 是**单文件**模型——写新记录就覆盖旧记录。
            // 若旧记录指向另一个仍活着的实例，它的 pid 四元组会就此永久丢失
            //（当前 run 被 collectForeignManagedSessions 排除，退出清理只读最新 session）。
            // gate 在新建前已确认回收旧实例（reclaimManaged），此处再兜一道：
            // 覆盖前若发现旧记录是**不同的** pid，先尝试回收并留痕。
            const prior = reusableManaged;
            if (prior && prior.identity.pid !== decision.managed.pid) {
              const out = reclaimManagedDevice(
                {
                  schema_version: '1.0',
                  serial: prior.serial,
                  target_kind: 'emulator',
                  started_by_run: manifest.run_id,
                  managed: prior.identity,
                  status: 'ready',
                  updated_at: new Date().toISOString(),
                },
                defaultProcessProbe(),
              );
              // P1（四轮 review）：这道兜底**必须检查结果**，不能只记录。
              // `reclaimed`（已终止）与 `none`（进程本就不在）都表示没有遗留；
              // `refused` 说明那个进程还活着且不敢动——此时覆盖 session 就等于
              // 永久丢失它的回收凭证（当前 run 被 collectForeignManagedSessions 排除），
              // 只能 halt 求人。
              if (out.action === 'refused') {
                const detail =
                  `[device] 拒绝覆盖 device-session：旧托管实例 pid=${prior.identity.pid} ` +
                  `仍在运行且未能回收（${out.reason}）。覆盖会永久丢失它的回收凭证。\n` +
                  '  请手动结束该进程后重跑；或用 --resume 继续（届时会重新对账）。';
                console.error(`\n===== 设备会话冲突 =====\n${detail}\n`);
                halted = true;
                outcomes.push({
                  phase,
                  verdict: 'FAIL',
                  halted: true,
                  retries,
                  halt_reason: 'managed_device_session_conflict',
                  halt_guidance: detail,
                  // 与设备阻断同一契约：可 defer，指引指向"处理环境"而非"改代码"
                  blocking_class: 'externalBlocked',
                  failure_kind: 'device_blocked',
                } as GoalPhaseOutcome);
                break;
              }
              console.log(
                `[device] 覆盖 session 前处置旧托管实例 pid=${prior.identity.pid}：${out.action}`,
              );
            }
            writeDeviceSession(projectRoot, manifest.report_dir, {
              serial: decision.target.serial,
              target_kind: decision.target.targetKind,
              started_by_run: manifest.run_id,
              managed: decision.managed,
              status: 'ready',
            });
            // R10：注册信号/退出清理。只覆盖"进程还能执行代码"的退出路径；
            // 硬杀（SIGKILL/断电）由下次启动的对账回收兜底（见 run 启动处）。
            if (!releaseManagedDeviceCleanup) {
              releaseManagedDeviceCleanup = registerManagedDeviceCleanup(() => {
                const out = reclaimManagedDevice(
                  readDeviceSession(projectRoot, manifest.report_dir),
                  defaultProcessProbe(),
                );
                if (out.action === 'reclaimed') {
                  console.log(`[device] 信号退出：已回收托管模拟器（pid=${out.pid}）`);
                }
              });
            }
          }
        }

        // d9e4b7c1 T1：attempt 级 device-test 构建配置冻结。
        // resolveDeviceTestProduct/BuildMode 读进程 env（HARNESS_DEVICE_TEST_PRODUCT/
        // BUILD_MODE 是公开覆盖变量）——agent 子进程内临时覆盖不会传回 runner，生成物
        // 分类器若现场重解析会与 hvigor 实际生成漂移、复发误伤。此处解析一次冻结，经
        // deviceEnv 同发 agent 与 gate harness、直传分类器（三方同源）；agent 无视冻结
        // 值自行覆盖属不受支持行为，产物与冻结值不符 → violation（fail-closed 即正确
        // 语义）。generic profile 无 conventions 模块 → null（分类器同样不可用，行为
        // 与今日一致）。
        let frozenDeviceTest: { product: string; buildMode: 'debug' | 'release' } | null = null;
        // review P2：分类器/conventions 从**实际 resolvedProfile** 加载，不硬编码 hmos-app。
        // 复用 run 开始（manifest 建立时）解析的 resolvedProfile——单一 profile 判定时点；
        // 在此二次 loadResolvedProfile 会制造第二个时点，且 loader 失败回退 hmos-app，
        // 恰好复活"非 hmos profile 获得 hmos 源码例外"的可能。
        let testingProfileHarnessDir: string | null = null;
        if (!dryRun && phase === ('testing' as FeaturePhase)) {
          testingProfileHarnessDir = path.join(resolvedProfile.profileDir, 'harness');
          frozenDeviceTest = resolveFrozenDeviceTestConfig(projectRoot, testingProfileHarnessDir);
          if (frozenDeviceTest) {
            deviceEnv = {
              ...deviceEnv,
              HARNESS_DEVICE_TEST_PRODUCT: frozenDeviceTest.product,
              HARNESS_DEVICE_TEST_BUILD_MODE: frozenDeviceTest.buildMode,
            };
          }
        }

        progressSubstep = 'agent_invoke';
        // Every real phase invocation is bracketed by the same filesystem/hash
        // snapshot.  The comparison is pre/post invocation, never against HEAD,
        // so a pre-existing dirty file is not blamed on this phase.
        const preInvokeWriteSnap = !dryRun && !resumePostAgent
          ? capturePhaseInvocationSnapshot(phaseWriteBoundary)
          : null;
        if (preInvokeWriteSnap && !/^[0-9a-f]{64}$/.test(preInvokeWriteSnap.sha256)) {
          goalEvents.emit({
            type: 'phase_halt', phase, halt_reason: 'pre_invoke_snapshot_failed',
            reason: preInvokeWriteSnap.failureReason,
            probe: 'storage_ready',
            ...runDispositionFields(decide(
              { incident: 'pre_invoke_snapshot_failed', phase: String(phase), detail: preInvokeWriteSnap.failureReason ?? undefined },
              NO_AUTHORITY,
              { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
            )),
          });
          console.error(
            `\n===== pre_invoke_snapshot_failed =====\n`
            + `invoke 前快照失败：${preInvokeWriteSnap.failureReason ?? preInvokeWriteSnap.sha256}\n`
            + `没有可信基线不得调用 agent（phase 写归因无从谈起）。等待存储/目录条件恢复后由 probe 唤醒。\n`,
          );
          outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'pre_invoke_snapshot_failed' });
          halted = true;
          phaseDone = true;
          continue;
        }
        // adjudicated-repair-loop（review 修复，续）：resumePostAgent 已在 attempt 分配
        // 之前判定（见 totalTurns 前声明）——此处只保留 scaffold 跳过 + invoke_start 跳过。
        // openspec runner-owned-machine-facts：回执骨架由 runner 在**每次真实 invoke 前**
        // 单点 force 写入并预填本轮 attempt 身份——agent 只填自证字段，不抄写机器已知的
        // 身份值（宿主实锤 run 20260815T023016Z-8c66cf：agent 手抄 "3"≠"i3"；run
        // 20260816T071553Z-e72aee：coding 无 pass snapshot 时旧判据漏掉 force 重建，i4 身份
        // 存活到 i5）。force 同时作废上一 attempt 的旧回执：旧完整声明不得让本 attempt 被
        // 完成观测提前判完；agent 从内容轮起即见骨架，closure 可在同一 attempt 内完成
        // （testing 不再必然多跑一轮真机流水线）。位置刻意在 capability/device 等全部
        // 前置门**之后**、agent_invoke_start 之前——前置门 HALT（agent 未启动）时不得
        // 提前销毁旧回执现场（codex review）。写失败即停：不启动 agent、不烧 attempt——
        // 静默吞掉会让旧身份回执存活，receipt_attempt_identity 死结原样复发。
        if (!dryRun && goalTrack !== 'lite' && !resumePostAgent) {
          const scaffold = writeReceiptScaffold(projectRoot, manifest.feature, String(phase), {
            attemptId: visualAttemptId,
            force: true,
          });
          if (!scaffold.wrote) {
            const scaffoldFailure = scaffold.failure ?? '骨架未写入且无原因（框架缺陷）';
            goalEvents.emit({
              type: 'phase_halt',
              phase,
              halt_reason: 'receipt_scaffold_unwritable',
              detail: scaffoldFailure,
              probe: 'storage_ready',
              ...runDispositionFields(decide(
                { incident: 'receipt_scaffold_unwritable', phase: String(phase), detail: scaffoldFailure },
                NO_AUTHORITY,
                { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
              )),
            });
            console.error(
              `\n===== receipt_scaffold_unwritable =====\n${scaffoldFailure}\n`
              + '本轮回执骨架无法写入——不启动 agent（旧身份回执存活会复发 receipt_attempt_identity 死结）。\n'
              + '等待存储条件恢复后由 probe 唤醒。\n',
            );
            outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: 'receipt_scaffold_unwritable' });
            halted = true;
            phaseDone = true;
            continue;
          }
        }
        // adjudicated-repair-loop（review 修复，续）：伪造 invoke 对象仅承载「已完成」
        // 语义；settled 事件由 containmentCtx=null 天然不重复（此分支不发）。
        if (!resumePostAgent) {
          goalEvents.emit({
            type: 'agent_invoke_start',
            phase,
            invoke_id: invokeId,
            command: invokePlan.label,
            // P0-4：timeout 单一事实源——progress/status/dead-man 优先读本字段判 liveness
            // （升档后 manifest 静态解析会把合法运行 attempt 误报 STALLED，脑裂实锤）。
            effective_timeout_ms: effectiveAgentTimeoutMs,
          });
          flushProgress();
        } else {
          console.warn(
            `[goal-runner] resume 跳过 coding agent invoke（settled 在案，仅补验证/收尾）：phase=${phase}`,
          );
          flushProgress();
        }

        // P0-4 rev7：调用 adapter 前断言——0 传给 invoke timer = 关闭超时，结构性禁止。
        if (!(effectiveAgentTimeoutMs > 0)) {
          throw new Error(
            `[goal-runner] BUG: effectiveAgentTimeoutMs=${effectiveAgentTimeoutMs} 不得 ≤0 到达 adapter（zero-budget 应已在启动判据拦截）`,
          );
        }
        // t4：完成观测探针。invoke **之前**建基线——只认本次调用内"不完整→完整"的跃迁，
        // 否则 retry 遗留的上一轮 receipt 会被当作本轮完成。基线已完整时不做观测
        // （该情形应由上层判为"无需再调 agent"，而不是启动后立刻杀）。
        // f9c2e6b4 t1：跃迁之外再叠**本 attempt 新鲜度**（openspec/specs/goal-runner/spec.md:75
        // 本就要求）。立项事故：上一轮回执被原样复写 → 跃迁成立 → attempt 2/3 各活 35.3 秒
        // 就被 tree-kill，重试预算 90 秒烧光。身份用 run+phase+attempt 三元组（phase 已在
        // 采集侧校验），**不带 invoke_id**——它是 `${phase}-${attemptId}` 的派生值。
        const completion = dryRun
          ? null
          : createCompletionProbe({
              projectRoot,
              feature: manifest.feature,
              phase,
              invocation: {
                runId: manifest.run_id,
                attemptId: visualAttemptId,
                startedAtMs: Date.now(),
              },
            });
        // 【skip 机制已删除 · codex 收尾】runner 在 invoke 前对每轮 force 重建未完成
        // 骨架（上方单点写入），完成基线结构上恒不完整——"证据齐全即跳过"整链
        // （跳过判定、跳过观测事件、伪造 invoke 结果）成为不可达死代码，一并删除。
        // completion probe 保留唯一职责：观察本轮 agent 把骨架从未完成填成完整。
        assertGoalBoundary('phase_invoke');
        // t2（plan c6a9e4d2）：Windows containment 上下文——非 dry-run 的真实 headless
        // invoke 在 win32 上恒经 guardian（KILL_ON_JOB_CLOSE Job）启动（headless 即
        // unattended；attended/非 Windows 零变化）。身份 token=run_id/invoke_id。
        const guardianToken = `${manifest.run_id}/${invokeId}`;
        const containmentCtx =
          !dryRun && process.platform === 'win32' ? { runId: manifest.run_id, invokeId } : null;
        // t3（plan c6a9e4d2）：guardian 绑定状态——onActiveChild 落 agent_process_bound；
        // 身份不可得/argv 缺 token = 绑定失败（guardianBoundError），invoke 后按
        // containment 失败处置（fail-closed：绝不对外宣称已受控，也不按正常 invoke
        // 结果续跑）。P0-2 review：guardian 未证明消失（kill 失败/复验仍活）时置
        // guardianStillAlive——不得落 settled、不得继续下一 invoke（halt 阻断）。
        let guardianBoundError: string | null = null;
        let guardianStillAlive = false;
        let guardianPidForCheck = 0;
        const phaseExecutionContext = createPhaseExecutionContext({
          runId: manifest.run_id,
          feature: manifest.feature,
          workflowId: workflow.name,
          track: goalTrack,
          chain: chain.map(String),
          phase: String(phase),
          attemptId: visualAttemptId,
          owner: runControl
            ? { ...runControl.token, kind: runtimeOwnerKind }
            : { run_id: manifest.run_id, owner_id: 'dry-run', epoch: 0, kind: runtimeOwnerKind },
          projectRoot,
          frameworkRoot,
          runDir: path.resolve(projectRoot, manifest.report_dir),
          reportDir: manifest.report_dir,
          adapter: manifest.adapter ?? 'generic',
          adapterModel: manifest.adapter_model_pin?.value,
          instruction: prompt,
          runtimeFacts: {
            runBaseSha: manifest.run_base_sha,
            receiptRequired: goalTrack !== 'lite',
            resume: Boolean(argv.resume),
            successor: typeof manifest.successor_of === 'string',
          },
          childEnv: {
            MAISON_GOAL_RUN_ID: manifest.run_id,
            MAISON_GOAL_ATTEMPT: visualAttemptId,
            MAISON_GOAL_ATTEMPT_PHASE: String(phase),
            ...(manifest.adapter_model_pin
              ? { [MAISON_GOAL_MODEL_PIN_ENV]: manifest.adapter_model_pin.value }
              : {}),
            ...deviceEnv,
          },
        });
        let invoke = resumePostAgent
          ? ({
              exitCode: 0,
              timed_out: false,
              silent_killed: false,
              completion_observed: false,
              duration_ms: 0,
              stderr: '',
              stdout: '',
              command: '',
              skipped: true,
              kill_attempted: false,
              usage: null,
              signal: null,
            } as unknown as Awaited<ReturnType<InvokeAgentFn>>)
          : await new GoalPhaseRuntime().executeExecutor(
              phaseExecutionContext,
              attendedExecutor ?? new DetachedGoalPhaseExecutor(
            () => ({ plan: invokePlan, cwd: projectRoot, options: {
          dryRun,
          timeoutMs: effectiveAgentTimeoutMs,
          outputLogPath,
          // t4：确定性完成观测（与 settle/hard timeout/silent race）。判据注入自 runner，
          // 通用进程层不依赖 receipt schema。
          completionProbe: completion ? completion.probe : undefined,
          deadlineMs: Date.now() + effectiveAgentTimeoutMs,
          // t1（f7a3d9c2）：轮次身份注入——agent 会话内自跑 harness 与外层 gate 同轮
          // t3（device-readiness）：设备目标经 extraEnv 注入子进程，**不写全局 process.env**
          //（全局写会让多 phase/多 run 串 target——凭据/操作打到别人的手机上）
          extraEnv: { ...phaseExecutionContext.childEnv },
          // t3a：adapter 声明 structured_events 时三文件分流（events/stderr/人读投影）
          toolEventCapture: cap.capability?.tool_event_provenance ?? 'none',
          // t2：containment 上下文——仅在 win32 非 dry 时非空（agent-invoke 据此走
          // guardian 分支；非 Windows/attended 零变化）。
          containment: containmentCtx,
          // C-ab-eval：按 adapter goal_capability.usage_capture 声明采集（缺省 none → proxy）
          usageCapture: cap.capability?.usage_capture,
          onActiveChild: ({ pid, kill }) => {
            activeAgentKill = async () => {
              await kill();
            };
            // t3（plan c6a9e4d2）：guardian 绑定事件——invoke 开始即落
            // agent_process_bound（ManagedProcessIdentity 四元组逐字段复用：
            // pid + OS 启动时刻严格等值 + executable 绝对路径 + token 槽位）。
            // P0-2 review：身份读取做**有界重试**（CIM 存在数百毫秒可见延迟，
            // 首次探测可能暂不可见）；四元组完整性校验含 executable 绝对路径。
            // 二轮 review P0：绑定失败 → **同步** taskkill（不依赖异步 kill 承诺）
            // 并用**独立 PID existence 通道**（Get-Process，非 CIM）复验消失——
            // CIM identify 的 null 可能=暂不可见/查询失败，不得当作死亡证明；
            // 未证明消失置 guardianStillAlive（invoke 后阻断续跑，绝不落 settled）。
            if (containmentCtx && pid > 0) {
              guardianPidForCheck = pid;
              const identity = identifyWithRetry(pid, defaultProcessProbe());
              const executableOk = typeof identity?.executable === 'string'
                && identity.executable.trim().length > 0
                && /^[a-zA-Z]:[\\/]/.test(identity.executable.trim());
              if (!identity?.commandLine || !executableOk) {
                guardianBoundError =
                  `guardian(pid=${pid}) 身份不可得/命令行不可读/可执行文件非绝对路径——` +
                  'Windows containment 绑定失败，立即团灭并复验消失（fail-closed）';
                const killed = terminateGuardianProcessOnly(pid);
                const gone = awaitGuardianGone(pid);
                if (!killed || !gone) guardianStillAlive = true;
                return;
              }
              if (!identity.commandLine.includes(guardianToken)) {
                guardianBoundError =
                  `guardian(pid=${pid}) 命令行不含身份 token「${guardianToken}」——` +
                  '绑定失败，立即团灭并复验消失（fail-closed）';
                const killed = terminateGuardianProcessOnly(pid);
                const gone = awaitGuardianGone(pid);
                if (!killed || !gone) guardianStillAlive = true;
                return;
              }
              goalEvents.emit({
                type: 'agent_process_bound',
                phase,
                invoke_id: invokeId,
                run_id: manifest.run_id,
                pid,
                started_at_ms: identity.startedAtMs,
                executable: identity.executable,
                token: guardianToken,
              });
            }
          },
          onChildExit: () => {
            activeAgentKill = null;
          },
        } }),
                injectedInvokeAgent ?? invokeAgentHeadless,
              ),
            );

        if (!resumePostAgent && 'status' in invoke && invoke.status === 'waiting') {
          const waitingDetail = invoke.details ?? 'attended executor is waiting for external input';
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: 'executor_waiting',
            detail: waitingDetail.slice(0, 1000),
            owner_kind: runtimeOwnerKind,
          });
          outcomes.push({
            phase,
            verdict: 'INCOMPLETE',
            halted: true,
            retries,
            halt_reason: 'executor_waiting',
          });
          halted = true;
          phaseDone = true;
          continue;
        }

        // t2 fail-closed：containment 绑定失败的 invoke 结果不得按正常结果续跑——
        // 覆盖为失败（exit 1 + 诊断附 stderr；timed_out/completion 等成功性标记清除）。
        if (guardianBoundError) {
          const diag = `\n[maison-guardian] ${guardianBoundError}`;
          invoke = {
            ...invoke,
            exitCode: 1,
            timed_out: undefined,
            silent_killed: undefined,
            completion_observed: undefined,
            stderr: `${(invoke.stderr ?? '').slice(-4096)}${diag}`,
          };
        }
        // P0-2（review）：绑定失败且 guardian **未证明消失**（kill 失败/复验仍活）——
        // 旧 guardian/agent 仍在野跑且无身份记录可接管：不得落 settled、不得继续下一
        // invoke。halt 阻断（fail-closed；真冲突求人，不自动清理）。
        if (guardianBoundError && guardianStillAlive) {
          const detailMsg =
            `guardian(pid=${guardianPidForCheck}) 绑定失败且未证明消失——` +
            '旧 agent 无 Job 契约仍在野，halt 阻断续跑（真冲突勿自动覆盖）。' +
            `原始失败：${guardianBoundError}`;
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: 'agent_containment_unresolved',
            detail: detailMsg.slice(0, 1000),
            ...runDispositionFields(decide(
              { incident: 'agent_containment_unresolved', phase: String(phase), detail: detailMsg },
              NO_AUTHORITY,
              { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
            )),
          });
          console.error(`\n===== agent_containment_unresolved =====\n${detailMsg}\n`);
          outcomes.push({
            phase, verdict: 'FAIL', halted: true, retries,
            halt_reason: 'agent_containment_unresolved',
          });
          halted = true;
          phaseDone = true;
          continue;
        }

        // adjudicated-repair-loop：resumePostAgent（验证边界恢复）不发 invoke_end——
        // 原 settled invocation 的 invoke_end 已在盘上，伪造 invoke 不得再落一条。
        if (!resumePostAgent) {
          goalEvents.emit({
            type: 'agent_invoke_end',
          phase,
          invoke_id: invokeId,
          exit_code: invoke.exitCode,
          skipped: invoke.skipped,
          command: invoke.command,
          duration_ms: invoke.duration_ms,
          timed_out: invoke.timed_out,
          silent_killed: invoke.silent_killed,
          // plan e6b3f8d2 t1：adapter terminal 契约事实。
          // · terminal_failure_observed —— codex `turn.failed`（失败终态，与
          //   completion_observed 互斥；exit 0 已在 invoke 边界规范化为非零）。
          // · terminal_error_excerpt —— `turn.failed` 正文 + 顶层 `error` 事件的**纯诊断**
          //   摘要。error 不是契约终态（error→重试成功→turn.completed 合法），因此它
          //   **不进** api_disconnected / failure classifier / retry 任何判据，只在此留痕。
          terminal_failure_observed: invoke.terminal_failure_observed,
          terminal_error_excerpt: invoke.terminal_error_excerpt,
          lingering_pipe: invoke.lingering_pipe,
          // plan d7f3a9c4 t4：spawn race 结构化事实进事件（诊断保真；不改变任何裁决）。
          ...(invoke.spawn_error ? { spawn_error: invoke.spawn_error } : {}),
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
        }
        // t3（plan c6a9e4d2）：invoke 收尾落 settled 事件——在 agent_invoke_end 之后
        // 追加（run 结束/接管对账据其闭合 invoke，恢复决策永不用 report）。
        // P0-2（review）：仅**绑定成功**才落 settled——绑定失败且 guardian 未证明消失
        // 时不得声称已收纳（上方已 halt 阻断，本分支不可达；此处条件为结构保障）。
        // adjudicated-repair-loop：resumePostAgent（跳过已 settled 的 agent）不重复 emit
        // settled——原 settled invocation 的事件已在盘上，伪造 invoke 不得再落一个。
        if (containmentCtx && !guardianBoundError && !resumePostAgent) {
          goalEvents.emit({
            type: 'agent_process_settled',
            phase,
            invoke_id: invokeId,
            run_id: manifest.run_id,
            exit_code: invoke.exitCode,
            // adjudicated-repair-loop：settled 承载超时/杀语义——resume 恢复判定据此
            // 区分「已完成」（可跳过 agent）与「超时半成品」（须重新 invoke）
            ...(invoke.timed_out === true ? { timed_out: true as const, kill_reason: 'agent_timeout' as const } : {}),
          });
        }

        // ===================================================================
        // plan c4e8a1f7 T1a：正式 phase invoke 硬失败早停（harness 前）
        // -------------------------------------------------------------------
        // 共享分类（resolveInvokeHardCliFailure）覆盖：child spawn race / guardian
        // containment 建立失败 / CLI·config 参数不兼容 / Codex 模型兼容 400。命中 =
        // agent 根本没有执行任务——缺产物只是症状：不得用 harness 的 spec_file_exists
        // 覆盖真实原因，也不得消耗内容 retry。incident 登记为 external。
        // 普通 agent 内容失败（含无 guardian 诊断的 exit 2）保持既有 harness/retry。
        if (!dryRun && !resumePostAgent) {
          const hardCli = resolveInvokeHardCliFailure({
            exitCode: invoke.exitCode,
            timed_out: invoke.timed_out,
            silent_killed: invoke.silent_killed,
            skipped: invoke.skipped,
            stdout: invoke.stdout ?? '',
            stderr: invoke.stderr ?? '',
            ...(invoke.spawn_error ? { spawn_error: invoke.spawn_error } : {}),
          }, { formalInvoke: true });
          if (hardCli) {
            const guidance =
              `正式 phase invoke 遇 CLI/guardian 硬失败（非需求代码，agent 未执行任务）：${hardCli}\n` +
              '这是 CLI 版本/兼容性、配置、参数或 Windows containment 建立问题——请核对 adapter ' +
              '版本/配置/环境后重跑；不是需求或产品代码问题，本轮不进入 gate harness、不消耗内容重试。';
            goalEvents.emit({
              type: 'phase_halt',
              phase,
              halt_reason: 'adapter_cli_hard_failure',
              verdict: 'FAIL',
              reason: hardCli,
              halt_guidance: guidance,
              ...runDispositionFields(decide(
                { incident: 'adapter_cli_hard_failure', phase: String(phase), detail: hardCli },
                NO_AUTHORITY,
                { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
              )),
            });
            console.error(`\n===== adapter_cli_hard_failure =====\n${guidance}\n`);
            outcomes.push({
              phase, verdict: 'FAIL', halted: true, retries,
              halt_reason: 'adapter_cli_hard_failure',
              halt_guidance: guidance,
              agent_exit_code: invoke.exitCode,
              failure_kind_classified: 'external',
            });
            halted = true;
            phaseDone = true;
            continue;
          }
        }

        // P1-9（plan 7c4f2e9b）：模型身份 telemetry——共享 parser 读**纯 events 文件**的
        // init 事件，append-only 新事件承载；不回写冻结 manifest / 不改 run 前 adapter_probe
        // / 不为 telemetry 造 capability receipt / 不参与能力真值与任何策略分支。
        // plan d7f3a9c4 t3：**只加一条**——pin 在场时把既有 observedModel 与 pin 比对，
        // 失配 emit `pin_verify_mismatch` 告警注记（投影 goal-report）。判定走共享纯函数
        // resolvePinVerifyMismatch（不改 manifest/verdict/routing/capability，warning-only）。
        if (!dryRun && (cap.capability?.tool_event_provenance ?? 'none') === 'structured_events') {
          try {
            const eventsAbsForModel = agentEventsLogPath(outputLogPath);
            const observedModel = fs.existsSync(eventsAbsForModel)
              ? parseClaudeInitModel(fs.readFileSync(eventsAbsForModel, 'utf-8'))
              : null;
            if (observedModel) {
              goalEvents.emit({
                type: 'adapter_model_observed',
                phase,
                invoke_id: invokeId,
                adapter: manifest.adapter ?? 'generic',
                model: observedModel,
                source: 'structured_event_init',
              });
              const mismatch = resolvePinVerifyMismatch({
                pin: manifest.adapter_model_pin?.value,
                observed: observedModel,
              });
              if (mismatch) {
                goalEvents.emit({
                  type: 'pin_verify_mismatch',
                  phase,
                  invoke_id: invokeId,
                  adapter: manifest.adapter ?? 'generic',
                  pin: mismatch.pin,
                  observed: mismatch.observed,
                });
                console.warn(
                  `[goal-runner] ⚠ adapter_model_observed=${mismatch.observed} ≠ adapter_model_pin=${mismatch.pin}（phase=${phase}）——` +
                    '仅告警，不影响 verdict/路由/能力判定；请核对自报是否被并发窗口切走。',
                );
              }
            }
          } catch { /* telemetry 缺失不阻断 */ }
        }
        flushProgress();

        // Generic phase write attribution.  It runs before critic receipts,
        // journal replay and gate execution, so evidence from a violating
        // invocation can never become trusted.
        if (preInvokeWriteSnap) {
          const postInvokeWriteSnap = capturePhaseInvocationSnapshot(phaseWriteBoundary);
          const snapshotDiff = diffPhaseInvocationSnapshots(preInvokeWriteSnap, postInvokeWriteSnap);
          if (snapshotDiff.kind === 'unverifiable') {
            const detail = `invoke 后写归因快照不可核实：${snapshotDiff.reason}`;
            goalEvents.emit({ type: 'phase_halt', phase, halt_reason: 'post_invoke_snapshot_failed', detail });
            outcomes.push({
              phase, verdict: 'FAIL', halted: true, retries,
              halt_reason: 'post_invoke_snapshot_failed', halt_guidance: detail,
            });
            console.error(`\n===== post_invoke_snapshot_failed =====\n${detail}\n`);
            halted = true;
            phaseDone = true;
            continue;
          }
          if (snapshotDiff.kind === 'changed') {
            let attributableChanges: PhaseInvocationChange[] = [...snapshotDiff.changes];
            if (phase === 'testing') {
              const generatedPartition = partitionGeneratedSourceChanges(
                projectRoot,
                attributableChanges.map(({ path: changedPath, how }) => ({ path: changedPath, how })),
                frozenDeviceTest,
                testingProfileHarnessDir,
              );
              if (generatedPartition.generated.length > 0) {
                const generatedSet = new Set(generatedPartition.generated);
                attributableChanges = attributableChanges.filter((change) => !generatedSet.has(change.path));
                goalEvents.emit({
                  type: 'testing_generated_file_change',
                  phase,
                  invoke_id: invokeId,
                  files: generatedPartition.generated.slice(0, 50),
                  count: generatedPartition.generated.length,
                  product: frozenDeviceTest?.product,
                  build_mode: frozenDeviceTest?.buildMode,
                });
              }
            }
            const classifiedWrites = classifyPhaseInvocationChanges(
              phaseWriteBoundary,
              String(phase),
              attributableChanges,
            );
            if (classifiedWrites.violations.length > 0) {
              const violationFacts = classifiedWrites.violations.map((violation) => ({
                path: violation.path,
                how: violation.how,
                owner: violation.owner,
                owner_candidates: violation.ownerCandidates,
                violation: violation.violation,
                pre_sha256: violation.preSha256,
                post_sha256: violation.postSha256,
                roles: violation.roles,
              }));
              const violationFingerprint = createHash('sha256')
                .update(stableStringify({ phase: String(phase), violations: violationFacts }), 'utf8')
                .digest('hex');
              const repeated = loadAuthoritativeEvents(eventsPath).some((event) =>
                event.type === 'phase_write_violation' &&
                (event as { fingerprint?: string }).fingerprint === violationFingerprint);
              goalEvents.emit({
                type: 'phase_write_violation',
                phase,
                recovery_reason: 'phase_write_violation',
                invoke_id: invokeId,
                fingerprint: violationFingerprint,
                violations: violationFacts.slice(0, 50),
                changed_count: violationFacts.length,
                pre_snapshot: preInvokeWriteSnap.sha256,
                post_snapshot: postInvokeWriteSnap.sha256,
              });

              const allUniquelyOwned = classifiedWrites.violations.every((violation) =>
                violation.status === 'unique' && violation.owner !== null);
              const owners = [...new Set(classifiedWrites.violations
                .map((violation) => violation.owner)
                .filter((owner): owner is string => owner !== null))];
              const targetOwner = owners.sort((a, b) =>
                fullWorkflowChain.indexOf(a as FeaturePhase) - fullWorkflowChain.indexOf(b as FeaturePhase))[0] ?? null;
              const targetIdx = targetOwner ? chain.indexOf(targetOwner as FeaturePhase) : -1;
              let haltReason: string | null = null;
              if (repeated) haltReason = 'phase_write_violation_repeat';
              else if (!allUniquelyOwned) haltReason = 'phase_write_owner_unresolved';
              else if (targetIdx < 0 || targetIdx >= phaseIdx) haltReason = 'backtrack_target_absent';
              else if (backtracksUsed >= DEFAULT_MAX_BACKTRACKS) haltReason = 'backtrack_limit';

              if (haltReason) {
                const detail =
                  `phase=${phase}; target=${targetOwner ?? 'unresolved'}; ` +
                  violationFacts.map((fact) =>
                    `${fact.path}:${fact.violation}:${fact.owner ?? (fact.owner_candidates.join('|') || 'none')}`).join('；');
                goalEvents.emit({
                  type: 'phase_halt', phase, halt_reason: haltReason,
                  recovery_reason: haltReason,
                  owner_phase: targetOwner,
                  fingerprint: violationFingerprint,
                  backtracks_used: backtracksUsed,
                  backtracks_limit: DEFAULT_MAX_BACKTRACKS,
                  detail,
                });
                outcomes.push({ phase, verdict: 'FAIL', halted: true, retries, halt_reason: haltReason, halt_guidance: detail });
                console.error(`\n===== ${haltReason} =====\n${detail}\n`);
                halted = true;
                phaseDone = true;
                continue;
              }

              backtracksUsed++;
              const invalidated = chain.slice(targetIdx, phaseIdx + 1).map(String);
              const txId = `${manifest.run_id}-writebt${backtracksUsed}`;
              goalEvents.emit({
                type: 'phase_backtrack_requested',
                phase: String(phase),
                from_phase: String(phase),
                to_phase: targetOwner,
                invalidated_phases: invalidated,
                invoke_id: invokeId,
                reason: 'phase_write_violation',
                authorized: false,
                files: violationFacts.map((fact) => fact.path).slice(0, 20),
                fingerprint: violationFingerprint,
                backtracks_used: backtracksUsed,
                backtracks_limit: DEFAULT_MAX_BACKTRACKS,
                invalidation_tx_id: txId,
              });
              goalEvents.emit({ type: 'phase_backtrack_started', to_phase: targetOwner });
              outcomes = outcomes.filter((outcome) => !invalidated.includes(String(outcome.phase)));
              backtrackReviewFocus = [];
              backtrackCodingContext = [];
              backtrackRepairCandidates = [];
              phaseWriteRecoveryContext = {
                targetPhase: targetOwner!,
                sourcePhase: String(phase),
                files: sanitizeScopeReplanFiles(
                  projectRoot,
                  violationFacts.map((fact) => fact.path).slice(0, 20),
                ),
              };
              pendingBacktrackCompletion = {
                toPhase: targetOwner!,
                signalDriven: false,
                preSnapshot: null,
              };
              phaseIdx = targetIdx - 1;
              phaseDone = true;
              console.error(
                `\n===== phase_write_violation =====\n`
                + `${phase} 改写了非本阶段产物；字节保留为未受信输入，本轮证据作废。\n`
                + violationFacts.slice(0, 20).map((fact) =>
                  `  - ${fact.path} owner=${fact.owner} pre=${fact.pre_sha256 ?? 'missing'} post=${fact.post_sha256 ?? 'missing'}`).join('\n')
                + `\n→ 自动回退 ${targetOwner} 全量重验并重签（${backtracksUsed}/${DEFAULT_MAX_BACKTRACKS}）。\n`,
              );
              if (featureLock) touchLock(featureLock.path, featureLock.ownerId);
              continue;
            }
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
          goalEvents.emit({
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
            goalEvents.emit({
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

        // visual-capability-truth S3（路径 B 判卷，plan c4e8a1f7 T3）：inline canary 答卷
        // → 签发/拒签 invocation_bound receipt。未答/答错/CANNOT_SEE_IMAGE → 不签
        // （能力停留 run_probed，vl_multimodal 终签自然被拒）——不阻断 phase，走盲档工作法。
        // 判卷 SSOT 统一复用 resolveCanaryCacheDecision/parseCanaryAnswer（不再保留
        // isCanaryAnswerComplete + classifyCanaryResponse(raw) 分叉）：
        //  · structured adapter 从**纯 agent-events.jsonl** 的终态 result 语义取答卷
        //    （parseCanaryAnswer 内部做信封投影；events 缺失/无终态 → 不判卷不签发）；
        //  · 非结构化 adapter **只消费本次 invoke 的 stdout** 与 exitCode/timed_out/
        //    silent_killed/skipped 事实——不读 stderr、prompt echo、人读混合日志
        //    （旧实现读整份 agent-output.log，prompt 自带 CANNOT_SEE_IMAGE 污染判卷，
        //    宿主 run 20260823T161102Z-68480b 三轮拒签实锤）。
        if (!dryRun && phase === 'spec' && inlineCanaryKey) {
          try {
            // plan e6b3f8d2 t1：信封方言分派。claude 家族走三文件分流的 agent-events.jsonl；
            // codex 的 JSONL 就在本次 invoke 的 stdout 上（tool_event_provenance 仍是 none，
            // 不产 agent-events.jsonl——**terminal 事件流 ≠ 工具证据流**，不得混用）。
            const canaryEnvelope = resolveCanaryStdoutEnvelope(
              manifest.adapter ?? 'generic',
              cap.capability?.tool_event_provenance,
            );
            const structuredStdout = canaryEnvelope !== 'none';
            let decisionStdout = '';
            if (canaryEnvelope === 'claude_stream_json') {
              const eventsAbs = agentEventsLogPath(outputLogPath);
              const eventsRaw = fs.existsSync(eventsAbs) ? fs.readFileSync(eventsAbs, 'utf-8') : '';
              decisionStdout = eventsRaw;
              if (!decisionStdout) {
                console.log('[S3] inline canary：agent-events.jsonl 缺失/为空（断流?）——不判卷不签发');
              }
            } else {
              // 非结构化：本次 invocation 的 stdout 事实（内存保留 64KB 上限，答卷足够）。
              decisionStdout = invoke.stdout ?? '';
            }
            let issued = false;
            if (decisionStdout) {
              const decision = resolveCanaryCacheDecision({
                stdout: decisionStdout,
                exitCode: invoke.exitCode,
                timed_out: invoke.timed_out,
                silent_killed: invoke.silent_killed,
                skipped: invoke.skipped,
                structured_stdout: structuredStdout,
                ...(structuredStdout ? { structured_stdout_format: canaryEnvelope } : {}),
              }, inlineCanaryKey);
              if (decision.kind === 'valid' && decision.classify.verdict === 'tool_read') {
                writeCapabilityReceipt(projectRoot, manifest.feature, {
                  adapter: manifest.adapter ?? 'generic',
                  run_id: manifest.run_id,
                  invoke_id: invokeId,
                  binding_path: 'inline_canary',
                  verdict: 'tool_read',
                  model: 'unknown',
                });
                issued = true;
              } else {
                console.log(
                  `[S3] inline canary 未通过/未作答（${decision.kind === 'valid' ? `verdict=${decision.classify.verdict}` : decision.detail}）——` +
                    'invocation_bound 不签发（vl_multimodal 终签将被拒，走盲档/能力路由）',
                );
              }
            }
            goalEvents.emit({
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
              console.log('[S3] inline canary 未通过/未作答——invocation_bound 不签发（vl_multimodal 终签将被拒，走盲档/能力路由）');
            }
          } catch (e) {
            console.warn(`[S3] inline canary 判卷异常（不签发，不阻断）：${(e as Error).message}`);
          }
        }

        // visual-capability-truth S3：spec 期参考图验读回执——vl_multimodal 终签的证据面
        // （canary 只证能看测试图；本回执证"逐张读过本需求参考图"）。无解析器 adapter →
        // 不产出 → 终签结构性被拒（正是 20260718 cursor 自签形态的解药）。
        // plan c4e8a1f7 T2：期望分母=共享发现集合（正文显式 ∪ source 直接父目录；仅空集
        // 回退 ux-reference）——不再从 agent 产出的 spec.md 自算较小分母（宿主实锤：spec
        // 漏一张回执分母跟着缩水，无法证明 runner 发现的全集均已建模/验读）。
        if (!dryRun && phase === 'spec' && (cap.capability?.tool_event_provenance ?? 'none') === 'structured_events') {
          try {
            const refAbsPaths = resolveRequirementReferenceImages(
              projectRoot,
              manifest.feature,
              manifest.requirement,
              { requirementSourceFiles: manifest.requirement_source_files },
            );
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
              goalEvents.emit({
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
        // T4：污染轮次不收编——journal proposal 留在 run 目录内作 audit，不进正式账本
        if (!dryRun && phase === 'testing') {
          try {
            const replay = replayJournalIntoLedger({
              ledgerPath: visualRoundsLedgerPath(projectRoot, manifest.feature),
              journalPath: intermediateRoundsJournalPath(projectRoot, manifest.feature, manifest.run_id),
              attemptId: visualAttemptId,
              runId: manifest.run_id,
            });
            for (const row of replay.committed) {
              goalEvents.emit({
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
            goalEvents.emit({
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

        // 【pass snapshot 冻结差异判定已退役】closure 轮改产物的硬约束由完整 harness
        // 重验承担：改坏=FAIL 回内容轮；改了仍合法=当前字节重新过全部门禁并进 closure
        // manifest。快照 diff/丢弃/责任重跑整链删除（runner-owned-machine-facts）。

        // P0-4 rev6：harness 启动判据——扣除收尾预留后的可用预算 ≤0 即不 spawn，直接
        // budget_wall_clock 终局（"原始 remaining>0 但扣 reserve 后 ≤0"也不 spawn；
        // 不产半份 harness 证据，绝不把 0 传给 timer）。
        const availableForHarnessMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
        if (!dryRun && availableForHarnessMs <= 0) {
          halted = true;
          goalEvents.emit({ type: 'budget_wall_clock', phase });
          const wallGuidance = emitWallBudgetHaltGuidance(String(phase));
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: 'budget_wall_clock',
            halt_guidance: wallGuidance,
            agent_exit_code: invoke.exitCode,
            agent_timed_out: invoke.timed_out,
          });
          phaseDone = true;
          break;
        }

        progressSubstep = 'harness';
        // d9e4b7c1 T2：goal 正式 testing gate 的两项前置——
        //   ① pre-delete evidence（防伪最小化：agent 已于 invoke 结束退出，harness 结束后
        //     文件存在且身份匹配 = gate 所写；不引入 nonce/账本）；
        //   ② 强制安装 flag（复用既有 HARNESS_DEVICE_TEST_FORCE_INSTALL）**只注入 gate
        //     harness env**——agent 自检与普通模式保留既有 install reuse，零变化。
        let gateDeviceEnv = deviceEnv;
        if (!dryRun && phase === ('testing' as FeaturePhase)) {
          try {
            fs.rmSync(
              deviceTestEvidencePath(
                featurePhaseReportsDir(projectRoot, manifest.feature, String(phase), frameworkRoot),
              ),
              { force: true },
            );
          } catch { /* 不存在/不可删都不阻断——collector 侧身份校验兜底 */ }
          gateDeviceEnv = { ...deviceEnv, HARNESS_DEVICE_TEST_FORCE_INSTALL: '1' };
        }
        // d9e4b7c1 T2：attempt 的 harness 窗口（written_at/run meta 时间窗裁决的数据源）
        const harnessStartedAtMs = Date.now();
        assertGoalBoundary('harness_invoke');
        goalEvents.emit({
          type: 'harness_start',
          phase,
          // P0-1 rev6：attempt 窗口按 invoke_id 精确切分（continuation 五态派生消费）。
          invoke_id: invokeId,
        });
        flushProgress();

        // b3e8d4c7 t5④（codex P1 补齐）：**agent 返回后、harness 之前**再检一次 plan 授权面。
        // 只做 spawn 前那一次不够——coding agent 若在本轮改了 plan.md / contracts.yaml，
        // 而 coding gate 仍 PASS，就会带着漂移的授权面直接 advance 到 review。gate 跑之前
        // 拦截，本轮产出不予采信（"不立即获得权限，但触发同一个自动 replan"）。
        if (runPlanAuthorityGate('post_agent')) {
          phaseDone = true;
          if (featureLock) touchLock(featureLock.path, featureLock.ownerId);
          continue;
        }

        // adjudicated-repair-loop M1（review 修复）：no-op 判定的 post 快照**在 agent 退出后、
        // gate harness 运行前**拍摄——harness 的 hvigor 构建会重写生成物（BuildProfile.ets 等），
        // 若等 harness 结束后再拍，pre≠post 几乎必然（构建副作用污染），no-op 判定形同虚设。
        // 判定结果暂存，completed 补发点（summary 后）据此决策：noop → 停等；否则全量继续。
        let pendingNoopResult: 'noop' | 'changed' | null = null;
        if (
          !dryRun &&
          pendingBacktrackCompletion &&
          phase === pendingBacktrackCompletion.toPhase &&
          pendingBacktrackCompletion.signalDriven &&
          pendingBacktrackCompletion.preSnapshot &&
          isUsableSnapshot(pendingBacktrackCompletion.preSnapshot.sha256)
        ) {
          const postNoopSnapshot = computeProductSourceSnapshotDetail(
            projectRoot, productLayerDirsOf(projectRoot), manifest.feature,
          );
          pendingNoopResult =
            isUsableSnapshot(postNoopSnapshot.sha256) &&
            postNoopSnapshot.sha256 === pendingBacktrackCompletion.preSnapshot.sha256
              ? 'noop'
              : 'changed'; // 含快照不可核实 → fail-closed 回落全量
        }

        const harnessRun = await runHarnessPhase(
          projectRoot,
          frameworkRoot,
          phase,
          manifest.feature,
          dryRun,
          manifest,
          { runId: manifest.run_id, attemptId: visualAttemptId },
          availableForHarnessMs,
          // P0-3：把本 attempt 冻结的设备目标一并给外层 gate harness——
          // 否则多设备时它退回 hdc 默认目标，跑在与就绪门冻结的不同设备上。
          // b3e8d4c7 t4：**scope 内存锚同路透传**。ui-scope-gate 此前用
          // expectedAnchor=null 加载 plan 快照，于是 agent 自建的 epoch/head 也被当授权面
          // （宿主实锤：agent 自调 takePassSnapshot 造 epoch 2，scope 门禁随之消失）。
          // 锚只给 gate harness，**不进 agent env**——信任材料不下发。
          // runner-owned-machine-facts 裁剪：快照锚 env 注入已退役——ui-scope-gate 白名单
          // 校验源改为 plan closure 的 evidence manifest（盘上自证，无需跨进程锚）。
          { ...gateDeviceEnv },
        );
        const harnessExit = harnessRun.exitCode;
        const harnessEndedAtMs = Date.now();
        priorHarnessFailure = harnessExit === 0
          ? undefined
          : formatHarnessFailureTail(harnessRun.outputTail);

        goalEvents.emit({
          type: 'harness_end',
          phase,
          exit_code: harnessExit,
          invoke_id: invokeId,
          // P0-4 rev6：wall 树杀与门禁真失败分开承载（exit_code=1 二义）。
          timed_out: harnessRun.timedOut || undefined,
        });
        flushProgress();

        // P0-4 rev6：harness 被 wall 杀 → 直接 budget_wall_clock 终局，**不读取/归因可能
        // 只写了一半的 summary**（半份证据比无证据更毒）。
        if (harnessRun.timedOut) {
          halted = true;
          goalEvents.emit({ type: 'budget_wall_clock', phase });
          const wallGuidance = emitWallBudgetHaltGuidance(String(phase));
          outcomes.push({
            phase,
            verdict: 'FAIL',
            halted: true,
            retries,
            halt_reason: 'budget_wall_clock',
            halt_guidance: wallGuidance,
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

        // M1 t1.5/t1.6（adjudicated-repair-loop，review 修复）：回退链完成收口——补发
        // phase_backtrack_completed（移到回退链真正完成之后，修 :7592 时序；repair/scope
        // 路径统一在此补发）。no-op 判定用 **harness 之前** 拍好的 pendingNoopResult
        //（agent 退出即拍——不被 gate harness 的构建生成物污染）：
        //  · 'noop' → 不重跑下游，completed.result='noop'，候选并入 attempted（settled 已
        //    触发回放）→ 空 eligible 停等 repair_not_converging；
        //  · 'changed' / null（非 signalDriven / 快照不可核实）→ fail-closed 回落现行全量。
        if (!dryRun && pendingBacktrackCompletion && phase === pendingBacktrackCompletion.toPhase) {
          const executed = invoke.exitCode !== undefined || invoke.completion_observed === true;
          if (executed) {
            const { toPhase, signalDriven, preSnapshot, requiresCommittedClosure } = pendingBacktrackCompletion;
            if (pendingNoopResult === 'noop' && signalDriven && preSnapshot) {
              // no-op：零改动只证明修复无效、不证明候选已解决；不复用下游 closure 继续。
              goalEvents.emit({
                type: 'phase_backtrack_completed', to_phase: toPhase, result: 'noop',
                pre_snapshot: preSnapshot.sha256,
                post_snapshot: preSnapshot.sha256,
              });
              const noopGuidance = [
                '===== repair_not_converging（no-op）=====',
                `feature=${manifest.feature} run_id=${manifest.run_id} phase=${phase}`,
                `回退目标 ${toPhase} 执行后产品源码/需求 SSOT/根构建配置快照 pre/post 完全一致` +
                  '（pre-existing dirty 合法，本 invocation 零改动）——本次修复为 no-op。',
                '零改动只证明修复无效、不证明候选已解决：不再重跑下游、候选已计入 attempted',
                '（累计 one-shot），本 run 诚实终止。只有新的机器证据形成新 candidate identity，',
                '或 successor run 以新 run identity/预算全量重验后才能继续；manual resume/人签不改写结论。',
              ].join('\n');
              goalEvents.emit({
                type: 'phase_halt', phase, halt_reason: 'repair_not_converging',
                detail: 'backtrack no-op（快照 pre/post 相等）',
                halt_guidance: noopGuidance,
                ...runDispositionFields(decide(
                  { incident: 'repair_not_converging', phase: String(phase) },
                  NO_AUTHORITY,
                  { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
                )),
              });
              console.error(`\n===== repair_not_converging =====\n${noopGuidance}\n`);
              outcomes.push({
                phase, verdict: 'FAIL', halted: true, retries,
                halt_reason: 'repair_not_converging', halt_guidance: noopGuidance,
              });
              halted = true;
              phaseDone = true;
              pendingBacktrackCompletion = null;
              break;
            }
            // 普通回退仍以 owner 执行完成为 completed；legacy fidelity 恢复必须等下面的
            // receipt validation + finalizePhaseClosure 真正提交 owner closure 后再发。
            if (!requiresCommittedClosure) {
              goalEvents.emit({ type: 'phase_backtrack_completed', to_phase: toPhase });
              pendingBacktrackCompletion = null;
            }
          }
        }

        // 当前 attempt 的视觉/历史 bounded device 缺陷在 closure 前收集；native
        // CaseResult failure routing 已由 testing summary writer 直接物化到同一
        // repair_candidates，identity receipt 不复制 native case/step 状态。
        const actionableResult: ActionableCollectResult =
          !dryRun && phase === 'testing'
            ? collectActionableDefects(projectRoot, manifest.feature, manifest.run_id, {
                attemptId: visualAttemptId,
                expectedTarget: {
                  serial: deviceEnv.HARNESS_HDC_TARGET ?? null,
                  target_kind: deviceEnv.MAISON_DEVICE_TARGET_KIND ?? null,
                  session_id: deviceEnv.MAISON_DEVICE_SESSION_ID ?? null,
                },
                harnessWindow: { startMs: harnessStartedAtMs, endMs: harnessEndedAtMs },
                reportsDir: featurePhaseReportsDir(
                  projectRoot, manifest.feature, String(phase), frameworkRoot,
                ),
              })
            : { defects: [], unverified: [] };
        // P0-5（plan 7c4f2e9b）：in-flow 探针结果 hoist——closure_kind 分类 fresh 路径
        // 复用本次控制流已取得的 receiptValidation，不重复 spawn（codex 五轮）。
        let inFlowReceiptValidation: ReturnType<typeof tryValidateReceipt> | null = null;
        let closureFinalizationError: string | null = null;
        let phaseClosureCommitted = false;
        if (!dryRun && freshSummary && summary?.verdict === 'PASS') {
          const harnessRoot = path.join(frameworkRoot, 'harness');
          const receiptValidation = (injectedValidateReceipt ?? tryValidateReceipt)(
            harnessRoot,
            projectRoot,
            phase,
            manifest.feature,
            // b3e8d4c7 t1：权威路径与 agent 路径执行同一套 goal 门禁
            { goalIdentity: { runId: manifest.run_id, attemptId: visualAttemptId, attemptPhase: String(phase),
              // plan d7f3a9c4 t3：check-receipt 子进程同链透传 model pin。
              ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}) } },
          );
          inFlowReceiptValidation = receiptValidation;
          if (receiptValidation.status === 'passed') {
            assertGoalBoundary('closure_finalizer');
            try {
              finalizePhaseClosure({
              projectRoot,
              frameworkRoot,
              feature: manifest.feature,
              phase,
              receipt: { ...receiptValidation, status: 'passed' },
              goalRunId: manifest.run_id,
              goalAttemptId: visualAttemptId,
              blockerCount: summary?.blockers?.length ?? 0,
              persistPhaseState: () =>
                syncPhaseStateOnReceiptPassStrict(
                  projectRoot,
                  manifest.feature,
                  phase,
                  receiptValidation,
                  {
                    blocker_count: summary?.blockers?.length ?? 0,
                    frameworkRoot,
                  },
                ),
              });
              phaseClosureCommitted = true;
            } catch (error) {
              closureFinalizationError = (error as Error).message;
              console.error(
                `\n===== closure_finalization_failed =====\n${closureFinalizationError}\n`,
              );
            }
          } else {
            // codex review（回归三轮）：receipt 校验未过时把真实 message 落 detach.log——
            // 此前失败原因无处可查（goal 态 state 不落盘、事件只有 status），只能靠人猜根因
            //（宿主实锤：ledger 58 连错的真因藏了两个 run 才被定位）。
            console.warn(
              `[closure] in-flow receipt 校验未通过（status=${receiptValidation.status}）：` +
                `${(receiptValidation.message ?? '无 message').slice(0, 600)}`,
            );
            applyClosurePatchFromReceiptValidation(
              projectRoot, manifest.feature, phase, receiptValidation, frameworkRoot,
            );
          }
          ({ summary, summaryPath, summaryAbsPath, reportDir } = readPhaseSummary(
            projectRoot,
            manifest.feature,
            phase,
          ));
        }

        if (
          !dryRun &&
          phaseClosureCommitted &&
          pendingBacktrackCompletion?.requiresCommittedClosure &&
          phase === pendingBacktrackCompletion.toPhase
        ) {
          goalEvents.emit({
            type: 'phase_backtrack_completed',
            to_phase: pendingBacktrackCompletion.toPhase,
            reason: 'legacy_fidelity_ssot',
          });
          pendingBacktrackCompletion = null;
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
          goalEvents.emit({
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
            goalEvents.emit({
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
          completionObserved: invoke.completion_observed,
        });
        // openspec device-readiness-and-completion t2：testing 结论封顶。
        // **由 runner 依可信 device session 派生，不看 agent summary 自报**——自报即可绕过。
        // 没有逐用例能力矩阵时，模拟器/未知目标上的 testing 结果不足以证明真机行为，
        // 让它整体 PASS 就是假绿；封顶为 PARTIAL（诚实的完成度表达）。ut 不封顶。
        const testingCapped =
          deviceKindThisPhase !== null &&
          capsTestingConclusion(phase, deviceKindThisPhase) &&
          resolved.verdict === 'PASS';
        if (testingCapped) {
          goalEvents.emit({
            type: 'testing_conclusion_capped',
            phase,
            invoke_id: invokeId,
            target_kind: deviceKindThisPhase,
            reason: '模拟器/未知目标上的 testing 不得冒充真机通过（无逐用例能力矩阵时保守封顶）',
          });
          console.warn(
            `[device] testing 在 target_kind=${deviceKindThisPhase} 上执行——结论封顶为 PARTIAL，` +
              '不得宣称真机测试完成（接真机后重跑可解除）。',
          );
        }
        const verdict = resolved.verdict;
        // framework-identity-boundary 2.4：当前 attempt 的所有裁决面只消费这一份投影。
        // 原始 summary 仍可供 verdict/closure/visual receipt 与历史报告展示，但旧
        // framework integrity blocker 不得再进入 meta/signature/repair/reconcile/event。
        const decisionSummary = stripRetiredFrameworkIntegrityForCurrentRun(summary);
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
        // 控制台中断类退出（Ctrl+C/关窗/conhost 终止，可能来自操作者或宿主环境清理），
        // 不是任何一种"失败"信号，最高优先单独识别。
        const operatorInterrupt = isOperatorInterruptSignal(invoke.exitCode, invoke.signal);
        const baseFailureKind = classifyFailureKind(decisionSummary, manifest.dependency_policy, {
          agentTimedOut: invoke.timed_out === true,
          agentApiError: apiErrorSentinel !== null,
          agentNoOutput,
          operatorInterrupt,
          // P0-5/P0-3 freshness（决策表 SSOT）：fresh 超时轮的 integrity/framework_bug
          // 确定性证据优先于 agent_timeout（harness 在 tree-kill 之后新鲜跑出，可信）。
          staleSummary: resolved.stale_summary,
        }) ?? 'agent_timeout';
        // P0-5：integrity subtype 多值收集（blocking_class 过滤 + classification 通道），
        // 透传 phase_verdict / halt guidance / outcome。
        const integritySubtypes =
          baseFailureKind === 'framework_integrity_block' ? extractIntegritySubtypes(decisionSummary) : [];
        const affectedFiles = extractDeterministicAffectedFiles(decisionSummary);
        // P0-B：agent_timeout 无 deterministic affected_files 时监控 phase 主产物
        // （spec.md 等 + context-exploration.md）——产物内容变化=有进展，guard 放行续作。
        const watchedFiles =
          affectedFiles.length > 0
            ? affectedFiles
            : baseFailureKind === 'agent_timeout'
              ? timeoutWatchArtifactPaths(projectRoot, manifest.feature, phase)
              : [];
        const currentArtifactSnapshot =
          watchedFiles.length > 0 ? snapshotArtifacts(projectRoot, watchedFiles) : {};

        // v23 F1（adjudicated-repair-loop review 修复）：统一可回修缺陷收集已**上移到
        // PASS closure 之前**（见上方 actionableResult）——此处复用同一结果做信任精修与合并。
        const actionableDefects = actionableResult.defects;
        const failureKind = refineFailureKindWithTrustedDeviceEvidence(
          baseFailureKind,
          actionableResult.trustedDeviceRootClassifications,
        );
        // 历史-only summary 本身不是本 attempt 的失败事实。没有当前 summary 或当前进程/
        // harness/closure 事实时，不得合成 agent_timeout 签名或把 fallback kind 写进新事件。
        const currentFailureProjection = buildCurrentAttemptFailureProjection({
          decisionSummary,
          failureKind,
          phase,
          hasRuntimeFailureEvidence:
            operatorInterrupt ||
            invoke.timed_out === true ||
            apiErrorSentinel !== null ||
            agentNoOutput ||
            resolved.agent_failed ||
            harnessExit !== 0 ||
            closureFinalizationError !== null ||
            interactionSentinel !== null ||
            actionableResult.defects.length > 0 ||
            actionableResult.unverified.length > 0,
        });
        const meta = currentFailureProjection.blockingMeta;
        // P0-B §七.3：签名必须使用 evidence 精修后的最终 kind。否则 phase_verdict 虽然
        // 是 test_contract，blocker_signature / 熔断仍会残留 code_regression。
        const currentBlockerSignature = currentFailureProjection.blockerSignature;
        const envBlocked = meta.failure_kind === 'toolchain' || meta.failure_kind === 'capture' ||
          meta.blocking_class === 'externalBlocked';
        // External/toolchain evidence is reportable but never a content backtrack input.
        const driverActionableDefects = envBlocked ? [] : actionableDefects;
        const hasActionable = driverActionableDefects.length > 0;
        // 责任阶段统一路由（plan b6e4c9f2）：可信可修缺陷的**唯一真源=summary
        // .repair_candidates**（信任合取在 writer 侧把关）。testing 旧 bounded 验真器
        // （collectActionableDefects）的产物在此合并回同一字段；native failure pair
        // 已在 summary writer 生成，二者不复制 CaseResult/StepResult 状态。环境类失败不作回退输入。
        let summaryRepairCandidates: RepairCandidate[] = envBlocked
          ? []
          : (decisionSummary?.repair_candidates ?? []);
        let repairCandidatesUnwritable: string | null = null;
        if (!dryRun && !envBlocked && driverActionableDefects.length > 0) {
          // fail-closed：候选写不回 summary（唯一真源）＝assess 看不见缺陷＝回退链断
          // ——不得静默降级为 advance，也不得落回任何旧路由（旧路由已删除）。
          // summary 路径缺失同样计入（codex 二轮：缺 summaryAbsPath 时不得绕过契约）。
          if (!summaryAbsPath) {
            repairCandidatesUnwritable = '本轮 summary.json 路径不可用（缺失/解析失败），可信缺陷无处落盘';
          } else {
            try {
              summaryRepairCandidates = mergeRepairCandidatesIntoSummary({
                summaryPath: summaryAbsPath,
                // 合法 deterministic/provider machine evidence 直接物化；primary 文本和
                // legacy confirmed_by 都没有否决或排除权。
                candidates: actionableDefectsToCandidates(driverActionableDefects, String(phase)),
              });
            } catch (e) {
              repairCandidatesUnwritable = (e as Error).message;
            }
          }
        }
        // review 第 11 轮 P1：可信缺陷优先回退；**只有 unverified** 时既不回退（不可信
        // 不能驱动改码）也不 advance（must_fix 在场不能装干净）——testing 内 retry 引导
        // 重采/补身份，耗尽 halt。
        const unverifiableOnly =
          phase === 'testing' && !envBlocked && !hasActionable && actionableResult.unverified.length > 0;

        // adjudicated-repair-loop M1（review 修复）：累计收敛状态**在 assess/唯一 boundary
        // 之前**一次性计算——halt 交由 guard 前置（boundary 发布一致的 halt verdict），不再
        // 在 backtrack 分支内事后改判（消除两个裁决面）。
        //   · signal@1 候选按其 item_fingerprint 是否 ∈ attempted（events 回放）过滤；
        //   · legacy（非 signal@1）候选恒 eligible、不参与收敛；
        //   · 仅当「存在 signal open 且无任何可回退候选（signal eligible 空 且 无 legacy）」
        //     才停 repair_not_converging——有 legacy 时继续路由 legacy（不误伤 check-domain）。
        const signalCandidatesAll = summaryRepairCandidates.filter((c) => c.identity_schema === 'signal@1');
        const legacyCandidates = summaryRepairCandidates.filter((c) => c.identity_schema !== 'signal@1');
        // attempted/fingerprint 均由 events 回放且 same-run 单调；manual resume 与 legacy
        // confirmed_by 都不能清空、排除或重新赋予候选资格。
        const attemptedSignalNow = replayAttemptedSignalIdentities(loadAuthoritativeEvents(eventsPath));
        const eligibleSignalNow = computeEligibleSignalIdentities(signalCandidatesAll, attemptedSignalNow);
        const eligibleForBacktrack = [...eligibleSignalNow, ...legacyCandidates];
        const signalOpen = signalCandidatesAll.length > 0;
        const allRepairExhausted =
          signalOpen &&
          eligibleForBacktrack.filter((c) => c.identity_schema === 'signal@1').length === 0 &&
          legacyCandidates.length === 0;

        let driverGuardAction: DriverGuardAction = 'none';


        let haltReason: string | undefined;
        let awaitConfirmGuidance: string | undefined;
        // 责任阶段统一路由 fail-closed（codex 冻结项⑦）：验真器已判可信缺陷，但候选
        // 写不回 summary（唯一真源）→ assess 看不见缺陷，回退链断；停下求人，不 advance。
        if (repairCandidatesUnwritable) {
          driverGuardAction = 'halt';
          haltReason = 'repair_candidates_unwritable';
          goalEvents.emit({
            type: 'phase_halt', phase, halt_reason: 'repair_candidates_unwritable',
            detail: repairCandidatesUnwritable, probe: 'storage_ready',
            ...runDispositionFields(decide(
              { incident: 'repair_candidates_unwritable', phase: String(phase), detail: repairCandidatesUnwritable },
              NO_AUTHORITY,
              { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
            )),
          });
          console.error(
            `\n===== repair_candidates_unwritable =====\n${repairCandidatesUnwritable}\n`
            + '可信缺陷写不回 summary——assess 将看不到它、回退链断裂，停下求人。\n',
          );
        }
        // adjudicated-repair-loop M1（review 修复）：收敛判停前置（唯一裁决面）——
        // signal@1 open 但全部已 attempted 且无 legacy 可回退 → guard halt；
        // 有 legacy 时继续（backtrack 分支用 eligibleForBacktrack 注入，不误伤 check-domain）。
        if (allRepairExhausted) {
          driverGuardAction = 'halt';
          haltReason = 'repair_not_converging';
          const convergenceGuidance = [
            '===== repair_not_converging（信号级候选已累计回退、仍未消除）=====',
            `feature=${manifest.feature} run_id=${manifest.run_id} phase=${phase}`,
            `以下 ${signalCandidatesAll.length} 个信号级候选身份已在本 run 中实际执行过自动修复（attempted），` +
              '仍处于 open——累计 one-shot 收敛禁止再次自动回退（防 A/C 交替空转）：',
            ...signalCandidatesAll.map((c) => `- ${c.item_fingerprint.slice(0, 12)}`),
            '- 本 run 诚实终止：manual resume、confirmed_by 或其它人签不会清 attempted、不会重置 fingerprint、不会改变质量结论。',
            '- 只有新的机器证据形成新 candidate identity，或 successor run 以新 run identity/预算全量重验后才能继续。',
          ].join('\n');
          goalEvents.emit({
            type: 'phase_halt', phase, halt_reason: 'repair_not_converging',
            attempted_identities: signalCandidatesAll.map((c) => c.item_fingerprint.slice(0, 12)),
            halt_guidance: convergenceGuidance,
            ...runDispositionFields(decide(
              { incident: 'repair_not_converging', phase: String(phase) },
              NO_AUTHORITY,
              { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
            )),
          });
          console.error(`\n===== repair_not_converging =====\n${convergenceGuidance}\n`);
        }
        if (!unverifiableOnly) previousUnverifiedRound = null;
        if (unverifiableOnly) {
          const notes = actionableResult.unverified.slice(0, 6)
            .map(u => `${u.screen_or_case_id}：${u.reason}`).join('；');
          const unverifiedRound = evaluateUnverifiedRound(
            previousUnverifiedRound,
            String(phase),
            actionableResult.unverified,
          );
          const unverifiedRoundFingerprint = unverifiedRound.fingerprint;
          const repeatedWithoutProgress = unverifiedRound.repeatedWithoutProgress;
          goalEvents.emit({
            type: 'unverifiable_must_fix',
            phase,
            invoke_id: invokeId,
            entries: actionableResult.unverified.slice(0, 20),
            count: actionableResult.unverified.length,
            round_fingerprint: unverifiedRoundFingerprint,
          });
          previousUnverifiedRound = {
            phase: String(phase),
            fingerprint: unverifiedRoundFingerprint,
          };
          const visualCount = actionableResult.unverified.filter(u => u.source !== 'device_test').length;
          const deviceCount = actionableResult.unverified.length - visualCount;
          const guidanceParts: string[] = [];
          if (visualCount > 0) {
            guidanceParts.push(
              `visual-diff 里有 ${visualCount} 屏的视觉评估尚不可采信：请重采/重评并确保 `
              + 'evaluated_screenshot_hash/evaluated_build_fingerprint 与当前截图/安装 HAP 绑定'
              + '（install meta 缺失先重装；evaluation_invalidated 屏须经 critic 重评清标记）。',
            );
          }
          if (deviceCount > 0) {
            guidanceParts.push(
              `真机测试有 ${deviceCount} 个用例的缺陷证据不可采信或不可归因：请按 priorFailure `
              + '中的 reason_code 与 selector/ui-spec 对照修复；只有绑定可信的 physical '
              + 'product_actionable/product_state 才驱动回修。',
            );
          }
          if (repeatedWithoutProgress) {
            driverGuardAction = 'halt';
            haltReason = 'unverifiable_must_fix';
            goalEvents.emit({
              type: 'phase_halt',
              phase,
              halt_reason: 'unverifiable_must_fix',
              halt_trigger: 'fingerprint_repeat',
              round_fingerprint: unverifiedRoundFingerprint,
            });
            console.error(
              `\n===== unverifiable_must_fix =====\n${notes}\n`
              + `连续两轮 unverified 集合完全相同（roundFingerprint=`
              + `${unverifiedRoundFingerprint.slice(0, 12)}…）——继续重试只会空转，本 run 终止。\n`,
            );
          } else if (retries < manifest.budget.max_retries_per_phase) {
            driverGuardAction = 'retry';
            priorFailure =
              `本轮存在 ${actionableResult.unverified.length} 项不可采信的缺陷证据（${notes}）。`
              + `集合指纹=${unverifiedRoundFingerprint}。不可采信证据既不驱动回退、也不算通过。`
              + guidanceParts.join(' ');
            priorFailureKind = 'contract_violation' as FailureKind;
            console.error(
              `\n===== unverifiable_must_fix =====\n${notes}\n`
              + `缺陷证据尚不可采信——retry 重采/重评（`
              + `${retries + 1}/${manifest.budget.max_retries_per_phase}）。\n`,
            );
          } else {
            driverGuardAction = 'halt';
            haltReason = 'unverifiable_must_fix';
            goalEvents.emit({
              type: 'phase_halt',
              phase,
              halt_reason: 'unverifiable_must_fix',
              halt_trigger: 'retry_budget_exhausted',
              round_fingerprint: unverifiedRoundFingerprint,
            });
            console.error(
              `\n===== unverifiable_must_fix =====\n${notes}\n`
              + `重试预算内缺陷证据始终不可采信——本 run 终止。${guidanceParts.join(' ')}\n`,
            );
          }
        }
        // P0-D.3 哨兵优先级：operator_interrupt > agent_timeout > headless_interaction_required >
        // transient_api_error > blocker。E4：控制台中断类退出压过一切（含 verdict===PASS 的边缘情况——
        // 中断就是中断，不因为脚本恰好跑完就当没发生；归因不武断写成"用户关窗"）。
        if (operatorInterrupt) {
          driverGuardAction = 'halt';
          haltReason = 'operator_interrupt';
        } else if (closureFinalizationError) {
          // finalizer 失败是当前责任阶段的可重复事务，不是产品内容问题；让同一阶段
          // 自动重试 closure，不走 waiting(human)/terminal，也不把提示塞给 agent 修产物。
          driverGuardAction = 'retry';
          haltReason = undefined;
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: 'closure_finalization_failed',
            detail: closureFinalizationError,
            ...runDispositionFields(decide(
              { incident: 'closure_finalization_failed', phase: String(phase), detail: closureFinalizationError },
              NO_AUTHORITY,
              { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
            )),
          });
        } else if (invoke.timed_out !== true && interactionSentinel && verdict !== 'PASS') {
          driverGuardAction = 'halt';
          haltReason = 'headless_interaction_required';
        } else if (agentNoOutput && verdict !== 'PASS') {
          // P0-D §六-8：空产出（疑似 spawn/权限/弱模型）第一次即 halt 求人——goal 无头
          // 没有 normal 模式的 Stop hook 逃生阀；不 backoff、不盲重试、不冒充断流。
          driverGuardAction = 'halt';
          haltReason = 'agent_no_output';
        } else if (failureKind === 'framework_integrity_block' && verdict !== 'PASS') {
          // 当前机器 integrity（如 process injection）首触 halt；历史 framework subtype
          // 只作 provenance，guidance 按真实来源解释，不再给 Git dirty/提交/回滚处置。
          driverGuardAction = 'halt';
          haltReason = 'framework_integrity_block';
          awaitConfirmGuidance = buildFrameworkIntegrityGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase,
            subtypes: integritySubtypes,
            harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
          }).join('\n');
          console.log(`\n===== framework_integrity_block =====\n${awaitConfirmGuidance}\n`);
        } else if (failureKind === 'closure_finalization_failed' && verdict !== 'PASS') {
          driverGuardAction = 'retry';
          haltReason = undefined;
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: 'closure_finalization_failed',
            detail: 'closure finalization 失败，重试当前责任阶段事务。',
            ...runDispositionFields(decide(
              { incident: 'closure_finalization_failed', phase: String(phase) },
              NO_AUTHORITY,
              { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
            )),
          });
          console.log('\n===== closure_finalization_failed =====\n自动重试当前责任阶段 closure 事务。\n');
        } else if (failureKind === 'framework_bug' && verdict !== 'PASS') {
          // P0-3（plan d9b4f7e2）：门禁脚本自身程序员错误——框架缺陷只能人修（回灌源仓），
          // agent 改产物绕不过去（案发现场 spec 前 5 轮空转实证），首触即 halt。
          driverGuardAction = 'halt';
          haltReason = 'framework_bug';
          const bugBlockers = (decisionSummary?.blockers ?? []).filter(
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
            driverGuardAction = 'retry';
          } else {
            driverGuardAction = 'halt';
            haltReason = 'transient_api_error_exhausted';
          }
        } else if (failureKind === 'no_progress_fuse' && verdict !== 'PASS') {
          // t1（f7a3d9c2）：指纹级无进展熔断——check 层已比对轮次账本判"两有效轮指纹集
          // 相等且仍有 loop-actionable 残差"（含 duplicate 重放，rev5）。重试只会复现同
          // 指纹 → 首触即 halt 求人，不烧重试预算；残差清单在 blocker details。
          driverGuardAction = 'halt';
          haltReason = 'no_progress_fuse';
        } else if (
          // ==============================================================
          // P0-4(b)（plan 7c4f2e9b）：blocker actionability 聚合层（决策梯③层唯一插入位，
          // 位于安全终态/专用求人态/transient API 之后、no-progress/内容重试之前）。
          // timeout 四步分流（codex 九轮 P0）由此天然落地：timed_out + fresh blockers 时
          // ①integrity 已被上方安全终态吸收 → ②∃toolchain→await_operator_toolchain →
          // ③其余走下方 agent_timeout。质量问题不再创建 resume-by-signature 停车态。
          // fresh 判据=summary 非 stale（stale summary 是上一 attempt 的症状，不据此分流）。
          verdict !== 'PASS' &&
          !resolved.stale_summary &&
          classifyTimedOutWithFreshBlockers(decisionSummary) !== null
        ) {
          const actionabilityRoute = classifyTimedOutWithFreshBlockers(decisionSummary)!;
          const agg = aggregateBlockerActionability(decisionSummary);
          driverGuardAction = 'halt';
          haltReason = actionabilityRoute;
          // This resolver now returns only the toolchain route. Human quality
          // signatures are no longer a resumable outcome.
          awaitConfirmGuidance = [
            '===== await_operator_toolchain（环境/工具链阻塞，须 operator 修复）=====',
            `feature=${manifest.feature} run_id=${manifest.run_id} phase=${phase}`,
            `- 工具链 blocker：${agg.toolchainIds.join(', ')}`,
            '- 这不是产物内容问题：重试 agent 修不了环境。修复对应工具链（详见 blocker details）后 --resume。',
          ].join('\n');
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
          driverGuardAction = 'halt';
          // T6/P0-B：分流 halt 原因——基建(toolchain/capture/agent_timeout)求人修环境
          // vs 视觉(visual_gap)同门禁无改善熔断求复核。
          // plan a5f9c3e2（codex 七轮 P0）：**incident id 一律显式 literal，禁止模板串生成**
          // ——模板生成的 id 绕过注册表元门禁（扫描器只提字面量），实测 6 个真实可达 id
          // 未注册而测试仍全绿。此处按原值域逐项展开，emit 值与改造前逐字等同。
          haltReason =
            failureKind === 'visual_gap'
              ? 'no_progress_visual_gap'
              : failureKind === 'toolchain'
                ? 'no_progress_toolchain'
                : failureKind === 'capture'
                  ? 'no_progress_capture'
                  : failureKind === 'agent_timeout'
                    ? 'no_progress_agent_timeout'
                    : 'no_progress_guard';
        } else if (
          // E4：CUMULATIVE（非仅连续）家族重复熔断——上面 shouldHaltNoProgress 只比"紧邻上一次"，
          // 会被 FAIL(真 blocker 串)↔PASS(合成 agent_timeout@phase signature) 边界打断
          // （chrys 案实证：signature 因 verdict 摆动而不同，guard 被绕过）。这里改从 events.jsonl
          // 回放**累计**同一 signature 在 CUMULATIVE_HALT_FAMILY 家族内出现次数，与紧邻性无关。
          CUMULATIVE_HALT_FAMILY.has(failureKind) &&
          currentBlockerSignature &&
          countRepeatedSignatureInFamily(
            loadAuthoritativeEvents(eventsPath),
            phase,
            currentBlockerSignature,
            CUMULATIVE_HALT_FAMILY,
          ) +
            1 >=
            CUMULATIVE_HALT_THRESHOLD
        ) {
          driverGuardAction = 'halt';
          // 同上（codex 七轮 P0）：原按 failureKind 模板生成 id，值域随 FailureKind
          // 膨胀。改为**稳定 literal**——但不能压成一个：CUMULATIVE_HALT_FAMILY 同时含
          // 当前家族只包含 toolchain；`no_progress_cumulative_human` 仅保留为历史事件词汇，
          // 新轮次不会再由质量确认缺口写入。
          haltReason =
            failureKind === 'toolchain'
              ? 'no_progress_cumulative_external'
              : 'no_progress_cumulative_human';
        } else if (
          // P0-4（plan d9b4f7e2）：连续超时熔断——升档（第 2 次后 ×1.5）仍救不回的第
          // CONSECUTIVE_TIMEOUT_HALT_AT 次连续超时 → halt 求人。签名无关（07-13 案 FAIL
          // 签名每轮互异，签名基 guard 全绕过）；含 PASS+unclosed 型（advance_blocked），
          // 但"PASS 且闭环完成"的超时不拦（马上 advance，无需熔断）。
          failureKind === 'agent_timeout' &&
          (verdict !== 'PASS' || resolved.advance_blocked) &&
          countConsecutiveAgentTimeouts(loadAuthoritativeEvents(eventsPath), phase) + 1 >=
            CONSECUTIVE_TIMEOUT_HALT_AT
        ) {
          driverGuardAction = 'halt';
          haltReason = 'agent_timeout_repeated';
          awaitConfirmGuidance = buildAgentTimeoutRepeatedGuidance({
            feature: manifest.feature,
            runId: manifest.run_id,
            phase,
            // 复审修复（codex P2）：本次 invoke 的 agent_invoke_end 在 verdict 链之前已
            // 落盘 events——不再 concat 当前时长，否则末条重复、attempt 数虚高。
            attemptDurationsMs: loadAuthoritativeEvents(eventsPath)
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
          driverGuardAction = 'halt';
          haltReason = 'closure_timeout';
          console.error(
            '\n===== closure_timeout =====\nclosure-only attempt（PASS 已冻结，仅补关环）超时——不回内容重试。\n' +
            '人工核查 receipt/closure 状态后 --resume（deterministic 关环由 runner 代办，超时通常意味 verifier 参与的 repair 被卡）。\n',
          );
        } else if (failureKind === 'agent_timeout' && verdict !== 'PASS') {
          // P0-B.5：超时+有进展（guard 未熔断）→ resume 续作，不吃内容重试预算；
          // 全局仍受 wall_clock + max_total_turns 兜底（checkRunBudget 每轮重查）。
          driverGuardAction = 'retry';
        } else if (resolved.advance_blocked) {
          // E4（案B chrys 实证：advance_blocked 两次分别以不同 reason 出现——closure_open 类走
          // max_retries_per_phase 兜底但慢，agent_timeout_unclosed 类曾**无任何上限**、真无限
          // 重试）。累计（含本次）达到 ADVANCE_BLOCKED_HALT_THRESHOLD 即 halt 求人，不看具体
          // reason：script 门禁反复"PASS 却关不了环"本身就是这个 phase 结构性关不了环的信号——
          // 给一次重试机会（也许只是没来得及关环），第二次即不再自证突破。
          const cumulativeAdvanceBlocked =
            countCumulativeAdvanceBlocked(loadAuthoritativeEvents(eventsPath), phase) + 1;
          if (cumulativeAdvanceBlocked >= ADVANCE_BLOCKED_HALT_THRESHOLD) {
            driverGuardAction = 'halt';
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
            driverGuardAction = 'retry';
          } else if (retries < manifest.budget.max_retries_per_phase) {
            driverGuardAction = 'retry';
          } else {
            driverGuardAction = 'halt';
            haltReason = resolved.advance_block_reason ?? 'closure_open';
          }
          // 【closure retry 前建 pass snapshot 已退役 · runner-owned-machine-facts】
          // PASS 产物不再靠冻结快照保护：closure 轮改坏产物=下一轮完整 harness FAIL；
          // 改了仍合法=当前字节重新过全部门禁。快照建立失败曾是独立 halt 面
          // （pre_invoke_snapshot_failed），随机制一并消失。
          // ------------------------------------------------------------
          // P0-5（plan 7c4f2e9b）：closure_kind 确定性分类——探针真值 total function，
          // 不从 advance_block_reason 映射（其 agentTimedOut 先行返回会掩盖 receipt 真值，
          // 保留为 telemetry）。fresh 复用 in-flow 探针；缺失（如超时被杀路径）才重探，
          // subprocess timeout 受 remaining wall-clock/FINALIZE_RESERVE 约束。
          // ------------------------------------------------------------
          if (driverGuardAction === 'retry' && !dryRun) {
            // P1#6（post-impl review）：probe timeout 严格受 remaining wall/finalize reserve
            // 约束——剩余 ≤0 时不再"保底 30s"突破预算；直接跳过分类（下一轮预算判据会
            // budget_wall_clock 终局），保持 retry 语义不变。
            const probeRemainingMs = wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS;
            const probe = inFlowReceiptValidation ?? (probeRemainingMs > 5_000
              ? (injectedValidateReceipt ?? tryValidateReceipt)(
                  path.join(frameworkRoot, 'harness'),
                  projectRoot,
                  phase,
                  manifest.feature,
                  {
                    timeoutMs: Math.min(300_000, probeRemainingMs),
                    goalIdentity: {
                      runId: manifest.run_id, attemptId: visualAttemptId, attemptPhase: String(phase),
                      // plan d7f3a9c4 t3：check-receipt 子进程同链透传 model pin。
                      ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
                    },
                  },
                )
              : null);
            if (probe === null) {
              // post-impl round2 P1#3：closure-only 超时且无预算探针 → 仍不得回内容重试
              if (closureOnlyAttempt && invoke.timed_out === true) {
                driverGuardAction = 'halt';
                haltReason = 'closure_timeout';
                console.error('\n===== closure_timeout =====\nclosure-only attempt 超时且剩余预算不足以探针——本 run 终止，不回内容重试。\n');
              } else {
                console.warn('[closure] 剩余预算不足以运行 receipt 探针——跳过 closure 分类（wall-clock 判据接管）');
              }
            } else {
            const route = classifyClosureKind(probe.status);
            goalEvents.emit({
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
              driverGuardAction = 'halt';
              haltReason = route.reason;
              console.error(
                `\n===== ${route.reason} =====\n` +
                (route.reason === 'closure_probe_error'
                  ? `receipt 探针自身执行失败（${(probe.message ?? '').slice(0, 300)}）——framework/toolchain 问题，不派 agent 修 receipt；人工修复后 --resume。\n`
                  : 'lite track 不产生 receipt 却出现 advance_blocked——runner 状态机不变量违例，请回灌源仓核查。\n'),
              );
            } else if (route.kind === 'deterministic_recheck') {
              // runner 不调 agent：正式 receipt state sync/closure patch → 直接推进
              // 环 C（plan f3a8c6d2 t2）：提交侧透传当前 attempt 身份——sync-closure 在写
              // phase state / 提交 summary closure 之前再做一次严格 attempt 等值校验，
              // 上面 probe 的严格校验不作为提交侧的免检理由（纵深防御）。
              const syncResult = runSyncClosureDetailed(
                path.join(frameworkRoot, 'harness'),
                projectRoot,
                manifest.feature,
                String(phase),
                frameworkRoot,
                {
                  goalIdentity: {
                    runId: manifest.run_id,
                    attemptId: visualAttemptId,
                    attemptPhase: String(phase),
                    ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
                  },
                },
              );
              const syncExit = syncResult.exitCode;
              if (syncResult.finalizationError) {
                driverGuardAction = 'retry';
                haltReason = undefined;
                goalEvents.emit({
                  type: 'phase_halt',
                  phase,
                  halt_reason: 'closure_finalization_failed',
                  detail: syncResult.finalizationError,
                  ...runDispositionFields(decide(
                    { incident: 'closure_finalization_failed', phase: String(phase), detail: syncResult.finalizationError },
                    NO_AUTHORITY,
                    { orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session', invocation: argv.resume ? 'resume' : 'fresh' },
                  )),
                });
              }
              // round3 P1#4 + round4 P1#3：分流收敛为纯函数（矩阵测试锁定契约）
              const syncOutcome = syncResult.finalizationError
                ? 'closure_finalization_failed'
                : resolveClosureSyncOutcome(syncExit, closureOnlyAttempt, invoke.timed_out === true);
              if (syncOutcome === 'closure_finalization_failed') {
                // 已转为当前责任阶段的自动 retry，不进入人工/终局通道。
              } else if (syncOutcome === 'advance') {
                driverGuardAction = 'advance';
                haltReason = undefined;
                console.log('[closure] deterministic_recheck：receipt 已验真，runner 完成 sync-closure，phase 推进（不调 agent）');
              } else if (syncOutcome === 'closure_timeout') {
                driverGuardAction = 'halt';
                haltReason = 'closure_timeout';
                console.error(
                  `\n===== closure_timeout =====\ndeterministic sync-closure 非零退出（${syncExit}）且 closure-only attempt 已超时——本 run 终止，不回内容重试。\n`,
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
              driverGuardAction === 'retry' &&
              route.kind === 'receipt_repair_with_verifier' &&
              closureOnlyAttempt &&
              invoke.timed_out === true
            ) {
              driverGuardAction = 'halt';
              haltReason = 'closure_timeout';
              console.error(
                '\n===== closure_timeout =====\nclosure-only attempt 超时且 closure 需 repair——不回内容重试，本 run 终止。\n',
              );
            }
            }
          }
        }

        // 【plan PASS 建 pass snapshot 已退役 · runner-owned-machine-facts】原自述目的
        // "coding 的 ui_diff_within_declared_files 白名单唯一来源"已被取代：白名单来自
        // plan closure manifest 冻结的 contracts.yaml hash（ui-scope-gate 直读，盘上失配
        // =live 漂移拒读），与本 run 快照无关——这段是与现状矛盾的死机制。

        const agentWarn = buildAgentWarn(invoke);
        const reconcileObservation = deriveReconcileObservation({
          phase,
          verdict,
          legacyAction: driverGuardAction,
          failureKind: meta.failure_kind ?? currentFailureProjection.failureKindForEvent,
          blockingClass: meta.blocking_class,
          propagateToDownstream: manifest.dependency_policy.propagate_to_downstream,
          dependencyPolicy: manifest.dependency_policy,
          blockers: (decisionSummary?.blockers ?? []).map((blocker) => ({
            id: String((blocker as { id?: string }).id ?? 'unknown'),
            blocking_class: (blocker as { blocking_class?: string }).blocking_class,
          })),
          deterministicDefects: driverActionableDefects.map((defect) => defect.fingerprint),
          retriesUsed: retries,
          maxRetriesPerPhase: manifest.budget.max_retries_per_phase,
          backtracksUsed,
          repeatedCount: currentBlockerSignature
            ? countRepeatedSignatureInFamily(
                loadAuthoritativeEvents(eventsPath),
                phase,
                currentBlockerSignature,
                CUMULATIVE_HALT_FAMILY,
              ) + 1
            : 0,
          // M1（plan e2b7c4a9 t1.3）：整轮候选集合指纹 + 信号级收敛状态进 reconcile
          // observation——assess 消费入 stop 理由（见 assess.ts stop.reason）。
          repeatedRoundFingerprint: roundFingerprintOfCandidates(summaryRepairCandidates),
          repairConvergence: (() => {
            const signalCands = summaryRepairCandidates.filter((c) => c.identity_schema === 'signal@1');
            if (signalCands.length === 0) return undefined;
            const attemptedNow = replayAttemptedSignalIdentities(loadAuthoritativeEvents(eventsPath));
            const eligibleNow = signalCands.filter((c) => !attemptedNow.has(c.item_fingerprint));
            return {
              eligibleEmpty: eligibleNow.length === 0,
              openSignalCount: signalCands.length,
              attemptedSignalCount: signalCands.length - eligibleNow.length,
            };
          })(),
          residualFingerprints: currentBlockerSignature ? [currentBlockerSignature] : [],
          // 任何已执行的 earlier phase 都可作为 gap owner 被原事务失效；候选 resolver
          // 仍决定缺陷的最小责任阶段，但不能把 missing/stale/legacy 等非候选 gap 排除在外。
          invalidatablePhases: [...new Set([
            ...chain.slice(0, phaseIdx + 1).map(String),
            ...resolveInvalidatablePhases({
              chain: chain.map(String),
              hasActionable: hasActionable && (phase === 'ut' || phase === 'testing'),
              candidateCategories: summaryRepairCandidates.map((c) => c.category),
              track: goalTrack,
            }),
          ])],
          timedOut: invoke.timed_out,
          operatorInterrupted: haltReason === 'operator_interrupt',
          apiDisconnected: apiErrorSentinel !== null,
          fused: driverGuardAction === 'halt' && (/^no_progress|repeated/.test(haltReason ?? '') || haltReason === 'repair_not_converging'),
          fuseReason: haltReason,
        });
        if (runControl) {
          assertFencedOwner(runControl.dir, runControl.token, 'assess_recommendation');
        }
        const runAssess = (): ReturnType<typeof assessFeature> => assessFeature({
          projectRoot,
          frameworkRoot,
          feature: manifest.feature,
          goalEnd: manifest.end_phase,
          minimumAssurance: manifest.minimum_assurance,
          authorization: { mode: 'goal_mode' },
          runId: manifest.run_id,
          attemptId: invokeId,
          writeProjection: !dryRun,
          reconcile: reconcileObservation,
        });
        let assessment = runAssess();

        // b3e8d4c7 t2：assess 推荐 `complete_closure:<上游>` 时，driver 词汇表里没有这个
        // 动作 → 旧实现落无条件 halt，重试当前阶段永远修不好上游闭环（宿主实锤死锁）。
        // 这里做**一次**确定性关环（不启 agent、不消耗内容重试预算），成功后**重新 assess**
        // ——旧 assessment 仍是 complete_closure，直接复用会再 halt。不循环：第二次仍是
        // 同一 gap 就交给下面的既有 halt 路径。
        if (!dryRun && assessment.recommendation.action === 'complete_closure') {
          const closure = tryCloseUpstreamPhase({
            projectRoot,
            frameworkRoot,
            harnessRoot: path.join(frameworkRoot, 'harness'),
            feature: manifest.feature,
            currentPhase: String(phase),
            chain: chain.map(String),
            recommendation: assessment.recommendation,
            goalRunId: manifest.run_id,
            attemptId: visualAttemptId,
            // plan d7f3a9c4 t3：上游关环的 check-receipt 子进程同链透传 model pin。
            ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
            remainingBudgetMs: wallDeadlineMs - Date.now() - FINALIZE_RESERVE_MS,
            fence: () => {
              if (runControl) {
                assertFencedOwner(runControl.dir, runControl.token, 'upstream_closure');
              }
              assertGoalBoundary('closure_finalizer');
            },
          });
          if (closure.kind === 'closed') {
            goalEvents.emit({
              type: 'upstream_closure_committed', phase: closure.phase, current_phase: String(phase),
            });
            assessment = runAssess();
          } else if (closure.kind === 'backtrack') {
            goalEvents.emit({
              type: 'upstream_closure_requires_backtrack',
              phase: closure.phase,
              current_phase: String(phase),
              detail: closure.detail,
            });
            assessment = {
              ...assessment,
              recommendation: {
                action: 'rerun_phase',
                phase: closure.phase,
                reason: `unclosed_revalidation: ${closure.detail}`,
                requires_driver_authorization: true,
                runner_action: 'backtrack_to_phase',
              },
            };
          } else if (closure.kind === 'blocked') {
            goalEvents.emit({
              type: 'upstream_closure_blocked',
              phase: closure.phase, current_phase: String(phase),
              halt_reason: closure.incident, detail: closure.detail,
            });
            // 事故 id 已分派好——下面的 halt 汇点不得再贴 *_retry_exhausted
            haltReason ??= closure.incident;
          }
        }

        let action = goalEvents.decideAndEmit({
          assessment,
          observation: reconcileObservation,
          currentPhase: String(phase),
          chain,
          driverGuardAction,
          verdictEvent: {
            phase,
          // P0-1 rev6：attempt 窗口按 invoke_id 精确切分（continuation 五态派生消费）。
          invoke_id: invokeId,
          verdict,
          harness_exit: harnessExit,
          stale_summary: resolved.stale_summary,
          agent_failed: resolved.agent_failed,
          // t4：完成观测收口——与 timed_out/agent_failed **互斥的独立原因码**。
          // 归错类会让上层按失败路径重试一个证据已完整的阶段（正是 07-28 事故的放大链）。
          completion_observed: invoke.completion_observed,
          blocking_class: meta.blocking_class,
          failure_kind: meta.failure_kind,
          // P1-8（plan d9b4f7e2）：PASS+advance 不输出 failure_kind_classified——07-13 案
          // 全部 advance 事件带着 code_regression 字样，事后排障已实际造成误导。
          failure_kind_classified: currentFailureProjection.failureKindForEvent,
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
          },
        });
        if (action === 'halt' && !haltReason) {
          const assessReason = assessment.recommendation.reason.trim();
          // f9c2e6b4 t3：**责任类别不得被洗白**。旧写法发 `assess_halt:<reason>`，
          // 而 normalizeIncidentId 截到首个 ':' → 恒为 `assess_halt` → registry 固定
          // operator → WAITING/human，且 WAITING 会让 supervisor 永不拉起（实证
          // run 20260803T103413Z-3f72a8：真因是 project_build，却被判成"等人"）。
          // 责任来源是**既有的 FailureKind 归一分类**，不新建正则或第二套责任表。
          // 详细原因不丢：仍原样写进下面的 `reason` 字段。
          //
          // b3e8d4c7 t3：**来源穷尽 + fail-closed**。本汇点承载的不只是重试耗尽——
          // 宿主 run 20260804T033834Z-99c0a1 里预算只用了 1/2，真因是"推荐无路由"，
          // 却被 f9c2e6b4 t3 整体假设成 exhausted，事件里 halt_reason=exhausted 与
          // reason=unclosed 自相矛盾。规则：
          //   · 只有 retries_used >= max 的**正证据**才允许标 *_retry_exhausted；
          //   · complete_closure:<上游> 走 t2 分派（已在上面写入 haltReason）；
          //   · 其余未识别来源（fused / 无效目标 / 无法执行的推荐）→ framework_bug
          //     fail-closed。**不给 catch-all 起精确名字**。
          // 判据抽在 resolveAssessHaltIncident（纯函数，行为矩阵单测）——`retries >= max`
          // 只是必要条件，预算恰好用满时任何落进本 catch-all 的 halt 都会被误标。
          haltReason = resolveAssessHaltIncident({
            retriesUsed: retries,
            maxRetriesPerPhase: manifest.budget.max_retries_per_phase,
            runnerAction: assessment.recommendation.runner_action,
            verdict,
            fused: assessment.stop.fused,
            failureKind,
          });
          // t2（plan f3a8c6d2）：**gap 归属阶段不得被当前 phase 吞掉**。事件的 `phase`
          // 是"在哪一阶段停下"，而 assess 的 gap 可能属于**上游别的阶段**——bc-openCard
          // run 20260808T071335Z-4b0136 的 plan-i4 即：recommendation.phase='spec'
          // （spec 的 evidence manifest stale），却呈现为"plan 阶段 framework_bug:
          // stale: phase evidence manifest 非 fresh"，读者（含事后复盘）必然误读成 plan
          // 自己的证据链坏了。此处只在 reason 文案里补明归属，复用既有字符串字段，
          // 不新增事件字段、不改 halt 分类（catch-all 归 framework_bug 是设计内的
          // fail-closed，见上方注释）。
          const gapPhase = assessment.recommendation.phase;
          const crossPhaseNote =
            gapPhase && gapPhase !== String(phase)
              ? `[gap 属于 ${gapPhase} 阶段，非当前 ${String(phase)}] `
              : '';
          goalEvents.emit({
            type: 'phase_halt',
            phase,
            halt_reason: haltReason,
            reason:
              crossPhaseNote +
              (assessReason || 'assess returned halt without a driver-owned reason'),
          });
        }
        emitMilestone(`GOAL_PHASE phase=${phase} event=verdict result=${action}`);
        flushProgress();

        // Cooperative handoff is polled only after a complete phase verdict boundary.
        if (runControl) {
          const handoff = consumeHandoffAtBoundary(runControl.dir, runControl.token, Date.now(), {
            on_quarantined: (notice) => goalEvents.emit({
              type: 'handoff_mailbox_quarantined',
              original_file: notice.original_file,
              quarantined_file: notice.quarantined_file,
              reason: notice.reason,
            }),
          });
          if (handoff.kind === 'rejected') {
            goalEvents.emit({
              type: 'handoff_rejected',
              request_id: handoff.request.request_id,
              target_owner_kind: handoff.request.target_owner_kind,
              reason: handoff.reason,
              epoch: runControl.token.epoch,
            });
          } else if (handoff.kind === 'consumed') {
            goalEvents.emit({
              type: 'handoff_requested',
              request_id: handoff.request.request_id,
              target_owner_kind: handoff.request.target_owner_kind,
              from_epoch: handoff.request.from_epoch,
              epoch: runControl.token.epoch,
            });
            flushProgress(true, true);
            quiesceRunOwner(runControl.dir, runControl.token);
            emitMilestone(
              `GOAL_HANDOFF request=${handoff.request.request_id} state=quiesced target=${handoff.request.target_owner_kind}`,
            );
            // Handoff is a non-terminal control transfer. Suppress process_exit run_end;
            // finally still releases lock projections while preserving run-control epoch.
            runConcluded = true;
            return 0;
          }
        }

        // visual-capability-truth S4：review 闭环后的可变阶段（ut/testing）在任何推进/
        // 重试决策生效前做 runner 级 source drift reconciliation——先分类后动作
        // （codex plan 审查一轮 B4：不见码就回退=给非法改码洗白的通道）：
        //   授权链命中 → 自动回退 coding（review/ut 失效，增量重点复审）；
        //   未授权/超界/无 receipt → HALT（人工裁决后可显式授权）。
        // plan e7c2a4d8 T4d（codex 四轮 P0-c）：goal 环境专用 blocker 出现时短路内容
        // 重试——reconciliation 门放宽为「action!=='retry' ∨ 存在该 blocker」，同一事故
        // 一个出口（unauthorized halt），不转化为 harness FAIL 后的内容重试循环。
        const hasPostReviewReconciliationBlocker =
          (decisionSummary?.blockers ?? []).some(
            (b) => {
              const id = (b as { id?: string }).id;
              return id === 'goal_post_review_source_mutation_unresolved' ||
                id === 'goal_review_closure_baseline_unavailable';
            },
          );
        if (
          !dryRun && (phase === 'ut' || phase === 'testing') &&
          (action !== 'retry' || hasPostReviewReconciliationBlocker)
        ) {
          let driftDecision = reconcileMutablePhaseSourceDrift({
            projectRoot,
            manifest,
            phase,
            frozenManifestHash,
            goalEnv: true,
          });
          // T4d：goal 环境 attestation 缺失/损坏 → 不得放行；按既有
          // backtrack_to_coding 责任阶段重新建立基线。若当前链截断，交给 T3 的后继
          // run 路由，不伪造当前 run 的连续性。
          const chainHasCodingReview =
            chain.includes('coding' as FeaturePhase) && chain.includes('review' as FeaturePhase);
          const baselineUnavailable = Boolean(driftDecision.baselineUnavailable);
          if (baselineUnavailable) {
            const baselineDecision = decide(
              {
                incident: 'goal_review_closure_baseline_unavailable',
                phase: String(phase),
                chain_has_coding_review: chainHasCodingReview,
                backtrack_budget_remaining: DEFAULT_MAX_BACKTRACKS - backtracksUsed,
              },
              NO_AUTHORITY,
              {
                orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session',
                invocation: argv.resume ? 'resume' : 'fresh',
              },
            );
            if (baselineDecision.kind === 'recover' && baselineDecision.action === 'backtrack_to_coding') {
              // 让下面唯一的 backtrack 路由完成事件落盘、缓存退位和执行指针移动。
              driftDecision = { kind: 'unauthorized', files: [], violations: ['review closure baseline unavailable'] };
            } else {
              const baselineGuidance = [
                `【${manifest.feature} · run ${manifest.run_id} · ${phase}】review closure attestation 缺失/损坏——`,
                '当前链无法在本 run 回到 coding 建立基线；不读取 run-start diff、不采信 gap-notes 授权。',
                'T3 将在截断链不可回退时自动 supersede 并生成 coding 起点后继 run。',
              ].join('\n');
              goalEvents.emit({
                type: 'phase_halt',
                phase,
                halt_reason: 'goal_review_closure_baseline_unavailable',
                verdict,
                halt_guidance: baselineGuidance,
                successor_required: true,
                // runner-owned-machine-facts 收口（codex）：后继起点显式声明——halt 发生在
                // review，但语义要求回 coding 建基线；不带此字段时 supervisor 按 event.phase
                // 推导会从 review 重启，原地重撞。
                successor_start_phase: 'coding',
                ...runDispositionFields({ kind: 'recover', action: 'backtrack_to_coding', reason: baselineDecision.reason }),
              });
              console.error(`\n===== goal_review_closure_baseline_unavailable =====\n${baselineGuidance}\n`);
              outcomes.push({
                phase, verdict, halted: true, retries,
                halt_reason: 'goal_review_closure_baseline_unavailable',
                halt_guidance: baselineGuidance,
              });
              halted = true;
              phaseDone = true;
              continue;
            }
          }
          // T3b（codex 二轮 P0-b 方案 1）：authorized_backtrack 仅当当前 chain 同时含
          // coding 与 review——截断链即使裁决有效也无法在本 run 回退重验。
          // plan a5f9c3e2 t3②：未受信漂移的**保守恢复**裁决（统一内核给出，不在此就地判）。
          // 恢复本身不降低保证——失效旧 coding closure 及其后阶段、把 diff 当未受信候选
          // 完整重走 coding→review→ut→testing，故**不需要任何授权**。
          // 纪律：复用执行机制（失效事务 / 回退预算 / phase 回退执行器），
          // **不复用授权语义**——不产 matched_receipts、不标 authorized。
          let untrustedRevalidation = baselineUnavailable;
          let untrustedTerminalReason = '';
          // codex 八轮 P2：**保存真实裁决结果**供后续事件投影原样复用——此前落事件时
          // 手工重造 Decision，今天结果一致，但 decide() 一改，执行动作与报告投影就会分叉。
          let untrustedDecision: Decision | null = baselineUnavailable ? decide(
            {
              incident: 'goal_review_closure_baseline_unavailable',
              phase: String(phase),
              chain_has_coding_review: chainHasCodingReview,
              backtrack_budget_remaining: DEFAULT_MAX_BACKTRACKS - backtracksUsed,
            },
            NO_AUTHORITY,
            {
              orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session',
              invocation: argv.resume ? 'resume' : 'fresh',
            },
          ) : null;
          if (driftDecision.kind === 'unauthorized') {
            const driftFp = driftDecision.driftFingerprint ?? null;
            const driftDisposition = decide(
              {
                incident: 'unauthorized_source_mutation',
                phase: String(phase),
                files: driftDecision.files,
                chain_has_coding_review: chainHasCodingReview,
                backtrack_budget_remaining: DEFAULT_MAX_BACKTRACKS - backtracksUsed,
                round_fingerprint_repeated: Boolean(driftFp && seenDriftFingerprints.has(driftFp)),
              },
              NO_AUTHORITY,
              {
                orchestration: 'goal',
                owner_kind: runtimeOwnerKind,
                // 铁律 (c)：can_prompt_now 不改变裁决，只供 L3 话术选择措辞。
                can_prompt_now: runtimeOwnerKind === 'session',
                invocation: argv.resume ? 'resume' : 'fresh',
              },
            );
            untrustedDecision = driftDisposition;
            if (driftDisposition.kind === 'recover' && driftDisposition.action === 'backtrack_to_coding') {
              untrustedRevalidation = true;
              if (driftFp) seenDriftFingerprints.add(driftFp);
            } else {
              untrustedTerminalReason = driftDisposition.reason;
            }
          }
          if (untrustedRevalidation && driftDecision.kind === 'unauthorized') {
            if (backtracksUsed >= DEFAULT_MAX_BACKTRACKS) {
              const backtrackLimitDecision = decide(
                { incident: 'backtrack_limit', phase: String(phase) },
                NO_AUTHORITY,
                {
                  orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session',
                  invocation: argv.resume ? 'resume' : 'fresh',
                },
              );
              goalEvents.emit({
                type: 'phase_halt',
                phase,
                halt_reason: 'backtrack_limit',
                verdict,
                ...runDispositionFields(backtrackLimitDecision),
              });
              console.error(`\n===== backtrack_limit =====\n回退预算已耗尽（所有回退共用 ${DEFAULT_MAX_BACKTRACKS} 次/run）——本 run 终止（防回退震荡烧预算）。\n`);
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
            // 失效事实一次性落盘；缓存 head/内存锚是其后的可重复副作用。
            const invalidationTxId = `${manifest.run_id}-bt${backtracksUsed}`;
            const backtrackReason = UNTRUSTED_DRIFT_REASON;
            const backtrackProjection = {
              reason: UNTRUSTED_DRIFT_REASON,
              authorized: false,
              // 持久化 drift 指纹供 resume 回放，防重启失忆重复消耗预算。
              drift_fingerprint: driftDecision.driftFingerprint ?? null,
              ...(untrustedDecision ? runDispositionFields(untrustedDecision) : {}),
            };

            goalEvents.emit({
              type: 'phase_backtrack_requested',
              phase: String(phase),
              from_phase: phase,
              to_phase: chain[Math.max(codingIdx, 0)],
              invalidated_phases: invalidatedPhases.map(String),
              ...backtrackProjection,
              files: driftDecision.files.slice(0, 20),
              defects: [],
              fingerprint: driftDecision.driftFingerprint ?? null,
              invalidation_tx_id: invalidationTxId,
            });
            goalEvents.emit({ type: 'phase_backtrack_started', to_phase: chain[Math.max(codingIdx, 0)] });
            // 被失效 attempt 从 outcomes 剔除（goal report/resume 只见最新有效 attempt；
            // 常驻 summary 将被回退后的重跑覆盖，upstream gate 消费面天然新鲜化）
            outcomes = outcomes.filter(o => !invalidatedPhases.includes(o.phase));
            // 增量重点复审清单注入（回退后 review prompt 消费）
            backtrackReviewFocus = driftDecision.files;
            // review 第 10 轮（P1-4）：授权回退**不携带**缺陷清单——必须清空缺陷交接上下文，
            // 否则上一次 visual 回退已修好的旧缺陷会被再次注入 coding prompt。
            backtrackCodingContext = [];
            // 同款纪律（codex 冻结项④）：非 repair 回退必须清空候选交接，否则旧 CR 会
            // 继续注入后续 prompt。
            backtrackRepairCandidates = [];
            backtrackToIdx = Math.max(codingIdx, 0);
            // M1 t1.6（adjudicated-repair-loop）：completed 移到回退链真正完成之后——
            // 目标 coding 执行完毕（settled/verdict）后补发，不再在此提前发射（修 :7592 时序）。
            pendingBacktrackCompletion = {
              toPhase: chain[Math.max(codingIdx, 0)],
              signalDriven: false,
              preSnapshot: null,
            };
            console.log(
              `[a5f9c3e2] 未受信源码漂移（${driftDecision.files.length} 文件）——保守恢复：` +
              '失效旧 coding closure 及其后阶段，携未受信 diff 完整重验（无需人签，不跳过验证）' +
              `→ 回退 ${chain[backtrackToIdx]}→review→ut→${phase}（消耗共用回退预算 ${backtracksUsed}/${DEFAULT_MAX_BACKTRACKS}）`,
            );
            phaseDone = true;
            continue;
          }
          if (driftDecision.kind === 'unauthorized') {
            // T4c（codex 二轮 P1-5）：处置前先快照 harness 证据——UT 实测 PASS 不得在
            // 报告里呈现为「FAIL / Summary —」；outcome verdict=harness 真值 +
            // halted=transition 轴分离。
            const snap = snapshotPhaseHarness(
              projectRoot, manifest.feature, phase, manifest.report_dir, frameworkRoot,
            );
            // T3c：banner/phase_halt 事件/goal-report 单 SSOT——builder 按能力真值分层，
            // 只列当下真正可走的路（旧 banner「写 receipt 后 --resume」属过度承诺，已废）。
            const mutationGuidance = buildUnauthorizedMutationGuidance({
              feature: manifest.feature,
              runId: manifest.run_id,
              phase: String(phase),
              violations: driftDecision.violations,
              // t3②：走到这里说明保守恢复被**结构性前提**挡住（截断链 / 预算耗尽 /
              // 同一 drift 指纹重现）——话术须先讲清这一点，否则人会以为「又是要签字」。
              conservativeRecoveryBlockedReason: untrustedTerminalReason || null,
              chainHasCodingReview,
              harnessPrefixRel: layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness',
            }).join('\n');
            goalEvents.emit({
              type: 'phase_halt',
              phase,
              halt_reason: 'unauthorized_source_mutation',
              verdict,
              files: driftDecision.files.slice(0, 20),
              violations: driftDecision.violations.slice(0, 10),
              halt_guidance: mutationGuidance,
              // t4④：走到这里=保守恢复被结构前提挡住，结构上无法在本 run 继续。
              // 同样投影真实裁决结果，不手写字面量、不重造 Decision。
              ...(untrustedDecision ? runDispositionFields(untrustedDecision) : {}),
              conservative_recovery_blocked: untrustedTerminalReason || null,
            });
            console.error(`\n===== unauthorized_source_mutation =====\n${mutationGuidance}\n`);
            outcomes.push({
              phase,
              verdict, // harness 真值（如 PASS）——transition 由 halted/halt_reason 表达
              halted: true,
              retries,
              halt_reason: 'unauthorized_source_mutation',
              halt_guidance: mutationGuidance,
              summary_path: snap.snapshot_files['summary.json'] ?? summaryPath ?? undefined,
              report_dir: snap.snapshotDirRel,
              snapshot_files: snap.snapshot_files,
              verifier_evidence: snap.verifier_evidence,
            });
            halted = true;
            phaseDone = true;
            continue;
          }
        }

        // 【ui_scope_violation → plan 专用回退分支已删除 · 责任阶段统一路由收编】
        // 该事实现由 harness 侧共享层产出 plan 类 repair candidate（check id 机器归属，
        // 见 repair-candidates.ts CHECK_ID_OWNER_REGISTRY），经 assess 统一裁决走
        // backtrack_to_phase——与 review/ut/testing 缺陷同一条路，不再有平行特例。
        // 未受信上下文交接由候选注入块承担（按目标阶段过滤）。tryScopeReplan 本身保留：
        // plan_authority_unverifiable / invalidation_journal_untrusted 仍是它的触发面。

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
              verifier_evidence: snap.verifier_evidence,
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
              verifier_evidence: snap.verifier_evidence,
          });
          phaseDone = true;
          if (action === 'defer_external_and_halt') {
            halted = true;
          }
          if (featureLock) touchLock(featureLock.path, featureLock.ownerId);
          continue;
        }

        // 【backtrack_to_coding 专用执行分支已删除 · 责任阶段统一路由收编】
        // testing 证据链验真器的 actionable 缺陷现已在上游合并进 summary.repair_candidates
        // （唯一真源），与 review/ut/plan 侧候选走同一条 backtrack_to_phase 路径；
        // 熔断/预算/事件/注入全部复用下面这一份实现，不再有平行特例。

        // t3/三处可见契约（b3f7d9a2 硬学习）：halt 文案的枚举承载处 = phase_halt 事件 /
        // outcome / console banner——detach 停机后宿主只读 events/goal-report，
        // console 早滚走，文案必须同时落事件与 outcome（rebuildOutcomesFromEvents
        // 会把事件 halt_guidance 透传到 report）。
        let backtrackHaltGuidance: string | undefined;
        if (action === 'backtrack_to_phase') {
          const targetPhaseBt = assessment?.recommendation?.phase ?? null;
          const targetIdxBt = targetPhaseBt ? chain.indexOf(targetPhaseBt as FeaturePhase) : -1;
          const upstreamGap = assessment.gaps.find((gap) => gap.phase === targetPhaseBt) ?? null;
          const gapDriven = summaryRepairCandidates.length === 0 && upstreamGap !== null;
          const roundFp = gapDriven
            ? createHash('sha256').update(stableStringify({
                kind: 'upstream_gap',
                current_phase: String(phase),
                target_phase: targetPhaseBt,
                gap_kind: upstreamGap.kind,
                observed_fingerprint: assessment.observed_fingerprint,
              }), 'utf8').digest('hex')
            : roundFingerprintOfCandidates(summaryRepairCandidates);
          // adjudicated-repair-loop M1（review 修复）：eligible 状态已在 assess 前一次性
          // 计算（见 driverGuardAction 链上方 eligibleForBacktrack）——allRepairExhausted
          // 由 guard 前置 halt（唯一裁决面，boundary 发布一致 verdict），本分支只负责：
          //   · 注入过滤：signal@1 只回退 eligible 身份，legacy 原样保留（不误伤）；
          //   · 仍保留既有熔断（target 缺席 / 预算 / 整轮指纹重复）。
          if (targetIdxBt < 0 || backtracksUsed >= DEFAULT_MAX_BACKTRACKS || seenRoundFingerprints.has(roundFp)) {
            action = 'halt';
            haltReason = targetIdxBt < 0
              ? 'backtrack_target_absent'
              : seenRoundFingerprints.has(roundFp) ? 'backtrack_fingerprint_repeat' : 'backtrack_limit';
            // e9d4b7a3 t1：跨 run 修复任务交接指引——候选注入通道只活在当前 run 内，
            // successor 以显式 requirement 增量携带任务点名 + 关键证据摘要。
            backtrackHaltGuidance = haltReason === 'backtrack_target_absent'
              ? buildBacktrackTargetAbsentGuidance(targetPhaseBt ?? null)
              : undefined;
            const limitReached =
              targetIdxBt >= 0 && backtracksUsed >= DEFAULT_MAX_BACKTRACKS && !seenRoundFingerprints.has(roundFp);
            const limitDecision = limitReached
              ? decide(
                  { incident: 'backtrack_limit', phase: String(phase) },
                  NO_AUTHORITY,
                  {
                    orchestration: 'goal', owner_kind: runtimeOwnerKind, can_prompt_now: runtimeOwnerKind === 'session',
                    invocation: argv.resume ? 'resume' : 'fresh',
                  },
                )
              : null;
            goalEvents.emit({
              type: 'phase_halt', phase, halt_reason: haltReason,
              recovery_reason: haltReason,
              target_phase: targetPhaseBt,
              round_fingerprint: roundFp,
              backtracks_used: backtracksUsed,
              backtracks_limit: DEFAULT_MAX_BACKTRACKS,
              ...(limitDecision ? runDispositionFields(limitDecision) : {}),
              ...(backtrackHaltGuidance ? { halt_guidance: backtrackHaltGuidance } : {}),
            });
            console.error(
              `\n===== ${haltReason} =====\n`
              + (backtrackHaltGuidance ?? (haltReason === 'backtrack_fingerprint_repeat'
                ? `整轮 repair candidates 集合与上次回退完全相同（roundFingerprint=${roundFp.slice(0, 12)}…）——继续回退只会空转，进入收敛熔断。\n`
                : haltReason === 'backtrack_limit'
                  ? `回退预算已耗尽（共用 ${DEFAULT_MAX_BACKTRACKS} 次/run）——本 run 诚实终止，可由新 correction/successor 输入继续。\n`
                  : '')),
            );
          } else {
            backtracksUsed++;
            seenRoundFingerprints.add(roundFp);
            // mixed-owner：eligible 过滤后的候选保留（prompt 注入按当前 phase 类别过滤——见
            // buildRepairCandidatesBlock 消费点）；有界 20 条与 testing 通道同款。
            // M1 收敛（review 修复）：signal@1 只注入 eligible（attempted 已排除），
            // legacy 恒 eligible 原样保留——eligibleForBacktrack 在 assess 前一次性算出。
            backtrackRepairCandidates = eligibleForBacktrack.slice(0, 20);
            const invalidatedBt = chain
              .slice(targetIdxBt, phaseIdx + 1)
              .filter(ph => outcomes.some(o => o.phase === ph));
            const txIdBt = `${manifest.run_id}-repairbt${backtracksUsed}`;
            goalEvents.emit({
              type: 'phase_backtrack_requested',
              phase: String(phase),
              from_phase: String(phase),
              to_phase: String(targetPhaseBt),
              invalidated_phases: invalidatedBt.map(String),
              invoke_id: invokeId,
              reason: gapDriven ? 'upstream_gap' : 'repair_candidates',
              ...(gapDriven ? { gap_kind: upstreamGap.kind, gap_detail: upstreamGap.detail } : {}),
              authorized: false,
              round_fingerprint: roundFp,
              // 整组事实（含非目标阶段的分组）——链重走时按阶段过滤注入，不丢 mixed-owner
              candidates: backtrackRepairCandidates.map(c => ({
                id: c.id,
                category: c.category,
                files: c.files.slice(0, 10),
                summary: c.summary.length > 400 ? `${c.summary.slice(0, 400)}…` : c.summary,
                item_fingerprint: c.item_fingerprint,
                source_phase: c.source_phase,
                // M1：signal@1 标记随事件持久化——attempted 回放据此识别信号级候选
                ...(c.identity_schema ? { identity_schema: c.identity_schema } : {}),
              })),
              defect_count: summaryRepairCandidates.length,
              files: [...new Set(summaryRepairCandidates.flatMap(c => c.files))].slice(0, 20),
              fingerprint: roundFp,
              backtracks_used: backtracksUsed,
              backtracks_limit: DEFAULT_MAX_BACKTRACKS,
              invalidation_tx_id: txIdBt,
            });
            console.error(
              `\n===== backtrack_to_phase =====\n`
              + (gapDriven
                ? `${phase} 检出 earlier ${upstreamGap.kind} gap（${upstreamGap.detail}）——责任阶段=${targetPhaseBt}。\n`
                : `${phase} 检出 ${summaryRepairCandidates.length} 项可信可修缺陷（`
                  + summaryRepairCandidates.slice(0, 6).map(c => `${c.id}→${c.category}`).join('、')
                  + `）——责任阶段=${targetPhaseBt}。\n`)
              + `回退 ${targetPhaseBt}（候选清单按阶段注入后续 prompt），再级联重走下游。\n`
              + `（第 ${backtracksUsed} 次回退，共用预算 ${DEFAULT_MAX_BACKTRACKS} 次/run）\n`,
            );
            outcomes = outcomes.filter(o => !invalidatedBt.includes(o.phase));
            goalEvents.emit({ type: 'phase_backtrack_started', to_phase: String(targetPhaseBt) });
            // M1 t1.5/t1.6（adjudicated-repair-loop）：回退链完成跟踪——completed 在目标
            // phase 真正执行完（settled/verdict 在案）后补发；signal@1 驱动时拍 pre 快照
            // 供目标 phase settle 后的 no-op 判定（pre/post 相等 → result='noop' + 停等）。
            pendingBacktrackCompletion = {
              toPhase: String(targetPhaseBt),
              // 仅当本轮有 signal@1 候选实际进入回退才做 no-op 快照判定
              signalDriven: eligibleForBacktrack.some((c) => c.identity_schema === 'signal@1'),
              preSnapshot:
                eligibleForBacktrack.some((c) => c.identity_schema === 'signal@1')
                  ? computeProductSourceSnapshotDetail(
                      projectRoot, productLayerDirsOf(projectRoot), manifest.feature,
                    )
                  : null,
            };
            phaseIdx = targetIdxBt - 1; // for 循环 ++ 后落回目标阶段
            phaseDone = true;
            if (featureLock) touchLock(featureLock.path, featureLock.ownerId);
            continue;
          }
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
              goalEvents.emit({ type: 'budget_wall_clock', phase });
              const wallGuidance = emitWallBudgetHaltGuidance(String(phase));
              outcomes.push({
                phase,
                verdict: 'FAIL',
                halted: true,
                retries,
                halt_reason: 'budget_wall_clock',
                halt_guidance: wallGuidance,
              });
              phaseDone = true;
              continue;
            }
            goalEvents.emit({
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
            // PASS+超时仍必须计入本 phase 的 assess retry budget；否则叠加
            // insufficient_assurance/advance_blocked 时 retries_used 永远为 0，只能靠全局轮数兜底。
            retries++;
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
          // plan e7c2a4d8 T3c（codex 二轮采纳）：凡有 guidance 一律附着——渲染侧
          //（goal-report-generator）本已 reason 无关，枚举白名单是第三处漂移点，废。
          ...(awaitConfirmGuidance ? { halt_guidance: awaitConfirmGuidance } : {}),
          // e9d4b7a3 t1（review1 阻断）：backtrack_target_absent 的 successor 交接指引
          // 三处可见（事件/outcome/console）——detach 停机后宿主只读 events/report。
          ...(backtrackHaltGuidance ? { halt_guidance: backtrackHaltGuidance } : {}),
          // P0-5：integrity subtype 多值透传进最终报告。
          ...(integritySubtypes.length > 0 ? { integrity_subtypes: integritySubtypes } : {}),
          interaction_question: interactionSentinel?.error,
          // codex P3：诊断保真进最终报告——只读 goal-report 的下游也能看到真因原文。
          ...(currentFailureProjection.failureKindForEvent
            ? { failure_kind_classified: currentFailureProjection.failureKindForEvent }
            : {}),
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

    if (runtimeBoundaryYielded) {
      // An attended authorization/round limit is a cooperative yield, not a terminal outcome.
      // The same run remains attachable; suppress the CLI process-exit interruption backstop.
      runConcluded = true;
      progressSubstep = null;
      progressPhase = null;
      progressHeartbeatHook = null;
      flushProgress(true, true);
      return 0;
    }

    const reachedEnd =
      !halted &&
      outcomes.length === chain.length &&
      outcomes[outcomes.length - 1]?.phase === chain[chain.length - 1];

    // 全链跑完时消费与 completion 同源的 issue 集。legacy needs_human 会在 collector 中
    // 重投影为 needs_fix；当前 writer 不再生成 AWAITING_HUMAN_REVIEW。
    let pendingHumanReview = false;
    let blockingFix = false;
    if (reachedEnd) {
      // codex 收口刀（宿主实锤 run 20260815T093217Z-42d1bc）：本次 run 终态分类只看**实际
      // 执行切片** chain——传 fullWorkflowChain 会把「下游阶段尚未跑」判成 needs_fix，
      // spec-only run 只按实际切片分类。feature completion
      // 生成（verify-feature-completion 调用侧）继续用完整链，语义不同：那是「feature
      // 是否整体完成」，这里是「本 run 跑过的部分是什么终态」。
      const cls = classifyCleanPassIssues(
        collectCleanPassIssues({
          projectRoot,
          feature: manifest.feature,
          chain: chain.map(String),
          currentRequirementSha: computeRunRequirementSha(projectRoot, manifest.feature, manifest.run_id, featuresDir),
          frameworkRoot,
        }),
      );
      pendingHumanReview = cls.needsHuman;
      blockingFix = cls.needsFix;
      if (process.env.MAISON_TEST_PROBE === '1') {
        console.error(`[probe-cls] ${JSON.stringify(collectCleanPassIssues({
          projectRoot,
          feature: manifest.feature,
          chain: chain.map(String),
          currentRequirementSha: computeRunRequirementSha(projectRoot, manifest.feature, manifest.run_id, featuresDir),
          frameworkRoot,
        }))}`);
      }
    }
    // 账本 must_review 不再控制 run 终态（codex 收口刀：账本仅留痕与报告展示——跨 run
    // 累积的 45 条历史待复核曾把终态永久压住，旧行又不可消解）。未达链尾的 run 保持
    // pendingHumanReview=false；未闭合机器证据仍在 goal-report 自动决议汇总里完整呈现。
    // 【已删除 · 收口刀二（codex P2）】`uiRelevantAtEnd` 运行末态 UI 相关性判定——
    // 唯一消费者 capRunStatusForVisionTrust 已删（完成态不再因认证状态封顶），只算不用。
    const rawStatus = resolveGoalRunStatusFromOutcomes(
      outcomes,
      reachedEnd,
      { pendingHumanReview, blockingFix },
    );
    // 【已删除 · 垂直闭环追补（codex 第九批 P0 + 2026-08-06 理念裁定）】
    // `capRunStatusForVisionTrust`（七轮 P0-1 的 vision 信任封顶）：UI run 未配 HMAC
    // 密钥/仅弱 ack 时曾封顶人工等待态。按裁定"完成态不再因认证状态
    // 封顶"整体删除——防伪造主防线是终点验收不信 agent 自报（视觉裁判去自报化 +
    // pixel_1to1 机器证据），认证状态彻底退出执行控制面与完成态语义。
    // 注意与下方设备真实性封顶的区别：那是「模拟器结果不能冒充真机行为」的**诚实
    // 完成度表达**（三分类里的防假绿面），不属防伪造类，保留。
    // openspec device-readiness-and-completion t2：设备真实性封顶。
    // 只有 testing 真的跑过才判——纯 spec/plan/coding/ut 链路与设备无关，不受影响。
    const testingRan = outcomes.some(o => o.phase === 'testing');
    const deviceCap = capRunStatusForDeviceAuthenticity(rawStatus, {
      testingRan,
      targetKind: lastTestingTargetKind,
    });
    if (deviceCap.capped) {
      goalEvents.emit({
        type: 'device_authenticity_completion_cap',
        from: rawStatus,
        to: deviceCap.status,
        reason: deviceCap.reason,
        target_kind: lastTestingTargetKind,
      });
      console.warn(
        `[device] 设备真实性封顶：${rawStatus} → ${deviceCap.status}（${deviceCap.reason}）——` +
          'testing 未在已确认的真机上执行，不得宣称完整通过；接真机后重跑可解除。',
      );
    }
    const status = deviceCap.status as ReturnType<typeof resolveGoalRunStatus>;
    // t5④：报告用的 phases 必须携带**生产端真实投影**（report 端禁止重算）
    const reportEvents = loadAuthoritativeEvents(
      path.join(projectRoot, manifest.report_dir, 'events.jsonl'),
    ) as unknown as Array<Record<string, unknown>>;
    const enrichedOutcomes = enrichOutcomesWithProjection(outcomes, reportEvents);
    const report = generateGoalReportJson(
      manifest.run_id,
      manifest.feature,
      status,
      enrichedOutcomes,
    );
    writeGoalReport(projectRoot, manifest.report_dir, report, {
      workflowChain: fullWorkflowChain.map(String),
    });
    // t3-min v3（codex 高优6 / openspec capability-gap-preflight）：terminal event 携带
    // halt_reason——取最后一个 halted outcome 的原因（await_human_capability_gap 等），
    // 消费方无需回扫 phase_halt 事件即可分类终态。v5 抽 helper 使语义可单测。
    const lastHaltReason = resolveLastHaltReason(outcomes);
    // runner-owned-machine-facts 追补（codex 定点，二轮修正）：结构敏感 incident 的
    // run_end 不能靠写盘层兜底投影（withRunDisposition 拒绝化妆是设计正确的）——把
    // phase_halt 生产点已算好的投影（经 enrichOutcomesWithProjection 从 events 回放）
    // 显式复制到 run_end。**reason 与 disposition 必须取自同一个「最后 halted outcome」**：
    // 分别检索"最后 halt reason"与"最后带投影的 halt"会在最新 halt 无投影时借用更早
    // halt 的 disposition（张冠李戴）；最新 halt 无投影时宁缺（不二次 decide()）。
    const lastHalted = [...enrichedOutcomes].reverse().find((o) => o.halted) as
      | (Record<string, unknown> & { run_disposition?: unknown; run_wait_kind?: unknown })
      | undefined;
    const lastHaltedProjected =
      lastHalted && typeof lastHalted.run_disposition === 'string' ? lastHalted : undefined;
    goalEvents.emit({
      type: 'run_end',
      status,
      ...(status === 'HALTED' && lastHaltReason ? { halt_reason: lastHaltReason } : {}),
      ...(status === 'HALTED' && lastHaltedProjected
        ? {
            run_disposition: lastHaltedProjected.run_disposition,
            ...(typeof lastHaltedProjected.run_wait_kind === 'string'
              ? { run_wait_kind: lastHaltedProjected.run_wait_kind }
              : {}),
          }
        : {}),
    });

    // P0-4（rev8 偏离① 定稿口径）：硬上界只覆盖 agent/harness/backoff 三路径；run_end 后
    // 收尾为 **pre-check 拦截的 best-effort**——同步 fs 工作无进程内可执行 bound（同步
    // 挂起时 timer/watchdog 均不运行），硬中断=进程自杀会写坏 receipt。本 pre-check 挡
    // "开始前已超支"（finalize_skipped）；已开始步骤的越界由下方 finalize_overrun 事件
    // 如实记录（喂开放问题 4 的 reserve 取值回灌）。真硬界=worker/child 隔离，开放问题 5。
    const finalizeStartMs = Date.now();
    const finalizeDeadlineExceeded = finalizeStartMs > wallDeadlineMs;
    if (finalizeDeadlineExceeded) {
      goalEvents.emit({
        type: 'finalize_skipped',
        phase: undefined,
        // T2(c)：如实说明跳过的是 completion receipt 等收尾——goal-report 本身已在
        // 本预检之前生成（v2 归因自误的修正记录见 plan e7c2a4d8）。
        reason: 'wall deadline 已过——跳过 completion receipt 等 best-effort 收尾（goal-report 已生成）',
      });
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
          frameworkRoot,
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
      goalEvents.emit({
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

    // b7e4d2a9 Todo2：**成功封卷 → 本 run 场外 trust 状态立即回收**（临时恢复区语义：
    // 封卷后同 run 永拒 resume，状态无保留价值）。触发仅 CHAIN_SLICE_COMPLETED（legacy
    // COMPLETED 只参与 sealed 判定不触发回收；HALTED/PARTIAL/AWAITING_HUMAN_REVIEW/
    // DEFERRED* 可恢复态全保留）。位置=全部终局收尾结束（run_end/completion receipt/
    // finalize_overrun/progress 终刷）之后、持 feature lock、return 前 best-effort；
    // 失败仅记录，绝不影响退出码；dry-run 零接触。
    if (!dryRun && status === 'CHAIN_SLICE_COMPLETED') {
      const gc = deleteRunTrustState({ projectRoot, feature: manifest.feature, runId: manifest.run_id });
      if (gc.diagnostics.length > 0) console.warn(`[trust-gc] 封卷回收诊断：${gc.diagnostics.join('；')}`);
      if (gc.deleted.length > 0) console.log(`[trust-gc] 封卷回收：${gc.deleted.join('、')}`);
    }

    // openspec device-readiness-and-completion t2：托管模拟器回收（**任何终态**都回收——
    // 不像 trust 状态只在封卷回收：模拟器是本 run 借用的机器资源，HALTED 也该还）。
    // 只回收本 run 启动的实例；用户自开实例、PID 重用、exe 不符一律拒绝（见
    // reclaimManagedDevice 的四元组校验）。崩溃路径回收不了——那由下次启动对账兜底。
    if (!dryRun) {
      // 正常终态回收：先摘信号钩子，避免 exit handler 再回收一次
      releaseManagedDeviceCleanup?.();
      releaseManagedDeviceCleanup = null;
      const outcome = reclaimManagedDevice(
        readDeviceSession(projectRoot, manifest.report_dir),
        defaultProcessProbe(),
      );
      if (outcome.action === 'reclaimed') {
        console.log(`[device] 已回收本 run 托管的模拟器（pid=${outcome.pid}）`);
        writeDeviceSession(projectRoot, manifest.report_dir, {
          serial: null, target_kind: 'unknown', started_by_run: null, status: 'released',
        });
      } else if (outcome.action === 'refused') {
        console.warn(`[device] 托管实例未回收：${outcome.reason}`);
      }
    }

    emitMilestone(`GOAL_RUN event=end status=${status} run_id=${manifest.run_id}`);
    console.log('');
    console.log('GOAL_RUN_SUMMARY');
    console.log(`run_id=${manifest.run_id}`);
    console.log(`status=${status}`);
    console.log(`report_dir=${manifest.report_dir}`);
    console.log(`phases=${outcomes.map((o) => o.phase).join(',')}`);
    console.log(`agent_invokes=${countAgentInvokeStarts(loadAuthoritativeEvents(eventsPath))}`);

    if (status === 'HALTED') return 1;
    if (status === 'DEFERRED' || status === 'DEFERRED_CAPABILITY_MISSING' || status === 'PARTIAL') return 2;
    return 0;
  } catch (err) {
    // T1①：run 身份已建立的任何未处理异常 → 优雅收口（run_end + 报告），返回 1。
    // 身份未建立（manifest 解析前）→ 照旧抛给 CLI（那里没有可收口的 run）。
    if (!concludeInterruptedRun(err)) throw err;
    console.error(
      `\n[goal-runner] run 因未处理异常中断——已优雅收口（run_end{INTERRUPTED} + 报告已落盘）：\n`
      + `${(err as Error)?.message ?? err}`,
    );
    return 1;
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
export function runGoalPhaseRuntimeProcessCli(): void {
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

if (require.main === module) {
  runGoalPhaseRuntimeProcessCli();
}
