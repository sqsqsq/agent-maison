import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { execFileSync } from 'child_process';
import { ensureFeatureExecutionScopeFrozen, readFeatureFrozenScope, featureFrozenScopePath, featureEffectiveScope, appendFeatureScopeRevision, registerFeatureScopeTransfer, applyFeatureScopeRevisionsThenMaybeComplete } from '../../scripts/utils/feature-execution-scope';
import { resolveEffectiveDiffBaseline } from '../../scripts/utils/git-diff';
import { resolveBirthExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { checkFactsArtifact, factsBaselineFingerprint } from '../../scripts/utils/context-facts';
import { resolveFeatureTrack } from '../../scripts/utils/runtime-policy';
import { loadFeatureTrackDecl, resolveScopeRevisionProposal } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { resolveBirthScopeForManifest } from '../../scripts/utils/feature-execution-scope';
import { __testing_setInsideRecordWriteLock, __testing_setBeforeStaleLockReclaim, detectLiveFeatureLock } from '../../scripts/utils/feature-execution-scope';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { tryAcquireLock, releaseLock } from '../../scripts/utils/goal-run-lock';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { runUiDiffWithinDeclaredFiles } from '../../scripts/utils/ui-scope-gate';
import { featureTrackDeclPath } from '../../scripts/utils/feature-track';
import { SCOPE_REVISION_FIELDS as SCOPE_REVISION_FIELDS_CONST } from '../../scripts/utils/goal-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { writePhaseSummary, writePhaseReceipt } from '../utils/completion-chain-seed';
import { resolvePhaseEvidenceManifest, writePhaseEvidenceManifest, writeReceiptManifestPointer } from '../../scripts/utils/phase-evidence-manifest';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';
import { createHash } from 'crypto';
import { stableStringify, loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { setupGoalRuntimeHost, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { configureFeature } from './component-closure.unit.test';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { buildSummaryRepairCandidates, scopeRevisionInputFromRepairCandidates } from '../../scripts/utils/repair-candidates';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { resolveComponentClosureInputs } from '../../scripts/utils/component-closure-inputs';
import { deriveComponentClosureObligations } from '../../scripts/utils/component-closure-obligations';
import { buildChangeUnitGoalHandoff } from '../../scripts/utils/change-unit-progress-loop';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { verifyFeatureCompletion, verifyReusedExecutionScope, executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { loadFrozenExecutionScope, loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { resolveUpstreamPhaseChain } from '../../scripts/utils/upstream-verdict-gate';
import { featureRequirementBinding, readScopeAcceptance, collectResolvedScopeFacts, prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { codingBasePath } from '../../scripts/utils/pass-snapshot';
import { recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import * as os from 'os';
import type { AcceptanceSpec } from '../../scripts/utils/types';
import { resolveExecutionScope, validateExecutionScope, executionScopeFingerprint, executionCompletionPhases, hasNoTestingObligation, findSubtractedRequiredObligations, assertRevisionKeepsRequiredObligations, hasNewSourcedFact, type ExecutionScopeInput, type ResolvedScopeFacts } from '../../scripts/utils/execution-scope';
import { applyScopeRevisions, resolveRunBaseline, revokedPhasesByRevision, eventsWithScopeRevocations } from '../../scripts/utils/goal-run-creation';
import { applyInvalidationsToResume, deriveHaltValidationOnlyEligibility } from '../../scripts/goal-phase-runtime';
import { isClosureOnlyRetryPending } from '../../scripts/utils/goal-runner-phase';
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
const cases: Array<{ name: string; run(): void | Promise<void> }> = [
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
    assert.equal(executionScopeEvidenceIssues('.', 'demo', scope).length, 2);
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
  { name: 'P2-T7/T8 test-only recovery preserves fresh upstream phases while real product invalidation expands', run() {
    const chain = ['plan', 'coding', 'review', 'ut'];
    const outcomes = chain.map(phase => ({ phase, verdict: 'PASS' })) as never[];
    const testOnly = applyInvalidationsToResume(chain as never[], outcomes, [{ type: 'phase_backtrack_requested', invalidated_phases: ['ut'] }] as never[]);
    assert.deepStrictEqual(testOnly.outcomes.map((item: { phase: string }) => item.phase), ['plan', 'coding', 'review']);
    const productChanged = applyInvalidationsToResume(chain as never[], outcomes, [{ type: 'phase_backtrack_requested', invalidated_phases: ['coding', 'review', 'ut'] }] as never[]);
    assert.deepStrictEqual(productChanged.outcomes.map((item: { phase: string }) => item.phase), ['plan']);
  } },
  { name: 'corrupt new scope cannot become legacy full', run() {
    for (const value of [null, {}, { schema_version: '9' }]) assert.throws(() => validateExecutionScope(value));
  } },
];
async function runScopeScenario(mode: 'direct' | 'revision' | 'revision-cut' | 'revision-precut' | 'revision-revoke' | 'impact-first' | 'impact-reuse' | 'impact-null' | 'design-gap' | 'design-gap-revert' | 'spec-gap-revert' | 'detached' | 'detached-harness' | 'detached-explicit' | 'request-ut' | 'request-spec' | 'request-plan' | 'request-coding' | 'request-spec-invalid' | 'request-plan-invalid' | 'request-spec-cut' | 'request-plan-cut' | 'testing-fail' | 'testing-offline' | 'testing-manual' | 'unresolved', useDefault = false, missingMapping = false): Promise<void> {
  const repo = path.resolve(__dirname, '../../..');
  const { root } = setupGoalRuntimeHost('codex');
  const frameworkRoot = path.join(root, 'framework');
  try {
    for (const dir of ['harness', 'profiles', 'agents', 'skills', 'specs', 'templates', 'docs']) fs.symlinkSync(path.join(repo, dir), path.join(frameworkRoot, dir), process.platform === 'win32' ? 'junction' : 'dir');
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
    const designGapFamily = ['design-gap', 'design-gap-revert'].includes(mode);
    // `spec-gap-revert`：与 design-gap-revert **同构**的 spec 归属闭环（需求 D0.3「review 归因
    // spec 的用例同理」）。候选形态与 designGapFamily 一致（请求 coding/review/ut + 契约、验收、
    // 实现事实 + 有来源 impact），区别只在触发者是 review 的 spec 归属发现。
    const specGap = mode === 'spec-gap-revert';
    const codingFirst = designGapFamily || specGap;
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
    const codeFile = path.join(root, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets');
    const codeRel = path.relative(root, codeFile).replace(/\\/g, '/');
    const originalCode = fs.readFileSync(codeFile);
    // 写集授权只认受信设计来源 `contracts.files`（第七轮阻断 1：候选自带的 implementation
    // basis 是自报，不能当授权）。共享夹具的 contracts.yaml 不声明 files，**只在临时 root 里**
    // 补上真实写集，让候选的实现义务与契约授权有交集——链形状与批次 1 一致。
    {
      const declared = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
      declared.files = [codeRel];
      fs.writeFileSync(contractsFile, YAML.stringify(declared));
    }
    const contractsAtBirth = fs.readFileSync(contractsFile);
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
    if (testingOnly) input.facts.push({ id: 'unit:impact', kind: 'unit-evidence', applicability: 'not_applicable', reason: 'fixture requests device result only', basis: [binding] });
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
    if (mode === 'direct') assert.deepStrictEqual(buildChangeUnitGoalHandoff(root, asChangeUnitArtifact(loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit)).expectedChain, ['coding', 'review', 'ut']);
    if (!mode.startsWith('detached')) {
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(repo, 'harness/scripts/goal-mode-entry.ts'), '--prepare-run', '--run-mode', 'attended', '--adapter', 'codex', '--feature', feature, '--run-id', 'p2-attended', '--requirement', 'fixture delivery', '--project-root', root, '--framework-root', frameworkRoot], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } });
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    }
    if (mode === 'direct') {
      fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), 'track: lite\nexecution_scope: {broken candidate');
      source.auto_chain = [...source.auto_chain].reverse();
      fs.writeFileSync(path.join(frameworkRoot, 'workflows/scoped.workflow.yaml'), YAML.stringify(source));
    }
    let injected = false;
    let designGap = false;
    let revisionsApplied = 0;
    let detachedStarted = false;
    let recoveryMarker: string | undefined;
    const execute = () => runGoalRuntimeChain(root, { frameworkRoot, featureId: feature, resume: mode.startsWith('detached') && !detachedStarted ? undefined : 'p2-attended', runId: 'p2-attended', freshStartPhase: 'spec', freshEndPhase: 'spec', skipLegacySeal: true, viaHostBridge: !mode.startsWith('detached'), viaRuntimeClass: mode.startsWith('detached'), adapter: 'codex',
      launchCwd: ['successor', 'detached-harness', 'detached-explicit'].includes(mode) ? path.join(frameworkRoot, 'harness') : root,
      launchArgs: mode === 'detached-explicit' ? ['--project-root', root, '--framework-root', frameworkRoot] : undefined,
      // detached 分支不经 `--prepare-run` CLI，run 由这里直接创建：需求文本必须与候选
      // `requirement_basis` 同源，否则出生时会按 D0.2 provenance 判 stale 拒绝——这正是
      // 生产上「两步的 --requirement 不一致就不准出生」那条规则，夹具不得绕开。
      ...(mode.startsWith('detached') ? { freshRequirement: 'fixture delivery' } : {}),
      // design-gap also edits the file: the revision it then proposes must carry a *new* sourced
      // fact (goal-phase-runtime.ts:9084), which an unchanged file cannot provide now that the
      // birth candidate already binds the same codebase source.
      onCoding: () => {
        // `design-gap-revert`：第一轮 coding 误改（触发 plan 裁决），plan 拒绝扩展契约后
        // 第二轮 coding **把文件改回原字节**——这正是 §5.1.1a 要保护的闭环。
        if (mode === 'design-gap-revert') { if (designGap) fs.writeFileSync(codeFile, originalCode); else fs.appendFileSync(codeFile, '\n// unjustified edit\n'); return; }
        if (['direct', 'design-gap', 'revision-revoke'].includes(mode)) fs.appendFileSync(codeFile, '\n// authorized P2 implementation\n');
      },
      onHarnessSummary: ({ phase }) => {
        // Three shapes of "not a new fact": a plain blocker, an offline device and a human-only
        // verdict. None of them may produce a revision (D2.3: PASS/FAIL never drives scope).
        if (mode === 'testing-fail') return { checks: [{ id: 'device_result_failed', category: 'structure', description: 'device evidence failed', severity: 'BLOCKER', status: 'FAIL', details: 'observed failure', suggestion: 'repair the actual failure' }] };
        if (mode === 'testing-offline') return { checks: [{ id: 'device_available', category: 'structure', description: 'device is offline', severity: 'BLOCKER', status: 'FAIL', details: 'no device attached', failure_kind: 'device_offline', blocking_class: 'external_blocked', actionability: 'human_only', suggestion: 'attach a device' }] };
        if (mode === 'testing-manual') return { checks: [{ id: 'device_result_manual', category: 'structure', description: 'verification needs a human', severity: 'BLOCKER', status: 'FAIL', details: 'manual verification required', failure_kind: 'manual_verification_required', actionability: 'human_only', suggestion: 'verify on a real device' }] };
        // `revision-precut`: cut BEFORE the runtime ever validates the proposal (this hook fires
        // inside the fake harness, ahead of the report write and the revision budget).
        if (mode === 'revision-precut' && phase === 'spec' && !injected) { injected = true; throw new Error('injected pre-validation cut'); }
        // `revision-revoke`: a SECOND revision, proposed after spec already closed and revision #1
        // attached its closure evidence. It withdraws that proof — the historical PASS must not be
        // re-attached, and (combined with the cut below) must not survive recovery either.
        if (mode === 'revision-revoke' && phase === 'coding' && !designGap) {
          designGap = true;
          const revision = request(['spec', 'coding', 'review', 'ut', 'testing'], 'feature');
          // The new sourced fact is the code observation (a revision-trigger kind, so later coding
          // edits do not make it stale); the revocation itself keeps the acceptance source, which is
          // what an acceptance duty is actually bound to.
          revision.facts.push(
            { id: 'design:new-api', kind: 'design-decision', applicability: 'required', reason: 'coding 发现新的公开接口', basis: [liveBinding('plan', 'codebase')] },
            { id: 'acceptance-context:request:spec', kind: 'acceptance-context', applicability: 'required', reason: '新事实使已闭环的 spec 证据失效', basis: [liveBinding('ut', 'acceptance')] });
          return { checks: [{ id: 'scope_spec_invalidated', category: 'structure', description: 'closed spec evidence no longer answers the request', severity: 'BLOCKER', status: 'FAIL', details: 'spec must run again', suggestion: 'return to spec owner', scope_revision_input: revision }] };
        }
        // `spec-gap-revert` 的触发者是 **review 的 spec 归属发现**：finding 指向 feature 自己的
        // `acceptance.yaml`（`deriveCategoryFromFiles` 按路径域判 spec，且全部文件同域才产候选），
        // verifier 逐条确认之后，**用生产函数**把候选变成修订输入——不手拼 revision。
        if (specGap && phase === 'review' && !designGap) {
          designGap = true;
          const issueId = 'CR-SPEC-001';
          const triggerRel = path.relative(root, featureFilePath(root, feature, 'acceptance.yaml')).split(String.fromCharCode(92)).join('/');
          const fix = '验收缺少刷新后的空列表定义，需 spec 补';
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
        if (!designGapFamily || phase !== 'coding' || designGap) return null;
        designGap = true;
        // 触发走**真实归属链**（第八轮必修 2）：check-coding 的 `ui_diff_within_declared_files`
        // 带机器归因 `ui_scope_violation` → 既有注册表判 plan → `buildSummaryRepairCandidates`
        // → `scopeRevisionInputFromRepairCandidates` 产出修订输入。不再手拼 revision：
        // 修订的 request / facts / 绑定全部由生产函数算，impact 由它自己从有效范围继承。
        const violationDetails = `coding 改动超出 plan 冻结的 UI scope 白名单：${codeRel}`;
        const codingCandidates = buildSummaryRepairCandidates({
          phase: 'coding', reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
          checks: [{ id: 'ui_diff_within_declared_files', status: 'FAIL', severity: 'BLOCKER', details: violationDetails, failure_kind: 'ui_scope_violation', affected_files: [codeRel] }],
        });
        assert.deepStrictEqual(codingCandidates.map(candidate => [candidate.category, candidate.source_phase, candidate.files]), [['plan', 'coding', [codeRel]]], JSON.stringify(codingCandidates));
        const codingRevision = scopeRevisionInputFromRepairCandidates(codingCandidates, { projectRoot: root, frameworkRoot, feature, runId: 'p2-attended' });
        assert(codingRevision, '真实 plan 归属候选没有产出修订输入');
        assert(codingRevision!.input.facts.some(fact => fact.kind === 'design-decision'), JSON.stringify(codingRevision!.input.facts.map(fact => fact.id)));
        assert(codingRevision!.input.request.requested_phases.includes('plan'), JSON.stringify(codingRevision!.input.request.requested_phases));
        return { checks: [{ id: 'ui_diff_within_declared_files', category: 'structure', description: 'coding changed a file outside the frozen UI scope', severity: 'BLOCKER', status: 'FAIL', details: violationDetails, failure_kind: 'ui_scope_violation', suggestion: 'return to plan owner', scope_revision_input: codingRevision!.input }] };
      },
      onPlan: () => {
        // `request-plan`：plan 阶段的真实产出就是设计契约——写出 contracts.yaml（含可核验写集），
        // 让生产的 `designScopeRevisionChecks` 有真实绑定可发布。`invalid` 变体故意产出不合法内容。
        if (!mode.startsWith('request-plan')) return;
        // 反向变体：plan 产出**不合法**的设计契约（YAML 都解析不了）——生产的能力解析拿不到可用绑定，
        // 设计检查因此发不出修订。拒绝发生在生产侧，不是夹具「不发」。
        if (invalidOutput) { fs.writeFileSync(contractsFile, 'files: [ {broken\n'); return; }
        fs.writeFileSync(contractsFile, YAML.stringify({ ...YAML.parse(contractsAtBirth.toString('utf8')), files: [codeRel] }));
      },
      onSpec: () => {
        // `spec-gap-revert`：责任阶段 spec 重跑时**修复触发文件**（补上被 review 指出的缺口），
        // 验收层级保持 unit——责任是补定义，不是把范围扩到设备验证。
        if (specGap) {
          fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
            'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}, {id: AC-EMPTY, priority: P1, ut_layer: unit, desc: refresh with no entries, expected_result: empty state}]' + String.fromCharCode(10));
          return;
        }
        if (invalidOutput && requestOnly) { fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-BROKEN\n'); return; }
        fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, desc: device verification}]' + String.fromCharCode(10));
      },
      afterHarnessPass: ({ phase, runId }) => {
        // `spec-gap-revert`：spec 修复了触发文件之后，必须把**真实验收输入**重新绑定到新内容
        // ——这正是生产里 R3（`designScopeRevisionChecks`）经 spec 的 script-report 发布新设计
        // 内容的那一步。§5.1.1a 的豁免只对**触发依据**那两个 kind 生效，真实设计输入一行不放宽，
        // 所以不重绑就会（正确地）判 `input binding stale`、完不成。
        if (specGap && phase === 'spec') {
          const freshAcceptance = liveBinding('ut', 'acceptance');
          const current = loadEffectiveExecutionScope(root, feature, runId)!;
          const revision = request(['coding', 'review', 'ut'], 'feature');
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
        if (mode === 'revision') revision.facts.push({ id: 'acceptance-context:fake-gap', kind: 'acceptance-context', applicability: 'unknown', reason: '手写的假缺口', basis: [fresh], satisfied_by: [fresh] });
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
        // revision-revoke: cut right after the SECOND revision (the one that revoked the closed
        // spec evidence) — recovery must still re-run spec instead of reusing its historical PASS.
        revisionsApplied += 1;
        if (!injected && mode === 'revision-revoke' && revisionsApplied === 2) { injected = true; throw new Error('injected post-revocation cut'); }
      },
    });
    let probe: Awaited<ReturnType<typeof execute>>;
    try { probe = await execute(); } catch (error) {
      if (!injected) throw error;
      probe = await execute();
    }
    if (probe.exitCode !== 0 && injected) probe = await execute();
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
      assert.deepStrictEqual(probe.invokedPhases, mode.endsWith('-cut') ? [] : [requestPhase]);
      if (mode.endsWith('-cut')) assert(injected, '中断点没被触发，这条用例没证明 resume');
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'request created Feature completion');
      const frozen = loadFrozenExecutionScope(root, feature, 'p2-attended')!;
      assert.equal(frozen.completion_target, 'request', JSON.stringify(frozen));
      assert.deepStrictEqual(frozen.phase_chain, [requestPhase], JSON.stringify(frozen.phase_chain));
      // 反向边界（与上面的成功终局同一条修订通道）：单职责修订能关本阶段的缺口，但**不得**借提案
      // 把别的阶段塞进请求动作——否则「只做本职责」会被一条 PASS 检查悄悄扩成整条链。
      assert.throws(() => resolveScopeRevisionProposal({
        projectRoot: root, frameworkRoot, feature, workflow: resolveWorkflowSpec(root, { frameworkRoot }),
        proposals: [{ request: { completion_target: 'request', requested_results: frozen.requested_results, requested_phases: [requestPhase, 'testing'] }, facts: [], contract_fingerprints: [] }],
        previous: frozen, authorizedPhases: frozen.phase_chain,
      }), /request-scope revision cannot add phases/);
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
        assert(replayFromBirth, '重放真实提案没算出范围');
        assert.equal(executionScopeFingerprint(replayFromBirth!.scope), executionScopeFingerprint(effective), '重放同一份提案算出了另一份范围');
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
    assert.equal(probe.exitCode, 0, JSON.stringify(probe.events.slice(-5)));
    detachedStarted = true;
    if (mode === 'direct') {
      assert.deepStrictEqual(probe.invokedPhases, ['coding', 'review', 'ut']);
      for (const skipped of ['spec', 'plan', 'testing']) assert(!fs.existsSync(featureFilePath(root, feature, `${skipped}/reports/summary.json`)), 'invented out-of-scope phase summary');
    }
    else {
      if (mode === 'revision') {
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
      // revision-revoke applies three: #1 when spec closes, #2 when coding invalidates that closure,
      // #3 when the re-run spec publishes its NEW closure evidence (the only thing that changed).
      // `spec-gap-revert` 有两条：① review 归因 spec 的修订；② spec 修复后重绑真实验收输入。
      assert.equal(revisions.length, mode === 'revision-revoke' ? 3 : specGap ? 2 : 1, 'duplicate scope revision');
      assert.equal(revisions[0].revision_index, 1, 'revision index must start at 1');
      // design-gap revises the chain back to plan, so coding is legitimately dispatched TWICE;
      // the revision mode never returns to spec, so spec stays at one.
      // `revision-precut` is cut before the proposal is ever validated, so spec runs twice too.
      const sourcePhase = designGapFamily ? 'coding' : 'spec';
      const sourceInvokes = sourceEvents.filter(event => event.type === 'agent_invoke_start' && event.phase === sourcePhase);
      const expectedSourceInvokes = designGapFamily || ['revision-precut', 'revision-revoke'].includes(mode) ? 2 : 1;
      assert.equal(sourceInvokes.length, expectedSourceInvokes, 'revised chain did not re-dispatch the responsible phase');
      if (expectedSourceInvokes === 2) assert(sourceInvokes[1].invoke_id !== sourceInvokes[0].invoke_id, 're-dispatch reused the same invoke id');
      if (mode === 'revision-precut') assert(injected, 'the pre-validation cut was never reached');
      const effective = loadEffectiveExecutionScope(root, feature, 'p2-attended')!;
      const expectedChain = designGapFamily ? ['plan', 'coding', 'review', 'ut']
        : specGap ? ['spec', 'coding', 'review', 'ut']
        // spec is back OUT of the chain at the end: revision #3 re-attached its fresh closure
        // evidence, so it is a reused phase again (and only then).
        : mode === 'revision-revoke' ? ['plan', 'coding', 'review', 'ut', 'testing']
        : ['coding', 'review', 'ut', 'testing'];
      assert.deepStrictEqual(effective.phase_chain, expectedChain);
      if (mode === 'revision-revoke') {
        // The withdrawn proof is not re-attached; the phase returns to the chain; and — because the
        // cut lands right after that revision — the re-run happens on RECOVERY, from events alone.
        const revokeAt = sourceEvents.findIndex(event => event.type === 'scope_revised' && event.revision_index === 2);
        // Recovery does NOT depend on a second event: the cut lands immediately after the single
        // `scope_revised` write, and the revoked phase is derived from that record's own content.
        assert(!sourceEvents.some(event => event.type === 'phase_invalidated'), 'a second event was written next to the revision');
        assert(sourceEvents.slice(revokeAt).some(event => event.type === 'agent_invoke_start' && event.phase === 'spec'), 'recovery reused the pre-revision spec PASS');
        assert(injected, 'the post-revocation cut was never reached');
        assert.deepStrictEqual(revokedPhasesByRevision(loadFrozenExecutionScope(root, feature, 'p2-attended')!, sourceEvents).get(2), ['spec'], 'the revocation is not derivable from the revision itself');
        const specDuty = effective.obligations.find(o => o.id === 'acceptance-context:request:spec')!;
        assert(specDuty.satisfied_by?.some(ref => 'run_id' in ref), 'the re-run phase never re-published its closure evidence');
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
      const afterRevision = sourceEvents.slice(revisionAt).find(event => event.type === 'agent_invoke_start');
      // Turn budget is continuous across the revision: the next invoke is the next sequence number,
      // never a reset to i1. (`revision-precut` spends one extra turn on the interrupted spec run.)
      // `spec-gap-revert` 的修订发生在 review（coding=i1、review=i2），所以下一轮是 i3；
      // 既有模式的预期一行未改。
      assert(afterRevision?.invoke_id.endsWith(['revision-precut', 'spec-gap-revert'].includes(mode) ? '-i3' : '-i2'), 'revision reset consumed turns: ' + afterRevision?.invoke_id);
      if (mode === 'design-gap-revert') {
        // §5.1.1a 的闭环：plan 拒绝扩展契约 → coding 撤回误改 → 责任阶段证据仍 fresh、完成仍 VALID。
        // ① plan 没有扩大写集（契约文件字节未变）
        assert(fs.readFileSync(contractsFile).equals(contractsAtBirth), 'plan widened the frozen write set');
        // ② coding 把触发文件改回了原字节
        assert(fs.readFileSync(codeFile).equals(originalCode), 'the unjustified edit was never reverted');
        // ③ 历史触发摘要不再阻断（R-摘要豁免那一路）
        const issues = executionScopeEvidenceIssues(root, feature, effective, undefined, 'p2-attended');
        assert(!issues.some(issue => issue.includes('input binding stale')), issues.join('; '));
        // ④ 责任阶段证据仍 fresh，且触发文件没有作为当前输入进过 plan 的证据（R-目标收集那一路）
        assert.equal(recomputePhaseEvidenceStaleness(root, feature, ['plan'], { frameworkRoot })[0].verdict, 'fresh');
        const planEvidence = loadPhaseEvidenceManifest(root, feature, 'plan');
        assert(planEvidence?.integrityOk, 'plan evidence missing');
        assert(!planEvidence!.manifest.inputs.some(entry => entry.path === codeRel), 'the revision trigger entered plan evidence as a current input');
      }
      if (specGap) {
        // §5.1.1a 的 spec 侧闭环：review 归因 spec → 同 run 修订 → spec 重跑修复触发文件 → 完成 VALID。
        // ① 责任阶段确实重跑了（修订之后有 spec 的 invoke）
        assert(sourceEvents.slice(revisionAt).some(event => event.type === 'agent_invoke_start' && event.phase === 'spec'), 'spec 责任阶段在修订后没有重跑');
        // ② 触发文件（acceptance.yaml）确实被修复了——字节与修订触发时不同
        const acceptanceNow = fs.readFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'utf8');
        assert(acceptanceNow.includes('AC-EMPTY'), '触发文件没有被责任阶段修复：' + acceptanceNow);
        // ③ 修订触发依据的历史摘要不再阻断完成（豁免按 kind：acceptance-definition）
        const specIssues = executionScopeEvidenceIssues(root, feature, effective, undefined, 'p2-attended');
        assert(!specIssues.some(issue => issue.includes('input binding stale')), specIssues.join('; '));
        // ④ 修订事实确实是 acceptance-definition（spec 家族），不是被当成 design 归属
        const trigger = effective.obligations.find(o => o.kind === 'acceptance-definition');
        assert(trigger && trigger.owner_phase === 'spec', JSON.stringify(effective.obligations.map(o => [o.id, o.kind, o.owner_phase])));
        // ⑤ 反例（时序）：缺口未处理时完不成——本 run 的终局必须发生在 spec 重跑**之后**，
        // 而不是在修订落下的那一刻就收尾。
        const specRerunAt = sourceEvents.findIndex((event, index) => index >= revisionAt && event.type === 'agent_invoke_start' && event.phase === 'spec');
        const completedAt = sourceEvents.findIndex(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED');
        assert(specRerunAt >= 0 && completedAt > specRerunAt, 'run 在 spec 修复缺口之前就收尾了');
        // ⑥ 反例（结构）：缺口的责任阶段确实进了链——不是被跳过或被降级掉。
        assert(effective.phase_chain.includes('spec'), JSON.stringify(effective.phase_chain));
        // ⑦ 修复后的 acceptance.yaml 仍是 spec 的**正式证据输入**（§5.4 那一行的要点：它既是
        // spec 的输入也是它的产出，同路径 input/output 合并为 both 后仍列入 inputs；
        // 因此这里断言「在 inputs 里」，而**不是**照抄 plan 侧的「不含触发文件」）。
        const specEvidence = loadPhaseEvidenceManifest(root, feature, 'spec');
        assert(specEvidence?.integrityOk, 'spec evidence missing');
        const acceptanceRel = path.relative(root, featureFilePath(root, feature, 'acceptance.yaml')).split(String.fromCharCode(92)).join('/');
        assert(specEvidence!.manifest.inputs.some(entry => entry.path === acceptanceRel),
          '修复后的验收文件没有作为 spec 的正式证据输入登记：' + JSON.stringify(specEvidence!.manifest.inputs.map(entry => entry.path)));
      }
      if (designGapFamily) {
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
      assert.equal(completionRecord.execution_scope_fingerprint, executionScopeFingerprint(effective), 'completion fingerprint is not the effective scope');
      const writeCompletion = (record: unknown): void => {
        const bytes = JSON.stringify(record);
        fs.writeFileSync(completionFile, bytes);
        fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify({ ...completionProjection, original_sha256: createHash('sha256').update(bytes).digest('hex') }));
      };
      const completionVerdict = (): string => verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: executionCompletionPhases(effective), expectedTrack: 'full' }).verdict;
      writeCompletion({ ...completionRecord, scope_revision_count: revisions.length - 1 });
      assert.equal(completionVerdict(), 'INVALID', 'a revision-count mismatch was accepted');
      // A 1.2 record MUST carry the count: a stripped field is a damaged certificate, not a zero.
      const { scope_revision_count: _dropped, ...withoutCount } = completionRecord as Record<string, unknown>;
      writeCompletion(withoutCount);
      assert.equal(completionVerdict(), 'INVALID', 'a completion with no scope_revision_count was accepted');
      fs.writeFileSync(completionFile, completionBytes);
      fs.writeFileSync(featureFilePath(root, feature, 'feature-completion.json'), JSON.stringify(completionProjection));
    }
    const verified = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full' });
    assert.equal(verified.verdict, 'VALID', JSON.stringify(verified));
    const cu = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh');
    const cuCompletion = observeChangeUnitCompletion(root, asChangeUnitArtifact(cu.changeUnit));
    if (missingMapping) { assert.equal(cuCompletion.state, 'INVALID'); assert(cuCompletion.reasons.some(reason => reason.includes('mapping'))); return; }
    assert.equal(cuCompletion.state, 'VALID', JSON.stringify(cuCompletion));
    assert.deepStrictEqual(cuCompletion.expectedChain, mode === 'direct' ? ['coding', 'review', 'ut']
      : designGapFamily ? ['plan', 'coding', 'review', 'ut']
      : specGap ? ['spec', 'coding', 'review', 'ut']
      : mode === 'revision-revoke' ? ['spec', 'plan', 'coding', 'review', 'ut', 'testing']
      : ['spec', 'coding', 'review', 'ut', 'testing']);
    if (mode === 'direct') {
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
      fs.appendFileSync(contractsFile, '\n# stale design contract\n');
      // §4.1.4 on the PRODUCTION path: the reading layer re-resolves every `satisfied_by` binding,
      // so a drifted design source is reported as not-ok and the freeze is refused — no hand-built
      // verdict, both the binding and the drift are real.
      const staleFacts = collectResolvedScopeFacts(reuseInput, { projectRoot: root, feature, frameworkRoot, requirement: 'fixture delivery', impactInherited: true });
      assert(staleFacts.satisfied_by.some(entry => !entry.ok), JSON.stringify(staleFacts.satisfied_by));
      assert.throws(() => resolveExecutionScope(reuseInput, workflow, undefined, staleFacts), /冻结时核验失败/);
      assert.notEqual(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: previous.phase_chain, expectedTrack: 'full' }).verdict, 'VALID', 'stale design contract accepted');
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
        assert.equal(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: previous.phase_chain, expectedTrack: 'full' }).verdict, 'INVALID');
      }
      fs.writeFileSync(original, originalBytes); fs.writeFileSync(projectionFile, JSON.stringify(projection));
      record.chain = ['ut']; record.phases = record.phases.filter((phase: { phase: string }) => phase.phase === 'ut');
      const bytes = JSON.stringify(record); fs.writeFileSync(original, bytes);
      fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, original_sha256: createHash('sha256').update(bytes).digest('hex') }));
      assert.equal(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: ['ut'], expectedTrack: 'full' }).verdict, 'INVALID', 'self-authored completion chain bypassed frozen scope');
      const manifestFile = featureFilePath(root, feature, 'goal-runs/p2-attended/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); delete manifest.execution_scope;
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      assert.throws(() => loadFrozenExecutionScope(root, feature, 'p2-attended'), /出生摘要|scope/);
    }
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}
for (const mode of ['direct', 'revision', 'revision-cut', 'revision-precut', 'revision-revoke', 'impact-first', 'impact-reuse', 'impact-null', 'design-gap', 'design-gap-revert', 'spec-gap-revert', 'detached', 'detached-harness', 'detached-explicit', 'request-ut', 'request-spec', 'request-plan', 'request-coding', 'request-spec-invalid', 'request-plan-invalid', 'request-spec-cut', 'request-plan-cut', 'testing-fail', 'testing-offline', 'testing-manual', 'unresolved'] as const) cases.push({ name: 'real prepare CLI / bridge scope lifecycle: ' + mode, run: () => runScopeScenario(mode) });
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
  assert(deriveHaltValidationOnlyEligibility(awaitingValidation as never[]), 'premise: without the projection this looks validation-only');
  assert.equal(deriveHaltValidationOnlyEligibility(eventsWithScopeRevocations(birth, awaitingValidation as never[]) as never[]), null,
    'a revoked phase must not be resumed as validation-only');
  // (c) and the invalidation filter itself still drops the pre-revision PASS — with the same
  // premise assertion: without the projection that outcome survives.
  const priorPass = () => [{ phase: 'spec', verdict: 'PASS' }] as never[];
  assert.equal(applyInvalidationsToResume(['spec'] as never[], priorPass(), closurePending as never[]).outcomes.length, 1,
    'premise: without the projection the pre-revision PASS is kept');
  assert.equal(applyInvalidationsToResume(['spec'] as never[], priorPass(),
    eventsWithScopeRevocations(birth, closurePending as never[]) as never[]).outcomes.length, 0,
    'the pre-revision PASS must be dropped once the revocation is projected');
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

