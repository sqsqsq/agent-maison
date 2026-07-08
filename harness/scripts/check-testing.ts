// ============================================================================
// Testing 阶段脚本 Harness — check-testing.ts
// ============================================================================
// 读取 framework/specs/phase-rules/testing-rules.yaml + doc/features/{feature}/
// 执行确定性的静态验证。
//
// 检查项（与 testing-rules.yaml 对应）：
//   Structure (plan):  plan_required_chapters, test_case_table_format,
//                      test_case_priority_values, test_environment_defined,
//                      pass_criteria_defined, device_test_build,
//                      device_test_install, metadata_header
//   Structure (report): report_required_chapters, execution_result_table,
//                       pass_rate_calculated, defect_table_format,
//                       report_conclusion_with_verdict
//   Traceability:      acceptance_to_test_case, test_case_to_acceptance,
//                      plan_to_report_consistency, defect_to_test_case
//
// 语义级检查由 AI Harness (verify-testing.md) 完成，不在本脚本范围内。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import { fidelityRatchetFailOrWarn, loadSpecMarkdown } from './utils/fidelity-shared';
import {
  resolveFeatureArtifact,
  relFeatureArtifact,
  relFeatureFile,
  featurePhaseReportsDir,
  resolveHylyreToolConfig,
} from '../config';
import { attachNavigationHints, extractTopPlanTestCasesForDeriveHint } from './utils/test-plan-derive-hint';
import {
  extractTcIdsFromPlanTable,
  selectBestNonPlaceholderDerivedPlan,
  evaluateDerivedCoverage,
  loadExplicitSkipTcIds,
  lintDerivedHylyrePlanSteps,
  type NavLintViolation,
} from './utils/derived-hylyre-plan';
import {
  extractHeadings,
  getSectionContent,
  extractTables,
  tableHasColumns,
  getColumnValues,
  extractMetadata,
  extractDeclaredVerdict,
  MdTable,
} from './utils/markdown-parser';
import {
  isCapabilitySkipped,
  dispatchDeviceTestBuild,
  dispatchDeviceTestInstall,
  dispatchDeviceTestEnsureReady,
  dispatchDeviceTestRun,
  isDeviceVisualDiffSkipped,
  dispatchDeviceVisualDiff,
  analyzeProjectDependencyIssueViaProfile,
} from '../capability-registry';
import type { DeviceTestBuildResult } from '../../profiles/hmos-app/harness/providers/device-test-build';
import type { DeviceTestInstallResult } from '../../profiles/hmos-app/harness/providers/device-test-install';
import type { HylyreReadyResult, HylyreRunResult } from '../../profiles/hmos-app/harness/providers/device-test-run';
import {
  collectDeviceTestTimings,
  writeDeviceTestTimingJson,
} from '../../profiles/hmos-app/harness/device-test-timings';
import {
  acceptanceYamlPath,
  buildAcceptanceIdPriorityMap,
  collectDeviceScopeP0P1,
  isDeviceUtLayer,
} from './utils/acceptance-layering';
import { runAcceptanceYamlStructureChecks } from './utils/check-acceptance';
import {
  formatRootPollutionWarnDetails,
  loadTestingRootPollutionMeta,
} from './utils/hylyre-root-pollution-warn';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { captureVisualDiff } from '../../profiles/hmos-app/harness/visual-diff-capture';
import { computeHapBuildFingerprint } from '../../profiles/hmos-app/harness/build-fingerprint';
import { buildHylyreVisualDiffScreenshotFn, buildHylyreNavExecutorFn, readDeviceTestRunHylyreNavOpts } from '../../profiles/hmos-app/harness/visual-diff-hylyre-screenshot';
import { loadVisualDiffNavConfig, validateNavConfig } from '../../profiles/hmos-app/harness/visual-diff-nav';
import { collectP0VisualTargetIds } from '../../profiles/hmos-app/harness/visual-diff-targets';
import { resolveHylyreRuntimeWorkDir } from '../../profiles/hmos-app/harness/hylyre-spawn';
import { parseUiChangeFromSpecMarkdown, loadUiSpecFile, uiSpecAbsPath } from './utils/ui-spec-shared';
import { checkFactsArtifact } from './utils/context-facts';
import {
  evaluateHylyreRunOutcome,
  reconcileReportWithHylyreTrace,
  resolveAuthoritativeHylyreTracePath,
  evaluateUiEntryCoverage,
  buildEntryUiPriorityMap,
} from './utils/testing-trace-gates';
import type { UseCasesSpec } from './utils/types';
import {
  diagnoseInstallBlocking,
  mapInstallBlockingToTestingCheckFields,
  buildInstallBlockingCheckDetails,
  writeInstallDiagJson,
} from '../../profiles/hmos-app/harness/device-install-diag';

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

function truncateList(items: string[], max: number): string {
  const shown = items.slice(0, max).map(i => `  - ${i}`).join('\n');
  return items.length > max ? `${shown}\n  ... 还有 ${items.length - max} 项` : shown;
}

/** 各 profile 可在 harness/testing-plan-conventions 中覆盖；缺省为与宿主无关的关键词组 */
function loadTestEnvironmentKeywordGroups(ctx: CheckContext): string[][] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require(path.join(ctx.resolvedProfile.profileDir, 'harness', 'testing-plan-conventions')) as {
      testEnvironmentRequiredKeywordGroups?: string[][];
    };
    if (Array.isArray(m.testEnvironmentRequiredKeywordGroups)) {
      return m.testEnvironmentRequiredKeywordGroups;
    }
  } catch {
    /* 使用下方默认 */
  }
  return [
    ['设备', '设备型号', '模拟器'],
    ['系统版本', 'OS', '操作系统'],
    ['API', 'API 版本'],
  ];
}

function loadDoc(ctx: CheckContext, docName: string): string | null {
  const resolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, docName);
  if (!resolved.exists) return null;
  return fs.readFileSync(resolved.actualPath, 'utf-8');
}

function headingExists(content: string, keywords: string[]): boolean {
  const headings = extractHeadings(content);
  return keywords.some(kw =>
    headings.some(h => h.text.includes(kw)),
  );
}

// --------------------------------------------------------------------------
// Structure Checks — Test Plan
// --------------------------------------------------------------------------

function checkPlanRequiredChapters(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'plan_required_chapters';
  if (!plan) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-plan.md 不存在，跳过测试计划结构检查。',
    }];
  }

  const requiredChapters = [
    ['测试范围'],
    ['测试环境'],
    ['测试用例清单', '测试用例'],
    ['测试策略'],
    ['通过标准'],
    ['风险', '风险与依赖'],
  ];

  const missing: string[] = [];
  for (const keywords of requiredChapters) {
    if (!headingExists(plan, keywords)) {
      missing.push(keywords[0]);
    }
  }

  if (missing.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '测试计划包含全部 6 个必需章节。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `缺少 ${missing.length} 个必需章节：\n${truncateList(missing, 10)}`,
    suggestion: '测试计划必须包含：测试范围、测试环境、测试用例清单、测试策略、通过标准、风险与依赖。',
  }];
}

function checkTestCaseTableFormat(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'test_case_table_format';
  if (!plan) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const section = getSectionContent(plan, '测试用例');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到「测试用例清单」章节。',
      suggestion: '测试计划必须包含「测试用例清单」章节。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '「测试用例清单」章节中未找到 Markdown 表格。',
      suggestion: '测试用例清单必须使用 Markdown 表格格式。',
    }];
  }

  const table = tables[0];
  const requiredCols = [
    '用例编号" or "编号',
    '用例名称" or "名称',
    '前置条件',
    '测试步骤" or "步骤',
    '预期结果',
    '优先级',
    '关联 AC" or "关联验收标准',
  ];

  const { hasAll, missing } = tableHasColumns(table, requiredCols);

  if (hasAll) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `用例清单表格包含全部必需列，共 ${table.rows.length} 条用例。`,
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `用例清单表格缺少以下列：\n${truncateList(missing, 10)}`,
    suggestion: '表头至少需包含：用例编号、用例名称、前置条件、测试步骤、预期结果、优先级、关联 AC。',
  }];
}

