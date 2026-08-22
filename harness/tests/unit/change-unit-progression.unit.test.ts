import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureDir } from '../../config';
import { BlueprintRecord, ComponentBlueprintRef, asRecord } from '../../scripts/utils/component-blueprint-model';
import { resolveComponentBlueprintRef } from '../../scripts/utils/component-blueprint-path';
import { checkCanonicalChangeUnit } from '../../scripts/check-change-unit';
import {
  ChangeUnitResolutionError,
  asChangeUnitArtifact,
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
  loadCanonicalChangeUnit,
  parseChangeUnitFeatureId,
  resolveChangeUnitRef,
} from '../../scripts/utils/change-unit-path';
import { ChangeUnitRecord } from '../../scripts/utils/change-unit-model';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';
import {
  DagProjectionLike,
  validateChangeUnitFeatureProjection,
} from '../../scripts/utils/change-unit-feature-projection';
import { ContractsSpec, AcceptanceSpec } from '../../scripts/utils/types';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { observeChangeUnitCompletion, ChangeUnitCompletionState } from '../../scripts/utils/change-unit-completion';
import { CompletionVerdict } from '../../scripts/utils/verify-feature-completion';
import { deriveChangeUnitBlockers } from '../../scripts/utils/change-unit-blockers';
import { detectChangeUnitDependencyCycles, evaluateChangeUnitDependencies } from '../../scripts/utils/change-unit-dependencies';
import { evaluateChangeUnitCarryForward } from '../../scripts/utils/change-unit-reconciliation';
import { deriveChangeUnitReadySet, isSilentProgressStall } from '../../scripts/utils/change-unit-ready-set';
import { selectNextChangeUnit } from '../../scripts/utils/change-unit-selection';
import {
  ChangeUnitGoalHandoff,
  deriveChangeUnitProgressionDecision,
  inspectActiveChangeUnitRuns,
  runChangeUnitProgression,
} from '../../scripts/utils/change-unit-progress-loop';
import {
  acceptChangeUnitCandidate,
  dropUnacceptedChangeUnitCandidates,
  validateChangeUnitProviderBoundary,
} from '../../scripts/utils/change-unit-provider-boundary';
import { validateChangeUnitEvolutionSeam } from '../../scripts/utils/change-unit-evolution-seam';
import { clearSkillsIndexCache, resolveSkillPath } from '../../scripts/utils/resolve-skill-path';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const VALID_PROJECT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const VALID_CU_PATH = path.join(VALID_PROJECT, 'doc', 'features', 'ledger-app-blueprint', 'ledger-refresh', 'change-unit.yaml');
const CHANGE_UNIT_FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'change-unit');

function test(name: string, body: () => void): UnitCaseResult {
  try {
    body();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: (error as Error).stack ?? (error as Error).message };
  }
}

