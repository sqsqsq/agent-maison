import { unitCaseGroups } from '../utils/unit-case-selection';
import { resolveValidationOnlyEligibility } from '../../scripts/utils/goal-runner-phase';
import { writeRunSummaryBase } from '../../harness-runner';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { checkContractFileReferenceClosure } from '../../scripts/check-plan';
import { checkUtUnsupportedTargetsHandled, checkUtTestabilityAuditPresent, inspectTestabilityAudit } from '../../scripts/check-ut';
import { UT_REAL_ASSERTION_CHECK } from './repair-candidates.unit.test';
import { renderResultBlock } from '../utils/verifier-evidence-fixture';
import { parseVerifierRequest } from '../../scripts/utils/verifier-request';
import { asRecord } from '../../scripts/utils/component-blueprint-model';
import { invocationCompleted } from '../../scripts/utils/invocation-completion';
import assert from 'assert';
import { readRepairDependencyContext, repairResponsibilityContext, resolveRepairResponsibility } from '../../scripts/utils/repair-responsibility';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { execFileSync } from 'child_process';
import { runRuntimeTestChild, preserveRuntimeTestEvidence } from '../utils/runtime-test-control';
import { ensureFeatureExecutionScopeFrozen, readFeatureFrozenScope, featureFrozenScopePath, featureEffectiveScope, appendFeatureScopeRevision, registerFeatureScopeTransfer, applyFeatureScopeRevisionsThenMaybeComplete } from '../../scripts/utils/feature-execution-scope';
import { resolveEffectiveDiffBaseline } from '../../scripts/utils/git-diff';
import { resolveBirthExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { checkFactsArtifact, factsBaselineFingerprint } from '../../scripts/utils/context-facts';
import { resolveFeatureTrack } from '../../scripts/utils/runtime-policy';
import { loadFeatureTrackDecl, resolveScopeRevisionProposal } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveBirthScopeForManifest } from '../../scripts/utils/feature-execution-scope';
import { resolveSuccessorExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { loadWorkflowSpec } from '../../workflow-loader';
import { __testing_setInsideRecordWriteLock, __testing_setBeforeStaleLockReclaim, detectLiveFeatureLock } from '../../scripts/utils/feature-execution-scope';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import { readCurrentDispositionInput, readReusableCheckResult } from '../../scripts/utils/verify-feature-completion';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { tryAcquireLock, releaseLock } from '../../scripts/utils/goal-run-lock';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
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
import { setupGoalRuntimeHost, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { frameworkDeclaringTsSources, removeShimFramework } from './standalone-coding-review.unit.test';
import { prepareFixtureVerifierMaterial } from '../helpers/goal-run-driver';
import { designScopeRevisionChecks, checkTypedConstructionContent } from '../../scripts/utils/blueprint-skill-projection';
import { resolvePhaseWriteBoundary, resolvePhasePathOwnership } from '../../scripts/utils/phase-write-boundary';
import { readRunBoundContracts } from '../../scripts/utils/capability-resolution';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { clearFrameworkConfigCache, loadFrameworkConfig, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { loadResolvedProfile, loadPhaseRuleWithOverlays } from '../../profile-loader';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { configureFeature } from './component-closure.unit.test';
import { resolveCapabilityInputs, projectSourceFileBinding, type InputBinding } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput, resolveFactsPhaseOwnedSources } from '../../scripts/utils/capability-resolution-entry-input';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { buildSummaryRepairCandidates, collectReviewRepairCandidates, itemFingerprintOf, scopeRevisionInputFromRepairCandidates } from '../../scripts/utils/repair-candidates';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { runRevalidate, REVALIDATION_RECORD_FILE } from '../../scripts/utils/revalidate';
import { resolveComponentClosureInputs } from '../../scripts/utils/component-closure-inputs';
import { deriveComponentClosureObligations } from '../../scripts/utils/component-closure-obligations';
import { buildChangeUnitGoalHandoff } from '../../scripts/utils/change-unit-progress-loop';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { generateFeatureCompletion, verifyReusedExecutionScope, executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { assessFeature, assessmentReasons } from '../../scripts/utils/feature-assessment';

/** plan b2d7f4e9：唯一评估入口 assessFeature 的 VALID/INVALID 投影（complete ⇔ VALID）。 */
function completionOf(opts: { projectRoot: string; feature: string; expectedChain: string[]; expectedTrack: string; frameworkRoot?: string }): { verdict: 'VALID' | 'INVALID'; reasons: string[] } {
  const assessment = assessFeature(opts.projectRoot, opts.feature, opts);
  return { verdict: assessment.complete ? 'VALID' : 'INVALID', reasons: assessmentReasons(assessment) };
}
import { loadFrozenExecutionScope, loadEffectiveExecutionScope, resolveEffectiveScopeSource } from '../../scripts/utils/goal-run-creation';
import { resolveUpstreamPhaseChain } from '../../scripts/utils/upstream-verdict-gate';
import { featureRequirementBinding, readScopeAcceptance, collectResolvedScopeFacts, prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { uiSpecAbsPath } from '../../scripts/utils/ui-spec-shared';
import { codingBasePath } from '../../scripts/utils/pass-snapshot';
import { recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import * as os from 'os';
import type { AcceptanceSpec, CheckContext, CheckResult } from '../../scripts/utils/types';
import { resolveExecutionScope, validateExecutionScope, executionScopeFingerprint, executionCompletionPhases, hasNoTestingObligation, findSubtractedRequiredObligations, assertRevisionKeepsRequiredObligations, hasNewSourcedFact, effectiveScopeView, scopeProofHistory, projectScopeSchedule, affectedScopePhases, isExecutionSourceBasis, type ScopeHistoryEvent, type ExecutionScope, type ExecutionScopeInput, type ResolvedScopeFacts } from '../../scripts/utils/execution-scope';
import { applyScopeRevisions, loadScopeRevisions, resolveRunBaseline, revokedPhasesByRevision, eventsWithScopeRevocations } from '../../scripts/utils/goal-run-creation';
import { isClosureOnlyRetryPending, readExecutionActivity, loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { executionRequestForInvoke } from '../../scripts/utils/session-execution-handoff';
import { SCOPE_REVISION_FIELDS } from '../../scripts/utils/goal-manifest';
import type { WorkflowSpec } from '../../workflow-loader';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, SelectedUnitCases, UnitExecutionTiming } from '../utils/unit-case-selection';

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
  { name: '38e5a7c2 host contracts first materialize in plan and reach coding through real scope revision', async run() {
    const { root, frameworkRoot } = setupRunlessProject();
    let evidenceFeature: string | undefined;
    try {
      const contractsRaw = fs.readFileSync(path.join(__dirname, '../fixtures/facts-plan-handoff/contracts.yaml'), 'utf8');
      const useCasesRaw = fs.readFileSync(path.join(__dirname, '../fixtures/facts-plan-handoff/use-cases.yaml'), 'utf8');
      const hostContracts = YAML.parse(contractsRaw);
      const feature = hostContracts.feature as string;
      evidenceFeature = feature;
      fs.cpSync(path.join(__dirname, '../fixtures/facts-plan-handoff/project'), root, { recursive: true });
      const configPath = path.join(root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.materialized_adapters = ['generic'];
      for (const layer of config.architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config)); clearFrameworkConfigCache();
      const deveco = path.join(root, 'fake-deveco');
      fs.mkdirSync(path.join(deveco, 'tools/hvigor/bin'), { recursive: true });
      fs.writeFileSync(path.join(deveco, 'tools/hvigor/bin', process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw'), 'fixture toolchain');
      fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', agent_adapter: 'generic', toolchain: { devEcoStudio: { installPath: deveco } } }));
      const inputSource = '02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets';
      const contractFile = featureFilePath(root, feature, 'contracts.yaml');
      assert(!fs.existsSync(contractFile));
      const requirement = '补齐施工契约并实施';
      const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature', requestedResults: ['交付实现'], requestedPhases: ['plan','coding','review','ut'], requirement, overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '契约物化回归', basisPaths: [inputSource] } });
      assert.equal(prepared.scope.phase_chain[0], 'plan');
      execFileSync('git', ['init','-q'], { cwd: root }); fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
      execFileSync('git', ['add','.'], { cwd: root }); execFileSync('git', ['-c','user.name=F','-c','user.email=f@e.test','commit','-qm','base'], { cwd: root });
      // This case starts from admitted run authority; initial CU design is outside the handoff under test.
      const manifest = buildGoalManifestFromInput({ feature, run_id: '38e5a7c2-handoff', requirement, adapter: 'generic',
        start_phase: 'plan', end_phase: prepared.scope.phase_chain.at(-1), chain_override: prepared.scope.phase_chain,
        execution_scope: prepared.scope, budget: { max_total_turns: 3 }, unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 } }, { projectRoot: root, featuresDir: 'doc/features' });
      createGoalRun({ projectRoot: root, manifest, chain: prepared.scope.phase_chain });
      assert(!fs.existsSync(contractFile), 'birth must not pre-seed contracts');
      let runId = manifest.run_id, reachedCoding = false, planCalls = 0;
      const boundary = () => resolvePhaseWriteBoundary({ projectRoot: root, frameworkRoot, feature, runId,
        phaseOrder: ['spec','plan','coding','review','ut','testing'], track: 'full', profileDir: path.join(frameworkRoot,'profiles/hmos-app'), productLayerDirs: ['01-Product','02-Feature','04-BusinessBase'] });
      const context = (phase: 'plan' | 'coding') => {
        const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase, featuresDir: 'doc/features', goalRunId: runId });
        const resolvedInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase, track: 'full', ...bridge }).inputs!;
        const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
        const resolvedProfile = loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot);
        return { projectRoot: root, frameworkRoot, feature, phase, featureSpec: loader.loadFeatureSpec(feature, resolvedInputs), resolvedInputs, factsContext: bridge.factsContext,
          resolvedProfile, phaseRule: loadPhaseRuleWithOverlays(phase, loader.loadPhaseRule(phase), resolvedProfile) } as never;
      };
      const outcome = await runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, adapter: 'generic', resume: runId,
        onAuthor: (ctx, admittedContext) => {
          runId = ctx.runId;
          if (loadEffectiveExecutionScope(root, feature, runId)!.phase_chain.includes('plan')) {
          planCalls++;
          if (planCalls === 1) assert(!fs.existsSync(contractFile)
            || String(YAML.parse(fs.readFileSync(contractFile, 'utf8')).source).startsWith('derive.blueprint-contracts:'),
            'only the actual plan preparation or this author may first materialize the approved contract');
          assert.equal(resolvePhasePathOwnership(boundary(), path.relative(root, contractFile)).owner, 'plan');
          fs.writeFileSync(contractFile, planCalls === 1 ? YAML.stringify({ ...hostContracts, interfaces: [{ class: 'BankCardRepository', file: inputSource, methods: [{ name: 'open', params: [], return: 'any' }] }] }) : contractsRaw);
          fs.writeFileSync(featureFilePath(root, feature, 'use-cases.yaml'), useCasesRaw);
          assert.equal(resolvePhasePathOwnership(boundary(), inputSource).owner, 'coding', 'existing product source retains its producer before construction is ready: ' + JSON.stringify({
            planCalls, recorded: resolveEffectiveScopeSource(root, feature, runId)?.scope.obligations.map(o => [o.id, o.owner_phase, o.applicability, o.satisfied_by?.map(p => 'input_id' in p ? p.input_id : p.phase)]),
            events: fs.readFileSync(featureFilePath(root, feature, `goal-runs/${runId}/events.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line))
              .filter(e => e.type === 'scope_revised' || e.type === 'phase_verdict').map(e => ({ type: e.type, phase: e.phase, verdict: e.verdict, action: e.action, chain: e.execution_scope?.phase_chain })),
          }));
          assert.throws(() => readRunBoundContracts(root, frameworkRoot, feature, runId), /frozen construction contract missing|input binding stale/, 'known source ownership must not grant an unverified construction input');
          }
          const admitted = admittedContext.factsContext;
          assert(admitted, 'the real unit author must read its signed facts admission');
          assert.equal(admitted.first_phase, 'plan', 'the contract producer retains the immutable plan admission anchor');
        },
        onHarnessSummary: ({ phase }) => {
          if (phase === 'coding') {
            let read: ReturnType<typeof readRunBoundContracts>;
            try { read = readRunBoundContracts(root, frameworkRoot, feature, runId); }
            catch (error) {
              if (!(error instanceof Error) || !/frozen construction contract missing|input binding stale/.test(error.message)) throw error;
              const owner = resolvePhasePathOwnership(boundary(), path.relative(root, contractFile)).owner;
              assert(owner === 'plan', 'the actual unbound construction artifact must retain its plan producer');
              const checks: CheckResult[] = [{ id: 'capability_resolution_contract', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
                description: 'feature capability contract resolves before checker execution', details: error.message,
                repair_owner: owner,
                affected_files: [path.relative(root, contractFile).replace(/\\/g, '/')],
                suggestion: '按本轮plan真实检查反馈修复施工契约，再复验原绑定。' }];
              return { checks };
            }
            assert.deepStrictEqual(read.modules.map(m => m.name), hostContracts.modules.map((m: { name: string }) => m.name));
            assert.equal(resolvePhasePathOwnership(boundary(), inputSource).owner, 'coding');
            reachedCoding = true;
          }
          const ctx = context(phase as 'plan' | 'coding');
          const checks = checkTypedConstructionContent(ctx).filter(c => c.id === 'construction_content_complete');
          const revision = phase === 'plan' ? designScopeRevisionChecks(ctx, checks) : [];
          return { checks: [...checks, ...revision] };
        },
      });
      assert(reachedCoding, JSON.stringify(outcome.events.filter(e => ['phase_halt','phase_verdict','run_end'].includes(String(e.type)))
        .map(e => ({ type: e.type, phase: e.phase, verdict: e.verdict, action: e.action, reason: e.reason, halt_reason: e.halt_reason }))));
      assert.equal(planCalls, 2, 'real invalid construction must retry the plan owner before publishing');
      assert(outcome.events.some(e => e.type === 'scope_revised' && (e.trigger as { phase?: string })?.phase === 'plan'));
      assert(!outcome.events.some(e => e.type === 'phase_write_boundary_degraded'));
      assert.equal(fs.readFileSync(contractFile, 'utf8'), contractsRaw, 'binding handoff must not rewrite the host contract');
    } catch (error) {
      const originals = [path.join(root, 'framework.config.json')];
      if (evidenceFeature) {
        for (const file of ['contracts.yaml', 'use-cases.yaml', 'acceptance.yaml', 'context/facts.md']) originals.push(featureFilePath(root, evidenceFeature, file));
        for (const phase of ['spec', 'plan', 'coding', 'review', 'ut']) for (const name of ['summary.json', 'script-report.json', 'phase-evidence-manifest.json']) {
          originals.push(path.join(featurePhaseReportsDir(root, evidenceFeature, phase, frameworkRoot), name));
        }
        const runDir = featureFilePath(root, evidenceFeature, 'goal-runs/38e5a7c2-handoff');
        const issued = executionRequestForInvoke(runDir);
        if (issued) originals.push(path.resolve(runDir, issued.reference.path));
      }
      const saved = preserveRuntimeTestEvidence([root], String(error), [], originals);
      throw new Error(`${(error as Error).stack}\noriginals: ${saved}`);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
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
      assert(bridge.codeTargets?.includes(researched) && !bridge.codeTargets.includes(original[1]), JSON.stringify(bridge.codeTargets));
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
async function runScopeScenario(mode: 'ut-l3-code' | 'ut-l3-spec' | 'ut-design-gap' | 'direct' | 'revision' | 'revision-cut' | 'revision-precut' | 'revision-revoke' | 'impact-first' | 'impact-reuse' | 'impact-null' | 'design-gap' | 'design-gap-revert' | 'spec-gap-revert' | 'detached' | 'detached-harness' | 'detached-explicit' | 'request-ut' | 'request-spec' | 'request-plan' | 'request-coding' | 'request-spec-invalid' | 'request-plan-invalid' | 'request-spec-cut' | 'request-plan-cut' | 'testing-fail' | 'testing-offline' | 'testing-manual' | 'unresolved', useDefault = false, missingMapping = false, continuousCoding: boolean | 'request' = false): Promise<void> {
  const repo = path.resolve(__dirname, '../../..');
  const { root } = setupGoalRuntimeHost('codex');
  const frameworkRoot = path.join(root, 'framework');
  const tsFramework = continuousCoding ? frameworkDeclaringTsSources() : undefined;
  let preserveFailure: ((reason: string) => string) | undefined;
  let restoreAppend: (() => void) | undefined;
  try {
    for (const dir of ['harness', 'profiles', 'agents', 'skills', 'specs', 'templates', 'docs']) fs.symlinkSync(path.join(dir === 'profiles' ? tsFramework ?? repo : repo, dir), path.join(frameworkRoot, dir), process.platform === 'win32' ? 'junction' : 'dir');
    fs.copyFileSync(path.join(repo, 'package.json'), path.join(frameworkRoot, 'package.json'));
    fs.copyFileSync(path.join(repo, 'workflows/spec-driven.workflow.yaml'), path.join(frameworkRoot, 'workflows/spec-driven.workflow.yaml'));
    const source = YAML.parse(fs.readFileSync(path.join(repo, 'workflows/spec-driven.workflow.yaml'), 'utf8'));
    source.schema_version = '1.2'; delete source.auto_chain_by_track;
    source.artifacts = source.artifacts.filter((a: { id: string }) => !['change', 'exit'].includes(a.id));
    for (const artifact of source.artifacts) { delete artifact.tracks; delete artifact.requires_by_track; artifact.obligation_provider_id = artifact.scope === 'global' ? 'obligations.project' : `obligations.${artifact.id}`; }
    fs.writeFileSync(path.join(frameworkRoot, 'workflows/scoped.workflow.yaml'), YAML.stringify(source));
    if (useDefault) fs.copyFileSync(path.join(repo, 'workflows/obligation-driven.workflow.yaml'), path.join(frameworkRoot, 'workflows/obligation-driven.workflow.yaml'));
    const configPath = path.join(root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); config.active_workflow = useDefault ? 'obligation-driven' : 'scoped';
    fs.writeFileSync(configPath, JSON.stringify(config)); clearFrameworkConfigCache();
    const fixture = path.join(repo, 'harness/tests/fixtures/component-blueprint/valid');
    fs.cpSync(fixture, root, { recursive: true });
    const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
    configureFeature(root, loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh'));
    if (missingMapping) {
      const file = featureFilePath(root, feature, 'contracts.yaml');
      const contract = YAML.parse(fs.readFileSync(file, 'utf8')); contract.change_unit.predicate_mappings = [];
      fs.writeFileSync(file, YAML.stringify(contract));
    }
    const utL3 = mode === 'ut-l3-code' || mode === 'ut-l3-spec';
    const utDesignGap = mode === 'ut-design-gap';
    const designGapFamily = ['design-gap', 'design-gap-revert', 'ut-design-gap'].includes(mode);
    // `spec-gap-revert`：与 design-gap-revert **同构**的 spec 归属闭环（需求 D0.3「review 归因
    // spec 的用例同理」）。候选形态与 designGapFamily 一致（请求 coding/review/ut + 契约、验收、
    // 实现事实 + 有来源 impact），区别只在触发者是 review 的 spec 归属发现。
    const specGap = mode === 'spec-gap-revert' || mode === 'ut-l3-spec';
    const codingFirst = designGapFamily || specGap || utL3;
    if (mode === 'direct') {
      fs.rmSync(featureFilePath(root, feature, 'spec/spec.md'), { force: true });
      fs.rmSync(featureFilePath(root, feature, 'plan/plan.md'), { force: true });
    }
    const testingOnly = ['testing-fail', 'testing-offline', 'testing-manual'].includes(mode);
    // R5（plan a9f3c7d2 第二笔）：`request-*` 家族＝单职责终点——只请求一个阶段、completion_target=request。
    // 三个新模式（spec / plan / coding）**走生产候选生成入口** `--prepare-scope --completion-target request`，
    // 不再手写候选；`request-ut` 保持 P8 原样（手造候选），两条路都必须得到单阶段链。
    const requestOnly = mode.startsWith('request-');
    const requestPhase = mode.startsWith('request-spec') ? 'spec' : mode.startsWith('request-plan') ? 'plan' : mode === 'request-coding' ? 'coding' : 'ut';
    // `*-invalid` 反向变体：本阶段产出不合法（生产设计检查发不出修订），run 须如实 HALTED。
    const invalidOutput = mode.endsWith('-invalid');
    const preparedCandidate = requestOnly && mode !== 'request-ut';
    const input = request(requestOnly ? [requestPhase] : testingOnly ? ['testing'] : ['direct'].includes(mode) || codingFirst ? ['coding', 'review', 'ut'] : ['spec'], requestOnly ? 'request' : 'feature');
    const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
    const codeFile = path.join(root, (utL3 || continuousCoding === true || ['revision-revoke', 'design-gap', 'design-gap-revert'].includes(mode))
      ? 'src/ledger/ClosureFixture.ts' : '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets');
    const codeRel = path.relative(root, codeFile).replace(/\\/g, '/');
    const originalCode = fs.readFileSync(codeFile);
    if (continuousCoding === true && specGap) {
      const ref = featureFilePath(root, feature, 'spec/ref-elements.yaml'); fs.mkdirSync(path.dirname(ref), { recursive: true });
      fs.writeFileSync(ref, 'elements: [{element_id: required-search, disposition: defer}]\n');
    }
    // 写集授权只认受信设计来源 `contracts.files`（第七轮阻断 1：候选自带的 implementation
    // basis 是自报，不能当授权）。共享夹具的 contracts.yaml 不声明 files，**只在临时 root 里**
    // 补上真实写集，让候选的实现义务与契约授权有交集——链形状与批次 1 一致。
    {
      const declared = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
      declared.files = [codeRel];
      if (utL3 || continuousCoding === true || ['revision-revoke', 'design-gap', 'design-gap-revert'].includes(mode)) {
        // These modes exercise real authorized source edits, so the existing owner resolver needs the actual module location.
        declared.modules = [{ name: 'ledger', layer: '02-Feature', package_path: 'src/ledger' }];
      }
      fs.writeFileSync(contractsFile, YAML.stringify(declared));
    }
    const contractsAtBirth = fs.readFileSync(contractsFile);
    const useCasesAtBirth = fs.readFileSync(featureFilePath(root, feature, 'use-cases.yaml'));
    // Every binding this fixture puts into a candidate is produced by the *production* resolver.
    // Hand-computing `sha256(stableStringify(YAML.parse(raw)))` is a different contract from what
    // `resolveArtifact` returns for acceptance@1/contracts@1/use-cases@1 (a SpecLoader-parsed
    // value), so a hand-built binding cannot survive the freeze-time `readBoundInput` re-resolve.
    // Reading it live also means design-gap / revision bindings reflect the file as it is *then*.
    const liveBinding = (phase: string, id: string, requirement?: string): any => {
      const resolvedInputs = resolveCapabilityInputs({
        projectRoot: root, frameworkRoot, feature, phase, track: 'full', testTargets: [codeRel],
        ...(requirement ? { requirement } : {}),
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] },
      });
      const value = resolvedInputs.inputs?.values?.[id];
      assert(value && value.state === 'resolved', `${phase}/${id} unresolved: ${JSON.stringify(value)}`);
      return value.binding;
    };
    // D0.2 provenance：候选必须自带「为哪句需求而算」的需求绑定，和生产 `--prepare-scope`
    // 生成的是同一形态（经生产 resolver，不手拼）。出生时会拿 `--requirement` 重解析比对。
    input.request.requirement_basis = liveBinding('spec', 'requirement', 'fixture delivery');
    const binding = liveBinding('plan', 'contracts');
    input.facts.push({ id: 'design:cu', kind: 'design-context', applicability: 'required', reason: 'existing admitted CU construction projection', basis: [binding], satisfied_by: [binding] });
    const codeBinding = () => liveBinding('plan', 'codebase');
    // Any candidate that requests `coding` must carry the implementation duty together with its
    // write-set source — that is the real shape, and it is what the freeze-time impact relevance
    // check reads as the target set (this CU fixture's shared contracts.yaml declares no files).
    if (['direct'].includes(mode) || codingFirst) {
      input.facts.push({ id: 'implementation:source', kind: 'implementation', applicability: 'required', reason: 'authorized source edit', basis: [codeBinding()] });
      // A Feature-target candidate must also declare where its acceptance comes from: D0.1 derives
      // unit/device applicability from the acceptance layering, and a candidate that binds no
      // acceptance source can only ever land `unknown` (it used to "pass" by self-reporting
      // `device-evidence: not_applicable`, which is precisely the wash D0.1 stops).
      // The shared CU fixture carries no acceptance content at all, so this scenario writes its
      // own unit-layer acceptance into the *temp* project root (the shared fixture is untouched).
      fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
        'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}]\n');
      const acceptanceBinding = liveBinding('ut', 'acceptance');
      input.facts.push({ id: 'acceptance:cu', kind: 'acceptance-context', applicability: 'required', reason: 'blueprint acceptance projection', basis: [acceptanceBinding], satisfied_by: [acceptanceBinding] });
    }
    // D0.1: pruning device verification needs a *sourced* impact judgement on the request, not a
    // self-reported `device-evidence: not_applicable` fact. The basis points at the real product
    // file, which is inside contracts.files, so the relevance check passes.
    if (['direct'].includes(mode) || codingFirst) {
      input.request.impact = { user_visible_behavior_change: false, reason: 'fixture impact requires unit verification only', basis: [codeBinding()] };
    }
    // `impact-reuse` is born WITH a judgement so the proposal below is a real correction; the
    // reused basis is what must be rejected. `impact-first` is born without one on purpose.
    if (['impact-reuse', 'impact-null'].includes(mode)) {
      input.request.impact = { user_visible_behavior_change: false, reason: 'birth: no user-visible change', basis: [codeBinding()] };
    }
    if (testingOnly) {
      // 设备失败夹具也必须有真实设备层验收；unknown 不应越过上游进入 testing。
      fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
        'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, desc: refresh ledger on device, expected_result: list refreshed}]\n');
      const acceptanceBinding = liveBinding('ut', 'acceptance');
      input.facts.push({ id: 'acceptance:cu', kind: 'acceptance-context', applicability: 'required', reason: 'existing device acceptance', basis: [acceptanceBinding], satisfied_by: [acceptanceBinding] });
    }
    if (!['direct'].includes(mode) && !requestOnly && !codingFirst && !testingOnly) input.facts.push({ id: 'device:pending', kind: 'device-evidence', applicability: 'unknown', reason: 'spec will determine device acceptance', basis: [] });
    if (preparedCandidate) {
      // 三种模式的**真实前置**（plan §3 问题 5 前置表，按生产判定推演，不是随手摆的）：
      //   · request-spec  ：验收缺失（正是本次要产出的）+ 设计来源可解析并已满足
      //                     （plan-only 语义下 wantsImplementation=false ⇒ feature-track.ts:427 的 designAvailable=true），
      //                     否则 execution-scope.ts:432 会把 plan 也加回 needed → 链变 [spec, plan]；
      //   · request-plan  ：验收有效 + **确无可解析设计来源**（contracts 存在即算设计已满足，files: [] 不够）；
      //   · request-coding：验收有效 + contracts 可解析 + 写集可绑定。
      const acceptanceFile = featureFilePath(root, feature, 'acceptance.yaml');
      const contractsPath = featureFilePath(root, feature, 'contracts.yaml');
      if (mode.startsWith('request-spec')) fs.rmSync(acceptanceFile, { force: true });
      else fs.writeFileSync(acceptanceFile, 'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}]\n');
      if (mode.startsWith('request-plan')) fs.rmSync(contractsPath, { force: true });
      // 候选由**生产入口**生成（不是手写进 feature.yaml）：完成终点、请求结果、请求动作三项输入由这里给，
      // 绑定 / 指纹 / 义务派生全部由 prepareFeatureScopeCandidate 完成。
      const prepareScope = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/scripts/goal-mode-entry.ts'),
        '--prepare-scope', '--completion-target', 'request', '--requested-phases', requestPhase,
        '--requested-results', 'requested-result', '--requirement', 'fixture delivery',
        '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
        { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } });
      assert.equal(prepareScope.status, 0, prepareScope.stderr + prepareScope.stdout);
      const projected = JSON.parse(prepareScope.stdout.slice(prepareScope.stdout.indexOf('{'))) as { phase_chain: string[] };
      // 生产候选自己算出来的链就必须是单阶段——断言打在**生产投影**上，不是测试自己拼的。
      assert.deepStrictEqual(projected.phase_chain, [requestPhase], prepareScope.stdout);
    } else {
      fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), YAML.stringify({ execution_scope: input }));
    }
    if (mode === 'direct') assert.deepStrictEqual(buildChangeUnitGoalHandoff(root, asChangeUnitArtifact(loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit)).expectedChain, [...(missingMapping ? ['plan'] : []), 'coding', 'review', 'ut']);
    if (!mode.startsWith('detached')) {
    const cli = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/scripts/goal-mode-entry.ts'), '--prepare-run', '--run-mode', 'attended', '--adapter', 'codex', '--feature', feature, '--run-id', 'p2-attended', '--requirement', 'fixture delivery', '--project-root', root, '--framework-root', frameworkRoot], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } }));
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    }
    if (mode === 'direct') {
      fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), 'track: lite\nexecution_scope: {broken candidate');
      source.auto_chain = [...source.auto_chain].reverse();
      fs.writeFileSync(path.join(frameworkRoot, 'workflows/scoped.workflow.yaml'), YAML.stringify(source));
    }
    let injected = false;
    let designGap = false;
    let codingRegression = false;
    const regressionReply = (phase: string): string => {
      const fence = String.fromCharCode(96).repeat(3);
      return phase === 'review' ? `${fence}issue-verification\n- issue: CR-CODING\n  verdict: confirmed\n  evidence: ${path.basename(codeFile)} | 补齐新验收所需实现\n${fence}\n`
        : '| id | status |\n|---|---|\n| end_to_end_driving | PASS |\n| business_assertion_value | PASS |\n';
    };
    let revokedRevisionIndex: number | undefined;
    let detachedStarted = false;
    let recoveryMarker: string | undefined;
    const writeImplementation = () => {
        if (utL3 && designGap && !fs.readFileSync(codeFile, 'utf8').includes('repairedTestabilitySeam')) fs.appendFileSync(codeFile, '\nexport function repairedTestabilitySeam(): string[] { return []; }\n');
        if (continuousCoding && codingRegression && !fs.readFileSync(codeFile, 'utf8').includes('repairedOwnerRegression')) fs.appendFileSync(codeFile, '\nexport const repairedOwnerRegression = true;\n');
        // `design-gap-revert`：第一轮 coding 误改（触发 plan 裁决），plan 拒绝扩展契约后
        // 第二轮 coding **把文件改回原字节**——这正是 §5.1.1a 要保护的闭环。
        if (mode === 'design-gap-revert') { if (designGap) fs.writeFileSync(codeFile, originalCode); else if (!fs.readFileSync(codeFile, 'utf8').includes('// unjustified edit')) fs.appendFileSync(codeFile, '\n// unjustified edit\n'); return; }
        if (mode === 'revision-revoke') {
          if (!fs.readFileSync(codeFile, 'utf8').includes('function refreshLedgerSnapshot')) fs.appendFileSync(codeFile, '\nexport function refreshLedgerSnapshot(): string[] { return []; }\n');
          return;
        }
        else if (['direct', 'design-gap'].includes(mode) && !fs.readFileSync(codeFile, 'utf8').includes('// authorized P2 implementation')) fs.appendFileSync(codeFile, '\n// authorized P2 implementation\n');
    };

    const writeTestabilityAudit = () => {
        if (!utL3) return;
        const acc = new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature).acceptance!;
        const fixed = fs.readFileSync(codeFile, 'utf8').includes('repairedTestabilitySeam');
        const selected = mode === 'ut-l3-spec' && !acc.criteria[0].device_focus ? 'option_a' : 'option_b';
        const audit = featureFilePath(root, feature, 'ut/testability-audit.md');
        fs.mkdirSync(path.dirname(audit), { recursive: true });
        fs.writeFileSync(audit, '```yaml\n' + YAML.stringify({ records: [{ acceptance_id: 'AC-REFRESH',
          entry_point: { file: codeRel, symbol: 'refreshLedgerSnapshot' }, testability_level: fixed ? 'L1' : 'L3',
          selected, verdict: fixed ? 'testable' : 'needs_seam', recommendation: { option_b: '补齐当前入口的最小接缝' } }] }) + '```\n');
    };

    const writeDesign = () => {
        if (utDesignGap) fs.writeFileSync(featureFilePath(root, feature, 'use-cases.yaml'), useCasesAtBirth);
        // `request-plan`：plan 阶段的真实产出就是设计契约——写出 contracts.yaml（含可核验写集），
        // 让生产的 `designScopeRevisionChecks` 有真实绑定可发布。`invalid` 变体故意产出不合法内容。
        if (!mode.startsWith('request-plan')) return;
        // 反向变体：plan 产出**不合法**的设计契约（YAML 都解析不了）——生产的能力解析拿不到可用绑定，
        // 设计检查因此发不出修订。拒绝发生在生产侧，不是夹具「不发」。
        if (invalidOutput) { fs.writeFileSync(contractsFile, 'files: [ {broken\n'); return; }
        fs.writeFileSync(contractsFile, YAML.stringify({ ...YAML.parse(contractsAtBirth.toString('utf8')), files: [codeRel] }));
    };

    const reviewImplementation = () => {
        if (!continuousCoding) return;
        const report = featureFilePath(root, feature, 'review/review-report.md');
        fs.mkdirSync(path.dirname(report), { recursive: true });
        if (!codingRegression) {
          fs.writeFileSync(report, '# Review\n## 问题清单\n当前实现尚无本轮新增缺陷。\n## 结论\n**审查结论**: 通过\n');
          return;
        }
        if (!fs.readFileSync(codeFile, 'utf8').includes('repairedOwnerRegression')) return;
        // The finite reviewer reads the repaired implementation and closes its own former finding.
        // A later raw PASS alone must never erase the saved negative review original.
        fs.writeFileSync(report,
          '# Review\n## 问题清单\n| 编号 | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |\n|---|---|---|---|---|---|\n'
          + `| CR-CODING | MAJOR | 逻辑错误 | ${codeRel} | 已读实现repairedOwnerRegression，原缺陷已修复 | 已关闭 |\n## 结论\n**审查结论**: 通过\n`);
    };

    const writeAcceptance = () => {
        if (mode === 'ut-l3-spec') {
          const file = featureFilePath(root, feature, 'acceptance.yaml');
          const acc = YAML.parse(fs.readFileSync(file, 'utf8'));
          acc.criteria[0].device_focus = 'AC-REFRESH 真机页面表现；unit 业务义务继续保留';
          fs.writeFileSync(file, YAML.stringify(acc));
          return;
        }

        // `spec-gap-revert`：责任阶段 spec 重跑时**修复触发文件**（补上被 review 指出的缺口），
        // 验收层级保持 unit——责任是补定义，不是把范围扩到设备验证。
        if (specGap) {
          if (continuousCoding === true) {
            fs.writeFileSync(featureFilePath(root, feature, 'spec/ref-elements.yaml'), 'elements: [{element_id: required-search, disposition: implement}]\n');
            return;
          }
          fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
            'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}, {id: AC-EMPTY, priority: P1, ut_layer: unit, desc: refresh with no entries, expected_result: empty state}]' + String.fromCharCode(10));
          return;
        }
        if (invalidOutput && requestOnly) { fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-BROKEN\n'); return; }
        if (mode === 'revision-revoke' && designGap) {
          fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, desc: new refreshLedgerSnapshot API returns the current ledger snapshot, expected_result: empty ledger returns an empty list}]' + String.fromCharCode(10));
          return;
        }
        fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, desc: device verification}]' + String.fromCharCode(10));
    };

    const preserveRepairOriginals = (reason: string, events: readonly unknown[]): string => {
      const runDir = featureFilePath(root, feature, 'goal-runs/p2-attended');
      const originals = [codeFile, featureFilePath(root, feature, 'context/facts.md'),
        featureFilePath(root, feature, 'feature-completion.json'), path.join(runDir, 'feature-completion.json'),
        ...['contracts.yaml', 'acceptance.yaml', 'use-cases.yaml'].map(name => featureFilePath(root, feature, name)),
        path.join(root, 'framework.config.json')];
      const pointer = featureFilePath(root, feature, 'feature-completion.json');
      if (fs.existsSync(pointer)) {
        const value = asRecord(JSON.parse(fs.readFileSync(pointer, 'utf8')));
        if (typeof value?.original_path === 'string') originals.push(path.resolve(root, value.original_path));
      }
      for (const phase of ['spec', 'plan', 'coding', 'review', 'ut']) for (const name of ['summary.json', 'script-report.json', 'phase-evidence-manifest.json']) {
        originals.push(featureFilePath(root, feature, `${phase}/reports/${name}`));
      }
      const authors = events.map(event => asRecord(event)).filter(event => event?.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
      for (const event of authors.slice(-2)) if (typeof event?.invoke_id === 'string') {
        const issued = executionRequestForInvoke(runDir, event.invoke_id);
        if (issued) originals.push(path.resolve(runDir, issued.reference.path));
      }
      return preserveRuntimeTestEvidence([root], reason, [], originals);
    };
    preserveFailure = reason => preserveRepairOriginals(reason,
      loadAuthoritativeEvents(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl')));
    if (mode === 'revision-precut') {
      const io = require('fs') as typeof import('fs'), append = io.appendFileSync;
      const eventFile = featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl');
      io.appendFileSync = (...args: Parameters<typeof fs.appendFileSync>) => {
        if (!injected && typeof args[0] === 'string' && path.resolve(args[0]) === path.resolve(eventFile) && typeof args[1] === 'string') {
          let type: unknown; try { type = JSON.parse(args[1]).type; } catch { /* Other original writes remain untouched. */ }
          if (type === 'scope_revised') {
            const before = loadAuthoritativeEvents(eventFile);
            assert(!before.some(event => event.type === 'scope_revised'), 'the original scope must remain unapplied at the cut');
            assert(before.filter(event => event.type === 'agent_invoke_start').every(start => before.some(event => event.type === 'agent_invoke_end'
              && event.invoke_id === start.invoke_id && invocationCompleted({ ...event, exitCode: event.exit_code }))), 'the cut requires genuinely returned native work');
            assert(before.filter(event => event.type === 'harness_start').every(start => before.some(event => event.type === 'harness_end'
              && event.invoke_id === start.invoke_id && typeof event.ts === 'string' && typeof start.ts === 'string' && event.ts >= start.ts)), 'the cut requires actual completed tools');
            assert(loadPhaseEvidenceManifest(root, feature, 'spec')?.integrityOk, 'the real producer manifest must exist before its scope publication fails');
            injected = true;
            throw new Error('injected pre-persistence scope cut');
          }
        }
        return append(...args);
      };
      restoreAppend = () => { io.appendFileSync = append; };
    }
    const execute = () => runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, checkFactsAdmission: true, resume: mode.startsWith('detached') && !detachedStarted ? undefined : 'p2-attended', runId: 'p2-attended', freshStartPhase: 'spec', freshEndPhase: 'spec', skipLegacySeal: true, viaHostBridge: !mode.startsWith('detached'), viaRuntimeClass: mode.startsWith('detached'), adapter: 'codex',
      testControl: !injected && (mode === 'revision-precut' || mode === 'revision-revoke' || mode.endsWith('-cut')) ? {
        expectedInterruption: mode === 'revision-precut' ? 'injected pre-persistence scope cut'
          : mode === 'revision-revoke' ? 'injected post-revocation cut' : 'injected revision cut:',
      } : undefined,
      launchCwd: ['successor', 'detached-harness', 'detached-explicit'].includes(mode) ? path.join(frameworkRoot, 'harness') : root,
      launchArgs: mode === 'detached-explicit' ? ['--project-root', root, '--framework-root', frameworkRoot] : undefined,
      // detached 分支不经 `--prepare-run` CLI，run 由这里直接创建：需求文本必须与候选
      // `requirement_basis` 同源，否则出生时会按 D0.2 provenance 判 stale 拒绝——这正是
      // 生产上「两步的 --requirement 不一致就不准出生」那条规则，夹具不得绕开。
      ...(mode.startsWith('detached') ? { freshRequirement: 'fixture delivery' } : {}),
      // design-gap also edits the file: the revision it then proposes must carry a *new* sourced
      // fact (goal-phase-runtime.ts:9084), which an unchanged file cannot provide now that the
      // birth candidate already binds the same codebase source.
      onAuthor: (_ctx, context) => {
        const current = loadEffectiveExecutionScope(root, feature, context.runId)!;
        const acceptanceFile = featureFilePath(root, feature, 'acceptance.yaml');
        const actualSpecGap = specGap && !utL3 && !continuousCoding && designGap && !fs.readFileSync(acceptanceFile, 'utf8').includes('AC-EMPTY');
        if (mode !== 'unresolved' && (current.phase_chain.includes('spec') || actualSpecGap)) writeAcceptance();
        if (current.phase_chain.includes('plan') || utDesignGap && designGap && !fs.existsSync(featureFilePath(root, feature, 'use-cases.yaml'))) writeDesign();
        if (current.obligations.some(item => item.kind === 'implementation' && item.applicability === 'required') && context.runtimeFacts.runBaseSha) writeImplementation();
        const signedFacts = context.factsContext;
        assert(signedFacts, 'the unit author must consume its actual admitted facts context');
        const admitted = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature,
          phase: signedFacts.first_phase, purpose: 'work-unit-author', featuresDir: relFeaturesDir(root),
          goalRunId: context.runId, goalAttemptId: context.attemptId }).factsContext;
        assert(admitted && admitted.first_phase === signedFacts.first_phase, 'current research must be admitted through the original immutable owner and request');
        const factsFile = featureFilePath(root, feature, 'context/facts.md');
        if (!fs.existsSync(factsFile)) {
          assert(!admitted.baseline, 'a missing historical baseline cannot be recreated by the author fixture');
          const read = admitted.source_paths.filter(file => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile());
          for (const file of read) fs.readFileSync(path.join(root, file));
          fs.mkdirSync(path.dirname(factsFile), { recursive: true });
          fs.writeFileSync(factsFile, '---\n' + YAML.stringify({ schema_version: '1.1', feature, run_id: context.runId,
            established_by: admitted.first_phase, ready_to_produce: read.length === admitted.source_paths.length,
            has_blocker_coverage_risk: read.length !== admitted.source_paths.length, exploration_mode: 'sequential',
            source_code_paths: read, key_inputs_read: read, files_inspected_count: read.length, searches_performed_estimate: 0,
            decisions_unlocked: ['read the actual source inputs of the current request'] }) + '---\n');
        }
        const actualSource = fs.readFileSync(codeFile), sourceHash = createHash('sha256').update(actualSource).digest('hex');
        const sourceObservation = `已完整读取 ${codeRel} sha256=${sourceHash}`;
        const alreadyRead = fs.readFileSync(factsFile, 'utf8').includes(sourceObservation);
        if (!alreadyRead) researchSnapshotFacts(root, factsFile, admitted.first_phase, admitted);
        for (const family of context.chain) if (family !== admitted.first_phase) researchSnapshotFacts(root, factsFile, family, admitted);
        if (!alreadyRead) fs.appendFileSync(factsFile, `\n## phase_delta: ${admitted.first_phase}\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| ${codeRel} | ${sourceObservation}；${actualSource.toString('utf8').trim().split(/\r?\n/).at(-1)!.replace(/\|/g, '/')} | 按实际当前源码重建本单元研究，原准入与baseline不改写 |\n`);
      },
      onHarnessSummary: ({ phase }) => {
        if (mode === 'design-gap-revert' && phase === 'coding' && designGap && !fs.readFileSync(codeFile).equals(originalCode)) {
          const bytes = fs.readFileSync(codeFile);
          return { checks: [{ id: 'scope_spec_invalidated', category: 'structure', description: '保留原契约并撤回无依据的源码扩展', severity: 'BLOCKER', status: 'FAIL',
            details: 'plan 已保留原冻结契约；当前源码仍带无依据改动，须由原单元作者恢复原允许内容后复验。', repair_owner: 'coding', affected_files: [codeRel],
            structured: { source_attempt_dependencies: [{ path: codeRel, exists: true, sha256: createHash('sha256').update(bytes).digest('hex'), role: 'artifact' }] } }] };
        }
        if (specGap && !utL3 && !continuousCoding && phase === 'spec' && designGap) {
          const file = featureFilePath(root, feature, 'acceptance.yaml'), bytes = fs.readFileSync(file);
          if (!bytes.toString('utf8').includes('AC-EMPTY')) return { checks: [{ id: 'scope_spec_invalidated', category: 'structure',
            description: '当前验收须实际覆盖刷新后的空列表分支', severity: 'BLOCKER', status: 'FAIL', details: '当前验收仍缺 AC-EMPTY；须按原已确认评审问题补齐定义后复验。',
            structured: { source_attempt_dependencies: [{ path: path.relative(root, file).replace(/\\/g, '/'), exists: true,
              sha256: createHash('sha256').update(bytes).digest('hex'), role: 'artifact' }] } }] };
        }
        if (phase === 'review') reviewImplementation();
        if (phase === 'ut') writeTestabilityAudit();
        if (utL3 && phase === 'ut') {
          designGap = true;
          const ctx = { projectRoot: root, frameworkRoot, feature, phaseRule: {},
            featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature) } as CheckContext;
          const audit = inspectTestabilityAudit(ctx);
          return { checks: [...checkUtTestabilityAuditPresent(ctx, audit), ...checkUtUnsupportedTargetsHandled(ctx, audit)] };
        }

        if (utDesignGap && (phase === 'ut' || continuousCoding && designGap && phase === 'plan')) {
          const useCasesFile = featureFilePath(root, feature, 'use-cases.yaml');
          if (!designGap) {
            designGap = true;
            fs.rmSync(useCasesFile, { force: true });
          }
          const checks = checkChangeUnitFeatureProjection({ projectRoot: root, frameworkRoot, feature, phaseRule: {},
            featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature) } as CheckContext, phase);
          const defect = checks.find((check): check is CheckResult & { structured?: Record<string, unknown> } => check.id === 'change_unit_use_cases_required');
          if (defect) {
            assert(defect.status === 'FAIL' && (phase === 'plan' || defect.repair_owner === 'plan'), JSON.stringify(checks));
            if (phase === 'plan') {
              assert(!fs.existsSync(useCasesFile), 'the failed Plan producer must bind the actual missing file it read');
              return { checks: [{ ...defect, structured: { ...defect.structured, source_attempt_dependencies: [{
                path: path.relative(root, useCasesFile).replace(/\\/g, '/'), exists: false, sha256: null, role: 'artifact',
              }] } }] };
            }
            return { checks: [defect] };
          }
          assert(fs.existsSync(useCasesFile), 'only an actually restored use-case can clear its real missing-definition check');
        }

        if (continuousCoding && !fs.readFileSync(codeFile, 'utf8').includes('repairedOwnerRegression')
          && ((specGap && designGap && phase === 'review') || (utDesignGap && designGap && phase === 'ut') || (continuousCoding === 'request' && phase === 'ut'))) {
          if (!codingRegression) {
            if (continuousCoding !== 'request') {
              const events = loadAuthoritativeEvents(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'));
              const returnedAt = events.map(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author' && event.exit_code === 0).lastIndexOf(true);
              const priorFailureAt = events.findIndex(event => event.type === 'harness_end' && event.phase === (utDesignGap ? 'ut' : 'review') && event.exit_code === 1);
              const ownerCheckedAt = events.map(event => event.type === 'harness_end' && event.phase === (utDesignGap ? 'plan' : 'spec') && event.exit_code === 0).lastIndexOf(true);
              const codingCheckedAt = events.map(event => event.type === 'harness_end' && event.phase === 'coding' && event.exit_code === 0).lastIndexOf(true);
              const currentCoding = readReusableCheckResult({ projectRoot: root, frameworkRoot, feature, phase: 'coding', runId: 'p2-attended' });
              const recordedScope = utDesignGap ? resolveEffectiveScopeSource(root, feature, 'p2-attended')!.scope : undefined;
              const scopeIssues = recordedScope ? executionScopeEvidenceIssues(root, feature, recordedScope, undefined, 'p2-attended', undefined, frameworkRoot) : [];
              const codingProblems = recordedScope ? resolveCurrentDisposition(readCurrentDispositionInput({ projectRoot: root, frameworkRoot, feature,
                executionScope: recordedScope, runId: 'p2-attended', chain: ['coding'], currentResults: currentCoding ? [currentCoding] : [] }))
                .completionBlocking.filter(problem => problem.phase === 'coding') : [];
              assert(priorFailureAt >= 0 && returnedAt >= 0 && ownerCheckedAt > priorFailureAt && ownerCheckedAt > returnedAt
                && codingCheckedAt > (utDesignGap ? priorFailureAt : ownerCheckedAt) && asRecord(currentCoding?.summary)?.verdict === 'PASS'
                && scopeIssues.length === 0 && codingProblems.length === 0,
                '新回归前必须有原失败后实际执行且对当前完整输入/失效时间仍合格的coding证明，旧报告或阶段排序不能代替资格核验：'
                + JSON.stringify({ priorFailureAt, returnedAt, ownerCheckedAt, codingCheckedAt, scopeIssues, codingProblems }));
            }
            codingRegression = true;
          }
          const checks: CheckResult[] = phase === 'review' ? [
            { id: 'conclusion_with_verdict', category: 'structure', description: 'report valid', severity: 'BLOCKER', status: 'PASS', details: '报告合法' },
            { id: 'negative_verdict_closure', category: 'structure', description: 'functional regression', severity: 'BLOCKER', status: 'FAIL', details: '功能缺陷仍未修复' },
          ] : [ { id: 'ut_hvigor_build', category: 'structure', description: 'compiled', severity: 'BLOCKER', status: 'PASS', details: '真实编译层的替身结果' },
            { ...UT_REAL_ASSERTION_CHECK, category: 'structure', description: '生产格式器与归因的真实断言失败' } as CheckResult ];
          const dir = featureFilePath(root, feature, `${phase}/reports`); fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'ai-prompt.md'), 'Review current functional defect and actual assertion semantics.');
          if (phase === 'review') fs.writeFileSync(featureFilePath(root, feature, 'review/review-report.md'),
            `## 问题清单\n| 编号 | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |\n|---|---|---|---|---|---|\n| CR-CODING | MAJOR | 逻辑错误 | ${codeRel} | 补齐新验收所需实现 | 未关闭 |\n## 结论\n**审查结论**: 不通过`);
          const plan = { mode: 'enabled' as const, reason: 'policy_required' as const, verifier_prompt: `prompts/verify-${phase}.md`, message: 'existing verifier path' };
          const report = { phase, feature, timestamp: new Date().toISOString(), project_root: root, assurance: 'full', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
            checks, summary: { total: checks.length, pass: checks.length - 1, fail: 1, warn: 0, skip: 0, blockers: 1, verdict: 'FAIL' } } as import('../../scripts/utils/types').ScriptReport;
          fs.writeFileSync(path.join(dir, 'script-report.json'), JSON.stringify(report));
          const writerOptions = prepareFixtureVerifierMaterial({ projectRoot: root, frameworkRoot, report, options: { verifierPlan: plan } });
          const summary = writeRunSummaryBase(root, report, frameworkRoot, writerOptions);
          fs.writeFileSync(path.join(root, summary.verifier_report!), regressionReply(phase) + renderResultBlock(summary.verifier_subject_id!, 'PASS', 0));
          if (phase === 'review') {
            const responsibility = repairResponsibilityContext({ projectRoot: root, frameworkRoot, feature, runId: 'p2-attended', currentPhase: phase });
            const targets = resolveRepairResponsibility({ ...responsibility, target: { files: [codeRel] } });
            assert.equal(targets.owner, 'coding', JSON.stringify({ codeRel, targets, sourceDomains: responsibility.contracts?.domains.filter(domain => domain.kind === 'source') }));
          }
          return { checks, writerOptions };
        }
        if (continuousCoding && codingRegression && phase === 'review' && fs.readFileSync(codeFile, 'utf8').includes('repairedOwnerRegression')) {
          const reviewOriginal = featureFilePath(root, feature, 'review/review-report.md');
          assert(fs.existsSync(reviewOriginal), 'finite re-review requires its actual author original: ' + JSON.stringify({ mode,
            starts: loadAuthoritativeEvents(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'))
              .filter(event => event.type === 'agent_invoke_start').map(event => [event.phase, event.invoke_id]),
          }));
          const reviewText = fs.readFileSync(reviewOriginal, 'utf8');
          if (specGap) assert(reviewText.includes('CR-CODING') && reviewText.includes('已关闭'), '有限重审必须先更新原缺陷报告，不能用raw PASS抹旧FAIL');
          // UT 来源没有 CR-CODING review 发现；独立重核实际新实现，不能虚构一条已关闭发现。
          const reviewed = specGap ? reviewText : `已读取当前实现 ${codeRel}：\n${fs.readFileSync(codeFile, 'utf8')}\n原UT发现仍须回UT实际复验。`;
          const checks: CheckResult[] = [
            { id: 'conclusion_with_verdict', category: 'structure', description: 'finite reviewer read the repaired implementation', severity: 'BLOCKER', status: 'PASS', details: reviewed },
            { id: 'negative_verdict_closure', category: 'structure', description: 'actual re-review preserves the original finding responsibility', severity: 'BLOCKER', status: 'PASS', details: reviewed },
          ];
          const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'review', feature, root, checks, frameworkRoot);
          const writerOptions = prepareFixtureVerifierMaterial({ projectRoot: root, frameworkRoot, report, options: { verifierPlan: {
            mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-review.md', message: 'actual independent re-review' } } });
          const summary = writeRunSummaryBase(root, report, frameworkRoot, writerOptions);
          const { publishFixtureVerifierEvidence } = require('../utils/verifier-evidence-fixture') as typeof import('../utils/verifier-evidence-fixture');
          publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: featureFilePath(root, feature, 'review/reports'), feature, phase,
            subjectId: summary.verifier_subject_id!, reportText: '# Independent re-review\n' + reviewed, skipSummaryPatch: true });
          return { checks, writerOptions };
        }
        if (missingMapping && phase === 'plan') {
          const checks = checkChangeUnitFeatureProjection({ projectRoot: root, frameworkRoot, feature, phaseRule: {},
            featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature) } as CheckContext, 'plan');
          assert(checks.some(check => check.status === 'FAIL' && check.id === 'change_unit_predicate_mapping_missing'), JSON.stringify(checks));
          return { checks };
        }
        // Three shapes of "not a new fact": a plain blocker, an offline device and a human-only
        // verdict. None of them may produce a revision (D2.3: PASS/FAIL never drives scope).
        if (mode === 'testing-fail') return { checks: [{ id: 'device_result_failed', category: 'structure', description: 'device evidence failed', severity: 'BLOCKER', status: 'FAIL', details: 'observed failure', suggestion: 'repair the actual failure' }] };
        if (mode === 'testing-offline') return { checks: [{ id: 'device_available', category: 'structure', description: 'device is offline', severity: 'BLOCKER', status: 'FAIL', details: 'no device attached', failure_kind: 'device_offline', blocking_class: 'external_blocked', actionability: 'human_only', suggestion: 'attach a device' }] };
        if (mode === 'testing-manual') return { checks: [{ id: 'device_result_manual', category: 'structure', description: 'verification needs a human', severity: 'BLOCKER', status: 'FAIL', details: 'manual verification required', failure_kind: 'manual_verification_required', actionability: 'human_only', suggestion: 'verify on a real device' }] };
        // `revision-revoke`: a SECOND revision, proposed after spec already closed and revision #1
        // attached its closure evidence. It withdraws that proof — the historical PASS must not be
        // re-attached, and (combined with the cut below) must not survive recovery either.
        if (mode === 'revision-revoke' && phase === 'spec' && designGap) {
          const source = fs.readFileSync(codeFile, 'utf8');
          const acceptance = featureFilePath(root, feature, 'acceptance.yaml');
          const defined = fs.readFileSync(acceptance, 'utf8');
          if (source.includes('refreshLedgerSnapshot') && !defined.includes('refreshLedgerSnapshot')) {
            const revision = request(['spec', 'coding', 'review', 'ut', 'testing'], 'feature');
            revision.facts.push(
              { id: 'design:new-api', kind: 'design-decision', applicability: 'required', reason: '当前作者已实际增加公开接口', basis: [liveBinding('plan', 'codebase')] },
              { id: 'acceptance-context:request:spec', kind: 'acceptance-context', applicability: 'required', reason: '新事实使已闭环的 spec 证据失效', basis: [liveBinding('ut', 'acceptance')] });
            return { checks: [{ id: 'scope_spec_invalidated', category: 'structure', description: '新增真实API尚无当前验收定义', severity: 'BLOCKER', status: 'FAIL',
              details: '源码已有refreshLedgerSnapshot，当前acceptance未覆盖该API的空列表行为。', repair_owner: 'spec',
              affected_files: [path.relative(root, acceptance).split(path.sep).join('/')], scope_revision_input: revision }] };
          }
        }
        if (mode === 'revision-revoke' && phase === 'coding' && !designGap) {
          designGap = true;
          assert(!fs.readFileSync(codeFile, 'utf8').includes('function refreshLedgerSnapshot'), 'the old spec proof must precede the actual new API');
          return { checks: [{ id: 'scope_spec_invalidated', category: 'structure', description: '原请求的新增API尚未实现', severity: 'BLOCKER', status: 'FAIL',
            details: '当前批准实现面尚无refreshLedgerSnapshot；先由原单元作者实际实现，再按真实源码补验收定义。', repair_owner: 'coding', affected_files: [codeRel] }] };
        }
        // `spec-gap-revert` 的触发者是 **review 的 spec 归属发现**：finding 指向 feature 自己的
        // `acceptance.yaml`（`deriveCategoryFromFiles` 按路径域判 spec，且全部文件同域才产候选），
        // verifier 逐条确认之后，**用生产函数**把候选变成修订输入——不手拼 revision。
        if (specGap && !utL3 && phase === 'review' && !designGap) {
          designGap = true;
          const issueId = 'CR-SPEC-001';
          const triggerRel = path.relative(root, featureFilePath(root, feature, continuousCoding === true ? 'spec/ref-elements.yaml' : 'acceptance.yaml')).split(String.fromCharCode(92)).join('/');
          const fix = continuousCoding === true ? '必需搜索被错误登记 defer，需 spec 更正有效范围' : '验收缺少刷新后的空列表定义，需 spec 补';
          const NL = String.fromCharCode(10);
          const reviewReportText = [
            '# Review 报告', '', '## 问题清单', '',
            '| ID | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |', '|---|---|---|---|---|---|',
            `| ${issueId} | MAJOR | 逻辑错误 | ${triggerRel} | ${fix} | 未关闭 |`, '',
            '## 结论', '', '结论：不通过', '',
          ].join(NL);
          const verifierReportText = ['# Verifier 报告', '', '```issue-verification', `- issue: ${issueId}`, '  verdict: confirmed', `  evidence: ${triggerRel} ${fix}`, '```', ''].join(NL);
          const candidates = buildSummaryRepairCandidates({ phase: 'review', reportValidity: 'PASS', reviewReportText, verifierReportText, checks: [] });
          assert.deepStrictEqual(candidates.map(candidate => [candidate.id, candidate.category, candidate.source_phase]), [[issueId, 'spec', 'review']], JSON.stringify(candidates));
          const produced = scopeRevisionInputFromRepairCandidates(candidates, { projectRoot: root, frameworkRoot, feature, runId: 'p2-attended' });
          assert(produced, '生产函数没有从真实 spec 归属候选产出修订输入');
          assert(produced!.input.facts.some(fact => fact.id === `acceptance-definition:${issueId}`), JSON.stringify(produced!.input.facts.map(fact => fact.id)));
          return { checks: [{ id: 'issue_table_format', category: 'structure', description: 'review finding needs the spec owner', severity: 'BLOCKER', status: 'FAIL', details: fix, suggestion: 'return to spec owner', scope_revision_input: produced!.input }] };
        }
        if (utDesignGap || !designGapFamily || phase !== 'coding' || designGap) return null;
        designGap = true;
        // 触发走**真实归属链**（第八轮必修 2）：check-coding 的 `ui_diff_within_declared_files`
        // 带机器归因 `ui_scope_violation` → 既有注册表判 plan → `buildSummaryRepairCandidates`
        // → `scopeRevisionInputFromRepairCandidates` 产出修订输入。不再手拼 revision：
        // 修订的 request / facts / 绑定全部由生产函数算，impact 由它自己从有效范围继承。
        const violationDetails = `coding 改动超出 plan 冻结的 UI scope 白名单：${codeRel}`;
        const codingCandidates = buildSummaryRepairCandidates({
          responsibility: { projectRoot: root, frameworkRoot, feature, runId: 'p2-attended', currentPhase: 'coding' },
          phase: 'coding', reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
          checks: [{ id: 'ui_diff_within_declared_files', status: 'FAIL', severity: 'BLOCKER', details: violationDetails, failure_kind: 'ui_scope_violation', affected_files: [codeRel] }],
        });
        assert.deepStrictEqual(codingCandidates.map(candidate => [candidate.category, candidate.source_phase]), [['plan', 'coding']], JSON.stringify(codingCandidates));
        assert(codingCandidates[0].files.some(file => file.endsWith('contracts.yaml')) && !codingCandidates[0].files.includes(codeRel), 'machine cause must target the plan producer, not the diagnosis source file');
        const codingRevision = scopeRevisionInputFromRepairCandidates(codingCandidates, { projectRoot: root, frameworkRoot, feature, runId: 'p2-attended' });
        assert(codingRevision, '真实 plan 归属候选没有产出修订输入');
        assert(codingRevision!.input.facts.some(fact => fact.kind === 'design-decision'), JSON.stringify(codingRevision!.input.facts.map(fact => fact.id)));
        assert(codingRevision!.input.request.requested_phases.includes('plan'), JSON.stringify(codingRevision!.input.request.requested_phases));
        return { checks: [{ id: 'ui_diff_within_declared_files', category: 'structure', description: 'coding changed a file outside the frozen UI scope', severity: 'BLOCKER', status: 'FAIL', details: violationDetails, failure_kind: 'ui_scope_violation', suggestion: 'return to plan owner', scope_revision_input: codingRevision!.input }] };
      },
      onOutOfChain: continuousCoding ? ctx => {
        const request = parseVerifierRequest(ctx.prompt.slice(ctx.prompt.lastIndexOf('\n{') + 1));
        assert(request && request.feature === feature && ['review', 'ut'].includes(request.phase), '模型只响应实际当前返修核实request');
        const summary = JSON.parse(fs.readFileSync(featureFilePath(root, feature, `${request.phase}/reports/summary.json`), 'utf8'));
        assert.equal(summary.verifier_subject_id, request.subject_id, '不得回答旧subject');
        fs.readFileSync(path.resolve(root, request.prompt_path), 'utf8');
        fs.writeFileSync(path.resolve(root, summary.verifier_report), regressionReply(request.phase) + renderResultBlock(request.subject_id, 'PASS', 0));
      } : undefined,
      afterHarnessPass: ({ phase, runId }) => {
        // `spec-gap-revert`：spec 修复了触发文件之后，必须把**真实验收输入**重新绑定到新内容
        // ——这正是生产里 R3（`designScopeRevisionChecks`）经 spec 的 script-report 发布新设计
        // 内容的那一步。§5.1.1a 的豁免只对**触发依据**那两个 kind 生效，真实设计输入一行不放宽，
        // 所以不重绑就会（正确地）判 `input binding stale`、完不成。
        if ((specGap || mode === 'revision-revoke' && designGap) && phase === 'spec') {
          const freshAcceptance = liveBinding('ut', 'acceptance');
          const current = loadEffectiveExecutionScope(root, feature, runId)!;
          const revision = request(specGap ? ['coding', 'review', 'ut'] : ['coding', 'review', 'ut', 'testing'], 'feature');
          revision.request.impact = input.request.impact;
          revision.facts = current.obligations.map(obligation => {
            const copy = structuredClone(obligation) as typeof revision.facts[number] & { satisfied_by?: unknown[] };
            if (!obligation.basis.some(binding => binding.input_id === 'acceptance')) return copy;
            copy.basis = [freshAcceptance];
            if (copy.satisfied_by?.length) copy.satisfied_by = [freshAcceptance];
            return copy;
          }) as typeof revision.facts;
          fs.writeFileSync(featureFilePath(root, feature, 'spec/reports/script-report.json'), JSON.stringify({ checks: [{ id: 'spec_scope_facts', status: 'PASS', scope_revision_input: revision }] }));
          return;
        }
        // R5：单职责 spec/plan 的成功终局——把本阶段真实产出经**生产的 `designScopeRevisionChecks`**
        // 发布成 `scope_revision_input`（与生产上 check-spec / check-plan 调用的是同一个函数），
        // 由既有修订链关闭出生时的定义缺口。修订内容不是这里手拼的。
        if (requestOnly && phase === requestPhase && preparedCandidate && requestPhase !== 'coding') {
          // 入参走**生产的统一入口** `resolveCapabilityResolutionEntryInput`（与 check-spec / check-plan 同源），
          // 不手拼 inputContext/factsContext——手拼的身份绑定过不了 capability-resolution 的 schema 与 subject 校验。
          const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase, featuresDir: relFeaturesDir(root), goalRunId: runId });
          const resolvedInputs = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase, track: 'full', ...bridge }).inputs!;
          const produced = designScopeRevisionChecks({
            projectRoot: root, frameworkRoot, feature, phase,
            featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, resolvedInputs),
            resolvedInputs, factsContext: bridge.factsContext,
          } as never, []);
          const revisionCheck = produced.find(check => (check as { scope_revision_input?: unknown }).scope_revision_input);
          // 反向变体：产出不合法时**这同一个生产检查**必须发不出修订（第二轮建议 1：原先直接 return，
          // 只证明了「没有修订就保持 HALTED」，没证明生产检查会拒绝不合法产出）。不发布任何报告。
          if (invalidOutput) {
            assert(!revisionCheck, '不合法产出仍被生产设计检查发成修订：' + JSON.stringify(produced));
            return;
          }
          assert(revisionCheck, '生产设计检查未发布 scope_revision_input：' + JSON.stringify(produced));
          fs.writeFileSync(featureFilePath(root, feature, `${phase}/reports/script-report.json`), JSON.stringify({ checks: [revisionCheck] }));
          return;
        }
        if (phase !== 'spec' || ['direct', 'unresolved'].includes(mode) || requestOnly || codingFirst || testingOnly) return;
        // spec just rewrote acceptance.yaml — take the binding from the production resolver so its
        // fingerprint is the SpecLoader-parsed one the freeze-time re-resolve will recompute.
        const fresh = liveBinding('ut', 'acceptance');
        const revision = request(['coding', 'review', 'ut', 'testing'], 'feature');
        revision.facts.push(...input.facts.filter(fact => fact.kind === 'design-context'),
          { id: 'device:pending', kind: 'device-evidence', applicability: 'required', reason: 'spec produced device acceptance', basis: [fresh] });
        // R4 反例（第七轮阻断 2）：修订输入里夹一条**手写的** acceptance-context unknown，
        // 而验收产物此刻确实在场。它必须在 runtime 的修订路径上被按来源重算回 required；
        // 否则会凭空造出一个 spec 缺口，把下游全部挂进 needed_by、链形状当场改变。
        if (mode === 'revision' || mode === 'revision-cut') revision.facts.push({ id: 'acceptance-context:fake-gap', kind: 'acceptance-context', applicability: 'unknown', reason: '手写的假缺口', basis: [fresh], satisfied_by: [fresh] });
        // `impact-first`: the effective scope has NO impact yet, so supplying one is a correction by
        // definition — with its own new source it must be accepted (and must not crash on the
        // missing old value). `impact-reuse`: a correction that reuses the birth basis while some
        // OTHER fact is new — it must be rejected, credibility is not transferable.
        if (mode === 'impact-first') {
          // The impact is judged against a real target set, so the proposal declares the write set
          // it is talking about (D0.1 rule (a): an implementation duty must name one).
          revision.facts.push({ id: 'implementation:source', kind: 'implementation', applicability: 'required', reason: 'spec 指认的实现面', basis: [liveBinding('plan', 'codebase')] });
          revision.request.impact = { user_visible_behavior_change: true, reason: 'spec found a user-visible change', basis: [liveBinding('plan', 'codebase')] };
        }
        if (mode === 'impact-reuse') revision.request.impact = { user_visible_behavior_change: true, reason: 'correction without its own source', basis: [liveBinding('plan', 'codebase')] };
        // An explicit null is a malformed judgement, not an absent one: inheriting it silently would
        // skip every structural check on a scope that already carries a valid judgement.
        if (mode === 'impact-null') (revision.request as { impact?: unknown }).impact = null;
        fs.writeFileSync(featureFilePath(root, feature, 'spec/reports/script-report.json'), JSON.stringify({ checks: [{ id: 'spec_scope_facts', status: 'PASS', scope_revision_input: revision }] }));
      },
      // D2: the only run-internal cut is 'revision applied'. `revision-precut` (interrupt BEFORE
      // the revision is validated) is injected through onHarnessSummary, which fires earlier.
      onScopeRevision: boundary => {
        if (!recoveryMarker) {
          recoveryMarker = codingBasePath(root, feature, 'p2-attended');
          fs.mkdirSync(path.dirname(recoveryMarker), { recursive: true }); fs.writeFileSync(recoveryMarker, '{}');
        }
        // `*-cut`：修订已落盘、`run_end` 之前中断——resume 必须仍能判出本阶段已 PASS。
        if (!injected && (mode === 'revision-cut' || mode.endsWith('-cut'))) { injected = true; throw new Error('injected revision cut: ' + boundary); }
        // A proof-only publication can precede the actual source change. Cut at the real
        // withdrawal of the closed Spec proof, never at a particular event count.
        if (!injected && mode === 'revision-revoke') {
          const sourceEvents = loadAuthoritativeEvents(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'));
          const birth = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
          const revisions = loadScopeRevisions(sourceEvents, birth), latest = revisions.at(-1);
          const previous = revisions.at(-2)?.execution_scope ?? birth;
          const withdrewSpec = latest && previous.obligations.some(obligation => obligation.owner_phase === 'spec'
            && obligation.satisfied_by?.length && !latest.execution_scope.obligations.find(next => next.id === obligation.id)?.satisfied_by?.length);
          const originalSpecAt = sourceEvents.findIndex(event => event.type === 'harness_end' && event.phase === 'spec' && event.exit_code === 0);
          const changedSource = originalSpecAt >= 0 && sourceEvents.slice(originalSpecAt + 1).some(event => {
            const owned = asRecord(event)?.owned;
            return event.type === 'phase_write_observed' && Array.isArray(owned) && owned.some(value => {
              const write = asRecord(value);
              return write?.path === codeRel && write.pre_sha256 !== write.post_sha256;
            });
          });
          if (latest && withdrewSpec && changedSource) {
            revokedRevisionIndex = latest.revision_index;
            injected = true; throw new Error('injected post-revocation cut');
          }
        }
      },
    });
    let probe: Awaited<ReturnType<typeof execute>>;
    try { probe = await execute(); } catch (error) {
      if (!injected) {
        try {
          const events = loadAuthoritativeEvents(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'));
          console.log('SCOPE_UNIT_CAUGHT_DIAGNOSTIC ' + JSON.stringify({ mode, error: String(error),
            authorCalls: events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length,
            lastEvents: events.slice(-5) }));
          console.log('SCOPE_UNIT_ORIGINALS ' + preserveRepairOriginals('unexpected same-unit repair exception', events));
        } catch (captureError) { console.warn('SCOPE_UNIT_PRESERVATION_FAILED ' + String(captureError)); }
        throw error;
      }
      probe = await execute();
    }
    if (probe.exitCode !== 0 && injected) probe = await execute();
    if (utL3) {
      assert.equal(probe.exitCode, 0, JSON.stringify(probe.events.slice(-6)));
      const checked = probe.harnessPhases;
      assert(checked.filter(phase => phase === 'coding').length >= 2, JSON.stringify(checked));
      assert(checked.lastIndexOf('ut') > checked.lastIndexOf('coding'), JSON.stringify(checked));
      if (mode === 'ut-l3-spec') assert(checked.includes('spec') && probe.events.some(event => event.type === 'scope_revised'), '链外 spec 未实际验证');
      assert.equal(new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature).acceptance!.criteria[0].ut_layer, 'unit', '不得自批降低验收');
      assert(fs.readFileSync(codeFile, 'utf8').includes('repairedTestabilitySeam'));
      return;
    }
    if (continuousCoding) {
      const events = probe.events;
      const authorStarts = events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
      console.log('SCOPE_UNIT_DIAGNOSTIC ' + JSON.stringify({ mode, runId: 'p2-attended', exitCode: probe.exitCode,
        authorCalls: authorStarts.length, authorIds: authorStarts.map(event => event.invoke_id),
        sourceSha256: createHash('sha256').update(fs.readFileSync(codeFile)).digest('hex'),
        lastEvents: events.slice(-5) }));
      if (continuousCoding === true && probe.exitCode !== 0) {
        console.log('SCOPE_UNIT_ORIGINALS ' + preserveRepairOriginals('current same-unit repair did not complete', events));
      }
      try {
      if (continuousCoding === 'request') {
        assert.notEqual(probe.exitCode, 0, 'request-only 不能获得 coding 权限');
        assert(!events.some(event => event.type === 'scope_revised'), 'request-only 发生越权修订');
        const refusal = events.find(event => event.type === 'phase_halt' && typeof event.halt_guidance === 'string'
          && event.halt_guidance.includes('request-scope revision cannot add phases'));
        assert(refusal && typeof refusal.halt_guidance === 'string' && refusal.halt_guidance.includes('新请求授权'), `须明确原授权拒绝与解除条件，不能以技术异常或任意非0放行：${JSON.stringify(events.slice(-5))}`);
        assert(events.some(event => event.type === 'harness_end' && event.phase === 'ut' && event.exit_code === 1)
          && events.some(event => event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'FAIL'), '真实UT失败须先留下其原检查与裁决，授权拒绝不能代签检查');
        assert.equal(events.filter(event => event.type === 'run_end').at(-1)?.status, 'HALTED', '领域拒绝不能变uncaught_exception/INTERRUPTED');
        assert(!events.some(event => event.type === 'harness_start' && event.phase === 'coding'), '请求范围外coding检查不能先运行后补拒绝');
        assert(fs.readFileSync(codeFile).equals(originalCode), '原request没有产品coding写权，单元作者不得先改产品再补拒绝');
        assert.equal(executionScopeFingerprint(loadEffectiveExecutionScope(root, feature, 'p2-attended')!),
          executionScopeFingerprint(loadFrozenExecutionScope(root, feature, 'p2-attended')!), '拒绝后原冻结权限与义务不变');
        return;
      }
      assert.equal(probe.exitCode, 0, JSON.stringify(events.slice(-5)));
      assert(codingRegression && fs.readFileSync(codeFile, 'utf8').includes('repairedOwnerRegression'), 'coding 责任方没有真实修复：' + JSON.stringify({
        codingRegression,
        verdicts: events.filter(event => event.type === 'phase_verdict').map(event => ({ phase: event.phase, invoke_id: event.invoke_id,
          verdict: event.verdict, action: event.action, recommendation: event.assess_recommendation })),
        revisions: events.filter(event => event.type === 'scope_revised').map(event => ({ trigger: event.trigger,
          chain: (event.execution_scope as ExecutionScope).phase_chain,
          implementation: (event.execution_scope as ExecutionScope).obligations.filter(fact => fact.kind === 'implementation') })),
        ut: ['summary.json', 'script-report.json'].map(name => {
          const file = featureFilePath(root, feature, `ut/reports/${name}`);
          return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
        }),
      }));
      assert.equal(events.filter(event => event.type === 'run_created').length, 1, '连续恢复建了另一个 run');
      const revisions = events.filter(event => event.type === 'scope_revised');
      assert.equal(new Set(revisions.map(event => executionScopeFingerprint(validateExecutionScope(event.execution_scope)))).size, revisions.length,
        'a real scope or proof change is recorded once, never a repeated unchanged revision');
      assert(revisions.every(event => (event.trigger as { check_id?: string })?.check_id !== 'node_options_injection'), 'repair trigger must identify its actual source');
      const regressionFamily = specGap ? 'review' : 'ut';
      const regressionFailedAt = events.map(event => event.type === 'harness_end' && event.phase === regressionFamily && event.exit_code === 1).lastIndexOf(true);
      const repairStart = events.slice(regressionFailedAt + 1).find(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
      const repairRequest = typeof repairStart?.invoke_id === 'string'
        ? executionRequestForInvoke(featureFilePath(root, feature, 'goal-runs/p2-attended'), repairStart.invoke_id) : null;
      assert(regressionFailedAt >= 0 && repairRequest && repairRequest.request.context.instruction?.includes(specGap ? 'CR-CODING' : UT_REAL_ASSERTION_CHECK.id)
        && repairRequest.request.context.factsContext?.source_paths.includes(codeRel), '真实新缺陷与原授权源码必须送回同run单元作者，不能用scope事件或旧报告代替');
      const invokes = events.filter(event => event.type === 'agent_invoke_start');
      assert(probe.harnessPhases.filter(phase => phase === 'coding').length >= 3, 'upstream repair and later real coding defect each require a valid current coding check');
      assert(probe.harnessPhases.filter(phase => phase === 'review').length >= 3, 'each changed implementation must receive actual review checks, not another report author');
      const expectedUtChecks = specGap ? 1 : 3;
      assert(probe.harnessPhases.filter(phase => phase === 'ut').length >= expectedUtChecks,
        `责任修复后必须实际复验UT，验证优先可复用已完成UT作者：${JSON.stringify({ authorInvokes: invokes.filter(event => event.phase === 'ut').length, harness: probe.harnessPhases })}`);
      const sourceWrites = events.flatMap(event => {
        const row = asRecord(event);
        if (event.type !== 'phase_write_observed' || typeof event.invoke_id !== 'string' || !Array.isArray(row?.owned)) return [];
        const invokeId = event.invoke_id;
        return row.owned.flatMap(value => {
          const written = asRecord(value);
          return written?.path === codeRel && written.owner === 'coding' && typeof written.post_sha256 === 'string'
            ? [{ invokeId, sha256: written.post_sha256 }] : [];
        });
      });
      const latestSourceWrite = sourceWrites.at(-1);
      assert(latestSourceWrite && latestSourceWrite.sha256 === createHash('sha256').update(fs.readFileSync(codeFile)).digest('hex'), '最终源码必须对应真实授权写入后像');
      const finalCodingReturn = events.map(event => event.type === 'agent_invoke_end' && event.invoke_id === latestSourceWrite.invokeId).lastIndexOf(true);
      const finalReviewCheck = events.map(event => event.type === 'harness_end' && event.phase === 'review' && event.exit_code === 0).lastIndexOf(true);
      const finalUtCheck = events.map(event => event.type === 'harness_end' && event.phase === 'ut' && event.exit_code === 0).lastIndexOf(true);
      assert(finalCodingReturn >= 0 && finalReviewCheck > finalCodingReturn, '最新实现交回后必须实际复核review，旧报告不能代替当前独立核验');
      assert(finalCodingReturn >= 0 && finalUtCheck > finalCodingReturn, '最新实现交回后必须有真实成功UT检查，不能借旧作者或旧报告签完成');
      assert.equal(new Set(invokes.map(event => event.invoke_id)).size, invokes.length, '每次实际调用ID必须唯一');
      invokes.forEach((event, index) => {
        if ((event as { purpose?: string }).purpose === 'verifier_format_repair') {
          assert(typeof event.invoke_id === 'string', 'the actual verifier invocation must have its own string identity');
          const issued = executionRequestForInvoke(featureFilePath(root, feature, 'goal-runs/p2-attended'), event.invoke_id);
          assert(issued && issued.request.purpose === 'verifier_format_repair' && issued.request.context.phase === event.phase,
            '独核必须保留它自己的真实签发身份');
          assert(events.some(row => row.type === 'harness_start' && row.phase === issued.request.chain_phase),
            '独核必须引用实际执行过的检查族，不能伪造缺席阶段作者');
          assert.equal(Number(/-i(\d+)$/.exec(String(event.invoke_id))?.[1]), index + 1, '补核实际调用保留唯一全局调用序号');
        } else assert.equal(Number(/-i(\d+)$/.exec(String(event.invoke_id))?.[1]), index + 1, '普通作者调用序号必须包含此前核实调用的全局消耗');
      });
      assert.equal(readExecutionActivity(events).calls, invokes.length, '连续修订遗漏真实调用审计');
      assert.equal(events.filter(event => event.type === 'run_end').at(-1)?.status, 'CHAIN_SLICE_COMPLETED', '连续路径未完成');
      const manifest = JSON.parse(fs.readFileSync(featureFilePath(root, feature, 'goal-runs/p2-attended/manifest.json'), 'utf8'));
      assert.equal(manifest.successor_of, undefined, '连续修订改变 lineage');
      assert.deepStrictEqual(manifest.execution_scope.phase_chain, loadFrozenExecutionScope(root, feature, 'p2-attended')!.phase_chain, '覆盖出生范围');
      const actualCompletion = completionOf({ projectRoot: root, frameworkRoot, feature, expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full' });
      assert.equal(actualCompletion.verdict, 'VALID', '实际 completion 消费无效：' + JSON.stringify(actualCompletion.reasons));
      return;
      } catch (error) {
        try { console.log('SCOPE_UNIT_ASSERTION_ORIGINALS ' + preserveRepairOriginals('same-unit repair contract assertion failed', events)); }
        catch (captureError) { console.warn('SCOPE_UNIT_PRESERVATION_FAILED ' + String(captureError)); }
        throw error;
      }
    }
    if (mode === 'unresolved') {
      assert.notEqual(probe.exitCode, 0);
      assert(probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'execution_scope_unresolved'), 'unknown scope was mislabeled as framework failure');
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
      return;
    }
    if (testingOnly) {
      assert.notEqual(probe.exitCode, 0);
      const birth = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
      assert.deepStrictEqual(birth.phase_chain, ['testing']);
      // A failure, an offline device and a human-only verdict are not new facts: no revision event,
      // and the effective scope is byte-identical to the birth scope.
      assert(!probe.events.some(event => event.type === 'scope_revised'), 'a verdict produced a scope revision');
      assert.equal(executionScopeFingerprint(loadEffectiveExecutionScope(root, feature, 'p2-attended')!), executionScopeFingerprint(birth), 'effective scope drifted without a revision');
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
      return;
    }
    if (mode === 'impact-reuse' || mode === 'impact-null') {
      // A correction that reuses a basis the frozen scope already carries, and an explicitly null
      // judgement, are both rejected outright — neither may ride on the frozen scope's credibility.
      assert.notEqual(probe.exitCode, 0, 'an illegal impact proposal was accepted');
      const birth = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
      assert(!probe.events.some(event => event.type === 'scope_revised'), 'a rejected correction still wrote a revision');
      assert.equal(executionScopeFingerprint(loadEffectiveExecutionScope(root, feature, 'p2-attended')!), executionScopeFingerprint(birth), 'effective scope drifted after a rejected correction');
      return;
    }
    if (requestOnly) {
      // 单职责终点四项断言（plan §3 问题 5）：① 只派发这一个阶段；② 不生成 Feature completion；
      // ③ 冻结范围 completion_target=request 且链长 1；④ 范围外阶段没有被凭空造出 summary。
      //
      // **run 终局按模式二分，这是生产事实不是放水**：
      //   · request-coding / request-ut —— 入链靠「实现义务 / 用户明确请求」标记，无定义缺口，run 正常 COMPLETED；
      //   · request-spec / request-plan —— 这两个阶段**只能靠定义缺口入链**（`execution-scope.ts:432`：
      //     缺口的 investigation owner 才会被加回 needed），缺口由该阶段的**真实产出**经生产的
      //     `designScopeRevisionChecks` 发布修订来关闭（第二笔代码 review 必改 1 修的正是这条生产缺口：
      //     此前 request 终点被排除在设计事实修订之外，单职责 spec/plan 在生产上**永远**到不了成功终局）。
      //     `*-invalid` 变体是反向用例：本阶段产出不合法时仍须如实 HALTED，不得宣告成功。
      // 终局取**最后一条** run_end：`*-cut` 的 events.jsonl 是同一个 run 的追加日志，
      // 第一条 run_end 是中断那一段的 INTERRUPTED，取 first 会把 resume 的终局读错。
      const lastRunEnd = () => [...probe.events].reverse().find(event => event.type === 'run_end');
      if (invalidOutput) {
        assert.notEqual(probe.exitCode, 0, '本阶段产出不合法时 run 不得宣告成功');
        const halt = lastRunEnd() as { status?: string; halt_reason?: string } | undefined;
        assert.equal(halt?.status, 'HALTED', JSON.stringify(probe.events.slice(-3)));
        assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'HALTED 的请求不得留下 Feature completion');
        return;
      }
      const diagnose = (): string => {
        const current = loadEffectiveExecutionScope(root, feature, 'p2-attended');
        return JSON.stringify({ chain: current?.phase_chain, unresolved: current?.unresolved,
          obligations: current?.obligations.map(o => [o.id, o.applicability, o.owner_phase, !!o.satisfied_by?.length]) });
      };
      assert.equal(probe.exitCode, 0, diagnose() + ' :: ' + JSON.stringify(probe.events.slice(-2)));
      // 成功终局用既有枚举，不另造状态；有效范围里不得再留 unresolved。
      const runEnd = lastRunEnd() as { status?: string } | undefined;
      assert.equal(runEnd?.status, 'CHAIN_SLICE_COMPLETED', JSON.stringify(probe.events.slice(-3)));
      const effective = loadEffectiveExecutionScope(root, feature, 'p2-attended')!;
      assert.deepStrictEqual(effective.unresolved, [], JSON.stringify(effective.unresolved));
      assert.equal(effective.completion_target, 'request', JSON.stringify(effective));
      // `*-cut`：这一段是 **resume**——修订已在上一段落盘、有效链已空，本段不得再派发任何阶段，
      // 但仍须判出成功终局（必改 A：按空的有效链重建 outcomes 会把上一段的真实 PASS 丢掉）。
      assert.deepStrictEqual(probe.invokedPhases, mode.endsWith('-cut') ? [] : ['work-unit-author']);
      assert(probe.harnessPhases.every(phase => phase === requestPhase), 'single-request check families must stay within the original request');
      if (mode.endsWith('-cut')) assert(injected, '中断点没被触发，这条用例没证明 resume');
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'request created Feature completion');
      const frozen = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
      assert.equal(frozen.completion_target, 'request', JSON.stringify(frozen));
      assert.deepStrictEqual(frozen.phase_chain, [requestPhase], JSON.stringify(frozen.phase_chain));
      // 原实现义务可纳入必要验证，但仍须有真实新来源；单职责定义/审查不因此扩权。
      assert.throws(() => resolveScopeRevisionProposal({
        projectRoot: root, frameworkRoot, feature, workflow: resolveWorkflowSpec(root, { frameworkRoot }),
        proposals: [{ request: { completion_target: 'request', requested_results: frozen.requested_results, requested_phases: [requestPhase, 'testing'] }, facts: [], contract_fingerprints: [] }],
        previous: frozen, authorizedPhases: frozen.phase_chain,
      }), requestPhase === 'coding' ? /revision requires new sourced facts/ : /request-scope revision cannot add phases/);
      if (requestPhase === 'coding') {
        const verificationFile = '02-Feature/FinancialCard/src/ohosTest/ets/test/OriginalRequest.test.ets';
        fs.mkdirSync(path.dirname(path.join(root, verificationFile)), { recursive: true });
        fs.writeFileSync(path.join(root, verificationFile), 'export const verifiesOriginalImplementation = true;\n');
        const resolved = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'ut', track: 'full', testTargets: [verificationFile],
          inputContext: { schema_version: '1.1', subject: { feature }, obligations: { 'unit-evidence': 'required' }, required_outputs: [] } });
        const targets = Object.values(resolved.inputs!.values).find(value => value.state === 'resolved' && value.binding.source.kind === 'derive' && value.binding.source.provider_id === 'derive.test-targets');
        assert(targets?.state === 'resolved');
        const proposal = resolveScopeRevisionProposal({ projectRoot: root, frameworkRoot, feature, workflow: resolveWorkflowSpec(root, { frameworkRoot }),
          proposals: [{ request: { completion_target: 'request', requested_results: frozen.requested_results, requested_phases: ['coding', 'ut'] },
            facts: [...structuredClone(frozen.obligations), { id: 'unit-evidence:original-request', kind: 'unit-evidence', applicability: 'required', reason: 'verify original implementation', basis: [targets.binding] }], contract_fingerprints: [] }],
          previous: frozen, authorizedPhases: frozen.phase_chain, currentRunId: 'p2-attended' });
        assert(proposal, '真实新测试目标允许原实现请求补必要UT，不变成全Feature交付');
        assert(proposal.scope.phase_chain.includes('ut'));
        assert.equal(proposal.scope.completion_target, 'request');
        const currentDisposition = resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'request', projectRoot: root,
          frameworkRoot, feature, executionScope: proposal.scope, chain: ['ut'] }));
        const pendingVerification = currentDisposition.problems.find(problem => problem.phase === 'ut' && problem.affects === 'completion');
        assert(pendingVerification, `the current view must retain the real missing UT verification: ${JSON.stringify(currentDisposition)}`);
        const configPath = path.join(root, 'framework.config.json'), configBytes = fs.readFileSync(configPath);
        try {
          fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(configBytes.toString('utf8')), phases_disabled: ['ut'] }));
          clearFrameworkConfigCache();
          assert(loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot).phasesDisabled.has('ut'));
          const target = { id: pendingVerification.id, source_phase: 'ut', category: 'verification' as const,
            summary: pendingVerification.detail, files: [verificationFile],
            item_fingerprint: itemFingerprintOf(pendingVerification.id, [verificationFile], pendingVerification.detail) };
          assert.equal(scopeRevisionInputFromRepairCandidates([target], { projectRoot: root, frameworkRoot, feature, runId: 'p2-attended', currentDisposition }), null,
            '原验证义务不能派出实例已禁用的正式工具能力；作者写权仍沿同单元判据');
        } finally { fs.writeFileSync(configPath, configBytes); clearFrameworkConfigCache(); }
      }
      // 「再收一次尾」：拿**本 run 真实发布的那份提案**（生产 `designScopeRevisionChecks` 写进
      // script-report 的原件，不是这里新拼的），在修订已应用、有效链已清空之后再重放一次。
      // 必须走到既有 no-op（`feature-track.ts` 尾部指纹相等 → 返回 null），而不是被越权校验挡住：
      // 授权边界是冻结链，用当前有效链会在判 no-op 之前就抛（必改 B 的可达反例）。
      if (preparedCandidate && requestPhase !== 'coding') {
        const published = JSON.parse(fs.readFileSync(featureFilePath(root, feature, `${requestPhase}/reports/script-report.json`), 'utf8')) as
          { checks: Array<{ scope_revision_input?: ExecutionScopeInput }> };
        const replayed = published.checks.find(check => check.scope_revision_input)!.scope_revision_input!;
        const revisionsBefore = probe.events.filter(event => event.type === 'scope_revised').length;
        // ctx 与 `goal-phase-runtime.ts:9142` 的修订调用点逐项同构（已完成阶段 / run 身份 / 需求文本）。
        const replayCtx = { projectRoot: root, frameworkRoot, feature, workflow: resolveWorkflowSpec(root, { frameworkRoot }),
          proposals: [replayed], authorizedPhases: frozen.phase_chain,
          completedPhases: new Set([requestPhase]), currentRunId: 'p2-attended', requirement: 'fixture delivery' };
        // ① 从**出生范围**重放：算出来必须还是同一份有效范围（指纹逐字相等）——第二次收尾不会
        //    多出一份新范围，运行时按输入指纹去重（`goal-phase-runtime.ts:9421`）后自然不再落盘。
        const replayFromBirth = resolveScopeRevisionProposal({ ...replayCtx, previous: frozen });
        assert(!replayFromBirth || executionScopeFingerprint(replayFromBirth.scope) === executionScopeFingerprint(resolveEffectiveScopeSource(root, feature, 'p2-attended')!.scope), 'same recorded proposal is a no-op or returns its recorded scope, not a rewritten birth identity');
        // ② 从**已应用后的有效范围**（链已空）再走一次：不得被越权校验挡住（必改 B 的可达反例），
        //    且无论它算出什么都不许超出冻结链。
        const replayFromEffective = resolveScopeRevisionProposal({ ...replayCtx, previous: effective });
        assert(!replayFromEffective || replayFromEffective.scope.phase_chain.every(phase => frozen.phase_chain.includes(phase)),
          '再收一次尾把范围扩出了冻结链：' + JSON.stringify(replayFromEffective?.scope.phase_chain));
        // 重放是纯函数：既不新增 `scope_revised`，也不改变已落盘的有效范围。
        assert.equal(probe.events.filter(event => event.type === 'scope_revised').length, revisionsBefore, '重放改动了修订数');
        assert.equal(executionScopeFingerprint(loadEffectiveExecutionScope(root, feature, 'p2-attended')!), executionScopeFingerprint(effective), '重放改动了有效范围');
      }
      for (const skipped of ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].filter(phase => phase !== requestPhase)) {
        assert(!fs.existsSync(featureFilePath(root, feature, `${skipped}/reports/summary.json`)), `invented out-of-scope phase summary: ${skipped}`);
      }
      return;
    }
    if (missingMapping) {
      assert.notEqual(probe.exitCode, 0, '缺施工映射仍完成 CU Goal');
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), '缺施工映射仍签发 Feature completion');
      assert.equal(completionOf({ projectRoot: root, feature, expectedChain: ['plan', 'coding', 'review', 'ut'], expectedTrack: 'full', frameworkRoot }).verdict, 'INVALID');
      const completion = observeChangeUnitCompletion(root, asChangeUnitArtifact(loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit));
      assert.equal(completion.state, 'ABSENT', JSON.stringify(completion));
      assert(probe.events.some(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict !== 'PASS'), 'plan 未保留真实映射失败');
      return;
    }
    assert.equal(probe.exitCode, 0, JSON.stringify(probe.events.slice(-5)));
    detachedStarted = true;
    if (mode === 'direct') {
      assert.deepStrictEqual(probe.invokedPhases, ['work-unit-author']);
      assert.deepStrictEqual(probe.harnessPhases, ['coding', 'review', 'ut']);
      for (const skipped of ['spec', 'plan', 'testing']) assert(!fs.existsSync(featureFilePath(root, feature, `${skipped}/reports/summary.json`)), 'invented out-of-scope phase summary');
    }
    else {
      if (mode === 'revision' || mode === 'revision-cut') {
        // R4 反例的判据：手写的 unknown 被按来源重算回 required（验收此刻确实在场），
        // 既不进 unresolved、也不凭空造出一个 spec 缺口把下游挂进 needed_by。
        const effective = loadEffectiveExecutionScope(root, feature, 'p2-attended')!;
        const fake = effective.obligations.find(o => o.id === 'acceptance-context:fake-gap')!;
        assert.equal(fake.applicability, 'required', JSON.stringify(fake));
        assert(!effective.unresolved.some(gap => gap.obligation_id === fake.id), JSON.stringify(effective.unresolved));
      }
      const sourceEvents = fs.readFileSync(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      // §3 问题 4: every handoff-era assertion migrated to its run-internal equivalent; none dropped.
      const revisions = sourceEvents.filter(event => event.type === 'scope_revised');
      // `spec-gap-revert` 有两条：① review 归因 spec 的修订；② spec 修复后重绑真实验收输入。
      const proofPublications = mode === 'revision-precut' || mode === 'impact-first' || mode.startsWith('detached');
      if (proofPublications || mode === 'revision-revoke') {
        assert(revisions.length >= 1, 'the original pending proposal must actually be published');
        assert.equal(new Set(revisions.map(event => executionScopeFingerprint(validateExecutionScope(event.execution_scope)))).size, revisions.length,
          'the same scope/proof state cannot be republished');
        const requested = revisions[0].revision_input.request.requested_phases as string[];
        for (const revision of revisions) assert(requested.every(phase => revision.revision_input.request.requested_phases.includes(phase)),
          'collecting real proofs cannot remove any original requested duty');
      } else assert.equal(revisions.length, specGap ? 2 : 1, 'duplicate scope revision');
      if (proofPublications) {
        assert.equal(sourceEvents.filter(event => event.type === 'agent_invoke_start').length, 1,
          'scope proof collection must retain the original single author');
        for (const family of ['spec', 'coding', 'review', 'ut', 'testing']) {
          assert.equal(sourceEvents.filter(event => event.type === 'harness_start' && event.phase === family).length, 1,
            `a persistence retry must consume the real ${family} producer once, never purchase another tool over the same work`);
        }
      }
      assert.equal(revisions[0].revision_index, 1, 'revision index must start at 1');
      // design-gap revises the chain back to plan, so coding is legitimately dispatched TWICE;
      // the revision mode never returns to spec, so spec stays at one.
      // 提案验证前中断可复用已完成作者，补齐原gate/修订，不再购买同输入作者。
      const sourcePhase = designGapFamily ? 'coding' : 'spec';
      const sourceInvokes = sourceEvents.filter(event => event.type === 'harness_start' && event.phase === sourcePhase);
      const expectedSourceInvokes = mode === 'revision-revoke' ? 3 : designGapFamily ? 2 : 1;
      const sourceDiagnostic = 'revised scope did not validate its actual responsible producer: ' + JSON.stringify({
        harness: probe.harnessPhases, acceptance: fs.readFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'utf8'),
        events: sourceEvents.filter(event => ['scope_revised', 'agent_invoke_start', 'agent_invoke_end', 'harness_end', 'phase_verdict'].includes(event.type)),
      });
      if (mode === 'revision-revoke') {
        assert(sourceInvokes.length >= expectedSourceInvokes, sourceDiagnostic);
        const oldProofAt = sourceEvents.findIndex(event => event.type === 'harness_end' && event.phase === 'spec' && event.exit_code === 0);
        const productSha = createHash('sha256').update(fs.readFileSync(codeFile)).digest('hex');
        const newSourceAt = sourceEvents.findIndex((event, index) => index > oldProofAt && event.type === 'phase_write_observed'
          && event.owned?.some((write: { path?: string; pre_sha256?: string; post_sha256?: string; roles?: Array<{ kind: string }> }) => write.path === codeRel
            && write.pre_sha256 !== write.post_sha256 && write.post_sha256 === productSha && write.roles?.some(role => role.kind === 'source')));
        const newDefinitionFailureAt = sourceEvents.findIndex((event, index) => index > newSourceAt && event.type === 'harness_end' && event.phase === 'spec' && event.exit_code === 1);
        assert(oldProofAt >= 0 && newSourceAt > oldProofAt && newDefinitionFailureAt > newSourceAt,
          'old spec proof must precede a real owned source change and its newly observed definition gap');
      } else if (mode === 'design-gap-revert' || specGap && !continuousCoding) assert(sourceInvokes.length >= 2, sourceDiagnostic);
      else assert.equal(sourceInvokes.length, expectedSourceInvokes, sourceDiagnostic);
      if (expectedSourceInvokes > 1 || specGap && !continuousCoding) {
        const completedChecks = sourceEvents.filter(event => event.type === 'harness_end' && event.phase === sourcePhase);
        assert.equal(completedChecks.length, sourceInvokes.length, 'each current check must actually return');
        for (let index = 1; index < sourceInvokes.length; index++) {
          const start = sourceInvokes[index].ts, previousEnd = completedChecks[index - 1].ts, end = completedChecks[index].ts;
          assert(typeof start === 'string' && typeof previousEnd === 'string' && typeof end === 'string', 'real check timestamps are required');
          assert(Date.parse(start) > Date.parse(previousEnd) && Date.parse(end) > Date.parse(start),
            'a current unit may keep its actor identity, but cannot replace another real tool execution with its old result');
        }
      }
      if (mode === 'revision-precut') {
        assert(injected, 'the pre-validation cut was never reached');
        assert(loadPhaseEvidenceManifest(root, feature, 'spec')?.integrityOk, '原作者产出必须取得真实spec闭合证明');
        assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot })[0].verdict, 'fresh', '复用作者不等于复用过期证据');
      }
      const effective = loadEffectiveExecutionScope(root, feature, 'p2-attended')!;
      assert.deepStrictEqual(effective.phase_chain, [], 'effective queue excludes duties proven by their later valid PASS; recorded revision queues remain immutable');
      if (specGap) {
        assert(effective.reused_phases.some(reuse => reuse.phase === 'spec'), '已修复的 spec 必须作为有效证据复用，不能丢责任');
        assert(loadPhaseEvidenceManifest(root, feature, 'spec')?.integrityOk, 'spec 闭合证明必须有效');
        assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['spec'], { frameworkRoot })[0].verdict, 'fresh', 'spec 复用必须真实 fresh');
      }
      if (mode === 'revision-revoke') {
        // The withdrawn proof is not re-attached; the phase returns to the chain; and — because the
        // cut lands right after that revision — the re-run happens on RECOVERY, from events alone.
        assert(typeof revokedRevisionIndex === 'number', 'the interruption must follow the actual Spec proof withdrawal');
        const revokeAt = sourceEvents.findIndex(event => event.type === 'scope_revised' && event.revision_index === revokedRevisionIndex);
        // Recovery does NOT depend on a second event: the cut lands immediately after the single
        // `scope_revised` write, and the revoked phase is derived from that record's own content.
        assert(!sourceEvents.some(event => event.type === 'phase_invalidated'), 'a second event was written next to the revision');
        assert(sourceEvents.slice(revokeAt).some(event => event.type === 'harness_start' && event.phase === 'spec'), 'recovery reused the pre-revision spec PASS');
        assert(injected, 'the post-revocation cut was never reached');
        assert.deepStrictEqual(revokedPhasesByRevision(loadFrozenExecutionScope(root, feature, 'p2-attended')!, sourceEvents,
          readRepairDependencyContext(root, feature, loadWorkflowSpec(frameworkRoot, 'scoped'), effective, frameworkRoot)).get(revokedRevisionIndex), ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], 'the owner and actual consumed downstream invalidation comes from the same revision');
        const specDuty = effective.obligations.find(o => o.id === 'acceptance-context:request:spec')!;
        const currentDefinition = liveBinding('ut', 'acceptance');
        assert(specDuty.satisfied_by?.some(ref => 'input_id' in ref && stableStringify(ref) === stableStringify(currentDefinition)),
          'the repaired definition must carry its actual current registered InputBinding, never an old phase report or basis alone');
        const currentSpecEnd = sourceEvents.slice(revokeAt).filter(event => event.type === 'harness_end' && event.phase === 'spec' && event.exit_code === 0).at(-1);
        const currentSpecEvidence = loadPhaseEvidenceManifest(root, feature, 'spec');
        assert(currentSpecEnd && currentSpecEvidence?.integrityOk
          && Date.parse(currentSpecEvidence.manifest.generated_at) >= Date.parse(currentSpecEnd.ts), 'a new completed spec producer must publish its real current manifest');
        assert.notDeepStrictEqual(revisions[1].execution_scope.obligations.find((o: { id: string }) => o.id === 'acceptance-context:request:spec').satisfied_by, specDuty.satisfied_by, 'the revocation and the re-attachment are the same record');
      }
      if (mode === 'impact-first') {
        // First-time impact: no old value to compare against, and the new basis is its own source.
        assert.equal(effective.request_impact?.user_visible_behavior_change, true, 'the first impact judgement was not carried into the scope');
      }
      const manifestNow = JSON.parse(fs.readFileSync(featureFilePath(root, feature, 'goal-runs/p2-attended/manifest.json'), 'utf8'));
      // Birth values come from the run_created record itself (present for every mode, and the
      // one thing a revision must never touch) rather than from a literal or a mutable manifest.
      const born = sourceEvents.find(event => event.type === 'run_created');
      assert(born, 'run_created missing');
      assert.equal(manifestNow.end_phase, born.phase_chain.at(-1), 'birth end_phase was rewritten by a revision');
      assert.deepStrictEqual(manifestNow.execution_scope.phase_chain, born.phase_chain, 'birth scope was rewritten by a revision');
      assert.equal(manifestNow.successor_of, undefined, 'in-run revision created a successor lineage');
      assert.equal(fs.readdirSync(featureFilePath(root, feature, 'goal-runs')).length, 1, 'in-run revision created a second run');
      assert.equal(sourceEvents.filter(event => event.type === 'run_created').length, 1, 'duplicate run birth');
      const revisionAt = sourceEvents.findIndex(event => event.type === 'scope_revised');
      // A machine revision may need only new tool checks; actual native calls still retain their original audit identity.
      const beforeRevision = sourceEvents.slice(0, revisionAt);
      const turnsBefore = beforeRevision.filter(event => event.type === 'agent_invoke_start').length;
      assert.equal(readExecutionActivity(beforeRevision).calls, turnsBefore);
      const invokes = sourceEvents.filter(event => event.type === 'agent_invoke_start');
      assert.deepStrictEqual(invokes.map(event => Number(/-i(\d+)$/.exec(String(event.invoke_id))?.[1])), invokes.map((_, index) => index + 1), '修订或恢复重置/复用了调用序号');
      assert.equal(readExecutionActivity(sourceEvents).calls, invokes.length, '修订或恢复遗漏实际调用');
      if (utDesignGap) {
        assert.equal(sourceEvents.filter(event => event.type === 'harness_start' && event.phase === 'review').length, 2, 'new upstream plan work invalidates the old downstream review once');
        assert.equal(sourceEvents.filter(event => event.type === 'harness_start' && event.phase === 'plan').length, 1, '链外 plan 必须实际验证');
        assert(probe.harnessPhases.filter(phase => phase === 'ut').length >= 2, '补齐定义后必须实际复验UT；已完成UT作者可复用');
        const planCheckedAt = sourceEvents.map(event => event.type === 'harness_end' && event.phase === 'plan' && event.exit_code === 0).lastIndexOf(true);
        const planOwnerReturnedAt = sourceEvents.slice(0, planCheckedAt).map(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author' && event.exit_code === 0).lastIndexOf(true);
        const firstUtFailedAt = sourceEvents.findIndex(event => event.type === 'harness_end' && event.phase === 'ut' && event.exit_code === 1);
        const utRecheckedAt = sourceEvents.map(event => event.type === 'harness_end' && event.phase === 'ut' && event.exit_code === 0).lastIndexOf(true);
        assert(firstUtFailedAt >= 0 && planOwnerReturnedAt >= 0 && planCheckedAt > firstUtFailedAt && planCheckedAt > planOwnerReturnedAt && utRecheckedAt > planCheckedAt,
          '实际plan责任作者交回及plan新检查后须有成功UT检查，不能借旧报告完成');
      }
      if (mode === 'design-gap-revert') {
        // §5.1.1a 的闭环：plan 拒绝扩展契约 → coding 撤回误改 → 责任阶段证据仍 fresh、完成仍 VALID。
        // ① plan 没有扩大写集（契约文件字节未变）
        assert(fs.readFileSync(contractsFile).equals(contractsAtBirth), 'plan widened the frozen write set');
        // ② coding 把触发文件改回了原字节
        assert(fs.readFileSync(codeFile).equals(originalCode), 'the unjustified edit was never reverted');
        // ③ 历史触发摘要不再阻断（R-摘要豁免那一路）
        const issues = executionScopeEvidenceIssues(root, feature, effective, undefined, 'p2-attended');
        assert(!issues.some(issue => issue.includes('input binding stale')), issues.join('; '));
        // ④ 责任阶段证据仍 fresh（R-目标收集那一路要防的后果）
        assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['plan'], { frameworkRoot })[0].verdict, 'fresh');
        const planEvidence = loadPhaseEvidenceManifest(root, feature, 'plan');
        assert(planEvidence?.integrityOk, 'plan evidence missing');
        // 本行原为「触发文件不得作为当前输入进 plan 证据」。plan b5c1e9d7 §3.1 让 goal 的最终闭环
        // 也按仓内冻结事实重建调用上下文之后，plan 的证据**确实**登记了它按实现义务读到的写集源码
        // ——非 goal 路径（`harness-runner.ts`）本来就登记，原断言之所以成立，只是因为 goal 闭环
        // 当时什么源码都不登记。本夹具里触发文件与写集文件是**同一个**，"没被当作当前目标"因此
        // 不再可观测；R-摘要豁免那一路仍由 ③ 锁住，B4 要防的后果由上一行（撤回后仍 fresh）锁住。
        // 这里改锁归属：登记进来就必须带责任阶段，否则实现阶段一动它上游又要 stale。
        const triggerEntry = planEvidence!.manifest.inputs.find(entry => entry.path === codeRel);
        assert(!triggerEntry || triggerEntry.owner_phase === 'coding',
          `写集源码进了 plan 证据却没有责任归属：${JSON.stringify(triggerEntry)}`);
      }
      if (specGap) {
        // §5.1.1a 的 spec 侧闭环：review 归因 spec → 同 run 修订 → spec 重跑修复触发文件 → 完成 VALID。
        // ① 责任阶段确实重跑了（修订之后有 spec 的 invoke）
        assert(sourceEvents.slice(revisionAt).some(event => event.type === 'harness_start' && event.phase === 'spec'), 'spec 修复后的真实检查没有重跑');
        // ② 触发文件（acceptance.yaml）确实被修复了——字节与修订触发时不同
        const acceptanceNow = fs.readFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'utf8');
        assert(acceptanceNow.includes('AC-EMPTY'), '触发文件没有被责任阶段修复：' + acceptanceNow);
        if (!continuousCoding) {
          const actualFailure = sourceEvents.findIndex(event => event.type === 'harness_end' && event.phase === 'spec' && event.exit_code === 1);
          const acceptanceRel = path.relative(root, featureFilePath(root, feature, 'acceptance.yaml')).replace(/\\/g, '/');
          const acceptanceSha = createHash('sha256').update(acceptanceNow).digest('hex');
          const actualRepair = sourceEvents.findIndex((event, index) => index > actualFailure && event.type === 'phase_write_observed'
            && event.owned?.some((write: { path?: string; pre_sha256?: string; post_sha256?: string }) => write.path === acceptanceRel
              && write.pre_sha256 !== write.post_sha256 && write.post_sha256 === acceptanceSha));
          const actualPass = sourceEvents.findIndex((event, index) => index > actualRepair && event.type === 'harness_end' && event.phase === 'spec' && event.exit_code === 0);
          assert(actualFailure >= 0 && actualRepair > actualFailure && actualPass > actualRepair,
            'the real definition failure must precede the actual owner write and its successful current check');
        }
        // ③ 修订触发依据的历史摘要不再阻断完成（豁免按 kind：acceptance-definition）
        const specIssues = executionScopeEvidenceIssues(root, feature, effective, undefined, 'p2-attended');
        assert(!specIssues.some(issue => issue.includes('input binding stale')), specIssues.join('; '));
        // ④ 修订事实确实是 acceptance-definition（spec 家族），不是被当成 design 归属
        const trigger = effective.obligations.find(o => o.kind === 'acceptance-definition');
        assert(trigger && trigger.owner_phase === 'spec', JSON.stringify(effective.obligations.map(o => [o.id, o.kind, o.owner_phase])));
        // ⑤ 反例（时序）：缺口未处理时完不成——本 run 的终局必须发生在 spec 重跑**之后**，
        // 而不是在修订落下的那一刻就收尾。
        const specRerunAt = sourceEvents.findIndex((event, index) => index >= revisionAt && event.type === 'harness_start' && event.phase === 'spec');
        const completedAt = sourceEvents.findIndex(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED');
        assert(specRerunAt >= 0 && completedAt > specRerunAt, 'run 在 spec 修复缺口之前就收尾了');
        // ⑥ 反例（结构）：责任阶段曾执行且在有效完成范围中；fresh 复用不能删除责任。
        assert(executionCompletionPhases(effective).includes('spec'), '有效完成范围必须保留实际执行且 fresh 复用的 spec 责任');
        // ⑦ 修复后的 acceptance.yaml 仍是 spec 的**正式证据输入**（§5.4 那一行的要点：它既是
        // spec 的输入也是它的产出，同路径 input/output 合并为 both 后仍列入 inputs；
        // 因此这里断言「在 inputs 里」，而**不是**照抄 plan 侧的「不含触发文件」）。
        const specEvidence = loadPhaseEvidenceManifest(root, feature, 'spec');
        assert(specEvidence?.integrityOk, 'spec evidence missing');
        const acceptanceRel = path.relative(root, featureFilePath(root, feature, 'acceptance.yaml')).split(String.fromCharCode(92)).join('/');
        assert(specEvidence!.manifest.inputs.some(entry => entry.path === acceptanceRel),
          '修复后的验收文件没有作为 spec 的正式证据输入登记：' + JSON.stringify(specEvidence!.manifest.inputs.map(entry => entry.path)));
      }
      if (designGapFamily && !utDesignGap) {
        assert(sourceEvents.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict !== 'PASS'), 'failure record was washed away');
        assert(!sourceEvents.slice(0, revisionAt).some(event => event.type === 'run_end'), 'run was sealed before the revision');
        assert.equal(sourceEvents.filter(event => event.type === 'run_end').at(-1).status, 'CHAIN_SLICE_COMPLETED', 'revised run did not reach a clean terminal');
      }
      const again = await execute(); assert.equal(again.invokedPhases.length, 0, 'completed run invoked again');
      assert(recoveryMarker && !fs.existsSync(recoveryMarker), 'completed run leaked temporary recovery state');
      // D2.6: the completion is cut from the EFFECTIVE scope, so a revision-count mismatch with the
      // events (here: the record claims one revision fewer than the run actually applied) is INVALID.
      const completionProjection = JSON.parse(fs.readFileSync(featureFilePath(root, feature, 'feature-completion.json'), 'utf8'));
      const completionFile = path.join(root, completionProjection.original_path);
      const completionBytes = fs.readFileSync(completionFile, 'utf8');
      const completionRecord = JSON.parse(completionBytes);
      assert.equal(completionRecord.scope_revision_count, revisions.length, 'completion did not record the applied revisions');
      assert.equal(completionRecord.execution_scope_fingerprint, executionScopeFingerprint(resolveEffectiveScopeSource(root, feature, 'p2-attended')!.scope), 'completion identity must bind recorded revisions, not the live proof projection');
      const writeCompletion = (record: unknown): void => {
        const bytes = JSON.stringify(record);
        fs.writeFileSync(completionFile, bytes);
        fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify({ ...completionProjection, original_sha256: createHash('sha256').update(bytes).digest('hex') }));
      };
      const completionVerdict = (): string => completionOf({ projectRoot: root, feature, expectedChain: executionCompletionPhases(effective), expectedTrack: 'full' }).verdict;
      writeCompletion({ ...completionRecord, scope_revision_count: revisions.length - 1 });
      assert.equal(completionVerdict(), 'INVALID', 'a revision-count mismatch was accepted');
      // A 1.2 record MUST carry the count: a stripped field is a damaged certificate, not a zero.
      const { scope_revision_count: _dropped, ...withoutCount } = completionRecord as Record<string, unknown>;
      writeCompletion(withoutCount);
      assert.equal(completionVerdict(), 'INVALID', 'a completion with no scope_revision_count was accepted');
      fs.writeFileSync(completionFile, completionBytes);
      fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify(completionProjection));
    }
    const verified = completionOf({ projectRoot: root, feature, expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full' });
    assert.equal(verified.verdict, 'VALID', JSON.stringify(verified));
    const cu = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh');
    const cuCompletion = observeChangeUnitCompletion(root, asChangeUnitArtifact(cu.changeUnit));
    assert.equal(cuCompletion.state, 'VALID', JSON.stringify(cuCompletion));
    assert.deepStrictEqual(cuCompletion.expectedChain, utDesignGap ? ['plan', 'coding', 'review', 'ut'] : mode === 'direct' ? ['coding', 'review', 'ut']
      : designGapFamily ? ['plan', 'coding', 'review', 'ut']
      : specGap ? ['spec', 'plan', 'coding', 'review', 'ut']
      : mode === 'revision-revoke' ? ['plan', 'coding', 'review', 'ut', 'testing']
      : ['spec', 'coding', 'review', 'ut', 'testing']);
    if (mode === 'direct') {
      // 已成功的同一 Feature 证据与 completion 原件仍在，缺映射不能借它们信用 CU。
      const mappedBytes = fs.readFileSync(contractsFile);
      try {
        const unmapped = YAML.parse(mappedBytes.toString('utf8')); unmapped.change_unit.predicate_mappings = [];
        fs.writeFileSync(contractsFile, YAML.stringify(unmapped));
        const notCredited = observeChangeUnitCompletion(root, asChangeUnitArtifact(cu.changeUnit));
        assert.equal(notCredited.state, 'INCOMPLETE', JSON.stringify(notCredited));
        assert(notCredited.reasons.some(reason => reason.includes('mapping')), JSON.stringify(notCredited));
      } finally { fs.writeFileSync(contractsFile, mappedBytes); }
      assert.equal(observeChangeUnitCompletion(root, asChangeUnitArtifact(cu.changeUnit)).state, 'VALID', '恢复真实映射后未恢复原有 CU credit');
      const previous = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
      const reuseInput = request(['coding', 'review', 'ut'], 'feature');
      reuseInput.facts = previous.obligations.map(obligation => obligation.applicability !== 'required' ? obligation : ({ ...obligation, satisfied_by: obligation.satisfied_by ?? [{ phase: obligation.owner_phase, run_id: 'p2-attended', evidence_manifest_aggregate: loadPhaseEvidenceManifest(root, feature, obligation.owner_phase)!.manifest.aggregate_sha256 }] }));
      // The reuse input must be resolved the way birth resolves it: D0.1 recomputes every evidence
      // applicability from its sources, so replaying the frozen obligations without the acceptance
      // binding and resolved facts would legitimately land them back on `unknown`.
      reuseInput.request.impact = previous.request_impact;
      const reused = resolveExecutionScope(reuseInput, workflow,
        readScopeAcceptance(root, reuseInput, { feature, frameworkRoot }),
        collectResolvedScopeFacts(reuseInput, { projectRoot: root, feature, frameworkRoot, requirement: 'fixture delivery', impactInherited: true }));
      assert.deepStrictEqual(reused.phase_chain, []);
      assert(verifyReusedExecutionScope(root, feature, reused).complete, 'fully reused Feature evidence did not validate');
      const designBytes = fs.readFileSync(contractsFile);
      // plan c4e7a9b2 B2：CU Feature 的登记证据按解析内容等价（与输入绑定同口径），只加注释不再是设计漂移——漂移须改内容。
      fs.appendFileSync(contractsFile, '\nstale_design_contract: changed after validated execution\n');
      // §4.1.4 on the PRODUCTION path: the reading layer re-resolves every `satisfied_by` binding,
      // so a drifted design source is reported as not-ok and the freeze is refused — no hand-built
      // verdict, both the binding and the drift are real.
      const staleFacts = collectResolvedScopeFacts(reuseInput, { projectRoot: root, feature, frameworkRoot, requirement: 'fixture delivery', impactInherited: true });
      assert(staleFacts.satisfied_by.some(entry => !entry.ok), JSON.stringify(staleFacts.satisfied_by));
      assert.throws(() => resolveExecutionScope(reuseInput, workflow, undefined, staleFacts), /冻结时核验失败/);
      assert.notEqual(completionOf({ projectRoot: root, feature, expectedChain: previous.phase_chain, expectedTrack: 'full' }).verdict, 'VALID', 'stale design contract accepted');
      fs.writeFileSync(contractsFile, designBytes);
      const codeBytes = fs.readFileSync(codeFile);
      fs.appendFileSync(codeFile, '\n// changed after validated execution\n');
      assert(!verifyReusedExecutionScope(root, feature, reused).complete, 'stale reused execution accepted');
      fs.writeFileSync(codeFile, codeBytes);
      assert(!verifyReusedExecutionScope(root, feature, { ...reused, requested_results: ['different result'] }).complete, 'old evidence silently satisfied a new goal');
      assert.equal(fs.readdirSync(featureFilePath(root, feature, 'goal-runs')).length, 1, 'reuse created an empty run');
      const projectionFile = featureFilePath(root, feature, 'feature-completion.json');
      const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
      const original = path.join(root, projection.original_path);
      const record = JSON.parse(fs.readFileSync(original, 'utf8'));
      assert.equal(record.schema_version, '1.2');
      assert.equal(record.execution_scope_fingerprint, executionScopeFingerprint(previous));
      const originalBytes = fs.readFileSync(original, 'utf8');
      for (const field of [{ execution_scope_fingerprint: '0'.repeat(64) }, { schema_version: '1.1' }]) {
        const changed = JSON.stringify({ ...record, ...field }); fs.writeFileSync(original, changed);
        fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, schema_version: field.schema_version ?? record.schema_version, original_sha256: createHash('sha256').update(changed).digest('hex') }));
        assert.equal(completionOf({ projectRoot: root, feature, expectedChain: previous.phase_chain, expectedTrack: 'full' }).verdict, 'INVALID');
      }
      fs.writeFileSync(original, originalBytes); fs.writeFileSync(projectionFile, JSON.stringify(projection));
      record.chain = ['ut']; record.phases = record.phases.filter((phase: { phase: string }) => phase.phase === 'ut');
      const bytes = JSON.stringify(record); fs.writeFileSync(original, bytes);
      fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, original_sha256: createHash('sha256').update(bytes).digest('hex') }));
      assert.equal(completionOf({ projectRoot: root, feature, expectedChain: ['ut'], expectedTrack: 'full' }).verdict, 'INVALID', 'self-authored completion chain bypassed frozen scope');
      const manifestFile = featureFilePath(root, feature, 'goal-runs/p2-attended/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); delete manifest.execution_scope;
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      assert.throws(() => loadFrozenExecutionScope(root, feature, 'p2-attended'), /出生摘要|scope/);
    }
  } catch (error) {
    const saved = preserveFailure?.(String(error));
    throw new Error(`${(error as Error).stack ?? String(error)}${saved ? `\noriginals: ${saved}` : ''}`);
  } finally { restoreAppend?.(); clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); if (tsFramework) removeShimFramework(tsFramework); }
}
function rejectImpactRevision(mode: 'impact-reuse' | 'impact-null'): void {
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature,
      completionTarget: 'feature', requestedResults: ['value is 42'], requestedPhases: ['coding', 'review', 'ut'],
      requirement: '把 value 改成 42', overwrite: true,
      impact: { userVisibleBehaviorChange: false, reason: '内部取值', basisPaths: ['src/demo/value.ts'] } });
    freezeFeatureExecutionScope({ projectRoot: root, feature, scope: prepared.scope,
      candidateFingerprint: featureScopeCandidateFingerprint(root, feature) });
    const original = fs.readFileSync(featureFrozenScopePath(root, feature));
    const proposal = structuredClone(prepared.candidate);
    const acceptance = featureFilePath(root, feature, 'acceptance.yaml');
    const updatedAcceptance = YAML.parse(fs.readFileSync(acceptance, 'utf8'));
    updatedAcceptance.criteria[0].expected_result = '43';
    fs.writeFileSync(acceptance, YAML.stringify(updatedAcceptance));
    const fresh = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'ut', track: 'full',
      inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs!.values.acceptance;
    assert(fresh?.state === 'resolved');
    assert(prepared.candidate.facts.some(fact => fact.basis.some(binding => binding.input_id === 'acceptance' && binding.content_fingerprint !== fresh.binding.content_fingerprint)), 'the real acceptance content fingerprint must change');
    proposal.facts.push({ id: 'acceptance:new', kind: 'acceptance-context', applicability: 'required',
      reason: 'another genuinely new input cannot authorize an unsourced impact correction', basis: [fresh.binding] });
    assert(hasNewSourcedFact(prepared.scope, proposal.facts, ''), 'the rejection must not be explained by a lack of other new facts');
    if (mode === 'impact-null') (proposal.request as { impact?: unknown }).impact = null;
    else proposal.request.impact = { ...proposal.request.impact!, user_visible_behavior_change: true, reason: 'correction using the old impact basis' };
    assert.throws(() => resolveScopeRevisionProposal({ projectRoot: root, frameworkRoot, feature,
      workflow: resolveWorkflowSpec(root, { frameworkRoot }), proposals: [proposal], previous: prepared.scope,
      authorizedPhases: prepared.scope.phase_chain, requirement: '把 value 改成 42' }),
    mode === 'impact-null' ? /影响判断为 null/ : /impact correction requires its own new sourced basis/);
    assert(fs.readFileSync(featureFrozenScopePath(root, feature)).equals(original), 'a rejected proposal changed frozen authority');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}
