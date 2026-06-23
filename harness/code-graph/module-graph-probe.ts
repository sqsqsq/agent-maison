// ============================================================================
// module-graph-probe.ts — module-graph readiness（schema + drift BLOCKER，与 phase 门禁对齐）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { moduleGraphPath } from '../config';
import { loadCatalog } from '../scripts/utils/catalog-parser';
import { evaluateCodeGraphDrift } from './drift';
import { parseCodeGraphFile, validateCodeGraphFileSchema } from './file-schema';

export type ModuleGraphReadinessState = 'missing' | 'gap' | 'corrupt' | 'blocked' | 'ready';

export interface ModuleGraphReadiness {
  state: ModuleGraphReadinessState;
  module?: string;
  error?: string;
}

function resolvePackagePath(layer: string, name: string): string {
  return `${layer}/${name}`.replace(/\\/g, '/');
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
      const pkg = resolvePackagePath(card.layer, card.name);
      const abs = moduleGraphPath(projectRoot, pkg);
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
