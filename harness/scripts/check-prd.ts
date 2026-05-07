// ============================================================================
// PRD 阶段脚本 Harness — check-prd.ts
// ============================================================================
// 读取 framework/specs/phase-rules/prd-rules.yaml + doc/features/{feature}/PRD.md
// 执行确定性的结构 / 追溯验证。
//
// 检查项（与 prd-rules.yaml 对应）：
//   Structure:     required_chapters, feature_table_format, priority_values,
//                  at_least_one_p0, acceptance_criteria_format, mermaid_flowchart,
//                  exception_table_format, minimum_exception_scenarios,
//                  nfr_quantified, page_description_completeness, metadata_header
//   Traceability:  feature_to_acceptance, acceptance_to_feature
//
// 语义级检查由 AI Harness (verify-prd.md) 完成，不在本脚本范围内。
// ============================================================================

import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import { SpecLoader } from './utils/spec-loader';
import {
  extractHeadings,
  getSectionContent,
  getSubsectionHeadings,
  extractTables,
  extractCodeBlocks,
  extractMetadata,
  tableHasColumns,
  getColumnValues,
} from './utils/markdown-parser';
import * as YAML from 'yaml';
import { parseScope, describeScopeError } from './utils/scope-parser';
import {
  loadCatalog,
  describeCatalogError,
  allModuleNames,
} from './utils/catalog-parser';
import {
  loadGlossary,
  describeGlossaryError,
  lookupTerm,
} from './utils/glossary-parser';
import { resolveAuthoritativePath } from './utils/visual-source-resolver';
import {
  relFeatureFile,
  relGlossary,
  relCatalog,
  VisualHandoffEnforcementMode,
} from '../config';

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

function loadPrd(ctx: CheckContext): string | null {
  return new SpecLoader(ctx.projectRoot)
    .loadFeatureDoc(ctx.projectRoot, ctx.feature, 'PRD.md');
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

function checkRequiredChapters(ctx: CheckContext, prd: string): CheckResult[] {
  const expected = [
    '术语映射表',
    '功能概述', 'Scope 声明', '目标用户与使用场景', '功能清单', '页面/界面描述',
    '业务流程图', '异常/边界场景处理', '非功能性需求', '验收标准',
  ];

  const headingTexts = extractHeadings(prd).map(h => h.text);
  const missing = expected.filter(e => !headingTexts.some(t => t.includes(e)));

  if (missing.length === 0) {
    return [{ id: 'required_chapters', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'required_chapters'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${expected.length} 个必需章节均存在。` }];
  }
  return [{
    id: 'required_chapters', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'required_chapters'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `缺少 ${missing.length} 个必需章节：${missing.join('、')}`,
    suggestion: '请补充缺失的 PRD 章节。',
  }];
}

function checkScopeDeclaration(ctx: CheckContext, prd: string): CheckResult[] {
  const { scope, error } = parseScope(prd);
  if (error) {
    return [{
      id: 'scope_declaration', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
      severity: 'BLOCKER', status: 'FAIL',
      details: describeScopeError(error),
      suggestion:
        '请在「Scope 声明」章节补充 ```yaml 代码块，包含 in_scope_modules（≥1 项）、out_of_scope_modules、rationale 三个字段。',
    }];
  }

  const details = [
    `in_scope_modules: ${scope!.in_scope_modules.join('、')}`,
    `out_of_scope_modules: ${scope!.out_of_scope_modules.join('、') || '（空）'}`,
    `rationale: ${scope!.rationale ? '已填写' : '⚠️ 未填写'}`,
  ].join('；');

  const rationaleWarn = scope!.rationale.length === 0;
  return [{
    id: 'scope_declaration', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
    severity: 'BLOCKER',
    status: rationaleWarn ? 'WARN' : 'PASS',
    details,
    suggestion: rationaleWarn ? '建议补充 rationale 说明为何 out_of_scope_modules 不需要改。' : undefined,
  }];
}

function checkFeatureTableFormat(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '功能清单');
  if (!section) {
    return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「功能清单」章节。' }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'FAIL', details: '「功能清单」中未找到 Markdown 表格。' }];
  }

  const { hasAll, missing } = tableHasColumns(tables[0], ['编号', '功能名称', '优先级', '描述']);
  if (!hasAll) {
    return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'FAIL', details: `功能清单表格缺少列：${missing.join('、')}。实际表头：${tables[0].headers.join('、')}` }];
  }

  return [{ id: 'feature_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'feature_table_format'), severity: 'BLOCKER', status: 'PASS', details: `功能清单表格包含 ${tables[0].rows.length} 行，表头列齐全。` }];
}

function checkPriorityValues(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '功能清单');
  const tables = section ? extractTables(section) : [];
  if (tables.length === 0) {
    return [{ id: 'priority_values', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'priority_values'), severity: 'BLOCKER', status: 'SKIP', details: '功能清单无表格可分析。' }];
  }

  const priorities = getColumnValues(tables[0], '优先级');
  const allowed = new Set(['P0', 'P1', 'P2', 'P3']);
  const invalid = priorities.filter(p => !allowed.has(p));

  if (invalid.length === 0) {
    return [{ id: 'priority_values', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'priority_values'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${priorities.length} 行的优先级值合法。` }];
  }
  return [{
    id: 'priority_values', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'priority_values'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${invalid.length} 个无效的优先级值：${[...new Set(invalid)].join('、')}。允许值：P0/P1/P2/P3`,
  }];
}