function checkTestCasePriorityValues(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'test_case_priority_values';
  if (!plan) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const section = getSectionContent(plan, '测试用例');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '未找到测试用例清单章节。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '未找到测试用例表格。',
    }];
  }

  const priorities = getColumnValues(tables[0], '优先级');
  const allowed = ['P0', 'P1', 'P2', 'P3'];
  const invalid = priorities.filter(p => p && !allowed.includes(p.trim()));

  if (invalid.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: `全部 ${priorities.filter(p => p).length} 条用例的优先级值域合规。`,
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${invalid.length} 条用例优先级值非法：${[...new Set(invalid)].join(', ')}`,
    suggestion: '优先级必须为 P0/P1/P2/P3。',
  }];
}

function checkTestEnvironmentDefined(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'test_environment_defined';
  if (!plan) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const section = getSectionContent(plan, '测试环境');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'FAIL',
      details: '未找到「测试环境」章节。',
      suggestion: '测试计划必须包含「测试环境」章节，列出设备、系统版本、API 版本。',
    }];
  }

  const requiredKeywords = loadTestEnvironmentKeywordGroups(ctx);

  const missing: string[] = [];
  for (const keywords of requiredKeywords) {
    if (!keywords.some(kw => section.includes(kw))) {
      missing.push(keywords[0]);
    }
  }

  if (missing.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: '测试环境章节包含设备、系统版本、API 版本信息。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'MAJOR',
    status: 'WARN',
    details: `测试环境章节可能缺少以下信息：${missing.join(', ')}`,
    suggestion: '测试环境必须明确列出：设备型号/模拟器、系统版本、API 版本。',
  }];
}

function checkPassCriteriaDefined(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'pass_criteria_defined';
  if (!plan) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const section = getSectionContent(plan, '通过标准');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到「通过标准」章节。',
      suggestion: '测试计划必须包含「通过标准」章节，定义量化的通过条件。',
    }];
  }

  const hasNumeric = /\d+\s*%|\d+%|≥|≤|>=|<=|100%/.test(section);
  if (hasNumeric) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '通过标准章节包含量化阈值。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: '通过标准章节未包含量化阈值（如百分比、数值等）。',
    suggestion: '通过标准必须定义量化条件，如 P0 用例 100% 通过、P1 用例 ≥ 95% 通过。',
  }];
}

function checkPlanMetadata(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'metadata_header';
  if (!plan) {
    return [{
      id: `plan_${id}`,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MINOR',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const metadata = extractMetadata(plan);
  const requiredFields = ['模块标识', '版本', '日期'];
  const missing = requiredFields.filter(f => !metadata[f]);

  if (missing.length === 0) {
    return [{
      id: `plan_${id}`,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MINOR',
      status: 'PASS',
      details: '测试计划包含元数据头部。',
    }];
  }

  return [{
    id: `plan_${id}`,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'MINOR',
    status: 'WARN',
    details: `测试计划顶部缺少元数据：${missing.join(', ')}`,
    suggestion: '文档顶部应使用 blockquote 格式包含模块标识、版本、日期。',
  }];
}

// --------------------------------------------------------------------------
// Structure Checks — Test Report
// --------------------------------------------------------------------------

function checkReportRequiredChapters(ctx: CheckContext, report: string | null): CheckResult[] {
  const id = 'report_required_chapters';
  if (!report) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-report.md 不存在（测试报告可能尚未生成），跳过报告结构检查。',
    }];
  }

  const requiredChapters = [
    ['测试概览'],
    ['测试执行结果', '执行结果'],
    ['通过率', '通过率统计'],
    ['结论', '测试结论'],
  ];

  const missing: string[] = [];
  for (const keywords of requiredChapters) {
    if (!headingExists(report, keywords)) {
      missing.push(keywords[0]);
    }
  }

  if (missing.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '测试报告包含全部必需章节。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `缺少 ${missing.length} 个必需章节：\n${truncateList(missing, 10)}`,
    suggestion: '测试报告必须包含：测试概览、测试执行结果、通过率统计、结论。',
  }];
}

function checkExecutionResultTable(ctx: CheckContext, report: string | null): CheckResult[] {
  const id = 'execution_result_table';
  if (!report) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-report.md 不存在。',
    }];
  }

  const section = getSectionContent(report, '测试执行结果') ?? getSectionContent(report, '执行结果');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到「测试执行结果」章节。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '「测试执行结果」章节中未找到 Markdown 表格。',
    }];
  }

  const table = tables[0];
  const requiredCols = ['用例编号" or "编号', '执行状态" or "结果" or "状态'];
  const { hasAll, missing } = tableHasColumns(table, requiredCols);

  if (!hasAll) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `执行结果表格缺少列：${missing.join(', ')}`,
      suggestion: '表头至少需包含：用例编号、执行状态。',
    }];
  }

  const statusCol = getColumnValues(table, '执行状态').length > 0
    ? getColumnValues(table, '执行状态')
    : getColumnValues(table, '结果').length > 0
      ? getColumnValues(table, '结果')
      : getColumnValues(table, '状态');

  const allowedStatuses = ['通过', '失败', '阻塞', '跳过'];
  const invalidStatuses = statusCol.filter(s => s && !allowedStatuses.includes(s.trim()));

  if (invalidStatuses.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${invalidStatuses.length} 条执行状态值非法：${[...new Set(invalidStatuses)].join(', ')}`,
      suggestion: '执行状态仅允许：通过 / 失败 / 阻塞 / 跳过。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `执行结果表格格式合规，共 ${table.rows.length} 条记录。`,
  }];
}

function checkPassRateCalculated(ctx: CheckContext, report: string | null): CheckResult[] {
  const id = 'pass_rate_calculated';
  if (!report) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-report.md 不存在。',
    }];
  }

  const section = getSectionContent(report, '通过率');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到「通过率统计」章节。',
    }];
  }

  const hasPerPriority = /P0/.test(section) && /P1/.test(section);
  const hasOverall = /总/.test(section) || /总计/.test(section) || /合计/.test(section) || /overall/i.test(section);
  const hasPercentage = /\d+\s*%|\d+%/.test(section);

  if (hasPerPriority && hasPercentage) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '通过率统计章节包含各优先级通过率数值。',
    }];
  }

  const issues: string[] = [];
  if (!hasPerPriority) issues.push('缺少分优先级（P0/P1）的通过率');
  if (!hasPercentage) issues.push('缺少通过率百分比数值');
  if (!hasOverall) issues.push('缺少总体通过率');

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: issues.join('；'),
    suggestion: '通过率统计必须包含 P0、P1 各自的通过率以及总体通过率。',
  }];
}

function checkDefectTableFormat(ctx: CheckContext, report: string | null): CheckResult[] {
  const id = 'defect_table_format';
  if (!report) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'test-report.md 不存在。',
    }];
  }

  const section = getSectionContent(report, '缺陷');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: '未找到缺陷清单章节（可能无缺陷）。',
    }];
  }

  if (section.includes('无缺陷') || section.includes('所有用例全部通过')) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: '缺陷清单标注为无缺陷。',
    }];
  }

  const tables = extractTables(section);
  if (tables.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'WARN',
      details: '缺陷清单章节存在但未找到 Markdown 表格。',
      suggestion: '若有失败用例，缺陷清单应使用表格格式。',
    }];
  }

  const requiredCols = ['缺陷编号" or "编号', '关联用例', '严重程度', '描述', '状态'];
  const { hasAll, missing } = tableHasColumns(tables[0], requiredCols);

  if (hasAll) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: `缺陷清单表格格式合规，共 ${tables[0].rows.length} 条缺陷。`,
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'MAJOR',
    status: 'WARN',
    details: `缺陷清单表格缺少列：${missing.join(', ')}`,
    suggestion: '缺陷清单表头应包含：缺陷编号、关联用例、严重程度、描述、状态。',
  }];
}

function checkReportConclusionWithVerdict(ctx: CheckContext, report: string | null): CheckResult[] {
  const id = 'report_conclusion_with_verdict';
  if (!report) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-report.md 不存在。',
    }];
  }

  const section = getSectionContent(report, '结论') ?? getSectionContent(report, '测试结论');
  if (!section) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到「结论」章节。',
    }];
  }

  // 声明式提取：锚定「测试结论:」声明行 + 最长优先，杜绝 '达标'⊂'不达标' 子串
  // 与「下一步建议」枚举裁决词造成的整段污染。裁决-vs-trace 一致性由
  // reconcileReportWithHylyreTrace 负责（消费同一 parseReportConclusionVerdict）。
  const { verdict } = extractDeclaredVerdict(section, ['有条件达标', '不达标', '达标']);

  if (verdict) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `结论章节包含可机读判定：${verdict}。`,
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: '结论章节未找到可机读的判定声明行（达标/有条件达标/不达标）。',
    suggestion: '请写出明确声明行，例如 `**测试结论**: 不达标`（裁决词须紧邻在"测试结论:"之后）。',
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function extractTestCaseACRefs(plan: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const section = getSectionContent(plan, '测试用例');
  if (!section) return result;

  const tables = extractTables(section);
  if (tables.length === 0) return result;

  const table = tables[0];
  const idCol = table.headers.findIndex(h => h.includes('编号'));
  const acCol = table.headers.findIndex(h => h.includes('AC') || h.includes('验收'));

  if (idCol === -1 || acCol === -1) return result;

  for (const row of table.rows) {
    const tcId = (row[idCol] || '').trim();
    const acRefs = (row[acCol] || '').trim();
    if (tcId && acRefs) {
      const refs = acRefs.split(/[,，、\s]+/).filter(r =>
        r.match(/^(AC|BD)-(G\d+|\d+)$/i),
      );
      result.set(tcId, refs);
    }
  }

  return result;
}

function extractTestCaseIds(plan: string): string[] {
  const section = getSectionContent(plan, '测试用例');
  if (!section) return [];
  const tables = extractTables(section);
  if (tables.length === 0) return [];
  const idCol = tables[0].headers.findIndex(h => h.includes('编号'));
  if (idCol === -1) return [];
  return tables[0].rows.map(row => (row[idCol] || '').trim()).filter(id => id);
}

function extractReportCaseIds(report: string): string[] {
  const section = getSectionContent(report, '测试执行结果') ?? getSectionContent(report, '执行结果');
  if (!section) return [];
  const tables = extractTables(section);
  if (tables.length === 0) return [];
  const idCol = tables[0].headers.findIndex(h => h.includes('编号'));
  if (idCol === -1) return [];
  return tables[0].rows.map(row => (row[idCol] || '').trim()).filter(id => id);
}

