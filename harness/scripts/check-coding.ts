import { executeCheck } from './utils/check-execution';
// ============================================================================
// Coding 阶段脚本 Harness — check-coding.ts
// ============================================================================
// 读取 framework/specs/phase-rules/coding-rules.yaml + doc/features/{feature}/
// 执行确定性的静态验证。
//
// 检查项（与 coding-rules.yaml 对应）：
//   Structure:     file_completeness, layer_compliance, inter_module_dependency,
//                  no_hardcoded_strings, har_index_export,
//                  module_config_registered, oh_package_dependencies,
//                  page_registration, naming_conventions, no_any_type,
//                  async_await_pattern
//   Traceability:  plan_to_code, plan_file_to_code, code_to_plan
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
import { checkFactsArtifact } from './utils/context-facts';
import { checkChangeUnitFeatureProjection } from './utils/change-unit-feature-projection';
import { checkUpstreamVerdictGate } from './utils/upstream-verdict-gate';
import { probeConsumerBinding } from './utils/integration-scope';
import { parseScope, describeScopeError } from './utils/scope-parser';
import { scanNamedBusinessHandler } from './utils/named-handler';
import { diffChangedFiles, diffChangedFilesWithStatus, analyzeDiffStaleness } from './utils/git-diff';
import { readRunBoundContracts } from './utils/capability-resolution';
import { resolveEffectiveDiffBaseline } from './utils/git-diff';
import { resolveEffectiveScopeSource, loadLineageRunEvents, currentFileHash } from './utils/goal-run-creation';
import { replayUtOwnedWrites } from './utils/phase-write-boundary';
import { resolveContractFileReferences } from './utils/contract-reference-closure';
import { runUiDiffWithinDeclaredFiles } from './utils/ui-scope-gate';
import { classifyChangedFiles, layerDirPrefixes, resolveModulePathPrefixes, resolveImplementationScope, implementationFiles } from './utils/diff-scope';
import { relFeaturesDir } from '../config';
import {
  loadFrameworkConfig,
  getOuterLayerIds,
  resolveFeatureArtifact,
  relFeatureArtifact,
  relFeatureFile,
} from '../config';
import { CANONICAL_CODING_COMPILE_ID, LEGACY_CODING_COMPILE_ID, isCodingVisualParitySkipped, dispatchCodingVisualParity } from '../capability-registry';
import { featureArtifactLayoutWarnings } from './utils/feature-artifact-legacy';
import { buildBehaviorSwitchCheckResult } from './utils/behavior-switch-scan';
import { validateProjectRelativePath } from './utils/project-relative-path';
import { findBasenameCandidates, formatPrefixMismatchHint } from './utils/path-candidates';
import { tryLoadProfileCodingHost } from '../profile-host-loader';
import { resolveHarnessDiffBaseRef } from './utils/phase-state';
import { isBlockingCheck, isRequiredCheckGap, isFrameworkExecutionGap } from './utils/check-disposition';
import { codingTestPreservation } from './utils/repair-responsibility';

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
    return [{ id: 'file_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_completeness'), severity: 'MINOR', status: 'SKIP', details: '无文件预测；仍检查实际改动与真实交付。', structured: { applicability: 'not_applicable' } }];
  }

  const missing: string[] = [];
  const { partitionConstructionFiles } = require('./utils/phase-write-boundary') as typeof import('./utils/phase-write-boundary');
  const due = partitionConstructionFiles(ctx.projectRoot, ctx.resolvedProfile?.profileDir ?? '', contracts).implementation;
  for (const relPath of due) {
    if (!fs.existsSync(path.join(ctx.projectRoot, relPath))) missing.push(relPath);
  }

  if (missing.length === 0) {
    return [{ id: 'file_completeness', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'file_completeness'), severity: 'BLOCKER', status: 'PASS', details: `预测位置中 ${contracts.files.length} 个文件可读取；存在性不证明行为实现。` }];
  }

  // t1c（plan e6a3c9f4）：basename 候选检索（限 architecture 层目录、单次遍历、硬上限）——
  // 前缀错配时点破真因，不再只报"缺失"。只加诊断信息，判定逻辑零变化。
  let prefixHint: string | null = null;
  try {
    const cfg = loadFrameworkConfig(ctx.projectRoot);
    const layerDirs = (cfg.architecture?.outer_layers ?? []).map(l => l.id);
    const candidates = findBasenameCandidates(
      ctx.projectRoot,
      layerDirs,
      missing.map(m => path.basename(m)),
    );
    prefixHint = formatPrefixMismatchHint(missing, candidates);
  } catch {
    prefixHint = null; // 诊断是 best-effort，绝不因诊断失败拖垮门禁
  }

  return [{
    id: 'file_completeness', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'file_completeness'),
    severity: 'MAJOR', status: 'WARN',
    details:
      `${missing.length}/${contracts.files.length} 个文件缺失：\n${truncateList(missing, 15)}` +
      (prefixHint ? `\n${prefixHint}` : ''),
    affected_files: missing,
    suggestion: prefixHint
      ? '存在同名文件位于其他路径（见 details 诊断行）——优先核对 contracts.yaml files 的路径前缀是否与物理布局一致，修正 contracts 或移动文件，二选一后重跑。'
      : '预测位置未命中：按实际源码更新定位或由 review 核验行为，不为凑清单创建空壳文件。',
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
    return [{ id: 'layer_compliance', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'layer_compliance'), severity: 'BLOCKER', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? `${analyses.length} 个文件均符合模块内分层规则。` : '无可分析的宿主源码文件（按 profile 源码后缀、实际 diff 与可读定位线索选择）。' }];
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
    return [{ id: 'inter_module_dependency', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'inter_module_dependency'), severity: 'BLOCKER', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? `${analyses.length} 个文件均符合分层依赖规则。` : '无可分析的宿主源码文件（按 profile 源码后缀、实际 diff 与可读定位线索选择）。' }];
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

