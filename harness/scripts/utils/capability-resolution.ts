// ============================================================================
// capability-resolution.ts — deterministic pre-check capability resolver
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { artifactReadCandidatePaths, catalogPath, featureFilePath } from '../../config';
import type { CheckResult } from './types';
import { normalizeDeviceTestCases } from './device-test-case-kernel';
import {
  ASSURANCE_RANK,
  contractFingerprint,
  loadArtifactInventory,
  loadFeatureContracts,
  phaseContractIndex,
  type Assurance,
  type ContractCapability,
  type ContractInput,
  type ContractInputSource,
  type FeatureTrackName,
  type PhaseContract,
  type SkillContract,
} from './skill-contract';

export type InputResolutionState = 'resolved' | 'absent' | 'invalid' | 'not_applicable';
export type CapabilityResolutionState = 'resolved' | 'pruned' | 'blocked' | 'not_applicable';

export interface ResolutionDependency {
  /** Absolute path; missing candidates are deliberately retained for stale detection. */
  path: string;
  exists: boolean;
  sha256: string | null;
  role: 'applicability' | 'artifact' | 'derive';
}

export interface SourceAttempt {
  kind: 'artifact' | 'derive';
  source: string;
  state: InputResolutionState;
  dependencies: ResolutionDependency[];
  /** Contract-declared upstream phase that produces an artifact attempt, if any. */
  upstream_producer?: string;
  detail?: string;
}

export interface InputResolution {
  id: string;
  state: InputResolutionState;
  selected_source: string | null;
  selected_source_fingerprint: string | null;
  attempts: SourceAttempt[];
}

export interface CapabilityResolution {
  id: string;
  axis: ContractCapability['axis'];
  active: boolean;
  state: CapabilityResolutionState;
  on_missing: ContractCapability['on_missing'];
  applicability_provider_id: string | null;
  applicability_dependencies: ResolutionDependency[];
  inputs: InputResolution[];
}

export interface CapabilityResolutionReport {
  schema_version: '1.0';
  phase: string;
  feature: string;
  track: FeatureTrackName;
  contract_fingerprint: string;
  capabilities: CapabilityResolution[];
  assurance: Assurance;
  /** Every actual source attempt through resolved/invalid termination. */
  source_attempt_dependencies: ResolutionDependency[];
}

export interface CapabilityResolutionOptions {
  frameworkRoot: string;
  projectRoot: string;
  feature: string;
  phase: string;
  track: FeatureTrackName;
  /** Goal/entry input is normalized before resolution; resolver never asks interactively. */
  requirement?: string;
  adhocCases?: string;
}

interface ProviderResult {
  state: InputResolutionState;
  dependencies: ResolutionDependency[];
  detail?: string;
}

interface ApplicabilityResult {
  applicable: boolean;
  invalid?: boolean;
  dependencies: ResolutionDependency[];
  detail?: string;
}

