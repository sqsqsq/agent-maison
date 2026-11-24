import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { provisionFrameworkUnder, git, writeHostFile } from '../utils/real-chain-host';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { readDeliveredVerifierRequest } from './real-chain.unit.test';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { withRuntimeTest, preserveRuntimeTestEvidence } from '../utils/runtime-test-control';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const BLUEPRINT = 'ledger-app-blueprint';
const UNIT = 'ledger-refresh';
const SOURCE = 'src/ledger/src/main/LedgerFeature.ts';
const BASELINE_SOURCE = 'src/ledger/LedgerRepository.ts';
const TEST = 'src/ledger/src/test/LedgerFeature.test.ts';
const MISSING = 'src/ledger/NotCreatedYet.ts';
const FIXTURE = path.resolve(__dirname, '../fixtures/component-blueprint/valid');
const INPUTS = path.resolve(__dirname, '../fixtures/blueprint-design-inputs');
const CONTRACT = 'contracts/ledger-balance.yaml';
const REQUIREMENT = '新增账目后刷新余额，并可从保存的账目恢复余额；完成设计、独立质询、施工及真实单元测试。仅账本内部能力，不改UI、不请求设备验证。';
const ADD_CASE = '[BRANCH-success][AC-1] ledger-refresh adds balance without mutating inputs';
const RESTORE_CASE = '[BRANCH-success][AC-1] ledger-refresh restores saved arrays';
const EVIDENCE_REFS = [ADD_CASE, RESTORE_CASE].map(name => `${TEST}#${name}`);
const PRODUCT = "import { LedgerRepository } from '../../LedgerRepository';\n"
  + 'export class LedgerFeature {\n  static add(entries: readonly number[], amount: number): { entries: number[]; balance: number } {\n    const next = [...entries, amount]; return { entries: next, balance: LedgerFeature.restore(next) };\n  }\n  static restore(saved: readonly number[]): number { return LedgerRepository.balance(saved); }\n}\n';
const TEST_TEXT = [
  "import { it } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { LedgerFeature } from '../main/LedgerFeature';",
  "const expect = (value: unknown) => ({ toEqual: (expected: unknown): void => assert.deepEqual(value, expected) });",
  `it(${JSON.stringify(ADD_CASE)}, () => {`,
  "  const original = [45, 55];",
  "  const result = LedgerFeature.add(original, 20);",
  "  expect(original).toEqual([45, 55]);",
  "  expect(result.entries).toEqual([45, 55, 20]);",
  "  expect(result.balance).toEqual(120);",
  "  expect(LedgerFeature.add(result.entries, -20).balance).toEqual(100);",
  "});",
  `it(${JSON.stringify(RESTORE_CASE)}, () => {`,
  "  expect(LedgerFeature.restore(JSON.parse(JSON.stringify([45, 55, 20])))).toEqual(120);",
  "  expect(LedgerFeature.restore([])).toEqual(0);",
  "});", '',
].join('\n');
type Host = { root: string; frameworkRoot: string; harnessDir: string; load(relative: string): any };
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const writeYaml = (root: string, file: string, value: unknown) => writeHostFile(root, file, YAML.stringify(value));

function contractInput(): any {
  const provenance = { source_kind: 'interface', source_ref: CONTRACT, source_revision: 'v1', observed_at: '2026-11-05T00:00:00Z', evidence_strength: 'authoritative', extraction_method: 'explicit-host-interface-input' };
  const refs = ['requirements/ledger.md'];
  const fields = (names: string[], section: string) => names.map((field_id, index) => ({ field_id, type: field_id === 'entries' ? 'number[]' : 'number', required: true, nullable: false,
    semantics: field_id === 'entries' ? 'finite saved ledger amounts' : field_id === 'amount' ? 'finite added amount' : 'sum of ledger amounts',
    source_ref: `${CONTRACT}#/${section}/fields/${index}`, provenance }));
  return { contract_id: 'ledger-balance-v1', operation: { operation_id: 'addAndRestore', direction: 'internal', version: 'v1', source_ref: `${CONTRACT}#/operation`, verification_refs: refs },
    request_dto: { dto_id: 'LedgerInput', source_ref: `${CONTRACT}#/request_dto`, verification_refs: refs, fields: fields(['entries', 'amount'], 'request_dto') },
    response_dto: { dto_id: 'LedgerResult', source_ref: `${CONTRACT}#/response_dto`, verification_refs: refs, fields: fields(['entries', 'balance'], 'response_dto') },
    mappings: ['entries', 'amount', 'balance'].map((field, index) => ({ mapping_id: `ledger-${field}`, kind: 'direct', source_fields: [field], target_field: `LedgerFeature.${field}`, rule: `Preserve the finite ${field} value; add returns a copied snapshot.`, source_ref: `${CONTRACT}#/mappings/${index}`, provenance, verification_refs: refs })),
    errors: { source_ref: `${CONTRACT}#/errors`, verification_refs: refs, items: { input_contract: 'caller supplies finite numbers and arrays; no I/O or hidden failure channel' } },
    idempotency: { source_ref: `${CONTRACT}#/idempotency`, verification_refs: refs, rule: 'same inputs produce equal values without mutating the caller' },
    nfr: { source_ref: `${CONTRACT}#/nfr`, verification_refs: refs, requirements: { side_effects: 'no I/O, subscriptions, shared mutable state or UI' } }, owner: 'ledger-team', needed_by: UNIT, provenance };
}

