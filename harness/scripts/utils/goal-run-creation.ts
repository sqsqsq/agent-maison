import { validateExecutionScope, assertRevisionKeepsRequiredObligations } from './execution-scope';
/**
 * Fresh goal-run birth contract.
 *
 * Persistent SSOT remains manifest.json + events.jsonl. This module deliberately does not add
 * a transaction marker: manifest-only residue is classified CREATION_INCOMPLETE by inspection.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  computeManifestIdentityFields,
  computeManifestIdentityFieldsHash,
  manifestIdentityFieldDigest,
  normalizeGoalPhaseChain,
  writeGoalManifest,
  loadGoalManifestFromRun,
  buildGoalManifestFromInput,
  SCOPE_REVISION_FIELDS,
  type GoalManifest,
} from './goal-manifest';
import { loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';
import { featureFilePath } from '../../config';
import type { ExecutionScope } from './execution-scope';
import { executionScopeFingerprint } from './execution-scope';

/**
 * D2: a legal revision of a frozen scope, appended to the SAME run's events.jsonl.
 *
 * There is deliberately no successor run, no sealing and no lock release — the run keeps
 * executing. events.jsonl has no per-line hash chain (only `run_created` carries `event_hash`),
 * so what this structure can and cannot detect is stated plainly:
 *  - detects: reordering, a deleted middle entry, tampered scope content, and any edit after a
 *    completion record — via `previous_scope_fingerprint` chaining back to the birth fingerprint,
 *    a gap-free `revision_index`, `validateExecutionScope` per entry, and reconciliation against
 *    phase evidence / completion `scope_revision_count`;
 *  - does NOT claim to detect: deleting the last revision before any completion exists, or edits
 *    to `trigger` / `revision_input`, which are outside the scope fingerprint.
 * No signing or external state system is introduced to close that gap.
 */
export interface ScopeRevisedEvent {
  type: 'scope_revised';
  /** 1-based, gap-free. */
  revision_index: number;
  /** Fingerprint of the previous effective scope; the first entry chains to the birth scope. */
  previous_scope_fingerprint: string;
  execution_scope: ExecutionScope;
  revision_input: unknown;
  trigger: { phase: string; check_id: string };
  allowed_fields: readonly string[];
  /** Only the first coding/ut-bearing revision may carry it — see resolveRunBaseline. */
  run_base_sha?: string;
}

const SCOPE_REVISION_EVENT = 'scope_revised';

/**
 * Ordered, validated revisions of one run. Corruption throws — it never degrades to birth scope.
 *
 * Read in PHYSICAL event order, deliberately not sorted: sorting by `revision_index` would repair
 * a swapped pair and hide exactly the reordering `previous_scope_fingerprint` exists to detect.
 * The same before/after constraints the writer enforces are re-applied here, so an entry that is
 * merely well-formed cannot become the effective scope (review B8).
 */
export function loadScopeRevisions(events: readonly GoalRunEvent[], birth: ExecutionScope): ScopeRevisedEvent[] {
  const revisions = events.filter(event => event.type === SCOPE_REVISION_EVENT) as unknown as ScopeRevisedEvent[];
  if (!revisions.length) return [];
  let previousScope = birth;
  let previous = executionScopeFingerprint(birth);
  revisions.forEach((revision, index) => {
    if (revision.revision_index !== index + 1) throw new Error(`[execution-scope] revision index 不连续：期望 ${index + 1}，实得 ${revision.revision_index}`);
    if (revision.previous_scope_fingerprint !== previous) throw new Error(`[execution-scope] 修订链断裂于 #${revision.revision_index}`);
    const next = validateExecutionScope(revision.execution_scope);
    if (JSON.stringify(revision.allowed_fields) !== JSON.stringify(SCOPE_REVISION_FIELDS)) throw new Error(`[execution-scope] 修订 #${revision.revision_index} 的可改字段边界非法`);
    // D2.3 constraints, shared with the writer: the request boundary is immutable and no required
    // obligation may be deleted or downgraded.
    if (next.completion_target !== previousScope.completion_target || JSON.stringify(next.requested_results) !== JSON.stringify(previousScope.requested_results)) {
      throw new Error(`[execution-scope] 修订 #${revision.revision_index} 改写了请求边界`);
    }
    assertRevisionKeepsRequiredObligations(previousScope, next);
    previousScope = next;
    previous = executionScopeFingerprint(next);
  });
  return revisions;
}

