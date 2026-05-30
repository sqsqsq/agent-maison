// personal-setup-gate.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { evaluatePersonalSetupGate } from '../../scripts/utils/personal-setup-gate';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ps-gate-'));
}

function minimalArchitecture(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'evaluatePersonalSetupGate: fallback 拒绝',
    run: () => {
      const root = mkTmp();
      const r = evaluatePersonalSetupGate(root);
      assert.strictEqual(r.ok, false);
      if (r.ok) throw new Error('expected fail');
      assert.strictEqual(r.code, 'fallback');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'evaluatePersonalSetupGate: local claude 不在 materialized cursor 拒绝',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'gate',
            materialized_adapters: ['cursor'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' }, null, 2),
      );
      clearFrameworkConfigCache();

      const r = evaluatePersonalSetupGate(root);
      assert.strictEqual(r.ok, false);
      if (r.ok) throw new Error('expected fail');
      assert.strictEqual(r.code, 'not_in_materialized');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'evaluatePersonalSetupGate: 在 materialized 但入口缺失拒绝',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'gate',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' }, null, 2),
      );
      clearFrameworkConfigCache();

      const r = evaluatePersonalSetupGate(root);
      assert.strictEqual(r.ok, false);
      if (r.ok) throw new Error('expected fail');
      assert.strictEqual(r.code, 'entry_not_materialized');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
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