for (const mode of ['direct', 'revision-cut', 'revision-precut', 'revision-revoke', 'impact-first', 'impact-reuse', 'impact-null', 'design-gap', 'design-gap-revert', 'spec-gap-revert', 'detached', 'detached-harness', 'detached-explicit', 'request-ut', 'request-spec', 'request-plan', 'request-coding', 'request-spec-invalid', 'request-plan-invalid', 'request-spec-cut', 'request-plan-cut', 'testing-fail', 'testing-offline', 'testing-manual', 'unresolved'] as const) cases.push({
  name: (mode === 'impact-reuse' || mode === 'impact-null' ? 'scope revision direct: ' : 'real prepare CLI / bridge scope lifecycle: ') + mode
    + (mode === 'design-gap' ? ' (contract expansion)' : mode === 'detached' ? ' (project-root launch)'
      : mode === 'request-spec' || mode === 'request-plan' ? ' (definition request)' : ''),
  run: () => mode === 'impact-reuse' || mode === 'impact-null' ? rejectImpactRevision(mode) : runScopeScenario(mode),
});
cases.push({ name: 'P7 Feature evidence cannot credit an unmapped CU goal', run: () => runScopeScenario('direct', false, true) });
cases.push({ name: 'P7 new default creates real attended completion and CU credit without testing', run: () => runScopeScenario('direct', true) });

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

