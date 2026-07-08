// ============================================================================
// diff 越界防护共享核心 — diff-scope.ts（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// `diff_within_scope` 是红线（决策 4：任何档位不豁免）。分类核心在此单点维护，
// 两个消费者：
//   - check-coding.ts（full 轨）：scope 来自 plan.md，模块→路径映射来自 contracts.yaml
//   - check-exit.ts（lite 轨）：scope 来自 change.md，映射按 contracts → catalog
//     entry_file → <layer>/<name>/ 目录存在性 三级回退（resolveModulePathPrefixes）
// 判定语义（与历史 check-coding 实现逐行等价）：
//   - 不在任何 outer_layer 目录前缀下的变更 → neutral（框架性/文档，不计违规）
//   - 在层目录下且命中 in_scope 模块前缀 → in_scope_hit
//   - 在层目录下且未命中任何前缀 → violation
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig, getOuterLayerIds } from '../../config';
import { loadCatalog, findModule } from './catalog-parser';

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
// 模块名 → 路径前缀解析（lite 轨专用；full 轨由 contracts.yaml 直接提供）
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
 *   1. contracts.yaml modules[].package_path（若 lite feature 恰好维护了 contracts，
 *      与 full 轨同源同语义）
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
