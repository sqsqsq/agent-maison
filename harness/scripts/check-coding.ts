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
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
  ContractsSpec,
} from './utils/types';
import { AstAnalyzer, FileAnalysis } from './utils/ast-analyzer';
import { parseScope, describeScopeError } from './utils/scope-parser';
import { scanNamedBusinessHandler } from './utils/named-handler';
import { runHvigorBuild, runHvigorAssembleApp } from './utils/hvigor-runner';
import {
  loadFrameworkConfig,
  getOuterLayerIds,
  featureFilePath,
  relFeatureFile,
} from '../config';

const HARNESS_ROOT = path.resolve(__dirname, '..');

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

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

export interface HarExportEntryResolution {
  relPath: string;
  source: 'oh-package.json5 main' | 'framework.config fallback';
  warning?: string;
  error?: string;
}

function normalizeRelativePath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function resolveHarExportEntryPath(
  projectRoot: string,
  mod: Pick<ContractsSpec['modules'][number], 'name' | 'package_path'>,
  indexFileName: string,
): HarExportEntryResolution {
  const packagePath = normalizeRelativePath(mod.package_path);
  const ohPackagePath = path.join(projectRoot, packagePath, 'oh-package.json5');
  const ohPackageContent = readFileIfExists(ohPackagePath);

  if (ohPackageContent) {
    try {
      const ohPkg = parseJson5(ohPackageContent) as Record<string, unknown>;
      const main = typeof ohPkg.main === 'string' ? ohPkg.main.trim() : '';
      if (main) {
        const normalizedMain = normalizeRelativePath(main);
        if (path.posix.basename(normalizedMain) !== indexFileName) {
          return {
            relPath: `${packagePath}/${normalizedMain}`,
            source: 'oh-package.json5 main',
            error: `${mod.name}: oh-package.json5 main 指向 ${normalizedMain}，但架构约定 HAR 导出入口文件名必须是 ${indexFileName}`,
          };
        }
        return {
          relPath: `${packagePath}/${normalizedMain}`,
          source: 'oh-package.json5 main',
        };
      }
    } catch {
      return {
        relPath: `${packagePath}/src/main/ets/${indexFileName}`,
        source: 'framework.config fallback',
        warning: `${mod.name}: oh-package.json5 解析失败，已回退到默认出口路径`,
      };
    }
  }

  return {
    relPath: `${packagePath}/src/main/ets/${indexFileName}`,
    source: 'framework.config fallback',
  };
}

function ruleDesc(ctx: CheckContext, section: 'structure_checks' | 'semantic_checks' | 'traceability_checks', id: string): string {
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
    } catch { /* skip malformed */ }
  }
  return keys;
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
    return [{ id: 'layer_compliance', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'layer_compliance'), severity: 'BLOCKER', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? `${analyses.length} 个文件均符合模块内分层规则。` : '无 .ets 文件可分析。' }];
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
    return [{ id: 'inter_module_dependency', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'inter_module_dependency'), severity: 'BLOCKER', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? `${analyses.length} 个文件均符合分层依赖规则。` : '无 .ets 文件可分析。' }];
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

function checkNoHardcodedStrings(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const hits: Array<{ file: string; value: string; line: number }> = [];
  for (const a of analyses) {
    for (const hs of a.hardcodedStrings) {
      hits.push({ file: a.filePath, value: hs.value, line: hs.lineNumber });
    }
  }

  if (hits.length === 0) {
    return [{ id: 'no_hardcoded_strings', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'no_hardcoded_strings'), severity: 'MAJOR', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? '未发现硬编码中文字符串。' : '无 presentation 层文件可分析。' }];
  }

  const details = hits.slice(0, 10).map(h => `  - ${h.file}:${h.line} → "${h.value}"`).join('\n');
  return [{
    id: 'no_hardcoded_strings', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'no_hardcoded_strings'),
    severity: 'MAJOR', status: 'WARN',
    details: `${hits.length} 处硬编码中文字符串：\n${details}${hits.length > 10 ? `\n  ... 还有 ${hits.length - 10} 处` : ''}`,
    affected_files: [...new Set(hits.map(h => h.file))],
    suggestion: "请将 UI 文本替换为 $r('app.string.xxx') 资源引用。",
  }];
}

