// ============================================================================
// spec 阶段脚本 Harness — check-spec.ts
// ============================================================================
// 读取 framework/specs/phase-rules/spec-rules.yaml + doc/features/{feature}/spec.md
// 执行确定性的结构 / 追溯验证。
//
// 检查项（与 spec-rules.yaml 对应）：
//   Structure:     required_chapters, feature_table_format, priority_values,
//                  at_least_one_p0, acceptance_criteria_format, mermaid_flowchart,
//                  exception_table_format, minimum_exception_scenarios,
//                  nfr_quantified, page_description_completeness, metadata_header
//   Traceability:  feature_to_acceptance, acceptance_to_feature
//
// 语义级检查由 AI Harness (verify-spec.md) 完成，不在本脚本范围内。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
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
import { isSpecVisualHandoffSkipped, dispatchSpecVisualHandoff, isSpecUiSpecSkipped, dispatchSpecUiSpec, isSpecAssetAcquisitionSkipped, dispatchSpecAssetAcquisition } from '../capability-registry';
import { relCatalog, relGlossary, relFeatureArtifact, loadFrameworkConfig } from '../config';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { checkFactsArtifact } from './utils/context-facts';
import { runAcceptanceYamlStructureChecks } from './utils/check-acceptance';
export { dispatchSpecVisualHandoff as checkVisualHandoff };
export { dispatchSpecUiSpec as checkUiSpecStructureBundle };

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
  return new SpecLoader(ctx.projectRoot, undefined, undefined, ctx.frameworkRoot)
    .loadFeatureDoc(ctx.projectRoot, ctx.feature, 'spec.md');
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
    suggestion: '请补充缺失的 spec 章节。',
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