cases.push({ name: 'D0.2 a real CU design does not need a predicted file inventory to prepare coding', async run() {
  // §5.4「对 component-blueprint/valid 的 CU 生成候选 → prepare-run 直接可用」这一行，
  // 此前只有手工拼候选的用例，没有走过 `prepareFeatureScopeCandidate` 的真实 CU 路径。
  const repo = path.resolve(__dirname, '../../..');
  const { root } = setupGoalRuntimeHost('codex');
  const frameworkRoot = path.join(root, 'framework');
  try {
    for (const dir of ['harness', 'profiles', 'agents', 'skills', 'specs', 'templates', 'docs']) fs.symlinkSync(path.join(repo, dir), path.join(frameworkRoot, dir), process.platform === 'win32' ? 'junction' : 'dir');
    fs.cpSync(path.join(repo, 'workflows'), path.join(frameworkRoot, 'workflows'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'package.json'), path.join(frameworkRoot, 'package.json'));
    fs.cpSync(path.join(repo, 'harness/tests/fixtures/component-blueprint/valid'), root, { recursive: true });
    const configFile = path.join(root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.active_workflow = 'obligation-driven';
    fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    configureFeature(root, loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh'));
    const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
    const requirement = 'refresh the ledger list';
    const generate = () => prepareFeatureScopeCandidate({
      projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
      requestedResults: ['ledger list refreshes'], requestedPhases: ['plan', 'coding', 'review', 'ut'],
      requirement, overwrite: true,
    });
    // 文件预测缺席不等于设计缺失；验收仍须由 spec 补齐。
    const gapped = generate();
    assert.equal(gapped.candidate.facts.find(fact => fact.kind === 'design-context')!.applicability, 'required');
    assert.equal(gapped.candidate.facts.find(fact => fact.kind === 'acceptance-context')!.applicability, 'unknown');
    // 验收落盘后，不补文件预测也能冻结正常实施范围。
    fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
      'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}]' + String.fromCharCode(10));
    const usable = generate();
    assert.equal(usable.candidate.facts.find(fact => fact.kind === 'design-context')!.applicability, 'required');
    assert(usable.candidate.facts.some(fact => fact.kind === 'implementation'), JSON.stringify(usable.candidate.facts));
    assert(usable.scope.phase_chain.includes('coding'), JSON.stringify(usable.scope.phase_chain));
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'p8-cu', adapter: 'codex', requirement });
    assert.equal(prepared.manifest.run_id, 'p8-cu');
    assert.deepStrictEqual(prepared.manifest.execution_scope!.phase_chain, usable.scope.phase_chain);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'P7 two real CU runs retain distinct scopes and Component combination duties', async run() {
  const repo = path.resolve(__dirname, '../../..');
  const { root } = setupGoalRuntimeHost('codex');
  const frameworkRoot = path.join(root, 'framework');
  try {
    for (const folder of ['harness', 'profiles', 'agents', 'skills', 'specs', 'templates', 'docs']) fs.symlinkSync(path.join(repo, folder), path.join(frameworkRoot, folder), process.platform === 'win32' ? 'junction' : 'dir');
    fs.cpSync(path.join(repo, 'workflows'), path.join(frameworkRoot, 'workflows'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'package.json'), path.join(frameworkRoot, 'package.json'));
    fs.cpSync(path.join(repo, 'harness/tests/fixtures/component-blueprint/valid'), root, { recursive: true });
    const configFile = path.join(root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.active_workflow = 'obligation-driven';
    fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    const units = ['ledger-refresh', 'ledger-consumer'];
    for (const [index, id] of units.entries()) {
      const loaded = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', id);
      configureFeature(root, loaded);
      const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', id);
      const phases = index === 0 ? ['coding', 'review', 'ut'] : ['coding', 'review', 'ut', 'testing'];
      // 写集授权只认 `contracts.files`（第七轮阻断 1）：共享 CU 夹具不声明 files，
      // **只在临时 root 里**补上真实写集（必须在解析 contracts 绑定之前，否则绑定当场就 stale）。
      {
        const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
        const declared = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
        declared.files = ['02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets'];
        fs.writeFileSync(contractsFile, YAML.stringify(declared));
      }
      const design = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'plan', track: 'full', inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs!.values.contracts;
      assert.equal(design.state, 'resolved'); if (design.state !== 'resolved') return;
      // D0.1: a Feature-target candidate that requests coding must declare (a) where its acceptance
      // comes from and (b) its write set — the shared CU fixture carries neither, so each unit writes
      // its own acceptance into the TEMP root (shared fixture untouched) and binds the product file.
      const codeRel = '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets';
      fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), index === 0
        ? 'criteria: [{id: AC-UNIT, priority: P1, ut_layer: unit, desc: unit verified behavior, expected_result: ok}]\n'
        : 'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, device_focus: on-device check, desc: device verified behavior, expected_result: ok}]\n');
      const live = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'plan', track: 'full', testTargets: [codeRel],
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } });
      const liveOf = (id: string): any => { const v = live.inputs?.values?.[id]; assert(v && v.state === 'resolved', id + ': ' + JSON.stringify(v)); return v.binding; };
      const candidate = request(phases, 'feature');
      // D0.2 provenance：候选必须自带「为哪句需求而算」的绑定，且与本 run 出生的
      // `--requirement`（这里是 CU id）同源，否则冻结时判 stale。
      const requirementInput = resolveCapabilityInputs({ projectRoot: root, frameworkRoot, feature, phase: 'spec', track: 'full', requirement: id,
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } }).inputs?.values?.requirement;
      assert(requirementInput && requirementInput.state === 'resolved', 'requirement: ' + JSON.stringify(requirementInput));
      candidate.request.requirement_basis = requirementInput.binding as any;
      candidate.facts.push({ id: 'design', kind: 'design-context', applicability: 'required', reason: 'approved construction', basis: [design.binding], satisfied_by: [design.binding] });
      candidate.facts.push({ id: 'implementation', kind: 'implementation', applicability: 'required', reason: 'authorized source edit', basis: [liveOf('codebase')] });
      candidate.facts.push({ id: 'acceptance', kind: 'acceptance-context', applicability: 'required', reason: 'unit acceptance', basis: [liveOf('acceptance')], satisfied_by: [liveOf('acceptance')] });
      // Pruning device verification needs the sourced impact judgement, not a self-reported fact.
      if (index === 0) candidate.request.impact = { user_visible_behavior_change: false, reason: 'unit validation covers this unit', basis: [liveOf('codebase')] };
      fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), YAML.stringify({ execution_scope: candidate }));
      const runId = 'p7-' + id;
      prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId, adapter: 'codex', requirement: id });
      const result = await runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, resume: runId, skipLegacySeal: true, viaHostBridge: true, adapter: 'codex' });
      assert.equal(result.exitCode, 0, JSON.stringify(result.events.slice(-3)));
      assert.deepStrictEqual(result.invokedPhases, ['work-unit-author']);
      assert.deepStrictEqual(result.harnessPhases, phases);
    }
    for (const [index, id] of units.entries()) {
      const observation = observeChangeUnitCompletion(root, asChangeUnitArtifact(loadCanonicalChangeUnit(root, 'ledger-app-blueprint', id).changeUnit));
      assert.equal(observation.state, 'VALID', JSON.stringify(observation));
      assert.equal(observation.expectedChain?.includes('testing'), index === 1);
    }
    const inputs = resolveComponentClosureInputs(root, 'ledger-app-blueprint');
    assert(deriveComponentClosureObligations(root, inputs).some(o => o.required && o.evidence_level === 'integration_combination'), 'CU completion removed combination evidence');
    assert(!fs.existsSync(featureFilePath(root, deriveChangeUnitFeatureId('ledger-app-blueprint', units[0]), 'testing/reports/summary.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
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
      ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/harness-runner.ts'),
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

cases.push({ name: 'revalidate under a run identity keeps out-of-scope phases out of the target set', run() {
  // ②：run 权威（范围 = coding 起）、feature 目录无冻结记录（宿主 f829b8 形态）；范围外 plan 有 stale summary。
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'rv-run', adapter: 'codex', requirement: '把 value 改成 42' });
    const runChain = [...prepared.manifest.execution_scope!.phase_chain];
    assert.deepStrictEqual(runChain, ['coding', 'review', 'ut']);
    seedRunlessChain(root, feature, ['plan', ...runChain]);
    // 范围外 plan 的 summary 在闭环后被改 → stale
    const planSummary = path.join(featurePhaseReportsDir(root, feature, 'plan', frameworkRoot), 'summary.json');
    fs.writeFileSync(planSummary, JSON.stringify({ ...JSON.parse(fs.readFileSync(planSummary, 'utf8')), note: 'edited' }));
    assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['plan'], { frameworkRoot })[0].verdict, 'stale', '前提：plan stale');
    assert(recomputePhaseEvidenceStaleness(root, feature, runChain, { frameworkRoot }).every(s => s.verdict === 'fresh'), '前提：范围内 fresh');
    const { code, out } = revalidateCaptured(root, frameworkRoot, feature, 'rv-run');
    assert.equal(code, 0, out);
    const record = JSON.parse(fs.readFileSync(featureFilePath(root, feature, REVALIDATION_RECORD_FILE), 'utf8'));
    assert.deepStrictEqual(record.chain, runChain, JSON.stringify(record.chain));
    assert.deepStrictEqual(record.targets, [], JSON.stringify(record.targets));
    assert.equal(record.exit_code, 0);
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
    assert(gate.details.includes('预测文件表不作许可'), gate.details);
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
    assert(gate.details.includes('实际 UI 变更 1 个'), gate.details);
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
    const args = ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), '--sync-closure', '--phase', 'ut', '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot];
    const runSync = () => spawnSync(process.execPath, args,
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const reportFile = path.join(reportsDir, 'script-report.json'), reportBytes = fs.readFileSync(reportFile);
    const summaryFile = path.join(reportsDir, 'summary.json'), summaryBytes = fs.readFileSync(summaryFile);
    assert(!JSON.parse(summaryBytes.toString()).closure_status && !JSON.parse(summaryBytes.toString()).closure_commit);
    assert(!loadPhaseEvidenceManifest(root, feature, 'ut'), 'the fixture must not pre-sign the missing phase evidence');
    fs.unlinkSync(reportFile);
    const missing = runSync();
    assert.notEqual(missing.status, 0, (missing.stdout ?? '') + (missing.stderr ?? ''));
    assert(((missing.stdout ?? '') + (missing.stderr ?? '')).includes('required_check_conclusion'), 'a real missing result must remain a required-check gap');
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

cases.push({ name: 'D1 three real runless harness-runner phase calls freeze once and stay run-free', run() {
  // 必修 2：**真实 CLI** 的无 run 三阶段链路。断言的是这条路径上属于 D1 的事实：
  // 首次调用冻结、之后只读复用、全程不造 run、旧 track 不再门控 phase、候选漂移当场 BLOCKER。
  // （阶段检查器本身的裁决不在本用例的判据里——那是各 checker 自己的验收。）
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    // feature.yaml 残留 lite：现代权威在场后不得再按 lite 拒掉 review/ut（阻断 1 的真实形状）
    const decl = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    decl.track = 'lite';
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    const runPhase = (phase: string) => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), '--phase', phase, '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 300000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });

    const coding = runPhase('coding');
    const combined = (result: ReturnType<typeof runPhase>) => (result.stdout ?? '') + (result.stderr ?? '');
    // ① 首次调用冻结（**由真实 CLI 落盘**，不是测试直接调函数）
    assert(fs.existsSync(featureFrozenScopePath(root, feature)), '真实 CLI 首次调用没有冻结 feature 范围：' + combined(coding));
    const frozenAt = readFeatureFrozenScope(root, feature)!.frozen_at;
    // ② 旧 track 不再门控：review / ut 不得被判成非法 phase
    for (const phase of ['review', 'ut']) {
      const result = runPhase(phase);
      assert(!combined(result).includes('的合法集'), `phase ${phase} 仍被旧 track 门控：` + combined(result));
    }
    // ③ 之后每次只读复用，不重写记录
    assert.equal(readFeatureFrozenScope(root, feature)!.frozen_at, frozenAt, '后续阶段调用重写了冻结记录');
    // ④ 全程不造 run
    assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')), '无 run 路径造出了 goal-runs 目录');
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'direct phase checks must not create Feature completion');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0, 'direct phase checks must not act as the scope runner');
    // ⑤ 候选漂移 → 真实 CLI 报 execution_scope_frozen BLOCKER
    const drifted = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    drifted.execution_scope.request.requested_results = ['drifted'];
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(drifted));
    runPhase('coding');
    const report = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'script-report.json'), 'utf8')) as { checks: Array<{ id: string; status: string; severity: string }> };
    const blocker = report.checks.find(check => check.id === 'execution_scope_frozen');
    assert(blocker, '候选漂移后真实 CLI 没有报 execution_scope_frozen：' + JSON.stringify(report.checks.map(check => check.id)));
    assert.equal(blocker!.status, 'FAIL');
    assert.equal(blocker!.severity, 'BLOCKER');
    const summary = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'summary.json'), 'utf8')) as { verdict?: string; blockers?: Array<{ id?: string }> };
    assert.equal(summary.verdict, 'FAIL');
    assert(summary.blockers?.some(item => item.id === 'execution_scope_frozen'), '当前 scope 失败未刷新 base summary');
    // Restore the original candidate, then transfer the unfinished legacy scope and existing reports.
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    const priorReport = fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'script-report.json'));
    const handed = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, adapter: 'generic', runId: '1804-legacy-transfer', requirement: '把 value 改成 42' });
    assert.equal(readFeatureFrozenScope(root, feature)!.transfers!.at(-1)!.run_id, handed.manifest.run_id);
    assert(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'script-report.json')).equals(priorReport), 'formal transfer preserves the actual prior report bytes');
    const rejoined = prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, adapter: 'generic', requirement: '把 value 改成 42' });
    assert.equal(rejoined.manifest.run_id, handed.manifest.run_id, 'same unfinished delivery must rejoin instead of creating another active run');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a coding-only runless request is managed through the candidate, and freezing does not prove it predates the edit', run() {
  // plan 7e1d4b93 · R3 的生产路径用例。回答的是需求 §8 问题 1：coding-only 的不建 run
  // 请求里，「候选 → 首次阶段调用冻结 → 候选指纹核对」这条路真实成立到什么程度。
  //
  // 三个独立 root 分别验证正常冻结、无权威拒绝、候选与源码先后顺序的观测边界。
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
    ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/harness-runner.ts'),
      '--phase', phase, '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
    { cwd: root, encoding: 'utf8', timeout: 300000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } },
  );
  const combined = (r: ReturnType<typeof runPhase>) => (r.stdout ?? '') + (r.stderr ?? '');

  // ---- 场景 A：候选在场 → 首次阶段调用冻结、之后只读复用、全程不造 run ----
  {
    const { root, frameworkRoot, feature } = runlessCodingOnly();
    try {
      seedGit(root);
      // ① 候选形状：coding-only + request 终点 ⇒ 单阶段链
      const declared = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8')) as { execution_scope?: unknown };
      assert(declared.execution_scope, '前提：夹具应已由生产 prepareFeatureScopeCandidate 写出候选');
      const first = runPhase(root, frameworkRoot, feature, 'coding');
      // ③ 首次冻结由**真实 CLI** 落盘，且记录的候选指纹＝磁盘候选指纹
      assert(fs.existsSync(featureFrozenScopePath(root, feature)), '真实 CLI 首次调用没有冻结 feature 范围：' + combined(first));
      const record = readFeatureFrozenScope(root, feature)!;
      assert.deepStrictEqual(record.execution_scope.phase_chain, ['coding'], JSON.stringify(record.execution_scope.phase_chain));
      assert.equal(record.execution_scope.completion_target, 'request', JSON.stringify(record.execution_scope.completion_target));
      assert.equal(record.candidate_fingerprint, featureScopeCandidateFingerprint(root, feature), '冻结记录的候选指纹与磁盘候选不一致');
      // 之后只读复用，不重写记录
      const frozenAt = record.frozen_at;
      const reused = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
      assert.equal(reused.status, 'reused', JSON.stringify(reused.checks));
      assert.equal(readFeatureFrozenScope(root, feature)!.frozen_at, frozenAt, '后续阶段调用重写了冻结记录');
      // ④ 全程不造 run
      assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')), '无 run 路径造出了 goal-runs 目录');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }

  // ---- 场景 B：没有候选 → 阶段根本跑不起来（「必须先经候选入口」的机器面）----
  // 拒绝不能制造阶段证据，补回真实候选后同一 root 仍能正常冻结。
  {
    const { root, frameworkRoot, feature } = runlessCodingOnly();
    try {
      seedGit(root);
      const candidate = fs.readFileSync(featureTrackDeclPath(root, feature));
      dropCandidate(root, feature);
      const blocked = runPhase(root, frameworkRoot, feature, 'coding');
      const reportPath = path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'script-report.json');
      const summaryPath = path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'summary.json');
      assert.equal(blocked.status, 1, combined(blocked));
      assert(combined(blocked).includes('execution_scope_frozen') && combined(blocked).includes('--prepare-scope'), combined(blocked));
      assert(!fs.existsSync(reportPath) && !fs.existsSync(summaryPath), '没有权威的拒绝不得发布阶段报告');
      assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '没有候选却冻结了范围');
      fs.writeFileSync(featureTrackDeclPath(root, feature), candidate);
      const recovered = runPhase(root, frameworkRoot, feature, 'coding');
      assert(fs.existsSync(featureFrozenScopePath(root, feature)), '补回候选后不得被先前拒绝污染：' + combined(recovered));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }

  // ---- 场景 C：**真正制造「候选晚于代码」** —— 删候选 → 改源码 → 生成候选 → 首次冻结 ----
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
    const cli = (...args: string[]) => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), ...args, '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const out = (result: ReturnType<typeof cli>) => (result.stdout ?? '') + (result.stderr ?? '');
    // ① 首次直接 `--sync-closure`：冻结记录由这条入口落盘
    assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '前提：尚未冻结');
    const first = cli('--sync-closure', '--phase', 'ut');
    assert(fs.existsSync(featureFrozenScopePath(root, feature)), 'sync-closure 入口没有走冻结入口：' + out(first));
    // ② 候选漂移后：sync-closure 必须报 execution_scope_frozen 并退出，不基于旧冻结范围闭环
    const decl = YAML.parse(fs.readFileSync(featureTrackDeclPath(root, feature), 'utf8'));
    decl.execution_scope.request.requested_results = ['drifted'];
    fs.writeFileSync(featureTrackDeclPath(root, feature), YAML.stringify(decl));
    const drifted = cli('--sync-closure', '--phase', 'ut');
    assert.notEqual(drifted.status, 0, 'sync-closure 在候选漂移下仍然继续了：' + out(drifted));
    assert(out(drifted).includes('候选已变更而冻结范围未经修订'), out(drifted));
    // ③ reconcile-only 同样被同一条检查拦住
    const reconcile = cli('--report-reconcile-only', '--phase', 'testing');
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
    const runtime = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/scripts/goal-phase-runtime.ts'),
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
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), '--sync-closure', '--phase', 'ut', '--feature', feature,
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
    const cli = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/scripts/goal-phase-runtime.ts'),
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
  // feature 载体（record.run_id=null）没有 run 可 supersede：空值 / 不存在的 run 都拒绝并指向「先追加修订再起新 run」；
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
    const sync = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), '--sync-closure', '--phase', 'ut', '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot], { cwd: root, encoding: 'utf8', timeout: 180000, env });
    assert.equal(sync.status, 0, (sync.stdout ?? '') + (sync.stderr ?? ''));
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'new independent closure cannot write a legacy completion');
    // Only this explicit historical fixture creates the old null-run record consumed below.
    legacyFeatureCompletionFixture({ projectRoot: root, frameworkRoot, feature, phase: 'ut', workflowTrack: 'full' });
    const projection = JSON.parse(fs.readFileSync(featureFilePath(root, feature, 'feature-completion.json'), 'utf8')) as { original_path: string };
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, projection.original_path), 'utf8')).run_id, null, '前提：feature 载体完成');
    const recordBytes = fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8');
    for (const target of ['', '20260101T000000Z-9h0st9']) {
      const cli = runRuntimeTestChild({ root }, () => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
        path.join(repo, 'harness/scripts/goal-phase-runtime.ts'),
        '--feature', feature, '--adapter', 'generic', '--supersede', target, '--requirement', '把 value 改成 42',
        '--project-root', root, '--framework-root', frameworkRoot, '--foreground-ok', '--force'],
        { cwd: root, encoding: 'utf8', timeout: 180000, env }));
      const out = (cli.stdout ?? '') + (cli.stderr ?? '');
      assert.notEqual(cli.status, 0, `--supersede ${JSON.stringify(target)} 未被拒绝：${out}`);
      assert(out.includes('追加 feature 范围修订'), `拒绝未指向修订：${out}`);
      const runsDir = featureFilePath(root, feature, 'goal-runs');
      assert(!fs.existsSync(runsDir) || !fs.readdirSync(runsDir).some(id => fs.existsSync(path.join(runsDir, id, 'manifest.json'))), '拒绝后仍建了 run');
    }
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

