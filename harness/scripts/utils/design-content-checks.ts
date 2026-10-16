import { hasNonEmptyFocus, isUnitUtLayer } from './acceptance-layering';
import { takeArray } from './shape-guards';

/** 条目自身的内容问题；路径相对输入片段，不包含 Feature/CU/合并裁决。 */
export interface DesignContentIssue { path: string; message: string; fields?: string[]; consumerError?: string }
type Row = Record<string, any>;
const record = (value: unknown): Row | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullAccessError = (value: unknown, key: string): string | undefined => value === null || value === undefined
  ? `Cannot read properties of ${String(value)} (reading '${key}')` : undefined;

export const ACCEPTANCE_ID_PATTERN = /^(AC|BD)-(G\d+|\d+)$/i;

/** SpecLoader 的 map 数组归一与只读诊断共用判据，缺失/null 不属于形状错误。 */
export function inspectMapArray(value: unknown): { nonArray: boolean; invalidIndices: number[] } {
  return { nonArray: value !== undefined && value !== null && !Array.isArray(value),
    invalidIndices: rows(value).flatMap((item, i) => record(item) ? [] : [i]) };
}

export function inspectStringArray(value: unknown): { nonArray: boolean; invalidIndices: number[] } {
  return { nonArray: value !== undefined && value !== null && !Array.isArray(value),
    invalidIndices: rows(value).flatMap((item, i) => nonEmptyString(item) ? [] : [i]) };
}

export function inspectAcceptanceItem(value: unknown, criterion: boolean, at: string): DesignContentIssue[] {
  const item = record(value);
  if (!item) return [{ path: at, message: 'AC/BD 条目必须是对象' }];
  const out: DesignContentIssue[] = [];
  const add = (message: string, fields: string[]): void => { out.push({ path: at, message, fields }); };
  const id = typeof item.id === 'string' ? item.id.toUpperCase() : '';
  if (!ACCEPTANCE_ID_PATTERN.test(id)) add(`${item.id}: 验收 ID 非法或重复`, ['id']);
  const common = [...(!['P0', 'P1', 'P2'].includes(item.priority) ? ['priority'] : []), ...(!nonEmptyString(item.description) ? ['description'] : [])];
  if (common.length) add(`${item.id}: 缺 priority/description`, common);
  if (isUnitUtLayer(item.ut_layer) && !hasNonEmptyFocus(item.ut_focus)) add(`${item.id}: 缺 ut_focus`, ['ut_focus']);
  if (criterion) {
    const fields = [...(item.testable !== true ? ['testable'] : []),
      ...(!Array.isArray(item.verification_steps) || !item.verification_steps.length || item.verification_steps.some((step: unknown) => !nonEmptyString(step)) ? ['verification_steps'] : []),
      ...(!nonEmptyString(item.expected_result) ? ['expected_result'] : [])];
    if (fields.length) add(`${item.id}: 缺可执行步骤或精确预期`, fields);
  } else {
    const fields = ['scenario', 'handling', 'expected_behavior'].filter(key => !nonEmptyString(item[key]));
    if (fields.length) add(`${item.id}: 缺边界条件、处理或预期`, fields);
  }
  return out;
}

export function inspectPerformanceItem(value: unknown, at: string): DesignContentIssue[] {
  const item = record(value) ?? {};
  const fields = ['id', 'metric', 'threshold', 'unit', 'description'].filter(key => !nonEmptyString(item[key]));
  return fields.length ? [{ path: at, message: 'performance 缺指标、阈值、单位或描述', fields, consumerError: nullAccessError(value, 'id') }] : [];
}

