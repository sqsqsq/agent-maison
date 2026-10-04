// ============================================================================
// capability-resolution-entry-input.ts — goal/CLI input bridge for pre-check resolution
// ============================================================================

import type { PhaseInputContext } from './capability-resolution';
import { isExecutionSourceBasis, executionCompletionPhases } from './execution-scope';
import type { FactsInvocationContext } from './context-facts';
import { loadGoalManifestFromRun } from './goal-manifest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveEffectiveScopeSource, eventsWithScopeRevocations } from './goal-run-creation';
import { loadAuthoritativeEvents } from './goal-runner-phase';
import { executionScopeFingerprint } from './execution-scope';
import { loadFeatureContracts, phaseContractIndex, loadArtifactInventory } from './skill-contract';
import { resolveFactsAbsPath, factsBaselineFingerprint } from './context-facts';
import { assertFactsSourceReadable, parseContextExploration } from './context-exploration';
import { evidenceEntryMatchesCurrentFile, loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness, sha256File } from './phase-evidence-manifest';
import { loadFrameworkConfig, resolveFeatureArtifact } from '../../config';
import { featuresDirPath, enumerateFeatures, featureFilePath, receiptDirPath, featurePhaseReportsDir } from '../../config';
import { validateProjectRelativePath, isInsideProjectRoot, inferLegacyProjectRoot, resolveDependencyPath } from './project-relative-path';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import { stableStringify } from './phase-evidence-manifest';
import { readRunBoundContracts } from './capability-resolution';
import { resolveEffectiveDiffBaseline } from './git-diff';
import { diffChangedFilesWithStatus } from './git-diff';
import { loadResolvedProfile } from '../../profile-loader';
import { tryLoadDiffExcludeTestPathRegexes, tryLoadProfileCodingHost, tryLoadUtSourceRootResolver } from '../../profile-host-loader';
import { SpecLoader } from './spec-loader';
import { computeRequirementShaFromText } from './fidelity-shared';
import { findUnclosedGuardianBounds } from './goal-containment-reconcile';
import { resolvePhaseWriteBoundary, resolvePhasePathOwnership } from './phase-write-boundary';

/** Revision-trigger kinds: historical evidence for why a revision happened, never a current target. */
const REVISION_TRIGGER_KINDS = new Set(['design-decision', 'acceptance-definition']);

export interface PreparedRequest {
  schema_version: '1.0';
  phase: 'review' | 'ut' | 'testing';
  requested_result: string;
  request_sha256: string;
  requestFile: string;
  reportDir: string;
  factsPath: string;
  targets: { files: string[]; tests: string[] };
  baseline: { base?: string; head: string };
  inputs: Record<string, string>;
  allowed_test_writes: string[];
  bindings: Array<{ path: string; exists: boolean; sha256: string | null }>;
  sourceContents: Array<{ path: string; content: string }>;
  gaps: string[];
}

export { realProjectPath as realRequestPath } from './project-relative-path';
import { realProjectPath as realRequestPath } from './project-relative-path';

/**
 * spec / plan 是否仍持有这条 artifact 绑定的改写权：它产出该 artifact，且本阶段还有未满足的 required 义务。
 * 持有时该绑定由本阶段在链内改写并经范围修订重签，不作为期望绑定去比对。阶段输入解析与恢复判断（plan 9c3d7e1a §5.3）共用。
 */
export function phaseOwnsDesignOutput(
  produces: ReadonlyArray<{ artifact?: string }>,
  scope: { obligations: ReadonlyArray<{ owner_phase: string; applicability: string; satisfied_by?: readonly unknown[] }> },
  phase: string,
  binding: import('./capability-resolution').InputBinding,
): boolean {
  return ['spec', 'plan'].includes(phase)
    && binding.source.kind === 'artifact' && produces.some(output => output.artifact === (binding.source as { artifact: string }).artifact)
    && scope.obligations.some(obligation => obligation.owner_phase === phase && obligation.applicability === 'required' && !obligation.satisfied_by?.length);
}

export function requestProtectedPaths(root: string, frameworkRoot: string): string[] {
  const protectedDirs = [frameworkRoot, path.join(root, '.git'), featuresDirPath(root)];
  const phases = [...phaseContractIndex(loadFeatureContracts(frameworkRoot)).keys()];
  for (const { featureId } of enumerateFeatures(root)) {
    protectedDirs.push(featureFilePath(root, featureId, 'goal-runs'));
    for (const phase of phases) protectedDirs.push(receiptDirPath(root, featureId, phase), featurePhaseReportsDir(root, featureId, phase, frameworkRoot));
  }
  const seen = new Set<string>();
  const featureLinks = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    const real = fs.realpathSync(dir); if (seen.has(real)) return; seen.add(real);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) protectedDirs.push(fs.realpathSync(file));
      else if (entry.isDirectory()) featureLinks(file);
    }
  };
  featureLinks(featuresDirPath(root));
  return protectedDirs.map(file => {
    let parent = path.resolve(file);
    const suffix: string[] = [];
    while (!fs.existsSync(parent)) { suffix.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) throw new Error('protected path: no existing ancestor'); parent = next; }
    return path.join(fs.realpathSync(parent), ...suffix);
  });
}

