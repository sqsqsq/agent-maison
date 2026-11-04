import { featureFilePath } from '../../config';
import { deriveChangeUnitFeatureId } from './change-unit-path';
import { deriveChangeUnitBlockers } from './change-unit-blockers';
import { BLUEPRINT_RECONCILE_LOCK_NAME } from './change-unit-design-preparation';
import { FEATURE_LOCK_NAME } from './goal-run-lock';
import { readHandoffMaterial, sessionEvents, readExecutionRequestOriginal, sessionExecutionForInvoke, acceptedSessionReport, type HandoffReference } from './session-execution-handoff';
import { invocationCompleted } from './invocation-completion';
// ============================================================================
// design-repair-unattended.ts — 既有两层锁内的设计候选、独立质询与发布事务。
// 先准备机器字段/已知CU闭包，仅真实设计差额交作者；Q按原件、业务内容与依赖证明复用或补核。
// 原写界与真实检查通过后才原子发布，并交原CU consumer/调和器与恢复探针。
// 未发布候选和调用原件保留供恢复；发布后不回滚，调和/探针失败仍记未恢复。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import { BlueprintReviewResult, materializeBlueprintReview, summarizeBlueprintReviewResults } from './blueprint-review-materialization';
import * as path from 'path';
import * as YAML from 'yaml';
import { deriveBlueprintAdmission, currentBlueprintSliceId } from './blueprint-admission';
import { evaluateCompletionProgress, compareRelatedInputSnapshots, type CompletionEvaluation, type ArtifactSnapshot } from './goal-failure-classifier';
import { reconcileP1DerivedResults } from './blueprint-reconciliation';
import { renderQuestioningResultInstructions, independentQuestioningBlockers, applyIndependentQuestioningOutput, parseIndependentQuestioningOutput, independentQuestioningEnvelope, validateBlueprintQuestioning } from './blueprint-questioning';
import { resolveBlueprintTarget } from './blueprint-addressing';
import { blueprintSourceRefFiles, compareAuthoritativeContent, deriveBlueprintCandidateSkillInput, checkAuthoritativeContentAligned,
  type BlueprintProjectionKind, type DesignAuthorityFinding, type DesignRepairClass } from './blueprint-skill-projection';
import {
  HeldFeatureLock,
  acquireBlueprintWriteLocks,
  reconcileHeldBlueprintRefs,
  reviseChangeUnitContent,
  type ChangeUnitContentRevision,
} from './change-unit-design-preparation';
import { changeUnitDirectory, enumerateCanonicalChangeUnits, parseChangeUnitFeatureId, loadCanonicalChangeUnit, createChangeUnitRef, asChangeUnitArtifact, resolveChangeUnitRefFromLoaded } from './change-unit-path';
import { LIVENESS_BEACON_FILENAME } from './liveness-beacon';
import { componentBlueprintPath, loadCanonicalBlueprint, resolveComponentBlueprintRefFromLoaded } from './component-blueprint-path';
import type { ChangeUnitArtifact, ChangeUnitRef } from './change-unit-model';
import type { ChangeUnitCandidate } from './change-unit-provider-boundary';
import type { ComponentBlueprintRef } from './component-blueprint-model';
import { blueprintIdentityPointers, currentBlueprintIdentity } from './change-unit-blueprint-identity';
import { completeChangeUnitDesignRefs, validateChangeUnitDesign } from './change-unit-design-gate';
import { evaluateChangeUnitCarryForward } from './change-unit-reconciliation';
import { validateChangeUnit } from './change-unit-validator';
import { publishArchitectureRevision } from './init-task-executor';
import { clearFrameworkConfigCache, validateArchitectureDsl, type ArchitectureDsl } from '../../config';
import { fingerprintDiscoverySources, prepareBlueprintDesignDraft, prepareBlueprintSourceItems } from './blueprint-discovery';
import { currentScopeItems } from './blueprint-requirement-traceability';
import { headlessLedgerPath } from './headless-assumptions';
import { assembleGoalBrief, renderGoalBrief } from './goal-brief';
import { BlueprintRecord, asRecord, asRecords, blueprintAuthorContent, renderBlueprintFieldResponsibilities } from './component-blueprint-model';
import { blockerIssues, validateComponentBlueprint, validateComponentBlueprintUpstream } from './component-blueprint-validator';
import { probeDesignAuthorityRecovered } from './condition-wait';
import {
  PhaseInvocationChange,
  capturePhaseInvocationSnapshot,
  workUnitProtectedRecordPaths,
  diffPhaseInvocationSnapshots,
} from './phase-write-boundary';
import { stableStringify } from './phase-evidence-manifest';
import { readableIssueEvidence, verifiedDeclineBasis } from './repair-candidates';
import { isInitialDesignManifest, loadGoalRunManifestFromRun } from './goal-manifest';
import { readOriginalDeliveryActivity } from './delivery-origin';
import { readSupersededAncestorRuns, type GoalRunEvent } from './goal-runner-phase';
import { relFeaturesDir } from '../../config';
import { readCurrentDispositionInput } from './verify-feature-completion';
import { resolveCurrentDisposition } from './check-disposition';
import { independentVerificationContext } from './verifier-material';
import { createCodexTerminalScanner, readProviderSessionId, resolveTerminalEventParser } from './codex-terminal-events';
import { isInsideProjectRoot } from './project-relative-path';
import type { CheckContext, CheckResult } from './types';
import type { ResolutionDependency } from './capability-resolution';

export const DESIGN_REPAIR_PREAUTH_KEY = 'design_repair.unattended_b1';
/** 子契约文档（发布件内，相对框架根）。 */
export const DESIGN_REPAIR_CONTRACT_DOC = path.join('skills', 'reference', 'design-repair-unattended.md');
/** 质询方标识：与编写方不同；校验器另要求它不等于蓝图的 authored_by。 */
export const DESIGN_REPAIR_QUESTIONING_PROVIDER = 'design-repair-questioning';
/** 链外调用的用途标识——写进 agent_invoke_start / end 的 `phase`，不属于阶段链，阶段读者按 phase 过滤时看不到它们。 */
export type DesignRepairPurpose = 'author' | 'questioning';
export const designRepairInvokeLabel = (purpose: DesignRepairPurpose): string => `design-repair-${purpose}`;

export interface DesignRepairBriefLike { class: DesignRepairClass; items: DesignAuthorityFinding[] }

/** The transaction target is an existing design identity; its run carrier may be the raw request. */
export function designRepairTarget(projectRoot: string, feature: string): ComponentBlueprintRef | ChangeUnitRef {
  if (feature.startsWith('cu-')) {
    const id = parseChangeUnitFeatureId(feature);
    return createChangeUnitRef(loadCanonicalChangeUnit(projectRoot, id.blueprintId, id.changeUnitId));
  }
  const loaded = loadCanonicalBlueprint(projectRoot, feature);
  return { artifact: 'component-blueprint@1', component_id: String(loaded.blueprint.component_id), blueprint_id: feature,
    ...currentBlueprintIdentity(loaded), target: { kind: 'blueprint', id: feature } };
}

/** Recover the existing publication cut before stale birth bindings can hide it. */
export function pendingPublishedDesignRepair(projectRoot: string, runDir: string): { phase: string; signature: string; brief: DesignRepairBriefLike } | null {
  const events = sessionEvents(runDir);
  const attempted = [...events].reverse().find(event => event.type === 'design_authority_repair'
    && (event as Record<string, unknown>).stage === 'attempted' && (event as Record<string, unknown>).handoff_context) as Record<string, unknown> | undefined;
  if (!attempted) return null;
  const attemptedIndex = events.indexOf(attempted);
  if (events.slice(attemptedIndex + 1).some(event => event.type === 'design_authority_repair'
    && (event as Record<string, unknown>).signature === attempted.signature
    && ((event as Record<string, unknown>).stage === 'failed' || (event as Record<string, unknown>).stage === 'published'
      && !((event as Record<string, unknown>).outcome === 'unrecovered' && (event as Record<string, unknown>).failed_step === 'reconcile')))) return null;
  const original = readHandoffMaterial<{ baseline: string; brief: DesignRepairBriefLike }>(runDir, attempted.handoff_context as HandoffReference);
  if (!original.brief) return null;
  const draft = path.join(runDir, 'design-repair/component-blueprint.yaml');
  const canonical = componentBlueprintPath(projectRoot, String(attempted.blueprint_id));
  if (!fs.existsSync(draft) || !fs.readFileSync(canonical).equals(fs.readFileSync(draft))) return null;
  const before = YAML.parse(Buffer.from(original.baseline, 'base64').toString('utf8')) as BlueprintRecord;
  const current = YAML.parse(fs.readFileSync(canonical, 'utf8')) as BlueprintRecord;
  if (Number(current.revision) !== Number(before.revision) + 1) return null;
  return { phase: String(attempted.phase), signature: String(attempted.signature), brief: original.brief };
}

/** 停机签名：feature + 责任阶段 + 设计 owner 阻断的检查 id 与原因码（不含 run_id、时间、草稿版本——后继借不了这些绕过判重）。 */
export function designRepairSignature(feature: string, phase: string, items: ReadonlyArray<Pick<DesignAuthorityFinding, 'check' | 'codes'> & Partial<Pick<DesignAuthorityFinding, 'artifacts'>>>, inputFingerprint?: string): string {
  const checks = items.map(item => `${/^(coding|ut):/.test(item.check) && item.artifacts?.length
    ? `${item.check.split(':')[0]}:${[...item.artifacts].sort().join(',')}` : item.check}[${[...item.codes].sort().join(',')}]`).sort();
  return crypto.createHash('sha256').update(stableStringify({ feature, phase, checks, ...(inputFingerprint ? { inputFingerprint } : {}) }), 'utf8').digest('hex');
}

/** Existing semantic digest, excluding only the CU audit fields rewritten by this publisher. */
export function designRepairInputFingerprint(projectRoot: string, feature: string): string | undefined {
  try {
    const { identityNeutralDigest } = require('./identity-neutral-digest') as typeof import('./identity-neutral-digest');
    let blueprintId = feature;
    if (feature.startsWith('cu-')) {
      const identity = parseChangeUnitFeatureId(feature); blueprintId = identity.blueprintId;
      const cu = structuredClone(loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId).changeUnit);
      const provenance = asRecord(cu.provenance);
      if (provenance) for (const key of ['source_revision', 'observed_at', 'extraction_method']) delete provenance[key];
      const digest = identityNeutralDigest(projectRoot, 'change-unit@1', cu);
      if (digest) return digest;
    }
    const facts = blueprintAuthorContent(loadCanonicalBlueprint(projectRoot, blueprintId).blueprint);
    return crypto.createHash('sha256').update(stableStringify(facts)).digest('hex');
  } catch { return undefined; }
}

