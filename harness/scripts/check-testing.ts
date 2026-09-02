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
import {
  fidelityRatchetFailOrWarn,
  isHardPixelContract,
  isPixel1to1,
  loadCapabilitySnapshot,
  loadSpecMarkdown,
  resolveUiRelevanceForRun,
} from './utils/fidelity-shared';
import { projectAxisRequiredForRelease } from './utils/quality-axes';
import { detectRepoLayout } from '../repo-layout';
import {
  resolveFeatureArtifact,
  relFeatureArtifact,
  relFeatureFile,
  featurePhaseReportsDir,
  receiptDirPath,
  resolveHylyreToolConfig,
} from '../config';
import { attachNavigationHints, extractTopPlanTestCasesForDeriveHint } from './utils/test-plan-derive-hint';
import {
  extractTcIdsFromPlanTable,
  selectBestNonPlaceholderDerivedPlan,
  evaluateChannelDerivedCoverage,
  evaluateDerivedCoverage,
  loadExplicitSkipTcIds,
  lintDerivedHylyrePlanSteps,
  lintHylyrePlanStepRules,
  prepareFreshHylyreRunDir,
  type NavLintViolation,
  type StepLintViolation,
} from './utils/derived-hylyre-plan';
import {
  buildStandardHylyreDerivePayloadBase,
  HYLYRE_PLANNED_STEP_FIELDS_REF,
  resolveHylyreResetIdentity,
} from './utils/hylyre-standard-derive-knowledge';
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
  probeDeviceTestEvidenceCapability,
  dispatchDeviceTestRun,
  dispatchDeviceTestEvidenceCompose,
} from '../capability-registry';
// d9e4b7c1 T2：evidence 落盘路径（与 goal-runner pre-delete/collector 共用同一 basename）
import { deviceTestEvidencePath } from './utils/device-test-evidence-shared';
import type {
  DeviceTestArtifactBinding,
  DeviceTestEvidenceDoc,
} from './utils/device-test-evidence-shared';
import { validateRuntimeFidelityEvidenceDocument } from './utils/runtime-step-evidence';
import { sha256File } from './utils/phase-evidence-manifest';
import {
  isDeviceVisualDiffSkipped,
  dispatchDeviceVisualDiff,
  resolveVisualProviderReview,
  dispatchVisualDiffDeterministicOnly,
  analyzeProjectDependencyIssueViaProfile,
} from '../capability-registry';
import type { DeviceTestBuildResult } from '../../profiles/hmos-app/harness/providers/device-test-build';
import type { HvigorRunResult } from '../../profiles/hmos-app/harness/hvigor-runner';
import { isHvigorBuildSuccessful } from './utils/hvigor-runner';
import { describeProductSelection } from '../../profiles/hmos-app/harness/product-selection';

/**
 * device_test_build 门禁的 PASS 判据（导出供 t1(f) 生产路径回归：**真实出口函数**）。
 * 复用 = 包已存在且新鲜（PASS）；否则须 hvigor 真实成功（与 coding/provider 同源判据）。
 */
export function deviceTestGateCompileOk(reused: boolean, hv: HvigorRunResult): boolean {
  return Boolean(reused) || isHvigorBuildSuccessful(hv);
}
import type { DeviceTestInstallResult } from '../../profiles/hmos-app/harness/providers/device-test-install';
import type { HylyreReadyResult, HylyreRunResult } from '../../profiles/hmos-app/harness/providers/device-test-run';
import type {
  HylyreEvidenceCapability,
  HylyreEvidenceGateResult,
  HylyreTrace,
} from '../../profiles/hmos-app/harness/providers/device-test-run';
import {
  collectDeviceTestTimings,
  writeDeviceTestTimingJson,
  type DeviceTestTimingDocument,
} from '../../profiles/hmos-app/harness/device-test-timings';
import {
  acceptanceYamlPath,
  buildAcceptanceIdPriorityMap,
  collectDeviceScopeP0P1,
  isDeviceUtLayer,
} from './utils/acceptance-layering';
import { runAcceptanceYamlStructureChecks, ACCEPTANCE_ID_PATTERN } from './utils/check-acceptance';
import { checkUpstreamVerdictGate, readUpstreamPhaseView } from './utils/upstream-verdict-gate';
import { countBlockingDebt, loadVisualDebtEx } from './utils/visual-debt';
import {
  formatRootPollutionWarnDetails,
  loadTestingRootPollutionMeta,
} from './utils/hylyre-root-pollution-warn';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import {
  loadReviewClosureAttestation,
  reconcileSourceTreeAgainstAttestation,
} from './utils/closure-attestation';
import { buildBehaviorSwitchCheckResult } from './utils/behavior-switch-scan';
import { isPhaseDisabledByProfile } from '../profile-loader';
import {
  CAPTURE_NOT_RUN_ELIGIBILITY,
  captureVisualDiff,
  loadGoldenContractFromEnv,
  type VisualDiffScreenshotFn,
  type VisualDiffNavExecutorFn,
  type VisualDiffLayoutDumpFn,
} from '../../profiles/hmos-app/harness/visual-diff-capture';
import { computeHapBuildFingerprint, computeHapSha256Full } from '../../profiles/hmos-app/harness/build-fingerprint';
import { buildHylyreVisualDiffScreenshotFn, buildHylyreNavExecutorFn, buildHylyreLayoutDumpFn, readDeviceTestRunHylyreNavOpts } from '../../profiles/hmos-app/harness/visual-diff-hylyre-screenshot';
import { parseTestCaseFlowBlock, triageCascade, validateTestCaseFlow } from './utils/test-case-flow';
import { normalizeDeviceTestCases } from './utils/device-test-case-kernel';
import {
  loadVisualDiffNavConfig,
  loadVisualDiffNavConfigV2,
  resolveIdentityForTargets,
  toLegacyNavConfig,
  validateNavConfig,
  validateNavConfigV2,
} from '../../profiles/hmos-app/harness/visual-diff-nav';
import { collectGoldenPositiveTargetIds, collectP0VisualTargetIds, resolveGoldenCaptureTargets } from '../../profiles/hmos-app/harness/visual-diff-targets';
import { resolveHylyreRuntimeWorkDir } from '../../profiles/hmos-app/harness/hylyre-spawn';
import { parseUiChangeFromSpecMarkdown, loadUiSpecFile, uiSpecAbsPath } from './utils/ui-spec-shared';
import {
  lintDerivedPlanSelectorContract,
  type AcceptanceActionBinding,
} from '../../profiles/hmos-app/harness/selector-contract';
import { loadAppInstallCandidateMeta } from '../../profiles/hmos-app/harness/hdc-runner';
import {
  EXECUTION_CHANNEL_DOMAIN,
  evaluateExecutionChannelDeclaration,
  registeredCapabilityIdsFromProfile,
  type ExecutionChannelDeclarationResult,
} from './utils/execution-channel';
import { requireV1ForGate } from './utils/hylyre-result-protocol';
import { checkFactsArtifact } from './utils/context-facts';
import {
  evaluateHylyreRunOutcome,
  parseReportConclusionVerdict,
  parseReportExecutionResults,
  reconcileReportWithDeviceTestTiming,
  reconcileReportWithHylyreTrace,
  resolveAuthoritativeHylyreTracePath,
  evaluateUiEntryCoverage,
  buildEntryUiPriorityMap,
} from './utils/testing-trace-gates';
import {
  evaluateP0CoverageIntegrity,
  evaluateP0SemanticCoverage,
  isP0DeviceInteractive,
  loadAcceptanceFlowsDoc,
  parsePlanTcEntries,
} from './utils/p0-semantic-gates';

import { evaluateSelectorRuntimeV1 } from './utils/hylyre-selector-gates-v1';
import { collectFailureRoutesV1 } from './utils/hylyre-failure-routing-v1';
import {
  bindChannelEvidence,
  loadVisualScreenVerdicts,
  PROVIDER_EVIDENCE_CONTRACT,
} from './utils/execution-channel-evidence';
import { evaluateFailureBoundary, resolveArtifact } from './utils/hylyre-artifact-resolution';
import {
  parseRecordedNativeBinding,
  validateNativeTraceArtifactBinding,
} from './utils/native-trace-binding';
import {
  evaluateHylyreNativeEvidenceGate,
  parseHylyreTrace,
  probeHylyreEvidenceCapability,
} from '../../profiles/hmos-app/harness/providers/device-test-run';
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
    return checkTestPlanMissingSkip(ctx, id);
  }
  return checkTestCasePriorityValuesBody(ctx, plan, id);
}

function checkTestPlanMissingSkip(ctx: CheckContext, id: string): CheckResult[] {
  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'MAJOR',
    status: 'SKIP',
    details: 'test-plan.md 不存在。',
  }];
}

/**
 * S6（visual-capability-truth P1-I）：test_case_flow machine block 与 Markdown TC 表
 * 一致性门禁——双 SSOT 漂移（缺/多/引用错/环）→ FAIL；无块 → WARN 建议声明
 * （级联归类与 BLOCKED_BY 语义依赖本块，未声明则失败读数退回"N 个独立失败"形态）。
 */
export function checkTestCaseFlowConsistency(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'test_case_flow_consistency';
  const description = 'test_case_flow 结构化 DAG 与用例表一致性（级联归类 SSOT）';
  if (!plan) {
    return [{ id, category: 'structure', description, severity: 'MAJOR', status: 'SKIP', details: 'test-plan.md 不存在。' }];
  }
  const parsed = parseTestCaseFlowBlock(plan);
  if (parsed.error) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: `test_case_flow 块不可解析：${parsed.error}`,
      suggestion: '按契约修正：test_case_flow 为 tc_id → { precondition: { kind: fresh_app|after, tc|tcs, reset } } 映射。',
    }];
  }
  const section = getSectionContent(plan, '测试用例');
  const tables = section ? extractTables(section) : [];
  const mdIds = tables.length > 0
    ? getColumnValues(tables[0], '用例编号').map(v => v.trim()).filter(Boolean)
    : [];
  if (!parsed.flow) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'WARN',
      details:
        'test-plan.md 无顶层 test_case_flow YAML 块——单 session 状态链失败将读成 N 个独立缺陷' +
        '（20260718：TC-003 根故障级联成 7 FAIL）。建议声明每 TC 前置（fresh_app|after）。',
      suggestion: '在 test-plan.md 顶部加 ```yaml test_case_flow: { TC-001: { precondition: { kind: fresh_app, reset: restart } }, ... } ```。',
    }];
  }
  const errors = validateTestCaseFlow(parsed.flow, mdIds);
  if (errors.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: ['【test_case_flow ↔ 用例表漂移/引用非法】', ...errors.map(e => `  - ${e}`)].join('\n'),
      suggestion: '保持 machine block 与人审表完全一致（同增同删）；after 引用须存在且无环。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `test_case_flow ${Object.keys(parsed.flow).length} 条与用例表一致（引用/环校验通过）。`,
  }];
}

function checkTestCasePriorityValuesBody(ctx: CheckContext, plan: string, id: string): CheckResult[] {
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
  const requiredCols = [
    '用例编号" or "编号',
    '执行状态" or "结果" or "状态',
    '耗时" or "duration',
  ];
  const { hasAll, missing } = tableHasColumns(table, requiredCols);

  if (!hasAll) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `执行结果表格缺少列：${missing.join(', ')}`,
      suggestion: '表头至少需包含：用例编号、执行状态、耗时；耗时须回填最终 run 的 case duration。',
    }];
  }

  const malformedRows = table.rows
    .map((row, index) => ({ row, line: table.lineNumber + index + 2 }))
    .filter(item => item.row.length !== table.headers.length);
  if (malformedRows.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: malformedRows
        .slice(0, 10)
        .map(item => `执行结果表格第 ${item.line} 行列数=${item.row.length}，表头列数=${table.headers.length}`)
        .join('\n'),
      suggestion: '每条 TC 行必须与表头保持相同列数；缺失内容请填空单元格或 `—`，不要省略列。',
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

/**
 * t6（plan f3a8c6d2）：弱化类旗标的**披露与口径**门禁。
 *
 * 事故（bc-openCard）：`device-test-run.meta.json` 的真实命令含 `--skip-assert-expected`
 * （goal 路径恒开），于是 trace.outcome=success 只说明动作链未报错——自然语言预期、
 * 性能、视觉断言全部没跑。而 test-report.md 把 16 个用例写成"通过"、通过率 100% 达标，
 * 与同期 summary.json 的 verdict=FAIL 并存，且通篇未提这个旗标。
 *
 * 两条规则（复用既有 meta + 报告正文，零新协议、零新状态）：
 *   ① 命令含弱化旗标 → 报告必须披露（否则读者无从知道"通过"是打了折的）；
 *   ② 披露之余，不得把"执行完成"直接说成"验收通过"——须明确区分二者。
 * 命令里没有弱化旗标，或读不到 meta（老报告/非设备路径）→ 不干预，返回 null。
 */
/**
 * 从「通过率统计」章节取**总体**通过率百分比。只认与"总/总计/合计/overall"同处一行的
 * 数值——分优先级的 `P0 通过率 100%` 在总体 80% 时是合法的，不能拿它当总体高报。
 * 段落/表格两种写法都走同一条按行扫描（表格行 `| 总计 | 16 | 16 | 100% |` 同样命中）。
 * 取不到 → 返回 null（不比较，不误伤没写总体的老报告）。
 */
function extractDeclaredOverallRate(section: string | null): number | null {
  if (!section) return null;
  for (const line of section.split(/\r?\n/)) {
    const kw = /总计|总体|合计|overall/i.exec(line);
    if (!kw) continue;
    // 取关键词**之后**的第一个百分比：单行写法 `P0 通过率 100%，P1 0%，总计 50%` 里
    // 行首那个 100% 是分优先级值，拿它当总体会误判高报（曾写成"行内第一个"，是 bug）。
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(line.slice(kw.index));
    if (m) return Number(m[1]);
  }
  return null;
}

export function checkSkipFlagDisclosure(ctx: CheckContext, report: string): string[] {
  let command = '';
  let traceSummary: {
    cases_count?: unknown;
    failed_count?: unknown;
    blocked_count?: unknown;
    skipped_count?: unknown;
  } | null = null;
  try {
    const metaPath = path.join(
      featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot),
      'device-test-run.meta.json',
    );
    if (!fs.existsSync(metaPath)) return [];
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      command?: unknown;
      trace_summary?: {
        cases_count?: unknown;
        failed_count?: unknown;
        blocked_count?: unknown;
        skipped_count?: unknown;
      };
    };
    command = typeof meta.command === 'string' ? meta.command : '';
    traceSummary = meta.trace_summary ?? null;
  } catch {
    return []; // meta 不可读＝无从判定，不误报
  }
  const WEAKENING_FLAGS = ['--skip-assert-expected'];
  const used = WEAKENING_FLAGS.filter(f => command.includes(f));

  const issues: string[] = [];

  // ③ 分子对账（与是否带旗标无关），三条机器证据各查一次：用例表自身 / trace / summary。
  let reportedPass = 0;
  // 用例表口径复用**既有唯一解析器** `parseReportExecutionResults`（report↔trace 对账消费
  // 的同一个），不另写一套表格解析——两套解析器迟早对同一张表给出两种读数。
  const execStatuses = parseReportExecutionResults(report);
  const reportedTotal = execStatuses.size;
  reportedPass = [...execStatuses.values()].filter(s => s.trim() === '通过').length;

  // 声明通过率 vs 执行结果表自算通过率。**高报即 FAIL**——否则"全部跳过却写 100%"照样过门
  // （我第一版的"正例"正是这个形态，被 review 抓出）。只在两侧都取得到数时比较，
  // 允许 0.5pt 四舍五入余量；表缺席/无数据行 → 不比较，不误伤老报告。
  const declaredOverall = extractDeclaredOverallRate(getSectionContent(report, '通过率'));
  if (declaredOverall !== null && reportedTotal > 0) {
    const actualRate = (reportedPass / reportedTotal) * 100;
    if (declaredOverall > actualRate + 0.5) {
      issues.push(
        `声称总体通过率 ${declaredOverall}%，但执行结果表实为 ${reportedPass}/${reportedTotal}` +
        `（${actualRate.toFixed(1)}%）——通过率必须由用例表算出，不得高报。`,
      );
    }
  }
  const casesCount = typeof traceSummary?.cases_count === 'number' ? traceSummary.cases_count : null;
  const failedCount = typeof traceSummary?.failed_count === 'number' ? traceSummary.failed_count : null;
  const blockedCount = typeof traceSummary?.blocked_count === 'number' ? traceSummary.blocked_count : 0;
  const skippedCount = typeof traceSummary?.skipped_count === 'number' ? traceSummary.skipped_count : 0;
  if (casesCount !== null && failedCount !== null) {
    const tracePassCeiling = Math.max(0, casesCount - failedCount - blockedCount - skippedCount);
    if (reportedPass > tracePassCeiling) {
      issues.push(
        `报告自称"通过" ${reportedPass} 条，超过 trace 证明可通过的 ${tracePassCeiling} 条` +
        `（cases=${casesCount}、failed=${failedCount}、blocked=${blockedCount}、skipped=${skippedCount}）` +
        '——失败、阻塞与跳过均不得计入通过分子。',
      );
    }
  }

  // summary 腿（事故正形态）：`testing/reports/summary.json` verdict=FAIL 与报告"16/16 通过、
  // 通过率 100%"**并存**。读既有 `readUpstreamPhaseView`（summary.json 唯一读入口，自带
  // verdict/blockers/quality_axes/新鲜度），不自己解析 summary。
  // **只在 freshness==='fresh' 时对账**：证据链未漂移 ⇒ 那份负面机器裁决就是当下事实；
  // agent 真去修了 → 证据变 → stale → 本条自动让路，不误伤"修完重跑"的正常流程。
  const machine = readUpstreamPhaseView(ctx.projectRoot, ctx.feature, ctx.phase);
  const claimsCleanSweep = (reportedTotal > 0 && reportedPass === reportedTotal) || declaredOverall === 100;
  if (
    machine.summaryExists && machine.verdictReadable && machine.freshness === 'fresh' &&
    machine.verdict !== 'PASS' && claimsCleanSweep
  ) {
    issues.push(
      `报告声称全部通过（${reportedPass}/${reportedTotal}${declaredOverall === 100 ? '、通过率 100%' : ''}），` +
      `但同阶段机器裁决 summary.json verdict=${machine.verdict} 且证据链未漂移（fresh）` +
      `${machine.blockerIds.length > 0 ? `，blockers=[${machine.blockerIds.slice(0, 5).join(', ')}]` : ''}` +
      `${machine.axisNotes?.length ? `，未过轴=[${machine.axisNotes.join(', ')}]` : ''}` +
      '——报告结论不得与机器裁决相反（事故正形态：16/16"通过"与 verdict=FAIL 并存）。',
    );
  }

  if (used.length === 0) return issues;

  // ① 披露：命令带弱化旗标，报告必须写明
  if (!used.every(f => report.includes(f))) {
    issues.push(
      `本轮真机执行命令带弱化旗标 ${used.join('、')}，但 test-report.md 未披露——` +
      '读者会把"通过"误读为完整验收（自然语言预期/性能/视觉断言实际未跑）。',
    );
  }
  // ② 口径：带旗标时"执行完成"不得写成"验收通过"，也不得计入验收 PASS 分子。
  //    仅靠一句免责声明不作数——**表里仍写"通过"就是没改口径**（review 抓出的假通过口）。
  const distinguishes = /执行完成|动作链|未验证自然语言预期|未断言预期|非验收通过/.test(report);
  if (!distinguishes) {
    issues.push(
      '报告未区分"动作链执行完成"与"验收通过"：带该旗标时 trace.outcome=success 只证明步骤没报错，' +
      '不得据此把用例计入验收通过分子。',
    );
  }
  // c7e4a2d9 t3：原位替换「reportedPass>0 即 FAIL」——该断言要求报告表里不得出现 trace 的
  // 合法状态「通过」，与 report_trace_reconciliation 的逐条投影互斥（goal 路径恒开旗标时
  // 两条门禁不可同时满足）。改为复用既有结论解析器 parseReportConclusionVerdict 的直接规则：
  // 弱化旗标在场且报告结论声明「达标」即 FAIL——动作链通过不能被洗成完整验收通过；
  // 不依赖 fresh 负面 summary 间接兜底，也不破坏 trace 状态表的忠实投影。
  if (parseReportConclusionVerdict(report) === '达标') {
    issues.push(
      `命令含弱化旗标 ${used.join('、')} 且报告结论声明「达标」——trace 的「通过」只表示动作链` +
      '执行完成，自然语言预期/性能/视觉断言未跑；结论须为「不达标」/「有条件达标」并维持既有披露。',
    );
  }
  return issues;
}

