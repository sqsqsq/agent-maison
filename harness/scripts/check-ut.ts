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
import { takeArray } from './utils/shape-guards';
import {
  diffChangedFiles,
  filterBusinessSourceChanges,
  listFilesAtRef,
  readTraceStartCommit,
  analyzeDiffStaleness,
} from './utils/git-diff';
import {
  resolveUtTargets,
  computeUtFileBaseline as resolverComputeUtFileBaseline,
  UT_TARGETS_ENV,
  type UtLegacyIncrement,
  type UtTargetResolution,
} from './utils/ut-target-resolver';

/** re-export：单测与既有消费方从 check-ut 导入（实现已移至 ut-target-resolver，P1-1） */
export const computeUtFileBaseline = resolverComputeUtFileBaseline;
import { findFilesRecursive } from './utils/find-files-recursive';
import { checkChangeUnitFeatureProjection } from './utils/change-unit-feature-projection';
import {
  CANONICAL_UT_COMPILE_ID,
  LEGACY_UT_COMPILE_ID,
  CANONICAL_UT_RUN_ID,
  LEGACY_UT_RUN_ID,
} from '../capability-registry';
import {
  loadFrameworkConfig,
  featuresDirPath,

  featureArtifactPath,
  featureDir,
  featurePhaseReportsDir,
  relFeatureFile,
} from '../config';
// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT
import { featureRelativePath } from './utils/feature-identity';
import { isPhaseDisabledByProfile } from '../profile-loader';
import { driftFactsFromClosureAttestation, partitionDriftByGitStatus } from './utils/source-drift-facts';
import { reviewClosureAttestationPath } from './utils/closure-attestation';
import { classifySourceDrift } from './utils/mutation-authorization';
import { hasGoalExecutionSignal, resolveHarnessDiffBaseRef } from './utils/phase-state';
import {
  tryLoadUtHostImpl,
  getLastProfileHarnessLoadError,
  tryLoadDiffExcludeTestPathRegexes,
  type UtHostImpl,
} from '../profile-host-loader';
import { resolveUtTemplateRef, type UtTemplateKey } from './utils/ut-template-paths';
import { isSuiteEntryShimContent } from '../ut-suite-entry-shim';
import {
  buildMockPlanPresetIndex,
  collectDoublesMissingStrategy,
  collectMockPlanTypedIssues,
  collectNewMockkitSurface,
  collectUtMockkitGovernanceReport,
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
import { checkFactsArtifact } from './utils/context-facts';
import { checkUpstreamVerdictGate } from './utils/upstream-verdict-gate';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { runAcceptanceYamlStructureChecks, acceptanceHasDeviceFocusRef } from './utils/check-acceptance';
import {
  acCoverageCoversScope,
  buildAcCoverageReport,
  writeAcCoverageReport,
  type AcCoverageReport,
} from './utils/ac-coverage-report';
import {
  readCoverageEvidence,
  listUnitBothScopeItems,
  dagLinksScopeId,
  dagsAllCharacterization,
  scopeHasResolvableEvidence,
  mappingBackedByResolvableEvidence,
  ephemeralFlowDagDir,
  type CoverageEvidenceFile,
} from './utils/coverage-evidence';
import {
  validateCoverageEvidenceContent,
  validateMockPlanFile,
  validateTestabilityAuditFile,
} from './utils/ut-artifact-validate';
import {
  collectContractPackagePathPollution,
  mergePollutionViolations,
} from './utils/harness-path-guard';
import { extractUtItBlocks } from './utils/ut-it-blocks';
import { hasExactUtBranchTag, hasExactUtScopeTag } from './utils/ut-tag-match';

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

/** UT 诊断里指向模板/示例的路径：统一解析自 profiles/<profile>/skills/skill-assets.yaml
 * （SSOT，plan f4c8d2b7 t5）；清单不可用时回落 profile-skill-asset 占位符原文，
 * 绝不拼接猜测的物理路径（历史幻影路径教训）。 */
function utSuggestionPaths(ctx: CheckContext): {
  useCasesSchemaTemplateRel: string;
  mockPlanSchemaTemplateRel: string;
  testabilityAuditTemplateRel: string;
  branchExampleTestRel: string;
} {
  const rel = (key: UtTemplateKey): string =>
    resolveUtTemplateRef(ctx.projectRoot, ctx.resolvedProfile.name, key).rel;
  return {
    useCasesSchemaTemplateRel: rel('use_cases_schema'),
    mockPlanSchemaTemplateRel: rel('mock_plan_schema'),
    testabilityAuditTemplateRel: rel('testability_audit_template'),
    branchExampleTestRel: rel('sample_flow_dir'),
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

export interface DagNode {
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
  /** 对象 {name,type,method} 是唯一推荐格式；string 为旧产物兼容形态（值=data_boundaries[].name） */
  boundary?:
    | {
        name?: string;
        type?: string;
        method?: string;
      }
    | string;
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

export interface DagFile {
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

export interface LoadedDagFile {
  path: string;
  dag: DagFile;
  raw: string;
  source: 'archived' | 'ephemeral';
}

export interface DagLoadIssue {
  path: string;
  source: 'archived' | 'ephemeral';
  error: string;
}

export interface DagLoadObservation {
  files: LoadedDagFile[];
  candidatePaths: string[];
  probedDirs: string[];
  issues: DagLoadIssue[];
}

export type CoverageEvidenceObservation =
  | {
      status: 'missing';
      absPath: string;
      relPath: string;
    }
  | {
      status: 'invalid';
      absPath: string;
      relPath: string;
      errors: string[];
    }
  | {
      status: 'loaded';
      absPath: string;
      relPath: string;
      evidence: CoverageEvidenceFile;
      warnings: string[];
    };

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

export function loadDagFiles(ctx: CheckContext): DagLoadObservation {
  const files: LoadedDagFile[] = [];
  const candidatePaths: string[] = [];
  const probedDirs: string[] = [];
  const issues: DagLoadIssue[] = [];
  const seen = new Set<string>();

  const pushDag = (dagPath: string, source: LoadedDagFile['source']) => {
    const relPath = path.relative(ctx.projectRoot, dagPath).replace(/\\/g, '/');
    if (seen.has(relPath)) return;
    seen.add(relPath);
    candidatePaths.push(relPath);
    try {
      const raw = fs.readFileSync(dagPath, 'utf-8');
      const parsed = YAML.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('DAG 根节点必须是 YAML mapping/object');
      }
      files.push({ path: relPath, dag: parsed as DagFile, raw, source });
    } catch (e) {
      issues.push({
        path: relPath,
        source,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const contracts = ctx.featureSpec.contracts;
  if (contracts?.modules?.length) {
    for (const mod of contracts.modules) {
      const dagDir = path.join(ctx.projectRoot, mod.package_path, 'test', 'dag');
      probedDirs.push(path.relative(ctx.projectRoot, dagDir).replace(/\\/g, '/'));
      for (const dagPath of findFilesRecursive(dagDir, /\.dag\.yaml$/)) {
        pushDag(dagPath, 'archived');
      }
    }
  }

  const ephemeralDir = ephemeralFlowDagDir(ctx.projectRoot, ctx.feature);
  probedDirs.push(path.relative(ctx.projectRoot, ephemeralDir).replace(/\\/g, '/'));
  if (fs.existsSync(ephemeralDir)) {
    for (const dagPath of findFilesRecursive(ephemeralDir, /\.dag\.yaml$/)) {
      pushDag(dagPath, 'ephemeral');
    }
  }

  return {
    files,
    candidatePaths,
    probedDirs: [...new Set(probedDirs)],
    issues,
  };
}

export function checkDagFilesParseable(
  ctx: CheckContext,
  observation: DagLoadObservation,
): CheckResult[] {
  const id = 'dag_files_parseable';
  if (observation.issues.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `${observation.issues.length} 个 DAG 候选存在但无法解析：\n` +
        truncateList(observation.issues.map(i => `${i.path} (${i.source}): ${i.error}`), 12) +
        `\n探测目录：${observation.probedDirs.join(', ') || '(无)'}`,
      affected_files: observation.issues.map(i => i.path),
      suggestion: '修复上述 DAG YAML；harness 已找到文件，不需要移动文件或执行 git add。',
    }];
  }
  if (observation.candidatePaths.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `未发现 *.dag.yaml 候选；已探测目录：${observation.probedDirs.join(', ') || '(无)'}`,
    }];
  }
  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `已解析 ${observation.files.length}/${observation.candidatePaths.length} 个 DAG：${observation.files.map(f => `${f.path} (${f.source})`).join(', ')}`,
  }];
}

export function inspectCoverageEvidence(ctx: CheckContext): CoverageEvidenceObservation {
  const observed = readCoverageEvidence(ctx.projectRoot, ctx.feature);
  if (observed.status === 'missing') return observed;
  if (observed.status === 'invalid') {
    return {
      status: 'invalid',
      absPath: observed.absPath,
      relPath: observed.relPath,
      errors: [observed.error],
    };
  }

  const validation = validateCoverageEvidenceContent(observed.raw, observed.absPath);
  const errors = validation.errors.map(e => `${e.field}: ${e.message}`);
  if (observed.evidence.feature?.trim() && observed.evidence.feature !== ctx.feature) {
    errors.push(`feature: 文件声明 ${observed.evidence.feature}，当前 feature 为 ${ctx.feature}`);
  }
  if (errors.length > 0) {
    return {
      status: 'invalid',
      absPath: observed.absPath,
      relPath: observed.relPath,
      errors,
    };
  }
  return {
    status: 'loaded',
    absPath: observed.absPath,
    relPath: observed.relPath,
    evidence: observed.evidence,
    warnings: validation.warnings.map(w => `${w.field}: ${w.message}`),
  };
}

// --------------------------------------------------------------------------
// v2 UseCase Spec 相关加载
// --------------------------------------------------------------------------

function loadUseCaseSpec(ctx: CheckContext): UseCasesSpec | null {
  return ctx.featureSpec.useCases ?? null;
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
        `未找到 DAG 文件（*.dag.yaml）。可放在 ${relFeatureFile(ctx.projectRoot, ctx.feature, 'ut/reports/flow-dag/')}（ephemeral，默认）或 {module}/test/dag/（归档）。`,
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
    const itBlocks = extractUtItBlocks(content);
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
 * business-ut 红线：检测不属于 UT owner 的业务源码变更。
 * 流程：
 *   (1) `HARNESS_DIFF_BASE_REF` 显式值；否则读 trace.start_commit；（再否则由 git-diff 默认 working）
 *   (2) git diff + 未提交/untracked，按受保护前缀筛；
 *   (3) 任一业务源码变更均 FAIL BLOCKER，并交回 coding owner 重验；
 *   (4) legacy gap-notes/人工授权可读，但不参与 PASS。
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
  if (override) return path.join(override, featureRelativePath(feature));
  const cfg = loadFrameworkConfig(projectRoot);
  if (typeof cfg.paths.reports_dir_pattern === 'string' && cfg.paths.reports_dir_pattern.trim().length > 0) {
    return path.join(featuresDirPath(projectRoot), featureRelativePath(feature));
  }
  return path.join(HARNESS_ROOT, 'reports', featureRelativePath(feature));
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

/**
 * plan e7c2a4d8 T4d（codex 三轮 P0-A + 二轮 P0-c）：goal 编排环境的改码门禁——
 * 与 runner reconcileMutablePhaseSourceDrift **共享同一基线与判定**（review closure
 * attestation + classifySourceDrift），只裁决 review 后漂移：coding 阶段合法业务
 * 改动（trace.start_commit 起算全量 diff，宿主实测 ~36 文件）不在裁决域，照 v3 直接
 * 要求 runner 背书会把合法实现全打成 BLOCKER。任何 receipt、gap-notes 或用户身份
 * 都不构成质量放行；goal 与 attended 模式都把 UT 期间的源码漂移交回 coding owner。
 */
function checkUtNoSrcMutationGoalEnv(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation');
  // plan a5f9c3e2 t1③：事实采集经统一 provider 归一为 SourceDriftFacts（canonical
  // 三元组与 direct 模式 provider 同 schema；provenance/baseline_kind 是来源标注）。
  const closure = driftFactsFromClosureAttestation(ctx.projectRoot, ctx.feature);
  if (!closure) {
    return [{
      id: 'goal_review_closure_baseline_unavailable',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        'goal 环境 review closure attestation 缺失/损坏——无源码基线，既判不了「review 后' +
        '漂移」也不得放行（fail-closed；不回退 run-start diff、不读 gap-notes 授权）。',
      failure_kind: 'goal_review_closure_baseline_unavailable',
      blocking_class: 'goal_review_closure_baseline_unavailable',
      suggestion:
        '按既有回退协议失效旧 coding closure，回到 coding→review→ut/testing 重建合法基线；' +
        '截断链由 supervisor 生成 coding 起点后继 run。',
    }];
  }
  if (closure.clean) {
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        'goal 环境基线=review closure attestation：review 后源码零漂移' +
        '（coding 阶段合法实现不在裁决域）。',
    }];
  }
  const drift = {
    added: closure.facts.added,
    modified: closure.facts.modified,
    deleted: closure.facts.deleted,
  };
  const decision = classifySourceDrift(drift, [], {
    runId: (process.env.MAISON_GOAL_RUN_ID ?? '').trim(),
    frozenManifestHash: null, // harness 侧无 run_start 冻结事件——preauth 本就不放行
    phase: ctx.phase ?? 'ut',
    expectedInventoryHash: closure.inventoryHash,
    projectRoot: ctx.projectRoot,
    feature: ctx.feature,
    manifestIdentityAuthenticated: Boolean(process.env.MAISON_HMAC_GOAL_CHECKPOINT),
    currentDriftFingerprint: null,
  });
  const files = [...drift.added, ...drift.modified, ...drift.deleted];
  const violations = decision.kind === 'unauthorized' ? decision.violations : [];
  return [{
    id: 'goal_post_review_source_mutation_unresolved',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `goal 环境基线=review closure attestation：检测到 review 后未授权源码漂移（${files.length} 文件）：\n` +
      files.slice(0, 10).map(f => `  - ${f}`).join('\n') +
      (violations.length > 0 ? `\n判定：\n${violations.slice(0, 5).map(v => `  - ${v}`).join('\n')}` : '') +
      '\n\n注意：gap-notes approved_src_mutations 为 agent 自报，不构成 runner 三源授权。',
    affected_files: files,
    failure_kind: 'goal_post_review_source_mutation_unresolved',
    blocking_class: 'goal_post_review_source_mutation_unresolved',
    suggestion:
      '本 blocker 零内容重试——**agent 不得再改产物试图安抚它**。' +
      'plan a5f9c3e2 t3②起，runner 对未受信漂移的默认处置是**保守恢复**：失效旧 coding ' +
      'closure 及其后阶段，把该 diff 当未受信候选回退 coding→review→ut→testing 完整重验' +
      '（无需人签，不跳过验证）。仅当结构前提不满足（截断链 / 回退预算耗尽 / 同一 drift ' +
      '指纹重现）才 halt，届时出路由 runner 的 unauthorized_source_mutation halt guidance 给出。',
  }];
}

/**
 * plan f3a9d2c7 T1：direct 模式的 review「正式闭环」探测结果。
 *
 * - `closed`       —— review summary 满足三字段判据，attestation 基线**允许**被采信；
 * - `open`         —— **盘上未观察到可用的闭环证据**（无 attestation，且 summary 缺失 /
 *                     open / legacy；或 profile 禁用 review）→ git fallback。注意措辞：
 *                     把闭环产物全部删光同样映射到这里，所以它只能断言"现在看不到"，
 *                     断言不了"从未闭过环"；
 * - `unverifiable` —— 闭环状态读不出来（I/O 异常 / JSON 不可解析），**或闭环证据半有半无**
 *                     （attestation 在盘而 summary 缺失/未闭环）→ fail-closed。
 *
 * `reason` 只做诊断展示（写进 details），不参与任何判定。
 */
interface ReviewClosureProbe {
  state: 'closed' | 'open' | 'unverifiable';
  reason: string;
}

/**
 * plan f3a9d2c7 T1（review 返修 P1-2）：**三态**文件探针。
 *
 * 为什么不用 `fs.existsSync()`：它对 `EACCES` / `ENOTDIR` 等文件系统错误**同样返回
 * false**，把「探不动」和「不存在」压成同一个答案，外层的 try/catch 一辈子也抓不到。
 * 那就留下一条逃逸：闭环后改码并 commit，再让 `review/reports` 路径不可访问或结构损坏，
 * 两次探测都得 false → 被判「真·未闭环」→ 落回 commit-blind 的 working diff → PASS。
 *
 * 为什么还不能只看 errno：**Windows 把「路径中段是个文件」也报成 `ENOENT`**（POSIX 报
 * `ENOTDIR`），单点 stat 在 Windows 上根本区分不出「目录不存在」和「目录被替换成文件」。
 * 所以从**文件系统根**（盘符根 / UNC share 根）自上而下逐段解析——不分工程内外：
 * `receipt_dir_pattern` / `reports_dir_pattern` 经 `path.resolve` 完全可以落到 projectRoot
 * 之外，若对工程外路径退化成单点 stat，刚修掉的 Windows 歧义会原样复现。
 *
 * 每段先 `lstatSync`（**不跟随**链接）再决定：
 *   · lstat ENOENT        → 其下必然什么都没有 → `absent`（真·观察不到痕迹，可降级）；
 *   · 是 symlink/junction → 再 `statSync` 跟随；目标失效/不可访问 → `unverifiable`
 *                           （悬空 junction 的 stat 也报 ENOENT，只有 lstat 能证明它还在——
 *                            那是**可观察的损坏痕迹**，不是"不存在"）；
 *   · 中段存在但非目录     → `unverifiable`（结构损坏，fail-closed）；
 *   · 末段是普通文件       → `present`；是目录/其它 → `unverifiable`；
 *   · 任何非 ENOENT 异常（EACCES/EPERM/…）→ `unverifiable`。
 * 代价是每次探测多几个 lstat，可忽略。
 */
type FilePresence =
  | { state: 'present' }
  | { state: 'absent' }
  | { state: 'unverifiable'; error: string };

export function probeFilePresence(absPath: string): FilePresence {
  const resolved = path.resolve(absPath);
  const root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  if (parts.length === 0) {
    return { state: 'unverifiable', error: `目标路径解析为文件系统根：${resolved}` };
  }
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return { state: 'absent' };
      return { state: 'unverifiable', error: `${err.code ?? 'unknown'} @ ${cur}：${err.message}` };
    }
    if (st.isSymbolicLink()) {
      // 链接本身在盘上 —— 从这里起 ENOENT 只可能是"目标失效"，不是"什么都没有"。
      try {
        st = fs.statSync(cur);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        return {
          state: 'unverifiable',
          error: `符号链接/junction ${cur} 的目标不可解析（${err.code ?? 'unknown'}）`,
        };
      }
    }
    if (i === parts.length - 1) {
      return st.isFile()
        ? { state: 'present' }
        : { state: 'unverifiable', error: `${cur} 存在但不是普通文件` };
    }
    if (!st.isDirectory()) {
      return { state: 'unverifiable', error: `路径中段 ${cur} 存在但不是目录（闭环产物目录被替换/损坏）` };
    }
  }
  return { state: 'absent' };
}

