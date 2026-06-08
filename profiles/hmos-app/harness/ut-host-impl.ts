/**
 * hmos-app：UT 阶段与宿主测试目录、Hypium、hvigor、hdc 相关的实现（根 check-ut 仅编排）。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { UtHostImpl, UtHostSuggestionPaths } from '../../../harness/profile-host-loader';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { compileTestFiles } from '../../../harness/scripts/utils/ts-compile';
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

function getUtSuggestionPaths(): UtHostSuggestionPaths {
  return {
    useCasesSchemaTemplateRel:
      'framework/profiles/hmos-app/skills/business-ut/templates/use-cases-schema.md',
    mockPlanSchemaTemplateRel:
      'framework/profiles/hmos-app/skills/business-ut/templates/mock-plan-schema.md',
    testabilityAuditTemplateRel:
      'framework/profiles/hmos-app/skills/business-ut/templates/testability-audit-template.md',
    branchExampleTestRel:
      'framework/profiles/hmos-app/skills/business-ut/examples/sample-flow/sample_flow.test.ets',
    utHostImplRefRel: 'framework/profiles/hmos-app/harness/ut-host-impl.ts',
  };
}

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
        details: `${utFiles.length} 个 UT 文件 tsc --noEmit 通过（耗时 ${report.durationMs} ms）。`,
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

  return [
    {
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
        '若含 TS2614 且为 MockKit/when：在 mock-plan 声明 strategy=mockkit，勿改消费者 framework 内 ts-compile.ts。' +
        '修完再跑 harness；该规则是 ut_hvigor_build 之前的第一道护城河。',
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

function checkUtHvigorBuild(ctx: CheckContext): CheckResult[] {
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

  const mods = findModulesWithUt(ctx);
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

  const perModule: Array<{ module: string; result: any }> = [];
  for (const mod of mods) {
    const res = dispatchUtCompile(ctx, {
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

  const bad = perModule.filter(
    x =>
      x.result.toolMissing ||
      x.result.skippedByEnv ||
      (x.result.executed && (x.result.exitCode !== 0 || x.result.errors.length > 0)),
  );

  if (bad.length === 0) {
    return [
      {
        id: 'ut_hvigor_build',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_build'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `全部 ${perModule.length} 个 ohosTest 模块 hvigor 编译通过（累计耗时 ${perModule.reduce((s, x) => s + x.result.durationMs, 0)} ms）。`,
      },
    ];
  }

  const first = bad[0].result;
  const lines: string[] = [`ohosTest 模块 "${bad[0].module}" 编译失败：`];
  const failureClass = classifyUtHvigorBuildFailure(first, ctx, bad[0].module, ctx.projectRoot);
  if (first.toolMissing) {
    lines.push('原因：未找到 hvigor 可执行文件（v2.3 起需通过 framework.config.json 声明 DevEco 路径）。');
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
      affected_files: [bad[0].module + '@ohosTest'],
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
  | 'ut_code'
  | 'feature_code'
  | 'project_dependency_missing'
  | 'external_project_build_blocker'
  | 'unknown';

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
        '按 framework.config.json > toolchain.devEcoStudio.installPath 配置 DevEco Studio 路径后重跑。',
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
  const depIssue = analyzeProjectDependencyIssueViaProfile(ctx, res);
  const hasDependencyResolutionFailure =
    /Failed to resolve OhmUrl|Could not resolve|Cannot resolve|Cannot find module|Unable to resolve|Module not found/i.test(
      log,
    );
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
      explanation: '编译错误指向当前模块 src/main；若确需改业务源码，必须先走 business-ut 源码修改授权流程。',
      suggestion: '优先确认是否可通过 UT/Spy 调整规避；确需改 src/main 时先向用户申请并登记 gap-notes。',
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

function checkUtHvigorTest(ctx: CheckContext): CheckResult[] {
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

  const mods = findModulesWithUt(ctx);
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

  const perModule: Array<{ module: string; result: any }> = [];
  for (const mod of mods) {
    const res = dispatchUtRun(ctx, {
      projectRoot: ctx.projectRoot,
      harnessRoot: HARNESS_ROOT,
      feature: ctx.feature,
      phase: 'ut',
      moduleName: mod.name,
      moduleSrcPath: mod.package_path,
    });
    perModule.push({ module: mod.name, result: res });
    if (
      res.toolMissing ||
      (res.executed && (res.exitCode !== 0 || (res.testResult && res.testResult.failed > 0)))
    ) {
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
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'PASS',
        details:
          `全部 ${perModule.length} 个 ohosTest 模块装机执行通过：` +
          `total=${totals.total}, passed=${totals.passed}, failed=0；` +
          `目标设备：${devProbe.targets.join(' / ')}`,
      },
    ];
  }

  const first = bad[0].result;
  if (first.installBlocking?.kind && first.installBlocking.kind !== 'clear') {
    const meta = mapInstallBlockingToUtCheckFields(first.installBlocking);
    return [
      {
        id: 'ut_hvigor_test',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: buildUtInstallBlockingCheckDetails(first.installBlocking),
        affected_files: [bad[0].module + '@ohosTest'],
        failure_kind: meta.failure_kind,
        blocking_class: meta.blocking_class,
        suggestion: meta.suggestion,
      },
    ];
  }

  const lines: string[] = [`ohosTest 模块 "${bad[0].module}" 装机执行失败：`];
  const stageHint = first.errors?.find((e: { message: string }) => /失败阶段：/.test(e.message))?.message;
  if (stageHint) {
    lines.push(stageHint);
  }
  if (first.toolMissing) {
    lines.push(
      '原因：未找到 hvigor / hdc 可执行文件（v2.3 起需通过 framework.config.json 声明 DevEco 路径，hdc 由 DevEco SDK toolchains 提供）。',
    );
    first.logExcerpt.split(/\r?\n/).forEach((l: string) => lines.push(l));
  } else if (!first.executed) {
    lines.push(`原因：hvigor / hdc 未执行，日志：${first.logExcerpt}`);
  } else if (first.exitCode !== 0 && !first.testResult) {
    lines.push(`链路异常退出 exit_code=${first.exitCode}。`);
    lines.push('日志尾部：');
    lines.push(first.logExcerpt);
  } else if (!first.testResult) {
    lines.push('aa test 未输出 OHOS_REPORT_RESULT，无法证明用例已真实执行。');
    if (first.errors?.length) {
      lines.push('诊断：');
      first.errors.forEach((e: { message: string }) => lines.push(`  - ${e.message}`));
    }
    lines.push('');
    lines.push(`日志落盘：${first.logPath ?? '(未落盘)'}`);
  } else if (first.testResult) {
    const t = first.testResult;
    lines.push(`hypium 结果：total=${t.total}, passed=${t.passed}, failed=${t.failed}, skipped=${t.skipped}`);
    if (t.total === 0) {
      lines.push(
        '警告：total=0 表示 hvigor test 没有跑到任何用例。请检查 List.test.ets 是否正确注册了所有 *.test.ets 入口。',
      );
    }
    if (t.failures.length > 0) {
      lines.push(`失败用例（前 15 条）：`);
      t.failures.slice(0, 15).forEach((f: { suite: string; test: string; message: string }) =>
        lines.push(`  - [${f.suite}] ${f.test}  →  ${f.message}`),
      );
    }
    lines.push('');
    lines.push(`日志落盘：${first.logPath ?? '(未落盘)'}`);
  }

  return [
    {
      id: 'ut_hvigor_test',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'ut_hvigor_test'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: lines.join('\n'),
      affected_files: [bad[0].module + '@ohosTest'],
      suggestion:
        stageHint?.includes('device_locked')
          ? '设备已连接但锁屏：请手动解锁并保持在桌面/前台后重跑。'
          : stageHint
            ? '按上方“失败阶段/修复建议”处理后重跑；完整输出见 hdc-test.log。'
            : '按失败用例堆栈定位问题：可能是 UT 逻辑错误、被测业务实现与 UT 预期不一致、或 Spy/Stub 预设值不对。' +
              '修改 UT 后重跑；若需要动业务源码，先按 SKILL.md > 约束 #12 的 HARD STOP 流程征得用户同意。',
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
  getUtSuggestionPaths,
  isSuiteEntryShim: isSuiteEntryShimContent,
  collectHarnessPollutionExtras,
};