function checkAcceptanceToTestCase(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'acceptance_to_test_case';
  const acceptance = ctx.featureSpec.acceptance;

  if (!acceptance?.criteria?.length) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 无 criteria 列表。',
    }];
  }

  if (!plan) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const acRefs = extractTestCaseACRefs(plan);
  const allCoveredACs = new Set<string>();
  for (const refs of acRefs.values()) {
    for (const ref of refs) {
      allCoveredACs.add(ref.toUpperCase().replace(/\s/g, ''));
    }
  }

  const { criteria: deviceCriteria, boundaries: deviceBoundaries } = collectDeviceScopeP0P1(acceptance);
  const uncovered = deviceCriteria.filter(c => {
    const normalizedId = c.id.toUpperCase().replace(/\s/g, '');
    return !allCoveredACs.has(normalizedId);
  });

  const uncoveredBD = deviceBoundaries.filter(b => {
    const normalizedId = b.id.toUpperCase().replace(/\s/g, '');
    return !allCoveredACs.has(normalizedId);
  });

  const p0Device = deviceCriteria.filter(c => c.priority === 'P0');
  const p1Device = deviceCriteria.filter(c => c.priority === 'P1');
  const p0Covered = p0Device.filter(c => allCoveredACs.has(c.id.toUpperCase().replace(/\s/g, ''))).length;
  const p1Covered = p1Device.filter(c => allCoveredACs.has(c.id.toUpperCase().replace(/\s/g, ''))).length;

  const details: string[] = [];
  details.push(`追溯分母：ut_layer∈{device,both} 的 P0/P1（不含 unit 层 AC）`);
  details.push(`P0 AC 覆盖率: ${p0Covered}/${p0Device.length}`);
  details.push(`P1 AC 覆盖率: ${p1Covered}/${p1Device.length}`);
  details.push(`BD 覆盖率: ${deviceBoundaries.length - uncoveredBD.length}/${deviceBoundaries.length}`);

  if (uncovered.length > 0) {
    details.push('未被测试用例覆盖的 P0/P1 AC:');
    for (const c of uncovered.slice(0, 10)) {
      details.push(`  - ${c.id} (${c.priority}): ${c.description}`);
    }
    if (uncovered.length > 10) {
      details.push(`  ... 还有 ${uncovered.length - 10} 条`);
    }
  }

  if (uncovered.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: details.join('\n'),
    }];
  }

  return [{
    id,
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: details.join('\n'),
    suggestion: `请为未覆盖的 ${uncovered.length} 个 device 层 P0/P1 AC 补充测试用例（见 acceptance.yaml device_focus）。`,
  }];
}

function checkTestPlanFreshnessVsAcceptance(ctx: CheckContext): CheckResult[] {
  const id = 'test_plan_freshness_vs_acceptance';
  const accPath = acceptanceYamlPath(ctx.projectRoot, ctx.feature);
  const planResolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
  if (!planResolved.exists) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }
  const planPath = planResolved.actualPath;
  if (!fs.existsSync(accPath)) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 不存在。',
    }];
  }
  if (!fs.existsSync(planPath)) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }
  const accMtime = fs.statSync(accPath).mtimeMs;
  const planMtime = fs.statSync(planPath).mtimeMs;
  if (accMtime > planMtime) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        'acceptance.yaml 比 test-plan.md 更新：请按 device-testing 从 acceptance（ut_layer∈{device,both}）重派生 test-plan 与 hylyre 计划。',
      suggestion: '更新 test-plan.md 后重新派生 testing/reports/<timestamp>/hylyre/test-plan.hylyre.md。',
    }];
  }
  return [{
    id,
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: 'test-plan.md 不早于 acceptance.yaml（按 mtime）。',
  }];
}

function checkPlanReferencesUnitLayerAc(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'plan_references_unit_layer_ac';
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance || !plan) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MINOR',
      status: 'SKIP',
      details: 'acceptance 或 test-plan 不可用。',
    }];
  }
  const unitOnlyIds = new Set(
    (acceptance.criteria ?? [])
      .filter(c => c.ut_layer === 'unit')
      .map(c => c.id.toUpperCase().replace(/\s/g, '')),
  );
  for (const b of acceptance.boundaries ?? []) {
    if (b.ut_layer === 'unit') unitOnlyIds.add(b.id.toUpperCase().replace(/\s/g, ''));
  }
  if (unitOnlyIds.size === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MINOR',
      status: 'SKIP',
      details: '无 ut_layer=unit 的 AC/BD。',
    }];
  }
  const acRefs = extractTestCaseACRefs(plan);
  const hits: string[] = [];
  for (const refs of acRefs.values()) {
    for (const ref of refs) {
      const norm = ref.toUpperCase().replace(/\s/g, '');
      if (unitOnlyIds.has(norm)) hits.push(ref);
    }
  }
  const unique = [...new Set(hits)];
  if (unique.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MINOR',
      status: 'PASS',
      details: 'test-plan 未关联 ut_layer=unit 的 AC/BD（符合 device 执行层分母）。',
    }];
  }
  return [{
    id,
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', id),
    severity: 'MINOR',
    status: 'WARN',
    details:
      `test-plan 关联了 ${unique.length} 个 unit 层 AC/BD（应由 business-ut UT 覆盖）：\n${truncateList(unique, 10)}`,
    suggestion: '从真机 test-plan 剔除 unit 层 AC，仅保留 ut_layer∈{device,both}。',
  }];
}

function checkTestCaseToAcceptance(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'test_case_to_acceptance';
  if (!plan) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const acRefs = extractTestCaseACRefs(plan);
  if (acRefs.size === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '无法解析用例的 AC 关联列。',
    }];
  }

  const noRef: string[] = [];
  for (const [tcId, refs] of acRefs) {
    if (refs.length === 0) {
      noRef.push(tcId);
    }
  }

  if (noRef.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: `全部 ${acRefs.size} 条测试用例都关联了 AC/BD 编号。`,
    }];
  }

  return [{
    id,
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', id),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${noRef.length} 条测试用例未关联 AC/BD 编号：\n${truncateList(noRef, 10)}`,
    suggestion: '每条测试用例的「关联 AC」列应包含至少一个 AC 或 BD 编号。',
  }];
}

function checkPlanToReportConsistency(ctx: CheckContext, plan: string | null, report: string | null): CheckResult[] {
  const id = 'plan_to_report_consistency';
  if (!plan || !report) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `${!plan ? 'test-plan.md' : 'test-report.md'} 不存在，无法做一致性校验。`,
    }];
  }

  const planIds = new Set(extractTestCaseIds(plan));
  const reportIds = new Set(extractReportCaseIds(report));

  if (planIds.size === 0 || reportIds.size === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无法解析计划或报告中的用例编号。',
    }];
  }

  const inPlanNotReport = [...planIds].filter(id => !reportIds.has(id));
  const inReportNotPlan = [...reportIds].filter(id => !planIds.has(id));

  if (inPlanNotReport.length === 0 && inReportNotPlan.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `计划与报告的用例编号完全一致（${planIds.size} 条）。`,
    }];
  }

  const details: string[] = [];
  if (inPlanNotReport.length > 0) {
    details.push(`计划中有但报告中缺失的用例：\n${truncateList(inPlanNotReport, 10)}`);
  }
  if (inReportNotPlan.length > 0) {
    details.push(`报告中有但计划中未定义的用例：\n${truncateList(inReportNotPlan, 10)}`);
  }

  return [{
    id,
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', id),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: details.join('\n'),
    suggestion: '测试报告中的用例编号必须与测试计划中一一对应。',
  }];
}

function checkDefectToTestCase(ctx: CheckContext, plan: string | null, report: string | null): CheckResult[] {
  const id = 'defect_to_test_case';
  if (!report) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'test-report.md 不存在。',
    }];
  }

  const defectSection = getSectionContent(report, '缺陷');
  if (!defectSection) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: '无缺陷清单章节（可能无缺陷）。',
    }];
  }

  if (defectSection.includes('无缺陷') || defectSection.includes('所有用例全部通过')) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: '无缺陷。',
    }];
  }

  const tables = extractTables(defectSection);
  if (tables.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '缺陷清单无表格，无法校验。',
    }];
  }

  const defectTable = tables[0];
  const caseCol = defectTable.headers.findIndex(h => h.includes('关联用例') || h.includes('用例'));
  if (caseCol === -1) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'WARN',
      details: '缺陷清单表格无「关联用例」列。',
      suggestion: '缺陷清单应包含「关联用例」列，引用测试用例编号。',
    }];
  }

  const planCaseIds = plan ? new Set(extractTestCaseIds(plan)) : new Set<string>();
  const invalidRefs: string[] = [];

  for (const row of defectTable.rows) {
    const caseRef = (row[caseCol] || '').trim();
    if (caseRef && planCaseIds.size > 0) {
      const refs = caseRef.split(/[,，、\s]+/).filter(r => r);
      for (const ref of refs) {
        if (!planCaseIds.has(ref)) {
          invalidRefs.push(`${ref}（在缺陷清单中引用但不在测试计划中）`);
        }
      }
    }
  }

  if (invalidRefs.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', id),
      severity: 'MAJOR',
      status: 'PASS',
      details: '缺陷清单中的用例引用全部有效。',
    }];
  }

  return [{
    id,
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', id),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${invalidRefs.length} 个无效的用例引用：\n${truncateList(invalidRefs, 10)}`,
    suggestion: '缺陷清单中的「关联用例」编号必须指向测试计划中的有效用例编号。',
  }];
}