cases.push({ name: 'P1-T8 runless file and inline requirements reach the real spec harness without a text snapshot', run() {
  const repo = path.resolve(__dirname, '../../..');
  const invoke = (root: string, argv: string[]) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), ...argv], {
    cwd: root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' },
  });
  const prepare = (root: string, frameworkRoot: string, feature: string, requirementArgs: string[]) => invoke(root, [
    path.join(repo, 'harness/scripts/goal-mode-entry.ts'), '--prepare-scope', '--completion-target', 'request',
    '--requested-phases', 'spec', '--requested-results', 'verify requirement', '--feature', feature,
    '--project-root', root, '--framework-root', frameworkRoot, '--overwrite', ...requirementArgs,
  ]);
  const harness = (root: string, frameworkRoot: string, feature: string, requirementArgs: string[] = []) => invoke(root, [
    path.join(repo, 'harness/harness-runner.ts'), '--phase', 'spec', '--feature', feature,
    '--project-root', root, '--framework-root', frameworkRoot, ...requirementArgs,
  ]);
  const capabilityState = (root: string, feature: string) => {
    const summary = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'spec'), 'summary.json'), 'utf8')) as { capability_resolutions?: Array<{ id: string; state: string }> };
    return summary.capability_resolutions?.find(item => item.id === 'capability_spec_requirement')?.state;
  };

  {
    const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
    try {
      const req = path.join(root, 'requirements', 'request.md'); fs.mkdirSync(path.dirname(req), { recursive: true });
      fs.writeFileSync(req, '原始文件需求：验证 value。\n');
      const made = prepare(root, frameworkRoot, feature, ['--requirement-file', 'requirements/request.md']);
      assert.equal(made.status, 0, made.stderr + made.stdout);
      const binding = featureRequirementBinding(root, feature);
      assert.equal(binding.dependencies.length, 1, JSON.stringify(binding));
      assert(binding.source_refs.includes('requirements/request.md'), JSON.stringify(binding));
      harness(root, frameworkRoot, feature);
      assert.equal(capabilityState(root, feature), 'resolved', '文件需求应从冻结 binding 的原始 source 恢复');
      fs.writeFileSync(req, '被换掉的需求\n');
      const stale = harness(root, frameworkRoot, feature);
      const report = fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'spec'), 'script-report.json'), 'utf8');
      assert.notEqual(stale.status, 0);
      assert(/input binding stale|scope owner/.test(report), report);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }

  {
    const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
    try {
      const inline = '原始 inline 需求：验证 value';
      const made = prepare(root, frameworkRoot, feature, ['--requirement', inline]);
      assert.equal(made.status, 0, made.stderr + made.stdout);
      assert.equal(featureRequirementBinding(root, feature).dependencies.length, 0);
      const missing = harness(root, frameworkRoot, feature);
      assert.notEqual(missing.status, 0);
      assert((missing.stdout + missing.stderr).includes('请用 --requirement 或 --requirement-file'), missing.stdout + missing.stderr);
      const legacyFile = path.join(root, 'requirements', 'legacy-inline.md'); fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
      fs.writeFileSync(legacyFile, inline);
      harness(root, frameworkRoot, feature, ['--requirement-file', 'requirements/legacy-inline.md']);
      assert.equal(capabilityState(root, feature), 'resolved');
      const changed = harness(root, frameworkRoot, feature, ['--requirement', '另一句需求']);
      assert.notEqual(changed.status, 0);
      assert(/input binding stale|scope owner/.test(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'spec'), 'script-report.json'), 'utf8')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }

  {
    const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runless-external-requirement-'));
    const externalFile = path.join(externalRoot, 'request.md');
    try {
      fs.writeFileSync(externalFile, '项目外原始需求：验证 value。\n');
      const made = prepare(root, frameworkRoot, feature, ['--requirement-file', externalFile]);
      assert.equal(made.status, 0, made.stderr + made.stdout);
      assert.equal(featureRequirementBinding(root, feature).dependencies.length, 0, '项目外来源不得进入项目内冻结 dependency');
      const missing = harness(root, frameworkRoot, feature);
      assert.notEqual(missing.status, 0);
      assert((missing.stdout + missing.stderr).includes('请用 --requirement 或 --requirement-file'), missing.stdout + missing.stderr);
      const supplied = harness(root, frameworkRoot, feature, ['--requirement-file', externalFile]);
      assert.equal(capabilityState(root, feature), 'resolved', supplied.stderr + supplied.stdout);
      fs.writeFileSync(externalFile, '项目外另一句需求\n');
      const changed = harness(root, frameworkRoot, feature, ['--requirement-file', externalFile]);
      assert.notEqual(changed.status, 0);
      assert(/input binding stale|scope owner/.test(fs.readFileSync(path.join(featurePhaseReportsDir(root, feature, 'spec'), 'script-report.json'), 'utf8')));
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    }
  }
} });