export function checkPassRateCalculated(ctx: CheckContext, report: string | null): CheckResult[] {
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

  // t6（plan f3a8c6d2）：**动作链执行成功 ≠ 验收通过**。
  // 事故（bc-openCard）：真实执行命令带 `--skip-assert-expected`（goal 路径下恒开，
  // 见本文件 device_test.run 调用点），trace.outcome=success 只证明"动作链没报错"，
  // 不证明自然语言预期/性能/视觉达标；而 test-report.md 把 16 个用例全写成"通过"、
  // 通过率 100%，与同期机器裁决 verdict=FAIL 并存，且通篇未披露该旗标。
  // 判据取既有产物（device-test-run.meta.json 的真实命令 + trace_summary + 报告正文），零新协议。
  // **只做追加约束**：不早退、不短路原有 P0/P1/总体通过率检查（早退会让"加一句免责声明就过门"，
  // 正是本条要堵的假通过）。
  const disclosureIssues = checkSkipFlagDisclosure(ctx, report);

  const issues: string[] = [];
  // 既有门禁条件保持原样（overall 仅进文案、不参与判定），本 todo 只追加约束、不改既有语义
  if (!(hasPerPriority && hasPercentage)) {
    if (!hasPerPriority) issues.push('缺少分优先级（P0/P1）的通过率');
    if (!hasPercentage) issues.push('缺少通过率百分比数值');
    if (!hasOverall) issues.push('缺少总体通过率');
  }
  issues.push(...disclosureIssues);

  if (issues.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '通过率统计章节包含各优先级通过率数值，且分子与机器证据/执行口径一致。',
    }];
  }

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

/**
 * blind-visual-hardening d1 切片一（与 check-review negative_verdict_closure 同语义）：
 * report_conclusion_with_verdict 只要有可机读裁决词就 PASS——「不达标」同样放行。
 * 本 check：测试结论=不达标 → BLOCKER FAIL（产品负面裁决阻断 phase 闭环）。
 * 不读 verifier/trace——裁决 vs trace 一致性归 reconcileReportWithHylyreTrace。
 */