function checkAtLeastOneP0(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '功能清单');
  const tables = section ? extractTables(section) : [];
  if (tables.length === 0) {
    return [{ id: 'at_least_one_p0', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'at_least_one_p0'), severity: 'BLOCKER', status: 'SKIP', details: '功能清单无表格。' }];
  }

  const p0Count = getColumnValues(tables[0], '优先级').filter(p => p === 'P0').length;
  if (p0Count > 0) {
    return [{ id: 'at_least_one_p0', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'at_least_one_p0'), severity: 'BLOCKER', status: 'PASS', details: `共 ${p0Count} 个 P0 功能项。` }];
  }
  return [{ id: 'at_least_one_p0', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'at_least_one_p0'), severity: 'BLOCKER', status: 'FAIL', details: '功能清单中没有任何 P0 功能项。' }];
}

function checkAcceptanceCriteriaFormat(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '验收标准');
  if (!section) {
    return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「验收标准」章节。' }];
  }

  const acPattern = /\*\*(AC-[\w]+)\*\*/g;
  const ids = [...section.matchAll(acPattern)].map(m => m[1]);

  if (ids.length === 0) {
    return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'FAIL', details: '「验收标准」中未找到 AC-N 格式编号。' }];
  }

  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'WARN', details: `${ids.length} 条 AC，存在重复编号：${[...new Set(duplicates)].join('、')}` }];
  }

  return [{ id: 'acceptance_criteria_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'acceptance_criteria_format'), severity: 'BLOCKER', status: 'PASS', details: `验收标准包含 ${ids.length} 条唯一 AC 项。` }];
}

function checkMermaidFlowchart(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '业务流程图');
  if (!section) {
    return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'FAIL', details: '未找到「业务流程图」章节。' }];
  }

  const mermaidBlocks = extractCodeBlocks(section, 'mermaid');
  if (mermaidBlocks.length === 0) {
    return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'FAIL', details: '「业务流程图」中未找到 Mermaid 代码块。' }];
  }

  const hasFlowchart = mermaidBlocks.some(b =>
    /flowchart|graph\s+(TD|LR|RL|BT)/i.test(b.content),
  );

  if (!hasFlowchart) {
    return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'WARN', details: `${mermaidBlocks.length} 个 Mermaid 代码块，但未检测到 flowchart 语法。` }];
  }

  return [{ id: 'mermaid_flowchart', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'mermaid_flowchart'), severity: 'BLOCKER', status: 'PASS', details: `找到 ${mermaidBlocks.length} 个 Mermaid 流程图。` }];
}

function checkExceptionTableFormat(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '异常/边界场景处理') ?? getSectionContent(prd, '异常');
  if (!section) {
    return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'FAIL', details: '未找到「异常/边界场景处理」章节。' }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'FAIL', details: '「异常/边界场景处理」中未找到表格。' }];
  }

  const { hasAll, missing } = tableHasColumns(tables[0], ['编号', '异常场景', '处理方式']);
  if (!hasAll) {
    return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'FAIL', details: `异常场景表格缺少列：${missing.join('、')}。实际表头：${tables[0].headers.join('、')}` }];
  }

  return [{ id: 'exception_table_format', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'exception_table_format'), severity: 'MAJOR', status: 'PASS', details: `异常场景表格包含 ${tables[0].rows.length} 行，表头列齐全。` }];
}

function checkMinimumExceptionScenarios(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '异常/边界场景处理') ?? getSectionContent(prd, '异常');
  const tables = section ? extractTables(section) : [];
  if (tables.length === 0) {
    return [{ id: 'minimum_exception_scenarios', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'minimum_exception_scenarios'), severity: 'MAJOR', status: 'SKIP', details: '异常场景章节无表格。' }];
  }

  const rowCount = tables[0].rows.length;
  if (rowCount >= 3) {
    return [{ id: 'minimum_exception_scenarios', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'minimum_exception_scenarios'), severity: 'MAJOR', status: 'PASS', details: `异常场景共 ${rowCount} 种（≥ 3）。` }];
  }
  return [{ id: 'minimum_exception_scenarios', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'minimum_exception_scenarios'), severity: 'MAJOR', status: 'FAIL', details: `异常场景仅 ${rowCount} 种，不满足最低 3 种要求。` }];
}

function checkNfrQuantified(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '非功能性需求');
  if (!section) {
    return [{ id: 'nfr_quantified', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'nfr_quantified'), severity: 'MAJOR', status: 'FAIL', details: '未找到「非功能性需求」章节。' }];
  }

  const numericPattern = /[≤≥<>]\s*\d+|\d+\s*(秒|ms|FPS|fps|MB|KB|dp|%)/;
  if (numericPattern.test(section)) {
    return [{ id: 'nfr_quantified', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'nfr_quantified'), severity: 'MAJOR', status: 'PASS', details: '非功能性需求包含量化数值指标。' }];
  }

  return [{ id: 'nfr_quantified', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'nfr_quantified'), severity: 'MAJOR', status: 'FAIL', details: '「非功能性需求」未包含量化数值指标（如 ≤ 1.5 秒、≥ 54 FPS）。' }];
}

