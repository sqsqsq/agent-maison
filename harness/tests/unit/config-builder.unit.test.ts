// config-builder.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildProjectConfigForWrite,
  prepareConfigWriteForTask,
} from '../../scripts/utils/config-builder';
import { getEffectiveBackfillFields } from '../../scripts/utils/config-field-merger';
import { preflightExecute, buildRunLogAuditMeta } from '../../scripts/init-orchestrate';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function minimalArch(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-builder-'));
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'getEffectiveBackfillFields generic 不含 tools.hylyre',
    run: () => {
      const fields = getEffectiveBackfillFields('generic');
      assert(!fields.some(f => f.path.startsWith('tools.hylyre')), fields.map(f => f.path).join(','));
      assert(fields.some(f => f.path === 'schema_version'));
    },
  },
  {
    name: 'getEffectiveBackfillFields hmos-app 含 tools.hylyre.vendor_dir',
    run: () => {
      const fields = getEffectiveBackfillFields('hmos-app');
      assert(fields.some(f => f.path === 'tools.hylyre.vendor_dir'));
    },
  },
  {
    name: 'buildProjectConfigForWrite 仅 outer_layers 时落盘完整 architecture DSL',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: {
          outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
        },
      });
      const arch = out.architecture as Record<string, unknown>;
      assert(Array.isArray(arch.module_inner_layers) && arch.module_inner_layers.length > 0);
      assert.strictEqual(arch.inner_dependency_direction, 'upward');
      assert(typeof arch.cross_module_exports_file === 'string' && arch.cross_module_exports_file.length > 0);
    },
  },
  {
    name: 'buildProjectConfigForWrite payload 漏 schema_version 仍落盘 1.1',
    run: () => {
      const out = buildProjectConfigForWrite({
        project_name: 'demo',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      });
      assert.strictEqual(out.schema_version, '1.1');
      assert.strictEqual((out.state_machine as Record<string, unknown>)?.schema_version, '1.1');
      assert.strictEqual(out.tools, undefined);
    },
  },
  {
    name: 'buildProjectConfigForWrite 旧 generic overwrite 漏 project_profile 仍保持 generic',
    run: () => {
      const existing = {
        schema_version: '1.1',
        project_name: 'legacy',
        project_profile: { name: 'generic' },
        materialized_adapters: ['generic'],
        architecture: minimalArch(),
        paths: { features_dir: 'doc/features' },
      };
      const out = buildProjectConfigForWrite(
        {
          project_name: 'legacy',
          materialized_adapters: ['generic'],
          architecture: minimalArch(),
        },
        { existingConfig: existing },
      );
      assert.strictEqual((out.project_profile as { name: string }).name, 'generic');
      assert.strictEqual(out.tools, undefined);
    },
  },
  {
    name: 'prepareConfigWriteForTask 剥离 agent_adapter 与 installPath',
    run: () => {
      const root = mkTmp();
      const out = prepareConfigWriteForTask(
        {
          projectRoot: root,
          configWritePayload: {
            project_name: 't',
            project_profile: { name: 'generic' },
            materialized_adapters: ['generic'],
            agent_adapter: 'claude',
            project_type: 'app',
            architecture: minimalArch(),
            toolchain: { devEcoStudio: { installPath: 'C:\\DevEco' } },
          },
        },
        'run',
      );
      assert.strictEqual(out.agent_adapter, undefined);
      assert.strictEqual(out.project_type, undefined);
      const tc = out.toolchain as Record<string, unknown> | undefined;
      const deveco = tc?.devEcoStudio as Record<string, unknown> | undefined;
      assert.strictEqual(deveco?.installPath, undefined);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'probeInitTaskPlan 缺 project_name 时 ensure-config 为 needed+prompt 非 skip',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          materialized_adapters: ['cursor'],
          architecture: minimalArch(),
          paths: { features_dir: 'doc/features' },
          state_machine: { schema_version: '1.1' },
        }),
      );
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project' });
      const cfg = plan.tasks.find(t => t.id === 'ensure-config');
      assert(cfg, '应有 ensure-config');
      assert.strictEqual(cfg.status, 'needed');
      assert.strictEqual(cfg.default_action, 'prompt');
      assert.strictEqual(cfg.skippable, false);
      assert.deepStrictEqual(cfg.allowed_actions, ['overwrite']);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflightExecute options.projectRoot 可替代 audit.project_root',
    run: () => {
      const root = mkTmp();
      const payload = {
        project_name: 'opts-root',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      };
      const plan = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        mode: 'create' as const,
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'ensure-config',
            title: 'config',
            category: 'config',
            scope: 'project' as const,
            deps: [],
            status: 'needed' as const,
            default_action: 'run' as const,
            skippable: false,
            allowed_actions: ['run' as const],
          },
        ],
      };
      const decision = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        decision_mode: 'smart' as const,
        plan_generated_at: plan.generated_at,
        materialized_adapters: ['cursor'],
        tasks: [{ task_id: 'ensure-config', action: 'run' as const }],
      };
      const audit = buildRunLogAuditMeta({ plan, decision });
      const pre = preflightExecute(
        plan,
        decision,
        { configWritePayload: payload, materializedAdapters: ['cursor'] },
        audit,
        { projectRoot: root },
      );
      assert.strictEqual(pre.ok, true);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflight 与 executor ensure-config 落盘 byte-for-byte 一致',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      const payload = {
        project_name: 'parity',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: minimalArch(),
      };
      const plan = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        mode: 'create' as const,
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'ensure-config',
            title: 'config',
            category: 'config',
            scope: 'project' as const,
            deps: [],
            status: 'needed' as const,
            default_action: 'run' as const,
            skippable: false,
            allowed_actions: ['run' as const],
          },
        ],
      };
      const decision = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        decision_mode: 'smart' as const,
        plan_generated_at: plan.generated_at,
        materialized_adapters: ['cursor'],
        tasks: [{ task_id: 'ensure-config', action: 'run' as const }],
      };
      const ctx = { configWritePayload: payload, materializedAdapters: ['cursor'] };
      const audit = buildRunLogAuditMeta({ plan, decision, projectRoot: root });
      const pre = preflightExecute(plan, decision, ctx, audit);
      assert.strictEqual(pre.ok, true);
      const built = prepareConfigWriteForTask({ projectRoot: root, configWritePayload: payload }, 'run');
      const execCtx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan,
        configWritePayload: payload,
      };
      executeInitTask(plan.tasks[0]!, 'run', execCtx);
      const onDisk = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8');
      assert.strictEqual(onDisk, `${JSON.stringify(built, null, 2)}\n`);
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