// --------------------------------------------------------------------------
// Boundary Coverage (additional traceability)
// --------------------------------------------------------------------------

function checkBoundaryCoverage(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'boundary_coverage';
  const acceptance = ctx.featureSpec.acceptance;

  if (!acceptance?.boundaries?.length) {
    return [{
      id,
      category: 'traceability',
      description: '边界场景应被测试计划覆盖',
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'acceptance.yaml 无 boundaries 列表。',
    }];
  }

  if (!plan) {
    return [{
      id,
      category: 'traceability',
      description: '边界场景应被测试计划覆盖',
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'test-plan.md 不存在。',
    }];
  }

  const acRefs = extractTestCaseACRefs(plan);
  const allCoveredACs = new Set<string>();
  for (const refs of acRefs.values()) {
    for (const ref of refs) {
      allCoveredACs.add(ref.toUpperCase().replace(/\s/g, ''));
    }
  }

  const deviceBoundaries = (acceptance.boundaries ?? []).filter(
    b => isDeviceUtLayer(b.ut_layer),
  );
  const uncovered = deviceBoundaries.filter(b => {
    const normalizedId = b.id.toUpperCase().replace(/\s/g, '');
    return !allCoveredACs.has(normalizedId);
  });

  if (uncovered.length === 0) {
    return [{
      id,
      category: 'traceability',
      description: '边界场景应被测试计划覆盖',
      severity: 'MAJOR',
      status: 'PASS',
      details: `全部 ${deviceBoundaries.length} 个 device 层边界场景被测试用例覆盖。`,
    }];
  }

  const details: string[] = [];
  details.push(`BD 覆盖率: ${acceptance.boundaries.length - uncovered.length}/${acceptance.boundaries.length}`);
  details.push('未覆盖的边界场景:');
  for (const b of uncovered.slice(0, 10)) {
    details.push(`  - ${b.id}: ${b.description}`);
  }

  return [{
    id,
    category: 'traceability',
    description: '边界场景应被测试计划覆盖',
    severity: 'MAJOR',
    status: 'WARN',
    details: details.join('\n'),
    suggestion: '建议为未覆盖的边界场景补充测试用例。',
  }];
}

// --------------------------------------------------------------------------
// device-testing · device_test.build / device_test.install（profile capability 驱动）
// --------------------------------------------------------------------------

const TESTING_HARNESS_ROOT = path.resolve(__dirname, '..');

/** build → install → run 共享：build 写入 hapPath；install PASS 时置 installPassed */
interface DeviceTestPipelineHolder {
  hapPath: string | null;
  installPassed: boolean;
  installExternallyBlocked: boolean;
  buildReused: boolean;
  /** Set after device_test_run when hylyre trace is available */
  hylyreTracePath: string | null;
  deviceTestRunExecuted: boolean;
}

function buildDeviceInstallFailResults(
  ctx: CheckContext,
  holder: DeviceTestPipelineHolder,
  id: string,
  desc: string,
  fallbackDetails: string,
): CheckResult[] {
  const diag = diagnoseInstallBlocking(ctx.projectRoot);
  if (diag.kind === 'externalBlocked') {
    holder.installExternallyBlocked = true;
    const testingDiag = {
      ...diag,
      nextAction: 'device_ready_then_rerun_testing',
    };
    writeInstallDiagJson(
      ctx.projectRoot,
      ctx.feature,
      ctx.phase,
      ctx.frameworkRoot,
      testingDiag,
      'testing-install-diag.json',
    );
    const fields = mapInstallBlockingToTestingCheckFields(testingDiag);
    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: buildInstallBlockingCheckDetails(testingDiag, 'testing-install-diag.json'),
        suggestion: fields.suggestion,
        failure_kind: fields.failure_kind,
        blocking_class: fields.blocking_class,
      },
    ];
  }
  return [
    {
      id,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: fallbackDetails,
    },
  ];
}

function checkDeviceTestBuildGate(
  ctx: CheckContext,
  out: DeviceTestPipelineHolder,
): CheckResult[] {
  const id = 'device_test_build';
  const desc = ruleDesc(ctx, 'structure_checks', id);

  try {
    if (isCapabilitySkipped(ctx.resolvedProfile, 'device_test.build')) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'project_profile 声明 device_test.build 为 SKIP，未执行真机包编译。',
        },
      ];
    }

    const res = dispatchDeviceTestBuild(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: TESTING_HARNESS_ROOT,
      frameworkRoot: ctx.frameworkRoot,
      feature: ctx.feature,
      phase: ctx.phase,
    }) as DeviceTestBuildResult;

    out.hapPath = res.hapPath;
    out.buildReused = Boolean(res.reused);

    const hv = res.hvigor;
    if (hv.skippedByEnv) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `已设置跳过环境变量，不允许作为 testing 出口。\n${hv.logExcerpt ?? ''}`,
        },
      ];
    }
    if (hv.toolMissing) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: hv.logExcerpt ?? 'hvigor 工具缺失',
        },
      ];
    }

    const compileOk =
      Boolean(res.reused) ||
      (hv.executed &&
        !hv.timedOut &&
        hv.exitCode === 0 &&
        (hv.errors?.length ?? 0) === 0 &&
        hv.successMarkerFound !== false);

    if (!compileOk) {
      // P2：复用与 coding/ut 同一套（已根治的）依赖归因器，给弱模型可执行指引，
      // 而不是甩一段裸日志。depIssue.found 已收敛为"命中真实解析失败信号"（见 hvigor-runner P0-A）。
      let attribution: string[] = [];
      try {
        const depIssue = analyzeProjectDependencyIssueViaProfile(ctx, {
          logExcerpt: hv.logExcerpt,
          errors: hv.errors ?? [],
          logAbsPath: hv.logAbsPath,
        });
        if (depIssue?.found) {
          attribution = [
            '── harness 归因：工程依赖解析失败（非本轮测试代码）──',
            depIssue.missingDeclarations?.length
              ? `未在 oh-package.json5 声明：${depIssue.missingDeclarations.join(', ')}；补声明后重跑。`
              : `解析失败依赖：${(depIssue.dependencies ?? []).join(', ') || '(见日志)'}。`,
          ];
        } else {
          const firstErr = (hv.errors ?? [])[0];
          attribution = [
            firstErr
              ? `── harness 归因：真实编译错误，定位并修复后重跑 → ${firstErr.file ?? ''}${firstErr.line ? ':' + firstErr.line : ''} ${firstErr.message}`
              : '── harness 归因：非依赖问题，按日志定位首个编译错误的 file:line 改代码后重跑 ──',
          ];
        }
      } catch {
        // 归因是增益，失败不影响 BLOCKER 判定
      }
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: [
            `device_test.build 失败：exit=${hv.exitCode}, timedOut=${Boolean(hv.timedOut)}, successMarker=${String(hv.successMarkerFound)}`,
            `命令：${hv.command ?? '(unknown)'}`,
            `日志：${hv.logPath ?? '(无)'}`,
            res.hapPath ? `解析 HAP：${res.hapPath}` : '未解析到 signed 主 HAP（编译失败或未产出）',
            ...(attribution.length ? ['', ...attribution] : []),
            ...(hv.diagnostics?.length
              ? ['', '── harness 诊断 ──', ...hv.diagnostics.map(d => `• ${d}`)]
              : []),
            '',
            hv.logExcerpt ?? '',
          ].join('\n'),
        },
      ];
    }

    if (!res.hapPath) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: [
            `hvigor 已通过但未在各模块 build/${res.resolvedProduct}/outputs/default/ 下找到合适的 *-signed.hap。`,
            '请确认入口模块已产出主应用 HAP；可参考 reports/<feature>/testing/device-test-build.result.json。',
          ].join('\n'),
        },
      ];
    }

    const reuseLine = res.reused
      ? `复用 HAP（跳过 hvigor）：${res.reuseReason ?? ''}；hapBuiltAt=${res.hapBuiltAt ?? '(未知)'}`
      : `hvigor 已执行；日志: ${hv.logPath ?? '(无)'}`;

    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'PASS',
        details: [
          `product=${res.resolvedProduct} buildMode=${res.resolvedBuildMode}`,
          `HAP: ${res.hapPath}`,
          reuseLine,
        ].join('\n'),
      },
    ];
  } catch (err) {
    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `device_test.build 执行异常：${(err as Error).message}`,
      },
    ];
  }
}