function checkPageDescriptionCompleteness(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '页面/界面描述') ?? getSectionContent(prd, '页面');
  if (!section) {
    return [{ id: 'page_description_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'), severity: 'MAJOR', status: 'FAIL', details: '未找到「页面/界面描述」章节。' }];
  }

  const subsections = (
    getSubsectionHeadings(prd, '页面/界面描述').length > 0
      ? getSubsectionHeadings(prd, '页面/界面描述')
      : getSubsectionHeadings(prd, '页面')
  ).filter(h => !h.text.includes('总览') && !h.text.includes('汇总') && !h.text.includes('概述'));

  if (subsections.length === 0) {
    return [{ id: 'page_description_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'), severity: 'MAJOR', status: 'WARN', details: '未找到页面子章节。' }];
  }

  const requiredCols = ['组件', '类型', '交互行为'];
  const pagesWithoutTable: string[] = [];

  for (const sub of subsections) {
    const subContent = getSectionContent(prd, sub.text);
    if (!subContent) { pagesWithoutTable.push(sub.text); continue; }

    const tables = extractTables(subContent);
    const hasValidTable = tables.some(t => tableHasColumns(t, requiredCols).hasAll);
    if (!hasValidTable) pagesWithoutTable.push(sub.text);
  }

  if (pagesWithoutTable.length === 0) {
    return [{ id: 'page_description_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'), severity: 'MAJOR', status: 'PASS', details: `全部 ${subsections.length} 个页面均有组件表格。` }];
  }

  return [{
    id: 'page_description_completeness', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'page_description_completeness'),
    severity: 'MAJOR', status: 'WARN',
    details: `${pagesWithoutTable.length} 个页面缺少组件表格：${pagesWithoutTable.join('、')}`,
    suggestion: '每个页面子章节应包含组件表格（至少含"组件、类型、交互行为"三列）。',
  }];
}

function checkMetadataHeader(ctx: CheckContext, prd: string): CheckResult[] {
  const metadata = extractMetadata(prd);
  const required = ['模块标识', '版本', '创建日期', '状态'];
  const missing = required.filter(f => !metadata[f]);

  if (missing.length === 0) {
    return [{ id: 'metadata_header', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'metadata_header'), severity: 'MINOR', status: 'PASS', details: `元数据齐全：${Object.keys(metadata).join('、')}` }];
  }
  return [{ id: 'metadata_header', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'metadata_header'), severity: 'MINOR', status: 'WARN', details: `元数据缺少字段：${missing.join('、')}` }];
}

// --------------------------------------------------------------------------
// WP6: Terminology / Catalog Alignment Checks
// --------------------------------------------------------------------------

const TERMINOLOGY_REQUIRED_COLUMNS = [
  '原始术语',
  '权威模块',
  '所属层',
  '置信度',
  '易混项',
  '用户确认',
];

function checkTerminologyMappingTable(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '术语映射表');
  if (!section) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '未找到「术语映射表」章节。Skill 1 Step 1.5 要求 PRD 必须以该章节起始。',
      suggestion: '请在功能概述之前插入 "## 0. 术语映射表" 章节，按模板填写映射表。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '「术语映射表」章节未找到 Markdown 表格。',
      suggestion: '请参考 framework/skills/1-prd-design/templates/prd-template.md 中的表格格式。',
    }];
  }

  const table = tables[0];
  const { hasAll, missing } = tableHasColumns(table, TERMINOLOGY_REQUIRED_COLUMNS);
  if (!hasAll) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `术语映射表缺少列：${missing.join('、')}。实际表头：${table.headers.join('、')}`,
    }];
  }

  if (table.rows.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '术语映射表为空。至少列出需求中出现的主要业务名词（即便是极简需求也不可省略）。',
    }];
  }

  // 过滤模板占位行（原始术语列仍然是 `{术语1}` 之类的）
  const realRows = table.rows.filter(row => {
    const term = (row[0] || '').trim();
    return term.length > 0 && !/^\{.*\}$/.test(term);
  });
  if (realRows.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '术语映射表仅包含模板占位行（形如 `{术语1}`），未填写真实业务术语。',
    }];
  }

  const confirmIdx = table.headers.findIndex(h => h.includes('用户确认'));
  const moduleIdx = table.headers.findIndex(h => h.includes('权威模块'));
  const termIdx = 0;

  const unconfirmed: string[] = [];
  realRows.forEach(row => {
    const cell = (row[confirmIdx] || '').trim();
    const isConfirmed = /\[[xX]\]/.test(cell);
    if (!isConfirmed) unconfirmed.push((row[termIdx] || '(空)').trim());
  });

  if (unconfirmed.length > 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `${unconfirmed.length} 条术语映射未获得用户确认（用户确认列不是 [x]）：${unconfirmed.join('、')}`,
      suggestion:
        '本项目不启用 auto-approve。AI 必须停下来等用户对每一条映射逐个回复确认，再把 [ ] 改为 [x]。',
    }];
  }

  // 校验 canonical_module 必须存在于 module-catalog.yaml
  const catalogResult = loadCatalog(ctx.projectRoot);
  if (!catalogResult.ok) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `模块画像加载失败：${describeCatalogError(catalogResult.error)}`,
    }];
  }

  const knownModules = new Set(allModuleNames(catalogResult.catalog));
  const unknown: Array<{ term: string; module: string }> = [];
  realRows.forEach(row => {
    const term = (row[termIdx] || '').trim();
    const mod = (row[moduleIdx] || '').trim();
    if (!mod) return;
    // 支持「候选①：A / 候选②：B」形式的未命中行（含非模块名分隔符），只校验第一个候选
    const primary = mod.split(/[\/／,，]/)[0].replace(/候选[①②③]?[:：]\s*/g, '').trim();
    if (primary && !knownModules.has(primary)) {
      unknown.push({ term, module: primary });
    }
  });

  if (unknown.length > 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `${unknown.length} 条术语的权威模块不在 ${relCatalog(ctx.projectRoot)} 内：${unknown.map(u => `${u.term}→${u.module}`).join('、')}`,
      suggestion: `请检查模块名拼写，或先把真实存在的新模块补充到 ${relCatalog(ctx.projectRoot)} 再写 PRD。`,
    }];
  }

  // 校验已确认映射是否与 glossary 矛盾（防"用户漫不经心勾 [x]"路径）
  const glossaryResult = loadGlossary(ctx.projectRoot);
  if (!glossaryResult.ok) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'WARN',
      details: `${realRows.length} 条术语均已确认且对齐 catalog，但 glossary 校验跳过：${describeGlossaryError(glossaryResult.error)}`,
    }];
  }

  const conflicts: Array<{ term: string; picked: string; canonical: string }> = [];
  realRows.forEach(row => {
    const term = (row[termIdx] || '').trim();
    const picked = (row[moduleIdx] || '').trim().split(/[\/／,，]/)[0]
      .replace(/候选[①②③]?[:：]\s*/g, '').trim();
    if (!term || !picked) return;

    const hit = lookupTerm(glossaryResult.glossary, term);
    if (!hit) return; // 术语不在 glossary，不做强校验（新术语允许进入）
    if (hit.term.canonical_module !== picked) {
      conflicts.push({
        term,
        picked,
        canonical: hit.term.canonical_module,
      });
    }
  });

  if (conflicts.length > 0) {
    const parts = conflicts.map(
      c => `「${c.term}」用户确认了 ${c.picked}，但 glossary 权威映射是 ${c.canonical}`,
    );
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `${conflicts.length} 条用户已确认的映射与 ${relGlossary(ctx.projectRoot)} 冲突：${parts.join('；')}`,
      suggestion:
        `两种合法处理：(1) 按 glossary 修正 PRD 映射；(2) 若确认要覆盖 glossary，先显式修改 ${relGlossary(ctx.projectRoot)} 中该术语的 canonical_module 并注明 user-approved 日期，再跑 check。`,
    }];
  }

  return [{
    id: 'terminology_mapping_table', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
    severity: 'BLOCKER', status: 'PASS',
    details: `${realRows.length} 条术语全部已确认，权威模块对齐 module-catalog，与 glossary 无冲突。`,
  }];
}

