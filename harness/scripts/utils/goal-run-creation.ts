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
  isRepeatedRequirement,
  SCOPE_REVISION_FIELDS,
  type GoalManifest,
} from './goal-manifest';
import { collectSupersededAncestorEvents, loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';
import { featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import type { ExecutionScope } from './execution-scope';
import { executionScopeFingerprint } from './execution-scope';
import { reduceRunState } from './run-state-reducer';
import { externalWaitingProbe } from './goal-supervisor';
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
  /** run_end 缺失时取最后一个事件的时刻（崩溃 / 正在运行的 run）；只供接续决策排序与"早于最近一次完成"判断。 */
  lastEventTs: number;
  /** 有正式开始（authoritative run_start）；没有 = 启动即失败，接入走附着而不是恢复。 */
  started: boolean;
}

/** 同 feature 下出生完整、事件未损坏的 run（dry 在 .dry 子目录，不在此列）。解析失败的 run 交给既有完整性门禁，这里跳过。 */
function scanSiblingRuns(runsDir: string, excludeRunId?: string): SiblingRun[] {
  if (!fs.existsSync(runsDir)) return [];
  const siblings: SiblingRun[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === excludeRunId) continue;
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
    const tsOf = (value: unknown): number => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0);
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as GoalManifest;
      const ts = tsOf(end?.ts);
      const lastEventTs = loaded.events.reduce((latest, event) => Math.max(latest, tsOf(event.ts)), 0);
      const started = loaded.events.some(event => event.type === 'run_start' && (event as { dry_run?: unknown }).dry_run !== true);
      siblings.push({ runId: entry.name, runDir, ts, status, haltReason, manifest, events: loaded.events, lastEventTs, started });
    } catch { /* malformed prior run is handled by existing integrity gates */ }
  }
  return siblings;
}

const COMPLETED_STATUSES = new Set(['COMPLETED', 'CHAIN_SLICE_COMPLETED']);

/** 已被承接：某个 run 的事件里有经审计的 supersede（target = 它，superseding = 那个 run 自己）。 */
function supersededRunIds(siblings: readonly SiblingRun[], requireTerminalSuccessor: boolean): Set<string> {
  const terminalStatuses = new Set(['HALTED', ...COMPLETED_STATUSES]);
  const out = new Set<string>();
  for (const sibling of siblings) {
    if (requireTerminalSuccessor && !terminalStatuses.has(sibling.status)) continue;
    for (const event of sibling.events) {
      const audit = event as GoalRunEvent & { target_run_id?: unknown; superseding_run_id?: unknown };
      if (audit.type === 'supersede' && typeof audit.target_run_id === 'string' && audit.superseding_run_id === sibling.runId
        && (!requireTerminalSuccessor || audit.target_run_id === sibling.manifest.successor_of)) {
        out.add(audit.target_run_id);
      }
    }
  }
  return out;
}

