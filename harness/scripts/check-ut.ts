// ============================================================================
// UT 阶段脚本 Harness — check-ut.ts
// ============================================================================
// 读取 framework/specs/phase-rules/ut-rules.yaml + doc/features/{feature}/
// 执行确定性的静态验证。
//
// 检查项（与 ut-rules.yaml 对应）：
//   Structure:     harness_host_artifact_pollution, dag_schema_compliance, dag_node_type_valid, dag_acyclic,
//                  dag_source_file_exists, ut_testability_audit_present,
//                  ut_unsupported_targets_handled, ut_mock_plan_present,
//                  ut_mock_plan_typed, ut_mock_plan_contracts_consistent,
//                  dag_spy_preset_resolvable, ut_file_naming, ut_framework_import,
//                  ut_assertion_exists, mock_stub_for_async, test_registration
//   Traceability:  dag_to_acceptance, acceptance_coverage, dag_to_source
//
// 语义级检查由 AI Harness (verify-ut.md) 完成，不在本脚本范围内。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
  AcceptanceSpec,
  UseCasesSpec,
  UseCaseDef,
} from './utils/types';
import { scanNamedBusinessHandler } from './utils/named-handler';
import {
  diffChangedFiles,
  filterBusinessSourceChanges,
  readApprovedMutations,
  readTraceStartCommit,
  analyzeDiffStaleness,
} from './utils/git-diff';
import { findFilesRecursive } from './utils/find-files-recursive';
import {
  CANONICAL_UT_COMPILE_ID,
  LEGACY_UT_COMPILE_ID,
  CANONICAL_UT_RUN_ID,
  LEGACY_UT_RUN_ID,
} from '../capability-registry';
import {
  loadFrameworkConfig,
  featuresDirPath,
  resolveFeatureArtifact,
  featureArtifactPath,
  featureDir,
} from '../config';
import {
  tryLoadUtHostImpl,
  getLastProfileHarnessLoadError,
  tryLoadDiffExcludeTestPathRegexes,
  type UtHostImpl,
  type UtHostSuggestionPaths,
} from '../profile-host-loader';
import { isSuiteEntryShimContent } from '../ut-suite-entry-shim';
import {
  buildMockPlanPresetIndex,
  collectDoublesMissingStrategy,
  collectMockPlanTypedIssues,
  collectUtMockkitGovernanceIssues,
  getMockPlanEntries,
  mockPlanAllowsHypiumMockkit,
  mockPlanHasEntries,
  parseMockPlanFile,
  parseTestabilityAuditFile,
  utFileImportsHypiumMockkit,
  type MockPlanSpec,
  type TestabilityAuditRecord,
} from './utils/ut-artifact-parse';
import { deriveBusinessSourcePathPrefixes } from './utils/ut-business-src-scope';
import { checkContextExplorationArtifact } from './utils/context-exploration';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { runAcceptanceYamlStructureChecks, acceptanceHasDeviceFocusRef } from './utils/check-acceptance';
import {
  buildAcCoverageReport,
  writeAcCoverageReport,
  type AcCoverageReport,
} from './utils/ac-coverage-report';
import {
  loadCoverageEvidence,
  listUnitBothScopeItems,
  dagsAllCharacterization,
  scopeHasResolvableEvidence,
  mappingBackedByResolvableEvidence,
  ephemeralFlowDagDir,
  coverageEvidenceRel,
  type CoverageEvidenceFile,
} from './utils/coverage-evidence';
import {
  collectContractPackagePathPollution,
  mergePollutionViolations,
} from './utils/harness-path-guard';

const HARNESS_ROOT = path.resolve(__dirname, '..');

interface UtUiImportBanModule {
  UI_FORBIDDEN_PATTERNS: RegExp[];
  scanForbiddenImports: (content: string, patterns: RegExp[]) => string[];
}

function tryLoadUtUiImportBan(profileDir: string): UtUiImportBanModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require(path.join(profileDir, 'harness', 'ut-ui-import-ban')) as UtUiImportBanModule;
    if (!Array.isArray(m.UI_FORBIDDEN_PATTERNS) || typeof m.scanForbiddenImports !== 'function') {
      return null;
    }
    return m;
  } catch {
    return null;
  }
}

/** UT 诊断里指向模板/示例的相对路径：由 profile ut-host-impl 提供；无 host 时用中性占位（避免根脚本硬编码某 profile）。 */
function utSuggestionPaths(ctx: CheckContext): UtHostSuggestionPaths {
  const h = tryLoadUtHostImpl(ctx.resolvedProfile.profileDir);
  if (h) return h.getUtSuggestionPaths();
  return {
    useCasesSchemaTemplateRel:
      '（当前 project_profile skills/feature/business-ut/templates/use-cases-schema.md，见 profile addendum）',
    mockPlanSchemaTemplateRel:
      '（当前 project_profile skills/feature/business-ut/templates/mock-plan-schema.md，见 profile addendum）',
    testabilityAuditTemplateRel:
      '（当前 project_profile skills/feature/business-ut/templates/testability-audit-template.md，见 profile addendum）',
    branchExampleTestRel:
      '（当前 project_profile skills/feature/business-ut/examples/，见 profile addendum）',
    utHostImplRefRel: '（当前 project_profile harness/ut-host-impl.ts）',
  };
}

function isSuiteEntryShim(ctx: CheckContext, content: string): boolean {
  const h = tryLoadUtHostImpl(ctx.resolvedProfile.profileDir);
  if (h) return h.isSuiteEntryShim(content);
  return isSuiteEntryShimContent(content);
}

function structureRuleDefined(ctx: CheckContext, id: string): boolean {
  const sc = ctx.phaseRule.structure_checks as Record<string, unknown> | undefined;
  return Boolean(sc && Object.prototype.hasOwnProperty.call(sc, id));
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface DagNode {
  id: string;
  type: string;
  description?: string;
  source?: {
    file: string;
    function?: string;
    class?: string;
  };
  next?: string[];
  stub_strategy?: string;
  /** @deprecated 过渡期保留；新 DAG 应使用 spy_preset + ut/mock-plan.yaml */
  mock_data?: Record<string, unknown>;
  /** 引用 mock-plan.yaml > spies[].methods[].presets[].id（与 port_call_* / async_call 配合） */
  spy_preset?: string;
  boundary?: {
    name?: string;
    type?: string;
    method?: string;
  };
  intervention?: Record<string, unknown>;
  task?: Record<string, unknown>;
  navigation?: Record<string, unknown>;
  condition?: string;
  branches?:
    | { true_branch?: string[]; false_branch?: string[] }   // 旧 conditional_branch
    | string[];                                              // 新 DAG 顶层 branches 数组（当出现在 DagFile 中）
  linked_acceptance?: string[];
  linked_branch?: string;      // v2 新增：assertion 节点指向 use-cases.yaml > branch id
  origin?: 'log_observed' | 'static_inferred' | 'human_confirmed' | string;
  transition?: { to_phase?: string };                         // v2 新增：state_transition
  trigger?: { event?: string; simulated_value?: string };     // v2 新增：user_trigger
  assertions?: Array<{
    type: string;
    target?: string;
    expected?: string;
    description?: string;
  }>;
}

interface DagFile {
  flow_id?: string;
  flow_name?: string;
  flow_type?: 'usecase_driven' | 'spec_driven' | 'characterization' | string;
  module?: string;
  use_case?: string;                // v2 新增
  branches?: string[];              // v2 新增：该 DAG 覆盖的 branch id 列表（顶层字段）
  entry_point?: {
    module?: string;
    file?: string;
    function?: string;
  };
  linked_acceptance?: string[];
  linked_boundaries?: string[];
  nodes?: DagNode[];
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const VALID_NODE_TYPES = [
  // 通用（保留兼容）
  'code_execution',
  'async_call',
  'user_intervention',   // deprecated
  'background_task',
  'ui_navigation',       // deprecated
  'assertion',
  'conditional_branch',
  // v2 业务视角
  'user_trigger',
  'port_call_cloud',
  'port_call_local',
  'state_transition',
  'ui_subscription',     // v2.1：UI 订阅占位（UT 忽略；与 acceptance device_focus 文档对齐）
];

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

// --------------------------------------------------------------------------
// DAG Loading
// --------------------------------------------------------------------------

function loadDagFiles(ctx: CheckContext): Array<{ path: string; dag: DagFile; raw: string }> {
  const results: Array<{ path: string; dag: DagFile; raw: string }> = [];
  const seen = new Set<string>();

  const pushDag = (dagPath: string) => {
    const relPath = path.relative(ctx.projectRoot, dagPath).replace(/\\/g, '/');
    if (seen.has(relPath)) return;
    seen.add(relPath);
    try {
      const raw = fs.readFileSync(dagPath, 'utf-8');
      const dag = YAML.parse(raw) as DagFile;
      results.push({ path: relPath, dag, raw });
    } catch {
      /* skip malformed */
    }
  };

  const contracts = ctx.featureSpec.contracts;
  if (contracts?.modules?.length) {
    for (const mod of contracts.modules) {
      const dagDir = path.join(ctx.projectRoot, mod.package_path, 'test', 'dag');
      for (const dagPath of findFilesRecursive(dagDir, /\.dag\.yaml$/)) {
        pushDag(dagPath);
      }
    }
  }

  const ephemeralDir = ephemeralFlowDagDir(ctx.projectRoot, ctx.feature);
  if (fs.existsSync(ephemeralDir)) {
    for (const dagPath of findFilesRecursive(ephemeralDir, /\.dag\.yaml$/)) {
      pushDag(dagPath);
    }
  }

  return results;
}

// --------------------------------------------------------------------------
// v2 UseCase Spec 相关加载
// --------------------------------------------------------------------------

function loadUseCaseSpec(ctx: CheckContext): UseCasesSpec | null {
  return ctx.featureSpec.useCases ?? null;
}

function loadDesignMd(ctx: CheckContext): string | null {
  const resolved = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'plan.md');
  if (!resolved.exists) return null;
  try {
    return fs.readFileSync(resolved.actualPath, 'utf-8');
  } catch {
    return null;
  }
}

function acceptanceHasUnitLayerRequirement(ctx: CheckContext): boolean {
  const ac = ctx.featureSpec.acceptance;
  if (!ac) return false;
  const hit = (layer?: string) => layer === 'unit' || layer === 'both';
  return (
    (ac.criteria?.some(c => hit(c.ut_layer)) ?? false) ||
    (ac.boundaries?.some(b => hit(b.ut_layer)) ?? false)
  );
}

function designMentionsUseCaseChapter(ctx: CheckContext): boolean {
  const md = loadDesignMd(ctx);
  return !!md && md.includes('业务流程 UseCase 清单');
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

function checkDagSchemaCompliance(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dags.length === 0) {
    return [{
      id: 'dag_schema_compliance',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_schema_compliance'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details:
        '未找到 DAG 文件（*.dag.yaml）。可放在 doc/features/<feature>/ut/reports/flow-dag/（ephemeral，默认）或 {module}/test/dag/（归档）。',
    }];
  }

  const issues: string[] = [];
  const affectedFiles: string[] = [];
  const hasUseCaseSpec = !!loadUseCaseSpec(ctx);

  for (const { path: dagPath, dag } of dags) {
    const missing: string[] = [];
    if (!dag.flow_id) missing.push('flow_id');
    if (!dag.flow_name) missing.push('flow_name');
    if (!dag.entry_point) missing.push('entry_point');
    if (!dag.nodes || !Array.isArray(dag.nodes) || dag.nodes.length === 0) missing.push('nodes[]');
    if (hasUseCaseSpec) {
      if (!dag.use_case) missing.push('use_case（use-cases.yaml 存在时必填）');
      if (!Array.isArray(dag.branches) || dag.branches.length === 0) {
        missing.push('branches[]（use-cases.yaml 存在时必填）');
      }
    }

    if (missing.length > 0) {
      issues.push(`${dagPath}: 缺少必填字段 ${missing.join(', ')}`);
      affectedFiles.push(dagPath);
    }

    if (dag.nodes) {
      for (const node of dag.nodes) {
        const nodeMissing: string[] = [];
        if (!node.id) nodeMissing.push('id');
        if (!node.type) nodeMissing.push('type');
        if (!node.description) nodeMissing.push('description');
        if (nodeMissing.length > 0) {
          issues.push(`${dagPath} > node ${node.id ?? '?'}: 缺少 ${nodeMissing.join(', ')}`);
          affectedFiles.push(dagPath);
        }
      }
    }
  }

  if (issues.length === 0) {
    return [{
      id: 'dag_schema_compliance',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_schema_compliance'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${dags.length} 个 DAG 文件的 Schema 合规。`,
    }];
  }

  return [{
    id: 'dag_schema_compliance',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_schema_compliance'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${issues.length} 处 Schema 问题：\n${truncateList(issues, 10)}`,
    affected_files: [...new Set(affectedFiles)],
    suggestion: 'DAG 文件必须包含 flow_id、flow_name、entry_point、nodes[]；当 use-cases.yaml 存在时还必须包含 use_case（= use_cases[].id）与 branches[]；每个节点必须包含 id、type、description。',
  }];
}

function checkDagNodeTypeValid(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dags.length === 0) {
    return [{
      id: 'dag_node_type_valid',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_node_type_valid'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const DEPRECATED_NODE_TYPES = new Set(['user_intervention', 'ui_navigation']);
  const invalidNodes: string[] = [];
  const deprecatedNodes: string[] = [];
  const affectedFiles: string[] = [];
  const deprecatedFiles: string[] = [];

  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (!VALID_NODE_TYPES.includes(node.type)) {
        invalidNodes.push(`${dagPath} > ${node.id}: type="${node.type}"`);
        affectedFiles.push(dagPath);
      } else if (DEPRECATED_NODE_TYPES.has(node.type)) {
        deprecatedNodes.push(`${dagPath} > ${node.id}: type="${node.type}"`);
        deprecatedFiles.push(dagPath);
      }
    }
  }

  const out: CheckResult[] = [];
  if (invalidNodes.length === 0) {
    out.push({
      id: 'dag_node_type_valid',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_node_type_valid'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 DAG 节点类型合法。',
    });
  } else {
    out.push({
      id: 'dag_node_type_valid',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_node_type_valid'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${invalidNodes.length} 个节点类型非法：\n${truncateList(invalidNodes, 10)}`,
      affected_files: [...new Set(affectedFiles)],
      suggestion: `合法类型: ${VALID_NODE_TYPES.join(', ')}`,
    });
  }

  if (deprecatedNodes.length > 0) {
    out.push({
      id: 'dag_node_type_valid',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_node_type_valid'),
      severity: 'MINOR',
      status: 'WARN',
      details: `${deprecatedNodes.length} 个节点使用已废弃类型（兼容保留）：\n${truncateList(deprecatedNodes, 10)}`,
      affected_files: [...new Set(deprecatedFiles)],
      suggestion: 'user_intervention / ui_navigation 已废弃；建议用 ui_subscription（UI 订阅 state，UT 忽略）或在 acceptance.yaml 填写 device_focus。',
    });
  }

  return out;
}

function checkDagAcyclic(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dags.length === 0) {
    return [{
      id: 'dag_acyclic',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_acyclic'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const cyclicDags: string[] = [];

  for (const { path: dagPath, dag } of dags) {
    if (!dag.nodes?.length) continue;

    const adjacency = new Map<string, string[]>();
    for (const node of dag.nodes) {
      const nexts: string[] = [...(node.next ?? [])];
      if (node.type === 'conditional_branch' && node.branches && !Array.isArray(node.branches)) {
        const cb = node.branches as { true_branch?: string[]; false_branch?: string[] };
        nexts.push(...(cb.true_branch ?? []));
        nexts.push(...(cb.false_branch ?? []));
      }
      adjacency.set(node.id, nexts);
    }

    if (hasCycle(adjacency)) {
      cyclicDags.push(dagPath);
    }
  }

  if (cyclicDags.length === 0) {
    return [{
      id: 'dag_acyclic',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_acyclic'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${dags.length} 个 DAG 无环。`,
    }];
  }

  return [{
    id: 'dag_acyclic',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_acyclic'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${cyclicDags.length} 个 DAG 包含循环引用：\n${truncateList(cyclicDags, 10)}`,
    affected_files: cyclicDags,
    suggestion: 'DAG 的 next/branches 链不可形成环路，请检查节点的后续指向。',
  }];
}

function hasCycle(adjacency: Map<string, string[]>): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adjacency.keys()) color.set(id, WHITE);

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const id of adjacency.keys()) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

function checkDagSourceFileExists(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dags.length === 0) {
    return [{
      id: 'dag_source_file_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_source_file_exists'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const missing: string[] = [];
  const affectedFiles: string[] = [];

  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (!node.source?.file) continue;
      const fullPath = path.join(ctx.projectRoot, node.source.file);
      if (!fs.existsSync(fullPath)) {
        missing.push(`${dagPath} > ${node.id}: ${node.source.file}`);
        affectedFiles.push(dagPath);
      }
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'dag_source_file_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_source_file_exists'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 DAG 节点引用的源码文件均存在。',
    }];
  }

  return [{
    id: 'dag_source_file_exists',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_source_file_exists'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 个 source.file 引用不存在：\n${truncateList(missing, 10)}`,
    affected_files: [...new Set(affectedFiles)],
    suggestion: 'DAG 节点的 source.file 必须指向工程中存在的源码文件。',
  }];
}

