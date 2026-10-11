import * as YAML from 'yaml';
import { BlueprintRecord, asRecord, asRecords, asStrings, nonEmptyString } from './component-blueprint-model';
import { stableAddressIndex } from './blueprint-addressing';
import { validateComponentBlueprintRefShape } from './component-blueprint-path';
import { currentScopeItems, requirementTraceability } from './blueprint-requirement-traceability';
import { ownersForAddress } from './change-unit-addressing';
import { blueprintRefAddress } from './change-unit-model';
import { BlueprintReviewInputs, ReviewChangeUnit, reviewChangeUnitBindings } from './blueprint-review-inputs';
import { BlueprintContentError, mergeBlueprintTargetContent, projectionContentEqual, projectionRowIdentity, selectBlueprintSkillContent } from './blueprint-skill-projection';
import type { ComponentBlueprintRef } from './component-blueprint-model';
import { generateMermaidViewGraph, validateGeneratedBlueprintGraphs } from './blueprint-graph-generator';
import { diagnoseBlueprintPresentationShape } from './component-blueprint-validator';
import { extractAcceptanceIdRefs } from './check-acceptance';

export const BLUEPRINT_REVIEW_FORMAT = 'component-blueprint-review@4';

function prose(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '未记录';
}
function text(value: unknown): string {
  return prose(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]])/g, '\\$1');
}
function cell(value: unknown): string { return text(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>'); }
function refs(value: unknown): string { return asStrings(value).join('；') || '—'; }
/** 已知语义字段的短句；不展开结构/来源元数据。 */
function meaning(value: unknown): string {
  if (Array.isArray(value)) return value.filter(item => ['string', 'number', 'boolean'].includes(typeof item)).map(prose).join('；') || '未记录';
  const record = asRecord(value);
  return record ? prose(record.semantics ?? record.description ?? record.rule ?? record.answer ?? record.summary) : prose(value);
}
/** errors.items / nfr.requirements 的业务键值集合只读一层。 */
function namedMeanings(value: unknown): string {
  return asRecord(value) ? Object.entries(asRecord(value)!).map(([name, entry]) => `${name}：${meaning(entry)}`).join('；')
    : asRecords(value).length ? asRecords(value).map(entry => meaning(entry)).join('；') : meaning(value);
}
export function blueprintReviewAnchor(address: string): string { return `design-${Buffer.from(address).toString('hex')}`; }
function anchor(address: string): string { return `<a id="${blueprintReviewAnchor(address)}"></a>`; }
function designLink(address: string): string { return `[${cell(address)}](#${blueprintReviewAnchor(address)})`; }
function table(headers: string[], rows: unknown[][]): string[] {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`), ''];
}
function directReviewUnits(inputs: BlueprintReviewInputs) {
  return inputs.units.filter(item => !item.retiredBy && item.unit).map(item => ({ ...item.unit!, design_refs: asRecords(item.unit!.design_refs).flatMap(ref => {
    try { return [validateComponentBlueprintRefShape(ref)]; } catch { return []; }
  }) }));
}
function acceptanceFocus(row: BlueprintRecord): string {
  return `${prose(row.ut_layer)}；${[row.ut_focus === undefined ? undefined : `UT：${prose(row.ut_focus)}`, row.device_focus === undefined ? undefined : `device：${prose(row.device_focus)}`].filter(Boolean).join('；') || '未记录关注点'}`;
}

function renderUnit(item: ReviewChangeUnit, blueprint: BlueprintRecord): string[] {
  const lines = [`### ${text(item.id)}`, ''];
  if (!item.unit) return [...lines, 'CU 无法解析，见来源缺口。', ''];
  const cu = item.unit;
  lines.push(text(cu.purpose), '', `来源绑定：${item.binding === 'bound' ? '已绑定' : item.binding === 'pending' ? '待指针升版；不承诺可以 carry-forward' : '未解析/未绑定'}。`, '',
    '交付结果：', '', ...table(['谓词', '职责', '交付语义', '提供项', '验证关注'], asRecords(cu.target_predicates).map(p => [p.predicate_id, p.role, p.description, refs(p.provide_ids), refs(p.verification_refs)])),
    ...table(['提供项', '交付说明'], asRecords(cu.provides).map(p => [p.provide_id, p.description])));
  const requires = asRecords(cu.requires);
  lines.push('显式依赖：', '', ...(requires.length ? table(['依赖', '上游 CU', '上游提供项'], requires.map(r => [r.require_id, r.from_change_unit_id, r.provide_id])) : ['未声明上游依赖；不从目录、purpose 或数组顺序推断施工顺序。', '']),
    `可修改模块：${item.binding === 'pending' ? '待指针升版后显示' : item.modules?.map(text).join('；') || '未解析，见来源缺口'}。`,
    '此范围不替代或扩大 Feature contracts.files 的写授权。', '',
    ...table(['修改责任方', '写入范围', '设计引用'], asRecords(cu.touches).map(touch => [touch.owner, refs(touch.write_refs),
      item.binding === 'pending' ? '待指针升版后显示' : asRecord(touch.design_ref)?.target ? blueprintRefAddress(touch.design_ref as never) : '无法解析'])));
  for (const [key, title] of [['preconditions', '前置条件'], ['preserved_invariants', '保留约束']] as const) {
    const entries = asRecords(cu[key]);
    if (entries.length) lines.push(`${title}：`, '', ...table(['说明', '依据'], entries.map(entry => [entry.description, refs(entry.source_refs ?? entry.evidence_refs)])));
  }
  const safe = asRecord(cu.safe_intermediate_state);
  lines.push(`安全中间态：${text(safe?.description)}`, `构建：${text(refs(safe?.build_validation_refs))}；兼容：${text(refs(safe?.compatibility_refs))}；恢复：${text(refs(safe?.recovery_refs))}`, '');
  const blockers = asRecords(cu.blockers);
  if (blockers.length) lines.push('设计与执行阻塞项：', '', ...table(['阻塞项', '阶段', '责任方', '原因', '解除条件'], blockers.map(b => [b.blocker_id, b.gate, b.owner, b.reason, b.unlock_condition])));
  else lines.push('设计与执行阻塞项：无。', '');
  lines.push('设计引用：', '', ...(item.binding === 'pending' ? ['待指针升版后显示。'] : item.designAddresses.map(address => `- ${designLink(address)}`)), '', `验证关注：${text(refs(cu.verification_refs))}`, '');
  lines.push('合并所得声明集合；是否通过交接校验见 readiness。', '');
  if (item.binding === 'pending') lines.push('待指针升版后显示。', '');
  else if (item.binding !== 'bound') lines.push('未绑定，不能列出可靠的合并声明集合。', '');
  else try {
    const bundle = selectBlueprintSkillContent(blueprint, cu);
    lines.push(...table(['内容', '本 CU 整体继承的编号/文件'], [
      ['AC', asRecords(bundle.acceptance?.criteria).map(row => prose(row.id)).join('；') || '设计期未写入，将由 spec 补'],
      ['BD', asRecords(bundle.acceptance?.boundaries).map(row => prose(row.id)).join('；') || '未记录'],
      ['NFR', asRecords(bundle.acceptance?.performance).map(row => prose(row.id)).join('；') || '未记录'],
      ['contracts.files 声明写集', refs(bundle.contracts?.files)],
      ['用例', asRecords(bundle.useCases?.use_cases).map(row => prose(row.id)).join('；') || '设计期未写入，将由 plan 补'],
    ]));
    if (!bundle.contracts) lines.push('设计期未写入 contracts，将由 plan 补。', '');
  } catch (error) { lines.push(`合并无效：${text(error instanceof BlueprintContentError ? error.code : '无法解析')} · ${text((error as Error).message)}。不展示部分成功集合。`, ''); }
  return lines;
}

function decisionConclusion(decision: BlueprintRecord): string {
  if (decision.kind === 'component_asset_selection') return `选型结果：${prose(decision.asset_resolution)}；选型目标：${prose(decision.target_ref)}；组件：${prose(decision.component_ref)}`;
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

function renderFlow(flow: BlueprintRecord, viewId: unknown): string[] {
  const load = asRecord(flow.initial_load); const truth = asRecord(flow.source_of_truth); const state = asRecord(flow.state_owner); const recovery = asRecord(flow.failure_recovery);
  const lines = [anchor(`view:${viewId}/flow:${flow.flow_id}`), `### ${text(flow.name ?? flow.flow_id)}`, '',
    `数据域：${text(refs(flow.data_domain_refs))}；契约：${text(refs(flow.external_contract_refs))}；开发责任：${text(flow.development_owner_ref)}`, '',
    '触发：', '', ...table(['触发', '类型', '时机', '幂等'], asRecords(flow.triggers).map(t => [t.trigger_id, t.kind, t.timing, t.idempotency])),
    `首次加载：${text(load?.initial_load_id)} · ${text(load?.strategy)}；责任方 ${text(load?.owner)}；范围 ${text(load?.data_scope)}；新鲜度 ${text(load?.freshness)}`, '',
    `权威状态：${text(truth?.authority)}；持久化 ${text(truth?.persistence)}；投影/缓存 ${text(refs(truth?.projections_and_caches))}；调和 ${text(truth?.reconciliation)}`,
    `状态责任方：${text(state?.ref)}；状态 ${text(refs(state?.states))}`, '', '写入与发布：', ''];
  const mutations = asRecords(flow.mutations); const publications = asRecords(flow.publications);
  if (mutations.length) lines.push(...table(['写入', '类型', '持久化', '发布', '恢复'], mutations.map(m => [m.mutation_id, m.kind, m.persistence_ref, m.publication_ref, m.recovery_ref])));
  else lines.push('未声明写入。', '');
  if (publications.length) lines.push(...table(['发布', '快照/语义'], publications.map(p => [p.publication_id, p.snapshot ?? p.semantics])));
  lines.push('订阅与消费者：', '');
  const subscriptions = asRecords(flow.subscriptions);
  if (subscriptions.length) lines.push(...table(['订阅', '发布', '消费者', '建立/解除', '快照/重放', '清理', '顺序'], subscriptions.map(s => [s.subscription_id, s.publication_ref ?? '—', s.consumer_ref, `${prose(s.attach)} / ${prose(s.detach)}`, s.replay_or_snapshot, s.cleanup, s.ordering])));
  else lines.push('未声明订阅。', '');
  lines.push(...table(['消费者', '首次加载', '更新'], asRecords(flow.consumers).map(c => [c.consumer_id, c.initial_load_ref, c.update_ref])),
    `失败与恢复：${text(recovery?.recovery_id)} · ${text(recovery?.strategy ?? '—')}；持久化失败 ${text(recovery?.persistence_failure ?? '—')}；订阅失败 ${text(recovery?.subscription_failure ?? '—')}；进程重建 ${text(recovery?.process_recreation ?? '—')}`, '',
    '生命周期：', '', ...table(['场景', '覆盖裁决', '依据'], Object.entries(asRecord(flow.lifecycle_coverage) ?? {}).map(([name, item]) => [name, asRecord(item)?.status, refs(asRecord(item)?.evidence_refs)])),
    `验证关注：${text(refs(flow.verification_refs))}`, '');
  return lines;
}

function renderContract(contract: BlueprintRecord): string[] {
  const operation = asRecord(contract.operation);
  const lines = [anchor(`contract:${contract.contract_id}`), `### ${text(contract.contract_id)}`, '',
    `操作：${text(operation?.operation_id)} · ${text(operation?.version)} · ${text(operation?.direction)}；责任方 ${text(contract.owner)}；需要方 ${text(contract.needed_by)}`, ''];
  for (const [key, title] of [['request_dto', '请求'], ['response_dto', '响应']] as const) {
    const dto = asRecord(contract[key]);
    if (dto) lines.push(`**${title} DTO：${text(dto.dto_id)}**`, '', ...table(['字段', '类型', '必需', '可空', '语义'], asRecords(dto.fields).map(f => [f.field_id, f.type, f.required, f.nullable, f.semantics])));
  }
  const mappings = asRecords(contract.mappings);
  if (mappings.length) lines.push('映射：', '', ...table(['映射', '类型', '源字段', '目标字段', '规则'], mappings.map(m => [m.mapping_id, m.kind, refs(m.source_fields), m.target_field, m.rule])));
  const errors = asRecord(contract.errors); const nfr = asRecord(contract.nfr);
  lines.push(`错误：${text(errors?.semantics ?? namedMeanings(errors?.items))}`,
    `幂等：${text(meaning(contract.idempotency))}`, `非功能要求：${text(nfr?.semantics ?? namedMeanings(nfr?.requirements))}`, '');
  return lines;
}

const APP_QUESTIONS: Record<string, string> = {
  module_boundaries: '模块边界是什么？', capability_seams: '哪些能力通过接缝消费？', feature_flags: '功能开关如何影响本切片？',
  data_producers_consumers: '谁生产、谁消费数据？', lifecycle_triggers: '生命周期有哪些触发？', state_owners: '谁拥有状态？',
  initialization: '如何初始化？', publication_subscription: '如何发布与订阅？', ui_refresh: '界面如何刷新？', process_recovery: '进程如何恢复？',
};

interface ReviewContent { address: string; field: 'acceptance' | 'contracts' | 'use_cases'; value: BlueprintRecord }
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
function renderView(view: BlueprintRecord | undefined, blueprint: BlueprintRecord, graph = false): string[] {
  if (!view) return ['该视图未记录。', ''];
  const nodes = asRecords(view.nodes);
  const lines = [anchor(`view:${view.view_id}`), text(view.purpose), '',
    ...table(['适用性', '本次影响', '当前', '目标', '变化/依据'], [[view.applicability, view.evolution_impact ?? '—', meaning(view.current_state), meaning(view.target_state), view.applicability === 'not_applicable' ? refs(asRecord(view.applicability_evidence)?.evidence_refs) : view.evolution_impact === 'verified_unchanged' ? refs(asRecord(view.unchanged_evidence)?.evidence_refs) : meaning(view.delta)]]),
    nodes.map(node => anchor(`view:${view.view_id}/node:${node.node_id}`)).join('')];
  if (view.applicability === 'not_applicable') return [...lines, '该视图不适用；保留上述依据，不能随单次需求自行切换适用性。', ''];
  if (view.evolution_impact === 'verified_unchanged') return [...lines, `核实未变：${text(asRecord(view.unchanged_evidence)?.current_state_ref)}。`, ''];
  if (nodes.length) lines.push(...table(['设计对象', '模块/责任方', '当前', '目标', '依据'], nodes.map(n => [n.label ?? n.name ?? n.node_id, `${prose(n.module ?? '—')} / ${prose(n.owner)}`, meaning(n.current_state), meaning(n.target_state), refs(n.design_basis_refs)])));
  if (graph) {
    const declared = asRecords(blueprint.generated_graphs).filter(g => g.source_view_id === view.view_id);
    const graphs = declared.length ? declared : [generateMermaidViewGraph(blueprint, String(view.view_id)) as unknown as BlueprintRecord];
    for (const g of graphs) {
      const issues = validateGeneratedBlueprintGraphs({ ...blueprint, generated_graphs: [g] });
      if (issues.length) lines.push('结构图无效，未展示：', '', ...issues.map(i => `- ${text(i.message)}`), '');
      else if (asStrings(g.relation_refs).length) lines.push('```mermaid', String(g.content).trimEnd(), '```', '');
      else lines.push('未声明可展示的同视图结构边；以上对象表保留，不从名称、目录或字段类型猜连线。', '');
    }
  }
  return lines;
}
function renderModels(value: BlueprintRecord): string[] {
  const lines: string[] = [];
  for (const model of asRecords(value.data_models)) {
    lines.push(`#### ${text(model.name)} · ${text(model.kind)}`, '', `模块 ${text(model.module)}；文件 ${text(model.file)}`, '',
      ...table(['字段', '类型', '必需', '默认值', '约束/说明', '来源'], asRecords(model.fields).map(f => [f.name, f.type, f.required, f.default ?? '—',
        f.description === undefined ? '未记录' : typeof f.description === 'string' ? f.description : '未能表达（description 非字符串）',
        f.source_ref === undefined ? '未记录' : typeof f.source_ref === 'string' ? f.source_ref : '未能表达（source_ref 非字符串）'])));
    if (asRecords(model.values).length) lines.push('枚举：', '', ...table(['名称', '值'], asRecords(model.values).map(v => [v.name, v.value])));
    if (asRecords(model.computed_properties).length) lines.push('计算属性：', '', ...table(['属性', '类型', '说明'], asRecords(model.computed_properties).map(v => [v.name, v.type, v.description])));
  }
  return lines;
}
function renderUseCases(value: BlueprintRecord): string[] {
  const lines: string[] = [];
  for (const uc of asRecords(value.use_cases)) {
    lines.push(`#### 用例 ${text(uc.id)}`, '', text(uc.description), '', `编排入口：${text(uc.coordinator)}；文件 ${text(uc.coordinator_file ?? '未记录')}`, '',
      ...table(['阶段顺序', '阶段'], asStrings(asRecord(uc.state_model)?.phases).map((phase, i) => [i + 1, phase])));
    if (asRecords(asRecord(uc.state_model)?.fields).length) lines.push(...table(['状态字段', '类型'], asRecords(asRecord(uc.state_model)?.fields).map(f => [f.name, f.type])));
    for (const binding of asRecords(uc.ui_bindings)) lines.push(`UI 边界：${text(binding.ui)} · ${text(binding.role)}；订阅 ${text(refs(binding.subscribes))}`, '',
      ...table(['用户动作', '调用符号'], asRecords(binding.user_actions).map(a => [a.trigger, a.calls])));
    for (const boundary of asRecords(uc.data_boundaries)) lines.push(`数据边界：${text(boundary.name)} · ${text(boundary.type)} · ${text(boundary.kind)}`, '',
      ...table(['方法', '参数', '返回', '异步'], asRecords(boundary.methods).map(m => [m.name, refs(m.params), m.returns, m.async])));
    lines.push('主路径及分支去向：', '', ...table(['分支', '条件', '动作顺序', '阶段去向', '端口调用', '预期状态', '不得调用', '关联验收'],
      asRecords(uc.branches).map(b => [b.id, b.scenario, refs(b.user_sequence), refs(b.expected_phase_seq), refs(b.expected_port_calls), namedMeanings(b.expected_state), refs(b.not_called), refs(b.linked_acceptance)])));
    const details = asRecords(uc.branches).filter(b => b.cloud_stubs || b.local_stubs || b.local_expect);
    if (details.length) lines.push(...table(['分支', '外部桩', '本地桩', '本地预期'], details.map(b => [b.id, namedMeanings(b.cloud_stubs), namedMeanings(b.local_stubs), refs(b.local_expect)])));
  }
  return lines;
}
function renderAcceptance(value: BlueprintRecord, inputs: BlueprintReviewInputs, address: string): string[] {
  const owners = new Set(ownersForAddress(directReviewUnits(inputs), address));
  const predicates = (id: unknown): string => inputs.units.filter(u => !u.retiredBy && owners.has(u.id)).flatMap(u => asRecords(u.unit?.target_predicates).filter(p => asStrings(p.verification_refs).flatMap(extractAcceptanceIdRefs).includes(String(id).toUpperCase())).map(p => `${u.id}/${p.predicate_id}`)).join('；') || '未登记直接谓词引用';
  const lines = ['功能验收：', '', ...table(['AC', '优先级/功能', '验收标准', '验证步骤（按序）', '预期', '分层/关注点', '已有流程关联', 'CU 谓词直接引用'],
    asRecords(value.criteria).map(c => [c.id, `${prose(c.priority)} / ${prose(c.prd_function ?? '—')}`, c.description, asStrings(c.verification_steps).map((s, i) => `${i + 1}. ${s}`).join('\n'), c.expected_result,
      acceptanceFocus(c), c.linked_flow ? `${c.linked_flow}/${prose(c.linked_branch ?? '—')}` : '未声明；无 UI 依据时由 spec 不冲突补充', predicates(c.id)]))];
  if (asRecords(value.boundaries).length) lines.push('边界验收：', '', ...table(['BD', '优先级', '异常场景', '处理', '可见结果/预期', '分层/关注点', 'CU 谓词直接引用'],
    asRecords(value.boundaries).map(b => [b.id, b.priority, b.scenario, b.handling, b.expected_behavior, acceptanceFocus(b), predicates(b.id)])));
  if (asRecords(value.performance).length) lines.push('质量阈值：', '', ...table(['NFR', '指标', '阈值', '单位', '说明', '分层/关注点'],
    asRecords(value.performance).map(p => [p.id, p.metric, p.threshold, p.unit, p.description, acceptanceFocus(p)])));
  return lines;
}

/** 4+1 正文只消费 canonical 蓝图与 CU，不运行完整投影检查或读 Feature 产物。 */
export function renderBlueprintReviewMarkdown(blueprint: BlueprintRecord, artifactSha256: string,
  inputs: BlueprintReviewInputs = { units: [], sourceGaps: [], closureExists: false }): string {
  if (!nonEmptyString(blueprint.component_id) || !nonEmptyString(blueprint.blueprint_id)) throw new Error('生成评审投影前必须有 component_id 与 blueprint_id。');
  const review = asRecord(blueprint.review_summary) ?? {}; const admission = asRecord(review.admission); const views = asRecords(blueprint.design_views);
  const view = (id: string) => views.find(v => v.view_id === id); const current = inputs.units.filter(item => !item.retiredBy);
  const directUnits = directReviewUnits(inputs);
  const claimedBy = (address: string): string => ownersForAddress(directUnits, address).map(id => `${id}${current.find(item => item.id === id)?.binding === 'pending' ? '（待升版）' : ''}`).join('；') || '无 CU 直接引用';
  const { content, diagnostics } = readReviewContent(blueprint); const typed = (field: ReviewContent['field']) => content.filter(item => item.field === field);
  const origin = (item: ReviewContent) => `设计内容来源：${designLink(item.address)} · ${text(item.field)}`;
  const lines: string[] = ['---', YAML.stringify({ derived_from: { artifact: blueprint.artifact, component_id: blueprint.component_id, blueprint_id: blueprint.blueprint_id,
    revision: blueprint.revision, source_fingerprint: blueprint.source_fingerprint, artifact_sha256: artifactSha256, change_units: reviewChangeUnitBindings(inputs) }, projection: BLUEPRINT_REVIEW_FORMAT }).trimEnd(), '---', '',
    `# ${text(review.title ?? blueprint.component_id)}`, '', anchor(`blueprint:${blueprint.blueprint_id}`),
    `部件 ${text(blueprint.component_id)} · 蓝图 ${text(blueprint.blueprint_id)} · revision ${text(blueprint.revision)} · 准入 ${text(admission?.status)}`, '',
    '阅读顺序：概述 → 场景（+1）→ 逻辑、运行、开发、部署 → 取舍、质量与验收 → 施工拆分。各视图通过稳定设计地址、契约和 CU 引用相连。', '',
    '## 1 概述', '', ...table(['关切', '设计说明'], [['背景', review.background], ['问题', review.problem], ['本次改变', review.summary], ['整体定位', review.positioning], ['范围', meaning(review.in_scope)], ['不做什么', meaning(review.non_goals)]]),
    '### 目标与成功衡量', '', ...(asRecords(review.goals).length ? table(['目标', '目标说明', '成功衡量'], asRecords(review.goals).map(g => [g.goal_id, g.statement, refs(g.success_measures)])) : ['未记录；由设计责任方补充，不按生成成功推定目标充分。', ''])];
  const facts = asRecords(asRecord(blueprint.discovery)?.facts); const terms = facts.filter(f => String(f.subject).startsWith('term:'));
  lines.push('### 术语', '', ...(terms.length ? table(['术语', '含义', '模块', '易混项', '确认依据'], terms.map(f => [String(f.subject).slice(5), asRecord(f.value)?.meaning, asRecord(f.value)?.canonical_module, refs(asRecord(f.value)?.easily_confused_with), asRecord(f.provenance)?.source_ref])) : ['术语含义未记录；不从名称推测。', '']));
  const conventions = [...new Set(facts.filter(f => asRecord(f.provenance)?.source_kind === 'convention').map(f => String(asRecord(f.provenance)?.source_ref)).filter(ref => ref !== 'undefined'))].sort();
  if (conventions.length) lines.push('已采用的工程惯例：', '', ...conventions.map(ref => `- ${text(ref.slice(ref.lastIndexOf('#') + 1))} — ${text(ref)}`), '');
  lines.push('## 2 场景视图（+1）', '', ...renderView(view('scenarios'), blueprint));
  for (const s of asRecords(view('scenarios')?.nodes)) {
    lines.push(`### ${text(s.label ?? s.node_id)}`, '', ...table(['旅程步骤', '阶段', '前置条件', '用户动作', '系统行为'], asRecords(s.journey_steps).map(j => [j.step_id, j.stage, refs(j.preconditions), j.user_action, j.system_behavior])));
    if (!asRecords(s.journey_steps).length) lines.push('旅程未记录。', '');
    if (asRecords(s.path_variants).length) lines.push(...table(['适用人群/路径', '差异'], asRecords(s.path_variants).map(p => [p.user_type, p.difference])));
    lines.push(...table(['逻辑对象/契约', '运行流', '开发落点', '部署落点'], [[refs(s.logical_refs), refs(s.runtime_refs), s.development_owner_ref, refs(s.deployment_refs)]]));
  }
  const scope = currentScopeItems(blueprint); lines.push('### 需求追溯总表', '');
  if (!scope.length) lines.push('未记录 current scope；不自行推断需求范围。', '');
  else {
    const mappings = new Map(requirementTraceability(blueprint).map(item => [item.item_id, item.blueprint_refs]));
    lines.push(...table(['需求项', '类型', '原始来源'], scope.map(item => [item.item_id, item.kind, item.source_ref])),
      ...scope.map(item => `- ${text(item.item_id)}：[来源](${encodeURI(`${inputs.sourceRootRelative ? `${inputs.sourceRootRelative}/` : ''}${item.source_ref}`).replace(/\(/g, '%28').replace(/\)/g, '%29')})`), '',
      '只列登记地址的直接引用者；覆盖结论由 component closure 负责。', '', '| 需求项 | 蓝图登记地址 | 当前 CU 直接引用 |', '| --- | --- | --- |');
    for (const item of scope) {
      const addresses = mappings.get(item.item_id) ?? [];
      if (!addresses.length) lines.push(`| ${cell(item.item_id)} | 未登记 | 无 CU 直接引用 |`);
      for (const address of addresses) lines.push(`| ${cell(item.item_id)} | ${designLink(address)} | ${cell(ownersForAddress(directUnits, address).map(id => `${id}${current.find(u => u.id === id)?.binding === 'pending' ? '（待升版）' : ''}`).join('；') || '无 CU 直接引用')} |`);
    }
    lines.push('');
  }
  lines.push('## 3 逻辑视图', '', ...renderView(view('logical'), blueprint, true), '### 领域模型、字段与枚举', '');
  for (const item of typed('contracts').filter(i => asRecords(i.value.data_models).length)) lines.push(origin(item), '', ...renderModels(item.value));
  if (!typed('contracts').some(i => asRecords(i.value.data_models).length)) lines.push('设计期未写入领域模型，将由 plan 补；不从 DTO 推断另一份持久化模型。', '');
  const contracts = asRecords(blueprint.contracts); lines.push('### 本部件实际消费或提供的操作与 DTO', '');
  for (const c of contracts) lines.push(...renderContract(c));
  if (!contracts.length) lines.push('未记录接口契约。', '');
  lines.push('## 4 运行时视图', '', ...renderView(view('runtime'), blueprint, true));
  for (const flow of asRecords(view('runtime')?.runtime_data_flows)) lines.push(...renderFlow(flow, 'runtime'));
  for (const item of typed('contracts').filter(i => asRecords(i.value.state_management).length)) {
    lines.push(origin(item), '', '### 施工状态与有序步骤', '');
    for (const s of asRecords(item.value.state_management)) lines.push(`状态 ${text(s.data)}；持有者 ${text(s.holder)}；作用域 ${text(s.scope)}；责任方 ${text(s.owner_ref)}`, '',
      ...table(['顺序', '行为'], asStrings(s.ordered_steps).map((step, i) => [i + 1, step])), `生命周期触发：${text(refs(s.lifecycle_triggers))}`, '',
      ...table(['失败/恢复场景', '处理'], Object.entries(asRecord(s.failure_recovery) ?? {}).map(([k, v]) => [k, meaning(v)])));
  }
  lines.push('### 用例、数据边界与分支', '');
  for (const item of typed('use_cases')) lines.push(origin(item), '', ...renderUseCases(item.value));
  if (!typed('use_cases').length) lines.push('设计期未写入 use_cases，将由 plan 按真实义务补充。', '');
  lines.push('### 异常与恢复', '');
  for (const item of typed('acceptance').filter(i => asRecords(i.value.boundaries).length)) lines.push(origin(item), '', ...table(['边界', '异常场景', '系统行为', '可见结果/预期', '验证关注'], asRecords(item.value.boundaries).map(b => [b.id, b.scenario, b.handling, b.expected_behavior, acceptanceFocus(b)])));
  lines.push('## 5 开发视图', '', ...renderView(view('development'), blueprint, true), '模型与持久化字段见 [逻辑视图](#3-逻辑视图)；运行编排见 [运行时视图](#4-运行时视图)。未声明的索引、事务、存储配置不由 renderer 推断。', '');
  for (const item of typed('contracts')) {
    const c = item.value;
    if (!['modules', 'files', 'interfaces', 'components', 'integration_points'].some(k => Array.isArray(c[k]) && (c[k] as unknown[]).length)) continue;
    lines.push(origin(item), '', ...table(['模块', 'DSL 分层', '形式', '变化', '目录'], asRecords(c.modules).map(m => [m.name, m.layer, m.format, m.change_type, m.package_path])));
    if (asRecord(c.module_dependencies)) lines.push('根级 module_dependencies：', '', ...table(['模块', '依赖模块'], Object.entries(asRecord(c.module_dependencies)!).map(([m, deps]) => [m, refs(deps)])));
    if (asStrings(c.files).length) lines.push('声明文件（唯一施工写集）：', '', ...table(['文件'], asStrings(c.files).map(file => [file])));
    for (const i of asRecords(c.interfaces)) lines.push(`接口 ${text(i.class)} · ${text(i.module)} / ${text(i.layer)} · ${text(i.file)}`, '', ...table(['方法', '参数', '返回', '异步', '职责/失败语义'], asRecords(i.methods).map(m => [m.name, asRecords(m.params).map(p => `${p.name}: ${p.type}`).join('；'), m.return, m.async, m.description])));
    for (const cpt of asRecords(c.components)) {
      lines.push(`组件 ${text(cpt.name)} · ${text(cpt.kind)} · ${text(cpt.file)}`, '', text(cpt.description), '', ...table(['状态/属性', '类型', '宿主声明'], [...asRecords(cpt.state), ...asRecords(cpt.props)].map(s => [s.name, s.type, s.decorator])));
      if (asRecords(cpt.events).length) lines.push(...table(['事件', '职责'], asRecords(cpt.events).map(e => [e.name, e.description])));
      if (asStrings(cpt.children).length) lines.push(`子组件：${text(refs(cpt.children))}`, '');
    }
    if (asRecords(c.integration_points).length) lines.push(...table(['消费模块', '提供模块', '需修改', '入口'], asRecords(c.integration_points).map(i => [i.consumer_module, i.provider_module, i.requires_modification, i.entry_symbol])));
  }
  const dg = asRecord(blueprint.decisions_and_gaps); const decisions = asRecords(dg?.decisions); const architecture = decisions.filter(d => ['architecture_impact', 'component_asset_selection'].includes(String(d.kind)));
  if (architecture.length) lines.push('### 已有 DSL 演进与组件选型', '', ...table(['决策', '结论', '依据'], architecture.map(d => [d.decision_id, decisionConclusion(d), d.rationale])));
  lines.push('## 6 部署视图', '', ...renderView(view('deployment'), blueprint, true));
  const deployment = view('deployment');
  if (deployment?.applicability === 'applicable') lines.push('### 本部件落点与外部参与方', '', ...table(['参与方', '职责', '输入', '输出', '不负责范围', '失败影响'], asRecords(deployment.nodes).map(n => [n.label ?? n.node_id, refs(n.responsibilities), refs(n.inputs), refs(n.outputs), refs(n.not_responsible_for), n.failure_impact])),
    '### 外部契约与关系的本侧责任', '', '外部节点只记录当前事实；契约及关系由消费 CU 的 design_refs 认领本部件这一侧证据。外部方自己的未消费施工以 gap/blocker 或协同表达。', '', ...table(['契约', '责任方', '本侧需要方', '认领 CU'], contracts.map(c => [c.contract_id, c.owner, c.needed_by, claimedBy(`contract:${c.contract_id}`)])),
    '### 配套协同', '', ...(asRecords(deployment.coordination).length ? table(['对方', '配套关系'], asRecords(deployment.coordination).map(c => [c.counterpart, c.relation])) : ['未记录。', '']),
    '### 上线顺序', '', ...(asRecords(deployment.rollout).length ? table(['顺序', '部件/单元', '配套前提', '说明'], asRecords(deployment.rollout).map(r => [r.order, r.unit, refs(r.depends_on), r.note])) : ['未记录。', '']), '上述顺序不自动转换为 CU requires 或施工授权；兼容约束见质量属性与 CU 安全中间态。', '');
  const relations = asRecords(blueprint.relations); lines.push('## 各视图的显式联系', '', relations.map(r => anchor(`relation:${r.relation_id}`)).join(''), ...table(['关系', '起点', '终点', '类型', '责任方', '认领 CU'], relations.map(r => [r.relation_id, r.from, r.to, r.relation_type, r.owner, claimedBy(`relation:${r.relation_id}`)])));
  lines.push('## 7 方案取舍', '');
  if (!decisions.length) lines.push('未记录决策及被否方案。', '');
  for (const d of decisions) lines.push(anchor(`decision:${d.decision_id}`), `### ${text(d.decision_id)}`, '', ...table(['关切', '结论'], [['类型', d.kind ?? '—'], ['选了什么', decisionConclusion(d)], ['理由', d.rationale], ['状态/责任方', `${prose(d.status)} / ${prose(d.owner)}`]]), '被否方案：', '', ...(asRecords(d.alternatives).length ? table(['方案', '被否理由', '缺陷/代价'], asRecords(d.alternatives).map(a => [a.option, a.rejected_reason, a.defect])) : ['未记录；不推测被否选择。', '']));
  lines.push('## 8 质量属性与合规', '', ...(asRecords(blueprint.quality_attributes).length ? table(['要求', '类别', '要求说明', '落点', '来源', '验证引用'], asRecords(blueprint.quality_attributes).map(q => [q.qa_id, q.category, q.requirement, q.landing, q.source_ref, refs(q.verification_refs)])) : ['部件级质量属性未记录；精确阈值见已有 NFR。', '']),
    '### 数据用途与生命周期', '', ...(asRecords(blueprint.data_domains).length ? table(['数据域', '用途', '有效期', '隔离', '清理', '安全', '使用流'], asRecords(blueprint.data_domains).map(d => [d.data_domain_id, d.usage, d.retention, d.isolation, d.cleanup, d.security, asRecords(view('runtime')?.runtime_data_flows).filter(f => asStrings(f.data_domain_refs).includes(String(d.data_domain_id))).map(f => prose(f.name ?? f.flow_id)).join('；') || '未登记使用流'])) : ['数据生命周期未记录。', '']));
  lines.push('## 9 质量与验收', '', '以下是目标声明的验收内容及直接谓词引用；不冒充 component closure 的覆盖裁决。', '');
  for (const item of typed('acceptance')) lines.push(origin(item), '', ...renderAcceptance(item.value, inputs, item.address));
  if (!typed('acceptance').length) lines.push('设计期未写入 acceptance，将由 spec 补；不能把 absence 或文档成功当作设计充分。', '');
  if (diagnostics.length) lines.push('### 结构化内容无效或冲突', '', ...diagnostics.map(d => `- ${text(d)}`), '');
  lines.push('## 10 施工拆分', ''); if (!inputs.units.length && !inputs.sourceGaps.length) lines.push('尚未拆分。', '');
  for (const item of current) lines.push(...renderUnit(item, blueprint));
  const retired = inputs.units.filter(item => item.retiredBy);
  if (retired.length) {
    lines.push('### 已替代的 CU', '', '替代关系来自精确 supersedes，不推断替代动机。', '');
    for (const item of retired) {
      const replacement = inputs.units.find(u => u.id === item.retiredBy); const before = new Map(asRecords(item.unit?.target_predicates).map(p => [String(p.predicate_id), p])); const after = new Map(asRecords(replacement?.unit?.target_predicates).map(p => [String(p.predicate_id), p]));
      const summarize = (p: BlueprintRecord) => `${prose(p.role)}：${prose(p.description)}；提供 ${refs(p.provide_ids)}；验证 ${refs(p.verification_refs)}`;
      lines.push(`${text(item.id)} → ${text(item.retiredBy)}`, '', ...table(['谓词', '替代前', '替代后'], [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(id => { const old = before.get(id); const next = after.get(id); return old && next && summarize(old) === summarize(next) ? [] : [[id, old ? summarize(old) : '新增', next ? summarize(next) : '删除']]; })));
    }
  }
  lines.push('## 11 风险与待决项', '', `准入 ${text(admission?.status)}；切片 ${text(asRecord(admission?.current_slice)?.slice_id)}；阻塞 ${text(refs(admission?.blocker_refs))}`, '');
  const gaps = asRecords(dg?.gaps); if (gaps.length) lines.push(gaps.map(g => anchor(`gap:${g.gap_id}`)).join(''), ...table(['缺口', '状态', '责任方', '需要方', '解除条件'], gaps.map(g => [g.gap_id, g.status, g.owner, g.needed_by, g.unlock_condition])));
  const risks = decisions.filter(d => d.kind === 'residual_risk' || ['open_decision', 'blocker'].includes(String(d.status))); if (risks.length) lines.push(...table(['风险/待决项', '说明', '状态', '责任方'], risks.map(d => [d.decision_id, decisionConclusion(d), d.status, d.owner])));
  const unavailable = asRecords(blueprint.providers).filter(p => p.available !== true || ['unknown', 'degraded'].includes(String(p.missing_disposition))); if (unavailable.length) lines.push('### 来源不可用与降级影响', '', ...table(['来源能力', '可用', '实际处置'], unavailable.map(p => [p.provider_id, p.available, p.missing_disposition ?? '未记录'])));
  const presentationIssues = diagnoseBlueprintPresentationShape(blueprint); if (presentationIssues.length) lines.push('### 可选表达未能完整显示（非阻断）', '', ...presentationIssues.map(i => `- ${text(i.path)}：${text(i.message)}`), '');
  if (inputs.sourceGaps.length) lines.push('### CU 来源缺口', '', ...inputs.sourceGaps.map(g => `- ${text(g)}`), '', '以上直接引用与合并声明不能作为完整覆盖证明。', '');
  const lens = asRecord(blueprint.app_lens); if (lens) lines.push('## 附录：App 根问题', '', ...table(['问题', '回答', '裁决', '依据'], Object.entries(APP_QUESTIONS).filter(([key]) => asRecord(lens[key])).map(([key, question]) => [question, meaning(asRecord(lens[key])?.answer), asRecord(lens[key])?.disposition, refs(asRecord(lens[key])?.evidence_refs)])));
  const questioning = asRecord(review.questioning); if (questioning) lines.push('## 附录：独立质询', '', ...table(['范围', '问题', '裁决', '回答'], asRecords(questioning.items).map(q => [q.scope_ref, q.question, q.disposition, q.answer ?? '未记录'])));
  lines.push('## 附录：编号速查', '', ...table(['编号', '含义/类别', '主责来源'], content.flatMap(i => i.field === 'acceptance' ? ['criteria', 'boundaries', 'performance'].flatMap(key => asRecords(i.value[key]).map(row => [row.id, row.description ?? row.metric, i.address])) : i.field === 'contracts' ? asRecords(i.value.data_models).map(row => [row.name, '领域模型', i.address]) : asRecords(i.value.use_cases).map(row => [row.id, row.description ?? '用例', i.address]))),
    '## 附录：稳定设计地址', '', ...[...stableAddressIndex(blueprint).keys()].map(address => `- ${designLink(address)}`), '', '通过 /component-design 提出意见；授权裁决仍沿既有 feedback 接缝处理。', ...(inputs.closureExists ? ['施工完成情况见 [component closure](component-closure.md)。'] : []), '', '> 本文为 canonical 蓝图与 CU 的单向派生物，可重建；不作为人工批准记录或第二设计真源。', '');
  return lines.join('\n');
}