cases.push({ name: 'D0.2 a real CU candidate comes from the generator, and an undeclared write set is a plan gap', async run() {
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
    // 这份共享 CU 夹具的 contracts.yaml 不声明 files（`contracts.yaml` 无 `files` 字段）：
    // 写集授权只认受信设计来源，所以真实结果是**设计缺口**，不是「直接可用的完整链」。
    const gapped = generate();
    assert.equal(gapped.candidate.facts.find(fact => fact.kind === 'design-context')!.applicability, 'unknown', JSON.stringify(gapped.candidate.facts));
    assert(!gapped.scope.phase_chain.includes('coding'), JSON.stringify(gapped.scope.phase_chain));
    assert(gapped.scope.unresolved.some(gap => gap.needed_by.includes('coding')), JSON.stringify(gapped.scope.unresolved));
    // 这份夹具同样没有可解析的验收来源，所以出生链此刻只有调查阶段。
    assert.deepStrictEqual(gapped.scope.phase_chain, ['spec', 'plan']);
    assert.equal(gapped.candidate.facts.find(fact => fact.kind === 'acceptance-context')!.applicability, 'unknown');
    // 设计声明写集、验收落到临时 root 之后，同一条生成路径产出的候选可被真实 `--prepare-run` 冻结。
    fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
      'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}]' + String.fromCharCode(10));
    const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
    const declared = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
    declared.files = ['02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets'];
    fs.writeFileSync(contractsFile, YAML.stringify(declared));
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
      assert.deepStrictEqual(result.invokedPhases, phases);
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
function seedRunlessChain(root: string, feature: string, chain: readonly string[], openPhase?: string): void {
  const requirementSha = computeRunRequirementSha(root, feature, undefined);
  if (chain.includes('review')) writeReviewClosureAttestation({ projectRoot: root, feature, expectProductSources: false, now: () => new Date('2026-07-13T00:00:00.000Z') });
  for (const phase of chain) {
    writePhaseSummary(root, feature, phase, 'PASS');
    if (phase === openPhase) {
      // 待闭环阶段：只留 PASS 的 summary 与 receipt，closure / evidence manifest 由被测的
      // 生产闭环路径自己写——预置它们会与 finalize 重新绑定的字节冲突。
      const summaryAbs = path.join(featurePhaseReportsDir(root, feature, phase), 'summary.json');
      const doc = JSON.parse(fs.readFileSync(summaryAbs, 'utf8'));
      delete doc.closure_status; delete doc.closure_commit;
      fs.writeFileSync(summaryAbs, JSON.stringify({ ...doc, blocker_count: 0 }));
      writePhaseReceipt(root, feature, phase);
      continue;
    }
    // 生产 closure 判据要求 summary 自带 blocker_count（seed 助手只写 verdict 家族字段）
    {
      const summaryAbs = path.join(featurePhaseReportsDir(root, feature, phase), 'summary.json');
      const doc = JSON.parse(fs.readFileSync(summaryAbs, 'utf8'));
      fs.writeFileSync(summaryAbs, JSON.stringify({ ...doc, blocker_count: 0 }));
    }
    writePhaseReceipt(root, feature, phase);
    const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
      projectRoot: root, feature, phase: phase as never, now: () => new Date('2026-07-13T00:00:00.000Z'), requirementSha,
    }));
    writeReceiptManifestPointer(root, feature, phase, path.relative(root, written.absPath).split(path.sep).join('/'), written.sha256);
  }
}

