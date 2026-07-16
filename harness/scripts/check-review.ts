// ============================================================================
// Review 阶段脚本 Harness — check-review.ts
// ============================================================================
// 读取 framework/specs/phase-rules/review-rules.yaml + doc/features/{feature}/review-report.md
// 执行确定性的结构 / 追溯验证。
//
// 检查项（与 review-rules.yaml 对应）：
//   Structure:     required_chapters, issue_table_format, severity_values,
//                  issue_category_values, statistics_summary,
//                  scope_declaration, conclusion_with_verdict, metadata_header
//   Traceability:  issue_to_file, issue_to_coding_rule, review_scope_to_design
//
// 语义级检查由 AI Harness (verify-review.md) 完成，不在本脚本范围内。
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
  extractTables,
  extractMetadata,
  tableHasColumns,
  getColumnValues,
  extractDeclaredVerdict,
} from './utils/markdown-parser';
import { relFeatureArtifact, relFeatureFile, featureFilePath } from '../config';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import * as crypto from 'crypto';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './utils/confirmation-receipt';
import { checkFactsArtifact } from './utils/context-facts';

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

function loadReviewReport(ctx: CheckContext): string | null {
  return new SpecLoader(ctx.projectRoot, undefined, undefined, ctx.frameworkRoot)
    .loadFeatureDoc(ctx.projectRoot, ctx.feature, 'review-report.md');
}

function loadDesign(ctx: CheckContext): string | null {
  return new SpecLoader(ctx.projectRoot, undefined, undefined, ctx.frameworkRoot)
    .loadFeatureDoc(ctx.projectRoot, ctx.feature, 'plan.md');
}

