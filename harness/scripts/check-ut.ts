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

// v2 新增：UseCase 源文件和 UT 文件中禁止出现的 UI/导航/Toast 符号模式
const UI_FORBIDDEN_PATTERNS: RegExp[] = [
  /@Component\b/,
  /@Entry\b/,
  /@Preview\b/,
  /@Consume\b/,
  /@Provide\b/,
  /\bNavPathStack\b/,
  /\bNavDestination\b/,
  /@kit\.ArkUI/,
  /\$r\s*\(/,
  /\bgetUIContext\b/,
  /\bPromptAction\b/,
  /\bshowToast\b/,
  /@aspect\/CommUI/,
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
  // v1 兼容
  'code_execution',
  'async_call',
  'user_intervention',
  'background_task',
  'ui_navigation',
  'assertion',
  'conditional_branch',
  // v2 新增
  'user_trigger',
  'port_call_cloud',
  'port_call_local',
  'state_transition',
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

  for (const { path: dagPath, dag } of dags) {
    const missing: string[] = [];
    if (!dag.flow_id) missing.push('flow_id');
    if (!dag.flow_name) missing.push('flow_name');
    if (!dag.entry_point) missing.push('entry_point');
    if (!dag.nodes || !Array.isArray(dag.nodes) || dag.nodes.length === 0) missing.push('nodes[]');

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
    suggestion: 'DAG 文件必须包含 flow_id、flow_name、entry_point、nodes[] 必填字段，每个节点必须包含 id、type、description。',
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

  const invalidNodes: string[] = [];
  const affectedFiles: string[] = [];

  for (const { path: dagPath, dag } of dags) {
    for (const node of dag.nodes ?? []) {
      if (!VALID_NODE_TYPES.includes(node.type)) {
        invalidNodes.push(`${dagPath} > ${node.id}: type="${node.type}"`);
        affectedFiles.push(dagPath);
      }
    }
  }

  if (invalidNodes.length === 0) {
    return [{
      id: 'dag_node_type_valid',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'dag_node_type_valid'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 DAG 节点类型合法。',
    }];
  }

  return [{
    id: 'dag_node_type_valid',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'dag_node_type_valid'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${invalidNodes.length} 个节点类型非法：\n${truncateList(invalidNodes, 10)}`,
    affected_files: [...new Set(affectedFiles)],
    suggestion: `合法类型: ${VALID_NODE_TYPES.join(', ')}`,
  }];
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

function checkUseCaseSpecExists(ctx: CheckContext): CheckResult[] {
  const specExists = !!loadUseCaseSpec(ctx);
  const needed = acceptanceHasUnitLayerRequirement(ctx) || designMentionsUseCaseChapter(ctx);

  if (!needed) {
    return [{
      id: 'usecase_spec_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_exists'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '未检测到"需要 UseCase"信号（acceptance.yaml 无 unit/both AC，且 design.md 未出现"业务流程 UseCase 清单"章节）。本 feature 暂免 use-cases.yaml。',
    }];
  }

  if (specExists) {
    return [{
      id: 'usecase_spec_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_exists'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `doc/features/${ctx.feature}/use-cases.yaml 已存在。`,
    }];
  }

  return [{
    id: 'usecase_spec_exists',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_spec_exists'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `检测到 UT unit/both 层需求或 design.md 已声明"业务流程 UseCase 清单"，但 doc/features/${ctx.feature}/use-cases.yaml 不存在。`,
    suggestion: '请按 framework/skills/5-business-ut/templates/use-cases-schema.md 产出 use-cases.yaml；若当前 feature 无多步骤业务流程，请在 acceptance.yaml 中将相关 AC ut_layer 改为 device 并移除 design.md 的 UseCase 清单章节。',
  }];
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
    const required: Array<keyof UseCaseDef> = ['id', 'class', 'file', 'triggers', 'ports', 'state_model', 'branches'];
    for (const key of required) {
      if (uc[key] === undefined || uc[key] === null) {
        issues.push(`${tag}: 缺少字段 ${String(key)}`);
      }
    }
    for (const tr of uc.triggers ?? []) {
      if (!tr.event) issues.push(`${tag} > trigger: 缺少 event`);
      if (!Array.isArray(tr.params)) issues.push(`${tag} > trigger[${tr.event ?? '?'}]: 缺少 params[]`);
    }
    for (const port of uc.ports ?? []) {
      if (!port.name) issues.push(`${tag} > port: 缺少 name`);
      if (!port.type) issues.push(`${tag} > port[${port.name ?? '?'}]: 缺少 type`);
      if (!port.ownership) issues.push(`${tag} > port[${port.name ?? '?'}]: 缺少 ownership`);
      else if (port.ownership !== 'cloud' && port.ownership !== 'local') {
        issues.push(`${tag} > port[${port.name}]: ownership 必须是 cloud 或 local（当前：${port.ownership}）`);
      }
      if (!Array.isArray(port.methods) || port.methods.length === 0) {
        issues.push(`${tag} > port[${port.name ?? '?'}]: methods[] 必填且非空`);
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

function checkUseCasePortMatchesContracts(ctx: CheckContext): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'usecase_port_matches_contracts',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_port_matches_contracts'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  const interfaces = ctx.featureSpec.contracts?.interfaces ?? [];
  if (interfaces.length === 0) {
    return [{
      id: 'usecase_port_matches_contracts',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_port_matches_contracts'),
      severity: 'MAJOR',
      status: 'SKIP',
      details: 'contracts.yaml 未声明 interfaces，跳过。',
    }];
  }

  const interfaceClasses = new Set(interfaces.map(i => i.class));
  const mismatches: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    for (const port of uc.ports ?? []) {
      if (!interfaceClasses.has(port.type)) {
        mismatches.push(`${uc.id} > port[${port.name}].type="${port.type}" 不在 contracts.yaml > interfaces[].class 中`);
      }
    }
  }

  if (mismatches.length === 0) {
    return [{
      id: 'usecase_port_matches_contracts',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_port_matches_contracts'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '所有 ports.type 均能在 contracts.yaml 中找到对应接口。',
    }];
  }

  return [{
    id: 'usecase_port_matches_contracts',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_port_matches_contracts'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${mismatches.length} 处 port 接口不匹配：\n${truncateList(mismatches, 10)}`,
    suggestion: 'UseCase 注入的 port.type 应与 design 阶段声明的 interfaces[].class 同名；若 interface 名称变更，请同步更新 use-cases.yaml。',
  }];
}

function checkUseCaseClassExists(ctx: CheckContext): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'usecase_class_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_class_exists'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }

  const missing: string[] = [];
  const affected: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    if (!uc.file) continue;
    const full = path.join(ctx.projectRoot, uc.file);
    if (!fs.existsSync(full)) {
      missing.push(`${uc.id}: 文件 ${uc.file} 不存在`);
      continue;
    }
    const content = fs.readFileSync(full, 'utf-8');
    const classRe = new RegExp(`\\bclass\\s+${uc.class}\\b`);
    if (!classRe.test(content)) {
      missing.push(`${uc.id}: ${uc.file} 中找不到 class ${uc.class}`);
      affected.push(uc.file);
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'usecase_class_exists',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_class_exists'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UseCase 源文件与 class 均存在。',
    }];
  }

  return [{
    id: 'usecase_class_exists',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_class_exists'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 处 UseCase 类/文件缺失：\n${truncateList(missing, 10)}`,
    affected_files: affected,
    suggestion: '请按 Skill 3 指引在 domain/usecase/ 目录下创建对应 UseCase 类。',
  }];
}

