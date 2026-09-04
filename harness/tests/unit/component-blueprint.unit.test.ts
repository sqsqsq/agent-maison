import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  BlueprintRecord,
  ComponentBlueprintRef,
  ComponentBlueprintResolutionError,
  asRecord,
  asRecords,
} from '../../scripts/utils/component-blueprint-model';
import {
  componentBlueprintPath,
  loadCanonicalBlueprint,
  resolveComponentBlueprintRef,
} from '../../scripts/utils/component-blueprint-path';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { renderBlueprintReviewMarkdown } from '../../scripts/utils/blueprint-review-projection';
import { generateMermaidViewGraph } from '../../scripts/utils/blueprint-graph-generator';
import { buildDiscoveryBundle } from '../../scripts/utils/blueprint-discovery';
import { reconcileP1DerivedResults } from '../../scripts/utils/blueprint-reconciliation';
import { downstreamRefNeedsRecompute } from '../../scripts/utils/derived-conclusion-freshness';
import { requiredQuestioningScopes, unchangedViewQuestioningScopes } from '../../scripts/utils/blueprint-questioning';
import { isApplicableView, isChangedView } from '../../scripts/utils/blueprint-views';
import { validateRuntimeDataFlows } from '../../scripts/utils/runtime-data-flow-check';
import { checkCanonicalComponentBlueprint, resolveCliRefTarget } from '../../scripts/check-component-blueprint';
import { clearSkillsIndexCache, resolveSkillPath } from '../../scripts/utils/resolve-skill-path';
import { clearFrameworkConfigCache } from '../../config';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIXTURE_ROOT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint');
const VALID_PROJECT = path.join(FIXTURE_ROOT, 'valid');
const VALID_PATH = path.join(VALID_PROJECT, 'doc', 'features', 'ledger-app-blueprint', 'blueprint', 'component-blueprint.yaml');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readYaml(filePath: string): BlueprintRecord {
  return YAML.parse(fs.readFileSync(filePath, 'utf8')) as BlueprintRecord;
}

function validBlueprint(): BlueprintRecord {
  return readYaml(VALID_PATH);
}

function validateFixture(blueprint: BlueprintRecord) {
  return validateComponentBlueprint(blueprint, { projectRoot: VALID_PROJECT, canonicalPath: VALID_PATH });
}

function findView(blueprint: BlueprintRecord, viewId: string): BlueprintRecord {
  const view = asRecords(blueprint.design_views).find(item => item.view_id === viewId);
  if (!view) throw new Error(`test fixture 缺 view=${viewId}`);
  return view;
}

function runtimeFlow(blueprint: BlueprintRecord): BlueprintRecord {
  const flow = asRecords(findView(blueprint, 'runtime').runtime_data_flows)[0];
  if (!flow) throw new Error('test fixture 缺 runtime flow');
  return flow;
}

/**
 * 让某个 applicable 视图成为**合法**的 verified_unchanged：清除视图级与节点级的本次 delta、
 * 交出不变依据，并把该 scope 的质询项对齐为核实该依据。
 *
 * 返修后 view-level 与 node-level 各判一次，正向用例必须两级都真正清干净——只抹节点的旧写法
 * 现在会（正确地）失败。
 */
function makeViewVerifiedUnchanged(blueprint: BlueprintRecord, viewId: string, evidenceRefs = ['src/ledger']): void {
  const view = findView(blueprint, viewId);
  view.evolution_impact = 'verified_unchanged';
  view.unchanged_evidence = { evidence_refs: [...evidenceRefs], current_state_ref: evidenceRefs[0]! };
  // view-level：本次无 delta
  view.target_state = view.current_state;
  view.delta = 'none';
  // node-level：本次无 delta
  for (const node of asRecords(view.nodes)) {
    node.target_state = node.current_state;
    node.delta = 'none';
  }
  alignUnchangedQuestioning(blueprint, `view:${viewId}`, evidenceRefs);
}

/** 把某 scope 的质询项对齐为"以该视图交出的不变依据核实"。 */
function alignUnchangedQuestioning(blueprint: BlueprintRecord, scopeRef: string, evidenceRefs: string[]): void {
  const questioning = asRecord(asRecord(blueprint.review_summary)?.questioning);
  const item = asRecords(questioning?.items).find(entry => entry.scope_ref === scopeRef);
  if (!item) return;
  item.disposition = 'answered_with_evidence';
  item.evidence_refs = [...evidenceRefs];
}