cases.push({ name: '1804 real independent spec updates acceptance but leaves scope revision to its Goal owner', run() {
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['spec'], completionTarget: 'feature' });
  const runSpec = () => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), path.join(repo, 'harness/harness-runner.ts'),
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
    runSpec();
    assert(fs.existsSync(featureFrozenScopePath(root, feature)), '真实 harness 首次调用没有在 acceptance 已在场时冻结');
    const record = readFeatureFrozenScope(root, feature)!;
    const fingerprint = executionScopeFingerprint(featureEffectiveScope(record));
    const facts = featureFilePath(root, feature, path.join('context', 'facts.md')); fs.mkdirSync(path.dirname(facts), { recursive: true });
    fs.writeFileSync(facts, '---\n' + YAML.stringify({ schema_version: '1.1', feature, frozen_scope_fingerprint: fingerprint, established_by: 'spec', ready_to_produce: true,
      has_blocker_coverage_risk: false, source_code_paths: ['src/demo/value.ts', 'framework.config.json'], key_inputs_read: ['src/demo/value.ts', 'framework.config.json'], files_inspected_count: 5,
      searches_performed_estimate: 4, decisions_unlocked: ['correct acceptance'], exploration_mode: 'sequential' }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/demo/value.ts | value exists | acceptance correction |\n| framework.config.json | profile configured | preserve project context |\n\n## phase_delta: spec\nacceptance corrected\n');
    const acceptance = YAML.parse(fs.readFileSync(acceptancePath, 'utf8')); acceptance.criteria[0].expected_result = '42';
    fs.writeFileSync(acceptancePath, YAML.stringify(acceptance));
    const corrected = runSpec();
    assert.equal(corrected.status, 0, corrected.stderr + corrected.stdout);
    const after = readFeatureFrozenScope(root, feature)!;
    assert.equal(after.revisions.length, 0, 'independent checks do not advance a full-delivery scope');
    assert.equal(executionScopeFingerprint(featureEffectiveScope(after)), fingerprint, 'the existing scope remains available for formal transfer');
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')));
    acceptance.criteria = [];
    fs.writeFileSync(acceptancePath, YAML.stringify(acceptance));
    const invalid = runSpec();
    assert.notEqual(invalid.status, 0, '非法减空验收不得形成第二条修订');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0, 'independent invalid acceptance cannot revise orchestration');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: '4f L3 option_b 真实 checker→summary→runner 回 coding/review/UT', run: () => runScopeScenario('ut-l3-code') });
