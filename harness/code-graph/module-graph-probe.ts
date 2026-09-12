// ============================================================================
// module-graph-probe.ts — module-graph readiness（schema + drift BLOCKER，与 phase 门禁对齐）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { moduleGraphPath, catalogPath, loadFrameworkConfigWithSources } from '../config';
import { validateProjectRelativePath, isInsideProjectRoot, realProjectPath } from '../scripts/utils/project-relative-path';
import { describeCatalogError, loadCatalog } from '../scripts/utils/catalog-parser';
import { evaluateCodeGraphDrift } from './drift';
import { parseCodeGraphFile, validateCodeGraphFileSchema } from './file-schema';

export type ModuleGraphReadinessState = 'missing' | 'gap' | 'corrupt' | 'blocked' | 'ready';

export interface ModuleGraphReadiness {
  state: ModuleGraphReadinessState;
  module?: string;
  error?: string;
}

/** Graph generation and checking share the selected module's actual source identity. */
export function resolveGraphModule(projectRoot: string, moduleName: string, packagePath?: string, result = loadCatalog(projectRoot)) {
  const rawPaths = loadFrameworkConfigWithSources(projectRoot).projectRaw?.paths as Record<string, unknown> | undefined;
  if (!result.ok && (result.error.kind !== 'file_not_found' || fs.existsSync(catalogPath(projectRoot)) || rawPaths?.module_catalog || !packagePath)) throw new Error(describeCatalogError(result.error));
  const card = result.ok ? result.catalog.modules.find(m => m.name === moduleName) : undefined;
  if (!card && !packagePath) throw new Error('模块来源未确定：' + moduleName + '；提供 --package-path 或补该模块 catalog');
  const relative = validateProjectRelativePath(projectRoot, packagePath ?? card!.layer + '/' + card!.name, 'module package');
  const actual = realProjectPath(projectRoot, relative, 'module package');
  for (const protectedPath of ['framework', '.git']) {
    const abs = path.resolve(projectRoot, protectedPath);
    const protectedAbs = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
    if (isInsideProjectRoot(protectedAbs, actual) || isInsideProjectRoot(actual, protectedAbs)) throw new Error('模块来源涉及保护目录：' + relative);
  }
  if (fs.existsSync(actual) && !fs.statSync(actual).isDirectory()) throw new Error('模块源码不是目录：' + relative);
  const graphPath = moduleGraphPath(projectRoot, relative);
  // Validate the existing output ancestor as well as the source directory (junctions included).
  const output = realProjectPath(projectRoot, path.relative(projectRoot, graphPath), 'module graph');
  for (const dir of ['framework', '.git']) {
    const abs = path.resolve(projectRoot, dir);
    if (isInsideProjectRoot(fs.existsSync(abs) ? fs.realpathSync(abs) : abs, output)) throw new Error('图谱输出涉及保护目录');
  }
  return { card, packagePath: relative, graphPath };
}

export function probeModuleGraphReadiness(
  projectRoot: string,
  catalogState: 'missing' | 'empty' | 'corrupt' | 'ready',
): ModuleGraphReadiness {
  if (catalogState !== 'ready') {
    return { state: 'missing' };
  }
  let currentModule: string | undefined;
  try {
    const result = loadCatalog(projectRoot);
    if (!result.ok || result.catalog.modules.length === 0) {
      return { state: 'missing' };
    }
    for (const card of result.catalog.modules) {
      currentModule = card.name;
      const abs = resolveGraphModule(projectRoot, card.name, undefined, result).graphPath;
      const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
      if (!fs.existsSync(abs)) {
        return { state: 'gap', module: card.name };
      }
      const { graph, error } = parseCodeGraphFile(abs, rel);
      if (!graph) {
        return { state: 'corrupt', module: card.name, error: error ?? `${rel} 无效` };
      }
      const schemaErrors = validateCodeGraphFileSchema(graph);
      if (schemaErrors.length > 0) {
        return {
          state: 'corrupt',
          module: card.name,
          error: schemaErrors.join('；'),
        };
      }
      const blockers = evaluateCodeGraphDrift(projectRoot, graph).filter(
        f => f.severity === 'BLOCKER',
      );
      if (blockers.length > 0) {
        return {
          state: 'blocked',
          module: card.name,
          error: blockers.map(f => f.message).join('；'),
        };
      }
    }
    return { state: 'ready' };
  } catch (error) {
    return {
      state: 'corrupt',
      module: currentModule,
      error: `module-graph readiness 探测失败：${(error as Error).message}`,
    };
  }
}