/**
 * plan f3a9d2c7 T1（review 返修 P1）：attestation **只探在不在，绝不读内容**。
 *
 * 孤儿 attestation 一律不采信（红线不变），但「它在盘上」这个事实本身是有信息量的：
 * 它证明这个 feature 的 review **已经跑过闭环机制**。据此，「summary 没了/退回未闭环」
 * 就不能再被解释成「这个工程从来没闭过环」——那是**证据残缺**，须 fail-closed。
 *
 * 为什么必须这样：不这么判就留下一条 commit-wash 逃逸——review 闭环后改产品源码并
 * `git commit`，再删掉 `review/reports/summary.json`，门禁即降级到默认 working diff
 * （看不见已提交改动）而 PASS；上游 verdict 门禁对「summary 不存在」也是直接跳过
 * （upstream-verdict-gate.ts `if (!v.summaryExists) continue`），全链无人拦截。
 */
function probeReviewClosureAttestationPresence(projectRoot: string, feature: string): FilePresence {
  return probeFilePresence(reviewClosureAttestationPath(projectRoot, feature));
}

/**
 * plan f3a9d2c7 T1：review 是否**正式闭环**（判据与 assess.ts observeFeatureState 同口径）：
 *   `summary.schema_version === '1.2'` ∧ `closure_status === 'closed'`
 *   ∧ `closure_commit.schema_version === '1.0'`。
 *
 * **为什么必须先判它、再看 attestation**：attestation 的写点在最终 summary rename
 * **之前**（phase-closure-finalizer 的提交序），闭环中途崩溃会留下**孤儿 attestation**
 * ——文件存在不代表 closure 已提交。故「文件在不在」不是基线可用性的判据，「closure
 * 提交没提交」才是；顺序倒过来即等于采信一份没人背书的快照。
 *
 * legacy summary（无 schema 1.2 / 无 closure_status）按**未闭环**处理走 fallback，
 * 不破存量（与 ut-legacy-coexistence 的共存精神一致）。
 */