function specMdAffected(ctx: CheckContext): string[] {
  return [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')];
}

/** 导出供单测直接调用（project_scale=small 一次性确认分支，C4 exploration-scale）。 */
export function checkTerminologyMappingTable(ctx: CheckContext, prd: string): CheckResult[] {
  const specAffected = specMdAffected(ctx);
  const section = getSectionContent(prd, '术语映射表');
  if (!section) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '未找到「术语映射表」章节。spec Step 1.5 要求 spec 必须以该章节起始。',
      suggestion: '请在功能概述之前插入 "## 0. 术语映射表" 章节，按模板填写映射表。',
      affected_files: specAffected,
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '「术语映射表」章节未找到 Markdown 表格。',
      suggestion:
        `请参考 framework/profiles/${ctx.resolvedProfile.name}/skills/spec/templates/spec-template.md 中的表格格式。`,
      affected_files: specAffected,
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
      affected_files: specAffected,
    }];
  }

  if (table.rows.length === 0) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '术语映射表为空。至少列出需求中出现的主要业务名词（即便是极简需求也不可省略）。',
      affected_files: specAffected,
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
      affected_files: specAffected,
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
    // C4 exploration-scale：project_scale=small 允许一次性对照 architecture.md 模块清单的
    // 整体确认替代逐行 [x]（红线仍是"须有一次真人/headless 确认"，只是确认粒度从逐行降为一次性）。
    const isSmallScale = loadFrameworkConfig(ctx.projectRoot).project_scale === 'small';
    const onceConfirmed = isSmallScale && /-\s*\[[xX]\]\s*.*一次性确认/.test(section);
    if (!onceConfirmed) {
      return [{
        id: 'terminology_mapping_table', category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
        severity: 'BLOCKER', status: 'FAIL',
        details: `${unconfirmed.length} 条术语映射未获得用户确认（用户确认列不是 [x]）：${unconfirmed.join('、')}`,
        suggestion: isSmallScale
          ? '交互态：逐条确认写回 [x]；或在术语映射表节末追加一行 "- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射"（small 档专用，替代逐行确认）。goal-mode headless：按 user-confirmation-ux.md §9 自动写回并留痕 headless-assumptions.md。'
          : '交互态：须等用户逐条确认后写回 [x]。goal-mode headless：按 user-confirmation-ux.md §9 自动写回 [x] 并留痕 headless-assumptions.md。',
        affected_files: specAffected,
      }];
    }
  }

  const confidenceIdx = table.headers.findIndex(h => h.includes('置信度'));
  const fakeHighWarnings: CheckResult[] = [];
  if (confidenceIdx >= 0) {
    const glossaryForHigh = loadGlossary(ctx.projectRoot);
    if (glossaryForHigh.ok) {
      for (const row of realRows) {
        const term = (row[termIdx] || '').trim();
        const conf = (row[confidenceIdx] || '').trim().toLowerCase();
        if (!term || conf !== 'high') continue;
        const hit = lookupTerm(glossaryForHigh.glossary, term);
        if (!hit) {
          fakeHighWarnings.push({
            id: 'terminology_high_without_glossary',
            category: 'structure',
            description: '术语映射表 high 置信度须 glossary 背书',
            severity: 'MINOR',
            status: 'WARN',
            details: `「${term}」标为 high 但不在 ${relGlossary(ctx.projectRoot)}（含 aliases）中；新术语应标 medium/low 并入 must-review。`,
            suggestion: '将置信度降为 medium/low，或先把术语写入 glossary 后再标 high。',
            affected_files: [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')],
          });
        }
      }
    }
  }

  // 校验 canonical_module 必须存在于 module-catalog.yaml
  const catalogResult = loadCatalog(ctx.projectRoot);
  if (!catalogResult.ok) {
    return [{
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `模块画像加载失败：${describeCatalogError(catalogResult.error)}`,
      affected_files: specAffected,
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
    return [
      ...fakeHighWarnings,
      {
        id: 'terminology_mapping_table', category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
        severity: 'BLOCKER', status: 'FAIL',
        details: `${unknown.length} 条术语的权威模块不在 ${relCatalog(ctx.projectRoot)} 内：${unknown.map(u => `${u.term}→${u.module}`).join('、')}`,
        suggestion: `请检查模块名拼写，或先把真实存在的新模块补充到 ${relCatalog(ctx.projectRoot)} 再写 spec。`,
        affected_files: specAffected,
      },
    ];
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
    return [
      ...fakeHighWarnings,
      {
      id: 'terminology_mapping_table', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'terminology_mapping_table'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `${conflicts.length} 条用户已确认的映射与 ${relGlossary(ctx.projectRoot)} 冲突：${parts.join('；')}`,
      suggestion:
        `两种合法处理：(1) 按 glossary 修正 spec 映射；(2) 若确认要覆盖 glossary，先显式修改 ${relGlossary(ctx.projectRoot)} 中该术语的 canonical_module 并注明 user-approved 日期，再跑 check。`,
      affected_files: specAffected,
    }];
  }

  return [
    ...fakeHighWarnings,
    {
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
      `请确认模块名拼写是否正确；若确实是新模块，先更新 ${relCatalog(ctx.projectRoot)} 再写 spec。`,
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
    affected_files: [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')],
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

  // 2. 构造"正文"——把术语映射表整段从 spec 正文里挖掉，剩下的就是 body
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
      details: 'spec 正文使用的 glossary 术语均已在术语映射表中显式声明。',
    }];
  }

  return [{
    id: 'glossary_terms_used_in_body', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'glossary_terms_used_in_body'),
    severity: 'MAJOR', status: 'WARN',
    details:
      `${missing.length} 个 glossary 术语在 spec 正文出现但未进术语映射表：` +
      missing.map(x =>
        x.appeared_as === x.canonical_term
          ? `${x.appeared_as}(→${x.module})`
          : `${x.appeared_as}[→${x.canonical_term} → ${x.module}]`,
      ).join('、'),
    suggestion:
      '若这些词确实是业务术语 → 加进术语映射表并勾选 [x]，避免 plan / 3 阶段因术语歧义改错模块；\n' +
      '若只是正文里偶然带过的非业务用词 → 可直接忽略本 WARN（不会升级为 BLOCKER）。',
    affected_files: [
      relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md'),
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
// Headless assumptions trace (goal-mode review hint)
// --------------------------------------------------------------------------

function checkHeadlessAssumptionsTrace(ctx: CheckContext): CheckResult[] {
  const specRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const assumptionsRel = specRel.replace(/\/spec\.md$/, '/headless-assumptions.md');
  const assumptionsAbs = path.join(ctx.projectRoot, assumptionsRel);
  if (!fs.existsSync(assumptionsAbs)) return [];
  const content = fs.readFileSync(assumptionsAbs, 'utf-8');
  const autoCount = (content.match(/auto-approved \(goal-mode\)/gi) || []).length;
  if (autoCount === 0) return [];
  return [{
    id: 'headless_assumptions_review',
    category: 'structure',
    description: 'goal-mode 自动确认留痕待复核',
    severity: 'MINOR',
    status: 'WARN',
    details: `${autoCount} 条术语/闸门为 goal-mode 自动确认，待人工复核（见 ${assumptionsRel}）。`,
    affected_files: [assumptionsRel],
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

const checker: PhaseChecker = {
  phase: 'spec',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const prd = loadPrd(ctx);
    if (!prd) {
      const prdRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
      return [{
        id: 'spec_file_exists', category: 'structure',
        description: `${prdRel} 不存在`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `spec 文件 ${prdRel} 不存在，无法进行任何检查。`,
        affected_files: [prdRel],
      }];
    }

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, ['spec.md']),
    ];

    results.push(...safeRun(() => checkRequiredChapters(ctx, prd), 'required_chapters'));
    results.push(...safeRun(() => checkTerminologyMappingTable(ctx, prd), 'terminology_mapping_table'));
    results.push(...safeRun(() => checkHeadlessAssumptionsTrace(ctx), 'headless_assumptions_review'));
    results.push(...safeRun(() => checkScopeDeclaration(ctx, prd), 'scope_declaration'));
    results.push(...safeRun(() => checkScopeMatchesCatalog(ctx, prd), 'scope_matches_catalog'));
    results.push(...safeRun(() => checkTerminologyModulesWithinScope(ctx, prd), 'terminology_modules_within_scope'));
    if (isSpecVisualHandoffSkipped(ctx.resolvedProfile)) {
      results.push({
        id: 'visual_handoff',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'visual_handoff'),
        severity: 'MINOR',
        status: 'SKIP',
        details: `project_profile=${ctx.resolvedProfile.name} 未启用 spec.visual_handoff 脚本守门`,
      });
    } else {
      // visual_handoff 先于 ui_spec：structured_ref_elements 注入 ctx.refElementsManifest，
      // capture-completeness 同 run 优先读内存 manifest（见 capability-registry dispatchSpec*）。
      results.push(...safeRun(() => dispatchSpecVisualHandoff(ctx, prd), 'visual_handoff'));
    }
    if (isSpecUiSpecSkipped(ctx.resolvedProfile)) {
      results.push({
        id: 'ui_spec_structure',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ui_spec_structure'),
        severity: 'MINOR',
        status: 'SKIP',
        details: `project_profile=${ctx.resolvedProfile.name} 未启用 spec.ui_spec 脚本守门`,
      });
    } else {
      results.push(...safeRun(() => dispatchSpecUiSpec(ctx, prd), 'ui_spec_structure'));
    }
    if (!isSpecAssetAcquisitionSkipped(ctx.resolvedProfile)) {
      results.push(...safeRun(() => dispatchSpecAssetAcquisition(ctx), 'asset_acquisition'));
    }
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

    const acceptanceRuleDesc = (
      c: CheckContext,
      s: string,
      id: string,
    ): string =>
      ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id);
    results.push(...runAcceptanceYamlStructureChecks(ctx, acceptanceRuleDesc));

    results.push(...safeRun(() => checkFeatureToAcceptance(ctx, prd), 'feature_to_acceptance'));
    results.push(...safeRun(() => checkAcceptanceToFeature(ctx, prd), 'acceptance_to_feature'));
    results.push(...safeRun(() => checkGlossaryTermsUsedInBody(ctx, prd), 'glossary_terms_used_in_body'));
    results.push(
      ...safeRun(
        () => checkFactsArtifact(ctx.projectRoot, ctx.feature, 'spec', {
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
