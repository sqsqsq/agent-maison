// ============================================================================
// Coding 阶段脚本 Harness — check-coding.ts
// ============================================================================
// 读取 framework/specs/phase-rules/coding-rules.yaml + doc/features/{feature}/
// 执行确定性的静态验证。
//
// 检查项（与 coding-rules.yaml 对应）：
//   Structure:     file_completeness, layer_compliance, inter_module_dependency,
//                  no_hardcoded_strings, resource_integrity, har_index_export,
//                  module_config_registered, oh_package_dependencies,
//                  page_registration, naming_conventions, no_any_type,
//                  async_await_pattern
//   Traceability:  design_to_code, design_file_plan_to_code, code_to_design
//
// 语义级检查由 AI Harness (verify-coding.md) 完成，不在本脚本范围内。
//
// 具体编译与失败归因由 profile `coding-host-rules.checkCodingCompile` 承担；根脚本仅编排。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import { AstAnalyzer, FileAnalysis } from './utils/ast-analyzer';
import { checkContextExplorationArtifact } from './utils/context-exploration';
import { parseScope, describeScopeError } from './utils/scope-parser';
import { scanNamedBusinessHandler } from './utils/named-handler';
import { diffChangedFiles, analyzeDiffStaleness } from './utils/git-diff';
import {
  loadFrameworkConfig,
  getOuterLayerIds,
  featureFilePath,
  relFeatureFile,
} from '../config';
import { CANONICAL_CODING_COMPILE_ID, LEGACY_CODING_COMPILE_ID } from '../capability-registry';
import { tryLoadProfileCodingHost } from '../profile-host-loader';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function ruleDesc(ctx: CheckContext, section: 'structure_checks' | 'semantic_checks' | 'traceability_checks', id: string): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function truncateList(items: string[], max: number): string {
  const shown = items.slice(0, max).map(i => `  - ${i}`).join('\n');
  return items.length > max ? `${shown}\n  ... 还有 ${items.length - max} 项` : shown;
}

// --------------------------------------------------------------------------
// Structure Checks
// --------------------------------------------------------------------------

