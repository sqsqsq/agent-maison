// ============================================================================
// assess.ts — deterministic, level-triggered feature reconciliation (assess@1)
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  featureFilePath,
  featurePhaseReportsDir,
} from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import {
  recomputePhaseEvidenceStaleness,
  phaseEvidenceManifestPath,
} from './phase-evidence-manifest';
import { loadFeatureTrackDecl } from './feature-track';
import {
  resolveFeatureTrack,
  resolvePhaseChain,
  resolvePhaseClosureSource,
  type FeatureTrack,
} from './runtime-policy';
import {
  classifyPhaseAssessment,
  classifyPhaseVerdict,
  type HarnessVerdict,
  type DependencyPolicy,
  type PhaseVerdictAction,
} from './phase-transition-policy';
import { mapCategoryToChainPhase } from './correction-routing';
import {
  assuranceSatisfies,
  type Assurance,
  type MinimumAssurance,
} from './skill-contract';
import { collectBlockedCapabilityFacts, type BlockedCapabilityFact } from './capability-resolution';
import type { CapabilityResolution } from './capability-resolution';

export type AssessGapKind =
  | 'missing'
  | 'failed'
  | 'deferred'
  | 'stale'
  | 'unclosed'
  | 'legacy_unverified'
  | 'insufficient_assurance'
  | 'pruned';

export type AssessAuthorizationMode = 'manual' | 'batch_authorized' | 'goal_mode';

export interface AssessAuthorizationContext {
  mode: AssessAuthorizationMode;
  through_phase?: string;
}

/** Injected by a reconcile driver; assess never reads event logs directly. */
export interface ReconcileObservationV1 {
  schema_version: '1.0';
  state: 'active' | 'fused';
  reason?: string;
  residual_fingerprints?: string[];
  phase_outcome?: {
    phase: string;
    verdict: string;
    legacy_action: string;
    failure_kind?: string;
    blocking_class?: string;
    propagate_to_downstream?: boolean;
    dependency_policy?: DependencyPolicy;
  };
  blockers?: Array<{
    id: string;
    actionability: 'automatic' | 'human' | 'external' | 'unknown';
    blocking_class?: string;
  }>;
  deterministic_defects?: string[];
  budgets?: {
    retries_used: number;
    max_retries_per_phase?: number;
    backtracks_used: number;
  };
  repeated_round?: {
    fingerprint: string;
    count: number;
  };
  invalidatable_phases?: string[];
  signals?: {
    timed_out: boolean;
    operator_interrupted: boolean;
    api_disconnected: boolean;
  };
}

export interface AssessPhaseObservation {
  phase: string;
  /**
   * 责任阶段统一路由（plan b6e4c9f2）：该 phase summary 的可信可修缺陷候选
   * （**唯一真源=summary.repair_candidates[]**；assess 直读，不经 reconcile 复制——
   * goal/manual/batch 三链共用同一判断，codex review 冻结项③）。
   */
  repair_candidates?: Array<{ id: string; category: 'spec' | 'plan' | 'coding'; item_fingerprint: string; summary?: string }>;
  summary_state: 'missing' | 'corrupt' | 'legacy' | 'current';
  schema_version: string | null;
  verdict: string | null;
  closure: 'open' | 'closed' | 'stale';
  /** stale/tampered 时的具体变更路径与传染来源（codex 定点：不丢 changed_paths，读者不用猜） */
  closure_stale_detail?: string | null;
  assurance: string;
  required_assurance: string | null;
  assurance_satisfied: boolean | null;
  deferred: boolean;
  summary_fingerprint: string | null;
  evidence_fingerprint: string | null;
  /** plan c8e5b3f1 t2 D：该 phase 的本地 blocked capability 事实（供 failed gap.detail 丰富；非 AssessResult 持久化 gap shape）。 */
  blocked_capabilities?: BlockedCapabilityFact[];
}

export interface AssessDegradation {
  phase: string;
  capability: string;
  axis: 'functional' | 'visual' | 'asset' | 'evidence';
  reason_code: 'capability_pruned';
}

export interface AssessPrunedPropagation {
  producer_phase: string;
  producer_capability: string;
  downstream_phase: string;
  downstream_capability: string;
  input_id: string;
  source: string;
}
export interface AssessObservation {
  schema_version: '1.0';
  feature: string;
  workflow: string;
  track: FeatureTrack;
  goal_end: string;
  phases: AssessPhaseObservation[];
  degradations?: AssessDegradation[];
  pruned_propagations?: AssessPrunedPropagation[];
  fingerprints: {
    workflow: string;
    track: string;
    goal: string;
    run_attempt: string;
    summaries: string;
    evidence: string;
    reconcile: string;
    observed: string;
  };
  reconcile: ReconcileObservationV1 | null;
}

