import { runUnitCasesAsync } from '../utils/unit-cases';
import { testCliArgs } from '../utils/test-cli-args';
import { resolveValidationOnlyEligibility } from '../../scripts/utils/goal-runner-phase';
import { writeRunSummaryBase } from '../../harness-runner';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { checkContractFileReferenceClosure } from '../../scripts/check-plan';
import { UT_REAL_ASSERTION_CHECK } from './repair-candidates.unit.test';
import assert from 'assert';
import { repairResponsibilityContext, resolveRepairResponsibility } from '../../scripts/utils/repair-responsibility';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { execFileSync } from 'child_process';
import { runRuntimeTestChild, withRuntimeTest } from '../utils/runtime-test-control';
import { ensureFeatureExecutionScopeFrozen, readFeatureFrozenScope, featureFrozenScopePath, featureEffectiveScope, appendFeatureScopeRevision, registerFeatureScopeTransfer, applyFeatureScopeRevisionsThenMaybeComplete } from '../../scripts/utils/feature-execution-scope';
import { resolveEffectiveDiffBaseline } from '../../scripts/utils/git-diff';
import { resolveBirthExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { checkFactsArtifact, factsBaselineFingerprint } from '../../scripts/utils/context-facts';
import { resolveFeatureTrack, resolvePhaseChain } from '../../scripts/utils/runtime-policy';
import { loadFeatureTrackDecl, resolveScopeRevisionProposal } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveBirthScopeForManifest } from '../../scripts/utils/feature-execution-scope';
import { resolveSuccessorExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { loadWorkflowSpec } from '../../workflow-loader';
import { __testing_setInsideRecordWriteLock, __testing_setBeforeStaleLockReclaim, detectLiveFeatureLock } from '../../scripts/utils/feature-execution-scope';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import { tryAcquireLock, releaseLock } from '../../scripts/utils/goal-run-lock';
import { buildGoalManifestFromInput, resolveRequirementInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { runUiDiffWithinDeclaredFiles } from '../../scripts/utils/ui-scope-gate';
import { featureTrackDeclPath } from '../../scripts/utils/feature-track';
import { SCOPE_REVISION_FIELDS as SCOPE_REVISION_FIELDS_CONST } from '../../scripts/utils/goal-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { writePhaseSummary, writePhaseReceipt, writeReceiptManifestPointer } from '../utils/completion-chain-seed';
import {
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
} from '../../scripts/utils/phase-evidence-manifest';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';
import { createHash } from 'crypto';
import { stableStringify, loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { designScopeRevisionChecks, checkTypedConstructionContent } from '../../scripts/utils/blueprint-skill-projection';
import { resolvePhaseWriteBoundary, resolvePhasePathOwnership } from '../../scripts/utils/phase-write-boundary';
import { clearFrameworkConfigCache, loadFrameworkConfig, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { resolveCapabilityInputs, projectSourceFileBinding, type InputBinding } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput, resolveFactsPhaseOwnedSources, resolveFeaturePhaseCapabilityInput } from '../../scripts/utils/capability-resolution-entry-input';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { buildSummaryRepairCandidates, collectReviewRepairCandidates, itemFingerprintOf, scopeRevisionInputFromRepairCandidates } from '../../scripts/utils/repair-candidates';
import { prepareGoalModeRun, runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { runRevalidate, REVALIDATION_RECORD_FILE } from '../../scripts/utils/revalidate';
import { completedCheckResultsFromOutput, readCurrentDispositionInput, readPhaseChecks, generateFeatureCompletion, inspectCompletionRecord, verifyReusedExecutionScope, executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { writeReceiptProjection } from '../../scripts/utils/receipt-scaffold';
import { assessFeature, assessmentReasons } from '../../scripts/utils/feature-assessment';

/** plan b2d7f4e9：唯一评估入口 assessFeature 的 VALID/INVALID 投影（complete ⇔ VALID）。 */
function completionOf(opts: { projectRoot: string; feature: string; expectedChain: string[]; expectedTrack: string; frameworkRoot?: string }): { verdict: 'VALID' | 'INVALID'; reasons: string[] } {
  const assessment = assessFeature(opts.projectRoot, opts.feature, opts);
  return { verdict: assessment.complete ? 'VALID' : 'INVALID', reasons: assessmentReasons(assessment) };
}
import { loadFrozenExecutionScope, loadEffectiveExecutionScope, resolveEffectiveScopeSource } from '../../scripts/utils/goal-run-creation';
import { resolveUpstreamPhaseChain } from '../../scripts/utils/upstream-verdict-gate';
import { featureRequirementBinding, collectResolvedScopeFacts, prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { uiSpecAbsPath } from '../../scripts/utils/ui-spec-shared';
import * as os from 'os';
import type { AcceptanceSpec, CheckContext } from '../../scripts/utils/types';
import { resolveExecutionScope, validateExecutionScope, executionScopeFingerprint, executionCompletionPhases, hasNoTestingObligation, readScopeRevisionUserControl, applyScopeUserControl, findSubtractedRequiredObligations, assertRevisionKeepsRequiredObligations, hasNewSourcedFact, effectiveScopeView, scopeProofHistory, projectScopeSchedule, affectedScopePhases, isExecutionSourceBasis, type ScopeHistoryEvent, type ExecutionScope, type ExecutionScopeInput, type ResolvedScopeFacts } from '../../scripts/utils/execution-scope';
import { applyScopeRevisions, resolveRunBaseline, revokedPhasesByRevision, eventsWithScopeRevocations } from '../../scripts/utils/goal-run-creation';
import { isClosureOnlyRetryPending, loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { SCOPE_REVISION_FIELDS } from '../../scripts/utils/goal-manifest';
import type { WorkflowSpec } from '../../workflow-loader';
import type { UnitCaseResult } from '../run-unit';

const workflow: WorkflowSpec = {
  schema_version: '1.2', name: 'scoped', auto_chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
  artifacts: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })),
};
function request(phases: string[], completion_target: 'request' | 'feature' = 'request'): ExecutionScopeInput {
  return { request: { completion_target, requested_results: ['requested-result'], requested_phases: phases }, facts: [], contract_fingerprints: [] };
}
/** Historical reader fixture only; supported harness exits no longer invoke this writer. */
function legacyFeatureCompletionFixture(input: Parameters<typeof applyFeatureScopeRevisionsThenMaybeComplete>[0]): { revisionApplied: boolean; completionPath: string } {
  const scope = featureEffectiveScope(readFeatureFrozenScope(input.projectRoot, input.feature)!);
  const chain = executionCompletionPhases(scope).map(String);
  const { originalAbs } = generateFeatureCompletion({ projectRoot: input.projectRoot, frameworkRoot: input.frameworkRoot,
    feature: input.feature, chain, workflowTrack: input.workflowTrack, runId: null,
    runDirAbs: featureFilePath(input.projectRoot, input.feature, 'completion'), phaseRunIds: {}, executionScope: scope });
  return { revisionApplied: false, completionPath: originalAbs };
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'P4 a21473 deferred required implementation keeps codebase basis historical before coding enters the birth chain', run() {
    const { root, frameworkRoot, feature } = setupRunlessProject();
    try {
      const code = 'src/demo/value.ts';
      const inputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'plan', track: 'full', testTargets: [code],
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs!;
      const current = inputs.values.codebase;
      assert(current.state === 'resolved');
      const binding = current.binding;
      const obligation = { id: 'implementation:request', kind: 'implementation', owner_phase: 'coding', applicability: 'required' as const, reason: 'original authorized implementation', basis: [binding] };
      const scope: ExecutionScope = { schema_version: '1.0', completion_target: 'feature', requested_results: ['value is 42'],
        phase_chain: ['spec','plan'], obligations: [obligation], reused_phases: [],
        unresolved: [{ obligation_id: obligation.id, needed_by: ['coding'], owner: 'spec', reason: 'visual acceptance definition missing at birth' }], policy_fingerprint: '0'.repeat(64) };
      validateExecutionScope(scope);
      execFileSync('git', ['init','-q'], { cwd: root }); fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
      execFileSync('git', ['add','.'], { cwd: root });
      execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','base'], { cwd: root });
      const runId = 'p4-deferred-source';
      const manifest = buildGoalManifestFromInput({ feature, run_id: runId, requirement: 'value is 42', adapter: 'generic',
        start_phase: 'spec', end_phase: 'plan', chain_override: scope.phase_chain, execution_scope: scope,
        unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root, featuresDir: 'doc/features' });
      createGoalRun({ projectRoot: root, manifest, chain: scope.phase_chain });
      const dep = binding.dependencies.find(row => row.path.endsWith('value.ts'))!;
      assert(dep && dep.role === 'derive');
      assert(!isExecutionSourceBasis(root, scope, obligation, dep), 'runless research must still bind the original code');
      assert(isExecutionSourceBasis(root, scope, obligation, dep, runId));
      fs.writeFileSync(path.join(root, code), 'export const value: number = 42;\n');
      const issues = executionScopeEvidenceIssues(root, feature, scope, undefined, runId, undefined, frameworkRoot);
      assert(!issues.some(issue => issue.includes('input binding stale')), issues.join('; '));
      assert(!isExecutionSourceBasis(root, scope, obligation, { ...dep, role: 'artifact' }, runId));
      assert(!isExecutionSourceBasis(root, scope, obligation, { ...dep, path: path.join(path.dirname(root), 'outside.ts') }, runId));
      assert(!isExecutionSourceBasis(root, scope, { ...obligation, applicability: 'not_applicable' }, dep, runId));
      assert(!isExecutionSourceBasis(root, scope, { ...obligation, kind: 'acceptance-context' }, dep, runId));
      const proof = { ...scope, unresolved: [], obligations: [{ ...obligation, satisfied_by: [binding] }] };
      assert(executionScopeEvidenceIssues(root, feature, proof, undefined, runId, undefined, frameworkRoot).some(issue => issue.includes('input binding stale')),
        'an input supplied as satisfaction proof remains current and cannot borrow the birth-basis exemption');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '66457a08 fidelity uses dereferenced real requirements, never writes or promotes fallback text', run() {
    const { root, frameworkRoot, feature } = setupRunlessProject();
    try {
      const { fidelityIntentSsotPath, capabilitySnapshotPath } = require('../../scripts/utils/fidelity-shared') as typeof import('../../scripts/utils/fidelity-shared');
      const { initializeFidelityRouting } = require('../../scripts/utils/goal-preflight') as typeof import('../../scripts/utils/goal-preflight');
      fs.mkdirSync(path.join(root, 'doc/requirements'), { recursive: true });
      fs.writeFileSync(path.join(root, 'doc/requirements/visual.md'), '页面必须逐像素 1:1 还原参考图。\n');
      const requirement = '实现 doc/requirements/visual.md 中的需求';
      const candidate = request(['coding', 'review', 'ut'], 'feature');
      const ctx = { projectRoot: root, frameworkRoot, feature };
      assert.equal(collectResolvedScopeFacts(candidate, ctx).fidelity.state, 'missing');
      assert.equal(collectResolvedScopeFacts(candidate, { ...ctx, requirement: '逐像素 1:1', requirementIsFallback: true }).fidelity.state, 'missing');
      const inferred = collectResolvedScopeFacts(candidate, { ...ctx, requirement }).fidelity;
      assert.equal(inferred.selected_fidelity, 'pixel_1to1');
      assert(!fs.existsSync(fidelityIntentSsotPath(root, feature)) && !fs.existsSync(capabilitySnapshotPath(root, feature)), 'scope inference must not initialize files');
      const prepared = prepareFeatureScopeCandidate({ ...ctx, completionTarget: 'feature', requestedResults: ['实现页面'], requestedPhases: ['spec','plan','coding','review','ut'], requirement, overwrite: true,
        impact: { userVisibleBehaviorChange: true, reason: '页面变更', basisPaths: ['src/demo/value.ts'] } });
      assert.equal(prepared.scope.phase_chain[0], 'spec');
      assert(prepared.scope.obligations.some(o => o.kind === 'visual-evidence' && o.applicability === 'required'));
      assert(!fs.existsSync(fidelityIntentSsotPath(root, feature)), 'prepare must stay zero-write for fidelity');
      const fallback = prepareFeatureScopeCandidate({ ...ctx, completionTarget: 'feature', requestedResults: ['逐像素 1:1'], requestedPhases: ['coding','review','ut'], overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '内部改动', basisPaths: ['src/demo/value.ts'] } });
      assert(!fallback.scope.phase_chain.includes('spec'), 'requested_results is not a fidelity requirement');
      const self = featureFilePath(root, feature, 'self-request.md'); fs.writeFileSync(self, '逐像素 1:1');
      assert.equal(collectResolvedScopeFacts(candidate, { ...ctx, requirement: '调整 ' + path.relative(root, self).replace(/\\/g, '/') }).fidelity.selected_fidelity, 'semantic_layout');
      const routing = initializeFidelityRouting({ ...ctx, requirement, featuresDirRel: 'doc/features', executionIdentity: `phase:${feature}:spec`, requirementProvenance: 'explicit_cli' });
      assert.equal(routing.routing.selected, inferred.selected_fidelity, 'scope and initializer must consume the same expanded text');
      const bytes = fs.readFileSync(fidelityIntentSsotPath(root, feature));
      assert.equal(collectResolvedScopeFacts(candidate, { ...ctx, requirement: '内部取值' }).fidelity.selected_fidelity, 'pixel_1to1');
      assert(fs.readFileSync(fidelityIntentSsotPath(root, feature)).equals(bytes));
      fs.writeFileSync(fidelityIntentSsotPath(root, feature), '{');
      assert.equal(collectResolvedScopeFacts(candidate, { ...ctx, requirement }).fidelity.state, 'corrupt');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '66457a08 explicit fidelity reaches birth and successor without pixel wording', run() {
    const { root, frameworkRoot, feature } = setupRunlessProject();
    try {
      const requirement = '新增账目页面';
      const ctx = { projectRoot: root, frameworkRoot, feature };
      prepareFeatureScopeCandidate({ ...ctx, completionTarget: 'feature', requestedResults: ['交付账目页面'], requestedPhases: ['plan','coding','review','ut'], requirement, overwrite: true,
        impact: { userVisibleBehaviorChange: true, reason: '新增页面', basisPaths: ['src/demo/value.ts'] } });
      const workflow = loadWorkflowSpec(frameworkRoot, 'd1');
      const born = resolveBirthScopeForManifest(root, { feature, requirement, fidelity: 'pixel_1to1' }, workflow, frameworkRoot)!;
      assert.equal(born.phase_chain[0], 'spec');
      assert(born.obligations.some(o => o.kind === 'visual-evidence' && o.applicability === 'required'));
      execFileSync('git', ['init', '-q'], { cwd: root });
      fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['-c','user.name=F','-c','user.email=f@e.test','commit','-qm','base'], { cwd: root });
      prepareGoalModeRun({ ...ctx, runId: 'fidelity-source', adapter: 'generic', requirement });
      const next = resolveSuccessorExecutionScope(root, feature, workflow, frameworkRoot, requirement, 'fidelity-source', 'pixel_1to1')!;
      assert.equal(next.phase_chain[0], 'spec');
      assert(next.obligations.some(o => o.kind === 'visual-evidence' && o.applicability === 'required'));
      const { initializeFidelityRouting } = require('../../scripts/utils/goal-preflight') as typeof import('../../scripts/utils/goal-preflight');
      const routing = initializeFidelityRouting({ ...ctx, requirement, manifestFidelity: 'pixel_1to1', featuresDirRel: 'doc/features', executionIdentity: `phase:${feature}:spec`, requirementProvenance: 'explicit_cli' });
      assert.equal(routing.routing.selected, 'pixel_1to1');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '38e5a7c2 rejected design decision keeps valid coding authority and facts ownership', run() {
    const { root, frameworkRoot, feature } = setupRunlessProject({ uiFile: true });
    try {
      const file = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(file, 'utf8')); config.project_profile.name = 'hmos-app';
      fs.writeFileSync(file, JSON.stringify(config)); clearFrameworkConfigCache();
      const requirement = '把 value 改成 42';
      const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature', requestedResults: ['value is 42'], requestedPhases: ['coding','review','ut'], requirement, overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '内部取值', basisPaths: ['src/demo/value.ts'] } });
      assert(prepared.scope.obligations.find(o => o.kind === 'design-context')?.satisfied_by?.length);
      prepared.scope.obligations.push({ id: 'design-decision:declined', kind: 'design-decision', owner_phase: 'plan', applicability: 'required', reason: 'plan 已裁定无需改契约', basis: [] });
      prepared.scope.phase_chain.unshift('plan');
      execFileSync('git', ['init','-q'], { cwd: root }); fs.writeFileSync(path.join(root,'.gitignore'), 'framework\n');
      execFileSync('git', ['add','.'], { cwd: root }); execFileSync('git', ['-c','user.name=F','-c','user.email=f@e.test','commit','-qm','base'], { cwd: root });
      const manifest = buildGoalManifestFromInput({ feature, run_id: '38-valid-contract', requirement, adapter: 'generic', start_phase: 'plan', end_phase: 'ut',
        execution_scope: prepared.scope, chain_override: prepared.scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 } }, { projectRoot: root, featuresDir: 'doc/features' });
      createGoalRun({ projectRoot: root, manifest, chain: prepared.scope.phase_chain });
      const source = 'src/demo/Page.ets';
      const boundary = resolvePhaseWriteBoundary({ projectRoot: root, frameworkRoot, feature, runId: manifest.run_id, phaseOrder: ['plan','coding','review','ut'], track: 'full', profileDir: path.join(frameworkRoot,'profiles/hmos-app'), productLayerDirs: ['src'] });
      assert.equal(resolvePhasePathOwnership(boundary, source).owner, 'coding');
      const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'coding', goalRunId: manifest.run_id, featuresDir: 'doc/features' });
      const owned = resolveFactsPhaseOwnedSources({ projectRoot: root, frameworkRoot, feature, phase: 'coding', runId: manifest.run_id },
        bridge.factsContext!);
      assert(owned.has(source), JSON.stringify([...owned]));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '4f spec 实际输入入口对齐冻结测试分组及同阶段调研增补', run() {
    const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec', 'plan', 'coding', 'review', 'ut'] });
    try {
      const configPath = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); config.project_profile.name = 'hmos-app';
      fs.writeFileSync(configPath, JSON.stringify(config)); clearFrameworkConfigCache();
      const original = ['src/demo/value.ts', 'src/demo/src/ohosTest/ets/test/value.test.ets'];
      const researched = 'src/demo/researched.ts';
      fs.mkdirSync(path.dirname(path.join(root, original[1])), { recursive: true });
      fs.writeFileSync(path.join(root, original[1]), 'export const testValue = 1;\n');
      fs.writeFileSync(path.join(root, researched), 'export const researchValue = 2;\n');
      const contractsPath = featureFilePath(root, feature, 'contracts.yaml');
      const contracts = YAML.parse(fs.readFileSync(contractsPath, 'utf8')); contracts.files = original;
      fs.writeFileSync(contractsPath, YAML.stringify(contracts));
      fs.unlinkSync(featureFilePath(root, feature, 'acceptance.yaml'));
      const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
        requestedResults: ['value is 42'], requestedPhases: ['spec','plan','coding','review','ut'], requirement: '把 value 改成 42', overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '内部取值', basisPaths: original } });
      const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      const bytes = fs.readFileSync(featureFrozenScopePath(root, feature));
      assert(prepared.scope.obligations.flatMap(o => o.basis).some(b => b.source_refs.includes(original[1])), '出生绑定必须实际带测试文件');
      const facts = featureFilePath(root, feature, 'context/facts.md'); fs.mkdirSync(path.dirname(facts), { recursive: true });
      fs.writeFileSync(facts, '---\n' + YAML.stringify({ schema_version: '1.1', feature, established_by: 'spec',
        frozen_scope_fingerprint: executionScopeFingerprint(featureEffectiveScope(frozen.record!)), source_code_paths: [...original, researched],
        ready_to_produce: true, has_blocker_coverage_risk: false }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n'
        + [...original, researched].map(file => `| ${file} | 已读原文件 | 定义输入 |`).join('\n'));
      const entry = () => resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'spec', featuresDir: 'doc/features' });
      const bridge = entry();
      assert.deepEqual(bridge.codeTargets, [original[0]]);
      assert(bridge.factsContext?.source_paths.includes(researched), JSON.stringify(bridge.factsContext));
      const inputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'spec', track: 'full', ...bridge }).inputs!;
      assert.equal(inputs.values.codebase.state, 'resolved', JSON.stringify(inputs.values.codebase));
      assert(fs.readFileSync(featureFrozenScopePath(root, feature)).equals(bytes), '投影不得改冻结范围');
      fs.appendFileSync(path.join(root, original[0]), '// real mutation\n');
      const changed = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'spec', track: 'full', ...entry() });
      assert.notEqual(changed.inputs?.values.codebase.state, 'resolved', '实际源码漂移仍须被拒');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '4f 真实 successor 保留因定义缺口未进临时执行链的 coding/review', run() {
    const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] });
    try {
      const acceptancePath = featureFilePath(root, feature, 'acceptance.yaml');
      const acceptance = fs.readFileSync(acceptancePath);
      fs.unlinkSync(acceptancePath);
      const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
        requestedResults: ['value is 42'], requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut'], requirement: '把 value 改成 42', overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '内部取值', basisPaths: ['src/demo/value.ts'] } });
      assert(!prepared.scope.phase_chain.includes('coding') && prepared.scope.obligations.some(o => o.kind === 'implementation' && o.applicability === 'required'));
      execFileSync('git', ['init', '-q'], { cwd: root });
      fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
      ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: '4f-source', adapter: 'generic', requirement: '把 value 改成 42' });
      fs.writeFileSync(acceptancePath, acceptance);
      const successor = resolveSuccessorExecutionScope(root, feature, loadWorkflowSpec(frameworkRoot, 'd1'), frameworkRoot, '把 value 改成 42', '4f-source')!;
      assert(successor.phase_chain.includes('coding') && successor.phase_chain.includes('review'), JSON.stringify(successor));
      assert(!successor.phase_chain.includes('testing'), '待定设备证据不能变成用户明确请求 testing：' + JSON.stringify(successor));
      assert.deepStrictEqual(successor.requested_results, prepared.scope.requested_results);
      assert(successor.obligations.some(o => o.kind === 'implementation' && o.applicability === 'required'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: '4f 冻结源码绑定接受测试分组和有来源的调研增补，拒绝丢失/改写/无来源增量', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-input-projection-'));
    try {
      const files = ['source.ets', 'source.test.ets', 'researched.ets'];
      for (const file of files) fs.writeFileSync(path.join(root, file), `content:${file}`);
      const initial = files.slice(0, 2);
      const value = initial.map(file => ({ path: file, content: fs.readFileSync(path.join(root, file), 'utf8') }));
      const binding: InputBinding = { input_id: 'codebase', source: { kind: 'derive', provider_id: 'derive.codebase' },
        source_refs: initial, content_fingerprint: createHash('sha256').update(stableStringify(value)).digest('hex'),
        dependencies: initial.map(file => ({ path: path.join(root, file), role: 'derive', exists: true,
          sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') })) };
      const projected = projectSourceFileBinding(root, binding, ['source.ets', 'researched.ets'], new Set(['researched.ets']), ['source.test.ets']);
      assert.deepStrictEqual(projected.source_refs, ['researched.ets', 'source.ets']);
      assert.notStrictEqual(projected, binding);
      assert.deepStrictEqual(binding.source_refs, initial, '冻结原件不改');
      assert.strictEqual(projectSourceFileBinding(root, binding, files, new Set(), []), binding, '无调研来源的增量不对齐');
      assert.strictEqual(projectSourceFileBinding(root, binding, ['source.ets'], new Set(), []), binding, '非分组造成的缺失不对齐');
      fs.writeFileSync(path.join(root, 'source.test.ets'), 'changed');
      assert.strictEqual(projectSourceFileBinding(root, binding, ['source.ets'], new Set(), ['source.test.ets']), binding, '被分走文件变更仍检查');
      fs.unlinkSync(path.join(root, 'source.test.ets'));
      assert.strictEqual(projectSourceFileBinding(root, binding, ['source.ets'], new Set(), ['source.test.ets']), binding, '冻结文件缺失仍检查');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: 'fully reused request verifies existing bindings without an empty run; stale data is rejected', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-reuse-'));
    try {
      const file = path.join(root, 'contracts.yaml'); fs.writeFileSync(file, 'files: []');
      const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const binding = { input_id: 'contracts', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, source_refs: ['contracts.yaml'], content_fingerprint: hash, dependencies: [{ path: file, exists: true, sha256: hash, role: 'artifact' as const }] };
      const input = request(['plan']); input.facts.push({ id: 'design:existing', kind: 'design-context', applicability: 'required', reason: 'existing design answers requested result', basis: [binding], satisfied_by: [binding] });
      const scope = resolveExecutionScope(input, workflow); assert.deepStrictEqual(scope.phase_chain, []);
      assert(verifyReusedExecutionScope(root, 'demo', scope).complete); assert(!fs.existsSync(path.join(root, 'doc')));
      fs.writeFileSync(file, 'files: [changed]'); assert(!verifyReusedExecutionScope(root, 'demo', scope).complete);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: 'real control dependencies remain ordered and cannot be replaced by information alone', run() {
    const binding = { input_id: 'control', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, dependencies: [], source_refs: ['contracts.yaml'], content_fingerprint: 'a'.repeat(64) };
    const input = request(['coding', 'plan']); input.control_edges = [{ before: 'plan', after: 'coding', basis: [binding] }];
    const scope = resolveExecutionScope(input, workflow); assert.deepStrictEqual(scope.phase_chain, ['plan', 'coding']);
    assert.throws(() => validateExecutionScope({ ...scope, phase_chain: ['coding', 'plan'] }), /控制顺序/);
    input.request.requested_phases = ['coding']; assert.throws(() => resolveExecutionScope(input, workflow), /控制前置/);
  } },
  { name: 'P4 mutual review and UT material reads invalidate evidence without becoming a control cycle', run() {
    const scope = resolveExecutionScope(request(['review', 'ut']), workflow);
    const reads = { inputEdges: [{ before: 'ut', after: 'review' }, { before: 'review', after: 'ut' }] };
    assert.deepEqual(projectScopeSchedule(scope, workflow, reads).phase_chain, ['review', 'ut'],
      'reading existing test material in review and the review report in UT does not require either check to finish first');
    assert.deepEqual(affectedScopePhases(['ut'], scope.phase_chain, { scope, workflow, ...reads }), ['review', 'ut'],
      'actual data consumers must still lose affected evidence when their input changes');
    const binding = { input_id: 'control', source: { kind: 'artifact' as const, artifact: 'contracts@1' }, dependencies: [], source_refs: ['contracts.yaml'], content_fingerprint: 'a'.repeat(64) };
    const controlled = { ...scope, control_edges: reads.inputEdges.map(edge => ({ ...edge, basis: [binding] })) };
    assert.throws(() => projectScopeSchedule(controlled, workflow, reads), /控制依赖存在环/,
      'a real declared control cycle remains invalid');
  } },
  { name: 'new unproven definition revokes consumer proofs while unchanged checks wait for its producer', run() {
    const birth = resolveExecutionScope(request(['spec', 'plan']), workflow);
    const prior = { ...birth, obligations: [...birth.obligations, { id: 'acceptance:handoff',
      kind: 'acceptance-definition', owner_phase: 'spec', applicability: 'required' as const, reason: 'check the first page handoff', basis: [] }] };
    const order = ['spec', 'plan'];
    const consumers = { inputEdges: [{ before: 'spec', after: 'plan' }] };
    const revision = (execution_scope: ExecutionScope) => ({ type: 'scope_revised', execution_scope, ts: '2026-11-26T13:00:00Z' });
    const view = (initial: ExecutionScope, events: ScopeHistoryEvent[], phase: string, returnedAt = '2026-11-26T12:00:00Z') =>
      scopeProofHistory(initial, events, order, undefined, workflow, consumers, { phase, returnedAt });
    const pending = view(birth, [revision(prior)], 'plan');
    assert.deepEqual([...pending.invalidated], order);
    assert.equal(pending.checkInvalidated, false);
    assert.equal(view(birth, [revision(prior)], 'spec').checkInvalidated, true);
    const signed = { ...prior, obligations: prior.obligations.map(item => item.id === 'acceptance:handoff'
      ? { ...item, satisfied_by: [{ phase: 'spec', evidence_manifest_aggregate: 'a'.repeat(64) }] } : item) };
    assert.equal(view(birth, [revision(prior), revision(signed)], 'plan').checkInvalidated, true);
    assert.equal(view(birth, [revision(prior), revision(signed)], 'plan', '2026-11-26T14:00:00Z').checkInvalidated, false);
    assert.equal(view(signed, [revision(prior)], 'plan').checkInvalidated, true);
  } },
  { name: 'acceptance layers use the existing gate; invalid layers remain unknown and implementation requires review', run() {
    const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
    const build = (layer: string) => resolveExecutionScope(request(['coding'], 'feature'), workflow, { value: { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer: layer }] } as AcceptanceSpec, binding });
    assert.deepStrictEqual(build('unit').phase_chain, ['coding', 'review', 'ut']);
    assert.deepStrictEqual(build('device').phase_chain, ['coding', 'review', 'testing']);
    const invalid = build('invalid'); assert(!invalid.phase_chain.includes('testing')); assert(invalid.unresolved.length);
  } },
  { name: 'explicit UT request neither expands phases nor claims Feature completion', run() {
    const scope = resolveExecutionScope(request(['ut']), workflow);
    assert.deepStrictEqual(scope.phase_chain, ['ut']); assert.equal(scope.completion_target, 'request');
  } },
  { name: 'acceptance is review context, explicit verification stays bounded, and missing Feature evidence remains unknown', run() {
    const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
    for (const ut_layer of ['unit', 'both']) {
      const acceptance = { value: { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer }] } as AcceptanceSpec, binding };
      assert.deepStrictEqual(resolveExecutionScope(request(['review']), workflow, acceptance).phase_chain, ['review']);
      assert.deepStrictEqual(resolveExecutionScope(request(['ut']), workflow, acceptance).phase_chain, ['ut']);
      assert.deepStrictEqual(resolveExecutionScope(request(['testing']), workflow, acceptance).phase_chain, ['testing']);
    }
    const scope = resolveExecutionScope(request(['coding'], 'feature'), workflow);
    assert.deepStrictEqual(scope.unresolved.map(gap => gap.obligation_id).sort(), ['device-evidence:pending', 'unit-evidence:pending']);
    assert.equal(executionScopeEvidenceIssues('.', 'demo', scope, undefined, undefined, undefined, path.resolve(__dirname, '../../..')).length, 2);
    assert.deepStrictEqual(scope.phase_chain, ['coding', 'review']);
    assert.equal(resolveExecutionScope(request(['review']), workflow).unresolved.length, 0);
  } },
  { name: 'empty performance is absent; real undecided performance retains unknown', run() {
    const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
    const value = { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer: 'unit' }] } as AcceptanceSpec;
    const resolve = (acceptance: AcceptanceSpec) => resolveExecutionScope(request(['coding'], 'feature'), workflow, { value: acceptance, binding });
    assert.deepStrictEqual(resolve(value), resolve({ ...value, performance: [] }));
    assert(resolve({ ...value, performance: [{ id: 'NFR-1', metric: 'latency', threshold: '100', unit: 'ms', description: 'response latency' }] }).unresolved.some(gap => gap.obligation_id === 'device-evidence:acceptance'));
  } },
  { name: 'same normalized input produces identical range and reasons', run() {
    const input = request(['coding', 'review', 'ut'], 'feature');
    assert.deepStrictEqual(resolveExecutionScope(input, workflow), resolveExecutionScope(structuredClone(input), structuredClone(workflow)));
    assert.deepStrictEqual(resolveExecutionScope(input, workflow).phase_chain, ['coding', 'review', 'ut']);
  } },
  { name: 'unknown downstream obligation does not stop safe spec investigation or become completion', run() {
    const input = request(['spec']);
    input.facts.push({ id: 'device:pending', kind: 'device-evidence', applicability: 'unknown', reason: 'acceptance not yet known', basis: [] });
    const scope = resolveExecutionScope(input, workflow);
    assert.deepStrictEqual(scope.phase_chain, ['spec']); assert.equal(scope.unresolved.length, 1);
    assert.throws(() => validateExecutionScope({ ...scope, unresolved: [] }), /未知义务被删除/);
  } },
  { name: 'new custom phase without registered rule fails instead of disappearing', run() {
    const custom: WorkflowSpec = { ...workflow, artifacts: [...workflow.artifacts, { id: 'custom', scope: 'feature', requires: [] }] };
    assert.throws(() => resolveExecutionScope(request(['ut']), custom), /缺少已注册义务/);
  } },
  { name: 'failure observations do not change scope', run() {
    const input = request(['testing']);
    const expected = resolveExecutionScope(input, workflow);
    for (const verdict of ['FAIL', 'offline', 'manual', 'report_failed']) assert.deepStrictEqual(resolveExecutionScope({ ...input, verdict } as ExecutionScopeInput, workflow), expected);
  } },
  { name: 'corrupt new scope cannot become legacy full', run() {
    for (const value of [null, {}, { schema_version: '9' }]) assert.throws(() => validateExecutionScope(value));
  } },
];
// ---------------------------------------------------------------------------
// §4.4 D0.1 acceptance matrix — pure-resolver rows. These were developed as a
// standalone probe and promoted here verbatim: they lock the anti-wash guarantees
// (candidate-declared applicability is never trusted) and must not regress.
// ---------------------------------------------------------------------------
const wf = workflow;
const req = request;
const accBinding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) };
const acc = (layer: string) => ({ value: { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer: layer }] } as AcceptanceSpec, binding: accBinding });
// An impact judgement with no source can never prune a duty, so every pure case that carries one
// names a source and supplies the reading layer's verdict for it. The resolver consumes verdicts,
// never files — that is exactly the split §4.1.0 defines.
const impactSource = { input_id: 'impact-source', source: { kind: 'derive' as const, provider_id: 'derive.codebase' as const }, dependencies: [], source_refs: ['src/impact.ts'], content_fingerprint: 'c'.repeat(64) };
const sourced = (change: boolean, reason: string) => ({ user_visible_behavior_change: change, reason, basis: [impactSource] });
const impactOk = [{ input_id: 'impact-source', ok: true, related: true, detail: 'reading-layer verdict' }];
const facts = (over?: Partial<ResolvedScopeFacts>): ResolvedScopeFacts => ({
  fidelity: { state: 'missing', visual_requested: false },
  impact_basis: [], basis: [], satisfied_by: [],
  targets: { implementation_files: [], contracts_files: [], review_targets: [], ut_targets: [] },
  impact_targets_available: false, ...(over ?? {}),
});