// 第五轮复审起导出：空集假 PASS（0 key_files）行为需单测钉死。
export function checkDesignToCode(ctx: CheckContext): CheckResult[] {
  const traceability = ctx.featureSpec.contracts?.prd_to_code_traceability;
  if (!traceability?.length && ctx.resolvedInputs && ctx.featureSpec.contracts?.change_unit) return [{
    id: 'plan_to_code', category: 'traceability', severity: 'MINOR', status: 'SKIP', description: '旧 PRD 文件映射不适用 CU 输入', details: 'CU 的 predicate/provide/design-ref 到真实实现由 change_unit_feature_projection 检查；不要求再复制一份 prd_to_code_traceability。', structured: { applicability: 'not_applicable' },
  }];
  if (!traceability?.length) {
    return [{ id: 'plan_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'), severity: 'MINOR', status: 'SKIP', details: '无预测文件映射；语义覆盖由实际审查与测试核实。', structured: { applicability: 'not_applicable' } }];
  }

  const allKeyFiles = new Set<string>();
  for (const item of traceability) {
    for (const f of item.key_files) allKeyFiles.add(f);
  }

  // P0-2 第七轮复审（codex P1）：prd_id 契约逐条校验——缺失/空白的条目"无法追溯到任何
  // PRD"，即便 key_files 合法也不能 PASS。
  const badPrdIds: string[] = [];
  traceability.forEach((item, i) => {
    const prdId = typeof item.prd_id === 'string' ? item.prd_id.trim() : '';
    if (!prdId) badPrdIds.push(`prd_to_code_traceability[${i}]`);
  });
  if (badPrdIds.length > 0) {
    return [{
      id: 'plan_to_code', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `${badPrdIds.length}/${traceability.length} 条 traceability 条目缺 prd_id（或为空白）：${badPrdIds.join('、')}——无法追溯到任何 PRD。`,
      suggestion: '为每条 traceability 条目补非空 prd_id（与 spec 功能清单/acceptance 的编号对应）。',
    }];
  }

  const emptyEntries = traceability.filter(item => item.key_files.length === 0);

  // P0-2 第七轮复审（codex P1 实测复现）：existsSync 会把 ""/"."/目录/越根路径全判"存在"
  // ——伪造追溯四件套。收紧为：trim 非空 + 安全相对路径（validateProjectRelativePath，
  // 拒绝绝对路径/盘符/".."越根）+ stat.isFile() 普通文件。用户内容不合法=本门禁 FAIL，
  // 不许 throw 成 [Harness 内部错误]。
  const badPaths: string[] = [];
  for (const item of traceability) {
    for (const f of item.key_files) {
      const trimmed = f.trim();
      if (!trimmed) {
        badPaths.push(`${JSON.stringify(item.prd_id)}: 空路径`);
        continue;
      }
      try {
        validateProjectRelativePath(ctx.projectRoot, trimmed, 'key_files');
      } catch (e) {
        badPaths.push(`${JSON.stringify(item.prd_id)}: "${f}"（${(e as Error).message.replace(/^\[project-relative-path\]\s*/, '')}）`);
      }
    }
  }
  if (badPaths.length > 0) {
    return [{
      id: 'plan_to_code', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `key_files 含非法路径（须为 project-root 内的相对路径）：\n${badPaths.slice(0, 10).map((b) => `  - ${b}`).join('\n')}${badPaths.length > 10 ? `\n  ... 还有 ${badPaths.length - 10} 处` : ''}`,
      suggestion: '修正为相对宿主根的普通文件路径（如 "02-Feature/X/src/main/ets/..."），不得使用空串、"."、绝对路径或 ".." 越根。',
    }];
  }

  const missing: string[] = [];
  const notFile: string[] = [];
  for (const f of allKeyFiles) {
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(path.join(ctx.projectRoot, f));
    } catch {
      st = null;
    }
    if (!st) missing.push(f);
    else if (!st.isFile()) notFile.push(f);
  }
  if (notFile.length > 0) {
    return [{
      id: 'plan_to_code', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'),
      severity: 'BLOCKER', status: 'FAIL',
      details: `key_files 指向非普通文件（目录等）：${notFile.slice(0, 10).join('、')}${notFile.length > 10 ? ` ... 还有 ${notFile.length - 10} 处` : ''}——追溯必须落到具体实现文件。`,
      suggestion: '把目录级映射改为该 PRD 的具体关键文件路径。',
    }];
  }

  if (emptyEntries.length) return [{
    id: 'plan_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'),
    severity: 'MAJOR', status: 'WARN',
    details: emptyEntries.length + '/' + traceability.length + ' 条预测未映射 key_files：' + emptyEntries.map(item => item.prd_id).join('、'),
    suggestion: '定位缺口不代表行为缺失；由实际源码、review 与测试核实覆盖，不为填预测清单补空壳。',
  }];

  if (missing.length === 0) {
    return [{ id: 'plan_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'), severity: 'BLOCKER', status: 'PASS', details: `映射位置中的 ${allKeyFiles.size} 个文件可读取；存在性不证明行为实现。` }];
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
    id: 'plan_to_code', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'plan_to_code'),
    severity: 'MAJOR', status: 'WARN',
    details: `${missing.length}/${allKeyFiles.size} 个预测实现位置未命中当前文件：\n${Object.entries(byPrd).map(([id, files]) => `  - ${id}: ${files.join(', ')}`).join('\n')}`,
    affected_files: missing,
    suggestion: '按实际源码核对行为覆盖并更新定位，不为凑预测文件创建空壳；真实缺陷仍由 review/编译/测试拦截。',
  }];
}

