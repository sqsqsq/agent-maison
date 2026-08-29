// hmos-app / ArkTS 宿主：coding 阶段结构/追溯中与工具链绑定的规则（根 check-coding 仅编排）。

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult, ContractsSpec } from '../../../harness/scripts/utils/types';
import { AstAnalyzer, type FileAnalysis } from '../../../harness/scripts/utils/ast-analyzer';
import { diffChangedFiles } from '../../../harness/scripts/utils/git-diff';
import type { ProfileCodingHost } from '../../../harness/profile-host-loader';
import { loadFrameworkConfig } from '../../../harness/config';
import {
  isCapabilitySkipped,
  isDepsInstallExecutable,
  CANONICAL_CODING_COMPILE_ID,
  LEGACY_CODING_COMPILE_ID,
  dispatchCodingCompile,
  dispatchDepsInstall,
  analyzeCodingDependencyIssueViaProfile,
} from '../../../harness/capability-registry';
import { detectHvigorConfigError, isHvigorBuildSuccessful, type ProjectDependencyIssue } from './hvigor-runner';
import {
  resolveProductSelection,
  describeProductSelection,
  buildProductSelectionUnresolvedGuidance,
  summarizeUnresolvedCause,
  TRUSTED_PRODUCT_SOURCES,
  type ProductSelection,
} from './product-selection';
import {
  isCrossModuleExportFileStem,
  isLibraryFormat,
  readOhPackageField,
  normalizeRelativePath,
} from './har-export-resolve';

import { runArkuiStaticRules } from './arkui-static-rules';
import { blockerFail } from '../../../harness/scripts/utils/check-result-factory';
import {
  resolveContractFileReferences,
  selectContractReferencePaths,
} from '../../../harness/scripts/utils/contract-reference-closure';

export { isCrossModuleExportFileStem } from './har-export-resolve';

const HARNESS_ROOT = path.resolve(__dirname, '../../..', 'harness');

type HarExportResolver = (
  projectRoot: string,
  mod: Pick<ContractsSpec['modules'][number], 'name' | 'package_path'>,
  indexFileName: string,
) => {
  relPath: string;
  source: string;
  warning?: string;
  error?: string;
};