async function withHost(run: (host: Host) => Promise<void>): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daily-design-')));
  const priorTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, '.trust');
  try {
    const framework = provisionFrameworkUnder(root);
    const host = { root, ...framework, load: (relative: string) => require(path.join(framework.harnessDir, relative)) };
    for (const directory of ['src', 'test', 'requirements', 'contracts', 'mappings']) fs.cpSync(path.join(FIXTURE, directory), path.join(root, directory), { recursive: true });
    writeHostFile(root, 'requirements/ledger.md', '# REQ-LEDGER-REFRESH\n\n' + REQUIREMENT + '\n');
    writeYaml(root, CONTRACT, contractInput());
    writeHostFile(root, 'build-profile.json5', JSON.stringify({ app: { products: [{ name: 'node-test' }] }, modules: [] }));
    writeHostFile(root, BASELINE_SOURCE, 'export class LedgerRepository {\n  static balance(saved: readonly number[]): number { return saved.reduce((a, b) => a + b, 0); }\n}\n');
    writeHostFile(root, SOURCE, 'export class LedgerFeature {}\n');
    writeHostFile(root, TEST, 'export {};\n');
    writeHostFile(root, 'framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'DailyDesignLedger', active_workflow: 'obligation-driven',
      project_profile: { name: 'hmos-app' }, architecture: { outer_layers: [{ id: 'src', can_depend_on: [], intra_layer_deps: 'dag' }],
        module_inner_layers: ['main'], inner_dependency_direction: 'upward', cross_module_exports_file: 'src/main/LedgerFeature.ts' },
      paths: { features_dir: 'doc/features', module_catalog: 'doc/module-catalog.yaml', glossary: 'doc/glossary.yaml', architecture_md: 'doc/architecture.md', docs_committed: false },
      materialized_adapters: ['claude'] }));
    writeHostFile(root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude', vision: { image_input_override: 'none' } }));
    writeHostFile(root, 'AGENTS.md', '# Daily design host\n\nRead requirements/ledger.md and the actual signed request. Produce the requested artifacts; runtime checks determine completion.\n');
    fs.copyFileSync(path.join(root, 'AGENTS.md'), path.join(root, 'CLAUDE.md'));
    writeHostFile(root, '.claude/commands/goal-mode.md', 'Read framework/skills/project/goal-mode/SKILL.md and follow it.\n');
    fs.mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
    fs.copyFileSync(path.join(framework.frameworkRoot, 'agents/claude/templates/agents/phase-executor.md'),
      path.join(root, '.claude/agents/phase-executor.md'));
    writeYaml(root, 'doc/module-catalog.yaml', { schema_version: '1.0', modules: [{ name: 'ledger', layer: 'src', sub_layer: null, format: 'HAR', one_liner: '账目余额及恢复',
      responsibilities: ['账目余额'], NOT_responsible_for: ['UI', 'device'], typical_business_terms: ['账本'], easily_confused_with: [], key_exports: ['LedgerFeature'], entry_file: SOURCE }] });
    writeYaml(root, 'doc/glossary.yaml', { schema_version: '1.0', terms: [{ term: '账本', canonical_module: 'ledger', aliases: [], definition: '保存账目并计算余额' }] });
    writeHostFile(root, 'doc/architecture.md', '# Architecture\n\nledger owns a host-only TypeScript balance service and Node assertions.\n');
    writeHostFile(root, '.gitignore', 'framework/\n.trust/\n');
    // Keep the existing design lens; only its external host toolchain is adapted to real repository TS/Node.
    const profileDir = path.join(framework.frameworkRoot, 'profiles/hmos-app');
    const profile = YAML.parse(fs.readFileSync(path.join(profileDir, 'profile.yaml'), 'utf8'));
    profile.capabilities['coding.compile'] = { provider: 'node_compile', severity: 'BLOCKER' };
    profile.capabilities['coding.deps_install'] = { provider: 'none', severity: 'SKIP' };
    profile.capabilities['coding.lint'] = { provider: 'none', severity: 'SKIP' };
    profile.capabilities['ut.compile'] = { provider: 'node_compile', severity: 'BLOCKER' };
    profile.capabilities['ut.run'] = { provider: 'node_test', severity: 'BLOCKER' };
    profile.device_capabilities = profile.device_capabilities.filter((capability: string) => capability !== 'ut.run');
    for (const capability of ['coding.compile', 'ut.compile', 'ut.run']) delete profile.personal_prerequisites[capability];
    fs.writeFileSync(path.join(profileDir, 'profile.yaml'), YAML.stringify(profile));
    fs.cpSync(path.resolve(__dirname, '../utils/session-node-profile'), path.join(profileDir, 'harness'), { recursive: true });
    fs.mkdirSync(path.join(root, 'doc/features'), { recursive: true });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.name', 'Daily design fixture']); git(root, ['config', 'user.email', 'daily-design@example.test']);
    git(root, ['config', 'commit.gpgsign', 'false']); git(root, ['add', '-A']); git(root, ['commit', '-qm', 'Original host inputs before Feature design']);
    assert.deepEqual(fs.readdirSync(path.join(root, 'doc/features')), []);
    let deviceGateCalls = 0;
    host.load('scripts/goal-phase-runtime').__testing_setDeviceReadinessGate(() => {
      deviceGateCalls++; throw new Error('Isolated TypeScript/Node fixture must not inspect or wake a device');
    });
    await run(host);
    assert.equal(deviceGateCalls, 0, 'internal TypeScript/Node delivery unexpectedly entered the device gate');
  } catch (error) {
    const files = [SOURCE, TEST, `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`].map(file => path.join(root, file));
    const originals = preserveRuntimeTestEvidence([root], String(error), [], files);
    throw new Error(`${error instanceof Error ? error.stack : String(error)}\noriginals: ${originals}`);
  } finally {
    for (const file of Object.keys(require.cache)) if (file.startsWith(root + path.sep)) delete require.cache[file];
    if (priorTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = priorTrust;
    assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function blueprintDraft(host: Host, missing: boolean): any {
  const document = YAML.parse(read(FIXTURE, `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`));
  const prepared = YAML.parse(read(host.root, `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`));
  document.component_id = prepared.component_id;
  document.revision = prepared.revision;
  document.provenance = { source_kind: 'code', source_ref: BASELINE_SOURCE, source_revision: 'host-baseline', observed_at: '2026-11-05T00:00:00Z', evidence_strength: 'observed', extraction_method: 'actual-source-read' };
  document.discovery.facts = [{ fact_id: 'ledger-baseline', subject: 'LedgerRepository.current-source', value: read(host.root, BASELINE_SOURCE).trim(), provenance: document.provenance }];
  Object.assign(document.discovery.inputs, { product_requirements: ['requirements/ledger.md'], external_inputs: [CONTRACT], repository_facts: [BASELINE_SOURCE], knowledge_assets: ['doc/architecture.md', 'doc/module-catalog.yaml'] });
  document.discovery.inputs.current_scope_items = prepared.discovery.inputs.current_scope_items;
  document.discovery.requirement_traceability = document.discovery.inputs.current_scope_items.map((item: any) => ({ item_id: item.item_id,
    blueprint_refs: ['view:logical/node:ledger-domain', 'view:scenarios/node:add-entry-scenario', 'contract:ledger-balance-v1'] }));
  const logicalView = document.design_views.find((view: any) => view.view_id === 'logical');
  const logical = logicalView.nodes[0];
  Object.assign(logical, { label: 'Pure LedgerFeature calculation', current_state: 'Empty host class', target_state: 'Typed add and restore return values without mutating inputs', provenance: document.provenance });
  const readInput = (name: string) => YAML.parse(read(INPUTS, name + '.yaml'));
  logical.acceptance = readInput('acceptance');
  Object.assign(logical.acceptance.criteria[0], { description: '新增账目计算余额并从保存数组恢复', verification_steps: EVIDENCE_REFS, expected_result: '新增余额正确、保存数组可恢复且原输入未变', ut_focus: 'pure add/restore input and output' });
  logical.contracts = JSON.parse(JSON.stringify(readInput('contracts'))
    .split('src/ledger/LedgerFeature.ets').join(SOURCE).split('test/ledger/LedgerFeature.test.ets').join(TEST));
  logical.contracts.modules = [{ name: 'ledger', layer: 'src', package_path: 'src/ledger', format: 'HAR', change_type: 'modify' }];
  logical.contracts.files = [SOURCE, BASELINE_SOURCE];
  delete logical.contracts.change_unit;
  logical.use_cases = readInput('use-cases');
  logical.use_cases.use_cases[0].coordinator = 'LedgerFeature.add';
  logical.use_cases.use_cases[0].branches[0].scenario = 'pure array input produces a copied snapshot and recoverable balance';
  for (const view of document.design_views) {
    view.decisions_and_gaps = [];
    if (view.view_id === 'deployment') {
      Object.assign(view, { applicability: 'not_applicable', current_state: 'No component-owned long-lived state or external side effects', target_state: 'Same host-only pure input/output boundary', delta: 'none', nodes: [],
        applicability_evidence: { disposition: 'not_applicable', evidence_refs: ['requirements/ledger.md', CONTRACT], retrigger_condition: 'Shared mutable state, I/O, asynchronous consumers or deployment enters this component' } });
      delete view.evolution_impact; delete view.runtime_data_flows;
    } else {
      Object.assign(view, { current_state: 'Empty LedgerFeature host input', target_state: 'Pure add and restore balance calculation with real Node assertions', delta: 'Add the requested internal calculation only' });
      for (const node of view.nodes) node.provenance = node.acceptance || node.contracts || node.use_cases
        ? { source_kind: 'requirement', source_ref: 'requirements/ledger.md', source_revision: 'v1', observed_at: '2026-11-05T00:00:00Z', evidence_strength: 'authoritative', extraction_method: 'explicit-request-and-interface-design' }
        : document.provenance;
      if (view.view_id === 'runtime') {
        view.nodes = [view.nodes[0]];
        Object.assign(view.nodes[0], { label: 'LedgerFeature synchronous calculation', current_state: 'Empty host class', target_state: 'Caller-owned array enters add/restore and returns a copied value', owner: 'ledger-team' });
        delete view.runtime_data_flows;
        view.runtime_data_flow_disposition = { status: 'not_applicable', evidence_refs: ['requirements/ledger.md', CONTRACT], retrigger_condition: 'I/O, shared state, asynchronous publication or consumers enter the requested pure calculation' };
      }
    }
  }
  const scenario = document.design_views.find((view: any) => view.view_id === 'scenarios').nodes[0];
  Object.assign(scenario, { label: 'Add and restore saved array values', current_state: 'No balance calculation', target_state: 'Caller receives new balance; original array unchanged', logical_refs: ['view:logical/node:ledger-domain', 'contract:ledger-balance-v1'], runtime_refs: ['view:runtime/node:ledger-repository'] });
  document.contracts = [YAML.parse(read(host.root, CONTRACT))];
  document.relations = document.relations.filter((relation: any) => relation.relation_id === 'domain-owned-by-module');
  document.relations[0].provenance = document.provenance;
  document.decisions_and_gaps = { decisions: [], gaps: [] };
  for (const [key, answer] of Object.entries(document.app_lens) as Array<[string, any]>) {
    if (key === 'runtime_flow_trigger_assessment') for (const condition of Object.values(answer) as any[]) Object.assign(condition, { applies: false, evidence_refs: [CONTRACT] });
    else Object.assign(answer, { answer: 'This component computes finite array values synchronously; no UI, I/O, subscriptions or shared mutable state.', evidence_refs: ['requirements/ledger.md', CONTRACT] });
  }
  document.derived_results = [];
  delete document.generated_graphs;
  if (missing) document.provenance.source_ref = MISSING;
  delete document.review_summary.questioning;
  return document;
}

function questioningReply(host: Host, denyMissing: boolean, blueprintFile = `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`): string {
  assert(read(host.root, 'requirements/ledger.md').includes(REQUIREMENT), 'the independent response must read its real requirement original');
  const authority = YAML.parse(read(host.root, CONTRACT));
  assert.equal(authority.operation.direction, 'internal');
  const current = YAML.parse(read(host.root, blueprintFile));
  const template = YAML.parse(read(FIXTURE, `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`));
  const required = host.load('scripts/utils/blueprint-questioning').requiredQuestioningScopes(current);
  const items = structuredClone(template.review_summary.questioning.items).filter((item: any) => required.has(item.scope_ref));
  for (const item of items) Object.assign(item, { question: `Does ${item.scope_ref} preserve the actual internal input/output request?`, answer: 'Read the actual request and internal contract: add returns a copied array and balance; restore recomputes a saved array. No UI or durable-runtime promise is introduced.', evidence_refs: ['requirements/ledger.md', CONTRACT],
    provenance: { source_kind: 'requirement', source_ref: 'requirements/ledger.md', observed_at: '2026-11-05T00:00:00Z', evidence_strength: 'authoritative', extraction_method: 'actual-independent-input-reading' } });
  const missing = current.provenance.source_ref === MISSING && !fs.existsSync(path.join(host.root, MISSING));
  if (denyMissing && missing) Object.assign(items[0], { disposition: 'blocker', question: '当前设计依据是否真实可读？', answer: `当前引用 ${MISSING} 不存在；请设计作者改为已经读取的真实来源，不创建或假报证据。` });
  return JSON.stringify({ items });
}

function authorConstructionMapping(cu: any, test_refs: string[]): any {
  const implementation_refs = [SOURCE];
  return {
    predicate_mappings: cu.target_predicates.map((row: any) => ({ predicate_id: row.predicate_id, implementation_refs, test_refs })),
    provide_mappings: cu.provides.map((row: any) => ({ provide_id: row.provide_id, implementation_refs, test_refs })),
    design_ref_mappings: cu.design_refs.map((design_ref: any) => ({ design_ref, implementation_refs, verification_refs: test_refs })),
  };
}

function decompose(host: Host, includeConstructionMapping = true): void {
  const identity = host.load('scripts/utils/component-blueprint-path').loadCanonicalBlueprint(host.root, BLUEPRINT);
  const cu = YAML.parse(read(FIXTURE, `doc/features/${BLUEPRINT}/${UNIT}/change-unit.yaml`));
  const rebind = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (value.artifact === 'component-blueprint@1') Object.assign(value, { component_id: identity.blueprint.component_id, revision: identity.blueprint.revision,
      source_fingerprint: identity.blueprint.source_fingerprint, artifact_sha256: identity.artifactSha256 });
    Object.values(value).forEach(rebind);
  };
  rebind(cu);
  cu.component_id = identity.blueprint.component_id;
  cu.design_refs = cu.design_refs.filter((ref: any) => ref.target.kind === 'node' && ['ledger-domain', 'ledger-module', 'add-entry-scenario'].includes(ref.target.id));
  cu.design_refs.push({ ...cu.component_blueprint_ref, target: { kind: 'contract', id: 'ledger-balance-v1' } },
    { ...cu.component_blueprint_ref, target: { kind: 'node', view_id: 'runtime', id: 'ledger-repository' } },
    { ...cu.component_blueprint_ref, target: { kind: 'relation', id: 'domain-owned-by-module' } });
  cu.touches = [{ owner: 'ledger-team', design_ref: cu.design_refs.find((ref: any) => ref.target.id === 'ledger-module'), write_refs: ['planned:src/ledger'] }];
  cu.target_predicates = [{ predicate_id: 'refresh-behavior', role: 'behavior', description: 'Pure add returns a new snapshot and correct balance; saved arrays restore the same value', provide_ids: ['ledger-refresh-vertical-slice'], verification_refs: EVIDENCE_REFS },
    { predicate_id: 'balance-contract', role: 'contract', description: 'The typed internal array and balance contract is implemented without side effects', provide_ids: ['ledger-refresh-vertical-slice'], verification_refs: EVIDENCE_REFS }];
  cu.purpose = 'Land the requested pure internal add and saved-array balance recovery with real TypeScript and Node assertions';
  cu.provides[0].description = 'Typed internal add and restore functions with real Node assertions';
  cu.preserved_invariants = [{ invariant_id: 'input-not-mutated', description: 'Caller input arrays remain unchanged', evidence_refs: [EVIDENCE_REFS[0]] }];
  cu.verification_refs = EVIDENCE_REFS;
  cu.safe_intermediate_state = { description: 'Pure internal calculation compiles and can be used independently without runtime or UI state', build_validation_refs: EVIDENCE_REFS, compatibility_refs: [EVIDENCE_REFS[0]], recovery_refs: [EVIDENCE_REFS[1]] };
  cu.provenance.source_revision = `revision-${identity.blueprint.revision}`;
  cu.provenance.extraction_method = 'builtin-vertical-slice-decomposition';
  writeHostFile(host.root, `doc/features/${BLUEPRINT}/blueprint/change-unit-candidates.json`, JSON.stringify([{ providerId: 'builtin-vertical-slice-decomposition', artifact: cu,
    ...(includeConstructionMapping ? { construction_mapping: authorConstructionMapping(cu, EVIDENCE_REFS.map(ref => 'planned:' + ref)) } : {}) }]));
}

function unitReviewReport(host: Host, feature: string): void {
  const rel = host.load('scripts/utils/feature-identity').featureRelativePath(feature);
  writeHostFile(host.root, `doc/features/${rel}/review/review-report.md`, '# 审查报告\n\n> **保证等级**: standard\n\n## 1. 审查范围\n- ' + SOURCE + '\n\n## 2. 审查维度\n契约、边界及恢复；真实编译与Node断言另由工具执行。\n\n## 3. 问题清单\n| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |\n|---|---|---|---|---|---|\n\n## 4. 问题统计\n| 严重程度 | 数量 |\n|---|---|\n| BLOCKER | 0 |\n| MAJOR | 0 |\n| MINOR | 0 |\n\n## 5. 修复建议\n无新增建议。\n\n## 6. 结论\n**审查结论**: 通过\n');
}

function taggedStrengthRows(host: Host, context: any): Array<{ issue: string; verdict: string; evidence: string; production_paths: string[] }> {
  const questions = Object.keys(context.workInput?.material.acceptanceReview ?? {});
  if (!questions.length) return [];
  assert.deepEqual(questions, ['acceptance_test_strength_AC-1']);
  assert(context.instruction.includes('| acceptance_test_strength_AC-1 |'));
  assert.equal(read(host.root, SOURCE), PRODUCT);
  const testText = read(host.root, TEST);
  assert(testText.includes("import { LedgerFeature } from '../main/LedgerFeature'"));
  const testNames = [ADD_CASE, RESTORE_CASE];
  assert(testNames.every(name => testText.includes(name) && context.instruction.includes(name)));
  assert(testText.includes('expect(original).toEqual') && testText.includes('expect(result.balance).toEqual')
    && testText.includes('expect(LedgerFeature.restore(JSON.parse(JSON.stringify'));
  return [{ issue: questions[0], verdict: 'refuted', evidence: '`' + TEST + ':5` ' + testNames.join('；')
    + ' 以当前 Node 用例实际调用 `' + SOURCE + ':3-6` 的生产 add/restore，断言余额、原数组未修改及从保存数组恢复。执行证据由原正式 UT 独立读取。',
    production_paths: [SOURCE] }];
}

function appendTaggedStrengthReview(host: Host, context: any): void {
  const rows = taggedStrengthRows(host, context);
  if (!rows.length) return;
  const report = host.load('config').featureFilePath(host.root, context.feature, 'review/review-report.md');
  fs.appendFileSync(report, '\n```issue-verification\n' + YAML.stringify(rows) + '```\n');
}

function bindControlledAuthor(host: Host, context: any): void {
  const handoff = host.load('scripts/utils/session-execution-handoff');
  const issued = handoff.readSessionExecution(context.runDir);
  assert(issued && issued.request.context.attemptId === context.attemptId && issued.request.context.phase === context.phase);
  assert.equal(issued.request.write_boundary.executionRole, 'author');
  const binding = handoff.capturePhaseBinding(context.runDir, issued);
  assert(binding, 'the controlled author needs the signed write-window preimage before writing');
  const initial = handoff.readHandoffMaterial(context.runDir, binding);
  assert(!initial.snapshot.failureReason);
  assert.equal(initial.snapshot.sha256, issued.request.pre_snapshot.sha256, 'the fixture binds before it writes any input');
  const owner = issued.request.context.owner;
  fs.appendFileSync(path.join(context.runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(),
    type: 'agent_process_bound', phase: context.phase, invoke_id: issued.request.invoke_id,
    owner_id: owner.owner_id, owner_epoch: owner.epoch, binding_snapshot: binding }) + '\n');
}