export function normalizeRelatedPath(projectRoot: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let rel = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  // 生产检查给的 affected_files 可能是绝对路径（如 featureFilePath 拼出的产物路径）：在工程根之内就换成工程根下的相对路径照常处理，
  // 工程根之外仍拒绝（越界保护不变）；相对路径的行为不变。
  if (path.isAbsolute(rel)) {
    const inside = path.relative(path.resolve(projectRoot), path.resolve(rel)).replace(/\\/g, '/');
    if (!inside || path.isAbsolute(inside)) return null;
    rel = inside;
  }
  if (rel === '..' || rel.startsWith('../')) return null;
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

/** 现有来源读取共用；回退消费者可限定旧窗口，绝不以当前覆盖的attestation替代。 */
export function readRecordedRelatedHashes(
  projectRoot: string, feature: string, related: ReadonlySet<string>, events: readonly GoalRunEvent[],
  window?: { startMs?: number; endMs: number; runId: string },
): Map<string, string | null> {
  const isRelated = (rel: string): boolean => related.has(rel) || [...related].some(dir => rel.startsWith(`${dir}/`));
  const baseline = new Map<string, string | null>();
  const attestation = loadReviewClosureAttestation(projectRoot, feature);
  const at = Date.parse(attestation?.generated_at ?? '');
  if (!window || (Number.isFinite(at) && at >= (window.startMs ?? -Infinity) && at <= window.endMs && attestation?.run_identity?.run_id === window.runId)) {
    for (const entry of attestation?.inventory.files ?? []) {
      const rel = normalizeRelatedPath(projectRoot, entry.path);
      if (rel && isRelated(rel) && /^[0-9a-f]{64}$/i.test(entry.sha256)) baseline.set(rel, entry.sha256.toLowerCase());
    }
  }
  for (const event of events) {
    if (event.type !== 'phase_write_observed') continue;
    const ts = Date.parse(event.ts ?? '');
    if (window && (!Number.isFinite(ts) || ts < (window.startMs ?? -Infinity) || ts > window.endMs)) continue;
    const { observations, owned } = event as GoalRunEvent & { observations?: unknown; owned?: unknown };
    const priorOwned = (Array.isArray(owned) ? owned : []).filter(raw => {
      if (event.phase !== 'coding' || !raw || typeof raw !== 'object') return true;
      const roles = (raw as { roles?: unknown }).roles;
      if (!Array.isArray(roles) || !roles.length || !roles.every(role => role && typeof role === 'object'
        && ['source', 'artifact', 'phase_workspace'].includes(role.kind) && typeof role.source === 'string')) return true;
      return !roles.some(role => role.kind === 'source') || roles.some(role => role.kind === 'artifact');
    });
    for (const raw of [...priorOwned, ...(Array.isArray(observations) ? observations : [])]) {
      if (!raw || typeof raw !== 'object') continue;
      const observation = raw as { path?: unknown; post_sha256?: unknown };
      const rel = normalizeRelatedPath(projectRoot, observation.path);
      if (!rel || !isRelated(rel)) continue;
      if (observation.post_sha256 === null) baseline.set(rel, null);
      else if (typeof observation.post_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(observation.post_sha256)) baseline.set(rel, observation.post_sha256.toLowerCase());
    }
  }
  return baseline;
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
  } | undefined;
  // 最终评审返修 R1：runtime 只在推进 / 外部阻塞停机时把阶段 summary 归档进 run 目录，其它停机（如 no_progress_guard）不归档——
  // 这时退回阶段报告目录里的现行 summary（该阶段最近一次 harness 的结论）。
  const summaryFiles = [() => path.join(prior.runDir, 'phases', phase, 'harness', 'summary.json'),
    () => path.join(featurePhaseReportsDir(projectRoot, prior.manifest.feature, phase), 'summary.json')];
  for (const file of summaryFiles) {
    try { summary = JSON.parse(fs.readFileSync(file(), 'utf8')); break; } catch { /* 下一个来源 */ }
  }
  if (!summary) return null;
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
  // plan 31063a73 §3.1：目录条目（如 UT blocker 的模块 ohosTest 源码目录）筛选基线里位于其下的后代文件，再逐文件比哈希；
  // 不新增目录基线——没有可信基线的文件照旧不能证明修复。
  const baseline = readRecordedRelatedHashes(projectRoot, prior.manifest.feature, related, prior.events);
  for (const rel of [...baseline.keys()].sort()) {
    if (currentFileHash(projectRoot, rel) !== baseline.get(rel)) return rel;
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
  manifest: Pick<GoalManifest, 'requirement' | 'requirement_source_files'>,
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
  const siblings = scanSiblingRuns(runsDir, input.manifest.run_id);
  const superseded = supersededRunIds(siblings, true);
  const latestCompletedTs = siblings
    .filter(sibling => COMPLETED_STATUSES.has(sibling.status))
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
      '补上缺的输入后重新发起同一请求（不带旗标，由接续决策重新接入或起后继）；' +
      `也可按原 run 允许的恢复路径显式处理：可恢复时 --resume ${prior.runId}；` +
      '结构终态使用既有 --supersede 创建 successor；确认放弃旧结论才使用 --force。request_impact、HEAD、notes 或改写 CLI 散文均不构成新事实。',
  };
}