cases.push({ name: 'acceptance unit layer keeps chain', run() { assert.deepStrictEqual(resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit')).phase_chain, ['coding', 'review', 'ut']); } });
cases.push({ name: 'acceptance device layer keeps testing (missing impact must NOT downgrade required)', run() { assert.deepStrictEqual(resolveExecutionScope(req(['coding'], 'feature'), wf, acc('device')).phase_chain, ['coding', 'review', 'testing']); } });
cases.push({ name: 'D0.1 a valid unchanged negative impact cannot cancel an accepted device obligation', run() {
  const input = req(['coding'], 'feature');
  input.request.impact = sourced(false, 'the original implementation does not need a device');
  const resolved = resolveExecutionScope(input, wf, acc('device'), facts({ impact_basis: impactOk, impact_targets_available: true }));
  assert.equal(resolved.obligations.find(obligation => obligation.kind === 'device-evidence')?.applicability, 'required');
  assert(resolved.phase_chain.includes('testing'));
} });
cases.push({ name: 'D0.1 self-reported device not_applicable is recomputed from acceptance layering', run() {
  const i = req(['coding'], 'feature');
  i.facts.push({ id: 'device:self', kind: 'device-evidence', applicability: 'not_applicable', reason: 'self', basis: [] });
  const s = resolveExecutionScope(i, wf, acc('device'));
  assert.equal(s.obligations.find(o => o.id === 'device:self')!.applicability, 'required');
  assert(s.phase_chain.includes('testing'));
} });
cases.push({ name: 'D0.1 missing impact keeps device unknown', run() {
  const s = resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'));
  const d = s.obligations.find(o => o.kind === 'device-evidence')!;
  assert.equal(d.applicability, 'unknown'); assert.equal(d.reason, '影响依据缺失');
} });
cases.push({ name: 'D0.1 unverifiable impact scope keeps device unknown without pruning testing', run() {
  const i = req(['review'], 'feature');
  i.request.impact = sourced(false, 'review-only request');
  const scope = resolveExecutionScope(i, wf, acc('unit'), facts({ impact_basis: impactOk }));
  const d = scope.obligations.find(o => o.kind === 'device-evidence')!;
  assert.equal(d.applicability, 'unknown'); assert.equal(d.reason, '影响依据无可核验范围');
  // unknown 必须真的交代成缺口，而不是停在义务表里没人接（`validateExecutionScope` 也认这一条）
  assert(scope.unresolved.some(gap => gap.obligation_id === d.id), JSON.stringify(scope.unresolved));
} });
cases.push({ name: 'D0.1 an impact judgement without structure or source never prunes a duty', run() {
  const build = (impact: unknown) => {
    const i = req(['coding'], 'feature');
    (i.request as { impact?: unknown }).impact = impact;
    return () => resolveExecutionScope(i, wf, acc('unit'), facts({ impact_basis: impactOk, impact_targets_available: true }));
  };
  // The fail-open this locks: `{ basis: [] }` used to skip both verification loops and then read
  // as a definite "no behaviour change", pruning testing with no source at all.
  assert.throws(build({ user_visible_behavior_change: false, reason: 'no source', basis: [] }), /缺少来源/);
  assert.throws(build({ reason: 'no verdict', basis: [impactSource] }), /user_visible_behavior_change/);
  assert.throws(build({ user_visible_behavior_change: false, reason: '  ', basis: [impactSource] }), /缺少 reason/);
} });
cases.push({ name: 'D0.1 a basis binding that no longer verifies rejects the freeze', run() {
  assert.throws(() => resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'),
    facts({ basis: [{ obligation_id: 'design:cu', input_id: 'contracts', ok: false, detail: '依据字节已变化' }] })), /义务依据冻结时核验失败[\s\S]*字节已变化/);
} });
cases.push({ name: 'CR-011 keeps an authorized testing duty when the legacy tested-code receipt appears or disappears', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const receipt = featureFilePath(root, feature, 'testing/reports/device-test-evidence.json');
    const key = path.join(path.dirname(receipt), 'recorded/hylyre/execution-key.json');
    fs.mkdirSync(path.dirname(key), { recursive: true });
    fs.writeFileSync(key, '{"original":"execution-key"}');
    fs.writeFileSync(receipt, '{"original":"receipt"}');
    const targets = [receipt, key].map(file => path.relative(root, file).split(path.sep).join('/'));
    const resolved = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'testing', track: 'full', testTargets: targets,
      inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs!.values.tested_code;
    assert(resolved.state === 'resolved');
    const binding = structuredClone(resolved.binding);
    const input = req(['testing']);
    input.facts.push({ id: 'device-evidence:CR-011', kind: 'device-evidence', applicability: 'required', reason: 'device retest', basis: [binding] });
    const freeze = () => resolveExecutionScope(input, wf, acc('device'), collectResolvedScopeFacts(input, { projectRoot: root, frameworkRoot, feature }));
    fs.rmSync(receipt);
    for (const scenario of ['missing', 'appeared']) {
      if (scenario === 'appeared') {
        const recordedReceipt = binding.dependencies.find(dep => dep.path === receipt)!;
        Object.assign(recordedReceipt, { exists: false, sha256: null });
        fs.writeFileSync(receipt, '{}');
      }
      const scope = freeze();
      const duty = scope.obligations.find(item => item.id === 'device-evidence:CR-011');
      assert.equal(duty?.applicability, 'required');
      assert.equal(duty?.satisfied_by, undefined);
      assert.deepStrictEqual(scope.phase_chain, ['testing']);
    }
    fs.rmSync(key);
    assert.throws(freeze, /义务依据冻结时核验失败[\s\S]*execution-key\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} });
cases.push({ name: 'D0.1 pixel_1to1 without visual acceptance opens a spec definition gap', run() {
  const pixel = (present: boolean) => resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'),
    facts({ fidelity: { state: 'valid', selected_fidelity: 'pixel_1to1', visual_requested: true, visual_acceptance_present: present } }));
  const gap = pixel(false);
  assert.equal(gap.obligations.find(o => o.kind === 'visual-evidence')!.applicability, 'required', 'the visual duty is never cancelled by the gap');
  assert(gap.unresolved.some(u => u.obligation_id === 'acceptance-definition:visual' && u.owner === 'spec'), JSON.stringify(gap.unresolved));
  assert(gap.phase_chain.includes('spec'), 'spec must be executable to fill the gap it owns');
  assert(!gap.phase_chain.includes('testing'), 'testing must not be executable before the gap is filled');
  assert(!pixel(true).unresolved.some(u => u.obligation_id === 'acceptance-definition:visual'), 'an existing visual acceptance is not a gap');
} });
// plan e7a2c4f1 §3.4（G30）：`visual_acceptance_present` 的判据是"在场**且可读**"。
// 上一条用的是手填的 boolean；这一条走**生产路径** `collectResolvedScopeFacts`（唯一写点），
// 把"文件在但解析不出来"的 ui-spec 真正喂进同一条 definition-gap 出口——不是降成 WARN。
cases.push({ name: 'P3-T10 an unreadable ui-spec opens the existing acceptance-definition:visual gap owned by spec, not a warn', run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p3t10-uispec-'));
  try {
    clearFrameworkConfigCache();
    const feature = 'demo';
    const ctx = { projectRoot: root, feature, frameworkRoot: path.resolve(__dirname, '../../..') };
    const probe = (): boolean => collectResolvedScopeFacts(request(['coding'], 'feature'), ctx).fidelity.visual_acceptance_present!;
    const uiSpec = uiSpecAbsPath(root, feature);
    fs.mkdirSync(path.dirname(uiSpec), { recursive: true });
    assert.equal(probe(), false, '文件缺失仍是缺口（既有行为不变）');
    // 坏 YAML：旧判据 fs.existsSync 会判 true，视觉义务的定义就此悬空。
    fs.writeFileSync(uiSpec, 'screens: [\n  - id: a\n   bad indent: {{\n');
    assert.equal(probe(), false, '解析不出来的 ui-spec 不算"在场"');
    // 能解析但不是映射（如整份写成一个列表）同样不构成验收定义。
    fs.writeFileSync(uiSpec, '- not-a-mapping\n');
    assert.equal(probe(), false, '非映射根节点不算"在场"');
    fs.writeFileSync(uiSpec, 'schema_version: "1.0"\nscreens: []\nassets: []\n');
    assert.equal(probe(), true, '可读的 ui-spec 必须算在场，否则缺口永不关闭');
    // 生产事实 → 既有 resolver：缺口按 spec-owned definition gap 开出，视觉义务不被取消。
    fs.writeFileSync(uiSpec, 'screens: [\n  - id: a\n   bad indent: {{\n');
    const scope = resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'), facts({
      fidelity: { state: 'valid', selected_fidelity: 'pixel_1to1', visual_requested: true, visual_acceptance_present: probe() },
    }));
    const gap = scope.unresolved.find(u => u.obligation_id === 'acceptance-definition:visual');
    assert(gap && gap.owner === 'spec', JSON.stringify(scope.unresolved));
    assert.equal(scope.obligations.find(o => o.id === 'acceptance-definition:visual')!.applicability, 'unknown', '定义缺口是 unknown，不是 WARN 后照跑');
    assert.equal(scope.obligations.find(o => o.kind === 'visual-evidence')!.applicability, 'required', '定义缺口不得取消视觉义务');
    assert(scope.phase_chain.includes('spec'), 'spec 必须可执行去填它自己拥有的缺口');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
} });
cases.push({ name: 'D0.1 the visual definition gap is cleared once the artifact exists', run() {
  const pixel = (present: boolean) => ({ state: 'valid' as const, selected_fidelity: 'pixel_1to1', visual_requested: true, visual_acceptance_present: present });
  // A sourced impact keeps the device duty decided, so the gap is the ONLY thing that can block
  // testing — otherwise this case would pass for the wrong reason.
  const gapFacts = (present: boolean) => facts({ fidelity: pixel(present), impact_basis: impactOk, impact_targets_available: true });
  const birthReq = req(['coding'], 'feature');
  birthReq.request.impact = sourced(true, 'visible change');
  const birth = resolveExecutionScope(birthReq, wf, acc('unit'), gapFacts(false));
  assert(birth.unresolved.some(u => u.obligation_id === 'acceptance-definition:visual'), 'the gap must exist while the artifact is missing');
  assert(!birth.phase_chain.includes('testing'), 'testing is not executable while the gap is open');
  // spec fills the gap. The revision carries the PREVIOUS obligations forward verbatim — exactly
  // what the checker-side proposal does — so the inherited `unknown` is what must be cleared.
  const after = req(['coding'], 'feature');
  after.request.impact = sourced(true, 'visible change');
  after.facts.push(...birth.obligations.map(o => ({ id: o.id, kind: o.kind, applicability: o.applicability, reason: o.reason, basis: o.basis, ...(o.satisfied_by ? { satisfied_by: o.satisfied_by } : {}) })));
  assert(after.facts.some(f => f.id === 'acceptance-definition:visual'), 'the proposal really carries the old gap');
  const revised = resolveExecutionScope(after, wf, acc('unit'), gapFacts(true));
  assert(!revised.unresolved.some(u => u.obligation_id === 'acceptance-definition:visual'), 'the inherited gap was never cleared');
  assert(!revised.obligations.some(o => o.id === 'acceptance-definition:visual'), 'the derived gap obligation survived its own cause');
  assert.equal(revised.obligations.find(o => o.kind === 'visual-evidence')!.applicability, 'required', 'clearing the gap must not cancel the visual duty');
  assert(revised.phase_chain.includes('testing'), 'testing must become executable again');
  // …and it has to hold through a real revision replay, not just a second resolve.
  const entry = { type: 'scope_revised', revision_index: 1, previous_scope_fingerprint: executionScopeFingerprint(birth),
    execution_scope: revised, revision_input: null, trigger: { phase: 'spec', check_id: 'visual-gap' }, allowed_fields: [...SCOPE_REVISION_FIELDS_CONST] };
  assert.deepStrictEqual(applyScopeRevisions(birth, [entry] as never[]).phase_chain, revised.phase_chain);
} });
cases.push({ name: 'D0.1 empty write set with an implementation duty is rejected as a scope declaration gap', run() {
  const i = req(['coding'], 'feature');
  i.request.impact = sourced(false, 'implementation without a declared write set');
  assert.throws(() => resolveExecutionScope(i, wf, acc('unit'), facts({ impact_basis: impactOk })), /范围未声明可核验的写集[\s\S]*责任方 plan/);
} });
cases.push({ name: 'D0.1 self-reported visual not_applicable is recomputed from fidelity ssot', run() {
  const i = req(['coding'], 'feature');
  i.facts.push({ id: 'visual:self', kind: 'visual-evidence', applicability: 'not_applicable', reason: 'self', basis: [] });
  const s = resolveExecutionScope(i, wf, acc('unit'), facts({ fidelity: { state: 'valid', selected_fidelity: 'pixel_1to1', visual_requested: true } }));
  assert.equal(s.obligations.find(o => o.id === 'visual:self')!.applicability, 'required');
} });
cases.push({ name: 'D0.1 missing fidelity ssot without visual request stays not_applicable', run() {
  const s = resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'), facts());
  assert.equal(s.obligations.find(o => o.kind === 'visual-evidence')!.applicability, 'not_applicable');
} });
cases.push({ name: 'D0.1 corrupt or undecided fidelity keeps testing in scope', run() {
  const s = resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'), facts({ fidelity: { state: 'corrupt', visual_requested: true } }));
  assert.equal(s.obligations.find(o => o.kind === 'visual-evidence')!.applicability, 'unknown');
  const u = resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'), facts({ fidelity: { state: 'missing', visual_requested: true } }));
  assert.equal(u.obligations.find(o => o.kind === 'visual-evidence')!.applicability, 'unknown');
} });
cases.push({ name: 'D0.1 satisfied_by is re-resolved at freeze time', run() {
  assert.throws(() => resolveExecutionScope(req(['coding'], 'feature'), wf, acc('unit'),
    facts({ satisfied_by: [{ obligation_id: 'x', ref_index: 0, ok: false, detail: 'stale' }] })), /满足依据冻结时核验失败/);
} });
cases.push({ name: 'D0.1 behavior-change impact requires device evidence and carries request_impact', run() {
  const i = req(['coding'], 'feature');
  i.request.impact = sourced(true, 'a visible change was found');
  const s = resolveExecutionScope(i, wf, acc('unit'), facts({ impact_basis: impactOk, impact_targets_available: true }));
  assert.equal(s.request_impact!.user_visible_behavior_change, true);
  assert.equal(s.obligations.find(o => o.kind === 'device-evidence')!.applicability, 'required');
} });
cases.push({ name: 'D0.1 sourced impact=false prunes testing when acceptance has no device layer', run() {
  const i = req(['coding'], 'feature');
  i.request.impact = sourced(false, 'host verification is sufficient');
  const s = resolveExecutionScope(i, wf, acc('unit'), facts({ impact_basis: impactOk, impact_targets_available: true }));
  assert.equal(s.obligations.find(o => o.kind === 'device-evidence')!.applicability, 'not_applicable');
  assert(!s.phase_chain.includes('testing'));
} });
cases.push({ name: 'definition gap keeps its owner executable (scheme A)', run() {
  const i = req(['coding'], 'feature');
  i.facts.push({ id: 'acc:gap', kind: 'acceptance-definition', applicability: 'unknown', reason: 'pixel_1to1 缺视觉验收条目', basis: [] });
  const s = resolveExecutionScope(i, wf, acc('unit'));
  assert(s.phase_chain.includes('spec'), 'spec must be executable to fill its own definition gap');
  assert(s.unresolved.some(g => g.obligation_id === 'acc:gap' && g.owner === 'spec'));
} });

// ---------------------------------------------------------------------------
// §4.4 D2 acceptance matrix — the parts that are pure-function decidable. The
// end-to-end rows (revision / revision-cut / revision-precut / design-gap /
// testing-fail) are covered by the `real prepare CLI / bridge scope lifecycle`
// modes above, which drive the real runtime.
// ---------------------------------------------------------------------------
const d2Workflow = workflow;
const d2Acceptance = (layer: string) => ({
  value: { criteria: [{ id: 'AC-1', priority: 'P1', ut_layer: layer }] } as AcceptanceSpec,
  binding: { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: ['acceptance.yaml'], content_fingerprint: 'a'.repeat(64) },
});
const d2Facts = (over?: Partial<ResolvedScopeFacts>): ResolvedScopeFacts => ({
  fidelity: { state: 'missing', visual_requested: false },
  impact_basis: impactOk, basis: [], satisfied_by: [],
  targets: { implementation_files: [], contracts_files: [], review_targets: [], ut_targets: [] },
  impact_targets_available: true, ...(over ?? {}),
});