function unitMaterials(host: Host, context: any, preserveContracts = false, extraResearch: readonly string[] = []): void {
  bindControlledAuthor(host, context);
  const feature = context.feature, rel = host.load('scripts/utils/feature-identity').featureRelativePath(feature);
  const specFile = host.load('config').featureFilePath(host.root, feature, 'spec/spec.md');
  writeHostFile(host.root, path.relative(host.root, specFile), '# Ledger calculation\n\n```yaml\nui_change: none\n```\n\n' + REQUIREMENT + '\n');
  for (const family of context.chain) {
    if (family === 'spec') {
      const projected = host.load('scripts/utils/blueprint-skill-projection').deriveBlueprintSkillInput(host.root, feature, host.frameworkRoot, 'acceptance');
      assert.equal(projected.state, 'resolved', projected.detail);
      // The spec author must rebuild its own output after design repair changes the bound source.
      writeYaml(host.root, `doc/features/${rel}/acceptance.yaml`, projected.value);
    }
    if (family === 'plan') {
      const projected = host.load('scripts/utils/blueprint-skill-projection').deriveBlueprintSkillInput(host.root, feature, host.frameworkRoot, 'contracts');
      assert.equal(projected.state, 'resolved', projected.detail);
      const identity = host.load('scripts/utils/change-unit-path'), loaded = identity.loadCanonicalChangeUnit(host.root, BLUEPRINT, UNIT);
      const contracts = structuredClone(projected.value);
      contracts.change_unit = { change_unit_ref: identity.createChangeUnitRef(loaded),
        ...authorConstructionMapping(loaded.changeUnit, EVIDENCE_REFS) };
      if (!preserveContracts) writeYaml(host.root, `doc/features/${rel}/contracts.yaml`, contracts);
      if (projected.artifacts?.['use-cases@1']) writeYaml(host.root, `doc/features/${rel}/use-cases.yaml`, projected.artifacts['use-cases@1']);
    }
    if (family === 'coding') writeHostFile(host.root, SOURCE, PRODUCT);
    if (family === 'review') unitReviewReport(host, feature);
    if (family === 'ut') {
      writeHostFile(host.root, TEST, TEST_TEXT);
      writeYaml(host.root, `doc/features/${rel}/ut/mock-plan.yaml`, { schema_version: '1.0', feature, spies: [] });
      writeHostFile(host.root, `doc/features/${rel}/ut/testability-audit.md`, '```yaml\n' + YAML.stringify({ records: [{ acceptance_id: 'AC-1', entry_point: { file: SOURCE, symbol: 'add' }, testability_level: 'L1', dependencies: [{ name: 'Array', kind: 'pure' }], verdict: 'testable' }] }) + '```\n');
      writeHostFile(host.root, `doc/features/${rel}/ut/reports/coverage-evidence.json`, JSON.stringify({ schema_version: '1.0', feature, primary_evidence_source: 'ut_tags', sources: { ut_tags: [TEST] }, mappings: [{ scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' }] }));
      writeYaml(host.root, `doc/features/${rel}/ut/reports/flow-dag/ledger_refresh.dag.yaml`, { flow_id: 'ledger_refresh', flow_name: '账目新增与恢复', module: 'ledger', use_case: 'ledger-refresh', branches: ['success'], linked_acceptance: ['AC-1'],
        entry_point: { module: 'ledger', file: SOURCE, function: 'add' }, nodes: [{ id: 'add', type: 'code_execution', description: '新增账目', source: { file: SOURCE, class: 'LedgerFeature', function: 'add' }, next: ['balance'] },
          { id: 'balance', type: 'assertion', description: '核对余额', linked_acceptance: ['AC-1'], assertions: [{ type: 'state_check', target: 'balance', expected: '120' }], next: [] }] });
    }
  }
  const facts = host.load('config').featureFilePath(host.root, feature, 'context/facts.md');
  assert(context.factsContext, 'the author must consume its actual admitted research context');
  if (!fs.existsSync(facts)) {
    assert(!context.factsContext.baseline, 'an absent prior facts original cannot become a new baseline');
    const sources = [...new Set<string>([...context.factsContext.source_paths, SOURCE, TEST, ...extraResearch])]
      .filter(file => fs.existsSync(path.join(host.root, file)) && fs.statSync(path.join(host.root, file)).isFile());
    for (const file of sources) fs.readFileSync(path.join(host.root, file));
    writeHostFile(host.root, path.relative(host.root, facts), '---\n' + YAML.stringify({ schema_version: '1.1', feature, run_id: context.runId,
      established_by: context.factsContext.first_phase, ready_to_produce: true, has_blocker_coverage_risk: false, exploration_mode: 'sequential',
      source_code_paths: sources, key_inputs_read: sources, files_inspected_count: sources.length, searches_performed_estimate: extraResearch.length ? 2 : 1,
      subagents_used: 'none', decisions_unlocked: ['ledger balance and recovery'] }) + '---\n## Code Facts\n');
  }
  researchSnapshotFacts(host.root, facts, context.factsContext.first_phase, context.factsContext);
  const families = new Set<string>([...context.chain, ...(extraResearch.length ? ['spec', 'plan'] : [])]);
  for (const family of families) if (family !== context.factsContext.first_phase) researchSnapshotFacts(host.root, facts, family, context.factsContext);
}

function verifierReply(host: Host, context: any, phase: string, sample: {
  testText: string; beforeText: string; testCount: number;
  reviewIssues?: Array<{ issue: string; verdict: 'confirmed'; evidence: string }>;
} = { testText: TEST_TEXT, beforeText: 'export {};\n', testCount: 2 }): void {
  const reports = host.load('config').featurePhaseReportsDir(host.root, context.feature, phase, host.frameworkRoot);
  const current = JSON.parse(fs.readFileSync(path.join(reports, 'summary.json'), 'utf8'));
  const script = JSON.parse(fs.readFileSync(path.join(reports, 'script-report.json'), 'utf8'));
  const blockedInputs = script.checks.filter((check: any) => check.status === 'FAIL' && check.id.startsWith('capability_'));
  assert.equal(blockedInputs.length, 0, phase + ': normal verifier received blocked inputs: ' + JSON.stringify(blockedInputs));
  assert(current.verifier_subject_id, 'only an actual production verifier request may be answered');
  const request = context.phase.endsWith('-verifier-format-repair')
    ? readDeliveredVerifierRequest({ ...host, feature: context.feature, module: 'ledger', modulePath: 'src/ledger' },
      { phase: context.phase, prompt: context.instruction, runId: context.runId })
    : host.load('scripts/utils/verifier-request').parseVerifierRequest(read(host.root, current.verifier_request));
  assert(request && request.feature === context.feature && request.phase === phase && request.subject_id === current.verifier_subject_id);
  const materials = host.load('scripts/utils/verifier-material');
  const material = materials.readVerifierMaterialOrNull(reports, request.subject_id);
  assert(material && material.material_sha256 === request.material_sha256 && materials.computeMaterialSha256(material) === request.material_sha256);
  fs.readFileSync(path.join(host.root, request.prompt_path), 'utf8');
  for (const file of material.files) if (file.sha256 !== null) fs.readFileSync(path.join(host.root, file.path));
  host.load('scripts/utils/component-blueprint-path').loadCanonicalBlueprint(host.root, BLUEPRINT);
  host.load('scripts/utils/change-unit-path').loadCanonicalChangeUnit(host.root, BLUEPRINT, UNIT);
  if (phase === 'spec' || phase === 'plan') {
    const kind = phase === 'spec' ? 'acceptance' : 'contracts';
    const projected = host.load('scripts/utils/blueprint-skill-projection').deriveBlueprintSkillInput(host.root, context.feature, host.frameworkRoot, kind);
    assert.equal(projected.state, 'resolved', projected.detail);
    fs.readFileSync(host.load('config').featureFilePath(host.root, context.feature, kind + '.yaml'), 'utf8');
  }
  if (['coding', 'review', 'ut'].includes(phase)) assert.equal(read(host.root, SOURCE), PRODUCT, 'the verifier must read the current implementation only after its author responsibility');
  if (phase === 'ut') {
    assert.equal(read(host.root, TEST), sample.testText, 'the verifier must inspect unchanged real assertions');
    const tap = fs.readFileSync(path.join(reports, 'node-tests.tap'), 'utf8');
    assert(tap.split('\n').includes('# tests ' + sample.testCount)); assert.match(tap, /# fail 0/); assert.match(tap, /# skipped 0/);
  }
  let reply = '受控独立模型替身：已读当前真实request、material列出的可用文件与canonical蓝图/CU；按阶段核当前投影或实现，UT另读真实Node TAP，不改机器检查或完成结论。\n';
  if (sample.reviewIssues?.length) reply += '\n```issue-verification\n' + YAML.stringify(sample.reviewIssues) + '```\n';
  const strength = phase === 'coding' && script.checks.find((check: any) => check.id === 'coding_existing_test_preserved' && check.affected_files?.includes(TEST));
  if (strength) {
    assert.equal(read(host.root, TEST), sample.testText, 'the independent model reads the unchanged current assertions');
    const original = host.load('scripts/utils/repair-responsibility').codingTestPreservation({ projectRoot: host.root, feature: context.feature, runId: context.runId, file: TEST });
    if (original.beforeText !== undefined) assert.equal(original.beforeText, sample.beforeText, 'the verifier must read the actual original assertions');
    else {
      const sessions = host.load('scripts/utils/session-execution-handoff');
      const author = sessions.sessionEvents(context.runDir).find((event: any) => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
      const issued = author && sessions.executionRequestForInvoke(context.runDir, author.invoke_id);
      const before = issued?.request.pre_snapshot?.entries.find((entry: any) => entry.path === TEST && entry.kind === 'file');
      assert.equal(before?.sha256, createHash('sha256').update(sample.beforeText).digest('hex'), 'the signed preimage must prove the original test bytes');
    }
    reply += '\n```issue-verification\n' + YAML.stringify([{ issue: 'coding_existing_test_preserved', verdict: 'refuted',
      evidence: [TEST, strength.details, '已核实际测试前像；新增原生断言直接核 add/restore 余额与输入不变，保留原有断言。'].join(' | ') }]) + '```\n';
    assert.equal(host.load('scripts/utils/repair-candidates').testStrengthVerification({ check: strength, verifierReportText: reply, verifierSubjectCurrent: true })?.verdict, 'refuted');
  }
  if (phase === 'ut') reply += '| id | status | severity | 证据 |\n|---|---|---|---|\n| end_to_end_driving | PASS | BLOCKER | node:test直接调用LedgerFeature.add/restore |\n| business_assertion_value | PASS | BLOCKER | AC-1真实余额断言，失败保留原TAP |\n';
  const execution = host.load('scripts/utils/session-execution-handoff').executionRequestForInvoke(context.runDir);
  assert.equal(execution?.request.context.phase, context.phase, 'verifier uses its current signed execution');
  const draft = execution?.request.write_boundary?.verifierResultPath;
  assert(draft, 'verifier must return into its authorized invocation draft');
  publishFixtureVerifierEvidence({ projectRoot: host.root, feature: context.feature, phase, reportsDir: reports,
    subjectId: current.verifier_subject_id, draftPath: path.resolve(host.root, draft), reportText: reply, skipSummaryPatch: true });
}

function assertFrozenInputs(host: Host, context: any): void {
  const prior = new Map(Object.keys(context.childEnv).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, context.childEnv);
    for (const phase of context.chain.slice(0, 1)) {
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: context.feature, phase,
        goalRunId: context.runId, goalAttemptId: context.attemptId };
      const entry = host.load('scripts/utils/capability-resolution-entry-input').resolveCapabilityResolutionEntryInput({ ...options, purpose: 'work-unit-author' });
      const resolved = host.load('scripts/utils/capability-resolution').resolveCapabilityInputs({ ...options, ...entry, track: 'full' });
      for (const id of phase === 'spec' ? ['requirement'] : phase === 'plan' ? ['acceptance'] : ['acceptance', 'contracts']) {
        const value = resolved.inputs?.values[id];
        assert.equal(value?.state, 'resolved', phase + '/' + id + ': ' + JSON.stringify(value ?? resolved.report));
      }
    }
  } finally { for (const [key, value] of prior) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

function prepare(host: Host, id: string, adapter = 'claude', sessionRef?: string): { options: any; prepared: any; entry: any } {
  const entry = host.load('scripts/goal-mode-entry');
  let adapterModelPin: any = { adapter, value: 'claude-opus-5-5', provider: 'anthropic', reasoning_effort: 'high', config_source: path.join(host.root, 'controlled-model-home', 'settings.json') };
  if (adapter === 'deepseek-harness') {
    const source = path.join(host.root, 'controlled-model-home/profiles/fixture/cordis.patch.yml');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, YAML.stringify([{ id: 'llm-pi-ai', config: { providers: { volcengine: { api: 'openai-completions',
      baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'volcengine/deepseek-v4.1-flash', contextWindow: 1000000, input: ['text'] }] } } } }]));
    adapterModelPin = host.load('scripts/utils/adapter-model').freezeModelPin({ adapter, provider: 'volcengine',
      value: 'volcengine/deepseek-v4.1-flash', config_source: source });
  }
  const original = entry.prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT, adapter, runId: id,
    requirement: REQUIREMENT, requirementSourceFiles: ['requirements/ledger.md'], requestedResults: [REQUIREMENT], requestedPhases: ['plan', 'coding', 'ut'],
    ...(adapter === 'deepseek-harness' ? { adapterModelPin } : {}),
    unattended: { write_mode: 'full-access', approval_mode: 'never' }, autonomyAuthorized: true, sessionRef });
  const prepared = entry.prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT, adapter, runId: id,
    requirement: REQUIREMENT, adapterModelPin, modelOverride: true });
  assert.equal(prepared.manifest.run_id, original.manifest.run_id, 'legacy no-pin initial run must be rebound through the same entry');
  assert(prepared.manifest.initial_design && !prepared.manifest.execution_scope);
  return { entry, prepared, options: { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT, runId: prepared.manifest.run_id,
    adapter, runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: true } } };
}