function checkFileCompleteness(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.files?.length) {
    return [{ id: 'file_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_completeness'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 无 files 列表，跳过。' }];
  }

  const missing: string[] = [];
  for (const relPath of contracts.files) {
    if (!fs.existsSync(path.join(ctx.projectRoot, relPath))) missing.push(relPath);
  }

  if (missing.length === 0) {
    return [{ id: 'file_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_completeness'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${contracts.files.length} 个文件均存在。` }];
  }

  return [{
    id: 'file_completeness', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'file_completeness'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length}/${contracts.files.length} 个文件缺失：\n${truncateList(missing, 15)}`,
    affected_files: missing,
    suggestion: '请按照 contracts.yaml files 清单补全缺失文件。',
  }];
}

function checkLayerCompliance(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const cfg = loadFrameworkConfig(ctx.projectRoot);
  const analyzer = new AstAnalyzer(ctx.projectRoot, cfg.architecture);
  const violations: Array<{ file: string; msg: string }> = [];

  for (const a of analyses) {
    for (const v of analyzer.checkInternalLayerCompliance(a)) {
      violations.push({ file: v.file, msg: v.message });
    }
  }

  if (violations.length === 0) {
    return [{ id: 'layer_compliance', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'layer_compliance'), severity: 'BLOCKER', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? `${analyses.length} 个文件均符合模块内分层规则。` : '无可分析的宿主源码文件（由 project_profile 的 coding-host-rules.sourceFileSuffixes 与 contracts.files 决定）。' }];
  }

  // 按 DSL 顺序给出依赖方向提示：[shared → data → domain → presentation] 之类
  const innerLayers = cfg.architecture.module_inner_layers;
  const directionHint = innerLayers.length > 1
    ? `依赖方向：${[...innerLayers].reverse().join(' → ')}（索引大的层可依赖索引小的，反之禁止）`
    : `内层仅 ${innerLayers[0]}，无需跨层依赖。`;

  return [{
    id: 'layer_compliance', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'layer_compliance'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${violations.length} 处分层违规：\n${violations.slice(0, 10).map(v => `  - ${v.msg}`).join('\n')}${violations.length > 10 ? `\n  ... 还有 ${violations.length - 10} 处` : ''}`,
    affected_files: [...new Set(violations.map(v => v.file))],
    suggestion: directionHint,
  }];
}

function checkInterModuleDependency(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const cfg = loadFrameworkConfig(ctx.projectRoot);
  const analyzer = new AstAnalyzer(ctx.projectRoot, cfg.architecture);
  const violations: Array<{ file: string; msg: string }> = [];

  for (const a of analyses) {
    for (const v of analyzer.checkArchLayerCompliance(a)) {
      violations.push({ file: v.file, msg: v.message });
    }
  }

  if (violations.length === 0) {
    return [{ id: 'inter_module_dependency', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'inter_module_dependency'), severity: 'BLOCKER', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? `${analyses.length} 个文件均符合分层依赖规则。` : '无可分析的宿主源码文件（由 project_profile 的 coding-host-rules.sourceFileSuffixes 与 contracts.files 决定）。' }];
  }

  const outerIds = getOuterLayerIds(cfg.architecture);
  const directionHint = outerIds.length > 0
    ? `依赖方向由 framework.config.json 的 architecture.outer_layers[].can_depend_on 决定，当前 outer layers：${outerIds.join(' / ')}。`
    : '未在 architecture.outer_layers 中声明任何层。';

  return [{
    id: 'inter_module_dependency', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'inter_module_dependency'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${violations.length} 处跨模块依赖违规：\n${violations.slice(0, 10).map(v => `  - ${v.msg}`).join('\n')}${violations.length > 10 ? `\n  ... 还有 ${violations.length - 10} 处` : ''}`,
    affected_files: [...new Set(violations.map(v => v.file))],
    suggestion: directionHint,
  }];
}

// --------------------------------------------------------------------------
// Traceability Checks
// --------------------------------------------------------------------------

function checkDesignToCode(ctx: CheckContext): CheckResult[] {
  const traceability = ctx.featureSpec.contracts?.prd_to_code_traceability;
  if (!traceability?.length) {
    return [{ id: 'design_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'design_to_code'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 无 prd_to_code_traceability 映射。' }];
  }

  const allKeyFiles = new Set<string>();
  for (const item of traceability) {
    for (const f of item.key_files) allKeyFiles.add(f);
  }

  const missing: string[] = [];
  for (const f of allKeyFiles) {
    if (!fs.existsSync(path.join(ctx.projectRoot, f))) missing.push(f);
  }

  if (missing.length === 0) {
    return [{ id: 'design_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'design_to_code'), severity: 'BLOCKER', status: 'PASS', details: `PRD 映射的全部 ${allKeyFiles.size} 个关键文件均存在。` }];
  }

  const byPrd: Record<string, string[]> = {};
  for (const item of traceability) {
    for (const f of item.key_files) {
      if (missing.includes(f)) {
        if (!byPrd[item.prd_id]) byPrd[item.prd_id] = [];
        byPrd[item.prd_id].push(f);
      }
    }
  }

  return [{
    id: 'design_to_code', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'design_to_code'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length}/${allKeyFiles.size} 个 PRD 关键文件缺失：\n${Object.entries(byPrd).map(([id, files]) => `  - ${id}: ${files.join(', ')}`).join('\n')}`,
    affected_files: missing,
    suggestion: '请补全缺失的关键文件以满足 PRD → 代码的追溯链。',
  }];
}

/**
 * "架构层级目录前缀"由 framework.config.json 的 outer_layers[].id 推导，
 * 每个 layer id 被追加 "/" 作为顶层目录前缀。
 */
function getLayerDirPrefixes(projectRoot: string): string[] {
  return getOuterLayerIds(loadFrameworkConfig(projectRoot).architecture).map(id => `${id}/`);
}

function isUnderLayerDir(relPath: string, prefixes: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return prefixes.some(prefix => normalized.startsWith(prefix));
}

/** `paths.docs_committed` 与本检查关系说明（人读） */
function diffWithinScopeDocsNote(ctx: CheckContext): string {
  if (ctx.docsCommitted) {
    return (
      '\n\n（paths.docs_committed=true：工程约定将过程产物归档入仓时，请以团队规范为准；' +
      '本项仍仅以「外层业务模块路径」判断是否越出 design 声明的 in_scope_modules。）'
    );
  }
  return (
    '\n\n（paths.docs_committed=false：`doc/features/**` 等不入主仓属正常；' +
    ' 出现在 diff 中且未计入 in_scope_hit 的路径通常归为框架性/neutral，不单独构成本条 FAIL。）'
  );
}

function checkDiffWithinScope(ctx: CheckContext): CheckResult[] {
  const designPath = featureFilePath(ctx.projectRoot, ctx.feature, 'design.md');
  if (!fs.existsSync(designPath)) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `design.md 不存在（${designPath}），无法确定 in_scope_modules。`,
    }];
  }

  const design = fs.readFileSync(designPath, 'utf-8');
  const { scope, error } = parseScope(design);
  if (error || !scope) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `无法从 design.md 解析 Scope 声明：${error ? describeScopeError(error) : '未知错误'}`,
      suggestion: '请先通过 check-design.ts 的 scope_declaration 检查。',
      affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, 'design.md')],
    }];
  }

  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: 'contracts.yaml 无 modules，无法解析 package_path。',
    }];
  }

  const nameToPath = new Map<string, string>();
  for (const mod of contracts.modules) {
    if (mod.name && mod.package_path) {
      nameToPath.set(mod.name, mod.package_path.replace(/\\/g, '/').replace(/\/+$/, '') + '/');
    }
  }

  const missingPaths: string[] = [];
  const allowedPrefixes: string[] = [];
  for (const modName of scope.in_scope_modules) {
    const p = nameToPath.get(modName);
    if (p) allowedPrefixes.push(p);
    else missingPaths.push(modName);
  }

  if (missingPaths.length > 0) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `design.in_scope_modules 中以下模块在 contracts.yaml 中无 package_path：${missingPaths.join('、')}`,
      suggestion: '请在 contracts.yaml 的 modules 列表中补充这些模块的 package_path。',
      affected_files: [relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
    }];
  }

  const envRef = (process.env.HARNESS_DIFF_BASE_REF ?? '').trim();
  const diff = diffChangedFiles({
    projectRoot: ctx.projectRoot,
    baseRef: envRef || undefined,
  });
  if (!diff.executed) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `无法执行 git diff：${diff.error ?? '未知错误'}`,
      suggestion:
        '未设置时默认仅统计工作区相对 HEAD 的变更（等价 working）。若需包含已提交差异，请设置 HARNESS_DIFF_BASE_REF（如 HEAD~1、main 或具体 SHA）。',
    }];
  }
  const files = diff.changedFiles;
  const staleness = analyzeDiffStaleness(diff);

  if (files.length === 0) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'PASS',
      details: `git diff（base=${diff.baseRef}, mode=${diff.workingOnly ? 'working-only' : 'committed+working'}）无变更文件。${diffWithinScopeDocsNote(ctx)}`,
    }];
  }

  const violations: string[] = [];
  const inScopeHits: string[] = [];
  const neutralCount = { value: 0 };

  const layerDirPrefixes = getLayerDirPrefixes(ctx.projectRoot);
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    if (!isUnderLayerDir(normalized, layerDirPrefixes)) {
      neutralCount.value++;
      continue;
    }
    const hit = allowedPrefixes.find(p => normalized.startsWith(p));
    if (hit) inScopeHits.push(normalized);
    else violations.push(normalized);
  }

  if (violations.length === 0) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'PASS',
      details:
        `git diff（base=${diff.baseRef}, mode=${diff.workingOnly ? 'working-only' : 'committed+working'}）共 ${files.length} 个变更文件：` +
        `${inScopeHits.length} 个在 in_scope 模块内，${neutralCount.value} 个为框架性变更（doc/specs/harness/skills 等），0 个越界。\n` +
        `变更拆分：committed=${diff.committedFiles.length}, working=${diff.workingTreeFiles.length}, staged=${diff.stagedFiles.length}, untracked=${diff.untrackedFiles.length}` +
        diffWithinScopeDocsNote(ctx),
    }];
  }

  const staleHint = staleness.stale
    ? '\n\n诊断：stale_diff_base。你显式指定的 baseRef 导致 committed 历史差异远多于当前工作区差异。若只想约束未提交改动，请去掉 HARNESS_DIFF_BASE_REF（默认即 working）；若仍要对提交做 scope，请收窄 baseRef 或合并/整理提交后再跑。'
    : '';

  return [{
    id: 'diff_within_scope', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
    severity: 'BLOCKER', status: 'FAIL',
    details:
      `${violations.length} 个变更文件越界到 in_scope_modules 之外的模块：\n${truncateList(violations, 15)}\n\n` +
      `in_scope_modules: ${scope.in_scope_modules.join('、')}\n` +
      `base ref: ${diff.baseRef}（mode=${diff.workingOnly ? 'working-only' : 'committed+working'}）\n` +
      `变更拆分：committed=${diff.committedFiles.length}, working=${diff.workingTreeFiles.length}, staged=${diff.stagedFiles.length}, untracked=${diff.untrackedFiles.length}${staleHint}`,
    suggestion:
      staleness.stale
        ? '可先重跑不传 HARNESS_DIFF_BASE_REF（默认 working）；或显式设 HARNESS_DIFF_BASE_REF=working。若仍越界再回到 Skill 2 发起 scope 扩展或撤销误改。'
        : '若这些改动确属本需求必须：回到 Skill 2 的 Step 2.5.3 发起 scope 扩展提议，用户同意后在 design.md 的 expansions_with_user_approval 中登记，并把涉及模块加入 in_scope_modules。\n若属误改：用 `git checkout` / `git restore` 撤销越界文件。',
    affected_files: violations,
    failure_kind: staleness.stale ? 'stale_diff_base' : 'scope_violation',
    blocking_class: staleness.stale ? 'stale_diff_base' : 'diff_within_scope',
  }];
}

// --------------------------------------------------------------------------
// Main Checker
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// v2.1 业务编排命名入口约束
// --------------------------------------------------------------------------

function checkNamedBusinessHandlerCoding(ctx: CheckContext): CheckResult[] {
  const scan = scanNamedBusinessHandler(ctx);
  if (scan.skip) {
    return [{
      id: 'named_business_handler',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'named_business_handler'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过（简单 feature 由 acceptance.yaml + dag.yaml 主导）。',
    }];
  }
  if (scan.issues.length === 0) {
    return [{
      id: 'named_business_handler',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'named_business_handler'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: 'ui_bindings.user_actions.calls 引用的业务函数均为命名函数（非 inline lambda）。',
    }];
  }
  return [{
    id: 'named_business_handler',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'named_business_handler'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${scan.issues.length} 处命名入口缺失：\n${truncateList(scan.issues, 10)}`,
    suggestion: '将 UI 组件 onClick = () => {...} 中的业务逻辑抽成 Page 命名方法 / Flow 类方法 / 导出函数，并在 use-cases.yaml > ui_bindings.user_actions.calls 指向该命名符号，以便 UT 直接调用。',
  }];
}

function checkCoordinatorFileExistsIfDeclared(ctx: CheckContext): CheckResult[] {
  const spec = ctx.featureSpec.useCases;
  if (!spec) {
    return [{
      id: 'coordinator_file_exists_if_declared',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'coordinator_file_exists_if_declared'),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'use-cases.yaml 不存在，跳过。',
    }];
  }
  const missing: string[] = [];
  for (const uc of spec.use_cases ?? []) {
    if (!uc.coordinator_file) continue;
    const abs = path.join(ctx.projectRoot, uc.coordinator_file);
    if (!fs.existsSync(abs)) {
      missing.push(`${uc.id}: ${uc.coordinator_file}`);
    }
  }
  if (missing.length === 0) {
    return [{
      id: 'coordinator_file_exists_if_declared',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'coordinator_file_exists_if_declared'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: '声明了 coordinator_file 的 use_case，其文件均存在。',
    }];
  }
  return [{
    id: 'coordinator_file_exists_if_declared',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'coordinator_file_exists_if_declared'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${missing.length} 个 coordinator_file 未找到：\n${truncateList(missing, 10)}`,
    suggestion: '若业务编排以独立文件承载，请确认 coordinator_file 路径真实存在；若编排是 Page 内方法，可省略 coordinator_file 字段。',
  }];
}

const CODING_CRITICAL_SKIP_IDS = new Set([
  'file_completeness',
  'layer_compliance',
  'inter_module_dependency',
  'design_to_code',
  'design_file_plan_to_code',
  'diff_within_scope',
]);

function buildCodingRunStatusResult(ctx: CheckContext, results: CheckResult[]): CheckResult {
  const blockerFails = results.filter(r => r.status === 'FAIL' && r.severity === 'BLOCKER');
  const criticalSkips = results.filter(r => r.status === 'SKIP' && r.severity === 'BLOCKER' && CODING_CRITICAL_SKIP_IDS.has(r.id));
  const blockingWarnings = results.filter(r => r.status === 'WARN' && r.severity === 'BLOCKER');
  const compile = results.find(
    r => r.id === CANONICAL_CODING_COMPILE_ID || r.id === LEGACY_CODING_COMPILE_ID,
  );
  const contracts = ctx.featureSpec.contracts;
  const hasContractsFiles = Boolean(contracts?.files?.length);
  const hasContractsModules = Boolean(contracts?.modules?.length);
  const canClaimDone = blockerFails.length === 0 && criticalSkips.length === 0;

  const lines: string[] = [];
  lines.push(`can_claim_done: ${canClaimDone ? 'YES' : 'NO'}`);
  lines.push(`contracts.files: ${hasContractsFiles ? contracts!.files!.length : 0}`);
  lines.push(`contracts.modules: ${hasContractsModules ? contracts!.modules!.length : 0}`);
  lines.push(`coding_compile: ${compile?.status ?? 'MISSING'}`);
  lines.push(`blocker_fail_count: ${blockerFails.length}`);
  lines.push(`critical_skip_count: ${criticalSkips.length}`);
  lines.push(`blocking_warn_count: ${blockingWarnings.length}`);
  if (blockerFails.length > 0) {
    lines.push(`blocker_fail_ids: ${blockerFails.map(r => r.id).join(', ')}`);
  }
  if (criticalSkips.length > 0) {
    lines.push(`critical_skip_ids: ${criticalSkips.map(r => r.id).join(', ')}`);
  }
  if (blockingWarnings.length > 0) {
    lines.push(`blocking_warn_ids: ${blockingWarnings.map(r => r.id).join(', ')}`);
  }

  return {
    id: 'coding_run_status',
    category: 'structure',
    description: 'Coding 阶段脚本门禁总体状态',
    severity: 'BLOCKER',
    status: canClaimDone ? 'PASS' : 'FAIL',
    details: lines.join('\n'),
    suggestion: canClaimDone
      ? '脚本门禁可进入 verifier + receipt 闭环；注意 BLOCKER/WARN 仍需人工确认风险。'
      : '先修复 BLOCKER FAIL；若存在 critical_skip_ids，请补齐 contracts.yaml / design trace / diff baseline 后重跑。',
  };
}

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

const checker: PhaseChecker = {
  phase: 'coding',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const host = tryLoadProfileCodingHost(ctx.resolvedProfile.profileDir);
    if (!host) {
      const missing: CheckResult = {
        id: 'coding_host_missing',
        category: 'structure',
        description: 'Coding 宿主规则（profile coding-host-rules）',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `当前 project_profile 未提供可用的 profileCodingHost（profileDir=${ctx.resolvedProfile.profileDir}）。`,
        suggestion:
          '请为宿主 profile 实现并导出 harness/coding-host-rules.ts（含 checkCodingCompile、runStructureChecks、runTraceabilityChecks）；可参考 framework/profiles/hmos-app/harness/coding-host-rules.ts。',
      };
      const results: CheckResult[] = [missing, buildCodingRunStatusResult(ctx, [missing])];
      return results;
    }

    const contracts = ctx.featureSpec.contracts;
    const suffixes = host.sourceFileSuffixes;
    const normalizeSuffix = (s: string) => (s.startsWith('.') ? s : `.${s}`);
    const normSuffixes = suffixes.map(normalizeSuffix);
    const sourceFiles =
      contracts?.files?.filter(f => normSuffixes.some(suf => f.endsWith(suf))) ?? [];

    const analyzer = new AstAnalyzer(ctx.projectRoot);
    const analyses = sourceFiles.length > 0 ? analyzer.analyzeFiles(sourceFiles) : [];

    const results: CheckResult[] = [];

    results.push(
      ...safeRun(
        () => checkContextExplorationArtifact(ctx.projectRoot, ctx.feature, 'coding', {
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
        }),
        'context_exploration_gate',
      ),
    );

    // --- Structure checks ---
    results.push(...safeRun(() => checkFileCompleteness(ctx), 'file_completeness'));
    results.push(...safeRun(() => checkLayerCompliance(ctx, analyses), 'layer_compliance'));
    results.push(...safeRun(() => checkInterModuleDependency(ctx, analyses), 'inter_module_dependency'));
    results.push(
      ...safeRun(() => host.runStructureChecks(ctx, analyses), 'profile_coding_host_structure'),
    );
    results.push(...safeRun(() => checkNamedBusinessHandlerCoding(ctx), 'named_business_handler'));
    results.push(...safeRun(() => checkCoordinatorFileExistsIfDeclared(ctx), 'coordinator_file_exists_if_declared'));
    results.push(...safeRun(() => host.checkCodingCompile(ctx), 'coding_compile'));

    // --- Traceability checks ---
    results.push(...safeRun(() => checkDesignToCode(ctx), 'design_to_code'));
    results.push(
      ...safeRun(() => host.runTraceabilityChecks(ctx), 'profile_coding_host_trace'),
    );
    results.push(...safeRun(() => checkDiffWithinScope(ctx), 'diff_within_scope'));

    results.push(buildCodingRunStatusResult(ctx, results));

    return results;
  },
};

export default checker;