function checkReviewContext(ctx: CheckContext): CheckResult[] {
  const results: CheckResult[] = [];
  if (!ctx.featureSpec.contracts) {
    results.push({
      id: 'review_context_contracts',
      category: 'structure',
      description: 'Review 阶段需要 contracts.yaml 作为审查边界',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')} 不存在，无法确定源码文件、接口契约和模块边界。`,
      affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
      suggestion: '回到 plan 阶段补齐 contracts.yaml 后重跑 review harness。',
      failure_kind: 'missing_contracts',
      blocking_class: 'review_context',
    });
  }
  if (!ctx.featureSpec.acceptance) {
    results.push({
      id: 'review_context_acceptance',
      category: 'structure',
      description: 'Review 阶段需要 acceptance.yaml 作为验收追溯基准',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${relFeatureFile(ctx.projectRoot, ctx.feature, 'acceptance.yaml')} 不存在，无法审查需求验收覆盖和异常场景处理。`,
      affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, 'acceptance.yaml')],
      suggestion: '回到 spec 阶段提取 acceptance.yaml 后重跑 review harness。',
      failure_kind: 'missing_acceptance',
      blocking_class: 'review_context',
    });
  }
  const files = ctx.featureSpec.contracts?.files ?? [];
  const missingSources = files.filter(f => f.endsWith('.ets') && !fs.existsSync(path.join(ctx.projectRoot, f)));
  if (missingSources.length > 0) {
    results.push({
      id: 'review_context_source_files',
      category: 'structure',
      description: 'Review 阶段需要 contracts.files 声明的源码文件真实存在',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${missingSources.length}/${files.length} 个 contracts.files 源码文件不存在：\n${missingSources.slice(0, 20).map(f => `  - ${f}`).join('\n')}`,
      affected_files: missingSources,
      suggestion: '先确认 coding 阶段是否完成；若 contracts.files 过期，回到 design/coding 同步契约，不要让用户手工猜缺哪一层。',
      failure_kind: 'missing_source_from_contracts',
      blocking_class: 'review_context',
    });
  }
  return results;
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

function checkRequiredChapters(ctx: CheckContext, report: string): CheckResult[] {
  const expectedPairs = [
    ['审查范围'],
    ['审查方法', '审查维度'],
    ['问题清单'],
    ['问题统计'],
    ['修复建议', '修复建议摘要'],
    ['结论', '审查结论'],
  ];

  const headingTexts = extractHeadings(report).map(h => h.text);
  const missing: string[] = [];

  for (const alternatives of expectedPairs) {
    const found = headingTexts.some(t =>
      alternatives.some(alt => t.includes(alt)),
    );
    if (!found) missing.push(alternatives.join(' / '));
  }

  if (missing.length === 0) {
    return [{
      id: 'required_chapters', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'required_chapters'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 ${expectedPairs.length} 个必需章节均存在。`,
    }];
  }
  return [{
    id: 'required_chapters', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'required_chapters'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `缺少 ${missing.length} 个必需章节：${missing.join('、')}`,
    suggestion: '请补充缺失的审查报告章节。',
  }];
}

function checkIssueTableFormat(ctx: CheckContext, report: string): CheckResult[] {
  const section = getSectionContent(report, '问题清单');
  if (!section) {
    return [{
      id: 'issue_table_format', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'issue_table_format'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '未找到「问题清单」章节。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    const hasNoIssueIndicator = /无问题|暂无|无\s*$|问题数.*0|^$/i.test(section.trim());
    if (hasNoIssueIndicator || section.trim().length < 20) {
      return [{
        id: 'issue_table_format', category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'issue_table_format'),
        severity: 'BLOCKER', status: 'PASS',
        details: '「问题清单」为空（无问题），表格格式检查跳过。',
      }];
    }
    return [{
      id: 'issue_table_format', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'issue_table_format'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '「问题清单」中未找到 Markdown 表格。',
    }];
  }

  const requiredCols = [
    '编号',
    '"严重程度" or "严重等级"',
    '分类',
    '问题描述',
    '涉及文件',
    '修复建议',
  ];

  const colAlternatives = requiredCols.map(c => {
    const parts = c.split(' or ').map(s => s.replace(/"/g, '').trim());
    return parts;
  });

  const missingCols: string[] = [];
  for (const alternatives of colAlternatives) {
    const found = tables[0].headers.some(h =>
      alternatives.some(alt => h.includes(alt)),
    );
    if (!found) missingCols.push(alternatives.join('/'));
  }

  if (missingCols.length > 0) {
    return [{
      id: 'issue_table_format', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'issue_table_format'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `问题清单表格缺少列：${missingCols.join('、')}。实际表头：${tables[0].headers.join('、')}`,
    }];
  }

  return [{
    id: 'issue_table_format', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'issue_table_format'),
    severity: 'BLOCKER', status: 'PASS',
    details: `问题清单表格包含 ${tables[0].rows.length} 行，表头列齐全。`,
  }];
}

function getIssueTable(report: string): ReturnType<typeof extractTables>[0] | null {
  const section = getSectionContent(report, '问题清单');
  if (!section) return null;
  const tables = extractTables(section);
  return tables.length > 0 ? tables[0] : null;
}

function checkSeverityValues(ctx: CheckContext, report: string): CheckResult[] {
  const table = getIssueTable(report);
  if (!table) {
    return [{
      id: 'severity_values', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'severity_values'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '问题清单无表格可分析。',
    }];
  }

  const severityCol = table.headers.findIndex(h =>
    h.includes('严重程度') || h.includes('严重等级'),
  );
  if (severityCol === -1) {
    return [{
      id: 'severity_values', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'severity_values'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '问题清单表格无"严重程度"列。',
    }];
  }

  const allowed = new Set(['BLOCKER', 'MAJOR', 'MINOR', 'INFO']);
  const values = table.rows.map(r => (r[severityCol] || '').trim());
  const invalid = values.filter(v => !allowed.has(v));

  if (invalid.length === 0) {
    return [{
      id: 'severity_values', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'severity_values'),
      severity: 'BLOCKER', status: 'PASS',
      details: `全部 ${values.length} 行的严重程度值合法。`,
    }];
  }
  return [{
    id: 'severity_values', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'severity_values'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${invalid.length} 个无效的严重程度值：${[...new Set(invalid)].join('、')}。允许值：BLOCKER/MAJOR/MINOR/INFO`,
  }];
}

function checkIssueCategoryValues(ctx: CheckContext, report: string): CheckResult[] {
  const table = getIssueTable(report);
  if (!table) {
    return [{
      id: 'issue_category_values', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'issue_category_values'),
      severity: 'MAJOR', status: 'SKIP',
      details: '问题清单无表格可分析。',
    }];
  }

  const catCol = table.headers.findIndex(h => h.includes('分类'));
  if (catCol === -1) {
    return [{
      id: 'issue_category_values', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'issue_category_values'),
      severity: 'MAJOR', status: 'SKIP',
      details: '问题清单表格无"分类"列。',
    }];
  }

  const allowed = new Set([
    '分层违规', '接口不一致', '资源引用', '命名规范',
    '硬编码', '逻辑错误', '异常处理', '性能', '安全', '其他',
  ]);

  const values = table.rows.map(r => (r[catCol] || '').trim());
  const invalid = values.filter(v => !allowed.has(v));

  if (invalid.length === 0) {
    return [{
      id: 'issue_category_values', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'issue_category_values'),
      severity: 'MAJOR', status: 'PASS',
      details: `全部 ${values.length} 行的分类值合法。`,
    }];
  }
  return [{
    id: 'issue_category_values', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'issue_category_values'),
    severity: 'MAJOR', status: 'WARN',
    details: `${invalid.length} 个未定义的分类值：${[...new Set(invalid)].join('、')}。建议使用预定义类别。`,
  }];
}