/** 最小 1.2 项目：config + workflow + feature.yaml 候选。返回 root 与 frameworkRoot。 */
function setupRunlessProject(options?: { chain?: string[]; uiFile?: boolean; completionTarget?: 'feature' | 'request' }): { root: string; frameworkRoot: string; feature: string } {
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

    const first = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'spec', workflowTrack: 'full' });
    assert.equal(first.revisionApplied, true, '第一次收尾没有应用修订：' + JSON.stringify(first));
    const afterFirst = readFeatureFrozenScope(root, feature)!;
    assert.equal(afterFirst.revisions.length, 1, JSON.stringify(afterFirst.revisions.length));
    assert.deepStrictEqual(featureEffectiveScope(afterFirst).unresolved, [], '修订没关掉定义缺口');
    // 第二次：同一份报告、同一份提案，**不得**抛错、不得再写一条修订。
    const second = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'spec', workflowTrack: 'full' });
    // `skippedReason` 必须是**完成阶段**那一条（`scope_not_complete`＝request 终点不生成 Feature
    // completion），不是前置守卫（`run-authority` / `no-frozen-record` / `transferred`）——
    // 后者意味着这一次根本没走到提案校验，断言就成了空转。
    assert.equal(second.skippedReason, 'scope_not_complete', '第二次收尾没走到提案校验：' + JSON.stringify(second));
    assert.equal(second.revisionApplied, false, '重复收尾又写了一条修订：' + JSON.stringify(second));
    assert.equal(second.completionPath, undefined, 'request 终点的收尾生成了 Feature completion');
    const afterSecond = readFeatureFrozenScope(root, feature)!;
    assert.equal(afterSecond.revisions.length, 1, '修订数被重复收尾改动了：' + afterSecond.revisions.length);
    assert.equal(executionScopeFingerprint(featureEffectiveScope(afterSecond)), executionScopeFingerprint(featureEffectiveScope(afterFirst)), '重复收尾改动了有效范围');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless interactive delivery reaches VALID completion', run() {
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

    // ③ 收尾出口：应用修订 → 重读有效范围 → 生成完成原件
    const outcome = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert(outcome.completionPath, '无 run 完成原件未生成：' + JSON.stringify(outcome));
    assert(outcome.completionPath!.split(path.sep).join('/').includes(`${feature}/completion/`), outcome.completionPath);

    // ④ 完成判定 VALID，且原件形状按 D1.5
    const completion = JSON.parse(fs.readFileSync(outcome.completionPath!, 'utf8'));
    assert.equal(completion.run_id, null);
    assert.equal(completion.scope_source, 'feature');
    assert.deepStrictEqual(completion.phases.map((p: { run_id: unknown }) => p.run_id), chain.map(() => null));
    const verdict = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(verdict.verdict, 'VALID', JSON.stringify(verdict.reasons));

    // ⑤ 无 goal-runs 目录、无 spec/plan/testing 空报告
    assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')), '无 run 路径造出了 goal-runs 目录');
    for (const skipped of ['spec', 'plan', 'testing']) {
      assert(!fs.existsSync(featureFilePath(root, feature, `${skipped}/reports/summary.json`)), `凭空产出了 ${skipped} 报告`);
    }
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
    assert.equal(after.transferred_to, 'd1-run');
    assert.equal(after.transferred_scope_fingerprint, executionScopeFingerprint(effective));
    assert.equal(after.revisions.length, 1);
    assert.deepStrictEqual(after.execution_scope.phase_chain, birth.phase_chain);
    // 转入后无 run 调用不再选 feature 载体，而是明确报错（D1.3 第三行）
    const afterTransfer = ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    assert.equal(afterTransfer.status, 'not-applicable');
    assert(afterTransfer.checks[0]?.details?.includes('已转交给 run d1-run'), JSON.stringify(afterTransfer.checks));
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
    assert.equal(readFeatureFrozenScope(root, feature)!.transferred_scope_fingerprint, effective);
    // ③ 同一 feature 不得再转交给第二个 run——两个 run id 都在报错里
    assert.throws(() => registerFeatureScopeTransfer({ projectRoot: root, feature, runId: 'r2', transferredScopeFingerprint: effective }),
      (error: Error) => /已转交给 run r1/.test(error.message) && /r2/.test(error.message));
    // ④ 已登记的指纹被手改（转交记录损坏）→ 同一 run 重试也必须报错，不静默覆盖
    const doc = JSON.parse(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'));
    doc.transferred_scope_fingerprint = 'b'.repeat(64);
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
    const bare = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
    assert.notEqual(bare.verdict, 'VALID', JSON.stringify(bare));
    // ② 正常生成后 VALID
    const outcome = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert(outcome.completionPath, JSON.stringify(outcome));
    assert.equal(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot }).verdict, 'VALID');
    // ③ 冻结记录的范围内容被非法改动 → INVALID（指纹失配）
    const doc = JSON.parse(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'));
    doc.execution_scope.requested_results = ['tampered'];
    fs.writeFileSync(featureFrozenScopePath(root, feature), JSON.stringify(doc));
    const tampered = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
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
    const forgedVerdict = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
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
    const perPhaseVerdict = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
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
    assert(gate.details.includes('feature 冻结范围'), gate.details);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless ui scope gate blocks an undeclared ui file', run() {
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
    // 必须是 FAIL——**不是** SKIP、**不是**只降 MINOR
    assert.equal(gate.status, 'FAIL', JSON.stringify(gate));
    assert.equal(gate.failureKind, 'ui_scope_violation', JSON.stringify(gate));
    assert(gate.affectedFiles?.some(file => file.endsWith('Rogue.ets')), JSON.stringify(gate.affectedFiles));
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
    assert.deepStrictEqual(loadEffectiveExecutionScope(root, feature, 'd1-inrun')!.phase_chain, ['plan', ...transferred.phase_chain]);
    assert.equal(fs.readFileSync(featureFrozenScopePath(root, feature), 'utf8'), before);
    // 唯一的「损坏」判据仍成立：转交指纹 = run 出生范围指纹
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.transferred_scope_fingerprint, executionScopeFingerprint(validateExecutionScope(prepared.manifest.execution_scope!)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 runless completion is generated at the sync-closure exit', run() {
  // §6.9：`--sync-closure` 出口走**真实 harness-runner CLI**（含真实 check-receipt 与生产
  // finalize），断言无 run 完成原件确实由这条出口生成。
  // 普通阶段尾部出口调的是**同一个** `applyFeatureScopeRevisionsThenMaybeComplete`
  //（函数级覆盖见 `D1 runless interactive delivery reaches VALID completion`），
  // 其 CLI 级覆盖的缺口在 §11 批次 3 如实记录。
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
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), '--sync-closure', '--phase', 'ut', '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    assert.equal(cli.status, 0, (cli.stdout ?? '') + (cli.stderr ?? ''));
    assert(fs.existsSync(projectionAbs), 'sync-closure 出口没有生成无 run 完成原件：' + (cli.stdout ?? ''));
    const projection = JSON.parse(fs.readFileSync(projectionAbs, 'utf8')) as { original_path: string };
    assert(projection.original_path.includes(`${feature}/completion/`), projection.original_path);
    const completion = JSON.parse(fs.readFileSync(path.join(root, projection.original_path), 'utf8'));
    assert.equal(completion.run_id, null);
    assert.equal(completion.scope_source, 'feature');
    assert.equal(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot }).verdict, 'VALID');
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
    assert.equal(record.transferred_to, 'd1-detached');
    assert.equal(record.transferred_scope_fingerprint, executionScopeFingerprint(resolved.scope!));
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
    // 冻结之前：没有权威，沿用声明（lite）——旧行为一行不改
    assert.equal(resolveFeatureTrack(loadFeatureTrackDecl(root, feature)), 'lite');
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
    assert.throws(() => applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'coding', workflowTrack: 'full' }), /无法解析/);
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
    const outcome = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: chain.at(-1)!, workflowTrack: 'full' });
    assert(outcome.completionPath, JSON.stringify(outcome));
    assert.equal(verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot }).verdict, 'VALID');
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
    const verdict = verifyFeatureCompletion({ projectRoot: root, feature, expectedChain: chain, expectedTrack: 'full', frameworkRoot });
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
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a coding-only runless request is managed through the candidate, and freezing does not prove it predates the edit', run() {
  // plan 7e1d4b93 · R3 的生产路径用例。回答的是需求 §8 问题 1：coding-only 的不建 run
  // 请求里，「候选 → 首次阶段调用冻结 → 候选指纹核对」这条路真实成立到什么程度。
  //
  // **三个独立 root**，不在同一个 root 里串（plan §3 问题 4）：场景 B 的冻结失败检查会被
  // `harness-runner.ts:996-1000` 经 `generateScriptReport` 写进 `script-report.json`
  // （`report-generator.ts:148-150`），而 `phasesWithExistingEvidence`
  // （`feature-execution-scope.ts:665`）把它算作「这个阶段跑过」，同 root 的后续首次冻结
  // 必撞 `:480-486` 的 D1.3 第三行。
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
      runPhase(root, frameworkRoot, feature, 'coding');
      assert.equal(readFeatureFrozenScope(root, feature)!.frozen_at, frozenAt, '后续阶段调用重写了冻结记录');
      // ④ 全程不造 run
      assert(!fs.existsSync(featureFilePath(root, feature, 'goal-runs')), '无 run 路径造出了 goal-runs 目录');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  }

  // ---- 场景 B：没有候选 → 阶段根本跑不起来（「必须先经候选入口」的机器面）----
  // 这个 root 用完即弃：失败检查已落盘成 script-report.json，再冻结会撞 D1.3 第三行。
  {
    const { root, frameworkRoot, feature } = runlessCodingOnly();
    try {
      seedGit(root);
      dropCandidate(root, feature);
      const blocked = runPhase(root, frameworkRoot, feature, 'coding');
      // 报告确实落盘（`harness-runner.ts:996-1000` → `generateScriptReport`）——实跑确认，
      // 不留「未落盘」的兜底分支（那条分支实测走不到，留着就是死代码）。
      const reportPath = path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'script-report.json');
      assert(fs.existsSync(reportPath), '候选缺失时 harness 未写出 script-report.json：' + combined(blocked));
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { checks: Array<{ id: string; status: string; severity: string; suggestion?: string }> };
      const check = report.checks.find(c => c.id === 'execution_scope_frozen');
      assert(check, '候选缺失时没有 execution_scope_frozen 检查项：' + JSON.stringify(report.checks.map(c => c.id)));
      assert.equal(check!.status, 'FAIL', JSON.stringify(check));
      assert.equal(check!.severity, 'BLOCKER', JSON.stringify(check));
      assert(check!.suggestion?.includes('--prepare-scope'), '候选缺失的 suggestion 未指向 --prepare-scope：' + JSON.stringify(check));
      const summaryPath = path.join(featurePhaseReportsDir(root, feature, 'coding', frameworkRoot), 'summary.json');
      assert(fs.existsSync(summaryPath), '候选缺失时 harness 未写出当前 base summary：' + combined(blocked));
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { verdict?: string; blockers?: Array<{ id?: string }> };
      assert.equal(summary.verdict, 'FAIL');
      assert(summary.blockers?.some(item => item.id === 'execution_scope_frozen'), JSON.stringify(summary));
      assert(!fs.existsSync(featureFrozenScopePath(root, feature)), '没有候选却冻结了范围');
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
    assert.equal(record.transferred_to, 'd1-detached-real');
    assert.equal(record.transferred_scope_fingerprint, executionScopeFingerprint(scope));
    // run 的有效范围由 run 载体给出；出生指纹与登记值一致（不一致即统一入口报错）
    assert.deepStrictEqual(loadEffectiveExecutionScope(root, feature, manifest.run_id)!.phase_chain, scope.phase_chain);
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
    assert.equal(again!.transferred_to, 'r1');
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
    const runtime = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/scripts/goal-phase-runtime.ts'),
      '--feature', feature, '--adapter', 'generic', '--manifest', manifestPath, '--override-manifest',
      '--project-root', root, '--framework-root', frameworkRoot, '--foreground-ok'],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } });
    const out = (runtime.stdout ?? '') + (runtime.stderr ?? '');
    assert.notEqual(runtime.status, 0, '真实 runtime 接受了与统一出生解析不一致的 manifest 范围：' + out);
    assert(out.includes('manifest 自带的出生范围与统一出生解析结果不一致'), out);
    // 拒绝发生在建 run 之前：不留 run 目录、feature 记录未被登记转交
    assert(!fs.existsSync(featureFilePath(root, feature, path.join('goal-runs', 'd1-stale'))), '拒绝前已经建了 run');
    assert.equal(readFeatureFrozenScope(root, feature)!.transferred_to, undefined);
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
    assert.equal(readFeatureFrozenScope(root, feature)!.transferred_to, 'd1-gone');
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

