import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  BlueprintRecord,
  ComponentBlueprintRef,
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
import { requiredQuestioningScopes } from '../../scripts/utils/blueprint-questioning';
import { checkCanonicalComponentBlueprint } from '../../scripts/check-component-blueprint';
import { clearSkillsIndexCache, resolveSkillPath } from '../../scripts/utils/resolve-skill-path';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIXTURE_ROOT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint');
const VALID_PROJECT = path.join(FIXTURE_ROOT, 'valid');
const VALID_PATH = path.join(VALID_PROJECT, 'blueprint', 'component', 'ledger', 'component-blueprint.yaml');

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
  const filePath = componentBlueprintPath(projectRoot, 'ledger');
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

  results.push(test('canonical fixture passes all P1 completeness checks', () => {
    const issues = validateFixture(validBlueprint());
    assert(issues.length === 0, issues.map(item => `[${item.id}] ${item.path}: ${item.message}`).join('\n'));
  }));

  results.push(test('canonical path is component-owned and rejects arbitrary path identities', () => {
    assert(componentBlueprintPath('C:/project', 'ledger').replace(/\\/g, '/').endsWith('/blueprint/component/ledger/component-blueprint.yaml'), 'canonical path 错误');
    for (const id of ['', '..', 'a/b', 'a\\b']) {
      let failed = false;
      try { componentBlueprintPath('C:/project', id); } catch { failed = true; }
      assert(failed, `非法 component_id 应失败：${JSON.stringify(id)}`);
    }
  }));

  results.push(test('resolver separates source fingerprint from artifact hash and resolves all target kinds', () => {
    const loaded = loadCanonicalBlueprint(VALID_PROJECT, 'ledger');
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
    const loaded = loadCanonicalBlueprint(VALID_PROJECT, 'ledger');
    let nodeFailed = false;
    try {
      resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, { kind: 'node', id: 'ledger-domain' }));
    } catch { nodeFailed = true; }
    assert(nodeFailed, 'node 缺 view_id 应失败');
    assert(resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, { kind: 'decision', id: 'seam-shape' })).target, 'decision 顶层寻址失败');
    assert(resolveComponentBlueprintRef(VALID_PROJECT, makeRef(loaded.artifactSha256, { kind: 'contract', id: 'create-entry-v1' })).target, 'contract 顶层寻址失败');
  }));

  results.push(test('path YAML and ref component identity mismatch fails closed with three identities', () => {
    withTempProject((projectRoot, filePath) => {
      const blueprint = readYaml(filePath);
      blueprint.component_id = 'other-component';
      fs.writeFileSync(filePath, YAML.stringify(blueprint), 'utf8');
      const loaded = loadCanonicalBlueprint(projectRoot, 'ledger');
      let message = '';
      try { resolveComponentBlueprintRef(projectRoot, makeRef(loaded.artifactSha256, { kind: 'blueprint', id: 'ledger-app-blueprint' })); } catch (error) { message = (error as Error).message; }
      assert(message.includes('path=ledger') && message.includes('yaml=other-component') && message.includes('ref=ledger'), `三方诊断不完整：${message}`);
    });
  }));

  results.push(test('resolver rejects a hash-matching blueprint that fails canonical completeness', () => {
    withTempProject((projectRoot, filePath) => {
      const blueprint = readYaml(filePath);
      delete blueprint.design_views;
      fs.writeFileSync(filePath, YAML.stringify(blueprint), 'utf8');
      const loaded = loadCanonicalBlueprint(projectRoot, 'ledger');
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

  results.push(test('review Markdown is a one-way derived projection with full binding', () => {
    const loaded = loadCanonicalBlueprint(VALID_PROJECT, 'ledger');
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
        if (fixtureCase.mutator === 'yaml-component-id') {
          withTempProject((projectRoot, filePath) => {
            const blueprint = readYaml(filePath);
            mutate(blueprint, fixtureCase.mutator);
            fs.writeFileSync(filePath, YAML.stringify(blueprint), 'utf8');
            const issues = checkCanonicalComponentBlueprint(projectRoot, 'ledger').issues;
            assert(issues.some(item => item.id === fixtureCase.expected_issue), `缺期望诊断 ${fixtureCase.expected_issue}`);
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
