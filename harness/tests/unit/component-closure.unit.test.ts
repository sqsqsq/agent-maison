import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureFilePath } from '../../config';
import * as closureEvidenceChecks from '../fixtures/component-blueprint/valid/test/ledger/closure.test';
import { BlueprintRecord, asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { blueprintRefAddress } from '../../scripts/utils/change-unit-model';
import {
  asChangeUnitArtifact,
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
} from '../../scripts/utils/change-unit-path';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { componentBlueprintPath, sha256Bytes } from '../../scripts/utils/component-blueprint-path';
import { componentClosurePath, loadCanonicalComponentClosure } from '../../scripts/utils/component-closure-path';
import {
  ComponentClosureEvaluationOptions,
  evaluateComponentClosure,
  validateComponentClosure,
} from '../../scripts/utils/component-closure-validator';
import { ClosureEvidenceProvider } from '../../scripts/utils/component-closure-provider-boundary';
import { parseClosureEvidenceIdentity } from '../../scripts/utils/component-closure-evidence';
import { renderComponentClosureMarkdown } from '../../scripts/utils/component-closure-review-projection';
import { ComponentClosureArtifact, ClosureProviderObservation } from '../../scripts/utils/component-closure-model';
import {
  recomputePhaseEvidenceStaleness,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { CheckResult, Phase } from '../../scripts/utils/types';
import { clearSkillsIndexCache, resolveSkillPath } from '../../scripts/utils/resolve-skill-path';
import { checkCanonicalComponentClosure, writeCanonicalComponentClosure } from '../../scripts/check-component-closure';

interface UnitCaseResult { name: string; ok: boolean; error?: string }

const BASE_PROJECT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const FIXED_TIME = '2026-08-20T12:00:00+08:00';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function test(name: string, run: () => void): UnitCaseResult {
  try { run(); return { name, ok: true }; }
  catch (error) { return { name, ok: false, error: (error as Error).stack ?? (error as Error).message }; }
}

function withProject(run: (projectRoot: string) => void, mutateBlueprint?: (blueprint: BlueprintRecord) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-component-closure-'));
  const projectRoot = path.join(tempRoot, 'project');
  fs.cpSync(BASE_PROJECT, projectRoot, { recursive: true });
  try {
    prepareCompleteProject(projectRoot, mutateBlueprint);
    run(projectRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/** MG 跨层链（mechanical-loop-closure）复用同一现场——唯一实现，不另造第二套夹具装配。 */
export function prepareCompleteProject(projectRoot: string, mutateBlueprint?: (blueprint: BlueprintRecord) => void): void {
  fs.mkdirSync(path.join(projectRoot, 'skills'), { recursive: true });
  const blueprintFile = componentBlueprintPath(projectRoot, 'ledger-app-blueprint');
  const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8')) as BlueprintRecord;
  mutateBlueprint?.(blueprint);
  fs.writeFileSync(blueprintFile, YAML.stringify(blueprint), 'utf8');
  const blueprintHash = sha256Bytes(fs.readFileSync(blueprintFile));
  const unitsDir = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint');
  for (const dirName of fs.readdirSync(unitsDir, { withFileTypes: true })) {
    if (!dirName.isDirectory() || dirName.name === 'blueprint') continue;
    const file = path.join(unitsDir, dirName.name, 'change-unit.yaml');
    if (!fs.existsSync(file)) continue;
    const unit = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
    if (unit.change_unit_id === 'ledger-summary') unit.blockers = [];
    for (const invariant of asRecords(unit.preserved_invariants)) {
      invariant.evidence_refs = ['test/ledger/closure.test.ts#verifyPreservedInvariant'];
    }
    for (const predicate of asRecords(unit.target_predicates)) {
      predicate.verification_refs = ['test/ledger/closure.test.ts#verifyChangeUnit'];
    }
    unit.verification_refs = ['test/ledger/closure.test.ts#verifyChangeUnit'];
    const safeState = asRecord(unit.safe_intermediate_state);
    if (safeState) {
      safeState.build_validation_refs = ['test/ledger/closure.test.ts#verifySafeBuild'];
      safeState.compatibility_refs = ['test/ledger/closure.test.ts#verifySafeCompatibility'];
      safeState.recovery_refs = ['test/ledger/closure.test.ts#verifySafeRecovery'];
    }
    const rootRef = asRecord(unit.component_blueprint_ref)!;
    rootRef.artifact_sha256 = blueprintHash;
    rootRef.revision = blueprint.revision;
    rootRef.source_fingerprint = blueprint.source_fingerprint;
    for (const ref of asRecords(unit.design_refs)) {
      ref.artifact_sha256 = blueprintHash;
      ref.revision = blueprint.revision;
      ref.source_fingerprint = blueprint.source_fingerprint;
    }
    fs.writeFileSync(file, YAML.stringify(unit), 'utf8');
  }
  const loadedUnits = enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint');
  for (const loaded of loadedUnits) configureFeature(projectRoot, loaded);
  for (const loaded of loadedUnits) {
    const unit = asChangeUnitArtifact(loaded.changeUnit);
    writeTrustedEvidenceChain(projectRoot, deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id));
  }
}

function configureFeature(
  projectRoot: string,
  loaded: ReturnType<typeof enumerateCanonicalChangeUnits>[number],
): void {
    const unit = asChangeUnitArtifact(loaded.changeUnit);
    const featureId = deriveChangeUnitFeatureId('ledger-app-blueprint', unit.change_unit_id);
    const contractsFile = featureFilePath(projectRoot, featureId, 'contracts.yaml');
    const contracts = YAML.parse(fs.readFileSync(contractsFile, 'utf8')) as BlueprintRecord;
    contracts.change_unit = {
      change_unit_ref: createChangeUnitRef(loaded),
      predicate_mappings: unit.target_predicates.map(predicate => ({
        predicate_id: predicate.predicate_id,
        implementation_refs: ['src/ledger/ClosureFixture.ts#componentClosureCombination'],
        test_refs: ['test/ledger/closure.test.ts#componentClosureCombination'],
      })),
      provide_mappings: unit.provides.map(provide => ({
        provide_id: provide.provide_id,
        implementation_refs: ['src/ledger/ClosureFixture.ts#componentClosureCombination'],
        test_refs: ['test/ledger/closure.test.ts#componentClosureCombination'],
      })),
      design_ref_mappings: unit.design_refs.map(ref => ({
        design_ref: ref,
        implementation_refs: ['src/ledger/ClosureFixture.ts#componentClosureCombination'],
        verification_refs: ['test/ledger/closure.test.ts#componentClosureCombination'],
      })),
    };
    const flowRef = unit.design_refs.find(ref => ref.target.kind === 'flow');
    contracts.state_management = flowRef ? [runtimeConstruction(projectRoot, flowRef)] : [];
    fs.writeFileSync(contractsFile, YAML.stringify(contracts), 'utf8');
    fs.writeFileSync(path.join(path.dirname(contractsFile), 'use-cases.yaml'), YAML.stringify({
      schema_version: '2',
      feature: featureId,
      use_cases: [{
        id: `${unit.change_unit_id}-runtime`,
        coordinator: 'LedgerFeature.run',
        ui_bindings: [],
        state_model: { phases: ['initial-load', 'current', 'recovered'] },
        branches: [{ id: 'success', when: 'authoritative state is current', expected_phase_seq: ['initial-load', 'current'], linked_acceptance: [] }],
      }],
    }), 'utf8');
}

function runtimeConstruction(projectRoot: string, flowRef: unknown): BlueprintRecord {
  const ref = flowRef as { target: { id: string } };
  const blueprint = YAML.parse(fs.readFileSync(componentBlueprintPath(projectRoot, 'ledger-app-blueprint'), 'utf8')) as BlueprintRecord;
  const runtime = asRecords(blueprint.design_views).find(view => view.view_id === 'runtime')!;
  const flow = asRecords(runtime.runtime_data_flows).find(item => item.flow_id === ref.target.id);
  if (!flow) {
    return {
      data: 'ledger', scope: 'component', decorator: 'none', holder: 'LedgerStore', module: 'ledger',
      design_ref: flowRef, owner_ref: 'view:runtime/node:ledger-repository', contract_refs: ['contract:create-entry-v1'],
      mutations: [], publications: [], subscriptions: [], consumers: [],
    };
  }
  const consumers = asRecords(flow.consumers).map(item => ({ ...item }));
  const consumerById = new Map(consumers.map(item => [String(item.consumer_id), item]));
  return {
    data: 'ledger',
    scope: 'component',
    decorator: 'none',
    holder: 'LedgerStore',
    module: 'ledger',
    design_ref: flowRef,
    owner_ref: 'view:runtime/node:ledger-repository',
    contract_refs: ['contract:create-entry-v1'],
    lifecycle_triggers: Object.entries(asRecord(flow.lifecycle_coverage) ?? {})
      .filter(([, value]) => asRecord(value)?.status === 'covered')
      .map(([key]) => key),
    failure_recovery: clone(asRecord(flow.failure_recovery) ?? {}),
    mutations: asRecords(flow.mutations).map(item => ({ ...item })),
    publications: asRecords(flow.publications).map(item => ({ ...item })),
    subscriptions: asRecords(flow.subscriptions).map(item => {
      const consumer = consumerById.get(String(item.consumer_ref ?? '').replace(/^consumer:/, ''));
      return { ...item, ...(consumer?.update_ref ? { publication_ref: consumer.update_ref } : {}) };
    }),
    consumers,
  };
}

const EVIDENCE_SOURCE_REF = 'test/ledger/closure.test.ts';
const EXECUTABLE_EVIDENCE_CHECKS = Object.entries(closureEvidenceChecks)
  .filter((entry): entry is [string, () => boolean] => typeof entry[1] === 'function')
  .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

function writeTrustedEvidenceChain(
  projectRoot: string,
  featureId: string,
  failedSymbol?: string,
): void {
  for (const phase of ['ut', 'testing'] as const) {
    const checks: CheckResult[] = EXECUTABLE_EVIDENCE_CHECKS.map(([symbol, execute]) => {
      let passed = false;
      try { passed = execute() === true; } catch { passed = false; }
      if (symbol === failedSymbol) passed = false;
      return {
        id: symbol,
        category: 'traceability',
        description: `Execute ${EVIDENCE_SOURCE_REF}#${symbol}`,
        severity: 'BLOCKER',
        status: passed ? 'PASS' : 'FAIL',
        details: passed ? 'Executed by the fixture harness and passed.' : 'Executed by the fixture harness and failed.',
        affected_files: [EVIDENCE_SOURCE_REF],
      };
    });
    generateScriptReport('', phase as Phase, featureId, projectRoot, checks);
    const receiptPath = featureFilePath(projectRoot, featureId, path.join(phase, 'phase-completion-receipt.md'));
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `feature: ${featureId}\nphase: ${phase}\n`, 'utf8');
    const manifest = resolvePhaseEvidenceManifest({
      projectRoot,
      feature: featureId,
      phase: phase as Phase,
      extraInputs: [EVIDENCE_SOURCE_REF],
    });
    const written = writePhaseEvidenceManifest(projectRoot, manifest);
    writeReceiptManifestPointer(
      projectRoot,
      featureId,
      phase,
      path.relative(projectRoot, written.absPath).split(path.sep).join('/'),
      written.sha256,
    );
  }
}

function provider(
  id: ClosureProviderObservation['provider_id'],
  available: boolean,
): ClosureEvidenceProvider {
  return (_projectRoot, _inputs, requested) => ({
    provider_id: id,
    available,
    claimed_evidence_identities: available ? requested : [],
  });
}

function evaluationOptions(state: 'VALID' | 'STALE' | 'INVALID' | 'ABSENT' = 'VALID'): ComponentClosureEvaluationOptions {
  return {
    evaluatedAt: FIXED_TIME,
    observeCompletion: (_root, unit) => ({
      state,
      featureId: deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id),
      expectedTrack: 'default',
      expectedChain: ['ut', 'testing'],
      reasons: state === 'VALID' ? [] : [`fixture-${state.toLowerCase()}`],
    }),
  };
}

function expectIssue(issues: Array<{ id: string }>, id: string): void {
  assert(issues.some(issue => issue.id === id || issue.id.startsWith(`${id}:`)), `缺期望 issue=${id}；实际=${issues.map(issue => issue.id).join(', ')}`);
}

function writeClosure(projectRoot: string, closure: ComponentClosureArtifact): void {
  const yamlPath = componentClosurePath(projectRoot, closure.blueprint_id);
  fs.writeFileSync(yamlPath, YAML.stringify(closure), 'utf8');
  const hash = sha256Bytes(fs.readFileSync(yamlPath));
  fs.writeFileSync(path.join(path.dirname(yamlPath), 'component-closure.md'), renderComponentClosureMarkdown(closure, hash), 'utf8');
}

function mutateFeatureContracts(
  projectRoot: string,
  changeUnitId: string,
  mutate: (contracts: BlueprintRecord) => void,
): void {
  const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', changeUnitId);
  const file = featureFilePath(projectRoot, feature, 'contracts.yaml');
  const contracts = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
  mutate(contracts);
  fs.writeFileSync(file, YAML.stringify(contracts), 'utf8');
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  results.push(test('complete multi-CU fixture reconstructs deterministic Component closure', () => {
    withProject(projectRoot => {
      const first = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      const second = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(first.issues.length === 0, first.issues.map(issue => `${issue.id}:${issue.message}`).join('\n'));
      assert(first.closure.verdict === 'PASS_WITH_DEGRADATION', `unexpected verdict=${first.closure.verdict}`);
      assert(JSON.stringify(first.closure) === JSON.stringify(second.closure), '相同规范化输入未得到确定性 closure');
      assert(first.closure.inputs.change_units.length === 4, '未枚举完整 canonical CU 集');
      assert(first.closure.coverage_rows.some(row => row.kind === 'runtime_flow' && row.observation === 'covered'), 'runtime flow 未闭合');
      const featureId = first.closure.inputs.features[0].feature_id;
      assert(recomputePhaseEvidenceStaleness(projectRoot, featureId, ['ut', 'testing']).every(item => item.verdict === 'fresh'), '正向 fixture 未经过既有 receipt/manifest freshness verifier');
      assert(first.closure.provider_observations.some(providerObservation => providerObservation.observations.some(observation => observation.status === 'current')), '真实执行报告未形成 current Provider observation');
      writeClosure(projectRoot, first.closure);
      const loaded = loadCanonicalComponentClosure(projectRoot, 'ledger-app-blueprint');
      const validated = validateComponentClosure(loaded.closure, projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(validated.issues.length === 0, validated.issues.map(issue => `${issue.id}@${issue.path}:${issue.message}`).join('\n'));
    });
  }));

  results.push(test('production --write entry atomically materializes YAML, hashes it, derives full review Markdown, then revalidates', () => {
    withProject(projectRoot => {
      const result = writeCanonicalComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(result.issues.length === 0, result.issues.map(issue => `${issue.id}:${issue.message}`).join('\n'));
      assert(fs.existsSync(componentClosurePath(projectRoot, 'ledger-app-blueprint')), 'canonical closure YAML 未生成');
      const markdownPath = path.join(path.dirname(componentClosurePath(projectRoot, 'ledger-app-blueprint')), 'component-closure.md');
      const markdown = fs.readFileSync(markdownPath, 'utf8');
      for (const expected of [
        '| CU | Revision |',
        'contracts SHA-256',
        'Exact evidence identities',
        'Authority ref',
        'Needed by',
        'closure_artifact_sha256',
      ]) assert(markdown.includes(expected), `评审投影缺 ${expected}`);
      const checked = checkCanonicalComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(checked.issues.length === 0, checked.issues.map(issue => issue.id).join(', '));
    });
  }));

  results.push(test('closure loader binds path, YAML and blueprint ref component identity', () => {
    withProject(projectRoot => {
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      const tampered = clone(evaluated.closure);
      tampered.component_blueprint_ref.component_id = 'foreign';
      writeClosure(projectRoot, tampered);
      let message = '';
      try { loadCanonicalComponentClosure(projectRoot, 'ledger-app-blueprint'); } catch (error) { message = (error as Error).message; }
      // M5A：blueprint_id 三方（path/yaml/ref）+ component_id 两方（yaml/ref）
      assert(message.includes('yaml=ledger') && message.includes('blueprint_ref=foreign'), `identity 未 fail-closed：${message}`);
    });
  }));

  results.push(test('current-scope requirement source and bidirectional mapping fail closed in P1', () => {
    withProject(projectRoot => {
      const blueprintFile = componentBlueprintPath(projectRoot, 'ledger-app-blueprint');
      const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8')) as BlueprintRecord;
      delete asRecords(asRecord(asRecord(blueprint.discovery)?.inputs)?.current_scope_items)[0].source_sha256;
      expectIssue(validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: blueprintFile }), 'blueprint_current_scope_source_hash_missing');
      fs.rmSync(path.join(projectRoot, 'requirements', 'ledger.md'));
      expectIssue(validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: blueprintFile }), 'blueprint_current_scope_source_unresolvable');
      asRecord(blueprint.discovery)!.requirement_traceability = [];
      expectIssue(validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: blueprintFile }), 'blueprint_requirement_traceability_missing');
    });
  }));

  results.push(test('local requirement byte change is caught by P1 and changes existing P3 input fingerprint without a new fingerprint kind', () => {
    withProject(projectRoot => {
      const before = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure.input_fingerprint;
      const requirementFile = path.join(projectRoot, 'requirements', 'ledger.md');
      fs.appendFileSync(requirementFile, '\nAdditional current-scope constraint.\n', 'utf8');
      const blueprintFile = componentBlueprintPath(projectRoot, 'ledger-app-blueprint');
      const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8')) as BlueprintRecord;
      expectIssue(validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: blueprintFile }), 'blueprint_current_scope_source_hash_mismatch');
      const after = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      assert(after.input_fingerprint !== before, '来源原始字节变化未进入既有 P3 input_fingerprint');
      assert(Object.keys(after).every(key => key !== 'traceability_fingerprint'), '错误新增 traceability fingerprint');
    });
  }));

  results.push(test('mapping-only change preserves source_fingerprint but stales closure input fingerprint', () => {
    withProject(projectRoot => {
      const before = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      const blueprintFile = componentBlueprintPath(projectRoot, 'ledger-app-blueprint');
      const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8')) as BlueprintRecord;
      const sourceFingerprint = blueprint.source_fingerprint;
      const trace = asRecords(asRecord(blueprint.discovery)?.requirement_traceability)[0];
      trace.blueprint_refs = ['view:runtime/flow:ledger-refresh-flow'];
      blueprint.revision = Number(blueprint.revision) + 1;
      prepareCompleteProject(projectRoot, current => Object.assign(current, blueprint));
      const after = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      assert(after.component_blueprint_ref.source_fingerprint === sourceFingerprint, 'mapping 错误混入 source_fingerprint');
      assert(after.input_fingerprint !== before.input_fingerprint, 'mapping 变化未使 P3 input_fingerprint 变化');
    });
  }));

  results.push(test('coverage full-row recomputation rejects swapped owner and unrelated evidence', () => {
    withProject(projectRoot => {
      const expected = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      const swapped = clone(expected);
      const row = swapped.coverage_rows.find(item => item.owner_change_unit_ids.length > 1)!;
      row.owner_change_unit_ids = [row.owner_change_unit_ids[0]];
      expectIssue(validateComponentClosure(swapped, projectRoot, 'ledger-app-blueprint', evaluationOptions()).issues, 'component_closure_coverage_mismatch');
      const unrelated = clone(expected);
      unrelated.coverage_rows[0].evidence_identities = ['feature:valid-but-unrelated/evidence'];
      expectIssue(validateComponentClosure(unrelated, projectRoot, 'ledger-app-blueprint', evaluationOptions()).issues, 'component_closure_coverage_mismatch');
    });
  }));

  results.push(test('every authored closure field diverging from recomputation is caught, and stale input fingerprint cannot pass', () => {
    withProject(projectRoot => {
      const expected = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      const fieldBreaks: Array<{ issue: string; tamper: (closure: ComponentClosureArtifact) => void }> = [
        {
          issue: 'component_closure_blueprint_binding_mismatch',
          tamper: closure => { closure.component_blueprint_ref = { ...closure.component_blueprint_ref, revision: Number(closure.component_blueprint_ref.revision) + 1 }; },
        },
        { issue: 'component_closure_input_manifest_mismatch', tamper: closure => { closure.inputs = { ...closure.inputs, change_units: [] }; } },
        { issue: 'component_closure_provider_observation_mismatch', tamper: closure => { closure.provider_observations = []; } },
        { issue: 'component_closure_coverage_mismatch', tamper: closure => { closure.coverage_rows = closure.coverage_rows.slice(1); } },
        { issue: 'component_closure_knowledge_mismatch', tamper: closure => { closure.knowledge_writeback_refs = []; } },
        { issue: 'component_closure_degradation_mismatch', tamper: closure => { closure.degradations = []; } },
        {
          issue: 'component_closure_gap_mismatch',
          tamper: closure => {
            closure.gaps = [...closure.gaps, {
              gap_id: 'authored-fake-gap',
              classification: 'incomplete',
              obligation_refs: ['obligation:authored'],
              source_refs: [],
              owner: 'nobody',
              needed_by: 'component-closure',
              reason: 'authored by hand',
              unlock_condition: 'never',
            } as unknown as ComponentClosureArtifact['gaps'][number]];
          },
        },
        { issue: 'component_closure_verdict_mismatch', tamper: closure => { closure.verdict = 'PASS'; } },
      ];
      for (const fieldBreak of fieldBreaks) {
        const tampered = clone(expected);
        fieldBreak.tamper(tampered);
        expectIssue(validateComponentClosure(tampered, projectRoot, 'ledger-app-blueprint', evaluationOptions()).issues, fieldBreak.issue);
      }
      const stale = clone(expected);
      stale.input_fingerprint = `sha256:${'0'.repeat(64)}`;
      expectIssue(validateComponentClosure(stale, projectRoot, 'ledger-app-blueprint', evaluationOptions()).issues, 'component_closure_input_fingerprint_stale');
    });
  }));

  results.push(test('current blueprint design decision without any CU or combination owner fails cross-view closure', () => {
    withProject(projectRoot => {
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'component_closure_design_unconsumed');
      assert(evaluated.closure.verdict === 'FAIL', '无 owner 的蓝图设计决策未使 closure 失败');
    }, blueprint => {
      const decisionsAndGaps = asRecord(blueprint.decisions_and_gaps)!;
      const decisions = asRecords(decisionsAndGaps.decisions);
      const authority = decisions.find(item => item.decision_id === 'seam-shape')!;
      decisionsAndGaps.decisions = [...decisions, {
        ...clone(authority),
        decision_id: 'unconsumed-structural-decision',
        kind: 'structural',
        status: 'decided_with_authority',
      }];
    });
  }));

  results.push(test('CU design address outside current closure obligations fails as design bypass', () => {
    withProject(projectRoot => {
      const cuFile = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'ledger-refresh', 'change-unit.yaml');
      const cu = YAML.parse(fs.readFileSync(cuFile, 'utf8')) as BlueprintRecord;
      const blueprint = YAML.parse(fs.readFileSync(componentBlueprintPath(projectRoot, 'ledger-app-blueprint'), 'utf8')) as BlueprintRecord;
      const bypassRef = clone(asRecords(cu.design_refs)[0]);
      bypassRef.target = { kind: 'blueprint', id: String(blueprint.blueprint_id) };
      cu.design_refs = [...asRecords(cu.design_refs), bypassRef];
      fs.writeFileSync(cuFile, YAML.stringify(cu), 'utf8');
      prepareCompleteProject(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'component_closure_design_bypass');
      assert(evaluated.closure.verdict === 'FAIL', '绕过 obligation 粒度的设计地址未使 closure 失败');
    });
  }));

  results.push(test('Provider cannot cover rows with an unrequested same-feature or completion-like observation', () => {
    withProject(projectRoot => {
      const options = evaluationOptions();
      options.evidenceProviders = [
        (_root, _inputs, _requested) => ({
          provider_id: 'automated-construction-evidence',
          available: true,
          claimed_evidence_identities: ['feature:cu-bGVkZ2VyAGxlZGdlci1yZWZyZXNo/completion:sha256:unrelated'],
        }),
        provider('ui-device-visual-evidence', true),
        provider('human-acceptance-risk', false),
      ];
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', options);
      expectIssue(evaluated.issues, 'component_closure_provider_authority_conflict');
      assert(evaluated.closure.verdict === 'FAIL', 'Provider 任意 observation 覆盖了精确 row identity');
      assert(evaluated.closure.coverage_rows.some(row => row.evidence_level === 'unit_contract' && row.observation === 'uncovered'), '缺精确 observation 的 row 未保持 uncovered');
    });
  }));

  results.push(test('valid file symbol and hash without a matching successful report cannot cover closure', () => {
    withProject(projectRoot => {
      for (const loaded of enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint')) {
        const unit = asChangeUnitArtifact(loaded.changeUnit);
        writeTrustedEvidenceChain(
          projectRoot,
          deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id),
          'componentClosureCombination',
        );
      }
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(evaluated.closure.verdict === 'FAIL', '只有当前文件/symbol/hash、但匹配执行报告失败时仍被覆盖');
      const affected = evaluated.closure.coverage_rows.filter(row => row.evidence_identities.some(identity => {
        const payload = parseClosureEvidenceIdentity(identity);
        return payload?.authority_ref.endsWith('#componentClosureCombination');
      }));
      assert(affected.length > 0, '反例未命中 componentClosureCombination identity');
      assert(affected.every(row => row.observation !== 'covered'), '失败报告仍被默认 Provider 自证为 covered');
    });
  }));

  for (const state of ['STALE', 'INVALID', 'ABSENT'] as const) {
    results.push(test(`${state} completion remains distinct and cannot close Component`, () => {
      withProject(projectRoot => {
        const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions(state));
        assert(evaluated.closure.verdict === 'FAIL', `${state} completion 意外放行`);
        expectIssue(evaluated.issues, `component_closure_completion_${state.toLowerCase()}`);
      });
    }));
  }

  results.push(test('historical CU contributes only through exact VALID completion and P2 carry-forward', () => {
    withProject(projectRoot => {
      const cuFile = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'ledger-summary', 'change-unit.yaml');
      const cu = YAML.parse(fs.readFileSync(cuFile, 'utf8')) as BlueprintRecord;
      const historicalHash = `sha256:${'1'.repeat(64)}`;
      const rootRef = asRecord(cu.component_blueprint_ref)!;
      rootRef.revision = 1;
      rootRef.artifact_sha256 = historicalHash;
      for (const ref of asRecords(cu.design_refs)) {
        ref.revision = 1;
        ref.artifact_sha256 = historicalHash;
      }
      for (const touch of asRecords(cu.touches)) {
        const ref = asRecord(touch.design_ref)!;
        ref.revision = 1;
        ref.artifact_sha256 = historicalHash;
      }
      fs.writeFileSync(cuFile, YAML.stringify(cu), 'utf8');
      const loaded = enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint').find(item => item.changeUnit.change_unit_id === 'ledger-summary')!;
      configureFeature(projectRoot, loaded);
      const carried = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      const summary = carried.closure.inputs.change_units.find(item => item.ref.change_unit_id === 'ledger-summary')!;
      assert(summary.carry_forward && summary.completion === 'VALID', `历史 CU 未按 P2 carry-forward 贡献：${summary.carry_forward_reasons.join(',')}`);

      const broken = YAML.parse(fs.readFileSync(cuFile, 'utf8')) as BlueprintRecord;
      const flow = asRecords(broken.design_refs).find(ref => asRecord(ref.target)?.kind === 'flow')!;
      asRecord(flow.target)!.id = 'missing-flow';
      fs.writeFileSync(cuFile, YAML.stringify(broken), 'utf8');
      configureFeature(projectRoot, enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint').find(item => item.changeUnit.change_unit_id === 'ledger-summary')!);
      const rejected = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(rejected.issues, 'component_closure_carry_forward_rejected');
      assert(rejected.closure.verdict === 'FAIL', '失效历史 stable id 被 carry-forward 放行');
    });
  }));

  results.push(test('missing cross-CU combination evidence fails despite VALID individual completion', () => {
    withProject(projectRoot => {
      const consumerFeature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-consumer');
      const file = featureFilePath(projectRoot, consumerFeature, 'contracts.yaml');
      const contracts = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
      const section = asRecord(contracts.change_unit)!;
      for (const mapping of [
        ...asRecords(section.predicate_mappings),
        ...asRecords(section.provide_mappings),
        ...asRecords(section.design_ref_mappings),
      ]) {
        mapping.implementation_refs = ['src/ledger/ClosureFixture.ts#alternateComponentClosure'];
        if (Object.prototype.hasOwnProperty.call(mapping, 'test_refs')) {
          mapping.test_refs = ['test/ledger/closure.test.ts#alternateComponentClosure'];
        }
        if (Object.prototype.hasOwnProperty.call(mapping, 'verification_refs')) {
          mapping.verification_refs = ['test/ledger/closure.test.ts#alternateComponentClosure'];
        }
      }
      fs.writeFileSync(file, YAML.stringify(contracts), 'utf8');
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(evaluated.closure.verdict === 'FAIL', '独立 completion 误替代组合证据');
      expectIssue(evaluated.issues, 'component_closure_dependency_assembly_unverified');
    });
  }));

  results.push(test('runtime flow must be constructed in every owning Feature state_management', () => {
    withProject(projectRoot => {
      const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-recovery');
      const file = featureFilePath(projectRoot, feature, 'contracts.yaml');
      const contracts = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
      contracts.state_management = [];
      fs.writeFileSync(file, YAML.stringify(contracts), 'utf8');
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'component_closure_runtime_flow_unconstructed');
      assert(evaluated.closure.verdict === 'FAIL', 'runtime 施工断链意外放行');
    });
  }));

  results.push(test('runtime local objects derive distinct mapping and evidence identities instead of one flow placeholder', () => {
    withProject(projectRoot => {
      const closure = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      const rows = closure.coverage_rows.filter(row => ['runtime_mutation', 'runtime_publication', 'runtime_subscription', 'runtime_consumer'].includes(row.kind));
      assert(rows.length === 4, `runtime local rows=${rows.length}`);
      assert(new Set(rows.flatMap(row => row.feature_mapping_refs)).size >= 4, 'runtime local objects 仍复用同一 flow mapping');
      assert(rows.every(row => row.evidence_identities.length > 0), 'runtime local object 缺精确 evidence identity');
      assert(new Set(rows.flatMap(row => row.evidence_identities)).size === rows.reduce((sum, row) => sum + row.evidence_identities.length, 0), 'runtime local evidence identity 被跨义务复用');
    });
  }));

  results.push(test('read-only initial-load flow derives no fake mutation/publication/subscription obligations', () => {
    withProject(projectRoot => {
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(evaluated.issues.length === 0, evaluated.issues.map(issue => issue.id).join(', '));
      assert(!evaluated.closure.coverage_rows.some(row => ['runtime_mutation', 'runtime_publication', 'runtime_subscription'].includes(row.kind)), 'read-only flow 被强造写入/发布/订阅义务');
    }, blueprint => {
      const runtime = asRecords(blueprint.design_views).find(view => view.view_id === 'runtime')!;
      const flow = asRecords(runtime.runtime_data_flows)[0];
      flow.triggers = asRecords(flow.triggers).filter(trigger => trigger.kind === 'cold_start');
      flow.mutations = [];
      flow.publications = [];
      flow.subscriptions = [];
      for (const consumer of asRecords(flow.consumers)) delete consumer.update_ref;
      const assessment = asRecord(asRecord(blueprint.app_lens)?.runtime_flow_trigger_assessment)!;
      asRecord(assessment.user_mutation_refreshes_other_consumers)!.applies = false;
    });
  }));

  for (const runtimeBreak of [
    { id: 'missing-initial-load', mutate: (state: BlueprintRecord) => { delete asRecords(state.consumers)[0].initial_load_ref; } },
    { id: 'propagation', mutate: (state: BlueprintRecord) => { asRecords(state.mutations)[0].publication_ref = 'publication:not-real'; } },
    { id: 'late-snapshot', mutate: (state: BlueprintRecord) => { delete asRecords(state.subscriptions)[0].replay_or_snapshot; } },
    { id: 'persistence-recovery', mutate: (state: BlueprintRecord) => { delete asRecords(state.mutations)[0].recovery_ref; } },
    { id: 'subscription-cleanup', mutate: (state: BlueprintRecord) => { delete asRecords(state.subscriptions)[0].cleanup; } },
    { id: 'state-owner', mutate: (state: BlueprintRecord) => { state.owner_ref = 'view:runtime/node:ledger-store'; } },
    { id: 'consumer-refresh', mutate: (state: BlueprintRecord) => { asRecords(state.consumers)[0].update_ref = 'publication:not-real'; } },
  ]) {
    results.push(test(`runtime production entry rejects ${runtimeBreak.id} break`, () => {
      withProject(projectRoot => {
        mutateFeatureContracts(projectRoot, 'ledger-refresh', contracts => runtimeBreak.mutate(asRecords(contracts.state_management)[0]));
        const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
        assert(evaluated.closure.verdict === 'FAIL', `${runtimeBreak.id} runtime break 意外放行`);
        assert(evaluated.issues.some(issue => issue.id.startsWith('component_closure_feature_projection_invalid:')), `${runtimeBreak.id} 未经过 P2 生产施工门`);
      });
    }));
  }

  results.push(test('dangling exact dependency and temporary asset without exit fail assembly closure', () => {
    withProject(projectRoot => {
      const consumerFile = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'ledger-consumer', 'change-unit.yaml');
      const consumer = YAML.parse(fs.readFileSync(consumerFile, 'utf8')) as BlueprintRecord;
      asRecords(consumer.requires)[0].from_change_unit_id = 'missing-provider';
      fs.writeFileSync(consumerFile, YAML.stringify(consumer), 'utf8');
      const blueprintFile = componentBlueprintPath(projectRoot, 'ledger-app-blueprint');
      const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8')) as BlueprintRecord;
      const decisionsAndGaps = asRecord(blueprint.decisions_and_gaps)!;
      const decisions = asRecords(decisionsAndGaps.decisions);
      const authority = decisions.find(item => item.decision_id === 'seam-shape')!;
      decisionsAndGaps.decisions = [...decisions, {
        decision_id: 'temporary-ledger-adapter',
        kind: 'temporary_asset',
        status: 'decided_with_authority',
        owner: 'ledger-team',
        needed_by: 'component-closure',
        verification_refs: ['test/ledger/closure.test.ts#verifyTemporaryAsset'],
        knowledge_refs: ['doc/architecture.yaml#decision:seam-shape'],
        provenance: clone(asRecord(authority.provenance)!),
      }];
      fs.writeFileSync(blueprintFile, YAML.stringify(blueprint), 'utf8');
      prepareCompleteProject(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'change_unit_dependency_provider_missing');
      expectIssue(evaluated.issues, 'component_closure_temporary_asset_exit_missing');
    });
  }));

  results.push(test('unresolved stable knowledge placement remains a blocker', () => {
    withProject(projectRoot => {
      fs.rmSync(path.join(projectRoot, 'doc', 'architecture.yaml'));
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'component_closure_knowledge_unresolved');
      assert(evaluated.closure.verdict === 'FAIL', '缺失知识真源意外放行');
    });
  }));

  results.push(test('existing knowledge file without the exact stable conclusion identity cannot pass writeback', () => {
    withProject(projectRoot => {
      const architecture = path.join(projectRoot, 'doc', 'architecture.yaml');
      fs.writeFileSync(architecture, 'component: ledger\nauthority: LedgerRepository\n# decision:seam-shape is only a comment\n', 'utf8');
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'component_closure_knowledge_unresolved');
      assert(evaluated.closure.verdict === 'FAIL', '仅文件存在被误当作稳定结论已归位');
    });
  }));

  results.push(test('authoritative establish_seam closes only with four distinct resolvable decision-test proofs', () => {
    withProject(projectRoot => {
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(!evaluated.issues.some(issue => issue.id.startsWith('component_closure_seam_')), evaluated.issues.map(issue => issue.id).join(', '));
      const proofRows = evaluated.closure.coverage_rows.filter(row => row.kind.startsWith('evolution_seam_') && row.kind !== 'evolution_seam_decision');
      assert(proofRows.length === 4, `seam proof rows=${proofRows.length}`);
      assert(proofRows.every(row => row.evidence_identities.length > 0 && row.observation === 'covered'), '四项 proof 未各自闭合');
    }, blueprint => {
      const decision = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions).find(item => item.decision_id === 'seam-shape')!;
      decision.human_decision = 'establish_seam';
      decision.failure_semantics = 'block';
      decision.closure_proofs = {
        contract_compatibility: 'test/ledger/closure.test.ts#proveSeamContractCompatibility',
        provider_replacement: 'test/ledger/closure.test.ts#proveSeamProviderReplacement',
        absence_failure: 'test/ledger/closure.test.ts#proveSeamAbsenceFailure',
        consumer_no_bypass: 'test/ledger/closure.test.ts#proveSeamConsumerNoBypass',
      };
      decision.tests = Object.values(asRecord(decision.closure_proofs)!);
    });
  }));

  results.push(test('establish_seam requires four exact test proofs and ignores source-string lookalikes', () => {
    withProject(projectRoot => {
      fs.appendFileSync(path.join(projectRoot, 'src', 'ledger', 'ClosureFixture.ts'), '\n// ConcreteLedgerProvider and LedgerDataSource are unrelated text, not a no-bypass proof.\n', 'utf8');
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      expectIssue(evaluated.issues, 'component_closure_seam_proof_unresolvable');
    }, blueprint => {
      const decision = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions).find(item => item.decision_id === 'seam-shape')!;
      decision.human_decision = 'establish_seam';
      decision.failure_semantics = 'block';
      decision.provider = 'ConcreteLedgerProvider';
      decision.stable_contract = 'LedgerDataSource';
      decision.closure_proofs = {
        contract_compatibility: 'test/ledger/closure.test.ts#proveSeamContractCompatibility',
        provider_replacement: 'test/ledger/closure.test.ts#proveSeamProviderReplacement',
        absence_failure: 'test/ledger/closure.test.ts#proveSeamAbsenceFailure',
        consumer_no_bypass: 'test/ledger/closure.test.ts#missingNoBypassProof',
      };
      decision.tests = Object.values(asRecord(decision.closure_proofs)!);
    });
  }));

  results.push(test('exact supersedes conflicts and structural cycles fail closed without a migration table', () => {
    withProject(projectRoot => {
      const loaded = enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint');
      const summaryRef = createChangeUnitRef(loaded.find(item => item.changeUnit.change_unit_id === 'ledger-summary')!);
      for (const id of ['ledger-consumer', 'ledger-recovery']) {
        const file = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', id, 'change-unit.yaml');
        const unit = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
        unit.supersedes = summaryRef;
        fs.writeFileSync(file, YAML.stringify(unit), 'utf8');
      }
      prepareCompleteProject(projectRoot);
      expectIssue(evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).issues, 'component_closure_supersedes_conflict');

      const after = enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint');
      const consumerRef = createChangeUnitRef(after.find(item => item.changeUnit.change_unit_id === 'ledger-consumer')!);
      const recoveryRef = createChangeUnitRef(after.find(item => item.changeUnit.change_unit_id === 'ledger-recovery')!);
      const consumerFile = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'ledger-consumer', 'change-unit.yaml');
      const recoveryFile = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'ledger-recovery', 'change-unit.yaml');
      const consumer = YAML.parse(fs.readFileSync(consumerFile, 'utf8')) as BlueprintRecord;
      const recovery = YAML.parse(fs.readFileSync(recoveryFile, 'utf8')) as BlueprintRecord;
      consumer.supersedes = recoveryRef;
      recovery.supersedes = consumerRef;
      fs.writeFileSync(consumerFile, YAML.stringify(consumer), 'utf8');
      fs.writeFileSync(recoveryFile, YAML.stringify(recovery), 'utf8');
      prepareCompleteProject(projectRoot);
      expectIssue(evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).issues, 'component_closure_supersedes_cycle');
    });
  }));

  results.push(test('keep_direct is not treated as an approved host seam', () => {
    withProject(projectRoot => {
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      assert(!evaluated.closure.coverage_rows.some(row => row.kind.startsWith('evolution_seam_')), 'keep_direct 生成了四项接缝证明');
      assert(!evaluated.issues.some(issue => issue.id.startsWith('component_closure_seam_')), 'keep_direct 被 seam checker 误挡');
    });
  }));

  results.push(test('required UI provider absence fails while optional human provider absence degrades', () => {
    withProject(projectRoot => {
      const requiredMissing = evaluationOptions();
      requiredMissing.evidenceProviders = [
        provider('automated-construction-evidence', true),
        provider('ui-device-visual-evidence', false),
        provider('human-acceptance-risk', false),
      ];
      const failed = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', requiredMissing).closure;
      assert(failed.verdict === 'FAIL', 'required UI/device provider 缺失被降级放行');
      const complete = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions()).closure;
      assert(failed.input_fingerprint !== complete.input_fingerprint, 'Provider exit/absence 未使 closure input fingerprint stale');
      assert(complete.verdict === 'PASS_WITH_DEGRADATION', 'optional human provider 缺失未形成诚实 degradation');
      assert(complete.degradations.some(item => item.degradation_id.includes('human-acceptance-risk')), '缺 optional provider degradation');
    });
  }));

  results.push(test('duplicate contradictory evidence provider fails closed without selecting inputs or verdict', () => {
    withProject(projectRoot => {
      const options = evaluationOptions();
      options.evidenceProviders = [
        provider('automated-construction-evidence', true),
        provider('automated-construction-evidence', false),
        provider('ui-device-visual-evidence', true),
        provider('human-acceptance-risk', false),
      ];
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', options);
      expectIssue(evaluated.issues, 'component_closure_provider_authority_conflict');
      assert(evaluated.closure.verdict === 'FAIL', '重复权威 provider 被注册顺序洗白');
    });
  }));

  results.push(test('P3 evaluation is read-only over P1/P2/Feature and cannot claim Capability E2E', () => {
    withProject(projectRoot => {
      const protectedFiles = [
        componentBlueprintPath(projectRoot, 'ledger-app-blueprint'),
        ...enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint').map(item => item.canonicalPath),
        ...enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint').map(item => featureFilePath(projectRoot, deriveChangeUnitFeatureId('ledger-app-blueprint', String(item.changeUnit.change_unit_id)), 'contracts.yaml')),
      ];
      const before = protectedFiles.map(file => fs.readFileSync(file));
      const evaluated = evaluateComponentClosure(projectRoot, 'ledger-app-blueprint', evaluationOptions());
      protectedFiles.forEach((file, index) => assert(fs.readFileSync(file).equals(before[index]), `P3 反写上游：${file}`));
      assert(!Object.prototype.hasOwnProperty.call(evaluated.closure, 'capability_e2e'), 'Component closure 越权声明 Capability E2E');
      assert(!Object.prototype.hasOwnProperty.call(evaluated.closure, 'p2_ready_set'), 'Component closure 写入 P2 ready state');
    });
  }));

  results.push(test('component-closure Skill resolves through the existing skills index SSOT', () => {
    const frameworkRoot = path.resolve(__dirname, '..', '..', '..');
    clearSkillsIndexCache();
    const resolved = resolveSkillPath(frameworkRoot, 'component-closure');
    assert(resolved.skillMdFrameworkRel === 'skills/project/component-closure/SKILL.md', `Skill 未接入索引：${resolved.skillMdFrameworkRel}`);
  }));

  return results;
}
