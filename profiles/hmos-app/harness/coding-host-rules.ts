// hmos-app / ArkTS 宿主：coding 阶段结构/追溯中与工具链绑定的规则（根 check-coding 仅编排）。

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult, ContractsSpec } from '../../../harness/scripts/utils/types';
import type { FileAnalysis } from '../../../harness/scripts/utils/ast-analyzer';
import type { ProfileCodingHost } from '../../../harness/profile-host-loader';
import { loadFrameworkConfig } from '../../../harness/config';
import {
  isCapabilitySkipped,
  CANONICAL_CODING_COMPILE_ID,
  LEGACY_CODING_COMPILE_ID,
  dispatchCodingCompile,
  analyzeCodingDependencyIssueViaProfile,
} from '../../../harness/capability-registry';
import {
  isCrossModuleExportFileStem,
  isLibraryFormat,
  readOhPackageField,
  normalizeRelativePath,
} from './har-export-resolve';

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

function collectResourceKeys(projectRoot: string, contracts: ContractsSpec): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  const resourceFiles = contracts.files.filter(f => f.includes('/resources/') && f.endsWith('.json'));

  for (const relPath of resourceFiles) {
    const fullPath = path.join(projectRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      const basename = path.basename(relPath, '.json');
      if (Array.isArray(content[basename])) {
        if (!keys.has(basename)) keys.set(basename, new Set());
        const set = keys.get(basename)!;
        for (const item of content[basename]) {
          if (item.name) set.add(item.name);
        }
      }
    } catch {
      /* skip malformed */
    }
  }
  return keys;
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

function checkResourceIntegrity(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) {
    return [
      {
        id: 'resource_integrity',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: 'contracts.yaml 不存在，跳过资源引用检查。',
      },
    ];
  }

  const resourceKeys = collectResourceKeys(ctx.projectRoot, contracts);
  const totalKeys = Array.from(resourceKeys.values()).reduce((s, set) => s + set.size, 0);
  const totalRefs = analyses.reduce((s, a) => s + a.resourceRefs.length, 0);

  if (totalKeys === 0 && totalRefs > 0) {
    return [
      {
        id: 'resource_integrity',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '未找到资源 JSON 文件，无法验证 $r() 引用。',
      },
    ];
  }
  if (totalRefs === 0) {
    return [
      {
        id: 'resource_integrity',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '未发现 $r() 引用。',
      },
    ];
  }

  const missing: Array<{ file: string; ref: string; type: string; key: string; line: number }> = [];
  for (const a of analyses) {
    for (const ref of a.resourceRefs) {
      const set = resourceKeys.get(ref.resourceType);
      if (!set || !set.has(ref.key)) {
        missing.push({
          file: a.filePath,
          ref: ref.raw,
          type: ref.resourceType,
          key: ref.key,
          line: ref.lineNumber,
        });
      }
    }
  }

  if (missing.length === 0) {
    return [
      {
        id: 'resource_integrity',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `全部 ${totalRefs} 处 $r() 引用均有对应资源定义。`,
      },
    ];
  }

  const details = missing
    .slice(0, 10)
    .map(m => `  - ${m.file}:${m.line} → ${m.ref} (${m.type}.${m.key} 未定义)`)
    .join('\n');
  return [
    {
      id: 'resource_integrity',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${missing.length} 处 $r() 引用缺少资源定义：\n${details}${
        missing.length > 10 ? `\n  ... 还有 ${missing.length - 10} 处` : ''
      }`,
      affected_files: [...new Set(missing.map(m => m.file))],
      suggestion: '在对应模块的 resources/base/element/*.json 中补充缺失的资源 key。',
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

function checkPageRegistration(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const nav = contracts?.navigation as Record<string, unknown> | undefined;
  const configFiles = (nav?.config_files ?? []) as string[];
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

  let configContent = '';
  for (const cf of configFiles) {
    const c = readFileIfExists(path.join(ctx.projectRoot, cf));
    if (c) configContent += c;
  }

  if (!configContent) {
    return [
      {
        id: 'page_registration',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
        severity: 'BLOCKER',
        status: 'SKIP',
        details: '导航配置文件 (main_pages.json / route_map.json) 不存在。',
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
        id: 'design_file_plan_to_code',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'design_file_plan_to_code'),
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
        id: 'design_file_plan_to_code',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'design_file_plan_to_code'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `设计规划的全部 ${etsFiles.length} 个 .ets 文件均已实现。`,
      },
    ];
  }

  return [
    {
      id: 'design_file_plan_to_code',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'design_file_plan_to_code'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${missing.length}/${etsFiles.length} 个规划 .ets 文件缺失：\n${truncateList(missing, 15)}`,
      affected_files: missing,
      suggestion: '请按照 design.md 目录/文件结构规划补全缺失的 .ets 文件。',
    },
  ];
}

function checkCodeToDesign(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.files?.length || !contracts?.modules?.length) {
    return [
      {
        id: 'code_to_design',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'code_to_design'),
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
        id: 'code_to_design',
        category: 'traceability',
        description: ruleDesc(ctx, 'traceability_checks', 'code_to_design'),
        severity: 'MAJOR',
        status: 'PASS',
        details: '所有 .ets 文件均在 contracts.yaml 的规划中。',
      },
    ];
  }

  return [
    {
      id: 'code_to_design',
      category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'code_to_design'),
      severity: 'MAJOR',
      status: 'WARN',
      details: `${unexpected.length} 个 .ets 文件不在 contracts.yaml 的规划中：\n${truncateList(unexpected, 15)}`,
      affected_files: unexpected,
      suggestion: '请确认这些文件是否应在 design.md / contracts.yaml 中补充规划。',
    },
  ];
}

