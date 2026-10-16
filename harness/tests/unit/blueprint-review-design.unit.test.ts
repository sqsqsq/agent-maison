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
import { computeBlueprintReaderGuideSourceDigest } from '../../scripts/utils/blueprint-reader-guide';
import { loadBlueprintReviewSource, blueprintReviewDifferences, materializeBlueprintReview } from '../../scripts/utils/blueprint-review-materialization';
import { deriveBlueprintSkillInput, materializeBlueprintSkillInputs, selectBlueprintSkillContent, checkAuthoritativeContentAligned } from '../../scripts/utils/blueprint-skill-projection';
import { deriveDesignPreparationReadiness, evaluateDesignPreparationEntry } from '../../scripts/utils/change-unit-design-preparation';
import { checkCanonicalComponentBlueprint } from '../../scripts/check-component-blueprint';
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
import { matchesUnitCase, selectedUnitCases, startCaseTiming, SelectedUnitCases, UnitExecutionTiming } from '../utils/unit-case-selection';

const frameworkRoot = path.resolve(__dirname, '../../..');
type Fixture = ReturnType<typeof createBlueprintReviewDesignFixture>;
function blueprint(f: Fixture): BlueprintRecord { return loadCanonicalBlueprint(f.root, 'ledger-app-blueprint').blueprint; }
function target(bp: BlueprintRecord, id: string): BlueprintRecord { return asRecords(bp.design_views).flatMap(v => [...asRecords(v.nodes), ...asRecords(v.runtime_data_flows)]).find(n => n.node_id === id || n.flow_id === id)!; }
function update(f: Fixture, mutate: (bp: BlueprintRecord) => void, bind = true): void { const bp = blueprint(f); mutate(bp); fs.writeFileSync(f.blueprintFile, YAML.stringify(bp)); if (bind) f.bind(); }
function render(f: Fixture): string { return loadBlueprintReviewSource(f.root, 'ledger-app-blueprint').markdown; }
const cases: Array<{ name: string; run(f: Fixture): void }> = [
  { name: 'component selection uses existing target names and honest custom references with readable alternatives', run(f) {
    const bp = blueprint(f); const named = target(bp, 'ledger-module'); named.label = '账目刷新组件'; named.name = '原有英文名';
    const nameOnly = target(bp, 'ledger-report-module'); delete nameOnly.label; nameOnly.name = '账页报表组件';
    const decisions: BlueprintRecord[] = [
      { decision_id: 'evolve-choice', kind: 'component_asset_selection', name: '原决策名', target_ref: 'view:development/node:ledger-module', asset_resolution: 'evolve', component_ref: 'component:ledger', alternatives: [{ option: '方案甲', rejected_reason: '不支持账号边界。', defect: '缓存会跨账号共享。' }, { option: '方案乙', rejected_reason: '重复内容。', defect: '重复内容。' }] },
      ...['reuse', 'configure', 'adapt'].map(asset_resolution => ({ decision_id: `${asset_resolution}-choice`, kind: 'component_asset_selection', target_ref: 'view:development/node:ledger-module', asset_resolution, component_ref: 'component:ledger' })),
      ...[undefined, null, ''].map((component_ref, i) => ({ decision_id: `custom-empty-${i}`, kind: 'component_asset_selection', target_ref: 'view:development/node:ledger-report-module', asset_resolution: 'custom', component_ref })),
      { decision_id: 'custom-with-ref', kind: 'component_asset_selection', label: '明确指定的决策名', target_ref: 'view:development/node:ledger-module', asset_resolution: 'custom', component_ref: 'component:new-ledger' },
      { decision_id: 'missing-target', kind: 'component_asset_selection', target_ref: 'view:development/node:missing', asset_resolution: 'future-kind' },
      { decision_id: 'missing-target-named', kind: 'component_asset_selection', name: '已有回退名称', target_ref: 'view:development/node:missing', asset_resolution: 'future-kind' },
    ];
    asRecord(bp.decisions_and_gaps)!.decisions = decisions;
    const before = JSON.stringify(bp); const document = renderBlueprintReviewMarkdown(bp, 'sha256:selection');
    const body = document.slice(document.indexOf('## 8 关键取舍'), document.indexOf('## 9 失败与恢复'));
    const reference = document.slice(document.indexOf('## 技术与追溯参考'));
    assert(body.includes('### 账目刷新组件') && !body.includes('### 原决策名') && !body.includes('### 原有英文名'));
    assert.equal(body.split('### 账页报表组件').length - 1, 3); assert(body.includes('### 明确指定的决策名'));
    assert(body.includes('### missing-target\n') && body.includes('### 已有回退名称'));
    for (const label of ['直接复用已有组件', '用已有参数表达需求', '在使用方编写局部包装或组合', '兼容演进共享定义']) assert.equal(body.split(`选型结果：${label}；选型目标：`).length - 1, 1, label);
    assert(body.includes('；组件：component:ledger'));
    assert.equal(body.split('选型结果：自定义实现').length - 1, 4); assert(body.includes('组件：component:new-ledger'));
    assert(!body.includes('选型结果：本次新建') && !body.includes('选型结果：沿用并改造'));
    const custom = body.slice(body.indexOf(blueprintReviewAnchor('decision:custom-empty-0')), body.indexOf(blueprintReviewAnchor('decision:missing-target')));
    assert(!custom.includes('组件：未记录') && !custom.includes('组件：null') && !custom.includes('组件：""'));
    assert(body.includes('选型结果：future-kind'), '未知值按原值披露，不猜译');
    assert(body.includes('| 方案甲 | 不支持账号边界。<br>缓存会跨账号共享。|'));
    assert(!body.includes('。；') && !body.includes('被否理由：') && !body.includes('缺陷：'));
    assert.equal(body.split('重复内容。').length - 1, 1); assert.equal(body.split('未记录；不推测被否选择。').length - 1, 9);
    for (const decision of decisions) {
      const id = blueprintReviewAnchor(`decision:${decision.decision_id}`);
      assert(body.includes(`<a id="${id}"></a>`)); assert(reference.includes(`](#${id})`)); assert(!reference.includes(`<a id="${id}"></a>`));
    }
    const ids = [...document.matchAll(/<a\s+id="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
    assert(!reference.includes('不支持账号边界') && !reference.includes('缓存会跨账号共享')); assert.equal(JSON.stringify(bp), before);
  } },
  { name: 'canonical decisions always follow authored introductions with unique body anchors and metadata-only reference', run(f) {
    for (const state of ['missing', 'current', 'stale']) {
      const bp = blueprint(f); const review = asRecord(bp.review_summary)!;
      const decisions = [
        { decision_id: 'direct-choice', name: '直接选择', conclusion: '采用持久快照', rationale: '选择理由唯一', alternatives: [{ option: '放弃轮询', rejected_reason: '轮询缺陷唯一', defect: '轮询缺陷唯一' }, { option: '放弃共享数组', rejected_reason: '共享数组理由唯一', defect: '共享数组缺陷唯一' }, { option: '只有缺陷', defect: '没有拒绝理由的缺陷' }] },
        { decision_id: 'asset-choice', kind: 'component_asset_selection', asset_resolution: 'reuse', target_ref: 'asset-target', component_ref: 'existing-component', rationale: '复用依据唯一' },
        { decision_id: 'architecture-choice', kind: 'architecture_impact', change: 'move_module', module: 'ledger', from_layer: 'old-layer', to_layer: 'new-layer', rationale: '移动依据唯一' },
        { decision_id: 'evolution-choice', kind: 'evolution_candidate', human_decision: 'keep_direct', stable_contract: 'StablePort', provider: 'LocalProvider', consumer: 'LocalConsumer', binding_time: 'startup', failure_semantics: 'preserve', impact: 'bounded', reextract_condition: 'second-host', rationale: '演进依据唯一' },
        { decision_id: 'risk-choice', kind: 'residual_risk', resolution: '保留已知风险', rationale: '风险依据唯一' },
        { decision_id: 'missing-choice', label: '未记录选择', rationale: '缺失不冒充理由' },
      ];
      asRecord(bp.decisions_and_gaps)!.decisions = decisions;
      if (state === 'missing') delete review.reader_guide;
      else review.reader_guide = { source_digest: state === 'stale' ? 'sha256:old' : computeBlueprintReaderGuideSourceDigest(bp), sections: [
        { section: 'decisions', title: '决策开场', prose: '开场不能替代每项取舍。', source_refs: ['/decisions_and_gaps/decisions/0'] },
        { section: 'decisions', title: '跨项解释', prose: '另一段开场仍按原顺序保留。', source_refs: ['/decisions_and_gaps/decisions/1'] },
      ] };
      const before = JSON.stringify(bp); const document = renderBlueprintReviewMarkdown(bp, 'sha256:decisions');
      const body = document.slice(document.indexOf('## 8 关键取舍'), document.indexOf('## 9 失败与恢复'));
      const reference = document.slice(document.indexOf('## 技术与追溯参考'));
      for (const literal of ['选择理由唯一', '轮询缺陷唯一', '共享数组理由唯一', '共享数组缺陷唯一', '没有拒绝理由的缺陷', '复用依据唯一', '移动依据唯一', '演进依据唯一', '风险依据唯一']) {
        assert.equal(body.split(literal).length - 1, 1, `${state}: ${literal}`); assert(!reference.includes(literal), literal);
      }
      for (const literal of ['采用持久快照', '直接复用已有组件', 'asset-target', 'existing-component', 'move', 'old-layer → new-layer', 'keep', 'StablePort', 'LocalProvider', 'LocalConsumer', '保留已知风险']) assert(body.includes(literal), `${state}: ${literal}`);
      assert(body.includes('| 选了什么 | — |') && body.includes('选了什么（结论）'));
      assert.equal(body.split('未记录；不推测被否选择。').length - 1, 5);
      assert(!body.includes('所选代价') && !body.includes('缺陷/代价'));
      for (const decision of decisions) {
        const id = blueprintReviewAnchor(`decision:${decision.decision_id}`);
        assert(body.includes(`<a id="${id}"></a>`)); assert(reference.includes(`](#${id})`)); assert(!reference.includes(`<a id="${id}"></a>`));
      }
      if (state === 'current') assert(body.indexOf('开场不能替代') < body.indexOf('另一段开场') && body.indexOf('另一段开场') < body.indexOf('### 直接选择'));
      else assert(!body.includes('开场不能替代'));
      const ids = [...document.matchAll(/<a\s+id="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length, `${state}: 全文显式锚点必须唯一`);
      assert.equal(JSON.stringify(bp), before);
    }
  } },
  { name: 'canonical assumed terms and real gap statuses remain visible with missing current or stale questions guide', run(f) {
    for (const state of ['missing', 'current', 'stale']) {
      const bp = blueprint(f); const review = asRecord(bp.review_summary)!; delete review.must_review;
      asRecord(bp.discovery)!.facts = [
        { subject: 'term:卡类型', value: { meaning: '假定卡类型解释' }, provenance: { extraction_method: 'headless_assumed', source_ref: 'term-source-a' } },
        { subject: 'term:添加入口', value: { meaning: '假定添加入口解释' }, provenance: { extraction_method: 'headless_assumed', source_ref: 'term-source-b' } },
        { subject: 'term:已确认术语', value: { meaning: '已确认解释' }, provenance: { extraction_method: 'user_confirmed' } },
      ];
      asRecord(bp.decisions_and_gaps)!.gaps = [
        { gap_id: 'pending-gap', label: '等待契约', status: 'open_decision', owner: 'contract-owner', unlock_condition: '获准契约可访问' },
        { gap_id: 'resolved-gap', label: '已经解决的问题', status: 'resolved', owner: 'design-owner', unlock_condition: '已取得真实证据' },
        { gap_id: 'missing-status', label: '状态未登记的问题', unlock_condition: '补充状态依据' },
      ];
      if (state === 'missing') delete review.reader_guide;
      else review.reader_guide = { source_digest: state === 'stale' ? 'sha256:old' : computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'questions', title: '结论开场', prose: '业务语义均已裁决。', source_refs: ['/decisions_and_gaps'] }] };
      const before = JSON.stringify(bp); const document = renderBlueprintReviewMarkdown(bp, 'sha256:questions'); const body = document.slice(document.indexOf('## 13 待补问题'), document.indexOf('## 技术与追溯参考'));
      for (const literal of ['卡类型', '假定卡类型解释', '添加入口', '假定添加入口解释', '作者自行假定，待确认', '等待契约', '待决', 'contract-owner', '获准契约可访问', '已经解决的问题', '已解决', 'design-owner', '已取得真实证据', '状态未登记的问题', '未记录状态']) assert(body.includes(literal), `${state}: ${literal}`);
      assert.equal(body.split('作者自行假定，待确认').length - 1, 2); assert(!body.includes('已确认术语')); assert(!body.includes('必须关注的评审问题'));
      for (const gapId of ['pending-gap', 'resolved-gap', 'missing-status']) assert(document.includes(`<a id="${blueprintReviewAnchor(`gap:${gapId}`)}"></a>`));
      assert.equal(JSON.stringify(bp), before);
    }
  } },
  { name: 'questions preserve must review once and stop assuming confirmed terms without inventing empty gaps', run(f) {
    const bp = blueprint(f); const review = asRecord(bp.review_summary)!;
    asRecord(bp.discovery)!.facts = [{ subject: 'term:现在已确认', value: { meaning: '已确认的解释' }, provenance: { extraction_method: 'user_confirmed' } }];
    asRecord(bp.decisions_and_gaps)!.gaps = []; review.must_review = ['必须确认需求偏离', '必须确认恢复边界'];
    review.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'questions', title: '评审开场', prose: '请确认本次边界。', source_refs: ['/review_summary/must_review'] }] };
    let document = renderBlueprintReviewMarkdown(bp, 'sha256:confirmed'); const referenceStart = document.indexOf('## 技术与追溯参考'); const body = document.slice(document.indexOf('## 13 待补问题'), referenceStart);
    for (const question of review.must_review as string[]) { assert.equal(document.split(question).length - 1, 1); assert(body.includes(question)); }
    assert(!body.includes('作者自行假定') && !body.includes('缺口及当前状态'));
    assert(document.slice(referenceStart).includes('见正文[必须关注的评审问题](#questions)') && document.includes('已确认的解释'));
    delete review.must_review; delete review.reader_guide; document = renderBlueprintReviewMarkdown(bp, 'sha256:empty');
    assert(!document.includes('## 13 待补问题'));
  } },
  { name: 'restart repeated graph references link to the first drawing or its invalid and stale explanation', run(f) {
    for (const state of ['current', 'invalid', 'stale']) {
      const bp = blueprint(f);
      const graph = { graph_id: 'restart-submit', label: '提交与确认时序', format: 'mermaid', source_view_id: 'runtime',
        content: 'sequenceDiagram\nparticipant Page\nparticipant Repo\nPage->>Repo: 保存记录', node_refs: ['view:runtime/flow:ledger-refresh-flow'], relation_refs: [] };
      if (state === 'invalid') graph.content = 'sequenceDiagram\nparticipant Page\nPage->>Missing: 保存记录';
      bp.generated_graphs = [graph]; bp.derived_results = [{ result_id: graph.graph_id, input_revision: state === 'stale' ? -1 : bp.revision, source_fingerprint: bp.source_fingerprint, decision_fingerprint: bp.decision_fingerprint, status: 'current' }];
      asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: ['journey', 'flows', 'recovery'].map(section => ({ section, title: `${section}说明`, prose: '提交后等待确认。', source_refs: ['/design_views'], graph_ids: [graph.graph_id, 'unknown-graph'] })) };
      const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:restart-graph');
      const id = blueprintReviewAnchor(`graph:${graph.graph_id}`); const first = text.indexOf(`<a id="${id}"></a>`);
      assert.equal(text.split(`<a id="${id}"></a>`).length - 1, 1);
      for (const [start, end] of [['## 6 关键流程', '## 7 数据与存储'], ['## 9 失败与恢复', '## 10 质量与安全']]) {
        const section = text.slice(text.indexOf(start), text.indexOf(end)); assert(section.includes(`[提交与确认时序](#${id})`), state);
      }
      assert(first > text.indexOf('## 4 用户旅程与界面') && first < text.indexOf('## 5 整体方案'));
      assert.equal(text.split(graph.content).length - 1, state === 'current' ? 1 : 0);
      if (state !== 'current') assert(text.slice(first).includes(state === 'invalid' ? '无效，未展示' : '已过期'));
      assert(text.includes('说明引用的图不存在：unknown-graph')); assert.equal(JSON.stringify(bp), before);
    }
  } },
  { name: 'restart acceptance object and collection sources expand only their target and deduplicate overlapping entries', run(f) {
    const bp = blueprint(f); const views = asRecords(bp.design_views); const dev = views.find(view => view.view_id === 'development')!; const nodes = asRecords(dev.nodes);
    const own = target(bp, 'ledger-module'); const report = target(bp, 'ledger-report-module'); const original = asRecord(own.acceptance)!;
    const criterion = asRecords(original.criteria)[0];
    own.acceptance = { ...original, criteria: [{ ...criterion, id: 'AC-1' }, { ...criterion, id: 'AC-2' }], boundaries: [{ ...asRecords(original.boundaries)[0], id: 'BD-1' }], performance: [{ ...asRecords(original.performance)[0], id: 'NFR-1' }] };
    asRecords(asRecord(report.acceptance)!.criteria)[0].id = 'AC-1';
    const pointer = (node: BlueprintRecord) => `/design_views/${views.indexOf(dev)}/nodes/${nodes.indexOf(node)}/acceptance`;
    const rows = [
      { title: '整个目标', source_refs: [pointer(own), `${pointer(own)}/criteria/0`] },
      { title: '报表功能', source_refs: [`${pointer(report)}/criteria`] },
      { title: '仅边界', source_refs: [`${pointer(own)}/boundaries`] },
      { title: '仅质量', source_refs: [`${pointer(own)}/performance`] },
      { title: '同名跨目标', source_refs: [`${pointer(own)}/criteria`, `${pointer(own)}/criteria/0`, `${pointer(report)}/criteria`] },
    ];
    asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: rows.map(row => ({ section: 'acceptance', ...row, prose: 'AC-1 AC-2 BD-1 NFR-1 AC-999', graph_ids: [] })) };
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:restart-collections');
    const section = (title: string) => text.split(`### ${title}\n`)[1].split('### ')[0].split('## 技术与追溯参考')[0];
    const link = (owner: string, key: string, id: string) => `#${blueprintReviewAnchor(`acceptance:view:development/node:${owner}/${key}:${id}`)}`;
    for (const [key, id] of [['criteria', 'AC-1'], ['criteria', 'AC-2'], ['boundaries', 'BD-1'], ['performance', 'NFR-1']]) assert(section('整个目标').includes(link('ledger-module', key, id)));
    assert.equal(section('整个目标').split(link('ledger-module', 'criteria', 'AC-1')).length - 1, 1);
    assert(!section('整个目标').includes(link('ledger-report-module', 'criteria', 'AC-1'))); assert(!section('整个目标').includes('[AC-999]'));
    assert(section('报表功能').includes(link('ledger-report-module', 'criteria', 'AC-1')) && !section('报表功能').includes(link('ledger-module', 'criteria', 'AC-1')));
    assert(!section('仅边界').includes('[AC-1]') && section('仅边界').includes('[BD-1]') && !section('仅边界').includes('[NFR-1]'));
    assert(section('仅质量').includes('[NFR-1]') && !section('仅质量').includes('[BD-1]'));
    for (const owner of ['ledger-module', 'ledger-report-module']) assert.equal(section('同名跨目标').split(link(owner, 'criteria', 'AC-1')).length - 1, 1);
    assert.equal(JSON.stringify(bp), before);
    asRecord(own.acceptance)!.criteria = []; asRecord(own.acceptance)!.boundaries = 'invalid';
    asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'acceptance', title: '空和非法', prose: 'AC-1 BD-1', source_refs: [`${pointer(own)}/criteria`, `${pointer(own)}/boundaries`, `${pointer(own)}/missing`], graph_ids: [] }] };
    const invalid = renderBlueprintReviewMarkdown(bp, 'sha256:restart-empty');
    assert(invalid.includes('说明来源无法解析：')); assert(invalid.includes('boundaries 应为数组')); assert(invalid.includes('AC-1 BD-1')); assert(!invalid.includes('AC-1](#' + blueprintReviewAnchor('acceptance:view:development/node:ledger-module/criteria:AC-1')));
  } },
  { name: 'restart narrative spacing folds fullwidth punctuation before any text and preserves Markdown literals and line layout', run(f) {
    const bp = blueprint(f); const review = asRecord(bp.review_summary)!;
    review.background = '宿主背景。 next  保留普通空格\n续行， English  words。  \n    缩进。 keep\n\t制表缩进。 keep\n原字段 `inline； keep` 和 [链接。 keep](https://example.com/raw)\n```text\n原字段围栏。 keep\n```\n```npm test```\n单行代码之后。 next\n原字段地址： https://example.com/fallback';
    const prose = '中文。 继续； English： next， 123！ `code。 keep`、 [链接。 keep](https://example.com/a。keep)\nURL https://example.com/a。keep 与 `inline； keep`。  \n下一行。 next\n\n```text\n代码。 keep\n没有 会话边界\n```\n\n    缩进。 keep\n\t制表缩进。 keep\n说明地址： https://example.com/guide\n没有 会话边界，扩充  既有 设计；保留 API 调用与 3 个参数。  \n下一行\n`没有 会话边界` [扩充 既有](https://example.com/扩充%20既有) https://example.com/没有%20会话边界\n    没有 会话边界\n\t扩充 既有';
    review.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'solution', title: '空格样例', prose, source_refs: ['/design_views'] }] };
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:restart-spacing'); const body = text.slice(0, text.indexOf('## 技术与追溯参考'));
    for (const expected of ['宿主背景。next  保留普通空格\n续行，English  words。  \n    缩进。 keep\n\t制表缩进。 keep', '中文。继续；English：next，123！`code。 keep`、[链接。 keep](https://example.com/a。keep)', 'https://example.com/a。keep', '`inline； keep`。  \n下一行。next', '```text\n代码。 keep\n没有 会话边界\n```', '    缩进。 keep', '\t制表缩进。 keep', '没有会话边界，扩充既有设计；保留 API 调用与 3 个参数。  \n下一行', '`没有 会话边界` [扩充 既有](https://example.com/扩充%20既有) https://example.com/没有%20会话边界', '    没有 会话边界\n\t扩充 既有']) assert(body.includes(expected), expected);
    assert(body.includes('\\`inline； keep\\`') && body.includes('\\[链接。 keep\\](https://example.com/raw)')); assert(body.includes('原字段围栏。 keep'));
    assert(body.includes('\\`\\`\\`npm test\\`\\`\\`\n单行代码之后。next') && body.includes('## 5 整体方案'));
    assert(body.includes('原字段地址： https://example.com/fallback') && body.includes('说明地址： https://example.com/guide'));
    assert.equal(JSON.stringify(bp), before);
  } },
  { name: 'restart success measure arrays render separate entries without sentence and semicolon collisions', run(f) {
    const bp = blueprint(f); const review = asRecord(bp.review_summary)!; delete review.reader_guide;
    review.goals = [{ goal_id: 'restart-goal', statement: '确认结果。 next', success_measures: ['第一条。', '第二条。'] }];
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:restart-measures');
    assert(text.includes('- 第一条。\n- 第二条。')); assert(text.includes('第一条。<br>第二条。')); assert(!text.includes('第一条。；')); assert.equal(JSON.stringify(bp), before);
  } },
  { name: 'closeout author broken overview stays WARN through real admission and readiness at its guide placement', run(f) {
    const baseline = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); assert(baseline.ready, JSON.stringify(baseline));
    for (const relation_refs of [undefined, []]) for (const broken of ['syntax', 'reference']) {
      const graph = { graph_id: 'reader-overview', format: 'mermaid', source_view_id: 'logical',
        content: broken === 'syntax' ? 'flowchart TD\ntyped{}' : 'flowchart TD\ntyped["已声明对象"]',
        node_refs: [broken === 'syntax' ? 'view:runtime/flow:ledger-refresh-flow' : 'view:runtime/node:missing'],
        ...(relation_refs === undefined ? {} : { relation_refs }) };
      update(f, bp => {
        bp.generated_graphs = [graph];
        asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
          { section: 'solution', title: '整体方案', prose: '对象协作的作者说明。', source_refs: ['/design_views'], graph_ids: [graph.graph_id] },
        ] };
      });
      const admission = checkCanonicalComponentBlueprint(f.root, 'ledger-app-blueprint');
      const graphIssues = admission.issues.filter(issue => issue.id.startsWith('blueprint_generated_graph'));
      assert(graphIssues.length && graphIssues.every(issue => issue.severity === 'WARN'), JSON.stringify(graphIssues));
      assert(!admission.issues.some(issue => issue.severity === 'BLOCKER'), JSON.stringify(admission.issues));
      const entry = evaluateDesignPreparationEntry(f.root, 'ledger-app-blueprint'); assert(entry.canEnter && entry.blueprintAdmitted, JSON.stringify(entry));
      const readiness = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); assert(readiness.ready, JSON.stringify(readiness));
      assert.deepStrictEqual(readiness.perUnit.map(unit => [unit.changeUnitId, unit.verdict]), baseline.perUnit.map(unit => [unit.changeUnitId, unit.verdict]));
      const text = render(f); const solution = text.slice(text.indexOf('## 5 整体方案'), text.indexOf('## 6 关键流程'));
      assert(solution.includes('对象协作的作者说明。') && solution.includes('无效，未展示（非阻断）'));
      assert(solution.includes(broken === 'syntax' ? 'typed{}' : '生成图引用无法落地'));
      assert(!text.includes('```mermaid\n' + graph.content)); assert(text.includes('### C 完整验收') && text.includes('## 11 施工与上线'));
    }
  } },
  { name: 'closeout declared relation overview keeps real admission and readiness blocked for the same failures', run(f) {
    assert(deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint').ready);
    for (const broken of ['syntax', 'reference']) {
      update(f, bp => { bp.generated_graphs = [{ graph_id: 'reader-relation-overview', format: 'mermaid', source_view_id: 'logical',
        content: broken === 'syntax' ? 'flowchart TD\ntyped{}' : 'flowchart TD\ntyped["已声明对象"]',
        node_refs: ['view:runtime/flow:ledger-refresh-flow'],
        relation_refs: [broken === 'syntax' ? `relation:${asRecords(bp.relations)[0].relation_id}` : 'relation:missing'] }]; });
      const expected = broken === 'syntax' ? 'blueprint_generated_graph_parse_failed' : 'blueprint_generated_graph_ref_missing';
      const admission = checkCanonicalComponentBlueprint(f.root, 'ledger-app-blueprint');
      assert(admission.issues.some(issue => issue.id === expected && issue.severity === 'BLOCKER'), JSON.stringify(admission.issues));
      const entry = evaluateDesignPreparationEntry(f.root, 'ledger-app-blueprint'); assert(!entry.canEnter && !entry.blueprintAdmitted, JSON.stringify(entry));
      const readiness = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); assert(!readiness.ready, JSON.stringify(readiness));
    }
  } },
  { name: 'closeout author presentation overview cannot hide the same view canonical relation graph in reference', run(f) {
    for (const relation_refs of [undefined, []]) {
      const bp = blueprint(f); const automatic = generateMermaidViewGraph(bp, 'runtime');
      assert(automatic.relation_refs.length > 0); assert.equal(validateGeneratedBlueprintGraphs({ ...bp, generated_graphs: [automatic] }).length, 0);
      const graph = { graph_id: 'reader-runtime-overview', format: 'mermaid', source_view_id: 'runtime',
        content: 'flowchart LR\nrepo["持久账目"]\nstore["已提交快照"]\nrepo -->|发布快照| store',
        node_refs: ['view:runtime/node:ledger-repository', 'view:runtime/node:ledger-store'],
        ...(relation_refs === undefined ? {} : { relation_refs }) };
      bp.generated_graphs = [graph];
      asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
        { section: 'solution', title: '整体方案', prose: '持久账目向缓存发布已提交快照。', source_refs: ['/design_views'], graph_ids: [graph.graph_id] },
      ] };
      const text = renderBlueprintReviewMarkdown(bp, 'sha256:reader-runtime-overview'); const reference = text.slice(text.indexOf('## 技术与追溯参考'));
      const runtime = reference.slice(reference.indexOf('#### 运行时视图'), reference.indexOf('#### 开发视图'));
      assert(runtime.includes('```mermaid\n' + automatic.content.trimEnd())); assert(!runtime.includes('结构图无效'));
      assert.equal(text.split(graph.content).length - 1, 1); assert.equal(reference.split(automatic.content.trimEnd()).length - 1, 1);
    }
  } },
  { name: 'closeout author relation graph still replaces its automatic view graph without duplicate guide display', run(f) {
    for (const placed of [false, true]) {
      const bp = blueprint(f); const automatic = generateMermaidViewGraph(bp, 'runtime');
      const graph = { graph_id: 'reader-runtime-relations', format: 'mermaid', source_view_id: 'runtime',
        content: 'flowchart LR\nrepo["持久账目"]\nstore["已提交快照"]\nrepo -->|发布快照| store',
        node_refs: ['view:runtime/node:ledger-repository', 'view:runtime/node:ledger-store'], relation_refs: ['relation:repository-publishes-store'] };
      bp.generated_graphs = [graph]; assert.equal(validateGeneratedBlueprintGraphs(bp).length, 0);
      if (placed) asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
        { section: 'solution', title: '整体方案', prose: '持久账目向缓存发布已提交快照。', source_refs: ['/design_views'], graph_ids: [graph.graph_id] },
      ] };
      const text = renderBlueprintReviewMarkdown(bp, 'sha256:reader-runtime-relations'); const reference = text.slice(text.indexOf('## 技术与追溯参考'));
      const runtime = reference.slice(reference.indexOf('#### 运行时视图'), reference.indexOf('#### 开发视图'));
      assert(!runtime.includes(automatic.content.trimEnd())); assert.equal(runtime.includes(graph.content), !placed);
      assert.equal(text.split(graph.content).length - 1, 1);
    }
  } },
  { name: 'closeout summary links delivery while canonical CU purposes appear only in the construction chapter', run(f) {
    const text = render(f); const summary = text.slice(text.indexOf('## 1 方案摘要'), text.indexOf('## 2 背景、目标与边界'));
    assert(summary.includes('施工安排见[施工与上线](#delivery)。'));
    const delivery = text.slice(text.indexOf('## 11 施工与上线'), text.indexOf('## 12 验收'));
    for (const file of f.cuFiles) {
      const purpose = YAML.parse(fs.readFileSync(file, 'utf8')).purpose;
      assert(!summary.includes(purpose)); assert(delivery.includes(purpose));
    }
  } },
  { name: 'closeout existing prose recovery table and generated overview render directly with original boundary links', run(f) {
    const bp = blueprint(f); const development = asRecords(bp.design_views).findIndex(view => view.view_id === 'development');
    const nodes = asRecords(asRecords(bp.design_views)[development].nodes); const own = nodes.findIndex(node => node.node_id === 'ledger-module');
    const graph = { graph_id: 'reader-overview', format: 'mermaid', source_view_id: 'logical',
      content: 'flowchart LR\npage["账目页面"]\nrepo["持久账目"]\npage -->|提交账目| repo',
      node_refs: ['view:runtime/flow:ledger-refresh-flow'], relation_refs: [] };
    bp.generated_graphs = [graph];
    const boundaries = asRecords(asRecord(nodes[own].acceptance)!.boundaries);
    const table = ['| 场景 | 处理 | 原验收 |', '|---|---|---|', ...boundaries.map(boundary => `| ${boundary.scenario} | ${boundary.expected_behavior} | ${boundary.id} |`)].join('\n');
    asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
      { section: 'solution', title: '整体方案', prose: '提交账目由持久状态责任方处理。', source_refs: ['/design_views'], graph_ids: [graph.graph_id] },
      { section: 'recovery', title: '失败与恢复', prose: table, source_refs: boundaries.map((_, i) => `/design_views/${development}/nodes/${own}/acceptance/boundaries/${i}`) },
    ] };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:closeout-table'); const solution = text.slice(text.indexOf('## 5 整体方案'), text.indexOf('## 6 关键流程'));
    assert(solution.includes('```mermaid\n' + graph.content)); assert.equal(text.split(graph.content).length - 1, 1);
    const recovery = text.slice(text.indexOf('## 9 失败与恢复'), text.indexOf('## 10 质量与安全'));
    assert(recovery.includes('| 场景 | 处理 | 原验收 |\n|---|---|---|')); assert(!recovery.includes('undefined'));
    for (const boundary of boundaries) {
      const target = blueprintReviewAnchor(`acceptance:view:development/node:ledger-module/boundaries:${boundary.id}`);
      assert(recovery.includes(`[${boundary.id}](#${target})`)); assert(text.includes(`id="${target}"`));
    }
  } },
  { name: 'authored journey and solution keep adjacent registered pictures while file and class detail stays in reference', run(f) {
    const bp = blueprint(f); const inputs = collectBlueprintReviewInputs(f.root, loadCanonicalBlueprint(f.root, 'ledger-app-blueprint')); const review = asRecord(bp.review_summary)!;
    review.source_refs = ['requirements/first.png', 'requirements/second.png', 'requirements/unclaimed.png'];
    asRecords(asRecord(target(bp, 'ledger-module').contracts)!.components)[0].description = '唯一的精确组件职责';
    review.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
      { section: 'summary', title: '方案摘要', prose: '作者方案摘要。', source_refs: ['/review_summary'] },
      { section: 'journey', title: '第一个界面', prose: '第一界面的操作与反馈。', source_refs: ['/review_summary/source_refs/0', '/review_summary/source_refs/0'] },
      { section: 'journey', title: '第二个界面', prose: '第二界面的操作与反馈。', source_refs: ['/review_summary/source_refs/1'] },
      { section: 'solution', title: '角色如何协作', prose: '作者的角色协作说明。', source_refs: ['/design_views'] },
    ] };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:reader-dedup', inputs); const referenceStart = text.indexOf('## 技术与追溯参考'); const body = text.slice(0, referenceStart); const reference = text.slice(referenceStart);
    const journey = body.slice(body.indexOf('## 4 用户旅程与界面'), body.indexOf('## 5 整体方案'));
    assert(journey.indexOf('第一界面的操作与反馈。') < journey.indexOf('![first]')); assert(journey.indexOf('![first]') < journey.indexOf('### 第二个界面'));
    assert(journey.indexOf('第二界面的操作与反馈。') < journey.indexOf('![second]')); assert(journey.indexOf('![second]') < journey.indexOf('![unclaimed]'));
    for (const picture of ['first', 'second', 'unclaimed']) assert.equal((text.match(new RegExp(`^!\\[${picture}\\]`, 'gm')) ?? []).length, 1);
    assert(!body.includes('唯一的精确组件职责') && reference.includes('唯一的精确组件职责'));
    assert(!body.includes('职责或已声明方法') && !body.includes('已声明用途或关联')); assert(reference.includes('文件用途与已声明关联'));
    const delivery = body.slice(body.indexOf('## 11 施工与上线'), body.indexOf('## 12 验收')); const tree = /```text\n([\s\S]*?)\n```/.exec(delivery)![0];
    assert.equal((delivery.match(/```text/g) ?? []).length, 1); assert(!delivery.replace(tree, '').includes('LedgerFeature.ets'));
    assert(delivery.includes('责任方：') && delivery.includes('施工单元参考')); assert(reference.includes('写入范围'));
    for (const match of body.matchAll(/\[设计依据\]\(#([^)]*)\)/g)) assert(reference.includes(`id="${match[1]}"`));
    assert.equal((journey.match(/\[设计依据\]/g) ?? []).length, 2);
  } },
  { name: 'authored representative flow shows only selected graphs and scoped acceptance while full raw graph remains in reference', run(f) {
    const bp = blueprint(f); const runtime = asRecords(bp.design_views).findIndex(view => view.view_id === 'runtime'); const development = asRecords(bp.design_views).findIndex(view => view.view_id === 'development');
    const own = asRecords(asRecords(bp.design_views)[development].nodes).findIndex(node => node.node_id === 'ledger-module');
    const graph = (id: string, action: string) => ({ graph_id: id, format: 'mermaid', source_view_id: 'runtime', content: `sequenceDiagram\nparticipant Page\nparticipant Repo\nPage->>Repo: ${action}`, node_refs: ['view:runtime/flow:ledger-refresh-flow'], relation_refs: [] });
    const small = graph('reader-small', '代表性主路'); const raw = graph('raw-large', '原始完整调用明细'); bp.generated_graphs = [small, raw];
    bp.derived_results = [small, raw].map(item => ({ result_id: item.graph_id, input_revision: bp.revision, source_fingerprint: bp.source_fingerprint, decision_fingerprint: bp.decision_fingerprint, status: 'current' }));
    const pointer = `/design_views/${development}/nodes/${own}/acceptance/criteria/0`;
    asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'flows', title: '代表性流程', prose: '按 AC-2 确认此主路。', source_refs: [`/design_views/${runtime}/runtime_data_flows/0`, pointer, pointer], graph_ids: [small.graph_id] }] };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:reader-graphs'); const body = text.slice(0, text.indexOf('## 技术与追溯参考')); const reference = text.slice(text.indexOf('## 技术与追溯参考'));
    assert(body.includes(small.content) && !body.includes(raw.content)); assert(reference.includes(raw.content)); assert.equal(text.split(raw.content).length - 1, 1);
    assert(body.includes(`[AC-2](#${blueprintReviewAnchor('acceptance:view:development/node:ledger-module/criteria:AC-2')})`));
    const flow = body.slice(body.indexOf('## 6 关键流程'), body.indexOf('## 7 数据与存储')); assert.equal((flow.match(/\[设计依据\]/g) ?? []).length, 1); assert(!flow.includes('依据：'));
    assert(reference.includes(pointer.replace(/_/g, '\\_')));
  } },
  { name: 'current background terms and questions guide never hides the complete deterministic original facts', run(f) {
    const bp = blueprint(f); const review = asRecord(bp.review_summary)!; const facts = asRecords(asRecord(bp.discovery)!.facts);
    Object.assign(review, { background: '必须保留背景', problem: '必须保留问题', positioning: '必须保留定位', in_scope: ['必须保留范围'], non_goals: ['必须保留非目标'], must_review: ['必须保留评审关注'], goals: [{ goal_id: 'G-retained', statement: '必须保留目标', success_measures: ['AC-2'] }] });
    facts.push({ subject: 'term:独立术语', value: { meaning: '必须保留释义', canonical_module: '精确模块', easily_confused_with: ['易混对象'] }, provenance: { source_ref: 'docs/term-confirmed.md' } }, { subject: 'engineering:convention', value: '工程约定', provenance: { source_kind: 'convention', source_ref: 'docs/conventions.md#explicit-rule' } });
    asRecord(bp.discovery)!.facts = facts;
    review.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
      { section: 'background', title: '背景导读', prose: '作者背景说明依然有效。', source_refs: ['/review_summary/background'] },
      { section: 'terms', title: '术语导读', prose: '作者术语说明依然有效。', source_refs: [`/discovery/facts/${facts.length - 2}`] },
      { section: 'questions', title: '问题导读', prose: '作者问题说明依然有效。', source_refs: ['/review_summary/must_review'] },
    ] };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:retained'); const reference = text.slice(text.indexOf('## 技术与追溯参考'));
    for (const explanation of ['作者背景说明依然有效。', '作者术语说明依然有效。', '作者问题说明依然有效。']) assert(text.slice(0, text.indexOf('## 技术与追溯参考')).includes(explanation));
    for (const fact of ['必须保留背景', '必须保留问题', '必须保留定位', '必须保留范围', '必须保留非目标', '必须保留目标', '必须保留释义', '精确模块', '易混对象', 'docs/term-confirmed.md', 'docs/conventions.md#explicit-rule']) assert(reference.includes(fact), fact);
    assert(text.slice(0, text.indexOf('## 技术与追溯参考')).includes('必须保留评审关注')); assert(!reference.includes('必须保留评审关注'));
    assert(reference.includes(`[AC-2](#${blueprintReviewAnchor('acceptance:view:development/node:ledger-module/criteria:AC-2')})`));
  } },
  { name: 'authored flowchart preserves its existing validation path and stale guide warnings stay outside the body', run(f) {
    const bp = blueprint(f); const graph = generateMermaidViewGraph(bp, 'logical'); bp.generated_graphs = [graph]; bp.derived_results = [];
    const logicalIndex = asRecords(bp.design_views).findIndex(view => view.view_id === 'logical');
    const guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'solution', title: '对象怎样协作', prose: '已有对象按显式关系协作。', source_refs: [`/design_views/${logicalIndex}`], graph_ids: [graph.graph_id] }] };
    asRecord(bp.review_summary)!.reader_guide = guide;
    const current = renderBlueprintReviewMarkdown(bp, 'sha256:flowchart');
    assert.equal(current.split(graph.content.trimEnd()).length - 1, 1); assert(!current.includes(`时序图 ${graph.graph_id} 未记录对应派生结果`));
    guide.source_digest = 'sha256:old'; guide.sections[0].source_refs.push('/missing-source'); guide.sections[0].graph_ids.push('missing-graph');
    const stale = renderBlueprintReviewMarkdown(bp, 'sha256:stale-flowchart'); const referenceStart = stale.indexOf('## 技术与追溯参考');
    assert(stale.slice(0, referenceStart).includes('评审说明需更新')); assert(!stale.slice(0, referenceStart).includes('说明提示（非阻断）'));
    assert(stale.slice(referenceStart).includes('missing-source') && stale.slice(referenceStart).includes('missing-graph'));
  } },
  { name: 'unclosed backtick and tilde author fences cannot swallow later body or reference headings', run(f) {
    for (const marker of ['````', '~~~~~']) {
      const bp = blueprint(f); asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'background', title: '局部代码示例', prose: `示例：\n${marker}ts\n# 代码内标题`, source_refs: ['/review_summary/background'] }] };
      const text = renderBlueprintReviewMarkdown(bp, 'sha256:unclosed-fence');
      assert(text.includes(`${marker}ts\n# 代码内标题\n${marker}`));
      const headings: string[] = []; let fence: { marker: string; length: number } | undefined;
      for (const line of text.split('\n')) {
        const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (match) { if (!fence) fence = { marker: match[1][0], length: match[1].length }; else if (match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = undefined; continue; }
        if (!fence && line.startsWith('#')) headings.push(line);
      }
      assert(headings.includes('## 3 术语') && headings.includes('## 技术与追溯参考') && headings.includes('### C 完整验收'));
      assert(!headings.includes('# 代码内标题')); assert(!fence);
    }
  } },
  { name: 'reader guide places authored explanations beside graphs and preserves code fences while demoting headings', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const graph = { graph_id: 'reader-call', format: 'mermaid', source_view_id: 'runtime', content: 'sequenceDiagram\nparticipant Page as 页面\nparticipant Repo as 存储\nPage->>Repo: 提交\nRepo-->>Page: 已确认', node_refs: ['view:runtime/flow:ledger-refresh-flow'], relation_refs: [] };
    bp.generated_graphs = [graph]; bp.derived_results = [{ result_id: graph.graph_id, input_revision: bp.revision, source_fingerprint: bp.source_fingerprint, decision_fingerprint: bp.decision_fingerprint, status: 'current' }];
    const runtimeIndex = asRecords(bp.design_views).findIndex(view => view.view_id === 'runtime');
    const flowIndex = asRecords(asRecords(bp.design_views)[runtimeIndex].runtime_data_flows).indexOf(flow);
    asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [{ section: 'flows', title: '提交怎样确认成功', prose: '提交的返回值来自存储确认，随后页面才能发布结果。\n\n## 说明标题\n\n~~~~text\n# 保留代码标题\nview:runtime/flow:ledger-refresh-flow\n```literal\n~~~~', source_refs: [`/design_views/${runtimeIndex}/runtime_data_flows/${flowIndex}`], graph_ids: [graph.graph_id, 'missing-graph'] }] };
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:reader');
    const body = text.slice(text.indexOf('## 6 关键流程'), text.indexOf('## 7 数据与存储'));
    assert(body.includes('提交的返回值来自存储确认')); assert(body.indexOf('提交的返回值来自存储确认') < body.indexOf(graph.content));
    assert.equal(text.split(graph.content).length - 1, 1); assert(body.includes('**说明标题**')); assert(!body.includes('\n## 说明标题'));
    assert(body.includes('~~~~text\n# 保留代码标题\nview:runtime/flow:ledger-refresh-flow\n```literal\n~~~~'));
    assert(body.includes('说明提示（非阻断）') && body.includes('missing-graph')); assert.equal(JSON.stringify(bp), before);
    assert(text.includes('### C 完整验收') && text.includes('### E 施工精确映射'));
  } },
  { name: 'reader acceptance sources disambiguate repeated IDs by the exact owning target', run(f) {
    const bp = blueprint(f); const dev = asRecords(bp.design_views).find(view => view.view_id === 'development')!;
    const devIndex = asRecords(bp.design_views).indexOf(dev); const nodes = asRecords(dev.nodes);
    const own = nodes.find(node => node.node_id === 'ledger-module')!; const report = nodes.find(node => node.node_id === 'ledger-report-module')!;
    asRecords(asRecord(own.acceptance)!.criteria)[0].id = 'AC-1'; asRecords(asRecord(report.acceptance)!.criteria)[0].id = 'AC-1';
    asRecord(bp.review_summary)!.reader_guide = { source_digest: computeBlueprintReaderGuideSourceDigest(bp), sections: [
      { section: 'acceptance', title: '账目结果', prose: '账目按 AC-1 确认。', source_refs: [`/design_views/${devIndex}/nodes/${nodes.indexOf(own)}/acceptance/criteria/0`], graph_ids: [] },
      { section: 'acceptance', title: '报表结果', prose: '报表按 AC-1 确认。', source_refs: [`/design_views/${devIndex}/nodes/${nodes.indexOf(report)}/acceptance/criteria/0`], graph_ids: [] },
    ] };
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:reader-ids'); const body = text.slice(text.indexOf('## 12 验收'), text.indexOf('## 13 待补问题'));
    const ownAnchor = blueprintReviewAnchor('acceptance:view:development/node:ledger-module/criteria:AC-1'); const reportAnchor = blueprintReviewAnchor('acceptance:view:development/node:ledger-report-module/criteria:AC-1');
    assert(body.includes(`账目按 [AC-1](#${ownAnchor})`)); assert(body.includes(`报表按 [AC-1](#${reportAnchor})`));
    const reference = text.slice(text.indexOf('### C 完整验收'), text.indexOf('### D 全部用例分支'));
    assert.equal(reference.split('\n').filter(line => line.startsWith('| AC-1 |')).length, 3);
  } },
  { name: 'missing and stale guide use the new reading order and directory tree reconstructs the full exact file set', run(f) {
    const bp = blueprint(f); delete asRecord(bp.review_summary)!.reader_guide;
    const contracts = asRecord(target(bp, 'ledger-module').contracts)!;
    (contracts.files as string[]).push('src/ledger/a/index.ets', 'src/ledger/b/index.ets');
    const missing = renderBlueprintReviewMarkdown(bp, 'sha256:missing');
    assert(missing.includes('尚未补写评审说明')); assert(missing.indexOf('## 4 用户旅程与界面') < missing.indexOf('## 5 整体方案')); assert(missing.indexOf('## 11 施工与上线') < missing.indexOf('## 技术与追溯参考'));
    const tree = /### 文件与目录\n\n```text\n([\s\S]*?)\n```/.exec(missing)![1]; const paths: string[] = []; const parents: string[] = [];
    for (const line of tree.split('\n')) { const row = /^((?:│   |    )*)(?:├── |└── )(.+)$/.exec(line)!; const depth = row[1].length / 4; parents.length = depth; const entry = row[2]; if (entry.endsWith('/')) parents.push(entry.slice(0, -1)); else paths.push([...parents, entry].join('/')); }
    const files = [...new Set(asRecords(bp.design_views).flatMap(view => [...asRecords(view.nodes), ...asRecords(view.runtime_data_flows)]).flatMap(row => asStrings(asRecord(row.contracts)?.files)))];
    assert.deepStrictEqual(new Set(paths), new Set(files)); assert(tree.includes('a/') && tree.includes('b/'));
    asRecord(bp.review_summary)!.reader_guide = { source_digest: 'sha256:old', sections: [{ section: 'summary', title: '旧说明', prose: '旧叙述不得展示', source_refs: ['/review_summary/summary'] }] };
    const stale = renderBlueprintReviewMarkdown(bp, 'sha256:stale'); assert(stale.includes('评审说明需更新')); assert(!stale.includes('旧叙述不得展示')); assert(stale.includes(String(asRecord(bp.review_summary)!.summary)));
  } },
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
    const body = text.slice(text.indexOf('## 1 方案摘要'), text.indexOf('## 技术与追溯参考')).replace(/\]\([^)]*\)/g, ']');
    assert(!/\b(?:view|contract|relation|decision|publication|recovery|initial-load|requirement|consumer|data-domain):/.test(body));
    assert(!/^\|[^\n]+\|\n\|(?: --- \|)+\n(?=\n|#)/m.test(text));
    const targets = new Set([...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]));
    for (const match of text.matchAll(/\]\(#(design-[0-9a-f]+)\)/g)) assert(targets.has(match[1]), `缺锚点 ${match[1]}`);
    const image = [...text.matchAll(/^!\[[^\]]*\]\(([^)]+)\)/gm)]; assert.equal(image.length, 1);
    assert(fs.existsSync(path.resolve(path.dirname(f.blueprintFile), decodeURI(image[0][1]))), image[0][1]);
    const acceptanceChapter = text.slice(text.indexOf('### C 完整验收'), text.indexOf('### E 施工精确映射'));
    assert.equal(acceptanceChapter.split('\n').filter(row => row.startsWith('| AC-1 |')).length, 1);
    const indexChapter = text.slice(text.indexOf('#### 编号速查'), text.indexOf('#### 稳定设计地址'));
    assert(indexChapter.split('\n').some(row => row.startsWith('| AC-1 |') && row.includes('[AC-1](#design-')), '附录只能链接主责编号');
  } },
  { name: 'missing summaries stay before the next model or construction source and source metadata stays unchanged', run(f) {
    const bp = blueprint(f); const flows = asRecords(asRecords(bp.design_views).find(v => v.view_id === 'runtime')!.runtime_data_flows);
    asRecords(flows[1].consumers)[0].consumption = undefined;
    bp.source_fingerprint = 'data-domain:ledger-entry';
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:source-layout');
    const header = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]); assert.equal(header.derived_from.source_fingerprint, bp.source_fingerprint);
    const models = text.slice(text.indexOf('#### 领域模型、字段与枚举'), text.indexOf('#### 本部件实际消费或提供的操作与 DTO'));
    const nextModelSource = models.indexOf(`内容承载于：[账目刷新模块](#${blueprintReviewAnchor('view:development/node:ledger-module')})`);
    const modelMissing = /^未记录：.*默认值.*。$/m.exec(models);
    assert(modelMissing && modelMissing.index < nextModelSource, models);
    const runtime = text.slice(text.indexOf('### 报表首次读取与快照更新'), text.indexOf('### C 完整验收'));
    const nextStateSource = runtime.indexOf(`内容承载于：[账目提交、发布与恢复](#${blueprintReviewAnchor('view:runtime/flow:ledger-refresh-flow')})`);
    const flowMissing = /^未记录：.*消费语义.*$/m.exec(runtime);
    assert(flowMissing && flowMissing.index < nextStateSource, runtime);
    assert(!text.includes('| covered |')); assert(text.includes('已覆盖'));
    assert(!text.includes('publication:') || text.indexOf('publication:') > text.indexOf('## 技术与追溯参考'));
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
    assert.equal(text.slice(text.indexOf('## 技术与追溯参考')).split('唯一恢复说明').length - 1, 1); assert(text.includes('失败与恢复见')); assert(text.includes('（真机补充）')); assert(!text.includes(`UT：${ac.expected_result}`));
    assert(text.includes('| 方案 | 被否理由/缺陷 |')); assert.equal(text.split('完全相同代价').length - 1, 1); assert(!text.slice(text.indexOf('## 技术与追溯参考')).includes('完全相同代价'));
    assert(!text.includes('目标写集：')); assert(text.includes('| 文件 | 声明目标 |')); assert(text.includes(blueprintReviewAnchor('writes:view:development/node:ledger-module')));
    assert(text.includes('内容承载于：')); assert(!text.includes('设计内容来源：'));
    asRecords(decision.alternatives)[1].defect = '确实不同代价';
    asRecords(asRecord(flow.contracts)!.state_management)[0].failure_recovery = { handling: '不同恢复处理', retry: '不同恢复重试' };
    const different = renderBlueprintReviewMarkdown(bp, 'sha256:dedup'); assert(different.includes('另一相同代价<br>确实不同代价')); assert(different.includes('不同恢复处理')); assert(different.includes('| 处理 |'));
  } },
  { name: 'saved current sequence content displays beside its flow without relation refs or invented calls and stale graphs only request rebuild', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const graph = { graph_id: 'ledger-sequence', format: 'mermaid', source_view_id: 'runtime', content: 'sequenceDiagram\nparticipant Page as 页面\nparticipant Repo as 存储\nPage->>Repo: 保存记录\nRepo-->>Page: 已确认\n', node_refs: ['view:runtime/flow:ledger-refresh-flow', 'contract:create-entry-v1'], relation_refs: [] };
    bp.generated_graphs = [graph]; bp.derived_results = [{ result_id: graph.graph_id, input_revision: bp.revision, source_fingerprint: bp.source_fingerprint, decision_fingerprint: bp.decision_fingerprint, status: 'current' }];
    const current = renderBlueprintReviewMarkdown(bp, 'sha256:sequence'); assert(current.includes(graph.content.trimEnd())); assert(current.indexOf(graph.content.trimEnd()) > current.indexOf(`### ${flow.name}`)); assert(current.indexOf(graph.content.trimEnd()) < current.indexOf('#### 施工状态与有序步骤'));
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
  { name: 'flat record arrays render every error semantic and other business collections without changing input', run(f) {
    const bp = blueprint(f); const contract = asRecords(bp.contracts)[0];
    const host = YAML.parse(fs.readFileSync(path.join(frameworkRoot, 'harness/tests/fixtures/blueprint-content/ad508cb9.yaml'), 'utf8'));
    contract.errors = asRecords(host.contracts)[0].errors;
    contract.nfr = { rules: [{ metric: 'latency', threshold: 0, enabled: false }, { description: '已有业务说明', value: null }] };
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:flat-records');
    assert(text.includes('错误：（code：INVALID\\_OTP；meaning：验证码不是六位数字，禁止提交且不写库。）' +
      '；（code：PERSIST\\_FAILED；meaning：卡片 RDB 写入失败，仍进入失败结果页并携带完整卡号。）' +
      '；（code：NAVIGATION\\_FAILED；meaning：导航栈操作失败，保留当前页并提示，不伪造完成状态。）'));
    assert(text.includes('非功能要求：rules：（metric：latency；threshold：0；enabled：false）；（description：已有业务说明；value：null）'));
    assert(text.includes('bank-card-opening-contract.yaml#/errors') && text.includes('acceptance:AC-6'));
    const ids = [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
    for (const match of text.matchAll(/\]\(#(design-[0-9a-f]+)\)/g)) assert(ids.includes(match[1]), `缺锚点 ${match[1]}`);
    assert.equal(JSON.stringify(bp), before);
  } },
  { name: 'direct flat record arrays preserve structural metadata boundaries and isolate deeper members', run(f) {
    const bp = blueprint(f); const contract = asRecords(bp.contracts)[0];
    const values = [
      { code: 'FIRST', meaning: '首项', source_refs: ['hidden-source-array'], verification_refs: ['hidden-verification-array'], evidence_refs: ['hidden-evidence-array'], provenance: { source_ref: 'hidden-provenance' }, artifact_sha256: 'hidden-hash', source_fingerprint: 'hidden-fingerprint' },
      { code: 'DEEP', details: { meaning: 'hidden-nested-object' } },
      [{ code: 'hidden-nested-array' }],
      { code: 'DEEP_LIST', details: ['hidden-record-array'] },
      { code: 'LAST', meaning: '末项' }, {}, false, 0, '', null,
    ];
    contract.errors = values; contract.idempotency = { rules: structuredClone(values) };
    const branch = asRecords(asRecords(asRecord(target(bp, 'ledger-refresh-flow').use_cases)!.use_cases)[0].branches)[0];
    branch.expected_state = { observations: [{ provenance: '业务来源状态', source_ref: '业务来源键', ready: false }] };
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:flat-boundaries');
    const rendered = '（code：FIRST；meaning：首项）；已声明（结构未展开）；已声明（结构未展开）；已声明（结构未展开）；（code：LAST；meaning：末项）；无；false；0；""；null';
    assert(text.includes(`错误：${rendered}`)); assert(text.includes(`幂等：rules：${rendered}`));
    assert(text.includes('observations：（provenance：业务来源状态；source\\_ref：业务来源键；ready：false）'));
    assert(!text.includes('hidden-'), '来源结构过滤仍在原位置；深层记录只占位，不展开内容');
    contract.errors = []; contract.idempotency = { rules: [] };
    const empty = renderBlueprintReviewMarkdown(bp, 'sha256:flat-empty'); assert(empty.includes('错误：无')); assert(empty.includes('幂等：rules：无'));
    contract.errors = values; contract.idempotency = { rules: structuredClone(values) }; assert.equal(JSON.stringify(bp), before);
  } },
  { name: 'known contract collections filter flat record metadata without deleting same-named business state keys', run(f) {
    const bp = blueprint(f); const contract = asRecords(bp.contracts)[0];
    const records = [{ code: 'RULE', meaning: '业务处理', source_ref: 'hidden-source', artifact_sha256: 'hidden-hash', source_fingerprint: 'hidden-fingerprint', source_refs: ['hidden-sources'], verification_refs: ['hidden-verification'], evidence_refs: ['hidden-evidence'], provenance: { source_ref: 'hidden-provenance' } }];
    contract.errors = { items: structuredClone(records) }; contract.nfr = { requirements: structuredClone(records) };
    const branch = asRecords(asRecords(asRecord(target(bp, 'ledger-refresh-flow').use_cases)!.use_cases)[0].branches)[0];
    branch.expected_state = { observations: [{ source_ref: '业务来源键', artifact_sha256: '业务校验值', provenance: '业务来源状态' }] };
    const before = JSON.stringify(bp); const text = renderBlueprintReviewMarkdown(bp, 'sha256:contract-collection-metadata');
    assert(text.includes('错误：（code：RULE；meaning：业务处理）')); assert(text.includes('非功能要求：（code：RULE；meaning：业务处理）'));
    assert(!text.includes('hidden-'), '契约集合与 semantics 沿相同结构边界过滤元数据');
    assert(text.includes('observations：（source\\_ref：业务来源键；artifact\\_sha256：业务校验值；provenance：业务来源状态）'));
    assert.equal(JSON.stringify(bp), before);
  } },
  { name: 'flat record arrays keep cell escaping links line breaks and explicit empty values', run(f) {
    const bp = blueprint(f); const flow = target(bp, 'ledger-refresh-flow');
    const link = `[AC-1](#${blueprintReviewAnchor('acceptance:view:logical/node:review-common/criteria:AC-1')})`;
    asRecords(flow.consumers)[0].consumption = [{ key: 'a|b', value: '<tag> & *literal* _name_\n下一行', empty: '', nil: null }, { only: link, leading: `${link}后文`, trailing: `前文${link}`, adjacent: `${link}${link}` }];
    const text = renderBlueprintReviewMarkdown(bp, 'sha256:flat-escaping');
    assert(text.includes('（key：a&#124;b；value：&lt;tag&gt; &amp; \\*literal\\* \\_name\\_<br>下一行；empty：""；nil：null）'));
    assert(text.includes(`（only：${link}；leading：${link}后文；trailing：前文${link}；adjacent：${link}${link}）`));
    assert(!text.includes('""[') && !text.includes(')""'), '链接分段边界不引入空字符串');
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
    const cases = text.slice(text.indexOf('#### 用例、数据边界与分支'), text.indexOf('### E 施工精确映射'));
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
    const missing = renderBlueprintReviewMarkdown(bp, 'sha256:decision-test').split('### generic-choice')[1].split('<a id="recovery">')[0];
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
    const text = render(f); const section = text.slice(text.indexOf('### C 完整验收'), text.indexOf('### E 施工精确映射'));
    const rows = section.split('\n').filter(row => row.startsWith('| AC-1 |')); assert.equal(rows.length, 2);
    assert(rows[0].includes('ledger-refresh/runtime-owner') && !rows[0].includes('ledger-refresh/refresh-behavior') && !rows[0].includes('ledger-report/'), rows[0]);
    assert(rows[1].includes('ledger-report/') && !rows[1].includes('ledger-refresh/'), rows[1]);
    for (const kind of ['AC', 'BD', 'NFR']) { assert(text.includes(`UT：${kind} 的单测关注`)); assert(text.includes(`device：${kind} 的真机关注`)); }
    const exception = text.slice(text.indexOf('## 9 失败与恢复'), text.indexOf('## 10 质量与安全')); assert(exception.includes('[BD-2](#design-')); assert(!exception.includes('BD 的单测关注') && !exception.includes('BD 的真机关注'));
    assert(text.includes('先读取持久快照；随后建立重放订阅'));
    const ownAnchor = blueprintReviewAnchor('acceptance:view:development/node:ledger-module/criteria:AC-1');
    const reportAnchor = blueprintReviewAnchor('acceptance:view:development/node:ledger-report-module/criteria:AC-1');
    const unitReference = text.slice(text.indexOf('### E 施工精确映射'), text.indexOf('### F 需求追溯'));
    const refreshUnit = unitReference.slice(unitReference.indexOf('#### ledger-refresh'), unitReference.indexOf('#### ledger-report'));
    const reportUnit = unitReference.slice(unitReference.indexOf('#### ledger-report'));
    assert(refreshUnit.includes(ownAnchor) && !refreshUnit.includes(reportAnchor), refreshUnit);
    assert(reportUnit.includes(reportAnchor) && !reportUnit.includes(ownAnchor), reportUnit);
    const ownContract = text.slice(text.indexOf('#### create-entry-v1'), text.indexOf('#### read-report-v1'));
    const reportStart = text.indexOf('#### read-report-v1');
    const reportEnd = text.indexOf('内容承载于：', reportStart);
    assert(reportStart >= 0 && reportEnd > reportStart, '报表契约必须在下一份 typed 内容之前独立定位');
    const reportContract = text.slice(reportStart, reportEnd);
    assert(ownContract.includes(ownAnchor) && !ownContract.includes(reportAnchor)); assert(reportContract.includes(reportAnchor) && !reportContract.includes(ownAnchor));
  } },
  { name: 'one rich fixture yields 4+1 detail, true shared/exclusive inheritance and read-only handoff', run(f) {
    const bp = blueprint(f); assert.deepStrictEqual(validateComponentBlueprint(bp, { projectRoot: f.root }).filter(i => i.severity === 'BLOCKER'), []);
    const ready = deriveDesignPreparationReadiness(f.root, 'ledger-app-blueprint'); assert(ready.ready, JSON.stringify(ready.perUnit));
    for (const feature of [f.feature, f.reportFeature]) for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml', 'spec.md', 'plan.md']) assert(!fs.existsSync(featureFilePath(f.root, feature, name)), name);
    const text = render(f);
    const statements = ['未声明可展示的同视图结构边；以上对象表保留，不从名称、目录或字段类型猜连线。', '未声明上游依赖；不从目录、purpose 或数组顺序推断施工顺序。', '未声明的索引、事务、存储配置不由 renderer 推断。'];
    const bodyMechanismStatements = (document: string) => document.slice(document.indexOf('## 1 方案摘要'), document.indexOf('## 技术与追溯参考')).split('\n').filter(line => statements.some(statement => line.includes(statement)));
    assert.equal(bodyMechanismStatements(text).length, 0, '重复机制说明只能集中在阅读说明');
    const before = ['## 1 方案摘要', ...Array(3).fill(statements[0]), statements[1], statements[2], '## 技术与追溯参考'].join('\n');
    assert.equal(bodyMechanismStatements(before).length, 5, '统计必须能发现修复前五句声明');
    for (const needle of ['#### 场景视图（+1）', '#### 逻辑视图', '#### 运行流与状态明细', '### C 完整验收', '#### 本部件落点与外部参与方', '整数分的十进制字符串', 'LedgerStage', '验证步骤（按序）', '被否理由', '账号隔离', '本地首次读取时间', '是否通过设计交接见 readiness', 'report-ready', 'repository.commit', 'LedgerPage']) assert(text.includes(needle), needle);
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
    assert(draft.includes('尚未拆分')); assert(draft.includes('AC-2')); assert(draft.includes('LedgerEntry')); assert(draft.includes('设计内容与表达诊断（非阻断）')); assert(!draft.includes('可选表达未能完整显示'));
    update(f, bp => { target(bp, 'ledger-module').acceptance = '请测试刷新'; asRecords(asRecord(target(bp, 'review-common').contracts)!.data_models)[0].fields = ['broken']; });
    const invalidText = render(f); assert(invalidText.includes('acceptance 无效')); assert(invalidText.includes('fields 无效'));
  } },
  { name: 'pending pointer defers CU merged collection, exact bad supersedes remains a source gap', run(f) {
    update(f, bp => { bp.revision = Number(bp.revision) + 1; for (const r of asRecords(bp.derived_results)) r.input_revision = bp.revision; }, false);
    const pending = render(f); const unitSection = pending.slice(pending.indexOf('### E 施工精确映射'), pending.indexOf('### F 需求追溯'));
    assert(unitSection.includes('待指针升版后显示')); assert(!unitSection.includes('合并无效'));
    assert(!/\]\(#design-616363657074616e6365/.test(unitSection), 'pending CU 不解析旧指针建立验收链接');
    f.bind(); const cu = YAML.parse(fs.readFileSync(f.cuFiles[1], 'utf8')); const prior = loadCanonicalChangeUnit(f.root, 'ledger-app-blueprint', 'ledger-refresh');
    cu.supersedes = { artifact: 'change-unit@1', component_id: 'ledger', blueprint_id: 'ledger-app-blueprint', change_unit_id: 'ledger-refresh', revision: 1, artifact_sha256: sha256Bytes(Buffer.from('wrong')) }; fs.writeFileSync(f.cuFiles[1], YAML.stringify(cu));
    const source = loadBlueprintReviewSource(f.root, 'ledger-app-blueprint'); assert(source.inputs.sourceGaps.length > 0); assert(source.inputs.units.find(u => u.id === 'ledger-report')!.binding === 'unresolved'); assert(prior.artifactSha256 !== cu.supersedes.artifact_sha256);
  } },
  { name: 'contract and global relation tables show only active direct CU claims including pending pointers', run(f) {
    const tableRow = (text: string, id: string): string => text.slice(text.indexOf('#### 本部件落点与外部参与方')).split('\n').find(row => row.startsWith(`| ${id} |`))!;
    let text = render(f); assert(text.includes('| 契约 | 责任方 | 本侧需要方 | 认领 CU |')); assert(text.includes('| 关系 | 起点 | 终点 | 类型 | 责任方 | 认领 CU |'));
    assert(tableRow(text, 'create-entry-v1').endsWith('| ledger-refresh |')); assert(tableRow(text, 'read-report-v1').endsWith('| ledger-report |'));
    assert(tableRow(text, 'local-ledger-consumes-service').endsWith('| ledger-refresh |')); assert(tableRow(text, 'report-domain-owned-by-module').endsWith('| ledger-report |'));
    assert(text.indexOf('#### 各视图的显式联系') > text.indexOf('#### 本部件落点与外部参与方')); assert(!text.includes('##### 各视图的显式联系'));
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
export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const timings: UnitExecutionTiming[] = [];
  const results = cases.filter(c => matchesUnitCase(c.name, selector)).map(c => {
    const endTiming = startCaseTiming([c.name], timings); const f = createBlueprintReviewDesignFixture();
    try { c.run(f); return { name: c.name, ok: true }; } catch (error) { return { name: c.name, ok: false, error: (error as Error).stack }; }
    finally { try { fs.rmSync(f.root, { recursive: true, force: true }); } finally { endTiming(); } }
  });
  const name = 'previously completed but non-retired CU is still checked after authoritative content becomes invalid';
  if (!matchesUnitCase(name, selector)) return selectedUnitCases(results, selector, timings);
  const endTiming = startCaseTiming([name], timings);
  const old = await loadMigratedHostSnapshot([SNAPSHOT_CU_FEATURE]);
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
  finally { try { fs.rmSync(old.root, { recursive: true, force: true }); } finally { endTiming(); } }
  return selectedUnitCases(results, selector, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