export interface AssessGap {
  phase: string;
  kind: AssessGapKind;
  detail: string;
}

export interface AssessRecommendation {
  action:
    | 'run_phase'
    | 'rerun_phase'
    | 'complete_closure'
    | 'resolve_deferred'
    | 'restore_inputs_and_rerun'
    | 'validate_feature_completion'
    | 'stop';
  phase: string | null;
  reason: string;
  requires_driver_authorization: true;
  /** Exact SSOT verdict action when recommendation was derived from a phase outcome. */
  runner_action?: PhaseVerdictAction;
}

/** plan c8e5b3f1 t2 review：持久化到 next.json / AssessResult.observed.phases 的 phase 观察类型——
 * 显式剔除内部诊断字段 blocked_capabilities（运行时已剥离，类型契约同步，避免 schema 1.0 落盘 shape
 * 与公开类型不一致）。 */
export type PersistedAssessPhaseObservation = Omit<AssessPhaseObservation, 'blocked_capabilities'>;

export interface AssessResult {
  schema_version: '1.0';
  kind: 'assess@1';
  feature: string;
  workflow: string;
  track: FeatureTrack;
  goal_end: string;
  authorization_context: AssessAuthorizationContext;
  observed_fingerprint: string;
  fingerprints: AssessObservation['fingerprints'];
  observed: { phases: PersistedAssessPhaseObservation[]; degradations?: AssessDegradation[]; pruned_propagations?: AssessPrunedPropagation[] };
  gaps: AssessGap[];
  recommendation: AssessRecommendation;
  alternatives: AssessRecommendation[];
  stop: { fused: boolean; reason: string | null };
  run_status_candidate: 'CHAIN_SLICE_COMPLETED' | null;
  feature_completion: 'REQUIRES_VALIDATION' | null;
  projection_fingerprint: string;
}

export interface AssessFeatureOptions {
  projectRoot: string;
  frameworkRoot?: string;
  feature: string;
  goalEnd?: string;
  minimumAssurance?: Record<string, MinimumAssurance>;
  authorization?: AssessAuthorizationContext;
  runId?: string;
  attemptId?: string;
  reconcile?: ReconcileObservationV1 | null;
  writeProjection?: boolean;
}

export interface NextProjectionReadResult {
  result: AssessResult;
  source: 'fresh_projection' | 'recomputed_missing' | 'recomputed_corrupt' | 'recomputed_stale';
}

function stableJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(normalize);
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(
    typeof value === 'string' ? value : stableJson(value),
    'utf8',
  ).digest('hex');
}

