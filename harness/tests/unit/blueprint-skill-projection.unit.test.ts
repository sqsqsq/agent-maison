import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { deriveBlueprintSkillInput, deriveBlueprintCandidateSkillInput, materializeBlueprintSkillInputs, BlueprintProjectionPreparationError, designScopeRevisionChecks, checkTypedConstructionContent, checkAuthoritativeContentAligned, diagnoseBlueprintSkillAuthority, diagnoseDesignAuthority, selectBlueprintSkillContent, resolveChangeUnitConstructionInputs } from '../../scripts/utils/blueprint-skill-projection';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { asRecord, type BlueprintRecord, type ComponentBlueprintRef } from '../../scripts/utils/component-blueprint-model';
import { resolveFeatureArtifact, clearFrameworkConfigCache, loadFrameworkConfig, loadArchitectureDsl } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { resolveCapabilityInputs, readBoundInput } from '../../scripts/utils/capability-resolution';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import checkSpec from '../../scripts/check-spec';
import checkPlan, { checkContractFileReferenceClosure } from '../../scripts/check-plan';
import { designOwnerBlockers, buildDesignOwnerGuidance } from '../../scripts/goal-phase-runtime';
import { buildSummaryBlockers } from '../../scripts/utils/summary-blockers';
import { checkChangeUnitFeatureProjection, architectureImpactIssues } from '../../scripts/utils/change-unit-feature-projection';
import { checkDesignToCode } from '../../scripts/check-coding';
import type { CheckContext, ContractsSpec } from '../../scripts/utils/types';
import { resolveExecutionScope } from '../../scripts/utils/execution-scope';
import type { ResolvedScopeFacts } from '../../scripts/utils/execution-scope';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import type { WorkflowSpec } from '../../workflow-loader';
import { collectContextFiles, writeRunSummaryBase } from '../../harness-runner';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { executedEvidenceInputs } from '../../scripts/utils/phase-closure-finalizer';
import { resolvePhaseEvidenceManifest, writePhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { initializeFidelityRouting } from '../../scripts/utils/goal-preflight';
import { spawnSync } from 'child_process';
import { readScopeAcceptance, prepareChangeUnitScopeInput, prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { checkAcceptanceContent } from '../../scripts/utils/check-acceptance';
import { checkUseCaseSpecSchema } from '../../scripts/check-ut';
import { diagnoseBlueprintContent } from '../../scripts/utils/component-blueprint-validator';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { inspectAcceptanceItem, inspectTypedConstructionContent, inspectUseCaseItem } from '../../scripts/utils/design-content-checks';
import { collectCleanPassIssues, readReusableCheckResult } from '../../scripts/utils/verify-feature-completion';
import type { UnitCaseResult } from '../run-unit';
import { asChangeUnitArtifact, createChangeUnitRef, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { validateChangeUnitDesign, readChangeUnitDesignOwnership } from '../../scripts/utils/change-unit-design-gate';
import { acceptChangeUnitCandidate, ChangeUnitCandidateRejected } from '../../scripts/utils/change-unit-provider-boundary';
import { initialDesignCandidateRejection } from '../../scripts/utils/initial-design-delivery';
import { ownersForAddress } from '../../scripts/utils/change-unit-addressing';

const frameworkRoot = path.resolve(__dirname, '../../..');
const sha = (file: string) => 'sha256:' + createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function fixture(root = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-skill-'))): { root: string; feature: string; blueprintFile: string; cuFile: string; bind(): void } {
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

/** 模拟 plan 从已批准设计与当前 CU 生成真实 Feature 施工映射。 */
export function planContracts(f: ReturnType<typeof fixture>): ContractsSpec & { change_unit: NonNullable<ContractsSpec['change_unit']> } {
  const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
  assert.equal(projected.state, 'resolved', projected.detail);
  const loaded = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
  const cu = asChangeUnitArtifact(loaded.changeUnit);
  const implementation_refs = ['planned:src/ledger/LedgerFeature.ets'];
  const test_refs = ['planned:test/ledger/LedgerFeature.test.ets'];
  return { ...structuredClone(projected.value as ContractsSpec), change_unit: {
    change_unit_ref: createChangeUnitRef(loaded),
    predicate_mappings: cu.target_predicates.map(row => ({ predicate_id: row.predicate_id, implementation_refs, test_refs })),
    provide_mappings: cu.provides.map(row => ({ provide_id: row.provide_id, implementation_refs, test_refs })),
    design_ref_mappings: cu.design_refs.map(design_ref => ({ design_ref, implementation_refs, verification_refs: test_refs })),
  } };
}

const cases: Array<{ name: string; run(f: ReturnType<typeof fixture>): void | Promise<void> }> = [
  { name: '4c8 original contract writer completes required authorized modules and preserves declarations', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const target = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const contracts = target.contracts as BlueprintRecord;
    const test = '02-Feature/ledger/src/ohosTest/ets/test/ledger.test.ets';
    fs.mkdirSync(path.dirname(path.join(f.root, test)), { recursive: true });
    fs.writeFileSync(path.join(f.root, test), '// frozen test target\n');
    (contracts.files as string[]).push(test);
    const catalogFile = path.join(f.root, 'doc/module-catalog.yaml');
    const catalog = YAML.parse(fs.readFileSync(catalogFile, 'utf8'));
    Object.assign(catalog.modules[0], { format: 'HAR', entry_file: '02-Feature/ledger/src/main/ets/index.ets' });
    fs.writeFileSync(catalogFile, YAML.stringify(catalog));
    const save = () => { fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind(); clearFrameworkConfigCache(); };
    save();
    const read = () => deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    const generated = read();
    assert.equal(generated.state, 'resolved', generated.detail);
    assert.deepEqual((generated.value as ContractsSpec).modules, [{ name: 'ledger', layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: '02-Feature/ledger' }]);
    contracts.modules = [{ name: 'ledger', package_path: '02-Feature/ledger', change_type: 'add' }]; save();
    const authoredBytes = fs.readFileSync(f.blueprintFile);
    const partial = read(); assert.equal(partial.state, 'resolved', partial.detail);
    assert.deepEqual((partial.value as ContractsSpec).modules, [{ name: 'ledger', layer: '02-Feature', format: 'HAR', change_type: 'add', package_path: '02-Feature/ledger' }],
      'unique missing metadata is completed while the original declared change type is preserved');
    const handwritten = structuredClone(partial.value as ContractsSpec);
    delete (handwritten.modules[0] as unknown as BlueprintRecord).format;
    const context = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featureSpec: { contracts: handwritten,
      acceptance: partial.artifacts?.['acceptance@1'], useCases: partial.artifacts?.['use-cases@1'] } } as unknown as CheckContext;
    assert(!checkAuthoritativeContentAligned(context, 'contracts').some(check => check.status === 'FAIL'), 'read-only alignment shares deterministic copies without requiring an author to repeat them');
    assert.equal(handwritten.modules[0].format, undefined, 'read-only alignment never changes the supplied author artifact');
    handwritten.modules[0].format = 'HSP';
    assert(checkAuthoritativeContentAligned(context, 'contracts').some(check => check.status === 'FAIL'), 'an explicit conflicting field is never replaced by a derived copy');
    assert(fs.readFileSync(f.blueprintFile).equals(authoredBytes), 'completion and comparison never rewrite original authority bytes');
    const other = { name: 'existing-helper', layer: '05-SystemBase', format: 'HAR', change_type: 'modify', package_path: '05-SystemBase/existing-helper' };
    contracts.modules = [other]; save();
    const retained = read(); assert.equal(retained.state, 'resolved', retained.detail);
    assert.deepEqual((retained.value as ContractsSpec).modules[0], other, 'an existing other module stays intact');
    assert.equal((retained.value as ContractsSpec).modules[1].name, 'ledger');
    contracts.modules = [{ name: 'ledger', layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: '02-Feature/wrong' }]; save();
    const mismatch = read(); assert.equal(mismatch.state, 'invalid'); assert(mismatch.detail?.includes('错配') && mismatch.detail.includes('package_path'));
    fs.mkdirSync(path.join(f.root, '04-BusinessBase/ledger'), { recursive: true });
    contracts.modules = structuredClone((generated.value as ContractsSpec).modules); save();
    const exact = read(); assert.equal(exact.state, 'resolved', exact.detail);
    assert.deepEqual((exact.value as ContractsSpec).modules, contracts.modules, 'a complete legal declaration with one frozen path match survives another unrelated directory of the same name');
    contracts.modules = []; save();
    (contracts.files as string[]).push('04-BusinessBase/ledger/Other.ets'); save();
    const ambiguous = read(); assert.equal(ambiguous.state, 'invalid'); assert(ambiguous.detail?.includes('不唯一'));
    assert.equal(fs.existsSync(resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath), false, 'failed preparation never writes a partial contract');
  } },
  { name: 'daily regression: unresolved construction remains real plan work without invalidating readable design', run(f) {
    const options = { projectRoot: f.root, frameworkRoot, feature: f.feature, completionTarget: 'feature' as const,
      requestedResults: ['refresh ledger'], requestedPhases: ['coding', 'review', 'ut'], requirement: 'refresh ledger', overwrite: true };
    for (const name of ['acceptance.yaml', 'use-cases.yaml']) fs.rmSync(resolveFeatureArtifact(f.root, f.feature, name).actualPath, { force: true });
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    assert(!prepareFeatureScopeCandidate(options).scope.phase_chain.includes('plan'), 'known canonical mapping must be generated by its existing writer without a plan call');
    const blueprint = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const removeMapping = (value: unknown): void => { if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) delete (value as BlueprintRecord).change_unit;
      Object.values(value).forEach(removeMapping); };
    removeMapping(blueprint); fs.writeFileSync(f.blueprintFile, YAML.stringify(blueprint)); f.bind();
    for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(resolveFeatureArtifact(f.root, f.feature, name).actualPath, { force: true });
    const source = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(source.state, 'resolved', source.detail); assert.equal((source.value as ContractsSpec).change_unit, undefined);
    assert.equal(deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint').perUnit.find(unit => unit.changeUnitId === 'ledger-refresh')?.verdict, 'constructable');
    assert.deepEqual(diagnoseBlueprintSkillAuthority(f.root, frameworkRoot, f.feature).findings, []);
    assert(resolveChangeUnitConstructionInputs(f.root, f.feature, frameworkRoot).gap, 'missing decisions became completed construction');
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    assert(prepareFeatureScopeCandidate(options).scope.phase_chain.includes('plan'), 'unresolved construction has no executable owner');
    // The original plan author now chooses its real mapping; no filename/AC inference supplies it.
    fs.writeFileSync(resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath, YAML.stringify(planContracts(f)));
    assert(!prepareFeatureScopeCandidate(options).scope.phase_chain.includes('plan'), 'a legitimate current plan was replaced with an incomplete blueprint prediction');
  } },
  { name: 'B4 author mapping candidate is accepted through the original writer and immediately consumable by scope preparation', run(f) {
    const { acceptChangeUnitDecomposition, deriveDesignPreparationReadiness } = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
    const loaded = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh'), cu = asChangeUnitArtifact(loaded.changeUnit);
    const contracts = planContracts(f); const { change_unit_ref: _identity, ...construction_mapping } = contracts.change_unit;
    fs.rmSync(f.cuFile);
    const candidateFile = path.join(path.dirname(f.blueprintFile), 'change-unit-candidates.json');
    fs.writeFileSync(candidateFile, JSON.stringify([{ providerId: cu.provenance.extraction_method, artifact: cu, construction_mapping }]));
    const acceptedProcess = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(frameworkRoot, 'harness/scripts/check-change-unit.ts'), '--project-root', f.root, '--blueprint', cu.blueprint_id, '--accept-candidates', candidateFile, '--json'],
      { cwd: path.join(frameworkRoot, 'harness'), encoding: 'utf8', timeout: 60000 });
    const accepted = JSON.parse(acceptedProcess.stdout); assert.equal(accepted.accepted.length, 1, acceptedProcess.stderr + acceptedProcess.stdout);
    assert(!fs.existsSync(candidateFile), '接受后临时候选未消费清理');
    const canonical = loadCanonicalChangeUnit(f.root, cu.blueprint_id, cu.change_unit_id);
    const output = YAML.parse(fs.readFileSync(resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath, 'utf8'));
    assert.equal(output.change_unit.change_unit_ref.artifact_sha256, canonical.artifactSha256);
    assert.deepEqual(output.change_unit.predicate_mappings, construction_mapping.predicate_mappings);
    const readiness = deriveDesignPreparationReadiness(f.root, cu.blueprint_id);
    assert(readiness.perUnit.find(unit => unit.changeUnitId === cu.change_unit_id)?.verdict === 'constructable', JSON.stringify(readiness));
    const next = prepareFeatureScopeCandidate(prepareChangeUnitScopeInput({ projectRoot: f.root, frameworkRoot, changeUnit: cu, requirement: 'Refresh the approved ledger', requestedResults: ['refreshed ledger'], requestedPhases: ['coding'] }));
    assert(next.candidate.request.requirement_basis, 'scope准备仍等待额外人工contracts sidecar');
    const scopeProcess = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(frameworkRoot, 'harness/scripts/goal-mode-entry.ts'), '--project-root', f.root, '--framework-root', frameworkRoot, '--feature', f.feature,
      '--prepare-scope', '--completion-target', 'feature', '--requested-results', 'refreshed ledger', '--requested-phases', 'coding', '--requirement', 'Refresh the approved ledger'], { cwd: path.join(frameworkRoot, 'harness'), encoding: 'utf8', timeout: 60000 });
    assert.equal(scopeProcess.status, 0, scopeProcess.stderr + scopeProcess.stdout);
    const stage = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath;
    const incomplete = YAML.parse(fs.readFileSync(stage, 'utf8')); delete incomplete.change_unit; incomplete.author_notes = 'retain existing owner detail'; fs.writeFileSync(stage, YAML.stringify(incomplete));
    const { reviseChangeUnitContent } = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
    const beforeRevision = fs.readFileSync(f.cuFile);
    const repaired = reviseChangeUnitContent(f.root, cu.blueprint_id, [{ expectedRef: createChangeUnitRef(canonical), candidate: { providerId: cu.provenance.extraction_method, artifact: asChangeUnitArtifact(canonical.changeUnit), construction_mapping } }]);
    assert(repaired.unchanged.includes(cu.change_unit_id) && fs.readFileSync(f.cuFile).equals(beforeRevision), '只补映射不应改CU内容/revision');
    const repairedStage = YAML.parse(fs.readFileSync(stage, 'utf8'));
    assert(repairedStage.change_unit && repairedStage.author_notes === 'retain existing owner detail', '原writer补映射时覆盖合法人工补充');
    const badRoot = fixture();
    try {
      const invalid = structuredClone(construction_mapping); invalid.predicate_mappings[0].test_refs = [];
      const bad = asChangeUnitArtifact(loadCanonicalChangeUnit(badRoot.root, cu.blueprint_id, cu.change_unit_id).changeUnit); fs.rmSync(badRoot.cuFile);
      const before = fs.existsSync(resolveFeatureArtifact(badRoot.root, badRoot.feature, 'contracts.yaml').actualPath);
      assert.throws(() => acceptChangeUnitDecomposition(badRoot.root, bad.blueprint_id, [{ providerId: bad.provenance.extraction_method, artifact: bad, construction_mapping: invalid }]), /test_refs|test|映射|原子写出/);
      assert(!fs.existsSync(badRoot.cuFile), '坏映射留下canonical CU');
      assert.equal(fs.existsSync(resolveFeatureArtifact(badRoot.root, badRoot.feature, 'contracts.yaml').actualPath), before, '失败留下部分Feature契约');
    } finally { fs.rmSync(badRoot.root, { recursive: true, force: true }); }
  } },
  { name: 'design ownership: explicit architecture decision uses the same unpublished DSL without changing construction authority', run(f) {
    const blueprint = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = asChangeUnitArtifact(YAML.parse(fs.readFileSync(f.cuFile, 'utf8')));
    const configFile = path.join(f.root, 'framework.config.json');
    const before = fs.existsSync(configFile) ? fs.readFileSync(configFile) : undefined;
    const architecture = structuredClone(loadArchitectureDsl(f.root));
    architecture.outer_layers.push({ id: '05-Candidate', can_depend_on: [], intra_layer_deps: 'forbid' });
    blueprint.decisions_and_gaps.decisions.push({ decision_id: 'new-layer-owner', kind: 'architecture_impact', change: 'add_module',
      module: 'new-owner-module', layer: '05-Candidate', status: 'decided_with_authority', rationale: '原请求中明确的恢复职责',
      owner: 'design-owner', verification_refs: ['view:development'], provenance: structuredClone(blueprint.provenance) });
    cu.design_refs.push({ ...cu.component_blueprint_ref, target: { kind: 'decision', id: 'new-layer-owner' } });
    const designContracts = asRecord(resolveBlueprintTarget(blueprint, cu.design_refs[0].target).contracts)!;
    (designContracts.files as string[]).push('framework.config.json');
    (asRecord(designContracts.change_unit)!.design_ref_mappings as BlueprintRecord[]).push({ design_ref: { kind: 'decision', id: 'new-layer-owner' }, implementation_refs: ['framework.config.json'], verification_refs: ['planned:test/ledger/LedgerFeature.test.ets'] });
    const missing = deriveBlueprintCandidateSkillInput(f.root, f.feature, frameworkRoot, 'contracts', { blueprint, changeUnit: cu });
    assert(missing.state === 'invalid' && missing.codes?.includes('cu_architecture_impact_not_effective'), JSON.stringify(missing));
    const proposed = deriveBlueprintCandidateSkillInput(f.root, f.feature, frameworkRoot, 'contracts', { blueprint, changeUnit: cu, architecture });
    assert.equal(proposed.state, 'resolved', proposed.detail);
    assert(architectureImpactIssues(f.root, blueprint, ['ledger'], ['new-layer-owner']).issues.some(issue => issue.id === 'cu_architecture_impact_not_effective'),
      'construction must still reject an unpublished layer');
    assert(!loadArchitectureDsl(f.root).outer_layers.some(layer => layer.id === '05-Candidate'));
    assert.equal(fs.existsSync(configFile), before !== undefined);
    if (before) assert(fs.readFileSync(configFile).equals(before), 'candidate diagnostics cannot publish the DSL');
  } },
  { name: 'design ownership: a dependent contract later gaining delivery content stays with its explicit owner', run(f) {
    const blueprint = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const owner = asChangeUnitArtifact(YAML.parse(fs.readFileSync(f.cuFile, 'utf8')));
    const dependent = structuredClone(owner);
    dependent.change_unit_id = 'dependent-reader';
    dependent.provenance.extraction_method = 'consumer-validated-decomposition';
    dependent.design_refs = dependent.design_refs.filter(ref => ref.target.kind !== 'contract');
    const accepted = acceptChangeUnitCandidate(f.root, { providerId: 'consumer-validated-decomposition', artifact: dependent });
    const current = asChangeUnitArtifact(accepted.changeUnit);
    const target = owner.design_refs.find(ref => ref.target.kind === 'contract')!;
    const address = 'contract:' + target.target.id;
    const before = selectBlueprintSkillContent(blueprint, current);
    const contract = resolveBlueprintTarget(blueprint, target.target);
    contract.acceptance = { criteria: [{ id: 'OWNER-ONLY-AC', description: 'Only the original owner delivers this contract addition.' }] };
    contract.contracts = { files: ['src/owner/NewContract.ts'] };
    contract.provenance = { ...asRecord(contract.provenance), evidence_strength: 'authoritative' };
    const after = selectBlueprintSkillContent(blueprint, current);
    assert.deepEqual(after.acceptance, before.acceptance);
    assert.deepEqual(after.contracts, before.contracts);
    assert.deepEqual(ownersForAddress([current, owner], address), [owner.change_unit_id]);
    const owned = selectBlueprintSkillContent(blueprint, owner);
    assert(JSON.stringify(owned.acceptance).includes('OWNER-ONLY-AC') && JSON.stringify(owned.contracts).includes('src/owner/NewContract.ts'));
    blueprint.contracts.push({ ...structuredClone(contract), contract_id: 'new-unassigned-contract' });
    const missing = readChangeUnitDesignOwnership(f.root, owner.blueprint_id, [], blueprint);
    assert(missing.some(issue => issue.message.includes('contract:new-unassigned-contract')), 'the new obligation must return to design instead of being assigned through dependency traversal');
    assert(!current.design_refs.some(ref => ref.target.id === 'new-unassigned-contract'));
  } },
  { name: 'goal alignment: publication preserves explicit roots when an unowned dependency later gains delivery content', run(f) {
    const blueprint = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = asChangeUnitArtifact(YAML.parse(fs.readFileSync(f.cuFile, 'utf8')));
    const scenarioRef = cu.design_refs.find(ref => ref.target.kind === 'node' && ref.target.view_id === 'scenarios')!;
    const flowRef = cu.design_refs.find(ref => ref.target.kind === 'flow')!;
    const scenario = resolveBlueprintTarget(blueprint, scenarioRef.target);
    cu.change_unit_id = 'explicit-selection';
    cu.provenance.extraction_method = 'builtin-vertical-slice-decomposition';
    cu.design_refs = cu.design_refs.filter(ref => ref !== scenarioRef && ref !== flowRef);
    const authored = structuredClone(cu);
    const accepted = acceptChangeUnitCandidate(f.root, { providerId: 'builtin-vertical-slice-decomposition', artifact: cu });
    const published = asChangeUnitArtifact(accepted.changeUnit);
    assert.deepEqual(published.design_refs, authored.design_refs, 'the canonical writer must not add context references');
    assert.deepEqual(cu, authored, 'publication must not mutate the supplied candidate');
    const address = 'view:scenarios/node:' + scenarioRef.target.id;
    assert.deepEqual(ownersForAddress([published], address), [], 'a dependency is not an ownership claim');
    const before = selectBlueprintSkillContent(blueprint, published);
    scenario.acceptance = { criteria: [{ id: 'SIBLING-AC', description: 'A different CU delivers this.' }] };
    scenario.contracts = { files: ['src/sibling/Screen.ets'] };
    scenario.use_cases = { use_cases: [{ id: 'SIBLING-UC' }] };
    scenario.provenance = { ...asRecord(scenario.provenance), evidence_strength: 'authoritative' };
    const after = selectBlueprintSkillContent(blueprint, published);
    assert.deepEqual(after.contracts, before.contracts);
    assert.deepEqual(after.acceptance, before.acceptance);
    assert.deepEqual(after.useCases, before.useCases);
    assert.deepEqual(ownersForAddress([published], address), []);
    const resolveRef = ((_: string, ref: ComponentBlueprintRef) => ({ ref, blueprint,
      target: resolveBlueprintTarget(blueprint, ref.target) })) as typeof import('../../scripts/utils/component-blueprint-path').resolveComponentBlueprintRef;
    const design = validateChangeUnitDesign(f.root, { ...published }, { resolveBlueprintRef: resolveRef });
    assert(design.requiredAddresses.includes(address), 'the full dependency remains checked without claiming ownership');
    scenario.status = 'open_decision';
    assert(validateChangeUnitDesign(f.root, { ...published }, { resolveBlueprintRef: resolveRef }).issues
      .some(issue => issue.id === 'change_unit_current_design_unresolved'), 'unselected dependencies must still be effective');
    delete scenario.status;
    const explicit = { ...published, design_refs: [...published.design_refs, scenarioRef] };
    const inherited = selectBlueprintSkillContent(blueprint, explicit);
    assert(JSON.stringify(inherited.acceptance).includes('SIBLING-AC') && JSON.stringify(inherited.contracts).includes('src/sibling/Screen.ets')
      && JSON.stringify(inherited.useCases).includes('SIBLING-UC'), 'an explicit delivery selection inherits its complete content');
    assert.deepEqual(ownersForAddress([explicit], address), ['explicit-selection']);
  } },
  { name: 'P3 S16 raw authority FAIL binds canonical dependencies; old caches missing them recheck and restored authority invalidates the old FAIL', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, undefined, 'spec');
    const original = fs.readFileSync(f.blueprintFile);
    const doc = YAML.parse(original.toString('utf8')); doc.revision += 1;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc));
    const context = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec',
      featureSpec: new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature), phaseRule: {} } as CheckContext;
    const checks = checkAuthoritativeContentAligned(context, 'acceptance');
    assert.equal(checks[0].status, 'FAIL');
    assert(!checks[0].affected_files!.includes(f.blueprintFile) && !checks[0].affected_files!.includes(f.cuFile), 'read dependencies must never expand repair/write targets');
    const dependencies = (checks[0].structured as { source_attempt_dependencies: Array<{ path: string }> }).source_attempt_dependencies;
    assert(dependencies.some(dep => dep.path === f.blueprintFile) && dependencies.some(dep => dep.path === f.cuFile), 'a stale reference must retain both known canonical sources');
    const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'spec', f.feature, f.root, checks, frameworkRoot);
    writeRunSummaryBase(f.root, report, frameworkRoot);
    const outputs = ['summary.json', 'script-report.json'].map(name => path.join(f.root, 'doc/features/ledger-app-blueprint/ledger-refresh/spec/reports', name));
    const resolvedInputs = { context: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: [] }, phase: 'spec', values: {}, artifacts: {} };
    const options = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec' as const, resolvedInputs, extraOutputs: outputs };
    const inputs = executedEvidenceInputs(f.root, f.feature, 'spec', frameworkRoot);
    assert(inputs.includes(path.relative(f.root, f.blueprintFile).replace(/\\/g, '/')) && inputs.includes(path.relative(f.root, f.cuFile).replace(/\\/g, '/')));
    const bound = resolvePhaseEvidenceManifest({ ...options, extraInputs: inputs });
    writePhaseEvidenceManifest(f.root, bound);
    assert(readReusableCheckResult(options), 'unchanged real raw FAIL is reusable; reuse never means business PASS');
    // Reproduce the old producer's actual input set through the same manifest writer.
    writePhaseEvidenceManifest(f.root, resolvePhaseEvidenceManifest({ ...options, extraInputs: checks.flatMap(check => check.affected_files ?? []) }));
    assert.equal(readReusableCheckResult(options), null, 'a trusted old cache missing actual canonical dependencies must recheck without a cache-version flag');
    writePhaseEvidenceManifest(f.root, bound);
    fs.writeFileSync(f.blueprintFile, original);
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance').state, 'resolved');
    assert.equal(readReusableCheckResult(options), null, 'restoring actual authority must invalidate its old bound FAIL');
    assert.equal(JSON.parse(fs.readFileSync(outputs[1], 'utf8')).summary.verdict, 'FAIL', 'the old tool original must not be rewritten as PASS');
    fs.rmSync(f.blueprintFile);
    const missing = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance');
    assert.equal(missing.state, 'invalid');
    assert(missing.dependencies.some(dep => dep.path === f.blueprintFile && !dep.exists), 'a missing source is an actual dependency too');
    const missingChecks = checkAuthoritativeContentAligned(context, 'acceptance', missing);
    generateScriptReport(path.join(frameworkRoot, 'harness'), 'spec', f.feature, f.root, missingChecks, frameworkRoot);
    const missingBound = resolvePhaseEvidenceManifest({ ...options, extraInputs: executedEvidenceInputs(f.root, f.feature, 'spec', frameworkRoot) });
    assert(missingBound.inputs.some(entry => entry.path === path.relative(f.root, f.blueprintFile).replace(/\\/g, '/') && !entry.exists));
  } },
  { name: 'P2 invalid parent retains its blocker while independently checking exact-bound runtime content', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    doc.design_views[0].purpose = '';
    const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, flowRef.target))!;
    delete ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0].owner_ref;
    delete (flow.state_owner as BlueprintRecord).ref;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const projection = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projection.state, 'invalid');
    assert(projection.codes?.includes('component_blueprint_invalid'), projection.detail);
    assert(projection.codes?.includes('change_unit_runtime_owner_contract_missing'), projection.detail);
    assert(!projection.value && !projection.artifacts, '只读精确来源诊断被误当成已准入投影');
    assert.throws(() => materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot), BlueprintProjectionPreparationError);
  } },
  { name: 'P2 conflicting invalid_otp and contract versions are both reported without choosing business truth', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const first = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const second = asRecord(resolveBlueprintTarget(doc, cu.design_refs[1].target))!;
    first.acceptance = { criteria: [{ id: 'invalid_otp', expected_result: 'reject the request' }] };
    second.acceptance = { criteria: [{ id: 'invalid_otp', expected_result: 'accept the request' }] };
    second.provenance = { ...asRecord(second.provenance), evidence_strength: 'authoritative' };
    second.contracts = { version: 'contradictory-contract-version' };
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const before = fs.readFileSync(f.blueprintFile);
    const projection = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projection.state, 'invalid');
    assert(projection.detail?.includes('invalid_otp') && projection.detail?.includes('contracts.version'), projection.detail);
    assert(projection.detail?.includes('未能检查依赖该内容'), '未披露真实依赖未知');
    assert(!projection.value && !projection.artifacts, '冲突来源被任选一方投影为权威');
    assert.throws(() => materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot), BlueprintProjectionPreparationError);
    assert(fs.readFileSync(f.blueprintFile).equals(before));
  } },
  { name: 'authority diagnosis distinguishes CU mapping gaps from missing blueprint acceptance', run(f) {
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    for (const predicate of cu.target_predicates) predicate.verification_refs = [`verify:${predicate.predicate_id}`];
    fs.writeFileSync(f.cuFile, YAML.stringify(cu)); f.bind();
    const unmapped = diagnoseBlueprintSkillAuthority(f.root, frameworkRoot, f.feature, ['acceptance']);
    assert(unmapped.findings.some(row => row.codes.includes('authority_predicate_acceptance_unmapped')
      && row.artifacts.includes(path.relative(f.root, f.cuFile).replace(/\\/g, '/'))), JSON.stringify(unmapped));
    assert(!unmapped.findings.some(row => row.artifacts.includes(path.relative(f.root, f.blueprintFile).replace(/\\/g, '/'))), JSON.stringify(unmapped));
    for (const predicate of cu.target_predicates) predicate.verification_refs.push('acceptance:AC-404');
    fs.writeFileSync(f.cuFile, YAML.stringify(cu)); f.bind();
    const before = fs.readFileSync(f.blueprintFile);
    const missing = diagnoseBlueprintSkillAuthority(f.root, frameworkRoot, f.feature, ['acceptance']);
    assert(missing.findings.some(row => row.codes.includes('authority_acceptance_content_invalid')
      && row.artifacts.includes(path.relative(f.root, f.blueprintFile).replace(/\\/g, '/'))), JSON.stringify(missing));
    assert(!missing.findings.some(row => row.codes.includes('authority_predicate_acceptance_unmapped')), JSON.stringify(missing));
    assert(fs.readFileSync(f.blueprintFile).equals(before), 'diagnosis must not invent acceptance content');
  } },
  { name: 'P2 readiness collects the blocked CU, missing Phone use-case and independent runtime mapping in one production evaluation', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    ((node.acceptance as BlueprintRecord).criteria as BlueprintRecord[])[0].linked_flow = 'Phone';
    const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, flowRef.target))!;
    delete ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0].owner_ref;
    delete (flow.state_owner as BlueprintRecord).ref;
    cu.touches[0].design_ref = cu.design_refs[0];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); fs.writeFileSync(f.cuFile, YAML.stringify(cu)); f.bind();
    const before = fs.readFileSync(f.blueprintFile);
    const readiness = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint');
    const unit = readiness.perUnit.find(row => row.changeUnitId === 'ledger-refresh')!;
    assert(!readiness.ready && unit.issueIds.includes('change_unit_touch_development_owner_missing'), JSON.stringify(unit));
    assert(unit.issueIds.includes('authority_acceptance_content_invalid'), JSON.stringify(unit));
    assert(unit.issueIds.includes('change_unit_runtime_owner_contract_missing'), JSON.stringify(unit));
    assert(unit.projectionIssues.some(row => row.detail?.includes('AC-1: linked_flow/linked_branch 无法解析')), JSON.stringify(unit));
    assert.equal(((node.acceptance as BlueprintRecord).criteria as BlueprintRecord[])[0].linked_flow, 'Phone', '机器改写了缺失引用');
    assert.throws(() => materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot), BlueprintProjectionPreparationError);
    assert(fs.readFileSync(f.blueprintFile).equals(before), '汇总诊断改了canonical业务');
    assert(!fs.existsSync(resolveFeatureArtifact(f.root, f.feature, 'acceptance.yaml').actualPath), 'invalid投影写出了部分PASS产物');
  } },
  { name: 'a920e013 historical i11 flow mirrors unique authority without changing original bytes or accepting ambiguous publications', run() {
    const directory = path.join(__dirname, '../fixtures/host-recovery-history/20261115-design-recovery/owner-projection');
    const original = fs.readFileSync(path.join(directory, 'i12-runtime-flow.json'));
    const saved = JSON.parse(original.toString('utf8'));
    const ref = { ...saved.blueprint_identity, artifact_sha256: 'sha256:' + JSON.parse(fs.readFileSync(path.join(directory, 'sources.json'), 'utf8')).sources[1].sha256,
      target: { kind: 'flow', view_id: 'runtime', id: saved.flow.flow_id } } as ComponentBlueprintRef;
    const blueprint = { ...saved.blueprint_identity, design_views: [{ view_id: 'runtime', runtime_data_flows: [saved.flow] }] };
    const cu = { design_refs: [ref] } as Parameters<typeof selectBlueprintSkillContent>[1];
    const selected = selectBlueprintSkillContent(blueprint, cu);
    const state = (selected.contracts!.state_management as BlueprintRecord[])[0];
    assert.deepEqual(state.design_ref, ref);
    assert.equal(state.owner_ref, saved.flow.state_owner.ref);
    assert.deepEqual(state.contract_refs, ['contract:card-store']);
    for (const [field, id] of [['mutations', 'mutation_id'], ['publications', 'publication_id'], ['subscriptions', 'subscription_id'], ['consumers', 'consumer_id']] as const) {
      assert.deepEqual((state[field] as BlueprintRecord[]).map(row => row[id]), saved.flow[field].map((row: BlueprintRecord) => row[id]));
    }
    assert.equal((state.subscriptions as BlueprintRecord[])[0].publication_ref, 'publication:card-open-handoff');
    delete saved.flow.consumers.find((row: BlueprintRecord) => row.consumer_id === 'home-card-state').update_ref;
    const unresolved = selectBlueprintSkillContent(blueprint, cu).contracts!.state_management as BlueprintRecord[];
    assert.equal((unresolved[0].subscriptions as BlueprintRecord[])[0].publication_ref, undefined, '两个发布源不可凭唯一订阅猜选');
    assert.deepEqual(fs.readFileSync(path.join(directory, 'i12-runtime-flow.json')), original);
  } },
  { name: 'a920e013 flow projection fills only source-backed mirror fields and preserves conflicts and stale identities', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const ref = cu.design_refs.find((row: ComponentBlueprintRef) => row.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, ref.target))!;
    const state = ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0];
    state.design_ref = `view:runtime/flow:${ref.target.id}`;
    for (const key of ['owner_ref', 'contract_refs', 'mutations', 'publications', 'subscriptions', 'consumers']) delete state[key];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const resolved = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(resolved.state, 'resolved', resolved.detail);
    assert.equal((resolved.value as ContractsSpec).state_management![0].subscriptions![0].publication_ref, 'publication:ledger-changed');
    const before = fs.readFileSync(f.blueprintFile);
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    assert.deepEqual(fs.readFileSync(f.blueprintFile), before, '机器投影不回写蓝图');
    state.owner_ref = 'view:runtime/node:other-owner';
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const conflict = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(conflict.state, 'invalid'); assert(conflict.codes?.includes('authority_content_conflict'), conflict.detail);
    delete state.owner_ref;
    state.design_ref = { ...ref, artifact_sha256: 'sha256:' + '0'.repeat(64) };
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').state, 'invalid', '旧完整身份不能按 flow 名静默改签');
    const other: BlueprintRecord = { ...structuredClone(flow), flow_id: 'other-flow' }; delete other.contracts;
    doc.design_views.find((view: BlueprintRecord) => view.view_id === 'runtime').runtime_data_flows.push(other);
    const otherRef = { ...ref, target: { ...ref.target, id: 'other-flow' } };
    cu.design_refs.push(otherRef); state.design_ref = otherRef;
    assert.throws(() => selectBlueprintSkillContent(doc, cu), /跨 flow/);
  } },
  { name: 'a920e013 atomic candidate rollback retains upstream machine diagnosis while candidate mapping stays with its author', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const unit = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const flow = asRecord(resolveBlueprintTarget(doc, unit.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow').target))!;
    ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0].publications = [];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const candidate = { providerId: 'builtin-vertical-slice-decomposition', artifact: asChangeUnitArtifact(YAML.parse(fs.readFileSync(f.cuFile, 'utf8'))) };
    candidate.artifact.provenance.extraction_method += ';' + candidate.providerId;
    const mapping = structuredClone((asRecord(resolveBlueprintTarget(doc, unit.design_refs[0].target))!.contracts as BlueprintRecord).change_unit) as any;
    delete mapping.change_unit_ref;
    mapping.predicate_mappings = [];
    fs.unlinkSync(f.cuFile);
    const observation = { kind: 'decompose' as const, blueprintPath: f.blueprintFile, candidatesPath: path.join(path.dirname(f.blueprintFile), 'change-unit-candidates.json'), issues: [] };
    let rejected: ChangeUnitCandidateRejected | undefined;
    try { acceptChangeUnitCandidate(f.root, { ...candidate, construction_mapping: mapping }); }
    catch (error) { assert(error instanceof ChangeUnitCandidateRejected); rejected = error; }
    assert(rejected && rejected.designAuthority, JSON.stringify(rejected));
    assert(rejected.designAuthority.some(item => item.codes.includes('change_unit_runtime_fact_mapping_missing')), JSON.stringify(rejected));
    assert(rejected.message.includes('predicate_id'), 'the same candidate must retain its simultaneous mapping gap');
    assert(rejected.designAuthority.every(item => !item.codes.includes('change_unit_predicate_mapping_missing')), 'candidate work must not be assigned as blueprint work');
    const routed = initialDesignCandidateRejection(observation, rejected, candidate.artifact.blueprint_id);
    assert.equal(routed.kind, 'author'); assert.equal(routed.designRepair?.feature, candidate.artifact.blueprint_id);
    assert(!fs.existsSync(f.cuFile)); assert(!resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').exists, '拒绝必须保留原子回滚');
    delete ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0].publications;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc));
    const current = { revision: doc.revision, source_fingerprint: doc.source_fingerprint, artifact_sha256: sha(f.blueprintFile) };
    for (const ref of [candidate.artifact.component_blueprint_ref, ...candidate.artifact.design_refs, ...candidate.artifact.touches.map(item => item.design_ref)]) Object.assign(ref, current);
    mapping.predicate_mappings = [];
    try { acceptChangeUnitCandidate(f.root, { ...candidate, construction_mapping: mapping }); assert.fail('候选映射缺口不应接受'); }
    catch (error) {
      assert(error instanceof ChangeUnitCandidateRejected);
      assert.equal(error.designAuthority, undefined, '候选缺 mapping 不得错派蓝图作者');
      assert.equal(initialDesignCandidateRejection(observation, error, candidate.artifact.blueprint_id).kind, 'decompose');
    }
  } },
  { name: '4c8d73b1 component mapping precheck acceptance and Feature repair retain their original owners', async run(f) {
    const contracts = planContracts(f);
    const { change_unit_ref: _identity, ...mapping } = contracts.change_unit;
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
    const node = asRecord(resolveBlueprintTarget(doc, { kind: 'node', view_id: 'development', id: 'ledger-module' }))!;
    asRecord(node.provenance)!.evidence_strength = 'authoritative';
    node.contracts = { components: [{ name: 'LedgerPanel', module: 'LedgerModule', kind: 'component', file: 'src/ledger/LedgerPanel.ets' }],
      files: ['src/ledger/LedgerPanel.ets'] };
    const decision = { decision_id: 'ledger-panel-selection', kind: 'component_asset_selection', target_ref: 'view:development/node:ledger-module',
      status: 'answered_with_evidence', asset_resolution: 'custom', rationale: 'The scoped presentation has no shared implementation.',
      owner: 'component-design', verification_refs: ['planned:test/ledger/LedgerFeature.test.ets'],
      provenance: { ...asRecord(node.provenance), source_ref: 'doc/component-index.yaml' } };
    doc.decisions_and_gaps.decisions.push(decision);
    const ref: ComponentBlueprintRef = { ...cu.component_blueprint_ref, target: { kind: 'decision', id: decision.decision_id } };
    cu.design_refs.push(ref);
    mapping.design_ref_mappings.push({ design_ref: ref, implementation_refs: ['planned:src/ledger/LedgerPanel.ets#WrongPanel'],
      verification_refs: ['planned:test/ledger/LedgerFeature.test.ets'] });
    fs.writeFileSync(path.join(f.root, 'doc/component-index.yaml'), 'schema_version: "1.0"\ncomponents: []\n');
    const before = [fs.readFileSync(f.blueprintFile), fs.readFileSync(f.cuFile)];
    const candidate = () => deriveBlueprintCandidateSkillInput(f.root, f.feature, frameworkRoot, 'contracts',
      { blueprint: doc, changeUnit: cu, constructionMapping: mapping });
    const invalid = candidate();
    assert.equal(invalid.state, 'invalid');
    assert(invalid.codes?.includes('change_unit_design_mapping_incomplete') && invalid.detail?.includes('未命中 components.file#name'), invalid.detail);
    assert.equal(mapping.design_ref_mappings.at(-1)!.implementation_refs.length, 1, '诊断不得重写作者候选');
    const missingDeclaration = structuredClone(doc);
    const uiTarget = resolveBlueprintTarget(missingDeclaration, { kind: 'node', view_id: 'development', id: 'ledger-module' });
    uiTarget.kind = 'component'; delete (uiTarget.contracts as BlueprintRecord).components;
    const mixed = deriveBlueprintCandidateSkillInput(f.root, f.feature, frameworkRoot, 'contracts',
      { blueprint: missingDeclaration, changeUnit: cu, constructionMapping: mapping });
    assert(mixed.codes?.includes('change_unit_blueprint_reconciliation_required') && mixed.codes.includes('change_unit_design_mapping_incomplete'), mixed.detail);
    assert(mixed.detail?.includes('contracts.components.file/name'), 'missing blueprint declarations must identify their actual owner before guessing candidate symbols');
    mapping.design_ref_mappings.at(-1)!.implementation_refs = ['planned:src/ledger/LedgerPanel.ets#LedgerPanel'];
    const valid = candidate();
    assert(!valid.codes?.includes('change_unit_design_mapping_incomplete'), valid.detail);
    assert.deepEqual([fs.readFileSync(f.blueprintFile), fs.readFileSync(f.cuFile)], before, '候选预检不得发布或重签canonical');

    // Formal Feature mapping drift belongs to the Feature writer, even when its design is already published.
    const { refreshBlueprintFingerprints, writeBackAdmission } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
    doc.providers.find((provider: any) => provider.provider_id === 'component-assets').available = true;
    refreshBlueprintFingerprints(doc); writeBackAdmission(doc, { projectRoot: f.root, canonicalPath: f.blueprintFile });
    for (const pointer of [cu.component_blueprint_ref, ...cu.design_refs, ...cu.touches.map(touch => touch.design_ref)]) pointer.source_fingerprint = doc.source_fingerprint;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); fs.writeFileSync(f.cuFile, YAML.stringify(cu)); f.bind();
    const published = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
    for (const row of mapping.design_ref_mappings) row.design_ref = published.design_refs.find(ref => JSON.stringify(ref.target) === JSON.stringify(row.design_ref.target))!;
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, undefined, undefined, mapping);
    const file = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath;
    const authored = YAML.parse(fs.readFileSync(file, 'utf8'));
    authored.change_unit.design_ref_mappings.find((row: any) => row.design_ref.target.id === decision.decision_id).implementation_refs = ['planned:src/ledger/LedgerPanel.ets#WrongPanel'];
    fs.writeFileSync(file, YAML.stringify(authored));
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'resolved', projected.detail);
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot), parsed = loader.loadFeatureSpec(f.feature);
    const checks = await checkPlan.check({ projectRoot: f.root, frameworkRoot, frameworkRel: '', harnessRoot: path.join(frameworkRoot, 'harness'),
      feature: f.feature, phase: 'plan', featureSpec: parsed, phaseRule: loader.loadPhaseRule('plan'),
      resolvedProfile: loadResolvedProfile(f.root, loadFrameworkConfig(f.root), frameworkRoot),
      resolvedInputs: { phase: 'plan', values: {}, artifacts: { 'contracts@1': parsed.contracts, 'acceptance@1': parsed.acceptance, 'use-cases@1': parsed.useCases },
        context: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } } } as CheckContext);
    assert(checks.some(check => check.id === 'component_asset_projection' && check.status === 'FAIL' && check.repair_owner !== 'external'), JSON.stringify(checks));
    assert(!checks.some(check => check.id === 'authoritative_content_aligned' && check.repair_owner === 'external'), JSON.stringify(checks));

    // A new decomposition's authored bad landing goes back to that candidate, without publishing either artifact.
    fs.unlinkSync(file); fs.unlinkSync(f.cuFile);
    mapping.design_ref_mappings.find(row => row.design_ref.target.id === decision.decision_id)!.implementation_refs = ['planned:src/ledger/LedgerPanel.ets#WrongPanel'];
    const proposal = { providerId: 'builtin-vertical-slice-decomposition', artifact: published, construction_mapping: mapping };
    proposal.artifact.provenance.extraction_method += ';' + proposal.providerId;
    let rejected: ChangeUnitCandidateRejected | undefined;
    try { acceptChangeUnitCandidate(f.root, proposal); } catch (error) { assert(error instanceof ChangeUnitCandidateRejected); rejected = error; }
    assert(rejected && !rejected.designAuthority, JSON.stringify(rejected));
    assert.equal(initialDesignCandidateRejection({ kind: 'decompose', blueprintPath: f.blueprintFile,
      candidatesPath: path.join(path.dirname(f.blueprintFile), 'change-unit-candidates.json'), issues: [] }, rejected, published.blueprint_id).kind, 'decompose');
    assert(!fs.existsSync(f.cuFile) && !fs.existsSync(file), '拒绝候选不得留下已物化产物');
  } },
  { name: 'P2 exact known flow relation projects mechanically regardless of record location; ambiguity stays unresolved', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, flowRef.target))!;
    (node.contracts as BlueprintRecord).state_management = (flow.contracts as BlueprintRecord).state_management;
    delete flow.contracts;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'resolved', projected.detail);
    assert.deepEqual((projected.value as ContractsSpec).state_management![0].design_ref?.target, flowRef.target);
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const saved = YAML.parse(fs.readFileSync(resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath, 'utf8'));
    assert.deepEqual(saved.state_management[0].design_ref.target, flowRef.target, '原writer未落盘机械映射');
    const second = structuredClone(flow); second.flow_id = 'ambiguous-flow';
    const runtime = doc.design_views.find((view: BlueprintRecord) => view.view_id === 'runtime'); runtime.runtime_data_flows.push(second);
    cu.design_refs.push({ ...flowRef, target: { ...flowRef.target, id: 'ambiguous-flow' } });
    const merged = selectBlueprintSkillContent(doc, cu);
    assert.equal((merged.contracts!.state_management as BlueprintRecord[])[0].design_ref, undefined, '共享owner的含糊关系被机器猜定');
  } },
  { name: 'P2 scope arguments use original request and current required obligations through the sole candidate writer', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const cu = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
    const request = { projectRoot: f.root, frameworkRoot, changeUnit: cu, requirement: 'Refresh the ledger using the approved design', requestedResults: ['refreshed ledger'], requestedPhases: ['coding'] };
    const first = prepareFeatureScopeCandidate(prepareChangeUnitScopeInput(request));
    const args = prepareChangeUnitScopeInput({ ...request, obligations: first.scope.obligations, overwrite: true });
    assert.equal(args.feature, f.feature);
    assert.equal(args.requirement, request.requirement);
    assert.equal(args.impact, undefined, '未知impact被默认填假');
    assert.deepEqual(args.requestedResults, request.requestedResults);
    assert(args.requestedPhases.includes('coding'));
    const empty = prepareChangeUnitScopeInput({ ...request, requestedPhases: [], obligations: [] });
    assert.deepEqual(empty.requestedPhases, [], '授权域或默认全阶段被冒充请求动作');
    assert.throws(() => prepareFeatureScopeCandidate(empty), /requested-phases/);
    const next = prepareFeatureScopeCandidate(args);
    assert(next.candidate.request.requirement_basis, '未走原哈希绑定链');
    assert.deepEqual(next.candidate.request.requested_phases, args.requestedPhases);
    assert.equal(prepareFeatureScopeCandidate(args).state, 'unchanged', '同参数重复准备不幂等');
  } },
  { name: 'f3b8e6a1 authority preparation: invalid canonical construction reaches the design diagnosis without a scope', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, flowRef.target))!;
    delete ((flow.contracts as BlueprintRecord).state_management as BlueprintRecord[])[0].owner_ref;
    delete (flow.state_owner as BlueprintRecord).ref;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'invalid', projected.detail);
    const diagnosis = diagnoseDesignAuthority(f.root, frameworkRoot, f.feature, 'plan');
    assert(!diagnosis.unevaluable, diagnosis.unevaluable);
    assert(diagnosis.findings.some(item => item.codes.includes('change_unit_runtime_owner_contract_missing')));
    assert(diagnosis.findings.some(item => item.artifacts.includes(path.relative(f.root, f.blueprintFile).split(path.sep).join('/'))));
    assert(!fs.existsSync(resolveFeatureArtifact(f.root, f.feature, 'execution-scope.json').actualPath));
  } },
  { name: 'f3b8e6a1 authority preparation: genuinely absent content remains downstream preparation', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    delete node.acceptance;
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance').state, 'absent');
    assert.deepEqual(diagnoseBlueprintSkillAuthority(f.root, frameworkRoot, f.feature, ['acceptance']).findings, []);
  } },
  { name: 'f3b8e6a1 authority preparation: hand-written Feature drift does not become a canonical design defect', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const file = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath;
    const contracts = YAML.parse(fs.readFileSync(file, 'utf8'));
    contracts.version = 'incorrect-feature-mapping';
    fs.writeFileSync(file, YAML.stringify(contracts));
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').state, 'resolved');
    assert.deepEqual(diagnoseBlueprintSkillAuthority(f.root, frameworkRoot, f.feature).findings, []);
    const checks = checkAuthoritativeContentAligned({ projectRoot: f.root, frameworkRoot, feature: f.feature,
      featureSpec: { contracts } } as CheckContext, 'contracts');
    assert(checks.some(check => check.status === 'FAIL'));
    assert(!checks.some(check => check.repair_owner === 'external'));
    const producer = checks.find(check => check.status === 'FAIL')!;
    const facts = (producer.structured as { authoritative_content_drift: { artifact: string; items: Array<{ id: string; field: string }> } }).authoritative_content_drift;
    assert.equal(facts.artifact, 'contracts');
    assert(facts.items.length > 0 && facts.items.every(item => producer.details.includes(item.id)), '结构化事实必须保留同一次检查的完整字段差额与原诊断');
    assert.deepEqual(producer.affected_files, [file]);
  } },
  { name: '1804 independent projection CLI scopes spec and plan; invalid phases write nothing', run(f) {
    for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(resolveFeatureArtifact(f.root, f.feature, name).actualPath, { force: true });
    const invoke = (phaseArgs: string[]) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'),
      '--project', path.join(frameworkRoot, 'harness/tsconfig.json'), path.join(frameworkRoot, 'harness/scripts/prepare-blueprint-design.ts'),
      '--feature', f.feature, '--project-root', f.root, '--framework-root', frameworkRoot, ...phaseArgs],
      { cwd: f.root, encoding: 'utf8', timeout: 60000 });
    const files = (dir = f.root): Array<[string, string, number]> => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : [[path.relative(f.root, file), sha(file), fs.statSync(file).mtimeMs]] as Array<[string, string, number]>;
    });
    const before = files();
    for (const args of [['--phase', 'coding'], ['--phase'], ['--phase', 'spec', '--phase', 'plan']]) {
      const rejected = invoke(args);
      assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
      assert(rejected.stderr.includes('--phase must be spec or plan'), rejected.stderr);
      assert.deepEqual(files(), before, 'invalid phase must fail before any materialization');
    }
    const spec = invoke(['--phase', 'spec']);
    assert.equal(spec.status, 0, spec.stderr + spec.stdout);
    assert.deepEqual(JSON.parse(spec.stdout).written.map((file: string) => path.basename(file)), ['acceptance.yaml']);
    assert(!resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').exists);
    assert(!resolveFeatureArtifact(f.root, f.feature, 'use-cases.yaml').exists);
    const acceptance = resolveFeatureArtifact(f.root, f.feature, 'acceptance.yaml').actualPath;
    fs.appendFileSync(acceptance, '\nauthor_notes: retained by plan export\n');
    const preserved = fs.readFileSync(acceptance);
    const plan = invoke(['--phase', 'plan']);
    assert.equal(plan.status, 0, plan.stderr + plan.stdout);
    assert.deepEqual(JSON.parse(plan.stdout).written.map((file: string) => path.basename(file)).sort(), ['contracts.yaml', 'use-cases.yaml']);
    assert(fs.readFileSync(acceptance).equals(preserved), 'plan export must not rewrite spec output');
  } },
  { name: '7d9c2e41 staged preparation writes only the responsible outputs and preserves increments', run(f) {
    for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(resolveFeatureArtifact(f.root, f.feature, name).actualPath, { force: true });
    let invocation = 0;
    const prepare = (phase: 'spec' | 'plan'): string[] => {
      const started = performance.now(), cpu = process.cpuUsage();
      const files = materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, undefined, phase);
      console.log('[projection-preparation-measure]', JSON.stringify({ fixture: 'blueprint-design-inputs', invocation: ++invocation, phase,
        wallMs: performance.now() - started, cpu: process.cpuUsage(cpu), writtenFiles: files.map(file => path.basename(file)) }));
      return files;
    };
    const prepared = prepare('spec');
    assert.deepEqual(prepared.map(file => path.basename(file)), ['acceptance.yaml']);
    assert(!resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').exists);
    assert(!resolveFeatureArtifact(f.root, f.feature, 'use-cases.yaml').exists);
    assert.deepEqual(prepare('spec'), []);
    const acceptance = resolveFeatureArtifact(f.root, f.feature, 'acceptance.yaml').actualPath;
    const original = fs.readFileSync(acceptance, 'utf8');
    fs.appendFileSync(acceptance, '\nauthor_notes: keep me\n');
    assert.deepEqual(prepare('spec'), []);
    assert(fs.readFileSync(acceptance, 'utf8').endsWith('author_notes: keep me\n'));
    const plan = prepare('plan');
    assert.deepEqual(plan.map(file => path.basename(file)).sort(), ['contracts.yaml', 'use-cases.yaml']);
    assert.equal(fs.readFileSync(acceptance, 'utf8'), original + '\nauthor_notes: keep me\n');
    assert.deepEqual(prepare('plan'), []);
  } },
  { name: '7d9c2e41 preparation conflict preserves original bytes and identifies the producer', run(f) {
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const file = resolveFeatureArtifact(f.root, f.feature, 'acceptance.yaml').actualPath;
    const altered = YAML.parse(fs.readFileSync(file, 'utf8')); altered.criteria[0].expected_result = 'conflicting requirement';
    fs.writeFileSync(file, YAML.stringify(altered));
    const before = fs.readFileSync(file);
    assert.throws(() => materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot, undefined, 'spec'),
      error => error instanceof BlueprintProjectionPreparationError && error.owner === 'spec' && error.reason === 'conflict');
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(materializeBlueprintSkillInputs(f.root, 'ordinary-feature', frameworkRoot, undefined, 'spec'), []);
  } },
  { name: '8a6d3f21 references and predicted file expansion do not request design permission', run(f) {
    const original = planContracts(f);
    const context = (contracts: ContractsSpec) => ({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featureSpec: { contracts, useCases: deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').artifacts?.['use-cases@1'] }, phaseRule: {} } as CheckContext);
    const actual = structuredClone(original);
    actual.files = [];
    assert.equal(checkContractFileReferenceClosure(context(actual))[0].status, 'PASS');
    actual.files.push('src/ledger/ExtraService.ets');
    const checks = checkAuthoritativeContentAligned(context(actual), 'contracts');
    assert(!checks.some(check => check.status === 'FAIL'), JSON.stringify(checks));
    assert.equal(designOwnerBlockers(buildSummaryBlockers(checks, (value, max) => value.slice(0, max), () => undefined)).length, 0);
  } },
  { name: '28e31f53 shared projection rejects existing case mismatch and accepts author-corrected binding', run(f) {
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').state, 'resolved', 'planned output need not exist');
    const actual = 'src/ledger/ledgerFeature.ets'; fs.writeFileSync(path.join(f.root, actual), 'export class LedgerFeature {}');
    const invalid = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(invalid.state, 'invalid'); assert(invalid.detail?.includes('LedgerFeature.ets') && invalid.detail?.includes('ledgerFeature.ets'));
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const contract = node.contracts as ContractsSpec;
    contract.files = contract.files.map(file => file === 'src/ledger/LedgerFeature.ets' ? actual : file);
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').state, 'resolved');
  } },
  { name: 'content rules: shared own defects retain original BLOCKER wrappers and cross-entry obligations', run(f) {
    const read = (name: string) => YAML.parse(fs.readFileSync(path.join(__dirname, '../fixtures/blueprint-design-inputs', `${name}.yaml`), 'utf8'));
    const acceptance = read('acceptance'); const contracts = read('contracts'); const useCases = read('use-cases');
    contracts.interfaces = [{ class: 'LedgerFeature', file: 'src/ledger/LedgerFeature.ets', methods: [{ name: 'run', return: 'void', params: [] }] }];
    const ctx = { featureSpec: { acceptance, contracts, useCases }, projectRoot: f.root, feature: f.feature, frameworkRoot, phaseRule: {} } as CheckContext;
    const before = JSON.stringify(ctx.featureSpec);
    const check = (result: ReturnType<typeof checkAcceptanceContent>[number], id: string, status: string) => {
      assert.equal(result.id, id); assert.equal(result.category, 'structure'); assert.equal(result.severity, 'BLOCKER'); assert.equal(result.status, status);
    };
    check(checkAcceptanceContent(ctx)[0]!, 'acceptance_content_complete', 'PASS');
    check(checkTypedConstructionContent(ctx)[0]!, 'construction_content_complete', 'PASS');
    check(checkUseCaseSpecSchema(ctx)[0]!, 'usecase_spec_schema', 'PASS');
    assert.equal(JSON.stringify(ctx.featureSpec), before, 'shared checks mutate their input');
    delete acceptance.criteria[0].expected_result;
    contracts.interfaces[0].methods[0].return = 'any';
    delete useCases.use_cases[0].coordinator;
    for (const [result, id, problems] of [
      [checkAcceptanceContent(ctx)[0]!, 'acceptance_content_complete', inspectAcceptanceItem(acceptance.criteria[0], true, 'criteria[0]')],
      [checkTypedConstructionContent(ctx)[0]!, 'construction_content_complete', inspectTypedConstructionContent(contracts)],
      [checkUseCaseSpecSchema(ctx)[0]!, 'usecase_spec_schema', inspectUseCaseItem(useCases.use_cases[0], 'use_cases[0]')],
    ] as const) {
      check(result, id, 'FAIL'); assert(problems.length > 0);
      for (const problem of problems) assert(result.details?.includes(problem.message), `${id}未消费共用判断`);
    }
    Object.assign(acceptance.criteria[0], read('acceptance').criteria[0]);
    acceptance.criteria.push(structuredClone(acceptance.criteria[0]));
    assert(checkAcceptanceContent(ctx)[0]!.details?.includes('验收 ID 非法或重复'), '原跨条目ID约束丢失');
    ctx.featureSpec.acceptance = { criteria: [], boundaries: [] } as unknown as CheckContext['featureSpec']['acceptance'];
    check(checkAcceptanceContent(ctx)[0]!, 'acceptance_content_complete', 'FAIL');
    contracts.files = [];
    check(checkTypedConstructionContent(ctx)[0]!, 'construction_content_complete', 'FAIL');
    delete useCases.schema_version;
    assert(checkUseCaseSpecSchema(ctx)[0]!.details?.includes('schema_version'), '元数据检查从原消费入口移除');
  } },
  { name: 'content rules: noniterable fields and methods retain uncoded consumer exceptions while blueprint warns', run(f) {
    for (const kind of ['fields', 'methods'] as const) {
      const contracts = kind === 'fields'
        ? { files: ['src/model.ts'], data_models: [{ name: 'Model', file: 'src/model.ts', kind: 'interface', fields: { malformed: true } }] }
        : { files: ['src/api.ts'], interfaces: [{ class: 'Api', file: 'src/api.ts', methods: { malformed: true } }] };
      const before = JSON.stringify(contracts);
      const issues = inspectTypedConstructionContent(contracts);
      const expression = kind === 'fields' ? 'model.fields' : 'api.methods';
      assert(issues.some(issue => issue.path.endsWith(`.${kind}`) && issue.consumerError === `(${expression} ?? []) is not iterable`));
      const ctx = { featureSpec: { contracts }, projectRoot: f.root, feature: f.feature } as unknown as CheckContext;
      assert.throws(() => checkTypedConstructionContent(ctx), { name: 'TypeError', message: `(${expression} ?? []) is not iterable` });
      const bp: BlueprintRecord = { blueprint_id: 'malformed', design_views: [{ view_id: 'development', nodes: [{ node_id: 'model', contracts }] }] };
      const warnings = diagnoseBlueprintContent(bp);
      assert(warnings.some(issue => issue.path.endsWith(`.${kind}`) && issue.severity === 'WARN' && issue.message.includes('应为数组')));
      assert.equal(JSON.stringify(contracts), before);
    }
  } },
  { name: 'content rules: nested nulls produce shared shape diagnostics and repairable projection failures with blueprint WARN', run(f) {
    const original = fs.readFileSync(f.blueprintFile, 'utf8');
    const unit = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    for (const variant of ['field', 'method', 'parameter', 'performance'] as const) {
      const bp = YAML.parse(original);
      const node = asRecord(resolveBlueprintTarget(bp, unit.design_refs[0].target))!;
      const contracts = node.contracts as Record<string, any>;
      const acceptance = node.acceptance as Record<string, any>;
      let pointer: string;
      if (variant === 'field') {
        contracts.data_models = [{ name: 'Model', file: 'src/ledger/LedgerFeature.ets', kind: 'interface', fields: [null] }]; pointer = 'data_models[0].fields[0]';
      } else if (variant === 'method') {
        contracts.interfaces = [{ class: 'LedgerFeature', file: 'src/ledger/LedgerFeature.ets', methods: [null] }]; pointer = 'interfaces[0].methods[0]';
      } else if (variant === 'parameter') {
        contracts.interfaces = [{ class: 'LedgerFeature', file: 'src/ledger/LedgerFeature.ets', methods: [{ name: 'run', return: 'void', params: [null] }] }]; pointer = 'interfaces[0].methods[0]';
      } else { acceptance.performance = [null]; pointer = 'performance[0]'; }
      const kind = variant === 'performance' ? 'acceptance' : 'contracts';
      const inputs = { context: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: [] }, phase: '', values: {}, artifacts: { 'contracts@1': contracts, 'acceptance@1': acceptance } };
      const beforeInputs = JSON.stringify(inputs.artifacts);
      const parsed = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, inputs);
      assert(parsed.shape_issues?.some(issue => issue.includes(pointer)), `${variant}未在真实loader输出具体shape问题：${JSON.stringify(parsed.shape_issues)}`);
      assert.equal(JSON.stringify(inputs.artifacts), beforeInputs, 'loader不得原地改写输入片段');
      fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
      const before = fs.readFileSync(f.blueprintFile);
      const warnings = diagnoseBlueprintContent(bp);
      assert(warnings.some(issue => issue.path.endsWith(pointer) && issue.severity === 'WARN'), `${variant}蓝图诊断崩溃或漏报`);
      const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, kind);
      assert.equal(projected.state, 'invalid'); assert(projected.codes?.includes('authority_projection_shape_invalid'));
      assert(projected.detail?.includes(pointer), `${variant}派生丢失字段路径：${projected.detail}`);
      const readiness = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint');
      const readyUnit = readiness.perUnit.find(item => item.changeUnitId === 'ledger-refresh')!;
      assert(!readiness.ready && readyUnit.verdict === 'blocked');
      assert(readyUnit.projectionIssues.some(issue => issue.kind === kind && issue.codes?.includes('authority_projection_shape_invalid') && issue.detail === projected.detail));
      assert(fs.readFileSync(f.blueprintFile).equals(before), '诊断/derive改写了原canonical');
    }
    // 列表中后续的 null 也须进入共享形状诊断，不依赖下游 some 的短路次序。
    for (const method of [{ return: 'void', params: [null] }, { name: 'run', return: 'void', params: [{}, null] }]) {
      const contracts = { files: ['src/ledger/LedgerFeature.ets'], interfaces: [{ class: 'LedgerFeature', file: 'src/ledger/LedgerFeature.ets', methods: [method] }] };
      const parsed = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature,
        { context: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] }, phase: '', values: {}, artifacts: { 'contracts@1': contracts } });
      assert(parsed.shape_issues?.some(issue => issue.includes('params')), '嵌套null不应变成下游TypeError或被静默清掉');
    }
  } },
  { name: 'content rules: state shape WARN and original loader normalization agree and never mutate authority', run(f) {
    const contracts = { files: [], state_management: [{ ordered_steps: [1, 'valid'], lifecycle_triggers: {}, mutations: {}, consumers: [null, { consumer_id: 'ok' }] }] };
    const before = JSON.stringify(contracts);
    const inputs = { context: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: [] }, phase: '', values: {}, artifacts: { 'contracts@1': contracts } };
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, inputs);
    assert.equal(JSON.stringify(contracts), before, 'loader修改了原权威片段');
    for (const key of ['ordered_steps', 'lifecycle_triggers', 'mutations', 'consumers']) assert(spec.shape_issues?.some(issue => issue.includes(key)), `原loader丢失${key}问题`);
    const state = spec.contracts!.state_management![0]!;
    assert.deepStrictEqual(state.ordered_steps, ['valid']);
    assert.deepStrictEqual(state.lifecycle_triggers, []); assert.deepStrictEqual(state.mutations, []);
    assert.deepStrictEqual(state.consumers, [{ consumer_id: 'ok' }]);
    const bp: BlueprintRecord = { blueprint_id: 'shape', design_views: [{ view_id: 'runtime', runtime_data_flows: [{ flow_id: 'flow', contracts }] }] };
    const issues = diagnoseBlueprintContent(bp);
    for (const key of ['ordered_steps[0]', 'lifecycle_triggers', 'mutations', 'consumers[0]']) assert(issues.some(issue => issue.path.endsWith(key)), `蓝图未定位${key}`);
    assert.equal(JSON.stringify(contracts), before, 'WARN修改了原权威片段');
  } },
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
      const contractsFile = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').canonicalPath;
      fs.mkdirSync(path.dirname(contractsFile), { recursive: true }); fs.writeFileSync(contractsFile, YAML.stringify(planContracts(f)));
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
    assert(!checkChangeUnitFeatureProjection({ projectRoot: f.root, frameworkRoot, feature: f.feature, featureSpec: spec, phaseRule: {} } as CheckContext, 'coding').some(check => check.status === 'FAIL'), 'private implementation location alone is not proof of a missing behavior');
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
    const repositoryFramework = path.resolve(__dirname, '../../..');
    const frameworkRoot = localFramework;
    fs.mkdirSync(path.join(localFramework, 'workflows'), { recursive: true }); fs.writeFileSync(path.join(localFramework, 'workflows/p3-scoped.workflow.yaml'), YAML.stringify(workflow));
    // The revision budget re-resolves bindings through P1, which reads the artifact inventory from
    // the framework root it is given — so this stub framework must expose the real specs/ too,
    // otherwise it is a framework root that cannot resolve any artifact.
    for (const dir of ['specs', 'skills', 'profiles', 'harness', 'agents', 'docs', 'templates']) fs.symlinkSync(path.join(repositoryFramework, dir), path.join(localFramework, dir), process.platform === 'win32' ? 'junction' : 'dir');
    fs.cpSync(path.join(repositoryFramework, 'workflows'), path.join(localFramework, 'workflows'), { recursive: true });
    fs.copyFileSync(path.join(repositoryFramework, 'package.json'), path.join(localFramework, 'package.json'));
    const configFile = path.join(f.root, 'framework.config.json');
    const config = { schema_version: '1.1', project_name: 'P3 design fixture', project_profile: { name: 'generic' }, paths: { features_dir: 'doc/features' }, active_workflow: 'p3-scoped' }; fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    // D0.1: a Feature-target scope needs the sourced impact before device verification can be
    // pruned; resolved facts are the pure function's own input type (no forged production artifact).
    // The blueprint fixture declares no contracts.files, so the write set comes from the
    // implementation duty's own source binding (D0.1 rule (a): an implementation duty must name a
    // verifiable write set). Both bindings come from the production resolver.
    const srcRel = 'src/ledger/LedgerFeature.ets';
    fs.mkdirSync(path.dirname(path.join(f.root, srcRel)), { recursive: true });
    fs.writeFileSync(path.join(f.root, srcRel), 'export const demo = 1;\n');
    const contractsProbe = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full', testTargets: [srcRel],
      inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } });
    const codebaseValue = contractsProbe.inputs?.values?.codebase;
    assert(codebaseValue && codebaseValue.state === 'resolved', 'plan codebase unresolved: ' + JSON.stringify(codebaseValue));
    const implementationSource = codebaseValue.binding;
    const originalContracts = contractsProbe.inputs?.values?.contracts;
    assert(originalContracts?.state === 'resolved');
    // The impact judgement is sourced on the very file the implementation duty names (an empty
    // basis is rejected: a claim with no source must never prune a duty). The reading layer's
    // verdict for it is supplied directly — resolved facts are the pure function's own input type.
    const resolvedStub: ResolvedScopeFacts = { fidelity: { state: 'missing', visual_requested: false },
      impact_basis: [{ input_id: implementationSource.input_id, ok: true, related: true, detail: 'fixture reading-layer verdict' }],
      basis: [], satisfied_by: [], targets: { implementation_files: [srcRel], contracts_files: [], review_targets: [], ut_targets: [] }, impact_targets_available: true };
    const impact = { user_visible_behavior_change: false, reason: 'fixture: unit verification only', basis: [implementationSource] };
    const scope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['spec'], impact }, facts: [
      { id: 'acceptance:pending', kind: 'acceptance-context', applicability: 'unknown', reason: 'spec must establish acceptance', basis: [] },
      { id: 'design:known', kind: 'design-context', applicability: 'required', reason: 'approved derived contracts', basis: [originalContracts.binding], satisfied_by: [originalContracts.binding] },
      // D0.1 rule (a): the implementation duty names its write set through `implementationSource`
      // below; the blueprint fixture declares no contracts.files, so that binding IS the target set.
      { id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: 'requested implementation', basis: [implementationSource] },
    ], contract_fingerprints: [] }, workflow, undefined, resolvedStub);
    const manifest = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-design', unattended: { write_mode: 'full-access', approval_mode: 'never' }, requirement: 'deliver ledger refresh', execution_scope: scope, chain_override: scope.phase_chain }, { projectRoot: f.root });
    const born = createGoalRun({ frameworkRoot: frameworkRoot, projectRoot: f.root, manifest, chain: scope.phase_chain });
    const before = fs.readFileSync(born.manifestPath, 'utf8');
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', featuresDir: 'doc/features', goalRunId: manifest.run_id });
    const inputs = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', track: 'full', ...bridge }).inputs!;
    const featureSpec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, inputs);
    const ctx = { projectRoot: f.root, frameworkRoot: localFramework, feature: f.feature, phase: 'spec', featureSpec, resolvedInputs: inputs, factsContext: bridge.factsContext } as CheckContext;
    const checks = designScopeRevisionChecks(ctx, []);
    assert.equal(checks.length, 1); assert(checks[0].scope_revision_input);
    const binding = inputs.values.acceptance; assert.equal(binding.state, 'resolved');
    if (binding.state !== 'resolved') return;
    const next = resolveExecutionScope(checks[0].scope_revision_input!, workflow, readScopeAcceptance(f.root, checks[0].scope_revision_input!, { feature: f.feature, frameworkRoot }), resolvedStub);
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
    const physicalNext = resolveExecutionScope(physicalChecks[0].scope_revision_input!, workflow, readScopeAcceptance(f.root, physicalChecks[0].scope_revision_input!, { feature: f.feature, frameworkRoot }), resolvedStub);
    assert.deepStrictEqual(physicalNext.phase_chain.filter(phase => phase !== 'plan'), next.phase_chain.filter(phase => phase !== 'plan'));
    assert(physicalNext.phase_chain.includes('plan'), '等价物化后的旧来源证明失效，原plan责任须重核');
    const otherDefinition = physicalChecks[0].scope_revision_input!.facts.find(fact => fact.kind === 'design-context')!;
    assert(!otherDefinition.satisfied_by?.length && otherDefinition.applicability === 'required');
    readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' }, otherDefinition.basis[0]);
    assert.throws(() => readBoundInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' }, originalContracts.binding), /stale/, '冻结绑定不能因新提案而放宽');
    assert.deepStrictEqual(scope.obligations.find(obligation => obligation.kind === 'design-context')!.satisfied_by, [originalContracts.binding], '旧冻结证明保持原件');
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
    // Same D0.1 requirements as the spec-phase branch: sourced impact + resolved facts, and an
    // implementation duty that names its write set.
    const planScope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['plan'], impact }, facts: [
      { id: 'design:pending', kind: 'design-context', applicability: 'unknown', reason: 'plan must establish construction', basis: [] },
      { id: 'acceptance:known', kind: 'acceptance-context', applicability: 'required', reason: 'approved acceptance', basis: [acceptanceInput.binding], satisfied_by: [acceptanceInput.binding] },
      { id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: 'requested implementation', basis: [implementationSource] },
    ], contract_fingerprints: [] }, workflow, { value: physicalCtx.featureSpec.acceptance!, binding: acceptanceInput.binding }, resolvedStub);
    const planRun = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-plan-design', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: planScope, chain_override: planScope.phase_chain }, { projectRoot: f.root });
    createGoalRun({ frameworkRoot: frameworkRoot, projectRoot: f.root, manifest: planRun, chain: planScope.phase_chain });
    const planBridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', featuresDir: 'doc/features', goalRunId: planRun.run_id });
    const planInputs = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', track: 'full', ...planBridge }).inputs!;
    for (const required_outputs of [[], ['plan/plan.md']]) {
      const planCtx = { ...ctx, phase: 'plan', factsContext: planBridge.factsContext, featureSpec: new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature, planInputs), resolvedInputs: { ...planInputs, context: { ...planInputs.context, required_outputs } } } as CheckContext;
      const proposal = designScopeRevisionChecks(planCtx, [{ id: 'design_pass', status: 'PASS', severity: 'MINOR', category: 'structure', description: 'validated design', details: 'passed' }])[0].scope_revision_input!;
      assert(proposal);
      const nextPlan = resolveExecutionScope(proposal, workflow, readScopeAcceptance(f.root, proposal, { feature: f.feature, frameworkRoot }), resolvedStub);
      assert(!nextPlan.unresolved.length && nextPlan.phase_chain.includes('coding'));
      assert.deepStrictEqual(designScopeRevisionChecks(planCtx, [{ id: 'design_fail', status: 'FAIL', severity: 'BLOCKER', category: 'structure', description: 'invalid design', details: 'failed' }]), []);
      // plan f7045213 第二批：已登记为披露的探索账本失败不挡设计事实发布；其余任何 FAIL（含 MAJOR）仍挡。
      const ledgerFail = { id: 'context_exploration_searches_min', status: 'FAIL' as const, severity: 'BLOCKER' as const, category: 'structure' as const, description: 'self-reported searches', details: '当前 1，要求 ≥ 4' };
      assert(designScopeRevisionChecks(planCtx, [ledgerFail])[0]?.scope_revision_input, '披露类账本失败不应挡住修订提议');
      assert.deepStrictEqual(designScopeRevisionChecks(planCtx, [ledgerFail, { id: 'design_major', status: 'FAIL', severity: 'MAJOR', category: 'structure', description: 'major', details: 'major' }]), [], '其余 FAIL 保持原判据');
    }
    assert.equal(fs.readFileSync(born.manifestPath, 'utf8'), before);
    assert.deepStrictEqual(designScopeRevisionChecks(ctx, [{ id: 'actual_failure', category: 'structure', severity: 'BLOCKER', status: 'FAIL', description: 'failure', details: 'failure' }]), []);
    const requestScope = resolveExecutionScope({ request: { completion_target: 'request', requested_results: ['design'], requested_phases: ['spec'] }, facts: [], contract_fingerprints: [] }, workflow);
    const requestRun = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-design-only', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: requestScope, chain_override: requestScope.phase_chain }, { projectRoot: f.root });
    createGoalRun({ frameworkRoot: frameworkRoot, projectRoot: f.root, manifest: requestRun, chain: requestScope.phase_chain });
    // plan a9f3c7d2 第二笔（R5）**行为变更**：request 终点原先在这里被整个排除（断言恒 `[]`），
    // 于是单职责 spec/plan 出生时的定义缺口永远关不掉、生产上到不了成功终局。现在它也发提案，
    // 但请求动作**只能是本阶段自己**——单职责请求结构上不得借修订新增阶段。
    const requestProposal = designScopeRevisionChecks({ ...ctx, factsContext: { ...bridge.factsContext!, subject: { feature: f.feature, run_id: requestRun.run_id } } }, []);
    assert.equal(requestProposal.length, 1, JSON.stringify(requestProposal));
    const requestInput = requestProposal[0].scope_revision_input!;
    assert.equal(requestInput.request.completion_target, 'request');
    assert.deepStrictEqual(requestInput.request.requested_phases, ['spec'], JSON.stringify(requestInput.request.requested_phases));
    const requestNext = resolveExecutionScope(requestInput, workflow, readScopeAcceptance(f.root, requestInput, { feature: f.feature, frameworkRoot }), resolvedStub);
    assert.deepStrictEqual(requestNext.unresolved, [], JSON.stringify(requestNext.unresolved));
    assert(requestNext.phase_chain.every(phase => requestScope.phase_chain.includes(phase)), JSON.stringify(requestNext.phase_chain));
    // The device duty has to be *genuinely* required for this case to mean anything: D0.1 no longer
    // trusts a self-declared `required`, so it is derived from a device-layer acceptance here.
    const deviceAcceptance = { criteria: [{ id: 'AC-DEVICE', priority: 'P1', ut_layer: 'device', device_focus: 'on-device check' }] } as import('../../scripts/utils/types').AcceptanceSpec;
    const protectedScope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['spec'] }, facts: [
      { id: 'acceptance:pending', kind: 'acceptance-context', applicability: 'unknown', reason: 'spec must establish acceptance', basis: [] },
    ], contract_fingerprints: [] }, workflow, { value: deviceAcceptance, binding: acceptanceInput.binding }, resolvedStub);
    assert.equal(protectedScope.obligations.find(o => o.kind === 'device-evidence')?.applicability, 'required', 'device duty must be genuinely required');
    const protectedRun = buildGoalManifestFromInput({ feature: f.feature, run_id: 'p3-keep-verification', unattended: { write_mode: 'full-access', approval_mode: 'never' }, execution_scope: protectedScope, chain_override: protectedScope.phase_chain }, { projectRoot: f.root });
    createGoalRun({ frameworkRoot: frameworkRoot, projectRoot: f.root, manifest: protectedRun, chain: protectedScope.phase_chain });
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
      const inputs = { context: { schema_version: '1.1' as const, subject: { feature: f.feature }, obligations: {}, required_outputs: [] }, phase, values: {}, artifacts: { ...c.artifacts, 'contracts@1': planContracts(f), 'acceptance@1': a.value } };
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
  { name: 'a3c7e9d1 不执行 plan：蓝图直接投影的 contracts.modules 越出预测 touches 不自动成为授权失败', run(f) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const module = (name: string) => ({ name, layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: `02-Feature/${name}` });
    (node.contracts as BlueprintRecord).modules = [module('ledger')];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts').state, 'resolved', '可修改集合内的模块应放行');
    (node.contracts as BlueprintRecord).modules = [module('ledger'), module('SharedState')];
    fs.writeFileSync(f.blueprintFile, YAML.stringify(doc)); f.bind();
    const result = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(result.state, 'resolved', result.detail);
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
  ...(['refs-only', 'text-only', 'runtime-gap', 'unknown-usecase', 'missing-expected', 'ac-disguised-as-boundary', 'external-conflict', 'duplicate-design-id'] as const).map(mode => ({ name: 'projection responsibility gap: ' + mode, run(f: ReturnType<typeof fixture>) {
    const doc = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf8'));
    const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf8'));
    const node = asRecord(resolveBlueprintTarget(doc, cu.design_refs[0].target))!;
    const flowRef = cu.design_refs.find((ref: ComponentBlueprintRef) => ref.target.kind === 'flow');
    const flow = asRecord(resolveBlueprintTarget(doc, flowRef.target))!;
    let kind: 'acceptance' | 'contracts' = 'contracts';
    if (mode === 'refs-only') { delete node.acceptance; kind = 'acceptance'; }
    if (mode === 'text-only') { node.acceptance = '验收按设计执行'; kind = 'acceptance'; }
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
async function runCases(selected: typeof cases): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of selected) {
    const f = fixture();
    try { await test.run(f); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
  }
  return results;
}

export const runAll = (): Promise<UnitCaseResult[]> => runCases(cases);
export const runSelectedCases = async (filter?: string) => {
  const results = await runCases(cases.filter(item => filter === undefined || item.name.includes(filter)));
  return { results, matchedCaseCount: results.length, executionTimings: [] };
};
export const runContentWarnCases = (): Promise<UnitCaseResult[]> => runCases(cases.filter(item => item.name.startsWith('content rules:')));