cases.push({ name: 'D2 not_applicable to required revision is accepted', run() {
  const before = request(['coding', 'review', 'ut'], 'feature');
  before.request.impact = sourced(false, 'no user-visible change yet');
  const birth = resolveExecutionScope(before, d2Workflow, d2Acceptance('unit'), d2Facts());
  assert.equal(birth.obligations.find(o => o.kind === 'device-evidence')!.applicability, 'not_applicable');
  assert(!birth.phase_chain.includes('testing'));
  // coding discovers a user-visible behaviour change: a sourced correction upgrades the duty.
  const after = request(['coding', 'review', 'ut'], 'feature');
  after.request.impact = sourced(true, 'coding found a visible change');
  const revised = resolveExecutionScope(after, d2Workflow, d2Acceptance('unit'), d2Facts());
  assert.equal(revised.obligations.find(o => o.kind === 'device-evidence')!.applicability, 'required');
  assert(revised.phase_chain.includes('testing'), 'testing must enter the chain tail');
  // not_applicable -> required is an upgrade, so the "must not subtract required" gate stays silent.
  assert.deepStrictEqual(findSubtractedRequiredObligations(birth, revised), []);
} });

cases.push({ name: 'D2 revision cannot delete or downgrade a required obligation', run() {
  const before = resolveExecutionScope(request(['coding', 'review', 'testing'], 'feature'), d2Workflow, d2Acceptance('device'), d2Facts());
  assert.equal(before.obligations.find(o => o.kind === 'device-evidence')!.applicability, 'required');
  const after = request(['coding', 'review', 'ut'], 'feature');
  after.request.impact = sourced(false, 'try to drop the device duty');
  const revised = resolveExecutionScope(after, d2Workflow, d2Acceptance('unit'), d2Facts());
  const subtracted = findSubtractedRequiredObligations(before, revised);
  assert(subtracted.length, 'dropping a required device duty must be detected');
  assert.throws(() => assertRevisionKeepsRequiredObligations(before, revised), /不得删除或降级 required/);
  // Keeping the id while switching the kind replaces the responsibility — it is a subtraction too.
  const swapped = { ...before, obligations: before.obligations.map(o => o.kind === 'device-evidence' ? { ...o, kind: 'unit-evidence' } : o) };
  assert.deepStrictEqual(findSubtractedRequiredObligations(before, swapped), before.obligations.filter(o => o.kind === 'device-evidence' && o.applicability === 'required').map(o => o.id));
} });

cases.push({ name: 'D2 only this run can supply the new fact a revision stands on', run() {
  const base = resolveExecutionScope(request(['coding', 'review', 'ut'], 'feature'), d2Workflow, d2Acceptance('unit'), d2Facts());
  const carried = base.obligations.map(o => ({ id: o.id, kind: o.kind, applicability: o.applicability, reason: o.reason, basis: o.basis }));
  const evidence = (run_id: string) => ({ phase: 'coding', run_id, evidence_manifest_aggregate: 'e'.repeat(64) });
  // Nothing new at all.
  assert.equal(hasNewSourcedFact(base, carried, 'run-now'), false);
  // A closure reference THIS run just produced is the one new fact a re-run phase can offer…
  assert.equal(hasNewSourcedFact(base, carried.map(f => f.kind === 'implementation' ? { ...f, satisfied_by: [evidence('run-now')] } : f), 'run-now'), true);
  // …while a historical run's evidence existed before the proposal and can never justify it.
  assert.equal(hasNewSourcedFact(base, carried.map(f => f.kind === 'implementation' ? { ...f, satisfied_by: [evidence('run-older')] } : f), 'run-now'), false);
  // A basis binding the frozen scope does not carry is new regardless of run.
  const newFact = { id: 'design:new', kind: 'design-decision', applicability: 'required' as const, reason: 'new interface', basis: [impactSource] };
  assert.equal(hasNewSourcedFact(base, [...carried, newFact], 'run-now'), true);
  // …but the frozen impact judgement's own source is already carried by the scope.
  assert.equal(hasNewSourcedFact({ ...base, request_impact: sourced(false, 'frozen') }, [...carried, newFact], 'run-now'), false);
} });

cases.push({ name: 'D2 every recovery reader sees the derived revocation, not just the invalidation filter', run() {
  // The three production readers of a per-phase invalidation. If the projected stream reaches only
  // one of them, the other two happily skip the agent for a phase the first just sent back.
  // A revoked duty returns to the chain — that is what makes the scope valid without its proof.
  const scope = (satisfied: boolean) => ({
    schema_version: '1.0' as const, completion_target: 'feature' as const, requested_results: ['r'], phase_chain: satisfied ? [] : ['spec'],
    reused_phases: satisfied ? [{ phase: 'spec', obligation_ids: ['acc'], evidence_refs: [{ phase: 'spec', run_id: 'run-now', evidence_manifest_aggregate: 'a'.repeat(64) }] }] : [],
    unresolved: [], policy_fingerprint: '0'.repeat(64),
    obligations: [{ id: 'acc', kind: 'acceptance-context', owner_phase: 'spec', applicability: 'required' as const, reason: 'r', basis: [],
      ...(satisfied ? { satisfied_by: [{ phase: 'spec', run_id: 'run-now', evidence_manifest_aggregate: 'a'.repeat(64) }] } : {}) }],
  });
  const birth = scope(true);
  const revision = { type: 'scope_revised', revision_index: 1, previous_scope_fingerprint: executionScopeFingerprint(birth),
    execution_scope: scope(false), revision_input: null, trigger: { phase: 'coding', check_id: 'x' }, allowed_fields: [...SCOPE_REVISION_FIELDS_CONST] };
  // (a) spec PASSed with closure still pending, then a revision withdrew its evidence.
  const closurePending = [{ type: 'phase_verdict', phase: 'spec', verdict: 'PASS', advance_blocked: true, action: 'retry' }, revision];
  assert.equal(isClosureOnlyRetryPending(closurePending as never[], 'spec'), true, 'premise: without the projection this looks closure-only');
  assert.equal(isClosureOnlyRetryPending(eventsWithScopeRevocations(birth, closurePending as never[]) as never[], 'spec'), false,
    'a revoked phase must not be resumed as closure-only');
  // (b) spec halted waiting for validation only, then a revision withdrew its evidence.
  const awaitingValidation = [
    { type: 'agent_process_settled', phase: 'spec', invoke_id: 'spec-i1' },
    { type: 'harness_end', phase: 'spec', invoke_id: 'spec-i1' },
    { type: 'phase_halt', phase: 'spec', run_disposition: 'WAITING' },
    revision,
  ];
  assert(resolveValidationOnlyEligibility(awaitingValidation as never[], { requireInterrupt: true }), 'premise: without the projection this looks validation-only');
  assert.equal(resolveValidationOnlyEligibility(eventsWithScopeRevocations(birth, awaitingValidation as never[]) as never[], { requireInterrupt: true }), null,
    'a revoked phase must not be resumed as validation-only');

} });

cases.push({ name: 'D2 a revocation is only derived when a duty is left with no phase evidence', run() {
  const proof = (phase: string, run_id: string) => ({ phase, run_id, evidence_manifest_aggregate: run_id.repeat(8).slice(0, 64) });
  const withProof = (refs: Array<Record<string, unknown>>) => ({
    schema_version: '1.0' as const, completion_target: 'feature' as const, requested_results: ['r'], phase_chain: refs.length ? [] : ['spec'],
    reused_phases: refs.length ? [{ phase: 'spec', obligation_ids: ['acc'], evidence_refs: refs as never }] : [],
    unresolved: [], policy_fingerprint: '0'.repeat(64),
    obligations: [{ id: 'acc', kind: 'acceptance-context', owner_phase: 'spec', applicability: 'required' as const, reason: 'r', basis: [], ...(refs.length ? { satisfied_by: refs as never } : {}) }],
  });
  const birth = withProof([proof('spec', 'a'), proof('spec', 'b')]);
  const entry = (scope: unknown) => ({ type: 'scope_revised', revision_index: 1, previous_scope_fingerprint: executionScopeFingerprint(birth),
    execution_scope: scope, revision_input: null, trigger: { phase: 'coding', check_id: 'x' }, allowed_fields: [...SCOPE_REVISION_FIELDS_CONST] });
  // One of two proofs withdrawn: the duty is still satisfied, so the phase must NOT be sent back.
  assert.equal(revokedPhasesByRevision(birth, [entry(withProof([proof('spec', 'b')]))] as never[]).size, 0);
  // Nothing left: that is the revocation.
  assert.deepStrictEqual(revokedPhasesByRevision(birth, [entry(withProof([]))] as never[]).get(1), ['spec']);
} });

cases.push({ name: 'D2 broken revision chain is corruption, not a fallback to birth scope', run() {
  const birth = resolveExecutionScope(request(['spec'], 'feature'), d2Workflow, undefined, d2Facts());
  // The revised request keeps `spec` (its obligation was explicitly requested at birth): replaying a
  // revision that silently drops a required duty is itself corruption, asserted separately below.
  const next = resolveExecutionScope(request(['spec', 'coding', 'review', 'ut'], 'feature'), d2Workflow, d2Acceptance('unit'), d2Facts());
  const entry = (over: Record<string, unknown>) => ({
    type: 'scope_revised', revision_index: 1, previous_scope_fingerprint: executionScopeFingerprint(birth),
    execution_scope: next, revision_input: null, trigger: { phase: 'spec', check_id: 'x' },
    allowed_fields: [...SCOPE_REVISION_FIELDS_CONST], ...over,
  });
  // A well-formed single revision applies.
  assert.deepStrictEqual(applyScopeRevisions(birth, [entry({})] as never[]).phase_chain, next.phase_chain);
  // Chain break / index gap / wrong field boundary are corruption — never a silent birth fallback.
  assert.throws(() => applyScopeRevisions(birth, [entry({ previous_scope_fingerprint: '0'.repeat(64) })] as never[]), /修订链断裂/);
  assert.throws(() => applyScopeRevisions(birth, [entry({ revision_index: 2 })] as never[]), /revision index 不连续/);
  assert.throws(() => applyScopeRevisions(birth, [entry({ allowed_fields: ['execution_scope'] })] as never[]), /可改字段边界非法/);
  // Replay enforces the SAME before/after constraints as the writer: a structurally valid entry that
  // drops a required duty, or moves the request boundary, must never become the effective scope.
  const dropped = resolveExecutionScope(request(['coding', 'review', 'ut'], 'feature'), d2Workflow, d2Acceptance('unit'), d2Facts());
  assert.throws(() => applyScopeRevisions(birth, [entry({ execution_scope: dropped })] as never[]), /不得删除或降级 required/);
  const widened = request(['spec', 'coding', 'review', 'ut'], 'feature');
  widened.request.requested_results = ['a different result'];
  const boundary = resolveExecutionScope(widened, d2Workflow, d2Acceptance('unit'), d2Facts());
  assert.throws(() => applyScopeRevisions(birth, [entry({ execution_scope: boundary })] as never[]), /改写了请求边界/);
  // Physical order is the evidence: two entries written in the wrong order must NOT be repaired by
  // sorting them back into index order — that would hide exactly what the chain exists to detect.
  // `both` keeps the unit duty while adding the device one: growing the scope is legal, dropping a
  // required duty is not (asserted just above), and the replay applies the same rule.
  const third = resolveExecutionScope(request(['spec', 'coding', 'review', 'ut', 'testing'], 'feature'), d2Workflow, d2Acceptance('both'), d2Facts());
  const first = entry({});
  const second = { ...entry({}), revision_index: 2, previous_scope_fingerprint: executionScopeFingerprint(next), execution_scope: third };
  assert.deepStrictEqual(applyScopeRevisions(birth, [first, second] as never[]).phase_chain, third.phase_chain);
  assert.throws(() => applyScopeRevisions(birth, [second, first] as never[]), /revision index 不连续/);
} });

cases.push({ name: 'D2 baseline is frozen once by the first coding-bearing revision', run() {
  const manifest = {} as { run_base_sha?: string };
  // Real revision records: the baseline conditions are stated over the revised CHAIN, so an event
  // object without one cannot answer them (the earlier shape could not be checked at all).
  const investigation = resolveExecutionScope(request(['spec'], 'feature'), d2Workflow, undefined, d2Facts());
  const implementing = resolveExecutionScope(request(['spec', 'coding', 'review', 'ut'], 'feature'), d2Workflow, d2Acceptance('unit'), d2Facts());
  const revision = (scope: typeof implementing, index: number, sha?: string) => ({ type: 'scope_revised', revision_index: index, execution_scope: scope, ...(sha ? { run_base_sha: sha } : {}) });
  assert.deepStrictEqual(resolveRunBaseline(manifest, [] as never[]), { source: 'birth' });
  assert.deepStrictEqual(resolveRunBaseline(manifest, [revision(implementing, 1, 'a'.repeat(40))] as never[]), { baseSha: 'a'.repeat(40), source: 'revision' });
  // Birth value wins — and an event that also carries one is corruption, never something to ignore.
  assert.deepStrictEqual(resolveRunBaseline({ run_base_sha: 'b'.repeat(40) }, [] as never[]), { baseSha: 'b'.repeat(40), source: 'birth' });
  assert.throws(() => resolveRunBaseline({ run_base_sha: 'b'.repeat(40) }, [revision(implementing, 1, 'a'.repeat(40))] as never[]), /出生已有基线/);
  // A second revision carrying a baseline is a broken chain, not a rebase.
  assert.throws(() => resolveRunBaseline(manifest, [revision(implementing, 1, 'a'.repeat(40)), revision(implementing, 2, 'c'.repeat(40))] as never[]), /重复冻结/);
  // Only a coding/ut-bearing revision may freeze it, and only the FIRST such one.
  assert.throws(() => resolveRunBaseline(manifest, [revision(investigation, 1, 'a'.repeat(40))] as never[]), /不含 coding\/ut/);
  assert.throws(() => resolveRunBaseline(manifest, [revision(implementing, 1), revision(implementing, 2, 'a'.repeat(40))] as never[]), /未由首条/);
  // The value itself must be an exact SHA — the 40-hex rule is not skipped at the event layer.
  assert.throws(() => resolveRunBaseline(manifest, [revision(implementing, 1, 'not-a-sha')] as never[]), /sha|SHA/);
} });

// ===========================================================================
// D1（批次 3）——无 run 轻量交互路径。§6.9 验收矩阵逐行。
// ===========================================================================

/** 无 run 的干净链现场：与 `seedCleanCompletionChain` 用**同一批生产 writer**，只是不写 run events。 */
function seedRunlessChain(root: string, feature: string, chain: readonly string[], openPhase?: string, now = () => new Date('2026-07-13T00:00:00.000Z')): void {
  const requirementSha = computeRunRequirementSha(root, feature, undefined);
  if (chain.includes('review')) writeReviewClosureAttestation({ projectRoot: root, feature, expectProductSources: false, now: () => new Date('2026-07-13T00:00:00.000Z') });
  for (const phase of chain) {
    if (phase === openPhase) {
      const frameworkRoot = path.join(root, 'framework'), loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
      const ctx = { projectRoot: root, frameworkRoot, feature, phase, phaseRule: loader.loadPhaseRule(phase),
        featureSpec: loader.loadFeatureSpec(feature), resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot) } as CheckContext;
      const report = generateScriptReport('', phase, feature, root,
        [...checkTypedConstructionContent(ctx), ...checkContractFileReferenceClosure(ctx)], frameworkRoot);
      writeRunSummaryBase(root, report, frameworkRoot);
      // 原检查事实已经实际生成；保留旧包没有 closure 字段的前提，闭环/manifest 由被测路径写入。
      const summaryAbs = path.join(featurePhaseReportsDir(root, feature, phase), 'summary.json');
      const doc = JSON.parse(fs.readFileSync(summaryAbs, 'utf8'));
      delete doc.closure_status; delete doc.closure_commit;
      fs.writeFileSync(summaryAbs, JSON.stringify(doc));
      writePhaseReceipt(root, feature, phase);
      continue;
    }
    writePhaseSummary(root, feature, phase, 'PASS');
    // 生产 closure 判据要求 summary 自带 blocker_count（seed 助手只写 verdict 家族字段）
    {
      const summaryAbs = path.join(featurePhaseReportsDir(root, feature, phase), 'summary.json');
      const doc = JSON.parse(fs.readFileSync(summaryAbs, 'utf8'));
      fs.writeFileSync(summaryAbs, JSON.stringify({ ...doc, blocker_count: 0 }));
    }
    writePhaseReceipt(root, feature, phase);
    const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
      projectRoot: root, feature, phase: phase as never, now, requirementSha,
    }));
    writeReceiptManifestPointer(root, feature, phase, path.relative(root, written.absPath).split(path.sep).join('/'), written.sha256);
  }
}

/** 最小 1.2 项目：config + workflow + feature.yaml 候选。返回 root 与 frameworkRoot。 */
export function setupRunlessProject(options?: { chain?: string[]; uiFile?: boolean; completionTarget?: 'feature' | 'request' }): { root: string; frameworkRoot: string; feature: string } {
  const repo = path.resolve(__dirname, '../../..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-runless-'));
  const frameworkRoot = path.join(root, 'framework');
  fs.mkdirSync(path.join(frameworkRoot, 'workflows'), { recursive: true });
  for (const dir of ['harness', 'profiles', 'agents', 'skills', 'specs', 'templates', 'docs']) {
    fs.symlinkSync(path.join(repo, dir), path.join(frameworkRoot, dir), process.platform === 'win32' ? 'junction' : 'dir');
  }
  fs.cpSync(path.join(repo, 'workflows'), path.join(frameworkRoot, 'workflows'), { recursive: true });
  const source = YAML.parse(fs.readFileSync(path.join(repo, 'workflows/spec-driven.workflow.yaml'), 'utf8'));
  source.schema_version = '1.2'; delete source.auto_chain_by_track;
  source.artifacts = source.artifacts.filter((a: { id: string }) => !['change', 'exit'].includes(a.id));
  for (const artifact of source.artifacts) { delete artifact.tracks; delete artifact.requires_by_track; artifact.obligation_provider_id = artifact.scope === 'global' ? 'obligations.project' : `obligations.${artifact.id}`; }
  fs.writeFileSync(path.join(frameworkRoot, 'workflows/d1.workflow.yaml'), YAML.stringify(source));
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1', project_name: 'D1', project_profile: { name: 'generic' }, active_workflow: 'd1',
    // 真实 CLI 会先过 personal-setup preflight：没有物化 adapter 就走不到冻结入口；
    // personal 字段（agent_adapter）必须落在 framework.local.json，不能留在 project config。
    materialized_adapters: ['generic'],
    paths: { features_dir: 'doc/features' },
    architecture: { outer_layers: [{ id: 'src', can_depend_on: [] }], module_inner_layers: ['shared', 'data', 'domain', 'presentation'] },
  }));
  fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', agent_adapter: 'generic' }));
  // adapter 入口产物（AGENTS.md）——preflight 要求已物化，否则走不到冻结入口。
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# AGENTS' + String.fromCharCode(10));
  clearFrameworkConfigCache();
  const feature = 'runless';
  fs.mkdirSync(path.join(root, 'src/demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/demo/value.ts'), 'export const value: number = 1;\n');
  if (options?.uiFile) fs.writeFileSync(path.join(root, 'src/demo/Page.ets'), '@Entry @Component struct Page { build() { Column() {} } }\n');
  const files = ['src/demo/value.ts', ...(options?.uiFile ? ['src/demo/Page.ets'] : [])];
  fs.mkdirSync(path.dirname(featureFilePath(root, feature, 'contracts.yaml')), { recursive: true });
  fs.writeFileSync(featureFilePath(root, feature, 'contracts.yaml'), YAML.stringify({
    feature, source: 'approved design', version: '1', modules: [{ name: 'demo', layer: 'src', package_path: 'src/demo' }],
    files, module_dependencies: {}, data_models: [], interfaces: [], components: [], prd_to_code_traceability: [{ prd_id: 'AC-1', key_files: ['src/demo/value.ts'] }],
  }));
  fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), YAML.stringify({
    feature, source: 'approved behavior', version: '1',
    criteria: [{ id: 'AC-1', description: 'value is 42', priority: 'P1', testable: true, verification_steps: ['read value'], expected_result: '42', ut_layer: 'unit', ut_focus: 'value is 42' }], boundaries: [],
  }));
  fs.writeFileSync(featureFilePath(root, feature, 'spec.md'), '# spec\n');
  fs.writeFileSync(featureFilePath(root, feature, 'plan.md'), '# plan\n');
  const chain = options?.chain ?? ['coding', 'review', 'ut'];
  // 单职责 spec 请求：验收缺失才会在出生时留下定义缺口（与 run 侧 `request-spec` 的前置同一条）。
  if (options?.completionTarget === 'request' && chain.includes('spec')) fs.rmSync(featureFilePath(root, feature, 'acceptance.yaml'), { force: true });
  prepareFeatureScopeCandidate({
    projectRoot: root, frameworkRoot, feature, completionTarget: options?.completionTarget ?? 'feature',
    requestedResults: ['value is 42'], requestedPhases: chain, requirement: '把 value 改成 42', overwrite: true,
    impact: { userVisibleBehaviorChange: false, reason: '仅内部取值变化', basisPaths: ['src/demo/value.ts'] },
  });
  return { root, frameworkRoot, feature };
}

cases.push({ name: 'D1 a repeated runless closure of a single-duty request is a no-op', run() {
  // 第三轮追加：无 run 收尾（`--sync-closure` / 阶段尾部同一个函数）每次都从磁盘上**同一份**
  // script-report 读提案，且调用前没有 run 路径那道「按 revision_input 指纹去重」。
  // 这里用**生产入口**造一份 request 终点的无 run 冻结记录，连续收尾两次，断言第二次是干净 no-op。
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
  try {
    const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
    const born = readFeatureFrozenScope(root, feature)!;
    assert.equal(born.execution_scope.completion_target, 'request', JSON.stringify(born.execution_scope));
    assert.deepStrictEqual(born.execution_scope.phase_chain, ['spec'], JSON.stringify(born.execution_scope.phase_chain));
    assert(born.execution_scope.unresolved.length, '前提：出生时须有验收定义缺口，否则这条用例证明不了关缺口');
    // spec 的真实产出：合法验收（`setupRunlessProject` 为制造缺口先删掉了它）。
    fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), YAML.stringify({
      feature, source: 'approved behavior', version: '1',
      criteria: [{ id: 'AC-1', description: 'value is 42', priority: 'P1', testable: true, verification_steps: ['read value'], expected_result: '42', ut_layer: 'unit', ut_focus: 'value is 42' }], boundaries: [],
    }));
    // 提案由**生产的** `designScopeRevisionChecks` 发布（feature 载体分支：factsContext.subject 无 run_id）。
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'spec', featuresDir: relFeaturesDir(root) });
    const resolvedInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'spec', track: 'full', ...bridge }).inputs!;
    const produced = designScopeRevisionChecks({
      projectRoot: root, frameworkRoot, feature, phase: 'spec',
      featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, resolvedInputs),
      resolvedInputs, factsContext: bridge.factsContext,
    } as never, []);
    const revisionCheck = produced.find(check => (check as { scope_revision_input?: unknown }).scope_revision_input);
    assert(revisionCheck, '生产设计检查未发布提案：' + JSON.stringify(produced));
    const reportsDir = featurePhaseReportsDir(root, feature, 'spec', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({ checks: [revisionCheck] }));

    const before = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'spec', workflowTrack: 'full' });
      assert.equal(result.revisionApplied, false);
      assert.equal(result.skippedReason, 'request-terminal');
      assert.equal(result.completionPath, undefined);
      assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), before, 'a single-duty request cannot advance feature orchestration');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: '1804 independent clean-pass cannot create Feature completion; historical completion readers remain valid', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    // ① 首次冻结（生产入口，无 run 身份）
    const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.scope_source, 'feature');
    assert.deepStrictEqual(record.execution_scope.phase_chain, ['coding', 'review', 'ut']);
    // 再跑一次只读不重写（D1.2「之后每次阶段运行只读冻结记录」）
    const again = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(again.status, 'reused');
    assert.equal(readFeatureFrozenScope(root, feature)!.frozen_at, record.frozen_at);

    // ② 三阶段证据（与 run 载体**同一批生产 writer**）
    const chain = executionCompletionPhases(featureEffectiveScope(record)).map(String);
    seedRunlessChain(root, feature, chain);

    // ③ 独立收尾只保留阶段结果；历史完成原件仅在显式 reader 夹具中构造。
    const frozenBytes = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    const retired = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert.equal(retired.skippedReason, 'goal-runtime-required');
    assert.equal(retired.completionPath, undefined);
    assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), frozenBytes);
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'clean-pass does not authorize a new runless completion');
    // Materialize a legacy record solely to preserve its reader compatibility assertions below.
    const outcome = legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert(outcome.completionPath, '无 run 完成原件未生成：' + JSON.stringify(outcome));
    assert(outcome.completionPath!.split(path.sep).join('/').includes(`${feature}/completion/`), outcome.completionPath);

    // ④ 完成判定 VALID，且原件形状按 D1.5
    const completion = JSON.parse(fs.readFileSync(outcome.completionPath!, 'utf8'));
    assert.equal(completion.run_id, null);
    assert.equal(completion.scope_source, 'feature');
    assert.deepStrictEqual(completion.phases.map((p: { run_id: unknown }) => p.run_id), chain.map(() => null));
    const verdict = completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(verdict.verdict, 'VALID', JSON.stringify(verdict.reasons));

    // ⑤ 无 goal-runs 目录、无 spec/plan/testing 空报告
    assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')), '无 run 路径造出了 goal-runs 目录');
    for (const skipped of ['spec', 'plan', 'testing']) {
      assert(!fs.existsSync(featureFilePath(root, feature, `${skipped}/reports/summary.json`)), `凭空产出了 ${skipped} 报告`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

/**
 * Codex 四轮 P1 现场：生产入口生成无 run 完成原件，再经生产 `appendFeatureScopeRevision` 追加一条新增义务的合法修订。
 * 返回链、原件路径与修订前的原件字节。
 */
export function runlessCompletionThenRevision(root: string, frameworkRoot: string, feature: string): { chain: string[]; originalAbs: string; originalBytes: string; newDuty: string } {
  assert.equal(ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature }).status, 'frozen');
  const chain = executionCompletionPhases(featureEffectiveScope(readFeatureFrozenScope(root, feature)!)).map(String);
  seedRunlessChain(root, feature, chain);
  const outcome = legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
  assert(outcome.completionPath, '无 run 完成原件未生成：' + JSON.stringify(outcome));
  const originalBytes = fs.readFileSync(outcome.completionPath!, 'utf8');
  assert.equal(JSON.parse(originalBytes).scope_revision_count, 0, '前提：完成时无修订');
  // 正例 C：修订前评估完成（无回归）
  const before = assessFeature(root, feature, { expectedTrack: 'full', expectedChain: chain, frameworkRoot });
  assert.equal(before.record.state, 'ok', assessmentReasons(before).join('\n'));
  assert.equal(before.complete, true, assessmentReasons(before).join('\n'));
  // 完成后修正：新增一条 plan 责任义务（只增不删，合法修订）
  const effective = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
  const newDuty = 'codex-r4-post-completion-duty';
  const extra = { ...effective.obligations.find(o => o.applicability === 'required')!, id: newDuty, owner_phase: 'plan', reason: '完成后修正新增', satisfied_by: undefined };
  appendFeatureScopeRevision({ projectRoot: root, feature, trigger: { phase: 'plan' },
    nextScope: { ...effective, phase_chain: ['plan', ...effective.phase_chain], obligations: [...effective.obligations, extra] } as never });
  assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 1);
  return { chain, originalAbs: outcome.completionPath!, originalBytes, newDuty };
}

