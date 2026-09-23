import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { execFileSync } from 'child_process';
import { clearFrameworkConfigCache, componentIndexPath, componentCatalogPath, loadFrameworkConfig, relComponentIndex } from '../../config';
import { scanComponentIndex, serializeComponentIndex, readComponentIndex, mergeComponentCatalog, selectionShapeIssues, AssetSelection, resolveAdmittedModules, componentDependencyAllowed } from '../../scripts/utils/component-assets';
import { fingerprintDiscoverySources } from '../../scripts/utils/blueprint-discovery';
import { currentScopeItems } from '../../scripts/utils/blueprint-requirement-traceability';
import { validateComponentClosureKnowledge } from '../../scripts/utils/component-closure-knowledge';
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
import { componentBlueprintPath, loadCanonicalBlueprint, resolveComponentBlueprintRef } from '../../scripts/utils/component-blueprint-path';
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

// ---- plan a3c7e9d1 t2/t3：获准模块 / 术语事实 / architecture_impact（P1 侧）----
function refingerprint(bp: any) {
  const fp = fingerprintDiscoverySources(bp.discovery.facts, currentScopeItems(bp));
  bp.discovery.source_fingerprint = fp; bp.source_fingerprint = fp;
  for (const result of bp.derived_results ?? []) result.source_fingerprint = fp;
}
function termFact(term: string, module: string, confidence: string, method: string, sourceKind = 'catalog') {
  return { fact_id: `term-${confidence}-${method}`, subject: `term:${term}`, value: { canonical_module: module, confidence, easily_confused_with: [] },
    provenance: { source_kind: sourceKind, source_ref: sourceKind === 'glossary' ? 'doc/glossary.yaml' : 'doc/module-catalog.yaml', observed_at: '2026-09-23T10:00:00+08:00', evidence_strength: 'observed', extraction_method: method } };
}
function architectureDecision(id: string, fields: Record<string, unknown>, status = 'decided_with_authority', bp?: any) {
  return { decision_id: id, kind: 'architecture_impact', rationale: '本次演进需要', status, owner: 'architecture-owner', verification_refs: [`verify:${id}`], provenance: bp?.provenance, ...fields };
}
const blockerIds = (bp: any, root: string) => validateComponentBlueprint(bp, { projectRoot: root }).filter(i => i.severity === 'BLOCKER').map(i => i.id);

test('a3c7e9d1 正例：add_module 声明的新模块同源放行节点 module、术语 canonical_module 与组件复用依赖，并生成 closure 归位义务', () => setup(root => {
  generate(root); const { bp, view } = blueprintFixture(root);
  view.nodes[0].module = 'NewFeature';
  let ids = blockerIds(bp, root);
  assert(ids.includes('blueprint_node_module_unadmitted'), ids.join(','));
  assert(ids.includes('blueprint_asset_dependency_illegal'), '未声明的新模块作 consumer 不得通过依赖判定');
  bp.decisions_and_gaps.decisions.push(architectureDecision('add-new-feature', { change: 'add_module', module: 'NewFeature', layer: '02-Feature' }, 'decided_with_authority', bp));
  bp.discovery.facts.push(termFact('卡包', 'NewFeature', 'medium', 'user_confirmed'));
  refingerprint(bp);
  ids = blockerIds(bp, root);
  assert.deepEqual(ids, []);
  const admitted = resolveAdmittedModules(root, bp);
  assert.equal(admitted.declared.get('NewFeature'), '02-Feature');
  assert(componentDependencyAllowed(root, 'NewFeature', 'SharedUi', admitted.declared));
  assert(!componentDependencyAllowed(root, 'NewFeature', 'SharedUi'), 'catalog 外 consumer 未传声明时仍按旧语义拒绝');
  const closure = validateComponentClosureKnowledge(root, { blueprint: { blueprint: bp } } as any);
  assert(closure.issues.some(i => i.id === 'component_closure_knowledge_conclusion_unplaced' && i.path === 'decision:add-new-feature'), JSON.stringify(closure.issues));
}));

