// personal-setup-gate.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  ensurePersonalSetup,
  evaluatePersonalSetupGate,
} from '../../scripts/utils/personal-setup-gate';

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

function writeProjectConfig(root: string, materialized: string[]): void {
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'gate',
        materialized_adapters: materialized,
        architecture: minimalArchitecture(),
        paths: { features_dir: 'doc/features' },
      },
      null,
      2,
    ),
  );
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
      writeProjectConfig(root, ['cursor']);
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
      writeProjectConfig(root, ['claude']);
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
  {
    name: 'ensurePersonalSetup: 单一 materialized 自写 local',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude']);
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.code, 'ok');
      assert.strictEqual(payload.ensured, 'auto_single_adapter');
      assert.strictEqual(payload.activeAdapter, 'claude');
      assert.ok(fs.existsSync(path.join(root, 'framework.local.json')));

      const after = evaluatePersonalSetupGate(root);
      assert.strictEqual(after.ok, true);

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'ensurePersonalSetup: 多 adapter 返回 needs_adapter_choice 不写盘',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude', 'cursor']);
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, false);
      assert.strictEqual(payload.code, 'needs_adapter_choice');
      assert.ok(payload.candidates.includes('claude'));
      assert.ok(payload.candidates.includes('cursor'));
      assert.strictEqual(payload.ensured, null);
      assert.ok(!fs.existsSync(path.join(root, 'framework.local.json')));

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'ensurePersonalSetup: 单一 materialized 自写时保留既有 local toolchain',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude']);
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify(
          {
            schema_version: '1.0',
            toolchain: {
              devEcoStudio: { installPath: 'C:/DevEco/existing' },
            },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.ensured, 'auto_single_adapter');

      const local = JSON.parse(
        fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'),
      ) as { agent_adapter?: string; toolchain?: { devEcoStudio?: { installPath?: string } } };
      assert.strictEqual(local.agent_adapter, 'claude');
      assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, 'C:/DevEco/existing');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'ensurePersonalSetup: 多 adapter 均无入口 → entry_not_materialized',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude', 'cursor']);
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, false);
      assert.strictEqual(payload.code, 'entry_not_materialized');
      assert.deepStrictEqual(payload.candidates, []);
      assert.ok(!fs.existsSync(path.join(root, 'framework.local.json')));

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'ensurePersonalSetup: 零 materialized 返回 no_materialized_adapter',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, []);
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, false);
      assert.strictEqual(payload.code, 'no_materialized_adapter');
      assert.ok(!fs.existsSync(path.join(root, 'framework.local.json')));

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
