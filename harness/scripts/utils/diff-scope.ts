// 实际实现域与原需求范围共享判定。文件/模块预测只作线索；写入归属由阶段观察负责。
import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig, getOuterLayerIds } from '../../config';
import { loadCatalog, findModule } from './catalog-parser';
import { diffChangedFilesWithStatus, resolveEffectiveDiffBaseline, readFileAtRef } from './git-diff';
import { parseScope } from './scope-parser';
import { validateProjectRelativePath } from './project-relative-path';
import type { ContractsSpec } from './types';

// --------------------------------------------------------------------------
// 层级前缀与分类
// --------------------------------------------------------------------------

/**
 * "架构层级目录前缀"由 framework.config.json 的 outer_layers[].id 推导，
 * 每个 layer id 被追加 "/" 作为顶层目录前缀。
 */
export function layerDirPrefixes(projectRoot: string): string[] {
  return getOuterLayerIds(loadFrameworkConfig(projectRoot).architecture).map(id => `${id}/`);
}

export function isUnderLayerDir(relPath: string, prefixes: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return prefixes.some(prefix => normalized.startsWith(prefix));
}

export interface DiffScopeClassification {
  /** 层目录下且不在任何 in_scope 模块前缀内（越界） */
  violations: string[];
  /** 层目录下且命中 in_scope 模块前缀 */
  inScopeHits: string[];
  /** 不在任何层目录下（框架性/文档等中性变更） */
  neutralCount: number;
}

export function classifyChangedFiles(
  files: string[],
  allowedPrefixes: string[],
  layerPrefixes: string[],
): DiffScopeClassification {
  const violations: string[] = [];
  const inScopeHits: string[] = [];
  let neutralCount = 0;
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    if (!isUnderLayerDir(normalized, layerPrefixes)) {
      neutralCount++;
      continue;
    }
    const hit = allowedPrefixes.find(p => normalized.startsWith(p));
    if (hit) inScopeHits.push(normalized);
    else violations.push(normalized);
  }
  return { violations, inScopeHits, neutralCount };
}

// --------------------------------------------------------------------------
// 模块名 → 路径前缀解析（施工范围与责任边界共享）
// --------------------------------------------------------------------------

/** 规范化为目录前缀：正斜杠 + 恰一个尾随 "/" */
function toDirPrefix(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
}

export interface ModulePrefixResolution {
  /** 已解析出的 in_scope 模块目录前缀（正斜杠、含尾随 /） */
  allowedPrefixes: string[];
  /** 无法映射到路径前缀的模块名（fail-closed 判定的证据） */
  unmapped: string[];
  /** moduleName → 目录前缀（已解析成功的模块） */
  prefixByModule: Map<string, string>;
  /** moduleName → 映射来源描述（contracts / catalog.entry_file / layer-dir） */
  sources: Map<string, string>;
}

/**
 * 把 in_scope 模块名解析为目录前缀，三级回退：
 *   1. contracts.yaml modules[].package_path
 *   2. module-catalog.yaml modules[].entry_file 的 dirname（catalog 是模块画像 SSOT）
 *   3. `<layer>/<name>/` 目录在磁盘上真实存在（catalog 有卡片但缺 entry_file 时的
 *      保守回退——目录不存在则不猜，计入 unmapped）
 * 全部失败 → 计入 unmapped，由调用方按 fail-closed 语义处置。
 */
export function resolveModulePathPrefixes(
  projectRoot: string,
  moduleNames: string[],
  contractsModules?: Array<{ name?: string; package_path?: string }>,
): ModulePrefixResolution {
  const allowedPrefixes: string[] = [];
  const unmapped: string[] = [];
  const prefixByModule = new Map<string, string>();
  const sources = new Map<string, string>();

  const addMapping = (name: string, prefix: string, source: string): void => {
    allowedPrefixes.push(prefix);
    prefixByModule.set(name, prefix);
    sources.set(name, source);
  };

  const contractsByName = new Map<string, string>();
  for (const mod of contractsModules ?? []) {
    if (mod?.name && mod.package_path) contractsByName.set(mod.name, mod.package_path);
  }

  const catalogLoad = loadCatalog(projectRoot);
  const catalog = catalogLoad.ok ? catalogLoad.catalog : null;

  for (const name of moduleNames) {
    const fromContracts = contractsByName.get(name);
    if (fromContracts) {
      addMapping(name, toDirPrefix(fromContracts), `contracts.yaml package_path=${fromContracts}`);
      continue;
    }

    const card = catalog ? findModule(catalog, name) : undefined;
    if (card?.entry_file) {
      const dir = path.posix.dirname(card.entry_file.replace(/\\/g, '/'));
      if (dir && dir !== '.') {
        addMapping(name, toDirPrefix(dir), `catalog entry_file=${card.entry_file}`);
        continue;
      }
    }
    if (card?.layer) {
      const guess = `${card.layer}/${name}`;
      if (fs.existsSync(path.join(projectRoot, guess))) {
        addMapping(name, toDirPrefix(guess), `layer-dir ${guess}/（磁盘存在性验证）`);
        continue;
      }
    }

    unmapped.push(name);
  }

  return { allowedPrefixes, unmapped, prefixByModule, sources };
}