cases.push({ name: 'D1 a closing-time scope failure lands in the report and exits non-zero', run() {
  // 第四轮阻断 4：收尾抛错时「写 BLOCKER 进既有失败报告路径」与「非零退出」**两者都要**——
  // 只非零退出，宿主 agent 看不到原因；只打印，脚本调用方会以 exit 0 溜过去。
  // 触发用的是**收尾独有**的失败面：非法修订提案（改请求边界）。候选漂移到不了这里
  //（冻结入口先早退），提案只在写完本阶段 summary 后才落进 script-report，正是收尾才读的东西。
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
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/harness-runner.ts'), '--sync-closure', '--phase', 'ut', '--feature', feature,
      '--project-root', root, '--framework-root', frameworkRoot],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
    const out = (cli.stdout ?? '') + (cli.stderr ?? '');
    // 正对照：同一条出口在**合法**提案（这里是没有提案）下会走到完成原件生成并 exit 0
    //（`D1 runless completion is generated at the sync-closure exit` 用同一夹具断言），
    // 所以这里的非零退出与缺原件不是「反正都失败」。
    assert.notEqual(cli.status, 0, '收尾失败仍然以 0 退出：' + out);
    assert(out.includes('feature 范围收尾失败'), out);
    const report = JSON.parse(fs.readFileSync(reportAbs, 'utf8')) as
      { checks: Array<{ id: string; severity: string; status: string; details?: string }>; summary?: { verdict?: string } };
    const blocker = report.checks.find(check => check.id === 'execution_scope_frozen');
    assert(blocker, '失败报告里没有收尾失败的 BLOCKER：' + JSON.stringify(report.checks.map(check => check.id)));
    assert.equal(blocker!.severity, 'BLOCKER');
    assert(blocker!.details?.includes('revision changes request boundary'), blocker!.details);
    assert.equal(report.summary?.verdict, 'FAIL');
    assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), '收尾失败仍生成了完成原件');
    // 非法提案没有被悄悄记进冻结记录
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