async function report(host: Host, control: ReturnType<typeof prepare>, step: any, output: string): Promise<any> {
  return withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep({ ...control.options, requestPath: step.request.path,
    report: { status: 'passed', phase: step.phase, details: output } }));
}

function assertDeliveryComplete(host: Host, control: ReturnType<typeof prepare>, step: any, testText = TEST_TEXT, testCount = 2): void {
  assert.equal(step.type, 'goal_session_result', JSON.stringify(step));
  const units = host.load('scripts/utils/change-unit-path').enumerateCanonicalChangeUnits(host.root, BLUEPRINT);
  assert.equal(units.length, 1);
  const feature = host.load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
  const assessment = host.load('scripts/utils/feature-assessment').assessFeature(host.root, feature, { frameworkRoot: host.frameworkRoot,
    ...host.load('scripts/utils/change-unit-completion').resolveChangeUnitExpectedExecution(host.root, feature) });
  assert(assessment.complete && assessment.record.state === 'ok', JSON.stringify(assessment));
  const projection = host.load('scripts/utils/initial-design-delivery').projectInitialDesignDelivery({
    projectRoot: host.root, frameworkRoot: host.frameworkRoot, manifest: control.prepared.manifest,
  });
  assert(projection.complete);
  assert.equal(step.result.status, 'completed');
  assert.equal(step.result.next_action, projection.next_action);
  assert.deepEqual(step.result.current, projection.current, 'the returning session uses the released owner view');
  const terminalReport = JSON.parse(read(control.prepared.runDir, 'goal-report.json'));
  const terminalProgress = JSON.parse(read(control.prepared.runDir, 'progress.json'));
  assert.equal(terminalReport.status, 'COMPLETED');
  assert.deepEqual(terminalProgress, terminalReport, 'both files use the same committed terminal event');
  const tap = fs.readFileSync(path.join(host.load('config').featurePhaseReportsDir(host.root, feature, 'ut', host.frameworkRoot), 'node-tests.tap'), 'utf8');
  assert(tap.includes(`# tests ${testCount}`)); assert.match(tap, /# fail 0/); assert.match(tap, /# skipped 0/);
  assert.equal(read(host.root, SOURCE), PRODUCT); assert.equal(read(host.root, TEST), testText);
  const completion = JSON.parse(fs.readFileSync(host.load('config').featureFilePath(host.root, feature, 'feature-completion.json'), 'utf8'));
  const { run_id: runId } = JSON.parse(read(host.root, completion.original_path));
  assert(runId, 'the completion must refer to the actual CU run');
  const executionScope = host.load('scripts/utils/goal-run-creation').resolveEffectiveScopeSource(host.root, feature, runId)?.scope;
  const strength = host.load('scripts/utils/acceptance-review-strength').readTaggedAcceptanceStrength({
    projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, runId, executionScope,
  }).find((item: any) => item.issue === 'acceptance_test_strength_AC-1');
  assert(strength?.attempted && strength.verdict?.verdict === 'refuted' && strength.passed,
    'completion must consume the signed AC-1 review and the current real Node execution evidence');
}

async function finishConstruction(host: Host, control: ReturnType<typeof prepare>, step: any): Promise<any> {
  for (let call = 0; step.type === 'phase_execute_request' && call < 16; call++) {
    const raw = JSON.parse(fs.readFileSync(step.request.path, 'utf8'));
    const issued = host.load('scripts/utils/session-execution-handoff').readSessionExecution(raw.context.runDir, step.request.path);
    assert(issued, 'each continuation consumes its real signed execution request');
    const context = issued.request.context, phase = context.phase;
    if (phase === 'work-unit-author') { unitMaterials(host, context); assertFrozenInputs(host, context); }
    else if (phase === 'review') { unitReviewReport(host, context.feature); appendTaggedStrengthReview(host, context); }
    else if (phase.endsWith('-verifier-format-repair')) verifierReply(host, context, phase.replace(/-verifier-format-repair$/, ''));
    else assert.fail('unexpected construction responsibility: ' + phase);
    step = await report(host, control, step, '已读取本次实际请求和材料交回；完成与否由真实检查和独核决定。');
  }
  assertDeliveryComplete(host, control, step);
  return step;
}

/** Synthetic native-format research; the runtime/consumer and final TS/Node execution remain real. */
function mediumSession(host: Host): string {
  const home = path.resolve(__dirname, '../../reports/medium-single-cu/daily-native', path.basename(host.root));
  process.env.CLAUDE_CONFIG_DIR = home;
  const session = 'medium-daily', file = path.join(home, 'projects/fixture', session + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows: object[] = []; let sequence = 0;
  const add = (row: object) => rows.push({ sessionId: session, cwd: host.root, timestamp: new Date().toISOString(), ...row });
  const tool = (name: string, input: object, output: string) => {
    const id = 'medium-tool-' + (++sequence);
    add({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    add({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } });
  };
  const gitText = (args: string[]) => execFileSync('git', args, { cwd: host.root, encoding: 'utf8', stdio: 'pipe' }).trim();
  add({ type: 'user', uuid: 'medium-user', message: { role: 'user', content: REQUIREMENT } });
  tool('Bash', { command: 'git rev-parse HEAD' }, gitText(['rev-parse', 'HEAD']));
  tool('Bash', { command: 'git status --porcelain' }, gitText(['status', '--porcelain']));
  for (const file of [SOURCE, TEST, 'requirements/ledger.md']) tool('Read', { file_path: path.join(host.root, file) }, read(host.root, file));
  add({ type: 'assistant', message: { role: 'assistant', content: `本请求 medium-user：Q1=是；Q2=否；Q3=否；依赖结果=否；跨部件=否；预期明确=是；做法唯一=否。依据 ${SOURCE} 与 ${TEST}。` } });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return file + '#medium-user';
}

async function completeDelivery(medium = false, moduleRevision = false, acceptanceRevision = false, scopeResign = false): Promise<void> {
  const previousHome = process.env.CLAUDE_CONFIG_DIR;
  try { return await withHost(async host => {
    const index = 'doc/component-index.yaml';
    const extraResearch = scopeResign ? ['build-profile.json5', 'src/ledger/src/main/HostModule.ets', 'src/ledger/src/main/module.json5'] : [];
    if (scopeResign) {
      writeHostFile(host.root, index, '# Existing inventory\nschema_version: "1.0"\ncomponents: []\n');
      writeHostFile(host.root, extraResearch[1], 'export const LEDGER_MODULE: string = "ledger";\n');
      writeHostFile(host.root, extraResearch[2], '{ "module": { "name": "ledger", "type": "har" } }\n');
    }
    const control = prepare(host, medium ? 'daily-medium-single' : acceptanceRevision ? 'daily-acceptance-resign' : scopeResign ? 'daily-scope-resign' : 'daily-design-complete', 'claude', medium ? mediumSession(host) : undefined);
    let designAuthors = 0, constructionAuthors = 0, decompositionAuthors = 0, visualReissued = false;
    let acceptanceBefore = '', acceptanceIntermediate = '', acceptanceAfter = '', designRepairs = 0;
    let oldContractBindings: any[] = [], revisedContractFingerprint = '', revisedRunDir = '', revisedFeature = '';
    let step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
    for (let call = 0; step.type === 'phase_execute_request' && call < 16; call++) {
      const raw = JSON.parse(fs.readFileSync(step.request.path, 'utf8'));
      const issued = host.load('scripts/utils/session-execution-handoff').readSessionExecution(raw.context.runDir, step.request.path);
      assert(issued, 'every actor must consume its actual signed execution original');
      const context = issued.request.context, phase = context.phase;
      const currentManifest = JSON.parse(fs.readFileSync(path.join(context.runDir, 'manifest.json'), 'utf8'));
      assert.equal(context.adapterModel, host.load('scripts/utils/adapter-model').adapterModelBinding(currentManifest.adapter_model_pin), 'each actual request inherits the complete manifest binding');
      assert.equal(currentManifest.requirement, REQUIREMENT, 'the original request stays bound across the real actor family');
      if (context.feature !== BLUEPRINT) assert.deepEqual(currentManifest.delivery_origin, { feature: BLUEPRINT, run_id: control.prepared.manifest.run_id });
      if (acceptanceRevision && phase === 'review') break; // The normal entry has already rechecked UT; this probe owns only that recovery segment.
      if (phase === 'work-unit-author' && !visualReissued && !acceptanceRevision) {
        const readVisual = host.load('scripts/utils/phase-state').readGoalVisualProviderEnv;
        const oldVisual = readVisual(context.childEnv);
        assert.equal(oldVisual.provider, 'visual-a');
        const visualProviderPin = { ...oldVisual, provider: 'visual-b' };
        const root = control.entry.prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT,
          adapter: 'claude', requirement: REQUIREMENT, visualProviderPin, modelOverride: true });
        assert.deepEqual(root.manifest.adapter_model_pin, currentManifest.adapter_model_pin);
        control.prepared.manifest = root.manifest;
        const oldRequest = step.request;
        const refused = await control.entry.runGoalModeSessionStep({ ...control.options, requestPath: oldRequest.path, action: 'execute' });
        assert.equal(refused.status, 'waiting'); assert.match(refused.detail, /绑定/);
        assert(!fs.existsSync(path.join(path.dirname(oldRequest.path), 'agent-output.log')));
        step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
        assert.equal(step.phase, phase); assert.notEqual(step.request.sha256, oldRequest.sha256);
        const next = JSON.parse(fs.readFileSync(step.request.path, 'utf8')).context;
        assert.deepEqual(readVisual(next.childEnv), visualProviderPin);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(next.runDir, 'manifest.json'), 'utf8')).visual_provider_pin, visualProviderPin);
        visualReissued = true;
        continue;
      }
      if (phase === 'initial-design-author') assert(context.instruction?.includes(REQUIREMENT));
      if (phase === 'initial-design-questioning') assert(context.instruction?.includes('requirements/ledger.md'), 'blind Q receives the source location before reading it');
      let output = '已按真实签名请求产出当前作者材料，质量由原检查决定。';
      if (phase === 'initial-design-author') {
        assert.equal(++designAuthors, 1, 'normal design returned unexpected author feedback: ' + context.instruction);
        const draft = blueprintDraft(host, false);
        if (moduleRevision) draft.design_views.find((view: any) => view.view_id === 'logical').nodes[0].contracts.modules = [];
        if (scopeResign) {
          draft.providers.find((provider: any) => provider.provider_id === 'component-assets').available = true;
          for (const [factId, file] of [['old-source', SOURCE], ['old-test', TEST], ['old-index', index]]) {
            draft.discovery.facts.push({ fact_id: factId, subject: file, value: read(host.root, file).trim(),
              provenance: { ...draft.provenance, source_ref: file } });
          }
        }
        if (acceptanceRevision) draft.contracts[0].provenance.evidence_strength = 'observed';
        writeYaml(host.root, `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`, draft);
      }
      else if (phase === 'initial-design-questioning') output = questioningReply(host, false);
      else if (phase === 'design-repair-author' && acceptanceRevision) {
        designRepairs++;
        assert.match(context.instruction, /change_unit_contract_not_admitted/);
        assert.match(context.instruction, /当前草稿预装待接受候选/);
        const draftFile = path.join(context.runDir, 'design-repair/component-blueprint.yaml');
        const draft = YAML.parse(fs.readFileSync(draftFile, 'utf8'));
        draft.contracts[0].provenance.evidence_strength = 'authoritative';
        writeYaml(host.root, path.relative(host.root, draftFile), draft);
        fs.writeFileSync(path.join(context.runDir, 'design-repair/change-unit-candidates.json'), '[]\n');
      } else if (phase === 'design-repair-questioning' && acceptanceRevision) {
        output = questioningReply(host, false, path.relative(host.root, path.join(context.runDir, 'design-repair/component-blueprint.yaml')));
      }
      else if (phase === 'initial-design-decomposition') {
        decompositionAuthors++;
        const file = `doc/features/${BLUEPRINT}/blueprint/change-unit-candidates.json`;
        if (medium && decompositionAuthors === 2) {
          assert(context.instruction.includes('自动判为中型') && context.instruction.includes('原分解作者'), 'policy feedback never reached the actual signed author request');
          assert.equal(JSON.parse(read(host.root, file)).length, 2, 'rejected author candidates were discarded');
          assert.equal(host.load('scripts/utils/change-unit-path').enumerateCanonicalChangeUnits(host.root, BLUEPRINT).length, 0, 'multi-CU batch was published before feedback');
          assert(!host.load('scripts/utils/session-execution-handoff').sessionEvents(control.prepared.runDir).some((event: any) => event.type === 'phase_halt'), 'medium feedback became an external halt');
        }
        decompose(host);
        if (medium && decompositionAuthors === 1) {
          const candidates = JSON.parse(read(host.root, file)), second = structuredClone(candidates[0]);
          second.artifact.change_unit_id = UNIT + '-second'; candidates.push(second);
          writeHostFile(host.root, file, JSON.stringify(candidates));
        }
      }
      else if (phase.startsWith('initial-design-scope-')) {
        const feature = host.load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
        host.load('scripts/utils/feature-track').prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
          completionTarget: 'feature', requestedResults: [REQUIREMENT], requestedPhases: ['plan', 'coding', 'ut'], requirement: REQUIREMENT, requirementSourceFiles: ['requirements/ledger.md'],
          impact: { userVisibleBehaviorChange: false, reason: '纯账本余额计算，无新增设备行为',
            basisPaths: [acceptanceRevision ? SOURCE : BASELINE_SOURCE] }, overwrite: true });
      } else if (phase === 'work-unit-author') {
        constructionAuthors++;
        assert(constructionAuthors <= (acceptanceRevision ? 2 : 1), 'construction received unexpected repair feedback: ' + context.instruction);
        if (moduleRevision) {
          const scope = host.load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(host.root, context.feature, context.runId);
          oldContractBindings = scope.obligations.flatMap((obligation: any) => obligation.basis).filter((binding: any) => binding.input_id === 'contracts');
          assert(oldContractBindings.length > 0 && oldContractBindings.every((binding: any) => binding.dependencies.length > 0), 'the original CU must already have a nonempty frozen construction binding');
          const originalFile = host.load('config').featureFilePath(host.root, context.feature, 'contracts.yaml');
          assert(fs.existsSync(originalFile) && oldContractBindings.some((binding: any) => binding.dependencies.some((dependency: any) =>
            path.resolve(dependency.path) === originalFile && dependency.exists && dependency.sha256)), 'the old binding must cover an existing contract artifact, not first materialization');
          if (scopeResign) assertFrozenInputs(host, context);
        }
        if (!acceptanceRevision || constructionAuthors === 1) unitMaterials(host, context, acceptanceRevision, extraResearch);
        else bindControlledAuthor(host, context);
        if (acceptanceRevision) {
          const actions = host.load('scripts/utils/feature-track');
          const scope = host.load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(host.root, context.feature, context.runId);
          const input = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: context.feature, requirement: REQUIREMENT,
            runId: context.runId, runDir: context.runDir };
          const file = host.load('config').resolveFeatureArtifact(host.root, context.feature, 'acceptance.yaml').actualPath;
          const current = fs.readFileSync(file, 'utf8');
          assert.equal(Buffer.from(issued.request.acceptance_preimage, 'base64').toString('utf8'), current);
          const events = host.load('scripts/utils/session-execution-handoff').sessionEvents(context.runDir);
          if (constructionAuthors === 1) acceptanceBefore = current;
          else {
            assert.equal(current, acceptanceIntermediate);
            assert(!events.some((event: any) => event.type === 'scope_revised' && event.trigger?.check_id === 'owned_acceptance_binding'));
            const external = YAML.parse(acceptanceBefore);
            external.criteria[0].requirement_ref = { source_path: 'requirements/ledger.md', snippet: REQUIREMENT, locator: 'external write' };
            try {
              writeYaml(host.root, path.relative(host.root, file), external);
              assert(!actions.refreshOwnedAcceptanceScopeInput(input, scope, events), 'a foreground write after the first signed handback cannot complete the chain');
            } finally { fs.writeFileSync(file, acceptanceIntermediate); }
          }
          const next = YAML.parse(acceptanceBefore);
          next.criteria[0].requirement_ref = { source_path: 'requirements/ledger.md', snippet: REQUIREMENT };
          if (constructionAuthors === 1) next.criteria[0].expected_result = 'Weakened during the first author round';
          writeYaml(host.root, path.relative(host.root, file), next);
          if (constructionAuthors === 1) acceptanceIntermediate = fs.readFileSync(file, 'utf8');
          else acceptanceAfter = fs.readFileSync(file, 'utf8');
          assert(!actions.refreshOwnedAcceptanceScopeInput(input, scope, events), 'pending execution and a foreground overwrite cannot sign a new scope');
          assert(!actions.refreshScopeBindingInput(input, scope)?.facts.flatMap((fact: any) => fact.basis).some((binding: any) =>
            binding.input_id === 'acceptance' && binding.content_fingerprint !== scope.obligations.flatMap((fact: any) => fact.basis)
              .find((prior: any) => prior.input_id === 'acceptance').content_fingerprint), 'semantic edits must not enter through the equivalent-dependency path');
          revisedRunDir = context.runDir;
        }
        if (scopeResign) {
          const scope = host.load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(host.root, context.feature, context.runId);
          const acceptance = scope.obligations.find((fact: any) => fact.kind === 'acceptance-context').basis[0];
          for (const dependency of [SOURCE, TEST, index]) assert(acceptance.dependencies.some((dep: any) => dep.path === path.resolve(host.root, dependency)
            && dep.role === 'artifact' && dep.exists), 'acceptance must already observe ' + dependency);
          const acceptanceFile = host.load('config').featureFilePath(host.root, context.feature, 'acceptance.yaml');
          const adjusted = YAML.parse(fs.readFileSync(acceptanceFile, 'utf8'));
          adjusted.criteria[0].requirement_ref = { source_path: 'requirements/ledger.md', snippet: REQUIREMENT };
          writeYaml(host.root, path.relative(host.root, acceptanceFile), adjusted);
          const prior = new Map(Object.keys(context.childEnv).map(key => [key, process.env[key]]));
          try {
            Object.assign(process.env, context.childEnv);
            host.load('scripts/utils/component-assets').refreshComponentIndex(host.root, context.feature);
          } finally { for (const [key, value] of prior) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
        if (moduleRevision) {
          const file = host.load('config').featureFilePath(host.root, context.feature, 'contracts.yaml');
          const contracts = YAML.parse(fs.readFileSync(file, 'utf8'));
          assert(context.chain.includes('plan'), 'the request must retain its actual authorized mapping producer');
          assert.deepEqual(contracts.modules, [{ name: 'ledger', layer: 'src', package_path: 'src/ledger', format: 'HAR', change_type: 'modify' }],
            'the original producer already completed the uniquely authorized module before the CU was bound');
          const before = structuredClone(contracts);
          contracts.modules[0].export_file = SOURCE;
          writeYaml(host.root, path.relative(host.root, file), contracts);
          const after = YAML.parse(fs.readFileSync(file, 'utf8'));
          assert.equal(after.modules[0].export_file, SOURCE, 'the mapping writer adds the real export entry inside the original frozen file set');
          assert.equal(before.modules[0].export_file, undefined);
          delete before.modules; delete after.modules;
          assert.deepEqual(after, before, 'the authorized module declaration preserves every other bound contract field');
          const binding = host.load('scripts/utils/capability-resolution');
          assert.throws(() => binding.readRunBoundContracts(host.root, host.frameworkRoot, context.feature, context.runId), /input binding stale/,
            'a semantic module declaration cannot be washed through the old frozen binding');
          const scope = host.load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(host.root, context.feature, context.runId);
          const compatible = host.load('scripts/utils/feature-track').refreshScopeBindingInput({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: context.feature, requirement: REQUIREMENT }, scope);
          assert(!compatible || compatible.facts.flatMap((fact: any) => fact.basis).filter((item: any) => item.input_id === 'contracts')
            .every((item: any) => oldContractBindings.some((old: any) => old.content_fingerprint === item.content_fingerprint)), 'without the original producer validation there is no automatic semantic re-sign');
          revisedRunDir = context.runDir; revisedFeature = context.feature;
        }
        if (!acceptanceRevision && !scopeResign) assertFrozenInputs(host, context);
      } else if (phase === 'review') { unitReviewReport(host, context.feature); appendTaggedStrengthReview(host, context); }
      else if (phase.endsWith('-verifier-format-repair')) verifierReply(host, context, phase.replace(/-verifier-format-repair$/, ''));
      else assert.fail('unexpected production responsibility: ' + phase);
      step = await report(host, control, step, output);
      if (phase === 'initial-design-decomposition' && !acceptanceRevision && (!medium || decompositionAuthors === 2)) {
        const selected = { ...control.prepared.manifest.adapter_model_pin, provider: 'https://second-fixture.invalid' };
        const rebound = control.entry.prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT,
          adapter: 'claude', requirement: REQUIREMENT, adapterModelPin: selected, visualProviderPin: { adapter: 'codex', model: 'gpt-6.1-sol', provider: 'visual-a', config_source: path.join(host.root, 'native/config.toml') }, modelOverride: true });
        assert.equal(rebound.manifest.run_id, control.prepared.manifest.run_id);
        control.prepared.manifest = rebound.manifest;
        step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
      }
    }
    if (!acceptanceRevision) assert(visualReissued);
    assert.equal(decompositionAuthors, medium ? 2 : 1);
    assert.equal(constructionAuthors, acceptanceRevision ? 2 : 1);
    if (!acceptanceRevision) assertDeliveryComplete(host, control, step);
    if (acceptanceRevision) {
      assert.equal(designRepairs, 1);
      const events = host.load('scripts/utils/session-execution-handoff').sessionEvents(revisedRunDir);
      const observed = events.flatMap((event: any, at: number) => event.type === 'phase_write_observed' && event.phase === 'work-unit-author'
        && event.owned?.some((write: any) => write.path.endsWith('/acceptance.yaml') && write.roles.some((role: any) => role.source === 'contract:spec.produces(acceptance@1)')) ? [at] : []);
      assert.equal(observed.length, 2);
      const revision = events.findIndex((event: any) => event.type === 'scope_revised' && event.trigger?.check_id === 'owned_acceptance_binding');
      const firstSpec = events.findIndex((event: any) => event.type === 'harness_start' && event.phase === 'spec');
      const secondSpec = events.findIndex((event: any, at: number) => at > revision && event.type === 'harness_start' && event.phase === 'spec');
      const rechecked = events.findIndex((event: any, at: number) => at > secondSpec && event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'PASS');
      assert(firstSpec > observed[0] && observed[1] > firstSpec && revision > observed[1] && secondSpec > revision && rechecked > secondSpec,
        JSON.stringify(events.map((event: any) => [event.type, event.phase, event.verdict, event.reason])));
      const feature = host.load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
      const scope = host.load('scripts/utils/goal-run-creation').loadEffectiveExecutionScope(host.root, feature, path.basename(revisedRunDir));
      const context = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, requirement: REQUIREMENT,
        runId: path.basename(revisedRunDir), runDir: revisedRunDir };
      const acceptanceFile = host.load('config').resolveFeatureArtifact(host.root, feature, 'acceptance.yaml').actualPath;
      try {
        for (const manualEdit of [
          (doc: any) => { doc.criteria = []; },
          (doc: any) => { doc.criteria[0].expected_result = 'Weakened by the foreground'; },
        ]) {
          const doc = YAML.parse(acceptanceAfter); manualEdit(doc);
          writeYaml(host.root, path.relative(host.root, acceptanceFile), doc);
          assert(!host.load('scripts/utils/feature-track').refreshOwnedAcceptanceScopeInput(context, scope, events),
            'a direct foreground edit of a previously accepted obligation must not get a new binding');
        }
      } finally { fs.writeFileSync(acceptanceFile, acceptanceAfter); }
      if (process.env.MAISON_EXPORT_7D2C49E8_REPLAY === '1') {
        const dir = path.resolve(__dirname, '../../reports/7d2c49e8-dev/design-acceptance-continuation'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'before-acceptance.yaml'), acceptanceBefore);
        fs.writeFileSync(path.join(dir, 'intermediate-acceptance.yaml'), acceptanceIntermediate);
        fs.writeFileSync(path.join(dir, 'after-acceptance.yaml'), acceptanceAfter);
        fs.copyFileSync(path.join(revisedRunDir, 'events.jsonl'), path.join(dir, 'cu-events.jsonl'));
        fs.copyFileSync(path.join(control.prepared.runDir, 'events.jsonl'), path.join(dir, 'design-events.jsonl'));
      }
    }
    if (scopeResign) {
      const events = host.load('scripts/utils/session-execution-handoff').sessionEvents(revisedRunDir);
      const author = events.find((event: any) => event.type === 'phase_write_observed' && [SOURCE, TEST, '/acceptance.yaml', '/contracts.yaml']
        .every(file => event.owned?.some((write: any) => write.path.endsWith(file) && write.pre_sha256 !== write.post_sha256)));
      assert(author && events.some((event: any) => event.type === 'phase_write_observed' && event.invoke_id === author.invoke_id
        && event.producer === 'component-index' && event.produced?.some((write: any) => write.path === index)));
      const spec = events.findIndex((event: any) => event.type === 'phase_verdict' && event.phase === 'spec' && event.verdict === 'PASS');
      const specRevision = events.findIndex((event: any) => event.type === 'scope_revised' && event.trigger?.check_id === 'owned_acceptance_binding');
      assert(spec > events.indexOf(author) && specRevision > spec, 'the partial precheck must let formal spec check and preserve its full proposal');
      const design = events[specRevision].execution_scope.obligations.find((fact: any) => fact.kind === 'design-context');
      assert.equal(design.owner_phase, 'plan');
      assert(!design.satisfied_by?.length, 'spec must carry forward plan responsibility with the obsolete contracts proof withdrawn');
      const planVerifier = events.findIndex((event: any) => event.type === 'agent_invoke_start' && event.phase === 'plan-verifier-format-repair');
      assert(planVerifier > specRevision, 'the returned Plan check must reach its independent verifier');
      assert.equal(events.slice(specRevision + 1, planVerifier).filter((event: any) => event.type === 'harness_end' && event.phase === 'plan').length,
        1, 'a changed downstream facts baseline must not repeat the same Plan check');
      const runId = path.basename(revisedRunDir);
      const input = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: revisedFeature,
        requirement: REQUIREMENT, runId, runDir: revisedRunDir };
      const creation = host.load('scripts/utils/goal-run-creation');
      const previous = creation.loadFrozenExecutionScope(host.root, revisedFeature, runId);
      const { refreshOwnedAcceptanceScopeInput } = host.load('scripts/utils/feature-track');
      assert(refreshOwnedAcceptanceScopeInput(input, previous, events), 'the unchanged postimages retain their signed provenance');
      const indexPath = path.join(host.root, index), indexBytes = fs.readFileSync(indexPath);
      try {
        fs.appendFileSync(indexPath, '\n# Foreground overwrite after the framework producer\n');
        assert(!refreshOwnedAcceptanceScopeInput(input, previous, events), 'a later foreground index write cannot use the earlier producer proof');
      } finally { fs.writeFileSync(indexPath, indexBytes); }
      const planEvidence = host.load('scripts/utils/phase-evidence-manifest').loadPhaseEvidenceManifest(host.root, revisedFeature, 'plan');
      const effective = creation.resolveEffectiveScopeSource(host.root, revisedFeature, runId).scope;
      const active = effective.obligations.find((fact: any) => fact.id === design.id);
      assert(planEvidence?.integrityOk && active.satisfied_by?.some((proof: any) => proof.phase === 'plan' && proof.run_id === runId
        && proof.evidence_manifest_aggregate === planEvidence.manifest.aggregate_sha256), 'the current closed plan is the contracts proof in the effective scope');
      assert(events.some((event: any, at: number) => at > specRevision && event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'PASS'));
      const resume = await control.entry.runGoalModeSessionStep(control.options);
      assert.equal(resume.result.status, 'completed');
      const afterResume = host.load('scripts/utils/session-execution-handoff').sessionEvents(revisedRunDir);
      assert.deepEqual(afterResume.filter((event: any) => event.type === 'scope_revised' || event.type === 'agent_invoke_start'),
        events.filter((event: any) => event.type === 'scope_revised' || event.type === 'agent_invoke_start'));
    }
    if (moduleRevision && !scopeResign) {
      const events = host.load('scripts/utils/session-execution-handoff').sessionEvents(revisedRunDir);
      const plan = events.findIndex((event: any, at: number) => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict === 'PASS'
        && events.slice(0, at).some((end: any) => end.type === 'harness_end' && end.phase === 'plan' && end.invoke_id === event.invoke_id && !end.timed_out));
      const revision = events.findIndex((event: any, at: number) => at > plan && event.type === 'scope_revised'
        && event.trigger?.phase === 'plan' && event.execution_scope.obligations.flatMap((obligation: any) => obligation.basis)
          .some((binding: any) => binding.input_id === 'contracts' && !oldContractBindings.some((old: any) => old.content_fingerprint === binding.content_fingerprint)));
      assert(plan >= 0 && revision > plan, 'only the actual mapping producer check may publish the new semantic contract binding');
      const current = events[revision].execution_scope.obligations.flatMap((obligation: any) => obligation.basis).find((binding: any) => binding.input_id === 'contracts');
      revisedContractFingerprint = current.content_fingerprint;
      assert(events.some((event: any, at: number) => at > revision && event.type === 'phase_verdict' && event.phase === 'ut' && event.verdict === 'PASS'
        && events.slice(revision + 1, at).some((end: any) => end.type === 'harness_end' && end.phase === 'ut' && end.invoke_id === event.invoke_id && !end.timed_out)), 'the original CU must actually execute UT against the new binding');
      const evidence = { oldContractBindings, revisedContractFingerprint, constructionAuthors, events: events.filter((event: any) => ['agent_invoke_start','agent_invoke_end','phase_write_observed','harness_end','phase_verdict','scope_revised','run_end'].includes(event.type)),
        nodeTap: read(host.root, path.relative(host.root, path.join(host.load('config').featurePhaseReportsDir(host.root, revisedFeature, 'ut', host.frameworkRoot), 'node-tests.tap'))) };
      const reportFile = path.resolve(__dirname, '../../reports/4c8d73b1-dev/semantic-module-owner-runtime.json');
      fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(evidence, null, 2) + '\n');
    }
  }); } finally { if (previousHome === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousHome; }
}