/** Compare the actual work files, with the same narrow publication exclusions as design repair. */
export function designWorkSnapshot(files: readonly string[], contents: Record<string, string> = {}, includeQuestioning = false): ArtifactSnapshot {
  const out: ArtifactSnapshot = {};
  for (const file of files) {
    try {
      const text = Object.prototype.hasOwnProperty.call(contents, file) ? contents[file] : fs.readFileSync(file, 'utf8');
      let value: unknown;
      try { value = YAML.parse(text); } catch { value = text; }
      const normalize = (input: unknown): unknown => {
        const record = asRecord(input);
        if (!record) return input;
        const copy = structuredClone(record);
        if (copy.artifact === 'component-blueprint@1') {
          return blueprintAuthorContent(copy, includeQuestioning);
        } else if (copy.artifact === 'change-unit@1') {
          delete copy.revision;
          for (const ref of blueprintIdentityPointers(copy)) {
            if (ref) for (const key of ['revision', 'source_fingerprint', 'artifact_sha256']) delete ref[key];
          }
          const provenance = asRecord(copy.provenance);
          if (provenance) for (const key of ['source_revision', 'observed_at', 'extraction_method']) delete provenance[key];
        }
        return copy;
      };
      // Candidate arrays wrap the exact artifact; business children with matching key names are retained.
      if (Array.isArray(value)) value = value.map(item => {
        const candidate = asRecord(item);
        return candidate && asRecord(candidate.artifact) ? { ...candidate, artifact: normalize(candidate.artifact) } : normalize(item);
      });
      else value = normalize(value);
      out[file] = { exists: true, contentHash: crypto.createHash('sha256').update(stableStringify(value)).digest('hex') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') out[file] = { exists: false, contentHash: '' };
      else return {}; // A failed read cannot establish no progress, even on a repeated failure.
    }
  }
  return out;
}

export function designWorkHasNoProgress(input: Parameters<typeof evaluateCompletionProgress>[0]): boolean {
  return evaluateCompletionProgress(input).halt;
}

/** Reuse only a real completed, clean Q over the same business input and unchanged raw dependencies. */
export function reusableDesignQuestioning(input: {
  projectRoot: string; blueprintPath: string; blueprint: BlueprintRecord; beforeBlueprint: string; output: string;
  providerId: string; completed: boolean; preSnapshot?: ReturnType<typeof capturePhaseInvocationSnapshot>;
  postSnapshot?: ReturnType<typeof capturePhaseInvocationSnapshot>; previous?: BlueprintRecord;
  /** Archived legacy write-in-place output, never a postimage sampled from current files. */
  afterBlueprint?: string;
  additionalInputs?: Readonly<Record<string, string>>;
}): BlueprintRecord | null {
  if (!input.completed || !input.preSnapshot || input.preSnapshot.failureReason) return null;
  try {
    const before = asRecord(YAML.parse(input.beforeBlueprint));
    if (!before || stableStringify(blueprintAuthorContent(before)) !== stableStringify(blueprintAuthorContent(input.blueprint))) return null;
    if (input.postSnapshot) {
      if (diffPhaseInvocationSnapshots(input.preSnapshot, input.postSnapshot).kind !== 'clean') return null;
    } else {
      if (!input.afterBlueprint) return null;
      const after = asRecord(YAML.parse(input.afterBlueprint));
      const withoutQuestioning = (doc: BlueprintRecord): BlueprintRecord => {
        const copy = structuredClone(doc); const review = asRecord(copy.review_summary); if (review) delete review.questioning; return copy;
      };
      if (!after || stableStringify(before) !== stableStringify(after)
        && (stableStringify(withoutQuestioning(before)) !== stableStringify(withoutQuestioning(after))
          || stableStringify(parseIndependentQuestioningOutput(input.output)) !== stableStringify(asRecord(after.review_summary)?.questioning))) return null;
    }
    const files = [...new Set([...blueprintSourceRefFiles(input.projectRoot, blueprintAuthorContent(before), true),
      ...blueprintSourceRefFiles(input.projectRoot, blueprintAuthorContent(input.blueprint), true)])];
    for (const file of files) {
      if (path.resolve(file) === path.resolve(input.blueprintPath)) continue;
      const relative = path.relative(input.projectRoot, file).replace(/\\/g, '/');
      const entry = input.preSnapshot.entries.find(item => item.path === relative && item.kind === 'file');
      if (!entry || sha256Hex(fs.readFileSync(file)) !== entry.sha256) return null;
    }
    for (const [file, beforeText] of Object.entries(input.additionalInputs ?? {})) {
      if (compareRelatedInputSnapshots(designWorkSnapshot([file], { [file]: beforeText }), designWorkSnapshot([file])) !== 'unchanged') return null;
    }
    const parsed = parseIndependentQuestioningOutput(input.output);
    const review = asRecord(input.blueprint.review_summary) ?? {};
    const result = independentQuestioningEnvelope(parsed, input.providerId, review.authored_by, input.previous);
    const errors = validateBlueprintQuestioning({ ...input.blueprint, review_summary: { ...review, questioning: result } });
    return errors.some(issue => issue.id !== 'blueprint_admission_false_pass') ? null : result;
  } catch { return null; }
}

/** Existing Q input hashes identify affected files; missing originals are explicit, never guessed as unchanged. */
export function questioningDependencyChanges(projectRoot: string, blueprint: BlueprintRecord, pre?: ReturnType<typeof capturePhaseInvocationSnapshot>, ownPath?: string): ResolutionDependency[] {
  return blueprintSourceRefFiles(projectRoot, blueprintAuthorContent(blueprint), true).flatMap(file => {
    if (ownPath && path.resolve(file) === path.resolve(ownPath)) return [];
    const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
    const expected = pre?.failureReason ? undefined : pre?.entries.find(entry => entry.path === relative && entry.kind === 'file');
    let exists = false, sha256: string | null = null;
    if (isInsideProjectRoot(projectRoot, file)) {
      exists = fs.existsSync(file);
      try { if (exists) sha256 = sha256Hex(fs.readFileSync(file)); } catch { /* Unreadable input remains a gap in the public Q context. */ }
    }
    return expected && sha256 === expected.sha256 ? [] : [{ path: file, exists, sha256, role: 'artifact' as const }];
  });
}

/**
 * @deprecated Read-only historical event query; never grants or denies another execution.
 */
export function designRepairAttempted(events: ReadonlyArray<object>, signature: string): boolean {
  return (events as ReadonlyArray<Record<string, unknown>>).some(event => event.type === 'design_authority_repair' && event.action === 'content_repair'
    && event.stage === 'attempted' && event.signature === signature);
}

/** Confirmed candidate IDs and actual author requests own the single rebuttal, independent of the transaction bundle. */
export function deriveDesignDeclineFeedback(events: ReadonlyArray<object>, candidates: readonly string[],
  author?: { invokeId?: string; instruction?: string }): { feedback: string; delivered: string[] } {
  const current = new Set(candidates), declines = new Map<string, { first: number; reason: string }>();
  events.forEach((value, index) => {
    const event = value as Record<string, unknown>;
    if (event.type !== 'design_authority_repair' || event.stage !== 'failed' || event.failed_step !== 'declined'
      || !Array.isArray(event.declined_candidates) || typeof event.reason !== 'string') return;
    for (const id of event.declined_candidates) if (typeof id === 'string' && current.has(id))
      declines.set(id, { first: declines.get(id)?.first ?? index, reason: event.reason });
  });
  const actor = author?.invokeId ? events.findIndex(value => {
    const event = value as Record<string, unknown>;
    return event.type === 'agent_invoke_start' && event.invoke_id === author.invokeId;
  }) : -1;
  const marker = (id: string) => `设计拒修反馈：${id}`;
  const delivered = [...declines].filter(([id, record]) => actor > record.first && author?.instruction?.includes(marker(id))).map(([id]) => id);
  const pending = [...declines].filter(([id]) => !delivered.includes(id));
  const feedback = pending.length ? pending.map(([id]) => marker(id)).join('\n') + '\n'
    + `设计 owner 经独立质询拒修，权威产物未发布：${[...new Set(pending.map(([, record]) => record.reason))].join('；')}。原工作单元作者须据理由修自身产物或补真实新事实；同一条只给一轮反驳，旧核实不得重派。` : '';
  return { feedback, delivered };
}

/** `containmentUnresolved`：子进程收容绑定失败且没能证明它已消失——不是普通失败，由运行时走既有 agent_containment_unresolved 处置。 */
export interface DesignRepairInvokeOutcome { started: boolean; ok: boolean; detail: string; invokeId?: string; output?: string; status?: import('./goal-phase-executor').GoalPhaseExecutorStatus; containmentUnresolved?: boolean; handoff?: boolean; preSnapshot?: ReturnType<typeof capturePhaseInvocationSnapshot>; postSnapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> }

/** Locate an original for its before-image; this never grants another execution. */
function repairRoleStart(events: GoalRunEvent[], purpose: DesignRepairPurpose, afterInvokeId?: string | null): GoalRunEvent | undefined {
  const at = events.map(event => event.type === 'design_authority_repair' && 'stage' in event && event.stage === 'attempted').lastIndexOf(true);
  if (afterInvokeId === undefined) return [...events.slice(at + 1)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel(purpose));
  const lower = afterInvokeId === null ? at : events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === afterInvokeId);
  if (lower < at) return undefined;
  return [...events.slice(lower + 1)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel(purpose));
}

/** Same existing invocation material for root, callback and detached role transports. */
export function recordDesignRepairInvocation(runDir: string, purpose: DesignRepairPurpose, invokeId: string, outcome: DesignRepairInvokeOutcome,
  initial?: { phase: 'initial-design-questioning'; blueprintPath: string }): void {
  const outputs: Record<string, string> = {};
  if (initial) {
    if (fs.existsSync(initial.blueprintPath)) outputs['initial-design-blueprint.yaml'] = fs.readFileSync(initial.blueprintPath).toString('base64');
  } else {
    for (const name of ['component-blueprint.yaml', 'change-unit.yaml', 'change-unit-candidates.json', 'architecture.json']) {
      const file = path.join(runDir, 'design-repair', name);
      if (fs.existsSync(file)) outputs[name] = fs.readFileSync(file).toString('base64');
    }
  }
  const recorded = { ...outcome }; delete recorded.invokeId;
  fs.writeFileSync(path.join(runDir, 'phases', initial?.phase ?? designRepairInvokeLabel(purpose), invokeId, 'design-result.json'),
    JSON.stringify({ outcome: recorded, draft_outputs: outputs }) + '\n', { flag: 'wx' });
}

/** Project the existing invocation originals; no Q validity record is written. */
function questioningOriginal(runDir: string, start: GoalRunEvent): {
  beforeBlueprint: string; output: string; source: string; completed: boolean; providerId: string;
  preSnapshot?: ReturnType<typeof capturePhaseInvocationSnapshot>; postSnapshot?: ReturnType<typeof capturePhaseInvocationSnapshot>;
  afterBlueprint?: string;
  previous?: BlueprintRecord; additionalInputs: Record<string, string>;
} | null {
  if (!start.invoke_id) return null;
  try {
    if (start.phase !== designRepairInvokeLabel('questioning') && start.phase !== 'initial-design-questioning') return null;
    const initial = start.phase === 'initial-design-questioning';
    const directory = path.join(runDir, 'phases', start.phase, start.invoke_id);
    const session = sessionExecutionForInvoke(runDir, start.invoke_id);
    const issued = session ?? readExecutionRequestOriginal(runDir, start.invoke_id);
    const accepted = session && acceptedSessionReport(runDir, session);
    if (session && !accepted) return null;
    const resultFile = path.join(directory, 'design-result.json');
    let saved: { draft_outputs?: Record<string, string>; outcome?: DesignRepairInvokeOutcome; post_snapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> } = {};
    if (accepted) saved = readHandoffMaterial(runDir, accepted.event.handoff_report!);
    else if (fs.existsSync(resultFile) || !initial) {
      try { saved = JSON.parse(fs.readFileSync(resultFile, 'utf8')) ?? {}; }
      catch (error) { if (!initial) throw error; }
    }
    const outputs = saved.draft_outputs ?? {};
    const beforeFile = path.join(directory, 'blueprint-before.yaml');
    const payloadName = initial ? 'initial-design-blueprint.yaml' : 'component-blueprint.yaml';
    const beforeBlueprint = fs.existsSync(beforeFile) ? fs.readFileSync(beforeFile, 'utf8')
      : outputs[payloadName] ? Buffer.from(outputs[payloadName], 'base64').toString('utf8') : '';
    const doc = asRecord(YAML.parse(beforeBlueprint));
    const outcome = saved.outcome;
    const events = sessionEvents(runDir);
    const ended = accepted?.event ?? [...events].reverse().find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
    let output = accepted?.report.details ?? outcome?.output
      ?? (fs.existsSync(path.join(directory, 'questioning-output.json')) ? fs.readFileSync(path.join(directory, 'questioning-output.json'), 'utf8') : '');
    let afterBlueprint: string | undefined;
    let previous = asRecord(asRecord(doc?.review_summary)?.questioning);
    const legacyDraft = path.join(directory, 'draft-output.yaml');
    const position = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === start.invoke_id);
    const next = events.findIndex((event, index) => index > position && event.type === 'agent_invoke_start');
    const refused = events.some(event => event.type === 'phase_write_violation' && event.invoke_id === start.invoke_id)
      || events.slice(position + 1, next < 0 ? undefined : next).some(event => event.halt_reason === 'unauthorized_source_mutation'
        && (!event.invoke_id || event.invoke_id === start.invoke_id));
    if (refused) return null;
    if (initial && !session && issued?.request.context.owner.kind === 'process' && issued.request.purpose === 'questioning'
      && !saved.post_snapshot && !outcome?.postSnapshot && fs.existsSync(beforeFile) && fs.existsSync(legacyDraft)
      && ended && invocationCompleted({ ...ended, exitCode: ended.exit_code })) {
      const pre = issued.request.pre_snapshot;
      const beforeHash = sha256Hex(Buffer.from(beforeBlueprint));
      const own = pre?.entries.filter(entry => entry.kind === 'file' && entry.path.replace(/\\/g, '/').endsWith(`/${issued.request.context.feature}/blueprint/component-blueprint.yaml`)
        && entry.sha256 === beforeHash);
      const stream = (event: GoalRunEvent): string => {
        const dir = path.join(runDir, 'phases', String(event.phase), event.invoke_id!);
        return fs.existsSync(path.join(dir, 'agent-events.jsonl')) ? path.join(dir, 'agent-events.jsonl') : path.join(dir, 'agent-output.log');
      };
      let independent = issued.request.write_boundary?.executionRole === 'verifier';
      if (!independent) {
        const parser = resolveTerminalEventParser(issued.request.context.adapter);
        const scanner = createCodexTerminalScanner({}, parser); scanner.push(fs.readFileSync(stream(start), 'utf8')); scanner.flush();
        const native = scanner.state(), qId = readProviderSessionId(stream(start), issued.request.context.adapter);
        const author = [...events.slice(0, position)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === 'initial-design-author');
        const authorId = author ? readProviderSessionId(stream(author), issued.request.context.adapter) : undefined;
        independent = !!(native.completionObserved && !native.terminalFailureObserved && qId && (!author || authorId && authorId !== qId));
      }
      if (own?.length === 1 && doc?.blueprint_id === issued.request.context.feature && independent) {
        const text = fs.readFileSync(legacyDraft, 'utf8');
        const questioning = asRecord(asRecord(asRecord(YAML.parse(text))?.review_summary)?.questioning);
        if (output.trim() && (issued.request.write_boundary?.executionRole !== 'verifier' || text === beforeBlueprint)) afterBlueprint = text;
        else if (!output.trim() && issued.request.write_boundary?.executionRole !== 'verifier'
          && questioning?.status === 'complete' && stableStringify(questioning) !== stableStringify(previous)) {
          afterBlueprint = text; previous = questioning; output = JSON.stringify(questioning);
        }
      }
    }
    return { beforeBlueprint, output, source: fs.existsSync(path.join(directory, 'questioning-output.json')) ? path.join(directory, 'questioning-output.json')
      : outcome?.output ? resultFile : afterBlueprint ? legacyDraft : resultFile,
      completed: !!ended && invocationCompleted({ ...ended, exitCode: ended.exit_code }),
      providerId: initial ? 'initial-design-questioning' : DESIGN_REPAIR_QUESTIONING_PROVIDER,
      preSnapshot: issued?.request.pre_snapshot ?? (initial ? undefined : outcome?.preSnapshot), postSnapshot: saved.post_snapshot ?? outcome?.postSnapshot,
      ...(afterBlueprint ? { afterBlueprint } : {}), previous,
      additionalInputs: Object.fromEntries(['change-unit.yaml', 'change-unit-candidates.json', 'architecture.json'].filter(name => typeof outputs[name] === 'string')
        .map(name => [path.join(runDir, 'design-repair', name), Buffer.from(outputs[name], 'base64').toString('utf8')])),
    };
  } catch { return null; }
}

export { questioningOriginal as readDesignQuestioningOriginal };

export interface DesignRepairInvocationGuard {
  pre: ReturnType<typeof capturePhaseInvocationSnapshot>;
  resolution: Parameters<typeof capturePhaseInvocationSnapshot>[0];
  options: Parameters<typeof capturePhaseInvocationSnapshot>[1];
  /** Same current facts for the coordinator; never serialized as a second state/protocol. */
  evaluation?: CompletionEvaluation;
  history?: readonly CompletionEvaluation[];
  feedbackDelivered?: boolean;
}

