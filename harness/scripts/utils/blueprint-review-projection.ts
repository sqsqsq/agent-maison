import * as YAML from 'yaml';
import { BlueprintIssue, BlueprintRecord, asRecord, asRecords, asStrings, nonEmptyString } from './component-blueprint-model';
import { stableAddressIndex } from './blueprint-addressing';
import { validateComponentBlueprintRefShape } from './component-blueprint-path';
import { currentScopeItems, requirementTraceability } from './blueprint-requirement-traceability';
import { ownersForAddress } from './change-unit-addressing';
import { blueprintRefAddress } from './change-unit-model';
import { BlueprintReviewInputs, ReviewChangeUnit, reviewChangeUnitBindings } from './blueprint-review-inputs';
import { BlueprintContentError, mergeBlueprintTargetContent, projectionContentEqual, projectionRowIdentity, selectBlueprintSkillContent } from './blueprint-skill-projection';
import type { ComponentBlueprintRef } from './component-blueprint-model';
import { generateMermaidViewGraph, generateMermaidRelationGraph, generateMermaidPhaseGraph, generateMermaidModuleDependencyGraph, parseMermaidSubset, validateGeneratedBlueprintGraphs } from './blueprint-graph-generator';
import { evaluateDerivedConclusionFreshness } from './derived-conclusion-freshness';
import { diagnoseBlueprintPresentationShape } from './component-blueprint-validator';
import { extractAcceptanceIdRefs } from './check-acceptance';
import { normalizeUseCasePortCalls } from './spec-loader';
import { BlueprintGraphDisplayInspection, inspectBlueprintGraphDisplay } from './blueprint-reader-guide';

export const BLUEPRINT_REVIEW_FORMAT = 'component-blueprint-review@12';

const PRESENTATION_METADATA = new Set(['provenance', 'source_ref', 'source_refs', 'verification_refs', 'evidence_refs', 'artifact_sha256', 'source_fingerprint']);
const SUMMARY_KEYS = new Set(['semantics', 'description', 'rule', 'answer', 'summary']);
const isScalar = (value: unknown): boolean => ['string', 'number', 'boolean'].includes(typeof value);
const absent = (value: unknown): boolean => value === undefined || value === null || value === '' || value === '未记录' || value === '—';
function arrayProse(value: unknown[], structural: boolean): string {
  return value.map(item => {
    if (item === null || isScalar(item)) return prose(item);
    const record = asRecord(item);
    if (!record) return '已声明（结构未展开）';
    const entries = Object.entries(record).filter(([key]) => !structural || !PRESENTATION_METADATA.has(key));
    if (entries.some(([, entry]) => entry !== null && !isScalar(entry))) return '已声明（结构未展开）';
    return entries.length ? `（${entries.map(([key, entry]) => `${key}：${prose(entry)}`).join('；')}）` : Object.keys(record).length ? '已声明（仅来源信息）' : '无';
  }).join('；') || '无';
}
/** 一层业务键值；更深结构只说明已声明，不能伪装成缺失。 */
function prose(value: unknown, structural = false): string {
  if (value === null) return 'null';
  if (isScalar(value)) return value === '' ? '""' : String(value);
  if (value === undefined) return '未记录';
  if (Array.isArray(value)) return arrayProse(value, structural);
  const record = asRecord(value);
  if (!record) return '未能表达（值类型不支持）';
  if (!Object.keys(record).length) return '无';
  const entries = Object.entries(record).filter(([key]) => !structural || !PRESENTATION_METADATA.has(key));
  return entries.map(([key, entry]) => {
    const valueText = entry === null || isScalar(entry) ? prose(entry) : Array.isArray(entry) ? arrayProse(entry, structural) : entry === undefined ? '未记录' : '已声明（结构未展开）';
    return entries.length === 1 && SUMMARY_KEYS.has(key) ? valueText : `${key}：${valueText}`;
  }).join('；') || '已声明（仅来源信息）';
}