/** 原施工检查的类型/签名规则；不包含 files 授权与用例引用。 */
export function inspectTypedConstructionContent(contracts: unknown, at = ''): DesignContentIssue[] {
  const out: DesignContentIssue[] = [];
  const source = record(contracts) ?? {};
  const members = (value: unknown, path: string, expression: string): unknown[] => {
    if (value === undefined || value === null) return [];
    // 保留原 for..of 的判断范围；不可迭代形状原先也不能通过，诊断不能将它洗成空集合。
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') return [...value as Iterable<unknown>];
    out.push({ path, message: '应为数组（YAML list）', consumerError: `(${expression} ?? []) is not iterable` });
    return [];
  };
  for (const [i, value] of rows(source.data_models).entries()) {
    const model = record(value) ?? {};
    const modelPath = `${at}.data_models[${i}]`;
    const fields = ['name', 'file', 'kind'].filter(key => !model[key]);
    if (fields.length) out.push({ path: modelPath, message: 'data_models 缺 name/file/kind', fields });
    for (const [j, raw] of members(model.fields, `${modelPath}.fields`, 'model.fields').entries()) {
      const field = record(raw) ?? {};
      const missing = [...(!field.name ? ['name'] : []), ...(!field.type || field.type === 'any' ? ['type'] : []), ...(typeof field.required !== 'boolean' ? ['required'] : [])];
      if (missing.length) out.push({ path: `${modelPath}.fields[${j}]`, message: `${model.name}: 字段缺明确类型/required`, fields: missing, consumerError: nullAccessError(raw, 'name') });
    }
  }
  for (const [i, value] of rows(source.interfaces).entries()) {
    const api = record(value) ?? {};
    const apiPath = `${at}.interfaces[${i}]`;
    const fields = [...(!api.class ? ['class'] : []), ...(!api.file ? ['file'] : []), ...(!api.methods?.length ? ['methods'] : [])];
    if (fields.length) out.push({ path: apiPath, message: 'interfaces 缺 class/file/methods', fields });
    for (const [j, raw] of members(api.methods, `${apiPath}.methods`, 'api.methods').entries()) {
      const method = record(raw) ?? {};
      let paramError: string | undefined;
      const invalidParams = !Array.isArray(method.params) || method.params.some((rawParam: unknown) => {
        const error = nullAccessError(rawParam, 'name');
        if (error) { paramError = error; return true; }
        const param = record(rawParam) ?? {};
        return !param.name || !param.type || param.type === 'any';
      });
      const missing = [...(!method.name ? ['name'] : []), ...(!method.return || method.return === 'any' ? ['return'] : []),
        ...(invalidParams ? ['params'] : [])];
      // 原签名谓词短路后才会读 params；保留它实际可触发的异常范围。
      const consumerError = nullAccessError(raw, 'name') || (method.name && method.return && method.return !== 'any' ? paramError : undefined);
      if (missing.length) out.push({ path: `${apiPath}.methods[${j}]`, message: `${api.class}: 方法缺精确签名`, fields: missing, consumerError });
    }
  }
  return out;
}

/** SpecLoader 已有集合判据在 typed 片段中的只读接点；缺失/null 保持合法。 */
export function inspectDesignContentCollections(kind: 'acceptance' | 'contracts' | 'use_cases', value: unknown, at: string): DesignContentIssue[] {
  const source = record(value);
  if (!source) return [];
  const out: DesignContentIssue[] = [];
  const maps = (parent: Row, field: string, path: string): void => {
    const shape = inspectMapArray(parent[field]);
    if (shape.nonArray) out.push({ path, message: '应为数组（YAML list）' });
    for (const i of shape.invalidIndices) out.push({ path: `${path}[${i}]`, message: '应为映射（map）' });
  };
  const strings = (parent: Row, field: string, path: string): void => {
    const shape = inspectStringArray(parent[field]);
    if (shape.nonArray) out.push({ path, message: '应为 string[]' });
    for (const i of shape.invalidIndices) out.push({ path: `${path}[${i}]`, message: '应为非空字符串' });
  };
  const fields = kind === 'acceptance' ? ['criteria', 'boundaries'] : kind === 'contracts'
    ? ['modules', 'data_models', 'interfaces', 'components', 'state_management', 'integration_points'] : ['use_cases'];
  for (const key of fields) maps(source, key, `${at}.${key}`);
  if (kind === 'contracts') for (const [i, raw] of rows(source.state_management).entries()) {
    const state = record(raw); if (!state) continue;
    for (const key of ['contract_refs', 'ordered_steps', 'lifecycle_triggers']) strings(state, key, `${at}.state_management[${i}].${key}`);
    for (const key of ['mutations', 'publications', 'subscriptions', 'consumers']) maps(state, key, `${at}.state_management[${i}].${key}`);
  }
  if (kind === 'use_cases') for (const [i, raw] of rows(source.use_cases).entries()) {
    const uc = record(raw); if (!uc) continue;
    for (const key of ['ui_bindings', 'data_boundaries', 'branches']) maps(uc, key, `${at}.use_cases[${i}].${key}`);
    for (const [j, rawBinding] of rows(uc.ui_bindings).entries()) {
      const ub = record(rawBinding); if (ub) maps(ub, 'user_actions', `${at}.use_cases[${i}].ui_bindings[${j}].user_actions`);
    }
  }
  return out;
}

