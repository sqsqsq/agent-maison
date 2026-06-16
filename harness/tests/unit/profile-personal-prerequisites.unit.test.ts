// profile-personal-prerequisites.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { loadFrameworkConfig } from '../../config';
import {
  normalizePersonalPrerequisitesMap,
} from '../../scripts/utils/personal-prerequisite-registry';
import {
  resolvePhasePersonalPrerequisites,
} from '../../scripts/utils/phase-personal-prerequisites';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'profile-prereq-'));
}

function writeProjectConfig(root: string, profileName: string): void {
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'prereq',
        project_profile: { name: profileName, sub_variant: 'app' },
        materialized_adapters: ['claude'],
        architecture: {
          outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features' },
      },
      null,
      2,
    ),
  );
}

function resolvedWithPrereqs(
  capabilities: HarnessResolvedProfile['capabilities'],
  personalPrerequisites: HarnessResolvedProfile['personalPrerequisites'],
): HarnessResolvedProfile {
  return {
    name: 'unit',
    profileDir: '/tmp',
    yaml: { name: 'unit' },
    phasesDisabled: new Set(),
    capabilities,
    personalPrerequisites,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'normalizePersonalPrerequisitesMap: 缺失字段 throw',
    run: () => {
      assert.throws(
        () => normalizePersonalPrerequisitesMap(undefined, 't'),
        /缺少 personal_prerequisites/,
      );
      assert.throws(
        () => normalizePersonalPrerequisitesMap(null, 't'),
        /缺少 personal_prerequisites/,
      );
    },
  },
  {
    name: 'normalizePersonalPrerequisitesMap: 未知 capability throw',
    run: () => {
      assert.throws(
        () => normalizePersonalPrerequisitesMap({ 'bad.cap': ['deveco_toolchain'] }, 't'),
        /未知 capability/,
      );
    },
  },
  {
    name: 'normalizePersonalPrerequisitesMap: 未知 prerequisite throw',
    run: () => {
      assert.throws(
        () => normalizePersonalPrerequisitesMap({ 'coding.compile': ['unknown_id'] }, 't'),
        /未知 prerequisite/,
      );
    },
  },
  {
    name: 'normalizePersonalPrerequisitesMap: agent_adapter 声明 throw',
    run: () => {
      assert.throws(
        () => normalizePersonalPrerequisitesMap({ 'coding.compile': ['agent_adapter'] }, 't'),
        /不得声明 agent_adapter/,
      );
    },
  },
  {
    name: 'loadResolvedProfile: hmos-app 含 deveco 绑定',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, 'hmos-app');
      clearFrameworkConfigCache();
      const cfg = loadFrameworkConfig(root);
      const resolved = loadResolvedProfile(root, cfg);
      assert.strictEqual(resolved.name, 'hmos-app');
      assert.deepStrictEqual(resolved.personalPrerequisites['coding.compile'], ['deveco_toolchain']);
      assert.deepStrictEqual(resolved.personalPrerequisites['device_test.run'], ['deveco_toolchain']);
      const prereqs = resolvePhasePersonalPrerequisites('coding', resolved);
      assert.ok(prereqs.has('agent_adapter'));
      assert.ok(prereqs.has('deveco_toolchain'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'loadResolvedProfile: generic 显式空绑定不要求 deveco',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, 'generic');
      clearFrameworkConfigCache();
      const cfg = loadFrameworkConfig(root);
      const resolved = loadResolvedProfile(root, cfg);
      assert.deepStrictEqual(resolved.personalPrerequisites, {});
      const prereqs = resolvePhasePersonalPrerequisites('coding', resolved);
      assert.ok(prereqs.has('agent_adapter'));
      assert.ok(!prereqs.has('deveco_toolchain'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'resolvePhasePersonalPrerequisites: SKIP capability 不贡献 deveco',
    run: () => {
      const resolved = resolvedWithPrereqs(
        {
          'coding.compile': { provider: 'none', severity: 'SKIP' },
          'coding.lint': { provider: 'arkts_lint', severity: 'BLOCKER' },
        },
        {
          'coding.compile': ['deveco_toolchain'],
          'coding.lint': ['deveco_toolchain'],
        },
      );
      const prereqs = resolvePhasePersonalPrerequisites('coding', resolved);
      assert.ok(!prereqs.has('deveco_toolchain'), 'compile SKIP 时不应要求 deveco');
    },
  },
  {
    name: 'resolvePhasePersonalPrerequisites: ut phase 并集非 SKIP capability',
    run: () => {
      const resolved = resolvedWithPrereqs(
        {
          'ut.compile': { provider: 'hvigor', severity: 'BLOCKER' },
          'ut.run': { provider: 'none', severity: 'SKIP' },
        },
        {
          'ut.compile': ['deveco_toolchain'],
          'ut.run': ['deveco_toolchain'],
        },
      );
      const prereqs = resolvePhasePersonalPrerequisites('ut', resolved);
      assert.ok(prereqs.has('deveco_toolchain'));
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
