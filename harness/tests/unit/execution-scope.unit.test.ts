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
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { resolveComponentClosureInputs } from '../../scripts/utils/component-closure-inputs';
import { deriveComponentClosureObligations } from '../../scripts/utils/component-closure-obligations';
import { buildChangeUnitGoalHandoff } from '../../scripts/utils/change-unit-progress-loop';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { verifyFeatureCompletion, verifyReusedExecutionScope, executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { loadFrozenExecutionScope, loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { readScopeAcceptance, collectResolvedScopeFacts } from '../../scripts/utils/feature-track';
import { codingBasePath } from '../../scripts/utils/pass-snapshot';
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
async function runScopeScenario(mode: 'direct' | 'revision' | 'revision-cut' | 'revision-precut' | 'revision-revoke' | 'impact-first' | 'impact-reuse' | 'impact-null' | 'design-gap' | 'detached' | 'detached-harness' | 'detached-explicit' | 'request-ut' | 'testing-fail' | 'testing-offline' | 'testing-manual' | 'unresolved', useDefault = false, missingMapping = false): Promise<void> {
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
    if (mode === 'direct') {
      fs.rmSync(featureFilePath(root, feature, 'spec/spec.md'), { force: true });
      fs.rmSync(featureFilePath(root, feature, 'plan/plan.md'), { force: true });
    }
    const testingOnly = ['testing-fail', 'testing-offline', 'testing-manual'].includes(mode);
    const input = request(mode === 'request-ut' ? ['ut'] : testingOnly ? ['testing'] : ['direct', 'design-gap'].includes(mode) ? ['coding', 'review', 'ut'] : ['spec'], mode === 'request-ut' ? 'request' : 'feature');
    const contractsFile = featureFilePath(root, feature, 'contracts.yaml');
    const codeFile = path.join(root, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets');
    const codeRel = path.relative(root, codeFile).replace(/\\/g, '/');
    // Every binding this fixture puts into a candidate is produced by the *production* resolver.
    // Hand-computing `sha256(stableStringify(YAML.parse(raw)))` is a different contract from what
    // `resolveArtifact` returns for acceptance@1/contracts@1/use-cases@1 (a SpecLoader-parsed
    // value), so a hand-built binding cannot survive the freeze-time `readBoundInput` re-resolve.
    // Reading it live also means design-gap / revision bindings reflect the file as it is *then*.
    const liveBinding = (phase: string, id: string): any => {
      const resolvedInputs = resolveCapabilityInputs({
        projectRoot: root, frameworkRoot, feature, phase, track: 'full', testTargets: [codeRel],
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] },
      });
      const value = resolvedInputs.inputs?.values?.[id];
      assert(value && value.state === 'resolved', `${phase}/${id} unresolved: ${JSON.stringify(value)}`);
      return value.binding;
    };
    const binding = liveBinding('plan', 'contracts');
    input.facts.push({ id: 'design:cu', kind: 'design-context', applicability: 'required', reason: 'existing admitted CU construction projection', basis: [binding], satisfied_by: [binding] });
    const codeBinding = () => liveBinding('plan', 'codebase');
    // Any candidate that requests `coding` must carry the implementation duty together with its
    // write-set source — that is the real shape, and it is what the freeze-time impact relevance
    // check reads as the target set (this CU fixture's shared contracts.yaml declares no files).
    if (['direct', 'design-gap'].includes(mode)) {
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
    if (['direct', 'design-gap'].includes(mode)) {
      input.request.impact = { user_visible_behavior_change: false, reason: 'fixture impact requires unit verification only', basis: [codeBinding()] };
    }
    // `impact-reuse` is born WITH a judgement so the proposal below is a real correction; the
    // reused basis is what must be rejected. `impact-first` is born without one on purpose.
    if (['impact-reuse', 'impact-null'].includes(mode)) {
      input.request.impact = { user_visible_behavior_change: false, reason: 'birth: no user-visible change', basis: [codeBinding()] };
    }
    if (testingOnly) input.facts.push({ id: 'unit:impact', kind: 'unit-evidence', applicability: 'not_applicable', reason: 'fixture requests device result only', basis: [binding] });
    if (!['direct', 'design-gap', 'request-ut'].includes(mode) && !testingOnly) input.facts.push({ id: 'device:pending', kind: 'device-evidence', applicability: 'unknown', reason: 'spec will determine device acceptance', basis: [] });
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
      // design-gap also edits the file: the revision it then proposes must carry a *new* sourced
      // fact (goal-phase-runtime.ts:9084), which an unchanged file cannot provide now that the
      // birth candidate already binds the same codebase source.
      onCoding: () => { if (['direct', 'design-gap', 'revision-revoke'].includes(mode)) fs.appendFileSync(codeFile, '\n// authorized P2 implementation\n'); },
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
        if (mode !== 'design-gap' || phase !== 'coding' || designGap) return null;
        designGap = true;
        // Live production binding: coding has just touched the file, so read it now rather than
        // reuse the birth-time one.
        const fresh = liveBinding('plan', 'codebase');
        const revision = request(['plan', 'coding', 'review', 'ut'], 'feature');
        // The proposal carries the frozen impact judgement forward VERBATIM, exactly as the
        // checker-side budget does. That is an inheritance, not a correction: its basis is a
        // birth-time observation of the file coding has just rewritten, so re-comparing its bytes
        // would reject this legal revision. Classifying by "the field is present" did exactly that.
        revision.request.impact = input.request.impact;
        revision.facts.push(...input.facts, { id: 'design:new-api', kind: 'design-decision', applicability: 'required', reason: 'new public interface requires design owner', basis: [fresh] });
        return { checks: [{ id: 'scope_design_gap', category: 'structure', description: 'new design fact', severity: 'BLOCKER', status: 'FAIL', details: 'public interface decision is missing', suggestion: 'return to plan owner', scope_revision_input: revision }] };
      },
      onSpec: () => {
        fs.writeFileSync(featureFilePath(root, feature, 'acceptance.yaml'), 'criteria: [{id: AC-DEVICE, priority: P1, ut_layer: device, desc: device verification}]\n');
      },
      afterHarnessPass: ({ phase, runId }) => {
        if (phase !== 'spec' || ['direct', 'design-gap', 'unresolved'].includes(mode) || testingOnly) return;
        // spec just rewrote acceptance.yaml — take the binding from the production resolver so its
        // fingerprint is the SpecLoader-parsed one the freeze-time re-resolve will recompute.
        const fresh = liveBinding('ut', 'acceptance');
        const revision = request(['coding', 'review', 'ut', 'testing'], 'feature');
        revision.facts.push(...input.facts.filter(fact => fact.kind === 'design-context'),
          { id: 'device:pending', kind: 'device-evidence', applicability: 'required', reason: 'spec produced device acceptance', basis: [fresh] });
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
      const sourceEvents = fs.readFileSync(featureFilePath(root, feature, 'goal-runs/p2-attended/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      // §3 问题 4: every handoff-era assertion migrated to its run-internal equivalent; none dropped.
      const revisions = sourceEvents.filter(event => event.type === 'scope_revised');
      // revision-revoke applies three: #1 when spec closes, #2 when coding invalidates that closure,
      // #3 when the re-run spec publishes its NEW closure evidence (the only thing that changed).
      assert.equal(revisions.length, mode === 'revision-revoke' ? 3 : 1, 'duplicate scope revision');
      assert.equal(revisions[0].revision_index, 1, 'revision index must start at 1');
      // design-gap revises the chain back to plan, so coding is legitimately dispatched TWICE;
      // the revision mode never returns to spec, so spec stays at one.
      // `revision-precut` is cut before the proposal is ever validated, so spec runs twice too.
      const sourcePhase = mode === 'design-gap' ? 'coding' : 'spec';
      const sourceInvokes = sourceEvents.filter(event => event.type === 'agent_invoke_start' && event.phase === sourcePhase);
      const expectedSourceInvokes = ['design-gap', 'revision-precut', 'revision-revoke'].includes(mode) ? 2 : 1;
      assert.equal(sourceInvokes.length, expectedSourceInvokes, 'revised chain did not re-dispatch the responsible phase');
      if (expectedSourceInvokes === 2) assert(sourceInvokes[1].invoke_id !== sourceInvokes[0].invoke_id, 're-dispatch reused the same invoke id');
      if (mode === 'revision-precut') assert(injected, 'the pre-validation cut was never reached');
      const effective = loadEffectiveExecutionScope(root, feature, 'p2-attended')!;
      const expectedChain = mode === 'design-gap' ? ['plan', 'coding', 'review', 'ut']
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
      assert(afterRevision?.invoke_id.endsWith(mode === 'revision-precut' ? '-i3' : '-i2'), 'revision reset consumed turns: ' + afterRevision?.invoke_id);
      if (mode === 'design-gap') {
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
      : mode === 'design-gap' ? ['plan', 'coding', 'review', 'ut']
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
for (const mode of ['direct', 'revision', 'revision-cut', 'revision-precut', 'revision-revoke', 'impact-first', 'impact-reuse', 'impact-null', 'design-gap', 'detached', 'detached-harness', 'detached-explicit', 'request-ut', 'testing-fail', 'testing-offline', 'testing-manual', 'unresolved'] as const) cases.push({ name: 'real prepare CLI / bridge scope lifecycle: ' + mode, run: () => runScopeScenario(mode) });
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
  const d = resolveExecutionScope(i, wf, acc('unit'), facts({ impact_basis: impactOk })).obligations.find(o => o.kind === 'device-evidence')!;
  assert.equal(d.applicability, 'unknown'); assert.equal(d.reason, '影响依据无可核验范围');
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