function checkUtAssertionExists(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'ut_assertion_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_assertion_exists'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '未找到 UT 文件。',
    }];
  }

  const noAssertionCases: string[] = [];
  const affectedFiles: string[] = [];

  for (const { path: utPath, content } of utFiles) {
    const itBlocks = extractItBlocks(content);
    for (const block of itBlocks) {
      if (!block.body.includes('expect(') && !block.body.includes('expect (')) {
        noAssertionCases.push(`${utPath}: "${block.name}"`);
        affectedFiles.push(utPath);
      }
    }
  }

  if (noAssertionCases.length === 0) {
    return [{
      id: 'ut_assertion_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_assertion_exists'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 it() 用例均包含 expect 断言。',
    }];
  }

  return [{
    id: 'ut_assertion_exists',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_assertion_exists'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${noAssertionCases.length} 个测试用例缺少 expect 断言：\n${truncateList(noAssertionCases, 10)}`,
    affected_files: [...new Set(affectedFiles)],
    suggestion: '每个 it() 测试用例中必须包含至少一条 expect() 断言。',
  }];
}

/**
 * v2.2 business-ut 红线：检测未授权的业务源码变更。
 * 流程：
 *   (1) `HARNESS_DIFF_BASE_REF` 显式值；否则读 trace.start_commit；（再否则由 git-diff 默认 working）
 *   (2) git diff + 未提交/untracked，按受保护前缀筛；
 *   (3) 与 reports/<feature>/ut/**\/gap-notes.md 的 approved_src_mutations[] 对账；
 *   (4) 未登记 → FAIL BLOCKER。
 *
 * 受保护前缀由实例 `architecture.outer_layers[].id` 推导；与 SKILL.md 约束 #12 对齐。
 */
function utSrcProtectedPrefixes(ctx: CheckContext): string[] {
  return deriveBusinessSourcePathPrefixes(ctx.projectRoot);
}

function filterProtected(ctx: CheckContext, changes: string[]): string[] {
  const extra = tryLoadDiffExcludeTestPathRegexes(ctx.resolvedProfile.profileDir) ?? [];
  return filterBusinessSourceChanges(changes, utSrcProtectedPrefixes(ctx), {
    excludeTestPathRegexes: extra,
  });
}

/**
 * 计算 reports/<feature>/ 的扫描根。
 * - 配置了 `reports_dir_pattern`：`doc/features/<feature>/` 整树（含 `<phase>/reports/`）。
 * - 否则：`framework/harness/reports/<feature>/<phase>/`（未配置 `reports_dir_pattern` 时的旧布局）。
 * 若设置 HARNESS_REPORTS_ROOT_OVERRIDE，则 `<override>/<feature>/`。
 */
function computeReportsFeatureRoot(projectRoot: string, feature: string): string {
  const override = process.env.HARNESS_REPORTS_ROOT_OVERRIDE;
  if (override) return path.join(override, feature);
  const cfg = loadFrameworkConfig(projectRoot);
  if (typeof cfg.paths.reports_dir_pattern === 'string' && cfg.paths.reports_dir_pattern.trim().length > 0) {
    return path.join(featuresDirPath(projectRoot), feature);
  }
  return path.join(HARNESS_ROOT, 'reports', feature);
}

function findGapNotesFiles(projectRoot: string, feature: string): string[] {
  const reportsRoot = computeReportsFeatureRoot(projectRoot, feature);
  if (!fs.existsSync(reportsRoot)) return [];
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile() && e.name === 'gap-notes.md') hits.push(abs);
    }
  };
  walk(reportsRoot, 0);
  return hits;
}

function findTraceJsonFiles(projectRoot: string, feature: string): string[] {
  const reportsRoot = computeReportsFeatureRoot(projectRoot, feature);
  if (!fs.existsSync(reportsRoot)) return [];
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile() && e.name === 'trace.json') hits.push(abs);
    }
  };
  walk(reportsRoot, 0);
  return hits;
}

/**
 * 纯函数（profile 无关）：从未授权改动清单里挑出「非 src/ 下」的工程/构建配置文件。
 * 业务源码落在 src/ 内，模块根的构建/工程配置则在 src/ 外；这类文件常被 agent 为排障触碰、
 * 又受源码门禁约束，单列以便给针对性回退指引。具体宿主配置文件名属 profile 知识，根侧保持中性。
 */
export function pickNonSrcConfigChanges(files: string[]): string[] {
  return files.filter(f => !/(?:^|\/)src\//.test(f.replace(/\\/g, '/')));
}

function checkUtNoSrcMutation(ctx: CheckContext): CheckResult[] {
  // 解析 baseRef：聚合所有找到的 trace.json（按修改时间选最新，降低多次跑带来的歧义）
  const envBaseRef = (process.env.HARNESS_DIFF_BASE_REF ?? '').trim();
  const traceFiles = findTraceJsonFiles(ctx.projectRoot, ctx.feature).sort((a, b) => {
    const sa = fs.statSync(a).mtimeMs;
    const sb = fs.statSync(b).mtimeMs;
    return sb - sa;
  });
  let baseRef: string | undefined;
  if (envBaseRef) {
    baseRef = envBaseRef;
  } else {
    for (const tf of traceFiles) {
      const sc = readTraceStartCommit(tf);
      if (sc) { baseRef = sc; break; }
    }
  }

  const prefixes = utSrcProtectedPrefixes(ctx);

  const diff = diffChangedFiles({
    projectRoot: ctx.projectRoot,
    baseRef,
    pathspecs: prefixes,
  });

  if (!diff.executed) {
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `无法运行 git diff：${diff.error ?? '未知错误'}\n` +
        `该规则要求项目是 git 仓库。请初始化 git 或在 git 环境下跑 harness。`,
    }];
  }

  const businessChanges = filterProtected(ctx, diff.changedFiles);
  const committedBusinessChanges = filterProtected(ctx, diff.committedFiles);
  const workingBusinessChanges = filterProtected(ctx, diff.workingTreeFiles);
  const stagedBusinessChanges = filterProtected(ctx, diff.stagedFiles);
  const untrackedBusinessChanges = filterProtected(ctx, diff.untrackedFiles);
  const staleness = analyzeDiffStaleness(diff);
  const baseHint = envBaseRef
    ? `HARNESS_DIFF_BASE_REF=${envBaseRef}`
    : 'trace.json.start_commit（若存在）；否则默认 working';

  if (businessChanges.length === 0) {
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation'),
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        `baseRef=${diff.baseRef}${diff.baseIsFallback ? ' (fallback)' : ''}；` +
        `mode=${diff.workingOnly ? 'working-only' : 'committed+working'}；` +
        `base 来源：${baseHint}；` +
        `未检测到 ${prefixes.join(' / ')} 下的业务源码变更。`,
    }];
  }

  // 汇总所有 gap-notes.md 的授权清单
  const gapFiles = findGapNotesFiles(ctx.projectRoot, ctx.feature);
  const approved = new Set<string>();
  for (const g of gapFiles) {
    const set = readApprovedMutations(g);
    set.forEach(f => approved.add(f));
  }

  const unauthorized = businessChanges.filter(f => !approved.has(f));

  if (unauthorized.length === 0) {
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation'),
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        `baseRef=${diff.baseRef}${diff.baseIsFallback ? ' (fallback)' : ''}；` +
        `mode=${diff.workingOnly ? 'working-only' : 'committed+working'}；base 来源：${baseHint}\n` +
        `变更拆分：committed=${committedBusinessChanges.length}, working=${workingBusinessChanges.length}, staged=${stagedBusinessChanges.length}, untracked=${untrackedBusinessChanges.length}\n` +
        `共检测到 ${businessChanges.length} 个业务源码变更，均已在 approved_src_mutations[] 中登记：\n${businessChanges.map(f => '  - ' + f).join('\n')}`,
    }];
  }

  const oldBaseHint = staleness.stale
    ? '\n\n诊断：stale_diff_base。你显式收窄/拉长了 diff 区间，committed 远大于当前 working 变更。若只想拦未提交的 UT 改动，请去掉 HARNESS_DIFF_BASE_REF 并确保无 trace.start_commit pinning；或调整后重跑。'
    : '';

  // 未授权清单含「非 src/ 下」的工程/构建配置文件时，给出针对性指引：
  // 这类文件常被 agent 为排障触碰，但同样受门禁约束，且常因排障被改坏，应优先回退而非叠加。
  const configChanges = pickNonSrcConfigChanges(unauthorized);
  const configHint =
    configChanges.length > 0
      ? ` 其中含 src/ 之外的改动（${configChanges.join(', ')}，通常是工程/构建配置文件）：这类文件同样受源码改动门禁约束——` +
        '若是为排障临时改动、反而把原本合法的配置改坏的，优先回退到 trace.json.start_commit 的版本，' +
        '而不是继续叠加改动；确需保留则同样经用户授权后登记 approved_src_mutations。'
      : '';

  return [{
    id: 'ut_no_src_mutation',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `baseRef=${diff.baseRef}${diff.baseIsFallback ? ' (fallback — trace.json.start_commit 未记录，可信度较低)' : ''}\n` +
      `mode=${diff.workingOnly ? 'working-only' : 'committed+working'}；base 来源：${baseHint}\n` +
      `变更拆分：committed=${committedBusinessChanges.length}, working=${workingBusinessChanges.length}, staged=${stagedBusinessChanges.length}, untracked=${untrackedBusinessChanges.length}\n` +
      `检测到 ${unauthorized.length} 个**未授权**的业务源码变更：\n${unauthorized.map(f => '  - ' + f).join('\n')}\n\n` +
      `gap-notes.md 已登记的授权清单（${approved.size} 条）：${Array.from(approved).slice(0, 20).join(', ') || '(空)'}\n` +
      `扫描到的 gap-notes.md 文件：${gapFiles.length > 0 ? gapFiles.map(f => path.relative(ctx.projectRoot, f).replace(/\\\\/g, '/')).join(', ') : '(无)'}${oldBaseHint}`,
    affected_files: unauthorized,
    failure_kind: staleness.stale ? 'stale_diff_base' : 'unauthorized_src_mutation',
    blocking_class: staleness.stale ? 'stale_diff_base' : 'ut_no_src_mutation',
    suggestion:
      staleness.stale
        ? '可先去掉 HARNESS_DIFF_BASE_REF（默认 working）后重跑；或显式设 `HARNESS_DIFF_BASE_REF=working`。若仍有未授权的业务源码改动，再进入 HARD STOP 授权流程。'
        : '按 business-ut SKILL.md > 约束 #12 HARD STOP 流程：先向用户征得同意，再把变更登记到 ' +
          'doc/features/<feature>/ut/reports/<timestamp>/<model>-ut/gap-notes.md（或 legacy：framework/harness/reports/…）> approved_src_mutations[]（含 file / reason / approved_at 等字段）。' +
          '禁止以"便利性"借口直接修改业务源码。' +
          configHint,
  }];
}