/** Effective scope = birth scope + revisions applied in `revision_index` order. */
export function applyScopeRevisions(birth: ExecutionScope, events: readonly GoalRunEvent[]): ExecutionScope {
  const revisions = loadScopeRevisions(events, birth);
  return revisions.length ? revisions[revisions.length - 1].execution_scope : birth;
}

/**
 * Phases whose reuse a revision WITHDREW, derived from the revision's own content: an obligation
 * that carried phase-closure evidence in the previous effective scope and no longer carries it.
 *
 * Deriving it (instead of writing a second event next to `scope_revised`) is what makes a revision
 * atomic: there is no window in which the new scope is readable but the revocation is not, so an
 * interrupt between two writes cannot resurrect a pre-revision PASS (review B1/2).
 */
export function revokedPhasesByRevision(birth: ExecutionScope, events: readonly GoalRunEvent[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const revisions = loadScopeRevisions(events, birth);
  revisions.forEach((revision, index) => {
    const previous = index === 0 ? birth : revisions[index - 1].execution_scope;
    const phases = new Set<string>();
    for (const before of previous.obligations) {
      const proof = (before.satisfied_by ?? []).filter(ref => 'run_id' in ref);
      if (!proof.length) continue;
      const after = revision.execution_scope.obligations.find(obligation => obligation.id === before.id);
      const kept = (after?.satisfied_by ?? []).filter(ref => 'run_id' in ref);
      // Only a duty left with NO phase evidence at all is revoked: dropping one of several proofs
      // while keeping another still leaves the duty satisfied, so its phase must not be re-run.
      if (!kept.length) phases.add(String(before.owner_phase));
    }
    if (phases.size) out.set(revision.revision_index, [...phases]);
  });
  return out;
}

/**
 * The event stream as the invalidation machinery should see it: each revision that withdrew a proof
 * is followed by the per-phase invalidation it implies. Pure projection — nothing is persisted, so
 * the recovery path and the in-run path read the same truth from the same single event.
 */
export function eventsWithScopeRevocations(birth: ExecutionScope | undefined, events: readonly GoalRunEvent[]): GoalRunEvent[] {
  if (!birth) return [...events];
  const revoked = revokedPhasesByRevision(birth, events);
  if (!revoked.size) return [...events];
  const out: GoalRunEvent[] = [];
  for (const event of events) {
    out.push(event);
    if (event.type !== SCOPE_REVISION_EVENT) continue;
    for (const phase of revoked.get((event as unknown as ScopeRevisedEvent).revision_index) ?? []) {
      out.push({ type: 'phase_invalidated', phase, reason: 'scope_revised' } as unknown as GoalRunEvent);
    }
  }
  return out;
}

/**
 * The ONE entry every runtime consumer uses. `loadFrozenExecutionScope` stays, but now means
 * strictly "read the birth scope" and is only for birth/identity checks.
 */
export function loadEffectiveExecutionScope(projectRoot: string, feature: string, runId: string): ExecutionScope | undefined {
  const birth = loadFrozenExecutionScope(projectRoot, feature, runId);
  if (!birth) return undefined;
  return applyScopeRevisions(birth, loadAuthoritativeRunEvents(projectRoot, feature, runId));
}

/**
 * Baseline for diffs. `manifest.run_base_sha` is a birth identity field with a write-once defence,
 * so a run born as `[spec]` can never have it back-filled into the manifest. Instead the first
 * coding/ut-bearing revision carries it, and write-once is preserved at the event layer.
 */
export function resolveRunBaseline(manifest: { run_base_sha?: string }, events: readonly GoalRunEvent[]): { baseSha?: string; source: 'birth' | 'revision' } {
  const revisions = events.filter(event => event.type === SCOPE_REVISION_EVENT) as unknown as ScopeRevisedEvent[];
  const carriers = revisions.filter(revision => typeof revision.run_base_sha === 'string' && revision.run_base_sha);
  // The three conditions the writer must satisfy are re-checked here, in full. An illegal extra
  // carrier is chain corruption, never something the birth value may silently override (review B9).
  if (manifest.run_base_sha && carriers.length) throw new Error('[execution-scope] 出生已有基线，修订事件不得再携带 run_base_sha——链损坏');
  if (manifest.run_base_sha) return { baseSha: manifest.run_base_sha, source: 'birth' };
  if (!carriers.length) return { source: 'birth' };
  if (carriers.length > 1) throw new Error('[execution-scope] 基线在事件层被重复冻结——链损坏');
  const carrier = carriers[0];
  const bearing = (revision: ScopeRevisedEvent): boolean => (revision.execution_scope?.phase_chain ?? []).some(phase => phase === 'coding' || phase === 'ut');
  if (!bearing(carrier)) throw new Error('[execution-scope] 携带基线的修订不含 coding/ut——链损坏');
  const first = revisions.find(bearing);
  if (first !== carrier) throw new Error('[execution-scope] 基线未由首条含 coding/ut 的修订冻结——链损坏');
  return { baseSha: validateExactSha(carrier.run_base_sha!, 'scope_revised run_base_sha'), source: 'revision' };
}

/** Shared events read so effective scope and baseline resolve off one on-disk read. */
export function loadAuthoritativeRunEvents(projectRoot: string, feature: string, runId: string): GoalRunEvent[] {
  const manifest = loadGoalManifestFromRun(projectRoot, runId, { feature });
  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  const loaded = loadEventsJsonlStrict(eventsPath);
  if (loaded.corruptLines.length) throw new Error('[execution-scope] events.jsonl 损坏，无法求有效范围');
  return loaded.events;
}

/**
 * D2.5: `createScopeSuccessor` (the normal scope-successor birth path) is deleted, together with
 * the `scope_revision_requested` protocol it consumed. Legal revisions now append `scope_revised`
 * inside the same run. successor stays only for failure-repair supersede, an explicit user
 * requirement change, and creation-incomplete repair — all of which go through the supersede
 * path, not through this function. 3.1.0 is unreleased, so no compatibility reader is kept.
 */

/** Birth metadata distinguishes legacy absence from a damaged/stripped modern scope. */
export function loadFrozenExecutionScope(projectRoot: string, feature: string, runId: string): ExecutionScope | undefined {
  if (!runId || runId.startsWith('.') || /[\\/]/.test(runId)) throw new Error('[execution-scope] invalid run id');
  const dir = featureFilePath(projectRoot, feature, `goal-runs/${runId}`);
  const file = path.join(dir, 'manifest.json');
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> : undefined;
  const eventsFile = path.join(dir, 'events.jsonl');
  const born = fs.existsSync(eventsFile) ? loadEventsJsonlStrict(eventsFile).events.find(event => event.type === 'run_created') as unknown as RunCreatedEvent | undefined : undefined;
  if (!Object.prototype.hasOwnProperty.call(raw ?? {}, 'execution_scope') && !Object.prototype.hasOwnProperty.call(born?.manifest_identity_fields ?? {}, 'execution_scope')) return undefined;
  const manifest = loadGoalManifestFromRun(projectRoot, runId, { feature });
  assertGoalRunAttachable(projectRoot, manifest);
  return validateExecutionScope(manifest.execution_scope);
}

export interface RunCreatedEvent extends Record<string, unknown> {
  type: 'run_created';
  schema_version: '1.0';
  ts: string;
  run_id: string;
  event_index: number;
  event_hash: string;
  manifest_identity_fields: Record<string, string>;
  manifest_identity_hash: string;
  run_base_sha_digest: string | null;
  phase_chain: string[];
  dry_run?: boolean;
  rebaseline_from_run_id?: string;
}

export interface GoalRunCreationResult {
  manifestPath: string;
  eventsPath: string;
  runCreated: RunCreatedEvent;
}

export function buildSupersedeAuditEvent(input: {
  targetRunId: string;
  supersedingRunId: string;
  rebaselineTo?: string;
  creation?: GoalRunCreationResult | null;
}): Record<string, unknown> {
  return {
    type: 'supersede',
    target_run_id: input.targetRunId,
    superseding_run_id: input.supersedingRunId,
    ...(input.rebaselineTo
      ? {
          rebaseline_to: input.rebaselineTo,
          run_created_event_index: input.creation?.runCreated.event_index,
          run_created_event_hash: input.creation?.runCreated.event_hash,
        }
      : {}),
  };
}

export type GoalRunCreationInspection =
  | { state: 'absent' }
  | { state: 'complete'; event: RunCreatedEvent }
  | { state: 'legacy'; firstRunStart: GoalRunEvent }
  | { state: 'creation_incomplete'; reason: string };

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(item as Record<string, unknown>).sort()) {
      out[key] = normalize((item as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(normalize(value));
}

function runCreatedHash(input: Omit<RunCreatedEvent, 'event_hash' | 'ts'>): string {
  return crypto.createHash('sha256').update(stableJson(input), 'utf8').digest('hex');
}

export function resolveGoalRunHeadSha(projectRoot: string): string {
  const value = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`[goal-run-creation] Git HEAD 非 exact 40-hex：${JSON.stringify(value)}`);
  }
  return value;
}