cases.push({ name: 'b2d7 codex-r4 runless completion stays a trusted record after a legal post-completion revision and after transfer', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const { chain, originalAbs, originalBytes, newDuty } = runlessCompletionThenRevision(root, frameworkRoot, feature);
    // 正例 A：记录按凭证登记的修订位置（0）回放核验 → ok；覆盖读最新有效范围 → 新增义务 uncovered、未完成
    const after = assessFeature(root, feature, { expectedTrack: 'full', expectedChain: chain, frameworkRoot });
    assert.equal(after.record.state, 'ok', assessmentReasons(after).join('\n'));
    const duty = after.obligations.find(o => o.id === newDuty);
    assert.equal(duty?.status, 'uncovered', JSON.stringify(after.obligations));
    assert.equal(after.complete, false);
    assert.equal(fs.readFileSync(originalAbs, 'utf8'), originalBytes, '评估改写了完成原件');
    // 正例 B：按 §6 #15 转交给新 run 之后，旧记录仍可核验
    const record = readFeatureFrozenScope(root, feature)!;
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: '20260926T000000Z-r4next', transferredScopeFingerprint: executionScopeFingerprint(featureEffectiveScope(record)) });
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers?.length, 1);
    const transferred = assessFeature(root, feature, { expectedTrack: 'full', expectedChain: chain, frameworkRoot });
    assert.equal(transferred.record.state, 'ok', assessmentReasons(transferred).join('\n'));
    assert.equal(transferred.obligations.find(o => o.id === newDuty)?.status, 'uncovered', JSON.stringify(transferred.obligations));
    assert.equal(transferred.complete, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'b2d7 codex-r4 runless completion declaring a missing revision or a fingerprint off its replayed scope is broken', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const { chain, originalAbs, originalBytes } = runlessCompletionThenRevision(root, frameworkRoot, feature);
    const projectionAbs = featureFilePath(root, feature, 'feature-completion.json');
    const projectionBytes = fs.readFileSync(projectionAbs, 'utf8');
    // 改原件并同步投影哈希，确保拦下它的是修订回放核验而不是投影哈希
    const forge = (patch: Record<string, unknown>): string[] => {
      const text = JSON.stringify({ ...JSON.parse(originalBytes), ...patch }, null, 2);
      fs.writeFileSync(originalAbs, text);
      fs.writeFileSync(projectionAbs, JSON.stringify({ ...JSON.parse(projectionBytes), original_sha256: createHash('sha256').update(text, 'utf-8').digest('hex') }));
      const a = assessFeature(root, feature, { expectedTrack: 'full', expectedChain: chain, frameworkRoot });
      assert.equal(a.record.state, 'broken', JSON.stringify(patch));
      return a.record.state === 'broken' ? a.record.reasons : [];
    };
    const record = readFeatureFrozenScope(root, feature)!;
    const revisedFingerprint = executionScopeFingerprint(featureEffectiveScope(record));
    // 反例 D：声明不存在的修订
    assert(forge({ scope_revision_count: 2 }).some(r => r.includes('声明了不存在的修订')), '多报修订数未被拦');
    // 反例 E：修订位置与指纹不对应（两个方向）
    assert(forge({ scope_revision_count: 0, execution_scope_fingerprint: revisedFingerprint }).some(r => r.includes('execution_scope_fingerprint')), '声明 0 却带修订 1 的指纹未被拦');
    assert(forge({ scope_revision_count: 1 }).some(r => r.includes('execution_scope_fingerprint')), '声明 1 却带出生指纹未被拦');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 candidate drift blocks the next phase and leaves the frozen record intact', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    assert.equal(ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature }).status, 'frozen');
    const before = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    // 改候选（删掉一条请求阶段）而不走修订
    const decl = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    decl.execution_scope.request.requested_phases = ['coding'];
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    const drifted = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(drifted.status, 'not-applicable');
    assert.equal(drifted.checks.length, 1);
    assert.equal(drifted.checks[0].id, 'execution_scope_frozen');
    assert.equal(drifted.checks[0].severity, 'BLOCKER');
    assert(drifted.checks[0].details?.includes('候选已变更而冻结范围未经修订'), drifted.checks[0].details);
    assert(drifted.checks[0].suggestion?.includes('correction'), drifted.checks[0].suggestion);
    // 冻结记录**字节不变**：不静默重算、不静默沿用
    assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless call under a live feature lock reports instead of choosing a side', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const lockPath = featureFilePath(root, feature, path.join('goal-runs', '.feature.lock'));
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      ownerId: 'o1', pid: process.pid, hostname: os.hostname(),
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(), run_id: 'r-live',
    }));
    const blocked = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(blocked.status, 'not-applicable');
    assert(blocked.checks[0]?.details?.includes('活着的持柄者'), JSON.stringify(blocked.checks));
    assert(blocked.checks[0]?.suggestion?.includes('--goal-run-id'), blocked.checks[0]?.suggestion);
    // **不选边**：既没有冻结 feature 记录，也没有默默采用 run
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '发现活锁后仍然冻结了 feature 记录');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'repair2 runless feature may propose necessary coding only when its real provider is enabled', run() {
  for (const codingEnabled of [true, false]) {
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['review', 'ut'] });
  const before = process.env.MAISON_GOAL_RUN_ID;
  try {
    delete process.env.MAISON_GOAL_RUN_ID;
    if (codingEnabled) {
      const configFile = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.project_profile = { name: 'hmos-app' };
      fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    }
    assert.equal(ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature }).status, 'frozen');
    const scope = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    assert.equal(scope.completion_target, 'feature');
    assert(!scope.phase_chain.includes('coding'), '必须覆盖 coding 真正在链外的无 run 载体');
    const unmapped = buildSummaryRepairCandidates({ phase: 'ut', reportValidity: 'PASS', checks: [UT_REAL_ASSERTION_CHECK],
      reviewReportText: null, verifierReportText: '| id | status |\n|---|---|\n| end_to_end_driving | PASS |\n| business_assertion_value | PASS |\n' });
    assert(unmapped.some(candidate => candidate.files.includes('feature_opencard@ohosTest')), '原真实UT诊断保留未解析源码占位');
    assert.equal(scopeRevisionInputFromRepairCandidates(unmapped, { projectRoot: root, frameworkRoot, feature }), null,
      '未解析源码诊断不能仅凭coding类别授予写权');
    const source = fs.readFileSync(path.join(root, 'src/demo/value.ts'), 'utf8');
    assert(source.includes('= 1;'), '当前实现确与原验收42不符');
    const reportText = '# Review\n## 问题清单\n| ID | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |\n|---|---|---|---|---|---|\n'
      + '| CR-1 | MAJOR | 逻辑错误 | src/demo/value.ts | value为1而原验收要求42 | 未关闭 |\n## 结论\n结论：不通过\n';
    const candidates = collectReviewRepairCandidates({ reportText, reportValidityBlocked: false,
      verifierReportText: '```issue-verification\n- issue: CR-1\n  verdict: confirmed\n  evidence: src/demo/value.ts | value为1而原验收要求42\n```',
      responsibility: repairResponsibilityContext({ projectRoot: root, frameworkRoot, feature }) });
    assert(candidates.some(candidate => candidate.category === 'coding' && candidate.files.includes('src/demo/value.ts')), '真实review producer必须保留当前已核实现对象');
    const currentDisposition = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'review', summaryPresent: true,
      verdict: 'FAIL', schemaCurrent: true, closureCommitted: false,
      openFindings: candidates.map(candidate => ({ id: candidate.id, detail: candidate.summary, owner: candidate.category,
        source_phase: candidate.source_phase, files: candidate.files })) }] });
    const proposal = scopeRevisionInputFromRepairCandidates(candidates, { projectRoot: root, frameworkRoot, feature, currentDisposition });
    if (codingEnabled) assert(proposal?.input.request.requested_phases.includes('coding'), JSON.stringify({ message: '获准完成目标的必要修复不因无run而丢失责任方',
      candidates, currentDisposition, responsibility: candidates.map(target => resolveRepairResponsibility({ projectRoot: root, frameworkRoot, feature, currentDisposition, target })) }));
    else assert.equal(proposal, null, 'generic禁用coding时不能派幽灵责任方');
    assert(candidates.every(target => resolveRepairResponsibility({ projectRoot: root, frameworkRoot, feature, currentDisposition, target }).action === 'unavailable'),
      'producing a necessary proposal must not grant source writes in the original review/UT unit');
    assert.throws(() => scopeRevisionInputFromRepairCandidates(candidates.map(candidate => ({ ...candidate, files: ['../outside.ts'] })),
      { projectRoot: root, frameworkRoot, feature, currentDisposition }), /path escapes project root/,
    'a known finding identity cannot authorize a different or root-external repair target');
    assert.deepStrictEqual(featureEffectiveScope(readFeatureFrozenScope(root, feature)!), scope, '提案不直接改写冻结范围，仍由既有修订入口核验');
  } finally {
    if (before === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = before;
    fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache();
  }
  }
} });

cases.push({ name: 'D1 feature-level revision is behaviorally equivalent to scope_revised', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const record = readFeatureFrozenScope(root, feature)!;
    const birth = featureEffectiveScope(record);
    // 追加一条合法修订：与 run 的 `scope_revised` 形状一致，链校验也是同一个函数
    const next = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    const applied = appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next as never, trigger: { phase: 'coding' } });
    assert(applied.revision, '合法修订应当落一条记录');
    assert.equal(applied.revision!.revision_index, 1);
    assert.equal(applied.revision!.previous_scope_fingerprint, executionScopeFingerprint(birth));
    assert.deepStrictEqual([...applied.revision!.allowed_fields], [...SCOPE_REVISION_FIELDS_CONST]);
    assert.deepStrictEqual(featureEffectiveScope(applied.record).phase_chain, ['plan', 'coding', 'review', 'ut']);
    // 出生段原样保留（来源历史不改写）
    assert.deepStrictEqual(applied.record.execution_scope.phase_chain, birth.phase_chain);
    // 链断裂即拒：手改一条修订的前指纹后读取必须抛错（与 run 载体同一判据）
    const doc = JSON.parse(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'));
    doc.revisions[0].previous_scope_fingerprint = '0'.repeat(64);
    fs.writeFileSync(featureFrozenScopePath(root, feature), JSON.stringify(doc));
    assert.throws(() => readFeatureFrozenScope(root, feature), /修订链断裂/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 goal run is born from the transferred feature effective scope', async run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    // 含 coding/ut 的链出生时会冻结 `run_base_sha`，需要真实 git 仓库。
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    // S0 → S1：先在 feature 上做一次合法修订，再转入 run（覆盖「转入前已修订」那一行）
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const s1 = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: s1 as never, trigger: { phase: 'coding' } });
    const effective = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);

    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'd1-run', adapter: 'codex', requirement: '把 value 改成 42' });
    // 出生范围 = 转交时的**有效**范围（S1），不是候选重算结果（S0）
    assert.deepStrictEqual(prepared.manifest.execution_scope!.phase_chain, effective.phase_chain);
    assert.notDeepStrictEqual(prepared.manifest.execution_scope!.phase_chain, birth.phase_chain);
    // feature 记录登记了转交与指纹，出生段与修订历史保留
    const after = readFeatureFrozenScope(root, feature)!;
    assert.equal(after.transfers?.at(-1)?.run_id, 'd1-run');
    assert.equal(after.transfers?.at(-1)?.scope_fingerprint, executionScopeFingerprint(effective));
    assert.equal(after.revisions.length, 1);
    assert.deepStrictEqual(after.execution_scope.phase_chain, birth.phase_chain);
    // 转入后无 run 调用不再选 feature 载体，而是明确报错（D1.3 第三行）
    const afterTransfer = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(afterTransfer.status, 'not-applicable');
    assert(afterTransfer.checks[0]?.details?.includes('已转交给 run d1-run'), JSON.stringify(afterTransfer.checks));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

/** plan 6c22ae8b：进程内走真实 `runRevalidate`，捕获输出；`runId` 为调用环境的 MAISON_GOAL_RUN_ID（空=无身份）。 */
function revalidateCaptured(root: string, frameworkRoot: string, feature: string, runId: string, from?: string): { code: number; out: string } {
  const lines: string[] = [];
  const log = console.log; const error = console.error;
  const envBefore = { run: process.env.MAISON_GOAL_RUN_ID, nodeOptions: process.env.NODE_OPTIONS };
  const restore = (key: string, value: string | undefined): void => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  process.env.MAISON_GOAL_RUN_ID = runId;
  // 夹具的 framework/harness 是 junction：若子进程真被 spawn，保留链接路径才会按 consumer 布局落回本夹具
  //（否则 realpath 落到开发仓，反向变异看不到 summary 被覆盖）。
  process.env.NODE_OPTIONS = [envBefore.nodeOptions, '--preserve-symlinks', '--preserve-symlinks-main'].filter(Boolean).join(' ');
  try {
    const code = runRevalidate(path.join(frameworkRoot, 'harness'), root, frameworkRoot, feature, from);
    return { code, out: lines.join(String.fromCharCode(10)) };
  } finally {
    console.log = log; console.error = error;
    restore('MAISON_GOAL_RUN_ID', envBefore.run); restore('NODE_OPTIONS', envBefore.nodeOptions);
  }
}

