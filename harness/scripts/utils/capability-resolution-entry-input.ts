import type { IdentityNeutralDigestReaders } from './identity-neutral-digest';
// ============================================================================
// capability-resolution-entry-input.ts — goal/CLI input bridge for pre-check resolution
// ============================================================================

import type { PhaseInputContext } from './capability-resolution';
import { isExecutionSourceBasis, executionCompletionPhases } from './execution-scope';
import type { FactsInvocationContext } from './context-facts';
import { loadGoalManifestFromRun, resolveRequirementInput } from './goal-manifest';
import { featureRequirementBinding } from './feature-track';
import type { WorkflowSpec } from '../../workflow-loader';
import * as fs from 'fs';
import * as path from 'path';
import { resolveEffectiveScopeSource, eventsWithScopeRevocations } from './goal-run-creation';
import { loadAuthoritativeEvents } from './goal-runner-phase';
import { executionScopeFingerprint } from './execution-scope';
import { loadFeatureContracts, phaseContractIndex, loadArtifactInventory, phaseOwnsDesignOutput } from './skill-contract';
import { resolveFactsAbsPath, factsBaselineFingerprint } from './context-facts';
import { assertFactsSourceReadable, parseContextExploration } from './context-exploration';
import { evidenceEntryMatchesCurrentFile, loadPhaseEvidenceManifest, sha256File } from './phase-evidence-manifest';
import { loadFrameworkConfig, resolveFeatureArtifact, relFeaturesDir } from '../../config';
import { featuresDirPath, enumerateFeatures, featureFilePath, receiptDirPath, featurePhaseReportsDir } from '../../config';
import { validateProjectRelativePath, isInsideProjectRoot, inferLegacyProjectRoot, resolveDependencyPath } from './project-relative-path';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import { stableStringify } from './phase-evidence-manifest';
import { readBoundInput, readRunBoundContracts, projectSourceFileBinding } from './capability-resolution';
import { loadResolvedProfile } from '../../profile-loader';
import { dispatchRequestTargetProbe } from '../../capability-registry';
import { tryLoadDiffExcludeTestPathRegexes, tryLoadProfileCodingHost, tryLoadUtSourceRootResolver } from '../../profile-host-loader';
import { SpecLoader } from './spec-loader';
import { findUnclosedGuardianBounds } from './goal-containment-reconcile';
import { resolvePhaseWriteBoundary, resolvePhasePathOwnership } from './phase-write-boundary';
import { workUnitMayWritePath } from './repair-responsibility';
import { invocationCompleted } from './invocation-completion';
import { deriveBlueprintSkillInput } from './blueprint-skill-projection';
import { compareRequestContent, readRequestRevision } from './content-impact';
import { computeGateFingerprint } from './gate-fingerprint';
import type { CheckResult } from './types';
import type { InputBinding } from './capability-resolution';
import { readRequestExecutionInputs, type RequestBuildArtifact, type RequestExecutionInputs } from './request-execution-inputs';

/** Revision-trigger kinds: historical evidence for why a revision happened, never a current target. */
const REVISION_TRIGGER_KINDS = new Set(['design-decision', 'acceptance-definition']);

export interface PreparedRequestInput {
  schema_version: '1.0';
  phase: 'review' | 'ut' | 'testing' | 'component-design';
  requested_result: string;
  request_sha256: string;
  legacy_request_sha256?: string;
  comparison_gap?: string;
  requestFile: string;
  reportDir: string;
  factsPath: string;
  targets: { files: string[]; tests: string[] };
  test_registrations?: string[];
  baseline: { base?: string; head: string };
  inputs: Record<string, string>;
  allowed_test_writes: string[];
  bindings: Array<{ path: string; exists: boolean; sha256: string | null }>;
  sourceContents: Array<{ path: string; content: string; before?: string }>;
  gaps: string[];
  intake_context?: import('./request-intake').RequestIntake;
  origin_gap?: string;
  requirement_sources?: string[];
  origin_request?: string;
  blueprint?: { ref: import('./component-blueprint-model').ComponentBlueprintRef; acceptance_ids: string[] };
}
export type PreparedRequest = Omit<PreparedRequestInput, 'phase'> & { phase: 'review' | 'ut' | 'testing' };

export { realProjectPath as realRequestPath } from './project-relative-path';
import { realProjectPath as realRequestPath } from './project-relative-path';

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

