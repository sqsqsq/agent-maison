import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { fixture, planContracts } from './blueprint-skill-projection.unit.test';
import { featureFilePath, resolveFeatureArtifact, clearFrameworkConfigCache } from '../../config';
import { deriveBlueprintSkillInput, materializeBlueprintSkillInputs, checkAuthoritativeContentAligned } from '../../scripts/utils/blueprint-skill-projection';
import { deriveDesignPreparationReadiness, reconcileChangeUnitBlueprintRefs, reviseChangeUnitContent } from '../../scripts/utils/change-unit-design-preparation';
import { normalizeUseCasePortCalls, SpecLoader } from '../../scripts/utils/spec-loader';
import { resolveCapabilityInputs, readBoundInput } from '../../scripts/utils/capability-resolution';
import { prepareFeatureScopeCandidate, featureScopeCandidateFingerprint, definitionAuthorityGap } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun, decideRunContinuation } from '../../scripts/utils/goal-run-creation';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { validateChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { loadCanonicalChangeUnit, asChangeUnitArtifact, createChangeUnitRef, deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { acceptChangeUnitCandidates } from '../../scripts/utils/change-unit-provider-boundary';
import { evaluateAcceptanceFlowStructure } from '../../scripts/utils/p0-semantic-gates';
import { sha256Bytes } from '../../scripts/utils/component-blueprint-path';
import type { CheckContext, AcceptanceSpec } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
type Fixture = ReturnType<typeof fixture>;
function write(f: Fixture, name: string, value: unknown): void {
  const file = featureFilePath(f.root, f.feature, name);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, YAML.stringify(value));
}
function freeze(f: Fixture) {
  fs.writeFileSync(path.join(f.root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'stage delivery fixture', project_profile: { name: 'generic' }, paths: { features_dir: 'doc/features' }, active_workflow: 'obligation-driven' }));
  clearFrameworkConfigCache();
  const prepared = prepareFeatureScopeCandidate({ projectRoot: f.root, frameworkRoot, feature: f.feature, completionTarget: 'request', requestedResults: ['contracts'], requestedPhases: ['plan'], requirement: 'deliver approved ledger design' });
  if (!prepared.scope.phase_chain.length) {
    freezeFeatureExecutionScope({ projectRoot: f.root, feature: f.feature, scope: prepared.scope, candidateFingerprint: featureScopeCandidateFingerprint(f.root, f.feature) });
    return { run_id: undefined };
  }
  const manifest = buildGoalManifestFromInput({ feature: f.feature, run_id: 'stage-delivery', requirement: 'deliver approved ledger design', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: prepared.scope, chain_override: prepared.scope.phase_chain }, { projectRoot: f.root });
  createGoalRun({ projectRoot: f.root, manifest, chain: prepared.scope.phase_chain, resolveHead: () => 'a'.repeat(40) });
  return manifest;
}
function resolve(f: Fixture, phase: string) {
  return resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase, track: 'full', testTargets: ['src/ledger/LedgerFeature.ets'], requirement: 'deliver approved ledger design', inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } });
}