function fileHash(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function readJson(filePath: string): Record<string, unknown> | null | 'corrupt' {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

function sliceThrough(phases: string[], end: string): string[] {
  const index = phases.indexOf(end);
  if (index < 0) {
    throw new Error(`[assess] goal_end=${end} 不在 active workflow/track phase chain`);
  }
  return phases.slice(0, index + 1);
}

/**
 * 责任阶段统一路由（plan b6e4c9f2；codex review 冻结项③）：从 phase summary 读可信
 * 可修候选——**唯一真源**。assess 直读它，goal/manual/batch 三链因此共用同一裁决，
 * 不再各自复制一份（reconcile observation 不承载候选，manual 也不另读文件）。
 * 形状非法条目静默剔除（写侧已由 validateRepairCandidatesShape fail-fast）。
 */
function readRepairCandidatesFromSummary(
  summary: Record<string, unknown>,
): NonNullable<AssessPhaseObservation['repair_candidates']> {
  const raw = summary.repair_candidates;
  if (!Array.isArray(raw)) return [];
  const out: NonNullable<AssessPhaseObservation['repair_candidates']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const category = String(c.category ?? '');
    if (category !== 'spec' && category !== 'plan' && category !== 'coding') continue;
    if (typeof c.id !== 'string' || !c.id.trim()) continue;
    if (typeof c.item_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(c.item_fingerprint)) continue;
    out.push({
      id: c.id,
      category,
      item_fingerprint: c.item_fingerprint,
      ...(typeof c.summary === 'string' ? { summary: c.summary } : {}),
    });
  }
  return out;
}

function isDeferredSummary(summary: Record<string, unknown>): boolean {
  if (summary.verdict === 'INCOMPLETE') return true;
  if (summary.completion_status === 'deferred') return true;
  return (summary.blockers as Array<Record<string, unknown>> | undefined)?.some((blocker) =>
    ['externalBlocked', 'external_block', 'device_blocked'].includes(
      String(blocker.blocking_class ?? blocker.classification ?? ''),
    ),
  ) ?? false;
}

/**
 * plan c8e5b3f1 t2 D：summary 是否含**本地** blocked capability（相关 unresolved attempts 均无
 * upstream_producer）。真 device/external/deferred 场景（verdict=INCOMPLETE 且 blockers 为
 * external/device）会命中 isDeferredSummary 的 blockers 分支，本函数不覆盖——只有"verdict=INCOMPLETE
 * 且无 external blocker、且确有本地 blocked capability"时返回 true，从而让该 phase 走 failed 而非
 * 被 isDeferredSummary 一律标成 deferred。（与 collectPrunedPropagations 的 upstream_producer 语义
 * 一致：带 producer 的 unresolved attempt 交给上游 pruned 传播，不在此当本地失败。）
 */
function hasLocalBlockedCapability(summary: Record<string, unknown>): boolean {
  // review P2：显式 external/device blocker **或** completion_status==='deferred' 都**优先**保持
  // deferred——本地 blocked 不得吞掉真实外部/显式延迟（含 completion_status 显式置 deferred 的场景）。
  const hasExternalBlocker = (summary.blockers as Array<Record<string, unknown>> | undefined)?.some((blocker) =>
    ['externalBlocked', 'external_block', 'device_blocked'].includes(
      String(blocker.blocking_class ?? blocker.classification ?? ''),
    ),
  ) ?? false;
  if (hasExternalBlocker) return false;
  if (String(summary.completion_status ?? '') === 'deferred') return false;
  return capabilityEntries(summary).some((capability) => {
    if (capability.active !== true || capability.state !== 'blocked') return false;
    const inputs = Array.isArray(capability.inputs) ? capability.inputs : [];
    for (const input of inputs) {
      if (!input || typeof input !== 'object') continue;
      const attempts = (input as Record<string, unknown>).attempts;
      if (!Array.isArray(attempts)) continue;
      for (const attempt of attempts) {
        if (!attempt || typeof attempt !== 'object') continue;
        const rec = attempt as Record<string, unknown>;
        const state = rec.state;
        if (state === 'absent' || state === 'invalid' || state === 'not_applicable') {
          if (typeof rec.upstream_producer === 'string' && rec.upstream_producer) return false;
        }
      }
    }
    return true;
  });
}

function blockedCapabilityFactsFor(summary: Record<string, unknown>): BlockedCapabilityFact[] {
  return collectBlockedCapabilityFacts({
    capabilities: capabilityEntries(summary) as unknown as CapabilityResolution[],
  });
}

function capabilityEntries(summary: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(summary.capability_resolutions)
    ? summary.capability_resolutions.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

/**
 * A blocked core capability only becomes a dedicated pruned gap when its missing
 * artifact has a concrete upstream producer and that producer reports a pruned
 * capability. This keeps legal local degradation observable without treating it
 * as a global repair target, while selecting the smallest producer repair when a
 * downstream core input is actually unavailable.
 */
function collectPrunedPropagations(
  summaries: ReadonlyMap<string, Record<string, unknown>>,
): AssessPrunedPropagation[] {
  const producerPruned = new Map<string, string[]>();
  for (const [phase, summary] of summaries) {
    const ids = capabilityEntries(summary)
      .filter((capability) => capability.active === true && capability.state === 'pruned')
      .map((capability) => capability.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) producerPruned.set(phase, ids.sort());
  }

  const propagation = new Map<string, AssessPrunedPropagation>();
  for (const [downstreamPhase, summary] of summaries) {
    for (const capability of capabilityEntries(summary)) {
      if (capability.active !== true || capability.state !== 'blocked' || capability.on_missing !== 'fail') continue;
      const capabilityId = typeof capability.id === 'string' ? capability.id : null;
      if (!capabilityId || !Array.isArray(capability.inputs)) continue;
      for (const input of capability.inputs) {
        if (!input || typeof input !== 'object') continue;
        const inputRecord = input as Record<string, unknown>;
        const inputId = typeof inputRecord.id === 'string' ? inputRecord.id : null;
        if (!inputId || !Array.isArray(inputRecord.attempts)) continue;
        for (const attempt of inputRecord.attempts) {
          if (!attempt || typeof attempt !== 'object') continue;
          const attemptRecord = attempt as Record<string, unknown>;
          const producerPhase = typeof attemptRecord.upstream_producer === 'string'
            ? attemptRecord.upstream_producer
            : null;
          if (!producerPhase || !producerPruned.has(producerPhase)) continue;
          const source = typeof attemptRecord.source === 'string' ? attemptRecord.source : inputId;
          for (const producerCapability of producerPruned.get(producerPhase)!) {
            const item: AssessPrunedPropagation = {
              producer_phase: producerPhase,
              producer_capability: producerCapability,
              downstream_phase: downstreamPhase,
              downstream_capability: capabilityId,
              input_id: inputId,
              source,
            };
            propagation.set([
              item.producer_phase,
              item.producer_capability,
              item.downstream_phase,
              item.downstream_capability,
              item.input_id,
              item.source,
            ].join('|'), item);
          }
        }
      }
    }
  }
  return [...propagation.values()].sort((a, b) =>
    [a.producer_phase, a.producer_capability, a.downstream_phase, a.downstream_capability, a.input_id]
      .join('|')
      .localeCompare([b.producer_phase, b.producer_capability, b.downstream_phase, b.downstream_capability, b.input_id].join('|')));
}
export function observeFeatureState(options: AssessFeatureOptions): AssessObservation {
  const workflow = resolveWorkflowSpec(options.projectRoot, {
    frameworkRoot: options.frameworkRoot,
  });
  const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, options.feature));
  const allPhases = resolvePhaseChain(workflow, track).featureOrdered.map(String);
  if (allPhases.length === 0) throw new Error(`[assess] workflow=${workflow.name} track=${track} 无 feature phase`);
  const goalEnd = options.goalEnd ?? allPhases[allPhases.length - 1];
  const phases = sliceThrough(allPhases, goalEnd);
  const frameworkRoot = options.frameworkRoot ??
    path.resolve(__dirname, '..', '..', '..');
  const staleness = new Map(
    recomputePhaseEvidenceStaleness(options.projectRoot, options.feature, phases, {
      frameworkRoot,
    }).map((entry) => [entry.phase, entry]),
  );

  const observedPhases = phases.map((phase): AssessPhaseObservation => {
    const reportsDir = featurePhaseReportsDir(
      options.projectRoot,
      options.feature,
      phase,
      frameworkRoot,
    );
    const summaryPath = path.join(reportsDir, 'summary.json');
    const summary = readJson(summaryPath);
    const evidencePath = phaseEvidenceManifestPath(options.projectRoot, options.feature, phase);
    const requiredAssurance = options.minimumAssurance?.[phase] ?? null;
    if (summary === null) {
      return {
        phase,
        summary_state: 'missing',
        schema_version: null,
        verdict: null,
        closure: 'open',
        assurance: 'unknown',
        required_assurance: requiredAssurance,
        assurance_satisfied: requiredAssurance ? false : null,
        deferred: false,
        summary_fingerprint: null,
        evidence_fingerprint: fileHash(evidencePath),
      };
    }
    if (summary === 'corrupt') {
      return {
        phase,
        summary_state: 'corrupt',
        schema_version: null,
        verdict: null,
        closure: 'open',
        assurance: 'unknown',
        required_assurance: requiredAssurance,
        assurance_satisfied: requiredAssurance ? false : null,
        deferred: false,
        summary_fingerprint: fileHash(summaryPath),
        evidence_fingerprint: fileHash(evidencePath),
      };
    }
    const schemaVersion = typeof summary.schema_version === 'string' ? summary.schema_version : null;
    const legacy = schemaVersion !== '1.2';
    const verdict = typeof summary.verdict === 'string' ? summary.verdict : null;
    const assurance = !legacy && typeof summary.assurance === 'string' && ['blocked', 'degraded', 'full'].includes(summary.assurance)
      ? summary.assurance
      : 'unknown';
    const assuranceSatisfied = requiredAssurance === null
      ? null
      : assurance === 'blocked' || assurance === 'degraded' || assurance === 'full'
        ? assuranceSatisfies(assurance as Assurance, requiredAssurance as MinimumAssurance)
        : false;
    const stalenessEntry = staleness.get(phase);
    const evidenceVerdict = stalenessEntry?.verdict;
    // codex 定点（宿主 run 6cb1da 归因两连猜错的根治）：stale 的具体 changed_paths 不再
    // 在投影层丢弃——"非 fresh"四个字逼着读者猜根因。
    const staleDetail = stalenessEntry && stalenessEntry.verdict !== 'fresh'
      ? [
          ...stalenessEntry.changed_paths,
          ...(stalenessEntry.receipt_changed ? ['<receipt>'] : []),
          ...(stalenessEntry.propagated_from ? [`<传染自 ${stalenessEntry.propagated_from}>`] : []),
          ...(stalenessEntry.integrity_errors ?? []),
        ].join(', ')
      : null;
    let closure: AssessPhaseObservation['closure'] = 'open';
    if (track === 'full') {
      const commit = summary.closure_commit as { schema_version?: unknown } | undefined;
      if (
        !legacy &&
        summary.closure_status === 'closed' &&
        commit?.schema_version === '1.0'
      ) {
        closure = evidenceVerdict === 'fresh' ? 'closed' : 'stale';
      }
    } else {
      const scriptReport = readJson(path.join(reportsDir, 'script-report.json'));
      const scriptVerdict = scriptReport && scriptReport !== 'corrupt'
        ? String((scriptReport.summary as { verdict?: unknown } | undefined)?.verdict ?? verdict ?? '')
        : verdict ?? undefined;
      closure = resolvePhaseClosureSource(track, scriptVerdict, undefined) === 'closed_by_exit_report'
        ? 'closed'
        : 'open';
    }
    return {
      phase,
      summary_state: legacy ? 'legacy' : 'current',
      schema_version: schemaVersion,
      verdict,
      closure,
      closure_stale_detail: staleDetail,
      assurance,
      required_assurance: requiredAssurance,
      assurance_satisfied: assuranceSatisfied,
      // 责任阶段统一路由：直读 summary 的可信候选（唯一真源）——三模式共用
      ...(readRepairCandidatesFromSummary(summary).length > 0
        ? { repair_candidates: readRepairCandidatesFromSummary(summary) }
        : {}),
      // plan c8e5b3f1 t2 D：不把 verdict=INCOMPLETE 一律当 deferred——本地 blocked capability
      //（unresolved attempts 均无 upstream_producer）应走 failed；真 device/external 仍 deferred。
      deferred: isDeferredSummary(summary) && !hasLocalBlockedCapability(summary),
      blocked_capabilities: blockedCapabilityFactsFor(summary),
      summary_fingerprint: fileHash(summaryPath),
      evidence_fingerprint: fileHash(evidencePath),
    };
  });

  const currentSummaries = new Map<string, Record<string, unknown>>();
  for (const phase of observedPhases) {
    if (phase.summary_state !== 'current') continue;
    const reportsDir = featurePhaseReportsDir(options.projectRoot, options.feature, phase.phase, frameworkRoot);
    const summary = readJson(path.join(reportsDir, 'summary.json'));
    if (summary && summary !== 'corrupt') currentSummaries.set(phase.phase, summary);
  }
  const degradations: AssessDegradation[] = observedPhases.flatMap((phase) => {
    if (phase.summary_state !== 'current' || phase.assurance_satisfied === false) return [];
    return capabilityEntries(currentSummaries.get(phase.phase) ?? {}).flatMap((capability): AssessDegradation[] => {
      if (capability.active !== true || capability.state !== 'pruned') return [];
      const id = typeof capability.id === 'string' ? capability.id : null;
      const axis = capability.axis;
      if (!id || !['functional', 'visual', 'asset', 'evidence'].includes(String(axis))) return [];
      return [{
        phase: phase.phase,
        capability: id,
        axis: axis as AssessDegradation['axis'],
        reason_code: 'capability_pruned',
      }];
    });
  });
  const prunedPropagations = collectPrunedPropagations(currentSummaries);
  const workflowFingerprint = hash(workflow);
  const trackFingerprint = hash({
    track,
    feature_decl: fileHash(featureFilePath(options.projectRoot, options.feature, 'feature.yaml')),
  });
  const goalFingerprint = hash({
    goal_end: goalEnd,
    minimum_assurance: options.minimumAssurance ?? {},
  });
  const runAttemptFingerprint = hash({
    run_id: options.runId ?? null,
    attempt_id: options.attemptId ?? null,
  });
  const summariesFingerprint = hash(observedPhases.map((phase) => ({
    phase: phase.phase,
    fingerprint: phase.summary_fingerprint,
  })));
  const evidenceFingerprint = hash(observedPhases.map((phase) => ({
    phase: phase.phase,
    fingerprint: phase.evidence_fingerprint,
  })));
  const reconcileFingerprint = hash(options.reconcile ?? null);
  const observedFingerprint = hash({
    workflow: workflowFingerprint,
    track: trackFingerprint,
    goal: goalFingerprint,
    run_attempt: runAttemptFingerprint,
    summaries: summariesFingerprint,
    evidence: evidenceFingerprint,
    reconcile: reconcileFingerprint,
    phases: observedPhases,
    degradations,
    pruned_propagations: prunedPropagations,
  });

  return {
    schema_version: '1.0',
    feature: options.feature,
    workflow: workflow.name,
    track,
    goal_end: goalEnd,
    phases: observedPhases,
    degradations,
    pruned_propagations: prunedPropagations,
    fingerprints: {
      workflow: workflowFingerprint,
      track: trackFingerprint,
      goal: goalFingerprint,
      run_attempt: runAttemptFingerprint,
      summaries: summariesFingerprint,
      evidence: evidenceFingerprint,
      reconcile: reconcileFingerprint,
      observed: observedFingerprint,
    },
    reconcile: options.reconcile ?? null,
  };
}