function sha256File(filePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function dependency(filePath: string, role: ResolutionDependency['role']): ResolutionDependency {
  const exists = fs.existsSync(filePath);
  return { path: path.resolve(filePath), exists, sha256: exists ? sha256File(filePath) : null, role };
}

function stableFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function dedupeDependencies(entries: ResolutionDependency[]): ResolutionDependency[] {
  const byPath = new Map<string, ResolutionDependency>();
  for (const entry of entries) byPath.set(`${entry.role}:${entry.path}`, entry);
  return [...byPath.values()].sort((a, b) => `${a.role}:${a.path}`.localeCompare(`${b.role}:${b.path}`));
}

function resolveArtifact(
  frameworkRoot: string,
  projectRoot: string,
  feature: string,
  source: Extract<ContractInputSource, { kind: 'artifact' }>,
): ProviderResult {
  const inventory = loadArtifactInventory(frameworkRoot);
  const registered = inventory.artifacts.find((artifact) => artifact.id === source.artifact);
  if (!registered) return { state: 'invalid', dependencies: [], detail: `unregistered artifact ${source.artifact}` };
  const candidates = registered.paths.flatMap((relativePath) => {
    const fromRegistry = artifactReadCandidatePaths(projectRoot, feature, relativePath);
    const direct = featureFilePath(projectRoot, feature, relativePath);
    return [...new Set([...fromRegistry, direct])];
  });
  const dependencies = dedupeDependencies(candidates.map((candidate) => dependency(candidate, 'artifact')));
  const selected = dependencies.find((entry) => entry.exists);
  if (!selected) return { state: 'absent', dependencies, detail: `${source.artifact} missing` };
  if (selected.sha256 === null) {
    return { state: 'invalid', dependencies, detail: `${source.artifact} is not a readable file: ${selected.path}` };
  }
  return { state: 'resolved', dependencies, detail: selected.path };
}

function sourceTreeDependency(projectRoot: string): ResolutionDependency[] {
  // The configured module catalog is the stable, bounded input for source-target derivation.
  // A repository root directory is intentionally not hashed as a pseudo-source artifact.
  return [dependency(catalogPath(projectRoot), 'derive')];
}

function resolveDerive(
  projectRoot: string,
  feature: string,
  source: Extract<ContractInputSource, { kind: 'derive' }>,
  options: CapabilityResolutionOptions,
): ProviderResult {
  switch (source.provider_id) {
    case 'derive.codebase': {
      const deps = sourceTreeDependency(projectRoot);
      return fs.existsSync(projectRoot)
        ? { state: 'resolved', dependencies: deps, detail: 'project_root' }
        : { state: 'absent', dependencies: deps, detail: 'project root missing' };
    }
    case 'derive.requirement': {
      if (options.requirement?.trim()) {
        // Goal requirement is separately identity- and closure-bound by its canonical
        // manifest. Do not fingerprint an unrelated change.md fallback candidate.
        return {
          state: 'resolved',
          dependencies: [],
          detail: `goal_requirement:${stableFingerprint(options.requirement.trim()).slice(0, 16)}`,
        };
      }
      const change = featureFilePath(projectRoot, feature, 'change.md');
      const deps = [dependency(change, 'derive')];
      return fs.existsSync(change)
        ? { state: 'resolved', dependencies: deps, detail: change }
        : { state: 'absent', dependencies: deps, detail: 'goal requirement/change.md missing' };
    }
    case 'derive.test-targets': {
      const deps = sourceTreeDependency(projectRoot);
      return deps.every((entry) => entry.exists)
        ? { state: 'resolved', dependencies: deps, detail: 'module catalog target derivation' }
        : { state: 'absent', dependencies: deps, detail: 'module catalog missing' };
    }
    case 'derive.adhoc-cases': {
      const deps: ResolutionDependency[] = [];
      const raw = options.adhocCases?.trim();
      if (!raw) {
        return { state: 'absent', dependencies: deps, detail: 'normalized adhoc cases unavailable' };
      }
      // The phase resolver and ad-hoc driver share one deterministic case boundary.
      // Never treat arbitrary non-empty text as an executable device-test input.
      const normalized = normalizeDeviceTestCases({ mode: 'adhoc', natural_language: raw });
      const onlyCase = normalized.cases[0];
      // Capability fallback accepts only a minimally actionable explicit adhoc input.
      // Keep this guard here: the shared kernel also serves the direct adhoc tool,
      // whose single TC-001/no-expected representation remains valid for that flow.
      if (
        normalized.cases.length === 0
        || (normalized.cases.length === 1 && onlyCase.steps.length < 2 && !onlyCase.expected.trim())
      ) {
        return {
          state: 'absent',
          dependencies: deps,
          detail: `adhoc_cases_insufficient:${stableFingerprint(normalized).slice(0, 16)}`,
        };
      }
      if (normalized.issues.length > 0) {
        return {
          state: 'invalid',
          dependencies: deps,
          detail: `adhoc_cases_invalid:${stableFingerprint(normalized).slice(0, 16)}`,
        };
      }
      return {
        state: 'resolved',
        dependencies: deps,
        detail: `adhoc_cases:${stableFingerprint(normalized.cases).slice(0, 16)}`,
      };
    }
  }
}

function resolveApplicability(
  capability: ContractCapability,
  options: CapabilityResolutionOptions,
): ApplicabilityResult {
  if (!capability.tracks.includes(options.track)) return { applicable: false, dependencies: [], detail: 'track excluded' };
  const provider = capability.applicability_provider_id ?? 'applicability.always';
  if (provider === 'applicability.always') return { applicable: true, dependencies: [] };
  // UI is independently decided before any capability input. A missing spec is unknown,
  // therefore still applicable and later pruned by its declared input; explicit non-UI
  // metadata is the only NOT_APPLICABLE route.
  const candidates = artifactReadCandidatePaths(options.projectRoot, options.feature, 'spec.md');
  const dependencies = dedupeDependencies(candidates.map((candidate) => dependency(candidate, 'applicability')));
  const selected = dependencies.find((entry) => entry.exists);
  if (!selected) return { applicable: true, dependencies, detail: 'ui applicability unknown' };
  let text: string;
  try {
    text = fs.readFileSync(selected.path, 'utf8');
  } catch (error) {
    return {
      applicable: true,
      invalid: true,
      dependencies,
      detail: `ui applicability input unreadable: ${(error as Error).message}`,
    };
  }
  if (/\bui_change\s*:\s*false\b/i.test(text) || /\bui[_ -]?change\s*[:：]\s*否/i.test(text)) {
    return { applicable: false, dependencies, detail: 'explicit non-ui requirement' };
  }
  return { applicable: true, dependencies, detail: 'ui requirement or unknown' };
}

function resolveInput(
  input: ContractInput,
  options: CapabilityResolutionOptions,
  artifactProducers: ReadonlyMap<string, string>,
): InputResolution {
  const attempts: SourceAttempt[] = [];
  for (const source of input.sources) {
    const result = source.kind === 'artifact'
      ? resolveArtifact(options.frameworkRoot, options.projectRoot, options.feature, source)
      : resolveDerive(options.projectRoot, options.feature, source, options);
    const attempt: SourceAttempt = {
      kind: source.kind,
      source: source.kind === 'artifact' ? source.artifact : source.provider_id,
      state: result.state,
      dependencies: result.dependencies,
      ...(source.kind === 'artifact' && artifactProducers.has(source.artifact)
        ? { upstream_producer: artifactProducers.get(source.artifact)! }
        : {}),
      ...(result.detail ? { detail: result.detail } : {}),
    };
    attempts.push(attempt);
    if (result.state === 'resolved') {
      return {
        id: input.id,
        state: 'resolved',
        selected_source: attempt.source,
        selected_source_fingerprint: stableFingerprint(attempt),
        attempts,
      };
    }
    if (result.state === 'invalid' || result.state === 'not_applicable') {
      return { id: input.id, state: result.state, selected_source: null, selected_source_fingerprint: null, attempts };
    }
  }
  return { id: input.id, state: 'absent', selected_source: null, selected_source_fingerprint: null, attempts };
}

function resolveCapability(
  capability: ContractCapability,
  phase: PhaseContract,
  options: CapabilityResolutionOptions,
  artifactProducers: ReadonlyMap<string, string>,
): CapabilityResolution {
  const applicability = resolveApplicability(capability, options);
  if (applicability.invalid) {
    return {
      id: capability.id,
      axis: capability.axis,
      active: true,
      state: 'blocked',
      on_missing: capability.on_missing,
      applicability_provider_id: capability.applicability_provider_id ?? 'applicability.always',
      applicability_dependencies: applicability.dependencies,
      inputs: [],
    };
  }
  if (!applicability.applicable) {
    return {
      id: capability.id,
      axis: capability.axis,
      active: false,
      state: 'not_applicable',
      on_missing: capability.on_missing,
      applicability_provider_id: capability.applicability_provider_id ?? 'applicability.always',
      applicability_dependencies: applicability.dependencies,
      inputs: [],
    };
  }
  const byId = new Map(phase.inputs.map((input) => [input.id, input]));
  const inputs = capability.inputs.map((inputId) => resolveInput(byId.get(inputId)!, options, artifactProducers));
  const hasInvalid = inputs.some((input) => input.state === 'invalid' || input.state === 'not_applicable');
  const hasAbsent = inputs.some((input) => input.state === 'absent');
  const state: CapabilityResolutionState = hasInvalid
    ? 'blocked'
    : hasAbsent
      ? capability.on_missing === 'fail' ? 'blocked' : 'pruned'
      : 'resolved';
  return {
    id: capability.id,
    axis: capability.axis,
    active: true,
    state,
    on_missing: capability.on_missing,
    applicability_provider_id: capability.applicability_provider_id ?? 'applicability.always',
    applicability_dependencies: applicability.dependencies,
    inputs,
  };
}

function artifactProducerMap(contracts: readonly SkillContract[]): Map<string, string> {
  const producers = new Map<string, string>();
  for (const contract of contracts) {
    for (const [phase, declaration] of Object.entries(contract.phases)) {
      for (const output of declaration.produces) {
        if (typeof output.artifact !== 'string') continue;
        // The static consistency gate proves that a consumer has a reachable producer.
        // Keep its phase pointer here so assess can target the smallest upstream repair.
        if (!producers.has(output.artifact)) producers.set(output.artifact, phase);
      }
    }
  }
  return producers;
}
/**
 * Resolve exactly once before checker execution. The report is immutable input to all
 * later projections; runtime build/install/run outcomes intentionally do not enter it.
 */
export function resolveCapabilityReport(options: CapabilityResolutionOptions): CapabilityResolutionReport {
  const contracts = loadFeatureContracts(options.frameworkRoot);
  const indexed = phaseContractIndex(contracts).get(options.phase);
  if (!indexed) throw new Error(`[capability-resolution] phase 无 contract：${options.phase}`);
  const artifactProducers = artifactProducerMap(contracts);
  const capabilities = indexed.phase.capabilities.map((capability) =>
    resolveCapability(capability, indexed.phase, options, artifactProducers));
  const sourceAttemptDependencies = dedupeDependencies(capabilities.flatMap((capability) => [
    ...capability.applicability_dependencies,
    ...capability.inputs.flatMap((input) => input.attempts.flatMap((attempt) => attempt.dependencies)),
  ]));
  const assurance: Assurance = capabilities.some((capability) => capability.state === 'blocked')
    ? 'blocked'
    : capabilities.some((capability) => capability.state === 'pruned')
      ? 'degraded'
      : 'full';
  return {
    schema_version: '1.0',
    phase: options.phase,
    feature: options.feature,
    track: options.track,
    contract_fingerprint: contractFingerprint(indexed.contract),
    capabilities,
    assurance,
    source_attempt_dependencies: sourceAttemptDependencies,
  };
}

/**
 * Materialize the immutable pre-check report as the capability-owned CheckResult
 * entries. These are protocol checks, not checker-local input-policy mirrors: a
 * non-resolved capability deliberately emits no check and is projected by the
 * report adapter instead.
 */
export function capabilityResolutionChecks(report: CapabilityResolutionReport): CheckResult[] {
  return report.capabilities
    .filter((capability) => capability.active && capability.state === 'resolved')
    .map((capability): CheckResult => ({
      id: capability.id,
      category: 'structure',
      description: `capability input contract resolved (${capability.id})`,
      severity: 'MINOR',
      status: 'PASS',
      details: `axis=${capability.axis}; all declared pre-check inputs resolved`,
      source: 'capability-resolution.ts',
    }));
}
export function assertCapabilityConsumption(
  report: CapabilityResolutionReport,
  checks: readonly CheckResult[],
): void {
  const byCapabilityId = new Map(report.capabilities.map((capability) => [capability.id, capability]));
  for (const capability of report.capabilities) {
    const matching = checks.filter((check) => check.id === capability.id);
    const expected = capability.active && capability.state === 'resolved' ? 1 : 0;
    if (matching.length !== expected) {
      throw new Error(
        `[capability-resolution] capability=${capability.id} state=${capability.state} expected CheckResult=${expected}, actual=${matching.length}`,
      );
    }
  }
  for (const check of checks) {
    const capability = byCapabilityId.get(check.id);
    if (!capability) continue;
    if (!capability.active || capability.state !== 'resolved') {
      throw new Error(`[capability-resolution] non-resolved capability ${check.id} 不得生成 CheckResult`);
    }
  }
}

export function capabilityResolutionExtraInputs(report: CapabilityResolutionReport): string[] {
  return report.source_attempt_dependencies.map((dependency) => dependency.path);
}

export function capabilityResolutionAssurance(report: CapabilityResolutionReport): Assurance {
  // Keep the comparison table live and make accidental enum additions fail visibly.
  if (!(report.assurance in ASSURANCE_RANK)) throw new Error(`[capability-resolution] 非法 assurance ${report.assurance}`);
  return report.assurance;
}
