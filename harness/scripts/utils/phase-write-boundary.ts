import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readRepairResponsibilityContracts, normalizeResponsibilityPath } from './repair-responsibility';
import type { PhaseWriteDomainKind, PhaseWriteBoundaryResolution, ResolvePhaseWriteBoundaryOptions } from './repair-responsibility';
export { partitionConstructionFiles } from './repair-responsibility';
export type { PhaseWriteDomainKind, PhaseWriteMatchKind, PhaseWriteDomain, PhaseWriteBoundaryResolution, ResolvePhaseWriteBoundaryOptions } from './repair-responsibility';

function toPosix(value: string): string { return value.replace(/\\/g, '/'); }
const normalizeRelative = normalizeResponsibilityPath;

/** Ownership remains complete; the invocation order is only the current authorization view. */
export function resolvePhaseWriteBoundary(options: ResolvePhaseWriteBoundaryOptions): PhaseWriteBoundaryResolution {
  const raw = readRepairResponsibilityContracts(options);
  const known = new Set(raw.phaseOrder);
  return { ...raw, phaseOrder: [...options.phaseOrder], diagnostics: [...raw.diagnostics,
    ...options.phaseOrder.filter(phase => !known.has(phase)).map(phase => `phase ${phase} has no registered skill contract; read-only`)] };
}

export interface PhasePathOwnership {
  path: string;
  owner: string | null;
  ownerCandidates: string[];
  roles: Array<{ kind: PhaseWriteDomainKind; source: string }>;
  status: 'unique' | 'none' | 'multiple';
}