function checkStatisticsSummary(ctx: CheckContext, report: string): CheckResult[] {
  const section = getSectionContent(report, '问题统计');
  if (!section) {
    return [{
      id: 'statistics_summary', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'statistics_summary'),
      severity: 'MAJOR', status: 'FAIL',
      details: '未找到「问题统计」章节。',
    }];
  }

  const severityKeywords = ['BLOCKER', 'MAJOR', 'MINOR', 'INFO'];
  const found = severityKeywords.filter(kw => section.includes(kw));

  if (found.length < 3) {
    return [{
      id: 'statistics_summary', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'statistics_summary'),
      severity: 'MAJOR', status: 'FAIL',
      details: `「问题统计」中仅找到 ${found.length} 个严重程度关键字（${found.join('、')}），期望至少包含 BLOCKER/MAJOR/MINOR/INFO 的计数。`,
    }];
  }

  const table = getIssueTable(report);
  if (table) {
    const severityCol = table.headers.findIndex(h =>
      h.includes('严重程度') || h.includes('严重等级'),
    );
    if (severityCol !== -1) {
      const counts: Record<string, number> = { BLOCKER: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
      for (const row of table.rows) {
        const sev = (row[severityCol] || '').trim();
        if (sev in counts) counts[sev]++;
      }

      const mismatches: string[] = [];
      for (const [sev, count] of Object.entries(counts)) {
        const re = new RegExp(`${sev}[^\\d]*(\\d+)`, 'i');
        const match = section.match(re);
        if (!match) {
          const reReverse = new RegExp(`(\\d+)[^\\d]*${sev}`, 'i');
          const matchRev = section.match(reReverse);
          if (matchRev) {
            const reported = parseInt(matchRev[1], 10);
            if (reported !== count) {
              mismatches.push(`${sev}: 报告 ${reported}, 实际 ${count}`);
            }
          }
        } else {
          const reported = parseInt(match[1], 10);
          if (reported !== count) {
            mismatches.push(`${sev}: 报告 ${reported}, 实际 ${count}`);
          }
        }
      }

      if (mismatches.length > 0) {
        return [{
          id: 'statistics_summary', category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'statistics_summary'),
          severity: 'MAJOR', status: 'WARN',
          details: `问题统计与问题清单计数不一致：\n${mismatches.map(m => `  - ${m}`).join('\n')}`,
          suggestion: '请核对问题统计章节中各严重程度的数量，确保与问题清单表格一致。',
        }];
      }
    }
  }

  return [{
    id: 'statistics_summary', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'statistics_summary'),
    severity: 'MAJOR', status: 'PASS',
    details: `问题统计包含 ${found.join('、')} 的计数汇总。`,
  }];
}

function checkScopeDeclaration(ctx: CheckContext, report: string): CheckResult[] {
  const section = getSectionContent(report, '审查范围');
  if (!section) {
    return [{
      id: 'scope_declaration', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
      severity: 'MAJOR', status: 'FAIL',
      details: '未找到「审查范围」章节。',
    }];
  }

  const hasModuleRef = /模块|Module/i.test(section);
  const hasFileRef = /文件|\.ets|file/i.test(section);
  const hasTables = extractTables(section).length > 0;
  const hasList = /^[\s]*[-*]\s+/m.test(section);

  if (hasModuleRef || hasFileRef || hasTables || hasList) {
    return [{
      id: 'scope_declaration', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
      severity: 'MAJOR', status: 'PASS',
      details: '审查范围包含模块或文件列表信息。',
    }];
  }
  return [{
    id: 'scope_declaration', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'scope_declaration'),
    severity: 'MAJOR', status: 'WARN',
    details: '「审查范围」未明确列出模块列表或文件范围。',
    suggestion: '请在审查范围中明确列出本次审查涉及的模块和文件。',
  }];
}

