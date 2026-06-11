// goal-preflight.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  resolveAdapterProvenance,
  runGoalPreflight,
} from '../../scripts/utils/goal-preflight';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { DEFAULT_DEPENDENCY_POLICY } from '../../scripts/utils/phase-transition-policy';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goal-preflight-'));
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
        project_name: 'goal-preflight',
        materialized_adapters: materialized,
        architecture: minimalArchitecture(),
        paths: { features_dir: 'doc/features' },
      },
      null,
      2,
    ),
  );
}

function baseManifest(adapter: string): GoalManifest {
  return {
    schema_version: '1.0',
    run_id: 'test-run',
    feature: 'demo',
    requirement: 'test',
    adapter,
    start_phase: 'spec',
    end_phase: 'testing',
    report_dir: 'doc/features/demo/goal-runs/test-run',
    created_at: '2026-06-09T00:00:00Z',
    unattended: {
      write_mode: 'workspace-write',
      approval_mode: 'never',
      max_turns: 20,
      timeout_seconds: 3600,
    },
    budget: {
      max_total_turns: 10,
      max_retries_per_phase: 1,
      wall_clock_minutes: 60,
    },
    dependency_policy: {
      deferrable_blocking_classes: DEFAULT_DEPENDENCY_POLICY.deferrable_blocking_classes ?? [],
      deferrable_failure_kinds: DEFAULT_DEPENDENCY_POLICY.deferrable_failure_kinds ?? [],
      propagate_to_downstream: DEFAULT_DEPENDENCY_POLICY.propagate_to_downstream ?? true,
    },
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveAdapterProvenance: --adapter → argv_adapter',
    run: () => {
      const p = resolveAdapterProvenance(
        { adapter: 'cursor' },
        { agent_adapter: 'generic', source: 'fallback', local_exists: false, project_has_legacy_agent_adapter: false },
      );
      assert.strictEqual(p, 'argv_adapter');
    },
  },
  {
    name: 'resolveAdapterProvenance: --resume → manifest_adapter',
    run: () => {
      const p = resolveAdapterProvenance(
        { resume: 'run-1' },
        { agent_adapter: 'generic', source: 'fallback', local_exists: false, project_has_legacy_agent_adapter: false },
      );
      assert.strictEqual(p, 'manifest_adapter');
    },
  },
  {
    name: 'runGoalPreflight: fallback provenance BLOCKER',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['cursor']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      let threw = false;
      try {
        runGoalPreflight({
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          manifest: baseManifest('cursor'),
          provenance: 'fallback',
          dryRun: false,
        });
      } catch (e) {
        threw = true;
        assert.match((e as Error).message, /framework\.local\.json/);
      }
      assert.ok(threw, 'expected BLOCKER');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runGoalPreflight: argv_adapter 显式 cursor 已物化不因 fallback 误杀',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['cursor']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      runGoalPreflight({
        projectRoot: root,
        frameworkRoot: FRAMEWORK_ROOT,
        manifest: baseManifest('cursor'),
        provenance: 'argv_adapter',
        dryRun: true,
      });
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runGoalPreflight: manifest_adapter 无 local 不因 fallback 误杀',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['cursor']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      runGoalPreflight({
        projectRoot: root,
        frameworkRoot: FRAMEWORK_ROOT,
        manifest: baseManifest('cursor'),
        provenance: 'manifest_adapter',
        dryRun: true,
      });
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runGoalPreflight: adapter 不在 materialized BLOCKER',
    run: () => {
      const root = mkTmp();
      writeProjectConfig(root, ['claude']);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();
      let threw = false;
      try {
        runGoalPreflight({
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          manifest: baseManifest('cursor'),
          provenance: 'argv_adapter',
          dryRun: false,
        });
      } catch (e) {
        threw = true;
        assert.match((e as Error).message, /materialized_adapters/);
      }
      assert.ok(threw, 'expected BLOCKER');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