cases.push({ name: 'D1 a superseding successor is born from the source run, not blocked by the transfer', run() {
  // 第五轮阻断 1：feature 记录已把范围转交给源 run 之后，`--supersede` 仍须能开后继——
  // 后继是 **run→run 血缘**，不经 feature 载体（既不重新解析出生范围，也不再登记一次转交）。
  const repo = path.resolve(__dirname, '../../..');
  const { root, frameworkRoot, feature } = setupRunlessProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework' + String.fromCharCode(10));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base'], { cwd: root });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    prepareGoalModeRun({ projectRoot: root, frameworkRoot, feature, runId: 'd1-src', adapter: 'generic', requirement: '把 value 改成 42' });
    assert.equal(readFeatureFrozenScope(root, feature)!.transferred_to, 'd1-src');
    const sourceBirth = loadFrozenExecutionScope(root, feature, 'd1-src')!;
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
      path.join(repo, 'harness/scripts/goal-phase-runtime.ts'),
      '--feature', feature, '--adapter', 'generic', '--supersede', 'd1-src', '--run-id', 'd1-succ',
      '--requirement', '把 value 改成 42', '--project-root', root, '--framework-root', frameworkRoot, '--foreground-ok', '--force'],
      { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json') } });
    const out = (cli.stdout ?? '') + (cli.stderr ?? '');
    assert(!out.includes('范围已转交给'), '既有 supersede 路径被 feature 转交记录拦住：' + out);
    assert(!out.includes('不能再转交给'), 'successor 又登记了一次 feature 转交：' + out);
    const succManifestPath = featureFilePath(root, feature, path.join('goal-runs', 'd1-succ', 'manifest.json'));
    assert(fs.existsSync(succManifestPath), '后继 run 没有建起来：' + out);
    const succ = JSON.parse(fs.readFileSync(succManifestPath, 'utf8')) as { successor_of?: string; execution_scope?: unknown };
    assert.equal(succ.successor_of, 'd1-src');
    // 范围继承自**源 run**（出生 + 已应用修订），不是从 feature 候选重算
    assert.equal(
      executionScopeFingerprint(validateExecutionScope(succ.execution_scope)),
      executionScopeFingerprint(sourceBirth),
    );
    // feature 记录只在首次 feature→run 出生时登记转交，后继不改写它
    assert.equal(readFeatureFrozenScope(root, feature)!.transferred_to, 'd1-src');
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

cases.push({ name: 'D1 a runless phase produces a revision proposal and keeps closed phases proven', run() {
  // 第五轮必修 1：无 run 时 `scopeRevisionInputFromRepairCandidates` 直接返回 null，D0.3 的
  // 修订触发在交互路径上整条失效。第五轮建议 2：收尾把**已闭环阶段**接进提案校验，
  // 合法修订不得把它们重新变回未满足义务。
  const { root, frameworkRoot, feature } = setupRunlessProject({ chain: ['plan', 'coding', 'review', 'ut'] });
  try {
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const scope = featureEffectiveScope(readFeatureFrozenScope(root, feature)!);
    const chain = executionCompletionPhases(scope).map(String);
    // 修订必须带**新的有来源事实**：冻结之后 coding 真的改了产品文件，绑定指纹因此与出生段不同。
    // 顺序是先改文件、再落阶段证据——否则证据会因为文件在它之后被改而 stale。
    fs.writeFileSync(path.join(root, 'src/demo/value.ts'), 'export const value: number = 42;' + String.fromCharCode(10));
    seedRunlessChain(root, feature, chain);
    const candidate = {
      id: 'CR-PLAN-001', category: 'plan' as const, files: ['src/demo/value.ts'],
      summary: 'coding 发现 plan 未覆盖的设计决策', item_fingerprint: 'f'.repeat(64), source_phase: 'coding',
    };
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
    const outcome = applyFeatureScopeRevisionsThenMaybeComplete({ projectRoot: root, frameworkRoot, feature, phase: 'coding', workflowTrack: 'full' });
    assert(outcome.revisionApplied, '无 run 收尾没有应用修订：' + JSON.stringify(outcome));
    const record = readFeatureFrozenScope(root, feature)!;
    assert.equal(record.revisions.length, 1);
    // 建议 2：已闭环阶段的既有义务带着满足证明进了修订（不会被重新要求再跑一遍）
    const revised = featureEffectiveScope(record);
    const closedOwners = new Set(chain);
    const reopened = revised.obligations.filter(ob => ob.applicability === 'required' && closedOwners.has(String(ob.owner_phase))
      && !ob.satisfied_by?.length && scope.obligations.some(prior => prior.id === ob.id && prior.satisfied_by?.length));
    assert.equal(reopened.length, 0, '已闭环阶段的义务被修订重新打开：' + JSON.stringify(reopened.map(ob => ob.id)));
    // 判别性断言：证明来自**本轮闭环证据**（`{phase, evidence_manifest_aggregate}`）——
    // 这种形状只可能由 completedPhases 那条分支补出来，不接就不会有。
    const proven = revised.obligations.filter(ob => closedOwners.has(String(ob.owner_phase))
      && (ob.satisfied_by ?? []).some(ref => 'evidence_manifest_aggregate' in (ref as object)));
    assert(proven.length > 0, '已闭环阶段没有被补上闭环证明：' + JSON.stringify(revised.obligations.map(ob => [ob.id, ob.owner_phase, ob.satisfied_by])));
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

cases.push({ name: 'P1-T9 spec owner revises an in-place acceptance through the real runless harness', run() {
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
    assert.equal(after.revisions.length, 1, JSON.stringify(after.revisions));
    const effective = featureEffectiveScope(after);
    const acceptanceObligation = effective.obligations.find(item => item.kind === 'acceptance-context')!;
    const unit = effective.obligations.find(item => item.kind === 'unit-evidence')!;
    const currentSha = createHash('sha256').update(fs.readFileSync(acceptancePath)).digest('hex');
    for (const obligation of [acceptanceObligation, unit]) {
      assert(obligation.basis.some(binding => binding.input_id === 'acceptance' && binding.dependencies.some(dep => dep.sha256 === currentSha)), `${obligation.kind} 未同步当前 acceptance binding: ${JSON.stringify(obligation)}`);
      assert(!obligation.basis.some(binding => binding.input_id === 'acceptance' && binding.dependencies.some(dep => dep.sha256 !== currentSha)), `${obligation.kind} 仍保留旧 acceptance generation`);
    }
    acceptance.criteria = [];
    fs.writeFileSync(acceptancePath, YAML.stringify(acceptance));
    const invalid = runSpec();
    assert.notEqual(invalid.status, 0, '非法减空验收不得形成第二条修订');
    assert.equal(readFeatureFrozenScope(root, feature)!.revisions.length, 1, '非法验收仍推进了范围修订');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
} });

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) { try { await test.run(); results.push({ name: test.name, ok: true }); } catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); } }
  return results;
}
