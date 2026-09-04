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

import { isHardPixelContract } from './utils/fidelity-shared';
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
import { relFeatureArtifact, relFeatureFile, featureFilePath, resolveFeatureArtifact } from '../config';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { checkFactsArtifact } from './utils/context-facts';
import { checkUpstreamVerdictGate } from './utils/upstream-verdict-gate';

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
        // plan 07a41ec6 T5：统计表是问题清单的派生值，由 checker 自动回写，不再让 agent 手工对账
        const rewritten = rewriteStatisticsTable(report, counts);
        if (rewritten && writeReviewReport(ctx, rewritten)) {
          return [{
            id: 'statistics_summary', category: 'structure',
            description: ruleDesc(ctx, 'structure_checks', 'statistics_summary'),
            severity: 'MAJOR', status: 'PASS',
            details:
              `问题统计表已由 harness 按问题清单自动回写（原不一致：${mismatches.join('；')}）：` +
              `BLOCKER ${counts.BLOCKER} / MAJOR ${counts.MAJOR} / MINOR ${counts.MINOR} / INFO ${counts.INFO} / 合计 ${table.rows.length}。`,
          }];
        }
        return [{
          id: 'statistics_summary', category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'statistics_summary'),
          severity: 'MAJOR', status: 'WARN',
          details: `问题统计与问题清单计数不一致（自动回写失败，统计表形状无法定位）：\n${mismatches.map(m => `  - ${m}`).join('\n')}`,
          suggestion: '统计表须紧跟「问题统计」标题且为 Markdown 表格；修正形状后重跑，harness 会按问题清单自动回写数量。',
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

/** plan 07a41ec6 T5：把「问题统计」标题后的第一张表替换为按问题清单重算的统计表；找不到表返回 null。 */
function rewriteStatisticsTable(report: string, counts: Record<string, number>): string | null {
  const lines = report.split('\n');
  const heading = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.includes('问题统计'));
  if (heading < 0) return null;
  let start = -1;
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    if (lines[i].trim().startsWith('|')) { start = i; break; }
  }
  if (start < 0) return null;
  let end = start;
  while (end < lines.length && lines[end].trim().startsWith('|')) end += 1;
  const total = counts.BLOCKER + counts.MAJOR + counts.MINOR + counts.INFO;
  const table = [
    '| 严重程度 | 数量 |',
    '|---------|------|',
    `| BLOCKER | ${counts.BLOCKER} |`,
    `| MAJOR | ${counts.MAJOR} |`,
    `| MINOR | ${counts.MINOR} |`,
    `| INFO | ${counts.INFO} |`,
    `| **合计** | **${total}** |`,
  ];
  lines.splice(start, end - start, ...table);
  return lines.join('\n');
}