export function checkNegativeTestingVerdictClosure(report: string | null): CheckResult[] {
  const id = 'negative_verdict_closure';
  const description = '负面产品裁决闭环门禁（测试结论=不达标 → 阻断 phase 闭环，修复重跑后方可推进）';
  if (!report) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'SKIP',
      details: 'test-report.md 不存在（报告存在性由 report_conclusion_with_verdict/run 状态门禁负责）。',
    }];
  }
  const section = getSectionContent(report, '结论') ?? getSectionContent(report, '测试结论') ?? '';
  const { verdict } = extractDeclaredVerdict(section, ['有条件达标', '不达标', '达标']);
  if (verdict !== '不达标') {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `测试结论=${verdict ?? '未声明'}，非负面裁决，本门禁不适用（缺声明行由 report_conclusion_with_verdict 拦）。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details:
      '测试结论=「不达标」——产品负面裁决不得闭环推进。报告如实登记不达标是 report_validity 层面的合规，' +
      '但产品裁决为负时 phase 不得以 PASS 收口（对齐 review 侧 negative_verdict_closure 语义）。',
    suggestion: '修复失败用例/缺陷后重跑 device 测试与本 harness，结论更新为非「不达标」后方可闭环。',
    failure_kind: 'negative_testing_verdict',
    blocking_class: 'product_verdict',
  }];
}

/**
 * blind-visual-hardening d5（P0-D③）：视觉债务披露门禁——存在未清偿（open/accepted）视觉债务时，
 * test-report 结论章节必须引用视觉债务（字样+计数），防「达标可发布」裸奔（bc-openCard 二轮：
 * 债务全埋 WARN/soft_advisories，结论零 caveat）。结构化轴以 summary.quality_axes 为 SSOT，
 * 报告只需如实披露引用；禁止「达标（带视觉债务）」复合措辞由模板层约束，本 check 管"必须提"。
 */
export function checkVisualDebtDisclosure(ctx: CheckContext, report: string | null): CheckResult[] {
  const id = 'visual_debt_disclosure';
  const description = '视觉债务披露门禁（存在未清偿债务时结论必须引用视觉债务清单）';
  // cursor 深度 review P3：披露判定是消费面而非纯展示——deprecated loadVisualDebt 会把
  // 损坏账本归 null（open+accepted=0 → PASS），绕过单调 ledger 的 fail-closed；改三态加载。
  const debtLoad = loadVisualDebtEx(ctx.projectRoot, ctx.feature);
  if (debtLoad.state === 'invalid') {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details:
        `visual-debt.json 损坏（${debtLoad.reason}）——债务账本不可信时不得视同"无债务"放行披露门禁（fail-closed）。`,
      suggestion:
        '不要覆盖原文件（保留取证现场）；核查损坏原因（进程中断/手改）后修复账本 JSON 再重跑本 harness。',
      failure_kind: 'visual_debt_ledger_corrupt',
      blocking_class: 'product_verdict',
    }];
  }
  const debt = debtLoad.doc;
  const { open, accepted } = countBlockingDebt(debt);
  if (open + accepted === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: '无未清偿视觉债务，无披露义务。',
    }];
  }
  if (!report) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'SKIP',
      details: `存在视觉债务（open=${open}, accepted=${accepted}）但 test-report.md 不存在（报告存在性归其他门禁）。`,
    }];
  }
  const section = getSectionContent(report, '结论') ?? getSectionContent(report, '测试结论') ?? '';
  // cursor 实施 review P3 加固：须"视觉债务"字样 + 计数数字同段出现（裸四字塞入不满足披露义务）
  if (/视觉债务/.test(section) && /视觉债务[^\n]*\d|\d[^\n]*视觉债务/.test(section)) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'PASS',
      details: `结论已披露视觉债务（open=${open}, accepted=${accepted}；SSOT=visual-debt.json / summary.quality_axes）。`,
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `存在未清偿视觉债务（open=${open}, accepted=${accepted}）但 test-report 结论章节未引用「视觉债务」——` +
      '结论不得对视觉未验真保持沉默（bc-openCard 二轮「达标可发布」裸奔形态）。',
    suggestion:
      '在结论章节如实引用：视觉债务清单（doc/features/<feature>/visual-debt.md）与条目计数；' +
      '产品裁决以 summary.quality_axes 为准（visual=UNVERIFIED 时 completion=FUNCTIONALLY_COMPLETE_VISUAL_PENDING，' +
      'release_readiness=BLOCKED）——功能达标与视觉验真是两根轴，不写复合措辞。',
    failure_kind: 'visual_debt_undisclosed',
    blocking_class: 'product_verdict',
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
      // e9d4b7a3 t2：词法 SSOT（ACCEPTANCE_ID_PATTERN）——不再本地复写第二套 ^(AC|BD)- 规则
      const refs = acRefs.split(/[,，、\s]+/).filter(r => ACCEPTANCE_ID_PATTERN.test(r));
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

function checkDeviceCaseNormalization(ctx: CheckContext): CheckResult[] {
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) {
    return [{
      id: 'device_case_contract',
      category: 'traceability',
      description: 'Device testing cases 统一归一契约',
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'phase 轨缺少 acceptance.yaml，无法归一 cases。',
    }];
  }
  const normalized = normalizeDeviceTestCases({ mode: 'acceptance', acceptance });
  if (normalized.issues.length > 0) {
    return [{
      id: 'device_case_contract',
      category: 'traceability',
      description: 'Device testing cases 统一归一契约',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: normalized.issues.join('\n'),
      suggestion: '按 acceptance.yaml 的 criteria/expected/boundaries 修正设备用例结构后重跑 testing harness；adhoc 输入须使用同一 normalization kernel。',
    }];
  }
  return [{
    id: 'device_case_contract',
    category: 'traceability',
    description: 'Device testing cases 统一归一契约',
    severity: 'BLOCKER',
    status: 'PASS',
    details: `mode=acceptance depth=${normalized.depth} cases=${normalized.cases.length}`,
  }];
}

export function checkAcceptanceToTestCase(ctx: CheckContext, plan: string | null): CheckResult[] {
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

  // c7e4a2d9 t1：冻结 acceptance P0 优先级锚——device/both 的每个 P0 AC 必须被至少一条
  // priority=P0 的 TC 引用（复用既有 parsePlanTcEntries，不另写优先级/AC 解析器）。
  // 锚防「TC 从 P0 降为 P2 后退出 p0_coverage_integrity 分母」的逃逸：降档后引用还在
  // （普通覆盖率仍命中）但 P0 优先级对齐缺失 → 本检查原地 BLOCKER FAIL，owner=testing。
  const p0TcEntries = parsePlanTcEntries(plan).filter(e => e.priority.trim().toUpperCase() === 'P0');
  const p0PriorityGaps = p0Device.filter(c => {
    const normalized = c.id.toUpperCase().replace(/\s/g, '');
    return !p0TcEntries.some(tc =>
      tc.acRefs.some(r => r.toUpperCase().replace(/\s/g, '') === normalized),
    );
  });

  const details: string[] = [];
  details.push(`追溯分母：ut_layer∈{device,both} 的 P0/P1（不含 unit 层 AC）`);
  details.push(`P0 AC 覆盖率: ${p0Covered}/${p0Device.length}`);
  details.push(`P1 AC 覆盖率: ${p1Covered}/${p1Device.length}`);
  details.push(`BD 覆盖率: ${deviceBoundaries.length - uncoveredBD.length}/${deviceBoundaries.length}`);
  details.push(`P0 优先级对齐覆盖率: ${p0Device.length - p0PriorityGaps.length}/${p0Device.length}（每个 device/both P0 AC 须被至少一条 priority=P0 的 TC 引用；TC P0→P2 降档即缺口）`);

  if (uncovered.length > 0) {
    details.push('未被测试用例覆盖的 P0/P1 AC:');
    for (const c of uncovered.slice(0, 10)) {
      details.push(`  - ${c.id} (${c.priority}): ${c.description}`);
    }
    if (uncovered.length > 10) {
      details.push(`  ... 还有 ${uncovered.length - 10} 条`);
    }
  }
  if (p0PriorityGaps.length > 0) {
    details.push('P0 AC 无任何 priority=P0 的 TC 引用（仅被 P1/P2/P3 TC 引用或无引用）:');
    for (const c of p0PriorityGaps.slice(0, 10)) {
      details.push(`  - ${c.id}: ${c.description}`);
    }
    if (p0PriorityGaps.length > 10) {
      details.push(`  ... 还有 ${p0PriorityGaps.length - 10} 条`);
    }
  }

  if (uncovered.length === 0 && p0PriorityGaps.length === 0) {
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
    suggestion:
      (uncovered.length > 0
        ? `请为未覆盖的 ${uncovered.length} 个 device 层 P0/P1 AC 补充测试用例（见 acceptance.yaml device_focus）。`
        : '') +
      (p0PriorityGaps.length > 0
        ? `请为 ${p0PriorityGaps.length} 个 device/both P0 AC 提供至少一条 priority=P0 的测试用例引用` +
          '（TC 不得以 P0→P2 降档退出 P0 全分母）。'
        : ''),
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
  // d9e4b7c1 T2：evidence 写入门槛输入——installPassed 把"实装成功"与"复用成功"合并，
  // 证不了 install_executed；evidence 需要三个未合并的事实（既有 installPassed 消费不动）。
  /** 本轮真实执行了 hdc install（reuse/skip 为 false） */
  installExecuted: boolean;
  /** 安装命令成功（含 reuse 的 ok 不算——只在 installExecuted 时有意义） */
  installOk: boolean;
  /** 装机前计算的完整 64 hex HAP 摘要（provider 回传） */
  hapSha256Full: string | null;
  /** Native/legacy evidence decision for the same run; in-memory only. */
  hylyreEvidenceGate?: HylyreEvidenceGateResult;
  /** Existing run/evidence identity for native trace/plan binding. */
  nativeArtifactBinding?: DeviceTestArtifactBinding;
  /** Pre-run provider capability; distinguishes post-run bad trace from provider absence. */
  hylyreEvidenceCapability?: HylyreEvidenceCapability;
}

type ReadJsonRecordResult = {
  exists: boolean;
  value: Record<string, unknown> | null;
  error?: string;
};

function readJsonRecord(absPath: string): ReadJsonRecordResult {
  if (!fs.existsSync(absPath)) return { exists: false, value: null };
  try {
    const value = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { exists: true, value: null, error: 'JSON 根节点不是对象' };
    }
    return { exists: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { exists: true, value: null, error: (error as Error).message };
  }
}

function recordedPathForProject(projectRoot: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
}

function gateWithNativeBindingFailure(
  gate: HylyreEvidenceGateResult,
  binding: { ok: boolean; reasons: string[] },
): HylyreEvidenceGateResult {
  if (binding.ok) return gate;
  return {
    ...gate,
    mode: 'unsupported',
    native: false,
    legacy: false,
    reasons: [...new Set([...gate.reasons, ...binding.reasons])],
  };
}

function nativeCapabilityFromReadyMeta(
  ready: Record<string, unknown> | null,
  manifestVersion: string | null,
): HylyreEvidenceCapability {
  const installed = ready && [
    'installed_version', 'installed', 'hylyreVersion', 'hylyre_version',
  ].map(key => ready[key]).find(value => typeof value === 'string' && value.trim());
  const installedVersion = typeof installed === 'string' ? installed : '';
  const manifest = ready && [
    'manifest_version', 'manifest', 'manifestVersion',
  ].map(key => ready[key]).find(value => typeof value === 'string' && value.trim());
  const readyManifestVersion = typeof manifest === 'string' ? manifest : '';
  const version = manifestVersion?.trim() || readyManifestVersion;
  const readyOk = ready?.ok === true && ready?.doctorOk === true &&
    (ready?.version_consistent === true || ready?.versionConsistent === true);
  // The complete trace gate remains authoritative. This value only says that
  // the ready metadata advertised a native-capable provider, so a malformed
  // post-run trace is a testing failure rather than a capability defer.
  const advertised = readyOk && probeHylyreEvidenceCapability({
    hylyreVersion: installedVersion,
    manifestVersion: version,
  }).native;
  return {
    mode: advertised ? 'native' : 'unsupported',
    native: advertised,
    legacy: false,
    providerId: 'hylyre',
    providerVersion: installedVersion || version,
    reason: advertised
      ? `ready metadata advertises native Hylyre@${version}`
      : 'ready metadata 未证明 native provider capability',
  };
}

function evidenceGateFailureProjection(
  gate: HylyreEvidenceGateResult,
  holder: DeviceTestPipelineHolder,
): { failure_kind?: string; blocking_class?: string } {
  // Once preflight has proved that the selected provider is native-capable,
  // malformed post-run trace data is a testing evidence failure, not a new
  // capability gap. The preflight fact is only a classifier; the native gate
  // still decides whether the trace can be consumed.
  if (holder.hylyreEvidenceCapability?.native) return {};
  if (gate.mode === 'legacy') return { failure_kind: 'legacy_assertion_evidence_untrusted' };
  return { failure_kind: 'capability_missing', blocking_class: 'externalBlocked' };
}

/**
 * T7：report-only 只读既有 device-test 产物，构造与正常流水线同形的 pipeline facts。
 * 这里禁止调用 provider；下游 report/trace/P0/static checks 仍沿既有入口完整执行。
 */
function collectReportOnlyDerivedPlanStaticIssues(
  ctx: CheckContext,
  plan: string | null,
): { issues: string[]; selectorWarnings: ReturnType<typeof lintDerivedPlanSelectorContract> } {
  const issues: string[] = [];
  const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
  const topResolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
  const topPath = topResolved.actualPath;
  const topRaw = plan ?? (fs.existsSync(topPath) ? fs.readFileSync(topPath, 'utf-8') : '');
  const topIds = extractTcIdsFromPlanTable(topRaw);
  const topStat = fs.existsSync(topPath) ? fs.statSync(topPath) : null;
  const pick = selectBestNonPlaceholderDerivedPlan(reportsDir);

  if (!plan) issues.push('test-plan.md 不存在');
  if (!pick.selected) {
    issues.push('未找到有效的 authoritative 派生 Hylyre 计划');
    return { issues, selectorWarnings: [] };
  }

  const derivedPath = pick.selected.hylyrePath;
  const derivedIds = extractTcIdsFromPlanTable(pick.selected.content);
  const explicitSkips = loadExplicitSkipTcIds(derivedPath, pick.selected.content);
  const channelDecl = loadExecutionChannelDeclaration(ctx, topRaw);
  // plan b3d7e5a1（codex P1）：按 channels_resolved 而非 ok 选口径——registry 未登记的 provider id 是声明
  // BLOCKER，但通道集合已解析，report-only 仍须按 hylyre 集合精确对账，不得退回 legacy 全 TC 虚报缺失。
  if (channelDecl.channels_resolved) {
    // 通道精确对账：派生集合必须**恰好等于** channel=hylyre 集合，explicit skip 不减除。
    const coverage = evaluateChannelDerivedCoverage({
      hylyreTcIds: channelDecl.hylyre_tc_ids,
      derivedTcIds: derivedIds,
      legacyExplicitSkipTcIds: explicitSkips,
    });
    if (coverage.extra.length > 0) {
      issues.push(`派生计划包含非 channel=hylyre 的 TC：${coverage.extra.join(', ')}（派生器无权改写通道）`);
    }
    if (coverage.missing.length > 0) {
      issues.push(
        `派生计划缺少 channel=hylyre 的 TC：${coverage.missing.join(', ')}` +
        (coverage.laundered_skips.length > 0
          ? `（其中 ${coverage.laundered_skips.join(', ')} 被 explicit skip 洗掉——skip 不能减除缺口）`
          : ''),
      );
    }
    if (explicitSkips.length > 0) {
      issues.push(`正式派生计划不得再产出 explicit_skip_tc_ids：${explicitSkips.join(', ')}`);
    }
  } else {
    const coverage = evaluateDerivedCoverage({
      topTcIds: topIds,
      derivedTcIds: derivedIds,
      explicitSkipTcIds: explicitSkips,
    });
    if (coverage.extra.length > 0) {
      issues.push(`派生计划包含顶层未声明的 TC：${coverage.extra.join(', ')}`);
    }
    if (coverage.missing.length > 0) {
      issues.push(`派生计划缺少顶层 TC：${coverage.missing.join(', ')}`);
    }
  }
  const derivedStat = fs.statSync(derivedPath);
  if (topStat && derivedStat.mtimeMs < topStat.mtimeMs) {
    issues.push('派生计划早于顶层 test-plan.md（stale）');
  }

  const staticPlanGates = collectDeviceTestStaticPlanGates(ctx, pick.selected.content, topRaw);
  const stepBlockers = staticPlanGates.stepLint.violations.filter(v => v.severity === 'BLOCKER');
  if (stepBlockers.length > 0) {
    issues.push(...stepBlockers.map(v => `[${v.rule_id}] ${v.tc_id}: ${v.message}`));
  }
  const selectorBlockers = staticPlanGates.selectorWarnings.filter(v => v.severity === 'BLOCKER');
  if (selectorBlockers.length > 0) {
    issues.push(...selectorBlockers.map(v => `[${v.rule_id}] ${v.tc_id}: ${v.message}`));
  }
  if (!staticPlanGates.navLint.ok) {
    issues.push(...staticPlanGates.navLint.violations.map(v => `[${v.rule_id}] ${v.tc_id}: ${v.message}`));
  }
  return { issues, selectorWarnings: staticPlanGates.selectorWarnings };
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readTimestamp(
  record: Record<string, unknown> | null,
  key: string,
  label: string,
  issues: string[],
): { raw: string | null; ms: number | null } {
  const raw = record && typeof record[key] === 'string' ? record[key]!.trim() : '';
  if (!raw) {
    issues.push(`${label} 缺少 ${key}`);
    return { raw: null, ms: null };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    issues.push(`${label}.${key} 不是有效时间戳：${raw}`);
    return { raw, ms: null };
  }
  return { raw, ms };
}

function compareRecordedNumber(
  issues: string[],
  label: string,
  actual: unknown,
  expected: number | null,
): void {
  const n = finiteNonNegative(actual);
  if (n === null || expected === null || Math.abs(n - expected) > 1) {
    issues.push(`${label}=${String(actual)}，最终来源=${expected === null ? '(missing)' : `${expected}ms`}`);
  }
}

function compareTimingPipelineNumber(
  issues: string[],
  pipeline: Record<string, unknown>,
  key: string,
  expected: number | null,
): void {
  if (!hasOwn(pipeline, key)) {
    issues.push(`device-test-timing.json.pipeline 缺少字段：${key}`);
    return;
  }
  const actual = pipeline[key];
  if (expected === null) {
    if (actual !== null) issues.push(`device-test-timing.json.pipeline.${key} 应为 null，实际=${String(actual)}`);
    return;
  }
  compareRecordedNumber(issues, `device-test-timing.json.pipeline.${key}`, actual, expected);
}

function compareTimingPipelineOptionalNumber(
  issues: string[],
  pipeline: Record<string, unknown>,
  key: string,
): void {
  if (!hasOwn(pipeline, key)) {
    issues.push(`device-test-timing.json.pipeline 缺少字段：${key}`);
    return;
  }
  const actual = pipeline[key];
  if (actual !== null && finiteNonNegative(actual) === null) {
    issues.push(`device-test-timing.json.pipeline.${key} 不是非负数或 null：${String(actual)}`);
  }
}

function comparePathPair(
  issues: string[],
  projectRoot: string,
  label: string,
  left: unknown,
  right: unknown,
): { left: string | null; right: string | null } {
  const leftPath = recordedPathForProject(projectRoot, left);
  const rightPath = recordedPathForProject(projectRoot, right);
  if (!leftPath || !rightPath) {
    issues.push(`${label} 缺少有效路径`);
  } else if (leftPath !== rightPath) {
    issues.push(`${label} 不一致：${leftPath} != ${rightPath}`);
  }
  return { left: leftPath, right: rightPath };
}

function checkReportReconcileOnlyPipeline(
  ctx: CheckContext,
  holder: DeviceTestPipelineHolder,
  plan: string | null,
  report: string | null,
): CheckResult[] {
  const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
  const buildPath = path.join(reportsDir, 'device-test-build.result.json');
  const buildToolPath = path.join(reportsDir, 'hvigor-app-build.meta.json');
  const installPath = path.join(reportsDir, 'device-test-install.meta.json');
  const runPath = path.join(reportsDir, 'device-test-run.meta.json');
  const timingPath = path.join(reportsDir, 'device-test-timing.json');
  const build = readJsonRecord(buildPath);
  const buildTool = readJsonRecord(buildToolPath);
  const install = readJsonRecord(installPath);
  const run = readJsonRecord(runPath);
  const timing = readJsonRecord(timingPath);
  const tracePath = resolveAuthoritativeHylyreTracePath(reportsDir);
  const trace = tracePath ? parseHylyreTrace(tracePath) : null;
  const issues: string[] = [];

  const readyRecord = readJsonRecord(path.join(reportsDir, 'hylyre-ready.meta.json'));
  const hylyreCfg = resolveHylyreToolConfig(ctx.projectRoot);
  const manifestRecord = readJsonRecord(
    path.join(ctx.projectRoot, hylyreCfg.vendor_dir, 'release.manifest.json'),
  );
  const releaseManifestVersion =
    manifestRecord.value && typeof manifestRecord.value.hylyre_version === 'string'
      ? manifestRecord.value.hylyre_version
      : null;
  const acceptance = loadAcceptanceFlowsDoc(ctx.projectRoot, ctx.feature);
  const nativeEvidenceApplicable = Boolean(acceptance?.criteria.some(isP0DeviceInteractive));
  const evidenceGate = nativeEvidenceApplicable
    ? evaluateHylyreNativeEvidenceGate({
        trace,
        readyMeta: readyRecord.value,
        manifestVersion: releaseManifestVersion,
      })
    : null;
  let reconciledEvidenceGate = evidenceGate;
  if (nativeEvidenceApplicable) {
    holder.hylyreEvidenceCapability = nativeCapabilityFromReadyMeta(
      readyRecord.value,
      releaseManifestVersion,
    );
    const recordedBinding = parseRecordedNativeBinding(run.value?.artifact_binding);
    const bindingMissing = [
      'test_plan_path', 'test_plan_sha256', 'derived_plan_path',
      'derived_plan_sha256', 'trace_path', 'trace_sha256',
    ].filter(key => !recordedBinding?.[key as keyof DeviceTestArtifactBinding]);
    const topPlanPath = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md').actualPath;
    const derivedPlanPath = recordedBinding?.derived_plan_path
      ?? path.join(path.dirname(tracePath ?? reportsDir), 'test-plan.hylyre.md');
    const binding = validateNativeTraceArtifactBinding({
      trace,
      expectedFeature: ctx.feature,
      tracePath: tracePath ?? path.join(reportsDir, 'trace.json'),
      testPlanPath: topPlanPath,
      derivedPlanPath,
      expectedTestPlanPath: recordedBinding?.test_plan_path,
      expectedDerivedPlanPath: recordedBinding?.derived_plan_path,
      expectedTracePath: recordedBinding?.trace_path,
      expectedTestPlanSha256: recordedBinding?.test_plan_sha256,
      expectedDerivedPlanSha256: recordedBinding?.derived_plan_sha256,
      expectedTraceSha256: recordedBinding?.trace_sha256,
    });
    if (bindingMissing.length > 0) {
      binding.reasons.push(`device-test-run.meta.json 缺 native artifact_binding 字段：${bindingMissing.join(', ')}`);
      binding.ok = false;
    }
    if (binding.ok && binding.binding) holder.nativeArtifactBinding = binding.binding;
    if (!binding.ok) {
      issues.push(...binding.reasons.map(reason => `native artifact binding：${reason}`));
    }
    if (reconciledEvidenceGate && !binding.ok) {
      reconciledEvidenceGate = gateWithNativeBindingFailure(reconciledEvidenceGate, binding);
    }
  }
  if (reconciledEvidenceGate) holder.hylyreEvidenceGate = reconciledEvidenceGate;
  if (reconciledEvidenceGate && !reconciledEvidenceGate.native) {
    issues.push(...reconciledEvidenceGate.reasons.map(reason => `native evidence gate：${reason}`));
  }
  // inventory §一 G1：旧实现按 `schema === '0.3-p0'` 才跑 completeness，schema 一变这道
  // required gate 就静默消失。现在无条件调用——不是合法 v1 由 completeness 自己产 BLOCKER。
  if (trace) {
    const completeness = checkHylyreCaseExecutionCompleteness(
      ctx,
      trace,
      reconciledEvidenceGate,
      holder.nativeArtifactBinding?.derived_plan_path ?? null,
    );
    for (const result of completeness.filter(item => item.status === 'FAIL')) {
      issues.push(...(result.details ?? '').split('\n'));
    }
  }

  const buildSkipped = isCapabilitySkipped(ctx.resolvedProfile, 'device_test.build');
  const installSkipped = isCapabilitySkipped(ctx.resolvedProfile, 'device_test.install');
  const runSkipped = isCapabilitySkipped(ctx.resolvedProfile, 'device_test.run');
  const staticPlan = runSkipped
    ? { issues: [], selectorWarnings: [] as ReturnType<typeof lintDerivedPlanSelectorContract> }
    : collectReportOnlyDerivedPlanStaticIssues(ctx, plan);
  issues.push(...staticPlan.issues);

  const buildRecord = build.value;
  const installRecord = install.value;
  const runRecord = run.value;
  const buildHapPath = recordedPathForProject(ctx.projectRoot, buildRecord?.hapPath);
  const installHapPath = recordedPathForProject(ctx.projectRoot, installRecord?.hapPath);
  const buildValid = buildSkipped || Boolean(
    buildRecord &&
    typeof buildRecord.hapPath === 'string' &&
    buildRecord.hapPath.trim() &&
    typeof buildRecord.reused === 'boolean' &&
    buildRecord.hvigorExitCode === 0,
  );
  if (!buildValid) {
    issues.push(`缺失或无效的 ${path.basename(buildPath)}${build.error ? `（${build.error}）` : ''}`);
  }

  const installValid = installSkipped || Boolean(
    installRecord &&
    installRecord.ok === true &&
    typeof installRecord.hapPath === 'string' &&
    installRecord.hapPath.trim() &&
    typeof installRecord.reused === 'boolean',
  );
  if (!installValid) {
    issues.push(`缺失或无效的 ${path.basename(installPath)}${install.error ? `（${install.error}）` : ''}`);
  }

  const runMetaValid = runSkipped || Boolean(runRecord && runRecord.ok === true);
  if (!runMetaValid) {
    issues.push(`缺失或无效的 ${path.basename(runPath)}${run.error ? `（${run.error}）` : ''}`);
  }

  if (!plan) issues.push('test-plan.md 不存在');
  if (!report) issues.push('test-report.md 不存在');
  const traceValid = runSkipped || Boolean(tracePath && trace);
  if (!traceValid) issues.push('无法解析 authoritative hylyre/trace.json');

  let buildAt: { raw: string | null; ms: number | null } = { raw: null, ms: null };
  let installAt: { raw: string | null; ms: number | null } = { raw: null, ms: null };
  let runStartedAt: { raw: string | null; ms: number | null } = { raw: null, ms: null };
  let runEndedAt: { raw: string | null; ms: number | null } = { raw: null, ms: null };
  let ranAt: { raw: string | null; ms: number | null } = { raw: null, ms: null };
  let timingGeneratedAt: { raw: string | null; ms: number | null } = { raw: null, ms: null };

  if (!buildSkipped) buildAt = readTimestamp(buildRecord, 'timestamp', 'device-test-build.result.json', issues);
  if (!installSkipped) installAt = readTimestamp(installRecord, 'timestamp', 'device-test-install.meta.json', issues);
  if (!runSkipped) {
    runStartedAt = readTimestamp(runRecord, 'run_started_at', 'device-test-run.meta.json', issues);
    runEndedAt = readTimestamp(runRecord, 'run_ended_at', 'device-test-run.meta.json', issues);
    ranAt = readTimestamp(runRecord, 'ran_at', 'device-test-run.meta.json', issues);
  }

  if (!runSkipped && timing.value) {
    timingGeneratedAt = readTimestamp(timing.value, 'generated_at', 'device-test-timing.json', issues);
  }

  if (!buildSkipped && !installSkipped) {
    const paths = comparePathPair(issues, ctx.projectRoot, 'build/install hapPath', buildRecord?.hapPath, installRecord?.hapPath);
    if (paths.left && paths.right) {
      const buildFingerprint = computeHapBuildFingerprint(paths.left);
      const installFingerprint = computeHapBuildFingerprint(paths.right);
      if (!buildFingerprint || !installFingerprint) {
        issues.push('build/install hapPath 指向的 HAP 不存在或无法读取，无法形成内容指纹');
      } else if (buildFingerprint !== installFingerprint) {
        issues.push(`build/install HAP 内容指纹不一致：${buildFingerprint} != ${installFingerprint}`);
      }
      const installFingerprintRecorded = installRecord?.hapSha256;
      if (typeof installFingerprintRecorded !== 'string' || !installFingerprintRecorded.trim()) {
        issues.push('device-test-install.meta.json 缺少 hapSha256 指纹');
      } else if (installFingerprintRecorded.trim().toLowerCase() !== buildFingerprint?.toLowerCase()) {
        issues.push(`device-test-install.meta.json.hapSha256=${installFingerprintRecorded} 与 HAP 当前指纹不一致`);
      }
      const stat = (() => {
        try { return fs.statSync(paths.left!); } catch { return null; }
      })();
      if (!stat) {
        issues.push('build/install HAP 文件 stat 失败');
      } else {
        for (const [label, value] of [
          ['build.hapMtimeMs', buildRecord?.hapMtimeMs],
          ['install.hapMtimeMs', installRecord?.hapMtimeMs],
        ] as Array<[string, unknown]>) {
          if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value - stat.mtimeMs) > 1) {
            issues.push(`${label} 与 HAP 当前 mtime 不一致：${String(value)} != ${stat.mtimeMs}`);
          }
        }
        if (typeof installRecord?.hapSizeBytes !== 'number' || installRecord.hapSizeBytes !== stat.size) {
          issues.push(`install.hapSizeBytes 与 HAP 当前 size 不一致：${String(installRecord?.hapSizeBytes)} != ${stat.size}`);
        }
      }
    }
  }

  if (!buildSkipped && !installSkipped && buildAt.ms !== null && installAt.ms !== null && buildAt.ms > installAt.ms) {
    issues.push(`pipeline 时间顺序错误：build.timestamp=${buildAt.raw} 晚于 install.timestamp=${installAt.raw}`);
  }
  if (!runSkipped) {
    if (runStartedAt.ms !== null && runEndedAt.ms !== null && runStartedAt.ms > runEndedAt.ms) {
      issues.push(`run 时间顺序错误：run_started_at=${runStartedAt.raw} 晚于 run_ended_at=${runEndedAt.raw}`);
    }
    if (runEndedAt.ms !== null && ranAt.ms !== null && runEndedAt.ms !== ranAt.ms) {
      issues.push(`run 终点不一致：run_ended_at=${runEndedAt.raw}，ran_at=${ranAt.raw}`);
    }
  }
  if (!runSkipped && runEndedAt.ms !== null && timingGeneratedAt.ms !== null && runEndedAt.ms > timingGeneratedAt.ms) {
    issues.push(`timing.generated_at=${timingGeneratedAt.raw} 早于 run_ended_at=${runEndedAt.raw}`);
  }
  if (!buildSkipped && !installSkipped && !runSkipped &&
      buildAt.ms !== null && installAt.ms !== null && runStartedAt.ms !== null &&
      (buildAt.ms > installAt.ms || installAt.ms > runStartedAt.ms)) {
    issues.push('build → install → run_started_at 时间链不闭合');
  }

  if (!runSkipped && runRecord) {
    const recordedTrace = recordedPathForProject(ctx.projectRoot, runRecord.trace_path);
    if (!recordedTrace || !tracePath || recordedTrace !== path.resolve(tracePath)) {
      issues.push('device-test-run.meta.json 的 trace_path 未指向当前 authoritative trace');
    }
    const recordedReport = recordedPathForProject(ctx.projectRoot, runRecord.report_path);
    const expectedReport = tracePath ? path.resolve(path.dirname(tracePath), 'test-report.md') : null;
    if (!recordedReport || !fs.existsSync(recordedReport) || (expectedReport && recordedReport !== expectedReport)) {
      issues.push('device-test-run.meta.json 的 report_path 未指向同一 Hylyre run 报告');
    }
    const recordedLog = recordedPathForProject(ctx.projectRoot, runRecord.log_path);
    if (!recordedLog || !fs.existsSync(recordedLog)) {
      issues.push('device-test-run.meta.json 的 log_path 不存在');
    }
  }

  let timingDoc: DeviceTestTimingDocument | null = null;
  const timingPipeline = timing.value?.pipeline;
  const timingCases = timing.value?.cases;
  const requiredPipelineKeys = [
    'build_ms', 'build_reused', 'install_ms', 'install_reused',
    'hylyre_run_ms', 'page_save_ms', 'total_harness_ms', 'hap_built_at',
  ];
  let timingShapeValid = false;
  if (!runSkipped) {
    timingShapeValid = Boolean(
      timing.value &&
      timing.value.schema_version === '1.0' &&
      timing.value.feature === ctx.feature &&
      timingPipeline && typeof timingPipeline === 'object' && !Array.isArray(timingPipeline) &&
      Array.isArray(timingCases) &&
      requiredPipelineKeys.every(key => hasOwn(timingPipeline as Record<string, unknown>, key)) &&
      typeof (timingPipeline as Record<string, unknown>).build_reused === 'boolean' &&
      typeof (timingPipeline as Record<string, unknown>).install_reused === 'boolean' &&
      (typeof (timingPipeline as Record<string, unknown>).hap_built_at === 'string' ||
        (timingPipeline as Record<string, unknown>).hap_built_at === null)
    );
    if (!timingShapeValid) {
      issues.push(`缺失或无效的最终 ${path.basename(timingPath)}${timing.error ? `（${timing.error}）` : ''}`);
    }
  }

  if (timingShapeValid && timing.value && timingPipeline && Array.isArray(timingCases)) {
    const pipeline = timingPipeline as Record<string, unknown>;
    for (const key of ['build_ms', 'install_ms', 'hylyre_run_ms', 'page_save_ms']) {
      if (!hasOwn(pipeline, key)) issues.push(`device-test-timing.json.pipeline 缺少字段：${key}`);
      else if (pipeline[key] !== null && finiteNonNegative(pipeline[key]) === null) {
        issues.push(`device-test-timing.json.pipeline.${key} 不是非负数或 null：${String(pipeline[key])}`);
      }
    }
    compareTimingPipelineOptionalNumber(issues, pipeline, 'total_harness_ms');

    if (typeof buildRecord?.reused !== 'boolean' || typeof installRecord?.reused !== 'boolean') {
      issues.push('build/install meta 缺少 boolean reused，无法闭合 timing 复用状态');
    } else {
      if (pipeline.build_reused !== buildRecord.reused) {
        issues.push(`timing.pipeline.build_reused=${String(pipeline.build_reused)} 与 build.reused=${String(buildRecord.reused)} 不一致`);
      }
      if (pipeline.install_reused !== installRecord.reused) {
        issues.push(`timing.pipeline.install_reused=${String(pipeline.install_reused)} 与 install.reused=${String(installRecord.reused)} 不一致`);
      }
    }

    const buildResultDuration = finiteNonNegative(buildRecord?.hvigorDurationMs);
    const buildToolDuration = finiteNonNegative(buildTool.value?.durationMs);
    if (buildRecord?.reused !== true && buildResultDuration !== null && buildToolDuration !== null &&
        Math.abs(buildResultDuration - buildToolDuration) > 1) {
      issues.push(`build duration sources 不一致：device-test-build=${buildResultDuration}ms，hvigor meta=${buildToolDuration}ms`);
    }
    const buildDurationSource = buildRecord?.reused === true
      ? 0
      : buildToolDuration ?? buildResultDuration;
    const installDurationSource = installRecord?.reused === true ? 0 : finiteNonNegative(installRecord?.durationMs);
    const runDurationSource = finiteNonNegative(runRecord?.run_duration_ms);
    const pageSave = runRecord?.hylyre_page_save;
    const pageSaveDurationSource = pageSave && typeof pageSave === 'object'
      ? finiteNonNegative((pageSave as Record<string, unknown>).duration_ms)
      : null;
    if (buildDurationSource === null && buildRecord?.reused !== true) {
      issues.push('build meta 缺少有效 hvigorDurationMs/durationMs，无法确认最终 build 耗时');
    }
    if (installDurationSource === null && installRecord?.reused !== true) {
      issues.push('device-test-install.meta.json 缺少有效 durationMs，无法确认最终 install 耗时');
    }
    if (runDurationSource === null) {
      issues.push('device-test-run.meta.json 缺少有效 run_duration_ms，无法确认最终 Hylyre 耗时');
    }
    if (pageSave === null || typeof pageSave !== 'object' || pageSaveDurationSource === null) {
      issues.push('device-test-run.meta.json 缺少有效 hylyre_page_save.duration_ms，无法确认最终 page save 耗时');
    }
    compareTimingPipelineNumber(issues, pipeline, 'build_ms', buildDurationSource);
    compareTimingPipelineNumber(issues, pipeline, 'install_ms', installDurationSource);
    compareTimingPipelineNumber(issues, pipeline, 'hylyre_run_ms', runDurationSource);
    compareTimingPipelineNumber(issues, pipeline, 'page_save_ms', pageSaveDurationSource);

    const buildHapBuiltAt = buildRecord?.hapBuiltAt;
    if (typeof buildHapBuiltAt !== 'string' || !buildHapBuiltAt.trim() || !Number.isFinite(Date.parse(buildHapBuiltAt))) {
      issues.push(`device-test-build.result.json.hapBuiltAt 缺失或非法：${String(buildHapBuiltAt)}`);
    } else if (pipeline.hap_built_at !== buildHapBuiltAt) {
      issues.push(`timing.pipeline.hap_built_at=${String(pipeline.hap_built_at)} 与 build.hapBuiltAt=${buildHapBuiltAt} 不一致`);
    }

    const timingById = new Map<string, number>();
    for (const row of timingCases as Array<Record<string, unknown>>) {
      const id = typeof row?.id === 'string' ? row.id.trim().toUpperCase() : '';
      const duration = finiteNonNegative(row?.duration_ms);
      const stepCount = row?.step_count;
      if (!id || duration === null || typeof stepCount !== 'number' || !Number.isInteger(stepCount) || stepCount < 0 || timingById.has(id)) {
        issues.push('device-test-timing.json 的 case duration/step_count 行无效或重复');
        continue;
      }
      timingById.set(id, duration);
    }
    const traceIds = new Set<string>();
    if (!trace || !Array.isArray(trace.cases)) {
      issues.push('authoritative trace 缺少 cases[]，无法与最终 timing 精确对账');
    } else {
      for (const c of trace.cases) {
        const id = typeof c?.id === 'string' ? c.id.trim().toUpperCase() : '';
        if (!id || traceIds.has(id)) issues.push('authoritative trace 的 cases[] id 无效或重复');
        else traceIds.add(id);
      }
      const timingIds = new Set(timingById.keys());
      for (const id of traceIds) if (!timingIds.has(id)) issues.push(`最终 timing 缺少 case duration：${id}`);
      for (const id of timingIds) if (!traceIds.has(id)) issues.push(`最终 timing 含 trace 不存在的旧 case：${id}`);
    }
    if (trace && trace.feature !== ctx.feature) {
      issues.push(`authoritative trace.feature=${trace.feature} 与当前 feature=${ctx.feature} 不一致`);
    }

    timingDoc = timing.value as unknown as DeviceTestTimingDocument;
  }

  if (report && timingDoc) {
    const channelDecl = loadExecutionChannelDeclaration(ctx, plan);
    const reportTiming = reconcileReportWithDeviceTestTiming(report, {
      timing: timingDoc,
      ...(buildAt.raw ? { buildTimestamp: buildAt.raw } : {}),
      ...(channelDecl.column_declared ? { hylyreTcIds: channelDecl.hylyre_tc_ids } : {}),
    });
    issues.push(...reportTiming.mismatches);
  }

  holder.buildReused = Boolean(buildRecord?.reused);
  holder.hapPath = buildHapPath;
  holder.installPassed = installValid;
  holder.installExecuted = false;
  holder.installOk = false;
  holder.hapSha256Full = null;
  holder.hylyreTracePath = tracePath;
  holder.deviceTestRunExecuted = Boolean(tracePath && trace);

  const runOutcome = evaluateHylyreRunOutcome(trace);
  const runValid =
    runMetaValid &&
    traceValid &&
    staticPlan.issues.length === 0 &&
    (runSkipped || runOutcome.verdict === 'pass');
  if (trace && !runSkipped && runOutcome.verdict !== 'pass') {
    issues.push(...runOutcome.reasonLines.map(line => `authoritative trace：${line}`));
  }
  if (!runValid && runSkipped) {
    issues.push('device_test.run 当前 profile 为 SKIP，无法对账既有执行 trace');
  }

  const buildResult: CheckResult = {
    id: 'device_test_build',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'device_test_build'),
    severity: 'BLOCKER',
    status: buildSkipped ? 'SKIP' : buildValid ? 'PASS' : 'FAIL',
    details: buildSkipped
      ? 'report-only：当前 profile 将 device_test.build 声明为 SKIP，未调用构建工具。'
      : buildValid
        ? `report-only：读取既有 ${path.basename(buildPath)}（reused=${String(buildRecord?.reused === true)}），未调用 hvigor。`
        : `report-only：${path.basename(buildPath)} 不可用。`,
  };
  const installResult: CheckResult = {
    id: 'device_test_install',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'device_test_install'),
    severity: 'BLOCKER',
    status: installSkipped ? 'SKIP' : installValid ? 'PASS' : 'FAIL',
    details: installSkipped
      ? 'report-only：当前 profile 将 device_test.install 声明为 SKIP，未调用 hdc。'
      : installValid
        ? `report-only：读取既有 ${path.basename(installPath)}（reused=${String(installRecord?.reused === true)}），未调用 hdc。`
        : `report-only：${path.basename(installPath)} 不可用。`,
  };
  const runResult: CheckResult = {
    id: 'device_test_run',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'device_test_run'),
    severity: 'BLOCKER',
    status: runSkipped ? 'SKIP' : runValid ? 'PASS' : 'FAIL',
    details: runSkipped
      ? 'report-only：当前 profile 将 device_test.run 声明为 SKIP，未调用 Hylyre。'
      : runValid
        ? `report-only：读取既有 ${path.basename(runPath)} 与 trace（outcome=${trace?.outcome ?? 'unknown'}），未调用 Hylyre。`
        : `report-only：${path.basename(runPath)} 或 authoritative trace 不可用。`,
  };

  const id = 'report_reconcile_only';
  const desc = ruleDesc(ctx, 'structure_checks', id);
  const detailLines = issues.length === 0
    ? [`已读取 authoritative trace=${tracePath}，cases=${trace?.cases?.length ?? 0}；路径/指纹/时间戳/复用状态/精确 case 集合/报告耗时均与同一最终 run 闭合。`]
    : issues.map(issue => `  - ${issue}`);
  const reconcileResult: CheckResult = {
    id,
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    details: [
      'report-only reconciliation 只读既有 test-plan/report/trace/timing/build-install-run meta；未调用设备、hvigor、hdc、Hylyre 或视觉采集。',
      ...detailLines,
    ].join('\n'),
    suggestion: issues.length === 0
      ? '继续由既有 report/trace/static checks 与 summary writer 完整重算派生结果。'
      : '补齐同一最终 run 的 authoritative trace、test-plan、test-report、device-test-timing 与 build/install/run meta 后重新执行 report-only。',
  };
  const selectorBlockers = staticPlan.selectorWarnings.filter(v => v.severity === 'BLOCKER');
  const selectorResult: CheckResult[] = staticPlan.selectorWarnings.length > 0
    ? [{
        id: 'derived_selector_contract',
        category: 'structure',
        description: '派生 Hylyre selector 必须可追溯到 ui-spec',
        severity: selectorBlockers.length > 0 ? 'BLOCKER' : 'MINOR',
        status: selectorBlockers.length > 0 ? 'FAIL' : 'WARN',
        details: [
          `[SELECTOR-SPEC-001] 共 ${staticPlan.selectorWarnings.length} 个 canonical selector 问题：`,
          ...staticPlan.selectorWarnings.slice(0, 12).map(v =>
            `  - ${v.tc_id} step ${v.step_index} ${v.selector_kind}=${v.selector}: ${v.message}`),
        ].join('\n'),
        suggestion: '按 canonical ui-spec 修正 selector；dump/cache 仅用于发现候选。',
        source: 'derived_selector_contract',
      }]
    : [];
  const evidenceResult: CheckResult[] = reconciledEvidenceGate
    ? [{
        id: 'hylyre_evidence_gate',
        category: 'structure',
        description: 'Hylyre native CaseResult/StepResult 三重判据与 legacy 划界',
        severity: 'BLOCKER',
        status: reconciledEvidenceGate.native ? 'PASS' : 'FAIL',
        ...evidenceGateFailureProjection(reconciledEvidenceGate, holder),
        structured: reconciledEvidenceGate,
        details: reconciledEvidenceGate.native
          ? `native evidence gate PASS：version=${reconciledEvidenceGate.traceVersion}, schema=${reconciledEvidenceGate.traceSchemaVersion}。`
          : [
              `native evidence gate FAIL（mode=${reconciledEvidenceGate.mode}）：legacy status 不得贡献 verification=passed。`,
              ...reconciledEvidenceGate.reasons.map(reason => `  - ${reason}`),
            ].join('\n'),
        suggestion: reconciledEvidenceGate.native
          ? 'P0/acceptance 仅消费当前 trace 的 CaseResult.steps[]。'
          : '升级/核验 Hylyre 0.5.0、trace schema 0.4-p0 + hylyre.step-outcome/1 与 ready version chain 后重跑。',
      }]
    : [];
  return [reconcileResult, buildResult, installResult, runResult, ...evidenceResult, ...selectorResult];
}

/** Test seam: report-only pipeline reconciliation must remain filesystem-read-only. */
export function __testing_checkReportReconcileOnlyPipeline(ctx: CheckContext): CheckResult[] {
  const holder: DeviceTestPipelineHolder = {
    hapPath: null,
    installPassed: false,
    installExternallyBlocked: false,
    buildReused: false,
    hylyreTracePath: null,
    deviceTestRunExecuted: false,
    installExecuted: false,
    installOk: false,
    hapSha256Full: null,
  };
  const planPath = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md').actualPath;
  const reportPath = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-report.md').actualPath;
  const plan = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf-8') : null;
  const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf-8') : null;
  return checkReportReconcileOnlyPipeline(ctx, holder, plan, report);
}

function buildDeviceInstallFailResults(
  ctx: CheckContext,
  holder: DeviceTestPipelineHolder,
  id: string,
  desc: string,
  fallbackDetails: string,
  /**
   * provider 侧对本次装机失败的诊断（P1，四轮 review）。
   *
   * 必须**优先**于重新探测：`diagnoseInstallBlocking` 只看 HDC 在线性与版本，
   * 手机连着但锁屏时它通常返回 `clear` —— 于是 provider 明明已经判出
   * `device_locked`，结论层却把它当普通失败，`externalBlocked`/`device_blocked`
   * 全丢了，goal 也就归不到 external_block。
   */
  installDiagnosisKind?: string,
): CheckResult[] {
  if (installDiagnosisKind === 'device_locked') {
    holder.installExternallyBlocked = true;
    return [
      {
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `${fallbackDetails}\n\n设备锁屏且未能自动解锁——这是外部阻断，不是代码或签名问题。`,
        suggestion:
          '请人工解锁设备后重跑 testing harness；框架不会猜测或枚举未登记的口令。' +
          '若希望框架自动解锁，先在**自己的终端**运行 device-policy --enroll 登记 PIN。',
        failure_kind: 'device_blocked',
        blocking_class: 'externalBlocked',
      },
    ];
  }
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

    // plan a7c3f9e2 t1：与 coding/provider 共用同一终态判据（errors[] 不参与判定）
    const compileOk = deviceTestGateCompileOk(Boolean(res.reused), hv);

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
            // t5（plan a7c3f9e2 ⑦）：编译形态与来源单行（unresolved 时 product=null）
            ...(res.productSelection ? [describeProductSelection(res.productSelection)] : []),
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
      const scannedDirs = res.scannedDirs ?? [];
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: [
            scannedDirs.length
              ? `hvigor 已通过但未在以下已扫描的 outputs 目录中找到合适的 *-signed.hap：\n${scannedDirs.map((d) => `  - ${d}`).join('\n')}`
              : 'hvigor 已通过但未扫描到任何 build/<segment>/outputs/<dir> 目录（请确认 build-profile.json5 modules[] 声明正确，或入口模块尚未产出任何构建产物）。',
            '请确认入口模块已产出主应用 HAP；可参考 reports/<feature>/testing/device-test-build.result.json。',
            ...(hv.diagnostics?.length
              ? ['', '── harness 诊断 ──', ...hv.diagnostics.map(d => `• ${d}`)]
              : []),
          ].join('\n'),
        },
      ];
    }

    const ambiguityLines =
      (res.candidates?.length ?? 0) > 1
        ? [
            '',
            `⚠ 候选 signed HAP 有 ${res.candidates!.length} 个，已按稳定优先级选择第一条：`,
            ...res.candidates!.map((c) => `  - ${c.path}${c.path === res.hapPath ? '  ← 选中' : ''}`),
          ]
        : [];

    const staleLines = res.staleSuspect
      ? ['', `⚠ ${res.staleSuspectNote ?? 'signed 可能基于上一轮 unsigned'}（unsigned：${res.staleSuspectUnsignedPath ?? '(未知)'}）`]
      : [];

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
          // t5（plan a7c3f9e2 ⑦）：报告可见性——编译形态与来源单行
          ...(res.productSelection ? [describeProductSelection(res.productSelection)] : []),
          `HAP: ${res.hapPath}`,
          reuseLine,
          ...ambiguityLines,
          ...staleLines,
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
        // provider 已经判出的失败原因优先——重新探测看不见"手机连着但锁屏"
        res.install?.diagnosis?.kind,
      );
    }

    holder.installPassed = true;
    // d9e4b7c1 T2：未合并的实装事实（evidence 写入门槛消费）
    holder.installExecuted = res.executed === true && res.reused !== true;
    holder.installOk = res.ok === true && holder.installExecuted;
    holder.hapSha256Full = res.hapSha256Full ?? null;

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

/**
 * d9e4b7c1 T2：goal 正式 testing gate 的 device-test-evidence 统一写入（协调层单写者——
 * install provider 知道 executed/ok/hash、run provider 知道 trace/cases，二者都不具备
 * 写入的全部事实；由 build→install→run 完成后的本函数单点合成）。
 *
 * 写入门槛（plan d9e4b7c1 v13 冻结，全部满足才写）：
 *   · MAISON_GOAL_GATE_HARNESS==='1'（runner 直 spawn 的 gate 专属标记）；
 *   · goal run/attempt 身份完整；
 *   · 本轮真实安装成功（installExecuted && installOk——installPassed 合并了 reuse 不作数）；
 *   · device_test.run 已执行且本轮 trace 在盘（trace_path 直取 holder，禁调 authoritative
 *     resolver——那是 collector 的二次核验器，writer 用它会把旧 trace 洗成本轮）；
 *   · 写前复算 HAP 完整摘要与装机前一致（compose 内执行，TOCTOU 钉死）。
 * 结果语义（review P1：evidence 生成失败不得静默吞——"真机测的是旧 HAP、当前 HAP 已变化"
 * 时 compose 会拒绝，若只 warn 则 collector 把缺文件当无信号、testing 可能假放行）：
 *   · 非 goal gate / goal 身份不全 → []（普通模式零变化）；
 *   · 真实安装或 run 未完成 → []（上游 install/run 门禁已 FAIL，本函数不重复报）；
 *   · **真实安装 + run 都已成功**但 compose 失败/写盘异常 → BLOCKER FAIL（进 results）；
 *   · 成功写入 → PASS（可观测）。
 */
export function writeDeviceTestEvidenceIfEligible(
  ctx: CheckContext,
  holder: DeviceTestPipelineHolder,
  /** 测试缝：覆盖 compose（默认走 capability dispatch） */
  composeFn?: (options: Record<string, unknown>) => unknown,
): CheckResult[] {
  const id = 'device_test_evidence';
  const desc = 'goal 正式 gate：device-test-evidence 统一写入';
  if (process.env.MAISON_GOAL_GATE_HARNESS !== '1') return [];
  const goalRunId = process.env.MAISON_GOAL_RUN_ID?.trim() ?? '';
  const attemptId = process.env.MAISON_GOAL_ATTEMPT?.trim() ?? '';
  if (!goalRunId || !attemptId) return [];
  if (!holder.installExecuted || !holder.installOk) {
    console.warn('[device-test-evidence] 未写入：本轮无真实安装成功事实（上游 install 门禁负责裁决）');
    return [];
  }
  if (!holder.deviceTestRunExecuted || !holder.hylyreTracePath) {
    console.warn('[device-test-evidence] 未写入：本轮 device_test.run 未执行或 trace 缺失（上游 run 门禁负责裁决）');
    return [];
  }
  // 至此：正式 gate 已完成真实安装与 run——evidence 必须写出，任何失败都是 BLOCKER
  const fail = (details: string): CheckResult[] => [{
    id, category: 'structure', description: desc, severity: 'BLOCKER', status: 'FAIL',
    details: `goal 正式 gate 已完成真实安装与 device_test.run，但 evidence 未能写出：${details}\n` +
      '缺 evidence 时 goal-runner 无法采信本轮真机结果（旧包/改写 HAP 的结果可能被误当有效）。',
    suggestion: '核查 HAP 是否在装机后被并发改写（compose 会复算 sha 拒绝）、reports 目录可写性后重跑 testing harness。',
  }];
  if (!holder.hapSha256Full || !holder.hapPath) {
    return fail('装机前 HAP 完整摘要缺失（install provider 未回传 hapSha256Full）');
  }

  if (holder.hylyreEvidenceCapability?.native && !holder.hylyreEvidenceGate?.native) {
    return fail('provider 已在 preflight 声明 native，但 post-run trace/identity gate 未通过；不得回退到 legacy composer');
  }

  // Native StepResult is already authoritative in trace.json. Keep the
  // existing goal evidence file only as an identity binding receipt; never
  // copy native cases or synthesize a second case/step ledger here.
  if (holder.hylyreEvidenceGate?.native) {
    if (!holder.nativeArtifactBinding) {
      return fail('native trace/derived-plan artifact binding 缺失');
    }
    const trace = parseHylyreTrace(holder.hylyreTracePath);
    const currentHapSha = computeHapSha256Full(holder.hapPath);
    if (!trace || !currentHapSha || currentHapSha !== holder.hapSha256Full) {
      return fail('native trace/HAP identity binding 无法复核（trace 缺失或 HAP 摘要已漂移）');
    }
    const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    const identityDoc: DeviceTestEvidenceDoc = {
      schema_version: '1.1',
      goal_run_id: goalRunId,
      attempt_id: attemptId,
      device_target: {
        serial: process.env.HARNESS_HDC_TARGET?.trim() || null,
        target_kind: process.env.MAISON_DEVICE_TARGET_KIND?.trim() || null,
        session_id: process.env.MAISON_DEVICE_SESSION_ID?.trim() || null,
      },
      hap_sha256_full: holder.hapSha256Full,
      install_executed: holder.installExecuted,
      install_ok: holder.installOk,
      trace_path: path.resolve(holder.hylyreTracePath),
      run_failure_kind: typeof trace.run_failure_kind === 'string' ? trace.run_failure_kind : null,
      written_at: new Date().toISOString(),
      cases: [],
      artifact_binding: holder.nativeArtifactBinding,
    };
    try {
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(
        deviceTestEvidencePath(reportsDir),
        `${JSON.stringify({ ...identityDoc, written_at: new Date().toISOString() }, null, 2)}\n`,
        'utf-8',
      );
    } catch (error) {
      return fail(`native identity binding 写盘异常：${(error as Error).message}`);
    }
    return [{
      id, category: 'structure', description: desc, severity: 'BLOCKER', status: 'PASS',
      details: 'native CaseResult.steps[] 保持唯一证据源；device-test-evidence.json 仅写入既有 goal identity/HAP/trace binding。',
    }];
  }

  let composed: { ok: boolean; reason?: string; doc?: Record<string, unknown> };
  try {
    composed = (composeFn ?? (options => dispatchDeviceTestEvidenceCompose(ctx, options)))({
      projectRoot: ctx.projectRoot,
      feature: ctx.feature,
      tracePath: holder.hylyreTracePath,
      hapPath: holder.hapPath,
      expectedHapSha256Full: holder.hapSha256Full,
      goalRunId,
      attemptId,
      deviceTarget: {
        serial: process.env.HARNESS_HDC_TARGET?.trim() || null,
        target_kind: process.env.MAISON_DEVICE_TARGET_KIND?.trim() || null,
        session_id: process.env.MAISON_DEVICE_SESSION_ID?.trim() || null,
      },
      installExecuted: holder.installExecuted,
      installOk: holder.installOk,
    }) as { ok: boolean; reason?: string; doc?: Record<string, unknown> };
  } catch (e) {
    return fail(`compose 异常：${(e as Error).message}`);
  }
  if (!composed?.ok || !composed.doc) {
    return fail(composed?.reason ?? 'compose 失败（无原因）');
  }
  try {
    const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    const doc = { ...composed.doc, written_at: new Date().toISOString() };
    fs.writeFileSync(deviceTestEvidencePath(reportsDir), `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  } catch (e) {
    return fail(`写盘异常：${(e as Error).message}`);
  }
  const caseCount = Array.isArray((composed.doc as { cases?: unknown[] }).cases)
    ? (composed.doc as { cases: unknown[] }).cases.length
    : 0;
  return [{
    id, category: 'structure', description: desc, severity: 'BLOCKER', status: 'PASS',
    details: `device-test-evidence.json 已写入（cases=${caseCount}）`,
  }];
}

