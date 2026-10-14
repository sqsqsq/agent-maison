import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { createBlueprintReviewDesignFixture, hostBlueprintReviewFields, libraryBlueprintReviewSchema } from '../fixtures/blueprint-review-design';
import { asRecord, asRecords, asStrings, BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import { loadCanonicalBlueprint, sha256Bytes } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, asChangeUnitArtifact, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { collectBlueprintReviewInputs } from '../../scripts/utils/blueprint-review-inputs';
import { renderBlueprintReviewMarkdown, blueprintReviewAnchor } from '../../scripts/utils/blueprint-review-projection';
import { loadBlueprintReviewSource, blueprintReviewDifferences, materializeBlueprintReview } from '../../scripts/utils/blueprint-review-materialization';
import { deriveBlueprintSkillInput, materializeBlueprintSkillInputs, selectBlueprintSkillContent, checkAuthoritativeContentAligned } from '../../scripts/utils/blueprint-skill-projection';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { validateCrossViewRelations } from '../../scripts/utils/blueprint-cross-view';
import { generateMermaidViewGraph, generateMermaidPhaseGraph, generateMermaidRelationGraph, parseMermaidSubset, validateGeneratedBlueprintGraphs } from '../../scripts/utils/blueprint-graph-generator';
import { identityNeutralDigest } from '../../scripts/utils/identity-neutral-digest';
import { evaluateAcceptanceFlowStructure } from '../../scripts/utils/p0-semantic-gates';
import { featureFilePath } from '../../config';
import { SpecLoader, normalizeUseCasePortCalls } from '../../scripts/utils/spec-loader';
import { evaluateComponentClosure } from '../../scripts/utils/component-closure-validator';
import { observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { loadMigratedHostSnapshot } from '../fixtures/host-snapshot-3.1.0/migrate';
import type { CheckContext, AcceptanceSpec } from '../../scripts/utils/types';

const frameworkRoot = path.resolve(__dirname, '../../..');
type Fixture = ReturnType<typeof createBlueprintReviewDesignFixture>;
function blueprint(f: Fixture): BlueprintRecord { return loadCanonicalBlueprint(f.root, 'ledger-app-blueprint').blueprint; }
function target(bp: BlueprintRecord, id: string): BlueprintRecord { return asRecords(bp.design_views).flatMap(v => [...asRecords(v.nodes), ...asRecords(v.runtime_data_flows)]).find(n => n.node_id === id || n.flow_id === id)!; }
function update(f: Fixture, mutate: (bp: BlueprintRecord) => void, bind = true): void { const bp = blueprint(f); mutate(bp); fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); if (bind) f.bind(); }
function render(f: Fixture): string { return loadBlueprintReviewSource(f.root, 'ledger-app-blueprint').markdown; }
const cases: Array<{ name: string; run(f: Fixture): void }> = [
  { name: 'readable projection preserves false zero business keys and exact anchors without empty tables or body addresses', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    target(bp, 'add-entry-scenario').source_ref = 'requirements/review-screenshot.png';
    const contract = asRecords(bp.contracts)[0];
    (asRecord(target(bp, 'ledger-module').contracts)!.files as string[]).push('src/ledger/route_map.json');
    contract.errors = { failure: '失败保留原记录', provenance: { source_ref: 'hidden-structural-marker' } };
    contract.idempotency = { behavior: '单次提交只写一次', source_ref: 'contracts/ledger-api.yaml#/idempotency' };
    contract.nfr = { durability: '提交后持久化', privacy: '完整号不写日志' };
    asRecords(flow.publications)[0].payload = { enabled: false, count: 0, list: [false, 0], nested: { inner: { enabled: true } }, provenance: { source_ref: 'hidden-structural-marker' } };
    asRecords(asRecords(asRecord(flow.use_cases)!.use_cases)[0].branches)[0].expected_state = { provenance: '这是业务状态键', ready: false, count: 0 };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:readability', { units: [], sourceGaps: [], closureExists: false, sourceRootRelative: path.relative(path.dirname(f.blueprintFile), f.root).replace(/\\/g, '/') });
    for (const fact of ['failure：失败保留原记录', 'behavior：单次提交只写一次', 'durability：提交后持久化', 'privacy：完整号不写日志', '| enabled | false |', '| count | 0 |', '| list | false；0 |', 'inner：已声明（结构未展开）', 'provenance：这是业务状态键']) assert(text.includes(fact), fact);
    assert(!text.includes('hidden-structural-marker')); assert(text.includes('contracts/ledger-api.yaml#/idempotency'));
    assert(text.includes('| src/ledger/route\\_map.json |'), '完整文件清单保留路径且只转义一次');
    fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); f.bind();
    assert(render(f).includes(`[route\\_map.json](#${blueprintReviewAnchor('file:src/ledger/route_map.json')})`), 'CU 精确文件链接标签只转义一次');
    const body = text.slice(text.indexOf('## 1 概述'), text.indexOf('## 附录')).replace(/\]\([^)]*\)/g, ']');
    assert(!/\b(?:view|contract|relation|decision|publication|recovery|initial-load|requirement|consumer|data-domain):/.test(body));
    assert(!/^\|[^\n]+\|\n\|(?: --- \|)+\n(?=\n|#)/m.test(text));
    const targets = new Set([...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]));
    for (const match of text.matchAll(/\]\(#(design-[0-9a-f]+)\)/g)) assert(targets.has(match[1]), `缺锚点 ${match[1]}`);
    const image = [...text.matchAll(/^!\[[^\]]*\]\(([^)]+)\)/gm)]; assert.equal(image.length, 1);
    assert(fs.existsSync(path.resolve(path.dirname(f.blueprintFile), decodeURI(image[0][1]))), image[0][1]);
    const acceptanceChapter = text.slice(text.indexOf('## 9 质量与验收'), text.indexOf('## 10 施工拆分'));
    assert.equal(acceptanceChapter.split('\n').filter(row => row.startsWith('| AC-1 |')).length, 1);
    const indexChapter = text.slice(text.indexOf('## 附录：编号速查'), text.indexOf('## 附录：稳定设计地址'));
    assert(indexChapter.split('\n').some(row => row.startsWith('| AC-1 |') && row.includes('[AC-1](#design-')), '附录只能链接主责编号');
  } },
  { name: 'missing summaries stay before the next model or construction source and source metadata stays unchanged', run(f) {
    const bp = blueprint(f); const flows = asRecords(asRecords(bp.design_views).find(v => v.view_id === 'runtime')!.runtime_data_flows);
    asRecords(flows[1].consumers)[0].consumption = undefined;
    bp.source_fingerprint = 'data-domain:ledger-entry';
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:source-layout');
    const header = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]); assert.equal(header.derived_from.source_fingerprint, bp.source_fingerprint);
    const models = text.slice(text.indexOf('### 领域模型、字段与枚举'), text.indexOf('### 本部件实际消费或提供的操作与 DTO'));
    const nextModelSource = models.indexOf(`内容承载于：[账目刷新模块](#${blueprintReviewAnchor('view:development/node:ledger-module')})`);
    const modelMissing = /^未记录：.*默认值.*。$/m.exec(models);
    assert(modelMissing && modelMissing.index < nextModelSource, models);
    const runtime = text.slice(text.indexOf('### 报表首次读取与快照更新'), text.indexOf('## 5 开发视图'));
    const nextStateSource = runtime.indexOf(`内容承载于：[账目提交、发布与恢复](#${blueprintReviewAnchor('view:runtime/flow:ledger-refresh-flow')})`);
    const flowMissing = /^未记录：.*消费语义.*$/m.exec(runtime);
    assert(flowMissing && flowMissing.index < nextStateSource, runtime);
    assert(!text.includes('| covered |')); assert(text.includes('已覆盖'));
    assert(!text.includes('publication:') || text.indexOf('publication:') > text.indexOf('## 附录'));
  } },
  { name: 'phase and overview edges trace only explicit branch adjacency or relation with distinct complete addresses', run(f) {
    const uc = asRecords(asRecord(asRecord(hostBlueprintReviewFields().flow)!.use_cases)!.use_cases)[0];
    const graph = generateMermaidPhaseGraph(uc); assert.equal(parseMermaidSubset(graph.content), undefined);
    assert.equal(graph.content.split('\n').filter(line => line.includes('-->')).length, new Set(graph.edges.map(edge => JSON.stringify([edge.from, edge.to]))).size, '相同阶段转移只画一次');
    assert(!graph.edges.some(edge => edge.from === 'Success' && edge.to === 'Failure'));
    for (const edge of graph.edges) {
      const source = asRecords(uc.branches).find(branch => branch.id === edge.branch)!; const sequence = asStrings(source.expected_phase_seq);
      assert(sequence.some((phase, i) => phase === edge.from && sequence[i + 1] === edge.to), JSON.stringify(edge));
    }
    const bp = blueprint(f); const logical = asRecords(bp.design_views).find(v => v.view_id === 'logical')!; const development = asRecords(bp.design_views).find(v => v.view_id === 'development')!;
    logical.nodes = [{ node_id: 'same', label: '同名对象' }]; development.nodes = [{ node_id: 'same', label: '同名对象' }];
    bp.relations = [{ relation_id: 'explicit', from: 'view:logical/node:same', to: 'view:development/node:same', relation_type: 'implements' }];
    const overview = generateMermaidRelationGraph(bp); assert.equal(parseMermaidSubset(overview.content), undefined);
    assert.deepStrictEqual(overview.node_refs, ['view:logical/node:same', 'view:development/node:same']); assert.deepStrictEqual(overview.relation_refs, ['relation:explicit']);
    assert(overview.content.includes('同名对象（逻辑）') && overview.content.includes('同名对象（开发）'));
    assert.deepStrictEqual(validateGeneratedBlueprintGraphs({ ...bp, generated_graphs: [overview] }), []);
    const isolated = renderBlueprintReviewMarkdown(bp, 'sha256:graph'); assert(isolated.includes(blueprintReviewAnchor('view:logical/node:same'))); assert(isolated.includes(blueprintReviewAnchor('view:development/node:same')));
  } },
  { name: 'original host payload, handling/retry, nine storage columns and legacy calls remain visible', run(f) {
    const bp = blueprint(f); const original = hostBlueprintReviewFields(); const originalContract = asRecord(original.contract)!; const originalFlow = asRecord(original.flow)!;
    bp.contracts = [originalContract];
    const flow = target(bp, 'ledger-refresh-flow');
    Object.assign(flow, originalFlow);
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:raw-host-example');
    const publication = asRecords(originalFlow.publications)[0];
    assert(text.includes(String(publication.payload)), String(publication.payload));
    const recovery = asRecord(originalFlow.failure_recovery)!;
    assert(text.includes(String(recovery.handling))); assert(text.includes(String(recovery.retry)));
    const schema = asRecord(originalContract.table_schema)!; const columns = asRecords(schema.columns); assert.equal(columns.length, 9);
    const escaped = (value: unknown) => String(value).replace(/([\\`*_[\]])/g, '\\$1');
    for (const column of columns) { assert(text.includes(`| ${escaped(column.name)} | ${escaped(column.type)} | ${escaped(column.from)} |`), JSON.stringify(column)); }
    assert(text.includes('wallet\\_bank\\_cards')); assert(text.includes('| JSON |')); assert(text.includes(escaped(schema.source_ref)));
    for (const call of ['banks.getBankCardOptions', 'account.getUserProfile', 'cards.saveBankCard']) assert(text.includes(call), call);
    assert(!text.includes('用例调用声明无效')); assert(text.includes('尚未拆分'));
    assert(JSON.stringify(originalFlow.use_cases).includes('expected_boundary_calls'), '原样保存旧字段，未先适配夹具');
  } },
  { name: 'library storage preserves ten columns, descriptions, keys and actual schema settings without altering author missing prose', run(f) {
    const bp = blueprint(f); const schema = libraryBlueprintReviewSchema();
    bp.contracts = [{ contract_id: 'wallet-store', label: '卡片库（未记录旧版）', operation: { operation_id: 'save', direction: 'client_to_local_rdb' }, table_schema: schema }];
    asRecord(bp.review_summary)!.title = '未记录也要照原文保留';
    asRecord(bp.review_summary)!.summary = '作者说明：旧库未记录升级，但新库声明v1。';
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:library');
    for (const fact of ['# 未记录也要照原文保留', '作者说明：旧库未记录升级，但新库声明v1。', '#### 卡片库（未记录旧版）', '| 数据库 | wallet\\_cards.db |', '| 版本 | 1 |', '| 安全级别 | S4 |', '| 加密 | 是 |', '客户端到本地数据库', 'PRIMARY KEY', 'v0事务建表后置v1', '##### 表 cards']) assert(text.includes(fact), fact);
    assert(!text.includes('#### —')); assert(!text.includes('columns 未能表达'));
    const stored = asRecords(schema.tables)[0];
    for (const column of asRecords(stored.columns)) { assert(text.includes(String(column.name).replace(/_/g, '\\_')), String(column.name)); assert(text.includes(String(column.description)), String(column.description)); }
    const source = String(stored.source_ref); assert(text.includes(source));
    const second = { name: 'audit', columns: [{ name: 'created', type: 'INTEGER', description: '审计时刻', default: 0 }], primary_key: [], source_ref: 'contracts/audit.yaml' };
    (schema.tables as unknown[]).push(second);
    const multi = renderBlueprintReviewMarkdown(bp, 'sha256:library'); assert(multi.includes('##### 表 audit')); assert(multi.includes('审计时刻')); assert(multi.includes('| 主键 | 无 |')); assert(multi.includes('contracts/audit.yaml'));
  } },
  { name: 'equivalent DTO fields reuse one domain model but preserve nullable, required, defaults and all source identities', run(f) {
    const bp = blueprint(f); const contract = asRecords(bp.contracts)[0];
    const model = { name: 'WalletCardRecord', module: 'ledger', file: 'src/ledger/LedgerEntry.ets', kind: 'interface', fields: ['account', 'number', 'bank'].map(name => ({ name, type: 'string', required: true, description: `共同语义${name}`, source_ref: `models.yaml#${name}` })) };
    asRecord(target(bp, 'ledger-module').contracts)!.data_models = [model];
    const dto = { dto_id: model.name, source_ref: 'contracts/input.yaml', fields: model.fields.map(field => ({ field_id: field.name, type: field.type, semantics: field.description, nullable: false, source_ref: `input.yaml#${field.name}` })) };
    contract.request_dto = dto; contract.response_dto = { ...structuredClone(dto), source_ref: 'contracts/output.yaml', fields: dto.fields.map(field => ({ ...field, required: false, default: '默认银行卡', source_ref: `output.yaml#${field.field_id}` })) };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:dto');
    for (const field of model.fields) {
      assert.equal(text.split(field.description).length - 1, 1, field.description);
      for (const source of [`models.yaml#${field.name}`, `input.yaml#${field.name}`, `output.yaml#${field.name}`]) assert(text.includes(source), source);
    }
    assert(text.includes('全表共同可空：否')); assert(text.includes('全表共同必需：否')); assert(text.includes('必需与可空是独立声明')); assert(text.includes('默认银行卡'));
    (dto.fields[0] as BlueprintRecord).nullable = true;
    const nullable = renderBlueprintReviewMarkdown(bp, 'sha256:dto'); assert(nullable.includes('| account | 是 | input.yaml#account |'), nullable);
    dto.fields[0].semantics = '真正不同的请求含义';
    const different = renderBlueprintReviewMarkdown(bp, 'sha256:dto'); assert(different.includes('真正不同的请求含义')); assert(different.includes('| account | string | 是 |'));
    const duplicate = structuredClone(model); duplicate.module = 'other'; duplicate.file = 'src/other/WalletCardRecord.ets';
    (asRecord(target(bp, 'ledger-module').contracts)!.data_models as unknown[]).push(duplicate);
    dto.fields[0].semantics = model.fields[0].description;
    const ambiguous = renderBlueprintReviewMarkdown(bp, 'sha256:dto'); assert(ambiguous.split(model.fields[0].description).length - 1 >= 3, '同名多个不同来源模型不能擅自选择一个');
  } },
  { name: 'UI, recovery and exact focus deduplicate only their owning content while repeated fields and file scopes remain traceable', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const uc = asRecords(asRecord(flow.use_cases)!.use_cases)[0];
    uc.ui_bindings = [{ ui: 'SharedPage', role: 'entry', subscribes: [], user_actions: [{ trigger: '唯一主责动作', calls: 'SharedPage.submit' }] }];
    const reportFlow = target(bp, 'ledger-report-flow');
    const reportUseCase = asRecords(asRecord(reportFlow.use_cases)!.use_cases)[0];
    reportUseCase.ui_bindings = [{ ui: 'SharedPage', role: 'result', subscribes: ['reported'], user_actions: [{ trigger: '不同来源动作', calls: 'SharedPage.done' }] }];
    flow.failure_recovery = { recovery_id: 'shared-recovery', handling: '唯一恢复说明', retry: '唯一重试说明' };
    asRecords(asRecord(flow.contracts)!.state_management)[0].failure_recovery = structuredClone(flow.failure_recovery);
    const ac = asRecords(asRecord(target(bp, 'ledger-module').acceptance)!.criteria)[0]; ac.ut_focus = ac.expected_result; ac.device_focus = String(ac.expected_result) + '（真机补充）';
    const decision = asRecords(asRecord(bp.decisions_and_gaps)!.decisions)[0]; decision.alternatives = [{ option: '方案甲', rejected_reason: '完全相同代价', defect: '完全相同代价' }, { option: '方案乙', rejected_reason: '另一相同代价', defect: '另一相同代价' }];
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:dedup');
    assert.equal(text.split('唯一主责动作').length - 1, 1); assert.equal(text.split('不同来源动作').length - 1, 1); assert(!text.includes('UI 边界：SharedPage')); assert(text.includes('界面职责、动作、调用与订阅见'));
    assert.equal(text.split('唯一恢复说明').length - 1, 1); assert(text.includes('失败与恢复见')); assert(text.includes('（真机补充）')); assert(!text.includes(`UT：${ac.expected_result}`));
    assert(text.includes('| 方案 | 被否理由/代价 |')); assert.equal(text.split('完全相同代价').length - 1, 1);
    assert(!text.includes('目标写集：')); assert(text.includes('| 文件 | 声明目标 |')); assert(text.includes(blueprintReviewAnchor('writes:view:development/node:ledger-module')));
    assert(text.includes('内容承载于：')); assert(!text.includes('设计内容来源：'));
    asRecords(decision.alternatives)[1].defect = '确实不同代价';
    asRecords(asRecord(flow.contracts)!.state_management)[0].failure_recovery = { handling: '不同恢复处理', retry: '不同恢复重试' };
    const different = renderBlueprintReviewMarkdown(bp, 'sha256:dedup'); assert(different.includes('| 方案 | 被否理由 | 缺陷/代价 |')); assert(different.includes('不同恢复处理')); assert(different.includes('| 处理 |'));
  } },
  { name: 'saved current sequence content displays beside its flow without relation refs or invented calls and stale graphs only request rebuild', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const graph = { graph_id: 'ledger-sequence', format: 'mermaid', source_view_id: 'runtime', content: 'sequenceDiagram\nparticipant Page as 页面\nparticipant Repo as 存储\nPage->>Repo: 保存记录\nRepo-->>Page: 已确认\n', node_refs: ['view:runtime/flow:ledger-refresh-flow', 'contract:create-entry-v1'], relation_refs: [] };
    bp.generated_graphs = [graph]; bp.derived_results = [{ result_id: graph.graph_id, input_revision: bp.revision, source_fingerprint: bp.source_fingerprint, decision_fingerprint: bp.decision_fingerprint, status: 'current' }];
    const current = renderBlueprintReviewMarkdown(bp, 'sha256:sequence'); assert(current.includes(graph.content.trimEnd())); assert(current.indexOf(graph.content.trimEnd()) > current.indexOf(`### ${flow.name}`)); assert(current.indexOf(graph.content.trimEnd()) < current.indexOf('### 施工状态与有序步骤'));
    graph.content = 'sequenceDiagram\nparticipant Page\nPage->>Missing: 保存记录';
    const bad = renderBlueprintReviewMarkdown(bp, 'sha256:sequence'); assert(bad.includes('无效，未展示（非阻断）')); assert(!bad.includes('Page->>Missing')); assert(bad.includes('repository.commit'));
    graph.content = 'sequenceDiagram\nparticipant Page\nparticipant Repo\nPage->>Repo: 保存记录';
    asRecords(bp.derived_results)[0].status = 'stale';
    const stale = renderBlueprintReviewMarkdown(bp, 'sha256:sequence'); assert(stale.includes('已过期')); assert(!stale.includes(graph.content));
    bp.derived_results = [];
    const absent = renderBlueprintReviewMarkdown(bp, 'sha256:sequence'); assert(absent.includes('未记录对应派生结果')); assert(!absent.includes(graph.content));
    bp.generated_graphs = [];
    const notInvented = renderBlueprintReviewMarkdown(bp, 'sha256:sequence'); assert(!notInvented.includes('sequenceDiagram')); assert(notInvented.includes('repository.commit'));
  } },
  { name: 'module graphs trace each typed source without merging conflicts and explanatory compression preserves distinct source and identity columns', run(f) {
    const bp = blueprint(f); const contracts = asRecord(target(bp, 'ledger-module').contracts)!;
    contracts.module_dependencies = { ledger: ['account', 'storage'] };
    const report = asRecord(target(bp, 'ledger-report-module').contracts)!; report.module_dependencies = { ledger: ['report-storage'] };
    const logical = asRecords(bp.design_views).find(v => v.view_id === 'logical')!;
    const names = ['first', 'second', 'third'];
    logical.nodes = names.map(node_id => ({ node_id, label: node_id, current_state: `当前${node_id}`, target_state: `目标${node_id}`, design_basis_refs: ['contracts/shared.yaml'], owner: 'shared' }));
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:module');
    for (const fact of ['account', 'storage', 'report-storage', '全表共同依据：contracts/shared.yaml', 'view:development/node:ledger-module.contracts.module_dependencies.ledger[0]', 'view:development/node:ledger-report-module.contracts.module_dependencies.ledger[0]']) assert(text.includes(fact), fact);
    const graphs = [...text.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map(match => match[1]);
    assert(graphs.some(graph => graph.includes('account') && graph.includes('storage') && !graph.includes('report-storage')));
    assert(graphs.some(graph => graph.includes('report-storage') && !graph.includes('account')));
    for (const name of names) assert(text.includes(`| ${name} |`)); assert(text.includes('当前first') && text.includes('目标third'), '身份及不同当前/目标不能提到共同说明');
    asRecords(logical.nodes)[1].design_basis_refs = ['contracts/different.yaml'];
    const distinct = renderBlueprintReviewMarkdown(bp, 'sha256:module'); assert(distinct.includes('| 依据 |') || distinct.includes('目标 | 依据 |')); assert(!distinct.includes('全表共同依据：contracts/shared.yaml'));
  } },
  { name: 'known payload values use a dedicated table, unknown shapes and conflicting aliases are disclosed', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    asRecords(flow.publications)[0].payload = { balance: '已提交金额', stage: ['committed', 'published'], nested: { unknown: { value: 1 } }, provenance: { source_ref: 'internal-provider-marker' } };
    Object.assign(asRecord(flow.failure_recovery)!, { handling: { unknown: true }, retry: '用户重新提交' });
    const cases = asRecord(flow.use_cases)!; const branch = asRecords(asRecords(cases.use_cases)[0].branches)[0];
    branch.expected_boundary_calls = [...asStrings(branch.expected_port_calls)];
    assert.deepStrictEqual(normalizeUseCasePortCalls(cases).issues, []);
    assert(!JSON.stringify(normalizeUseCasePortCalls(cases).value).includes('expected_boundary_calls'));
    branch.expected_boundary_calls = ['other.call'];
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:content-test');
    assert(text.includes('| balance | 已提交金额 |')); assert(text.includes('| stage | committed；published |'));
    assert(text.includes('nested | unknown：已声明（结构未展开）')); assert(text.includes('失败处理 | unknown：true')); assert(!text.includes('internal-provider-marker'));
    assert(text.includes('用例调用声明无效')); assert(text.includes('use\\_cases[0].branches[0]') || text.includes('use\\_cases\\[0\\].branches\\[0\\]'));
    assert(text.includes('other.call')); assert(text.includes('repository.commit'));
  } },
  { name: 'explicit empty and null business expectations stay distinct from absent declarations and source-only metadata', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const branches = asRecords(asRecords(asRecord(flow.use_cases)!.use_cases)[0].branches);
    branches[0].expected_state = { otp: '', errorCode: '', selectedCard: null, enabled: false, count: 0, values: [null, '', false, 0] };
    branches[0].cloud_stubs = {}; branches[0].local_stubs = {};
    branches[1].expected_state = {};
    branches[1].cloud_stubs = {}; branches[1].local_stubs = {};
    asRecords(flow.publications)[0].payload = { empty: '', nil: null, values: [null, '', false, 0] };
    asRecords(bp.contracts)[0].errors = { source_ref: 'contracts/source-only.yaml' };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:explicit-values');
    for (const fact of ['otp：""', 'errorCode：""', 'selectedCard：null', 'enabled：false', 'count：0', 'values：null；""；false；0', '| empty | "" |', '| nil | null |', '| values | null；""；false；0 |', '| 预期状态 | 无 |']) assert(text.includes(fact), fact);
    const cases = text.slice(text.indexOf('### 用例、数据边界与分支'), text.indexOf('### 异常与恢复'));
    assert(!cases.includes('已声明（仅来源信息）')); assert(!cases.includes('selectedCard：未记录'));
    assert(text.includes('错误：已声明（仅来源信息）'), '只有实际来源元数据的结构仍与显式空对象区分');
  } },
  { name: 'host-derived acceptance links preserve empty split boundaries and adjacent links while whole empty cells remain explicit', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const hostFlow = asRecord(hostBlueprintReviewFields().flow)!;
    flow.use_cases = structuredClone(hostFlow.use_cases); flow.publications = structuredClone(hostFlow.publications);
    const link = `[AC-1](#${blueprintReviewAnchor('acceptance:view:logical/node:review-common/criteria:AC-1')})`;
    asRecords(flow.publications)[0].payload = { only: link, leading: `${link}后文`, trailing: `前文${link}`, adjacent: `${link}${link}`, empty: '' };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:link-boundaries');
    for (const row of [`| only | ${link} |`, `| leading | ${link}后文 |`, `| trailing | 前文${link} |`, `| adjacent | ${link}${link} |`, '| empty | "" |']) assert(text.includes(row), row);
    assert.equal((text.match(/""\[/g) ?? []).length, 0, '链接首端不能把 split 空片段变成显式空字符串');
    assert.equal((text.match(/\)""/g) ?? []).length, 0, '链接末端及相邻链接不能引入引号');
    assert(text.includes('cards.saveBankCard') && text.includes('[AC-2](#design-'), '实际宿主调用及验收链接仍可读');
  } },
  { name: 'generic decision conclusion and rationale are independent without inferred authority', run(f) {
    const bp = blueprint(f); const decision = { decision_id: 'generic-choice', conclusion: '使用本地持久化', rationale: '离线也需读取', status: 'decided_with_authority', owner: 'ledger-team' };
    (asRecord(bp.decisions_and_gaps)!.decisions as BlueprintRecord[]).push(decision);
    const present = renderBlueprintReviewMarkdown(bp, 'sha256:decision-test'); assert(present.includes('| 选了什么 | 使用本地持久化 |')); assert(present.includes('| 理由 | 离线也需读取 |'));
    delete (decision as BlueprintRecord).conclusion;
    const missing = renderBlueprintReviewMarkdown(bp, 'sha256:decision-test').split('### generic-choice')[1].split('## 8 ')[0];
    assert(missing.includes('| 选了什么 | — |')); assert(missing.includes('选了什么（结论）')); assert(missing.includes('| 理由 | 离线也需读取 |'));
  } },
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
      for (const contract of asRecords(bp.contracts)) contract.idempotency = { behavior: '只执行一次', source_ref: 'contracts/ledger-api.yaml#/idempotency', verification_refs: ['acceptance:AC-1'] };
    });
    f.cuFiles.forEach((file, i) => { const cu = YAML.parse(fs.readFileSync(file, 'utf8')); cu.target_predicates.forEach((p: BlueprintRecord, n: number) => { p.verification_refs = [i === 0 && n === 0 ? 'acceptance:AC-10' : 'acceptance:AC-1']; }); cu.verification_refs = ['acceptance:AC-1']; cu.safe_intermediate_state.recovery_refs = ['acceptance:AC-1']; fs.writeFileSync(file, YAML.stringify(cu)); });
    const text = render(f); const section = text.slice(text.indexOf('## 9 质量与验收'), text.indexOf('## 10 施工拆分'));
    const rows = section.split('\n').filter(row => row.startsWith('| AC-1 |')); assert.equal(rows.length, 2);
    assert(rows[0].includes('ledger-refresh/runtime-owner') && !rows[0].includes('ledger-refresh/refresh-behavior') && !rows[0].includes('ledger-report/'), rows[0]);
    assert(rows[1].includes('ledger-report/') && !rows[1].includes('ledger-refresh/'), rows[1]);
    for (const kind of ['AC', 'BD', 'NFR']) { assert(text.includes(`UT：${kind} 的单测关注`)); assert(text.includes(`device：${kind} 的真机关注`)); }
    const exception = text.slice(text.indexOf('### 异常与恢复'), text.indexOf('## 5 开发视图')); assert(exception.includes('[BD-2](#design-')); assert(!exception.includes('BD 的单测关注') && !exception.includes('BD 的真机关注'));
    assert(text.includes('先读取持久快照；随后建立重放订阅'));
    const ownAnchor = blueprintReviewAnchor('acceptance:view:development/node:ledger-module/criteria:AC-1');
    const reportAnchor = blueprintReviewAnchor('acceptance:view:development/node:ledger-report-module/criteria:AC-1');
    const refreshUnit = text.slice(text.indexOf('### ledger-refresh'), text.indexOf('### ledger-report'));
    const reportUnit = text.slice(text.indexOf('### ledger-report'), text.indexOf('## 11 风险'));
    assert(refreshUnit.includes(ownAnchor) && !refreshUnit.includes(reportAnchor), refreshUnit);
    assert(reportUnit.includes(reportAnchor) && !reportUnit.includes(ownAnchor), reportUnit);
    const ownContract = text.slice(text.indexOf('#### create-entry-v1'), text.indexOf('#### read-report-v1'));
    const reportContract = text.slice(text.indexOf('#### read-report-v1'), text.indexOf('## 4 运行时视图'));
    assert(ownContract.includes(ownAnchor) && !ownContract.includes(reportAnchor)); assert(reportContract.includes(reportAnchor) && !reportContract.includes(ownAnchor));
  } },
  { name: 'one rich fixture yields 4+1 detail, true shared/exclusive inheritance and read-only handoff', run(f) {
    const bp = blueprint(f); assert.deepStrictEqual(validateComponentBlueprint(bp, { projectRoot: f.root }).filter(i => i.severity === 'BLOCKER'), []);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); assert(ready.ready, JSON.stringify(ready.perUnit));
    for (const feature of [f.feature, f.reportFeature]) for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml', 'spec.md', 'plan.md']) assert(!fs.existsSync(featureFilePath(f.root, feature, name)), name);
    const text = render(f);
    const statements = ['未声明可展示的同视图结构边；以上对象表保留，不从名称、目录或字段类型猜连线。', '未声明上游依赖；不从目录、purpose 或数组顺序推断施工顺序。', '未声明的索引、事务、存储配置不由 renderer 推断。'];
    const bodyMechanismStatements = (document: string) => document.slice(document.indexOf('## 1 概述'), document.indexOf('## 附录')).split('\n').filter(line => statements.some(statement => line.includes(statement)));
    assert.equal(bodyMechanismStatements(text).length, 0, '重复机制说明只能集中在阅读说明');
    const before = ['## 1 概述', ...Array(3).fill(statements[0]), statements[1], statements[2], '## 附录'].join('\n');
    assert.equal(bodyMechanismStatements(before).length, 5, '统计必须能发现修复前五句声明');
    for (const needle of ['## 2 场景视图（+1）', '## 3 逻辑视图', '## 4 运行时视图', '## 5 开发视图', '## 6 部署视图', '整数分的十进制字符串', 'LedgerStage', '验证步骤（按序）', '被否理由', '账号隔离', '本地首次读取时间', '是否通过设计交接见 readiness', 'report-ready', 'repository.commit', 'LedgerPage']) assert(text.includes(needle), needle);
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
    materializeBlueprintSkillInputs(f.root, f.feature, frameworkRoot);
    const acceptance = YAML.parse(fs.readFileSync(featureFilePath(f.root, f.feature, 'acceptance.yaml'), 'utf8')) as AcceptanceSpec & BlueprintRecord;
    assert.equal(acceptance.source, (projected.value as AcceptanceSpec).source);
    const ac = acceptance.criteria.find(c => c.id === 'AC-2')! as unknown as BlueprintRecord; assert.equal(ac.linked_flow, undefined);
    const uiPath = featureFilePath(f.root, f.feature, 'ui-spec.yaml'); fs.writeFileSync(uiPath, YAML.stringify({ schema_version: '1.0', screens: [{ id: 'ledger-entry', elements: [{ id: 'submit-entry', type: 'button' }] }, { id: 'ledger-current', elements: [{ id: 'current-balance', type: 'text' }] }] }));
    const ui = YAML.parse(fs.readFileSync(uiPath, 'utf8'));
    fs.writeFileSync(path.join(f.root, 'ui-request.md'), '提交成功后账页显示新余额，重启后保持一致');
    Object.assign(ac, { linked_flow: 'ledger-submit', requirement_ref: { source_path: 'ui-request.md', snippet: '提交成功后账页显示新余额' }, checkpoint: { pre_screen: ui.screens[0].id, action: { type: 'touch', target_element_id: ui.screens[0].elements[0].id }, post_screen: ui.screens[1].id, required_element_ids: [ui.screens[1].elements[0].id] } });
    acceptance.flows = { 'ledger-submit': { screens: ui.screens.map((s: BlueprintRecord) => s.id) } };
    fs.writeFileSync(featureFilePath(f.root, f.feature, 'acceptance.yaml'), YAML.stringify(acceptance));
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature);
    const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'spec', phaseRule: {}, featureSpec: spec } as CheckContext;
    const alignment = checkAuthoritativeContentAligned(ctx, 'acceptance'); assert(alignment.length > 0 && alignment.every(c => c.status === 'PASS'));
    assert(evaluateAcceptanceFlowStructure(f.root, f.feature, spec.acceptance).every(c => c.status === 'PASS'));
    spec.acceptance!.criteria.find(c => c.id === 'AC-2')!.expected_result = '允许显示未提交金额';
    assert(checkAuthoritativeContentAligned(ctx, 'acceptance').some(c => c.status === 'FAIL'));
    update(f, bp => { asRecords(asRecord(target(bp, 'ledger-module').acceptance)!.criteria).find(c => c.id === 'AC-2')!.checkpoint = { pre_screen: 'premature-ui' }; });
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
  { name: 'default readiness checks canonical content while plan owns conflicting author use-cases', run(f) {
    const before = render(f); const source = loadBlueprintReviewSource(f.root, 'ledger-app-blueprint');
    fs.writeFileSync(featureFilePath(f.root, f.feature, 'use-cases.yaml'), YAML.stringify({ schema_version: '2', feature: f.feature, use_cases: [] }));
    assert.equal(render(f), before); assert.deepStrictEqual(blueprintReviewDifferences(before, loadBlueprintReviewSource(f.root, 'ledger-app-blueprint')), []);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); const unit = ready.perUnit.find(u => u.changeUnitId === 'ledger-refresh')!; assert(ready.ready && unit.verdict !== 'blocked', JSON.stringify(unit));
    const projected = deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'contracts');
    assert.equal(projected.state, 'resolved', projected.detail);
    const spec = new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature);
    const checks = checkAuthoritativeContentAligned({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', phaseRule: {}, featureSpec: { ...spec, contracts: projected.value } } as CheckContext, 'contracts');
    assert(checks.some(check => check.status === 'FAIL' && check.repair_owner !== 'external'), JSON.stringify(checks));
    fs.appendFileSync(path.join(f.root, 'requirements/ledger.md'), '\n外部原文追加但尚未修订蓝图\n');
    assert.equal(render(f), before); assert.deepStrictEqual(blueprintReviewDifferences(before, loadBlueprintReviewSource(f.root, 'ledger-app-blueprint')), []);
    assert.equal(deriveBlueprintSkillInput(f.root, f.feature, frameworkRoot, 'acceptance').state, 'invalid');
    assert(source.inputs.units.every(u => u.binding === 'bound'));
  } },
  { name: 'shared object conflicts use actual authority_content_conflict; misplaced rows remain inherited', run(f) {
    update(f, bp => { const shared = target(bp, 'review-common'); asRecord(shared.contracts)!.module_dependencies = { ledger: ['different-dependency'] };
      (asRecord(shared.acceptance)!.criteria as BlueprintRecord[]).push(structuredClone(asRecords(asRecord(target(bp, 'ledger-module').acceptance)!.criteria)[0]));
      (asRecord(shared.contracts)!.files as string[]).push('src/ledger/LedgerFeature.ets'); });
    const conflict = deriveBlueprintSkillInput(f.root, f.reportFeature, frameworkRoot, 'contracts'); assert(conflict.codes?.includes('authority_content_conflict'), conflict.detail);
    assert(/合并无效：authority.*content.*conflict/.test(render(f)));
    update(f, bp => { delete asRecord(target(bp, 'review-common').contracts)!.module_dependencies; });
    const unit = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-report').changeUnit); const selected = selectBlueprintSkillContent(blueprint(f), unit);
    assert(asRecords(selected.acceptance?.criteria).some(c => c.id === 'AC-2')); assert((selected.contracts?.files as string[]).includes('src/ledger/LedgerFeature.ets'));
    assert.equal(selected.contracts?.change_unit, undefined);
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
    assert(!/\]\(#design-616363657074616e6365/.test(unitSection), 'pending CU 不解析旧指针建立验收链接');
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
  { name: 'materialized invalid projection preserves stage bytes while valid canonical identities advance; readiness returns to component-design', run(f) {
    for (const feature of [f.feature, f.reportFeature]) materializeBlueprintSkillInputs(f.root, feature, frameworkRoot);
    const files = [f.feature, f.reportFeature].flatMap(feature => ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'].map(name => featureFilePath(f.root, feature, name))); const before = files.map(file => fs.readFileSync(file));
    const revisions = f.cuFiles.map(file => Number(YAML.parse(fs.readFileSync(file, 'utf8')).revision));
    update(f, bp => { bp.revision = Number(bp.revision) + 1; for (const r of asRecords(bp.derived_results)) r.input_revision = bp.revision; target(bp, 'ledger-refresh-flow').use_cases = 'bad use case'; }, false);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint');
    assert.equal(ready.blueprintRefs.bumped.length, 2, JSON.stringify(ready.blueprintRefs));
    assert.deepStrictEqual(ready.blueprintRefs.skipped, []); assert(!ready.blueprintRefs.busy);
    f.cuFiles.forEach((file, i) => {
      const cu = YAML.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(cu.revision, revisions[i] + 1);
      assert.deepStrictEqual(validateChangeUnit(cu, { projectRoot: f.root, canonicalPath: file }), []);
    });
    files.forEach((file, i) => assert(fs.readFileSync(file).equals(before[i]), file));
    const unit = ready.perUnit.find(u => u.changeUnitId === 'ledger-refresh')!;
    assert(!ready.ready && unit.verdict === 'blocked' && unit.issueIds.includes('authority_content_not_machine_structure'), JSON.stringify(ready));
    assert.equal(ready.nextEntry, 'component-design'); assert.equal(ready.entersConstruction, false);
    const ctx = { projectRoot: f.root, frameworkRoot, feature: f.feature, phase: 'plan', phaseRule: {},
      featureSpec: new SpecLoader(f.root, undefined, undefined, frameworkRoot).loadFeatureSpec(f.feature) } as CheckContext;
    const gate = checkAuthoritativeContentAligned(ctx, 'contracts');
    assert(gate.some(check => check.status === 'FAIL' && check.repair_owner === 'external' && check.details.includes('authority_projection_invalid')), JSON.stringify(gate));
  } },
  { name: 'real closure owns external consumed interface and relation on our side; local report has a deployment landing', run(f) {
    const bp = blueprint(f); assert.deepStrictEqual(validateCrossViewRelations(bp), []);
    const external = target(bp, 'ledger-service'); assert.equal(external.current_state, external.target_state); assert.equal(external.delta, undefined);
    assert.deepStrictEqual(target(bp, 'report-scenario').deployment_refs, ['view:deployment/node:local-report']);
    for (const [feature, unitId] of [[f.feature, 'ledger-refresh'], [f.reportFeature, 'ledger-report']]) {
      materializeBlueprintSkillInputs(f.root, feature, frameworkRoot);
      const loaded = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', unitId); const cu = asChangeUnitArtifact(loaded.changeUnit);
      const file = featureFilePath(f.root, feature, 'contracts.yaml'); const contracts = YAML.parse(fs.readFileSync(file, 'utf8'));
      const implementation = 'planned:' + contracts.files.find((name: string) => name.startsWith('src/') && !name.endsWith('LedgerShared.ets'));
      const test = 'planned:' + contracts.files.find((name: string) => name.startsWith('test/'));
      // plan owns this Feature mapping; materialized design alone is not construction delivery.
      contracts.change_unit = { change_unit_ref: createChangeUnitRef(loaded),
        predicate_mappings: cu.target_predicates.map(p => ({ predicate_id: p.predicate_id, implementation_refs: [implementation], test_refs: [test] })),
        provide_mappings: cu.provides.map(p => ({ provide_id: p.provide_id, implementation_refs: [implementation], test_refs: [test] })),
        design_ref_mappings: cu.design_refs.map(ref => ({ design_ref: ref, implementation_refs: [implementation], verification_refs: [test] })) };
      fs.writeFileSync(file, YAML.stringify(contracts));
    }
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
    update(f, actual => { asRecords(actual.generated_graphs)[0].content = 'sequenceDiagram\nparticipant invalid\ninvalid->>missing: 未声明端点'; });
    const text = render(f); assert(text.includes('无效，未展示（非阻断）')); assert(!text.includes('participant invalid'));
  } },
];
export async function runAll() {
  const results = cases.map(c => { const f = createBlueprintReviewDesignFixture(); try { c.run(f); return { name: c.name, ok: true }; } catch (error) { return { name: c.name, ok: false, error: (error as Error).stack }; } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
  const old = await loadMigratedHostSnapshot([SNAPSHOT_CU_FEATURE]);
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