async function asyncTest(name: string, body: () => Promise<void>): Promise<UnitCaseResult> {
  try {
    await body();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: (error as Error).stack ?? (error as Error).message };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validChangeUnit(): ChangeUnitRecord {
  return YAML.parse(fs.readFileSync(VALID_CU_PATH, 'utf8')) as ChangeUnitRecord;
}

function issueIds(cu: ChangeUnitRecord, canonicalPath = VALID_CU_PATH): string[] {
  return validateChangeUnit(cu, { projectRoot: VALID_PROJECT, canonicalPath }).map(item => item.id);
}

function withTempProject(body: (projectRoot: string, cuPath: string) => void): void {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-p2-cu-'));
  try {
    fs.cpSync(VALID_PROJECT, temp, { recursive: true });
    body(temp, path.join(temp, 'doc', 'features', 'ledger-app-blueprint', 'ledger-refresh', 'change-unit.yaml'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function sha256(filePath: string): string {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function rebindBlueprintHash(cu: ChangeUnitRecord, artifactSha256: string): void {
  (cu.component_blueprint_ref as ChangeUnitRecord).artifact_sha256 = artifactSha256;
  for (const ref of cu.design_refs as ChangeUnitRecord[]) ref.artifact_sha256 = artifactSha256;
  for (const touch of cu.touches as ChangeUnitRecord[]) {
    (touch.design_ref as ChangeUnitRecord).artifact_sha256 = artifactSha256;
  }
}

function expectIssue(ids: string[], expected: string): void {
  assert(ids.includes(expected), `缺期望诊断 ${expected}；实际 ${ids.join(', ')}`);
}

function projectionContracts(projectRoot: string, changeUnitId = 'ledger-refresh'): {
  feature: string;
  contracts: ContractsSpec;
  acceptance: AcceptanceSpec;
  dags: DagProjectionLike[];
} {
  const loaded = loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', changeUnitId);
  const cu = loaded.changeUnit;
  const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', changeUnitId);
  const implementationRef = 'src/ledger/LedgerFeature.ets';
  const testRef = 'test/ledger/LedgerFeature.test.ets';
  fs.mkdirSync(path.join(projectRoot, 'src', 'ledger'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'test', 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, implementationRef), 'export const ledgerFeature = true;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, testRef), 'export const ledgerFeatureTest = true;\n', 'utf8');
  const flowRef = (cu.design_refs as ComponentBlueprintRef[]).find(ref => ref.target.kind === 'flow');
  const contracts = {
    feature,
    source: 'P2 fixture',
    version: '1',
    modules: [], module_dependencies: {}, data_models: [], interfaces: [], components: [], files: [implementationRef],
    change_unit: {
      change_unit_ref: createChangeUnitRef(loaded),
      predicate_mappings: (cu.target_predicates as ChangeUnitRecord[]).map(item => ({
        predicate_id: String(item.predicate_id), implementation_refs: [implementationRef], test_refs: [testRef],
      })),
      provide_mappings: (cu.provides as ChangeUnitRecord[]).map(item => ({
        provide_id: String(item.provide_id), implementation_refs: [implementationRef], test_refs: [testRef],
      })),
      design_ref_mappings: (cu.design_refs as ComponentBlueprintRef[]).map(ref => ({
        design_ref: clone(ref), implementation_refs: [implementationRef], verification_refs: [testRef],
      })),
    },
    state_management: flowRef ? [{
      data: 'ledger', scope: 'component', decorator: 'none', holder: 'LedgerStore', module: 'ledger',
      design_ref: clone(flowRef), owner_ref: 'view:runtime/node:ledger-repository', contract_refs: ['contract:create-entry-v1'],
      ordered_steps: ['persist mutation', 'publish snapshot', 'refresh consumer'],
      lifecycle_triggers: ['process_recreation'],
      failure_recovery: { strategy: 'reload repository snapshot' },
      mutations: [{ mutation_id: 'add-entry', kind: 'user', publication_ref: 'publication:ledger-changed', recovery_ref: 'recovery:reload-ledger' }],
      publications: [{ publication_id: 'ledger-changed' }],
      subscriptions: [{ subscription_id: 'ledger-page-subscription', consumer_ref: 'consumer:ledger-page', publication_ref: 'publication:ledger-changed', replay_or_snapshot: 'latest', cleanup: 'detach observer' }],
      consumers: [{ consumer_id: 'ledger-page', initial_load_ref: 'initial-load:repository-snapshot', update_ref: 'publication:ledger-changed' }],
    }] : [],
  } as unknown as ContractsSpec;
  const acceptance = {
    feature, source: 'P2 fixture', version: '1', boundaries: [],
    criteria: [{
      id: 'AC-P2', prd_function: null, priority: 'P0', description: 'refresh and recover', testable: true,
      verification_steps: ['persist', 'publish'], expected_result: 'consumer refreshed', ut_layer: 'unit', ut_focus: 'flow',
    }],
  } as AcceptanceSpec;
  return { feature, contracts, acceptance, dags: [{ dag: { use_case: 'ledger-refresh', branches: ['success'] } }] };
}

function bindFeatureContracts(projectRoot: string, feature: string, contracts: ContractsSpec, withUseCases = true): void {
  const dir = featureDir(projectRoot, feature);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'contracts.yaml'), YAML.stringify(contracts), 'utf8');
  if (withUseCases) {
    fs.writeFileSync(path.join(dir, 'use-cases.yaml'), YAML.stringify({
      schema_version: '2', feature, use_cases: [{ id: 'ledger-refresh', coordinator: 'LedgerFeature.run', ui_bindings: [], state_model: { phases: ['start', 'done'] }, branches: [{ id: 'success', when: 'persisted', expected_phase_seq: ['start', 'done'], linked_acceptance: ['AC-P2'] }] }],
    }), 'utf8');
  }
}

function progressionUnits(): ReturnType<typeof asChangeUnitArtifact>[] {
  const base = asChangeUnitArtifact(validChangeUnit());
  const make = (id: string, priority: number, provideId: string, requires: ChangeUnitRecord[] = []) => {
    const unit = clone(base);
    unit.change_unit_id = id;
    unit.priority = priority;
    unit.provides = [{ provide_id: provideId, description: `${id} output` }];
    unit.requires = requires as unknown as typeof unit.requires;
    for (const predicate of unit.target_predicates) predicate.provide_ids = [provideId];
    unit.blockers = [];
    return unit;
  };
  const a = make('a-foundation', 10, 'foundation-ready');
  const b = make('b-consumer', 20, 'consumer-ready', [{ require_id: 'need-foundation', from_change_unit_id: 'a-foundation', provide_id: 'foundation-ready' }]);
  const c = make('c-recovery', 30, 'recovery-ready', [{ require_id: 'need-consumer', from_change_unit_id: 'b-consumer', provide_id: 'consumer-ready' }]);
  const d = make('d-summary', 20, 'summary-ready', [{ require_id: 'need-foundation-summary', from_change_unit_id: 'a-foundation', provide_id: 'foundation-ready' }]);
  return [a, b, c, d];
}

function completionAdapter(state: Map<string, ChangeUnitCompletionState>) {
  return {
    projectionExists: (_root: string, feature: string) => (state.get(feature) ?? 'ABSENT') !== 'ABSENT',
    successfulTerminalRunExists: () => false,
    resolveExpected: () => ({ expectedTrack: 'full', expectedChain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] }),
    verify: (input: { feature: string }): CompletionVerdict => {
      const verdict = state.get(input.feature) ?? 'INVALID';
      return { verdict: verdict === 'ABSENT' ? 'INVALID' : verdict, reasons: [`fixture=${verdict}`] };
    },
  };
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  const asynchronous: Array<Promise<UnitCaseResult>> = [];

  results.push(test('canonical CU passes artifact and constructability production entrypoint', () => {
    const result = checkCanonicalChangeUnit(VALID_PROJECT, 'ledger-app-blueprint', 'ledger-refresh');
    assert(result.issues.length === 0, `valid CU 意外失败：${result.issues.map(item => item.id).join(', ')}`);
    assert(result.design?.verdict === 'constructable', 'valid CU 未得到 constructable');
  }));

  results.push(test('canonical fixture set contains dependent vertical CUs, distinct Features, tie candidates and a structured blocker', () => {
    const loaded = enumerateCanonicalChangeUnits(VALID_PROJECT, 'ledger-app-blueprint');
    const units = loaded.map(item => asChangeUnitArtifact(item.changeUnit));
    assert(units.length === 4, `预期 4 个 canonical CU，实际 ${units.length}`);
    const featureIds = new Set(units.map(unit => deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id)));
    assert(featureIds.size === units.length, 'canonical fixtures 的派生 Feature identity 不唯一');
    const consumer = units.find(unit => unit.change_unit_id === 'ledger-consumer')!;
    const recovery = units.find(unit => unit.change_unit_id === 'ledger-recovery')!;
    const summary = units.find(unit => unit.change_unit_id === 'ledger-summary')!;
    assert(consumer.requires[0].from_change_unit_id === 'ledger-refresh' && recovery.requires[0].from_change_unit_id === 'ledger-consumer', 'A→B→C fixture dependency 不完整');
    assert(consumer.priority === summary.priority, '独立 same-priority fixture 缺失');
    assert(summary.blockers.length === 1 && summary.blockers[0].observation === 'human', '当前结构化 blocker fixture 缺失');
    for (const unit of units) {
      const result = checkCanonicalChangeUnit(VALID_PROJECT, 'ledger-app-blueprint', unit.change_unit_id);
      assert(result.issues.length === 0, `${unit.change_unit_id} fixture 未通过生产入口：${result.issues.map(item => item.id).join(',')}`);
    }
  }));

  results.push(test('CU Feature identity is injective, reversible, and cannot be authored', () => {
    const a = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
    const b = deriveChangeUnitFeatureId('ledger-other', 'ledger-refresh');
    assert(a !== b, '跨工作区 Feature id 冲突');
    assert(JSON.stringify(parseChangeUnitFeatureId(a)) === JSON.stringify({ blueprintId: 'ledger-app-blueprint', changeUnitId: 'ledger-refresh' }), 'Feature id 不可逆');
    const cu = validChangeUnit();
    cu.feature_id = a;
    expectIssue(issueIds(cu), 'change_unit_forbidden_authority_field');
  }));

  results.push(test('canonical enumeration is stable, sorted, and ignores non-CU subdirectories', () => {
    withTempProject(projectRoot => {
      const dir = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint');
      // 非 CU 辅助子目录（无 change-unit.yaml）必须忽略
      fs.mkdirSync(path.join(dir, 'notes-dir'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'notes-dir', 'notes.md'), 'not a CU\n', 'utf8');
      // 新 CU 子目录
      const second = validChangeUnit();
      second.change_unit_id = 'aaa-first';
      second.blueprint_id = 'ledger-app-blueprint';
      fs.mkdirSync(path.join(dir, 'aaa-first'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'aaa-first', 'change-unit.yaml'), YAML.stringify(second), 'utf8');
      const ids = enumerateCanonicalChangeUnits(projectRoot, 'ledger-app-blueprint').map(item => item.changeUnit.change_unit_id);
      assert(ids.join(',') === 'aaa-first,ledger-consumer,ledger-recovery,ledger-refresh,ledger-summary', `枚举不稳定：${ids.join(',')}`);
    });
  }));

  results.push(test('path identity and provenance authority mismatches fail closed', () => {
    // M5A：blueprint_id 是路径身份——根 blueprint_id 与目录路径段不一致 → path identity mismatch
    const cu = validChangeUnit();
    cu.blueprint_id = 'other-blueprint';
    expectIssue(issueIds(cu), 'change_unit_path_identity_mismatch');
    // component_id 只做所有权核验：root/owner 不一致 → owner mismatch（fail-closed）
    const ownerCu = validChangeUnit();
    ownerCu.component_id = 'other';
    expectIssue(issueIds(ownerCu), 'change_unit_blueprint_owner_mismatch');
    const providerCu = validChangeUnit();
    (providerCu.provenance as ChangeUnitRecord).source_ref = 'provider:auto-decomposer';
    expectIssue(issueIds(providerCu), 'change_unit_provenance_authority_invalid');
    const selfClaimed = validChangeUnit();
    (selfClaimed.provenance as ChangeUnitRecord).source_ref = 'does-not-exist';
    (selfClaimed.provenance as ChangeUnitRecord).evidence_strength = 'authoritative';
    expectIssue(issueIds(selfClaimed), 'change_unit_provenance_source_unrecognized');
    const acceptedExternal = validChangeUnit();
    (acceptedExternal.provenance as ChangeUnitRecord).source_kind = 'interface';
    (acceptedExternal.provenance as ChangeUnitRecord).source_ref = 'contracts/ledger-api.yaml#/operations/createEntry';
    assert(!issueIds(acceptedExternal).some(id => id.startsWith('change_unit_provenance_')), 'P1 已承认的权威契约来源被误拒');
    const observedAsAuthority = validChangeUnit();
    (observedAsAuthority.provenance as ChangeUnitRecord).source_kind = 'code';
    (observedAsAuthority.provenance as ChangeUnitRecord).source_ref = 'src/ledger/LedgerRepository.ts';
    expectIssue(issueIds(observedAsAuthority), 'change_unit_provenance_authority_invalid');
  }));

  results.push(test('second blueprint ownership and mixed revision refs fail closed', () => {
    const cu = validChangeUnit();
    const ref = (cu.design_refs as ChangeUnitRecord[])[0];
    ref.revision = 1;
    expectIssue(issueIds(cu), 'change_unit_blueprint_identity_mismatch');
    (cu as ChangeUnitRecord).component_blueprint_refs = [cu.component_blueprint_ref];
    expectIssue(issueIds(cu), 'change_unit_schema_invalid');
  }));

  results.push(test('unsafe intermediate state and empty horizontal shell fail closed', () => {
    const unsafe = validChangeUnit();
    (unsafe.safe_intermediate_state as ChangeUnitRecord).recovery_refs = [];
    expectIssue(issueIds(unsafe), 'change_unit_safe_intermediate_state_invalid');
    const shell = validChangeUnit();
    shell.provides = [];
    shell.design_refs = [];
    shell.touches = [];
    shell.target_predicates = [];
    expectIssue(issueIds(shell), 'change_unit_provides_missing');
    expectIssue(issueIds(shell), 'change_unit_design_refs_missing');
  }));

  results.push(test('raw-byte CU ref rejects tampering', () => {
    withTempProject((projectRoot, cuPath) => {
      const loaded = loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh');
      const ref = createChangeUnitRef(loaded);
      fs.appendFileSync(cuPath, '\n# tampered\n', 'utf8');
      let code = '';
      try { resolveChangeUnitRef(projectRoot, ref); } catch (error) { code = (error as ChangeUnitResolutionError).code; }
      assert(code === 'change_unit_identity_mismatch', `tamper 未被 raw-byte hash 捕获：${code}`);
    });
  }));

  results.push(test('derived Feature directory cannot be rebound or silently adopted', () => {
    withTempProject(projectRoot => {
      const featureId = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
      const boundFeatureDir = featureDir(projectRoot, featureId);
      fs.mkdirSync(boundFeatureDir, { recursive: true });
      fs.writeFileSync(path.join(boundFeatureDir, 'contracts.yaml'), YAML.stringify({
        change_unit: {
          change_unit_ref: {
            artifact: 'change-unit@1', component_id: 'ledger', change_unit_id: 'other-unit', revision: 1,
            artifact_sha256: `sha256:${'a'.repeat(64)}`,
          },
        },
      }), 'utf8');
      const ref = createChangeUnitRef(loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh'));
      let code = '';
      try { resolveChangeUnitRef(projectRoot, ref); } catch (error) { code = (error as ChangeUnitResolutionError).code; }
      assert(code === 'change_unit_feature_binding_conflict', `重复 Feature binding 未阻断：${code}`);
    });
  }));

  results.push(test('dangling design ref is rejected by the P1 resolver', () => {
    const cu = validChangeUnit();
    const ref = clone((cu.design_refs as ComponentBlueprintRef[])[0]);
    ref.target.id = 'not-real';
    cu.design_refs = [ref, ...(cu.design_refs as ComponentBlueprintRef[]).slice(1)];
    const result = validateChangeUnitDesign(VALID_PROJECT, cu);
    expectIssue(result.issues.map(item => item.id), 'change_unit_design_ref_unresolvable');
  }));

  results.push(test('omitted scenario address is derived as a closure gap', () => {
    const cu = validChangeUnit();
    cu.design_refs = (cu.design_refs as ComponentBlueprintRef[])
      .filter(ref => !(ref.target.kind === 'node' && ref.target.view_id === 'scenarios'));
    const result = validateChangeUnitDesign(VALID_PROJECT, cu);
    expectIssue(result.issues.map(item => item.id), 'change_unit_design_closure_incomplete');
  }));

  results.push(test('current open decision blocks but unrelated future gap does not', () => {
    const valid = validateChangeUnitDesign(VALID_PROJECT, validChangeUnit());
    assert(valid.verdict === 'constructable', '闭包外 cloud-sync future gap 不应阻塞当前 CU');
    withTempProject((projectRoot, cuPath) => {
      const blueprintPath = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'blueprint', 'component-blueprint.yaml');
      const blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8')) as ChangeUnitRecord;
      const decisions = ((blueprint.decisions_and_gaps as ChangeUnitRecord).decisions as ChangeUnitRecord[]);
      decisions[0].status = 'open_decision';
      fs.writeFileSync(blueprintPath, YAML.stringify(blueprint), 'utf8');
      const cu = YAML.parse(fs.readFileSync(cuPath, 'utf8')) as ChangeUnitRecord;
      rebindBlueprintHash(cu, sha256(blueprintPath));
      fs.writeFileSync(cuPath, YAML.stringify(cu), 'utf8');
      const result = validateChangeUnitDesign(projectRoot, cu);
      assert(result.verdict === 'reconcile_blueprint', `当前 open decision 未回 P1：${result.verdict}`);
    });
  }));

  results.push(test('blueprint hash/schema drift and invalidating construction facts route reconciliation', () => {
    withTempProject(projectRoot => {
      const blueprintPath = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'blueprint', 'component-blueprint.yaml');
      fs.appendFileSync(blueprintPath, '\n# drift\n', 'utf8');
      const result = validateChangeUnitDesign(projectRoot, validChangeUnit());
      expectIssue(result.issues.map(item => item.id), 'change_unit_blueprint_unresolvable');
    });
    const result = validateChangeUnitDesign(VALID_PROJECT, validChangeUnit(), { blueprintInvalidatingFacts: ['host owner changed'] });
    expectIssue(result.issues.map(item => item.id), 'change_unit_blueprint_reconciliation_required');
  }));

  results.push(test('Feature loader and projection accept complete ID-only mappings', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      fixture.contracts.state_management!.push({
        data: 'unrelated-local-state', scope: 'page', decorator: 'none', holder: 'LocalPage', module: 'ledger',
      });
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const loaded = new SpecLoader(
        projectRoot,
        undefined,
        path.join(projectRoot, 'doc', 'features'),
        path.resolve(__dirname, '..', '..', '..'),
      ).loadFeatureSpec(fixture.feature);
      assert(loaded.contracts?.change_unit?.predicate_mappings.length === 6, 'loader 未保留/归一 CU mappings');
      const result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, loaded.contracts, fixture.acceptance, true, 'ut', fixture.dags);
      assert(result.issues.length === 0, `完整施工投影失败：${result.issues.map(item => item.id).join(', ')}`);
      assert(result.useCasesRequired && result.dagRequired, '复杂运行时义务未机械派生');
    });
  }));

  results.push(test('standalone Feature without change_unit_ref keeps existing behavior', () => {
    const standalone = { feature: 'standalone', source: 'fixture', version: '1', modules: [], module_dependencies: {}, data_models: [], interfaces: [], components: [], files: [] } as unknown as ContractsSpec;
    const result = validateChangeUnitFeatureProjection(VALID_PROJECT, 'standalone', standalone, undefined, false, 'plan');
    assert(!result.applicable && result.issues.length === 0, 'standalone Feature 被 P2 强制补 CU/蓝图');
  }));

  results.push(test('stale ref, copied definitions, missing and unknown mappings fail closed', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      (fixture.contracts.change_unit!.change_unit_ref as unknown as ChangeUnitRecord).artifact_sha256 = `sha256:${'f'.repeat(64)}`;
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      let result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, true, 'plan');
      expectIssue(result.issues.map(item => item.id), 'change_unit_identity_mismatch');

      const valid = projectionContracts(projectRoot);
      (valid.contracts.change_unit as unknown as ChangeUnitRecord).purpose = 'copied';
      valid.contracts.change_unit!.predicate_mappings.pop();
      valid.contracts.change_unit!.provide_mappings.push({ provide_id: 'not-real', implementation_refs: ['x'], test_refs: ['y'] });
      bindFeatureContracts(projectRoot, valid.feature, valid.contracts);
      result = validateChangeUnitFeatureProjection(projectRoot, valid.feature, valid.contracts, valid.acceptance, true, 'plan');
      const ids = result.issues.map(item => item.id);
      expectIssue(ids, 'change_unit_definition_copied');
      expectIssue(ids, 'change_unit_predicate_mapping_missing');
      expectIssue(ids, 'change_unit_provide_mapping_unknown');
    });
  }));

  results.push(test('parallel runtime authority and runtime chain gaps fail closed', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      (fixture.contracts as unknown as ChangeUnitRecord).runtime_flow_slices = [];
      const state = fixture.contracts.state_management![0];
      state.publications!.push({ publication_id: 'orphan' });
      state.consumers!.push({ consumer_id: 'orphan' });
      delete state.subscriptions![0].cleanup;
      state.mutations![0].kind = 'background';
      delete state.mutations![0].recovery_ref;
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, true, 'plan');
      const ids = result.issues.map(item => item.id);
      expectIssue(ids, 'change_unit_parallel_runtime_authority');
      expectIssue(ids, 'change_unit_runtime_orphan_publication');
      expectIssue(ids, 'change_unit_runtime_orphan_consumer');
      expectIssue(ids, 'change_unit_runtime_subscription_lifecycle_missing');
      expectIssue(ids, 'change_unit_runtime_background_recovery_missing');
    });
  }));

  results.push(test('construction refs must resolve through safe project paths and real symbols/tests/verifications', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      fixture.contracts.change_unit!.predicate_mappings[0].implementation_refs = ['../outside.ets'];
      fixture.contracts.change_unit!.predicate_mappings[0].test_refs = ['test:not-real'];
      fixture.contracts.change_unit!.provide_mappings[0].implementation_refs = ['src/ledger/LedgerFeature.ets#NotRealSymbol'];
      fixture.contracts.change_unit!.design_ref_mappings[0].verification_refs = ['verify:not-real'];
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const result = validateChangeUnitFeatureProjection(
        projectRoot,
        fixture.feature,
        fixture.contracts,
        fixture.acceptance,
        true,
        'coding',
        fixture.dags,
      );
      const ids = result.issues.map(item => item.id);
      expectIssue(ids, 'change_unit_mapping_path_invalid');
      expectIssue(ids, 'change_unit_mapping_ref_unconsumable');
      expectIssue(ids, 'change_unit_mapping_symbol_missing');
    });
  }));

  results.push(test('runtime construction must preserve P1 stable ids instead of inventing a closed fake chain', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      const state = fixture.contracts.state_management![0];
      state.mutations = [{ mutation_id: 'invented-mutation', kind: 'user', publication_ref: 'publication:invented', recovery_ref: 'recovery:invented' }];
      state.publications = [{ publication_id: 'invented' }];
      state.subscriptions = [{
        subscription_id: 'invented-subscription',
        consumer_ref: 'consumer:invented',
        publication_ref: 'publication:invented',
        replay_or_snapshot: 'latest',
        cleanup: 'detach',
      }];
      state.consumers = [{ consumer_id: 'invented', initial_load_ref: 'initial-load:invented', update_ref: 'publication:invented' }];
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, true, 'plan', fixture.dags);
      expectIssue(result.issues.map(item => item.id), 'change_unit_runtime_stable_id_mismatch');
    });
  }));

  results.push(test('Feature phase projection reuses the current P1 design gate', () => {
    withTempProject((projectRoot, cuPath) => {
      const cu = YAML.parse(fs.readFileSync(cuPath, 'utf8')) as ChangeUnitRecord;
      (cu.design_refs as ComponentBlueprintRef[])[0].target.id = 'not-real-in-current-blueprint';
      fs.writeFileSync(cuPath, YAML.stringify(cu), 'utf8');
      const fixture = projectionContracts(projectRoot);
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, true, 'plan', fixture.dags);
      expectIssue(result.issues.map(item => item.id), 'change_unit_design_ref_unresolvable');
    });
  }));

  results.push(test('mechanically required use-case and DAG cannot be authored away', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts, false);
      let result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, false, 'plan');
      expectIssue(result.issues.map(item => item.id), 'change_unit_use_cases_required');
      result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, true, 'ut', []);
      expectIssue(result.issues.map(item => item.id), 'change_unit_dag_required');
    });
  }));

  results.push(test('unit acceptance with multiple verification steps independently requires a DAG', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      const state = fixture.contracts.state_management![0];
      delete state.ordered_steps;
      delete state.failure_recovery;
      delete state.lifecycle_triggers;
      fixture.acceptance.criteria[0].verification_steps = ['invoke boundary', 'assert observable result'];
      fixture.acceptance.criteria[0].ut_layer = 'unit';
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const result = validateChangeUnitFeatureProjection(
        projectRoot,
        fixture.feature,
        fixture.contracts,
        fixture.acceptance,
        true,
        'ut',
        [],
      );
      assert(result.useCasesRequired, 'acceptance 多步事实未派生 use-case');
      assert(result.dagRequired, 'unit acceptance 多步事实未独立派生 DAG');
      expectIssue(result.issues.map(item => item.id), 'change_unit_dag_required');
    });
  }));

  results.push(test('simple read-only CU does not require fake mutation, subscription, use-case or DAG', () => {
    withTempProject((projectRoot, cuPath) => {
      const source = validChangeUnit();
      source.change_unit_id = 'read-only';
      const blueprintPath = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'blueprint', 'component-blueprint.yaml');
      const blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8')) as ChangeUnitRecord;
      const developmentView = (blueprint.design_views as ChangeUnitRecord[])
        .find(view => view.view_id === 'development')!;
      const isolatedNode = clone((developmentView.nodes as ChangeUnitRecord[])[0]);
      isolatedNode.node_id = 'ledger-read-model';
      isolatedNode.design_basis_refs = ['decision:seam-shape'];
      (developmentView.nodes as ChangeUnitRecord[]).push(isolatedNode);
      fs.writeFileSync(blueprintPath, YAML.stringify(blueprint), 'utf8');
      const developmentRef = (source.design_refs as ComponentBlueprintRef[])
        .find(ref => ref.target.kind === 'node' && ref.target.view_id === 'development')!;
      const decisionRef = (source.design_refs as ComponentBlueprintRef[])
        .find(ref => ref.target.kind === 'decision')!;
      developmentRef.target.id = 'ledger-read-model';
      developmentRef.artifact_sha256 = sha256(blueprintPath);
      decisionRef.artifact_sha256 = developmentRef.artifact_sha256;
      (source.component_blueprint_ref as ComponentBlueprintRef).artifact_sha256 = developmentRef.artifact_sha256;
      source.design_refs = [developmentRef, decisionRef];
      source.touches = [{ owner: 'ledger-team', design_ref: developmentRef, write_refs: ['planned:src/ledger/read.ts'] }];
      const readOnlyDir = path.join(path.dirname(path.dirname(cuPath)), 'read-only');
      fs.mkdirSync(readOnlyDir, { recursive: true });
      fs.writeFileSync(path.join(readOnlyDir, 'change-unit.yaml'), YAML.stringify(source), 'utf8');
      const fixture = projectionContracts(projectRoot, 'read-only');
      fixture.contracts.state_management = [{ data: 'ledger-read', scope: 'page', decorator: 'none', holder: 'LedgerPage', module: 'ledger' }];
      fixture.acceptance.criteria[0].verification_steps = ['read snapshot'];
      fixture.acceptance.criteria[0].description = 'read current snapshot';
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts, false);
      const result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, false, 'ut', []);
      assert(result.issues.length === 0, `read-only 被迫制造流：${result.issues.map(item => `${item.id}:${item.message}`).join(', ')}`);
      assert(!result.useCasesRequired && !result.dagRequired, 'read-only 不应派生复杂流产物');
    });
  }));

  results.push(test('first host evolution seam rejects an empty provider abstraction', () => {
    withTempProject((projectRoot, cuPath) => {
      const blueprintPath = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'blueprint', 'component-blueprint.yaml');
      const blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8')) as BlueprintRecord;
      const decision = (asRecord(blueprint.decisions_and_gaps)!.decisions as BlueprintRecord[])
        .find(item => item.decision_id === 'seam-shape')!;
      decision.human_decision = 'establish_seam';
      decision.closure_proofs = {
        contract_compatibility: 'test/ledger/closure.test.ts#proveSeamContractCompatibility',
        provider_replacement: 'test/ledger/closure.test.ts#proveSeamProviderReplacement',
        absence_failure: 'test/ledger/closure.test.ts#proveSeamAbsenceFailure',
        consumer_no_bypass: 'test/ledger/closure.test.ts#proveSeamConsumerNoBypass',
      };
      decision.tests = Object.values(asRecord(decision.closure_proofs)!);
      fs.writeFileSync(blueprintPath, YAML.stringify(blueprint), 'utf8');
      const cu = YAML.parse(fs.readFileSync(cuPath, 'utf8')) as ChangeUnitRecord;
      const artifactSha256 = sha256(blueprintPath);
      (cu.component_blueprint_ref as ComponentBlueprintRef).artifact_sha256 = artifactSha256;
      for (const ref of cu.design_refs as ComponentBlueprintRef[]) ref.artifact_sha256 = artifactSha256;
      const provider = (cu.target_predicates as ChangeUnitRecord[]).find(item => item.role === 'provider')!;
      provider.description = 'Store';
      fs.writeFileSync(cuPath, YAML.stringify(cu), 'utf8');
      const fixture = projectionContracts(projectRoot);
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const result = validateChangeUnitFeatureProjection(projectRoot, fixture.feature, fixture.contracts, fixture.acceptance, true, 'plan', fixture.dags);
      expectIssue(result.issues.map(item => item.id), 'change_unit_evolution_empty_abstraction');
    });
  }));

  results.push(test('completion adapter distinguishes ABSENT, VALID, STALE and INVALID', () => {
    const unit = asChangeUnitArtifact(validChangeUnit());
    const feature = deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id);
    for (const expected of ['ABSENT', 'VALID', 'STALE', 'INVALID'] as ChangeUnitCompletionState[]) {
      const observation = observeChangeUnitCompletion(VALID_PROJECT, unit, completionAdapter(new Map([[feature, expected]])));
      assert(observation.state === expected, `completion ${expected} 被折叠为 ${observation.state}`);
    }
  }));

  results.push(test('successful terminal Goal run without completion evidence is INVALID, never ABSENT', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const runDir = path.join(featureDir(projectRoot, fixture.feature), 'goal-runs', '20260820T000000Z-a1b2c3');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'manifest.json'), '{}\n', 'utf8');
      fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
        JSON.stringify({ ts: '2026-08-20T00:00:00Z', type: 'run_start' }),
        JSON.stringify({ ts: '2026-08-20T00:01:00Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }),
        '',
      ].join('\n'), 'utf8');
      const observation = observeChangeUnitCompletion(projectRoot, asChangeUnitArtifact(loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh').changeUnit));
      assert(observation.state === 'INVALID', `成功终局缺 completion 被降为 ${observation.state}`);
    });
  }));

  results.push(test('corrupt goal run (started but manifest destroyed) is INVALID with forensic reason, never ABSENT', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const runDir = path.join(featureDir(projectRoot, fixture.feature), 'goal-runs', '20260820T000000Z-c0ffee');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-08-20T00:00:00Z', type: 'run_start' })}\n`, 'utf8');
      const observation = observeChangeUnitCompletion(projectRoot, asChangeUnitArtifact(loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh').changeUnit));
      assert(observation.state === 'INVALID', `corrupt run 被折叠为 ${observation.state}`);
      assert(observation.reasons.some(reason => reason.includes('20260820T000000Z-c0ffee') && reason.includes('损坏')), `corrupt 法证文案缺失：${observation.reasons.join(';')}`);
    });
  }));

  results.push(test('progress loop inspection routes corrupt run to blocked and ignores bootstrap-only residue', () => {
    withTempProject(projectRoot => {
      const unit = asChangeUnitArtifact(loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
      const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
      const runsDir = path.join(featureDir(projectRoot, feature), 'goal-runs');
      const bootstrapDir = path.join(runsDir, '20260820T000001Z-b00t');
      fs.mkdirSync(bootstrapDir, { recursive: true });
      fs.writeFileSync(path.join(bootstrapDir, 'detach.log'), 'bootstrap only\n', 'utf8');
      let inspection = inspectActiveChangeUnitRuns(projectRoot, [unit]);
      assert(inspection.active.length === 0 && inspection.corrupt.length === 0, 'bootstrap-only 残留被误判 active/corrupt');
      const corruptDir = path.join(runsDir, '20260820T000002Z-dead');
      fs.mkdirSync(corruptDir, { recursive: true });
      fs.writeFileSync(path.join(corruptDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-08-20T00:00:00Z', type: 'run_start' })}\n`, 'utf8');
      inspection = inspectActiveChangeUnitRuns(projectRoot, [unit]);
      assert(inspection.corrupt.length === 1 && inspection.corrupt[0].runId === '20260820T000002Z-dead', `corrupt run 未被巡检点名：${JSON.stringify(inspection)}`);
      const state = new Map([[feature, 'ABSENT' as ChangeUnitCompletionState]]);
      const ready = deriveChangeUnitReadySet(projectRoot, 'ledger-app-blueprint', { units: [unit], completion: completionAdapter(state) });
      const decision = deriveChangeUnitProgressionDecision(ready, inspection);
      assert(decision.action === 'blocked', `corrupt run 未阻断推进：${decision.action}`);
      assert(decision.reasons.some(reason => reason.includes('20260820T000002Z-dead') && reason.includes('人工核查该目录')), `blocked 未透传法证文案：${decision.reasons.join(';')}`);
    });
    // 隔离断言：readySet 干净（本会 select_one），blocked 只能来自决策级 corrupt 分支——
    // 防止 completion 侧 corrupt→INVALID 的纵深防御掩护本分支被删。
    const cleanUnits = progressionUnits().slice(0, 1);
    const cleanState = new Map(cleanUnits.map(item => [deriveChangeUnitFeatureId(item.blueprint_id, item.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]));
    const cleanReady = deriveChangeUnitReadySet(VALID_PROJECT, 'ledger-app-blueprint', { units: cleanUnits, completion: completionAdapter(cleanState) });
    assert(cleanReady.ready.length === 1, '隔离前提不成立：干净 readySet 本应恰有一个 ready 候选');
    const isolated = deriveChangeUnitProgressionDecision(cleanReady, {
      active: [],
      corrupt: [{ featureId: 'isolated-feature', runId: 'run-isolated', reason: '目录已有 events/progress/phases 证据但 manifest.json 缺失——曾启动的 run 被破坏' }],
    });
    assert(isolated.action === 'blocked' && isolated.reasons.some(reason => reason.includes('run-isolated') && reason.includes('人工核查该目录')), `决策级 corrupt 分支未独立生效：${isolated.action}:${isolated.reasons.join(';')}`);
  }));

  results.push(test('STALE completion re-enters ready only after current design and Feature mapping revalidate', () => {
    withTempProject(projectRoot => {
      const fixture = projectionContracts(projectRoot);
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      const unit = asChangeUnitArtifact(loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
      const state = new Map([[fixture.feature, 'STALE' as ChangeUnitCompletionState]]);
      let ready = deriveChangeUnitReadySet(projectRoot, 'ledger-app-blueprint', { units: [unit], completion: completionAdapter(state) });
      assert(ready.ready[0]?.change_unit_id === 'ledger-refresh', `已重验 STALE CU 无合法重执行路径：${ready.units[0].blockers.map(item => `${item.id}:${item.message}`).join(',')}`);
      fixture.contracts.change_unit!.change_unit_ref.artifact_sha256 = `sha256:${'f'.repeat(64)}`;
      bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts);
      ready = deriveChangeUnitReadySet(projectRoot, 'ledger-app-blueprint', { units: [unit], completion: completionAdapter(state) });
      assert(ready.ready.length === 0 && ready.units[0].blockers.some(item => item.id === 'change_unit_identity_mismatch'), '未重绑 mapping 的 STALE CU 仍进入 ready');
    });
  }));

  results.push(test('invalid canonical CU never enters ready or completed handoff', () => {
    const unit = clone(progressionUnits()[0]);
    (unit as unknown as ChangeUnitRecord).ready = true;
    const state = new Map([[deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]]);
    const ready = deriveChangeUnitReadySet(VALID_PROJECT, 'ledger-app-blueprint', { units: [unit], completion: completionAdapter(state) });
    assert(ready.ready.length === 0 && !ready.allCompleted, '非法 CU 进入 ready/completed handoff');
    assert(ready.units[0].blockers.some(item => item.id === 'change_unit_forbidden_authority_field'), 'ready 未复用 CU validator');
  }));

  results.push(test('exact dependencies and stable selector preserve independent same-priority candidates', () => {
    const units = progressionUnits();
    const state = new Map(units.map(unit => [deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), unit.change_unit_id === 'a-foundation' ? 'VALID' as const : 'ABSENT' as const]));
    const ready = deriveChangeUnitReadySet(VALID_PROJECT, 'ledger-app-blueprint', { units, completion: completionAdapter(state) });
    assert(ready.ready.map(item => item.change_unit_id).join(',') === 'b-consumer,d-summary', `same-priority ready set 错误：${ready.ready.map(item => item.change_unit_id).join(',')}`);
    assert(selectNextChangeUnit(ready.ready)?.change_unit_id === 'b-consumer', 'selector 未按 priority + stable id');
    const bad = clone(units[1]);
    bad.requires[0].provide_id = 'goal_requires:foundation-ready';
    const dependency = evaluateChangeUnitDependencies(bad, units, ready.completionById, ready.carryForwardById);
    expectIssue(dependency.issues.map(item => item.id), 'change_unit_dependency_provide_mismatch');
  }));

  results.push(test('cycle, legal blocker and silent stall are explicit', () => {
    const units = progressionUnits().slice(0, 3);
    units[0].requires = [{ require_id: 'cycle', from_change_unit_id: 'c-recovery', provide_id: 'recovery-ready' }];
    assert(detectChangeUnitDependencyCycles(units).length === 1, 'dependency cycle 未检出');
    const blocked = clone(units[0]);
    blocked.blockers = [{
      blocker_id: 'approval', gate: 'execution', owner: 'release-owner', reason: 'approval pending',
      unlock_condition: 'approval revision advances', observation: 'human', source_refs: ['approval:ledger'],
      source_revision: 'r1', authority_ref: 'authority:release-owner',
    }];
    assert(deriveChangeUnitBlockers(blocked, { projectRoot: VALID_PROJECT })[0].active, 'human blocker 被自报解除');
    const escaped = clone(progressionUnits()[0]);
    escaped.blockers = [{
      blocker_id: 'escaped-file', gate: 'execution', owner: 'build-owner', reason: 'wait for file',
      unlock_condition: 'project file exists', observation: 'machine', source_refs: ['probe:escaped-file'],
      probe: { kind: 'file_exists', ref: '../../../../../package.json', expected: 'present' },
    }];
    const escapedProbe = deriveChangeUnitBlockers(escaped, { projectRoot: VALID_PROJECT })[0];
    assert(escapedProbe.active && !escapedProbe.legal && escapedProbe.reason.includes('不得包含'), '工程外 file_exists probe 解除了 blocker');
    const escapedState = new Map([[deriveChangeUnitFeatureId(escaped.blueprint_id, escaped.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]]);
    const escapedReady = deriveChangeUnitReadySet(VALID_PROJECT, 'ledger-app-blueprint', {
      units: [escaped], completion: completionAdapter(escapedState),
    });
    assert(escapedReady.ready.length === 0, '工程外 file_exists probe 使 CU 进入 ready');
    assert(isSilentProgressStall({ unfinishedPredicateCount: 1, readyCount: 0, legalBlockerCount: 0 }), 'silent_progress_stall 未识别');
  }));

  results.push(test('completed provides carry forward only while every historical target remains admitted', () => {
    const current = evaluateChangeUnitCarryForward(VALID_PROJECT, asChangeUnitArtifact(validChangeUnit()));
    assert(current.allowed, `当前 targets 不应失效：${current.reasons.join(';')}`);
    const replaced = asChangeUnitArtifact(validChangeUnit());
    replaced.design_refs[0].target.id = 'replaced-stable-id';
    const stale = evaluateChangeUnitCarryForward(VALID_PROJECT, replaced);
    assert(!stale.allowed && stale.reasons.some(reason => reason.includes('不可解析')), '替换/缺失 target 未路由 P1');
  }));

  results.push(test('carry-forward preserves historical blueprint identity across current blueprint replacement', () => {
    withTempProject(projectRoot => {
      const historical = asChangeUnitArtifact(validChangeUnit());
      const blueprintPath = path.join(projectRoot, 'doc', 'features', 'ledger-app-blueprint', 'blueprint', 'component-blueprint.yaml');
      const blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8')) as ChangeUnitRecord;
      blueprint.blueprint_id = 'replacement-blueprint';
      fs.writeFileSync(blueprintPath, YAML.stringify(blueprint), 'utf8');
      const verdict = evaluateChangeUnitCarryForward(projectRoot, historical);
      // M5A：in-place 改根 blueprint_id 触发 loader 的 path↔yaml blueprint 身份校验（fail-closed）
      assert(!verdict.allowed && verdict.reasons.some(reason => reason.includes('blueprint identity 不一致')),
        'carry-forward 擅自把历史 ref 改绑到 replacement blueprint');
    });
  }));

  results.push(test('CU revision drift stales future mapping without rewriting completed history', () => {
    withTempProject((projectRoot, cuPath) => {
      const before = fs.readFileSync(cuPath, 'utf8');
      const loaded = loadCanonicalChangeUnit(projectRoot, 'ledger-app-blueprint', 'ledger-refresh');
      const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
      const contracts = projectionContracts(projectRoot).contracts;
      bindFeatureContracts(projectRoot, feature, contracts);
      const next = clone(loaded.changeUnit);
      next.revision = 2;
      fs.writeFileSync(cuPath, YAML.stringify(next), 'utf8');
      const observation = observeChangeUnitCompletion(projectRoot, asChangeUnitArtifact(next), {
        ...completionAdapter(new Map([[feature, 'VALID']])), projectionExists: () => true,
      });
      assert(observation.state === 'STALE', `CU revision drift 未使未来 mapping stale：${observation.state}`);
      assert(before.includes('revision: 1'), 'fixture 历史基线意外被改写');
    });
  }));

  results.push(test('Provider evolution consumes decision ref and exact require, never priority or Consumer prose', () => {
    const base = asChangeUnitArtifact(validChangeUnit());
    const decisionRef = base.design_refs.find(ref => ref.target.kind === 'decision')!;
    const decision = clone(resolveComponentBlueprintRef(VALID_PROJECT, decisionRef).target as BlueprintRecord);
    decision.human_decision = 'establish_seam';
    base.provides.push({ provide_id: 'ledger-data-source-contract', description: 'Stable LedgerDataSource contract.' });
    const baseContract = base.target_predicates.find(item => item.role === 'contract')!;
    baseContract.provide_ids = ['ledger-data-source-contract'];
    const later = clone(base);
    later.change_unit_id = 'cloud-ledger-provider';
    later.priority = -100;
    later.requires = [{ require_id: 'stable-contract', from_change_unit_id: 'ledger-refresh', provide_id: 'ledger-data-source-contract' }];
    later.target_predicates = [clone(later.target_predicates.find(item => item.role === 'provider')!)];
    later.target_predicates[0].description = 'Description changes do not establish sequence';
    const issues = validateChangeUnitEvolutionSeam(later, decisionRef, decision, [base]);
    assert(issues.length === 0, `精确 require 的 later Provider 被 priority/描述启发式误判：${issues.map(item => item.id).join(',')}`);
    const validDependency = evaluateChangeUnitDependencies(
      later,
      [base, later],
      new Map([[base.change_unit_id, { state: 'VALID', featureId: 'base', reasons: [] }]]),
      new Map([[base.change_unit_id, { allowed: true, reasons: [] }]]),
    );
    assert(validDependency.issues.length === 0, `合法 contract provide 依赖被误拒：${validDependency.issues.map(item => item.id).join(',')}`);

    const unrelated = asChangeUnitArtifact(loadCanonicalChangeUnit(VALID_PROJECT, 'ledger-app-blueprint', 'ledger-summary').changeUnit);
    later.requires = [{ require_id: 'unrelated-output', from_change_unit_id: 'ledger-summary', provide_id: 'ledger-summary-ready' }];
    expectIssue(
      validateChangeUnitEvolutionSeam(later, decisionRef, decision, [unrelated]).map(item => item.id),
      'change_unit_evolution_contract_requirement_invalid',
    );
    const invalidDependency = evaluateChangeUnitDependencies(
      later,
      [unrelated, later],
      new Map([[unrelated.change_unit_id, { state: 'VALID', featureId: 'summary', reasons: [] }]]),
      new Map([[unrelated.change_unit_id, { allowed: true, reasons: [] }]]),
    );
    assert(invalidDependency.issues.length === 0, '通用 dependency checker 不应重复推断 evolution 语义');

    const ordinaryDecisionRef = clone(decisionRef);
    ordinaryDecisionRef.target.id = 'deployment-na';
    const ordinaryDecision = resolveComponentBlueprintRef(VALID_PROJECT, ordinaryDecisionRef).target as BlueprintRecord;
    const ordinary = clone(later);
    ordinary.change_unit_id = 'ordinary-ledger-provider';
    ordinary.requires = [{ require_id: 'ordinary-contract', from_change_unit_id: 'ledger-refresh', provide_id: 'ledger-data-source-contract' }];
    ordinary.design_refs = ordinary.design_refs.map(ref => ref.target.kind === 'decision' ? clone(ordinaryDecisionRef) : ref);
    const ordinaryPath = path.join(VALID_PROJECT, 'doc', 'features', 'ledger-app-blueprint', 'ordinary-ledger-provider', 'change-unit.yaml');
    assert(validateChangeUnit(ordinary, { projectRoot: VALID_PROJECT, canonicalPath: ordinaryPath }).length === 0, '非 evolution Provider CU artifact 非法');
    assert(validateChangeUnitDesign(VALID_PROJECT, ordinary as unknown as ChangeUnitRecord).issues.length === 0, '非 evolution Provider CU design 非法');
    assert(validateChangeUnitEvolutionSeam(ordinary, ordinaryDecisionRef, ordinaryDecision, [base]).length === 0, '非 evolution decision 被 seam 误判');
    const ordinaryDependency = evaluateChangeUnitDependencies(
      ordinary,
      [base, ordinary],
      new Map([[base.change_unit_id, { state: 'VALID', featureId: 'base', reasons: [] }]]),
      new Map([[base.change_unit_id, { allowed: true, reasons: [] }]]),
    );
    assert(ordinaryDependency.issues.length === 0, `非 evolution 精确依赖被误挡：${ordinaryDependency.issues.map(item => item.id).join(',')}`);
  }));

  results.push(test('keep_direct evolution candidate follows ordinary CU rules without seam roles', () => {
    const base = asChangeUnitArtifact(validChangeUnit());
    const decisionRef = base.design_refs.find(ref => ref.target.kind === 'decision')!;
    const decision = resolveComponentBlueprintRef(VALID_PROJECT, decisionRef).target as BlueprintRecord;
    assert(decision.human_decision === 'keep_direct', 'fixture 必须锁定 keep_direct');
    base.target_predicates = base.target_predicates.filter(item => item.role === 'behavior');
    const issues = validateChangeUnitEvolutionSeam(base, decisionRef, decision, []);
    assert(issues.length === 0, `keep_direct 被错误要求接缝纵切：${issues.map(item => item.id).join(',')}`);
  }));

  results.push(test('selector uses Unicode code-point order rather than locale collation', () => {
    const [first, second] = progressionUnits();
    first.priority = second.priority = 10;
    first.change_unit_id = 'Z-unit';
    second.change_unit_id = 'a-unit';
    assert(selectNextChangeUnit([second, first])?.change_unit_id === 'Z-unit', 'tie-break 未按 code-point 升序');
  }));

  asynchronous.push(asyncTest('fake Goal Mode advances A to B to C one at a time and rereads completion', async () => {
    const units = progressionUnits().slice(0, 3);
    const state = new Map(units.map(unit => [deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]));
    const calls: string[] = [];
    const result = await runChangeUnitProgression(VALID_PROJECT, 'ledger-app-blueprint', {
      ready: { units, completion: completionAdapter(state) },
      inspectActiveRuns: () => ({ active: [], corrupt: [] }),
      buildHandoff: (_root, unit): ChangeUnitGoalHandoff => ({
        featureId: deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id),
        canonicalPath: `fixture:${unit.change_unit_id}`,
        changeUnitRef: { artifact: 'change-unit@1', component_id: unit.component_id, blueprint_id: unit.blueprint_id, change_unit_id: unit.change_unit_id, revision: unit.revision, artifact_sha256: `sha256:${'a'.repeat(64)}` },
        componentBlueprintRef: unit.component_blueprint_ref,
        expectedTrack: 'full', expectedChain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], requirement: unit.purpose,
      }),
      caller: async handoff => {
        calls.push(handoff.featureId);
        state.set(handoff.featureId, 'VALID');
        return { status: 'completed' };
      },
    });
    assert(calls.map(feature => parseChangeUnitFeatureId(feature).changeUnitId).join(',') === 'a-foundation,b-consumer,c-recovery', `推进顺序错误：${calls.join(',')}`);
    assert(result.action === 'ready_for_component_closure', `末态不应宣称 closure，仅应 handoff：${result.action}`);
  }));

  asynchronous.push(asyncTest('caller completed without VALID completion stops as no-progress', async () => {
    const units = progressionUnits().slice(0, 1);
    const state = new Map(units.map(unit => [deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]));
    let calls = 0;
    const result = await runChangeUnitProgression(VALID_PROJECT, 'ledger-app-blueprint', {
      ready: { units, completion: completionAdapter(state) },
      inspectActiveRuns: () => ({ active: [], corrupt: [] }),
      buildHandoff: (_root, unit) => ({
        featureId: deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), canonicalPath: 'fixture',
        changeUnitRef: { artifact: 'change-unit@1', component_id: unit.component_id, blueprint_id: unit.blueprint_id, change_unit_id: unit.change_unit_id, revision: 1, artifact_sha256: `sha256:${'a'.repeat(64)}` },
        componentBlueprintRef: unit.component_blueprint_ref, expectedTrack: 'full', expectedChain: ['spec'], requirement: unit.purpose,
      }),
      caller: async () => { calls++; return { status: 'completed' }; },
    });
    assert(calls === 1, `无完成事实时同一 CU 被重复调用 ${calls} 次`);
    assert(result.action === 'blocked' && result.reasons.some(reason => reason.includes('change_unit_no_progress_after_completed')), '无进展 completed 未 fail-closed 停止');
  }));

  asynchronous.push(asyncTest('pause or active run suppresses every second CU', async () => {
    const units = progressionUnits().slice(0, 3);
    const state = new Map(units.map(unit => [deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]));
    let calls = 0;
    const result = await runChangeUnitProgression(VALID_PROJECT, 'ledger-app-blueprint', {
      ready: { units, completion: completionAdapter(state) }, inspectActiveRuns: () => ({ active: [], corrupt: [] }),
      buildHandoff: (_root, unit) => ({
        featureId: deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), canonicalPath: 'fixture',
        changeUnitRef: { artifact: 'change-unit@1', component_id: unit.component_id, blueprint_id: unit.blueprint_id, change_unit_id: unit.change_unit_id, revision: 1, artifact_sha256: `sha256:${'a'.repeat(64)}` },
        componentBlueprintRef: unit.component_blueprint_ref, expectedTrack: 'full', expectedChain: ['spec'], requirement: unit.purpose,
      }),
      caller: async () => { calls++; return { status: 'paused', runId: 'run-a', reason: 'device waiting' }; },
    });
    assert(calls === 1 && result.action === 'resume_active', 'pause 后启动了第二 CU');
    const ready = deriveChangeUnitReadySet(VALID_PROJECT, 'ledger-app-blueprint', { units, completion: completionAdapter(state) });
    assert(deriveChangeUnitProgressionDecision(ready, { active: [{ featureId: 'active', runId: 'run-active' }], corrupt: [] }).action === 'resume_active', 'active run 未优先恢复');
  }));

  asynchronous.push(asyncTest('failure and awaiting-human both stop before a second CU', async () => {
    for (const status of ['failed', 'awaiting_human'] as const) {
      const units = progressionUnits().slice(0, 3);
      const state = new Map(units.map(unit => [deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), 'ABSENT' as ChangeUnitCompletionState]));
      let calls = 0;
      const result = await runChangeUnitProgression(VALID_PROJECT, 'ledger-app-blueprint', {
        ready: { units, completion: completionAdapter(state) }, inspectActiveRuns: () => ({ active: [], corrupt: [] }),
        buildHandoff: (_root, unit) => ({
          featureId: deriveChangeUnitFeatureId(unit.blueprint_id, unit.change_unit_id), canonicalPath: 'fixture',
          changeUnitRef: { artifact: 'change-unit@1', component_id: unit.component_id, blueprint_id: unit.blueprint_id, change_unit_id: unit.change_unit_id, revision: 1, artifact_sha256: `sha256:${'a'.repeat(64)}` },
          componentBlueprintRef: unit.component_blueprint_ref, expectedTrack: 'full', expectedChain: ['spec'], requirement: unit.purpose,
        }),
        caller: async () => { calls++; return { status, runId: `run-${status}`, reason: status }; },
      });
      assert(calls === 1, `${status} 后启动了第二 CU`);
      assert(result.action === (status === 'failed' ? 'blocked' : 'resume_active'), `${status} 的恢复动作错误：${result.action}`);
    }
  }));

  results.push(test('static provider boundary fails closed on missing/duplicate authority and exit drops candidates only', () => {
    const valid = validateChangeUnitProviderBoundary();
    assert(valid.ok, `内置静态 providers 不合法：${valid.blockers.join(',')}`);
    const conflict = validateChangeUnitProviderBoundary([
      { seam: 'relation_ready_analysis', providerId: 'a', authoritative: true, available: true },
      { seam: 'relation_ready_analysis', providerId: 'b', authoritative: true, available: true },
      { seam: 'candidate_selection', providerId: 'selector', authoritative: true, available: false },
    ]);
    assert(conflict.blockers.some(item => item.includes('authority_conflict')) && conflict.blockers.some(item => item.includes('provider_missing')), 'required provider 冲突/缺失未 fail-closed');
    const candidates = [{ providerId: 'temporary', artifact: asChangeUnitArtifact(validChangeUnit()) }];
    assert(dropUnacceptedChangeUnitCandidates(candidates).length === 0 && candidates.length === 1, 'provider exit 修改了正式/输入 artifact');
  }));

  results.push(test('change-unit-progression Skill resolves through the existing skills index', () => {
    clearSkillsIndexCache();
    const resolved = resolveSkillPath(path.resolve(__dirname, '..', '..', '..'), 'change-unit-progression');
    assert(resolved.skillMdFrameworkRel === 'skills/project/change-unit-progression/SKILL.md', `Skill 未接入索引：${resolved.skillMdFrameworkRel}`);
  }));

  results.push(test('consumer validation, not decomposition provider, accepts a canonical candidate', () => {
    withTempProject(projectRoot => {
      const candidate = asChangeUnitArtifact(validChangeUnit());
      candidate.change_unit_id = 'accepted-candidate';
      candidate.provenance.extraction_method = 'builtin-vertical-slice-decomposition + consumer-validation';
      const accepted = acceptChangeUnitCandidate(projectRoot, { providerId: 'builtin-vertical-slice-decomposition', artifact: candidate });
      assert(accepted.changeUnit.change_unit_id === 'accepted-candidate' && fs.existsSync(accepted.canonicalPath), 'consumer 未写 canonical CU');
      assert(candidate.provenance.source_ref.includes('component-blueprint.yaml'), 'provider 冒充了权威来源');
    });
  }));

  const negativeBundle = YAML.parse(fs.readFileSync(path.join(CHANGE_UNIT_FIXTURES, 'negative-cases.yaml'), 'utf8')) as {
    cases: Array<{ id: string; surface: 'artifact' | 'design' | 'projection'; mutator: string; expected_issue: string }>;
  };
  for (const fixtureCase of negativeBundle.cases) {
    results.push(test(`negative fixture: ${fixtureCase.id}`, () => {
      if (fixtureCase.surface === 'artifact') {
        const cu = validChangeUnit();
        if (fixtureCase.mutator === 'authored-ready') cu.ready = true;
        if (fixtureCase.mutator === 'self-claimed-provenance') (cu.provenance as ChangeUnitRecord).source_ref = 'does-not-exist';
        if (fixtureCase.mutator === 'unsafe-intermediate') (cu.safe_intermediate_state as ChangeUnitRecord).recovery_refs = [];
        if (fixtureCase.mutator === 'mixed-revision') (cu.design_refs as ChangeUnitRecord[])[0].revision = 1;
        expectIssue(issueIds(cu), fixtureCase.expected_issue);
        return;
      }
      if (fixtureCase.surface === 'design') {
        const cu = validChangeUnit();
        if (fixtureCase.mutator === 'dangling-design') (cu.design_refs as ComponentBlueprintRef[])[0].target.id = 'not-real';
        if (fixtureCase.mutator === 'omit-scenario') {
          cu.design_refs = (cu.design_refs as ComponentBlueprintRef[])
            .filter(ref => !(ref.target.kind === 'node' && ref.target.view_id === 'scenarios'));
        }
        const result = validateChangeUnitDesign(VALID_PROJECT, cu);
        expectIssue(result.issues.map(item => item.id), fixtureCase.expected_issue);
        return;
      }
      withTempProject((projectRoot, cuPath) => {
        if (fixtureCase.mutator === 'vertical-role-missing') {
          const cu = YAML.parse(fs.readFileSync(cuPath, 'utf8')) as ChangeUnitRecord;
          cu.target_predicates = (cu.target_predicates as ChangeUnitRecord[]).filter(item => item.role !== 'recovery');
          fs.writeFileSync(cuPath, YAML.stringify(cu), 'utf8');
        }
        const fixture = projectionContracts(projectRoot);
        let featureName = fixture.feature;
        let useCasesPresent = true;
        let phase: 'plan' | 'ut' = 'plan';
        let dags = fixture.dags;
        if (fixtureCase.mutator === 'copied-definition') (fixture.contracts.change_unit as unknown as ChangeUnitRecord).purpose = 'copied';
        if (fixtureCase.mutator === 'parallel-runtime') (fixture.contracts as unknown as ChangeUnitRecord).runtime_flow_slices = [];
        if (fixtureCase.mutator === 'missing-use-case') useCasesPresent = false;
        if (fixtureCase.mutator === 'acceptance-multistep-missing-dag') {
          const state = fixture.contracts.state_management![0];
          delete state.ordered_steps;
          delete state.failure_recovery;
          delete state.lifecycle_triggers;
          fixture.acceptance.criteria[0].verification_steps = ['invoke boundary', 'assert observable result'];
          fixture.acceptance.criteria[0].ut_layer = 'unit';
          phase = 'ut';
          dags = [];
        }
        if (fixtureCase.mutator === 'unsafe-construction-path') {
          fixture.contracts.change_unit!.predicate_mappings[0].implementation_refs = ['../outside.ets'];
        }
        if (fixtureCase.mutator === 'missing-construction-symbol') {
          fixture.contracts.change_unit!.provide_mappings[0].implementation_refs = ['src/ledger/LedgerFeature.ets#NotRealSymbol'];
        }
        if (fixtureCase.mutator === 'missing-construction-test') {
          fixture.contracts.change_unit!.predicate_mappings[0].test_refs = ['test/ledger/NotReal.test.ets'];
        }
        if (fixtureCase.mutator === 'missing-construction-verification') {
          fixture.contracts.change_unit!.design_ref_mappings[0].verification_refs = ['test/ledger/NotReal.verify.ets'];
        }
        if (fixtureCase.mutator === 'invented-runtime-chain') {
          const state = fixture.contracts.state_management![0];
          state.mutations = [{ mutation_id: 'invented-mutation', kind: 'user', publication_ref: 'publication:invented', recovery_ref: 'recovery:invented' }];
          state.publications = [{ publication_id: 'invented' }];
          state.subscriptions = [{
            subscription_id: 'invented-subscription', consumer_ref: 'consumer:invented',
            publication_ref: 'publication:invented', replay_or_snapshot: 'latest', cleanup: 'detach',
          }];
          state.consumers = [{ consumer_id: 'invented', initial_load_ref: 'initial-load:invented', update_ref: 'publication:invented' }];
        }
        if (fixtureCase.mutator === 'planned-impl-ref-at-ut') {
          fixture.contracts.change_unit!.predicate_mappings[0].implementation_refs = ['planned:src/ledger/Planned.ets'];
          phase = 'ut';
        }
        if (fixtureCase.mutator === 'duplicate-predicate-mapping') {
          fixture.contracts.change_unit!.predicate_mappings.push(clone(fixture.contracts.change_unit!.predicate_mappings[0]));
        }
        if (fixtureCase.mutator === 'unknown-predicate-mapping') {
          fixture.contracts.change_unit!.predicate_mappings.push({
            predicate_id: 'not-real', implementation_refs: ['src/ledger/LedgerFeature.ets'], test_refs: ['test/ledger/LedgerFeature.test.ets'],
          });
        }
        if (fixtureCase.mutator === 'incomplete-predicate-mapping') fixture.contracts.change_unit!.predicate_mappings[0].test_refs = [];
        if (fixtureCase.mutator === 'duplicate-provide-mapping') {
          fixture.contracts.change_unit!.provide_mappings.push(clone(fixture.contracts.change_unit!.provide_mappings[0]));
        }
        if (fixtureCase.mutator === 'missing-provide-mapping') fixture.contracts.change_unit!.provide_mappings = [];
        if (fixtureCase.mutator === 'incomplete-provide-mapping') fixture.contracts.change_unit!.provide_mappings[0].implementation_refs = [];
        if (fixtureCase.mutator === 'missing-design-mapping') {
          fixture.contracts.change_unit!.design_ref_mappings = fixture.contracts.change_unit!.design_ref_mappings.slice(1);
        }
        if (fixtureCase.mutator === 'duplicate-design-mapping') {
          fixture.contracts.change_unit!.design_ref_mappings.push(clone(fixture.contracts.change_unit!.design_ref_mappings[0]));
        }
        if (fixtureCase.mutator === 'unknown-design-mapping') {
          const foreign = clone(fixture.contracts.change_unit!.design_ref_mappings[0]);
          (foreign.design_ref as unknown as ChangeUnitRecord & { target: { id: string } }).target.id = 'not-real-address';
          fixture.contracts.change_unit!.design_ref_mappings.push(foreign);
        }
        if (fixtureCase.mutator === 'incomplete-design-mapping') fixture.contracts.change_unit!.design_ref_mappings[0].verification_refs = [];
        if (fixtureCase.mutator === 'unresolvable-mutation-publication') {
          fixture.contracts.state_management![0].mutations![0].publication_ref = 'publication:not-declared';
        }
        if (fixtureCase.mutator === 'publication-chain-open') {
          const state = fixture.contracts.state_management![0];
          delete state.consumers![0].update_ref;
          delete state.subscriptions![0].publication_ref;
        }
        if (fixtureCase.mutator === 'flow-state-mapping-missing') fixture.contracts.state_management = [];
        if (fixtureCase.mutator === 'owner-contract-missing') delete fixture.contracts.state_management![0].owner_ref;
        if (fixtureCase.mutator === 'runtime-fact-mapping-missing') fixture.contracts.state_management![0].mutations = [];
        if (fixtureCase.mutator === 'propagation-edge-mismatch') {
          fixture.contracts.state_management![0].subscriptions![0].publication_ref = 'publication:stale-alias';
        }
        if (fixtureCase.mutator === 'unknown-projection-field') {
          (fixture.contracts.change_unit as unknown as ChangeUnitRecord).surplus_field = true;
        }
        if (fixtureCase.mutator === 'feature-identity-mismatch') featureName = 'cu-not-the-derived-identity';
        if (fixtureCase.mutator === 'dag-use-case-link-missing') dags = [{ dag: { branches: [] } }];
        bindFeatureContracts(projectRoot, fixture.feature, fixture.contracts, useCasesPresent);
        const result = validateChangeUnitFeatureProjection(projectRoot, featureName, fixture.contracts, fixture.acceptance, useCasesPresent, phase, dags);
        expectIssue(result.issues.map(item => item.id), fixtureCase.expected_issue);
      });
    }));
  }

  results.push(...await Promise.all(asynchronous));
  return results;
}