// ----------------------------------------------------------------------------
// plan 4e6fb3b6 §7：同任务接续——一个只读决策函数，三个入口（前台、detach、有人在场）共用
// ----------------------------------------------------------------------------

/** 本次调用事实（plan §7.2 输入）。只放调用本身带来的东西；run 里的状态由决策函数自己读盘。 */
export interface ContinuationCallFacts {
  /** 本次显式给的需求文本（--requirement / --requirement-file / prepare-run 的需求）。 */
  requirement?: string;
  requirementSourceFiles?: string[];
  /** 本次显式给的 --adapter-model。 */
  model?: string;
  /** 本次带了既有的预算授权（--override-manifest）；有权者改了 run manifest 的预算后以它授权。 */
  budgetOverride?: boolean;
  /** 显式的恢复（--resume / --attach-created）、接续（--supersede）、强制新开（--force）：行为与现状相同。 */
  resume?: string;
  attachCreated?: string;
  supersede?: readonly string[];
  force?: boolean;
  /** 有人在场（runtime attended 执行器 / prepare-run）：非结构终局的 run 不受冷却限制（调度方 2026-09-29 裁定），其余结果不变。 */
  attended?: boolean;
}

/**
 * "存在变化"只认这些可核验事实（plan 4e6fb3b6 §7.2 的六种 + plan 9c3d7e1a §5.3 的第七种）。
 * `external_condition_ready`：最新未终局 run 停在带探针的外部等待上，且探针现在就绪——通用，不只为设计权威。
 */
export type ContinuationChange =
  | 'external_condition_ready'
  | 'requirement_source_changed'
  | 'related_repair_changed'
  | 'requirement_increment'
  | 'model_changed'
  | 'budget_changed'
  | 'explicit_flag';

export type RunContinuationDecision =
  | { kind: 'fresh'; explicit: boolean; reason: string }
  | { kind: 'rejoin'; explicit: boolean; runId: string; started: boolean; reason: string }
  | { kind: 'successor'; explicit: boolean; source: string; targets: string[]; change: ContinuationChange; reason: string }
  | { kind: 'hold'; explicit: false; runId: string; haltReason: string; reason: string; guidance: string };

/**
 * 交付周期的现场：兄弟 run、上一次完成、未终局（非完成、未被承接、不早于上一次完成）的 run（按时间升序）。
 * 接续决策与后继的补承接（批三返修 R2）共用这一份，不各算一遍。`excludeRunId` 用于后继自己不算在内。
 */
function deliveryCycleView(projectRoot: string, feature: string, excludeRunId?: string): {
  siblings: SiblingRun[]; lastCompleted: SiblingRun | undefined; unfinished: SiblingRun[];
} {
  const siblings = scanSiblingRuns(featureFilePath(projectRoot, feature, 'goal-runs'), excludeRunId);
  const superseded = supersededRunIds(siblings, false);
  const completed = siblings.filter(run => COMPLETED_STATUSES.has(run.status)).sort((a, b) => a.ts - b.ts || a.runId.localeCompare(b.runId));
  const lastCompleted = completed.at(-1);
  const since = lastCompleted?.ts ?? -1;
  const unfinished = siblings
    .filter(run => !COMPLETED_STATUSES.has(run.status) && !superseded.has(run.runId) && Math.max(run.ts, run.lastEventTs) >= since)
    .sort((a, b) => Math.max(a.ts, a.lastEventTs) - Math.max(b.ts, b.lastEventTs) || a.runId.localeCompare(b.runId));
  return { siblings, lastCompleted, unfinished };
}