function extractItBlocks(content: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const itRe = /it\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;

  while ((match = itRe.exec(content)) !== null) {
    const name = match[1];
    const startIdx = match.index;
    let braceCount = 0;
    let bodyStart = -1;
    let bodyEnd = -1;

    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') {
        if (bodyStart === -1) bodyStart = i;
        braceCount++;
      } else if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0 && bodyStart !== -1) {
          bodyEnd = i;
          break;
        }
      }
    }

    if (bodyStart !== -1 && bodyEnd !== -1) {
      blocks.push({ name, body: content.substring(bodyStart, bodyEnd + 1) });
    }
  }

  return blocks;
}

function checkMockStubForAsync(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (dags.length === 0) {
    return [{
      id: 'mock_stub_for_async',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'mock_stub_for_async'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const asyncNodes: Array<{ dagPath: string; nodeId: string; funcName: string }> = [];
  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (node.type === 'async_call' && node.source?.function) {
        asyncNodes.push({ dagPath, nodeId: node.id, funcName: node.source.function });
      }
    }
  }

  if (asyncNodes.length === 0) {
    return [{
      id: 'mock_stub_for_async',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'mock_stub_for_async'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '无 async_call 节点需要打桩。',
    }];
  }

  const allUtContent = utFiles.map(f => f.content).join('\n');
  const mockIndicators = ['Mock', 'mock', 'stub', 'Stub', 'spy', 'Spy', 'fake', 'Fake'];

  const unMocked: string[] = [];
  for (const { dagPath, nodeId, funcName } of asyncNodes) {
    const hasMock = mockIndicators.some(indicator =>
      allUtContent.includes(`${indicator}`) && allUtContent.includes(funcName),
    );

    if (!hasMock) {
      const hasStubStrategy = dags.some(d =>
        d.dag.nodes?.some(n => n.id === nodeId && n.stub_strategy),
      );
      if (!hasStubStrategy) {
        unMocked.push(`${dagPath} > ${nodeId}: ${funcName}`);
      }
    }
  }

  if (unMocked.length === 0) {
    return [{
      id: 'mock_stub_for_async',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'mock_stub_for_async'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${asyncNodes.length} 个 async_call 节点有对应的 mock/stub 处理。`,
    }];
  }

  return [{
    id: 'mock_stub_for_async',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'mock_stub_for_async'),
    severity: 'BLOCKER',
    status: 'WARN',
    details: `${unMocked.length} 个 async_call 节点可能缺少 mock/stub：\n${truncateList(unMocked, 10)}`,
    suggestion: 'async_call 节点必须有 stub_strategy 定义，且 UT 中需有对应的 Mock 实现。',
  }];
}

// --------------------------------------------------------------------------
// v2 新增 Structure Checks — use-cases.yaml 自身
// --------------------------------------------------------------------------

function checkUseCaseSpecRecommended(ctx: CheckContext): CheckResult[] {
  const specExists = !!loadUseCaseSpec(ctx);
  const unitAcCount = countUnitOrBothAc(ctx);
  const recommended = unitAcCount >= 3;

  if (specExists) {
    return [{
      id: 'usecase_spec_recommended',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_recommended'),
      severity: 'MINOR',
      status: 'PASS',
      details: `doc/features/${ctx.feature}/use-cases.yaml 已存在。`,
    }];
  }

  if (!recommended) {
    return [{
      id: 'usecase_spec_recommended',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_recommended'),
      severity: 'MINOR',
      status: 'SKIP',
      details: `ut_layer ∈ {unit, both} 的 AC 仅 ${unitAcCount} 条（阈值 ≥3），本 feature 可只用 acceptance.yaml + dag.yaml。`,
    }];
  }

  return [{
    id: 'usecase_spec_recommended',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_recommended'),
    severity: 'MINOR',
    status: 'WARN',
    details: `ut_layer ∈ {unit, both} 的 AC 有 ${unitAcCount} 条（≥3），建议产出 doc/features/${ctx.feature}/use-cases.yaml 以承载端到端分支。`,
    suggestion: `若 feature 确实多 UI 共享状态 / 多步云调用 / 含回滚分支，按 ${utSuggestionPaths(ctx).useCasesSchemaTemplateRel} 产出；否则可忽略本告警。`,
  }];
}

function countUnitOrBothAc(ctx: CheckContext): number {
  const ac = ctx.featureSpec.acceptance;
  if (!ac) return 0;
  const hit = (layer?: string) => layer === 'unit' || layer === 'both';
  return (
    (ac.criteria?.filter(c => hit(c.ut_layer)).length ?? 0) +
    (ac.boundaries?.filter(b => hit(b.ut_layer)).length ?? 0)
  );
}

function checkUseCaseSpecSchema(ctx: CheckContext): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'usecase_spec_schema',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_schema'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过 Schema 校验。',
    }];
  }

  const issues: string[] = [];
  if (!spec.schema_version) issues.push('顶层缺少 schema_version');
  if (!spec.feature) issues.push('顶层缺少 feature');
  if (!Array.isArray(spec.use_cases) || spec.use_cases.length === 0) {
    issues.push('顶层 use_cases 必须为非空数组');
  }

  for (const uc of spec.use_cases ?? []) {
    const tag = uc.id ? `use_case[${uc.id}]` : 'use_case[?]';
    const required: Array<keyof UseCaseDef> = ['id', 'coordinator', 'ui_bindings', 'state_model', 'branches'];
    for (const key of required) {
      if (uc[key] === undefined || uc[key] === null) {
        issues.push(`${tag}: 缺少字段 ${String(key)}`);
      }
    }
    const roleEnum = new Set(['entry', 'progress', 'dialog', 'result', 'passive']);
    for (const ub of uc.ui_bindings ?? []) {
      if (!ub.ui) issues.push(`${tag} > ui_binding: 缺少 ui`);
      if (!ub.role) issues.push(`${tag} > ui_binding[${ub.ui ?? '?'}]: 缺少 role`);
      else if (!roleEnum.has(ub.role as string)) {
        issues.push(`${tag} > ui_binding[${ub.ui}]: role 非法（当前：${ub.role}）`);
      }
      if (!Array.isArray(ub.user_actions)) {
        issues.push(`${tag} > ui_binding[${ub.ui ?? '?'}]: user_actions 必须为数组（空数组表示纯展示）`);
      } else {
        for (const ua of ub.user_actions) {
          if (!ua.trigger) issues.push(`${tag} > ui_binding[${ub.ui}] > user_action: 缺少 trigger`);
          if (!ua.calls) issues.push(`${tag} > ui_binding[${ub.ui}] > user_action: 缺少 calls（必须是命名函数符号）`);
        }
      }
    }
    const kindEnum = new Set(['cloud', 'storage', 'system']);
    for (const b of uc.data_boundaries ?? []) {
      if (!b.name) issues.push(`${tag} > data_boundary: 缺少 name`);
      if (!b.type) issues.push(`${tag} > data_boundary[${b.name ?? '?'}]: 缺少 type`);
      if (!b.kind) issues.push(`${tag} > data_boundary[${b.name ?? '?'}]: 缺少 kind`);
      else if (!kindEnum.has(b.kind as string)) {
        issues.push(`${tag} > data_boundary[${b.name}]: kind 必须属于 {cloud, storage, system}（当前：${b.kind}）`);
      }
      if (!Array.isArray(b.methods) || b.methods.length === 0) {
        issues.push(`${tag} > data_boundary[${b.name ?? '?'}]: methods[] 必填且非空`);
      }
    }
    if (uc.state_model && !Array.isArray(uc.state_model.phases)) {
      issues.push(`${tag}: state_model.phases 必须为数组`);
    }
    for (const br of uc.branches ?? []) {
      if (!br.id) issues.push(`${tag} > branch: 缺少 id`);
      if (!br.scenario) issues.push(`${tag} > branch[${br.id ?? '?'}]: 缺少 scenario`);
      if (!Array.isArray(br.linked_acceptance) || br.linked_acceptance.length === 0) {
        issues.push(`${tag} > branch[${br.id ?? '?'}]: linked_acceptance[] 必填且非空`);
      }
    }
  }

  if (issues.length === 0) {
    return [{
      id: 'usecase_spec_schema',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_schema'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `use-cases.yaml 合规（${(spec.use_cases ?? []).length} 个 UseCase）。`,
    }];
  }

  return [{
    id: 'usecase_spec_schema',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_schema'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${issues.length} 处 Schema 问题：\n${truncateList(issues, 20)}`,
    suggestion: `请参照 ${utSuggestionPaths(ctx).useCasesSchemaTemplateRel} 补齐 Schema。`,
  }];
}

function checkNamedBusinessHandler(ctx: CheckContext): CheckResult[] {
  const scan = scanNamedBusinessHandler(ctx);
  if (scan.skip) {
    return [{
      id: 'named_business_handler',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'named_business_handler'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }

  if (scan.issues.length === 0) {
    return [{
      id: 'named_business_handler',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'named_business_handler'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: 'ui_bindings.user_actions.calls 引用的函数均为命名函数（不是 inline lambda）。',
    }];
  }

  return [{
    id: 'named_business_handler',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'named_business_handler'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${scan.issues.length} 处命名入口缺失：\n${truncateList(scan.issues, 10)}`,
    suggestion: 'use-cases.yaml 中 user_actions.calls 声明的业务函数必须是具名函数 / 类方法 / 导出函数（非 inline lambda / 箭头函数赋值给 onClick），以便 UT 直接调用。',
  }];
}

function checkUseCaseUiBindingsNonempty(ctx: CheckContext): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'usecase_ui_bindings_nonempty',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_ui_bindings_nonempty'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  const issues: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    const bindings = uc.ui_bindings ?? [];
    if (bindings.length === 0) {
      issues.push(`${uc.id}: ui_bindings 为空——不涉及 UI 触发的业务流不应产出 use-cases.yaml`);
      continue;
    }
    const totalActions = bindings.reduce(
      (sum, b) => sum + (b.user_actions?.length ?? 0),
      0,
    );
    if (totalActions === 0) {
      issues.push(`${uc.id}: 所有 ui_bindings 的 user_actions 合计为 0——请补至少 1 条用户入口，或改用 dag.yaml 直接测 data 层函数`);
    }
  }
  if (issues.length === 0) {
    return [{
      id: 'usecase_ui_bindings_nonempty',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_ui_bindings_nonempty'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UseCase 的 ui_bindings 与 user_actions 均非空。',
    }];
  }
  return [{
    id: 'usecase_ui_bindings_nonempty',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_ui_bindings_nonempty'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${issues.length} 处 ui_bindings 问题：\n${truncateList(issues, 10)}`,
    suggestion: 'use-cases.yaml 的价值在于 UI↔业务入口映射表；若某 use_case 不涉及 UI，应删除该 use_case 或退回 dag.yaml。',
  }];
}

function checkBoundaryMatchesContracts(ctx: CheckContext): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'boundary_matches_contracts',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'boundary_matches_contracts'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  const interfaces = ctx.featureSpec.contracts?.interfaces ?? [];
  if (interfaces.length === 0) {
    return [{
      id: 'boundary_matches_contracts',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'boundary_matches_contracts'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'contracts.yaml 未声明 interfaces，跳过。',
    }];
  }

  const interfaceClasses = new Set(interfaces.map(i => i.class));
  const mismatches: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    for (const b of uc.data_boundaries ?? []) {
      if (!interfaceClasses.has(b.type)) {
        mismatches.push(`${uc.id} > data_boundary[${b.name}].type="${b.type}" 不在 contracts.yaml > interfaces[].class 中`);
      }
    }
  }

  if (mismatches.length === 0) {
    return [{
      id: 'boundary_matches_contracts',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'boundary_matches_contracts'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '所有 data_boundaries.type 均能在 contracts.yaml 中找到对应类。',
    }];
  }

  return [{
    id: 'boundary_matches_contracts',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'boundary_matches_contracts'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${mismatches.length} 处边界不匹配：\n${truncateList(mismatches, 10)}`,
    suggestion: 'use-cases.yaml 的 data_boundaries.type 必须是 contracts.yaml 已登记的现有类（不要新增 Port 接口）。',
  }];
}

// --------------------------------------------------------------------------
// v2 新增 Structure Checks — DAG 与 UT
// --------------------------------------------------------------------------

function checkDagLinkedUseCase(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'dag_linked_usecase',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_linked_usecase'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  if (dags.length === 0) {
    return [{
      id: 'dag_linked_usecase',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_linked_usecase'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const ucById = new Map<string, UseCaseDef>();
  for (const uc of spec.use_cases ?? []) ucById.set(uc.id, uc);

  const issues: string[] = [];
  const affected: string[] = [];

  for (const { path: p, dag } of dags) {
    if (!dag.use_case) {
      issues.push(`${p}: 缺少顶层 use_case 字段（必须为 use-cases.yaml > use_cases[].id）`);
      affected.push(p);
      continue;
    }
    const uc = ucById.get(dag.use_case);
    if (!uc) {
      issues.push(`${p}: use_case="${dag.use_case}" 不在 use-cases.yaml 的 ids 中`);
      affected.push(p);
      continue;
    }
    const topBranches = Array.isArray(dag.branches) ? dag.branches : [];
    if (topBranches.length === 0) {
      issues.push(`${p}: 缺少顶层 branches[] 数组`);
      affected.push(p);
      continue;
    }
    const validIds = new Set((uc.branches ?? []).map(b => b.id));
    for (const b of topBranches) {
      if (!validIds.has(b)) {
        issues.push(`${p}: branch "${b}" 不在 UseCase ${uc.id} 的 branches 中`);
        affected.push(p);
      }
    }
  }

  if (issues.length === 0) {
    return [{
      id: 'dag_linked_usecase',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_linked_usecase'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 DAG 均正确指向 use-cases.yaml 中的 UseCase 与 branch。',
    }];
  }

  return [{
    id: 'dag_linked_usecase',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_linked_usecase'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${issues.length} 处 DAG ↔ UseCase 关联问题：\n${truncateList(issues, 10)}`,
    affected_files: [...new Set(affected)],
    suggestion: 'DAG 顶层必须声明 use_case（匹配 use-cases.yaml > use_cases[].id）与 branches[]（子集 of 对应 UseCase 的 branches[].id）。',
  }];
}

function checkDagBoundaryMatchesSpec(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec || dags.length === 0) {
    return [{
      id: 'dag_boundary_matches_spec',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_boundary_matches_spec'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: spec ? '无 DAG 文件可分析。' : 'use-cases.yaml 不存在，跳过。',
    }];
  }

  const ucById = new Map<string, UseCaseDef>();
  for (const uc of spec.use_cases ?? []) ucById.set(uc.id, uc);

  const issues: string[] = [];
  const affected: string[] = [];

  for (const { path: p, dag } of dags) {
    const uc = dag.use_case ? ucById.get(dag.use_case) : undefined;
    if (!uc) continue;
    const boundaryNames = new Set((uc.data_boundaries ?? []).map(b => b.name));
    for (const node of dag.nodes ?? []) {
      if (node.type !== 'port_call_cloud' && node.type !== 'port_call_local') continue;
      const bname = (node as { boundary?: string; port?: string }).boundary
        ?? (node as { boundary?: string; port?: string }).port;
      if (!bname) {
        issues.push(`${p} > ${node.id}: ${node.type} 节点缺 boundary 字段`);
        affected.push(p);
        continue;
      }
      if (!boundaryNames.has(bname)) {
        issues.push(`${p} > ${node.id}: boundary="${bname}" 不在 UseCase ${uc.id} 的 data_boundaries 中`);
        affected.push(p);
      }
    }
  }

  if (issues.length === 0) {
    return [{
      id: 'dag_boundary_matches_spec',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_boundary_matches_spec'),
      severity: 'MAJOR',
      status: 'PASS',
      details: 'DAG 中所有 port_call_* 节点的 boundary 均能映射到 use-cases.yaml 的 data_boundaries。',
    }];
  }

  return [{
    id: 'dag_boundary_matches_spec',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_boundary_matches_spec'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${issues.length} 处 boundary 不对齐：\n${truncateList(issues, 10)}`,
    affected_files: [...new Set(affected)],
    suggestion: 'port_call_cloud / port_call_local 节点必须设置 boundary 字段，其值应等于 use-cases.yaml > data_boundaries[].name（旧字段名 port 仍兼容）。',
  }];
}

function checkDagAssertionLinkedBranch(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec || dags.length === 0) {
    return [{
      id: 'dag_assertion_linked_branch',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_assertion_linked_branch'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: spec ? '无 DAG 文件可分析。' : 'use-cases.yaml 不存在，跳过。',
    }];
  }

  // 构建：AC → branch 的反查映射（来自 acceptance.yaml.linked_branch 或 use-cases.yaml.branches.linked_acceptance）
  const acToBranch = new Map<string, string>();
  const ac = ctx.featureSpec.acceptance;
  for (const c of ac?.criteria ?? []) {
    if (c.linked_branch) acToBranch.set(c.id, c.linked_branch);
  }
  for (const b of ac?.boundaries ?? []) {
    if (b.linked_branch) acToBranch.set(b.id, b.linked_branch);
  }
  for (const uc of spec.use_cases ?? []) {
    for (const br of uc.branches ?? []) {
      for (const linked of br.linked_acceptance ?? []) {
        if (!acToBranch.has(linked)) acToBranch.set(linked, br.id);
      }
    }
  }

  const issues: string[] = [];
  const affected: string[] = [];
  for (const { path: p, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (node.type !== 'assertion') continue;
      const hasLinkedBranch = !!node.linked_branch;
      const linkedAcReversable =
        (node.linked_acceptance ?? []).some(a => acToBranch.has(a));
      if (!hasLinkedBranch && !linkedAcReversable) {
        issues.push(`${p} > ${node.id}: assertion 未声明 linked_branch，且 linked_acceptance 无法反查到 branch`);
        affected.push(p);
      }
    }
  }

  if (issues.length === 0) {
    return [{
      id: 'dag_assertion_linked_branch',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_assertion_linked_branch'),
      severity: 'MAJOR',
      status: 'PASS',
      details: 'DAG 中所有 assertion 节点均可追溯到某个 branch。',
    }];
  }

  return [{
    id: 'dag_assertion_linked_branch',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_assertion_linked_branch'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${issues.length} 处 assertion 节点缺 branch 追溯：\n${truncateList(issues, 10)}`,
    affected_files: [...new Set(affected)],
    suggestion: 'assertion 节点请显式声明 linked_branch；或确保 linked_acceptance 中某个 AC 在 acceptance.yaml 或 use-cases.yaml.branches 中可反查。',
  }];
}