export function prepareRequestInput(options: { projectRoot: string; frameworkRoot: string; phase: string; requestFile: string; reportDir: string; allowPlannedTargets?: boolean }): PreparedRequestInput {
  const root = fs.realpathSync(options.projectRoot);
  const requestFile = realRequestPath(root, options.requestFile, 'request-file');
  const raw = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as Record<string, unknown>;
  const object = (value: unknown, label: string): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>; };
  const keys = (value: Record<string, unknown>, allowed: string[], label: string): void => { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`); };
  object(raw, 'request'); keys(raw, ['schema_version', 'phase', 'requested_result', 'targets', 'baseline', 'inputs', 'allowed_test_writes', 'intake_context', 'origin_gap', 'requirement_sources', 'origin_request', 'blueprint', 'design_target'], 'request');
  if (raw.origin_gap !== undefined && (typeof raw.origin_gap !== 'string' || !raw.origin_gap.trim() || raw.intake_context !== undefined)) throw new Error('origin_gap只表示无法定位原生来源的局部请求');
  let intake: import('./request-intake').RequestIntake | undefined;
  let submitted: import('./request-intake').RequestIntake | undefined;
  let originGap = raw.origin_gap as string | undefined;
  if (raw.intake_context !== undefined) {
    submitted = object(raw.intake_context, 'intake_context') as unknown as import('./request-intake').RequestIntake;
    const { readRequestIntake } = require('./request-intake') as typeof import('./request-intake');
    try {
      intake = readRequestIntake({ projectRoot: root, frameworkRoot: options.frameworkRoot, sessionRef: submitted.session_ref,
        explicitTargets: submitted.explicit_targets, previous: submitted });
    } catch (error) {
      if (!/ENOENT|暂不可读|没有可读原件定位|不在已配置客户端的原生存储内|项目身份|定位的真实 user/i.test(String(error))) throw error;
      originGap = `原生用户原件暂不可用：${String(error)}`;
    }
  }
  const design = options.phase === 'component-design';
  if (raw.design_target !== undefined) {
    if (!design || typeof raw.design_target !== 'string') throw new Error('design_target requires a project-relative component design path');
    realRequestPath(root, raw.design_target, 'design_target');
  }
  if (raw.schema_version !== '1.0' || !['review', 'ut', 'testing', 'component-design'].includes(String(raw.phase)) || raw.phase !== options.phase) throw new Error('request/CLI phase mismatch or unsupported request');
  if (typeof raw.requested_result !== 'string' || !raw.requested_result.trim()) throw new Error('requested_result is required');
  const list = (value: unknown, label: string): string[] => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be a path array`);
    const paths = value.map(item => path.relative(root, realRequestPath(root, item, label)).replace(/\\/g, '/'));
    if (new Set(paths).size !== paths.length) throw new Error(`${label}: duplicate target`);
    return paths.sort();
  };
  const targetsRaw = object(raw.targets, 'targets'); keys(targetsRaw, ['files', 'tests'], 'targets');
  const requestedTargets = { files: list(targetsRaw.files ?? [], 'targets.files'), tests: list(targetsRaw.tests ?? [], 'targets.tests') };
  const legacyDeclaredTargets = structuredClone(requestedTargets);
  const allowed = list(raw.allowed_test_writes ?? [], 'allowed_test_writes');
  const testSet = new Set([...requestedTargets.tests, ...allowed]);
  if (submitted) {
    const oldInferences = new Set(submitted.targets ?? []);
    const explicit = new Set(list(submitted.explicit_targets ?? [], 'explicit_targets'));
    requestedTargets.files = [...new Set([
      ...(intake?.targets ?? [...explicit]).filter(file => explicit.has(file) || !testSet.has(file)),
      ...requestedTargets.files.filter(file => !oldInferences.has(file)),
    ])].sort();
  }
  const { resolveCurrentScopeSource } = require('./blueprint-requirement-traceability') as typeof import('./blueprint-requirement-traceability');
  if (!Array.isArray(raw.requirement_sources ?? [])) throw new Error('requirement_sources must be a source array');
  const requirementSources = (raw.requirement_sources ?? []) as string[];
  for (const source of requirementSources) {
    if (typeof source !== 'string') throw new Error('requirement_sources must contain source references');
    resolveCurrentScopeSource(root, source);
  }
  if (new Set(requirementSources).size !== requirementSources.length) throw new Error('requirement_sources: duplicate source');
  let originRequest: string | undefined;
  let originBlueprint: PreparedRequestInput['blueprint'];
  let directOrigin = false;
  let goalBacked = false;
  if (raw.origin_request !== undefined) {
    if (typeof raw.origin_request !== 'string') throw new Error('origin_request must locate the original request');
    originRequest = realRequestPath(root, raw.origin_request, 'origin_request');
    if (originRequest === requestFile) throw new Error('origin_request cannot refer to itself');
    if (design) {
      const { readDesignGoalOrigin, applyDesignGoalControl, resumeAcceptedDesignIntake } = require('./automatic-request') as typeof import('./automatic-request');
      const origin = readDesignGoalOrigin(root, path.relative(root, originRequest));
      goalBacked = true;
      if (raw.requested_result !== origin.manifest.requirement) throw new Error('design request must retain the original Goal requirement');
      if (intake) intake = applyDesignGoalControl(intake, origin.controls);
      else if ((intake = resumeAcceptedDesignIntake(root, submitted, origin))) originGap = undefined;
    } else {
      const origin = prepareRequestInput({ ...options, phase: 'component-design', requestFile: path.relative(root, originRequest), reportDir: path.relative(root, path.dirname(originRequest)) });
      directOrigin = origin.intake_context?.policy.selected === 'trivial';
      originBlueprint = directOrigin ? undefined : origin.blueprint;
      if (origin.origin_request && !intake && origin.intake_context
        && origin.intake_context.session_id === submitted?.session_id && origin.intake_context.user.id === submitted?.user?.id
        && origin.intake_context.user.text === submitted.user.text) {
        intake = origin.intake_context;
        originGap = undefined;
      }
      if (origin.intake_context && (!intake || origin.intake_context.session_id !== intake.session_id || origin.intake_context.user.id !== intake.user.id)) {
        throw new Error('verification request must retain the original design user');
      }
      if (!origin.intake_context) originGap ??= origin.origin_gap ?? '原用户请求尚未核实';
      if (origin.origin_request) {
        const { readDesignGoalOrigin, applyDesignGoalControl } = require('./automatic-request') as typeof import('./automatic-request');
        if (intake) intake = applyDesignGoalControl(intake, readDesignGoalOrigin(root, path.relative(root, origin.origin_request)).controls);
        goalBacked = true;
      }
      if (raw.requested_result !== origin.requested_result) throw new Error('verification request must retain the original requested result');
    }
  }
  let blueprint: PreparedRequestInput['blueprint'];
  if (raw.blueprint !== undefined) {
    const record = object(raw.blueprint, 'blueprint'); keys(record, ['ref', 'acceptance_ids'], 'blueprint');
    const { validateComponentBlueprintRefShape } = require('./component-blueprint-path') as typeof import('./component-blueprint-path');
    const ref = validateComponentBlueprintRefShape(record.ref);
    if (!Array.isArray(record.acceptance_ids) || record.acceptance_ids.some(value => typeof value !== 'string' || !value.trim()) || new Set(record.acceptance_ids).size !== record.acceptance_ids.length) throw new Error('blueprint acceptance_ids must be unique stable IDs');
    blueprint = { ref, acceptance_ids: record.acceptance_ids as string[] };
  }
  if (originRequest && !design && !blueprint && !directOrigin) throw new Error('a design-backed verification request needs its current blueprint binding');
  if (originRequest && !design && JSON.stringify(blueprint) !== JSON.stringify(originBlueprint)) {
    const candidateReview = options.phase === 'review' && blueprint && originBlueprint
      && blueprint.ref.blueprint_id === originBlueprint.ref.blueprint_id && blueprint.ref.component_id === originBlueprint.ref.component_id
      && blueprint.ref.revision >= originBlueprint.ref.revision
      && stableStringify(blueprint.acceptance_ids) === stableStringify(originBlueprint.acceptance_ids);
    if (!candidateReview) throw new Error('verification blueprint and acceptance IDs must retain the original design binding');
  }
  if (blueprint) {
    const { loadCanonicalBlueprint } = require('./component-blueprint-path') as typeof import('./component-blueprint-path');
    const { selectBlueprintRequestContent } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    const current = loadCanonicalBlueprint(root, blueprint.ref.blueprint_id);
    if (current.artifactSha256 === blueprint.ref.artifact_sha256) {
      const files = list(selectBlueprintRequestContent(current.blueprint).contracts?.files ?? [], 'blueprint contracts.files');
      requestedTargets.files = [...new Set([...requestedTargets.files, ...files.filter(file => !testSet.has(file))])].sort();
    }
  }
  if (allowed.length && options.phase !== 'ut') throw new Error('only UT requests may authorize test writes');
  if (options.phase === 'review' && (!requestedTargets.files.length || allowed.length)) throw new Error('review requires source targets and grants no writes');
  if (options.phase === 'ut' && !requestedTargets.files.length && !requestedTargets.tests.length) throw new Error('UT requires tests or a behavior source');
  const probe = options.phase === 'ut' && (requestedTargets.tests.length || allowed.length)
    ? dispatchRequestTargetProbe(loadResolvedProfile(root, loadFrameworkConfig(root), options.frameworkRoot), options.phase, root, requestedTargets.tests, allowed)
    : undefined;
  const registrations = probe?.registrationFiles ?? [];
  const targets = { files: requestedTargets.files, tests: requestedTargets.tests.filter(file => !registrations.includes(file)) };
  const denied = allowed.filter(file => targets.files.includes(file) || probe?.rejectedWrites.includes(file) || !targets.tests.includes(file) && !registrations.includes(file));
  if (denied.length) throw new Error(`allowed_test_writes must name selected test files or their profile-recognized same-module registration: ${denied.join(', ')}${probe?.gaps.length ? '\n' + probe.gaps.join('\n') : ''}`);
  if (allowed.length && !targets.files.length && !Object.keys(object(raw.inputs ?? {}, 'inputs')).length) throw new Error('test writes require a behavior source');
  const declared = [...new Set([...requestedTargets.files, ...requestedTargets.tests])];
  const boundTargets = [...new Set([...declared, ...registrations])];
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
  for (const file of [...((submitted || originGap) && requestFile === path.join(reportDir, 'request.json') ? [] : [requestFile]), ...boundTargets.map(file => realRequestPath(root, file, 'target'))]) if (overlap(reportDir, file)) throw new Error('report-dir overlaps request/source target');
  const catalog = design ? undefined : phaseContractIndex(loadFeatureContracts(options.frameworkRoot)).get(options.phase)?.phase;
  if (!design && !catalog) throw new Error('active phase has no request input contract');
  const inputsRaw = object(raw.inputs ?? {}, 'inputs');
  keys(inputsRaw, [...(catalog?.inputs.map(input => input.id) ?? []), ...(options.phase === 'review' ? ['review_report'] : [])], 'inputs');
  const inputs: Record<string, string> = {};
  for (const [id, value] of Object.entries(inputsRaw)) {
    if (typeof value !== 'string') throw new Error(`inputs.${id} must be a project-relative file`);
    if (id !== 'review_report' && id !== 'cases' && !catalog?.inputs.find(input => input.id === id)?.sources.some(source => source.kind === 'artifact')) throw new Error(`inputs.${id} is derived from targets; it has no file parser`);
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
  const ref = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) throw new Error('baseline ref must be nonempty');
    try { return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`], { windowsHide: true, cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { return value; }
  };
  const declaredBaseline = { ...(baselineRaw.base === undefined ? {} : { base: ref(baselineRaw.base) }), head: baselineRaw.head === undefined || baselineRaw.head === 'WORKTREE' ? 'WORKTREE' : ref(baselineRaw.head) };
  const legacyInferred = submitted?.baseline?.base && ['captured', 'reflog'].includes(submitted.baseline.source)
    && declaredBaseline.base === submitted.baseline.base && declaredBaseline.head === 'WORKTREE';
  const baseline = legacyInferred ? { head: 'WORKTREE' } : declaredBaseline;
  if (intake && !originRequest && raw.requested_result !== intake.user.text) throw new Error('自动request的需求必须来自同一原生请求');
  const comparison = options.phase === 'review' || baseline.base || baseline.head !== 'WORKTREE' ? compareRequestContent(root, baseline) : undefined;
  const comparisonGap = comparison && !comparison.executed ? comparison.error : undefined;
  const bindings: PreparedRequest['bindings'] = [];
  const sourceContents: PreparedRequest['sourceContents'] = [];
  const historicalReview = options.phase === 'review' && baseline.head !== 'WORKTREE';
  for (const file of boundTargets) {
    const absolute = realRequestPath(root, file, 'target');
    const exists = fs.existsSync(absolute);
    const entry = comparison?.entries.find(item => item.path === file || item.oldPath === file);
    const deleted = options.phase === 'review' && (entry?.status === 'D' || entry?.oldPath === file && entry.status === 'R');
    if (!design && !(options.allowPlannedTargets && goalBacked) && !historicalReview && !exists && !allowed.includes(file) && !deleted) throw new Error(`target missing: ${file}`);
    if (!historicalReview && exists && !fs.statSync(absolute).isFile()) throw new Error(`target is not a file: ${file}`);
    let bytes: Buffer | undefined = !historicalReview && exists ? fs.readFileSync(absolute) : undefined;
    if (baseline.head !== 'WORKTREE' && !allowed.includes(file) && !deleted) {
      const committed = readRequestRevision(root, baseline.head, file);
      if (!committed && !comparisonGap) throw new Error(`target missing from selected head: ${file}`);
      if (committed && options.phase !== 'review' && !bytes?.equals(committed)) throw new Error(`test target differs from selected head: ${file}`);
      if (historicalReview) bytes = committed;
    }
    const before = entry && comparison?.baseSha ? readRequestRevision(root, comparison.baseSha, entry.oldPath ?? file)?.toString('utf8') ?? '' : undefined;
    const content = bytes?.toString('utf8') ?? (deleted ? '' : undefined);
    if (content !== undefined) sourceContents.push({ path: file, content, ...(before !== undefined ? { before } : {}) });
    bindings.push({ path: file, exists: bytes !== undefined, sha256: bytes === undefined ? null : crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  const inputBindings = Object.entries(inputs).filter(([id]) => id !== 'review_report').map(([id, file]) => {
    const exists = fs.existsSync(file); if (exists && !fs.statSync(file).isFile()) throw new Error(`input is not a file: ${id}`);
    return { id, path: path.relative(root, file).replace(/\\/g, '/'), exists, sha256: exists ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null };
  });
  const reportRelative = path.relative(root, reportDir).replace(/\\/g, '/');
  const carrierRelative = path.relative(root, requestFile).replace(/\\/g, '/');
  const requestOrigin = intake ? `${intake.session_id}#${intake.user.id}` : undefined;
  const normalized = { schema_version: '1.0', phase: options.phase, requested_result: raw.requested_result.trim(),
    targets: requestedTargets, baseline, inputs: Object.fromEntries(Object.entries(inputs).map(([id, file]) => [id, path.relative(root, file).replace(/\\/g, '/')])),
    allowed_test_writes: allowed,
    ...(requirementSources.length ? { requirement_sources: requirementSources.map(file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(realRequestPath(root, file.split('#')[0], 'requirement source'))).digest('hex') })) } : {}),
    ...(originRequest ? { origin_request: path.relative(root, originRequest).replace(/\\/g, '/') } : {}), ...(blueprint ? { blueprint } : {}) };
  const hash = (request: object, paths: string[]) => crypto.createHash('sha256').update(stableStringify({
    request, bindings: bindings.filter(binding => paths.includes(binding.path) && !allowed.includes(binding.path)), inputBindings,
  })).digest('hex');
  const request_sha256 = hash({ ...normalized, request_file: carrierRelative, ...(requestOrigin ? { request_origin: requestOrigin,
    user_corrections: (intake?.user_messages ?? []).filter(message => message.id !== intake!.user.id).map(({ id, text }) => ({ id, text })),
    excluded: intake?.control.excluded, exempt: intake?.control.exempt,
  } : {}) }, declared);
  // Rebuild the original writer's normalization where current independently bound bytes permit it.
  let legacy_request_sha256: string | undefined;
  if (!submitted || intake && submitted.baseline && submitted.facts && Array.isArray(submitted.targets)) {
    const oldFiles = [...new Set([...legacyDeclaredTargets.files, ...(submitted?.targets ?? []).filter(file => !testSet.has(file))])].sort();
    const oldTargets = { files: oldFiles, tests: legacyDeclaredTargets.tests };
    const oldDeclared = [...new Set([...oldTargets.files, ...oldTargets.tests])];
    const legacyIntake = submitted ? { session_ref: submitted.session_ref, user: submitted.user, user_messages: (submitted.user_messages ?? [submitted.user]).map(({ id, text }) => ({ id, text })),
      control: submitted.control, baseline: submitted.baseline, targets: submitted.targets, attribution_unknown: submitted.attribution_unknown,
      facts: Object.fromEntries(Object.entries(submitted.facts).map(([id, fact]) => [id, { value: fact.value, sources: fact.sources }])),
      fact_bindings: [...new Set(Object.values(submitted.facts).flatMap(fact => fact.sources))].sort().map(file => {
        const absolute = realRequestPath(root, file, 'legacy judgment source');
        return { path: file, sha256: fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') : null };
      }), policy: submitted.policy, content_fingerprint: submitted.content_fingerprint } : undefined;
    if (oldDeclared.every(file => declared.includes(file))) legacy_request_sha256 = hash({ ...normalized, targets: oldTargets, baseline: declaredBaseline,
      report_dir: reportRelative, ...(legacyIntake ? { intake_context: legacyIntake } : {}), ...(raw.origin_gap ? { origin_gap: raw.origin_gap } : {}),
    }, oldDeclared);
  }
  for (const name of ['summary.json', 'script-report.json']) {
    const file = path.join(reportDir, name);
    if (!fs.existsSync(file)) continue;
    const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
    const currentOwner = prior.request_file === carrierRelative && prior.request_origin === requestOrigin;
    const legacyOwner = prior.request_file === undefined && requestFile === path.join(reportDir, 'request.json')
      && prior.request_origin === requestOrigin && (requestOrigin !== undefined || prior.origin_gap === raw.origin_gap);
    if (prior.subject !== 'request' || prior.phase !== options.phase || prior.requested_result !== normalized.requested_result
      || (prior.request_sha256 !== request_sha256 && (legacy_request_sha256 === undefined || prior.request_sha256 !== legacy_request_sha256) && !currentOwner && !legacyOwner)) {
      throw new Error('report-dir belongs to another request');
    }
  }
  const gaps = [...[...(!design ? [factsPath] : []), ...Object.values(inputs)].filter(file => !fs.existsSync(file)).map(file => path.relative(root, file).replace(/\\/g, '/')), ...bindings.filter(binding => !binding.exists && !design).map(binding => binding.path)];
  gaps.push(...(probe?.gaps ?? []));
  if (options.phase === 'ut' && !targets.tests.length) gaps.push('targets.tests');
  if (options.phase === 'testing' && !blueprint && !inputs.cases) gaps.push('inputs.cases');
  if (options.phase === 'testing' && blueprint && !inputs.test_plan) gaps.push('inputs.test_plan');
  if (fs.existsSync(factsPath) && (parseContextExploration(fs.readFileSync(factsPath, 'utf8')).fm as Record<string, unknown>).request_sha256 !== request_sha256) gaps.push(path.relative(root, factsPath).replace(/\\/g, '/'));
  return { schema_version: '1.0', phase: options.phase as PreparedRequestInput['phase'], requested_result: raw.requested_result.trim(), request_sha256, ...(legacy_request_sha256 ? { legacy_request_sha256 } : {}), ...(comparisonGap ? { comparison_gap: comparisonGap } : {}), requestFile, reportDir, factsPath, targets, ...(registrations.length ? { test_registrations: registrations } : {}), baseline, inputs, allowed_test_writes: allowed, bindings, sourceContents, gaps, requirement_sources: requirementSources, ...(originRequest ? { origin_request: originRequest } : {}), ...(blueprint ? { blueprint } : {}), ...(intake ? { intake_context: intake } : {}), ...(originGap ? { origin_gap: originGap } : {}) };
}

