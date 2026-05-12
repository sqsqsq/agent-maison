/**
 * UT 红线：哪些 git pathspec 算作「业务源码」范围。
 * 来源优先为 `framework.config.json > architecture.outer_layers[].id`，
 * 无合法 DSL 时回退到历史三前缀（与旧版 SKILL 红线兼容）。
 */

import { loadFrameworkConfig } from '../../config';

export const LEGACY_UT_SRC_PROTECTED_PREFIXES: readonly string[] = [
  '02-Feature/',
  '01-Business/',
  '00-Common/',
];

function normalizeOuterLayerPathPrefix(layerId: string): string | null {
  const t = layerId.trim().replace(/^\/+/u, '').replace(/\/+$/u, '');
  return t.length > 0 ? `${t}/` : null;
}

/** 用于 `git diff -- <pathspec>` 与 filterBusinessSourceChanges：带尾部 `/` */
export function deriveBusinessSourcePathPrefixes(projectRoot: string): string[] {
  try {
    const layers = loadFrameworkConfig(projectRoot).architecture?.outer_layers;
    if (!Array.isArray(layers) || layers.length === 0) {
      return [...LEGACY_UT_SRC_PROTECTED_PREFIXES];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of layers) {
      const pref = normalizeOuterLayerPathPrefix(l?.id ?? '');
      if (pref && !seen.has(pref)) {
        seen.add(pref);
        out.push(pref);
      }
    }
    return out.length > 0 ? out : [...LEGACY_UT_SRC_PROTECTED_PREFIXES];
  } catch {
    return [...LEGACY_UT_SRC_PROTECTED_PREFIXES];
  }
}

/** named-handler：在工程根下的顶层目录名，无尾部 `/` */
export function deriveNamedHandlerSearchRoots(projectRoot: string): string[] {
  return deriveBusinessSourcePathPrefixes(projectRoot).map(p =>
    p.replace(/\/+$/u, ''),
  );
}