/** `paths.docs_committed` 与本检查关系说明（人读） */
function diffWithinScopeDocsNote(ctx: CheckContext): string {
  if (ctx.docsCommitted) {
    return (
      '\n\n（paths.docs_committed=true：工程约定将过程产物归档入仓时，请以团队规范为准；' +
      '本项仍仅以「外层业务模块路径」核对原请求明确限制。）'
    );
  }
  return (
    `\n\n（paths.docs_committed=false：\`${relFeaturesDir(ctx.projectRoot)}/**\` 等不入主仓属正常；` +
    ' 出现在 diff 中且未计入 in_scope_hit 的路径通常归为框架性/neutral，不单独构成本条 FAIL。）'
  );
}

/** Current profile paths and existing write/manifest facts, shared by both coding gates. */
function codingTestChanges(ctx: CheckContext, files: readonly string[], events: ReturnType<typeof loadLineageRunEvents>, runId?: string): Array<{ file: string; preserved: boolean; reason: string }> {
  const { partitionConstructionFiles } = require('./utils/phase-write-boundary') as typeof import('./utils/phase-write-boundary');
  const { loadPhaseEvidenceManifest, evidenceEntryMatchesCurrentFile } = require('./utils/phase-evidence-manifest') as typeof import('./utils/phase-evidence-manifest');
  const contracts = ctx.featureSpec.contracts ?? { modules: [], files: [] };
  const testPaths = partitionConstructionFiles(ctx.projectRoot, ctx.resolvedProfile?.profileDir ?? '', { ...contracts, files: [...files] }).tests;
  const owned = replayUtOwnedWrites(events);
  const priorUt = loadPhaseEvidenceManifest(ctx.projectRoot, ctx.feature, 'ut');
  const codingWrites = new Map<string, string>();
  for (const event of events) {
    if (event.phase !== 'coding' || event.type !== 'phase_write_observed') continue;
    for (const row of (event as { observations?: Array<{ path: string }> }).observations ?? []) codingWrites.set(row.path, event.ts ?? '');
  }
  return testPaths.flatMap(file => {
    if (runId && !owned.has(file) && !codingWrites.has(file)) return [];
    const fact = owned.get(file);
    if (fact && !fact.voidedBy && currentFileHash(ctx.projectRoot, file) === fact.sha256) return [];
    const lastWrite = codingWrites.get(file);
    const laterUt = !runId || events.some(event => event.phase === 'ut' && event.type === 'phase_verdict' && event.verdict === 'PASS'
      && !event.advance_blocked && event.action !== 'retry' && (!lastWrite || Date.parse(event.ts ?? '') > Date.parse(lastWrite)));
    if (laterUt && priorUt?.integrityOk && (!lastWrite || Date.parse(priorUt.manifest.generated_at) > Date.parse(lastWrite))
      && priorUt.manifest.outputs.some(entry => entry.path === file && evidenceEntryMatchesCurrentFile(ctx.projectRoot, entry, ctx.feature))) return [];
    return [{ file, ...codingTestPreservation({ projectRoot: ctx.projectRoot, feature: ctx.feature, file, runId }) }];
  });
}