function probeReviewClosureState(ctx: CheckContext): ReviewClosureProbe {
  if (isPhaseDisabledByProfile('review', ctx.resolvedProfile)) {
    return {
      state: 'open',
      reason: `project_profile=${ctx.resolvedProfile.name} 已禁用 review 阶段，无 closure attestation 基线`,
    };
  }
  const summaryPath = path.join(
    featurePhaseReportsDir(ctx.projectRoot, ctx.feature, 'review', ctx.frameworkRoot),
    'summary.json',
  );

  // 未闭环的处置分两种，取决于**这个 feature 有没有闭过环的痕迹**：
  //   痕迹为零 → `open`（当前盘上观察不到任何闭环痕迹，保留既有 git fallback，不破存量）；
  //   有痕迹但 summary 说没闭 → `unverifiable`（证据残缺 → fail-closed，见上方函数注释）。
  // 「痕迹探不动」（EACCES/ENOTDIR/非文件）既不是"有"也不是"没有"，直接 fail-closed。
  const att = probeReviewClosureAttestationPresence(ctx.projectRoot, ctx.feature);
  if (att.state === 'unverifiable') {
    return {
      state: 'unverifiable',
      reason: `review-closure-attestation.json 是否在盘不可核实（${att.error}）`,
    };
  }
  const attested = att.state === 'present';
  const notClosed = (why: string): ReviewClosureProbe => (attested
    ? {
      state: 'unverifiable',
      reason:
        `闭环证据残缺：review-closure-attestation.json 在盘（证明本 feature 已跑过 review 闭环），` +
        `但 ${why}——不接受「证据被删/被退回」作为降级到 git 基线的许可证`,
    }
    : { state: 'open', reason: why });

  // summary 走同一个三态探针（reports_dir_pattern 与 receipt_dir_pattern 可被宿主配成
  //   不同目录，故两条路径各探各的），只有明确 `absent` 才算"缺失"。
  const sum = probeFilePresence(summaryPath);
  if (sum.state === 'unverifiable') {
    return { state: 'unverifiable', reason: `review summary.json 是否在盘不可核实（${sum.error}）` };
  }
  if (sum.state === 'absent') {
    return notClosed('review 阶段 summary.json 未在盘');
  }
  let raw: string;
  try {
    raw = fs.readFileSync(summaryPath, 'utf-8');
  } catch (e) {
    // 已探到 present 却读不出来（权限/占用/竞态）——不当"缺失"处理。
    const err = e as NodeJS.ErrnoException;
    return {
      state: 'unverifiable',
      reason: `review summary.json 读取失败（${err.code ?? 'unknown'}）：${err.message}`,
    };
  }
  let doc: {
    schema_version?: unknown;
    closure_status?: unknown;
    closure_commit?: { schema_version?: unknown } | null;
  };
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    return {
      state: 'unverifiable',
      reason: `review summary.json 不可解析：${(e as Error).message}`,
    };
  }
  if (!doc || typeof doc !== 'object') {
    return { state: 'unverifiable', reason: 'review summary.json 顶层不是对象' };
  }
  if (doc.schema_version !== '1.2') {
    return notClosed(
      `review summary schema_version=${String(doc.schema_version ?? '缺失')}（非 1.2 的 legacy 形态，按未闭环处理）`,
    );
  }
  if (doc.closure_status !== 'closed') {
    return notClosed(`review summary closure_status=${String(doc.closure_status ?? '缺失')}（未闭环）`);
  }
  if (doc.closure_commit?.schema_version !== '1.0') {
    return notClosed(
      `review summary 缺合法 closure_commit（schema_version=${String(doc.closure_commit?.schema_version ?? '缺失')}）`,
    );
  }
  return { state: 'closed', reason: 'review 已正式闭环（summary 1.2 + closure_commit 1.0）' };
}

/**
 * plan f3a9d2c7 T1：direct 模式的 **attested 分支** —— 基线=review closure attestation
 * 的逐文件内容哈希，**与 git 提交状态无关**。
 *
 * 为什么 direct 也走它：门禁要回答的是相位归属问题（「review 之后这棵树还动没动」），
 * git diff 只能回答「相对某 commit 差了什么」。框架在 coding→review→ut 边界从不留
 * commit（用户政策也不允许），于是 coding 阶段的合法未提交产物被结构性地冒充成 UT 的
 * 改动——宿主 bc-openCard-1 实锤 47 个无辜产物被判 BLOCKER。内容哈希基线对此免疫，
 * 且对「UT 改完码 git commit 一下从 working diff 里隐身」同样免疫。
 *
 * 裁决面**零放宽**：testing 阶段的 review_closure_attestation 门禁全模式早已在消费
 * 同一份文件、同一套对账，UT 采用只是把同一漂移提前一个阶段暴露。
 *
 * 不接 classifySourceDrift / 任何授权链：direct 无 runner 三源授权，人签通行证已整套
 * 剪除；gap-notes / 用户回复照旧不参与质量放行。
 */
function checkUtNoSrcMutationDirectAttested(ctx: CheckContext, probeReason: string): CheckResult[] {
  const desc = ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation');
  const closure = driftFactsFromClosureAttestation(ctx.projectRoot, ctx.feature);
  if (!closure) {
    // fail-closed：review 已正式闭环却拿不到它的源码基线（被删/损坏/schema 不符）——
    // 既判不了「review 后漂移」，也**不得**静默回退到 run-start/working diff 冒充基线。
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        'review 已正式闭环，但 review-closure-attestation.json 缺失/不可读——源码基线不可用。\n' +
        `闭环探测：${probeReason}\n` +
        '不回退 run-start/working git diff 冒充基线（那正是把 coding 合法产物误判成 UT 改码的老路），' +
        '也不读 gap-notes/用户回复放行。',
      failure_kind: 'review_closure_baseline_unavailable',
      blocking_class: 'ut_no_src_mutation',
      suggestion:
        '补跑一次 review 闭环（harness + verifier + receipt + check-receipt）重建 ' +
        'review-closure-attestation.json 后重跑 UT 门禁；无需提交任何产物。',
    }];
  }
  if (closure.clean) {
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        '基线=review closure attestation：review 后源码零漂移' +
        '（coding 阶段合法实现不在裁决域；不依赖 git 提交状态）。',
    }];
  }
  const files = [
    ...closure.facts.added,
    ...closure.facts.modified,
    ...closure.facts.deleted,
  ];
  return [{
    id: 'ut_no_src_mutation',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `基线=review closure attestation：检测到 review 后源码漂移（${files.length} 文件）：\n` +
      files.slice(0, 10).map(f => `  - ${f}`).join('\n') +
      (files.length > 10 ? `\n  …（其余 ${files.length - 10} 个略）` : '') +
      '\n\n门禁只判「review 审过的树变了」，不推断作者（可能是 UT 期改码，也可能是 review ' +
      '后的人工/重 coding 改动）；gap-notes/用户回复不参与质量放行。',
    affected_files: files,
    failure_kind: 'post_review_source_drift',
    blocking_class: 'ut_no_src_mutation',
    suggestion:
      '两条出路，二选一：①漂移是合法改动（可测性接缝/缺陷修复）→ 回 coding 纳入实现并重走 ' +
      'review 闭环（重闭环即刷新 attestation 基线）后再闭环 UT；②漂移是误改/排障残留 → 从编辑器' +
      '本地历史/备份取回 review 时的文件内容，再用 attestation 里该文件的 sha256 **核对**恢复结果' +
      '（attestation 只存哈希不存内容，它能验证、不能还原；coding 产物也可能从未提交，别指望 git ' +
      '里有旧版本）；取不回就走出路①回 coding 重建并重新闭环 review。无需提交任何产物。',
  }];
}

/**
 * 导出仅为单测直接驱动分派全路（attested / fail-closed / 孤儿 attestation / git fallback）；
 * 生产调用点仍是本文件内的 checker.check。
 */
export function checkUtNoSrcMutation(ctx: CheckContext): CheckResult[] {
  // plan e7c2a4d8 T4d：goal 编排环境走 review-closure 基线共享判定（见上）。
  if (hasGoalExecutionSignal()) {
    return checkUtNoSrcMutationGoalEnv(ctx);
  }
  // plan f3a9d2c7 T1：direct 模式 attestation-first —— 分派条件是**基线可用性**而非
  // 编排身份。顺序不可倒：先判 review 正式 closed，再看 attestation（孤儿 attestation
  // 一律不读不采信）。
  const probe = probeReviewClosureState(ctx);
  if (probe.state === 'closed') {
    return checkUtNoSrcMutationDirectAttested(ctx, probe.reason);
  }
  if (probe.state === 'unverifiable') {
    return [{
      id: 'ut_no_src_mutation',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `review 闭环状态不可核实：${probe.reason}\n` +
        '既不进 attestation 基线（闭环没被证实，可能是孤儿快照），也不回退 git diff' +
        '（回退等于用一个已知会误伤 coding 产物、且看不见已提交改动的基线做裁决）——fail-closed。',
      failure_kind: 'review_closure_baseline_unavailable',
      blocking_class: 'ut_no_src_mutation',
      suggestion:
        '补跑一次 review 闭环（harness + verifier + receipt + check-receipt）重建 summary 与 attestation，' +
        '确认 closure 状态可读后重跑 UT 门禁；无需提交任何产物。',
    }];
  }
  return checkUtNoSrcMutationDirectGitFallback(ctx, probe.reason);
}

/**
 * plan f3a9d2c7 T1：direct 模式的 **git fallback** —— 生效域已收窄为「**盘上观察不到任何
 * review 闭环痕迹**」：无 closure attestation 且 summary 缺失/legacy，或 profile 明确禁用
 * review。行为与改造前逐字等值，只在 FAIL details 里多一行「基线降级原因」说明为什么走的
 * 是 git。措辞是"观察不到"而不是"从未闭环"——盘上的证据只支持前者。
 *
 * **有痕迹却说没闭环**（attestation 在盘）不进本分支——那是证据残缺，由 probe 判 fail-closed；
 * 否则「删掉 summary」就成了绕过内容哈希基线、退回 commit-blind working diff 的许可证。
 * 把闭环产物**全部**删光仍会落到这里：那是可观察性的边界（默认工作流还允许 review/UT 并行，
 * 「没有 summary」本身不能当错误），要封须改 DAG 或引入工作区外的可信锚，不在本 change。
 *
 * 生效域内保留既有兼容行为**及其已知 commit-blind 风险**（working 基线看不见已提交的
 * 改动）；本 plan 只保证「已有正式 review closure」的 direct 场景。git fallback 完全
 * 退役属后续 change。
 *
 * 孤儿 attestation 的**内容**在全流程一律不读不采信（只用它在不在做残缺判定）。
 */
