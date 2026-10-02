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
  resolveApprovedModels,
  resolveUnattendedB1Repair,
  updateLocalConfig,
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
    // plan 4e6fb3b6 §6.1
    name: 'P3 t4 adapters.<adapter>.approved_models：按序去重读出；缺省=无替代；解析不了按未配置并提示，不拖垮整个 local；原样 round-trip',
    run: () => {
      const root = mkTmp();
      try {
        const writeRaw = (obj: unknown): void =>
          fs.writeFileSync(path.join(root, LOCAL_CONFIG_FILENAME), JSON.stringify(obj), 'utf-8');
        writeRaw({
          schema_version: '1.0', agent_adapter: 'codex',
          adapters: { codex: { approved_models: [' gpt-a ', 'gpt-b', 'gpt-a'] }, claude: { approved_models: 'x' } },
        });
        const local = loadLocalConfig(root);
        assert.deepStrictEqual(resolveApprovedModels(local, 'codex'), { models: ['gpt-a', 'gpt-b'] });
        const bad = resolveApprovedModels(local, 'claude');
        assert.deepStrictEqual(bad.models, [], '解析不了按未配置处理');
        assert.ok(bad.warning?.includes('adapters.claude.approved_models'), `须提示：${bad.warning}`);
        assert.deepStrictEqual(resolveApprovedModels(local, 'cursor'), { models: [] }, '没有这一项就没有替代，也不提示');
        assert.deepStrictEqual(resolveApprovedModels(null, 'codex'), { models: [] }, '无 local 文件');
        for (const v of [[''], ['a'.repeat(129)], ['ok', 1], ['bad\u0001']]) {
          writeRaw({ schema_version: '1.0', adapters: { codex: { approved_models: v } } });
          const r = resolveApprovedModels(loadLocalConfig(root), 'codex');
          assert.ok(r.models.length === 0 && !!r.warning, `非法值 ${JSON.stringify(v)} 须按未配置并提示`);
        }
        writeRaw({ schema_version: '1.0', adapters: 'nope' });
        const warned: string[] = [];
        const origWarn = console.warn;
        console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };
        try {
          assert.deepStrictEqual(loadLocalConfig(root)?.adapters, undefined, 'adapters 不是对象：丢弃，不抛错');
          loadLocalConfig(root);
        } finally {
          console.warn = origWarn;
        }
        assert.strictEqual(warned.filter(w => w.includes('adapters 须为对象')).length, 1, `父节点非法须给一次明确提示：${JSON.stringify(warned)}`);
        // round-trip：其它字段的写回不丢这一节（含坏值——用户的配置由用户改）
        writeRaw({ schema_version: '1.0', agent_adapter: 'codex', adapters: { codex: { approved_models: ['m1'] }, claude: { approved_models: 3 } } });
        writeLocalConfig(root, { ...loadLocalConfig(root)!, agent_adapter: 'claude' });
        const back = loadLocalConfig(root);
        assert.deepStrictEqual(back?.adapters, { codex: { approved_models: ['m1'] }, claude: { approved_models: 3 } });
        assert.strictEqual(back?.agent_adapter, 'claude');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // plan 9c3d7e1a §5.5 / D4
    name: 't6 design_repair.unattended_b1：只有布尔 true 算授权（缺失 / 字符串 / 数字 / 非对象都不算，且不拖垮整个 local）；既有局部写回（updateLocalConfig）之后键仍在',
    run: () => {
      const root = mkTmp();
      try {
        const writeRaw = (obj: unknown): void =>
          fs.writeFileSync(path.join(root, LOCAL_CONFIG_FILENAME), JSON.stringify(obj), 'utf-8');
        assert.strictEqual(resolveUnattendedB1Repair(loadLocalConfig(root)), false, '没有 local 文件 = 未授权');
        writeRaw({ schema_version: '1.0' });
        assert.strictEqual(resolveUnattendedB1Repair(loadLocalConfig(root)), false, '缺省关闭');
        for (const v of [{ unattended_b1: 'true' }, { unattended_b1: 1 }, { unattended_b1: false }, {}, 'yes', [true]]) {
          writeRaw({ schema_version: '1.0', agent_adapter: 'codex', design_repair: v });
          const local = loadLocalConfig(root);
          assert.strictEqual(resolveUnattendedB1Repair(local), false, `${JSON.stringify(v)} 不得算授权`);
          assert.strictEqual(local?.agent_adapter, 'codex', '坏值不得拖垮整个 local');
        }
        writeRaw({ schema_version: '1.0', agent_adapter: 'codex', design_repair: { unattended_b1: true } });
        assert.strictEqual(resolveUnattendedB1Repair(loadLocalConfig(root)), true);
        // 既有写回入口（金丝雀缓存等都经它）改别的字段之后，预授权仍在。
        updateLocalConfig(root, current => ({ ...current, vision: { canary: { adapter: 'codex', verdict: 'tool_read', probed_at: '2026-10-01T00:00:00.000Z', probed_via: 'interactive', probe_version: 2 } } } as typeof current));
        const back = JSON.parse(fs.readFileSync(path.join(root, LOCAL_CONFIG_FILENAME), 'utf-8')) as Record<string, unknown>;
        assert.deepStrictEqual(back.design_repair, { unattended_b1: true }, `写回后预授权不得丢：${JSON.stringify(back)}`);
        assert.strictEqual(resolveUnattendedB1Repair(loadLocalConfig(root)), true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // openspec device-readiness-and-completion：device 策略入 local config
    name: 'device 策略：round-trip 不丢字段；旧配置无 device 键仍可加载（行为等价 manual/disabled）',
    run: () => {
      const root = mkTmp();
      try {
        writeLocalConfig(root, {
          schema_version: '1.0',
          agent_adapter: 'cursor',
          device: {
            unlock: { mode: 'credential', credential_ref: 'maison/dev/3UJ0/v2' },
            emulator_fallback: 'managed',
            target_serial: '3UJ0225321000395',
            emulator_profile: 'Pura 90',
          },
        });
        const back = loadLocalConfig(root);
        assert.strictEqual(back?.device?.unlock?.mode, 'credential', 'mode 保真');
        assert.strictEqual(back?.device?.unlock?.credential_ref, 'maison/dev/3UJ0/v2', 'credential_ref 保真');
        assert.strictEqual(back?.device?.emulator_fallback, 'managed', 'fallback 保真');
        assert.strictEqual(back?.device?.target_serial, '3UJ0225321000395', 'serial 保真');
        assert.strictEqual(back?.device?.emulator_profile, 'Pura 90', 'profile 保真');
        assert.strictEqual(back?.agent_adapter, 'cursor', '既有字段不受影响');

        // 旧配置（无 device 键）仍可加载
        writeLocalConfig(root, { schema_version: '1.0', agent_adapter: 'claude' });
        const legacy = loadLocalConfig(root);
        assert.strictEqual(legacy?.device, undefined, '旧配置 device 保持 undefined，不臆造默认值');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'device 策略：拒未知键（防明文口令混入项目根）与非法枚举',
    run: () => {
      const root = mkTmp();
      try {
        const write = (device: unknown): void => {
          fs.writeFileSync(
            path.join(root, 'framework.local.json'),
            JSON.stringify({ schema_version: '1.0', device }),
            'utf-8',
          );
        };
        // **安全边界**：手写 pin/password 之类必须被拒，绝不能悄悄留在 agent 可读的项目根
        write({ unlock: { mode: 'credential', pin: '000000' } });
        assert.throws(() => loadLocalConfig(root), /device\.unlock/, 'unlock 未知键须拒');

        write({ passcode: '1234' });
        assert.throws(() => loadLocalConfig(root), /device/, 'device 未知键须拒');

        write({ emulator_fallback: 'sometimes' });
        assert.throws(() => loadLocalConfig(root), /emulator_fallback/, '非法 fallback 枚举须拒');

        write({ unlock: { mode: 'auto' } });
        assert.throws(() => loadLocalConfig(root), /unlock\.mode/, '非法 mode 枚举须拒');

        write({ target_serial: '' });
        assert.throws(() => loadLocalConfig(root), /target_serial/, '空 serial 须拒');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
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
    name: 'I1 loadLocalConfig: vision.canary.probed_via roundtrip + 缺省缺该字段仍合法（向后兼容）',
    run: () => {
      const root = mkTmp();
      writeLocalConfig(root, {
        schema_version: '1.0',
        vision: {
          canary: { adapter: 'cursor', verdict: 'tool_read', probed_at: '2026-07-09T00:00:00.000Z', probed_via: 'interactive' },
        },
      });
      assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.probed_via, 'interactive');
      // 无 probed_via 的旧缓存仍读取成功（E1 已写盘的向后兼容）
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', vision: { canary: { adapter: 'cursor', verdict: 'none', probed_at: 'x' } } }),
      );
      const legacy = loadLocalConfig(root);
      assert.strictEqual(legacy?.vision?.canary?.verdict, 'none');
      assert.strictEqual(legacy?.vision?.canary?.probed_via, undefined);
      // 非法 probed_via 值被拒
      fs.writeFileSync(
        path.join(root, LOCAL_CONFIG_FILENAME),
        JSON.stringify({ schema_version: '1.0', vision: { canary: { adapter: 'cursor', verdict: 'none', probed_at: 'x', probed_via: 'bogus' } } }),
      );
      assert.throws(() => loadLocalConfig(root), /probed_via/);
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
  {
    // plan c7d2e9a4 t1/rev5：probe_version schema 边界——正整数过；0/负/小数/字符串拒；
    // 缺省合法（v1 旧缓存由 fresh 判据拒，schema 不拦）。
    name: 'c7d2e9a4 loadLocalConfig: canary.probe_version 正整数过；0/负/小数/字符串拒；缺省合法',
    run: () => {
      const write = (root: string, probeVersion: unknown): void => {
        fs.writeFileSync(
          path.join(root, LOCAL_CONFIG_FILENAME),
          JSON.stringify({
            schema_version: '1.0',
            vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: '2026-07-13T00:00:00.000Z', probe_version: probeVersion } },
          }),
        );
      };
      const root = mkTmp();
      try {
        write(root, 2);
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.probe_version, 2, '正整数应 roundtrip');
        for (const bad of [0, -1, 1.5, '2']) {
          write(root, bad);
          assert.throws(() => loadLocalConfig(root), /probe_version/, `probe_version=${JSON.stringify(bad)} 应被拒`);
        }
        fs.writeFileSync(
          path.join(root, LOCAL_CONFIG_FILENAME),
          JSON.stringify({ schema_version: '1.0', vision: { canary: { adapter: 'chrys', verdict: 'none', probed_at: 'x' } } }),
        );
        assert.strictEqual(loadLocalConfig(root)?.vision?.canary?.probe_version, undefined, '缺省应合法（旧缓存可读）');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
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
