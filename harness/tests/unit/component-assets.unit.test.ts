import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { execFileSync } from 'child_process';
import { clearFrameworkConfigCache, componentIndexPath, componentCatalogPath, loadFrameworkConfig, relComponentIndex } from '../../config';
import { scanComponentIndex, serializeComponentIndex, readComponentIndex, mergeComponentCatalog, selectionShapeIssues, AssetSelection } from '../../scripts/utils/component-assets';
import { componentStaticChecks } from '../../../profiles/hmos-app/harness/component-extractor';
import { checkComponentCatalog, componentResult } from '../../scripts/utils/component-catalog-check';
import { checkComponentSelections, componentProjectionErrors } from '../../scripts/utils/component-selection-check';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { CheckContext, ContractsSpec } from '../../scripts/utils/types';
import { DEFAULT_LAYOUT, ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import { prepareConfigWriteForTask } from '../../scripts/utils/config-builder';
import { mergeBackfillFields } from '../../scripts/utils/config-field-merger';
import { collectContextFiles } from '../../harness-runner';
import { assembleAIPrompt, generateScriptReport, resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { validateEvolutionDecisions } from '../../scripts/utils/blueprint-evolution-decisions';
import { validateBlueprintProviders } from '../../scripts/utils/blueprint-provider-boundary';
import { validateBlueprintAdmission } from '../../scripts/utils/blueprint-admission';
import { componentBlueprintPath, loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { renderBlueprintReviewMarkdown } from '../../scripts/utils/blueprint-review-projection';
import { checkCanonicalComponentBlueprint, checkHostSeamMaterials } from '../../scripts/check-component-blueprint';
import { loadCanonicalChangeUnit, createChangeUnitRef, deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { loadResolvedProfile } from '../../profile-loader';
import { syntheticContractsView } from '../../scripts/check-exit';
import { resolveModulePathPrefixes } from '../../scripts/utils/diff-scope';
import { resolveMaterializedBuiltinSkillEntryRel } from '../../scripts/utils/instance-skill-bridge';
import { resolveSkillPath } from '../../scripts/utils/resolve-skill-path';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';

const FRAMEWORK = DEFAULT_LAYOUT.frameworkRoot;
const ID = 'SharedUi/src/SettingRow.ets#SettingRow';
const SOURCE = `@Component\nexport struct SettingRow {\n @Prop title: string = '';\n build() { Text(this.title).fontSize('16fp') }\n}\n`;
const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void) { cases.push({ name, run }); }
function write(root: string, file: string, content: string) { const abs = path.join(root, file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content, 'utf8'); }
function setup(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-assets-'));
  try {
    clearFrameworkConfigCache(); ensureConsumerFrameworkTree(root);
    write(root, 'framework.config.json', JSON.stringify({ project_profile: { name: 'hmos-app' }, paths: { component_index: 'knowledge/components.yaml', component_catalog: 'knowledge/curated.yaml' } }));
    write(root, 'doc/module-catalog.yaml', YAML.stringify({ schema_version: '1.0', modules: [
      { name: 'SharedUi', layer: '04-BusinessBase', format: 'HAR' }, { name: 'Feature', layer: '02-Feature', format: 'HAP' }, { name: 'OtherUi', layer: '04-BusinessBase', format: 'HSP' },
    ] }));
    write(root, '04-BusinessBase/SharedUi/oh-package.json5', '{"main":"Index.ets"}');
    write(root, '04-BusinessBase/SharedUi/Index.ets', "export { SettingRow as Row } from './src/SettingRow';\nexport * from './src/Private';\n");
    write(root, '04-BusinessBase/SharedUi/src/SettingRow.ets', SOURCE);
    write(root, '04-BusinessBase/SharedUi/src/Private.ets', '@Component\nexport struct Private { build() {} }');
    write(root, '04-BusinessBase/OtherUi/Index.ets', '@Builder\nexport function Small() { Divider() }');
    write(root, '02-Feature/Feature/Index.ets', '@Component\nexport struct Entry { build() {} }');
    write(root, '02-Feature/Feature/Page.ets', '@Component\nstruct Page { build() { SettingRow() } }');
    write(root, 'doc/features/demo/plan/plan.md', '## Scope 声明\n```yaml\nin_scope_modules: [Feature, SharedUi]\nout_of_scope_modules: []\nrationale: 本次复用与演进\n```\n');
    run(root);
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
}
function generate(root: string) { const scan = scanComponentIndex(root); write(root, relComponentIndex(root), serializeComponentIndex(scan.index)); return scan; }
function commitSourceBaseline(root: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init'); git('add', '04-BusinessBase', '02-Feature');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'component review fixture baseline');
}
function cuForCurrentBlueprint(root: string) {
  const loaded = loadCanonicalBlueprint(root, 'ledger-app-blueprint');
  const cu = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit as any;
  return YAML.parse(YAML.stringify(cu).split(cu.component_blueprint_ref.artifact_sha256).join(loaded.artifactSha256));
}
function contracts(): ContractsSpec {
  return { feature: 'demo', source: 'plan.md', version: '1', modules: [], module_dependencies: {}, data_models: [], interfaces: [],
    components: [{ name: 'Page', module: 'Feature', kind: 'page', file: '02-Feature/Feature/Page.ets', asset_selection: { resolution: 'reuse', component_ref: ID } }], files: ['02-Feature/Feature/Page.ets'] };
}
function context(root: string, value = contracts(), phase: CheckContext['phase'] = 'plan'): CheckContext {
  return { projectRoot: root, frameworkRoot: FRAMEWORK, frameworkRel: '', layoutKind: 'standalone', harnessRoot: path.join(FRAMEWORK, 'harness'), phase, feature: value.feature,
    featureSpec: { feature: value.feature, contracts: value }, phaseRule: { phase, structure_checks: {}, traceability_checks: {}, semantic_checks: {} }, resolvedProfile: loadResolvedProfile(root, loadFrameworkConfig(root)) } as CheckContext;
}
test('config CREATE / UPDATE keep-overwrite and custom helpers', () => setup(root => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
  raw.project_name = 'demo'; raw.materialized_adapters = ['cursor']; raw.architecture = loadFrameworkConfig(root).architecture;
  assert.equal(componentIndexPath(root), path.join(root, 'knowledge/components.yaml'));
  assert.equal(componentCatalogPath(root), path.join(root, 'knowledge/curated.yaml'));
  delete raw.paths.component_index; delete raw.paths.component_catalog;
  write(root, 'framework.config.json', JSON.stringify(raw)); clearFrameworkConfigCache();
  for (const value of [raw, mergeBackfillFields(raw, 'hmos-app').merged, prepareConfigWriteForTask({ projectRoot: root, configWritePayload: raw }, 'overwrite')]) {
    assert(!Object.prototype.hasOwnProperty.call(value.paths, 'component_index')); assert(!Object.prototype.hasOwnProperty.call(value.paths, 'component_catalog'));
    write(root, 'framework.config.json', JSON.stringify(value)); clearFrameworkConfigCache();
    assert.equal(componentIndexPath(root), path.join(root, 'doc/component-index.yaml'));
    assert(!fs.existsSync(componentIndexPath(root)));
  }
  fs.unlinkSync(path.join(root, 'framework.config.json')); clearFrameworkConfigCache();
  const created = prepareConfigWriteForTask({ projectRoot: root, configWritePayload: { project_name: 'demo', project_profile: { name: 'hmos-app' }, materialized_adapters: ['cursor'], architecture: raw.architecture } }, 'run');
  assert.equal((created.paths as Record<string, unknown>).component_index, 'doc/component-index.yaml');
}));
test('HAR/HSP + main + one-hop alias + private/HAP exclusions + deterministic drift', () => setup(root => {
  const first = generate(root); assert.deepEqual(first.index.components.map(c => c.symbol).sort(), ['SettingRow', 'Small']);
  assert(first.warnings.some(w => w.includes('export *')));
  assert.deepEqual(first.index.components.find(c => c.id === ID)?.props, ['title']);
  assert.equal(serializeComponentIndex(first.index), serializeComponentIndex(scanComponentIndex(root).index));
  assert(!serializeComponentIndex(first.index).includes(root));
  assert(checkComponentCatalog(root).some(r => r.id === 'component_uncurated' && r.status === 'WARN'));
  write(root, '04-BusinessBase/SharedUi/src/SettingRow.ets', SOURCE + '// drift\n');
  assert(checkComponentCatalog(root).some(r => r.id === 'component_index_fresh' && r.status === 'FAIL' && r.severity === 'MAJOR'));
}));
test('static negative probes and per-surface attribution', () => {
  const good = `Button('Save').fontSize('16fp').width('44vp').height(48)`;
  assert.deepEqual(componentStaticChecks(good), { scalable_font_unit: 'pass', no_hardcoded_hex_color: 'pass', declared_touch_target: 'pass' });
  assert.equal(componentStaticChecks(good.replace('16fp', '16vp')).scalable_font_unit, 'fail');
  assert.equal(componentStaticChecks(good + ".fontColor('#abc')").no_hardcoded_hex_color, 'fail');
  assert.equal(componentStaticChecks(good.replace('44vp', '20vp')).declared_touch_target, 'fail');
  assert.equal(componentStaticChecks("Button('x').width(size).height(50)").declared_touch_target, 'unknown');
  assert.equal(componentStaticChecks('Divider()').declared_touch_target, 'not_applicable');
  assert.equal(componentStaticChecks(good + '\nButton().width(20).height(20)').declared_touch_target, 'fail');
  assert.equal(componentStaticChecks(good + '\nText(data)').scalable_font_unit, 'unknown');
});
test('index shape / ID / module checks reject invalid persisted facts', () => setup(root => {
  const index = generate(root).index;
  for (const mutate of [
    (v: any) => { v.components[0].id = '../outside#Bad'; },
    (v: any) => { v.components[0].module = 'Missing'; },
    (v: any) => { v.components[0].static_checks.declared_touch_target = 'supported'; },
    (v: any) => { v.generated_at = 'volatile'; },
    (v: any) => { v.components.push(v.components[0]); },
  ]) {
    const value = JSON.parse(JSON.stringify(index)); mutate(value);
    write(root, relComponentIndex(root), YAML.stringify(value));
    assert.throws(() => readComponentIndex(root));
    assert(checkComponentCatalog(root).some(r => r.status === 'FAIL'));
  }
}));
test('named source exports and historical main use the same export resolver', () => setup(root => {
  write(root, '04-BusinessBase/SharedUi/src/SettingRow.ets', SOURCE.replace('export struct', 'struct') + '\nexport { SettingRow };\n');
  assert(scanComponentIndex(root).index.components.some(c => c.id === ID));
  const files: Record<string, string> = {
    '04-BusinessBase/SharedUi/oh-package.json5': '{"main":"src/main/ets/Index.ets"}',
    '04-BusinessBase/SharedUi/src/main/ets/Index.ets': '/** @deprecated use Next */\n@Component\nexport struct Old { build() { Divider() } }\n@Component\nexport struct Next { build() { Divider() } }',
  };
  const historical = scanComponentIndex(root, file => files[file] ?? null).index.components;
  assert.equal(historical.length, 2);
  assert.equal(historical.find(c => c.symbol === 'Old')?.deprecated, true);
  assert.equal(historical.find(c => c.symbol === 'Next')?.deprecated, false);
  assert(historical.every(c => c.file.endsWith('src/main/ets/Index.ets')));
}));
const matrix = YAML.parse(fs.readFileSync(path.join(__dirname, '../fixtures/component-assets/selection-cases.yaml'), 'utf8')).cases;
for (const row of matrix) test(`selection fixture ${row.name}`, () => setup(root => {
  generate(root); const value = contracts(); value.components[0].asset_selection = row.selection;
  const checks = checkComponentSelections(context(root, value));
  assert.equal(!checks.some(r => r.status === 'FAIL'), row.pass, JSON.stringify(checks));
  write(root, 'doc/features/demo/contracts.yaml', YAML.stringify(value));
  const loaded = new SpecLoader(root, undefined, undefined, FRAMEWORK).loadFeatureSpec('demo');
  if (row.selection !== undefined && selectionShapeIssues(row.selection).length) assert(loaded.shape_issues?.some(s => s.includes('asset_selection')));
  else assert(!loaded.shape_issues?.some(s => s.includes('asset_selection')));
}));
test('activation, utility exemption, dependency usage module and evolve scope', () => setup(root => {
  const value = contracts(); delete value.components[0].asset_selection;
  assert.equal(checkComponentSelections(context(root, value)).length, 0);
  assert.equal(checkComponentCatalog(root)[0].status, 'SKIP');
  generate(root); value.components[0].kind = 'utility';
  assert(!checkComponentSelections(context(root, value)).some(r => r.status === 'FAIL'));
  value.components[0].asset_selection = { resolution: 'reuse', component_ref: ID }; value.components[0].module = 'OtherUi';
  assert(checkComponentSelections(context(root, value)).some(r => r.details?.includes('依赖非法')));
  value.components[0].module = 'Feature'; value.components[0].asset_selection = { resolution: 'evolve', component_ref: ID, rationale: '兼容增加' };
  write(root, 'doc/features/demo/plan/plan.md', '## Scope 声明\n```yaml\nin_scope_modules: [Feature]\nout_of_scope_modules: [SharedUi]\nrationale: 本轮仅消费\n```');
  assert(checkComponentSelections(context(root, value)).some(r => r.details?.includes('in_scope_modules')));
}));
test('curation rejects unconfirmed, copied and absent IDs; dangling never mutates', () => setup(root => {
  generate(root);
  const card = { id: ID, intent: ['设置'], one_liner: '设置行', use_when: ['设置'], not_for: [], easily_confused_with: [], status: 'recommended', notes: '' };
  const staging = { schema_version: '1.0', components: [card] };
  assert.throws(() => mergeComponentCatalog(root, staging, []), /未逐条确认/);
  assert(!fs.existsSync(componentCatalogPath(root)));
  assert.throws(() => mergeComponentCatalog(root, { ...staging, components: [{ ...card, id: 'SharedUi/missing.ets#No' }] }, ['SharedUi/missing.ets#No']), /不存在/);
  assert.throws(() => mergeComponentCatalog(root, { ...staging, components: [{ ...card, module: 'SharedUi' }] }, [ID]), /复制/);
  mergeComponentCatalog(root, staging, [ID]); const before = fs.readFileSync(componentCatalogPath(root), 'utf8');
  write(root, '04-BusinessBase/SharedUi/Index.ets', ''); generate(root);
  assert(checkComponentCatalog(root).some(r => r.id === 'component_catalog_dangling' && r.status === 'WARN'));
  assert.equal(fs.readFileSync(componentCatalogPath(root), 'utf8'), before);
}));
test('new shared unknown blocks, private custom skips registration, legacy unknown passes', () => setup(root => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init'); git('add', '04-BusinessBase', '02-Feature'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'baseline');
  write(root, '04-BusinessBase/SharedUi/src/SettingRow.ets', SOURCE.replace("'16fp'", 'size'));
  generate(root);
  const value = contracts(); value.files = ['04-BusinessBase/SharedUi/src/SettingRow.ets'];
  assert(!checkComponentSelections(context(root, value, 'review')).some(r => r.id === 'component_new_static_checks' && r.status === 'FAIL'));
  write(root, '04-BusinessBase/SharedUi/Index.ets', "export { SettingRow } from './src/SettingRow';\nexport { NewButton } from './src/NewButton';");
  write(root, '04-BusinessBase/SharedUi/src/NewButton.ets', "@Component\nexport struct NewButton { build() { Button().width(size).height(50) } }");
  value.files.push('04-BusinessBase/SharedUi/src/NewButton.ets');
  let checks = checkComponentSelections(context(root, value, 'review'));
  assert(checks.some(r => r.id === 'component_export_registered' && r.status === 'FAIL'));
  assert(checks.some(r => r.id === 'component_new_static_checks' && r.details?.includes('declared_touch_target=unknown')));
  generate(root); checks = checkComponentSelections(context(root, value, 'review'));
  assert(checks.some(r => r.id === 'component_new_static_checks' && r.status === 'FAIL'));
  const privateValue = contracts(); privateValue.components[0].asset_selection = { resolution: 'custom', rationale: '私有用途' };
  assert(!checkComponentSelections(context(root, privateValue, 'review')).some(r => r.status === 'FAIL'));
}));
test('review collector and assembleAIPrompt include index/catalog/live usages', () => setup(root => {
  generate(root); const value = contracts(); write(root, 'doc/features/demo/contracts.yaml', YAML.stringify(value));
  const loader = new SpecLoader(root, undefined, undefined, FRAMEWORK);
  const files = collectContextFiles(loader, { ...DEFAULT_LAYOUT, projectRoot: root }, 'review', 'demo', loader.loadFeatureSpec('demo'));
  const prompt = assembleAIPrompt(path.join(FRAMEWORK, 'harness'), root, 'review', 'demo', files, '{}', '', undefined, undefined, FRAMEWORK);
  for (const text of [ID, 'knowledge/curated.yaml', '02-Feature/Feature/Page.ets:2:', 'live 调用点']) assert(prompt.includes(text), text);
}));
test('exit 合成视图空缺省与含选型合同保持一致', () => setup(root => {
  const ctx = context(root);
  const resolution = { prefixByModule: new Map([['Feature', '02-Feature/Feature/']]) } as ReturnType<typeof resolveModulePathPrefixes>;
  const existing = ctx.featureSpec.contracts!;
  assert.deepEqual(syntheticContractsView(ctx, resolution).components, existing.components);
  delete ctx.featureSpec.contracts;
  assert.deepEqual(syntheticContractsView(ctx, resolution).components, []);
}));
test('six adapters and shared bundle resolve the indexed component curation skill', () => setup(root => {
  assert.equal(resolveSkillPath(FRAMEWORK, 'component-catalog-bootstrap').skillMdFrameworkRel, 'skills/project/component-catalog-bootstrap/SKILL.md');
  const expected: Record<string, string> = { claude: '.claude/commands/component-catalog-bootstrap.md', codeagent: '.cac/commands/component-catalog-bootstrap.md', cursor: '.cursor/skills/component-catalog-bootstrap/SKILL.md', chrys: '.agents/skills/component-catalog-bootstrap/SKILL.md', codex: '.codex/skills/component-catalog-bootstrap/SKILL.md', opencode: '.opencode/skill/component-catalog-bootstrap/SKILL.md' };
  for (const [adapter, rel] of Object.entries(expected)) {
    const entry = resolveMaterializedBuiltinSkillEntryRel(root, FRAMEWORK, adapter, 'component-catalog-bootstrap', 'component-catalog-bootstrap');
    assert.equal(entry?.rel, rel, adapter);
    const template = ['claude', 'codeagent'].includes(adapter)
      ? `agents/${adapter}/templates/commands/component-catalog-bootstrap.md`
      : 'agents/shared/agent-bundle/templates/skills-bridge/component-catalog-bootstrap/SKILL.md';
    assert(fs.readFileSync(path.join(FRAMEWORK, template), 'utf8').includes('framework/skills/project/component-catalog-bootstrap/SKILL.md'));
  }
  assert(fs.existsSync(path.join(FRAMEWORK, 'agents/cursor/templates/commands/component-catalog-bootstrap.md')));
}));

function blueprintFixture(root: string) {
  fs.cpSync(path.join(FRAMEWORK, 'harness/tests/fixtures/component-blueprint/valid/doc/features'), path.join(root, 'doc/features'), { recursive: true });
  for (const folder of ['requirements', 'contracts', 'mappings', 'src', 'test']) fs.cpSync(path.join(FRAMEWORK, 'harness/tests/fixtures/component-blueprint/valid', folder), path.join(root, folder), { recursive: true });
  const file = componentBlueprintPath(root, 'ledger-app-blueprint');
  const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
  const view = bp.design_views.find((v: any) => v.view_id === 'development');
  view.nodes[0].kind = 'page'; view.nodes[0].module = 'Feature';
  const decision = { decision_id: 'asset-row', kind: 'component_asset_selection', target_ref: `view:development/node:${view.nodes[0].node_id}`, asset_resolution: 'reuse', component_ref: ID,
    status: 'decided_with_authority', owner: 'ui-owner', verification_refs: ['02-Feature/Feature/Page.ets'], provenance: { ...bp.provenance, source_ref: relComponentIndex(root) } };
  bp.decisions_and_gaps.decisions.push(decision);
  const provider = bp.providers.find((p: any) => p.provider_id === 'component-assets'); provider.available = true; delete provider.missing_disposition;
  write(root, path.relative(root, file), YAML.stringify(bp));
  return { bp, file, view, decision, provider };
}
test('provider/decision negative branches and missing-index admission split', () => setup(root => {
  generate(root); const { bp, view, decision, provider } = blueprintFixture(root);
  assert.equal(validateEvolutionDecisions(bp, root).length, 0);
  delete (decision as { component_ref?: string }).component_ref; assert(validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_asset_selection_invalid')); decision.component_ref = ID;
  for (const resolution of ['adapt', 'evolve', 'custom']) { decision.asset_resolution = resolution; assert(validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_asset_selection_invalid')); }
  decision.asset_resolution = 'reuse'; view.evolution_impact = 'verified_unchanged';
  assert(validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_view_unchanged_masks_change')); view.evolution_impact = 'changed';
  bp.providers = bp.providers.filter((p: any) => p !== provider);
  assert(validateBlueprintProviders(bp, { projectRoot: root }).some(i => i.message.includes('component-assets'))); bp.providers.push(provider);
  fs.unlinkSync(componentIndexPath(root));
  assert(validateBlueprintProviders(bp, { projectRoot: root }).some(i => i.id === 'blueprint_component_provider_availability_mismatch'));
  provider.available = false; provider.missing_disposition = 'not_applicable';
  assert(validateBlueprintProviders(bp, { projectRoot: root }).some(i => i.id === 'blueprint_component_provider_disposition_invalid'));
  provider.missing_disposition = 'unknown'; bp.decisions_and_gaps.decisions.pop();
  const gap = { gap_id: 'assets-missing', knowledge_state: 'unknown', status: 'open_decision', owner: 'ui-owner', needed_by: 'later', unlock_condition: '生成 index', verification_refs: ['provider:component-assets'], provenance: bp.provenance };
  bp.decisions_and_gaps.gaps.push(gap);
  assert(!validateBlueprintProviders(bp, { projectRoot: root }).some(i => i.id.startsWith('blueprint_component_')));
  gap.needed_by = bp.review_summary.admission.current_slice.slice_id;
  assert(validateBlueprintAdmission(bp).some(i => i.id === 'blueprint_current_unknown_not_blocking'));
  gap.status = 'blocker'; assert(!validateBlueprintAdmission(bp).some(i => i.id === 'blueprint_current_unknown_not_blocking'));
}));
test('mechanical index → blueprint decision → CU refs → loader → plan/review → publication', () => setup(root => {
  generate(root); const { bp, file, decision } = blueprintFixture(root);
  const failures = validateComponentBlueprint(bp, { projectRoot: root }).filter(i => i.severity === 'BLOCKER'); assert.deepEqual(failures, []);
  const loaded = loadCanonicalBlueprint(root, 'ledger-app-blueprint');
  const cuLoaded = loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh');
  let cu = cuLoaded.changeUnit as any;
  const previousHash = cu.component_blueprint_ref.artifact_sha256;
  cu = YAML.parse(YAML.stringify(cu).split(previousHash).join(loaded.artifactSha256));
  const ref = { ...cu.component_blueprint_ref, target: { kind: 'decision', id: decision.decision_id } };
  cu.design_refs.push(ref);
  write(root, path.relative(root, cuLoaded.canonicalPath), YAML.stringify(cu));
  const value = contracts(); value.feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
  value.state_management = [{
    data: 'ledger', scope: 'component', decorator: 'none', holder: 'LedgerStore', module: 'ledger',
    design_ref: cu.design_refs.find((r: any) => r.target.kind === 'flow'), owner_ref: 'view:runtime/node:ledger-repository', contract_refs: ['contract:create-entry-v1'],
    mutations: [{ mutation_id: 'add-entry', kind: 'user', publication_ref: 'publication:ledger-changed', recovery_ref: 'recovery:reload-ledger' }],
    publications: [{ publication_id: 'ledger-changed' }],
    subscriptions: [{ subscription_id: 'ledger-page-subscription', consumer_ref: 'consumer:ledger-page', publication_ref: 'publication:ledger-changed', replay_or_snapshot: 'latest', cleanup: 'detach observer' }],
    consumers: [{ consumer_id: 'ledger-page', initial_load_ref: 'initial-load:repository-snapshot', update_ref: 'publication:ledger-changed' }],
  }];
  value.change_unit = { change_unit_ref: createChangeUnitRef(loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh')),
    predicate_mappings: cu.target_predicates.map((p: any) => ({ predicate_id: p.predicate_id, implementation_refs: [value.components[0].file], test_refs: [value.components[0].file] })),
    provide_mappings: cu.provides.map((p: any) => ({ provide_id: p.provide_id, implementation_refs: [value.components[0].file], test_refs: [value.components[0].file] })),
    design_ref_mappings: cu.design_refs.map((design_ref: any) => ({ design_ref, implementation_refs: [`${value.components[0].file}#Page`], verification_refs: [value.components[0].file] })) };
  write(root, 'doc/features/ledger-app-blueprint/ledger-refresh/contracts.yaml', YAML.stringify(value));
  write(root, 'doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml', YAML.stringify({ schema_version: '2', feature: value.feature, use_cases: [] }));
  const normalized = new SpecLoader(root, undefined, undefined, FRAMEWORK).loadFeatureSpec(value.feature);
  assert(!normalized.shape_issues, JSON.stringify(normalized.shape_issues));
  for (const phase of ['plan', 'review'] as const) {
    const ctx = context(root, normalized.contracts!, phase); ctx.featureSpec = normalized;
    const checks = checkChangeUnitFeatureProjection(ctx, phase);
    assert(!checks.some(r => r.status === 'FAIL'), JSON.stringify(checks));
  }
  normalized.contracts!.components[0].asset_selection = { resolution: 'custom', rationale: '自行重选' };
  assert(checkChangeUnitFeatureProjection(context(root, normalized.contracts!), 'plan').some(r => r.id === 'component_asset_projection' && r.status === 'FAIL'));
  normalized.contracts!.components[0].asset_selection = value.components[0].asset_selection;
  for (const mapping of normalized.contracts!.change_unit!.design_ref_mappings) (mapping as any).implementation_refs = [42];
  assert(checkChangeUnitFeatureProjection(context(root, normalized.contracts!), 'plan').some(r => r.id === 'component_asset_projection' && r.status === 'FAIL'));
  normalized.contracts!.change_unit!.design_ref_mappings = [];
  assert(checkChangeUnitFeatureProjection(context(root, normalized.contracts!), 'plan').some(r => r.id === 'component_asset_projection' && r.status === 'FAIL'));
  const review = renderBlueprintReviewMarkdown(bp, loaded.artifactSha256);
  for (const field of ['target_ref=', 'asset_resolution=reuse', `component_ref=${ID}`, 'rationale=']) assert(review.includes(field), field);
  const output = path.join(path.dirname(file), 'component-blueprint.review.md'); write(root, path.relative(root, output), review);
  const checked = checkCanonicalComponentBlueprint(root, 'ledger-app-blueprint');
  assert.equal(checkHostSeamMaterials(root, checked, { projection: output }).issues.length, 0);
  write(root, path.relative(root, output), review.replace('asset_resolution=reuse', 'asset_resolution=custom'));
  assert(checkHostSeamMaterials(root, checked, { projection: output }).issues.some(i => i.id === 'publication_projection_added_facts'));
}));

test('R1 必阻断选型进入最终 verdict/summary，诊断 MAJOR 与 WARN 不升级', () => setup(root => {
  generate(root);
  for (const mutate of [
    (c: ContractsSpec) => { delete c.components[0].asset_selection; },
    (c: ContractsSpec) => { c.components[0].asset_selection = { resolution: 'reuse', component_ref: 'SharedUi/missing.ets#Missing' }; },
    (c: ContractsSpec) => { c.components[0].module = 'OtherUi'; },
  ]) {
    const value = contracts(); mutate(value);
    const report = generateScriptReport(path.join(FRAMEWORK, 'harness'), 'plan', value.feature, root, checkComponentSelections(context(root, value)), FRAMEWORK);
    assert.equal(report.summary.verdict, 'FAIL'); assert(report.summary.blockers > 0);
  }
  const advisory = [componentResult('component_uncurated', 'WARN', 'uncurated'), componentResult('component_catalog_dangling', 'WARN', 'dangling'), componentResult('component_index_fresh', 'FAIL', 'drift')];
  assert(advisory.every(r => r.severity === 'MAJOR'));
  assert.equal(resolveVerdictFromChecks(advisory), 'PASS');
}));

test('R2 当前资产 blocker 拒绝 CU 施工，远期 open_decision 仍 constructable', () => setup(root => {
  generate(root); const { bp, file, decision, provider } = blueprintFixture(root);
  fs.unlinkSync(componentIndexPath(root)); provider.available = false; provider.missing_disposition = 'unknown';
  bp.decisions_and_gaps.decisions = bp.decisions_and_gaps.decisions.filter((d: any) => d !== decision);
  const gap = { gap_id: 'assets-missing', knowledge_state: 'unknown', status: 'open_decision', owner: 'ui-owner', needed_by: 'later', unlock_condition: '生成 index', verification_refs: ['provider:component-assets'], provenance: bp.provenance };
  bp.decisions_and_gaps.gaps.push(gap);
  write(root, path.relative(root, file), YAML.stringify(bp));
  assert.equal(validateChangeUnitDesign(root, cuForCurrentBlueprint(root)).verdict, 'constructable');
  gap.needed_by = bp.review_summary.admission.current_slice.slice_id; gap.status = 'blocker';
  for (const status of ['pass', 'blocker']) {
    bp.review_summary.admission.status = status;
    write(root, path.relative(root, file), YAML.stringify(bp));
    assert(validateComponentBlueprint(bp, { projectRoot: root }).some(i => i.id === 'blueprint_current_asset_blocker'));
    const gate = validateChangeUnitDesign(root, cuForCurrentBlueprint(root));
    assert.notEqual(gate.verdict, 'constructable');
    assert(gate.issues.some(i => i.message.includes('blueprint_current_asset_blocker')), JSON.stringify(gate));
  }
}));

test('R3 只修改出口也问责新增共享资产，定义未改/存量/私有保持区分', () => setup(root => {
  const privateSource = '@Component\nexport struct Private { build() { Button().width(size).height(50) } }';
  write(root, '04-BusinessBase/SharedUi/src/Private.ets', privateSource);
  write(root, '04-BusinessBase/SharedUi/src/SettingRow.ets', SOURCE.replace("'16fp'", 'size'));
  commitSourceBaseline(root); generate(root);
  const value = contracts(); value.files = ['04-BusinessBase/SharedUi/Index.ets'];
  assert.equal(resolveVerdictFromChecks(checkComponentSelections(context(root, value, 'review'))), 'PASS');
  write(root, value.files[0], "export { SettingRow } from './src/SettingRow';\nexport { Private } from './src/Private';");
  let checks = checkComponentSelections(context(root, value, 'review'));
  assert(checks.some(c => c.id === 'component_export_registered' && c.status === 'FAIL'));
  generate(root); checks = checkComponentSelections(context(root, value, 'review'));
  assert(checks.some(c => c.id === 'component_new_static_checks' && c.details?.includes('#Private')));
  assert(!checks.some(c => c.id === 'component_new_static_checks' && c.details?.includes('#SettingRow')));
  const report = generateScriptReport(path.join(FRAMEWORK, 'harness'), 'review', value.feature, root, checks, FRAMEWORK);
  assert.equal(report.summary.verdict, 'FAIL'); assert(report.summary.blockers > 0);
  assert.equal(fs.readFileSync(path.join(root, '04-BusinessBase/SharedUi/src/Private.ets'), 'utf8'), privateSource);
}));

test('R4 同名组件按 file#name 分别覆盖，缺映射和不一致均失败', () => setup(root => {
  generate(root); const { bp, file, view, decision } = blueprintFixture(root);
  const otherNode = { ...view.nodes[0], node_id: 'other-page' }; view.nodes.push(otherNode);
  const otherDecision = { ...decision, decision_id: 'asset-other', target_ref: 'view:development/node:other-page', asset_resolution: 'custom', rationale: '独立私有用途' } as any;
  delete otherDecision.component_ref; bp.decisions_and_gaps.decisions.push(otherDecision);
  write(root, path.relative(root, file), YAML.stringify(bp));
  const cu = cuForCurrentBlueprint(root);
  const refs = [decision, otherDecision].map(d => ({ ...cu.component_blueprint_ref, target: { kind: 'decision', id: d.decision_id } }));
  cu.design_refs.push(...refs);
  const value = contracts();
  value.components.push({ ...value.components[0], file: '02-Feature/Feature/OtherPage.ets', asset_selection: { resolution: 'custom', rationale: otherDecision.rationale } });
  value.change_unit = { change_unit_ref: {} as any, predicate_mappings: [], provide_mappings: [], design_ref_mappings: refs.map((design_ref, i) => ({ design_ref, implementation_refs: [`${value.components[i].file}#Page`], verification_refs: [] })) };
  assert.deepEqual(componentProjectionErrors(root, value, cu), []);
  value.components[1].asset_selection = value.components[0].asset_selection;
  assert(componentProjectionErrors(root, value, cu).some(e => e.includes('不一致')));
  value.components[1].asset_selection = { resolution: 'custom', rationale: otherDecision.rationale };
  value.change_unit.design_ref_mappings.pop();
  assert(componentProjectionErrors(root, value, cu).some(e => e.includes('OtherPage.ets#Page')));
}));

test('R5 小写全局 Builder 保留 unknown 并阻断新增共享包装，真实无表面保持 NA', () => setup(root => {
  commitSourceBaseline(root);
  write(root, '04-BusinessBase/SharedUi/Index.ets', "export { Wrapped } from './src/Wrapped';");
  write(root, '04-BusinessBase/SharedUi/src/Wrapped.ets', "@Builder\nfunction drawButton() { Button('bad').fontSize('16vp').width(20).height(20) }\n@Component\nexport struct Wrapped { build() { drawButton() } }");
  const asset = generate(root).index.components.find(c => c.symbol === 'Wrapped')!;
  assert.equal(asset.static_checks.scalable_font_unit, 'unknown');
  assert.equal(asset.static_checks.declared_touch_target, 'unknown');
  const value = contracts(); value.components[0].asset_selection = { resolution: 'custom', rationale: '私有' }; value.files = ['04-BusinessBase/SharedUi/src/Wrapped.ets'];
  assert.equal(resolveVerdictFromChecks(checkComponentSelections(context(root, value, 'review'))), 'FAIL');
  assert.equal(componentStaticChecks('build() { Divider() }').declared_touch_target, 'not_applicable');
  assert.equal(componentStaticChecks('build() { Image($r("app.media.icon")) }').scalable_font_unit, 'not_applicable');
}));

test('R6 只要求被引用的证据文件可读，不增加 optional catalog 或锚点门', () => setup(root => {
  generate(root); const { bp, decision } = blueprintFixture(root);
  assert(!fs.existsSync(componentCatalogPath(root)));
  assert.deepEqual(validateComponentBlueprint(bp, { projectRoot: root }), []);
  decision.provenance.source_ref = 'knowledge/curated.yaml#not-an-anchor-contract';
  assert(validateComponentBlueprint(bp, { projectRoot: root }).some(i => i.id === 'blueprint_asset_source_unreadable'));
  fs.mkdirSync(componentCatalogPath(root));
  assert(validateComponentBlueprint(bp, { projectRoot: root }).some(i => i.id === 'blueprint_asset_source_unreadable'));
  fs.rmdirSync(componentCatalogPath(root));
  write(root, 'knowledge/curated.yaml', 'schema_version: "1.0"\ncomponents: []\n');
  assert.deepEqual(validateComponentBlueprint(bp, { projectRoot: root }), []);
}));

test('R5 直接回归：空生命周期声明加 Divider 不产生新共享组件未知债', () => setup(root => {
  commitSourceBaseline(root);
  const file = '04-BusinessBase/SharedUi/src/DividerOnly.ets';
  write(root, '04-BusinessBase/SharedUi/Index.ets', "export { DividerOnly } from './src/DividerOnly';");
  for (const returnType of ['', ': void']) {
    const body = `aboutToAppear()${returnType} {}\nbuild() { Divider() }`;
    write(root, file, `@Component\nexport struct DividerOnly {\n${body}\n}`);
    const asset = generate(root).index.components.find(c => c.symbol === 'DividerOnly')!;
    assert.equal(asset.static_checks.scalable_font_unit, 'not_applicable');
    assert.equal(asset.static_checks.declared_touch_target, 'not_applicable');
    const value = contracts();
    value.components = [{ name: 'DividerOnly', module: 'SharedUi', file, kind: 'component', asset_selection: { resolution: 'custom', rationale: '无可复用共享组件' } }];
    value.files = [file, '04-BusinessBase/SharedUi/Index.ets'];
    const checks = checkComponentSelections(context(root, value, 'review'));
    assert(!checks.some(c => c.id === 'component_new_static_checks' && c.status === 'FAIL'));
    const report = generateScriptReport(path.join(FRAMEWORK, 'harness'), 'review', value.feature, root, checks, FRAMEWORK);
    assert.equal(report.summary.verdict, 'PASS');
    assert.equal(report.summary.blockers, 0);
  }
}));

if (process.platform === 'win32') test('R7 Windows fallback 与 Git 大小写一致识别存量，仍发现新导出', () => setup(root => {
  const source = '@Component\nexport struct Legacy { build() { Button().width(size).height(50) } }';
  write(root, '04-BusinessBase/OtherUi/Index.ets', source); commitSourceBaseline(root); generate(root);
  const value = contracts(); value.files = ['04-BusinessBase/OtherUi/index.ets'];
  assert(!checkComponentSelections(context(root, value, 'review')).some(c => c.id === 'component_new_static_checks' && c.status === 'FAIL'));
  write(root, '04-BusinessBase/OtherUi/Index.ets', source + '\n@Component\nexport struct Added { build() { Button() } }');
  generate(root);
  const checks = checkComponentSelections(context(root, value, 'review'));
  assert(checks.some(c => c.id === 'component_new_static_checks' && c.details?.includes('#Added')));
  assert(!checks.some(c => c.id === 'component_new_static_checks' && c.details?.includes('#Legacy')));
}));

export function runAll() { return cases.map(({ name, run }) => { try { run(); return { name, ok: true }; } catch (error) { return { name, ok: false, error: (error as Error).stack }; } }); }
