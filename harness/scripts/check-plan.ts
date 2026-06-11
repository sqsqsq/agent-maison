// ============================================================================
// Plan 阶段脚本 Harness — check-plan.ts
// ============================================================================
// 读取 framework/specs/phase-rules/plan-rules.yaml + doc/features/{feature}/plan/plan.md
// + spec.md (交叉验证) 执行确定性的结构 / 追溯验证。
//
// 检查项（与 plan-rules.yaml 对应）：
//   Structure:     required_chapters, scope_declaration, architecture_impact_declared,
//                  architecture_diagram, module_change_table,
//                  file_structure_per_module, data_model_typed,
//                  interface_signatures_complete, component_tree_per_page,
//                  spec_mapping_table, state_management_table,
//                  route_design_table, metadata_header
//   Traceability:  spec_p0_coverage, spec_p1_coverage, mapping_to_file,
//                  plan_to_architecture (条件触发：architecture_impact != none)
//
// 语义级检查由 AI Harness (verify-plan.md) 完成，不在本脚本范围内。
// ============================================================================

import * as fs from 'fs';
import * as YAML from 'yaml';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import { SpecLoader } from './utils/spec-loader';
import {
  architectureMdPath,
  featureFilePath,
  relArchitectureMd,
  relFeatureArtifact,
} from '../config';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { checkContextExplorationArtifact } from './utils/context-exploration';
import { runAcceptanceYamlStructureChecks } from './utils/check-acceptance';
import {
  extractHeadings,
  getSectionContent,
  getSubsectionHeadings,
  extractTables,
  extractCodeBlocks,
  extractMetadata,
  tableHasColumns,
  getColumnValues,
  type MdTable,
} from './utils/markdown-parser';
import {
  parseScope,
  describeScopeError,
  findScopeViolations,
} from './utils/scope-parser';

// --------------------------------------------------------------------------
// 架构影响声明 (architecture_impact) 解析
// --------------------------------------------------------------------------

type ArchitectureImpactKind =
  | 'none'
  | 'dsl_change'
  | 'module_set_change'
  | 'responsibility_rewrite';

const ARCHITECTURE_IMPACT_KINDS: ArchitectureImpactKind[] = [
  'none',
  'dsl_change',
  'module_set_change',
  'responsibility_rewrite',
];

interface ArchitectureImpactSpec {
  impact: ArchitectureImpactKind;
  affected_items: string[];
  architecture_md_updates: string[];
  catalog_updates: string[];
}

type ArchitectureImpactParseError =
  | { kind: 'no_section' }
  | { kind: 'no_yaml_block' }
  | { kind: 'invalid_yaml'; message: string }
  | { kind: 'missing_impact_key' }
  | { kind: 'invalid_impact_value'; value: string }
  | { kind: 'missing_details_when_not_none' };

interface ArchitectureImpactParseResult {
  spec: ArchitectureImpactSpec | null;
  error: ArchitectureImpactParseError | null;
}

function normalizeToStringArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v.map(x => String(x).trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function parseArchitectureImpact(design: string): ArchitectureImpactParseResult {
  const section = getSectionContent(design, '架构影响声明');
  if (!section) return { spec: null, error: { kind: 'no_section' } };

  const yamlBlocks = extractCodeBlocks(section, 'yaml');
  if (yamlBlocks.length === 0) return { spec: null, error: { kind: 'no_yaml_block' } };

  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlBlocks[0].content);
  } catch (err) {
    return { spec: null, error: { kind: 'invalid_yaml', message: (err as Error).message } };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { spec: null, error: { kind: 'invalid_yaml', message: 'yaml 顶层必须是对象' } };
  }

  // 同时兼容两种写法：顶层直接放 impact / 顶层包一层 architecture_impact
  const obj = parsed as Record<string, unknown>;
  const inner = (obj.architecture_impact && typeof obj.architecture_impact === 'object')
    ? (obj.architecture_impact as Record<string, unknown>)
    : obj;

  if (!('impact' in inner)) {
    return { spec: null, error: { kind: 'missing_impact_key' } };
  }
  const value = String(inner.impact).trim();
  if (!ARCHITECTURE_IMPACT_KINDS.includes(value as ArchitectureImpactKind)) {
    return { spec: null, error: { kind: 'invalid_impact_value', value } };
  }

  const spec: ArchitectureImpactSpec = {
    impact: value as ArchitectureImpactKind,
    affected_items: normalizeToStringArray(inner.affected_items),
    architecture_md_updates: normalizeToStringArray(inner.architecture_md_updates),
    catalog_updates: normalizeToStringArray(inner.catalog_updates),
  };

  if (spec.impact !== 'none'
    && (spec.affected_items.length === 0 || spec.architecture_md_updates.length === 0)) {
    return { spec: null, error: { kind: 'missing_details_when_not_none' } };
  }

  return { spec, error: null };
}

