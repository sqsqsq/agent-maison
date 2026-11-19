import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { isCapabilitySkipped } from '../../capability-registry';
import { loadFrameworkConfig, relFeatureFile, resolveFeatureArtifact } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { inferRepoLayout } from '../../repo-layout';
import { getLastProfileHarnessLoadError, tryLoadProfileHarnessModule, tryLoadUtHostImpl } from '../../profile-host-loader';
import { isUnitUtLayer } from './acceptance-layering';
import { extractUtItBlocks } from './ut-it-blocks';
import { hasExactUtScopeTag } from './ut-tag-match';
import { isInsideProjectRoot, validateProjectRelativePath } from './project-relative-path';
import { stableStringify } from './phase-evidence-manifest';
import { readCurrentUtCaseReport } from './ut-execution-evidence';
import { readIndependentReviewOutputs, readableIssueEvidence, uniqueIssueVerification, type IssueVerificationEntry } from './repair-candidates';
import { collectNativeAcceptanceEvidence } from './verifier-material';
import { partitionConstructionFiles } from './repair-responsibility';
import { readRunBoundContracts } from './capability-resolution';
import { readScopeAcceptance } from './feature-track';
import { loadGoalManifestFromRun } from './goal-manifest';
import { SpecLoader } from './spec-loader';
import type { AcceptanceSpec, CheckContext } from './types';
import type { ExecutionScope } from './execution-scope';
import type { IdentityNeutralDigestReaders } from './identity-neutral-digest';

interface AcceptanceReviewInput {
  projectRoot: string;
  feature: string;
  frameworkRoot?: string;
  runId?: string;
  executionScope?: ExecutionScope;
  authorityReaders?: IdentityNeutralDigestReaders;
}

type StrengthReview = {
  issue: string;
  acceptance: AcceptanceSpec['criteria'][number] | AcceptanceSpec['boundaries'][number] | NonNullable<AcceptanceSpec['performance']>[number];
  tests: Array<{ file: string; name: string; candidate?: true }>;
  files: string[];
  priorProduction: string[];
  digest: string;
  attempted: boolean;
  verdict: IssueVerificationEntry | undefined;
  passed: boolean;
};

