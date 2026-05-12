// ============================================================================
// UT 业务源码前缀推导（architecture DSL）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert';
import {
  deriveBusinessSourcePathPrefixes,
  LEGACY_UT_SRC_PROTECTED_PREFIXES,
} from '../../scripts/utils/ut-business-src-scope';
import { LEGACY_DEFAULT_DSL, clearFrameworkConfigCache } from '../../config';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function writeJson(projectRoot: string, rel: string, payload: Record<string, unknown>): void {
  const p = path.join(projectRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'deriveBusinessSourcePathPrefixes: 无 framework.config.json → 等同 LEGACY_DEFAULT_DSL 外层',
    run: () => {
      clearFrameworkConfigCache();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-scope-'));
      try {
        const exp = LEGACY_DEFAULT_DSL.outer_layers.map(
          l => `${String(l.id).trim().replace(/\/+$/u, '')}/`,
        );
        assert.deepStrictEqual(deriveBusinessSourcePathPrefixes(dir), exp);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'deriveBusinessSourcePathPrefixes: 从 outer_layers 推导并规范斜杠',
    run: () => {
      clearFrameworkConfigCache();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-scope-'));
      try {
        writeJson(dir, 'framework.config.json', {
          project_profile: 'hmos-app',
          architecture: {
            outer_layers: [
              { id: '/99-Custom/', can_depend_on: [], intra_layer_deps: 'dag' },
              { id: '88-Apps', can_depend_on: [], intra_layer_deps: 'dag' },
            ],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
        });
        clearFrameworkConfigCache();
        assert.deepStrictEqual(deriveBusinessSourcePathPrefixes(dir), ['99-Custom/', '88-Apps/']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'deriveBusinessSourcePathPrefixes: empty outer_layers → load 抛错 → LEGACY',
    run: () => {
      clearFrameworkConfigCache();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-scope-'));
      try {
        writeJson(dir, 'framework.config.json', {
          project_profile: 'hmos-app',
          architecture: {
            outer_layers: [],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
        });
        clearFrameworkConfigCache();
        assert.deepStrictEqual(deriveBusinessSourcePathPrefixes(dir), [...LEGACY_UT_SRC_PROTECTED_PREFIXES]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? String(err) });
    }
  }
  return out;
}