function mutate(blueprint: BlueprintRecord, mutator: string): void {
  const contract = asRecords(blueprint.contracts)[0];
  const scenario = asRecords(findView(blueprint, 'scenarios').nodes)[0];
  const developmentNode = asRecords(findView(blueprint, 'development').nodes)[0];
  const flow = runtimeFlow(blueprint);
  const subscription = asRecords(flow.subscriptions)[0];
  const mutation = asRecords(flow.mutations)[0];
  const questioning = asRecord(asRecord(blueprint.review_summary)?.questioning);
  const gap = asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps)[0];
  const evolutionDecision = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)
    .find(item => item.kind === 'evolution_candidate')!;
  const derivedResult = asRecords(blueprint.derived_results)[0];
  const scopeItems = asRecords(asRecord(asRecord(blueprint.discovery)?.inputs)?.current_scope_items);
  const traceMappings = asRecords(asRecord(blueprint.discovery)?.requirement_traceability);
  switch (mutator) {
    case 'yaml-component-id': blueprint.component_id = 'other-component'; break;
    case 'yaml-blueprint-id': blueprint.blueprint_id = 'other-blueprint'; break;
    case 'remove-logical-view': blueprint.design_views = asRecords(blueprint.design_views).filter(view => view.view_id !== 'logical'); break;
    case 'remove-scenario-owner': delete scenario.development_owner_ref; break;
    case 'remove-runtime-logical-contract': flow.logical_contract_refs = []; break;
    case 'remove-development-design-basis': developmentNode.design_basis_refs = []; break;
    case 'dangling-design-basis-ref': developmentNode.design_basis_refs = ['view:logical/node:not-real']; break;
    case 'dangling-view-decision-ref': findView(blueprint, 'logical').decisions_and_gaps = ['decision:not-real']; break;
    case 'remove-deployment-na-evidence': delete findView(blueprint, 'deployment').applicability_evidence; break;
    case 'remove-contract-mappings': contract.mappings = []; break;
    case 'nullable-mapping-conflict': {
      const parentMapping = asRecords(contract.mappings).find(item => item.mapping_id === 'request-parent-level')!;
      parentMapping.assumes_non_null = true;
      break;
    }
    case 'fabricate-wire-field': asRecords(contract.mappings)[0].source_fields = ['invented_wire_field']; break;
    case 'enable-same-shape-diff': contract.validation_mode = 'wire_domain_same_shape_diff'; break;
    case 'remove-node-provenance': delete asRecords(findView(blueprint, 'logical').nodes)[0].provenance; break;
    case 'add-owner-conflict': blueprint.semantic_conflicts = [{ kind: 'state_owner', status: 'open' }]; break;
    case 'contract-authority-mismatch': asRecords(asRecord(contract.request_dto)?.fields)[0].semantics = 'fabricated amount meaning'; break;
    case 'contract-authority-source-missing': asRecord(contract.operation)!.source_ref = 'contracts/missing-ledger-api.yaml#/operations/createEntry'; break;
    case 'source-fingerprint-self-reported': blueprint.source_fingerprint = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'; break;
    case 'empty-applicable-views': {
      for (const view of asRecords(blueprint.design_views).filter(item => item.applicability === 'applicable')) {
        view.current_state = 'unknown';
        view.target_state = 'unknown';
        view.delta = 'unknown';
        view.nodes = [];
      }
      blueprint.relations = [];
      break;
    }
    case 'remove-initial-load-strategy': delete asRecord(flow.initial_load)!.strategy; break;
    case 'remove-mutation-publication': delete mutation.publication_ref; break;
    case 'remove-subscription-snapshot': delete subscription.replay_or_snapshot; break;
    case 'background-without-recovery': mutation.kind = 'background'; delete mutation.recovery_ref; break;
    case 'remove-subscription-cleanup': delete subscription.cleanup; break;
    case 'empty-runtime-flow-content': {
      for (const field of ['triggers', 'mutations', 'publications', 'subscriptions', 'consumers', 'evidence_refs', 'verification_refs']) flow[field] = [];
      break;
    }
    case 'dangling-runtime-local-refs': {
      mutation.publication_ref = 'publication:missing';
      mutation.recovery_ref = 'recovery:missing';
      subscription.consumer_ref = 'consumer:missing';
      const consumer = asRecords(flow.consumers)[0];
      consumer.initial_load_ref = 'initial-load:missing';
      consumer.update_ref = 'publication:missing';
      break;
    }
    case 'duplicate-runtime-local-id': flow.publications = [...asRecords(flow.publications), clone(asRecords(flow.publications)[0])]; break;
    case 'orphan-mutation-publication': {
      const publication = clone(asRecords(flow.publications)[0]);
      publication.publication_id = 'unconsumed-ledger-change';
      flow.publications = [...asRecords(flow.publications), publication];
      mutation.publication_ref = 'publication:unconsumed-ledger-change';
      break;
    }
    case 'orphan-consumer': {
      const consumer = clone(asRecords(flow.consumers)[0]);
      consumer.consumer_id = 'orphan-ledger-consumer';
      delete consumer.initial_load_ref;
      delete consumer.update_ref;
      flow.consumers = [...asRecords(flow.consumers), consumer];
      break;
    }
    case 'dangling-cross-view-refs': {
      scenario.logical_refs = ['contract:missing'];
      scenario.runtime_refs = ['view:runtime/flow:missing'];
      scenario.development_owner_ref = 'view:development/node:missing';
      asRecords(blueprint.relations)[0].to = 'view:runtime/node:missing';
      flow.logical_contract_refs = ['contract:missing'];
      flow.external_contract_refs = ['contract:missing'];
      flow.development_owner_ref = 'view:development/node:missing';
      asRecord(flow.source_of_truth)!.authority = 'view:runtime/node:missing';
      break;
    }
    case 'duplicate-flow-conflicting-owner': {
      const second = clone(flow);
      second.flow_id = 'ledger-refresh-flow-2';
      (second.state_owner as BlueprintRecord).ref = 'view:runtime/node:ledger-store';
      findView(blueprint, 'runtime').runtime_data_flows = [flow, second];
      break;
    }
    case 'remove-runtime-trigger-assessment-item': {
      delete asRecord(asRecord(blueprint.app_lens)?.runtime_flow_trigger_assessment)!.persistent_or_remote_ui;
      break;
    }
    case 'remove-flow-while-triggered': findView(blueprint, 'runtime').runtime_data_flows = []; break;
    case 'all-runtime-triggers-false-without-na': {
      const assessment = asRecord(asRecord(blueprint.app_lens)?.runtime_flow_trigger_assessment)!;
      for (const entry of Object.values(assessment)) asRecord(entry)!.applies = false;
      const runtime = findView(blueprint, 'runtime');
      runtime.runtime_data_flows = [];
      delete runtime.runtime_data_flow_disposition;
      break;
    }
    case 'questioning-writer-provider': questioning!.provider_id = asRecord(blueprint.review_summary)!.authored_by; break;
    case 'remove-questioning': delete asRecord(blueprint.review_summary)!.questioning; break;
    case 'remove-questioning-scope': questioning!.items = asRecords(questioning!.items).slice(0, -1); break;
    case 'remove-current-facts-provider': blueprint.providers = asRecords(blueprint.providers).filter(provider => provider.provider_id !== 'current-facts-discovery'); break;
    case 'remove-conventions-provider': blueprint.providers = asRecords(blueprint.providers).filter(provider => provider.provider_id !== 'conventions-knowledge'); break;
    case 'claim-conventions-available-without-file': {
      const provider = asRecords(blueprint.providers).find(item => item.provider_id === 'conventions-knowledge')!;
      provider.available = true;
      delete provider.missing_disposition;
      break;
    }
    case 'disable-contract-provider-without-disposition': {
      const provider = asRecords(blueprint.providers).find(item => item.provider_id === 'se-manual-contracts')!;
      provider.requirement = 'optional';
      provider.available = false;
      delete provider.missing_disposition;
      break;
    }
    case 'exceed-frontier-budget': questioning!.repeated_frontier_count = 3; questioning!.frontier_budget = 2; break;
    case 'erase-unknown-with-na': gap.status = 'not_applicable'; break;
    case 'remove-future-gap-owner': delete gap.owner; break;
    case 'provider-writes-p2-ready': asRecords(blueprint.providers)[0].writes = ['p2_ready_set']; break;
    case 'duplicate-authority-provider': blueprint.providers = [...asRecords(blueprint.providers), clone(asRecords(blueprint.providers)[0])]; break;
    case 'conditional-provider': asRecords(blueprint.providers)[1].requirement = 'conditional'; break;
    case 'tamper-provider-authority': asRecords(blueprint.providers)[0].authority_rule = 'Blueprint author is authority.'; break;
    case 'tamper-conventions-authority': asRecords(blueprint.providers).find(item => item.provider_id === 'conventions-knowledge')!.authority_rule = 'Model inference is authority.'; break;
    case 'remove-evolution-evidence': evolutionDecision.variation_evidence = []; break;
    case 'remove-evolution-impact': delete evolutionDecision.impact; break;
    case 'remove-evolution-reextract-condition': delete evolutionDecision.reextract_condition; break;
    case 'move-evolution-to-maison-namespace': evolutionDecision.namespace = 'goal_requires'; break;
    case 'evolution-human-decision-unknown': evolutionDecision.human_decision = 'defer_to_next_release'; break;
    case 'duplicate-current-scope-item':
      asRecord(asRecord(blueprint.discovery)!.inputs)!.current_scope_items = [...scopeItems, clone(scopeItems[0])];
      break;
    case 'current-scope-provenance-mismatch': asRecord(scopeItems[0].provenance)!.source_ref = 'requirements/other.md#REQ-OTHER'; break;
    case 'duplicate-traceability-mapping':
      asRecord(blueprint.discovery)!.requirement_traceability = [...traceMappings, clone(traceMappings[0])];
      break;
    case 'traceability-extra-item':
      asRecord(blueprint.discovery)!.requirement_traceability = [
        ...traceMappings,
        { item_id: 'not-a-current-scope-item', blueprint_refs: ['view:runtime/flow:ledger-refresh-flow'] },
      ];
      break;
    case 'traceability-empty-refs': traceMappings[0].blueprint_refs = []; break;
    case 'traceability-dangling-ref': traceMappings[0].blueprint_refs = ['view:logical/node:not-real']; break;
    case 'establish-seam-missing-proof': {
      evolutionDecision.human_decision = 'establish_seam';
      evolutionDecision.closure_proofs = {
        contract_compatibility: 'test/ledger/closure.test.ts#proveSeamContractCompatibility',
        provider_replacement: 'test/ledger/closure.test.ts#proveSeamProviderReplacement',
        absence_failure: 'test/ledger/closure.test.ts#proveSeamAbsenceFailure',
      };
      evolutionDecision.tests = Object.values(evolutionDecision.closure_proofs as Record<string, string>);
      break;
    }
    case 'establish-seam-aliased-proofs': {
      const aliased = 'test/ledger/closure.test.ts#proveSeamContractCompatibility';
      evolutionDecision.human_decision = 'establish_seam';
      evolutionDecision.closure_proofs = {
        contract_compatibility: aliased, provider_replacement: aliased, absence_failure: aliased, consumer_no_bypass: aliased,
      };
      evolutionDecision.tests = [aliased];
      break;
    }
    case 'establish-seam-proof-outside-tests': {
      evolutionDecision.human_decision = 'establish_seam';
      evolutionDecision.closure_proofs = {
        contract_compatibility: 'test/ledger/closure.test.ts#proveSeamContractCompatibility',
        provider_replacement: 'test/ledger/closure.test.ts#proveSeamProviderReplacement',
        absence_failure: 'test/ledger/closure.test.ts#proveSeamAbsenceFailure',
        consumer_no_bypass: 'test/ledger/closure.test.ts#proveSeamConsumerNoBypass',
      };
      evolutionDecision.tests = Object.values(evolutionDecision.closure_proofs as Record<string, string>).slice(0, 3);
      break;
    }
    case 'keep-mismatched-derived-current': derivedResult.input_revision = 1; derivedResult.status = 'current'; break;
    case 'stale-derived-without-superseding': derivedResult.status = 'stale'; delete derivedResult.superseded_by_revision; break;
    case 'remove-derived-result-id': delete derivedResult.result_id; break;
    case 'add-p2-ready-set': blueprint.p2_ready_set = { status: 'ready' }; break;
    // ---- M7：applicability × evolution_impact 正交 ----
    case 'remove-evolution-impact-field':
      delete findView(blueprint, 'logical').evolution_impact;
      break;
    case 'evolution-impact-on-not-applicable-view':
      findView(blueprint, 'deployment').evolution_impact = 'changed';
      break;
    case 'all-views-verified-unchanged': {
      for (const view of asRecords(blueprint.design_views).filter(item => item.applicability === 'applicable')) {
        makeViewVerifiedUnchanged(blueprint, String(view.view_id), ['src/ledger/LedgerRepository.ts']);
      }
      break;
    }
    case 'verified-unchanged-without-evidence': {
      const view = findView(blueprint, 'development');
      makeViewVerifiedUnchanged(blueprint, 'development');
      delete view.unchanged_evidence;
      break;
    }
    case 'verified-unchanged-masks-change': {
      const view = findView(blueprint, 'development');
      view.evolution_impact = 'verified_unchanged';
      view.unchanged_evidence = {
        evidence_refs: ['src/ledger'],
        current_state_ref: 'src/ledger',
      };
      // 视图与节点都仍声明 current≠target 的本次 delta：不变声明掩盖真实变化
      break;
    }
    case 'verified-unchanged-masks-view-level-change': {
      // P0-1 返修反例：把**节点**全部抹平，但**视图自身**仍宣告 current≠target 与实质 delta。
      // 只有节点级检查时这条会假绿（且 runtime 还会因此跳过六类 flow 触发条件）。
      const view = findView(blueprint, 'development');
      view.evolution_impact = 'verified_unchanged';
      view.unchanged_evidence = { evidence_refs: ['src/ledger'], current_state_ref: 'src/ledger' };
      for (const node of asRecords(view.nodes)) {
        node.target_state = node.current_state;
        node.delta = 'none';
      }
      alignUnchangedQuestioning(blueprint, 'view:development', ['src/ledger']);
      break;
    }
    case 'verified-unchanged-questioning-not-verified': {
      makeViewVerifiedUnchanged(blueprint, 'development');
      const item = asRecords(questioning!.items).find(entry => entry.scope_ref === 'view:development')!;
      item.disposition = 'not_applicable';
      break;
    }
    case 'verified-unchanged-questioning-unrelated-evidence': {
      // P0-1 返修反例：以 answered_with_evidence 作答，但引用的证据与该视图交出的不变依据无交集。
      makeViewVerifiedUnchanged(blueprint, 'development');
      const item = asRecords(questioning!.items).find(entry => entry.scope_ref === 'view:development')!;
      item.evidence_refs = ['test/ledger/totally-unrelated.test.ts'];
      break;
    }
    default: throw new Error(`未知 mutator：${mutator}`);
  }
}

