import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, conventionsPath, relConventions, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { checkConventionsCoverage } from '../../scripts/check-review';
import { collectContextFiles } from '../../harness-runner';
import { assembleAIPrompt } from '../../scripts/utils/report-generator';
import { prepareConfigWriteForTask } from '../../scripts/utils/config-builder';
import { mergeBackfillFields } from '../../scripts/utils/config-field-merger';
import { DEFAULT_LAYOUT, ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import { CheckContext, ContractsSpec } from '../../scripts/utils/types';
import { fingerprintDiscoverySources } from '../../scripts/utils/blueprint-discovery';
import { currentScopeItems } from '../../scripts/utils/blueprint-requirement-traceability';
import { asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { componentBlueprintPath, loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, createChangeUnitRef, deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { renderBlueprintReviewMarkdown } from '../../scripts/utils/blueprint-review-projection';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { checkCanonicalComponentBlueprint, checkHostSeamMaterials } from '../../scripts/check-component-blueprint';

const FRAMEWORK_ROOT = DEFAULT_LAYOUT.frameworkRoot;
const ASSET = '# 工程惯例\n\n## repository-fields\n\n规则：MUST 复用 Repository 字段。\n范例：`src/repository.ts#load`\n';
const GATE = '\n## gate-card\n\nenforcement: gate\ngate_ref: review/required_chapters\n';
const ledger = (rows = '| repository-fields | PASS | 已核对目标源码与范例 |') => `## 工程惯例覆盖台账\n\n| 惯例 id | 判定 | 依据 |\n|---|---|---|\n${rows}\n\n## 问题清单\n无问题\n`;
function write(root: string, rel: string, text: string) { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); }
function withProject(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-conventions-'));
  ensureConsumerFrameworkTree(root);
  try { clearFrameworkConfigCache(); run(root); } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}
function contracts(): ContractsSpec {
  return { feature: 'demo', source: 'unit', version: '1', modules: [], module_dependencies: {}, data_models: [], interfaces: [], components: [], files: ['src/data/item.ts'], conventions_applied: [{ id: 'repository-fields', planned_locations: ['src/data'] }] };
}
function context(root: string, value = contracts(), feature = value.feature): CheckContext {
  return { projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, frameworkRel: '', harnessRoot: path.join(FRAMEWORK_ROOT, 'harness'), layoutKind: 'standalone', feature, phase: 'review',
    featureSpec: { feature, contracts: value }, phaseRule: new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT).loadPhaseRule('review'),
    resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root)) };
}
const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void) { cases.push({ name, run }); }