function checkConclusionWithVerdict(ctx: CheckContext, report: string): CheckResult[] {
  const section = getSectionContent(report, '结论') ?? getSectionContent(report, '审查结论');
  if (!section) {
    return [{
      id: 'conclusion_with_verdict', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'conclusion_with_verdict'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '未找到「结论」或「审查结论」章节。',
    }];
  }

  // 声明式提取：锚定「审查结论:」声明行 + 最长优先，杜绝 '通过'⊂'不通过' 子串误读
  // 与「判定依据/下一步建议」枚举裁决词造成的整段污染。
  const { verdict: foundVerdict } = extractDeclaredVerdict(section, ['有条件通过', '不通过', '通过']);

  if (!foundVerdict) {
    return [{
      id: 'conclusion_with_verdict', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'conclusion_with_verdict'),
      severity: 'BLOCKER', status: 'FAIL',
      details: '「结论」中未找到可机读的审查结论声明行。',
      suggestion: '请在结论中写出明确的声明行，例如 `**审查结论**: 不通过`（裁决词须紧邻在"审查结论:"之后）。',
    }];
  }

  const table = getIssueTable(report);
  if (table) {
    const severityCol = table.headers.findIndex(h =>
      h.includes('严重程度') || h.includes('严重等级'),
    );
    if (severityCol !== -1) {
      const blockerCount = table.rows.filter(r =>
        (r[severityCol] || '').trim() === 'BLOCKER',
      ).length;

      if (blockerCount > 0 && foundVerdict !== '不通过') {
        return [{
          id: 'conclusion_with_verdict', category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'conclusion_with_verdict'),
          severity: 'BLOCKER', status: 'FAIL',
          details: `存在 ${blockerCount} 个 BLOCKER 问题，但结论为"${foundVerdict}"而非"不通过"。`,
          suggestion: '当存在 BLOCKER 级问题时，结论必须为"不通过"。',
        }];
      }

      if (blockerCount === 0 && foundVerdict === '不通过') {
        return [{
          id: 'conclusion_with_verdict', category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'conclusion_with_verdict'),
          severity: 'BLOCKER', status: 'WARN',
          details: `无 BLOCKER 问题，但结论为"不通过"。`,
          suggestion: '无 BLOCKER 时结论通常为"通过"或"有条件通过"。',
        }];
      }
    }
  }

  return [{
    id: 'conclusion_with_verdict', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'conclusion_with_verdict'),
    severity: 'BLOCKER', status: 'PASS',
    details: `结论为"${foundVerdict}"，与问题统计一致。`,
  }];
}