export function checkCodingExistingTestPreserved(ctx: CheckContext): CheckResult[] {
  const runId = process.env.MAISON_GOAL_RUN_ID?.trim();
  const baseline = resolveEffectiveDiffBaseline(ctx.projectRoot, ctx.feature, runId);
  const diff = baseline.available ? diffChangedFilesWithStatus({ projectRoot: ctx.projectRoot, baseRef: baseline.baseSha }) : null;
  const events = runId ? loadLineageRunEvents(ctx.projectRoot, ctx.feature, runId) : [];
  const rows = diff?.executed ? codingTestChanges(ctx, diff.entries.map(entry => entry.path), events, runId) : [];
  const failures = rows.filter(row => !row.preserved);
  return [{ id: 'coding_existing_test_preserved', category: 'traceability', severity: 'BLOCKER',
    status: failures.length ? 'FAIL' : 'PASS', description: 'coding 有限兼容修补保留既有用例与断言',
    details: rows.length ? rows.map(row => `${row.file}：${row.reason}`).join('\n') : '没有需要有限兼容豁免的 coding 测试源码修改。',
    ...(failures.length ? { affected_files: failures.map(row => row.file), repair_owner: 'ut',
      suggestion: '交真实 UT 负责方修正或以当前有效 manifest 核验采纳；新增/修改用例及断言不属于 coding 有限许可。' } : {}) }];
}