test('config CREATE 默认 / UPDATE keep-overwrite 不回填 / helper 一致且不创建资产', () => withProject(root => {
  const payload = { project_name: 'demo', project_profile: { name: 'generic' }, materialized_adapters: ['cursor'], architecture: { outer_layers: [{ id: 'src', can_depend_on: [], intra_layer_deps: 'forbid' }], module_inner_layers: ['data'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ts' } };
  const created = prepareConfigWriteForTask({ projectRoot: root, configWritePayload: payload }, 'run');
  assert.equal((created.paths as Record<string, unknown>).conventions, 'doc/conventions.md');
  delete (created.paths as Record<string, unknown>).conventions;
  write(root, 'framework.config.json', JSON.stringify(created));
  const before = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8');
  const kept = mergeBackfillFields(created, 'generic').merged;
  const overwritten = prepareConfigWriteForTask({ projectRoot: root, configWritePayload: created }, 'overwrite');
  for (const config of [created, kept, overwritten]) {
    assert(!Object.prototype.hasOwnProperty.call(config.paths, 'conventions'));
    write(root, 'framework.config.json', JSON.stringify(config)); clearFrameworkConfigCache();
    assert.equal(conventionsPath(root), path.join(root, 'doc/conventions.md'));
    assert(!fs.existsSync(conventionsPath(root)));
  }
  assert.equal(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'), before);
  write(root, 'framework.config.json', JSON.stringify({ ...created, paths: { conventions: 'knowledge/practices.md' } })); clearFrameworkConfigCache();
  assert.equal(relConventions(root), 'knowledge/practices.md');
  assert.equal(conventionsPath(root), path.join(root, 'knowledge/practices.md'));
}));

for (const [name, value] of Object.entries({
  non_array: {}, null_value: null, missing_id: [{ planned_locations: ['src/data'] }], empty_locations: [{ id: 'x', planned_locations: [] }],
  absolute: [{ id: 'x', planned_locations: ['/outside'] }], traversal: [{ id: 'x', planned_locations: ['../outside'] }],
  backslash: [{ id: 'x', planned_locations: ['src\\data'] }], glob: [{ id: 'x', planned_locations: ['src/*'] }],
  duplicate: [{ id: 'x', planned_locations: ['src'] }, { id: 'x', planned_locations: ['src/data'] }],
})) test(`loader rejects ${name} through shape_issues`, () => withProject(root => {
  write(root, 'doc/features/demo/contracts.yaml', YAML.stringify({ ...contracts(), conventions_applied: value }));
  const loaded = new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT).loadFeatureSpec('demo');
  assert(loaded.shape_issues?.some(issue => issue.includes('conventions_applied')));
}));
test('loader canonicalizes locations once', () => withProject(root => {
  write(root, 'doc/features/demo/contracts.yaml', YAML.stringify({ ...contracts(), conventions_applied: [{ id: ' x ', planned_locations: ['src/./data/'] }] }));
  const loaded = new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT).loadFeatureSpec('demo');
  assert.deepEqual(loaded.contracts?.conventions_applied, [{ id: 'x', planned_locations: ['src/data'] }]);
  assert(!loaded.shape_issues?.length);
}));

const mutations: Array<[string, (input: { asset: string; report: string; contracts: ContractsSpec }) => void, string]> = [
  ['missing ledger id', i => { i.asset += '\n## second\n'; }, '精确相等'],
  ['invalid verdict', i => { i.report = ledger('| repository-fields | MAYBE | 未知 |'); }, '判定值非法'],
  ['duplicate heading', i => { i.asset += '\n## repository-fields\n'; }, '惯例标题 id 重复'],
  ['duplicate ledger', i => { i.report = ledger('| repository-fields | PASS | a |\n| repository-fields | PASS | b |'); }, '覆盖台账 id 重复'],
  ['duplicate declaration', i => { i.contracts.conventions_applied!.push(i.contracts.conventions_applied![0]); }, 'conventions_applied id 重复'],
  ['unknown declaration', i => { i.contracts.conventions_applied![0].id = 'absent'; }, '引用不存在'],
  ['violation without issue', i => { i.report = ledger('| repository-fields | VIOLATION | 违反 |'); }, '未在问题清单'],
  ['unfulfilled location', i => { i.contracts.conventions_applied![0].planned_locations = ['src/nope']; }, '未命中'],
  ['segment collision', i => { i.contracts.files = ['src/database/item.ts']; }, '未命中'],
  ['unknown gate phase', i => { i.asset = ASSET + GATE.replace('review/required_chapters', 'absent/required_chapters'); i.report = ledger('| repository-fields | PASS | a |\n| gate-card | GATE_DELEGATED | checker |'); }, 'gate_ref 无效'],
  ['unknown gate rule', i => { i.asset = ASSET + GATE.replace('required_chapters', 'absent'); i.report = ledger('| repository-fields | PASS | a |\n| gate-card | GATE_DELEGATED | checker |'); }, 'gate_ref 无效'],
  ['review card with gate ref', i => { i.asset += '\ngate_ref: review/required_chapters\n'; }, 'gate_ref 必须'],
  ['review card delegated', i => { i.report = ledger('| repository-fields | GATE_DELEGATED | checker |'); }, '双向对应'],
  ['gate card not delegated', i => { i.asset += GATE; i.report = ledger('| repository-fields | PASS | a |\n| gate-card | PASS | checker |'); }, '双向对应'],
];
for (const [name, mutate, expected] of mutations) test(`review FAIL-MAJOR: ${name}`, () => withProject(root => {
  const input = { asset: ASSET, report: ledger(), contracts: contracts() }; mutate(input); write(root, 'doc/conventions.md', input.asset);
  const result = checkConventionsCoverage(context(root, input.contracts), input.report)[0];
  assert.equal(result.status, 'FAIL', result.details); assert.equal(result.severity, 'MAJOR'); assert(result.details?.includes(expected), result.details);
}));
test('review activation truth table and consistent gate PASS', () => withProject(root => {
  assert.equal(checkConventionsCoverage(context(root), ledger())[0].status, 'FAIL');
  const value = contracts(); delete value.conventions_applied;
  assert.equal(checkConventionsCoverage(context(root, value), '')[0].status, 'SKIP');
  write(root, 'doc/conventions.md', ASSET + GATE);
  const result = checkConventionsCoverage(context(root), ledger('| repository-fields | PASS | code |\n| gate-card | GATE_DELEGATED | resolved rule |'))[0];
  assert.equal(result.status, 'PASS', result.details);
}));
test('review VIOLATION with issue is complete even for INFO legacy advisory', () => withProject(root => {
  write(root, 'doc/conventions.md', ASSET);
  const report = ledger('| repository-fields | VIOLATION | legacy |').replace('无问题', '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |\n|---|---|---|---|---|---|\n| CR-001 | INFO | 其他 | repository-fields，范例 src/repository.ts#load | src/data/item.ts | legacy advisory |');
  assert.equal(checkConventionsCoverage(context(root), report)[0].status, 'PASS');
}));
test('production prompt contains custom-path conventions and all target source files', () => withProject(root => {
  write(root, 'framework.config.json', JSON.stringify({ paths: { conventions: 'knowledge/practices.md' } })); clearFrameworkConfigCache();
  write(root, 'knowledge/practices.md', ASSET);
  const value = contracts(); value.files = Array.from({ length: 31 }, (_, index) => `src/data/item${index}.ts`);
  for (const file of value.files) write(root, file, `export const remapped = 'violation-${file}';`);
  const sources = [...value.files];
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), Buffer.from('PNG_BINARY_SENTINEL')]);
  value.files.push('src/data/icon.png', 'src/data/raw.bin');
  fs.writeFileSync(path.join(root, 'src/data/icon.png'), png);
  fs.writeFileSync(path.join(root, 'src/data/raw.bin'), Buffer.from([255, 254, 253]));
  write(root, 'doc/features/demo/contracts.yaml', YAML.stringify(value));
  const loader = new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT);
  const entries = collectContextFiles(loader, { ...DEFAULT_LAYOUT, projectRoot: root }, 'review', 'demo', loader.loadFeatureSpec('demo'));
  const prompt = assembleAIPrompt(path.join(FRAMEWORK_ROOT, 'harness'), root, 'review', 'demo', entries, '{}', '', undefined, undefined, FRAMEWORK_ROOT);
  assert(prompt.includes(ASSET)); assert(prompt.includes('knowledge/practices.md'));
  for (const file of sources) assert(prompt.includes(`violation-${file}`));
  for (const file of ['src/data/icon.png', 'src/data/raw.bin']) assert(entries.some(entry => entry.label === file), '二进制仍须保留目标路径');
  assert(!prompt.includes('PNG_BINARY_SENTINEL') && !prompt.includes('\0') && !prompt.includes('\uFFFD'), '二进制不得 UTF-8 解码注入 prompt');
  assert.deepEqual(fs.readFileSync(path.join(root, 'src/data/icon.png')), png);
}));