/** Existing capability entry keeps its phase contract; design preparation uses the same parser core. */
export function prepareExplicitRequest(options: { projectRoot: string; frameworkRoot: string; phase: string; requestFile: string; reportDir: string; allowPlannedTargets?: boolean }): PreparedRequest {
  const prepared = prepareRequestInput(options);
  if (prepared.phase === 'component-design') throw new Error('component-design is checked by check:component-blueprint, not a verification phase');
  return prepared as PreparedRequest;
}

/** Validate the writer's pair, original subject, and the inputs actually used by its checker. */
export function readRequestScriptConclusion(projectRoot: string, frameworkRoot: string, request: PreparedRequest) {
  const { readBoundInput, requestPhaseInputContext } = require('./capability-resolution') as typeof import('./capability-resolution');
  const relative = (file: string) => path.relative(projectRoot, file).replace(/\\/g, '/');
  const reportFile = path.join(request.reportDir, 'script-report.json');
  const summary = JSON.parse(fs.readFileSync(path.join(request.reportDir, 'summary.json'), 'utf8'));
  const bytes = fs.readFileSync(reportFile);
  const report = JSON.parse(bytes.toString('utf8')) as { subject?: string; phase?: string; request_sha256?: string; request_file?: string;
    request_origin?: string; requested_result?: string; targets?: PreparedRequest['bindings']; checks?: CheckResult[];
    gate_fingerprint?: string; execution_inputs?: RequestExecutionInputs; execution_artifacts?: RequestBuildArtifact[];
    input_bindings?: Record<string, InputBinding>; summary?: { verdict?: string } };
  const origin = request.intake_context ? `${request.intake_context.session_id}#${request.intake_context.user.id}` : undefined;
  if (summary.subject !== 'request' || report.subject !== 'request' || summary.phase !== request.phase || report.phase !== request.phase
    || summary.evidence?.script_report !== relative(reportFile) || summary.evidence.script_report_sha256 !== crypto.createHash('sha256').update(bytes).digest('hex')
    || !report.request_sha256 || summary.request_sha256 !== report.request_sha256
    || (report.request_sha256 !== request.request_sha256 && report.request_sha256 !== request.legacy_request_sha256)
    || (report.request_file !== undefined && report.request_file !== relative(request.requestFile))
    || report.request_origin !== origin || summary.request_origin !== origin || report.requested_result !== request.requested_result
    || summary.verdict !== report.summary?.verdict || stableStringify(report.targets) !== stableStringify(request.bindings)
    || stableStringify(summary.targets) !== stableStringify(report.targets) || !Array.isArray(report.checks)) {
    throw new Error('原目录报告的身份、关联、业务输入或原件已变化');
  }
  const gate = computeGateFingerprint(frameworkRoot, request.phase);
  if (gate && (summary.gate_fingerprint !== gate || report.gate_fingerprint !== gate)) throw new Error(`当前 ${request.phase} 的规则与旧阶段结果未建立一致性，须重验该阶段`);
  if (request.phase !== 'review' && (request.origin_request || request.blueprint)) {
    const current = readRequestExecutionInputs(projectRoot, frameworkRoot, request.phase, request.bindings.map(binding => binding.path));
    if (!current || !report.execution_inputs || stableStringify(report.execution_inputs) !== stableStringify(summary.execution_inputs)) {
      throw new Error('缺少实际执行所用模块或构建输入的可核绑定，须重验该专项');
    }
    if (stableStringify(report.execution_inputs) !== stableStringify(current)) {
      throw new Error(`实际执行所用模块或构建输入已变化：${current.scope.join('、')}，须重验该专项`);
    }
    if (report.execution_artifacts) {
      if (stableStringify(report.execution_artifacts) !== stableStringify(summary.execution_artifacts)) throw new Error('报告的实际构建包绑定不一致');
      for (const artifact of report.execution_artifacts) {
        const file = realRequestPath(projectRoot, artifact.path, 'request execution package');
        if (!fs.existsSync(file) || sha256File(file) !== artifact.sha256) throw new Error(`实际执行所绑定的构建包已更换或不可核验：${artifact.module}`);
      }
    }
  }
  const context = requestPhaseInputContext(report.request_sha256);
  for (const binding of Object.values(report.input_bindings ?? {})) readBoundInput({ projectRoot, frameworkRoot, phase: request.phase, track: 'full', request, inputContext: context }, binding);
  const native = report.checks.flatMap(check => (check.structured as { request_evidence?: Array<{ path: string; sha256: string }> } | undefined)?.request_evidence ?? []);
  if (stableStringify(summary.evidence.native ?? []) !== stableStringify(native)) throw new Error('汇总原生证据与专项报告不一致');
  const stale = new Set<string>();
  for (const evidence of native) {
    try {
      const file = realRequestPath(projectRoot, evidence.path, 'native request evidence');
      if (evidence.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')) stale.add(evidence.path);
    } catch { stale.add(evidence.path); }
  }
  const checks = report.checks.map(check => {
    const unavailable = check.affected_files?.filter(file => stale.has(file)) ?? [];
    if (!unavailable.length || check.status === 'FAIL') return check;
    const item = check.structured as { expected_result?: string; verification_steps?: string[];
      cases?: Array<{ tc_id: string; status: string; expected: string; evidence_paths: string[] }> } | undefined;
    return {
      ...check,
      status: 'FAIL' as const,
      details: `${check.details}；原生执行记录缺失或已变化：${unavailable.join('、')}${item?.verification_steps?.length ? '；步骤：' + item.verification_steps.join('、') : ''}${item?.expected_result ? '；待核预期：' + item.expected_result : ''}`,
      ...(item?.cases ? { structured: { ...item, cases: item.cases.map(row => row.evidence_paths.some(file => stale.has(file))
        ? { ...row, status: 'INCOMPLETE' } : row) } } : {}),
    };
  });
  return { checks, summary: { ...report.summary, ...(stale.size && report.summary?.verdict === 'PASS' ? { verdict: 'INCOMPLETE' } : {}) }, reportFile };
}

export interface CapabilityResolutionEntryInputOptions {
  /** A bound verifier reads the formal check's admission without granting a live tool window. */
  purpose?: 'design-authority-probe' | 'work-unit-author' | 'bound-verifier';
  /** Source selection from the current check before it published its own legacy facts proof. */
  boundCodebaseSourceRefs?: readonly string[];
  authorityReaders?: IdentityNeutralDigestReaders;
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

type FactsInvocationLookup = {
  projectRoot: string; feature: string; phase: string; runId: string; attemptId?: string; featuresDir?: string; frameworkRoot?: string;
  authorityReaders?: IdentityNeutralDigestReaders;
};

/** Formal-tool observation against its signed author; it never changes the author's research. */
export function loadFormalFactsObservation(options: FactsInvocationLookup, returned = false): {
  context: FactsInvocationContext; sources: Map<string, { sha256: string; written: boolean }>;
} | undefined {
  try {
    if (!options.attemptId) return undefined;
    const tokenAt = process.argv.indexOf('--goal-gate-token');
    const token = `${options.runId}/harness/${options.phase}-${options.attemptId}`;
    if (!returned && (tokenAt < 0 || process.argv[tokenAt + 1] !== token)) return undefined;
    const manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, { feature: options.feature, featuresDir: options.featuresDir });
    const runDir = path.resolve(options.projectRoot, manifest.report_dir);
    const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
    const gateIndex = events.map((event, index) => {
      const row = event as typeof event & { process_role?: string; pid?: number; token?: string; run_id?: string; started_at_ms?: number; executable?: string };
      return row.type === 'harness_start' && row.phase === options.phase && row.invoke_id === `${options.phase}-${options.attemptId}`
        && row.process_role === 'harness' && row.run_id === options.runId && row.token === token
        && typeof row.started_at_ms === 'number' && Number.isFinite(row.started_at_ms) && !!row.executable
        && (returned ? typeof row.pid === 'number' && row.pid > 0 : row.pid === process.pid || row.pid === process.ppid) ? index : -1;
    }).filter(index => index >= 0).pop();
    if (gateIndex === undefined) return undefined;
    const gate = events[gateIndex];
    const later = events.slice(gateIndex + 1);
    const end = later.find(event => event.type === 'harness_end' && event.invoke_id === gate.invoke_id);
    if (returned) {
      if (end?.timed_out !== false || typeof end.exit_code !== 'number' || !end.related_input_snapshot
        || later.some(event => event.type === 'harness_start' && event.phase === options.phase)) return undefined;
      const scoped = later.some(event => event.type === 'scope_revised') ? eventsWithScopeRevocations(manifest.execution_scope, events, undefined,
        { projectRoot: options.projectRoot, feature: options.feature, runId: options.runId }) : events;
      if (scoped.slice(scoped.indexOf(gate) + 1).some(event => event.type === 'phase_invalidated' && event.phase === options.phase
        || event.type === 'phase_backtrack_requested' && (event.to_phase === options.phase
          || ((event as { invalidated_phases?: string[] }).invalidated_phases ?? []).includes(options.phase)))) return undefined;
    } else {
      if (end) return undefined;
      const { readRunControl, assertFencedOwner } = require('./goal-run-control') as typeof import('./goal-run-control');
      const control = readRunControl(runDir, options.runId), owner = control?.owner;
      if (!owner || owner.kind === 'session' && (!Number.isFinite(Date.parse(owner.lease_expires_at ?? ''))
        || Date.parse(owner.lease_expires_at ?? '') <= Date.now())) return undefined;
      assertFencedOwner(runDir, { run_id: options.runId, owner_id: owner.owner_id, epoch: owner.epoch }, 'formal_facts_observation');
    }
    const history = events.slice(0, gateIndex);
    const { executionRequestForInvoke } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
    const { workUnitExecutionRole } = require('./goal-phase-executor') as typeof import('./goal-phase-executor');
    const records = history.flatMap((start, index) => {
      if (start.type !== 'agent_invoke_start' || !start.invoke_id) return [];
      let original: NonNullable<ReturnType<typeof executionRequestForInvoke>>['request'] | undefined;
      try { original = executionRequestForInvoke(runDir, start.invoke_id)?.request; } catch { return []; }
      const end = history.slice(index + 1).find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
      if (!original || !end || original.context.runId !== options.runId || original.context.feature !== options.feature
        || path.resolve(original.context.projectRoot) !== path.resolve(options.projectRoot)
        || path.resolve(original.context.runDir) !== runDir || original.context.phase !== start.phase
        || workUnitExecutionRole(original.context, original.purpose) !== 'author') return [];
      return [{ start, original, end, completed: invocationCompleted({ ...end, exitCode: end.exit_code }) }];
    });
    const anchor = records.find(record => record.original.context.attemptId === options.attemptId && record.completed
      && record.original.context.chain.includes(options.phase));
    if (!anchor || returned && anchor.start.phase !== 'work-unit-author') return undefined;
    if (anchor.start.phase === 'work-unit-author' && !anchor.original.context.factsContext?.baseline) {
      return completedFactsBaselineFromHistory({ ...options,
        featuresDir: options.featuresDir ?? relFeaturesDir(options.projectRoot), goalAttemptId: options.attemptId },
      options.runId, options.frameworkRoot ?? path.resolve(__dirname, '../../..'), manifest, history, false);
    }
    const facts = fs.readFileSync(resolveFactsAbsPath(options.projectRoot, options.feature), 'utf8');
    // The formal CU gate uses the author admission it is checking. A stale
    // predecessor report cannot silently replace that admission with fresh facts.
    const current = anchor.start.phase === 'work-unit-author' ? anchor.original.context.factsContext
      : [...records].reverse().filter(record => record.completed)
      .map(record => record.start.facts_context ?? record.original.context.factsContext)
      .find(context => context?.baseline && 'feature' in context.subject && context.subject.feature === options.feature
        && 'run_id' in context.subject && context.subject.run_id === options.runId
        && context.baseline.fingerprint === factsBaselineFingerprint(facts));
    if (!current?.baseline) return completedFactsBaselineFromHistory({ ...options, featuresDir: options.featuresDir ?? relFeaturesDir(options.projectRoot), goalAttemptId: options.attemptId },
      options.runId, options.frameworkRoot ?? path.resolve(__dirname, '../../..'), manifest, history, false);
    return { context: structuredClone(current), sources: readCurrentFactsSources(options.projectRoot, current.source_paths) };
  } catch { return undefined; }
}

/** Same-attempt runtime admission, never reconstructed from authored facts or a label invocation. */
export function loadFactsInvocationContext(options: FactsInvocationLookup): FactsInvocationContext | undefined {
  const formal = loadFormalFactsObservation(options);
  if (formal) return formal.context;
  if (!options.attemptId) return undefined;
  const manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, { feature: options.feature, featuresDir: options.featuresDir });
  const scope = resolveEffectiveScopeSource(options.projectRoot, options.feature, options.runId)?.scope;
  const inheritedActor = process.env.MAISON_GOAL_RUN_ID === options.runId && process.env.MAISON_GOAL_ATTEMPT === options.attemptId
    ? process.env.MAISON_GOAL_ATTEMPT_PHASE?.trim() : undefined;
  const actorPhase = inheritedActor || options.phase;
  const runDir = path.resolve(options.projectRoot, manifest.report_dir);
  let actorInvokeId = `${actorPhase}-${options.attemptId}`;
  let actorOwner: import('./goal-run-control').RunFenceToken | undefined;
  if (actorPhase !== options.phase) {
    const { executionRequestForInvoke, sessionExecutionDeadlineMs } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
    const { assertFencedOwner } = require('./goal-run-control') as typeof import('./goal-run-control');
    const original = executionRequestForInvoke(runDir);
    const request = original?.request;
    if (!request || request.context.phase !== actorPhase || request.context.attemptId !== options.attemptId
      || request.context.runId !== options.runId || request.context.feature !== options.feature
      || path.resolve(request.context.projectRoot) !== path.resolve(options.projectRoot) || path.resolve(request.context.runDir) !== runDir
      || request.context.owner.run_id !== options.runId || sessionExecutionDeadlineMs(request) <= Date.now()) return undefined;
    if (loadAuthoritativeEvents(path.join(runDir, 'events.jsonl')).some(event => event.type === 'agent_invoke_end'
      && event.invoke_id === request.invoke_id && invocationCompleted({ ...event, exitCode: event.exit_code }))) return undefined;
    actorOwner = request.context.owner;
    assertFencedOwner(runDir, actorOwner, 'check_family_facts');
    actorInvokeId = request.invoke_id;
  }
  if (!scope || actorPhase === options.phase && !executionCompletionPhases(scope).includes(actorPhase)) return undefined;
  const events = eventsWithScopeRevocations(manifest.execution_scope,
    loadAuthoritativeEvents(path.join(runDir, 'events.jsonl')), undefined, { projectRoot: options.projectRoot, feature: options.feature, runId: options.runId });
  const index = events.map((event, i) => event.type === 'agent_invoke_start' && event.phase === actorPhase
    && event.invoke_id === actorInvokeId && (!actorOwner || event.owner_id === actorOwner.owner_id && event.owner_epoch === actorOwner.epoch) ? i : -1).filter(i => i >= 0).pop();
  if (index === undefined || events.slice(index + 1).some(event =>
    (event.type === 'phase_invalidated' && event.phase === actorPhase)
    || (actorOwner && event.type === 'agent_invoke_end' && event.invoke_id === actorInvokeId)
    || (event.type === 'phase_backtrack_requested' && Array.isArray((event as { invalidated_phases?: string[] }).invalidated_phases)
      && (event as { invalidated_phases: string[] }).invalidated_phases.includes(actorPhase)))) return undefined;
  const context = events[index].facts_context;
  if (!context || !('run_id' in context.subject) || context.subject.feature !== options.feature || context.subject.run_id !== options.runId
    || typeof context.first_phase !== 'string' || !Array.isArray(context.source_paths)) return undefined;
  const admitted = structuredClone(context);
  // 搬迁只改变当前读取位置，原事件、subject 和内容指纹保持原件。与范围依赖共用根推导。
  const legacyRoot = inferLegacyProjectRoot(options.projectRoot, scope);
  const currentSource = (file: string): string => validateProjectRelativePath(options.projectRoot,
    path.relative(options.projectRoot, resolveDependencyPath(options.projectRoot, file, legacyRoot)).replace(/\\/g, '/'), 'invocation source');
  admitted.source_paths = admitted.source_paths.map(currentSource);
  if (admitted.source_owners) admitted.source_owners = Object.fromEntries(Object.entries(admitted.source_owners).map(([file, owner]) => [currentSource(file), owner]));
  if (admitted.baseline) admitted.baseline.dependencies = admitted.baseline.dependencies.map(dependency => ({ ...dependency,
    path: resolveDependencyPath(options.projectRoot, dependency.path, legacyRoot) }));
  return admitted;
}