function checkUtImportWhitelist(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (!structureRuleDefined(ctx, 'ut_import_whitelist')) {
    return [{
      id: 'ut_import_whitelist',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_import_whitelist'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '当前合并后的 phase-rules 未声明 ut_import_whitelist，跳过。',
    }];
  }

  const ban = tryLoadUtUiImportBan(ctx.resolvedProfile.profileDir);
  if (!ban || ban.UI_FORBIDDEN_PATTERNS.length === 0) {
    return [{
      id: 'ut_import_whitelist',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_import_whitelist'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        'phase-rules 声明了 ut_import_whitelist，但当前 profile 缺少有效的 harness/ut-ui-import-ban（模块缺失或 UI_FORBIDDEN_PATTERNS 为空）。',
    }];
  }

  if (utFiles.length === 0) {
    return [{
      id: 'ut_import_whitelist',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_import_whitelist'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const offences: string[] = [];
  const affected: string[] = [];
  for (const { path: p, content } of utFiles) {
    if (isSuiteEntryShim(ctx, content)) continue;
    const hits = ban.scanForbiddenImports(content, ban.UI_FORBIDDEN_PATTERNS);
    if (hits.length > 0) {
      affected.push(p);
      for (const h of hits) offences.push(`${p} > ${h}`);
    }
  }

  if (offences.length === 0) {
    return [{
      id: 'ut_import_whitelist',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_import_whitelist'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UT 文件 import 均在白名单内，无 UI/Nav/Toast 依赖。',
    }];
  }

  return [{
    id: 'ut_import_whitelist',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_import_whitelist'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${offences.length} 处禁止符号出现在 UT：\n${truncateList(offences, 20)}`,
    affected_files: [...new Set(affected)],
    suggestion:
      'UT 允许 import：profile addendum 列出的测试框架包、被测模块的 data / domain / 业务编排类及其数据模型、同目录 spy/；禁止 UI 组件/导航/Toast/资源宏等（完整清单以 profile 的 `ut-ui-import-ban` 与 addendum 为准）。请将 UI 侧验证下沉到 device-testing 真机测试。',
  }];
}

function checkBoundariesAllStubbed(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'boundaries_all_stubbed',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'boundaries_all_stubbed'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  if (utFiles.length === 0) {
    return [{
      id: 'boundaries_all_stubbed',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'boundaries_all_stubbed'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const missing: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    const coord = (uc.coordinator ?? '').toLowerCase();
    const idLower = uc.id.toLowerCase().replace(/_/g, '');
    const relatedUts = utFiles.filter(f => {
      const base = path.basename(f.path).toLowerCase();
      return (
        (coord && base.includes(coord)) ||
        base.includes(idLower) ||
        (uc.coordinator && f.content.includes(uc.coordinator))
      );
    });
    if (relatedUts.length === 0) {
      missing.push(`${uc.id}: 未找到测试该 UseCase 的 UT 文件（按 coordinator="${uc.coordinator}" 或 id 匹配）`);
      continue;
    }

    for (const b of uc.data_boundaries ?? []) {
      const stubPatterns = [
        new RegExp(`new\\s+Spy${b.type}\\s*\\(`),
        new RegExp(`new\\s+Fake${b.type}\\s*\\(`),
        new RegExp(`new\\s+Stub${b.type}\\s*\\(`),
        // 允许直接替换全局/模块级单例的 stub 方案（如 jest.spyOn 风格）——宽松匹配
        new RegExp(`\\b${b.type}\\.prototype\\.\\w+\\s*=`),
      ];
      const found = relatedUts.some(f => stubPatterns.some(re => re.test(f.content)));
      if (!found) {
        missing.push(`${uc.id} > data_boundary[${b.name}]: UT 中未发现 new Spy${b.type}(... / Fake${b.type} / Stub${b.type} / ${b.type}.prototype.* = 形式的替身`);
      }
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'boundaries_all_stubbed',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'boundaries_all_stubbed'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UseCase 的 data_boundaries 都在 UT 中得到了替身（Spy/Fake/Stub）。',
    }];
  }

  return [{
    id: 'boundaries_all_stubbed',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'boundaries_all_stubbed'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 个 data_boundary 未在 UT 中打桩：\n${truncateList(missing, 10)}`,
    suggestion: '请在 UT 中为每个 data_boundary.type 提供替身（SpyXxx/FakeXxx/StubXxx 子类，或直接替换原型方法），避免 UT 触发真实云/本地/系统调用。',
  }];
}

function checkItNameHasAcOrBranchTag(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'it_name_has_ac_or_branch_tag',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'it_name_has_ac_or_branch_tag'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const untagged: string[] = [];
  const affected: string[] = [];
  for (const { path: p, content } of utFiles) {
    if (isSuiteEntryShim(ctx, content)) continue;
    const blocks = extractItBlocks(content);
    for (const b of blocks) {
      if (!/^\s*\[(AC|BRANCH)-/.test(b.name)) {
        untagged.push(`${p}: "${b.name}"`);
        affected.push(p);
      }
    }
  }

  if (untagged.length === 0) {
    return [{
      id: 'it_name_has_ac_or_branch_tag',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'it_name_has_ac_or_branch_tag'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 it() 用例均带有 [AC-X] 或 [BRANCH-X] 起始标签。',
    }];
  }

  return [{
    id: 'it_name_has_ac_or_branch_tag',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'it_name_has_ac_or_branch_tag'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${untagged.length} 个 it() 用例无追溯标签：\n${truncateList(untagged, 15)}`,
    affected_files: [...new Set(affected)],
    suggestion: 'it() 名称必须以 [AC-xxx] 或 [BRANCH-xxx] 开头，可组合使用（如 [BRANCH-happy_path][AC-1]）。',
  }];
}

function checkItDrivesFlow(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'it_drives_flow',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'it_drives_flow'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const spec = loadUseCaseSpec(ctx);
  const strict = !!spec;

  const weak: string[] = [];
  const affected: string[] = [];

  const portCallRe = /(callLog|calls|\.call(?:ed|Count))\b/g;
  const stateRe = /\.\s*state\s*\.\s*\w+|phase\s*[:=]\s*['"]?\w+/g;

  for (const { path: p, content } of utFiles) {
    if (isSuiteEntryShim(ctx, content)) continue;
    const blocks = extractItBlocks(content);
    for (const b of blocks) {
      const portHits = b.body.match(portCallRe) ?? [];
      const stateHits = b.body.match(stateRe) ?? [];
      const expectHits = (b.body.match(/expect\s*\(/g) ?? []).length;

      let ok: boolean;
      if (strict) {
        ok = portHits.length >= 2 && stateHits.length >= 2 && expectHits >= 2;
      } else {
        // 无 use-cases.yaml：退化为基本健康度（至少有 2 次 expect，避免空用例）
        ok = expectHits >= 2;
      }
      if (!ok) {
        weak.push(
          `${p}: "${b.name}" — portRefs=${portHits.length} stateRefs=${stateHits.length} expects=${expectHits}`,
        );
        affected.push(p);
      }
    }
  }

  if (weak.length === 0) {
    return [{
      id: 'it_drives_flow',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'it_drives_flow'),
      severity: 'MAJOR',
      status: 'PASS',
      details: strict
        ? '所有 it() 均满足"端到端驱动"启发式（≥2 port 引用 + ≥2 state 断言 + ≥2 expect）。'
        : '无 use-cases.yaml，按基础规则（≥2 expect）检测通过。',
    }];
  }

  return [{
    id: 'it_drives_flow',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'it_drives_flow'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${weak.length} 个 it() 用例驱动力不足：\n${truncateList(weak, 15)}`,
    affected_files: [...new Set(affected)],
    suggestion: strict
      ? '有 use-cases.yaml 时每条 it() 应：(1) 调用 coordinator 的命名方法驱动；(2) 对 Spy/Fake/Stub 的 callLog/.calls 做 ≥2 次调用序列断言；(3) 对业务状态/phase 做 ≥2 次断言。'
      : '每条 it() 至少包含 ≥2 个 expect()，避免空断言用例。',
  }];
}

function checkDagCohesion(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec || dags.length === 0) {
    return [{
      id: 'dag_cohesion',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_cohesion'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: spec ? '无 DAG 文件可分析。' : 'use-cases.yaml 不存在，跳过。',
    }];
  }

  const issues: string[] = [];

  const byId = new Map<string, Array<{ path: string; dag: DagFile }>>();
  for (const d of dags) {
    const ucId = d.dag.use_case;
    if (!ucId) continue;
    if (!byId.has(ucId)) byId.set(ucId, []);
    byId.get(ucId)!.push(d);
  }

  for (const uc of spec.use_cases ?? []) {
    const group = byId.get(uc.id) ?? [];
    if (group.length === 0) continue;
    const allBranchIds = new Set<string>();
    const dupes: string[] = [];
    for (const g of group) {
      const b = Array.isArray(g.dag.branches) ? g.dag.branches : [];
      for (const id of b) {
        if (allBranchIds.has(id)) dupes.push(`${uc.id} > branch "${id}" 在多个 DAG 重复（最后一次出现：${g.path}）`);
        else allBranchIds.add(id);
      }
    }
    for (const d of dupes) issues.push(d);

    const expected = new Set((uc.branches ?? []).map(b => b.id));
    for (const want of expected) {
      if (!allBranchIds.has(want)) {
        issues.push(`${uc.id}: branch "${want}" 未被任何 DAG 覆盖`);
      }
    }
  }

  if (issues.length === 0) {
    return [{
      id: 'dag_cohesion',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_cohesion'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '同一 UseCase 的 DAG 集合分支无重叠、且全覆盖。',
    }];
  }

  return [{
    id: 'dag_cohesion',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_cohesion'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${issues.length} 处 DAG 分支分工问题：\n${truncateList(issues, 15)}`,
    suggestion: '同一个 UseCase 的所有 DAG 应通过 branches[] 分工互不重叠，且并集覆盖 use-cases.yaml 中除 device_only 外的全部 branches。',
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkDagToAcceptance(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance?.criteria?.length) {
    return [{
      id: 'dag_to_acceptance',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'dag_to_acceptance'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'acceptance.yaml 无 criteria 列表。',
    }];
  }

  if (dags.length === 0) {
    return [{
      id: 'dag_to_acceptance',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'dag_to_acceptance'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const unlinkedAssertions: string[] = [];
  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (node.type === 'assertion') {
        if (!node.linked_acceptance?.length) {
          unlinkedAssertions.push(`${dagPath} > ${node.id}: assertion 节点无 linked_acceptance`);
        } else {
          for (const ac of node.linked_acceptance) {
            const exists = acceptance.criteria.some(c => c.id === ac) ||
              acceptance.boundaries?.some(b => b.id === ac);
            if (!exists) {
              unlinkedAssertions.push(`${dagPath} > ${node.id}: ${ac} 不在 acceptance.yaml 中`);
            }
          }
        }
      }
    }
  }

  if (unlinkedAssertions.length === 0) {
    return [{
      id: 'dag_to_acceptance',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'dag_to_acceptance'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '所有 DAG assertion 节点正确关联到 acceptance.yaml 中的 AC/BD 编号。',
    }];
  }

  return [{
    id: 'dag_to_acceptance',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'dag_to_acceptance'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${unlinkedAssertions.length} 个 assertion 节点的追溯问题：\n${truncateList(unlinkedAssertions, 10)}`,
    suggestion: 'assertion 节点必须有 linked_acceptance 且引用的 AC/BD 编号必须在 acceptance.yaml 中存在。',
  }];
}

function checkAcceptanceCoverage(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dagsAreCharacterization(dags)) {
    return [{
      id: 'acceptance_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'acceptance_coverage'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '全部 flow_type=characterization，跳过 acceptance_coverage。',
    }];
  }
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance?.criteria?.length) {
    return [{
      id: 'acceptance_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'acceptance_coverage'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 无 criteria 列表。',
    }];
  }

  if (dags.length === 0) {
    return [{
      id: 'acceptance_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'acceptance_coverage'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const coveredACs = new Set<string>();
  for (const { dag } of dags) {
    for (const ac of dag.linked_acceptance ?? []) coveredACs.add(ac);
    for (const bd of dag.linked_boundaries ?? []) coveredACs.add(bd);
    for (const node of dag.nodes ?? []) {
      for (const ac of node.linked_acceptance ?? []) coveredACs.add(ac);
    }
  }

  // v2 修订：分母只计 ut_layer in [unit, both]（未声明 ut_layer 的按 unit 兜底，保持向后兼容）
  const isUnitLayer = (layer?: string) => layer === 'unit' || layer === 'both' || layer === undefined;

  const p0p1Criteria = acceptance.criteria.filter(c =>
    (c.priority === 'P0' || c.priority === 'P1') && isUnitLayer(c.ut_layer),
  );
  const uncoveredP0P1 = p0p1Criteria.filter(c => !coveredACs.has(c.id));

  const allBoundaries = (acceptance.boundaries ?? []).filter(b => isUnitLayer(b.ut_layer));
  const uncoveredBD = allBoundaries.filter(b => !coveredACs.has(b.id));

  const p0Filtered = acceptance.criteria.filter(c => c.priority === 'P0' && isUnitLayer(c.ut_layer));
  const p0Count = p0Filtered.length;
  const p0Covered = p0Filtered.filter(c => coveredACs.has(c.id)).length;
  const p1Filtered = acceptance.criteria.filter(c => c.priority === 'P1' && isUnitLayer(c.ut_layer));
  const p1Count = p1Filtered.length;
  const p1Covered = p1Filtered.filter(c => coveredACs.has(c.id)).length;

  const deviceOnly = acceptance.criteria.filter(c => c.ut_layer === 'device').length;

  const details: string[] = [];
  details.push(`P0 覆盖率(UT 分母): ${p0Covered}/${p0Count}`);
  details.push(`P1 覆盖率(UT 分母): ${p1Covered}/${p1Count}`);
  details.push(`BD 覆盖率(UT 分母): ${allBoundaries.length - uncoveredBD.length}/${allBoundaries.length}`);
  if (deviceOnly > 0) details.push(`（${deviceOnly} 条 ut_layer=device 的 AC 已从 UT 分母中排除，交 device-testing 负责）`);

  if (uncoveredP0P1.length > 0) {
    details.push(`未覆盖的 P0/P1 AC:`);
    for (const c of uncoveredP0P1) {
      details.push(`  - ${c.id} (${c.priority}): ${c.description}`);
    }
  }

  if (uncoveredP0P1.length === 0) {
    return [{
      id: 'acceptance_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'acceptance_coverage'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: details.join('\n'),
    }];
  }

  return [{
    id: 'acceptance_coverage',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'acceptance_coverage'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: details.join('\n'),
    suggestion: `请为未覆盖的 ${uncoveredP0P1.length} 个 P0/P1 AC 补充 DAG 和 UT。`,
  }];
}

function checkDagToSource(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dags.length === 0) {
    return [{
      id: 'dag_to_source',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'dag_to_source'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件可分析。',
    }];
  }

  const missingFunctions: string[] = [];
  const affectedFiles: string[] = [];

  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (node.type === 'assertion' || !node.source?.file || !node.source?.function) continue;

      const fullPath = path.join(ctx.projectRoot, node.source.file);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const funcName = node.source.function;
      const funcPatterns = [
        new RegExp(`\\b${funcName}\\s*\\(`),
        new RegExp(`\\b${funcName}\\s*<`),
        new RegExp(`async\\s+${funcName}\\s*\\(`),
      ];

      const found = funcPatterns.some(p => p.test(content));
      if (!found) {
        missingFunctions.push(`${dagPath} > ${node.id}: ${node.source.file}::${funcName} 函数未找到`);
        affectedFiles.push(dagPath);
      }
    }
  }

  if (missingFunctions.length === 0) {
    return [{
      id: 'dag_to_source',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'dag_to_source'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 DAG 节点的 source.function 均在对应文件中存在。',
    }];
  }

  return [{
    id: 'dag_to_source',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'dag_to_source'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missingFunctions.length} 个节点的 source.function 在文件中未找到：\n${truncateList(missingFunctions, 10)}`,
    affected_files: [...new Set(affectedFiles)],
    suggestion: '请确认 DAG source.function 与实际代码中的函数名一致。',
  }];
}

// --------------------------------------------------------------------------
// v2 新增 Traceability Checks — branch / AC / BD 覆盖
// --------------------------------------------------------------------------

function collectItNames(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): string[] {
  const names: string[] = [];
  for (const { content } of utFiles) {
    if (isSuiteEntryShim(ctx, content)) continue;
    const blocks = extractItBlocks(content);
    for (const b of blocks) names.push(b.name);
  }
  return names;
}

function collectItBlocks(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): Array<{ path: string; name: string; body: string }> {
  const blocks: Array<{ path: string; name: string; body: string }> = [];
  for (const f of utFiles) {
    if (isSuiteEntryShim(ctx, f.content)) continue;
    for (const b of extractItBlocks(f.content)) {
      blocks.push({ path: f.path, ...b });
    }
  }
  return blocks;
}

function dagsAreCharacterization(dags: Array<{ dag: DagFile }>): boolean {
  return dagsAllCharacterization(dags);
}

function checkOriginTagRequired(
  dags: Array<{ path: string; dag: DagFile }>,
  ctx: CheckContext,
): CheckResult[] {
  const charDags = dags.filter(d => d.dag.flow_type === 'characterization');
  if (charDags.length === 0) {
    return [{
      id: 'origin_tag_required',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'origin_tag_required'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 flow_type=characterization 的 DAG，跳过。',
    }];
  }
  const missing: string[] = [];
  for (const { path, dag } of charDags) {
    for (const n of dag.nodes ?? []) {
      if (n.type === 'assertion') continue;
      if (!n.origin?.trim()) missing.push(`${path} > ${n.id}`);
    }
  }
  if (missing.length === 0) {
    return [{
      id: 'origin_tag_required',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'origin_tag_required'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `characterization DAG 共 ${charDags.length} 份，非 assertion 节点均已标注 origin。`,
    }];
  }
  return [{
    id: 'origin_tag_required',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'origin_tag_required'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 个节点缺少 origin：\n${truncateList(missing, 12)}`,
  }];
}

function checkCharacterizationTraceMatches(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  const charDags = dags.filter(d => d.dag.flow_type === 'characterization');
  if (charDags.length === 0) {
    return [{
      id: 'characterization_trace_matches',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'characterization_trace_matches'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '无 characterization flow，跳过。',
    }];
  }
  const charIts = utFiles.flatMap(f => {
    const blocks = collectItBlocks(ctx, [f]);
    return blocks.filter(b => /\[CHAR-/i.test(b.name)).map(b => b.name);
  });
  if (charIts.length === 0) {
    return [{
      id: 'characterization_trace_matches',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'characterization_trace_matches'),
      severity: 'MAJOR',
      status: 'WARN',
      details: '存在 characterization DAG 但未找到 [CHAR-*] 命名的 it()。',
    }];
  }
  return [{
    id: 'characterization_trace_matches',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'characterization_trace_matches'),
    severity: 'MAJOR',
    status: 'PASS',
    details: `characterization UT 用例 ${charIts.length} 条；DAG trace 与 UT 序列一致性由 verifier 语义复核。`,
  }];
}

function checkBranchCoverageFull(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  dags?: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  if (dags && dagsAreCharacterization(dags)) {
    return [{
      id: 'branch_coverage_full',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'branch_coverage_full'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '全部 flow_type=characterization，跳过 branch_coverage_full。',
    }];
  }
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'branch_coverage_full',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'branch_coverage_full'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  if (utFiles.length === 0) {
    return [{
      id: 'branch_coverage_full',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'branch_coverage_full'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const blocks = collectItBlocks(ctx, utFiles);
  const missing: string[] = [];

  for (const uc of spec.use_cases ?? []) {
    for (const br of uc.branches ?? []) {
      const tagRe = new RegExp(`\\[BRANCH-${br.id}\\]`);
      const found = blocks.some(b =>
        tagRe.test(b.name) || b.body.includes(br.id),
      );
      if (!found) {
        missing.push(`${uc.id} > branch "${br.id}": 无对应 it() 用例`);
      }
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'branch_coverage_full',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'branch_coverage_full'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UseCase 分支都有对应 UT 用例。',
    }];
  }

  return [{
    id: 'branch_coverage_full',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'branch_coverage_full'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 个 branch 无 UT 覆盖：\n${truncateList(missing, 15)}`,
    suggestion: `请为每个 branch 补充一条 it()，用例名建议格式 [BRANCH-<id>][AC-<id>] ...；参考 ${utSuggestionPaths(ctx).branchExampleTestRel}。`,
  }];
}

function acHasUtTagOrBranchCoverage(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  ac: { id: string; linked_branch?: string },
): boolean {
  const itNames = collectItNames(ctx, utFiles);
  const blocks = collectItBlocks(ctx, utFiles);
  const acTagRe = new RegExp(`\\[AC-${ac.id.replace(/^AC-/, '').replace(/^BD-/, '')}\\]`);
  const directTagRe = new RegExp(`\\[${ac.id}\\]`);
  const foundByTag = itNames.some(n => directTagRe.test(n) || acTagRe.test(n));
  const branchId = ac.linked_branch;
  const foundByBranch = !!branchId && blocks.some(b =>
    new RegExp(`\\[BRANCH-${branchId}\\]`).test(b.name) || b.body.includes(branchId),
  );
  return foundByTag || foundByBranch;
}

function collectTargetUnitBothP0P1(acceptance: AcceptanceSpec) {
  const isUnit = (layer?: string) => layer === 'unit' || layer === 'both' || layer === undefined;
  return [
    ...(acceptance.criteria ?? [])
      .filter(c => (c.priority === 'P0' || c.priority === 'P1') && isUnit(c.ut_layer))
      .map(c => ({ id: c.id, priority: c.priority, ut_layer: c.ut_layer, description: c.description, linked_branch: (c as { linked_branch?: string }).linked_branch, kind: 'criterion' as const })),
    ...(acceptance.boundaries ?? [])
      .filter(b => (b.priority === 'P0' || b.priority === 'P1') && isUnit(b.ut_layer))
      .map(b => ({ id: b.id, priority: b.priority, ut_layer: b.ut_layer, description: b.description, linked_branch: (b as { linked_branch?: string }).linked_branch, kind: 'boundary' as const })),
  ];
}

function checkUtCoverageEvidencePresent(ctx: CheckContext): CheckResult[] {
  const scope = listUnitBothScopeItems(ctx.featureSpec.acceptance);
  if (scope.length === 0) {
    return [{
      id: 'ut_coverage_evidence_present',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 unit/both UT 范围，跳过 coverage-evidence.json 强制。',
    }];
  }
  const rel = coverageEvidenceRel(ctx.feature);
  const acceptance = ctx.featureSpec.acceptance;
  const targetAcs = acceptance ? collectTargetUnitBothP0P1(acceptance) : [];
  const ev = loadCoverageEvidence(ctx.projectRoot, ctx.feature);
  if (!ev) {
    if (targetAcs.length > 0) {
      return [{
        id: 'ut_coverage_evidence_present',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `缺少 ${rel}；存在 in-scope unit/both P0/P1（${targetAcs.length} 条），须由 business-ut 产出 coverage-evidence.json。`,
        suggestion: `写入 ${rel}，或为每条 AC/BD 提供可解析的 UT 标签 / DAG linked_acceptance（见 coverage-evidence-schema）。`,
      }];
    }
    return [{
      id: 'ut_coverage_evidence_present',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `缺少 ${rel}；无 P0/P1 unit/both 强制范围，建议 business-ut 仍写入以便追溯。`,
    }];
  }
  return [{
    id: 'ut_coverage_evidence_present',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `已找到 ${rel}（schema_version=${ev.schema_version ?? 'n/a'}）。`,
  }];
}

function checkUtCoverageEvidenceMappingsComplete(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  acReport?: AcCoverageReport | null,
): CheckResult[] {
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) {
    return [{
      id: 'ut_coverage_evidence_mappings_complete',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 acceptance.yaml。',
    }];
  }
  const targetAcs = collectTargetUnitBothP0P1(acceptance);
  if (targetAcs.length === 0) {
    return [{
      id: 'ut_coverage_evidence_mappings_complete',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 unit/both P0/P1 范围，跳过 mapping 完整性。',
    }];
  }
  const evidence = loadCoverageEvidence(ctx.projectRoot, ctx.feature);
  if (!evidence) {
    return [{
      id: 'ut_coverage_evidence_mappings_complete',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 coverage-evidence.json（由 present 规则 FAIL）。',
    }];
  }
  const dagCtx = loadDagFiles(ctx).map(d => ({ path: d.path, dag: d.dag }));
  const gaps: string[] = [];
  for (const ac of targetAcs) {
    const row = evidence.mappings?.find(m => m.scope_id === ac.id);
    if (!row) {
      gaps.push(`${ac.id}: 缺少 mappings[] 行`);
      continue;
    }
    const byTags = acHasUtTagOrBranchCoverage(ctx, utFiles, ac);
    if (!mappingBackedByResolvableEvidence(
      row,
      dagCtx,
      byTags,
      ctx.projectRoot,
      ctx.feature,
      acReport,
    )) {
      gaps.push(`${ac.id}: mapping 无有效依据（须与 evidence_source 一致：ut_tags / DAG linked / ac-coverage ut_covered）`);
    }
  }
  if (gaps.length === 0) {
    return [{
      id: 'ut_coverage_evidence_mappings_complete',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `coverage-evidence.json 含 ${targetAcs.length} 条 P0/P1 unit/both 的完整 mapping 且均有依据。`,
    }];
  }
  return [{
    id: 'ut_coverage_evidence_mappings_complete',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${gaps.length} 条 P0/P1 mapping 不完整或无依据：\n${truncateList(gaps, 12)}`,
    suggestion: 'business-ut 须为每条 in-scope P0/P1 AC/BD 写入 mappings[]（evidence_source + 可解析依据）。',
  }];
}

function checkUtCoverageEvidenceResolves(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  acReport?: AcCoverageReport | null,
): CheckResult[] {
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) {
    return [{
      id: 'ut_coverage_evidence_resolves',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 acceptance.yaml。',
    }];
  }
  const targetAcs = collectTargetUnitBothP0P1(acceptance);
  if (targetAcs.length === 0) {
    return [{
      id: 'ut_coverage_evidence_resolves',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 unit/both P0/P1 范围，跳过。',
    }];
  }
  if (utFiles.length === 0) {
    return [{
      id: 'ut_coverage_evidence_resolves',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '无 UT 文件；in-scope unit/both 无法解析覆盖证据。',
      suggestion: '补 UT 或写入 coverage-evidence.json 说明 allowlist 降级原因。',
    }];
  }

  const evidence = loadCoverageEvidence(ctx.projectRoot, ctx.feature);
  const missing: string[] = [];

  const dagCtx = loadDagFiles(ctx).map(d => ({ path: d.path, dag: d.dag }));

  for (const ac of targetAcs) {
    const byTags = acHasUtTagOrBranchCoverage(ctx, utFiles, ac);
    const row = evidence?.mappings?.find(m => m.scope_id === ac.id);
    if (!scopeHasResolvableEvidence({
      projectRoot: ctx.projectRoot,
      feature: ctx.feature,
      scopeId: ac.id,
      dags: dagCtx,
      hasUtTag: byTags,
      mapping: row,
      acReport,
    })) {
      missing.push(`${ac.id} (${ac.priority}${ac.ut_layer ? `, ut_layer=${ac.ut_layer}` : ''})`);
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'ut_coverage_evidence_resolves',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `所有 in-scope unit/both P0/P1（${targetAcs.length} 条）均有可解析覆盖证据（mapping 或 UT 标签/branch）。`,
    }];
  }

  return [{
    id: 'ut_coverage_evidence_resolves',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 条 in-scope AC/BD 无覆盖证据（非 allowlist SKIP）：\n${truncateList(missing, 15)}`,
    suggestion: '补 it() 标签、[BRANCH-*]、ephemeral/archived DAG，或在 coverage-evidence.json 登记映射。',
  }];
}

function checkUtCasePerUnitAc(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  dags?: Array<{ path: string; dag: DagFile }>,
  acReport?: AcCoverageReport | null,
): CheckResult[] {
  if (dags && dagsAreCharacterization(dags)) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '全部 flow_type=characterization，跳过 ut_case_per_unit_ac。',
    }];
  }
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance?.criteria?.length) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 无 criteria 列表。',
    }];
  }
  const targetAcs = collectTargetUnitBothP0P1(acceptance);
  if (targetAcs.length === 0) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 unit/both P0/P1 范围（allowlist：无 UT scope）。',
    }];
  }
  if (utFiles.length === 0) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '无 UT 文件可分析；in-scope unit/both 缺证据 → FAIL/INCOMPLETE。',
    }];
  }

  const evidence = loadCoverageEvidence(ctx.projectRoot, ctx.feature);
  const dagCtx = (dags ?? loadDagFiles(ctx)).map(d => ({ path: d.path, dag: d.dag }));
  const missing: string[] = [];
  for (const ac of targetAcs) {
    const byTags = acHasUtTagOrBranchCoverage(ctx, utFiles, ac);
    const row = evidence?.mappings?.find(m => m.scope_id === ac.id);
    if (!scopeHasResolvableEvidence({
      projectRoot: ctx.projectRoot,
      feature: ctx.feature,
      scopeId: ac.id,
      dags: dagCtx,
      hasUtTag: byTags,
      mapping: row,
      acReport,
    })) {
      missing.push(`${ac.id} (${ac.priority}${ac.ut_layer ? `, ut_layer=${ac.ut_layer}` : ''}): ${ac.description}`);
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `所有 ut_layer∈{unit,both} 且 P0/P1 的 ${targetAcs.length} 条 AC/BD 均有对应 UT 用例。`,
    }];
  }

  return [{
    id: 'ut_case_per_unit_ac',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 条 in-scope AC/BD 无覆盖证据：\n${truncateList(missing, 15)}`,
    suggestion: '为上述 AC/BD 补 it() 用例，其名称以 [AC-<id>] 或 [BRANCH-<linked_branch>] 起始。',
  }];
}

function checkBoundaryCoverage(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  dags: Array<{ path: string; dag: DagFile }>,
): CheckResult[] {
  const acceptance = ctx.featureSpec.acceptance;
  const spec = loadUseCaseSpec(ctx);
  const bds = acceptance?.boundaries ?? [];
  if (bds.length === 0) {
    return [{
      id: 'boundary_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'boundary_coverage'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'acceptance.yaml 未声明 boundaries。',
    }];
  }

  const isUnit = (layer?: string) => layer === 'unit' || layer === 'both' || layer === undefined;
  const targetBds = bds.filter(b => isUnit(b.ut_layer));

  if (targetBds.length === 0) {
    return [{
      id: 'boundary_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'boundary_coverage'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '无 ut_layer∈{unit,both} 的 boundary，全部交 device-testing。',
    }];
  }

  const itNames = collectItNames(ctx, utFiles);
  const blocks = collectItBlocks(ctx, utFiles);

  // dag-level AC/BD 引用
  const dagLinked = new Set<string>();
  for (const { dag } of dags) {
    for (const id of dag.linked_acceptance ?? []) dagLinked.add(id);
    for (const id of dag.linked_boundaries ?? []) dagLinked.add(id);
    for (const node of dag.nodes ?? []) {
      for (const id of node.linked_acceptance ?? []) dagLinked.add(id);
    }
  }

  // 所有 use-cases.yaml 的 branches linked_acceptance
  const branchLinked = new Set<string>();
  for (const uc of spec?.use_cases ?? []) {
    for (const br of uc.branches ?? []) {
      for (const id of br.linked_acceptance ?? []) branchLinked.add(id);
    }
  }

  const missing: string[] = [];
  for (const bd of targetBds) {
    const directRe = new RegExp(`\\[${bd.id}\\]`);
    const foundByIt = itNames.some(n => directRe.test(n));
    const foundByBody = !!bd.linked_branch && blocks.some(b =>
      new RegExp(`\\[BRANCH-${bd.linked_branch}\\]`).test(b.name) || b.body.includes(bd.linked_branch!),
    );
    const foundByDag = dagLinked.has(bd.id);
    const foundByBranchSpec = branchLinked.has(bd.id);

    if (!foundByIt && !foundByBody && !foundByDag && !foundByBranchSpec) {
      missing.push(`${bd.id} (${bd.priority}): ${bd.description}`);
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'boundary_coverage',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'boundary_coverage'),
      severity: 'MAJOR',
      status: 'PASS',
      details: `所有 ${targetBds.length} 条单元层 boundary 均有对应 UT / DAG / branch 追溯。`,
    }];
  }

  return [{
    id: 'boundary_coverage',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'boundary_coverage'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${missing.length} 条 boundary 缺 UT 覆盖：\n${truncateList(missing, 15)}`,
    suggestion: '请为上述 boundary 补一条 it()（建议 `[AC-x][BD-y]` 组合标签，勿单独 `[BD-xx]` 开头）或将其纳入 use-cases.yaml branch 的 linked_acceptance。',
  }];
}