function checkUseCaseClassPure(ctx: CheckContext): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'usecase_class_pure',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_class_pure'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }

  const offences: string[] = [];
  const affected: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    if (!uc.file) continue;
    const full = path.join(ctx.projectRoot, uc.file);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf-8');
    const hits = scanForbiddenImports(content, UI_FORBIDDEN_PATTERNS);
    if (hits.length > 0) {
      affected.push(uc.file);
      for (const h of hits) offences.push(`${uc.file} > ${h}`);
    }
  }

  if (offences.length === 0) {
    return [{
      id: 'usecase_class_pure',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'usecase_class_pure'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UseCase 源文件无 UI/Nav/Toast 依赖。',
    }];
  }

  return [{
    id: 'usecase_class_pure',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'usecase_class_pure'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${offences.length} 处禁止符号出现在 UseCase 源文件：\n${truncateList(offences, 20)}`,
    affected_files: [...new Set(affected)],
    suggestion: 'UseCase 必须是纯逻辑类：禁止 import @Component / NavPathStack / showToast / $r / @kit.ArkUI 等 UI 相关符号；将 UI 副作用下沉到页面层通过订阅 state 翻译。',
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

  const ucByClass = new Map<string, UseCaseDef>();
  for (const uc of spec.use_cases ?? []) ucByClass.set(uc.class, uc);

  const issues: string[] = [];
  const affected: string[] = [];

  for (const { path: p, dag } of dags) {
    if (!dag.use_case) {
      issues.push(`${p}: 缺少顶层 use_case 字段`);
      affected.push(p);
      continue;
    }
    const uc = ucByClass.get(dag.use_case);
    if (!uc) {
      issues.push(`${p}: use_case="${dag.use_case}" 不在 use-cases.yaml 中`);
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
    suggestion: 'DAG 顶层必须声明 use_case（匹配 use-cases.yaml > use_cases[].class）与 branches[]（子集 of 对应 UseCase 的 branches[].id）。',
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

function checkNoUiDepInUt(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [{
      id: 'no_ui_dep_in_ut',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'no_ui_dep_in_ut'),
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
      id: 'no_ui_dep_in_ut',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'no_ui_dep_in_ut'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UT 文件无 UI/Nav/Toast 依赖。',
    }];
  }

  return [{
    id: 'no_ui_dep_in_ut',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'no_ui_dep_in_ut'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${offences.length} 处禁止符号出现在 UT：\n${truncateList(offences, 20)}`,
    affected_files: [...new Set(affected)],
    suggestion: 'UT 只允许 import @ohos/hypium、被测 UseCase 及其 data/model、同目录 spy/ 目录；请移除所有 UI/Navigation/Toast 依赖，将 UI 侧验证下沉到 Skill 6 真机测试。',
  }];
}