test('a3c7e9d1 反例：changed development 节点缺 module / 术语 canonical_module 不是获准模块 → P1 BLOCKER', () => setup(root => {
  generate(root); const { bp, view } = blueprintFixture(root);
  delete view.nodes[0].module;
  assert(blockerIds(bp, root).includes('blueprint_node_module_missing'));
  view.nodes[0].module = 'Feature';
  bp.discovery.facts.push(termFact('卡包', 'Ghost', 'medium', 'user_confirmed')); refingerprint(bp);
  const issues = validateComponentBlueprint(bp, { projectRoot: root }).filter(i => i.id === 'terminology_facts_confirmed');
  assert(issues.some(i => i.severity === 'BLOCKER' && i.message.includes('Ghost')), JSON.stringify(issues));
}));

test('a3c7e9d1 术语确认：medium 未确认 → admission blocker；headless_assumed → WARN 入 must-review 不停步、不回写 glossary', () => setup(root => {
  generate(root); const { bp } = blueprintFixture(root);
  write(root, 'doc/glossary.yaml', 'schema_version: "1.0"\nterms: []\n');
  const glossaryBefore = fs.readFileSync(path.join(root, 'doc/glossary.yaml'), 'utf8');
  bp.discovery.facts.push(termFact('卡包', 'Feature', 'medium', 'model_inference')); refingerprint(bp);
  let issues = validateComponentBlueprint(bp, { projectRoot: root });
  assert(issues.some(i => i.id === 'terminology_facts_confirmed' && i.severity === 'BLOCKER'));
  assert(issues.some(i => i.id === 'blueprint_admission_false_pass'), '未确认术语必须让 admission 派生为 blocker');
  bp.discovery.facts[bp.discovery.facts.length - 1] = termFact('卡包', 'Feature', 'medium', 'headless_assumed'); refingerprint(bp);
  issues = validateComponentBlueprint(bp, { projectRoot: root });
  assert(!issues.some(i => i.severity === 'BLOCKER'), JSON.stringify(issues));
  const warn = issues.find(i => i.id === 'terminology_facts_confirmed');
  assert(warn?.severity === 'WARN' && warn.message.includes('must-review'), JSON.stringify(warn));
  const glossaryAfter = fs.readFileSync(path.join(root, 'doc/glossary.yaml'), 'utf8');
  assert.equal(glossaryAfter, glossaryBefore); assert(!glossaryAfter.includes('user-approved'));
}));

test('a3c7e9d1 术语 high：非 glossary 精确命中不得直确认；glossary 精确命中则通过', () => setup(root => {
  generate(root); const { bp } = blueprintFixture(root);
  bp.discovery.facts.push(termFact('设置行', 'Feature', 'high', 'glossary_exact', 'catalog')); refingerprint(bp);
  assert(blockerIds(bp, root).includes('terminology_facts_confirmed'));
  bp.discovery.facts[bp.discovery.facts.length - 1] = termFact('设置行', 'Feature', 'high', 'glossary_exact', 'glossary'); refingerprint(bp);
  assert(blockerIds(bp, root).includes('terminology_facts_confirmed'), 'glossary 未命中不得 high 直确认');
  write(root, 'doc/glossary.yaml', 'schema_version: "1.0"\nterms:\n  - term: 设置行\n    canonical_module: Feature\n    owner_layer: 02-Feature\n    aliases: []\n    easily_confused_with: []\n');
  assert.deepEqual(blockerIds(bp, root), []);
}));