// --------------------------------------------------------------------------
// Testability audit + mock-plan (v2.3)
// --------------------------------------------------------------------------

function isUnitUtLayer(layer?: string): boolean {
  return layer === 'unit' || layer === 'both' || layer === undefined;
}

/** AC/BD id 须被 testability-audit 覆盖 */
function collectUnitScopeAcceptanceIds(ctx: CheckContext): string[] {
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) return [];
  const ids: string[] = [];
  for (const c of acceptance.criteria ?? []) {
    if (isUnitUtLayer(c.ut_layer)) ids.push(c.id);
  }
  for (const b of acceptance.boundaries ?? []) {
    if (isUnitUtLayer(b.ut_layer)) ids.push(b.id);
  }
  return ids;
}

function testabilityAuditPath(ctx: CheckContext): string {
  return featureArtifactPath(ctx.projectRoot, ctx.feature, 'testability-audit.md');
}

function mockPlanPath(ctx: CheckContext): string {
  return featureArtifactPath(ctx.projectRoot, ctx.feature, 'mock-plan.yaml');
}

function auditLevelNorm(level?: string): string {
  return (level ?? '').trim().toUpperCase();
}

function auditRecordsNeedMockPlan(records: TestabilityAuditRecord[]): TestabilityAuditRecord[] {
  return records.filter(r => {
    const L = auditLevelNorm(r.testability_level);
    return L === 'L0' || L === 'L1' || L === 'L2';
  });
}

