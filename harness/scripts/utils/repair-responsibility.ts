import type { IdentityNeutralDigestReaders } from './identity-neutral-digest';
// ============================================================================
// repair-responsibility.ts — original producer contracts and repair decisions
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
import { resolveModulePathPrefixes, resolveImplementationScope, projectImplementationModules } from './diff-scope';
import { parseScope } from './scope-parser';
import {
  loadArtifactInventory,
  loadFeatureContracts,
  phaseContractIndex,
} from './skill-contract';
import { SpecLoader } from './spec-loader';
import { tryLoadDiffExcludeTestPathRegexes, tryLoadUtSourceRootResolver } from '../../profile-host-loader';
import type { ContractsSpec, HarnessResolvedProfile } from './types';
import type { CorrectionCategory } from './correction-routing';
import type { ExecutionScope } from './execution-scope';
import type { WorkflowSpec } from '../../workflow-loader';
import { extractUtItBlocks } from './ut-it-blocks';
import * as ts from 'typescript';

/** The profile's existing UT ownership also determines when planned files are due. */
export function partitionConstructionFiles(projectRoot: string, profileDir: string,
  contracts: Pick<ContractsSpec, 'files' | 'modules'>): { implementation: string[]; tests: string[] } {
  if (!profileDir) return { implementation: [...contracts.files], tests: [] };
  const roots = (tryLoadUtSourceRootResolver(profileDir)?.(projectRoot, projectImplementationModules(projectRoot, contracts.modules ?? [])) ?? [])
    .map(root => path.resolve(root));
  const patterns = tryLoadDiffExcludeTestPathRegexes(profileDir) ?? [];
  const isTest = (file: string): boolean => roots.some(root => {
    const rel = path.relative(root, path.resolve(projectRoot, file));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }) || patterns.some(pattern => pattern.test(`/${toPosix(file)}`));
  return { implementation: contracts.files.filter(file => !isTest(file)), tests: contracts.files.filter(isTest) };
}

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
  authorityReaders?: IdentityNeutralDigestReaders;
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId?: string;
  pendingOwnerPhase?: string;
  phaseOrder: readonly string[];
  track: FeatureTrack;
  profileDir: string;
  productLayerDirs: readonly string[];
  /** Already-resolved construction authority for research attribution, not a write grant. */
  constructionModules?: ReadonlyArray<{ name: string; package_path: string }>;
  /** Test seam and profile-neutral custom-phase support. */
  resolveUtSourceRoots?: (
    projectRoot: string,
    modules: ReadonlyArray<{ name: string; package_path: string }>,
  ) => string[];
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