function checkMetadataHeader(ctx: CheckContext, report: string): CheckResult[] {
  const metadata = extractMetadata(report);
  const required = ['模块标识', '审查日期', '审查版本'];
  const missing = required.filter(f => !metadata[f]);

  if (missing.length === 0) {
    return [{
      id: 'metadata_header', category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'metadata_header'),
      severity: 'MINOR', status: 'PASS',
      details: `元数据齐全：${Object.keys(metadata).join('、')}`,
    }];
  }
  return [{
    id: 'metadata_header', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'metadata_header'),
    severity: 'MINOR', status: 'WARN',
    details: `元数据缺少字段：${missing.join('、')}`,
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkIssueToFile(ctx: CheckContext, report: string): CheckResult[] {
  const table = getIssueTable(report);
  if (!table) {
    return [{
      id: 'issue_to_file', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_file'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '问题清单无表格可分析。',
    }];
  }

  const fileCol = table.headers.findIndex(h => h.includes('涉及文件'));
  if (fileCol === -1) {
    return [{
      id: 'issue_to_file', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_file'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '问题清单表格无"涉及文件"列。',
    }];
  }

  const allFiles = new Set<string>();
  for (const row of table.rows) {
    const cell = (row[fileCol] || '').trim();
    cell.split(/[,，\n]/)
      .map(f => f.replace(/`/g, '').trim())
      .filter(f => f.endsWith('.ets') || f.endsWith('.json') || f.endsWith('.json5'))
      .forEach(f => allFiles.add(f));
  }

  if (allFiles.size === 0) {
    return [{
      id: 'issue_to_file', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_file'),
      severity: 'BLOCKER', status: 'SKIP',
      details: '问题清单中无可解析的文件路径。',
    }];
  }

  const missing: string[] = [];
  for (const filePath of allFiles) {
    const fullPath = path.join(ctx.projectRoot, filePath);
    if (!fs.existsSync(fullPath)) missing.push(filePath);
  }

  if (missing.length === 0) {
    return [{
      id: 'issue_to_file', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_file'),
      severity: 'BLOCKER', status: 'PASS',
      details: `问题清单中引用的全部 ${allFiles.size} 个文件均存在。`,
    }];
  }

  return [{
    id: 'issue_to_file', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'issue_to_file'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length}/${allFiles.size} 个引用文件不存在：\n${missing.slice(0, 10).map(f => `  - ${f}`).join('\n')}${missing.length > 10 ? `\n  ... 还有 ${missing.length - 10} 个` : ''}`,
    affected_files: missing,
    suggestion: '请确认问题清单中的文件路径是否正确。',
  }];
}

function checkIssueToCodingRule(ctx: CheckContext, report: string): CheckResult[] {
  const table = getIssueTable(report);
  if (!table) {
    return [{
      id: 'issue_to_coding_rule', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_coding_rule'),
      severity: 'MINOR', status: 'SKIP',
      details: '问题清单无表格可分析。',
    }];
  }

  const catCol = table.headers.findIndex(h => h.includes('分类'));
  if (catCol === -1) {
    return [{
      id: 'issue_to_coding_rule', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_coding_rule'),
      severity: 'MINOR', status: 'SKIP',
      details: '问题清单表格无"分类"列。',
    }];
  }

  const categoryToRule: Record<string, string> = {
    '分层违规': 'layer_compliance / inter_module_dependency',
    '接口不一致': 'interface_signature_consistency',
    '资源引用': 'resource_integrity',
    '命名规范': 'naming_conventions',
    '硬编码': 'no_hardcoded_strings',
    '逻辑错误': 'business_logic_correctness',
    '异常处理': 'error_handling_completeness',
  };

  const categories = table.rows.map(r => (r[catCol] || '').trim()).filter(Boolean);
  const traceable = categories.filter(c => c in categoryToRule);
  const total = categories.length;

  if (total === 0) {
    return [{
      id: 'issue_to_coding_rule', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_coding_rule'),
      severity: 'MINOR', status: 'SKIP',
      details: '问题清单无分类数据。',
    }];
  }

  const ratio = traceable.length / total;
  if (ratio >= 0.7) {
    return [{
      id: 'issue_to_coding_rule', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'issue_to_coding_rule'),
      severity: 'MINOR', status: 'PASS',
      details: `${traceable.length}/${total} (${(ratio * 100).toFixed(0)}%) 条问题的分类可追溯到 coding-rules.yaml。`,
    }];
  }

  return [{
    id: 'issue_to_coding_rule', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'issue_to_coding_rule'),
    severity: 'MINOR', status: 'WARN',
    details: `仅 ${traceable.length}/${total} (${(ratio * 100).toFixed(0)}%) 条问题可追溯到 coding-rules.yaml。`,
    suggestion: '建议使用预定义分类以增强问题到规约的追溯性。',
  }];
}

