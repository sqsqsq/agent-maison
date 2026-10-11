import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { createBlueprintReviewDesignFixture } from '../fixtures/blueprint-review-design';
import { asRecord, asRecords, BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import { loadCanonicalBlueprint, sha256Bytes } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, asChangeUnitArtifact, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { collectBlueprintReviewInputs } from '../../scripts/utils/blueprint-review-inputs';
import { renderBlueprintReviewMarkdown } from '../../scripts/utils/blueprint-review-projection';
import { loadBlueprintReviewSource, blueprintReviewDifferences, materializeBlueprintReview } from '../../scripts/utils/blueprint-review-materialization';
import { deriveBlueprintSkillInput, materializeBlueprintSkillInputs, selectBlueprintSkillContent, checkAuthoritativeContentAligned } from '../../scripts/utils/blueprint-skill-projection';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { validateCrossViewRelations } from '../../scripts/utils/blueprint-cross-view';
import { generateMermaidViewGraph, validateGeneratedBlueprintGraphs } from '../../scripts/utils/blueprint-graph-generator';
import { identityNeutralDigest } from '../../scripts/utils/identity-neutral-digest';
import { evaluateAcceptanceFlowStructure } from '../../scripts/utils/p0-semantic-gates';
import { featureFilePath } from '../../config';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { evaluateComponentClosure } from '../../scripts/utils/component-closure-validator';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { loadHostSnapshot } from '../fixtures/host-snapshot-3.1.0/generate';
import type { CheckContext, AcceptanceSpec } from '../../scripts/utils/types';

const frameworkRoot = path.resolve(__dirname, '../../..');
type Fixture = ReturnType<typeof createBlueprintReviewDesignFixture>;
function blueprint(f: Fixture): BlueprintRecord { return loadCanonicalBlueprint(f.root, 'ledger-app-blueprint').blueprint; }
function target(bp: BlueprintRecord, id: string): BlueprintRecord { return asRecords(bp.design_views).flatMap(v => [...asRecords(v.nodes), ...asRecords(v.runtime_data_flows)]).find(n => n.node_id === id || n.flow_id === id)!; }
function update(f: Fixture, mutate: (bp: BlueprintRecord) => void, bind = true): void { const bp = blueprint(f); mutate(bp); fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); if (bind) f.bind(); }
function render(f: Fixture): string { return loadBlueprintReviewSource(f.root, 'ledger-app-blueprint').markdown; }
const cases: Array<{ name: string; run(f: Fixture): void }> = [
  { name: 'review trace uses exact IDs within the owning target and keeps both focuses and narrative answer arrays', run(f) {
    update(f, bp => {
      asRecords(asRecord(target(bp, 'review-common').acceptance)!.criteria)[0].id = 'AC-100';
      const a = asRecords(asRecord(target(bp, 'ledger-module').acceptance)!.criteria)[0]; a.id = 'AC-1';
      Object.assign(a, { ut_layer: 'both', ut_focus: 'AC 的单测关注', device_focus: 'AC 的真机关注' });
      (asRecord(target(bp, 'ledger-module').acceptance)!.criteria as BlueprintRecord[]).push({ ...structuredClone(a), id: 'AC-10' });
      asRecords(asRecord(target(bp, 'ledger-report-module').acceptance)!.criteria)[0].id = 'AC-1';
      const ac = asRecord(target(bp, 'ledger-module').acceptance)!;
      Object.assign(asRecords(ac.boundaries)[0], { ut_layer: 'both', ut_focus: 'BD 的单测关注', device_focus: 'BD 的真机关注' });
      Object.assign(asRecords(ac.performance)[0], { ut_layer: 'both', ut_focus: 'NFR 的单测关注', device_focus: 'NFR 的真机关注' });
      asRecord(asRecord(bp.app_lens)!.initialization)!.answer = ['先读取持久快照', '随后建立重放订阅'];
    });
    f.cuFiles.forEach((file, i) => { const cu = YAML.parse(fs.readFileSync(file, 'utf8')); cu.target_predicates.forEach((p: BlueprintRecord, n: number) => { p.verification_refs = [i === 0 && n === 0 ? 'acceptance:AC-10' : 'acceptance:AC-1']; }); fs.writeFileSync(file, YAML.stringify(cu)); });
    const text = render(f); const section = text.slice(text.indexOf('## 9 质量与验收'), text.indexOf('## 10 施工拆分'));
    const rows = section.split('\n').filter(row => row.startsWith('| AC-1 |')); assert.equal(rows.length, 2);
    assert(rows[0].includes('ledger-refresh/runtime-owner') && !rows[0].includes('ledger-refresh/refresh-behavior') && !rows[0].includes('ledger-report/'), rows[0]);
    assert(rows[1].includes('ledger-report/') && !rows[1].includes('ledger-refresh/'), rows[1]);
    for (const kind of ['AC', 'BD', 'NFR']) { assert(text.includes(`UT：${kind} 的单测关注`)); assert(text.includes(`device：${kind} 的真机关注`)); }
    const exception = text.slice(text.indexOf('### 异常与恢复'), text.indexOf('## 5 开发视图')); assert(exception.includes('BD 的单测关注') && exception.includes('BD 的真机关注'));
    assert(text.includes('先读取持久快照；随后建立重放订阅'));
  } },
  { name: 'one rich fixture yields 4+1 detail, true shared/exclusive inheritance and read-only handoff', run(f) {
    const bp = blueprint(f); assert.deepStrictEqual(validateComponentBlueprint(bp, { projectRoot: f.root }).filter(i => i.severity === 'BLOCKER'), []);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); assert(ready.ready, JSON.stringify(ready.perUnit));
    for (const feature of [f.feature, f.reportFeature]) for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml', 'spec.md', 'plan.md']) assert(!fs.existsSync(featureFilePath(f.root, feature, name)), name);
    const text = render(f);
    for (const needle of ['## 2 场景视图（+1）', '## 3 逻辑视图', '## 4 运行时视图', '## 5 开发视图', '## 6 部署视图', '整数分的十进制字符串', 'LedgerStage', '验证步骤（按序）', '被否理由', '账号隔离', '本地首次读取时间', '是否通过交接校验见 readiness', 'report-ready', 'repository.commit']) assert(text.includes(needle), needle);
    const loaded = loadCanonicalBlueprint(f.root, 'ledger-app-blueprint'); const inputs = collectBlueprintReviewInputs(f.root, loaded);
    assert.equal(inputs.sourceGaps.length, 0);
    for (const item of inputs.units) {
      assert.equal(item.digest, identityNeutralDigest(f.root, 'change-unit@1', item.unit));
      const selected = selectBlueprintSkillContent(bp, item.unit!);
      const own = item.id === 'ledger-refresh' ? '2' : '3';
      assert.deepStrictEqual(new Set(asRecords(selected.acceptance?.criteria).map(r => r.id)), new Set(['AC-1', 'AC-' + own]));
      assert((selected.contracts?.files as string[]).includes('src/ledger/LedgerShared.ets'));
      assert(!(selected.contracts?.files as string[]).includes(item.id === 'ledger-refresh' ? 'src/ledger/LedgerReport.ets' : 'src/ledger/LedgerFeature.ets'));
    }
    assert.equal(fs.readFileSync(path.join(frameworkRoot, 'docs/operations/samples/blueprint-review-projection.valid.md'), 'utf8'), text);
    for (const feature of [f.feature, f.reportFeature]) {
      const expected = deriveBlueprintSkillInput(f.root, feature, frameworkRoot, 'contracts');
      materializeBlueprintSkillInputs(f.root, feature, frameworkRoot);
      for (const [artifact, name] of [['contracts@1', 'contracts.yaml'], ['use-cases@1', 'use-cases.yaml']] as const) assert.deepStrictEqual(YAML.parse(fs.readFileSync(featureFilePath(f.root, feature, name), 'utf8')), expected.artifacts![artifact]);
      const parsed = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature);
      const field = parsed.contracts!.data_models.find(m => m.name === 'Amount')!.fields[0];
      assert.equal(field.description, '整数分的十进制字符串，禁止浮点金额；最大长度由获准接口定义。'); assert.equal(field.source_ref, 'contracts/ledger-api.yaml#/dtos/CreateEntryRequestV1/fields/0');
    }
  } },
  { name: 'P0 spec supplements actual UI keys from real projection, preserves authority and passes original flow gate', run(f) {
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance'); assert.equal(projected.state, 'resolved', projected.detail);
    const acceptance = structuredClone(projected.value) as AcceptanceSpec & BlueprintRecord;
    const ac = acceptance.criteria.find(c => c.id === 'AC-2')! as unknown as BlueprintRecord; assert.equal(ac.linked_flow, undefined);
    const uiPath = featureFilePath(f.root, f.feature, 'ui-spec.yaml'); fs.writeFileSync(uiPath, YAML.stringify({ schema_version: '1.0', screens: [{ id: 'ledger-entry', elements: [{ id: 'submit-entry', type: 'button' }] }, { id: 'ledger-current', elements: [{ id: 'current-balance', type: 'text' }] }] }));
    const ui = YAML.parse(fs.readFileSync(uiPath, 'utf8'));
    fs.writeFileSync(path.join(f.root, 'ui-request.md'), '提交成功后账页显示新余额，重启后保持一致');
    Object.assign(ac, { linked_flow: 'ledger-submit', requirement_ref: { source_path: 'ui-request.md', snippet: '提交成功后账页显示新余额' }, checkpoint: { pre_screen: ui.screens[0].id, action: { type: 'touch', target_element_id: ui.screens[0].elements[0].id }, post_screen: ui.screens[1].id, required_element_ids: [ui.screens[1].elements[0].id] } });
    acceptance.flows = { 'ledger-submit': { screens: ui.screens.map((s: BlueprintRecord) => s.id) } };
    acceptance.source = 'spec:ui-spec.yaml';
    fs.writeFileSync(featureFilePath(f.root, f.feature, 'acceptance.yaml'), YAML.stringify(acceptance));
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature);
    const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', phaseRule: {}, featureSpec: spec } as CheckContext;
    const alignment = checkAuthoritativeContentAligned(ctx, 'acceptance'); assert(alignment.length > 0 && alignment.every(c => c.status === 'PASS'));
    assert(evaluateAcceptanceFlowStructure(f.root, f.feature, spec.acceptance).every(c => c.status === 'PASS'));
    spec.acceptance!.criteria.find(c => c.id === 'AC-2')!.expected_result = '允许显示未提交金额';
    assert(checkAuthoritativeContentAligned(ctx, 'acceptance').some(c => c.status === 'FAIL'));
    update(f, bp => { asRecords(asRecord(target(bp, 'ledger-module').acceptance)!.criteria).find(c => c.id === 'AC-2')!.linked_flow = 'premature-ui'; });
    const invalid = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance'); assert.equal(invalid.state, 'invalid'); assert(invalid.codes?.includes('authority_acceptance_content_invalid'));
  } },
  { name: 'readiness checks declared malformed use_cases even when acceptance and contracts are absent', run(f) {
    update(f, bp => { for (const v of asRecords(bp.design_views)) for (const n of [...asRecords(v.nodes), ...asRecords(v.runtime_data_flows)]) { delete n.acceptance; delete n.contracts; }
      target(bp, 'ledger-refresh-flow').use_cases = { schema_version: '2', use_cases: [{ id: 'bad', coordinator: 'flow.run' }] }; });
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance'); assert.equal(projected.state, 'invalid'); assert(projected.codes?.includes('authority_construction_content_incomplete'), projected.detail);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); const unit = ready.perUnit.find(u => u.changeUnitId === 'ledger-refresh')!; assert.equal(unit.verdict, 'blocked');
    assert.deepStrictEqual(unit.projectionIssues.map(i => i.kind), ['acceptance', 'contracts']);
    assert(unit.projectionIssues.every(i => i.codes?.includes('authority_construction_content_incomplete') && i.detail === projected.detail));
  } },
  { name: 'uncoded projection exception remains blocked with its actual detail and no invented shape code', run(f) {
    update(f, bp => { asRecords(asRecord(target(bp, 'ledger-module').contracts)!.data_models)[0].fields = { malformed: true }; });
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'invalid'); assert.deepStrictEqual(projected.codes, []); assert(projected.detail?.includes('not iterable'), projected.detail);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); const unit = ready.perUnit.find(u => u.changeUnitId === 'ledger-refresh')!;
    assert(!ready.ready && unit.verdict === 'blocked', JSON.stringify(unit));
    assert(!unit.issueIds.includes('authority_projection_shape_invalid'));
    assert.deepStrictEqual(unit.projectionIssues, [{ kind: 'contracts', codes: [], detail: projected.detail }]);
  } },
  { name: 'default readiness reports existing use-cases conflict while canonical document and publication stay unchanged', run(f) {
    const before = render(f); const source = loadBlueprintReviewSource(f.root, 'ledger-app-blueprint');
    fs.writeFileSync(featureFilePath(f.root, f.feature, 'use-cases.yaml'), YAML.stringify({ schema_version: '2', feature: f.feature, use_cases: [] }));
    assert.equal(render(f), before); assert.deepStrictEqual(blueprintReviewDifferences(before, loadBlueprintReviewSource(f.root, 'ledger-app-blueprint')), []);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); const unit = ready.perUnit.find(u => u.changeUnitId === 'ledger-refresh')!; assert(unit.issueIds.includes('authority_use_cases_conflict'));
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert(unit.projectionIssues.some(i => i.kind === 'contracts' && i.codes?.includes('authority_use_cases_conflict') && i.detail === projected.detail));
    fs.appendFileSync(path.join(f.root, 'requirements/ledger.md'), '\n外部原文追加但尚未修订蓝图\n');
    assert.equal(render(f), before); assert.deepStrictEqual(blueprintReviewDifferences(before, loadBlueprintReviewSource(f.root, 'ledger-app-blueprint')), []);
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance').state, 'invalid');
    assert(source.inputs.units.every(u => u.binding === 'bound'));
  } },
  { name: 'shared object conflicts use actual authority_content_conflict; misplaced rows remain inherited', run(f) {
    update(f, bp => { const shared = target(bp, 'review-common'); asRecord(shared.contracts)!.change_unit = structuredClone(asRecord(target(bp, 'ledger-module').contracts)!.change_unit);
      (asRecord(shared.acceptance)!.criteria as BlueprintRecord[]).push(structuredClone(asRecords(asRecord(target(bp, 'ledger-module').acceptance)!.criteria)[0]));
      (asRecord(shared.contracts)!.files as string[]).push('src/ledger/LedgerFeature.ets'); });
    const conflict = deriveBlueprintSkillInput(f.root, f.reportFeature, frameworkRoot, 'contracts'); assert(conflict.codes?.includes('authority_content_conflict'), conflict.detail);
    assert(/合并无效：authority.*content.*conflict/.test(render(f)));
    update(f, bp => { delete asRecord(target(bp, 'ledger-report-module').contracts)!.change_unit; });
    const wrong = deriveBlueprintSkillInput(f.root, f.reportFeature, frameworkRoot, 'contracts'); assert(wrong.codes?.some(c => c === 'change_unit_predicate_mapping_unknown' || c === 'change_unit_predicate_mapping_missing'), wrong.detail);
    const unit = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-report').changeUnit); const selected = selectBlueprintSkillContent(blueprint(f), unit);
    assert(asRecords(selected.acceptance?.criteria).some(c => c.id === 'AC-2')); assert((selected.contracts?.files as string[]).includes('src/ledger/LedgerFeature.ets'));
    assert(render(f).includes('AC-2'));
  } },
  { name: 'optional malformed presentation stays WARN and ready; zero CU still renders typed target details', run(f) {
    update(f, bp => { asRecord(bp.review_summary)!.goals = 'bad'; target(bp, 'report-scenario').journey_steps = { bad: true }; asRecords(bp.quality_attributes)[0].verification_refs = 1; });
    const issues = validateComponentBlueprint(blueprint(f), { projectRoot: f.root }); assert(issues.some(i => i.id === 'blueprint_presentation_shape_invalid')); assert(!issues.some(i => i.severity === 'BLOCKER'), JSON.stringify(issues));
    assert(deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint').ready);
    const loaded = loadCanonicalBlueprint(f.root, 'ledger-app-blueprint'); const draft = renderBlueprintReviewMarkdown(loaded.blueprint, loaded.artifactSha256);
    assert(draft.includes('尚未拆分')); assert(draft.includes('AC-2')); assert(draft.includes('LedgerEntry')); assert(draft.includes('可选表达未能完整显示'));
    update(f, bp => { target(bp, 'ledger-module').acceptance = '请测试刷新'; asRecords(asRecord(target(bp, 'review-common').contracts)!.data_models)[0].fields = ['broken']; });
    const invalidText = render(f); assert(invalidText.includes('acceptance 无效')); assert(invalidText.includes('fields 无效'));
  } },
  { name: 'pending pointer defers CU merged collection, exact bad supersedes remains a source gap', run(f) {
    update(f, bp => { bp.revision = Number(bp.revision) + 1; for (const r of asRecords(bp.derived_results)) r.input_revision = bp.revision; }, false);
    const pending = render(f); const unitSection = pending.slice(pending.indexOf('## 10 施工拆分'), pending.indexOf('## 11 风险'));
    assert(unitSection.includes('待指针升版后显示')); assert(!unitSection.includes('合并无效'));
    f.bind(); const cu = YAML.parse(fs.readFileSync(f.cuFiles[1], 'utf8')); const prior = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
    cu.supersedes = { artifact: 'change-unit@1', component_id: 'ledger', blueprint_id: 'ledger-app-blueprint', change_unit_id: 'ledger-refresh', revision: 1, artifact_sha256: sha256Bytes(Buffer.from('wrong')) }; fs.writeFileSync(f.cuFiles[1], YAML.stringify(cu));
    const source = loadBlueprintReviewSource(f.root, 'ledger-app-blueprint'); assert(source.inputs.sourceGaps.length > 0); assert(source.inputs.units.find(u => u.id === 'ledger-report')!.binding === 'unresolved'); assert(prior.artifactSha256 !== cu.supersedes.artifact_sha256);
  } },
  { name: 'contract and global relation tables show only active direct CU claims including pending pointers', run(f) {
    const tableRow = (text: string, id: string): string => text.slice(text.indexOf('## 6 部署视图'), text.indexOf('## 7 方案取舍')).split('\n').find(row => row.startsWith(`| ${id} |`))!;
    let text = render(f); assert(text.includes('| 契约 | 责任方 | 本侧需要方 | 认领 CU |')); assert(text.includes('| 关系 | 起点 | 终点 | 类型 | 责任方 | 认领 CU |'));
    assert(tableRow(text, 'create-entry-v1').endsWith('| ledger-refresh |')); assert(tableRow(text, 'read-report-v1').endsWith('| ledger-report |'));
    assert(tableRow(text, 'local-ledger-consumes-service').endsWith('| ledger-refresh |')); assert(tableRow(text, 'report-domain-owned-by-module').endsWith('| ledger-report |'));
    assert(text.indexOf('## 各视图的显式联系') > text.indexOf('## 6 部署视图')); assert(!text.includes('### 各视图的显式联系'));
    update(f, bp => { bp.revision = Number(bp.revision) + 1; for (const r of asRecords(bp.derived_results)) r.input_revision = bp.revision; }, false);
    text = render(f); assert(tableRow(text, 'create-entry-v1').endsWith('| ledger-refresh（待升版） |')); assert(tableRow(text, 'report-domain-owned-by-module').endsWith('| ledger-report（待升版） |'));
    f.bind();
    const report = YAML.parse(fs.readFileSync(f.cuFiles[1], 'utf8'));
    report.design_refs = report.design_refs.filter((r: BlueprintRecord) => !['read-report-v1', 'report-domain-owned-by-module'].includes(String(asRecord(r.target)?.id)));
    fs.writeFileSync(f.cuFiles[1], YAML.stringify(report));
    update(f, bp => { asRecords(bp.contracts).find(c => c.contract_id === 'read-report-v1')!.needed_by = 'ledger-report'; });
    text = render(f); assert(tableRow(text, 'read-report-v1').endsWith('| 无 CU 直接引用 |')); assert(tableRow(text, 'report-domain-owned-by-module').endsWith('| 无 CU 直接引用 |'));
    const prior = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
    const successor = YAML.parse(fs.readFileSync(f.cuFiles[1], 'utf8')); successor.supersedes = createChangeUnitRef(prior); fs.writeFileSync(f.cuFiles[1], YAML.stringify(successor));
    const source = loadBlueprintReviewSource(f.root, 'ledger-app-blueprint'); assert.equal(source.inputs.units.find(u => u.id === 'ledger-refresh')!.retiredBy, 'ledger-report');
    assert(tableRow(source.markdown, 'create-entry-v1').endsWith('| 无 CU 直接引用 |')); assert(tableRow(source.markdown, 'local-ledger-consumes-service').endsWith('| 无 CU 直接引用 |'));
  } },
  { name: 'pure selection preserves the original missing-target resolver code', run(f) {
    const unit = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit);
    const missing = structuredClone(unit); missing.design_refs[0].target.id = 'does-not-exist';
    assert.throws(() => selectBlueprintSkillContent(blueprint(f), missing), (error: unknown) => (error as { code: string }).code === 'component_blueprint_target_missing');
  } },
  { name: 'unknown canonical layer relevance keeps exact CU binding and declarations without inventing a digest', run(f) {
    update(f, bp => { (asRecord(bp.decisions_and_gaps)!.decisions as BlueprintRecord[]).push({ decision_id: 'layer-only', kind: 'architecture_impact', change: 'dependency_edge', from: '02-Feature', to: '04-Base', direction: 'add', rationale: '明确层许可', status: 'decided_with_authority', owner: 'architecture-owner', provenance: bp.provenance, verification_refs: ['verify:layer-edge'] }); });
    const loaded = loadCanonicalBlueprint(f.root, 'ledger-app-blueprint'); const inputs = collectBlueprintReviewInputs(f.root, loaded);
    assert.equal(inputs.sourceGaps.length, 0); assert(inputs.units.every(u => u.binding === 'bound' && u.digest === undefined && u.equivalenceUnavailable));
    const text = renderBlueprintReviewMarkdown(loaded.blueprint, loaded.artifactSha256, inputs); assert(!text.includes('中立等价证明')); assert(text.includes('合并所得声明集合')); assert(text.includes('AC-2'));
    fs.appendFileSync(path.join(f.root, 'doc/module-catalog.yaml'), '\n# 外部层归属仍不作为展示输入\n'); assert.equal(render(f), text);
    const strictBefore = identityNeutralDigest(f.root, 'change-unit@1', inputs.units[0].unit); assert(strictBefore); assert.equal(identityNeutralDigest(f.root, 'change-unit@1', inputs.units[0].unit), strictBefore);
  } },
  { name: 'materialized invalid revision fails in reconciliation before readiness and rolls all CU/projection bytes back', run(f) {
    for (const feature of [f.feature, f.reportFeature]) materializeBlueprintSkillInputs(f.root, feature, frameworkRoot);
    const files = [...f.cuFiles, ...[f.feature, f.reportFeature].flatMap(feature => ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'].map(name => featureFilePath(f.root, feature, name)))]; const before = files.map(file => fs.readFileSync(file));
    update(f, bp => { bp.revision = Number(bp.revision) + 1; for (const r of asRecords(bp.derived_results)) r.input_revision = bp.revision; target(bp, 'ledger-refresh-flow').use_cases = 'bad use case'; }, false);
    assert.throws(() => deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'), (error: unknown) => (error as { code: string }).code === 'change_unit_blueprint_ref_bump_rejected');
    files.forEach((file, i) => assert(fs.readFileSync(file).equals(before[i]), file));
  } },
  { name: 'real closure owns external consumed interface and relation on our side; local report has a deployment landing', run(f) {
    const bp = blueprint(f); assert.deepStrictEqual(validateCrossViewRelations(bp), []);
    const external = target(bp, 'ledger-service'); assert.equal(external.current_state, external.target_state); assert.equal(external.delta, undefined);
    assert.deepStrictEqual(target(bp, 'report-scenario').deployment_refs, ['view:deployment/node:local-report']);
    for (const feature of [f.feature, f.reportFeature]) materializeBlueprintSkillInputs(f.root, feature, frameworkRoot);
    const evaluation = evaluateComponentClosure(f.root, 'ledger-app-blueprint');
    const expected = ['contract:create-entry-v1', 'relation:local-ledger-consumes-service', 'view:deployment/node:ledger-service'];
    for (const address of expected) { const rows = evaluation.closure.coverage_rows.filter(row => row.blueprint_refs.includes(address)); assert(rows.length, address); assert(rows.every(row => row.owner_change_unit_ids.includes('ledger-refresh')), JSON.stringify(rows)); }
    assert(!asRecords(bp.contracts).some(c => c.contract_id === 'operations-config'));
    // 只验真实责任闭包；本夹具没有施工/产品完成证据，P3 不应假 PASS。
    assert.equal(evaluation.closure.verdict, 'FAIL');
  } },
  { name: 'same node names across views never alias an external endpoint; invalid canonical graph is disclosed', run(f) {
    const bp = blueprint(f); const logical = asRecords(bp.design_views).find(v => v.view_id === 'logical')!;
    logical.nodes = [{ node_id: 'same', label: '甲"<节点>|', owner: 'one' }, { node_id: 'local', label: '乙', owner: 'one' }];
    bp.relations = [{ relation_id: 'foreign', from: 'view:development/node:same', to: 'view:logical/node:local', relation_type: 'foreign' }, { relation_id: 'local', from: 'view:logical/node:same', to: 'view:logical/node:local', relation_type: 'local' }];
    const graph = generateMermaidViewGraph(bp, 'logical'); assert.deepStrictEqual(graph.relation_refs, ['relation:local']); assert(!graph.content.includes('foreign')); assert(graph.content.includes('&quot;'));
    bp.generated_graphs = [graph]; assert(!validateGeneratedBlueprintGraphs(bp).some(i => i.id === 'blueprint_generated_graph_parse_failed'));
    update(f, actual => { asRecords(actual.generated_graphs)[0].content = 'sequenceDiagram\nparticipant invalid'; });
    const text = render(f); assert(text.includes('结构图无效，未展示')); assert(!text.includes('participant invalid'));
  } },
];
export function runAll() {
  const results = cases.map(c => { const f = createBlueprintReviewDesignFixture(); try { c.run(f); return { name: c.name, ok: true }; } catch (error) { return { name: c.name, ok: false, error: (error as Error).stack }; } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
  const old = loadHostSnapshot();
  const name = 'previously completed but non-retired CU is still checked after authoritative content becomes invalid';
  try {
    const loaded = loadCanonicalChangeUnit(old.root, 'ledger-app-blueprint', 'ledger-refresh');
    assert.equal(observeChangeUnitCompletion(old.root, asChangeUnitArtifact(loaded.changeUnit)).state, 'VALID');
    const bp = loadCanonicalBlueprint(old.root, 'ledger-app-blueprint'); const content = asRecords(bp.blueprint.design_views).flatMap(v => asRecords(v.nodes)).find(n => asRecord(n.acceptance));
    assert(content); asRecords(asRecord(content.acceptance)!.criteria)[0].expected_result = '';
    fs.writeFileSync(bp.canonicalPath, YAML.stringify(bp.blueprint));
    const cu = YAML.parse(fs.readFileSync(loaded.canonicalPath, 'utf8')); const hash = sha256Bytes(fs.readFileSync(bp.canonicalPath));
    const walk = (value: unknown): void => { if (!value || typeof value !== 'object') return; if ((value as BlueprintRecord).artifact === 'component-blueprint@1') (value as BlueprintRecord).artifact_sha256 = hash; Object.values(value).forEach(walk); };
    walk(cu); fs.writeFileSync(loaded.canonicalPath, YAML.stringify(cu));
    const ready = deriveDesignPreparationReadiness(old.root, 'ledger-app-blueprint'); const item = ready.perUnit.find(u => u.changeUnitId === 'ledger-refresh');
    assert(item && item.verdict === 'blocked' && item.issueIds.includes('authority_acceptance_content_invalid'), JSON.stringify(ready.perUnit));
    results.push({ name, ok: true });
  } catch (error) { results.push({ name, ok: false, error: (error as Error).stack }); }
  finally { fs.rmSync(old.root, { recursive: true, force: true }); }
  return results;
}
