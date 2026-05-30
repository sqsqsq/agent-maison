// init-orchestrate.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  buildRunSummary,
  executeInitPlan,
  reconcileInitRunDecisionForPlan,
  type InitRunDecision,
  validateDecisionJson,
} from '../../scripts/init-orchestrate';
import {
  prepareInitExecutionPlan,
  prepareInitExecutionPlanWithStaleIds,
  probeInitTaskPlan,
  type InitTaskPlan,
} from '../../scripts/utils/init-task-planner';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'init-orch-'));
}

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function illegalConfigWritePayload(): Record<string, unknown> {
  return {
    schema_version: '1.1',
    project_name: 'invalid-arch',
    materialized_adapters: ['generic'],
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: ['MISSING'], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', agent_bundle_root: '.agents' },
  };
}

function minimalPlan(): InitTaskPlan {
  return {
    schema_version: '1.0',
    scope: 'project',
    mode: 'create',
    generated_at: new Date().toISOString(),
    tasks: [
      {
        id: 'ensure-config',
        title: 'config',
        category: 'config',
        scope: 'project',
        deps: [],
        status: 'needed',
        default_action: 'run',
        skippable: false,
        allowed_actions: ['run'],
      },
      {
        id: 'ensure-gitignore',
        title: 'gitignore',
        category: 'mechanism',
        scope: 'project',
        deps: [],
        status: 'needed',
        default_action: 'run',
        skippable: false,
        allowed_actions: ['run'],
      },
      {
        id: 'harness-install',
        title: 'npm',
        category: 'mechanism',
        scope: 'project',
        deps: ['ensure-config'],
        status: 'needed',
        default_action: 'run',
        skippable: true,
        allowed_actions: ['run', 'skip'],
      },
    ],
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'validateDecisionJson rejects unknown task',
    run: () => {
      const plan = minimalPlan();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: [{ task_id: 'no-such-task', action: 'run' }],
      };
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, false);
    },
  },
  {
    name: 'validateDecisionJson rejects skip on non-skippable',
    run: () => {
      const plan = minimalPlan();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'manual',
        plan_generated_at: plan.generated_at,
        tasks: [{ task_id: 'ensure-config', action: 'skip' }],
      };
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, false);
    },
  },
  {
    name: 'validateDecisionJson rejects dependency closure violation',
    run: () => {
      const plan = minimalPlan();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'manual',
        plan_generated_at: plan.generated_at,
        tasks: [
          { task_id: 'ensure-config', action: 'skip' },
          { task_id: 'harness-install', action: 'run' },
        ],
      };
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, false);
    },
  },
  {
    name: 'validateDecisionJson manual 缺 drift/prompt 任务显式决策',
    run: () => {
      const plan: InitTaskPlan = {
        schema_version: '1.0',
        scope: 'project',
        mode: 'update',
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'ensure-config',
            title: 'config',
            category: 'config',
            scope: 'project',
            deps: [],
            status: 'drift',
            default_action: 'prompt',
            skippable: true,
            allowed_actions: ['overwrite', 'keep'],
            decision_class: 'init.task_decision',
          },
        ],
      };
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'manual',
        plan_generated_at: plan.generated_at,
        tasks: [],
      };
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, false);
      if (r.ok === false) {
        assert(r.error.includes('ensure-config'));
        assert(r.error.includes('manual 模式缺少显式决策'));
      }
    },
  },
  {
    name: 'validateDecisionJson manual personal record-adapter 缺决策 reject',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'manual-decision',
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
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'personal' });
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'personal',
        decision_mode: 'manual',
        plan_generated_at: plan.generated_at,
        tasks: [],
      };
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, false);
      if (r.ok === false) {
        assert(r.error.includes('record-adapter'));
      }
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitPlan manual personal record-adapter 缺决策抛错且不写 local',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'manual-exec',
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
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'personal' });
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'personal',
        decision_mode: 'manual',
        plan_generated_at: plan.generated_at,
        tasks: [],
      };
      assert.throws(
        () => executeInitPlan({
          projectRoot: root,
          harnessRoot: path.join(__dirname, '../..'),
          plan,
          decision,
          executionContext: { activeAdapter: 'claude', materializedAdapters: ['claude'] },
        }),
        /决策 JSON 非法.*record-adapter/,
      );
      assert(!fs.existsSync(path.join(root, 'framework.local.json')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'buildRunSummary is deterministic structure',
    run: () => {
      const s = buildRunSummary({
        schema_version: '1.0',
        scope: 'project',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:01:00Z',
        decision_mode: 'smart',
        entries: [
          { task_id: 'ensure-gitignore', action: 'run', status: 'executed', message: 'ok' },
        ],
      });
      assert(s.includes('ensure-gitignore'));
      assert(s.includes('executed=1'));
    },
  },
  {
    name: 'executeInitPlan 依赖失败时跳过后续任务',
    run: () => {
      const plan: InitTaskPlan = {
        schema_version: '1.0',
        scope: 'personal',
        mode: 'update',
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'record-adapter',
            title: 'record',
            category: 'personal',
            scope: 'personal',
            deps: [],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
          },
          {
            id: 'detect-deveco',
            title: 'deveco',
            category: 'personal',
            scope: 'personal',
            deps: ['record-adapter'],
            status: 'needed',
            default_action: 'run',
            skippable: true,
            allowed_actions: ['run', 'skip'],
          },
        ],
      };
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'personal',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: [
          { task_id: 'record-adapter', action: 'run' },
          { task_id: 'detect-deveco', action: 'run' },
        ],
      };
      const log = executeInitPlan({
        projectRoot: mkTmp(),
        harnessRoot: path.join(__dirname, '../..'),
        plan,
        decision,
      });
      const recordEntry = log.entries.find(e => e.task_id === 'record-adapter');
      const devecoEntry = log.entries.find(e => e.task_id === 'detect-deveco');
      assert(recordEntry?.status === 'failed');
      assert(devecoEntry?.status === 'skipped');
      assert(devecoEntry?.message.includes('依赖'));
    },
  },
  {
    name: 'executeInitPlan ensure-config 校验失败时跳过依赖任务且不落盘',
    run: () => {
      const root = mkTmp();
      const plan = minimalPlan();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: plan.tasks.map(t => ({ task_id: t.id, action: 'run' as const })),
      };
      const log = executeInitPlan({
        projectRoot: root,
        harnessRoot: path.join(__dirname, '../..'),
        plan,
        decision,
        executionContext: { configWritePayload: illegalConfigWritePayload() },
      });
      const configEntry = log.entries.find(e => e.task_id === 'ensure-config');
      const harnessEntry = log.entries.find(e => e.task_id === 'harness-install');
      assert.strictEqual(configEntry?.status, 'failed');
      assert(configEntry?.message.includes('config 校验失败'));
      assert.strictEqual(harnessEntry?.status, 'skipped');
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'prepareInitExecutionPlan CREATE context cursor 不含 generic',
    run: () => {
      const root = mkTmp();
      const plan = prepareInitExecutionPlan(
        { projectRoot: root, scope: 'project' },
        { materializedAdapters: ['cursor'] },
      );
      assert(plan.tasks.some(t => t.id === 'materialize-adapter:cursor'));
      assert(!plan.tasks.some(t => t.id === 'materialize-adapter:generic'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'prepareInitExecutionPlan CREATE configWritePayload 双 adapter',
    run: () => {
      const root = mkTmp();
      const plan = prepareInitExecutionPlan(
        { projectRoot: root, scope: 'project' },
        {
          configWritePayload: {
            materialized_adapters: ['claude', 'cursor'],
          },
        },
      );
      assert(plan.tasks.some(t => t.id === 'materialize-adapter:claude'));
      assert(plan.tasks.some(t => t.id === 'materialize-adapter:cursor'));
      assert(!plan.tasks.some(t => t.id === 'materialize-adapter:generic'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileInitRunDecisionForPlan 丢弃 S1 materialize-adapter:generic',
    run: () => {
      const root = mkTmp();
      const prepared = prepareInitExecutionPlanWithStaleIds(
        { projectRoot: root, scope: 'project' },
        { materializedAdapters: ['cursor'] },
      );
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: prepared.plan.generated_at,
        tasks: [
          { task_id: 'ensure-config', action: 'run' },
          { task_id: 'materialize-adapter:generic', action: 'run' },
        ],
      };
      assert(prepared.staleMaterializeTaskIds.includes('materialize-adapter:generic'));
      const reconciled = reconcileInitRunDecisionForPlan(prepared.plan, decision, {
        staleMaterializeTaskIds: prepared.staleMaterializeTaskIds,
      });
      const validation = validateDecisionJson(prepared.plan, reconciled);
      assert.strictEqual(validation.ok, true);
      assert(!reconciled.tasks.some(t => t.task_id === 'materialize-adapter:generic'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileInitRunDecisionForPlan 保留 materialize-adapter:evil 供 validate 拒绝',
    run: () => {
      const root = mkTmp();
      const prepared = prepareInitExecutionPlanWithStaleIds(
        { projectRoot: root, scope: 'project' },
        { materializedAdapters: ['cursor'] },
      );
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: prepared.plan.generated_at,
        tasks: [{ task_id: 'materialize-adapter:evil', action: 'run' }],
      };
      const reconciled = reconcileInitRunDecisionForPlan(prepared.plan, decision, {
        staleMaterializeTaskIds: prepared.staleMaterializeTaskIds,
      });
      assert(reconciled.tasks.some(t => t.task_id === 'materialize-adapter:evil'));
      const validation = validateDecisionJson(prepared.plan, reconciled);
      assert.strictEqual(validation.ok, false);
      if (validation.ok === false) {
        assert(validation.error.includes('materialize-adapter:evil'));
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'reconcileInitRunDecisionForPlan 保留非物化未知 task 供 validate 拒绝',
    run: () => {
      const root = mkTmp();
      const plan = prepareInitExecutionPlan(
        { projectRoot: root, scope: 'project' },
        { materializedAdapters: ['cursor'] },
      );
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: [{ task_id: 'totally-unknown-task', action: 'run' }],
      };
      const reconciled = reconcileInitRunDecisionForPlan(plan, decision);
      assert(reconciled.tasks.some(t => t.task_id === 'totally-unknown-task'));
      const validation = validateDecisionJson(plan, reconciled);
      assert.strictEqual(validation.ok, false);
      if (validation.ok === false) {
        assert(validation.error.includes('totally-unknown-task'));
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitPlan 未知 task_id 抛错且不落盘',
    run: () => {
      const root = mkTmp();
      const plan = prepareInitExecutionPlan(
        { projectRoot: root, scope: 'project' },
        { materializedAdapters: ['cursor'] },
      );
      const configWritePayload = {
        schema_version: '1.1',
        project_name: 'cursor-only',
        project_profile: { name: 'generic' },
        materialized_adapters: ['cursor'],
        architecture: {
          outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features' },
      };
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: [{ task_id: 'totally-unknown-task', action: 'run' }],
      };
      assert.throws(
        () => executeInitPlan({
          projectRoot: root,
          harnessRoot: path.join(__dirname, '../..'),
          plan,
          decision: reconcileInitRunDecisionForPlan(plan, decision),
          executionContext: { materializedAdapters: ['cursor'], configWritePayload },
        }),
        /决策 JSON 非法.*totally-unknown-task/,
      );
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitPlan CREATE context cursor 含 materialize-adapter:cursor 任务',
    run: () => {
      const root = mkTmp();
      const executionContext = {
        materializedAdapters: ['cursor'],
        configWritePayload: {
          schema_version: '1.1',
          project_name: 'cursor-only',
          project_profile: { name: 'generic' },
          materialized_adapters: ['cursor'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        },
      };
      const prepared = prepareInitExecutionPlanWithStaleIds(
        { projectRoot: root, scope: 'project' },
        executionContext,
      );
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: prepared.plan.generated_at,
        tasks: [{ task_id: 'materialize-adapter:generic', action: 'run' }],
      };
      const log = executeInitPlan({
        projectRoot: root,
        harnessRoot: path.join(__dirname, '../..'),
        plan: prepared.plan,
        decision: reconcileInitRunDecisionForPlan(prepared.plan, decision, {
          staleMaterializeTaskIds: prepared.staleMaterializeTaskIds,
        }),
        executionContext,
      });
      const materializeEntry = log.entries.find(e => e.task_id === 'materialize-adapter:cursor');
      assert(materializeEntry, 'run-log 应含 materialize-adapter:cursor');
      assert(!log.entries.some(e => e.task_id === 'materialize-adapter:generic'));
      assert.strictEqual(materializeEntry!.status, 'executed');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitPlan materialize-adapter:evil 抛错且不落盘',
    run: () => {
      const root = mkTmp();
      const executionContext = {
        materializedAdapters: ['cursor'],
        configWritePayload: {
          schema_version: '1.1',
          project_name: 'cursor-only',
          project_profile: { name: 'generic' },
          materialized_adapters: ['cursor'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        },
      };
      const prepared = prepareInitExecutionPlanWithStaleIds(
        { projectRoot: root, scope: 'project' },
        executionContext,
      );
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: prepared.plan.generated_at,
        tasks: [{ task_id: 'materialize-adapter:evil', action: 'run' }],
      };
      assert.throws(
        () => executeInitPlan({
          projectRoot: root,
          harnessRoot: path.join(__dirname, '../..'),
          plan: prepared.plan,
          decision: reconcileInitRunDecisionForPlan(prepared.plan, decision, {
            staleMaterializeTaskIds: prepared.staleMaterializeTaskIds,
          }),
          executionContext,
        }),
        /决策 JSON 非法.*materialize-adapter:evil/,
      );
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
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