function resolveDagNodeClassName(ctx: CheckContext, node: DagNode): string | undefined {
  if (node.source?.class) return node.source.class;
  const file = node.source?.file;
  if (!file || !ctx.featureSpec.contracts?.interfaces?.length) return undefined;
  const norm = file.replace(/\\/g, '/');
  const iface = ctx.featureSpec.contracts.interfaces.find(i => i.file.replace(/\\/g, '/') === norm);
  return iface?.class;
}

function resolveAuditEntryPoint(ctx: CheckContext, record: TestabilityAuditRecord): { cls: string; method: string } | undefined {
  const symbol = record.entry_point?.symbol?.trim();
  if (symbol && symbol.includes('.')) {
    const parts = symbol.split('.');
    const method = parts.pop()?.trim();
    const cls = parts.join('.').trim();
    if (cls && method) return { cls, method };
  }

  const file = record.entry_point?.file?.trim();
  if (!file || !ctx.featureSpec.contracts?.interfaces?.length) return undefined;
  const norm = file.replace(/\\/g, '/');
  const iface = ctx.featureSpec.contracts.interfaces.find(i => i.file.replace(/\\/g, '/') === norm);
  if (!iface) return undefined;

  const method = symbol && !symbol.includes('.') ? symbol : undefined;
  if (method) return { cls: iface.class, method };

  return undefined;
}

function checkUtTestabilityAuditPresent(ctx: CheckContext): CheckResult[] {
  const id = 'ut_testability_audit_present';
  const requiredIds = collectUnitScopeAcceptanceIds(ctx);
  if (requiredIds.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 无 ut_layer∈{unit,both} 的 AC/BD，跳过 testability-audit 门禁。',
    }];
  }

  const p = testabilityAuditPath(ctx);
  if (!fs.existsSync(p)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `缺少 ${path.relative(ctx.projectRoot, p).replace(/\\/g, '/')}\n` +
        `模板：${utSuggestionPaths(ctx).testabilityAuditTemplateRel}`,
      suggestion: '为每条 unit/both 的 AC/BD 写入 testability-audit.md（Markdown 内嵌 YAML，根字段 records[]）',
    }];
  }

  const records = parseTestabilityAuditFile(p);
  const byAc = new Map(records.map(r => [r.acceptance_id, r]));
  const missing = requiredIds.filter(aid => !byAc.has(aid));

  if (missing.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `testability-audit 未覆盖 ${missing.length} 条 unit/both 项：\n${truncateList(missing, 20)}`,
      suggestion: '在 testability-audit.md 的 records[] 中为上述 id 各补一条记录。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `testability-audit 已覆盖全部 ${requiredIds.length} 条 unit/both AC/BD。`,
  }];
}