for (const [name, sourceRef, target, hasFile, expected] of [
  ['wrong fact path', 'doc/not-the-conventions.md#ghost', 'fact', true, 'blueprint_convention_source_invalid'],
  ['unknown fact id', 'doc/conventions.md#ghost', 'fact', true, 'blueprint_convention_source_invalid'],
  ['orphan decision without file', 'doc/conventions.md#repository-fields', 'decision', false, 'blueprint_convention_fact_missing'],
  ['orphan node with file', 'doc/conventions.md#repository-fields', 'node', true, 'blueprint_convention_fact_missing'],
  ['orphan decision verification ref', 'doc/conventions.md#repository-fields', 'verification', true, 'blueprint_convention_fact_missing'],
] as const) test(`P1 rejects ${name}`, () => withProject(root => {
  fs.cpSync(path.join(FRAMEWORK_ROOT, 'harness/tests/fixtures/component-blueprint/valid'), root, { recursive: true });
  if (hasFile) write(root, 'doc/conventions.md', ASSET);
  const file = componentBlueprintPath(root, 'ledger-app-blueprint');
  const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
  const provenance = { source_kind: 'convention', source_ref: sourceRef, observed_at: '2026-09-04T00:00:00Z', evidence_strength: 'authoritative', extraction_method: 'curated-reading' };
  const provider = bp.providers.find((item: any) => item.provider_id === 'conventions-knowledge');
  provider.available = hasFile;
  if (hasFile) delete provider.missing_disposition;
  if (target === 'fact') bp.discovery.facts.push({ fact_id: 'bad-convention', subject: 'ledger.mapping', value: 'bad', provenance });
  if (target === 'decision') bp.decisions_and_gaps.decisions[0].provenance = provenance;
  if (target === 'node') bp.design_views[0].nodes[0].provenance = provenance;
  if (target === 'verification') bp.decisions_and_gaps.decisions[0].verification_refs.push(sourceRef);
  const fingerprint = fingerprintDiscoverySources(asRecords(bp.discovery.facts), currentScopeItems(bp));
  bp.source_fingerprint = bp.discovery.source_fingerprint = fingerprint;
  for (const derived of bp.derived_results) derived.source_fingerprint = fingerprint;
  write(root, path.relative(root, file), YAML.stringify(bp));
  const issues = checkCanonicalComponentBlueprint(root, 'ledger-app-blueprint').issues;
  assert(issues.some(item => item.id === expected), JSON.stringify(issues));
  assert(!issues.some(item => item.id === 'blueprint_source_fingerprint_mismatch'), '反例不得靠错误指纹失败');
}));

