// ============================================================================
// exit 阶段（lite track）— 一次性出口门禁（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// lite 的唯一检查点，一次跑齐：
//   - change.md 验收/任务 checkbox 全勾（BLOCKER）+ scope 声明可用（BLOCKER）
//   - 编译：复用 profile coding host 的 checkCodingCompile（与 coding 同源）
//   - diff_within_scope：红线（决策 4 任何档位不豁免）。分类核心与 full 轨共用
//     scripts/utils/diff-scope.ts；scope 来自 change.md，模块→路径映射走
//     contracts → catalog entry_file → 层目录存在性 三级回退。一切不可判状态
//     （scope 不可解析 / git 不可用 / 越界）一律 BLOCKER FAIL——exit 无 run_status
//     聚合、报告裁决只看 BLOCKER FAIL，SKIP 会放行，故 fail-closed 用 FAIL 承载。
//   - lint：派发 profile coding host 可选 checkCodingLint；无 provider → MAJOR WARN
//     可见缺项（终态语义：宿主未声明 lint 工具链是合法形态，不阻断闭环）。
//   - 条件 UT：验收清单存在 `[unit]` 标记条目（lite 对 full 轨 acceptance
//     ut_layer∈{unit,both} 的镜像约定）时，经 ut-host-impl 运行 UT；无标记不强制。
// ============================================================================

import * as fs from 'fs';
import type { PhaseChecker, CheckContext, CheckResult, ContractsSpec } from './utils/types';
import { isCapabilitySkipped } from '../capability-registry';
import { tryLoadProfileCodingHost, tryLoadUtHostImpl } from '../profile-host-loader';
import { changeDocPath, parseChangeDoc, type ParsedChangeDoc } from './check-change';
import { diffChangedFiles, analyzeDiffStaleness } from './utils/git-diff';
import {
  classifyChangedFiles,
  layerDirPrefixes,
  resolveModulePathPrefixes,
  type ModulePrefixResolution,
} from './utils/diff-scope';
import { relFeaturesDir } from '../config';
import { checkFactsArtifact } from './utils/context-facts';

// --------------------------------------------------------------------------
// [unit] 条目约定
// --------------------------------------------------------------------------

const UNIT_MARKER = /\[unit\]/i;

/**
 * 验收清单中带 `[unit]` 标记的条目。lite 无 acceptance.yaml，以文本标记镜像
 * full 轨的 ut_layer ∈ {unit, both} 语义；标记可出现在条目文本任意位置
 * （宽匹配偏 fail-closed：多触发 UT 优于漏触发）。
 */
export function unitAcceptanceEntries(
  doc: ParsedChangeDoc,
): Array<{ checked: boolean; text: string }> {
  return doc.acceptance.filter((c) => UNIT_MARKER.test(c.text));
}

function truncateList(items: string[], max: number): string {
  const shown = items.slice(0, max).map((i) => `  - ${i}`).join('\n');
  return items.length > max ? `${shown}\n  ... 还有 ${items.length - max} 项` : shown;
}

// --------------------------------------------------------------------------
// diff_within_scope（红线）
// --------------------------------------------------------------------------