function priorRepairFeedback(projectRoot: string, runs: readonly { manifest: { report_dir: string }; events: GoalRunEvent[] }[], blueprintId: string): string[] {
  const failed = runs.flatMap(run => run.events.map((event, index) => ({ run, event, index })))
    .filter(item => item.event.type === 'design_authority_repair' && 'blueprint_id' in item.event && item.event.blueprint_id === blueprintId
      && 'stage' in item.event && item.event.stage === 'failed' && 'failed_step' in item.event && item.event.failed_step === 'questioning')
    .sort((a, b) => String(a.event.ts).localeCompare(String(b.event.ts))).at(-1);
  if (!failed) return [];
  const runDir = path.resolve(projectRoot, failed.run.manifest.report_dir);
  const beforeFailure = failed.run.events.slice(0, failed.index);
  const start = repairRoleStart(beforeFailure, 'questioning');
  if (!start?.invoke_id) return [];
  const issued = sessionExecutionForInvoke(runDir, start.invoke_id);
  const accepted = issued && acceptedSessionReport(runDir, issued);
  const source = accepted?.event.handoff_report ? path.resolve(runDir, accepted.event.handoff_report.path)
    : path.join(runDir, 'phases', designRepairInvokeLabel('questioning'), start.invoke_id, 'design-result.json');
  try {
    const saved = accepted?.event.handoff_report ? readHandoffMaterial<{ draft_outputs?: Record<string, string>; report?: { details?: string }; outcome?: DesignRepairInvokeOutcome }>(runDir, accepted.event.handoff_report)
      : JSON.parse(fs.readFileSync(source, 'utf8')) as { draft_outputs?: Record<string, string>; report?: { details?: string }; outcome?: DesignRepairInvokeOutcome };
    const draft = saved.draft_outputs?.['component-blueprint.yaml'];
    const doc = draft && asRecord(YAML.parse(Buffer.from(draft, 'base64').toString('utf8')));
    const returned = saved.outcome?.output ?? saved.report?.details;
    const denied = returned ? independentQuestioningBlockers({ review_summary: { questioning: parseIndependentQuestioningOutput(returned) } })
      : doc ? independentQuestioningBlockers(doc) : [];
    return denied.length ? [`前次同请求事务的真实质询差额（仅待核线索，不恢复失败草稿、不沿用旧结论）：${source}\n${JSON.stringify(denied.map(item => ({ scope_ref: item.scope_ref, question: item.question, answer: item.answer })), null, 2)}`] : [];
  } catch {
    return [`前次质询原件暂不可读：${source}；原失败说明仅作线索：${String('reason' in failed.event ? failed.event.reason : '')}`];
  }
}

export interface UnattendedDesignRepairInput {
  /** Original unattended task, supplied by the runner, not a draft or a new requirement. */
  requirement?: string;
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  /** Actual canonical design subject when the running request is still anchored before CU construction. */
  designTarget?: ComponentBlueprintRef | ChangeUnitRef;
  phase: string;
  runId: string;
  /** run 目录（工程相对）——草稿与调用日志都在这里，属于本次调用必要的运行时写入。 */
  reportDir: string;
  brief: DesignRepairBriefLike;
  signature: string;
  heldFeatureLock: HeldFeatureLock | null;
  /** 调用期间运行时自己会写的其它路径（本 feature 锁的心跳），工程相对。 */
  runtimeWrites: string[];
  emit: (event: Record<string, unknown>) => void;
  invoke: (purpose: DesignRepairPurpose, prompt: string, guard?: DesignRepairInvocationGuard) => Promise<DesignRepairInvokeOutcome>;
  /** 尝试期间多持的锁登记进运行时的统一放锁（信号处理也经它）；null = 已释放。 */
  registerLockRelease: (release: (() => void) | null) => void;
  /** 开始记录运行时经唯一发射口写出的事件行；返回的函数停止记录并交回记下的行（原顺序）。 */
  recordEventLines: () => () => Array<{ file: string; line: string }>;
  /** Root requests return to the existing P1/P2 readiness reader instead of probing a fictional CU run. */
  recheckReadiness?: () => { ready: boolean; reason?: string };
  /** Trusted existing force-resume input; never inferred from transport or elapsed time. */
  forceResume?: boolean;
}

export type UnattendedDesignRepairResult =
  | { outcome: 'handoff'; reason: string }
  | { outcome: 'waiting'; step: DesignRepairPurpose; reason: string }
  | { outcome: 'not_dispatched'; reason: string }
  | { outcome: 'failed'; step: string; reason: string; evaluation?: CompletionEvaluation }
  /** 草稿外改动，或必需快照不可验证（`changes` 为空）——两者都走既有违规处置，不降为设计等待。 */
  | { outcome: 'violation'; step: DesignRepairPurpose; reason: string; changes: PhaseInvocationChange[]; preSnapshot: string; postSnapshot: string }
  | { outcome: 'published'; recovered: boolean; step?: string; revision: number; reason: string }
  /** 收容未证明消失：不发布、不再启动下一次调用、不挂设计探针。 */
  | { outcome: 'containment_unresolved'; step: DesignRepairPurpose; reason: string };

class AttemptFailure extends Error {
  constructor(
    readonly step: string, message: string,
    readonly violation?: Omit<Extract<UnattendedDesignRepairResult, { outcome: 'violation' }>, 'outcome' | 'reason' | 'step'>,
    readonly containmentUnresolved = false,
  ) { super(message); }
}

class AttemptWaiting extends Error {
  constructor(readonly step: DesignRepairPurpose, message: string) { super(message); }
}

const canon = (value: unknown): string => stableStringify(value ?? null);

/** Publication audit and blueprint identities are maintained by the existing reconciler. */
function changeUnitPublicationContent(value: ReturnType<typeof asChangeUnitArtifact>): string {
  const copy = structuredClone(value);
  delete (copy as Partial<typeof copy>).revision;
  for (const ref of blueprintIdentityPointers(copy as unknown as Record<string, unknown>)) {
    if (ref) for (const key of ['revision', 'source_fingerprint', 'artifact_sha256']) delete ref[key];
  }
  for (const key of ['extraction_method', 'source_revision', 'observed_at']) delete (copy.provenance as unknown as Record<string, unknown>)[key];
  return canon(copy);
}
const reviewOf = (doc: BlueprintRecord): Record<string, unknown> => asRecord(doc.review_summary) ?? {};

/** 运行时随后覆盖的根 provenance 登记键（与下方登记同一组）。 */
const RUNTIME_PROVENANCE_KEYS = ['source_kind', 'source_ref', 'source_revision', 'observed_at', 'extraction_method'] as const;

const setOrDelete = (record: Record<string, unknown>, key: string, value: unknown): void => {
  if (value === undefined) delete record[key]; else record[key] = structuredClone(value);
};

/** 两份文档不同的位置（点分路径，对象逐键、等长数组逐项下钻；其余整体算一处）。 */
function differingPaths(a: unknown, b: unknown, at = ''): string[] {
  if (canon(a) === canon(b)) return [];
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((item, i) => differingPaths(item, b[i], `${at}[${i}]`));
  const ra = asRecord(a);
  const rb = asRecord(b);
  if (ra && rb && !Array.isArray(a) && !Array.isArray(b)) {
    return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].flatMap(key => differingPaths(ra[key], rb[key], at ? `${at}.${key}` : key));
  }
  return [at || '(根)'];
}

/**
 * 编写调用的授权边界（plan 9c3d7e1a t6 codex 第五轮）：草稿与基线逐字段比，只允许本次 B1 发现项定位到的字段子树
 * 与运行时随后覆盖的字段（revision、根 provenance 五个登记键、derived_results）不同。
 * 做法：把这些位置在草稿副本里还原成基线值，剩下的差异就是越权的位置。
 */
export function outOfScopePaths(base: BlueprintRecord, draft: BlueprintRecord, blueprintId: string, items: readonly DesignAuthorityFinding[]): string[] {
  const normalized = structuredClone(draft);
  setOrDelete(normalized, 'revision', base.revision);
  setOrDelete(normalized, 'derived_results', base.derived_results);
  const provenance = asRecord(normalized.provenance);
  if (provenance) for (const key of RUNTIME_PROVENANCE_KEYS) setOrDelete(provenance, key, asRecord(base.provenance)?.[key]);
  const targetOf = (doc: BlueprintRecord, target: { kind: string; view_id?: string; id: string }): Record<string, unknown> | undefined => {
    try { return asRecord(resolveBlueprintTarget(doc, target as Parameters<typeof resolveBlueprintTarget>[1])); } catch { return undefined; }
  };
  for (const item of items) {
    for (const location of item.locations ?? []) {
      if (location.blueprint_id !== blueprintId) continue;
      const from = targetOf(base, location.target);
      const to = targetOf(normalized, location.target);
      if (!from || !to) continue;
      const keys = location.field.split('.');
      const leaf = keys.pop()!;
      const parentOf = (node: Record<string, unknown>): Record<string, unknown> | undefined => keys.reduce<Record<string, unknown> | undefined>((at, key) => asRecord(at?.[key]), node);
      const fromParent = parentOf(from);
      const toParent = parentOf(to);
      if (!fromParent || !toParent) continue;
      if (item.codes.includes('authority_content_not_machine_structure')) setOrDelete(toParent, leaf, fromParent[leaf]);
    }
  }
  return differingPaths(base, normalized);
}

const sha256Hex = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex');

