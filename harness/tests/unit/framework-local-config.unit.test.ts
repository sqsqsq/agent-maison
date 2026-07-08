// ============================================================================
// framework-local-config.unit.test.ts
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  clearFrameworkConfigCache,
  getFrameworkPersonalSetupStatus,
  loadDevEcoConfig,
  loadFrameworkConfig,
} from '../../config';
import {
  buildLocalFromProjectLegacy,
  detectPendingMigrations,
} from '../../scripts/utils/config-field-merger';
import { evaluateConfigPlacementGate } from '../../scripts/utils/config-placement-gate';
import {
  loadLocalConfig,
  LOCAL_CONFIG_FILENAME,
  mergeLocalIntoToolchain,
  resolveAgentAdapterSource,
  writeLocalConfig,
} from '../../scripts/utils/framework-local-config';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fw-local-'));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveAgentAdapterSource: local wins',
    run: () => {
      const s = resolveAgentAdapterSource('/x', { agent_adapter: 'claude' }, { schema_version: '1.0', agent_adapter: 'cursor' }, 'generic');
      assert.strictEqual(s.source, 'local');
      assert.strictEqual(s.agent_adapter, 'cursor');
    },
  },
  {
    name: 'resolveAgentAdapterSource: project_legacy when no local adapter',
    run: () => {
      const s = resolveAgentAdapterSource('/x', { agent_adapter: 'claude' }, null, 'generic');
      assert.strictEqual(s.source, 'project_legacy');
      assert.strictEqual(s.agent_adapter, 'claude');
    },
  },
  {
    name: 'resolveAgentAdapterSource: fallback',
    run: () => {
      const s = resolveAgentAdapterSource('/x', {}, null, 'generic');
      assert.strictEqual(s.source, 'fallback');
    },
  },
  {
    name: 'loadFrameworkConfig merges local agent_adapter',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['claude', 'cursor'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'cursor' });
      clearFrameworkConfigCache();
      const cfg = loadFrameworkConfig(root);
      assert.strictEqual(cfg.agent_adapter, 'cursor');
      assert.deepStrictEqual(cfg.materialized_adapters, ['claude', 'cursor']);
      const st = getFrameworkPersonalSetupStatus(root);
      assert.strictEqual(st.source, 'local');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'buildLocalFromProjectLegacy + extract_personal_to_local migration detect',
    run: () => {
      const raw = {
        agent_adapter: 'claude',
        toolchain: { devEcoStudio: { installPath: 'C:/DevEco' } },
      };
      const local = buildLocalFromProjectLegacy(raw);
      assert(local);
      assert.strictEqual(local!.agent_adapter, 'claude');
      assert.strictEqual(local!.toolchain?.devEcoStudio?.installPath, 'C:/DevEco');
      const pending = detectPendingMigrations(raw);
      assert(pending.some(p => p.id === 'extract_personal_to_local'));
    },
  },
  {
    name: 'mergeLocalIntoToolchain fail-closed：忽略 project devEcoStudio',
    run: () => {
      const merged = mergeLocalIntoToolchain(
        { devEcoStudio: { installPath: 'C:/wrong' }, hvigor: { daemon: true } },
        null,
      );
      assert.strictEqual(merged?.devEcoStudio, undefined);
      assert.strictEqual(merged?.hvigor?.daemon, true);
    },
  },
  {
    name: 'loadDevEcoConfig 不读 project config 错位 installPath',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['generic'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
          toolchain: { devEcoStudio: { installPath: 'C:/wrong-project' } },
        }, null, 2),
      );
      clearFrameworkConfigCache();
      assert.strictEqual(loadDevEcoConfig(root), undefined);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'evaluateConfigPlacementGate：project devEcoStudio BLOCKER',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
          toolchain: { devEcoStudio: { installPath: 'C:/wrong' } },
        }, null, 2),
      );
      clearFrameworkConfigCache();
      const gate = evaluateConfigPlacementGate(root);
      assert.strictEqual(gate.ok, false);
      assert.strictEqual(gate.code, 'misconfigured_personal_fields');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'loadLocalConfig strips legacy setup.adapter → agent_adapter',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', setup: { adapter: 'generic' } }),
      );
      const local = loadLocalConfig(root);
      assert.strictEqual(local?.agent_adapter, 'generic');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'loadLocalConfig rejects unknown top-level key',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', foo: 'bar' }),
      );
      assert.throws(() => loadLocalConfig(root), /非法顶层键/);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'loadLocalConfig rejects nested devEcoStudio typo',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({
          schema_version: '1.0',
          toolchain: { devEcoStuido: { installPath: 'C:/x' } },
        }),
      );
      assert.throws(() => loadLocalConfig(root), /toolchain 含非法键/);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'loadLocalConfig rejects nested installPath typo',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({
          schema_version: '1.0',
          toolchain: { devEcoStudio: { installPth: 'C:/x' } },
        }),
      );
      assert.throws(() => loadLocalConfig(root), /devEcoStudio 含非法键/);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'loadLocalConfig rejects bad schema_version',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(path.join(root, LOCAL_CONFIG_FILENAME), '{"schema_version":"9.9"}');
      assert.throws(() => loadLocalConfig(root));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  // ==========================================================================
  // E1（多模态降级阶梯 plan d4a8f3c6）：vision.image_input_override / vision.canary
  // ==========================================================================
  {
    name: 'E1 writeLocalConfig/loadLocalConfig: vision.image_input_override 写回读取 roundtrip',
    run: () => {
      const root = mkTmp();
      writeLocalConfig(root, {
        schema_version: '1.0',
        agent_adapter: 'chrys',
        vision: { image_input_override: 'none' },
      });
      const local = loadLocalConfig(root);
      assert.strictEqual(local?.vision?.image_input_override, 'none');
      assert.strictEqual(local?.agent_adapter, 'chrys', '写回不应丢失既有个人配置字段');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'E1 loadLocalConfig rejects invalid image_input_override value',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', vision: { image_input_override: 'bogus' } }),
      );
      assert.throws(() => loadLocalConfig(root), /image_input_override/);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'E1 loadLocalConfig: vision.canary 合法值 roundtrip',
    run: () => {
      const root = mkTmp();
      writeLocalConfig(root, {
        schema_version: '1.0',
        vision: {
          canary: { adapter: 'chrys', verdict: 'ocr_capable', probed_at: '2026-07-08T12:00:00.000Z', reason: 'test' },
        },
      });
      const local = loadLocalConfig(root);
      assert.strictEqual(local?.vision?.canary?.adapter, 'chrys');
      assert.strictEqual(local?.vision?.canary?.verdict, 'ocr_capable');
      assert.strictEqual(local?.vision?.canary?.reason, 'test');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'E1 loadLocalConfig rejects invalid canary.verdict / missing required fields',
    run: () => {
      const root1 = mkTmp();
      fs.writeFileSync(
        path.join(root1, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', vision: { canary: { adapter: 'chrys', verdict: 'bogus', probed_at: 'x' } } }),
      );
      assert.throws(() => loadLocalConfig(root1), /verdict/);
      fs.rmSync(root1, { recursive: true, force: true });

      const root2 = mkTmp();
      fs.writeFileSync(
        path.join(root2, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', vision: { canary: { verdict: 'none', probed_at: 'x' } } }),
      );
      assert.throws(() => loadLocalConfig(root2), /adapter/);
      fs.rmSync(root2, { recursive: true, force: true });
    },
  },
  {
    name: 'E1 loadLocalConfig rejects unknown keys in vision / vision.canary',
    run: () => {
      const root1 = mkTmp();
      fs.writeFileSync(
        path.join(root1, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', vision: { bogus_key: 1 } }),
      );
      assert.throws(() => loadLocalConfig(root1), /vision 含非法键/);
      fs.rmSync(root1, { recursive: true, force: true });

      const root2 = mkTmp();
      fs.writeFileSync(
        path.join(root2, LOCAL_CONFIG_FILENAME),
        JSON.stringify({
          schema_version: '1.0',
          vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: 'x', bogus: 1 } },
        }),
      );
      assert.throws(() => loadLocalConfig(root2), /vision\.canary 含非法键/);
      fs.rmSync(root2, { recursive: true, force: true });
    },
  },
  {
    name: 'E1 loadLocalConfig: 旧版 local.json（无 vision 键）仍正常读取（向后兼容）',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' }),
      );
      const local = loadLocalConfig(root);
      assert.strictEqual(local?.agent_adapter, 'claude');
      assert.strictEqual(local?.vision, undefined, '未声明 vision 不应凭空产出');
      fs.rmSync(root, { recursive: true, force: true });
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