cases.push({ name: 'revalidate without authority refuses before spawning and leaves closed summaries byte-identical', run() {
  // ①：1.2 feature，无 run 身份、无冻结记录，已有闭环阶段；显式 --from 让确实有目标。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    seedRunlessChain(root, feature, ['coding', 'review', 'ut']);
    const reportsDir = featurePhaseReportsDir(root, feature, 'coding', frameworkRoot);
    fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({ checks: [], summary: { verdict: 'PASS' } }));
    const summaryBefore = fs.readFileSync(path.join(reportsDir, 'summary.json'));
    const reportBefore = fs.readFileSync(path.join(reportsDir, 'script-report.json'));
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '前提：无冻结记录');
    const { code, out } = revalidateCaptured(root, frameworkRoot, feature, '', 'coding');
    assert.equal(code, 1, out);
    assert(out.includes('重验目标：coding(from)'), '前提：确实有目标——' + out);
    assert(out.includes('execution_scope_frozen') && out.includes('没有 run 身份、也没有 feature 冻结记录'), out);
    assert(fs.readFileSync(path.join(reportsDir, 'summary.json')).equals(summaryBefore), 'summary.json 被覆盖');
    assert(fs.readFileSync(path.join(reportsDir, 'script-report.json')).equals(reportBefore), 'script-report.json 被覆盖');
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '拒绝路径不得首次冻结');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'P4 t5 rejected runless UT preserves the original run reports', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  const repo = path.resolve(__dirname, '../../..');
  try {
    seedRunlessChain(root, feature, ['coding', 'review', 'ut']);
    const reportsDir = featurePhaseReportsDir(root, feature, 'ut', frameworkRoot);
    fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({ checks: [], summary: { verdict: 'PASS' } }));
    const originals = new Map(['script-report.json', 'summary.json', 'phase-evidence-manifest.json'].map(name =>
      [name, fs.readFileSync(path.join(reportsDir, name))]));
    const result = runRuntimeTestChild({ root }, () => spawnSync(process.execPath,
      [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')),
        '--phase', 'ut', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env,
        TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '', MAISON_GOAL_ATTEMPT: '' } }));
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    assert.equal(result.status, 1, output);
    assert(output.includes('execution_scope_frozen') && output.includes('没有 run 身份、也没有 feature 冻结记录'), output);
    assert(!output.includes('schema mismatch'), 'authority rejection must not manufacture a second capability diagnosis');
    for (const [name, bytes] of originals) assert(fs.readFileSync(path.join(reportsDir, name)).equals(bytes), `${name} was overwritten`);
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'revalidate without identity on a transferred feature fails instead of reporting nothing to do', run() {
  // ③：沿 `D1 goal run is born from the transferred feature effective scope`：冻结 → 建 run 登记转交 → 无身份调用、不传 --from。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'rv-transfer', adapter: 'codex', requirement: '把 value 改成 42' });
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers?.at(-1)?.run_id, 'rv-transfer');
    const { code, out } = revalidateCaptured(root, frameworkRoot, feature, '');
    assert.equal(code, 1, out);
    assert(out.includes('已转交给 run rv-transfer'), out);
    assert(!out.includes('重验目标'), '不得进入 spawn 段：' + out);
    const recordAbs = featureFilePath(root, feature, REVALIDATION_RECORD_FILE);
    assert(!fs.existsSync(recordAbs) || JSON.parse(fs.readFileSync(recordAbs, 'utf8')).exit_code !== 0, '写了 exit_code:0 的账本');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 transfer fingerprint mismatch reports both fingerprints', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const effective = executionScopeFingerprint(featureEffectiveScope(readFeatureFrozenScope(root, feature)!));
    // ① 调用方给的指纹不等于记录自己算出来的有效范围指纹 → 当场拒（不信调用方）
    assert.throws(() => registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r1', transferredScopeFingerprint: 'a'.repeat(64) }),
      (error: Error) => /转交指纹与 feature 有效范围失配/.test(error.message) && error.message.includes(effective.slice(0, 16)));
    // ② 正常登记：指纹由记录的有效范围计算
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r1', transferredScopeFingerprint: effective });
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers?.at(-1)?.scope_fingerprint, effective);
    // ③ 同一 feature 不得再转交给第二个 run——两个 run id 都在报错里
    assert.throws(() => registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r2', transferredScopeFingerprint: effective }),
      (error: Error) => /已转交给 run r1/.test(error.message) && /r2/.test(error.message));
    // ④ 已登记的指纹被手改（转交记录损坏）→ 同一 run 重试也必须报错，不静默覆盖
    const doc = JSON.parse(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'));
    doc.transfers[0].scope_fingerprint = 'b'.repeat(64);
    fs.writeFileSync(featureFrozenScopePath(root, feature), JSON.stringify(doc));
    assert.throws(() => registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r1', transferredScopeFingerprint: effective }), /转交记录损坏/);
    // ⑤ 无 run 身份而记录声明已转交 → 统一入口明确报错，不返回 feature 范围
    assert.throws(() => loadEffectiveExecutionScope(root, feature), /已转交给 run r1/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless completion rejects bare reports and tampered frozen scope', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const record = readFeatureFrozenScope(root, feature)!;
    const chain = executionCompletionPhases(featureEffectiveScope(record)).map(String);
    // ① 只有 feature.yaml + 裸报告（无冻结完成原件）→ 完成判定不成立
    seedRunlessChain(root, feature, chain);
    const bare = completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.notEqual(bare.verdict, 'VALID', JSON.stringify(bare));
    // ② 正常生成后 VALID
    const outcome = legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert(outcome.completionPath, JSON.stringify(outcome));
    assert.equal(completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot }).verdict, 'VALID');
    // ③ 冻结记录的范围内容被非法改动 → INVALID（指纹失配）
    const doc = JSON.parse(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'));
    doc.execution_scope.requested_results = ['tampered'];
    fs.writeFileSync(featureFrozenScopePath(root, feature), JSON.stringify(doc));
    const tampered = completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(tampered.verdict, 'INVALID', JSON.stringify(tampered));
    // ④ 伪造 run 身份（feature 载体声明 run_id）→ INVALID
    fs.writeFileSync(featureFrozenScopePath(root, feature), JSON.stringify(JSON.parse(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'))));
    const originalAbs = outcome.completionPath!;
    const forged = JSON.parse(fs.readFileSync(originalAbs, 'utf8'));
    forged.run_id = 'forged-run';
    const text = JSON.stringify(forged, null, 2) + '\n';
    fs.writeFileSync(originalAbs, text);
    fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify({
      schema_version: forged.schema_version,
      original_path: path.relative(root, originalAbs).split(path.sep).join('/'),
      original_sha256: createHash('sha256').update(text).digest('hex'),
    }));
    const forgedVerdict = completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    // 顶层伪造 run 身份：先撞上「该 run 没有出生范围」这条既有判据（同样是拒绝，不必改判据顺序）
    assert.equal(forgedVerdict.verdict, 'INVALID', JSON.stringify(forgedVerdict));
    assert(forgedVerdict.reasons.length > 0, JSON.stringify(forgedVerdict));
    // ⑤ H1 本身：feature 载体的逐阶段 run_id 必须为 null，改一个即 INVALID
    const perPhase = JSON.parse(fs.readFileSync(originalAbs, 'utf8'));
    perPhase.run_id = null;
    perPhase.phases[0].run_id = 'forged-run';
    const perPhaseText = JSON.stringify(perPhase, null, 2) + '\n';
    fs.writeFileSync(originalAbs, perPhaseText);
    fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify({
      schema_version: perPhase.schema_version,
      original_path: path.relative(root, originalAbs).split(path.sep).join('/'),
      original_sha256: createHash('sha256').update(perPhaseText).digest('hex'),
    }));
    const perPhaseVerdict = completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(perPhaseVerdict.verdict, 'INVALID', JSON.stringify(perPhaseVerdict));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless diff baseline normalizes working and fails only on a bad explicit ref', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    const prior = process.env.HARNESS_DIFF_BASE_REF;
    try {
      // ① 未设 env → 与工作区比（不 FAIL）
      delete process.env.HARNESS_DIFF_BASE_REF;
      const implicit = resolveEffectiveDiffBaseline(root, feature);
      assert.equal(implicit.available, true, JSON.stringify(implicit));
      assert.equal((implicit as { source: string }).source, 'working_tree');
      // ② 显式 'working' → 同上
      process.env.HARNESS_DIFF_BASE_REF = 'working';
      assert.equal(resolveEffectiveDiffBaseline(root, feature).available, true);
      // ③ 显式 commit → 原义透传
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      process.env.HARNESS_DIFF_BASE_REF = head;
      const explicit = resolveEffectiveDiffBaseline(root, feature);
      assert.equal(explicit.available, true);
      assert.equal((explicit as { baseSha: string }).baseSha, head);
      // ④ 显式值不可达 → 唯一的 FAIL
      process.env.HARNESS_DIFF_BASE_REF = 'no-such-ref';
      const bad = resolveEffectiveDiffBaseline(root, feature);
      assert.equal(bad.available, false, JSON.stringify(bad));
    } finally {
      if (prior === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = prior;
    }
    // ⑤ 反例：**有 run** 时基线缺失必须 FAIL，不得退化成工作区比较
    const withRun = resolveEffectiveDiffBaseline(root, feature, 'no-such-run');
    assert.equal(withRun.available, false, JSON.stringify(withRun));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless ui scope gate passes for a declared ui file', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject({ uiFile: true });
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    // 改**契约内**的 UI 文件
    fs.appendFileSync(path.join(root, 'src/demo/Page.ets'), '// declared ui change\n');
    const resolved = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'coding', track: 'full',
      inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } });
    const gate = runUiDiffWithinDeclaredFiles({ projectRoot: root, feature, runId: null, frameworkRoot, resolvedInputs: resolved.inputs });
    // 有 feature 冻结记录 → **不得**再走历史 SKIP
    assert.notEqual(gate.status, 'SKIP', JSON.stringify(gate));
    assert.equal(gate.status, 'PASS', JSON.stringify(gate));
    assert(gate.details.includes('本次 UI 变化 1 个') && gate.details.includes('原请求明确范围外 0 个'), gate.details);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless ui scope gate permits a new unpredicted UI file in the same implementation domain', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject({ uiFile: true });
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    // 改**契约外**的 UI 文件
    fs.writeFileSync(path.join(root, 'src/demo/Rogue.ets'), '@Entry @Component struct Rogue { build() { Column() {} } }\n');
    const resolved = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'coding', track: 'full',
      inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } });
    const gate = runUiDiffWithinDeclaredFiles({ projectRoot: root, feature, runId: null, frameworkRoot, resolvedInputs: resolved.inputs });
    assert.equal(gate.status, 'PASS', JSON.stringify(gate));
    assert(gate.details.includes('本次 UI 变化 0 个') && gate.details.includes('待核实际关联的工作区候选 1 个'), gate.details);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 reconcile-only needs no trace for a runless zero-device feature', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const scope = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    // 前提：本 feature 的有效范围确实零设备（验收全 unit + 有来源 impact）
    assert(hasNoTestingObligation(scope), JSON.stringify(scope.obligations.map(o => [o.kind, o.applicability])));
    // 统一入口在无 run 时读得到范围——这正是 `--report-reconcile-only` 前置条件放开后依赖的事实
    assert(loadEffectiveExecutionScope(root, feature), '无 run 时统一入口读不到有效范围');
    assert.deepStrictEqual(executionScopeEvidenceIssues(root, feature, scope), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

// plan e7a2c4f1 §3.4（G02/G04）：内容等价判据**两侧必须同一个**。resolver 侧自动对齐了账本
// 形状（依赖字节漂移而解析值相同），完成侧若还逐字节比旧 sha256，就会出现「resolver 过了、
// 完成检查照样 input binding stale」的分裂——冻结的 acceptance.yaml 只加一行注释就永远完不成。
cases.push({ name: 'P3-T9 a frozen input whose bytes drifted with identical parsed content still completes; a real content change still blocks', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const scope = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    assert.deepStrictEqual(executionScopeEvidenceIssues(root, feature, scope), [], '前提：刚冻结时完成侧须干净');
    const acceptancePath = featureFilePath(root, feature, 'acceptance.yaml');
    const frozenBytes = fs.readFileSync(acceptancePath, 'utf8');
    // ① 只加注释：字节变了、YAML 解析值逐字节相同 → 完成侧与 resolver 同判，不拦完成。
    fs.writeFileSync(acceptancePath, `${frozenBytes}\n# 只改注释，解析值不变\n`);
    assert.deepStrictEqual(
      executionScopeEvidenceIssues(root, feature, scope), [],
      '字节漂移而解析值相同：完成侧仍逐字节比旧 sha256 → 与 resolver 分裂',
    );
    // ② 内容真变（多一个验收条目）→ 仍然拒绝完成，判据一个字没放宽。
    const changed = YAML.parse(frozenBytes) as { criteria: Array<Record<string, unknown>> };
    changed.criteria.push({ id: 'AC-2', description: 'new behavior', priority: 'P1', testable: true, verification_steps: ['read'], expected_result: 'x', ut_layer: 'unit', ut_focus: 'new' });
    fs.writeFileSync(acceptancePath, YAML.stringify(changed));
    assert(
      executionScopeEvidenceIssues(root, feature, scope).some(issue => /input binding stale/.test(issue)),
      '内容真变仍须拒绝完成（同名即换绑是 §7 明列的不做项）',
    );
    // ③ 文件没了：存在性变化不属账本漂移，照旧拒绝。
    fs.rmSync(acceptancePath);
    assert(
      executionScopeEvidenceIssues(root, feature, scope).some(issue => /input binding stale/.test(issue)),
      '依赖存在性变化不得被当成账本漂移',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 in-run revision after transfer is not a conflict', async run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const transferred = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'd1-inrun', adapter: 'codex', requirement: '把 value 改成 42' });
    const before = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    // run 内发生一次合法 D2 修订
    const next = { ...transferred, phase_chain: ['plan', ...transferred.phase_chain] };
    const eventsAbs = featureFilePath(root, feature, path.join('goal-runs', 'd1-inrun', 'events.jsonl'));
    fs.appendFileSync(eventsAbs, JSON.stringify({
      ts: new Date().toISOString(), type: 'scope_revised', revision_index: 1,
      previous_scope_fingerprint: executionScopeFingerprint(transferred),
      execution_scope: next, revision_input: null,
      trigger: { phase: 'coding', check_id: 'scope_revision_input' },
      allowed_fields: [...SCOPE_REVISION_FIELDS_CONST],
    }) + String.fromCharCode(10));
    // run 的有效范围随之变化；feature 记录**一字不改**，两者不同不算冲突
    assert.deepStrictEqual(resolveEffectiveScopeSource(root, feature, 'd1-inrun')!.scope.phase_chain, ['plan', ...transferred.phase_chain]);
    assert(!loadEffectiveExecutionScope(root, feature, 'd1-inrun')!.phase_chain.includes('plan'), 'a queue-only edit cannot invent a plan duty');
    assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), before);
    // 唯一的「损坏」判据仍成立：转交指纹 = run 出生范围指纹
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.transfers?.at(-1)?.scope_fingerprint, executionScopeFingerprint(validateExecutionScope(prepared.manifest.execution_scope!)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: '1804 real sync-closure closes its phase without signing new runless Feature completion', run() {
  // Real receipt/finalizer path, with a legacy frozen scope awaiting explicit Goal transfer.
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    // closure attestation 只认「含 src/main 的模块目录」，且必须在 summary 之前落盘
    fs.mkdirSync(path.join(root, 'src/demo/src/main'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/demo/src/main/value.ts'), 'export const value: number = 42;\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const chain = executionCompletionPhases(featureEffectiveScope(readFeatureFrozenScope(root, feature)!)).map(String);
    seedRunlessChain(root, feature, chain, 'ut');
    const reportsDir = featurePhaseReportsDir(root, feature, 'ut', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'trace.json'), JSON.stringify({ schema_version: '1.0.0', feature, phase: 'ut' }));
    const projectionAbs = featureFilePath(root, feature, 'feature-completion.json');
    assert(!fs.existsSync(projectionAbs), '前提：尚未生成完成投影');
    const args = [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')), '--sync-closure', '--phase', 'ut', '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot];
    const runSync = () => spawnSync(process.execPath, args,
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const reportFile = path.join(reportsDir, 'script-report.json'), reportBytes = fs.readFileSync(reportFile);
    const summaryFile = path.join(reportsDir, 'summary.json'), summaryBytes = fs.readFileSync(summaryFile);
    assert(!JSON.parse(summaryBytes.toString()).closure_status && !JSON.parse(summaryBytes.toString()).closure_commit);
    assert(!loadPhaseEvidenceManifest(root, feature, 'ut'), 'the fixture must not pre-sign the missing phase evidence');
    fs.unlinkSync(reportFile);
    const summary = JSON.parse(summaryBytes.toString());
    const checks = readPhaseChecks(root, feature, 'ut', summary);
    const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ projectRoot: root, frameworkRoot, feature, chain: ['ut'],
      currentResults: [{ phase: 'ut', summary, checks }] }));
    assert(disposition.completionBlocking.some(problem => problem.id === 'required_check_conclusion' && problem.phase === 'ut'));
    assert.deepEqual(fs.readFileSync(summaryFile), summaryBytes, 'a missing result must not rewrite the old open summary');
    assert(!fs.existsSync(projectionAbs));
    fs.writeFileSync(reportFile, reportBytes);
    const cli = runSync();
    assert.equal(cli.status, 0, (cli.stdout ?? '') + (cli.stderr ?? ''));
    assert(!fs.existsSync(projectionAbs), 'sync-closure must not sign a new runless Feature completion');
    assert((cli.stdout ?? '').includes('goal-mode-entry --prepare-run'), 'full delivery must point to the shared runtime');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 detached birth after a feature-level revision uses S1 and registers transferred_to', run() {
  // §3 问题 12 的 detached 反例：入口②（fresh/detached runtime 自带出生）与入口①共用
  // `resolveBirthExecutionScope`，因此同样以 feature 的**有效**范围（S1）出生并登记转交。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const s1 = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: s1 as never, trigger: { phase: 'coding' } });
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    const resolved = resolveBirthExecutionScope(root, feature, workflow, frameworkRoot, '把 value 改成 42');
    assert.equal(resolved.source, 'feature-record');
    assert.deepStrictEqual(resolved.scope!.phase_chain, ['plan', 'coding', 'review', 'ut']);
    // 出生登记（runtime 在 createGoalRun 成功后调同一个函数）
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'd1-detached', transferredScopeFingerprint: executionScopeFingerprint(resolved.scope!) });
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.transfers?.at(-1)?.run_id, 'd1-detached');
    assert.equal(record.transfers?.at(-1)?.scope_fingerprint, executionScopeFingerprint(resolved.scope!));
    // 出生段与修订历史保留
    assert.deepStrictEqual(record.execution_scope.phase_chain, birth.phase_chain);
    assert.equal(record.revisions.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 modern authority is not gated by a stale feature.yaml track', run() {
  // 第一轮阻断 1：feature.yaml 残留 `track: lite` 时，现代有效范围在场仍须按 full 口径——
  // 否则 `--phase review` 在冻结入口之前就被判成非法 phase。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const decl = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    decl.track = 'lite';
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    // 冻结之前：退役声明同样被忽略，不改变现代义务
    assert.equal(resolveFeatureTrack(loadFeatureTrackDecl(root, feature)), 'full');
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    // 冻结之后：现代有效范围在场 → full（phase 合法集与 closure 口径同源）
    assert.equal(resolveFeatureTrack(loadFeatureTrackDecl(root, feature)), 'full');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 an unreadable feature lock is unknown authority, not an absent lock', run() {
  // 第一轮阻断 4 后半：锁文件存在但解析不出来 = 未知权威，不能按「无锁」放行。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const lockPath = featureFilePath(root, feature, path.join('goal-runs', '.feature.lock'));
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '{ not json');
    const blocked = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(blocked.status, 'not-applicable');
    assert(blocked.checks[0]?.details?.includes('无法解析'), JSON.stringify(blocked.checks));
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '损坏锁下仍然冻结了记录');
    // 同一条前置对无 run 收尾也生效
    assert.equal(applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'coding', workflowTrack: 'full' }).revisionApplied, false, 'retired closing path performs no writes; the actual entry still rejects unknown authority above');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 birth runs the same candidate drift and provenance checks as the freeze entry', run() {
  // 第一轮阻断 3：冻结 S0 → 改候选 → 出生不得直接沿用旧冻结范围。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    // 未改候选时出生正常
    assert.equal(resolveBirthExecutionScope(root, feature, workflow, frameworkRoot, '把 value 改成 42').source, 'feature-record');
    // 改候选（不走修订）→ 出生当场拒
    const decl = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    decl.execution_scope.request.requested_results = ['drifted'];
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    assert.throws(() => resolveBirthExecutionScope(root, feature, workflow, frameworkRoot, '把 value 改成 42'), /候选已变更而冻结范围未经修订/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a transferred record refuses a second birth instead of recomputing the candidate', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    const effective = executionScopeFingerprint(featureEffectiveScope(readFeatureFrozenScope(root, feature)!));
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r-first', transferredScopeFingerprint: effective });
    // 已转交 → **不得**静默回算候选（那会让第二次出生拿到与在跑 run 无关的范围）
    assert.throws(() => resolveBirthExecutionScope(root, feature, workflow, frameworkRoot, '把 value 改成 42'), /已转交给 run r-first/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 completion rejects a tampered gate fingerprint', run() {
  // 第一轮阻断 8：`gate_fingerprint` 此前只写不核。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const chain = executionCompletionPhases(featureEffectiveScope(readFeatureFrozenScope(root, feature)!)).map(String);
    seedRunlessChain(root, feature, chain);
    const outcome = legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert(outcome.completionPath, JSON.stringify(outcome));
    assert.equal(completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot }).verdict, 'VALID');
    // 改一个阶段的 gate_fingerprint 并同步投影哈希——仍必须 INVALID
    const originalAbs = outcome.completionPath!;
    const doc = JSON.parse(fs.readFileSync(originalAbs, 'utf8'));
    doc.phases[0].gate_fingerprint = 'f'.repeat(64);
    const text = JSON.stringify(doc, null, 2) + '\n';
    fs.writeFileSync(originalAbs, text);
    fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify({
      schema_version: doc.schema_version,
      original_path: path.relative(root, originalAbs).split(path.sep).join('/'),
      original_sha256: createHash('sha256').update(text).digest('hex'),
    }));
    const verdict = completionOf({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(verdict.verdict, 'INVALID', JSON.stringify(verdict));
    assert(verdict.reasons.some(reason => reason.includes('gate_fingerprint')), JSON.stringify(verdict.reasons));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 frozen record writes are exclusive, atomic and idempotent on retry', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const first = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(first.status, 'frozen');
    const record = readFeatureFrozenScope(root, feature)!;
    // ① 同一份范围与候选指纹重复冻结 = 幂等（并发输的一方读回既有记录，不覆盖）
    const again = freezeFeatureExecutionScope({ projectRoot: root, feature, scope: record.execution_scope, candidateFingerprint: record.candidate_fingerprint });
    assert.equal(again.frozen_at, record.frozen_at, '幂等冻结改写了既有记录');
    // ② 不同内容的重复冻结 = 真冲突，明确报错而不是覆盖
    assert.throws(() => freezeFeatureExecutionScope({ projectRoot: root, feature, scope: record.execution_scope, candidateFingerprint: 'c'.repeat(64) }), /不得覆盖既有记录/);
    // ③ 同一条修订重试不追加第二条
    const birth = featureEffectiveScope(record);
    const next = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next as never, trigger: { phase: 'coding' } });
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next as never, trigger: { phase: 'coding' } });
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 1, '同内容重试追加了第二条修订');
    // ④ 写入是原子的：目录里不留半截临时文件
    const leftovers = fs.readdirSync(path.dirname(featureFrozenScopePath(root, feature))).filter(name => name.includes('.tmp-'));
    assert.deepStrictEqual(leftovers, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 feature facts identity is checked even with a validated baseline', run() {
  // 第一轮阻断 5：baseline 只管来源新鲜度，不能替代「这份事实属于哪一份冻结范围」。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const fingerprint = executionScopeFingerprint(featureEffectiveScope(readFeatureFrozenScope(root, feature)!));
    const factsPath = featureFilePath(root, feature, path.join('context', 'facts.md'));
    fs.mkdirSync(path.dirname(factsPath), { recursive: true });
    const write = (declared: string): void => {
      fs.writeFileSync(factsPath, '---\n' + YAML.stringify({
        schema_version: '1.1', feature, frozen_scope_fingerprint: declared, established_by: 'coding',
        ready_to_produce: true, has_blocker_coverage_risk: false,
        source_code_paths: ['src/demo/value.ts'], key_inputs_read: ['src/demo/value.ts'],
        files_inspected_count: 6, searches_performed_estimate: 4, decisions_unlocked: ['value is 42'], exploration_mode: 'sequential',
      }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/demo/value.ts | value has number type | preserve type |\n');
    };
    const invocation = (baseline: boolean) => ({
      subject: { feature }, first_phase: 'coding', source_paths: ['src/demo/value.ts'], required_input_snippets: [],
      frozen_scope_fingerprint: fingerprint,
      ...(baseline ? { baseline: { established_by: 'coding', fingerprint: factsBaselineFingerprint(fs.readFileSync(factsPath, 'utf8')), dependencies: [] } } : {}),
    });
    write('0'.repeat(64));
    for (const withBaseline of [false, true]) {
      const issues = checkFactsArtifact(root, feature, 'coding', { factsContext: invocation(withBaseline) as never, frameworkRoot });
      assert(issues.some(issue => issue.id === 'context_exploration_facts_run_match'),
        `baseline=${withBaseline} 时身份位没有被核对：` + JSON.stringify(issues.map(issue => issue.id)));
    }
    write(fingerprint);
    const ok = checkFactsArtifact(root, feature, 'coding', { factsContext: invocation(false) as never, frameworkRoot });
    assert(!ok.some(issue => issue.id === 'context_exploration_facts_run_match'), JSON.stringify(ok.map(issue => issue.id)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 public runless Coding freezes once and keeps the modern phase selection', run() {
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    const declPath = featureTrackDeclPath(root, feature);
    const decl = YAML.parse(fs.readFileSync(declPath, 'utf8'));
    decl.track = 'lite';
    fs.writeFileSync(declPath, YAML.stringify(decl));
    const frozenPath = featureFrozenScopePath(root, feature);
    assert(!fs.existsSync(frozenPath), 'the first public check must start without a frozen scope');
    const coding = spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')),
      '--phase', 'coding', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const output = (coding.stdout ?? '') + (coding.stderr ?? '');
    assert.equal(coding.error, undefined, output);
    assert.notEqual(coding.status, null, output);
    const frozen = readFeatureFrozenScope(root, feature);
    assert(frozen, 'the public Coding check must freeze the feature scope: ' + output);
    assert.equal(frozen.candidate_fingerprint, featureScopeCandidateFingerprint(root, feature));

    const reportsDir = featurePhaseReportsDir(root, feature, 'coding', frameworkRoot);
    const originals = [frozenPath, path.join(reportsDir, 'script-report.json'), path.join(reportsDir, 'summary.json')]
      .map(file => ({ file, bytes: fs.readFileSync(file) }));
    const reused = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(reused.status, 'reused', JSON.stringify(reused.checks));
    assert.deepStrictEqual(reused.checks, []);
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    const track = resolveFeatureTrack(loadFeatureTrackDecl(root, feature));
    const allowed = resolvePhaseChain(workflow, track);
    assert.equal(track, 'full');
    assert(allowed.idSet.has('review') && allowed.idSet.has('ut'), JSON.stringify(allowed.featureOrdered));
    for (const { file, bytes } of originals) assert(fs.readFileSync(file).equals(bytes), file + ' changed on reuse');
    assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')), 'runless checking must not create a run');
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'direct phase checking must not sign Feature completion');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0, 'direct phase checking must not revise scope');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a coding-only runless request is managed through the candidate, and freezing does not prove it predates the edit', run() {
  // plan 7e1d4b93 · R3 的生产路径用例。回答的是需求 §8 问题 1：coding-only 的不建 run
  // 请求里，「候选 → 首次阶段调用冻结 → 候选指纹核对」这条路真实成立到什么程度。
  //
  // 公开入口拒绝缺候选，恢复后用同一冻结判定；另查候选晚于源码的输入。
  const repo = path.resolve(__dirname, '../../..');
  const runlessCodingOnly = () => setupRunlessProject({ chain: ['coding'], completionTarget: 'request' });
  /** `execution_scope` 是 feature.yaml 里的**字段**，不是文件——解析后删字段再写回。 */
  const dropCandidate = (root: string, feature: string): void => {
    const declPath = featureTrackDeclPath(root, feature);
    const raw = YAML.parse(fs.readFileSync(declPath, 'utf8')) as Record<string, unknown>;
    delete raw.execution_scope;
    fs.writeFileSync(declPath, YAML.stringify(raw));
  };
  const seedGit = (root: string): void => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
  };
  const runPhase = (root: string, frameworkRoot: string, feature: string, phase: string) => spawnSync(
    process.execPath,
    [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')),
      '--phase', phase, '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
    { cwd: root, encoding: 'utf8', timeout: 300000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } },
  );
  const combined = (r: ReturnType<typeof runPhase>) => (r.stdout ?? '') + (r.stderr ?? '');

  {
    const { root, frameworkRoot, feature } = runlessCodingOnly();
    try {
      seedGit(root);
      const declPath = featureTrackDeclPath(root, feature);
      const candidate = fs.readFileSync(declPath);
      dropCandidate(root, feature);
      const blocked = runPhase(root, frameworkRoot, feature, 'coding');
      const reports = featurePhaseReportsDir(root, feature, 'coding', frameworkRoot);
      assert.equal(blocked.status, 1, combined(blocked));
      assert(combined(blocked).includes('execution_scope_frozen') && combined(blocked).includes('--prepare-scope'), combined(blocked));
      assert(!fs.existsSync(path.join(reports, 'script-report.json')) && !fs.existsSync(path.join(reports, 'summary.json')), '没有权威的拒绝不得发布阶段报告');
      assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '没有候选却冻结了范围');

      fs.writeFileSync(declPath, candidate);
      const recovered = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      assert.equal(recovered.status, 'frozen', JSON.stringify(recovered.checks));
      const record = readFeatureFrozenScope(root, feature)!;
      assert.deepStrictEqual(record.execution_scope.phase_chain, ['coding']);
      assert.equal(record.execution_scope.completion_target, 'request');
      assert.equal(record.candidate_fingerprint, featureScopeCandidateFingerprint(root, feature));
      assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }

  // **真正制造「候选晚于代码」** —— 删候选 → 改源码 → 生成候选 → 首次冻结 ----
  // 这条的价值是把上限钉死：冻结记录里没有任何代码基线（feature-execution-scope.ts 的
  // FeatureFrozenScope 只有 frozen_at / candidate_fingerprint 等，没有 base_sha），无 run 的
  // diff 基线默认就是工作区，所以这个历史顺序在冻结入口处**完全不可见**。
  // 断言口径限定为「该冻结入口不拒绝这个历史顺序」——本场景没有跑任何 checker，
  // **不**证明整条阶段链会通过。
  {
    const { root, frameworkRoot, feature } = runlessCodingOnly();
    try {
      seedGit(root);
      // ① 先把预生成的候选删掉，并确认它真的不在了
      dropCandidate(root, feature);
      assert.throws(() => featureScopeCandidateFingerprint(root, feature), '前提：候选应已被删除，否则这条用例证明不了「候选晚于代码」');
      // ② 再改产品源码（这一步在候选之前发生 —— 正是事故的顺序）
      const sourceFile = path.join(root, 'src/demo/value.ts');
      fs.writeFileSync(sourceFile, 'export const value: number = 42;\n');
      // ③ 事后才经**生产入口**生成候选
      prepareFeatureScopeCandidate({
        projectRoot: root, frameworkRoot, feature, completionTarget: 'request',
        requestedResults: ['value is 42'], requestedPhases: ['coding'], requirement: '把 value 改成 42', overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '仅内部取值变化', basisPaths: ['src/demo/value.ts'] },
      });
      // ④ 首次冻结：入口照常接受，一条检查项都不发
      const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
      assert.deepStrictEqual(frozen.checks, [], '冻结入口对「候选晚于代码」发出了检查项——本用例的上限声明需要更新');
      // 记录里确实没有任何代码基线可供比对先后
      const record = readFeatureFrozenScope(root, feature)!;
      assert(!Object.keys(record).some(key => /base_sha|base_commit/.test(key)), '冻结记录出现了代码基线字段——§5.3 #2 的上限声明需要更新');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }
} });