function checkUtUnsupportedTargetsHandled(ctx: CheckContext): CheckResult[] {
  const id = 'ut_unsupported_targets_handled';

  const p = testabilityAuditPath(ctx);
  if (!fs.existsSync(p)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'testability-audit.md 不存在（由 ut_testability_audit_present 先行阻断）。',
    }];
  }

  const records = parseTestabilityAuditFile(p);
  const l3 = records.filter(r => auditLevelNorm(r.testability_level) === 'L3');
  if (l3.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 L3（不可测）记录，跳过 option_a/b 处置检查。',
    }];
  }

  const acceptance = ctx.featureSpec.acceptance;

  const gapFiles = findGapNotesFiles(ctx.projectRoot, ctx.feature);
  let approvedCount = 0;
  for (const g of gapFiles) {
    approvedCount += readApprovedMutations(g).size;
  }

  const issues: string[] = [];
  for (const r of l3) {
    const sel = (r.selected ?? '').trim();
    if (sel !== 'option_a' && sel !== 'option_b') {
      issues.push(`${r.acceptance_id}: L3 须设置 selected 为 option_a 或 option_b（当前：${sel || '（空）'}）`);
      continue;
    }
    if (sel === 'option_a') {
      if (!acceptance) {
        issues.push(`${r.acceptance_id}: option_a 需要 acceptance.yaml，但文件不可用`);
      } else if (!acceptanceHasDeviceFocusRef(acceptance, r.acceptance_id)) {
        issues.push(
          `${r.acceptance_id}: option_a 须在 acceptance.yaml 对应条目的 device_focus 中声明真机要点（含 ${r.acceptance_id} 引用）`,
        );
      }
    } else {
      if (approvedCount === 0) {
        issues.push(
          `${r.acceptance_id}: option_b 要求 gap-notes.md > approved_src_mutations[] 至少登记 1 条授权`,
        );
      }
    }
  }

  if (issues.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${issues.length} 条 L3 处置不合规：\n${truncateList(issues, 15)}`,
      suggestion:
        'option_a → 在 acceptance.yaml 对应 AC/BD 填写 device_focus；option_b → 按 business-ut 约束 #12 登记 gap-notes approved_src_mutations 后再改 src/main。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `全部 ${l3.length} 条 L3 记录均已 option_a/b 处置并可追踪。`,
  }];
}

function checkUtMockPlanPresent(ctx: CheckContext, records: TestabilityAuditRecord[]): CheckResult[] {
  const id = 'ut_mock_plan_present';
  const need = auditRecordsNeedMockPlan(records);
  if (need.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 L0/L1/L2 可测性记录，跳过 mock-plan 门禁。',
    }];
  }

  const mp = parseMockPlanFile(mockPlanPath(ctx));
  const entries = getMockPlanEntries(mp);
  if (!mp || entries.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `L0/L1/L2 共 ${need.length} 条，需要 ut/mock-plan.yaml（含 spies[] 或 doubles[]）。\n` +
        `模板：${utSuggestionPaths(ctx).mockPlanSchemaTemplateRel}`,
      suggestion:
        '写入 doc/features/<feature>/ut/mock-plan.yaml，声明 test double（strategy: spy | mockkit | fake | prototype_patch）与 presets。',
    }];
  }

  const missingSpyForDep: string[] = [];
  for (const rec of need) {
    const entry = resolveAuditEntryPoint(ctx, rec);
    const deps = rec.dependencies ?? [];
    if (deps.length === 0 && !entry) {
      missingSpyForDep.push(`${rec.acceptance_id}: L0/L1/L2 记录缺少 dependencies 且无法从 entry_point 映射 contracts 接口`);
      continue;
    }
    for (const d of deps) {
      const kind = (d.kind ?? '').toLowerCase();
      if (kind === 'pure') continue;
      const ok = entries.some(s => s.target_class === d.name);
      if (!ok) {
        missingSpyForDep.push(`${rec.acceptance_id}: 依赖 ${d.name}（kind=${d.kind || '?'}) 缺少 mock-plan target_class`);
      }
    }
  }

  if (missingSpyForDep.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `mock-plan 缺少与审计依赖对齐的 spy：\n${truncateList(missingSpyForDep, 15)}`,
      suggestion:
        '补全 testability-audit.md 的 dependencies，或在 mock-plan.yaml 中为非 pure 外部依赖声明 test double（勿将被测 entry_point 写入 mock-plan）。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `mock-plan 满足 ${need.length} 条 L0/L1/L2 记录的非 pure 依赖声明要求（被测 entry_point 不要求出现在 mock-plan）。`,
  }];
}

function collectForbiddenMockkitEntryClasses(
  ctx: CheckContext,
  auditRecords: TestabilityAuditRecord[],
): Set<string> {
  const forbidden = new Set<string>();
  for (const rec of auditRecords) {
    const ep = resolveAuditEntryPoint(ctx, rec);
    if (ep?.cls) forbidden.add(ep.cls);
  }
  const spec = ctx.featureSpec.useCases;
  for (const uc of spec?.use_cases ?? []) {
    const coord = (uc.coordinator ?? '').trim();
    if (coord) forbidden.add(coord);
  }
  return forbidden;
}

function checkUtHypiumMockkitPolicy(
  ctx: CheckContext,
  plan: MockPlanSpec | null,
  utFiles: Array<{ path: string; content: string }>,
  auditRecords: TestabilityAuditRecord[],
): CheckResult[] {
  const id = 'ut_hypium_mockkit_policy';
  const offenders = utFiles.filter(f => utFileImportsHypiumMockkit(f.content));
  if (offenders.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'UT 未从 @ohos/hypium 导入 MockKit/when，跳过 @ohos/hypium mock 策略门禁。',
    }];
  }

  if (!plan || !mockPlanAllowsHypiumMockkit(plan)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `${offenders.length} 个 UT 文件导入了 MockKit 或 hypium when，但 mock-plan 无 strategy=mockkit 条目：\n` +
        truncateList(offenders.map(f => f.path), 10),
      suggestion:
        '在 mock-plan.yaml 为外部边界声明 strategy: mockkit 与 presets；或改用 Spy/whenXxx。禁止在消费者 framework 子模块改 ts-compile.ts。',
    }];
  }

  const missingDoubleStrategy = collectDoublesMissingStrategy(plan);
  if (missingDoubleStrategy.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `mock-plan doubles[] 缺少显式 strategy：\n${truncateList(missingDoubleStrategy, 10)}`,
      suggestion: 'doubles[] 每条须声明 strategy: spy | mockkit | fake | prototype_patch，禁止缺省视为 mockkit。',
    }];
  }

  const contracts = ctx.featureSpec.contracts;
  const ifaceClasses = new Set((contracts?.interfaces ?? []).map(i => i.class));
  const badClass: string[] = [];
  for (const e of getMockPlanEntries(plan)) {
    if (e.strategy !== 'mockkit') continue;
    if (!ifaceClasses.has(e.target_class)) {
      badClass.push(e.target_class);
    }
  }
  if (badClass.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `mockkit 条目的 target_class 须在 contracts.yaml interfaces[] 中：\n${truncateList(badClass, 10)}`,
      suggestion: '仅 mock 已登记的外部 data 边界；禁止 mock 被测 Flow/Coordinator/Page handler。',
    }];
  }

  const forbiddenEntries = collectForbiddenMockkitEntryClasses(ctx, auditRecords);
  const usageIssues: string[] = [];
  for (const f of offenders) {
    for (const msg of collectUtMockkitGovernanceIssues(f.content, plan, forbiddenEntries)) {
      usageIssues.push(`${f.path}: ${msg}`);
    }
  }
  if (usageIssues.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `MockKit/when 用法未与 mock-plan mockkit 条目对齐：\n${truncateList(usageIssues, 15)}`,
      suggestion:
        'MockKit.mock / when(Class.method) 仅允许 mock-plan 已声明的 mockkit 边界与方法；禁止 mock entry_point/coordinator；when 须引用 plan presets[].id。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `${offenders.length} 个 UT 使用 @ohos/hypium MockKit/when，mock-plan mockkit 策略、contracts 与用法追溯均已对齐。`,
  }];
}

function checkUtMockPlanTyped(ctx: CheckContext, plan: MockPlanSpec | null): CheckResult[] {
  const id = 'ut_mock_plan_typed';
  if (!mockPlanHasEntries(plan)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 mock-plan 或 spies 为空，跳过类型化 ts_expr 检查。',
    }];
  }

  const bad = [
    ...collectDoublesMissingStrategy(plan),
    ...collectMockPlanTypedIssues(plan!),
  ];

  if (bad.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${bad.length} 处 preset ts_expr 未通过粗类型断言扫描：\n${truncateList(bad, 15)}`,
      suggestion: '参考 mock-plan-schema.md 的正例，为对象字面量补 "as SomeType" 或使用 new 构造。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: 'mock-plan 全部 preset ts_expr 通过粗校验。',
  }];
}

function checkUtMockPlanContractsConsistent(ctx: CheckContext, plan: MockPlanSpec | null): CheckResult[] {
  const id = 'ut_mock_plan_contracts_consistent';
  const contracts = ctx.featureSpec.contracts;
  if (!mockPlanHasEntries(plan)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 mock-plan 或 spies 为空，跳过与 contracts 对齐检查。',
    }];
  }
  if (!contracts?.interfaces?.length) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'feature 缺少 contracts.yaml interfaces[]，跳过 mock-plan 与契约一致性检查。',
    }];
  }

  const ifaceByClass = new Map(contracts.interfaces.map(i => [i.class, i]));
  const issues: string[] = [];

  for (const spy of getMockPlanEntries(plan)) {
    const iface = ifaceByClass.get(spy.target_class);
    if (!iface) {
      issues.push(`mock-plan target_class="${spy.target_class}" 不在 contracts.yaml interfaces[].class 中`);
      continue;
    }
    const methNames = new Set(iface.methods.map(m => m.name));
    for (const meth of spy.methods ?? []) {
      if (!methNames.has(meth.name)) {
        issues.push(`mock-plan: ${spy.target_class}.${meth.name} 未在 contracts 接口方法表中声明`);
      }
    }
  }

  if (issues.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: truncateList(issues, 20),
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: 'mock-plan 的 target_class / methods 与 contracts.yaml 一致。',
  }];
}

function checkDagSpyPresetResolvable(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
  plan: MockPlanSpec | null,
): CheckResult[] {
  const id = 'dag_spy_preset_resolvable';
  if (dags.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 DAG 文件，跳过 spy_preset 解析。',
    }];
  }

  const nodesWithPreset: Array<{ dagPath: string; nodeId: string; key: string; preset: string }> = [];
  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      const preset = node.spy_preset?.trim();
      if (!preset) continue;
      let cls: string | undefined;
      let meth: string | undefined;
      if (node.type === 'port_call_cloud' || node.type === 'port_call_local') {
        cls = node.boundary?.type;
        meth = node.boundary?.method;
      } else if (node.type === 'async_call') {
        cls = resolveDagNodeClassName(ctx, node);
        meth = node.source?.function;
      } else {
        cls = undefined;
        meth = undefined;
      }
      if (!cls || !meth) {
        nodesWithPreset.push({ dagPath, nodeId: node.id, key: '(无法解析类/方法)', preset });
        continue;
      }
      nodesWithPreset.push({ dagPath, nodeId: node.id, key: `${cls}::${meth}`, preset });
    }
  }

  if (nodesWithPreset.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'PASS',
      details: 'DAG 无 spy_preset 字段（旧 mock_data 写法仍兼容，不强制 spy_preset）。',
    }];
  }

  if (!mockPlanHasEntries(plan)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'DAG 声明了 spy_preset，但 mock-plan.yaml 缺失或 spies/doubles 为空，无法解析 preset id。',
      suggestion: '补齐 ut/mock-plan.yaml，或移除 DAG 中的 spy_preset。',
    }];
  }

  const idx = buildMockPlanPresetIndex(plan!);
  const bad: string[] = [];
  for (const n of nodesWithPreset) {
    if (n.key === '(无法解析类/方法)') {
      bad.push(`${n.dagPath} > ${n.nodeId}: spy_preset=${n.preset} 但缺少 boundary / source 定位类与方法`);
      continue;
    }
    const set = idx.get(n.key);
    if (!set || !set.has(n.preset)) {
      bad.push(`${n.dagPath} > ${n.nodeId}: spy_preset="${n.preset}" 在 mock-plan 的 ${n.key} presets 中不存在`);
    }
  }

  if (bad.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: truncateList(bad, 15),
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `全部 ${nodesWithPreset.length} 处 spy_preset 可在 mock-plan 中解析。`,
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
      id: checkId,
      category: 'structure',
      description: `${checkId} 执行异常`,
      severity: isProgrammerError ? 'BLOCKER' : 'MINOR',
      status: isProgrammerError ? 'FAIL' : 'SKIP',
      details: isProgrammerError
        ? `[Harness 内部错误] ${e.message}\n${e.stack ?? ''}`
        : `检查执行时发生错误：${e.message}`,
    }];
  }
}