export function readTaggedAcceptanceStrength(input: AcceptanceReviewInput) {
  const { projectRoot, feature, runId, executionScope, authorityReaders } = input;
  const unit = executionScope?.obligations.some(item => item.kind === 'unit-evidence' && item.applicability === 'required');
  const review = executionScope?.obligations.some(item => item.owner_phase === 'review' && item.applicability === 'required');
  if (!unit || !review || !runId) return [];
  const gap = (issue: string, files: string[], owner: 'spec' | 'plan' | 'ut' | 'framework', action: 'verify' | 'repair' | 'wait', detail: string) =>
    ({ issue, files, gap: { owner, action, detail }, attempted: false as const, passed: false as const, verdict: undefined });
  const artifact = (file: string) => path.relative(projectRoot, resolveFeatureArtifact(projectRoot, feature, file).actualPath).replace(/\\/g, '/');
  let source: 'spec' | 'plan' | 'ut' | 'framework' = 'framework';
  let sourceFiles: string[] = [];
  try {
    const frameworkRoot = input.frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot;
    const profile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), frameworkRoot);
    if (profile.phasesDisabled.has('review') || profile.phasesDisabled.has('ut')
      || isCapabilitySkipped(profile, 'ut.compile') || isCapabilitySkipped(profile, 'ut.run')) return [];
    source = 'spec';
    sourceFiles = [artifact('acceptance.yaml')];
    const scoped = readScopeAcceptance(projectRoot, { facts: executionScope!.obligations }, { feature, frameworkRoot, authorityReaders });
    if (!scoped) return [];
    const acceptance = [...(scoped.value.criteria ?? []), ...(scoped.value.boundaries ?? []), ...(scoped.value.performance ?? [])]
      .filter(item => isUnitUtLayer(item.ut_layer));
    if (!acceptance.length) return [];
    const safeFile = (file: string): string | undefined => {
      try {
        const rel = validateProjectRelativePath(projectRoot, file, 'acceptance test evidence');
        const absolute = path.resolve(projectRoot, rel);
        return !fs.existsSync(absolute) || isInsideProjectRoot(fs.realpathSync(projectRoot), fs.realpathSync(absolute)) ? rel : undefined;
      } catch { return undefined; }
    };
    source = 'plan';
    sourceFiles = [artifact('contracts.yaml')];
    const contracts = readRunBoundContracts(projectRoot, frameworkRoot, feature, runId, authorityReaders, executionScope!);
    source = 'framework';
    sourceFiles = [];
    const host = tryLoadUtHostImpl(profile.profileDir);
    if (!host) throw new Error(getLastProfileHarnessLoadError() ?? '找不到当前 profile 的 UT 读取器');
    const ut = require('../check-ut') as typeof import('../check-ut');
    const harnessRoot = path.join(frameworkRoot, 'harness');
    const loader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
    const ctx: CheckContext = { projectRoot, feature, frameworkRoot, harnessRoot, phase: 'ut', resolvedProfile: profile,
      frameworkRel: path.relative(projectRoot, frameworkRoot).replace(/\\/g, '/'),
      phaseRule: loader.loadPhaseRule('ut'),
      featureSpec: { feature, acceptance: scoped.value, contracts } };
    source = 'ut';
    sourceFiles = [relFeatureFile(projectRoot, feature, 'ut/reports/coverage-evidence.json')];
    const { allUtFiles, targetResolution } = ut.loadUtCoverageTargets(ctx, host, runId);
    if (targetResolution.mode !== 'cover_feature_change') return [];
    const coverage = ut.inspectCoverageEvidence(ctx);
    if (coverage.status === 'invalid') return [gap('ut_coverage_evidence_present', [coverage.relPath], 'ut', 'repair',
      '修复当前 UT 覆盖映射后再核验断言强度。' + coverage.errors.join('；'))];
    const dags = ut.loadDagFiles(ctx);
    if (dags.issues.length) return [gap('dag_files_parseable', dags.issues.map(issue => issue.path), 'ut', 'repair',
      '修复当前 UT 的 DAG 后再核验断言强度。' + dags.issues.map(issue => issue.path + ' ' + issue.error).join('；'))];
    if (dags.files.some(({ dag }) => dag.use_case)) {
      source = 'plan';
      sourceFiles = [artifact('use-cases.yaml')];
      const { useCases, shape_issues } = loader.loadFeatureSpec(feature);
      const errors = shape_issues?.filter(issue => issue.includes('use-cases.yaml')) ?? [];
      if (errors.length) throw new Error(errors.join('；'));
      ctx.featureSpec.useCases = useCases;
      source = 'ut';
      sourceFiles = [coverage.relPath];
    }
    const resolveCases = ut.readUtAcceptanceCases(ctx, targetResolution.targetCaseView, dags.files, coverage);
    const candidates = acceptance.map(item => ({ item, ...resolveCases(item) }));
    const discovered = new Map(allUtFiles.map(file => [file.path, file.content]));
    let caseNames: Map<string, string[]> | undefined;
    const readCaseNames = () => caseNames ??= new Map(allUtFiles.map(file => [file.path, extractUtItBlocks(file.content).map(test => test.name)]));
    const parsed = new Map([...new Set(candidates.flatMap(candidate => candidate.cases.map(test => test.file)))].map(file => {
      sourceFiles = [file];
      if (!safeFile(file)) throw new Error('测试源码越出项目范围 ' + file);
      const bytes = fs.readFileSync(path.resolve(projectRoot, file));
      if (bytes.toString('utf8') !== discovered.get(file)) throw new Error('测试源码已变化，重新读取 ' + file);
      return [file, createHash('sha256').update(bytes).digest('hex')] as const;
    }));
    sourceFiles = [coverage.relPath];
    const answers = readIndependentReviewOutputs(projectRoot, feature, runId);
    let executed: Map<string, Set<string>> | undefined;
    let signedExecution: ReturnType<typeof readCurrentUtCaseReport> | undefined;
    const currentExecution = () => {
      if (signedExecution === undefined) signedExecution = readCurrentUtCaseReport(input);
      return signedExecution;
    };
    const executions = (): Map<string, Set<string>> => {
      if (executed) return executed;
      executed = new Map();
      try {
        const native = tryLoadProfileHarnessModule<typeof import('../../../profiles/hmos-app/harness/execution-key')>(profile.profileDir, 'execution-key');
        const hdc = tryLoadProfileHarnessModule<typeof import('../../../profiles/hmos-app/harness/hdc-runner')>(profile.profileDir, 'hdc-runner');
        const host = tryLoadProfileHarnessModule<typeof import('../../../profiles/hmos-app/harness/ut-host-impl')>(profile.profileDir, 'ut-host-impl');
        if (!native || !hdc || !host) return executed;
        const observed = currentExecution();
        if (!observed) return executed;
        const { report } = observed;
        const originals = collectNativeAcceptanceEvidence({ ...input, phase: 'review', subjectId: null, testSources: [...parsed.keys()] }, observed);
        const originalPaths = new Set(originals.map(entry => entry.label));
        const key = originals.find(entry => entry.label.endsWith('/' + native.EXECUTION_KEY_FILE));
        if (!key) return executed;
        const record = JSON.parse(fs.readFileSync(path.resolve(projectRoot, key.label), 'utf8')) as import('../../../profiles/hmos-app/harness/execution-key').ExecutionKeyRecord;
        if (record.outcome !== 'success' || Date.parse(report.timestamp) < Date.parse(record.run_started_at)) return executed;
        if (record.goal_invocation && record.goal_invocation.run_id !== runId) {
          const lineage = new Set<string>();
          let manifest = loadGoalManifestFromRun(projectRoot, runId, { feature });
          const requirement = manifest.requirement;
          while (manifest.requirement === requirement && !lineage.has(manifest.run_id)) {
            lineage.add(manifest.run_id);
            if (!manifest.successor_of) break;
            manifest = loadGoalManifestFromRun(projectRoot, manifest.successor_of, { feature });
          }
          if (!lineage.has(record.goal_invocation.run_id)) return executed;
        }
        const modules = native.utExecutionModules(record);
        const owners = modules.flatMap(name => (contracts.modules ?? []).filter(module => module.name === name));
        if (owners.length !== modules.length || host.currentUtExecutionBuildSha(projectRoot, owners) !== record.inputs.hap_sha256_full
          || !record.inputs.hap_sha256_full) return executed;
        for (const module of modules) {
          const frozen = path.posix.dirname(key.label);
          const log = path.posix.join(frozen, 'frozen.hdc-test.' + module + '.log');
          const result = path.posix.join(frozen, 'frozen.ut-result.' + module + '.json');
          if (!originalPaths.has(log) || !originalPaths.has(result)) continue;
          const nativeResult = hdc.parseHypiumStdout(fs.readFileSync(path.resolve(projectRoot, log), 'utf8'));
          if (nativeResult && nativeResult.failed === 0 && nativeResult.total > 0
            && host.utModuleRoundSucceeded(JSON.parse(fs.readFileSync(path.resolve(projectRoot, result), 'utf8')))) {
            executed.set(module, new Set((nativeResult.passed_tests ?? []).map(test => test.test)));
          }
        }
      } catch { /* A missing or damaged execution original leaves the source verdict reusable. */ }
      return executed;
    };
    return candidates.flatMap<StrengthReview | ReturnType<typeof gap>>(({ item, cases, required, evidenceFiles }) => {
      const id = item.id.toUpperCase();
      const issue = 'acceptance_test_strength_' + id;
      if (!cases.length) return required ? [gap(issue, evidenceFiles, 'ut', 'repair', `${id} 找不到可核验的实际 it()。请将对应的覆盖映射或分支指向当前责任域的具名用例，再跑 UT。`)] : [];
      const testFiles = [...new Set(cases.map(test => test.file))].sort();
      const indirect = cases.filter(test => !hasExactUtScopeTag(test.name, item.id))
        .map(test => test.file + '#' + test.name).sort();
      const candidateNames = cases.filter(test => 'candidate' in test).map(test => test.file + '#' + test.name).sort();
      const digest = createHash('sha256').update(stableStringify({ item, tests: testFiles.map(file => [file, parsed.get(file)]),
        ...(indirect.length ? { indirect } : {}), ...(candidateNames.length ? { candidates: candidateNames } : {}) })).digest('hex');
      const signed = answers.filter(answer => answer.material[issue]?.includes(digest));
      const priorProduction = (signed.map(answer => uniqueIssueVerification(answer.entries, issue)?.production_paths)
        .find(paths => paths !== undefined) ?? []).map(safeFile).filter((file): file is string => !!file);
      const verdicts = signed.map(answer => {
        const row = uniqueIssueVerification(answer.entries, issue);
        if (!row || !testFiles.every(answer.matchesCurrent)) return null;
        const evidence = row.evidence!;
        const paths = readableIssueEvidence(projectRoot, evidence, { feature }).map(ref => ref.label);
        const production = (row.production_paths ?? []).filter(file => !testFiles.includes(file));
        const source = partitionConstructionFiles(projectRoot, profile.profileDir, { ...contracts,
          files: production.filter(file => paths.includes(file)) }).implementation
          .filter(file => /\.(?:[cm]?[jt]sx?|ets)$/.test(file));
        const asserted = cases.filter(test => {
          if (!paths.includes(test.file) || !evidence.includes(test.name)) return false;
          // Remove mentions of other actual names before deciding whether this candidate was named.
          let remaining = [evidence];
          for (const names of readCaseNames().values()) for (const name of names) {
            if (name !== test.name && name.includes(test.name)) remaining = remaining.flatMap(part => part.split(name));
          }
          return remaining.some(part => part.includes(test.name));
        });
        const staleSource = source.length !== production.length || !source.every(answer.matchesCurrent)
          || row.verdict === 'refuted' && (!source.length || !asserted.length);
        if (staleSource) return null;
        return { row, source, asserted };
      });
      const verdict = verdicts[0] && verdicts.every(other => !other || other.row.verdict === verdicts[0]!.row.verdict) ? verdicts[0] : null;
      const observed = verdict?.row.verdict === 'refuted' ? currentExecution() : null;
      const passed = !!observed && verdict!.source.every(observed.current) && verdict!.asserted.every(test => {
        const exact = observed.report.checks.filter(check => check.id === test.name && check.status === 'PASS' && check.affected_files?.includes(test.file));
        if (!observed.current(test.file) || exact.length !== 1) return false;
        const owners = contracts.modules?.filter(candidate => test.file.startsWith(candidate.package_path.replace(/\/$/, '') + '/')) ?? [];
        if (owners.length !== 1) return false;
        const modulePath = owners[0].package_path.replace(/\/$/, '') + '/';
        const named = [...readCaseNames()].flatMap(([file, names]) => file.startsWith(modulePath) ? names.filter(name => name === test.name) : []);
        if (named.length !== 1) return false;
        if (observed.passed.includes(exact[0]) && observed.originals(exact[0]).length) return true;
        return executions().get(owners[0].name)?.has(test.name) === true;
      });
      return [{ issue, acceptance: item, tests: cases, files: testFiles, priorProduction, digest, attempted: !!verdicts[0], verdict: verdict?.row, passed }];
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const issue = source === 'ut' ? 'ut_coverage_evidence_resolves' : source === 'framework' ? 'ut_profile_host_missing' : 'required_check_conclusion';
    return [gap(issue, sourceFiles, source, source === 'framework' ? 'wait' : 'verify',
      `当前验收断言强度材料不可读。恢复 ${source} 的原输入后重验：${detail}`)];
  }
}