function writeReviewReport(ctx: CheckContext, content: string): boolean {
  try {
    const resolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'review-report.md');
    const target = resolved.exists ? resolved.actualPath : resolved.canonicalPath;
    fs.writeFileSync(target, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * plan 07a41ec6 T5：引用与计数 lint（只提示，不作语义证明）。
 *   · `path:line` / `path:line-line` 引用：文件须存在、行号须在范围内（宿主 2026-09-02 回归 11 组行号漂移）；
 *   · 计数自洽：问题清单行数 vs 统计表合计 vs 正文"共 N 条"。
 * 新报告优先引用「文件 + symbol」；行号需要时由 renderer 生成。
 */
function checkReviewReferenceLint(ctx: CheckContext, report: string): CheckResult[] {
  const id = 'review_reference_lint';
  const description = 'review 报告引用新鲜度与计数自洽（WARN 提示：path:line 存在/范围、问题数三方一致）';
  const findings: string[] = [];
  const refRe = /([A-Za-z0-9_][A-Za-z0-9_./\\-]*\.(?:ets|ts|tsx|js|mjs|json5|json|md|yaml|yml|py|java|kt|swift)):(\d+)(?:-(\d+))?/g;
  const seen = new Set<string>();
  const lineCountCache = new Map<string, number | null>();
  const lineCountOf = (abs: string): number | null => {
    if (lineCountCache.has(abs)) return lineCountCache.get(abs)!;
    let n: number | null = null;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) n = fs.readFileSync(abs, 'utf-8').split('\n').length;
    } catch { n = null; }
    lineCountCache.set(abs, n);
    return n;
  };
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(report)) !== null) {
    const raw = m[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const rel = m[1].replace(/\\/g, '/');
    const line = Number(m[2]);
    const lineEnd = m[3] ? Number(m[3]) : line;
    const abs = path.resolve(ctx.projectRoot, rel);
    const count = lineCountOf(abs);
    if (count === null) {
      findings.push(`${raw}：文件不存在（相对仓根解析）`);
    } else if (lineEnd > count) {
      findings.push(`${raw}：行号超出范围（文件共 ${count} 行）`);
    }
  }
  const table = getIssueTable(report);
  const issueRows = table ? table.rows.filter(r => /CR-\d+/i.test(r[0] ?? '')).length : null;
  const stats = getSectionContent(report, '问题统计') ?? '';
  const totalMatch = /合计[^\d\n]*?(\d+)/.exec(stats);
  const statsTotal = totalMatch ? Number(totalMatch[1]) : null;
  if (issueRows !== null && statsTotal !== null && issueRows !== statsTotal) {
    findings.push(`计数不一致：问题清单 ${issueRows} 条，问题统计合计 ${statsTotal}`);
  }
  const proseSections = [getSectionContent(report, '结论'), getSectionContent(report, '修复建议摘要')].filter((s): s is string => typeof s === 'string');
  for (const sec of proseSections) {
    const pm = /共\s*(\d+)\s*(?:条|个)\s*(?:问题|缺陷|项)/.exec(sec);
    if (pm && issueRows !== null && Number(pm[1]) !== issueRows) {
      findings.push(`计数不一致：正文"共 ${pm[1]} 条"，问题清单 ${issueRows} 条`);
    }
  }
  if (findings.length === 0) {
    return [{ id, category: 'structure', description, severity: 'MAJOR', status: 'PASS', details: `引用 ${seen.size} 处均可定位；计数自洽。` }];
  }
  return [{
    id, category: 'structure', description, severity: 'MAJOR', status: 'WARN',
    details: `${findings.length} 处提示：\n${findings.slice(0, 20).map(f => `  - ${f}`).join('\n')}`,
    suggestion: '这些是确定性提示，不构成语义证明：刷新失效的 path:line（优先改为「文件 + symbol」引用），并让计数以问题清单为准（统计表已由 harness 回写）。',
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
  const required = ['模块标识', '审查日期', '审查版本', '保证等级'];
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
    // resource_integrity 已退役：资源引用类问题的机器依据=真实构建（coding_compile）
    '资源引用': 'coding_compile',
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
// 引用内容的真实性归当前 AI verifier 的 issue_accuracy 及 item-level 证据绑定——诚实边界：报告声称≠真看过。
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
  const pixel = isHardPixelContract(ctx); // post-impl2 P1-4：视觉评审维度抬升=裁决类，只在 hard contract 生效

  const hasDimension = /视觉保真|视觉维度|visual[\s_-]?fidelity/i.test(report);
  const missingEvidence = VISUAL_REVIEW_EVIDENCE.filter(e => !e.re.test(report));
  const evidenceHit = VISUAL_REVIEW_EVIDENCE.length - missingEvidence.length;
  const boundaryNote =
    '【诚实边界】本 check 只确定性核"维度存在+证据被引用"；引用真实性由当前 AI verifier 的 issue_accuracy 与 item-level 证据绑定复验。';

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
    // t1d（plan e6a3c9f4）：编排边界附加产出来源，供报告/summary 定位真实产出方。
    return fn().map(r => (r.source ? r : { ...r, source: checkId }));
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
    const loadedReport = loadReviewReport(ctx);
    if (!loadedReport) {
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
    let report: string = loadedReport;

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
    // codex review P2：统计表可能刚被回写——后续检查读回写后的正文，避免一轮无意义 WARN
    report = loadReviewReport(ctx) ?? report;
    results.push(...safeRun(() => checkReviewReferenceLint(ctx, report), 'review_reference_lint'));
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

    // --- blind-visual-hardening d1 切片一：负面裁决闭环 + 上游裁决传播 ---
    results.push(...safeRun(() => checkNegativeVerdictClosure(report), 'negative_verdict_closure'));
    results.push(
      ...safeRun(
        () => checkUpstreamVerdictGate({ projectRoot: ctx.projectRoot, feature: ctx.feature, phase: 'review' }),
        'upstream_verdict_gate',
      ),
    );

    return results;
  },
};

/**
 * blind-visual-hardening d1 切片一（bc-openCard 二轮洞①）：洞⑥只堵了「有条件通过」，
 * 「不通过」分支曾"本门禁不适用→PASS"——review 终态「不通过+3 BLOCKER」时 summary
 * verdict:PASS/closed 照常闭环推进 ut/testing。本 check 补上该分支：结论=不通过 →
 * BLOCKER FAIL（产品负面裁决阻断 phase 闭环）。语义分层：报告一致性（结论 vs 统计）
 * 归 conclusion_with_verdict（report_validity 语义）；本 check 是产品裁决传播。
 * 本 check **不读** verifier 结果——verifier 的 PASS 只证"报告可信"，永不改写产品裁决
 * （单测锁定：verifier PASS 在场时本 check 仍 FAIL）。
 */
export function checkNegativeVerdictClosure(report: string): CheckResult[] {
  const id = 'negative_verdict_closure';
  const description = '负面产品裁决闭环门禁（结论=不通过 → 阻断 phase 闭环，修复重跑后方可推进）';
  const section = getSectionContent(report, '结论') ?? getSectionContent(report, '审查结论') ?? '';
  const { verdict } = extractDeclaredVerdict(section, ['有条件通过', '不通过', '通过']);
  if (verdict !== '不通过') {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `结论=${verdict ?? '未声明'}，非负面裁决，本门禁不适用（缺声明行由 conclusion_with_verdict 拦）。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details:
      '审查结论=「不通过」——产品负面裁决不得闭环推进（bc-openCard 二轮：不通过+3 BLOCKER 曾以 ' +
      'summary verdict:PASS/closed 照常进 ut/testing 直至「达标可发布」）。报告本身合法≠产品通过。',
    suggestion:
      '修复问题清单中的问题后重跑 coding→review，结论更新为非「不通过」后方可闭环；' +
      'verifier 的 PASS 只证明报告可信，不构成产品通过。',
    failure_kind: 'negative_review_verdict',
    blocking_class: 'product_verdict',
  }];
}

/**
 * 洞⑥（bc-openCard）：review 结论「有条件通过 + 2 MAJOR」在 conclusion_with_verdict
 * 下无 BLOCKER 即 PASS，goal 照常推进——"修复后重跑或授权 review.ok_to_ut"只是 prose。
 * 机器化：有条件通过且存在未关闭 MAJOR → BLOCKER FAIL。人工授权不得把已知缺陷
 * 降级为可推进状态；LLM verifier 的 PASS 只证"报告可信"，不再被消费为"产品 PASS"。
 */
function checkConditionalPassClosure(ctx: CheckContext, report: string): CheckResult[] {
  const id = 'conditional_pass_closure';
  const description = '「有条件通过」闭环门禁（未闭环 MAJOR 不得推进）';
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
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `结论「有条件通过」且存在未闭环 MAJOR ${openMajors} 项——review 不得闭环推进` +
      '（bc-openCard 洞⑥：2 MAJOR 有条件通过照常进 ut/testing）。',
    suggestion:
      '修复 MAJOR 后重跑 coding→review（问题表状态列标记 已关闭）；人工接受风险不能改写质量结论。',
  }];
}

export default checker;

/** 测试接缝（plan 07a41ec6 T5）：统计表自动回写与引用 lint 的直接入口。 */
export const __testing_checkStatisticsSummary = checkStatisticsSummary;
export const __testing_checkReviewReferenceLint = checkReviewReferenceLint;