/** The runtime write boundary for facts ownership; throws without a construction binding. */
function resolveFactsWriteBoundary(options: { projectRoot: string; frameworkRoot: string; feature: string; runId?: string; phase?: string; authorityReaders?: IdentityNeutralDigestReaders },
  scope: import('./execution-scope').ExecutionScope, constructionModules?: Array<{ name: string; package_path: string }>) {
  const config = loadFrameworkConfig(options.projectRoot);
  const profile = loadResolvedProfile(options.projectRoot, config, options.frameworkRoot);
  return resolvePhaseWriteBoundary({ projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot, feature: options.feature, runId: options.runId,
    authorityReaders: options.authorityReaders, executionScope: scope, executionRole: 'author', pendingOwnerPhase: options.phase, phaseOrder: [...new Set([...executionCompletionPhases(scope),
      ...(constructionModules ? scope.obligations.filter(obligation => obligation.applicability === 'required').map(obligation => obligation.owner_phase) : [])])], track: 'full',
    ...(constructionModules ? { constructionModules } : {}),
    profileDir: profile.profileDir, productLayerDirs: (config.architecture?.outer_layers ?? []).map(layer => layer.id),
    resolveUtSourceRoots: tryLoadUtSourceRootResolver(profile.profileDir) ?? undefined });
}

