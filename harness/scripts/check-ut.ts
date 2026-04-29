// ============================================================================
// UT 阶段脚本 Harness — check-ut.ts
// ============================================================================
// 读取 framework/specs/phase-rules/ut-rules.yaml + doc/features/{feature}/
// 执行确定性的静态验证。
//
// 检查项（与 ut-rules.yaml 对应）：
//   Structure:     dag_schema_compliance, dag_node_type_valid, dag_acyclic,
//                  dag_source_file_exists, ut_file_naming, ut_framework_import,
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
import { compileTestFiles } from './utils/ts-compile';
import { runHvigorBuild, runHvigorTest, probeDevices, analyzeProjectDependencyIssue } from './utils/hvigor-runner';
import {
  diffChangedFiles,
  filterBusinessSourceChanges,
  readApprovedMutations,
  readTraceStartCommit,
  analyzeDiffStaleness,
} from './utils/git-diff';

const HARNESS_ROOT = path.resolve(__dirname, '..');

// UT 文件中禁止出现的 UI/导航/Toast 符号模式（v2.1 扩展：AppStorage / rawfile）
const UI_FORBIDDEN_PATTERNS: RegExp[] = [
  /@Component\b/,
  /@Entry\b/,
  /@Preview\b/,
  /@Consume\b/,
  /@Provide\b/,
  /\bNavPathStack\b/,
  /\bNavDestination\b/,
  /@kit\.ArkUI/,
  /@kit\.ArkGraphics/,
  /\$r\s*\(/,
  /\$rawfile\s*\(/,
  /\bgetUIContext\b/,
  /\bPromptAction\b/,
  /\bshowToast\b/,
  /@aspect\/CommUI/,
  /\bAppStorage\b/,
  /\bLocalStorage\b/,
];

function scanForbiddenImports(content: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*import\b/.test(line) && !/^\s*from\s+['"]/.test(line)) continue;
    for (const re of patterns) {
      if (re.test(line)) hits.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  // 对 $r( / showToast / getUIContext 这类函数/操作符，也扫整体文件（不仅 import）
  const bodyPatterns = patterns.filter(p =>
    /(\\\$r|showToast|getUIContext|NavPathStack|NavDestination)/.test(p.source),
  );
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*import\b/.test(line) || /^\s*from\s+['"]/.test(line)) continue;
    for (const re of bodyPatterns) {
      if (re.test(line)) hits.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  return [...new Set(hits)];
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
  mock_data?: Record<string, unknown>;
  intervention?: Record<string, unknown>;
  task?: Record<string, unknown>;
  navigation?: Record<string, unknown>;
  condition?: string;
  branches?:
    | { true_branch?: string[]; false_branch?: string[] }   // 旧 conditional_branch
    | string[];                                              // 新 DAG 顶层 branches 数组（当出现在 DagFile 中）
  linked_acceptance?: string[];
  linked_branch?: string;      // v2 新增：assertion 节点指向 use-cases.yaml > branch id
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
  'ui_subscription',     // v2.1：UI 订阅占位（UT 忽略；供 device-testing-todo 生成）
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

function findFilesRecursive(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(full, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// --------------------------------------------------------------------------
// DAG Loading
// --------------------------------------------------------------------------

function loadDagFiles(ctx: CheckContext): Array<{ path: string; dag: DagFile; raw: string }> {
  const results: Array<{ path: string; dag: DagFile; raw: string }> = [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) return results;

  for (const mod of contracts.modules) {
    const dagDir = path.join(ctx.projectRoot, mod.package_path, 'test', 'dag');
    const dagFiles = findFilesRecursive(dagDir, /\.dag\.yaml$/);
    for (const dagPath of dagFiles) {
      try {
        const raw = fs.readFileSync(dagPath, 'utf-8');
        const dag = YAML.parse(raw) as DagFile;
        const relPath = path.relative(ctx.projectRoot, dagPath).replace(/\\/g, '/');
        results.push({ path: relPath, dag, raw });
      } catch {
        /* skip malformed */
      }
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
  const p = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'design.md');
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, 'utf-8');
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

function loadUtFiles(ctx: CheckContext): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) return results;

  for (const mod of contracts.modules) {
    const testDir = path.join(ctx.projectRoot, mod.package_path, 'src', 'ohosTest', 'ets', 'test');
    const utFiles = findFilesRecursive(testDir, /\.test\.ets$/);
    for (const utPath of utFiles) {
      const relPath = path.relative(ctx.projectRoot, utPath).replace(/\\/g, '/');
      results.push({ path: relPath, content: fs.readFileSync(utPath, 'utf-8') });
    }
  }

  return results;
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
      details: '未找到 DAG 文件（*.dag.yaml）。',
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
      suggestion: 'user_intervention / ui_navigation 已废弃；建议用 ui_subscription（UI 订阅 state，UT 忽略）或移除后改由 device-testing-todo.md 承载。',
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

function checkUtFileNaming(
  ctx: CheckContext,
  utFiles: Array<{ path: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'ut_file_naming',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_file_naming'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '未找到 UT 文件。',
    }];
  }

  const badNames: string[] = [];
  for (const { path: utPath } of utFiles) {
    const basename = path.basename(utPath);
    if (!basename.endsWith('.test.ets')) {
      badNames.push(utPath);
    }
  }

  if (badNames.length === 0) {
    return [{
      id: 'ut_file_naming',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_file_naming'),
      severity: 'MAJOR',
      status: 'PASS',
      details: `全部 ${utFiles.length} 个 UT 文件命名规范（*.test.ets）。`,
    }];
  }

  return [{
    id: 'ut_file_naming',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_file_naming'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${badNames.length} 个 UT 文件命名不规范：\n${truncateList(badNames, 10)}`,
    affected_files: badNames,
    suggestion: 'UT 文件应以 .test.ets 结尾。',
  }];
}

/** 仅导出 testsuite、用例在其它 *.test.ets 的 Hypium 入口文件（如 List.test.ets） */
function isHypiumSuiteEntryShim(content: string): boolean {
  return /export\s+default\s+function\s+testsuite\s*\(/.test(content) &&
    !/\bdescribe\s*\(/.test(content);
}

function checkUtFrameworkImport(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'ut_framework_import',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_framework_import'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '未找到 UT 文件。',
    }];
  }

  const missingImport: string[] = [];
  const missingStructure: string[] = [];

  for (const { path: utPath, content } of utFiles) {
    if (isHypiumSuiteEntryShim(content)) continue;
    if (!content.includes('@ohos/hypium')) {
      missingImport.push(utPath);
    }
    if (!content.includes('describe(') || !content.includes('it(')) {
      missingStructure.push(utPath);
    }
  }

  const issues: string[] = [];
  if (missingImport.length > 0) {
    issues.push(`${missingImport.length} 个文件缺少 @ohos/hypium 导入：\n${truncateList(missingImport, 5)}`);
  }
  if (missingStructure.length > 0) {
    issues.push(`${missingStructure.length} 个文件缺少 describe/it 测试结构：\n${truncateList(missingStructure, 5)}`);
  }

  if (issues.length === 0) {
    return [{
      id: 'ut_framework_import',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_framework_import'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${utFiles.length} 个 UT 文件正确导入测试框架。`,
    }];
  }

  return [{
    id: 'ut_framework_import',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_framework_import'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: issues.join('\n'),
    affected_files: [...new Set([...missingImport, ...missingStructure])],
    suggestion: "UT 文件必须 import { describe, it, expect } from '@ohos/hypium' 并使用 describe/it 结构。",
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
 * 方案 A：对所有 *.test.ets 运行 tsc --noEmit 静态编译检查。
 * 通过 Skill 3/5 失败案例：弱模型生成的 UT 大量编译不过，但 harness 只做
 * 正则静态扫描 → 假 PASS。本规则是进入 ut_hvigor_build（方案 B）前的第一道
 * 护城河，仅检查测试文件本体，不跟随 import（noResolve: true）。
 */
function checkUtTscCompiles(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'ut_tsc_compiles',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_tsc_compiles'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '未找到 UT 文件。',
    }];
  }

  const absPaths = utFiles.map(f => path.join(ctx.projectRoot, f.path));
  const report = compileTestFiles(absPaths, ctx.projectRoot);

  if (report.diagnostics.length === 0) {
    return [{
      id: 'ut_tsc_compiles',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_tsc_compiles'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `${utFiles.length} 个 UT 文件 tsc --noEmit 通过（耗时 ${report.durationMs} ms）。`,
    }];
  }

  const groupedByFile = new Map<string, number>();
  for (const d of report.diagnostics) {
    groupedByFile.set(d.file, (groupedByFile.get(d.file) ?? 0) + 1);
  }

  const preview = report.diagnostics.slice(0, 30).map(d =>
    `${d.file}:${d.line}:${d.column}  ${d.code}  ${d.message}`,
  );
  const summaryByFile = Array.from(groupedByFile.entries())
    .map(([f, n]) => `${f}: ${n} 条`)
    .slice(0, 10);

  return [{
    id: 'ut_tsc_compiles',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_tsc_compiles'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `${groupedByFile.size} 个 UT 文件共 ${report.diagnostics.length} 条 TypeScript Error（耗时 ${report.durationMs} ms）。\n` +
      `按文件：\n${summaryByFile.join('\n')}\n\n` +
      `前 ${preview.length} 条诊断：\n${preview.join('\n')}`,
    affected_files: Array.from(groupedByFile.keys()),
    suggestion:
      'UT 文件必须先通过 tsc --noEmit。请根据上方 TS 错误码修正代码；常见原因：' +
      '(1) 符号未 import；(2) 调用签名与被测函数不符；(3) 类型字面量错误。' +
      '修完再跑 harness；该规则是 ut_hvigor_build 之前的第一道护城河。',
  }];
}

/**
 * 识别包含 UT 的模块：遍历 contracts.yaml.modules，
 * 过滤出 `<mod.package_path>/src/ohosTest/` 实际存在的模块。
 */
function findModulesWithUt(ctx: CheckContext): Array<{ name: string; package_path: string }> {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) return [];
  const out: Array<{ name: string; package_path: string }> = [];
  for (const mod of contracts.modules) {
    const ohosTestDir = path.join(ctx.projectRoot, mod.package_path, 'src', 'ohosTest');
    if (fs.existsSync(ohosTestDir)) {
      out.push({ name: mod.name, package_path: mod.package_path });
    }
  }
  return out;
}

/**
 * v2.2 方案 B：对 ohosTest 模块跑 hvigorw assembleHap。
 * 与 coding_hvigor_build 呼应，专门覆盖 UT 模块，兜底 tsc --noEmit 漏过的
 * 跨文件类型错误（UT 对被测 API 签名违约）。
 */
function checkUtHvigorBuild(ctx: CheckContext): CheckResult[] {
  const mods = findModulesWithUt(ctx);
  if (mods.length === 0) {
    return [{
      id: 'ut_hvigor_build',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到包含 src/ohosTest/ 目录的模块。UT 阶段必须有至少一个 ohosTest 模块。',
    }];
  }

  const perModule: Array<{ module: string; result: ReturnType<typeof runHvigorBuild> }> = [];
  for (const mod of mods) {
    const res = runHvigorBuild({
      projectRoot: ctx.projectRoot,
      harnessRoot: HARNESS_ROOT,
      feature: ctx.feature,
      phase: 'ut',
      moduleName: mod.name,
      target: 'ohosTest',
      skipEnvVar: 'HARNESS_SKIP_HVIGOR',
    });
    perModule.push({ module: mod.name, result: res });
    if (res.toolMissing || res.skippedByEnv || (res.executed && res.exitCode !== 0)) break;
  }

  const bad = perModule.filter(x =>
    x.result.toolMissing ||
    x.result.skippedByEnv ||
    (x.result.executed && (x.result.exitCode !== 0 || x.result.errors.length > 0))
  );

  if (bad.length === 0) {
    return [{
      id: 'ut_hvigor_build',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${perModule.length} 个 ohosTest 模块 hvigor 编译通过（累计耗时 ${perModule.reduce((s, x) => s + x.result.durationMs, 0)} ms）。`,
    }];
  }

  const first = bad[0].result;
  const lines: string[] = [`ohosTest 模块 "${bad[0].module}" 编译失败：`];
  const failureClass = classifyUtHvigorBuildFailure(first, bad[0].module, ctx.projectRoot);
  if (first.toolMissing) {
    lines.push('原因：未找到 hvigor 可执行文件（v2.3 起需通过 framework.config.json 声明 DevEco 路径）。');
    first.logExcerpt.split(/\r?\n/).forEach(l => lines.push(l));
    lines.push('本规则不允许 SKIP —— 真实编译是出口条件。');
  } else if (first.skippedByEnv) {
    lines.push('原因：HARNESS_SKIP_HVIGOR=1 已设置，显式跳过真实编译不被允许作为出口。');
  } else {
    lines.push(`exit_code=${first.exitCode}, durationMs=${first.durationMs}`);
    lines.push(`失败归因：${failureClass.kind}`);
    lines.push(`归因说明：${failureClass.explanation}`);
    lines.push(`日志落盘：${first.logPath ?? '(未落盘)'}`);
    if (first.errors.length > 0) {
      lines.push(`解析出 ${first.errors.length} 条 error（前 10 条）：`);
      first.errors.slice(0, 10).forEach(e =>
        lines.push(`  - ${e.file ?? ''}${e.line ? ':' + e.line : ''}  ${e.code ?? ''}  ${e.message}`)
      );
    }
    lines.push('');
    lines.push('日志尾部（最多 8 KB）：');
    lines.push(first.logExcerpt);
  }

  return [{
    id: 'ut_hvigor_build',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: lines.join('\n'),
    affected_files: [bad[0].module + '@ohosTest'],
    failure_kind: failureClass.kind,
    blocking_class: failureClass.kind === 'external_project_build_blocker'
      ? 'external'
      : failureClass.kind === 'project_dependency_missing'
        ? 'project_dependency_missing'
        : 'ut_hvigor_build',
    suggestion:
      failureClass.suggestion,
  }];
}

type UtHvigorFailureKind =
  | 'toolchain'
  | 'env_skip'
  | 'ut_code'
  | 'feature_code'
  | 'project_dependency_missing'
  | 'external_project_build_blocker'
  | 'unknown';

function classifyUtHvigorBuildFailure(
  res: ReturnType<typeof runHvigorBuild>,
  moduleName: string,
  projectRoot: string,
): { kind: UtHvigorFailureKind; explanation: string; suggestion: string } {
  if (res.toolMissing) {
    return {
      kind: 'toolchain',
      explanation: 'hvigor / DevEco 工具链不可用。',
      suggestion: '按 framework.config.json > toolchain.devEcoStudio.installPath 配置 DevEco Studio 路径后重跑。',
    };
  }
  if (res.skippedByEnv) {
    return {
      kind: 'env_skip',
      explanation: 'HARNESS_SKIP_HVIGOR 显式跳过真实编译。',
      suggestion: '取消 HARNESS_SKIP_HVIGOR 后重跑；真实编译是 UT 阶段出口条件。',
    };
  }

  const log = `${res.logExcerpt}\n${res.errors.map(e => `${e.file ?? ''} ${e.message}`).join('\n')}`;
  const depIssue = analyzeProjectDependencyIssue(projectRoot, res);
  const hasDependencyResolutionFailure =
    /Failed to resolve OhmUrl|Could not resolve|Cannot resolve|Cannot find module|Unable to resolve|Module not found/i.test(log);
  const touchesOhosTest = /\/src\/ohosTest\/|\\src\\ohosTest\\/i.test(log);
  const touchesCurrentModuleMain = new RegExp(`${escapeRegExp(moduleName)}[/\\\\]src[/\\\\]main`, 'i').test(log);

  if (depIssue.found && hasDependencyResolutionFailure && !touchesOhosTest) {
    return {
      kind: 'project_dependency_missing',
      explanation:
        'hvigor 日志显示工程依赖解析失败，当前失败更可能来自 ohpm/oh_modules/依赖声明或内网 registry，而不是 UT 代码本身。\n' +
        formatDependencyIssue(depIssue),
      suggestion:
        '不要把该问题交给用户手工猜。先向用户展示方案：A) 确认后在工程根执行 ohpm install 并重跑；' +
        'B) 仅读取 oh-package.json5 输出缺失依赖声明；C) registry/权限不确定时先确认内网源。' +
        (!depIssue.harnessNodeModulesReady ? ' framework/harness/node_modules 缺失时可直接在 framework/harness 执行 npm install。' : ''),
    };
  }

  if (hasDependencyResolutionFailure && !touchesOhosTest && !touchesCurrentModuleMain) {
    return {
      kind: 'external_project_build_blocker',
      explanation: '依赖解析失败发生在非 ohosTest / 非当前模块 src/main 的项目级或传递依赖链路中；当前 UT 尚未真实运行，且不应通过修改 UT 掩盖该问题。',
      suggestion: '先修复项目级依赖/构建问题，或在确认不是本轮 UT 引入后记录为外部阻塞并 clear-state；不要声称 UT 已通过。',
    };
  }

  if (touchesOhosTest) {
    return {
      kind: 'ut_code',
      explanation: '编译错误指向 src/ohosTest，优先按 UT import、类型签名或 Spy/Stub 实现问题处理。',
      suggestion: '读取完整日志定位 ohosTest 文件/行，修复 UT 代码后重跑 harness。',
    };
  }

  if (touchesCurrentModuleMain) {
    return {
      kind: 'feature_code',
      explanation: '编译错误指向当前模块 src/main；若确需改业务源码，必须先走 Skill 5 源码修改授权流程。',
      suggestion: '优先确认是否可通过 UT/Spy 调整规避；确需改 src/main 时先向用户申请并登记 gap-notes。',
    };
  }

  return {
    kind: 'unknown',
    explanation: '无法仅凭日志判断错误归属。',
    suggestion: '读取完整日志（details 中 `日志落盘` 路径），定位文件/行；不要仅凭 ut_tsc_compiles PASS 宣称 UT 通过。',
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDependencyIssue(issue: ReturnType<typeof analyzeProjectDependencyIssue>): string {
  const lines = [
    `依赖线索：${issue.dependencies.length > 0 ? issue.dependencies.join(', ') : '(未解析出具体包名)'}`,
    `harness node_modules：${issue.harnessNodeModulesReady ? '存在' : '缺失'}`,
    `工程 oh_modules：${issue.ohModulesExists ? '存在' : '缺失'}`,
    `扫描到 oh-package.json5：${issue.ohPackageFiles.length} 个`,
  ];
  if (issue.missingDeclarations.length > 0) {
    lines.push(`未在 oh-package.json5 中声明的依赖：${issue.missingDeclarations.join(', ')}`);
  }
  if (issue.installHints.length > 0) {
    lines.push('建议分支：');
    issue.installHints.forEach(h => lines.push(`  - ${h}`));
  }
  return lines.join('\n');
}

/**
 * v2.2 方案 C：ohosTest 装机运行 UT（hypium）。
 * 关键立场：无设备 → FAIL（不是 SKIP）。内网 harness 把"无设备"标绿是已知
 * 假 PASS 根因；本规则显式拒绝软通过。
 *
 * 执行序列：
 *   (1) hdc list targets 探测；
 *   (2) HARNESS_SKIP_HVIGOR_TEST=1 → FAIL；
 *   (3) 无设备 → FAIL 并提示启动模拟器 / 接入真机；
 *   (4) 有设备 → hvigorw test，解析 hypium 输出；
 *   (5) failed > 0 或 total == 0 → FAIL 并列出失败用例堆栈。
 */
function checkUtHvigorTest(ctx: CheckContext): CheckResult[] {
  // 先检查本规则是否被 ut_hvigor_build 前置失败所短路
  // 由 main checker 顺序调度决定，这里不主动短路，而是在 details 中提示依赖。

  if (process.env.HARNESS_SKIP_HVIGOR_TEST) {
    return [{
      id: 'ut_hvigor_test',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `HARNESS_SKIP_HVIGOR_TEST=${process.env.HARNESS_SKIP_HVIGOR_TEST} 已设置。` +
        `显式跳过 UT 实际装机运行**不被允许**作为出口条件。请去掉该环境变量并准备好真机/模拟器后重跑。`,
      suggestion: '取消 HARNESS_SKIP_HVIGOR_TEST 环境变量，启动模拟器或接入真机后重跑。',
    }];
  }

  const mods = findModulesWithUt(ctx);
  if (mods.length === 0) {
    return [{
      id: 'ut_hvigor_test',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '未找到包含 src/ohosTest/ 目录的模块。UT 阶段必须有至少一个 ohosTest 模块。',
    }];
  }

  const devProbe = probeDevices();
  if (!devProbe.available) {
    const head = devProbe.hdcPresent
      ? `hdc list targets 返回空（原始输出：${devProbe.raw || '(空)'}）`
      : `未找到 hdc 工具：${devProbe.raw || '(无详细)'}`;
    return [{
      id: 'ut_hvigor_test',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `${head}\n\n` +
        `Skill 5 必须在真机 / 模拟器上实际运行 UT。当前未检测到可用目标，因此**不能**作为出口条件放行。\n` +
        `修复指引：\n` +
        `  (1) 在 DevEco Studio 或 Remote Emulator 启动一台 HarmonyOS 设备；\n` +
        `  (2) 运行 \`hdc list targets\` 确认输出非空；\n` +
        `  (3) 重跑 Skill 5 harness。\n` +
        `  (4) 本规则不允许 SKIP —— 这是内网历史假 PASS 的根因。`,
      suggestion: '接入真机 / 启动模拟器后重跑；不允许以"本地无设备"为由软通过。',
    }];
  }

  const perModule: Array<{ module: string; result: ReturnType<typeof runHvigorTest> }> = [];
  for (const mod of mods) {
    const res = runHvigorTest({
      projectRoot: ctx.projectRoot,
      harnessRoot: HARNESS_ROOT,
      feature: ctx.feature,
      phase: 'ut',
      moduleName: mod.name,
      // v2.3 P2：runHvigorTest 内部走 genOnDeviceTestHap → hdc install → aa test
      // 链路，需要模块 srcPath 来定位 .hap 输出目录、读 ohosTest module.json5。
      moduleSrcPath: mod.package_path,
    });
    perModule.push({ module: mod.name, result: res });
    if (res.toolMissing || (res.executed && (res.exitCode !== 0 || (res.testResult && res.testResult.failed > 0)))) {
      break;
    }
  }

  const bad = perModule.filter(x => {
    const r = x.result;
    if (r.toolMissing) return true;
    if (!r.executed) return true;
    if (r.exitCode !== 0) return true;
    const t = r.testResult;
    if (!t) return true;
    if (t.total <= 0) return true;
    if (t.failed > 0) return true;
    return false;
  });

  if (bad.length === 0) {
    const totals = perModule.reduce(
      (acc, x) => ({
        total: acc.total + (x.result.testResult?.total ?? 0),
        passed: acc.passed + (x.result.testResult?.passed ?? 0),
      }),
      { total: 0, passed: 0 },
    );
    return [{
      id: 'ut_hvigor_test',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
      severity: 'BLOCKER',
      status: 'PASS',
      details:
        `全部 ${perModule.length} 个 ohosTest 模块装机执行通过：` +
        `total=${totals.total}, passed=${totals.passed}, failed=0；` +
        `目标设备：${devProbe.targets.join(' / ')}`,
    }];
  }

  const first = bad[0].result;
  const lines: string[] = [`ohosTest 模块 "${bad[0].module}" 装机执行失败：`];
  // v2.3 P2：runHvigorTest 在 errors[0].message 里会标注"失败阶段：metadata|hap_not_found|install|run|no_pass"，
  // 让用户一眼定位。这里把它前置展示。
  const stageHint = first.errors?.find(e => /失败阶段：/.test(e.message))?.message;
  if (stageHint) {
    lines.push(stageHint + '（详见日志）');
  }
  if (first.toolMissing) {
    lines.push('原因：未找到 hvigor / hdc 可执行文件（v2.3 起需通过 framework.config.json 声明 DevEco 路径，hdc 由 DevEco SDK toolchains 提供）。');
    first.logExcerpt.split(/\r?\n/).forEach(l => lines.push(l));
  } else if (!first.executed) {
    lines.push(`原因：hvigor / hdc 未执行，日志：${first.logExcerpt}`);
  } else if (first.exitCode !== 0 && !first.testResult) {
    lines.push(`链路异常退出 exit_code=${first.exitCode}。`);
    lines.push('日志尾部：');
    lines.push(first.logExcerpt);
  } else if (first.testResult) {
    const t = first.testResult;
    lines.push(`hypium 结果：total=${t.total}, passed=${t.passed}, failed=${t.failed}, skipped=${t.skipped}`);
    if (t.total === 0) {
      lines.push('警告：total=0 表示 hvigor test 没有跑到任何用例。请检查 List.test.ets 是否正确注册了所有 *.test.ets 入口。');
    }
    if (t.failures.length > 0) {
      lines.push(`失败用例（前 15 条）：`);
      t.failures.slice(0, 15).forEach(f =>
        lines.push(`  - [${f.suite}] ${f.test}  →  ${f.message}`)
      );
    }
    lines.push('');
    lines.push(`日志落盘：${first.logPath ?? '(未落盘)'}`);
  }

  return [{
    id: 'ut_hvigor_test',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: lines.join('\n'),
    affected_files: [bad[0].module + '@ohosTest'],
    suggestion:
      '按失败用例堆栈定位问题：可能是 UT 逻辑错误、被测业务实现与 UT 预期不一致、或 Spy/Stub 预设值不对。' +
      '修改 UT 后重跑；若需要动业务源码，先按 SKILL.md > 约束 #12 的 HARD STOP 流程征得用户同意。',
  }];
}

/**
 * v2.2 Skill 5 红线：检测未授权的业务源码变更。
 * 流程：
 *   (1) 读 trace.json.start_commit（若存在）；否则回退 HEAD~1；
 *   (2) git diff + 未提交/untracked，按受保护前缀筛；
 *   (3) 与 reports/<feature>/ut/**\/gap-notes.md 的 approved_src_mutations[] 对账；
 *   (4) 未登记 → FAIL BLOCKER。
 *
 * 受保护前缀 / 排除路径与 SKILL.md > 约束 #12 HARD STOP 一致。
 */
const UT_SRC_PROTECTED_PREFIXES = ['02-Feature/', '01-Business/', '00-Common/'];

function filterProtected(changes: string[]): string[] {
  return filterBusinessSourceChanges(changes, UT_SRC_PROTECTED_PREFIXES);
}

/**
 * 计算 reports/<feature>/ 的扫描根。默认指向真实 framework/harness/reports/<feature>/；
 * 若设置环境变量 HARNESS_REPORTS_ROOT_OVERRIDE（通常只有 framework tests/ 测试套件
 * 会设），则指向 <override>/<feature>/——让 fixture 可以提供隔离的 gap-notes.md /
 * trace.json 而不污染真实仓库。
 */
function computeReportsFeatureRoot(feature: string): string {
  const override = process.env.HARNESS_REPORTS_ROOT_OVERRIDE;
  if (override) return path.join(override, feature);
  return path.join(HARNESS_ROOT, 'reports', feature);
}

function findGapNotesFiles(feature: string): string[] {
  const reportsRoot = computeReportsFeatureRoot(feature);
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

function findTraceJsonFiles(feature: string): string[] {
  const reportsRoot = computeReportsFeatureRoot(feature);
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

function checkUtNoSrcMutation(ctx: CheckContext): CheckResult[] {
  // 解析 baseRef：聚合所有找到的 trace.json（按修改时间选最新，降低多次跑带来的歧义）
  const envBaseRef = (process.env.HARNESS_DIFF_BASE_REF ?? '').trim();
  const traceFiles = findTraceJsonFiles(ctx.feature).sort((a, b) => {
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

  const diff = diffChangedFiles({
    projectRoot: ctx.projectRoot,
    baseRef,
    pathspecs: UT_SRC_PROTECTED_PREFIXES,
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

  const businessChanges = filterProtected(diff.changedFiles);
  const committedBusinessChanges = filterProtected(diff.committedFiles);
  const workingBusinessChanges = filterProtected(diff.workingTreeFiles);
  const stagedBusinessChanges = filterProtected(diff.stagedFiles);
  const untrackedBusinessChanges = filterProtected(diff.untrackedFiles);
  const staleness = analyzeDiffStaleness(diff);
  const baseHint = envBaseRef
    ? `HARNESS_DIFF_BASE_REF=${envBaseRef}`
    : 'trace.json.start_commit / HEAD~1 fallback';

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
        `未检测到 ${UT_SRC_PROTECTED_PREFIXES.join(' / ')} 下的业务源码变更。`,
    }];
  }

  // 汇总所有 gap-notes.md 的授权清单
  const gapFiles = findGapNotesFiles(ctx.feature);
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
    ? '\n\n诊断：stale_diff_base。committed 历史变更远多于当前工作区变更，baseRef 可能过旧。请自动用 `HARNESS_DIFF_BASE_REF=working` 重跑一次；不要批量授权历史变更。'
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
        ? '先自动重跑：HARNESS_DIFF_BASE_REF=working npx ts-node harness-runner.ts --phase ut --feature <feature>。若重跑后仍有 working 侧业务源码改动，再进入 HARD STOP 授权流程。'
        : '按 Skill 5 SKILL.md > 约束 #12 HARD STOP 流程：先向用户征得同意，再把变更登记到 ' +
          'framework/harness/reports/<feature>/<timestamp>/<model>-ut/gap-notes.md > approved_src_mutations[]（含 file / reason / approved_at 等字段）。' +
          '禁止以"便利性"借口直接修改业务源码。',
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

function checkTestRegistration(
  ctx: CheckContext,
  utFiles: Array<{ path: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'test_registration',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: '未找到 UT 文件。',
    }];
  }

  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [{
      id: 'test_registration',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'contracts.yaml 无 modules 列表。',
    }];
  }

  const unregistered: string[] = [];

  for (const mod of contracts.modules) {
    const listTestPath = path.join(
      ctx.projectRoot, mod.package_path, 'src', 'ohosTest', 'ets', 'test', 'List.test.ets',
    );

    if (!fs.existsSync(listTestPath)) {
      const modUtFiles = utFiles.filter(f => f.path.includes(mod.package_path));
      if (modUtFiles.length > 0) {
        unregistered.push(`${mod.name}: List.test.ets 不存在（${modUtFiles.length} 个 UT 文件无法注册）`);
      }
      continue;
    }

    const listContent = fs.readFileSync(listTestPath, 'utf-8');
    const modUtFiles = utFiles.filter(f =>
      f.path.includes(mod.package_path) && !f.path.endsWith('List.test.ets'),
    );

    for (const utFile of modUtFiles) {
      const basename = path.basename(utFile.path, '.test.ets');
      if (!listContent.includes(basename)) {
        unregistered.push(`${mod.name}: ${path.basename(utFile.path)} 未在 List.test.ets 中注册`);
      }
    }
  }

  if (unregistered.length === 0) {
    return [{
      id: 'test_registration',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '所有 UT 文件已在 List.test.ets 中注册。',
    }];
  }

  return [{
    id: 'test_registration',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${unregistered.length} 个注册问题：\n${truncateList(unregistered, 10)}`,
    suggestion: '所有 UT 文件的导出函数必须在 List.test.ets 中注册。',
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
    suggestion: '若 feature 确实多 UI 共享状态 / 多步云调用 / 含回滚分支，按 framework/skills/5-business-ut/templates/use-cases-schema.md 产出；否则可忽略本告警。',
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
    suggestion: '请参照 framework/skills/5-business-ut/templates/use-cases-schema.md 补齐 Schema。',
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
    if (isHypiumSuiteEntryShim(content)) continue;
    const hits = scanForbiddenImports(content, UI_FORBIDDEN_PATTERNS);
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
    suggestion: 'UT 允许 import：@ohos/hypium、被测模块的 data / domain / 业务编排类及其数据模型、同目录 spy/；禁止 @Component / struct / NavPathStack / showToast / $r / $rawfile / AppStorage / LocalStorage / @kit.ArkUI / @kit.ArkGraphics 等 UI 符号。请将 UI 侧验证下沉到 Skill 6 真机测试。',
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
    if (isHypiumSuiteEntryShim(content)) continue;
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
    if (isHypiumSuiteEntryShim(content)) continue;
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
  if (deviceOnly > 0) details.push(`（${deviceOnly} 条 ut_layer=device 的 AC 已从 UT 分母中排除，交 Skill 6 负责）`);

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

function collectItNames(utFiles: Array<{ path: string; content: string }>): string[] {
  const names: string[] = [];
  for (const { content } of utFiles) {
    if (isHypiumSuiteEntryShim(content)) continue;
    const blocks = extractItBlocks(content);
    for (const b of blocks) names.push(b.name);
  }
  return names;
}

function collectItBlocks(utFiles: Array<{ path: string; content: string }>): Array<{ path: string; name: string; body: string }> {
  const blocks: Array<{ path: string; name: string; body: string }> = [];
  for (const f of utFiles) {
    if (isHypiumSuiteEntryShim(f.content)) continue;
    for (const b of extractItBlocks(f.content)) {
      blocks.push({ path: f.path, ...b });
    }
  }
  return blocks;
}

function checkBranchCoverageFull(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
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

  const blocks = collectItBlocks(utFiles);
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
    suggestion: '请为每个 branch 补充一条 it()，用例名建议格式 [BRANCH-<id>][AC-<id>] ...；参考 framework/skills/5-business-ut/examples/card-opening/card_opening.test.ets。',
  }];
}

function checkUtCasePerUnitAc(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
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
  if (utFiles.length === 0) {
    return [{
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'ut_case_per_unit_ac'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const itNames = collectItNames(utFiles);
  const blocks = collectItBlocks(utFiles);

  const isUnit = (layer?: string) => layer === 'unit' || layer === 'both' || layer === undefined;

  const targetAcs = [
    ...(acceptance.criteria ?? []).filter(c =>
      (c.priority === 'P0' || c.priority === 'P1') && isUnit(c.ut_layer),
    ),
    ...(acceptance.boundaries ?? []).filter(b =>
      (b.priority === 'P0' || b.priority === 'P1') && isUnit(b.ut_layer),
    ),
  ];

  const missing: string[] = [];
  for (const ac of targetAcs) {
    const acTagRe = new RegExp(`\\[AC-${ac.id.replace(/^AC-/, '').replace(/^BD-/, '')}\\]`);
    const directTagRe = new RegExp(`\\[${ac.id}\\]`);
    const foundByTag = itNames.some(n => directTagRe.test(n) || acTagRe.test(n));

    const branchId = (ac as { linked_branch?: string }).linked_branch;
    const foundByBranch = !!branchId && blocks.some(b =>
      new RegExp(`\\[BRANCH-${branchId}\\]`).test(b.name) || b.body.includes(branchId),
    );

    if (!foundByTag && !foundByBranch) {
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
    details: `${missing.length} 条 AC/BD 无对应 UT：\n${truncateList(missing, 15)}`,
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
      details: '无 ut_layer∈{unit,both} 的 boundary，全部交 Skill 6。',
    }];
  }

  const itNames = collectItNames(utFiles);
  const blocks = collectItBlocks(utFiles);

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
    suggestion: '请为上述 boundary 补一条 it()（建议 [BD-xx] 标签）或将其纳入某个 use-cases.yaml branch 的 linked_acceptance。',
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

function findFirst(results: CheckResult[], id: string): CheckResult | undefined {
  return results.find(r => r.id === id);
}

function statusLabel(r: CheckResult | undefined): string {
  if (!r) return '未产生结果';
  return `${r.status}${r.severity === 'BLOCKER' ? ' [BLOCKER]' : ` [${r.severity}]`}`;
}

function buildUtRunStatusResult(results: CheckResult[]): CheckResult {
  const build = findFirst(results, 'ut_hvigor_build');
  const test = findFirst(results, 'ut_hvigor_test');
  const mutation = findFirst(results, 'ut_no_src_mutation');
  const tsc = findFirst(results, 'ut_tsc_compiles');
  const shortCircuited = !!test?.details?.includes('ut_hvigor_build 已 FAIL');
  const blockerFails = results.filter(r => r.severity === 'BLOCKER' && r.status === 'FAIL');
  const canClaimDone = blockerFails.length === 0 && test?.status === 'PASS';

  const staticBlockerFails = blockerFails.filter(r =>
    r.id !== 'ut_hvigor_build' &&
    r.id !== 'ut_hvigor_test' &&
    r.id !== 'ut_no_src_mutation'
  );

  const lines = [
    'UT 阶段状态面板：',
    `- 静态/结构规则：${staticBlockerFails.length === 0 ? 'PASS' : `FAIL（${staticBlockerFails.map(r => r.id).join(', ')}）`}`,
    `- tsc 静态编译：${statusLabel(tsc)}`,
    `- ohosTest hvigor 编译：${statusLabel(build)}`,
    `- 真机/模拟器执行：${shortCircuited ? '未执行（ut_hvigor_build 失败短路）' : statusLabel(test)}`,
    `- 源码改动检查：${statusLabel(mutation)}`,
    `- 当前是否可以宣称 UT 完成：${canClaimDone ? '是' : '否'}`,
  ];

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
    const dags = loadDagFiles(ctx);
    const utFiles = loadUtFiles(ctx);

    const results: CheckResult[] = [];

    // --- Structure checks ---
    // v2 A: use-cases.yaml 自身
    results.push(...safeRun(() => checkUseCaseSpecRecommended(ctx), 'usecase_spec_recommended'));
    results.push(...safeRun(() => checkUseCaseSpecSchema(ctx), 'usecase_spec_schema'));
    results.push(...safeRun(() => checkUseCaseUiBindingsNonempty(ctx), 'usecase_ui_bindings_nonempty'));
    results.push(...safeRun(() => checkBoundaryMatchesContracts(ctx), 'boundary_matches_contracts'));
    results.push(...safeRun(() => checkNamedBusinessHandler(ctx), 'named_business_handler'));

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

    // v1 保留 + v2 修订：UT 代码
    results.push(...safeRun(() => checkUtFileNaming(ctx, utFiles), 'ut_file_naming'));
    results.push(...safeRun(() => checkUtFrameworkImport(ctx, utFiles), 'ut_framework_import'));
    results.push(...safeRun(() => checkUtAssertionExists(ctx, utFiles), 'ut_assertion_exists'));
    // v2.2 方案 A：静态 tsc --noEmit 检查
    results.push(...safeRun(() => checkUtTscCompiles(ctx, utFiles), 'ut_tsc_compiles'));
    // v2.2 方案 B：hvigor 真实编译（ohosTest 模块）
    const hvigorBuildResults = safeRun(() => checkUtHvigorBuild(ctx), 'ut_hvigor_build');
    results.push(...hvigorBuildResults);
    // v2.2 方案 C：hvigor 装机执行 UT（hypium），无设备/失败均 BLOCKER FAIL；
    // 若 ut_hvigor_build 已 FAIL，test 短路为 FAIL 避免叠加无意义日志。
    const buildFailed = hvigorBuildResults.some(r => r.id === 'ut_hvigor_build' && r.status === 'FAIL');
    if (buildFailed) {
      results.push({
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: 'ut_hvigor_build 已 FAIL，test 阶段自动短路为 FAIL（避免重复跑和日志噪声）。请先修复编译。',
      });
    } else {
      results.push(...safeRun(() => checkUtHvigorTest(ctx), 'ut_hvigor_test'));
    }
    // v2.2 红线 5.2：Skill 5 不得擅改业务源码
    results.push(...safeRun(() => checkUtNoSrcMutation(ctx), 'ut_no_src_mutation'));
    results.push(...safeRun(() => checkMockStubForAsync(ctx, dags, utFiles), 'mock_stub_for_async'));
    results.push(...safeRun(() => checkTestRegistration(ctx, utFiles), 'test_registration'));
    // v2 C: UT 代码
    results.push(...safeRun(() => checkUtImportWhitelist(ctx, utFiles), 'ut_import_whitelist'));
    results.push(...safeRun(() => checkBoundariesAllStubbed(ctx, utFiles), 'boundaries_all_stubbed'));
    results.push(...safeRun(() => checkItNameHasAcOrBranchTag(ctx, utFiles), 'it_name_has_ac_or_branch_tag'));
    results.push(...safeRun(() => checkItDrivesFlow(ctx, utFiles), 'it_drives_flow'));

    // --- Traceability checks ---
    results.push(...safeRun(() => checkDagToAcceptance(ctx, dags), 'dag_to_acceptance'));
    results.push(...safeRun(() => checkAcceptanceCoverage(ctx, dags), 'acceptance_coverage'));
    results.push(...safeRun(() => checkDagToSource(ctx, dags), 'dag_to_source'));
    // v2 Traceability
    results.push(...safeRun(() => checkBranchCoverageFull(ctx, utFiles), 'branch_coverage_full'));
    results.push(...safeRun(() => checkUtCasePerUnitAc(ctx, utFiles), 'ut_case_per_unit_ac'));
    results.push(...safeRun(() => checkBoundaryCoverage(ctx, utFiles, dags), 'boundary_coverage'));

    results.push(buildUtRunStatusResult(results));

    return results;
  },
};

export default checker;