/**
 * 批三返修 R2：已出生但在 run_start 之前停下的后继被附着时，按当时的现场重新算出承接目标（与接续决策起后继同一口径）：
 * 来源（该后继 manifest 的 successor_of）+ 交付周期内全部未终局且尚未被承接的 run（后继自己除外）。已由本后继审计过的目标由调用方剔除。
 */
export function successorCatchUpTargets(projectRoot: string, feature: string, successorRunId: string, sourceRunId: string): string[] {
  const { unfinished } = deliveryCycleView(projectRoot, feature, successorRunId);
  return [sourceRunId, ...unfinished.map(run => run.runId).filter(id => id !== sourceRunId)];
}

/**
 * 批三返修 R3/R4：接续决策起的后继只容忍"原请求重放"的起止（与来源 run 的原始起止相同）；返回与之不同的项（空 = 允许）。
 * 前台/detach（runtime）与有人在场 prepare-run 共用这一个判据。
 */
export function successorBoundsConflicts(
  source: { start_phase?: string; end_phase?: string },
  requested: { start?: string; end?: string },
): string[] {
  return [
    ...(requested.start !== undefined && requested.start !== source.start_phase ? [`--start ${requested.start}（原请求 ${source.start_phase ?? '?'}）`] : []),
    ...(requested.end !== undefined && requested.end !== source.end_phase ? [`--end ${requested.end}（原请求 ${source.end_phase ?? '?'}）`] : []),
  ];
}

/** 起止不同时的拒绝说明（两处入口同一句）。 */
export function successorBoundsRefusal(reason: string, conflicts: readonly string[]): string {
  return `[execution-scope] 本次请求要起后继（${reason}），但给出了与原请求不同的起止：${conflicts.join('、')}。`
    + '后继的阶段链由出生范围按当前输入重新解析，不支持按本次起止缩窄；去掉 --start/--end（或原样沿用原请求的起止）后重发。';
}

/**
 * plan 9c3d7e1a §5.3：外部等待修好之后"原 run 继续还是起后继"的**唯一判断**——普通重发、显式 `--resume`（含 supervisor 拉起）、
 * 进程内探针唤醒都消费它。返回 run 有效范围里读不回来、且链内没有责任阶段能重签的输入绑定（`input_id: 原因`）：
 * 空 = 重新接入同一 run；非空 = 同一 run 无法重签（解析器会把该输入置为 invalid），从它起后继、出生时按当前输入重新解析。
 * 用既有 `readBoundInput` 只读核对，不放宽指纹；不核的两类：没有解析值的源码观察（`derive.codebase` 等，run 自己会写源码），
 * 以及从停机阶段起仍由 spec / plan 持有改写权的 artifact（与阶段输入解析同一谓词 `phaseOwnsDesignOutput`，链内改写后经范围修订重签）。
 */
export function staleFrozenBindings(projectRoot: string, feature: string, runId: string, haltedPhase?: string): string[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { readBoundInput, bindingHasParsedValue } = require('./capability-resolution') as typeof import('./capability-resolution');
  const { phaseOwnsDesignOutput } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
  const { loadFeatureContracts, phaseContractIndex } = require('./skill-contract') as typeof import('./skill-contract');
  const { inferLegacyProjectRoot } = require('./project-relative-path') as typeof import('./project-relative-path');
  const { resolveProbeFrameworkRoot } = require('../../repo-layout') as typeof import('../../repo-layout');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const scope = loadEffectiveExecutionScope(projectRoot, feature, runId);
  if (!scope) return [];
  const frameworkRoot = resolveProbeFrameworkRoot(projectRoot);
  const requirement = loadGoalManifestFromRun(projectRoot, runId, { feature }).requirement?.trim();
  const chain = scope.phase_chain.map(String);
  const remaining = chain.slice(Math.max(haltedPhase ? chain.indexOf(haltedPhase) : 0, 0));
  const contracts = phaseContractIndex(loadFeatureContracts(frameworkRoot));
  const legacyRoot = inferLegacyProjectRoot(projectRoot, scope);
  const stale = new Set<string>();
  for (const obligation of scope.obligations) {
    for (const ref of [...obligation.basis, ...(obligation.satisfied_by ?? [])]) {
      if (!('input_id' in ref) || !bindingHasParsedValue(ref)) continue;
      if (remaining.some(phase => phaseOwnsDesignOutput(contracts.get(phase)?.phase.produces ?? [], scope, phase, ref))) continue;
      const isRequirement = ref.source.kind === 'derive' && ref.source.provider_id === 'derive.requirement';
      if (isRequirement && !requirement) continue;
      try {
        readBoundInput({
          projectRoot, frameworkRoot, feature, phase: obligation.owner_phase, track: 'full',
          ...(isRequirement ? { requirement, inputContext: { schema_version: '1.1' as const, subject: { feature }, obligations: {}, required_outputs: [] } } : {}),
        }, ref, legacyRoot);
      } catch (error) {
        stale.add(`${ref.input_id}: ${(error as Error).message}`);
      }
    }
  }
  return [...stale].sort();
}