function checkExitDiffWithinScope(ctx: CheckContext, doc: ParsedChangeDoc): CheckResult {
  const base = {
    id: 'exit_diff_within_scope',
    category: 'traceability' as const,
    description: 'diff 越界防护（红线恒不豁免）——变更须落在 change.md 声明的 in_scope 模块内',
    severity: 'BLOCKER' as const,
  };

  if (!doc.scope) {
    return {
      ...base,
      status: 'FAIL',
      details: `change.md Scope 不可解析，红线无判据（fail-closed）：${doc.scopeError ?? '未知错误'}`,
      suggestion: '先修复 change.md 的 Scope yaml 块（in_scope_modules 非空）并通过 change 门禁。',
    };
  }

  const resolution = resolveModulePathPrefixes(
    ctx.projectRoot,
    doc.scope.in_scope_modules,
    ctx.featureSpec.contracts?.modules,
  );

  const envRef = (process.env.HARNESS_DIFF_BASE_REF ?? '').trim();
  const diff = diffChangedFiles({ projectRoot: ctx.projectRoot, baseRef: envRef || undefined });
  if (!diff.executed) {
    return {
      ...base,
      status: 'FAIL',
      details: `无法执行 git diff：${diff.error ?? '未知错误'}（红线 fail-closed，不放行）`,
      suggestion:
        '确认项目根为 git 仓库且 git 可用。未设置时默认仅统计工作区相对 HEAD 的变更（等价 working）；若需包含已提交差异，请设置 HARNESS_DIFF_BASE_REF（如 HEAD~1、main 或具体 SHA）。',
    };
  }

  const cls = classifyChangedFiles(
    diff.changedFiles,
    resolution.allowedPrefixes,
    layerDirPrefixes(ctx.projectRoot),
  );
  const modeStr = `base=${diff.baseRef}, mode=${diff.workingOnly ? 'working-only' : 'committed+working'}`;
  const unmappedNote =
    resolution.unmapped.length > 0
      ? `\n注意：in_scope 模块 ${resolution.unmapped.join('、')} 无法映射路径前缀` +
        '（contracts / catalog entry_file / 层目录存在性 三级回退均未命中）——' +
        '若其下改动被误判越界，请补 module-catalog 的 entry_file 或在 feature 下维护 contracts.yaml。'
      : '';

  if (cls.violations.length === 0) {
    return {
      ...base,
      status: 'PASS',
      details:
        `git diff（${modeStr}）共 ${diff.changedFiles.length} 个变更文件：` +
        `${cls.inScopeHits.length} 个在 in_scope 模块内，${cls.neutralCount} 个为框架性/文档等中性变更` +
        `（\`${relFeaturesDir(ctx.projectRoot)}/**\` 过程产物计入中性），0 个越界。\n` +
        `变更拆分：committed=${diff.committedFiles.length}, working=${diff.workingTreeFiles.length}, staged=${diff.stagedFiles.length}, untracked=${diff.untrackedFiles.length}` +
        unmappedNote,
    };
  }

  const staleness = analyzeDiffStaleness(diff);
  const staleHint = staleness.stale
    ? '\n\n诊断：stale_diff_base。你显式指定的 baseRef 导致 committed 历史差异远多于当前工作区差异。若只想约束未提交改动，请去掉 HARNESS_DIFF_BASE_REF（默认即 working）；若仍要对提交做 scope，请收窄 baseRef 或合并/整理提交后再跑。'
    : '';

  return {
    ...base,
    status: 'FAIL',
    details:
      `${cls.violations.length} 个变更文件越界到 in_scope_modules 之外的模块：\n${truncateList(cls.violations, 15)}\n\n` +
      `in_scope_modules: ${doc.scope.in_scope_modules.join('、')}\n` +
      `base ref: ${diff.baseRef}（mode=${diff.workingOnly ? 'working-only' : 'committed+working'}）\n` +
      `变更拆分：committed=${diff.committedFiles.length}, working=${diff.workingTreeFiles.length}, staged=${diff.stagedFiles.length}, untracked=${diff.untrackedFiles.length}` +
      unmappedNote +
      staleHint,
    suggestion: staleness.stale
      ? '可先重跑不传 HARNESS_DIFF_BASE_REF（默认 working）；或显式设 HARNESS_DIFF_BASE_REF=working。若仍越界再走 scope 扩展或撤销误改。'
      : '若这些改动确属本需求必须：属跨模块信号，按中途升档机制确认（升 full 或经用户同意扩 in_scope_modules 后重过 change 门禁）。\n若属误改：用 `git checkout` / `git restore` 撤销越界文件。',
    affected_files: cls.violations,
    failure_kind: staleness.stale ? 'stale_diff_base' : 'scope_violation',
    blocking_class: staleness.stale ? 'stale_diff_base' : 'diff_within_scope',
  };
}

// --------------------------------------------------------------------------
// lint（profile provider 派发）
// --------------------------------------------------------------------------

async function checkExitLint(ctx: CheckContext): Promise<CheckResult[]> {
  if (isCapabilitySkipped(ctx.resolvedProfile, 'coding.lint')) {
    return [{
      id: 'exit_lint',
      category: 'traceability',
      description: 'lint 检查（profile 声明 SKIP coding.lint）',
      severity: 'MINOR',
      status: 'PASS',
      details: 'capability SKIP：按 profile 声明跳过。',
    }];
  }
  const host = tryLoadProfileCodingHost(ctx.resolvedProfile.profileDir);
  if (!host || typeof host.checkCodingLint !== 'function') {
    return [{
      id: 'exit_lint',
      category: 'traceability',
      description: 'lint 检查（派发 profile coding host 可选 checkCodingLint）',
      severity: 'MAJOR',
      status: 'WARN',
      details:
        '宿主 profile 未提供 coding-host-rules.checkCodingLint——lint 属可见缺项，不阻断 lite 闭环。' +
        '如需 lint 门禁，请在 profile 实现 checkCodingLint 或声明 capability coding.lint 为 SKIP。',
    }];
  }
  try {
    const lintResults = await host.checkCodingLint(ctx);
    return lintResults.map((r) => ({ ...r, id: r.id.startsWith('exit_') ? r.id : `exit_${r.id}` }));
  } catch (err) {
    return [{
      id: 'exit_lint',
      category: 'traceability',
      description: 'lint 检查执行失败',
      severity: 'MAJOR',
      status: 'FAIL',
      details: (err as Error).message,
    }];
  }
}

