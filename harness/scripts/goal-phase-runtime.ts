#!/usr/bin/env ts-node
import { adapterModelBinding, freezeModelPin, launchModelPin, parseAdapterModelBinding, modelMismatchInEvents, rebindTaskModel } from './utils/adapter-model';
import { collectActionableDefects, resolveCurrentHapSha256Full, validateDeviceTestEvidenceBinding, readFreshVisualDisposition, type ActionableDefect, type UnverifiedDefect, type ActionableCollectResult, type DeviceTestCollectContext } from './utils/actionable-evidence';
export { collectActionableDefects, resolveCurrentHapSha256Full, validateDeviceTestEvidenceBinding, readFreshVisualDisposition } from './utils/actionable-evidence';
export type { ActionableDefect, UnverifiedDefect, ActionableCollectResult, DeviceTestCollectContext } from './utils/actionable-evidence';
import { pendingPublishedDesignRepair } from './utils/design-repair-unattended';
import { resolveValidationOnlyEligibility } from './utils/goal-runner-phase';
import { sessionExecutionDeadlineMs, sessionExecutionTransportInstructionSuffix, issueSessionExecution, writePhaseExecutionRequestMaterial, resignSessionExecution, readSessionExecution, inspectSessionExecutionBeforeRuntime, undeliveredSessionInvocation, executionRequestForInvoke, sessionExecutionForInvoke, sessionToolEventsLogPath, readHandoffMaterial, acceptedSessionReport, acceptSessionExecution, uncommittedSessionReport, sessionValidationOnlyEligibility, type IssuedSessionExecution, type SessionExecutionReport } from './utils/session-execution-handoff';
import { AttendedGoalPhaseExecutor, observeWorkUnitProviderSession, authorUnit, workUnitFeedbackDelivered, type WorkUnitInput } from './utils/goal-phase-executor';
import { applyIndependentQuestioningOutput, independentQuestioningBlockers } from './utils/blueprint-questioning';
import { validateComponentBlueprint } from './utils/component-blueprint-validator';
import { invocationCompleted, invocationEndFacts, invocationWaitingDetail } from './utils/invocation-completion';

function recoverableProviderSessionFailure(context: WorkUnitExecutionContext, result: Pick<GoalPhaseExecutorResult, 'nativeSessionRebuildReason'>): boolean {
  return !!context.provider_session_id && ['provider_session_not_found', 'provider_session_id_conflict',
    'provider_session_resume_not_accepted'].includes(result.nativeSessionRebuildReason ?? '');
}
/** Fixed transport backoff for model-API drops/429 (P0-D schedule); a tool-level retry, not a configurable work quota. */
const TRANSIENT_API_BACKOFF_MS = [5_000, 15_000, 45_000] as const;

function latestProviderSessionCanRebuild(runDir: string, events: readonly GoalRunEvent[]): boolean {
  const end = [...events].reverse().find(event => event.type === 'agent_invoke_end');
  const original = end?.invoke_id ? executionRequestForInvoke(runDir, end.invoke_id) : null;
  const reason = end && (end as Record<string, unknown>).nativeSessionRebuildReason;
  return !!original && typeof reason === 'string' && recoverableProviderSessionFailure(original.request.context, { nativeSessionRebuildReason: reason });
}
function explicitUserContinuation(forceResume: boolean, events: readonly GoalRunEvent[]): boolean {
  if (!forceResume) return false;
  const restart = events.map(event => event.type === 'supervisor_restart').lastIndexOf(true);
  return restart < 0 || events.slice(restart + 1).some(event => event.type === 'run_start' || event.type === 'resume');
}
function hasNewWorkConditions(facts: { returned: boolean; explicitlyContinued: boolean; materialChanged: boolean; productChanged: boolean; scopeChanged: boolean }): boolean {
  return !facts.returned || facts.explicitlyContinued || facts.materialChanged || facts.productChanged || facts.scopeChanged;
}
import { resumeIssuedSessionOwner } from './utils/goal-run-control';
import { buildGuardianInvocation, resolveAgentCommand } from './utils/agent-containment';
import { resolveTaskAutomationPolicy } from './utils/runtime-policy';
import { createIdentityNeutralDigestReaders, type IdentityNeutralDigestReaders } from './utils/identity-neutral-digest';
import { parseVerifierRequest, parseVerifierRequestFromInstruction, canonicalRequestInput } from './utils/verifier-request';
import { findUnreadableDiagnosisChecks } from './utils/repair-candidates';
import { validateProjectRelativePath, isInsideProjectRoot } from './utils/project-relative-path';
import { loadVerifierEvidence } from './utils/verifier-evidence';
import { diffChangedFiles, resolveEffectiveDiffBaseline } from './utils/git-diff';
import type { GoalRunEvent } from './utils/goal-runner-phase';
import { executionCompletionPhases, resolveExecutionScope, executionScopeFingerprint, validateExecutionScope, assertRevisionKeepsRequiredObligations, hasNewSourcedFact, affectedScopePhases, authorizedScopePhases, isEffectivePhasePass, type ExecutionScope, type ExecutionScopeInput } from './utils/execution-scope';
import { loadFeatureContracts, contractFingerprint, assuranceSatisfies } from './utils/skill-contract';
import { loadPhaseEvidenceManifest, resolvePhaseEvidenceManifest, recomputeManifestAggregate, writePhaseEvidenceManifest, currentEvidenceEntryHash } from './utils/phase-evidence-manifest';
import { readScopeAcceptance, collectResolvedScopeFacts, recomputeDefinitionFacts, resolveScopeRevisionProposal, resolveCurrentScopeView, readScopeProofHistory } from './utils/feature-track';
import { resolveBirthScopeForManifest, resolveSuccessorExecutionScope, registerFeatureScopeTransfer } from './utils/feature-execution-scope';
import { featureFilePath } from '../config';
import { designDeliveryNextStep } from './utils/design-delivery-entry';
// ============================================================================
// Goal work-unit runtime — current obligations with fenced native sessions
// ============================================================================
// Usage (from repo root or instance root):
//   cd framework/harness && npx ts-node scripts/goal-runner.ts \
//     --feature <f> --requirement "..." --adapter claude \
//     [--start spec] [--end testing] [--dry-run] [--resume <run-id> --feature <f>]
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import * as YAML from 'yaml';
import { randomUUID } from 'crypto';
import { findInitialDesignRun, prepareInitialDesignRun, readInitialDesignDelivery, readInitialDesignCompletionDisposition, projectInitialDesignDelivery, initialDesignAuthorInstruction, initialDesignInvocationLabel, validateInitialDesignInvocation, prepareInitialDesignDraft, type InitialDesignObservation } from './utils/initial-design-delivery';
import { readOriginalDeliveryActivity, originalDeliveryForManifest } from './utils/delivery-origin';
import { writeCanonicalComponentClosure } from './check-component-closure';
import { runChangeUnitProgression, buildChangeUnitGoalHandoff, buildChangeUnitGoalRequest, type ChangeUnitGoalHandoff } from './utils/change-unit-progress-loop';
import { featureTrackDeclPath, resolveFeatureExecutionScope, prepareChangeUnitScopeInput, prepareFeatureScopeCandidate } from './utils/feature-track';
import { deriveModifiableModules } from './utils/change-unit-feature-projection';
import { resolveBirthExecutionScope, readFeatureFrozenScope } from './utils/feature-execution-scope';
import { isInitialDesignManifest, loadGoalRunManifestFromRun, type InitialDesignGoalManifest, type GoalRunManifest } from './utils/goal-manifest';
import { writeBackAdmission, refreshBlueprintFingerprints } from './utils/design-repair-unattended';
import { loadCanonicalBlueprint, componentBlueprintPath } from './utils/component-blueprint-path';
import { asRecord, blueprintAuthorContent } from './utils/component-blueprint-model';
import { materializeBlueprintReview } from './utils/blueprint-review-materialization';
import { acceptChangeUnitDecomposition, deriveDesignPreparationReadiness } from './utils/change-unit-design-preparation';
import type { ChangeUnitCandidate } from './utils/change-unit-provider-boundary';
import { evaluateComponentClosure } from './utils/component-closure-validator';
import { deriveChangeUnitBlockers } from './utils/change-unit-blockers';
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
  relFeaturesDir,
  resolveFeatureArtifact,
} from '../config';
import { detectRepoLayout, type RepoLayout } from '../repo-layout';
import { deleteEnvKeyCaseInsensitive, sanitizeSpawnEnv } from './utils/process-integrity';
// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT（goal-runs 等路径必须经它展开）
import { featureRelativePath } from './utils/feature-identity';
// d9e4b7c1 T2：device_test 缺陷进回修环——evidence schema/路径、权威 trace 二次核验、根/级联三分
import {
  deviceTestEvidencePath,
  type DeviceDefectClassification,
  type DeviceTestEvidenceCase,
  type DeviceTestEvidenceDoc,
} from './utils/device-test-evidence-shared';
import {
  buildProductSelectionUnresolvedGuidance,
} from './utils/await-confirm-guidance';
import {
  decide,
  NO_AUTHORITY,
  runDispositionFields,
  UNTRUSTED_DRIFT_REASON,
  withRunDisposition,
  type Decision,
} from './utils/adjudication';
import { assessLivenessBeacon, readLivenessBeacon, writeLivenessBeacon } from './utils/liveness-beacon';
import { loadResolvedProfile } from '../profile-loader';
// plan a7c3e9d2：作者前置输入 formatter（文件路径 / 函数名 / 签名 / 标题与主干 extension-runtime.ts 对齐）
import { assembleKnowledge, renderKnowledge } from './utils/knowledge-context';
import { readRunBoundContracts } from './utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput, loadCompletedFactsBaseline } from './utils/capability-resolution-entry-input';
import { SpecLoader } from './utils/spec-loader';
import { tryLoadUtSourceRootResolver } from '../profile-host-loader';
import { runCapabilityPreflight, emitHarnessPreflightGap } from './utils/capability-preflight';
import { preflightDeviceTestEvidenceCapability } from '../capability-registry';
import type { CheckResult, HarnessResolvedProfile, ProviderRef, VisionMode } from './utils/types';
import { workflowForExistingRun, resolveWorkflowSpec } from '../workflow-loader';
import { resolveContextAdapterImageInput, isFreshCanaryForExecution } from './utils/multimodal-probe';
import { loadLocalConfig as loadFrameworkLocalConfig, warnRetiredModelAlternatives, resolveUnattendedB1Repair } from './utils/framework-local-config';
import {
  designRepairInvokeLabel,
  designRepairSignature,
  deriveDesignDeclineFeedback,
  designRepairInputFingerprint,
  designRepairTarget,
  designWorkSnapshot,
  reusableDesignQuestioning,
  readDesignQuestioningOriginal,
  recordDesignRepairInvocation,
  DESIGN_REPAIR_CONTRACT_DOC,
  runUnattendedDesignRepair,
  type DesignRepairInvokeOutcome,
  type DesignRepairPurpose,
  type DesignRepairInvocationGuard,
  type DesignRepairBriefLike,
  type UnattendedDesignRepairResult,
} from './utils/design-repair-unattended';
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
import { assembleGoalBrief, EXECUTOR_BRIEF_SECTIONS, renderGoalBrief } from './utils/goal-brief';
import {
  parseUiChangeFromSpecMarkdown,
  parseVisualHandoffYamlRoot,
  UI_CHANGE_REQUIRES_UI_SPEC,
} from './utils/ui-spec-shared';
import {
  featurePhasesFromWorkflow,
  formatDeferredUpstreamNotice,
  resolveAutoChain,
  type FeaturePhase,
  type GoalRunStatus,
  type HarnessVerdict,
} from './utils/phase-transition-policy';
import { createRuntimeArtifactPredicate, recomputePhaseEvidenceStaleness, phaseEvidenceBusinessInputs, phaseEvidenceManifestPath, stableStringify } from './utils/phase-evidence-manifest';
import { loadReviewClosureAttestation } from './utils/closure-attestation';
import {
  classifyCleanPassIssues,
  collectCleanPassIssues,
  generateFeatureCompletion,
  shouldGenerateFeatureCompletion,
  applicableCheckFamilies,
  resolvePhaseRunIds,
} from './utils/verify-feature-completion';
import { assessFeature as assessFeatureCompletion } from './utils/feature-assessment';
import { parseChangeUnitFeatureId, pointerStaleCandidate, deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits } from './utils/change-unit-path';
import { reconcileChangeUnitBlueprintRefs, type BlueprintRefReconciliation, type HeldFeatureLock } from './utils/change-unit-design-preparation';
import { BlueprintProjectionPreparationError, materializeBlueprintSkillInputs, classifyDesignAuthorityCodes, diagnoseDesignAuthority, blueprintSourceRefFiles, type DesignAuthorityFinding, type DesignRepairClass } from './utils/blueprint-skill-projection';
import { requiredSummaryCheckGaps, phaseCompletionProblems, renderCurrentDisposition, resolveCurrentDisposition, type CurrentDisposition } from './utils/check-disposition';
import { collectPhaseCompletionIssues, resolveCompletionDisposition, readPhaseChecks, currentCompletionEvaluation, readReusableCheckResult, readCurrentCheckObservation, hasChangedVerifierMaterialInputs,
  completedCheckResultsFromToolEvents, completedCheckResultsFromOutput, completionProgressFromHistory } from './utils/verify-feature-completion';
import { readCurrentDispositionInput } from './utils/verify-feature-completion';
import { reduceRunState } from './utils/run-state-reducer';
import { resolveFeatureTrack, LEGACY_FEATURE_PHASE_ORDER } from './utils/runtime-policy';
import { loadAcceptanceFlowsDoc, resolveP0DeviceObligations } from './utils/p0-semantic-gates';
import { loadFeatureTrackDecl } from './utils/feature-track';
import { mergeUsageIntoTraceFile } from './utils/usage-capture';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  computeManifestIdentityHash,
  diffManifestIdentityFields,
  inheritSuccessorManifest,
  SCOPE_REVISION_FIELDS,
  loadGoalManifestFile,
  loadGoalManifestDefinition,
  loadGoalManifestFromRun,
  newRunId,
  resolveGoalReportDir,
  resolvePersistedAdapterProvenance,
  resolveRawRunInput,
  resolveRequirementInput,
  restoreFrozenAdapterProvenance,
  type RawRunInput,
  isSuccessorRepairRequirement,
  deriveSuccessorRequirement,
  overrideAuthorizedIdentityFields,
  parseUserDeadlineAt,
  writeGoalManifest,
  effectiveHeadlessUnattended,
  type GoalManifest,
  RUN_ADAPTER_PROVENANCES,
  type RunAdapterProvenance,
} from './utils/goal-manifest';
import {
  assertGoalRunAttachable,
  buildSupersedeAuditEvent,
  createGoalRun,
  decideRunContinuation,
  deliveryCycleView,
  resolveEffectiveScopeSource,
  successorCatchUpTargets,
  successorBoundsConflicts,
  successorBoundsRefusal,
  evaluateFreshRunContinuation,
  staleFrozenBindings,
  loadEffectiveExecutionScope,
  applyScopeRevisions,
  eventsWithScopeRevocations,
  resolveRunBaseline,
  loadScopeRevisions,
  validateExactSha,
  inspectGoalRunCreation,
  inspectGoalRunCreationFiles,
  resolveActualGoalPhaseChainAtBirth,
  resolveGoalRunHeadSha,
  validateRebaselineRequest,
  normalizeRelatedPath,
  readRecordedRelatedHashes,
  resolveDeliveryCycleBoundary,
  manifestFileRepeatsRun,
  type ContinuationCallFacts,
  type GoalRunCreationResult,
  type RunContinuationDecision,
} from './utils/goal-run-creation';
import { resolveGoalRunBaseline } from './utils/goal-run-baseline';

// openspec device-readiness-and-completion t3：设备就绪门（独立异步门，排在 capability
// gate 之后、agent_invoke_start 之前；未 READY 不调 agent）
import { chainRequiresDevice, phaseRequiresDevice, phaseHasNativeExecution } from './utils/phase-device-requirement';
import {
  chainRequiresProduct,
  goalProductPurpose,
  resolveProductSelectionViaProfile,
} from './utils/product-selection-bridge';
import { runDeviceReadinessGate } from './utils/device-readiness-gate';
import {
  runConditionProbe,
  waitForConditionRecovery,
  type ConditionProbeResult,
} from './utils/condition-wait';
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
  resolveAgentOutputIdleMs,
  agentEventsLogPath,
  extractProviderFinalText,
  readInvokeFinalText,
  createChildSettleWaiter,
  killProcessTree,
  probeAdapterVersion,
  resolveHeadlessInvokePlan,
  type HeadlessInvokePlan,
  type InvokeTemplateVars,
} from './utils/agent-invoke';
import {
  createWorkUnitExecutionContext,
  workUnitExecutionInputs,
  workUnitExecutionRole,
  workUnitNativeReadonly,
  DetachedGoalPhaseExecutor,
  validateWorkUnitExecutionContext,
  type GoalPhaseExecutor,
  type GoalPhaseExecutorResult,
  type WorkUnitExecutionContext,
  type WorkUnitExecutionControls,
} from './utils/goal-phase-executor';
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
  resolveInvokeHardCliFailure,
  isModelUnsupportedFailure,
} from './utils/vision-canary';
import { generateRandomCanaryAnswerKey, type CanaryAnswerKey } from './utils/vision-canary';
import * as os from 'os';
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
  collectLastCommittedVisualAttemptWindow,
  collectUncommittedVisualAttemptIds,
  collectVisualRoundRowHashes,
  countAgentInvokeStarts,
  readExecutionActivity,
  readSupersededAncestorRuns,
  countTransientApiRetries,
  findLastRunEnd,
  isAgentNoOutputSignal,
  lastPhaseVerdictTransientApiError,
  getSummaryMtime,
  isSummaryFresh,
  findLatestInvokeHarnessFailure,
  loadAuthoritativeEvents,
  invocationOutputLogPath,
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolvePhaseHarnessVerdict,
  repairInvocationCompleted,
  repairWindowCompleted,
  collectSupersededAncestorEvents,
  rebuildOutcomesFromEvents,
  loadEventsJsonlStrict,
  countCumulativeAdvanceBlocked,
  phaseInvocationStart,
  type ContinuationCause,
} from './utils/goal-runner-phase';
import { finalizePhaseClosure } from './utils/phase-closure-finalizer';
import {
  awaitGuardianGone,
  classifyGuardianBinding,
  identifyWithRetry,
  pidExists,
  reconcileGuardianOwnership,
  terminateGuardianProcessOnly,
  type GuardianBoundRecord,
} from './utils/goal-containment-reconcile';
import {
  reconcileLedgerWithEvents,
  visualRoundsLedgerPath,
} from './utils/visual-rounds-ledger';
import {
  applyClosurePatchFromReceiptValidation,
  applyGoalModelPinEnv,
  applyGoalVisualProviderEnv, readGoalVisualProviderEnv,
  hasGoalExecutionSignal,
  isGoalHeadlessEnv,
  MAISON_GOAL_MODEL_PIN_ENV,
  MAISON_GOAL_RUNNER_ENV,
  runSyncClosureDetailed,
  syncPhaseStateOnReceiptPassStrict,
  tryValidateReceipt,
} from './utils/phase-state';
import {
  actionableDefectsToCandidates,
  declineDisputeLines,
  isRebuttalAppearance,
  loadRepairDeclineState,
  readPhaseRepairIssues,
  buildCurrentVerifierDiagnosisContext,
  REPAIR_DECLINE_GATE_PREFIX,
  resolveInvalidatablePhases,
  restoreBacktrackCandidatesFromEvents,
  formatRepairEvidenceRefs,
  formatRepairLocalDiagnosis,
  serializeBacktrackRepairCandidate,
  scopeRevisionInputFromRepairCandidates,
  itemFingerprintOf,
  type RepairCandidate,
} from './utils/repair-candidates';
import { resolveRepairResponsibility, repairResponsibilityContext, readRepairDependencyContext, independentArtifactRepairs } from './utils/repair-responsibility';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import { deriveReconcileObservation } from './utils/goal-reconcile-observation';
import { validateMinimumAssurance } from './utils/skill-contract';
import {
  assessFeature,
  assessObservation,
  observeFeatureState,
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
  VISION_CANARY_TIMEOUT_MS,
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
  resolveVisualProviderCliSelection,
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
  compareRelatedInputSnapshots,
  buildEffectiveBlockerSignature,
  classifyFailureKind,
  classifyTimedOutWithFreshBlockers,
  resolveBlockerActionability,
  extractDeterministicAffectedFiles,
  extractContentRelatedFiles,
  extractIntegritySubtypes,
  stripRetiredFrameworkIntegrityForCurrentRun,
  isOperatorInterruptSignal,
  evaluateCompletionProgress, hasFindingIdentities, nativeCompileDiagnosticRefs, dispositionFacts, type CompletionEvaluation,
  snapshotArtifacts,
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
  workUnitProtectedRecordPaths,
  classifyPhaseInvocationChanges,
  diffPhaseInvocationSnapshots,
  renderPhaseWriteBoundaryGuidance,
  resolvePhasePathOwnership,
  resolvePhaseWriteBoundary, authorWritePreimages, unrestoredAuthorWrites,
  type PhaseWriteBoundaryResolution,
  type PhaseInvocationChange,
} from './utils/phase-write-boundary';
// plan f4c8d2b7 t6：ut 阶段 prompt 注入机器产物格式契约（路径解析自 skill-assets SSOT）
import { renderUtFormatContractLines } from './utils/ut-template-paths';

/** 产品源码层目录（architecture.outer_layers）——快照范围；配置不可读 → 空集（消费点 fail-closed） */
function productLayerDirsOf(projectRoot: string): string[] {
  try {
    return (loadFrameworkConfig(projectRoot).architecture?.outer_layers ?? []).map(l => l.id);
  } catch {
    return [];
  }
}

interface BacktrackProcessLocations {
  feature: string; frameworkRoot?: string; phaseOrder?: readonly string[]; targetPhase?: string;
}

function createBacktrackProcessPredicate(projectRoot: string, locations?: BacktrackProcessLocations): (rel: string) => boolean {
  if (!locations) return () => false;
  const { feature, frameworkRoot, targetPhase } = locations;
  const phases = locations.phaseOrder?.length ? locations.phaseOrder : LEGACY_FEATURE_PHASE_ORDER;
  const reportRoots = [...new Set(phases.map(phase => path.resolve(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot))))];
  const runtimeRoots = [path.join(featureDir(projectRoot, feature), 'goal-runs'),
    path.join(featureDir(projectRoot, feature), 'device-testing', 'device-screenshots')].map(root => path.resolve(root));
  const notes = new Set(phases.map(phase => path.resolve(receiptDirPath(projectRoot, feature, phase), 'notes.md')));
  const within = (abs: string, root: string): boolean => abs === root || abs.startsWith(`${root}${path.sep}`);
  const testingReports = targetPhase === 'testing' ? path.resolve(featurePhaseReportsDir(projectRoot, feature, 'testing', frameworkRoot)) : null;
  return rel => {
    const abs = path.resolve(projectRoot, rel);
    // 待修派生计划是既有testing输入；只有实际testing报告位置下的该产物例外。
    if (testingReports && within(abs, testingReports) && path.basename(abs) === 'test-plan.hylyre.md') return false;
    return notes.has(abs) || [...reportRoots, ...runtimeRoots].some(root => within(abs, root));
  };
}

/** 仅回退进展的目录摘要排除过程输出；通用快照及其它熔断保留原语义。 */
export function snapshotBacktrackRelatedInputs(projectRoot: string, paths: string[], locations?: BacktrackProcessLocations): ArtifactSnapshot {
  return snapshotArtifacts(projectRoot, paths, createBacktrackProcessPredicate(projectRoot, locations));
}

/** 只读进展输入；不补进候选files、不改变既有fp或证据引用。 */
export function resolveBacktrackRelatedInputs(input: {
  projectRoot: string; frameworkRoot: string; feature: string; runId?: string;
  candidates: readonly RepairCandidate[]; targetPhase: string; track?: 'full'; boundary: PhaseWriteBoundaryResolution | null;
  responsibility?: import('./utils/repair-responsibility').RepairResponsibilityContext;
}): string[] {
  const isProcessPath = createBacktrackProcessPredicate(input.projectRoot, { feature: input.feature,
    frameworkRoot: input.frameworkRoot, phaseOrder: input.boundary?.phaseOrder, targetPhase: input.targetPhase });
  const normalize = (value: unknown): string | null => {
    const rel = normalizeRelatedPath(input.projectRoot, value);
    if (!rel || isProcessPath(rel)) return null;
    return rel;
  };
  if (!input.candidates.length) return [];
  const related = new Set<string>();
  let contractFiles: string[] | null = null;
  let responsibility = input.responsibility;
  for (const candidate of input.candidates) {
    if (candidate.files.length) {
      if (candidate.files.some(file => !normalizeRelatedPath(input.projectRoot, file))) return [];
      const explicit = candidate.files.map(normalize);
      // 历史files里的已知过程引用不改身份，过滤后无真实目标时仍走原owner scope。
      for (const file of explicit) if (file) related.add(file);
      if (explicit.some(file => !!file)) continue;
    }
    // 每个无源码映射的候选各自走原owner scope，不把组内其它候选的A当成它的B。
    try { responsibility ??= repairResponsibilityContext({ projectRoot: input.projectRoot, frameworkRoot: input.frameworkRoot, feature: input.feature, runId: input.runId, contracts: input.boundary ?? undefined }); }
    catch { return []; }
    const ownerPhase = resolveRepairResponsibility({ ...responsibility, target: candidate }).owner;
    if (!input.boundary || input.boundary.unresolvedSourcePhases.includes(String(ownerPhase))) return [];
    try {
      if (contractFiles === null) {
        const contracts = input.runId && resolveEffectiveScopeSource(input.projectRoot, input.feature, input.runId)?.scope
          ? readRunBoundContracts(input.projectRoot, input.frameworkRoot, input.feature, input.runId)
          : new SpecLoader(input.projectRoot, undefined, undefined, input.frameworkRoot).loadFeatureSpec(input.feature).contracts;
        contractFiles = contracts?.files ?? [];
      }
      const fallback = contractFiles.map(normalize).filter((p): p is string => !!p).filter(p => {
        const owner = resolvePhasePathOwnership(input.boundary!, p);
        return owner.owner === ownerPhase && owner.roles.some(role => role.kind === 'source');
      });
      if (!fallback.length) return [];
      for (const file of fallback) related.add(file);
    } catch { return []; }
  }
  return [...related].sort();
}

export function compareBacktrackRelatedInputs(input: {
  projectRoot: string; feature: string; runId: string; events: readonly GoalRunEvent[];
  previous: GoalRunEvent | undefined; current: ArtifactSnapshot;
}): 'changed' | 'unchanged' | 'unknown' {
  if (!input.previous) return 'unknown';
  const direct = compareRelatedInputSnapshots(input.previous.related_input_snapshot, input.current);
  if (direct !== 'unknown') return direct;
  const endMs = Date.parse(input.previous.ts ?? '');
  if (!Number.isFinite(endMs) || Object.keys(input.current).length === 0) return 'unknown';
  const raw = input.previous.related_input_snapshot;
  const currentKeys = Object.keys(input.current).sort();
  const candidateRows = (input.previous as { candidates?: unknown }).candidates;
  if (candidateRows !== undefined && !Array.isArray(candidateRows)) return 'unknown';
  const priorCandidates = (candidateRows ?? []) as Array<{ files?: unknown }>;
  const hasOriginalKeys = raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length;
  if (!hasOriginalKeys && priorCandidates.some(candidate => !candidate || !Array.isArray(candidate.files) || !candidate.files.length)) return 'unknown';
  const oldKeys = raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length
    ? Object.keys(raw).sort()
    : [...new Set([
      ...priorCandidates
        .flatMap(candidate => Array.isArray(candidate.files) ? candidate.files : []),
      ...(Array.isArray((input.previous as { files?: unknown }).files) ? (input.previous as { files: unknown[] }).files : []),
    ].map(file => normalizeRelatedPath(input.projectRoot, file)).filter((key): key is string => !!key))].sort();
  // 已有原集合不能用本轮新增/删减的key重构；旧记录无集合也不能从当前集合猜。
  if (!oldKeys.length || oldKeys.join('\0') !== currentKeys.join('\0')) return 'unknown';
  const start = phaseInvocationStart(input.events, String(input.previous!.to_phase), endMs);
  const startMs = Date.parse(start?.ts ?? '');
  if (!Number.isFinite(startMs)) return 'unknown';
  const baseline = readRecordedRelatedHashes(input.projectRoot, input.feature, new Set(Object.keys(input.current)), input.events,
    { startMs, endMs, runId: input.runId });
  const supplemented: ArtifactSnapshot = {};
  for (const key of Object.keys(input.current)) {
    const entry = raw?.[key];
    if (entry && compareRelatedInputSnapshots({ [key]: entry }, { [key]: input.current[key] }) !== 'unknown') {
      supplemented[key] = entry;
    } else if (baseline.has(key)) {
      const sha = baseline.get(key);
      supplemented[key] = { exists: sha !== null, contentHash: sha ?? '' };
    }
  }
  return compareRelatedInputSnapshots(supplemented, input.current);
}

function phaseSkillPath(frameworkRoot: string, phase: FeaturePhase): string {
  const { phaseContractIndex, loadFeatureContracts } = require('./utils/skill-contract') as typeof import('./utils/skill-contract');
  const entry = phaseContractIndex(loadFeatureContracts(frameworkRoot)).get(phase);
  if (!entry) throw new Error('phase has no Skill contract: ' + phase);
  return path.join(path.dirname(entry.contract.source_path), entry.contract.skill_doc);
}

const LOCK_HEARTBEAT_MS = 60_000;

export interface SummaryJson {
  blocking_skips?: Array<{ id?: string; blocking_class?: string; details_excerpt?: string; suggestion?: string }>;
  run_id?: string;
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
  /** D2（plan 3a7f9c12）：诊断请求的两个路径——失败回喂据此给出可执行动作。 */
  verifier_request?: string;
  verifier_subject_id?: string;
  report_validity?: 'PASS' | 'FAIL' | 'UNVERIFIED';
  verifier_report?: string;
  blockers?: Array<{
    repair_owner?: string;
    device_setup?: import('./utils/device-unlock-helper').DeviceSetupObservation;
    id?: string;
    blocking_class?: string;
    classification?: string;
    details_excerpt?: string;
    affected_files?: string[];
    suggestion?: string;
  }>;
  repair_candidates?: RepairCandidate[];
  readiness_signals?: Array<{ id: string; message: string }>;
  verifier_closure?: import('./utils/types').HarnessRunSummary['verifier_closure'];
}

/** Active agent tree-kill registered for SIGINT/SIGTERM orphan cleanup. */
let activeAgentKill: (() => Promise<void>) | null = null;
let activeExecutionControls: WorkUnitExecutionControls | undefined;
/** Active harness-runner tree-kill (runHarnessPhase async spawn). */
let activeHarnessKill: (() => Promise<void>) | null = null;
let featureLock: { path: string; ownerId: string; interval?: NodeJS.Timeout } | null = null;
let runLock: { path: string; ownerId: string } | null = null;
let runControl: { dir: string; token: RunFenceToken } | null = null;
let preserveSessionOwner = false;
let runtimeSessionLogs = false;
/** plan 9c3d7e1a §5.5：无人值守修复尝试期间多持的锁（蓝图锁 + 兄弟 feature 锁）；统一放锁与信号处理都经 releaseAllLocks 放掉。 */
let designRepairLockRelease: (() => void) | null = null;


/** Runtime substep for heartbeat / progress projection. */
let progressSubstep: 'agent_invoke' | 'harness' | 'prompt' | 'verdict' | null = null;
let progressPhase: FeaturePhase | null = null;
let progressHeartbeatHook: (() => void) | null = null;

/** Set once the manifest is loaded; lets signal/exit handlers locate events.jsonl. */
let terminalEventCtx: {
  reportDir: string; projectRoot: string; frameworkRoot?: string;
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
    'user-deadline-at': typeof argv['user-deadline-at'] === 'string' ? argv['user-deadline-at'] : undefined,
    'override-start': Boolean(argv['override-start']),
    'override-end': Boolean(argv['override-end']),
    'override-manifest': Boolean(argv['override-manifest']),
  };
}

/** Same file loader and authorized overrides as fresh manifest birth; no run is written. */
function resolveDesignDeliveryRequest(argv: minimist.ParsedArgs, projectRoot: string) {
  const requirement = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot });
  const cli = toManifestCliArgv(argv);
  if (requirement.text !== undefined) cli.requirement = requirement.text;
  if (requirement.sources.length) cli.requirement_source_files = requirement.sources;
  const check = validateManifestCliOverrides(cli);
  if (!check.ok) throw new Error(check.message);
  if (!argv.manifest) return { startPhase: cli.start, endPhase: cli.end, requirement: requirement.text, requirementSourceFiles: requirement.sources };
  const definition = loadGoalManifestDefinition(String(argv.manifest), projectRoot);
  const manifest = definition.manifest;
  applyManifestCliOverrides(manifest, cli);
  return { startPhase: manifest.start_phase, endPhase: manifest.end_phase, requirement: manifest.requirement, requirementSourceFiles: manifest.requirement_source_files,
    requestedPhases: definition.requestedPhases, requestedResults: definition.requestedResults };
}

function guardNestedGoalRunner(): boolean {
  if (isGoalHeadlessEnv() && process.env.MAISON_GOAL_ALLOW_NESTED !== '1') {
    console.error(
      '[goal-runner] BLOCKER: nested goal-runner from headless agent (MAISON_GOAL_HEADLESS=1). ' +
        'Phase agents must not invoke goal-runner / --resume / --manifest.',
    );
    return true;
  }
  return false;
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
    if (activeExecutionControls?.cancel) {
      activeExecutionControls.cancel(`signal:${signal}`);
      process.exitCode = 130;
      return;
    }
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
  if (designRepairLockRelease) {
    try { designRepairLockRelease(); } catch { /* best-effort */ }
    designRepairLockRelease = null;
  }
  if (runControl && !preserveSessionOwner) {
    try { releaseRunOwner(runControl.dir, runControl.token, { allowQuiescing: true }); }
    catch { /* stale owner or already released */ }
  }
  if (featureLock?.interval) clearInterval(featureLock.interval);
  if (featureLock) releaseLock(featureLock.path, featureLock.ownerId);
  if (runLock) releaseLock(runLock.path, runLock.ownerId);
  featureLock = null;
  runLock = null;
  runControl = null;
  preserveSessionOwner = false;
  runtimeSessionLogs = false;
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

/**
 * plan 9c3d7e1a §5.5：链外设计修复调用期间，运行时经唯一发射口写出的每一行事件（文件绝对路径、原样字节）——
 * 调用结束后据此重建 events.jsonl 的期望值（调用前字节 + 本次运行时写出的行，原顺序）。不录时为 null。
 */
let eventLineRecorder: ((file: string, line: string) => void) | null = null;

function appendEvent(reportDir: string, projectRoot: string, event: Record<string, unknown>): void {
  assertGoalBoundary('event_append');
  const abs = path.join(projectRoot, reportDir, 'events.jsonl');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...appendEventBaseFields, ...event }) + '\n';
  fs.appendFileSync(abs, line, 'utf-8');
  eventLineRecorder?.(abs, line);
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
    writeGoalReport(ctx.projectRoot, ctx.reportDir, report, { workflowChain: ctx.workflowChain, frameworkRoot: ctx.frameworkRoot });
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
    writeGoalReport(ctx.projectRoot, ctx.reportDir, report, { workflowChain: ctx.workflowChain, frameworkRoot: ctx.frameworkRoot });
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
  frameworkRoot?: string;
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
      { currentRequirementSha, ...(input.frameworkRoot ? { frameworkRoot: input.frameworkRoot } : {}) },
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
  if (!summary.blockers?.length && requiredSummaryCheckGaps(summary).some(check => check.blocking_class === 'framework_internal')) {
    return { blocking_class: 'framework_internal', failure_kind: 'framework_bug' };
  }
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
  currentProblems?: readonly import('./utils/check-disposition').CurrentDispositionProblem[];
}): {
  hasEvidence: boolean;
  blockingMeta: { blocking_class?: string; failure_kind?: string };
  blockerSignature: string;
  failureKindForEvent?: FailureKind;
} {
  // plan 2f8a6d40 D1：**有 summary ≠ 有失败**。收紧前 `decisionSummary !== null` 单独成立，
  // 于是 `PASS + blockers:[] + advance_blocked=closure_open + retry` 这一支（宿主 run
  // 20260905T103028Z-79d3fd 第 85 行）被 catch-all 打上 code_regression——closure 未闭环
  // 是工作流状态，与产品代码无关。现在 summary 只有**自己表达了失败**（verdict 非 PASS，
  // 或 blockers 非空）才算失败事实；`hasRuntimeFailureEvidence`（超时/agent 失败/非零退出/
  // closure 定稿错误/可信缺陷等）逐字不动，仍单独充分。
  const summaryStatesFailure =
    input.decisionSummary !== null &&
    (input.decisionSummary.verdict !== 'PASS' || (input.decisionSummary.blockers ?? []).length > 0);
  const hasEvidence = summaryStatesFailure || input.hasRuntimeFailureEvidence || !!input.currentProblems?.length;
  const signature = hasEvidence ? buildEffectiveBlockerSignature(input.decisionSummary, input.failureKind, input.phase) : '';
  return {
    hasEvidence,
    blockingMeta: extractBlockingMeta(input.decisionSummary),
    blockerSignature: [...new Set([signature, ...(input.currentProblems ?? []).map(problem => problem.id)].filter(Boolean))].sort().join('|'),
    ...(hasEvidence ? { failureKindForEvent: input.failureKind } : {}),
  };
}

/** 仅渲染既有补核停机事实；不参与 no-progress/预算裁决。 */
export function buildVerificationNoProgressGuidance(input: {
  phase: string;
  subjectId?: string;
  request?: string;
  problems: readonly import('./utils/check-disposition').CurrentDispositionProblem[];
  diagnostics?: readonly string[];
}): string[] | undefined {
  const current = input.problems.filter(problem => problem.phase === input.phase || problem.owner === input.phase);
  const pending = current.filter(problem => problem.action === 'verify' && problem.id.startsWith('open_finding:'));
  if (!pending.length || current.some(problem => problem.action === 'repair' || problem.action === 'wait')) return undefined;
  return [
    `当前阶段 ${input.phase} 同一 subject ${input.subjectId ?? '（见当前 summary）'} 补核仍有具体缺口，未完成。`,
    ...pending.map(problem => `- ${problem.id}：${problem.detail}；责任方=${problem.owner ?? problem.phase}`),
    ...(input.diagnostics ?? []).map(detail => `- 核实诊断：${detail}`),
    `原 verifier request：${input.request ?? '见当前 summary.verifier_request；先恢复该请求的有效定位。'}`,
    '下一步：由原 verifier 按当前 request 补齐上述具体缺口；取得真实新材料或有效核实结论后重新发起同一请求，按新的当前处置继续。补核期间不重派产品作者，不无变化重核或手改证据/需求。',
  ];
}

/** 框架补验暂缓 closure 时，先应用已核他方修复的合法修订；其它 guard 不让位。 */
export function resolveFrameworkOwnerRevisionGuard(input: {
  guard: DriverGuardAction;
  rawVerdict?: string;
  advanceBlocked?: boolean;
  frameworkVerificationGap: boolean;
  executableOwnerRecovery: boolean;
  pendingScopeRevision?: ExecutionScope;
  recommendationAction: AssessRecommendation['action'];
  closureFinalizationError?: string | null;
  timedOut?: boolean;
  apiDisconnected?: boolean;
}): DriverGuardAction {
  return input.guard === 'retry' && input.rawVerdict === 'PASS' && input.advanceBlocked
    && input.frameworkVerificationGap && input.executableOwnerRecovery && input.pendingScopeRevision
    && input.recommendationAction === 'revise_scope' && !input.closureFinalizationError && !input.timedOut && !input.apiDisconnected
    ? 'none' : input.guard;
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
      probe: 'capability_preflight_ready',
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
  if (resolveP0DeviceObligations(opts.projectRoot, opts.feature, acceptance).device.length === 0) return null;

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
  const frameworkParked = all.filter(b => resolveBlockerActionability(b) === 'framework_blocked');
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
  if (frameworkParked.length > 0) {
    lines.push(
      `- (parked, framework — do NOT attempt) ${frameworkParked.map(b => b.id ?? '?').join(', ')}: ` +
      'framework implementation failed; product/artifact edits cannot repair it. Preserve the failure for source-framework repair.',
    );
  }
  if (lines.length === 0) {
    const meta = extractBlockingMeta(summary);
    if (meta.failure_kind) lines.push(`- failure_kind: ${meta.failure_kind}`);
  }
  // D2（plan 3a7f9c12）：产品失败诊断轮——回喂必须给出可执行动作，否则 agent 只看到一串
  // blocker 就去改产品，而这些失败恰恰要先由 verifier 逐条确认才知道该改哪儿。
  if (summary.next_action === 'run_verifier_for_repair') {
    lines.push(
      '- next_action: run_verifier_for_repair — this product FAIL is diagnosable, and the harness issued a verifier ' +
        'request despite the script FAIL. Do NOT edit product code yet.',
      `  1) deliver ${summary.verifier_request ?? 'summary.verifier_request'} verbatim as the Task prompt to subagent_type=verifier;`,
      `  2) write its reply verbatim to ${summary.verifier_report ?? 'summary.verifier_report'};`,
      '  3) end this invocation and report the current FAIL plus those two paths — the outer runner re-runs the gate ' +
        'harness and recomputes repair candidates. Do NOT re-run the harness yourself, and do NOT wait for candidates ' +
        'or closure before returning (the product is still FAIL; the phase cannot close yet).',
    );
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
// phase-evidence-manifest（跨 run 稳定、schema/aggregate 与实际条目核对），不再消费快照锚 env。

/** gate harness 注入（测试用；**spy 它有没有被调用**是"污染轮不 spawn"的核心断言） */
type HarnessPhaseResult = { exitCode: number; timedOut: boolean; outputTail?: string; waitingDetail?: string; currentCheckObserved?: boolean };
type RunHarnessFn = (
  projectRoot: string, frameworkRoot: string, phase: FeaturePhase, feature: string,
  dryRun: boolean, manifest?: GoalManifest,
  roundIdentity?: { runId: string; attemptId: string }, timeoutMs?: number,
  // d9e4b7c1 T2（v13 缝扩展）：gate 注入 env（设备元组/冻结配置/强装 flag）——不扩缝则
  // "设备身份透传到 gate"是测试盲区（假绿）
  deviceTargetEnv?: Record<string, string>,
) => Promise<HarnessPhaseResult>;
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

/**
 * plan b0e0621c §3.2：运行时 owner 心跳定时器的间隔（测试用；null = 生产缺省 LOCK_HEARTBEAT_MS）。
 * 只改间隔，定时器回调（刷新锁、心跳事件、beacon、进度快照）不变；生产代码不调用本缝。
 */
let injectedLockHeartbeatMs: number | null = null;
export function __testing_setLockHeartbeatMs(ms: number | null): void {
  injectedLockHeartbeatMs = ms;
}
/** 运行时 owner 的心跳间隔：测试缝未安装时即生产缺省 LOCK_HEARTBEAT_MS。 */
export function lockHeartbeatIntervalMs(): number {
  return injectedLockHeartbeatMs ?? LOCK_HEARTBEAT_MS;
}

/** 一次性清空所有测试注入（测试 finally 调用，防串味） */
export function __testing_resetGoalRunnerSeams(): void {
  injectedLockHeartbeatMs = null;
  injectedValidateReceipt = null;
  injectedInvokeAgent = null;
  injectedRunHarness = null;
  injectedLayout = null;
  injectedWorkflowResolver = null;
  injectedDeviceGate = null;
  injectedCapabilityGate = null;
  injectedCanaryProbeInvoke = null;
  injectedDetachSpawn = null;
}

async function runHarnessPhase(
  projectRoot: string,
  frameworkRoot: string,
  phase: FeaturePhase,
  feature: string,
  dryRun: boolean,
  manifest?: GoalManifest,
  roundIdentity?: { runId: string; attemptId: string; actorPhase?: string; relatedInputs?: ArtifactSnapshot },
  // P0-4（plan d9b4f7e2 rev5）：harness 也在 wall deadline 内——旧实现无 timeout，agent
  // 停在 deadline 后 harness 仍可无限跑，"超支 ≤ grace"无从保证。返回结构化结果：
  // exitCode=1 无法区分门禁真失败与 wall 树杀，timedOut 单独承载。
  timeoutMs?: number,
  /** P0-3：就绪门冻结的设备 env（serial/kind/session/credential_ref）——须与 agent 侧同源 */
  deviceTargetEnv: Record<string, string> = {},
): Promise<HarnessPhaseResult> {
  const emitHarnessStart = (binding: Record<string, unknown> = {}): void => {
    if (manifest) appendEvent(manifest.report_dir, projectRoot, { type: 'harness_start', phase,
      ...(roundIdentity ? { invoke_id: `${phase}-${roundIdentity.attemptId}`, related_input_snapshot: roundIdentity.relatedInputs } : {}), ...binding });
    progressHeartbeatHook?.();
  };
  if (injectedRunHarness) {
    emitHarnessStart();
    return injectedRunHarness(
      projectRoot, frameworkRoot, phase, feature, dryRun, manifest, roundIdentity, timeoutMs,
      deviceTargetEnv,
    );
  }
  if (dryRun) { emitHarnessStart(); return { exitCode: 0, timedOut: false }; }
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
    ...(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? { MAISON_GOAL_GATE_DEADLINE_MS: String(Date.now() + timeoutMs) } : {}),
    // t1（f7a3d9c2）：外层脚本闸门与 agent 自跑共用同一轮次身份（round_key 去重/重放）
    ...(roundIdentity
      ? {
          MAISON_GOAL_RUN_ID: roundIdentity.runId,
          MAISON_GOAL_ATTEMPT: roundIdentity.attemptId,
          // plan b3e8d4c7 t1：attempt 身份必须带**所属 phase**——否则下游 attempt 里
          // 复验上游回执时 attempt 等值恒不成立（i3≠i5 无解，宿主实锤死锁）。
          MAISON_GOAL_ATTEMPT_PHASE: roundIdentity.actorPhase ?? String(phase),
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
  applyGoalModelPinEnv(childEnv, adapterModelBinding(manifest?.adapter_model_pin));
  // plan ab072691 t5①：provider 身份注入 gate harness——provider 评审发生在 gate 进程里
  // （capture 之后、严格 dispatch 之前），而那个进程没有 manifest。同一条注入纪律：
  // 成对写、成对清；无 pin 时只清不写（gate 侧取不到即按未配置处理，落 blind）。
  applyGoalVisualProviderEnv(childEnv, manifest?.visual_provider_pin);
  deleteEnvKeyCaseInsensitive(childEnv, 'HARNESS_DIFF_BASE_REF');
  deleteEnvKeyCaseInsensitive(childEnv, 'MAISON_GOAL_GATE_DEADLINE_MS');
  for (const [k, v] of Object.entries(gateInjectedEnv)) {
    deleteEnvKeyCaseInsensitive(childEnv, k);
    childEnv[k] = v;
  }
  // S5（visual-capability-truth）：单写者标记——只有 runner 直接 spawn 的 gate harness
  // 可直写正式 vision 账本；agent 自跑 harness（无此标）只算不写/写 journal proposal。
  // b7e4d2a9 Todo3：先清大小写变体再设唯一大写=1（父环境残留 mixed-case 键会与之并存，
  // Windows 子进程读取哪个是未定义行为）。
  deleteEnvKeyCaseInsensitive(childEnv, 'MAISON_GOAL_GATE_HARNESS');
  // MAISON_GOAL_ALLOWED_TOOLS 注入已退役（plan a8e5c3f9 t1）：allowed_tools 是审批清单，
  // headless 全权限下不存在审批面，也不再参与多模态能力判断。
  const gateId = roundIdentity ? `${phase}-${roundIdentity.attemptId}` : `${phase}-gate`;
  const gateToken = `${manifest?.run_id ?? feature}/harness/${gateId}`;
  const gateLog = manifest && runtimeSessionLogs ? path.join(projectRoot, manifest.report_dir, 'phases', phase, gateId, 'harness-output.log') : null;
  if (gateLog) fs.mkdirSync(path.dirname(gateLog), { recursive: true });
  const gateProbe = process.platform === 'win32' ? defaultProcessProbe() : {
    ...defaultProcessProbe(),
    identify(pid: number) {
      const probe = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm=', '-o', 'args='], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      if (probe.status !== 0) return null;
      const line = probe.stdout.trim();
      const date = /^(.{24})\s+(\S+)\s+(.+)$/.exec(line);
      if (!date) return null;
      const startedAtMs = Date.parse(date[1]);
      if (!Number.isFinite(startedAtMs)) return null;
      let executable = date[2];
      try { executable = fs.realpathSync(`/proc/${pid}/exe`); } catch { /* macOS ps comm supplies its executable. */ }
      return { pid, startedAtMs, executable, commandLine: date[3] };
    },
  };
  const gateExists = (pid: number): boolean => {
    if (process.platform === 'win32') return pidExists(pid);
    try { process.kill(-pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  };
  const gateEvents = manifest ? loadAuthoritativeEvents(path.resolve(projectRoot, manifest.report_dir, 'events.jsonl')) : [];
  const oldGate = [...gateEvents].reverse().find(event => event.type === 'harness_start' && event.invoke_id === gateId
    && (event as Record<string, unknown>).process_role === 'harness' && typeof (event as Record<string, unknown>).pid === 'number');
  if (oldGate && !gateEvents.slice(gateEvents.indexOf(oldGate) + 1).some(event => event.type === 'harness_end' && event.invoke_id === gateId)) {
    const prior = oldGate as Record<string, unknown>;
    const pid = Number(prior.pid);
    const identity = classifyGuardianBinding(prior as unknown as GuardianBoundRecord,
      { ...gateProbe, identify: target => identifyWithRetry(target, gateProbe) }, gateExists);
    if (identity.kind === 'guardian_identity_unverifiable') {
      if (!identity.identity_mismatch) return { exitCode: 1, timedOut: false,
        waitingDetail: `prior harness process identity is temporarily unavailable; retry the same request after the probe recovers. ${identity.reason}` };
      console.warn(`[goal-runner] prior harness binding no longer owns pid=${pid}; ${identity.reason}`);
    } else if (identity.kind === 'guardian_alive_matching') {
      if (process.platform === 'win32') {
        if (!terminateGuardianProcessOnly(pid) || !awaitGuardianGone(pid)) throw new Error('[goal-runner] prior harness could not be contained');
      } else {
        await killProcessTree(pid);
        if (gateExists(pid)) throw new Error('[goal-runner] prior harness process group has not ended');
      }
    }
  }
  const args = [require.resolve('ts-node/dist/bin.js'), '--project', path.join(harnessDir, 'tsconfig.json'),
    path.join(harnessDir, 'harness-runner.ts'), '--phase', phase, '--feature', feature, '--summary', '--goal-gate-token', gateToken];
  const command = process.platform === 'win32' ? resolveAgentCommand([process.execPath, ...args]) : null;
  if (command && 'error' in command) throw new Error(command.error);
  const guardian = command && !('error' in command)
    ? buildGuardianInvocation({ argv: [process.execPath, ...args], cwd: harnessDir, appName: command.appName, commandLine: command.commandLine }, process.pid, gateToken) : null;
  if (guardian && 'error' in guardian) throw new Error(guardian.error);
  const child = spawn(guardian ? guardian.file : process.execPath, guardian ? guardian.args : args, {
    cwd: harnessDir, shell: false, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', windowsHide: true,
  });
  if (manifest && child.pid) {
    const identity = process.platform !== 'win32' ? identifyWithRetry(child.pid, gateProbe) : null;
    const bound = process.platform === 'win32' ? bindGuardianOrKill(child.pid, gateToken)
      : identity && identity.commandLine?.includes(gateToken) ? { ok: true as const, identity } : { ok: false as const, error: 'POSIX harness identity unavailable' };
    if (!bound.ok) { await killProcessTree(child.pid); throw new Error(`[goal-runner] harness process binding failed: ${bound.error}`); }
    emitHarnessStart({ process_role: 'harness', run_id: manifest.run_id, pid: child.pid, started_at_ms: bound.identity.startedAtMs,
      executable: bound.identity.executable, token: gateToken });
  }
  activeHarnessKill = async () => {
    if (child.pid) {
      await killProcessTree(child.pid);
    }
  };
  let outputTail = '';
  let lastToolOutputAt = Date.now();
  let currentCheckObserved = false;
  let stdoutLine = '';
  const stdoutDecoder = new StringDecoder('utf8');
  const rememberOutput = (chunk: Buffer | string): void => {
    if (chunk.length) lastToolOutputAt = Date.now();
    outputTail = (outputTail + chunk.toString()).slice(-8_000);
  };
  const observeStdout = (chunk: Buffer | string): void => {
    if (currentCheckObserved) return;
    stdoutLine += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
    let newline: number;
    while ((newline = stdoutLine.indexOf('\n')) >= 0) {
      const line = stdoutLine.slice(0, newline);
      stdoutLine = stdoutLine.slice(newline + 1);
      if (completedCheckResultsFromOutput(line).some(result => result.phase === phase)) {
        currentCheckObserved = true;
        stdoutLine = '';
        return;
      }
    }
  };
  child.stdout?.on('data', (chunk: Buffer | string) => {
    rememberOutput(chunk);
    observeStdout(chunk);
    if (gateLog) fs.appendFileSync(gateLog, chunk); else process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    rememberOutput(chunk);
    if (gateLog) fs.appendFileSync(gateLog, chunk); else process.stderr.write(chunk);
  });

  // P0-4：remaining-budget timeout + 进程树 kill（bounded，见 agent-invoke killProcessTree）。
  // 复审修复（codex P0/cursor 阻断1）：kill 必须与 agent 路径同构——**先 arm force-settle
  // 再杀**。否则 taskkill 超时/失败且目标存活时 child 永不 exit/close，settleWaiter.promise
  // 永久悬挂，hard wall 形同虚设（正是本 plan 要根治的"无界等待"在 harness 段的复刻）。
  const settleWaiter = createChildSettleWaiter(child, {});
  let timedOut = false;
  const idleWatch = setInterval(() => {
    if (Date.now() - lastToolOutputAt < resolveAgentOutputIdleMs(projectRoot)) return;
    timedOut = true;
    settleWaiter.armForceSettleAfterKill();
    if (child.pid) void killProcessTree(child.pid);
  }, 60_000);
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
        }, Math.max(0, Number(gateInjectedEnv.MAISON_GOAL_GATE_DEADLINE_MS) - Date.now()))
      : null;
  const cancellation = activeExecutionControls?.signal;
  const cancelCheck = (): void => {
    if (currentCheckObserved) return;
    settleWaiter.armForceSettleAfterKill();
    if (child.pid) void killProcessTree(child.pid);
  };
  if (cancellation?.aborted) cancelCheck();
  else cancellation?.addEventListener('abort', cancelCheck, { once: true });

  try {
    const settled = await settleWaiter.promise;
    if (!currentCheckObserved) currentCheckObserved = completedCheckResultsFromOutput(stdoutLine + stdoutDecoder.end())
      .some(result => result.phase === phase);
    return {
      exitCode: timedOut && settled.exitCode === 0 ? 1 : settled.exitCode,
      timedOut,
      outputTail,
      currentCheckObserved,
      ...(cancellation?.aborted && !currentCheckObserved ? { waitingDetail: '当前检查被用户或协调器取消；保留原执行事实与成果，不把未完检查签通过。' } : {}),
    };
  } catch {
    return { exitCode: 1, timedOut, outputTail };
  } finally {
    clearInterval(idleWatch);
    cancellation?.removeEventListener('abort', cancelCheck);
    if (killTimer) clearTimeout(killTimer);
    activeHarnessKill = null;
  }
}

/**
 * e9d4b7a3 t1（review1 阻断修复）：backtrack_target_absent 的责任与授权交接指引——
 * 单点生成，phase_halt 事件 / outcome / console 三处消费同一文案（b3f7d9a2 硬学习：
 * 同一文案契约须枚举全部承载处含测试断言）。检测器只保证文案要素在场。
 */
const DESIGN_MODIFICATION_CONFIRMATION = '无人值守完整交付及明确获全权授权的会话中，原需求内的蓝图、CU和必要架构修订由框架交设计 owner 静默完成并重签；plan/coding及外层主 Agent 不原地自授。改变需求或实质验收、真实秘密/不可逆外部动作、突破用户总上限或明确禁止时仍须用户决定；未获得本次可信全权输入的会话沿原确认流程，主 Agent 应先核对已有原授权再重传。';

/**
 * plan c6a9e4d2 t3：guardian 绑定核验——身份四元组完整（含 executable 绝对路径）且命令行含身份 token；
 * 不成立即同步团灭并用独立通道复验消失（fail-closed），`stillAlive` = 未证明消失。阶段调用与链外设计修复调用共用。
 */
export function bindGuardianOrKill(pid: number, guardianToken: string):
  | { ok: true; identity: NonNullable<ReturnType<typeof identifyWithRetry>> }
  | { ok: false; error: string; stillAlive: boolean } {
  const identity = identifyWithRetry(pid, defaultProcessProbe());
  const executableOk = typeof identity?.executable === 'string'
    && identity.executable.trim().length > 0
    && /^[a-zA-Z]:[\\/]/.test(identity.executable.trim());
  const fail = (error: string): { ok: false; error: string; stillAlive: boolean } => {
    terminateGuardianProcessOnly(pid);
    const gone = awaitGuardianGone(pid);
    return { ok: false, error, stillAlive: !gone };
  };
  if (!identity?.commandLine || !executableOk) {
    return fail(`guardian(pid=${pid}) 身份不可得/命令行不可读/可执行文件非绝对路径——` +
      'Windows containment 绑定失败，立即团灭并复验消失（fail-closed）');
  }
  if (!identity.commandLine.includes(guardianToken)) {
    return fail(`guardian(pid=${pid}) 命令行不含身份 token「${guardianToken}」——` +
      '绑定失败，立即团灭并复验消失（fail-closed）');
  }
  return { ok: true, identity };
}

type DesignOwnerBlocker = { id?: string; details_excerpt?: string; repair_owner?: string; blocking_class?: string };

/**
 * plan f7045213 最终评审返修二：责任在链外设计 owner 的阻断（检查标 repair_owner='external' 且无工具链/外部类
 * blocking_class——device_toolchain 等已由上方 await_operator_toolchain 接住）。当前阶段修不了，重试只会熔断。
 */
export function designOwnerBlockers(blockers: readonly DesignOwnerBlocker[] | undefined): DesignOwnerBlocker[] {
  return (blockers ?? []).filter((b) => b.repair_owner === 'external' && !b.blocking_class);
}

/** 复用既有停机原因 execution_scope_unresolved（外部类、首次即停）；说明写清原因、责任方与下一步。 */
export function buildDesignOwnerGuidance(opts: {
  feature: string; runId: string; phase: string; blockers: readonly DesignOwnerBlocker[];
  unattended?: boolean;
  /** plan 9c3d7e1a §4.1：run 内指针调和没有修好本 CU 时的原因（调和器自带的跳过原因 / 竞争退出说明）。 */
  reconcileNote?: string;
  /** plan 9c3d7e1a §5.0：B1 / B2 分类与修复简报（哪条检查、哪个产物、依据、缺什么）。 */
  brief?: DesignRepairBrief;
  /** plan 9c3d7e1a §5.5：无人值守 B1 修复的结果（未派发 / 发布前失败 / 已发布但未恢复 / 已恢复但绑定失效）。 */
  contentRepairNote?: string;
}): string {
  const b1 = opts.brief?.class === 'B1';
  return [
    `【${opts.feature} · run ${opts.runId} · ${opts.phase}】设计权威在本 run 内无法修复，已停止，不在当前阶段重试。`,
    '原因：',
    ...opts.blockers.map((b) => `  - ${b.id ?? '?'}：${truncateOneLine(b.details_excerpt ?? '', 400)}`),
    ...(opts.reconcileNote ? [`框架已尝试在本 run 内原位升版 CU 指针，未完成：${opts.reconcileNote}`] : []),
    ...(opts.contentRepairNote ? [`无人值守设计修复（按本次有效请求授权）：${opts.contentRepairNote}`] : []),
    ...(opts.brief ? [
      b1
        ? '分类：B1——既有范围内的确定修法；仍遵守下方设计修改确认边界。'
        : opts.unattended
          ? '分类：B2——需要设计责任方裁定或补事实；原需求内按本次无人值守授权处理，未恢复的具体原因见上方。'
          : '分类：B2——需要有权者先做决定、扩大范围或补事实，设计 owner 不能自行修；缺什么见下。',
      '修复简报：',
      ...opts.brief.items.map((item) => `  - 检查 ${item.check}${item.codes.length ? `［${item.codes.join(', ')}］` : ''}（${item.class}）→ 产物 ${item.artifacts.join('、') || '蓝图 / CU'}；${item.class === 'B1' ? '修法' : '缺'}：${item.needs.join('；')}`),
    ] : []),
    '责任方：设计 owner（/component-design：canonical 蓝图与 Change Unit），不在 feature 阶段链内。',
    DESIGN_MODIFICATION_CONFIRMATION,
    opts.unattended
      ? '下一步：框架沿设计责任链修订、验证并接续；本次未恢复的具体原因见上方。仅在需求/实质验收变更、真实授权缺失、外部条件或有效预算受限时按对应原因处理，不要求外层 Agent 手改文件。'
      : '下一步：取得用户确认后，在 /component-design 修复蓝图 / CU 中的上述问题，经 design-handoff readiness 重签并刷新派生投影，然后重新发起同一请求。',
    ...(opts.brief ? ['本 run 已停放并释放 feature 锁（readiness 调和要取这把锁）。修好后重新发起同一请求即自动续跑，冷却期内也可以、不需要任何旗标：'
      + '冻结的输入绑定仍有效就重新接入本 run，已失效就自动起后继并承接本 run。已安装 supervisor 时探针就绪会自动拉起（同一任务最多 3 次，不重置，用完需人工重发）。'] : []),
  ].join('\n');
}

/** plan 9c3d7e1a §5.0：设计 owner 停机的分类与修复简报——停机事件、停机说明与探针消费同一份。 */
export interface DesignRepairBrief { class: DesignRepairClass; items: DesignAuthorityFinding[] }

/**
 * 按 summary 里的设计 owner 阻断逐条给出原因码与分类：原因码来自只读重跑同一阶段的设计权威门（检查结果的 structured 通道，
 * 不解析说明文本）；重跑没有对上的阻断按"原因码未登记"归 B2。整体分类：全部 B1 才是 B1。
 */
export function designRepairBrief(opts: {
  projectRoot: string; frameworkRoot: string; feature: string; phase: string; blockers: readonly DesignOwnerBlocker[]; runId?: string;
}): DesignRepairBrief {
  let findings: DesignAuthorityFinding[] = [];
  try {
    const diagnosis = diagnoseDesignAuthority(opts.projectRoot, opts.frameworkRoot, opts.feature, opts.phase, opts.runId);
    if (diagnosis.unevaluable) console.warn('[design-authority] 分类用的重跑不可用（按原因码未登记归 B2）：' + diagnosis.unevaluable);
    findings = diagnosis.findings;
  } catch { findings = []; }
  const items = opts.blockers.map((blocker) => {
    const found = findings.find((finding) => finding.check === blocker.id);
    const unlisted = classifyDesignAuthorityCodes([]);
    return found
      ? { ...found, basis: truncateOneLine(found.basis, 400) }
      : { check: blocker.id ?? '?', codes: [], class: unlisted.class, artifacts: [], basis: truncateOneLine(blocker.details_excerpt ?? '', 400), needs: unlisted.needs };
  });
  return { class: items.length > 0 && items.every((item) => item.class === 'B1') ? 'B1' : 'B2', items };
}

/**
 * plan 9c3d7e1a §4.1：A 类（指针过期）run 内调和——调用既有唯一 writer，成败按**本 CU** 判：
 * 本 CU 被升版或已是当前身份 = ok；本 CU 被跳过、竞争退出、调和抛错 = 不 ok（落回设计 owner 停机）。
 * 同一蓝图下其它 CU 的跳过只随结果披露。`heldFeatureLock` = 运行时对本 feature 已持有的锁，借给调和器。
 */
export function reconcilePointerInRun(opts: {
  projectRoot: string; feature: string; heldFeatureLock?: HeldFeatureLock | null;
}): { ok: boolean; blueprintId: string; reason: string } & Pick<BlueprintRefReconciliation, 'bumped' | 'skipped' | 'reviewDocument'> {
  const { blueprintId, changeUnitId } = parseChangeUnitFeatureId(opts.feature);
  try {
    const result = reconcileChangeUnitBlueprintRefs(opts.projectRoot, blueprintId, { heldFeatureLocks: opts.heldFeatureLock ? [opts.heldFeatureLock] : [] });
    const own = result.skipped.find((item) => item.change_unit_id === changeUnitId);
    const reason = result.busy
      ?? (own ? `本 CU 被调和器跳过：${own.reasons.join('；')}`
        : result.bumped.some((item) => item.change_unit_id === changeUnitId) ? '本 CU 指针已原位升版' : '本 CU 指针已是当前蓝图身份');
    return { ok: !result.busy && !own, blueprintId, bumped: result.bumped, skipped: result.skipped, reason, reviewDocument: result.reviewDocument };
  } catch (error) {
    return { ok: false, blueprintId, bumped: [], skipped: [], reason: `调和失败：${(error as Error).message}` };
  }
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

/** Existing snapshots/events are the prior-review source; the diff is context, never a gate filter. */
export function buildRereviewContext(projectRoot: string, manifest: GoalManifest, events: readonly GoalRunEvent[], frameworkRoot: string): string {
  let report: string | null = path.join(projectRoot, manifest.report_dir, 'phases', 'review', 'harness', 'review-report.md');
  let priorEvents = events;
  if (!events.some(event => event.type === 'phase_verdict' && event.phase === 'review') && !fs.existsSync(report)) {
    if (!manifest.successor_of) return '';
    try {
      const predecessor = loadGoalManifestFromRun(projectRoot, manifest.successor_of, {
        feature: manifest.feature, featuresDir: loadFrameworkConfig(projectRoot).paths.features_dir,
      });
      report = path.join(projectRoot, predecessor.report_dir, 'phases', 'review', 'harness', 'review-report.md');
      priorEvents = loadAuthoritativeEvents(path.join(projectRoot, predecessor.report_dir, 'events.jsonl'));
    } catch { report = null; priorEvents = []; }
  }
  let prior: string | null = null;
  try { if (report && fs.existsSync(report)) prior = fs.readFileSync(report, 'utf-8'); } catch { /* unreadable prior is disclosed below */ }
  const backtrack = [...priorEvents].reverse().find(event => event.type === 'phase_backtrack_requested');
  const candidates = (backtrack as { candidates?: unknown } | undefined)?.candidates;
  const baseline = resolveEffectiveDiffBaseline(projectRoot, manifest.feature, manifest.run_id);
  const diff = baseline.available ? diffChangedFiles({ projectRoot, baseRef: baseline.baseSha }) : null;
  const evidence = loadVerifierEvidence(projectRoot, manifest.feature, 'review', { frameworkRoot });
  return [ '\n## Re-review: previous findings and direct effects',
    'Check whether existing findings were corrected and whether the actual changes introduce direct regressions. Do not restart an unbounded polish audit on a new attempt.',
    'A real defect outside the diff can still block; the file list is context, not an authorization or filtering gate. New blockers need concrete evidence and why the previous review could not reasonably discover them.',
    'Visual disclosure uses the same classification/strictness rules as ordinary review. Refuted or inflated findings require correcting the original report before revalidation; verifier PASS never replaces a negative product verdict.',
    `Prior report snapshot: ${prior === null ? 'missing; no prior findings are invented' : path.relative(projectRoot, report!).replace(/\\/g, '/')}`,
    ...(prior === null ? [] : [prior]),
    `Current repair candidates from the latest backtrack: ${Array.isArray(candidates) ? JSON.stringify(candidates) : 'unavailable'}`,
    `Actual changed files against the run baseline (includes working tree): ${diff?.executed && !diff.baseIsFallback ? JSON.stringify(diff.changedFiles) : 'unavailable; do not infer PASS from missing/empty diff'}`,
    `Current verifier evidence: ${evidence.ok ? `subject=${evidence.evidence.subject_id}, verdict=${evidence.evidence.verdict}` : 'not currently valid; historical observations are not current verification'}`,
    'Keep the true issue counts and disclose unresolved optional differences; do not write a second visual debt ledger.', '' ].join('\n');
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
        ? ' (quality gaps are recorded as visual debt: write self-reported style/layout residuals as defects (major/minor); a screen with a self-reported major is recorded as visual debt that does NOT hard-block phase progress or drive backtrack but STILL blocks release until fixed and re-verified (minor-only residuals stay disclosure); fail, blocker, deterministic signals and missing test anchors still go back to coding; do not stop to ask about them)'
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
            '- Icons/logos/illustrations: first reuse existing project assets as `acquisition: repo_ref` when their',
            '  purpose is established by code/resource references. No vision does not mean no usable assets.',
            '  Only when an asset is missing or its purpose cannot be established, use placeholder assets +',
            '  asset-manifest.yaml and disclose the gap. Keep `verified: unverified`; reuse is NOT visual verification.',
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

/**
 * plan 5e1c7a93 D4：本块拆两段，**正文一字不改，只改归属**——
 * - 模式段（headless 声明 / approval_mode / MUST NOT stop to ask / 覆盖 phase SKILL 停等 /
 *   逐门自动决议与 headless-assumptions 账本）：**只注入 detached**；
 * - 红线段（gate-integrity 四条 + deterministicDetectorLines）：两种形态**照常注入**。
 * attended 走 AttendedGoalPhaseExecutor 的 bridge，phase SKILL 的停等确认按原义执行——
 * 不能再被同一份提示词同时要求「停下来问」和「停下来问 = 任务失败」。
 */
function buildUnattendedExecutionBlock(
  manifest: GoalManifest,
  phase: FeaturePhase,
  projectRoot: string,
  capabilityAdvisory?: CapabilityAdvisory,
  attended = false,
  autonomyAuthorized = false,
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
  const modeLines = [
    attended ? '## Authorized full delivery in this session (overrides in-scope stop-and-ask)' : '## Unattended execution (headless goal-mode) (BLOCKER — overrides phase SKILL stop-and-ask)',
    '',
    attended ? 'The trusted original user request authorizes autonomous full delivery in this attended session. Transport capabilities do not grant that authority.' : 'This run is **headless / unattended**. There is **no interactive user** in this session.',
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
    `- Record **every** auto-decision as one JSON line in \`${assumptionsRel}\` (machine SSOT; the ledger is an`,
    '  audit trail — it is not authorization, and a missing ledger line does not by itself veto phase closure):',
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
    '- Product source after review closure is reconciled against the closure attestation: a drift is graded by',
    '  risk and reported as a WARN naming the review it still owes (`review_closure_attestation` in testing,',
    '  `ut_no_src_mutation` in ut) — it does not silently pass, and it is not a licence to keep editing.',
    '  You still own the drift: fold it back into coding and re-close review, or do the graded review it names.',
    '  Test seams MUST NOT alter user-visible flows or default behavior — a `*_FAST_PATH`-style switch',
    '  defaulting to true is a blocker, not a workaround.',
    '',
    'After auto-resolving gates: **continue producing phase artifacts** and run harness. Do NOT halt at confirmation gates.',
    '',
  ];
  const attendedModeLines = [
    '## Attended execution (session owner)',
    '',
    'This run is **attended**: a session owner is present and reachable through the executor bridge.',
    "Phase SKILL stop-and-ask confirmations execute as written — stop, ask, and wait for the owner's reply;",
    'the bridge relays it back. This is not a licence to widen scope or to ask instead of doing the work.',
    '',
  ];
  const redLineLines = [
    '**Gate-integrity red lines (BLOCKER — violations are task failure, not a path to completion):**',
    '- NEVER write legacy quality-signature fields such as `confirmed_by`; current quality conclusions require machine evidence.',
    '- `bbox_verified_by` / `approved_by` / `user_requirement` may only carry their narrowly defined provenance or external-authority semantics; they never override quality FAIL.',
    '- NEVER tamper with gate artifacts (visual-diff.json / summary.json / receipts) via process injection',
    '  (NODE_OPTIONS --require/-r/--import/--loader, .node-options, .npmrc node-options, fs monkey-patching)',
    '  or verdict-filling/resetting scripts; never instruct the operator to set up such bypasses.',
    '- NEVER modify the framework control plane. There is no approval field that unlocks it: integrity.drift_allowlist',
    '  and allow_local_drift are retired and ignored on read. 记录具体框架问题与影响；不改framework，继续所有不依赖它的授权工作，确无安全工作时等待原条件恢复。',
    ...deterministicDetectorLines,
  ];
  return [...(attended && !autonomyAuthorized ? attendedModeLines : modeLines), ...redLineLines];
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
  '3. **Do NOT modify product source code, requirement SSOT (acceptance/ui-spec/contracts/spec.md/plan.md), or root build config in this phase — not even to add test anchors.** The runner snapshots all of these around your invocation; a hand-made write is a run-terminating violation (receipt not issued, journal not merged, gate not run; the run halts and --resume is refused). Build artifacts regenerated by the framework harness itself (e.g. module-root BuildProfile.ets rewritten by device_test.build) are auto-classified by the runner as legitimate side effects — running harness self-checks is safe and expected. Do NOT override HARNESS_DEVICE_TEST_PRODUCT/HARNESS_DEVICE_TEST_BUILD_MODE in your shell — the runner froze them for this attempt; a mismatching build artifact is treated as a violation. Missing `by_id` anchors are themselves a defect: record them as a severity=blocker defect anchored to a screens[].must_fix item so coding implements them after backtrack.',
  '4. Use the gate effective authorized conclusion, not raw verdict/must_fix alone. Fully structured minor-only residuals are WARN disclosure in both hard and soft tiers: no coding candidate or blocking debt. Hard-pixel major, T8 major, blocker and independent deterministic failures retain their blocking/repair rules; minor never exempts gross missing anchor text or bidirectional residual checks. Outside the hard-pixel contract, fully anchored self/provider major style residuals follow downgraded_screens: visual debt still blocks release, without coding backtrack. Legacy unanchored instructions stay conservative; missing/stale evidence requires TESTING recapture or review, not guessed code edits. Write actionable must_fix as concrete instructions and retain original observations.',
  '5. If the same set of visual gates keeps failing with no change, the convergence fuse will terminate this run honestly; a successor run needs new evidence or code changes.',
];

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

/** 仅 runtime 的当前 gate 窗口提交；自检 proposal 不能替代正式装机/run 事实。 */
export function commitGateDeviceEvidenceProposal(
  projectRoot: string,
  feature: string,
  runId: string,
  ctx: DeviceTestCollectContext,
): string | null {
  try {
    const reportPath = path.join(ctx.reportsDir, 'script-report.json');
    if (!fs.existsSync(reportPath) || fs.statSync(reportPath).mtimeMs < ctx.harnessWindow.startMs) return null;
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { feature?: string; phase?: string; checks?: CheckResult[] };
    const check = report.checks?.find(item => item.id === 'device_test_evidence');
    if (!check || check.status !== 'PASS') return null;
    if (report.feature !== feature || report.phase !== 'testing') return '当前 gate 的 device evidence report 归属不一致';
    const proposal = check.structured as { kind?: string; doc?: DeviceTestEvidenceDoc } | undefined;
    if (proposal?.kind !== 'device_test_evidence' || !proposal.doc) return '当前 gate 的 device evidence proposal 缺失';
    const doc = proposal.doc;
    const currentHap = resolveCurrentHapSha256Full(projectRoot, ctx.reportsDir);
    if (!currentHap || currentHap !== doc.hap_sha256_full) return '提交前 HAP 摘要不可核验或已变化';
    const issue = validateDeviceTestEvidenceBinding(doc, runId, { ...ctx, currentHapSha256Full: currentHap });
    if (issue) return issue;
    if (doc.artifact_binding) {
      const binding = doc.artifact_binding;
      for (const [file, expected] of [[binding.test_plan_path, binding.test_plan_sha256],
        [binding.derived_plan_path, binding.derived_plan_sha256], [binding.trace_path, binding.trace_sha256]]) {
        if (!file || !expected || sha256FileFull(file) !== expected) return '提交前 native trace/plan binding 已变化';
      }
    }
    const target = deviceTestEvidencePath(ctx.reportsDir);
    const temporary = `${target}.runtime-${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    try { fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return null;
  } catch (error) { return `device evidence 提交失败：${(error as Error).message}`; }
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
      excludePrefixes: [`${relFeaturesDir(projectRoot)}/${featureRelativePath(manifest.feature)}/`],
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
    ...(manifest.adapter_model_pin ? { modelPin: adapterModelBinding(manifest.adapter_model_pin)! } : {}),
  });
  const toolkit = loadProfileOcrToolkit(resolvedProfile.profileDir);
  // E1：金丝雀 verdict=ocr_capable 是补充信号（agent 自身展示了从图片提取文字的能力，即便
  // 判定其无视觉）——OR 进 ocrAvailable，不替代框架自身 OCR 环境探测（后者更可靠/确定性）。
  // cursor review（E6 后）：与 harness-runner.ts 门禁钳制共用同一口径，不再各算一遍。
  const ocrAvailable = resolveOcrAvailableForRun(projectRoot, resolvedProfile.profileDir, manifest.adapter, {
    runId: manifest.run_id,
    ...(manifest.adapter_model_pin ? { modelPin: adapterModelBinding(manifest.adapter_model_pin)! } : {}),
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
  /** 顶层字段级变更清单；无漂移时为空数组，供授权审计。 */
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
          '合法变更：--override-manifest（需求、来源或明示用户截止）/ --override-start/--override-end（对应字段）/ ' +
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
  const byPhase = new Map<string, { run_disposition?: unknown; run_wait_kind?: unknown; probe?: unknown }>();
  // codex 第九批 P0：**有序覆盖语义**（与 rebuildOutcomesFromEvents 同规则）——
  // 后来的 phase_verdict{advance/defer} 清除该 phase 的旧 halt 投影。否则
  // 「ut WAITING 停放 → resume 重跑 PASS」会产出"ut PASS + run_disposition=WAITING"
  // 的自相矛盾报告，且下一次 resume 又把已成功的 ut 重新入队（纯函数回放实证）。
  const CLEARING_ACTIONS = new Set([
    'advance', 'defer_external_and_continue_if_allowed', 'defer_external_and_halt',
  ]);
  for (const e of events) {
    if (e?.type === 'phase_verdict' && (CLEARING_ACTIONS.has(String(e.action))
      || e.verdict === 'PASS' && e.harness_exit === 0 && e.stale_summary !== true)) {
      byPhase.delete(String(e.phase));
      continue;
    }
    if (e?.type !== 'phase_halt') continue;
    if (typeof e.run_disposition !== 'string') continue;
    // plan 4e6fb3b6 §5.2：停机事件上的探针随处置字段一起进 outcome（责任阶段即 outcome.phase），
    // run_end 由此同源复制，supervisor 才能在 run_end 成为来源事件时照样唤醒。
    byPhase.set(String(e.phase), { run_disposition: e.run_disposition, run_wait_kind: e.run_wait_kind, probe: e.probe });
  }
  return outcomes.map((o) => {
    const proj = byPhase.get(String(o.phase));
    if (!proj) return o;
    return {
      ...o,
      run_disposition: proj.run_disposition,
      ...(typeof proj.run_wait_kind === 'string' ? { run_wait_kind: proj.run_wait_kind } : {}),
      ...(typeof proj.probe === 'string' && proj.probe ? { probe: proj.probe } : {}),
    };
  });
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

/**
 * runner-owned-machine-facts 追补（codex review）：spec closure-only 轮的只读取证指令。
 * 冻结的是产物，不是只读视觉取证。plan 8d2b4f60 D3：终签已改材料寻址（本 run 内读过且
 * 内容未变的图即可采信），closure 轮**不再被要求逐图重读**——原先"必须重读满"与 FROZEN
 * 自相矛盾，且 20260815T070732Z-013297 的 content_retry_exhausted 正是它造成的。
 *
 * plan c4e8a1f7 T3（评审 P1 修复）：入参是 `resolveClosureReadRequirement` 归一后的
 * 二态值（'structured_events' | 'none'）——
 *  · 'structured_events'（hasVision ∧ 可审计）：列出权威参考图，图变了要重读；
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
      ? '## Read-only visual evidencing (spec closure)'
      : '## Visual evidencing (spec closure — honest unverified exit)',
    '',
    'FROZEN applies to artifacts, NOT to read-only evidencing. Reference images already read earlier in',
    'THIS run still count as long as their content has not changed; any image that changed must be re-read.',
    ...(isStructured
      ? [
          'The authoritative reference images for this feature are listed below. Reading them is allowed;',
          'modifying any artifact remains forbidden:',
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
  preimages?: Record<string, string | null>;
  afterReport?: boolean;
}

function buildPhaseWriteRecoveryContextBlock(ctx: PhaseWriteRecoveryPromptContext): string {
  if (ctx.sourcePhase === ctx.targetPhase && ctx.preimages) return [
    '', '## Restore only your previous unauthorized writes',
    '恢复本次调用自己造成的越界改动到以下调用前hash；保留此前dirty字节，不扩大业务写权。不得blind git restore、覆盖HEAD或删除整目录。',
    '缺少可信前像、无法还原时如实说明具体文件与缺口，不猜造原字节；已经合法完成的其它工作保留。',
    ...Object.entries(ctx.preimages).map(([file, hash]) => `${file}: pre_sha256=${hash ?? 'missing (only this newly created file may be removed)'}`), '',
  ].join('\n');
  return [
    '',
    '## Why this phase is running again (UNTRUSTED observation — not an authorization)',
    '',
    ctx.afterReport ? `Inputs changed after the prior report was archived; the original post-snapshot remains unchanged. Recheck them at ${ctx.targetPhase}; the later writer is not attributed to the earlier author.`
      : `The previous ${ctx.sourcePhase} invocation changed artifacts owned by this ${ctx.targetPhase} phase.`,
    'The bytes were preserved only as untrusted input; the previous evidence was invalidated.',
    'Re-evaluate the affected artifacts independently and let this phase\'s normal gates decide whether they are valid:',
    '',
    '```text',
    ...ctx.files,
    '```',
    '',
  ].join('\n');
}

/** Existing violation facts retain the first real preimage; later dirty bytes never replace it. */

function beforeAuthorInvocation(events: readonly GoalRunEvent[], invokeId: string): readonly GoalRunEvent[] {
  const at = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === invokeId);
  return at < 0 ? events : events.slice(0, at);
}

function recordAuthorRestorations(events: readonly GoalRunEvent[], changes: readonly PhaseInvocationChange[], phase: string, invokeId: string,
  emit: (event: Record<string, unknown>) => void): void {
  const originals = authorWritePreimages(beforeAuthorInvocation(events, invokeId));
  const restored = changes.filter(change => originals.has(change.path) && originals.get(change.path) === change.postSha256
    && !events.some(event => event.type === 'phase_write_observed' && event.invoke_id === invokeId
      && [...((event as Record<string, any>).observations ?? []), ...((event as Record<string, any>).owned ?? [])].some(row => row.path === change.path && row.post_sha256 === change.postSha256)));
  if (restored.length) emit({ type: 'phase_write_observed', phase, invoke_id: invokeId,
    observations: restored.map(change => ({ path: change.path, how: change.how, pre_sha256: change.preSha256, post_sha256: change.postSha256,
      disposition: 'deferred_to_checker', owner: null, owner_candidates: [], roles: [] })), observed_count: restored.length });
}


/**
 * 作者前置知识：原生索引、任务候选与 extension 同源装配，保留旧导出名供调用者兼容。
 * extension 非法仍警示且不注入其条目；原生知识继续可读，不新增 goal 门禁。
 */
export function extensionInputsForPhase(projectRoot: string, phase: string,
  context?: { frameworkRoot: string; feature: string; runId?: string; requirement?: string }): string {
  const profile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), context?.frameworkRoot);
  const bundle = profile.extensionBundle;
  if (bundle && bundle.errors.length > 0) {
    const brief = bundle.errors.slice(0, 3).map(e => `${e.code}: ${e.message}`).join('；');
    console.warn(
      `[goal-runner] ⚠ extension manifest 非法，作者前置输入未注入：${brief}；运行 harness-runner.ts --phase extensions 修复。`,
    );
  }
  let contracts: import('./utils/types').ContractsSpec | undefined;
  if (context) {
    try { contracts = readRunBoundContracts(projectRoot, context.frameworkRoot, context.feature, context.runId); }
    catch { /* 未有施工契约的作者仍从需求和原生索引发现；原输入门禁负责契约缺失。 */ }
  }
  return renderKnowledge(assembleKnowledge({ projectRoot, frameworkRoot: context?.frameworkRoot ?? path.resolve(profile.profileDir, '../..'), phase,
    subject: 'feature', role: 'author', requirement: context?.requirement, contracts, extensionBundle: bundle }));
}

/** Author work material uses machine observations; full execution prose remains in its original report. */
export function renderWorkUnitAuthorFeedback(input: {
  projectRoot: string; frameworkRoot: string; feature: string; disposition: CurrentDisposition;
}): string {
  return renderCurrentDisposition({ ...input.disposition, problems: input.disposition.problems.map(problem => {
    if (problem.action !== 'repair') return problem;
    const family = problem.source_phase ?? problem.phase;
    const check = readPhaseChecks(input.projectRoot, input.feature, family,
      readPhaseSummary(input.projectRoot, input.feature, family as FeaturePhase).summary).find(check => check.id === problem.id);
    const structured = asRecord(check?.structured);
    const nativeCompile = nativeCompileDiagnosticRefs({ id: problem.id }, input.projectRoot) !== undefined
      && Array.isArray(structured?.compiler_diagnostics) && structured.compiler_diagnostics.length > 0;
    const visual = structured?.kind === 'visual_diff';
    if (!check || check.verification || !nativeCompile && !visual) return problem;
    const facts: Record<string, unknown> = { ...check };
    delete facts.details;
    const observations = { ...structured };
    delete observations.source_attempt_dependencies; // Input provenance is already bound by the signed facts and product snapshot.
    if (visual) {
      delete observations.round;
      delete observations.loop_id;
      delete observations.attempt_id;
      delete observations.goal_run_id;
      if (facts.failure_kind === 'no_progress_fuse') delete facts.failure_kind;
      delete facts.suggestion; // The producer's complete suggestions remain mandatory reading in the original report.
    }
    const report = path.relative(input.projectRoot, path.join(featurePhaseReportsDir(input.projectRoot, input.feature, family, input.frameworkRoot),
      'script-report.json')).replace(/\\/g, '/');
    return { ...problem, detail: `当前${visual ? '视觉业务' : '原生编译'}检查事实（原FAIL/未知不变）：\n${stableStringify({ ...facts, structured: observations })}`
      + (visual ? `\n必须完整读取原始报告及其中全部建议（suggestion）、拒修原文、日志、环境和时长，不以此工作摘要替代原件：${report}`
        : `\n必须完整读取原始报告及其中日志、环境和时长，不以此工作摘要替代原件：${report}`) };
  }) });
}

/** Assemble the prompt and comparison input from the same already-read business sections and report. */
export function buildWorkUnitAuthorInput(input: Parameters<typeof renderWorkUnitAuthorFeedback>[0] & {
  instructions: readonly string[]; evaluation: CompletionEvaluation; repairNotes?: ArtifactSnapshot;
  designDeclineFeedback?: string; designDeclines?: readonly string[];
}): { instruction: string; workInput: WorkUnitInput } {
  const feedback = renderWorkUnitAuthorFeedback(input);
  const completion = '检查通过与任务完成不同；由框架执行真实检查、独立核验并签发终点。';
  const decline = input.designDeclineFeedback ?? '';
  return { instruction: [[...input.instructions, feedback, completion].join('\n'), decline].filter(Boolean).join('\n\n'),
    workInput: { material: { purpose: 'work-unit-author',
      segments: [...input.instructions, dispositionFacts(input.disposition), completion, decline],
      ...(input.repairNotes ? { repairNotes: input.repairNotes } : {}), designDeclines: input.designDeclines ?? [] }, evaluation: input.evaluation } };
}

export function buildClosureOnlyPrompt(
  projectRoot: string, frameworkRoot: string, feature: string, phase: string, timeoutMs: number,
): string {
  const summary = path.relative(projectRoot, path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'summary.json')).replace(/\\/g, '/');
  return [
    `# Closure-only: ${phase} / ${feature}`,
    '本轮只补当前阶段缺失的语义核验或回执，不重新执行完整阶段作业、Research、产品返修或扩面审查。',
    `读取当前 ${summary}，以其 verifier_request/verifier_report 和 next_action 为准。`,
    '当前材料已有有效 verifier 结果时直接复用并执行原 check-receipt/sync-closure，不再派一次核验。',
    '确需语义核验时，将当前 request JSON 原文交给独立 verifier，完整保存回复到 request 对应路径，再按原入口检查回执。',
    '没有 verifier request 不补造；材料过期时只运行必要的当前 harness 刷新，不改写旧身份或伪造 PASS。',
    '真实语义失败交回现有责任调度；本轮不修改产品、验收、契约或 facts，不自行修业务再重签。',
    '本调用的执行者负责所缺核验与报告，外层调度者不并行派审查或写同一报告。',
    `当前调用时限 ${Math.max(0, Math.floor(timeoutMs / 1000))} 秒，沿用原预算与超时出口。`,
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
  /** 共享作者前置知识段（extensionInputsForPhase 产出；空串 / 缺省 = 不注入）。 */
  extensionInputs?: string,
  /**
   * plan 5e1c7a93 D4：本轮是否 attended（session owner 在场）。true = 不注入无人值守模式段，
   * 只注入完整性红线与确定性检测段。缺省 false，既有调用逐字不变。
   */
  attended?: boolean,
  autonomyAuthorized = false,
): string {
  const skillAbs = phaseSkillPath(frameworkRoot, phase);
  const parts = [
    `# Goal run phase: ${phase}`,
    '',
    `Feature: ${manifest.feature}`,
    manifest.requirement ? `Requirement:\n${manifest.requirement}` : '',
    '',
    // plan 33784ed1 §3.3：目标简报——需求行与冻结范围段已在本提示词里，只补明确不做、已裁决的冲突与判定办法。
    renderGoalBrief(assembleGoalBrief(projectRoot, manifest.feature, { runId: manifest.run_id }), { sections: EXECUTOR_BRIEF_SECTIONS }),
    '',
    formatDeferredUpstreamNotice(deferredUpstream),
    ...(readPhaseRepairIssues(projectRoot, manifest.feature, String(phase), { frameworkRoot, runId: manifest.run_id })?.diagnostics ?? []).map(reason => `Upstream proposal feedback: ${reason}`),
    ...(capabilityAdvisory ? buildCapabilityBlock(capabilityAdvisory) : []),
    ...buildUnattendedExecutionBlock(manifest, phase, projectRoot, capabilityAdvisory ?? undefined, attended === true, autonomyAuthorized),
    '',
    '## Orchestrator constraints (BLOCKER)',
    '',
    '- Do NOT invoke goal-runner, --resume, or --manifest; the orchestrator is already running this goal run.',
    '- goal-runs/ evidence directory is read-only for you: do NOT write, append, or patch events.jsonl or any run artifacts.',
    ...(phaseWriteBoundary
      ? ['', ...renderPhaseWriteBoundaryGuidance(phaseWriteBoundary, String(phase))]
      : []),
    '',
    `Read and follow the phase skill: ${path.relative(frameworkRoot, skillAbs).replace(/\\/g, '/')}`,
    `Skill absolute path: ${skillAbs}`,
    // plan a7c3e9d2：作者动笔前的实例扩展输入（d8f4b7e2 自陈的"通用注入"由此落地）；读取指令放这里，formatter 只负责索引与绑定块。
    ...(extensionInputs
      ? ['', "Before writing this phase's artifacts, read the knowledge inputs below that apply to this phase.", '', extensionInputs]
      : []),
    // plan f4c8d2b7 t6：仅 ut 阶段注入两产物格式契约与 SSOT 解析后的模板真实路径——
    // headless agent 拿不到 profile-skill-asset 多跳指针后面的 OUTPUT CONTRACT（宿主
    // 实锤：精准踩中模板明文禁止的 Markdown 表格）。通用注入属 d8f4b7e2 范围，落地后本块退役。
    ...(phase === 'ut' ? ['', ...renderUtFormatContractLines(projectRoot)] : []),
    '',
    'After producing artifacts, run harness for this phase and ensure summary.json is written.',
    'Do NOT claim phase complete if harness verdict is INCOMPLETE or FAIL.',
    manifest.execution_scope
      ? `After this phase, only the frozen remaining chain applies: ${manifest.execution_scope.phase_chain.slice(manifest.execution_scope.phase_chain.indexOf(phase) + 1).join('→') || 'validate requested result'}.`
      : phase === 'coding'
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
        'Record the concrete infrastructure failure and its impact. Continue authorized work that does not depend on it; preserve the affected work and report its exact recovery condition when it cannot safely proceed.',
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
              '- **Transport**: its invocation did not complete (historical agent_timeout); partial artifacts are on disk.',
              `- **Quality**: the harness for that same attempt recorded **${timeoutCoexistingHarnessFailure.verdict}**`
                + `${timeoutCoexistingHarnessFailure.failure_kind ? ` (failure_kind: ${timeoutCoexistingHarnessFailure.failure_kind})` : ''}`
                + ' — the BLOCKER evidence above is real content feedback, not timeout noise.',
              'Resume from the partial artifacts AND address that evidence; do NOT revert or redo completed parts.',
            ]
          : [
              '**The prior invocation did not complete (historical agent_timeout) — NOT a content failure.**',
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
        '保留原工具故障与验证缺口，继续独立授权工作；实际工具或相关输入恢复后仅补原检查，同条件不重复调用。',
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
  if (manifest.execution_scope) {
    const scope = manifest.execution_scope;
    parts.push('', '## Frozen execution scope / P1 input protocol 1.1',
      `Completion target: ${scope.completion_target}; requested results: ${scope.requested_results.join(', ')}`,
      `Frozen phase chain: ${scope.phase_chain.join('→')}; execute only ${phase} in this invocation.`,
      `Before substantive work, establish or adopt real facts at ${featureFilePath(projectRoot, manifest.feature, 'context/facts.md')}. Preserve any validated original baseline and its establishing phase; a reordered remaining queue does not redefine its owner.`,
      'Preserve a validated predecessor baseline and its actual established_by; append only this phase_delta. Never invent spec/change execution.',
      'New facts belong to the responsible Skill/checker; do not edit the frozen manifest or cancel obligations because a check failed.',
      ...scope.obligations.filter(o => o.owner_phase === phase).map(o => `${o.id}: ${o.applicability}; ${o.reason}`));
  }
  return parts.join('\n');
}

/** Render the same phase/mode selected by the runtime; attended identity never leaks into detached commands. */
export function phaseInvocationCommands(projectRoot: string, frameworkRoot: string, feature: string, phase: string,
  attended?: { runId: string; attemptId: string; ownerId: string; ownerEpoch: number }): string[] {
  const quote = (value: string): string => process.platform === 'win32'
    ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
  const args = ['npx ts-node', quote(path.join(frameworkRoot, 'harness', 'harness-runner.ts')), '--project-root', quote(projectRoot),
    '--phase', quote(phase), '--feature', quote(feature)];
  if (attended) args.push('--goal-run-id', quote(attended.runId), '--goal-attempt-id', quote(attended.attemptId),
    '--goal-owner-id', quote(attended.ownerId), '--goal-owner-epoch', String(attended.ownerEpoch));
  return [`${args.join(' ')} --summary`, `${args.join(' ')} --sync-closure`];
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
): boolean {
  if (force) return false;
  const featureRunsDirAbs = path.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs');
  const orphan = resolveOrphanedIncompleteRun(featureRunsDirAbs, projectRoot);
  if (!orphan) return false;
  if (orphan.runMode === 'unknown') {
    // v23 P1-①：无法判别形态——不猜、不给 resume 指引，人工处置。
    console.error(
      `[goal-runner] BLOCKER: feature "${feature}" 有形态无法判别的孤儿 lock（run "${orphan.runId}"，` +
        `${orphan.reason}）。请人工核查 goal-runs/${orphan.runId}/ 后处置；确认放弃加 --force。`,
    );
    return true;
  }
  console.error(
    `[goal-runner] BLOCKER: feature "${feature}" 有未完成的 goal-run "${orphan.runId}"` +
      `（疑似孤儿：${orphan.reason}）。\n` +
      `  续跑既有 run（推荐）: --resume ${orphan.runId} --feature ${feature} [--force-resume]\n` +
      `  确认放弃该 run 改起全新 run: 本次命令加 --force`,
  );
  return true;
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
    sessionRequest?: IssuedSessionExecution;
    resumeSessionToken?: RunFenceToken;
  },
): void {
  const { runId, reportDir, runMode } = run;
  const featureRunsDir = path.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs');
  const featureLockPath = path.join(featureRunsDir, FEATURE_LOCK_NAME);
  // plan e7c2a4d8 T1b''：per-run lock 从 canonical manifest.report_dir 派生
  //（dry 落 goal-runs/.dry/<run_id>/）；feature 串行锁继续共享（同 feature 串行）。
  const runLockPath = path.join(projectRoot, ...reportDir.split('/'), RUN_LOCK_NAME);

  const fRecord = tryAcquireLock(featureLockPath, {
    run_id: runId, run_mode: runMode, report_dir: reportDir,
  });
  if (!fRecord) {
    const existing = readLockRecord(featureLockPath);
    throw new Error(formatLockBlocker(featureLockPath, existing));
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
  const resumeSessionToken = run.resumeSessionToken ?? run.sessionRequest?.request.context.owner;
  const acquiredControl = resumeSessionToken
    ? { ok: true as const, control: resumeIssuedSessionOwner(runDir, resumeSessionToken), token: resumeSessionToken }
    : run.explicitTakeover && existingControl.owner?.state === 'orphaned_session'
      ? { ok: true as const, ...forceTakeoverRunOwner(
          runDir, runId, existingControl.current_epoch, ownerInput,
        ) }
      : casAcquireRunOwner(runDir, runId, existingControl.current_epoch, ownerInput);
  if (!acquiredControl.ok) {
    releaseLock(featureLockPath, fRecord.ownerId);
    console.error('[goal-runner] BLOCKER: run-control owner busy or epoch changed');
    throw new Error('[goal-runner] BLOCKER: run-control owner busy or epoch changed');
  }
  setLockEpoch(featureLockPath, fRecord.ownerId, acquiredControl.token.epoch);
  const rRecord = tryAcquireLock(runLockPath, {
    run_id: runId, run_mode: runMode, report_dir: reportDir, ownerId: fRecord.ownerId,
    epoch: acquiredControl.token.epoch,
  });
  if (!rRecord) {
    if (!resumeSessionToken) releaseRunOwner(runDir, acquiredControl.token);
    releaseLock(featureLockPath, fRecord.ownerId);
    const existing = readLockRecord(runLockPath);
    throw new Error(formatLockBlocker(runLockPath, existing));
  }

  runControl = { dir: runDir, token: acquiredControl.token };
  const heartbeatMs = ownerKind === 'session'
    ? Math.max(250, Math.min(LOCK_HEARTBEAT_MS, Math.trunc(leaseMs / 3)))
    : lockHeartbeatIntervalMs();
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
  frameworkRoot: string,
  featuresDir: string,
  workflow: ReturnType<typeof resolveWorkflowSpec>,
  writerState: ProgressWriterState,
): (force?: boolean, writeMd?: boolean, currentDisposition?: import('./utils/check-disposition').CurrentDisposition) => void {
  const flushProgress = (force = false, writeMd = false, currentDisposition?: import('./utils/check-disposition').CurrentDisposition): void => {
    try {
      assertGoalBoundary('progress_write');
      const now = Date.now();
      if (!force && shouldThrottleSnapshot(writerState, now)) return;
      const ctx = loadProgressContext(projectRoot, manifest, featuresDir);
      const snapshot = projectGoalProgress({
        projectRoot,
        frameworkRoot,
        currentDisposition,
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
      const currentEvents = loadAuthoritativeEvents(path.join(projectRoot, manifest.report_dir, 'events.jsonl'));
      const currentInvoke = [...currentEvents].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === progressPhase);
      const outputLog = invocationOutputLogPath(path.resolve(projectRoot, manifest.report_dir), progressPhase, currentInvoke?.invoke_id);
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
      const activity = readOriginalDeliveryActivity(projectRoot, manifest) ?? readExecutionActivity(events);
      appendEvent(manifest.report_dir, projectRoot, {
        type: 'heartbeat',
        phase: progressPhase,
        substep: progressSubstep,
        elapsed_ms: activity.active_ms,
        turns_used: activity.calls,
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

export function buildAgentWarn(invoke: {
  exitCode: number;
  timed_out?: boolean;
  silent_killed?: boolean;
  completion_observed?: boolean;
  duration_ms?: number;
}): string | undefined {
  if (invoke.exitCode === 0 && !invoke.timed_out && !invoke.silent_killed) return undefined;
  // plan b7d2e9f4 §3.4：完成后被宽限清理 kill 的非零退出码只是噪声；timeout / silent_killed / 真实失败照报。
  if (invoke.completion_observed && !invoke.timed_out && !invoke.silent_killed) return undefined;
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
  let authorized = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--detach') continue;
    if (a === '--run-id') {
      i++; // drop any pre-existing --run-id + its value; we re-add canonically
      continue;
    }
    if (a === '--authorize-autonomy') { authorized = true; out.push(a); continue; }
    out.push(a);
  }
  out.push('--detached-child');
  if (!opts.resume) out.push('--run-id', runId);
  // plan 6fd6c8c1 §4.3.2：父进程已把 `--detach` 归一为无人值守授权；子进程不能再从
  // 剥离后的 argv 猜，也不能靠 --detached-child 自我授权。用既有非持久参数透传原输入；
  // supervisor 的 `--resume … --detach` 同样走这条入口，重启不丢授权。
  if (!authorized) out.push('--authorize-autonomy');
  return out;
}

/**
 * `--detach` launcher: spawn the real run as an independent background process and
 * return immediately. Critical Windows semantics (see chrys shell-tool host):
 *  - child stdio → log file, NEVER the parent's inherited stdout/stderr pipe, so a
 *    blocking host (chrys `communicate()`) sees EOF and the launcher "completes";
 *  - launcher exits 0 fast → host's clean-exit path does not tree-kill the child.
 */
export type DetachedStartupResult =
  | { state: 'ready'; event: 'run_start' }
  | { state: 'terminal'; status: string }
  | { state: 'alive_timeout'; detail: string }
  | { state: 'failed'; detail: string };

export async function waitForDetachedStartup(input: {
  projectRoot: string;
  reportDirRel: string;
  runId: string;
  baselineEventCount: number;
  childExitCode: () => number | null;
  childAlive?: () => boolean;
  childError?: () => string | undefined;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<DetachedStartupResult> {
  const deadline = Date.now() + Math.min(30_000, Math.max(1, input.timeoutMs ?? 10_000));
  const pollMs = Math.max(1, input.pollMs ?? 50);
  const runDir = path.resolve(input.projectRoot, ...input.reportDirRel.split('/'));
  const eventsPath = path.join(runDir, 'events.jsonl');
  const manifestPath = path.join(runDir, 'manifest.json');
  const progressPath = path.join(runDir, 'progress.json');
  const logPath = path.join(runDir, 'detach.log');
  const logTail = (): string => {
    try { return fs.readFileSync(logPath, 'utf8').slice(-400).replace(/\s+/g, ' ').trim(); } catch { return ''; }
  };
  while (true) {
    const spawnError = input.childError?.();
    if (spawnError) return { state: 'failed', detail: `child spawn failed: ${spawnError}` };
    let manifestMatches = false;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { run_id?: unknown };
      manifestMatches = manifest.run_id === input.runId;
    } catch { /* child may not have published manifest yet */ }
    const events = fs.existsSync(eventsPath) ? loadEventsJsonl(eventsPath).slice(input.baselineEventCount) : [];
    const terminal = [...events].reverse().find(event => event.type === 'run_end');
    if (manifestMatches && terminal) return { state: 'terminal', status: String(terminal.status ?? 'unknown') };
    if (manifestMatches && events.some(event => event.type === 'run_start')) return { state: 'ready', event: 'run_start' };
    const exitCode = input.childExitCode();
    if (exitCode !== null) {
      return { state: 'failed', detail: `child exited before authoritative run_start (exit=${exitCode})${logTail() ? `: ${logTail()}` : ''}` };
    }
    // Read the authoritative facts once after a delayed poll before declaring the window elapsed.
    if (Date.now() >= deadline) break;
    await new Promise<void>(resolve => setTimeout(resolve, pollMs));
  }
  const beacon = assessLivenessBeacon({
    beacon: readLivenessBeacon(input.projectRoot, input.reportDirRel),
    runId: input.runId,
  });
  let progress = '';
  try {
    const snapshot = JSON.parse(fs.readFileSync(progressPath, 'utf8')) as { run_id?: unknown; status?: unknown; next_action?: unknown };
    if (snapshot.run_id === input.runId) progress = `; status=${String(snapshot.status ?? 'unknown')}; next=${String(snapshot.next_action ?? 'unknown')}`;
  } catch { /* optional projection */ }
  if ((input.childAlive?.() ?? input.childExitCode() === null) || beacon.state === 'alive') {
    return { state: 'alive_timeout', detail: `child still active but authoritative run_start not observed within startup window${progress}` };
  }
  return { state: 'failed', detail: `child exited during startup confirmation${logTail() ? `: ${logTail()}` : ''}` };
}

function normalizeSupersedeTargets(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim());
}

/**
 * plan 4e6fb3b6 §7.3：前台与 detach 共用的接续决策取数——本次调用事实（显式需求、显式型号、既有预算授权）交给
 * 同一个 decideRunContinuation；显式旗标由调用方先判，这里只算"去掉显式旗标后的"决策。
 */
function decideLaunchContinuation(
  argv: minimist.ParsedArgs,
  projectRoot: string,
  feature: string,
  opts: { plain: true; frameworkRoot?: string; requirementSources?: string[]; attended?: boolean; runProbe?: (probe: string, phase: string) => ConditionProbeResult },
): RunContinuationDecision {
  let model: string | undefined;
  try { model = normalizeAdapterModelCliValue(argv['adapter-model']); } catch { model = undefined; /* 非法值由既有校验报错 */ }
  const requirement = !argv.resume && typeof argv.requirement === 'string' && argv.requirement.trim() ? argv.requirement : undefined;
  const call: ContinuationCallFacts = {
    ...(requirement ? { requirement, ...(opts.requirementSources?.length ? { requirementSourceFiles: opts.requirementSources } : {}) } : {}),
    ...(model ? { model, ...(['adapter-provider', 'adapter-reasoning', 'adapter-model-config'].some(key => argv[key] !== undefined) ? {
      adapterModelPin: { adapter: String(argv.adapter ?? 'generic'), value: model,
        ...(argv['adapter-provider'] !== undefined ? { provider: String(argv['adapter-provider']) } : {}),
        ...(argv['adapter-reasoning'] !== undefined ? { reasoning_effort: String(argv['adapter-reasoning']) } : {}),
        ...(argv['adapter-model-config'] !== undefined ? { config_source: path.resolve(projectRoot, String(argv['adapter-model-config'])) } : {}) }
    } : {}) } : {}),
    ...(opts.attended ? { attended: true } : {}),
  };
  const runProbe = opts.runProbe;
  return decideRunContinuation({ projectRoot, frameworkRoot: opts.frameworkRoot, feature, call, ...(runProbe ? { runProbe: (_dir: string, probe: string, phase?: string) => runProbe(probe, phase ?? '') } : {}) });
}

/**
 * plan 9c3d7e1a §5.3：显式 `--resume <run>`（supervisor 拉起 / 操作者手工）也经同一恢复判断——去掉显式旗标后的接续决策若是
 * "停机所挂探针已就绪、冻结绑定已失效，从该 run 起后继"，本次调用就按起后继走，不在原 run 上继续。其余情况 `--resume` 照原样。
 */
function resumeTurnsIntoSuccessor(argv: minimist.ParsedArgs, decision: RunContinuationDecision | null): boolean {
  return Boolean(argv.resume) && !argv.force && !normalizeSupersedeTargets(argv.supersede).length
    && decision?.kind === 'successor' && decision.change === 'external_condition_ready' && decision.targets.includes(String(argv.resume).trim());
}

/**
 * plan a2f7c9e4 §3.7：返修诊断材料按调用方的**原始**参数判合法——没有 `--resume` 的 fresh 调用才拒绝。detach 子进程的参数
 * 已由父进程按同一恢复判断改写（起后继时去掉了 `--resume`），子进程不再按改写后的参数重判。这是正常内部调用链的约定
 * （`--detached-child` 由父进程传入），不是不可伪造的保证；外部手填该旗标最多让 fresh 调用读到材料并在后来出现返修窗口时注入，
 * 不改变需求、身份、授权或预算。
 * 材料只读一次进提示词，不参与接续决策、不碰冻结绑定检查。未提供返回 null；用法或读取错误抛出（调用方 exit 2）。
 */
function readRepairNotes(argv: minimist.ParsedArgs, projectRoot: string): { file: string; text: string } | null {
  const raw = typeof argv['repair-notes'] === 'string' ? argv['repair-notes'].trim() : '';
  if (!raw) return null;
  if (!argv.resume && !argv['detached-child'] && !argv['attach-created']) {
    throw new Error('--repair-notes 只随 --resume 生效（返修诊断材料不是需求；要改需求请用 --requirement-file 开新 run）。');
  }
  const file = path.resolve(projectRoot, raw);
  try {
    return { file: path.relative(projectRoot, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf-8').trim() };
  } catch (error) {
    throw new Error(`--repair-notes 读取失败：${(error as Error).message}`);
  }
}

/** 测试缝：detach 的子进程 spawn（缺省 child_process.spawn）；接线用例据此在进程内跑子进程那一半。 */
let injectedDetachSpawn: typeof spawn | null = null;
export function __testing_setDetachSpawn(fn: typeof spawn | null): void {
  injectedDetachSpawn = fn;
}

/** runProbe：与前台同一测试缝（GoalPhaseRuntimeLaunchOptions.conditionWait.runProbe）；生产 CLI 不传，取共享的真实探针。 */
async function runDetachLauncher(argv: minimist.ParsedArgs, runProbe?: (probe: string, phase: string) => ConditionProbeResult): Promise<number> {
  const layout = injectedLayout ?? detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDir = (cfg.paths.features_dir ?? 'doc/features').replace(/\\/g, '/');
  // plan a2f7c9e4 §3.7：材料合法性按原始参数在入口判（与前台同一函数、同一退出码），不建日志目录、不起子进程
  try {
    readRepairNotes(argv, projectRoot);
  } catch (error) {
    console.error(`[goal-runner] BLOCKER: ${(error as Error).message}`);
    return 2;
  }

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
  const designRequest = !raw.isResume && !raw.dryRun ? resolveDesignDeliveryRequest(argv, projectRoot) : null;
  const originalDesign = !raw.dryRun ? findInitialDesignRun({ projectRoot, feature,
    ...(designRequest?.requirement ? { requirement: designRequest.requirement } : {}),
    ...(raw.isResume && raw.runId ? { runId: raw.runId } : {}) }) : null;
  let isResume = raw.isResume;
  const supersedeTargets = normalizeSupersedeTargets(argv.supersede);
  let runId = raw.runId ?? (originalDesign && !supersedeTargets.includes(originalDesign.run_id) ? originalDesign.run_id : newRunId());
  let launchArgs = process.argv.slice(2);
  let sourceManifest = originalDesign ?? (raw.isResume && raw.runId ? loadGoalRunManifestFromRun(projectRoot, raw.runId, { feature })
    : argv.manifest ? loadGoalManifestFile(String(argv.manifest), projectRoot) : undefined);
  const launchAdapter = reconcileRunAdapter({ projectRoot, requestedAdapter: argv.adapter ? String(argv.adapter) : sourceManifest?.adapter,
    override: Boolean(argv['override-adapter']), adapterSource: argv['adapter-source'] ? String(argv['adapter-source']) : undefined }).effectiveAdapter;
  let capturedPin = launchModelPin(argv, launchAdapter, projectRoot, sourceManifest?.adapter_model_pin);
  // plan 9c3d7e1a §5.3：supervisor 只负责拉起 `--resume`；原 run 继续还是起后继由这里与子进程用同一判断决定。
  if (isResume && !raw.dryRun) {
    let recovery: RunContinuationDecision | null = null;
    try { recovery = decideLaunchContinuation(argv, projectRoot, feature, { plain: true, frameworkRoot: layout.frameworkRoot, ...(runProbe ? { runProbe } : {}) }); } catch { recovery = null; /* 判断不了就照原样恢复，由恢复守卫把关 */ }
    if (resumeTurnsIntoSuccessor(argv, recovery)) {
      console.log(`[goal-runner] --resume ${String(argv.resume)}：${recovery!.reason}——改为起后继并承接它`);
      const resumeAt = launchArgs.indexOf('--resume');
      launchArgs = launchArgs.filter((arg, index) => arg !== '--force-resume' && !arg.startsWith('--resume=') && (resumeAt < 0 || (index !== resumeAt && index !== resumeAt + 1)));
      delete argv.resume;
      isResume = false;
      runId = newRunId();
    }
  }

  // plan 4e6fb3b6 §7.3：与前台同一个接续决策，在孤儿守卫与接续守卫之前执行。保持停止 = 不起子进程、不新建 run；
  // 重新接入 = 打印并等待那个既有 run（子进程按同一决策改写为恢复或附着）；新开与起后继照常给新 run id。
  const explicitContinuation = isResume || supersedeTargets.length > 0 || Boolean(argv.force);
  if (!explicitContinuation && !raw.dryRun && !originalDesign) {
    let decision: RunContinuationDecision;
    try {
      const requirement = resolveRequirementInput({
        requirement: argv.requirement,
        requirementFile: argv['requirement-file'],
        projectRoot,
      });
      decision = decideLaunchContinuation(
        { ...argv, ...(requirement.text !== undefined ? { requirement: requirement.text } : {}) } as minimist.ParsedArgs,
        projectRoot, feature, { plain: true, frameworkRoot: layout.frameworkRoot, requirementSources: requirement.sources, ...(runProbe ? { runProbe } : {}) },
      );
    } catch (error) {
      console.error(`[goal-runner] BLOCKER: ${(error as Error).message}`);
      return 1;
    }
    if (decision.kind === 'hold') {
      console.error(`[goal-runner] ${decision.guidance}`);
      return 1;
    }
    if (decision.kind === 'rejoin') {
      if (raw.runId && raw.runId !== decision.runId) {
        console.error(`[goal-runner] BLOCKER: 本次请求指定了新 run ${raw.runId}，但同一任务的未终局 run ${decision.runId} 应重新接入（${decision.reason}）`);
        return 1;
      }
      runId = decision.runId;
      sourceManifest = loadGoalRunManifestFromRun(projectRoot, decision.runId, { feature });
    } else if (decision.kind === 'successor') {
      sourceManifest = loadGoalRunManifestFromRun(projectRoot, decision.source, { feature });
    }
  }
  const reportDirRel = resolveGoalReportDir({ featuresDir, feature, runId, dryRun: raw.dryRun });

  // Same orphan guard as the foreground path — refuse a stillborn new run_id when an
  // orphaned-but-incomplete run exists (so --detach doesn't print run_id then die).
  // dry-run 隔离命名空间，不受真实 run 孤儿阻挡。显式旗标的调用照现状执行（其余已由接续决策消费）。
  if (!isResume && !raw.dryRun && explicitContinuation) {
    if (guardOrphanedFeatureRun(projectRoot, featuresDir, feature, Boolean(argv.force))) return 1;
    try {
      const requirement = resolveRequirementInput({
        requirement: argv.requirement,
        requirementFile: argv['requirement-file'],
        projectRoot,
      });
      const continuation = evaluateFreshRunContinuation({
        projectRoot,
        manifest: {
          feature,
          run_id: runId,
          report_dir: reportDirRel,
          requirement: requirement.text,
          ...(requirement.sources.length > 0 ? { requirement_source_files: requirement.sources } : {}),
          ...(supersedeTargets[0] ? { successor_of: supersedeTargets[0] } : {}),
        },
        forceFresh: Boolean(argv.force),
      });
      if (!continuation.allowed) {
        console.error(`[goal-runner] BLOCKER: ${continuation.reason}`);
        return 1;
      }
    } catch (error) {
      console.error(`[goal-runner] BLOCKER: ${(error as Error).message}`);
      return 1;
    }
  }
  capturedPin = capturedPin?.source === 'frontend' && sourceManifest?.adapter_model_pin ? undefined : freezeModelPin(capturedPin, projectRoot);
  if (capturedPin) launchArgs.push('--captured-model-pin', JSON.stringify(capturedPin));
  const reportDirAbs = path.join(projectRoot, ...reportDirRel.split('/'));
  fs.mkdirSync(reportDirAbs, { recursive: true });
  const logPathAbs = path.join(reportDirAbs, 'detach.log');
  const logFd = fs.openSync(logPathAbs, 'a');
  const eventsPathAbs = path.join(reportDirAbs, 'events.jsonl');
  const baselineEventCount = fs.existsSync(eventsPathAbs) ? loadEventsJsonl(eventsPathAbs).length : 0;

  const childArgs = buildDetachedChildArgv(launchArgs, runId, { resume: isResume });
  const preloadPath = resolveDetachedPreloadPath();
  const child = (injectedDetachSpawn ?? spawn)(
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
  let spawnError: string | undefined;
  child.once('error', error => { spawnError = error.message; });
  // Parent must release the fd and the child reference: keeps no handle on the log
  // (so the host's pipe wait can't be extended) and lets the parent exit cleanly.
  child.unref();
  fs.closeSync(logFd);

  const startup = await waitForDetachedStartup({
    projectRoot,
    reportDirRel,
    runId,
    baselineEventCount,
    childExitCode: () => child.exitCode,
    childAlive: () => typeof child.pid === 'number' && pidExists(child.pid),
    childError: () => spawnError,
  });

  console.log(
    JSON.stringify({
      detached: true,
      run_id: runId,
      feature,
      report_dir: reportDirRel,
      log: path.relative(projectRoot, logPathAbs).replace(/\\/g, '/'),
      pid: child.pid ?? null,
      startup,
    }),
  );
  return startup.state === 'failed' ? 1 : 0;
}

/** Resolve in the framework process; the detached child may start from a dependency-free consumer cwd. */
export function resolveDetachedPreloadPath(): string {
  return require.resolve('ts-node/register/transpile-only');
}

export interface GoalPhaseRuntimeLaunchOptions {
  /** Nonresident transport only; phase policy and progression remain in this runtime. */
  sessionHandoff?: { requestPath?: string; report?: SessionExecutionReport; onRequest: (request: IssuedSessionExecution) => void };
  /** Fault-injection seam for the run-internal revision cut; not a runtime mode. */
  onScopeRevision?: (boundary: 'applied') => void;
  /** Explicit argv for embedded callers; CLI callers omit it. */
  args?: readonly string[];
  /** Explicit layout keeps host bridges and fixture runs independent from process.cwd(). */
  layout?: RepoLayout;
  /** Owner identity changes fencing/handoff posture only; lifecycle policy remains shared. */
  ownerKind?: RunOwnerKind;
  /** Optional transport injection. The runtime remains the sole lifecycle owner. */
  executor?: GoalPhaseExecutor;
  /** The completion coordinator observes native facts and cancels this owner-bound invocation. */
  executionControls?: WorkUnitExecutionControls;
  /** Existing attended authorization contract, enforced by the runtime at phase boundaries. */
  authorization?: AssessAuthorizationContext;
  /** Session owner lease duration; ignored for process owners. */
  leaseMs?: number;
  /** Maximum number of phase boundaries this invocation may start. */
  /**
   * plan 4e6fb3b6 §5.1：带探针停机的进程内有界等待。缺省（生产 CLI）取 waitForConditionRecovery
   * 的默认上限 15 分钟、间隔 30 秒与共享的真实探针；嵌入调用方（测试）可把上限/间隔调小或换探针。
   */
  conditionWait?: {
    maxWaitMs?: number;
    pollMs?: number;
    runProbe?: (probe: string, phase: string) => ConditionProbeResult;
  };
}

function withExecutionControls(options: GoalPhaseRuntimeLaunchOptions): GoalPhaseRuntimeLaunchOptions {
  if (options.executionControls?.cancel) return options;
  const controller = new AbortController();
  const external = options.executionControls;
  if (external?.signal?.aborted) controller.abort(external.signal.reason);
  else external?.signal?.addEventListener('abort', () => controller.abort(external.signal!.reason), { once: true });
  return { ...options, executionControls: { ...external, signal: controller.signal,
    cancel: reason => controller.abort(reason),
    onObservation: view => { external?.onObservation?.(view); progressHeartbeatHook?.(); },
  } };
}

/**
 * The single production phase lifecycle. Both attended and detached callers enter main();
 * only the supplied executor transport and fenced owner kind differ.
 */
function resolveRuntimeLayout(options: GoalPhaseRuntimeLaunchOptions, argv: minimist.ParsedArgs): RepoLayout {
  const detected = options.layout ?? injectedLayout ?? detectRepoLayout(__dirname);
  return { ...detected,
    projectRoot: argv['project-root'] ? path.resolve(String(argv['project-root'])) : detected.projectRoot,
    frameworkRoot: argv['framework-root'] ? path.resolve(String(argv['framework-root'])) : detected.frameworkRoot,
  };
}

/** Only the halt immediately caused by this session's successful design publication may relaunch. */
export function designRepairNeedsContinuation(events: readonly GoalRunEvent[], chain: readonly string[]): boolean {
  const records = events as ReadonlyArray<GoalRunEvent & { stage?: string; outcome?: string }>;
  const end = [...records].reverse().find(event => event.type === 'run_end');
  if (end?.status !== 'HALTED' || end.halt_reason !== 'execution_scope_unresolved') return false;
  const startAt = records.map(event => event.type).lastIndexOf('run_start');
  const repair = [...records].reverse().find(event => event.type === 'design_authority_repair' && event.stage === 'published');
  const halt = [...records].reverse().find(event => event.type === 'phase_halt');
  if (!repair || repair.outcome !== 'recovered' || !halt || halt.phase !== repair.phase
    || halt.halt_reason !== 'execution_scope_unresolved') return false;
  const repairAt = records.lastIndexOf(repair), haltAt = records.lastIndexOf(halt);
  return repairAt > startAt && haltAt > repairAt
    && !records.slice(repairAt + 1, haltAt).some(event => event.type === 'agent_invoke_start' && chain.includes(String(event.phase)));
}

export function parseGoalRuntimeArgs(args: readonly string[]): minimist.ParsedArgs {
  return minimist([...args], {
    string: [
      'feature', 'requirement', 'adapter', 'adapter-source', 'start', 'end', 'resume', 'manifest',
      'run-id', 'supersede', 'rebaseline-to', 'attach-created',
      'user-deadline-at',
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
      'adapter-model', 'adapter-provider', 'adapter-reasoning', 'adapter-model-config', 'frontend-request-file', 'frontend-session-id', 'frontend-request-id', 'captured-model-pin',
      // plan ab072691 t1④：只读视觉 provider 的显式身份（**成对必填**）。
      // 与 --adapter-model 对仗但独立：那是 primary 执行身份，这是第二个「只看图」endpoint。
      'visual-adapter', 'visual-model', 'visual-provider', 'visual-reasoning', 'visual-model-config',
      // plan a2f7c9e4 §3.7：随 --resume 给的返修诊断材料（驱动方假设，非需求）；只进返修窗口提示词，
      // 不进 manifest、需求哈希或接续决策。
      'repair-notes',
    ],
    boolean: [
      'help', 'dry-run', 'force-resume', 'override-start', 'override-end', 'override-manifest',
      'override-adapter',
      'detach', 'detached-child', 'force', 'foreground-ok',
      // plan 6fd6c8c1 §4.3.2：后台入口转换后的共同授权输入（非持久；不写 manifest）。
      'authorize-autonomy',
      'refresh-vision-probe',
    ],
    alias: { f: 'feature', h: 'help' },
  });
}

/** Preserve the current process's explicit launch posture; continuation grants none. */
export function inheritRunProcessArgs(argv: Record<string, unknown>): string[] {
  return [...(argv['foreground-ok'] === true ? ['--foreground-ok'] : []), ...(argv['detached-child'] === true ? ['--detached-child'] : []),
    ...(argv['authorize-autonomy'] === true ? ['--authorize-autonomy'] : [])];
}

function resolveEntryAuthorization(options: GoalPhaseRuntimeLaunchOptions, argv: Record<string, unknown>) {
  return options.authorization ?? (argv['authorize-autonomy'] === true ? { mode: 'goal_mode' as const, autonomyAuthorized: true } : undefined);
}

function liveFeatureLock(projectRoot: string, feature: string): LockRecord | null {
  const record = readLockRecord(featureFilePath(projectRoot, feature, path.join('goal-runs', FEATURE_LOCK_NAME)));
  return record && !isLockStale(record) ? record : null;
}

function recoverRuntimeGuardians(priorEvents: GoalRunEvent[], runId: string, forceResume: boolean, emit: (event: Record<string, unknown>) => void, stop: (reason: string, detail: string) => void): number {
  const manifest = { run_id: runId };
  const goalEvents = { emit };
  const concludeStartupBlocker = stop;
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
            goalEvents.emit({
              type: 'orphan_reclaimed',
              run_id: manifest.run_id,
              invoke_id: item.bound.invoke_id,
              pid: item.bound.pid,
              method: 'guardian_gone',
            });
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
  return 0;
}

function rejectsResumeRequirementFile(argv: minimist.ParsedArgs): boolean {
  if (argv.resume && Object.prototype.hasOwnProperty.call(argv, 'requirement-file')) {
    console.error('[goal-runner] BLOCKER: --requirement-file 仅在 fresh run 生效——resume 只认 manifest ' +
      '中已冻结的 requirement。若确要换需求，请开新 run。');
    return true;
  }
  return false;
}

function readGateCompletionHistory(projectRoot: string, runDir: string, events: readonly GoalRunEvent[], exceptInvoke?: string): CompletionEvaluation[] {
  return events.flatMap(end => {
    if (end.type !== 'harness_end' || !end.phase || !end.invoke_id || end.invoke_id === exceptInvoke || end.timed_out) return [];
    const log = path.join(runDir, 'phases', end.phase, end.invoke_id, 'harness-output.log');
    try { return completedCheckResultsFromOutput(fs.readFileSync(log, 'utf8')).map(result => result.evaluation); }
    catch { return []; }
  });
}

/** Current product changes come from the original guarded handback, never regenerated tool bookkeeping. */
function readReturnedWorkProduct(context: WorkUnitExecutionContext, original: NonNullable<ReturnType<typeof executionRequestForInvoke>>,
  history: readonly GoalRunEvent[], at: number): { current: ReturnType<typeof capturePhaseInvocationSnapshot>; productChanged: boolean } | GoalPhaseExecutorResult {
  const role = workUnitExecutionRole(context);
  const actorName = role === 'author' ? '原作者' : '原独立核验';
  const start = history[at];
  const prior = original.request.pre_snapshot, boundary = original.request.write_boundary;
  if (!prior || !boundary) return { status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', command: 'phase_execute_request', skipped: true,
    details: `${actorName} ${start.invoke_id} 已交回，但原请求的前像/写界原件缺失，不能确认新的工作条件。恢复原件、真实输入改变或用户明确继续后接回；不因缺少原件反复派发。` };
  const current = capturePhaseInvocationSnapshot(boundary, original.request.snapshot_options);
  const writeObservations = history.slice(at + 1).flatMap(event => {
    const value = asRecord(event);
    return event.type === 'phase_write_observed' && event.invoke_id === start.invoke_id && value?.pre_snapshot === prior.sha256
      && typeof value.post_snapshot === 'string' && /^[0-9a-f]{64}$/.test(value.post_snapshot)
      && (Array.isArray(value.owned) || Array.isArray(value.observations)) ? [value] : [];
  });
  const writes = writeObservations.map(value => value.post_snapshot as string);
  let handedBackSha = writes.at(-1) ?? prior.sha256;
  try {
    const received = acceptedSessionReport(context.runDir, original);
    if (received?.event.handoff_report) handedBackSha = readHandoffMaterial<{ post_snapshot?: typeof prior }>(context.runDir,
      received.event.handoff_report).post_snapshot?.sha256 ?? handedBackSha;
    const designResult = path.resolve(context.runDir, path.dirname(original.reference.path), 'design-result.json');
    if (!writes.length && fs.existsSync(designResult)) {
      const outcome = JSON.parse(fs.readFileSync(designResult, 'utf8')).outcome as DesignRepairInvokeOutcome;
      if (outcome.preSnapshot?.sha256 === prior.sha256) handedBackSha = outcome.postSnapshot?.sha256 ?? handedBackSha;
    }
  } catch (error) {
    return { status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', command: 'phase_execute_request', skipped: true,
      details: `${actorName} ${start.invoke_id} 已交回但原后像不可核实：${(error as Error).message}。恢复该原件后继续，不重派或猜测结束。` };
  }
  let productChanged = current.sha256 !== handedBackSha;
  if (productChanged && ['initial-design-questioning', 'design-repair-questioning'].includes(context.phase) && boundary.verifierResultPath) {
    const questioning = readDesignQuestioningOriginal(context.runDir, start, history);
    if (questioning?.completed && questioning.preSnapshot && questioning.postSnapshot?.sha256 === handedBackSha
      && diffPhaseInvocationSnapshots(questioning.preSnapshot, questioning.postSnapshot).kind === 'clean'
      && fs.existsSync(boundary.verifierResultPath) && fs.readFileSync(boundary.verifierResultPath, 'utf8') === questioning.output) {
      const returned = diffPhaseInvocationSnapshots(questioning.postSnapshot, current);
      const originalPath = path.relative(context.projectRoot, boundary.verifierResultPath).replace(/\\/g, '/');
      // The runner archives raw Q output after the read-only window; that receipt is not new design work.
      if (returned.kind === 'changed' && returned.changes.every(change => change.path === originalPath)) productChanged = false;
    }
  }
  if (productChanged && !current.failureReason && role === 'verifier') {
    // Keep full snapshots for write protection; machine publication between calls is not new product work.
    const publications = new Set([...new Set([...context.chain, context.phase])].flatMap(phase => {
      const reports = featurePhaseReportsDir(context.projectRoot, context.feature, phase, context.frameworkRoot);
      const summary = asRecord(readPhaseSummary(context.projectRoot, context.feature, phase as FeaturePhase).summary);
      const declared = ['script_report', 'merged_report', 'ai_prompt', 'summary_json'].flatMap(key => {
        if (typeof summary?.[key] !== 'string') return [];
        try {
          const file = path.resolve(context.projectRoot, validateProjectRelativePath(context.projectRoot, summary[key], 'published report'));
          return path.dirname(file) === path.resolve(reports) ? [file] : [];
        } catch { return []; }
      });
      return [...declared,
        phaseEvidenceManifestPath(context.projectRoot, context.feature, phase),
        path.join(receiptDirPath(context.projectRoot, context.feature, phase), 'phase-completion-receipt.md')];
    }).map(file => path.relative(context.projectRoot, file).replace(/\\/g, '/')));
    const runtime = (file: string): boolean => publications.has(file);
    const returned = new Map<string, { how: unknown; hash: string | null }>();
    let attributable = true;
    for (const event of writeObservations) for (const value of [...(Array.isArray(event.owned) ? event.owned : []), ...(Array.isArray(event.observations) ? event.observations : [])]) {
      const row = asRecord(value);
      if (!row || typeof row.path !== 'string') { attributable = false; continue; }
      if (runtime(row.path)) continue;
      const hash = row.post_sha256 !== undefined ? row.post_sha256 : row.postSha256;
      if (hash !== null && (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))) { attributable = false; continue; }
      returned.set(row.path, { how: row.how, hash });
    }
    const delta = diffPhaseInvocationSnapshots(prior, current);
    if (attributable && delta.kind !== 'unverifiable') {
      const actual = new Map(current.entries.map(entry => [entry.path, entry.sha256]));
      const onlyReturned = delta.kind === 'clean' || delta.changes.every(change => runtime(change.path)
        || returned.get(change.path)?.how === change.how && returned.get(change.path)?.hash === change.postSha256);
      if (onlyReturned && [...returned].every(([file, value]) => (actual.get(file) ?? null) === value.hash)) productChanged = false;
    }
  }
  return { current, productChanged };
}

export class GoalPhaseRuntime {
  private readonly options: GoalPhaseRuntimeLaunchOptions;
  constructor(options: GoalPhaseRuntimeLaunchOptions = {}, private readonly deliveryParent?: InitialDesignGoalManifest) { this.options = withExecutionControls(options); }

  lastRunId?: string;
  private acceptedSessionInvokeId?: string;

  /** Decide from current originals before recording or constructing another native invocation. */
  prepareExecutionContext(context: WorkUnitExecutionContext, explicitlyContinued = false): WorkUnitExecutionContext | GoalPhaseExecutorResult {
    if (context.user_deadline_at && Date.parse(context.user_deadline_at) <= Date.now() || this.options.executionControls?.signal?.aborted) {
      return { status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', command: 'phase_execute_request', skipped: true,
        details: context.user_deadline_at && Date.parse(context.user_deadline_at) <= Date.now()
          ? '用户明示时限已到；保留成果，不登记或派发新调用，时限未重置。' : '当前请求已取消；保留成果，不登记或派发新调用。' };
    }
    const observed = observeWorkUnitProviderSession(context);
    if ('status' in observed) return observed;
    if (context.owner.owner_id !== 'dry-run') {
      const history = loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'));
      const role = workUnitExecutionRole(context);
      const actorName = role === 'author' ? '原作者' : '原独立核验';
      const verifier = role === 'verifier' && parseVerifierRequestFromInstruction(context.instruction ?? '');
      const unit = role === 'author' ? authorUnit(context, history, history.length)
        : verifier ? canonicalRequestInput(verifier) : context.phase;
      const material = (value: WorkUnitExecutionContext, frozen: boolean, purpose?: string, invokeId?: string, requestSha?: string) => {
        let instruction = value.instruction;
        if (invokeId && requestSha && history.some(event => event.type === 'phase_start' && event.driver === 'session'
          && event.invoke_id === invokeId && event.handoff_request?.sha256 === requestSha)) {
          const suffix = sessionExecutionTransportInstructionSuffix(value, invokeId);
          if (instruction?.endsWith(suffix)) instruction = instruction.slice(0, -suffix.length);
        }
        return { ...(frozen ? { work: value.workInput!.material } : { instruction }), purpose,
          facts: value.factsContext, authority: value.authority, chain: value.chain,
          adapter: value.adapter, model: value.adapterModel, visual: readGoalVisualProviderEnv(value.childEnv ?? {}), deadline: value.user_deadline_at };
      };
      for (let at = history.length - 1; unit && at >= 0; at--) {
        const start = history[at];
        if (start.type !== 'agent_invoke_start' || !start.invoke_id) continue;
        const original = executionRequestForInvoke(context.runDir, start.invoke_id);
        if (!original || original.request.context.runId !== context.runId || original.request.context.feature !== context.feature
          || path.resolve(original.request.context.projectRoot) !== path.resolve(context.projectRoot)
          || workUnitExecutionRole(original.request.context, original.request.purpose) !== role) continue;
        const previousVerifier = role === 'verifier' && parseVerifierRequestFromInstruction(original.request.context.instruction ?? '');
        if ((role === 'author' ? authorUnit(original.request.context, history, at)
          : previousVerifier ? canonicalRequestInput(previousVerifier) : original.request.context.phase) !== unit) continue;
        const end = history.slice(at + 1).find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
        if (!end || !invocationCompleted({ ...end, exitCode: end.exit_code }) && end.status !== 'waiting') break;
        const frozen = !!context.workInput?.material && !!original.request.context.workInput?.material;
        const nextMaterial = stableStringify(material({ ...context, ...observed }, frozen, context.workInput?.material.purpose));
        const requestedMaterial = stableStringify(material(context, frozen, context.workInput?.material.purpose));
        const previousMaterial = stableStringify(material(original.request.context, frozen,
          frozen ? original.request.purpose ?? original.request.context.workInput?.material.purpose : context.workInput?.material.purpose,
          original.request.invoke_id, original.reference.sha256));
        const materialChanged = nextMaterial !== previousMaterial && requestedMaterial !== previousMaterial;
        if (hasNewWorkConditions({ returned: true, explicitlyContinued, materialChanged, productChanged: false, scopeChanged: false })) break;
        const product = readReturnedWorkProduct(context, original, history, at);
        if ('status' in product) return product;
        const { current, productChanged } = product;
        if (!current.failureReason && hasNewWorkConditions({ returned: true, explicitlyContinued, materialChanged,
          productChanged, scopeChanged: false })) break;
        return { status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', command: 'phase_execute_request', skipped: true,
          details: current.failureReason
            ? `${actorName} ${start.invoke_id} 已真实交回；当前产品观察不可核实：${current.failureReason}。恢复该原观察后接回，不盲重派。`
            : `${actorName} ${start.invoke_id} 已真实交回；当前签名指令、反馈、研究输入、权限和产品原件均未变化，没有新的可执行工作。保留全部未完项，补齐原producer/对象证明、真实条件改变或用户明确继续后接回，不重发同一请求。` };
      }
    }
    if (workUnitExecutionRole(context) === 'author' && context.owner.owner_id !== 'dry-run' && LEGACY_FEATURE_PHASE_ORDER.includes(context.phase as FeaturePhase)) {
      const options = { projectRoot: context.projectRoot, frameworkRoot: context.frameworkRoot, feature: context.feature,
        runId: context.runId, chain: [...context.chain], authority: context.authority };
      const disposition = resolveCompletionDisposition(options);
      const problems = phaseCompletionProblems(disposition, [context.phase]);
      const history = loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'));
      const checked = readReusableCheckResult({ ...options, phase: context.phase });
      const ended = [...history].reverse().find(event => event.type === 'harness_end' && event.phase === context.phase && !event.timed_out);
      const summary = readPhaseSummary(context.projectRoot, context.feature, context.phase as FeaturePhase).summary;
      let executableVerification = false;
      try {
        const request = summary?.verifier_request && parseVerifierRequest(fs.readFileSync(path.resolve(context.projectRoot,
          validateProjectRelativePath(context.projectRoot, summary.verifier_request, 'verifier request')), 'utf8'));
        executableVerification = !!request && request.feature === context.feature && request.phase === context.phase
          && request.subject_id === summary?.verifier_subject_id && !!summary.verifier_report;
      } catch { /* Missing originals retain their concrete producer gap. */ }
      const current = checked || recomputePhaseEvidenceStaleness(context.projectRoot, context.feature, [context.phase], {
        frameworkRoot: context.frameworkRoot, runId: context.runId,
      })[0]?.verdict === 'fresh';
      if (ended && current && !executableVerification && problems.length && problems.every(problem => problem.action === 'verify' || problem.action === 'wait')
        && !disposition.completionBlocking.some(problem => problem.action === 'repair')) {
        return { status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', command: 'phase_execute_request', skipped: true,
          details: `已有匹配的真实检查结果；当前只缺原验证 producer 的证据/条件，同输入不再派作者或重拉检查。解除条件满足后接回原请求，只补受影响验证。\n${renderCurrentDisposition(disposition)}` };
      }
    }
    return createWorkUnitExecutionContext(context, observed);
  }

  /** In-run revisions stay in the run; only a completed design repair may enter existing continuation. */
  async run(): Promise<number> {
    const options = this.options;
    {
      const argv = parseGoalRuntimeArgs(options.args ?? process.argv.slice(2));
      if (rejectsResumeRequirementFile(argv)) return 2;
      const priorRunId = argv.resume ?? argv['attach-created'];
      const { projectRoot: root, frameworkRoot } = resolveRuntimeLayout(options, argv);
      if (!this.deliveryParent) warnRetiredModelAlternatives(loadFrameworkLocalConfig(root));
      if (!this.deliveryParent && !argv.help && !argv.h && !argv['dry-run'] && !(argv.detach && !argv['detached-child'])) {
        if (guardNestedGoalRunner()) return 1;
        const feature = typeof argv.feature === 'string' ? argv.feature : argv.manifest ? resolveRawRunInput(argv as Record<string, unknown>, root).feature : undefined;
        if (feature) {
          const located = typeof priorRunId === 'string'
            ? loadGoalRunManifestFromRun(root, priorRunId, { feature }) : null;
          if (located && !isInitialDesignManifest(located) && located.delivery_origin) {
            const original = loadGoalRunManifestFromRun(root, located.delivery_origin.run_id, { feature: located.delivery_origin.feature });
            if (!isInitialDesignManifest(original)) throw new Error('[initial-design] delivery origin does not identify the original design request');
            return this.runInitialDesign(original, root, frameworkRoot, argv);
          }
          const request = !priorRunId ? resolveDesignDeliveryRequest(argv, root) : null;
          const existing = located && isInitialDesignManifest(located) ? located : findInitialDesignRun({ projectRoot: root, feature,
            ...(request?.requirement ? { requirement: request.requirement } : {}) });
          const supersede = normalizeSupersedeTargets(argv.supersede);
          if (existing && (!supersede.length || priorRunId)) return this.runInitialDesign(originalDeliveryForManifest(root, existing) ?? existing, root, frameworkRoot, argv);
          if (!priorRunId) {
            if (request && (findInitialDesignRun({ projectRoot: root, feature }) || designDeliveryNextStep({ projectRoot: root, frameworkRoot, feature, ...request }))) {
              const source = argv.manifest ? loadGoalManifestFile(String(argv.manifest), root) : existing ?? undefined;
              const adapter = String(argv.adapter ?? source?.adapter ?? 'generic');
              const pin = resolveFinalModelPin({ cliValue: normalizeAdapterModelCliValue(argv['adapter-model']), cliPin: launchModelPin(argv, adapter, root, source?.adapter_model_pin), effectiveAdapter: adapter,
                originalAdapter: source?.adapter, manifestPin: source?.adapter_model_pin, isResume: false, hasManifestFlag: !!argv.manifest,
                isSuccessor: false, overrideManifest: Boolean(argv['override-manifest']), overrideAdapter: Boolean(argv['override-adapter']) });
              if (!pin.ok) throw new Error(pin.message);
              const visual = resolveFinalVisualProviderPin({ cliRef: resolveVisualProviderCliSelection(argv, root, source?.visual_provider_pin),
                manifestPin: source?.visual_provider_pin, isResume: false, hasManifestFlag: !!argv.manifest, isSuccessor: false, overrideManifest: Boolean(argv['override-manifest']) });
              if (!visual.ok) throw new Error(visual.message);
              const localVisual = visual.pin ?? resolveUnattendedVisualProviderPin(loadFrameworkLocalConfig(root), frameworkRoot).pin;
              const prepared = prepareInitialDesignRun({ projectRoot: root, frameworkRoot, feature,
                requirement: request.requirement ?? '', requirementSourceFiles: request.requirementSourceFiles,
                adapter, runId: typeof argv['run-id'] === 'string' ? argv['run-id'] : undefined,
                supersede,
                startPhase: request.startPhase, endPhase: request.endPhase,
                requestedPhases: 'requestedPhases' in request ? request.requestedPhases : undefined,
                requestedResults: 'requestedResults' in request ? request.requestedResults : undefined,
                unattended: source?.unattended, adapterModelPin: pin.pin,
                visualProviderPin: localVisual, fidelity: source?.fidelity,
                adapterSource: source?.adapter_provenance && (RUN_ADAPTER_PROVENANCES as readonly string[]).includes(source.adapter_provenance)
                  ? source.adapter_provenance as RunAdapterProvenance : argv.adapter ? 'user_explicit' : 'entry_declared',
                dependencyPolicy: source?.dependency_policy, minimumAssurance: source?.minimum_assurance, preAuthorizedMutations: source?.pre_authorized_mutations,
              });
              return this.runInitialDesign(prepared.manifest, root, frameworkRoot, argv);
            }
          }
        }
      }
      if (typeof priorRunId === 'string' && typeof argv.feature === 'string') {
            const scope = loadEffectiveExecutionScope(root, argv.feature, priorRunId, frameworkRoot);
        if (scope) {
          const prior = loadGoalManifestFromRun(root, priorRunId, { feature: argv.feature });
          const events = loadEventsJsonlStrict(path.join(root, prior.report_dir, 'events.jsonl')).events;
          const terminal = [...events].reverse().find(event => event.type === 'run_end');
          if (terminal?.status === 'CHAIN_SLICE_COMPLETED' && !scope.unresolved.length) {
            const completed = scope.completion_target === 'feature'
              ? assessFeatureCompletion(root, prior.feature, { expectedChain: executionCompletionPhases(scope), expectedTrack: 'full', frameworkRoot }).complete
              : collectCleanPassIssues({ projectRoot: root, feature: prior.feature, chain: executionCompletionPhases(scope), frameworkRoot,
                runId: prior.run_id, executionScope: scope, endpoint: 'request',
                workflow: workflowForExistingRun((injectedWorkflowResolver ?? resolveWorkflowSpec)(root, { frameworkRoot }), prior, frameworkRoot, root) }).length === 0;
            if (completed) { this.lastRunId = priorRunId; return 0; }
          }
        }
      }
      const code = await main(options);
      if (code === 3) { this.lastRunId = terminalEventCtx?.runId; return code; }
      const finished = terminalEventCtx;
      if (!finished) return code;
      this.lastRunId = finished.runId;
      // A published owner repair can invalidate birth bindings. Reuse the normal continuation
      // decision after main has released its locks; never ask the outer Agent to relaunch it.
      const terminal = loadAuthoritativeEvents(path.resolve(finished.projectRoot, finished.reportDir, 'events.jsonl')) as Array<GoalRunEvent & { stage?: string; outcome?: string }>;
      if (designRepairNeedsContinuation(terminal, finished.workflowChain) && typeof argv.feature === 'string') {
        const { projectRoot, frameworkRoot } = resolveRuntimeLayout(options, argv);
        const next = new GoalPhaseRuntime({ ...options, args: ['--feature', argv.feature,
          '--project-root', projectRoot, '--framework-root', frameworkRoot,
          ...inheritRunProcessArgs(argv),
          '--runtime-executor', String(argv['runtime-executor'] ?? (options.executor ? 'attended' : 'detached')),
          '--runtime-owner', String(argv['runtime-owner'] ?? options.ownerKind ?? (options.executor ? 'session' : 'process')),
          ] }, this.deliveryParent);
        const continued = await next.run();
        if (next.lastRunId) this.lastRunId = next.lastRunId;
        return continued;
      }
      // D2: the run projects its own completion and there is no ancestor chain to clean up, so the
      // post-run verification that used to gate that cleanup is gone rather than left as a no-op.
      return code;
    }
  }

  /** Initial P1/P2 work is a segment of this runtime, using its existing execution transports. */
  private async runInitialDesign(manifest: InitialDesignGoalManifest, projectRoot: string, frameworkRoot: string, argv: minimist.ParsedArgs): Promise<number> {
    manifest = rebindTaskModel(manifest, launchModelPin(argv, manifest.adapter!, projectRoot, manifest.adapter_model_pin) ?? (argv.manifest ? loadGoalManifestFile(String(argv.manifest), projectRoot).adapter_model_pin : undefined), projectRoot, Boolean(argv['override-manifest']),
      resolveVisualProviderCliSelection(argv, projectRoot, manifest.visual_provider_pin));
    const requestedDeadline = argv['user-deadline-at'] === undefined ? undefined : parseUserDeadlineAt(argv['user-deadline-at']);
    if (requestedDeadline !== undefined && requestedDeadline !== manifest.user_deadline_at && !argv['override-manifest']) {
      throw new Error('原请求截止不会因resume重置；明确调整原root截止须同时提供 --user-deadline-at 与 --override-manifest。');
    }
    this.lastRunId = manifest.run_id;
    const runDir = path.resolve(projectRoot, manifest.report_dir);
    const eventsPath = path.join(runDir, 'events.jsonl');
    const history = (): GoalRunEvent[] => loadEventsJsonlStrict(eventsPath).events;
    const flushOriginalProgress = (): void => {
      try { writeProgressSnapshotAtomic(projectRoot, manifest.report_dir, projectInitialDesignDelivery({ projectRoot, frameworkRoot, manifest })); }
      catch { /* A progress projection never replaces authoritative events or blocks recovery. */ }
    };
    const emit = (event: Record<string, unknown>): void => {
      const line = JSON.stringify({ ...event, ts: new Date().toISOString(), run_id: manifest.run_id }) + '\n';
      fs.appendFileSync(eventsPath, line);
      eventLineRecorder?.(eventsPath, line);
      if (event.type === 'run_end') runConcluded = true;
      flushOriginalProgress();
    };
    assertGoalRunAttachable(projectRoot, manifest);
    if (guardNestedGoalRunner()) return 1;
    if (resolveEffectiveRunEnd(history())?.status === 'COMPLETED'
      && projectInitialDesignDelivery({ projectRoot, frameworkRoot, manifest }).complete) {
      runConcluded = true;
      return 0;
    }
    if (enumerateCanonicalChangeUnits(projectRoot, manifest.feature).some(unit =>
      liveFeatureLock(projectRoot, deriveChangeUnitFeatureId(manifest.feature, String(unit.changeUnit.change_unit_id))))) {
      runConcluded = true;
      return 3;
    }
    setupSignalHandlers();
    terminalEventCtx = { projectRoot, frameworkRoot, reportDir: manifest.report_dir, runId: manifest.run_id, feature: manifest.feature, chain: [], workflowChain: [] };
    runConcluded = false;
    const transport = this.options.sessionHandoff || this.options.executor ? 'session' : 'process';
    const lockPath = path.join(runDir, '.runner.lock');
    const lock = tryAcquireLock(lockPath, { run_id: manifest.run_id, run_mode: 'authoritative', report_dir: manifest.report_dir });
    if (!lock) throw new Error('[initial-design] original request runtime is already controlled');
    let token: RunFenceToken | undefined;
    let preserveOwner = false;
    const conclude = (reason: string, detail: string, disposition?: Record<string, unknown>): number => {
      emit({ type: 'run_end', status: 'HALTED', halt_reason: reason, error: detail, halt_guidance: detail,
        ...runDispositionFields(decide({ incident: reason, phase: 'initial-design', detail }, NO_AUTHORITY,
          { orchestration: 'goal', owner_kind: transport, can_prompt_now: transport === 'session', invocation: argv.resume ? 'resume' : 'fresh' })), ...disposition });
      let report: unknown;
      try { report = projectInitialDesignDelivery({ projectRoot, frameworkRoot, manifest }); }
      catch { report = { run_id: manifest.run_id, feature: manifest.feature, status: 'HALTED', halt_reason: reason, detail }; }
      fs.writeFileSync(path.join(runDir, 'goal-report.json'), JSON.stringify(report, null, 2) + '\n');
      return 1;
    };
    const repairStop = (result: UnattendedDesignRepairResult): number => {
      return conclude(result.outcome === 'containment_unresolved' ? 'agent_containment_unresolved'
        : result.outcome === 'violation' ? 'unauthorized_source_mutation'
        : result.reason.startsWith('no_progress_guard:') ? 'no_progress_guard'
        : result.outcome === 'waiting' ? 'executor_waiting'
        : 'execution_scope_unresolved', result.reason, result.outcome === 'waiting' ? { run_disposition: 'WAITING', run_wait_kind: 'external' } : undefined);
    };
    const continueRepair = (result: UnattendedDesignRepairResult): boolean => {
      if (result.outcome !== 'failed') return false;
      if (result.evaluation?.completed && result.evaluation.disposition.completionBlocking.some(problem => problem.action === 'repair')) return true;
      return latestProviderSessionCanRebuild(runDir, history());
    };
    const automaticDesignRepair = resolveTaskAutomationPolicy({ fullDelivery: true,
      autonomyAuthorized: resolveEntryAuthorization(this.options, argv)?.autonomyAuthorized }).automaticDesignRepair;
    const exposeRequest = (issued: IssuedSessionExecution): number => {
      preserveOwner = true; this.options.sessionHandoff?.onRequest(issued); runConcluded = true; return 3;
    };
    try {
      const supplied = this.options.sessionHandoff?.requestPath;
      const ownRequest = supplied && !path.relative(runDir, path.resolve(supplied)).startsWith('..') && !path.isAbsolute(path.relative(runDir, path.resolve(supplied)));
      const prelude = inspectSessionExecutionBeforeRuntime({ runDir, ...(ownRequest ? { requestPath: supplied, report: this.options.sessionHandoff?.report } : {}),
        forceTakeover: Boolean(argv['force-resume']) });
      let current = prelude.current;
      if (prelude.reusable) return exposeRequest(prelude.reusable);
      if (current && !acceptedSessionReport(runDir, current) && argv['force-resume'] && !this.options.sessionHandoff?.report) {
        const currentControl = readRunControl(runDir, manifest.run_id);
        if (currentControl?.owner?.state === 'released' || currentControl?.owner?.state === 'orphaned_session') {
          const acquired = forceTakeoverRunOwner(runDir, manifest.run_id, currentControl.current_epoch,
            { kind: 'session', owner_id: randomUUID(), lease_ms: this.options.leaseMs ?? 60_000 });
          current = resignSessionExecution(runDir, current, acquired.token, emit);
          const resumed = inspectSessionExecutionBeforeRuntime({ runDir });
          if (resumed.reusable) return exposeRequest(resumed.reusable);
        }
      }
      if (current && !acceptedSessionReport(runDir, current)) {
        const reportsThisRequest = this.options.sessionHandoff?.requestPath && path.resolve(this.options.sessionHandoff.requestPath) === path.resolve(runDir, current.reference.path);
        resumeIssuedSessionOwner(runDir, current.request.context.owner);
        const accepted = acceptSessionExecution({ runDir, issued: current,
          report: reportsThisRequest && this.options.sessionHandoff?.report ? this.options.sessionHandoff.report : { status: 'failed', phase: current.request.context.phase, details: 'execution deadline expired' }, emit });
        if (!accepted.duplicate) this.acceptedSessionInvokeId = current.request.invoke_id;
        if (accepted.timedOut) releaseRunOwner(runDir, current.request.context.owner);
      }
      const control = ensureRunControl(runDir, manifest.run_id);
      if (current && control.owner?.state === 'active' && current.request.context.owner.owner_id === control.owner.owner_id && current.request.context.owner.epoch === control.current_epoch) {
        token = current.request.context.owner;
      } else {
        const ownerInput: Parameters<typeof casAcquireRunOwner>[3] = {
          kind: transport, owner_id: randomUUID(), ...(transport === 'session' ? { lease_ms: this.options.leaseMs ?? 60_000 } : { pid: process.pid }),
        };
        const acquired = argv['force-resume']
          ? { ok: true as const, ...forceTakeoverRunOwner(runDir, manifest.run_id, control.current_epoch, ownerInput) }
          : casAcquireRunOwner(runDir, manifest.run_id, control.current_epoch, ownerInput);
        if (!acquired.ok) throw new Error('[initial-design] active owner or expired request requires the original owner recovery');
        token = acquired.token;
      }
      const sessionStart = Date.now();
      if (requestedDeadline !== undefined) manifest.user_deadline_at = requestedDeadline;
      const baseline = resolveManifestIdentityBaseline(history());
      const currentFields = computeManifestIdentityFields(manifest);
      const changed = baseline ? diffManifestIdentityFields(baseline, currentFields) : [];
      if (changed.length) {
        const authorized = overrideAuthorizedIdentityFields({ 'override-manifest': Boolean(argv['override-manifest']),
          'override-start': Boolean(argv['override-start']), 'override-end': Boolean(argv['override-end']) });
        if (authorized !== 'all' && changed.some(field => !authorized.has(field))) return conclude('manifest_identity_drift', `原始请求身份漂移：${changed.join(', ')}`);
        writeGoalManifest(manifest, projectRoot);
        emit({ type: 'manifest_identity_rebase', to_fields: currentFields, changed_fields: changed, authorized_by: '--override-manifest' });
      }
      if (resolveEffectiveRunEnd(history())?.status === 'COMPLETED'
        && projectInitialDesignDelivery({ projectRoot, frameworkRoot, manifest }).complete) { runConcluded = true; return 0; }
      try { writeLivenessBeacon({ projectRoot, reportDir: manifest.report_dir, runId: manifest.run_id }); }
      catch { /* Same conservative liveness writer as normal runs; no synthetic process identity. */ }
      const previousEnd = resolveEffectiveRunEnd(history());
      let resumeDesignWork = explicitUserContinuation(Boolean(argv['force-resume']), history());
      let previousDesignEvaluation: CompletionEvaluation | null = null;
      const designEvaluations: CompletionEvaluation[] = [];
      let currentQuestioningInvokeId: string | undefined;
      const questioningObservation = (): { questioningCurrent: boolean; questioningResult: import('./utils/component-blueprint-model').BlueprintRecord | null } => {
        try {
          const records = history();
          const blueprintPath = componentBlueprintPath(projectRoot, manifest.feature);
          const blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8'));
          for (const start of [...records].reverse()) {
            if (start.type !== 'agent_invoke_start' || !['initial-design-questioning', 'design-repair-questioning'].includes(String(start.phase))) continue;
            const original = readDesignQuestioningOriginal(runDir, start, records);
            if (!original?.completed) continue;
            const result = original && reusableDesignQuestioning({ ...original, projectRoot, blueprintPath, blueprint });
            const denied = result && independentQuestioningBlockers({ review_summary: { questioning: result } }).length;
            // Unpublished repair feedback belongs to its draft transaction, not the canonical initial-design reader.
            if (start.phase === 'design-repair-questioning' && (!result || denied)) continue;
            const authorReturned = records.slice(records.indexOf(start) + 1).some(event => event.type === 'agent_invoke_end'
              && event.phase === 'initial-design-author' && invocationCompleted({ ...event, exitCode: event.exit_code }));
            if (denied && authorReturned) {
              const before = original.beforeDocument ?? asRecord(YAML.parse(original.beforeBlueprint));
              const sources = [...new Set([...blueprintSourceRefFiles(projectRoot, before, true), ...blueprintSourceRefFiles(projectRoot, blueprint, true)])]
                .filter(file => path.resolve(file) !== path.resolve(blueprintPath));
              const unchanged = before && stableStringify(blueprintAuthorContent(before)) === stableStringify(blueprintAuthorContent(blueprint))
                && sources.every(file => {
                  const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
                  const entry = original.preSnapshot?.entries.find(item => item.kind === 'file' && item.path === relative);
                  return entry ? fs.existsSync(file) && createHash('sha256').update(fs.readFileSync(file)).digest('hex') === entry.sha256 : !fs.existsSync(file);
                });
              if (!unchanged) return { questioningCurrent: false, questioningResult: null };
            }
            return { questioningCurrent: !!result, questioningResult: result };
          }
          return { questioningCurrent: false, questioningResult: null };
        } catch { return { questioningCurrent: false, questioningResult: null }; }
      };
      emit({ type: 'run_start', session_started_at: new Date(sessionStart).toISOString(), manifest_identity_fields: computeManifestIdentityFields(manifest), phase_chain: [] });
      if (transport === 'process' && process.platform === 'win32' && recoverRuntimeGuardians(history(), manifest.run_id, Boolean(argv['force-resume']), emit, conclude)) return 1;
      currentDesignWork: for (;;) {
        const state = { blueprintPath: componentBlueprintPath(projectRoot, manifest.feature) };
        const designEvents = history();
        const activeAttempt = [...designEvents].reverse().find(event => event.type === 'design_authority_repair'
          && 'stage' in event && event.stage === 'attempted' && 'handoff_context' in event
          && !designEvents.slice(designEvents.indexOf(event) + 1).some(later => later.type === 'design_authority_repair'
            && 'signature' in later && 'signature' in event && later.signature === event.signature && 'stage' in later
            && (later.stage === 'failed' && (later as Record<string, unknown>).failed_step !== 'no_progress_guard' || later.stage === 'published'
              && !('outcome' in later && later.outcome === 'unrecovered' && 'failed_step' in later && later.failed_step === 'reconcile'))));
        if (activeAttempt && 'handoff_context' in activeAttempt && 'signature' in activeAttempt) {
          if (!automaticDesignRepair) return conclude('execution_scope_unresolved', '原设计事务仍未完成；需要恢复本请求已有的自动修复授权后继续，不扩大授权。');
          const original = readHandoffMaterial<{ baseline: string; cu?: string; brief: DesignRepairBriefLike }>(runDir, activeAttempt.handoff_context as import('./utils/session-execution-handoff').HandoffReference);
          const cu = original.cu ? asRecord(YAML.parse(Buffer.from(original.cu, 'base64').toString('utf8'))) : null;
          const blueprint = asRecord(YAML.parse(Buffer.from(original.baseline, 'base64').toString('utf8')));
          if (typeof blueprint?.blueprint_id !== 'string' || cu && (typeof cu.blueprint_id !== 'string' || typeof cu.change_unit_id !== 'string')) return conclude('framework_bug', '原设计事务缺少可恢复的真实设计身份。');
          const target = cu ? deriveChangeUnitFeatureId(String(cu.blueprint_id), String(cu.change_unit_id)) : blueprint.blueprint_id;
          const repaired = await this.repairInitialDesignOwner(manifest, projectRoot, frameworkRoot, token!, target, original.brief, emit, String(activeAttempt.signature), resumeDesignWork);
          resumeDesignWork = false;
          if (repaired.outcome === 'handoff') { preserveOwner = true; runConcluded = true; return 3; }
          if (repaired.outcome === 'published') {
            if (!repaired.recovered) return repairStop(repaired);
            continue;
          }
          if (continueRepair(repaired)) continue;
          return repairStop(repaired);
        }
        const prior = history();
        const latest = [...prior].reverse().find(event => event.type === 'agent_invoke_end');
        const latestPurpose = latest && 'purpose' in latest ? latest.purpose : undefined;
        if (latest?.invoke_id) {
          const invocationDir = path.join(runDir, 'phases', String(latest.phase), latest.invoke_id);
          const beforeFile = path.join(invocationDir, 'blueprint-before.yaml');
          const saved = latest.handoff_report ? readHandoffMaterial<{ draft_outputs?: Record<string, string> }>(runDir, latest.handoff_report) : undefined;
          const original = saved?.draft_outputs?.['initial-design-blueprint.yaml'];
          const outputFile = path.join(invocationDir, 'draft-output.yaml');
          const output = original ? Buffer.from(original, 'base64').toString('utf8') : fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : fs.existsSync(state.blueprintPath) ? fs.readFileSync(state.blueprintPath, 'utf8') : '';
          if (String(latest.phase).startsWith('initial-design-') && fs.existsSync(beforeFile)
            && (latestPurpose === 'author' || latestPurpose === 'questioning')) {
            const readonlyQuestioning = latestPurpose === 'questioning' && executionRequestForInvoke(runDir, latest.invoke_id)?.request.write_boundary?.executionRole === 'verifier';
            if (readonlyQuestioning && invocationCompleted({ ...latest, exitCode: latest.exit_code })) {
              const before = fs.readFileSync(beforeFile, 'utf8');
              if (before !== output) return conclude('unauthorized_source_mutation', '独立质询修改了只读蓝图输入；结果不回填。');
              const returned = latest.handoff_report
                ? readHandoffMaterial<{ report: SessionExecutionReport }>(runDir, latest.handoff_report).report.details
                : fs.existsSync(path.join(invocationDir, 'questioning-output.json'))
                  ? fs.readFileSync(path.join(invocationDir, 'questioning-output.json'), 'utf8')
                : fs.existsSync(path.join(invocationDir, 'agent-output.log'))
                  ? extractProviderFinalText(fs.readFileSync(path.join(invocationDir, 'agent-output.log'), 'utf8'), manifest.adapter ?? 'generic') : undefined;
              try { applyIndependentQuestioningOutput(state.blueprintPath, path.join(invocationDir, 'questioning-output.json'), returned ?? '', 'initial-design-questioning'); }
              catch { /* The existing checker reports absent or invalid independent questioning; no PASS is synthesized. */ }
            }
            const violation = validateInitialDesignInvocation(latestPurpose, fs.readFileSync(beforeFile, 'utf8'), output);
            if (violation) return conclude('unauthorized_source_mutation', violation);
            if (latestPurpose === 'author' && output && invocationCompleted({ ...latest, exitCode: latest.exit_code })
              && fs.readFileSync(state.blueprintPath, 'utf8') === output) prepareInitialDesignDraft({ projectRoot, blueprintId: manifest.feature,
              sourceRefs: manifest.requirement_source_files?.length ? manifest.requirement_source_files
                : [path.relative(projectRoot, path.join(runDir, 'manifest.json')).replace(/\\/g, '/') + '#requirement'],
              observedAt: new Date(sessionStart).toISOString(), beforeBlueprint: fs.readFileSync(beforeFile, 'utf8') });
          }
        }
        if (latest?.handoff_report && latest.invoke_id) {
          const issued = sessionExecutionForInvoke(runDir, latest.invoke_id);
          const saved = readHandoffMaterial<{ post_snapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> }>(runDir, latest.handoff_report);
          if (issued?.request.pre_snapshot && saved.post_snapshot) {
            const diff = diffPhaseInvocationSnapshots(issued.request.pre_snapshot, saved.post_snapshot);
            const allowed = (issued.request.snapshot_options?.ownedPrefixes ?? []).map(prefix => prefix.replace(/\\/g, '/'));
            if (diff.kind === 'unverifiable') return conclude('unauthorized_source_mutation', '设计调用原写快照不可核实；不能猜测恢复前像。');
            const originals = authorWritePreimages(beforeAuthorInvocation(history(), latest.invoke_id));
            if (diff.kind === 'changed') recordAuthorRestorations(history(), diff.changes, String(latest.phase), latest.invoke_id, emit);
            const outside = diff.kind === 'changed' ? diff.changes.filter(change => !allowed.some(prefix => change.path.replace(/\\/g, '/') === prefix || change.path.replace(/\\/g, '/').startsWith(prefix + '/'))
              && (!originals.has(change.path) || originals.get(change.path) !== change.postSha256)) : [];
            if (outside.length && !history().some(event => event.type === 'phase_write_violation' && event.invoke_id === latest.invoke_id)) emit({
              type: 'phase_write_violation', phase: latest.phase, invoke_id: latest.invoke_id,
              violations: outside.map(change => ({ path: change.path, violation: 'outside_authority', pre_sha256: change.preSha256, post_sha256: change.postSha256 })),
            });
          }
        }
        const received = current && current.request.invoke_id === this.acceptedSessionInvokeId ? acceptedSessionReport(runDir, current) : undefined;
        const acceptedWaitingDetail = received && invocationWaitingDetail(received.report);
        if (acceptedWaitingDetail) return conclude('execution_scope_unresolved', acceptedWaitingDetail);
        let observed = readInitialDesignDelivery({ projectRoot, frameworkRoot, manifest, ...questioningObservation() });
        const restoration = unrestoredAuthorWrites(projectRoot, history());
        if ((observed.kind === 'author' || observed.kind === 'decompose') && !enumerateCanonicalChangeUnits(projectRoot, manifest.feature).length
          && !observed.progression?.activeRun && fs.existsSync(state.blueprintPath)) {
          try {
            const loaded = loadCanonicalBlueprint(projectRoot, manifest.feature);
            const before = stableStringify(loaded.blueprint);
            if (observed.kind === 'author') refreshBlueprintFingerprints(loaded.blueprint);
            writeBackAdmission(loaded.blueprint, { projectRoot, canonicalPath: state.blueprintPath });
            if (stableStringify(loaded.blueprint) !== before) fs.writeFileSync(state.blueprintPath, YAML.stringify(loaded.blueprint));
          } catch { /* The original validator gives the author the concrete parse/identity issue. */ }
          observed = readInitialDesignDelivery({ projectRoot, frameworkRoot, manifest, ...questioningObservation() });
        }
        if (restoration.size) observed = { ...observed, kind: 'author', progression: undefined, designRepair: undefined,
          issues: [...observed.issues, buildPhaseWriteRecoveryContextBlock({ sourcePhase: 'initial-design-author', targetPhase: 'initial-design-author', files: [...restoration.keys()], preimages: Object.fromEntries(restoration) })] };
        if (!restoration.size && observed.progression?.action === 'blocked') {
          const units = enumerateCanonicalChangeUnits(projectRoot, manifest.feature);
          for (const unit of units) {
            const feature = deriveChangeUnitFeatureId(manifest.feature, String(unit.changeUnit.change_unit_id));
            const diagnosis = diagnoseDesignAuthority(projectRoot, frameworkRoot, feature, 'plan');
            const findings = [...diagnosis.findings];
            const currentUnit = observed.progression?.action === 'blocked' ? observed.progression.readySet.units.find(item =>
              item.changeUnit.change_unit_id === unit.changeUnit.change_unit_id && item.completion.state !== 'VALID') : undefined;
            if (currentUnit) {
              const declarations = currentUnit.changeUnit.blockers.filter(blocker => blocker.gate === 'design'
                && blocker.owner === 'component-design' && blocker.observation === 'machine');
              const active = deriveChangeUnitBlockers({ ...currentUnit.changeUnit, blockers: declarations }, { projectRoot }).filter(item => item.active);
              if (active.length) {
                const published = loadCanonicalBlueprint(projectRoot, manifest.feature);
                for (const observation of active) {
                  const declaration = declarations.find(item => item.blocker_id === observation.blockerId)!;
                  const blockerCode = `${feature}:${declaration.blocker_id}`;
                  const retained = [...history()].reverse().find(event => event.type === 'design_authority_repair'
                    && 'stage' in event && event.stage === 'published' && 'new_revision' in event && event.new_revision === published.blueprint.revision
                    && 'checks' in event && Array.isArray(event.checks) && event.checks.some(check => {
                      const row = asRecord(check);
                      return row?.check === 'plan:cu:design-basis' && Array.isArray(row.codes) && row.codes.includes(blockerCode);
                    }));
                  if (retained) {
                    const reason = `设计方已在rev${String(published.blueprint.revision)}核实并保留此声明：${declaration.blocker_id}；仍按真实probe/解除条件等待，不重复派修。`;
                    if (!observed.progression!.reasons.includes(reason)) observed.progression!.reasons.push(reason);
                    continue;
                  }
                  findings.push({ class: 'B2', check: 'plan:cu:design-basis', codes: [blockerCode],
                    artifacts: [path.relative(projectRoot, unit.canonicalPath).replace(/\\/g, '/'), path.relative(projectRoot, published.canonicalPath).replace(/\\/g, '/')],
                    basis: `当前已发布蓝图revision=${String(published.blueprint.revision)}、artifact_sha256=${published.artifactSha256}；canonical CU revision=${String(unit.changeUnit.revision)}。\n当前authority诊断（空finding不代表此设计声明已解除）：${JSON.stringify(diagnosis)}\n原设计声明及真实probe观察：${JSON.stringify({ declaration, observation })}`,
                    needs: ['由当前CU设计owner依据当前已发布设计、原声明source_refs和unlock_condition核实是否已满足；过时声明仅在候选中有据修正或移除，经独立质询、原consumer与readiness重新判定。不得伪造探针成功、写active/resolved或删除仍真实的限制；外部、人工、设备、execution及其它owner条件不授清理权，无法在原授权内满足时如实等待。'],
                  });
                }
              }
            }
            if (!findings.length) continue;
            if (!automaticDesignRepair) return conclude('execution_scope_unresolved', `设计责任在${feature}；需恢复原请求的自动设计修复授权。${findings.map(item => item.basis).join('\n')}`);
            const brief: DesignRepairBriefLike = { class: findings.some(item => item.class === 'B2') ? 'B2' : 'B1', items: findings };
            const repaired = await this.repairInitialDesignOwner(manifest, projectRoot, frameworkRoot, token!, feature, brief, emit, undefined, resumeDesignWork);
            resumeDesignWork = false;
            if (repaired.outcome === 'handoff') { preserveOwner = true; runConcluded = true; return 3; }
            if (repaired.outcome !== 'published') {
              if (continueRepair(repaired)) continue currentDesignWork;
              return repairStop(repaired);
            }
            if (!repaired.recovered) return repairStop(repaired);
            observed = readInitialDesignDelivery({ projectRoot, frameworkRoot, manifest, ...questioningObservation() });
            break;
          }
        }
        if ((observed.kind === 'decompose' || observed.kind === 'construction') && fs.existsSync(observed.candidatesPath)) {
          const candidates: unknown = JSON.parse(fs.readFileSync(observed.candidatesPath, 'utf8'));
          if (!Array.isArray(candidates)) throw new Error('[initial-design] candidates must be an array for the original consumer');
          const canonical = enumerateCanonicalChangeUnits(projectRoot, manifest.feature);
          const accepted = candidates.length > 0 && candidates.every(candidate => {
            const artifact = asRecord(asRecord(candidate)?.artifact);
            return artifact && canonical.some(unit => stableStringify(unit.changeUnit) === stableStringify(artifact));
          });
          try {
            if (accepted) {
              try { fs.unlinkSync(observed.candidatesPath); } catch { /* Canonical acceptance is already authoritative. */ }
            } else {
            acceptChangeUnitDecomposition(projectRoot, manifest.feature, candidates as ChangeUnitCandidate[]);
            try { fs.unlinkSync(observed.candidatesPath); } catch { /* Accepted canonical facts are authoritative; cleanup is advisory. */ }
            continue;
            }
          }
          catch (error) { observed.issues.push((error as Error).message); }
        }
        if (observed.kind === 'construction') {
          const next = await this.continueInitialDesignConstruction(manifest, projectRoot, frameworkRoot, argv, observed, token!, emit, conclude, () => {
            if (token) { releaseRunOwner(runDir, token); token = undefined; }
          }, () => { releaseLock(lockPath, lock.ownerId); });
          if (typeof next === 'number') return next;
          observed = next;
        }
        if (observed.designRepair) {
          if (!automaticDesignRepair) return conclude('execution_scope_unresolved', `当前设计权威需要原责任方修复；需恢复原请求的自动设计修复授权。${observed.issues.join('\n')}`);
          const repaired = await this.repairInitialDesignOwner(manifest, projectRoot, frameworkRoot, token!, observed.designRepair.feature, observed.designRepair.brief, emit, undefined, resumeDesignWork);
          resumeDesignWork = false;
          if (repaired.outcome === 'handoff') { preserveOwner = true; runConcluded = true; return 3; }
          if (repaired.outcome === 'published') {
            if (!repaired.recovered) return repairStop(repaired);
            continue;
          }
          if (continueRepair(repaired)) continue;
          return repairStop(repaired);
        }
        if (observed.kind === 'questioning') materializeBlueprintReview(projectRoot, manifest.feature);
        const spent = readOriginalDeliveryActivity(projectRoot, manifest)!;
        const purpose = observed.kind === 'questioning' ? 'questioning' : 'author';
        if (observed.kind === 'author') prepareInitialDesignDraft({ projectRoot, blueprintId: manifest.feature,
          sourceRefs: manifest.requirement_source_files?.length ? manifest.requirement_source_files
            : [path.relative(projectRoot, path.join(runDir, 'manifest.json')).replace(/\\/g, '/') + '#requirement'],
          observedAt: new Date(sessionStart).toISOString() });
        const label = initialDesignInvocationLabel(observed);
        const workBaseFiles = [observed.blueprintPath, observed.candidatesPath, ...(observed.scope ? [observed.scope.candidatePath] : [])];
        const workFiles = [...workBaseFiles];
        try { workFiles.push(...blueprintSourceRefFiles(projectRoot, YAML.parse(fs.readFileSync(observed.blueprintPath, 'utf8')), true)); }
        catch { /* The actual design reader retains unreadable inputs as unknown. */ }
        const workNow = designWorkSnapshot([...new Set(workFiles)]);
        let currentDesignEvaluation: CompletionEvaluation | undefined;
        if (observed.disposition) {
          const acceptanceKey = createHash('sha256').update(stableStringify({ requirement: manifest.requirement,
            authority: manifest.unattended && { write_mode: manifest.unattended.write_mode, approval_mode: manifest.unattended.approval_mode, allowed_tools: manifest.unattended.allowed_tools } })).digest('hex');
          const records = history() as Array<GoalRunEvent & { purpose?: string }>;
          const latestEnd = [...records].reverse().find(event => event.type === 'agent_invoke_end');
          const freshQuestion = latestEnd?.invoke_id && [this.acceptedSessionInvokeId, currentQuestioningInvokeId].includes(latestEnd.invoke_id)
            && latestEnd.purpose === 'questioning' ? latestEnd.invoke_id : undefined;
          const questionGroups: Array<Array<[number, (typeof records)[number]]>> = [[]];
          for (const [at, start] of records.entries()) {
            if (start.type !== 'agent_invoke_start') continue;
            if (start.purpose === 'author' && String(start.phase).startsWith('initial-design-')) questionGroups.push([]);
            else if (start.invoke_id !== freshQuestion && ['initial-design-questioning', 'design-repair-questioning'].includes(String(start.phase))) {
              questionGroups.at(-1)!.push([at, start]);
            }
          }
          let priorQuestionAt = -1;
          // Consecutive Qs without an intervening author cannot create separate delivered-feedback cycles.
          for (const group of previousDesignEvaluation ? [questionGroups.flat()] : questionGroups) for (const [at, start] of [...group].reverse()) {
            const original = readDesignQuestioningOriginal(runDir, start, records);
            if (!original?.completed) continue;
            try {
              const blueprint = asRecord(YAML.parse(original.beforeBlueprint));
              if (!blueprint) continue;
              const questioning = reusableDesignQuestioning({ ...original, additionalInputs: {}, projectRoot,
                blueprintPath: observed.blueprintPath, blueprint });
              if (!questioning) continue;
              blueprint.review_summary = { ...asRecord(blueprint.review_summary), questioning };
              writeBackAdmission(blueprint, { projectRoot, canonicalPath: observed.blueprintPath });
              const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'design', projectRoot, blueprintPath: observed.blueprintPath, blueprint,
                blueprintIssues: validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: observed.blueprintPath }),
                questioningFindings: independentQuestioningBlockers(blueprint), phase: 'component-design', providerState: 'available' }));
              const files = [...new Set([...workBaseFiles, ...blueprintSourceRefFiles(projectRoot, blueprint, true)])];
              const overrides = { ...original.additionalInputs, [observed.blueprintPath]: original.beforeBlueprint };
              const inputs = designWorkSnapshot(files, overrides);
              let known = !!original.preSnapshot && !original.preSnapshot.failureReason;
              for (const file of files.filter(file => !(file in overrides))) {
                const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
                const entry = original.preSnapshot?.entries.find(item => item.path === relative);
                if (!entry) inputs[file] = { exists: false, contentHash: '' };
                else if (!fs.existsSync(file) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256) known = false;
              }
              if (!known || disposition.completionBlocking.some(problem => problem.action === 'verify' || problem.action === 'wait')) continue;
              priorQuestionAt = Math.max(priorQuestionAt, at);
              if (!previousDesignEvaluation && start.phase === 'initial-design-questioning') {
                const priorEvaluation: CompletionEvaluation = { acceptanceKey, inputs, disposition, completed: true, checkFamilies: ['component-design'] };
                designEvaluations.push(priorEvaluation);
              }
              if (previousDesignEvaluation || start.phase === 'initial-design-questioning') break;
            } catch { /* Missing old bytes do not create a comparable design baseline. */ }
          }
          if (!previousDesignEvaluation) previousDesignEvaluation = designEvaluations.at(-1) ?? null;
          const returned = [...records.slice(priorQuestionAt + 1)].reverse().find(event => event.type === 'agent_invoke_end'
            && event.purpose === 'author' && String(event.phase).startsWith('initial-design-') && invocationCompleted({ ...event, exitCode: event.exit_code }));
          const priorReturnConsumed = returned && records.slice(records.indexOf(returned) + 1).some(event =>
            event.type === 'agent_invoke_start' && event.purpose === 'author' || event.type === 'run_end' && event.halt_reason === 'no_progress_guard');
          const returnedContext = returned?.invoke_id ? executionRequestForInvoke(runDir, returned.invoke_id)?.request.context : undefined;
          const deliveredProblems = previousDesignEvaluation?.disposition.completionBlocking ?? [];
          const designFeedbackDelivered = !!returnedContext && !priorReturnConsumed && deliveredProblems.length > 0
            && (workUnitFeedbackDelivered(returnedContext, { ...previousDesignEvaluation!.disposition, problems: deliveredProblems })
              ?? deliveredProblems.every(problem => returnedContext.instruction?.includes(renderCurrentDisposition({
                ...previousDesignEvaluation!.disposition, problems: [problem] }))));
          const evaluation: CompletionEvaluation = { acceptanceKey,
            inputs: workNow, disposition: observed.disposition, checkFamilies: ['component-design'],
            completed: !observed.disposition.completionBlocking.some(problem => problem.action === 'verify' || problem.action === 'wait') };
          currentDesignEvaluation = evaluation;
          if (previousEnd?.halt_reason === 'no_progress_guard' && !argv['force-resume'] && evaluation.completed
            && previousDesignEvaluation && compareRelatedInputSnapshots(previousDesignEvaluation.inputs, evaluation.inputs) === 'unchanged'
            && observed.disposition.completionBlocking.some(problem => problem.action === 'repair')) {
            return conclude('no_progress_guard', `当前有效Q原件仍覆盖同一业务输入，保留原暂停；重读旧交回不产生新机会。\n${renderCurrentDisposition(observed.disposition)}`);
          }
          const progress = evaluateCompletionProgress({ previous: previousDesignEvaluation, current: evaluation, history: designEvaluations,
            feedbackDelivered: designFeedbackDelivered, authorReturned: !!returned && !priorReturnConsumed });
          if (!resumeDesignWork && progress.halt) return conclude('no_progress_guard', `实际相关改动后，已完成的当前设计检查仍无验收改善；成果及全部未完项保留。\n${renderCurrentDisposition(observed.disposition)}`);
          if (!progress.reused && progress.evaluation === evaluation) { if (previousDesignEvaluation) designEvaluations.push(previousDesignEvaluation); previousDesignEvaluation = evaluation; }
        }
        const explicitlyContinued = resumeDesignWork;
        resumeDesignWork = false;
        const invokeId = `${label}-i${spent.calls + 1}`;
        const invocationDir = path.join(runDir, 'phases', label, invokeId);
        const segments: unknown[] = [];
        const prompt = initialDesignAuthorInstruction({ projectRoot, frameworkRoot, manifest, observation: observed, autonomyAuthorized: automaticDesignRepair,
          deliveryRuns: 'runs' in spent ? spent.runs : undefined, material: segments })
          + (observed.disposition ? `\n当前全部未完项（方法不是写权限；原授权及未恢复写入仍有效）：\n${renderCurrentDisposition(observed.disposition)}` : '');
        const promptFile = path.join(invocationDir, 'prompt.md');
        const beforeBlueprint = fs.existsSync(observed.blueprintPath) ? fs.readFileSync(observed.blueprintPath, 'utf8') : '';
        const resolution = { projectRoot, executionRole: workUnitExecutionRole({ phase: label }, purpose),
          ...(purpose === 'questioning' ? { verifierResultPath: path.join(invocationDir, 'questioning-output.json') } : {}),
          immutableInputPaths: workUnitProtectedRecordPaths(projectRoot, manifest.feature, runDir), protectedRoots: fs.readdirSync(projectRoot).filter(name => name !== '.git') };
        const questioningSources = purpose === 'questioning'
          ? blueprintSourceRefFiles(projectRoot, blueprintAuthorContent(asRecord(YAML.parse(beforeBlueprint)) ?? {}), true)
            .filter(file => isInsideProjectRoot(projectRoot, file)) : [];
        const snapshotOptions = { ownedPrefixes: [path.relative(projectRoot,
          observed.scope?.candidatePath ?? (observed.kind === 'decompose' ? observed.candidatesPath : observed.kind === 'questioning' ? observed.blueprintPath : path.dirname(observed.blueprintPath))).replace(/\\/g, '/')], runtimeExcluded: [manifest.report_dir], includeFiles: questioningSources };
        const pre = capturePhaseInvocationSnapshot(resolution, snapshotOptions);
        if (pre.failureReason) return conclude('framework_bug', pre.failureReason);
        const timeoutMs = 0;
        if (!token) throw new Error('[initial-design] no original author window after CU handoff');
        const childEnv: Record<string, string> = { MAISON_GOAL_RUN_ID: manifest.run_id, MAISON_GOAL_ATTEMPT: invokeId, MAISON_GOAL_ATTEMPT_PHASE: label,
          ...(manifest.adapter_model_pin ? { [MAISON_GOAL_MODEL_PIN_ENV]: adapterModelBinding(manifest.adapter_model_pin)! } : {}) };
        applyGoalVisualProviderEnv(childEnv, manifest.visual_provider_pin);
        const prepared = this.prepareExecutionContext({ ...workUnitExecutionInputs(manifest, purpose, projectRoot), runId: manifest.run_id, feature: manifest.feature, workflowId: 'obligation-driven', track: 'full',
          chain: [label], phase: label, attemptId: invokeId, owner: { ...token, kind: transport }, projectRoot, frameworkRoot,
          runDir, reportDir: manifest.report_dir, adapter: manifest.adapter ?? 'generic', adapterModel: adapterModelBinding(manifest.adapter_model_pin),
          instruction: prompt, workInput: { material: { purpose, segments }, evaluation: currentDesignEvaluation },
          runtimeFacts: { receiptRequired: false, resume: !!argv.resume, successor: false }, childEnv }, explicitlyContinued);
        if ('status' in prepared) return conclude('executor_waiting', prepared.details ?? '等待原设计调用的真实交回。');
        const context = prepared;
        const instruction = context.instruction ?? prompt;
        try {
          if (fs.existsSync(invocationDir)) {
            const actualRun = fs.realpathSync(runDir), actualDir = fs.realpathSync(invocationDir);
            const expectedDir = path.resolve(actualRun, path.relative(runDir, invocationDir));
            const files = fs.readdirSync(invocationDir);
            if (!actualDir.startsWith(actualRun + path.sep) || path.relative(expectedDir, actualDir) !== ''
              || history().some(event => event.invoke_id === invokeId)
              || files.some(file => !['prompt.md', 'blueprint-before.yaml'].includes(file)
                || !fs.lstatSync(path.join(invocationDir, file)).isFile())) {
              return conclude('execution_scope_unresolved', `设计候选 ${invokeId} 存在已启动或不可核实的原件；保留该目录与原请求，先沿真实调用/工具事实恢复，不覆盖旧guard。`);
            }
            // Only abandoned machine preparation with no invocation/request/tool facts is disposable.
            for (const file of files) fs.unlinkSync(path.join(invocationDir, file));
          }
          fs.mkdirSync(invocationDir, { recursive: true });
          fs.writeFileSync(promptFile, instruction);
          fs.writeFileSync(path.join(invocationDir, 'blueprint-before.yaml'), beforeBlueprint, { flag: 'wx' });
        } catch (error) {
          return conclude('execution_scope_unresolved', `设计调用准备原件暂不可写：${(error as Error).message}；保留当前成果，恢复该目录访问后明确继续，不覆盖已有调用原件。`);
        }
        const capability = loadGoalCapability(frameworkRoot, manifest.adapter ?? 'generic');
        let headlessPlan: ReturnType<typeof resolveHeadlessInvokePlan> | undefined;
        if (!this.options.executor && !this.options.sessionHandoff) {
          try {
            if (!capability.valid || !capability.capability) throw new Error(capability.issues.join('; '));
            headlessPlan = resolveHeadlessInvokePlan(manifest.adapter ?? 'generic', capability.capability, manifest.unattended, instruction,
              { PROMPT: instruction, PROMPT_FILE: promptFile, PROJECT_ROOT: projectRoot, FRAMEWORK_ROOT: frameworkRoot, FEATURE: manifest.feature, PHASE: label, SKILL_PATH: path.join(frameworkRoot, 'skills/project/component-design/SKILL.md') }, adapterModelBinding(manifest.adapter_model_pin));
          } catch (error) { return conclude('adapter_cli_hard_failure', (error as Error).message); }
        }
        const issuedAt = new Date().toISOString();
        const materialInput = { context, invokeId, purpose, issuedAt, timeoutMs, gateTimeoutMs: 0, cleanupReserveMs: 0,
          preSnapshot: pre, writeBoundary: { ...resolution, feature: manifest.feature, phaseOrder: [], domains: [], diagnostics: [], unresolvedSourcePhases: [] }, snapshotOptions };
        const original = !this.options.sessionHandoff ? writePhaseExecutionRequestMaterial(materialInput) : undefined;
        emit({ type: 'agent_invoke_start', ts: issuedAt, phase: label, purpose, invoke_id: invokeId, owner_id: token.owner_id, owner_epoch: token.epoch,
          ...(original ? { handoff_request: original.reference, attempt_id: context.attemptId } : {}),
          command: transport === 'session' ? 'phase_execute_request' : 'headless', effective_timeout_ms: timeoutMs });
        if (this.options.sessionHandoff) {
          const issued = issueSessionExecution({ context, invokeId, purpose, timeoutMs, gateTimeoutMs: 0, cleanupReserveMs: 0,
            preSnapshot: pre, writeBoundary: { ...resolution, feature: manifest.feature, phaseOrder: [], domains: [], diagnostics: [], unresolvedSourcePhases: [] }, snapshotOptions, emit });
          preserveOwner = true; this.options.sessionHandoff.onRequest(issued); runConcluded = true; return 3;
        }
        let containmentError: string | undefined;
        let containmentStillAlive = false;
        let childExited = false;
        const executor = this.options.executor ?? new DetachedGoalPhaseExecutor(() => {
          if (!headlessPlan || !capability.capability) throw new Error('initial design headless capability was not resolved');
          return { plan: headlessPlan,
            cwd: projectRoot, options: { outputLogPath: path.join(invocationDir, 'agent-output.log'),
              extraEnv: childEnv, usageCapture: capability.capability.usage_capture, toolEventCapture: capability.capability.tool_event_provenance,
              ...(process.platform === 'win32' ? { containment: { runId: manifest.run_id, invokeId } } : {}),
              onActiveChild: ({ pid, kill }) => {
                activeAgentKill = async () => { await kill(); };
                if (process.platform !== 'win32' || pid <= 0) return;
                const bound = bindGuardianOrKill(pid, `${manifest.run_id}/${invokeId}`);
                if (!bound.ok) { containmentError = bound.error; containmentStillAlive = bound.stillAlive; return; }
                emit({ type: 'agent_process_bound', phase: label, invoke_id: invokeId, pid, started_at_ms: bound.identity.startedAtMs,
                  executable: bound.identity.executable, token: `${manifest.run_id}/${invokeId}` });
              }, onChildExit: () => { childExited = true; activeAgentKill = null; } } };
        }, injectedInvokeAgent ?? invokeAgentHeadless);
        const result = await this.executeExecutor(context, executor);
        activeAgentKill = null;
        if (containmentError && containmentStillAlive) return conclude('agent_containment_unresolved', containmentError);
        if (fs.existsSync(observed.blueprintPath)) fs.writeFileSync(path.join(invocationDir, 'draft-output.yaml'), fs.readFileSync(observed.blueprintPath), { flag: 'wx' });
        emit({ ...invocationEndFacts(result), type: 'agent_invoke_end', phase: label, purpose, invoke_id: invokeId, status: result.status, exit_code: result.exitCode,
          command: result.command, usage: result.usage,
          duration_ms: result.duration_ms, provider_session_id: result.provider_session_id, interrupted: result.interrupted, nativeSessionRebuildReason: result.nativeSessionRebuildReason, readonly_enforced: result.readonly_enforced, readonly_diagnostic: result.readonly_diagnostic, completion_observed: result.completion_observed, terminal_failure_observed: result.terminal_failure_observed, timed_out: result.timed_out,
          silent_killed: result.silent_killed, skipped: result.skipped, kill_attempted: result.kill_attempted, terminal_error_excerpt: result.terminal_error_excerpt, ...(result.spawn_error ? { spawn_error: result.spawn_error } : {}) });
        if (childExited && !containmentError) emit({ type: 'agent_process_settled', phase: label, invoke_id: invokeId, exit_code: result.exitCode, timed_out: result.timed_out });
        const hardCli = resolveInvokeHardCliFailure(result, { formalInvoke: true });
        if (hardCli || containmentError) return conclude('adapter_cli_hard_failure', hardCli ?? containmentError!);
        const post = capturePhaseInvocationSnapshot(resolution, snapshotOptions);
        const delta = diffPhaseInvocationSnapshots(pre, post);
        if (delta.kind === 'unverifiable') return conclude('unauthorized_source_mutation', '设计调用原快照不可核实；不能猜测恢复前像。');
        const originals = authorWritePreimages(beforeAuthorInvocation(history(), invokeId));
        if (delta.kind === 'changed') recordAuthorRestorations(history(), delta.changes, label, invokeId, emit);
        const outside = delta.kind === 'changed' ? delta.changes.filter(change => !snapshotOptions.ownedPrefixes.some(prefix => change.path === prefix || change.path.startsWith(prefix + '/'))
          && (!originals.has(change.path) || originals.get(change.path) !== change.postSha256)) : [];
        if (outside.length) {
          const violations = outside.map(change => ({ path: change.path, violation: 'outside_authority', pre_sha256: change.preSha256, post_sha256: change.postSha256 }));
          const repeated = history().some(event => event.type === 'phase_write_violation' && JSON.stringify((event as Record<string, any>).violations) === JSON.stringify(violations));
          emit({ type: 'phase_write_violation', phase: label, invoke_id: invokeId, violations });
          if (repeated) return conclude('phase_write_violation_repeat', '同一越界写入重复未恢复，保留成果和原前像hash。');
          continue;
        }
        if (purpose === 'author' && delta.kind === 'changed') emit({ type: 'phase_write_observed', phase: label, invoke_id: invokeId,
          pre_snapshot: pre.sha256, post_snapshot: post.sha256,
          owned: delta.changes.map(change => ({ path: change.path, how: change.how, owner: null,
            pre_sha256: change.preSha256, post_sha256: change.postSha256, roles: [] })), observations: [], observed_count: 0 });
        if (recoverableProviderSessionFailure(context, result)) continue;
        if (purpose === 'questioning' && invocationCompleted(result)) {
          if (fs.readFileSync(observed.blueprintPath, 'utf8') !== beforeBlueprint) return conclude('unauthorized_source_mutation', '独立质询修改了只读蓝图输入。');
          const output = result.details ?? readInvokeFinalText(result.stdout, path.join(invocationDir, 'agent-output.log'), manifest.adapter ?? 'generic') ?? '';
          if (delta.kind === 'clean') recordDesignRepairInvocation(runDir, 'questioning', invokeId, {
            started: true, ok: true, status: result.status, detail: result.details ?? result.status, output,
            preSnapshot: pre, postSnapshot: post,
          }, { phase: 'initial-design-questioning', blueprintPath: observed.blueprintPath });
          try { applyIndependentQuestioningOutput(observed.blueprintPath, path.join(invocationDir, 'questioning-output.json'),
            output, 'initial-design-questioning'); }
          catch { /* Original validation owns incomplete or malformed questioning output. */ }
          currentQuestioningInvokeId = invokeId;
        }
        if (purpose === 'author' && invocationCompleted(result)) prepareInitialDesignDraft({ projectRoot, blueprintId: manifest.feature,
          sourceRefs: manifest.requirement_source_files?.length ? manifest.requirement_source_files
            : [path.relative(projectRoot, path.join(runDir, 'manifest.json')).replace(/\\/g, '/') + '#requirement'],
          observedAt: new Date(sessionStart).toISOString(), beforeBlueprint });
        const waitingDetail = invocationWaitingDetail(result);
        if (waitingDetail) return conclude('execution_scope_unresolved', waitingDetail);
      }
    } catch (error) {
      emit({ type: 'run_end', status: 'INTERRUPTED', error: (error as Error).message });
      throw error;
    } finally {
    if (token && !preserveOwner) releaseRunOwner(runDir, token);
      releaseLock(lockPath, lock.ownerId);
    }
  }

  private async repairInitialDesignOwner(manifest: InitialDesignGoalManifest, projectRoot: string, frameworkRoot: string,
    token: RunFenceToken, designFeature: string, brief: DesignRepairBriefLike, emit: (event: Record<string, unknown>) => void,
    priorSignature?: string, forceResume = false): Promise<UnattendedDesignRepairResult> {
    const runDir = path.resolve(projectRoot, manifest.report_dir);
    if (!this.options.executor && !this.options.sessionHandoff) {
      try {
        const cap = loadGoalCapability(frameworkRoot, manifest.adapter ?? 'generic');
        if (!cap.valid || !cap.capability) throw new Error(cap.issues.join('; '));
        resolveHeadlessInvokePlan(manifest.adapter ?? 'generic', cap.capability, manifest.unattended, '',
          { PROMPT: '', PROMPT_FILE: path.join(runDir, 'design-repair', 'author-prompt.md'), PROJECT_ROOT: projectRoot,
            FRAMEWORK_ROOT: frameworkRoot, FEATURE: manifest.feature, PHASE: 'design-repair-author', SKILL_PATH: path.join(frameworkRoot, DESIGN_REPAIR_CONTRACT_DOC) }, adapterModelBinding(manifest.adapter_model_pin));
      } catch (error) { return { outcome: 'not_dispatched', reason: `原设计责任方运输能力不可用，未派发/未记尝试；恢复该能力后重发同一请求：${(error as Error).message}` }; }
    }
    const signature = priorSignature ?? designRepairSignature(designFeature, 'initial-design', brief.items, designRepairInputFingerprint(projectRoot, designFeature));
    const events = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl')).events;
    const continuationBoundary = events.map(event => event.type === 'run_start').lastIndexOf(true);

    return runUnattendedDesignRepair({ projectRoot, frameworkRoot, feature: manifest.feature, designTarget: designRepairTarget(projectRoot, designFeature), phase: 'initial-design',
      runId: manifest.run_id, reportDir: manifest.report_dir, requirement: manifest.requirement, brief, signature, forceResume,
      heldFeatureLock: null, runtimeWrites: [manifest.report_dir], emit,
      invoke: (purpose, prompt, guard) => {
        const current = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
        const explicitlyContinued = forceResume && continuationBoundary >= 0
          && !current.slice(continuationBoundary + 1).some(event => event.type === 'agent_invoke_start');
        return this.invokeDesignOwner(manifest, projectRoot, frameworkRoot, token, purpose, prompt, guard, emit, explicitlyContinued);
      },
      registerLockRelease: release => { designRepairLockRelease = release; },
      recordEventLines: () => { const lines: Array<{ file: string; line: string }> = []; const previous = eventLineRecorder;
        eventLineRecorder = (file, line) => { previous?.(file, line); lines.push({ file, line }); };
        return () => { eventLineRecorder = previous; return lines; }; },
      recheckReadiness: () => { const ready = deriveDesignPreparationReadiness(projectRoot, manifest.feature);
        return { ready: ready.ready, reason: ready.ready ? '原始请求的真实P1/P2 readiness已重派生'
          : JSON.stringify({ units: ready.perUnit, ownership: ready.ownershipIssues }) }; },
    });
  }

  /** The existing design transaction uses the same fenced request/result transport at the raw-request anchor. */
  async invokeDesignOwner(manifest: GoalRunManifest, projectRoot: string, frameworkRoot: string,
    token: RunFenceToken, purpose: DesignRepairPurpose, text: string, guard: DesignRepairInvocationGuard | undefined,
    emit: (event: Record<string, unknown>) => void, explicitlyContinued = false,
    acceptedInvokeId = this.acceptedSessionInvokeId): Promise<DesignRepairInvokeOutcome> {
    const runDir = path.resolve(projectRoot, manifest.report_dir);
    const label = designRepairInvokeLabel(purpose);
    if (acceptedInvokeId && guard) {
      try {
      const issued = sessionExecutionForInvoke(runDir, acceptedInvokeId);
      const received = issued && acceptedSessionReport(runDir, issued);
      const request = issued?.request;
      const targets = (paths: readonly string[] | undefined) => [...paths ?? []].map(file => path.resolve(projectRoot, file)).sort();
      if (request && received && guard.options?.ownedPrefixes?.length && request.purpose === purpose && request.context.phase === label
        && request.context.runId === manifest.run_id && request.context.feature === manifest.feature
        && path.resolve(request.context.projectRoot) === path.resolve(projectRoot) && path.resolve(request.context.runDir) === runDir
        && request.context.owner.run_id === token.run_id && request.context.owner.owner_id === token.owner_id && request.context.owner.epoch === token.epoch
        && stableStringify(targets(request.snapshot_options?.ownedPrefixes)) === stableStringify(targets(guard.options?.ownedPrefixes))) {
        if (this.acceptedSessionInvokeId === acceptedInvokeId) this.acceptedSessionInvokeId = undefined;
        const saved = received.event.handoff_report
          ? readHandoffMaterial<{ post_snapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> }>(runDir, received.event.handoff_report) : undefined;
        if (!request.pre_snapshot || !saved?.post_snapshot) return { started: false, ok: false, status: 'waiting', invokeId: request.invoke_id,
          detail: '本次原设计调用已交回但前/后像原件缺失；恢复该准确请求的归档后继续，不另派作者或猜测写入。' };
        return { started: true, ok: invocationCompleted({ ...received.event, status: received.report.status, exitCode: received.event.exit_code }),
          invokeId: request.invoke_id, status: received.report.status, detail: received.report.details ?? received.report.status,
          output: received.report.details ?? '', preSnapshot: request.pre_snapshot, postSnapshot: saved.post_snapshot };
      }
      } catch (error) {
        return { started: false, ok: false, status: 'waiting', invokeId: acceptedInvokeId,
          detail: `本次原设计调用 ${acceptedInvokeId} 的交回归档不可核实：${(error as Error).message}。保留草稿与原件，恢复准确归档后继续，不另派作者。` };
      }
    }
    if (guard?.evaluation) {
      const history = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl')).events;
      const returned = [...history].reverse().find(event => event.type === 'agent_invoke_end' && 'purpose' in event && event.purpose === 'author'
        && invocationCompleted({ ...event, exitCode: event.exit_code }));
      const delivered = returned?.invoke_id ? executionRequestForInvoke(runDir, returned.invoke_id)?.request.context : undefined;
      const prior = guard.history?.at(-1);
      const feedback = prior?.disposition.completionBlocking ?? [];
      const progress = evaluateCompletionProgress({ previous: guard.history?.at(-1), current: guard.evaluation,
        history: guard.history, feedbackDelivered: guard.feedbackDelivered === true && feedback.length > 0
          && !!delivered && (workUnitFeedbackDelivered(delivered, { ...prior!.disposition, problems: feedback })
            ?? feedback.every(problem => delivered.instruction?.includes(renderCurrentDisposition({ ...prior!.disposition, problems: [problem] })))), authorReturned: !!returned });
      if (progress.halt && !explicitlyContinued) return { started: false, ok: false, status: 'waiting',
        detail: `no_progress_guard: 当前设计反馈已交付且作者真实交回，独立完成检查仍无改善；保全候选与原件，相关条件变化或用户明确继续后接回。\n${renderCurrentDisposition(guard.evaluation.disposition)}` };
      text += `\n当前全部未完项与真实依据：\n${renderCurrentDisposition(guard.evaluation.disposition)}`;
    }

    const activity = readOriginalDeliveryActivity(projectRoot, manifest) ?? readExecutionActivity(loadAuthoritativeEvents(path.join(runDir, 'events.jsonl')));
    const timeoutMs = 0;
    const invokeId = `${label}-i${activity.calls + 1}`;
    const dir = path.join(runDir, 'phases', label, invokeId);
    const promptFile = path.join(dir, 'prompt.md');
    const kind = this.options.sessionHandoff || this.options.executor ? 'session' : 'process';
    const childEnv: Record<string, string> = { MAISON_GOAL_RUN_ID: manifest.run_id, MAISON_GOAL_ATTEMPT: invokeId, MAISON_GOAL_ATTEMPT_PHASE: label,
      ...(manifest.adapter_model_pin ? { [MAISON_GOAL_MODEL_PIN_ENV]: adapterModelBinding(manifest.adapter_model_pin)! } : {}) };
    applyGoalVisualProviderEnv(childEnv, manifest.visual_provider_pin);
    const prepared = this.prepareExecutionContext({ ...workUnitExecutionInputs(manifest, purpose, projectRoot), runId: manifest.run_id, feature: manifest.feature, workflowId: 'obligation-driven', track: 'full', chain: [label], phase: label,
      attemptId: invokeId, owner: { ...token, kind }, projectRoot, frameworkRoot, runDir, reportDir: manifest.report_dir,
      adapter: manifest.adapter ?? 'generic', adapterModel: adapterModelBinding(manifest.adapter_model_pin), instruction: text,
      workInput: { material: { purpose, segments: [...guard?.material ?? [text], ...(guard?.evaluation ? [{
        acceptanceKey: guard.evaluation.acceptanceKey, inputs: guard.evaluation.inputs,
        disposition: dispositionFacts(guard.evaluation.disposition) }] : [])] }, evaluation: guard?.evaluation },
      runtimeFacts: { receiptRequired: false, resume: true, successor: false }, childEnv }, explicitlyContinued);
    if ('status' in prepared) return { started: false, ok: false, status: 'waiting', detail: prepared.details ?? '等待原设计调用的真实交回。' };
    const context = prepared;
    text = context.instruction ?? text;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(promptFile, text);
    const boundary = guard ? { ...guard.resolution, executionRole: workUnitExecutionRole(context, purpose),
      immutableInputPaths: [...new Set([...(guard.resolution.immutableInputPaths ?? []), ...workUnitProtectedRecordPaths(projectRoot, manifest.feature, runDir)])],
      feature: manifest.feature, phaseOrder: [], domains: [], diagnostics: [], unresolvedSourcePhases: [] } : null;
    const issuedAt = new Date().toISOString();
    const original = !this.options.sessionHandoff ? writePhaseExecutionRequestMaterial({ context, invokeId, purpose, issuedAt, timeoutMs,
      gateTimeoutMs: 0, cleanupReserveMs: 0, preSnapshot: guard?.pre ?? null, writeBoundary: boundary, snapshotOptions: guard?.options }) : undefined;
    emit({ type: 'agent_invoke_start', ts: issuedAt, phase: label, purpose, invoke_id: invokeId, owner_id: token.owner_id, owner_epoch: token.epoch,
      ...(original ? { handoff_request: original.reference, attempt_id: context.attemptId } : {}),
      command: kind === 'session' ? 'phase_execute_request' : 'headless', effective_timeout_ms: timeoutMs });
    if (this.options.sessionHandoff) {
      const issued = issueSessionExecution({ context, invokeId, purpose, timeoutMs, gateTimeoutMs: 0, cleanupReserveMs: 0,
        preSnapshot: guard?.pre ?? null, writeBoundary: boundary, snapshotOptions: guard?.options, emit });
      this.options.sessionHandoff.onRequest(issued);
      return { started: true, ok: false, handoff: true, detail: '原design owner真实请求已签发' };
    }
    const capability = loadGoalCapability(frameworkRoot, manifest.adapter ?? 'generic');
    let containmentError: string | undefined; let containmentAlive = false; let childExited = false;
    const executor = this.options.executor ?? new DetachedGoalPhaseExecutor(() => {
      if (!capability.valid || !capability.capability) throw new Error(capability.issues.join('; '));
      return { plan: resolveHeadlessInvokePlan(context.adapter, capability.capability, manifest.unattended, text,
        { PROMPT: text, PROMPT_FILE: promptFile, PROJECT_ROOT: projectRoot, FRAMEWORK_ROOT: frameworkRoot, FEATURE: manifest.feature, PHASE: label, SKILL_PATH: path.join(frameworkRoot, 'skills/reference/design-repair-unattended.md') }, adapterModelBinding(manifest.adapter_model_pin)),
        cwd: projectRoot, options: { outputLogPath: path.join(dir, 'agent-output.log'), extraEnv: childEnv,
          ...(process.platform === 'win32' ? { containment: { runId: manifest.run_id, invokeId } } : {}),
          usageCapture: capability.capability.usage_capture, toolEventCapture: capability.capability.tool_event_provenance,
          onActiveChild: ({ pid, kill }) => {
            activeAgentKill = async () => { await kill(); };
            if (process.platform !== 'win32' || pid <= 0) return;
            const ownership = bindGuardianOrKill(pid, `${manifest.run_id}/${invokeId}`);
            if (!ownership.ok) { containmentError = ownership.error; containmentAlive = ownership.stillAlive; return; }
            emit({ type: 'agent_process_bound', phase: label, invoke_id: invokeId, pid, started_at_ms: ownership.identity.startedAtMs,
              executable: ownership.identity.executable, token: `${manifest.run_id}/${invokeId}` });
          }, onChildExit: () => { childExited = true; activeAgentKill = null; } } };
    }, injectedInvokeAgent ?? invokeAgentHeadless);
    if (kind === 'session') renewSessionLease(runDir, token, this.options.leaseMs ?? 60_000);
    const result = await this.executeExecutor(context, executor); activeAgentKill = null;
    if (containmentError && containmentAlive) return { started: true, ok: false, containmentUnresolved: true, detail: containmentError };
    const post = guard ? capturePhaseInvocationSnapshot(guard.resolution, guard.options) : undefined;
    emit({ ...invocationEndFacts(result), type: 'agent_invoke_end', phase: label, purpose, invoke_id: invokeId, status: result.status, exit_code: result.exitCode, command: result.command,
      duration_ms: result.duration_ms, usage: result.usage, timed_out: result.timed_out, provider_session_id: result.provider_session_id, interrupted: result.interrupted, nativeSessionRebuildReason: result.nativeSessionRebuildReason, readonly_enforced: result.readonly_enforced, readonly_diagnostic: result.readonly_diagnostic, completion_observed: result.completion_observed, terminal_failure_observed: result.terminal_failure_observed,
      silent_killed: result.silent_killed, skipped: result.skipped, kill_attempted: result.kill_attempted,
      terminal_error_excerpt: result.terminal_error_excerpt, ...(result.spawn_error ? { spawn_error: result.spawn_error } : {}) });
    if (childExited && !containmentError) emit({ type: 'agent_process_settled', phase: label, invoke_id: invokeId, exit_code: result.exitCode });
    const outcome: DesignRepairInvokeOutcome = { started: true, invokeId, ok: invocationCompleted(result) && !containmentError, status: result.status,
      ...(purpose === 'questioning' ? { output: result.details ?? readInvokeFinalText(result.stdout, path.join(dir, 'agent-output.log'), manifest.adapter ?? 'generic') ?? '' } : {}),
      detail: containmentError ?? result.details ?? `exit=${result.exitCode}`, preSnapshot: guard?.pre, postSnapshot: post };
    recordDesignRepairInvocation(runDir, purpose, invokeId, outcome);
    return outcome;
  }

  private async continueInitialDesignConstruction(manifest: InitialDesignGoalManifest, projectRoot: string, frameworkRoot: string, argv: minimist.ParsedArgs, observation: InitialDesignObservation, originalToken: RunFenceToken,
    emit: (event: Record<string, unknown>) => void, stop: (reason: string, detail: string, disposition?: Record<string, unknown>) => number,
    releaseOriginal: () => void, releaseController: () => void): Promise<number | InitialDesignObservation> {
    const decision = observation.progression;
    if (!decision) return observation;
    if (decision.action === 'ready_for_component_closure') {
      let closure: ReturnType<typeof writeCanonicalComponentClosure>;
      try {
        assertFencedOwner(path.resolve(projectRoot, manifest.report_dir), originalToken, 'component_closure_writer');
        closure = writeCanonicalComponentClosure(projectRoot, manifest.feature);
      } catch (error) { return stop('executor_waiting', `正式组装工具尚未交回可核验原件：${(error as Error).message}`,
        { run_disposition: 'WAITING', run_wait_kind: 'external' }); }
      const current = readInitialDesignCompletionDisposition({ projectRoot, frameworkRoot, manifest });
      if (!current.completionEligible) {
        const knowledge = closure.issues.filter(issue => issue.severity === 'BLOCKER' && issue.id.startsWith('component_closure_knowledge_'));
        if (knowledge.length) return { ...observation, issues: current.reasons, designRepair: { feature: manifest.feature,
          brief: { class: 'B1', items: knowledge.map(issue => ({ check: 'component-closure', codes: [issue.id], class: 'B1',
            artifacts: [path.relative(projectRoot, observation.blueprintPath).replace(/\\/g, '/')],
            basis: `${issue.path}: ${issue.message}\n当前责任与真实差额：${renderCurrentDisposition(current)}`,
            needs: ['原资产writer在原请求授权内先归位既有知识资产；P1 owner再补真实knowledge_refs，经原design preparation升CU指针后重跑closure。保留已批准结论与原验收，不新增决定，不写正式完成或组装原件。'] })) } } };
        return stop('executor_waiting', renderCurrentDisposition(current), { run_disposition: 'WAITING', run_wait_kind: 'external' });
      }
      emit({ type: 'run_end', status: 'COMPLETED', detail: '全部适用CU与正式组装原件已由同一当前完成事实核验。' });
      fs.writeFileSync(path.resolve(projectRoot, manifest.report_dir, 'goal-report.json'), JSON.stringify(projectInitialDesignDelivery({ projectRoot, frameworkRoot, manifest }), null, 2) + '\n');
      return 0;
    }
    let childCode = 1;
    let nextScope: InitialDesignObservation | undefined;
    const scopeWork = (request: Pick<ChangeUnitGoalHandoff, 'featureId' | 'requirement'>, issues: string[]): InitialDesignObservation => {
      const candidatePath = featureTrackDeclPath(projectRoot, request.featureId);
      if (fs.existsSync(candidatePath)) return { ...observation, kind: 'scope', issues,
        scope: { feature: request.featureId, candidatePath, command: 'npm run check -- --feature ' + JSON.stringify(request.featureId) } };
      try {
        if (!decision.selected) throw new Error('没有当前已准入CU，不能猜范围');
        const workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot });
        // Canonical CU construction has an implementation object; domain D is never copied as requested actions.
        const implementation = deriveModifiableModules(projectRoot, decision.selected).length
          ? workflow.artifacts.find(artifact => artifact.obligation_provider_id === 'obligations.coding')?.id : undefined;
        const actions = implementation ? [implementation] : [];
        const declaration = asRecord(loadFeatureTrackDecl(projectRoot, request.featureId));
        const current = asRecord(asRecord(declaration?.execution_scope)?.request);
        const originalImpact = asRecord(current?.impact) ?? asRecord(manifest.initial_design.impact);
        const basis = Array.isArray(originalImpact?.basis) ? originalImpact!.basis : [];
        const impactPaths = basis.flatMap(value => {
          const binding = asRecord(value); return Array.isArray(binding?.dependencies)
            ? binding!.dependencies.flatMap(dependency => typeof asRecord(dependency)?.path === 'string' ? [String(asRecord(dependency)!.path)] : []) : [];
        });
        const impact = typeof originalImpact?.user_visible_behavior_change === 'boolean' && typeof originalImpact.reason === 'string' && impactPaths.length
          ? { userVisibleBehaviorChange: originalImpact.user_visible_behavior_change, reason: originalImpact.reason, basisPaths: impactPaths } : undefined;
        const prepared = prepareFeatureScopeCandidate(prepareChangeUnitScopeInput({ projectRoot, frameworkRoot, changeUnit: decision.selected,
          requirement: manifest.requirement ?? '', requirementSourceFiles: manifest.requirement_source_files,
          requestedResults: [request.requirement], requestedPhases: actions, impact, overwrite: true }));
        const unresolved = prepared.scope.unresolved.map(item => item.reason);
        return { ...observation, kind: unresolved.length ? 'scope' : 'construction', issues: unresolved,
          scope: { feature: request.featureId, candidatePath, command: 'npm run check -- --feature ' + JSON.stringify(request.featureId) } };
      } catch (error) {
        return { ...observation, kind: 'scope', issues: [...issues, String(error)],
          scope: { feature: request.featureId, candidatePath, command: 'npm run check -- --feature ' + JSON.stringify(request.featureId) } };
      }
    };
    if (decision.action === 'select_one' && decision.selected) {
      const request = buildChangeUnitGoalRequest(projectRoot, decision.selected);
      const feature = request.featureId;
      if (!fs.existsSync(featureTrackDeclPath(projectRoot, feature))) return scopeWork(request, ['尚无本CU的明确动作A和有据影响判断，由原scope责任方完整准备；机器不把域D预填成请求动作。']);
      const runsDir = featureFilePath(projectRoot, feature, 'goal-runs');
      const hasRun = fs.existsSync(runsDir) && fs.readdirSync(runsDir).some(name => !name.startsWith('.'));
      if (!hasRun && !readFeatureFrozenScope(projectRoot, feature)) {
        try {
          resolveBirthExecutionScope(projectRoot, feature, resolveWorkflowSpec(projectRoot, { frameworkRoot }), frameworkRoot, manifest.requirement, manifest.fidelity);
        }
        catch (error) { return scopeWork(request, [(error as Error).message, '整份重生成当前交接候选，保留原请求；不要只更新旧hash或沿用旧判断。']); }
      }
    }
    const invoke = async (handoff: ChangeUnitGoalHandoff, activeRunId?: string, notes?: string) => {
      const mode = await import('./goal-mode-entry');
      let child: GoalManifest;
      if (activeRunId) child = loadGoalManifestFromRun(projectRoot, activeRunId, { feature: handoff.featureId });
      else {
        const candidatePath = featureTrackDeclPath(projectRoot, handoff.featureId);
        if (!fs.existsSync(candidatePath)) {
          nextScope = scopeWork(handoff, ['尚无本CU的明确动作A和完整范围候选，由原scope责任方准备。']);
          return { status: 'paused' as const, reason: '原scope责任方明确本CU动作' };
        }
        const scope = resolveBirthExecutionScope(projectRoot, handoff.featureId, resolveWorkflowSpec(projectRoot, { frameworkRoot }), frameworkRoot, manifest.requirement, manifest.fidelity).scope;
        if (!scope || !scope.phase_chain.length) {
          nextScope = scopeWork(handoff, scope?.unresolved.map(gap => `${gap.obligation_id}: ${gap.reason}`) ?? ['尚无合法范围候选']);
          return { status: 'paused' as const, reason: '原设计责任方继续准备当前真实CU的范围输入' };
        }
        let prepared: ReturnType<typeof mode.prepareGoalModeRun>;
        try { prepared = mode.prepareGoalModeRun({ projectRoot, frameworkRoot, feature: handoff.featureId, adapter: manifest.adapter ?? 'generic',
          requirement: manifest.requirement ?? '', deliveryOrigin: { feature: manifest.feature, run_id: manifest.run_id } }); }
        catch (error) {
          if (!/scope动作A|scope候选缺少/.test((error as Error).message)) throw error;
          nextScope = scopeWork(handoff, [(error as Error).message]);
          return { status: 'paused' as const, reason: '原scope责任方补齐原请求动作，保留当前请求与模型绑定。' };
        }
        if (isInitialDesignManifest(prepared.manifest)) throw new Error('[initial-design] canonical CU unexpectedly entered initial design');
        child = prepared.manifest;
      }
      if (child.delivery_origin?.feature !== manifest.feature || child.delivery_origin.run_id !== manifest.run_id) throw new Error('[initial-design] active CU belongs to another original request');
      if (liveFeatureLock(projectRoot, child.feature)) {
        childCode = 3;
        runConcluded = true;
        return { status: 'paused' as const, runId: child.run_id, reason: '原请求的真实child仍由存活的feature锁持有者推进；沿当前执行观察，不启动第二作者。' };
      }
      child = rebindTaskModel(child, manifest.adapter_model_pin, projectRoot, true, manifest.visual_provider_pin);
      const childRunDir = path.resolve(projectRoot, child.report_dir);
      const reportPath = this.options.sessionHandoff?.requestPath;
      const relativeReport = reportPath ? path.relative(childRunDir, path.resolve(reportPath)) : '..';
      const handoffOptions = this.options.sessionHandoff ? { ...this.options.sessionHandoff,
        ...(relativeReport.startsWith('..') || path.isAbsolute(relativeReport) ? { requestPath: undefined, report: undefined } : {}) } : undefined;
      const prelude = handoffOptions ? inspectSessionExecutionBeforeRuntime({ runDir: childRunDir,
        requestPath: handoffOptions.requestPath, report: handoffOptions.report, forceTakeover: Boolean(argv['force-resume']) }) : null;
      if (prelude?.reusable) {
        handoffOptions!.onRequest(prelude.reusable);
        childCode = 3;
        runConcluded = true;
        return { status: 'paused' as const, runId: child.run_id, reason: '复用真实child尚未报告的原签请求，不再领取第二作者窗口。' };
      }
      releaseOriginal();
      const childEvents = loadEventsJsonlStrict(path.join(childRunDir, 'events.jsonl')).events;
      const started = childEvents.some(event => event.type === 'run_start');
      const pending = prelude?.current ?? readSessionExecution(childRunDir);
      const resume = started && (!resolveEffectiveRunEnd(childEvents) || pending && !acceptedSessionReport(childRunDir, pending)
        || handoffOptions?.report && handoffOptions.requestPath);
      // A stopped child goes through the normal implicit continuation decision:
      // a design publication may require a successor with freshly resolved bindings.
      const childEntry = resume ? ['--resume', child.run_id] : started ? [] : ['--attach-created', child.run_id];
      const runtime = new GoalPhaseRuntime({ ...this.options, sessionHandoff: handoffOptions,
        args: ['--feature', child.feature, ...childEntry, '--project-root', projectRoot, '--framework-root', frameworkRoot,
          '--runtime-executor', this.options.executor || this.options.sessionHandoff ? 'attended' : 'detached',
          '--runtime-owner', this.options.executor || this.options.sessionHandoff ? 'session' : 'process', ...inheritRunProcessArgs(argv),
          ...(argv['force-resume'] ? ['--force-resume'] : []), ...(notes ? ['--repair-notes', notes] : [])] }, manifest);
      try { childCode = await runtime.run(); }
      finally { releaseController(); }
      return { status: childCode === 0 ? 'completed' as const : childCode === 3 ? 'paused' as const : 'failed' as const,
        runId: runtime.lastRunId ?? child.run_id, reason: `当前CU runtime exit=${childCode}` };
    };
    if (decision.action === 'resume_active' && decision.activeRun) {
      const ready = decision.readySet.units.find(unit => deriveChangeUnitFeatureId(unit.changeUnit.blueprint_id, unit.changeUnit.change_unit_id) === decision.activeRun!.featureId);
      if (!ready) throw new Error('[initial-design] active CU is not in the canonical workspace');
      await invoke(buildChangeUnitGoalHandoff(projectRoot, ready.changeUnit, { runId: decision.activeRun.runId, frameworkRoot }), decision.activeRun.runId);
    } else if (decision.action === 'blocked') {
      // P2 deliberately leaves INCOMPLETE completion blocked. The request still owns
      // the existing run; its normal continuation rules decide rejoin/successor/wait.
      const family = readOriginalDeliveryActivity(projectRoot, manifest)!;
      const existing = family.runs.filter(run => !isInitialDesignManifest(run.manifest)
        && decision.readySet.units.some(unit => unit.completion.state !== 'VALID'
          && unit.completion.featureId === run.manifest.feature))
        .sort((left, right) => String(left.events.at(-1)?.ts).localeCompare(String(right.events.at(-1)?.ts))).at(-1);
      const unit = existing && decision.readySet.units.find(unit => unit.completion.featureId === existing.manifest.feature);
      if (existing && unit) await invoke(buildChangeUnitGoalHandoff(projectRoot, unit.changeUnit, { runId: existing.manifest.run_id, frameworkRoot }), existing.manifest.run_id);
      else return stop('execution_scope_unresolved', decision.reasons.join('\n'));
    } else await runChangeUnitProgression(projectRoot, manifest.feature, {
      caller: handoff => invoke(handoff, deliveryCycleView(projectRoot, handoff.featureId).unfinished.at(-1)?.runId),
      buildHandoff: (root, unit) => {
        const feature = deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id);
        const prior = deliveryCycleView(root, feature).unfinished.at(-1);
        return buildChangeUnitGoalHandoff(root, unit, prior ? { runId: prior.runId, frameworkRoot } : undefined);
      } });
    if (nextScope) return nextScope;
    if (childCode === 0) return new GoalPhaseRuntime({ ...this.options, args: ['--feature', manifest.feature, '--resume', manifest.run_id, '--project-root', projectRoot, '--framework-root', frameworkRoot,
      ...inheritRunProcessArgs(argv)] }).run();
    if (childCode !== 3) {
      const family = readOriginalDeliveryActivity(projectRoot, manifest)!;
      const child = family.runs.filter(run => !isInitialDesignManifest(run.manifest))
        .sort((left, right) => String(left.events.at(-1)?.ts).localeCompare(String(right.events.at(-1)?.ts))).at(-1);
      const end = child && resolveEffectiveRunEnd(child.events);
      const designFeedback = child && [...child.events].reverse().find(event => event.type === 'phase_halt'
        && asRecord((event as Record<string, unknown>).design_authority)?.items);
      if (designFeedback && readInitialDesignDelivery({ projectRoot, frameworkRoot, manifest }).designRepair) {
        // The original design request re-acquires its own fence and native author session.
        // A CU author never becomes a root designer by changing its invocation label.
        return new GoalPhaseRuntime({ ...this.options, args: ['--feature', manifest.feature, '--resume', manifest.run_id,
          '--project-root', projectRoot, '--framework-root', frameworkRoot, ...inheritRunProcessArgs(argv)] }).run();
      }
      return stop(end?.halt_reason ?? 'execution_scope_unresolved', end && 'error' in end && typeof end.error === 'string'
        ? end.error : '当前CU未完成，沿同一原始请求和该CU正式记录恢复。', {
        ...(end && 'recovery' in end ? { recovery: end.recovery } : {}),
        ...(end && 'run_disposition' in end ? { run_disposition: end.run_disposition } : {}),
        ...(end && 'run_wait_kind' in end ? { run_wait_kind: end.run_wait_kind } : {}),
        ...(end && 'halt_guidance' in end ? { halt_guidance: end.halt_guidance } : {}),
      });
    }
    return childCode;
  }

  async executeExecutor(
    context: WorkUnitExecutionContext,
    executor: GoalPhaseExecutor,
    controls: WorkUnitExecutionControls | undefined = this.options.executionControls,
  ): Promise<GoalPhaseExecutorResult> {
    setupSignalHandlers();
    validateWorkUnitExecutionContext(context);
    if (context.owner.owner_id !== 'dry-run') {
      assertFencedOwner(context.runDir, context.owner, 'runtime_pre_executor');
    }
    const previousChecks: ReturnType<typeof completedCheckResultsFromToolEvents> = [];
    if (controls?.cancel && context.runDir && workUnitExecutionRole(context) === 'author') {
      for (const start of loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'))) {
        if (start.type === 'harness_end' && start.phase && start.invoke_id && !start.timed_out) {
          try { previousChecks.push(...completedCheckResultsFromOutput(fs.readFileSync(path.join(context.runDir, 'phases', start.phase,
            start.invoke_id, 'harness-output.log'), 'utf8')).map(result => ({ ...result, current: false }))); }
          catch { /* Missing originals do not create a comparison window. */ }
          continue;
        }
        if (start.type !== 'agent_invoke_start' || !start.invoke_id || start.invoke_id === context.attemptId || start.invoke_id === `${context.phase}-${context.attemptId}`) continue;
        const original = executionRequestForInvoke(context.runDir, start.invoke_id);
        if (!original || original.request.context.feature !== context.feature || original.request.context.adapter !== context.adapter
          || path.resolve(original.request.context.projectRoot) !== path.resolve(context.projectRoot)
          || workUnitExecutionRole(original.request.context, original.request.purpose) !== 'author'
          || stableStringify(original.request.context.authority) !== stableStringify(context.authority)) continue;
        const stream = path.join(context.runDir, path.dirname(original.reference.path), 'agent-events.jsonl');
        if (!fs.existsSync(stream)) continue;
        const records = fs.readFileSync(stream, 'utf8').split(/\r?\n/).flatMap(line => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
        previousChecks.push(...completedCheckResultsFromToolEvents(context.adapter, records, true).map(result => ({ ...result, current: false })));
      }
    }
    const observedControls: WorkUnitExecutionControls = { ...controls, onObservation: view => {
      controls?.onObservation?.(view);
      if (!controls?.cancel || controls.signal?.aborted || workUnitExecutionRole(context) !== 'author') return;
      const originals = completedCheckResultsFromToolEvents(context.adapter, view.toolEvents);
      if (!originals.length) return; // Read/Grep and ordinary native output never run checks or expensive material readers.
      const history = [...previousChecks, ...originals.filter(result => !result.current)];
      for (const completed of originals.filter(result => result.current)) {
        const result = readReusableCheckResult({ projectRoot: context.projectRoot, frameworkRoot: context.frameworkRoot,
          feature: context.feature, phase: completed.phase, runId: context.runId });
        if (!result) continue; // A report superseded by another write is not a completed current assessment.
        const input = { projectRoot: context.projectRoot, frameworkRoot: context.frameworkRoot, feature: context.feature,
          endpoint: 'request' as const, chain: [completed.phase], runId: context.runId, authority: context.authority, currentResults: [result] };
        const disposition = resolveCompletionDisposition(input);
        const current = currentCompletionEvaluation(input, disposition);
        const decision = completionProgressFromHistory(current, history.map(item => item.evaluation), history.length > 0);
        if (!decision.halt) continue;
        assertFencedOwner(context.runDir, context.owner, 'running_completion_evaluation');
        const reason = `no_progress_guard: 已反馈且实际检查完成，相关改动后验收/已核实差额仍无改善；成果保留，明确继续或真实条件变化后接回。\n${renderCurrentDisposition(disposition)}`;
        appendEvent(context.reportDir, context.projectRoot, withRunDisposition({ type: 'phase_halt', phase: context.phase,
          run_id: context.runId, invoke_id: view.invoke_id, halt_reason: 'no_progress_guard', detail: reason,
          owner_id: context.owner.owner_id, owner_epoch: context.owner.epoch }));
        controls.cancel(reason);
        break;
      }
    } };
    activeExecutionControls = observedControls;
    let result: GoalPhaseExecutorResult;
    const leaseMs = this.options.leaseMs ?? 60_000;
    const leaseHeartbeat = context.owner.kind === 'session' && !(featureLock && runControl?.dir === context.runDir)
      ? setInterval(() => {
        try { renewSessionLease(context.runDir, context.owner, leaseMs); }
        catch { observedControls.cancel?.('原owner租约/写权无法续接，保留原调用并停止写入。'); }
      }, Math.max(250, Math.trunc(leaseMs / 3))) : null;
    try { result = await executor.execute(context, observedControls); }
    finally {
      if (leaseHeartbeat) clearInterval(leaseHeartbeat);
      if (activeExecutionControls === observedControls) activeExecutionControls = undefined;
    }
    if (context.owner.owner_id !== 'dry-run') {
      assertFencedOwner(context.runDir, context.owner, 'runtime_post_executor');
      const original = executionRequestForInvoke(context.runDir);
      const rawPath = original ? path.resolve(context.runDir, path.dirname(original.reference.path), 'agent-events.jsonl') : undefined;
      const mismatch = result.model_binding_mismatch ?? modelMismatchInEvents(context.adapter, context.adapterModel,
        rawPath && fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8') : result.stdout);
      if (mismatch) {
        appendEvent(context.reportDir, context.projectRoot, { type: 'pin_verify_mismatch', phase: context.phase,
          invoke_id: original?.request.context.attemptId === context.attemptId ? original.request.invoke_id : context.attemptId,
          adapter: context.adapter, pin: context.adapterModel, observed: mismatch });
        result = { ...result, status: 'waiting', exitCode: 1, completion_observed: false, terminal_failure_observed: true,
          model_binding_mismatch: mismatch, nativeSessionRebuildReason: undefined, details: mismatch + '；保留成果，等待恢复任务授权路由。' };
      }
    }
    const reason = controls?.signal?.reason;
    return typeof reason === 'string' && reason.startsWith('no_progress_guard:') ? { ...result, details: reason } : result;
  }
}

/**
 * 主入口。**导出供 runner 级集成测试直接调用**（配合 __testing_set* 注入缝）——
 * 生产路径仍由文件尾的 require.main 分支驱动，行为不变。
 */
export async function main(options: GoalPhaseRuntimeLaunchOptions = {}): Promise<number> {
  options = withExecutionControls(options);
  // Programmatic host bridges may run more than one lifecycle in the same Node process.
  // Reset only ephemeral process-local projection; persisted truth remains manifest/events/control.
  terminalEventCtx = null;
  runConcluded = false;
  appendEventBaseFields = {};
  progressSubstep = null;
  progressPhase = null;
  progressHeartbeatHook = null;
  if (guardNestedGoalRunner()) return 1;
  setupSignalHandlers();

  const argv = parseGoalRuntimeArgs(options.args ?? process.argv.slice(2));
  warnRetiredModelAlternatives(loadFrameworkLocalConfig(resolveRuntimeLayout(options, argv).projectRoot));

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
  // plan 8d2b4f60 D7（第2轮 plan review finding 13）：反向约束。owner.kind 已升格为
  // vl_multimodal 终签的执行形态判据（attended ⇒ 结构性不可达），双向蕴含缺一半就是旁路：
  // `--runtime-executor attended --runtime-owner process` 会让 gate 判不出 attended，
  // 从而把先前 detached 轮的 refs 读取记录当本轮证据终签。
  if (executorMode === 'attended' && runtimeOwnerKind !== 'session') {
    console.error(
      '[goal-phase-runtime] BLOCKER: attended executor 必须配 session owner（detached 只能配 process owner）；' +
        'owner.kind 是 attended 的唯一机内判据，错配会让视觉终签误采信先前 invocation 的读取记录。',
    );
    return 1;
  }
  // `let`：接续决策判"重新接入一个启动即失败的 run"时改写为附着（plan 4e6fb3b6 §7.2）。
  let attachCreatedRunId = typeof argv['attach-created'] === 'string'
    ? argv['attach-created'].trim()
    : '';
  if (attachCreatedRunId && !((executorMode === 'attended' && runtimeOwnerKind === 'session') || (executorMode === 'detached' && runtimeOwnerKind === 'process'))) {
    console.error('[goal-phase-runtime] BLOCKER: --attach-created owner/transport 不匹配');
    return 1;
  }
  if (attachCreatedRunId && argv.resume) {
    console.error('[goal-phase-runtime] BLOCKER: --attach-created 与 --resume 互斥');
    return 1;
  }
  if (executorMode === 'attended' && !options.executor && !options.sessionHandoff) {
    console.error(
      '[goal-phase-runtime] BLOCKER: attended runtime 必须由 host bridge 注入 executor；' +
        '协议读写只允许由 goal-mode-entry 承担。',
    );
    return 1;
  }
  const attendedExecutor = executorMode === 'attended' ? options.executor ?? new AttendedGoalPhaseExecutor(async () => { throw new Error('nonresident executor must yield before callback'); }) : null;

  // `--detach`: fork the real run into the background and return immediately so a
  // blocking host shell (e.g. chrys TUI shell tool) is not held for the whole run.
  // The spawned child carries `--detached-child` and runs this same main() normally.
  if (argv.detach && !argv['detached-child']) {
    return await runDetachLauncher(argv, options.conditionWait?.runProbe);
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
    return 0;
  }

  const manifestArgv = toManifestCliArgv(argv);
  const layout = resolveRuntimeLayout(options, argv);
  const { projectRoot, frameworkRoot } = layout;
  // plan 6fd6c8c1 §4.3.2：**共同授权入口**——后台 --detach（父进程已转换成
  // --authorize-autonomy 透传）、supervisor 的同式重启、会话 --authorize-autonomy 都落到
  // 同一个 authorization 输入。--detached-child 只是运输标记，本身不授权。
  const entryAuthorization = resolveEntryAuthorization(options, argv);

  // f9c2e6b4 t4：**fresh 才读源文件**——resume 一律只认 manifest 里已冻结的 requirement，
  // 这样"权威需求文件可长期复用"与"旧内容绝不悄悄进新 run"同时成立。
  // 位置：projectRoot 定下之后（相对路径按它解析）、manifest 构建之前——
  // 下游看到的就是最终值，不存在第二个真值来源。
  // resume **显式拒绝** --requirement-file，避免静默忽略显式输入：
  // resume 只认已冻结的 requirement，悄悄忽略一个用户明确给了的输入是最坏的形态。
  if (rejectsResumeRequirementFile(argv)) return 2;
  // plan a2f7c9e4 §3.7：返修诊断材料按原始参数判合法（readRepairNotes）；读一次留在本进程，只注入返修窗口的候选段之后。
  // 判在下方"显式 --resume 改起后继"之前：起后继时材料随本次调用进入后继。
  let repairNotes: { file: string; text: string } | null = null;
  try {
    repairNotes = readRepairNotes(argv, projectRoot);
  } catch (error) {
    console.error(`[goal-runner] BLOCKER: ${(error as Error).message}`);
    return 2;
  }
  if (repairNotes) console.log(`[goal-runner] 返修诊断材料：${repairNotes.file}（只进返修窗口提示词，标为驱动方假设、非需求）`);
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
      return 2;
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
    return 1;
  }

  // plan d7f3a9c4 t1：--adapter-model CLI 值归一 + fail-fast 校验（trim/非空/≤128/无控制
  // 字符；不做模型名白名单）。raw boolean 裸旗标（minimist 置 true）也拒绝。
  let cliAdapterModel: string | undefined;
  try {
    cliAdapterModel = normalizeAdapterModelCliValue(argv['adapter-model']);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
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
    return 1;
  }

  // plan 4e6fb3b6 §7.3：接续决策在选择入口、生成出生范围之前执行。显式旗标原样走；其余按决策改写入口：
  // 重新接入 = 恢复（有正式开始）或附着（启动即失败），起后继 = 以决策给出的来源与承接目标出生，保持停止 = 不新建 run、不写事件。
  // `plainContinuation` 是去掉显式旗标后的同一决策，恢复守卫据此判断"这次恢复是不是重新接入"。
  const launchFeature = (() => {
    try { return resolveRawRunInput(argv as unknown as Record<string, unknown>, projectRoot).feature; } catch { return undefined; /* 下方同一解析会如实报错 */ }
  })();
  if (!argv.resume && !attachCreatedRunId && !argv['dry-run'] && !normalizeSupersedeTargets(argv.supersede).length && launchFeature) {
    const next = designDeliveryNextStep({ projectRoot, frameworkRoot, feature: launchFeature, ...resolveDesignDeliveryRequest({ ...argv, requirement: argv['requirement-file'] ? undefined : argv.requirement }, projectRoot) });
    if (next) return new GoalPhaseRuntime(options).run();
  }
  const publicationResume = options.sessionHandoff && typeof argv.resume === 'string' && launchFeature
    ? (() => {
        const original = loadGoalManifestFromRun(projectRoot, String(argv.resume), { feature: launchFeature });
        return pendingPublishedDesignRepair(projectRoot, path.resolve(projectRoot, original.report_dir));
      })() : null;
  const plainContinuation: RunContinuationDecision | null = publicationResume
    ? { kind: 'rejoin', explicit: true, runId: String(argv.resume), started: true, reason: 'finish the existing published design transaction before deciding continuation' }
    : !argv['dry-run'] && launchFeature
    ? decideLaunchContinuation(argv, projectRoot, launchFeature, {
        plain: true, frameworkRoot, requirementSources: manifestArgv.requirement_source_files, attended: executorMode === 'attended',
        ...(options.conditionWait?.runProbe ? { runProbe: options.conditionWait.runProbe } : {}),
      })
    : null;
  // plan 9c3d7e1a §5.3：显式 --resume 也经同一恢复判断；判为起后继时去掉恢复旗标，下面按接续决策的"起后继"出生。
  if (resumeTurnsIntoSuccessor(argv, plainContinuation)) {
    console.log(`[goal-runner] --resume ${String(argv.resume)} 改为起后继（同一恢复判断）`);
    delete argv.resume;
    delete argv['force-resume'];
  }
  // plan b7d2e9f4 §3.3：同一恢复判断的第二种改写——目标 run 从未正式开始（只有出生事件）时，显式 --resume 改为附着同一 run。
  // 保留 --force-resume：explicitTakeover 在下方读取，过期 session owner（orphaned_session）只靠显式接管拿回。
  // detach 父进程透传原始参数，由子进程在这里改写，写出 run_start 即握手。
  if (
    argv.resume && plainContinuation?.kind === 'rejoin' && plainContinuation.started === false
    && plainContinuation.runId === String(argv.resume).trim()
  ) {
    console.log(`[goal-runner] --resume ${plainContinuation.runId} 改为附着（该 run 尚未正式开始；同一恢复判断）`);
    delete argv.resume;
    attachCreatedRunId = argv['attach-created'] = plainContinuation.runId;
  }
  const explicitContinuation = Boolean(argv.resume || attachCreatedRunId || normalizeSupersedeTargets(argv.supersede).length || argv.force);
  const continuationDecision: RunContinuationDecision | null = explicitContinuation ? null : plainContinuation;
  if (continuationDecision) {
    const requestedRunId = typeof argv['run-id'] === 'string' ? argv['run-id'].trim() : '';
    if (continuationDecision.kind === 'hold') {
      console.error(`[goal-runner] ${continuationDecision.guidance}`);
      return 1;
    }
    if (continuationDecision.kind === 'rejoin') {
      if (requestedRunId && requestedRunId !== continuationDecision.runId) {
        console.error(`[goal-runner] BLOCKER: 本次请求指定了新 run ${requestedRunId}，但同一任务的未终局 run ${continuationDecision.runId} 应重新接入（${continuationDecision.reason}）`);
        return 1;
      }
      // 重新接入不重读需求：run 里冻结的需求已经包含本次文本（否则决策会判需求增量、走后继）。
      delete argv.requirement;
      delete argv['requirement-file'];
      delete manifestArgv.requirement;
      delete manifestArgv.requirement_source_files;
      if (continuationDecision.started) argv.resume = continuationDecision.runId;
      else attachCreatedRunId = argv['attach-created'] = continuationDecision.runId;
      console.log(`[goal-runner] 重新接入：${continuationDecision.reason}`);
    } else if (continuationDecision.kind === 'successor') {
      argv.supersede = [...continuationDecision.targets];
      console.log(`[goal-runner] 起后继：${continuationDecision.reason}；承接 ${continuationDecision.targets.join('、')}`);
    }
  }

  const cfg = loadFrameworkConfig(projectRoot);
  let workflow = (injectedWorkflowResolver ?? resolveWorkflowSpec)(
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
    return 1;
  }
  const dryRunMode = rawRunInput.dryRun;

  let manifest: GoalManifest;
  if (attachCreatedRunId) {
    manifest = loadGoalManifestFromRun(projectRoot, attachCreatedRunId, {
      // plan b7d2e9f4 返修 r1：与 resume 分支同源——feature 可能只由 --manifest 提供（resolveRawRunInput 已解析）。
      feature: rawRunInput.feature,
      featuresDir,
    });
    // D2.5 delete-list #8: the detached attach-created guard required a *verified scoped
    // successor* lineage, which is unsatisfiable once the successor path is gone. Birth
    // completeness is carried by assertGoalRunAttachable + inspectGoalRunCreation (plan §7.2,
    // where the surrendered accuracy — the successor-lineage dimension — is recorded).
  } else if (argv.resume) {
    if (!argv.manifest && !argv.feature) {
      console.error('[goal-runner] BLOCKER: --resume 须配 --feature 或 --manifest');
      return 1;
    }
    const originalRun = loadGoalManifestFromRun(projectRoot, String(argv.resume), { feature: rawRunInput.feature, featuresDir });
    manifest = argv.manifest && !manifestFileRepeatsRun(projectRoot, String(argv.manifest), originalRun, featuresDir)
      ? loadGoalManifestFile(String(argv.manifest), projectRoot, { featuresDir, runId: String(argv.resume).trim() }) : originalRun;
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
        },
      },
      { projectRoot, featuresDir, dryRun: dryRunMode },
    );
  }

  if (argv.resume || attachCreatedRunId) workflow = workflowForExistingRun(workflow, manifest, frameworkRoot, projectRoot);
  const requestedSupersedeTargets = normalizeSupersedeTargets(argv.supersede);
  // plan b2d7f4e9 §3.2：`--supersede` 必须点名一个 run。feature 载体（无 run 的完成）没有 run 可 supersede——
  // 它的完成后修正是追加 feature 范围修订后起新 run；空值不得被静默当成 fresh run。
  if (Object.prototype.hasOwnProperty.call(argv, 'supersede') && !requestedSupersedeTargets.length) {
    console.error('[goal-runner] BLOCKER: --supersede 必须指向一个已存在的 run；无 run 的 feature 完成后修正请先按当前输入追加 feature 范围修订，再起新 run（不带 --supersede）');
    return 1;
  }
  let requestedExecutionScope = !argv.resume && !attachCreatedRunId && !requestedSupersedeTargets.length
    // D1.3：出生范围 = 转交时 feature 的**有效**范围（有冻结记录时不重算候选）——
    // 与 `--prepare-run` 入口**同一个** `resolveBirthExecutionScope`，不是第三条路径。
    // D1.3：出生范围**一律**过统一解析——`manifest.execution_scope ?? ...` 的写法会让
    // 「manifest 自带范围」跳过 feature 记录的转交 / 候选漂移 / provenance 检查（第一轮阻断 3）。
    // successor（--supersede / --rebaseline-to）不走这里：它要先核合法源 run、再在 supersede 上下文里
    // 按最终需求重解析（plan b2d7f4e9 §3.2，见下方 requirement 合并之后的 `resolveSuccessorExecutionScope`）。
    ? resolveBirthScopeForManifest(projectRoot, manifest, workflow, frameworkRoot)
    : undefined;
  if (requestedExecutionScope && workflow.schema_version !== '1.2') throw new Error('[execution-scope] fresh scoped run requires workflow 1.2');

  // T3①：自动后继的唯一 manifest 写入点继承源 run 的合同与指纹账本（预算按本交付周期的有效值覆盖，plan a2f7c9e4 §3.1）。
  // 审计权仍来自后续 fresh run 的 supersede 事件；这里仅把启动约束和防震荡
  // 指纹带入新 manifest，不能单独让旧 run 的阶段 PASS 跨 run 生效。
  // e9d4b7a3 t1（二轮 review P1）：`supersedeSourceRequirement` 只在此块成功加载源后
  // 赋值——合并单点（applyManifestCliOverrides 之后）以此判断是否处于 supersede 上下文。
  // **增量文本只取 CLI 解析结果**（explicitRequirementIncrementText）——绝不读
  // manifest 字段（--manifest 自带文本没有增量授权，inherit 后字段值更不可信）。
  let supersedeSourceRequirement: string | undefined;
  // plan c4e8a1f7 T2（评审 P1 三轮修复）：源 run 的需求来源列表（successor 来源重设用）
  let supersedeSourceSourceFiles: string[] | undefined;
  // 批三返修 R3：来源 run 的原始起止——接续决策起的后继只容忍"原样重放"的 --start/--end。
  let supersedeSourceBounds: { start: string; end: string } | undefined;
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
        supersedeSourceBounds = { start: String(source.start_phase), end: String(source.end_phase) };
        const completedBoundary = resolveDeliveryCycleBoundary({ projectRoot, featuresDir, feature: manifest.feature,
          frameworkRoot, seedTargets: requestedSupersedeTargets, currentEvents: [] });
        manifest = inheritSuccessorManifest(manifest, source, { round: [], drift: [] }, { newDeliveryCycle: completedBoundary === source.run_id });
      } catch (error) {
        // 后继 manifest 是新 run 唯一写入点的启动合同；继承失败不能静默退回默认
        // manifest，否则 --supersede 会悄悄刷新 end/预算/能力门。目标审计事件仍由
        // 下方既有校验负责，但本次启动先 fail-closed，不制造合同不完整的后继。
        throw new Error(
          `[goal-runner] BLOCKER: 无法构造 supersede 后继 manifest（源=${sourceRunId}）：` +
            `${(error as Error).message}` +
            '（--supersede 只接已存在的 run；无 run 的 feature 完成后修正请先追加 feature 范围修订，再起新 run）',
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
      return 1;
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
    // plan 4e6fb3b6 批三返修 R1 / 最终评审返修：与有人在场入口、接续决策同一个函数（deriveSuccessorRequirement）。
    // 没有新内容时保留源合同全文——--override-manifest 先把需求替换成了本次文本，不恢复就会丢掉源里的历史增量；
    // 本次文本已是合并格式时同样只取源还没有的部分接到源全文后面（不再因带标记而保持原值：无 override 时那会丢掉新增内容）。
    manifest.requirement = deriveSuccessorRequirement(supersedeSourceRequirement, explicitRequirementIncrementText);
    if (manifest.requirement !== supersedeSourceRequirement) {
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
      cliPin: launchModelPin(argv, manifest.adapter!, projectRoot, manifest.adapter_model_pin),
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
      return 1;
    }
    if (finalPin.pin) {
      manifest.adapter_model_pin = !argv.resume && !attachCreatedRunId && !manifest.successor_of ? freezeModelPin(finalPin.pin, projectRoot) : finalPin.pin;
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
    cliVisualProvider = resolveVisualProviderCliSelection(argv, projectRoot, manifest.visual_provider_pin);
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
      return 1;
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
  const goalTrack = manifest.execution_scope || workflow.schema_version === '1.2' ? 'full' : resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, manifest.feature, manifest.run_id));
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
      return 1;
    }
  }
  if (!argv.resume && !attachCreatedRunId && workflow.schema_version === '1.2') {
    // plan b2d7f4e9 §3.2 第 2 步：successor 在已核合法的 supersede 上下文里按**最终**需求（上方合并之后）
    // 重解析出生范围——义务按当前输入重派生、既往证据经同一核验复用；feature 记录只作血缘核对。
    // 这一步在 createGoalRun 之前：拒绝即不建 run、不写审计、不动转交记录。
    if (manifest.successor_of) {
      try {
        requestedExecutionScope = resolveSuccessorExecutionScope(projectRoot, manifest.feature, workflow, frameworkRoot, manifest.requirement, manifest.successor_of, manifest.fidelity);
      } catch (error) {
        throw new Error(`[goal-runner] BLOCKER: successor 出生范围无法解析（源=${manifest.successor_of}）：${(error as Error).message}`);
      }
    }
    // D1.3（第二轮阻断 1）：现代 fresh/detached 路径**无条件采用**统一出生解析的结果。
    // `??=` 会让 `--manifest` 自带的旧范围留下来，随后用错误的出生范围建 run，而转交登记
    // 要到 `createGoalRun` 之后才因指纹失配报错——顺序已经晚了。自带范围与解析结果不同即拒。
    // successor 的 manifest 带着从源 run 继承来的旧出生范围，被重解析结果替换是本意，不比对。
    if (requestedExecutionScope) {
      if (!manifest.successor_of && manifest.execution_scope
        && executionScopeFingerprint(validateExecutionScope(manifest.execution_scope)) !== executionScopeFingerprint(requestedExecutionScope)) {
        throw new Error('[execution-scope] manifest 自带的出生范围与统一出生解析结果不一致——请去掉 --manifest 里的 execution_scope，或按 correction / successor 路径处理');
      }
      manifest.execution_scope = requestedExecutionScope;
    }
    if (!manifest.execution_scope?.phase_chain.length) throw new Error('[execution-scope] empty scope: validate existing completion without a new run');
    // plan 4e6fb3b6 §7（批三返修 R3）：接续决策起的后继由重解析的出生范围定链。只容忍能确认是原请求重放的起止
    // （与来源 run 的原始起止相同）；本次给出不同的起止，后继的出生解析没有按起止缩窄范围的入口——明确拒绝，不静默覆盖。
    if (continuationDecision?.kind === 'successor') {
      const changed = successorBoundsConflicts(
        { start_phase: supersedeSourceBounds?.start, end_phase: supersedeSourceBounds?.end },
        { ...(typeof argv.start === 'string' ? { start: argv.start } : {}), ...(typeof argv.end === 'string' ? { end: argv.end } : {}) },
      );
      if (changed.length) throw new Error(successorBoundsRefusal(continuationDecision.reason, changed));
    } else if ((typeof argv.start === 'string' && argv.start !== manifest.execution_scope.phase_chain[0]) || (typeof argv.end === 'string' && argv.end !== manifest.execution_scope.phase_chain.at(-1))) throw new Error('[execution-scope] start/end must match the resolved scope');
    manifest.start_phase = manifest.execution_scope.phase_chain[0];
    manifest.end_phase = manifest.execution_scope.phase_chain.at(-1)!;
    manifest.chain_override = [...manifest.execution_scope.phase_chain];
  }
  // D2 §4.2.3: everything below reads the EFFECTIVE scope (birth + applied revisions); only the
  // birth-value projections that guard manifest identity keep reading manifest.execution_scope.
  // The birth scope, validated once: every "what did a revision revoke" projection derives from it.
  const birthScope = manifest.execution_scope ? validateExecutionScope(manifest.execution_scope) : undefined;
  const effectiveBirthScope = manifest.execution_scope
    ? applyScopeRevisions(validateExecutionScope(manifest.execution_scope), loadAuthoritativeEvents(path.join(projectRoot, manifest.report_dir, 'events.jsonl')))
    : undefined;
  // Completion includes the real reused methods after pending work has become empty.
  // Keep the immutable birth chain fallback for a request satisfied only by definition inputs.
  // B3: revisions also retarget the completion projection, so this remains a let.
  let fullWorkflowChain = effectiveBirthScope ? executionCompletionPhases(effectiveBirthScope) : featurePhasesFromWorkflow(workflow, goalTrack);
  const requestedChain = effectiveBirthScope
    ? [...(effectiveBirthScope.phase_chain.length ? effectiveBirthScope.phase_chain
        : fullWorkflowChain.length ? fullWorkflowChain
        : effectiveBirthScope.completion_target === 'request'
          ? validateExecutionScope(manifest.execution_scope!).phase_chain : effectiveBirthScope.phase_chain)]
    : attachedCreation?.state === 'complete'
    ? [...attachedCreation.event.phase_chain]
    : resolveAutoChain(
        workflow,
        manifest.start_phase,
        manifest.end_phase,
        manifest.chain_override,
        goalTrack,
      );
  // Receipt-derived legacy fidelity recovery changes which phases must actually execute. Resolve
  // that fact before a fresh modern run is born, then freeze the expanded chain in manifest and
  // run_created. Later resume/attach paths may validate this birth fact, but never recompute it.
  const freshLegacyFidelity = !argv.resume && !attachCreatedRunId
    ? loadInertLegacyFidelityIntentSsot(projectRoot, manifest.feature)
    : null;
  const actualBirthChain = resolveActualGoalPhaseChainAtBirth({
    requestedChain,
    fullWorkflowChain,
    requiresLegacyFidelityRecovery: !manifest.execution_scope && freshLegacyFidelity !== null,
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
    return 1;
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
  // plan 4e6fb3b6 §7.3：接续决策已选好路（孤儿 run 与失败 run 都在决策里被重新接入、承接或保持停止）时消费决策，
  // 这两道守卫只对显式旗标的调用照现状生效。
  if (!argv.resume && !attachCreatedRunId && !dryRun && !continuationDecision) {
    if (guardOrphanedFeatureRun(projectRoot, featuresDir, manifest.feature, Boolean(argv.force))) return 1;
    const continuation = evaluateFreshRunContinuation({
      projectRoot,
      manifest,
      forceFresh: Boolean(argv.force),
    });
    if (!continuation.allowed) {
      console.error(`[goal-runner] BLOCKER: ${continuation.reason}`);
      return 1;
    }
  }

  runtimeSessionLogs = !!options.sessionHandoff;
  let sessionRequest = options.sessionHandoff ? readSessionExecution(path.resolve(projectRoot, manifest.report_dir), options.sessionHandoff.requestPath) : null;
  let acceptedSessionInvokeId: string | undefined;
  const incompleteSessionStart = options.sessionHandoff ? undeliveredSessionInvocation(loadAuthoritativeEvents(path.resolve(projectRoot, manifest.report_dir, 'events.jsonl'))) : undefined;
  const sessionControl = (sessionRequest || incompleteSessionStart) ? readRunControl(path.resolve(projectRoot, manifest.report_dir), manifest.run_id) : null;
  const sameSessionWindow = sessionRequest && sessionControl?.owner && sessionControl.current_epoch === sessionRequest.request.context.owner.epoch
    && sessionControl.owner.owner_id === sessionRequest.request.context.owner.owner_id && ['active', 'orphaned_session'].includes(sessionControl.owner.state);
  acquireGoalLocks(projectRoot, featuresDir, manifest.feature, {
    runId: manifest.run_id,
    reportDir: manifest.report_dir,
    runMode: dryRun ? 'dry' : 'authoritative',
    explicitTakeover: Boolean(argv.resume || attachCreatedRunId) && forceResume,
    ownerKind: runtimeOwnerKind,
    ...(incompleteSessionStart && sessionControl?.owner && sessionControl.current_epoch === incompleteSessionStart.owner_epoch
      && sessionControl.owner.owner_id === incompleteSessionStart.owner_id && ['active', 'orphaned_session'].includes(sessionControl.owner.state)
      ? { resumeSessionToken: { run_id: manifest.run_id, owner_id: incompleteSessionStart.owner_id!, epoch: incompleteSessionStart.owner_epoch! } } : {}),
    ...(sessionRequest && sameSessionWindow && (!acceptedSessionReport(path.resolve(projectRoot, manifest.report_dir), sessionRequest) || sessionValidationOnlyEligibility(loadAuthoritativeEvents(path.resolve(projectRoot, manifest.report_dir, 'events.jsonl')))) ? { sessionRequest } : {}),
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
  const advanceExpiredSession = (): void => {
    if (!runControl) return;
    releaseRunOwner(runControl.dir, runControl.token);
    const control = ensureRunControl(runControl.dir, manifest.run_id);
    const acquired = casAcquireRunOwner(runControl.dir, manifest.run_id, control.current_epoch, { kind: 'session', owner_id: featureLock!.ownerId, lease_ms: options.leaseMs ?? 60000 });
    if (!acquired.ok) throw new Error('[session-handoff] expired window CAS changed');
    runControl = { dir: runControl.dir, token: acquired.token };
  };
  try {
  if (incompleteSessionStart?.invoke_id && options.sessionHandoff && runControl && !sessionRequest) {
    const runDir = path.resolve(projectRoot, manifest.report_dir);
    const original = executionRequestForInvoke(runDir, incompleteSessionStart.invoke_id);
    const history = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
    if (original && original.request.context.owner.owner_id === runControl.token.owner_id
      && original.request.context.owner.epoch === runControl.token.epoch && original.request.context.runId === manifest.run_id
      && original.request.context.feature === manifest.feature && original.request.issued_at === incompleteSessionStart.ts
      && !history.some(event => event.invoke_id === incompleteSessionStart.invoke_id
        && ['agent_process_bound', 'harness_start', 'phase_write_observed', 'agent_invoke_end'].includes(event.type ?? ''))) {
      const request = original.request;
      const issued = issueSessionExecution({ context: request.context, invokeId: request.invoke_id,
        purpose: request.purpose, gateTimeoutMs: request.gate_timeout_ms, cleanupReserveMs: request.cleanup_reserve_ms,
        preSnapshot: request.pre_snapshot, writeBoundary: request.write_boundary,
        snapshotOptions: request.snapshot_options, emit: goalEvents.emit });
      preserveSessionOwner = true; options.sessionHandoff.onRequest(issued); return 3;
    }
  }
  if (incompleteSessionStart?.ts && typeof incompleteSessionStart.effective_timeout_ms === 'number'
    && incompleteSessionStart.effective_timeout_ms > 0
    && Date.parse(incompleteSessionStart.ts) + incompleteSessionStart.effective_timeout_ms <= Date.now()) {
    goalEvents.emit({ type: 'agent_invoke_end', phase: incompleteSessionStart.phase, invoke_id: incompleteSessionStart.invoke_id,
      command: 'phase_execute_request', exit_code: 1, timed_out: true, kill_reason: 'agent_timeout',
      duration_ms: Math.max(0, Date.now() - Date.parse(incompleteSessionStart.ts)),
      effective_timeout_ms: incompleteSessionStart.effective_timeout_ms, detail: 'issuance interrupted before commit; no execution request was delivered' });
    advanceExpiredSession();
  }
  if (sessionRequest && options.sessionHandoff && runControl && !acceptedSessionReport(path.resolve(projectRoot, manifest.report_dir), sessionRequest)
    && runControl.token.epoch !== sessionRequest.request.context.owner.epoch) {
    if (!options.sessionHandoff.report && forceResume) {
      const resigned = resignSessionExecution(runControl.dir, sessionRequest, runControl.token, goalEvents.emit);
      sessionRequest = resigned;
      if (sessionExecutionDeadlineMs(resigned.request) > Date.now()) {
        preserveSessionOwner = true;
        options.sessionHandoff.onRequest(resigned);
        return 3;
      }
    } else throw new Error('[session-handoff] stale owner result cannot be consumed after takeover');
  }
  if (sessionRequest && options.sessionHandoff && !acceptedSessionReport(path.resolve(projectRoot, manifest.report_dir), sessionRequest)) {
    const expired = sessionExecutionDeadlineMs(sessionRequest.request) <= Date.now();
    if (options.sessionHandoff.report || expired) {
      // An incomplete receipt transaction still belongs to this signed window.
      // I/O failure must not release its owner and strand a valid retry.
      preserveSessionOwner = true;
      const accepted = acceptSessionExecution({ runDir: path.resolve(projectRoot, manifest.report_dir), issued: sessionRequest,
        report: options.sessionHandoff.report ?? uncommittedSessionReport(path.resolve(projectRoot, manifest.report_dir), sessionRequest)
          ?? { status: 'failed', phase: sessionRequest.request.context.phase, details: 'runtime execution deadline expired; no executor report received' }, emit: goalEvents.emit });
      if (!accepted.duplicate) acceptedSessionInvokeId = sessionRequest.request.invoke_id;
      preserveSessionOwner = false;
      if (expired && runControl) {
        advanceExpiredSession();
      }
    }
  }
  if (!argv.resume && !attachCreatedRunId) {
    freshCreation = createGoalRun({
      projectRoot,
      frameworkRoot,
      manifest,
      chain: actualBirthChain,
      ...(rebaselineRequest ? { rebaselineFromRunId: rebaselineRequest.sourceRunId } : {}),
      forceFresh: Boolean(argv.force),
      ...(continuationDecision ? { continuation: continuationDecision } : {}),
    });
    // D1.3 转交登记：createGoalRun 成功之后立刻写，理由同 `--prepare-run` 入口
    //（出生未完成时 feature 侧不得留下指向不存在 run 的指针）。
    // 这里只登记首次 feature→run 转交；successor 的再转交要以已写入的 supersede 审计为前提，
    // 在下方审计事件之后登记（plan b2d7f4e9 §3.2 第 4 步）。
    if (manifest.execution_scope && !manifest.successor_of) {
      try {
        registerFeatureScopeTransfer({
          projectRoot, feature: manifest.feature, runId: manifest.run_id,
          transferredScopeFingerprint: executionScopeFingerprint(validateExecutionScope(manifest.execution_scope)),
        });
      } catch (error) {
        throw new Error(`[execution-scope] feature 范围转交登记失败：${(error as Error).message}`);
      }
    }
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
  const userContinued = explicitUserContinuation(forceResume, startupEvents);
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

  if (options.sessionHandoff) {
    const runDir = path.resolve(projectRoot, manifest.report_dir);
    const pendingPublication = pendingPublishedDesignRepair(projectRoot, runDir);
    if (pendingPublication) {
      await runUnattendedDesignRepair({ projectRoot, frameworkRoot, feature: manifest.feature, phase: pendingPublication.phase,
        runId: manifest.run_id, requirement: manifest.requirement, reportDir: manifest.report_dir, brief: pendingPublication.brief,
        signature: pendingPublication.signature, heldFeatureLock: featureLock,
        runtimeWrites: featureLock ? [path.relative(projectRoot, featureLock.path)] : [], emit: goalEvents.emit,
        registerLockRelease: release => { designRepairLockRelease = release; },
        recordEventLines: () => { const lines: Array<{ file: string; line: string }> = []; eventLineRecorder = (file, line) => lines.push({ file, line });
          return () => { eventLineRecorder = null; return lines; }; },
        invoke: async purpose => {
          const issued = acceptedSessionInvokeId ? sessionExecutionForInvoke(runDir, acceptedSessionInvokeId) : readSessionExecution(runDir);
          const received = issued && acceptedSessionReport(runDir, issued);
          if (!issued || !received || issued.request.purpose !== purpose || issued.request.context.runId !== manifest.run_id
            || issued.request.context.feature !== manifest.feature) return { started: false, ok: false, status: 'waiting', detail: '原发布事务缺当前准确request的真实交回；保留草稿，恢复该原件后接原设计单元。' };
          const original = received.event.handoff_report
            ? readHandoffMaterial<{ post_snapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> }>(runDir, received.event.handoff_report) : undefined;
          return { started: true, ok: invocationCompleted({ ...received.event, status: received.report.status, exitCode: received.event.exit_code }),
            invokeId: issued.request.invoke_id, status: received.report.status, detail: received.report.details ?? received.report.status,
            ...(purpose === 'questioning' ? { output: received.report.details ?? '' } : {}),
            preSnapshot: issued.request.pre_snapshot ?? undefined, postSnapshot: original?.post_snapshot };
        },
      });
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
    fidelityTransitionFields: new Set([...fidelityTransitionFields, ...(cliAdapterModel !== undefined ? ['adapter_model_pin'] : []),
      ...(cliVisualProvider !== undefined ? ['visual_provider_pin'] : [])]),
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
  if (manifestDrift.rebaseApplied) {
    writeGoalManifest(manifest, projectRoot);
    goalEvents.emit({ type: 'manifest_identity_rebase', to_fields: computeManifestIdentityFields(manifest),
      authorized_by: manifestDrift.rebaseAuthorizedBy, changed_fields: manifestDrift.changedFields });
  }

  // 【已删除 · 收口刀】legacy checkpoint 聚合迁移分支与 `vision_checkpoint_schema_migrated`
  // 事件——checkpoint 退出基线角色后无 schema 迁移语义。

    const { adapterStatus } = loadFrameworkConfigWithSources(projectRoot);
    const resolvedProfile = loadResolvedProfile(projectRoot, cfg, frameworkRoot);
    const provenance = resolveAdapterProvenance(
      {
        adapter: argv.adapter ? String(argv.adapter) : undefined,
        manifest: argv.manifest ? String(argv.manifest) : undefined,
        resume: argv.resume ? String(argv.resume) : undefined,
      },
      adapterStatus,
    );
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
        frameworkRoot,
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
    // D2 §4.2.3: `manifest.phase_chain` deliberately keeps its BIRTH value (identity projection),
    // so it must not drive execution once a revision has landed — a [spec]-born run would keep
    // executing [spec] forever. `requestedChain` is already the effective chain; use it whenever
    // this run has a scope, and fall back to the frozen manifest chain only for legacy runs.
    const frozenChain = manifest.execution_scope
      ? [...requestedChain]
      : manifest.phase_chain ? [...manifest.phase_chain] : [...requestedChain];
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
    // D2 §4.2.3: `chain` is the execution truth and must be re-targetable when a revision lands,
    // so it is a `let` and gets reassigned at the revision boundary (reassigning the derived
    // frozenChain alone would never switch the loop).
    let chain = modernBirth
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

    // goal-fakepass-hardening t8：--supersede <run_id>（可重复）——显式废弃 HALTED/PARTIAL
    // 旧 run，写审计事件；completion verify 只认经审计的 supersede（自报 Set 不生效）。
    const supersededRunIds: string[] = ([] as string[])
      .concat(argv.supersede ?? [])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    // plan 4e6fb3b6 批三返修 R2：已出生、但在 run_start 之前停下的后继被附着时，幂等补完出生收尾——承接目标按当时现场重新算出
    // （来源 = manifest.successor_of），剔除本后继已经审计过的；随后照旧走预算血缘与周期边界、目标审计与身份核对、范围转交登记。
    const attachedSuccessorCatchUp = Boolean(attachCreatedRunId && manifest.successor_of && !dryRun && supersededRunIds.length === 0);
    if (attachedSuccessorCatchUp) {
      const audited = new Set(loadEventsJsonl(path.join(projectRoot, manifest.report_dir, 'events.jsonl'))
        .filter(e => e.type === 'supersede' && (e as { superseding_run_id?: unknown }).superseding_run_id === manifest.run_id)
        .map(e => String((e as { target_run_id?: unknown }).target_run_id)));
      supersededRunIds.push(...successorCatchUpTargets(projectRoot, manifest.feature, manifest.run_id, manifest.successor_of!)
        .filter(target => !audited.has(target)));
      if (supersededRunIds.length) console.log(`[goal-runner] 附着的后继补完承接：${supersededRunIds.join('、')}`);
    }
    // Read-only activity and original-request audit; only an explicit user timestamp limits new work.
    const activityStartEvents = loadAuthoritativeEvents(path.join(projectRoot, manifest.report_dir, 'events.jsonl'));
    // A verified completed delivery defines whether a genuinely new request can carry a new deadline.
    const cycleBoundary = supersededRunIds.length > 0
      ? resolveDeliveryCycleBoundary({
          projectRoot, featuresDir, feature: manifest.feature, frameworkRoot,
          seedTargets: supersededRunIds, currentEvents: activityStartEvents,
        })
      : undefined;
    const sessionStartMs = Date.now();
    // 批二 review R1：本会话从这里开始计时（含启动期探测）。run_start 与 run_start 之前的提前退出 run_end 都带上它，
    // 会话分段据此把 run_start 之前的启动耗时计入已用时长（旧事件流无此字段，计算不变）。
    const sessionStartedAtIso = new Date(sessionStartMs).toISOString();
    // Original model substitutions are audited across the same request lineage.
    const ancestorEvents = readSupersededAncestorRuns({ projectRoot, featuresDir, feature: manifest.feature,
      seedTargets: [...new Set([...supersededRunIds, ...(manifest.successor_of ? [manifest.successor_of] : [])])], currentEvents: activityStartEvents })
      .flatMap(run => run.events);
    const explicitDeadline = workUnitExecutionInputs(manifest, undefined, projectRoot).user_deadline_at;
    const remainingUserMs = (): number => explicitDeadline ? Date.parse(explicitDeadline) - Date.now() : Infinity;

    // The canary is a bounded tool; an explicit user deadline can shorten its own timeout.
    let canaryHandoffIssued = false;
    const priorCanary = options.sessionHandoff && !argv['refresh-vision-probe']
      ? [...loadAuthoritativeEvents(path.join(projectRoot, manifest.report_dir, 'events.jsonl'))].reverse().find(event =>
        event.type === 'agent_invoke_start' && (event as { purpose?: string }).purpose === 'vision_canary') : undefined;
    const recordedCanary = priorCanary?.invoke_id ? sessionExecutionForInvoke(path.resolve(projectRoot, manifest.report_dir), priorCanary.invoke_id) : null;
    const canarySession = recordedCanary?.request.context.adapter === (manifest.adapter ?? 'generic')
      && recordedCanary.request.context.adapterModel === adapterModelBinding(manifest.adapter_model_pin) ? recordedCanary : null;
    const canarySequence = () => loadAuthoritativeEvents(path.join(projectRoot, manifest.report_dir, 'events.jsonl'))
      .filter(event => event.type === 'agent_invoke_start' && (event as { purpose?: string }).purpose === 'vision_canary').length + 1;
    const canaryInvokeId = canarySession?.request.invoke_id ?? `vision-canary-p${canarySequence()}`;
    const canaryDir = path.join(projectRoot, manifest.report_dir, 'phases', 'vision-canary', canaryInvokeId);
    const canaryKeyPath = path.join(canaryDir, 'answer-key.json');
    const canaryPromptExecutor = options.sessionHandoff || attendedExecutor ? async (text: string, key: CanaryAnswerKey) => {
      const existing = canarySession ? acceptedSessionReport(canarySession.request.context.runDir, canarySession) : null;
      if (existing) return { status: existing.report.status, exitCode: existing.event.exit_code ?? (existing.report.status === 'failed' ? 1 : 0), stdout: existing.report.details ?? '', stderr: '',
        timed_out: existing.event.timed_out ?? false, duration_ms: existing.event.duration_ms ?? 0, command: 'phase_execute_request' } as Awaited<ReturnType<InvokeAgentFn>>;
      const timeoutMs = Math.min(VISION_CANARY_TIMEOUT_MS, remainingUserMs());
      if (!(timeoutMs > 0)) {
        return { exitCode: 1, stdout: '', stderr: '用户明示时限已到，不启动新视觉工具调用', skipped: true } as Awaited<ReturnType<InvokeAgentFn>>;
      }
      if (!runControl) throw new Error('[vision-canary] actual executor has no run owner');
      fs.mkdirSync(canaryDir, { recursive: true });
      fs.writeFileSync(canaryKeyPath, `${JSON.stringify(key)}\n`, 'utf8');
      const timeoutStart = Date.now();
      const prepared = new GoalPhaseRuntime(options).prepareExecutionContext({ ...workUnitExecutionInputs(manifest, 'vision_canary', projectRoot), runId: manifest.run_id, feature: manifest.feature, workflowId: workflow.name,
        track: goalTrack, chain: [...chain.map(String), 'vision-canary'], phase: 'vision-canary', attemptId: canaryInvokeId,
        owner: { ...runControl.token, kind: runtimeOwnerKind }, projectRoot, frameworkRoot,
        runDir: path.resolve(projectRoot, manifest.report_dir), reportDir: manifest.report_dir, adapter: manifest.adapter ?? 'generic',
        adapterModel: adapterModelBinding(manifest.adapter_model_pin), instruction: `${text}\n将上文规定的原始逐行答卷放入本请求报告的 details；仅读取题图，不读取同目录答案材料。`,
        runtimeFacts: { receiptRequired: false, resume: Boolean(argv.resume), successor: false,
          runBaseSha: resolveRunBaseline(manifest, loadAuthoritativeEvents(path.join(projectRoot, manifest.report_dir, 'events.jsonl'))).baseSha }, childEnv: {} });
      if ('status' in prepared) return prepared as Awaited<ReturnType<InvokeAgentFn>>;
      const context = prepared;
      goalEvents.emit({ type: 'agent_invoke_start', phase: 'vision-canary', chain_phase: String(chain[0]), purpose: 'vision_canary',
        invoke_id: canaryInvokeId, command: 'phase_execute_request', effective_timeout_ms: timeoutMs,
        owner_id: runControl.token.owner_id, owner_epoch: runControl.token.epoch });
      if (options.sessionHandoff) {
        const issued = issueSessionExecution({ context, invokeId: canaryInvokeId, chainPhase: String(chain[0]), purpose: 'vision_canary', timeoutMs,
          gateTimeoutMs: timeoutMs, cleanupReserveMs: 0,
          preSnapshot: null, writeBoundary: null, emit: goalEvents.emit });
        canaryHandoffIssued = true;
        preserveSessionOwner = true;
        options.sessionHandoff.onRequest(issued);
        return { exitCode: 0, stdout: '', stderr: '', skipped: true, command: 'phase_execute_request' } as Awaited<ReturnType<InvokeAgentFn>>;
      }
      const result = await new GoalPhaseRuntime(options).executeExecutor(context, attendedExecutor!);
      goalEvents.emit({ type: 'agent_invoke_end', phase: 'vision-canary', invoke_id: canaryInvokeId, purpose: 'vision_canary',
        chain_phase: String(chain[0]), command: result.command, status: result.status, exit_code: result.exitCode,
        timed_out: result.timed_out, silent_killed: result.silent_killed, skipped: result.skipped,
        provider_session_id: result.provider_session_id, interrupted: result.interrupted, nativeSessionRebuildReason: result.nativeSessionRebuildReason, readonly_enforced: result.readonly_enforced, readonly_diagnostic: result.readonly_diagnostic, completion_observed: result.completion_observed, terminal_failure_observed: result.terminal_failure_observed,
        ...(result.spawn_error ? { spawn_error: result.spawn_error } : {}), duration_ms: Date.now() - timeoutStart });
      return { ...result, stdout: result.details ?? result.stdout, duration_ms: Date.now() - timeoutStart } as Awaited<ReturnType<InvokeAgentFn>>;
    } : undefined;
    const invokeCanaryTransport: InvokeAgentFn = async (plan, cwd, invokeOptions) => {
      if (!(remainingUserMs() > 0)) {
        return { exitCode: 1, stdout: '', stderr: '用户明示时限已到，不启动新视觉工具调用', skipped: true } as Awaited<ReturnType<InvokeAgentFn>>;
      }
      const invocationId = `vision-canary-p${canarySequence()}`;
      goalEvents.emit({ type: 'agent_invoke_start', phase: 'vision-canary', chain_phase: String(chain[0]), purpose: 'vision_canary',
        invoke_id: invocationId, command: plan.label, effective_timeout_ms: invokeOptions?.timeoutMs });
      const result = await (injectedCanaryProbeInvoke ?? invokeAgentHeadless)(plan, cwd, invokeOptions);
      goalEvents.emit({ type: 'agent_invoke_end', phase: 'vision-canary', chain_phase: String(chain[0]), purpose: 'vision_canary',
        invoke_id: invocationId, command: result.command, exit_code: result.exitCode, timed_out: result.timed_out,
        silent_killed: result.silent_killed, skipped: result.skipped, completion_observed: result.completion_observed,
        terminal_failure_observed: result.terminal_failure_observed,
        ...(result.spawn_error ? { spawn_error: result.spawn_error } : {}), duration_ms: result.duration_ms });
      return result;
    };
    const runCanaryWithinBudget = (): ReturnType<typeof runVisionCanaryProbe> => runVisionCanaryProbe({
      projectRoot, frameworkRoot, manifest,
      // plan c4e8a1f7 T1a：canary 复用 session binary（与正式 invoke 同一绝对路径）
      resolvedBinary: sessionBinary?.binary ?? null,
      invokeFn: invokeCanaryTransport,
      ...(canaryPromptExecutor && !injectedCanaryProbeInvoke ? { executePrompt: canaryPromptExecutor,
        answerKeyFn: () => canarySession && fs.existsSync(canaryKeyPath) ? JSON.parse(fs.readFileSync(canaryKeyPath, 'utf8')) as CanaryAnswerKey : generateRandomCanaryAnswerKey(),
        retainMaterials: () => canaryHandoffIssued } : {}),
      timeoutMs: Math.max(1, Math.min(VISION_CANARY_TIMEOUT_MS, remainingUserMs())),
    });
    const decideCanaryProbe = (): ReturnType<typeof decideVisionCanaryProbe> => decideVisionCanaryProbe({
      projectRoot,
      manifest,
      chain,
      dryRun,
      forceRefresh: Boolean(argv['refresh-vision-probe']),
    });
    // E1（多模态降级阶梯 plan d4a8f3c6）：UI 需求且无 local override/新鲜缓存时，探测层
    // 才刚被声明式 image_input 骗过（案A mx 2.7 套壳）——先跑一次金丝雀实测校准，
    // 结果缓存进 framework.local.json（adapter 变更即失效），后续 phase 的能力块直接读缓存。
    // 探测失败/异常不阻断 run（保守：让主流程走既有 adapter 声明路径继续）。
    const visionProbeDecision = decideCanaryProbe();
    // plan d7f3a9c4 t4：金丝雀 CLI 硬失败（spawn race / CLI·config 参数不兼容）**只有**在
    // 真实 action==='probe' 路径上记录并升 run 级 BLOCKER；终态发射在 manifest 落盘后
    //（见 writeGoalManifest 之后的 canary_cli_hard_failure 块），保证 run 有可监控终态。
    let canaryHardCliFailure: string | null = null;
    if (visionProbeDecision.action === 'probe' && !(remainingUserMs() > 0)) {
      console.warn('[goal-runner] 用户明示时限已到——不启动新的视觉能力探测');
    } else if (visionProbeDecision.action === 'probe') {
      let probeResult: Awaited<ReturnType<typeof runVisionCanaryProbe>> = await runCanaryWithinBudget();
      if (canaryHandoffIssued) { runConcluded = true; return 3; }
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
            ...(manifest.adapter_model_pin ? { modelPin: adapterModelBinding(manifest.adapter_model_pin)! } : {}),
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
        '这是 CLI/config 参数不兼容、模型不可用或 spawn race——请核对 adapter 版本/配置/模型/环境后重跑' +
        '（--refresh-vision-probe 触发重探）；不是需求或产品代码问题，不进入正式 phase。';
      goalEvents.emit({
        type: 'phase_halt',
        phase: chain[0],
        halt_reason: 'canary_cli_hard_failure',
        verdict: 'FAIL',
        reason: canaryHardCliFailure,
        halt_guidance: guidance,
      });
      goalEvents.emit({
        type: 'run_end', status: 'HALTED', halt_reason: 'canary_cli_hard_failure', session_started_at: sessionStartedAtIso,
        error: canaryHardCliFailure.slice(0, 1000),
      });
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
          type: 'run_end', status: 'HALTED', halt_reason: 'declared_product_layer_missing', session_started_at: sessionStartedAtIso,
        });
        runConcluded = true;
        console.error(
          '\n===== declared_product_layer_missing =====\n' +
            `${earlySnap.failureReason ?? earlySnap.sha256}\n` +
            `framework.config.json 的 architecture.outer_layers 声明：${declaredLayers.join('、') || '(空)'}\n` +
            '本链路含 testing，须对产品源码层做快照保护——声明的目录必须真实存在。\n' +
            '处置：修正配置声明或补建目录后重新发起同一请求，由框架选择恢复方式（本检查会重做）。\n',
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
    // 确认（record-product-selection / init.product_selection / env）后重新发起同一请求——由接续决策选择附着或恢复，本检查重做。
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
            '请更新/修复 framework 后重新发起同一请求，由框架选择恢复方式（本检查会重做）。';
          goalEvents.emit({
            type: 'phase_halt',
            phase: chain[0],
            halt_reason: 'product_selection_probe_failed',
            verdict: 'FAIL',
            reason: probe.message ?? 'product selection 解析失败',
          });
          goalEvents.emit({
            type: 'run_end', status: 'HALTED', halt_reason: 'product_selection_probe_failed', session_started_at: sessionStartedAtIso,
          });
          runConcluded = true;
          console.error(`\n===== product_selection_probe_failed =====\n${guidance}\n`);
          return 1;
        }
      } else if (probe.selection.source === 'unresolved') {
        const candidates = probe.selection.candidates.join(', ');
        const guidance = buildProductSelectionUnresolvedGuidance({
          feature: manifest.feature,
          phase: String(chain[0]),
          candidates: probe.selection.candidates,
          projectRoot,
        }).join('\n');
        goalEvents.emit({
          type: 'phase_halt',
          phase: chain[0],
          halt_reason: 'product_selection_unresolved',
          verdict: 'FAIL',
          reason: `编译形态无法确定（候选：${candidates || '(无)'}）`,
          candidates: probe.selection.candidates,
        });
        goalEvents.emit({
          type: 'run_end', status: 'HALTED', halt_reason: 'product_selection_unresolved', session_started_at: sessionStartedAtIso,
        });
        runConcluded = true;
        console.error(`\n===== product_selection_unresolved =====\n${guidance}\n`);
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
        // plan b7d2e9f4 §3.3：只有出生事件 = 该 run 从未正式开始（可接入），其余才是真源损坏。
        const bornOnly = authoritativeResumeEvents.some((e) => (e as { type?: string }).type === 'run_created');
        console.error(
          `[goal-runner] BLOCKER: --resume 需要 events 含有效 authoritative run_start，`
          + `但该文件没有（raw=${strictEvents.events.length} 行，authoritative=${authoritativeResumeEvents.length} 行）：${eventsPath}\n`
          + (bornOnly
            ? `  处置：该 run 只有出生事件、未正式开始——直接以普通方式重新发起同一请求，或用 --attach-created ${manifest.run_id} 接入。`
            : '  处置：resume 起点无源可依——人工核查 run 目录（非本 run 的 events / 文件被整体替换/清空）。'),
        );
        return 1;
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
    const progressWriterState: ProgressWriterState = { lastWriteMs: 0 };
    const flushProgress = setupProgressHooks(
      manifest,
      projectRoot,
      frameworkRoot,
      featuresDir,
      workflow,
      progressWriterState,
    );

    // Arm the terminal-event safety net now that report_dir is known: any abnormal exit
    // from here on writes run_end{INTERRUPTED} instead of dying silently.
    terminalEventCtx = {
      reportDir: manifest.report_dir, projectRoot, frameworkRoot,
      runId: manifest.run_id, feature: manifest.feature,
      chain: [...chain], workflowChain: fullWorkflowChain.map(String),
    };

    // visual-capability-truth S4：run_start 冻结 manifest hash——pre_run_manifest 授权源
    // 只认此快照（运行中补写 manifest 不构成授权）；resume 沿用首个 run_start 的冻结值。
    // 十/十一轮 review：manifest 身份哈希漂移检测已提前到副作用前（见上方 manifestDrift 块），
    // 此处仅落 run_start 事件（携带逐字段身份 + rebase 记录）。
    const manifestFileAbs = path.join(projectRoot, manifest.report_dir, 'manifest.json');
    const frozenManifestHash = resolveFrozenManifestHash(priorEvents, sha256FileHex(manifestFileAbs));
    goalEvents.emit({
      type: 'run_start',
      dry_run: dryRun,
      session_started_at: sessionStartedAtIso,
      chain,
      manifest_hash: frozenManifestHash,
    });
    flushProgress(true);

    // openspec device-readiness-and-completion t2：最后一次 testing 经设备就绪门取得的目标类型。
    // **null = 本 run 的 testing 未经设备门**（profile 未声明 device_capabilities / dry-run），
    // 与 'unknown'（经过了门但判不出机型）**语义不同**：前者不参与封顶（该链路本就与设备无关），
    // 后者按模拟器同等封顶。混淆二者会把所有非设备链路误降为 PARTIAL。
    /** R10：托管模拟器的信号清理反注册句柄（正常回收后摘除，防重复回收） */
    let releaseManagedDeviceCleanup: (() => void) | null = dryRun ? null : registerManagedDeviceCleanup(() => {
      reclaimManagedDevice(readDeviceSession(projectRoot, manifest.report_dir), defaultProcessProbe());
    });
    // 视觉账本控制面已退役；当前执行仅使用 invocation-bound capability/reference receipts。
    // supersededRunIds / cycleBoundary 已随预算折叠提前到启动期金丝雀之前计算（plan 4e6fb3b6 §6.3），语义不变。
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
      const targetRunDir = path.join(projectRoot, featuresDir, featureRelativePath(manifest.feature), 'goal-runs', target);
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
        ...(cycleBoundary ? { deliveryCycleBoundary: cycleBoundary } : {}),
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
    // plan b2d7f4e9 §3.2 第 4 步：审计事件已落，feature 冻结记录（若有）追加一条转交指向本后继，旧转交保留。
    // 登记函数自己读本 run 的 supersede 审计与出生范围核对，不信这里的声明；无记录时是 no-op。
    // 批三返修 R2：附着的后继同样补登转交（登记函数对同一 run 幂等；它自己核对本后继的 supersede 审计）。
    if ((freshCreation || (attachCreatedRunId && manifest.successor_of)) && manifest.execution_scope && manifest.successor_of && !dryRun) {
      try {
        registerFeatureScopeTransfer({
          projectRoot, feature: manifest.feature, runId: manifest.run_id,
          transferredScopeFingerprint: executionScopeFingerprint(validateExecutionScope(manifest.execution_scope)),
        });
      } catch (error) {
        const msg = `feature 范围转交登记失败：${(error as Error).message}`;
        console.error(`[goal-runner] BLOCKER: ${msg}`);
        // 出生前已核过血缘；到这里还失败只可能是记录被并发改写——按既有 supersede 参数类收口（操作者核对后重起）。
        concludeStartupBlocker('supersede_target_invalid', msg);
        return 1;
      }
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
        profileDir: loadResolvedProfile(projectRoot, cfg, frameworkRoot).profileDir,
        fidelityFromCli: Boolean(manifestArgv.fidelity),
      });
      if (fidelityAction.action !== 'proceed') {
        const status: GoalRunStatus = 'DEFERRED_CAPABILITY_MISSING';
        console.error(`\n[goal-runner] fidelity preflight → ${status}：\n${fidelityAction.detail}\n`);
        const report = generateGoalReportJson(manifest.run_id, manifest.feature, status, []);
        writeGoalReport(projectRoot, manifest.report_dir, report, {
          workflowChain: fullWorkflowChain.map(String),
          frameworkRoot,
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
    if (argv.resume) goalEvents.emit({ type: 'resume' });

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
    if (argv.resume && !dryRun && process.platform === 'win32' && recoverRuntimeGuardians(priorEvents, manifest.run_id, forceResume, goalEvents.emit, concludeStartupBlocker)) return 1;

    let halted = false;
    const runDir = path.resolve(projectRoot, manifest.report_dir);
    const kernel = new GoalPhaseRuntime(options);
    const completedEvaluations = readGateCompletionHistory(projectRoot, runDir, loadAuthoritativeEvents(eventsPath));
    const scopeNow = () => birthScope ? applyScopeRevisions(birthScope, loadAuthoritativeEvents(eventsPath)) : undefined;
    const familiesNow = () => applicableCheckFamilies(scopeNow(), terminalEventCtx?.chain.map(String) ?? chain.map(String));
    if (dryRun) {
      console.log(`[dry-run] work unit ${manifest.feature} checks=${familiesNow().join(',')}`);
      if (manifest.adapter_model_pin) console.log(`[dry-run] adapter_model_pin=${manifest.adapter_model_pin.adapter}/${adapterModelBinding(manifest.adapter_model_pin)!}`);
    }
    const readWork = () => {
      const families = familiesNow();
      const results = families.map(phase => readReusableCheckResult({ projectRoot, frameworkRoot, feature: manifest.feature, phase, runId: manifest.run_id }))
        .filter((result): result is NonNullable<typeof result> => !!result);
      const input = { projectRoot, frameworkRoot, feature: manifest.feature, runId: manifest.run_id,
        executionScope: scopeNow(), workflow, chain: families, currentResults: results, minimumAssurance: manifest.minimum_assurance };
      const facts = readCurrentDispositionInput(input);
      const disposition = resolveCurrentDisposition(facts);
      flushProgress(false, false, disposition);
      const independent = independentArtifactRepairs({ projectRoot, frameworkRoot, feature: manifest.feature,
        runId: manifest.run_id, executionScope: input.executionScope, currentDisposition: disposition });
      return { input, facts, disposition, results, independent, evaluation: currentCompletionEvaluation(input, disposition) };
    };
    const wait = (phase: string, detail: string, incident = 'executor_waiting', facts: Record<string, unknown> = {}): void => {
      if (incident === 'no_progress_guard') {
        const conflicts = renderGoalBrief(assembleGoalBrief(projectRoot, manifest.feature, { runId: manifest.run_id }), { sections: ['resolved_conflicts'] });
        if (conflicts) detail += `\n\n${conflicts}`;
      }
      goalEvents.emit({ type: 'phase_halt', phase, halt_reason: incident, run_disposition: 'WAITING', run_wait_kind: 'external', reason: detail, halt_guidance: detail, ...facts });
      outcomes.push({ phase: phase as FeaturePhase, verdict: 'INCOMPLETE', halted: true, retries: 0,
        halt_reason: incident, halt_guidance: detail, run_disposition: 'WAITING', run_wait_kind: 'external' });
      halted = true;
    };
    const continuationAvailable = (): boolean => {
      const records = loadAuthoritativeEvents(eventsPath);
      return userContinued && records.map(event => event.type === 'agent_invoke_start' || event.type === 'harness_start').lastIndexOf(true)
        < records.map(event => event.type === 'run_start').lastIndexOf(true);
    };
    if (options.sessionHandoff && sessionRequest) {
      const invokeId = sessionRequest.request.invoke_id;
      const received = acceptedSessionReport(runDir, sessionRequest);
      if (received?.event.handoff_report && sessionRequest.request.pre_snapshot && sessionRequest.request.write_boundary) try {
        const saved = readHandoffMaterial<{ post_snapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> }>(runDir, received.event.handoff_report);
        if (saved.post_snapshot) {
          const delta = diffPhaseInvocationSnapshots(sessionRequest.request.pre_snapshot, saved.post_snapshot);
          if (delta.kind === 'unverifiable') wait(sessionRequest.request.context.phase, `原session写入后像不可核实：${delta.reason}；恢复原件后继续，不运行正式工具。`);
          if (delta.kind === 'changed') {
            const records = loadAuthoritativeEvents(eventsPath);
            recordAuthorRestorations(records, delta.changes, sessionRequest.request.context.phase, sessionRequest.request.invoke_id, goalEvents.emit);
            const originals = authorWritePreimages(beforeAuthorInvocation(records, sessionRequest.request.invoke_id));
            const writes = classifyPhaseInvocationChanges(sessionRequest.request.write_boundary, sessionRequest.request.context.phase, delta.changes);
            const violations = writes.violations.filter(write => !originals.has(write.path) || originals.get(write.path) !== write.postSha256);
            if (violations.length && !records.some(event => event.type === 'phase_write_violation' && event.invoke_id === invokeId)) {
              goalEvents.emit({ type: 'phase_write_violation', phase: sessionRequest.request.context.phase, invoke_id: sessionRequest.request.invoke_id,
                violations: violations.map(write => ({ path: write.path, how: write.how, owner: write.owner, violation: write.violation,
                  pre_sha256: write.preSha256, post_sha256: write.postSha256, roles: write.roles })) });
            }
          }
        } else wait(sessionRequest.request.context.phase, '原session回报缺可信写入后像；恢复该归档后继续，不运行正式工具或猜测原写入。');
      } catch (error) { wait(sessionRequest.request.context.phase, `原session写入归档不能读取：${(error as Error).message}；恢复原件后继续，不运行正式工具。`); }
    }
    const consumeCompletedBoundaryHandoff = (): boolean => {
      if (!runControl) return false;
      const handoff = consumeHandoffAtBoundary(runControl.dir, runControl.token);
      if (handoff.kind === 'rejected') goalEvents.emit({ type: 'handoff_rejected', request_id: handoff.request.request_id,
        target_owner_kind: handoff.request.target_owner_kind, from_epoch: handoff.request.from_epoch, reason: handoff.reason });
      if (handoff.kind !== 'consumed') return false;
      goalEvents.emit({ type: 'handoff_requested', request_id: handoff.request.request_id,
        target_owner_kind: handoff.request.target_owner_kind, from_epoch: handoff.request.from_epoch });
      quiesceRunOwner(runControl.dir, runControl.token);
      runConcluded = true;
      return true;
    };
    const reviseCurrentScope = (family: string): void => {
      const previous = scopeNow();
      if (!previous || !manifest.execution_scope) return;
      try {
        const current = readWork();
        const completed = new Set(current.results.filter(result => {
          const summary = asRecord(result.summary);
          return summary?.run_id === manifest.run_id && summary.closure_status === 'closed'
            && !phaseCompletionProblems(current.disposition, [result.phase]).length;
        }).map(result => result.phase));
        const result = current.results.find(result => result.phase === family && asRecord(result.summary)?.run_id === manifest.run_id);
        if (!result) return;
        const proposed = (result.checks as readonly { id?: string; scope_revision_input?: ExecutionScopeInput }[])
          .filter(check => check.scope_revision_input);
        const proposals = proposed.flatMap(check => check.scope_revision_input ? [check.scope_revision_input] : []);
        const summary = asRecord(result.summary);
        const candidates = (summary?.repair_candidates ?? []) as RepairCandidate[];
        if (!proposals.length && candidates.length) {
          const repair = scopeRevisionInputFromRepairCandidates(candidates, { projectRoot, frameworkRoot, feature: manifest.feature,
            runId: manifest.run_id, currentDisposition: current.disposition });
          if (repair) proposals.push(repair.input);
        }
        const resolvesDefinition = previous.unresolved.some(gap => gap.owner === family);
        if (!proposals.length && completed.has(family) && (resolvesDefinition || previous.reused_phases.some(proof => proof.phase === family))) {
          const refreshed = resolveCurrentScopeView({ projectRoot, frameworkRoot, feature: manifest.feature, workflow, previous,
            currentRunId: manifest.run_id, completedPhases: completed, currentPhase: family, currentResults: current.results });
          if (resolvesDefinition || executionScopeFingerprint(refreshed) !== executionScopeFingerprint(previous)) proposals.push({
            request: { completion_target: previous.completion_target, requested_results: [...previous.requested_results],
              requested_phases: executionCompletionPhases(previous), ...(previous.request_impact ? { impact: structuredClone(previous.request_impact) } : {}) },
            facts: structuredClone(refreshed.obligations), contract_fingerprints: [],
            ...(previous.control_edges ? { control_edges: structuredClone(previous.control_edges) } : {}),
          });
        }
        const revision = resolveScopeRevisionProposal({ projectRoot, frameworkRoot, feature: manifest.feature, workflow, previous, proposals,
          authorizedPhases: authorizedScopePhases(validateExecutionScope(manifest.execution_scope), workflow), completedPhases: completed,
          currentPhase: family, currentRunId: manifest.run_id, requirement: manifest.requirement, currentResults: current.results, repairCandidates: candidates });
        if (!revision) return;
        assertGoalBoundary('scope_revised');
        assertRevisionKeepsRequiredObligations(previous, revision.scope);
        const recorded = loadScopeRevisions(loadAuthoritativeEvents(eventsPath), validateExecutionScope(manifest.execution_scope));
        const needsBaseline = !manifest.run_base_sha && !recorded.some(item => item.run_base_sha)
          && revision.scope.phase_chain.some(phase => phase === 'coding' || phase === 'ut');
        goalEvents.emit({ type: 'scope_revised', revision_index: recorded.length + 1,
          previous_scope_fingerprint: executionScopeFingerprint(previous), execution_scope: revision.scope, revision_input: revision.input,
          trigger: { phase: family, check_id: proposed[0]?.id ?? 'current_phase_evidence' }, allowed_fields: [...SCOPE_REVISION_FIELDS],
          ...(needsBaseline ? { run_base_sha: validateExactSha(resolveGoalRunHeadSha(projectRoot), 'Git HEAD') } : {}) });
      } catch (error) {
        const detail = (error as Error).message;
        const recovery = detail.includes('request-scope revision cannot add phases')
          ? '该提案超出原request冻结范围；保留原提案与真实结果，取得新请求授权后沿正常请求准备/出生入口继续。原单元不得自授产品写权或扩大检查范围。'
          : '保留原提案和真实结果，修复所指输入后接原单元。';
        wait(family, `当前范围/证明重签尚未满足原请求与授权：${detail}。${recovery}`, 'execution_scope_unresolved');
        return;
      }
      options.onScopeRevision?.('applied');
    };
    const lastAuthor = () => {
      const history = loadAuthoritativeEvents(eventsPath);
      const start = [...history].reverse().find(event => event.type === 'agent_invoke_start' && event.invoke_id && event.phase
        && !event.phase.startsWith('initial-design-') && !event.phase.startsWith('design-repair-')
        && workUnitExecutionRole({ phase: event.phase }, (event as Record<string, any>).purpose) === 'author');
      const end = start && history.slice(history.indexOf(start) + 1).find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
      return start && end && invocationCompleted({ ...end, exitCode: end.exit_code })
        ? { start, end, original: executionRequestForInvoke(runDir, start.invoke_id!) } : null;
    };
    const authorWrites = (actor: NonNullable<ReturnType<typeof lastAuthor>>) => loadAuthoritativeEvents(eventsPath)
      .filter(event => event.type === 'phase_write_observed' && event.invoke_id === actor.start.invoke_id)
      .flatMap(event => [...(event as Record<string, any>).owned ?? [], ...(event as Record<string, any>).observations ?? []])
      .filter((write: any) => typeof write.path === 'string' && write.pre_sha256 !== write.post_sha256) as Array<{
        path: string; post_sha256: string | null; owner?: string | null; roles?: Array<{ kind: string }> }>;
    const independentCalls = (task: { owner: string; file: string }, history: readonly GoalRunEvent[]) => history.flatMap((start, index) => {
      if (start.type !== 'agent_invoke_start' || !start.invoke_id || start.phase !== task.owner) return [];
      const original = executionRequestForInvoke(runDir, start.invoke_id);
      const output = original?.request.write_boundary?.verifierResultPath;
      if (!original || !output || path.resolve(projectRoot, output) !== task.file
        || workUnitExecutionRole(original.request.context, original.request.purpose) !== 'verifier'
        || !original.request.context.workInput?.evaluation) return [];
      const ended = history.findIndex((event, at) => at > index && event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
      if (ended < 0 || !invocationCompleted({ ...history[ended], exitCode: history[ended].exit_code })) return [];
      return [{ context: original.request.context, original, evaluation: original.request.context.workInput.evaluation, index, ended }];
    });
    const feedbackToResponsibleProducers = (work: ReturnType<typeof readWork>, disposition: CurrentDisposition,
      author: ReturnType<typeof lastAuthor>, history: readonly GoalRunEvent[]): boolean => {
      const repairs = disposition.completionBlocking.filter(problem => problem.action === 'repair');
      return repairs.length > 0 && repairs.every(problem => {
        const task = work.independent.find(task => problem.files?.length
          && problem.files.every(file => path.resolve(projectRoot, file) === task.file));
        const call = task ? independentCalls(task, history).at(-1) : undefined;
        const context = task ? call?.context : author?.original?.request.context;
        if (!context) return false;
        if (call) {
          const product = readReturnedWorkProduct(context, call.original, history, call.index);
          if ('status' in product || product.current.failureReason || product.productChanged) return false;
        }
        const feedback = { ...disposition, problems: [problem] };
        return workUnitFeedbackDelivered(context, feedback) ?? context.instruction?.includes(
          renderWorkUnitAuthorFeedback({ projectRoot, frameworkRoot, feature: manifest.feature, disposition: feedback })) === true;
      });
    };
    const checkWorkConditions = (family: string, work: ReturnType<typeof readWork>, actor = lastAuthor()) => {
      const observation = readCurrentCheckObservation({ projectRoot, frameworkRoot, feature: manifest.feature,
        runId: manifest.run_id, phase: family });
      const history = loadAuthoritativeEvents(eventsPath);
      const checkedAt = history.map(event => event.type === 'harness_end' && event.phase === family
        && event.invoke_id === observation.end?.invoke_id && event.ts === observation.end?.ts).lastIndexOf(true);
      const authorAt = actor ? history.findIndex(event => event.type === 'agent_invoke_end' && event.invoke_id === actor.start.invoke_id) : -1;
      const writes = actor && authorAt > checkedAt
        ? authorWrites(actor).filter(write => write.roles?.some(role => role.kind === 'source')) : [];
      const paths = new Set(writes.map(write => path.resolve(projectRoot, write.path)));
      const evidence = observation.returned && writes.length ? loadPhaseEvidenceManifest(projectRoot, manifest.feature, family) : null;
      const boundSourceChanged = evidence?.integrityOk
        ? [...evidence.manifest.inputs, ...evidence.manifest.outputs].some(entry => paths.has(path.resolve(projectRoot, entry.path))
          && currentEvidenceEntryHash(projectRoot, entry, manifest.feature) !== entry.sha256) : false;
      const productChanged = boundSourceChanged || work.disposition.completionBlocking.some(problem => (problem.source_phase ?? problem.phase) === family
        && problem.files?.some(file => paths.has(path.resolve(projectRoot, file))))
        || !hasFindingIdentities(work.disposition, [family]) && writes.some(write => productLayerDirsOf(projectRoot).some(root => {
          const relative = path.relative(path.resolve(projectRoot, root), path.resolve(projectRoot, write.path));
          return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        }));
      const scope = scopeNow();
      const invalidatedAt = scope ? readScopeProofHistory({ projectRoot, frameworkRoot, feature: manifest.feature,
        workflow, previous: scope, currentRunId: manifest.run_id }).history.invalidatedAt.get(family) : undefined;
      const scopeChanged = invalidatedAt !== undefined && Date.parse(invalidatedAt) > Date.parse(observation.end?.ts ?? '');
      return { observation, productChanged, scopeChanged };
    };
    const missingCheckOrigin = (family: string, work: ReturnType<typeof readWork>, observation?: ReturnType<typeof readCurrentCheckObservation>): boolean => {
      // Current self-check files are observations, not a completed formal call.
      // Keep qualified historical reuse; establish this run's missing origin once.
      if (work.results.some(result => result.phase === family && asRecord(result.summary)?.run_id === manifest.run_id)) {
        const events = loadAuthoritativeEvents(eventsPath);
        const producer = phaseInvocationStart(events, family);
        if (!producer) return true;
        if (producer.phase === 'work-unit-author') {
          if (observation) return !observation.end;
          const start = [...events].reverse().find(event => event.type === 'harness_start' && event.phase === family && event.invoke_id);
          return !start || !events.slice(events.indexOf(start) + 1).some(event => event.type === 'harness_end'
            && event.phase === family && event.invoke_id === start.invoke_id);
        }
      }
      return false;
    };
    const workCompleted = (work: ReturnType<typeof readWork>): boolean => work.disposition.completionEligible
      && !work.facts.phases.some(result => missingCheckOrigin(result.phase, work));
    const affectedCheck = (family: string, work: ReturnType<typeof readWork>, actor = lastAuthor()): boolean => {
      const conditions = checkWorkConditions(family, work, actor);
      if (conditions.observation.changed || conditions.productChanged || conditions.scopeChanged) return true;
      if (conditions.observation.returned) return false;
      if (missingCheckOrigin(family, work, conditions.observation)) return true;
      return work.facts.phases.some(result => result.phase === family && (result.lineage === 'stale' || result.lineage === 'missing'));
    };
    const commitVisualJournal = (attemptId: string, actor: NonNullable<ReturnType<typeof lastAuthor>>): boolean => {
      const ledgerPath = visualRoundsLedgerPath(projectRoot, manifest.feature);
      try {
        const records = loadAuthoritativeEvents(eventsPath);
        let pendingAttemptIds = collectUncommittedVisualAttemptIds(records);
        const committed = records.some(event => event.type === 'visual_round' && event.visual_attempt === attemptId && event.row_hash);
        if (!committed && actor.original?.request.context.chain.includes('testing')
          && actor.original.request.context.attemptId === attemptId) pendingAttemptIds = [attemptId];
        const reconciled = reconcileLedgerWithEvents({ ledgerPath, loopId: `goal:${manifest.run_id}`,
          expectedRowHashes: collectVisualRoundRowHashes(records), pendingAttemptIds,
          committedAttemptWindow: collectLastCommittedVisualAttemptWindow(records) });
        if (!reconciled.ok) {
          wait('testing', `视觉账本与真实提交原件不一致：${ledgerPath}\n${reconciled.issues.map(issue => `${issue.kind}: ${issue.detail}`).join('\n')}`, 'visual_ledger_integrity');
          return false;
        }
        for (const row of reconciled.adopted) goalEvents.emit({ type: 'visual_round', phase: 'testing', invoke_id: `testing-${row.attempt_id}`,
          loop_id: `goal:${manifest.run_id}`, visual_attempt: row.attempt_id, row_hash: row.row_hash, disposition: 'recovered' });
        const replay = replayJournalIntoLedger({ ledgerPath,
          journalPath: intermediateRoundsJournalPath(projectRoot, manifest.feature, manifest.run_id), attemptId, runId: manifest.run_id });
        if (!replay.ok) {
          wait('testing', `真实视觉中间结果无法按原绑定收编：${replay.mismatches.join('；')}`, 'visual_ledger_integrity');
          return false;
        }
        for (const row of replay.committed) goalEvents.emit({ type: 'visual_round', phase: 'testing', invoke_id: `testing-${attemptId}`,
          loop_id: row.loop_id, visual_attempt: row.attempt_id, row_hash: row.row_hash, disposition: 'appended', fused: row.decision.fused });
        return true;
      } catch (error) {
        wait('testing', `视觉账本或本次 journal 原件暂不可收编：${ledgerPath}；${(error as Error).message}。保留原件，恢复该具体条件后继续。`, 'visual_ledger_integrity');
        return false;
      }
    };
    const invokeWork = async (label: string, text: string, verifierReport?: string, purpose?: string, explicitlyContinued = false, workInput?: WorkUnitInput) => {
      const history = loadAuthoritativeEvents(eventsPath);
      const attemptId = `i${countAgentInvokeStarts(history) + 1}`;
      const invokeId = `${label}-${attemptId}`;
      const dir = path.join(runDir, 'phases', label, invokeId);
      const role = verifierReport ? 'verifier' as const : 'author' as const;
      // The original research-input anchor is independent of which check currently needs work.
      const family = verifierReport ? label.replace(/-verifier-format-repair$/, '')
        : manifest.phase_chain?.[0] ?? manifest.execution_scope?.phase_chain[0] ?? familiesNow().find(family => family !== 'review') ?? familiesNow()[0] ?? 'coding';
      let factsContext: import('./utils/context-facts').FactsInvocationContext | undefined;
      if (manifest.execution_scope && role === 'author') {
        try {
          factsContext = resolveCapabilityResolutionEntryInput({ projectRoot, frameworkRoot, feature: manifest.feature,
            phase: family, featuresDir, goalRunId: manifest.run_id, goalAttemptId: attemptId, purpose: 'work-unit-author' }).factsContext;
        } catch (error) {
          wait(label, `原工作单元的研究输入暂不能按当前真实来源承接（${family}）：${(error as Error).message}。保留原facts与成果，恢复该来源/绑定后接原请求；不伪造研究完成或另派作者。`);
          return null;
        }
      }
      const env = { MAISON_GOAL_RUN_ID: manifest.run_id, MAISON_GOAL_ATTEMPT: attemptId, MAISON_GOAL_ATTEMPT_PHASE: label };
      applyGoalVisualProviderEnv(env, manifest.visual_provider_pin);
      const boundary = resolvePhaseWriteBoundary({ projectRoot, frameworkRoot, feature: manifest.feature, runId: manifest.run_id,
        executionRole: role, ...(verifierReport ? { verifierResultPath: verifierReport } : {}),
        phaseOrder: familiesNow(), track: goalTrack, profileDir: resolvedProfile.profileDir, productLayerDirs: productLayerDirsOf(projectRoot),
        resolveUtSourceRoots: tryLoadUtSourceRootResolver(resolvedProfile.profileDir) ?? undefined });
      boundary.immutableInputPaths = [...new Set([...(boundary.immutableInputPaths ?? []),
        ...workUnitProtectedRecordPaths(projectRoot, manifest.feature, runDir)])];
      const prepared = kernel.prepareExecutionContext({ ...workUnitExecutionInputs(manifest, purpose, projectRoot),
        executionRole: role, runId: manifest.run_id, feature: manifest.feature, workflowId: workflow.name, track: goalTrack,
        chain: familiesNow(), phase: label, attemptId,
        owner: runControl ? { ...runControl.token, kind: runtimeOwnerKind } : { run_id: manifest.run_id, owner_id: 'dry-run', epoch: 0, kind: runtimeOwnerKind },
        projectRoot, frameworkRoot, runDir, reportDir: manifest.report_dir, adapter: manifest.adapter ?? 'generic', adapterModel: adapterModelBinding(manifest.adapter_model_pin),
        factsContext, instruction: text, workInput: workInput ?? { material: { purpose: purpose ?? label, segments: [text] } },
        runtimeFacts: { runBaseSha: resolveRunBaseline(manifest, history).baseSha,
          receiptRequired: false, resume: !!argv.resume, successor: !!manifest.successor_of }, childEnv: env }, explicitlyContinued);
      if ('status' in prepared) { wait(label, prepared.details ?? '等待原调用真实交回。'); return null; }
      const context = prepared;
      const instruction = context.instruction ?? text;
      const snapshotOptions = { runtimeExcluded: [manifest.report_dir] };
      const pre = capturePhaseInvocationSnapshot(boundary, snapshotOptions);
      if (pre.failureReason) { wait(label, `调用前写入观察不可核实：${pre.failureReason}`); return null; }
      fs.mkdirSync(dir, { recursive: true });
      const promptFile = path.join(dir, 'prompt.md'); fs.writeFileSync(promptFile, instruction);
      const plan = executorMode === 'attended' ? { argv: [], label: 'phase_execute_request', adapterName: manifest.adapter! }
        : resolveHeadlessInvokePlan(manifest.adapter!, cap.capability!, manifest.unattended, instruction,
          { PROMPT: instruction, PROMPT_FILE: promptFile, PROJECT_ROOT: projectRoot, FRAMEWORK_ROOT: frameworkRoot, FEATURE: manifest.feature,
            PHASE: label, SKILL_PATH: phaseSkillPath(frameworkRoot, family as FeaturePhase) }, adapterModelBinding(manifest.adapter_model_pin), sessionBinary?.binary ?? null);
      const issuedAt = new Date().toISOString();
      const materialInput = { context, invokeId, issuedAt, ...(purpose ? { purpose } : {}),
        gateTimeoutMs: 0, cleanupReserveMs: 0, preSnapshot: pre, writeBoundary: boundary, snapshotOptions };
      const original = !options.sessionHandoff ? writePhaseExecutionRequestMaterial(materialInput) : undefined;
      goalEvents.emit({ type: 'agent_invoke_start', ts: issuedAt, phase: label, invoke_id: invokeId, command: plan.label, purpose,
        ...(original ? { handoff_request: original.reference, attempt_id: context.attemptId } : {}),
        ...(runControl ? { owner_id: runControl.token.owner_id, owner_epoch: runControl.token.epoch } : {}),
        ...(factsContext ? { facts_context: factsContext } : {}) });
      emitMilestone(`GOAL_WORK event=invoke role=${role} label=${label} invoke_id=${invokeId}`);
      if (options.sessionHandoff) {
        try {
          const issued = issueSessionExecution({ ...materialInput, emit: goalEvents.emit });
          preserveSessionOwner = true; options.sessionHandoff.onRequest(issued); return 3 as const;
        } catch (error) {
          try {
            const records = loadAuthoritativeEvents(eventsPath);
            const pending = undeliveredSessionInvocation(records);
            const saved = executionRequestForInvoke(runDir, invokeId);
            const current = capturePhaseInvocationSnapshot(boundary, snapshotOptions);
            if (pending?.invoke_id === invokeId && saved?.request.issued_at === issuedAt
              && saved.request.context.runId === manifest.run_id && saved.request.context.feature === manifest.feature
              && saved.request.context.owner.owner_id === context.owner.owner_id && saved.request.context.owner.epoch === context.owner.epoch
              && pending.owner_id === context.owner.owner_id && pending.owner_epoch === context.owner.epoch
              && !records.some(event => event.invoke_id === invokeId && ['agent_process_bound', 'agent_process_settled', 'harness_start',
                'phase_write_observed', 'phase_write_violation', 'agent_invoke_end'].includes(event.type ?? ''))
              && !current.failureReason && current.sha256 === pre.sha256) preserveSessionOwner = true;
          } catch { /* Unverifiable preparation cannot retain the old owner or replace the original failure. */ }
          throw error;
        }
      }
      let childExited = false;
      const started = Date.now();
      progressPhase = label; progressSubstep = 'agent_invoke'; flushProgress();
      const result = await kernel.executeExecutor(context, attendedExecutor ?? new DetachedGoalPhaseExecutor(() => ({ plan, cwd: projectRoot, options: {
        dryRun, outputLogPath: path.join(dir, 'agent-output.log'), extraEnv: env,
        toolEventCapture: cap.capability?.tool_event_provenance ?? 'none', usageCapture: cap.capability?.usage_capture,
        ...(process.platform === 'win32' ? { containment: { runId: manifest.run_id, invokeId } } : {}),
        onActiveChild: ({ pid, kill }) => {
          activeAgentKill = async () => { await kill(); };
          if (process.platform === 'win32') {
            const bound = bindGuardianOrKill(pid, `${manifest.run_id}/${invokeId}`);
            if (!bound.ok) throw new Error(bound.error);
            goalEvents.emit({ type: 'agent_process_bound', phase: label, invoke_id: invokeId, run_id: manifest.run_id,
              pid, started_at_ms: bound.identity.startedAtMs, executable: bound.identity.executable, token: `${manifest.run_id}/${invokeId}` });
          }
        },
        onChildExit: () => { childExited = true; activeAgentKill = null; },
      } }), injectedInvokeAgent ?? invokeAgentHeadless));
      activeAgentKill = null;
      goalEvents.emit({ ...invocationEndFacts(result), type: 'agent_invoke_end', phase: label, invoke_id: invokeId, purpose, status: result.status,
        exit_code: result.exitCode, command: result.command, duration_ms: result.duration_ms ?? Date.now() - started,
        provider_session_id: result.provider_session_id, interrupted: result.interrupted, nativeSessionRebuildReason: result.nativeSessionRebuildReason,
        completion_observed: result.completion_observed, terminal_failure_observed: result.terminal_failure_observed,
        timed_out: result.timed_out, silent_killed: result.silent_killed, skipped: result.skipped, signal: result.signal,
        readonly_enforced: result.readonly_enforced, readonly_diagnostic: result.readonly_diagnostic,
        ...(result.spawn_error ? { spawn_error: result.spawn_error } : {}) });
      if (childExited) goalEvents.emit({ type: 'agent_process_settled', phase: label, invoke_id: invokeId, exit_code: result.exitCode });
      const post = capturePhaseInvocationSnapshot(boundary, snapshotOptions);
      const changes = diffPhaseInvocationSnapshots(pre, post);
      const writes = changes.kind === 'changed' ? classifyPhaseInvocationChanges(boundary, label, changes.changes) : null;
      if (writes) {
        const originalWrites = authorWritePreimages(history);
        for (const write of writes.violations.filter(write => originalWrites.has(write.path) && originalWrites.get(write.path) === write.postSha256)) {
          writes.allowed.push(write);
        }
        writes.violations = writes.violations.filter(write => !originalWrites.has(write.path) || originalWrites.get(write.path) !== write.postSha256);
        if (writes.violations.length) {
          goalEvents.emit({ type: 'phase_write_violation', phase: label, invoke_id: invokeId, violations: writes.violations.map(write => ({
            path: write.path, how: write.how, owner: write.owner, violation: write.violation,
            pre_sha256: write.preSha256, post_sha256: write.postSha256, roles: write.roles })) });
        }
      } else if (changes.kind === 'unverifiable') {
        wait(label, `真实调用已交回，但写入观察不可核实：${changes.reason}；保留原调用与成果，恢复原观察后继续。`);
        return null;
      }
      let machineEvidenceProcessed = false;
      if (role === 'author' && invocationCompleted(result) && (cap.capability?.tool_event_provenance ?? 'none') === 'structured_events') {
        try {
        const stream = agentEventsLogPath(path.join(dir, 'agent-output.log'));
        if (fs.existsSync(stream)) {
          const references = resolveRequirementReferenceImages(projectRoot, manifest.feature, manifest.requirement,
            { requirementSourceFiles: manifest.requirement_source_files });
          if (references.length) {
            machineEvidenceProcessed = true;
            const produced = produceSpecRefsReceipt({ projectRoot, feature: manifest.feature, adapter: manifest.adapter ?? '',
              goalRunId: manifest.run_id, invokeId, eventsLogAbsPath: stream, refAbsPaths: references });
            goalEvents.emit({ type: 'spec_refs_receipt_produced', phase: label, invoke_id: invokeId,
              status: produced.produced ? produced.unread?.length ? 'partial' : 'complete' : 'skipped',
              carried_over: produced.carriedOver?.length ?? 0, ...(produced.reason ? { reason: produced.reason } : {}) });
          }
          const vision = resolvePhaseCapabilityAdvisory(manifest, projectRoot, frameworkRoot, resolvedProfile, 'coding');
          if (familiesNow().includes('testing') && vision?.visionMode !== 'delegated') {
            machineEvidenceProcessed = true;
            const produced = produceCriticReceipt({ projectRoot, feature: manifest.feature, adapter: manifest.adapter ?? '',
              goalRunId: manifest.run_id, attemptId, eventsLogAbsPath: stream,
              promptHash: createHash('sha256').update(instruction).digest('hex').slice(0, 16),
              outputHash: sha256FileFull(path.join(dir, 'agent-output.log'))?.slice(0, 16) ?? null });
            goalEvents.emit({ type: 'critic_receipt_produced', phase: label, invoke_id: invokeId,
              status: produced.produced ? produced.provenance ?? 'unverified' : 'skipped' });
          }
        }
        } catch (error) { console.warn(`[native evidence] 本次原生证据未能完整归档：${(error as Error).message}；真实缺口留给同一检查与完成视图。`); }
      }
      // Attribute model writes before machine receipts, then observe the complete handback.
      const handedBack = machineEvidenceProcessed ? capturePhaseInvocationSnapshot(boundary, snapshotOptions) : post;
      if (handedBack.failureReason) {
        wait(label, `真实调用的交回后像不可核实：${handedBack.failureReason}；恢复原观察后继续，不猜新工作条件。`);
        return null;
      }
      if (pre.sha256 !== handedBack.sha256) goalEvents.emit({ type: 'phase_write_observed', phase: label, invoke_id: invokeId,
        pre_snapshot: pre.sha256, post_snapshot: handedBack.sha256,
        owned: (writes?.allowed ?? []).map(write => ({ path: write.path, how: write.how, owner: write.owner, pre_sha256: write.preSha256, post_sha256: write.postSha256, roles: write.roles })),
        observations: writes?.observed ?? [], observed_count: writes?.observed.length ?? 0 });
      let rebuild = recoverableProviderSessionFailure(context, result);
      if (!invocationCompleted(result) && !rebuild && result.timed_out !== true
        && parseHeadlessApiError(path.join(dir, 'agent-output.log'), manifest.adapter ?? '', result.terminal_error_excerpt)) {
        // A model-API drop/429 is a transport fault, not work feedback: re-send the same work after a short fixed backoff,
        // counted only since this label's last completed handback. Exhausted or past the user deadline → the wait below.
        const records = loadAuthoritativeEvents(eventsPath);
        const lastHandback = records.map(event => event.type === 'agent_invoke_end' && event.phase === label
          && invocationCompleted({ ...event, exitCode: event.exit_code })).lastIndexOf(true);
        const used = records.slice(lastHandback + 1).filter(event => event.type === 'transient_api_retry_scheduled' && event.phase === label).length;
        const backoffMs = TRANSIENT_API_BACKOFF_MS[used];
        const deadline = workUnitExecutionInputs(manifest, undefined, projectRoot).user_deadline_at;
        if (backoffMs !== undefined && !(deadline && Date.parse(deadline) - Date.now() <= backoffMs)) {
          goalEvents.emit({ type: 'transient_api_retry_scheduled', phase: label, invoke_id: invokeId, attempt: used + 1,
            max_attempts: TRANSIENT_API_BACKOFF_MS.length, backoff_ms: backoffMs,
            api_error_excerpt: parseHeadlessApiError(path.join(dir, 'agent-output.log'), manifest.adapter ?? '', result.terminal_error_excerpt)?.matchedLine });
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          return { context, result, invokeId, rebuild: true };
        }
      }
      if (!invocationCompleted(result) && !rebuild) {
        const hardFailure = resolveInvokeHardCliFailure(result, { formalInvoke: true });
        if (hardFailure) {
          wait(label, hardFailure, 'adapter_cli_hard_failure');
          return { context, result, invokeId, rebuild };
        }
      }
      if (!invocationCompleted(result) && !rebuild) {
        const convergence = typeof result.details === 'string' && result.details.startsWith('no_progress_guard:');
        wait(label, result.details ?? result.stderr ?? '原调用未提供真实完成事实，等待原执行者/环境恢复。', convergence ? 'no_progress_guard' : 'executor_waiting');
      }
      return { context, result, invokeId, rebuild };
    };
    const repairNotesInput: ArtifactSnapshot | undefined = repairNotes ? { [repairNotes.file]: {
      exists: true, contentHash: createHash('sha256').update(repairNotes.text).digest('hex') } } : undefined;
    const driverNotesDelivered = (context?: WorkUnitExecutionContext): boolean => !!repairNotes && !!context
      && (context.workInput?.material ? compareRelatedInputSnapshots(context.workInput.material.repairNotes, repairNotesInput!) === 'unchanged'
        : context.instruction?.includes(`Source: ${repairNotes.file}\n这些是用户提供的返修诊断假设，不改变原需求、验收或授权；依据当前产品与真实检查核实后采用。\n${repairNotes.text}`) === true);
    const authorInstruction = async (work: ReturnType<typeof readWork>, designDeclineFeedback: string, designDeclines: readonly string[]) => {
      const scope = work.input.executionScope;
      const advisory = resolvePhaseCapabilityAdvisory(manifest, projectRoot, frameworkRoot, resolvedProfile,
        work.input.chain.includes('spec') ? 'spec' : 'coding');
      if (advisory?.visionMode === 'delegated' && advisory.visualProvider && advisory.referenceImagePaths.length) {
        try {
          advisory.visualObservationPaths = await produceVisualObservationSidecars({ projectRoot, frameworkRoot, feature: manifest.feature,
            provider: advisory.visualProvider, referenceImages: advisory.referenceImagePaths.map(file => path.resolve(projectRoot, file)),
            evidenceRoot: path.join(runDir, 'visual-review'), runId: manifest.run_id,
            onInvocation: invocation => goalEvents.emit({ ...buildVisualProviderInvokeEvent(invocation) }) });
        } catch (error) { console.warn(`[visual observation] 当前观察工具缺口：${(error as Error).message}；保留其它授权工作。`); }
      }
      const knowledgeInputs = [...new Set(work.input.chain.map(family => extensionInputsForPhase(projectRoot, family,
        { frameworkRoot, feature: manifest.feature, runId: manifest.run_id, requirement: manifest.requirement })).filter(Boolean))];
      const parts = [
      `# 工作单元 ${manifest.feature}`,
      ...(scope ? [`本单元冻结交付目标：${scope.completion_target}`,
        ...scope.requested_results.map(result => `- ${result}`),
        '原始请求及验收来源仍是权威；上述目标限定本单元的交付范围。共享设计归属冲突须交原设计责任方处理。'] : []),
      manifest.requirement ?? '',
      `原请求来源：${(manifest.requirement_source_files ?? []).join(', ') || '当前冻结的原始请求'}`,
      `当前适用检查族：${work.input.chain.join(', ')}。这些是工具/方法，不是轮流启动作者的阶段。`,
      `阅读当前 ${relFeatureFile(projectRoot, manifest.feature, '')} 的权威输入、验收与契约，以及适用的 framework/skills/feature 方法。`,
      '你是本单元持续的专用作者。依真实授权完成设计细化、实现和测试源码，并按需调用框架检查；收到全部反馈后继续原上下文。',
      '独立审查报告由框架派原审查职责处理；其中的未完项仍完整呈现供你理解，不要求实现作者自审自签。',
      '不要改 framework、原请求、正式结果/截图/核验原件或自签 PASS。共享设计/范围变更交原设计单元正式修订，不在本单元自授。',
      '设备安装、真机/截图及凭据操作必须使用框架工具和原设备门；不猜密码、不绕过门、不自行重置设备或读取秘密。',
      '记录具体框架/环境故障及影响，继续所有不依赖它的授权工作；确无安全工作时说明真实等待条件。',
      ...(repairNotes ? [`## Driver repair notes (hypothesis; NOT requirement)\nSource: ${repairNotes.file}\n这些是用户提供的返修诊断假设，不改变原需求、验收或授权；依据当前产品与真实检查核实后采用。\n${repairNotes.text}`] : []),
      ...(advisory ? buildCapabilityBlock(advisory) : []),
      ...(knowledgeInputs.length ? ["Before writing this work unit's artifacts, read the knowledge inputs below that apply to this work unit.", ...knowledgeInputs] : []),
      '当前全部未完项与真实证据：',
      ];
      return buildWorkUnitAuthorInput({ projectRoot, frameworkRoot, feature: manifest.feature, disposition: work.disposition,
        instructions: parts, evaluation: work.evaluation, repairNotes: repairNotesInput, designDeclineFeedback, designDeclines });
    };

    if (entryAuthorization && entryAuthorization.mode !== 'goal_mode' && entryAuthorization.autonomyAuthorized !== true) {
      wait('work-unit-author', '本次缺工作单元的真实执行授权；保留原请求和成果，用户明确授权后接回，不把运输或模式当授权。');
    }
    const currentDeviceGate = async (family: string, invokeId: string, deferredHalts?: Array<Record<string, unknown>>, remainingMs?: number) => {
      const priorSession = readDeviceSession(projectRoot, manifest.report_dir);
      const decision = await (injectedDeviceGate ?? runDeviceReadinessGate)({ phase: family, retries: 0, sessionId: invokeId,
        input: { ...buildDeviceReadinessInput(projectRoot), existingManaged: priorSession?.managed && priorSession.started_by_run === manifest.run_id && priorSession.status !== 'released'
          ? { serial: priorSession.serial, identity: priorSession.managed } : null,
          ...(remainingMs !== undefined && Number.isFinite(remainingMs) ? { emulatorBootBudgetMs: Math.max(1, remainingMs) } : {}) },
        emitEvent: event => {
          if (deferredHalts && event.type === 'phase_halt') deferredHalts.push(event);
          else goalEvents.emit(event);
        } });
      if (decision.managed) {
        if (priorSession?.managed && priorSession.status !== 'released' && priorSession.managed.pid !== decision.managed.pid) {
          const reclaimed = reclaimManagedDevice(priorSession, defaultProcessProbe());
          if (reclaimed.action === 'refused') {
            wait(family, `旧托管实例身份/回收尚不可核实，保留原记录，不能覆盖：${reclaimed.reason}`);
            return null;
          }
        }
        writeDeviceSession(projectRoot, manifest.report_dir, { serial: decision.target?.serial ?? null,
          target_kind: decision.target?.targetKind ?? 'emulator', started_by_run: manifest.run_id, managed: decision.managed,
          status: decision.outcome ? 'failed' : 'ready', ...(decision.outcome ? { note: decision.outcome.halt_guidance } : {}) });
      }
      return decision;
    };
    const awaitDeviceReadiness = async (family: string, sourceInvokeId: string, previouslyBlocked = false) => {
      const deadline = workUnitExecutionInputs(manifest, undefined, projectRoot).user_deadline_at;
      const availableMs = () => deadline ? Math.max(0, Date.parse(deadline) - Date.now()) : Number.POSITIVE_INFINITY;
      const cancelled = () => options.executionControls?.signal?.aborted || availableMs() <= 0;
      if (cancelled()) {
        wait(family, options.executionControls?.signal?.aborted ? '当前请求已取消；不再探测或启动下一检查。' : '用户明示时限已到；不再探测或启动下一检查。');
        return null;
      }
      const deferredHalts: Array<Record<string, unknown>> = [];
      let decision = await currentDeviceGate(family, sourceInvokeId, deferredHalts, availableMs());
      if (!decision || halted) return null;
      const probe = decision.outcome?.probe ?? 'device_readiness';
      const blockedBy = decision.outcome?.halt_reason ?? 'device_not_ready';
      let recovered = !decision.outcome;
      if (recovered && previouslyBlocked && !cancelled()) goalEvents.emit({ type: 'condition_wait_ready', phase: family, probe, blocked_by: blockedBy, waited_ms: 0 });
      if (!recovered && decision.outcome?.probe) recovered = await waitForConditionRecovery({ phase: family, probe, blockedBy,
        reason: decision.outcome.halt_guidance, availableMs: availableMs(), signal: options.executionControls?.signal,
        maxWaitMs: options.conditionWait?.maxWaitMs ?? (runtimeOwnerKind === 'session' ? 0 : undefined),
        ...(options.conditionWait?.pollMs !== undefined ? { pollMs: options.conditionWait.pollMs } : {}),
        runProbe: () => (options.conditionWait?.runProbe ?? ((name: string, phase: string) => runConditionProbe(projectRoot, manifest.report_dir, name, phase)))(probe, family),
        recheck: async remainingMs => {
          if (cancelled()) return 'park';
          assertGoalBoundary('device_condition');
          deferredHalts.length = 0;
          decision = await currentDeviceGate(family, sourceInvokeId, deferredHalts, Math.min(remainingMs, availableMs()));
          return !decision || halted ? 'park' : !decision.outcome;
        },
        emit: event => { goalEvents.emit(event); flushProgress(true, true); },
      });
      if (recovered && !cancelled()) return decision;
      if (!halted) {
        if (cancelled()) wait(family, options.executionControls?.signal?.aborted ? '当前请求已取消；不启动下一检查，成果与未完项保留。' : '用户明示时限已到；不启动下一检查，时限不重置。');
        else wait(family, decision?.outcome?.halt_guidance ?? '原设备条件尚未恢复，保留当前工具结果后接回。',
          decision?.outcome?.halt_reason ?? 'device_not_ready', { probe });
      }
      return null;
    };
    const awaitDeviceCondition = async (family: string, summary: SummaryJson | null): Promise<boolean> => {
      if (summary?.run_id !== manifest.run_id || summary.verdict !== 'INCOMPLETE'
        || !summary.blockers?.some(blocker => blocker.classification === 'device_blocked')) return false;
      const observation = readCurrentCheckObservation({ projectRoot, frameworkRoot, feature: manifest.feature, runId: manifest.run_id, phase: family });
      if (!observation.end || observation.end.timed_out || !observation.start?.invoke_id || observation.conditionReady) return false;
      return !!await awaitDeviceReadiness(family, observation.start.invoke_id, true);
    };
    currentWork: while (!halted && !dryRun) {
      assertGoalBoundary('current_work');
      const deadline = workUnitExecutionInputs(manifest, undefined, projectRoot).user_deadline_at;
      if (options.executionControls?.signal?.aborted || deadline && Date.parse(deadline) <= Date.now()) {
        wait('work-unit-author', deadline && Date.parse(deadline) <= Date.now() ? '用户明示时限已到；成果与未完项保留，时限未重置。' : '当前请求已取消；成果与未完项保留。'); break;
      }
      const before = readWork();
      const restoration = unrestoredAuthorWrites(projectRoot, loadAuthoritativeEvents(eventsPath));
      if (restoration.size) {
        const instructions = `# 原工作单元 ${manifest.feature}\n${manifest.requirement ?? ''}\n`
          + buildPhaseWriteRecoveryContextBlock({ sourcePhase: 'work-unit-author', targetPhase: 'work-unit-author',
            files: [...restoration.keys()], preimages: Object.fromEntries(restoration) });
        const continued = continuationAvailable();
        const repaired = await invokeWork('work-unit-author', instructions, undefined, undefined, continued);
        if (repaired === 3) return 3;
        if (!repaired || halted) break;
        continue;
      }
      if (workCompleted(before)) break;
      const author = lastAuthor();
      let designDeclineFeedback = '';
      let designDeclineCandidates: string[] = [];
      const repairs = before.disposition.completionBlocking.filter(problem => problem.action === 'repair'
        && !before.independent.some(task => task.problems.includes(problem)));
      const designRoot = originalDeliveryForManifest(projectRoot, manifest);
      const designFamilies = [...new Set(repairs.filter(problem => problem.owner === 'external').map(problem => problem.source_phase ?? problem.phase))];
      const findings = designFamilies
          .flatMap(family => {
            const summary = readPhaseSummary(projectRoot, manifest.feature, family as FeaturePhase).summary;
            return diagnoseDesignAuthority(projectRoot, frameworkRoot, manifest.feature, family,
              typeof summary?.run_id === 'string' ? summary.run_id : manifest.run_id).findings;
          });
      if (findings.length) {
        const brief: DesignRepairBriefLike = { class: findings.some(finding => finding.class === 'B2') ? 'B2' : 'B1', items: findings };
        if (designRoot && isInitialDesignManifest(designRoot) && designRoot.run_id !== manifest.run_id) {
          wait('work-unit-author', `当前实际检查指出共享设计差额；交原设计请求 ${designRoot.feature}/${designRoot.run_id} 的专用会话处理，保留本CU实现SID与成果。\n${renderCurrentDisposition(before.disposition)}`,
            'execution_scope_unresolved', { design_authority: brief });
          break;
        }
        if (!runControl || !resolveTaskAutomationPolicy({ fullDelivery: true, autonomyAuthorized: entryAuthorization?.autonomyAuthorized }).automaticDesignRepair) {
          wait('work-unit-author', `当前设计修订缺原请求的真实授权或owner；保留全部成果，恢复该权限后交准确设计单元。\n${renderCurrentDisposition(before.disposition)}`,
            'execution_scope_unresolved', { design_authority: brief }); break;
        }
        const phase = designFamilies[0];
        const signature = designRepairSignature(manifest.feature, phase, brief.items, designRepairInputFingerprint(projectRoot, manifest.feature));
        const candidates = [...new Set(brief.items.flatMap(item => item.basis.match(/repair_candidate:[a-f0-9]{64}/g) ?? []))];
        const actor = { invokeId: author?.start.invoke_id, instruction: author?.original?.request.context.instruction,
          workInput: author?.original?.request.context.workInput };
        const refusal = deriveDesignDeclineFeedback(loadAuthoritativeEvents(eventsPath), candidates, actor);
        if (refusal.feedback) { designDeclineFeedback = refusal.feedback; designDeclineCandidates = candidates.filter(id => !refusal.delivered.includes(id)); }
        else if (!refusal.delivered.length || !before.facts.phases.some(result => affectedCheck(result.phase, before, author))) {
          const repaired = await runUnattendedDesignRepair({ projectRoot, frameworkRoot, feature: manifest.feature,
            designTarget: designRepairTarget(projectRoot, manifest.feature), phase, runId: manifest.run_id, reportDir: manifest.report_dir,
            requirement: manifest.requirement, brief, signature, heldFeatureLock: featureLock,
            runtimeWrites: [manifest.report_dir, ...(featureLock ? [path.relative(projectRoot, featureLock.path)] : [])], emit: goalEvents.emit,
            invoke: async (purpose, prompt, guard) => {
              const explicitlyContinued = continuationAvailable();
              const result = await kernel.invokeDesignOwner(manifest, projectRoot, frameworkRoot, runControl!.token, purpose, prompt, guard, goalEvents.emit,
                explicitlyContinued, acceptedSessionInvokeId);
              if (result.invokeId === acceptedSessionInvokeId) acceptedSessionInvokeId = undefined;
              return result;
            },
            registerLockRelease: release => { designRepairLockRelease = release; },
            recordEventLines: () => { const lines: Array<{ file: string; line: string }> = []; const previous = eventLineRecorder;
              eventLineRecorder = (file, line) => { previous?.(file, line); lines.push({ file, line }); };
              return () => { eventLineRecorder = previous; return lines; }; },
          });
          if (repaired.outcome === 'handoff') { preserveSessionOwner = true; return 3; }
          let returnedFeedback = '';
          if (repaired.outcome === 'failed' && repaired.step === 'declined') {
            const history = loadAuthoritativeEvents(eventsPath);
            const latest = [...history].reverse().find(event => event.type === 'design_authority_repair'
              && (event as Record<string, unknown>).failed_step === 'declined') as Record<string, unknown> | undefined;
            if (!Array.isArray(latest?.declined_candidates) || !latest.declined_candidates.some(id => refusal.delivered.includes(String(id))))
              returnedFeedback = deriveDesignDeclineFeedback(history, candidates, actor).feedback;
          }
          if (returnedFeedback) { designDeclineFeedback = returnedFeedback; designDeclineCandidates = candidates; }
          else {
            if (repaired.outcome === 'published' && repaired.recovered || repaired.outcome === 'failed' && repaired.evaluation?.completed
              && repaired.evaluation.disposition.completionBlocking.some(problem => problem.action === 'repair')) continue;
            if (repaired.outcome === 'failed' && repaired.step !== 'declined' && latestProviderSessionCanRebuild(runDir, loadAuthoritativeEvents(eventsPath))) continue;
            wait('work-unit-author', repaired.reason, repaired.reason.startsWith('no_progress_guard:') ? 'no_progress_guard'
              : repaired.outcome === 'violation' ? 'unauthorized_source_mutation'
              : repaired.outcome === 'containment_unresolved' ? 'agent_containment_unresolved' : 'executor_waiting');
            break;
          }
        }
      }
      const currentEvents = loadAuthoritativeEvents(eventsPath);
      const explicitlyContinued = continuationAvailable();
      const newDriverHypothesis = !!repairNotes && !driverNotesDelivered(author?.original?.request.context);
      const authorFeedbackDelivered = !designDeclineFeedback && !!author?.original && repairs.length > 0
        && !explicitlyContinued && !newDriverHypothesis && (workUnitFeedbackDelivered(author.original!.request.context,
          { ...before.disposition, problems: repairs }) ?? repairs.every(problem => author.original!.request.context.instruction?.includes(
          renderWorkUnitAuthorFeedback({ projectRoot, frameworkRoot, feature: manifest.feature,
            disposition: { ...before.disposition, problems: [problem] } }))));
      const verificationPending = !!author && before.facts.phases.some(result => affectedCheck(result.phase, before, author));
      const authorAssessmentCompleted = before.evaluation.completed
        && repairs.every(problem => before.evaluation.checkFamilies?.includes(problem.source_phase ?? problem.phase))
        && !verificationPending;
      const checkedFeedbackDelivered = !designDeclineFeedback && !explicitlyContinued && !newDriverHypothesis && !!author?.original && completedEvaluations.some(evaluation =>
        evaluation.acceptanceKey === before.evaluation.acceptanceKey && evaluation.completed
        && evaluation.disposition.completionBlocking.some(problem => problem.action === 'repair')
        && feedbackToResponsibleProducers(before, evaluation.disposition, author, currentEvents));
      if (!explicitlyContinued && findLastRunEnd(startupEvents)?.halt_reason === 'no_progress_guard'
        && authorFeedbackDelivered && authorAssessmentCompleted
        && currentEvents.findIndex(event => event.type === 'agent_invoke_end' && event.invoke_id === author?.start.invoke_id)
          < currentEvents.map(event => event.type === 'run_start').lastIndexOf(true)) {
        wait('work-unit-author', `当前有效完成检查仍覆盖原暂停的同一反馈；成果保留，真实相关条件变化或用户明确继续后接回。\n${renderCurrentDisposition(before.disposition)}`, 'no_progress_guard'); break;
      }
      const progress = completionProgressFromHistory(before.evaluation, completedEvaluations, checkedFeedbackDelivered, !!author);
      const feedbackAwaitingEvaluation = authorFeedbackDelivered && (!authorAssessmentCompleted || progress.reused);
      if (progress.halt) { wait(repairs.length ? 'work-unit-author' : before.independent[0]?.owner ?? 'work-unit-author',
        `已向当前责任方交付反馈且真实检查仍无验收改善，保全后可续暂停。\n${renderCurrentDisposition(before.disposition)}`, 'no_progress_guard'); break; }
      if (before.evaluation.completed && !progress.reused && progress.evaluation === before.evaluation) completedEvaluations.push(before.evaluation);
      if (!author || newDriverHypothesis || designDeclineFeedback || repairs.length && !feedbackAwaitingEvaluation && !verificationPending) {
        const prepared = await authorInstruction(before, designDeclineFeedback, designDeclineCandidates);
        const invoked = await invokeWork('work-unit-author', prepared.instruction, undefined, undefined, explicitlyContinued, prepared.workInput);
        if (invoked === 3) return 3;
        if (!invoked || halted) break;
        if (invoked.rebuild) continue;
        if (unrestoredAuthorWrites(projectRoot, loadAuthoritativeEvents(eventsPath)).size) continue;
      }
      let executedCheck = false;
      let rebuildTransport = false;
      const pausedIndependent = new Set<string>();
      const selectedFamilies = familiesNow();
      for (const family of selectedFamilies) {
        assertGoalBoundary('current_check');
        if (options.executionControls?.signal?.aborted || deadline && Date.parse(deadline) <= Date.now()) {
          wait(family, '用户取消或明示时限已到；不启动下一检查，保留真实结果与未完项。'); break;
        }
        let current = readWork();
        if (!current.facts.phases.some(result => result.phase === family)) continue;
        const independent = current.independent.find(task => task.owner === family);
        if (independent && !affectedCheck(family, current)) {
          const actor = lastAuthor();
          const authorResult = actor?.end.handoff_report
            ? path.resolve(runDir, actor.end.handoff_report.path)
            : actor?.start.invoke_id ? path.join(runDir, 'phases', actor.start.phase!, actor.start.invoke_id, 'agent-output.log') : undefined;
          const reportRel = path.relative(projectRoot, independent.file).replace(/\\/g, '/');
          const instruction = [
            `独立审查本工作单元 ${manifest.feature}，按 ${phaseSkillPath(frameworkRoot, family as FeaturePhase)} 的正式方法写入 ${reportRel}。`,
            `冻结交付目标：${(current.input.executionScope?.requested_results ?? []).join('\n')}`,
            `读取当前 canonical CU、设计来源、实际改动及作者原件；设计与 CU 归属冲突须在问题表列明具体权威文件和依据，交原责任方修订。`,
            ...(authorResult ? [`作者原件：${path.relative(projectRoot, authorResult).replace(/\\/g, '/')}。完整保留其中的拒修理由并独立核实；原件缺失时如实披露，不猜测作者结论。`] : []),
            '本次只写指定审查报告；不修改产品、测试、设计或正式机器结果，不替作者自签完成。',
            renderCurrentDisposition(current.disposition),
          ].join('\n');
          const observed = readCurrentCheckObservation({ projectRoot, frameworkRoot, feature: manifest.feature, runId: manifest.run_id, phase: family });
          // The report is a checker input, not new work created by its own writer's previous output.
          const writerInputs = Object.fromEntries(Object.entries(observed.inputs).filter(([file]) => file !== reportRel));
          const relevantChecks = current.results.filter(result => result.phase === family).map(result => ({ ...result,
            checks: result.checks.filter(check => check.affected_files?.some(file => path.resolve(projectRoot, file) === independent.file)) }));
          const disposition = resolveCurrentDisposition({ endpoint: 'request', phases: [], additionalProblems: independent.problems });
          const evaluation = { ...currentCompletionEvaluation({ ...current.input, chain: [family], currentResults: relevantChecks }, disposition), inputs: writerInputs };
          const history = loadAuthoritativeEvents(eventsPath);
          const calls = independentCalls(independent, history);
          const previous = calls.at(-1);
          const checkedAt = history.map(event => event.type === 'harness_end' && event.phase === family
            && event.invoke_id === observed.end?.invoke_id && event.ts === observed.end?.ts).lastIndexOf(true);
          const continued = continuationAvailable();
          const product = previous ? readReturnedWorkProduct(previous.context, previous.original, history, previous.index) : undefined;
          const delivered = !!previous && !!product && !('status' in product) && !product.current.failureReason && !product.productChanged
            && compareRelatedInputSnapshots(previous.evaluation.inputs, evaluation.inputs) === 'unchanged'
            && workUnitFeedbackDelivered(previous.context, previous.evaluation.disposition) === true;
          const progress = completionProgressFromHistory(evaluation, calls.map(call => call.evaluation), delivered,
            !!previous && checkedAt > previous.ended);
          if (!continued && progress.halt) {
            // Finish other executable work before pausing; an unexecutable verify cannot buy another loop.
            pausedIndependent.add(independent.file);
            continue;
          }
          const reviewed = await invokeWork(independent.owner, instruction, independent.file, independent.owner, continued,
            { material: { purpose: independent.owner, segments: [instruction, writerInputs] }, evaluation });
          if (reviewed === 3) return 3;
          if (!reviewed || halted) break;
          continue currentWork;
        }
        let summary = readPhaseSummary(projectRoot, manifest.feature, family as FeaturePhase).summary;
        if (current.results.some(result => result.phase === family) && await awaitDeviceCondition(family, summary)) current = readWork();
        if (halted) break;
        let bound = current.results.find(result => result.phase === family);
        let affected = affectedCheck(family, current);
        if (bound && !affected) {
          reviseCurrentScope(family);
          if (halted) break;
          current = readWork();
          bound = current.results.find(result => result.phase === family);
          affected = affectedCheck(family, current);
        }
        summary = readPhaseSummary(projectRoot, manifest.feature, family as FeaturePhase).summary;
        if (bound && !affected && summary?.verifier_request && summary.verifier_report && summary.verifier_subject_id) {
          const actor = lastAuthor();
          const notes = repairNotes && actor?.original && driverNotesDelivered(actor.original.request.context)
            ? [{ label: path.relative(projectRoot, path.resolve(runDir, actor.original.reference.path)).replace(/\\/g, '/'),
              content: `Driver repair notes (hypothesis; NOT requirement)\nSource: ${repairNotes.file}\n${repairNotes.text}` }] : [];
          const refreshed = (require('../harness-runner') as typeof import('../harness-runner')).refreshVerifierRequestContext({
            projectRoot, frameworkRoot, feature: manifest.feature, phase: family, runId: manifest.run_id, additionalContextFiles: notes });
          if (refreshed && refreshed.verifier_subject_id !== summary.verifier_subject_id) current = readWork();
          summary = refreshed ?? summary;
        }
        const problems = phaseCompletionProblems(current.disposition, [family]);
        if (bound && !affected && (!problems.length || problems.every(problem => problem.action === 'repair' || problem.action === 'disclose'))) continue;
        if (bound && !affected && summary?.verifier_request && summary.verifier_report && summary.verifier_subject_id) {
          const pendingRequest = summary.verifier_request;
          const pendingReport = summary.verifier_report;
          const pendingSubject = summary.verifier_subject_id;
          const pendingReportPath = path.resolve(projectRoot, validateProjectRelativePath(projectRoot, pendingReport, 'verifier report'));
          const requestText = fs.readFileSync(path.resolve(projectRoot, validateProjectRelativePath(projectRoot, pendingRequest, 'verifier request')), 'utf8');
          const request = parseVerifierRequest(requestText);
          if (request && request.feature === manifest.feature && request.phase === family && request.subject_id === pendingSubject) {
            const needsVerifier = problems.some(problem => problem.id === 'attestation_present' && problem.action === 'verify'
              && problem.files?.some(file => path.resolve(projectRoot, file) === pendingReportPath));
            if (needsVerifier) {
              const verifierHistory = loadAuthoritativeEvents(eventsPath);
              const formatRepair = verifierHistory.some(start => {
                if (start.type !== 'agent_invoke_start' || !start.invoke_id || start.phase !== `${family}-verifier-format-repair`) return false;
                const prior = executionRequestForInvoke(runDir, start.invoke_id);
                const previous = prior && parseVerifierRequestFromInstruction(prior.request.context.instruction ?? '');
                const end = verifierHistory.slice(verifierHistory.indexOf(start) + 1).find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
                return !!previous && canonicalRequestInput(previous) === canonicalRequestInput(request)
                  && !!end && invocationCompleted({ ...end, exitCode: end.exit_code });
              });
              const formatFeedback = formatRepair ? '上次核验未交回可用对象，请按既有格式返回。' : '';
              const verificationWork = readWork();
              const instruction = `独立核验当前原件；读取request.prompt_path，完整回复原样写入 ${pendingReport}。不得修改实现、验收或正式机器结果。\n${renderCurrentDisposition(verificationWork.disposition)}\n${formatFeedback ? formatFeedback + '\n' : ''}${requestText}`;
              const invoked = await invokeWork(`${family}-verifier-format-repair`, instruction,
                pendingReportPath, 'verifier_format_repair', continuationAvailable(), { material: { purpose: 'verifier_format_repair',
                  segments: [dispositionFacts(verificationWork.disposition), canonicalRequestInput(request), formatFeedback] }, evaluation: verificationWork.evaluation });
              if (invoked === 3) return 3;
              if (!invoked || halted) break;
              if (invoked.rebuild) { rebuildTransport = true; break; }
              executedCheck = true;
            }
            const producer = phaseInvocationStart(loadAuthoritativeEvents(eventsPath), family);
            const original = producer?.invoke_id ? executionRequestForInvoke(runDir, producer.invoke_id) : null;
            if (!original) { wait(family, '独立核验已交回，但原检查作者request/attempt原件缺失；恢复该原件后接回，不能猜检查身份。'); break; }
            try { finalizePhaseClosure({ projectRoot, frameworkRoot, feature: manifest.feature, phase: family, goalRunId: manifest.run_id,
              goalAttemptId: original.request.context.attemptId, factsContext: original.request.context.factsContext, persistPhaseState: () => undefined }); }
            catch { /* The same reader reports the actual independent rejection or missing evidence. */ }
            reviseCurrentScope(family);
            if (halted) break;
            if (consumeCompletedBoundaryHandoff()) return 0;
            if (needsVerifier || !continuationAvailable()) continue;
            current = readWork();
          }
        }
        const producerContinued = continuationAvailable() && phaseCompletionProblems(current.disposition, [family])
          .some(problem => problem.action === 'verify' || problem.action === 'wait');
        if (bound && !affected && !producerContinued) continue; // A completed current unknown waits unless a real continuation observes this pending producer once.
        const actor = lastAuthor();
        if (!actor?.original) { wait(family, '缺原工作单元作者的真实请求/交回，不能虚构检查身份；恢复该原件后接回。'); break; }
        const attemptId = actor.original.request.context.attemptId;
        const invokeId = `${family}-${attemptId}`;
        const conditions = checkWorkConditions(family, current, actor);
        const checkObservation = conditions.observation;
        if (!hasNewWorkConditions({ returned: checkObservation.returned, explicitlyContinued: producerContinued, materialChanged: checkObservation.changed,
          productChanged: conditions.productChanged, scopeChanged: conditions.scopeChanged })) {
          // An unchanged returned check is reusable observation, not an external wait.
          continue;
        }
        const telemetry = runRuntimeTelemetryPreflightGate({ projectRoot, feature: manifest.feature, phase: family as FeaturePhase,
          retries: 0, resolvedProfile, emitPhaseVerdict: event => goalEvents.emitPhaseVerdict(event) });
        if (telemetry) { outcomes.push(telemetry.outcome); continue; }
        const capability = (injectedCapabilityGate ?? runInvokeCapabilityGate)({ projectRoot, phase: family as FeaturePhase, retries: 0,
          resolvedProfile, emitEvent: event => goalEvents.emit(event as Record<string, unknown>) });
        if (capability) { outcomes.push(capability.outcome); continue; }
        let deviceEnv: Record<string, string> = {};
        if (phaseRequiresDevice(family as FeaturePhase, resolvedProfile)) {
          const decision = await awaitDeviceReadiness(family, invokeId);
          if (!decision) break;
          if (decision.outcome) { outcomes.push(decision.outcome); continue; }
          deviceEnv = decision.env ?? {};
        }
        if (family === 'testing') {
          if (!commitVisualJournal(attemptId, actor)) break;
          try { fs.rmSync(deviceTestEvidencePath(featurePhaseReportsDir(projectRoot, manifest.feature, family, frameworkRoot)), { force: true }); } catch { /* The existing identity reader retains any failed cleanup as unknown. */ }
          deviceEnv = { ...deviceEnv, HARNESS_DEVICE_TEST_FORCE_INSTALL: '1' };
        }
        const started = Date.now();
        emitMilestone(`GOAL_WORK event=check family=${family} actor=${actor.start.invoke_id}`);
        progressPhase = family; progressSubstep = 'harness'; flushProgress();
        activeExecutionControls = options.executionControls;
        let checked: HarnessPhaseResult;
        try { checked = await runHarnessPhase(projectRoot, frameworkRoot, family as FeaturePhase, manifest.feature, dryRun, manifest,
          { runId: manifest.run_id, attemptId, actorPhase: actor.original.request.context.phase, relatedInputs: checkObservation.inputs }, deadline ? Math.max(1, Date.parse(deadline) - Date.now()) : undefined, deviceEnv); }
        finally { activeExecutionControls = undefined; }
        const endedAt = Date.now();
        let returnedInputs: ArtifactSnapshot | undefined;
        if (!checked.waitingDetail && !checked.timedOut && checked.currentCheckObserved) {
          try { returnedInputs = readCurrentCheckObservation({ projectRoot, frameworkRoot, feature: manifest.feature,
            runId: manifest.run_id, phase: family }).inputs; }
          catch { /* An unreadable handback cannot replace the original observed inputs. */ }
        }
        if (!checked.waitingDetail) goalEvents.emit({ type: 'harness_end', phase: family, invoke_id: invokeId, exit_code: checked.exitCode,
          timed_out: checked.timedOut, duration_ms: endedAt - started,
          ...(returnedInputs ? { related_input_snapshot: returnedInputs } : {}) });
        executedCheck = executedCheck || !checked.waitingDetail;
        if (checked.waitingDetail || checked.timedOut) {
          outcomes.push({ phase: family as FeaturePhase, verdict: 'INCOMPLETE', halted: true, retries: 0, halt_reason: 'executor_waiting', halt_guidance: checked.waitingDetail ?? '当前工具尚未提供可信结束结果，恢复原工具条件后仅补本检查。' });
          continue;
        }
        if (family === 'testing') {
          if (checked.currentCheckObserved && !commitVisualJournal(attemptId, actor)) break;
          const reports = featurePhaseReportsDir(projectRoot, manifest.feature, family, frameworkRoot);
          const device = { attemptId, projectRoot, reportsDir: reports,
            expectedTarget: { serial: deviceEnv.HARNESS_HDC_TARGET ?? null, target_kind: deviceEnv.MAISON_DEVICE_TARGET_KIND ?? null, session_id: deviceEnv.MAISON_DEVICE_SESSION_ID ?? null },
            harnessWindow: { startMs: started, endMs: endedAt }, currentHapSha256Full: resolveCurrentHapSha256Full(projectRoot, reports) };
          commitGateDeviceEvidenceProposal(projectRoot, manifest.feature, manifest.run_id, device);
          const visual = readFreshVisualDisposition(path.join(reports, 'summary.json'), { runId: manifest.run_id, attemptId, startedAtMs: started });
          const collected = collectActionableDefects(projectRoot, manifest.feature, manifest.run_id, device, visual.downgradedScreens, visual.t8Findings);
          if (collected.unverified.length) goalEvents.emit({ type: 'unverifiable_must_fix', phase: family, invoke_id: invokeId, entries: collected.unverified, count: collected.unverified.length });
        }
        const report = readPhaseSummary(projectRoot, manifest.feature, family as FeaturePhase).summary;
        const currentReport = checked.currentCheckObserved ? report : null;
        const verdict = currentReport?.verdict ?? 'INCOMPLETE';
        const failure = buildCurrentAttemptFailureProjection({ decisionSummary: currentReport,
          failureKind: currentReport ? classifyFailureKind(currentReport, manifest.dependency_policy, { staleSummary: false })
            : 'deterministic_gate_or_artifact_missing',
          phase: family, hasRuntimeFailureEvidence: checked.exitCode !== 0 });
        const diagnostic = checked.outputTail?.replace(/\s+/g, ' ').trim().slice(-1000);
        goalEvents.emitPhaseVerdict({ phase: family, invoke_id: invokeId, verdict, harness_exit: checked.exitCode,
          stale_summary: !checked.currentCheckObserved && !!report,
          ...(failure.failureKindForEvent ? { failure_kind_classified: failure.failureKindForEvent } : {}),
          ...(failure.blockerSignature ? { blocker_signature: failure.blockerSignature } : {}),
          ...(diagnostic ? { harness_error_excerpt: diagnostic } : {}) });
        outcomes.push({ phase: family as FeaturePhase, verdict: verdict as HarnessVerdict, halted: !currentReport && checked.exitCode !== 0, retries: 0,
          ...(!currentReport && checked.exitCode !== 0 ? { halt_reason: 'executor_waiting' } : {}),
          ...(!checked.currentCheckObserved && diagnostic ? { halt_guidance: `[${family}] 当前工具未形成有效检查原件：${diagnostic}` } : {}) });
        const recovered = await awaitDeviceCondition(family, currentReport);
        if (halted) break;
        if (recovered) continue currentWork;
        if (!report) continue;
        try { finalizePhaseClosure({ projectRoot, frameworkRoot, feature: manifest.feature, phase: family, goalRunId: manifest.run_id,
          goalAttemptId: attemptId, factsContext: actor.original.request.context.factsContext, persistPhaseState: () => undefined }); } catch { /* Current rejection stays in the common view. */ }
        reviseCurrentScope(family);
        if (halted) break;
        if (consumeCompletedBoundaryHandoff()) return 0;
      }
      if (halted) break;
      if (consumeCompletedBoundaryHandoff()) return 0;
      if (rebuildTransport) continue;
      const after = readWork();
      if (workCompleted(after)) break;
      const currentOutcomes = new Map<string, GoalPhaseOutcome>();
      for (const outcome of outcomes) currentOutcomes.set(String(outcome.phase), outcome);
      const blockedProbe = [...currentOutcomes.values()].find(outcome => (outcome.probe || outcome.deferred || outcome.halted && outcome.verdict === 'INCOMPLETE'
        && outcome.halt_reason === 'executor_waiting') && after.disposition.completionBlocking.some(problem =>
        (problem.source_phase ?? problem.phase) === outcome.phase));
      if (blockedProbe) {
        wait(String(blockedProbe.phase), `${blockedProbe.halt_guidance ?? '原能力或设备条件尚未恢复。'}\n${renderCurrentDisposition(after.disposition)}`,
          blockedProbe.halt_reason ?? 'executor_waiting', blockedProbe.probe ? { probe: blockedProbe.probe } : {});
        break;
      }
      const activeFamilies = familiesNow();
      if (after.facts.phases.some(result => {
        if (!activeFamilies.includes(result.phase)) return false;
        const conditions = checkWorkConditions(result.phase, after);
        if (conditions.observation.end && !conditions.observation.end.timed_out
          && (conditions.observation.changed || conditions.productChanged || conditions.scopeChanged)) return true;
        if (after.results.some(bound => bound.phase === result.phase) && result.lineage !== 'stale' && result.lineage !== 'missing') return false;
        return !selectedFamilies.includes(result.phase);
      })) continue;
      if (after.disposition.completionBlocking.some(problem => problem.action === 'repair')) {
        const paused = after.independent.filter(task => pausedIndependent.has(task.file));
        if (paused.length && after.disposition.completionBlocking.filter(problem => problem.action === 'repair')
          .every(problem => paused.some(task => task.problems.includes(problem)))) {
          if (executedCheck) continue;
          wait(paused[0].owner, `独立职责已收到反馈并交回产物，实际检查证明相同问题未解决或往复出现；其它职责本轮也无可执行工作，保留原件与未完项，条件变化后接回。\n${renderCurrentDisposition(after.disposition)}`, 'no_progress_guard');
          break;
        }
        if (feedbackAwaitingEvaluation && !executedCheck) {
          wait('work-unit-author', `同一工作、当前必修对象和相关输入已有真实作者交回，当前结果没有新的可执行验证；不重派同一反馈。保留未完项，补齐原验证依据、相关条件变化或用户明确继续后接回。\n${renderCurrentDisposition(after.disposition)}`);
          break;
        }
        continue;
      }
      if (executedCheck && familiesNow().some(family => {
        const summary = readPhaseSummary(projectRoot, manifest.feature, family as FeaturePhase).summary;
        if (!summary?.verifier_request || !summary.verifier_report || !summary.verifier_subject_id) return false;
        try {
          const request = parseVerifierRequest(fs.readFileSync(path.resolve(projectRoot,
            validateProjectRelativePath(projectRoot, summary.verifier_request, 'verifier request')), 'utf8'));
          return !!request && request.feature === manifest.feature && request.phase === family && request.subject_id === summary.verifier_subject_id;
        } catch { return false; }
      })) continue;
      wait(after.disposition.completionBlocking[0]?.source_phase ?? after.disposition.completionBlocking[0]?.phase ?? 'work-unit-author',
        `当前真实调用/检查已经结束，剩余为原producer、独立核验或环境条件缺口；同条件不重派。解除条件满足后接原run，只补受影响部分。\n${outcomes.filter(outcome => outcome.verdict === 'INCOMPLETE' && outcome.halt_guidance).map(outcome => outcome.halt_guidance).join('\n')}\n${renderCurrentDisposition(after.disposition)}`);
    }


    // Current bound results decide completion; outcomes remain the historical execution report.
    const latestOutcome = (phase: string) => [...outcomes].reverse().find(outcome => String(outcome.phase) === phase);
    const terminalScope = !dryRun && birthScope ? applyScopeRevisions(birthScope, loadAuthoritativeEvents(eventsPath)) : undefined;
    const terminalChain = applicableCheckFamilies(terminalScope, terminalEventCtx?.chain.map(String) ?? chain.map(String));
    const terminalDisposition = !dryRun ? resolveCompletionDisposition({ projectRoot, frameworkRoot, feature: manifest.feature,
      chain: terminalChain, executionScope: terminalScope, workflow, runId: manifest.run_id }) : null;
    const currentCompletionSatisfied = terminalDisposition?.completionEligible === true;
    const reachedEnd = !halted && (terminalDisposition ? currentCompletionSatisfied : (terminalChain.length > 0 && terminalChain.every(phase => {
      const latest = latestOutcome(String(phase));
      return latest?.verdict === 'PASS' && !latest.advance_blocked;
    })));

    let status: GoalRunStatus = !dryRun && reachedEnd && currentCompletionSatisfied ? 'CHAIN_SLICE_COMPLETED' : dryRun ? 'PARTIAL' : 'HALTED';

    // 完成原件在成功封卷前生成。必需的原件未形成时沿现有恢复出口停放，保留已完成工作。
    // B3: read the EFFECTIVE scope. A [spec]-born run keeps a non-empty `unresolved` in its birth
    // scope forever, so judging eligibility on the birth value made completion structurally
    // unreachable for D2's main scenario (spec discovers a device duty, run continues, completes).
    const completionScope = manifest.execution_scope
      ? applyScopeRevisions(validateExecutionScope(manifest.execution_scope), loadAuthoritativeEvents(eventsPath))
      : undefined;
    const completionChain = applicableCheckFamilies(completionScope, fullWorkflowChain).map(String);
    const requiresFeatureCompletion = completionScope?.completion_target === 'feature';
    const completionFailed = (detail: string, incident: string = 'framework_bug'): void => {
      status = 'HALTED';
      const phase = completionChain.at(-1) ?? String(manifest.end_phase);
      goalEvents.emit({ type: 'phase_halt', phase, halt_reason: incident, reason: detail, halt_guidance: detail });
      outcomes.push({ phase: phase as FeaturePhase, verdict: 'FAIL', halted: true, retries: 0, halt_reason: incident, halt_guidance: detail });
    };
    if (!dryRun && status === 'CHAIN_SLICE_COMPLETED') {
      try {
        // D1 §6.5：生成资格判据与无 run 出口**同一个函数**（范围终点 / unresolved / clean-pass），
        // 这里只保留本路径独有的前置条件（run 终局为 CHAIN_SLICE_COMPLETED）。
        const { eligible, issues } = shouldGenerateFeatureCompletion(completionScope, {
          projectRoot,
          feature: manifest.feature,
          workflow,
          // Recomputed here, not reused from startup: a revision may have changed the chain since.
          chain: completionChain,
          // D2: evidence this very run just closed is unsealed by design; historical runs unchanged.
          runId: manifest.run_id,
          frameworkRoot,
        });
        if (eligible) {
          const { runIds: phaseRunIds, attempts: phaseAttempts } = resolvePhaseRunIds(
            projectRoot, manifest.feature, completionChain,
          );
          for (const o of outcomes) phaseRunIds[String(o.phase)] = manifest.run_id;
          const { originalAbs } = generateFeatureCompletion({
            projectRoot,
            feature: manifest.feature,
            workflow,
            // Same chain the clean-pass check above used; the startup value predates any revision.
            chain: completionChain,
            workflowTrack: goalTrack,
            runId: manifest.run_id,
            runDirAbs: path.join(projectRoot, manifest.report_dir),
            phaseRunIds,
            phaseAttempts,
            supersedes: supersededRunIds,
            frameworkRoot,
          });
          emitMilestone(
            `GOAL_RUN event=feature_completion_generated path=${path.relative(projectRoot, originalAbs).replace(/\\/g, '/')} run_id=${manifest.run_id}`,
          );
        } else {
          if (requiresFeatureCompletion) completionFailed(`完成原件资格未满足：${issues.map(issue => `[${issue.phase}] ${issue.condition}: ${issue.detail}`).join('；') || '当前范围尚未完成'}`);
          emitMilestone(
            // 'pending=N' alone forces every reader to guess which duty blocked the certificate;
            // name the issues (same lesson as the stale changed_paths projection).
            `GOAL_RUN event=feature_completion_skipped reason=${issues.length ? 'non_clean_pass' : 'scope_not_complete'} pending=${issues.length} run_id=${manifest.run_id} issues=${issues.slice(0, 6).map(issue => `[${issue.phase}] ${issue.condition}: ${issue.detail}`).join(' | ')}`,
          );
        }
      } catch (err) {
        const detail = `feature completion 生成失败：${(err as Error).message}`;
        console.warn(`[goal-runner] ${detail}`);
        if (requiresFeatureCompletion) completionFailed(detail);
      }
    }
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
      frameworkRoot,
      currentDisposition: terminalDisposition ?? undefined,
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
      | (Record<string, unknown> & { run_disposition?: unknown; run_wait_kind?: unknown; probe?: unknown })
      | undefined;
    const lastHaltedProjected =
      lastHalted && typeof lastHalted.run_disposition === 'string' ? lastHalted : undefined;
    // 诊断保真：halt 引导首行（如适配器 400 原文）随终态事件带出，与 goal-report Reason 列同源；
    // 与紧急收口 run_end{HALTED, error} 同键，不参与任何裁决。
    const lastHaltDetail = typeof lastHalted?.halt_guidance === 'string'
      ? lastHalted.halt_guidance.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      : undefined;
    goalEvents.emit({
      type: 'run_end',
      status,
      ...(status === 'HALTED' && lastHaltReason ? { halt_reason: lastHaltReason } : {}),
      ...(status === 'HALTED' && lastHaltDetail ? { error: lastHaltDetail.slice(0, 1000) } : {}),
      ...(status === 'HALTED' && lastHaltedProjected
        ? {
            run_disposition: lastHaltedProjected.run_disposition,
            ...(typeof lastHaltedProjected.run_wait_kind === 'string'
              ? { run_wait_kind: lastHaltedProjected.run_wait_kind }
              : {}),
            // plan 4e6fb3b6 §5.2：run_end 带了投影就成为来源事件——探针与责任阶段同源带上，
            // 否则 supervisor 的探针唤醒对 HALTED 收尾的 run 失效。run_end 无 phase，责任阶段记 probe_phase。
            ...(typeof lastHaltedProjected.probe === 'string' && lastHaltedProjected.probe
              ? { probe: lastHaltedProjected.probe, probe_phase: String(lastHaltedProjected.phase) }
              : {}),
          }
        : {}),
    });

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
    if (status === 'PARTIAL') return 2;
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

  void new GoalPhaseRuntime().run()
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
