import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { stableStringify, loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { setupGoalRuntimeHost, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { configureFeature } from './component-closure.unit.test';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { buildSummaryRepairCandidates, scopeRevisionInputFromRepairCandidates } from '../../scripts/utils/repair-candidates';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { resolveComponentClosureInputs } from '../../scripts/utils/component-closure-inputs';
import { deriveComponentClosureObligations } from '../../scripts/utils/component-closure-obligations';
import { buildChangeUnitGoalHandoff } from '../../scripts/utils/change-unit-progress-loop';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { verifyFeatureCompletion, verifyReusedExecutionScope, executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { loadFrozenExecutionScope, loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { readScopeAcceptance, collectResolvedScopeFacts, prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { codingBasePath } from '../../scripts/utils/pass-snapshot';
import { recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import * as os from 'os';
import type { AcceptanceSpec } from '../../scripts/utils/types';
import { resolveExecutionScope, validateExecutionScope, executionScopeFingerprint, executionCompletionPhases, findSubtractedRequiredObligations, assertRevisionKeepsRequiredObligations, hasNewSourcedFact, type ExecutionScopeInput, type ResolvedScopeFacts } from '../../scripts/utils/execution-scope';
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
  { name: 'corrupt new scope cannot become legacy full', run() {
    for (const value of [null, {}, { schema_version: '9' }]) assert.throws(() => validateExecutionScope(value));
  } },
];
async function runScopeScenario(mode: 'direct' | 'revision' | 'revision-cut' | 'revision-precut' | 'revision-revoke' | 'impact-first' | 'impact-reuse' | 'impact-null' | 'design-gap' | 'design-gap-revert' | 'spec-gap-revert' | 'detached' | 'detached-harness' | 'detached-explicit' | 'request-ut' | 'testing-fail' | 'testing-offline' | 'testing-manual' | 'unresolved', useDefault = false, missingMapping = false): Promise<void> {
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
    const input = request(mode === 'request-ut' ? ['ut'] : testingOnly ? ['testing'] : ['direct'].includes(mode) || codingFirst ? ['coding', 'review', 'ut'] : ['spec'], mode === 'request-ut' ? 'request' : 'feature');
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
    if (!['direct', 'request-ut'].includes(mode) && !codingFirst && !testingOnly) input.facts.push({ id: 'device:pending', kind: 'device-evidence', applicability: 'unknown', reason: 'spec will determine device acceptance', basis: [] });
    fs.writeFileSync(featureFilePath(root, feature, 'feature.yaml'), YAML.stringify({ execution_scope: input }));
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
      onSpec: () => {
        // `spec-gap-revert`：责任阶段 spec 重跑时**修复触发文件**（补上被 review 指出的缺口），
        // 验收层级保持 unit——责任是补定义，不是把范围扩到设备验证。
        if (specGap) {
          fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'),
            'criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, desc: refresh ledger list, expected_result: list refreshed}, {id: AC-EMPTY, priority: P1, ut_layer: unit, desc: refresh with no entries, expected_result: empty state}]' + String.fromCharCode(10));
          return;
        }
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
        if (phase !== 'spec' || ['direct', 'unresolved'].includes(mode) || codingFirst || testingOnly) return;
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
        if (!injected && mode === 'revision-cut') { injected = true; throw new Error('injected revision cut: ' + boundary); }
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
    assert.equal(probe.exitCode, 0, JSON.stringify(probe.events.slice(-5)));
    if (mode === 'request-ut') {
      assert.deepStrictEqual(probe.invokedPhases, ['ut']);
      assert(!fs.existsSync(featureFilePath(root, feature, 'feature-completion.json')), 'request created Feature completion');
      return;
    }
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
for (const mode of ['direct', 'revision', 'revision-cut', 'revision-precut', 'revision-revoke', 'impact-first', 'impact-reuse', 'impact-null', 'design-gap', 'design-gap-revert', 'spec-gap-revert', 'detached', 'detached-harness', 'detached-explicit', 'request-ut', 'testing-fail', 'testing-offline', 'testing-manual', 'unresolved'] as const) cases.push({ name: 'real prepare CLI / bridge scope lifecycle: ' + mode, run: () => runScopeScenario(mode) });
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
    execution_scope: revised, revision_input: null, trigger: { phase: 'spec', check_id: 'visual-gap' }, allowed_fields: [...SCOPE_REVISION_FIELDS] };
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
    execution_scope: scope(false), revision_input: null, trigger: { phase: 'coding', check_id: 'x' }, allowed_fields: [...SCOPE_REVISION_FIELDS] };
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
    execution_scope: scope, revision_input: null, trigger: { phase: 'coding', check_id: 'x' }, allowed_fields: [...SCOPE_REVISION_FIELDS] });
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
    allowed_fields: [...SCOPE_REVISION_FIELDS], ...over,
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

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) { try { await test.run(); results.push({ name: test.name, ok: true }); } catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); } }
  return results;
}