/**
 * Q5 artifact 完整性 + §8.1 failure-boundary 义务（plan a6c4e9f2 T4 返修接入生产）。
 *
 * 在此之前 `resolveArtifact` / `evaluateFailureBoundary` **只被单测调用**：artifact 文件
 * 不存在、sha256 对不上、路径经 junction 逃出 trace 目录树、根失败没留失败边界截图——
 * 生产链上一个 BLOCKER 都不会产生。写了校验器却不接门禁，等于没写。
 *
 * 基准是 authoritative trace **文件所在目录**（冻结 §8.1），因此本门必须拿到 tracePath 而不只是
 * 解析后的对象；这也是 Hylyre 那个 producer bug 的回归面，不得改成 fallback 搜索。
 */
/**
 * 缺陷身份 slug（tasks 6.6b）。
 *
 * 这两道门原来用**位置序号**做 check id（`testing_failure_routing_${index+1}`）。
 * 问题不在可读性，在下游：`repair-candidates` 的 `item_fingerprint` 由
 * `(id, files, summary)` 派生，而该指纹正是 goal 模式**防震荡 attempted 集合**的键
 * （`!attempted.has(c.item_fingerprint)`）与 `roundFingerprintOfCandidates` 的输入。
 *
 * 位置序号会随"同一轮里更靠前的缺陷被修掉"而整体前移：同一个缺陷（同 case、同 step、
 * 同 code）在下一轮换了 id、换了指纹，于是被当成**全新候选**重新投递——
 * 防震荡与"已尝试过"记账同时失效，正好是本 plan 要消灭的那种放大效应的账本版本。
 *
 * 改成按缺陷身份取 id：case + step 唯一确定一条 route/disposition
 * （跨行 verifier 已保证同 case 内 step index 不重复），因此 id 稳定且不冲突。
 */
