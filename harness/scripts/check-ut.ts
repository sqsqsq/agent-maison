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
} from './utils/types';

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
  branches?: {
    true_branch?: string[];
    false_branch?: string[];
  };
  linked_acceptance?: string[];
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
  'code_execution',
  'async_call',
  'user_intervention',
  'background_task',
  'ui_navigation',
  'assertion',
  'conditional_branch',
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
      if (node.type === 'conditional_branch' && node.branches) {
        nexts.push(...(node.branches.true_branch ?? []));
        nexts.push(...(node.branches.false_branch ?? []));
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

  const p0p1Criteria = acceptance.criteria.filter(c =>
    c.priority === 'P0' || c.priority === 'P1',
  );
  const uncoveredP0P1 = p0p1Criteria.filter(c => !coveredACs.has(c.id));

  const allBoundaries = acceptance.boundaries ?? [];
  const uncoveredBD = allBoundaries.filter(b => !coveredACs.has(b.id));

  const p0Count = acceptance.criteria.filter(c => c.priority === 'P0').length;
  const p0Covered = acceptance.criteria.filter(c => c.priority === 'P0' && coveredACs.has(c.id)).length;
  const p1Count = acceptance.criteria.filter(c => c.priority === 'P1').length;
  const p1Covered = acceptance.criteria.filter(c => c.priority === 'P1' && coveredACs.has(c.id)).length;

  const details: string[] = [];
  details.push(`P0 覆盖率: ${p0Covered}/${p0Count}`);
  details.push(`P1 覆盖率: ${p1Covered}/${p1Count}`);
  details.push(`BD 覆盖率: ${allBoundaries.length - uncoveredBD.length}/${allBoundaries.length}`);

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
    results.push(...safeRun(() => checkDagSchemaCompliance(ctx, dags), 'dag_schema_compliance'));
    results.push(...safeRun(() => checkDagNodeTypeValid(ctx, dags), 'dag_node_type_valid'));
    results.push(...safeRun(() => checkDagAcyclic(ctx, dags), 'dag_acyclic'));
    results.push(...safeRun(() => checkDagSourceFileExists(ctx, dags), 'dag_source_file_exists'));
    results.push(...safeRun(() => checkUtFileNaming(ctx, utFiles), 'ut_file_naming'));
    results.push(...safeRun(() => checkUtFrameworkImport(ctx, utFiles), 'ut_framework_import'));
    results.push(...safeRun(() => checkUtAssertionExists(ctx, utFiles), 'ut_assertion_exists'));
    results.push(...safeRun(() => checkMockStubForAsync(ctx, dags, utFiles), 'mock_stub_for_async'));
    results.push(...safeRun(() => checkTestRegistration(ctx, utFiles), 'test_registration'));

    // --- Traceability checks ---
    results.push(...safeRun(() => checkDagToAcceptance(ctx, dags), 'dag_to_acceptance'));
    results.push(...safeRun(() => checkAcceptanceCoverage(ctx, dags), 'acceptance_coverage'));
    results.push(...safeRun(() => checkDagToSource(ctx, dags), 'dag_to_source'));

    return results;
  },
};

export default checker;