cases.push({ name: '4f L3 option_a 补链外 spec 裁定且不降 unit，再由 coding 修复后回 UT', run: () => runScopeScenario('ut-l3-spec') });

cases.push({ name: 'c6a3d918 UT real missing use-case restores chain-external plan in same run', run: () => runScopeScenario('ut-design-gap') });

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

cases.push({ name: 'repair1 R2 review to spec then confirmed chain-external coding defect', run: () => runScopeScenario('spec-gap-revert', false, false, true) });
cases.push({ name: 'repair1 R2 UT to plan then confirmed chain-external coding regression', run: () => runScopeScenario('ut-design-gap', false, false, true) });
cases.push({ name: 'repair1 R2 request-only cannot add chain-external coding', run: () => runScopeScenario('request-ut', false, false, 'request') });

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

type ScopeGroup = 'prepare-early' | 'prepare-late' | 'runtime';
// prepare 各分支自备宿主；边界按一次完整计时分为三个近等成本段。
function caseGroup(_name: string, index: number): ScopeGroup {
  return index < 21 ? 'prepare-early' : index < 37 ? 'prepare-late' : 'runtime';
}

export async function runSelectedCases(selector?: string, group?: ScopeGroup): Promise<SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const [index, test] of cases.entries()) {
    if ((group && group !== caseGroup(test.name, index)) || !matchesUnitCase(test.name, selector)) continue;
    const endTiming = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally { endTiming(); }
  }
  return selectedUnitCases(results, selector, timings);
}

export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }

export const listCaseGroups = (group?: ScopeGroup) => unitCaseGroups(cases.filter((c, i) => !group || group === caseGroup(c.name, i)).map(c => c.name));
