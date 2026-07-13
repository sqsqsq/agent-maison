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
import { buildAwaitHumanConfirmGuidance, buildClosureWallGuidance } from './utils/await-confirm-guidance';
import { loadResolvedProfile } from '../profile-loader';
import type { HarnessResolvedProfile } from './utils/types';
import { resolveWorkflowSpec } from '../workflow-loader';
import { resolveContextAdapterImageInput, isVisionCanaryFresh } from './utils/multimodal-probe';
import { loadLocalConfig as loadFrameworkLocalConfig } from './utils/framework-local-config';
import {
  clampFidelityByCapability,
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
} from './utils/ui-spec-shared';
import {
  classifyPhaseVerdict,
  formatDeferredUpstreamNotice,
  resolveAutoChain,
  resolveGoalRunStatus,
  type FeaturePhase,
  type HarnessVerdict,
} from './utils/phase-transition-policy';
import { resolveFeatureTrack } from './utils/runtime-policy';
import { loadFeatureTrackDecl } from './utils/feature-track';
import { mergeUsageIntoTraceFile } from './utils/usage-capture';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFile,
  loadGoalManifestFromRun,
  newRunId,
  writeGoalManifest,
  type GoalManifest,
} from './utils/goal-manifest';
import {
  collectPhaseTimeoutWarnings,
  resolvePhaseTimeoutMs,
  resolveWallClockMs,
} from './utils/goal-timeout';
import {
  deriveResumeInspection,
  buildResumeSkipLines,
  deriveReportSections,
  deriveAndWriteCheckpoint,
  readPhaseCheckpointTimedOut,
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
  resolveHeadlessInvokePlan,
  type InvokeTemplateVars,
} from './utils/agent-invoke';
import { createHash } from 'crypto';
import { produceCriticReceipt } from './utils/critic-receipt-producer';
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
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolvePhaseHarnessVerdict,
  resolveResumedBudget,
  resolveResumeFromEvents,
  resolveResumeState,
  resolveWallClockStartMs,
  countCumulativeAdvanceBlocked,
  countRepeatedSignatureInFamily,
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
  tryValidateReceipt,
} from './utils/phase-state';
import { loadGoalCapability } from './utils/goal-adapter-capability';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
  reconcileRunAdapter,
  decideVisionCanaryProbe,
  runVisionCanaryProbe,
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
  buildEffectiveBlockerSignature,
  classifyFailureKind,
  extractDeterministicAffectedFiles,
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
  roundIdentity?: { runId: string; attemptId: string },
): Promise<number> {
  if (dryRun) return 0;
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
  const assumptionsRel = relFeatureFile(projectRoot, manifest.feature, `${phase}/headless-assumptions.md`);
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
    `- Record **every** auto-decision in \`${assumptionsRel}\` with provenance \`auto-approved (goal-mode), pending human review\`.`,
    '- `freeform_approval` gates (scope expansion, src mutation): **conservative default** — do NOT expand scope / do NOT mutate protected src; log deferred request in headless-assumptions.md.',
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
    isUiRelevant = detectUiRelevantRequirement(manifest.requirement);
    desired = detectPixel1to1Intent(manifest.requirement) ? 'pixel_1to1' : 'semantic_layout';
  }
  if (!isUiRelevant) return null;

  const mmProbe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, manifest.adapter);
  const toolkit = loadProfileOcrToolkit(resolvedProfile.profileDir);
  // E1：金丝雀 verdict=ocr_capable 是补充信号（agent 自身展示了从图片提取文字的能力，即便
  // 判定其无视觉）——OR 进 ocrAvailable，不替代框架自身 OCR 环境探测（后者更可靠/确定性）。
  // cursor review（E6 后）：与 harness-runner.ts 门禁钳制共用同一口径，不再各算一遍。
  const ocrAvailable = resolveOcrAvailableForRun(projectRoot, resolvedProfile.profileDir, manifest.adapter);
  const clamp = clampFidelityByCapability(desired, { hasVision: mmProbe.supported, ocrAvailable });

  // spec 是 OCR 预扫描的唯一生产者（有真实 OCR 耗时）；plan/coding 只列出盘上已有的产物
  // （宿主复验修复①——此前 plan/coding 恒为空数组，能力块对 agent 谎称"没找到参考图"）。
  const ocrJsonPaths = !mmProbe.supported && ocrAvailable
    ? phase === 'spec' && toolkit
      ? runOcrPrescanForSpec(projectRoot, frameworkRoot, resolvedProfile, manifest, toolkit)
      : listExistingOcrPrescanOutputs(projectRoot, frameworkRoot, manifest.feature)
    : [];

  return {
    hasVision: mmProbe.supported,
    ocrAvailable,
    effectiveFidelity: clamp.effective,
    fidelityClamped: clamp.clamped,
    ocrJsonPaths,
  };
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
  if (hasArtifacts || hasSkipLines) {
    parts.push(
      '',
      '## Prior attempt TIMED OUT — resume from partial work (NOT a content failure)',
      '',
      'The previous attempt of this phase was interrupted by a wall-clock timeout, not by a content/quality failure. **Re-read the partial work first and CONTINUE the unfinished parts — do NOT redo exploration/analysis from scratch.**',
    );
    if (hasArtifacts) {
      parts.push('', 'Already (partially) written to disk:', '', ...partialResumeArtifacts!.map(f => `- ${f}`));
    }
    if (hasSkipLines) {
      parts.push(...resumeSkipLines!);
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
        'Do NOT revert or rewrite application code to "fix" it. Diagnose the environment: device connection / hdc / build toolchain / screenshot permissions.',
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
    string: ['feature', 'requirement', 'adapter', 'adapter-source', 'start', 'end', 'resume', 'manifest', 'run-id'],
    boolean: [
      'help', 'dry-run', 'force-resume', 'override-start', 'override-end', 'override-manifest',
      'override-adapter',
      'detach', 'detached-child', 'force', 'foreground-ok',
      'refresh-vision-probe',
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
    // P0-A：显式 timeout 低于建议地板只 WARN 不抬升（尊重显式 override 契约）。
    for (const warn of collectPhaseTimeoutWarnings(manifest, chain)) {
      console.warn(warn);
    }

    for (let phaseIdx = chainStartIndex; phaseIdx < chain.length; phaseIdx++) {
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
        // P0-B/P0-D：上轮 agent 级中断以内存信号为准——summary 重算只见症状 blocker
        // （断流的 spec_file_exists 会被误算 deterministic_gate，prompt 指导随之错向）。
        if (priorAttemptApiError) priorFailureKind = 'transient_api_error';
        else if (priorAttemptTimedOut) priorFailureKind = 'agent_timeout';

        // P1-B/P2：上轮因超时中断（非内容失败）时，把已落盘 partial 产物 + 已检视文件 skip-list
        // 回喂，让重试续作而非从零重做探索。跨进程 resume 首轮从 checkpoint.json 回读上轮 timed_out
        // （补 in-process priorAttemptTimedOut 在新进程丢失的缺口）。
        const isResumeFirstRound = Boolean(argv.resume) && phaseIdx === chainStartIndex && retries === 0;
        const timedOutForResume =
          priorAttemptTimedOut ||
          (isResumeFirstRound &&
            readPhaseCheckpointTimedOut(projectRoot, manifest.report_dir, phase));
        // P0-D：API 断流与超时同类——上轮被基建原因打断而非内容失败，partial 产物照样续作。
        const interruptedForResume = timedOutForResume || priorAttemptApiError;
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

        // E0：UI 需求 spec/plan/coding phase 能力感知——非 UI 相关 / 其余 phase 返回 null，
        // 不注入能力块（不打扰无关 phase 的 prompt）。
        const capabilityAdvisory = resolvePhaseCapabilityAdvisory(
          manifest,
          projectRoot,
          frameworkRoot,
          resolvedProfile,
          phase,
        );

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
        // t1（f7a3d9c2，终审遗留②）：invoke_id 升级为 run 级持久序数（totalTurns 从 events
        // 回放恢复，跨 --resume 单调），不再只靠系统时钟。visualAttemptId=轮次账本的
        // attempt 身份：同一 invocation 的 agent 自跑 harness 与外层 gate 共用；任何
        // 下一次 invocation（retry/detach/resume）必不同；崩溃恢复不重用（事件已落盘
        // 则 totalTurns 回放计入）。禁 phase 内 retries+1（resume 归零会撞旧 round_key）。
        const visualAttemptId = `i${totalTurns}`;
        const invokeId = `${phase}-${visualAttemptId}`;

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
        });
        flushProgress();

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
          { runId: manifest.run_id, attemptId: visualAttemptId },
        );

        appendEvent(manifest.report_dir, projectRoot, {
          type: 'harness_end',
          phase,
          exit_code: harnessExit,
        });
        flushProgress();

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
        });
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
          // E4：持久化 advance_blocked 状态，供下一次 attempt 的 countCumulativeAdvanceBlocked
          // 事件回放统计使用（events.jsonl 是唯一 SSOT，非内存计数，resume/detach 重启不丢）。
          advance_blocked: resolved.advance_blocked || undefined,
          advance_block_reason: resolved.advance_block_reason,
          halt_reason: haltReason,
          interaction_question: interactionSentinel?.error,
          // P0-B/P0-D 诚实归因：让下游排障者（人/AI）一眼见真因，不再有"缺 API key"式臆造空间。
          api_error_excerpt: apiErrorSentinel?.matchedLine,
          agent_duration_ms: invoke.duration_ms,
          timeout_budget_ms:
            invoke.timed_out === true ? resolvePhaseTimeoutMs(phase, manifest) : undefined,
          // codex P2：agent 非零退出时保真 stderr（binary 不可 spawn 的 preflight 诊断就在这里）。
          agent_stderr_excerpt:
            invoke.exitCode !== 0 && invoke.stderr.trim()
              ? truncateOneLine(invoke.stderr.trim(), 400)
              : undefined,
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
          priorAttemptApiError = failureKind === 'transient_api_error';
          if (failureKind === 'transient_api_error') {
            // P0-D：backoff 重试——独立计数、不吃 max_retries_per_phase；事件先于 sleep
            // 落盘（用户看到"退避中"而非"卡住"；跨 resume 计数也靠它派生）。sleep 计入
            // wall_clock（下一轮 checkRunBudget 重查）。backoff 修不了断掉的 TCP——只买
            // 到几次自动重试 + 诚实归因，长会话必断的网络仍需换代理/交互跑。
            transientRetriesUsed++;
            const backoffMs =
              TRANSIENT_API_BACKOFF_MS[
                Math.min(transientRetriesUsed - 1, TRANSIENT_API_BACKOFF_MS.length - 1)
              ];
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
          ...((haltReason === 'await_human_visual_confirm' || haltReason === 'closure_wall_repeated') &&
          awaitConfirmGuidance
            ? { halt_guidance: awaitConfirmGuidance }
            : {}),
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