interface FixtureCase {
  id: string;
  mutator: string;
  expected_issue: string;
}

function readCases(file: string): FixtureCase[] {
  return (YAML.parse(fs.readFileSync(path.join(FIXTURE_ROOT, file), 'utf8')) as { cases: FixtureCase[] }).cases;
}

function makeRef(artifactSha256: string, target: ComponentBlueprintRef['target']): ComponentBlueprintRef {
  return {
    artifact: 'component-blueprint@1',
    component_id: 'ledger',
    blueprint_id: 'ledger-app-blueprint',
    revision: 2,
    source_fingerprint: String(validBlueprint().source_fingerprint),
    artifact_sha256: artifactSha256,
    target,
  };
}

function withTempProject(run: (projectRoot: string, filePath: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-blueprint-'));
  const projectRoot = path.join(tempRoot, 'project');
  fs.cpSync(VALID_PROJECT, projectRoot, { recursive: true });
  const filePath = componentBlueprintPath(projectRoot, 'ledger-app-blueprint');
  try { run(projectRoot, filePath); } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

function test(name: string, run: () => void): UnitCaseResult {
  try {
    run();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: (error as Error).stack ?? (error as Error).message };
  }
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  // M5A §7.4：同一 component_id 的两个 blueprint_id 工作区共存，互不覆盖、无可见副作用（proof 1）
  results.push(test('two workspaces of the same component coexist without overwriting (proof 1)', () => {
    withTempProject((projectRoot, filePath) => {
      const blueprint = readYaml(filePath);
      // 第二工作区 = 同 component_id、新 blueprint_id、同布局副本
      const secondBpId = 'ledger-app-blueprint-v2';
      const secondDir = path.join(projectRoot, 'doc', 'features', secondBpId, 'blueprint');
      fs.mkdirSync(secondDir, { recursive: true });
      const beforeFirst = fs.readFileSync(filePath);
      const second = clone(blueprint);
      second.blueprint_id = secondBpId;
      second.revision = 3;
      const secondPath = path.join(secondDir, 'component-blueprint.yaml');
      fs.writeFileSync(secondPath, YAML.stringify(second), 'utf8');
      // 双工作区各自解析、字节互不覆盖
      const first = loadCanonicalBlueprint(projectRoot, 'ledger-app-blueprint');
      const loadedSecond = loadCanonicalBlueprint(projectRoot, secondBpId);
      assert(String(first.blueprint.blueprint_id) === 'ledger-app-blueprint', '第一工作区被第二工作区覆盖');
      assert(String(loadedSecond.blueprint.blueprint_id) === secondBpId, '第二工作区解析失败');
      assert(String(loadedSecond.blueprint.component_id) === String(blueprint.component_id), '同一 component_id 未保留');
      assert(fs.readFileSync(filePath).equals(beforeFirst), '解析第二工作区不得改写第一工作区字节');
      assert(componentBlueprintPath(projectRoot, secondBpId).replace(/\\/g, '/')
        .endsWith(`/doc/features/${secondBpId}/blueprint/component-blueprint.yaml`), '第二工作区路径错误');
    });
  }));

  // M5A review：CLI 组合入口反例——`--blueprint` 与 `--ref` 跨工作区混用必须失败
  results.push(test('CLI --blueprint and --ref must bind the same blueprint_id (cross-workspace mix FAIL)', () => {
    withTempProject((projectRoot, filePath) => {
      // 第二工作区（同 component_id、新 blueprint_id）
      const secondBpId = 'ledger-app-blueprint-v2';
      const secondDir = path.join(projectRoot, 'doc', 'features', secondBpId, 'blueprint');
      fs.mkdirSync(secondDir, { recursive: true });
      const second = clone(readYaml(filePath));
      second.blueprint_id = secondBpId;
      second.revision = 3;
      fs.writeFileSync(path.join(secondDir, 'component-blueprint.yaml'), YAML.stringify(second), 'utf8');
      // 合法 A 工作区 ref（artifact_sha256 按 A 字节）
      const loadedA = loadCanonicalBlueprint(projectRoot, 'ledger-app-blueprint');
      const refA = {
        artifact: 'component-blueprint@1', component_id: 'ledger', blueprint_id: 'ledger-app-blueprint',
        revision: Number(loadedA.blueprint.revision), source_fingerprint: String(loadedA.blueprint.source_fingerprint),
        artifact_sha256: loadedA.artifactSha256, target: { kind: 'blueprint', id: 'ledger-app-blueprint' },
      };
      // 同工作区绑定：resolveCliRefTarget 正常返回 target
      assert(resolveCliRefTarget(projectRoot, 'ledger-app-blueprint', refA) !== undefined, '同工作区 ref 绑定被误拒');
      // 跨工作区混用：--blueprint A + ref 指向 B → 必须失败并携带两值
      const refB = { ...refA, blueprint_id: secondBpId, target: { kind: 'blueprint', id: secondBpId } };
      let code = '';
      let message = '';
      try {
        resolveCliRefTarget(projectRoot, 'ledger-app-blueprint', refB);
      } catch (error) {
        code = (error as ComponentBlueprintResolutionError).code;
        message = (error as Error).message;
      }
      assert(code === 'component_blueprint_ref_mismatch', `跨工作区 ref 未 fail：code=${code}`);
      assert(message.includes('ledger-app-blueprint') && message.includes(secondBpId), `诊断应报告 A/B 两值：${message}`);
    });
  }));

  results.push(test('canonical fixture passes all P1 completeness checks', () => {
    const issues = validateFixture(validBlueprint());
    assert(issues.length === 0, issues.map(item => `[${item.id}] ${item.path}: ${item.message}`).join('\n'));
  }));

  results.push(test('canonical path is workspace-owned and rejects arbitrary path identities', () => {
    assert(componentBlueprintPath('C:/project', 'ledger-app-blueprint').replace(/\\/g, '/')
      .endsWith('/doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml'), 'canonical path 错误');
    for (const id of ['', '..', 'a/b', 'a\\b']) {
      let failed = false;
      try { componentBlueprintPath('C:/project', id); } catch { failed = true; }
      assert(failed, `非法 blueprint_id 应失败：${JSON.stringify(id)}`);
    }
  }));

  results.push(test('resolver separates source fingerprint from artifact hash and resolves all target kinds', () => {
    const loaded = loadCanonicalBlueprint(VALID_PROJECT, 'ledger-app-blueprint');
    assert(loaded.artifactSha256 !== loaded.blueprint.source_fingerprint, 'source_fingerprint 不得复用 artifact_sha256');
    const targets: ComponentBlueprintRef['target'][] = [
      { kind: 'blueprint', id: 'ledger-app-blueprint' },
      { kind: 'view', id: 'logical' },
      { kind: 'node', id: 'ledger-domain', view_id: 'logical' },
      { kind: 'relation', id: 'domain-owned-by-module' },
      { kind: 'flow', id: 'ledger-refresh-flow', view_id: 'runtime' },
      { kind: 'decision', id: 'seam-shape' },
      { kind: 'contract', id: 'create-entry-v1' },
    ];
    for (const target of targets) {
      assert(resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, target)).target, `target 未解析：${target.kind}`);
    }
  }));

  results.push(test('node and flow require view_id while decision and contract keep it optional', () => {
    const loaded = loadCanonicalBlueprint(VALID_PROJECT, 'ledger-app-blueprint');
    let nodeFailed = false;
    try {
      resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, { kind: 'node', id: 'ledger-domain' }));
    } catch { nodeFailed = true; }
    assert(nodeFailed, 'node 缺 view_id 应失败');
    assert(resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, { kind: 'decision', id: 'seam-shape' })).target, 'decision 顶层寻址失败');
    assert(resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, { kind: 'contract', id: 'create-entry-v1' })).target, 'contract 顶层寻址失败');
  }));

  results.push(test('path YAML and ref blueprint/component identity mismatch fails closed with identities', () => {
    withTempProject((projectRoot, filePath) => {
      const blueprint = readYaml(filePath);
      blueprint.component_id = 'other-component';
      fs.writeFileSync(filePath, YAML.stringify(blueprint), 'utf8');
      const loaded = loadCanonicalBlueprint(projectRoot, 'ledger-app-blueprint');
      let message = '';
      try { resolveComponentBlueprintRef(projectRoot, makeRef(loaded.artifactSha256, { kind: 'blueprint', id: 'ledger-app-blueprint' })); } catch (error) { message = (error as Error).message; }
      // M5A §4.1：blueprint_id 三方（path/yaml/ref）+ component_id 两方（yaml/ref）
      assert(message.includes('yaml=other-component') && message.includes('ref=ledger'), `身份诊断不完整：${message}`);
    });
  }));

  results.push(test('resolver rejects a hash-matching blueprint that fails canonical completeness', () => {
    withTempProject((projectRoot, filePath) => {
      const blueprint = readYaml(filePath);
      delete blueprint.design_views;
      fs.writeFileSync(filePath, YAML.stringify(blueprint), 'utf8');
      const loaded = loadCanonicalBlueprint(projectRoot, 'ledger-app-blueprint');
      let message = '';
      try { resolveComponentBlueprintRef(projectRoot, makeRef(loaded.artifactSha256, { kind: 'blueprint', id: 'ledger-app-blueprint' })); } catch (error) { message = (error as Error).message; }
      assert(message.includes('component_blueprint_invalid') || message.includes('canonical blueprint 未通过'), `非法 canonical blueprint 不应被解析：${message}`);
    });
  }));

  results.push(test('app-component-blueprint is discoverable through the existing skill index SSOT', () => {
    const frameworkDir = path.resolve(__dirname, '..', '..', '..');
    clearSkillsIndexCache();
    const resolved = resolveSkillPath(frameworkDir, 'app-component-blueprint');
    assert(resolved.skillMdFrameworkRel === 'skills/project/app-component-blueprint/SKILL.md', `skill 路径错误：${resolved.skillMdFrameworkRel}`);
    assert(fs.existsSync(path.join(frameworkDir, resolved.skillMdFrameworkRel)), '索引指向的 SKILL.md 不存在');
  }));

  results.push(test('conventions provider distinguishes disabled, explicit-unreadable, and readable paths', () => {
    withTempProject((projectRoot, filePath) => {
      const blueprint = readYaml(filePath);
      const provider = asRecords(blueprint.providers).find(item => item.provider_id === 'conventions-knowledge')!;
      fs.writeFileSync(
        path.join(projectRoot, 'framework.config.json'),
        JSON.stringify({ paths: { conventions: 'doc/custom-conventions.md' } }),
        'utf8',
      );
      clearFrameworkConfigCache();
      let issues = validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: filePath });
      assert(issues.some(item => item.id === 'blueprint_conventions_provider_unreadable'), '显式不可读路径不得按 not_applicable 洗白');

      fs.mkdirSync(path.join(projectRoot, 'doc'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'doc', 'custom-conventions.md'), '# 工程惯例\n', 'utf8');
      clearFrameworkConfigCache();
      issues = validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: filePath });
      assert(issues.some(item => item.id === 'blueprint_conventions_provider_availability_mismatch'), '可读文件不得仍标 unavailable');

      provider.available = true;
      delete provider.missing_disposition;
      issues = validateComponentBlueprint(blueprint, { projectRoot, canonicalPath: filePath });
      assert(!issues.some(item => item.id.startsWith('blueprint_conventions_provider_')), '可读文件 + available=true 应通过 provider 语义');
      clearFrameworkConfigCache();
    });
  }));

  results.push(test('review Markdown is a one-way derived projection with full binding', () => {
    const loaded = loadCanonicalBlueprint(VALID_PROJECT, 'ledger-app-blueprint');
    const markdown = renderBlueprintReviewMarkdown(loaded.blueprint, loaded.artifactSha256);
    for (const expected of [
      'derived_from:',
      'component_id: ledger',
      'blueprint_id: ledger-app-blueprint',
      `artifact_sha256: ${loaded.artifactSha256}`,
      '## Design views',
      '- Current:',
      '- Target:',
      '- Delta:',
      '## Runtime data flows',
      '## Authority contracts',
      '## Cross-view relations',
      '## Independent questioning',
      '## Admission',
      'Derived projection only',
    ]) {
      assert(markdown.includes(expected), `projection 缺 ${expected}`);
    }
    const fixtureProjection = fs.readFileSync(path.join(path.dirname(VALID_PATH), 'component-blueprint.review.md'), 'utf8');
    assert(fixtureProjection === markdown, '评审 Markdown fixture 必须由 canonical YAML 确定性派生');
  }));

  results.push(test('generated graph parser is conditional and cannot replace structured completeness', () => {
    const noGraph = validBlueprint();
    delete noGraph.generated_graphs;
    assert(!validateFixture(noGraph).some(item => item.id.startsWith('blueprint_generated_graph')), '未生成图不应失败');
    const graph = generateMermaidViewGraph(validBlueprint(), 'runtime');
    assert(graph.content.includes('flowchart TD') && graph.node_refs.length === 2, '图生成器未保留节点引用');
    const incomplete = validBlueprint();
    asRecords(runtimeFlow(incomplete).subscriptions)[0].cleanup = '';
    assert(validateFixture(incomplete).some(item => item.id === 'runtime_flow_subscription_lifecycle_missing'), '图可解析不得掩盖结构缺口');
  }));

  results.push(test('read-only initial-load flow does not fabricate mutation publication or subscription', () => {
    const readOnly = validBlueprint();
    const flow = runtimeFlow(readOnly);
    flow.triggers = [{ kind: 'cold_start', timing: 'before-first-render', idempotency: 'replace by repository revision' }];
    flow.mutations = [];
    flow.publications = [];
    flow.subscriptions = [];
    delete asRecords(flow.consumers)[0].update_ref;
    const runtimeIssues = validateFixture(readOnly).filter(item => item.id.startsWith('runtime_flow_'));
    assert(runtimeIssues.length === 0, `只读首次加载流不应伪造写入链：${runtimeIssues.map(item => item.id).join(', ')}`);
  }));

  results.push(test('questioning scopes include applicable views and exclude evidence-backed not-applicable views', () => {
    const scopes = requiredQuestioningScopes(validBlueprint());
    assert(scopes.has('view:logical') && scopes.has('view:runtime') && scopes.has('view:development') && scopes.has('view:scenarios'), '适用视图必须进入质询范围');
    assert(!scopes.has('view:deployment'), 'not_applicable deployment 不应成为强制质询 scope');
  }));

  // M7 正向：一个带事实依据的 verified_unchanged 视图合法通过，且**仍进入质询 scope**
  // （旧行为按字面 applicability 判断也会通过；这里用 unchangedViewQuestioningScopes 与
  // 质询义务收紧证明消费面确实被接线，不是只改了 schema）。
  results.push(test('M7: an evidence-backed verified_unchanged view passes and is still questioned', () => {
    const blueprint = validBlueprint();
    // 合法 verified_unchanged：**视图级与节点级都**真正无本次 delta，并交出不变依据，
    // 质询项以该依据核实（返修后两级各判一次，只抹节点不再算合法）。
    makeViewVerifiedUnchanged(blueprint, 'development', ['src/ledger/LedgerRepository.ts']);
    const development = findView(blueprint, 'development');
    const issues = validateFixture(blueprint);
    const blockers = issues.filter(item => item.severity === 'BLOCKER').map(item => item.id);
    assert(blockers.length === 0, `合法 verified_unchanged 视图被误拒：${blockers.join(', ')}`);

    // 消费面①质询：verified_unchanged 视图仍在必答 scope 内，且被单列为"核实不变声明"义务
    const scopes = requiredQuestioningScopes(blueprint);
    assert(scopes.get('view:development') === 'view', 'verified_unchanged 视图被质询 scope 静默跳过');
    const unchangedScopes = unchangedViewQuestioningScopes(blueprint);
    assert(unchangedScopes.has('view:development'), 'verified_unchanged 视图未进入不变声明核实义务集');
    assert(
      (unchangedScopes.get('view:development') ?? []).includes('src/ledger/LedgerRepository.ts'),
      '核实义务未携带该视图声明的不变依据，无法校验"核实的是这份依据"',
    );

    // 消费面②runtime：runtime 仍是 changed，六类触发条件继续评估
    assert(isChangedView(findView(blueprint, 'runtime')), 'runtime 视图应仍为 changed');
    assert(!isChangedView(development), 'development 视图应为 verified_unchanged');
    assert(isApplicableView(development), 'verified_unchanged 仍然是 applicable —— 两维度正交');
  }));

  // M7 正向：runtime=verified_unchanged 时，六类 flow 触发条件本次不评估
  results.push(test('M7: runtime verified_unchanged skips the six trigger-condition obligations', () => {
    const blueprint = validBlueprint();
    makeViewVerifiedUnchanged(blueprint, 'runtime', ['src/ledger/LedgerStore.ts']);
    const runtime = findView(blueprint, 'runtime');
    // 故意删掉一条触发条件裁决：runtime=changed 时这必然 BLOCKER
    delete asRecord(asRecord(blueprint.app_lens)?.runtime_flow_trigger_assessment)!.persistent_or_remote_ui;
    const ids = validateRuntimeDataFlows(blueprint).map(item => item.id);
    assert(!ids.includes('runtime_flow_trigger_assessment_missing'), `runtime=verified_unchanged 不应再要求逐条触发裁决：${ids.join(', ')}`);

    // 对照：同一删除在 runtime=changed 下必须 BLOCKER（证明这条断言不是恒真）
    const changed = validBlueprint();
    delete asRecord(asRecord(changed.app_lens)?.runtime_flow_trigger_assessment)!.persistent_or_remote_ui;
    assert(
      validateRuntimeDataFlows(changed).some(item => item.id === 'runtime_flow_trigger_assessment_missing'),
      'runtime=changed 下删除触发裁决必须仍然 BLOCKER',
    );
  }));

  results.push(test('current-scope source validation without projectRoot context fails closed', () => {
    const issues = validateComponentBlueprint(validBlueprint(), { canonicalPath: VALID_PATH });
    assert(
      issues.some(item => item.id === 'blueprint_current_scope_source_context_missing'),
      `缺 projectRoot 上下文未 fail-closed：${issues.map(item => item.id).join(', ')}`,
    );
  }));

  for (const fixtureFile of [
    'failure-cases.yaml',
    'runtime-break-cases.yaml',
    'provider-admission-cases.yaml',
    'evolution-cases.yaml',
    'reconciliation-validator-cases.yaml',
  ]) {
    for (const fixtureCase of readCases(fixtureFile)) {
      results.push(test(`${fixtureFile}: ${fixtureCase.id}`, () => {
        if (fixtureCase.mutator === 'yaml-component-id' || fixtureCase.mutator === 'yaml-blueprint-id') {
          withTempProject((projectRoot, filePath) => {
            const blueprint = readYaml(filePath);
            mutate(blueprint, fixtureCase.mutator);
            fs.writeFileSync(filePath, YAML.stringify(blueprint), 'utf8');
            // M5A review：身份失败原样抛 ComponentBlueprintResolutionError（CLI catch 出口），
            // 不构造伪造的成功形状——fixture 断言错误码/诊断。
            let errorCode = '';
            let message = '';
            try {
              checkCanonicalComponentBlueprint(projectRoot, 'ledger-app-blueprint');
            } catch (error) {
              errorCode = (error as ComponentBlueprintResolutionError).code;
              message = (error as Error).message;
            }
            assert(errorCode === fixtureCase.expected_issue, `缺期望诊断 ${fixtureCase.expected_issue}；实际 errorCode=${errorCode}`);
            assert(message.includes('blueprint identity 不一致'), `诊断应含三方身份信息：${message}`);
          });
          return;
        }
        const blueprint = validBlueprint();
        mutate(blueprint, fixtureCase.mutator);
        const issues = validateFixture(blueprint);
        assert(issues.some(item => item.id === fixtureCase.expected_issue), `缺期望诊断 ${fixtureCase.expected_issue}；实际 ${issues.map(item => item.id).join(', ')}`);
      }));
    }
  }

  results.push(test('discovery keeps conflicting facts and computes a deterministic source fingerprint', () => {
    const input = {
      assertion_id: 'owner-code', subject: 'ledger.owner', value: 'Repository', source_kind: 'code', source_ref: 'src/repo.ts',
      observed_at: '2026-08-19T10:00:00+08:00', evidence_strength: 'observed' as const, extraction_method: 'static-inspection',
    };
    const bundle = buildDiscoveryBundle([input, { ...input, assertion_id: 'owner-doc', value: 'Store', source_kind: 'document', source_ref: 'docs/design.md' }]);
    assert(asRecords(bundle.conflicts).length === 1, '冲突事实被静默覆盖');
    assert(String(bundle.source_fingerprint).startsWith('sha256:'), 'source fingerprint 缺失');
  }));

  results.push(test('decision flip stales every affected P1 conclusion without owning downstream state', () => {
    const fixture = YAML.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'reconciliation-cases.yaml'), 'utf8')) as {
      cases: Array<{ result_kind: string; expected_after: string }>;
      downstream_mismatch_fields: string[];
    };
    const oldResults = fixture.cases.map((item, index) => ({
      result_id: `old-${index}`,
      kind: item.result_kind,
      status: 'current',
      input_revision: 1,
      source_fingerprint: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      decision_fingerprint: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    }));
    const reconciled = reconcileP1DerivedResults(
      oldResults,
      2,
      'sha256:e7139f2fef7d7b3dbfcdb04931e729e50eac8f8df2b9dc6efa16f40eb5d21a25',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    assert(reconciled.every(result => result.status === 'stale' && result.superseded_by_revision === 2), '旧 P1 结论残留为 current');
    const downstream = { revision: 1, source_fingerprint: oldResults[0].source_fingerprint, artifact_sha256: 'sha256:old' };
    assert(downstreamRefNeedsRecompute(downstream, { revision: 2, source_fingerprint: 'sha256:new', artifact_sha256: 'sha256:new-artifact' }), '下游 mismatch 应自行重派生');
    assert(!reconciled.some(result => ['p2_ready_set', 'p3_closure'].includes(String(result.kind))), 'P1 不得生成下游状态');
  }));

  results.push(test('P1 release semantics fixture keeps whole-repo release gates delegated', () => {
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'release-semantics.json'), 'utf8')) as {
      plan_name_contains: string;
      expected_version: string;
      require_unfinished_todos: boolean;
      required_delegation_phrases: string[];
      forbidden_p1_commands: string[];
    };
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const plansDir = path.join(repoRoot, '.cursor', 'plans');
    const planName = fs.readdirSync(plansDir).find(name => name.includes(expected.plan_name_contains));
    assert(planName, 'P1 plan 未找到');
    const plan = fs.readFileSync(path.join(plansDir, planName), 'utf8');
    const tasks = fs.readFileSync(path.join(repoRoot, 'openspec', 'changes', 'app-component-blueprint-and-reconciliation', 'tasks.md'), 'utf8');
    const releaseContract = `${plan}\n${tasks}`;
    assert(plan.includes(`version: ${expected.expected_version}`), 'P1 plan 窗口版本不符');
    assert(!expected.require_unfinished_todos || /status:\s*(pending|in_progress)|- \[ \] 6\.6/.test(releaseContract), 'P1 应保留委托给 m5/MG 的未完成 release 门');
    for (const phrase of expected.required_delegation_phrases) assert(releaseContract.includes(phrase), `缺 release 委托声明：${phrase}`);
    for (const command of expected.forbidden_p1_commands) {
      assert(releaseContract.includes(command), `委托命令未显式披露：${command}`);
    }
    assert(/6\.6[^\n]*整仓[\s\S]*?P1 不执行、不勾选、不宣称/.test(tasks), 'tasks 未冻结 release 边界');
  }));

  return results;
}