/** Existing source ownership and write authorization, shared by admission and the final facts check. */
export function resolveFactsPhaseOwnedSources(options: {
  projectRoot: string; frameworkRoot: string; feature: string; phase: string; runId?: string; authorityReaders?: IdentityNeutralDigestReaders;
}, context: FactsInvocationContext): Set<string> {
  try {
    const scope = resolveEffectiveScopeSource(options.projectRoot, options.feature, options.runId)?.scope;
    if (!scope || !options.runId && !executionCompletionPhases(scope).includes(options.phase)) return new Set();
    const boundary = resolveFactsWriteBoundary(options, scope);
    if (boundary.unresolvedSourcePhases.includes(options.phase)) return new Set();
    const { workUnitExecutionRole } = require('./goal-phase-executor') as typeof import('./goal-phase-executor');
    return new Set(Object.entries(context.source_owners ?? {}).filter(([source, owner]) => {
      const granted = resolvePhasePathOwnership(boundary, source);
      return owner === options.phase && (options.runId
        ? workUnitMayWritePath(boundary, source) && granted.roles.some(role => role.kind === 'source'
          || role.kind === 'artifact' && workUnitExecutionRole({ phase: granted.owner ?? '' }) !== 'verifier')
        : granted.owner === options.phase && granted.roles.some(role => role.kind === 'source'));
    }).map(([source]) => source));
  } catch { return new Set(); }
}

/** Re-admit completed writes or an interrupted phase window, preserving the original admission hashes. */
export function loadCompletedFactsBaseline(options: CapabilityResolutionEntryInputOptions, runId: string, frameworkRoot: string, carryUnchangedBaseline = false): FactsInvocationContext | undefined {
  return loadCompletedFactsObservation(options, runId, frameworkRoot, carryUnchangedBaseline)?.context;
}

function readCurrentFactsSources(projectRoot: string, sources: readonly string[]): Map<string, { sha256: string; written: boolean }> {
  const current = new Map<string, { sha256: string; written: boolean }>();
  for (const source of sources) {
    try {
      const safe = validateProjectRelativePath(projectRoot, source, 'facts source');
      assertFactsSourceReadable(projectRoot, safe);
      const sha256 = sha256File(path.resolve(projectRoot, safe));
      if (sha256) current.set(safe, { sha256, written: false });
    } catch { /* The missing source remains visible to the check that consumes it. */ }
  }
  return current;
}