function chainRequiresRunBase(chain: readonly string[]): boolean {
  return chain.some(phase => phase === 'coding' || phase === 'ut');
}

export function validateExactSha(value: string | undefined, label: string): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`[goal-run-creation] ${label} 必须为 exact 40-hex Git SHA`);
  }
  return normalized;
}

export function validateRebaselineRequest(input: {
  supersedeTargets: readonly string[];
  rebaselineTo?: string;
  resume: boolean;
  dryRun: boolean;
  hasGoalExecutionSignal: boolean;
  currentHead: string;
}): { sourceRunId: string; baseSha: string } | null {
  if (input.rebaselineTo === undefined) return null;
  const requested = input.rebaselineTo.trim().toLowerCase();
  if (input.resume || input.dryRun) {
    throw new Error('--rebaseline-to 只允许创建新的 authoritative run');
  }
  if (input.hasGoalExecutionSignal) {
    throw new Error('--rebaseline-to 必须在 goal runtime 之外由操作者执行');
  }
  if (input.supersedeTargets.length !== 1) {
    throw new Error('--rebaseline-to 必须与且仅与一个 --supersede <old-run-id> 同时提供');
  }
  const baseSha = validateExactSha(requested, '--rebaseline-to');
  if (input.currentHead.toLowerCase() !== baseSha) {
    throw new Error(
      `--rebaseline-to 与当前 Git HEAD 不一致（requested=${baseSha}, HEAD=${input.currentHead}）`,
    );
  }
  return { sourceRunId: input.supersedeTargets[0], baseSha };
}