function checkScopeMatchesCatalog(ctx: CheckContext, prd: string): CheckResult[] {
  const { scope, error } = parseScope(prd);
  if (error) {
    return [{
      id: 'scope_matches_catalog', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `Scope 声明解析失败，跳过 catalog 对齐校验：${describeScopeError(error)}`,
    }];
  }

  const catalogResult = loadCatalog(ctx.projectRoot);
  if (!catalogResult.ok) {
    return [{
      id: 'scope_matches_catalog', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `模块画像加载失败：${describeCatalogError(catalogResult.error)}`,
    }];
  }

  const known = new Set(allModuleNames(catalogResult.catalog));
  const invalidIn = scope!.in_scope_modules.filter(m => !known.has(m));
  const invalidOut = scope!.out_of_scope_modules.filter(m => !known.has(m));

  if (invalidIn.length === 0 && invalidOut.length === 0) {
    return [{
      id: 'scope_matches_catalog', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
      severity: 'BLOCKER', status: 'PASS',
      details: `Scope 声明中全部 ${scope!.in_scope_modules.length + scope!.out_of_scope_modules.length} 个模块名均存在于 ${relCatalog(ctx.projectRoot)}。`,
    }];
  }

  const detailParts: string[] = [];
  if (invalidIn.length > 0) detailParts.push(`in_scope_modules 未收录：${invalidIn.join('、')}`);
  if (invalidOut.length > 0) detailParts.push(`out_of_scope_modules 未收录：${invalidOut.join('、')}`);

  return [{
    id: 'scope_matches_catalog', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'scope_matches_catalog'),
    severity: 'BLOCKER', status: 'FAIL',
    details: detailParts.join('；'),
    suggestion:
      `请确认模块名拼写是否正确；若确实是新模块，先更新 ${relCatalog(ctx.projectRoot)} 再写 PRD。`,
  }];
}

// --------------------------------------------------------------------------
// C1a: 术语映射表的权威模块必须出现在 Scope 声明里
// --------------------------------------------------------------------------

function checkTerminologyModulesWithinScope(ctx: CheckContext, prd: string): CheckResult[] {
  const section = getSectionContent(prd, '术语映射表');
  if (!section) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '未找到「术语映射表」章节（已由 terminology_mapping_table 报告）。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '术语映射表无 markdown 表格（已由 terminology_mapping_table 报告）。',
    }];
  }

  const table = tables[0];
  const moduleIdx = table.headers.findIndex(h => h.includes('权威模块'));
  if (moduleIdx < 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '术语映射表缺少「权威模块」列（已由 terminology_mapping_table 报告）。',
    }];
  }

  const realRows = table.rows.filter(row => {
    const term = (row[0] || '').trim();
    return term.length > 0 && !/^\{.*\}$/.test(term);
  });
  if (realRows.length === 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '术语映射表只有占位行（已由 terminology_mapping_table 报告）。',
    }];
  }

  const { scope, error } = parseScope(prd);
  if (!scope) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `Scope 声明解析失败，无法做交叉校验：${error ? describeScopeError(error) : '未知原因'}。`,
    }];
  }

  const scopeSet = new Set<string>([
    ...scope.in_scope_modules,
    ...scope.out_of_scope_modules,
  ]);

  const missing: Array<{ term: string; module: string }> = [];
  for (const row of realRows) {
    const term = (row[0] || '').trim();
    const modCell = (row[moduleIdx] || '').trim();
    if (!modCell) continue;
    // 仅取首个候选作为权威模块（与 terminology_mapping_table check 同口径）
    const primary = modCell.split(/[\/／,，]/)[0]
      .replace(/候选[①②③]?[:：]\s*/g, '').trim();
    if (!primary) continue;
    if (!scopeSet.has(primary)) {
      missing.push({ term, module: primary });
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'terminology_modules_within_scope', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
      severity: 'BLOCKER', status: 'PASS',
      details: `术语映射表中全部 ${realRows.length} 条权威模块均已在 Scope 声明中出现。`,
    }];
  }

  return [{
    id: 'terminology_modules_within_scope', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'terminology_modules_within_scope'),
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `${missing.length} 条术语的权威模块既不在 in_scope_modules 也不在 out_of_scope_modules：` +
      missing.map(x => `${x.term}→${x.module}`).join('、'),
    suggestion:
      '两种合法处理：\n' +
      '(1) 把这些模块补进 in_scope_modules（本需求确实要改）或 out_of_scope_modules（仅消歧用、不改）；\n' +
      '(2) 若该术语本来就不在本需求语境，从术语映射表里删除该行。',
    affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, 'PRD.md')],
  }];
}