function checkReviewScopeToDesign(ctx: CheckContext, report: string): CheckResult[] {
  const design = loadDesign(ctx);
  if (!design) {
    return [{
      id: 'review_scope_to_design', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'review_scope_to_design'),
      severity: 'MAJOR', status: 'SKIP',
      details: `plan.md 不存在，无法验证审查范围与plan 文档的一致性。`,
    }];
  }

  const scopeSection = getSectionContent(report, '审查范围');
  if (!scopeSection) {
    return [{
      id: 'review_scope_to_design', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'review_scope_to_design'),
      severity: 'MAJOR', status: 'SKIP',
      details: '审查报告无「审查范围」章节。',
    }];
  }

  const allDesignTables = extractTables(design);
  const changeTable = allDesignTables.find(t => {
    const hasModule = t.headers.some(h => h.includes('模块') || h.toLowerCase().includes('module'));
    const hasChangeType = t.headers.some(h => h.includes('变更类型'));
    return hasModule && hasChangeType;
  });

  if (!changeTable) {
    return [{
      id: 'review_scope_to_design', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'review_scope_to_design'),
      severity: 'MAJOR', status: 'SKIP',
      details: 'plan.md 中未找到模块变更摘要表。',
    }];
  }

  const moduleCol = changeTable.headers.findIndex(h =>
    h.includes('模块') || h.toLowerCase().includes('module'),
  );
  const designModules = changeTable.rows
    .map(r => (r[moduleCol] || '').trim())
    .filter(Boolean);

  const uncovered = designModules.filter(m => !scopeSection.includes(m));

  if (uncovered.length === 0) {
    return [{
      id: 'review_scope_to_design', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'review_scope_to_design'),
      severity: 'MAJOR', status: 'PASS',
      details: `审查范围覆盖了 plan.md 中全部 ${designModules.length} 个模块。`,
    }];
  }

  return [{
    id: 'review_scope_to_design', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'review_scope_to_design'),
    severity: 'MAJOR', status: 'WARN',
    details: `${uncovered.length}/${designModules.length} 个 plan.md 模块未在审查范围中提及：${uncovered.join('、')}`,
    suggestion: '请确认审查范围是否应覆盖 plan.md 中的所有模块。',
  }];
}

// --------------------------------------------------------------------------
// P1-B（plan f2d8c4a6）：视觉保真审查维度——review 报告须有该维度的执行证据。
// round6 实证（RC6）：review 只查架构/契约/规范/逻辑/数据五维，废图+乱布局下"有条件通过"。
// review 不重跑度量，**消费** spec/coding 落盘的确定性报告；本 check 确定性核"证据被引用过"，
// 引用内容的真实性归 AI verifier（issue_accuracy 抽样）与人工复核——诚实边界：报告声称≠真看过。
// --------------------------------------------------------------------------

/** pixel_1to1 P0 全覆盖证据类别（codex 意见：不许抽查）；非 pixel 至少命中 1 类 */
const VISUAL_REVIEW_EVIDENCE: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '素材验真核验（asset-crop-validation / contact-sheet）', re: /asset-crop-validation|contact-sheet|裁剪验真|素材验真/i },
  { label: '可见文案 diff 复核（visible_text / 豁免表）', re: /visible[-_]text|可见文案|文案(白名单|豁免|diff|比对)/i },
  // P1-4②（c9e2a7f4 子批B）：结构声明复核升级为"逐条核对台账"——证据须引用 structure-conformance
  // 台账（打开 implemented_by 对应 struct 源码验证 how 属实），不再接受仅提及声明字段名的泛引用。
  { label: '结构声明台账逐条复核（structure-conformance.yaml，打开 implemented_by 源码验证）', re: /structure-conformance|结构(声明)?台账/i },
  { label: 'must_have_elements 覆盖', re: /must[-_]have/i },
];