export function checkDiffWithinScope(ctx: CheckContext): CheckResult[] {
  if (ctx.resolvedInputs) {
    const result = (status: 'PASS' | 'FAIL', details: string, files?: string[]): CheckResult[] => [{ id: 'diff_within_scope', category: 'traceability', severity: 'BLOCKER', status, description: '实现遵守原请求真实边界及阶段职责，预测文件不作许可', details, affected_files: files, ...(status === 'FAIL' ? { failure_kind: 'scope_violation', suggestion: '核对原请求明确限制与实际改动；误改由本阶段恢复，真实需求或公共契约变化交责任方。' } : {}) }];
    const runId = process.env.MAISON_GOAL_RUN_ID?.trim();
    // D1 §6.4 G1：判据从「有 run 身份」改为「有**有效范围权威**」——run 或 feature 冻结记录。
    // 两者都没有才是「说不清本次施工由哪份设计授权」，那时才 FAIL。
    const authority = resolveEffectiveScopeSource(ctx.projectRoot, ctx.feature, runId);
    if (!authority) return result('FAIL', '现代 Feature coding 缺少有效范围权威（既无 run 身份，也无 feature 冻结记录）');
    try {
      const contracts = readRunBoundContracts(ctx.projectRoot, ctx.frameworkRoot, ctx.feature, runId);
      const closure = resolveContractFileReferences(ctx.projectRoot, contracts);
      if (closure.invalid_paths.length) return result('FAIL', '施工契约包含非法文件引用');
      // G5：基线走统一来源选择（有 run → run 基线；无 run → 既有 HARNESS_DIFF_BASE_REF 三态）
      const baseline = resolveEffectiveDiffBaseline(ctx.projectRoot, ctx.feature, runId);
      if (!baseline.available) return result('FAIL', baseline.reason);
      const diff = diffChangedFilesWithStatus({ projectRoot: ctx.projectRoot, baseRef: baseline.baseSha });
      if (!diff.executed) return result('FAIL', diff.error ?? '无法读取 run baseline diff');
      const { isCurrentComponentInventory } = require('./utils/component-assets') as typeof import('./utils/component-assets');
      const files = [...new Set(diff.entries.flatMap(entry => [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])]))]
        .filter(file => !isCurrentComponentInventory(ctx.projectRoot, file));
      const scope = resolveImplementationScope(ctx.projectRoot, ctx.feature, contracts.modules, runId);
      const classified = classifyChangedFiles(files, scope.allowedPrefixes, scope.sourcePrefixes);
      const hasRunAuthority = !!runId && authority.source === 'run';
      const events = hasRunAuthority ? loadLineageRunEvents(ctx.projectRoot, ctx.feature, runId!) : [];
      // Test permission is judged once by coding_existing_test_preserved, with UT adoption support.
      // Use the existing invocation delta, not package-vs-host-Git differences from an earlier integration.
      const frameworkBefore = new Map<string, string | null>();
      for (const event of events) {
        if (event.type !== 'phase_write_observed' || event.phase !== 'coding') continue;
        for (const row of (event as { observations?: Array<{ path: string; pre_sha256: string | null }> }).observations ?? []) {
          if (row.path.startsWith('framework/')) {
            const safe = validateProjectRelativePath(ctx.projectRoot, row.path, 'observed framework write');
            if (!frameworkBefore.has(safe)) frameworkBefore.set(safe, row.pre_sha256);
          }
        }
      }
      const frameworkViolations = [...frameworkBefore].filter(([file, before]) => currentFileHash(ctx.projectRoot, file) !== before).map(([file]) => file);
      const violations = [...new Set([...classified.violations, ...frameworkViolations])];
      return violations.length ? result('FAIL', '实现违反原请求真实边界或阶段职责：\n' + violations.join('\n'), violations)
        : result('PASS', '已核验绑定身份、工程源码域与实际 diff；文件/模块预测不作逐项许可，UT产出保持字节及归属承接。语义范围及公共契约由独立 review 核实。');
    } catch (error) { return result('FAIL', String(error)); }
  }
  const scope = resolveImplementationScope(ctx.projectRoot, ctx.feature, ctx.featureSpec.contracts?.modules);
  const allowedPrefixes = scope.allowedPrefixes;
  const envRef = resolveHarnessDiffBaseRef();
  const diff = diffChangedFiles({
    projectRoot: ctx.projectRoot,
    baseRef: envRef,
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

  const { violations, inScopeHits, neutralCount: neutral } = classifyChangedFiles(
    files,
    allowedPrefixes,
    scope.sourcePrefixes,
  );
  const neutralCount = { value: neutral };

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
      `in_scope_modules: ${scope.modules.map(module => module.name).join('、')}\n` +
      `base ref: ${diff.baseRef}（mode=${diff.workingOnly ? 'working-only' : 'committed+working'}）\n` +
      `变更拆分：committed=${diff.committedFiles.length}, working=${diff.workingTreeFiles.length}, staged=${diff.stagedFiles.length}, untracked=${diff.untrackedFiles.length}${staleHint}`,
    suggestion:
      staleness.stale
        ? '可先重跑不传 HARNESS_DIFF_BASE_REF（默认 working）；或显式设 HARNESS_DIFF_BASE_REF=working。若仍违反原请求真实边界，撤销误改或按原确认流程更正请求。'
        : '撤回违反原请求真实边界的改动；确需更正原请求时沿原确认流程，修改预测模块清单不能放行。\n若属误改：用 `git checkout` / `git restore` 撤销越界文件。',
    affected_files: violations,
    failure_kind: staleness.stale ? 'stale_diff_base' : 'scope_violation',
    blocking_class: staleness.stale ? 'stale_diff_base' : 'diff_within_scope',
  }];
}