// --------------------------------------------------------------------------
// C1b: glossary 术语在正文出现但未进术语映射表 → WARN（兜底网）
// --------------------------------------------------------------------------

function checkGlossaryTermsUsedInBody(ctx: CheckContext, prd: string): CheckResult[] {
  const glossaryResult = loadGlossary(ctx.projectRoot);
  if (!glossaryResult.ok) {
    return [{
      id: 'glossary_terms_used_in_body', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
      severity: 'MAJOR', status: 'SKIP',
      details: `glossary 加载失败，本 check 跳过：${describeGlossaryError(glossaryResult.error)}`,
    }];
  }

  const glossary = glossaryResult.glossary;
  if (glossary.terms.length === 0) {
    return [{
      id: 'glossary_terms_used_in_body', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
      severity: 'MAJOR', status: 'SKIP',
      details: 'glossary 暂无术语条目，无法反向扫描。',
    }];
  }

  // 1. 抽出术语映射表里已声明的所有 term（含同 glossary 条目的 alias 传递）
  const tableCovered = new Set<string>();
  const tableSection = getSectionContent(prd, '术语映射表');
  if (tableSection) {
    const tables = extractTables(tableSection);
    if (tables.length > 0) {
      for (const row of tables[0].rows) {
        const term = (row[0] || '').trim();
        if (!term || /^\{.*\}$/.test(term)) continue;
        // 表里这一行可能写的是 "Toast / 基础组件" 这种合写形式，先按 / ， 拆开
        for (const piece of term.split(/[\/／,，]/)) {
          const p = piece.trim();
          if (!p) continue;
          tableCovered.add(p);
          const hit = lookupTerm(glossary, p);
          if (hit) {
            tableCovered.add(hit.term.term);
            for (const a of hit.term.aliases) tableCovered.add(a);
          }
        }
      }
    }
  }

  // 2. 构造"正文"——把术语映射表整段从 PRD 里挖掉，剩下的就是 body
  const body = tableSection ? prd.split(tableSection).join('') : prd;

  // 3. 逐术语反向扫描：term/aliases 命中 body 但未在 tableCovered → WARN
  const missing: Array<{ canonical_term: string; appeared_as: string; module: string }> = [];
  for (const t of glossary.terms) {
    const variants = [t.term, ...t.aliases].filter(v => v && v.length > 0);
    if (variants.some(v => tableCovered.has(v))) continue;
    const seen = variants.find(v => body.includes(v));
    if (!seen) continue;
    missing.push({
      canonical_term: t.term,
      appeared_as: seen,
      module: t.canonical_module,
    });
  }

  if (missing.length === 0) {
    return [{
      id: 'glossary_terms_used_in_body', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
      severity: 'MAJOR', status: 'PASS',
      details: 'PRD 正文使用的 glossary 术语均已在术语映射表中显式声明。',
    }];
  }

  return [{
    id: 'glossary_terms_used_in_body', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
    severity: 'MAJOR', status: 'WARN',
    details:
      `${missing.length} 个 glossary 术语在 PRD 正文出现但未进术语映射表：` +
      missing.map(x =>
        x.appeared_as === x.canonical_term
          ? `${x.appeared_as}(→${x.module})`
          : `${x.appeared_as}[→${x.canonical_term} → ${x.module}]`,
      ).join('、'),
    suggestion:
      '若这些词确实是业务术语 → 加进术语映射表并勾选 [x]，避免 Skill 2 / 3 阶段因术语歧义改错模块；\n' +
      '若只是正文里偶然带过的非业务用词 → 可直接忽略本 WARN（不会升级为 BLOCKER）。',
    affected_files: [
      relFeatureFile(ctx.projectRoot, ctx.feature, 'PRD.md'),
      relGlossary(ctx.projectRoot),
    ],
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkFeatureToAcceptance(ctx: CheckContext, prd: string): CheckResult[] {
  const featureSection = getSectionContent(prd, '功能清单');
  const featureTables = featureSection ? extractTables(featureSection) : [];
  if (featureTables.length === 0) {
    return [{ id: 'feature_to_acceptance', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'), severity: 'BLOCKER', status: 'SKIP', details: '功能清单无表格。' }];
  }

  const featureIds = getColumnValues(featureTables[0], '编号');
  const priorities = getColumnValues(featureTables[0], '优先级');
  const p0p1: string[] = [];
  for (let i = 0; i < featureIds.length; i++) {
    if (priorities[i] === 'P0' || priorities[i] === 'P1') p0p1.push(featureIds[i]);
  }

  const acSection = getSectionContent(prd, '验收标准');
  if (!acSection) {
    return [{ id: 'feature_to_acceptance', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'), severity: 'BLOCKER', status: 'FAIL', details: '未找到验收标准章节。' }];
  }

  const refPattern = /\*\*AC-[\w]+\*\*\s*\(([^)]+)\)/g;
  const referencedFeatures = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = refPattern.exec(acSection)) !== null) {
    m[1].split(/[,，]/).map(r => r.trim()).forEach(r => referencedFeatures.add(r));
  }

  const uncovered = p0p1.filter(f => !referencedFeatures.has(f));

  if (uncovered.length === 0) {
    return [{ id: 'feature_to_acceptance', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${p0p1.length} 个 P0/P1 功能均有验收标准。` }];
  }
  return [{
    id: 'feature_to_acceptance', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'feature_to_acceptance'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${uncovered.length}/${p0p1.length} 个 P0/P1 功能缺少 AC：${uncovered.join('、')}`,
    suggestion: '请为每个 P0/P1 功能添加至少一条验收标准。',
  }];
}

function checkAcceptanceToFeature(ctx: CheckContext, prd: string): CheckResult[] {
  const acSection = getSectionContent(prd, '验收标准');
  if (!acSection) {
    return [{ id: 'acceptance_to_feature', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'), severity: 'BLOCKER', status: 'SKIP', details: '未找到验收标准章节。' }];
  }

  const acItemPattern = /\*\*(AC-[\w]+)\*\*(?:\s*\(([^)]*)\))?/g;
  const items: Array<{ id: string; hasRef: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = acItemPattern.exec(acSection)) !== null) {
    const isGeneral = m[1].startsWith('AC-G');
    items.push({ id: m[1], hasRef: isGeneral || (!!m[2] && m[2].trim().length > 0) });
  }

  if (items.length === 0) {
    return [{ id: 'acceptance_to_feature', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'), severity: 'BLOCKER', status: 'SKIP', details: '未找到 AC 项。' }];
  }

  const orphaned = items.filter(i => !i.hasRef);
  if (orphaned.length === 0) {
    return [{ id: 'acceptance_to_feature', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${items.length} 条 AC 均关联到功能编号。` }];
  }
  return [{
    id: 'acceptance_to_feature', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'acceptance_to_feature'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${orphaned.length} 条 AC 未关联功能编号：${orphaned.map(o => o.id).join('、')}`,
    suggestion: '格式：**AC-1** (F1): 描述...',
  }];
}

// --------------------------------------------------------------------------
// Visual Handoff（PRD 内含根字段 ui_change 的 yaml 代码块）
// --------------------------------------------------------------------------

const UI_CHANGE_ALLOWED = new Set([
  'none',
  'reuse_only',
  'impl_out_of_band',
  'new_or_changed',
  'copy_edits_only',
]);

const UI_CHANGE_NO_REFS = new Set(['none', 'reuse_only', 'impl_out_of_band']);

const PATH_KINDS = new Set(['repo_assets', 'screenshot_pack']);
const URL_KINDS = new Set(['design_tool_link', 'design_system_doc', 'portal_only']);
/** 每条 ref 允许 path 或 url 至少其一 */
const HYBRID_KINDS = new Set(['figma_export_bundle']);

const ALL_KINDS = new Set([...PATH_KINDS, ...URL_KINDS, ...HYBRID_KINDS]);

function buildVisualResolveOpts(ctx: CheckContext) {
  const vs = ctx.prdVisualSources;
  return {
    projectRoot: ctx.projectRoot,
    externalRoots: vs?.external_roots,
    allowAbsolutePaths: Boolean(vs?.allow_absolute_paths),
    allowNetworkPaths: Boolean(vs?.allow_network_paths),
  };
}

interface AuthRefsOutcome {
  rows: import('./utils/types').VisualHandoffResolutionRow[];
  /** 非法结构、非法 URL、path 语法错误 → 应按 strict 语义处理 */
  blockingDetails: string[];
  /** path 语法合法但未 existsSync → WARN（reachable/warn）或 FAIL（implicit strict / explicit strict） */
  reachabilityDetails: string[];
}

function validateAuthoritativeRefs(ctx: CheckContext, kind: string, refs: unknown): AuthRefsOutcome {
  const rows: import('./utils/types').VisualHandoffResolutionRow[] = [];
  const blocking: string[] = [];
  const reach: string[] = [];

  if (!Array.isArray(refs) || refs.length === 0) {
    return {
      rows: [],
      blockingDetails: ['authoritative_refs 必须为非空数组'],
      reachabilityDetails: [],
    };
  }

  const ropts = buildVisualResolveOpts(ctx);

  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      blocking.push(`refs[${i}] 必须为对象`);
      continue;
    }
    const rec = r as Record<string, unknown>;
    const id = rec.id !== undefined ? String(rec.id) : `#${i}`;

    if (PATH_KINDS.has(kind)) {
      const p = rec.path;
      if (typeof p !== 'string' || !p.trim()) {
        blocking.push(`${id}：缺少非空 path（kind=${kind}）`);
        continue;
      }
      const resolved = resolveAuthoritativePath(p, ropts);
      rows.push({
        ref_id: id,
        declared_path: p,
        resolved_absolute: resolved.resolvedAbsolute,
        agent_reachable: resolved.agentReachable,
        resolution_kind: resolved.resolutionKind,
        ...(resolved.error ? { note: resolved.error } : {}),
      });
      if (resolved.resolutionKind === 'error') {
        blocking.push(`${id}：${resolved.error ?? 'path 非法'}`);
      } else if (!resolved.agentReachable) {
        reach.push(`${id}：${resolved.error ?? 'path 解析后不存在或不可访问'}`);
      }
      continue;
    }

    if (URL_KINDS.has(kind)) {
      const u = rec.url;
      if (typeof u !== 'string' || !u.trim()) {
        blocking.push(`${id}：缺少非空 url（kind=${kind}）`);
        continue;
      }
      rows.push({
        ref_id: id,
        declared_url: u.trim(),
        agent_reachable: true,
        resolution_kind: 'url_only',
      });
      try {
        const parsed = new URL(u.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          blocking.push(`${id}：url 仅允许 http/https`);
        }
      } catch {
        blocking.push(`${id}：url 不是合法 URL`);
      }
      continue;
    }

    if (HYBRID_KINDS.has(kind)) {
      const p = rec.path;
      const u = rec.url;
      const hasPath = typeof p === 'string' && p.trim().length > 0;
      const hasUrl = typeof u === 'string' && u.trim().length > 0;
      if (!hasPath && !hasUrl) {
        blocking.push(`${id}：figma_export_bundle 的每条 ref 须至少含 path 或 url`);
        continue;
      }
      if (hasPath) {
        const resolved = resolveAuthoritativePath(p as string, ropts);
        rows.push({
          ref_id: id,
          declared_path: p as string,
          resolved_absolute: resolved.resolvedAbsolute,
          agent_reachable: resolved.agentReachable,
          resolution_kind: resolved.resolutionKind,
          ...(resolved.error ? { note: resolved.error } : {}),
        });
        if (resolved.resolutionKind === 'error') {
          blocking.push(`${id}：${resolved.error ?? 'path 非法'}`);
        } else if (!resolved.agentReachable) {
          reach.push(`${id}：${resolved.error ?? 'path 解析后不存在或不可访问'}`);
        }
      }
      if (hasUrl) {
        try {
          const parsed = new URL((u as string).trim());
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            blocking.push(`${id}：url 仅允许 http/https`);
          }
        } catch {
          blocking.push(`${id}：url 不是合法 URL`);
        }
      }
      continue;
    }

    blocking.push(`未支持的 kind：${kind}`);
    break;
  }

  return { rows, blockingDetails: blocking, reachabilityDetails: reach };
}

function resolveRefsCheckResult(params: {
  desc: string;
  prdRel: string;
  uiChange: string;
  kind: string;
  enforcement: VisualHandoffEnforcementMode | undefined;
  outcome: AuthRefsOutcome;
  checkIdRefs: string;
  checkIdPass: string;
}): CheckResult[] {
  const { desc, prdRel, uiChange, kind, enforcement, outcome, checkIdRefs, checkIdPass } = params;
  const hasBlock = outcome.blockingDetails.length > 0;
  const hasReach = outcome.reachabilityDetails.length > 0;
  const soft = enforcement === 'warn' || enforcement === 'reachable';

  const baseExtras: Pick<CheckResult, 'affected_files' | 'visual_resolution_rows'> = {
    affected_files: [prdRel],
    visual_resolution_rows: outcome.rows,
  };

  if (hasBlock) {
    if (soft) {
      return [{
        id: checkIdRefs,
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details: outcome.blockingDetails.join('；'),
        ...baseExtras,
      }];
    }
    return [{
      id: checkIdRefs,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: outcome.blockingDetails.join('；'),
      ...baseExtras,
    }];
  }

  if (hasReach) {
    if (soft) {
      return [{
        id: checkIdPass,
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details: `agent-reachable=false：${outcome.reachabilityDetails.join('；')}`,
        suggestion: enforcement === 'reachable'
          ? 'reachable 档位：结构化合法但本机路径不可访问时降级为 WARN；请在 agent 可达环境复验或使用 URL 真源说明。'
          : undefined,
        ...baseExtras,
      }];
    }
    return [{
      id: checkIdPass,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: outcome.reachabilityDetails.join('；'),
      ...baseExtras,
    }];
  }

  return [{
    id: checkIdPass,
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: `ui_change=${uiChange}，kind=${kind}；${outcome.rows.length} 条 authoritative_refs 结构化与可达校验通过`,
    ...baseExtras,
  }];
}

function parseVisualHandoffYamlRoot(prd: string): Record<string, unknown> | null {
  const blocks = extractCodeBlocks(prd, 'yaml');
  for (const b of blocks) {
    try {
      const doc = YAML.parse(b.content);
      if (
        doc !== null &&
        typeof doc === 'object' &&
        !Array.isArray(doc) &&
        Object.prototype.hasOwnProperty.call(doc, 'ui_change')
      ) {
        return doc as Record<string, unknown>;
      }
    } catch {
      /* 非本块或非法 yaml，继续 */
    }
  }
  return null;
}

function structureFailOrWarn(enforcement: VisualHandoffEnforcementMode | undefined): {
  severity: 'BLOCKER' | 'MAJOR';
  status: 'FAIL' | 'WARN';
} {
  const soft = enforcement === 'warn' || enforcement === 'reachable';
  return soft
    ? { severity: 'MAJOR', status: 'WARN' }
    : { severity: 'BLOCKER', status: 'FAIL' };
}

/** 供单测白盒调用 */
export function checkVisualHandoff(ctx: CheckContext, prd: string): CheckResult[] {
  const enforcement = ctx.visualHandoffEnforcement;
  const desc = ruleDesc(ctx, 'structure_checks', 'visual_handoff');
  const prdRel = relFeatureFile(ctx.projectRoot, ctx.feature, 'PRD.md');

  if (ctx.skipVisualHandoff) {
    const audit = process.env.HARNESS_SKIP_VISUAL_HANDOFF_REASON || '（未设置 HARNESS_SKIP_VISUAL_HANDOFF_REASON）';
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: `已跳过 Visual Handoff 检查（--skip-visual-handoff）。审计说明：${audit}`,
      affected_files: [prdRel],
    }];
  }

  if (enforcement === 'off') {
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'framework.config.json 中 prd.visual_handoff_enforcement=off',
      affected_files: [prdRel],
    }];
  }

  const pageSection = getSectionContent(prd, '页面/界面描述') ?? '';
  const longPage = pageSection.length >= 800;

  const doc = parseVisualHandoffYamlRoot(prd);
  if (!doc) {
    if (enforcement === undefined) {
      return [];
    }
    if (enforcement === 'strict') {
      return [{
        id: 'visual_handoff_ui_change',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          'PRD 未找到含根字段 `ui_change` 的 ```yaml``` 代码块；已 opt-in prd.visual_handoff_enforcement=strict。',
        suggestion:
          '每条 PRD 须声明 Visual Handoff；若无 UI 形态诉求请设 ui_change: none。',
        affected_files: [prdRel],
      }];
    }

    const out: CheckResult[] = [{
      id: 'visual_handoff_ui_change',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details:
        '未找到含根字段 `ui_change` 的 ```yaml``` 代码块。参见 framework/skills/1-prd-design/reference/visual-handoff.md',
      suggestion:
        '在 PRD 中增加 Visual Handoff 块；若本需求不动 UI，请显式声明 ui_change: none。',
      affected_files: [prdRel],
    }];
    if (longPage && (enforcement === 'warn' || enforcement === 'reachable')) {
      out.push({
        id: 'visual_handoff_heuristic',
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'WARN',
        details:
          '「页面/界面描述」篇幅较长，但未声明 ui_change / Visual Handoff；请确认是否遗漏交接信息。',
        affected_files: [prdRel],
      });
    }
    return out;
  }

  const uiRaw = doc.ui_change;
  const uiChange = typeof uiRaw === 'string' ? uiRaw.trim() : '';
  if (!uiChange || !UI_CHANGE_ALLOWED.has(uiChange)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_handoff_ui_change',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `ui_change 非法或为空：${JSON.stringify(uiRaw)}。允许值：${[...UI_CHANGE_ALLOWED].join('、')}`,
      affected_files: [prdRel],
    }];
  }

  if (UI_CHANGE_NO_REFS.has(uiChange)) {
    return [{
      id: 'visual_handoff',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `ui_change=${uiChange}：不要求 authoritative_refs；Visual Handoff 声明已识别。`,
      affected_files: [prdRel],
    }];
  }

  const vh = doc.visual_handoff;
  if (!vh || typeof vh !== 'object' || Array.isArray(vh)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_handoff_refs',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: 'ui_change 要求补充 `visual_handoff` 对象（含 kind、authoritative_refs）。',
      affected_files: [prdRel],
    }];
  }

  const vhObj = vh as Record<string, unknown>;
  const kind = typeof vhObj.kind === 'string' ? vhObj.kind.trim() : '';
  if (!kind || !ALL_KINDS.has(kind)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_handoff_refs',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `visual_handoff.kind 非法或缺失：${JSON.stringify(vhObj.kind)}。允许：${[...ALL_KINDS].join('、')}`,
      affected_files: [prdRel],
    }];
  }

  const outcome = validateAuthoritativeRefs(ctx, kind, vhObj.authoritative_refs);
  return resolveRefsCheckResult({
    desc,
    prdRel,
    uiChange,
    kind,
    enforcement,
    outcome,
    checkIdRefs: 'visual_handoff_refs',
    checkIdPass: 'visual_handoff',
  });
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