cases.push({ name: 'D1 real createGoalRun birth transfers the feature effective scope', run() {
  // 必修 2 后半：detached / fresh runtime 的出生路径由**真实** `resolveBirthScopeForManifest`
  // → `buildGoalManifestFromInput` → `createGoalRun` → `registerFeatureScopeTransfer` 三步组成，
  // 这里按同一顺序真实跑一遍（runtime 内联调用的就是这三个函数）。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const s1 = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: s1 as never, trigger: { phase: 'coding' } });
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    const scope = resolveBirthScopeForManifest(root, { feature, requirement: '把 value 改成 42' }, workflow, frameworkRoot)!;
    assert.deepStrictEqual(scope.phase_chain, ['plan', 'coding', 'review', 'ut'], '出生范围不是 feature 的有效范围（S1）');
    const manifest = buildGoalManifestFromInput({
      feature, run_id: 'd1-detached-real', requirement: '把 value 改成 42', execution_scope: scope,
      chain_override: [...scope.phase_chain], unattended: { write_mode: 'full-access', approval_mode: 'never' },
    }, { projectRoot: root });
    createGoalRun({ projectRoot: root, manifest, chain: [...scope.phase_chain] });
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: manifest.run_id, transferredScopeFingerprint: executionScopeFingerprint(scope) });
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.transfers?.at(-1)?.run_id, 'd1-detached-real');
    assert.equal(record.transfers?.at(-1)?.scope_fingerprint, executionScopeFingerprint(scope));
    // run 的有效范围由 run 载体给出；出生指纹与登记值一致（不一致即统一入口报错）
    assert.deepStrictEqual(resolveEffectiveScopeSource(root, feature, manifest.run_id)!.scope.phase_chain, scope.phase_chain);
    // 出生段与修订历史保留
    assert.deepStrictEqual(record.execution_scope.phase_chain, birth.phase_chain);
    assert.equal(record.revisions.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 freezing refuses when phase reports exist without an authority', run() {
  // 第二轮阻断 2：既无 run 身份、也无冻结记录，却已有阶段产物 → 不选边。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    writePhaseSummary(root, feature, 'coding', 'PASS');
    const blocked = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(blocked.status, 'not-applicable');
    assert.equal(blocked.checks[0]?.id, 'execution_scope_frozen');
    assert(blocked.checks[0]?.details?.includes('已有阶段产物'), JSON.stringify(blocked.checks));
    assert(blocked.checks[0]?.suggestion?.includes('correction'), blocked.checks[0]?.suggestion);
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '有历史阶段产物时仍然冻结了新记录');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 interleaved writers never lose an update', run() {
  // 第二轮阻断 3：两个 writer 交错执行——各自读到同一份记录，然后依次提交。
  // 写事务必须让后者要么看到前者的结果（不丢更新），要么明确报错；**不得静默覆盖**。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    // 两个 writer 各自提交一条修订。写事务把它们**串行化**：后者读到的是前者提交后的状态，
    // 于是两条都留下（不丢更新）；若后者拿的是过期读入字节，则必须明确报错。
    const a = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: a as never, trigger: { phase: 'coding' } });
    const b = { ...featureEffectiveScope(readFeatureFrozenScope(root, feature)!), phase_chain: ['spec', 'plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: b as never, trigger: { phase: 'review' } });
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.revisions.length, 2, '并发写丢了更新');
    assert.deepStrictEqual(record.revisions.map(item => item.revision_index), [1, 2]);
    assert.deepStrictEqual(featureEffectiveScope(record).phase_chain, ['spec', 'plan', ...birth.phase_chain]);
    // 出生段始终是来源历史，两次写都没动它
    assert.deepStrictEqual(record.execution_scope.phase_chain, birth.phase_chain);
    // 写锁不留残留
    assert(!fs.existsSync(`${featureFrozenScopePath(root, feature)}.lock`), '写锁未释放');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a held write lock blocks instead of overwriting', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const lockPath = `${featureFrozenScopePath(root, feature)}.lock`;
    // 模拟「另一个活着的 writer 正持锁」：pid 存活、时间戳新鲜
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    try {
      assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...birth, phase_chain: ['plan', ...birth.phase_chain] } as never }),
        /正被其他写者写入/);
      assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0, '持锁期间仍然写入了修订');
    } finally { fs.rmSync(lockPath, { force: true }); }
    // 过期锁（无存活 pid + 超 TTL）可以被清理后继续
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() }));
    const applied = appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...birth, phase_chain: ['plan', ...birth.phase_chain] } as never });
    assert(applied.revision, '过期锁未被清理');
    assert(!fs.existsSync(lockPath), '过期锁清理后未释放');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a manifest-carried scope cannot override the unified birth resolution', run() {
  // 第二轮阻断 1：`--manifest` 自带旧范围时，必须直接拒绝，而不是保留旧值去建 run。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const s1 = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: s1 as never, trigger: { phase: 'coding' } });
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    // 统一解析给出 S1
    const resolved = resolveBirthScopeForManifest(root, { feature, requirement: '把 value 改成 42' }, workflow, frameworkRoot)!;
    assert.deepStrictEqual(resolved.phase_chain, s1.phase_chain);
    // manifest 自带 S0（旧范围）→ 与解析结果不一致，runtime 侧必须拒绝
    const carried = resolveBirthScopeForManifest(root, { feature, requirement: '把 value 改成 42', execution_scope: birth }, workflow, frameworkRoot)!;
    assert.deepStrictEqual(carried.phase_chain, s1.phase_chain, '统一解析结果被 manifest 自带范围覆盖了');
    assert.notDeepStrictEqual(executionScopeFingerprint(carried), executionScopeFingerprint(birth));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 re-registering the same transfer is idempotent', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const effective = executionScopeFingerprint(featureEffectiveScope(readFeatureFrozenScope(root, feature)!));
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r1', transferredScopeFingerprint: effective });
    const before = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    // 同 run、同指纹重复登记 = 幂等：字节不变、不报错
    const again = registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r1', transferredScopeFingerprint: effective });
    assert.equal(again!.transfers?.at(-1)?.run_id, 'r1');
    assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), before, '幂等重复登记改写了记录');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 sync-closure and reconcile-only go through the same freeze entry', run() {
  // 第三轮阻断 1：两个特殊入口在 receipt / 早退**之前**过同一个冻结入口——
  // 首次调用会冻结，候选漂移会被 execution_scope_frozen 拦住。
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const cli = (...args: string[]) => spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')), ...args, '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const out = (result: ReturnType<typeof cli>) => (result.stdout ?? '') + (result.stderr ?? '');
    // ① 首次直接 `--sync-closure`：冻结记录由这条入口落盘
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '前提：尚未冻结');
    const first = cli('--sync-closure', '--phase', 'ut');
    assert(fs.existsSync(featureFrozenScopePath(root, feature)), 'sync-closure 入口没有走冻结入口：' + out(first));
    // 候选漂移后，reconcile-only 必须在生成结果之前走同一冻结检查。
    const decl = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    decl.execution_scope.request.requested_results = ['drifted'];
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    const reconcile = cli('--report-reconcile-only', '--phase', 'testing');
    assert.equal(reconcile.status, 1, out(reconcile));
    assert(out(reconcile).includes('候选已变更而冻结范围未经修订'), out(reconcile));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 an empty or half-written write lock recovers instead of blocking forever', run() {
  // 第三轮阻断 2：`openSync(wx)` 与写 pid/at 之间崩溃会留下空锁；元数据读不出来时用 mtime 兜底。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const next = { ...birth, phase_chain: ['plan', ...birth.phase_chain] };
    const lockPath = `${featureFrozenScopePath(root, feature)}.lock`;
    // ① 新鲜空锁（刚崩溃）：仍然阻塞——可能真有 writer 在临界区里
    fs.writeFileSync(lockPath, '');
    assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next as never }), /正被其他写者写入/);
    // ② 陈旧空锁（mtime 超 TTL）：清理后重试一次即可继续
    const stale = new Date(Date.now() - 1000 * 60 * 60 * 24);
    fs.utimesSync(lockPath, stale, stale);
    const applied = appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next as never });
    assert(applied.revision, '陈旧空锁没有被清理');
    assert(!fs.existsSync(lockPath), '锁未释放');
    // ③ 半写锁（JSON 坏）同理：新鲜阻塞、陈旧可清
    fs.writeFileSync(lockPath, '{"pid": 1');
    assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...next, phase_chain: ['spec', ...next.phase_chain] } as never }), /正被其他写者写入/);
    fs.utimesSync(lockPath, stale, stale);
    const second = appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...featureEffectiveScope(readFeatureFrozenScope(root, feature)!), phase_chain: ['spec', 'plan', ...birth.phase_chain] } as never });
    assert(second.revision, '陈旧半写锁没有被清理');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a genuinely interleaved writer is blocked, never silently overwritten', run() {
  // 第三轮阻断 4：真交错——两个 writer 持**同一份旧快照**，B 在 A 的临界区**内部**尝试提交。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const snapshot = featureEffectiveScope(readFeatureFrozenScope(root, feature)!); // 两个 writer 的共同旧快照
    const a = { ...snapshot, phase_chain: ['plan', ...snapshot.phase_chain] };
    const b = { ...snapshot, phase_chain: ['spec', ...snapshot.phase_chain] };
    let inner: Error | null = null;
    __testing_setInsideRecordWriteLock(() => {
      // A 正持锁；B 此刻带着同一份旧快照进来
      try { appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: b as never, trigger: { phase: 'review' } }); }
      catch (error) { inner = error as Error; }
    });
    try {
      appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: a as never, trigger: { phase: 'coding' } });
    } finally { __testing_setInsideRecordWriteLock(null); }
    // B 必须被明确挡住（而不是覆盖 A），A 的修订完整落盘
    assert(inner, '并发 writer 没有被挡住——存在静默覆盖风险');
    assert(/正被其他写者写入/.test((inner as unknown as Error).message), (inner as unknown as Error).message);
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.revisions.length, 1, '并发写留下了不一致的修订链');
    assert.deepStrictEqual(featureEffectiveScope(record).phase_chain, a.phase_chain);
    assert(!fs.existsSync(`${featureFrozenScopePath(root, feature)}.lock`), '写锁未释放');
    // 冲突方随后重试（此时无人持锁）：串行化后两条都在，不丢更新
    const retry = appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...featureEffectiveScope(record), phase_chain: ['spec', ...a.phase_chain] } as never, trigger: { phase: 'review' } });
    assert.equal(retry.revision!.revision_index, 2);
    assert.deepStrictEqual(featureEffectiveScope(readFeatureFrozenScope(root, feature)!).phase_chain, ['spec', ...a.phase_chain]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 the real runtime refuses a manifest-carried scope that differs from the birth resolution', async run() {
  // 第三轮必修 2：A1 的拒绝分支要由**真实 runtime** 触发，不只在 resolver 层断言。
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework' + String.fromCharCode(10));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    // feature 上已经修订到 S1；manifest 却自带 S0（旧范围）
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...birth, phase_chain: ['plan', ...birth.phase_chain] } as never, trigger: { phase: 'coding' } });
    const manifestPath = path.join(root, 'stale-manifest.yaml');
    fs.writeFileSync(manifestPath, YAML.stringify({
      run_id: 'd1-stale', feature, requirement: '把 value 改成 42',
      start_phase: birth.phase_chain[0], end_phase: birth.phase_chain.at(-1), adapter: 'generic',
      execution_scope: birth,
      unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 },
    }));
    const runtime = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/scripts/goal-phase-runtime.ts')),
      '--feature', feature, '--adapter', 'generic', '--manifest', manifestPath, '--override-manifest',
      '--project-root', root, '--framework-root', frameworkRoot, '--foreground-ok'],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } }));
    const out = (runtime.stdout ?? '') + (runtime.stderr ?? '');
    assert.notEqual(runtime.status, 0, '真实 runtime 接受了与统一出生解析不一致的 manifest 范围：' + out);
    assert(out.includes('manifest 自带的出生范围与统一出生解析结果不一致'), out);
    // 拒绝发生在建 run 之前：不留 run 目录、feature 记录未被登记转交
    assert(!fs.existsSync(featureFilePath(root, feature, path.join('goal-runs', 'd1-stale'))), '拒绝前已经建了 run');
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers?.at(-1)?.run_id, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a half-written lock never blocks on a live pid alone', run() {
  // 第四轮阻断 1：`{"pid": <存活 pid>}`（缺 at）不得因为 pid 活着就被当成「有人正在写」而永久阻塞；
  // `null` 这种合法 JSON 但非对象的锁也不得让读取抛异常。规则：pid 只在元数据完整时参与判断。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const lockPath = `${featureFrozenScopePath(root, feature)}.lock`;
    const stale = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const next = (head: string) => {
      const live = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
      return { ...live, phase_chain: [head, ...live.phase_chain] };
    };
    // ① 缺 at + 存活 pid，锁文件新鲜：仍然阻塞（可能真有 writer 在临界区里）
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next('plan') as never }), /正被其他写者写入/);
    // ② 同一把锁 mtime 超 TTL：**不信 pid**（元数据不完整），按 mtime 清理后继续
    fs.utimesSync(lockPath, stale, stale);
    assert(appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next('plan') as never }).revision, '存活 pid 的半写锁过期后仍然阻塞');
    // ③ `null`：读属性会抛，必须按「元数据缺失」处理（新鲜阻塞、陈旧可清）
    fs.writeFileSync(lockPath, 'null');
    assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next('spec') as never }), /正被其他写者写入/);
    fs.utimesSync(lockPath, stale, stale);
    assert(appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: next('spec') as never }).revision, 'null 锁过期后仍然阻塞');
    assert(!fs.existsSync(lockPath), '锁未释放');
    assert.deepStrictEqual(featureEffectiveScope(readFeatureFrozenScope(root, feature)!).phase_chain, ['spec', 'plan', ...birth.phase_chain]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a revision entry with a foreign type is rejected, not silently skipped', run() {
  // 第四轮阻断 2：`loadScopeRevisions` 按 `type === 'scope_revised'` **过滤**——被改成别的 type 的
  // 条目会被静默跳过，有效范围悄悄退回上一版。记录读取必须先拒绝这种条目。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...birth, phase_chain: ['plan', ...birth.phase_chain] } as never, trigger: { phase: 'coding' } });
    const recordPath = featureFrozenScopePath(root, feature);
    const doc = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    doc.revisions[0].type = 'other';
    fs.writeFileSync(recordPath, JSON.stringify(doc));
    assert.throws(() => readFeatureFrozenScope(root, feature), /revisions\[0\] 不是合法的 scope_revised 记录/);
    // 权威说不清 → 冻结入口给 BLOCKER，不静默按出生段继续
    const blocked = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(blocked.status, 'not-applicable');
    assert(blocked.checks[0]?.details?.includes('scope_revised'), JSON.stringify(blocked.checks));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a missing transferred run refuses instead of falling back to the default chain', run() {
  // 第四轮阻断 3：记录声明已转交给某 run，而该 run 的出生范围不在——返回 undefined 会让调用方
  // （upstream gate 等）回落 workflow/track 默认链继续跑，等于换了一条与权威无关的链。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework' + String.fromCharCode(10));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'd1-gone', adapter: 'generic', requirement: '把 value 改成 42' });
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers?.at(-1)?.run_id, 'd1-gone');
    // 该 run 的目录被清理/损坏
    fs.rmSync(featureFilePath(root, feature, path.join('goal-runs', 'd1-gone')), { recursive: true, force: true });
    assert.throws(() => loadEffectiveExecutionScope(root, feature, 'd1-gone'), /出生范围缺失或损坏/);
    // 上游链解析因此**不**回落默认链，而是把失败如实带出来
    const upstream = resolveUpstreamPhaseChain(root, feature, 'd1-gone');
    assert.equal(upstream.degraded, true, JSON.stringify(upstream));
    assert(String(upstream.degradedReason).includes('出生范围缺失或损坏'), String(upstream.degradedReason));
    assert.deepStrictEqual(upstream.chain, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: '1804 independent sync-closure does not consume a foreign request-boundary proposal', run() {
  // 独立检查只闭环本阶段；既有修订输入仍需正式 Goal owner 消费和校验。
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework' + String.fromCharCode(10));
    fs.mkdirSync(path.join(root, 'src/demo/src/main'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/demo/src/main/value.ts'), 'export const value: number = 42;' + String.fromCharCode(10));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const chain = executionCompletionPhases(featureEffectiveScope(readFeatureFrozenScope(root, feature)!)).map(String);
    seedRunlessChain(root, feature, chain, 'ut');
    const reportsDir = featurePhaseReportsDir(root, feature, 'ut', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'trace.json'), JSON.stringify({ schema_version: '1.0.0', feature, phase: 'ut' }));
    // 修订提案的落盘面与生产一致：本阶段 script-report 的 `checks[].scope_revision_input`
    const candidate = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8')).execution_scope as ExecutionScopeInput;
    const reportAbs = path.join(reportsDir, 'script-report.json');
    fs.writeFileSync(reportAbs, JSON.stringify({
      checks: [{
        id: 'ut_scope_facts', category: 'structure', severity: 'MINOR', status: 'PASS', description: '修订提案',
        scope_revision_input: { ...candidate, request: { ...candidate.request, requested_results: ['boundary moved'] } },
      }],
      summary: { verdict: 'PASS', blockers: 0 },
    }, null, 2));
    const originalReport = fs.readFileSync(reportAbs);
    const frozenBytes = fs.readFileSync(featureFrozenScopePath(root, feature));
    const cli = spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')), '--sync-closure', '--phase', 'ut', '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const out = (cli.stdout ?? '') + (cli.stderr ?? '');
    assert.equal(cli.status, 0, out);
    assert(out.includes('goal-mode-entry --prepare-run'), out);
    assert(fs.readFileSync(reportAbs).equals(originalReport), 'independent closure preserves the actual stage result');
    assert(fs.readFileSync(featureFrozenScopePath(root, feature)).equals(frozenBytes), 'independent closure does not consume scope proposals');
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'independent closure must not sign Feature completion');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0);
    const previous = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    assert.throws(() => resolveScopeRevisionProposal({ projectRoot: root, frameworkRoot, feature,
      workflow: resolveWorkflowSpec(root, { frameworkRoot }), previous, authorizedPhases: previous.phase_chain,
      completedPhases: new Set(chain), currentPhase: 'ut',
      proposals: [{ ...candidate, request: { ...candidate.request, requested_results: ['boundary moved'] } }],
    }), /revision changes request boundary/, 'the shared owner-side validator still rejects the unauthorized proposal');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a superseding successor is born from the source run, not blocked by the transfer', run() {
  // 第五轮阻断 1：feature 记录已把范围转交给源 run 之后，`--supersede` 仍须能开后继——
  // 转交记录在 supersede 上下文只作血缘核对（= 源 run），不抛「已转交」。
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework' + String.fromCharCode(10));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'd1-src', adapter: 'generic', requirement: '把 value 改成 42' });
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers?.at(-1)?.run_id, 'd1-src');
    const sourceBirth = loadFrozenExecutionScope(root, feature, 'd1-src')!;
    const cli = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/scripts/goal-phase-runtime.ts')),
      '--feature', feature, '--adapter', 'generic', '--supersede', 'd1-src', '--run-id', 'd1-succ',
      '--requirement', '把 value 改成 42', '--project-root', root, '--framework-root', frameworkRoot, '--foreground-ok', '--force'],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } }));
    const out = (cli.stdout ?? '') + (cli.stderr ?? '');
    assert(!out.includes('范围已转交给'), '既有 supersede 路径被 feature 转交记录拦住：' + out);
    assert(!out.includes('不能再转交给'), 'successor 又登记了一次 feature 转交：' + out);
    const succManifestPath = featureFilePath(root, feature, path.join('goal-runs', 'd1-succ', 'manifest.json'));
    assert(fs.existsSync(succManifestPath), '后继 run 没有建起来：' + out);
    const succ = JSON.parse(fs.readFileSync(succManifestPath, 'utf8')) as { successor_of?: string; execution_scope?: unknown };
    assert.equal(succ.successor_of, 'd1-src');
    // The runless freeze had no requirement text; successor can now derive fidelity from the real request.
    // That changes the explanatory reason, not the duties or the executable chain.
    const successorScope = validateExecutionScope(succ.execution_scope);
    assert.deepStrictEqual(successorScope.phase_chain, sourceBirth.phase_chain);
    assert.deepStrictEqual(successorScope.obligations.map(o => [o.id, o.kind, o.owner_phase, o.applicability]),
      sourceBirth.obligations.map(o => [o.id, o.kind, o.owner_phase, o.applicability]));
    // 转交记录追加式：旧转交保留，最新一条指向后继
    assert.deepStrictEqual(readFeatureFrozenScope(root, feature)!.transfers?.map(item => item.run_id), ['d1-src', 'd1-succ'], out);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'b2d7 t3 legacy single-value transferred_to reads as the only transfer and keeps its semantics', run() {
  // 读兼容：3.1.0 写的单值 `transferred_to` / `transferred_scope_fingerprint` = transfers 的唯一一条，语义不变。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const effective = executionScopeFingerprint(featureEffectiveScope(readFeatureFrozenScope(root, feature)!));
    const file = featureFrozenScopePath(root, feature);
    const legacy = { ...JSON.parse(fs.readFileSync(file, 'utf8')), transferred_to: 'r1', transferred_scope_fingerprint: effective };
    fs.writeFileSync(file, JSON.stringify(legacy, null, 2) + '\n');
    const bytes = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(readFeatureFrozenScope(root, feature)!.transfers, [{ run_id: 'r1', scope_fingerprint: effective }]);
    assert.throws(() => loadEffectiveExecutionScope(root, feature), /已转交给 run r1/);
    assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: featureEffectiveScope(readFeatureFrozenScope(root, feature)!) as never }), /已转交给 run r1/);
    registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r1', transferredScopeFingerprint: effective });
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, '同 run 幂等登记不得改写旧记录');
    assert.throws(() => registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r2', transferredScopeFingerprint: effective }), /已转交给 run r1，不能再转交给 r2/);
    fs.writeFileSync(file, JSON.stringify({ ...legacy, transfers: [{ run_id: 'r1', scope_fingerprint: effective }] }));
    assert.throws(() => readFeatureFrozenScope(root, feature), /形状冲突/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'b2d7 t3 #15 runless completion: --supersede is refused toward revision; a revision then a fresh run is born from it', run() {
  // feature 载体（record.run_id=null）没有 run 可 supersede：不存在的 run 被拒绝并指向「先追加修订再起新 run」；
  // 修订后新 run 出生读修订后的有效范围（既有 appendFeatureScopeRevision + resolveBirthExecutionScope，无生产改动）。
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    fs.mkdirSync(path.join(root, 'src/demo/src/main'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/demo/src/main/value.ts'), 'export const value: number = 42;\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const chain = executionCompletionPhases(featureEffectiveScope(readFeatureFrozenScope(root, feature)!)).map(String);
    seedRunlessChain(root, feature, chain, 'ut');
    const reportsDir = featurePhaseReportsDir(root, feature, 'ut', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'trace.json'), JSON.stringify({ schema_version: '1.0.0', feature, phase: 'ut' }));
    const env = { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' };
    finalizePhaseClosure({ projectRoot: root, frameworkRoot, feature, phase: 'ut', persistPhaseState: () => {} });
    legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: 'ut', workflowTrack: 'full' });
    const projection = JSON.parse(fs.readFileSync(featureFilePath(root, feature, 'feature-completion.json'), 'utf8')) as { original_path: string };
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, projection.original_path), 'utf8')).run_id, null, '前提：feature 载体完成');
    const recordBytes = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    const target = '20260101T000000Z-9h0st9';
    const cli = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/scripts/goal-phase-runtime.ts')),
      '--feature', feature, '--adapter', 'generic', '--supersede', target, '--requirement', '把 value 改成 42',
      '--project-root', root, '--framework-root', frameworkRoot, '--foreground-ok', '--force'],
      { cwd: root, encoding: 'utf8', timeout: 180000, env }));
    const out = (cli.stdout ?? '') + (cli.stderr ?? '');
    assert.notEqual(cli.status, 0, `--supersede ${JSON.stringify(target)} 未被拒绝：${out}`);
    assert(out.includes('追加 feature 范围修订'), `拒绝未指向修订：${out}`);
    const runsDir = featureFilePath(root, feature, 'goal-runs');
    assert(!fs.existsSync(runsDir) || !fs.readdirSync(runsDir).some(id => fs.existsSync(path.join(runsDir, id, 'manifest.json'))), '拒绝后仍建了 run');
    assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), recordBytes);
    // 完成后修正：按当前输入追加一条修订（这里把 plan 加回链上）→ 新 run 出生读修订后的有效范围
    const effective = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...effective, phase_chain: ['plan', ...effective.phase_chain] } as never, trigger: { phase: 'plan' } });
    const revised = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'b2d7-fresh', adapter: 'generic', requirement: '把 value 改成 42' });
    assert.equal(executionScopeFingerprint(validateExecutionScope(prepared.manifest.execution_scope)), executionScopeFingerprint(revised));
    assert.deepStrictEqual(readFeatureFrozenScope(root, feature)!.transfers?.map(item => item.run_id), ['b2d7-fresh']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 the CU handoff for a new run uses the revised feature scope', run() {
  // 第五轮阻断 2：`buildChangeUnitGoalHandoff` 经 `resolveChangeUnitExpectedExecution(..., true)`
  // 取新 run 的期望链；原来那条分支直接从候选算，feature 已 S0→S1 时交接 S0、出生用 S1。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    assert.deepStrictEqual(resolveChangeUnitExpectedExecution(root, feature, true).expectedChain, [...birth.phase_chain]);
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...birth, phase_chain: ['plan', ...birth.phase_chain] } as never, trigger: { phase: 'coding' } });
    assert.deepStrictEqual(resolveChangeUnitExpectedExecution(root, feature, true).expectedChain, ['plan', ...birth.phase_chain]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 reclaiming a stale write lock never deletes another writer new lock', run() {
  // 第五轮阻断 3：两个 writer 同时判「锁已过期」时，直接 rmSync 会删掉对方刚建的新锁，
  // 两者一起进临界区。抢占改成 rename + 身份核对：锁在抢占期间被重建即报错、并把它还回去。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const lockPath = `${featureFrozenScopePath(root, feature)}.lock`;
    const stale = new Date(Date.now() - 1000 * 60 * 60 * 24);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: stale.toISOString() }));
    fs.utimesSync(lockPath, stale, stale);
    // 判过期之后、抢占之前：另一个 writer 已经清理完并**正持有**自己的新锁
    const otherHolder = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
    __testing_setBeforeStaleLockReclaim(() => {
      fs.rmSync(lockPath, { force: true });
      fs.writeFileSync(lockPath, otherHolder);
    });
    try {
      assert.throws(() => appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: { ...birth, phase_chain: ['plan', ...birth.phase_chain] } as never }), /正被其他写者写入/);
    } finally { __testing_setBeforeStaleLockReclaim(null); }
    // 对方的锁**还在**（没被抢占者删掉），记录也没被改
    assert.equal(fs.readFileSync(lockPath, 'utf8'), otherHolder, '抢占过期锁时删掉了另一个 writer 的新锁');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0);
    fs.rmSync(lockPath, { force: true });
    assert(!fs.readdirSync(path.dirname(lockPath)).some(name => name.includes('.stale.')), '抢占用的临时名残留');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a structurally broken feature lock is unknown authority, not a stale one', run() {
  // 第五轮阻断 4：`readLockRecord` 只 JSON.parse——`{}` / `[]` 会被当成 LockRecord，
  // 随后 `isLockStale` 因 updated_at 缺失算出 NaN 判 stale，等于把结构损坏的锁静默放行。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const lockPath = featureFilePath(root, feature, path.join('goal-runs', '.feature.lock'));
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const brokenShapes = [
      '{}', '[]', '{"pid": 1}',
      // 第六轮：**值**非法（而不只是类型缺失）也必须是未知权威——下面三条原本都会被
      // `isLockStale` 判成 stale 放行：时间不可解析 / pid 非正整数 / hostname 空串。
      JSON.stringify({ pid: 1, hostname: os.hostname(), updated_at: 'invalid' }),
      JSON.stringify({ pid: 0, hostname: os.hostname(), updated_at: new Date().toISOString() }),
      JSON.stringify({ pid: -1, hostname: os.hostname(), updated_at: new Date().toISOString() }),
      JSON.stringify({ pid: 1.5, hostname: os.hostname(), updated_at: new Date().toISOString() }),
      JSON.stringify({ pid: 1, hostname: '   ', updated_at: new Date().toISOString() }),
    ];
    for (const broken of brokenShapes) {
      fs.writeFileSync(lockPath, broken);
      const detected = detectLiveFeatureLock(root, feature);
      assert(detected?.unreadable, `结构损坏的锁被放行：${broken} → ${JSON.stringify(detected)}`);
      const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      assert.equal(frozen.status, 'not-applicable', broken);
      assert(frozen.checks[0]?.details?.includes('无法解析'), JSON.stringify(frozen.checks));
      assert(!fs.existsSync(featureFrozenScopePath(root, feature)), `结构损坏的锁下仍然冻结了：${broken}`);
    }
    // 结构完整且未过期 → 仍按「有活着的持柄者」报错（不是 unreadable）
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, hostname: os.hostname(), started_at: new Date().toISOString(), updated_at: new Date().toISOString(), run_id: 'live-run' }));
    const live = detectLiveFeatureLock(root, feature);
    assert.equal(live?.unreadable, false);
    assert.equal(live?.record?.run_id, 'live-run');
    // 第七轮：**结构完整的过期锁**必须照旧进 stale 分支——否则这次收紧就是把所有锁一律判未知。
    // 两条既有 stale 判据各一例：同机死 pid（与 updated_at 无关）、跨机 TTL 超时。
    const staleAt = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    for (const staleRecord of [
      { pid: 999999, hostname: os.hostname(), started_at: staleAt, updated_at: new Date().toISOString(), run_id: 'dead-run' },
      { pid: process.pid, hostname: 'another-host', started_at: staleAt, updated_at: staleAt, run_id: 'far-run' },
    ]) {
      fs.writeFileSync(lockPath, JSON.stringify(staleRecord));
      // 「没有活着的持柄者」= 返回 null，既不是 unreadable 也不是 live
      assert.strictEqual(detectLiveFeatureLock(root, feature), null, JSON.stringify(staleRecord));
      // 冻结入口因此照常放行（陈旧锁不挡活）
      fs.rmSync(featureFrozenScopePath(root, feature), { force: true });
      const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
      // 并且经**既有**锁获取路径能把旧锁回收（不是只在读侧当它不存在）
      const acquired = tryAcquireLock(lockPath, { run_id: 'reclaimed' });
      assert(acquired, '既有 tryAcquireLock 没能回收陈旧锁：' + JSON.stringify(staleRecord));
      assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).run_id, 'reclaimed');
      releaseLock(lockPath, acquired!.ownerId);
      assert(!fs.existsSync(lockPath), '锁未释放');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a phase that only left a script-report still blocks the first freeze', run() {
  // 第五轮阻断 5：`script-report.json` 由 harness 在 summary / evidence **之前**写，进程崩在
  // 那之后时只剩它在场。漏查它就会把已经跑过的阶段静默归入一份新冻结记录。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const reportsDir = featurePhaseReportsDir(root, feature, 'coding', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({ checks: [], summary: { verdict: 'FAIL' } }));
    const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(frozen.status, 'not-applicable');
    assert(frozen.checks[0]?.details?.includes('coding'), JSON.stringify(frozen.checks));
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '已有阶段产物时仍然首次冻结了');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a runless repair reopens its owner and cannot use old downstream PASS as proof', run() {
  // 第五轮必修 1：无 run 时 `scopeRevisionInputFromRepairCandidates` 直接返回 null，D0.3 的
  // 修订触发在交互路径上整条失效。第五轮建议 2：收尾把**已闭环阶段**接进提案校验，
  // 合法修订不得把它们重新变回未满足义务。
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['plan', 'coding', 'review', 'ut'] });
  try {
    const configFile = path.join(root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.project_profile = { name: 'hmos-app' };
    fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const scope = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const chain = executionCompletionPhases(scope).map(String);
    // 修订必须带**新的有来源事实**：冻结之后 coding 真的改了产品文件，绑定指纹因此与出生段不同。
    // 顺序是先改文件、再落阶段证据——否则证据会因为文件在它之后被改而 stale。
    fs.writeFileSync(path.join(root, 'src/demo/value.ts'), 'export const value: number = 42;' + String.fromCharCode(10));
    seedRunlessChain(root, feature, chain);
    const mislocated = {
      id: 'CR-PLAN-001', category: 'plan' as const, files: ['src/demo/value.ts'],
      summary: 'coding 发现 plan 未覆盖的设计决策', item_fingerprint: 'f'.repeat(64), source_phase: 'coding',
    };
    const wrongTarget = scopeRevisionInputFromRepairCandidates([mislocated], { projectRoot: root, frameworkRoot, feature });
    assert(!wrongTarget?.input.facts.some(fact => fact.id === 'design-decision:CR-PLAN-001'), '产品诊断落点不能凭category=plan取得设计修订职责');
    const candidate = { ...mislocated, files: [path.relative(root, featureFilePath(root, feature, 'contracts.yaml')).replace(/\\/g, '/')] };
    // 生产函数：无 run 身份也要产出提案（统一入口自己读 feature 冻结记录）
    const proposal = scopeRevisionInputFromRepairCandidates([candidate], { projectRoot: root, frameworkRoot, feature });
    assert(proposal, '无 run 时没有产出修订提案');
    assert(proposal!.input.facts.some(fact => fact.id === 'design-decision:CR-PLAN-001'), JSON.stringify(proposal!.input.facts.map(f => f.id)));
    // 提案经生产落盘面（本阶段 script-report 的 checks[].scope_revision_input）交给收尾
    const reportsDir = featurePhaseReportsDir(root, feature, 'coding', frameworkRoot);
    fs.writeFileSync(path.join(reportsDir, 'script-report.json'), JSON.stringify({
      checks: [{ id: 'coding_scope_facts', status: 'PASS', severity: 'MINOR', category: 'structure', description: '修订提案', scope_revision_input: proposal!.input }],
      summary: { verdict: 'PASS', blockers: 0 },
    }));
    const retired = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'coding', workflowTrack: 'full' });
    assert.equal(retired.revisionApplied, false);
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0);
    // Reconstruct the historical revision to exercise the existing owner/evidence readers.
    const historical = resolveScopeRevisionProposal({ projectRoot: root, frameworkRoot, feature, workflow: resolveWorkflowSpec(root, { frameworkRoot }),
      proposals: [proposal!.input], previous: scope, authorizedPhases: scope.phase_chain, completedPhases: new Set(chain), currentPhase: 'coding' });
    assert(historical);
    appendFeatureScopeRevision({ projectRoot: root, feature, nextScope: historical!.scope, trigger: { phase: 'coding' }, revisionInput: historical!.input });
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.revisions.length, 1);
    // 建议 2：已闭环阶段的既有义务带着满足证明进了修订（不会被重新要求再跑一遍）
    const revised = featureEffectiveScope(record);
    assert(revised.phase_chain.includes('plan') && revised.phase_chain.includes('coding'), 'new plan work must reopen its owner and downstream');
    assert(!revised.obligations.find(ob => ob.id === 'design-decision:CR-PLAN-001')!.satisfied_by, 'old plan PASS cannot prove the new repair');
    assert(!revised.phase_chain.includes('spec'), 'unchanged definition remains usable');
    assert(revised.obligations.filter(ob => ['plan', 'coding', 'review', 'ut'].includes(ob.owner_phase) && ob.applicability === 'required')
      .every(ob => !ob.satisfied_by?.some(ref => 'evidence_manifest_aggregate' in ref)), 'no old downstream PASS may prematurely close repair');
    seedRunlessChain(root, feature, revised.phase_chain, undefined, () => new Date());
    const closed = legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: 'ut', workflowTrack: 'full' });
    assert(closed.completionPath, 'later runless proof must close the actual repair: ' + JSON.stringify(closed));
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 1, 'a normal PASS does not write a new scope event');
    assert.equal(completionOf({ projectRoot: root, feature, expectedChain: executionCompletionPhases(revised), expectedTrack: 'full', frameworkRoot }).verdict, 'VALID');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'P1-T8 runless requirements retain original file binding and reject missing or stale input', run() {
  const repo = path.resolve(__dirname, '../../..');
  type Project = ReturnType<typeof setupRunlessProject>;
  type SourceInput = NonNullable<Parameters<typeof resolveFeaturePhaseCapabilityInput>[2]>;
  const prepare = ({ root, frameworkRoot, feature }: Project, source: SourceInput) => {
    const resolved = resolveRequirementInput({ projectRoot: root, ...source });
    assert(resolved.text);
    prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'request',
      requestedPhases: ['spec'], requestedResults: ['verify requirement'], requirement: resolved.text,
      requirementSourceFiles: resolved.sources, overwrite: true });
  };
  const resolve = ({ root, frameworkRoot, feature }: Project, source?: SourceInput) => resolveFeaturePhaseCapabilityInput({
    projectRoot: root, frameworkRoot, feature, phase: 'spec', featuresDir: relFeaturesDir(root),
  }, resolveWorkflowSpec(root, { frameworkRoot }), source);

  const file = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
  try {
    const requirementFile = 'requirements/request.md';
    const original = path.join(file.root, requirementFile);
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, '原始文件需求：验证 value。\n');
    prepare(file, { requirementFile });
    const binding = featureRequirementBinding(file.root, file.feature);
    assert.equal(binding.dependencies.length, 1, JSON.stringify(binding));
    assert(binding.source_refs.includes(requirementFile), JSON.stringify(binding));
    const check = spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/harness-runner.ts')),
      '--phase', 'spec', '--feature', file.feature, '--project-root', file.root, '--framework-root', file.frameworkRoot],
      { cwd: file.root, encoding: 'utf8', env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    assert.equal(check.error, undefined);
    assert.notEqual(check.status, null);
    const summaryPath = path.join(featurePhaseReportsDir(file.root, file.feature, 'spec'), 'summary.json');
    assert(fs.existsSync(summaryPath), check.stderr + check.stdout);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { capability_resolutions: Array<{ id: string; state: string }> };
    assert.equal(summary.capability_resolutions.find(row => row.id === 'capability_spec_requirement')?.state, 'resolved');
    fs.writeFileSync(original, '被换掉的需求\n');
    assert.throws(() => resolve(file), /input binding stale/);
  } finally { fs.rmSync(file.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }

  const inline = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
  try {
    const requirement = '原始 inline 需求：验证 value';
    prepare(inline, { requirement });
    assert.equal(featureRequirementBinding(inline.root, inline.feature).dependencies.length, 0);
    assert.throws(() => resolve(inline), /请用 --requirement 或 --requirement-file/);
    const requirementFile = 'requirements/legacy-inline.md';
    const original = path.join(inline.root, requirementFile);
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, requirement);
    assert.equal(resolve(inline, { requirementFile }).requirement, requirement);
    assert.throws(() => resolve(inline, { requirement: '另一句需求' }), /input binding stale/);
  } finally { fs.rmSync(inline.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }

  const external = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runless-external-requirement-'));
  try {
    const requirementFile = path.join(externalRoot, 'request.md');
    const requirement = '项目外原始需求：验证 value。';
    fs.writeFileSync(requirementFile, requirement + '\n');
    prepare(external, { requirementFile });
    assert.equal(featureRequirementBinding(external.root, external.feature).dependencies.length, 0, '项目外来源不得进入项目内冻结 dependency');
    assert.throws(() => resolve(external), /请用 --requirement 或 --requirement-file/);
    assert.equal(resolve(external, { requirementFile }).requirement, requirement);
    fs.writeFileSync(requirementFile, '项目外另一句需求\n');
    assert.throws(() => resolve(external, { requirementFile }), /input binding stale/);
  } finally {
    fs.rmSync(externalRoot, { recursive: true, force: true });
    fs.rmSync(external.root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
} });