function describeArchitectureImpactError(error: ArchitectureImpactParseError): string {
  switch (error.kind) {
    case 'no_section':
      return '未找到「架构影响声明」章节（预期在 Scope 声明下作为 ### 子节）。';
    case 'no_yaml_block':
      return '「架构影响声明」章节内未找到 ```yaml 代码块。';
    case 'invalid_yaml':
      return `架构影响声明 yaml 解析失败：${error.message}`;
    case 'missing_impact_key':
      return 'yaml 缺少 impact 字段（或 architecture_impact.impact）。';
    case 'invalid_impact_value':
      return `impact 取值非法：「${error.value}」，必须是 none / dsl_change / module_set_change / responsibility_rewrite 之一。`;
    case 'missing_details_when_not_none':
      return 'impact != none 时 affected_items 与 architecture_md_updates 必须非空。';
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function loadDoc(ctx: CheckContext, name: string): string | null {
  return new SpecLoader(ctx.projectRoot, undefined, undefined, ctx.frameworkRoot)
    .loadFeatureDoc(ctx.projectRoot, ctx.feature, name);
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

const MAPPING_SECTION_TITLES = ['spec 功能映射表', 'PRD 功能映射表', '功能映射表'] as const;

function getMappingSectionContent(doc: string): string | null {
  for (const title of MAPPING_SECTION_TITLES) {
    const section = getSectionContent(doc, title);
    if (section) return section;
  }
  return null;
}

function headingIncludesMappingTable(headingTexts: string[]): boolean {
  return headingTexts.some((t) => t.includes('功能映射表'));
}

function mappingTableIdValues(table: MdTable): string[] {
  for (const col of ['spec 编号', 'PRD 编号', 'PRD 功能编号', 'spec 功能编号']) {
    const values = getColumnValues(table, col);
    if (values.length > 0) return values;
  }
  return [];
}

function checkRequiredChapters(ctx: CheckContext, design: string): CheckResult[] {
  const expected = [
    'Scope 声明', '模块架构图', '目录/文件结构规划', '数据模型定义', '页面组件树',
    '状态管理方案', '服务层接口定义', '路由/导航设计',
  ];

  const headingTexts = extractHeadings(design).map(h => h.text);
  const missing = expected.filter((e) => !headingTexts.some((t) => t.includes(e)));
  if (!headingIncludesMappingTable(headingTexts)) {
    missing.push('功能映射表');
  }

  if (missing.length === 0) {
    return [{ id: 'required_chapters', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'required_chapters'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${expected.length} 个必需章节均存在。` }];
  }
  return [{
    id: 'required_chapters', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'required_chapters'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `缺少 ${missing.length} 个必需章节：${missing.join('、')}`,
    suggestion: '请补充缺失的plan 文档章节。',
  }];
}

function checkScopeDeclaration(ctx: CheckContext, design: string): CheckResult[] {
  const { scope, error } = parseScope(design);
  if (error) {
    return [{
      id: 'scope_declaration', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
      severity: 'BLOCKER', status: 'FAIL',
      details: describeScopeError(error),
      suggestion:
        '请在「Scope 声明与继承」章节补充 ```yaml 代码块，包含 in_scope_modules（≥1 项）、out_of_scope_modules、rationale。若有扩展，填写 expansions_with_user_approval。',
    }];
  }

  const expansions = scope!.expansions_with_user_approval ?? [];
  const expandedModules = expansions.flatMap(e => e.modules);
  const details = [
    `in_scope_modules: ${scope!.in_scope_modules.join('、')}`,
    expandedModules.length > 0
      ? `已批准扩展: ${expandedModules.join('、')}（共 ${expansions.length} 条记录）`
      : '未声明 scope 扩展',
  ].join('；');

  return [{
    id: 'scope_declaration', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
    severity: 'BLOCKER', status: 'PASS',
    details,
  }];
}

function checkScopeConsistencyWithPrd(
  ctx: CheckContext, design: string, prd: string | null,
): CheckResult[] {
  if (!prd) {
    return [{
      id: 'scope_consistency_with_spec', category: 'traceability',
      description: ruleDesc(ctx, 'structure_checks', 'scope_consistency_with_spec'),
      severity: 'BLOCKER', status: 'SKIP',
      details: 'spec.md 不存在，无法比对 scope 一致性。',
    }];
  }

  const prdParse = parseScope(prd);
  const designParse = parseScope(design);

  if (prdParse.error) {
    return [{
      id: 'scope_consistency_with_spec', category: 'traceability',
      description: ruleDesc(ctx, 'structure_checks', 'scope_consistency_with_spec'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `spec 的 Scope 声明无法解析：${describeScopeError(prdParse.error)}`,
      suggestion: '请先修复 spec 的 Scope 声明（运行 check-spec.ts 查看详情）。',
      affected_files: [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')],
    }];
  }
  if (designParse.error) {
    return [{
      id: 'scope_consistency_with_spec', category: 'traceability',
      description: ruleDesc(ctx, 'structure_checks', 'scope_consistency_with_spec'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `plan 的 Scope 声明无法解析：${describeScopeError(designParse.error)}`,
      suggestion: '请先补齐 plan 的 Scope 声明（见 scope_declaration 检查项）。',
    }];
  }

  const { unauthorizedExpansions, touchingForbidden } = findScopeViolations(
    prdParse.scope!,
    designParse.scope!,
  );

  if (unauthorizedExpansions.length === 0 && touchingForbidden.length === 0) {
    return [{
      id: 'scope_consistency_with_spec', category: 'traceability',
      description: ruleDesc(ctx, 'structure_checks', 'scope_consistency_with_spec'),
      severity: 'BLOCKER', status: 'PASS',
      details: `plan.in_scope_modules ⊆ spec scope（含批准扩展），共 ${designParse.scope!.in_scope_modules.length} 个模块。`,
    }];
  }

  const messages: string[] = [];
  if (unauthorizedExpansions.length > 0) {
    messages.push(`未经用户批准就扩大到 spec 之外的模块：${unauthorizedExpansions.join('、')}`);
  }
  if (touchingForbidden.length > 0) {
    messages.push(`触碰了 spec.out_of_scope_modules：${touchingForbidden.join('、')}`);
  }

  return [{
    id: 'scope_consistency_with_spec', category: 'traceability',
    description: ruleDesc(ctx, 'structure_checks', 'scope_consistency_with_spec'),
    severity: 'BLOCKER', status: 'FAIL',
    details: messages.join('；'),
    suggestion:
      '要么把相关模块从 plan.in_scope_modules 移除并改为就地实现，要么回到 plan 的 Step 2.5.3 发起 scope 扩展提议，用户同意后在 expansions_with_user_approval 中登记。',
    affected_files: [
      relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md'),
      relFeatureArtifact(ctx.projectRoot, ctx.feature, 'plan.md'),
    ],
  }];
}

function checkArchitectureImpactDeclared(ctx: CheckContext, design: string): CheckResult[] {
  const { spec, error } = parseArchitectureImpact(design);
  if (error) {
    return [{
      id: 'architecture_impact_declared', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'architecture_impact_declared'),
      severity: 'BLOCKER', status: 'FAIL',
      details: describeArchitectureImpactError(error),
      suggestion:
        '请在 Scope 声明与继承 下新增 "### 架构影响声明 (architecture_impact)" 子节，'
        + '内含 ```yaml 代码块，至少声明 impact 字段（none / dsl_change / '
        + 'module_set_change / responsibility_rewrite），并在 impact != none 时填写 '
        + 'affected_items 与 architecture_md_updates。参见 plan-template.md。',
    }];
  }

  const detailsParts: string[] = [`impact = ${spec!.impact}`];
  if (spec!.affected_items.length > 0) {
    detailsParts.push(`affected_items: ${spec!.affected_items.length} 项`);
  }
  if (spec!.architecture_md_updates.length > 0) {
    detailsParts.push(`architecture_md_updates: ${spec!.architecture_md_updates.length} 项`);
  }
  if (spec!.catalog_updates.length > 0) {
    detailsParts.push(`catalog_updates: ${spec!.catalog_updates.length} 项`);
  }

  return [{
    id: 'architecture_impact_declared', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'architecture_impact_declared'),
    severity: 'BLOCKER', status: 'PASS',
    details: detailsParts.join('；'),
  }];
}

function checkArchitectureDiagram(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '模块架构图');
  if (!section) {
    return [{ id: 'architecture_diagram', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'architecture_diagram'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「模块架构图」章节。' }];
  }

  const mermaidBlocks = extractCodeBlocks(section, 'mermaid');
  if (mermaidBlocks.length === 0) {
    return [{ id: 'architecture_diagram', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'architecture_diagram'), severity: 'BLOCKER', status: 'FAIL', details: '「模块架构图」中未找到 Mermaid 代码块。' }];
  }

  return [{ id: 'architecture_diagram', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'architecture_diagram'), severity: 'BLOCKER', status: 'PASS', details: `找到 ${mermaidBlocks.length} 个 Mermaid 架构图。` }];
}

function checkModuleChangeTable(ctx: CheckContext, design: string): CheckResult[] {
  const allTables = extractTables(design);
  const matchingTable = allTables.find(t => {
    const hasModule = t.headers.some(h => h.includes('模块') || h.toLowerCase().includes('module'));
    const hasLayer = t.headers.some(h => h.includes('所属层'));
    const hasFormat = t.headers.some(h => h.includes('格式'));
    const hasChangeType = t.headers.some(h => h.includes('变更类型'));
    return hasModule && hasLayer && hasFormat && hasChangeType;
  });

  if (!matchingTable) {
    return [{
      id: 'module_change_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'module_change_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '未找到包含「模块、所属层、格式、变更类型」列的模块变更摘要表。',
      suggestion: '请添加模块变更摘要表，列明每个涉及模块的所属层、格式和变更类型。',
    }];
  }

  return [{ id: 'module_change_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'module_change_table'), severity: 'BLOCKER', status: 'PASS', details: `模块变更摘要表包含 ${matchingTable.rows.length} 个模块条目。` }];
}

function checkFileStructurePerModule(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '目录/文件结构规划');
  if (!section) {
    return [{ id: 'file_structure_per_module', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_structure_per_module'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「目录/文件结构规划」章节。' }];
  }

  const subsections = getSubsectionHeadings(design, '目录/文件结构规划');
  if (subsections.length === 0) {
    return [{ id: 'file_structure_per_module', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_structure_per_module'), severity: 'BLOCKER', status: 'WARN', details: '「目录/文件结构规划」下无模块子章节。' }];
  }

  const modulesWithoutTree: string[] = [];
  for (const sub of subsections) {
    const subContent = getSectionContent(design, sub.text);
    if (!subContent) { modulesWithoutTree.push(sub.text); continue; }

    const codeBlocks = extractCodeBlocks(subContent);
    const hasTreeBlock = codeBlocks.some(b =>
      b.content.includes('├') || b.content.includes('└') ||
      b.content.includes('.ets') || b.content.includes('.json'),
    );
    if (!hasTreeBlock) modulesWithoutTree.push(sub.text);
  }

  if (modulesWithoutTree.length === 0) {
    return [{ id: 'file_structure_per_module', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_structure_per_module'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${subsections.length} 个模块均有目录树规划。` }];
  }

  return [{
    id: 'file_structure_per_module', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'file_structure_per_module'),
    severity: 'BLOCKER', status: 'WARN',
    details: `${modulesWithoutTree.length} 个模块缺少目录树代码块：${modulesWithoutTree.join('、')}`,
    suggestion: '每个模块子章节应使用代码块展示精确到 .ets 文件路径的树形结构。',
  }];
}

function checkDataModelTyped(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '数据模型定义');
  if (!section) {
    return [{ id: 'data_model_typed', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'data_model_typed'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「数据模型定义」章节。' }];
  }

  const tsBlocks = extractCodeBlocks(section).filter(b =>
    ['typescript', 'ts', 'ets', 'arkts', ''].includes(b.language.toLowerCase()),
  );
  const modelBlocks = tsBlocks.filter(b => /\b(interface|class|enum|type)\b/.test(b.content));

  if (modelBlocks.length === 0) {
    return [{ id: 'data_model_typed', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'data_model_typed'), severity: 'BLOCKER', status: 'FAIL', details: '「数据模型定义」中未找到包含 interface/class/enum 的代码块。' }];
  }

  const anyHits: string[] = [];
  for (const block of modelBlocks) {
    for (const line of block.content.split('\n')) {
      if (/:\s*any\b|<any>/.test(line) && !line.trim().startsWith('//')) {
        anyHits.push(line.trim());
      }
    }
  }

  if (anyHits.length > 0) {
    return [{
      id: 'data_model_typed', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'data_model_typed'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `数据模型中使用了 any 类型（${anyHits.length} 处）：\n${anyHits.slice(0, 5).map(h => `  - ${h}`).join('\n')}`,
      suggestion: '请替换 any 为具体类型。',
    }];
  }

  return [{ id: 'data_model_typed', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'data_model_typed'), severity: 'BLOCKER', status: 'PASS', details: `找到 ${modelBlocks.length} 个数据模型代码块，未使用 any 类型。` }];
}

function checkInterfaceSignaturesComplete(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '服务层接口定义');
  if (!section) {
    return [{ id: 'interface_signatures_complete', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'interface_signatures_complete'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「服务层接口定义」章节。' }];
  }

  const codeBlocks = extractCodeBlocks(section).filter(b =>
    ['typescript', 'ts', 'ets', 'arkts', ''].includes(b.language.toLowerCase()),
  );

  if (codeBlocks.length === 0) {
    return [{ id: 'interface_signatures_complete', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'interface_signatures_complete'), severity: 'BLOCKER', status: 'FAIL', details: '「服务层接口定义」中未找到代码块。' }];
  }

  const signatureRe = /(?:async\s+)?\w+\s*\([^)]*\)\s*:\s*\S+/;
  let totalMethods = 0;
  const incomplete: string[] = [];

  for (const block of codeBlocks) {
    for (const line of block.content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('class') || trimmed.startsWith('interface') || trimmed.startsWith('export') || trimmed.startsWith('}') || trimmed.startsWith('{') || trimmed === '') continue;
      if (/\w+\s*\(/.test(trimmed)) {
        totalMethods++;
        if (!signatureRe.test(trimmed)) incomplete.push(trimmed.substring(0, 60));
      }
    }
  }

  if (totalMethods === 0) {
    return [{ id: 'interface_signatures_complete', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'interface_signatures_complete'), severity: 'BLOCKER', status: 'WARN', details: '未检测到方法签名（可能格式与预期不同，由 AI Harness 进一步判断）。' }];
  }

  if (incomplete.length === 0) {
    return [{ id: 'interface_signatures_complete', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'interface_signatures_complete'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${totalMethods} 个方法签名均包含参数类型和返回类型。` }];
  }

  return [{
    id: 'interface_signatures_complete', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'interface_signatures_complete'),
    severity: 'BLOCKER', status: 'WARN',
    details: `${incomplete.length}/${totalMethods} 个方法签名可能不完整：\n${incomplete.slice(0, 5).map(m => `  - ${m}`).join('\n')}`,
    suggestion: '每个方法应包含完整签名：方法名(参数名: 类型): 返回类型',
  }];
}

function checkComponentTreePerPage(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '页面组件树');
  if (!section) {
    return [{ id: 'component_tree_per_page', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'component_tree_per_page'), severity: 'MAJOR', status: 'FAIL', details: '未找到「页面组件树」章节。' }];
  }

  const subsections = getSubsectionHeadings(design, '页面组件树');
  if (subsections.length === 0) {
    return [{ id: 'component_tree_per_page', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'component_tree_per_page'), severity: 'MAJOR', status: 'WARN', details: '「页面组件树」下无页面子章节。' }];
  }

  const pagesWithoutTree: string[] = [];
  for (const sub of subsections) {
    const subContent = getSectionContent(design, sub.text);
    if (!subContent) { pagesWithoutTree.push(sub.text); continue; }

    const hasTree = /[├└│─]/.test(subContent) ||
      extractCodeBlocks(subContent).some(b => /[├└│─]/.test(b.content));
    if (!hasTree) pagesWithoutTree.push(sub.text);
  }

  if (pagesWithoutTree.length === 0) {
    return [{ id: 'component_tree_per_page', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'component_tree_per_page'), severity: 'MAJOR', status: 'PASS', details: `全部 ${subsections.length} 个页面均有组件树。` }];
  }

  return [{
    id: 'component_tree_per_page', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'component_tree_per_page'),
    severity: 'MAJOR', status: 'WARN',
    details: `${pagesWithoutTree.length} 个页面缺少组件树：${pagesWithoutTree.join('、')}`,
    suggestion: '每个页面应有对应的组件树，使用树形文本图展示层级关系。',
  }];
}

function checkPrdMappingTable(ctx: CheckContext, design: string): CheckResult[] {
  const section = getMappingSectionContent(design);
  if (!section) {
    return [{ id: 'spec_mapping_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'spec_mapping_table'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「spec 功能映射表」章节（兼容旧标题「spec 功能映射表」）。' }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{ id: 'spec_mapping_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'spec_mapping_table'), severity: 'BLOCKER', status: 'FAIL', details: '「spec 功能映射表」中未找到表格。' }];
  }

  const table = tables[0];
  const required = ['功能名称', '优先级', '实现模块', '关键文件'];
  const missing: string[] = [];
  for (const req of required) {
    if (!table.headers.some((h) => h.includes(req))) missing.push(req);
  }
  if (mappingTableIdValues(table).length === 0) {
    missing.push('spec 编号（或 spec 编号）');
  }

  if (missing.length > 0) {
    return [{ id: 'spec_mapping_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'spec_mapping_table'), severity: 'BLOCKER', status: 'FAIL', details: `spec 映射表缺少列：${missing.join('、')}。实际表头：${table.headers.join('、')}` }];
  }

  return [{ id: 'spec_mapping_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'spec_mapping_table'), severity: 'BLOCKER', status: 'PASS', details: `spec 功能映射表包含 ${table.rows.length} 行，表头列齐全。` }];
}

function checkStateManagementTable(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '状态管理方案');
  if (!section) {
    return [{ id: 'state_management_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'state_management_table'), severity: 'MAJOR', status: 'FAIL', details: '未找到「状态管理方案」章节。' }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{ id: 'state_management_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'state_management_table'), severity: 'MAJOR', status: 'FAIL', details: '「状态管理方案」中未找到表格。' }];
  }

  const hasData = tables[0].headers.some(h => h.includes('数据'));
  const hasDeco = tables[0].headers.some(h => h.includes('装饰器') || h.includes('机制'));

  if (!hasData || !hasDeco) {
    const m: string[] = [];
    if (!hasData) m.push('数据');
    if (!hasDeco) m.push('装饰器/机制');
    return [{ id: 'state_management_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'state_management_table'), severity: 'MAJOR', status: 'FAIL', details: `状态管理表格缺少列：${m.join('、')}。实际表头：${tables[0].headers.join('、')}` }];
  }

  return [{ id: 'state_management_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'state_management_table'), severity: 'MAJOR', status: 'PASS', details: `状态管理表格包含 ${tables[0].rows.length} 行。` }];
}

function checkRouteDesignTable(ctx: CheckContext, design: string): CheckResult[] {
  const section = getSectionContent(design, '路由/导航设计') ?? getSectionContent(design, '路由');
  if (!section) {
    return [{ id: 'route_design_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'route_design_table'), severity: 'MAJOR', status: 'FAIL', details: '未找到「路由/导航设计」章节。' }];
  }

  const tables = extractTables(section);
  const mermaidBlocks = extractCodeBlocks(section, 'mermaid');

  if (tables.length === 0 && mermaidBlocks.length === 0) {
    return [{ id: 'route_design_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'route_design_table'), severity: 'MAJOR', status: 'FAIL', details: '「路由/导航设计」中未找到表格或 Mermaid 图。' }];
  }

  const parts: string[] = [];
  if (tables.length > 0) parts.push(`${tables.length} 个表格`);
  if (mermaidBlocks.length > 0) parts.push(`${mermaidBlocks.length} 个 Mermaid 图`);
  return [{ id: 'route_design_table', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'route_design_table'), severity: 'MAJOR', status: 'PASS', details: `路由/导航设计包含 ${parts.join(' + ')}。` }];
}

function checkMetadataHeader(ctx: CheckContext, design: string): CheckResult[] {
  const metadata = extractMetadata(design);
  const required = ['模块标识', '版本', '状态'];
  const missing = required.filter(f => !metadata[f]);
  if (!metadata['对应 spec'] && !metadata['对应 spec']) {
    missing.push('对应 spec');
  }

  if (missing.length === 0) {
    return [{ id: 'metadata_header', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'metadata_header'), severity: 'MINOR', status: 'PASS', details: `元数据齐全：${Object.keys(metadata).join('、')}` }];
  }
  return [{ id: 'metadata_header', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'metadata_header'), severity: 'MINOR', status: 'WARN', details: `元数据缺少字段：${missing.join('、')}` }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkPrdCoverage(
  ctx: CheckContext, design: string, prd: string | null, priority: string, checkId: string,
): CheckResult[] {
  if (!prd) {
    return [{ id: checkId, category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', checkId), severity: 'BLOCKER', status: 'SKIP', details: `spec.md 不存在，无法验证 ${priority} 覆盖率。` }];
  }

  const featureSection = getSectionContent(prd, '功能清单');
  const featureTables = featureSection ? extractTables(featureSection) : [];
  if (featureTables.length === 0) {
    return [{ id: checkId, category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', checkId), severity: 'BLOCKER', status: 'SKIP', details: 'spec 功能清单无表格。' }];
  }

  const featureIds = getColumnValues(featureTables[0], '编号');
  const priorities = getColumnValues(featureTables[0], '优先级');
  const targetIds: string[] = [];
  for (let i = 0; i < featureIds.length; i++) {
    if (priorities[i] === priority) targetIds.push(featureIds[i]);
  }

  if (targetIds.length === 0) {
    return [{ id: checkId, category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', checkId), severity: 'BLOCKER', status: 'SKIP', details: `spec 中无 ${priority} 功能。` }];
  }

  const mappingSection = getMappingSectionContent(design);
  if (!mappingSection) {
    return [{ id: checkId, category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', checkId), severity: 'BLOCKER', status: 'FAIL', details: `缺少 spec 功能映射表，无法验证 ${priority} 覆盖率。` }];
  }

  const mappingTables = extractTables(mappingSection);
  if (mappingTables.length === 0) {
    return [{ id: checkId, category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', checkId), severity: 'BLOCKER', status: 'FAIL', details: '映射表无表格。' }];
  }

  const rawIds = mappingTableIdValues(mappingTables[0]);
  const cleanMappedIds = new Set(rawIds.map(id => id.replace(/\(.*?\)/g, '').trim()));
  const uncovered = targetIds.filter(f => !cleanMappedIds.has(f));

  if (uncovered.length === 0) {
    return [{ id: checkId, category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', checkId), severity: 'BLOCKER', status: 'PASS', details: `全部 ${targetIds.length} 个 ${priority} 功能在映射表中均有映射。` }];
  }

  return [{
    id: checkId, category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', checkId),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${uncovered.length}/${targetIds.length} 个 ${priority} 功能未在映射表中：${uncovered.join('、')}`,
    suggestion: `请在 spec 功能映射表中添加缺失的 ${priority} 功能行。`,
  }];
}

function checkMappingToFile(ctx: CheckContext, design: string): CheckResult[] {
  const mappingSection = getMappingSectionContent(design);
  const mappingTables = mappingSection ? extractTables(mappingSection) : [];
  if (mappingTables.length === 0) {
    return [{ id: 'mapping_to_file', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'mapping_to_file'), severity: 'BLOCKER', status: 'SKIP', details: '映射表无数据。' }];
  }

  const keyFiles = getColumnValues(mappingTables[0], '关键文件');
  if (keyFiles.length === 0) {
    return [{ id: 'mapping_to_file', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'mapping_to_file'), severity: 'BLOCKER', status: 'SKIP', details: '映射表无「关键文件」列。' }];
  }

  const mentionedFiles = new Set<string>();
  for (const cell of keyFiles) {
    cell.split(/[,，]/).map(f => f.trim()).filter(Boolean).forEach(f => mentionedFiles.add(f));
  }

  const fileStructureSection = getSectionContent(design, '目录/文件结构规划');
  if (!fileStructureSection) {
    return [{ id: 'mapping_to_file', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'mapping_to_file'), severity: 'BLOCKER', status: 'SKIP', details: '未找到目录/文件结构规划章节。' }];
  }

  const unmatched = [...mentionedFiles].filter(file => !fileStructureSection.includes(file));

  if (unmatched.length === 0) {
    return [{ id: 'mapping_to_file', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'mapping_to_file'), severity: 'BLOCKER', status: 'PASS', details: `映射表中全部 ${mentionedFiles.size} 个关键文件在文件结构规划中均有记录。` }];
  }

  return [{
    id: 'mapping_to_file', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'mapping_to_file'),
    severity: 'BLOCKER', status: 'WARN',
    details: `${unmatched.length} 个关键文件未在文件结构规划中找到：${unmatched.join('、')}`,
    suggestion: '请确保映射表中的关键文件在目录/文件结构规划中有对应条目。',
  }];
}

