// ============================================================================
// fan-out-scanner — 静态估算 in-scope 模块被其它模块 import 的 fan-out
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { loadFrameworkConfig } from '../../config';
import { parseScope } from './scope-parser';
import { SpecLoader } from './spec-loader';

interface CatalogModule {
  name?: string;
  layer?: string;
}

interface CatalogFile {
  modules?: CatalogModule[];
}

function readInScopeModules(projectRoot: string, feature: string, frameworkRoot?: string): string[] {
  const loader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
  const prd = loader.loadFeatureDoc(projectRoot, feature, 'PRD.md');
  if (!prd) return [];
  const { scope } = parseScope(prd);
  return scope?.in_scope_modules ?? [];
}

function loadCatalogModules(projectRoot: string): CatalogModule[] {
  const catalogPath = path.join(projectRoot, 'doc', 'module-catalog.yaml');
  if (!fs.existsSync(catalogPath)) return [];
  try {
    const parsed = YAML.parse(fs.readFileSync(catalogPath, 'utf-8')) as CatalogFile;
    return parsed.modules ?? [];
  } catch {
    return [];
  }
}

function resolvePackageImportToken(projectRoot: string, moduleName: string, layer?: string): string[] {
  const tokens: string[] = [moduleName];
  if (layer) {
    const moduleRoot = path.join(projectRoot, layer, moduleName);
    const ohPkg = path.join(moduleRoot, 'oh-package.json5');
    if (fs.existsSync(ohPkg)) {
      try {
        const raw = fs.readFileSync(ohPkg, 'utf-8');
        const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(raw);
        if (nameMatch?.[1]) tokens.push(nameMatch[1]);
      } catch {
        /* ignore */
      }
    }
  }
  return [...new Set(tokens.map(t => t.trim()).filter(Boolean))];
}

function listEtsFiles(rootDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) return out;
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'build' || ent.name === '.git') continue;
        stack.push(abs);
      } else if (ent.isFile() && ent.name.endsWith('.ets')) {
        out.push(abs);
      }
    }
  }
  return out;
}

function countImportReferences(content: string, tokens: string[]): number {
  let count = 0;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:import|from)\\s+['"][^'"]*${escaped}[^'"]*['"]`, 'g');
    const matches = content.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * 返回 in-scope 模块的最大 fan-out（被其它 .ets 文件 import 的次数估计）。
 * 扫描 architecture outer_layers 下全部源码；无 catalog 时仅用模块名匹配。
 */
export function computeMaxDependencyFanOut(
  projectRoot: string,
  feature: string,
  frameworkRoot?: string,
): number {
  const inScope = readInScopeModules(projectRoot, feature, frameworkRoot);
  if (inScope.length === 0) return 0;

  const catalog = loadCatalogModules(projectRoot);
  const catalogByName = new Map(catalog.map(m => [String(m.name ?? ''), m]));

  const cfg = loadFrameworkConfig(projectRoot);
  const outerLayers = (cfg.architecture?.outer_layers ?? []) as Array<{ id?: string }>;
  const scanRoots = outerLayers
    .map(l => path.join(projectRoot, String(l.id ?? '')))
    .filter(p => fs.existsSync(p));

  if (scanRoots.length === 0) {
    scanRoots.push(projectRoot);
  }

  const allEts = scanRoots.flatMap(r => listEtsFiles(r));
  let maxFanOut = 0;

  for (const moduleName of inScope) {
    const meta = catalogByName.get(moduleName);
    const tokens = resolvePackageImportToken(projectRoot, moduleName, meta?.layer);
    let moduleFanOut = 0;
    const moduleRoot = meta?.layer ? path.join(projectRoot, meta.layer, moduleName) : '';

    for (const file of allEts) {
      if (moduleRoot && file.startsWith(moduleRoot + path.sep)) continue;
      try {
        const content = fs.readFileSync(file, 'utf-8');
        moduleFanOut += countImportReferences(content, tokens);
      } catch {
        /* ignore unreadable */
      }
    }
    maxFanOut = Math.max(maxFanOut, moduleFanOut);
  }

  return maxFanOut;
}

/**
 * 估算 in-scope 模块源码行数（.ets 文件 LOC 之和，取最大单模块）。
 */
export function computeMaxInScopeModuleLoc(
  projectRoot: string,
  feature: string,
  frameworkRoot?: string,
): number {
  const inScope = readInScopeModules(projectRoot, feature, frameworkRoot);
  if (inScope.length === 0) return 0;

  const catalog = loadCatalogModules(projectRoot);
  const catalogByName = new Map(catalog.map(m => [String(m.name ?? ''), m]));

  let maxLoc = 0;
  for (const moduleName of inScope) {
    const meta = catalogByName.get(moduleName);
    if (!meta?.layer) continue;
    const moduleRoot = path.join(projectRoot, meta.layer, moduleName);
    const etsFiles = listEtsFiles(moduleRoot);
    let loc = 0;
    for (const f of etsFiles) {
      try {
        loc += fs.readFileSync(f, 'utf-8').split(/\r?\n/).length;
      } catch {
        /* ignore */
      }
    }
    maxLoc = Math.max(maxLoc, loc);
  }
  return maxLoc;
}