const checker: PhaseChecker = {
  phase: 'prd',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const prd = loadPrd(ctx);
    if (!prd) {
      const prdRel = relFeatureFile(ctx.projectRoot, ctx.feature, 'PRD.md');
      return [{
        id: 'prd_file_exists', category: 'structure',
        description: `${prdRel} 不存在`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `PRD 文件 ${prdRel} 不存在，无法进行任何检查。`,
        affected_files: [prdRel],
      }];
    }

    const results: CheckResult[] = [];

    results.push(...safeRun(() => checkRequiredChapters(ctx, prd), 'required_chapters'));
    results.push(...safeRun(() => checkTerminologyMappingTable(ctx, prd), 'terminology_mapping_table'));
    results.push(...safeRun(() => checkScopeDeclaration(ctx, prd), 'scope_declaration'));
    results.push(...safeRun(() => checkScopeMatchesCatalog(ctx, prd), 'scope_matches_catalog'));
    results.push(...safeRun(() => checkTerminologyModulesWithinScope(ctx, prd), 'terminology_modules_within_scope'));
    results.push(...safeRun(() => checkVisualHandoff(ctx, prd), 'visual_handoff'));
    results.push(...safeRun(() => checkFeatureTableFormat(ctx, prd), 'feature_table_format'));
    results.push(...safeRun(() => checkPriorityValues(ctx, prd), 'priority_values'));
    results.push(...safeRun(() => checkAtLeastOneP0(ctx, prd), 'at_least_one_p0'));
    results.push(...safeRun(() => checkAcceptanceCriteriaFormat(ctx, prd), 'acceptance_criteria_format'));
    results.push(...safeRun(() => checkMermaidFlowchart(ctx, prd), 'mermaid_flowchart'));
    results.push(...safeRun(() => checkExceptionTableFormat(ctx, prd), 'exception_table_format'));
    results.push(...safeRun(() => checkMinimumExceptionScenarios(ctx, prd), 'minimum_exception_scenarios'));
    results.push(...safeRun(() => checkNfrQuantified(ctx, prd), 'nfr_quantified'));
    results.push(...safeRun(() => checkPageDescriptionCompleteness(ctx, prd), 'page_description_completeness'));
    results.push(...safeRun(() => checkMetadataHeader(ctx, prd), 'metadata_header'));

    results.push(...safeRun(() => checkFeatureToAcceptance(ctx, prd), 'feature_to_acceptance'));
    results.push(...safeRun(() => checkAcceptanceToFeature(ctx, prd), 'acceptance_to_feature'));
    results.push(...safeRun(() => checkGlossaryTermsUsedInBody(ctx, prd), 'glossary_terms_used_in_body'));

    return results;
  },
};

export default checker;
