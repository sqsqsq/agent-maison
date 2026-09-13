import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { deriveBlueprintSkillInput, materializeBlueprintSkillInputs, designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { asRecord, type BlueprintRecord, type ComponentBlueprintRef } from '../../scripts/utils/component-blueprint-model';
import { resolveFeatureArtifact, clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { resolveCapabilityInputs, readBoundInput } from '../../scripts/utils/capability-resolution';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import checkSpec from '../../scripts/check-spec';
import checkPlan from '../../scripts/check-plan';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { checkDesignToCode } from '../../scripts/check-coding';
import type { CheckContext } from '../../scripts/utils/types';
import { resolveExecutionScope } from '../../scripts/utils/execution-scope';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import type { WorkflowSpec } from '../../workflow-loader';
import { collectContextFiles } from '../../harness-runner';
import { initializeFidelityRouting } from '../../scripts/utils/goal-preflight';
import { spawnSync } from 'child_process';
import { readScopeAcceptance } from '../../scripts/utils/feature-track';
import { checkAcceptanceContent } from '../../scripts/utils/check-acceptance';
import { collectCleanPassIssues } from '../../scripts/utils/verify-feature-completion';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const sha = (file: string) => 'sha256:' + createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function fixture(): { root: string; feature: string; blueprintFile: string; cuFile: string; bind(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-skill-'));
  fs.cpSync(path.join(__dirname, '../fixtures/component-blueprint/valid'), root, { recursive: true });
  const read = (name: string) => YAML.parse(fs.readFileSync(path.join(__dirname, '../fixtures/blueprint-design-inputs', name + '.yaml'), 'utf8'));
  const acceptance = read('acceptance');
  const feature = acceptance.feature;
  const blueprintFile = path.join(root, 'doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml');
  const cuFile = path.join(root, 'doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml');
  const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8'));
  const cu = YAML.parse(fs.readFileSync(cuFile, 'utf8'));
  for (const predicate of cu.target_predicates) predicate.verification_refs.push('acceptance:AC-1');
  fs.writeFileSync(cuFile, YAML.stringify(cu));
  const first = asRecord(resolveBlueprintTarget(blueprint, cu.design_refs[0].target))!;
  first.provenance = { ...asRecord(first.provenance), evidence_strength: 'authoritative' };
  first.acceptance = acceptance;
  first.contracts = read('contracts');
  const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
  const flow = asRecord(resolveBlueprintTarget(blueprint, flowRef.target))!;
  flow.provenance = { ...asRecord(flow.provenance), evidence_strength: 'authoritative' };
  flow.contracts = read('runtime');
  first.use_cases = read('use-cases');
  fs.writeFileSync(blueprintFile, YAML.stringify(blueprint));
  const bind = () => {
    const record = YAML.parse(fs.readFileSync(cuFile, 'utf8'));
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ((value as BlueprintRecord).artifact === 'component-blueprint@1') (value as BlueprintRecord).artifact_sha256 = sha(blueprintFile);
      for (const child of Object.values(value)) walk(child);
    };
    walk(record); fs.writeFileSync(cuFile, YAML.stringify(record));
  };
  bind();
  fs.rmSync(resolveFeatureArtifact(root, feature, 'contracts.yaml').actualPath, { force: true });
  return { root, feature, blueprintFile, cuFile, bind };
}
const cases: Array<{ name: string; run(f: ReturnType<typeof fixture>): void | Promise<void> }> = [
  { name: 'P7 completion retains derived P0 device responsibility without materialized acceptance', run(f) {
    const blueprint = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const unit = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const target = asRecord(resolveBlueprintTarget(blueprint, unit.design_refs[0].target))!;
    const acceptance = target.acceptance as import('../../scripts/utils/types').AcceptanceSpec;
    fs.writeFileSync(path.join(f.root, 'request.md'), '刷新后显示余额');
    Object.assign(acceptance.criteria[0], { ut_layer: 'device', device_focus: '余额显示', linked_flow: 'refresh', requirement_ref: { source_path: 'request.md', snippet: '刷新后显示余额' }, checkpoint: { pre_screen: 'before', action: { type: 'touch', target_element_id: 'refresh' }, post_screen: 'after', required_element_ids: ['balance'] } });
    Object.assign(acceptance, { flows: { refresh: { screens: ['before', 'after'] } } });
    fs.writeFileSync(f.blueprintFile, YAML.stringify(blueprint)); f.bind();
    for (const materialized of [false, true]) {
      if (materialized) materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
      const resolved = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', track: 'full', requirement: '刷新后显示余额', inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } }).inputs!.values.acceptance;
      assert.equal(resolved.state, 'resolved', JSON.stringify(resolved)); if (resolved.state !== 'resolved') return;
      const workflow: WorkflowSpec = { schema_version: '1.2', name: 'p7', artifacts: ['spec','plan','coding','review','ut','testing'].map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: 'obligations.' + id })) };
      const scope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['balance'], requested_phases: ['testing'] }, facts: [], contract_fingerprints: [] }, workflow, { value: acceptance, binding: resolved.binding });
      const checks = collectCleanPassIssues({ projectRoot: f.root, feature: f.feature, frameworkRoot, chain: scope.phase_chain, executionScope: scope });
      assert(checks.some(check => check.condition === 'runtime_step_evidence'), JSON.stringify(checks));
    }
  } },
  { name: 'coding and review consume blueprint runtime with real planned targets and no narrative documents', run(f) {
    const source = path.join(f.root, 'src/ledger/LedgerFeature.ets');
    fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, 'export class LedgerFeature { run(): number { return 42; } }\n');
    for (const materialized of [false, true]) {
      if (materialized) materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
      for (const phase of ['coding', 'review']) {
        const result = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase, track: 'full', requirement: 'implement approved ledger refresh', testTargets: ['src/ledger/LedgerFeature.ets'], inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: { implementation: 'required', 'visual-evidence': 'not_applicable' }, required_outputs: [] } });
        assert.notEqual(result.report.assurance, 'blocked', JSON.stringify(result.report));
        assert.equal(result.report.capabilities.find(capability => capability.id === `capability_${phase}_visual_context`)?.state, 'not_applicable');
        const useCases = result.inputs!.values.use_cases;
        assert.equal(useCases.state, 'resolved', JSON.stringify(useCases));
        if (useCases.state === 'resolved') assert.deepStrictEqual(readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase, track: 'full' }, useCases.binding), useCases.value);
        const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
        const spec = loader.loadFeatureSpec(f.feature, result.inputs);
        assert(spec.contracts?.state_management?.length); assert(spec.useCases?.use_cases.length);
        const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase, featureSpec: spec, resolvedInputs: result.inputs, phaseRule: {} } as CheckContext;
        const checks = checkChangeUnitFeatureProjection(ctx, phase as 'coding' | 'review');
        assert(!checks.some(check => check.status === 'FAIL'), JSON.stringify(checks));
        assert(!checkDesignToCode(ctx).some(check => check.severity === 'BLOCKER' && check.status === 'SKIP'));
        const context = collectContextFiles(loader, { kind: 'standalone', projectRoot: f.root, frameworkRoot, frameworkRel: '' }, phase, f.feature, spec, { resolvedInputs: result.inputs });
        assert(context.some(file => file.content.includes('publish snapshot')));
        const missing = { ...ctx, featureSpec: { ...spec, contracts: { ...spec.contracts!, change_unit: undefined } } };
        assert(checkChangeUnitFeatureProjection(missing, phase as 'coding' | 'review').some(check => check.status === 'FAIL'));
      }
    }
    fs.unlinkSync(source);
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
    const spec = loader.loadFeatureSpec(f.feature);
    assert(checkChangeUnitFeatureProjection({ projectRoot: f.root, frameworkRoot, feature: f.feature, featureSpec: spec, phaseRule: {} } as CheckContext, 'coding').some(check => check.status === 'FAIL'));
    assert(!resolveFeatureArtifact(f.root, f.feature, 'plan.md').exists);
    assert(!resolveFeatureArtifact(f.root, f.feature, 'spec.md').exists);
  } },
  { name: 'AC and BD validate by their collection, never by whichever fields happen to exist', run(f) {
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance');
    assert.equal(projected.state, 'resolved', projected.detail);
    const acceptance = structuredClone(projected.value) as NonNullable<CheckContext['featureSpec']['acceptance']>;
    acceptance.boundaries = [{ id: 'BD-1', priority: 'P1', description: 'invalid amount is rejected', scenario: 'negative amount', handling: 'reject before persistence', expected_behavior: 'ledger is unchanged', prd_exception: 'invalid input', ut_layer: 'unit', ut_focus: 'no mutation' }];
    const check = () => checkAcceptanceContent({ featureSpec: { feature: f.feature, acceptance } } as CheckContext);
    assert(check().every(result => result.status === 'PASS'));
    const original = structuredClone(acceptance.criteria[0]);
    for (const field of ['verification_steps', 'testable', 'expected_result']) {
      acceptance.criteria[0] = structuredClone(original);
      delete (acceptance.criteria[0] as unknown as Record<string, unknown>)[field];
      Object.assign(acceptance.criteria[0], { scenario: 'negative amount', handling: 'reject', expected_behavior: 'unchanged' });
      assert(check().some(result => result.status === 'FAIL'), `${field} was replaced by BD fields`);
    }
    acceptance.criteria[0] = original;
    delete (acceptance.boundaries[0] as unknown as Record<string, unknown>).handling;
    Object.assign(acceptance.boundaries[0], { testable: true, verification_steps: ['reject'], expected_result: 'unchanged' });
    assert(check().some(result => result.status === 'FAIL'), 'BD was treated as AC');
  } },
  { name: 'pixel fidelity with no reference remains blocked and produces no visual placeholders', run(f) {
    initializeFidelityRouting({ projectRoot: f.root, frameworkRoot, feature: f.feature, requirement: '按参考图逐像素复现', featuresDirRel: 'doc/features', executionIdentity: `phase:${f.feature}:spec`, requirementProvenance: 'explicit_cli', manifestFidelity: 'pixel_1to1', fidelityFromCli: true });
    const result = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', track: 'full', requirement: '按参考图逐像素复现', inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } });
    assert.equal(result.report.capabilities.find(capability => capability.id === 'capability_spec_visual_reference')?.state, 'blocked');
    for (const name of ['ui-spec.yaml', 'ref-elements.yaml']) assert(!resolveFeatureArtifact(f.root, f.feature, name).exists);
  } },
  { name: 'validated spec facts reach actual P2 acceptance reader with derived and materialized sources', run(f) {
    const workflow: WorkflowSpec = { schema_version: '1.2', name: 'p3-scoped', auto_chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], artifacts: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
    const localFramework = path.join(f.root, 'projection-framework');
    fs.mkdirSync(path.join(localFramework, 'workflows'), { recursive: true }); fs.writeFileSync(path.join(localFramework, 'workflows/p3-scoped.workflow.yaml'), YAML.stringify(workflow));
    const configFile = path.join(f.root, 'framework.config.json');
    const config = { schema_version: '1.1', project_name: 'P3 design fixture', project_profile: { name: 'generic' }, paths: { features_dir: 'doc/features' }, active_workflow: 'p3-scoped' }; fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    const scope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['spec'] }, facts: [
      { id: 'acceptance:pending', kind: 'acceptance-context', applicability: 'unknown', reason: 'spec must establish acceptance', basis: [] },
      { id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: 'requested implementation', basis: [] },
    ], contract_fingerprints: [] }, workflow);
    const manifest = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-design', unattended: { write_mode: 'full-access', approval_mode: 'never' }, requirement: 'deliver ledger refresh', execution_scope: scope, chain_override: scope.phase_chain }, { projectRoot: f.root });
    const born = createGoalRun({ projectRoot: f.root, manifest, chain: scope.phase_chain });
    const before = fs.readFileSync(born.manifestPath, 'utf8');
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', featuresDir: 'doc/features', goalRunId: manifest.run_id });
    const inputs = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', track: 'full', ...bridge }).inputs!;
    const featureSpec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, inputs);
    const ctx = { projectRoot: f.root, frameworkRoot: localFramework, feature: f.feature, phase: 'spec', featureSpec, resolvedInputs: inputs, factsContext: bridge.factsContext } as CheckContext;
    const checks = designScopeRevisionChecks(ctx, []);
    assert.equal(checks.length, 1); assert(checks[0].scope_revision_input);
    const binding = inputs.values.acceptance; assert.equal(binding.state, 'resolved');
    if (binding.state !== 'resolved') return;
    const next = resolveExecutionScope(checks[0].scope_revision_input!, workflow, readScopeAcceptance(f.root, checks[0].scope_revision_input!, { feature: f.feature, frameworkRoot }));
    assert(!next.unresolved.length, JSON.stringify(next.unresolved));
    assert(next.phase_chain.includes('coding') && next.phase_chain.includes('ut') && !next.phase_chain.includes('testing'));
    assert(!resolveFeatureArtifact(f.root, f.feature, 'acceptance.yaml').exists, 'derived path forced materialization');
    const tampered = structuredClone(checks[0].scope_revision_input!);
    tampered.facts.flatMap(fact => fact.basis).find(ref => ref.source.kind === 'derive' && ref.source.provider_id === 'derive.blueprint-acceptance')!.content_fingerprint = '0'.repeat(64);
    assert.throws(() => readScopeAcceptance(f.root, tampered, { feature: f.feature, frameworkRoot }), /stale/, 'content fingerprint was ignored');
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    assert.throws(() => readScopeAcceptance(f.root, checks[0].scope_revision_input!, { feature: f.feature, frameworkRoot }), /stale/, 'bound absent artifact attempt was ignored');
    const physicalInputs = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', track: 'full', ...bridge }).inputs!;
    const physicalCtx = { ...ctx, resolvedInputs: physicalInputs, featureSpec: new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, physicalInputs) };
    const physicalChecks = designScopeRevisionChecks(physicalCtx, []);
    const physicalNext = resolveExecutionScope(physicalChecks[0].scope_revision_input!, workflow, readScopeAcceptance(f.root, physicalChecks[0].scope_revision_input!, { feature: f.feature, frameworkRoot }));
    assert.deepStrictEqual(physicalNext.phase_chain, next.phase_chain);
    assert.deepStrictEqual(physicalNext.unresolved, next.unresolved);
    assert.deepStrictEqual(physicalNext.obligations.map(o => [o.id, o.applicability]), next.obligations.map(o => [o.id, o.applicability]));
    for (const required_outputs of [[], ['spec/spec.md']]) {
      const withOutputs = { ...physicalCtx, resolvedInputs: { ...physicalInputs, context: { ...physicalInputs.context, required_outputs } } };
      assert(designScopeRevisionChecks(withOutputs, [ { id: 'design_pass', status: 'PASS', severity: 'MINOR', category: 'structure', description: 'validated design', details: 'passed' } ])[0].scope_revision_input);
    }
    Object.assign(ctx, physicalCtx);
    const acceptanceInput = physicalInputs.values.acceptance;
    assert.equal(acceptanceInput.state, 'resolved');
    if (acceptanceInput.state !== 'resolved') return;
    const planScope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['plan'] }, facts: [
      { id: 'design:pending', kind: 'design-context', applicability: 'unknown', reason: 'plan must establish construction', basis: [] },
      { id: 'acceptance:known', kind: 'acceptance-context', applicability: 'required', reason: 'approved acceptance', basis: [acceptanceInput.binding], satisfied_by: [acceptanceInput.binding] },
      { id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: 'requested implementation', basis: [] },
    ], contract_fingerprints: [] }, workflow, { value: physicalCtx.featureSpec.acceptance!, binding: acceptanceInput.binding });
    const planRun = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-plan-design', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: planScope, chain_override: planScope.phase_chain }, { projectRoot: f.root });
    createGoalRun({ projectRoot: f.root, manifest: planRun, chain: planScope.phase_chain });
    const planBridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featuresDir: 'doc/features', goalRunId: planRun.run_id });
    const planInputs = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full', ...planBridge }).inputs!;
    for (const required_outputs of [[], ['plan/plan.md']]) {
      const planCtx = { ...ctx, phase: 'plan', factsContext: planBridge.factsContext, featureSpec: new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, planInputs), resolvedInputs: { ...planInputs, context: { ...planInputs.context, required_outputs } } } as CheckContext;
      const proposal = designScopeRevisionChecks(planCtx, [{ id: 'design_pass', status: 'PASS', severity: 'MINOR', category: 'structure', description: 'validated design', details: 'passed' }])[0].scope_revision_input!;
      assert(proposal);
      const nextPlan = resolveExecutionScope(proposal, workflow, readScopeAcceptance(f.root, proposal, { feature: f.feature, frameworkRoot }));
      assert(!nextPlan.unresolved.length && nextPlan.phase_chain.includes('coding'));
      assert.deepStrictEqual(designScopeRevisionChecks(planCtx, [{ id: 'design_fail', status: 'FAIL', severity: 'BLOCKER', category: 'structure', description: 'invalid design', details: 'failed' }]), []);
    }
    assert.equal(fs.readFileSync(born.manifestPath, 'utf8'), before);
    assert.deepStrictEqual(designScopeRevisionChecks(ctx, [{ id: 'actual_failure', category: 'structure', severity: 'BLOCKER', status: 'FAIL', description: 'failure', details: 'failure' }]), []);
    const requestScope = resolveExecutionScope({ request: { completion_target: 'request', requested_results: ['design'], requested_phases: ['spec'] }, facts: [], contract_fingerprints: [] }, workflow);
    const requestRun = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-design-only', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: requestScope, chain_override: requestScope.phase_chain }, { projectRoot: f.root });
    createGoalRun({ projectRoot: f.root, manifest: requestRun, chain: requestScope.phase_chain });
    assert.deepStrictEqual(designScopeRevisionChecks({ ...ctx, factsContext: { ...bridge.factsContext!, subject: { feature: f.feature, run_id: requestRun.run_id } } }, []), []);
    const protectedScope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['spec'] }, facts: [
      { id: 'acceptance:pending', kind: 'acceptance-context', applicability: 'unknown', reason: 'spec must establish acceptance', basis: [] },
      { id: 'device-evidence:acceptance', kind: 'device-evidence', applicability: 'required', reason: 'previously required device evidence', basis: [] },
    ], contract_fingerprints: [] }, workflow);
    const protectedRun = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-keep-verification', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: protectedScope, chain_override: protectedScope.phase_chain }, { projectRoot: f.root });
    createGoalRun({ projectRoot: f.root, manifest: protectedRun, chain: protectedScope.phase_chain });
    const rejected = designScopeRevisionChecks({ ...ctx, factsContext: { ...bridge.factsContext!, subject: { feature: f.feature, run_id: protectedRun.run_id } } }, []);
    assert(rejected.some(check => check.status === 'FAIL') && rejected.every(check => !check.scope_revision_input), 'new facts silently removed a required duty');
  } },
  { name: 'external authority content changes are rejected without rebinding blueprint metadata', run(f) {
    const file = path.join(f.root, 'contracts/ledger-api.yaml');
    const authority = YAML.parse(fs.readFileSync(file, 'utf8'));
    authority.errors.createEntry.validation_error = 'silently ignore invalid request'; fs.writeFileSync(file, YAML.stringify(authority));
    const result = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(result.state, 'invalid'); assert(result.detail?.includes('blueprint_contract_authority_mismatch'), result.detail);
  } },
  { name: 'real plan resolver consumes equivalent derived/artifact values; marked stale artifacts cannot fall back', run(f) {
    const options = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' as const, testTargets: ['src/ledger/LedgerFeature.ets'], inputContext: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: [] } };
    const derived = resolveCapabilityInputs(options);
    assert.equal(derived.inputs?.values.acceptance.state, 'resolved', JSON.stringify(derived.report));
    assert.equal(derived.inputs?.values.contracts.state, 'resolved', JSON.stringify(derived.report));
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
    const context = collectContextFiles(loader, { kind: 'standalone', projectRoot: f.root, frameworkRoot, frameworkRel: '' }, 'plan', f.feature, loader.loadFeatureSpec(f.feature, derived.inputs), { resolvedInputs: derived.inputs });
    assert(context.some(file => file.content.includes('persisted ledger snapshot is published to the consumer')), 'verifier lost projected use-case content');
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const physical = resolveCapabilityInputs(options);
    assert.deepStrictEqual(physical.inputs?.artifacts, derived.inputs?.artifacts);
    fs.appendFileSync(f.cuFile, '\n# changed CU bytes\n');
    const stale = resolveCapabilityInputs(options);
    assert.equal(stale.report.assurance, 'blocked');
    assert(stale.report.capabilities.flatMap(cap => cap.inputs).filter(input => input.state === 'invalid').every(input => input.attempts.length === 1));
  } },
  { name: 'actual spec/plan checkers validate typed content without narrative and retain facts gate', async run(f) {
    const a = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance');
    const c = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(a.state, 'resolved', a.detail); assert.equal(c.state, 'resolved', c.detail);
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
    const projectionModule = require('../../scripts/utils/blueprint-skill-projection') as { designScopeRevisionChecks: typeof designScopeRevisionChecks };
    const finish = projectionModule.designScopeRevisionChecks;
    const visits: Array<{ phase: string; outputs: string[]; results: unknown }> = [];
    projectionModule.designScopeRevisionChecks = (ctx, results) => { visits.push({ phase: ctx.phase, outputs: ctx.resolvedInputs!.context.required_outputs, results }); return finish(ctx, results); };
    try { for (const [phase, checker] of [['spec', checkSpec], ['plan', checkPlan]] as const) {
      const inputs = { context: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: [] }, phase, values: {}, artifacts: { ...c.artifacts, 'acceptance@1': a.value } };
      const ctx = { projectRoot: f.root, frameworkRoot, frameworkRel: '', harnessRoot: path.join(frameworkRoot, 'harness'), phase, feature: f.feature, phaseRule: loader.loadPhaseRule(phase), featureSpec: loader.loadFeatureSpec(f.feature, inputs), resolvedInputs: inputs, resolvedProfile: loadResolvedProfile(f.root, loadFrameworkConfig(f.root)) } as CheckContext;
      const results = await checker.check(ctx);
      assert(!results.some(check => check.id === 'spec_file_exists' || check.id === 'plan_file_exists'));
      assert(results.some(check => check.id === 'acceptance_content_complete' && check.status === 'PASS'));
      const failures = results.filter(check => check.status === 'FAIL');
      assert(failures.length > 0 && failures.every(check => /facts|context|exploration/.test(check.id)), JSON.stringify(failures));
      assert.equal(visits.at(-1)?.phase, phase); assert.deepStrictEqual(visits.at(-1)?.outputs, []);
      const file = resolveFeatureArtifact(f.root, f.feature, `${phase}.md`).canonicalPath;
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '# Requested design narrative\n');
      const narrativeCtx = { ...ctx, resolvedInputs: { ...inputs, context: { ...inputs.context, required_outputs: [`${phase}/${phase}.md`] } } };
      const count = visits.length;
      const narrativeResults = await checker.check(narrativeCtx);
      assert.equal(visits.length, count + 1, `${phase} narrative path skipped common finalization`);
      assert.deepStrictEqual(visits.at(-1)?.outputs, [`${phase}/${phase}.md`]);
      assert(narrativeResults.some(result => result.status === 'FAIL'), 'fixture must exercise failure gate');
      assert(narrativeResults.every(result => !result.scope_revision_input));
    } } finally { projectionModule.designScopeRevisionChecks = finish; }
    const scope = resolveExecutionScope({ request: { completion_target: 'request', requested_results: ['design'], requested_phases: ['plan'] }, facts: [], contract_fingerprints: [] }, { schema_version: '1.2', name: 'design', auto_chain: ['plan', 'coding'], artifacts: [{ id: 'plan', scope: 'feature', requires: [], obligation_provider_id: 'obligations.plan' }, { id: 'coding', scope: 'feature', requires: [], obligation_provider_id: 'obligations.coding' }] });
    assert.deepStrictEqual(scope.phase_chain, ['plan']);
  } },
  { name: 'typed acceptance and construction preserve runtime and materialize without narrative or reports', run(f) {
    for (const kind of ['acceptance', 'contracts'] as const) {
      const result = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, kind);
      assert.equal(result.state, 'resolved', result.detail);
    }
    const cli = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(frameworkRoot, 'harness/scripts/prepare-blueprint-design.ts'), '--feature', f.feature, '--project-root', f.root, '--framework-root', frameworkRoot], { cwd: path.join(frameworkRoot, 'harness'), encoding: 'utf8', env: { ...process.env, TS_NODE_PROJECT: path.join(frameworkRoot, 'harness/tsconfig.json') } });
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    const files = JSON.parse(cli.stdout).written;
    assert.equal(files.length, 3);
    assert.deepStrictEqual(materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot), []);
    for (const name of ['spec.md', 'plan.md', 'spec/reports/summary.json', 'plan/reports/summary.json']) assert(!resolveFeatureArtifact(f.root, f.feature, name).exists);
  } },
  { name: 'revision bytes mismatch invalidates projection', run(f) {
    fs.appendFileSync(f.blueprintFile, '\n# revision changed\n');
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance').state, 'invalid');
  } },
  { name: 'missing precise acceptance is a spec gap, not a zero-device conclusion', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    delete (node.acceptance as { criteria: Array<{ ut_layer?: string }> }).criteria[0].ut_layer;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const result = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance');
    assert.equal(result.state, 'invalid'); assert(result.detail?.includes('ut_layer'), result.detail);
  } },
  { name: 'existing human contracts conflict before any write', run(f) {
    const file = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').canonicalPath;
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'files: [human.ts]');
    assert.throws(() => materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot), /冲突|无法接管/);
    assert(!resolveFeatureArtifact(f.root, f.feature, 'acceptance.yaml').exists);
    assert.equal(fs.readFileSync(file, 'utf8'), 'files: [human.ts]');
  } },
  ...(['refs-only', 'text-only', 'missing-write', 'missing-mapping', 'runtime-gap', 'unknown-usecase', 'missing-expected', 'ac-disguised-as-boundary', 'external-conflict', 'duplicate-design-id'] as const).map(mode => ({ name: 'projection responsibility gap: ' + mode, run(f: ReturnType<typeof fixture>) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, flowRef.target))!;
    let kind: 'acceptance' | 'contracts' = 'contracts';
    if (mode === 'refs-only') { delete node.acceptance; kind = 'acceptance'; }
    if (mode === 'text-only') { node.acceptance = '验收按设计执行'; kind = 'acceptance'; }
    if (mode === 'missing-write') (node.contracts as { files: string[] }).files = [];
    if (mode === 'missing-mapping') delete (node.contracts as BlueprintRecord).change_unit;
    if (mode === 'runtime-gap') ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0].publications = [];
    if (mode === 'unknown-usecase') { ((node.acceptance as BlueprintRecord).criteria as BlueprintRecord[])[0].linked_flow = 'undefined-usecase'; kind = 'acceptance'; }
    if (mode === 'missing-expected') { delete ((node.acceptance as BlueprintRecord).criteria as BlueprintRecord[])[0].expected_result; kind = 'acceptance'; }
    if (mode === 'ac-disguised-as-boundary') {
      const ac = ((node.acceptance as BlueprintRecord).criteria as BlueprintRecord[])[0];
      for (const field of ['verification_steps', 'testable', 'expected_result']) delete ac[field];
      Object.assign(ac, { scenario: 'negative amount', handling: 'reject', expected_behavior: 'unchanged' }); kind = 'acceptance';
    }
    if (mode === 'external-conflict') {
      const other = asRecord(resolveBlueprintTarget(doc, cu.design_refs[1].target))!;
      other.provenance = { ...asRecord(other.provenance), evidence_strength: 'authoritative' };
      other.contracts = { version: 'conflicting-version' };
    }
    if (mode === 'duplicate-design-id') {
      const other = asRecord(resolveBlueprintTarget(doc, cu.design_refs[1].target))!;
      other.provenance = { ...asRecord(other.provenance), evidence_strength: 'authoritative' };
      const api = { class: 'LedgerFeature', file: 'src/ledger/LedgerFeature.ets', methods: [{ name: 'run', params: [], return: 'void' }] };
      (node.contracts as BlueprintRecord).interfaces = [api];
      other.contracts = { interfaces: [{ ...api, methods: [{ name: 'run', params: [], return: 'Promise<void>' }] }] };
    }
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const result = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, kind);
    assert.notEqual(result.state, 'resolved', `${mode} was accepted`);
    assert(result.detail, `${mode} lost its gap`);
  } })),
];
export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const f = fixture();
    try { await test.run(f); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
  }
  return results;
}
