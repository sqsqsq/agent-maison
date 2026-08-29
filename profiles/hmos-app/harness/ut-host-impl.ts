/**
 * hmos-app：UT 阶段与宿主测试目录、Hypium、hvigor、hdc 相关的实现（根 check-ut 仅编排）。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { UtHostImpl } from '../../../harness/profile-host-loader';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { compileTestFiles } from '../../../harness/scripts/utils/ts-compile';
import { renderDetailsWithTelemetry } from '../../../harness/scripts/utils/check-telemetry';
import { findFilesRecursive } from '../../../harness/scripts/utils/find-files-recursive';
import {
  isCapabilitySkipped,
  CANONICAL_UT_COMPILE_ID,
  LEGACY_UT_COMPILE_ID,
  CANONICAL_UT_RUN_ID,
  LEGACY_UT_RUN_ID,
  dispatchUtCompile,
  dispatchUtRun,
  probeUtRunDevices,
  analyzeProjectDependencyIssueViaProfile,
  mergeUtCompileLogForClassification,
  looksLikeUtCompileCommandMismatch,
} from '../../../harness/capability-registry';
import { isSuiteEntryShimContent } from '../../../harness/ut-suite-entry-shim';
import { partitionUtFiles } from './ut-file-scope';
import {
  buildUtInstallBlockingCheckDetails,
  diagnoseInstallBlocking,
  mapInstallBlockingToUtCheckFields,
  writeUtInstallDiagJson,
} from './device-install-diag';
import { formatPollutionDisplayPath } from '../../../harness/scripts/utils/harness-path-guard';
import {
  hasDependencyResolutionFailure as hasDepResolutionFailureSignal,
  detectHvigorTaskNotFound,
  isHvigorBuildSuccessful,
  moduleDeclaresOhosTestTarget,
} from './hvigor-runner';
import {
  resolveProductSelection,
  describeProductSelection,
  buildProductSelectionUnresolvedGuidance,
  summarizeUnresolvedCause,
  type ProductSelection,
} from './product-selection';
import {
  buildUtHvigorTestFailDetails,
  type UtHvigorTestFailureModule,
} from './ut-hvigor-test-failure';
import {
  evaluateSuiteRatchet,
  suiteFailureKey,
  targetCaseKey,
} from '../../../harness/scripts/utils/ut-suite-baseline';

const HARNESS_ROOT = path.resolve(__dirname, '../../../harness');

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

function checkUtFileNaming(
  ctx: CheckContext,
  utFiles: Array<{ path: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [
      {
        id: 'ut_file_naming',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_file_naming'),
        severity: 'MAJOR',
        status: 'SKIP',
        details: '未找到 UT 文件。',
      },
    ];
  }

  const badNames: string[] = [];
  for (const { path: utPath } of utFiles) {
    const basename = path.basename(utPath);
    if (!basename.endsWith('.test.ets')) {
      badNames.push(utPath);
    }
  }

  if (badNames.length === 0) {
    return [
      {
        id: 'ut_file_naming',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_file_naming'),
        severity: 'MAJOR',
        status: 'PASS',
        details: `全部 ${utFiles.length} 个 UT 文件命名规范（*.test.ets）。`,
      },
    ];
  }

  return [
    {
      id: 'ut_file_naming',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_file_naming'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${badNames.length} 个 UT 文件命名不规范：\n${truncateList(badNames, 10)}`,
      affected_files: badNames,
      suggestion: 'UT 文件应以 .test.ets 结尾。',
    },
  ];
}

// getUtSuggestionPaths 已退役（plan f4c8d2b7 t5）：模板路径统一解析自
// profiles/hmos-app/skills/skill-assets.yaml（framework/harness/scripts/utils/ut-template-paths.ts）。

function checkUtFrameworkImport(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [
      {
        id: 'ut_framework_import',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_framework_import'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '未找到 UT 文件。',
      },
    ];
  }

  const missingImport: string[] = [];
  const missingStructure: string[] = [];

  for (const { path: utPath, content } of utFiles) {
    if (isSuiteEntryShimContent(content)) continue;
    if (!content.includes('@ohos/hypium')) {
      missingImport.push(utPath);
    }
    if (!content.includes('describe(') || !content.includes('it(')) {
      missingStructure.push(utPath);
    }
  }

  const issues: string[] = [];
  if (missingImport.length > 0) {
    issues.push(
      `${missingImport.length} 个文件缺少 @ohos/hypium 导入：\n${truncateList(missingImport, 5)}`,
    );
  }
  if (missingStructure.length > 0) {
    issues.push(
      `${missingStructure.length} 个文件缺少 describe/it 测试结构：\n${truncateList(missingStructure, 5)}`,
    );
  }

  if (issues.length === 0) {
    return [
      {
        id: 'ut_framework_import',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_framework_import'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `全部 ${utFiles.length} 个 UT 文件正确导入测试框架。`,
      },
    ];
  }

  return [
    {
      id: 'ut_framework_import',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_framework_import'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: issues.join('\n'),
      affected_files: [...new Set([...missingImport, ...missingStructure])],
      suggestion: "UT 文件必须 import { describe, it, expect } from '@ohos/hypium' 并使用 describe/it 结构。",
    },
  ];
}

function checkUtTscCompiles(
  ctx: CheckContext,
  utFiles: Array<{ path: string; content: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [
      {
        id: 'ut_tsc_compiles',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_tsc_compiles'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '未找到 UT 文件。',
      },
    ];
  }

  const absPaths = utFiles.map(f => path.join(ctx.projectRoot, f.path));
  const report = compileTestFiles(absPaths, ctx.projectRoot);

  if (report.diagnostics.length === 0) {
    return [
      {
        id: 'ut_tsc_compiles',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_tsc_compiles'),
        severity: 'BLOCKER',
        status: 'PASS',
        // 耗时是 runner 遥测：人读留着，subject 派生看 details_material（review 三轮 P1-2）
        ...renderDetailsWithTelemetry(
          (t) => `${utFiles.length} 个 UT 文件 tsc --noEmit 通过（耗时 ${t}）。`,
          `${report.durationMs} ms`,
        ),
      },
    ];
  }

  const groupedByFile = new Map<string, number>();
  for (const d of report.diagnostics) {
    groupedByFile.set(d.file, (groupedByFile.get(d.file) ?? 0) + 1);
  }

  const preview = report.diagnostics
    .slice(0, 30)
    .map(d => `${d.file}:${d.line}:${d.column}  ${d.code}  ${d.message}`);
  const summaryByFile = Array.from(groupedByFile.entries())
    .map(([f, n]) => `${f}: ${n} 条`)
    .slice(0, 10);

  // plan 423e5d0f P0-1：模拟 tsc 永不做编译 BLOCKER——权威性排序=真实 hvigor > 模拟 tsc
  // （R2 实锤：存量 Main.test.ets 被裸 tsc 判 TS2749，同一文件真实 hvigor 编译 PASS）。
  // 唯一编译 BLOCKER 是 ut_hvigor_build 真实编译；tsc 保留为快速诊断（WARN）。
  // 例外护栏：profile 把 ut.compile 声明为 SKIP 时，tsc 是仅存的编译门禁，不降级。
  const realCompileSkipped = isCapabilitySkipped(ctx.resolvedProfile, 'ut.compile');

  return [
    {
      id: 'ut_tsc_compiles',
      category: 'structure',
      severity: 'BLOCKER',
      description: ruleDesc(ctx, 'structure_checks', 'ut_tsc_compiles'),
      status: realCompileSkipped ? 'FAIL' : 'WARN',
      ...renderDetailsWithTelemetry(
        (t) =>
          `${groupedByFile.size} 个 UT 文件共 ${report.diagnostics.length} 条 TypeScript Error（耗时 ${t}）。\n` +
          `按文件：\n${summaryByFile.join('\n')}\n\n` +
          `前 ${preview.length} 条诊断：\n${preview.join('\n')}\n\n` +
          (realCompileSkipped
            ? '注意：ut.compile 已被 profile 声明 SKIP，模拟 tsc 是仅存的编译门禁——本结果保持 FAIL，不降级。'
            : '口径：模拟 tsc 仅作快速诊断（WARN），编译通过与否以 ut_hvigor_build 真实编译为准；' +
              '报错落在存量文件且真实编译 PASS 时属模拟器假错，不要为此修改存量代码。'),
        `${report.durationMs} ms`,
      ),
      affected_files: Array.from(groupedByFile.keys()),
      suggestion: realCompileSkipped
        ? 'ut.compile 为 SKIP：请按上方 TS 错误码修正 UT 代码后重跑；常见原因：(1) 符号未 import；(2) 调用签名不符；(3) 类型字面量错误。'
        : '新写 UT 的报错请按 TS 错误码修正（符号未 import / 签名不符 / 类型字面量错误）；' +
          '存量文件的报错以 ut_hvigor_build 真实编译结论为准，不要修改存量代码，也不要改消费者 framework 内 ts-compile.ts。',
    },
  ];
}

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
 * 在「发现的 ohosTest 模块」中，只保留拥有至少一个 *本需求 scoped* UT 文件的模块。
 * 判据不依赖模块类型（entry/har 等都可能是合法被测目标）；唯一信号是「该模块下是否有
 * 被 git 改动 / context-exploration 声明的 UT 文件」——即它是不是本需求的被测模块。
 * 某模块 ohosTest 仅含与本需求无关的模板测试时不在 scoped 内，故被排除，避免 framework
 * 去编译不属于本需求的模块、把整轮 UT 误判为失败。
 * 注意：scoped 为空（partitionUtFiles 走 fallback:all）时退回全集，等同旧行为。
 * 归属判断复用本文件 checkTestRegistration 的写法：f.path.includes(mod.package_path)。
 */