/** usecase_spec_schema 原逐条规则；顶层元数据和全局非空仍由阶段入口检查。 */
export function inspectUseCaseItem(value: unknown, at: string): DesignContentIssue[] {
  const uc = record(value) ?? {};
  const out: DesignContentIssue[] = [];
  const tag = uc.id ? `use_case[${uc.id}]` : 'use_case[?]';
  const add = (message: string, path: string, fields?: string[]): void => { out.push({ path, message, ...(fields ? { fields } : {}) }); };
  for (const key of ['id', 'coordinator', 'ui_bindings', 'state_model', 'branches']) if (uc[key] === undefined || uc[key] === null) add(`${tag}: 缺少字段 ${key}`, `${at}.${key}`, [key]);
  const take = (value: unknown, label: string, path: string): unknown[] => {
    const issues: string[] = []; const result = takeArray<unknown>(value, label, issues);
    for (const message of issues) add(message, path);
    return result;
  };
  const roleEnum = new Set(['entry', 'progress', 'dialog', 'result', 'passive']);
  for (const [i, raw] of take(uc.ui_bindings, `${tag}.ui_bindings`, `${at}.ui_bindings`).entries()) {
    const ub = record(raw) ?? {}; const p = `${at}.ui_bindings[${i}]`;
    if (!ub.ui) add(`${tag} > ui_binding: 缺少 ui`, `${p}.ui`, ['ui']);
    if (!ub.role) add(`${tag} > ui_binding[${ub.ui ?? '?'}]: 缺少 role`, `${p}.role`, ['role']);
    else if (!roleEnum.has(ub.role)) add(`${tag} > ui_binding[${ub.ui}]: role 非法（当前：${ub.role}）`, `${p}.role`, ['role']);
    if (!Array.isArray(ub.user_actions)) add(`${tag} > ui_binding[${ub.ui ?? '?'}]: user_actions 必须为数组（空数组表示纯展示）`, `${p}.user_actions`, ['user_actions']);
    else for (const [j, rawAction] of ub.user_actions.entries()) {
      const ua = record(rawAction) ?? {}; const actionPath = `${p}.user_actions[${j}]`;
      if (!ua.trigger) add(`${tag} > ui_binding[${ub.ui}] > user_action: 缺少 trigger`, `${actionPath}.trigger`, ['trigger']);
      if (!ua.calls) add(`${tag} > ui_binding[${ub.ui}] > user_action: 缺少 calls（必须是命名函数符号）`, `${actionPath}.calls`, ['calls']);
    }
  }
  const kindEnum = new Set(['cloud', 'storage', 'system']);
  for (const [i, raw] of take(uc.data_boundaries, `${tag}.data_boundaries`, `${at}.data_boundaries`).entries()) {
    const b = record(raw) ?? {}; const p = `${at}.data_boundaries[${i}]`;
    if (!b.name) add(`${tag} > data_boundary: 缺少 name`, `${p}.name`, ['name']);
    if (!b.type) add(`${tag} > data_boundary[${b.name ?? '?'}]: 缺少 type`, `${p}.type`, ['type']);
    if (!b.kind) add(`${tag} > data_boundary[${b.name ?? '?'}]: 缺少 kind`, `${p}.kind`, ['kind']);
    else if (!kindEnum.has(b.kind)) add(`${tag} > data_boundary[${b.name}]: kind 必须属于 {cloud, storage, system}（当前：${b.kind}）`, `${p}.kind`, ['kind']);
    if (!Array.isArray(b.methods) || b.methods.length === 0) add(`${tag} > data_boundary[${b.name ?? '?'}]: methods[] 必填且非空`, `${p}.methods`, ['methods']);
  }
  if (uc.state_model && !Array.isArray(uc.state_model.phases)) add(`${tag}: state_model.phases 必须为数组`, `${at}.state_model.phases`, ['phases']);
  for (const [i, raw] of rows(uc.branches).entries()) {
    const br = record(raw) ?? {}; const p = `${at}.branches[${i}]`;
    if (!br.id) add(`${tag} > branch: 缺少 id`, `${p}.id`, ['id']);
    if (!br.scenario) add(`${tag} > branch[${br.id ?? '?'}]: 缺少 scenario`, `${p}.scenario`, ['scenario']);
    if (!Array.isArray(br.linked_acceptance) || br.linked_acceptance.length === 0) add(`${tag} > branch[${br.id ?? '?'}]: linked_acceptance[] 必填且非空`, `${p}.linked_acceptance`, ['linked_acceptance']);
  }
  return out;
}