cases.push({ name: '9e46 standalone Spec restores its signed file requirement and rejects subsequent source drift', async run() {
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
  const stage = { projectRoot: root, frameworkRoot, feature, phase: 'spec' };
  const runner = path.resolve(__dirname, '../../harness-runner.ts');
  const tsNodeProject = path.resolve(__dirname, '../../tsconfig.json');
  const requirementFile = 'requirements/request.md';
  const requirement = '原始文件需求：验证 value。';
  try {
    fs.mkdirSync(path.join(root, 'requirements'));
    fs.writeFileSync(path.join(root, requirementFile), requirement + '\n');
    prepareFeatureScopeCandidate({ ...stage, completionTarget: 'request', requestedResults: ['verify value'],
      requestedPhases: ['spec'], requirement, requirementSourceFiles: [requirementFile], overwrite: true,
      impact: { userVisibleBehaviorChange: false, reason: '仅验证内部取值', basisPaths: ['src/demo/value.ts'] } });
    const frozen = ensureFeatureExecutionScopeFrozen(stage);
    assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
    const facts = featureFilePath(root, feature, 'context/facts.md');
    fs.mkdirSync(path.dirname(facts), { recursive: true });
    fs.writeFileSync(facts, '---\n' + YAML.stringify({ schema_version: '1.1', feature, established_by: 'spec',
      frozen_scope_fingerprint: executionScopeFingerprint(featureEffectiveScope(frozen.record!)),
      source_code_paths: ['src/demo/value.ts'], ready_to_produce: true }) + '---\n# Original request facts\n');
    const workflow = resolveWorkflowSpec(root, { frameworkRoot });
    const signer = resolveFeaturePhaseCapabilityInput({ ...stage, featuresDir: relFeaturesDir(root) }, workflow, { requirementFile });
    const resolution = resolveCapabilityInputs({ ...stage, track: 'full', ...signer });
    const { inputs: resolvedInputs } = resolution;
    assert(!signer.factsRebuildReason && signer.factsContext?.source_paths.includes('src/demo/value.ts'), JSON.stringify(signer.factsRebuildReason));
    assert.equal(resolvedInputs?.values.requirement?.state, 'resolved');
    const { prepareFixtureVerifierMaterial } = await import('../utils/verifier-evidence-fixture');
    const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'spec', feature, root, [
      { id: 'spec_file_exists', category: 'structure', description: 'Spec material checked', status: 'PASS', severity: 'BLOCKER', details: 'current spec read' },
    ], frameworkRoot);
    report.assurance = 'full';
    report.capability_resolutions = resolution.report.capabilities;
    const reports = featurePhaseReportsDir(root, feature, 'spec', frameworkRoot);
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, 'script-report.json'), JSON.stringify(report));
    const options = prepareFixtureVerifierMaterial({ ...stage, report, options: {
      verifierPlan: { mode: 'enabled', reason: 'policy_required', message: 'required', verifier_prompt: 'prompts/verify-spec.md' },
      resolvedInputs, factsContext: signer.factsContext,
    } });
    const summary = writeRunSummaryBase(root, report, frameworkRoot, options);
    assert(summary.verifier_request && summary.verifier_subject_id && summary.next_action === 'run_verifier_then_receipt', JSON.stringify(summary));
    const { currentRequirementEvidenceSha } = await import('../../scripts/utils/phase-closure-finalizer');
    const requirementSha = currentRequirementEvidenceSha({ ...stage, resolvedInputs });
    writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ ...stage, resolvedInputs, factsContext: signer.factsContext, requirementSha }));
    const afterOwnManifest = resolveFeaturePhaseCapabilityInput({ ...stage, featuresDir: relFeaturesDir(root) }, workflow);
    assert(!afterOwnManifest.factsRebuildReason && afterOwnManifest.factsContext?.source_paths.includes('src/demo/value.ts'),
      'the signed request facts still resolve after publication: ' + JSON.stringify(afterOwnManifest.factsRebuildReason));
    const invoke = () => spawnSync(process.execPath, [...testCliArgs(runner),
      '--execute-verifier', '--phase', 'spec', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot], {
        cwd: root, timeout: 120000, encoding: 'utf8', windowsHide: true, env: {
          ...process.env, TS_NODE_PROJECT: tsNodeProject, MAISON_GOAL_RUN_ID: '', MAISON_GOAL_ATTEMPT: '',
        },
      });
    const implicit = resolveFeaturePhaseCapabilityInput({ ...stage, featuresDir: relFeaturesDir(root), purpose: 'bound-verifier' }, workflow);
    assert.equal(implicit.requirement, requirement);
    fs.writeFileSync(path.join(root, requirementFile), '变更后的需求正文。\n');
    const changed = invoke();
    assert.notEqual(changed.status, 0);
    assert(/input binding stale|已签材料已变化/.test(changed.stdout + changed.stderr), changed.stdout + changed.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(reports, 'summary.json'), 'utf8')).verifier_subject_id, summary.verifier_subject_id);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: '1804 real independent spec updates acceptance but leaves scope revision to its Goal owner', run() {
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'feature' });
  const runSpec = () => spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/harness-runner.ts'), [require.resolve('ts-node/dist/bin.js')]),
    '--phase', 'spec', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot,
    '--requirement', '把 value 改成 42'], { cwd: root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
  try {
    const acceptancePath = featureFilePath(root, feature, 'acceptance.yaml');
    const initialAcceptance = YAML.parse(fs.readFileSync(acceptancePath, 'utf8')); initialAcceptance.criteria[0].expected_result = '1';
    fs.writeFileSync(acceptancePath, 'criteria: [\n');
    const candidate = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature', requestedResults: ['value is 42'], requestedPhases: ['spec'], requirement: '把 value 改成 42', overwrite: true,
      impact: { userVisibleBehaviorChange: false, reason: 'unit-only correction', basisPaths: ['src/demo/value.ts'] } });
    assert(candidate.scope.phase_chain.includes('spec'), JSON.stringify(candidate.scope.phase_chain));
    fs.writeFileSync(acceptancePath, YAML.stringify(initialAcceptance));
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '前提：首次 harness 尚未冻结');
    const frozen = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
    const record = readFeatureFrozenScope(root, feature)!;
    const fingerprint = executionScopeFingerprint(featureEffectiveScope(record));
    const facts = featureFilePath(root, feature, path.join('context', 'facts.md')); fs.mkdirSync(path.dirname(facts), { recursive: true });
    fs.writeFileSync(facts, '---\n' + YAML.stringify({ schema_version: '1.1', feature, frozen_scope_fingerprint: fingerprint, established_by: 'spec', ready_to_produce: true,
      has_blocker_coverage_risk: false, source_code_paths: ['src/demo/value.ts', 'framework.config.json'], key_inputs_read: ['src/demo/value.ts', 'framework.config.json'], files_inspected_count: 5,
      searches_performed_estimate: 4, decisions_unlocked: ['correct acceptance'], exploration_mode: 'sequential' }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/demo/value.ts | value exists | acceptance correction |\n| framework.config.json | profile configured | preserve project context |\n\n## phase_delta: spec\nacceptance corrected\n');
    const acceptance = YAML.parse(fs.readFileSync(acceptancePath, 'utf8')); acceptance.criteria[0].expected_result = '42';
    fs.writeFileSync(acceptancePath, YAML.stringify(acceptance));
    const corrected = runSpec();
    assert.equal(corrected.status, 1, corrected.stderr + corrected.stdout);
    const reports = featurePhaseReportsDir(root, feature, 'spec', frameworkRoot);
    const scriptReport = JSON.parse(fs.readFileSync(path.join(reports, 'script-report.json'), 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(reports, 'summary.json'), 'utf8'));
    assert.equal(scriptReport.summary.verdict, 'PASS');
    assert.equal(summary.verdict, 'PASS');
    assert.equal(summary.next_action, 'run_verifier_then_receipt');
    assert.equal(summary.closure_status, 'open');
    const current = completedCheckResultsFromOutput(corrected.stdout).find(row => row.phase === 'spec');
    assert(current && !current.evaluation.completed && !current.evaluation.disposition.completionEligible);
    assert(current.evaluation.disposition.completionBlocking.some(problem => problem.phase === 'spec'
      && problem.id === 'attestation_present' && problem.action === 'verify' && problem.owner === 'spec'));
    const receipt = writeReceiptProjection(root, feature, 'spec');
    assert(receipt.wrote, receipt.failure);
    assert.throws(() => finalizePhaseClosure({ projectRoot: root, frameworkRoot, feature, phase: 'spec',
      persistPhaseState: () => assert.fail('pending verification cannot publish phase state') }), /attestation_present/);
    const after = readFeatureFrozenScope(root, feature)!;
    assert.equal(after.revisions.length, 0, 'independent checks do not advance a full-delivery scope');
    assert.equal(executionScopeFingerprint(featureEffectiveScope(after)), fingerprint, 'the existing scope remains available for formal transfer');
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'c6a3d918 unknown real design obligation holds its downstream until owner supplies it', run() {
  const wf: WorkflowSpec = { ...workflow, artifacts: workflow.artifacts.map(a => ({ ...a,
    requires: a.id === 'review' || a.id === 'ut' ? ['coding'] : a.id === 'testing' ? ['review', 'ut'] : [] })) };
  const input = request(['coding', 'review', 'ut', 'testing'], 'feature');
  input.request.impact = sourced(true, 'actual UI changes require downstream verification');
  input.facts.push({ id: 'implementation:design-gap', kind: 'implementation', applicability: 'unknown', reason: '设计尚未提供可消费的保存与失败恢复分支', basis: [] });
  const result = resolveExecutionScope(input, wf, d2Acceptance('both'), d2Facts());
  assert(!result.phase_chain.includes('coding') && !result.phase_chain.includes('review') && !result.phase_chain.includes('ut') && !result.phase_chain.includes('testing'), JSON.stringify(result));
  assert(result.unresolved.some(gap => gap.needed_by.includes('testing')), '不得只删除 owner 而让 testing 继续');
  input.facts[0].applicability = 'required'; input.facts[0].reason = '责任方已提供真实保存与失败恢复实现依据';
  const repaired = resolveExecutionScope(input, wf, d2Acceptance('both'), d2Facts());
  assert.deepStrictEqual(repaired.phase_chain, ['coding', 'review', 'ut', 'testing']);
  assert.equal(repaired.requested_results.join(), result.requested_results.join());
} });

// These pure rows model an already accepted definition input, not a product PASS.
// File freshness and actual reader admission are covered by the real-file caller tests.
function definitionHistoryFixture(acceptedAtBirth = true) {
  const ref: InputBinding = { input_id: 'contracts', source: { kind: 'artifact', artifact: 'contracts@1' }, dependencies: [],
    source_refs: ['contracts.yaml'], content_fingerprint: 'a'.repeat(64) };
  const input = request(['plan']);
  input.facts.push({ id: 'design:causal', kind: 'design-context', applicability: 'required', reason: 'registered definition input',
    basis: [ref], ...(acceptedAtBirth ? { satisfied_by: [ref] } : {}) });
  const birth = resolveExecutionScope(input, workflow);
  const order = workflow.artifacts.map(artifact => artifact.id);
  const acceptedInput = structuredClone(input);
  acceptedInput.facts.find(obligation => obligation.id === 'design:causal')!.satisfied_by = [ref];
  const accepted = resolveExecutionScope(acceptedInput, workflow);
  const cached = structuredClone(accepted);
  cached.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by = [
    { phase: 'plan', run_id: 'prior-tool-result', evidence_manifest_aggregate: 'b'.repeat(64) },
  ];
  const missingInput = structuredClone(acceptedInput);
  delete missingInput.facts.find(obligation => obligation.id === 'design:causal')!.satisfied_by;
  const missingCache = resolveExecutionScope(missingInput, workflow);
  const validated = new Map([['design:causal', [ref]]]);
  return { birth, accepted, cached, missingCache, ref, order, validated };
}

cases.push({ name: 'formal definition proof causal: a phase report never replaces the accepted InputRef', run() {
  const fixture = definitionHistoryFixture();
  const original = executionScopeFingerprint(fixture.birth);
  const view = effectiveScopeView({ birth: fixture.birth, events: [], workflow,
    proofs: new Map([['plan', { phase: 'plan', evidence_manifest_aggregate: 'c'.repeat(64) }]]) });
  assert.deepStrictEqual(view.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by, [fixture.ref]);
  assert.deepStrictEqual(view.phase_chain, [], 'the definition remains met by its original input, independently of a phase cache');
  assert.equal(executionScopeFingerprint(fixture.birth), original, 'the read must not rewrite its historical birth');
} });

for (const acceptedAtBirth of [true, false]) cases.push({
  name: `formal definition proof causal: accepted ${acceptedAtBirth ? 'birth' : 'revision'} input survives replaced and missing phase cache`, run() {
    const fixture = definitionHistoryFixture(acceptedAtBirth);
    const events: ScopeHistoryEvent[] = [
      ...acceptedAtBirth ? [] : [{ type: 'scope_revised', execution_scope: fixture.accepted }],
      { type: 'scope_revised', execution_scope: fixture.cached },
      { type: 'scope_revised', execution_scope: fixture.missingCache },
    ];
    const originals = JSON.stringify({ birth: fixture.birth, events });
    const history = scopeProofHistory(fixture.birth, events, fixture.order, undefined, workflow);
    assert.deepStrictEqual(history.definitionProofs.get('design:causal'), [fixture.ref]);
    const view = effectiveScopeView({ birth: fixture.birth, events, workflow, definitionProofs: fixture.validated, stalePhases: ['plan'] });
    assert.deepStrictEqual(view.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by, [fixture.ref]);
    assert.deepStrictEqual(view.phase_chain, [], 'unrelated stale phase context must not discard a revalidated original definition input');
    assert.equal(JSON.stringify({ birth: fixture.birth, events }), originals, 'causal folding leaves all original records intact');
  },
});