export function selectUtModulesToCompile(
  mods: Array<{ name: string; package_path: string }>,
  scopedUtFiles: Array<{ path: string }>,
): Array<{ name: string; package_path: string }> {
  if (scopedUtFiles.length === 0) return mods; // 无 scoped 信息 → 保持现状（不回归）
  const owned = mods.filter(m => scopedUtFiles.some(f => f.path.includes(m.package_path)));
  return owned.length > 0 ? owned : mods; // 兜底：筛空则退回全集
}

/**
 * 编译顺序（plan 423e5d0f P0）：含**本 feature 新增** UT 文件的模块排最前，其次含 scoped
 * 文件的模块，其余殿后——真实编译错误仍会短路循环，必须保证"报告能回答本 feature
 * 的被测模块过没过"，不能让顺带被触碰的存量模块把真目标模块挤出执行窗口。
 * 同一优先级内保持原有顺序（稳定排序）。
 */
export function orderUtModulesForCompile(
  mods: Array<{ name: string; package_path: string }>,
  scopedUtFiles: Array<{ path: string }>,
  featureNewUtFiles: Array<{ path: string }>,
): Array<{ name: string; package_path: string }> {
  const rank = (m: { package_path: string }): number => {
    if (featureNewUtFiles.some(f => f.path.includes(m.package_path))) return 0;
    if (scopedUtFiles.some(f => f.path.includes(m.package_path))) return 1;
    return 2;
  };
  return mods
    .map((m, i) => ({ m, i, r: rank(m) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map(x => x.m);
}

function checkUtHvigorBuild(
  ctx: CheckContext,
  scopedUtFiles: Array<{ path: string }> = [],
  featureNewUtFiles: Array<{ path: string }> = [],
): CheckResult[] {
  if (isCapabilitySkipped(ctx.resolvedProfile, 'ut.compile')) {
    const desc = ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build');
    const details =
      'project_profile 声明 ut.compile 为 SKIP：未调用 ohosTest hvigor assemble（canonical id: ut_compile）。';
    return [
      {
        id: LEGACY_UT_COMPILE_ID,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'SKIP',
        details,
      },
      {
        id: CANONICAL_UT_COMPILE_ID,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'SKIP',
        details,
      },
    ];
  }

  const mods = orderUtModulesForCompile(
    selectUtModulesToCompile(findModulesWithUt(ctx), scopedUtFiles),
    scopedUtFiles,
    featureNewUtFiles,
  );
  if (mods.length === 0) {
    return [
      {
        id: 'ut_hvigor_build',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: '未找到包含 src/ohosTest/ 目录的模块。UT 阶段必须有至少一个 ohosTest 模块。',
      },
    ];
  }

  // t5（plan a7c3f9e2）：本作用域内只解析一次，显式传给 ut 编译；unresolved 不猜、阻断。
  // env 显式跳过（HARNESS_SKIP_HVIGOR=1）时让位给既有 skip 语义（fixture 回归锁）。
  const selection = resolveProductSelection({ projectRoot: ctx.projectRoot, purpose: 'ut' });
  if (selection.source === 'unresolved' && !process.env.HARNESS_SKIP_HVIGOR) {
    return [
      {
        id: 'ut_hvigor_build',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `ut_hvigor_build：${summarizeUnresolvedCause(selection)}（framework 拒绝猜测）。\n` +
          buildProductSelectionUnresolvedGuidance(selection),
        failure_kind: 'project_build_environment_inconsistent',
        blocking_class: 'externalBlocked',
        suggestion:
          '编译形态未确认属外部/工程配置问题，不得通过改代码绕过。请按 details 指引确认 product 后重跑。',
      },
    ];
  }

  const perModule: Array<{ module: string; result: any; taskNotFound?: { task: string } }> = [];
  for (const mod of mods) {
    const res = dispatchUtCompile(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: HARNESS_ROOT,
      feature: ctx.feature,
      phase: 'ut',
      moduleName: mod.name,
      target: 'ohosTest',
      skipEnvVar: 'HARNESS_SKIP_HVIGOR',
      product: selection.product ?? undefined,
    });
    const entry: { module: string; result: any; taskNotFound?: { task: string } } = {
      module: mod.name,
      result: res,
    };
    if (res.executed && res.exitCode !== 0) {
      const tnf = detectHvigorTaskNotFound(mergeUtCompileLogForClassification(ctx, res));
      if (tnf) entry.taskNotFound = tnf;
    }
    perModule.push(entry);
    if (res.toolMissing || res.skippedByEnv) break; // 全局性问题：后续模块必然同因失败
    // task-not-found 是单模块的工程配置形态问题（plan 423e5d0f P0）：继续编译其余模块，
    // 保证报告能给出每个模块的事实；真实编译错误仍短路（修复靶点已明确，省时）。
    if (res.executed && res.exitCode !== 0 && !entry.taskNotFound) break;
  }

  const perModuleStatusLines = [
    '逐模块编译状态：',
    ...(selection ? [`${describeProductSelection(selection)}（单次解析，贯穿本门禁）`] : []),
    ...perModule.map(x => {
      const r = x.result;
      const st = r.toolMissing ? 'TOOL_MISSING'
        : r.skippedByEnv ? 'ENV_SKIP'
        : !r.executed ? 'NOT_EXECUTED'
        // plan a7c3f9e2（意见2 P1，第四处出口）：与 coding/device-testing 共用
        // isHvigorBuildSuccessful——errors[] 不参与终态（宿主非致命 ERROR 不误杀真成功）
        : isHvigorBuildSuccessful(r) ? 'PASS'
        : x.taskNotFound ? `FAIL（task_not_found: ${x.taskNotFound.task}）` : 'FAIL';
      return `  - ${x.module}: ${st}${r.logPath ? `（日志：${r.logPath}）` : ''}`;
    }),
    ...mods.slice(perModule.length).map(m => `  - ${m.name}: NOT_EXECUTED（前序失败短路）`),
  ];

  // plan a7c3f9e2（意见2 P1，第四处出口）：ut_hvigor_build 的 FAIL 判据与 coding /
  // device-testing 三处共用 isHvigorBuildSuccessful——toolMissing/skippedByEnv 时
  // executed=false 天然覆盖，timedOut 比原判据更严谨；errors.length 不再参与终态。
  const bad = perModule.filter(x => !isHvigorBuildSuccessful(x.result));

  if (bad.length === 0) {
    // plan d7e4b2a9 t3③：sign-skip 只做报告可见性，不改变 PASS 判定（编译本身成功，
    // 签名是否跳过由后续 ut_hvigor_test 装机环节实际暴露；此处不承担跨阶段传输，
    // signSkipped/signingConfigMissing 由 runHvigorTest 在同一函数内直传 hdc-runner）。
    const signSkipModules = perModule.filter(x => x.result.signSkipped).map(x => x.module);
    const signSkipNote = signSkipModules.length
      ? `\n⚠ ${signSkipModules.join(', ')} 编译日志命中 "Will skip sign"，产物暂为 unsigned；后续装机/自动化测试若失败请优先核对 signingConfigs。`
      : '';
    return [
      {
        id: 'ut_hvigor_build',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
        severity: 'BLOCKER',
        status: 'PASS',
        ...renderDetailsWithTelemetry(
          (t) =>
            `全部 ${perModule.length} 个 ohosTest 模块 hvigor 编译通过（累计耗时 ${t}）。${signSkipNote}\n` +
            perModuleStatusLines.join('\n'),
          `${perModule.reduce((s, x) => s + x.result.durationMs, 0)} ms`,
        ),
      },
    ];
  }

  // 详细展开优先选"真实编译失败"的模块；全是 task-not-found 时才展开该形态。
  const detailEntry = bad.find(x => !x.taskNotFound) ?? bad[0];
  const first = detailEntry.result;
  const lines: string[] = [...perModuleStatusLines, '', `ohosTest 模块 "${detailEntry.module}" 编译失败：`];
  const failureClass = classifyUtHvigorBuildFailure(first, ctx, detailEntry.module, ctx.projectRoot);
  if (first.toolMissing) {
    lines.push('原因：未找到 hvigor 可执行文件（请在 framework.local.json > toolchain.devEcoStudio 配置本机 DevEco 路径）。');
    first.logExcerpt.split(/\r?\n/).forEach((l: string) => lines.push(l));
    lines.push('本规则不允许 SKIP —— 真实编译是出口条件。');
  } else if (first.skippedByEnv) {
    lines.push('原因：HARNESS_SKIP_HVIGOR=1 已设置，显式跳过真实编译不被允许作为出口。');
  } else {
    lines.push(`exit_code=${first.exitCode}, durationMs=${first.durationMs}`);
    lines.push(`失败归因：${failureClass.kind}`);
    lines.push(`归因说明：${failureClass.explanation}`);
    lines.push(`日志落盘：${first.logPath ?? '(未落盘)'}`);
    lines.push(`实际命令：${first.command ?? '(无)'}`);
    if (first.metaPath) {
      const metaAbs = path.isAbsolute(first.metaPath)
        ? first.metaPath
        : path.resolve(process.cwd(), first.metaPath);
      if (fs.existsSync(metaAbs)) {
        try {
          const metaRaw = fs.readFileSync(metaAbs, 'utf-8');
          lines.push('hvigor meta（节选）：');
          lines.push(metaRaw.length > 4000 ? `${metaRaw.slice(0, 4000)}\n…` : metaRaw);
        } catch {
          /* best-effort */
        }
      }
    }
    if (first.errors.length > 0) {
      lines.push(`解析出 ${first.errors.length} 条 error（前 10 条）：`);
      first.errors
        .slice(0, 10)
        .forEach(
          (e: { file?: string; line?: number; code?: string; message: string }) =>
            lines.push(`  - ${e.file ?? ''}${e.line ? ':' + e.line : ''}  ${e.code ?? ''}  ${e.message}`),
        );
    }
    lines.push('');
    lines.push('日志尾部（最多 8 KB）：');
    lines.push(first.logExcerpt);
  }

  return [
    {
      id: 'ut_hvigor_build',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: lines.join('\n'),
      affected_files: bad.map(x => `${x.module}@ohosTest`),
      failure_kind: failureClass.kind,
      blocking_class:
        failureClass.kind === 'external_project_build_blocker'
          ? 'external'
          : failureClass.kind === 'project_dependency_missing'
            ? 'project_dependency_missing'
            : 'ut_hvigor_build',
      suggestion: failureClass.suggestion,
    },
  ];
}

type UtHvigorFailureKind =
  | 'toolchain'
  | 'env_skip'
  | 'ut_hvigor_command_mismatch'
  | 'ut_module_target_unregistered'
  | 'ut_code'
  | 'feature_code'
  | 'project_dependency_missing'
  | 'external_project_build_blocker'
  | 'build_config_invalid'
  | 'unknown';

/**
 * 纯函数：从 hvigor 合并日志识别「构建配置文件 schema 校验失败」（如 build-profile.json5
 * 的 target 里塞了非法字段）。命中返回可操作诊断，否则 null。抽出以便单测直接喂日志字符串。
 */
export function classifyConfigSchemaError(
  log: string,
): { kind: 'build_config_invalid'; explanation: string; suggestion: string } | null {
  const hasConfigSchemaError =
    /Schema validate failed|must be equal to one of the allowed values|property name '[^']+' is invalid/i.test(
      log,
    );
  if (!hasConfigSchemaError) return null;
  const configRef =
    /([^\s'"]*(?:build-profile|oh-package|module|app)\.json5(?::\d+(?::\d+)?)?)/i.exec(log);
  const where = configRef ? configRef[1] : '构建配置文件（build-profile.json5 / module.json5 等）';
  return {
    kind: 'build_config_invalid',
    explanation: `构建配置文件 schema 校验失败（${where}）：某字段非法或位置错误，hvigor 在编译前即拒绝，UT 未真实运行。`,
    suggestion:
      `定位 ${where} 的非法字段并修正；若该字段是本轮/前一轮为排障新增、反而把原本合法的配置改坏的，` +
      '优先回退到 trace.json.start_commit 的版本，而不是继续叠加改动。' +
      '提示：build-profile.json5 的 target 仅允许 name/config/source/resource/runtimeOS/output 字段。' +
      '该文件受源码改动门禁约束，确需修改须交回 coding owner 并重走 review→ut→testing。',
  };
}

function classifyUtHvigorBuildFailure(
  res: any,
  ctx: CheckContext,
  moduleName: string,
  projectRoot: string,
): { kind: UtHvigorFailureKind; explanation: string; suggestion: string } {
  if (res.toolMissing) {
    return {
      kind: 'toolchain',
      explanation: 'hvigor / DevEco 工具链不可用。',
      suggestion:
        '按 framework.local.json > toolchain.devEcoStudio.installPath 配置 DevEco Studio 路径后重跑。',
    };
  }
  if (res.skippedByEnv) {
    return {
      kind: 'env_skip',
      explanation: 'HARNESS_SKIP_HVIGOR=1 显式跳过真实编译。',
      suggestion: '取消 HARNESS_SKIP_HVIGOR 后重跑；真实编译是 UT 阶段出口条件。',
    };
  }

  const mergedLog = mergeUtCompileLogForClassification(ctx, res);

  // plan 423e5d0f P0：hvigor "Task ... was not found" = 工程构建配置形态问题（该模块未注册
  // 对应构建目标 / hvigor 版本差异），不是 UT 代码问题——归因给 build-profile targets，
  // 不按 module.json5 type 武断归因，也不引导 ohpm install / 改 UT。
  const taskNotFound = detectHvigorTaskNotFound(mergedLog);
  if (taskNotFound) {
    const probe = moduleDeclaresOhosTestTarget(projectRoot, moduleName);
    const probeNote =
      probe === false
        ? `工程根 build-profile.json5 的 modules[] 中模块 "${moduleName}" 的 targets 未含 ohosTest —— hvigor 因此不会为其挂载该 task（与日志现象一致）。`
        : probe === true
          ? `工程根 build-profile.json5 中模块 "${moduleName}" 已注册 ohosTest target，但 hvigor 仍未挂载该 task——多为 hvigor 版本/插件差异，需在 DevEco 对该模块实测 "Run ohosTest" 确认。`
          : `未能从工程根 build-profile.json5 读取模块 "${moduleName}" 的 targets（文件缺失/解析失败/模块未列出），请人工核对。`;
    return {
      kind: 'ut_module_target_unregistered',
      explanation:
        `hvigor 报 Task '${taskNotFound.task}' was not found：该模块当前构建配置下不存在此构建目标任务。` +
        `这是工程配置形态问题，不是 UT 代码问题。${probeNote}`,
      suggestion:
        `选项 A：在工程根 build-profile.json5 为模块 "${moduleName}" 的 targets 注册 ohosTest target（对照可正常 Run ohosTest 的模块写法），在 DevEco 实测通过后重跑；` +
        '选项 B：若该模块本不属于本需求被测范围（仅因存量测试文件被顺带触碰而进入编译集合），恢复对该文件的改动使其退出 scope，不要为过门禁修改无关模块配置。' +
        '注意：build-profile.json5 受源码改动门禁约束，确需修改须交回 coding owner 并重走 review→ut→testing。',
    };
  }

  if (looksLikeUtCompileCommandMismatch(ctx, mergedLog)) {
    return {
      kind: 'ut_hvigor_command_mismatch',
      explanation:
        'hvigor 日志/命令形态表明 ohosTest 构建未按 DevEco 默认打开（常见：isOhosTest=false、缺 --mode module、' +
        'buildMode 非 test 等），容易走进错误构建图并把问题误判成 ohpm 依赖缺失。',
      suggestion:
        '先核对 harness 报告中的「实际命令」与 DevEco「Run ohosTest」是否一致（见 harness-runbook UT hvigor 小节）。' +
        '在确认命令已对齐之前，不要优先执行 ohpm install / npm install / --clear-state；对齐后仍报 Failed to resolve OhmUrl 再按依赖路径处理。',
    };
  }

  const log = mergedLog;

  // 构建配置文件 schema 校验失败优先（hvigor 编译前即拒绝；常见为本轮/前一轮乱改配置导致）。
  const configSchema = classifyConfigSchemaError(log);
  if (configSchema) return configSchema;

  const depIssue = analyzeProjectDependencyIssueViaProfile(ctx, res);
  // 依赖解析失败判据收敛到 hvigor-runner 单一实现（防 coding/ut 内联正则漂移，根因 B）。
  const hasDependencyResolutionFailure = hasDepResolutionFailureSignal(log);
  const touchesOhosTest = /\/src\/ohosTest\/|\\src\\ohosTest\\/i.test(log);
  const touchesCurrentModuleMain = new RegExp(`${escapeRegExp(moduleName)}[/\\\\]src[/\\\\]main`, 'i').test(
    log,
  );

  if (depIssue.found && hasDependencyResolutionFailure && !touchesOhosTest) {
    return {
      kind: 'project_dependency_missing',
      explanation:
        'hvigor 日志显示工程依赖解析失败，当前失败更可能来自 ohpm/oh_modules/依赖声明或内网 registry，而不是 UT 代码本身。\n' +
        formatDependencyIssue(depIssue),
      suggestion:
        '不要把该问题交给用户手工猜。先向用户展示方案：A) 确认后在工程根执行 ohpm install 并重跑；' +
        'B) 仅读取 oh-package.json5 输出缺失依赖声明；C) registry/权限不确定时先确认内网源。' +
        (!depIssue.harnessNodeModulesReady
          ? ' framework/harness/node_modules 缺失时可直接在 framework/harness 执行 npm install。'
          : ''),
    };
  }

  if (hasDependencyResolutionFailure && !touchesOhosTest && !touchesCurrentModuleMain) {
    return {
      kind: 'external_project_build_blocker',
      explanation:
        '依赖解析失败发生在非 ohosTest / 非当前模块 src/main 的项目级或传递依赖链路中；当前 UT 尚未真实运行，且不应通过修改 UT 掩盖该问题。',
      suggestion:
        '先修复项目级依赖/构建问题，或在确认不是本轮 UT 引入后记录为外部阻塞并 clear-state；不要声称 UT 已通过。',
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
      explanation: '编译错误指向当前模块 src/main；该文件属于 coding owner，UT 不得修改或用用户回复放行。',
      suggestion: '先确认是否可通过 UT/Spy 调整规避；确需改 src/main 时产出 coding repair candidate，由 coding 修改后重走 review→ut。',
    };
  }

  return {
    kind: 'unknown',
    explanation: '无法仅凭日志判断错误归属。',
    suggestion:
      '读取完整日志（details 中 `日志落盘` 路径），定位文件/行；不要仅凭 ut_tsc_compiles PASS 宣称 UT 通过。',
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDependencyIssue(issue: any): string {
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
    issue.installHints.forEach((h: string) => lines.push(`  - ${h}`));
  }
  return lines.join('\n');
}

function checkUtHvigorTest(
  ctx: CheckContext,
  scopedUtFiles: Array<{ path: string }> = [],
  /** 责任域用例（含所属文件路径）——模块由 package_path 归属推导，构成 module::test 身份 */
  targetCases: Array<{ path: string; test: string }> = [],
): CheckResult[] {
  if (isCapabilitySkipped(ctx.resolvedProfile, 'ut.run')) {
    const desc = ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test');
    const details =
      'project_profile 声明 ut.run 为 SKIP：未执行 hdc/hvigor test（canonical id: ut_run）。';
    return [
      {
        id: LEGACY_UT_RUN_ID,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'SKIP',
        details,
      },
      {
        id: CANONICAL_UT_RUN_ID,
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'SKIP',
        details,
      },
    ];
  }

  if (process.env.HARNESS_SKIP_HVIGOR_TEST) {
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `HARNESS_SKIP_HVIGOR_TEST=${process.env.HARNESS_SKIP_HVIGOR_TEST} 已设置。` +
          `显式跳过 UT 实际装机运行**不被允许**作为出口条件。请去掉该环境变量并准备好真机/模拟器后重跑。`,
        suggestion: '取消 HARNESS_SKIP_HVIGOR_TEST 环境变量，启动模拟器或接入真机后重跑。',
      },
    ];
  }

  const mods = selectUtModulesToCompile(findModulesWithUt(ctx), scopedUtFiles);
  if (mods.length === 0) {
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: '未找到包含 src/ohosTest/ 目录的模块。UT 阶段必须有至少一个 ohosTest 模块。',
      },
    ];
  }

  // t5（plan a7c3f9e2）：ut.run 同样单次解析编译形态；unresolved 不猜、阻断。
  // env 显式跳过（HARNESS_SKIP_HVIGOR_TEST=1）时让位给既有 skip 语义（fixture 回归锁）。
  const selection = resolveProductSelection({ projectRoot: ctx.projectRoot, purpose: 'ut' });
  if (selection.source === 'unresolved' && !process.env.HARNESS_SKIP_HVIGOR_TEST) {
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `ut_hvigor_test：${summarizeUnresolvedCause(selection)}（framework 拒绝猜测）。\n` +
          buildProductSelectionUnresolvedGuidance(selection),
        failure_kind: 'project_build_environment_inconsistent',
        blocking_class: 'externalBlocked',
        suggestion:
          '编译形态未确认属外部/工程配置问题，不得通过改代码绕过。请按 details 指引确认 product 后重跑。',
      },
    ];
  }

  const devProbe = probeUtRunDevices(ctx);
  if (!devProbe.available) {
    const head = devProbe.hdcPresent
      ? `hdc list targets 返回空（原始输出：${devProbe.raw || '(空)'}）`
      : `未找到 hdc 工具：${devProbe.raw || '(无详细)'}`;
    const installDiag = diagnoseInstallBlocking(ctx.projectRoot);
    writeUtInstallDiagJson(ctx.projectRoot, ctx.feature, 'ut', ctx.frameworkRoot, installDiag);
    const meta = mapInstallBlockingToUtCheckFields(installDiag);
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `${head}\n\n${buildUtInstallBlockingCheckDetails(installDiag)}`,
        suggestion: meta.suggestion,
        failure_kind: meta.failure_kind,
        blocking_class: meta.blocking_class,
      },
    ];
  }

  const installDiag = diagnoseInstallBlocking(ctx.projectRoot);
  writeUtInstallDiagJson(ctx.projectRoot, ctx.feature, 'ut', ctx.frameworkRoot, installDiag);
  if (installDiag.kind !== 'clear') {
    const meta = mapInstallBlockingToUtCheckFields(installDiag);
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: buildUtInstallBlockingCheckDetails(installDiag),
        suggestion: meta.suggestion,
        failure_kind: meta.failure_kind,
        blocking_class: meta.blocking_class,
      },
    ];
  }

  // plan 423e5d0f P1-2（codex 修正）：**用例失败不短路**——棘轮裁决需要全部选中模块的
  // 完整结果（半途 PASS=假绿）；只有链路级失败（工具缺失/未执行/无测试结果的异常退出）
  // 才短路（后续模块大概率同因失败，且修复靶点已明确）。
  const perModule: UtHvigorTestFailureModule[] = [];
  for (const mod of mods) {
    const res = dispatchUtRun(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: HARNESS_ROOT,
      feature: ctx.feature,
      phase: 'ut',
      moduleName: mod.name,
      moduleSrcPath: mod.package_path,
      product: selection.product ?? undefined,
    });
    perModule.push({ module: mod.name, result: res });
    const caseLevelFailure = res.executed && !!res.testResult && (res.testResult.total ?? 0) > 0;
    if (res.toolMissing || (!caseLevelFailure && (!res.executed || res.exitCode !== 0))) {
      break;
    }
  }
  const allModulesExecuted =
    perModule.length === mods.length &&
    perModule.every(x => x.result.executed && x.result.testResult);

  // suite 失败棘轮：基线是 attended suite 输入工件（不授权源码改动或质量 PASS；
  // 同级——普通授权文件+review 纪律，不做密码学防伪，见顶层裁定），本轮执行不生成；
  // 无基线 → 不豁免任何失败（suite_health=UNKNOWN）。失败身份含 module（跨模块同名不互豁免）。
  const allFailures = perModule.flatMap(x =>
    (x.result.testResult?.failures ?? []).map((f: { suite: string; test: string }) => ({
      module: x.module,
      suite: f.suite,
      test: f.test,
    })),
  );
  const anyRealResult = perModule.some(x => x.result.executed && x.result.testResult);
  // target 身份含模块（codex 五轮 #2）：模块 A 的目标用例名不得把模块 B 的同名历史失败
  // 也标成 target——否则那条无关存量失败无法按基线豁免，又回到"存量拖死当前修复"。
  const targetKeys = new Set(
    targetCases.flatMap(c => {
      const owner = mods.find(m => c.path.includes(m.package_path));
      return owner ? [targetCaseKey(owner.name, c.test)] : mods.map(m => targetCaseKey(m.name, c.test));
    }),
  );
  // 只有"真实跑出用例结果（total>0）"的模块才有资格证明其历史失败已恢复；
  // executed 但 total=0（未跑到任何用例）不算（codex 六轮 #1）。
  const modulesWithValidResults = new Set(
    perModule
      .filter(x => x.result.executed && (x.result.testResult?.total ?? 0) > 0)
      .map(x => x.module),
  );
  const ratchet = anyRealResult
    ? evaluateSuiteRatchet({
        projectRoot: ctx.projectRoot,
        feature: ctx.feature,
        frameworkRoot: ctx.frameworkRoot,
        failures: allFailures,
        targetKeys,
        modulesWithValidResults,
      })
    : null;
  const suiteHealthLine = `suite_health: ${ratchet ? ratchet.suiteHealth : 'UNKNOWN'}`;
  const ratchetNote = ratchet && ratchet.baselineExempt.length > 0
    ? `\n${suiteHealthLine}（${ratchet.baselineExempt.length} 条基线内历史失败已豁免，不计入本 feature 结论${
        ratchet.baselineTightenedTo !== undefined ? `；基线已自动收紧至 ${ratchet.baselineTightenedTo} 条` : ''
      }）：\n` +
      ratchet.baselineExempt.slice(0, 10).map(f => `  - [${f.suite}] ${f.test}`).join('\n')
    : ratchet && !ratchet.baselineAvailable && allFailures.length > 0
      ? `\n${suiteHealthLine}（无可信 suite 失败基线：全部失败照常问责。如存量套件确有已知历史失败，` +
        `由用户确认后放置 suite-failure-baseline.json（条目须含 module/suite/test，feature 字段须匹配）——` +
        `本轮执行不得反推基线，agent 不得自行创建该文件）`
      : `\n${suiteHealthLine}`;

  const exemptKeys = new Set((ratchet?.baselineExempt ?? []).map(suiteFailureKey));
  const bad = perModule.filter(x => {
    const r = x.result;
    if (r.toolMissing) return true;
    if (!r.executed) return true;
    const t = r.testResult;
    if (t && (t.total ?? 0) > 0 && (t.failed ?? 0) > 0) {
      // 豁免判定先于 exitCode：用例失败会让 aa test 以非零退出，不得因此绕过棘轮；
      // 失败身份含模块名——A 模块的基线不得豁免 B 模块的同名失败。
      const allExempt = (t.failures ?? []).every(
        (f: { suite: string; test: string }) =>
          exemptKeys.has(suiteFailureKey({ module: x.module, suite: f.suite, test: f.test })),
      );
      return !(allExempt && (t.failures ?? []).length > 0);
    }
    if (r.exitCode !== 0) return true;
    if (!t) return true;
    if (t.total <= 0) return true;
    return false;
  });

  if (bad.length === 0 && !allModulesExecuted) {
    // 防御：豁免使 bad 清空但并非所有选中模块都真实执行 → 不得宣称 PASS
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `选中 ${mods.length} 个模块，仅 ${perModule.length} 个产生真实执行结果——不完整的执行不得判 PASS。` +
          `已执行：${perModule.map(x => x.module).join(', ') || '(无)'}${ratchetNote}`,
        suggestion:
          '检查未执行模块的链路失败原因（见已执行模块的日志与归因），修复后重跑；不得以部分模块结果宣称 UT 通过。',
      },
    ];
  }

  if (bad.length === 0) {
    const totals = perModule.reduce(
      (acc, x) => ({
        total: acc.total + (x.result.testResult?.total ?? 0),
        passed: acc.passed + (x.result.testResult?.passed ?? 0),
        failed: acc.failed + (x.result.testResult?.failed ?? 0),
      }),
      { total: 0, passed: 0, failed: 0 },
    );
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'PASS',
        details:
          `全部 ${perModule.length} 个 ohosTest 模块装机执行通过（target 无失败）：` +
          `total=${totals.total}, passed=${totals.passed}, failed=${totals.failed}；` +
          `目标设备：${devProbe.targets.join(' / ')}${ratchetNote}`,
      },
    ];
  }

  const formatted = buildUtHvigorTestFailDetails(bad);
  return [
    {
      id: 'ut_hvigor_test',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: formatted.lines.join('\n') + ratchetNote,
      affected_files: formatted.affectedFiles,
      failure_kind: formatted.failureKind,
      blocking_class: formatted.blockingClass,
      suggestion: formatted.suggestion,
    },
  ];
}