/** Project source domains are not the predicted set of modules for one implementation. */
export function projectImplementationModules(projectRoot: string,
  hints: Array<{ name?: string; package_path?: string }> = []): Array<{ name: string; package_path: string }> {
  const modules = new Map<string, { name: string; package_path: string }>();
  const add = (name: string, rel: string): void => {
    const safe = validateProjectRelativePath(projectRoot, rel, 'implementation module');
    const physical = fs.existsSync(path.join(projectRoot, safe)) ? fs.realpathSync(path.join(projectRoot, safe)) : path.resolve(projectRoot, safe);
    const relative = path.relative(fs.realpathSync(projectRoot), physical).split(path.sep).join('/');
    const identity = process.platform === 'win32' ? relative.toLowerCase() : relative;
    if (identity === 'framework' || identity.startsWith('framework/')) return;
    if (!modules.has(safe)) modules.set(safe, { name, package_path: safe });
  };
  for (const mod of hints) if (mod.name && mod.package_path) add(mod.name, mod.package_path);
  for (const prefix of layerDirPrefixes(projectRoot)) {
    const dir = path.join(projectRoot, prefix);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) add(entry.name, prefix + entry.name);
    }
  }
  return [...modules.values()].sort((a, b) => a.package_path.localeCompare(b.package_path));
}

/** Only a Scope in the original request is an explicit machine-readable restriction. */
export function resolveImplementationScope(projectRoot: string, feature: string,
  hints: Array<{ name?: string; package_path?: string }> = [], runId?: string) {
  const modules = projectImplementationModules(projectRoot, hints);
  const { collectCurrentRequirementText } = require('./fidelity-shared') as typeof import('./fidelity-shared');
  const requirement = collectCurrentRequirementText(projectRoot, feature,
    loadFrameworkConfig(projectRoot).paths?.features_dir ?? 'doc/features', runId);
  const explicit = parseScope(requirement).scope;
  const selected = explicit ? modules.filter(module => explicit.in_scope_modules.includes(module.name)
    && !explicit.out_of_scope_modules.includes(module.name)) : modules;
  return { modules, sourcePrefixes: [...new Set([...layerDirPrefixes(projectRoot), ...modules.map(module => toDirPrefix(module.package_path))])], allowedPrefixes: selected.map(module => toDirPrefix(module.package_path)),
    explicit, requirement };
}

/** Actual changed files plus existing planning references; never persisted as another inventory. */
export function implementationFiles(projectRoot: string, feature: string, contracts?: Pick<ContractsSpec, 'files' | 'modules'>,
  runId?: string): string[] {
  let diff: ReturnType<typeof diffChangedFilesWithStatus> | null = null;
  try {
    const baseline = resolveEffectiveDiffBaseline(projectRoot, feature, runId);
    if (baseline.available) diff = diffChangedFilesWithStatus({ projectRoot, baseRef: baseline.baseSha });
  } catch { /* Input-only consumers keep their readable references; the diff gate diagnoses an unavailable baseline. */ }
  const layerPrefixes = [...layerDirPrefixes(projectRoot), ...projectImplementationModules(projectRoot, contracts?.modules).map(module => toDirPrefix(module.package_path))];
  const files = new Set(contracts?.files ?? []);
  for (const entry of diff?.entries ?? []) {
    if (isUnderLayerDir(entry.path, layerPrefixes)) files.add(entry.path);
    if (entry.oldPath && isUnderLayerDir(entry.oldPath, layerPrefixes)) files.add(entry.oldPath);
  }
  return [...files].map(file => validateProjectRelativePath(projectRoot, file, 'implementation input'))
    .filter(file => fs.existsSync(path.join(projectRoot, file)) && fs.statSync(path.join(projectRoot, file)).isFile()).sort();
}

/** Removed/renamed source stays available to semantic review without pretending it exists now. */
export function implementationChangeContext(projectRoot: string, feature: string, runId?: string, modules: Array<{ name?: string; package_path?: string }> = []): import('./types').ContextFileEntry[] {
  try {
    const baseline = resolveEffectiveDiffBaseline(projectRoot, feature, runId);
    if (!baseline.available) return [];
    const diff = diffChangedFilesWithStatus({ projectRoot, baseRef: baseline.baseSha });
    if (!diff.executed) return [];
    const prefixes = [...layerDirPrefixes(projectRoot), ...projectImplementationModules(projectRoot, modules).map(module => toDirPrefix(module.package_path))];
    const entries = diff.entries.filter(entry => isUnderLayerDir(entry.path, prefixes)
      || !!entry.oldPath && isUnderLayerDir(entry.oldPath, prefixes));
    if (!entries.length) return [];
    const result: import('./types').ContextFileEntry[] = [{ label: '(actual implementation changes)', kind: 'text',
      content: '基线 diff 供审查，不直接证明由本阶段写入；归属以现有调用观察为准，不接管其它任务的既有改动。\n' + entries.map(entry => entry.status + ': ' + (entry.oldPath ? entry.oldPath + ' -> ' : '') + entry.path).join('\n') }];
    for (const entry of entries) {
      const prior = entry.status === 'D' ? entry.path : entry.oldPath;
      if (!prior) continue;
      const bytes = readFileAtRef(projectRoot, baseline.baseSha, prior);
      if (!bytes || bytes.includes(0)) continue;
      result.push({ label: '(before ' + baseline.baseSha + ') ' + prior, kind: 'text', content: bytes.toString('utf8') });
    }
    return result;
  } catch { return []; }
}