export function normalizeResponsibilityPath(projectRoot: string, candidate: string): string {
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
  const normalized = normalizeResponsibilityPath(projectRoot, raw.path);
  const excludedPrefixes = raw.excludedPrefixes?.map((p) => normalizeResponsibilityPath(projectRoot, p));
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

function loadCodingScope(options: ResolvePhaseWriteBoundaryOptions): {
  available: boolean;
  prefixes: string[];
  modules: Array<{ name: string; package_path: string }>;
  diagnostics: string[];
} {
  if (options.constructionModules) {
    const modules = [...options.constructionModules];
    const resolved = resolveModulePathPrefixes(options.projectRoot, modules.map(module => module.name), modules);
    return { available: true, prefixes: resolved.allowedPrefixes, modules, diagnostics: resolved.unmapped.map(name => `construction module has no path: ${name}`) };
  }
  const { resolveEffectiveScopeSource } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const recordedScope = resolveEffectiveScopeSource(options.projectRoot, options.feature, options.runId)?.scope;
  if (recordedScope) {
    const { readRunBoundContracts } = require('./capability-resolution') as typeof import('./capability-resolution');
    let contracts: ReturnType<typeof readRunBoundContracts>;
    try { contracts = readRunBoundContracts(options.projectRoot, options.frameworkRoot, options.feature, options.runId, options.authorityReaders); }
    catch (error) {
      // Ownership discovery also runs before the design producer. A missing or stale
      // construction input leaves source attribution unresolved; the real coding
      // entry still consumes readRunBoundContracts and enforces that prerequisite.
      return { available: false, prefixes: [], modules: [], diagnostics: [`coding source authority unavailable: ${(error as Error).message}`] };
    }
    const modules = (contracts.modules ?? []).map(module => ({ name: module.name, package_path: module.package_path }));
    const resolution = resolveModulePathPrefixes(options.projectRoot, modules.map(module => module.name), modules);
    return { available: true, prefixes: resolution.allowedPrefixes, modules, diagnostics: resolution.unmapped.map(name => `bound module has no path: ${name}`) };
  }
  const loader = new SpecLoader(options.projectRoot, undefined, undefined, options.frameworkRoot);
  const featureSpec = loader.loadFeatureSpec(options.feature);
  const scopeDocName = 'plan.md';
  const scopeText = loader.loadFeatureDoc(options.projectRoot, options.feature, scopeDocName);
  if (!scopeText) {
    return { available: false, prefixes: [], modules: [], diagnostics: [`${scopeDocName} missing; coding source owner unresolved`] };
  }
  const parsed = parseScope(scopeText);
  if (!parsed.scope || parsed.error) {
    return {
      available: false, prefixes: [],
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
  return { available: true, prefixes: resolution.allowedPrefixes, modules, diagnostics };
}

/**
 * Resolve phase path ownership from workflow membership, skill contract outputs,
 * artifact inventory, coding scope and the active profile's UT root resolver.
 */
export function readRepairResponsibilityContracts(
  options: ResolvePhaseWriteBoundaryOptions,
): PhaseWriteBoundaryResolution {
  const contracts = phaseContractIndex(loadFeatureContracts(options.frameworkRoot));
  const phaseOrder = [...contracts.keys()];
  const phaseSet = new Set(phaseOrder);
  const active = (phase: string): boolean => {
    const indexed = contracts.get(phase);
    return !!indexed && (indexed.contract.schema_version === '1.1' || indexed.phase.tracks.includes(options.track));
  };
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
    if (!active(phase)) continue;
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

  const predictedScope = loadCodingScope(options);
  // Existing project sources have a producer before a construction input is ready.
  // That attribution does not replace the coding entry's strict bound-input check.
  const implementation = resolveImplementationScope(options.projectRoot, options.feature, predictedScope.modules, options.runId);
  const codingScope = { modules: implementation.modules, prefixes: implementation.allowedPrefixes, diagnostics: predictedScope.diagnostics };
  diagnostics.push(...codingScope.diagnostics);
  const codingContract = contracts.get('coding')?.phase;
  const codingProducesSource =
    phaseSet.has('coding') &&
    active('coding') &&
    codingContract?.produces.some((o) => o.kind === 'source') === true;

  const utContract = contracts.get('ut')?.phase;
  const utProducesSource =
    phaseSet.has('ut') &&
    active('ut') &&
    utContract?.produces.some((o) => o.kind === 'source') === true;
  const utRoots = options.resolveUtSourceRoots
    ? options.resolveUtSourceRoots(options.projectRoot, codingScope.modules)
    : (tryLoadUtSourceRootResolver(options.profileDir)?.(options.projectRoot, codingScope.modules) ?? []);
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
      source: 'project source modules + original request constraints; stage owns implementation',
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
    ...(fs.existsSync(path.join(options.projectRoot, 'framework')) ? [path.join(options.projectRoot, 'framework')] : []),
    ...options.productLayerDirs.map((dir) => path.join(options.projectRoot, dir)),
    ...['oh-package.json5', 'build-profile.json5', 'hvigorfile.ts', 'AppScope']
      .map((rel) => path.join(options.projectRoot, rel))
      .filter((abs) => fs.existsSync(abs)),
  ].map((p) => normalizeResponsibilityPath(options.projectRoot, p));

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

export interface RepairResponsibilityTarget {
  files?: readonly string[];
  category?: CorrectionCategory;
  summary?: string;
  /** A verified cause/authority owner, never the stage which merely reported it. */
  owner?: string;
  introducedBy?: string;
  factsOwner?: string;
  compatibilityPreserved?: boolean;
  designAuthority?: boolean;
}

export interface RepairResponsibilityContext {
  authorityReaders?: IdentityNeutralDigestReaders;
  projectRoot?: string;
  frameworkRoot?: string;
  feature?: string;
  runId?: string;
  currentPhase?: string;
  workflow?: WorkflowSpec;
  executionScope?: ExecutionScope;
  contracts?: PhaseWriteBoundaryResolution;
  /** Action-local parsed contracts, never persisted. */
  skillContracts?: ReturnType<typeof phaseContractIndex>;
  profile?: HarnessResolvedProfile;
}

export interface RepairResponsibility {
  target: RepairResponsibilityTarget;
  owner: string | null;
  category: CorrectionCategory | null;
  roles: { introducedBy: string | null; legalModifier: string | null; verifier: string | null };
  action: 'current' | 'reopen' | 'handoff' | 'include' | 'design' | 'unavailable';
  reason: string;
}

/** Authored established_by is only a locator; an existing admission or signed facts entry proves it. */
export function factsRepairResponsibility(input: RepairResponsibilityContext): RepairResponsibility | null {
  if (!input.projectRoot || !input.feature || !input.frameworkRoot) return null;
  try {
    const { resolveFactsAbsPath } = require('./context-facts') as typeof import('./context-facts');
    const { parseContextExploration } = require('./context-exploration') as typeof import('./context-exploration');
    const { loadPhaseEvidenceManifest, evidenceEntryMatchesCurrentFile } = require('./phase-evidence-manifest') as typeof import('./phase-evidence-manifest');
    const file = resolveFactsAbsPath(input.projectRoot, input.feature);
    const relative = normalizeResponsibilityPath(input.projectRoot, file);
    const { fm, error } = parseContextExploration(fs.readFileSync(file, 'utf8'));
    if (error || fm.feature !== input.feature) return null;
    let owner: string | undefined;
    if (input.runId) {
      const { loadLineageRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
      const context = [...loadLineageRunEvents(input.projectRoot, input.feature, input.runId)].reverse().find(event => event.type === 'agent_invoke_start'
        && event.facts_context?.baseline && 'feature' in event.facts_context.subject && event.facts_context.subject.feature === input.feature)?.facts_context;
      owner = context?.baseline?.established_by;
    }
    const declared = (fm as Record<string, unknown>).established_by;
    if (!owner && typeof declared === 'string') {
      const evidence = loadPhaseEvidenceManifest(input.projectRoot, input.feature, declared);
      if (evidence?.integrityOk && [...evidence.manifest.inputs, ...evidence.manifest.outputs].some(entry => entry.path === relative
        && entry.facts_phase === declared && evidenceEntryMatchesCurrentFile(input.projectRoot!, entry, input.feature!, input.authorityReaders))) owner = declared;
    }
    return owner ? resolveRepairResponsibility({ ...input, target: { files: [relative], factsOwner: owner } }) : null;
  } catch { return null; }
}

/** Existing CheckResult owner shape; the resolver still owns authorization and executable capability. */
export function factsCheckRepairOwner(input: RepairResponsibilityContext): import('./types').CheckResult['repair_owner'] {
  const owner = factsRepairResponsibility(input)?.owner;
  return owner === 'spec' || owner === 'plan' || owner === 'coding' || owner === 'ut' || owner === 'testing' ? owner : undefined;
}

/** A check's verified cause owner points at its real existing producer outputs, not diagnosis source files. */
export function repairOwnerArtifactTargets(owner: string, context: RepairResponsibilityContext): string[] {
  const resolved = repairResponsibilityContext(context);
  if (!resolved.contracts || !resolved.projectRoot) return [];
  return [...new Set(resolved.contracts.domains.filter(domain => domain.owner === owner && domain.kind === 'artifact' && domain.match === 'exact'
    && fs.existsSync(path.resolve(resolved.projectRoot!, domain.path))).map(domain => domain.path))].sort();
}

/** Keep already-identified product repair objects; a failing test path remains diagnosis evidence. */
export function repairOwnerSourceTargets(owner: string, files: readonly string[], context: RepairResponsibilityContext): string[] {
  const resolved = repairResponsibilityContext(context);
  if (!resolved.projectRoot || !resolved.contracts) return [];
  return [...new Set(files.flatMap(file => {
    let normalized: string; try { normalized = normalizeResponsibilityPath(resolved.projectRoot!, file); } catch { return []; }
    return resolved.contracts!.domains.some(domain => domain.owner === owner && domain.kind === 'source'
      && (domain.match === 'exact' ? domain.path === normalized : normalized === domain.path || normalized.startsWith(domain.path + '/'))
      && !(domain.excludedPrefixes ?? []).some(prefix => normalized === prefix || normalized.startsWith(prefix + '/'))) ? [normalized] : [];
  }))].sort();
}

/** Read existing workflow/scope/profile authority once; the queue never selects a producer. */
export function repairResponsibilityContext(input: RepairResponsibilityContext): RepairResponsibilityContext {
  const skillContracts = input.skillContracts ?? (input.frameworkRoot ? phaseContractIndex(loadFeatureContracts(input.frameworkRoot)) : undefined);
  if (!input.projectRoot || !input.frameworkRoot || !input.feature) return { ...input, skillContracts };
  if (input.contracts && input.workflow && input.executionScope && input.profile) return { ...input, skillContracts };
  const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
  const { loadResolvedProfile } = require('../../profile-loader') as typeof import('../../profile-loader');
  const { resolveWorkflowSpec, workflowForExistingRun } = require('../../workflow-loader') as typeof import('../../workflow-loader');
  const { resolveEffectiveScopeSource } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const config = loadFrameworkConfig(input.projectRoot);
  const profile = input.profile ?? loadResolvedProfile(input.projectRoot, config, input.frameworkRoot);
  let workflow = input.workflow ?? resolveWorkflowSpec(input.projectRoot, { frameworkRoot: input.frameworkRoot, config });
  if (!input.workflow && input.runId) {
    const { loadGoalManifestFromRun } = require('./goal-manifest') as typeof import('./goal-manifest');
    workflow = workflowForExistingRun(workflow, loadGoalManifestFromRun(input.projectRoot, input.runId, { feature: input.feature }), input.frameworkRoot, input.projectRoot);
  }
  const scope = input.executionScope ?? resolveEffectiveScopeSource(input.projectRoot, input.feature, input.runId)?.scope;
  const contracts = input.contracts ?? readRepairResponsibilityContracts({ projectRoot: input.projectRoot, frameworkRoot: input.frameworkRoot,
    feature: input.feature, runId: input.runId, pendingOwnerPhase: input.currentPhase, authorityReaders: input.authorityReaders,
    phaseOrder: workflow.artifacts.map(artifact => artifact.id), track: 'full', profileDir: profile.profileDir,
    productLayerDirs: (config.architecture?.outer_layers ?? []).map(layer => layer.id),
    resolveUtSourceRoots: tryLoadUtSourceRootResolver(profile.profileDir) ?? undefined });
  return { ...input, workflow, executionScope: scope, contracts, skillContracts, profile };
}

/** Categories are a projection of the existing obligation providers, not another owner registry. */
function ownerCategory(owner: string, context: RepairResponsibilityContext): CorrectionCategory | null {
  const artifact = context.workflow?.artifacts.find(item => item.id === owner);
  const provider = artifact?.obligation_provider_id;
  if (provider) return provider === 'obligations.spec' ? 'spec' : provider === 'obligations.plan' ? 'plan'
    : provider === 'obligations.coding' ? 'coding' : provider === 'obligations.ut' || provider === 'obligations.testing' ? 'verification' : null;
  if (owner === 'spec' || owner === 'plan' || owner === 'coding') return owner;
  const phase = context.skillContracts?.get(owner)?.phase;
  if (phase?.produces.some(output => output.id === 'ut_source_and_dag') || owner === 'testing') return 'verification';
  return null;
}

/** Shared in-memory decision. Unknown targets stay unknown rather than falling back to coding/the queue head. */
export function resolveRepairResponsibility(input: RepairResponsibilityContext & { target: RepairResponsibilityTarget }): RepairResponsibility {
  let context: RepairResponsibilityContext;
  try { context = repairResponsibilityContext({ frameworkRoot: path.resolve(__dirname, '../../..'), ...input }); }
  catch (error) { return { target: input.target, owner: null, category: input.target.category ?? null,
    roles: { introducedBy: input.target.introducedBy ?? null, legalModifier: null, verifier: null }, action: 'unavailable', reason: String(error) }; }
  const target = input.target;
  const rawContracts = context.contracts;
  const matches = rawContracts ? (target.files ?? []).map(file => {
    const normalized = normalizeResponsibilityPath(rawContracts.projectRoot, file);
    const owners = [...new Set(rawContracts.domains.filter(domain => (domain.match === 'exact' ? normalized === domain.path
      : normalized === domain.path || normalized.startsWith(domain.path + '/'))
      && !(domain.excludedPrefixes ?? []).some(prefix => normalized === prefix || normalized.startsWith(prefix + '/'))).map(domain => domain.owner))];
    return owners.length === 1 ? owners[0] : null;
  }) : [];
  if (!context.contracts && context.frameworkRoot && target.files?.length) {
    const inventory = loadArtifactInventory(context.frameworkRoot);
    const indexed = phaseContractIndex(loadFeatureContracts(context.frameworkRoot));
    for (const file of target.files) {
      const normalized = file.replace(/\\/g, '/');
      const ids = new Set(inventory.artifacts.filter(artifact => artifact.paths.some(candidate => normalized === candidate || normalized.endsWith('/' + candidate))).map(artifact => artifact.id));
      const owners = [...indexed].filter(([, contract]) => contract.phase.produces.some(output => !!output.artifact && ids.has(output.artifact))).map(([phase]) => phase);
      matches.push(owners.length === 1 ? owners[0] : null);
    }
  }
  let owner: string | null = target.factsOwner ?? target.owner ?? null;
  const knownMatches = matches.filter((value): value is string => !!value);
  const pathOwner = knownMatches.length === (target.files?.length ?? 0) && knownMatches.length && new Set(knownMatches).size === 1 ? knownMatches[0] : null;
  const targetConflict = !!target.owner && !!pathOwner && target.owner !== pathOwner
    && !(target.owner === 'coding' && ownerCategory(pathOwner, context) === 'verification');
  if (targetConflict || target.owner === 'coding' && pathOwner && ownerCategory(pathOwner, context) === 'verification') owner = pathOwner;
  if (!owner && knownMatches.length === (target.files?.length ?? 0) && knownMatches.length && new Set(knownMatches).size === 1) owner = knownMatches[0];
  if (!owner && target.category && context.workflow) {
    const owners = [...new Map(context.workflow.artifacts.filter(artifact => ownerCategory(artifact.id, context) === target.category).map(artifact => [artifact.id, artifact])).values()];
    const obligated = owners.filter(artifact => context.executionScope?.obligations.some(obligation => obligation.owner_phase === artifact.id && obligation.applicability === 'required'));
    if (obligated.length === 1) owner = obligated[0].id;
    else if (owners.length === 1) owner = owners[0].id;
  }
  const phaseContracts = context.skillContracts ?? new Map();
  const verifierCheck = owner ? phaseContracts.get(owner)?.phase.verifies.check : undefined;
  const verifier = verifierCheck ? [...phaseContracts].find(([, indexed]) => indexed.phase.verifies.check === verifierCheck)?.[0] ?? null : null;
  let category = owner ? ownerCategory(owner, context) ?? target.category ?? null : target.category ?? null;
  const compatible = target.compatibilityPreserved ?? (category === 'verification' && !!context.projectRoot && !!context.feature && !!target.files?.length
    && target.files.every(file => (target.owner === 'coding' || hasImplementationTypeCompatibilityChange({ projectRoot: context.projectRoot!, feature: context.feature!, runId: context.runId, file }))
      && codingTestPreservation({ projectRoot: context.projectRoot!, feature: context.feature!, runId: context.runId, file }).preserved));
  if (category === 'verification' && compatible && context.workflow?.artifacts.some(artifact => ownerCategory(artifact.id, context) === 'coding')) {
    owner = context.workflow.artifacts.find(artifact => ownerCategory(artifact.id, context) === 'coding')!.id;
    category = 'coding';
  }
  const roles = { introducedBy: target.introducedBy ?? null, legalModifier: owner, verifier };
  const result = (action: RepairResponsibility['action'], reason: string): RepairResponsibility => ({ target, owner, category, roles, action, reason });
  if (targetConflict) return result('unavailable', '已核实责任声明与真实修复对象不一致；修复对象不能由报错/诊断文件替代，请原提出方更正对象后重新核实');
  if (target.designAuthority) return result('design', '由既有设计权威链裁决、发布并重绑');
  if (!owner) return result('unavailable', '修复对象没有唯一可核实负责方；需要补足真实产物或成因依据');
  if (!context.workflow?.artifacts.some(artifact => artifact.id === owner)) return result('unavailable', `${owner} 的职责已确定，但当前 workflow 无可用能力`);
  if (context.projectRoot && !context.skillContracts?.has(owner)) return result('unavailable', `${owner} 的职责已确定，但当前缺少可执行 Skill 契约`);
  if (context.profile?.phasesDisabled.has(owner)) return result('unavailable', `${owner} 的职责已确定，但当前 profile/实例已禁用该能力`);
  const scope = context.executionScope;
  const { authorizedScopePhases } = require('./execution-scope') as typeof import('./execution-scope');
  if (scope && !authorizedScopePhases(scope, context.workflow).includes(owner)) return result('unavailable', `本次请求未授权 ${owner} 的修改职责`);
  if (owner === input.currentPhase) return result('current', '本阶段在原授权内修复后由原接口复验');
  const obligations = scope?.obligations.filter(obligation => obligation.owner_phase === owner && obligation.applicability === 'required') ?? [];
  if (obligations.some(obligation => obligation.satisfied_by?.length) || scope?.reused_phases.some(phase => phase.phase === owner)) return result('reopen', '已有负责方成果发现真实缺陷，沿原义务重开并撤销受影响证明');
  if (scope?.phase_chain.includes(owner)) return result('handoff', '交给尚待执行且不依赖该待修结论的真实负责方');
  return result('include', '在原请求授权内经既有范围修订纳入必要责任义务');
}

/** Reuse the UT parser; ambiguous syntax never acquires the finite coding exemption. */
export function compareExistingTestPreservation(before: string | undefined, after: string): { preserved: boolean; reason: string } {
  if (before === undefined) return { preserved: false, reason: '无法取得本次修补前的真实测试原件；交 UT 核验' };
  const inspect = (text: string): { pieces: string[]; disabled: string[]; error?: string } => {
    const source = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return { pieces: [], disabled: [], error: '测试源码解析不确定' };
    const pieces: string[] = []; const disabled: string[] = [];
    let itCount = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        if (/^(?:it|test|describe|expect|assert)(?:\.|$)/.test(expression) || /(?:^|\.)assert\w*$/.test(expression)) {
          pieces.push(node.getText(source));
          if (expression === 'it') itCount++;
        }
        if (/^(?:x?it|x?test|x?describe)\.(?:skip|todo|disabled|only)$|^(?:xit|xtest|xdescribe)$/.test(expression)) disabled.push(node.getText(source));
      }
      if (ts.isDecorator(node) && /(?:Disabled|Ignore|Skip)/.test(node.getText(source))) disabled.push(node.getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (extractUtItBlocks(text).length !== itCount) return { pieces, disabled, error: '既有 UT 用例解析不能确认完整性' };
    return { pieces, disabled };
  };
  const old = inspect(before), current = inspect(after);
  if (old.error || current.error) return { preserved: false, reason: old.error ?? current.error! };
  const preserved = JSON.stringify(old.pieces) === JSON.stringify(current.pieces) && JSON.stringify(old.disabled) === JSON.stringify(current.disabled);
  return { preserved, reason: preserved ? '既有用例定义与断言原样保留，未新增测试、断言或跳过声明' : '用例定义、断言或跳过声明发生变化；交真实 UT 负责方修复/核验' };
}

/** Existing pre-write hashes select the original; an older run Git version is never substituted. */
export function codingTestPreservation(input: { projectRoot: string; feature: string; file: string; runId?: string }): { preserved: boolean; reason: string } {
  const { readFileAtRef, resolveEffectiveDiffBaseline } = require('./git-diff') as typeof import('./git-diff');
  const baseline = resolveEffectiveDiffBaseline(input.projectRoot, input.feature, input.runId);
  if (!baseline.available) return { preserved: false, reason: baseline.reason };
  const original = readFileAtRef(input.projectRoot, baseline.baseSha, input.file);
  let expected: string | null | undefined;
  let codingStarted = false;
  if (input.runId) {
    const { loadLineageRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    for (const event of loadLineageRunEvents(input.projectRoot, input.feature, input.runId)) {
      if (event.type !== 'phase_write_observed') continue;
      const rows = [...((event as { owned?: Array<{ path: string; pre_sha256?: string | null; post_sha256?: string | null }> }).owned ?? []),
        ...((event as { observations?: Array<{ path: string; pre_sha256?: string | null; post_sha256?: string | null }> }).observations ?? [])];
      for (const row of rows.filter(row => row.path === input.file)) {
        if (event.phase === 'ut') { expected = row.post_sha256; codingStarted = false; }
        else if (event.phase === 'coding' && !codingStarted) { expected = row.pre_sha256; codingStarted = true; }
      }
    }
  }
  const originalHash = original ? crypto.createHash('sha256').update(original).digest('hex') : null;
  if (expected !== undefined && expected !== originalHash) return { preserved: false, reason: '真实前置测试版本不在可读取的 Git 原件中；不能用更旧 run baseline 代替，交 UT 核验' };
  let after: string;
  try { after = fs.readFileSync(path.resolve(input.projectRoot, input.file), 'utf8'); }
  catch { return { preserved: false, reason: '测试文件删除或不可读取；交 UT 核验' }; }
  return compareExistingTestPreservation(original?.toString('utf8'), after);
}

/** A concrete old typed fixture broken by this implementation's newly-required fields. */
export function hasImplementationTypeCompatibilityChange(input: { projectRoot: string; feature: string; file: string; runId?: string }): boolean {
  const { readFileAtRef, resolveEffectiveDiffBaseline } = require('./git-diff') as typeof import('./git-diff');
  const baseline = resolveEffectiveDiffBaseline(input.projectRoot, input.feature, input.runId);
  if (!baseline.available) return false;
  const original = readFileAtRef(input.projectRoot, baseline.baseSha, input.file)?.toString('utf8');
  if (original === undefined) return false;
  const source = ts.createSourceFile(input.file, original, ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration);
  const typedObjects = new Map<string, Set<string>[]>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.type && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)
      && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const objects = typedObjects.get(node.type.typeName.text) ?? [];
      objects.push(new Set(node.initializer.properties.flatMap(property => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? [property.name.text] : [])));
      typedObjects.set(node.type.typeName.text, objects);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  for (const declaration of imports) {
    if (!ts.isStringLiteral(declaration.moduleSpecifier) || !declaration.moduleSpecifier.text.startsWith('.')) continue;
    const bindings = declaration.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const stem = path.resolve(input.projectRoot, path.dirname(input.file), declaration.moduleSpecifier.text);
    const importedFile = [stem, stem + '.ets', stem + '.ts', path.join(stem, 'index.ets'), path.join(stem, 'index.ts')].find(file => {
      try { return fs.statSync(file).isFile(); } catch { return false; }
    });
    if (!importedFile) continue;
    const relative = path.relative(input.projectRoot, importedFile).replace(/\\/g, '/');
    if (relative.startsWith('../')) continue;
    const previous = readFileAtRef(input.projectRoot, baseline.baseSha, relative)?.toString('utf8');
    if (previous === undefined) continue;
    const current = fs.readFileSync(importedFile, 'utf8');
    if (previous === current) continue;
    const required = (text: string, name: string): Set<string> => {
      const file = ts.createSourceFile(importedFile, text, ts.ScriptTarget.Latest, true);
      const declaration = file.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name.text === name);
      return new Set(declaration && ts.isInterfaceDeclaration(declaration) ? declaration.members.flatMap(member => ts.isPropertySignature(member) && !member.questionToken
        && member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? [member.name.text] : []) : []);
    };
    for (const binding of bindings.elements) {
      const old = required(previous, binding.propertyName?.text ?? binding.name.text);
      const added = [...required(current, binding.propertyName?.text ?? binding.name.text)].filter(field => !old.has(field));
      if (added.length && typedObjects.get(binding.name.text)?.some(properties => added.some(field => !properties.has(field)))) return true;
    }
  }
  return false;
}

/** Actual consumed inputs supply dependency facts; closure bookkeeping is not another semantic prerequisite. */
export function readRepairDependencyContext(projectRoot: string, feature: string, workflow: WorkflowSpec,
  scope: ExecutionScope, frameworkRoot: string) {
  const { OBLIGATION_PROVIDERS, acceptsDefinitionInputProof, scopeDependencyEdges } = require('./execution-scope') as typeof import('./execution-scope');
  const { loadPhaseEvidenceManifest } = require('./phase-evidence-manifest') as typeof import('./phase-evidence-manifest');
  const inventory = loadArtifactInventory(frameworkRoot);
  const contracts = phaseContractIndex(loadFeatureContracts(frameworkRoot));
  const inputOwners = new Map<string, string>();
  const inputEdges: Array<{ before: string; after: string }> = [];
  const declaredEdges = scopeDependencyEdges(scope, workflow);
  const isDownstream = (consumer: string, owner: string): boolean => {
    const reached = new Set([consumer]);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of declaredEdges) if (reached.has(edge.before) && !reached.has(edge.after)) { reached.add(edge.after); changed = true; }
    }
    return reached.has(owner);
  };
  for (const phase of workflow.artifacts.filter(artifact => artifact.scope === 'feature')) {
    const definitionConsumer = (OBLIGATION_PROVIDERS[phase.obligation_provider_id ?? ''] ?? []).some(acceptsDefinitionInputProof);
    const evidence = loadPhaseEvidenceManifest(projectRoot, feature, phase.id);
    if (!evidence?.integrityOk) continue;
    for (const entry of evidence.manifest.inputs) {
      if (entry.facts_phase) continue;
      const candidateOwners = [...contracts].filter(([, contract]) => contract.phase.produces.some(output => inventory.artifacts.find(artifact => artifact.id === output.artifact)?.paths
        .some(file => artifactCandidatePaths(projectRoot, feature, file).some(candidate => path.resolve(candidate) === path.resolve(projectRoot, entry.path))))).map(([owner]) => owner);
      const ownerPhase = entry.owner_phase ?? (candidateOwners.length === 1 ? candidateOwners[0] : undefined);
      if (!ownerPhase || ownerPhase === phase.id) continue;
      if (isDownstream(phase.id, ownerPhase)) continue;
      const owner = contracts.get(ownerPhase)?.phase;
      if (!owner) continue;
      // Reading an existing downstream-owned file does not require that future phase
      // to finish first. Explicit contract/control dependencies remain authoritative.
      const sourceConsumed = !definitionConsumer && scope.obligations.filter(obligation => obligation.owner_phase === phase.id)
        .some(obligation => obligation.basis.some(binding => binding.source.kind === 'derive' && binding.dependencies.some(dependency => {
          const { resolveDependencyPath, inferLegacyProjectRoot } = require('./project-relative-path') as typeof import('./project-relative-path');
          return path.resolve(resolveDependencyPath(projectRoot, dependency.path, inferLegacyProjectRoot(projectRoot, scope))) === path.resolve(projectRoot, entry.path);
        })));
      const actualOutput = owner.produces.some(output => output.kind === 'source' && sourceConsumed || inventory.artifacts.find(artifact => artifact.id === output.artifact)?.paths
        .some(file => artifactCandidatePaths(projectRoot, feature, file).some(candidate => path.resolve(candidate) === path.resolve(projectRoot, entry.path))));
      if (!actualOutput) continue;
      // Source write attribution is not a global read prerequisite (spec/plan research
      // existing code before coding executes). Only that concrete consumer gets its edge.
      if (candidateOwners.includes(ownerPhase)) for (const key of [entry.path, path.resolve(projectRoot, entry.path), path.resolve(projectRoot, entry.path).replace(/\\/g, '/')]) inputOwners.set(key, ownerPhase);
      if (!inputEdges.some(edge => edge.before === ownerPhase && edge.after === phase.id)) inputEdges.push({ before: ownerPhase, after: phase.id });
    }
  }
  return { workflow, scope, inputOwners, inputEdges };
}