export function createGoalRun(options: {
  projectRoot: string;
  manifest: GoalManifest;
  chain: readonly string[];
  rebaselineFromRunId?: string;
  /** Tests only: deterministic HEAD resolver. */
  resolveHead?: () => string;
}): GoalRunCreationResult {
  const manifestPath = path.join(options.projectRoot, options.manifest.report_dir, 'manifest.json');
  const eventsPath = path.join(options.projectRoot, options.manifest.report_dir, 'events.jsonl');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-run-creation] fresh run manifest 已存在：${manifestPath}`);
  }
  if (fs.existsSync(eventsPath) && fs.readFileSync(eventsPath, 'utf8').trim()) {
    throw new Error(`[goal-run-creation] fresh run events 已存在：${eventsPath}`);
  }

  const phaseChain = normalizeGoalPhaseChain(options.chain, 'resolved phase chain');
  if (options.manifest.execution_scope && JSON.stringify(validateExecutionScope(options.manifest.execution_scope).phase_chain) !== JSON.stringify(phaseChain)) throw new Error('[goal-run-creation] scope/chain mismatch');
  if (options.manifest.execution_scope && (options.manifest.start_phase !== phaseChain[0] || options.manifest.end_phase !== phaseChain.at(-1) || JSON.stringify(options.manifest.chain_override) !== JSON.stringify(phaseChain))) throw new Error('[goal-run-creation] scope start/end/chain_override mismatch');
  options.manifest.phase_chain = phaseChain;

  if (chainRequiresRunBase(phaseChain)) {
    if (options.manifest.successor_of) {
      if (!options.manifest.run_base_sha) {
        throw new Error(
          '[goal-run-creation] successor 缺少可信 lineage run_base_sha；须人工 rebaseline supersede',
        );
      }
      options.manifest.run_base_sha = validateExactSha(
        options.manifest.run_base_sha,
        'successor run_base_sha',
      );
    } else {
      options.manifest.run_base_sha = validateExactSha(
        (options.resolveHead ?? (() => resolveGoalRunHeadSha(options.projectRoot)))(),
        'Git HEAD',
      );
    }
  } else if (options.manifest.run_base_sha !== undefined) {
    options.manifest.run_base_sha = validateExactSha(options.manifest.run_base_sha, 'run_base_sha');
  }

  const fields = computeManifestIdentityFields(options.manifest);
  const baseDigest = fields.run_base_sha ?? null;
  const withoutHash = {
    type: 'run_created' as const,
    schema_version: '1.0' as const,
    run_id: options.manifest.run_id,
    event_index: 0,
    manifest_identity_fields: fields,
    manifest_identity_hash: computeManifestIdentityFieldsHash(fields),
    run_base_sha_digest: baseDigest,
    phase_chain: phaseChain,
    ...(options.manifest.report_dir.split('/').includes('.dry') ? { dry_run: true } : {}),
    ...(options.rebaselineFromRunId
      ? { rebaseline_from_run_id: options.rebaselineFromRunId }
      : {}),
  };
  const event: RunCreatedEvent = {
    ...withoutHash,
    ts: new Date().toISOString(),
    event_hash: runCreatedHash(withoutHash),
  };

  writeGoalManifest(options.manifest, options.projectRoot);
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  return { manifestPath, eventsPath, runCreated: event };
}

export function resolveActualGoalPhaseChainAtBirth(input: {
  requestedChain: readonly string[];
  fullWorkflowChain: readonly string[];
  requiresLegacyFidelityRecovery: boolean;
}): string[] {
  const requested = normalizeGoalPhaseChain(input.requestedChain, 'requested phase chain');
  if (!input.requiresLegacyFidelityRecovery || requested[0] === 'spec') return requested;
  const specIndex = input.fullWorkflowChain.indexOf('spec');
  const requestedStartIndex = input.fullWorkflowChain.indexOf(requested[0]);
  if (specIndex < 0 || requestedStartIndex <= specIndex) return requested;
  return normalizeGoalPhaseChain(
    [...input.fullWorkflowChain.slice(specIndex, requestedStartIndex), ...requested],
    'actual phase chain',
  );
}

function validateRunCreatedEvent(event: GoalRunEvent, manifest: GoalManifest): string | null {
  const raw = event as unknown as Partial<RunCreatedEvent>;
  if (raw.schema_version !== '1.0' || raw.run_id !== manifest.run_id || raw.event_index !== 0) {
    return 'run_created 基本身份不匹配';
  }
  if (!raw.manifest_identity_fields || typeof raw.manifest_identity_fields !== 'object') {
    return 'run_created.manifest_identity_fields 缺失/非法';
  }
  const fields = raw.manifest_identity_fields as Record<string, string>;
  if (raw.manifest_identity_hash !== computeManifestIdentityFieldsHash(fields)) {
    return 'run_created.manifest_identity_hash 不匹配';
  }
  const expectedBaseDigest = fields.run_base_sha ?? null;
  if (raw.run_base_sha_digest !== expectedBaseDigest) {
    return 'run_created.run_base_sha_digest 不匹配';
  }
  let eventPhaseChain: string[];
  let manifestPhaseChain: string[];
  try {
    eventPhaseChain = normalizeGoalPhaseChain(raw.phase_chain, 'run_created.phase_chain');
    manifestPhaseChain = normalizeGoalPhaseChain(manifest.phase_chain, 'manifest.phase_chain');
  } catch (error) {
    return (error as Error).message;
  }
  if (JSON.stringify(eventPhaseChain) !== JSON.stringify(manifestPhaseChain)) {
    return 'manifest.phase_chain 与 run_created.phase_chain 不匹配';
  }
  if (fields.phase_chain !== manifestIdentityFieldDigest(manifestPhaseChain)) {
    return 'run_created.manifest_identity_fields.phase_chain 不匹配';
  }
  const withoutHash = {
    type: 'run_created' as const,
    schema_version: '1.0' as const,
    run_id: raw.run_id,
    event_index: raw.event_index,
    manifest_identity_fields: fields,
    manifest_identity_hash: raw.manifest_identity_hash,
    run_base_sha_digest: raw.run_base_sha_digest ?? null,
    phase_chain: eventPhaseChain,
    ...(raw.dry_run === true ? { dry_run: true } : {}),
    ...(raw.rebaseline_from_run_id
      ? { rebaseline_from_run_id: raw.rebaseline_from_run_id }
      : {}),
  };
  if (raw.event_hash !== runCreatedHash(withoutHash)) {
    return 'run_created.event_hash 不匹配';
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'execution_scope') !== Object.prototype.hasOwnProperty.call(manifest, 'execution_scope') || (manifest.execution_scope && fields.execution_scope !== computeManifestIdentityFields(manifest).execution_scope)) return 'execution_scope 与出生摘要不匹配';
  if (manifest.execution_scope && fields.successor_of !== computeManifestIdentityFields(manifest).successor_of) return 'successor_of 与出生摘要不匹配';
  const birthHasBase = Object.prototype.hasOwnProperty.call(fields, 'run_base_sha');
  const manifestHasBase = Object.prototype.hasOwnProperty.call(manifest, 'run_base_sha');
  if (birthHasBase !== manifestHasBase) {
    return 'manifest.run_base_sha 与出生摘要存在性不匹配';
  }
  if (birthHasBase && fields.run_base_sha !== manifestIdentityFieldDigest(manifest.run_base_sha)) {
    // Current manifest may legitimately rebase other identity fields, but run_base_sha is write-once.
    return 'manifest.run_base_sha 与出生摘要不匹配';
  }
  return null;
}

export function inspectGoalRunCreation(
  projectRoot: string,
  manifest: GoalManifest,
): GoalRunCreationInspection {
  const manifestPath = path.join(projectRoot, manifest.report_dir, 'manifest.json');
  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  return inspectGoalRunCreationFiles(manifestPath, eventsPath, manifest);
}

export function inspectGoalRunCreationFiles(
  manifestPath: string,
  eventsPath: string,
  knownManifest?: GoalManifest,
): GoalRunCreationInspection {
  if (!fs.existsSync(manifestPath)) return { state: 'absent' };
  let manifest = knownManifest;
  if (!manifest) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as GoalManifest;
    } catch (error) {
      return { state: 'creation_incomplete', reason: `manifest 无法解析：${(error as Error).message}` };
    }
  }
  const loaded = loadEventsJsonlStrict(eventsPath);
  if (loaded.corruptLines.length > 0) {
    return { state: 'creation_incomplete', reason: 'events.jsonl 含损坏行' };
  }
  const created = loaded.events.filter(event => event.type === 'run_created');
  if (created.length > 1) {
    return { state: 'creation_incomplete', reason: `run_created 数量非法：${created.length}` };
  }
  if (created.length === 1) {
    const issue = validateRunCreatedEvent(created[0], manifest);
    return issue
      ? { state: 'creation_incomplete', reason: issue }
      : { state: 'complete', event: created[0] as unknown as RunCreatedEvent };
  }
  const firstRunStart = loaded.events.find(event => event.type === 'run_start');
  if (firstRunStart) return { state: 'legacy', firstRunStart };
  return { state: 'creation_incomplete', reason: 'manifest 已存在但缺少 run_created/run_start 出生事件' };
}

export function assertGoalRunAttachable(
  projectRoot: string,
  manifest: GoalManifest,
): Extract<GoalRunCreationInspection, { state: 'complete' | 'legacy' }> {
  const inspection = inspectGoalRunCreation(projectRoot, manifest);
  if (inspection.state === 'creation_incomplete') {
    throw new Error(`[goal-run-creation] CREATION_INCOMPLETE: ${inspection.reason}`);
  }
  if (inspection.state === 'absent') {
    throw new Error('[goal-run-creation] CREATION_INCOMPLETE: manifest 不在 canonical run 路径');
  }
  return inspection;
}