// --------------------------------------------------------------------------
// 条件 UT（验收清单含 [unit] 条目时）
// --------------------------------------------------------------------------

/** 以 change.md scope 解析出的模块路径合成 contracts 视图（ut-host-impl 的既有输入形状） */
function syntheticContractsView(
  ctx: CheckContext,
  resolution: ModulePrefixResolution,
): ContractsSpec {
  const existing = ctx.featureSpec.contracts;
  const modules = [...resolution.prefixByModule.entries()].map(([name, prefix]) => ({
    name,
    layer: '',
    format: '',
    change_type: 'modify',
    package_path: prefix.replace(/\/+$/, ''),
  }));
  return {
    feature: ctx.feature,
    source: 'change.md（lite 合成视图）',
    version: '0',
    module_dependencies: {},
    data_models: [],
    interfaces: [],
    components: [],
    files: [],
    ...(existing ?? {}),
    // modules 恒以 in_scope 解析结果为准（UT 检索只覆盖声明范围内的模块）
    modules,
  };
}

async function checkExitConditionalUt(
  ctx: CheckContext,
  doc: ParsedChangeDoc,
): Promise<CheckResult[]> {
  const unitEntries = unitAcceptanceEntries(doc);
  if (unitEntries.length === 0) {
    return [{
      id: 'exit_ut',
      category: 'structure',
      description: '条件 UT（验收清单含 [unit] 条目时强制）',
      severity: 'MINOR',
      status: 'PASS',
      details: '不适用：验收清单无 [unit] 标记条目（lite 约定：unit 层验收以 `[unit]` 前缀/标记声明）。',
    }];
  }

  if (isCapabilitySkipped(ctx.resolvedProfile, 'ut.run')) {
    return [{
      id: 'exit_ut',
      category: 'structure',
      description: `条件 UT（${unitEntries.length} 条 [unit] 验收；profile 声明 SKIP ut.run）`,
      severity: 'MINOR',
      status: 'PASS',
      details: 'capability SKIP：按 profile 声明跳过（与 ut 阶段同语义）。',
    }];
  }

  if (!doc.scope) {
    return [{
      id: 'exit_ut',
      category: 'structure',
      description: '条件 UT（验收清单含 [unit] 条目时强制）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'change.md Scope 不可解析，无法定位 UT 所属模块（fail-closed）。',
    }];
  }

  const resolution = resolveModulePathPrefixes(
    ctx.projectRoot,
    doc.scope.in_scope_modules,
    ctx.featureSpec.contracts?.modules,
  );
  if (resolution.allowedPrefixes.length === 0) {
    return [{
      id: 'exit_ut',
      category: 'structure',
      description: '条件 UT（验收清单含 [unit] 条目时强制）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `验收清单声明了 ${unitEntries.length} 条 [unit] 条目，但 in_scope 模块均无法映射路径前缀` +
        `（unmapped: ${resolution.unmapped.join('、')}），无法定位 UT 文件（fail-closed）。`,
      suggestion: '补 module-catalog 的 entry_file 或在 feature 下维护 contracts.yaml 的 package_path。',
    }];
  }

  const utHost = tryLoadUtHostImpl(ctx.resolvedProfile.profileDir);
  if (!utHost) {
    return [{
      id: 'exit_ut',
      category: 'structure',
      description: '条件 UT（验收清单含 [unit] 条目时强制）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `验收清单声明了 ${unitEntries.length} 条 [unit] 条目，但宿主 profile 未提供 ut-host-impl，` +
        'UT 无法执行（fail-closed；若宿主确无 UT 工具链，请声明 capability ut.run 为 SKIP）。',
    }];
  }

  try {
    const syntheticCtx: CheckContext = {
      ...ctx,
      featureSpec: {
        ...ctx.featureSpec,
        contracts: syntheticContractsView(ctx, resolution),
      },
    };
    const utFiles = utHost.loadUtFiles(syntheticCtx);
    if (utFiles.length === 0) {
      return [{
        id: 'exit_ut',
        category: 'structure',
        description: '条件 UT（验收清单含 [unit] 条目时强制）',
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `验收清单声明了 ${unitEntries.length} 条 [unit] 条目，但 in_scope 模块下未找到任何 UT 文件。\n` +
          `检索前缀：${resolution.allowedPrefixes.join('、')}`,
        suggestion: '为 [unit] 验收条目补对应 UT，或确认条目不属 unit 层后去掉 [unit] 标记。',
      }];
    }
    const runResults = await utHost.checkUtHvigorTest(syntheticCtx, utFiles);
    return runResults.map((r) => ({ ...r, id: r.id.startsWith('exit_') ? r.id : `exit_${r.id}` }));
  } catch (err) {
    return [{
      id: 'exit_ut',
      category: 'structure',
      description: '条件 UT 执行失败',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: (err as Error).message,
    }];
  }
}

