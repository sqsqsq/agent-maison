// ============================================================================
// phase-write-boundary.ts — invocation-scoped phase ownership and attribution
// ============================================================================
// Ownership is derived from existing contracts/resolvers.  This module does not
// persist an owner manifest and does not infer ownership from the current git
// diff.  The only persisted facts are the runner events emitted by the caller.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  artifactReadCandidatePaths,
  featureDir,
  featureFilePath,
  receiptDirPath,
} from '../../config';
import type { FeatureTrack } from './runtime-policy';
import { resolveModulePathPrefixes } from './diff-scope';
import { parseScope } from './scope-parser';
import {
  loadArtifactInventory,
  loadFeatureContracts,
  phaseContractIndex,
} from './skill-contract';
import { SpecLoader } from './spec-loader';

export type PhaseWriteDomainKind = 'artifact' | 'source' | 'phase_workspace';
export type PhaseWriteMatchKind = 'exact' | 'prefix';

export interface PhaseWriteDomain {
  owner: string;
  kind: PhaseWriteDomainKind;
  match: PhaseWriteMatchKind;
  /** Normalized POSIX path relative to projectRoot. */
  path: string;
  /** Existing SSOT/resolver that supplied this domain. */
  source: string;
  /** Prefix domains may exclude a more specific producer (coding excludes UT). */
  excludedPrefixes?: string[];
}

export interface PhaseWriteBoundaryResolution {
  projectRoot: string;
  feature: string;
  phaseOrder: string[];
  domains: PhaseWriteDomain[];
  diagnostics: string[];
  /** Source-producing phases whose existing resolver could not produce a domain. */
  unresolvedSourcePhases: string[];
  protectedRoots: string[];
}

export interface ResolvePhaseWriteBoundaryOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  phaseOrder: readonly string[];
  track: FeatureTrack;
  profileDir: string;
  productLayerDirs: readonly string[];
  /** Test seam and profile-neutral custom-phase support. */
  resolveUtSourceRoots?: (
    projectRoot: string,
    modules: ReadonlyArray<{ name: string; package_path: string }>,
  ) => string[];
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeRelative(projectRoot: string, candidate: string): string {
  const abs = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(projectRoot, candidate);
  const rel = toPosix(path.relative(projectRoot, abs));
  if (!rel || rel === '.' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    throw new Error(`[phase-write-boundary] path escapes project root: ${candidate}`);
  }
  return rel.replace(/^\.\//, '').replace(/\/+$/, '');
}

function addDomain(
  out: PhaseWriteDomain[],
  seen: Set<string>,
  projectRoot: string,
  raw: Omit<PhaseWriteDomain, 'path'> & { path: string },
): void {
  const normalized = normalizeRelative(projectRoot, raw.path);
  const excludedPrefixes = raw.excludedPrefixes?.map((p) => normalizeRelative(projectRoot, p));
  const key = `${raw.owner}\0${raw.kind}\0${raw.match}\0${normalized}\0${(excludedPrefixes ?? []).join('|')}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ ...raw, path: normalized, ...(excludedPrefixes ? { excludedPrefixes } : {}) });
}

function artifactCandidatePaths(
  projectRoot: string,
  feature: string,
  inventoryPath: string,
): string[] {
  const exact = featureFilePath(projectRoot, feature, inventoryPath);
  const basename = path.posix.basename(toPosix(inventoryPath));
  return [...new Set([exact, ...artifactReadCandidatePaths(projectRoot, feature, basename)])];
}

function loadCodingScope(
  options: ResolvePhaseWriteBoundaryOptions,
): {
  prefixes: string[];
  modules: Array<{ name: string; package_path: string }>;
  diagnostics: string[];
} {
  const loader = new SpecLoader(options.projectRoot, undefined, undefined, options.frameworkRoot);
  const featureSpec = loader.loadFeatureSpec(options.feature);
  const scopeDocName = options.track === 'lite' ? 'change.md' : 'plan.md';
  const scopeText = loader.loadFeatureDoc(options.projectRoot, options.feature, scopeDocName);
  if (!scopeText) {
    return { prefixes: [], modules: [], diagnostics: [`${scopeDocName} missing; coding source owner unresolved`] };
  }
  const parsed = parseScope(scopeText);
  if (!parsed.scope || parsed.error) {
    return {
      prefixes: [],
      modules: [],
      diagnostics: [`${scopeDocName} scope invalid: ${parsed.error?.kind ?? 'unknown'}`],
    };
  }
  const contractModules = (featureSpec.contracts?.modules ?? [])
    .filter((m): m is typeof m & { name: string; package_path: string } =>
      typeof m.name === 'string' && m.name.trim() !== '' &&
      typeof m.package_path === 'string' && m.package_path.trim() !== '')
    .map((m) => ({ name: m.name, package_path: m.package_path }));
  const resolution = resolveModulePathPrefixes(
    options.projectRoot,
    parsed.scope.in_scope_modules,
    contractModules,
  );
  const allowed = new Set(parsed.scope.in_scope_modules);
  const modules = contractModules.filter((m) => allowed.has(m.name));
  const diagnostics = resolution.unmapped.map((name) => `in_scope module has no path resolver: ${name}`);
  return { prefixes: resolution.allowedPrefixes, modules, diagnostics };
}

/**
 * Resolve phase path ownership from workflow membership, skill contract outputs,
 * artifact inventory, coding scope and the active profile's UT root resolver.
 */
export function resolvePhaseWriteBoundary(
  options: ResolvePhaseWriteBoundaryOptions,
): PhaseWriteBoundaryResolution {
  const phaseOrder = [...options.phaseOrder].map(String);
  const phaseSet = new Set(phaseOrder);
  const contracts = phaseContractIndex(loadFeatureContracts(options.frameworkRoot));
  const inventory = new Map(loadArtifactInventory(options.frameworkRoot).artifacts.map((a) => [a.id, a]));
  const domains: PhaseWriteDomain[] = [];
  const seen = new Set<string>();
  const diagnostics: string[] = [];
  const unresolvedSourcePhases = new Set<string>();

  for (const phase of phaseOrder) {
    const indexed = contracts.get(phase);
    if (!indexed) {
      diagnostics.push(`phase ${phase} has no registered skill contract; read-only`);
      continue;
    }
    if (!indexed.phase.tracks.includes(options.track)) continue;
    for (const output of indexed.phase.produces) {
      if (output.artifact) {
        const registered = inventory.get(output.artifact);
        if (!registered) {
          diagnostics.push(`artifact ${output.artifact} produced by ${phase} is absent from inventory`);
          continue;
        }
        for (const registeredPath of registered.paths) {
          for (const candidate of artifactCandidatePaths(options.projectRoot, options.feature, registeredPath)) {
            addDomain(domains, seen, options.projectRoot, {
              owner: phase,
              kind: 'artifact',
              match: 'exact',
              path: candidate,
              source: `contract:${phase}.produces(${output.artifact})`,
            });
          }
        }
      }
    }

    // Existing per-phase agent workspace convention.  Runner-owned reports and
    // closure files are excluded from the invocation snapshot below.
    for (const name of ['context-exploration.md', 'headless-assumptions.jsonl', 'headless-assumptions.md']) {
      addDomain(domains, seen, options.projectRoot, {
        owner: phase,
        kind: 'phase_workspace',
        match: 'exact',
        path: path.join(receiptDirPath(options.projectRoot, options.feature, phase), name),
        source: 'existing phase workspace convention',
      });
    }
  }

  const codingScope = loadCodingScope(options);
  diagnostics.push(...codingScope.diagnostics);
  const codingContract = contracts.get('coding')?.phase;
  const codingProducesSource =
    phaseSet.has('coding') &&
    codingContract?.tracks.includes(options.track) === true &&
    codingContract.produces.some((o) => o.kind === 'source');

  const utContract = contracts.get('ut')?.phase;
  const utProducesSource =
    phaseSet.has('ut') &&
    utContract?.tracks.includes(options.track) === true &&
    utContract.produces.some((o) => o.kind === 'source');
  const utRoots = utProducesSource && options.resolveUtSourceRoots
    ? options.resolveUtSourceRoots(options.projectRoot, codingScope.modules)
    : [];
  if (utProducesSource && utRoots.length === 0) {
    unresolvedSourcePhases.add('ut');
    diagnostics.push('ut source producer has no profile UT root resolution; read-only');
  }
  for (const root of utRoots) {
    addDomain(domains, seen, options.projectRoot, {
      owner: 'ut',
      kind: 'source',
      match: 'prefix',
      path: root,
      source: `profile:${path.basename(options.profileDir)} UT source-root resolver`,
    });
  }

  if (codingProducesSource && codingScope.prefixes.length === 0) {
    unresolvedSourcePhases.add('coding');
  }
  for (const prefix of codingScope.prefixes) {
    addDomain(domains, seen, options.projectRoot, {
      owner: 'coding',
      kind: 'source',
      match: 'prefix',
      path: prefix,
      source: 'plan/change in_scope_modules + contracts/catalog module-path resolver',
      excludedPrefixes: utRoots,
    });
  }

  // Existing testing boundary includes phase diagnostics/captures beyond the two
  // narrative artifacts registered in the inventory.
  if (phaseSet.has('testing')) {
    for (const dir of [
      receiptDirPath(options.projectRoot, options.feature, 'testing'),
      featureFilePath(options.projectRoot, options.feature, 'device-testing'),
    ]) {
      addDomain(domains, seen, options.projectRoot, {
        owner: 'testing',
        kind: 'phase_workspace',
        match: 'prefix',
        path: dir,
        source: 'existing testing-write-boundary',
      });
    }
  }

  const protectedRoots = [
    featureDir(options.projectRoot, options.feature),
    ...options.productLayerDirs.map((dir) => path.join(options.projectRoot, dir)),
    ...['oh-package.json5', 'build-profile.json5', 'hvigorfile.ts', 'AppScope']
      .map((rel) => path.join(options.projectRoot, rel))
      .filter((abs) => fs.existsSync(abs)),
  ].map((p) => normalizeRelative(options.projectRoot, p));

  return {
    projectRoot: options.projectRoot,
    feature: options.feature,
    phaseOrder,
    domains: domains.sort((a, b) => a.path.localeCompare(b.path) || a.owner.localeCompare(b.owner)),
    diagnostics,
    unresolvedSourcePhases: [...unresolvedSourcePhases].sort(),
    protectedRoots: [...new Set(protectedRoots)].sort(),
  };
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

/** Capture all controlled feature/source/config bytes immediately around an agent process. */
export function capturePhaseInvocationSnapshot(
  resolution: PhaseWriteBoundaryResolution,
): PhaseInvocationSnapshot {
  const entries: PhaseInvocationSnapshotEntry[] = [];
  const seen = new Set<string>();
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
    if (isRunnerOwnedOrSharedPath(rel)) return null;
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
  violation: 'no_owner' | 'multiple_owners' | 'wrong_phase';
}

export function classifyPhaseInvocationChanges(
  resolution: PhaseWriteBoundaryResolution,
  currentPhase: string,
  changes: readonly PhaseInvocationChange[],
): { allowed: PhaseInvocationChange[]; violations: PhaseWriteViolation[] } {
  const allowed: PhaseInvocationChange[] = [];
  const violations: PhaseWriteViolation[] = [];
  for (const change of changes) {
    const ownership = resolvePhasePathOwnership(resolution, change.path);
    if (ownership.status === 'unique' && ownership.owner === currentPhase) {
      allowed.push(change);
      continue;
    }
    violations.push({
      ...change,
      ...ownership,
      currentPhase,
      violation: ownership.status === 'none'
        ? 'no_owner'
        : ownership.status === 'multiple'
          ? 'multiple_owners'
          : 'wrong_phase',
    });
  }
  return { allowed, violations };
}

export function renderPhaseWriteBoundaryGuidance(
  resolution: PhaseWriteBoundaryResolution,
  currentPhase: string,
): string[] {
  const mine = resolution.domains.filter((domain) => domain.owner === currentPhase);
  const exact = mine.filter((domain) => domain.match === 'exact').map((domain) => domain.path);
  const prefixes = mine.filter((domain) => domain.match === 'prefix').map((domain) => `${domain.path}/**`);
  return [
    '**Phase write boundary (machine-enforced around this invocation):**',
    `- Current phase: \`${currentPhase}\`. Writable registered paths:`,
    ...[...new Set([...exact, ...prefixes])].sort().map((p) => `  - \`${p}\``),
    ...(mine.length === 0 ? ['  - (none; this phase is read-only)'] : []),
    '- Every other feature artifact, product/test source path, and root build configuration is read-only.',
    '- Pre-existing dirty bytes are not attributed to this invocation. A changed earlier-owner path is preserved as untrusted bytes; the runner invalidates evidence and backtracks to that owner for full revalidation.',
    '- `goal-runs/**`, closure state, manifests, pointers, summaries, and evidence refreshes are runner-owned. Do not edit them.',
  ];
}
