// materialized-adapters-resolve.unit.test.ts

import assert from 'assert';

import type { FrameworkConfig, FrameworkConfigWithSources } from '../../config';
import {
  resolveMaterializedAdaptersForCleanup,
  resolveMaterializedAdaptersFromContext,
  resolveProjectMaterializedAdapters,
} from '../../scripts/utils/materialized-adapters-resolve';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkSources(
  projectRaw: Record<string, unknown> | null,
  config: Partial<FrameworkConfig>,
): FrameworkConfigWithSources {
  return {
    config: {
      schema_version: '1.1',
      project_name: 't',
      architecture: {
        outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['shared'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ets',
      },
      paths: { features_dir: 'doc/features' },
      agent_adapter: 'cursor',
      ...config,
    } as FrameworkConfig,
    adapterStatus: {
      agent_adapter: 'cursor',
      source: 'project_legacy',
      local_exists: false,
      project_has_legacy_agent_adapter: false,
    },
    local: null,
    projectRaw,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveMaterializedAdaptersFromContext：ctx 优先',
    run: () => {
      const out = resolveMaterializedAdaptersFromContext({
        materializedAdapters: ['cursor', 'generic'],
        configWritePayload: { materialized_adapters: ['claude'] },
      });
      assert.deepStrictEqual(out, ['cursor', 'generic']);
    },
  },
  {
    name: 'resolveMaterializedAdaptersForCleanup：四级回落到磁盘 projectRaw',
    run: () => {
      const sources = mkSources({ materialized_adapters: ['generic', 'cursor'] }, {});
      const out = resolveMaterializedAdaptersForCleanup({}, sources.config, sources);
      assert.deepStrictEqual(out, ['generic', 'cursor']);
    },
  },
  {
    name: 'resolveMaterializedAdaptersForCleanup：merge config 优先于 projectRaw',
    run: () => {
      const sources = mkSources(
        { materialized_adapters: ['generic', 'cursor'] },
        { materialized_adapters: ['claude'] },
      );
      const out = resolveMaterializedAdaptersForCleanup({}, sources.config, sources);
      assert.deepStrictEqual(out, ['claude']);
    },
  },
  {
    name: 'resolveMaterializedAdaptersForCleanup：ctx 覆盖 config',
    run: () => {
      const sources = mkSources({ materialized_adapters: ['claude'] }, {});
      const out = resolveMaterializedAdaptersForCleanup(
        { materializedAdapters: ['cursor'] },
        sources.config,
        sources,
      );
      assert.deepStrictEqual(out, ['cursor']);
    },
  },
  {
    name: 'resolveProjectMaterializedAdapters：无 projectRaw 时回落 hint',
    run: () => {
      const sources = mkSources(null, {});
      const out = resolveProjectMaterializedAdapters(sources, 'generic');
      assert.deepStrictEqual(out, ['generic']);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