/** 蓝图工作区里现有的全部 run 事件文件（本 run、祖先 run 与兄弟 CU 的 run）：判重、预算与会话分段的输入。 */
function workspaceEventFiles(workspace: string): string[] {
  const files: string[] = [];
  const subdirs = (dir: string): string[] => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(dir, entry.name)); } catch { return []; }
  };
  for (const unit of [workspace, ...subdirs(workspace)]) {
    for (const run of subdirs(path.join(unit, 'goal-runs'))) {
      const file = path.join(run, 'events.jsonl');
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

/**
 * 事件文件的整文件期望值核对（调用期间它们唯一合法的写入者是运行时自己）：期望 = 调用前字节 + 运行时本次经发射口写出的行（原顺序）。
 * 实际不等于期望 → 记一条变化（按越界违规处置），并把文件整文件写回期望值——这是运行时自己的记录，写回后会话分段、attempted 与调用
 * 计数都与没被改过一样；不是还原工程文件。
 */
function restoreEventFiles(before: Map<string, Buffer>, written: ReadonlyArray<{ file: string; line: string }>, projectRoot: string): PhaseInvocationChange[] {
  const changes: PhaseInvocationChange[] = [];
  for (const [file, bytes] of before) {
    const expected = Buffer.concat([bytes, ...written.filter(item => path.resolve(item.file) === path.resolve(file)).map(item => Buffer.from(item.line, 'utf8'))]);
    let actual: Buffer | null;
    try { actual = fs.readFileSync(file); } catch { actual = null; }
    if (actual && actual.equals(expected)) continue;
    fs.writeFileSync(file, expected);
    changes.push({ path: path.relative(projectRoot, file).replace(/\\/g, '/'), how: actual ? 'modified' : 'removed', preSha256: sha256Hex(bytes), postSha256: actual ? sha256Hex(actual) : null });
  }
  return changes;
}

/** 草稿外改动的覆盖范围：工程根下全部顶层条目（依赖、缓存、构建目录按快照既有规则排除）。 */
function snapshotRoots(projectRoot: string): string[] {
  return fs.readdirSync(projectRoot).sort();
}

/** 运行时写回准入：只用校验器同源的派生函数；不复用作者对象（YAML 别名可能共享节点），整段换成新对象。 */
export function writeBackAdmission(draft: BlueprintRecord, context: { projectRoot: string; canonicalPath: string; architecture?: ArchitectureDsl }): ReturnType<typeof deriveBlueprintAdmission> {
  const derived = deriveBlueprintAdmission(draft, validateComponentBlueprintUpstream(draft, context));
  const review = reviewOf(draft);
  const sliceId = currentBlueprintSliceId(draft);
  draft.review_summary = {
    ...review,
    admission: {
      status: derived.status,
      root_questions_complete: derived.root_questions_complete,
      ...(sliceId ? { current_slice: { slice_id: sliceId, contracts_ready: derived.contracts_ready, design_refs_ready: derived.design_refs_ready } } : {}),
      blocker_refs: derived.status === 'pass' ? [] : [...new Set(derived.blocker_ids)],
    },
  };
  return derived;
}

export function refreshBlueprintFingerprints(draft: BlueprintRecord): void {
  const discovery = asRecord(draft.discovery);
  const fingerprint = fingerprintDiscoverySources(asRecords(discovery?.facts), currentScopeItems(draft));
  draft.source_fingerprint = fingerprint;
  if (discovery) discovery.source_fingerprint = fingerprint;
  draft.decision_fingerprint = `sha256:${sha256Hex(Buffer.from(canon(draft.decisions_and_gaps)))}`;
  if (Array.isArray(draft.derived_results)) draft.derived_results = reconcileP1DerivedResults(asRecords(draft.derived_results), Number(draft.revision), String(draft.source_fingerprint), String(draft.decision_fingerprint));
}

export function renderDesignAuthorityBoundary(purpose: 'author' | 'questioning'): string[] {
  return purpose === 'author' ? [
    '区分用户原文/人工裁决与当前技术施工范围：前者必须遵守，后者可在原需求内经设计修订重签；不把局部要求扩成全局限制。',
    '在原需求和明确限制内修订设计，可补节点、选型、关系和必要架构决定；不降低验收，不伪造人签，不改产品源码。',
  ] : [
    '逐项核对本次修复是否忠于原需求、验收与明确限制；架构配置改动应有对应决定和事实依据，不伪造人类确认。',
    '涉及需求变更、凭据或不可逆外部动作而无授权时给出真实 blocker，不以无人值守放行。',
  ];
}

function authorPrompt(input: UnattendedDesignRepairInput, draftFile: string, canonicalRel: string, draftFiles: readonly string[], transactionTiming: readonly string[], currentCu?: BlueprintRecord): string {
  const unit = currentCu ? asChangeUnitArtifact(currentCu) : undefined;
  const designBlockers = unit?.blockers.filter(blocker => blocker.gate === 'design' && blocker.owner === 'component-design') ?? [];
  const blockerObservations = unit ? deriveChangeUnitBlockers({ ...unit, blockers: designBlockers }, { projectRoot: input.projectRoot }) : [];
  let contract = '';
  try { contract = fs.readFileSync(path.join(input.frameworkRoot, DESIGN_REPAIR_CONTRACT_DOC), 'utf8'); } catch { contract = `（子契约文档 ${DESIGN_REPAIR_CONTRACT_DOC} 读不到：以下规则仍然适用——只做 B1 修复、只依据既有事实、不改决定、不扩范围、不改 revision / provenance、不写 review_summary.admission 与质询结果。）`; }
  return [
    '# 无人值守设计修复 · 编写',
    renderBlueprintFieldResponsibilities(),
    `run ${input.runId} · ${input.feature} · ${input.phase} 的设计权威门报告了${input.requirement ? '原需求内需设计责任方处理的' : 'B1 类'}缺口。按下面的修复简报修订并重签。`,
    '',
    `草稿文件（蓝图候选；完整可写集合如下）：${draftFile}`,
    `本次唯一可写候选集合（列表穷尽；如列有architecture.json，其内容仅为目标architecture对象）：\n${draftFiles.map(file => `- ${file}`).join('\n')}`,
    `canonical 蓝图（只读，禁止写入，发布由框架完成）：${canonicalRel}`,
    ...transactionTiming,
    '只允许修改上述明确列出的候选；所有canonical蓝图、canonical Change Unit、需求、契约、产品源码、配置原件和manifest/events/receipt等机器运行记录均只读，不因同名或位于同一工作区取得写权。其它文件改了即判越界写入，本次修复作废。',
    ...(currentCu ? [
      `当前CU候选身份：${String(currentCu.blueprint_id)}/${String(currentCu.change_unit_id)}。本次明确允许修订该候选的内容，canonical CU仍由原consumer发布。`,
      `当前CU由本设计owner负责的既有设计阻断声明（仅gate=design且owner=component-design）：\n${JSON.stringify(designBlockers, null, 2)}\n现有reader的实际只读观察（不是可回写的状态字段）：\n${JSON.stringify(blockerObservations, null, 2)}`,
      '真实解锁条件在当前候选设计中满足后，可在当前候选中有据修正或移除过时设计阻断，给出来源与依据，经独立质询、原consumer/readiness重新判定。不能伪造探针成功、添加active/resolved字段冒充机器结果，不能关闭尚未满足、其它owner、人工、设备或真实外部条件；不注册新probe，不无依据清空阻断。',
    ] : []),
    '',
    '## 修复简报',
    ...input.brief.items.map(item => `- 检查 ${item.check}［${item.codes.join(', ')}］→ 产物 ${item.artifacts.join('、') || '蓝图'}；${input.requirement ? '定位线索' : '只许改的位置'}：${(item.locations ?? []).map(at => `${at.target.kind}:${at.target.view_id ? `${at.target.view_id}/` : ''}${at.target.id}.${at.field}`).join('、') || (input.requirement ? '按原需求和本条证据定位，不扩大产品目标' : '（未定位：本次不能改蓝图）')}；修法：${item.needs.join('；')}；依据：${item.basis}`),
    '提案与目标冲突或事实不成立时可拒修：仅在草稿既有 decisions_and_gaps.decisions 追加 decision_id=依据中的 repair_candidate:<指纹>、rationale="declined: <依据>"。目标冲突用「」引目标原文；事实误判引用当前 `工程相对路径:行号` 与合法做法。独立质询确认后丢弃草稿，将理由交回原阶段；不得伪造发布成功。',
    '',
    '## 子契约',
    contract.trim(),
    ...(input.requirement ? ['', '## 本次有效无人值守授权（优先于旧 B1 限制）', input.requirement,
      renderGoalBrief(assembleGoalBrief(input.projectRoot, input.feature, { runId: input.runId }), { requirementInContext: true }),
      ...renderDesignAuthorityBoundary('author'),
      '设计修改仅落到前述实际准备的候选集合；不修改任何canonical文件。',
      '架构修改须有对应 architecture_impact 决定；保留原需求、显式禁止与数据完整性。需要改变原需求/验收或缺真实授权时保持 blocker，说明具体缺口。',
      '不要手算 revision、指纹或CU引用身份，框架负责重签；检查字段与质询结果不由作者填写。'] : []),
  ].join('\n');
}

function questioningPrompt(input: UnattendedDesignRepairInput, draftFile: string, draft: BlueprintRecord, auxiliaryDrafts: readonly string[], transactionTiming: readonly string[]): string {
  const runDir = path.resolve(input.projectRoot, input.reportDir);
  const start = [...sessionEvents(runDir)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel('questioning'));
  const previous = start ? questioningOriginal(runDir, start) : null;
  let actualDiff: import('./types').ContextFileEntry[] | null = null;
  if (previous?.completed && previous.preSnapshot && previous.postSnapshot && diffPhaseInvocationSnapshots(previous.preSnapshot, previous.postSnapshot).kind === 'clean') {
    try {
      const before = asRecord(YAML.parse(previous.beforeBlueprint));
      if (before) actualDiff = [{ label: '(actual unpublished design changes)', content: JSON.stringify(compareAuthoritativeContent(
        blueprintAuthorContent(before), blueprintAuthorContent(draft)), null, 2) }];
    } catch { /* A missing previous input never narrows independent verification. */ }
  }
  const publicContext = independentVerificationContext({ previousOriginal: previous?.completed && previous.output
    ? { label: previous.source, kind: 'path', content: '上轮公开Q完整返回及全部未闭合项；不继承作者私有上下文。' } : null,
    actualDiff, affectedDependencies: questioningDependencyChanges(input.projectRoot, draft, previous?.completed ? previous.preSnapshot : undefined, draftFile),
    currentEvidence: auxiliaryDrafts.map(file => ({ label: file, kind: 'path', content: '当前真实候选；独立核对受影响的契约与依赖。' })) });
  return [
    '# 蓝图独立质询',
    '你是独立质询方，与蓝图编写方隔离。输入只有：草稿蓝图、下面的结构化证据包，以及蓝图里已登记的外部输入（discovery 事实、需求与契约引用）。',
    '',
    `草稿文件：${draftFile}`,
    `当前待发布蓝图草稿revision=${String(draft.revision)}，不是canonical已发布版本。`,
    ...transactionTiming,
    '本事务原消费者的完整发现（按当前候选核实；已实际消除的不继续当缺陷，未核实的不冒充已修）：',
    JSON.stringify(input.brief, null, 2),
    '本次实际只读，不写草稿或工程文件。最终只返回既有questioning形状的JSON对象；框架保留本次原件并在调用完成与只读核对后回填review_summary.questioning。',
    ...renderQuestioningResultInstructions(draft, DESIGN_REPAIR_QUESTIONING_PROVIDER),
    ...publicContext.map(entry => `${entry.label}\n${entry.content}`),
    ...(input.requirement ? ['', '## 原始请求与候选一致性', input.requirement,
      renderGoalBrief(assembleGoalBrief(input.projectRoot, input.feature, { runId: input.runId }), { requirementInContext: true }),
      ...(auxiliaryDrafts.length ? [`同时只读本事务实际候选：${auxiliaryDrafts.join('；')}。`] : []),
      ...renderDesignAuthorityBoundary('questioning')] : []),
  ].join('\n');
}

/**
 * 一次无人值守 B1 修复尝试。调用方负责前提（无人值守、B1、预授权、签名未尝试过）与之后的续跑判断。
 * 取不到锁 → `not_dispatched`，不写 attempted、不调用 adapter。
 */
export async function runUnattendedDesignRepair(input: UnattendedDesignRepairInput): Promise<UnattendedDesignRepairResult> {
  const { projectRoot, frameworkRoot } = input;
  const target = input.designTarget ?? designRepairTarget(projectRoot, input.feature);
  const blueprintId = target.blueprint_id;
  const changeUnitId = target.artifact === 'change-unit@1' ? target.change_unit_id : undefined;
  const canonicalPath = componentBlueprintPath(projectRoot, blueprintId);
  const canonicalRel = path.relative(projectRoot, canonicalPath).replace(/\\/g, '/');
  const context: { projectRoot: string; canonicalPath: string; architecture?: ArchitectureDsl } = { projectRoot, canonicalPath };
  const base = {
    type: 'design_authority_repair', phase: input.phase, blueprint_id: blueprintId, action: 'content_repair', signature: input.signature,
    checks: input.brief.items.map(item => ({ check: item.check, codes: item.codes })),
  };
  const allChangeUnits = enumerateCanonicalChangeUnits(projectRoot, blueprintId).map(loaded => String(loaded.changeUnit.change_unit_id));
  const locks = acquireBlueprintWriteLocks(projectRoot, blueprintId, allChangeUnits, input.heldFeatureLock ? [input.heldFeatureLock] : []);
  if ('busy' in locks) return { outcome: 'not_dispatched', reason: `取不到两层锁，未派发（不消耗本签名的修复机会）：${locks.busy}` };
  input.registerLockRelease(locks.release);
  const release = (): void => { locks.release(); input.registerLockRelease(null); };
  let published: { revision: number } | undefined;
  let restoreUnpublishedArchitecture: (() => void) | undefined;
  let reviewDocument: BlueprintReviewResult | undefined;
  const evidence: Record<string, unknown> = {};
  try {
    const runDir = path.join(projectRoot, input.reportDir);
    const manifest = loadGoalRunManifestFromRun(projectRoot, input.runId, { feature: input.feature });
    const family = readOriginalDeliveryActivity(projectRoot, manifest);
    const currentEvents = sessionEvents(runDir);
    const latestRole = [...currentEvents].reverse().find(event => event.type === 'agent_invoke_start'
      && (event.phase === designRepairInvokeLabel('author') || event.phase === designRepairInvokeLabel('questioning')) && event.invoke_id);
    const issuedRole = latestRole?.invoke_id ? sessionExecutionForInvoke(runDir, latestRole.invoke_id) : null;
    const acceptedRole = issuedRole && acceptedSessionReport(runDir, issuedRole);
    const roleEnded = latestRole?.invoke_id && currentEvents.some(event => event.invoke_id === latestRole.invoke_id
      && ['agent_invoke_end', 'agent_process_settled', 'orphan_reclaimed', 'agent_invoke_recovered'].includes(event.type ?? ''));
    const roleIncomplete = acceptedRole && !invocationCompleted({ ...acceptedRole.event,
      status: acceptedRole.report.status, exitCode: acceptedRole.event.exit_code });
    const roleEndAt = currentEvents.findIndex(event => event.type === 'agent_invoke_end' && event.invoke_id === latestRole?.invoke_id);
    const continuedRole = roleIncomplete && input.forceResume && roleEndAt >= 0
      && roleEndAt < currentEvents.map(event => event.type === 'run_start').lastIndexOf(true);
    if (roleIncomplete && !continuedRole) {
      const purpose = latestRole!.phase === designRepairInvokeLabel('questioning') ? 'questioning' : 'author';
      if (acceptedRole.report.status === 'waiting') throw new AttemptWaiting(purpose, acceptedRole.report.details ?? '原设计调用尚在等待。');
      throw new AttemptFailure(purpose, acceptedRole.report.details ?? acceptedRole.report.status);
    }
    if (issuedRole && (!roleEnded || continuedRole)) {
      const purpose = latestRole!.phase === designRepairInvokeLabel('questioning') ? 'questioning' : 'author';
      const request = issuedRole.request;
      const result = await input.invoke(purpose, request.context.instruction ?? '', request.pre_snapshot && request.write_boundary
        ? { pre: request.pre_snapshot, resolution: request.write_boundary, options: request.snapshot_options ?? {} } : undefined);
      if (result.status === 'waiting') throw new AttemptWaiting(purpose, result.detail);
      if (result.handoff) { release(); return { outcome: 'handoff', reason: '原设计请求仍待实际结果；候选与原快照未改写。' }; }
      if (!result.ok) throw new AttemptFailure(purpose, result.detail);
    }
    const ancestors = family ? [] : readSupersededAncestorRuns({ projectRoot, featuresDir: relFeaturesDir(projectRoot), feature: input.feature, currentEvents });
    const historyRuns = family?.runs ?? [{ manifest, events: currentEvents }, ...ancestors.map(run => ({
      manifest: loadGoalRunManifestFromRun(projectRoot, run.run_id, { feature: input.feature }), events: run.events,
    }))];
    let authorFeedback = priorRepairFeedback(projectRoot, historyRuns, blueprintId);
    let feedbackDelivered = authorFeedback.length > 0;
    const transactionEvents = sessionEvents(runDir);
    const priorAttempt = [...transactionEvents].reverse().find(event => event.type === 'design_authority_repair'
      && (event as Record<string, unknown>).blueprint_id === blueprintId && (event as Record<string, unknown>).stage === 'attempted'
      && !transactionEvents.slice(transactionEvents.indexOf(event) + 1).some(later => later.type === 'design_authority_repair'
        && (later as Record<string, unknown>).blueprint_id === blueprintId && (later as Record<string, unknown>).stage === 'published'
        && !((later as Record<string, unknown>).outcome === 'unrecovered'
          && (later as Record<string, unknown>).failed_step === 'reconcile'))) as Record<string, unknown> | undefined;
    const draftDir = path.join(runDir, 'design-repair');
    const draftFile = path.join(draftDir, 'component-blueprint.yaml');
    const cuDraftFile = path.join(draftDir, 'change-unit.yaml');
    const batchDraftFile = isInitialDesignManifest(manifest) && input.requirement ? path.join(draftDir, 'change-unit-candidates.json') : undefined;
    const architectureDraftFile = path.join(draftDir, 'architecture.json');
    const configFile = path.join(projectRoot, 'framework.config.json');
    type OriginalContext = { baseline: string; cu?: string; config?: string; startedAt: string; brief: DesignRepairBriefLike; eventOriginals?: Record<string, string> };
    let original: OriginalContext;
    if (priorAttempt?.handoff_context) original = readHandoffMaterial<OriginalContext>(runDir, priorAttempt.handoff_context as HandoffReference);
    else {
      if (target.artifact === 'change-unit@1') resolveChangeUnitRefFromLoaded(loadCanonicalChangeUnit(projectRoot, blueprintId, target.change_unit_id), target);
      else resolveComponentBlueprintRefFromLoaded(loadCanonicalBlueprint(projectRoot, blueprintId), target);
      original = { baseline: fs.readFileSync(canonicalPath).toString('base64'), brief: input.brief,
        eventOriginals: Object.fromEntries(workspaceEventFiles(changeUnitDirectory(projectRoot, blueprintId))
          .map(file => [path.relative(projectRoot, file).replace(/\\/g, '/'), fs.readFileSync(file).toString('base64')])),
        ...(input.requirement ? { ...(changeUnitId ? { cu: loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId).bytes.toString('base64') } : {}), config: fs.readFileSync(configFile).toString('base64') } : {}),
        startedAt: new Date().toISOString() };
      fs.mkdirSync(draftDir, { recursive: true });
      const bytes = JSON.stringify(original, null, 2) + '\n';
      const firstContext = path.join(draftDir, 'original-context.json');
      const file = fs.existsSync(firstContext) ? path.join(draftDir, `original-context.${sha256Hex(Buffer.from(bytes))}.json`) : firstContext;
      fs.writeFileSync(file, bytes, { flag: 'wx' });
      input.emit({ ...base, stage: 'attempted', preauthorization: input.requirement ? `${input.reportDir}/manifest.json#requirement` : DESIGN_REPAIR_PREAUTH_KEY,
        handoff_context: { path: path.relative(runDir, file).replace(/\\/g, '/'), sha256: sha256Hex(Buffer.from(bytes)) } });
      fs.writeFileSync(draftFile, Buffer.from(original.baseline, 'base64'));
      if (original.cu) fs.writeFileSync(cuDraftFile, Buffer.from(original.cu, 'base64'));
      if (batchDraftFile) fs.writeFileSync(batchDraftFile, '[]\n');
      if (original.config) fs.writeFileSync(architectureDraftFile, JSON.stringify(JSON.parse(Buffer.from(original.config, 'base64').toString('utf8')).architecture, null, 2) + '\n');
    }
    const baseline = Buffer.from(original.baseline, 'base64');
    const baseDoc = YAML.parse(baseline.toString('utf8')) as BlueprintRecord;
    if (fs.existsSync(draftFile) && fs.readFileSync(canonicalPath).equals(fs.readFileSync(draftFile))
      && Number((YAML.parse(fs.readFileSync(canonicalPath, 'utf8')) as BlueprintRecord).revision) === Number(baseDoc.revision) + 1) {
      published = { revision: Number(baseDoc.revision) + 1 };
    }
    const originalCu = original.cu && changeUnitId ? { canonicalPath: path.join(changeUnitDirectory(projectRoot, blueprintId), changeUnitId, 'change-unit.yaml'),
      bytes: Buffer.from(original.cu, 'base64'), artifactSha256: `sha256:${sha256Hex(Buffer.from(original.cu, 'base64'))}`,
      changeUnit: YAML.parse(Buffer.from(original.cu, 'base64').toString('utf8')) as ReturnType<typeof loadCanonicalChangeUnit>['changeUnit'] } : undefined;
    const configBaseline = original.config ? Buffer.from(original.config, 'base64') : undefined;
    const originalArchitecture = configBaseline ? JSON.parse(configBaseline.toString('utf8')).architecture : undefined;
    if (batchDraftFile && !fs.existsSync(batchDraftFile)) fs.writeFileSync(batchDraftFile, '[]\n');
    const auxiliaryDrafts = [...(originalCu ? [cuDraftFile] : []), ...(batchDraftFile ? [batchDraftFile] : []), ...(configBaseline ? [architectureDraftFile] : [])];
    const authorDrafts = [draftFile, ...auxiliaryDrafts];
    if (input.requirement) context.architecture = JSON.parse(fs.readFileSync(architectureDraftFile, 'utf8')) as ArchitectureDsl;
    const readBatchCandidates = (): ChangeUnitCandidate[] => {
      if (!batchDraftFile) return [];
      const value: unknown = JSON.parse(fs.readFileSync(batchDraftFile, 'utf8'));
      if (!Array.isArray(value)) throw new AttemptFailure('author', 'change-unit-candidates.json 必须是既有 ChangeUnitCandidate[]');
      const seen = new Set(changeUnitId ? [changeUnitId] : []);
      return value.map(item => {
        const row = asRecord(item), artifact = asRecord(row?.artifact);
        if (!row || typeof row.providerId !== 'string' || !row.providerId.trim() || !artifact
          || artifact.blueprint_id !== blueprintId || typeof artifact.change_unit_id !== 'string'
          || !allChangeUnits.includes(artifact.change_unit_id) || seen.has(artifact.change_unit_id)) {
          throw new AttemptFailure('author_scope', '同批候选必须是本设计单元已存在、已锁定且不重复的CU；主CU仍使用change-unit.yaml');
        }
        seen.add(artifact.change_unit_id);
        const loaded = loadCanonicalChangeUnit(projectRoot, blueprintId, artifact.change_unit_id);
        const candidate = asChangeUnitArtifact(artifact);
        if (changeUnitPublicationContent(asChangeUnitArtifact(loaded.changeUnit)) !== changeUnitPublicationContent(candidate)) {
          resolveChangeUnitRefFromLoaded(loaded, { ...createChangeUnitRef(loaded), revision: candidate.revision });
        }
        return { providerId: row.providerId, artifact: candidate };
      });
    };
    const prepareCu = (doc: BlueprintRecord, value: ChangeUnitArtifact): ChangeUnitArtifact => {
      const candidate = completeChangeUnitDesignRefs(doc, value, projectRoot);
      const pointers = blueprintIdentityPointers(candidate as unknown as BlueprintRecord);
      const identity = currentBlueprintIdentity(loadCanonicalBlueprint(projectRoot, blueprintId));
      const key = (ref: BlueprintRecord | undefined): string => stableStringify(Object.keys(identity).map(field => ref?.[field]));
      if (pointers.every(ref => ref && key(ref) === key(pointers[0])) && Number(pointers[0]?.revision) <= identity.revision
        && evaluateChangeUnitCarryForward(projectRoot, candidate).allowed) for (const ref of pointers) Object.assign(ref!, identity);
      return candidate;
    };
    const batchWasReviewed = (saved: ReturnType<typeof questioningOriginal>, start?: GoalRunEvent): boolean => {
      if (!batchDraftFile || !readBatchCandidates().length) return true;
      const original = start?.invoke_id ? readExecutionRequestOriginal(runDir, start.invoke_id) : null;
      return typeof saved?.additionalInputs[batchDraftFile] === 'string' && !!original?.request.context.instruction?.replace(/\\/g, '/')
        .includes(path.relative(runDir, batchDraftFile).replace(/\\/g, '/'));
    };
    const sourceRefs = input.requirement ? manifest.requirement_source_files?.length
      ? manifest.requirement_source_files : [`${input.reportDir}/manifest.json#requirement`] : [];
    const prepareDraft = (doc: BlueprintRecord): BlueprintRecord => {
      const declared = currentScopeItems(doc).map(item => item.source_ref);
      const prepared = prepareBlueprintDesignDraft(doc, { blueprintId, observedAt: original.startedAt,
        sourceRef: input.requirement ? `${input.reportDir}/manifest.json#requirement` : undefined,
        currentScopeItems: prepareBlueprintSourceItems(projectRoot, declared.length ? declared : sourceRefs, original.startedAt) });
      refreshBlueprintFingerprints(prepared);
      writeBackAdmission(prepared, context);
      return prepared;
    };
    const transactionTiming = [
      `本事务真实基线：blueprint_id=${String(baseDoc.blueprint_id)}；revision=${String(baseDoc.revision)}；source_fingerprint=${String(baseDoc.source_fingerprint)}；artifact_sha256=sha256:${sha256Hex(baseline)}。`,
      `本次可写的是本事务当前未发布候选，首轮从基线准备，后续承接已生成候选；相对基线只预留同一个revision=${Number(baseDoc.revision) + 1}，身份由框架维护，作者不自行升版。`,
      ...(originalCu ? ['CU候选的component_blueprint_ref、design_refs和touches.design_ref中的revision/source_fingerprint/artifact_sha256在发布前可仍绑定已核基线；框架只先补齐设计引用闭包，待质询通过并发布最终蓝图字节后，才用最终身份统一重绑，再经原CU consumer、调和与readiness严格复验。不得要求作者在发布前伪填未来hash或把候选冒充已可施工。'] : []),
      ...(batchDraftFile ? [`原设计单元如需同步修订当前已报缺口或provide确受影响的消费者，使用 ${batchDraftFile} 的既有 ChangeUnitCandidate[]（每项 {providerId, artifact}）；主CU仍在change-unit.yaml。只提交同蓝图已存在的真实CU候选，不造新ID、不删除消费者、不虚构依赖或审批；保原承诺与requires，独立Q核对整批真实变化后交原原子consumer事务。没有相关变化时保持空数组。`] : []),
      '质询必须核对正确blueprint_id、稳定target的存在与语义、契约、原需求和真实内容；上述事务时点不豁免错蓝图、错目标、无依据身份或实际内容缺陷，仍可依据具体证据否定。',
    ];
    // 核对范围：本任务的工作区（蓝图工作区：canonical 蓝图、全部 CU、各 run 的 manifest / run-control）不套用通用的运行时目录排除；
    // 本任务实际引用的输入（蓝图 source_ref 指向的项目内文件）即使在通常排除的目录里也逐个核；只排除调用期间运行时自己会写的路径。
    // 工作区里的事件文件按整文件期望值单独核（restoreEventFiles）。
    const runRel = input.reportDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const immutableInputPaths = [...workUnitProtectedRecordPaths(projectRoot, input.feature, runDir), `${runRel}/manifest.json`];
    const workspace = changeUnitDirectory(projectRoot, blueprintId);
    const owned = [path.relative(projectRoot, workspace)];
    const eventFiles = workspaceEventFiles(workspace);
    const excluded = [
      `${runRel}/design-repair`, `${runRel}/phases/${designRepairInvokeLabel('author')}`, `${runRel}/phases/${designRepairInvokeLabel('questioning')}`,
      `${runRel}/run-control.json`, `${runRel}/.runner.lock`,
      path.relative(projectRoot, path.join(workspace, BLUEPRINT_RECONCILE_LOCK_NAME)),
      ...allChangeUnits.map(id => path.relative(projectRoot, featureFilePath(projectRoot, deriveChangeUnitFeatureId(blueprintId, id), path.join('goal-runs', FEATURE_LOCK_NAME)))), `${runRel}/session-control.log`, `${runRel}/progress.json`, `${runRel}/progress.md`, `${runRel}/${LIVENESS_BEACON_FILENAME}`, ...input.runtimeWrites,
      ...eventFiles.map(file => path.relative(projectRoot, file)),
    ];
    const relOf = (file: string): string => path.relative(projectRoot, file).replace(/\\/g, '/');
    const baselineRefs = blueprintSourceRefFiles(projectRoot, baseDoc).map(relOf);
    let usedQuestioningInvokeId: string | undefined;
    let usedInvocation: GoalRunEvent | undefined;
    const guarded = async (purpose: DesignRepairPurpose, prompt: string, referenced: readonly string[], afterInvokeId: string | null): Promise<ReturnType<typeof capturePhaseInvocationSnapshot> | { handoff: true }> => {
      if (purpose === 'questioning') {
        const events = sessionEvents(runDir);
        const attempted = events.map(event => event.type === 'design_authority_repair' && 'stage' in event && event.stage === 'attempted').lastIndexOf(true);
        const prior = [...events.slice(attempted + 1)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel('questioning'))
          ?? (!events.slice(attempted + 1).some(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel('author'))
            ? [...events.slice(0, attempted)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === 'initial-design-questioning') : undefined);
        const saved = prior ? questioningOriginal(runDir, prior) : null;
        const blueprint = asRecord(YAML.parse(fs.readFileSync(draftFile, 'utf8')));
        const reused = saved && blueprint && batchWasReviewed(saved, prior) ? reusableDesignQuestioning({ ...saved, projectRoot, blueprintPath: draftFile, blueprint }) : null;
        if (saved && blueprint && reused && (!saved.afterBlueprint || stableStringify(asRecord(reviewOf(blueprint).questioning)) === stableStringify(reused))) {
          if (!saved.afterBlueprint) applyIndependentQuestioningOutput(draftFile, path.join(runDir, 'phases', String(prior!.phase), prior!.invoke_id!, 'questioning-output.json'), saved.output, saved.providerId);
          usedQuestioningInvokeId = prior!.invoke_id;
          usedInvocation = prior;
          return saved.preSnapshot!;
        }
      }
      const readonlyInputs = purpose === 'questioning' ? new Map(authorDrafts.map(file => [file, fs.readFileSync(file)] as const)) : null;
      const originalBlueprintBytes = fs.readFileSync(draftFile);
      const startsBefore = new Set(sessionEvents(runDir).filter(event => event.type === 'agent_invoke_start').map(event => event.invoke_id));
      // 根在调用前后各列一次：调用里新建的顶层条目也要进差集。
      const resolution = { projectRoot, protectedRoots: snapshotRoots(projectRoot),
        executionRole: purpose === 'questioning' ? 'verifier' as const : 'author' as const,
        immutableInputPaths };
      const snapshotOptions = { ownedPrefixes: owned, runtimeExcluded: excluded, includeFiles: referenced };
      const capture = (): ReturnType<typeof capturePhaseInvocationSnapshot> => capturePhaseInvocationSnapshot(resolution, snapshotOptions);
      let pre = capture();
      // 调用前就不可验证：还没有派出调用，尝试失败（不发布）；调用后不可验证：可能有越界写入而无从核对，按违规处置。
      if (pre.failureReason) throw new AttemptFailure(purpose, `调用前写归因快照不可核实（不得当作干净继续）：${pre.failureReason}`);
      const eventsBefore = new Map(eventFiles.map(file => [file, fs.readFileSync(file)] as const));
      const stopRecording = input.recordEventLines();
      let written: Array<{ file: string; line: string }> = [];
      let result: DesignRepairInvokeOutcome;
      try {
        const current = readDraft(purpose);
        const latestQuestion = repairRoleStart(sessionEvents(runDir), 'questioning');
        const saved = latestQuestion ? questioningOriginal(runDir, latestQuestion) : null;
        const verified = saved && batchWasReviewed(saved, latestQuestion) && reusableDesignQuestioning({ ...saved, projectRoot, blueprintPath: draftFile, blueprint: current });
        const cu = originalCu && fs.existsSync(cuDraftFile) ? asChangeUnitArtifact(YAML.parse(fs.readFileSync(cuDraftFile, 'utf8'))) : undefined;
        result = await input.invoke(purpose, prompt, { pre, resolution, options: snapshotOptions,
          evaluation: evaluationOf(current, designWorkSnapshot(authorDrafts), !!verified, pre, cu),
          history: [...comparableHistory, ...(previousEvaluation ? [previousEvaluation] : [])], feedbackDelivered: feedbackDelivered || authorFeedback.length > 0 });
      } finally {
        written = stopRecording();
      }
      const after = sessionEvents(runDir);
      const started = result.invokeId ? after.find(event => event.type === 'agent_invoke_start' && event.invoke_id === result.invokeId)
        : [...after].reverse().find(event => event.type === 'agent_invoke_start' && !startsBefore.has(event.invoke_id));
      usedInvocation = started;
      if (started?.invoke_id && !startsBefore.has(started.invoke_id)) {
        const beforeFile = path.join(runDir, 'phases', String(started.phase), started.invoke_id, 'blueprint-before.yaml');
        if (!fs.existsSync(beforeFile)) fs.writeFileSync(beforeFile, originalBlueprintBytes, { flag: 'wx' });
      }
      if (result.handoff) return { handoff: true };
      if (result.preSnapshot) pre = result.preSnapshot;
      if (result.status === 'waiting' && !result.started) throw new AttemptWaiting(purpose, result.detail);
      if (!result.started) throw new AttemptFailure(purpose, `未启动：${result.detail}${purpose === 'author' && afterInvokeId ? '\n' + authorFeedback.join('\n') : ''}`);
      // 收容没能证明子进程已消失：它可能还在写，后面的核对与发布都没有意义——交运行时走既有收容停机。
      if (result.containmentUnresolved) throw new AttemptFailure(purpose, `调用的子进程收容失败且未证明已消失：${result.detail}`, undefined, true);
      const post = result.postSnapshot ?? capture();
      const diff = diffPhaseInvocationSnapshots(pre, post);
      const eventChanges = restoreEventFiles(eventsBefore, written, projectRoot);
      for (const [relative, encoded] of Object.entries(original.eventOriginals ?? {})) {
        const file = path.join(projectRoot, relative);
        const bytes = Buffer.from(encoded, 'base64');
        const current = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
        if (!current.subarray(0, bytes.length).equals(bytes)) {
          eventChanges.push({ path: relative, how: 'modified', preSha256: sha256Hex(bytes), postSha256: sha256Hex(current) });
          fs.writeFileSync(file, Buffer.concat([bytes, current.subarray(bytes.length)]));
        }
      }
      if (diff.kind === 'unverifiable') {
        throw new AttemptFailure(purpose, `调用后写归因快照不可核实（不得当作干净继续）：${diff.reason}`, { changes: eventChanges, preSnapshot: pre.sha256, postSnapshot: post.sha256 });
      }
      const changes = [...(diff.kind === 'changed' ? diff.changes : []), ...eventChanges];
      if (changes.length) {
        throw new AttemptFailure(purpose, `${purpose === 'author' ? '编写' : '质询'}调用改了草稿之外的文件：${changes.map(change => change.path).slice(0, 20).join('、')}`,
          { changes, preSnapshot: pre.sha256, postSnapshot: post.sha256 });
      }
      if (result.status === 'waiting') throw new AttemptWaiting(purpose, result.detail);
      if (!result.ok) throw new AttemptFailure(purpose, `调用失败：${result.detail}`);
      if (readonlyInputs) {
        if ([...readonlyInputs].some(([file, bytes]) => !fs.existsSync(file) || !fs.readFileSync(file).equals(bytes))) {
          throw new AttemptFailure(purpose, '独立质询修改了只读设计输入；结果不回填。');
        }
        const start = usedInvocation;
        if (!start?.invoke_id) throw new AttemptFailure(purpose, '独立质询缺少真实调用标识。');
        usedQuestioningInvokeId = start.invoke_id;
        try { applyIndependentQuestioningOutput(draftFile,
          path.join(runDir, 'phases', String(start.phase), start.invoke_id, 'questioning-output.json'),
          result.output ?? '', DESIGN_REPAIR_QUESTIONING_PROVIDER); }
        catch (error) { throw new AttemptFailure(purpose, `独立质询原件不可接受：${(error as Error).message}`); }
      }
      return pre;
    };
    const readDraft = (step: string): BlueprintRecord => {
      try {
        const doc = asRecord(YAML.parse(fs.readFileSync(draftFile, 'utf8')));
        if (!doc) throw new Error('根不是对象');
        return doc;
      } catch (error) { throw new AttemptFailure(step, `草稿读不出来：${(error as Error).message}`); }
    };
    const writeDraft = (doc: BlueprintRecord): void => fs.writeFileSync(draftFile, YAML.stringify(doc));

    const acceptanceKey = sha256Hex(Buffer.from(stableStringify({ requirement: manifest.requirement,
      authority: { write_mode: manifest.unattended?.write_mode, approval_mode: manifest.unattended?.approval_mode, allowed_tools: manifest.unattended?.allowed_tools },
      baseline: blueprintAuthorContent(baseDoc) })));
    const consumerKinds = new Set<BlueprintProjectionKind>(input.phase === 'initial-design'
      ? ['acceptance', 'contracts'] : input.phase === 'spec' ? ['acceptance'] : input.phase === 'plan' ? ['contracts'] : []);
    for (const location of input.brief.items.flatMap(item => item.locations ?? [])) {
      if (/^acceptance(?:\.|$)/.test(location.field)) consumerKinds.add('acceptance');
      if (/^(?:contracts|use_cases)(?:\.|$)/.test(location.field)) consumerKinds.add('contracts');
    }
    const contentChecks = (doc: BlueprintRecord, candidateCu?: ChangeUnitArtifact): CheckResult[] => {
      const currentCu = candidateCu ?? (originalCu ? asChangeUnitArtifact(originalCu.changeUnit)
        : changeUnitId ? asChangeUnitArtifact(loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId).changeUnit) : undefined);
      return [...(currentCu ? [currentCu] : []), ...readBatchCandidates().map(row => row.artifact)].flatMap(unit => {
        const ctx = { projectRoot, frameworkRoot, feature: deriveChangeUnitFeatureId(blueprintId, unit.change_unit_id), phase: input.phase,
          featureSpec: {}, phaseRule: {} } as CheckContext;
        return [...consumerKinds].flatMap(kind => checkAuthoritativeContentAligned(ctx, kind,
          deriveBlueprintCandidateSkillInput(projectRoot, ctx.feature, frameworkRoot, kind, { blueprint: doc, changeUnit: unit })));
      });
    };
    const evaluationOf = (doc: BlueprintRecord, work: ArtifactSnapshot, completed: boolean, pre?: ReturnType<typeof capturePhaseInvocationSnapshot>, candidateCu?: ChangeUnitArtifact): CompletionEvaluation => {
      const blueprintIssues = validateComponentBlueprint(doc, context);
      const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'design', projectRoot, blueprintPath: canonicalPath,
        blueprint: doc, blueprintIssues, checks: contentChecks(doc, candidateCu), questioningFindings: asRecord(reviewOf(doc).questioning)?.status === 'complete' ? independentQuestioningBlockers(doc) : [],
        phase: 'component-design', providerState: completed ? 'available' : 'unknown' }));
      const inputs = { ...work };
      let known = !!pre && !pre.failureReason;
      for (const file of blueprintSourceRefFiles(projectRoot, doc, true)) {
        if (path.resolve(file) === path.resolve(draftFile) || path.resolve(file) === path.resolve(canonicalPath)) continue;
        const relative = relOf(file);
        const entry = pre?.entries.find(item => item.path === relative && item.kind === 'file');
        if (!entry) { known = false; continue; }
        inputs[`dependency:${relative}`] = { exists: true, contentHash: entry.sha256 };
      }
      return { acceptanceKey, inputs, disposition, completed: completed && known, checkFamilies: ['component-design'] };
    };
    let previousEvaluation: CompletionEvaluation | undefined;
    const comparableHistory: CompletionEvaluation[] = [];
    const starts = sessionEvents(runDir);
    const transactionAt = starts.map(event => event.type === 'design_authority_repair' && 'stage' in event && event.stage === 'attempted').lastIndexOf(true);
    const initialQuestion = [...starts.slice(0, transactionAt)].reverse().find(event => event.type === 'agent_invoke_start' && event.phase === 'initial-design-questioning');
    const priorQuestions = [...(initialQuestion ? [initialQuestion] : []), ...starts.slice(transactionAt + 1)
      .filter(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel('questioning'))];
    for (const start of priorQuestions) {
      const saved = questioningOriginal(runDir, start);
      if (!saved || !batchWasReviewed(saved, start)) continue;
      const priorArchitecture = context.architecture;
      try {
        const originalArchitectureInput = saved.additionalInputs[architectureDraftFile];
        if (originalArchitectureInput) context.architecture = JSON.parse(originalArchitectureInput) as ArchitectureDsl;
        const doc = asRecord(YAML.parse(saved.beforeBlueprint));
        if (!doc) continue;
        const result = reusableDesignQuestioning({ ...saved, additionalInputs: {}, projectRoot, blueprintPath: draftFile, blueprint: doc });
        if (!result) continue;
        doc.review_summary = { ...asRecord(doc.review_summary), questioning: result };
        writeBackAdmission(doc, context);
        const contents = { ...saved.additionalInputs, [draftFile]: YAML.stringify(doc) };
        const historicalCu = contents[cuDraftFile] ? asChangeUnitArtifact(YAML.parse(contents[cuDraftFile])) : undefined;
        const evaluation = evaluationOf(doc, designWorkSnapshot(authorDrafts, contents), true, saved.preSnapshot, historicalCu);
        if (evaluation.completed) { if (previousEvaluation) comparableHistory.push(previousEvaluation); previousEvaluation = evaluation; }
      } catch { /* Missing old originals never become a fabricated comparable result. */ }
      finally { context.architecture = priorArchitecture; }
    }

    const revision = Number(baseDoc.revision) + 1;
    let cuCandidate: ReturnType<typeof asChangeUnitArtifact> | undefined;
    let batchCandidates: ChangeUnitCandidate[] = [];
    let questioningPreimage: ReturnType<typeof capturePhaseInvocationSnapshot> | undefined;
    let architectureChanged = false;
    let questioned: BlueprintRecord = baseDoc;
    let text = '';
    let authorPreimage = structuredClone(baseDoc);
    let afterQuestioning: string | null = null;
    const repairEvents = sessionEvents(runDir);
    const roleHistory = repairEvents.slice(transactionAt + 1).filter(event => event.type === 'agent_invoke_start'
      && (event.phase === designRepairInvokeLabel('author') || event.phase === designRepairInvokeLabel('questioning')));
    const lastAuthorAt = roleHistory.map(event => event.phase).lastIndexOf(designRepairInvokeLabel('author'));
    if (lastAuthorAt >= 0) {
      // Reopen the actual round, including an author that followed an independent denial.
      afterQuestioning = [...roleHistory.slice(0, lastAuthorAt)].reverse().find(event => event.phase === designRepairInvokeLabel('questioning'))?.invoke_id ?? null;
    } else {
      const question = roleHistory.at(-1);
      const saved = question ? questioningOriginal(runDir, question) : null;
      const current = readDraft('questioning');
      const verified = saved && reusableDesignQuestioning({ ...saved, projectRoot, blueprintPath: draftFile, blueprint: current });
      if (verified && stableStringify(asRecord(reviewOf(current).questioning)) === stableStringify(verified)
        && independentQuestioningBlockers({ ...current, review_summary: { ...reviewOf(current), questioning: verified } }).length) {
        afterQuestioning = question!.invoke_id ?? null;
      }
    }
    const paused = [...repairEvents].reverse().find(event => event.type === 'design_authority_repair' && 'signature' in event && event.signature === input.signature && 'stage' in event && event.stage === 'failed');
    if (paused && 'failed_step' in paused && paused.failed_step === 'no_progress_guard' && 'reason' in paused) {
      authorFeedback.push(String(paused.reason));
      const pausedAt = repairEvents.indexOf(paused);
      const latestQuestion = repairRoleStart(repairEvents.slice(0, pausedAt), 'questioning');
      const continuing = repairEvents.slice(pausedAt + 1).some(event => event.type === 'agent_invoke_start' && event.phase === designRepairInvokeLabel('author'));
      try {
        if (latestQuestion?.invoke_id) {
          const issued = sessionExecutionForInvoke(runDir, latestQuestion.invoke_id);
          const accepted = issued && acceptedSessionReport(runDir, issued);
          const saved = accepted ? readHandoffMaterial<{ draft_outputs: Record<string, string> }>(runDir, accepted.event.handoff_report!)
            : JSON.parse(fs.readFileSync(path.join(runDir, 'phases', designRepairInvokeLabel('questioning'), latestQuestion.invoke_id, 'design-result.json'), 'utf8'));
          if (authorDrafts.every(file => typeof saved.draft_outputs?.[path.basename(file)] === 'string')) {
            const contents = Object.fromEntries(authorDrafts.map(file => [file, Buffer.from(saved.draft_outputs[path.basename(file)], 'base64').toString('utf8')]));
            questioned = YAML.parse(contents[draftFile]) as BlueprintRecord;
            const returned = accepted?.report.details ?? saved.outcome?.output;
            if (returned) {
              const review = reviewOf(questioned);
              questioned.review_summary = { ...review, questioning: independentQuestioningEnvelope(
                parseIndependentQuestioningOutput(returned), DESIGN_REPAIR_QUESTIONING_PROVIDER, review.authored_by, asRecord(review.questioning)) };
              contents[draftFile] = YAML.stringify(questioned);
            }
            writeBackAdmission(questioned, context);
          }
        }
      } catch { /* Missing original role outputs are an unknown comparison baseline. */ }
      authorPreimage = continuing ? structuredClone(questioned) : readDraft('author');
      if (!continuing) writeDraft(authorPreimage);
      afterQuestioning = repairEvents.slice(0, pausedAt).filter(event => event.type === 'agent_invoke_start' && (event.phase === designRepairInvokeLabel('author') || event.phase === designRepairInvokeLabel('questioning'))).at(-1)?.invoke_id ?? null;
    }
    {
      authorPreimage = prepareDraft(readDraft('author'));
      writeDraft(authorPreimage);
      // Re-entry replays prior rounds from their real role archives, never from the author's output as preimage.
      let currentCuInput = originalCu ? asRecord(YAML.parse(fs.readFileSync(cuDraftFile, 'utf8'))) : undefined;
      if (currentCuInput && input.requirement) {
        currentCuInput = prepareCu(authorPreimage, asChangeUnitArtifact(currentCuInput)) as unknown as BlueprintRecord;
        fs.writeFileSync(cuDraftFile, YAML.stringify(currentCuInput));
      }
      if (batchDraftFile && input.requirement) fs.writeFileSync(batchDraftFile, JSON.stringify(readBatchCandidates()
        .map(row => ({ ...row, artifact: prepareCu(authorPreimage, row.artifact) })), null, 2) + '\n');
      const currentRefs = [...new Set([...baselineRefs, ...blueprintSourceRefFiles(projectRoot, authorPreimage).map(relOf)])];
      const latestQuestion = repairRoleStart(sessionEvents(runDir), 'questioning');
      const savedQuestion = latestQuestion ? questioningOriginal(runDir, latestQuestion) : null;
      const verifiedQuestion = savedQuestion && batchWasReviewed(savedQuestion, latestQuestion)
        && reusableDesignQuestioning({ ...savedQuestion, projectRoot, blueprintPath: draftFile, blueprint: authorPreimage });
      const preparedDisposition = evaluationOf(authorPreimage, designWorkSnapshot(authorDrafts), !!verifiedQuestion, undefined,
        currentCuInput ? asChangeUnitArtifact(currentCuInput) : undefined).disposition;
      const designDeclarations = currentCuInput ? asChangeUnitArtifact(currentCuInput).blockers.filter(blocker => blocker.gate === 'design'
        && blocker.owner === 'component-design' && blocker.observation === 'machine') : [];
      const activeDesignDeclaration = currentCuInput && deriveChangeUnitBlockers({ ...asChangeUnitArtifact(currentCuInput), blockers: designDeclarations }, { projectRoot })
        .some(observation => observation.active);
      const cuNeedsAuthor = currentCuInput && (validateChangeUnit(currentCuInput, { projectRoot, canonicalPath: originalCu!.canonicalPath }).some(issue => issue.severity === 'BLOCKER')
        || validateChangeUnitDesign(projectRoot, currentCuInput).verdict !== 'constructable'
        || activeDesignDeclaration && !verifiedQuestion);
      // A verified finding that triggered this transaction is invisible to the draft's own machine checks:
      // the design owner must receive it once before independent questioning.
      const verifiedTriggerUndelivered = input.brief.items.some(item => /repair_candidate:[a-f0-9]{64}/.test(item.basis))
        && !repairRoleStart(sessionEvents(runDir), 'author');
      let preAuthor: ReturnType<typeof capturePhaseInvocationSnapshot>;
      let authorStart: GoalRunEvent | undefined;
      if (preparedDisposition.completionBlocking.some(problem => problem.action === 'repair') || cuNeedsAuthor || verifiedTriggerUndelivered) {
        const invoked = await guarded('author', [authorPrompt(input, draftFile, canonicalRel, authorDrafts, transactionTiming, currentCuInput ?? undefined),
          ...preparedDisposition.completionBlocking.map(problem => `${problem.id}: ${problem.detail}\n对象与证据：${(problem.evidence ?? []).join('、')}`), ...authorFeedback].join('\n\n'), currentRefs, afterQuestioning);
        if ('handoff' in invoked) { release(); return { outcome: 'handoff', reason: 'session execution request committed' }; }
        preAuthor = invoked;
        authorStart = usedInvocation;
        if (!authorStart?.invoke_id) throw new AttemptFailure('author', '缺本轮真实作者调用标识，不能复用其它轮结果。');
        feedbackDelivered = preparedDisposition.completionBlocking.length > 0 || authorFeedback.length > 0;
        const authorBefore = path.join(runDir, 'phases', String(authorStart.phase), authorStart.invoke_id, 'blueprint-before.yaml');
        if (fs.existsSync(authorBefore)) authorPreimage = asRecord(YAML.parse(fs.readFileSync(authorBefore, 'utf8'))) ?? authorPreimage;
      } else {
        preAuthor = capturePhaseInvocationSnapshot({ projectRoot, protectedRoots: snapshotRoots(projectRoot), executionRole: 'author',
          immutableInputPaths }, { ownedPrefixes: owned, runtimeExcluded: excluded, includeFiles: currentRefs });
        if (preAuthor.failureReason) throw new AttemptFailure('author', `机器准备的输入快照不可核实：${preAuthor.failureReason}`);
      }
      const roleEvents = sessionEvents(runDir);
      const causalAuthor = authorStart ?? repairRoleStart(roleEvents, 'author', afterQuestioning);
      const causalAuthorEnd = causalAuthor && [...roleEvents].reverse().find(event => event.type === 'agent_invoke_end' && event.invoke_id === causalAuthor.invoke_id);
      let causalAuthorOutput: BlueprintRecord | undefined;
      if (!authorStart && causalAuthor?.invoke_id && causalAuthorEnd
        && invocationCompleted({ ...causalAuthorEnd, exitCode: causalAuthorEnd.exit_code })) {
        const request = readExecutionRequestOriginal(runDir, causalAuthor.invoke_id);
        const beforeFile = path.join(runDir, 'phases', designRepairInvokeLabel('author'), causalAuthor.invoke_id, 'blueprint-before.yaml');
        if (request?.request.context.runDir === runDir && request.request.context.phase === designRepairInvokeLabel('author')
          && request.request.context.instruction && fs.existsSync(beforeFile)) {
          const before = asRecord(YAML.parse(fs.readFileSync(beforeFile, 'utf8')));
          const issued = sessionExecutionForInvoke(runDir, causalAuthor.invoke_id);
          const accepted = issued && acceptedSessionReport(runDir, issued);
          const resultFile = path.join(runDir, 'phases', designRepairInvokeLabel('author'), causalAuthor.invoke_id, 'design-result.json');
          const saved = accepted?.event.handoff_report
            ? readHandoffMaterial<{ draft_outputs?: Record<string, string> }>(runDir, accepted.event.handoff_report)
            : fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) as { draft_outputs?: Record<string, string> } : undefined;
          const output = saved?.draft_outputs?.['component-blueprint.yaml'];
          causalAuthorOutput = output ? asRecord(YAML.parse(Buffer.from(output, 'base64').toString('utf8'))) ?? undefined : undefined;
          if (before && causalAuthorOutput) {
            authorStart = causalAuthor;
            authorPreimage = before;
            const originalDisposition = evaluationOf(before, {}, false).disposition;
            feedbackDelivered = originalDisposition.completionBlocking.some(problem => problem.action === 'repair')
              || !!originalCu && validateChangeUnit(originalCu.changeUnit).some(issue => issue.severity === 'BLOCKER')
              || authorFeedback.length > 0;
          }
        }
      }
      // The current unfinished round keeps its real author/Q cause across transport re-entry.
      const questioningAfter = authorStart?.invoke_id ?? (causalAuthorEnd && invocationCompleted({ ...causalAuthorEnd, exitCode: causalAuthorEnd.exit_code })
        ? causalAuthor?.invoke_id : undefined) ?? afterQuestioning;
      let authored = readDraft('author');
      for (const field of ['questioning'] as const) {
        if (canon(reviewOf(causalAuthorOutput ?? authored)[field]) !== canon(reviewOf(authorPreimage)[field])) throw new AttemptFailure('self_reported', `编写调用改了 review_summary.${field}（自报，不予采信）`);
      }
      const declineGates = new Set(input.brief.items.flatMap(item => item.basis.match(/repair_candidate:[a-f0-9]{64}/g) ?? []));
      const declined = asRecords(asRecord(authored.decisions_and_gaps)?.decisions).filter(decision =>
        declineGates.has(String(decision.decision_id)) && typeof decision.rationale === 'string' && decision.rationale.startsWith('declined:'));
      if (declined.length) {
        const before = structuredClone(authored); delete asRecord(before.review_summary)?.questioning;
        const declinedQuestioning = await guarded('questioning', questioningPrompt(input, draftFile, authored, auxiliaryDrafts, transactionTiming) + '\n本次作者拒修理由：\n'
          + declined.map(decision => `${decision.decision_id}：${decision.rationale}`).join('\n')
          + '\n逐条读取所引当前产物；依据成立才在既有 questioning.items 中用 answered_with_evidence、answer 原样包含完整 declined: 依据。不要为了发布而改设计。', blueprintSourceRefFiles(projectRoot, authored).map(relOf), questioningAfter);
        if ('handoff' in declinedQuestioning) { release(); return { outcome: 'handoff', reason: 'session execution request committed' }; }
        const questioned = readDraft('questioning');
        const after = structuredClone(questioned); delete asRecord(after.review_summary)?.questioning;
        if (canon(before) !== canon(after)) throw new AttemptFailure('questioning_scope', '拒修质询改了 questioning 之外的草稿内容');
        const questioning = asRecord(asRecord(questioned.review_summary)?.questioning);
        const declineProof = structuredClone(questioned);
        const decisions = asRecord(declineProof.decisions_and_gaps);
        if (decisions) decisions.decisions = asRecords(decisions.decisions).filter(decision => !declineGates.has(String(decision.decision_id)));
        const invalidProof = blockerIssues(validateComponentBlueprint(declineProof, context));
        const reasons = declined.map(decision => String(decision.rationale));
        const confirmed = invalidProof.length === 0 && questioning?.status === 'complete' && reasons.every(reason => {
          const basis = verifiedDeclineBasis(reason, input.requirement ?? '', text => readableIssueEvidence(projectRoot, text).length > 0);
          return basis !== null && asRecords(questioning.items).some(item => item.disposition === 'answered_with_evidence'
            && typeof item.answer === 'string' && item.answer.includes(reason)
            && Array.isArray(item.evidence_refs) && item.evidence_refs.length > 0);
        });
        if (!confirmed) throw new AttemptFailure('questioning', '拒修理由未被独立质询依据当前产物确认');
        release();
        const reason = reasons.join('；');
        input.emit({ ...base, stage: 'failed', failed_step: 'declined', reason,
          declined_candidates: declined.map(decision => String(decision.decision_id)) });
        return { outcome: 'failed', step: 'declined', reason };
      }
      // 编写调用新引用的输入文件：调用前没有进核对（位于通常排除的目录），它在调用期间是否被改无从核实——不当作干净继续。
      const draftRefs = blueprintSourceRefFiles(projectRoot, authored).map(relOf);
      const unverified = draftRefs.filter(ref => !currentRefs.includes(ref) && !preAuthor.entries.some(entry => entry.path === ref));
      if (unverified.length) {
        throw new AttemptFailure('author', `编写调用新引用了调用前未核对的输入文件，调用期间是否被改无从核实：${unverified.join('、')}`,
          { changes: [], preSnapshot: preAuthor.sha256, postSnapshot: preAuthor.sha256 });
      }
      // 自报：编写调用不得写准入、不得写质询结果（与基线比对，字节语义不变）。
      // 授权边界：只许改本次 B1 发现项定位到的字段；越权 = 尝试失败、丢弃草稿、不发布（canonical 未变，不走越界违规出口）。
      const outside = input.requirement
        ? ['artifact', 'component_id', 'blueprint_id'].filter(key => authored[key] !== baseDoc[key])
        : outOfScopePaths(authorPreimage, authored, blueprintId, input.brief.items);
      if (outside.length) {
        throw new AttemptFailure('author_scope', `编写调用改了本次 B1 发现项定位之外的蓝图内容（越权，不发布）：${outside.slice(0, 20).join('、')}${outside.length > 20 ? ` 等 ${outside.length} 处` : ''}`);
      }
      authored = prepareDraft(authored);
      if (stableStringify(blueprintAuthorContent(authorPreimage)) !== stableStringify(blueprintAuthorContent(authored))) {
        const priorQ = asRecord(reviewOf(authored).questioning);
        if (priorQ) priorQ.status = 'incomplete';
      }
      // ③ 运行时：作废草稿整份旧质询（canonical 历史不动）；登记新 revision 与修订依据（根 provenance）；旧派生结论标 stale；机器派生并写回准入。
      const review = { ...reviewOf(authored) };
      authored.review_summary = review;
      authored.revision = revision;
      cuCandidate = originalCu ? asChangeUnitArtifact(YAML.parse(fs.readFileSync(cuDraftFile, 'utf8'))) : undefined;
      batchCandidates = readBatchCandidates();
      architectureChanged = false;
      if (input.requirement) {
        const architecture = asRecord(JSON.parse(fs.readFileSync(architectureDraftFile, 'utf8')));
        if (!architecture) throw new AttemptFailure('architecture', '目标 architecture 不是对象');
        validateArchitectureDsl(architecture as unknown as ArchitectureDsl);
        context.architecture = architecture as unknown as ArchitectureDsl;
        architectureChanged = canon(architecture) !== canon(originalArchitecture);
        if (architectureChanged && !asRecords(asRecord(authored.decisions_and_gaps)?.decisions).some(d => d.kind === 'architecture_impact' && d.status === 'decided_with_authority')) {
          throw new AttemptFailure('architecture', '架构配置变化没有已裁决的 architecture_impact 依据');
        }
        refreshBlueprintFingerprints(authored);
        if (cuCandidate) {
          cuCandidate = completeChangeUnitDesignRefs(authored, cuCandidate, projectRoot);
          fs.writeFileSync(cuDraftFile, YAML.stringify(cuCandidate));
        }
        batchCandidates = batchCandidates.map(row => ({ ...row, artifact: completeChangeUnitDesignRefs(authored, row.artifact, projectRoot) }));
        if (batchDraftFile) fs.writeFileSync(batchDraftFile, JSON.stringify(batchCandidates, null, 2) + '\n');
      }
      // 派生结论只从基线派生，作者对它的改动不采信（与上方"运行时覆盖"的豁免一致）：旧结论按既有规则标 stale、保留原输入版本。
      if (Array.isArray(baseDoc.derived_results)) {
        authored.derived_results = reconcileP1DerivedResults(asRecords(baseDoc.derived_results), revision, String(authored.source_fingerprint), String(authored.decision_fingerprint));
      } else delete authored.derived_results;
      const invalidated = writeBackAdmission(authored, context);
      evidence.admission_after_invalidation = invalidated.status;
      writeDraft(authored);
      const beforeQuestioning = readDraft('questioning');
      const auxFiles = auxiliaryDrafts;
      const auxBeforeQuestioning = auxFiles.map(file => fs.readFileSync(file));
      const staleResults = asRecords(authored.derived_results).filter(result => result.status === 'stale');
      const questioningPreparation = [
        `本事务准备状态：基线revision=${String(baseDoc.revision)}；当前待发布候选revision=${revision}；architectureChanged=${architectureChanged}（相对本事务原始配置的真实比较，不从候选文件存在推断变更）。`,
        ...(staleResults.length ? [
          `框架本次派生后的stale结果及原input_revision（未盖current）：\n${JSON.stringify(staleResults.map(result => ({ result_id: result.result_id, kind: result.kind, input_revision: result.input_revision, status: result.status, superseded_by_revision: result.superseded_by_revision })), null, 2)}`,
          `图分级依 ${path.join(input.frameworkRoot, 'skills/reference/app-component-blueprint-workflow.md')} §2：时序图及未声明relation_refs的作者展示图自身stale/input_revision等问题是WARN并如实披露，不单独升级blocker；声明relation_refs的关系结构图真实错误仍是BLOCKER。作者仍负责受影响图的真实content与调用/关系/恢复设计一致，具体源关系、原需求或验收缺失仍可否定，不以换元标签代替重核。`,
        ] : []),
        ...(cuCandidate ? [`CU候选当前身份指针原值（component_blueprint_ref、design_refs、touches.design_ref；发布后才由框架统一重绑，仍须原consumer/readiness校验）：\n${JSON.stringify(blueprintIdentityPointers(cuCandidate as unknown as Record<string, unknown>), null, 2)}`] : []),
      ];

      // ④ 独立质询：隔离的第二次调用，只许改质询结果。
      const questioningStep = await guarded('questioning', questioningPrompt(input, draftFile, beforeQuestioning, auxiliaryDrafts, [...transactionTiming, ...questioningPreparation]), [...new Set([...baselineRefs, ...draftRefs])], questioningAfter);
      if ('handoff' in questioningStep) { release(); return { outcome: 'handoff', reason: 'session execution request committed' }; }
      questioningPreimage = questioningStep;
      questioned = readDraft('questioning');
      if (auxFiles.some((file, index) => !fs.readFileSync(file).equals(auxBeforeQuestioning[index]))) {
        throw new AttemptFailure('questioning', '质询调用改写了CU或架构候选');
      }
      const strip = (doc: BlueprintRecord): unknown => { const r = { ...reviewOf(doc) }; delete r.questioning; return { ...doc, review_summary: r }; };
      if (canon(strip(questioned)) !== canon(strip(beforeQuestioning))) throw new AttemptFailure('questioning', '质询调用改了质询结果之外的内容');
      if (!asRecord(reviewOf(questioned).questioning)) throw new AttemptFailure('questioning', '质询调用正常退出但没有产出质询结果（不沿用旧报告）');
      const derived = writeBackAdmission(questioned, context);
      evidence.admission_after_questioning = derived.status;
      // ⑤ 机器裁决：发布的就是这份字节——对它的解析结果（草稿对象）按真实宿主根与 canonical 路径校验。
      text = YAML.stringify(questioned);
      const blockers = blockerIssues(validateComponentBlueprint(YAML.parse(text), context));
      const denied = independentQuestioningBlockers(questioned);
      const issues = [...blockers.map(issue => `${issue.id}@${issue.path}: ${issue.message}`),
        ...denied.map(item => `${String(item.scope_ref)}：${String(item.question)}；${String(item.answer ?? "")}`),
        ...contentChecks(questioned, cuCandidate).map(check => check.details ?? check.id)];
      if (derived.status !== 'pass' || issues.length) {
        const currentEvaluation = evaluationOf(questioned, designWorkSnapshot(authorDrafts), true, questioningStep, cuCandidate);
        if (currentEvaluation.disposition.completionBlocking.length && currentEvaluation.disposition.completionBlocking.every(problem => problem.action !== 'repair')) {
          throw new AttemptFailure('questioning', `独立质询/验证仍有未完项，保留本次原件和设计，不重派无关作者：\n${issues.join('\n')}`);
        }
        const questionStart = sessionEvents(runDir).find(event => event.type === 'agent_invoke_start' && event.invoke_id === usedQuestioningInvokeId);
        if (!questionStart?.invoke_id) throw new AttemptFailure('questioning', '缺本轮真实质询调用标识，不能凭摘要返修。');
        const source = path.join(runDir, 'phases', String(questionStart.phase), questionStart.invoke_id);
        authorFeedback = [`本事务当前全部机器问题与独立质询未过项：${source}\n${issues.join('\n')}\n保留当前未发布候选，在原授权写集内修复并由同一独立职责重新核实；不要改写质询或准入结果，不把旧运输成功当作本轮完成。`];
        writeDraft(questioned);
        input.emit({ ...base, stage: 'failed', failed_step: 'questioning', reason: authorFeedback[0], ...evidence });
        release();
        return { outcome: 'failed', step: 'questioning', reason: authorFeedback[0], evaluation: currentEvaluation };
      }
    }
    fs.writeFileSync(draftFile, text);
    // ⑥ 发布：单写者，先复核 canonical 字节仍等于基线（两层锁约束不了所有手工写入者）；rename 成功即发布边界。
    const alreadyPublished = fs.readFileSync(canonicalPath).equals(Buffer.from(text));
    if (!alreadyPublished && !fs.readFileSync(canonicalPath).equals(baseline)) throw new AttemptFailure('publish', 'canonical 蓝图在尝试期间被别处改动，不发布');
    if (architectureChanged && !alreadyPublished) {
      if (!fs.readFileSync(configFile).equals(configBaseline!)) throw new AttemptFailure('publish', '架构配置在尝试期间被别处修改，不发布');
      publishArchitectureRevision(projectRoot, context.architecture as unknown as Record<string, unknown>);
      const writtenConfig = fs.readFileSync(configFile);
      restoreUnpublishedArchitecture = () => {
        if (!fs.readFileSync(configFile).equals(writtenConfig)) throw new Error('架构配置又被修改，不能覆盖恢复');
        fs.writeFileSync(configFile, configBaseline!);
        clearFrameworkConfigCache();
      };
    }
    const tmp = `${canonicalPath}.tmp-${process.pid}`;
    try {
      if (!alreadyPublished) { fs.writeFileSync(tmp, text); fs.renameSync(tmp, canonicalPath); }
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw new AttemptFailure('publish', `发布写出失败（canonical 保持原字节）：${(error as Error).message}`);
    }
    published = { revision };
    // ⑦ 同一锁内调和（CU 指针升到新 revision）。抛错或自行回滚 = 已发布、调和未完成，不回滚发布。
    let reconcileNote: string;
    let reconciled = false;
    try {
      const revisions: ChangeUnitContentRevision[] = [];
      const unchanged: string[] = [];
      const publishedBlueprint = loadCanonicalBlueprint(projectRoot, blueprintId);
      const bindPublishedCu = (candidate: ChangeUnitArtifact): void => {
        for (const ref of blueprintIdentityPointers(candidate as unknown as Record<string, unknown>)) {
          if (ref) Object.assign(ref, currentBlueprintIdentity(publishedBlueprint));
        }
        candidate.provenance.extraction_method += ';design-repair';
        candidate.provenance.source_revision = `revision-${revision}`;
        candidate.provenance.observed_at = original.startedAt;
      };
      if (originalCu && cuCandidate && changeUnitId) {
        bindPublishedCu(cuCandidate);
        const currentCu = loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId);
        const pointerOnly = changeUnitPublicationContent(asChangeUnitArtifact(currentCu.changeUnit)) === changeUnitPublicationContent(cuCandidate);
        const cuAlreadyPublished = alreadyPublished && canon(asChangeUnitArtifact(currentCu.changeUnit)) === canon({ ...cuCandidate, revision: currentCu.changeUnit.revision });
        if (cuAlreadyPublished || pointerOnly) unchanged.push(changeUnitId);
        else revisions.push({ expectedRef: createChangeUnitRef(originalCu), candidate: { providerId: 'design-repair', artifact: cuCandidate } });
      }
      for (const candidate of batchCandidates) {
        bindPublishedCu(candidate.artifact);
        const current = loadCanonicalChangeUnit(projectRoot, blueprintId, candidate.artifact.change_unit_id);
        if (changeUnitPublicationContent(asChangeUnitArtifact(current.changeUnit)) === changeUnitPublicationContent(candidate.artifact)) {
          unchanged.push(candidate.artifact.change_unit_id); continue;
        }
        const relative = path.relative(projectRoot, current.canonicalPath).replace(/\\/g, '/');
        const observed = questioningPreimage?.entries.find(entry => entry.path === relative && entry.kind === 'file');
        if (!observed || observed.sha256 !== sha256Hex(current.bytes)) throw new Error(`同批消费者 ${candidate.artifact.change_unit_id} 的canonical输入不再匹配本次真实Q快照，保留候选后按原责任重核。`);
        revisions.push({ expectedRef: createChangeUnitRef(current), candidate });
      }
      if (revisions.length || unchanged.length) {
        const revised = revisions.length ? reviseChangeUnitContent(projectRoot, blueprintId, revisions, {
          heldBlueprintLocks: locks, heldFeatureLocks: input.heldFeatureLock ? [input.heldFeatureLock] : [],
          ...(input.designTarget && (!changeUnitId || deriveChangeUnitFeatureId(blueprintId, changeUnitId) !== input.feature) ? {} : { activeRun: { feature: input.feature, runId: input.runId } }),
        }) : { revised: [], unchanged: [], busy: undefined };
        if (revised.busy) throw new Error(revised.busy);
        reconciled = revised.revised.length > 0 || revised.unchanged.length > 0 || unchanged.length > 0;
        Object.assign(evidence, { revised_change_units: revised.revised.map(row => row.changeUnit.change_unit_id), architecture_changed: architectureChanged });
      }
      const result = reconcileHeldBlueprintRefs(projectRoot, blueprintId, locks);
      reviewDocument = result.reviewDocument;
      const submitted = new Set([...(changeUnitId ? [changeUnitId] : []), ...batchCandidates.map(row => row.artifact.change_unit_id)]);
      const own = result.skipped.find(item => submitted.has(item.change_unit_id));
      reconciled = !result.busy && !own && (!changeUnitId || reconciled || result.bumped.some(item => item.change_unit_id === changeUnitId));
      reconcileNote = result.busy ?? (own ? `本 CU 被调和器跳过：${own.reasons.join('；')}` : reconciled ? '设计发布已交原调和器；各CU的真实差异由P1/P2重评' : '本 CU 未被升版');
      Object.assign(evidence, { bumped: result.bumped, skipped: result.skipped });
    } catch (error) {
      reconcileNote = `调和失败：${(error as Error).message}`;
    }
    reviewDocument = summarizeBlueprintReviewResults(reviewDocument, materializeBlueprintReview(projectRoot, blueprintId));
    const audit = (outcome: string): void => {
      if (!input.requirement) return;
      try {
      const ledger = headlessLedgerPath(projectRoot, input.feature, input.phase);
      fs.mkdirSync(path.dirname(ledger), { recursive: true });
      fs.appendFileSync(ledger, JSON.stringify({ decision_id: `design-repair-${input.signature}-${revision}`, run_id: input.runId,
        phase: input.phase, gate_id: input.brief.items[0]?.check ?? 'design_authority', class: 'design_repair',
        decision: `依据原无人值守请求修订蓝图rev${revision}、CU ${changeUnitId}；架构变更=${architectureChanged}；${reconcileNote}；${outcome}。决定：${asRecords(asRecord(questioned.decisions_and_gaps)?.decisions).filter(d => d.kind === 'architecture_impact').map(d => `${d.change}:${d.from ?? d.module ?? ''}→${d.to ?? d.to_layer ?? ''}(${d.rationale ?? ''})`).join('；')}`,
        must_review: false, source: 'goal-runner', ts: new Date().toISOString() }) + '\n');
      } catch (error) { evidence.audit_warning = `自动决议审计写入失败：${(error as Error).message}`; }
    };
    release();
    const common = { ...base, stage: 'published', new_revision: revision,
      files: [canonicalRel, ...(reviewDocument?.writtenPaths ?? []).map(file => path.relative(projectRoot, file).replace(/\\/g, '/'))],
      review_projection_stale: reviewDocument?.status === 'failed' || !!reviewDocument?.sourceGaps.length, review_document: reviewDocument, ...evidence };
    if (!reconciled) {
      const reason = `已发布 rev ${revision}、调和未完成：${reconcileNote}`;
      audit(reason);
      input.emit({ ...common, ...evidence, outcome: 'unrecovered', failed_step: 'reconcile', reason });
      return { outcome: 'published', recovered: false, step: 'reconcile', revision, reason };
    }
    // ⑧ 探针：与停放后的探针同一判定，显式传入本次真实阻断。
    const probe = input.recheckReadiness ? input.recheckReadiness()
      : input.designTarget && (!changeUnitId || deriveChangeUnitFeatureId(blueprintId, changeUnitId) !== input.feature) ? { ready: false, reason: '原请求须用既有P1/P2 readiness重评；不存在目标CU的root run身份。' }
      : probeDesignAuthorityRecovered(projectRoot, input.feature, input.phase, input.brief.items.map(item => item.check), input.runId);
    if (!probe.ready) {
      const reason = `已发布 rev ${revision}、探针未通过（记未恢复）：${probe.reason ?? ''}`;
      audit(reason);
      input.emit({ ...common, ...evidence, outcome: 'unrecovered', failed_step: 'probe', reason });
      return { outcome: 'published', recovered: false, step: 'probe', revision, reason };
    }
    const reason = `已发布 rev ${revision} 并调和，${probe.reason ?? '探针就绪'}`;
    audit(reason);
    input.emit({ ...common, ...evidence, outcome: 'recovered', reason });
    return { outcome: 'published', recovered: true, revision, reason };
  } catch (error) {
    if (error instanceof AttemptWaiting) {
      release();
      return { outcome: 'waiting', step: error.step, reason: error.message };
    }
    if (!published) {
      try { restoreUnpublishedArchitecture?.(); }
      catch (restoreError) { evidence.restore_warning = `未发布的架构恢复失败：${(restoreError as Error).message}`; }
    }
    release();
    const failure = error instanceof AttemptFailure ? error : new AttemptFailure(published ? 'post_publish' : 'runtime', (error as Error).message);
    if (published) {
      // 发布之后的意外：不回滚、不落入草稿失败分支。
      const reason = `已发布 rev ${published.revision}、之后失败：${failure.message}`;
      input.emit({ ...base, stage: 'published', new_revision: published.revision,
        files: [canonicalRel, ...(reviewDocument?.writtenPaths ?? []).map(file => path.relative(projectRoot, file).replace(/\\/g, '/'))],
        review_document: reviewDocument, review_projection_stale: !reviewDocument || reviewDocument.status === 'failed' || !!reviewDocument.sourceGaps.length,
        outcome: 'unrecovered', failed_step: failure.step, reason, ...evidence });
      return { outcome: 'published', recovered: false, step: failure.step, revision: published.revision, reason };
    }
    const files = failure.violation?.changes.slice(0, 50).map(change => ({ path: change.path, how: change.how, pre_sha256: change.preSha256, post_sha256: change.postSha256 }));
    input.emit({ ...base, stage: 'failed', failed_step: failure.step, reason: failure.message, ...(files?.length ? { files } : {}), ...evidence });
    if (failure.containmentUnresolved) return { outcome: 'containment_unresolved', step: failure.step as DesignRepairPurpose, reason: failure.message };
    if (failure.violation) return { outcome: 'violation', step: failure.step as DesignRepairPurpose, reason: failure.message, ...failure.violation };
    return { outcome: 'failed', step: failure.step, reason: failure.message };
  }
}
