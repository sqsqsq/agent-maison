// ============================================================================
// capability-resolution-entry-input.ts — goal/CLI input bridge for pre-check resolution
// ============================================================================

import type { PhaseInputContext } from './capability-resolution';
import { isExecutionSourceBasis } from './execution-scope';
import type { FactsInvocationContext } from './context-facts';
import { loadGoalManifestFromRun } from './goal-manifest';
import * as fs from 'fs';
import * as path from 'path';
import { loadFrozenExecutionScope } from './goal-run-creation';
import { loadFeatureContracts, phaseContractIndex, loadArtifactInventory } from './skill-contract';
import { resolveFactsAbsPath, factsBaselineFingerprint } from './context-facts';
import { parseContextExploration } from './context-exploration';
import { loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';
import { resolveFeatureArtifact } from '../../config';
import { featuresDirPath, enumerateFeatures, featureFilePath, receiptDirPath, featurePhaseReportsDir } from '../../config';
import { validateProjectRelativePath, isInsideProjectRoot } from './project-relative-path';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import { stableStringify } from './phase-evidence-manifest';
import { readRunBoundContracts } from './capability-resolution';
import { resolveGoalRunBaseline } from './goal-run-baseline';
import { diffChangedFilesWithStatus } from './git-diff';

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
  frameworkRoot?: string;
  explicitAdhocCases?: string;
  invocation?: { inputContext: PhaseInputContext; factsContext: FactsInvocationContext; requirement?: string; testTargets?: string[] };
}