for (const event of [
  { type: 'phase_invalidated', phase: 'plan' },
  { type: 'phase_backtrack_requested', phase: 'ut', to_phase: 'plan', invalidated_phases: ['plan'] },
] satisfies ScopeHistoryEvent[]) cases.push({ name: `formal definition proof causal: ${event.type} revokes the old input despite a supplied map`, run() {
  const fixture = definitionHistoryFixture();
  const history = scopeProofHistory(fixture.birth, [event], fixture.order, undefined, workflow);
  assert(!history.definitionProofs.has('design:causal'));
  const view = effectiveScopeView({ birth: fixture.birth, events: [event], workflow, definitionProofs: fixture.validated });
  assert(!view.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by?.length);
  assert(view.phase_chain.includes('plan'), 'an explicit causal revocation requires the original owner again');
} });

cases.push({ name: 'formal definition proof causal: direct InputRef withdrawal cannot be covered by a supplied map', run() {
  const fixture = definitionHistoryFixture();
  const events: ScopeHistoryEvent[] = [{ type: 'scope_revised', execution_scope: fixture.missingCache }];
  assert(!scopeProofHistory(fixture.birth, events, fixture.order, undefined, workflow).definitionProofs.has('design:causal'));
  const view = effectiveScopeView({ birth: fixture.birth, events, workflow, definitionProofs: fixture.validated });
  assert(!view.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by?.length);
  assert(view.phase_chain.includes('plan'), 'cache loss after a phase replacement differs from an explicit InputRef withdrawal');
} });

cases.push({ name: 'formal definition proof causal: a changed basis fingerprint rejects the historical input', run() {
  const fixture = definitionHistoryFixture();
  const changed = structuredClone(fixture.cached);
  changed.obligations.find(obligation => obligation.id === 'design:causal')!.basis[0].content_fingerprint = 'd'.repeat(64);
  const events: ScopeHistoryEvent[] = [{ type: 'scope_revised', execution_scope: changed }];
  assert(!scopeProofHistory(fixture.birth, events, fixture.order, undefined, workflow).definitionProofs.has('design:causal'));
  const view = effectiveScopeView({ birth: fixture.birth, events, workflow, definitionProofs: fixture.validated, stalePhases: ['plan'] });
  assert(!view.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by?.length);
  assert(view.phase_chain.includes('plan'), 'the old semantic binding cannot satisfy a changed definition');
} });

cases.push({ name: 'formal definition proof causal: caller maps cannot mint or substitute a definition input', run() {
  const unregistered = definitionHistoryFixture(false);
  const view = effectiveScopeView({ birth: unregistered.birth, events: [], workflow, definitionProofs: unregistered.validated });
  assert(!view.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by?.length);
  assert(view.phase_chain.includes('plan'), 'a caller map alone is not an acceptance event');
  const accepted = definitionHistoryFixture();
  const forged = { ...accepted.ref, source_refs: ['caller-invented.yaml'], content_fingerprint: 'f'.repeat(64) };
  const reused = effectiveScopeView({ birth: accepted.birth, events: [{ type: 'scope_revised', execution_scope: accepted.cached }], workflow,
    definitionProofs: new Map([['design:causal', [forged]]]), stalePhases: ['plan'] });
  assert.deepStrictEqual(reused.obligations.find(obligation => obligation.id === 'design:causal')!.satisfied_by, [accepted.ref], 'only the original registered ref may be consumed');
} });

/** Native-format fixture only; late process controls intentionally carry no Q answers or HEAD. */
function nativeScopeControl(root: string, feature: string, runId: string) {
  const previousHome = process.env.CLAUDE_CONFIG_DIR, home = path.resolve(__dirname, '../../reports/maison-b-scope/native', path.basename(root));
  const session = 'aaaaaaaa-1111-4444-8888-bbbbbbbbbbbb', file = path.join(home, 'projects/control', session + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = [ ['skip', '本次不跑真机。'], ['restore', '本次恢复真机测试。'], ['small', '按小型处理。'], ['continue', '继续。'], ['skip-again', '现在仍不跑真机。'] ]
    .map(([uuid, content]) => ({ type: 'user', uuid, sessionId: session, cwd: root, timestamp: new Date().toISOString(), message: { role: 'user', content } }));
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  process.env.CLAUDE_CONFIG_DIR = home;
  return { home, file, source: (id: string) => ({ session_ref: `${file}#${id}`, feature, run_id: runId }),
    restore: () => { if (previousHome === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousHome; } };
}
function userControlProposal(scope: ExecutionScope, source?: NonNullable<ExecutionScopeInput['request']['user_control']>): ExecutionScopeInput {
  return { request: { completion_target: scope.completion_target, requested_results: [...scope.requested_results], requested_phases: executionCompletionPhases(scope).length ? executionCompletionPhases(scope) : ['testing'],
    ...(scope.request_impact ? { impact: structuredClone(scope.request_impact) } : {}), ...(source ? { user_control: source } : {}) }, facts: structuredClone(scope.obligations), contract_fingerprints: [] };
}
function scopeControlEvent(before: ExecutionScope, next: ExecutionScope, input: ExecutionScopeInput, index = 1) {
  return { type: 'scope_revised', revision_index: index, previous_scope_fingerprint: executionScopeFingerprint(before), execution_scope: next,
    revision_input: input, trigger: { phase: 'testing', check_id: 'user_control' }, allowed_fields: [...SCOPE_REVISION_FIELDS] };
}
cases.push({ name: 'B user-control: native late user can reduce only future checks and the same source replays on the same run', run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-control-')), feature = 'control', runId = 'same-run', native = nativeScopeControl(root, feature, runId);
  try {
    const birth = resolveExecutionScope(request(['testing']), workflow, d2Acceptance('device'), d2Facts());
    const proposal = userControlProposal(birth, native.source('skip')), ctx = { projectRoot: root, feature, runId };
    const control = readScopeRevisionUserControl(birth, proposal, ctx), next = applyScopeUserControl(birth, workflow, control);
    proposal.request.user_control = control.source;
    assert(control.newSource && control.allowedSubtractions.size > 0); assert(!next.phase_chain.includes('testing'));
    assert(next.obligations.filter(item => item.kind === 'device-evidence').every(item => item.applicability === 'not_applicable' && !item.satisfied_by?.length));
    assert.deepEqual(next.requested_results, birth.requested_results); assert.equal(next.completion_target, birth.completion_target);
    assertRevisionKeepsRequiredObligations(birth, next, control.allowedSubtractions);
    assert.throws(() => assertRevisionKeepsRequiredObligations(birth, next), /不得删除或降级/);
    const event = scopeControlEvent(birth, next, proposal);
    assert.equal(executionScopeFingerprint(applyScopeRevisions(birth, [event] as never, ctx)), executionScopeFingerprint(next));
    assert.throws(() => applyScopeRevisions(birth, [event] as never, { ...ctx, runId: 'other-run' }), /当前project/);
    assert.equal(control.source?.user?.id, 'skip'); assert.equal(control.source?.user?.text, '本次不跑真机。');
    assert.equal(control.source?.user?.sha256, createHash('sha256').update('本次不跑真机。').digest('hex'));
    assert.deepEqual(control.source?.excluded, ['testing']);
    fs.renameSync(native.file, native.file + '.moved');
    assert.equal(executionScopeFingerprint(applyScopeRevisions(birth, [event] as never, { ...ctx, projectRoot: root + '-moved' })), executionScopeFingerprint(next));
    assert.equal(executionScopeFingerprint(applyScopeRevisions(birth, [event] as never)), executionScopeFingerprint(next));
    const inherited = readScopeRevisionUserControl(next, userControlProposal(next), { ...ctx, events: [event] });
    assert(!inherited.newSource); assert(inherited.allowedSubtractions.size > 0);
    // A new locator, even with caller-filled snapshot fields, still has to read native storage.
    assert.throws(() => readScopeRevisionUserControl(birth, userControlProposal(birth,
      { ...control.source!, session_ref: native.file + '#invented' }), ctx));
    assert.throws(() => readScopeRevisionUserControl(birth, userControlProposal(birth, native.source('skip')), { ...ctx, events: [event] }));
    const damaged = structuredClone(event); damaged.revision_input.request.user_control!.user!.text = '不跑UT';
    assert.throws(() => applyScopeRevisions(birth, [damaged] as never, ctx), /原文\/消息身份\/指令/);
  } finally { native.restore(); fs.rmSync(root, { recursive: true, force: true }); }
} });
cases.push({ name: 'B user-control: ordinary revisions inherit exclusion and restoration does not invent originally NA visual checks', run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-control-')), feature = 'control', runId = 'same-run', native = nativeScopeControl(root, feature, runId);
  try {
    const birth = resolveExecutionScope(request(['testing']), workflow, d2Acceptance('device'), d2Facts());
    const proposal = userControlProposal(birth, native.source('skip')), ctx = { projectRoot: root, feature, runId };
    const accepted = readScopeRevisionUserControl(birth, proposal, ctx), cut = applyScopeUserControl(birth, workflow, accepted);
    proposal.request.user_control = accepted.source;
    const first = scopeControlEvent(birth, cut, proposal);
    const active = { ...ctx, events: [first] };
    const inherited = readScopeRevisionUserControl(cut, userControlProposal(cut), active);
    assert(!inherited.newSource); assert(!applyScopeUserControl(birth, workflow, inherited).phase_chain.includes('testing'));
    const fixed = readScopeRevisionUserControl(cut, userControlProposal(cut, native.source('small')), active);
    assert(!applyScopeUserControl(birth, workflow, fixed).phase_chain.includes('testing'), 'flow preference silently revoked testing exclusion');
    const restoreInput = userControlProposal(cut, native.source('restore'));
    const restoreControl = readScopeRevisionUserControl(cut, restoreInput, active), restored = applyScopeUserControl(cut, workflow, restoreControl);
    restoreInput.request.user_control = restoreControl.source;
    assert(restored.phase_chain.includes('testing')); assert(restored.obligations.filter(item => item.kind === 'visual-evidence').every(item => item.applicability === 'not_applicable'));
    const second = scopeControlEvent(cut, restored, restoreInput, 2);
    assert.equal(executionScopeFingerprint(applyScopeRevisions(birth, [first, second] as never, ctx)), executionScopeFingerprint(restored));
    const smallOnly = readScopeRevisionUserControl(birth, userControlProposal(birth, native.source('small')), ctx);
    assert.equal(smallOnly.allowedSubtractions.size, 0, '按小型 was mistaken for skip UT/testing');
  } finally { native.restore(); fs.rmSync(root, { recursive: true, force: true }); }
} });
cases.push({ name: 'B user-control: forged origin, unsourced reanswer, completed checks and real failures cannot be cleared', run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-control-')), feature = 'control', runId = 'same-run', native = nativeScopeControl(root, feature, runId);
  try {
    const birth = resolveExecutionScope(request(['testing']), workflow, d2Acceptance('device'), d2Facts()), ctx = { projectRoot: root, feature, runId };
    const proposal = userControlProposal(birth);
    const self = readScopeRevisionUserControl(birth, proposal, ctx); assert.equal(self.allowedSubtractions.size, 0);
    const forged = path.join(root, 'pretend.jsonl'); fs.copyFileSync(native.file, forged);
    assert.throws(() => readScopeRevisionUserControl(birth, userControlProposal(birth, { ...native.source('skip'), session_ref: forged + '#skip' }), ctx), /原生存储/);
    const input = userControlProposal(birth, native.source('skip'));
    assert.throws(() => readScopeRevisionUserControl(birth, input, { ...ctx, events: [{ type: 'phase_verdict', phase: 'testing', verdict: 'FAIL' }] }), /真实FAIL/);
    const complete = projectScopeSchedule({ ...birth, obligations: birth.obligations.map(item => item.applicability !== 'required' ? item : { ...item, satisfied_by: [{ phase: 'testing', run_id: runId, evidence_manifest_aggregate: 'e'.repeat(64) }] }) }, workflow);
    const control = readScopeRevisionUserControl(complete, input, { ...ctx, completedPhases: new Set(['testing']) });
    assert.equal(control.allowedSubtractions.size, 0); assert.equal(executionScopeFingerprint(applyScopeUserControl(complete, workflow, control)), executionScopeFingerprint(complete));
  } finally { native.restore(); fs.rmSync(root, { recursive: true, force: true }); }
} });
cases.push({ name: 'B user-control: completion inspection replays accepted source after native storage disappears without inventing completion', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['ut', 'testing'], completionTarget: 'request' });
  const runId = 'user-control-record', native = nativeScopeControl(root, feature, runId);
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n.native-control/\ndoc/reports/\n');
    execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@e.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline'], { cwd: root });
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId, adapter: 'generic', requirement: '把 value 改成 42' });
    const birth = prepared.manifest.execution_scope!, proposal = userControlProposal(birth, native.source('skip'));
    const control = readScopeRevisionUserControl(birth, proposal, { projectRoot: root, feature, runId });
    proposal.request.user_control = control.source;
    const next = applyScopeUserControl(birth, resolveWorkflowSpec(root, { frameworkRoot }), control);
    fs.appendFileSync(path.join(prepared.runDir, 'events.jsonl'), JSON.stringify(scopeControlEvent(birth, next, proposal)) + '\n');
    // A deliberately incomplete request record exercises the completion reader's scope replay.
    // It must stay INVALID for the real request endpoint, with no fabricated phase PASS.
    const recordFile = path.join(prepared.runDir, 'feature-completion.json');
    const record = { schema_version: '1.2', feature, run_id: runId, scope_source: 'run', workflow_track: 'full',
      generated_at: new Date().toISOString(), execution_scope_fingerprint: executionScopeFingerprint(next), scope_revision_count: 1,
      chain: ['ut'], phases: [{ phase: 'ut', run_id: runId, attempt: null, gate_fingerprint: null, receipt_sha256: null, evidence_manifest_aggregate: null }],
      artifact_hashes: { spec_md: null, acceptance_yaml: null, contracts_yaml: null }, requirement_sha256: null,
      review_attestation_aggregate: null, testing_source_aggregate: null, parent_run_id: null, supersedes: [] };
    const bytes = JSON.stringify(record); fs.writeFileSync(recordFile, bytes);
    fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify({ schema_version: '1.2',
      original_path: path.relative(root, recordFile).replace(/\\/g, '/'), original_sha256: createHash('sha256').update(bytes).digest('hex') }));
    const inspect = () => inspectCompletionRecord({ projectRoot: root, frameworkRoot, feature, expectedChain: ['ut'], expectedTrack: 'full' });
    const before = inspect(); assert.equal(before.verdict, 'INVALID'); assert(before.reasons.some(reason => reason.includes('不是 Feature 完成目标')), JSON.stringify(before));
    fs.renameSync(native.file, native.file + '.moved');
    assert.deepEqual(inspect(), before);
  } finally { native.restore(); fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });
cases.push({ name: 'B user-control: public next constructs the source proposal and same-run resume keeps the original goal and baseline', async run() {
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['ut', 'testing'], completionTarget: 'request' });
  const runId = 'user-control-public', native = nativeScopeControl(root, feature, runId), repo = path.resolve(__dirname, '../../..');
  try {
    const configFile = path.join(root, 'framework.config.json'), config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.materialized_adapters = ['codex']; fs.writeFileSync(configFile, JSON.stringify(config));
    const localFile = path.join(root, 'framework.local.json'), local = JSON.parse(fs.readFileSync(localFile, 'utf8')); local.agent_adapter = 'codex'; fs.writeFileSync(localFile, JSON.stringify(local)); clearFrameworkConfigCache();
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n.native-control/\ndoc/reports/\n');
    execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@e.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline'], { cwd: root });
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId, adapter: 'codex', requirement: '把 value 改成 42' });
    const original = JSON.parse(fs.readFileSync(prepared.manifestPath, 'utf8'));
    const invoke = (ref?: string) => spawnSync(process.execPath, [...testCliArgs(path.join(repo, 'harness/scripts/goal-mode-entry.ts')),
      '--next', '--run-mode', 'attended', '--adapter', 'codex', '--feature', feature, '--run-id', runId, '--project-root', root, '--framework-root', frameworkRoot,
      ...(ref ? ['--session-ref', ref] : [])], { cwd: root, encoding: 'utf8', timeout: 45000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: native.home, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } });
    const first = invoke(native.source('skip').session_ref);
    const eventsFile = path.join(prepared.runDir, 'events.jsonl'), events = loadAuthoritativeEvents(eventsFile);
    const revisions = events.filter(event => event.type === 'scope_revised') as Array<import('../../scripts/utils/goal-runner-phase').GoalRunEvent & { revision_input: ExecutionScopeInput; execution_scope: ExecutionScope }>;
    assert.equal(revisions.length, 1, first.stderr + first.stdout);
    assert.equal(revisions[0].revision_input.request.user_control?.run_id, runId); assert(!revisions[0].execution_scope.phase_chain.includes('testing'));
    await withRuntimeTest({ root }, () => runGoalModeSessionStep({ projectRoot: root, frameworkRoot, feature, runId, adapter: 'codex', runMode: 'attended' }));
    assert.equal(loadAuthoritativeEvents(eventsFile).filter(event => event.type === 'scope_revised').length, 1);
    assert(!loadEffectiveExecutionScope(root, feature, runId)!.phase_chain.includes('testing'));
    const current = JSON.parse(fs.readFileSync(prepared.manifestPath, 'utf8'));
    assert.equal(current.requirement, original.requirement); assert.equal(current.run_base_sha, original.run_base_sha); assert.deepEqual(current.execution_scope, original.execution_scope);
    assert.equal(fs.readdirSync(featureFilePath(root, feature, 'goal-runs')).length, 1, 'control created another run');
    assert(!loadAuthoritativeEvents(eventsFile).some(event => event.type === 'phase_verdict' && event.phase === 'testing' && event.verdict === 'PASS'), 'user exclusion fabricated a test PASS');
  } finally { native.restore(); fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'B1 a formal repeated repair keeps its open obligations and does not require a fresh source', run() {
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['plan', 'coding', 'review', 'ut'] });
  try {
    const configFile = path.join(root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    fs.writeFileSync(configFile, JSON.stringify({ ...config, project_profile: { name: 'hmos-app' } }));
    clearFrameworkConfigCache();
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const context = { projectRoot: root, frameworkRoot, feature };
    const birth = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const files = [path.relative(root, featureFilePath(root, feature, 'contracts.yaml')).replace(/\\/g, '/')];
    const candidate = (id: string, summary: string) => ({ id, category: 'plan' as const, files,
      summary, item_fingerprint: itemFingerprintOf(id, files, summary), source_phase: 'review' });
    const first = [candidate('CR-1', 'first finding'), candidate('CR-2', 'second finding')];
    const produced = scopeRevisionInputFromRepairCandidates(first, context);
    assert(produced);
    const resolve = (previous: ExecutionScope, proposal: ExecutionScopeInput, repairCandidates = first) => resolveScopeRevisionProposal({
      ...context, workflow: resolveWorkflowSpec(root, { frameworkRoot }), previous, authorizedPhases: birth.phase_chain,
      proposals: [proposal], repairCandidates, currentPhase: 'review',
    });
    const registration = resolve(birth, produced.input);
    assert(registration, 'a sourced new repair must still be admitted');
    appendFeatureScopeRevision({ ...context, nextScope: registration.scope, trigger: { phase: 'review' }, revisionInput: registration.input });
    const previous = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const newest = [candidate('CR-2', 'latest second finding'), candidate('CR-1', 'latest first finding')];
    const refreshed = scopeRevisionInputFromRepairCandidates(newest, context);
    assert(refreshed);
    const ids = ['design-decision:CR-1', 'design-decision:CR-2'];
    assert.deepEqual(refreshed.input.facts.filter(fact => ids.includes(fact.id)).map(fact => fact.id), ids);
    assert(refreshed.input.facts.some(fact => fact.reason.endsWith(newest[0].summary)));
    assert(previous.obligations.filter(fact => ids.includes(fact.id)).every(fact => !fact.satisfied_by));
    const originalBytes = fs.readFileSync(featureFrozenScopePath(root, feature));
    for (const [reason, order] of [[true, false], [false, true], [true, true]]) {
      const proposal = structuredClone(refreshed.input);
      const indexes = ids.map(id => proposal.facts.findIndex(fact => fact.id === id));
      if (!reason) for (const index of indexes) {
        const fact = proposal.facts[index];
        fact.reason = previous.obligations.find(row => row.id === fact.id)!.reason;
      }
      if (order) [proposal.facts[indexes[0]], proposal.facts[indexes[1]]] = [proposal.facts[indexes[1]], proposal.facts[indexes[0]]];
      assert.equal(resolve(previous, proposal, newest), null, `reason=${reason}, order=${order}`);
      assert.deepEqual(fs.readFileSync(featureFrozenScopePath(root, feature)), originalBytes);
    }

    const targeted = (proposal: ExecutionScopeInput) => proposal.facts.find(fact => fact.id === ids[0])!;
    const unqualified = structuredClone(refreshed.input);
    targeted(unqualified).reason = 'unrelated reason';
    assert.throws(() => resolve(previous, unqualified, newest), /revision requires new sourced facts/);
    assert.throws(() => resolve(previous, refreshed.input, newest.map(item => ({ ...item, source_phase: 'spec' }))), /revision requires new sourced facts/);
    const downgraded = structuredClone(refreshed.input);
    targeted(downgraded).applicability = 'not_applicable';
    assert.throws(() => resolve(previous, downgraded, newest), /不得删除或降级 required/);
    const switched = structuredClone(refreshed.input);
    targeted(switched).kind = 'acceptance-definition';
    assert.throws(() => resolve(previous, switched, newest), /不得删除或降级 required/);
    const duplicate = structuredClone(refreshed.input);
    duplicate.facts.push(structuredClone(targeted(duplicate)));
    assert.throws(() => resolve(previous, duplicate, newest), /义务字段或身份非法/);
    const movedAuthority = structuredClone(refreshed.input);
    const [authority, trigger] = ['design-context:candidate', ids[0]].map(id => movedAuthority.facts.findIndex(fact => fact.id === id));
    assert(Math.min(authority, trigger) >= 0);
    [movedAuthority.facts[authority], movedAuthority.facts[trigger]] = [movedAuthority.facts[trigger], movedAuthority.facts[authority]];
    assert.throws(() => resolve(previous, movedAuthority, newest), /revision requires new sourced facts/, 'ordered authority positions must be compared');
    const changedBasis = structuredClone(refreshed.input);
    targeted(changedBasis).basis[0].content_fingerprint = 'f'.repeat(64);
    assert(resolve(previous, changedBasis, newest), 'a changed source identity with verified dependency bytes is not a presentation-only repeat');
    const actualSource = resolveCapabilityInputs({ ...context, phase: 'plan', track: 'full',
      testTargets: [path.relative(root, featureFilePath(root, feature, 'plan.md'))],
      inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] },
    }).inputs?.values.codebase;
    assert(actualSource?.state === 'resolved');
    const differentSource = structuredClone(refreshed.input);
    targeted(differentSource).basis = [actualSource.binding];
    assert.deepEqual(resolve(previous, differentSource, newest)?.scope.obligations.find(fact => fact.id === ids[0])?.basis, [actualSource.binding]);
    const changedRole = structuredClone(refreshed.input);
    targeted(changedRole).basis[0].dependencies[0].role = 'artifact';
    assert(resolve(previous, changedRole, newest), 'a changed source role must go through normal signing');
    const badDependency = structuredClone(refreshed.input);
    targeted(badDependency).basis[0].dependencies[0].sha256 = 'f'.repeat(64);
    assert(resolve(previous, badDependency, newest), 'the historical trigger digest stays material to the signed identity');
    const escapedBasis = structuredClone(refreshed.input);
    targeted(escapedBasis).basis[0].dependencies[0].path = path.resolve(root, '../different-source.ts');
    assert.throws(() => resolve(previous, escapedBasis, newest), /依据.*不可用|不在项目内/, 'escaped source must be checked');
    const forgedProof = structuredClone(refreshed.input);
    const definition = forgedProof.facts.find(fact => fact.id === 'design-context:candidate')!;
    definition.satisfied_by = [{ ...structuredClone(definition.basis[0]), content_fingerprint: 'a'.repeat(64) }];
    assert.throws(() => resolve(previous, forgedProof, newest), /满足依据.*核验失败|binding stale/, 'forged proof must be checked');
    const forgedControl = structuredClone(refreshed.input);
    forgedControl.request.user_control = { session_ref: 'invented', feature, run_id: 'invented' };
    assert.throws(() => resolve(previous, forgedControl, newest), /原生|user control/);
    const newCandidates = [...newest, candidate('CR-3', 'new finding')];
    const addition = scopeRevisionInputFromRepairCandidates(newCandidates, context);
    assert(addition);
    const revised = resolve(previous, addition.input, newCandidates);
    assert(revised?.scope.obligations.some(fact => fact.id === 'design-decision:CR-3'), 'a new real finding must still revise');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

export function runAll(): Promise<UnitCaseResult[]> {
  return runUnitCasesAsync(cases);
}