function checkResourceIntegrity(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) {
    return [{ id: 'resource_integrity', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 不存在，跳过资源引用检查。' }];
  }

  const resourceKeys = collectResourceKeys(ctx.projectRoot, contracts);
  const totalKeys = Array.from(resourceKeys.values()).reduce((s, set) => s + set.size, 0);
  const totalRefs = analyses.reduce((s, a) => s + a.resourceRefs.length, 0);

  if (totalKeys === 0 && totalRefs > 0) {
    return [{ id: 'resource_integrity', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'), severity: 'BLOCKER', status: 'SKIP', details: '未找到资源 JSON 文件，无法验证 $r() 引用。' }];
  }
  if (totalRefs === 0) {
    return [{ id: 'resource_integrity', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'), severity: 'BLOCKER', status: 'SKIP', details: '未发现 $r() 引用。' }];
  }

  const missing: Array<{ file: string; ref: string; type: string; key: string; line: number }> = [];
  for (const a of analyses) {
    for (const ref of a.resourceRefs) {
      const set = resourceKeys.get(ref.resourceType);
      if (!set || !set.has(ref.key)) {
        missing.push({ file: a.filePath, ref: ref.raw, type: ref.resourceType, key: ref.key, line: ref.lineNumber });
      }
    }
  }

  if (missing.length === 0) {
    return [{ id: 'resource_integrity', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${totalRefs} 处 $r() 引用均有对应资源定义。` }];
  }

  const details = missing.slice(0, 10).map(m => `  - ${m.file}:${m.line} → ${m.ref} (${m.type}.${m.key} 未定义)`).join('\n');
  return [{
    id: 'resource_integrity', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'resource_integrity'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length} 处 $r() 引用缺少资源定义：\n${details}${missing.length > 10 ? `\n  ... 还有 ${missing.length - 10} 处` : ''}`,
    affected_files: [...new Set(missing.map(m => m.file))],
    suggestion: '在对应模块的 resources/base/element/*.json 中补充缺失的资源 key。',
  }];
}

function checkHarIndexExport(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [{ id: 'har_index_export', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'har_index_export'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 无 modules 列表。' }];
  }

  const harModules = contracts.modules.filter(m => m.format === 'HAR');
  if (harModules.length === 0) {
    return [{ id: 'har_index_export', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'har_index_export'), severity: 'BLOCKER', status: 'SKIP', details: '无 HAR 格式模块。' }];
  }

  const cfg = loadFrameworkConfig(ctx.projectRoot);
  const indexFileName = cfg.architecture.cross_module_exports_file;

  const missing: string[] = [];
  const warnings: string[] = [];
  const invalidEntries: string[] = [];
  let ohPackageMainCount = 0;
  for (const mod of harModules) {
    const entry = resolveHarExportEntryPath(ctx.projectRoot, mod, indexFileName);
    if (entry.source === 'oh-package.json5 main') ohPackageMainCount += 1;
    if (entry.warning) warnings.push(entry.warning);
    if (entry.error) invalidEntries.push(entry.error);
    if (!fs.existsSync(path.join(ctx.projectRoot, entry.relPath))) missing.push(entry.relPath);
  }

  if (missing.length === 0 && invalidEntries.length === 0) {
    const sourceDetails = ohPackageMainCount > 0
      ? `其中 ${ohPackageMainCount} 个模块按 oh-package.json5 main 定位入口。`
      : `均按 framework.config.json 的 architecture.cross_module_exports_file=${indexFileName} 默认路径定位。`;
    return [{
      id: 'har_index_export',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `全部 ${harModules.length} 个 HAR 模块均有导出入口。${sourceDetails}${warnings.length > 0 ? `\n${warnings.join('\n')}` : ''}`,
    }];
  }

  return [{
    id: 'har_index_export', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'har_index_export'),
    severity: 'BLOCKER', status: 'FAIL',
    details: [
      missing.length > 0 ? `${missing.length}/${harModules.length} 个 HAR 模块缺少导出入口：\n${truncateList(missing, 15)}` : '',
      invalidEntries.length > 0 ? `${invalidEntries.length}/${harModules.length} 个 HAR 模块入口文件名不符合架构约定：\n${truncateList(invalidEntries, 15)}` : '',
      warnings.length > 0 ? warnings.join('\n') : '',
    ].filter(Boolean).join('\n\n'),
    affected_files: [...missing, ...invalidEntries],
    suggestion: `HAR 模块入口文件名必须是 ${indexFileName}。oh-package.json5 的 main 可以指向模块根目录或 src/main/ets 下的 ${indexFileName}；未声明 main 时，默认检查 src/main/ets/${indexFileName}。`,
  }];
}

function checkModuleConfigRegistered(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length) {
    return [{ id: 'module_config_registered', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 无 modules 列表。' }];
  }

  const content = readFileIfExists(path.join(ctx.projectRoot, 'build-profile.json5'));
  if (!content) {
    return [{ id: 'module_config_registered', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'), severity: 'BLOCKER', status: 'SKIP', details: 'build-profile.json5 不存在，跳过模块注册检查。' }];
  }

  let buildProfile: Record<string, unknown>;
  try {
    buildProfile = parseJson5(content) as Record<string, unknown>;
  } catch {
    return [{ id: 'module_config_registered', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'), severity: 'BLOCKER', status: 'WARN', details: 'build-profile.json5 解析失败，无法验证模块注册。' }];
  }

  const registeredNames = new Set<string>();
  const modules = (buildProfile.modules as Array<{ name?: string }>) ?? [];
  for (const m of modules) { if (m.name) registeredNames.add(m.name); }

  const newModules = contracts.modules.filter(m => m.change_type === 'new');
  const missing = newModules.filter(m => !registeredNames.has(m.name)).map(m => m.name);

  if (missing.length === 0) {
    return [{ id: 'module_config_registered', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'), severity: 'BLOCKER', status: newModules.length > 0 ? 'PASS' : 'SKIP', details: newModules.length > 0 ? `全部 ${newModules.length} 个新增模块已在 build-profile.json5 注册。` : '无新增模块需要注册。' }];
  }

  return [{
    id: 'module_config_registered', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'module_config_registered'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length} 个新增模块未在 build-profile.json5 注册：${missing.join(', ')}`,
    affected_files: ['build-profile.json5'],
    suggestion: '请在 build-profile.json5 的 modules[] 中添加缺失模块，srcPath 格式为 "./{layer_dir}/{ModuleName}"。',
  }];
}

function checkOhPackageDependencies(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.modules?.length || !contracts.module_dependencies) {
    return [{ id: 'oh_package_dependencies', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 无 modules 或 module_dependencies 定义。' }];
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

    const declaredDeps = Object.keys((ohPkg.dependencies as Record<string, string>) ?? {});
    const expectedDeps = contracts.module_dependencies[mod.name] ?? [];

    for (const expected of expectedDeps) {
      const found = declaredDeps.some(d => d.toLowerCase().includes(expected.toLowerCase()));
      if (!found) issues.push(`${mod.name}: 缺少对 ${expected} 的依赖声明`);
    }
  }

  if (checked === 0) {
    return [{ id: 'oh_package_dependencies', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'), severity: 'BLOCKER', status: 'SKIP', details: '未找到任何模块的 oh-package.json5 文件。' }];
  }

  if (issues.length === 0) {
    return [{ id: 'oh_package_dependencies', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'), severity: 'BLOCKER', status: 'PASS', details: `已检查 ${checked} 个模块的 oh-package.json5 依赖声明，均符合要求。` }];
  }

  return [{
    id: 'oh_package_dependencies', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'oh_package_dependencies'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `依赖声明问题：\n${issues.map(i => `  - ${i}`).join('\n')}`,
    suggestion: '请在 oh-package.json5 中补充缺失的依赖声明。',
  }];
}

function checkPageRegistration(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const nav = contracts?.navigation as Record<string, unknown> | undefined;
  const configFiles = (nav?.config_files ?? []) as string[];
  const components = contracts?.components ?? [];

  const navPages = components.filter(c => c.nav_destination).map(c => ({
    name: c.name,
    dest: c.nav_destination!,
    file: c.file,
  }));

  if (navPages.length === 0) {
    return [{ id: 'page_registration', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_registration'), severity: 'BLOCKER', status: 'SKIP', details: '无 NavDestination 页面需要检查。' }];
  }

  let configContent = '';
  for (const cf of configFiles) {
    const c = readFileIfExists(path.join(ctx.projectRoot, cf));
    if (c) configContent += c;
  }

  if (!configContent) {
    return [{ id: 'page_registration', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_registration'), severity: 'BLOCKER', status: 'SKIP', details: '导航配置文件 (main_pages.json / route_map.json) 不存在。' }];
  }

  const unregistered = navPages.filter(p => !configContent.includes(p.dest) && !configContent.includes(p.name));

  if (unregistered.length === 0) {
    return [{ id: 'page_registration', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'page_registration'), severity: 'BLOCKER', status: 'PASS', details: `全部 ${navPages.length} 个 NavDestination 页面已在配置文件中注册。` }];
  }

  return [{
    id: 'page_registration', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'page_registration'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${unregistered.length} 个页面未在配置文件中注册：\n${unregistered.map(u => `  - ${u.name} (nav_destination: ${u.dest})`).join('\n')}`,
    affected_files: configFiles,
    suggestion: '请在 main_pages.json 和/或 route_map.json 中注册页面。',
  }];
}

function checkNamingConventions(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[] {
  const violations: string[] = [];
  const affectedFiles: string[] = [];
  const pascalRe = /^[A-Z][a-zA-Z0-9]*$/;
  const snakeRe = /^[a-z][a-z0-9_]*$/;

  for (const a of analyses) {
    const fileName = path.basename(a.filePath, '.ets');
    if (a.filePath.endsWith('.ets') && !pascalRe.test(fileName) && fileName !== 'Index') {
      violations.push(`文件名 ${a.filePath} 不是 PascalCase`);
      affectedFiles.push(a.filePath);
    }

    for (const cls of a.classes) {
      if (cls.kind === 'struct' && cls.decorators.includes('Component')) {
        if (cls.name !== fileName && fileName !== 'Index') {
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
    return [{ id: 'naming_conventions', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'naming_conventions'), severity: 'MAJOR', status: analyses.length > 0 ? 'PASS' : 'SKIP', details: analyses.length > 0 ? '命名规范检查通过。' : '无文件可分析。' }];
  }

  return [{
    id: 'naming_conventions', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'naming_conventions'),
    severity: 'MAJOR', status: 'WARN',
    details: `${violations.length} 处命名规范问题：\n${violations.slice(0, 10).map(v => `  - ${v}`).join('\n')}${violations.length > 10 ? `\n  ... 还有 ${violations.length - 10} 处` : ''}`,
    affected_files: [...new Set(affectedFiles)],
    suggestion: '模块名/组件名/文件名使用 PascalCase，资源 key 使用 snake_case。',
  }];
}

function checkNoAnyType(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const etsFiles = contracts?.files?.filter(f => f.endsWith('.ets')) ?? [];
  if (etsFiles.length === 0) {
    return [{ id: 'no_any_type', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'no_any_type'), severity: 'MAJOR', status: 'SKIP', details: '无 .ets 文件列表。' }];
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
    return [{ id: 'no_any_type', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'no_any_type'), severity: 'MAJOR', status: 'PASS', details: '未发现 any 类型使用。' }];
  }

  return [{
    id: 'no_any_type', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'no_any_type'),
    severity: 'MAJOR', status: 'WARN',
    details: `${hits.length} 处 any 类型使用：\n${hits.slice(0, 10).map(h => `  - ${h.file}:${h.line} → ${h.text}`).join('\n')}${hits.length > 10 ? `\n  ... 还有 ${hits.length - 10} 处` : ''}`,
    affected_files: [...new Set(hits.map(h => h.file))],
    suggestion: '请替换为具体类型或 unknown。',
  }];
}

function checkAsyncAwaitPattern(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const etsFiles = contracts?.files?.filter(f => f.endsWith('.ets')) ?? [];
  if (etsFiles.length === 0) {
    return [{ id: 'async_await_pattern', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'async_await_pattern'), severity: 'MINOR', status: 'SKIP', details: '无 .ets 文件列表。' }];
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
    return [{ id: 'async_await_pattern', category: 'structure', description: ruleDesc(ctx, 'structure_checks', 'async_await_pattern'), severity: 'MINOR', status: 'PASS', details: '未发现 .then()/.catch() 回调链。' }];
  }

  return [{
    id: 'async_await_pattern', category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'async_await_pattern'),
    severity: 'MINOR', status: 'WARN',
    details: `${hits.length} 处 .then()/.catch() 回调链：\n${hits.slice(0, 10).map(h => `  - ${h.file}:${h.line} → ${h.text}`).join('\n')}${hits.length > 10 ? `\n  ... 还有 ${hits.length - 10} 处` : ''}`,
    affected_files: [...new Set(hits.map(h => h.file))],
    suggestion: '请使用 async/await 替代 .then()/.catch() 链。',
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

function checkDesignFilePlanToCode(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.files?.length) {
    return [{ id: 'design_file_plan_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'design_file_plan_to_code'), severity: 'BLOCKER', status: 'SKIP', details: 'contracts.yaml 无 files 列表。' }];
  }

  const etsFiles = contracts.files.filter(f => f.endsWith('.ets'));
  const missing: string[] = [];
  for (const f of etsFiles) {
    if (!fs.existsSync(path.join(ctx.projectRoot, f))) missing.push(f);
  }

  if (missing.length === 0) {
    return [{ id: 'design_file_plan_to_code', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'design_file_plan_to_code'), severity: 'BLOCKER', status: 'PASS', details: `设计规划的全部 ${etsFiles.length} 个 .ets 文件均已实现。` }];
  }

  return [{
    id: 'design_file_plan_to_code', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'design_file_plan_to_code'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${missing.length}/${etsFiles.length} 个规划 .ets 文件缺失：\n${truncateList(missing, 15)}`,
    affected_files: missing,
    suggestion: '请按照 design.md 目录/文件结构规划补全缺失的 .ets 文件。',
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

function getDiffBaseRef(): { ref: string; mode: 'committed' | 'working' } {
  const envRef = (process.env.HARNESS_DIFF_BASE_REF ?? '').trim();
  if (envRef.toLowerCase() === 'working') return { ref: 'HEAD', mode: 'working' };
  if (envRef.length > 0) return { ref: envRef, mode: 'committed' };
  return { ref: 'HEAD~1', mode: 'committed' };
}

function gitDiffFiles(projectRoot: string, baseRef: string, mode: 'committed' | 'working'): { files: string[] | null; error?: string } {
  try {
    const args = mode === 'working'
      ? ['diff', '--name-only', baseRef, '--']
      : ['diff', '--name-only', baseRef, 'HEAD', '--'];
    const cmd = `git ${args.map(a => JSON.stringify(a)).join(' ')}`;
    const out = execSync(cmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return { files };
  } catch (err) {
    return { files: null, error: (err as Error).message };
  }
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

  const { ref, mode } = getDiffBaseRef();
  const { files, error: diffErr } = gitDiffFiles(ctx.projectRoot, ref, mode);
  if (files === null) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'SKIP',
      details: `无法执行 git diff（base=${ref}, mode=${mode}）：${diffErr ?? '未知错误'}`,
      suggestion:
        '设置环境变量 HARNESS_DIFF_BASE_REF 指向合适的 base ref（如 main 或 HEAD~N），或 "working" 比对工作区与 HEAD。',
    }];
  }

  if (files.length === 0) {
    return [{
      id: 'diff_within_scope', category: 'traceability',
      description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
      severity: 'BLOCKER', status: 'PASS',
      details: `git diff（base=${ref}, mode=${mode}）无变更文件。`,
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
      details: `git diff（base=${ref}）共 ${files.length} 个变更文件：${inScopeHits.length} 个在 in_scope 模块内，${neutralCount.value} 个为框架性变更（doc/specs/harness/skills 等），0 个越界。`,
    }];
  }

  return [{
    id: 'diff_within_scope', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'diff_within_scope'),
    severity: 'BLOCKER', status: 'FAIL',
    details: `${violations.length} 个变更文件越界到 in_scope_modules 之外的模块：\n${truncateList(violations, 15)}\n\nin_scope_modules: ${scope.in_scope_modules.join('、')}\nbase ref: ${ref}（mode=${mode}）`,
    suggestion:
      '若这些改动确属本需求必须：回到 Skill 2 的 Step 2.5.3 发起 scope 扩展提议，用户同意后在 design.md 的 expansions_with_user_approval 中登记，并把涉及模块加入 in_scope_modules。\n若属误改：用 `git checkout` / `git restore` 撤销越界文件。',
    affected_files: violations,
  }];
}

function checkCodeToDesign(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts?.files?.length || !contracts?.modules?.length) {
    return [{ id: 'code_to_design', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'code_to_design'), severity: 'MAJOR', status: 'SKIP', details: 'contracts.yaml 无 files 或 modules 列表。' }];
  }

  const plannedEts = new Set(contracts.files.filter(f => f.endsWith('.ets')).map(f => f.replace(/\\/g, '/')));
  const unexpected: string[] = [];

  for (const mod of contracts.modules) {
    const etsDir = path.join(ctx.projectRoot, mod.package_path, 'src', 'main', 'ets');
    if (!fs.existsSync(etsDir)) continue;

    const scanDir = (dir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { scanDir(full); }
        else if (entry.name.endsWith('.ets')) {
          const rel = path.relative(ctx.projectRoot, full).replace(/\\/g, '/');
          if (!plannedEts.has(rel)) unexpected.push(rel);
        }
      }
    };
    scanDir(etsDir);
  }

  if (unexpected.length === 0) {
    return [{ id: 'code_to_design', category: 'traceability', description: ruleDesc(ctx, 'traceability_checks', 'code_to_design'), severity: 'MAJOR', status: 'PASS', details: '所有 .ets 文件均在 contracts.yaml 的规划中。' }];
  }

  return [{
    id: 'code_to_design', category: 'traceability',
    description: ruleDesc(ctx, 'traceability_checks', 'code_to_design'),
    severity: 'MAJOR', status: 'WARN',
    details: `${unexpected.length} 个 .ets 文件不在 contracts.yaml 的规划中：\n${truncateList(unexpected, 15)}`,
    affected_files: unexpected,
    suggestion: '请确认这些文件是否应在 design.md / contracts.yaml 中补充规划。',
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

/**
 * v2.2 方案 B：对 contracts.yaml 声明的每个业务模块跑 hvigorw assembleHap，
 * 真实编译失败时以 BLOCKER FAIL 阻塞出口。
 * 工具链缺失 / HARNESS_SKIP_HVIGOR=1 均翻译为 FAIL（显式拒绝软通过）。
 */
function checkCodingHvigorBuild(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const modules = contracts?.modules ?? [];
  if (modules.length === 0) {
    return [{
      id: 'coding_hvigor_build',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'contracts.yaml > modules 为空，无法确定本 feature 影响的模块；请先在 contracts.yaml 声明。',
    }];
  }

  // v2.3：改用项目级 `assembleApp` 一次通吃所有模块，避免 library 模块
  // （HAR/HSP）没有 assembleHap task 导致的 "Task was not found" 假阳性。
  // Library-only feature 也能被覆盖，因为 assembleApp 的依赖图会拉起所有
  // 被 Phone/entry 间接引用的模块；纯孤立模块虽然不被 app 引用，但通常
  // 也无法作为最终交付，放过即可。
  const res = runHvigorAssembleApp({
    projectRoot: ctx.projectRoot,
    harnessRoot: HARNESS_ROOT,
    feature: ctx.feature,
    phase: 'coding',
    skipEnvVar: 'HARNESS_SKIP_HVIGOR',
  });

  const isBad = res.toolMissing || res.skippedByEnv || (res.executed && (res.exitCode !== 0 || res.errors.length > 0));

  if (!isBad) {
    return [{
      id: 'coding_hvigor_build',
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: [
        `项目级 assembleApp 通过（涉及 ${modules.length} 个 contract 模块，耗时 ${res.durationMs} ms）。`,
        `命令：${res.command ?? '(unknown)'}`,
        ...(res.diagnostics?.length ? ['诊断提示：', ...res.diagnostics.map(d => `  - ${d}`)] : []),
      ].join('\n'),
    }];
  }

  const first = res;
  const failureKind = first.toolMissing
    ? 'toolchain'
    : first.skippedByEnv
      ? 'env_skip'
      : 'project_build';
  const detailsLines: string[] = [];
  detailsLines.push('项目级 assembleApp 失败：');
  if (first.toolMissing) {
    detailsLines.push('原因：未找到 hvigor 可执行文件（v2.3 起需通过 framework.config.json 声明 DevEco 路径）。');
    first.logExcerpt.split(/\r?\n/).forEach(l => detailsLines.push(l));
    detailsLines.push('本规则不接受 SKIP —— 真实编译是出口条件。');
  } else if (first.skippedByEnv) {
    detailsLines.push('原因：HARNESS_SKIP_HVIGOR=1 已设置。');
    detailsLines.push('修复指引：去掉该环境变量并重跑。显式跳过真实编译不被允许作为出口。');
  } else {
    detailsLines.push(`exit_code=${first.exitCode}, durationMs=${first.durationMs}`);
    detailsLines.push(`命令：${first.command ?? '(unknown)'}`);
    detailsLines.push(`日志落盘：${first.logPath ?? '(未落盘)'}`);
    if (first.diagnostics?.length) {
      detailsLines.push('诊断提示：');
      first.diagnostics.forEach(d => detailsLines.push(`  - ${d}`));
    }
    if (first.errors.length > 0) {
      detailsLines.push(`解析出 ${first.errors.length} 条 error（前 10 条）：`);
      first.errors.slice(0, 10).forEach(e =>
        detailsLines.push(`  - ${e.file ?? ''}${e.line ? ':' + e.line : ''}  ${e.code ?? ''}  ${e.message}`)
      );
    }
    detailsLines.push('');
    detailsLines.push('日志尾部（最多 8 KB）：');
    detailsLines.push(first.logExcerpt);
  }

  return [{
    id: 'coding_hvigor_build',
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', 'coding_hvigor_build'),
    severity: 'BLOCKER',
    status: 'FAIL',
    details: detailsLines.join('\n'),
    affected_files: modules.map(m => `${m.name} (module)`),
    failure_kind: failureKind,
    blocking_class: failureKind === 'project_build' ? 'coding_hvigor_build' : failureKind,
    suggestion:
      '读取完整日志（details 中的 `日志落盘` 路径），定位文件/行并回到编码阶段修复。' +
      '该规则是真实编译闭环的出口，禁止用 SKIP / WARN 绕过。',
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
  const hvigor = results.find(r => r.id === 'coding_hvigor_build');
  const contracts = ctx.featureSpec.contracts;
  const hasContractsFiles = Boolean(contracts?.files?.length);
  const hasContractsModules = Boolean(contracts?.modules?.length);
  const canClaimDone = blockerFails.length === 0 && criticalSkips.length === 0;

  const lines: string[] = [];
  lines.push(`can_claim_done: ${canClaimDone ? 'YES' : 'NO'}`);
  lines.push(`contracts.files: ${hasContractsFiles ? contracts!.files!.length : 0}`);
  lines.push(`contracts.modules: ${hasContractsModules ? contracts!.modules!.length : 0}`);
  lines.push(`hvigor_build: ${hvigor?.status ?? 'MISSING'}`);
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
    const contracts = ctx.featureSpec.contracts;

    const analyzer = new AstAnalyzer(ctx.projectRoot);
    const etsFiles = contracts?.files?.filter(f => f.endsWith('.ets')) ?? [];
    const analyses = analyzer.analyzeFiles(etsFiles);

    const results: CheckResult[] = [];

    // --- Structure checks ---
    results.push(...safeRun(() => checkFileCompleteness(ctx), 'file_completeness'));
    results.push(...safeRun(() => checkLayerCompliance(ctx, analyses), 'layer_compliance'));
    results.push(...safeRun(() => checkInterModuleDependency(ctx, analyses), 'inter_module_dependency'));
    results.push(...safeRun(() => checkNoHardcodedStrings(ctx, analyses), 'no_hardcoded_strings'));
    results.push(...safeRun(() => checkResourceIntegrity(ctx, analyses), 'resource_integrity'));
    results.push(...safeRun(() => checkHarIndexExport(ctx), 'har_index_export'));
    results.push(...safeRun(() => checkModuleConfigRegistered(ctx), 'module_config_registered'));
    results.push(...safeRun(() => checkOhPackageDependencies(ctx), 'oh_package_dependencies'));
    results.push(...safeRun(() => checkPageRegistration(ctx), 'page_registration'));
    results.push(...safeRun(() => checkNamingConventions(ctx, analyses), 'naming_conventions'));
    results.push(...safeRun(() => checkNoAnyType(ctx), 'no_any_type'));
    results.push(...safeRun(() => checkAsyncAwaitPattern(ctx), 'async_await_pattern'));
    results.push(...safeRun(() => checkNamedBusinessHandlerCoding(ctx), 'named_business_handler'));
    results.push(...safeRun(() => checkCoordinatorFileExistsIfDeclared(ctx), 'coordinator_file_exists_if_declared'));
    // v2.2 方案 B：hvigor 真实编译（Skill 3 的编译闭环出口）
    results.push(...safeRun(() => checkCodingHvigorBuild(ctx), 'coding_hvigor_build'));

    // --- Traceability checks ---
    results.push(...safeRun(() => checkDesignToCode(ctx), 'design_to_code'));
    results.push(...safeRun(() => checkDesignFilePlanToCode(ctx), 'design_file_plan_to_code'));
    results.push(...safeRun(() => checkCodeToDesign(ctx), 'code_to_design'));
    results.push(...safeRun(() => checkDiffWithinScope(ctx), 'diff_within_scope'));

    results.push(buildCodingRunStatusResult(ctx, results));

    return results;
  },
};

export default checker;