export function prepareExplicitRequest(options: { projectRoot: string; frameworkRoot: string; phase: string; requestFile: string; reportDir: string }): PreparedRequest {
  const root = fs.realpathSync(options.projectRoot);
  const requestFile = realRequestPath(root, options.requestFile, 'request-file');
  const raw = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as Record<string, unknown>;
  const object = (value: unknown, label: string): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; };
  const keys = (value: Record<string, unknown>, allowed: string[], label: string): void => { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`); };
  object(raw, 'request'); keys(raw, ['schema_version', 'phase', 'requested_result', 'targets', 'baseline', 'inputs', 'allowed_test_writes'], 'request');
  if (raw.schema_version !== '1.0' || !['review', 'ut', 'testing'].includes(String(raw.phase)) || raw.phase !== options.phase) throw new Error('request/CLI phase mismatch or unsupported request');
  if (typeof raw.requested_result !== 'string' || !raw.requested_result.trim()) throw new Error('requested_result is required');
  const list = (value: unknown, label: string): string[] => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be a path array`);
    const paths = value.map(item => path.relative(root, realRequestPath(root, item, label)).replace(/\\/g, '/'));
    if (new Set(paths).size !== paths.length) throw new Error(`${label}: duplicate target`);
    return paths.sort();
  };
  const targetsRaw = object(raw.targets, 'targets'); keys(targetsRaw, ['files', 'tests'], 'targets');
  const targets = { files: list(targetsRaw.files ?? [], 'targets.files'), tests: list(targetsRaw.tests ?? [], 'targets.tests') };
  const allowed = list(raw.allowed_test_writes ?? [], 'allowed_test_writes');
  if (allowed.length && options.phase !== 'ut') throw new Error('only UT requests may authorize test writes');
  if (options.phase === 'review' && (!targets.files.length || allowed.length)) throw new Error('review requires source targets and grants no writes');
  if (options.phase === 'ut' && !targets.files.length && !targets.tests.length) throw new Error('UT requires tests or a behavior source');
  if (allowed.some(file => !targets.tests.includes(file) || targets.files.includes(file))) throw new Error('allowed_test_writes must name only requested test targets');
  if (allowed.length && !targets.files.length && !Object.keys(object(raw.inputs ?? {}, 'inputs')).length) throw new Error('test writes require a behavior source');
  const reportDir = realRequestPath(root, options.reportDir, 'report-dir');
  const inspectReportLinks = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink() && !isInsideProjectRoot(reportDir, fs.realpathSync(file))) throw new Error('report-dir contains an escaping link');
      if (entry.isDirectory() && !entry.isSymbolicLink()) inspectReportLinks(file);
    }
  };
  inspectReportLinks(reportDir);
  const overlap = (left: string, right: string): boolean => isInsideProjectRoot(left, right) || isInsideProjectRoot(right, left);
  const protectedDirs = requestProtectedPaths(root, options.frameworkRoot);
  for (const forbidden of protectedDirs) {
    const actual = fs.existsSync(forbidden) ? fs.realpathSync(forbidden) : path.resolve(forbidden);
    if (overlap(reportDir, actual)) throw new Error(`report-dir overlaps protected directory: ${actual}`);
    if (allowed.some(file => isInsideProjectRoot(actual, realRequestPath(root, file, 'test write')))) throw new Error('test write overlaps a protected directory');
  }
  for (const file of [requestFile, ...[...targets.files, ...targets.tests].map(file => realRequestPath(root, file, 'target'))]) if (overlap(reportDir, file)) throw new Error('report-dir overlaps request/source target');
  const catalog = phaseContractIndex(loadFeatureContracts(options.frameworkRoot)).get(options.phase)!.phase;
  const inputsRaw = object(raw.inputs ?? {}, 'inputs');
  keys(inputsRaw, [...catalog.inputs.map(input => input.id), ...(options.phase === 'review' ? ['review_report'] : [])], 'inputs');
  const inputs: Record<string, string> = {};
  for (const [id, value] of Object.entries(inputsRaw)) {
    if (typeof value !== 'string') throw new Error(`inputs.${id} must be a project-relative file`);
    if (id !== 'review_report' && id !== 'cases' && !catalog.inputs.find(input => input.id === id)?.sources.some(source => source.kind === 'artifact')) throw new Error(`inputs.${id} is derived from targets; it has no file parser`);
    inputs[id] = realRequestPath(root, value, `inputs.${id}`);
  }
  if (options.phase === 'review') {
    inputs.review_report ??= path.join(reportDir, 'review-report.md');
    if (!isInsideProjectRoot(reportDir, inputs.review_report)) throw new Error('review_report must be inside this report-dir');
  }
  const factsPath = path.join(reportDir, 'context', 'facts.md');
  for (const file of [factsPath, ...['summary.json', 'script-report.json', 'review-report.md'].map(name => path.join(reportDir, name))]) {
    if (!isInsideProjectRoot(reportDir, realRequestPath(root, path.relative(root, file), 'report output'))) throw new Error('report output link escapes report-dir');
  }
  for (const file of Object.values(inputs)) if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new Error('input must be a readable file');
  for (const file of Object.values(inputs)) if (['summary.json', 'script-report.json'].some(name => path.join(reportDir, name) === file) || file === factsPath) throw new Error('input overlaps a machine output/facts path');
  const baselineRaw = object(raw.baseline ?? {}, 'baseline'); keys(baselineRaw, ['base', 'head'], 'baseline');
  const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const ref = (value: unknown): string => { if (typeof value !== 'string' || !value.trim()) throw new Error('baseline ref must be nonempty'); return git(['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`]); };
  const baseline = { ...(baselineRaw.base === undefined ? {} : { base: ref(baselineRaw.base) }), head: baselineRaw.head === undefined || baselineRaw.head === 'WORKTREE' ? 'WORKTREE' : ref(baselineRaw.head) };
  const bindings: PreparedRequest['bindings'] = [];
  const sourceContents: PreparedRequest['sourceContents'] = [];
  for (const file of [...new Set([...targets.files, ...targets.tests])]) {
    const absolute = realRequestPath(root, file, 'target');
    const exists = fs.existsSync(absolute);
    const historicalReview = options.phase === 'review' && baseline.head !== 'WORKTREE';
    if (!historicalReview && !exists && !allowed.includes(file)) throw new Error(`target missing: ${file}`);
    if (!historicalReview && exists && !fs.statSync(absolute).isFile()) throw new Error(`target is not a file: ${file}`);
    let bytes = !historicalReview && exists ? fs.readFileSync(absolute) : undefined;
    if (baseline.head !== 'WORKTREE' && !allowed.includes(file)) {
      const committed = execFileSync('git', ['show', `${baseline.head}:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      if (options.phase !== 'review' && !bytes?.equals(committed)) throw new Error(`test target differs from selected head: ${file}`);
      bytes = committed;
    }
    const content = bytes?.toString('utf8');
    if (content !== undefined) sourceContents.push({ path: file, content });
    bindings.push({ path: file, exists: bytes !== undefined, sha256: bytes === undefined ? null : crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  const inputBindings = Object.entries(inputs).filter(([id]) => id !== 'review_report').map(([id, file]) => {
    const exists = fs.existsSync(file); if (exists && !fs.statSync(file).isFile()) throw new Error(`input is not a file: ${id}`);
    return { id, path: path.relative(root, file).replace(/\\/g, '/'), exists, sha256: exists ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null };
  });
  const normalized = { schema_version: '1.0', phase: options.phase, requested_result: raw.requested_result.trim(), targets, baseline, inputs: Object.fromEntries(Object.entries(inputs).map(([id, file]) => [id, path.relative(root, file).replace(/\\/g, '/')])), allowed_test_writes: allowed, report_dir: path.relative(root, reportDir).replace(/\\/g, '/') };
  const request_sha256 = crypto.createHash('sha256').update(stableStringify({ request: normalized, bindings: bindings.filter(binding => !allowed.includes(binding.path)), inputBindings })).digest('hex');
  for (const name of ['summary.json', 'script-report.json']) {
    const file = path.join(reportDir, name);
    if (fs.existsSync(file)) { const prior = JSON.parse(fs.readFileSync(file, 'utf8')); if (prior.subject !== 'request' || prior.request_sha256 !== request_sha256) throw new Error('report-dir belongs to another request/baseline'); }
  }
  const gaps = [...[factsPath, ...Object.values(inputs)].filter(file => !fs.existsSync(file)).map(file => path.relative(root, file).replace(/\\/g, '/')), ...bindings.filter(binding => !binding.exists).map(binding => binding.path)];
  if (options.phase === 'ut' && !targets.tests.length) gaps.push('targets.tests');
  if (options.phase === 'testing' && !inputs.cases) gaps.push('inputs.cases');
  if (fs.existsSync(factsPath) && (parseContextExploration(fs.readFileSync(factsPath, 'utf8')).fm as Record<string, unknown>).request_sha256 !== request_sha256) gaps.push(path.relative(root, factsPath).replace(/\\/g, '/'));
  return { schema_version: '1.0', phase: options.phase as PreparedRequest['phase'], requested_result: raw.requested_result.trim(), request_sha256, requestFile, reportDir, factsPath, targets, baseline, inputs, allowed_test_writes: allowed, bindings, sourceContents, gaps };
}

export interface CapabilityResolutionEntryInputOptions {
  projectRoot: string;
  feature: string;
  phase: string;
  featuresDir: string;
  goalRunId?: string;
  goalAttemptId?: string;
  frameworkRoot?: string;
  explicitAdhocCases?: string;
  requirement?: string;
  requirementSourceFiles?: string[];
  invocation?: { inputContext: PhaseInputContext; factsContext: FactsInvocationContext; requirement?: string; codeTargets?: string[]; testTargets?: string[] };
}

/** Same-attempt runtime admission, never reconstructed from authored facts or a label invocation. */
export function loadFactsInvocationContext(options: {
  projectRoot: string; feature: string; phase: string; runId: string; attemptId?: string; featuresDir?: string;
}): FactsInvocationContext | undefined {
  if (!options.attemptId) return undefined;
  const manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, { feature: options.feature, featuresDir: options.featuresDir });
  const scope = resolveEffectiveScopeSource(options.projectRoot, options.feature, options.runId)?.scope;
  if (!scope?.phase_chain.includes(options.phase)) return undefined;
  const events = eventsWithScopeRevocations(manifest.execution_scope,
    loadAuthoritativeEvents(path.resolve(options.projectRoot, manifest.report_dir, 'events.jsonl')));
  const index = events.map((event, i) => event.type === 'agent_invoke_start' && event.phase === options.phase
    && event.invoke_id === `${options.phase}-${options.attemptId}` ? i : -1).filter(i => i >= 0).pop();
  if (index === undefined || events.slice(index + 1).some(event =>
    (event.type === 'phase_invalidated' && event.phase === options.phase)
    || (event.type === 'phase_backtrack_requested' && Array.isArray((event as { invalidated_phases?: string[] }).invalidated_phases)
      && (event as { invalidated_phases: string[] }).invalidated_phases.includes(options.phase)))) return undefined;
  const context = events[index].facts_context;
  if (!context || !('run_id' in context.subject) || context.subject.feature !== options.feature || context.subject.run_id !== options.runId
    || context.first_phase !== scope.phase_chain[0] || !Array.isArray(context.source_paths)) return undefined;
  return structuredClone(context);
}

/** Existing source ownership and write authorization, shared by admission and the final facts check. */
export function resolveFactsPhaseOwnedSources(options: {
  projectRoot: string; frameworkRoot: string; feature: string; phase: string; runId?: string;
}, context: FactsInvocationContext): Set<string> {
  try {
    const scope = resolveEffectiveScopeSource(options.projectRoot, options.feature, options.runId)?.scope;
    if (!scope?.phase_chain.includes(options.phase)) return new Set();
    const config = loadFrameworkConfig(options.projectRoot);
    const profile = loadResolvedProfile(options.projectRoot, config, options.frameworkRoot);
    const boundary = resolvePhaseWriteBoundary({ ...options, phaseOrder: executionCompletionPhases(scope), track: 'full',
      profileDir: profile.profileDir, productLayerDirs: (config.architecture?.outer_layers ?? []).map(layer => layer.id),
      resolveUtSourceRoots: tryLoadUtSourceRootResolver(profile.profileDir) ?? undefined });
    if (boundary.unresolvedSourcePhases.includes(options.phase)) return new Set();
    return new Set(Object.entries(context.source_owners ?? {}).filter(([source, owner]) => {
      const granted = resolvePhasePathOwnership(boundary, source);
      return owner === options.phase && granted.owner === options.phase && granted.roles.some(role => role.kind === 'source');
    }).map(([source]) => source));
  } catch { return new Set(); }
}

/** Re-admit completed writes or an interrupted phase window, preserving the original admission hashes. */
function loadCompletedFactsBaseline(options: CapabilityResolutionEntryInputOptions, runId: string, frameworkRoot: string): FactsInvocationContext | undefined {
  if (!/^i\d+$/.test(options.goalAttemptId ?? '')) return undefined;
  const manifest = loadGoalManifestFromRun(options.projectRoot, runId, { feature: options.feature, featuresDir: options.featuresDir });
  const scope = resolveEffectiveScopeSource(options.projectRoot, options.feature, runId)?.scope;
  if (!scope?.phase_chain.includes(options.phase)) return undefined;
  const events = eventsWithScopeRevocations(manifest.execution_scope,
    loadAuthoritativeEvents(path.resolve(options.projectRoot, manifest.report_dir, 'events.jsonl')));
  // An existing exact start belongs to the original admission/resume path, including legacy records.
  if (events.some(e => e.type === 'agent_invoke_start' && e.invoke_id === `${options.phase}-${options.goalAttemptId}`)) return undefined;
  let fence = -1;
  for (let i = 0; i < events.length; i++) if ((events[i].type === 'phase_invalidated' && events[i].phase === options.phase)
    || (events[i].type === 'phase_backtrack_requested' && (events[i].to_phase === options.phase
      || ((events[i] as { invalidated_phases?: string[] }).invalidated_phases ?? []).includes(options.phase)))) fence = i;
  const starts = events.map((e, i) => i > fence && e.type === 'agent_invoke_start' && e.phase === options.phase
    && typeof e.invoke_id === 'string' && new RegExp(`^${options.phase}-i\\d+$`).test(e.invoke_id) ? i : -1).filter(i => i >= 0);
  if (!starts.length) return undefined;
  const first = starts[0];
  const context = events[first].facts_context;
  if (!context?.baseline || !Array.isArray(context.baseline.dependencies) || !('run_id' in context.subject) || context.subject.run_id !== runId || context.subject.feature !== options.feature
    || context.first_phase !== scope.phase_chain[0] || !Array.isArray(context.source_paths)) return undefined;
  const factsPath = resolveFactsAbsPath(options.projectRoot, options.feature);
  if (!fs.existsSync(factsPath) || factsBaselineFingerprint(fs.readFileSync(factsPath, 'utf8')) !== context.baseline.fingerprint) return undefined;
  const ownedSources = resolveFactsPhaseOwnedSources({ ...options, frameworkRoot, runId }, context);
  const isOwnedSource = (source: string): boolean => ownedSources.has(source);
  const initial = new Map<string, string | null>();
  for (const dep of context.baseline.dependencies) {
    if (!dep || typeof dep.path !== 'string' || typeof dep.exists !== 'boolean'
      || !(dep.sha256 === null || typeof dep.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(dep.sha256))
      || !isInsideProjectRoot(options.projectRoot, dep.path)) return undefined;
    initial.set(path.relative(options.projectRoot, dep.path).replace(/\\/g, '/'), dep.sha256);
  }
  const chain = new Map(initial);
  const written = new Set<string>();
  let interrupted: FactsInvocationContext | undefined;
  const phaseAdvanced = events.slice(first + 1).some(event => event.type === 'phase_verdict' && event.phase === options.phase && event.action === 'advance');
  const openBounds = new Set(findUnclosedGuardianBounds(events).map(bound => bound.invoke_id));
  for (let n = 0; n < starts.length; n++) {
    const start = events[starts[n]];
    const endIndex = n + 1 < starts.length ? starts[n + 1] : events.length;
    const segment = events.slice(starts[n] + 1, endIndex);
    const prior = start.facts_context;
    const ended = segment.findIndex(e => e.type === 'agent_invoke_end' && e.invoke_id === start.invoke_id);
    if (!prior?.baseline || stableStringify(prior.baseline) !== stableStringify(context.baseline)
      || !('run_id' in prior.subject) || prior.subject.run_id !== runId || prior.subject.feature !== options.feature
      || prior.first_phase !== context.first_phase || openBounds.has(start.invoke_id!)
      || segment.some(e => e.type === 'phase_write_violation' && e.invoke_id === start.invoke_id)) return undefined;
    if (ended < 0) {
      if (phaseAdvanced) return undefined;
      interrupted = prior;
      for (const [source, owner] of Object.entries(prior.source_owners ?? {})) if (owner === options.phase) written.delete(source);
      continue;
    }
    for (const event of segment.slice(ended + 1)) {
      if (event.type !== 'phase_write_observed' || event.phase !== options.phase || event.invoke_id !== start.invoke_id) continue;
      const owned = (event as { owned?: unknown }).owned;
      if (!Array.isArray(owned)) continue;
      for (const row of owned) {
        if (!row || typeof row.path !== 'string') return undefined;
        let source: string;
        try { source = path.posix.normalize(validateProjectRelativePath(options.projectRoot, row.path, 'facts write source')); } catch { return undefined; }
        if (!isOwnedSource(source)) continue;
        if (prior.source_owners?.[source] !== options.phase || typeof row.post_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(row.post_sha256)
          || !(row.pre_sha256 === null || typeof row.pre_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(row.pre_sha256))) return undefined;
        // A later real observation may bridge the write lost by the interrupted
        // invocation. Once observed, its post hash is strict again.
        if (chain.has(source) && chain.get(source) !== row.pre_sha256
          && (interrupted?.source_owners?.[source] !== options.phase || written.has(source))) return undefined;
        chain.set(source, row.post_sha256); written.add(source);
      }
    }
  }
  const changed = new Set<string>();
  for (const dep of context.baseline.dependencies) {
    const source = path.relative(options.projectRoot, dep.path).replace(/\\/g, '/');
    const current = sha256File(dep.path);
    if (current === dep.sha256 && fs.existsSync(dep.path) === dep.exists) continue;
    if (!isOwnedSource(source) || !current) return undefined;
    if ((interrupted?.source_owners?.[source] !== options.phase || written.has(source)) && (!written.has(source) || chain.get(source) !== current)) return undefined;
    changed.add(source);
  }
  for (const source of written) if (sha256File(path.join(options.projectRoot, source)) !== chain.get(source)) return undefined;
  if (!changed.size && !interrupted) return undefined;
  const evidence = loadPhaseEvidenceManifest(options.projectRoot, options.feature, context.baseline.established_by);
  const requirement = options.requirement ?? manifest.requirement;
  const freshness = recomputePhaseEvidenceStaleness(options.projectRoot, options.feature, [context.baseline.established_by], { frameworkRoot,
    pendingOwnerPaths: [...changed],
    ...(typeof requirement === 'string' ? { currentRequirementSha: computeRequirementShaFromText(options.projectRoot, options.feature, requirement, options.featuresDir) } : {}) })[0];
  if (!evidence?.integrityOk || !freshness || !['fresh', 'stale'].includes(freshness.verdict) || freshness.receipt_changed
    || freshness.propagated_from || freshness.integrity_errors?.length
    || freshness.changed_paths.some(source => !changed.has(source))) return undefined;
  return structuredClone(context);
}

export interface CapabilityResolutionEntryInput {
  /** Admission found no reusable facts; the responsible phase must read these current sources and establish facts. */
  factsRebuildReason?: string;
  goalRunId?: string;
  inputContext?: PhaseInputContext;
  factsContext?: FactsInvocationContext;
  codeTargets?: string[];
  testTargets?: string[];
  requirement?: string;
  /** plan c4e8a1f7 T2：goal manifest 冻结的 requirement source 列表（共享发现集合输入）。 */
  requirementSourceFiles?: string[];
  adhocCases?: string;
}

/**
 * The resolver receives only normalized, identity-bound entry input. Goal mode reads
 * the canonical run manifest; direct testing may provide an explicit adhoc fallback.
 */
export function resolveCapabilityResolutionEntryInput(
  options: CapabilityResolutionEntryInputOptions,
): CapabilityResolutionEntryInput {
  if (options.invocation) {
    const { inputContext, factsContext, requirement, codeTargets, testTargets } = options.invocation;
    const subject = inputContext.subject;
    if ('feature' in subject ? subject.feature !== options.feature : !!options.feature || !/^[0-9a-f]{64}$/.test(subject.request_sha256)) {
      throw new Error('capability entry subject mismatch');
    }
    const factsSubject = factsContext.subject;
    if ('feature' in subject
      ? !('feature' in factsSubject) || factsSubject.feature !== subject.feature
      : !('request_sha256' in factsSubject) || factsSubject.request_sha256 !== subject.request_sha256) throw new Error('capability/facts subject mismatch');
    if ([...(codeTargets ?? []), ...(testTargets ?? [])].some(target => !factsContext.source_paths.includes(target))) throw new Error('facts do not cover explicit request targets');
    if (options.goalRunId) {
      const manifest = loadGoalManifestFromRun(options.projectRoot, options.goalRunId, { feature: options.feature, featuresDir: options.featuresDir });
      if (!('run_id' in factsSubject) || factsSubject.run_id !== options.goalRunId) throw new Error('facts run identity mismatch');
      if (!factsContext.baseline && manifest.phase_chain?.[0] !== factsContext.first_phase) throw new Error('facts establishing phase differs from frozen run');
      if (requirement !== undefined && requirement.trim() !== manifest.requirement?.trim()) throw new Error('explicit requirement differs from frozen run');
    }
    return { inputContext, factsContext, requirement, codeTargets, testTargets, adhocCases: options.explicitAdhocCases };
  }
  let requirement = options.requirement;
  let requirementSourceFiles = options.requirementSourceFiles;
  const goalRunId = options.goalRunId?.trim();
  // D1 §6.4：外层条件从「有 run」放开为「有 run 或有 feature 冻结记录」。来源由**统一入口**选，
  // 这里不自己判断 run/feature。requirement 只有 run 载体才有（它来自 manifest）。
  const authority = resolveEffectiveScopeSource(options.projectRoot, options.feature, goalRunId);
  if (goalRunId || authority?.source === 'feature') {
    if (goalRunId) {
      const manifest = loadGoalManifestFromRun(options.projectRoot, goalRunId, {
        feature: options.feature,
        featuresDir: options.featuresDir,
      });
      requirement = manifest.requirement?.trim() || undefined;
      requirementSourceFiles = manifest.requirement_source_files;
    }
    const scope = authority?.scope;
    if (scope) {
      const frameworkRoot = options.frameworkRoot ?? path.resolve(__dirname, '../../..');
      const contractIndex = phaseContractIndex(loadFeatureContracts(frameworkRoot));
      const indexed = contractIndex.get(options.phase);
      if (indexed?.contract.schema_version !== '1.1') throw new Error('execution scope requires phase contract 1.1');
      const ownsDesignOutput = (binding: import('./capability-resolution').InputBinding): boolean => phaseOwnsDesignOutput(indexed.phase.produces, scope, options.phase, binding);
      const expectedBindings = scope.obligations.flatMap(obligation => [
        ...obligation.basis.filter(binding => !binding.dependencies.length || !binding.dependencies.every(dep => isExecutionSourceBasis(options.projectRoot, scope, obligation, dep))),
        ...(obligation.satisfied_by ?? []).filter(ref => 'input_id' in ref),
      ]);
      // §5.1.1a R-target collection: a `design-decision` / `acceptance-definition` derive basis is
      // the historical file that TRIGGERED a revision, not a current target of any phase. Collecting
      // it here re-enters it into `factsContext.source_paths` / `testTargets` and the phase evidence,
      // so withdrawing that edit would make the responsible phase stale again (review B4). Every
      // other kind's derive basis stays — those ARE the current review / UT / implementation targets.
      const sourcePaths = [...new Set(scope.obligations
        .filter(obligation => !REVISION_TRIGGER_KINDS.has(obligation.kind))
        .flatMap(obligation => obligation.basis.flatMap(binding => binding.dependencies
          .filter(dep => dep.role === 'derive' && dep.exists)
          .map(dep => path.relative(options.projectRoot, resolveDependencyPath(options.projectRoot, dep.path, inferLegacyProjectRoot(options.projectRoot, scope))).replace(/\\/g, '/')))))];
      if (options.phase === 'review' && scope.obligations.some(obligation => obligation.kind === 'implementation' && obligation.applicability === 'required')) {
        const contracts = readRunBoundContracts(options.projectRoot, frameworkRoot, options.feature, goalRunId);
        // G5：基线走统一来源选择（无 run 时是既有 HARNESS_DIFF_BASE_REF 三态，不是 FAIL）
        const baseline = resolveEffectiveDiffBaseline(options.projectRoot, options.feature, goalRunId);
        if (!baseline.available) throw new Error(baseline.reason);
        const diff = diffChangedFilesWithStatus({ projectRoot: options.projectRoot, baseRef: baseline.baseSha });
        if (!diff.executed) throw new Error(diff.error ?? 'review diff unavailable');
        for (const entry of diff.entries) if (entry.status !== 'D' && contracts.files?.includes(entry.path) && !sourcePaths.includes(entry.path)) sourcePaths.push(entry.path);
      }
      const factsContext: FactsInvocationContext = {
        // G3：facts 身份位按载体二分——run 载体绑 run_id，feature 载体绑 feature（指纹在 facts 侧校验）。
        subject: goalRunId ? { feature: options.feature, run_id: goalRunId } : { feature: options.feature },
        ...(goalRunId ? {} : { frozen_scope_fingerprint: executionScopeFingerprint(scope) }),
        first_phase: scope.phase_chain[0],
        source_paths: sourcePaths, required_input_snippets: [],
      };
      const admitted = goalRunId ? loadFactsInvocationContext({ projectRoot: options.projectRoot, feature: options.feature,
        phase: options.phase, runId: goalRunId, attemptId: options.goalAttemptId, featuresDir: options.featuresDir })
        ?? loadCompletedFactsBaseline(options, goalRunId, frameworkRoot) : undefined;
      if (admitted) {
        Object.assign(factsContext, admitted);
        for (const source of admitted.source_paths) if (!sourcePaths.includes(source)) sourcePaths.push(source);
      }
      const factsPath = resolveFactsAbsPath(options.projectRoot, options.feature);
      let factsRebuildReason: string | undefined;
      if (!admitted && fs.existsSync(factsPath)) {
        try {
        const raw = fs.readFileSync(factsPath, 'utf8');
        const { fm, error } = parseContextExploration(raw);
        if (error) throw new Error(`facts input invalid: ${error}`);
        if (fm.feature !== options.feature) throw new Error('facts input identity mismatch: feature');
        const record = fm as Record<string, unknown>;
        if (record.request_sha256 !== undefined || (goalRunId && record.frozen_scope_fingerprint !== undefined)) throw new Error('facts input identity mismatch: subject');
        const establishing = (fm as Record<string, unknown>).established_by;
        const currentResearch = establishing === options.phase && options.phase === scope.phase_chain[0]
          && (goalRunId ? record.run_id === goalRunId : record.frozen_scope_fingerprint === executionScopeFingerprint(scope));
        if (currentResearch) {
          // Current first-phase Research may exist before its first closure manifest; it is not a reusable predecessor baseline.
          const declared = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((source): source is string => typeof source === 'string') : [];
          const normalized = declared.map(source => path.posix.normalize(validateProjectRelativePath(options.projectRoot, source, 'facts source')));
          if (new Set(normalized).size !== normalized.length) throw new Error('facts source paths contain duplicates');
          for (const source of normalized) {
            assertFactsSourceReadable(options.projectRoot, source);
            if (!sourcePaths.includes(source)) sourcePaths.push(source);
          }
        }
        if (typeof establishing === 'string') {
          const evidenceChain = [establishing, ...scope.phase_chain.filter(phase => phase !== establishing)];
          const evidence = loadPhaseEvidenceManifest(options.projectRoot, options.feature, establishing);
          // Independent feature entry retains its existing in-progress source semantics. Only
          // current owned source paths within the existing write boundary can be pending.
          const pendingOwnerPaths = !goalRunId && evidence?.integrityOk
            ? [...resolveFactsPhaseOwnedSources({ ...options, frameworkRoot }, { ...factsContext,
              source_owners: Object.fromEntries([...evidence.manifest.inputs, ...evidence.manifest.outputs]
                .filter(entry => entry.owner_phase === options.phase && entry.exists && sha256File(path.join(options.projectRoot, entry.path)))
                .map(entry => [entry.path, options.phase])) })] : [];
          const fresh = recomputePhaseEvidenceStaleness(options.projectRoot, options.feature, evidenceChain, { frameworkRoot,
            ...(pendingOwnerPaths.length ? { pendingOwnerPaths } : {}),
            ...(requirement ? { currentRequirementSha: computeRequirementShaFromText(options.projectRoot, options.feature, requirement, options.featuresDir) } : {}) })
            .find(result => result.phase === establishing);
          if (fresh?.verdict !== 'fresh' || !evidence?.integrityOk) {
            if (evidence || !currentResearch) {
              factsRebuildReason = `facts baseline stale: return to ${scope.phase_chain[0]} to establish current facts; changed sources: ${(fresh?.changed_paths ?? []).join(', ') || fresh?.verdict || 'missing'}`;
              if (options.phase !== scope.phase_chain[0]) throw new Error(factsRebuildReason);
            }
          } else {
            const paths = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((p): p is string => typeof p === 'string') : [];
            factsContext.baseline = { established_by: establishing, fingerprint: factsBaselineFingerprint(raw), dependencies: [...evidence.manifest.inputs, ...evidence.manifest.outputs].filter(entry => entry.facts_phase === undefined
              && (paths.includes(entry.path) || (entry.role === 'input' && entry.owner_phase !== options.phase))).map(entry => {
              const ownerEvidence = entry.owner_phase && entry.owner_phase !== establishing
                ? loadPhaseEvidenceManifest(options.projectRoot, options.feature, entry.owner_phase) : null;
              const owner = ownerEvidence?.integrityOk && recomputePhaseEvidenceStaleness(options.projectRoot, options.feature, [entry.owner_phase!], { frameworkRoot })[0]?.verdict === 'fresh'
                ? ownerEvidence.manifest.outputs.find(output => output.path === entry.path && output.owner_phase === entry.owner_phase) : undefined;
              const abs = path.join(options.projectRoot, entry.path);
              // plan c4e7a9b2 B2：身份中立条目存的是摘要；等价成立时基线依赖按当前字节登记（下游按字节核对）。
              const recorded = owner ?? entry;
              const neutralCurrent = recorded.identity_neutral !== undefined && evidenceEntryMatchesCurrentFile(options.projectRoot, recorded, options.feature);
              return neutralCurrent
                ? { path: abs, exists: fs.existsSync(abs), sha256: sha256File(abs), role: 'derive' }
                : { path: abs, exists: owner?.exists ?? entry.exists, sha256: owner?.sha256 ?? entry.sha256, role: 'derive' };
            }) };
            const configPath = path.join(options.projectRoot, 'framework.config.json');
            if (!factsContext.baseline.dependencies.some(dep => path.resolve(dep.path) === path.resolve(configPath))) {
              factsContext.baseline.dependencies.push({ path: configPath, exists: evidence.manifest.environment.framework_config_sha256 !== null,
                sha256: evidence.manifest.environment.framework_config_sha256, role: 'derive' });
            }
            for (const source of paths) {
              const safe = validateProjectRelativePath(options.projectRoot, source, 'facts source');
              const abs = path.join(options.projectRoot, safe);
              if (!factsContext.baseline.dependencies.some(dep => dep.exists && dep.sha256 && path.resolve(dep.path) === path.resolve(abs))) {
                // plan e7a2c4f1 §3.4（G01）：这是账本类缺口——facts 声明的来源没进阶段证据
                // 登记，事后追溯弱一级，产品不受影响。声明来源在项目内且可读 → **补登记**
                // （只加一条 dependency，不改任何已绑定条目的内容）；补不了（不可读）就什么
                // 都不做，交给 context-facts 的既有 `context_exploration_facts_source_stale`
                // 以 WARN 披露，不再整轮抛错。
                let readable = true;
                try { assertFactsSourceReadable(options.projectRoot, safe); } catch { readable = false; }
                const sha = readable ? sha256File(abs) : null;
                if (sha) factsContext.baseline.dependencies.push({ path: abs, exists: true, sha256: sha, role: 'derive' });
              }
              if (!sourcePaths.includes(safe)) sourcePaths.push(safe);
            }
          }
        }
        } catch (error) {
          const reason = (error as Error).message;
          if (options.phase !== scope.phase_chain[0]) throw new Error(reason.startsWith('facts ') ? reason : `facts input invalid: ${reason}`);
          factsRebuildReason = `Establish current facts from the actual source files: ${reason}`;
          delete factsContext.baseline;
        }
      }
      if (factsRebuildReason && goalRunId && options.goalAttemptId && !admitted) {
        const manifest = loadGoalManifestFromRun(options.projectRoot, goalRunId, { feature: options.feature, featuresDir: options.featuresDir });
        const alreadyInvoked = loadAuthoritativeEvents(path.resolve(options.projectRoot, manifest.report_dir, 'events.jsonl'))
          .some(event => event.type === 'agent_invoke_start' && event.phase === options.phase && event.invoke_id === `${options.phase}-${options.goalAttemptId}`);
        // A validation-only legacy window cannot establish facts without a new responsible executor.
        if (alreadyInvoked) throw new Error(factsRebuildReason.startsWith('facts ') ? factsRebuildReason : `facts baseline stale: ${factsRebuildReason}`);
      }
      let contractFiles: string[] = [];
      let contractModules: Array<{ name: string; package_path: string }> = [];
      const producesContracts = indexed.phase.produces.some(output => output.artifact === 'contracts@1');
      const currentContracts = new SpecLoader(options.projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(options.feature).contracts;
      try {
        let contracts: import('./types').ContractsSpec;
        try {
          contracts = readRunBoundContracts(options.projectRoot, frameworkRoot, options.feature, goalRunId);
        } catch (error) {
          if (!producesContracts) throw error;
          if (!currentContracts) throw error;
          contracts = currentContracts;
        }
        contractFiles = (contracts.files ?? []).map(file => validateProjectRelativePath(options.projectRoot, file, 'contracts.files'));
        contractModules = (contracts.modules ?? []).map(module => ({ name: module.name, package_path: module.package_path }));
      } catch {
        // A missing construction binding is the plan-owned definition gap already carried by scope.
      }
      if (contractModules.length === 0 && currentContracts) {
        contractModules = (currentContracts.modules ?? []).map(module => ({ name: module.name, package_path: module.package_path }));
      }
      let testRoots: string[] = [];
      let testPathPatterns: RegExp[] = [];
      // 宿主自己声明的「什么算源码」——与 check-coding.ts:718 / correction-commands.ts:483 同一个
      // 判据，不另立路径表。未声明（generic 等无 coding host 的 profile）即空集：那种工程没法
      // 区分源码与文档，归属侧按 fail-safe 处理——不盖 owner，漂移照旧 stale。
      let sourceFileSuffixes: readonly string[] = [];
      try {
        const profile = loadResolvedProfile(options.projectRoot, loadFrameworkConfig(options.projectRoot), frameworkRoot);
        testRoots = (tryLoadUtSourceRootResolver(profile.profileDir)?.(options.projectRoot, contractModules) ?? []).map(root => path.resolve(root));
        testPathPatterns = tryLoadDiffExcludeTestPathRegexes(profile.profileDir) ?? [];
        sourceFileSuffixes = tryLoadProfileCodingHost(profile.profileDir)?.sourceFileSuffixes ?? [];
      } catch {
        // Minimal/custom framework fixtures without profile modules have no profile-owned UT roots.
      }
      // 源码判据只有一条，且不是新表：profile 声明的源码后缀，与 `check-coding.ts:718` /
      // `correction-commands.ts:483` **逐字同法**（同样的 `.` 归一 + 大小写敏感 `endsWith`）。
      // **不以「落在模块包路径内」兜底**：模块根下本来就常驻非源码文件（生产检查直接读
      // `<package_path>/oh-package.json5`，见 `profiles/hmos-app/harness/coding-host-rules.ts` 与
      // `profile-path-conventions.ts`），拿目录当源码判据会把 README / 清单一并归给实现阶段。
      // 后缀不认的路径就不是源码：`contracts.files` 只被 schema 约束为非空字符串
      //（`contracts.schema.yaml:49`）、`contract-reference-closure.ts:36` 只做路径规范化，
      // 所以写集里**同样可能**出现文档/清单，它们不得拿到实现阶段归属。
      const normalizedSuffixes = sourceFileSuffixes.map(suffix => (suffix.startsWith('.') ? suffix : `.${suffix}`));
      const isHostSourceFile = (relative: string): boolean =>
        normalizedSuffixes.some(suffix => relative.endsWith(suffix));
      const isTestPath = (relative: string): boolean => testRoots.some(root => isInsideProjectRoot(root, path.resolve(options.projectRoot, relative)))
        || testPathPatterns.some(pattern => pattern.test(`/${relative.replace(/\\/g, '/')}`));
      const usesConstructionTargets = indexed.phase.inputs.some(input => input.id === 'contracts') && !producesContracts;
      const consumes = (providerId: string): boolean => indexed.phase.inputs.some(input => input.sources.some(source => source.kind === 'derive' && source.provider_id === providerId));
      const codeTargets = [...new Set([
        ...sourcePaths.filter(source => !isTestPath(source)),
        ...(usesConstructionTargets ? contractFiles.filter(file => !isTestPath(file) && (fs.existsSync(path.resolve(options.projectRoot, file)) || !['spec', 'plan', 'coding'].includes(options.phase))) : []),
      ])];
      const partitionedTestTargets = [...new Set([
        ...sourcePaths.filter(isTestPath),
        ...(usesConstructionTargets ? contractFiles.filter(file => isTestPath(file) && (fs.existsSync(path.resolve(options.projectRoot, file)) || !['spec', 'plan', 'coding', 'ut'].includes(options.phase))) : []),
      ])];
      const testTargets = consumes('derive.test-targets') ? partitionedTestTargets : [];
      const ownerOf = (kind: string, sourceId: string): string | undefined => scope.obligations.find(obligation => obligation.kind === kind)?.owner_phase
        ?? [...contractIndex].find(([, value]) => value.phase.produces.some(output => output.kind === 'source' && output.id === sourceId))?.[0];
      const codeOwner = ownerOf('implementation', 'implementation');
      const testOwner = ownerOf('unit-evidence', 'ut_source_and_dag');
      const phaseIndex = scope.phase_chain.indexOf(options.phase);
      const mayAdvance = (owner: string | undefined): owner is string => !!owner && (
        owner === options.phase
        || (phaseIndex >= 0 && scope.phase_chain.indexOf(owner) > phaseIndex)
        || producesContracts
        // 观察期（出生链只有 spec/plan）：owner 阶段**还没进链**，`indexOf` 恒为 -1，上面三条
        // 全不成立 → 研究源码一个 owner 都盖不上，coding 一改就把 spec/plan 判 stale
        // （plan b5c1e9d7 §2 C）。资格只取冻结范围自己的字段，两个条件缺一不可：
        //   · owner 不在链里——**方向约束的替代品**。缺了它，coding 已闭环而此后无范围修订时
        //     `satisfied_by` 仍为空，review 会拿到上游 coding owner（P1-T12 断言此时必须无 owner）。
        //   · 范围里确有该 owner 的未兑现 required 义务——即「阶段暂被定义缺口挡住」的既有表示。
        //     **不是**「owner 非空」：无实现义务时 `ownerOf` 回落契约 producer 恒非空，那等于全放行。
        || (!scope.phase_chain.includes(owner) && scope.obligations.some(obligation =>
          obligation.owner_phase === owner
          && obligation.applicability === 'required'
          && !obligation.satisfied_by?.length))
      );
      const inventory = loadArtifactInventory(frameworkRoot);
      const requiredOutputs = indexed.phase.produces.flatMap(output => inventory.artifacts.find(artifact => artifact.id === output.artifact)?.paths ?? []).filter(name => {
        const base = path.basename(name);
        if (options.phase === 'ut' && base === 'mock-plan.yaml') return resolveFeatureArtifact(options.projectRoot, options.feature, name).exists;
        if (!['spec', 'plan'].includes(options.phase)) return true;
        if (base === 'spec.md' || base === 'plan.md') return scope.requested_results.includes(name) || scope.requested_results.includes(base);
        if (base === 'use-cases.yaml') return resolveFeatureArtifact(options.projectRoot, options.feature, name).exists;
        if (['ui-spec.yaml', 'ref-elements.yaml', 'asset-manifest.yaml', 'visual-parity.yaml'].includes(base)) return scope.obligations.some(obligation => obligation.kind === 'visual-evidence' && obligation.applicability === 'required');
        return true;
      });
      const obligations: PhaseInputContext['obligations'] = {};
      for (const obligation of scope.obligations) {
        const previous = obligations[obligation.kind];
        obligations[obligation.kind] = previous === 'required' || obligation.applicability === 'required' ? 'required'
          : previous === 'unknown' || obligation.applicability === 'unknown' ? 'unknown' : 'not_applicable';
      }
      const establishingResearch = !factsContext.baseline && factsContext.first_phase === options.phase ? sourcePaths : [];
      factsContext.source_paths = [...new Set([
        ...establishingResearch.filter(file => fs.existsSync(path.resolve(options.projectRoot, file))),
        ...(consumes('derive.codebase') ? codeTargets : []).filter(file => fs.existsSync(path.resolve(options.projectRoot, file))),
        ...(consumes('derive.test-targets') ? testTargets : []).filter(file => fs.existsSync(path.resolve(options.projectRoot, file))),
      ])];
      if (admitted && !admitted.baseline && factsContext.first_phase === options.phase && fs.existsSync(factsPath)) {
        const { fm, error } = parseContextExploration(fs.readFileSync(factsPath, 'utf8'));
        const record = fm as Record<string, unknown>;
        if (!error && fm.feature === options.feature && record.run_id === goalRunId && record.established_by === options.phase
          && fm.schema_version === '1.1' && record.request_sha256 === undefined && record.frozen_scope_fingerprint === undefined) {
          for (const source of Array.isArray(fm.source_code_paths) ? fm.source_code_paths : []) {
            const safe = validateProjectRelativePath(options.projectRoot, source, 'facts source');
            assertFactsSourceReadable(options.projectRoot, safe);
            if (!factsContext.source_paths.includes(safe)) factsContext.source_paths.push(safe);
            if (!sourcePaths.includes(safe)) sourcePaths.push(safe);
          }
        }
      }
      const historical = new Set(sourcePaths);
      const owners: Array<readonly [string, string]> = [];
      // 集合与紧邻的测试分支同形（`contractFiles ∪ sourcePaths`）：spec 跑在 contracts 产出之前，
      // 只遍历 contractFiles 时它是空集，研究源码于是一条都盖不上归属（plan b5c1e9d7 §2 C）。
      // 内层判据不动——`sourcePaths ⊆ historical`，契约文件的原条件逐字保留。
      // **并集两半都要过同一个源码判据**：合格 facts 的 `source_code_paths` 允许含
      // `doc/module-catalog.yaml` / `framework.config.json` 这类非源码研究来源，写集
      // （`contracts.files`）同样只被约束为字符串路径——任一侧混进非源码路径，盖上实现阶段
      // owner 就会让它的字节漂移在施工期被整批豁免跳过（消费点 `phase-evidence-manifest.ts:907`），
      // 与「需求、contracts 与其它非源码输入不适用此承接规则」相悖。
      if (mayAdvance(codeOwner)) for (const file of [...new Set([...contractFiles, ...sourcePaths])].filter(file => !isTestPath(file) && isHostSourceFile(file))) {
        if (codeOwner === options.phase || historical.has(file)) owners.push([file, codeOwner]);
      }
      if (mayAdvance(testOwner)) for (const file of [...new Set([...contractFiles.filter(isTestPath), ...sourcePaths.filter(isTestPath)])]) {
        if (testOwner === options.phase || historical.has(file)) owners.push([file, testOwner]);
      }
      factsContext.source_owners = Object.fromEntries(owners);
      if (admitted) {
        for (const [source, owner] of Object.entries(factsContext.source_owners)) {
          if (owner === options.phase && admitted.source_owners?.[source] !== owner) delete factsContext.source_owners[source];
        }
      }
      if (!admitted && factsContext.baseline) {
        const evidence = loadPhaseEvidenceManifest(options.projectRoot, options.feature, factsContext.baseline.established_by);
        if (evidence?.integrityOk) for (const source of factsContext.source_paths) {
          if (factsContext.source_owners[source] !== options.phase || factsContext.baseline.dependencies.some(dep => path.resolve(dep.path) === path.resolve(options.projectRoot, source))) continue;
          const recorded = [...evidence.manifest.inputs, ...evidence.manifest.outputs].find(entry => entry.path === source && entry.owner_phase === options.phase && entry.exists && entry.sha256);
          if (recorded) factsContext.baseline.dependencies.push({ path: path.resolve(options.projectRoot, source), exists: recorded.exists, sha256: recorded.sha256, role: 'derive' });
        }
      }
      return { requirement, requirementSourceFiles, codeTargets, testTargets, factsContext, ...(factsRebuildReason ? { factsRebuildReason } : {}),
        inputContext: { schema_version: '1.1', subject: { feature: options.feature },
          obligations,
          expected_bindings: expectedBindings.map(binding => options.phase === 'testing' && binding.input_id === 'acceptance' ? { ...binding, input_id: 'cases' } : binding).filter(binding => !ownsDesignOutput(binding) && indexed.phase.inputs.some(input => input.id === binding.input_id)),
          required_outputs: requiredOutputs,
        } };
    }
  }
  const explicitAdhocCases = options.explicitAdhocCases?.trim() || '';
  return {
    ...(goalRunId ? { goalRunId } : {}),
    ...(requirement ? { requirement } : {}),
    ...(requirementSourceFiles && requirementSourceFiles.length > 0
      ? { requirementSourceFiles }
      : {}),
    ...(explicitAdhocCases ? { adhocCases: explicitAdhocCases } : {}),
  };
}