function checkDesignToArchitecture(ctx: CheckContext, design: string): CheckResult[] {
  const archRel = relArchitectureMd(ctx.projectRoot);
  const archPath = architectureMdPath(ctx.projectRoot);

  // 条件触发：先看 plan 的 architecture_impact 声明
  const { spec, error } = parseArchitectureImpact(design);
  if (error) {
    // 解析失败由 architecture_impact_declared BLOCKER 给用户交代，本项 SKIP
    return [{
      id: 'plan_to_architecture', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_architecture'),
      severity: 'MAJOR', status: 'SKIP',
      details: `无法解析 architecture_impact：${describeArchitectureImpactError(error)}。请先处理 architecture_impact_declared BLOCKER。`,
    }];
  }

  if (spec!.impact === 'none') {
    return [{
      id: 'plan_to_architecture', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_architecture'),
      severity: 'MAJOR', status: 'SKIP',
      details: 'plan 声明 architecture_impact.impact = none，feature 级变更不要求同步 architecture.md（变更历史由 git 与 doc/features/<feature>/ 承担）。',
    }];
  }

  // impact != 'none'：必须有 architecture.md 且其中应当反映已声明的更新
  if (!fs.existsSync(archPath)) {
    return [{
      id: 'plan_to_architecture', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_architecture'),
      severity: 'MAJOR', status: 'FAIL',
      details: `architecture_impact = ${spec!.impact}，但 ${archRel} 不存在。架构级变更必须同步更新架构文档。`,
      affected_files: [archRel],
      suggestion: `请按 plan Step 12 的 ${spec!.impact} 分支更新 ${archRel}，并追加一行架构级变更记录。`,
    }];
  }

  const archContent = fs.readFileSync(archPath, 'utf-8');

  // 启发式：从 affected_items 中抽取候选模块名（PascalCase 英文标识符），
  // 验证这些名字是否在 architecture.md 中已出现
  const candidateNames = new Set<string>();
  for (const item of spec!.affected_items) {
    const matches = item.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g);
    if (matches) matches.forEach(m => candidateNames.add(m));
  }

  if (candidateNames.size === 0) {
    // 未能提取到明显的模块名（例如纯 DSL 调整），留给 AI Harness 做语义校验
    return [{
      id: 'plan_to_architecture', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_architecture'),
      severity: 'MAJOR', status: 'WARN',
      details: `architecture_impact = ${spec!.impact}，共声明 ${spec!.architecture_md_updates.length} 项 architecture_md_updates。脚本无法从 affected_items 中提取可机械匹配的模块名，请由 AI Harness / 人工确认这些更新均已落盘到 ${archRel}。`,
      affected_files: [archRel],
    }];
  }

  const unregistered = [...candidateNames].filter(n => !archContent.includes(n));
  if (unregistered.length === 0) {
    return [{
      id: 'plan_to_architecture', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_architecture'),
      severity: 'MAJOR', status: 'PASS',
      details: `architecture_impact = ${spec!.impact}，affected_items 中的全部 ${candidateNames.size} 个模块名在 ${archRel} 中均已出现。`,
    }];
  }

  return [{
    id: 'plan_to_architecture', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'plan_to_architecture'),
    severity: 'MAJOR', status: 'FAIL',
    details: `architecture_impact = ${spec!.impact}，但 ${unregistered.length} 个 affected_items 中的模块名未在 ${archRel} 中出现：${unregistered.join('、')}`,
    affected_files: [archRel],
    suggestion: `请在 ${archRel} 的「业务模块清单」补齐这些模块，并在「架构级变更记录」追加一行。`,
  }];
}

