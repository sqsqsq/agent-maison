// init-orchestrate-smoke.unit.test.ts — 编排化 init 消费者 smoke（只读探测 + legacy 外迁）

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { runInitProbe } from '../../scripts/check-init';
import { executeInitPlan, type InitRunDecision } from '../../scripts/init-orchestrate';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'init-smoke-'));
}

function minimalArchitecture(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

function harnessCtx(projectRoot: string): InitExecutionContext {
  const layout = detectRepoLayout(path.join(__dirname, '../..'));
  return {
    projectRoot,
    harnessRoot: harnessRootFromLayout(layout),
    plan: {
      schema_version: '1.0',
      scope: 'project',
      mode: 'update',
      generated_at: '',
      tasks: [],
    },
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'probeInitTaskPlan project scope 不修改 .gitignore / 不创建 local',
    run: () => {
      const root = mkTmp();
      const gitignore = path.join(root, '.gitignore');
      fs.writeFileSync(gitignore, '# probe canary\n');
      const localPath = path.join(root, 'framework.local.json');

      const beforeGit = fs.statSync(gitignore).mtimeMs;
      probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'generic' });
      const afterGit = fs.statSync(gitignore).mtimeMs;

      assert.strictEqual(beforeGit, afterGit, '.gitignore mtime 不应变化');
      assert(!fs.existsSync(localPath), '不应创建 framework.local.json');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'probeInitTaskPlan personal scope 只读',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'smoke',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      const localPath = path.join(root, 'framework.local.json');
      probeInitTaskPlan({ projectRoot: root, scope: 'personal' });
      assert(!fs.existsSync(localPath));
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'personal' });
      assert(plan.tasks.some(t => t.id === 'record-adapter'));
      assert(plan.tasks.some(t => t.id === 'assert-active-adapter-materialized'));
      const assertIdx = plan.tasks.findIndex(t => t.id === 'assert-active-adapter-materialized');
      const recordIdx = plan.tasks.findIndex(t => t.id === 'record-adapter');
      assert(assertIdx >= 0 && recordIdx > assertIdx, 'assert 须在 record 之前');
      assert(
        plan.tasks.find(t => t.id === 'record-adapter')!.deps.includes('assert-active-adapter-materialized'),
      );
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'legacy config UPDATE：migrate-config 外迁 personal 字段',
    run: () => {
      const root = mkTmp();
      const configPath = path.join(root, 'framework.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            schema_version: '1.0',
            project_name: 'legacy-smoke',
            agent_adapter: 'claude',
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
            toolchain: { devEcoStudio: { installPath: 'C:/DevEco/Studio' } },
          },
          null,
          2,
        ),
      );

      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'claude' });
      assert(plan.tasks.some(t => t.id === 'migrate-config'), 'UPDATE 应挂 migrate-config');

      const ctx = harnessCtx(root);
      ctx.plan = plan;
      executeInitTask(
        plan.tasks.find(t => t.id === 'migrate-config')!,
        'run',
        ctx,
      );

      const projectRaw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      assert.strictEqual(projectRaw.agent_adapter, undefined);
      assert(Array.isArray(projectRaw.materialized_adapters));
      assert((projectRaw.materialized_adapters as string[]).includes('claude'));
      const tc = projectRaw.toolchain as Record<string, unknown> | undefined;
      const deveco = tc?.devEcoStudio as Record<string, unknown> | undefined;
      assert(!deveco?.installPath, 'DevEco installPath 应从 project config 外迁');

      const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
      assert.strictEqual(local.agent_adapter, 'claude');
      assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, 'C:/DevEco/Studio');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'InitTaskPlan 含 materialize-adapter 与 ensure-gitignore 任务',
    run: () => {
      const root = mkTmp();
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'claude' });
      assert(plan.tasks.some(t => t.id === 'ensure-gitignore'));
      assert(plan.tasks.some(t => t.id.startsWith('materialize-adapter:')));
      assert.strictEqual(plan.scope, 'project');
      assert(['create', 'update'].includes(plan.mode));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'project probe 不受 local agent_adapter 污染',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'local-pollution',
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

      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project' });
      assert(plan.tasks.some(t => t.id === 'materialize-adapter:cursor'));
      assert(!plan.tasks.some(t => t.id === 'materialize-adapter:claude'));

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'personal setup：assert 失败时不写 local',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'setup-order',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'personal' });
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'personal',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: plan.tasks.map(t => ({ task_id: t.id, action: 'run' as const })),
      };
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const log = executeInitPlan({
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan,
        decision,
        executionContext: { activeAdapter: 'claude', materializedAdapters: ['claude'] },
      });
      assert(log.entries.find(e => e.task_id === 'assert-active-adapter-materialized')?.status === 'failed');
      assert(log.entries.find(e => e.task_id === 'record-adapter')?.status === 'skipped');
      assert(!fs.existsSync(path.join(root, 'framework.local.json')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'runInitProbe 无 .gitignore 时 inspection #11 为 MISSING',
    run: () => {
      const root = mkTmp();
      const probe = runInitProbe({ projectRoot: root, adapterHint: 'claude' });
      const ins11 = probe.inspections.find(i => i.index === 11);
      assert(ins11);
      assert.strictEqual(ins11!.status, 'MISSING');
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
