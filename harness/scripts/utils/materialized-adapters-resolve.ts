// materialized-adapters-resolve.ts — materialized_adapters 四级回落（无环共享）

import type { FrameworkConfig, FrameworkConfigWithSources } from '../../config';

/** 本地结构化类型；禁止 Pick<InitExecutionContext, …> 以免反向依赖 executor */
export type MaterializedAdaptersContext = {
  materializedAdapters?: string[];
  configWritePayload?: Record<string, unknown>;
};

function normalizeAdapterList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map(a => a.trim());
}

function dedupeTrimmed(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function resolveAdapterHintFromSources(sources: FrameworkConfigWithSources): string {
  const raw = sources.projectRaw;
  const fromMaterialized = normalizeAdapterList(raw?.materialized_adapters);
  if (fromMaterialized.length > 0) return fromMaterialized[0]!;

  const legacy = typeof raw?.agent_adapter === 'string' ? raw.agent_adapter.trim() : '';
  if (legacy) return legacy;

  const fromMerged = normalizeAdapterList(sources.config.materialized_adapters);
  if (fromMerged.length > 0) return fromMerged[0]!;

  return sources.config.agent_adapter?.trim() || 'generic';
}

/** 项目级 materialized_adapters（不含 local merge） */
export function resolveProjectMaterializedAdapters(
  sources: FrameworkConfigWithSources,
  adapterHint: string,
): string[] {
  const raw = sources.projectRaw;
  const fromProject = normalizeAdapterList(raw?.materialized_adapters);
  if (fromProject.length > 0) return fromProject;
  const hint = adapterHint.trim();
  return hint ? [hint] : ['generic'];
}

/** S3 cleanup / S1 probe 四级回落（去重、trim） */
export function resolveMaterializedAdaptersForCleanup(
  ctx: MaterializedAdaptersContext,
  config: FrameworkConfig,
  sources?: FrameworkConfigWithSources,
): string[] {
  const fromCtx = normalizeAdapterList(ctx.materializedAdapters);
  if (fromCtx.length > 0) return dedupeTrimmed(fromCtx);

  const fromPayload = normalizeAdapterList(ctx.configWritePayload?.materialized_adapters);
  if (fromPayload.length > 0) return dedupeTrimmed(fromPayload);

  const fromConfig = normalizeAdapterList(config.materialized_adapters);
  if (fromConfig.length > 0) return dedupeTrimmed(fromConfig);

  if (sources) {
    const hint = resolveAdapterHintFromSources(sources);
    return dedupeTrimmed(resolveProjectMaterializedAdapters(sources, hint));
  }

  const legacy = config.agent_adapter?.trim();
  return legacy ? [legacy] : ['generic'];
}

/** S2 context / configWritePayload 中的 materialized_adapters（S3 执行 SSOT） */
export function resolveMaterializedAdaptersFromContext(
  ctx?: MaterializedAdaptersContext,
): string[] | undefined {
  if (!ctx) return undefined;
  const fromCtx = normalizeAdapterList(ctx.materializedAdapters);
  if (fromCtx.length > 0) return fromCtx;

  const fromPayload = normalizeAdapterList(ctx.configWritePayload?.materialized_adapters);
  if (fromPayload.length > 0) return fromPayload;

  return undefined;
}