function gapsFromObservation(observation: AssessObservation): AssessGap[] {
  const gaps: AssessGap[] = (observation.pruned_propagations ?? []).map((item) => ({
    phase: item.producer_phase,
    kind: 'pruned',
    detail: `restore producer=${item.producer_phase} capability=${item.producer_capability}; downstream=${item.downstream_phase}/${item.downstream_capability}; input=${item.input_id}; source=${item.source}`,
  }));
  for (const phase of observation.phases) {
    if (phase.summary_state === 'missing') {
      gaps.push({ phase: phase.phase, kind: 'missing', detail: 'summary.json 缺失' });
      continue;
    }
    if (phase.summary_state === 'corrupt') {
      gaps.push({ phase: phase.phase, kind: 'failed', detail: 'summary.json 损坏或非对象' });
      continue;
    }
    if (phase.summary_state === 'legacy') {
      gaps.push({
        phase: phase.phase,
        kind: 'legacy_unverified',
        detail: `summary schema=${phase.schema_version ?? 'unknown'}；须重跑 harness 生成 1.2`,
      });
      continue;
    }
    if (phase.deferred) {
      gaps.push({ phase: phase.phase, kind: 'deferred', detail: `verdict=${phase.verdict ?? 'unknown'}` });
      continue;
    }
    if (phase.verdict !== 'PASS') {
      // plan c8e5b3f1 t2 D：本地 blocked capability 时把泛化 detail 丰富为 capability/input/attempt
      // + 修复动作（gap.kind 仍为 failed → recommendation 仍 rerun_phase）。无本地 blocked 时保持原样。
      const blocked = phase.blocked_capabilities ?? [];
      if (blocked.length > 0) {
        const capDetail = blocked.map((fact) => {
          const unresolved = fact.unresolved.length > 0
            ? fact.unresolved
              .map((u) => {
                const deps = u.dependencies.filter((d) => !!d.path).map((d) => `${d.path}${d.exists ? '' : '(missing)'}`).join(', ');
                return `input=${u.input} source=${u.source}${u.detail ? `: ${u.detail}` : ''}${u.upstream_producer ? ` (producer=${u.upstream_producer})` : ''}${deps ? ` path=[${deps}]` : ''}`;
              })
              .join('; ')
            : `applicability invalid（provider=${fact.applicability_provider ?? 'n/a'}` +
              (fact.applicability_dependencies.length > 0
                ? `，path=[${fact.applicability_dependencies.map((d) => `${d.path}${d.exists ? '' : '(missing)'}`).join(', ')}]` : '') +
              `）`;
          return `capability=${fact.capability} ${unresolved}`;
        }).join('；');
        gaps.push({
          phase: phase.phase,
          kind: 'failed',
          detail: `verdict=${phase.verdict ?? 'missing'}；${capDetail}；补齐该输入后重跑当前 phase`,
        });
      } else {
        gaps.push({ phase: phase.phase, kind: 'failed', detail: `verdict=${phase.verdict ?? 'missing'}` });
      }
      continue;
    }
    if (phase.closure === 'stale') {
      gaps.push({
        phase: phase.phase,
        kind: 'stale',
        detail:
          'phase evidence manifest 非 fresh' +
          (phase.closure_stale_detail ? `（changed: ${phase.closure_stale_detail}）` : ''),
      });
      continue;
    }
    if (phase.closure !== 'closed') {
      gaps.push({ phase: phase.phase, kind: 'unclosed', detail: 'PASS 但 verified closure 尚未提交' });
      continue;
    }
    if (phase.required_assurance && phase.assurance_satisfied !== true) {
      gaps.push({
        phase: phase.phase,
        kind: 'insufficient_assurance',
        detail: `actual=${phase.assurance}, required=${phase.required_assurance}`,
      });
    }
  }
  return gaps;
}