function checkDeviceTestInstallGate(
  ctx: CheckContext,
  holder: DeviceTestPipelineHolder,
): CheckResult[] {
  const id = 'device_test_install';
  const desc = ruleDesc(ctx, 'structure_checks', id);

  try {
    if (isCapabilitySkipped(ctx.resolvedProfile, 'device_test.install')) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'project_profile 声明 device_test.install 为 SKIP。',
        },
      ];
    }

    if (isCapabilitySkipped(ctx.resolvedProfile, 'device_test.build')) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'device_test.build 已 SKIP，同步跳过装机门禁。',
        },
      ];
    }

    const hapPath = holder.hapPath;
    if (!hapPath) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: '无可用主应用 HAP 路径（请先修复 device_test.build）。',
        },
      ];
    }

    const res = dispatchDeviceTestInstall(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: TESTING_HARNESS_ROOT,
      frameworkRoot: ctx.frameworkRoot,
      feature: ctx.feature,
      phase: ctx.phase,
      hapPath,
      buildReused: holder.buildReused,
    }) as DeviceTestInstallResult;

    if (res.skippedByEnv) {
      return buildDeviceInstallFailResults(
        ctx,
        holder,
        id,
        desc,
        res.errors.map(e => e.message).join('\n'),
      );
    }

    if (!res.ok) {
      return buildDeviceInstallFailResults(
        ctx,
        holder,
        id,
        desc,
        [...res.errors.map(e => e.message), res.logPath ? `装机日志: ${res.logPath}` : '']
          .filter(Boolean)
          .join('\n'),
      );
    }

    holder.installPassed = true;

    const installDetail = res.reused
      ? `复用装机（跳过 hdc install）：${hapPath}`
      : `已安装: ${hapPath}`;

    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'PASS',
        details: [installDetail, res.logPath ? `日志: ${res.logPath}` : ''].filter(Boolean).join('\n'),
      },
    ];
  } catch (err) {
    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `device_test.install 执行异常：${(err as Error).message}`,
      },
    ];
  }
}

function readBundleNameFromAppScope(projectRoot: string): string {
  const p = path.join(projectRoot, 'AppScope', 'app.json5');
  const raw = fs.readFileSync(p, 'utf-8');
  const m = raw.match(/"bundleName"\s*:\s*"([^"]+)"/);
  if (!m) {
    throw new Error('无法在 AppScope/app.json5 解析 bundleName');
  }
  return m[1];
}

type DeriveHintAugment = {
  coverage_reason?:
    | 'no_derived'
    | 'incomplete'
    | 'stale'
    | 'extra_in_derived'
    | 'invalid_derived_steps';
  top_tc_ids?: string[];
  derived_tc_ids?: string[];
  missing_tc_ids?: string[];
  explicit_skip_tc_ids?: string[];
  selected_derived_path?: string | null;
  rejected_placeholder_paths?: string[];
  source_plan_mtime_iso?: string;
  selected_derived_mtime_iso?: string;
  lint_violations?: NavLintViolation[];
};

function absToProjectRel(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).replace(/\\/g, '/');
}

/**
 * 派生计划缺失或不满足 SSOT 覆盖时写入 JSON，供 agent 生成/补齐 test-plan.hylyre.md。
 * @returns 绝对路径；写盘失败时返回 null
 */