/**
 * c4e8b1d3 G1：ui_diff_within_declared_files——UI 文件级 scope 门。
 * 白名单=同 run plan PASS snapshot 冻结的 contracts.files（fail-closed 禁退 live）；
 * diff 基线=runner 锚定的 coding_base_sha（四态覆盖）；删除/重命名 base 侧分类。
 * 任何 strictness 均 BLOCKER（不受视觉 fidelity 档位影响）。
 */
function checkUiDiffWithinDeclaredFiles(ctx: CheckContext): CheckResult[] {
  const runId = process.env.MAISON_GOAL_RUN_ID?.trim() || null;
  const r = runUiDiffWithinDeclaredFiles({
    projectRoot: ctx.projectRoot,
    feature: ctx.feature,
    runId,
    frameworkRoot: ctx.frameworkRoot,
    resolvedInputs: ctx.resolvedInputs,
  });
  // round 19 P1：goal run 内本门**永不 SKIP**（任何不可判都是 FAIL）；唯一合法 SKIP =
  // 非 goal 起跑（无 run 级锚，设计内），降 MINOR 使其不进 critical-skip 判定；
  // 除此之外出现的 BLOCKER 级 SKIP（如未来回归）由 CODING_CRITICAL_SKIP_IDS 拦 claim done。
  //
  // D1 §6.4 G6：判据改为**按本门返回的 SKIP 语义**——本门只在「既无 run 也无 feature 冻结
  // 记录」时才返回设计内 SKIP。有 feature 权威却 SKIP 说明本门没按新语义执行，那是回归，
  // 必须留在 BLOCKER，不能因为 `runId === null` 就降成 MINOR。
  const designedSkip = r.status === 'SKIP'
    && runId === null
    && !resolveEffectiveScopeSource(ctx.projectRoot, ctx.feature, undefined);
  return [{
    id: 'ui_diff_within_declared_files',
    category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'ui_diff_within_declared_files'),
    severity: designedSkip ? 'MINOR' : 'BLOCKER',
    status: r.status,
    details: r.details,
    affected_files: r.affectedFiles,
    suggestion: r.suggestion,
    failure_kind: r.failureKind,
    blocking_class: r.failureKind ? 'ui_diff_within_declared_files' : undefined,
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
      details: !ctx.featureSpec.useCases ? 'use-cases.yaml 不存在，跳过（简单 feature 由 acceptance.yaml + dag.yaml 主导）。'
        : '当前 profile 不提供具名入口扫描；此检查不适用，真实实现仍须经编译、审查与测试验证。',
      ...(scan.structured ? { structured: scan.structured } : !ctx.featureSpec.useCases ? { structured: { applicability: 'not_applicable' } } : {}),
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
    suggestion: '将 UI 事件入口提取为可定位的具名方法，并在 user_actions.calls 逐项引用；命名可定位不代表 UT 可直接调用。UT 按 acceptance.ut_layer 与真实业务入口验证，需要时由责任方补最小测试接缝。',
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
      structured: { applicability: 'not_applicable' },
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
  'plan_to_code',
  'plan_file_to_code',
  'diff_within_scope',
  // cursor 深度 review P2：visual_parity BLOCKER 级 SKIP（failClosed 异常）计入 critical——
  // profile 显式关闭产生的 MINOR SKIP 不在此列（severity 过滤天然放行）。
  'visual_parity',
  // c4e8b1d3 round19 P1：UI scope 门在 goal run 内永不合法 SKIP——出现 BLOCKER 级 SKIP
  // 即异常，须拦 claim done；normal 模式的设计内 SKIP 已降 MINOR，天然放行。
  'ui_diff_within_declared_files',
]);

