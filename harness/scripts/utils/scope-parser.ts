// ============================================================================
// Scope 解析工具
// ============================================================================
// 从 spec.md / plan.md 中提取「Scope 声明」章节内的 yaml 代码块，
// 解析出 in_scope_modules / out_of_scope_modules / rationale /
// inherited_from_prd / expansions_with_user_approval。
//
// 该工具被 check-spec.ts 和 check-plan.ts 共享，
// 避免 scope 守门规则的解析逻辑重复实现。
// ============================================================================

import * as YAML from 'yaml';
import { getSectionContent, extractCodeBlocks } from './markdown-parser';

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface ScopeExpansion {
  modules: string[];
  reason: string;
  approved_by: string;
  approved_at?: string;
}

export interface ScopeSpec {
  in_scope_modules: string[];
  out_of_scope_modules: string[];
  rationale: string;
  /** 仅 plan.md 使用 */
  inherited_from_prd?: boolean;
  /** 仅 plan.md 使用，记录用户已批准的 scope 扩展 */
  expansions_with_user_approval?: ScopeExpansion[];
}

export type ScopeParseError =
  | { kind: 'no_section' }
  | { kind: 'no_yaml_block' }
  | { kind: 'invalid_yaml'; message: string }
  | { kind: 'missing_field'; fields: string[] }
  | { kind: 'empty_in_scope' };

export interface ScopeParseResult {
  scope: ScopeSpec | null;
  error: ScopeParseError | null;
  rawYaml?: string;
}

// --------------------------------------------------------------------------
// 解析
// --------------------------------------------------------------------------

/**
 * 从 markdown 文档中提取 Scope 声明。
 * 兼容章节名 "Scope 声明" / "Scope 声明与继承" / "Scope" 三种。
 */
export function parseScope(markdown: string): ScopeParseResult {
  const candidates = ['Scope 声明与继承', 'Scope 声明', 'Scope'];
  let section: string | null = null;
  for (const name of candidates) {
    section = getSectionContent(markdown, name);
    if (section) break;
  }
  if (!section) {
    return { scope: null, error: { kind: 'no_section' } };
  }

  const yamlBlocks = extractCodeBlocks(section, 'yaml');
  if (yamlBlocks.length === 0) {
    return { scope: null, error: { kind: 'no_yaml_block' } };
  }

  const rawYaml = yamlBlocks[0].content;
  let parsed: unknown;
  try {
    parsed = YAML.parse(rawYaml);
  } catch (err) {
    return {
      scope: null,
      error: { kind: 'invalid_yaml', message: (err as Error).message },
      rawYaml,
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      scope: null,
      error: { kind: 'invalid_yaml', message: 'Scope yaml 顶层必须是对象' },
      rawYaml,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const required = ['in_scope_modules', 'out_of_scope_modules', 'rationale'];
  const missing = required.filter(k => !(k in obj));
  if (missing.length > 0) {
    return {
      scope: null,
      error: { kind: 'missing_field', fields: missing },
      rawYaml,
    };
  }

  const inScope = normalizeModuleList(obj.in_scope_modules);
  const outScope = normalizeModuleList(obj.out_of_scope_modules);
  const rationale = String(obj.rationale ?? '').trim();

  if (inScope.length === 0) {
    return {
      scope: null,
      error: { kind: 'empty_in_scope' },
      rawYaml,
    };
  }

  const scope: ScopeSpec = {
    in_scope_modules: inScope,
    out_of_scope_modules: outScope,
    rationale,
  };

  if ('inherited_from_prd' in obj) {
    scope.inherited_from_prd = Boolean(obj.inherited_from_prd);
  }
  if ('expansions_with_user_approval' in obj && Array.isArray(obj.expansions_with_user_approval)) {
    scope.expansions_with_user_approval = (obj.expansions_with_user_approval as unknown[])
      .map(parseExpansion)
      .filter((e): e is ScopeExpansion => e !== null);
  }

  return { scope, error: null, rawYaml };
}

function normalizeModuleList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function parseExpansion(item: unknown): ScopeExpansion | null {
  if (typeof item !== 'object' || item === null) return null;
  const obj = item as Record<string, unknown>;
  const modules = normalizeModuleList(obj.modules);
  if (modules.length === 0) return null;
  return {
    modules,
    reason: String(obj.reason ?? '').trim(),
    approved_by: String(obj.approved_by ?? '').trim(),
    approved_at: obj.approved_at ? String(obj.approved_at).trim() : undefined,
  };
}

// --------------------------------------------------------------------------
// 比较
// --------------------------------------------------------------------------

/**
 * 计算 design scope 相对于 prd scope 的越界模块。
 * 越界 = plan.in_scope_modules 中存在 spec.in_scope_modules 之外的模块，
 * 且未在 plan.expansions_with_user_approval 中显式登记。
 */
export function findScopeViolations(
  prdScope: ScopeSpec,
  designScope: ScopeSpec,
): { unauthorizedExpansions: string[]; touchingForbidden: string[] } {
  const prdAllowed = new Set(prdScope.in_scope_modules);
  const approvedExpansions = new Set<string>();
  for (const exp of designScope.expansions_with_user_approval ?? []) {
    for (const m of exp.modules) approvedExpansions.add(m);
  }

  const unauthorizedExpansions: string[] = [];
  for (const m of designScope.in_scope_modules) {
    if (!prdAllowed.has(m) && !approvedExpansions.has(m)) {
      unauthorizedExpansions.push(m);
    }
  }

  const prdForbidden = new Set(prdScope.out_of_scope_modules);
  const touchingForbidden: string[] = [];
  for (const m of designScope.in_scope_modules) {
    if (prdForbidden.has(m) && !approvedExpansions.has(m)) {
      touchingForbidden.push(m);
    }
  }

  return { unauthorizedExpansions, touchingForbidden };
}

/**
 * 用人话描述 scope 解析错误。
 */
export function describeScopeError(error: ScopeParseError): string {
  switch (error.kind) {
    case 'no_section':
      return '未找到「Scope 声明」章节。';
    case 'no_yaml_block':
      return '「Scope 声明」章节内未找到 ```yaml 代码块。';
    case 'invalid_yaml':
      return `Scope yaml 解析失败：${error.message}`;
    case 'missing_field':
      return `Scope yaml 缺少必填字段：${error.fields.join('、')}`;
    case 'empty_in_scope':
      return 'Scope yaml 中 in_scope_modules 不能为空。';
  }
}