function text(value: unknown): string {
  return prose(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]])/g, '\\$1');
}
function cell(value: unknown): string {
  return prose(value).split(/(\[[^\]\n]+\]\(#[^)]+\))/g).map(part => part === '' || /^\[[^\]\n]+\]\(#[^)]+\)$/.test(part) ? part : text(part)).join('').replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>');
}
function refs(value: unknown): string { return value === undefined || value === null ? '—' : prose(value); }
/** 已知语义字段的短句；不展开结构/来源元数据。 */
function meaning(value: unknown): string {
  return prose(value, true);
}
/** 用例预期状态与桩的业务键值保留同名来源字段。 */
function namedMeanings(value: unknown): string {
  return prose(value);
}
function declaredMeaning(value: unknown): string {
  return prose(value, true);
}
function contractMeaning(value: unknown, collection: string): string {
  const record = asRecord(value);
  if (!record || record[collection] === undefined) return meaning(value);
  return Object.entries(record).filter(([key]) => !PRESENTATION_METADATA.has(key)).map(([key, entry]) => key === collection ? declaredMeaning(entry) : `${key}：${declaredMeaning(entry)}`).join('；');
}
export function blueprintReviewAnchor(address: string): string { return `design-${Buffer.from(address).toString('hex')}`; }
function anchor(address: string): string { return `<a id="${blueprintReviewAnchor(address)}"></a>`; }
function designLink(address: string, label = address.split(':').pop()!): string { return `[${cell(label)}](#${blueprintReviewAnchor(address)})`; }
function enumText(value: unknown, labels: Record<string, string>): string { return labels[String(value)] ?? prose(value); }
const APPLICABILITY = { applicable: '适用', not_applicable: '不适用', unknown: '待确认' };
const IMPACT = { changed: '有变化', verified_unchanged: '已核实未变', unknown: '待确认' };
const ROLES = { owner: '主责', consumer: '消费方', contract: '契约责任', provider: '提供方', recovery: '恢复责任', behavior: '行为责任' };
const KINDS = { page: '页面', component: '组件', dialog: '对话框', interface: '接口', class: '类', enum: '枚举', source: '源码', entry: '入口', progress: '过程', result: '结果', storage: '存储', system: '系统', passive: '被动接收' };
const DISPOSITIONS = { answered_with_evidence: '已据证回答', decided_with_authority: '已授权裁决', open_decision: '待决', blocker: '阻塞', not_applicable: '不适用', unknown: '待确认', resolved: '已解决', pass: '通过', passive: '被动覆盖', covered: '已覆盖' };
const LIFECYCLE = { cold_start: '冷启动', warm_resume: '热恢复', page_attach: '页面挂载', page_detach: '页面卸载', account_switch: '账号切换', process_recreation: '进程重建', background_write: '后台写入' };
const RELATIONS = { realized_by: '由其实现', consumes: '消费', implements: '实现', owned_by: '由其持有', deployed_in: '部署于' };
const RECOVERY = { recovery_id: '恢复标识', strategy: '策略', handling: '处理', retry: '重试', persistence_failure: '持久化失败', subscription_failure: '订阅失败', process_recreation: '进程重建' };
const booleanText = (value: unknown): unknown => value === true ? '是' : value === false ? '否' : value;
function table(headers: string[], rows: unknown[][]): string[] {
  if (!rows.length) return [];
  const columns = headers.map((_, i) => i).filter(i => rows.some(row => !absent(row[i])));
  if (!columns.length) return [];
  const missing = headers.flatMap((header, i) => rows.some(row => absent(row[i])) ? headers.length === 2 && i === 1 ? rows.filter(row => absent(row[i])).map(row => `${prose(row[0])}（${header}）`) : [header] : []);
  return [`| ${columns.map(i => headers[i]).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${columns.map(i => absent(row[i]) ? '—' : cell(row[i])).join(' | ')} |`), '', ...(missing.length ? [`<!-- review-missing:${missing.join('、')} -->`] : [])];
}
/** 仅指定说明列可提为整表共同说明，行身份与来源关联仍留在原表。 */
function explainedTable(headers: string[], rows: unknown[][], explanationColumns: string[]): string[] {
  const common = headers.flatMap((header, i) => explanationColumns.includes(header) && rows.length >= 3 && !absent(rows[0][i]) && rows.every(row => projectionContentEqual(row[i], rows[0][i])) ? [i] : []);
  return [...common.map(i => `全表共同${headers[i]}：${cell(rows[0][i])}。`), ...(common.length ? [''] : []), ...table(headers.filter((_, i) => !common.includes(i)), rows.map(row => row.filter((_, i) => !common.includes(i))))];
}
function directReviewUnits(inputs: BlueprintReviewInputs) {
  return inputs.units.filter(item => !item.retiredBy && item.unit).map(item => ({ ...item.unit!, design_refs: asRecords(item.unit!.design_refs).flatMap(ref => {
    try { return [validateComponentBlueprintRefShape(ref)]; } catch { return []; }
  }) }));
}
function acceptanceFocus(row: BlueprintRecord): string {
  const expected = row.expected_result ?? row.expected_behavior ?? row.description;
  const focuses = [row.ut_focus === undefined || row.ut_focus === expected ? undefined : `UT：${prose(row.ut_focus)}`, row.device_focus === undefined || row.device_focus === expected ? undefined : `device：${prose(row.device_focus)}`].filter(Boolean);
  return `${enumText(row.ut_layer, { unit: '单元测试', device: '真机', both: '单测与真机' })}${focuses.length ? `；${focuses.join('；')}` : row.ut_focus === undefined && row.device_focus === undefined ? '；未记录关注点' : ''}`;
}

function renderUnit(item: ReviewChangeUnit, blueprint: BlueprintRecord): string[] {
  const lines = [`#### ${text(item.id)}`, ''];
  if (!item.unit) return [...lines, 'CU 无法解析，见来源缺口。', ''];
  const cu = item.unit;
  let bundle: ReturnType<typeof selectBlueprintSkillContent> | undefined; let mergeError: unknown;
  if (item.binding === 'bound') try { bundle = selectBlueprintSkillContent(blueprint, cu); } catch (error) { mergeError = error; }
  const acceptanceLinks = acceptanceLinksFor(bundle?.selected.flatMap(({ ref, target }) => {
    const value = asRecord(target.acceptance); return value ? [{ address: blueprintRefAddress(ref), value }] : [];
  }) ?? [], blueprint);
  lines.push(text(cu.purpose), '', `来源绑定：${item.binding === 'bound' ? '已绑定' : item.binding === 'pending' ? '待指针升版；不承诺可以 carry-forward' : '未解析/未绑定'}。`, '',
    '交付结果：', '', ...table(['谓词', '职责', '交付语义', '提供项', '验证关注'], asRecords(cu.target_predicates).map(p => [p.predicate_id, enumText(p.role, ROLES), p.description, refs(p.provide_ids), acceptanceLinks(p.verification_refs)])),
    ...table(['提供项', '交付说明'], asRecords(cu.provides).map(p => [p.provide_id, p.description])));
  const requires = asRecords(cu.requires);
  lines.push('显式依赖：', '', ...(requires.length ? table(['依赖', '上游 CU', '上游提供项'], requires.map(r => [r.require_id, r.from_change_unit_id, r.provide_id])) : ['未声明上游依赖。', '']),
    `可修改模块：${item.binding === 'pending' ? '待指针升版后显示' : item.modules?.map(text).join('；') || '未解析，见来源缺口'}。`,
    '',
    ...table(['修改责任方', '写入范围', '设计引用'], asRecords(cu.touches).map(touch => [touch.owner, asStrings(touch.write_refs).map(file => {
      const declared = [...stableAddressIndex(blueprint).values()].some(target => asStrings(asRecord(target.contracts)?.files).includes(file));
      return declared ? designLink(`file:${file}`, file.slice(file.lastIndexOf('/') + 1)) : prose(file);
    }).join('；'),
      item.binding === 'pending' ? '待指针升版后显示' : asRecord(touch.design_ref)?.target ? blueprintRefAddress(touch.design_ref as never) : '无法解析'])));
  for (const [key, title] of [['preconditions', '前置条件'], ['preserved_invariants', '保留约束']] as const) {
    const entries = asRecords(cu[key]);
    if (entries.length) lines.push(`${title}：`, '', ...table(['说明', '依据'], entries.map(entry => [entry.description, refs(entry.source_refs ?? entry.evidence_refs)])));
  }
  const safe = asRecord(cu.safe_intermediate_state);
  lines.push(`安全中间态：${text(safe?.description)}`, `构建：${text(refs(safe?.build_validation_refs))}；兼容：${text(refs(safe?.compatibility_refs))}；恢复：${acceptanceLinks(safe?.recovery_refs)}`, '');
  const blockers = asRecords(cu.blockers);
  if (blockers.length) lines.push('设计与执行阻塞项：', '', ...table(['阻塞项', '阶段', '责任方', '原因', '解除条件'], blockers.map(b => [b.blocker_id, b.gate, b.owner, b.reason, b.unlock_condition])));
  else lines.push('设计与执行阻塞项：无。', '');
  lines.push('设计引用：', '', ...(item.binding === 'pending' ? ['待指针升版后显示。'] : item.designAddresses.map(address => `- ${designLink(address)}`)), '', `验证关注：${acceptanceLinks(cu.verification_refs)}`, '');
  lines.push('合并所得声明集合：', '');
  if (item.binding === 'pending') lines.push('待指针升版后显示。', '');
  else if (item.binding !== 'bound') lines.push('未绑定，不能列出可靠的合并声明集合。', '');
  else if (bundle) {
    const inherited = (field: string, key: string): string => bundle.selected.flatMap(({ ref, target }) => asRecords(asRecord(target[field])?.[key]).map(row => designLink(`acceptance:${blueprintRefAddress(ref)}/${key}:${row.id}`, String(row.id)))).join('；');
    const exactFiles = asStrings(bundle.contracts?.files).map(file => designLink(`file:${file}`, file.slice(file.lastIndexOf('/') + 1))).join('；');
    lines.push(...table(['内容', '本 CU 整体继承的编号/文件'], [
      ['AC', inherited('acceptance', 'criteria') || '设计期未写入，将由 spec 补'],
      ['BD', inherited('acceptance', 'boundaries') || '未记录'],
      ['NFR', inherited('acceptance', 'performance') || '未记录'],
      ['contracts.files 声明写集', `${asStrings(bundle.contracts?.files).length} 个文件；${exactFiles || '设计期未写入，将由 plan 补'}`],
      ['用例', asRecords(bundle.useCases?.use_cases).map(row => prose(row.id)).join('；') || '设计期未写入，将由 plan 补'],
    ]));
    if (!bundle.contracts) lines.push('设计期未写入 contracts，将由 plan 补。', '');
  } else lines.push(`合并无效：${text(mergeError instanceof BlueprintContentError ? mergeError.code : '无法解析')} · ${text((mergeError as Error)?.message)}。不展示部分成功集合。`, '');
  return lines;
}

function decisionTitle(decision: BlueprintRecord, blueprint: BlueprintRecord): unknown {
  const target = decision.kind === 'component_asset_selection' && nonEmptyString(decision.target_ref) ? stableAddressIndex(blueprint).get(decision.target_ref) : undefined;
  return decision.label ?? target?.label ?? target?.name ?? decision.name ?? decision.decision_id;
}

function decisionConclusion(decision: BlueprintRecord): string {
  if (decision.kind === 'component_asset_selection') return `选型结果：${enumText(decision.asset_resolution, { reuse: '直接复用已有组件', configure: '用已有参数表达需求', adapt: '在使用方编写局部包装或组合', evolve: '兼容演进共享定义', custom: '自定义实现' })}；选型目标：${prose(decision.target_ref)}${decision.asset_resolution === 'custom' && absent(decision.component_ref) ? '' : `；组件：${prose(decision.component_ref)}`}`;
  if (decision.kind === 'architecture_impact') {
    switch (decision.change) {
      case 'dependency_edge': return `${prose(decision.change)}：${prose(decision.from)} → ${prose(decision.to)}；方向 ${prose(decision.direction)}`;
      case 'move_module': return `${prose(decision.change)}：${prose(decision.module)}；${prose(decision.from_layer)} → ${prose(decision.to_layer)}`;
      case 'add_module': return `${prose(decision.change)}：${prose(decision.module)}；层 ${prose(decision.layer)}`;
      case 'dsl_other': return `${prose(decision.change)}：${refs(decision.affected_items)}`;
      default: return `${prose(decision.change)}：${prose(decision.module)}`;
    }
  }
  if (decision.kind === 'evolution_candidate') return `${prose(decision.human_decision)}；契约 ${prose(decision.stable_contract)}；provider ${prose(decision.provider)}；consumer ${prose(decision.consumer)}；绑定时机 ${prose(decision.binding_time)}；失败语义 ${prose(decision.failure_semantics)}；${prose(decision.impact)}；再次提取条件 ${prose(decision.reextract_condition)}`;
  return meaning(decision.resolution ?? decision.decision ?? decision.conclusion ?? decision.description ?? decision.target_state);
}

function renderFlow(flow: BlueprintRecord, viewId: unknown, acceptanceLinks: (value: unknown) => string): string[] {
  const load = asRecord(flow.initial_load); const truth = asRecord(flow.source_of_truth); const state = asRecord(flow.state_owner); const recovery = asRecord(flow.failure_recovery);
  const lines = [anchor(`view:${viewId}/flow:${flow.flow_id}`), `##### ${text(flow.name ?? flow.flow_id)}`, '',
    `数据域：${text(refs(flow.data_domain_refs))}；契约：${text(refs(flow.external_contract_refs))}；开发责任：${text(flow.development_owner_ref)}`, '',
    '触发：', '', ...table(['触发', '类型', '时机', '幂等'], asRecords(flow.triggers).map(t => [t.trigger_id, enumText(t.kind, LIFECYCLE), t.timing, t.idempotency])),
    `首次加载：${text(load?.initial_load_id)} · ${text(load?.strategy)}；责任方 ${text(load?.owner)}；范围 ${text(load?.data_scope)}；新鲜度 ${text(load?.freshness)}`, '',
    `权威状态：${text(truth?.authority)}；持久化 ${text(truth?.persistence)}；投影/缓存 ${text(refs(truth?.projections_and_caches))}；调和 ${text(truth?.reconciliation)}`,
    `状态责任方：${text(state?.ref)}；状态 ${text(refs(state?.states))}`, '', '写入与发布：', ''];
  const mutations = asRecords(flow.mutations); const publications = asRecords(flow.publications);
  if (mutations.length) lines.push(...table(['写入', '类型', '持久化', '发布', '恢复'], mutations.map(m => [m.mutation_id, m.kind, m.persistence_ref, m.publication_ref, m.recovery_ref])));
  else lines.push('未声明写入。', '');
  if (publications.length) {
    lines.push(...table(['发布', '时机', '快照/语义', '载荷'], publications.map(p => [p.publication_id, p.timing, declaredMeaning(p.snapshot ?? p.semantics), asRecord(p.payload) ? '见载荷字段表' : declaredMeaning(p.payload)])));
    for (const p of publications.filter(p => asRecord(p.payload))) {
      const payload = asRecord(p.payload)!;
      lines.push(`发布 ${text(p.publication_id)} 的载荷字段：`, '', ...table(['字段', '内容'], Object.entries(payload).filter(([key]) => !['provenance', 'source_ref', 'verification_refs'].includes(key)).map(([key, value]) => [key, declaredMeaning(value)])));
    }
  }
  lines.push('订阅与消费者：', '');
  const subscriptions = asRecords(flow.subscriptions);
  if (subscriptions.length) lines.push(...table(['订阅', '发布', '消费者', '建立/解除', '快照/重放', '清理', '顺序'], subscriptions.map(s => [s.subscription_id, s.publication_ref ?? '—', s.consumer_ref, `${prose(s.attach)} / ${prose(s.detach)}`, s.replay_or_snapshot, s.cleanup, s.ordering])));
  else lines.push('未声明订阅。', '');
  lines.push(...table(['消费者', '首次加载', '更新', '消费语义', '处理'], asRecords(flow.consumers).map(c => [c.consumer_id, c.initial_load_ref, c.update_ref, declaredMeaning(c.consumption), c.handling === undefined ? undefined : declaredMeaning(c.handling)])),
    `失败与恢复：${text(recovery?.recovery_id)}`, '',
    ...table(['恢复关切', '处理'], [['策略', recovery?.strategy], ['失败处理', recovery?.handling], ['重试', recovery?.retry], ['持久化失败', recovery?.persistence_failure], ['订阅失败', recovery?.subscription_failure], ['进程重建', recovery?.process_recreation]].filter(([, value]) => value !== undefined).map(([label, value]) => [label, declaredMeaning(value)])),
    '生命周期：', '', ...explainedTable(['场景', '覆盖裁决', '依据'], Object.entries(asRecord(flow.lifecycle_coverage) ?? {}).map(([name, item]) => [enumText(name, LIFECYCLE), enumText(asRecord(item)?.status, DISPOSITIONS), refs(asRecord(item)?.evidence_refs)]), ['覆盖裁决', '依据']),
    `验证关注：${acceptanceLinks(flow.verification_refs)}`, '');
  return lines;
}

function renderSequenceGraph(graph: BlueprintRecord, blueprint: BlueprintRecord, issues: BlueprintIssue[]): string[] {
  if (issues.length) return [`时序图 ${text(graph.graph_id)} 无效，未展示（非阻断）：`, '', ...issues.map(i => `- ${text(i.message)}`), ''];
  const result = asRecords(blueprint.derived_results).find(row => row.result_id === graph.graph_id);
  if (!result) return [`时序图 ${text(graph.graph_id)} 未记录对应派生结果，请由设计责任方重建。`, ''];
  const freshness = evaluateDerivedConclusionFreshness(result, blueprint);
  if (!freshness.current) return [`时序图 ${text(graph.graph_id)} 已过期，请由设计责任方重建：${text(freshness.reasons.length ? freshness.reasons : ['状态不是 current'])}。`, ''];
  return [`完整调用时序：${text(graph.label ?? graph.graph_id)}`, '', '```mermaid', String(graph.content).trimEnd(), '```', ''];
}

function renderReviewGraph(graph: BlueprintRecord, blueprint: BlueprintRecord, issues: BlueprintIssue[]): string[] {
  if (/^\s*sequenceDiagram\b/.test(String(graph.content))) return renderSequenceGraph(graph, blueprint, issues);
  if (issues.length) return [`结构图 ${text(graph.graph_id)} 无效，未展示${issues.every(issue => issue.severity === 'WARN') ? '（非阻断）' : ''}：`, '', ...issues.map(issue => `- ${text(issue.message)}`), ''];
  return [`结构图：${text(graph.label ?? graph.graph_id)}`, '', '```mermaid', String(graph.content).trimEnd(), '```', ''];
}

function renderPlacedGraph(graph: BlueprintRecord, blueprint: BlueprintRecord, shown: Set<string>, issues: BlueprintIssue[]): string[] {
  const address = `graph:${graph.graph_id}`;
  if (shown.has(String(graph.graph_id))) return [`相关图：${designLink(address, String(graph.label ?? graph.graph_id))}。`, ''];
  shown.add(String(graph.graph_id));
  return [anchor(address), ...renderReviewGraph(graph, blueprint, issues)];
}

interface ModelGroup { model: BlueprintRecord; sources: ReviewContent[] }
function sameDtoFields(dto: BlueprintRecord, candidate: BlueprintRecord): boolean {
  const fields = asRecords(dto.fields); const modelFields = asRecords(candidate.fields);
  return fields.length > 0 && fields.length === modelFields.length && fields.every((field, i) => {
    const model = modelFields[i];
    return field.field_id === model.name && field.type === model.type && projectionContentEqual(field.semantics, model.description)
      && ['constraints', 'validation'].every(key => projectionContentEqual(field[key], model[key]));
  });
}
function sourceLine(value: unknown, sourceRootRelative: string): string[] {
  if (value === undefined) return [];
  if (typeof value !== 'string') return [`来源：${text(value)}`];
  const url = encodeURI(/^[a-z]+:\/\//i.test(value) ? value : `${sourceRootRelative ? `${sourceRootRelative}/` : ''}${value}`).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return [`来源：[${text(value.slice(value.lastIndexOf('/') + 1))}](${url})`];
}
function renderContract(contract: BlueprintRecord, acceptanceLinks: (value: unknown) => string, sourceRootRelative = '', models: ModelGroup[] = []): string[] {
  const operation = asRecord(contract.operation);
  const lines = [anchor(`contract:${contract.contract_id}`), `#### ${text(contract.label ?? contract.name ?? contract.contract_id)}`, '',
    `操作：${text(operation?.operation_id)} · ${text(operation?.version)} · ${text(enumText(operation?.direction, { client_to_local_rdb: '客户端到本地数据库' }))}；责任方 ${text(contract.owner)}；需要方 ${text(contract.needed_by)}`, ''];
  const shown: { dto: BlueprintRecord; address: string }[] = [];
  for (const [key, title] of [['request_dto', '请求'], ['response_dto', '响应']] as const) {
    const dto = asRecord(contract[key]);
    if (!dto) continue;
    const dtoAddress = `dto:${contract.contract_id}/${key}`;
    const candidates = models.filter(group => group.model.name === dto.dto_id && sameDtoFields(dto, group.model));
    const model = candidates.length === 1 ? candidates[0] : undefined;
    const previous = shown.find(entry => sameDtoFields(dto, { fields: asRecords(entry.dto.fields).map(f => ({ ...f, name: f.field_id, description: f.semantics })) }));
    lines.push(anchor(dtoAddress), `**${title} DTO：${text(dto.dto_id)}**`, '', ...sourceLine(dto.source_ref, sourceRootRelative), ...(dto.verification_refs === undefined ? [] : [`验证引用：${acceptanceLinks(dto.verification_refs)}`]), '');
    if (model || previous) {
      const address = model ? `model:${model.sources[0].address}/${model.model.name}` : previous!.address;
      lines.push(`共同字段、类型与语义见 ${designLink(address, String(model?.model.name ?? previous!.dto.dto_id))}；必需与可空是独立声明，以下保留本 DTO 的声明及来源。`, '');
      const fields = asRecords(dto.fields);
      lines.push(...explainedTable(['字段', '必需', '可空', '默认值', '来源', '验证引用'], fields.map(f => [f.field_id, booleanText(f.required), booleanText(f.nullable), f.default, f.source_ref, f.verification_refs === undefined ? undefined : acceptanceLinks(f.verification_refs)]), ['必需', '可空']));
    } else lines.push(...table(['字段', '类型', '必需', '可空', '语义', '默认值', '约束', '来源', '验证引用'], asRecords(dto.fields).map(f => [f.field_id, f.type, booleanText(f.required), booleanText(f.nullable), f.semantics, f.default, declaredMeaning(f.constraints), f.source_ref, f.verification_refs === undefined ? undefined : acceptanceLinks(f.verification_refs)])));
    shown.push({ dto, address: dtoAddress });
  }
  const mappings = asRecords(contract.mappings);
  if (mappings.length) lines.push('映射：', '', ...table(['映射', '类型', '源字段', '目标字段', '规则'], mappings.map(m => [m.mapping_id, enumText(m.kind, { direct: '直接映射', derivation: '推导映射', rename: '重命名' }), refs(m.source_fields), m.target_field, m.rule])));
  for (const [key, title, collection] of [['errors', '错误', 'items'], ['idempotency', '幂等', ''], ['nfr', '非功能要求', 'requirements']] as const) {
    const value = asRecord(contract[key]);
    lines.push(`${title}：${text(collection ? contractMeaning(contract[key], collection) : meaning(contract[key]))}`);
    if (typeof value?.source_ref === 'string') {
      const ref = value.source_ref; const url = encodeURI(/^[a-z]+:\/\//i.test(ref) ? ref : `${sourceRootRelative ? `${sourceRootRelative}/` : ''}${ref}`).replace(/\(/g, '%28').replace(/\)/g, '%29');
      lines.push(`来源：[${text(ref.slice(ref.lastIndexOf('/') + 1))}](${url})`);
    } else if (value?.source_ref !== undefined) lines.push(`来源：${text(value.source_ref)}`);
    if (value?.verification_refs !== undefined) lines.push(`验证：${acceptanceLinks(value.verification_refs)}`);
  }
  lines.push('');
  return lines;
}

const APP_QUESTIONS: Record<string, string> = {
  module_boundaries: '模块边界是什么？', capability_seams: '哪些能力通过接缝消费？', feature_flags: '功能开关如何影响本切片？',
  data_producers_consumers: '谁生产、谁消费数据？', lifecycle_triggers: '生命周期有哪些触发？', state_owners: '谁拥有状态？',
  initialization: '如何初始化？', publication_subscription: '如何发布与订阅？', ui_refresh: '界面如何刷新？', process_recovery: '进程如何恢复？',
};

interface ReviewContent { address: string; field: 'acceptance' | 'contracts' | 'use_cases'; value: BlueprintRecord }
function acceptanceLinksFor(content: Pick<ReviewContent, 'address' | 'value'>[], blueprint: BlueprintRecord): (value: unknown) => string {
  const index = stableAddressIndex(blueprint);
  return value => prose(value).replace(/(?:acceptance:)?\b((?:AC|BD|NFR)-?\d+)\b/g, (raw, id: string) => {
    const matches = content.flatMap(item => ['criteria', 'boundaries', 'performance'].flatMap(key => asRecords(item.value[key]).filter(row => row.id === id).map(() => ({ address: item.address, key }))));
    return matches.map(match => designLink(`acceptance:${match.address}/${match.key}:${id}`, matches.length > 1 ? `${id}（${String(index.get(match.address)?.label ?? match.address.split(':').pop())}）` : id)).join('、') || raw;
  });
}
function readReviewContent(blueprint: BlueprintRecord): { content: ReviewContent[]; diagnostics: string[] } {
  const content: ReviewContent[] = []; const diagnostics: string[] = [];
  const seen = new Map<string, { address: string; row: unknown }>();
  for (const [address, target] of stableAddressIndex(blueprint)) {
    if (address.startsWith('blueprint:')) continue; // 根 contracts 是外部接口集合，不是目标 typed contracts。
    for (const field of ['acceptance', 'contracts', 'use_cases'] as const) {
      if (target[field] === undefined) continue;
      const node = /^view:([^/]+)\/(node|flow):(.+)$/.exec(address); const other = /^(view|relation|decision|contract):(.+)$/.exec(address);
      if (!node && !other) continue;
      const ref = { artifact: 'component-blueprint@1', component_id: blueprint.component_id, blueprint_id: blueprint.blueprint_id,
        target: node ? { kind: node[2], view_id: node[1], id: node[3] } : { kind: other![1], id: other![2] } } as ComponentBlueprintRef;
      try {
        const value = mergeBlueprintTargetContent([{ ref, target }], field)!;
        const keys = field === 'acceptance' ? ['criteria', 'boundaries', 'performance'] : field === 'contracts' ? ['modules', 'data_models', 'interfaces', 'components', 'files', 'state_management', 'integration_points'] : ['use_cases'];
        const invalid = keys.filter(key => value[key] !== undefined && (!Array.isArray(value[key]) || (value[key] as unknown[]).some(row => key === 'files' ? typeof row !== 'string' : !asRecord(row))));
        if (invalid.length) { diagnostics.push(`${address}.${field} 无效：${invalid.join('、')} 应为数组。`); continue; }
        const checkRows = (rows: unknown, path: string): void => {
          if (rows !== undefined && (!Array.isArray(rows) || rows.some(row => !asRecord(row)))) diagnostics.push(`${address}.${field}.${path} 无效：应为对象数组，未能表达坏条目。`);
        };
        for (const model of asRecords(value.data_models)) { checkRows(model.fields, `data_models[${prose(model.name)}].fields`); checkRows(model.values, `data_models[${prose(model.name)}].values`); }
        for (const api of asRecords(value.interfaces)) { checkRows(api.methods, `interfaces[${prose(api.class)}].methods`); for (const method of asRecords(api.methods)) checkRows(method.params, `interfaces[${prose(api.class)}].methods[${prose(method.name)}].params`); }
        for (const uc of asRecords(value.use_cases)) for (const key of ['branches', 'ui_bindings', 'data_boundaries']) checkRows(uc[key], `use_cases[${prose(uc.id)}].${key}`);
        content.push({ address, field, value });
        for (const key of keys.filter(key => key !== 'files')) for (const row of Array.isArray(value[key]) ? value[key] as unknown[] : []) {
          const id = projectionRowIdentity(row); if (!id) continue;
          const location = `${address}.${field}.${key}`; const scope = `${field}.${key}:${id}`; const previous = seen.get(scope);
          if (previous && !projectionContentEqual(previous.row, row)) diagnostics.push(`同标识内容不一致：${prose(asRecord(row)?.id ?? asRecord(row)?.name ?? asRecord(row)?.class ?? asRecord(row)?.data)}；${previous.address} ↔ ${location}。是否造成 CU 合并冲突取决于 design_refs。`);
          else if (!previous) seen.set(scope, { address: location, row });
        }
      } catch (error) { diagnostics.push(`${address}.${field} 无效：${error instanceof BlueprintContentError ? error.code : '无法解析'} · ${(error as Error).message}`); }
    }
  }
  return { content, diagnostics };
}
function renderView(view: BlueprintRecord | undefined, blueprint: BlueprintRecord, display: BlueprintGraphDisplayInspection, shownGraphs: Set<string>): string[] {
  if (!view) return ['该视图未记录。', ''];
  const nodes = asRecords(view.nodes);
  const lines = [anchor(`view:${view.view_id}`), text(view.purpose), '',
    ...table(['适用性', '本次影响', '当前', '目标', '变化/依据'], [[enumText(view.applicability, APPLICABILITY), enumText(view.evolution_impact, IMPACT), meaning(view.current_state), meaning(view.target_state), view.applicability === 'not_applicable' ? refs(asRecord(view.applicability_evidence)?.evidence_refs) : view.evolution_impact === 'verified_unchanged' ? refs(asRecord(view.unchanged_evidence)?.evidence_refs) : meaning(view.delta)]]),
    nodes.map(node => anchor(`view:${view.view_id}/node:${node.node_id}`)).join('')];
  if (!display.viewGraphs.has(String(view.view_id))) return [...lines, view.applicability === 'not_applicable'
    ? '该视图不适用；保留上述依据，不能随单次需求自行切换适用性。'
    : `核实未变：${text(asRecord(view.unchanged_evidence)?.current_state_ref)}。`, ''];
  if (nodes.length) lines.push(...explainedTable(['设计对象', '模块/责任方', '当前', '目标', '依据'], nodes.map(n => [n.label ?? n.name ?? n.node_id, `${prose(n.module ?? '—')} / ${prose(n.owner)}`, meaning(n.current_state), meaning(n.target_state), refs(n.design_basis_refs)]), ['依据']));
  {
    const declared = display.viewGraphs.get(String(view.view_id)) ?? [];
    const graphs = declared.length ? declared.filter(g => !shownGraphs.has(String(g.graph_id))) : [generateMermaidViewGraph(blueprint, String(view.view_id)) as unknown as BlueprintRecord];
    for (const g of graphs) {
      const issues = display.graphIssues.get(g) ?? validateGeneratedBlueprintGraphs({ ...blueprint, generated_graphs: [g] });
      if (issues.length) lines.push('结构图无效，未展示：', '', ...issues.map(i => `- ${text(i.message)}`), '');
      else if (asStrings(g.relation_refs).length) lines.push('```mermaid', String(g.content).trimEnd(), '```', '');
    }
  }
  return lines;
}
function renderModels(value: BlueprintRecord): string[] {
  const lines: string[] = [];
  for (const model of asRecords(value.data_models)) {
    lines.push(`#### ${text(model.name)} · ${text(enumText(model.kind, KINDS))}`, '', `模块 ${text(model.module)}；文件 ${text(model.file)}`, '',
      ...table(['字段', '类型', '必需', '可空', '默认值', '约束/说明', '补充约束', '验证引用', '来源'], asRecords(model.fields).map(f => [f.name, f.type, booleanText(f.required), booleanText(f.nullable), f.default ?? '—',
        f.description === undefined ? '未记录' : typeof f.description === 'string' ? f.description : '未能表达（description 非字符串）',
        f.constraints === undefined ? undefined : declaredMeaning(f.constraints), f.verification_refs,
        f.source_ref === undefined ? '未记录' : typeof f.source_ref === 'string' ? f.source_ref : '未能表达（source_ref 非字符串）'])));
    if (asRecords(model.values).length) lines.push('枚举：', '', ...table(['名称', '值'], asRecords(model.values).map(v => [v.name, v.value])));
    if (asRecords(model.computed_properties).length) lines.push('计算属性：', '', ...table(['属性', '类型', '说明'], asRecords(model.computed_properties).map(v => [v.name, v.type, v.description])));
  }
  return lines;
}
function renderUseCases(value: BlueprintRecord, acceptanceLinks: (value: unknown) => string, address: string): string[] {
  const lines: string[] = [];
  const normalized = normalizeUseCasePortCalls(value);
  if (normalized.issues.length) lines.push('用例调用声明无效：', '', ...normalized.issues.map(issue => `- ${text(issue)}`), '');
  for (const uc of asRecords(normalized.value.use_cases)) {
    lines.push(`#### 用例 ${text(uc.id)}`, '', text(uc.description), '', `编排入口：${text(uc.coordinator)}；文件 ${text(uc.coordinator_file ?? '未记录')}`, '',
      ...table(['状态集合'], asStrings(asRecord(uc.state_model)?.phases).map(phase => [phase])));
    try {
      const graph = generateMermaidPhaseGraph(uc); const invalid = parseMermaidSubset(graph.content);
      if (invalid) lines.push(`阶段图无效，未展示：${text(invalid)}`, '');
      else if (graph.edges.length) lines.push(`阶段流转（展示基准：${text(asRecords(uc.branches)[0]?.id)}；基准已出现的边不标标签，其余边标分支，完整来源见下方分支表）：`, '', '```mermaid', graph.content.trimEnd(), '```', '');
      else lines.push('未声明阶段相邻流转；只列已有阶段。', '');
    } catch (error) { lines.push(`阶段图无效，未展示：${text((error as Error).message)}`, ''); }
    if (asRecords(asRecord(uc.state_model)?.fields).length) lines.push(...table(['状态字段', '类型'], asRecords(asRecord(uc.state_model)?.fields).map(f => [f.name, f.type])));
    if (asRecords(uc.ui_bindings).length) lines.push(`界面职责、动作、调用与订阅见 ${designLink(`ui:${address}/${uc.id}`, `用例 ${uc.id} 的交互表`)}。`, '');
    for (const boundary of asRecords(uc.data_boundaries)) lines.push(`数据边界：${text(boundary.name)} · ${text(boundary.type)} · ${text(boundary.kind)}`, '',
      ...table(['方法', '参数', '返回', '异步'], asRecords(boundary.methods).map(m => [m.name, refs(m.params), m.returns, booleanText(m.async)])));
    lines.push('主路径及分支去向：', '', ...table(['分支', '条件', '关联验收'], asRecords(uc.branches).map(b => [b.id, b.scenario, acceptanceLinks(b.linked_acceptance)])));
    for (const branch of asRecords(uc.branches)) lines.push(`**分支 ${text(branch.id)} 的行为与去向**`, '',
      ...table(['关切', '声明内容'], [['动作顺序', refs(branch.user_sequence)], ['阶段去向', refs(branch.expected_phase_seq)], ['端口调用', refs(branch.expected_port_calls)], ['预期状态', namedMeanings(branch.expected_state)], ['不得调用', refs(branch.not_called)]]));
    const conflicted = asRecords(uc.branches).filter(b => b.expected_boundary_calls !== undefined);
    if (conflicted.length) lines.push(...table(['分支', '冲突的旧调用声明'], conflicted.map(b => [b.id, refs(b.expected_boundary_calls)])));
    const details = asRecords(uc.branches).filter(b => b.cloud_stubs || b.local_stubs || b.local_expect);
    if (details.length) lines.push(...explainedTable(['分支', '外部桩', '本地桩', '本地预期'], details.map(b => [b.id, namedMeanings(b.cloud_stubs), namedMeanings(b.local_stubs), refs(b.local_expect)]), ['外部桩']));
  }
  return lines;
}
function renderAcceptance(value: BlueprintRecord, inputs: BlueprintReviewInputs, address: string): string[] {
  const owners = new Set(ownersForAddress(directReviewUnits(inputs), address));
  const predicates = (id: unknown): string => inputs.units.filter(u => !u.retiredBy && owners.has(u.id)).flatMap(u => asRecords(u.unit?.target_predicates).filter(p => asStrings(p.verification_refs).flatMap(extractAcceptanceIdRefs).includes(String(id).toUpperCase())).map(p => `${u.id}/${p.predicate_id}`)).join('；') || '未登记直接谓词引用';
  const lines = [
    ...['criteria', 'boundaries', 'performance'].flatMap(key => asRecords(value[key]).map(row => anchor(`acceptance:${address}/${key}:${row.id}`))),
    '功能验收：', '', ...table(['AC', '优先级/功能', '验收标准', '验证步骤（按序）', '预期', '分层/关注点', '已有流程关联', 'CU 谓词直接引用'],
    asRecords(value.criteria).map(c => [c.id, `${prose(c.priority)} / ${prose(c.prd_function ?? '—')}`, c.description, asStrings(c.verification_steps).map((s, i) => `${i + 1}. ${s}`).join('\n'), c.expected_result,
      acceptanceFocus(c), c.linked_flow ? `${c.linked_flow}/${prose(c.linked_branch ?? '—')}` : '未声明；无 UI 依据时由 spec 不冲突补充', predicates(c.id)]))];
  if (asRecords(value.boundaries).length) lines.push('边界验收：', '', ...table(['BD', '优先级', '异常场景', '处理', '可见结果/预期', '分层/关注点', 'CU 谓词直接引用'],
    asRecords(value.boundaries).map(b => [b.id, b.priority, b.scenario, b.handling, b.expected_behavior, acceptanceFocus(b), predicates(b.id)])));
  if (asRecords(value.performance).length) lines.push('质量阈值：', '', ...table(['NFR', '指标', '阈值', '单位', '说明', '分层/关注点'],
    asRecords(value.performance).map(p => [p.id, p.metric, p.threshold, p.unit, p.description, acceptanceFocus(p)])));
  return lines;
}

function registeredImages(blueprint: BlueprintRecord): string[] {
  const images = new Set<string>();
  const walk = (value: unknown, source = false): void => {
    if (typeof value === 'string') { if (source && /\.(png|jpe?g|gif|webp)(?:#.*)?$/i.test(value)) images.add(value.split('#')[0]); return; }
    if (Array.isArray(value)) { value.forEach(item => walk(item, source)); return; }
    const record = asRecord(value);
    if (record) for (const [key, entry] of Object.entries(record)) walk(entry, ['source_ref', 'source_refs', 'evidence_refs'].includes(key));
  };
  walk(blueprint); return [...images].sort();
}

/** 可见标签与可追溯位置分开；缺项按当前小节集中，不改变原诊断。 */
function finishPresentation(lines: string[], blueprint: BlueprintRecord): string {
  const index = stableAddressIndex(blueprint);
  const viewNames: Record<string, string> = { logical: '逻辑视图', runtime: '运行时视图', development: '开发视图', deployment: '部署视图', scenarios: '场景视图' };
  const labels = new Map([...index].map(([address, row]) => [address, String(row.label ?? row.name ?? (address.startsWith('view:') && !address.includes('/') ? viewNames[String(row.view_id)] : undefined) ?? address.split(':').pop())]));
  for (const view of asRecords(blueprint.design_views)) for (const flow of asRecords(view.runtime_data_flows)) {
    const local = (prefix: string, row: BlueprintRecord | undefined, key: string) => { if (typeof row?.[key] === 'string') labels.set(`${prefix}:${row[key]}`, String(row.label ?? row.name ?? row[key])); };
    local('initial-load', asRecord(flow.initial_load), 'initial_load_id'); local('recovery', asRecord(flow.failure_recovery), 'recovery_id');
    for (const row of asRecords(flow.publications)) local('publication', row, 'publication_id');
    for (const row of asRecords(flow.consumers)) local('consumer', row, 'consumer_id');
  }
  for (const row of currentScopeItems(blueprint)) labels.set(`requirement:${row.item_id}`, row.item_id);
  for (const row of asRecords(blueprint.data_domains)) if (typeof row.data_domain_id === 'string') labels.set(row.data_domain_id.startsWith('data-domain:') ? row.data_domain_id : `data-domain:${row.data_domain_id}`, String(row.label ?? row.name ?? row.data_domain_id.replace(/^data-domain:/, '')));
  const anchorLabels = new Map([...labels].map(([address, label]) => [blueprintReviewAnchor(address), label]));
  const addresses = [...labels.keys()].sort((a, b) => b.length - a.length);
  const expression = new RegExp(addresses.map(address => address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const output: string[] = []; let appendix = false; let fence: { marker: string; length: number } | undefined; const missing = new Set<string>(); const unregistered = new Set<string>();
  const flush = () => { if (missing.size) output.push(`未记录：${[...missing].join('；')}。`, ''); missing.clear(); };
  const sourceLines = lines.flatMap(line => line.split(/\r?\n/));
  const bodyStart = sourceLines[0] === '---' ? sourceLines.indexOf('---', 1) + 1 : 0;
  for (const [lineIndex, original] of sourceLines.entries()) {
    let line = original;
    if (lineIndex < bodyStart) { output.push(line); continue; }
    if (!fence && (line.startsWith('内容承载于：') || line.startsWith('<a id="'))) flush();
    if (!fence && /^#{2,6} /.test(line)) { flush(); if (line.startsWith('## 技术与追溯参考') || line.startsWith('## 附录')) appendix = true; }
    const marker = /^<!-- review-missing:(.+) -->$/.exec(line);
    if (!fence && marker) { marker[1].split('、').forEach(value => missing.add(value)); continue; }
    const codeFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\\`/g, '`'));
    const inCode = Boolean(fence || codeFence);
    if (codeFence) {
      if (!fence) {
        if (codeFence[1][0] === '~' || !codeFence[2].includes('`')) fence = { marker: codeFence[1][0], length: codeFence[1].length };
      }
      else if (codeFence[1][0] === fence.marker && codeFence[1].length >= fence.length && !codeFence[2].trim()) fence = undefined;
    }
    if (!appendix && !inCode && !line.startsWith('<a ') && !line.startsWith('<!--') && !line.startsWith('---') && !/^( {4}|\t)/.test(line)) {
      // 只折叠普通叙述中的中文空格；代码、链接与 URL 的内容保持原样。
      const parts = line.split(/(\\?`+[^`]*?\\?`+|\\?\[[^\]\n]*\\?\]\([^)]*\)|https?:\/\/[^\s<>]+)/g);
      line = parts.map((part, i) => {
        if (i % 2) return part;
        const folded = part.replace(/([，。；：！？、（）【】《》〈〉「」『』“”‘’〔〕…]) +(?=\S)/g, '$1').replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, '$1');
        return i < parts.length - 1 && !/^https?:\/\//.test(parts[i + 1]) ? folded.replace(/([，。；：！？、（）【】《》〈〉「」『』“”‘’〔〕…]) +$/g, '$1') : folded;
      }).join('');
      line = line.split(/(\[[^\]\n]*\]\([^)]*\)|<a id="[^"]+"><\/a>)/g).map(part => {
        const link = /^\[([^\]\n]*)\]\(#(design-[0-9a-f]+)\)$/.exec(part);
        if (link) return anchorLabels.has(link[2]) && !/[\u3400-\u9fff]/.test(link[1]) ? `[${cell(anchorLabels.get(link[2]))}](#${link[2]})` : part;
        if (/^\[.*\]\(.*\)$/.test(part) || part.startsWith('<a ')) return part;
        return part.replace(expression, address => {
          if (index.has(address)) return designLink(address, labels.get(address));
          unregistered.add(address); return text(labels.get(address));
        }).split(/(\[[^\]\n]*\]\([^)]*\))/g).map(fragment => /^\[.*\]\(.*\)$/.test(fragment) ? fragment : fragment.replace(/\b(?:view:[A-Za-z0-9_-]+(?:\/(?:node|flow):[A-Za-z0-9_.-]+)?|(?:contract|relation|decision|gap|publication|recovery|initial-load|requirement|consumer|data-domain):[A-Za-z0-9_.-]+)/g, address => {
          unregistered.add(address); return /^(?:publication|recovery|initial-load|requirement|consumer|data-domain):/.test(address) ? text(address.split(':').pop()) : `${text(address.split(':').pop())}（地址未登记，见附录）`;
        })).join('');
      }).join('');
    }
    if (appendix && !inCode) line = line.replace(/\[([^\]\n]*)\]\(#(design-[0-9a-f]+)\)/g, (original, label: string, id: string) => anchorLabels.has(id) && !/[\u3400-\u9fff]/.test(label) ? `[${cell(anchorLabels.get(id))}](#${id})` : original);
    output.push(line);
  }
  flush();
  if (unregistered.size) output.push('#### 正文引用地址', '', ...[...unregistered].map(address => `- ${text(address)}：${text(labels.get(address) ?? address.split(':').pop())}`), '');
  return output.join('\n');
}

/** 路径只来自 contracts.files；折叠单子目录不改变可还原的写集。 */
function renderFileTree(files: string[]): string[] {
  interface Directory { children: Map<string, Directory>; file?: string }
  const root: Directory = { children: new Map() };
  for (const file of files) {
    let node = root;
    for (const part of file.split('/')) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part)!;
    }
    node.file = file;
  }
  const lines: string[] = [];
  const walk = (node: Directory, prefix: string) => {
    const entries = [...node.children].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    entries.forEach(([initialName, initialNode], index) => {
      let name = initialName; let child = initialNode;
      while (!child.file && child.children.size === 1) {
        const [nextName, next] = [...child.children][0];
        if (next.file) break;
        name += `/${nextName}`; child = next;
      }
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${name}${child.file ? '' : '/'}`);
      walk(child, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(root, '');
  return ['```text', ...lines, '```', ''];
}

function readerGuideSourceAnchor(index: number): string { return `reader-guide-source-${index + 1}`; }

/** 来源限定到承载目标与条目，不能把同名 AC 关联到其它目标。 */
function readerSourceLinks(blueprint: BlueprintRecord, pointer: string): Array<{ address?: string; label: string; id?: string }> {
  const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let address: string | undefined; let offset = 0;
  if (parts[0] === 'design_views') {
    const view = asRecords(blueprint.design_views)[Number(parts[1])];
    if (view) { address = `view:${view.view_id}`; offset = 2;
      if (parts[2] === 'nodes' || parts[2] === 'runtime_data_flows') {
        const row = asRecords(view[parts[2]])[Number(parts[3])];
        if (row) { address += parts[2] === 'nodes' ? `/node:${row.node_id}` : `/flow:${row.flow_id}`; offset = 4; }
      }
    }
  } else if (parts[0] === 'contracts') {
    const contract = asRecords(blueprint.contracts)[Number(parts[1])];
    if (contract) { address = `contract:${contract.contract_id}`; offset = 2; }
  } else if (parts[0] === 'decisions_and_gaps' && parts[1] === 'decisions') {
    const decision = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)[Number(parts[2])];
    if (decision) { address = `decision:${decision.decision_id}`; offset = 3; }
  }
  const target = address ? stableAddressIndex(blueprint).get(address) : undefined;
  if (address && parts[offset] === 'acceptance') {
    const keys = ['criteria', 'boundaries', 'performance'];
    const selectedKeys = parts.length === offset + 1 ? keys : keys.filter(key => key === parts[offset + 1]);
    const entries = selectedKeys.flatMap(key => {
      const rows = asRecord(target?.acceptance)?.[key];
      const selected = !Array.isArray(rows) ? [] : parts.length <= offset + 2 ? rows : [rows[Number(parts[offset + 2])]];
      return selected.map(asRecord).filter((entry): entry is BlueprintRecord => Boolean(entry && nonEmptyString(entry.id))).map(entry => ({ address: `acceptance:${address}/${key}:${entry.id}`, id: String(entry.id), label: `${entry.id}（${target?.label ?? target?.name ?? address!.split(':').pop()}）` }));
    });
    if (entries.length) return entries;
  }
  return [{ address, label: String(target?.label ?? target?.name ?? '设计来源') }];
}

function renderReaderBody(blueprint: BlueprintRecord, inputs: BlueprintReviewInputs, content: ReviewContent[], shownGraphs: Set<string>, display: BlueprintGraphDisplayInspection): string[] {
  const guide = display.guide;
  const review = asRecord(blueprint.review_summary) ?? {};
  const views = asRecords(blueprint.design_views); const view = (id: string) => views.find(row => row.view_id === id);
  const typed = (field: ReviewContent['field']) => content.filter(row => row.field === field);
  const current = inputs.units.filter(unit => !unit.retiredBy);
  const flows = asRecords(view('runtime')?.runtime_data_flows);
  const images = registeredImages(blueprint); const shownImages = new Set<string>();
  const lines: string[] = [];
  const imageLines = (image: string): string[] => {
    if (shownImages.has(image)) return []; shownImages.add(image);
    const url = encodeURI(`${inputs.sourceRootRelative ? `${inputs.sourceRootRelative}/` : ''}${image}`).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return [anchor(`image:${image}`), `![${text(image.slice(image.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''))}](${url})`, ''];
  };
  const sourceImages = (value: unknown): string[] => {
    if (typeof value === 'string') return images.includes(value.split('#')[0]) ? [value.split('#')[0]] : [];
    if (Array.isArray(value)) return value.flatMap(sourceImages);
    return asRecord(value) ? Object.values(asRecord(value)!).flatMap(sourceImages) : [];
  };
  const graphLines = (graph: BlueprintRecord): string[] => renderPlacedGraph(graph, blueprint, shownGraphs, display.graphIssues.get(graph)!);
  const sections = [
    ['summary', '方案摘要'], ['background', '背景、目标与边界'], ['terms', '术语'], ['journey', '用户旅程与界面'],
    ['solution', '整体方案'], ['flows', '关键流程'], ['data', '数据与存储'], ['decisions', '关键取舍'],
    ['recovery', '失败与恢复'], ['quality', '质量与安全'], ['delivery', '施工与上线'], ['acceptance', '验收'], ['questions', '待补问题'],
  ] as const;
  const fallback = (section: string): string[] => {
    const out: string[] = []; const paragraph = (value: unknown, label?: string) => { if (!absent(value)) out.push(`${label ? `**${label}**：` : ''}${text(value)}`, ''); };
    if (section === 'summary') paragraph(review.summary);
    if (section === 'background') {
      paragraph(review.background); paragraph(review.problem, '当前问题'); paragraph(review.positioning, '方案定位');
      for (const goal of asRecords(review.goals)) {
        paragraph(goal.statement, '目标');
        if (Array.isArray(goal.success_measures)) out.push('**成功衡量**：', '', ...goal.success_measures.map(value => `- ${text(value)}`), '');
        else if (goal.success_measures !== undefined) paragraph(goal.success_measures, '成功衡量');
      }
      for (const [key, label] of [['in_scope', '本次范围'], ['non_goals', '不做什么']] as const) if (!absent(review[key])) out.push(`**${label}**`, '', ...(Array.isArray(review[key]) ? asStrings(review[key]).map(value => `- ${text(value)}`) : [text(review[key])]), '');
    }
    if (section === 'terms') for (const term of asRecords(asRecord(blueprint.discovery)?.facts).filter(f => String(f.subject).startsWith('term:'))) paragraph(asRecord(term.value)?.meaning, String(term.subject).slice(5));
    if (section === 'journey') for (const scenario of asRecords(view('scenarios')?.nodes)) {
      out.push(`### ${text(scenario.label ?? scenario.node_id)}`, '');
      for (const [i, step] of asRecords(scenario.journey_steps).entries()) out.push(`${i + 1}. ${text(step.user_action)}；${text(step.system_behavior)}`);
      out.push(''); for (const variant of asRecords(scenario.path_variants)) paragraph(variant.difference, prose(variant.user_type));
    }
    if (section === 'solution') { paragraph(view('logical')?.purpose); paragraph(view('logical')?.target_state); paragraph(view('development')?.target_state); }
    if (section === 'flows') for (const flow of flows) {
      out.push(`### ${text(flow.name ?? flow.flow_id)}`, '');
      if (flow.description !== undefined) paragraph(flow.description);
      const steps = asStrings(flow.ordered_steps); if (steps.length) out.push(...steps.map((step, i) => `${i + 1}. ${text(step)}`), '');
      else if (asRecords(flow.consumers).length) for (const consumer of asRecords(flow.consumers)) paragraph(consumer.consumption, prose(consumer.consumer_id));
      for (const graph of display.flowGraphs.get(String(flow.flow_id)) ?? []) out.push(...graphLines(graph));
    }
    if (section === 'data') for (const domain of asRecords(blueprint.data_domains)) { paragraph(domain.usage, prose(domain.label ?? domain.name ?? domain.data_domain_id)); paragraph(domain.isolation, '隔离'); paragraph(domain.retention, '有效期'); paragraph(domain.cleanup, '清理'); paragraph(domain.security, '安全'); }
    if (section === 'decisions') for (const decision of asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)) {
      const alternatives = asRecords(decision.alternatives);
      out.push(anchor(`decision:${decision.decision_id}`), `### ${text(decisionTitle(decision, blueprint))}`, '',
        ...table(['关切', '结论'], [['选了什么', decisionConclusion(decision)], ['理由', decision.rationale]]), '被否方案：', '',
        ...(alternatives.length ? table(['方案', '被否理由/缺陷'], alternatives.map(a => [a.option,
          projectionContentEqual(a.rejected_reason, a.defect) ? a.rejected_reason : [a.rejected_reason, a.defect].filter(value => !absent(value)).map(value => prose(value)).join('\n')])) : ['未记录；不推测被否选择。', '']));
    }
    if (section === 'recovery') for (const flow of flows) {
      const recovery = asRecord(flow.failure_recovery); if (!recovery) continue;
      out.push(`### ${text(flow.name ?? flow.flow_id)}`, ''); for (const [key, value] of Object.entries(recovery).filter(([key]) => key !== 'recovery_id' && !PRESENTATION_METADATA.has(key))) paragraph(declaredMeaning(value), RECOVERY[key as keyof typeof RECOVERY] ?? key);
    }
    if (section === 'quality') for (const quality of asRecords(blueprint.quality_attributes)) paragraph(quality.requirement, prose(quality.category ?? quality.qa_id));
    if (section === 'acceptance') for (const item of typed('acceptance')) {
      const target = stableAddressIndex(blueprint).get(item.address); out.push(`### ${text(target?.label ?? target?.name ?? item.address.split(':').pop())}`, '');
      for (const [key, label] of [['criteria', '功能结果'], ['boundaries', '失败与边界'], ['performance', '质量要求']] as const) {
        const rows = asRecords(item.value[key]); if (rows.length) out.push(`${label}：${rows.map(row => designLink(`acceptance:${item.address}/${key}:${row.id}`, String(row.id))).join('；')}。`, '');
      }
    }
    if (section === 'questions') {
      const assumedTerms = asRecords(asRecord(blueprint.discovery)?.facts).filter(fact => String(fact.subject).startsWith('term:') && asRecord(fact.provenance)?.extraction_method === 'headless_assumed');
      if (assumedTerms.length) out.push('### 术语假定', '', ...table(['术语', '当前假定解释', '确认情况'], assumedTerms.map(fact => [String(fact.subject).slice(5), asRecord(fact.value)?.meaning ?? fact.value, '作者自行假定，待确认'])), '完整术语与来源见[术语参考](#review-terms)。', '');
      if (review.must_review !== undefined) out.push('### 必须关注的评审问题', '', ...(Array.isArray(review.must_review) ? asStrings(review.must_review).map(question => `- ${text(question)}`) : [text(review.must_review)]), '');
      const gaps = asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps);
      if (gaps.length) out.push('### 缺口及当前状态', '', ...table(['问题', '状态', '责任方', '解除条件'], gaps.map(gap => [designLink(`gap:${gap.gap_id}`, String(gap.label ?? gap.gap_id)), absent(gap.status) ? '未记录状态' : enumText(gap.status, DISPOSITIONS), gap.owner, gap.unlock_condition])));
      if (out.length) out.push('');
    }
    return out;
  };
  for (const [index, [section, title]] of sections.entries()) {
    const authored = guide.sections.filter(item => item.section === section);
    const block: string[] = [];
    for (const item of authored) {
      const sources = item.resolvedSources.flatMap(source => readerSourceLinks(blueprint, source.pointer));
      const linkedProse = item.prose.split(/\r?\n/); let fence: { char: string; length: number } | undefined;
      for (const [i, line] of linkedProse.entries()) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (marker) { if (!fence) fence = { char: marker[1][0], length: marker[1].length }; else if (marker[1][0] === fence.char && marker[1].length >= fence.length) fence = undefined; continue; }
        if (fence) continue;
        linkedProse[i] = line.split(/(`+[^`]*`+|\[[^\]]*\]\([^)]*\))/g).map(part => /^`|^\[/.test(part) ? part : part.replace(/\b(?:AC|BD|NFR)-?\d+\b/g, id => {
          const matches = [...new Map(sources.filter(source => source.id === id && source.address).map(source => [source.address, source])).values()];
          return matches.length ? matches.map(source => designLink(source.address!, matches.length > 1 ? source.label : id)).join('、') : id;
        })).join('');
      }
      if (item.title && !(authored.length === 1 && item.title.trim() === title)) block.push(`### ${text(item.title)}`, '');
      block.push(...linkedProse, '');
      if (section === 'journey') for (const image of item.resolvedSources.flatMap(source => sourceImages(source.value))) block.push(...imageLines(image));
      block.push(`[设计依据](#${readerGuideSourceAnchor(guide.sections.indexOf(item))})`, '');
      for (const graph of display.sectionGraphs.get(item) ?? []) block.push(...graphLines(graph));
    }
    if (!authored.length || section === 'decisions' || section === 'questions') block.push(...fallback(section));
    if (section === 'journey') {
      const shownComponents = new Set<string>();
      if (!authored.length) for (const item of typed('contracts')) for (const component of asRecords(item.value.components).filter(row => ['page', 'component', 'dialog'].includes(String(row.kind)))) {
        const key = JSON.stringify([component.name, component.module, component.description]); if (shownComponents.has(key)) continue; shownComponents.add(key);
        block.push(`**${text(component.name)}**：${text(component.description)}`, '');
      }
      for (const image of images) block.push(...imageLines(image));
    }
    if (section === 'summary' && current.length) block.push('施工安排见[施工与上线](#delivery)。', '');
    if (section === 'recovery') for (const item of typed('acceptance').filter(item => asRecords(item.value.boundaries).length)) block.push(`边界验收：${asRecords(item.value.boundaries).map(boundary => designLink(`acceptance:${item.address}/boundaries:${boundary.id}`, String(boundary.id))).join('；')}。`, '');
    if (section === 'delivery') {
      if (!current.length && !inputs.sourceGaps.length) block.push('尚未拆分。', '');
      for (const item of current) {
        const cu = item.unit; block.push(`### ${text(item.id)}`, ''); if (!cu) { block.push('CU 无法解析，见参考中的来源缺口。', ''); continue; }
        block.push(text(cu.purpose), '', ...asRecords(cu.target_predicates).map(predicate => `- ${text(predicate.description)}`), '',
          `模块分工：${item.binding === 'pending' ? '待指针升版后显示' : item.modules?.map(text).join('；') || '未解析，见参考中的来源缺口'}。`, '');
        for (const touch of asRecords(cu.touches)) {
          let targetLabel = '未解析设计目标';
          if (item.binding === 'pending') targetLabel = '待指针升版的设计目标';
          else if (asRecord(touch.design_ref)?.target) {
            try { const address = blueprintRefAddress(touch.design_ref as never); const target = stableAddressIndex(blueprint).get(address); targetLabel = String(target?.label ?? target?.name ?? '设计目标'); } catch { /* 来源缺口仍由既有收集器报告。 */ }
          }
          block.push(`- ${text(targetLabel)}（责任方：${text(touch.owner)}）`);
        }
        block.push(''); const dependencies = asRecords(cu.requires);
        block.push(dependencies.length ? `依赖：${dependencies.map(row => `${text(row.from_change_unit_id)} 提供 ${text(row.provide_id)}`).join('；')}。` : '未声明上游依赖。', '', `安全中间态：${text(asRecord(cu.safe_intermediate_state)?.description)}`, '', `精确映射见 ${designLink(`unit:${item.id}`, '施工单元参考')}。`, '');
      }
      const files = [...new Set(typed('contracts').flatMap(item => asStrings(item.value.files)))];
      if (files.length) block.push('### 文件与目录', '', ...renderFileTree(files));
      block.push(...table(['上线顺序', '交付单元', '配套前提', '说明'], asRecords(view('deployment')?.rollout).map(row => [row.order, row.unit, refs(row.depends_on), row.note])));
      block.push(...table(['配套方', '协同关系'], asRecords(view('deployment')?.coordination).map(row => [row.counterpart, row.relation])));
    }
    const localIssues = guide.status === 'current' ? guide.diagnostics.filter(issue => {
      const match = /\.sections\[(\d+)\]/.exec(issue.path);
      const raw = asRecord(review.reader_guide)?.sections;
      return match && Array.isArray(raw) && asRecord(raw[Number(match[1])])?.section === section;
    }) : [];
    if (localIssues.length) block.push(...localIssues.map(issue => `> 说明提示（非阻断）：${text(issue.message)}`), '');
    if (block.some(line => line !== '')) lines.push(`<a id="${section}"></a>`, `## ${index + 1} ${title}`, '', ...block);
  }
  return lines;
}

/** 同一确定性编排生成问题导向正文和完整参考，只消费 canonical 蓝图与 CU。 */
export function renderBlueprintReviewMarkdown(blueprint: BlueprintRecord, artifactSha256: string,
  inputs: BlueprintReviewInputs = { units: [], sourceGaps: [], closureExists: false }): string {
  if (!nonEmptyString(blueprint.component_id) || !nonEmptyString(blueprint.blueprint_id)) throw new Error('生成评审投影前必须有 component_id 与 blueprint_id。');
  const review = asRecord(blueprint.review_summary) ?? {}; const admission = asRecord(review.admission); const views = asRecords(blueprint.design_views);
  const view = (id: string) => views.find(v => v.view_id === id); const current = inputs.units.filter(item => !item.retiredBy);
  const directUnits = directReviewUnits(inputs);
  const claimedBy = (address: string): string => ownersForAddress(directUnits, address).map(id => `${id}${current.find(item => item.id === id)?.binding === 'pending' ? '（待升版）' : ''}`).join('；') || '无 CU 直接引用';
  const { content, diagnostics } = readReviewContent(blueprint); const typed = (field: ReviewContent['field']) => content.filter(item => item.field === field);
  const acceptanceLinks = acceptanceLinksFor(typed('acceptance'), blueprint);
  let lastOrigin = '';
  const origin = (item: ReviewContent) => {
    const key = `${item.address}/${item.field}`;
    if (lastOrigin === key) return '';
    lastOrigin = key;
    return `内容承载于：${designLink(item.address)} · ${enumText(item.field, { contracts: '契约设计', acceptance: '验收设计', use_cases: '用例设计' })}`;
  };
  const graphDisplay = inspectBlueprintGraphDisplay(blueprint);
  const guide = graphDisplay.guide;
  const shownGraphs = new Set<string>();
  const lines: string[] = ['---', YAML.stringify({ derived_from: { artifact: blueprint.artifact, component_id: blueprint.component_id, blueprint_id: blueprint.blueprint_id,
    revision: blueprint.revision, source_fingerprint: blueprint.source_fingerprint, artifact_sha256: artifactSha256, change_units: reviewChangeUnitBindings(inputs) }, projection: BLUEPRINT_REVIEW_FORMAT }).trimEnd(), '---', '',
    `# ${text(review.title ?? blueprint.component_id)}`, '', anchor(`blueprint:${blueprint.blueprint_id}`)];
  if (guide.status !== 'current') lines.push(guide.status === 'missing' ? '> 尚未补写评审说明；正文按当前已有字段展示。' : '> 评审说明需更新；旧说明未作为当前方案展示，正文按当前已有字段展示。', '');
  lines.push('阅读入口：先阅读方案、旅程、关键流程和交付安排；类型、方法、完整分支与验收全文见同文档的[技术与追溯参考](#reference)。', '',
    ...renderReaderBody(blueprint, inputs, content, shownGraphs, graphDisplay), '<a id="reference"></a>', '## 技术与追溯参考', '',
    `部件 ${text(blueprint.component_id)} · 蓝图 ${text(blueprint.blueprint_id)} · revision ${text(blueprint.revision)} · 准入 ${text(enumText(admission?.status, DISPOSITIONS))}`, '',
    '本文根据 canonical 蓝图与当前施工单元确定性生成，文首保留精确来源身份。是否通过设计交接见 readiness；施工授权、映射与完成结论由原责任阶段确认。可选说明缺失或过期不改变这些结论。', '',
    '参考保留全部声明；不从名称、目录或数组顺序推断调用、依赖与未声明存储设计。正文的验收链接按来源目标与条目编号定位。', '',
    '### A 字段与类型', '', '<a id="review-summary-details"></a>', '#### 原概述与目标', '',
    ...table(['关切', '设计说明'], [['背景', review.background], ['问题', review.problem], ['本次改变', review.summary], ['整体定位', review.positioning], ['范围', meaning(review.in_scope)], ['不做什么', meaning(review.non_goals)]]),
    ...table(['目标', '目标说明', '成功衡量'], asRecords(review.goals).map(goal => [goal.goal_id, goal.statement, Array.isArray(goal.success_measures) ? goal.success_measures.map(value => acceptanceLinks(value)).join('\n') : acceptanceLinks(goal.success_measures)])));
  lines.push('<a id="review-terms"></a>');
  const facts = asRecords(asRecord(blueprint.discovery)?.facts); const terms = facts.filter(fact => String(fact.subject).startsWith('term:'));
  if (terms.length) lines.push('#### 完整术语', '', ...table(['术语', '含义', '模块', '易混项', '确认依据'], terms.map(fact => [String(fact.subject).slice(5), asRecord(fact.value)?.meaning, asRecord(fact.value)?.canonical_module, refs(asRecord(fact.value)?.easily_confused_with), asRecord(fact.provenance)?.source_ref])));
  const conventions = [...new Set(facts.filter(fact => asRecord(fact.provenance)?.source_kind === 'convention').map(fact => asRecord(fact.provenance)?.source_ref).filter(nonEmptyString))].sort();
  if (conventions.length) lines.push('#### 已采用的工程惯例', '', ...conventions.map(ref => `- ${text(ref.slice(ref.lastIndexOf('#') + 1))} — ${text(ref)}`), '');
  if (review.must_review !== undefined) lines.push('#### 必须关注的评审问题', '', '见正文[必须关注的评审问题](#questions)。', '');
  lines.push('#### 领域模型、字段与枚举', '');
  const modelGroups: ModelGroup[] = [];
  for (const item of typed('contracts')) for (const model of asRecords(item.value.data_models)) {
    const existing = modelGroups.find(group => projectionRowIdentity(group.model) === projectionRowIdentity(model) && projectionContentEqual(group.model, model));
    if (existing) existing.sources.push(item); else modelGroups.push({ model, sources: [item] });
  }
  for (const group of modelGroups) lines.push(...group.sources.map(item => anchor(`model:${item.address}/${group.model.name}`)), group.sources.map(origin).join('；'), '', ...renderModels({ data_models: [group.model] }));
  if (!typed('contracts').some(i => asRecords(i.value.data_models).length)) lines.push('设计期未写入领域模型，将由 plan 补；不从 DTO 推断另一份持久化模型。', '');
  const contracts = asRecords(blueprint.contracts); lines.push('### B 接口与存储明细', '', '#### 本部件实际消费或提供的操作与 DTO', '');
  for (const c of contracts) {
    const owners = new Set(ownersForAddress(directUnits, `contract:${c.contract_id}`));
    const inheritedAddresses = new Set(current.filter(unit => unit.binding === 'bound' && owners.has(unit.id)).flatMap(unit => unit.designAddresses));
    lines.push(...renderContract(c, acceptanceLinksFor(typed('acceptance').filter(item => inheritedAddresses.has(item.address)), blueprint), inputs.sourceRootRelative, modelGroups));
  }
  if (!contracts.length) lines.push('未记录接口契约。', '');
  const storageContracts = contracts.filter(c => c.table_schema !== undefined);
  if (storageContracts.length) lines.push('#### 持久化表结构', '', '表结构来自根级接口契约；领域模型见字段与类型，存储约束和编码保留此处原始声明。', '');
  for (const c of storageContracts) {
    const schema = asRecord(c.table_schema);
    if (!schema) { lines.push(`契约 ${text(c.contract_id)} 的 table_schema 未能表达（应为对象）。`, ''); continue; }
    lines.push(`##### ${text(c.label ?? c.name ?? c.contract_id)} 的存储设计`, '');
    if (schema.tables !== undefined) lines.push(...table(['存储关切', '声明'], [['数据库', schema.database], ['版本', schema.version], ['安全级别', schema.security_level], ['加密', booleanText(schema.encrypt)], ...(schema.upgrade === undefined ? [] : [['升级策略', schema.upgrade]]), ...(schema.source_ref === undefined ? [] : [['来源', schema.source_ref]])]));
    const tables = schema.tables === undefined ? [schema] : asRecords(schema.tables);
    if (schema.tables !== undefined && (!Array.isArray(schema.tables) || schema.tables.some(item => !asRecord(item)))) lines.push('tables 未能表达（应为对象数组）。', '');
    else if (!tables.length) lines.push('表：无。', '');
    for (const stored of tables) {
      lines.push(`###### 表 ${text(stored.table ?? stored.name ?? '未记录表名')}`, '',
        ...table(['表关切', '声明'], [['主键', stored.primary_key === undefined ? undefined : refs(stored.primary_key)], ['约束', stored.constraints === undefined ? undefined : declaredMeaning(stored.constraints)], ['升级策略', stored.upgrade], ['来源', stored.source_ref ?? schema.source_ref]]));
      if (!Array.isArray(stored.columns) || stored.columns.some(column => !asRecord(column))) lines.push('columns 未能表达（应为对象数组）。', '');
      else lines.push(...explainedTable(['列', '类型与声明约束', '来源字段', '编码', '显式默认值', '说明', '补充约束', '来源'], asRecords(stored.columns).map(column => [column.name, column.type, column.from, column.encoding ?? '—', column.default === undefined ? '—' : column.default, column.description, column.constraints === undefined ? '—' : declaredMeaning(column.constraints), column.source_ref ?? stored.source_ref ?? schema.source_ref]), ['来源']));
    }
  }
  for (const item of typed('contracts')) {
    const c = item.value;
    if (!['modules', 'files', 'interfaces', 'components', 'integration_points'].some(k => Array.isArray(c[k]) && (c[k] as unknown[]).length)) continue;
    lines.push(origin(item), '', ...table(['模块', 'DSL 分层', '形式', '变化', '目录'], asRecords(c.modules).map(m => [m.name, m.layer, enumText(m.format, KINDS), enumText(m.change_type, { add: '新增', modify: '修改', delete: '删除', new: '新增' }), m.package_path])));
    if (asRecord(c.module_dependencies)) {
      try {
        const graph = generateMermaidModuleDependencyGraph(c, item.address); const invalid = parseMermaidSubset(graph.content);
        if (invalid) lines.push(`模块依赖图无效，未展示：${text(invalid)}`, '');
        else if (graph.edges.length) lines.push('模块依赖：', '', '```mermaid', graph.content.trimEnd(), '```', '', ...graph.edges.map(edge => `<!-- module-edge-source:${edge.source} -->`));
        else lines.push('模块依赖：无。', '');
      } catch (error) { lines.push(`模块依赖图无效，未展示：${text((error as Error).message)}`, ''); }
    }
    for (const i of asRecords(c.interfaces)) lines.push(anchor(`interface:${item.address}/${i.class}`), `接口 ${text(i.class)} · ${text(i.module)} / ${text(i.layer)} · ${text(i.file)}`, '', ...table(['方法', '参数', '返回', '异步', '职责/失败语义'], asRecords(i.methods).map(m => [m.name, Array.isArray(m.params) ? m.params.length ? asRecords(m.params).map(p => `${p.name}: ${p.type}`).join('；') : '无' : m.params === undefined ? undefined : declaredMeaning(m.params), m.return, booleanText(m.async), m.description])));
    for (const cpt of asRecords(c.components)) {
      lines.push(`组件 ${text(cpt.name)} · ${text(enumText(cpt.kind, KINDS))} · ${text(cpt.file)}`, '', text(cpt.description), '', ...table(['状态/属性', '类型', '宿主声明'], [...asRecords(cpt.state), ...asRecords(cpt.props)].map(s => [s.name, s.type, s.decorator])));
      if (asRecords(cpt.events).length) lines.push(...table(['事件', '职责'], asRecords(cpt.events).map(e => [e.name, e.description])));
      if (asStrings(cpt.children).length) lines.push(`子组件：${text(refs(cpt.children))}`, '');
    }
    if (asRecords(c.integration_points).length) lines.push(...table(['消费模块', '提供模块', '需修改', '入口'], asRecords(c.integration_points).map(i => [i.consumer_module, i.provider_module, booleanText(i.requires_modification), i.entry_symbol])));
  }
  lines.push('#### 运行流与状态明细', '');
  for (const flow of asRecords(view('runtime')?.runtime_data_flows)) lines.push(...renderFlow(flow, 'runtime', acceptanceLinks));
  for (const graph of graphDisplay.sequenceGraphs.filter(graph => !shownGraphs.has(String(graph.graph_id)))) {
    lines.push(...renderPlacedGraph(graph, blueprint, shownGraphs, graphDisplay.graphIssues.get(graph)!));
  }
  for (const item of typed('contracts').filter(i => asRecords(i.value.state_management).length)) {
    lines.push(origin(item), '', '#### 施工状态与有序步骤', '');
    for (const s of asRecords(item.value.state_management)) {
      const sameRecovery = asRecords(view('runtime')?.runtime_data_flows).find(flow => s.failure_recovery !== undefined && projectionContentEqual(s.failure_recovery, flow.failure_recovery));
      lines.push(`状态 ${text(s.data)}；持有者 ${text(s.holder)}；作用域 ${text(s.scope)}；责任方 ${text(s.owner_ref)}`, '',
        ...table(['顺序', '行为'], asStrings(s.ordered_steps).map((step, i) => [i + 1, step])), `生命周期触发：${text(Array.isArray(s.lifecycle_triggers) ? asStrings(s.lifecycle_triggers).map(value => enumText(value, LIFECYCLE)) : refs(s.lifecycle_triggers))}`, '',
        ...(sameRecovery ? [`失败与恢复见 ${designLink(`view:runtime/flow:${sameRecovery.flow_id}`, String(sameRecovery.name ?? sameRecovery.flow_id))}。`, ''] : table(['失败/恢复场景', '处理'], Object.entries(asRecord(s.failure_recovery) ?? {}).map(([k, v]) => [enumText(k, RECOVERY), meaning(v)]))));
    }
  }
  lines.push('### C 完整验收', '');
  for (const item of typed('acceptance')) lines.push(origin(item), '', ...renderAcceptance(item.value, inputs, item.address));
  if (!typed('acceptance').length) lines.push('设计期未写入 acceptance，将由 spec 补；不能把 absence 或文档成功当作设计充分。', '');
  if (diagnostics.length) lines.push('#### 结构化内容无效或冲突', '', ...diagnostics.map(d => `- ${text(d)}`), '');
  lines.push('### D 全部用例分支与界面调用', '');
  for (const item of typed('use_cases')) for (const uc of asRecords(item.value.use_cases)) {
    if (!asRecords(uc.ui_bindings).length) continue;
    lines.push(anchor(`ui:${item.address}/${uc.id}`), `#### 用例 ${text(uc.id)} 的界面与交互`, '', origin(item), '',
      ...table(['界面/交互', '职责', '用户动作与调用', '订阅'], asRecords(uc.ui_bindings).map(binding => [binding.ui, enumText(binding.role, KINDS), asRecords(binding.user_actions).map(action => `${prose(action.trigger)} → ${prose(action.calls)}`).join('；') || '无', refs(binding.subscribes)])));
  }
  lines.push('#### 用例、数据边界与分支', '');
  for (const item of typed('use_cases')) lines.push(origin(item), '', ...renderUseCases(item.value, acceptanceLinks, item.address));
  if (!typed('use_cases').length) lines.push('设计期未写入 use_cases，将由 plan 按真实义务补充。', '');
  lines.push('### E 施工精确映射', '');
  const files = [...new Set(typed('contracts').flatMap(item => asStrings(item.value.files)))];
  if (files.length) {
    const sources = typed('contracts').filter(item => asStrings(item.value.files).length);
    lines.push('#### 声明文件（完整施工写集）', '', ...files.map(file => anchor(`file:${file}`)), ...sources.map(item => anchor(`writes:${item.address}`)));
    if (sources.length === 1) lines.push(`全表声明来源：${designLink(sources[0].address)}。`, '', ...table(['文件'], files.map(file => [file])));
    else lines.push(...table(['文件', '声明目标'], files.map(file => [file, sources.filter(item => asStrings(item.value.files).includes(file)).map(item => designLink(item.address)).join('；')])));
  }
  if (files.length) {
    lines.push('#### 文件用途与已声明关联', '');
    const associations = files.map(file => {
      const declarations: string[] = [];
      for (const item of typed('contracts')) {
        for (const component of asRecords(item.value.components).filter(row => row.file === file && !absent(row.description))) declarations.push(prose(component.description));
        for (const api of asRecords(item.value.interfaces).filter(row => row.file === file)) declarations.push(`接口：${designLink(`interface:${item.address}/${api.class}`, String(api.class))}`);
        for (const model of asRecords(item.value.data_models).filter(row => row.file === file)) declarations.push(`声明模型：${designLink(`model:${item.address}/${model.name}`, String(model.name))}`);
      }
      return [designLink(`file:${file}`, file), [...new Set(declarations)].join('；') || '未声明用途或接口/模型关联'];
    });
    lines.push(...table(['文件', '已声明用途或关联'], associations));
  }
  for (const item of current) lines.push(anchor(`unit:${item.id}`), ...renderUnit(item, blueprint));
  const retired = inputs.units.filter(item => item.retiredBy);
  if (retired.length) {
    lines.push('#### 已替代的 CU', '', '替代关系来自精确 supersedes，不推断替代动机。', '');
    for (const item of retired) {
      const replacement = inputs.units.find(u => u.id === item.retiredBy); const before = new Map(asRecords(item.unit?.target_predicates).map(p => [String(p.predicate_id), p])); const after = new Map(asRecords(replacement?.unit?.target_predicates).map(p => [String(p.predicate_id), p]));
      const summarize = (p: BlueprintRecord) => `${prose(p.role)}：${prose(p.description)}；提供 ${refs(p.provide_ids)}；验证 ${refs(p.verification_refs)}`;
      lines.push(`${text(item.id)} → ${text(item.retiredBy)}`, '', ...table(['谓词', '替代前', '替代后'], [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(id => { const old = before.get(id); const next = after.get(id); return old && next && summarize(old) === summarize(next) ? [] : [[id, old ? summarize(old) : '新增', next ? summarize(next) : '删除']]; })));
    }
  }
  lines.push('### F 需求追溯', '');
  const images = registeredImages(blueprint);
  const scope = currentScopeItems(blueprint); lines.push('#### 需求追溯总表', '');
  if (!scope.length) lines.push('未记录 current scope；不自行推断需求范围。', '');
  else {
    const mappings = new Map(requirementTraceability(blueprint).map(item => [item.item_id, item.blueprint_refs]));
    lines.push(...table(['需求项', '类型', '原始来源'], scope.map(item => [item.item_id, item.kind, images.includes(item.source_ref.split('#')[0]) ? designLink(`image:${item.source_ref.split('#')[0]}`, '截图来源') : item.source_ref])),
      ...scope.map(item => `- ${text(item.item_id)}：${images.includes(item.source_ref.split('#')[0]) ? designLink(`image:${item.source_ref.split('#')[0]}`, '截图来源') : `[来源](${encodeURI(`${inputs.sourceRootRelative ? `${inputs.sourceRootRelative}/` : ''}${item.source_ref}`).replace(/\(/g, '%28').replace(/\)/g, '%29')})`}`), '',
      '| 需求项 | 蓝图登记地址 | 当前 CU 直接引用 |', '| --- | --- | --- |');
    for (const item of scope) {
      const addresses = mappings.get(item.item_id) ?? [];
      if (!addresses.length) lines.push(`| ${cell(item.item_id)} | 未登记 | 无 CU 直接引用 |`);
      for (const address of addresses) lines.push(`| ${cell(item.item_id)} | ${designLink(address)} | ${cell(ownersForAddress(directUnits, address).map(id => `${id}${current.find(u => u.id === id)?.binding === 'pending' ? '（待升版）' : ''}`).join('；') || '无 CU 直接引用')} |`);
    }
    lines.push('');
  }
  lines.push('### G 质询、决定与稳定地址', '', '<a id="reader-source-details"></a>');
  if (guide.sections.length) lines.push('#### 读者说明完整来源', '');
  for (const [index, section] of guide.sections.entries()) lines.push(`<a id="${readerGuideSourceAnchor(index)}"></a>`, `##### ${text(section.title)}`, '',
    ...table(['完整来源位置'], section.source_refs.map(pointer => [pointer])), `图引用：${section.graph_ids.length ? section.graph_ids.map(text).join('；') : '未引用图'}`, '');
  const dg = asRecord(blueprint.decisions_and_gaps); const decisions = asRecords(dg?.decisions); const architecture = decisions.filter(d => ['architecture_impact', 'component_asset_selection'].includes(String(d.kind)));
  if (architecture.length) lines.push('#### 已有 DSL 演进与组件选型', '', ...table(['决策', '主责说明'], architecture.map(d => [d.decision_id, designLink(`decision:${d.decision_id}`)])));
  lines.push('#### 决策精确声明', '');
  if (!decisions.length) lines.push('未记录决策及被否方案。', '');
  for (const d of decisions) {
    lines.push(`##### ${text(decisionTitle(d, blueprint))}`, '', ...table(['关切', '声明'], [['正文解释', designLink(`decision:${d.decision_id}`)], ['类型', enumText(d.kind, { component_asset_selection: '组件选型', architecture_impact: '架构影响', evolution_candidate: '演进候选', residual_risk: '残余风险', design_choice: '设计取舍' })], ['状态', enumText(d.status, DISPOSITIONS)], ['责任方', d.owner]]));
  }
  lines.push('<a id="review-quality"></a>', '#### 质量属性与数据生命周期', '', ...(asRecords(blueprint.quality_attributes).length ? table(['要求', '类别', '要求说明', '落点', '来源', '验证引用'], asRecords(blueprint.quality_attributes).map(q => [q.qa_id, q.category, q.requirement, q.landing, q.source_ref, acceptanceLinks(q.verification_refs)])) : ['部件级质量属性未记录；精确阈值见已有 NFR。', '']),
    '<a id="review-data-domains"></a>', '#### 数据用途与生命周期', '', ...(asRecords(blueprint.data_domains).length ? table(['数据域', '用途', '有效期', '隔离', '清理', '安全', '使用流'], asRecords(blueprint.data_domains).map(d => [d.data_domain_id, d.usage, d.retention, d.isolation, d.cleanup, d.security, asRecords(view('runtime')?.runtime_data_flows).filter(f => asStrings(f.data_domain_refs).includes(String(d.data_domain_id))).map(f => prose(f.name ?? f.flow_id)).join('；') || '未登记使用流'])) : ['数据生命周期未记录。', '']));
  lines.push('#### 风险、缺口与诊断', '', `准入 ${text(enumText(admission?.status, DISPOSITIONS))}；切片 ${text(asRecord(admission?.current_slice)?.slice_id)}；阻塞 ${text(refs(admission?.blocker_refs))}`, '');
  const gaps = asRecords(dg?.gaps); if (gaps.length) lines.push(gaps.map(g => anchor(`gap:${g.gap_id}`)).join(''), ...table(['缺口', '状态', '责任方', '需要方', '解除条件'], gaps.map(g => [g.gap_id, enumText(g.status, DISPOSITIONS), g.owner, g.needed_by, g.unlock_condition])));
  const risks = decisions.filter(d => d.kind === 'residual_risk' || ['open_decision', 'blocker'].includes(String(d.status))); if (risks.length) lines.push(...table(['风险/待决项', '主责说明', '状态', '责任方'], risks.map(d => [d.decision_id, designLink(`decision:${d.decision_id}`), enumText(d.status, DISPOSITIONS), d.owner])));
  const unavailable = asRecords(blueprint.providers).filter(p => p.available !== true || ['unknown', 'degraded'].includes(String(p.missing_disposition))); if (unavailable.length) lines.push('#### 来源不可用与降级影响', '', ...table(['来源能力', '可用', '实际处置'], unavailable.map(p => [p.provider_id, booleanText(p.available), enumText(p.missing_disposition, { unknown: '待确认', degraded: '已降级', not_applicable: '不适用' })])));
  const presentationIssues = diagnoseBlueprintPresentationShape(blueprint, graphDisplay); if (presentationIssues.length) lines.push('#### 设计内容与表达诊断（非阻断）', '', ...presentationIssues.map(i => `- ${text(i.path)}：${text(i.message)}`), '');
  if (inputs.sourceGaps.length) lines.push('#### CU 来源缺口', '', ...inputs.sourceGaps.map(g => `- ${text(g)}`), '', '以上直接引用与合并声明不能作为完整覆盖证明。', '');
  const lens = asRecord(blueprint.app_lens); if (lens) lines.push('#### App 根问题', '', ...table(['问题', '回答', '裁决', '依据'], Object.entries(APP_QUESTIONS).filter(([key]) => asRecord(lens[key])).map(([key, question]) => [question, meaning(asRecord(lens[key])?.answer), enumText(asRecord(lens[key])?.disposition, DISPOSITIONS), refs(asRecord(lens[key])?.evidence_refs)])));
  const questioning = asRecord(review.questioning); if (questioning) lines.push('#### 独立质询', '', ...table(['范围', '问题', '裁决', '回答'], asRecords(questioning.items).map(q => [q.scope_ref, q.question, enumText(q.disposition, DISPOSITIONS), q.answer ?? '未记录'])));
  lines.push('#### 编号速查', '', ...table(['编号', '类别', '主责来源'], content.flatMap(i => i.field === 'acceptance' ? ['criteria', 'boundaries', 'performance'].flatMap(key => asRecords(i.value[key]).map(row => [row.id, key === 'criteria' ? '功能验收' : key === 'boundaries' ? '边界验收' : '质量阈值', designLink(`acceptance:${i.address}/${key}:${row.id}`, row.id as string)])) : i.field === 'contracts' ? asRecords(i.value.data_models).map(row => [row.name, '领域模型', designLink(`model:${i.address}/${row.name}`, row.name as string)]) : asRecords(i.value.use_cases).map(row => [row.id, '用例', designLink(i.address)]))),
    '#### 稳定设计地址', '', ...[...stableAddressIndex(blueprint).keys()].map(address => `- ${text(address)}：${designLink(address)}`), '', '通过 /component-design 提出意见。', ...(inputs.closureExists ? ['施工完成情况见 [component closure](component-closure.md)。'] : []), '');
  const bodyLink = (id: string, label: string) => lines.includes(`<a id="${id}"></a>`) ? `[${label}](#${id})` : `${label}（正文无此部分）`;
  lines.push('### H 4+1 与章节对照', '',
    ...table(['建模视图', '正文阅读位置'], [['场景（+1）', `${bodyLink('journey', '用户旅程与界面')}、${bodyLink('acceptance', '验收')}`], ['逻辑', `${bodyLink('solution', '整体方案')}、${bodyLink('data', '数据与存储')}`], ['运行时', `${bodyLink('flows', '关键流程')}、${bodyLink('recovery', '失败与恢复')}`], ['开发', `${bodyLink('solution', '整体方案')}、${bodyLink('delivery', '施工与上线')}`], ['部署', `${bodyLink('quality', '质量与安全')}、${bodyLink('delivery', '施工与上线')}`]]));
  for (const [id, label] of [['scenarios', '场景视图（+1）'], ['logical', '逻辑视图'], ['runtime', '运行时视图'], ['development', '开发视图'], ['deployment', '部署视图']]) lines.push(`#### ${label}`, '', ...renderView(view(id), blueprint, graphDisplay, shownGraphs));
  const deployment = view('deployment');
  if (deployment?.applicability === 'applicable') lines.push('#### 本部件落点与外部参与方', '', ...table(['参与方', '职责', '输入', '输出', '不负责范围', '失败影响'], asRecords(deployment.nodes).map(n => [n.label ?? n.node_id, refs(n.responsibilities), refs(n.inputs), refs(n.outputs), refs(n.not_responsible_for), n.failure_impact])),
    '#### 外部契约与关系的本侧责任', '', ...table(['契约', '责任方', '本侧需要方', '认领 CU'], contracts.map(c => [c.contract_id, c.owner, c.needed_by, claimedBy(`contract:${c.contract_id}`)])));
  const relations = asRecords(blueprint.relations); lines.push('#### 各视图的显式联系', '', relations.map(r => anchor(`relation:${r.relation_id}`)).join(''), ...table(['关系', '起点', '终点', '类型', '责任方', '认领 CU'], relations.map(r => [r.relation_id, r.from, r.to, enumText(r.relation_type, RELATIONS), r.owner, claimedBy(`relation:${r.relation_id}`)])));
  try {
    const graph = generateMermaidRelationGraph(blueprint); const issues = validateGeneratedBlueprintGraphs({ ...blueprint, generated_graphs: [graph] });
    if (issues.length) lines.push('整体关系图无效，未展示：', '', ...issues.map(issue => `- ${text(issue.message)}`), '');
    else if (graph.relation_refs.length) lines.push('```mermaid', graph.content.trimEnd(), '```', '');
  } catch (error) { lines.push(`整体关系图无效，未展示：${text((error as Error).message)}`, ''); }
  for (const s of asRecords(view('scenarios')?.nodes)) {
    lines.push(`##### ${text(s.label ?? s.node_id)}`, '', ...table(['旅程步骤', '阶段', '前置条件', '用户动作', '系统行为'], asRecords(s.journey_steps).map(j => [j.step_id, j.stage, refs(j.preconditions), j.user_action, j.system_behavior])));
    if (!asRecords(s.journey_steps).length) lines.push('旅程未记录。', '');
    if (asRecords(s.path_variants).length) lines.push(...table(['适用人群/路径', '差异'], asRecords(s.path_variants).map(p => [p.user_type, p.difference])));
    lines.push(...table(['逻辑对象/契约', '运行流', '开发落点', '部署落点'], [[refs(s.logical_refs), refs(s.runtime_refs), s.development_owner_ref, refs(s.deployment_refs)]]));
  }
  const renderedAnchors = new Set(lines.join('\n').match(/<a id="[^"]+"><\/a>/g));
  for (const address of stableAddressIndex(blueprint).keys()) if (!renderedAnchors.has(anchor(address))) lines.push(anchor(address));
  return finishPresentation(lines, blueprint);
}