function checkTestRegistration(
  ctx: CheckContext,
  utFiles: Array<{ path: string }>,
): CheckResult[] {
  if (utFiles.length === 0) {
    return [
      {
        id: 'test_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
        severity: 'MAJOR',
        status: 'SKIP',
        details: '未找到 UT 文件。',
      },
    ];
  }

  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [
      {
        id: 'test_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
        severity: 'MAJOR',
        status: 'SKIP',
        details: 'contracts.yaml 无 modules 列表。',
      },
    ];
  }

  const unregistered: string[] = [];

  for (const mod of contracts.modules) {
    const listTestPath = path.join(
      ctx.projectRoot,
      mod.package_path,
      'src',
      'ohosTest',
      'ets',
      'test',
      'List.test.ets',
    );

    if (!fs.existsSync(listTestPath)) {
      const modUtFiles = utFiles.filter(f => f.path.includes(mod.package_path));
      if (modUtFiles.length > 0) {
        unregistered.push(`${mod.name}: List.test.ets 不存在（${modUtFiles.length} 个 UT 文件无法注册）`);
      }
      continue;
    }

    const listContent = fs.readFileSync(listTestPath, 'utf-8');
    const modUtFiles = utFiles.filter(
      f => f.path.includes(mod.package_path) && !f.path.endsWith('List.test.ets'),
    );

    for (const utFile of modUtFiles) {
      const basename = path.basename(utFile.path, '.test.ets');
      if (!listContent.includes(basename)) {
        unregistered.push(`${mod.name}: ${path.basename(utFile.path)} 未在 List.test.ets 中注册`);
      }
    }
  }

  if (unregistered.length === 0) {
    return [
      {
        id: 'test_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
        severity: 'MAJOR',
        status: 'PASS',
        details: '所有 UT 文件已在 List.test.ets 中注册。',
      },
    ];
  }

  return [
    {
      id: 'test_registration',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'test_registration'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${unregistered.length} 个注册问题：\n${truncateList(unregistered, 10)}`,
      suggestion: '所有 UT 文件的导出函数必须在 List.test.ets 中注册。',
    },
  ];
}

const HARNESS_POLLUTION_ALLOWLIST_TOP = new Set([
  'reports',
  'state',
  'trace',
  'node_modules',
  'dist',
  'tests',
  'prompts',
  'scripts',
  'hooks',
]);

function collectHarnessPollutionExtras(ctx: CheckContext): string[] {
  const harnessRoot = ctx.harnessRoot;
  if (!fs.existsSync(harnessRoot)) return [];

  const violations: string[] = [];
  const seen = new Set<string>();

  function record(absPath: string): void {
    const display = formatPollutionDisplayPath(ctx, absPath);
    if (seen.has(display)) return;
    seen.add(display);
    violations.push(display);
  }

  function walk(current: string, relParts: string[]): void {
    if (relParts.length > 0 && HARNESS_POLLUTION_ALLOWLIST_TOP.has(relParts[0])) {
      return;
    }

    const relPosix = relParts.join('/');
    if (relPosix.includes('ohosTest') || relPosix.includes('test/dag')) {
      record(current);
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const abs = path.join(current, ent.name);
      const nextRel = [...relParts, ent.name];
      if (ent.isDirectory()) {
        walk(abs, nextRel);
      } else if (ent.isFile() && ent.name.endsWith('.test.ets')) {
        record(abs);
      }
    }
  }

  walk(harnessRoot, []);
  return violations;
}

export { partitionUtFiles };

export const utHostImpl: UtHostImpl = {
  loadUtFiles,
  partitionUtFiles,
  checkUtFileNaming,
  checkUtFrameworkImport,
  checkUtTscCompiles,
  checkUtHvigorBuild,
  checkUtHvigorTest,
  checkTestRegistration,
  isSuiteEntryShim: isSuiteEntryShimContent,
  collectHarnessPollutionExtras,
};
