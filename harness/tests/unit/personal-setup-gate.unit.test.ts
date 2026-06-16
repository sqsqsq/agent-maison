// personal-setup-gate.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  ensurePersonalSetup,
  evaluatePersonalSetupGate,
  resolveEnsurePrerequisites,
  __testing_setDetectScanForEnsure,
} from '../../scripts/utils/personal-setup-gate';
import { resolvePhasePersonalPrerequisites } from '../../scripts/utils/phase-personal-prerequisites';
import { loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';

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

function writeProjectConfig(root: string, materialized: string[], profileName = 'generic'): void {
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'gate',
        project_profile: { name: profileName, sub_variant: 'app' },
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
    name: 'resolveEnsurePrerequisites: 无 --phase 仅 agent_adapter',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude'], 'hmos-app');
      clearFrameworkConfigCache();
      const prereqs = resolveEnsurePrerequisites(root);
      assert.strictEqual(prereqs.size, 1);
      assert.ok(prereqs.has('agent_adapter'));
      assert.ok(!prereqs.has('deveco_toolchain'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'resolveEnsurePrerequisites: --phase coding 含 deveco_toolchain（hmos-app）',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude'], 'hmos-app');
      clearFrameworkConfigCache();
      const prereqs = resolveEnsurePrerequisites(root, 'coding');
      assert.ok(prereqs.has('agent_adapter'));
      assert.ok(prereqs.has('deveco_toolchain'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'ensurePersonalSetup: adapter 就绪但缺 deveco 时 --phase coding 不放行 adapter-only ok',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude'], 'hmos-app');
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' }, null, 2),
      );
      clearFrameworkConfigCache();
      const cfg = loadFrameworkConfig(root);
      const resolved = loadResolvedProfile(root, cfg);
      const prereqs = resolvePhasePersonalPrerequisites('coding', resolved);
      const payload = ensurePersonalSetup(root, { requiredPrerequisites: prereqs });
      if (payload.ok) {
        assert.ok(
          payload.ensured === 'auto_detect_deveco',
          'ok 时必须由 auto_detect_deveco 补齐，不能 adapter-only 假成功',
        );
      } else {
        assert.strictEqual(payload.code, 'deveco_toolchain_missing');
      }
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'ensurePersonalSetup: 干净宿主单次 ensure 修 adapter+deveco（--phase coding）',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude'], 'hmos-app');
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');

      const fakeInstall = path.join(root, 'fake-deveco');
      const hvigorBin = path.join(
        fakeInstall,
        'tools',
        'hvigor',
        'bin',
        process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw',
      );
      fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
      fs.writeFileSync(hvigorBin, '');

      __testing_setDetectScanForEnsure(() => ({
        candidates: [],
        recommended: {
          status: 'ok',
          installPath: fakeInstall,
          source: 'scan',
          missing: [],
        },
      }));

      try {
        clearFrameworkConfigCache();
        const prereqs = resolveEnsurePrerequisites(root, 'coding');
        const payload = ensurePersonalSetup(root, { requiredPrerequisites: prereqs });
        assert.strictEqual(payload.ok, true, payload.message);
        assert.strictEqual(payload.ensured, 'auto_single_adapter_and_deveco');
        assert.strictEqual(payload.activeAdapter, 'claude');

        const local = JSON.parse(
          fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'),
        ) as { agent_adapter?: string; toolchain?: { devEcoStudio?: { installPath?: string } } };
        assert.strictEqual(local.agent_adapter, 'claude');
        assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, fakeInstall);

        const after = evaluatePersonalSetupGate(root, { requiredPrerequisites: prereqs });
        assert.strictEqual(after.ok, true);
      } finally {
        __testing_setDetectScanForEnsure(null);
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
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