function checkPortsAllStubbed(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  const spec = loadUseCaseSpec(ctx);
  if (!spec) {
    return [{
      id: 'ports_all_stubbed',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ports_all_stubbed'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  if (utFiles.length === 0) {
    return [{
      id: 'ports_all_stubbed',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ports_all_stubbed'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: '无 UT 文件可分析。',
    }];
  }

  const missing: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    // 把该 UseCase 关联的 UT 文件过滤出来：名称包含 class 名或 id（去掉下划线）
    const classLower = uc.class.toLowerCase();
    const idLower = uc.id.toLowerCase().replace(/_/g, '');
    const relatedUts = utFiles.filter(f => {
      const base = path.basename(f.path).toLowerCase();
      return (
        base.includes(classLower) ||
        base.includes(idLower) ||
        f.content.includes(uc.class)
      );
    });
    if (relatedUts.length === 0) {
      missing.push(`${uc.id}: 未找到测试该 UseCase 的 UT 文件`);
      continue;
    }

    for (const port of uc.ports ?? []) {
      const spyPatterns = [
        new RegExp(`new\\s+Spy${port.type}\\s*\\(`),
        new RegExp(`new\\s+Fake${port.type}\\s*\\(`),
        new RegExp(`new\\s+Stub${port.type}\\s*\\(`),
      ];
      const found = relatedUts.some(f => spyPatterns.some(re => re.test(f.content)));
      if (!found) {
        missing.push(`${uc.id} > port[${port.name}]: UT 中未发现 new Spy${port.type}(... / new Fake${port.type}(... / new Stub${port.type}(...`);
      }
    }
  }

  if (missing.length === 0) {
    return [{
      id: 'ports_all_stubbed',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ports_all_stubbed'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '所有 UseCase 的 ports 都在 UT 中得到了 Spy/Fake/Stub 注入。',
    }];
  }

  return [{
    id: 'ports_all_stubbed',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'ports_all_stubbed'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 个 port 未在 UT 中打桩：\n${truncateList(missing, 10)}`,
    suggestion: '请在 UT 中为每个 port 创建 SpyXxx 类（参考 framework/skills/5-business-ut/examples/card-opening/spy/），并通过构造器注入 UseCase。',
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

  const weak: string[] = [];
  const affected: string[] = [];

  const portCallRe = /(callLog|calls|\.call(?:ed|Count))\b/g;
  const stateRe = /useCase\s*\.\s*state\s*\.\s*\w+/g;

  for (const { path: p, content } of utFiles) {
    if (isHypiumSuiteEntryShim(content)) continue;
    const blocks = extractItBlocks(content);
    for (const b of blocks) {
      const portHits = b.body.match(portCallRe) ?? [];
      const stateHits = b.body.match(stateRe) ?? [];
      const expectHits = (b.body.match(/expect\s*\(/g) ?? []).length;
      if (portHits.length < 2 || stateHits.length < 2 || expectHits < 2) {
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
      details: '所有 it() 用例均满足"端到端驱动"启发式（≥2 port 引用 + ≥2 state 断言）。',
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
    suggestion: '每条 it() 应当：(1) 调用 useCase 的 trigger 方法驱动；(2) 对 SpyXxx.callLog/.calls 做 ≥2 次调用序列断言；(3) 对 useCase.state.* 做 ≥2 次状态断言。',
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

  const byClass = new Map<string, Array<{ path: string; dag: DagFile }>>();
  for (const d of dags) {
    const cls = d.dag.use_case;
    if (!cls) continue;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(d);
  }

  for (const uc of spec.use_cases ?? []) {
    const group = byClass.get(uc.class) ?? [];
    if (group.length === 0) continue;
    const allBranchIds = new Set<string>();
    const dupes: string[] = [];
    for (const g of group) {
      const b = Array.isArray(g.dag.branches) ? g.dag.branches : [];
      for (const id of b) {
        if (allBranchIds.has(id)) dupes.push(`${uc.class} > branch "${id}" 在多个 DAG 重复（最后一次出现：${g.path}）`);
        else allBranchIds.add(id);
      }
    }
    for (const d of dupes) issues.push(d);

    const expected = new Set((uc.branches ?? []).map(b => b.id));
    for (const want of expected) {
      if (!allBranchIds.has(want)) {
        issues.push(`${uc.class}: branch "${want}" 未被任何 DAG 覆盖`);
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

const checker: PhaseChecker = {
  phase: 'ut',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const dags = loadDagFiles(ctx);
    const utFiles = loadUtFiles(ctx);

    const results: CheckResult[] = [];

    // --- Structure checks ---
    // v2 A: use-cases.yaml 自身
    results.push(...safeRun(() => checkUseCaseSpecExists(ctx), 'usecase_spec_exists'));
    results.push(...safeRun(() => checkUseCaseSpecSchema(ctx), 'usecase_spec_schema'));
    results.push(...safeRun(() => checkUseCasePortMatchesContracts(ctx), 'usecase_port_matches_contracts'));
    results.push(...safeRun(() => checkUseCaseClassExists(ctx), 'usecase_class_exists'));
    results.push(...safeRun(() => checkUseCaseClassPure(ctx), 'usecase_class_pure'));

    // v1 保留 + v2 修订：DAG 结构
    results.push(...safeRun(() => checkDagSchemaCompliance(ctx, dags), 'dag_schema_compliance'));
    results.push(...safeRun(() => checkDagNodeTypeValid(ctx, dags), 'dag_node_type_valid'));
    results.push(...safeRun(() => checkDagAcyclic(ctx, dags), 'dag_acyclic'));
    results.push(...safeRun(() => checkDagSourceFileExists(ctx, dags), 'dag_source_file_exists'));
    // v2 B: DAG ↔ use-cases 关联
    results.push(...safeRun(() => checkDagLinkedUseCase(ctx, dags), 'dag_linked_usecase'));
    results.push(...safeRun(() => checkDagAssertionLinkedBranch(ctx, dags), 'dag_assertion_linked_branch'));
    results.push(...safeRun(() => checkDagCohesion(ctx, dags), 'dag_cohesion'));

    // v1 保留 + v2 修订：UT 代码
    results.push(...safeRun(() => checkUtFileNaming(ctx, utFiles), 'ut_file_naming'));
    results.push(...safeRun(() => checkUtFrameworkImport(ctx, utFiles), 'ut_framework_import'));
    results.push(...safeRun(() => checkUtAssertionExists(ctx, utFiles), 'ut_assertion_exists'));
    results.push(...safeRun(() => checkMockStubForAsync(ctx, dags, utFiles), 'mock_stub_for_async'));
    results.push(...safeRun(() => checkTestRegistration(ctx, utFiles), 'test_registration'));
    // v2 C: UT 代码
    results.push(...safeRun(() => checkNoUiDepInUt(ctx, utFiles), 'no_ui_dep_in_ut'));
    results.push(...safeRun(() => checkPortsAllStubbed(ctx, utFiles), 'ports_all_stubbed'));
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

    return results;
  },
};

export default checker;