function buildCodingRunStatusResult(ctx: CheckContext, results: CheckResult[]): CheckResult {
  const blockerFails = results.filter(r => isBlockingCheck(r));
  const criticalSkips = results.filter(r => r.status === 'SKIP' && r.severity === 'BLOCKER' && (CODING_CRITICAL_SKIP_IDS.has(r.id) || isRequiredCheckGap(r)));
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
    status: canClaimDone ? 'PASS' : blockerFails.length === 0 && criticalSkips.length > 0 && criticalSkips.every(check => isRequiredCheckGap(check)) ? 'SKIP' : 'FAIL',
    ...(blockerFails.length === 0 && criticalSkips.length > 0 && criticalSkips.every(isFrameworkExecutionGap) ? { failure_kind: 'framework_bug', blocking_class: 'framework_internal', actionability: 'framework_blocked' as const } : {}),
    details: lines.join('\n'),
    suggestion: canClaimDone
      ? '脚本门禁可进入 verifier + receipt 闭环；注意 BLOCKER/WARN 仍需人工确认风险。'
      : '先修复 BLOCKER FAIL；若存在 critical_skip_ids，请补齐 contracts.yaml / plan trace / diff baseline 后重跑。',
  };
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
      implementationFiles(ctx.projectRoot, ctx.feature, contracts, process.env.MAISON_GOAL_RUN_ID?.trim()).filter(f => normSuffixes.some(suf => f.endsWith(suf)));

    const analyzer = new AstAnalyzer(ctx.projectRoot);
    const analyses = sourceFiles.length > 0 ? analyzer.analyzeFiles(sourceFiles) : [];

    const results: CheckResult[] = [
      ...featureArtifactLayoutWarnings(ctx.projectRoot, ctx.feature, ['plan.md']),
    ];

    results.push(
      ...executeCheck(ctx,
        () => checkFactsArtifact(ctx.projectRoot, ctx.feature, 'coding', {
          factsContext: ctx.factsContext,
          resolvedInputs: ctx.resolvedInputs,
          phaseRule: ctx.phaseRule,
          profileName: ctx.resolvedProfile.name,
          frameworkRoot: ctx.frameworkRoot,
        }),
        'context_exploration_gate',
      ),
    );

    // （host_entry_reachability 定义见文件下方 checkHostEntryReachability）
    // --- blind-visual-hardening d1 切片一：上游裁决传播 ---
    results.push(
      ...executeCheck(ctx,
        () => checkUpstreamVerdictGate({ projectRoot: ctx.projectRoot, feature: ctx.feature, phase: 'coding', runId: ctx.resolvedInputs ? process.env.MAISON_GOAL_RUN_ID : undefined }),
        'upstream_verdict_gate',
      ),
    );

    // --- visual-capability-truth S6（P1-G）：宿主入口可达性（review 前静态走查）---
    results.push(...executeCheck(ctx, () => checkHostEntryReachability(ctx), 'host_entry_reachability'));

    // --- Structure checks ---
    results.push(...executeCheck(ctx, () => checkFileCompleteness(ctx), 'file_completeness'));
    results.push(...executeCheck(ctx, () => checkLayerCompliance(ctx, analyses), 'layer_compliance'));
    results.push(...executeCheck(ctx, () => checkInterModuleDependency(ctx, analyses), 'inter_module_dependency'));
    results.push(
      ...executeCheck(ctx, () => host.runStructureChecks(ctx, analyses), 'profile_coding_host_structure'),
    );
    results.push(...executeCheck(ctx, () => checkNamedBusinessHandlerCoding(ctx), 'named_business_handler'));
    results.push(...executeCheck(ctx, () => checkCoordinatorFileExistsIfDeclared(ctx), 'coordinator_file_exists_if_declared'));
    results.push(...executeCheck(ctx, () => checkChangeUnitFeatureProjection(ctx, 'coding'), 'change_unit_feature_projection'));
    results.push(...executeCheck(ctx, () => host.checkCodingCompile(ctx), 'coding_compile'));

    if (ctx.resolvedInputs?.context.obligations['visual-evidence'] === 'not_applicable' || isCodingVisualParitySkipped(ctx.resolvedProfile)) {
      results.push({
        id: 'visual_parity',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'visual_parity'),
        severity: 'MINOR',
        status: 'SKIP',
        details: ctx.resolvedInputs?.context.obligations['visual-evidence'] === 'not_applicable' ? '本次已确认无视觉义务，UI 越界仍由写集门禁检查。' : `project_profile=${ctx.resolvedProfile.name} 未启用 coding.visual_parity`,
      });
    } else {
      results.push(...executeCheck(ctx, () => dispatchCodingVisualParity(ctx), 'visual_parity', { failClosed: true }));
    }

    // --- Traceability checks ---
    results.push(...executeCheck(ctx, () => checkDesignToCode(ctx), 'plan_to_code'));
    results.push(
      ...executeCheck(ctx, () => host.runTraceabilityChecks(ctx), 'profile_coding_host_trace'),
    );
    results.push(...executeCheck(ctx, () => checkDiffWithinScope(ctx), 'diff_within_scope'));
    results.push(...executeCheck(ctx, () => checkCodingExistingTestPreserved(ctx), 'coding_existing_test_preserved'));
    // c4e8b1d3 G1：实际 UI 边界核对（正式契约身份 + 原需求 + diff 基线）
    results.push(...executeCheck(ctx, () => checkUiDiffWithinDeclaredFiles(ctx), 'ui_diff_within_declared_files'));
    // （v23 D2）required_anchors 通道已删：spec 侧从无生产者（schema/模板都没有），该检查
    // 永久 SKIP 只制造"已覆盖"错觉。锚点缺失如今作为 testing 的 actionable 缺陷回 coding 修。

    // --- goal-fakepass-hardening t3：产品行为开关扫描（coding 期早警，与 testing 同门禁）---
    results.push(
      ...executeCheck(ctx,
        () => buildBehaviorSwitchCheckResult({ projectRoot: ctx.projectRoot, feature: ctx.feature, phase: 'coding' }),
        'product_behavior_switch_scan',
      ),
    );

    // t9 Resource 模板串插值 lint 实现于 hmos profile coding host（runStructureChecks），
    // 根级 checker 保持宿主中性（root-zero-host-name 元测试约束）。

    results.push(buildCodingRunStatusResult(ctx, results));

    return results;
  },
};


