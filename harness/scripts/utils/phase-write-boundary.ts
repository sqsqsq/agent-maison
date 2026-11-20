import type { GoalRunEvent } from './goal-runner-phase';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readRepairResponsibilityContracts, normalizeResponsibilityPath, workUnitMayWritePath, workUnitWriteDomains } from './repair-responsibility';
import type { PhaseWriteDomainKind, PhaseWriteBoundaryResolution, ResolvePhaseWriteBoundaryOptions } from './repair-responsibility';
import type { CurrentDispositionProblem } from './check-disposition';
import { validateProjectRelativePath } from './project-relative-path';
export { partitionConstructionFiles } from './repair-responsibility';
export { workUnitProtectedRecordPaths } from './repair-responsibility';
export type { PhaseWriteDomainKind, PhaseWriteMatchKind, PhaseWriteDomain, PhaseWriteBoundaryResolution, ResolvePhaseWriteBoundaryOptions } from './repair-responsibility';

function toPosix(value: string): string { return value.replace(/\\/g, '/'); }
const normalizeRelative = normalizeResponsibilityPath;

/** Complete ownership is read separately; this snapshot freezes the actual unit's write domains. */
export function resolvePhaseWriteBoundary(options: ResolvePhaseWriteBoundaryOptions): PhaseWriteBoundaryResolution {
  const { resolveEffectiveScopeSource } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const scope = options.executionScope ?? resolveEffectiveScopeSource(options.projectRoot, options.feature, options.runId)?.scope;
  const raw = readRepairResponsibilityContracts({ ...options, executionScope: scope });
  const known = new Set(raw.phaseOrder);
  const inventory = options.executionRole === 'author'
    ? (require('../../config') as typeof import('../../config')).componentIndexPath(options.projectRoot) : undefined;
  return { ...raw, phaseOrder: [...options.phaseOrder],
    ...(options.executionRole === 'author' ? { domains: workUnitWriteDomains(raw.domains, scope),
      protectedRoots: [...new Set([...raw.protectedRoots, ...(inventory ? [normalizeRelative(options.projectRoot, inventory)] : []),
        ...raw.domains.filter(domain => domain.kind === 'source').map(domain => domain.path)])] } : {}),
    diagnostics: [...raw.diagnostics,
    ...(options.executionRole ? [] : options.phaseOrder.filter(phase => !known.has(phase)).map(phase => `phase ${phase} has no registered skill contract; read-only`))] };
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

/** Check the physical path as well as the bytes before a rejected write can be restored. */
export function readPhaseRecoveryFile(projectRoot: string, file: string): { actual: string; bytes: Buffer | null } {
  const relative = validateProjectRelativePath(projectRoot, path.relative(projectRoot, file), 'rejected write');
  const expected = path.resolve(fs.realpathSync(projectRoot), relative);
  const parent = path.dirname(expected);
  if (path.relative(parent, fs.realpathSync(path.dirname(file))) !== '') throw new Error(`Recovery target has a redirected parent: ${relative}`);
  const stat = fs.lstatSync(expected, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error(`Recovery target is not a single-link regular file: ${relative}`);
  return { actual: expected, bytes: stat ? fs.readFileSync(expected) : null };
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
  resolution: Pick<PhaseWriteBoundaryResolution, 'projectRoot' | 'protectedRoots' | 'executionRole' | 'immutableInputPaths' | 'verifierResultPath'>,
  options: { ownedPrefixes?: readonly string[]; runtimeExcluded?: readonly string[]; includeFiles?: readonly string[] } = {},
): PhaseInvocationSnapshot {
  const entries: PhaseInvocationSnapshotEntry[] = [];
  const seen = new Set<string>();
  const normalizeAll = (prefixes: readonly string[] | undefined): string[] =>
    (prefixes ?? []).map((prefix) => normalizeRelative(resolution.projectRoot, prefix));
  const runtimeExcluded = normalizeAll(options.runtimeExcluded);
  const ownedPrefixes = normalizeAll(options.ownedPrefixes);
  const immutableInputs = normalizeAll(resolution.immutableInputPaths);
  const included = new Set(normalizeAll([...(options.includeFiles ?? []), ...immutableInputs,
    ...(resolution.verifierResultPath ? [resolution.verifierResultPath] : [])]));
  let runnerPreflightPath: string | undefined;
  if (resolution.executionRole === 'author') {
    const { harnessPreflightPath } = require('./capability-preflight') as typeof import('./capability-preflight');
    runnerPreflightPath = normalizeRelative(resolution.projectRoot, harnessPreflightPath(resolution.projectRoot));
  }
  const explicitlyIncluded = (rel: string): boolean => included.has(rel) || immutableInputs.some(prefix => prefixMatches(rel, prefix));
  const excludedByRuntime = (rel: string): boolean =>
    (runtimeExcluded.some(prefix => prefixMatches(rel, prefix)) && !(resolution.executionRole && explicitlyIncluded(rel)))
    || (!explicitlyIncluded(rel) && !ownedPrefixes.some(prefix => prefixMatches(rel, prefix))
      && (resolution.executionRole === 'verifier' ? /(?:^|\/)(?:goal-runs|context)(?:\/|$)/.test(rel)
        : isRunnerOwnedOrSharedPath(rel) || rel === runnerPreflightPath));
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
    const failure = visit(path.join(resolution.projectRoot, root), false);
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

export type PhaseWriteWindow = 'before_binding' | 'execution_window' | 'unverified';

/** The three snapshots bound a time window. They do not identify a writer. */
export function phaseWriteWindows(pre: PhaseInvocationSnapshot, binding: PhaseInvocationSnapshot | null, post: PhaseInvocationSnapshot): {
  kind: 'unverifiable'; reason: string;
} | { kind: 'checked'; beforeBinding: PhaseInvocationChange[]; returned: PhaseInvocationChange[]; window: PhaseWriteWindow } {
  const prior = binding ? diffPhaseInvocationSnapshots(pre, binding) : null;
  if (prior?.kind === 'unverifiable') return prior;
  const returned = diffPhaseInvocationSnapshots(binding ?? pre, post);
  if (returned.kind === 'unverifiable') return returned;
  return { kind: 'checked', beforeBinding: prior?.kind === 'changed' ? prior.changes : [],
    returned: returned.kind === 'changed' ? returned.changes : [], window: binding ? 'execution_window' : 'unverified' };
}

export interface PhaseWriteViolation extends PhaseInvocationChange, PhasePathOwnership {
  currentPhase: string;
  violation: 'wrong_phase' | 'outside_authority';
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
  invocation?: { events: readonly GoalRunEvent[]; invokeId: string },
): {
  allowed: Array<PhaseInvocationChange & PhasePathOwnership>;
  violations: PhaseWriteViolation[];
  observed: PhaseWriteObservation[];
} {
  const allowed: Array<PhaseInvocationChange & PhasePathOwnership> = [];
  const violations: PhaseWriteViolation[] = [];
  const observed: PhaseWriteObservation[] = [];
  for (const change of changes) {
    if (invocation && isProducedPhaseChange(resolution.projectRoot, currentPhase, change, invocation)) continue;
    const ownership = resolvePhasePathOwnership(resolution, change.path);
    if (resolution.executionRole) {
      if (workUnitMayWritePath(resolution, change.path)) allowed.push({ ...change, ...ownership });
      else violations.push({ ...change, ...ownership, currentPhase, violation: 'outside_authority' });
      continue;
    }
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

/** Match the actual writer's complete hash chain, including any writes before/after it. */
export function isProducedPhaseChange(projectRoot: string, phase: string, change: PhaseInvocationChange,
  invocation: { events: readonly GoalRunEvent[]; invokeId: string }): boolean {
  const start = invocation.events.findIndex(event => event.type === 'agent_invoke_start'
    && event.phase === phase && event.invoke_id === invocation.invokeId);
  if (start < 0) return false;
  let hash = change.preSha256, produced = false;
  for (const event of invocation.events.slice(start + 1) as readonly Record<string, any>[]) {
    if (event.type === 'agent_invoke_end' && event.invoke_id === invocation.invokeId) break;
    if (event.type !== 'phase_write_observed' || event.invoke_id !== invocation.invokeId || event.phase !== phase) continue;
    if (event.produced !== undefined && !Array.isArray(event.produced)) return false;
    for (const row of event.produced ?? []) {
      if (!row || typeof row !== 'object') return false;
      if (row.path !== change.path) continue;
      const expected = event.producer === 'component-index'
        ? [(require('../../config') as typeof import('../../config')).componentIndexPath(projectRoot)]
        : event.producer === 'visual-debt' && typeof event.feature === 'string'
          ? [(require('./visual-debt') as typeof import('./visual-debt')).visualDebtJsonPath(projectRoot, event.feature),
            (require('./visual-debt') as typeof import('./visual-debt')).visualDebtMdPath(projectRoot, event.feature)] : [];
      if (!expected.some(file => path.resolve(file) === path.resolve(projectRoot, row.path))
        || row.pre_sha256 !== hash || typeof row.post_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.post_sha256)
        || !(row.pre_sha256 === null && row.preimage_base64 === null
          || typeof row.preimage_base64 === 'string' && sha256Buffer(Buffer.from(row.preimage_base64, 'base64')) === row.pre_sha256)) return false;
      hash = row.post_sha256; produced = true;
    }
  }
  return produced && hash === change.postSha256;
}

/** The existing writer records its own bytes; a path or a scanner match alone grants nothing. */
export function recordProducedPhaseWrites<T>(input: { projectRoot: string; feature: string; producer: 'component-index' | 'visual-debt'; files: string[] }, write: () => T): T {
  const { resolveManagedGoalInvocation } = require('./managed-goal-invocation') as typeof import('./managed-goal-invocation');
  const actor = resolveManagedGoalInvocation(input);
  const { loadAuthoritativeEvents } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
  const eventsPath = actor && path.join(actor.run_dir, 'events.jsonl');
  const active = actor && eventsPath && !loadAuthoritativeEvents(eventsPath).some(event => event.type === 'agent_invoke_end' && event.invoke_id === actor.invoke_id);
  if (!active || !actor || !eventsPath) return write();
  const { assertFencedOwner } = require('./goal-run-control') as typeof import('./goal-run-control');
  assertFencedOwner(actor.run_dir, actor.owner, 'generated_projection_write');
  const { executionRequestForInvoke } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
  const original = executionRequestForInvoke(actor.run_dir, actor.invoke_id)?.request;
  if (!original?.pre_snapshot || original.pre_snapshot.failureReason) throw new Error('生成物写入缺该调用的真实前像，保留当前字节并恢复原调用观察');
  const history = loadAuthoritativeEvents(eventsPath);
  const before = input.files.map(file => {
    const relative = normalizeRelative(input.projectRoot, file);
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new Error(`生成物不是普通文件，保留原件：${relative}`);
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const expected = original.pre_snapshot!.entries.find(entry => entry.path === relative)?.sha256 ?? null;
    const current = bytes && sha256Buffer(bytes);
    const priorProduction = history.some(event => event.type === 'phase_write_observed' && event.invoke_id === actor.invoke_id
      && ((event as Record<string, any>).produced ?? []).some((row: { path?: string }) => row.path === relative));
    if ((current !== expected || priorProduction) && !isProducedPhaseChange(input.projectRoot, actor.phase,
      { path: relative, how: expected === null ? 'added' : current === null ? 'removed' : 'modified', preSha256: expected, postSha256: current },
      { events: history, invokeId: actor.invoke_id })) throw new Error(`生成物含本调用未归属的修改，原写方不得覆盖：${relative}`);
    return { file, bytes };
  });
  const result = write();
  const produced = before.flatMap(({ file, bytes }) => {
    const post = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!post || bytes?.equals(post)) return [];
    return [{ path: normalizeRelative(input.projectRoot, file), pre_sha256: bytes && sha256Buffer(bytes),
      post_sha256: sha256Buffer(post), preimage_base64: bytes?.toString('base64') ?? null }];
  });
  if (produced.length) {
    assertFencedOwner(actor.run_dir, actor.owner, 'generated_projection_observed');
    fs.appendFileSync(eventsPath, JSON.stringify({ ts: new Date().toISOString(), type: 'phase_write_observed', phase: actor.phase,
      invoke_id: actor.invoke_id, feature: input.feature, producer: input.producer, produced }) + '\n', 'utf8');
  }
  return result;
}

/**
 * Replay one run's attribution events into "path → bytes the UT invocation left there"
 * (`null` = UT removed it).  Any later owned write, observation or violation of the same path, by any
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
    for (const row of [...rows(event.observations), ...rows(event.owned)]) voidPath(row.path, event.phase);
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
  if (resolution.executionRole) {
    return [
      '**Work unit write boundary (recorded around this invocation):**',
      ...(resolution.executionRole === 'verifier'
        ? [`- Independent verification is read-only. Return only this invocation's original result${resolution.verifierResultPath ? ` at \`${resolution.verifierResultPath}\`` : ' through its result transport'}. Do not repair product or design files.`]
        : [
          '- The same unit author may edit authorized implementation, test source, test scripts/inputs and local design candidates across methods. Skill outputs and profile source roots describe the artifacts; the current method grants no extra authority.',
          '- Preserve the original request and acceptance strength. Changes to tests/assertions require independent assessment of coverage and strength; a self-reported PASS is not proof.',
          '- Shared design publication, bound original inputs, framework files, machine state and formal screenshots/logs/results/PASS records are protected. Run the actual checking tools to produce evidence.',
          '- Testing scripts/inputs and test-plan.hylyre.md are editable inputs; adjacent reports, captures and execution results are evidence and cannot be hand-written.',
        ]),
      '- Pre-existing dirty bytes are not attributed to this invocation. Legal writes and their pre/post hashes remain available after interruption.',
    ];
  }
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

interface RecordedPhaseWriteConflict {
  before: string | null;
  restorable: boolean;
  start?: GoalRunEvent;
  owner?: string;
  observedAt?: string;
}

function recordedPhaseWriteConflicts(events: readonly GoalRunEvent[]): Map<string, RecordedPhaseWriteConflict> {
  const conflicts = new Map<string, RecordedPhaseWriteConflict>();
  const ownRecoveries = new Set((events as readonly Record<string, any>[]).filter(event => event.type === 'phase_backtrack_requested' && event.reason === 'phase_write_violation'
    && typeof event.invoke_id === 'string' && typeof event.from_phase === 'string' && event.from_phase === event.to_phase).map(event => event.invoke_id));
  const starts = new Map<string, GoalRunEvent>();
  for (const event of events as readonly Record<string, any>[]) {
    if (event.type === 'agent_invoke_start' && event.invoke_id) starts.set(event.invoke_id, event);
    if (event.type === 'phase_write_violation' && Array.isArray(event.violations)) {
      const rows = event.violations as Array<{ path?: unknown; violation?: unknown; pre_sha256?: unknown; window?: PhaseWriteWindow; owner?: unknown }>;
      const start = starts.get(event.invoke_id);
      const purpose = start && 'purpose' in start && typeof start.purpose === 'string' ? start.purpose : undefined;
      const author = !!start?.phase && (require('./goal-phase-executor') as typeof import('./goal-phase-executor'))
        .workUnitExecutionRole({ phase: start.phase }, purpose) === 'author';
      const uncertain = new Set(rows.filter(row => row.window !== undefined && row.window !== 'execution_window').map(row => row.path));
      for (const row of rows) {
        if (typeof row.path !== 'string' || row.pre_sha256 !== null && typeof row.pre_sha256 !== 'string') continue;
        const selfViolation = row.violation === 'outside_authority' || row.violation === 'wrong_phase' && ownRecoveries.has(event.invoke_id);
        if (!row.window && !selfViolation) continue;
        const restorable = selfViolation && (!row.window || row.window === 'execution_window' && author && !uncertain.has(row.path));
        const previous = conflicts.get(row.path);
        if (!previous || !!start && previous.start === start && row.window === 'before_binding') {
          conflicts.set(row.path, { before: row.pre_sha256, restorable, start,
            owner: typeof row.owner === 'string' ? row.owner : undefined, observedAt: event.ts });
        } else if (!restorable) previous.restorable = false;
      }
    }
    if (event.type === 'phase_write_observed') {
      const owned = Array.isArray(event.owned) ? event.owned : [];
      for (const row of [...(Array.isArray(event.observations) ? event.observations : []), ...owned]) {
        const conflict = conflicts.get(row.path);
        if (!conflict) continue;
        const start = starts.get(event.invoke_id);
        const ownerStartedFromOriginal = !!start && start !== conflict.start && owned.includes(row) && row.pre_sha256 === conflict.before;
        if (row.post_sha256 === conflict.before || ownerStartedFromOriginal) conflicts.delete(row.path);
      }
    }
  }
  return conflicts;
}

export function authorWritePreimages(events: readonly GoalRunEvent[]): Map<string, string | null> {
  return new Map([...recordedPhaseWriteConflicts(events)].filter(([, conflict]) => conflict.restorable).map(([file, conflict]) => [file, conflict.before]));
}

export function unresolvedPhaseWrites(projectRoot: string, events: readonly GoalRunEvent[],
  authority?: { feature: string; frameworkRoot?: string; runId?: string }): Map<string, RecordedPhaseWriteConflict> {
  return new Map([...recordedPhaseWriteConflicts(events)].filter(([file, conflict]) => {
    const absolute = path.resolve(projectRoot, file);
    if (!absolute.startsWith(path.resolve(projectRoot) + path.sep)) return true;
    if (!fs.existsSync(absolute)) return conflict.before !== null;
    if (!fs.lstatSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) return true;
    const current = sha256Buffer(fs.readFileSync(absolute));
    if (current === conflict.before) return false;
    if (!authority || conflict.restorable || !conflict.observedAt
      || !conflict.owner || !/^(spec|prd|plan|design|coding|review|ut|testing)$/.test(conflict.owner)) return true;
    const { loadPhaseEvidenceManifest } = require('./phase-evidence-manifest') as typeof import('./phase-evidence-manifest');
    const evidence = loadPhaseEvidenceManifest(projectRoot, authority.feature, conflict.owner);
    if (!evidence?.integrityOk || !(Date.parse(evidence.manifest.generated_at) > Date.parse(conflict.observedAt))
      || !evidence.manifest.outputs.some(output => path.resolve(projectRoot, output.path) === absolute && output.sha256 === current)) return true;
    const { readReusableCheckResult } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
    const report = readReusableCheckResult({ projectRoot, ...authority, phase: conflict.owner });
    const summary = report?.summary as { verdict?: unknown; closure_status?: unknown } | undefined;
    return summary?.verdict !== 'PASS' || summary.closure_status !== 'closed';
  }));
}

export function unrestoredAuthorWrites(projectRoot: string, events: readonly GoalRunEvent[]): Map<string, string | null> {
  return new Map([...unresolvedPhaseWrites(projectRoot, events)].filter(([, conflict]) => conflict.restorable).map(([file, conflict]) => [file, conflict.before]));
}

export function unresolvedWriteReviewPaths(conflicts: ReadonlyMap<string, RecordedPhaseWriteConflict>): string[] {
  return [...conflicts].filter(([, conflict]) => !conflict.restorable).map(([file]) => file);
}

export function phaseWriteConflictProblems(projectRoot: string, events: readonly GoalRunEvent[], authority?: Parameters<typeof unresolvedPhaseWrites>[2]): CurrentDispositionProblem[] {
  return [...unresolvedPhaseWrites(projectRoot, events, authority)].map(([file, conflict]) => ({ phase: 'scope', id: 'phase_write_violation',
    action: conflict.restorable ? 'repair' : 'verify', affects: 'completion', severity: 'BLOCKER', files: [file],
    detail: conflict.restorable ? `先恢复本单元作者自己尚未恢复的越权写入：${file}；pre_sha256=${conflict.before ?? 'missing'}`
      : `原交回的写入时段存在冲突，保全现场，由对应责任方核对原件：${file}` }));
}