// --------------------------------------------------------------------------
// Checker
// --------------------------------------------------------------------------

export const checker: PhaseChecker = {
  phase: 'exit',
  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const abs = changeDocPath(ctx.projectRoot, ctx.feature);

    if (!fs.existsSync(abs)) {
      results.push({
        id: 'exit_change_doc_present',
        category: 'structure',
        description: 'exit 门禁以 change.md 为闭环判据，文件必须存在',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `未找到 ${abs}；请先完成 change 阶段`,
      });
      return results;
    }

    const doc = parseChangeDoc(fs.readFileSync(abs, 'utf-8'));

    // 1) 验收清单 + 任务 checkbox 全勾（lite 闭环态的核心判据；C2 起 closure 读本结果）
    const unchecked = [
      ...doc.acceptance.filter((c) => !c.checked).map((c) => `验收：${c.text}`),
      ...doc.tasks.filter((c) => !c.checked).map((c) => `任务：${c.text}`),
    ];
    const total = doc.acceptance.length + doc.tasks.length;
    results.push({
      id: 'exit_checkboxes_all_checked',
      category: 'structure',
      description: 'change.md 验收清单与任务 checkbox 必须全部为 [x]',
      severity: 'BLOCKER',
      status: total > 0 && unchecked.length === 0 ? 'PASS' : 'FAIL',
      details:
        total === 0
          ? 'change.md 没有任何 checkbox 条目（先过 change 阶段门禁）'
          : unchecked.length === 0
            ? `${total} 项全部勾选`
            : `未勾选 ${unchecked.length}/${total}：\n${unchecked.slice(0, 10).join('\n')}`,
    });

    // 2) scope 声明可用（diff 越界防护的判据来源）
    results.push({
      id: 'exit_scope_declared',
      category: 'traceability',
      description: 'change.md Scope 的 in_scope_modules 须可解析（越界防护判据来源）',
      severity: 'BLOCKER',
      status: doc.scope ? 'PASS' : 'FAIL',
      details: doc.scope ? `in_scope=${doc.scope.in_scope_modules.join(', ')}` : doc.scopeError ?? '',
    });

    // 3) 编译（复用 coding host——与 full track 同一实现与失败归因）
    if (isCapabilitySkipped(ctx.resolvedProfile, 'coding.compile')) {
      results.push({
        id: 'exit_compile',
        category: 'structure',
        description: '编译检查（profile 声明 SKIP coding.compile）',
        severity: 'MINOR',
        status: 'PASS',
        details: 'capability SKIP：按 profile 声明跳过（与 coding 阶段同语义）',
      });
    } else {
      const host = tryLoadProfileCodingHost(ctx.resolvedProfile.profileDir);
      if (!host || typeof host.checkCodingCompile !== 'function') {
        results.push({
          id: 'exit_compile',
          category: 'structure',
          description: '编译检查（复用 profile coding host）',
          severity: 'BLOCKER',
          status: 'FAIL',
          details: '宿主 profile 未提供 coding-host-rules.checkCodingCompile；exit 无法验证可编译性',
        });
      } else {
        try {
          const compileResults = await host.checkCodingCompile(ctx);
          for (const r of compileResults) {
            results.push({ ...r, id: r.id.startsWith('exit_') ? r.id : `exit_${r.id}` });
          }
        } catch (err) {
          results.push({
            id: 'exit_compile',
            category: 'structure',
            description: '编译检查执行失败',
            severity: 'BLOCKER',
            status: 'FAIL',
            details: (err as Error).message,
          });
        }
      }
    }

    // 4) diff_within_scope —— 红线（决策 4：任何档位不豁免）
    results.push(checkExitDiffWithinScope(ctx, doc));

    // 5) lint —— profile provider 派发（无 provider 为 MAJOR WARN 可见缺项）
    results.push(...(await checkExitLint(ctx)));

    // 6) 条件 UT —— 验收清单含 [unit] 条目时强制
    results.push(...(await checkExitConditionalUt(ctx, doc)));

    // 7) Context Facts Gate —— facts.md 本阶段 phase_delta 节（C4，delta 阶段，非建立阶段）
    results.push(
      ...checkFactsArtifact(ctx.projectRoot, ctx.feature, 'exit', {
        phaseRule: ctx.phaseRule,
        profileName: ctx.resolvedProfile.name,
        frameworkRoot: ctx.frameworkRoot,
      }),
    );

    return results;
  },
};

export default checker;