function recommendationFor(gap: AssessGap | undefined, fused: boolean): AssessRecommendation {
  const action = classifyPhaseVerdict({
    assessment_gap: gap?.kind ?? null,
    fused,
  });
  return {
    action,
    phase: gap?.phase ?? null,
    reason: fused
      ? 'reconcile observation 已熔断；等待输入或外部状态变化'
      : gap
        ? `${gap.kind}: ${gap.detail}`
        : '链切片无剩余 gap；仍须执行 feature completion validation',
    requires_driver_authorization: true,
  };
}

function recommendationForGap(
  observation: AssessObservation,
  gap: AssessGap | undefined,
  fused: boolean,
): AssessRecommendation {
  if (!fused && gap?.kind === 'insufficient_assurance') {
    const phaseOutcome = observation.reconcile?.phase_outcome;
    if (phaseOutcome?.verdict === 'PASS' && phaseOutcome.phase === gap.phase) {
      const retriesUsed = observation.reconcile?.budgets?.retries_used ?? 0;
      const maxRetries = observation.reconcile?.budgets?.max_retries_per_phase ?? 2;
      if (retriesUsed >= maxRetries) {
        return {
          action: 'stop',
          phase: gap.phase,
          reason: `insufficient_assurance_retry_exhausted: ${gap.detail}`,
          requires_driver_authorization: true,
          runner_action: 'halt',
        };
      }
      return {
        action: 'restore_inputs_and_rerun',
        phase: gap.phase,
        reason: `insufficient_assurance: ${gap.detail}`,
        requires_driver_authorization: true,
        runner_action: 'retry',
      };
    }
  }
  return recommendationFor(gap, fused);
}