/** Continue the same audited objective from the predecessor's current research. */
export function loadSuccessorFactsBaseline(options: CapabilityResolutionEntryInputOptions, runId: string, _frameworkRoot: string): FactsInvocationContext | undefined {
  const { projectRoot, feature, featuresDir } = options;
  try {
    const manifest = loadGoalManifestFromRun(projectRoot, runId, { feature, featuresDir });
    if (!manifest.successor_of) return undefined;
    const { isAuditedSuccessor } = require('./feature-execution-scope') as typeof import('./feature-execution-scope');
    if (!isAuditedSuccessor(projectRoot, feature, manifest.successor_of, runId)) return undefined;
    const predecessor = loadGoalManifestFromRun(projectRoot, manifest.successor_of, { feature, featuresDir });
    if (manifest.requirement !== predecessor.requirement
      || stableStringify(manifest.requirement_source_files ?? []) !== stableStringify(predecessor.requirement_source_files ?? [])
      || stableStringify(manifest.unattended ?? null) !== stableStringify(predecessor.unattended ?? null)) return undefined;
    const raw = fs.readFileSync(resolveFactsAbsPath(projectRoot, feature), 'utf8');
    const { fm, error } = parseContextExploration(raw);
    const record = fm as Record<string, unknown>;
    if (error || fm.feature !== feature || record.run_id !== predecessor.run_id || record.request_sha256 !== undefined
      || record.frozen_scope_fingerprint !== undefined || typeof record.established_by !== 'string') return undefined;
    const declared = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((file): file is string => typeof file === 'string') : [];
    const sources = readCurrentFactsSources(projectRoot, declared);
    return { subject: { feature, run_id: runId }, first_phase: manifest.phase_chain?.[0] ?? manifest.execution_scope?.phase_chain[0] ?? options.phase,
      source_paths: [...sources.keys()], required_input_snippets: [],
      baseline: { established_by: record.established_by, fingerprint: factsBaselineFingerprint(raw),
        dependencies: [...sources].map(([file, state]) => ({ path: path.resolve(projectRoot, file), exists: true, sha256: state.sha256, role: 'derive' })) } };
  } catch { return undefined; }
}

/** A completed, identity-bound invocation supplies research context after its process is released. */
export function loadCompletedFactsObservation(options: CapabilityResolutionEntryInputOptions, runId: string, frameworkRoot: string,
  carryUnchangedBaseline = false): ReturnType<typeof loadFormalFactsObservation> {
  if (!/^i\d+$/.test(options.goalAttemptId ?? '')) return undefined;
  const manifest = loadGoalManifestFromRun(options.projectRoot, runId, { feature: options.feature, featuresDir: options.featuresDir });
  const scope = resolveEffectiveScopeSource(options.projectRoot, options.feature, runId)?.scope;
  const { applicableCheckFamilies } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  if (!scope || !applicableCheckFamilies(scope).includes(options.phase)) return undefined;
  const events = eventsWithScopeRevocations(manifest.execution_scope,
    loadAuthoritativeEvents(path.resolve(options.projectRoot, manifest.report_dir, 'events.jsonl')), undefined, { projectRoot: options.projectRoot, feature: options.feature, runId });
  return completedFactsBaselineFromHistory(options, runId, frameworkRoot, manifest, events, carryUnchangedBaseline);
}