/**
 * S6（visual-capability-truth P1-G）：宿主入口可达性——以 integration_points 为真源，
 * 静态验证 consumer 模块源码已实际消费 provider 入口符号（页面孤岛在 review 前暴露，
 * 不等真机 TC-001 才发现入口不可达；20260718 事故的入口是 testing 期现修的）。
 */
export function checkHostEntryReachability(ctx: CheckContext): CheckResult[] {
  const id = 'host_entry_reachability';
  const description = '宿主入口→路由→页面静态可达性（integration_points 为真源）';
  const contracts = ctx.featureSpec.contracts;
  const points = contracts?.integration_points ?? [];
  if (points.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MINOR', status: 'SKIP',
      details: 'contracts.integration_points 未声明——入口可达性无从机器校验。',
    }];
  }
  const missing: string[] = [];
  for (const p of points) {
    if (!p.entry_symbol) continue;
    if (!probeConsumerBinding(ctx.projectRoot, contracts!, p.consumer_module, p.entry_symbol)) {
      missing.push(
        `${p.consumer_module}→${p.provider_module}：consumer 源码未发现「${p.entry_symbol}」消费——` +
        (p.requires_modification ? '本 feature 声明要改 consumer 接入，coding 期须完成' : '声明的零修改接入点不实存'),
      );
    }
  }
  const undefinedEntries = points.filter(point => !point.entry_symbol);
  if (undefinedEntries.length > 0 || missing.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      ...(undefinedEntries.length ? { repair_owner: 'plan' as const, affected_files: [relFeatureArtifact(ctx.projectRoot, ctx.feature, 'contracts.yaml')] } : {}),
      details: undefinedEntries.length
        ? `入口定义缺失，尚不能判定产品可达性：${undefinedEntries.map(p => `${p.consumer_module}→${p.provider_module}`).join('、')} 缺 entry_symbol。`
        : [
        '【入口不可达】feature 页面存在但宿主入口链未接通（页面孤岛——真机测试必然全链失败）：',
        ...missing.map(m => `  - ${m}`),
      ].join('\n'),
      suggestion: undefinedEntries.length
        ? '交 plan 补齐 integration_points 的消费符号并核对零修改绑定，再返回 coding 验证实现；继承设计冲突由设计 owner 修订。'
        : '在 consumer 模块补路由注册/入口消费（in_scope 内），或修正 integration_points 声明后重跑。',
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'BLOCKER', status: 'PASS',
    details: `integration_points ${points.length} 条入口消费全部实存。`,
  }];
}

export default checker;