test('a3c7e9d1 architecture_impact：字段按 change 校验；verified_unchanged development 不得有架构影响决策；质询须覆盖术语 scope', () => setup(root => {
  generate(root); const { bp, view } = blueprintFixture(root);
  const decisions = bp.decisions_and_gaps.decisions;
  decisions.push(architectureDecision('edge', { change: 'dependency_edge', from: 'Feature', to: 'SharedUi' }, 'decided_with_authority', bp));
  assert(validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_architecture_impact_invalid' && i.message.includes('direction')));
  decisions[decisions.length - 1] = architectureDecision('add', { change: 'add_module', module: 'X', layer: '09-Nowhere' }, 'decided_with_authority', bp);
  assert(validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_architecture_impact_invalid' && i.message.includes('09-Nowhere')));
  decisions[decisions.length - 1] = architectureDecision('other', { change: 'dsl_other', affected_items: ['module_inner_layers'] }, 'decided_with_authority', bp);
  assert(!validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_architecture_impact_invalid'));
  view.evolution_impact = 'verified_unchanged';
  assert(validateEvolutionDecisions(bp, root).some(i => i.id === 'blueprint_view_unchanged_masks_change' && i.message.includes('architecture_impact')));
  // §7：经完整 P1 validator 同样是 BLOCKER（不只是 helper 报出）。
  assert(validateComponentBlueprint(bp, { projectRoot: root }).some(i => i.severity === 'BLOCKER' && i.id === 'blueprint_view_unchanged_masks_change' && i.message.includes('architecture_impact')));
  view.evolution_impact = 'changed';
  bp.review_summary.questioning.items = bp.review_summary.questioning.items.filter((item: any) => item.scope_kind !== 'terminology');
  assert(validateComponentBlueprint(bp, { projectRoot: root }).some(i => i.id === 'blueprint_questioning_coverage_missing' && i.message.includes('terminology:current_scope_items')));
}));

// ---- a3c7e9d1 t2+t3 一轮返修 ----
const CATALOG = [{ name: 'SharedUi', layer: '04-BusinessBase', format: 'HAR' }, { name: 'Feature', layer: '02-Feature', format: 'HAP' }, { name: 'OtherUi', layer: '04-BusinessBase', format: 'HSP' }];
function writeCatalog(root: string, modules: unknown[]) { write(root, 'doc/module-catalog.yaml', YAML.stringify({ schema_version: '1.0', modules })); }
/** 蓝图落盘后把 ledger-refresh CU 的蓝图 sha 同步到盘上（生产 resolver 按字节校验）。 */
function bindCuToBlueprint(root: string, bp: any, file: string) {
  write(root, path.relative(root, file), YAML.stringify(bp));
  const cu = cuForCurrentBlueprint(root);
  write(root, path.relative(root, loadCanonicalChangeUnit(root, 'ledger-app-blueprint', 'ledger-refresh').canonicalPath), YAML.stringify(cu));
  return cu;
}

test('a3c7e9d1 返修1 retire_module：退役前合法；closure 归位删 catalog 后 P1 与 closure 复核（resolveComponentBlueprintRef）仍通过', () => setup(root => {
  generate(root); const { bp, file, view } = blueprintFixture(root);
  const retiredNode = { ...view.nodes[0], node_id: 'retired-ui', module: 'OtherUi' }; delete retiredNode.kind; view.nodes.push(retiredNode);
  bp.decisions_and_gaps.decisions.push(architectureDecision('retire-other', { change: 'retire_module', module: 'OtherUi' }, 'decided_with_authority', bp));
  assert.deepEqual(blockerIds(bp, root), []);
  writeCatalog(root, CATALOG.filter(m => m.name !== 'OtherUi')); generate(root);
  assert.deepEqual(blockerIds(bp, root), []);
  const warn = validateEvolutionDecisions(bp, root).find(i => i.id === 'blueprint_architecture_impact_invalid');
  assert(warn?.severity === 'WARN' && warn.message.includes('OtherUi'), JSON.stringify(warn));
  const cu = bindCuToBlueprint(root, bp, file);
  assert.doesNotThrow(() => resolveComponentBlueprintRef(root, cu.component_blueprint_ref), 'closure 复核走同一完整校验，退役归位后不得判蓝图非法');
  assert(!componentDependencyAllowed(root, 'Feature', 'OtherUi', resolveAdmittedModules(root, bp).declared), '已退役模块不参与依赖许可');
}));

test('a3c7e9d1 返修2 CU-bound plan 组件检查消费蓝图获准层级：已批准 move 放行；未获准改层 / contracts 层级不一致仍拒绝', () => setup(root => {
  writeCatalog(root, [...CATALOG, { name: 'Mover', layer: '05-SystemBase', format: 'HAP' }]);
  generate(root); const { bp, file } = blueprintFixture(root);
  bindCuToBlueprint(root, bp, file);
  const value = contracts(); value.feature = deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh');
  value.components[0].module = 'Mover';
  value.modules = [{ name: 'Mover', layer: '02-Feature', format: 'HAP', change_type: 'modify', package_path: '02-Feature/Mover' }] as ContractsSpec['modules'];
  let checks = checkComponentSelections(context(root, value));
  assert(checks.some(r => r.status === 'FAIL' && r.details?.includes('依赖非法')), `未获准改层按 catalog 旧层判定：${JSON.stringify(checks)}`);
  assert(checks.some(r => r.status === 'FAIL' && r.details?.includes('不一致')), 'plan 手写层级与蓝图授权不一致必须拒绝');
  bp.decisions_and_gaps.decisions.push(architectureDecision('move-mover', { change: 'move_module', module: 'Mover', from_layer: '05-SystemBase', to_layer: '02-Feature' }, 'decided_with_authority', bp));
  assert.deepEqual(blockerIds(bp, root), []);
  bindCuToBlueprint(root, bp, file);
  checks = checkComponentSelections(context(root, value));
  assert(!checks.some(r => r.status === 'FAIL'), `已批准 move 的新层与 P1 同源放行：${JSON.stringify(checks)}`);
  value.modules[0].layer = '05-SystemBase';
  checks = checkComponentSelections(context(root, value));
  assert(checks.some(r => r.status === 'FAIL' && r.details?.includes('不一致')), JSON.stringify(checks));
}));

test('a3c7e9d1 返修3 未确认术语：当前切片依赖 → BLOCKER；远期受控 open_decision gap 停放 → WARN 且 admission 可过', () => setup(root => {
  generate(root); const { bp } = blueprintFixture(root);
  bp.discovery.facts.push(termFact('卡包', 'Feature', 'medium', 'model_inference')); refingerprint(bp);
  const gap: any = { gap_id: 'term-later', knowledge_state: 'unknown', status: 'open_decision', owner: 'product-owner', needed_by: 'later-slice', unlock_condition: '进入 later-slice 前确认术语', verification_refs: ['term:卡包'], provenance: bp.provenance };
  bp.decisions_and_gaps.gaps.push(gap);
  let issues = validateComponentBlueprint(bp, { projectRoot: root });
  assert(!issues.some(i => i.severity === 'BLOCKER'), JSON.stringify(issues.filter(i => i.severity === 'BLOCKER')));
  assert(issues.some(i => i.id === 'terminology_facts_confirmed' && i.severity === 'WARN' && i.message.includes('later-slice')));
  gap.needed_by = bp.review_summary.admission.current_slice.slice_id; gap.status = 'blocker';
  issues = validateComponentBlueprint(bp, { projectRoot: root });
  assert(issues.some(i => i.id === 'terminology_facts_confirmed' && i.severity === 'BLOCKER'), '当前切片依赖的未确认术语仍是 blocker');
  assert(issues.some(i => i.id === 'blueprint_admission_false_pass'));
  gap.status = 'open_decision';
  issues = validateComponentBlueprint(bp, { projectRoot: root });
  assert(issues.some(i => i.id === 'terminology_facts_confirmed' && i.severity === 'BLOCKER'));
  assert(issues.some(i => i.id === 'blueprint_current_unknown_not_blocking'));
  gap.needed_by = 'later-slice'; gap.verification_refs = ['term:别的术语'];
  assert(validateComponentBlueprint(bp, { projectRoot: root }).some(i => i.id === 'terminology_facts_confirmed' && i.severity === 'BLOCKER'), 'gap 未引用该术语不得停放');
  gap.verification_refs = ['term:卡包'];
  bp.decisions_and_gaps.gaps.push({ ...gap, gap_id: 'term-now', status: 'blocker', needed_by: bp.review_summary.admission.current_slice.slice_id });
  issues = validateComponentBlueprint(bp, { projectRoot: root });
  assert(issues.some(i => i.id === 'terminology_facts_confirmed' && i.severity === 'BLOCKER'), '同一术语另有当前 blocker gap 时远期 gap 不得停放');
  assert(issues.some(i => i.id === 'blueprint_admission_false_pass'), 'admission 不得 pass');
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