test('default conventions EACCES accepts degraded but rejects not_applicable', () => withProject(root => {
  const bp = YAML.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness/tests/fixtures/component-blueprint/valid/doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml'), 'utf8'));
  write(root, 'doc/conventions.md', ASSET);
  const nativeFs = require('fs') as typeof fs;
  const read = nativeFs.readFileSync;
  const deniedPath = conventionsPath(root);
  nativeFs.readFileSync = ((file: fs.PathOrFileDescriptor, options?: any) => {
    if (String(file) === deniedPath) throw Object.assign(new Error('fixture permission denied'), { code: 'EACCES' });
    return read(file, options);
  }) as typeof fs.readFileSync;
  try {
    const provider = bp.providers.find((item: any) => item.provider_id === 'conventions-knowledge');
    let issues = validateComponentBlueprint(bp, { projectRoot: root });
    assert(issues.some(item => item.id === 'blueprint_conventions_provider_unreadable'), JSON.stringify(issues));
    provider.missing_disposition = 'degraded';
    issues = validateComponentBlueprint(bp, { projectRoot: root });
    assert(!issues.some(item => item.id.startsWith('blueprint_conventions_provider_')), JSON.stringify(issues));
  } finally { nativeFs.readFileSync = read; }
}));

test('same convention id traverses canonical blueprint/projection/CU contracts/review', () => withProject(root => {
  const base = path.join(FRAMEWORK_ROOT, 'harness/tests/fixtures/component-blueprint/valid'); fs.cpSync(base, root, { recursive: true });
  write(root, 'framework.config.json', JSON.stringify({ paths: { conventions: 'knowledge/practices.md' } })); clearFrameworkConfigCache();
  write(root, 'knowledge/practices.md', ASSET);
  const bpPath = componentBlueprintPath(root, 'ledger-app-blueprint');
  const bp = YAML.parse(fs.readFileSync(bpPath, 'utf8'));
  const provenance = { source_kind: 'convention', source_ref: 'knowledge/practices.md#repository-fields', observed_at: '2026-09-04T00:00:00Z', evidence_strength: 'authoritative', extraction_method: 'curated-reading' };
  bp.discovery.facts.push({ fact_id: 'convention-repository-fields', subject: 'ledger.mapping', value: 'Repository fields stay authoritative', provenance });
  bp.decisions_and_gaps.decisions[0].verification_refs.push(provenance.source_ref);
  bp.decisions_and_gaps.decisions[0].provenance = provenance;
  bp.design_views[0].nodes[0].provenance = provenance;
  const provider = bp.providers.find((p: any) => p.provider_id === 'conventions-knowledge'); provider.available = true; delete provider.missing_disposition;
  const fingerprint = fingerprintDiscoverySources(asRecords(asRecord(bp.discovery)?.facts), currentScopeItems(bp));
  bp.source_fingerprint = bp.discovery.source_fingerprint = fingerprint;
  for (const derived of bp.derived_results) derived.source_fingerprint = fingerprint;
  write(root, path.relative(root, bpPath), YAML.stringify(bp));
  const issues = validateComponentBlueprint(bp, { projectRoot: root, canonicalPath: bpPath });
  assert(!issues.some(i => i.severity === 'BLOCKER'), JSON.stringify(issues));
  const loaded = loadCanonicalBlueprint(root, 'ledger-app-blueprint');
  const projection = renderBlueprintReviewMarkdown(bp, loaded.artifactSha256); assert(projection.includes('repository-fields — knowledge/practices.md#repository-fields'));
  const projectionPath = path.join(path.dirname(bpPath), 'component-blueprint.review.md');
  write(root, path.relative(root, projectionPath), projection);
  const checked = checkCanonicalComponentBlueprint(root, 'ledger-app-blueprint');
  assert.equal(checkHostSeamMaterials(root, checked, { projection: projectionPath }).issues.length, 0);
  write(root, path.relative(root, projectionPath), projection.replace('repository-fields —', 'invented-convention —'));
  assert(checkHostSeamMaterials(root, checked, { projection: projectionPath }).issues.some(i => i.id === 'publication_projection_added_facts'));
  const cu = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh');
  // Rebind existing refs after a legitimate fixture revision, preserving the shared resolver.
  const ownerRef = asRecord(cu.changeUnit.component_blueprint_ref)!;
  const serialized = YAML.stringify(cu.changeUnit).split(String(ownerRef.source_fingerprint)).join(fingerprint).split(String(ownerRef.artifact_sha256)).join(loaded.artifactSha256);
  write(root, path.relative(root, cu.canonicalPath), serialized);
  const feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
  const value = { ...contracts(), feature, change_unit: { change_unit_ref: createChangeUnitRef(loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh')), predicate_mappings: [], provide_mappings: [], design_ref_mappings: [] } };
  write(root, 'doc/features/ledger-app-blueprint/ledger-refresh/contracts.yaml', YAML.stringify(value));
  const normalized = new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT).loadFeatureSpec(feature).contracts!;
  let result = checkConventionsCoverage(context(root, normalized), ledger())[0]; assert.equal(result.status, 'PASS', result.details);
  normalized.conventions_applied = [];
  result = checkConventionsCoverage(context(root, normalized), ledger())[0]; assert.equal(result.status, 'FAIL', result.details); assert(result.details?.includes('未被 CU 声明'), result.details);
  result = checkConventionsCoverage(context(root, normalized), ledger('| repository-fields | NOT_APPLICABLE | 此 CU 不消费该 DTO |'))[0]; assert.equal(result.status, 'PASS', result.details);
}));

export function runAll() { return cases.map(({ name, run }) => { try { run(); return { name, ok: true }; } catch (error) { return { name, ok: false, error: (error as Error).stack }; } }); }