function checkHarnessHostArtifactPollution(ctx: CheckContext, utHost: UtHostImpl): CheckResult[] {
  const desc = ruleDesc(ctx, 'structure_checks', 'harness_host_artifact_pollution');
  const core = collectContractPackagePathPollution(ctx);
  const extras = utHost.collectHarnessPollutionExtras?.(ctx) ?? [];
  const violations = mergePollutionViolations(core, extras);

  if (violations.length === 0) {
    return [
      {
        id: 'harness_host_artifact_pollution',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'PASS',
        details: 'framework harness 目录下未发现宿主 module 树或 profile 定义的污染路径。',
      },
    ];
  }

  const moduleHints =
    ctx.featureSpec.contracts?.modules
      ?.map(m => m.package_path)
      .filter(Boolean)
      .join(', ') ?? '';

  return [
    {
      id: 'harness_host_artifact_pollution',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: [
        '检测到宿主产物误写入 framework harness 目录（常见于 business-ut agent cwd 泄漏）：',
        ...violations.map(v => `  - ${v}`),
        '',
        '建议：迁移至 <repo-root>/{package_path}/... 后删除 harness 下误写目录；Write 前 cd <repo-root> 或使用绝对路径。',
        moduleHints ? `contracts.modules[].package_path：${moduleHints}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      suggestion:
        '见 framework/skills/reference/harness-cli-cwd.md §2.5 与 framework/skills/reference/consumer-framework-boundary.md',
    },
  ];
}

function findFirst(results: CheckResult[], id: string): CheckResult | undefined {
  return results.find(r => r.id === id);
}

function statusLabel(r: CheckResult | undefined): string {
  if (!r) return '未产生结果';
  return `${r.status}${r.severity === 'BLOCKER' ? ' [BLOCKER]' : ` [${r.severity}]`}`;
}

function buildUtRunStatusResult(
  results: CheckResult[],
  scopeInfo?: { allCount: number; scopedCount: number; scopeSources: string[] },
): CheckResult {
  const build = findFirst(results, 'ut_hvigor_build');
  const test = findFirst(results, 'ut_hvigor_test');
  const mutation = findFirst(results, 'ut_no_src_mutation');
  const tsc = findFirst(results, 'ut_tsc_compiles');
  const shortCircuited = !!test?.details?.includes('ut_hvigor_build 已 FAIL');
  const deviceExternalBlocked =
    test?.status === 'FAIL' &&
    (test.blocking_class === 'externalBlocked' || test.failure_kind === 'device_blocked');
  const compilePassed = build?.status === 'PASS';
  const blockerFails = results.filter(r => r.severity === 'BLOCKER' && r.status === 'FAIL');
  const canClaimDone = blockerFails.length === 0 && test?.status === 'PASS';

  const staticBlockerFails = blockerFails.filter(r =>
    r.id !== 'ut_hvigor_build' &&
    r.id !== 'ut_hvigor_test' &&
    r.id !== 'ut_no_src_mutation'
  );

  const lines = [
    'UT 阶段状态面板：',
    ...(scopeInfo
      ? [`- UT 文件范围：all=${scopeInfo.allCount}, scoped=${scopeInfo.scopedCount}（${scopeInfo.scopeSources.join(', ')}）`]
      : []),
    `- 静态/结构规则：${staticBlockerFails.length === 0 ? 'PASS' : `FAIL（${staticBlockerFails.map(r => r.id).join(', ')}）`}`,
    `- tsc 静态编译：${statusLabel(tsc)}`,
    `- 宿主测试模块编译：${statusLabel(build)}`,
    `- 真机/模拟器执行：${shortCircuited ? '未执行（ut_hvigor_build 失败短路）' : statusLabel(test)}`,
    `- 源码改动检查：${statusLabel(mutation)}`,
    `- 当前是否可以宣称 UT 完成：${canClaimDone ? '是' : '否'}`,
    `can_claim_done: ${canClaimDone ? 'YES' : 'NO'}`,
  ];

  if (deviceExternalBlocked && compilePassed) {
    lines.push('- partial_readiness: compile_passed_device_blocked（harness verdict 应为 INCOMPLETE，非 PASS）');
  }

  if (!canClaimDone) {
    lines.push(`- 阻塞项：${blockerFails.map(r => r.id).join(', ') || '无 BLOCKER FAIL，但真实执行状态不完整'}`);
  }

  return {
    id: 'ut_run_status',
    category: 'structure',
    description: 'UT 阶段真实执行状态摘要',
    severity: 'MINOR',
    status: canClaimDone ? 'PASS' : 'WARN',
    details: lines.join('\n'),
  };
}

const checker: PhaseChecker = {
  phase: 'ut',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const utHost = tryLoadUtHostImpl(ctx.resolvedProfile.profileDir);
    if (!utHost) {
      const loadError = getLastProfileHarnessLoadError();
      const details =
        `当前 project_profile 未提供可用的 utHostImpl（profileDir=${ctx.resolvedProfile.profileDir}）。` +
        (loadError ? ` load_error: ${loadError}` : '');
      return [
        {
          id: 'ut_profile_host_missing',
          category: 'structure',
          description: 'UT 宿主实现（profile harness/ut-host-impl）',
          severity: 'BLOCKER',
          status: 'FAIL',
          details,
          suggestion: '请为宿主 profile 实现并导出 harness/ut-host-impl.ts；参考 framework/profiles/hmos-app/harness/ut-host-impl.ts。',
        },
      ];
    }

    const dags = loadDagFiles(ctx);
    const allUtFiles = utHost.loadUtFiles(ctx);
    const partition = utHost.partitionUtFiles?.(ctx, allUtFiles) ?? {
      all: allUtFiles,
      scoped: allUtFiles,
      scopeSources: ['fallback:all'],
    };
    const scopedUtFiles = partition.scoped;
    const mockPlanDoc = parseMockPlanFile(mockPlanPath(ctx));
    const auditRecordsEarly = parseTestabilityAuditFile(testabilityAuditPath(ctx));

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, ['spec.md', 'plan.md']),
    ];

    results.push(
      ...safeRun(
        () => checkContextExplorationArtifact(ctx.projectRoot, ctx.feature, 'ut', {
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
          frameworkRoot: ctx.frameworkRoot,
        }),
        'context_exploration_gate',
      ),
    );

    results.push(
      ...runAcceptanceYamlStructureChecks(ctx, (c, s, id) =>
        ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id),
      ),
    );

    // --- Structure checks ---
    results.push(
      ...safeRun(() => checkHarnessHostArtifactPollution(ctx, utHost), 'harness_host_artifact_pollution'),
    );
    // v2 A: use-cases.yaml 自身
    results.push(...safeRun(() => checkUseCaseSpecRecommended(ctx), 'usecase_spec_recommended'));
    results.push(...safeRun(() => checkUseCaseSpecSchema(ctx), 'usecase_spec_schema'));
    results.push(...safeRun(() => checkUseCaseUiBindingsNonempty(ctx), 'usecase_ui_bindings_nonempty'));
    results.push(...safeRun(() => checkBoundaryMatchesContracts(ctx), 'boundary_matches_contracts'));
    results.push(...safeRun(() => checkNamedBusinessHandler(ctx), 'named_business_handler'));

    // v2.3：可测性预检 + mock-plan（先于 DAG 拓扑之后的 trace，但逻辑上属于 UT 规约门禁）
    results.push(...safeRun(() => checkUtTestabilityAuditPresent(ctx), 'ut_testability_audit_present'));
    results.push(...safeRun(() => checkUtUnsupportedTargetsHandled(ctx), 'ut_unsupported_targets_handled'));
    results.push(...safeRun(() => checkUtMockPlanPresent(ctx, auditRecordsEarly), 'ut_mock_plan_present'));
    results.push(...safeRun(() => checkUtMockPlanTyped(ctx, mockPlanDoc), 'ut_mock_plan_typed'));
    results.push(...safeRun(() => checkUtMockPlanContractsConsistent(ctx, mockPlanDoc), 'ut_mock_plan_contracts_consistent'));

    // v1 保留 + v2 修订：DAG 结构
    results.push(...safeRun(() => checkDagSchemaCompliance(ctx, dags), 'dag_schema_compliance'));
    results.push(...safeRun(() => checkDagNodeTypeValid(ctx, dags), 'dag_node_type_valid'));
    results.push(...safeRun(() => checkDagAcyclic(ctx, dags), 'dag_acyclic'));
    results.push(...safeRun(() => checkDagSourceFileExists(ctx, dags), 'dag_source_file_exists'));
    // v2 B: DAG ↔ use-cases 关联
    results.push(...safeRun(() => checkDagLinkedUseCase(ctx, dags), 'dag_linked_usecase'));
    results.push(...safeRun(() => checkDagBoundaryMatchesSpec(ctx, dags), 'dag_boundary_matches_spec'));
    results.push(...safeRun(() => checkDagAssertionLinkedBranch(ctx, dags), 'dag_assertion_linked_branch'));
    results.push(...safeRun(() => checkDagCohesion(ctx, dags), 'dag_cohesion'));
    results.push(...safeRun(() => checkDagSpyPresetResolvable(ctx, dags, mockPlanDoc), 'dag_spy_preset_resolvable'));

    // v1 保留 + v2 修订：UT 代码（宿主工具链规则由 profile ut-host-impl 提供）
    results.push(...safeRun(() => utHost.checkUtFileNaming(ctx, allUtFiles), 'ut_file_naming'));
    results.push(...safeRun(() => utHost.checkUtFrameworkImport(ctx, allUtFiles), 'ut_framework_import'));
    results.push(
      ...safeRun(
        () => checkUtHypiumMockkitPolicy(ctx, mockPlanDoc, allUtFiles, auditRecordsEarly),
        'ut_hypium_mockkit_policy',
      ),
    );
    results.push(...safeRun(() => checkUtAssertionExists(ctx, allUtFiles), 'ut_assertion_exists'));
    // v2.2 方案 A：静态 tsc --noEmit 检查
    results.push(...safeRun(() => utHost.checkUtTscCompiles(ctx, allUtFiles), 'ut_tsc_compiles'));
    // v2.2 方案 B：由 profile ut.compile 能力驱动的真实测试模块编译
    const hvigorBuildResults = safeRun(
      () => utHost.checkUtHvigorBuild(ctx, scopedUtFiles),
      'ut_hvigor_build',
    );
    results.push(...hvigorBuildResults);
    const buildFailed = hvigorBuildResults.some(r => r.id === 'ut_hvigor_build' && r.status === 'FAIL');
    const compileSkippedProfile = hvigorBuildResults.some(
      r =>
        r.id === LEGACY_UT_COMPILE_ID &&
        r.status === 'SKIP',
    );

    const descTest = ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test');

    if (buildFailed) {
      results.push({
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: 'ut_hvigor_build 已 FAIL，test 阶段自动短路为 FAIL（避免重复跑和日志噪声）。请先修复编译。',
      });
    } else if (compileSkippedProfile) {
      results.push(
        {
          id: LEGACY_UT_RUN_ID,
          category: 'structure',
          description: descTest,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'ut.compile 已为 profile SKIP，跳过装机 UT 执行。',
        },
        {
          id: CANONICAL_UT_RUN_ID,
          category: 'structure',
          description: descTest,
          severity: 'BLOCKER',
          status: 'SKIP',
          details: 'ut.compile 已为 profile SKIP，跳过装机 UT 执行。',
        },
      );
    } else {
      results.push(...safeRun(() => utHost.checkUtHvigorTest(ctx, scopedUtFiles), 'ut_hvigor_test'));
    }
    // v2.2 红线 5.2：business-ut 不得擅改业务源码
    results.push(...safeRun(() => checkUtNoSrcMutation(ctx), 'ut_no_src_mutation'));
    results.push(...safeRun(() => checkMockStubForAsync(ctx, dags, allUtFiles), 'mock_stub_for_async'));
    results.push(...safeRun(() => utHost.checkTestRegistration(ctx, allUtFiles), 'test_registration'));
    // v2 C: UT 代码（feature-scoped 追溯/命名）
    results.push(...safeRun(() => checkUtImportWhitelist(ctx, scopedUtFiles), 'ut_import_whitelist'));
    results.push(...safeRun(() => checkBoundariesAllStubbed(ctx, scopedUtFiles), 'boundaries_all_stubbed'));
    results.push(...safeRun(() => checkItNameHasAcOrBranchTag(ctx, scopedUtFiles), 'it_name_has_ac_or_branch_tag'));
    results.push(...safeRun(() => checkItDrivesFlow(ctx, scopedUtFiles), 'it_drives_flow'));

    // --- Traceability checks ---
    results.push(...safeRun(() => checkDagToAcceptance(ctx, dags), 'dag_to_acceptance'));
    results.push(...safeRun(() => checkAcceptanceCoverage(ctx, dags), 'acceptance_coverage'));
    results.push(...safeRun(() => checkDagToSource(ctx, dags), 'dag_to_source'));

    let acCoverageReport: AcCoverageReport | null = null;
    let acCoverageRel = '';
    const acceptanceForReport = ctx.featureSpec.acceptance;
    if (acceptanceForReport && scopedUtFiles.length > 0) {
      try {
        const itNames = collectItNames(ctx, scopedUtFiles);
        acCoverageReport = buildAcCoverageReport(ctx.feature, acceptanceForReport, itNames);
        const outPath = writeAcCoverageReport(ctx.projectRoot, ctx.feature, acCoverageReport);
        acCoverageRel = path.relative(ctx.projectRoot, outPath).replace(/\\/g, '/');
      } catch {
        acCoverageReport = null;
      }
    }

    // v2 Traceability（须在 ac-coverage.json 落盘之后，以便 ac_coverage 证据首轮可解析）
    results.push(...safeRun(() => checkUtCoverageEvidencePresent(ctx), 'ut_coverage_evidence_present'));
    results.push(...safeRun(() => checkUtCoverageEvidenceMappingsComplete(ctx, scopedUtFiles, acCoverageReport), 'ut_coverage_evidence_mappings_complete'));
    results.push(...safeRun(() => checkUtCoverageEvidenceResolves(ctx, scopedUtFiles, acCoverageReport), 'ut_coverage_evidence_resolves'));
    results.push(...safeRun(() => checkOriginTagRequired(dags, ctx), 'origin_tag_required'));
    results.push(...safeRun(() => checkCharacterizationTraceMatches(ctx, dags, scopedUtFiles), 'characterization_trace_matches'));
    results.push(...safeRun(() => checkBranchCoverageFull(ctx, scopedUtFiles, dags), 'branch_coverage_full'));
    results.push(...safeRun(() => checkUtCasePerUnitAc(ctx, scopedUtFiles, dags, acCoverageReport), 'ut_case_per_unit_ac'));
    results.push(...safeRun(() => checkBoundaryCoverage(ctx, scopedUtFiles, dags), 'boundary_coverage'));

    if (acCoverageReport && acCoverageRel) {
      const blockers = results.filter(r => r.severity === 'BLOCKER' && r.status === 'FAIL');
      if (blockers.length === 0) {
        results.push({
          id: 'ut_ac_coverage_report_written',
          category: 'traceability',
          description: 'UT 结束后写入 ac-coverage.json 机器回执',
          severity: 'MINOR',
          status: 'PASS',
          details: `已写入 ${acCoverageRel}（unit_scope ${acCoverageReport.summary.unit_covered}/${acCoverageReport.summary.unit_scope_total}）。`,
        });
      }
    } else if (acceptanceForReport && scopedUtFiles.length > 0) {
      results.push({
        id: 'ut_ac_coverage_report_written',
        category: 'traceability',
        description: 'UT 结束后写入 ac-coverage.json 机器回执',
        severity: 'MINOR',
        status: 'WARN',
        details: '未能生成或写入 ac-coverage.json。',
      });
    }

    results.push(buildUtRunStatusResult(results, {
      allCount: partition.all.length,
      scopedCount: partition.scoped.length,
      scopeSources: partition.scopeSources,
    }));

    return results;
  },
};

export default checker;