function recommendationForObservation(
  observation: AssessObservation,
  gaps: AssessGap[],
  fused: boolean,
): AssessRecommendation {
  // 责任阶段统一路由（plan b6e4c9f2 t2）：可信可修缺陷按责任类别经**当前 workflow/track**
  // 严格映射回退目标——多类别并存选**最上游**（级联失效天然覆盖下游；分组事实由 runner
  // 的 backtrack 事件承载，链重走到各责任阶段只注入属于它的候选）。映射不到当前 chain
  // 的真实节点=null=不参与选择；全部映射失败 → phase:null 的回退意图，由 driver/runner
  // 落既有 backtrack_target_absent（禁静默回链首/幽灵 phase）。
  if (!fused) {
    const reconcile = observation.reconcile;
    const currentPhase = reconcile?.phase_outcome?.phase;
    // 候选唯一真源=phase summary（assess 直读，不经 reconcile 复制）——goal 的 detached
    // runner、in-session/batch driver、manual 渲染因此共用同一事实与同一裁决。
    const candidates = currentPhase
      ? observation.phases.find((p) => p.phase === currentPhase)?.repair_candidates ?? []
      : [];
    if (reconcile?.state === 'active' && currentPhase && candidates.length > 0) {
      const chainPhases = observation.phases.map((p) => p.phase);
      const targets = [...new Set(candidates.map((c) => c.category))]
        .map((category) => mapCategoryToChainPhase(category, chainPhases, observation.track))
        .filter((p): p is string => p !== null && p !== currentPhase);
      const upstream = targets.sort(
        (a, b) => chainPhases.indexOf(a) - chainPhases.indexOf(b),
      )[0] ?? null;
      const reason =
        `repair_candidates: ${candidates.map((c) => `${c.id}(${c.category})`).join(', ')}`;
      if (upstream === null) {
        return {
          action: 'stop',
          phase: null,
          reason: `${reason}——责任类别映射不到当前 workflow 链内节点（backtrack_target_absent）`,
          requires_driver_authorization: true,
          runner_action: 'backtrack_to_phase',
        };
      }
      return {
        action: 'rerun_phase',
        phase: upstream,
        reason,
        requires_driver_authorization: true,
        runner_action: 'backtrack_to_phase',
      };
    }
    // 【deterministic_defects → backtrack_to_coding 旧裁决链已删除 · 责任阶段统一路由】
    // 缺陷路由唯一入口=上面的 repair_candidates 分支（唯一真源=phase summary）。
    // deterministic_defects 保留为诊断/指纹投影，**不再决定路由**——两条路并存正是
    // 「summary 写不进去就悄悄走旧路」的绕过口（codex 二轮冻结项①）。
  }
  const phaseOutcome = observation.reconcile?.phase_outcome;
  if (!fused && phaseOutcome && ['PASS', 'FAIL', 'INCOMPLETE'].includes(phaseOutcome.verdict)) {
    const decision = classifyPhaseAssessment({
      verdict: phaseOutcome.verdict as HarnessVerdict,
      phase: phaseOutcome.phase,
      failure_kind: phaseOutcome.failure_kind,
      blocking_class: phaseOutcome.blocking_class,
      dependency_policy: phaseOutcome.dependency_policy ?? {
        propagate_to_downstream: phaseOutcome.propagate_to_downstream,
      },
      retries_used: observation.reconcile?.budgets?.retries_used ?? 0,
      max_retries_per_phase: observation.reconcile?.budgets?.max_retries_per_phase ?? 2,
      deterministic_p0_defects:
        (observation.reconcile?.deterministic_defects?.length ?? 0) > 0,
    });
    if (decision.action !== null) {
      const targetPhase = decision.target === 'coding'
        ? observation.reconcile?.invalidatable_phases?.find((phase) => phase === 'coding') ?? null
        : decision.target === 'current'
          ? phaseOutcome.phase
          : null;
      return {
        action: decision.action,
        phase: targetPhase,
        reason: `phase_verdict:${decision.runner_action}; failure_kind=${phaseOutcome.failure_kind ?? 'none'}`,
        requires_driver_authorization: true,
        runner_action: decision.runner_action,
      };
    }
  }
  return recommendationForGap(observation, gaps[0], fused);
}
export function assessObservation(
  observation: AssessObservation,
  authorization: AssessAuthorizationContext = { mode: 'manual' },
): AssessResult {
  const gaps = gapsFromObservation(observation);
  const fused = observation.reconcile?.state === 'fused';
  const recommendation = recommendationForObservation(observation, gaps, fused);
  const reconciled = gaps.length === 0 && !fused &&
    recommendation.action === 'validate_feature_completion';
  const resultWithoutProjection = {
    schema_version: '1.0' as const,
    kind: 'assess@1' as const,
    feature: observation.feature,
    workflow: observation.workflow,
    track: observation.track,
    goal_end: observation.goal_end,
    authorization_context: authorization,
    observed_fingerprint: observation.fingerprints.observed,
    fingerprints: observation.fingerprints,
    observed: {
      // plan c8e5b3f1 t2 review：blocked_capabilities 是**内部诊断数据**，供 gapsFromObservation
      // 丰富 failed gap.detail；持久化前剥离，不进入 AssessResult.observed.phases / next.json
      //（schema 仍 1.0，零 observed/schema 扩展）。
      phases: observation.phases.map(({ blocked_capabilities: _bc, ...rest }) => rest),
      degradations: observation.degradations ?? [],
      pruned_propagations: observation.pruned_propagations ?? [],
    },
    gaps,
    recommendation,
    alternatives: [] as AssessRecommendation[],
    stop: {
      fused,
      reason: fused ? observation.reconcile?.reason ?? 'reconcile_fused' : null,
    },
    run_status_candidate: reconciled ? 'CHAIN_SLICE_COMPLETED' as const : null,
    feature_completion: reconciled ? 'REQUIRES_VALIDATION' as const : null,
  };
  return {
    ...resultWithoutProjection,
    projection_fingerprint: hash(resultWithoutProjection),
  };
}