function prefixMatches(pathValue: string, prefix: string): boolean {
  return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

export function resolvePhasePathOwnership(
  resolution: PhaseWriteBoundaryResolution,
  changedPath: string,
): PhasePathOwnership {
  const normalized = normalizeRelative(resolution.projectRoot, changedPath);
  const matches = resolution.domains.filter((domain) => {
    const hit = domain.match === 'exact'
      ? normalized === domain.path
      : prefixMatches(normalized, domain.path);
    if (!hit) return false;
    return !(domain.excludedPrefixes ?? []).some((excluded) => prefixMatches(normalized, excluded));
  });
  const ownerCandidates = [...new Set(matches.map((m) => m.owner))].sort((a, b) =>
    resolution.phaseOrder.indexOf(a) - resolution.phaseOrder.indexOf(b));
  return {
    path: normalized,
    owner: ownerCandidates.length === 1 ? ownerCandidates[0] : null,
    ownerCandidates,
    roles: matches.map((m) => ({ kind: m.kind, source: m.source })),
    status: ownerCandidates.length === 1 ? 'unique' : ownerCandidates.length === 0 ? 'none' : 'multiple',
  };
}

export interface PhaseInvocationSnapshotEntry {
  path: string;
  kind: 'file' | 'symlink';
  sha256: string;
}

export interface PhaseInvocationSnapshot {
  sha256: string;
  entries: PhaseInvocationSnapshotEntry[];
  failureReason: string | null;
}

const SNAPSHOT_EXCLUDED_SEGMENTS = new Set([
  '.git', '.idea', '.hvigor', 'node_modules', 'oh_modules', 'build', 'dist',
]);

/** Runner-owned/shared facts are deliberately outside the agent attribution window. */
function isRunnerOwnedOrSharedPath(rel: string): boolean {
  const normalized = `/${rel}/`;
  if (normalized.includes('/goal-runs/')) return true;
  if (normalized.includes('/reports/')) return true;
  if (normalized.includes('/context/')) return true;
  return /(?:^|\/)(?:next\.json|phase-completion-receipt\.md|phase-state\.json|\.current-phase\.json|feature-completion\.json)$/.test(rel);
}

function snapshotFailure(reason: string): PhaseInvocationSnapshot {
  return { sha256: 'unverifiable', entries: [], failureReason: reason };
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Capture all controlled feature/source/config bytes immediately around an agent process.
 * 链外设计修复调用（plan 9c3d7e1a §5.5 第 2 步）另给两组工程相对路径前缀：
 *  · `ownedPrefixes`：本任务自己的工作区（蓝图工作区，含本 run 与祖先 run 的事件、manifest、run-control）——
 *    其下不套用按目录名排除运行时路径的通用规则，判重、预算与授权输入照查；
 *  · `runtimeExcluded`：调用期间运行时自己会写的路径（草稿、调用日志、进度、beacon、本 feature 锁心跳），一律排除；
 *  · `includeFiles`：本任务实际引用的输入文件（蓝图 source_ref 指向的项目内文件）——即使位于通常排除的目录（context / reports 等）也逐个核对。
 * 其余位置（别的 feature 的 run）仍按通用规则排除运行时输出；依赖、缓存、构建目录的排除不变。都不给 = 阶段调用的原行为。
 */
export function capturePhaseInvocationSnapshot(
  resolution: Pick<PhaseWriteBoundaryResolution, 'projectRoot' | 'protectedRoots'>,
  options: { ownedPrefixes?: readonly string[]; runtimeExcluded?: readonly string[]; includeFiles?: readonly string[] } = {},
): PhaseInvocationSnapshot {
  const entries: PhaseInvocationSnapshotEntry[] = [];
  const seen = new Set<string>();
  const normalizeAll = (prefixes: readonly string[] | undefined): string[] =>
    (prefixes ?? []).map((prefix) => normalizeRelative(resolution.projectRoot, prefix));
  const runtimeExcluded = normalizeAll(options.runtimeExcluded);
  const ownedPrefixes = normalizeAll(options.ownedPrefixes);
  const included = new Set(normalizeAll(options.includeFiles));
  const excludedByRuntime = (rel: string): boolean => runtimeExcluded.some((prefix) => prefixMatches(rel, prefix))
    || (!included.has(rel) && !ownedPrefixes.some((prefix) => prefixMatches(rel, prefix)) && isRunnerOwnedOrSharedPath(rel));
  const visit = (abs: string, requiredRoot: boolean): string | null => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch (error) {
      if (!requiredRoot && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return `lstat failed: ${toPosix(path.relative(resolution.projectRoot, abs))}: ${(error as Error).message}`;
    }
    const rel = normalizeRelative(resolution.projectRoot, abs);
    if (rel.split('/').some((segment) => SNAPSHOT_EXCLUDED_SEGMENTS.has(segment))) return null;
    if (excludedByRuntime(rel)) return null;
    if (stat.isSymbolicLink()) {
      try {
        if (!seen.has(rel)) {
          entries.push({ path: rel, kind: 'symlink', sha256: sha256Buffer(Buffer.from(fs.readlinkSync(abs), 'utf8')) });
          seen.add(rel);
        }
        return null;
      } catch (error) {
        return `readlink failed: ${rel}: ${(error as Error).message}`;
      }
    }
    if (stat.isDirectory()) {
      let children: string[];
      try {
        children = fs.readdirSync(abs).sort();
      } catch (error) {
        return `readdir failed: ${rel}: ${(error as Error).message}`;
      }
      for (const child of children) {
        const failure = visit(path.join(abs, child), true);
        if (failure) return failure;
      }
      return null;
    }
    if (!stat.isFile()) return null;
    try {
      if (!seen.has(rel)) {
        entries.push({ path: rel, kind: 'file', sha256: sha256Buffer(fs.readFileSync(abs)) });
        seen.add(rel);
      }
      return null;
    } catch (error) {
      return `read failed: ${rel}: ${(error as Error).message}`;
    }
  };

  for (const root of resolution.protectedRoots) {
    const failure = visit(path.join(resolution.projectRoot, root), true);
    if (failure) return snapshotFailure(failure);
  }
  // 实际引用的输入：所在目录按通用规则不遍历时单独核（不存在 = 不记，前后都不存在即无变化）。
  for (const rel of included) {
    const failure = visit(path.join(resolution.projectRoot, rel), false);
    if (failure) return snapshotFailure(failure);
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const aggregate = crypto.createHash('sha256');
  for (const entry of entries) aggregate.update(`${entry.path}\n${entry.kind}\n${entry.sha256}\n`, 'utf8');
  return { sha256: aggregate.digest('hex'), entries, failureReason: null };
}

export interface PhaseInvocationChange {
  path: string;
  how: 'added' | 'removed' | 'modified' | 'type-changed';
  preSha256: string | null;
  postSha256: string | null;
}

export function diffPhaseInvocationSnapshots(
  pre: PhaseInvocationSnapshot,
  post: PhaseInvocationSnapshot,
): { kind: 'clean' } | { kind: 'unverifiable'; reason: string } | { kind: 'changed'; changes: PhaseInvocationChange[] } {
  if (!/^[0-9a-f]{64}$/.test(pre.sha256)) return { kind: 'unverifiable', reason: pre.failureReason ?? 'pre snapshot invalid' };
  if (!/^[0-9a-f]{64}$/.test(post.sha256)) return { kind: 'unverifiable', reason: post.failureReason ?? 'post snapshot invalid' };
  if (pre.sha256 === post.sha256) return { kind: 'clean' };
  const before = new Map(pre.entries.map((entry) => [entry.path, entry]));
  const after = new Map(post.entries.map((entry) => [entry.path, entry]));
  const changes: PhaseInvocationChange[] = [];
  for (const [changedPath, entry] of after) {
    const old = before.get(changedPath);
    if (!old) changes.push({ path: changedPath, how: 'added', preSha256: null, postSha256: entry.sha256 });
    else if (old.kind !== entry.kind) changes.push({ path: changedPath, how: 'type-changed', preSha256: old.sha256, postSha256: entry.sha256 });
    else if (old.sha256 !== entry.sha256) changes.push({ path: changedPath, how: 'modified', preSha256: old.sha256, postSha256: entry.sha256 });
  }
  for (const [changedPath, entry] of before) {
    if (!after.has(changedPath)) changes.push({ path: changedPath, how: 'removed', preSha256: entry.sha256, postSha256: null });
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes.length > 0
    ? { kind: 'changed', changes }
    : { kind: 'unverifiable', reason: 'aggregate changed without a per-path delta' };
}

export interface PhaseWriteViolation extends PhaseInvocationChange, PhasePathOwnership {
  currentPhase: string;
  violation: 'wrong_phase';
}

/**
 * Attribution that deliberately stops short of a verdict.
 *   - `unattributed`: ownership does not resolve.  The artifact inventory describes
 *     skill-authored narratives only, so harness ledgers, revalidation records and
 *     phase notes are permanently absent from it; a missing owner is a gap in the
 *     registry, not evidence that the agent overstepped.
 *   - `deferred_to_checker`: ownership resolves to another phase, but only through a
 *     product-source or phase-workspace role.  Those are already judged once, and with
 *     graded dispositions, by check-coding's scope gate, `ut_no_src_mutation` and
 *     `review_closure_attestation`.  Attribution runs before the gates, so blocking here
 *     would pre-empt the graded judgement it duplicates.
 */
export interface PhaseWriteObservation extends PhaseInvocationChange, PhasePathOwnership {
  currentPhase: string;
  disposition: 'unattributed' | 'deferred_to_checker';
}

export function classifyPhaseInvocationChanges(
  resolution: PhaseWriteBoundaryResolution,
  currentPhase: string,
  changes: readonly PhaseInvocationChange[],
): {
  allowed: Array<PhaseInvocationChange & PhasePathOwnership>;
  violations: PhaseWriteViolation[];
  observed: PhaseWriteObservation[];
} {
  const allowed: Array<PhaseInvocationChange & PhasePathOwnership> = [];
  const violations: PhaseWriteViolation[] = [];
  const observed: PhaseWriteObservation[] = [];
  for (const change of changes) {
    const ownership = resolvePhasePathOwnership(resolution, change.path);
    if (ownership.status === 'unique' && ownership.owner === currentPhase) {
      allowed.push({ ...change, ...ownership });
      continue;
    }
    // Only an inventory-registered artifact domain carries the accountability that the
    // invalidate-and-backtrack recovery assumes; the role set is already resolved above,
    // so no second permission table is needed to make the split.
    const registeredArtifact =
      ownership.status === 'unique' && ownership.roles.some((role) => role.kind === 'artifact');
    if (registeredArtifact) {
      violations.push({ ...change, ...ownership, currentPhase, violation: 'wrong_phase' });
      continue;
    }
    observed.push({
      ...change,
      ...ownership,
      currentPhase,
      disposition: ownership.status === 'unique' ? 'deferred_to_checker' : 'unattributed',
    });
  }
  return { allowed, violations, observed };
}

/**
 * Replay one run's attribution events into "path → bytes the UT invocation left there"
 * (`null` = UT removed it).  Any later observation or violation of the same path, by any
 * invocation, voids the fact until a UT invocation writes it again.  This grants nothing:
 * check-coding only uses it to stop blaming coding for a UT output whose bytes are unchanged.
 */
export function replayUtOwnedWrites(
  events: ReadonlyArray<object>,
): Map<string, { sha256: string | null; voidedBy?: string }> {
  const facts = new Map<string, { sha256: string | null; voidedBy?: string }>();
  const rows = (value: unknown): Array<{ path?: unknown; post_sha256?: unknown }> =>
    Array.isArray(value) ? value.filter((row) => !!row && typeof row === 'object') : [];
  const voidPath = (rawPath: unknown, phase: unknown): void => {
    const fact = typeof rawPath === 'string' ? facts.get(rawPath) : undefined;
    if (fact) fact.voidedBy = String(phase ?? 'unknown');
  };
  for (const event of events as ReadonlyArray<Record<string, unknown>>) {
    if (event.type === 'phase_write_violation') {
      for (const row of rows(event.violations)) voidPath(row.path, event.phase);
      continue;
    }
    if (event.type !== 'phase_write_observed') continue;
    for (const row of rows(event.observations)) voidPath(row.path, event.phase);
    if (event.phase !== 'ut') continue;
    for (const row of rows(event.owned)) {
      if (typeof row.path !== 'string') continue;
      if (row.post_sha256 === null || (typeof row.post_sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.post_sha256))) {
        facts.set(row.path, { sha256: row.post_sha256 });
      }
    }
  }
  return facts;
}

export function renderPhaseWriteBoundaryGuidance(
  resolution: PhaseWriteBoundaryResolution,
  currentPhase: string,
): string[] {
  const mine = resolution.domains.filter((domain) => domain.owner === currentPhase);
  const exact = mine.filter((domain) => domain.match === 'exact').map((domain) => domain.path);
  const prefixes = mine.filter((domain) => domain.match === 'prefix').map((domain) => `${domain.path}/**`);
  return [
    '**Phase write boundary (recorded around this invocation):**',
    `- Current phase: \`${currentPhase}\`. Registered paths this phase owns:`,
    ...[...new Set([...exact, ...prefixes])].sort().map((p) => `  - \`${p}\``),
    ...(mine.length === 0 ? ['  - (none registered for this phase)'] : []),
    '- Writing a registered artifact owned by another phase invalidates this invocation: the bytes are preserved as untrusted and the runner directs recovery to that owner. Outstanding current-phase obligations still require valid proof before completion. Do not repair another phase\'s artifact in place.',
    '- Pre-existing dirty bytes are not attributed to this invocation.',
    '- Other changes are recorded and judged by the checks that own them (scope, drift, and closure gates); they are not silently permitted.',
    ...(currentPhase === 'coding' ? ['- Finite compatibility repair: existing test imports/types/data/doubles directly broken by this implementation may be repaired only while coding_existing_test_preserved confirms real pre-repair originals and unchanged existing cases/assertions, with no new test/assertion/skip. New or changed test logic belongs to UT. In the existing coding report list each changed test datum/double, the actual edit and its implementation-related reason; review verifies the actual diff. A preservation PASS is not a business-cause explanation or a test PASS.'] : []),
    '- `goal-runs/**`, closure state, manifests, pointers, summaries, and evidence refreshes are runner-owned. Do not edit them.',
  ];
}