function identityBump(f: Fixture): void {
  const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8')); bp.revision++;
  for (const row of bp.derived_results ?? []) row.input_revision = bp.revision;
  fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); clearFrameworkConfigCache();
}
function consumerFixture(f: Fixture): Fixture {
  const file = path.join(path.dirname(path.dirname(f.cuFile)), 'ledger-consumer/change-unit.yaml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cu = YAML.parse(fs.readFileSync(path.join(__dirname, '../fixtures/component-blueprint/valid/doc/features/ledger-app-blueprint/ledger-consumer/change-unit.yaml'), 'utf8'));
  const walk = (value: any): void => { if (!value || typeof value !== 'object') return; if (value.artifact === 'component-blueprint@1') value.artifact_sha256 = sha256Bytes(fs.readFileSync(f.blueprintFile)); Object.values(value).forEach(walk); };
  walk(cu); for (const predicate of cu.target_predicates) predicate.verification_refs.push('acceptance:AC-1');
  fs.writeFileSync(file, YAML.stringify(cu));
  return { ...f, feature: deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-consumer'), cuFile: file };
}
function stagePlan(f: Fixture, authorOwned = false): void {
  const loaded = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
  const cu = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', loaded.change_unit_id).changeUnit);
  const accepted = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance');
  const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
  assert(accepted.state === 'resolved' && projected.state === 'resolved', accepted.detail ?? projected.detail);
  const refs = { implementation_refs: ['planned:src/ledger/LedgerFeature.ets'], test_refs: ['planned:test/ledger/LedgerFeature.test.ets'] };
  const contracts = { ...(structuredClone(projected.value) as any), change_unit: {
    change_unit_ref: createChangeUnitRef(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', loaded.change_unit_id)),
    predicate_mappings: cu.target_predicates.map(row => ({ predicate_id: row.predicate_id, ...refs })),
    provide_mappings: cu.provides.map(row => ({ provide_id: row.provide_id, ...refs })),
    design_ref_mappings: cu.design_refs.map(design_ref => ({ design_ref, implementation_refs: refs.implementation_refs, verification_refs: refs.test_refs })),
  } };
  write(f, 'acceptance.yaml', { ...(structuredClone(accepted.value) as any), ...(authorOwned ? { source: 'spec:ledger-request' } : {}) });
  write(f, 'contracts.yaml', { ...contracts, ...(authorOwned ? { source: 'plan:ledger-request' } : {}) });
  write(f, 'use-cases.yaml', { ...(structuredClone(projected.artifacts!['use-cases@1']) as any), ...(authorOwned ? { source: 'plan:ledger-request' } : {}) });
}

const cases: Array<{ name: string; run(f: Fixture): void }> = [
  ...['unfrozen author plan', 'plan changed after freeze'].map(mode => ({
    name: `identity reconciliation keeps unproved stage bytes and gives plan ownership: ${mode}`, run(f: Fixture) {
      const consumer = consumerFixture(f);
      stagePlan(consumer, true);
      stagePlan(f, mode === 'unfrozen author plan');
      if (mode === 'plan changed after freeze') { freeze(f); const file = featureFilePath(f.root, f.feature, 'contracts.yaml'); const value = YAML.parse(fs.readFileSync(file, 'utf8')); value.state_management[0].ordered_steps.push('notify observers'); write(f, 'contracts.yaml', value); }
      const files = [f, consumer].flatMap(unit => ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'].map(name => featureFilePath(unit.root, unit.feature, name)));
      const before = files.map(file => fs.readFileSync(file));
      const revisions = [f, consumer].map(unit => Number(YAML.parse(fs.readFileSync(unit.cuFile, 'utf8')).revision));
      identityBump(f);
      const result = reconcileChangeUnitBlueprintRefs(f.root, 'ledger-app-blueprint');
      assert.equal(result.bumped.length, 2, JSON.stringify(result));
      [f, consumer].forEach((unit, index) => assert.equal(YAML.parse(fs.readFileSync(unit.cuFile, 'utf8')).revision, revisions[index] + 1));
      files.forEach((file, index) => assert(fs.readFileSync(file).equals(before[index]), `${mode}: stage bytes changed`));
      for (const unit of [f, consumer]) {
        const prepared = prepareFeatureScopeCandidate({ projectRoot: unit.root, frameworkRoot, feature: unit.feature, completionTarget: 'feature',
          requestedResults: ['approved ledger work'], requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut'], requirement: 'deliver approved ledger design', overwrite: true });
        assert(prepared.scope.phase_chain.includes('plan'), `plan must own stale stage inputs: ${JSON.stringify(prepared.scope)}`);
      }
    },
  })),
  { name: 'a proved identity refresh preserves supplements even when a sibling has no frozen proof', run(f) {
    const consumer = consumerFixture(f); stagePlan(consumer, true); stagePlan(f);
    const file = featureFilePath(f.root, f.feature, 'contracts.yaml'); const value = YAML.parse(fs.readFileSync(file, 'utf8'));
    value.state_management[0].ordered_steps.push('notify observers'); write(f, 'contracts.yaml', value); freeze(f);
    const sibling = ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'].map(name => featureFilePath(consumer.root, consumer.feature, name));
    const bytes = sibling.map(item => fs.readFileSync(item));
    const before = YAML.parse(fs.readFileSync(file, 'utf8')); identityBump(f);
    assert.equal(reconcileChangeUnitBlueprintRefs(f.root, 'ledger-app-blueprint').bumped.length, 2);
    const after = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert(after.state_management[0].ordered_steps.includes('notify observers'));
    assert.equal(after.change_unit.change_unit_ref.revision, before.change_unit.change_unit_ref.revision + 1);
    sibling.forEach((item, index) => assert(fs.readFileSync(item).equals(bytes[index])));
  } },
  { name: 'stale source is owned by the producer while invalid canonical content remains a real external design blocker', run(f) {
    stagePlan(f); identityBump(f); reconcileChangeUnitBlueprintRefs(f.root, 'ledger-app-blueprint');
    for (const [phase, id, producer] of [['spec', 'acceptance', 'spec'], ['coding', 'contracts', 'plan'], ['ut', 'use_cases', 'plan']]) {
      const input = resolve(f, phase).inputs!.values[id];
      assert.equal(input.state, 'invalid');
      if (input.state === 'invalid') assert(input.detail.startsWith(`${producer}:`), input.detail);
    }
    const prepared = prepareFeatureScopeCandidate({ projectRoot: f.root, frameworkRoot, feature: f.feature, completionTarget: 'feature',
      requestedResults: ['approved ledger work'], requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut'], requirement: 'deliver approved ledger design', overwrite: true });
    assert(prepared.scope.phase_chain.includes('spec') && prepared.scope.phase_chain.includes('plan'));
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    for (const view of bp.design_views) for (const node of view.nodes ?? []) if (node.acceptance) node.acceptance = '验收写成一段文字';
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind(); clearFrameworkConfigCache();
    const raw = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature);
    const blockers = checkAuthoritativeContentAligned({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', featureSpec: raw, phaseRule: {} } as CheckContext, 'acceptance');
    assert(blockers.some(check => check.status === 'FAIL' && check.repair_owner === 'external' && (check.structured as { kind?: string } | undefined)?.kind === 'design_authority'), JSON.stringify(blockers));
    assert(!deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint').ready);
  } },
  { name: 'preserving an unproved Feature still checks projection dependencies and rolls back a real concurrent canonical change', run(f) {
    stagePlan(f);
    const unit = fs.readFileSync(f.cuFile);
    const files = ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'].map(name => featureFilePath(f.root, f.feature, name));
    const bytes = files.map(file => fs.readFileSync(file)); identityBump(f);
    const nodeFs = require('fs') as typeof fs;
    const read = nodeFs.readFileSync; let armed = true;
    nodeFs.readFileSync = ((file: any, options: any) => {
      const result = read(file, options);
      const afterProjectionCapture = new Error().stack?.split('\n')[2]?.includes('at materializeBlueprintSkillInputs');
      if (armed && file === files[1] && afterProjectionCapture) {
        armed = false; fs.appendFileSync(f.blueprintFile, '\n# concurrent canonical update\n');
      }
      return result;
    }) as typeof fs.readFileSync;
    try {
      let failed: unknown;
      try { reconcileChangeUnitBlueprintRefs(f.root, 'ledger-app-blueprint'); } catch (error) { failed = error; }
      assert(!armed, 'the concurrent-change probe must run after canonical writes, before an unproved refresh returns');
      assert(failed instanceof Error && /blueprint projection stale/.test(failed.message), `dependency drift was not propagated: ${String(failed)}`);
      assert(fs.readFileSync(f.cuFile).equals(unit)); files.forEach((file, index) => assert(fs.readFileSync(file).equals(bytes[index])));
    } finally { nodeFs.readFileSync = read; }
  } },
  { name: 'canonical dependency proves a stopped CU change without promoting ordinary mapping errors', run(f: Fixture) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot); write(f, 'contracts.yaml', planContracts(f));
    const prepared = prepareFeatureScopeCandidate({ projectRoot: f.root, frameworkRoot, feature: f.feature, completionTarget: 'feature',
      requestedResults: ['ledger compiled'], requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut'], requirement: 'deliver approved ledger design' });
    const manifest = buildGoalManifestFromInput({ feature: f.feature, run_id: '20261011T000000Z-beef01', requirement: 'deliver approved ledger design',
      execution_scope: prepared.scope, chain_override: prepared.scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
    const born = createGoalRun({ projectRoot: f.root, manifest, chain: prepared.scope.phase_chain, resolveHead: () => 'a'.repeat(40) });
    fs.appendFileSync(born.eventsPath, [
      { type: 'run_start', run_id: manifest.run_id, ts: '2026-10-11T00:00:00Z' },
      { type: 'run_end', run_id: manifest.run_id, status: 'HALTED', ts: '2026-10-11T00:01:00Z' },
    ].map(event => JSON.stringify(event) + '\n').join(''));
    const decide = () => decideRunContinuation({ projectRoot: f.root, feature: f.feature, call: { requirement: manifest.requirement, attended: true } });
    const contractFile = featureFilePath(f.root, f.feature, 'contracts.yaml'); const originalBytes = fs.readFileSync(contractFile);
    const invalid = YAML.parse(originalBytes.toString('utf8')); invalid.change_unit.predicate_mappings.pop(); write(f, 'contracts.yaml', invalid);
    const first = decide(); assert.notEqual(first.kind, 'successor', JSON.stringify(first)); assert.equal(decide().kind, first.kind);
    fs.writeFileSync(contractFile, originalBytes);
    const loaded = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
    const artifact = structuredClone(asChangeUnitArtifact(loaded.changeUnit)); artifact.purpose += ' 同一未完成切片澄清。';
    reviseChangeUnitContent(f.root, 'ledger-app-blueprint', [{ expectedRef: createChangeUnitRef(loaded), candidate: { providerId: artifact.provenance.extraction_method, artifact } }]);
    assert.equal(decide().kind, 'successor', JSON.stringify(decide()));
  } },
  { name: 'plan writing its own use-cases does not change the frozen acceptance design source', run(f) {
    const acceptance = resolve(f, 'plan').inputs!.values.acceptance;
    assert(acceptance.state === 'resolved');
    const contracts = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    write(f, 'contracts.yaml', planContracts(f)); write(f, 'use-cases.yaml', contracts.artifacts!['use-cases@1']);
    assert.deepStrictEqual(readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' }, acceptance.binding), acceptance.value);
    const conflicting = structuredClone(contracts.artifacts!['use-cases@1']) as any;
    conflicting.use_cases[0].coordinator = 'wrong.coordinator'; write(f, 'use-cases.yaml', conflicting);
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance').state, 'resolved');
    assert.deepStrictEqual(readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' }, acceptance.binding), acceptance.value);
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature);
    const checks = checkAuthoritativeContentAligned({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featureSpec: spec, phaseRule: {} } as CheckContext, 'contracts');
    assert(checks.some(check => check.status === 'FAIL' && check.repair_owner !== 'external'), JSON.stringify(checks));
    const before = fs.readFileSync(featureFilePath(f.root, f.feature, 'use-cases.yaml'));
    assert.throws(() => materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot), /use-cases.yaml.*冲突/);
    assert(fs.readFileSync(featureFilePath(f.root, f.feature, 'use-cases.yaml')).equals(before));
  } },
  { name: 'design handoff is read-only and CU mappings belong to plan rather than blueprint projections', run(f) {
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const nodes = bp.design_views.flatMap((v: any) => [...(v.nodes ?? []), ...(v.runtime_data_flows ?? [])]);
    for (const node of nodes.filter((n: any) => n.contracts)) node.contracts.change_unit = { change_unit_ref: { change_unit_id: 'retired-other-unit' } };
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    const readiness = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint');
    assert(readiness.ready, JSON.stringify(readiness.perUnit));
    for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) assert(!resolveFeatureArtifact(f.root, f.feature, name).exists);
    const c = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(c.state, 'resolved', c.detail); assert.equal((c.value as any).change_unit, undefined);
    assert(c.artifacts?.['use-cases@1']);
  } },
  { name: 'plan requires projected use-cases before a physical file exists and UT reads the stage file', run(f) {
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    for (const view of bp.design_views) for (const node of [...(view.nodes ?? []), ...(view.runtime_data_flows ?? [])]) if (node.use_cases) node.use_cases.use_cases[0].branches[0].expected_port_calls = ['repository.load'];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    const manifest = freeze(f);
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', goalRunId: manifest.run_id, featuresDir: 'doc/features' });
    assert(bridge.inputContext?.required_outputs.includes('use-cases.yaml'), JSON.stringify(bridge.inputContext));
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
    const inputs = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full', ...bridge }).inputs!;
    assert(loader.inspectFeatureArtifacts(f.feature, 'plan', inputs).missingRequiredFiles.includes('use-cases.yaml'));
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    write(f, 'contracts.yaml', planContracts(f)); write(f, 'use-cases.yaml', projected.artifacts!['use-cases@1']);
    const actual = resolve(f, 'ut');
    const useCases = actual.inputs?.values.use_cases;
    assert.equal(useCases?.state, 'resolved', JSON.stringify(actual.report));
    if (useCases?.state !== 'resolved') throw new Error('use_cases not resolved');
    assert(useCases.binding.dependencies.some(dep => path.basename(dep.path) === 'use-cases.yaml' && dep.exists));
    assert.deepStrictEqual(readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'ut', track: 'full' }, useCases.binding), useCases.value);
    assert.deepStrictEqual((useCases.value as any).use_cases[0].branches[0].expected_port_calls, ['repository.load']);
    assert(!actual.report.capabilities.filter(cap => cap.inputs.some(input => input.id === 'use_cases')).some(cap => cap.state === 'pruned'));
    const spec = loader.loadFeatureSpec(f.feature, actual.inputs);
    assert(!validateChangeUnitFeatureProjection(f.root, f.feature, spec.contracts, spec.acceptance, !!spec.useCases, 'plan').issues.length);
    fs.unlinkSync(featureFilePath(f.root, f.feature, 'use-cases.yaml'));
    const missing = resolve(f, 'ut');
    assert.notEqual(missing.inputs?.values.use_cases?.state, 'resolved', 'UT must not replace the missing stage file with a projection');
    assert.equal(loader.loadFeatureSpec(f.feature, missing.inputs).useCases, undefined, 'the loader must not retain a projected use-case cache');
  } },
  { name: 'plan consumes the real stage use-case supplement and exposes conflicting output', run(f) {
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    write(f, 'contracts.yaml', planContracts(f));
    const cases = structuredClone(projected.artifacts!['use-cases@1']) as any;
    cases.use_cases[0].branches[0].stage_supplement = 'declared by plan'; write(f, 'use-cases.yaml', cases);
    const options = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' as const, requirement: 'approved design', inputContext: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: ['contracts.yaml', 'use-cases.yaml'] } };
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
    const result = resolveCapabilityInputs(options);
    const spec = loader.loadFeatureSpec(f.feature, result.inputs);
    assert.equal((spec.useCases!.use_cases[0].branches[0] as any).stage_supplement, 'declared by plan');
    const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featureSpec: spec, phaseRule: {} } as CheckContext;
    assert(checkAuthoritativeContentAligned(ctx, 'contracts').every(check => check.status === 'PASS'));
    cases.use_cases[0].branches[0].expected_phase_seq = ['conflicting-plan-output']; write(f, 'use-cases.yaml', cases);
    const bad = loader.loadFeatureSpec(f.feature, resolveCapabilityInputs(options).inputs);
    assert.deepStrictEqual(bad.useCases!.use_cases[0].branches[0].expected_phase_seq, ['conflicting-plan-output']);
    assert(checkAuthoritativeContentAligned({ ...ctx, featureSpec: bad }, 'contracts').some(check => check.status === 'FAIL'));
  } },
  { name: 'independent use-case projection remains consumable when canonical contracts are absent', run(f) {
    const produced = planContracts(f);
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    for (const view of bp.design_views) for (const node of [...(view.nodes ?? []), ...(view.runtime_data_flows ?? [])]) delete node.contracts;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'absent'); assert(projected.artifacts?.['use-cases@1']);
    const loaded = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
    const cu = asChangeUnitArtifact(loaded.changeUnit);
    const repoint = (value: any): void => { if (!value || typeof value !== 'object') return; if (value.artifact === 'component-blueprint@1') Object.assign(value, { ...cu.component_blueprint_ref, target: value.target }); for (const child of Object.values(value)) repoint(child); };
    produced.source = 'plan:authored-contracts'; repoint(produced); produced.change_unit.change_unit_ref = createChangeUnitRef(loaded);
    write(f, 'contracts.yaml', produced); write(f, 'use-cases.yaml', projected.artifacts!['use-cases@1']);
    const actual = resolve(f, 'ut');
    assert.equal(actual.inputs?.values.use_cases?.state, 'resolved', JSON.stringify(actual.report));
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, actual.inputs);
    assert(spec.useCases?.use_cases[0].branches.length);
    assert(!validateChangeUnitFeatureProjection(f.root, f.feature, spec.contracts, spec.acceptance, !!spec.useCases, 'plan').issues.length);
    for (const view of bp.design_views) for (const node of [...(view.nodes ?? []), ...(view.runtime_data_flows ?? [])]) if (node.use_cases) delete node.use_cases.use_cases[0].coordinator;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').state, 'invalid');
    assert.equal(resolve(f, 'ut').inputs?.values.use_cases?.state, 'invalid');
  } },
  { name: 'design without projected cases does not invent a plan output obligation', run(f) {
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    for (const view of bp.design_views) for (const node of [...(view.nodes ?? []), ...(view.runtime_data_flows ?? [])]) delete node.use_cases;
    // Keep an uncomplicated design so the existing runtime obligation also does not require cases.
    for (const view of bp.design_views) for (const node of [...(view.nodes ?? []), ...(view.runtime_data_flows ?? [])]) if (node.contracts) node.contracts.state_management = [];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    const manifest = freeze(f);
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', goalRunId: manifest.run_id, featuresDir: 'doc/features' });
    assert(!bridge.inputContext?.required_outputs.includes('use-cases.yaml'));
  } },
  { name: 'materialized source identity survives legitimate spec supplements and real binding consumption', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const file = featureFilePath(f.root, f.feature, 'acceptance.yaml');
    const acceptance = YAML.parse(fs.readFileSync(file, 'utf8')) as AcceptanceSpec & Record<string, unknown>;
    const source = acceptance.source;
    fs.writeFileSync(path.join(f.root, 'ui-request.md'), '刷新显示已提交账目');
    write(f, 'ui-spec.yaml', { schema_version: '1.0', screens: [{ id: 'entry', elements: [{ id: 'refresh', type: 'button' }] }, { id: 'current', elements: [{ id: 'balance', type: 'text' }] }] });
    Object.assign(acceptance.criteria[0], { linked_flow: 'ledger-refresh', requirement_ref: { source_path: 'ui-request.md', snippet: '刷新显示已提交账目' }, checkpoint: { pre_screen: 'entry', action: { type: 'touch', target_element_id: 'refresh' }, post_screen: 'current', required_element_ids: ['balance'] } });
    acceptance.flows = { 'ledger-refresh': { screens: ['entry', 'current'] } };
    write(f, 'acceptance.yaml', acceptance);
    const actual = resolve(f, 'spec'); const input = actual.inputs?.values.acceptance;
    assert.equal(input?.state, 'resolved', JSON.stringify(actual.report));
    if (input?.state !== 'resolved') throw new Error('acceptance not resolved');
    assert.equal((input.value as AcceptanceSpec).source, source);
    assert.deepStrictEqual(readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', track: 'full' }, input.binding), input.value);
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, actual.inputs);
    const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', featureSpec: spec, phaseRule: {} } as CheckContext;
    assert(checkAuthoritativeContentAligned(ctx, 'acceptance').every(check => check.status === 'PASS'));
    assert(evaluateAcceptanceFlowStructure(f.root, f.feature, spec.acceptance).every(check => check.status === 'PASS'));
    write(f, 'contracts.yaml', planContracts(f)); freeze(f);
    const oldCuSha = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').artifactSha256;
    const oldBlueprintSha = sha256Bytes(fs.readFileSync(f.blueprintFile));
    const bytes = fs.readFileSync(file, 'utf8');
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8')); cu.revision++; fs.writeFileSync(f.cuFile, YAML.stringify(cu));
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, { changeUnitSha: oldCuSha, blueprintSha: oldBlueprintSha });
    assert.equal(fs.readFileSync(file, 'utf8').replace(/derive\.blueprint-acceptance:[^\n]+/, 'SOURCE'), bytes.replace(/derive\.blueprint-acceptance:[^\n]+/, 'SOURCE'));
    acceptance.source = YAML.parse(fs.readFileSync(file, 'utf8')).source;
    acceptance.criteria[0].expected_result = 'discard approved expectation'; write(f, 'acceptance.yaml', acceptance);
    assert.equal(resolve(f, 'spec').report.assurance, 'blocked');
  } },
  { name: 'refresh preserves supplemented bytes when the real design changed', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot); write(f, 'contracts.yaml', planContracts(f)); freeze(f);
    const oldCuSha = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').artifactSha256;
    const blueprintSha = sha256Bytes(fs.readFileSync(f.blueprintFile));
    const file = featureFilePath(f.root, f.feature, 'acceptance.yaml'); const before = fs.readFileSync(file);
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    for (const view of bp.design_views) for (const node of view.nodes ?? []) if (node.acceptance) node.acceptance.criteria[0].expected_result = 'new requirement';
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    assert.deepStrictEqual(materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, { changeUnitSha: oldCuSha, blueprintSha }), []);
    assert(fs.readFileSync(file).equals(before));
  } },
  { name: 'author contracts with absent optional fields use the same normalized binding proof in real identity reconciliation', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const contracts = planContracts(f); delete contracts.conventions_applied;
    write(f, 'contracts.yaml', contracts); freeze(f);
    const before = YAML.parse(fs.readFileSync(featureFilePath(f.root, f.feature, 'contracts.yaml'), 'utf8'));
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8')); bp.revision++;
    for (const row of bp.derived_results ?? []) row.input_revision = bp.revision;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp));
    const result = reconcileChangeUnitBlueprintRefs(f.root, 'ledger-app-blueprint');
    assert.equal(result.bumped.length, 1, JSON.stringify(result));
    const after = YAML.parse(fs.readFileSync(featureFilePath(f.root, f.feature, 'contracts.yaml'), 'utf8'));
    assert.equal(after.conventions_applied, undefined, 'normalization must not rewrite business bytes');
    assert.deepStrictEqual(after.files, before.files);
    assert.equal(after.change_unit.change_unit_ref.revision, before.change_unit.change_unit_ref.revision + 1);
  } },
  { name: 'refresh cannot use acceptance alone to hide a CU contract change or missing equivalence proof', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const previous = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
    const blueprintSha = sha256Bytes(fs.readFileSync(f.blueprintFile));
    const cu = YAML.parse(previous.bytes.toString('utf8')); cu.revision++; fs.writeFileSync(f.cuFile, YAML.stringify(cu));
    const before = fs.readFileSync(featureFilePath(f.root, f.feature, 'acceptance.yaml'));
    assert.deepStrictEqual(materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, { changeUnitSha: previous.artifactSha256, blueprintSha }), []);
    assert(fs.readFileSync(featureFilePath(f.root, f.feature, 'acceptance.yaml')).equals(before));
    fs.writeFileSync(f.cuFile, previous.bytes); write(f, 'contracts.yaml', planContracts(f)); freeze(f);
    cu.target_predicates[0].description += ' with a changed delivery promise'; fs.writeFileSync(f.cuFile, YAML.stringify(cu));
    assert.deepStrictEqual(materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, { changeUnitSha: previous.artifactSha256, blueprintSha }), []);
    assert(fs.readFileSync(featureFilePath(f.root, f.feature, 'acceptance.yaml')).equals(before));
  } },
  ...[false, true].map(authorOwned => ({ name: `a preserved ${authorOwned ? 'author' : 'stamped'} use-case artifact cannot turn a valid canonical design change into a design-owner conflict`, run(f: Fixture) {
    stagePlan(f, authorOwned); freeze(f);
    const file = featureFilePath(f.root, f.feature, 'use-cases.yaml'); const before = fs.readFileSync(file);
    const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    for (const view of bp.design_views) for (const node of view.nodes ?? []) if (node.use_cases) {
      node.use_cases.use_cases[0].state_model.phases.splice(1, 0, 'recovered');
      node.use_cases.use_cases[0].branches[0].expected_phase_seq.splice(1, 0, 'recovered');
    }
    bp.revision++; for (const row of bp.derived_results ?? []) row.input_revision = bp.revision;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); clearFrameworkConfigCache();
    assert.equal(reconcileChangeUnitBlueprintRefs(f.root, 'ledger-app-blueprint').bumped.length, 1);
    assert(fs.readFileSync(file).equals(before));
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'resolved', JSON.stringify({ codes: projected.codes, detail: projected.detail }));
    assert(deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint').ready);
    const input = resolve(f, 'ut').inputs!.values.use_cases;
    if (authorOwned) {
      assert.equal(input.state, 'resolved', 'the author file remains a real stage artifact');
      // Rebuild current contracts so a stale CU mapping cannot hide the independent use-case gap.
      write(f, 'contracts.yaml', { ...planContracts(f), source: 'plan:ledger-request' });
      assert(definitionAuthorityGap({ projectRoot: f.root, frameworkRoot, feature: f.feature }, 'contracts')?.includes('use_cases:'));
      const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature);
      const checks = checkAuthoritativeContentAligned({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featureSpec: spec, phaseRule: {} } as CheckContext, 'contracts');
      assert(checks.some(check => check.status === 'FAIL' && check.repair_owner !== 'external'), JSON.stringify(checks));
      assert(fs.readFileSync(file).equals(before), 'alignment must not rewrite the author artifact');
    } else {
      assert.equal(input.state, 'invalid'); if (input.state === 'invalid') assert(input.detail.startsWith('plan:'), input.detail);
    }
    const prepared = prepareFeatureScopeCandidate({ projectRoot: f.root, frameworkRoot, feature: f.feature, completionTarget: 'feature', requestedResults: ['approved ledger work'],
      requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut'], requirement: 'deliver approved ledger design', overwrite: true });
    assert(prepared.scope.phase_chain.includes('plan'));
    if (authorOwned) {
      write(f, 'use-cases.yaml', { ...(structuredClone(projected.artifacts!['use-cases@1']) as any), source: 'plan:ledger-request' });
      assert.equal(definitionAuthorityGap({ projectRoot: f.root, frameworkRoot, feature: f.feature }, 'contracts'), undefined);
      const repaired = resolve(f, 'ut').inputs!.values.use_cases;
      assert.equal(repaired.state, 'resolved');
      if (repaired.state === 'resolved') assert((repaired.value as any).use_cases[0].state_model.phases.includes('recovered'));
    }
  } })),
  { name: 'runtime role omissions are rejected before any candidate is accepted', run(f) {
    const artifact = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
    fs.unlinkSync(f.cuFile);
    const complete = structuredClone(artifact); artifact.target_predicates = artifact.target_predicates.filter(row => !['owner', 'consumer'].includes(row.role));
    const providerId = artifact.provenance.extraction_method;
    assert.throws(() => acceptChangeUnitCandidates(f.root, [{ providerId, artifact }]), /change_unit_runtime_vertical_role_missing/);
    assert(!fs.existsSync(f.cuFile));
    assert.equal(acceptChangeUnitCandidates(f.root, [{ providerId, artifact: complete }]).length, 1);
  } },
  { name: 'legacy port calls share one normalization and conflicts stay visible', run() {
    const branch = { id: 'success', expected_boundary_calls: ['repository.write'] };
    const legacy = { use_cases: [{ id: 'open-card', branches: [branch] }] };
    const normalized = normalizeUseCasePortCalls(legacy);
    assert.deepStrictEqual((normalized.value.use_cases[0].branches[0] as any).expected_port_calls, ['repository.write']);
    assert('expected_boundary_calls' in legacy.use_cases[0].branches[0]);
    assert.equal(normalizeUseCasePortCalls({ use_cases: [{ branches: [{ ...branch, expected_port_calls: ['repository.write'] }] }] }).issues.length, 0);
    const conflict = normalizeUseCasePortCalls({ use_cases: [{ branches: [{ ...branch, expected_port_calls: ['repository.read'] }] }] });
    assert(conflict.issues[0].includes('branches[0]')); assert(conflict.value.use_cases[0].branches[0].expected_boundary_calls);
  } },
];
export function runAll(): UnitCaseResult[] {
  const only = process.env.BLUEPRINT_STAGE_DELIVERY_ONLY?.split(',').map(name => name.trim()).filter(Boolean);
  return cases.filter(test => !only?.length || only.some(name => test.name.startsWith(name))).map(test => { const f = fixture(); try {
    const workspace = path.dirname(path.dirname(f.cuFile));
    for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) if (entry.isDirectory() && !['blueprint', 'ledger-refresh'].includes(entry.name)) fs.rmSync(path.join(workspace, entry.name), { recursive: true, force: true });
    test.run(f); return { name: test.name, ok: true };
  } catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); } });
}