function checkUtNoSrcMutationDirectGitFallback(ctx: CheckContext, degradeReason: string): CheckResult[] {
  // 解析 baseRef：聚合所有找到的 trace.json（按修改时间选最新，降低多次跑带来的歧义）
  const envBaseRef = resolveHarnessDiffBaseRef() ?? '';
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

  // plan a5f9c3e2 t1③：direct provider —— 与 goal provider 归一成同一 SourceDriftFacts。
  // **集合口径与改造前逐字等值**：partition 只分区不增删，union 后排序 = 原
  // filterProtected(diff.changedFiles)（该数组本就 normalizeSorted）。
  const driftFacts = partitionDriftByGitStatus({
    projectRoot: ctx.projectRoot,
    baseRef: diff.baseRef,
    files: filterProtected(ctx, diff.changedFiles),
    untrackedFiles: filterProtected(ctx, diff.untrackedFiles),
    provenance: `trace-start-commit:${diff.baseRef}`,
  });
  const businessChanges = [
    ...new Set([...driftFacts.added, ...driftFacts.modified, ...driftFacts.deleted]),
  ].sort();
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

  const unauthorized = businessChanges;

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
        '而不是继续叠加改动；确需保留则交回 coding owner 纳入实现并重走 review→ut→testing。'
      : '';

  return [{
    id: 'ut_no_src_mutation',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_no_src_mutation'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `基线降级原因（未走 review closure attestation）：${degradeReason}\n` +
      `baseRef=${diff.baseRef}${diff.baseIsFallback ? ' (fallback — trace.json.start_commit 未记录，可信度较低)' : ''}\n` +
      `mode=${diff.workingOnly ? 'working-only' : 'committed+working'}；base 来源：${baseHint}\n` +
      `变更拆分：committed=${committedBusinessChanges.length}, working=${workingBusinessChanges.length}, staged=${stagedBusinessChanges.length}, untracked=${untrackedBusinessChanges.length}\n` +
      `检测到 ${unauthorized.length} 个不属于 UT owner 的业务源码变更：\n${unauthorized.map(f => '  - ' + f).join('\n')}\n` +
      `legacy approved_src_mutations/用户回复不参与质量放行。${oldBaseHint}`,
    affected_files: unauthorized,
    failure_kind: staleness.stale ? 'stale_diff_base' : 'unauthorized_src_mutation',
    blocking_class: staleness.stale ? 'stale_diff_base' : 'ut_no_src_mutation',
    suggestion:
      staleness.stale
        ? '可先去掉 HARNESS_DIFF_BASE_REF（默认 working）后重跑；或显式设 `HARNESS_DIFF_BASE_REF=working`。若源码漂移仍存在，交回 coding owner 重验。'
        : '停止 UT 阶段改码；把所需可测性改造作为 coding repair candidate，回 coding 修改并完整重走 review→ut→testing。' +
          configHint,
  }];
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
      details: `${relFeatureFile(ctx.projectRoot, ctx.feature, 'use-cases.yaml')} 已存在。`,
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
    details: `ut_layer ∈ {unit, both} 的 AC 有 ${unitAcCount} 条（≥3），建议产出 ${relFeatureFile(ctx.projectRoot, ctx.feature, 'use-cases.yaml')} 以承载端到端分支。`,
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
    // P0-2 复审：嵌套集合 dict 形防崩（takeArray 归空 + 结构化 issue，agent 可修——
    // 不再落 safeRun 的 framework_bug 误归因）。
    for (const ub of takeArray<NonNullable<typeof uc.ui_bindings>[number]>(uc.ui_bindings, `${tag}.ui_bindings`, issues)) {
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
    for (const b of takeArray<NonNullable<typeof uc.data_boundaries>[number]>(uc.data_boundaries, `${tag}.data_boundaries`, issues)) {
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

/** boundary 双形态归一取 name：对象（唯一推荐）取 .name；旧字符串 boundary / 旧字段 port 回落整值。 */
function dagBoundaryName(node: DagNode): string | undefined {
  const b = node.boundary;
  if (typeof b === 'string') return b.trim() || undefined;
  if (b && typeof b === 'object' && typeof b.name === 'string') return b.name.trim() || undefined;
  const port = (node as { port?: unknown }).port;
  return typeof port === 'string' ? port.trim() || undefined : undefined;
}

/** boundary 对象形态（旧字符串形态无 type/method，返回 undefined）。 */
function dagBoundaryObject(node: DagNode): { name?: string; type?: string; method?: string } | undefined {
  return node.boundary && typeof node.boundary === 'object' ? node.boundary : undefined;
}

export function checkDagBoundaryMatchesSpec(
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
      const bname = dagBoundaryName(node);
      if (!bname) {
        issues.push(`${p} > ${node.id}: ${node.type} 节点缺 boundary.name`);
        affected.push(p);
        continue;
      }
      if (!boundaryNames.has(bname)) {
        issues.push(`${p} > ${node.id}: boundary.name="${bname}" 不在 UseCase ${uc.id} 的 data_boundaries 中`);
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
    suggestion: 'port_call_cloud / port_call_local 节点必须声明 boundary 对象（{name,type,method}），boundary.name 应匹配 use-cases.yaml > data_boundaries[].name。',
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

export function checkItNameHasAcOrBranchTag(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  /** P1-1 用例级归属：map 中的文件（legacy）只问责集合内的新增 it 名 */
  legacyNewCases?: Map<string, Set<string>>,
  opts?: {
    /**
     * [REG-*] 仅在 repair_existing_ut / cover_existing_code 工作模式下合法
     * （cover_feature_change 不放行——否则需求 UT 可借 REG 绕开 AC 绑定）。
     */
    allowRegTag?: boolean;
  },
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
    const onlyCases = legacyNewCases?.get(p);
    const blocks = extractUtItBlocks(content);
    for (const b of blocks) {
      // legacy 文件：基线已有的 it 不受本 feature 标签问责，只查新增用例
      if (onlyCases && !onlyCases.has(b.name)) continue;
      // [CHAR-*]：path-c characterization 用例（无 acceptance 场景，不得虚构 feature AC）；
      // [REG-*]：仅 repair/cover_existing 工作模式合法（回归网标签，不绑定 feature AC），
      // cover_feature_change 不放行——plan 423e5d0f。
      const tagRe = opts?.allowRegTag
        ? /^\s*\[(AC|BD|BRANCH|CHAR|REG)-/i
        : /^\s*\[(AC|BD|BRANCH|CHAR)-/i;
      if (!tagRe.test(b.name)) {
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
      details: '所有 it() 用例均带有 [AC-X]、[BD-X]、[BRANCH-X]、[CHAR-X] 或 [REG-X] 起始标签。',
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
    suggestion: 'it() 名称必须以 [AC-xxx]、[BD-xxx]、[BRANCH-xxx] 开头（characterization 用 [CHAR-xxx]，存量回归网用 [REG-xxx]）；边界可直接写 [BD-1]，也可组合使用（如 [BRANCH-happy_path][AC-1] 或 [AC-1][BD-1]）。',
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
    const blocks = extractUtItBlocks(content);
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

export function checkAcceptanceCoverage(
  ctx: CheckContext,
  dags: Array<{ path: string; dag: DagFile }>,
  observation?: DagLoadObservation,
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
      details:
        '证据口径：acceptance_coverage 只读取 DAG 顶层/nodes[] 的 linked_acceptance / linked_boundaries，不读取 it() 名。\n' +
        `无已成功解析的 DAG；候选=${observation?.candidatePaths.join(', ') || '(无)'}；` +
        `探测目录=${observation?.probedDirs.join(', ') || '(未知)'}；解析失败=${observation?.issues.length ?? 0}。`,
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
  details.push('证据口径: DAG linked_acceptance / linked_boundaries only（不读取 it() 名）');
  details.push(`已解析 DAG: ${dags.map(d => d.path).join(', ')}`);
  details.push(`DAG 已声明 scope id: ${[...coveredACs].sort().join(', ') || '(空)'}`);
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
    affected_files: dags.map(d => d.path),
    suggestion:
      `在上述已加载 DAG 的顶层或 assertion nodes[] 为 ${uncoveredP0P1.map(c => c.id).join(', ')} ` +
      '补充精确 linked_acceptance；修改 it() 名或执行 git add 不会改变本 gate。',
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
    const blocks = extractUtItBlocks(content);
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
    for (const b of extractUtItBlocks(f.content)) {
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
      const found = blocks.some(b =>
        hasExactUtBranchTag(b.name, br.id) || b.body.includes(br.id),
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
  const foundByTag = itNames.some(n => hasExactUtScopeTag(n, ac.id));
  const branchId = ac.linked_branch;
  const foundByBranch = !!branchId && blocks.some(b =>
    hasExactUtBranchTag(b.name, branchId) || b.body.includes(branchId),
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

type CoverageTarget = ReturnType<typeof collectTargetUnitBothP0P1>[number];

function coverageObservationSummary(observed: CoverageEvidenceObservation): string {
  if (observed.status === 'loaded') return `loaded:${observed.relPath}`;
  if (observed.status === 'invalid') return `invalid:${observed.relPath}`;
  return `missing:${observed.relPath}`;
}

function describeScopeEvidenceAttempt(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  target: CoverageTarget,
  dags: Array<{ path: string; dag: DagFile; source?: 'archived' | 'ephemeral' }>,
  observed: CoverageEvidenceObservation,
  acReport?: AcCoverageReport | null,
): string {
  const byTags = acHasUtTagOrBranchCoverage(ctx, utFiles, target);
  const byDag = dags.some(d => dagLinksScopeId(d.dag, target.id));
  const byAcCoverage = acCoverageCoversScope(
    ctx.projectRoot,
    ctx.feature,
    target.id,
    acReport,
  );
  const row = observed.status === 'loaded'
    ? observed.evidence.mappings?.find(m => m.scope_id === target.id)
    : undefined;
  const mapping = row
    ? `${row.evidence_source}:${mappingBackedByResolvableEvidence(
        row,
        dags,
        byTags,
        ctx.projectRoot,
        ctx.feature,
        acReport,
      ) ? 'resolved' : 'unresolved'}${row.evidence_ref ? ` ref=${row.evidence_ref}` : ''}`
    : 'none';
  return `${target.id}: ut_tag_or_branch=${byTags}, dag_link=${byDag}, ac_coverage=${byAcCoverage}, mapping=${mapping}`;
}

function checkedCoverageInputs(
  utFiles: Array<{ path: string }>,
  dags: Array<{ path: string }>,
  observed: CoverageEvidenceObservation,
): string {
  return [
    `scoped_ut_files=${utFiles.map(f => f.path).join(', ') || '(无)'}`,
    `loaded_dags=${dags.map(d => d.path).join(', ') || '(无)'}`,
    `coverage_evidence=${coverageObservationSummary(observed)}`,
  ].join('\n');
}

export function checkUtCoverageEvidencePresent(
  ctx: CheckContext,
  observed: CoverageEvidenceObservation,
): CheckResult[] {
  if (observed.status === 'invalid') {
    return [{
      id: 'ut_coverage_evidence_present',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `coverage-evidence.json 已存在但无效。\n` +
        `canonical_rel=${observed.relPath}\ncanonical_abs=${observed.absPath}\n` +
        truncateList(observed.errors, 10),
      affected_files: [observed.relPath],
      suggestion: `修复 ${observed.relPath} 的 JSON/字段问题；文件已经被 harness 找到，不需要 git add。`,
    }];
  }
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
  const acceptance = ctx.featureSpec.acceptance;
  const targetAcs = acceptance ? collectTargetUnitBothP0P1(acceptance) : [];
  if (observed.status === 'missing') {
    if (targetAcs.length > 0) {
      return [{
        id: 'ut_coverage_evidence_present',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `缺少 canonical coverage evidence；存在 in-scope unit/both P0/P1（${targetAcs.length} 条）。\n` +
          `canonical_rel=${observed.relPath}\ncanonical_abs=${observed.absPath}`,
        suggestion: `必须写入 ${observed.relPath}；UT 标签或 DAG linkage 可作为 mapping 的底层依据，但不能替代 required 文件本身。`,
      }];
    }
    return [{
      id: 'ut_coverage_evidence_present',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `缺少 ${observed.relPath}（${observed.absPath}）；无 P0/P1 unit/both 强制范围，建议 business-ut 仍写入以便追溯。`,
    }];
  }
  return [{
    id: 'ut_coverage_evidence_present',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_present'),
    severity: 'BLOCKER',
    status: 'PASS',
    details:
      `已找到并验证 ${observed.relPath}（schema_version=${observed.evidence.schema_version}）。\n` +
      `canonical_abs=${observed.absPath}` +
      (observed.warnings.length > 0 ? `\n警告：\n${truncateList(observed.warnings, 8)}` : ''),
  }];
}

export function checkUtCoverageEvidenceMappingsComplete(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  observed: CoverageEvidenceObservation,
  dags: LoadedDagFile[],
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
  if (observed.status !== 'loaded') {
    return [{
      id: 'ut_coverage_evidence_mappings_complete',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `coverage-evidence 状态=${observed.status}（由 ut_coverage_evidence_present 规则报告 canonical 路径与原因）。`,
    }];
  }
  const evidence = observed.evidence;
  const dagCtx = dags.map(d => ({ path: d.path, dag: d.dag, source: d.source }));
  const gaps: string[] = [];
  for (const ac of targetAcs) {
    const row = evidence.mappings?.find(m => m.scope_id === ac.id);
    if (!row) {
      gaps.push(`${ac.id}: 缺少 mappings[] 行；${describeScopeEvidenceAttempt(ctx, utFiles, ac, dagCtx, observed, acReport)}`);
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
      gaps.push(
        `${ac.id}: declared evidence_source=${row.evidence_source} 无对应底层证据；` +
        describeScopeEvidenceAttempt(ctx, utFiles, ac, dagCtx, observed, acReport),
      );
    }
  }
  if (gaps.length === 0) {
    return [{
      id: 'ut_coverage_evidence_mappings_complete',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        `coverage-evidence.json 含 ${targetAcs.length} 条 P0/P1 unit/both 的完整 mapping 且均有依据。\n` +
        checkedCoverageInputs(utFiles, dagCtx, observed),
    }];
  }
  return [{
    id: 'ut_coverage_evidence_mappings_complete',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_mappings_complete'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `${gaps.length} 条 P0/P1 mapping 不完整或无依据：\n${truncateList(gaps, 12)}\n` +
      checkedCoverageInputs(utFiles, dagCtx, observed),
    affected_files: [observed.relPath, ...utFiles.map(f => f.path), ...dagCtx.map(d => d.path)],
    suggestion:
      `修复 ${observed.relPath} 的 mappings[]：每个 scope_id 一行，且 declared evidence_source 必须由对应 ` +
      'UT tag、同类 archived/ephemeral DAG linkage 或 ac-coverage ut_covered=true 支撑。',
  }];
}

export function checkUtCoverageEvidenceResolves(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  observed: CoverageEvidenceObservation,
  dags: LoadedDagFile[],
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
  const evidence = observed.status === 'loaded' ? observed.evidence : undefined;
  const missing: string[] = [];

  const dagCtx = dags.map(d => ({ path: d.path, dag: d.dag, source: d.source }));

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
      missing.push(
        `${ac.id} (${ac.priority}${ac.ut_layer ? `, ut_layer=${ac.ut_layer}` : ''}); ` +
        describeScopeEvidenceAttempt(ctx, utFiles, ac, dagCtx, observed, acReport),
      );
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'ut_coverage_evidence_resolves',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        `所有 in-scope unit/both P0/P1（${targetAcs.length} 条）均有可解析覆盖证据` +
        '（UT tag/branch、DAG、ac-coverage 或受底层证据支撑的 mapping）。\n' +
        checkedCoverageInputs(utFiles, dagCtx, observed),
    }];
  }

  return [{
    id: 'ut_coverage_evidence_resolves',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_coverage_evidence_resolves'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `${missing.length} 条 in-scope AC/BD 无覆盖证据（非 allowlist SKIP）：\n${truncateList(missing, 15)}\n` +
      checkedCoverageInputs(utFiles, dagCtx, observed),
    affected_files: [...utFiles.map(f => f.path), ...dagCtx.map(d => d.path), observed.relPath],
    suggestion:
      '按每条诊断补精确 it() tag/linked branch、DAG linkage 或 ac-coverage 事实；若写 mapping，' +
      `在 ${observed.relPath} 声明与底层证据一致的 evidence_source。git add 不会改变解析结果。`,
  }];
}

export function checkUtCasePerUnitAc(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
  observed: CoverageEvidenceObservation,
  dags?: Array<{ path: string; dag: DagFile; source?: 'archived' | 'ephemeral' }>,
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
      details:
        '无 scoped UT 文件可分析；ut_case_per_unit_ac 至少要求当前 feature 有一个可分析 UT 文件。\n' +
        checkedCoverageInputs([], dags ?? [], observed),
      suggestion:
        '在 contracts.modules[].package_path 对应的单元测试目录下补测试文件，并以精确 [AC-*] / [BRANCH-*] 标签关联；无需 git add。',
    }];
  }

  const evidence = observed.status === 'loaded' ? observed.evidence : undefined;
  const dagCtx = (dags ?? []).map(d => ({ path: d.path, dag: d.dag, source: d.source }));
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
      missing.push(
        `${ac.id} (${ac.priority}${ac.ut_layer ? `, ut_layer=${ac.ut_layer}` : ''}): ${ac.description}; ` +
        describeScopeEvidenceAttempt(ctx, utFiles, ac, dagCtx, observed, acReport),
      );
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        `所有 ut_layer∈{unit,both} 且 P0/P1 的 ${targetAcs.length} 条 AC/BD 均有可解析 UT 覆盖证据。\n` +
        checkedCoverageInputs(utFiles, dagCtx, observed),
    }];
  }

  return [{
    id: 'ut_case_per_unit_ac',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `${missing.length} 条 in-scope AC/BD 无覆盖证据：\n${truncateList(missing, 15)}\n` +
      checkedCoverageInputs(utFiles, dagCtx, observed),
    affected_files: [...utFiles.map(f => f.path), ...dagCtx.map(d => d.path), observed.relPath],
    suggestion:
      '优先为上述 AC/BD 补精确 it() 标签（名称以 [AC-<完整 id>] 或 [BRANCH-<linked_branch>] 起始）；' +
      '若使用 DAG/ac-coverage/mapping 证据，须让对应 source 可解析。git add 不会改变证据。',
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
    const foundByIt = itNames.some(n => hasExactUtScopeTag(n, bd.id));
    const foundByBody = !!bd.linked_branch && blocks.some(b =>
      hasExactUtBranchTag(b.name, bd.linked_branch!) || b.body.includes(bd.linked_branch!),
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

export type UtMachineArtifactObservation<T> =
  | { status: 'missing'; absPath: string; relPath: string }
  | { status: 'invalid'; absPath: string; relPath: string; errors: string[] }
  | { status: 'loaded'; absPath: string; relPath: string; value: T; warnings: string[] };

function artifactIssuesByField(
  issues: Array<{ field: string; message: string }>,
  fields: ReadonlySet<string>,
): string[] {
  return issues
    .filter(issue => fields.has(issue.field))
    .map(issue => `${issue.field}: ${issue.message}`);
}

export function inspectTestabilityAudit(
  ctx: CheckContext,
): UtMachineArtifactObservation<TestabilityAuditRecord[]> {
  const absPath = testabilityAuditPath(ctx);
  const relPath = path.relative(ctx.projectRoot, absPath).replace(/\\/g, '/');
  if (!fs.existsSync(absPath)) return { status: 'missing', absPath, relPath };
  const validation = validateTestabilityAuditFile(absPath);
  const parseErrors = artifactIssuesByField(
    validation.errors,
    new Set(['format', 'yaml', 'records', 'file']),
  );
  if (parseErrors.length > 0) {
    return {
      status: 'invalid',
      absPath,
      relPath,
      errors: parseErrors,
    };
  }
  return {
    status: 'loaded',
    absPath,
    relPath,
    value: parseTestabilityAuditFile(absPath),
    warnings: validation.warnings.map(w => `${w.field}: ${w.message}`),
  };
}

export function inspectMockPlan(
  ctx: CheckContext,
): UtMachineArtifactObservation<MockPlanSpec> {
  const absPath = mockPlanPath(ctx);
  const relPath = path.relative(ctx.projectRoot, absPath).replace(/\\/g, '/');
  if (!fs.existsSync(absPath)) return { status: 'missing', absPath, relPath };
  const validation = validateMockPlanFile(absPath);
  const plan = parseMockPlanFile(absPath);
  const parseErrors = artifactIssuesByField(
    validation.errors,
    new Set(['format', 'root', 'yaml', 'parse', 'file']),
  );
  if (parseErrors.length > 0 || !plan) {
    return {
      status: 'invalid',
      absPath,
      relPath,
      errors: parseErrors.length > 0
        ? parseErrors
        : ['parse: mock-plan.yaml 无法解析为 YAML mapping/object'],
    };
  }
  return {
    status: 'loaded',
    absPath,
    relPath,
    value: plan,
    warnings: validation.warnings.map(w => `${w.field}: ${w.message}`),
  };
}

export function checkUtMachineArtifactParseable<T>(
  ctx: CheckContext,
  id: 'ut_testability_audit_parseable' | 'ut_mock_plan_parseable',
  label: string,
  observed: UtMachineArtifactObservation<T>,
): CheckResult[] {
  if (observed.status === 'missing') {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `${label} 不存在；canonical_rel=${observed.relPath}；由对应 presence gate 决定是否必需。`,
    }];
  }
  if (observed.status === 'invalid') {
    // plan f4c8d2b7 t4：两产物格式契约不同，suggestion 按 id 分别生成——
    // audit 允许 fenced yaml 或纯 YAML（根 records[]），mock-plan 必须纯 YAML（根 spies[]/doubles[]），
    // 不得用 audit 的契约指导 mock-plan（反之亦然）。
    const sp = utSuggestionPaths(ctx);
    const contract =
      id === 'ut_testability_audit_parseable'
        ? `格式契约：机器可读内容须为 fenced \`\`\`yaml 块或纯 YAML 全文，根字段 records[]；禁止用 Markdown 表格代替机器记录。模板：${sp.testabilityAuditTemplateRel}`
        : `格式契约：必须为纯 YAML（禁止 fenced code block、Markdown 标题/表格），根字段 spies[] 或 doubles[]。Schema：${sp.mockPlanSchemaTemplateRel}`;
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `${label} 已存在但无法作为机器产物消费。\n` +
        `canonical_rel=${observed.relPath}\ncanonical_abs=${observed.absPath}\n` +
        truncateList(observed.errors, 12),
      affected_files: [observed.relPath],
      suggestion: `修复 ${observed.relPath} 的 YAML/根节点/字段格式；文件已被 harness 找到，不需要 git add。${contract}`,
    }];
  }
  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details:
      `${label} 已解析：${observed.relPath}` +
      (observed.warnings.length > 0 ? `\n警告：\n${truncateList(observed.warnings, 8)}` : ''),
  }];
}

function skipBecauseArtifactInvalid(
  ctx: CheckContext,
  id: string,
  category: 'structure' | 'traceability',
  relPath: string,
): CheckResult[] {
  return [{
    id,
    category,
    description: ruleDesc(
      ctx,
      category === 'structure' ? 'structure_checks' : 'traceability_checks',
      id,
    ),
    severity: 'BLOCKER',
    status: 'SKIP',
    details: `${relPath} 存在但无效；由对应 *_parseable / present BLOCKER 报告解析原因，本检查不重复误报为缺失。`,
  }];
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

function checkUtTestabilityAuditPresent(
  ctx: CheckContext,
  observed: UtMachineArtifactObservation<TestabilityAuditRecord[]>,
): CheckResult[] {
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

  if (observed.status === 'invalid') {
    return skipBecauseArtifactInvalid(ctx, id, 'structure', observed.relPath);
  }
  if (observed.status === 'missing') {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `缺少 ${observed.relPath}\ncanonical_abs=${observed.absPath}\n` +
        `模板：${utSuggestionPaths(ctx).testabilityAuditTemplateRel}`,
      suggestion: '为每条 unit/both 的 AC/BD 写入 testability-audit.md（Markdown 内嵌 YAML，根字段 records[]）',
    }];
  }

  const records = observed.value;
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

function checkUtUnsupportedTargetsHandled(
  ctx: CheckContext,
  observed: UtMachineArtifactObservation<TestabilityAuditRecord[]>,
): CheckResult[] {
  const id = 'ut_unsupported_targets_handled';

  if (observed.status === 'invalid') {
    return skipBecauseArtifactInvalid(ctx, id, 'structure', observed.relPath);
  }
  if (observed.status === 'missing') {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'testability-audit.md 不存在（由 ut_testability_audit_present 先行阻断）。',
    }];
  }

  const records = observed.value;
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
      issues.push(
        `${r.acceptance_id}: option_b 表示仍需业务源码可测性改造，必须交回 coding owner；` +
        'coding 重验后该记录应降为 L1/L2，再由 UT 继续',
      );
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
        'option_a → 在 acceptance.yaml 对应 AC/BD 填写 device_focus；option_b → 产出 coding repair candidate，由 coding owner 修改源码并重走 review→ut。',
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

export function checkUtMockPlanPresent(
  ctx: CheckContext,
  records: TestabilityAuditRecord[],
  observed: UtMachineArtifactObservation<MockPlanSpec>,
): CheckResult[] {
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

  if (observed.status === 'invalid') {
    return skipBecauseArtifactInvalid(ctx, id, 'structure', observed.relPath);
  }
  const mp = observed.status === 'loaded' ? observed.value : null;
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
        `写入 ${relFeatureFile(ctx.projectRoot, ctx.feature, 'ut/mock-plan.yaml')}，声明 test double（strategy: spy | mockkit | fake | prototype_patch）与 presets。`,
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
        missingSpyForDep.push(
          `${rec.acceptance_id}: 依赖 ${d.name}（kind=${d.kind || '?'}) 缺少 mock-plan target_class` +
          (d.name?.includes('.') ? `（注意：dependencies[].name 与 target_class 口径均为纯类名，「${d.name}」疑似「类.方法」——方法级信息写 entry_point.symbol 或 mock-plan methods[]，不写入 name）` : ''),
        );
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
        '补全 testability-audit.md 的 dependencies，或在 mock-plan.yaml 中为非 pure 外部依赖声明 test double（勿将被测 entry_point 写入 mock-plan）。' +
        '口径：dependencies[].name 与 target_class 均为纯类名；方法级信息写 entry_point.symbol、mock-plan methods[] 或相应方法字段，不写入 dependency name。',
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

export function checkUtHypiumMockkitPolicy(
  ctx: CheckContext,
  plan: MockPlanSpec | null,
  utFiles: Array<{ path: string; content: string }>,
  auditRecords: TestabilityAuditRecord[],
  legacyExempt: Array<{ path: string; content: string }> = [],
  scopeNote = '',
  legacyIncrements: UtLegacyIncrement[] = [],
): CheckResult[] {
  const id = 'ut_hypium_mockkit_policy';
  const legacyMockkitUsers = legacyExempt.filter(f => utFileImportsHypiumMockkit(f.content));
  const legacyNote = legacyMockkitUsers.length > 0
    ? `\n责任域外豁免：${legacyMockkitUsers.length} 个 UT 文件使用 MockKit/when 但不在本 feature 责任域（基线已存在的存量，或不在 scoped 集合），不要求本 feature mock-plan/contracts 登记：\n${truncateList(legacyMockkitUsers.map(f => f.path), 8)}`
    : '';
  const noteSuffix = `${scopeNote}${legacyNote}`;
  const offenders = utFiles.filter(f => utFileImportsHypiumMockkit(f.content));
  // P1-1 用例级归属：legacy 文件内新增 it 时，只治理**相对基线新增**的 mock 用法；
  // 基线已有的 MockKit 面继续豁免（否则又回到存量误伤）。
  const incrementOffenders = legacyIncrements.filter(f => {
    if (!utFileImportsHypiumMockkit(f.content)) return false;
    const surface = collectNewMockkitSurface(f.content, f.baselineContent);
    return surface.newUsages.length > 0 || surface.newUnparsed.length > 0;
  });
  if (offenders.length === 0 && incrementOffenders.length === 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `本 feature 责任域内的 UT 未从 @ohos/hypium 导入 MockKit/when（或存量文件无新增 mock 用法），跳过 mock 策略门禁。${noteSuffix}`,
    }];
  }

  if (!plan || !mockPlanAllowsHypiumMockkit(plan)) {
    const offenderPaths = [
      ...offenders.map(f => f.path),
      ...incrementOffenders.map(f => `${f.path}（存量文件内新增 mock 用法）`),
    ];
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `${offenderPaths.length} 个本 feature 责任域内的 UT 文件使用了 MockKit/hypium when，但 mock-plan 无 strategy=mockkit 条目：\n` +
        truncateList(offenderPaths, 10) + noteSuffix,
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
  const violations: string[] = [];
  const unresolved: string[] = [];
  for (const f of offenders) {
    const report = collectUtMockkitGovernanceReport(f.content, plan, forbiddenEntries);
    for (const msg of report.violations) violations.push(`${f.path}: ${msg}`);
    for (const msg of report.unresolved) unresolved.push(`${f.path}: ${msg}`);
  }
  // P1-1 增量治理：legacy 文件只对相对基线新增的 mock 用法问责
  for (const f of incrementOffenders) {
    const report = collectUtMockkitGovernanceReport(f.content, plan, forbiddenEntries, {
      baselineContent: f.baselineContent,
    });
    for (const msg of report.violations) violations.push(`${f.path}（增量）: ${msg}`);
    for (const msg of report.unresolved) unresolved.push(`${f.path}（增量）: ${msg}`);
  }
  if (violations.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `MockKit/when 用法未与 mock-plan mockkit 条目对齐：\n${truncateList(violations, 15)}${noteSuffix}`,
      suggestion:
        '仅允许 mock mock-plan 已声明的 mockkit 边界与方法（支持 MockKit.mock(Class)、kit.mock(Class)、kit.mockFunc(obj, obj.method)）；' +
        '禁止 mock entry_point/coordinator；声明了 presets 时 when 行为须引用 presets[].id。',
    }];
  }

  if (unresolved.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'WARN',
      details:
        `${offenders.length + incrementOffenders.length} 个 UT 使用 @ohos/hypium MockKit/when；无已证明的违规，但 ${unresolved.length} 处静态解析不出（解析不出 ≠ 违规）：\n` +
        `${truncateList(unresolved, 15)}${noteSuffix}`,
      suggestion:
        '如需可追溯性，将上述方法补进 mock-plan mockkit 条目 methods[]；无法静态判定目标类的 mockFunc 用法由 AI verifier 语义复核，不阻塞脚本门禁。',
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `${offenders.length + incrementOffenders.length} 个 UT 使用 @ohos/hypium MockKit/when，mock-plan mockkit 策略、contracts 与用法追溯均已对齐。${noteSuffix}`,
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

export function checkUtMockPlanContractsConsistent(ctx: CheckContext, plan: MockPlanSpec | null): CheckResult[] {
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

export function checkDagSpyPresetResolvable(
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
        cls = dagBoundaryObject(node)?.type;
        meth = dagBoundaryObject(node)?.method;
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
    // t1d（plan e6a3c9f4）：编排边界附加产出来源，供报告/summary 定位真实产出方。
    return fn().map(r => (r.source ? r : { ...r, source: checkId }));
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
  scopeInfo?: {
    allCount: number;
    scopedCount: number;
    scopeSources: string[];
    scopedFiles: string[];
    scopeDiagnostics: string[];
  },
  modeInfo?: {
    mode: string;
    featureGatesActive: boolean;
    explicitRequested: number;
    explicitMatched: number;
    targetFileCount: number;
    legacyIncrementCases: number;
  },
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
  // 设备阻塞是否为唯一 BLOCKER（决定 INCOMPLETE 而非 FAIL 的资格）
  const deviceBlockedIsOnlyBlocker =
    deviceExternalBlocked &&
    compilePassed &&
    blockerFails.every(r => r.id === 'ut_hvigor_test');

  const staticBlockerFails = blockerFails.filter(r =>
    r.id !== 'ut_hvigor_build' &&
    r.id !== 'ut_hvigor_test' &&
    r.id !== 'ut_no_src_mutation'
  );

  const lines = [
    'UT 阶段状态面板：',
    ...(scopeInfo
      ? [
          `- UT 文件范围：all=${scopeInfo.allCount}, scoped=${scopeInfo.scopedCount}`,
          `- scope 来源：${scopeInfo.scopeSources.slice(0, 12).join(', ') || '(无)'}`,
          `- scoped 文件：${scopeInfo.scopedFiles.slice(0, 12).join(', ') || '(无)'}`,
          ...(scopeInfo.scopeDiagnostics.length > 0
            ? [`- scope 诊断：${scopeInfo.scopeDiagnostics.slice(0, 8).join(' | ')}`]
            : []),
        ]
      : []),
    // plan 423e5d0f P2（codex 五轮 #5）：模式与责任域必须显式披露——大量"模式不适用"的
    // SKIP 不得被汇总成"静态/结构规则 PASS"，否则 repair/cover_existing 结果看起来像
    // 通过了完整需求门禁。
    ...(modeInfo
      ? [
          `work_mode: ${modeInfo.mode}`,
          `- 责任域：新建文件 ${modeInfo.targetFileCount} 个 + 存量文件内新增用例 ${modeInfo.legacyIncrementCases} 个` +
            (modeInfo.explicitRequested > 0
              ? `；显式目标 ${modeInfo.explicitMatched}/${modeInfo.explicitRequested} 命中`
              : ''),
          `- 需求门禁（use-cases/audit/mock-plan/DAG/AC 覆盖族）：${
            modeInfo.featureGatesActive
              ? '已执行'
              : `SKIP（工作模式 ${modeInfo.mode} 不适用；本轮未验证需求追溯，AC 覆盖报告未生成/未覆写）`
          }`,
        ]
      : []),
    `- 静态/结构规则：${
      staticBlockerFails.length === 0
        ? modeInfo && !modeInfo.featureGatesActive
          ? 'PASS（仅通用/安全门禁；需求门禁按模式 SKIP）'
          : 'PASS'
        : `FAIL（${staticBlockerFails.map(r => r.id).join(', ')}）`
    }`,
    `- tsc 静态编译：${statusLabel(tsc)}`,
    `- 宿主测试模块编译：${statusLabel(build)}`,
    `- 真机/模拟器执行：${shortCircuited ? '未执行（ut_hvigor_build 失败短路）' : statusLabel(test)}`,
    `- 源码改动检查：${statusLabel(mutation)}`,
    // plan 423e5d0f P1-3：两结论分离——本 feature 结论与套件健康各自成行，
    // feature_verdict=PASS 可与 suite_health=DEGRADED 并存（历史失败不拖死本需求）。
    // INCOMPLETE 仅当设备阻塞是**唯一** BLOCKER（codex 六轮 #2）：同时存在目标解析/
    // 标签/源码红线等 FAIL 时必须是 FAIL，否则设备离线会掩盖真实缺陷。
    `feature_verdict: ${
      canClaimDone ? 'PASS' : deviceBlockedIsOnlyBlocker ? 'INCOMPLETE' : 'FAIL'
    }`,
    `suite_health: ${/suite_health:\s*(HEALTHY|DEGRADED)/.exec(test?.details ?? '')?.[1] ?? 'UNKNOWN'}`,
    `- 当前是否可以宣称 UT 完成：${canClaimDone ? '是' : '否'}`,
    `can_claim_done: ${canClaimDone ? 'YES' : 'NO'}`,
  ];

  if (deviceBlockedIsOnlyBlocker) {
    lines.push('- partial_readiness: compile_passed_device_blocked（harness verdict 应为 INCOMPLETE，非 PASS）');
  } else if (deviceExternalBlocked && compilePassed) {
    lines.push(
      `- 设备阻塞与其他 BLOCKER 并存：不适用 partial_readiness（verdict=FAIL）；其他阻塞项=${
        blockerFails.filter(r => r.id !== 'ut_hvigor_test').map(r => r.id).join(', ')
      }`,
    );
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

    const dagObservation = loadDagFiles(ctx);
    const dags = dagObservation.files;
    const coverageObservation = inspectCoverageEvidence(ctx);
    const auditObservation = inspectTestabilityAudit(ctx);
    const mockPlanObservation = inspectMockPlan(ctx);
    const allUtFiles = utHost.loadUtFiles(ctx);
    const partition = utHost.partitionUtFiles?.(ctx, allUtFiles) ?? {
      all: allUtFiles,
      scoped: allUtFiles,
      scopeSources: ['fallback:all'],
      scopeDiagnostics: ['profile-partitioner-unavailable'],
    };
    const scopedUtFiles = partition.scoped;
    const mockPlanDoc = mockPlanObservation.status === 'loaded' ? mockPlanObservation.value : null;
    const auditRecordsEarly = auditObservation.status === 'loaded' ? auditObservation.value : [];

    // plan 423e5d0f P1-1/P2：统一 target 解析（提前到所有门禁之前——工作模式决定
    // 需求工件门禁是否适用）。repair_existing_ut / cover_existing_code 不强制
    // use-cases/AC/DAG/mock-plan（需求工件门禁按模式 SKIP），但源码红线、真实编译/执行、
    // 棘轮、UI 禁入、命名/注册等通用与安全门禁照常。
    const targetResolution: UtTargetResolution = resolveUtTargets(ctx, allUtFiles, scopedUtFiles);
    const utBaseline = targetResolution.baseline;
    const featureNewUtFiles = targetResolution.targetFiles;
    const legacyIncrements = targetResolution.legacyIncrements;
    const legacyExemptUtFiles = targetResolution.exemptFiles;
    const featureGatesActive = targetResolution.mode === 'cover_feature_change';
    const modeSkip = (
      id: string,
      category: CheckResult['category'],
      section: 'structure_checks' | 'semantic_checks' | 'traceability_checks' = 'structure_checks',
    ): CheckResult[] => [{
      id,
      category,
      description: ruleDesc(ctx, section, id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: `工作模式=${targetResolution.mode}：需求工件门禁不适用（repair_existing_ut / cover_existing_code 不强制 use-cases/AC/DAG/mock-plan——plan 423e5d0f P2）。`,
    }];

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, ['spec.md', 'plan.md']),
    ];
    results.push(...safeRun(
      () => checkChangeUnitFeatureProjection(ctx, 'ut', dags),
      'change_unit_feature_projection',
    ));

    // repair/cover_existing 模式 fail-closed（codex 五轮 #4）：显式目标未命中/缺基线锚
    // 不得静默继续——配合历史失败基线可能把真正要修的失败全部豁免。
    if (!featureGatesActive) {
      const failTargetResolution = (details: string, suggestion: string): void => {
        results.push({
          id: 'ut_target_resolution',
          category: 'structure',
          description: 'UT 工作模式目标解析（repair/cover_existing fail-closed）',
          severity: 'BLOCKER',
          status: 'FAIL',
          details,
          suggestion,
        });
      };
      if (!utBaseline.available) {
        failTargetResolution(
          `工作模式=${targetResolution.mode} 但无可信基线锚：${utBaseline.note}`,
          '设置 HARNESS_DIFF_BASE_REF=<动手前 commit> 后重跑（repair/cover_existing 必须显式锚区分存量与本轮改动）。',
        );
      } else if (targetResolution.mode === 'repair_existing_ut' && targetResolution.explicitRequested === 0) {
        failTargetResolution(
          `repair_existing_ut 要求显式声明修复目标：${UT_TARGETS_ENV} 为空。\n${targetResolution.selectionReasons.join('\n')}`,
          '设置 MAISON_UT_TARGETS=<目标 UT 文件相对路径>（分号/逗号分隔）后重跑。',
        );
      } else if (targetResolution.explicitRequested > 0
        && targetResolution.explicitMatched !== targetResolution.explicitRequested) {
        // 部分命中同样 fail-closed（codex 五轮 #1）：每条显式路径都是用户的责任域声明，
        // 拼错一条就静默少修一个目标，且其失败可能被历史基线豁免掉。
        failTargetResolution(
          `显式目标未全部命中：requested=${targetResolution.explicitRequested}, matched=${targetResolution.explicitMatched}。\n${targetResolution.selectionReasons.join('\n')}`,
          '核对 MAISON_UT_TARGETS 中每条路径（须是相对项目根、且已被 harness 发现的测试文件）后重跑。',
        );
      } else if (targetResolution.mode === 'cover_existing_code'
        && featureNewUtFiles.length === 0
        && legacyIncrements.length === 0) {
        // 有效产出只认**新建测试文件**或**存量文件内新增 it**（codex 七轮）：
        // 显式目标只决定"跑哪些"不构成产出证据；文本变化（注释/空格/import）同样不算——
        // 它既不进 targetCaseView 受验收，失败还可能被 suite 基线豁免。
        failTargetResolution(
          `cover_existing_code 无实际测试产出：既无新建测试文件，也无存量文件内新增用例。\n${targetResolution.selectionReasons.join('\n')}`,
          '新建 [REG-*] 测试文件，或在存量文件中新增 [REG-*] 用例后重跑（显式目标仅决定执行范围，改注释/格式等文本变化不构成测试产出）。',
        );
      } else {
        results.push({
          id: 'ut_target_resolution',
          category: 'structure',
          description: 'UT 工作模式目标解析（repair/cover_existing fail-closed）',
          severity: 'BLOCKER',
          status: 'PASS',
          details: `工作模式=${targetResolution.mode}；${utBaseline.note}\n${targetResolution.selectionReasons.slice(0, 12).join('\n')}`,
        });
      }
    }

    results.push(...(featureGatesActive
      ? safeRun(() => checkDagFilesParseable(ctx, dagObservation), 'dag_files_parseable')
      : modeSkip('dag_files_parseable', 'structure')));
    const featureGate = (id: string, run: () => CheckResult[], category: CheckResult['category'] = 'structure', section: 'structure_checks' | 'semantic_checks' | 'traceability_checks' = 'structure_checks'): void => {
      results.push(...(featureGatesActive ? safeRun(run, id) : modeSkip(id, category, section)));
    };

    featureGate('ut_testability_audit_parseable', () =>
      checkUtMachineArtifactParseable(ctx, 'ut_testability_audit_parseable', 'testability-audit.md', auditObservation));
    featureGate('ut_mock_plan_parseable', () =>
      checkUtMachineArtifactParseable(ctx, 'ut_mock_plan_parseable', 'mock-plan.yaml', mockPlanObservation));

    featureGate('context_exploration_gate', () =>
      checkFactsArtifact(ctx.projectRoot, ctx.feature, 'ut', {
        phaseRule: ctx.phaseRule,
        profileName: ctx.resolvedProfile.name,
        frameworkRoot: ctx.frameworkRoot,
      }));

    // --- blind-visual-hardening d1 切片一：上游裁决传播（review 不通过不得进 ut）---
    featureGate('upstream_verdict_gate', () =>
      checkUpstreamVerdictGate({ projectRoot: ctx.projectRoot, feature: ctx.feature, phase: 'ut' }));

    if (featureGatesActive) {
      results.push(
        ...runAcceptanceYamlStructureChecks(ctx, (c, s, id) =>
          ruleDesc(c, s as 'structure_checks' | 'semantic_checks' | 'traceability_checks', id),
        ),
      );
    } else {
      results.push(...modeSkip('acceptance_yaml_structure', 'structure'));
    }

    // --- Structure checks ---（宿主产物污染是安全红线，任何模式都查）
    results.push(
      ...safeRun(() => checkHarnessHostArtifactPollution(ctx, utHost), 'harness_host_artifact_pollution'),
    );
    // v2 A: use-cases.yaml 自身
    featureGate('usecase_spec_recommended', () => checkUseCaseSpecRecommended(ctx));
    featureGate('usecase_spec_schema', () => checkUseCaseSpecSchema(ctx));
    featureGate('usecase_ui_bindings_nonempty', () => checkUseCaseUiBindingsNonempty(ctx));
    featureGate('boundary_matches_contracts', () => checkBoundaryMatchesContracts(ctx));
    featureGate('named_business_handler', () => checkNamedBusinessHandler(ctx));

    // v2.3：可测性预检 + mock-plan（先于 DAG 拓扑之后的 trace，但逻辑上属于 UT 规约门禁）
    featureGate('ut_testability_audit_present', () => checkUtTestabilityAuditPresent(ctx, auditObservation));
    featureGate('ut_unsupported_targets_handled', () => checkUtUnsupportedTargetsHandled(ctx, auditObservation));
    featureGate('ut_mock_plan_present', () => checkUtMockPlanPresent(ctx, auditRecordsEarly, mockPlanObservation));
    featureGate('ut_mock_plan_typed', () =>
      mockPlanObservation.status === 'invalid'
        ? skipBecauseArtifactInvalid(ctx, 'ut_mock_plan_typed', 'structure', mockPlanObservation.relPath)
        : checkUtMockPlanTyped(ctx, mockPlanDoc));
    featureGate('ut_mock_plan_contracts_consistent', () =>
      mockPlanObservation.status === 'invalid'
        ? skipBecauseArtifactInvalid(ctx, 'ut_mock_plan_contracts_consistent', 'structure', mockPlanObservation.relPath)
        : checkUtMockPlanContractsConsistent(ctx, mockPlanDoc));

    // v1 保留 + v2 修订：DAG 结构
    featureGate('dag_schema_compliance', () => checkDagSchemaCompliance(ctx, dags));
    featureGate('dag_node_type_valid', () => checkDagNodeTypeValid(ctx, dags));
    featureGate('dag_acyclic', () => checkDagAcyclic(ctx, dags));
    featureGate('dag_source_file_exists', () => checkDagSourceFileExists(ctx, dags));
    // v2 B: DAG ↔ use-cases 关联
    featureGate('dag_linked_usecase', () => checkDagLinkedUseCase(ctx, dags));
    featureGate('dag_boundary_matches_spec', () => checkDagBoundaryMatchesSpec(ctx, dags));
    featureGate('dag_assertion_linked_branch', () => checkDagAssertionLinkedBranch(ctx, dags));
    featureGate('dag_cohesion', () => checkDagCohesion(ctx, dags));
    featureGate('dag_spy_preset_resolvable', () =>
      mockPlanObservation.status === 'invalid'
        ? skipBecauseArtifactInvalid(ctx, 'dag_spy_preset_resolvable', 'structure', mockPlanObservation.relPath)
        : checkDagSpyPresetResolvable(ctx, dags, mockPlanDoc));

    // v1 保留 + v2 修订：UT 代码（宿主工具链规则由 profile ut-host-impl 提供）
    results.push(...safeRun(() => utHost.checkUtFileNaming(ctx, allUtFiles), 'ut_file_naming'));
    results.push(...safeRun(() => utHost.checkUtFrameworkImport(ctx, allUtFiles), 'ut_framework_import'));
    // mockkit 政策=需求工件门禁（要求 mock-plan/contracts 登记），repair/cover_existing 模式
    // 无 feature 工件可对齐 → 按模式 SKIP（新增 mock 用法由 verifier/review 兜底）。
    featureGate('ut_hypium_mockkit_policy', () =>
      mockPlanObservation.status === 'invalid'
        ? skipBecauseArtifactInvalid(ctx, 'ut_hypium_mockkit_policy', 'structure', mockPlanObservation.relPath)
        : checkUtHypiumMockkitPolicy(
            ctx,
            mockPlanDoc,
            featureNewUtFiles,
            auditRecordsEarly,
            legacyExemptUtFiles,
            `\n身份基线：${utBaseline.note}`,
            legacyIncrements,
          ));
    results.push(...safeRun(() => checkUtAssertionExists(ctx, allUtFiles), 'ut_assertion_exists'));
    // v2.2 方案 A：静态 tsc --noEmit 检查。plan 423e5d0f P0-1：全量跑但只作快速诊断
    // （WARN）——模拟 tsc 会对存量代码产生真实工具链不报的假错，编译 BLOCKER 唯一来源
    // 是真实编译门禁（canonical id: ut_compile）；仅当 profile 把 ut.compile 声明 SKIP
    // 时 tsc 保持 FAIL（仅存护城河不降级）。降级逻辑在 profile checkUtTscCompiles 内。
    results.push(...safeRun(() => utHost.checkUtTscCompiles(ctx, allUtFiles), 'ut_tsc_compiles'));
    // v2.2 方案 B：由 profile ut.compile 能力驱动的真实测试模块编译
    const hvigorBuildResults = safeRun(
      // 显式目标文件（repair）必须进编译/执行集合，即使不在 scoped
      () => utHost.checkUtHvigorBuild(
        ctx,
        [...scopedUtFiles, ...targetResolution.explicitTargetFiles.filter(e => !scopedUtFiles.some(s => s.path === e.path))],
        featureNewUtFiles,
      ),
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
      // P1-2：target it 名传给真实执行门禁——suite 棘轮中 target 失败永不豁免
      // 棘轮"永不豁免"名单 = 责任域用例 + 显式目标文件的**全部** it（repair 修的就是
      // 存量失败用例——若它在历史基线里被豁免，修复就永远无法被验证）。
      // 携带 path：模块身份由 profile 按 package_path 归属推导（module::test）。
      const collectCases = (files: Array<{ path: string; content: string }>): Array<{ path: string; test: string }> =>
        files.flatMap(f => collectItNames(ctx, [f]).map(test => ({ path: f.path, test })));
      const targetCases = [
        ...collectCases(targetResolution.targetCaseView),
        ...collectCases(targetResolution.explicitTargetFiles),
      ];
      const runScope = [
        ...scopedUtFiles,
        ...targetResolution.explicitTargetFiles.filter(e => !scopedUtFiles.some(s => s.path === e.path)),
      ];
      results.push(...safeRun(() => utHost.checkUtHvigorTest(ctx, runScope, targetCases), 'ut_hvigor_test'));
    }
    // v2.2 红线 5.2：business-ut 不得擅改业务源码
    results.push(...safeRun(() => checkUtNoSrcMutation(ctx), 'ut_no_src_mutation'));
    featureGate('mock_stub_for_async', () => checkMockStubForAsync(ctx, dags, allUtFiles));
    results.push(...safeRun(() => utHost.checkTestRegistration(ctx, allUtFiles), 'test_registration'));
    // v2 C: UT 代码——P1-1 需求房规**统一消费 targetCaseView**（新建文件原样 + legacy
    // 文件内新增 import/it 的合成条目），存量文件基线已有内容不受问责，新增内容与
    // 新文件同等问责（codex 第四轮：不得只有标签/mockkit 消费增量）。
    const targetCaseView = targetResolution.targetCaseView;
    results.push(...safeRun(() => checkUtImportWhitelist(ctx, targetCaseView), 'ut_import_whitelist'));
    featureGate('boundaries_all_stubbed', () => checkBoundariesAllStubbed(ctx, targetCaseView));
    // 标签只问责 feature 责任域——存量文件被 context 提及/git 触碰仍会进 scoped，
    // 但"提及 ≠ 归属"；基线已有的存量 it 不得被逼挂本需求 AC 标签（假覆盖源头）。
    // [REG-*] 仅 repair/cover_existing 模式放行（cover_feature_change 禁用，防绕 AC 绑定）。
    const allowRegTag = targetResolution.mode !== 'cover_feature_change';
    results.push(...safeRun(() => checkItNameHasAcOrBranchTag(ctx, targetCaseView, undefined, { allowRegTag }), 'it_name_has_ac_or_branch_tag')
      .map(r => ({
        ...r,
        details: `${r.details}\n身份口径：只问责本 feature 责任域（新建 ${featureNewUtFiles.length} 个文件 + 存量文件内新增 ${legacyIncrements.reduce((s, f) => s + f.newCases.size, 0)} 个用例；工作模式=${targetResolution.mode}）。${utBaseline.note}`,
      })));
    featureGate('it_drives_flow', () => checkItDrivesFlow(ctx, targetCaseView));

    // --- Traceability checks ---（需求追溯族：按模式分流）
    featureGate('dag_to_acceptance', () => checkDagToAcceptance(ctx, dags), 'traceability', 'traceability_checks');
    featureGate('acceptance_coverage', () => checkAcceptanceCoverage(ctx, dags, dagObservation), 'traceability', 'traceability_checks');
    featureGate('dag_to_source', () => checkDagToSource(ctx, dags), 'traceability', 'traceability_checks');

    // P1-1：覆盖计算与追溯族统一消费 targetCaseView——存量 it 不再稀释本需求 ac-coverage
    //（假覆盖防护）；legacy 文件内新增 it 经合成条目并入覆盖统计与全部追溯规则。
    //（无基线锚时 view=scoped、increments 空，行为与改造前逐字等价。）
    const coverageUtFiles = targetCaseView;
    let acCoverageReport: AcCoverageReport | null = null;
    let acCoverageRel = '';
    // 非需求模式不得生成/覆写本 feature 的 AC 覆盖证据（codex 五轮 #4）：repair/REG 的
    // target view 会把原需求覆盖报告重写成空或无关内容。
    const acceptanceForReport = featureGatesActive ? ctx.featureSpec.acceptance : undefined;
    if (acceptanceForReport && scopedUtFiles.length > 0) {
      try {
        const itNames = collectItNames(ctx, coverageUtFiles);
        acCoverageReport = buildAcCoverageReport(ctx.feature, acceptanceForReport, itNames);
        const outPath = writeAcCoverageReport(ctx.projectRoot, ctx.feature, acCoverageReport);
        acCoverageRel = path.relative(ctx.projectRoot, outPath).replace(/\\/g, '/');
      } catch {
        acCoverageReport = null;
      }
    }

    // v2 Traceability（须在 ac-coverage.json 落盘之后，以便 ac_coverage 证据首轮可解析）
    featureGate('ut_coverage_evidence_present', () => checkUtCoverageEvidencePresent(ctx, coverageObservation), 'traceability', 'traceability_checks');
    featureGate('ut_coverage_evidence_mappings_complete', () => checkUtCoverageEvidenceMappingsComplete(ctx, coverageUtFiles, coverageObservation, dags, acCoverageReport), 'traceability', 'traceability_checks');
    featureGate('ut_coverage_evidence_resolves', () => checkUtCoverageEvidenceResolves(ctx, coverageUtFiles, coverageObservation, dags, acCoverageReport), 'traceability', 'traceability_checks');
    featureGate('origin_tag_required', () => checkOriginTagRequired(dags, ctx), 'traceability', 'traceability_checks');
    featureGate('characterization_trace_matches', () => checkCharacterizationTraceMatches(ctx, dags, coverageUtFiles), 'traceability', 'traceability_checks');
    featureGate('branch_coverage_full', () => checkBranchCoverageFull(ctx, coverageUtFiles, dags), 'traceability', 'traceability_checks');
    featureGate('ut_case_per_unit_ac', () => checkUtCasePerUnitAc(ctx, coverageUtFiles, coverageObservation, dags, acCoverageReport), 'traceability', 'traceability_checks');
    featureGate('boundary_coverage', () => checkBoundaryCoverage(ctx, coverageUtFiles, dags), 'traceability', 'traceability_checks');

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

    results.push(buildUtRunStatusResult(
      results,
      {
        allCount: partition.all.length,
        scopedCount: partition.scoped.length,
        scopeSources: partition.scopeSources,
        scopedFiles: partition.scoped.map(f => f.path),
        scopeDiagnostics: partition.scopeDiagnostics ?? [],
      },
      {
        mode: targetResolution.mode,
        featureGatesActive,
        explicitRequested: targetResolution.explicitRequested,
        explicitMatched: targetResolution.explicitMatched,
        targetFileCount: featureNewUtFiles.length,
        legacyIncrementCases: legacyIncrements.reduce((s, f) => s + f.newCases.size, 0),
      },
    ));

    return results;
  },
};

export default checker;