export type CodingCompileFailureKind =
  | 'toolchain'
  | 'env_skip'
  | 'compile_timeout'
  | 'compile_incomplete_output'
  | 'project_dependency_missing'
  | 'project_build';

/** 导出供 harness 单测断言 failure_kind 枚举稳定（勿在业务代码中依赖）。 */
export function classifyCodingCompileFailure(
  res: {
    toolMissing?: boolean;
    skippedByEnv?: boolean;
    timedOut?: boolean;
    executed?: boolean;
    exitCode?: number;
    errors?: Array<{ file?: string; line?: number; code?: string; message: string }>;
    successMarkerFound?: boolean;
  },
  ctx: CheckContext,
): { kind: CodingCompileFailureKind; explanation: string; suggestion: string } {
  const errs = res.errors ?? [];
  if (res.toolMissing) {
    return {
      kind: 'toolchain',
      explanation: '宿主编译驱动（IDE 安装路径下的构建工具）不可用。',
      suggestion:
        '在 framework.config.json > toolchain.devEcoStudio.installPath 配置 IDE 安装根目录后重跑 harness。',
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

  const depIssue = analyzeCodingDependencyIssueViaProfile(ctx, res);
  if (depIssue.found) {
    return {
      kind: 'project_dependency_missing',
      explanation:
        '构建日志显示工程依赖解析失败，当前失败更可能来自依赖安装 / 依赖声明或内网 registry，而不是本轮编码实现本身。\n' +
        formatDependencyIssue(depIssue) +
        '\n这不表示可跳过 coding 出口或进入 Skill 4（Code Review）；须修复工程依赖或取得用户对放弃本阶段的明示后再执行 --clear-state。',
      suggestion:
        '不要把该问题交给用户手工猜。先向用户展示方案：A) 确认后在工程根执行包管理器安装并重跑；' +
        'B) 读取依赖清单文件输出缺失声明；C) registry/权限不确定时先确认内网源。' +
        '须向用户报告首条编译错误与 summary.next_action，禁止提议进入下一阶段。' +
        (!depIssue.harnessNodeModulesReady ? ' framework/harness/node_modules 缺失时可直接在 framework/harness 执行 npm install。' : ''),
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

/** profile 侧：真实编译闭环 + 失败归因（原根目录 checkCodingHvigorBuild）。 */
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

  const res = dispatchCodingCompile(ctx, {
    projectRoot: ctx.projectRoot,
    harnessRoot: HARNESS_ROOT,
    feature: ctx.feature,
    phase: 'coding',
    skipEnvVar: 'HARNESS_SKIP_HVIGOR',
  });

  const errs = res.errors ?? [];
  const passCompile =
    res.executed &&
    !res.timedOut &&
    res.exitCode === 0 &&
    errs.length === 0 &&
    res.successMarkerFound !== false;
  const isBad = res.toolMissing || res.skippedByEnv || !passCompile;

  const desc =
    ruleDesc(ctx, 'structure_checks', 'coding_compile') ||
    ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build');

  if (!isBad) {
    return duplicateCompileResults({
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: [
        `编译通过（涉及 ${modules.length} 个 contract 模块，耗时 ${res.durationMs} ms）。`,
        `命令：${res.command ?? '(unknown)'}`,
        `元数据：${res.metaPath ?? '(无)'}`,
        `完整日志：${res.logPath ?? '(无)'}`,
        ...(res.diagnostics?.length ? ['诊断提示：', ...res.diagnostics.map((d: string) => `  - ${d}`)] : []),
      ].join('\n'),
    });
  }

  const failure = classifyCodingCompileFailure(
    { ...res, errors: errs },
    ctx,
  );
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
      `exit_code=${res.exitCode}, durationMs=${res.durationMs}, timedOut=${Boolean(res.timedOut)}, successMarkerFound=${res.successMarkerFound ?? 'n/a'}`,
    );
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
      errs.slice(0, 10).forEach((e: { file?: string; line?: number; code?: string; message: string }) =>
        detailsLines.push(`  - ${e.file ?? ''}${e.line ? ':' + e.line : ''}  ${e.code ?? ''}  ${e.message}`),
      );
    }
    detailsLines.push('');
    detailsLines.push('日志尾部（最多 8 KB）：');
    detailsLines.push(res.logExcerpt ?? '');
  }

  return duplicateCompileResults({
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: detailsLines.join('\n'),
    affected_files: modules.map(m => `${m.name} (module)`),
    failure_kind: failure.kind,
    blocking_class:
      failure.kind === 'compile_timeout' ||
      failure.kind === 'compile_incomplete_output' ||
      failure.kind === 'project_build'
        ? CANONICAL_CODING_COMPILE_ID
        : failure.kind,
    suggestion: failure.suggestion,
  });
}

function runStructureChecks(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const out: CheckResult[] = [];
  out.push(...checkNoHardcodedStrings(ctx, analyses));
  out.push(...checkResourceIntegrity(ctx, analyses));
  out.push(...checkHarIndexExport(ctx));
  out.push(...checkModuleConfigRegistered(ctx));
  out.push(...checkOhPackageDependencies(ctx));
  out.push(...checkPageRegistration(ctx));
  out.push(...checkNamingConventions(ctx, analyses));
  out.push(...checkNoAnyType(ctx));
  out.push(...checkAsyncAwaitPattern(ctx));
  return out;
}

function runTraceabilityChecks(ctx: CheckContext): CheckResult[] {
  return [...checkDesignFilePlanToCode(ctx), ...checkCodeToDesign(ctx)];
}

export const profileCodingHost: ProfileCodingHost = {
  sourceFileSuffixes: ['.ets'],
  runStructureChecks,
  runTraceabilityChecks,
  checkCodingCompile,
};