function writeDeriveHintFromPlanJson(ctx: CheckContext, aug?: DeriveHintAugment): string | null {
  try {
    const base = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    fs.mkdirSync(base, { recursive: true });
    const hintPath = path.join(base, 'derive-hint-from-plan.json');
    const topResolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
    const topPath = topResolved.actualPath;
    let test_cases = [] as ReturnType<typeof attachNavigationHints>;
    let source_relative = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
    let source_plan_mtime_iso: string | undefined;
    let defaultTopIds: string[] = [];

    if (fs.existsSync(topPath)) {
      const raw = fs.readFileSync(topPath, 'utf-8');
      test_cases = attachNavigationHints(extractTopPlanTestCasesForDeriveHint(raw));
      source_plan_mtime_iso = new Date(fs.statSync(topPath).mtimeMs).toISOString();
      defaultTopIds = extractTcIdsFromPlanTable(raw);
    } else {
      source_relative = '(test-plan.md 不存在)';
    }

    const payload = {
      schema: 3,
      feature: ctx.feature,
      phase: ctx.phase,
      generated_at: new Date().toISOString(),
      source_relative,
      source_plan_mtime_iso: aug?.source_plan_mtime_iso ?? source_plan_mtime_iso,
      test_cases,
      top_tc_ids: aug?.top_tc_ids ?? defaultTopIds,
      derived_tc_ids: aug?.derived_tc_ids,
      missing_tc_ids: aug?.missing_tc_ids,
      explicit_skip_tc_ids: aug?.explicit_skip_tc_ids,
      selected_derived_path: aug?.selected_derived_path,
      rejected_placeholder_paths: aug?.rejected_placeholder_paths,
      coverage_reason: aug?.coverage_reason,
      selected_derived_mtime_iso: aug?.selected_derived_mtime_iso,
      lint_violations: aug?.lint_violations,
      navigation_discipline:
        'Nav 子页回 Tab 须用 {"back":{}}（或 back.mode=swipe）；禁止无 area/at 的 swipe RIGHT/LEFT 代替返回。单会话 run --plan 时，进入子页的 TC 建议末步 teardown back，后续要求首页 Tab 的 TC 首步须 back。',
      next_agent_step:
        '按 profile「真机自动化」与「单会话导航纪律」在 testing/reports/<新 timestamp>/hylyre/ 落盘 test-plan.hylyre.md；遵守各 test_cases[].navigation_hint；勿使用 forbidden_patterns。顶层 test-plan.md 为 SSOT。',
    };
    fs.writeFileSync(hintPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    return hintPath;
  } catch {
    return null;
  }
}

function checkDeviceTestRunGate(
  ctx: CheckContext,
  hapHolder: DeviceTestPipelineHolder,
): CheckResult[] {
  const id = 'device_test_run';
  const desc = ruleDesc(ctx, 'structure_checks', id);

  try {
    if (isCapabilitySkipped(ctx.resolvedProfile, 'device_test.run')) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'project_profile 声明 device_test.run 为 SKIP，未执行真机自动化测试。',
        },
      ];
    }

    if (isCapabilitySkipped(ctx.resolvedProfile, 'device_test.install')) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'device_test.install 已 SKIP，同步跳过真机自动化测试。',
        },
      ];
    }

    if (!hapHolder.installPassed) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'device_test.install 未 PASS（或未执行成功），同步跳过真机自动化测试。',
        },
      ];
    }

    const reportsBase = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    const expectedDir = path.join(reportsBase, '<timestamp>', 'hylyre');
    const topResolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
    const topPath = topResolved.actualPath;
    const topRaw = fs.existsSync(topPath) ? fs.readFileSync(topPath, 'utf-8') : '';
    const topIds = extractTcIdsFromPlanTable(topRaw);
    const topStat = fs.existsSync(topPath) ? fs.statSync(topPath) : null;

    const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
    const rejectedRel = pick.rejectedPlaceholders.map(p => absToProjectRel(ctx.projectRoot, p));

    if (!pick.selected) {
      const hintPath = writeDeriveHintFromPlanJson(ctx, {
        coverage_reason: 'no_derived',
        top_tc_ids: topIds,
        rejected_placeholder_paths: rejectedRel.length > 0 ? rejectedRel : undefined,
      });
      const hintLine = hintPath
        ? `已写入 derive-hint-from-plan.json：${hintPath}（含 top_tc_ids / rejected_placeholder_paths）。`
        : '未能写入 derive-hint-from-plan.json（检查 testing/reports 目录写权限）。';
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `未找到有效的 Hylyre 派生测试计划（已排除烟测占位；期望路径形如 ${expectedDir}）。请按 device-testing Step 4.5 落盘 test-plan.hylyre.md 后重试。\n${hintLine}`,
        },
      ];
    }

    const derivedPath = pick.selected.hylyrePath;
    const derivedContent = pick.selected.content;
    const explicitSkips = loadExplicitSkipTcIds(derivedPath, derivedContent);
    const derivedIds = extractTcIdsFromPlanTable(derivedContent);
    const cov = evaluateDerivedCoverage({
      topTcIds: topIds,
      derivedTcIds: derivedIds,
      explicitSkipTcIds: explicitSkips,
    });

    const derivedStat = fs.statSync(derivedPath);
    const derivedMtimeIso = new Date(derivedStat.mtimeMs).toISOString();
    const topMtimeIso = topStat ? new Date(topStat.mtimeMs).toISOString() : undefined;
    const stale = Boolean(topStat && derivedStat.mtimeMs < topStat.mtimeMs);

    const hintBase: DeriveHintAugment = {
      top_tc_ids: topIds,
      derived_tc_ids: derivedIds,
      explicit_skip_tc_ids: explicitSkips,
      selected_derived_path: absToProjectRel(ctx.projectRoot, derivedPath),
      rejected_placeholder_paths: rejectedRel.length > 0 ? rejectedRel : undefined,
      source_plan_mtime_iso: topMtimeIso,
      selected_derived_mtime_iso: derivedMtimeIso,
    };

    if (cov.extra.length > 0) {
      writeDeriveHintFromPlanJson(ctx, {
        ...hintBase,
        coverage_reason: 'extra_in_derived',
        missing_tc_ids: cov.missing,
      });
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `派生计划包含顶层 test-plan.md 中未声明的用例编号：${cov.extra.join(', ')}（derive-hint-from-plan.json 已更新）`,
        },
      ];
    }

    if (cov.missing.length > 0) {
      const hintPath = writeDeriveHintFromPlanJson(ctx, {
        ...hintBase,
        coverage_reason: 'incomplete',
        missing_tc_ids: cov.missing,
      });
      const hintLine = hintPath ? `详情见 ${hintPath}` : '';
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `派生 Hylyre 计划未覆盖顶层 test-plan.md 中的用例：${cov.missing.join(', ')}。请在派生表补全或在 YAML frontmatter / derive-manifest.json 登记 explicit_skip_tc_ids。\n${hintLine}`,
        },
      ];
    }

    if (stale) {
      const hintPath = writeDeriveHintFromPlanJson(ctx, {
        ...hintBase,
        coverage_reason: 'stale',
      });
      const hintLine = hintPath ? `详情见 ${hintPath}` : '';
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `派生计划早于顶层 test-plan.md 更新（mtime），可能过期。请重新派生或更新派生文件后重试。\n${hintLine}`,
        },
      ];
    }

    const topCases = extractTopPlanTestCasesForDeriveHint(topRaw);
    const navLint = lintDerivedHylyrePlanSteps(derivedContent, topCases);
    if (!navLint.ok) {
      const hintPath = writeDeriveHintFromPlanJson(ctx, {
        ...hintBase,
        coverage_reason: 'invalid_derived_steps',
        lint_violations: navLint.violations,
      });
      const lines = navLint.violations.map(
        v => `  - [${v.rule_id}] ${v.tc_id}: ${v.message}（建议：${v.suggested_fix}）`,
      );
      const hintLine = hintPath ? `详情与 navigation_hint 见 ${hintPath}` : '';
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: [
            '派生 Hylyre 计划未通过导航步骤静态门禁（NAV-001/002/003）：',
            ...lines,
            '请按 framework profile「单会话导航纪律」重新派生 test-plan.hylyre.md（勿手改旧 timestamp 目录）。',
            hintLine,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ];
    }

    const ready = dispatchDeviceTestEnsureReady(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: TESTING_HARNESS_ROOT,
      frameworkRoot: ctx.frameworkRoot,
      feature: ctx.feature,
      phase: ctx.phase,
    }) as HylyreReadyResult;

    if (!ready.ok) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: [
            '真机自动化环境准备失败：',
            ...ready.errors.map(e => `  - ${e.message}`),
            ready.logPath ? `详细日志：${ready.logPath}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          suggestion: '若 Python 依赖无法安装，请按 hmos-app profile 附录「真机自动化」章配置 PyPI 镜像或内部源。',
        },
      ];
    }

    const bundleName = readBundleNameFromAppScope(ctx.projectRoot);
    const hylyreOutDir = path.dirname(derivedPath);
    const hylyreCfg = resolveHylyreToolConfig(ctx.projectRoot);
    const appSnapshotCacheAbs = path.resolve(ctx.projectRoot, hylyreCfg.app_snapshot_cache_dir);
    fs.mkdirSync(appSnapshotCacheAbs, { recursive: true });

    const coldRestartEnv = process.env.HARNESS_DEVICE_TEST_COLD_RESTART?.trim();
    const coldRestart =
      coldRestartEnv === '1' ? true : coldRestartEnv === '0' ? false : hylyreCfg.cold_restart_before_run;

    const run = dispatchDeviceTestRun(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: TESTING_HARNESS_ROOT,
      frameworkRoot: ctx.frameworkRoot,
      feature: ctx.feature,
      phase: ctx.phase,
      pythonPath: ready.pythonPath,
      derivedPlanPath: path.resolve(derivedPath),
      reportOutPath: path.resolve(path.join(hylyreOutDir, 'test-report.md')),
      traceOutPath: path.resolve(path.join(hylyreOutDir, 'trace.json')),
      bundleName,
      deviceSn: process.env.HARNESS_HDC_TARGET,
      skipAssertExpected: true,
      coldRestart,
      appSnapshotCacheAbs,
    }) as HylyreRunResult;

    if (!run.ok) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          // review#2：runner 崩溃（!run.ok）= 真机环境/工具链问题，非 UI/业务代码 → 标 device_toolchain，
          // 让 goal 失败分类归 toolchain（早 halt 修环境、勿误导改码）。下方"用例失败"路径不打此标 → code_regression。
          blocking_class: 'device_toolchain',
          details: [`真机自动化执行失败：exit=${run.exitCode}`, `命令：${run.command}`, `日志：${run.logPath}`, ...run.errors.map(e => `  - ${e.message}`)].join('\n'),
        },
      ];
    }

    const summary = run.trace
      ? `outcome=${run.trace.outcome}, cases=${(run.trace.cases ?? []).length}`
      : '无 trace.json';

    try {
      const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
      const timingDoc = collectDeviceTestTimings({
        projectRoot: ctx.projectRoot,
        feature: ctx.feature,
        reportsDir,
        hylyreTracePath: run.tracePath,
      });
      writeDeviceTestTimingJson(reportsDir, timingDoc);
    } catch {
      /* timing 汇总失败不阻断 run 门禁 */
    }

    hapHolder.hylyreTracePath = run.tracePath;
    hapHolder.deviceTestRunExecuted = true;

    const outcomeEval = evaluateHylyreRunOutcome(run.trace);
    const runGatePass = outcomeEval.verdict === 'pass';

    const out: CheckResult[] = [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: runGatePass ? 'PASS' : 'FAIL',
        details: [
          `真机自动化执行完成：exit=${run.exitCode}, ${summary}`,
          `报告：${run.reportPath}`,
          `trace：${run.tracePath}`,
          ...(runGatePass
            ? []
            : [
                '自动化产物未达标（run.ok 仅表示 runner 未崩溃）：',
                ...outcomeEval.reasonLines.map(l => `  - ${l}`),
              ]),
        ].join('\n'),
        suggestion: runGatePass
          ? '顶层 test-report.md 须与 hylyre trace 对账一致；失败用例须在报告与缺陷清单中如实登记。'
          : '修复失败/阻塞用例或 trace.outcome 非 success 后重跑 device_test.run；勿在顶层报告谎报通过。',
      },
    ];

    if (run.ok && !isDeviceVisualDiffSkipped(ctx.resolvedProfile)) {
      const specMd = loadSpecMarkdown(ctx.projectRoot, ctx.feature);
      if (specMd !== null) {
        const uiChange = parseUiChangeFromSpecMarkdown(specMd);
        if (uiChange === 'new_or_changed') {
          const { hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
            ctx.projectRoot,
            ctx.feature,
            ctx.phase,
            ctx.frameworkRoot,
          );
          // round5 P1-A：有固化 nav 配置则按屏导航到位再截（根除多屏截同一帧）。
          const navConfig = loadVisualDiffNavConfig(ctx.projectRoot, ctx.feature);
          // P1-A fail-fast（消费 validateNavConfig，不静默裸采）：≥2 P0 屏须导航区分；缺配置/配置不一致=明确失败，不进 capture（防误导 PASS）。
          const navUiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
          const navP0TargetIds = collectP0VisualTargetIds(navUiDoc);
          const navValidation = navConfig ? validateNavConfig(navConfig, navP0TargetIds) : null;
          const navGateError = navConfig
            ? (navValidation && !navValidation.ok
                ? `nav 配置与 ui-spec 屏集不一致/步骤非法：${navValidation.errors.slice(0, 6).join('；')}${navValidation.errors.length > 6 ? '…' : ''}`
                : null)
            : (navP0TargetIds.length >= 2
                ? `缺固化 nav 配置：${navP0TargetIds.length} 个 P0 屏须按屏导航区分，否则多屏截同一帧（曾致 5 屏同 hash）`
                : null);
          if (navGateError) {
            const navRatchet = fidelityRatchetFailOrWarn(ctx, true);
            out.push({
              id: 'visual_diff_capture',
              category: 'structure',
              description: 'device_test.run 后 visual_diff 自动截图与骨架采集',
              severity: navRatchet.severity,
              status: navRatchet.status,
              details: `【nav 配置门禁·P1-A】${navGateError}\n不静默裸采（防多屏截同一帧）；补齐 device-testing/visual-diff-nav.json（key=屏标识含 overlay、value=touch/wait_for/back 到达步骤）后重跑。`,
              suggestion: '为每个 P0 屏（含 overlay）写固化到达步骤；页面结构无变化则复用、不需重生成。',
            });
          } else {
          // P0-9a：当前构建指纹现算自实际安装 hap（hapHolder.hapPath 即 build→install 的产物）；
          // 算不出=null → capture 一律不跳采（codex 硬前提）。
          const currentBuildFingerprint = computeHapBuildFingerprint(hapHolder.hapPath);
          const cap = captureVisualDiff({
            projectRoot: ctx.projectRoot,
            feature: ctx.feature,
            specMd,
            ctx,
            computeScoreFloor: true,
            currentBuildFingerprint,
            bundleName,
            deviceSn: process.env.HARNESS_HDC_TARGET,
            screenshotFn: buildHylyreVisualDiffScreenshotFn({
              pythonPath: ready.pythonPath,
              hypiumWorkDir,
              deviceSn: process.env.HARNESS_HDC_TARGET,
              logPath: run.logPath,
            }),
            ...(navConfig
              ? {
                  navConfig,
                  navExecutorFn: buildHylyreNavExecutorFn({
                    pythonPath: ready.pythonPath,
                    hypiumWorkDir,
                    deviceSn: process.env.HARNESS_HDC_TARGET,
                    bundleName,
                    logPath: run.logPath,
                    // 与 device_test.run 的 app 启动方式对齐（宿主热修回收，round6 收尾批 P0-3）
                    ...readDeviceTestRunHylyreNavOpts(run.logPath),
                  }),
                }
              : {}),
          });
          const p0Failed = cap.p0CaptureFailures ?? [];
          // P0-9c："新鲜"重定义——build 指纹有效的跳采（screensPreservedBuildValid）＝合法新鲜，
          // 不算陈旧证据；stalePreserved 只拦"未刷新且非 build 有效"的 preserved（采集失败回退
          // 旧 json / legacy 无指纹 preserved 照旧 FAIL，反陈旧证据语义不丢）。
          const preservedBuildValid = cap.screensPreservedBuildValid ?? 0;
          const stalePreserved =
            cap.screensWritten === 0 && (cap.screensPreserved ?? 0) > 0;
          if (cap.ok && (p0Failed.length > 0 || stalePreserved)) {
            // E1/E2：P0 截图失败 / 全靠 preserved 旧证据充数 → 不得静默 PASS（pixel_1to1 FAIL，否则 blocking WARN）。
            // 宿主 homepage 实测：6 屏全 Permission denied、screens=0+preserved=1 仍 PASS，等于在陈旧/错图上闭环。
            const ratchet = fidelityRatchetFailOrWarn(ctx, true);
            out.push({
              id: 'visual_diff_capture',
              category: 'structure',
              description: 'device_test.run 后 visual_diff 自动截图与骨架采集',
              severity: ratchet.severity,
              status: ratchet.status,
              details: [
                p0Failed.length > 0
                  ? `P0 屏截图失败（采集证据未刷新）：${p0Failed.join(', ')}`
                  : 'screensWritten=0：未刷新任何截图，沿用 preserved 旧 visual-diff 判定（证据陈旧）',
                `screens=${cap.screensWritten}`,
                ...(typeof cap.screensPreserved === 'number' && cap.screensPreserved > 0
                  ? [`preserved=${cap.screensPreserved}`]
                  : []),
                'pixel_1to1 下不得以陈旧/缺失证据通过；沿用旧 shot/旧 verdict 闭环＝假证据。',
                ...(cap.errors.length ? [`notes:\n${cap.errors.map(e => `  - ${e}`).join('\n')}`] : []),
              ].join('\n'),
              suggestion: '修复截图采集（Permission denied/锁屏/设备占用）后重采 P0 屏；不得沿用旧 shot/旧 verdict。',
            });
          } else if (cap.ok) {
            out.push({
              id: 'visual_diff_capture',
              category: 'structure',
              description: 'device_test.run 后 visual_diff 自动截图与骨架采集',
              severity: 'MAJOR',
              status: 'PASS',
              details: [
                `screens=${cap.screensWritten}`,
                ...(typeof cap.screensPreserved === 'number' && cap.screensPreserved > 0
                  ? [`preserved=${cap.screensPreserved}`]
                  : []),
                ...(preservedBuildValid > 0
                  ? [`preserved_build_valid=${preservedBuildValid}（build 指纹有效跳采，判定持久·P0-9a）`]
                  : []),
                ...(typeof cap.screensInvalidated === 'number' && cap.screensInvalidated > 0
                  ? [`invalidated=${cap.screensInvalidated}`]
                  : []),
                'json=device-testing/device-screenshots/visual-diff.json',
                ...(cap.errors.length ? [`notes:\n${cap.errors.map(e => `  - ${e}`).join('\n')}`] : []),
              ].join('\n'),
            });
          } else if (cap.skippedReason !== 'no_p0_targets') {
            // E1：no_captures（全失败）或有 P0 截图失败 → pixel_1to1 FAIL，否则 WARN；
            // 纯环境缺失（如 no_screenshot_fn）维持 WARN（与 degraded 同档）。
            const captureFailed =
              cap.skippedReason === 'no_captures' || (cap.p0CaptureFailures?.length ?? 0) > 0;
            const ratchet = captureFailed
              ? fidelityRatchetFailOrWarn(ctx, true)
              : { severity: 'MAJOR' as const, status: 'WARN' as const };
            out.push({
              id: 'visual_diff_capture',
              category: 'structure',
              description: 'device_test.run 后 visual_diff 自动截图与骨架采集',
              severity: ratchet.severity,
              status: ratchet.status,
              details: [
                `采集未完成：${cap.skippedReason ?? 'unknown'}`,
                ...((cap.p0CaptureFailures?.length ?? 0) > 0
                  ? [`P0 屏截图失败：${cap.p0CaptureFailures!.join(', ')}`]
                  : []),
                ...cap.errors,
              ].join('\n'),
              suggestion: '确认 Hylyre 可 `screenshot`（排查 Permission denied/锁屏/占用）；非顶层屏须 device-testing 导航后重跑采集。',
            });
          }
          }
        }
      }
    }

    const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    const pollutionHit = loadTestingRootPollutionMeta(reportsDir);
    if (pollutionHit) {
      out.push({
        id: 'hylyre_root_pollution',
        category: 'structure',
        description: '宿主工程根 Hylyre/Hypium 误落盘（root_pollution）',
        severity: 'MINOR',
        status: 'WARN',
        details: formatRootPollutionWarnDetails(pollutionHit, reportsDir),
        suggestion:
          `确认 hylyre 子进程 cwd 为 ${relFeatureFile(ctx.projectRoot, ctx.feature, 'testing/reports/.hypium-workdir')}；勿在工程根直跑 python -m hylyre。升级 framework 后重跑 /framework-init。`,
      });
    }
    return out;
  } catch (err) {
    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `device_test.run 执行异常：${(err as Error).message}`,
      },
    ];
  }
}

function checkReportTraceReconciliation(
  ctx: CheckContext,
  report: string | null,
  pipeline: DeviceTestPipelineHolder,
): CheckResult[] {
  const id = 'report_trace_reconciliation';
  const desc = ruleDesc(ctx, 'structure_checks', id);

  if (isCapabilitySkipped(ctx.resolvedProfile, 'device_test.run')) {
    return [{
      id,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'device_test.run 已 SKIP，跳过 report↔trace 对账。',
    }];
  }

  if (!report) {
    return [{
      id,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'test-report.md 不存在，跳过 report↔trace 对账。',
    }];
  }

  if (!pipeline.installPassed) {
    return [{
      id,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'device_test.install 未 PASS，跳过 report↔trace 对账（无 Hylyre trace SSOT）。',
    }];
  }

  const reportsBase = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
  const tracePath =
    pipeline.hylyreTracePath ?? resolveAuthoritativeHylyreTracePath(reportsBase);

  const topLevelBackfill = path.join(reportsBase, 'trace.json');
  if (tracePath && fs.existsSync(topLevelBackfill) && path.resolve(topLevelBackfill) !== path.resolve(tracePath)) {
    /* explicit: never use top-level backfill as SSOT */
  }

  const recon = reconcileReportWithHylyreTrace(report, tracePath);

  if (!recon.ok) {
    return [{
      id,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: [
        `顶层 test-report.md 与 Hylyre trace 不一致（SSOT trace：${recon.tracePath ?? '未找到'}）`,
        ...recon.mismatches.map(m => `  - ${m}`),
        ...(recon.warnings.length ? [`notes:\n${recon.warnings.map(w => `  - ${w}`).join('\n')}`] : []),
      ].join('\n'),
      suggestion:
        '按 device-testing Step 5.1 从 hylyre/trace.json 回填执行状态；禁止谎报通过或结论=达标当 trace.outcome≠success。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: [
      `顶层报告与 Hylyre trace 全量对账一致`,
      `trace 来源：${recon.tracePath}`,
      ...(recon.warnings.length ? recon.warnings.map(w => `note: ${w}`) : []),
    ].join('\n'),
  }];
}

function loadUseCaseSpec(ctx: CheckContext): UseCasesSpec | null {
  const resolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'use-cases.yaml');
  if (!fs.existsSync(resolved.actualPath)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('yaml') as { parse: (s: string) => unknown };
    return yaml.parse(fs.readFileSync(resolved.actualPath, 'utf-8')) as UseCasesSpec;
  } catch {
    return null;
  }
}

function checkUiEntryCoverage(ctx: CheckContext): CheckResult[] {
  const id = 'ui_entry_coverage';
  const desc = ruleDesc(ctx, 'structure_checks', id);

  const spec = loadUseCaseSpec(ctx);
  if (!spec?.use_cases?.length) {
    return [{
      id,
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在或无 use_cases，跳过 UI 入口覆盖检查。',
    }];
  }

  const reportsBase = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
  const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
  if (!pick.selected) {
    return [{
      id,
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'SKIP',
      details: '无有效派生 Hylyre 计划，跳过 UI 入口覆盖检查。',
    }];
  }

  const acceptance = ctx.featureSpec.acceptance;
  const acPriorityMap = acceptance
    ? buildAcceptanceIdPriorityMap(acceptance)
    : new Map<string, string>();
  const entryPriorities = buildEntryUiPriorityMap(spec, acPriorityMap);
  const cov = evaluateUiEntryCoverage(spec, pick.selected.content, entryPriorities);

  const results: CheckResult[] = [];

  if (cov.warnings.length > 0) {
    results.push({
      id,
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: cov.warnings.join('\n'),
      suggestion: '派生 test-plan.hylyre.md 须为每个多入口业务调用携带 entry_ui / linked_flow / calls 结构化字段。',
    });
  }

  if (cov.blockers.length > 0) {
    results.push({
      id,
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `P0 多 UI 入口缺派生覆盖：\n${truncateList(cov.blockers, 20)}`,
      suggestion:
        '按 ui_bindings 为每个 UI 入口各派生一条 Hylyre 用例（entry_ui 字段），确保同一业务调用（如 flow.selectBank）的每个入口至少执行一次。',
    });
  }

  if (cov.majors.length > 0) {
    results.push({
      id,
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'FAIL',
      details: `非 P0 多 UI 入口缺派生覆盖：\n${truncateList(cov.majors, 20)}`,
      suggestion: '补派生 Hylyre 用例覆盖缺失入口。',
    });
  }

  if (results.length === 0) {
    results.push({
      id,
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'PASS',
      details: '多 UI 入口业务调用均在派生 Hylyre 计划中有结构化覆盖。',
    });
  }

  return results;
}

// --------------------------------------------------------------------------
// Main Checker
// --------------------------------------------------------------------------

function safeRun(fn: () => CheckResult[], checkId: string): CheckResult[] {
  try {
    return fn();
  } catch (err) {
    return [{
      id: checkId,
      category: 'structure',
      description: `${checkId} 执行异常`,
      severity: 'MINOR',
      status: 'SKIP',
      details: `检查执行时发生错误：${(err as Error).message}`,
    }];
  }
}

function buildTestingRunStatusResult(
  plan: string | null,
  report: string | null,
  results: CheckResult[],
): CheckResult {
  const build = results.find(r => r.id === 'device_test_build');
  const install = results.find(r => r.id === 'device_test_install');
  const deviceExternalBlocked =
    install?.status === 'FAIL' &&
    (install.blocking_class === 'externalBlocked' || install.failure_kind === 'device_blocked');
  const compilePassed = build?.status === 'PASS';
  const blockerFails = results.filter(r => r.status === 'FAIL' && r.severity === 'BLOCKER');
  const blockerSkips = results.filter(r => r.status === 'SKIP' && r.severity === 'BLOCKER');
  const blockingWarnings = results.filter(r => r.status === 'WARN' && r.severity === 'BLOCKER');
  const staticBlockerFails = blockerFails.filter(
    r => r.id !== 'device_test_build' && r.id !== 'device_test_install' && r.id !== 'device_test_run',
  );
  const canClaimDone = Boolean(plan && report) && blockerFails.length === 0 && blockerSkips.length === 0;

  const lines: string[] = [
    'Testing 阶段状态面板：',
    `- 文档结构规则：${staticBlockerFails.length === 0 ? 'PASS' : `FAIL（${staticBlockerFails.map(r => r.id).join(', ')}）`}`,
    `- 主应用打包：${build?.status ?? '未产生结果'}`,
    `- 真机装机：${install?.status ?? '未产生结果'}`,
    `- 当前是否可以宣称 testing 完成：${canClaimDone ? '是' : '否'}`,
    `can_claim_done: ${canClaimDone ? 'YES' : 'NO'}`,
    `test_plan: ${plan ? 'PRESENT' : 'MISSING'}`,
    `test_report: ${report ? 'PRESENT' : 'MISSING'}`,
    `blocker_fail_count: ${blockerFails.length}`,
    `blocker_skip_count: ${blockerSkips.length}`,
    `blocking_warn_count: ${blockingWarnings.length}`,
  ];
  if (deviceExternalBlocked && compilePassed) {
    lines.push('- partial_readiness: compile_passed_device_blocked（harness verdict 应为 INCOMPLETE，非 PASS）');
  }
  if (blockerFails.length > 0) {
    lines.push(`blocker_fail_ids: ${blockerFails.map(r => r.id).join(', ')}`);
  }
  if (blockerSkips.length > 0) {
    lines.push(`blocker_skip_ids: ${blockerSkips.map(r => r.id).join(', ')}`);
  }
  if (blockingWarnings.length > 0) {
    lines.push(`blocking_warn_ids: ${blockingWarnings.map(r => r.id).join(', ')}`);
  }
  if (!canClaimDone) {
    lines.push(`- 阻塞项：${blockerFails.map(r => r.id).join(', ') || '无 BLOCKER FAIL，但真机流水线未完成'}`);
  }

  return {
    id: 'testing_run_status',
    category: 'structure',
    description: 'Testing 阶段脚本门禁总体状态',
    severity: deviceExternalBlocked && compilePassed ? 'MINOR' : 'BLOCKER',
    status: canClaimDone ? 'PASS' : deviceExternalBlocked && compilePassed ? 'WARN' : 'FAIL',
    details: lines.join('\n'),
    suggestion: canClaimDone
      ? '脚本门禁可进入 verifier + receipt 闭环；仍需确认真机测试证据与报告语义质量。'
      : deviceExternalBlocked && compilePassed
        ? '接入真机/模拟器后重跑；summary.next_action=device_ready_then_rerun_testing；不允许宣称 testing 阶段完成。'
        : '补齐 test-plan.md / test-report.md，并修复 BLOCKER FAIL/SKIP 后重跑 testing harness。',
  };
}

const checker: PhaseChecker = {
  phase: 'testing',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const plan = loadDoc(ctx, 'test-plan.md');
    const report = loadDoc(ctx, 'test-report.md');

    if (!plan && !report) {
      const missingDocs: CheckResult = {
        id: 'testing_docs_missing',
        category: 'structure',
        description: '测试计划和测试报告都不存在',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `未找到 ${relFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md')} 和 ${relFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-report.md')}。测试阶段至少需要测试计划。`,
        suggestion: '请先运行 device-testing 生成测试计划。',
      };
      return [missingDocs, buildTestingRunStatusResult(plan, report, [missingDocs])];
    }

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, [
        'spec.md',
        'plan.md',
        'test-plan.md',
        'test-report.md',
      ]),
    ];

    results.push(
      ...safeRun(
        () => checkFactsArtifact(ctx.projectRoot, ctx.feature, 'testing', {
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
          frameworkRoot: ctx.frameworkRoot,
        }),
        'context_exploration_gate',
      ),
    );

    const deviceTestHapHolder: DeviceTestPipelineHolder = {
      hapPath: null,
      installPassed: false,
      installExternallyBlocked: false,
      buildReused: false,
      hylyreTracePath: null,
      deviceTestRunExecuted: false,
    };
    results.push(...checkDeviceTestBuildGate(ctx, deviceTestHapHolder));
    results.push(...checkDeviceTestInstallGate(ctx, deviceTestHapHolder));
    results.push(...checkDeviceTestRunGate(ctx, deviceTestHapHolder));
    results.push(
      ...safeRun(
        () => checkReportTraceReconciliation(ctx, report, deviceTestHapHolder),
        'report_trace_reconciliation',
      ),
    );
    results.push(...safeRun(() => checkUiEntryCoverage(ctx), 'ui_entry_coverage'));

    // --- Structure checks: Test Plan ---
    results.push(...safeRun(() => checkPlanRequiredChapters(ctx, plan), 'plan_required_chapters'));
    results.push(...safeRun(() => checkTestCaseTableFormat(ctx, plan), 'test_case_table_format'));
    results.push(...safeRun(() => checkTestCasePriorityValues(ctx, plan), 'test_case_priority_values'));
    results.push(...safeRun(() => checkTestEnvironmentDefined(ctx, plan), 'test_environment_defined'));
    results.push(...safeRun(() => checkPassCriteriaDefined(ctx, plan), 'pass_criteria_defined'));
    results.push(...safeRun(() => checkPlanMetadata(ctx, plan), 'plan_metadata_header'));

    // --- Structure checks: Test Report ---
    results.push(...safeRun(() => checkReportRequiredChapters(ctx, report), 'report_required_chapters'));
    results.push(...safeRun(() => checkExecutionResultTable(ctx, report), 'execution_result_table'));
    results.push(...safeRun(() => checkPassRateCalculated(ctx, report), 'pass_rate_calculated'));
    results.push(...safeRun(() => checkDefectTableFormat(ctx, report), 'defect_table_format'));
    results.push(...safeRun(() => checkReportConclusionWithVerdict(ctx, report), 'report_conclusion_with_verdict'));

    results.push(
      ...runAcceptanceYamlStructureChecks(ctx, (c, s, id) =>
        ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id),
      ),
    );

    // --- Traceability checks ---
    results.push(...safeRun(() => checkTestPlanFreshnessVsAcceptance(ctx), 'test_plan_freshness_vs_acceptance'));
    results.push(...safeRun(() => checkAcceptanceToTestCase(ctx, plan), 'acceptance_to_test_case'));
    results.push(...safeRun(() => checkPlanReferencesUnitLayerAc(ctx, plan), 'plan_references_unit_layer_ac'));
    results.push(...safeRun(() => checkTestCaseToAcceptance(ctx, plan), 'test_case_to_acceptance'));
    results.push(...safeRun(() => checkBoundaryCoverage(ctx, plan), 'boundary_coverage'));
    results.push(...safeRun(() => checkPlanToReportConsistency(ctx, plan, report), 'plan_to_report_consistency'));
    results.push(...safeRun(() => checkDefectToTestCase(ctx, plan, report), 'defect_to_test_case'));

    if (isDeviceVisualDiffSkipped(ctx.resolvedProfile)) {
      results.push({
        id: 'visual_diff',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'visual_diff'),
        severity: 'MINOR',
        status: 'SKIP',
        details: `project_profile=${ctx.resolvedProfile.name} 未启用 device_test.visual_diff`,
      });
    } else {
      results.push(...safeRun(() => dispatchDeviceVisualDiff(ctx), 'visual_diff'));
    }

    results.push(buildTestingRunStatusResult(plan, report, results));

    return results;
  },
};

export default checker;