/** 与恢复守卫（checkTerminalResumeGuard）同一个冷却长度；冷却只在"没有任何变化"时生效（plan §7.3）。 */
export const CONTINUATION_COOLDOWN_MINUTES = 5;

/** 预算身份字段相对出生基线（run_created，再经授权改写前进）是否已被改动——有权者改了 manifest 预算的可核验事实。 */
function budgetEditedSinceBaseline(run: SiblingRun): boolean {
  let baseline: string | undefined;
  for (const event of run.events) {
    const e = event as GoalRunEvent & { manifest_identity_fields?: Record<string, string>; to_fields?: Record<string, string> };
    if (e.type === 'run_created' && e.manifest_identity_fields) baseline = e.manifest_identity_fields.budget;
    else if (e.type === 'manifest_identity_rebase' && e.to_fields) baseline = e.to_fields.budget;
  }
  if (baseline === undefined) return false;
  try {
    return computeManifestIdentityFields(run.manifest).budget !== baseline;
  } catch {
    return false;
  }
}

/** 结构终局：统一投影判 TERMINAL（成功封卷不算——那是完成），或曾检出 testing 越权写（该 run 永不允许恢复）。 */
function isStructurallyTerminal(run: SiblingRun): boolean {
  if (run.events.some(event => event.type === 'testing_write_violation')) return true;
  return reduceRunState(run.events).run_disposition === 'TERMINAL' && !COMPLETED_STATUSES.has(run.status);
}

/** 保持停止时交还的原停止说明：最近一次停机的 halt_guidance，没有则取 run_end 的错误原文。 */
function lastStopGuidance(run: SiblingRun): string {
  const halt = [...run.events].reverse().find(event => event.type === 'phase_halt' && typeof (event as { halt_guidance?: unknown }).halt_guidance === 'string');
  const guidance = (halt as { halt_guidance?: string } | undefined)?.halt_guidance;
  if (guidance?.trim()) return guidance.trim();
  const end = [...run.events].reverse().find(event => event.type === 'run_end') as { error?: unknown } | undefined;
  return typeof end?.error === 'string' ? end.error.trim() : '';
}

/**
 * plan §7.2 接续决策（只读）：新开 / 重新接入 / 起后继 / 保持停止。
 *
 * - 显式旗标（--resume / --attach-created / --supersede / --force）照现状走，只标 explicit，不替它改路。
 * - 上一次完成之后没有未终局的 run → 新开。
 * - 最新的未终局 run 不是结构终局 → 重新接入（有正式开始的恢复，启动即失败的附着）；随后由原来的责任检查判断条件，
 *   本函数不替任何检查放行。例外：本次显式给了与钉值不同的型号或需求增量——这两样原 run 在身份上接不住，走后继出生（§7.3）。
 *   没有任何变化且仍在冷却期内 → 保持停止。
 * - 最新的未终局 run 是结构终局：存在变化 → 起后继；没有变化 → 保持停止（含预算耗尽而没有显式预算改动）。
 *
 * 起后继的合同来源（§7.4）：当前持有范围转交的 run；没有 feature 转交记录时取上一次完成的 run；两者都没有时取最新的未终局 run
 * （plan 未规定这一支，见实施记录）——它从未正式开始过且本次需求不同时改为新开。不以未终局列表的第一项为来源。
 * 承接目标 = 来源 + 交付周期内全部未终局且尚未被承接的 run。
 */