/** 导出供白盒单测（round6 套件）；生产路径经 checker.check 调用 */
export function checkVisualFidelityReview(ctx: CheckContext, report: string): CheckResult[] {
  // 仅 UI 需求需要视觉维度：以 spec.md 的 ui_change 判定（与 spec/coding 视觉门禁同 gate）
  const specPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'spec.md'));
  if (!fs.existsSync(specPath)) return [];
  let requiresUiSpec = false;
  try {
    // 延迟 require 避免为非 UI 项目引入依赖面
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require('./utils/ui-spec-shared') as typeof import('./utils/ui-spec-shared');
    const uiChange = shared.parseUiChangeFromSpecMarkdown(fs.readFileSync(specPath, 'utf-8'));
    requiresUiSpec = Boolean(uiChange && shared.UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange));
  } catch {
    return [];
  }
  if (!requiresUiSpec) return [];

  const desc = ruleDesc(ctx, 'structure_checks', 'visual_fidelity_review');
  const reportRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'review-report.md');
  const pixel = ctx.fidelityTarget === 'pixel_1to1';

  const hasDimension = /视觉保真|视觉维度|visual[\s_-]?fidelity/i.test(report);
  const missingEvidence = VISUAL_REVIEW_EVIDENCE.filter(e => !e.re.test(report));
  const evidenceHit = VISUAL_REVIEW_EVIDENCE.length - missingEvidence.length;
  const boundaryNote =
    '【诚实边界】本 check 只确定性核"维度存在+证据被引用"；引用真实性由 AI verifier issue_accuracy 抽样与人工复核兜。';

  const insufficient = !hasDimension || (pixel ? missingEvidence.length > 0 : evidenceHit === 0);
  if (insufficient) {
    return [{
      id: 'visual_fidelity_review',
      category: 'structure',
      description: desc,
      severity: pixel ? 'BLOCKER' : 'MAJOR',
      status: pixel ? 'FAIL' : 'WARN',
      details: [
        `【P1-B 视觉保真维度缺失】UI 需求的 review 报告须包含「视觉保真」审查维度${pixel ? '，且 pixel_1to1 下证据类别全覆盖（不许抽查）' : ''}：`,
        hasDimension ? null : '  缺「视觉保真」维度章节/表行',
        ...missingEvidence.map(e => `  缺证据引用：${e.label}`),
        boundaryNote,
      ].filter(Boolean).join('\n'),
      suggestion:
        '按 review SKILL 第 6 维执行：逐项核对 spec/coding 落盘报告（asset-crop-validation.json + contact-sheet、' +
        'visible_text_whitelist 结果与豁免表、coding/structure-conformance.yaml 台账逐条复核（打开 implemented_by ' +
        '源码验证 how 属实）、must_have 覆盖），把核对结论与引用写进 review-report.md 的' +
        '「视觉保真」维度——不重跑度量，消费既有产物。',
      affected_files: [reportRel],
    }];
  }

  return [{
    id: 'visual_fidelity_review',
    category: 'structure',
    description: desc,
    severity: 'MAJOR',
    status: 'PASS',
    details: `视觉保真维度存在，证据类别 ${evidenceHit}/${VISUAL_REVIEW_EVIDENCE.length} 命中${pixel ? '（pixel_1to1 全覆盖）' : ''}。\n${boundaryNote}`,
    affected_files: [reportRel],
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
      // P0-3（plan d9b4f7e2）：程序员错误=框架缺陷，结构化归因 framework_bug——goal-runner
      // 据此首触 halt 指向回灌源仓，不再让 agent 把门禁崩溃当自身产物问题反复修。
      ...(isProgrammerError
        ? {
            failure_kind: 'framework_bug',
            blocking_class: 'framework_internal',
            suggestion:
              '门禁脚本自身异常（framework 缺陷，非本 feature 产物问题）——请把完整栈回灌 agent-maison 源仓修复；不要修改产物或 framework 发布件来绕过。',
          }
        : {}),
    }];
  }
}

const checker: PhaseChecker = {
  phase: 'review',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const report = loadReviewReport(ctx);
    if (!report) {
      const reportRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'review-report.md');
      return [{
        id: 'review_report_exists', category: 'structure',
        description: `${reportRel} 不存在`,
        severity: 'BLOCKER', status: 'FAIL',
        details: `审查报告 ${reportRel} 不存在，无法进行任何检查。`,
        affected_files: [reportRel],
        suggestion: '本阶段应生成或补齐 review-report.md；补齐后重跑 review harness。',
        failure_kind: 'missing_review_report',
        blocking_class: 'review_context',
      }];
    }

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, [
        'plan.md',
        'review-report.md',
      ]),
    ];
    results.push(...checkReviewContext(ctx));
    results.push(
      ...safeRun(
        () => checkFactsArtifact(ctx.projectRoot, ctx.feature, 'review', {
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
          frameworkRoot: ctx.frameworkRoot,
        }),
        'context_exploration_gate',
      ),
    );

    // --- Structure checks ---
    results.push(...safeRun(() => checkRequiredChapters(ctx, report), 'required_chapters'));
    results.push(...safeRun(() => checkIssueTableFormat(ctx, report), 'issue_table_format'));
    results.push(...safeRun(() => checkSeverityValues(ctx, report), 'severity_values'));
    results.push(...safeRun(() => checkIssueCategoryValues(ctx, report), 'issue_category_values'));
    results.push(...safeRun(() => checkStatisticsSummary(ctx, report), 'statistics_summary'));
    results.push(...safeRun(() => checkScopeDeclaration(ctx, report), 'scope_declaration'));
    results.push(...safeRun(() => checkConclusionWithVerdict(ctx, report), 'conclusion_with_verdict'));
    results.push(...safeRun(() => checkMetadataHeader(ctx, report), 'metadata_header'));
    // P1-B（f2d8c4a6）：UI 需求须有视觉保真审查维度 + 证据引用（pixel_1to1 全覆盖）
    results.push(...safeRun(() => checkVisualFidelityReview(ctx, report), 'visual_fidelity_review'));

    // --- Traceability checks ---
    results.push(...safeRun(() => checkIssueToFile(ctx, report), 'issue_to_file'));
    results.push(...safeRun(() => checkIssueToCodingRule(ctx, report), 'issue_to_coding_rule'));
    results.push(...safeRun(() => checkReviewScopeToDesign(ctx, report), 'review_scope_to_design'));

    // --- goal-fakepass-hardening 洞⑥：有条件通过闭环门禁 ---
    results.push(...safeRun(() => checkConditionalPassClosure(ctx, report), 'conditional_pass_closure'));

    return results;
  },
};