function defectSlug(caseId: string, stepIndex: number): string {
  const normalized = String(caseId).toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${normalized.slice(0, 48) || 'UNKNOWN-CASE'}_s${stepIndex}`;
}

function checkHylyreArtifactIntegrity(
  ctx: CheckContext,
  tracePath: string | null,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
): CheckResult[] {
  const id = 'testing_artifact_integrity';
  const description = 'Hylyre artifact 定位/哈希与 failure-boundary 义务';
  if (!trace) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      details: 'authoritative trace 缺失，无法核对 artifact 与失败边界义务。',
      suggestion: '用同一 native run 重新产出 trace 后重跑。',
    }];
  }
  // evidenceGate=null 只表示"本 feature 没有 P0 device AC，三重身份门不适用"，
  // 不代表 v1 协议非法——它是在 runtimeEvidenceRequired 为真时才生成的。
  // 把 null 当失败会让合法 v1 run 平白吃 BLOCKER；口径与 completeness 门对齐。
  if (evidenceGate && !evidenceGate.native) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details:
        `native evidence gate 未闭合（mode=${String(evidenceGate.mode)}）：` +
        `${evidenceGate.reasons.slice(0, 4).join('；') || '无原因记录'}`,
      suggestion: '先让 native evidence gate 通过，再核对 artifact。',
    }];
  }
  if (!tracePath) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      details: 'artifact 的解析基准是 authoritative trace 文件所在目录，但 trace 文件路径不可知。',
      suggestion: '让 device-test 绑定同一 timestamp 目录的 trace.json 后重跑；不得改用 reports 根等第二基准。',
    }];
  }
  const verdict = requireV1ForGate(trace, { frameworkRoot: ctx.frameworkRoot });
  if (!verdict.ok || !verdict.trace) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details: verdict.detail, suggestion: verdict.suggestion,
    }];
  }

  const problems: string[] = [];
  for (const traceCase of verdict.trace.cases ?? []) {
    for (const step of traceCase.steps ?? []) {
      for (const artifact of step.artifacts ?? []) {
        const resolved = resolveArtifact(tracePath, artifact);
        if (!resolved.ok) {
          problems.push(`${traceCase.id} step ${step.index} artifact[${artifact.kind}]：${resolved.detail}`);
        }
      }
      const boundary = evaluateFailureBoundary({
        deviceSession: step.device_session === true,
        status: step.outcome.status,
        failureDomain: step.outcome.status === 'failed' ? step.outcome.failure.domain : undefined,
        artifacts: step.artifacts ?? [],
        extensions: step.extensions,
        caseEvidence: String(traceCase.evidence),
      });
      if (boundary.kind === 'violated') {
        problems.push(`${traceCase.id} step ${step.index}：${boundary.detail}`);
      }
    }
  }

  if (problems.length === 0) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'PASS',
      details: 'artifact 全部可定位、哈希相符、停留在 trace 目录树内；根失败的失败边界义务已满足。',
    }];
  }
  return [{
    id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
    failure_kind: 'artifact',
    details: [
      `artifact/失败边界核对 FAIL（${problems.length} 项）：`,
      ...problems.slice(0, 12).map(p => `  - ${p}`),
    ].join('\n'),
    suggestion:
      'artifact.path 相对 trace 文件所在目录、必须留在该目录树内（符号链接/junction 也不行）、sha256 必须相符；' +
      'device-session 内的 selector/assertion 根失败必须留 screenshot/ui_dump/visible_elements 之一，' +
      '或如实记录 capture unavailable 并把该 case 的 evidence 降为 incomplete。不得补造证据文件。',
  }];
}

function checkHylyreFailureRouting(
  ctx: CheckContext,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
  derivedPlanPath?: string | null,
): CheckResult[] {
  // plan a6c4e9f2 T4 返修：原为 `if (!trace || !evidenceGate?.native) return []`。
  // required gate 不存在"静默不适用"形态——缺 trace / evidence gate 未闭合都必须显式 BLOCKER，
  // 否则一次 native 判定失误就会把整条责任路由链一起抹掉。
  if (!trace) {
    return [{
      id: 'testing_failure_routing_protocol',
      category: 'structure', description: 'Hylyre 责任路由的结果协议判别',
      severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details: 'authoritative trace 缺失，无法做 Step Outcome v1 责任路由。',
      suggestion: '用同一 native run 重新产出 trace；不得从 diagnostic/日志/报告散文推断责任。',
    }];
  }
  // evidenceGate=null 只表示"本 feature 没有 P0 device AC，三重身份门不适用"，
  // 不代表 v1 协议非法——它是在 runtimeEvidenceRequired 为真时才生成的。
  // 把 null 当失败会让合法 v1 run 平白吃 BLOCKER；口径与 completeness 门对齐。
  if (evidenceGate && !evidenceGate.native) {
    return [{
      id: 'testing_failure_routing_protocol',
      category: 'structure', description: 'Hylyre 责任路由的结果协议判别',
      severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details:
        `native evidence gate 未闭合（mode=${String(evidenceGate.mode)}）：` +
        `${evidenceGate.reasons.slice(0, 4).join('；') || '无原因记录'}`,
      suggestion: '先让 native evidence gate 通过（版本链/协议/契约三者一致），再谈责任路由。',
    }];
  }
  const verdict = requireV1ForGate(trace, { frameworkRoot: ctx.frameworkRoot });
  if (!verdict.ok || !verdict.trace) {
    return [{
      id: 'testing_failure_routing_protocol',
      category: 'structure', description: 'Hylyre 责任路由的结果协议判别',
      severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details: verdict.detail, suggestion: verdict.suggestion,
    }];
  }
  // plan a6c4e9f2 T4：只消费实际尝试且实际失败的 step；未执行的 blocked/skipped 零 route。
  // 旧实现按"非 passed 即路由"，一次 run 把 1 根失败放大成 70 个 BLOCKER。
  const { routes, dispositions } = collectFailureRoutesV1(verdict.trace);
  const routeResults: CheckResult[] = routes.map(route => ({
    id: `testing_failure_routing_${defectSlug(route.caseId, route.stepIndex)}`,
    category: 'structure' as const,
    description: 'Step Outcome v1 责任路由（outcome.failure.domain）',
    severity: 'BLOCKER' as const,
    status: 'FAIL' as const,
    failure_kind: route.domain,
    failure_code: route.code,
    coding_candidate: route.codingCandidate,
    ...(route.repairCategory
      ? { repair_owner: route.repairCategory }
      : route.owner === 'capability' || route.owner === 'external' || route.owner === 'testing'
        ? { repair_owner: route.owner }
        : {}),
    ...(route.owner === 'capability' || route.owner === 'external'
      ? { blocking_class: route.owner === 'capability' ? 'externalBlocked' : 'device_toolchain' }
      : {}),
    details: `${route.caseId} step ${route.stepIndex}：${route.reason}`,
    suggestion: route.codingCandidate
      ? '由既有 summary repair-candidates 链投递 coding/product。'
      : '按 outcome.failure.domain 修复/重派生/能力 defer；不得从 diagnostic、TC 名称或报告散文推断责任。',
  }));
  // 机器证明的 blocked capability/infrastructure 根：零 failure route，各投影一次既有 disposition。
  const dispositionResults: CheckResult[] = dispositions.map(item => ({
    id: `testing_cause_disposition_${defectSlug(item.caseId, item.stepIndex)}`,
    category: 'structure' as const,
    description: '未执行 blocked 根因的 capability/external disposition',
    severity: 'BLOCKER' as const,
    status: 'FAIL' as const,
    failure_kind: item.causeType,
    failure_code: item.code,
    coding_candidate: false,
    repair_owner: item.causeType === 'capability' ? 'capability' : 'external',
    blocking_class: item.causeType === 'capability' ? 'externalBlocked' : 'device_toolchain',
    details: `${item.caseId} step ${item.stepIndex}：${item.reason}`,
    suggestion: '这是未尝试的机器阻塞，不产生 failure route 也不投 coding；按能力/工具链处置。',
  }));
  return [...routeResults, ...dispositionResults];
}

function checkHylyreRuntimeSelectorGate(
  ctx: CheckContext,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
  derivedPlanPath?: string | null,
): CheckResult[] {
  const id = 'hylyre_selector_runtime_gate';
  const description = 'Hylyre StepResult selector evidence 运行时门';
  // plan a6c4e9f2 T4 返修：原为 `if (!evidenceGate?.native) return []`，与责任路由门同病。
  if (!trace) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details: 'authoritative trace 缺失，selector 运行时门无判据。',
      suggestion: '用同一 native run 重新产出 trace 后重跑。',
    }];
  }
  // evidenceGate=null 只表示"本 feature 没有 P0 device AC，三重身份门不适用"，
  // 不代表 v1 协议非法——它是在 runtimeEvidenceRequired 为真时才生成的。
  // 把 null 当失败会让合法 v1 run 平白吃 BLOCKER；口径与 completeness 门对齐。
  if (evidenceGate && !evidenceGate.native) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details:
        `native evidence gate 未闭合（mode=${String(evidenceGate.mode)}）：` +
        `${evidenceGate.reasons.slice(0, 4).join('；') || '无原因记录'}`,
      suggestion: '先让 native evidence gate 通过，再消费 selector 身份事实。',
    }];
  }
  const reportsBase = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
  let selected: { content: string } | null = null;
  if (derivedPlanPath && fs.existsSync(derivedPlanPath)) {
    try { selected = { content: fs.readFileSync(derivedPlanPath, 'utf-8') }; } catch { selected = null; }
  } else {
    const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
    selected = pick.selected ? { content: pick.selected.content } : null;
  }
  if (!selected) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      details: 'native selector runtime gate 缺 authoritative 派生计划。',
      suggestion: '使用同一 timestamp 目录的 authoritative test-plan.hylyre.md 重跑。',
    }];
  }
  const uiSpec = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const v1 = requireV1ForGate(trace, { frameworkRoot: ctx.frameworkRoot });
  if (!v1.ok || !v1.trace) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details: v1.detail, suggestion: v1.suggestion,
    }];
  }
  // plan a6c4e9f2 D1：本门只消费 selector 的**身份事实**与状态机不变量，
  // 不裁决步骤成败（成败读 outcome），也不做 canonical ui-spec 封闭世界判定。
  const violations = evaluateSelectorRuntimeV1(v1.trace).violations;
  if (violations.length > 0) {
    return [{
      id,
      category: 'structure',
      description,
      severity: 'BLOCKER',
      status: 'FAIL',
      failure_kind: 'selector',
      failure_code: violations[0]!.code,
      details: [
        `native StepResult selector runtime gate FAIL（${violations.length} 项）：`,
        ...violations.slice(0, 12).map(v => `  - ${v.caseId} step ${v.stepIndex}: ${v.message}`),
        'runtime exact/contains 不自动放宽；candidate_count>1 无真实消歧必须拒绝。',
      ].join('\n'),
      suggestion: '按 StepResult 的机器字段处理 selector_not_found/selector_ambiguous/inline_target_unresolvable；不要解析 error 文本。',
    }];
  }
  return [{
    id, category: 'structure', description, severity: 'BLOCKER', status: 'PASS',
    details: 'native StepResult selector evidence 已通过 candidate_count/消歧/absence assertion 运行时门。',
  }];
}

function checkP0RuntimeStepEvidenceGate(
  ctx: CheckContext,
  priorResults: CheckResult[],
  holder: DeviceTestPipelineHolder,
): CheckResult[] {
  const id = 'p0_runtime_step_evidence';
  const description = 'P0 device flow 原生 CaseResult.steps[] 证据';
  const acceptance = loadAcceptanceFlowsDoc(ctx.projectRoot, ctx.feature);
  if (!acceptance?.criteria.some(isP0DeviceInteractive)) {
    return [{ id, category: 'structure', description, severity: 'MINOR', status: 'SKIP', details: '无 P0 device flow，native StepResult evidence 不适用。' }];
  }
  const gate = holder.hylyreEvidenceGate ?? priorResults
    .map(result => result.structured as HylyreEvidenceGateResult | undefined)
    .find(value => value && typeof value === 'object' && 'native' in value);
  if (!gate?.native) {
    if (gate?.mode === 'legacy') {
      const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
      const evidencePath = deviceTestEvidencePath(reportsDir);
      try {
        const legacyDoc = JSON.parse(fs.readFileSync(evidencePath, 'utf-8')) as DeviceTestEvidenceDoc;
        const legacyIssue = validateRuntimeFidelityEvidenceDocument({
          projectRoot: ctx.projectRoot,
          feature: ctx.feature,
          doc: legacyDoc,
          expectedGoalRunId: process.env.MAISON_GOAL_RUN_ID?.trim() || null,
          expectedAttemptId: process.env.MAISON_GOAL_ATTEMPT?.trim() || null,
          requirePhaseManifestBinding: false,
        });
        if (!legacyIssue) {
          return [{
            id,
            category: 'structure',
            description,
            severity: 'MAJOR',
            status: 'WARN',
            failure_kind: 'legacy_assertion_evidence_untrusted',
            details: `legacy telemetry 仅证明 device-test-evidence.json 中已命名的 ${legacyDoc.runtime_fidelity?.checkpoints.length ?? 0} 个 checkpoint；不把旧 case status 提升为 verification=passed，也不生成 CaseResult.steps[]。`,
            suggestion: '默认升级 Hylyre 至 0.4.0 并重跑 testing；legacy checkpoint 仅作有限兼容诊断。',
          }];
        }
      } catch {
        /* fall through to the fail-closed gate result below */
      }
    }
    return [{
      id,
      category: 'structure',
      description,
      severity: 'BLOCKER',
      status: 'FAIL',
      ...(gate ? evidenceGateFailureProjection(gate, holder) : { failure_kind: 'capability_missing', blocking_class: 'externalBlocked' }),
      details: `未启用 native CaseResult.steps[]：${gate?.reasons.join('；') || '缺少三重判据结果'}。旧 case status 不得贡献 verification=passed。`,
      suggestion: '升级 Hylyre 并由 ensureHylyreReady 生成一致的 installed/manifest/trace environment 后重跑 testing。',
    }];
  }

  const tracePath = holder.hylyreTracePath ?? resolveAuthoritativeHylyreTracePath(
    featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot),
  );
  const trace = tracePath ? parseHylyreTrace(tracePath) : null;
  // inventory §一 G2：本就是唯一 fail-closed 的正例，判据换成统一 dispatch。
  if (!tracePath || !trace || !requireV1ForGate(trace, { frameworkRoot: ctx.frameworkRoot }).ok) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      details: 'native evidence gate 已声明，但 authoritative trace 不可用，或其结果协议不是可消费的 v1。',
      suggestion: '使用同一 native Hylyre run 重新产生 trace；不得从 telemetry/log 合成 StepResult。',
    }];
  }

  if (process.env.MAISON_GOAL_GATE_HARNESS === '1') {
    const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    const evidencePath = deviceTestEvidencePath(reportsDir);
    let doc: DeviceTestEvidenceDoc;
    try {
      doc = JSON.parse(fs.readFileSync(evidencePath, 'utf-8')) as DeviceTestEvidenceDoc;
    } catch (error) {
      return [{
        id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
        details: `goal identity binding 缺失/不可解析：${(error as Error).message}`,
        suggestion: '保留现有 goal run/attempt/HAP/device identity binding，并重跑 testing gate。',
      }];
    }
    const expectedRunId = process.env.MAISON_GOAL_RUN_ID?.trim() || '';
    const expectedAttemptId = process.env.MAISON_GOAL_ATTEMPT?.trim() || '';
    const expectedTrace = path.resolve(tracePath);
    const expectedTarget = {
      serial: process.env.HARNESS_HDC_TARGET?.trim() || null,
      target_kind: process.env.MAISON_DEVICE_TARGET_KIND?.trim() || null,
      session_id: process.env.MAISON_DEVICE_SESSION_ID?.trim() || null,
    };
    const receiptBinding = doc.artifact_binding;
    const artifactBindingMismatch = !holder.nativeArtifactBinding ||
      !receiptBinding ||
      (Object.keys(holder.nativeArtifactBinding ?? {}) as Array<keyof DeviceTestArtifactBinding>)
        .some(key => receiptBinding[key] !== holder.nativeArtifactBinding?.[key]);
    const bindingIssues = [
      doc.goal_run_id !== expectedRunId ? `goal_run_id=${doc.goal_run_id}≠${expectedRunId}` : '',
      doc.attempt_id !== expectedAttemptId ? `attempt_id=${doc.attempt_id}≠${expectedAttemptId}` : '',
      path.resolve(doc.trace_path) !== expectedTrace ? `trace_path=${doc.trace_path}≠${expectedTrace}` : '',
      doc.hap_sha256_full !== holder.hapSha256Full ? 'hap_sha256_full 与装机前 HAP 不一致' : '',
      JSON.stringify(doc.device_target ?? null) !== JSON.stringify(expectedTarget)
        ? 'device_target 与当前 goal attempt 不一致' : '',
      doc.install_executed !== true || doc.install_ok !== true ? 'install identity fact 未证明真实安装成功' : '',
      artifactBindingMismatch ? 'artifact_binding 与本轮 trace/derived-plan identity 不一致' : '',
    ].filter(Boolean);
    if (bindingIssues.length > 0) {
      return [{
        id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
        details: `goal identity binding 不一致：${bindingIssues.join('；')}`,
        suggestion: '修复本轮 goal run/attempt/trace/HAP/device 绑定后重跑；native StepResult 仍是唯一 verdict source。',
      }];
    }
  }

  return [{
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: 'PASS',
    details: `native CaseResult.steps[] 已在场并通过三重判据（version=${gate.traceVersion}, schema=${gate.traceSchemaVersion}）；${process.env.MAISON_GOAL_GATE_HARNESS === '1' ? 'goal identity binding 保留。' : 'ordinary interactive 不因 legacy telemetry 缺席而 SKIP。'}`,
  }];
}

type DeriveHintAugment = {
  coverage_reason?:
    | 'no_derived'
    | 'incomplete'
    | 'stale'
    | 'extra_in_derived'
    | 'invalid_derived_steps'
    | 'invalid_derived_step_rules';
  top_tc_ids?: string[];
  derived_tc_ids?: string[];
  missing_tc_ids?: string[];
  explicit_skip_tc_ids?: string[];
  selected_derived_path?: string | null;
  rejected_placeholder_paths?: string[];
  source_plan_mtime_iso?: string;
  selected_derived_mtime_iso?: string;
  lint_violations?: Array<NavLintViolation | StepLintViolation>;
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
      // t7a（plan e6a3c9f4）：统一基座（schema 4 = 3 + 机器步骤知识块，只增字段向后兼容）——
      // agent 翻译 hylyre 时手边永远有机读目录，不依赖语法文档已读/上下文未压缩。
      ...buildStandardHylyreDerivePayloadBase(resolveHylyreResetIdentity(ctx.projectRoot)),
      feature: ctx.feature,
      phase: ctx.phase,
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

/**
 * Static checks for an already-derived Hylyre plan. This boundary intentionally
 * excludes build/install/run, trace, and holder mutation: those remain runtime
 * pipeline facts inside checkDeviceTestRunGate.
 */
/**
 * plan a6c4e9f2 T3：顶层 test-plan.md 的执行通道声明（编译期分派唯一真源）。
 * 读取一次即可——通道是计划 identity 的一部分，不在 derive/回灌时重算或改写。
 */
function loadExecutionChannelDeclaration(
  ctx: CheckContext,
  planRaw?: string | null,
): ExecutionChannelDeclarationResult {
  // plan b3d7e5a1 T2：唯一注入点——provider id 的 registry 存在性查表（capabilities 缺席视为空 registry，fail-closed）。
  const opts = {
    registeredCapabilityIds: registeredCapabilityIdsFromProfile(
      (ctx.resolvedProfile as { capabilities?: Record<string, unknown> } | undefined)?.capabilities,
    ),
  };
  if (typeof planRaw === 'string') return evaluateExecutionChannelDeclaration(planRaw, opts);
  const resolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
  const raw = fs.existsSync(resolved.actualPath) ? fs.readFileSync(resolved.actualPath, 'utf-8') : '';
  return evaluateExecutionChannelDeclaration(raw, opts);
}

/**
 * plan a6c4e9f2 T2：把 acceptance.yaml 的**结构化** checkpoint action 目标交给 selector
 * 静态门，作为唯一一条散文外的冲突判据。只读 `criteria[].checkpoint.action.target_element_id`，
 * 不解析 description/precondition/expected，也不把它当第二套 canonical selector 真源。
 */
function collectAcceptanceActionBindings(ctx: CheckContext): AcceptanceActionBinding[] {
  const doc = loadAcceptanceFlowsDoc(ctx.projectRoot, ctx.feature);
  if (!doc) return [];
  return doc.criteria.flatMap(ac => {
    const target = ac.checkpoint?.action?.target_element_id;
    return typeof ac.id === 'string' && ac.id.trim() && typeof target === 'string' && target.trim()
      ? [{ ac_id: ac.id.trim(), target_element_id: target.trim() }]
      : [];
  });
}

function collectDeviceTestStaticPlanGates(
  ctx: CheckContext,
  derivedContent: string,
  topPlanRaw: string,
): {
  stepLint: ReturnType<typeof lintHylyrePlanStepRules>;
  selectorWarnings: ReturnType<typeof lintDerivedPlanSelectorContract>;
  navLint: ReturnType<typeof lintDerivedHylyrePlanSteps>;
} {
  // plan b3d7e5a1 T4：正式路径的复位前奏身份与 derive hint 同源注入（零设备解析）。
  const stepLint = lintHylyrePlanStepRules(derivedContent, {
    resetIdentity: resolveHylyreResetIdentity(ctx.projectRoot).identity,
  });
  const selectorUiSpec = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const selectorWarnings = selectorUiSpec
    ? lintDerivedPlanSelectorContract(derivedContent, selectorUiSpec, ctx.feature, {
        acceptanceActionBindings: collectAcceptanceActionBindings(ctx),
      })
    : [];
  const topCases = extractTopPlanTestCasesForDeriveHint(topPlanRaw);
  const navLint = lintDerivedHylyrePlanSteps(derivedContent, topCases);
  return { stepLint, selectorWarnings, navLint };
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

    const reportsBase = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
    const expectedDir = path.join(reportsBase, '<timestamp>', 'hylyre');
    const topResolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
    const topPath = topResolved.actualPath;
    const topRaw = fs.existsSync(topPath) ? fs.readFileSync(topPath, 'utf-8') : '';
    const topIds = extractTcIdsFromPlanTable(topRaw);
    const topStat = fs.existsSync(topPath) ? fs.statSync(topPath) : null;
    const topPlanSha256AtStart = fs.existsSync(topPath) ? sha256File(topPath) : null;

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
    // plan a6c4e9f2 T3：顶层已声明通道时，派生集合必须**恰好等于** channel=hylyre 集合；
    // explicit skip 不再减除缺口（派生器没有 skip 决策权），且新正式派生不得再产出 skip。
    const runChannelDecl = loadExecutionChannelDeclaration(ctx, topRaw);
    // 只有声明**整体闭合**才按通道口径对账；部分缺值/非法/重复时上游已 SKIP 掉整段设备
    // 流水线，这里保持 legacy 口径仅为不产生第二套矛盾判定。
    const cov = runChannelDecl.channels_resolved
      ? evaluateChannelDerivedCoverage({
          hylyreTcIds: runChannelDecl.hylyre_tc_ids,
          derivedTcIds: derivedIds,
          legacyExplicitSkipTcIds: explicitSkips,
        })
      : evaluateDerivedCoverage({
          topTcIds: topIds,
          derivedTcIds: derivedIds,
          explicitSkipTcIds: explicitSkips,
        });
    if (runChannelDecl.channels_resolved && explicitSkips.length > 0) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details:
            `正式派生计划仍登记 explicit_skip_tc_ids：${explicitSkips.join(', ')}。` +
            '执行通道由顶层 test-plan.md 声明，派生器不再拥有 skip 决策权；' +
            '任一 channel=hylyre case 无法编译时应报根因并让整份 Hylyre 计划不启动，而不是改成 skip。',
          suggestion:
            '删除派生 frontmatter / derive-manifest.json 的 explicit_skip_tc_ids，重新按 channel=hylyre 全集编译；' +
            '编译不了的 case 交回顶层计划作者改通道或补入口定义。',
        },
      ];
    }

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
          details: `派生 Hylyre 计划未覆盖顶层 test-plan.md 中的用例：${cov.missing.join(', ')}。请在派生表补全。执行责任由顶层 test-plan.md 的 execution_channel 声明，派生器没有 skip 决策权——不要登记 explicit_skip_tc_ids，改为按一次性迁移补齐「执行通道」列。\n${hintLine}`,
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

    // t7b（plan e6a3c9f4）：STEP 级静态门禁接入标准派生计划路径（与即席同强度）——
    // 非法根键/选择器形状/wait 误用在门禁层秒级拦下，不再只在真机执行时炸。
    // Static lint/selector/navigation facts are isolated from the runtime holder.
    const staticPlanGates = collectDeviceTestStaticPlanGates(ctx, derivedContent, topRaw);
    const { stepLint, selectorWarnings, navLint } = staticPlanGates;
    const stepBlockers = stepLint.violations.filter(v => v.severity === 'BLOCKER');
    if (stepBlockers.length > 0) {
      const hintPath = writeDeriveHintFromPlanJson(ctx, {
        ...hintBase,
        coverage_reason: 'invalid_derived_step_rules',
        lint_violations: stepBlockers,
      });
      const lines = stepBlockers.slice(0, 12).map(
        v => `  - [${v.rule_id}] ${v.tc_id}: ${v.message}${v.suggested_fix ? `（建议：${v.suggested_fix}）` : ''}`,
      );
      const hintLine = hintPath ? `机器步骤目录（allowed_step_roots / step_shape_catalog）见 ${hintPath}` : '';
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: [
            `派生 Hylyre 计划未通过步骤级静态门禁（${stepBlockers.length} 处，当前 lint 支持的规则集 STEP-001~007）：`,
            ...lines,
            stepBlockers.length > 12 ? `  …等共 ${stepBlockers.length} 处` : '',
            hintLine,
          ]
            .filter(Boolean)
            .join('\n'),
          suggestion:
            `按 details 逐条修正派生表「测试步骤」列；步骤根键与形状目录以 derive-hint-from-plan.json 的 ` +
            `allowed_step_roots / step_shape_catalog 为准（与本门禁同源）；语法细则深潜见 ${HYLYRE_PLANNED_STEP_FIELDS_REF}。`,
          source: 'derived_hylyre_step_lint',
        },
      ];
    }

    const selectorBlockers = staticPlanGates.selectorWarnings.filter(v => v.severity === 'BLOCKER');
    if (selectorBlockers.length > 0) {
      return [{
        id,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: [
          `派生 Hylyre 计划未通过 canonical selector 静态门禁（${selectorBlockers.length} 处）：`,
          ...selectorBlockers.slice(0, 12).map(v =>
            `  - [${v.rule_id}] ${v.tc_id} step ${v.step_index} ${v.selector_kind}=${v.selector}: ${v.message}`),
          'runtime dump/snapshot cache 不参与静态授权；请回 ui-spec/contracts 或按 acceptance 意图重新派生。',
        ].join('\n'),
        suggestion: '修正 canonical ui-spec 与正式派生计划的 selector；match 只允许显式 exact/contains，放宽须新 timestamp 重新派生。',
        source: 'derived_selector_contract',
      }];
    }

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

    // Static plan facts are independent of build/install/run. Keep this after all
    // static SSOT/lint/selector/nav checks so an install failure cannot hide an
    // already-invalid derived plan behind a whole-gate SKIP.
    if (!hapHolder.installPassed) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'device_test.install 未 PASS（或未执行成功），跳过真机自动化执行；静态派生计划已独立校验。',
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

    // T6 pre-run evidence capability: native CaseResult.steps[] is independent
    // of the legacy runtime telemetry bridge. Only an old provider may enter
    // the bounded bridge path; native 0.4.0 must never be monkey-patched.
    const acceptanceFlows = loadAcceptanceFlowsDoc(ctx.projectRoot, ctx.feature);
    const runtimeEvidenceRequired = Boolean(
      acceptanceFlows?.criteria.some(isP0DeviceInteractive),
    );
    if (runtimeEvidenceRequired) {
      let resolvedCapability: HylyreEvidenceCapability;
      try {
        resolvedCapability = probeDeviceTestEvidenceCapability(ctx, {
          hylyreVersion: ready.hylyreVersion,
          manifestVersion: ready.manifestVersion,
        }) as HylyreEvidenceCapability;
      } catch (error) {
        resolvedCapability = {
          mode: 'unsupported',
          native: false,
          legacy: false,
          providerId: 'hylyre',
          providerVersion: ready.hylyreVersion,
          reason: `native/legacy evidence handshake 失败：${(error as Error).message}`,
        };
      }
      hapHolder.hylyreEvidenceCapability = resolvedCapability;
      if (resolvedCapability.mode === 'unsupported') {
        return [{
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          blocking_class: 'externalBlocked',
          failure_kind: 'capability_missing',
          details:
            '【DEFERRED_CAPABILITY_MISSING】当前 device_test.run provider/profile 不支持 native CaseResult.steps[] 或受支持的 legacy bridge；' +
            `未启动真机内容执行。${resolvedCapability.reason}`,
          suggestion: '升级 Hylyre 至 native 最低版本并确认 ready meta 版本链一致后重跑 testing。',
        }];
      }
    }

    // plan b3d7e5a1 T4（codex P1）：bundle/page 与 lint、derive hint **同一来源**——安装候选 bundleName +
    // resolveMainAbilityForBundle 的静态层；不再用独立正则读 app.json5（JSON5 注释/尾逗号会分叉）。
    const resetIdentity = resolveHylyreResetIdentity(ctx.projectRoot);
    const bundleName = resetIdentity.identity?.bundle ?? loadAppInstallCandidateMeta(ctx.projectRoot).bundleName;
    // run-directory-freshness（plan 420a5005）：每次执行新建 `<timestamp>/hylyre/` 目录并
    // 原样复制选中的派生计划（含 derive-manifest.json）；本轮 report/trace/failures 全写
    // 新目录。原派生目录保持字节不变（只读输入）；目录冲突 fail-closed，不覆盖不复用。
    // 新目录 mtime 最新 → 既有选择器/evidence 消费者自然落在此目录，无需改消费者。
    const freshRun = prepareFreshHylyreRunDir({
      reportsBase,
      sourceHylyrePlanAbsPath: path.resolve(derivedPath),
    });
    if (!freshRun.ok) {
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `无法为本轮执行准备全新目录（run-directory-freshness）：${freshRun.error}`,
          suggestion: '勿复用/覆盖旧 timestamp 目录；清理冲突目录或等待下一轮新目录后重试。',
        },
      ];
    }
    const hylyreOutDir = freshRun.runDir;
    const runPlanPath = freshRun.hylyrePlanAbsPath;
    const derivedPlanSha256AtStart = sha256File(runPlanPath);
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
      derivedPlanPath: runPlanPath,
      topPlanPath: topPath,
      reportOutPath: path.resolve(path.join(hylyreOutDir, 'test-report.md')),
      traceOutPath: path.resolve(path.join(hylyreOutDir, 'trace.json')),
      bundleName,
      // 同一 resolved page 传给 run：lint 放行的前奏身份 == 预启实际使用的 ability（未解析时交给 run 自己的 bm dump 层）
      hypiumPageName: resetIdentity.identity?.page_name ?? null,
      deviceSn: process.env.HARNESS_HDC_TARGET,
      skipAssertExpected: true,
      coldRestart,
      appSnapshotCacheAbs,
    }) as HylyreRunResult;

    if (!run.ok) {
      // P1（三轮 review）：**设备锁屏且恢复失败是外部阻断，不是工具链问题**。
      // 二者的处置完全不同：前者「人解锁后重跑」，后者「查签名/环境」。此前一律标
      // device_toolchain，锁屏这个真因在结论层被抹掉，指引把人带向错误方向。
      // 与 UT 侧同一契约（externalBlocked/device_blocked → goal 归 external_block）。
      const deviceLocked = run.trace?.run_failure_kind === 'device_locked';
      return [
        {
          id,
          category: 'structure',
          description: desc,
          severity: 'BLOCKER',
          status: 'FAIL',
          // review#2：runner 崩溃（!run.ok）= 真机环境/工具链问题，非 UI/业务代码 → 标 device_toolchain，
          // 让 goal 失败分类归 toolchain（早 halt 修环境、勿误导改码）。下方"用例失败"路径不打此标 → code_regression。
          blocking_class: deviceLocked ? 'externalBlocked' : 'device_toolchain',
          ...(deviceLocked ? { failure_kind: 'device_blocked' } : {}),
          details: [
            deviceLocked
              ? `设备锁屏且自动恢复未完成（exit=${run.exitCode}）——请查看随附错误，按提示稍后重试或重新登记；也可人工解锁后重跑。`
              : `真机自动化执行失败：exit=${run.exitCode}`,
            `命令：${run.command}`,
            `日志：${run.logPath}`,
            ...run.errors.map(e => `  - ${e.message}`),
          ].join('\n'),
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
    let evidenceGate: HylyreEvidenceGateResult | null = null;
    if (runtimeEvidenceRequired) {
      const reportsDir = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
      const readyRecord = readJsonRecord(path.join(reportsDir, 'hylyre-ready.meta.json'));
      const hylyreCfg = resolveHylyreToolConfig(ctx.projectRoot);
      const manifestRecord = readJsonRecord(
        path.join(ctx.projectRoot, hylyreCfg.vendor_dir, 'release.manifest.json'),
      );
      const releaseManifestVersion =
        manifestRecord.value && typeof manifestRecord.value.hylyre_version === 'string'
          ? manifestRecord.value.hylyre_version
          : null;
      evidenceGate = evaluateHylyreNativeEvidenceGate({
        trace: run.trace,
        readyMeta: readyRecord.value,
        manifestVersion: releaseManifestVersion,
      });
      const binding = validateNativeTraceArtifactBinding({
        trace: run.trace,
        expectedFeature: ctx.feature,
        tracePath: run.tracePath ?? path.resolve(path.join(hylyreOutDir, 'trace.json')),
        testPlanPath: topPath,
        derivedPlanPath: runPlanPath,
        expectedTestPlanSha256: topPlanSha256AtStart,
        expectedDerivedPlanSha256: derivedPlanSha256AtStart,
      });
      if (binding.ok && binding.binding) hapHolder.nativeArtifactBinding = binding.binding;
      if (!binding.ok) evidenceGate = gateWithNativeBindingFailure(evidenceGate, binding);
      hapHolder.hylyreEvidenceGate = evidenceGate;
    }
    // inventory §一 G3：同 G1，schema 不匹配不再让门消失。
    const executionCompleteness = run.trace
      ? checkHylyreCaseExecutionCompleteness(ctx, run.trace, evidenceGate, runPlanPath)
      : [];
    const runGatePass = outcomeEval.verdict === 'pass' &&
      (evidenceGate === null || evidenceGate.native) &&
      executionCompleteness.every(result => result.status === 'PASS' || result.status === 'SKIP');

    // S6（visual-capability-truth P1-I）：级联归类三分——**不改变通过率/verdict**（BLOCKED_BY
    // 非 PASS：仍进分母、仍 FAIL），只把"1 根故障 + N 级联"如实呈现（20260718：7 FAIL 实为
    // 1 导航根故障级联）。SSOT=test-plan.md 顶层 test_case_flow YAML 块；无块 → 不归类。
    let cascadeLines: string[] = [];
    try {
      const planResolvedForFlow = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md');
      const planMd = fs.existsSync(planResolvedForFlow.actualPath)
        ? fs.readFileSync(planResolvedForFlow.actualPath, 'utf-8')
        : null;
      const parsedFlow = planMd ? parseTestCaseFlowBlock(planMd) : { flow: null };
      const failedIds = (run.trace?.cases ?? [])
        .filter(c => c.status === '失败' || c.status === '阻塞')
        .map(c => c.id)
        .filter((x): x is string => typeof x === 'string');
      if (parsedFlow.flow && failedIds.length > 0) {
        const triage = triageCascade(parsedFlow.flow, failedIds);
        cascadeLines = [
          `级联归类（root/blocked 三分——通过率与裁决不变）：根故障 ${[...triage.rootFails, ...triage.independentFails].join(', ') || '无'}；` +
          (triage.blocked.length > 0
            ? `级联 ${triage.blocked.map(b => `${b}(BLOCKED_BY ${triage.byCase[b].blocked_by})`).join(', ')}`
            : '无级联'),
        ];
      }
    } catch { /* 归类失败不影响门禁判定 */ }

    const out: CheckResult[] = [
      ...(selectorWarnings.length > 0
        ? [{
            id: 'derived_selector_contract',
            category: 'structure' as const,
            description: '派生 Hylyre selector 必须可追溯到 ui-spec',
            severity: selectorWarnings.some(v => v.severity === 'BLOCKER') ? 'BLOCKER' as const : 'MINOR' as const,
            status: selectorWarnings.some(v => v.severity === 'BLOCKER') ? 'FAIL' as const : 'WARN' as const,
            details: [
              `[SELECTOR-SPEC-001] 共 ${selectorWarnings.length} 个 canonical selector 问题：`,
              ...selectorWarnings.slice(0, 12).map(v =>
                `  - ${v.tc_id} step ${v.step_index} ${v.selector_kind}=${v.selector}: ${v.message}`),
            ].join('\n'),
            suggestion: '用 derive-hylyre-plan-hint 的 selector_contract 只读查询修正；dump/cache 发现的候选须先回写 ui-spec/锚点注入。',
            source: 'derived_selector_contract',
          }]
        : []),
      ...(evidenceGate
        ? [{
            id: 'hylyre_evidence_gate',
            category: 'structure' as const,
            description: 'Hylyre native CaseResult/StepResult 三重判据与 legacy 划界',
            severity: 'BLOCKER' as const,
            status: evidenceGate.native ? 'PASS' as const : 'FAIL' as const,
            ...evidenceGateFailureProjection(evidenceGate, hapHolder),
            structured: evidenceGate,
            details: evidenceGate.native
              ? `native evidence gate PASS：version=${evidenceGate.traceVersion}, schema=${evidenceGate.traceSchemaVersion}，CaseResult/StepResult 必需字段完整。`
              : [
                  `native evidence gate FAIL（mode=${evidenceGate.mode}）：旧 case status 不得贡献 verification=passed。`,
                  ...evidenceGate.reasons.map(reason => `  - ${reason}`),
                  '默认处置：升级 Hylyre 并重新执行 testing；历史 trace/evidence 保留不删。',
                ].join('\n'),
            suggestion: evidenceGate.native
              ? 'P0/acceptance 仅消费当前 trace 的 CaseResult.steps[]。'
              : '确认 installed/manifest/trace version 链、schema=0.4-p0 + hylyre.step-outcome/1 与所有 CaseResult/StepResult 字段后重跑 testing。',
          }]
        : []),
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
                ...executionCompleteness
                  .filter(result => result.status === 'FAIL')
                  .flatMap(result => (result.details ?? '').split('\n').map(line => `  - ${line}`)),
                ...cascadeLines.map(l => `  - ${l}`),
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
          // c4e8b1d3 Todo 3：nav 校验 / identity 解析 / capture 的 target 集合统一在
          // runDeviceVisualDiffCapture 内（入口级接线），此处只装配设备传输面（hylyre
          // 构建器）；单测在入口注入 mock 传输面，禁止直注 captureVisualDiff opts（goldenTargets）。
          out.push(...runDeviceVisualDiffCapture(ctx, hapHolder, {
            bundleName,
            deviceSn: process.env.HARNESS_HDC_TARGET,
            screenshotFn: buildHylyreVisualDiffScreenshotFn({
              pythonPath: ready.pythonPath,
              hypiumWorkDir,
              deviceSn: process.env.HARNESS_HDC_TARGET,
              logPath: run.logPath,
            }),
            // t2（plan c6d8f2b4）：截图同时点 dump 布局树（layout-<screen_id>.json），T8 几何不变量消费。
            // 轻量化守恒（rev8/D11）：仅 pixel_1to1 档采集——semantic_layout/reference_only 不付
            // 每屏 dump-ui 设备调用成本（T8 对低档本就只 WARN 观察，重量跟着保真承诺走）。
            layoutDumpFn: isPixel1to1(ctx)
              ? buildHylyreLayoutDumpFn({
                  pythonPath: ready.pythonPath,
                  hypiumWorkDir,
                  deviceSn: process.env.HARNESS_HDC_TARGET,
                  logPath: run.logPath,
                })
              : undefined,
            // 与 device_test.run 的 app 启动方式对齐（宿主热修回收，round6 收尾批 P0-3）
            navExecutorFn: buildHylyreNavExecutorFn({
              pythonPath: ready.pythonPath,
              hypiumWorkDir,
              deviceSn: process.env.HARNESS_HDC_TARGET,
              bundleName,
              logPath: run.logPath,
              ...readDeviceTestRunHylyreNavOpts(run.logPath),
            }),
          }));
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

/**
 * c4e8b1d3 Todo 3（golden/nav/capture target 集合统一入口）：
 * device_test.run 成功后的 visual_diff 自动采集。
 *
 * - nav 校验 / identity 解析 / capture **共用同一份**解析后 canonical target 集合：
 *   `P0 targets ∪ golden positive capture targets ∪ golden forbidden nav targets`
 *   （golden 模式）；普通模式（env 未设）target 集合 = 纯 P0，行为逐字节不变
 *   （普通 P1 屏写进 nav 配置仍判「多余/错写屏名」，不全局扩面采集）。
 * - golden contract **只解析一次**（loadGoldenContractFromEnv，单次 JSON.parse），
 *   解析结果显式传入 capture（goldenTargets/goldenForbidden）——nav 校验、identity
 *   解析与 capture 不各自读 env，绝不会得到不同集合。
 * - golden target 缺失 / 形态漂移 → 在本入口 fail-closed（不得借跳过 nav 校验解决，
 *   也不静默）; slug 冲突继续由 capture 层 fail-closed（t2b 既有行为不变）。
 * - 设备传输面（screenshotFn/layoutDumpFn/navExecutorFn）由调用方装配=hylyre 构建器；
 *   单测在**入口**注入 mock 传输面走真实接线（禁止直注 captureVisualDiff opts）。
 */
export interface DeviceVisualDiffCaptureDevices {
  bundleName: string;
  deviceSn?: string;
  screenshotFn: VisualDiffScreenshotFn;
  layoutDumpFn?: VisualDiffLayoutDumpFn;
  navExecutorFn?: VisualDiffNavExecutorFn;
}

export function runDeviceVisualDiffCapture(
  ctx: CheckContext,
  hapHolder: DeviceTestPipelineHolder,
  devices: DeviceVisualDiffCaptureDevices,
): CheckResult[] {
  const id = 'visual_diff_capture';
  // round5 P1-A：有固化 nav 配置则按屏导航到位再截（根除多屏截同一帧）。
  // S2 P0-C（visual-capability-truth）：升 2.0 归一读取——identity 锚点随屏配置；
  // pixel_1to1 下目标屏须有已确认 identity（proposed 候选不作数）。
  const navConfigV2 = loadVisualDiffNavConfigV2(ctx.projectRoot, ctx.feature);
  const navConfig = navConfigV2 ? toLegacyNavConfig(navConfigV2) : null;
  // P1-A fail-fast（消费 validateNavConfigV2，不静默裸采）：≥2 目标屏须导航区分；
  // 缺配置/配置不一致=明确失败，不进 capture（防误导 PASS）。
  const navUiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const p0TargetIds = collectP0VisualTargetIds(navUiDoc);
  // c4e8b1d3 Todo 3：golden contract 只解析一次，解析后的 canonical target 集合
  // 同时供 nav 校验、identity 解析与 capture（显式传入 goldenTargets/goldenForbidden）。
  // 不得拼 raw contract 名称（否则又是一处双真源）；forbidden（HomeTab）必须进
  // nav 到达集合——负向证据同样需要导航步骤，只采 positive 会漏负向证据目标。
  const goldenEnv = loadGoldenContractFromEnv(ctx.projectRoot);
  const goldenTargets = goldenEnv.targets;
  const goldenForbidden = goldenTargets === null ? [] : goldenEnv.forbidden;
  const goldenRes = goldenTargets ? resolveGoldenCaptureTargets(navUiDoc, goldenTargets) : null;
  const goldenNavTargetIds = goldenRes
    ? [...collectGoldenPositiveTargetIds(goldenRes), ...goldenForbidden.map(f => f.id)]
    : [];
  const navTargetIds = [...new Set([...p0TargetIds, ...goldenNavTargetIds])];
  const navValidation = navConfigV2
    ? validateNavConfigV2(navConfigV2, navTargetIds, {
        // plan f6b2d9a4 P0-1：hard contract 要求已冻结的 identity 机器锚点；
        // best_effort 保留 advisory，执行类采集仍看 pixel target。
        requireConfirmedIdentity: isHardPixelContract(ctx),
      })
    : null;
  // goal-fakepass-hardening t7：nav 配置缺失/非法=完备性 BLOCKER，与保真档位脱钩
  // （bc-openCard 洞④：semantic_layout 下 fidelityRatchet 把缺 nav 降成 WARN，
  //  9 个 P0 屏的视觉比对被静默吞掉——nav 配置是 agent 可产出的普通 artifact，
  //  缺失属"活没干完"而非保真严格度问题）；门槛从 ≥2 改为 ≥1（单屏不逃）。
  const goldenGateErrors = goldenRes
    ? goldenRes.failures.map(f => `golden_contract:${f.declared}: ${f.reason}`)
    : [];
  const navGateError = goldenGateErrors.length > 0
    ? `golden contract 解析失败（fail-closed——declared 缺失/形态漂移不得静默跳过）：${goldenGateErrors.join('；')}`
    : navConfig
      ? (navValidation && !navValidation.ok
          ? `nav 配置与 ui-spec 屏集不一致/步骤非法：${navValidation.errors.slice(0, 6).join('；')}${navValidation.errors.length > 6 ? '…' : ''}`
          : null)
      : (navTargetIds.length >= 1
          ? `缺固化 nav 配置：${navTargetIds.length} 个目标屏（P0 ∪ golden 显式目标，含 forbidden 负向屏）须按屏导航到位采集（≥2 屏另防多屏截同一帧）`
          : null);
  if (navGateError) {
    return [
      {
        id,
        category: 'structure',
        description: 'device_test.run 后 visual_diff 自动截图与骨架采集',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `【nav 配置门禁·完备性（档位无关）】${navGateError}\n不静默裸采（防多屏截同一帧）；补齐 device-testing/visual-diff-nav.json（key=屏标识含 overlay、value=touch/wait_for/back 到达步骤）后重跑。真到不了的屏用 unreachable 显式登记（仅限外部阻塞枚举+绑定失败证据），任一 P0 unreachable → run 封顶非成功状态。`,
        suggestion: '为每个 P0/target 屏（含 overlay）写固化到达步骤；页面结构无变化则复用、不需重生成。',
      },
    ];
  }

  // P0-9a：当前构建指纹现算自实际安装 hap（hapHolder.hapPath 即 build→install 的产物）；
  // 算不出=null → capture 一律不跳采（codex 硬前提）。
  const currentBuildFingerprint = computeHapBuildFingerprint(hapHolder.hapPath);
  const specMd = loadSpecMarkdown(ctx.projectRoot, ctx.feature);
  const cap = captureVisualDiff({
    projectRoot: ctx.projectRoot,
    feature: ctx.feature,
    specMd,
    ctx,
    computeScoreFloor: true,
    currentBuildFingerprint,
    bundleName: devices.bundleName,
    deviceSn: devices.deviceSn,
    screenshotFn: devices.screenshotFn,
    ...(devices.layoutDumpFn
      ? {
          layoutDumpFn: devices.layoutDumpFn,
          // t4b（f7a3d9c2，2026-07-11 bc-openCard 真机双拍数据回填后启用）：静稳采样
          // ——与 layoutDumpFn 同守卫（生产仅在 pixel_1to1 装配）；实测 5/8 屏整图 hash
          // 漂移而 app 裁剪判据 8/8 稳、动效屏 3 组内收敛（默认重试 2 已够）。
          quiescenceSampling: true,
        }
      : {}),
    ...(navConfig && devices.navExecutorFn ? { navConfig, navExecutorFn: devices.navExecutorFn } : {}),
    // S2 P0-C：identity gate 输入（proposed 候选由 capture 层跳过；pixel 强制在上方校验层）。
    // 与 nav 校验共用 navTargetIds——identity 解析消费的集合与 nav/capture 相同。
    ...(navConfigV2
      ? { screenIdentity: resolveIdentityForTargets(navConfigV2, navTargetIds) }
      : {}),
    // c4e8b1d3 Todo 3：解析结果显式传给 capture（capture 不再各自重读 env）
    ...(goldenTargets ? { goldenTargets } : {}),
    ...(goldenForbidden.length > 0 ? { goldenForbidden } : {}),
  });
  const p0Failed = cap.p0CaptureFailures ?? [];
  // t4（plan f3a8c6d2）：把"哪些缺屏属内容可行动"注入 ctx，供随后的 visual diff
  // 熔断资格判定消费（同 run 内存传递，比照 refElementsManifest；不落盘、无新协议）。
  //
  // t4（plan f3a8c6d2）：熔断资格由 capture **单点**裁决，此处只做透传。
  // 不再扫 CheckResult 分类反推——那条路四版都漏（device 阻断的 id 是参数化的、
  // run.ok=false 写的是 device_toolchain、build/install/ready 多数连字段都没有）。
  ctx.visualFuseEligibility = cap.fuseEligibility;
  // P0-9c："新鲜"重定义——build 指纹有效的跳采（screensPreservedBuildValid）＝合法新鲜，
  // 不算陈旧证据；stalePreserved 只拦"未刷新且非 build 有效"的 preserved（采集失败回退
  // 旧 json / legacy 无指纹 preserved 照旧 FAIL，反陈旧证据语义不丢）。
  const preservedBuildValid = cap.screensPreservedBuildValid ?? 0;
  const stalePreserved = cap.screensWritten === 0 && (cap.screensPreserved ?? 0) > 0;
  if (cap.ok && (p0Failed.length > 0 || stalePreserved)) {
    // E1/E2：P0 截图失败 / 全靠 preserved 旧证据充数 → 不得静默 PASS（pixel_1to1 FAIL，否则 blocking WARN）。
    // 宿主 homepage 实测：6 屏全 Permission denied、screens=0+preserved=1 仍 PASS，等于在陈旧/错图上闭环。
    const ratchet = fidelityRatchetFailOrWarn(ctx, true);
    return [
      {
        id,
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
      },
    ];
  }
  if (cap.ok) {
    return [
      {
        id,
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
      },
    ];
  }
  if (cap.skippedReason !== 'no_p0_targets') {
    // E1：no_captures（全失败）或有 P0 截图失败 → pixel_1to1 FAIL，否则 WARN；
    // 纯环境缺失（如 no_screenshot_fn）维持 WARN（与 degraded 同档）。
    const captureFailed =
      cap.skippedReason === 'no_captures' || (cap.p0CaptureFailures?.length ?? 0) > 0;
    const ratchet = captureFailed
      ? fidelityRatchetFailOrWarn(ctx, true)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    return [
      {
        id,
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
      },
    ];
  }
  return [];
}

/** Test seam: static derived-plan validation must happen before install-based runtime SKIP. */
export function __testing_checkDeviceTestRunGateBeforeInstall(ctx: CheckContext): CheckResult[] {
  return checkDeviceTestRunGate(ctx, {
    hapPath: null,
    installPassed: false,
    installExternallyBlocked: false,
    buildReused: false,
    hylyreTracePath: null,
    deviceTestRunExecuted: false,
    installExecuted: false,
    installOk: false,
    hapSha256Full: null,
  });
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

  const reconChannelDecl = loadExecutionChannelDeclaration(ctx);
  const recon = reconcileReportWithHylyreTrace(
    report,
    tracePath,
    reconChannelDecl.column_declared ? { hylyreTcIds: reconChannelDecl.hylyre_tc_ids } : undefined,
  );

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

function checkHylyreCaseExecutionCompleteness(
  ctx: CheckContext,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
  derivedPlanPath?: string | null,
): CheckResult[] {
  const id = 'testing_case_execution_completeness';
  const description = '顶层测试用例执行完整性';
  // plan a6c4e9f2 T7a：这是 inventory §一 G4 点名的 fail-open 反例——旧实现在
  // schema 不匹配或 gate 非 native 时 `return []`，等于让这道 required gate 静默消失。
  // 现在统一走 dispatch：不是合法 v1 一律显式 BLOCKER。
  if (!trace) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      details: 'authoritative trace 缺失，无法证明顶层 TC 已执行。',
      suggestion: '用同一 native run 重新产出 trace；不得从 telemetry/log 合成执行事实。',
    }];
  }
  const gateVerdict = requireV1ForGate(trace, { frameworkRoot: ctx.frameworkRoot });
  if (!gateVerdict.ok) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      failure_kind: 'unsupported_result_protocol',
      details: gateVerdict.detail,
      suggestion: gateVerdict.suggestion,
    }];
  }
  if (evidenceGate && !evidenceGate.native) {
    return [{
      id, category: 'structure', description, severity: 'BLOCKER', status: 'FAIL',
      details: `native evidence gate 未通过，执行完整性无法闭合：${evidenceGate.reasons.join('；')}`,
      suggestion: '先修复 version/schema/字段三重判据再重跑；此门不因 gate 未通过而消失。',
    }];
  }
  const topPlanPath = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'test-plan.md').actualPath;
  const topIds = fs.existsSync(topPlanPath)
    ? extractTcIdsFromPlanTable(fs.readFileSync(topPlanPath, 'utf-8')).map(value => value.toUpperCase())
    : [];
  const reportsBase = featurePhaseReportsDir(ctx.projectRoot, ctx.feature, ctx.phase, ctx.frameworkRoot);
  const selected = derivedPlanPath && fs.existsSync(derivedPlanPath)
    ? { path: derivedPlanPath, content: fs.readFileSync(derivedPlanPath, 'utf-8') }
    : (() => {
        const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
        return pick.selected ? { path: pick.selected.hylyrePath, content: pick.selected.content } : null;
      })();
  const derivedIds = selected
    ? extractTcIdsFromPlanTable(selected.content).map(value => value.toUpperCase())
    : [];
  const explicitSkipIds = selected
    ? loadExplicitSkipTcIds(selected.path, selected.content).map(value => value.toUpperCase())
    : [];
  const traceIds = (trace?.cases ?? [])
    .map(value => typeof value.id === 'string' ? value.id.trim().toUpperCase() : '')
    .filter(Boolean);
  // plan a6c4e9f2 T3：derived/trace 的**精确集合**只与 channel=hylyre 子集闭合。
  // 非 Hylyre 通道的 TC 仍留在报告总分母，但它们的裁决在
  // `testing_channel_evidence_obligation`——per-TC 证据绑定建立前一律 FAIL/UNVERIFIED，
  // 这里不得暗示它们"已由各自证据链裁决"（同一份报告内不能自相矛盾）。
  const channelDecl = loadExecutionChannelDeclaration(ctx);
  const channelScoped = channelDecl.column_declared;
  const expectedIds = channelScoped ? channelDecl.hylyre_tc_ids : topIds;
  const topSet = new Set(topIds);
  const derivedSet = new Set(derivedIds);
  const traceSet = new Set(traceIds);
  const missingFromTrace = expectedIds.filter(value => !traceSet.has(value));
  const extraInTrace = traceIds.filter(value => !topSet.has(value));
  const offChannelInTrace = channelScoped
    ? traceIds.filter(value => topSet.has(value) && !expectedIds.includes(value))
    : [];
  const missingFromDerived = channelScoped
    ? expectedIds.filter(value => !derivedSet.has(value))
    : topIds.filter(value => !derivedSet.has(value) && !explicitSkipIds.includes(value));
  const details: string[] = [];
  if (!trace) details.push('authoritative trace 缺失，无法证明顶层 TC 已执行');
  if (!selected) details.push('缺 authoritative derived plan，无法核对执行集合');
  if (missingFromDerived.length > 0) {
    const laundered = missingFromDerived.filter(value => explicitSkipIds.includes(value));
    details.push(
      channelScoped
        ? `derived plan 缺少 channel=hylyre 的 TC：${missingFromDerived.join(', ')}` +
          (laundered.length > 0 ? `（其中 ${laundered.join(', ')} 被 explicit skip 洗掉——skip 不减除缺口）` : '')
        : `derived plan 缺少未登记 skip 的顶层 TC：${missingFromDerived.join(', ')}`,
    );
  }
  if (missingFromTrace.length > 0) {
    const explicitMissing = missingFromTrace.filter(value => explicitSkipIds.includes(value));
    const otherMissing = missingFromTrace.filter(value => !explicitSkipIds.includes(value));
    if (explicitMissing.length > 0) details.push(`explicit skip/未执行且无 StepResult：${explicitMissing.join(', ')}`);
    if (otherMissing.length > 0) {
      details.push(
        channelScoped
          ? `channel=hylyre 的 TC 未进入 authoritative trace：${otherMissing.join(', ')}`
          : `顶层 TC 未进入 authoritative trace：${otherMissing.join(', ')}`,
      );
    }
  }
  if (extraInTrace.length > 0) details.push(`trace 含顶层计划外 TC：${extraInTrace.join(', ')}`);
  if (offChannelInTrace.length > 0) {
    details.push(`trace 含非 channel=hylyre 的 TC：${offChannelInTrace.join(', ')}（通道由顶层声明，执行侧不得改写）`);
  }
  if (channelScoped && channelDecl.manual_tc_ids.length > 0) {
    details.push(
      `manual 通道 TC 无机器证据载体，持续留在分母 FAIL/UNVERIFIED：${channelDecl.manual_tc_ids.join(', ')}`,
    );
  }
  const ok = details.length === 0;
  const nonHylyreNote = channelScoped
    ? `；非 Hylyre 通道 ${topIds.length - expectedIds.length} 个仍在报告总分母，由 testing_channel_evidence_obligation 裁决（per-TC 证据绑定建立前保持 FAIL/UNVERIFIED）`
    : '';
  return [{
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: ok ? 'PASS' : 'FAIL',
    details: ok
      ? `derived/trace 与 ${channelScoped ? 'channel=hylyre' : '顶层'} TC 集合已精确闭合（${expectedIds.length} 个）；` +
        `explicit skip 为 0，未执行 case 为 0${nonHylyreNote}。`
      : [
          '任何应执行的 TC（含 P1/P2）缺失 trace CaseResult 都保持 testing FAIL；不从名称/AC/散文推断原因。',
          ...details.map(value => `  - ${value}`),
        ].join('\n'),
    suggestion: ok
      ? '继续消费同一 trace 的 CaseResult.steps[]。'
      : '补齐同一最终 run 的 CaseResult；explicit skip 不能绕过 testing FAIL，只有 trace 内机器 capability failure 才走 capability defer。',
  }];
}

/**
 * tasks 6.5b 返修：证据义务门已从声明门里独立出来，且**必须在 visual 之后**执行。
 * 测试入口跟着分开——把它仍挂在声明门上，等于把"时序"这条判据本身测没了。
 */
export function __testing_checkChannelEvidenceObligation(
  ctx: CheckContext,
  plan: string | null,
  priorResults: readonly CheckResult[] = [],
  hapPath?: string | null,
): CheckResult[] {
  return checkChannelEvidenceObligation(ctx, plan, priorResults, hapPath);
}

export function __testing_checkExecutionChannelDeclaration(
  ctx: CheckContext,
  plan: string | null,
): CheckResult[] {
  return checkExecutionChannelDeclaration(ctx, plan);
}

export function __testing_checkHylyreCaseExecutionCompleteness(
  ctx: CheckContext,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
  derivedPlanPath?: string | null,
): CheckResult[] {
  return checkHylyreCaseExecutionCompleteness(ctx, trace, evidenceGate, derivedPlanPath);
}

/**
 * 三道随 v1 一起收紧的 required gate 的测试入口。
 *
 * 它们各自的 `evidenceGate` 参数有一个容易踩的语义：`null/undefined` 表示
 * **本 feature 没有 P0 device AC，三重身份门不适用**（gate 只在
 * `runtimeEvidenceRequired` 为真时生成），而不是"协议非法"。
 * 曾经把 null 当失败处理，结果是"没有 P0 AC 但确实跑了合法 v1"的 feature 平白吃三条
 * BLOCKER——因此这三个入口一起导出，回归必须把这条口径钉住。
 */
export function __testing_checkHylyreV1RequiredGates(
  ctx: CheckContext,
  tracePath: string | null,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
  derivedPlanPath?: string | null,
): CheckResult[] {
  return [
    ...checkHylyreArtifactIntegrity(ctx, tracePath, trace, evidenceGate),
    ...checkHylyreFailureRouting(ctx, trace, evidenceGate, derivedPlanPath),
    ...checkHylyreRuntimeSelectorGate(ctx, trace, evidenceGate, derivedPlanPath),
  ];
}

/** tasks 6.6b 回归入口：直接取责任路由/disposition 的 CheckResult 形状。 */
export function __testing_checkHylyreFailureRouting(
  ctx: CheckContext,
  trace: HylyreTrace | null,
  evidenceGate: HylyreEvidenceGateResult | null | undefined,
  derivedPlanPath?: string | null,
): CheckResult[] {
  return checkHylyreFailureRouting(ctx, trace, evidenceGate, derivedPlanPath);
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

/**
 * plan a6c4e9f2 T3：顶层执行通道声明门。
 * - 缺列/缺值/非法值 → BLOCKER（一次性迁移；harness 不猜通道）。
 * - manual 在场 → 显式记为未自动取证义务：manual 没有机器质量 PASS 载体，
 *   这些 TC 持续留在分母 FAIL/UNVERIFIED，本 feature testing 因此无法 PASS。
 *   这里就是它的"载体"，且刻意不提供任何人工提交入口/receipt/resume。
 */
/**
 * plan a6c4e9f2 T3（review P1）：设备流水线准入的**唯一**判据。
 * - report-only 按契约零设备/零 provider 调用，无论声明是否闭合都完整只读重算
 *   （通道迁移 BLOCKER 已独立记账，phase 仍 FAIL；历史 run 必须保持可诊断）；
 * - 其余情况必须先看 `decl.ok`：缺列/缺值/非法值/同 TC 重复一律不进 build/install/
 *   Hylyre/device，也**不跑"合法子集"**（那会产出半份 trace）。
 */
export function shouldRunDevicePipeline(
  declaration: { ok: boolean },
  reportReconcileOnly: boolean,
): { device: boolean; reportOnly: boolean } {
  if (reportReconcileOnly) return { device: false, reportOnly: true };
  return { device: declaration.ok, reportOnly: false };
}

function checkExecutionChannelDeclaration(ctx: CheckContext, plan: string | null): CheckResult[] {
  const id = 'testing_execution_channel';
  const description = '顶层 test-plan 每 TC 唯一编译期 execution_channel';
  const decl = loadExecutionChannelDeclaration(ctx, plan);
  const results: CheckResult[] = [];
  results.push({
    id,
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: decl.ok ? 'PASS' : 'FAIL',
    ...(decl.ok ? {} : { failure_kind: 'plan_contract' as const }),
    details: decl.ok
      ? `通道声明完整：hylyre=${decl.hylyre_tc_ids.length}、visual=${decl.visual_tc_ids.length}、` +
        `provider=${decl.provider_tc_ids.length}、manual=${decl.manual_tc_ids.length}。` +
        `派生器只编译 hylyre 集合，不得新增/删除/改写通道。`
      : decl.detail,
    suggestion: decl.ok
      ? '通道属计划 identity：修改必须经 test-plan review，不在 derive/回灌时静默重写。'
      : `在顶层 test-plan.md「测试用例」表补「执行通道」列，每条 TC 取值 ${EXECUTION_CHANNEL_DOMAIN}；由测试计划作者决定并进入 review。`,
  });
  // plan a6c4e9f2 §2.2「未取证不通过」（review P0）：非 Hylyre 通道的 TC 已被移出
  // derived/trace/timing 的精确对账，如果这里不给它们一个**裁决**载体，它们就只剩报告
  // 里一行自填状态——那正是把"通道分派"变成新逃生口。因此 fail-closed：
  //   - manual：设计上就没有机器质量 PASS 载体；
  //   - visual / provider：Maison 当前没有 per-TC 的证据绑定（既没有 TC→visual target，
  //     也没有 TC→capability evidence 的机器映射），无法证明某条 TC 已取证。
  // 三者一律留在分母 FAIL/UNVERIFIED。要让它们能通过，得先建立 per-TC 证据绑定
  // （T3 未完成项），而不是靠报告行自称通过。
  // 证据义务**不在这里**：它必须晚于 visual 产出与 visual 门本身
  // （详见 checkChannelEvidenceObligation 的注释）。本函数只管"通道声明是否合法"。
  return results;
}

/**
 * 非 Hylyre 通道 TC 的机器证据义务（tasks 6.5b；返修：外部 review 查出三处错）。
 *
 * **执行时点是判据的一部分**：第一版把它塞在 `checkExecutionChannelDeclaration` 里，
 * 而那道门跑在 build / device / visual capture **之前**——真正的 visual diff 要晚得多。
 * 结果是它只可能消费上一轮的旧文件，根本证明不了本轮结果。现在独立成门，
 * 由主链在 visual 检查之后调用，并把**本轮 `visual_diff` 的实际结论**传进去；
 * 该结论不是 PASS 就没有本轮视觉证据可消费。
 *
 * 另外两处返修见 `execution-channel-evidence.ts` 头注：读错路径、自造弱解析器。
 */
function checkChannelEvidenceObligation(
  ctx: CheckContext,
  plan: string | null,
  priorResults: readonly CheckResult[],
  hapPath?: string | null,
): CheckResult[] {
  const decl = loadExecutionChannelDeclaration(ctx, plan);
  const nonHylyreCount =
    decl.manual_tc_ids.length + decl.visual_tc_ids.length + decl.provider_tc_ids.length;
  if (nonHylyreCount === 0) return [];

  const visualGate = [...priorResults].reverse().find(r => r.id === 'visual_diff');
  const bindings = bindChannelEvidence({
    planMd: plan,
    acceptance: loadAcceptanceFlowsDoc(ctx.projectRoot, ctx.feature),
    visual: loadVisualScreenVerdicts({
      projectRoot: ctx.projectRoot,
      feature: ctx.feature,
      currentBuildFingerprint: hapPath ? computeHapBuildFingerprint(hapPath) : null,
      visualGateStatus: visualGate?.status ?? null,
    }),
    visualTcIds: decl.visual_tc_ids,
    providerTcIds: decl.provider_tc_ids,
    manualTcIds: decl.manual_tc_ids,
  });
  const blocking = bindings.filter(b => b.verdict.kind !== 'covered');
  const covered = bindings.filter(b => b.verdict.kind === 'covered');
  return [{
    id: 'testing_channel_evidence_obligation',
    category: 'structure',
    description: '非 Hylyre 通道 TC 的机器证据义务',
    severity: 'BLOCKER',
    status: blocking.length === 0 ? 'PASS' : 'FAIL',
    ...(blocking.length === 0 ? {} : { failure_kind: 'testing_channel_unverified' as const }),
    details: blocking.length === 0
      ? [
          `非 hylyre 通道 ${covered.length} 条 TC 全部由机器证据闭合：`,
          ...covered.map(b => `  - [${b.channel}] ${b.verdict.detail}`),
        ].join('\n')
      : [
          '以下 TC 声明为非 hylyre 通道，但未由机器证据闭合，',
          '因此留在分母 FAIL/UNVERIFIED，本 feature 的 testing 无法 PASS：',
          ...blocking.map(b => `  - [${b.channel}/${b.verdict.kind}] ${b.tc_id}：${b.verdict.detail}`),
          ...(covered.length > 0
            ? ['', `已闭合 ${covered.length} 条：${covered.map(b => b.tc_id).join(', ')}`]
            : []),
        ].join('\n'),
    suggestion: blocking.length === 0
      ? 'visual 通道的结论来自本轮 visual-diff.json 的逐屏 verdict + 截图 hash/build 指纹复核；'
        + '改结论必须重跑视觉采集，不得改报告行或手改 JSON。'
      : '短期：把确实要在本轮验证的 TC 改回 execution_channel=hylyre 并补齐可执行步骤，'
        + '或补齐 visual 通道所缺的「关联 AC」/checkpoint 屏声明/本轮视觉产物。'
        + `provider 通道：${PROVIDER_EVIDENCE_CONTRACT}`
        + '任何情况下都不接受人工确认、confirmed_by、质量 receipt 或 manual resume 作为本轮通过证据。',
  }];
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

/**
 * plan ab072691 t5①：delegated 轮次的 provider 评审调度。
 *
 * 返回 null = **本机制整体不激活**（native/blind、profile 未提供实现、或无目标屏）——
 * 调用方照常走既有严格 dispatch，行为逐字等于本改动前。
 * 返回 `unusable` = provider 不可用/载荷无效 → 调用方按 release requirement 与失败种类投影。
 *
 * vision_mode 只从**冻结快照**读：它由 preflight 派生一次、run 内不可变；gate 进程不得
 * 自行重探、更不得因 provider 调用结果反向改写它。
 */
async function runDelegatedVisualProviderReview(
  ctx: CheckContext,
): Promise<
  { kind: 'unusable'; outcome: 'unavailable' | 'invalid'; reason: string } |
  { kind: 'other' } |
  null
> {
  try {
    const snap = loadCapabilitySnapshot(ctx.projectRoot, ctx.feature);
    if (snap?.vision_mode !== 'delegated') return null;
    const fn = resolveVisualProviderReview(ctx);
    if (!fn) {
      // profile 没有实现只读评审：本轮等于没有可用 provider；只有既有 release
      // policy 明确不要求的视觉项可 advisory，其余沿 external capability carrier defer。
      return {
        kind: 'unusable',
        outcome: 'unavailable',
        reason: `project_profile=${ctx.resolvedProfile.name} 未提供只读视觉 provider 评审实现`,
      };
    }
    const frameworkRoot = detectRepoLayout(__dirname).frameworkRoot;
    const outcome = (await fn(ctx, { frameworkRoot })) as
      | { kind: 'skipped'; reason: string }
      | { kind: 'applied' }
      | { kind: 'unusable'; outcome: 'unavailable' | 'invalid'; reason: string };
    if (outcome?.kind === 'unusable') {
      return { kind: 'unusable', outcome: outcome.outcome, reason: outcome.reason };
    }
    return { kind: 'other' };
  } catch (e) {
    // 接线异常表示本轮 provider 不可用；由统一投影区分 advisory 与 release-required。
    return {
      kind: 'unusable',
      outcome: 'unavailable',
      reason: `provider 评审接线异常：${(e as Error).message}`,
    };
  }
}

export function projectDelegatedVisualProviderFailure(
  ctx: CheckContext,
  outcome: 'unavailable' | 'invalid',
  reason: string,
  description: string,
): CheckResult {
  const base: CheckResult = {
    id: 'visual_diff',
    category: 'structure',
    description,
    severity: 'BLOCKER',
    status: 'SKIP',
    structured: { kind: 'visual_provider_round', outcome, reason },
    details: '',
  };

  if (outcome === 'invalid') {
    return {
      ...base,
      status: 'FAIL',
      failure_kind: 'visual_provider_invalid_evidence',
      details:
        `【delegated 视觉委托】provider 已执行但本轮证据不可采信（invalid）：${reason}\n` +
        '该结果属于 evidence 产出失败，保持 testing FAIL 并走既有 retry/fuse；不得伪装成能力缺失或沿用旧 PASS。',
      suggestion: '修复 provider 输出、身份/hash/freshness 或工作区完整性后重跑 testing。',
    };
  }

  const visualApplicable = resolveUiRelevanceForRun(ctx.projectRoot, ctx.feature, null);
  const releaseRequired = projectAxisRequiredForRelease('visual', visualApplicable);
  if (isHardPixelContract(ctx) || releaseRequired) {
    return {
      ...base,
      status: 'FAIL',
      blocking_class: 'externalBlocked',
      failure_kind: 'capability_missing',
      details:
        `【DEFERRED_CAPABILITY_MISSING】发布必需的视觉轴所需 provider 本轮不可用：${reason}\n` +
        '复用既有 external/capability-missing 投影，当前内容不重试，也不请求人工签字。',
      suggestion: '恢复当前冻结 provider/profile 的视觉能力后 resume；无需修改产品内容。',
    };
  }

  return {
    ...base,
    details:
      `【delegated 视觉委托】非发布必需的 provider 本轮不可用：${reason}\n` +
      'provider-dependent 视觉证据保持 SKIP/UNVERIFIED advisory；确定性视觉红线仍继续执行。',
  };
}

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
      installExecuted: false,
      installOk: false,
      hapSha256Full: null,
    };
    // plan a6c4e9f2 T3（review P1）：通道声明是**编译期分派**，必须在任何 build/install/
    // Hylyre/device 动作之前解析一次。否则"缺列 / 缺值 / 非法值 / 同 TC 重复"这类计划
    // 契约错误会在烧掉一次真机 run 之后才被报出来，且期间只跑了合法子集，产出半份 trace。
    // decl.ok=false 时零设备动作，只产结构化 BLOCKER。
    results.push(...safeRun(() => checkExecutionChannelDeclaration(ctx, plan), 'testing_execution_channel'));
    const channelDeclaration = loadExecutionChannelDeclaration(ctx, plan);
    // 声明未闭合时，被拦的是**设备动作**，不是全部分析。report-only 按契约零设备/零 provider
    // 调用，因此照常完整重算——通道迁移的 BLOCKER 已由上面那条 check 独立记账，phase 仍然 FAIL，
    // 不需要顺手把只读重算也关掉（那会让历史 run 连诊断都跑不了）。
    const pipelinePlan = shouldRunDevicePipeline(channelDeclaration, Boolean(ctx.reportReconcileOnly));
    if (pipelinePlan.reportOnly) {
      results.push(...checkReportReconcileOnlyPipeline(ctx, deviceTestHapHolder, plan, report));
    } else if (!pipelinePlan.device) {
      results.push({
        id: 'device_test_run',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'device_test_run'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details:
          '顶层 execution_channel 声明未闭合，已在任何 build/install/device 动作之前停下（零设备调用）。\n' +
          channelDeclaration.detail,
        suggestion: `先修好顶层 test-plan.md 的执行通道声明（${EXECUTION_CHANNEL_DOMAIN}）再跑 testing；harness 不按用例文字猜通道，也不会只跑"合法子集"。`,
      });
    } else {
      results.push(...checkDeviceTestBuildGate(ctx, deviceTestHapHolder));
      results.push(...checkDeviceTestInstallGate(ctx, deviceTestHapHolder));
      results.push(...checkDeviceTestRunGate(ctx, deviceTestHapHolder));
      // d9e4b7c1 T2：goal 正式 gate 的 evidence 统一写入（build→install→run 全部完成后，
      // 协调层单点写）。review P1：结果必须进 results——真实安装+run 已成功而 evidence
      // 写不出时是 BLOCKER（否则 collector 把缺文件当无信号，旧包结果可能假放行）。
      results.push(...safeRun(
        () => writeDeviceTestEvidenceIfEligible(ctx, deviceTestHapHolder),
        'device_test_evidence_write',
      ));
    }
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
    // S6（visual-capability-truth P1-I）：TC DAG machine block 一致性
    results.push(...safeRun(() => checkTestCaseFlowConsistency(ctx, plan), 'test_case_flow_consistency'));
    results.push(...safeRun(() => checkTestEnvironmentDefined(ctx, plan), 'test_environment_defined'));
    results.push(...safeRun(() => checkPassCriteriaDefined(ctx, plan), 'pass_criteria_defined'));
    results.push(...safeRun(() => checkPlanMetadata(ctx, plan), 'plan_metadata_header'));

    // --- Structure checks: Test Report ---
    results.push(...safeRun(() => checkReportRequiredChapters(ctx, report), 'report_required_chapters'));
    results.push(...safeRun(() => checkExecutionResultTable(ctx, report), 'execution_result_table'));
    results.push(...safeRun(() => checkPassRateCalculated(ctx, report), 'pass_rate_calculated'));
    results.push(...safeRun(() => checkDefectTableFormat(ctx, report), 'defect_table_format'));
    results.push(...safeRun(() => checkReportConclusionWithVerdict(ctx, report), 'report_conclusion_with_verdict'));

    // --- blind-visual-hardening d1 切片一：负面裁决闭环 + 上游裁决传播 ---
    results.push(...safeRun(() => checkNegativeTestingVerdictClosure(report), 'negative_verdict_closure'));
    // --- blind-visual-hardening d5：视觉债务披露 ---
    results.push(...safeRun(() => checkVisualDebtDisclosure(ctx, report), 'visual_debt_disclosure'));
    results.push(
      ...safeRun(
        () => checkUpstreamVerdictGate({ projectRoot: ctx.projectRoot, feature: ctx.feature, phase: 'testing' }),
        'upstream_verdict_gate',
      ),
    );

    results.push(
      ...runAcceptanceYamlStructureChecks(ctx, (c, s, id) =>
        ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id),
      ),
    );

    // --- Traceability checks ---
    results.push(...safeRun(() => checkDeviceCaseNormalization(ctx), 'device_case_contract'));
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
    } else if (ctx.reportReconcileOnly) {
      results.push({
        id: 'visual_diff',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'visual_diff'),
        severity: 'MAJOR',
        status: 'SKIP',
        details: 'report-only reconciliation 不触发视觉采集；仅保留既有视觉产物的确定性静态检查。',
      });
      results.push(...safeRun(
        () => dispatchVisualDiffDeterministicOnly(ctx),
        'visual_diff_deterministic',
      ));
    } else {
      // t4（plan f3a8c6d2）：capture 未运行的路径（build/install/run 失败、静态门禁提前
      // 返回等）在此补裁决。**结构上不可能漏**：ctx 上没有值就等于 captureVisualDiff
      // 没跑过——不需要、也不再去反推不完整的失败分类。
      if (!ctx.visualFuseEligibility) {
        ctx.visualFuseEligibility = CAPTURE_NOT_RUN_ELIGIBILITY;
      }
      // ------------------------------------------------------------------
      // plan ab072691 t5①⑤：只读视觉 provider 评审 —— capture 之后、严格 dispatch 之前。
      //
      // 异步显式化：safeRun 是同步包装器（`fn: () => CheckResult[]`），塞不进 Promise，
      // 所以这里**显式 await**（本 check 入口本就是 async），不把异步藏进同步壳。
      //
      // provider-dependent 严格 dispatch 在 unusable 时不执行，避免 pending 屏制造第二条
      // 重复失败；统一投影只分三类：phase+release 均不要求时 unavailable=SKIP，strict
      // 或 release-required unavailable=capability defer，invalid=testing FAIL/retry。
      // 确定性红线仍在下面照跑。
      const providerReview = await runDelegatedVisualProviderReview(ctx);
      if (providerReview?.kind === 'unusable') {
        results.push(projectDelegatedVisualProviderFailure(
          ctx,
          providerReview.outcome,
          providerReview.reason,
          ruleDesc(ctx, 'structure_checks', 'visual_diff'),
        ));
        // unusable 只抑制**依赖 provider 判定**的 pending/candidate 分支；与 provider
        // 无关的确定性红线（改判脚本物证 / json 结构损坏）照跑——复用既有 check id，
        // 不新增 id/状态/质量轴。
        results.push(...safeRun(
          () => dispatchVisualDiffDeterministicOnly(ctx),
          'visual_diff_deterministic',
        ));
      } else {
        results.push(...safeRun(() => dispatchDeviceVisualDiff(ctx), 'visual_diff'));
      }
    }

    // --- goal-fakepass-hardening t2：review 闭环源码快照对账（BLOCKER，无 grace window）---
    results.push(...safeRun(() => checkReviewClosureAttestationGate(ctx), 'review_closure_attestation'));

    // --- goal-fakepass-hardening t3：产品行为开关扫描（defense-in-depth）---
    results.push(
      ...safeRun(
        () => buildBehaviorSwitchCheckResult({ projectRoot: ctx.projectRoot, feature: ctx.feature, phase: 'testing' }),
        'product_behavior_switch_scan',
      ),
    );

    // --- testing-stepresult-evidence：P0 acceptance StepResult 对账 + skip denominator ---
    results.push(
      ...safeRun(() => {
        const reportsBaseP0 = path.join(receiptDirPath(ctx.projectRoot, ctx.feature, 'testing'), 'reports');
        const tracePath = resolveAuthoritativeHylyreTracePath(reportsBaseP0);
        const trace = tracePath ? parseHylyreTrace(tracePath) : null;
        const inputs = {
          projectRoot: ctx.projectRoot,
          feature: ctx.feature,
          planMd: plan ?? '',
          reportMd: report ?? '',
          trace,
          evidenceGate: deviceTestHapHolder.hylyreEvidenceGate ?? null,
          derivedPlanPath: deviceTestHapHolder.nativeArtifactBinding?.derived_plan_path ?? null,
          reportConclusion: report ? parseReportConclusionVerdict(report) : null,
        };
        return [...evaluateP0CoverageIntegrity(inputs), ...evaluateP0SemanticCoverage(inputs)];
      }, 'p0_semantic_gates'),
    );

    const failureTracePath = deviceTestHapHolder.hylyreTracePath ?? resolveAuthoritativeHylyreTracePath(
      path.join(receiptDirPath(ctx.projectRoot, ctx.feature, 'testing'), 'reports'),
    );
    results.push(...checkHylyreCaseExecutionCompleteness(
      ctx,
      failureTracePath ? parseHylyreTrace(failureTracePath) : null,
      deviceTestHapHolder.hylyreEvidenceGate,
      deviceTestHapHolder.nativeArtifactBinding?.derived_plan_path ?? null,
    ));
    results.push(...checkHylyreArtifactIntegrity(
      ctx,
      failureTracePath,
      failureTracePath ? parseHylyreTrace(failureTracePath) : null,
      deviceTestHapHolder.hylyreEvidenceGate,
    ));
    results.push(...checkHylyreFailureRouting(
      ctx,
      failureTracePath ? parseHylyreTrace(failureTracePath) : null,
      deviceTestHapHolder.hylyreEvidenceGate,
      deviceTestHapHolder.nativeArtifactBinding?.derived_plan_path ?? null,
    ));
    results.push(...checkHylyreRuntimeSelectorGate(
      ctx,
      failureTracePath ? parseHylyreTrace(failureTracePath) : null,
      deviceTestHapHolder.hylyreEvidenceGate,
      deviceTestHapHolder.nativeArtifactBinding?.derived_plan_path ?? null,
    ));
    // 6.5b：证据义务必须晚于 visual 产出与 visual 门本身。
    results.push(...safeRun(
      () => checkChannelEvidenceObligation(ctx, plan, results, deviceTestHapHolder.hapPath ?? null),
      'testing_channel_evidence_obligation',
    ));
    results.push(...checkP0RuntimeStepEvidenceGate(ctx, results, deviceTestHapHolder));

    results.push(buildTestingRunStatusResult(plan, report, results));

    return results;
  },
};

/**
 * t2（goal-fakepass-hardening）：testing 期产品源码 vs review 闭环快照对账。
 * bc-openCard 事故：testing 期写入 DEVICE_TEST_FAST_PATH=true 短路核心流程，review 审过的
 * 代码与真机跑的不是同一份。基线=attestation 固化 inventory；走树=冻结 roots ∪ 当前重
 * discovery（新增整模块可见）。任何差异/缺 attestation → BLOCKER，指引回跑 review 闭环。
 */
function checkReviewClosureAttestationGate(ctx: CheckContext): CheckResult[] {
  const id = 'review_closure_attestation';
  const description = 'review 闭环源码快照与 testing 期产品源码对账（防测试期篡改产品行为）';
  if (isPhaseDisabledByProfile('review', ctx.resolvedProfile)) {
    return [{
      id, category: 'structure', description,
      severity: 'MINOR', status: 'SKIP',
      details: `project_profile=${ctx.resolvedProfile.name} 已禁用 review 阶段，无 attestation 可对账。`,
    }];
  }
  const att = loadReviewClosureAttestation(ctx.projectRoot, ctx.feature);
  if (!att) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details:
        '缺 review-closure-attestation.json（review 四件套闭环时由 check-receipt 生成）。' +
        '无 grace window：存量 feature 首次跑新版 testing 前须补跑一次 review 闭环' +
        '（fail-open 通道正是 bc-openCard 事故的形状）。',
      suggestion: '回跑 review 闭环（harness + verifier + receipt + check-receipt）生成 attestation 后重试。',
    }];
  }
  const rec = reconcileSourceTreeAgainstAttestation(ctx.projectRoot, att);
  if (!rec.ok) {
    const fmt = (label: string, arr: string[]): string =>
      arr.length === 0 ? '' : `\n${label}（${arr.length}）：${arr.slice(0, 8).join('、')}${arr.length > 8 ? '…' : ''}`;
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details:
        'review 闭环后产品源码发生变更——review 审过的代码与当前代码不是同一份：' +
        fmt('新增', rec.added) + fmt('修改', rec.modified) + fmt('删除', rec.deleted) +
        fmt('新出现的产品源码根', rec.new_roots),
      suggestion:
        '产品代码变更须回跑 review 闭环重审后再进 testing（ut 期修 bug 合法但同样触发重审）；' +
        '测试接缝不得改变用户可见流程/默认行为。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `产品源码与 review 闭环快照一致（inventory ${att.inventory.file_count} 文件，roots=${att.inventory.roots.length}）。`,
  }];
}

export default checker;