export function decideRunContinuation(input: {
  projectRoot: string;
  feature: string;
  call: ContinuationCallFacts;
  nowMs?: number;
  cooldownMinutes?: number;
  /** 停机所挂探针的执行者（缺省 = 共享的真实探针 `runConditionProbe`）；嵌入调用方与进程内等待用同一个。 */
  runProbe?: (reportDir: string, probe: string, phase?: string) => { ready: boolean; reason?: string };
}): RunContinuationDecision {
  const { call } = input;
  if (call.resume?.trim()) return { kind: 'rejoin', explicit: true, runId: call.resume.trim(), started: true, reason: '显式 --resume' };
  if (call.attachCreated?.trim()) return { kind: 'rejoin', explicit: true, runId: call.attachCreated.trim(), started: false, reason: '显式 --attach-created' };
  const explicitTargets = (call.supersede ?? []).map(id => id.trim()).filter(Boolean);
  if (explicitTargets.length) {
    return { kind: 'successor', explicit: true, source: explicitTargets[0], targets: explicitTargets, change: 'explicit_flag', reason: '显式 --supersede' };
  }
  if (call.force) return { kind: 'fresh', explicit: true, reason: '显式 --force' };

  const { siblings, lastCompleted, unfinished } = deliveryCycleView(input.projectRoot, input.feature);
  /** 当前持有范围转交的 run（feature 冻结记录的最新转交）；记录读不出按没有转交记录处理，后继出生时的范围解析会如实报错。 */
  const scopeHolder = (): string | undefined => {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { readFeatureFrozenScope, currentFeatureScopeTransfer } = require('./feature-execution-scope') as typeof import('./feature-execution-scope');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const record = readFeatureFrozenScope(input.projectRoot, input.feature);
      return record ? currentFeatureScopeTransfer(record)?.run_id : undefined;
    } catch { return undefined; }
  };
  /** 六种变化（显式旗标已在上方分流）相对某个 run 的判定。 */
  const changesAgainst = (run: SiblingRun): ContinuationChange[] => {
    const requirement = call.requirement?.trim();
    const priorRequirement = run.manifest.requirement?.trim() ?? '';
    const out: ContinuationChange[] = [];
    if (requirement && requirement !== priorRequirement && call.requirementSourceFiles?.length
      && requirementIsBoundToChangedSource(input.projectRoot, { requirement, requirement_source_files: call.requirementSourceFiles }, run.manifest)) {
      out.push('requirement_source_changed');
    }
    if (findChangedRelatedRepair(input.projectRoot, run)) out.push('related_repair_changed');
    // 需求增量：本次文本与合并后的全文、原请求、整个历史增量块都不全文相同（批三返修 R1：与后继合并同一判据，不用子串）
    if (requirement && !isRepeatedRequirement(priorRequirement, requirement)) out.push('requirement_increment');
    if (call.model && call.model !== run.manifest.adapter_model_pin?.value) out.push('model_changed');
    if (call.budgetOverride && budgetEditedSinceBaseline(run)) out.push('budget_changed');
    return out;
  };

  const latest = unfinished.at(-1);
  if (!latest) {
    // plan §7.2 之外的补充（调度方 2026-09-29 裁定）：功能已完成之后再提需求——没有未终局 run、范围由一个已完成的 run 持有时，
    // 有变化就从这个已完成的持有者起后继（合同来源与承接目标都是它，走既有后继出生路径）；没有变化保持停止。其余新开不变。
    const holderId = scopeHolder();
    const holderRun = holderId ? siblings.find(run => run.runId === holderId && COMPLETED_STATUSES.has(run.status)) : undefined;
    if (holderRun) {
      const changed = changesAgainst(holderRun);
      if (changed.length) {
        return {
          kind: 'successor', explicit: false, source: holderRun.runId, targets: [holderRun.runId], change: changed[0],
          reason: `功能已由 run ${holderRun.runId} 完成并持有范围；变化=${changed[0]}；从它起后继`,
        };
      }
      return {
        kind: 'hold', explicit: false, runId: holderRun.runId, haltReason: '', reason: '功能已完成且本次没有任何变化',
        guidance: `这个功能已经完成（run ${holderRun.runId}）；要修改或追加内容，请在请求里写明新增或变更的需求后重新发起。本次不新建 run、不写事件。`,
      };
    }
    return { kind: 'fresh', explicit: false, reason: lastCompleted ? `上一次完成（${lastCompleted.runId}）之后没有未终局的 run` : '没有未终局的 run' };
  }

  const changes = changesAgainst(latest);
  // plan 9c3d7e1a §5.3 第七种变化：最新未终局 run 停在带探针的外部等待上，且探针现在就绪。探针取法与 supervisor 同一个提取。
  const waiting = isStructurallyTerminal(latest) ? null : externalWaitingProbe(latest.events);
  if (waiting) {
    const reportDir = path.relative(input.projectRoot, latest.runDir).replace(/\\/g, '/');
    let ready = false;
    try {
      /* eslint-disable-next-line @typescript-eslint/no-require-imports */
      const probe = input.runProbe ?? ((dir: string, name: string, phase?: string) => (require('./condition-wait') as typeof import('./condition-wait')).runConditionProbe(input.projectRoot, dir, name, phase));
      ready = probe(reportDir, waiting.probe, waiting.phase).ready === true;
    } catch { ready = false; /* 探针自身失败 = 未就绪，冷却照常 */ }
    if (ready) changes.push('external_condition_ready');
  }

  const successor = (change: ContinuationChange): RunContinuationDecision => {
    const holder = scopeHolder();
    // 全量回归裁定（甲）：合同来源只能落到最新的未终局 run、而它从未正式开始过（没有任何执行证据可继承）时，
    // 需求不同多半是重新准备——按新开处理，出生范围由当前输入重新解析。持有范围转交的 run 仍作来源（出生段不许绕开转交）；
    // 只有型号变化时照旧起后继（需求没变，来源冻结的请求仍是本次请求）。
    if (!holder && !lastCompleted && !latest.started && changes.includes('requirement_increment')) {
      return { kind: 'fresh', explicit: false, reason: `最新的未终局 run ${latest.runId} 从未正式开始、没有可继承的执行证据；本次需求不同，按新开处理` };
    }
    const source = holder ?? lastCompleted?.runId ?? latest.runId;
    const targets = [source, ...unfinished.map(run => run.runId).filter(id => id !== source)];
    return {
      kind: 'successor', explicit: false, source, targets, change,
      reason: `最新的未终局 run ${latest.runId}（${latest.status || '无 run_end'}${latest.haltReason ? `/${latest.haltReason}` : ''}）；变化=${change}；合同来源=${source}${holder ? '（当前持有范围转交）' : lastCompleted ? '（上一次完成）' : '（最新的未终局 run）'}`,
    };
  };
  const hold = (reason: string, missing: string): RunContinuationDecision => ({
    kind: 'hold', explicit: false, runId: latest.runId, haltReason: latest.haltReason, reason,
    guidance: [
      `本次请求没有带来任何变化，框架保持停止（不新建 run、不写事件）：run ${latest.runId} 停在 ${latest.haltReason || latest.status || '未知原因'}。`,
      ...(lastStopGuidance(latest) ? [`原停止说明：${lastStopGuidance(latest)}`] : []),
      missing,
    ].join('\n'),
  });

  if (isStructurallyTerminal(latest)) {
    if (changes.length) return successor(changes[0]);
    return hold('最新的未终局 run 是结构终局且没有任何变化',
      '补上缺的输入后重新发起同一请求即可继续：新的需求内容、相关修复、显式改换的型号，或有权者改过 run 预算后带 --override-manifest 授权。');
  }
  const identityChange = changes.find(change => change === 'model_changed' || change === 'requirement_increment');
  if (identityChange) return successor(identityChange);
  // plan 9c3d7e1a §5.3：外部条件已就绪——原 run 继续还是起后继，由 staleFrozenBindings 这一处判断。
  if (changes.includes('external_condition_ready')) {
    let stale: string[];
    try { stale = staleFrozenBindings(input.projectRoot, input.feature, latest.runId, waiting?.phase); } catch (error) { stale = [`范围不可读：${(error as Error).message}`]; }
    if (stale.length) {
      const decided = successor('external_condition_ready');
      return { ...decided, reason: `${decided.reason}；停机所挂探针已就绪，但 run 冻结的输入绑定已失效、同一 run 无法重签（${stale.join('；')}）` };
    }
  }
  const cooldownMs = (input.cooldownMinutes ?? CONTINUATION_COOLDOWN_MINUTES) * 60_000;
  const elapsed = (input.nowMs ?? Date.now()) - latest.ts;
  // 冷却与原恢复守卫同一范围：只对有正式开始的 run（原先 --resume 的路径）；启动即失败的 run 原先走附着/新开，从无冷却。
  // 调度方 2026-09-29 裁定：有人在场的调用不设冷却（人刚补好授权/确认/环境就重发，直接重新接入，原责任检查照常执行）；无人值守照旧。
  if (!changes.length && !call.attended && latest.started && (latest.status === 'HALTED' || latest.status === 'DEFERRED') && latest.ts > 0 && elapsed < cooldownMs) {
    return hold('仍在冷却期内且没有任何变化',
      `距上次停止不足 ${input.cooldownMinutes ?? CONTINUATION_COOLDOWN_MINUTES} 分钟且没有新变化：补上缺的输入后重新发起同一请求，或约 ${Math.ceil((cooldownMs - elapsed) / 1000)} 秒后再发起。`);
  }
  return {
    kind: 'rejoin', explicit: false, runId: latest.runId, started: latest.started,
    reason: `最新的未终局 run ${latest.runId} 不是结构终局${changes.length ? `（变化=${changes.join(',')}）` : ''}：${latest.started ? '恢复' : '启动即失败，附着'}，条件由原来的检查判断`,
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
  /**
   * plan 4e6fb3b6 §7.3：入口已按接续决策选好了路（新开 / 起后继）时传入，这里消费决策、不再各自拒绝。
   * 不传（直接调用方）时仍走下方的接续检查。
   */
  continuation?: RunContinuationDecision;
}): GoalRunCreationResult {
  const manifestPath = path.join(options.projectRoot, options.manifest.report_dir, 'manifest.json');
  const eventsPath = path.join(options.projectRoot, options.manifest.report_dir, 'events.jsonl');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-run-creation] fresh run manifest 已存在：${manifestPath}`);
  }
  if (fs.existsSync(eventsPath) && fs.readFileSync(eventsPath, 'utf8').trim()) {
    throw new Error(`[goal-run-creation] fresh run events 已存在：${eventsPath}`);
  }

  const decided = options.continuation && !options.continuation.explicit
    && (options.continuation.kind === 'fresh' || options.continuation.kind === 'successor');
  const continuation = decided
    ? { allowed: true, overrideUsed: false, reason: `接续决策：${options.continuation!.reason}` } as FreshRunContinuationDecision
    : evaluateFreshRunContinuation({
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
