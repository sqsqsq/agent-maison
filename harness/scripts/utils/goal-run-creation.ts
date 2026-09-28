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
import { collectSupersededAncestorEvents, loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';
import { featureFilePath, relFeaturesDir } from '../../config';
import type { ExecutionScope } from './execution-scope';
import { executionScopeFingerprint } from './execution-scope';
import { loadReviewClosureAttestation } from './closure-attestation';

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
      const proof = (before.satisfied_by ?? []).filter(ref => 'evidence_manifest_aggregate' in ref);
      if (!proof.length) continue;
      const after = revision.execution_scope.obligations.find(obligation => obligation.id === before.id);
      const kept = (after?.satisfied_by ?? []).filter(ref => 'evidence_manifest_aggregate' in ref);
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
/**
 * D1.3 的**统一入口**：当前有效范围由这一个函数选来源，消费者不得自己判断 run / feature。
 *
 * `runId` 有值 → run 权威（出生范围 + `scope_revised` 事件）；无值 → feature 冻结记录
 * （出生段 + `revisions[]`）。两者都无 → undefined，调用方按各自的既有回落处理。
 *
 * 载体来源需要被点名时（完成原件的 `scope_source`、报错文案）用 `resolveEffectiveScopeSource`，
 * 它是同一段判定的详细返回形态——**不是第二条路径**。
 */
export function resolveEffectiveScopeSource(
  projectRoot: string,
  feature: string,
  runId?: string,
): { scope: ExecutionScope; source: 'run' | 'feature'; run_id: string | null } | undefined {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { readFeatureFrozenScope, featureEffectiveScope } = require('./feature-execution-scope') as typeof import('./feature-execution-scope');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const record = readFeatureFrozenScope(projectRoot, feature);
  if (runId?.trim()) {
    const birth = loadFrozenExecutionScope(projectRoot, feature, runId);
    if (!birth) {
      // D1.3 第三行（第四轮阻断 3）：feature 记录声明**已转交给这个 run**，而该 run 的出生
      // 范围不在——`undefined` 会让调用方（upstream gate 等）回落 workflow/track 默认链，
      // 等于用一条与权威无关的链继续跑。这里必须明确报错。
      if (record?.transfers?.some(item => item.run_id === runId.trim())) {
        throw new Error(`[execution-scope] feature 范围已转交给 run ${runId.trim()}，但该 run 的出生范围缺失或损坏——无法确定权威；恢复该 run 的记录，或按既有 correction / successor 路径重新确立权威`);
      }
      return undefined;
    }
    // D1.3：转交对账在**这一处**集中做——run 的出生范围指纹必须等于 feature 记录为它登记的
    // 转交指纹（追加式记录里按 run 找那一条）。不等就是损坏（不是「run 内合法修订」——那只改有效范围，不改出生段）。
    const transfer = record?.transfers?.find(item => item.run_id === runId);
    if (transfer && transfer.scope_fingerprint !== executionScopeFingerprint(birth)) {
      throw new Error(`[execution-scope] run ${runId} 的出生范围与 feature 记录登记的转交指纹失配：run 出生=${executionScopeFingerprint(birth).slice(0, 16)} feature 登记=${transfer.scope_fingerprint.slice(0, 16)}`);
    }
    return { scope: applyScopeRevisions(birth, loadAuthoritativeRunEvents(projectRoot, feature, runId)), source: 'run', run_id: runId };
  }
  if (!record) return undefined;
  // 无 run 身份而记录声明已转交：权威在那个 run 上，这里不得返回 feature 范围。
  const transferred = record.transfers?.at(-1);
  if (transferred) {
    throw new Error(`[execution-scope] feature 范围已转交给 run ${transferred.run_id}——本次调用没有 run 身份，无法确定权威；带上该 run 身份再跑`);
  }
  return { scope: featureEffectiveScope(record), source: 'feature', run_id: null };
}

export function loadEffectiveExecutionScope(projectRoot: string, feature: string, runId?: string): ExecutionScope | undefined {
  return resolveEffectiveScopeSource(projectRoot, feature, runId)?.scope;
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
 * plan b2d7f4e9 t3c：本 run 的事件前面接上 supersede 血缘（`successor_of` 起、沿审计 supersede
 * 递归，按时间由旧到新）。successor 的 diff 基线继承自源 run，所以凡是"按事件判这份 diff 里的
 * 写入归谁"的消费方都必须看同一段血缘；无 `successor_of` 时恰为本 run 事件。
 */
export function loadLineageRunEvents(projectRoot: string, feature: string, runId: string): GoalRunEvent[] {
  const current = loadAuthoritativeRunEvents(projectRoot, feature, runId);
  const source = loadGoalManifestFromRun(projectRoot, runId, { feature }).successor_of;
  if (!source) return current;
  return [...collectSupersededAncestorEvents({ projectRoot, featuresDir: relFeaturesDir(projectRoot), feature, seedTargets: [source] }), ...current];
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
  /** plan c4e7a9b2 §3.3 B1：出生时算出的交付周期边界（上一次可信完成的 run）；预算折叠只认当前 run 自己事件上的这个字段。 */
  deliveryCycleBoundary?: string;
}): Record<string, unknown> {
  return {
    type: 'supersede',
    target_run_id: input.targetRunId,
    superseding_run_id: input.supersedingRunId,
    ...(input.deliveryCycleBoundary ? { delivery_cycle_boundary: input.deliveryCycleBoundary } : {}),
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

export interface FreshRunContinuationInput {
  projectRoot: string;
  manifest: Pick<GoalManifest, 'feature' | 'run_id' | 'report_dir' | 'requirement' | 'requirement_source_files' | 'successor_of'>;
  forceFresh?: boolean;
}

export interface FreshRunContinuationDecision {
  allowed: boolean;
  overrideUsed: boolean;
  priorRunId?: string;
  reason: string;
}

const CONTINUATION_REQUIRED_HALTS = new Set([
  'content_retry_exhausted', 'framework_bug', 'repair_not_converging',
  'backtrack_fingerprint_repeat', 'no_progress_guard', 'no_progress_visual_gap', 'no_progress_fuse',
]);

interface SiblingRun {
  runId: string;
  runDir: string;
  ts: number;
  status: string;
  haltReason: string;
  manifest: GoalManifest;
  events: GoalRunEvent[];
}

function normalizeRelatedPath(projectRoot: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rel = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('../')) return null;
  const abs = path.resolve(projectRoot, rel);
  const root = path.resolve(projectRoot);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  return rel;
}

export function currentFileHash(projectRoot: string, rel: string): string | null {
  try {
    const abs = path.join(projectRoot, rel);
    if (!fs.statSync(abs).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

/** Prove a repair with existing terminal summary + an already-recorded source hash. */
function findChangedRelatedRepair(projectRoot: string, prior: SiblingRun): string | null {
  const lastVerdict = [...prior.events].reverse().find(event =>
    event.type === 'phase_verdict' && typeof event.phase === 'string',
  );
  const phase = typeof lastVerdict?.phase === 'string' ? lastVerdict.phase : null;
  if (!phase) return null;
  let summary: {
    repair_candidates?: Array<{ files?: unknown }>;
    blockers?: Array<{ affected_files?: unknown }>;
  };
  try {
    summary = JSON.parse(fs.readFileSync(path.join(prior.runDir, 'phases', phase, 'harness', 'summary.json'), 'utf8'));
  } catch {
    return null;
  }
  const related = new Set<string>();
  for (const candidate of summary.repair_candidates ?? []) {
    if (!Array.isArray(candidate.files)) continue;
    for (const file of candidate.files) {
      const rel = normalizeRelatedPath(projectRoot, file);
      if (rel) related.add(rel);
    }
  }
  for (const blocker of summary.blockers ?? []) {
    if (!Array.isArray(blocker.affected_files)) continue;
    for (const file of blocker.affected_files) {
      const rel = normalizeRelatedPath(projectRoot, file);
      if (rel) related.add(rel);
    }
  }
  if (!related.size) return null;

  const baseline = new Map<string, string | null>();
  const attestation = loadReviewClosureAttestation(projectRoot, prior.manifest.feature);
  for (const entry of attestation?.inventory.files ?? []) {
    const rel = normalizeRelatedPath(projectRoot, entry.path);
    if (rel && related.has(rel) && /^[0-9a-f]{64}$/i.test(entry.sha256)) baseline.set(rel, entry.sha256.toLowerCase());
  }
  for (const event of prior.events) {
    if (event.type !== 'phase_write_observed') continue;
    const observations = (event as GoalRunEvent & { observations?: unknown }).observations;
    if (!Array.isArray(observations)) continue;
    for (const raw of observations) {
      if (!raw || typeof raw !== 'object') continue;
      const observation = raw as { path?: unknown; post_sha256?: unknown };
      const rel = normalizeRelatedPath(projectRoot, observation.path);
      if (!rel || !related.has(rel)) continue;
      if (observation.post_sha256 === null) baseline.set(rel, null);
      else if (typeof observation.post_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(observation.post_sha256)) {
        baseline.set(rel, observation.post_sha256.toLowerCase());
      }
    }
  }
  for (const rel of [...related].sort()) {
    if (baseline.has(rel) && currentFileHash(projectRoot, rel) !== baseline.get(rel)) return rel;
  }
  return null;
}

function normalizeSourcePath(projectRoot: string, source: string): string | null {
  const root = path.resolve(projectRoot);
  const abs = path.resolve(root, source);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  return path.relative(root, abs).replace(/\\/g, '/').toLowerCase();
}

function requirementIsBoundToChangedSource(
  projectRoot: string,
  manifest: FreshRunContinuationInput['manifest'],
  prior: GoalManifest,
): boolean {
  const requirement = manifest.requirement?.trim();
  if (!requirement || requirement === prior.requirement?.trim() || !manifest.requirement_source_files?.length) return false;
  const priorSources = new Set((prior.requirement_source_files ?? [])
    .map(source => normalizeSourcePath(projectRoot, source))
    .filter((source): source is string => source !== null));
  return manifest.requirement_source_files.some(source => {
    try {
      const normalized = normalizeSourcePath(projectRoot, source);
      if (!normalized || !priorSources.has(normalized)) return false;
      const abs = path.isAbsolute(source) ? source : path.join(projectRoot, source);
      return fs.readFileSync(abs, 'utf8').trim() === requirement;
    } catch {
      return false;
    }
  });
}

/** Read-only birth guard shared by foreground, detach parent and attended prepare-run. */
export function evaluateFreshRunContinuation(input: FreshRunContinuationInput): FreshRunContinuationDecision {
  if (input.manifest.successor_of) return { allowed: true, overrideUsed: false, reason: 'audited successor lineage' };
  const runsDir = path.dirname(path.join(input.projectRoot, input.manifest.report_dir));
  if (!fs.existsSync(runsDir)) return { allowed: true, overrideUsed: false, reason: 'no prior run' };
  const siblings: SiblingRun[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === input.manifest.run_id) continue;
    const runDir = path.join(runsDir, entry.name);
    const manifestPath = path.join(runDir, 'manifest.json');
    const eventsPath = path.join(runDir, 'events.jsonl');
    if (!fs.existsSync(manifestPath)) continue;
    const creation = inspectGoalRunCreationFiles(manifestPath, eventsPath);
    if (creation.state !== 'complete' && creation.state !== 'legacy') continue;
    const loaded = loadEventsJsonlStrict(eventsPath);
    if (loaded.missing || loaded.corruptLines.length > 0) continue;
    const end = [...loaded.events].reverse().find(event => event.type === 'run_end') as { status?: unknown; halt_reason?: unknown; ts?: unknown } | undefined;
    const status = typeof end?.status === 'string' ? end.status : '';
    const haltReason = typeof end?.halt_reason === 'string' ? end.halt_reason : '';
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as GoalManifest;
      const ts = typeof end?.ts === 'string' && Number.isFinite(Date.parse(end.ts)) ? Date.parse(end.ts) : 0;
      siblings.push({ runId: entry.name, runDir, ts, status, haltReason, manifest, events: loaded.events });
    } catch { /* malformed prior run is handled by existing integrity gates */ }
  }
  const terminalStatuses = new Set(['HALTED', 'COMPLETED', 'CHAIN_SLICE_COMPLETED']);
  const superseded = new Set<string>();
  for (const sibling of siblings) {
    const target = sibling.manifest.successor_of;
    if (!target || !terminalStatuses.has(sibling.status)) continue;
    const audited = sibling.events.some(event => event.type === 'supersede' &&
      (event as GoalRunEvent & { target_run_id?: unknown; superseding_run_id?: unknown }).target_run_id === target &&
      (event as GoalRunEvent & { target_run_id?: unknown; superseding_run_id?: unknown }).superseding_run_id === sibling.runId);
    if (audited) superseded.add(target);
  }
  const latestCompletedTs = siblings
    .filter(sibling => sibling.status === 'COMPLETED' || sibling.status === 'CHAIN_SLICE_COMPLETED')
    .reduce((latest, sibling) => Math.max(latest, sibling.ts), -1);
  const candidates = siblings.filter(sibling =>
    sibling.status === 'HALTED' && CONTINUATION_REQUIRED_HALTS.has(sibling.haltReason) &&
    !superseded.has(sibling.runId) && sibling.ts >= latestCompletedTs,
  );
  candidates.sort((a, b) => b.ts - a.ts || b.runId.localeCompare(a.runId));
  const prior = candidates[0];
  if (!prior) return { allowed: true, overrideUsed: false, reason: 'no failed terminal run' };

  const requirementChanged = input.manifest.requirement?.trim() !== prior.manifest.requirement?.trim();
  if (requirementChanged && requirementIsBoundToChangedSource(input.projectRoot, input.manifest, prior.manifest)) {
    return { allowed: true, overrideUsed: false, priorRunId: prior.runId, reason: 'bound requirement source changed' };
  }
  const changedRepair = findChangedRelatedRepair(input.projectRoot, prior);
  if (changedRepair) {
    return { allowed: true, overrideUsed: false, priorRunId: prior.runId, reason: `related repair changed: ${changedRepair}` };
  }
  if (input.forceFresh) {
    return { allowed: true, overrideUsed: true, priorRunId: prior.runId, reason: 'operator --force override' };
  }
  return {
    allowed: false,
    overrideUsed: false,
    priorRunId: prior.runId,
    reason:
      `feature 已有失败终态 run ${prior.runId}（${prior.status}/${prior.haltReason}），且没有机器可证的新 requirement source 或相关修复。` +
      `请按原 run 允许的恢复路径处理：可恢复时 --resume ${prior.runId}；` +
      '结构终态使用既有 --supersede 创建 successor；确认放弃旧结论才使用 --force。request_impact、HEAD、notes 或改写 CLI 散文均不构成新事实。',
  };
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
  forceFresh?: boolean;
}): GoalRunCreationResult {
  const manifestPath = path.join(options.projectRoot, options.manifest.report_dir, 'manifest.json');
  const eventsPath = path.join(options.projectRoot, options.manifest.report_dir, 'events.jsonl');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-run-creation] fresh run manifest 已存在：${manifestPath}`);
  }
  if (fs.existsSync(eventsPath) && fs.readFileSync(eventsPath, 'utf8').trim()) {
    throw new Error(`[goal-run-creation] fresh run events 已存在：${eventsPath}`);
  }

  const continuation = evaluateFreshRunContinuation({
    projectRoot: options.projectRoot,
    manifest: options.manifest,
    forceFresh: options.forceFresh,
  });
  if (!continuation.allowed) throw new Error(`[goal-run-creation] fresh run refused: ${continuation.reason}`);

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
  if (continuation.overrideUsed) {
    fs.appendFileSync(eventsPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      type: 'fresh_run_override',
      source: '--force',
      prior_run_id: continuation.priorRunId ?? null,
      verified_grant: false,
      reason: 'operator override declaration; not a verified authority grant',
    })}\n`, 'utf8');
  }
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