export function nextProjectionPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, 'next.json');
}

export function writeNextProjection(
  projectRoot: string,
  feature: string,
  result: AssessResult,
): string {
  const target = nextProjectionPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(staged, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.renameSync(staged, target);
  return target;
}

export function assessFeature(options: AssessFeatureOptions): AssessResult {
  const observation = observeFeatureState(options);
  const result = assessObservation(
    observation,
    options.authorization ?? { mode: 'manual' },
  );
  if (options.writeProjection !== false) {
    writeNextProjection(options.projectRoot, options.feature, result);
  }
  return result;
}

/**
 * Continue path: next.json is only a cache. Any absence, corruption, or
 * authoritative fingerprint mismatch recomputes before the driver can act.
 */
export function readFreshNextOrRecompute(
  options: AssessFeatureOptions,
): NextProjectionReadResult {
  const nextPath = nextProjectionPath(options.projectRoot, options.feature);
  const current = assessFeature({ ...options, writeProjection: false });
  if (!fs.existsSync(nextPath)) {
    writeNextProjection(options.projectRoot, options.feature, current);
    return { result: current, source: 'recomputed_missing' };
  }
  let stored: AssessResult;
  try {
    stored = JSON.parse(fs.readFileSync(nextPath, 'utf8')) as AssessResult;
  } catch {
    writeNextProjection(options.projectRoot, options.feature, current);
    return { result: current, source: 'recomputed_corrupt' };
  }
  if (
    stored?.kind !== 'assess@1' ||
    stored.schema_version !== '1.0' ||
    stored.projection_fingerprint !== current.projection_fingerprint ||
    stored.observed_fingerprint !== current.observed_fingerprint
  ) {
    writeNextProjection(options.projectRoot, options.feature, current);
    return { result: current, source: 'recomputed_stale' };
  }
  return { result: stored, source: 'fresh_projection' };
}