export interface CapabilityResolutionEntryInput {
  inputContext?: PhaseInputContext;
  factsContext?: FactsInvocationContext;
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
    const { inputContext, factsContext, requirement, testTargets } = options.invocation;
    const subject = inputContext.subject;
    if ('feature' in subject ? subject.feature !== options.feature : !!options.feature || !/^[0-9a-f]{64}$/.test(subject.request_sha256)) {
      throw new Error('capability entry subject mismatch');
    }
    const factsSubject = factsContext.subject;
    if ('feature' in subject
      ? !('feature' in factsSubject) || factsSubject.feature !== subject.feature
      : !('request_sha256' in factsSubject) || factsSubject.request_sha256 !== subject.request_sha256) throw new Error('capability/facts subject mismatch');
    if (testTargets?.some(target => !factsContext.source_paths.includes(target))) throw new Error('facts do not cover explicit request targets');
    if (options.goalRunId) {
      const manifest = loadGoalManifestFromRun(options.projectRoot, options.goalRunId, { feature: options.feature, featuresDir: options.featuresDir });
      if (!('run_id' in factsSubject) || factsSubject.run_id !== options.goalRunId) throw new Error('facts run identity mismatch');
      if (!factsContext.baseline && manifest.phase_chain?.[0] !== factsContext.first_phase) throw new Error('facts establishing phase differs from frozen run');
      if (requirement !== undefined && requirement.trim() !== manifest.requirement?.trim()) throw new Error('explicit requirement differs from frozen run');
    }
    return { inputContext, factsContext, requirement, testTargets, adhocCases: options.explicitAdhocCases };
  }
  let requirement: string | undefined;
  let requirementSourceFiles: string[] | undefined;
  const goalRunId = options.goalRunId?.trim();
  if (goalRunId) {
    const manifest = loadGoalManifestFromRun(options.projectRoot, goalRunId, {
      feature: options.feature,
      featuresDir: options.featuresDir,
    });
    requirement = manifest.requirement?.trim() || undefined;
    requirementSourceFiles = manifest.requirement_source_files;
    const scope = loadFrozenExecutionScope(options.projectRoot, options.feature, goalRunId);
    if (scope) {
      const frameworkRoot = options.frameworkRoot ?? path.resolve(__dirname, '../../..');
      const indexed = phaseContractIndex(loadFeatureContracts(frameworkRoot)).get(options.phase);
      if (indexed?.contract.schema_version !== '1.1') throw new Error('execution scope requires phase contract 1.1');
      const bindings = scope.obligations.flatMap(obligation => obligation.basis);
      const ownsDesignOutput = (binding: import('./capability-resolution').InputBinding): boolean => ['spec', 'plan'].includes(options.phase)
        && binding.source.kind === 'artifact' && indexed.phase.produces.some(output => output.artifact === (binding.source as { artifact: string }).artifact)
        && scope.obligations.some(obligation => obligation.owner_phase === options.phase && obligation.applicability === 'required' && !obligation.satisfied_by?.length);
      const expectedBindings = scope.obligations.flatMap(obligation => [
        ...obligation.basis.filter(binding => !binding.dependencies.length || !binding.dependencies.every(dep => isExecutionSourceBasis(options.projectRoot, scope, obligation, dep))),
        ...(obligation.satisfied_by ?? []).filter(ref => 'input_id' in ref),
      ]);
      const sourcePaths = [...new Set(bindings.flatMap(binding => binding.dependencies.filter(dep => dep.role === 'derive' && dep.exists).map(dep => path.relative(options.projectRoot, dep.path).replace(/\\/g, '/'))))];
      if (options.phase === 'review' && scope.obligations.some(obligation => obligation.kind === 'implementation' && obligation.applicability === 'required')) {
        const contracts = readRunBoundContracts(options.projectRoot, frameworkRoot, options.feature, goalRunId);
        const baseline = resolveGoalRunBaseline(options.projectRoot, options.feature, goalRunId);
        if (!baseline.available) throw new Error(baseline.reason);
        const diff = diffChangedFilesWithStatus({ projectRoot: options.projectRoot, baseRef: baseline.baseSha });
        if (!diff.executed) throw new Error(diff.error ?? 'review diff unavailable');
        for (const entry of diff.entries) if (entry.status !== 'D' && contracts.files?.includes(entry.path) && !sourcePaths.includes(entry.path)) sourcePaths.push(entry.path);
      }
      const factsContext: FactsInvocationContext = {
        subject: { feature: options.feature, run_id: goalRunId }, first_phase: scope.phase_chain[0],
        source_paths: sourcePaths, required_input_snippets: [],
      };
      const factsPath = resolveFactsAbsPath(options.projectRoot, options.feature);
      if (fs.existsSync(factsPath)) {
        const raw = fs.readFileSync(factsPath, 'utf8');
        const { fm, error } = parseContextExploration(raw);
        const establishing = (fm as Record<string, unknown>).established_by;
        if (!error && typeof establishing === 'string' && establishing !== options.phase) {
          const fresh = recomputePhaseEvidenceStaleness(options.projectRoot, options.feature, [establishing], { frameworkRoot })[0];
          const evidence = loadPhaseEvidenceManifest(options.projectRoot, options.feature, establishing);
          if (fresh.verdict !== 'fresh' || !evidence?.integrityOk) {
            if (options.phase !== scope.phase_chain[0]) throw new Error(`facts baseline stale: return to ${scope.phase_chain[0]} to establish current facts`);
          } else {
            const paths = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((p): p is string => typeof p === 'string') : [];
            factsContext.baseline = { established_by: establishing, fingerprint: factsBaselineFingerprint(raw), dependencies: [...evidence.manifest.inputs, ...evidence.manifest.outputs].filter(entry => paths.includes(entry.path)).map(entry => ({ path: path.join(options.projectRoot, entry.path), exists: entry.exists, sha256: entry.sha256, role: 'derive' })) };
          }
        }
      }
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
      return { requirement, requirementSourceFiles, testTargets: sourcePaths, factsContext,
        inputContext: { schema_version: '1.1', subject: { feature: options.feature },
          obligations,
          expected_bindings: expectedBindings.map(binding => options.phase === 'testing' && binding.input_id === 'acceptance' ? { ...binding, input_id: 'cases' } : binding).filter(binding => !ownsDesignOutput(binding) && indexed.phase.inputs.some(input => input.id === binding.input_id)),
          required_outputs: requiredOutputs,
        } };
    }
  }
  const explicitAdhocCases = options.explicitAdhocCases?.trim() || '';
  return {
    ...(requirement ? { requirement } : {}),
    ...(requirementSourceFiles && requirementSourceFiles.length > 0
      ? { requirementSourceFiles }
      : {}),
    ...(explicitAdhocCases ? { adhocCases: explicitAdhocCases } : {}),
  };
}