// --------------------------------------------------------------------------
// Main Checker
// --------------------------------------------------------------------------

function safeRun(fn: () => CheckResult[], checkId: string): CheckResult[] {
  try {
    return fn();
  } catch (err) {
    const e = err as Error;
    const isProgrammerError =
      e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError;
    return [{
      id: checkId, category: 'structure',
      description: `${checkId} 执行异常`,
      severity: isProgrammerError ? 'BLOCKER' : 'MINOR',
      status: isProgrammerError ? 'FAIL' : 'SKIP',
      details: isProgrammerError
        ? `[Harness 内部错误] ${e.message}\n${e.stack ?? ''}`
        : `检查执行时发生错误：${e.message}`,
    }];
  }
}

const CONSTRAINT_CATEGORIES = new Set(['security', 'performance', 'dfx', 'nfr', 'privacy', 'compatibility']);

function checkSpecConstraintTraceability(ctx: CheckContext, plan: string): CheckResult[] {
  const accPath = featureFilePath(ctx.projectRoot, ctx.feature, 'acceptance.yaml');
  if (!fs.existsSync(accPath)) {
    return [{
      id: 'spec_constraint_traceability',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'spec_constraint_traceability'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 不存在，跳过 spec→plan 约束追溯。',
    }];
  }
  let doc: { criteria?: Array<Record<string, unknown>> };
  try {
    doc = YAML.parse(fs.readFileSync(accPath, 'utf-8')) as { criteria?: Array<Record<string, unknown>> };
  } catch (e) {
    return [{
      id: 'spec_constraint_traceability',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'spec_constraint_traceability'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `acceptance.yaml 解析失败：${(e as Error).message}`,
    }];
  }
  const criteria = Array.isArray(doc?.criteria) ? doc.criteria : [];
  const structured = criteria.filter((c) => {
    const cat = String(c.category ?? c.kind ?? '').toLowerCase();
    const id = String(c.id ?? '');
    return CONSTRAINT_CATEGORIES.has(cat) || /^(sec|nfr|dfx|perf)_/i.test(id);
  });
  if (structured.length === 0) {
    return [{
      id: 'spec_constraint_traceability',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'spec_constraint_traceability'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: 'acceptance.yaml 无结构化 NFR/安全/性能/DFX 约束项，跳过追溯。',
    }];
  }
  let contractsText = '';
  const contractsPath = featureFilePath(ctx.projectRoot, ctx.feature, 'contracts.yaml');
  if (fs.existsSync(contractsPath)) {
    contractsText = fs.readFileSync(contractsPath, 'utf-8');
  }
  const haystack = `${plan}\n${contractsText}`;
  const missing = structured
    .map((c) => String(c.id ?? '').trim())
    .filter((id) => id.length > 0 && !haystack.includes(id));
  if (missing.length === 0) {
    return [{
      id: 'spec_constraint_traceability',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'spec_constraint_traceability'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${structured.length} 条结构化约束在 plan/contracts 中有实现引用。`,
    }];
  }
  return [{
    id: 'spec_constraint_traceability',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'spec_constraint_traceability'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `以下约束 id 未在 plan.md 或 contracts.yaml 中找到映射：${missing.join('、')}`,
    suggestion: '在 plan 功能映射表或 contracts.yaml 中补充对应实现项。',
  }];
}

const checker: PhaseChecker = {
  phase: 'plan',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const design = loadDoc(ctx, 'plan.md');
    if (!design) {
      const designRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'plan.md');
      return [{
        id: 'plan_file_exists', category: 'structure',
        description: `${designRel} 不存在`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `plan 文件 ${designRel} 不存在，无法进行任何检查。`,
        affected_files: [designRel],
      }];
    }

    const prd = loadDoc(ctx, 'spec.md');
    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, ['spec.md', 'plan.md']),
    ];

    results.push(...safeRun(() => checkRequiredChapters(ctx, design), 'required_chapters'));
    results.push(...safeRun(() => checkScopeDeclaration(ctx, design), 'scope_declaration'));
    results.push(...safeRun(() => checkScopeConsistencyWithPrd(ctx, design, prd), 'scope_consistency_with_spec'));
    results.push(...safeRun(() => checkArchitectureImpactDeclared(ctx, design), 'architecture_impact_declared'));
    results.push(...safeRun(() => checkArchitectureDiagram(ctx, design), 'architecture_diagram'));
    results.push(...safeRun(() => checkModuleChangeTable(ctx, design), 'module_change_table'));
    results.push(...safeRun(() => checkFileStructurePerModule(ctx, design), 'file_structure_per_module'));
    results.push(...safeRun(() => checkDataModelTyped(ctx, design), 'data_model_typed'));
    results.push(...safeRun(() => checkInterfaceSignaturesComplete(ctx, design), 'interface_signatures_complete'));
    results.push(...safeRun(() => checkComponentTreePerPage(ctx, design), 'component_tree_per_page'));
    results.push(...safeRun(() => checkPrdMappingTable(ctx, design), 'spec_mapping_table'));
    results.push(...safeRun(() => checkStateManagementTable(ctx, design), 'state_management_table'));
    results.push(...safeRun(() => checkRouteDesignTable(ctx, design), 'route_design_table'));
    results.push(...safeRun(() => checkMetadataHeader(ctx, design), 'metadata_header'));

    results.push(
      ...runAcceptanceYamlStructureChecks(ctx, (c, s, id) =>
        ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id),
      ),
    );

    results.push(...safeRun(() => checkPrdCoverage(ctx, design, prd, 'P0', 'spec_p0_coverage'), 'spec_p0_coverage'));
    results.push(...safeRun(() => checkPrdCoverage(ctx, design, prd, 'P1', 'spec_p1_coverage'), 'spec_p1_coverage'));
    results.push(...safeRun(() => checkMappingToFile(ctx, design), 'mapping_to_file'));
    results.push(...safeRun(() => checkSpecConstraintTraceability(ctx, design), 'spec_constraint_traceability'));
    results.push(...safeRun(() => checkDesignToArchitecture(ctx, design), 'plan_to_architecture'));
    results.push(
      ...safeRun(
        () => checkContextExplorationArtifact(ctx.projectRoot, ctx.feature, 'plan', {
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
          frameworkRoot: ctx.frameworkRoot,
        }),
        'context_exploration_gate',
      ),
    );

    return results;
  },
};

export default checker;