function tryLoadHarExportResolver(profileDir: string): HarExportResolver | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require(path.join(profileDir, 'harness', 'har-export-resolve')) as {
      resolveHarExportEntryPath?: HarExportResolver;
    };
    return typeof m.resolveHarExportEntryPath === 'function' ? m.resolveHarExportEntryPath : null;
  } catch {
    return null;
  }
}

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function parseJson5(content: string): unknown {
  let stripped = content.replace(/^\s*\/\/.*$/gm, '');
  stripped = stripped.replace(/([^"':])\s*\/\/.*$/gm, '$1');
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

function structureRuleDefined(ctx: CheckContext, id: string): boolean {
  const sc = ctx.phaseRule.structure_checks as Record<string, unknown> | undefined;
  return Boolean(sc && Object.prototype.hasOwnProperty.call(sc, id));
}

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

function checkNoHardcodedStrings(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const hits: Array<{ file: string; value: string; line: number }> = [];
  for (const a of analyses) {
    for (const hs of a.hardcodedStrings) {
      hits.push({ file: a.filePath, value: hs.value, line: hs.lineNumber });
    }
  }

  if (hits.length === 0) {
    return [
      {
        id: 'no_hardcoded_strings',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'no_hardcoded_strings'),
        severity: 'MAJOR',
        status: analyses.length > 0 ? 'PASS' : 'SKIP',
        details:
          analyses.length > 0 ? '未发现硬编码中文字符串。' : '无 presentation 层文件可分析。',
      },
    ];
  }

  const details = hits.slice(0, 10).map(h => `  - ${h.file}:${h.line} → "${h.value}"`).join('\n');
  return [
    {
      id: 'no_hardcoded_strings',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'no_hardcoded_strings'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${hits.length} 处硬编码中文字符串：\n${details}${
        hits.length > 10 ? `\n  ... 还有 ${hits.length - 10} 处` : ''
      }`,
      affected_files: [...new Set(hits.map(h => h.file))],
      suggestion: "请将 UI 文本替换为 $r('app.string.xxx') 资源引用。",
    },
  ];
}

function checkHarIndexExport(ctx: CheckContext): CheckResult[] {
  if (!structureRuleDefined(ctx, 'har_index_export')) {
    return [
      {
        id: 'har_index_export',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '当前合并后的 phase-rules 未声明 har_index_export，跳过。',
      },
    ];
  }

  const resolveHarExportEntryPath = tryLoadHarExportResolver(ctx.resolvedProfile.profileDir);
  if (!resolveHarExportEntryPath) {
    return [
      {
        id: 'har_index_export',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          'phase-rules 声明了 har_index_export，但当前 profile 缺少 harness/har-export-resolve 模块。',
      },
    ];
  }

  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [
      {
        id: 'har_index_export',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'contracts.yaml 无 modules 列表。',
      },
    ];
  }

  const libraryModules = contracts.modules.filter(m => isLibraryFormat(m.format));
  if (libraryModules.length === 0) {
    return [
      {
        id: 'har_index_export',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '无 HAR/HSP 库模块。',
      },
    ];
  }

  const cfg = loadFrameworkConfig(ctx.projectRoot);
  const indexFileName = cfg.architecture.cross_module_exports_file;

  const missing: string[] = [];
  const warnings: string[] = [];
  const invalidEntries: string[] = [];
  let ohPackageMainCount = 0;
  for (const mod of libraryModules) {
    const entry = resolveHarExportEntryPath(ctx.projectRoot, mod, indexFileName);
    if (entry.source === 'oh-package.json5 main') ohPackageMainCount += 1;
    if (entry.warning) warnings.push(entry.warning);
    if (entry.error) invalidEntries.push(entry.error);
    if (!fs.existsSync(path.join(ctx.projectRoot, entry.relPath))) missing.push(entry.relPath);
  }

  if (missing.length === 0 && invalidEntries.length === 0) {
    const sourceDetails =
      ohPackageMainCount > 0
        ? `其中 ${ohPackageMainCount} 个模块按 oh-package.json5 main 定位入口。`
        : `均按 framework.config.json 的 architecture.cross_module_exports_file=${indexFileName} 默认路径定位。`;
    return [
      {
        id: 'har_index_export',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `全部 ${libraryModules.length} 个 HAR/HSP 库模块均有导出入口。${sourceDetails}${
          warnings.length > 0 ? `\n${warnings.join('\n')}` : ''
        }`,
      },
    ];
  }

  return [
    {
      id: 'har_index_export',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: [
        missing.length > 0
          ? `${missing.length}/${libraryModules.length} 个 HAR/HSP 库模块缺少导出入口：\n${truncateList(missing, 15)}`
          : '',
        invalidEntries.length > 0
          ? `${invalidEntries.length}/${libraryModules.length} 个 HAR/HSP 库模块入口文件名不符合架构约定：\n${truncateList(invalidEntries, 15)}`
          : '',
        warnings.length > 0 ? warnings.join('\n') : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      affected_files: [...missing, ...invalidEntries],
      suggestion: `HAR/HSP 库模块入口文件名必须是 ${indexFileName}。oh-package.json5 的 main 可以指向模块根目录或 src/main/ets 下的 ${indexFileName}；未声明 main 时，默认检查 src/main/ets/${indexFileName}。`,
    },
  ];
}

function checkModuleConfigRegistered(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [
      {
        id: 'module_config_registered',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'contracts.yaml 无 modules 列表。',
      },
    ];
  }

  const content = readFileIfExists(path.join(ctx.projectRoot, 'build-profile.json5'));
  if (!content) {
    return [
      {
        id: 'module_config_registered',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'build-profile.json5 不存在，跳过模块注册检查。',
      },
    ];
  }

  let buildProfile: Record<string, unknown>;
  try {
    buildProfile = parseJson5(content) as Record<string, unknown>;
  } catch {
    return [
      {
        id: 'module_config_registered',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'),
        severity: 'BLOCKER',
        status: 'WARN',
        details: 'build-profile.json5 解析失败，无法验证模块注册。',
      },
    ];
  }

  const registeredNames = new Set<string>();
  const modules = (buildProfile.modules as Array<{ name?: string }>) ?? [];
  for (const m of modules) {
    if (m.name) registeredNames.add(m.name);
  }

  const newModules = contracts.modules.filter(m => m.change_type === 'new');
  const missing = newModules.filter(m => !registeredNames.has(m.name)).map(m => m.name);

  if (missing.length === 0) {
    return [
      {
        id: 'module_config_registered',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'),
        severity: 'BLOCKER',
        status: newModules.length > 0 ? 'PASS' : 'SKIP',
        details:
          newModules.length > 0
            ? `全部 ${newModules.length} 个新增模块已在 build-profile.json5 注册。`
            : '无新增模块需要注册。',
      },
    ];
  }

  return [
    {
      id: 'module_config_registered',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${missing.length} 个新增模块未在 build-profile.json5 注册：${missing.join(', ')}`,
      affected_files: ['build-profile.json5'],
      suggestion:
        '请在 build-profile.json5 的 modules[] 中添加缺失模块，srcPath 格式为 "./{layer_dir}/{ModuleName}"。',
    },
  ];
}

function checkOhPackageDependencies(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length || !contracts.module_dependencies) {
    return [
      {
        id: 'oh_package_dependencies',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'contracts.yaml 无 modules 或 module_dependencies 定义。',
      },
    ];
  }

  const issues: string[] = [];
  let checked = 0;

  for (const mod of contracts.modules) {
    const content = readFileIfExists(path.join(ctx.projectRoot, mod.package_path, 'oh-package.json5'));
    if (!content) continue;
    checked++;

    let ohPkg: Record<string, unknown>;
    try {
      ohPkg = parseJson5(content) as Record<string, unknown>;
    } catch {
      issues.push(`${mod.name}: oh-package.json5 解析失败`);
      continue;
    }

    const declaredDeps = (ohPkg.dependencies as Record<string, string>) ?? {};
    const expectedDeps = contracts.module_dependencies[mod.name] ?? [];

    for (const expectedName of expectedDeps) {
      const targetModule = contracts.modules.find(m => m.name === expectedName);
      if (
        !isDependencyDeclared(
          declaredDeps,
          expectedName,
          targetModule?.package_path,
          ctx.projectRoot,
        )
      ) {
        issues.push(`${mod.name}: 缺少对 ${expectedName} 的依赖声明`);
      }
    }
  }

  if (checked === 0) {
    return [
      {
        id: 'oh_package_dependencies',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '未找到任何模块的 oh-package.json5 文件。',
      },
    ];
  }

  if (issues.length === 0) {
    return [
      {
        id: 'oh_package_dependencies',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `已检查 ${checked} 个模块的 oh-package.json5 依赖声明，均符合要求。`,
      },
    ];
  }

  return [
    {
      id: 'oh_package_dependencies',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `依赖声明问题：\n${issues.map(i => `  - ${i}`).join('\n')}`,
      suggestion: '请在 oh-package.json5 中补充缺失的依赖声明。',
    },
  ];
}

function normDependencyToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 判断 oh-package dependencies 是否已声明对 expectedModuleName 的依赖。
 * 匹配策略：归一化 dep key / file: 路径 / 目标模块 oh-package name。
 */
export function isDependencyDeclared(
  declaredDeps: Record<string, string>,
  expectedModuleName: string,
  expectedPackagePath: string | undefined,
  projectRoot: string,
): boolean {
  const expectedNorm = normDependencyToken(expectedModuleName);
  const packageSuffix = expectedPackagePath
    ? normalizeRelativePath(expectedPackagePath).replace(/\\/g, '/')
    : '';

  for (const [depKey, depValue] of Object.entries(declaredDeps)) {
    if (normDependencyToken(depKey).includes(expectedNorm)) {
      return true;
    }
    if (
      packageSuffix &&
      typeof depValue === 'string' &&
      normalizeRelativePath(depValue).replace(/\\/g, '/').includes(packageSuffix)
    ) {
      return true;
    }
  }

  if (expectedPackagePath) {
    const ohPackageName = readOhPackageField(projectRoot, expectedPackagePath, 'name');
    if (ohPackageName) {
      for (const depKey of Object.keys(declaredDeps)) {
        if (depKey.toLowerCase() === ohPackageName.toLowerCase()) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 导航注册配置文件（plan c7e2a9d4 T2）：经统一解析边界的纯 selector 消费，**不裸读**
 * `contracts.navigation` 原始字段。装载期 SpecLoader 已算好 `referenceClosure`；缺失时
 * 按 check-plan.ts 同款 `??` 兜底现算，双相共享同一份解析结论、不重复计算。
 */
function resolveNavigationConfigFiles(ctx: CheckContext): string[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const closure = ctx.featureSpec.referenceClosure
    ?? resolveContractFileReferences(ctx.projectRoot, contracts);
  return selectContractReferencePaths(closure, 'navigation.config_files');
}

/**
 * 已声明的注册配置文件读取（review P1）：`existsSync` 对"路径其实是目录"返回 true，随后
 * `readFileSync` 抛 EISDIR——异常逃到 check-coding 的 safeRun 会被降级成 MINOR SKIP，
 * `coding_run_status` 不计入阻断，于是"不可读"反而能宣称完成。故本地判普通文件并吞掉
 * 读取异常，一律归入 unreadable → BLOCKER FAIL（fail-closed，不新增机制）。
 */
function readRegularFileOrNull(absolutePath: string): string | null {
  try {
    if (!fs.statSync(absolutePath).isFile()) return null;
    return fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return null;
  }
}

function checkPageRegistration(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const components = contracts?.components ?? [];

  const navPages = components
    .filter(c => c.nav_destination)
    .map(c => ({
      name: c.name,
      dest: c.nav_destination!,
      file: c.file,
    }));

  if (navPages.length === 0) {
    return [
      {
        id: 'page_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '无 NavDestination 页面需要检查。',
      },
    ];
  }

  // 状态表（plan c7e2a9d4 T2）：走到这里必然「已有 NavDestination 页面」——
  // 没有注册配置声明、或声明的文件读不到，都是真实缺口，一律 FAIL，不得以 SKIP 冒充成功。
  const configFiles = resolveNavigationConfigFiles(ctx);
  if (configFiles.length === 0) {
    return [
      {
        id: 'page_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `${navPages.length} 个 NavDestination 页面待注册，但 contracts.yaml 的 ` +
          '`navigation.config_files` 未声明任何导航注册配置文件。',
        suggestion:
          '回到 plan 在 contracts.yaml 的 `navigation.config_files` 声明 main_pages.json / ' +
          'route_map.json 等注册配置文件，并同步列入 `contracts.files`。',
      },
    ];
  }

  let configContent = '';
  const unreadable: string[] = [];
  for (const cf of configFiles) {
    const c = readRegularFileOrNull(path.join(ctx.projectRoot, cf));
    if (c === null) unreadable.push(cf);
    else configContent += c;
  }

  if (unreadable.length > 0) {
    return [
      {
        id: 'page_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
        severity: 'BLOCKER',
        status: 'FAIL',
        details: [
          `${unreadable.length} 个已声明的导航注册配置文件不存在或不可读：`,
          ...unreadable.map(f => `  - ${f}`),
        ].join('\n'),
        affected_files: unreadable,
        suggestion: '在 coding 阶段实际创建这些注册配置文件（文件存在性的正式裁决在 coding file_completeness）。',
      },
    ];
  }

  const unregistered = navPages.filter(p => !configContent.includes(p.dest) && !configContent.includes(p.name));

  if (unregistered.length === 0) {
    return [
      {
        id: 'page_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `全部 ${navPages.length} 个 NavDestination 页面已在配置文件中注册。`,
      },
    ];
  }

  return [
    {
      id: 'page_registration',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${unregistered.length} 个页面未在配置文件中注册：\n${unregistered.map(u => `  - ${u.name} (nav_destination: ${u.dest})`).join('\n')}`,
      affected_files: configFiles,
      suggestion: '请在 main_pages.json 和/或 route_map.json 中注册页面。',
    },
  ];
}

function checkNamingConventions(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const violations: string[] = [];
  const affectedFiles: string[] = [];
  const pascalRe = /^[A-Z][a-zA-Z0-9]*$/;
  const snakeRe = /^[a-z][a-z0-9_]*$/;
  const cfg = loadFrameworkConfig(ctx.projectRoot);
  const crossExports = cfg.architecture.cross_module_exports_file ?? 'index.ets';

  for (const a of analyses) {
    const fileName = path.basename(a.filePath, '.ets');
    const isExportStem = isCrossModuleExportFileStem(fileName, crossExports);

    if (a.filePath.endsWith('.ets') && !pascalRe.test(fileName) && !isExportStem) {
      violations.push(`文件名 ${a.filePath} 不是 PascalCase`);
      affectedFiles.push(a.filePath);
    }

    for (const cls of a.classes) {
      if (cls.kind === 'struct' && cls.decorators.includes('Component')) {
        if (!isExportStem && cls.name !== fileName) {
          violations.push(`${a.filePath}: 组件 ${cls.name} 名称与文件名 ${fileName} 不一致`);
          affectedFiles.push(a.filePath);
        }
      }
    }

    for (const ref of a.resourceRefs) {
      if (!snakeRe.test(ref.key)) {
        violations.push(`${a.filePath}:${ref.lineNumber}: 资源 key "${ref.key}" 不是 snake_case`);
        affectedFiles.push(a.filePath);
      }
    }
  }

  if (violations.length === 0) {
    return [
      {
        id: 'naming_conventions',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'naming_conventions'),
        severity: 'MAJOR',
        status: analyses.length > 0 ? 'PASS' : 'SKIP',
        details: analyses.length > 0 ? '命名规范检查通过。' : '无文件可分析。',
      },
    ];
  }

  return [
    {
      id: 'naming_conventions',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'naming_conventions'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${violations.length} 处命名规范问题：\n${violations.slice(0, 10).map(v => `  - ${v}`).join('\n')}${
        violations.length > 10 ? `\n  ... 还有 ${violations.length - 10} 处` : ''
      }`,
      affected_files: [...new Set(affectedFiles)],
      suggestion: '模块名/组件名/文件名使用 PascalCase，资源 key 使用 snake_case。',
    },
  ];
}

function checkNoAnyType(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const etsFiles = contracts?.files?.filter(f => f.endsWith('.ets')) ?? [];
  if (etsFiles.length === 0) {
    return [
      {
        id: 'no_any_type',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'no_any_type'),
        severity: 'MAJOR',
        status: 'SKIP',
        details: '无 .ets 文件列表。',
      },
    ];
  }

  const anyRe = /(?::\s*any\b|as\s+any\b|<any>)/;
  const hits: Array<{ file: string; line: number; text: string }> = [];

  for (const relPath of etsFiles) {
    const content = readFileIfExists(path.join(ctx.projectRoot, relPath));
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (anyRe.test(trimmed)) {
        hits.push({ file: relPath, line: i + 1, text: trimmed.substring(0, 80) });
      }
    }
  }

  if (hits.length === 0) {
    return [
      {
        id: 'no_any_type',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'no_any_type'),
        severity: 'MAJOR',
        status: 'PASS',
        details: '未发现 any 类型使用。',
      },
    ];
  }

  return [
    {
      id: 'no_any_type',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'no_any_type'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${hits.length} 处 any 类型使用：\n${hits.slice(0, 10).map(h => `  - ${h.file}:${h.line} → ${h.text}`).join('\n')}${
        hits.length > 10 ? `\n  ... 还有 ${hits.length - 10} 处` : ''
      }`,
      affected_files: [...new Set(hits.map(h => h.file))],
      suggestion: '请替换为具体类型或 unknown。',
    },
  ];
}

function checkAsyncAwaitPattern(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const etsFiles = contracts?.files?.filter(f => f.endsWith('.ets')) ?? [];
  if (etsFiles.length === 0) {
    return [
      {
        id: 'async_await_pattern',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'async_await_pattern'),
        severity: 'MINOR',
        status: 'SKIP',
        details: '无 .ets 文件列表。',
      },
    ];
  }

  const thenCatchRe = /\.then\s*\(|\.catch\s*\(/;
  const excludeRe = /Promise\.(all|race|allSettled|any)\s*\(/;
  const hits: Array<{ file: string; line: number; text: string }> = [];

  for (const relPath of etsFiles) {
    const content = readFileIfExists(path.join(ctx.projectRoot, relPath));
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (thenCatchRe.test(trimmed) && !excludeRe.test(trimmed)) {
        hits.push({ file: relPath, line: i + 1, text: trimmed.substring(0, 80) });
      }
    }
  }

  if (hits.length === 0) {
    return [
      {
        id: 'async_await_pattern',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'async_await_pattern'),
        severity: 'MINOR',
        status: 'PASS',
        details: '未发现 .then()/.catch() 回调链。',
      },
    ];
  }

  return [
    {
      id: 'async_await_pattern',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'async_await_pattern'),
      severity: 'MINOR',
      status: 'WARN',
      details: `${hits.length} 处 .then()/.catch() 回调链：\n${hits.slice(0, 10).map(h => `  - ${h.file}:${h.line} → ${h.text}`).join('\n')}${
        hits.length > 10 ? `\n  ... 还有 ${hits.length - 10} 处` : ''
      }`,
      affected_files: [...new Set(hits.map(h => h.file))],
      suggestion: '请使用 async/await 替代 .then()/.catch() 链。',
    },
  ];
}

function checkDesignFilePlanToCode(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.files?.length) {
    return [
      {
        id: 'plan_file_to_code',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'plan_file_to_code'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'contracts.yaml 无 files 列表。',
      },
    ];
  }

  const etsFiles = contracts.files.filter(f => f.endsWith('.ets'));
  const missing: string[] = [];
  for (const f of etsFiles) {
    if (!fs.existsSync(path.join(ctx.projectRoot, f))) missing.push(f);
  }

  if (missing.length === 0) {
    return [
      {
        id: 'plan_file_to_code',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'plan_file_to_code'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `设计规划的全部 ${etsFiles.length} 个 .ets 文件均已实现。`,
      },
    ];
  }

  return [
    {
      id: 'plan_file_to_code',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'plan_file_to_code'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${missing.length}/${etsFiles.length} 个规划 .ets 文件缺失：\n${truncateList(missing, 15)}`,
      affected_files: missing,
      suggestion: '请按照 plan.md 目录/文件结构规划补全缺失的 .ets 文件。',
    },
  ];
}

function checkCodeToDesign(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.files?.length || !contracts?.modules?.length) {
    return [
      {
        id: 'code_to_plan',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'code_to_plan'),
        severity: 'MAJOR',
        status: 'SKIP',
        details: 'contracts.yaml 无 files 或 modules 列表。',
      },
    ];
  }

  const plannedEts = new Set(contracts.files.filter(f => f.endsWith('.ets')).map(f => f.replace(/\\/g, '/')));
  const unexpected: string[] = [];

  for (const mod of contracts.modules) {
    const etsDir = path.join(ctx.projectRoot, mod.package_path, 'src', 'main', 'ets');
    if (!fs.existsSync(etsDir)) continue;

    const scanDir = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.name.endsWith('.ets')) {
          const rel = path.relative(ctx.projectRoot, full).replace(/\\/g, '/');
          if (!plannedEts.has(rel)) unexpected.push(rel);
        }
      }
    };
    scanDir(etsDir);
  }

  if (unexpected.length === 0) {
    return [
      {
        id: 'code_to_plan',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'code_to_plan'),
        severity: 'MAJOR',
        status: 'PASS',
        details: '所有 .ets 文件均在 contracts.yaml 的规划中。',
      },
    ];
  }

  return [
    {
      id: 'code_to_plan',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'code_to_plan'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${unexpected.length} 个 .ets 文件不在 contracts.yaml 的规划中：\n${truncateList(unexpected, 15)}`,
      affected_files: unexpected,
      suggestion: '请确认这些文件是否应在 plan.md / contracts.yaml 中补充规划。',
    },
  ];
}

export type CodingCompileFailureKind =
  | 'toolchain'
  | 'env_skip'
  | 'compile_timeout'
  | 'compile_incomplete_output'
  | 'project_dependency_missing'
  | 'project_dependency_undeclared'
  | 'project_dependency_install_failed'
  /** f9c2e6b4 t2：hvigor 配置错误且引用路径**确实不存在** → agent 修 build-profile / 补回模块 */
  | 'project_config_error'
  /** f9c2e6b4 t2：配置错误但路径**实际存在** → 构建环境/复验不一致，事务重跑仍失败即 external */
  | 'project_build_environment_inconsistent'
  | 'project_build';

export interface CodingCompileFailureClassification {
  kind: CodingCompileFailureKind;
  explanation: string;
  suggestion: string;
  depIssue?: ProjectDependencyIssue;
}

/** f9c2e6b4 t2：分类可见的完整日志文本（落盘日志优先，退到 excerpt + 已解析错误消息）。 */
function compileLogText(res: {
  logAbsPath?: string;
  logExcerpt?: string;
  errors?: Array<{ message: string }>;
}): string {
  let fromDisk = '';
  try {
    if (res.logAbsPath && fs.existsSync(res.logAbsPath)) {
      fromDisk = fs.readFileSync(res.logAbsPath, 'utf-8');
    }
  } catch {
    fromDisk = '';
  }
  return [fromDisk, res.logExcerpt ?? '', ...(res.errors ?? []).map((e) => e.message)]
    .filter((s) => s && String(s).trim().length > 0)
    .join('\n');
}

/**
 * 导出供 harness 单测断言 failure_kind 枚举稳定（勿在业务代码中依赖）。
 * 签名第三参：t5（plan a7c3f9e2）注入构建前单次解析的 ProductSelection——
 * source 非可信集合（explicit_run/confirmed_env/explicit_config，即 sole_candidate）时，
 * explanation **首句**声明编译形态未经确认（推断值不得冒充用户意图）。
 */
export function classifyCodingCompileFailure(
  res: {
    toolMissing?: boolean;
    skippedByEnv?: boolean;
    timedOut?: boolean;
    executed?: boolean;
    exitCode?: number;
    errors?: Array<{ file?: string; line?: number; code?: string; message: string }>;
    successMarkerFound?: boolean;
    /** f9c2e6b4 t2：配置错误判据需要原始日志（与 analyzeProjectDependencyIssue 同源入参） */
    logAbsPath?: string;
    logExcerpt?: string;
  },
  ctx: CheckContext,
  selection?: ProductSelection,
): CodingCompileFailureClassification {
  return withUnconfirmedFormLead(classifyCodingCompileFailureCore(res, ctx), selection);
}

/**
 * 首句声明"编译形态未经确认"（plan a7c3f9e2 t5 ⑧ + review P2 统一）：source 非可信集合
 * （explicit_run/confirmed_env/explicit_config，即 sole_candidate 等推导形态）时，
 * explanation **首句**声明形态未经确认——推断值不得冒充用户意图。
 * 分类器内部与 checkCodingCompile 的 override 分支最终选择处都经本函数收口，防绕过。
 */
export function withUnconfirmedFormLead(
  outcome: CodingCompileFailureClassification,
  selection?: ProductSelection,
): CodingCompileFailureClassification {
  if (!selection?.product || TRUSTED_PRODUCT_SOURCES.has(selection.source)) return outcome;
  return {
    ...outcome,
    explanation:
      `编译形态未经确认：product=${selection.product} 由工程候选推导（来源：${selection.source}），` +
      `未曾在 framework.local.json 确认——推断值不得冒充用户意图。\n${outcome.explanation}`,
  };
}

function classifyCodingCompileFailureCore(
  res: {
    toolMissing?: boolean;
    skippedByEnv?: boolean;
    timedOut?: boolean;
    executed?: boolean;
    exitCode?: number;
    errors?: Array<{ file?: string; line?: number; code?: string; message: string }>;
    successMarkerFound?: boolean;
    logAbsPath?: string;
    logExcerpt?: string;
  },
  ctx: CheckContext,
): CodingCompileFailureClassification {
  const errs = res.errors ?? [];
  if (res.toolMissing) {
    return {
      kind: 'toolchain',
      explanation: '宿主编译驱动（IDE 安装路径下的构建工具）不可用。',
      suggestion:
        '在 framework.local.json > toolchain.devEcoStudio.installPath 配置 IDE 安装根目录（或 check-personal-setup --ensure / detect-deveco）后重跑 harness。',
    };
  }
  if (res.skippedByEnv) {
    return {
      kind: 'env_skip',
      explanation: '已设置 HARNESS_SKIP_HVIGOR=1，显式跳过真实编译。',
      suggestion: '取消该环境变量后重跑；真实编译为 coding 阶段出口条件。',
    };
  }
  if (res.timedOut) {
    return {
      kind: 'compile_timeout',
      explanation:
        '编译子进程超时（默认 coding 45min，可由 toolchain.hvigor.timeoutMs 覆盖）。日志可能不完整。',
      suggestion:
        '确认工程体量后调大 toolchain.hvigor.timeoutMs；或先在 IDE 侧完成一次完整构建再跑 harness。详见构建元数据中的 timedOut 字段。',
    };
  }
  if (res.executed && res.exitCode === 0 && errs.length === 0 && res.successMarkerFound === false) {
    return {
      kind: 'compile_incomplete_output',
      explanation:
        '进程退出码为 0，但完整日志尾部未命中成功哨兵。可能是日志被截断、构建未完成或需调整 toolchain.hvigor.coding.successMarkers。',
      suggestion:
        '读取日志全文与构建元数据；若确为完整成功输出，可在 framework.config.json 的 toolchain.hvigor.coding.successMarkers 增加匹配模式。',
    };
  }

  // f9c2e6b4 t2：**配置错误先于依赖判据**——两者互斥且前者更具体。
  // hvigor 在配置阶段就失败（实证 23ms）时根本没进编译，把它落进 project_build 会让
  // agent 去找一个不存在的 file:line；落进依赖自愈链则会去跑一条与之无关的 ohpm install
  //（`At file:` 指的是 build-profile.modules[].srcPath 引用的**本地源码目录**，
  // ohpm 不负责创建它）。故此处按**路径存在性**分流。
  const configError = detectHvigorConfigError(compileLogText(res));
  if (configError) {
    // 检测器已保证 code=00303149 且 atPath 非空；其余配置错误一律不进本分流。
    const atPath = configError.atPath;
    const resolved = path.isAbsolute(atPath) ? atPath : path.join(ctx.projectRoot, atPath);
    const pathExists = fs.existsSync(resolved);
    if (!pathExists) {
      return {
        kind: 'project_config_error',
        explanation:
          `hvigor 配置阶段失败（${configError.code}）：构建配置引用的路径不存在——${resolved}。\n` +
          '这不是编译错误，也不是依赖解析失败：hvigor 尚未进入编译。',
        suggestion:
          '按 hvigor 的 `* Try:` 提示核对 build-profile.json5 的 modules 字段：' +
          '要么该模块条目应删除/改名，要么本地源码目录需要恢复。' +
          '修正后重跑 harness；**不要**尝试用 ohpm install 解决（它不创建本地源码目录）。',
      };
    }
    return {
      kind: 'project_build_environment_inconsistent',
      explanation:
        `hvigor 配置阶段失败（${configError.code}），但引用路径**实际存在**` +
        `${resolved ? `——${resolved}` : ''}。构建环境与磁盘状态不一致（非本轮编码所致）。`,
      suggestion:
        '同一构建事务原样重跑一次即可自证；仍失败则属外部条件（工具链/文件锁/缓存），' +
        '**不应**再让 agent 改代码。',
    };
  }

  const depIssue = analyzeCodingDependencyIssueViaProfile(ctx, res);
  // 根因 B（真实代码/构建错误优先）：depIssue.found 已收敛为"命中真实解析失败信号"
  // （hvigor-runner `hasDependencyResolutionFailure` 单一判据；见 P0-A 的 found 收紧）。
  // 因此无解析失败信号时——哪怕日志里散落 @scope/name 或 oh_modules 路径、或首错是 rollup
  // "Unexpected token" 语法错——都不再误判依赖，直接落 project_build 引导回 file:line 改代码。
  if (depIssue.found) {
    return {
      kind: 'project_dependency_missing',
      depIssue,
      explanation:
        '构建日志显示工程依赖解析失败，当前失败更可能来自依赖安装 / 依赖声明或内网 registry，而不是本轮编码实现本身。\n' +
        formatDependencyIssue(depIssue) +
        '\n这不表示可跳过 coding 出口或进入 code-review（Code Review）；须修复工程依赖或取得用户对放弃本阶段的明示后再执行 --clear-state。',
      suggestion:
        'harness 将自动尝试 ohpm install 并重编译（声明齐全且 profile 支持时）；' +
        '若依赖未在 oh-package.json5 声明，agent 须自行补声明后重跑；' +
        '仅在 ohpm 安装本身失败（registry/鉴权/网络）时按日志原因向用户求助。' +
        '须向用户报告首条编译错误与 summary.next_action，禁止提议进入下一阶段。' +
        (!depIssue.harnessNodeModulesReady ? ' framework/harness/node_modules 缺失时可直接在 framework/harness 执行 npm install。' : ''),
    };
  }

  // f9c2e6b4 t2（并入原独立 todo）：**没有 file/line 时不得说"定位文件/行"**。
  // 立项事故里 harness 自己记的是 `compile_first_error=(no file)`，兜底话术却让 agent
  // 去定位文件行——一条物理上无法执行的指令，正是"agent 自己解决不了"的直接原因。
  const hasLocatedError = errs.some((e) => Boolean(e.file) && Number.isFinite(e.line));
  if (!hasLocatedError) {
    const firstMessage = errs[0]?.message?.trim();
    return {
      kind: 'project_build',
      explanation:
        '编译失败（非零退出或解析到 error），且**日志中没有可定位的文件/行**——' +
        '通常是工程级失败（构建配置 / 工具链 / 依赖状态），不是某一行源码的问题。',
      suggestion:
        '读取完整日志（details 中的日志路径），按其中的首条错误与构建工具给出的 `* Try:` 提示处置' +
        (firstMessage ? `；首条错误：${firstMessage}` : '') +
        '。该规则是真实编译闭环的出口，禁止用 SKIP / WARN 绕过。',
    };
  }
  return {
    kind: 'project_build',
    explanation: '编译失败（非零退出或解析到 error），未识别为依赖安装问题。',
    suggestion:
      '读取完整日志（details 中的日志路径），定位文件/行并回到编码阶段修复。' +
      '该规则是真实编译闭环的出口，禁止用 SKIP / WARN 绕过。',
  };
}

function formatDependencyIssue(issue: {
  dependencies: string[];
  harnessNodeModulesReady: boolean;
  ohModulesExists: boolean;
  ohPackageFiles: string[];
  missingDeclarations: string[];
  installHints: string[];
}): string {
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

function duplicateCompileResults(base: Omit<CheckResult, 'id'>): CheckResult[] {
  return [
    { ...base, id: LEGACY_CODING_COMPILE_ID },
    { ...base, id: CANONICAL_CODING_COMPILE_ID },
  ];
}

type CompileRunResult = {
  executed?: boolean;
  timedOut?: boolean;
  exitCode?: number;
  errors?: Array<{ file?: string; line?: number; code?: string; message: string }>;
  successMarkerFound?: boolean;
  toolMissing?: boolean;
  skippedByEnv?: boolean;
  durationMs?: number;
  command?: string;
  metaPath?: string;
  logPath?: string;
  logExcerpt?: string;
  diagnostics?: string[];
};

/** 导出供生产链单测断言（plan a7c3f9e2 t1：与 device-testing 出口共用同一终态判据）。 */
export function isCompilePass(res: CompileRunResult): boolean {
  return isHvigorBuildSuccessful(res);
}

/** 导出供生产链单测断言（failure kind → blocking_class 的唯一映射点）。 */
export function resolveCompileBlockingClass(kind: CodingCompileFailureKind): string {
  if (
    kind === 'compile_timeout' ||
    kind === 'compile_incomplete_output' ||
    kind === 'project_build'
  ) {
    return CANONICAL_CODING_COMPILE_ID;
  }
  // f9c2e6b4 t2（codex 复核补接）：事务重跑后仍矛盾 = **外部条件**，必须落既有
  // `externalBlocked` 契约才会被 dependency policy 认出来（isDeferrableExternalBlock
  // 只查 deferrable_blocking_classes，默认集合就是 ['externalBlocked']）。
  // 原实现把 kind 原样当 blocking_class，策略层认不出来 → 又回去让 agent 改代码，
  // 等于 plan 要求的 WAITING/external 根本没接通。**复用既有契约，不造新状态。**
  if (kind === 'project_build_environment_inconsistent') {
    return 'externalBlocked';
  }
  return kind;
}

function buildCompilePassDetails(
  res: CompileRunResult,
  modulesCount: number,
  /** 耗时文本（runner 遥测，直接进 details——subject 不承诺稳定，无需分域投影） */
  durationText: string,
  extraNote?: string,
  selection?: ProductSelection,
): string {
  return [
    extraNote ? `${extraNote}\n` : '',
    `编译通过（涉及 ${modulesCount} 个 contract 模块，耗时 ${durationText}）。`,
    `命令：${res.command ?? '(unknown)'}`,
    ...(selection ? [describeProductSelection(selection)] : []),
    `元数据：${res.metaPath ?? '(无)'}`,
    `完整日志：${res.logPath ?? '(无)'}`,
    ...(res.diagnostics?.length ? ['诊断提示：', ...res.diagnostics.map((d: string) => `  - ${d}`)] : []),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCompileFailDetails(
  res: CompileRunResult,
  failure: CodingCompileFailureClassification,
  /** 耗时文本（同上） */
  durationText: string,
  extraLines: string[] = [],
  selection?: ProductSelection,
): string {
  const errs = res.errors ?? [];
  const detailsLines: string[] = [];
  detailsLines.push('coding_compile（真实编译）失败：');
  if (res.toolMissing) {
    detailsLines.push('原因：未找到编译驱动可执行文件（需在 framework.config.json 声明 IDE 安装路径）。');
    (res.logExcerpt ?? '').split(/\r?\n/).forEach((l: string) => detailsLines.push(l));
    detailsLines.push('本规则不接受 SKIP —— 真实编译是出口条件。');
  } else if (res.skippedByEnv) {
    detailsLines.push('原因：HARNESS_SKIP_HVIGOR=1 已设置。');
    detailsLines.push('修复指引：去掉该环境变量并重跑。显式跳过真实编译不被允许作为出口。');
  } else {
    detailsLines.push(
      `exit_code=${res.exitCode}, durationMs=${durationText}, timedOut=${Boolean(res.timedOut)}, successMarkerFound=${res.successMarkerFound ?? 'n/a'}`,
    );
    if (selection) detailsLines.push(describeProductSelection(selection));
    detailsLines.push(`失败归因：${failure.kind}`);
    detailsLines.push(`归因说明：${failure.explanation}`);
    detailsLines.push(`命令：${res.command ?? '(unknown)'}`);
    detailsLines.push(`日志落盘：${res.logPath ?? '(未落盘)'}`);
    detailsLines.push(`元数据：${res.metaPath ?? '(无)'}`);
    if (res.diagnostics?.length) {
      detailsLines.push('诊断提示：');
      res.diagnostics.forEach((d: string) => detailsLines.push(`  - ${d}`));
    }
    if (errs.length > 0) {
      detailsLines.push(`解析出 ${errs.length} 条 error（前 10 条）：`);
      errs.slice(0, 10).forEach((e) =>
        detailsLines.push(`  - ${e.file ?? ''}${e.line ? ':' + e.line : ''}  ${e.code ?? ''}  ${e.message}`),
      );
    }
    detailsLines.push('');
    detailsLines.push('日志尾部（最多 8 KB）：');
    detailsLines.push(res.logExcerpt ?? '');
  }
  if (extraLines.length > 0) {
    detailsLines.push('');
    extraLines.forEach((l) => detailsLines.push(l));
  }
  return detailsLines.join('\n');
}

/** profile 侧：真实编译闭环 + 失败归因 + 依赖自动安装（原根目录 checkCodingHvigorBuild）。 */
function checkCodingCompile(ctx: CheckContext): CheckResult[] {
  if (isCapabilitySkipped(ctx.resolvedProfile, 'coding.compile')) {
    const desc =
      ruleDesc(ctx, 'structure_checks', 'coding_compile') ||
      ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build');
    const details =
      'project_profile 声明 coding.compile 为 SKIP：未调用真实编译（canonical id: coding_compile）。';
    return duplicateCompileResults({
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'SKIP',
      details,
    });
  }

  const contracts = ctx.featureSpec.contracts;
  const modules = contracts?.modules ?? [];
  if (modules.length === 0) {
    const desc =
      ruleDesc(ctx, 'structure_checks', 'coding_compile') ||
      ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build');
    return duplicateCompileResults({
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'contracts.yaml > modules 为空，无法确定本 feature 影响的模块；请先在 contracts.yaml 声明。',
    });
  }

  const desc =
    ruleDesc(ctx, 'structure_checks', 'coding_compile') ||
    ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build');

  // t5（plan a7c3f9e2 ⑤）：**本作用域内只解析一次**，同一 ProductSelection 对象贯穿
  // 构建参数与分类/详情生成；构建期间外部配置改变也不得二次解析。
  const compileSelection = resolveProductSelection({ projectRoot: ctx.projectRoot, purpose: 'coding' });

  // unresolved：构建形态无法确定（四种原因，见 product-selection.ts）——不猜，
  // 经既有阻断通道停止并要求确认。
  // blocking_class 复用 externalBlocked（外部/环境类：agent 不该改代码绕过），
  // goal 无人值守由 goal-runner 启动前置检查先行 halt（本分支在交互式将其落 BLOCKER FAIL）。
  // env 显式跳过（HARNESS_SKIP_HVIGOR=1）时**让位给既有 skip 语义**——用户明确跳过了
  // 编译，报"显式跳过不作为出口"比要求确认 product 更对症（fixture 回归锁）。
  if (compileSelection.source === 'unresolved' && !process.env.HARNESS_SKIP_HVIGOR) {
    const guidance = buildProductSelectionUnresolvedGuidance(compileSelection);
    return duplicateCompileResults({
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: ['coding_compile（真实编译）失败：' + summarizeUnresolvedCause(compileSelection), guidance].join('\n'),
      affected_files: modules.map(m => `${m.name} (module)`),
      failure_kind: 'project_build_environment_inconsistent',
      blocking_class: resolveCompileBlockingClass('project_build_environment_inconsistent'),
      suggestion:
        '编译形态未确认属外部/工程配置问题，不得通过改代码绕过。' +
        '请按 details 中的指引确认 product（init.product_selection / record-product-selection / env）后重跑。',
    });
  }

  const compileBaseOpts = {
    projectRoot: ctx.projectRoot,
    harnessRoot: HARNESS_ROOT,
    feature: ctx.feature,
    phase: 'coding',
    skipEnvVar: 'HARNESS_SKIP_HVIGOR',
    frameworkRoot: ctx.frameworkRoot,
    product: compileSelection.product ?? undefined,
  };

  let res: CompileRunResult = dispatchCodingCompile(ctx, compileBaseOpts);
  let depsAutoFixNote: string | undefined;
  let overrideFailure: CodingCompileFailureClassification | undefined;
  let installExtraLines: string[] = [];
  /** f9c2e6b4 t2：构建事务重跑的审计行（与 ohpm 自动安装同一投影位） */
  let buildTxnRetryLines: string[] = [];

  if (res.toolMissing || res.skippedByEnv || !isCompilePass(res)) {
    let firstFailure = classifyCodingCompileFailure({ ...res, errors: res.errors ?? [] }, ctx, compileSelection);

    // f9c2e6b4 t2：配置错误但路径实际存在 → **原样重跑一次构建事务**再下结论。
    // 这一步不启动 agent、不消耗内容重试预算：矛盾（"说找不到、但它就在那儿"）本身
    // 就不该由改代码来解决。重跑仍矛盾 → 保留 environment_inconsistent，由裁决层归 external。
    if (firstFailure.kind === 'project_build_environment_inconsistent') {
      buildTxnRetryLines = [
        '--- 构建事务重跑（f9c2e6b4 t2）---',
        `原因：${firstFailure.explanation.split('\n')[0]}`,
      ];
      res = dispatchCodingCompile(ctx, { ...compileBaseOpts, forceNoDaemon: true });
      const afterRetry = classifyCodingCompileFailure({ ...res, errors: res.errors ?? [] }, ctx, compileSelection);
      buildTxnRetryLines.push(
        isCompilePass(res)
          ? '重跑结果：PASS（首次失败为一次性环境不一致，已自证）'
          : `重跑结果：仍失败（kind=${afterRetry.kind}）——不再启动 agent，交裁决层归外部条件`,
      );
      firstFailure = afterRetry;
    }

    const canAutoInstall =
      firstFailure.kind === 'project_dependency_missing' &&
      firstFailure.depIssue &&
      isDepsInstallExecutable(ctx.resolvedProfile) &&
      !process.env.HARNESS_SKIP_DEPS_INSTALL;

    if (canAutoInstall && firstFailure.depIssue!.missingDeclarations.length > 0) {
      overrideFailure = {
        kind: 'project_dependency_undeclared',
        depIssue: firstFailure.depIssue,
        explanation:
          `以下依赖未在已扫描 oh-package.json5 中声明：${firstFailure.depIssue!.missingDeclarations.join(', ')}。\n` +
          formatDependencyIssue(firstFailure.depIssue!),
        suggestion:
          'agent 须在对应模块 oh-package.json5 补全依赖声明后重跑 harness；不要空跑 ohpm install，也不要要求用户手工安装。',
      };
    } else if (canAutoInstall) {
      const installRes = dispatchDepsInstall(ctx, compileBaseOpts);
      installExtraLines = [
        '--- 自动依赖安装 ---',
        `ohpm 命令：${installRes.command ?? '(未执行)'}`,
        `安装结果：executed=${installRes.executed}, ok=${installRes.ok}, classification=${installRes.classification}`,
        `ohpm 日志：${installRes.logPath ?? '(无)'}`,
        `ohpm 元数据：${installRes.metaPath ?? '(无)'}`,
      ];
      if (installRes.logExcerpt) {
        installExtraLines.push('ohpm 日志尾部：');
        installExtraLines.push(installRes.logExcerpt);
      }

      if (!installRes.executed) {
        overrideFailure = {
          kind: 'toolchain',
          explanation:
            'DevEco 已配置或环境可用，但无法定位/执行 ohpm 可执行文件。\n' + (installRes.logExcerpt ?? ''),
          suggestion:
            '在 framework.local.json > toolchain.devEcoStudio.installPath 配置 IDE 安装根目录（或 check-personal-setup --ensure / detect-deveco）后重跑 harness。',
        };
      } else if (!installRes.ok) {
        overrideFailure = {
          kind: 'project_dependency_install_failed',
          depIssue: firstFailure.depIssue,
          explanation:
            `ohpm install 执行失败（classification=${installRes.classification}，exit_code=${installRes.exitCode ?? 'n/a'}）。\n` +
            (installRes.logExcerpt ?? ''),
          suggestion:
            '读取 ohpm-install.log，按 registry/鉴权/网络原因处理；仅在此类安装失败时向用户求助并重跑 harness。',
        };
      } else {
        depsAutoFixNote = '已自动 ohpm install 修复工程依赖，以下为重编译结果（--no-daemon）。';
        res = dispatchCodingCompile(ctx, { ...compileBaseOpts, forceNoDaemon: true });
      }
    }
  }

  if (isCompilePass(res)) {
    return duplicateCompileResults({
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: buildCompilePassDetails(res, modules.length, `${res.durationMs} ms`, depsAutoFixNote, compileSelection),
    });
  }

  const failure =
    // review P2：override 分支（dependency/toolchain/install 自愈文案）同样统一收口
    // "首句声明形态未经确认"——不得绕过 classify 的装饰。
    overrideFailure
      ? withUnconfirmedFormLead(overrideFailure, compileSelection)
      : classifyCodingCompileFailure({ ...res, errors: res.errors ?? [] }, ctx, compileSelection);

  return duplicateCompileResults({
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: buildCompileFailDetails(
      res,
      failure,
      String(res.durationMs),
      [...buildTxnRetryLines, ...installExtraLines],
      compileSelection,
    ),
    affected_files: modules.map(m => `${m.name} (module)`),
    failure_kind: failure.kind,
    blocking_class: resolveCompileBlockingClass(failure.kind),
    suggestion: failure.suggestion,
  });
}

function runStructureChecks(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(...checkNoHardcodedStrings(ctx, analyses));
  // resource_integrity 已退役：资源合法性唯一真源=coding_compile 真实构建
  out.push(...checkHarIndexExport(ctx));
  out.push(...checkModuleConfigRegistered(ctx));
  out.push(...checkOhPackageDependencies(ctx));
  out.push(...checkPageRegistration(ctx));
  out.push(...checkNamingConventions(ctx, analyses));
  out.push(...checkNoAnyType(ctx));
  out.push(...checkAsyncAwaitPattern(ctx));
  out.push(...runArkuiStaticRules(ctx, analyses));
  out.push(...checkResourceStringInterpolation(ctx, analyses));
  return out;
}

/**
 * t9（goal-fakepass-hardening）：模板字符串内 `${$r(...)}` 插值 lint——Resource 对象
 * 进模板串渲染为 [object Object]（bc-openCard 卡包实锤：BankCardPackSection 标题行）。
 * 确定性缺陷，防线独立于视觉比对。
 */
function checkResourceStringInterpolation(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const id = 'resource_string_interpolation';
  const description = '模板字符串 Resource 插值 lint（`${$r(...)}` → [object Object]）';
  const RE = /\$\{\s*\$r\(/;
  const hits: string[] = [];
  for (const a of analyses) {
    const abs = path.isAbsolute(a.filePath) ? a.filePath : path.join(ctx.projectRoot, a.filePath);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    if (!RE.test(content)) continue;
    const rel = path.relative(ctx.projectRoot, abs).replace(/\\/g, '/');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (RE.test(lines[i])) hits.push(`${rel}:${i + 1} ${lines[i].trim().slice(0, 120)}`);
    }
  }
  if (hits.length > 0) {
    return [{
      id, category: 'structure', description,
      severity: 'BLOCKER', status: 'FAIL',
      details: `模板字符串内插值 $r() Resource 对象（渲染为 [object Object]，${hits.length} 处）：\n` + hits.slice(0, 8).join('\n') + (hits.length > 8 ? '\n…' : ''),
      suggestion: '改用 resourceManager.getStringSync($r(...).id)，或将 Resource 直接传给组件属性而非拼进字符串。',
    }];
  }
  return [{ id, category: 'structure', description, severity: 'BLOCKER', status: 'PASS', details: '未发现模板串 Resource 插值。' }];
}

function runTraceabilityChecks(ctx: CheckContext): CheckResult[] {
  return [...checkDesignFilePlanToCode(ctx), ...checkCodeToDesign(ctx)];
}

// ---------------------------------------------------------------------------
// t5（plan e6a3c9f4）：checkCodingLint — lite/exit 轨与修正链路的快速 lint 派发
// （profile-host-loader.ts 可选接口；check-exit.ts / correction-commands.ts 派发点
// 此前空转退化 WARN——"coding.lint 声明 BLOCKER 但 provider 空缺"已知债清偿）。
// 范围=高置信静态子集，不跑 hvigor 编译：
//   - ArkUI 静态规则（bindsheet 双关/push 无守卫/单例多订阅/裁剪重叠，自带行内豁免）
//   - $r 资源模板串插值（[object Object] 类 BLOCKER，与 full 轨 runStructureChecks 同源）
//   - static enum（ArkTS 非法语法，正则高置信；宿主反馈 CR-001 类，本次新增）
// dead import / TAG 硬编码等低置信候选按 plan 须真实宿主反例语料+误报预算达标后再入。
// 分析对象=git 变更 .ets 文件（工作区∪HEAD），无变更空过——lint 是秒级增量检查，
// 全仓扫描属 full 轨 coding 门禁职责。
// ---------------------------------------------------------------------------

const STATIC_ENUM_RE = /\bstatic\s+enum\b/;

/**
 * 剥离字符串字面量与注释（v2，post-impl review：`'static enum is unsupported'`、
 * `// avoid static enum`、块注释示例均不得误报）。轻量词法扫描——保留换行以维持行号。
 */
export function stripStringsAndComments(src: string): string {
  let out = '';
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (ch === "'") { mode = 'single'; i += 1; continue; }
      if (ch === '"') { mode = 'double'; i += 1; continue; }
      if (ch === '`') { mode = 'template'; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (ch === '\n') { out += '\n'; if (mode === 'line') mode = 'code'; i += 1; continue; }
    if (mode === 'block' && ch === '*' && next === '/') { mode = 'code'; i += 2; continue; }
    if (mode === 'single' && ch === '\\') { i += 2; continue; }
    if (mode === 'double' && ch === '\\') { i += 2; continue; }
    if (mode === 'template' && ch === '\\') { i += 2; continue; }
    if (mode === 'single' && ch === "'") { mode = 'code'; i += 1; continue; }
    if (mode === 'double' && ch === '"') { mode = 'code'; i += 1; continue; }
    if (mode === 'template' && ch === '`') { mode = 'code'; i += 1; continue; }
    i += 1;
  }
  return out;
}

export function checkNoStaticEnum(changedEts: string[], projectRoot: string): CheckResult[] {
  const hits: string[] = [];
  for (const rel of changedEts) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const sanitized = stripStringsAndComments(fs.readFileSync(abs, 'utf-8'));
    const lines = sanitized.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (STATIC_ENUM_RE.test(lines[i])) {
        hits.push(`${rel}:${i + 1}`);
      }
    }
  }
  if (hits.length === 0) {
    return [{
      id: 'lint_no_static_enum', category: 'structure',
      description: 'ArkTS 禁止 static enum（class 内非法语法）',
      severity: 'BLOCKER', status: 'PASS',
      details: `变更 .ets 内未发现 static enum（共扫 ${changedEts.length} 文件）。`,
    }];
  }
  // v2：经 check-result-factory 构造（t1a② 类型化 factory 的首个生产接入）。
  return [blockerFail({
    id: 'lint_no_static_enum', category: 'structure',
    description: 'ArkTS 禁止 static enum（class 内非法语法）',
    details: `发现 static enum（ArkTS 编译必败）：\n${hits.slice(0, 10).map(h => `  - ${h}`).join('\n')}${hits.length > 10 ? `\n  …等共 ${hits.length} 处` : ''}`,
    affected_files: hits.map(h => h.split(':')[0]),
    suggestion: '把 enum 移出 class 体作为顶层 enum（export enum Xxx {…}），class 内以 static readonly 引用其成员；namespace→class 改造时 enum 一律外提。',
    source: 'profile_coding_host_lint',
  })];
}

async function checkCodingLint(ctx: CheckContext): Promise<CheckResult[]> {
  const diff = diffChangedFiles({ projectRoot: ctx.projectRoot });
  const changedEts = diff.changedFiles.filter(
    f => f.endsWith('.ets') && fs.existsSync(path.join(ctx.projectRoot, f)),
  );
  if (changedEts.length === 0) {
    return [{
      id: 'coding_lint', category: 'structure',
      description: 'ArkTS 快速静态 lint（变更文件增量）',
      severity: 'BLOCKER', status: 'PASS',
      details: 'git 无 .ets 变更文件，lint 空过。',
    }];
  }
  const analyzer = new AstAnalyzer(ctx.projectRoot);
  const analyses = analyzer.analyzeFiles(changedEts);
  const out: CheckResult[] = [];
  out.push(...runArkuiStaticRules(ctx, analyses));
  out.push(...checkResourceStringInterpolation(ctx, analyses));
  out.push(...checkNoStaticEnum(changedEts, ctx.projectRoot));
  return out;
}

export const profileCodingHost: ProfileCodingHost = {
  sourceFileSuffixes: ['.ets'],
  runStructureChecks,
  runTraceabilityChecks,
  checkCodingCompile,
  checkCodingLint,
};