function completedFactsBaselineFromHistory(options: CapabilityResolutionEntryInputOptions, runId: string, _frameworkRoot: string,
  manifest: ReturnType<typeof loadGoalManifestFromRun>, events: ReturnType<typeof loadAuthoritativeEvents>, carryUnchangedBaseline: boolean): ReturnType<typeof loadFormalFactsObservation> {
  if (events.some(event => event.type === 'agent_invoke_start' && event.invoke_id === `${options.phase}-${options.goalAttemptId}`)) return undefined;
  const fence = events.map(event => event.type === 'phase_invalidated' && event.phase === options.phase
    || event.type === 'phase_backtrack_requested' && (event.to_phase === options.phase
      || ((event as { invalidated_phases?: string[] }).invalidated_phases ?? []).includes(options.phase))).lastIndexOf(true);
  const runDir = path.resolve(options.projectRoot, manifest.report_dir);
  const openBounds = new Set(findUnclosedGuardianBounds(events).map(bound => bound.invoke_id));
  const { executionRequestForInvoke } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
  const { workUnitExecutionRole } = require('./goal-phase-executor') as typeof import('./goal-phase-executor');
  for (let index = events.length - 1; index > fence; index--) {
    const start = events[index];
    if (start.type !== 'agent_invoke_start' || !start.invoke_id || openBounds.has(start.invoke_id)
      || start.phase !== options.phase && start.phase !== 'work-unit-author') continue;
    const end = events.slice(index + 1).find(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id);
    if (!end || !invocationCompleted({ ...end, exitCode: end.exit_code })) continue;
    try {
      const original = executionRequestForInvoke(runDir, start.invoke_id), request = original?.request;
      if (request && (request.invoke_id !== start.invoke_id || request.context.phase !== start.phase
        || request.context.runId !== runId || request.context.feature !== options.feature || request.context.owner.run_id !== runId
        || path.resolve(request.context.projectRoot) !== path.resolve(options.projectRoot) || path.resolve(request.context.runDir) !== runDir
        || original.event.owner_id !== request.context.owner.owner_id || original.event.owner_epoch !== request.context.owner.epoch
        || workUnitExecutionRole(request.context, request.purpose) !== 'author')) continue;
      if (start.phase === 'work-unit-author' && !request) continue;
      const context = request?.context.factsContext ?? start.facts_context;
      if (!context || !('run_id' in context.subject) || context.subject.run_id !== runId
        || context.subject.feature !== options.feature || !Array.isArray(context.source_paths)) continue;
      if (carryUnchangedBaseline && context.baseline?.dependencies.some(dep =>
        sha256File(dep.path) !== dep.sha256 || fs.existsSync(dep.path) !== dep.exists)) continue;
      return { context: structuredClone(context), sources: readCurrentFactsSources(options.projectRoot, context.source_paths) };
    } catch { /* Missing originals cannot qualify an invocation. */ }
  }
  return undefined;
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

/** A genuine audited new birth may establish its own facts; a remaining-queue change cannot. */
export function resolveFactsRebuildOwner(options: Pick<CapabilityResolutionEntryInputOptions, 'projectRoot' | 'feature' | 'phase' | 'goalRunId' | 'featuresDir'>,
  record: Record<string, unknown>, originalFirstPhase: string): string {
  const original = typeof record.established_by === 'string' ? record.established_by : originalFirstPhase;
  if (!options.goalRunId || record.run_id === options.goalRunId || record.feature !== options.feature || typeof record.run_id !== 'string') return original;
  const manifest = loadGoalManifestFromRun(options.projectRoot, options.goalRunId, { feature: options.feature, featuresDir: options.featuresDir });
  if (manifest.successor_of !== record.run_id || manifest.phase_chain?.[0] !== options.phase) return original;
  const { isAuditedSuccessor } = require('./feature-execution-scope') as typeof import('./feature-execution-scope');
  return isAuditedSuccessor(options.projectRoot, options.feature, record.run_id, manifest.run_id) ? manifest.phase_chain[0] : original;
}

/** The direct Spec checker and verifier read the same frozen requirement original. */
export function resolveFeaturePhaseCapabilityInput(
  options: CapabilityResolutionEntryInputOptions,
  workflow: Pick<WorkflowSpec, 'schema_version'>,
  explicit?: { requirement?: unknown; requirementFile?: unknown },
): CapabilityResolutionEntryInput {
  if (options.goalRunId?.trim() && explicit) {
    throw new Error('Goal harness 的需求权威是已冻结 manifest；不得用 --requirement/--requirement-file 覆盖');
  }
  if (options.goalRunId?.trim() || options.phase !== 'spec' || workflow.schema_version !== '1.2') {
    return resolveCapabilityResolutionEntryInput(options);
  }
  const { frameworkRoot, projectRoot, feature } = options;
  const binding = featureRequirementBinding(projectRoot, feature);
  const legacyRoot = inferLegacyProjectRoot(projectRoot, binding);
  const sources = binding.dependencies.filter(dep => dep.exists).map(dep => resolveDependencyPath(projectRoot, dep.path, legacyRoot));
  if (!explicit && sources.length !== 1) {
    throw new Error('无 run inline/旧候选无法恢复原始需求正文；请用 --requirement 或 --requirement-file 提供签发时的原始需求。');
  }
  const { text, sources: requirementSourceFiles } = resolveRequirementInput(explicit
    ? { projectRoot, ...explicit } : { projectRoot, requirementFile: sources[0] });
  if (!text?.trim()) throw new Error('spec 阶段缺少原始需求正文');
  readBoundInput({
    frameworkRoot: frameworkRoot ?? path.resolve(__dirname, '../../..'), projectRoot, feature, phase: 'spec', track: 'full',
    requirement: text,
    // Legacy/inline candidates bind text only, even when this invocation reads it from a file.
    requirementSourceFiles: binding.dependencies.length ? requirementSourceFiles : [],
    inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] },
  }, binding, legacyRoot);
  return resolveCapabilityResolutionEntryInput({ ...options, requirement: text, requirementSourceFiles });
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
      if (!factsContext.baseline && (manifest.phase_chain?.[0] ?? manifest.execution_scope?.phase_chain[0]) !== factsContext.first_phase) throw new Error('facts establishing phase differs from frozen run');
      if (requirement !== undefined && requirement.trim() !== manifest.requirement?.trim()) throw new Error('explicit requirement differs from frozen run');
    }
    return { inputContext, factsContext, requirement, codeTargets, testTargets, adhocCases: options.explicitAdhocCases };
  }
  let requirement = options.requirement;
  let requirementSourceFiles = options.requirementSourceFiles;
  let runFirstPhase: string | undefined;
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
      runFirstPhase = manifest.phase_chain?.[0] ?? manifest.execution_scope?.phase_chain[0];
    }
    // Binding targets come from the recorded revisions. Computing completion here would
    // ask the independent reader to resolve these same inputs again.
    const scope = authority?.scope;
    if (scope) {
      if (goalRunId && !runFirstPhase) throw new Error('facts establishing phase differs from frozen run');
      const frameworkRoot = options.frameworkRoot ?? path.resolve(__dirname, '../../..');
      const contractIndex = phaseContractIndex(loadFeatureContracts(frameworkRoot));
      const indexed = contractIndex.get(options.phase);
      if (indexed?.contract.schema_version !== '1.1') throw new Error('execution scope requires phase contract 1.1');
      const unitAuthor = options.purpose === 'work-unit-author';
      const inputContracts = unitAuthor
        ? (require('./verify-feature-completion') as typeof import('./verify-feature-completion')).applicableCheckFamilies(scope)
          .flatMap(family => { const contract = contractIndex.get(family); return contract?.contract.schema_version === '1.1' ? [contract] : []; })
        : [indexed];
      const consumes = (providerId: string): boolean => inputContracts.some(contract => contract.phase.inputs
        .some(input => input.sources.some(source => source.kind === 'derive' && source.provider_id === providerId)));
      const expectedBindings = scope.obligations.flatMap(obligation => [
        ...obligation.basis.filter(binding => !binding.dependencies.length || !binding.dependencies.every(dep => isExecutionSourceBasis(options.projectRoot, scope, obligation, dep, goalRunId))),
        ...(obligation.satisfied_by ?? []).filter(ref => 'input_id' in ref),
      ]);
      const researchPaths = new Set<string>();
      const testingReports = featurePhaseReportsDir(options.projectRoot, options.feature, 'testing', frameworkRoot);
      const testingNotes = path.join(receiptDirPath(options.projectRoot, options.feature, 'testing'), 'notes.md');
      const factsPath = resolveFactsAbsPath(options.projectRoot, options.feature);
      const isResearchInput = (source: string): boolean => {
        const absolute = path.resolve(options.projectRoot, source);
        // Receipt/trace references establish previous checking results.
        // Current decisions still consume them through their original evidence readers.
        return absolute !== factsPath && (absolute !== testingNotes && !isInsideProjectRoot(testingReports, absolute)
          || requirementSourceFiles?.some(file => path.resolve(options.projectRoot, file) === absolute) === true);
      };
      // §5.1.1a R-target collection: a `design-decision` / `acceptance-definition` derive basis is
      // the historical file that TRIGGERED a revision, not a current target of any phase. Collecting
      // it here re-enters it into `factsContext.source_paths` / `testTargets` and the phase evidence,
      // so withdrawing that edit would make the responsible phase stale again (review B4). Every
      // other kind's derive basis stays — those ARE the current review / UT / implementation targets.
      const sourcePaths = [...new Set(scope.obligations
        .filter(obligation => !REVISION_TRIGGER_KINDS.has(obligation.kind))
        .flatMap(obligation => obligation.basis.flatMap(binding => binding.dependencies
          .filter(dep => dep.role === 'derive' && dep.exists)
          .map(dep => path.relative(options.projectRoot, resolveDependencyPath(options.projectRoot, dep.path, inferLegacyProjectRoot(options.projectRoot, scope))).replace(/\\/g, '/'))
          .filter(isResearchInput))))];
      const factsContext: FactsInvocationContext = {
        // G3：facts 身份位按载体二分——run 载体绑 run_id，feature 载体绑 feature（指纹在 facts 侧校验）。
        subject: goalRunId ? { feature: options.feature, run_id: goalRunId } : { feature: options.feature },
        ...(goalRunId ? {} : { frozen_scope_fingerprint: executionScopeFingerprint(scope) }),
        first_phase: runFirstPhase ?? scope.phase_chain[0],
        source_paths: sourcePaths, required_input_snippets: [],
      };
      const factsLookup = { projectRoot: options.projectRoot, frameworkRoot, feature: options.feature,
        phase: options.phase, runId: goalRunId, attemptId: options.goalAttemptId, featuresDir: options.featuresDir, authorityReaders: options.authorityReaders };
      // A scope revision can revoke a phase proof while the same signed CU author still supplies its next formal check.
      const returned = goalRunId && options.purpose === 'bound-verifier' ? loadFormalFactsObservation({ ...factsLookup, runId: goalRunId }, true) : undefined;
      const admitted = goalRunId && options.purpose !== 'design-authority-probe'
        ? returned?.context ?? loadFactsInvocationContext({ ...factsLookup, runId: goalRunId })
          ?? loadCompletedFactsBaseline(options, goalRunId, frameworkRoot)
        : undefined;
      let factsRebuildReason: string | undefined;
      if (options.purpose !== 'design-authority-probe' && fs.existsSync(factsPath)) {
        const raw = fs.readFileSync(factsPath, 'utf8');
        const { fm, error } = parseContextExploration(raw);
        const record = fm as Record<string, unknown>;
        const establishing = record.established_by;
        const scopeMatches = goalRunId
          ? record.run_id === goalRunId && record.frozen_scope_fingerprint === undefined
          : record.run_id === undefined && record.frozen_scope_fingerprint === executionScopeFingerprint(scope);
        const legacy = fm.schema_version === '1.0' && typeof establishing === 'string'
          && loadPhaseEvidenceManifest(options.projectRoot, options.feature, establishing)?.integrityOk
          && goalRunId && admitted?.baseline?.fingerprint === factsBaselineFingerprint(raw);
        const successor = goalRunId && loadSuccessorFactsBaseline(options, goalRunId, frameworkRoot);
        const original = typeof establishing === 'string' ? loadPhaseEvidenceManifest(options.projectRoot, options.feature, establishing) : null;
        const publishedFacts = original?.integrityOk && original.manifest.outputs.some(output =>
          path.resolve(options.projectRoot, output.path) === factsPath
          && evidenceEntryMatchesCurrentFile(options.projectRoot, output, options.feature, options.authorityReaders));
        const expectedEstablishing = successor ? successor.baseline?.established_by
          : admitted?.baseline?.established_by ?? (publishedFacts ? establishing : factsContext.first_phase);
        if (error || fm.feature !== options.feature || record.request_sha256 !== undefined
          || typeof establishing !== 'string' || establishing !== expectedEstablishing || !scopeMatches && !legacy && !successor) {
          const owner = resolveFactsRebuildOwner({ ...options, goalRunId }, record, factsContext.first_phase);
          factsContext.first_phase = owner;
          factsRebuildReason = `facts input invalid: 核对本请求和可读依据后由 ${owner} 重新建立事实（${error ?? 'subject'}）`;
          if (options.phase !== owner) throw new Error(factsRebuildReason);
        } else {
          const declared = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((source): source is string => typeof source === 'string') : [];
          const sources = readCurrentFactsSources(options.projectRoot, declared);
          for (const source of sources.keys()) if (isResearchInput(source)) researchPaths.add(source);
          if (options.phase !== establishing || !!admitted?.baseline || successor || legacy || publishedFacts) {
            factsContext.baseline = { established_by: establishing, fingerprint: factsBaselineFingerprint(raw),
              dependencies: [...sources].map(([source, state]) => ({ path: path.resolve(options.projectRoot, source), exists: true, sha256: state.sha256, role: 'derive' })) };
          }
        }
      }
      let contractFiles: string[] = [];
      let contractModules: Array<{ name: string; package_path: string }> = [];
      let observedConstruction = false;
      const producesContracts = indexed.phase.produces.some(output => output.artifact === 'contracts@1');
      const currentContracts = new SpecLoader(options.projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(options.feature).contracts;
      try {
        let contracts: import('./types').ContractsSpec;
        try {
          contracts = readRunBoundContracts(options.projectRoot, frameworkRoot, options.feature, goalRunId, options.authorityReaders);
        } catch (error) {
          if (options.feature.startsWith('cu-')) throw error;
          if (!producesContracts) throw error;
          if (!currentContracts) throw error;
          contracts = currentContracts;
        }
        contractFiles = (contracts.files ?? []).map(file => validateProjectRelativePath(options.projectRoot, file, 'contracts.files'));
        contractModules = (contracts.modules ?? []).map(module => ({ name: module.name, package_path: module.package_path }));
        observedConstruction = ['spec', 'plan'].includes(options.phase);
      } catch {
        // Research may observe admitted construction targets before plan signs the binding.
        // This assigns evidence responsibility, not coding write permission.
        if (['spec', 'plan'].includes(options.phase)) {
          const projected = deriveBlueprintSkillInput(options.projectRoot, options.feature, frameworkRoot, 'contracts', options.authorityReaders);
          if (projected.state === 'resolved' && projected.value) {
            const contracts = projected.value as unknown as import('./types').ContractsSpec;
            contractFiles = (contracts.files ?? []).map(file => validateProjectRelativePath(options.projectRoot, file, 'contracts.files'));
            contractModules = (contracts.modules ?? []).map(module => ({ name: module.name, package_path: module.package_path }));
            observedConstruction = true;
          }
        }
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
      // plan c3f8a2d7 §3.1 起本判据只管 coding 写边界**之外**的文件；写边界内的按写边界裁决（见下方 owner 分配）。
      const normalizedSuffixes = sourceFileSuffixes.map(suffix => (suffix.startsWith('.') ? suffix : `.${suffix}`));
      const isHostSourceFile = (relative: string): boolean =>
        normalizedSuffixes.some(suffix => relative.endsWith(suffix));
      const isTestPath = (relative: string): boolean => testRoots.some(root => isInsideProjectRoot(root, path.resolve(options.projectRoot, relative)))
        || testPathPatterns.some(pattern => pattern.test(`/${relative.replace(/\\/g, '/')}`));
      const usesConstructionTargets = inputContracts.some(contract => contract.phase.inputs.some(input => input.id === 'contracts')
        && !contract.phase.produces.some(output => output.artifact === 'contracts@1'));
      const codeTargets = [...new Set([
        ...sourcePaths.filter(source => !isTestPath(source) && fs.existsSync(path.resolve(options.projectRoot, source))),
        ...(usesConstructionTargets ? contractFiles.filter(file => !isTestPath(file) && fs.existsSync(path.resolve(options.projectRoot, file))) : []),
      ])];
      const partitionedTestTargets = [...new Set([
        ...sourcePaths.filter(isTestPath),
        ...(usesConstructionTargets ? contractFiles.filter(file => isTestPath(file) && fs.existsSync(path.resolve(options.projectRoot, file))) : []),
      ])];
      const testTargets = consumes('derive.test-targets') ? partitionedTestTargets : [];
      const ownerOf = (kind: string, sourceId: string): string | undefined => scope.obligations.find(obligation => obligation.kind === kind)?.owner_phase
        ?? [...contractIndex].find(([, value]) => value.phase.produces.some(output => output.kind === 'source' && output.id === sourceId))?.[0];
      const codeOwner = ownerOf('implementation', 'implementation');
      const testOwner = ownerOf('unit-evidence', 'ut_source_and_dag');
      const phaseIndex = scope.phase_chain.indexOf(options.phase);
      const mayAdvance = (owner: string | undefined): owner is string => !!owner && (unitAuthor
        ? scope.obligations.some(obligation => obligation.owner_phase === owner && obligation.applicability === 'required') : (
        owner === options.phase
        || (phaseIndex >= 0 && scope.phase_chain.indexOf(owner) > phaseIndex)
        || producesContracts
        || (['spec', 'plan'].includes(options.phase) && scope.obligations.some(obligation => obligation.owner_phase === owner && obligation.applicability === 'required'))
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
      ));
      const inventory = loadArtifactInventory(frameworkRoot);
      const originalOwner = !!admitted || authority?.source === 'feature';
      const ownsDesignOutput = (binding: import('./capability-resolution').InputBinding): boolean =>
        phaseOwnsDesignOutput(indexed.phase.produces, scope, options.phase, binding)
        || originalOwner && binding.dependencies.some(dependency => {
          const file = resolveDependencyPath(options.projectRoot, dependency.path, inferLegacyProjectRoot(options.projectRoot, scope));
          return isInsideProjectRoot(options.projectRoot, file) && sha256File(file) !== dependency.sha256;
        }) && phaseOwnsDesignOutput(indexed.phase.produces,
          { obligations: scope.obligations.map(obligation => ({ ...obligation, satisfied_by: [] })) }, options.phase, binding);
      const projectedUseCases = options.phase === 'plan'
        ? deriveBlueprintSkillInput(options.projectRoot, options.feature, frameworkRoot, 'contracts', options.authorityReaders).artifacts?.['use-cases@1']
        : undefined;
      const requiredOutputs = indexed.phase.produces.flatMap(output => inventory.artifacts.find(artifact => artifact.id === output.artifact)?.paths ?? []).filter(name => {
        const base = path.basename(name);
        if (options.phase === 'coding' && base === 'upstream-issues.md') return false;
        if (options.phase === 'ut' && base === 'mock-plan.yaml') return resolveFeatureArtifact(options.projectRoot, options.feature, name).exists;
        if (!['spec', 'plan'].includes(options.phase)) return true;
        if (base === 'spec.md' || base === 'plan.md') return scope.requested_results.includes(name) || scope.requested_results.includes(base);
        if (base === 'use-cases.yaml') return !!projectedUseCases || resolveFeatureArtifact(options.projectRoot, options.feature, name).exists;
        if (['ui-spec.yaml', 'ref-elements.yaml', 'asset-manifest.yaml', 'visual-parity.yaml'].includes(base)) return scope.obligations.some(obligation => obligation.kind === 'visual-evidence' && obligation.applicability === 'required');
        return true;
      });
      const obligations: PhaseInputContext['obligations'] = {};
      for (const obligation of scope.obligations) {
        const previous = obligations[obligation.kind];
        obligations[obligation.kind] = previous === 'required' || obligation.applicability === 'required' ? 'required'
          : previous === 'unknown' || obligation.applicability === 'unknown' ? 'unknown' : 'not_applicable';
      }
      factsContext.source_paths = [...new Set([
        ...researchPaths,
        ...(consumes('derive.codebase') ? codeTargets : []),
        ...(consumes('derive.test-targets') ? testTargets : []).filter(file => fs.existsSync(path.resolve(options.projectRoot, file))),
      ])];
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
      // plan c3f8a2d7 §3.1：与运行时写入归属同一裁决——写边界把文件判给实现阶段的 source 域即为源码，
      // 不看后缀（产品资源如 string.json）；写边界之外仍只认后缀。边界只解析一次，无施工绑定
      //（spec / plan 合法状态）或实现阶段未解析时不扩大归属，沿用后缀筛选。
      let codeBoundary: ReturnType<typeof resolveFactsWriteBoundary> | null | undefined;
      const inCodeWriteBoundary = (file: string): boolean => {
        try {
          if (codeBoundary === undefined) {
            const boundary = resolveFactsWriteBoundary({ projectRoot: options.projectRoot, frameworkRoot, feature: options.feature, runId: goalRunId, phase: options.phase, authorityReaders: options.authorityReaders }, scope,
              observedConstruction ? contractModules : undefined);
            codeBoundary = boundary.unresolvedSourcePhases.includes(codeOwner!) ? null : boundary;
          }
          const granted = codeBoundary && resolvePhasePathOwnership(codeBoundary, file);
          return !!granted && granted.owner === codeOwner && granted.roles.some(role => role.kind === 'source');
        } catch { codeBoundary ??= null; return false; }
      };
      if (mayAdvance(codeOwner)) for (const file of [...new Set([...contractFiles, ...sourcePaths])].filter(file => !isTestPath(file) && (isHostSourceFile(file) || inCodeWriteBoundary(file)))) {
        if (unitAuthor || codeOwner === options.phase || historical.has(file)) owners.push([file, codeOwner]);
      }
      if (mayAdvance(testOwner)) for (const file of [...new Set([...contractFiles.filter(isTestPath), ...sourcePaths.filter(isTestPath)])]) {
        if (unitAuthor || testOwner === options.phase || historical.has(file)) owners.push([file, testOwner]);
      }
      factsContext.source_owners = Object.fromEntries(owners);
      if (unitAuthor) {
        factsContext.source_owners = Object.fromEntries(Object.entries(factsContext.source_owners)
          .filter(([source, owner]) => mayAdvance(owner) && resolveFactsPhaseOwnedSources({ projectRoot: options.projectRoot,
            frameworkRoot, feature: options.feature, phase: owner, runId: goalRunId, authorityReaders: options.authorityReaders }, factsContext).has(source)));
      }
      return { requirement, requirementSourceFiles, codeTargets, testTargets, factsContext, ...(factsRebuildReason ? { factsRebuildReason } : {}),
        inputContext: { schema_version: '1.1', subject: { feature: options.feature },
          obligations,
          expected_bindings: expectedBindings.map(binding => {
            const projected = binding.source.kind === 'derive' && binding.source.provider_id === 'derive.codebase'
              ? projectSourceFileBinding(options.projectRoot, binding, codeTargets, researchPaths, partitionedTestTargets, inferLegacyProjectRoot(options.projectRoot, scope))
              : binding.source.kind === 'derive' && binding.source.provider_id === 'derive.test-targets'
                ? projectSourceFileBinding(options.projectRoot, binding, testTargets, researchPaths, codeTargets, inferLegacyProjectRoot(options.projectRoot, scope)) : binding;
            return options.phase === 'testing' && projected.input_id === 'acceptance' ? { ...projected, input_id: 'cases' } : projected;
          }).filter(binding => !ownsDesignOutput(binding) && indexed.phase.inputs.some(input => input.id === binding.input_id)),
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
