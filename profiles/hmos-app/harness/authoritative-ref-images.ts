// ============================================================================
// authoritative-ref-images.ts — visual_handoff authoritative_refs → 可达图片路径
// ============================================================================

import * as path from 'path';
import { createRequire } from 'module';
import { resolveAuthoritativePath } from '../../../harness/scripts/utils/visual-source-resolver';
import { extractCodeBlocks } from '../../../harness/scripts/utils/markdown-parser';
import type { CheckContext } from '../../../harness/scripts/utils/types';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

export interface AuthoritativeRefImageIndex {
  byId: Map<string, string>;
  /** 第一个 reachable 图片（无 source_ref 时的显式 fallback） */
  firstReachable: string | null;
}

export function buildAuthoritativeRefImageIndex(
  ctx: CheckContext,
  specMd: string,
): AuthoritativeRefImageIndex {
  const byId = new Map<string, string>();
  let firstReachable: string | null = null;

  for (const b of extractCodeBlocks(specMd, 'yaml')) {
    try {
      const doc = YAML.parse(b.content) as Record<string, unknown>;
      const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
      const refs = vh?.authoritative_refs as Array<{ id?: string; path?: string }> | undefined;
      if (!Array.isArray(refs)) continue;
      for (const r of refs) {
        if (typeof r.path !== 'string' || !/\.(png|jpe?g|webp)$/i.test(r.path)) continue;
        const resolved = resolveAuthoritativePath(r.path, {
          projectRoot: ctx.projectRoot,
          externalRoots: ctx.specVisualSources?.external_roots,
          allowAbsolutePaths: Boolean(ctx.specVisualSources?.allow_absolute_paths),
          allowNetworkPaths: Boolean(ctx.specVisualSources?.allow_network_paths),
        });
        if (!resolved.agentReachable || !resolved.resolvedAbsolute) continue;
        if (!firstReachable) firstReachable = resolved.resolvedAbsolute;
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        if (id) byId.set(id, resolved.resolvedAbsolute);
      }
    } catch { /* skip block */ }
  }

  return { byId, firstReachable };
}

export function resolveRefSourceImage(
  index: AuthoritativeRefImageIndex,
  sourceRef: string | undefined,
): { path: string | null; note?: string } {
  const ref = sourceRef?.trim();
  if (ref && index.byId.has(ref)) {
    return { path: index.byId.get(ref)! };
  }
  if (ref && !index.byId.has(ref)) {
    return { path: null, note: `source_ref=${ref} 无 reachable 图片映射` };
  }
  if (index.firstReachable) {
    return {
      path: index.firstReachable,
      note: ref ? undefined : '未指定 source_ref，回退首张 authoritative_ref 图片',
    };
  }
  return { path: null, note: '无 reachable authoritative_ref 图片' };
}