/**
 * 洞⑥（bc-openCard）：review 结论「有条件通过 + 2 MAJOR」在 conclusion_with_verdict
 * 下无 BLOCKER 即 PASS，goal 照常推进——"修复后重跑或授权 review.ok_to_ut"只是 prose。
 * 机器化：有条件通过 且 存在未关闭 MAJOR 且 无有效 conditional_review_authorization
 * receipt → BLOCKER FAIL；receipt 有效 → WARN（降级不洗白，run 封顶
 * AWAITING_HUMAN_REVIEW）。LLM verifier 的 PASS 只证"报告可信"，不再被消费为"产品 PASS"。
 */
function checkConditionalPassClosure(ctx: CheckContext, report: string): CheckResult[] {
  const id = 'conditional_pass_closure';
  const description = '「有条件通过」闭环门禁（未闭环 MAJOR 不得推进；授权凭证仅降级）';
  const section = getSectionContent(report, '结论') ?? getSectionContent(report, '审查结论') ?? '';
  const { verdict } = extractDeclaredVerdict(section, ['有条件通过', '不通过', '通过']);
  if (verdict !== '有条件通过') {
    return [{ id, category: 'structure', description, severity: 'BLOCKER', status: 'PASS', details: `结论=${verdict ?? '未声明'}，本门禁不适用。` }];
  }
  const table = getIssueTable(report);
  let openMajors = 0;
  if (table) {
    const iSev = table.headers.findIndex((h) => h.includes('严重程度') || h.includes('严重等级'));
    const iState = table.headers.findIndex((h) => h.includes('状态'));
    for (const row of table.rows) {
      const sev = iSev >= 0 ? (row[iSev] ?? '').trim() : '';
      if (sev !== 'MAJOR') continue;
      const state = iState >= 0 ? (row[iState] ?? '').trim() : '';
      if (!/已关闭|已修复|closed|fixed/i.test(state)) openMajors++;
    }
  }
  if (openMajors === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: '有条件通过但全部 MAJOR 已标记关闭（问题表状态列）。',
    }];
  }
  const receiptPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('review', 'conditional-authorization.receipt.json'));
  const reportSha = crypto.createHash('sha256').update(report, 'utf-8').digest('hex');
  const v = validateConfirmationReceiptFile(
    receiptPath,
    defaultTrustRegistryPath(ctx.projectRoot),
    { action: 'conditional_review_authorization', feature: ctx.feature, object_hash: reportSha },
  );
  if (v.valid) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details: `有条件通过（未闭环 MAJOR ${openMajors} 项）已获真人授权凭证——降级不洗白：run 封顶 AWAITING_HUMAN_REVIEW。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `结论「有条件通过」且存在未闭环 MAJOR ${openMajors} 项，无有效授权凭证（${v.reasons.slice(0, 2).join('；')}）` +
      '——review 不得闭环推进（bc-openCard 洞⑥：2 MAJOR 有条件通过照常进 ut/testing）。',
    suggestion:
      '修复 MAJOR 后重跑 coding→review（问题表状态列标记 已关闭）；或真人经带外体系签发' +
      ' conditional_review_authorization receipt（绑定本报告哈希）落 review/conditional-authorization.receipt.json。',
  }];
}

export default checker;
