// config-placement-gate.unit.test.ts — project personal 错位门控 + compile 前 BLOCKER

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  clearFrameworkConfigCache,
  loadDevEcoConfig,
  loadFrameworkConfig,
} from '../../config';
import { evaluateConfigPlacementGate } from '../../scripts/utils/config-placement-gate';
import { evaluatePersonalSetupGate } from '../../scripts/utils/personal-setup-gate';
import { resolvePhasePersonalPrerequisites } from '../../scripts/utils/phase-personal-prerequisites';
import { loadResolvedProfile } from '../../profile-loader';
import type { UnitCaseResult } from '../run-unit';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-placement-gate-'));
}

function writeMinimalProject(root: string, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'placement-gate',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        materialized_adapters: ['claude', 'generic'],
        architecture: {
          outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features' },
        ...extra,
      },
      null,
      2,
    ),
  );
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '错位 installPath：loadDevEcoConfig fail-closed 读不到',
    run: () => {
      const root = mkTmp();
      writeMinimalProject(root, {
        toolchain: { devEcoStudio: { installPath: 'C:/wrong-project-path' } },
      });
      clearFrameworkConfigCache();
      assert.strictEqual(loadDevEcoConfig(root), undefined);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: '错位 installPath：compile 前 placement BLOCKER（coding phase）',
    run: () => {
      const root = mkTmp();
      writeMinimalProject(root, {
        toolchain: { devEcoStudio: { installPath: 'C:/wrong-project-path' } },
      });
      clearFrameworkConfigCache();
      const cfg = loadFrameworkConfig(root);
      const resolved = loadResolvedProfile(root, cfg);
      const prereqs = resolvePhasePersonalPrerequisites('coding', resolved);
      assert(prereqs.has('deveco_toolchain'));

      const placement = evaluateConfigPlacementGate(root);
      assert.strictEqual(placement.ok, false);
      assert.strictEqual(placement.code, 'misconfigured_personal_fields');

      const gate = evaluatePersonalSetupGate(root, { requiredPrerequisites: prereqs });
      assert.strictEqual(gate.ok, false);
      assert.strictEqual(gate.code, 'misconfigured_personal_fields');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: '清场后 project 无 devEco：placement ok；deveco 仍缺 local',
    run: () => {
      const root = mkTmp();
      writeMinimalProject(root);
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' }, null, 2),
      );
      clearFrameworkConfigCache();
      const placement = evaluateConfigPlacementGate(root);
      assert.strictEqual(placement.ok, true);
      const cfg = loadFrameworkConfig(root);
      const resolved = loadResolvedProfile(root, cfg);
      const gate = evaluatePersonalSetupGate(root, {
        requiredPrerequisites: resolvePhasePersonalPrerequisites('coding', resolved),
      });
      assert.strictEqual(gate.ok, false);
      assert.strictEqual(gate.code, 'deveco_toolchain_missing');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