const cases = [{
  name: '3f8a6c21 mixed DSH findings repair the original design and return to the CU with zero manual resume',
  run: async () => withHost(async host => {
    const config = JSON.parse(read(host.root, 'framework.config.json')); config.materialized_adapters.push('deepseek-harness');
    writeHostFile(host.root, 'framework.config.json', JSON.stringify(config));
    writeHostFile(host.root, 'framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'deepseek-harness', vision: { image_input_override: 'none' } }));
    host.load('config').clearFrameworkConfigCache();
    // Existing assertions are not rewritten to bypass the independent test-strength obligation.
    const priorAssertion = `\nit('[BRANCH-success][AC-1] ledger-refresh preserves a negative balance', () => {\n  expect(LedgerFeature.add([-20], -5).balance).toEqual(-25);\n});\n`;
    const existingTests = TEST_TEXT.split('\n').slice(0, 4).join('\n') + '\n' + priorAssertion;
    writeHostFile(host.root, TEST, existingTests); git(host.root, ['add', '-A']); git(host.root, ['commit', '-qm', 'Existing ledger assertion before the requested implementation']);
    const control = prepare(host, '3f8a6c21-mixed-design', 'deepseek-harness');
    const currentTests = TEST_TEXT + priorAssertion;
    const canonical = `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`;
    const draft = `${control.prepared.manifest.report_dir}/design-repair/component-blueprint.yaml`;
    const logical = (doc: any) => doc.design_views.find((view: any) => view.view_id === 'logical').nodes[0];
    let step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
    let authors = 0, reviews = 0, designRepairs = 0, refused = false, authorFindingDelivered = false;
    let lastReviewInput: unknown;
    const childDirs = new Set<string>();
    for (let call = 0; step.type === 'phase_execute_request' && call < 32; call++) {
      const issued = JSON.parse(fs.readFileSync(step.request.path, 'utf8')), context = issued.context;
      const phase = context.phase;
      let output = '已按本次签发职责交回真实材料；机器检查决定完成。';
      if (phase === 'initial-design-author') {
        const doc = blueprintDraft(host, false);
        logical(doc).use_cases.use_cases[0].ui_bindings = [{ ui: 'LedgerPanel', role: 'entry', user_actions: [{ trigger: '提交账目', calls: ['NavPathStack.pushPath', 'NavPathStack.clear'] }] }];
        writeYaml(host.root, canonical, doc);
      } else if (phase === 'initial-design-questioning') output = questioningReply(host, false);
      else if (phase === 'initial-design-decomposition') decompose(host);
      else if (phase.startsWith('initial-design-scope-')) {
        const feature = host.load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
        host.load('scripts/utils/feature-track').prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
          completionTarget: 'feature', requestedResults: [REQUIREMENT], requestedPhases: ['plan', 'coding', 'review', 'ut'], requirement: REQUIREMENT,
          requirementSourceFiles: ['requirements/ledger.md'], impact: { userVisibleBehaviorChange: false, reason: '复用现有纯账本余额计算，保持原内部调用，无新增设备行为', basisPaths: [BASELINE_SOURCE] }, overwrite: true });
      } else if (phase === 'work-unit-author') {
        authors++; childDirs.add(context.runDir);
        unitMaterials(host, { ...context, chain: context.chain.filter((family: string) => family !== 'review') });
        writeHostFile(host.root, TEST, currentTests);
        const facts = host.load('config').featureFilePath(host.root, context.feature, 'context/facts.md');
        if (authors === 1) fs.appendFileSync(facts, '\n## 当前验证声明\n真实Node用例数: 99\n');
        if (context.instruction.includes('named_business_handler') && context.instruction.includes('NavPathStack')) {
          refused = true;
          output = `拒修：NavPathStack.pushPath/clear在工程内没有声明，它们来自蓝图的错误业务入口声明；本CU不能改共享蓝图 ${canonical}。请独立审查并交原设计职责。`;
        }
        if (context.instruction.includes('CR-011')) {
          authorFindingDelivered = true;
          fs.appendFileSync(facts, '\n真实Node用例数: 3（已对照实际测试原件纠正）\n');
        }
      } else if (phase === 'review') {
        reviews++;
        const currentIssues = host.load('scripts/utils/repair-candidates').readPhaseRepairIssues(host.root, context.feature, 'review', { frameworkRoot: host.frameworkRoot, runId: context.runId });
        lastReviewInput = { native: currentIssues?.independentReviewRows, feedback: context.instruction.split('\n').filter((line: string) => line.includes('CR-') || line.includes('negative_verdict_closure')) };
        assert(!context.instruction.includes('仅修补已有报告'), 'mixed business findings require independent semantic review');
        const feature = context.feature;
        const factsPath = host.load('config').featureFilePath(host.root, feature, 'context/facts.md');
        const factsRel = path.relative(host.root, factsPath).replace(/\\/g, '/');
        const badCall = logical(YAML.parse(read(host.root, canonical))).use_cases.use_cases[0].ui_bindings[0].user_actions[0].calls.some((value: string) => value.startsWith('NavPathStack.'));
        const badFacts = !fs.readFileSync(factsPath, 'utf8').includes('真实Node用例数: 3（');
        if (badCall) assert(refused, 'the actual named-handler failure and author refusal precede independent confirmation');
        unitReviewReport(host, feature);
        const reportPath = host.load('config').featureFilePath(host.root, feature, 'review/review-report.md');
        let text = fs.readFileSync(reportPath, 'utf8');
        const rows = [
          ...badCall ? [`| CR-001 | 接口不一致 | BLOCKER | \`${canonical}:1\` 将 NavPathStack.pushPath/clear 写为本CU业务入口；作者已据当前源码拒修 | ${canonical} | 原设计方把错误平台calls改为真实LedgerFeature.add业务入口 |`] : [],
          ...badFacts ? [`| CR-011 | 逻辑错误 | MAJOR | \`${factsRel}:1\` 声称99条，\`${TEST}:1\` 真实只有3条；应如实纠正 | ${factsRel} | 原单元作者修正实际验证声明为3条 |`] : [],
        ];
        text = text.replace('\n\n## 4. 问题统计', '\n' + rows.join('\n') + '\n\n## 4. 问题统计')
          .replace('| BLOCKER | 0 |', `| BLOCKER | ${badCall ? 1 : 0} |`).replace('| MAJOR | 0 |', `| MAJOR | ${badFacts ? 1 : 0} |`)
          .replace('**审查结论**: 通过', `**审查结论**: ${rows.length ? '不通过' : '通过'}`);
        const codingReport = JSON.parse(fs.readFileSync(path.join(host.load('config').featurePhaseReportsDir(host.root, feature, 'coding', host.frameworkRoot), 'script-report.json'), 'utf8'));
        const strength = codingReport.checks.find((check: any) => check.id === 'coding_existing_test_preserved' && check.affected_files?.length);
        const verification = taggedStrengthRows(host, context) as Array<{ issue: string; verdict: string; evidence: string; production_paths?: string[] }>;
        if (strength) {
          const original = host.load('scripts/utils/repair-responsibility').codingTestPreservation({ projectRoot: host.root, feature, runId: context.runId, file: TEST });
          assert.equal(original.beforeText, existingTests, 'independent review reads the real original assertion');
          assert.equal(read(host.root, TEST), currentTests, 'the old negative-balance assertion remains and both required cases are added');
          verification.push({ issue: strength.id, verdict: 'refuted',
            evidence: `${TEST}；${strength.details}；原负余额断言逐字保留，新增增额及恢复断言直接驱动LedgerFeature.add/restore；未删弱或跳过原断言。` });
        }
        if (verification.length) text += '\n```issue-verification\n' + YAML.stringify(verification) + '```\n';
        fs.writeFileSync(reportPath, text);
      } else if (phase === 'design-repair-author') {
        designRepairs++;
        assert(context.instruction.includes('CR-001') && context.instruction.includes('NavPathStack'), 'the design brief must carry the actual finding, not only a hash mismatch: ' + context.instruction.split('\n').filter((line: string) => line.includes('依据：') || line.includes('问题：')).join('\n'));
        const doc = YAML.parse(read(host.root, draft));
        logical(doc).use_cases.use_cases[0].ui_bindings[0].user_actions[0].calls = ['LedgerFeature.add'];
        writeYaml(host.root, draft, doc);
      } else if (phase === 'design-repair-questioning') output = questioningReply(host, false, draft);
      else if (phase.endsWith('-verifier-format-repair')) {
        const family = phase.replace(/-verifier-format-repair$/, '');
        assert(['spec', 'plan', 'coding', 'review', 'ut'].includes(family), 'unexpected stage verifier: ' + family);
        const reviewIssues: Array<{ issue: string; verdict: 'confirmed'; evidence: string }> = [];
        if (family === 'review') {
          const issues = host.load('scripts/utils/repair-candidates').readPhaseRepairIssues(host.root, context.feature, family,
            { frameworkRoot: host.frameworkRoot, runId: context.runId });
          const calls = logical(YAML.parse(read(host.root, canonical))).use_cases.use_cases[0].ui_bindings[0].user_actions[0].calls;
          const facts = host.load('config').featureFilePath(host.root, context.feature, 'context/facts.md');
          for (const row of issues?.rows ?? []) {
            if (row.id === 'CR-001') assert(calls.some((value: string) => value.startsWith('NavPathStack.')));
            else if (row.id === 'CR-011') {
              const contents = fs.readFileSync(facts, 'utf8');
              assert(contents.includes('真实Node用例数: 99') && !contents.includes('真实Node用例数: 3（'));
              assert.equal(read(host.root, TEST), currentTests);
            } else assert.fail('unexpected review finding: ' + row.id);
            reviewIssues.push({ issue: row.id, verdict: 'confirmed', evidence: [...row.files, row.summary].join('；') });
          }
        }
        verifierReply(host, context, family, { testText: currentTests, beforeText: existingTests, testCount: 3, reviewIssues });
      } else assert.fail('undeclared extra responsibility: ' + phase);
      step = await report(host, control, step, output);
    }
    const observation = step.result?.status === 'waiting' ? host.load('scripts/utils/initial-design-delivery').readInitialDesignDelivery({
      projectRoot: host.root, frameworkRoot: host.frameworkRoot, manifest: control.prepared.manifest }) : undefined;
    assert(step.result?.status !== 'waiting', JSON.stringify({ step, authors, reviews, designRepairs, refused, authorFindingDelivered, lastReviewInput,
      observation: observation && { kind: observation.kind, issues: observation.issues, designRepair: observation.designRepair,
        disposition: observation.disposition, progression: observation.progression && { action: observation.progression.action, activeRun: observation.progression.activeRun,
          reasons: observation.progression.reasons, units: observation.progression.readySet.units.map((unit: any) => ({ id: unit.changeUnit.change_unit_id,
            problems: unit.completion.currentDisposition?.completionBlocking })) } } }));
    assertDeliveryComplete(host, control, step, currentTests, 3);
    assert(designRepairs >= 1 && authorFindingDelivered && reviews >= 2, 'both design and author findings must close through their actual owners');
    const events = [...childDirs].flatMap(dir => host.load('scripts/utils/session-execution-handoff').sessionEvents(dir));
    assert(events.some((event: any) => event.type === 'phase_halt' && event.design_authority?.items.some((item: any) => item.basis.includes('CR-001'))));
    assert(events.some((event: any) => event.type === 'agent_invoke_start' && event.phase === 'plan-verifier-format-repair'
      && event.purpose === 'verifier_format_repair'), 'DSH must run the issued Plan verification through the shared runtime');
    assert(!events.some((event: any) => event.type === 'agent_invoke_start' && event.purpose === 'verifier'), 'the shared entry remains the only stage verifier dispatcher');
  }),
}, {
  name: 'daily design: empty request reaches canonical CU completion with real TypeScript and Node assertions',
  run: () => completeDelivery(false, true),
}, {
  name: '3bc1f4ed daily design: signed source, tests and inventory preserve the spec proposal through plan and real Node assertions',
  run: () => completeDelivery(false, true, false, true),
}, {
  name: '7d2c49e8 managed runtime repairs closure, retains an omitted candidate, re-signs changed acceptance and runs the dependent check',
  run: () => completeDelivery(false, false, true),
}, {
  name: 'medium automatic decomposition returns multi-CU feedback to its author and completes one CU with real TypeScript and Node assertions',
  run: () => completeDelivery(true),
}, {
  name: 'daily design: missing reference repair and unchanged denial converge through original feedback',
  run: async () => {
    for (const repair of [true, false]) await withHost(async host => {
      const control = prepare(host, 'daily-design-missing-' + repair);
      let step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
      assert.equal(step.phase, 'initial-design-author');
      const blueprintPath = `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`;
      writeYaml(host.root, blueprintPath, blueprintDraft(host, true));
      step = await report(host, control, step, '当前真实设计尚引用待确认来源，交独立质询。');
      assert.equal(step.phase, 'initial-design-questioning', JSON.stringify(step));
      step = await report(host, control, step, questioningReply(host, true));
      assert.equal(step.phase, 'initial-design-author', JSON.stringify(step));
      const original = JSON.parse(fs.readFileSync(step.request.path, 'utf8'));
      assert(original.context.instruction.includes(MISSING), 'the complete current missing-source denial must reach its original author');
      if (repair) {
        const document = YAML.parse(read(host.root, blueprintPath));
        document.provenance.source_ref = 'src/ledger/LedgerRepository.ts';
        writeYaml(host.root, blueprintPath, document);
      }
      const authorStep = step;
      step = await report(host, control, step, repair ? '已读取现有Repository，修正设计依据；未伪造缺失文件。' : '已读取完整当前否定，本次原样交回，没有任何改动。');
      if (repair) {
        assert.equal(step.phase, 'initial-design-questioning', JSON.stringify(step));
        step = await report(host, control, step, questioningReply(host, false));
        assert.equal(step.phase, 'initial-design-decomposition', JSON.stringify(step));
      } else {
        assert.equal(step.type, 'goal_session_result', JSON.stringify(step));
        assert.equal(step.result.halt_reason, 'no_progress_guard');
        const events = () => host.load('scripts/utils/session-execution-handoff').sessionEvents(control.prepared.runDir);
        const calls = events().filter((event: any) => event.type === 'agent_invoke_start').length;
        const repeated = await report(host, control, authorStep, '已读取完整当前否定，本次原样交回，没有任何改动。');
        assert(repeated.duplicate);
        const observed = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
        assert.equal(observed.result.halt_reason, 'no_progress_guard');
        assert.equal(events().filter((event: any) => event.type === 'agent_invoke_start').length, calls);
        assert(!events().some((event: any) => event.type === 'run_end' && event.status === 'COMPLETED'));
      }
      assert(!fs.existsSync(path.join(host.root, MISSING)), 'a design source correction must not fabricate the absent dependency');
    });
  },
}, {
  name: 'daily design: root repair checks real CU consumers, repairs weak authority and bounds unchanged handback',
  run: async () => {
    for (const repair of [false, true]) await withHost(async host => {
      const control = prepare(host, 'daily-design-authority-' + repair);
      const canonical = `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`;
      const draft = `${control.prepared.manifest.report_dir}/design-repair/component-blueprint.yaml`;
      const logical = (doc: any) => doc.design_views.find((view: any) => view.view_id === 'logical').nodes[0];
      let authors = 0, step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
      for (let turn = 0; step.type === 'phase_execute_request' && turn < 10; turn++) {
        if (step.phase === 'work-unit-author') break;
        const phase = step.phase;
        let output = '实际作者材料已交回，由原检查决定是否完成。';
        if (phase === 'initial-design-author') {
          const doc = blueprintDraft(host, false); logical(doc).provenance.evidence_strength = 'observed';
          writeYaml(host.root, canonical, doc);
        } else if (phase === 'initial-design-questioning') output = questioningReply(host, false);
        // This recovery case starts from a legacy CU whose weak design never published a construction mapping.
        else if (phase === 'initial-design-decomposition') decompose(host, false);
        else if (phase === 'design-repair-author') {
          authors++;
          const request = JSON.parse(fs.readFileSync(step.request.path, 'utf8'));
          assert(request.context.instruction.includes('authority_target_provenance_missing'), 'the real CU consumer gap must reach its design owner');
          if (repair) {
            const doc = YAML.parse(read(host.root, draft)); logical(doc).provenance.evidence_strength = 'authoritative'; writeYaml(host.root, draft, doc);
            const unit = host.load('scripts/utils/change-unit-path').loadCanonicalChangeUnit(host.root, BLUEPRINT, UNIT).changeUnit;
            writeHostFile(host.root, `${control.prepared.manifest.report_dir}/design-repair/change-unit-candidates.json`, JSON.stringify([{ providerId: 'builtin-vertical-slice-decomposition', artifact: unit,
              construction_mapping: authorConstructionMapping(unit, EVIDENCE_REFS.map(ref => 'planned:' + ref)) }]));
          }
        } else if (phase === 'design-repair-questioning') output = questioningReply(host, false, draft);
        else if (phase.startsWith('initial-design-scope-')) {
          const feature = host.load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
          host.load('scripts/utils/feature-track').prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
            completionTarget: 'feature', requestedResults: [REQUIREMENT], requestedPhases: ['plan', 'coding', 'ut'], requirement: REQUIREMENT, requirementSourceFiles: ['requirements/ledger.md'],
            impact: { userVisibleBehaviorChange: false, reason: '复用现有纯账本余额计算，保持原内部调用，无新增设备行为', basisPaths: [BASELINE_SOURCE] }, overwrite: true });
        } else assert.fail('unexpected design repair responsibility: ' + phase);
        step = await report(host, control, step, output);
      }
      const events = host.load('scripts/utils/session-execution-handoff').sessionEvents(control.prepared.runDir);
      const published = events.filter((event: any) => event.type === 'design_authority_repair' && event.stage === 'published');
      assert(authors > 0 && authors <= 2, 'the owner receives the actual deficit without an unbounded retry');
      if (repair) {
        assert.equal(step.phase, 'work-unit-author', JSON.stringify(step));
        assert.equal(published.length, 1, 'one actual business repair publishes once');
        assert.equal(published[0].outcome, 'recovered');
        step = await finishConstruction(host, control, step);
      } else {
        assert.equal(step.type, 'goal_session_result', JSON.stringify(step));
        assert.equal(step.result.status, 'waiting');
        assert(['no_progress_guard', 'executor_waiting'].includes(step.result.halt_reason), JSON.stringify(step));
        if (step.result.halt_reason === 'executor_waiting') assert.match(step.result.recovery.halt_guidance, /没有新的可执行工作/);
        assert.equal(published.length, 0, 'unchanged weak authority cannot be mechanically republished');
        const calls = events.filter((event: any) => event.type === 'agent_invoke_start').length;
        await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
        const after = host.load('scripts/utils/session-execution-handoff').sessionEvents(control.prepared.runDir);
        assert.equal(after.filter((event: any) => event.type === 'agent_invoke_start').length, calls, 'unchanged reentry cannot purchase another author or Q');
        assert.equal(after.filter((event: any) => event.type === 'design_authority_repair' && event.stage === 'published').length, 0);
      }
    });
  },
}, {
  name: 'daily design: a framework entry fault leaves business repair executable and restoration completes the same CU',
  run: () => withHost(async host => {
    const nativeFile = path.join(host.frameworkRoot, 'profiles/hmos-app/harness/coding-host-rules.js');
    const original = fs.readFileSync(nativeFile, 'utf8');
    const anchor = 'checkCodingCompile: ctx => {';
    assert.equal(original.split(anchor).length, 2);
    const broken = original.replace(anchor, anchor + " require('fs').readFileSync(require('path').join(__dirname, 'p4-missing-native-driver.cjs')); ");
    // Install the real provider fault before any actor preimage; the actors never edit framework.
    fs.writeFileSync(nativeFile, broken);
    const control = prepare(host, 'p4-framework-entry-recovery');
    let step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep(control.options));
    for (let call = 0; step.type === 'phase_execute_request' && step.phase !== 'work-unit-author' && call < 12; call++) {
      let output = '已读取本次设计请求并交回材料，继续由实际检查判定。';
      if (step.phase === 'initial-design-author') writeYaml(host.root, `doc/features/${BLUEPRINT}/blueprint/component-blueprint.yaml`, blueprintDraft(host, false));
      else if (step.phase === 'initial-design-questioning') output = questioningReply(host, false);
      else if (step.phase === 'initial-design-decomposition') decompose(host);
      else if (step.phase.startsWith('initial-design-scope-')) {
        const feature = host.load('scripts/utils/change-unit-path').deriveChangeUnitFeatureId(BLUEPRINT, UNIT);
        host.load('scripts/utils/feature-track').prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
          completionTarget: 'feature', requestedResults: [REQUIREMENT], requestedPhases: ['plan', 'coding', 'ut'], requirement: REQUIREMENT, requirementSourceFiles: ['requirements/ledger.md'],
          impact: { userVisibleBehaviorChange: false, reason: '复用现有纯账本余额计算，保持原内部调用，无新增设备行为', basisPaths: [BASELINE_SOURCE] }, overwrite: true });
      } else assert.fail('unexpected preparation responsibility: ' + step.phase);
      step = await report(host, control, step, output);
    }
    assert.equal(step.phase, 'work-unit-author', JSON.stringify(step));
    let authors = 0, reviewers = 0, childRunDir = '', observedMixed = false;
    for (let call = 0; step.type === 'phase_execute_request' && call < 16; call++) {
      const raw = JSON.parse(fs.readFileSync(step.request.path, 'utf8'));
      const issued = host.load('scripts/utils/session-execution-handoff').readSessionExecution(raw.context.runDir, step.request.path);
      assert(issued); const context = issued.request.context;
      if (context.phase === 'work-unit-author') {
        authors++; childRunDir = context.runDir;
        assert.equal(authors, 1, 'a missing independent report cannot repurchase the implementation author');
        unitMaterials(host, context); assertFrozenInputs(host, context);
        if (authors === 1) {
          const review = host.load('config').featureFilePath(host.root, context.feature, 'review/review-report.md');
          assert(fs.existsSync(review)); fs.unlinkSync(review);
        }
      } else if (context.phase === 'review') {
        reviewers++;
        assert.equal(reviewers, 1, 'the independent report writer runs once for its actual deficit');
        assert.equal(issued.request.write_boundary.executionRole, 'verifier');
        const disposition = host.load('scripts/utils/verify-feature-completion').resolveCompletionDisposition({ projectRoot: host.root, frameworkRoot: host.frameworkRoot,
          feature: context.feature, runId: context.runId, chain: context.chain, endpoint: 'request' });
        assert(disposition.completionBlocking.some((problem: any) => problem.owner === 'framework' && problem.action === 'wait'), JSON.stringify(disposition));
        const repairs = disposition.completionBlocking.filter((problem: any) => problem.phase === 'review' && problem.action === 'repair');
        assert(repairs.some((problem: any) => context.instruction.includes(problem.id)), 'the independent writer receives the actual report deficit');
        assert.equal(read(host.root, SOURCE), PRODUCT);
        unitReviewReport(host, context.feature);
        appendTaggedStrengthReview(host, context);
        observedMixed = true;
      } else if (context.phase.endsWith('-verifier-format-repair')) verifierReply(host, context, context.phase.replace(/-verifier-format-repair$/, ''));
      else assert.fail('unexpected mixed-fault responsibility: ' + context.phase);
      step = await report(host, control, step, '实际可做的业务材料已处理；未改framework，工具原件决定剩余故障和完成。');
      assert.equal(fs.readFileSync(nativeFile, 'utf8'), broken, 'no actor repairs the framework on its own authority');
    }
    assert(observedMixed && authors === 1 && reviewers === 1);
    assert.equal(step.type, 'goal_session_result', JSON.stringify(step));
    assert.equal(step.result.status, 'waiting', JSON.stringify(step));
    const handoff = host.load('scripts/utils/session-execution-handoff');
    const beforeAuthors = handoff.sessionEvents(childRunDir).filter((event: any) => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length;
    // The external condition is restored between invocations, with no active actor write authority.
    fs.writeFileSync(nativeFile, original);
    // Framework code repair restarts the coordinator; it does not hot-swap cached Node modules.
    for (const file of Object.keys(require.cache)) if (file.startsWith(host.frameworkRoot + path.sep)) delete require.cache[file];
    control.entry = host.load('scripts/goal-mode-entry');
    step = await withRuntimeTest({ root: host.root }, () => control.entry.runGoalModeSessionStep({ ...control.options, forceTakeover: true }));
    await finishConstruction(host, control, step);
    const afterAuthors = handoff.sessionEvents(childRunDir).filter((event: any) => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length;
    assert.equal(afterAuthors, beforeAuthors, 'restored tools verify accepted work without buying another author');
  }),
}];

export const listCaseGroups = () => unitCaseGroups(cases.map(test => test.name));
export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) if (matchesUnitCase(test.name, selector)) {
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: error instanceof Error ? error.stack : String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
