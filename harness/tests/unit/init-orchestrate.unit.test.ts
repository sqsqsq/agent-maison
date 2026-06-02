// init-orchestrate.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  assertDecisionStructure,
  buildInitStagingTemplate,
  buildRunSummary,
  executeInitPlan,
  preflightExecute,
  readJsonFile,
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

function validConfigWritePayload(): Record<string, unknown> {
  return {
    schema_version: '1.1',
    project_name: 'valid-init',
    materialized_adapters: ['generic'],
    architecture: {
      outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
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

function planWithDocTask(): InitTaskPlan {
  const base = minimalPlan();
  return {
    ...base,
    tasks: [
      ...base.tasks,
      {
        id: 'write-architecture',
        title: 'doc/architecture.md',
        category: 'docs',
        scope: 'project',
        deps: ['ensure-config'],
        status: 'needed',
        default_action: 'run',
        skippable: true,
        allowed_actions: ['run', 'skip'],
        target_path: 'doc/architecture.md',
      },
    ],
  };
}

function docOnlyPlan(): InitTaskPlan {
  return {
    schema_version: '1.0',
    scope: 'project',
    mode: 'create',
    generated_at: new Date().toISOString(),
    tasks: [
      {
        id: 'write-architecture',
        title: 'doc/architecture.md',
        category: 'docs',
        scope: 'project',
        deps: [],
        status: 'needed',
        default_action: 'run',
        skippable: true,
        allowed_actions: ['run', 'skip'],
        target_path: 'doc/architecture.md',
      },
    ],
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'readJsonFile parses UTF-8 BOM decision.json',
    run: () => {
      const root = mkTmp();
      const file = path.join(root, 'decision.json');
      const payload = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: new Date().toISOString(),
        tasks: [],
      };
      fs.writeFileSync(file, `\uFEFF${JSON.stringify(payload)}`, 'utf-8');
      const parsed = readJsonFile<typeof payload>(file, '决策');
      assert.strictEqual(parsed.schema_version, '1.0');
      assert.strictEqual(parsed.scope, 'project');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'readJsonFile invalid decision JSON uses 决策 label',
    run: () => {
      const root = mkTmp();
      const file = path.join(root, 'decision.json');
      fs.writeFileSync(file, '{not-json', 'utf-8');
      assert.throws(
        () => readJsonFile(file, '决策'),
        (e: Error) => e.message.includes('决策 JSON 非法') && e.message.includes('无法解析 JSON'),
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'readJsonFile invalid context JSON uses 上下文 label',
    run: () => {
      const root = mkTmp();
      const file = path.join(root, 'context.json');
      fs.writeFileSync(file, '{not-json', 'utf-8');
      assert.throws(
        () => readJsonFile(file, '上下文'),
        (e: Error) => e.message.includes('上下文 JSON 非法') && e.message.includes('无法解析 JSON'),
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'readJsonFile parses UTF-8 BOM context.json',
    run: () => {
      const root = mkTmp();
      const file = path.join(root, 'context.json');
      fs.writeFileSync(file, `\uFEFF${JSON.stringify({ configWritePayload: { project_name: 'x' } })}`, 'utf-8');
      const parsed = readJsonFile<{ configWritePayload: { project_name: string } }>(file, '上下文');
      assert.strictEqual(parsed.configWritePayload.project_name, 'x');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'assertDecisionStructure rejects missing tasks',
    run: () => {
      assert.throws(
        () =>
          assertDecisionStructure({
            schema_version: '1.0',
            scope: 'project',
            decision_mode: 'smart',
            plan_generated_at: new Date().toISOString(),
          }),
        /tasks 缺失或非数组/,
      );
    },
  },
  {
    name: 'assertDecisionStructure rejects legacy staging shape with guidance',
    run: () => {
      assert.throws(
        () =>
          assertDecisionStructure({
            mode: 'smart_run',
            task_decisions: {},
            materialized_adapters: ['claude'],
          }),
        (e: Error) =>
          e.message.includes('旧 staging 结构') &&
          e.message.includes('schema_version/scope/decision_mode/plan_generated_at/tasks[]') &&
          e.message.includes('--emit-staging-template'),
      );
    },
  },
  {
    name: 'assertDecisionStructure rejects bad schema_version',
    run: () => {
      assert.throws(
        () =>
          assertDecisionStructure({
            schema_version: '2.0',
            scope: 'project',
            decision_mode: 'smart',
            plan_generated_at: new Date().toISOString(),
            tasks: [],
          }),
        /schema_version 须为 "1.0"/,
      );
    },
  },
  {
    name: 'assertDecisionStructure rejects bad scope',
    run: () => {
      assert.throws(
        () =>
          assertDecisionStructure({
            schema_version: '1.0',
            scope: 'evil',
            decision_mode: 'smart',
            plan_generated_at: new Date().toISOString(),
            tasks: [],
          }),
        /scope 须为 project\|personal/,
      );
    },
  },
  {
    name: 'assertDecisionStructure rejects bad decision_mode',
    run: () => {
      assert.throws(
        () =>
          assertDecisionStructure({
            schema_version: '1.0',
            scope: 'project',
            decision_mode: 'manul',
            plan_generated_at: new Date().toISOString(),
            tasks: [],
          }),
        /decision_mode 须为 smart\|manual/,
      );
    },
  },
  {
    name: 'assertDecisionStructure rejects task missing task_id',
    run: () => {
      assert.throws(
        () =>
          assertDecisionStructure({
            schema_version: '1.0',
            scope: 'project',
            decision_mode: 'smart',
            plan_generated_at: new Date().toISOString(),
            tasks: [{ action: 'run' }],
          }),
        /task_id 缺失或非字符串/,
      );
    },
  },
  {
    name: 'preflightExecute unknown task_id blocked with all plan tasks skipped',
    run: () => {
      const plan = minimalPlan();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: [{ task_id: 'no-such-task', action: 'run' }],
      };
      const r = preflightExecute(plan, decision);
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        const blocked = r.blocked;
        assert(blocked.entries.some(e => e.task_id === 'no-such-task' && e.status === 'failed'));
        for (const task of plan.tasks) {
          const entry = blocked.entries.find(e => e.task_id === task.id);
          assert(entry);
          assert.strictEqual(entry!.status, 'skipped');
        }
      }
    },
  },
  {
    name: 'preflightExecute doc run without docWritePayload blocks zero project writes',
    run: () => {
      const root = mkTmp();
      const plan = planWithDocTask();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: plan.tasks.map(t => ({ task_id: t.id, action: 'run' as const })),
      };
      const r = preflightExecute(plan, decision, {
        configWritePayload: validConfigWritePayload(),
      });
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        const arch = r.blocked.entries.find(e => e.task_id === 'write-architecture');
        assert.strictEqual(arch?.status, 'failed');
      }
      assert(!fs.existsSync(path.join(root, '.gitignore')));
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
      assert(!fs.existsSync(path.join(root, 'doc/architecture.md')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflightExecute doc skip passes without docWritePayload',
    run: () => {
      const plan = docOnlyPlan();
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: plan.generated_at,
        tasks: [{ task_id: 'write-architecture', action: 'skip' }],
      };
      const r = preflightExecute(plan, decision);
      assert.strictEqual(r.ok, true);
    },
  },
  {
    name: 'preflightExecute ensure-config run without configWritePayload blocks atomically',
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
      const r = preflightExecute(plan, decision);
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        const cfg = r.blocked.entries.find(e => e.task_id === 'ensure-config');
        assert.strictEqual(cfg?.status, 'failed');
        assert(cfg?.message.includes('configWritePayload 缺失'));
      }
      assert(!fs.existsSync(path.join(root, '.gitignore')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflightExecute illegal architecture blocks ensure-config and zero gitignore write',
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
      const r = preflightExecute(plan, decision, {
        configWritePayload: illegalConfigWritePayload(),
      });
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        const cfg = r.blocked.entries.find(e => e.task_id === 'ensure-config');
        assert.strictEqual(cfg?.status, 'failed');
        assert(cfg?.message.includes('config 校验失败'));
        const gitignore = r.blocked.entries.find(e => e.task_id === 'ensure-gitignore');
        assert.strictEqual(gitignore?.status, 'skipped');
      }
      assert(!fs.existsSync(path.join(root, '.gitignore')));
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
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
    name: 'validateDecisionJson keep dependency satisfies downstream closure',
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
          {
            id: 'materialize-adapter:generic',
            title: 'generic',
            category: 'adapter-bundle',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
          },
        ],
      };
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'manual',
        plan_generated_at: plan.generated_at,
        tasks: [
          { task_id: 'ensure-config', action: 'keep' },
          { task_id: 'materialize-adapter:generic', action: 'run' },
        ],
      };
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, true);
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
  {
    name: 'prepareInitExecutionPlan claude+generic 无 agent_bundle_root 含 materialize-adapter:generic',
    run: () => {
      const root = mkTmp();
      const plan = prepareInitExecutionPlan(
        { projectRoot: root, scope: 'project' },
        {
          materializedAdapters: ['claude', 'generic'],
          configWritePayload: {
            schema_version: '1.1',
            project_name: 'dual-adapter',
            materialized_adapters: ['claude', 'generic'],
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ets',
            },
            paths: { features_dir: 'doc/features' },
          },
        },
      );
      assert(plan.tasks.some(t => t.id === 'materialize-adapter:claude'));
      assert(plan.tasks.some(t => t.id === 'materialize-adapter:generic'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'prepareInitExecutionPlanWithStaleIds claude+generic 与 local active claude 不剔除 generic',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({ schema_version: '1.0', agent_adapter: 'claude' }, null, 2),
      );
      const prepared = prepareInitExecutionPlanWithStaleIds(
        { projectRoot: root, scope: 'project' },
        {
          materializedAdapters: ['claude', 'generic'],
          configWritePayload: {
            schema_version: '1.1',
            project_name: 'dual-adapter',
            materialized_adapters: ['claude', 'generic'],
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ets',
            },
            paths: { features_dir: 'doc/features' },
          },
        },
      );
      assert(prepared.plan.tasks.some(t => t.id === 'materialize-adapter:generic'));
      assert(!prepared.staleMaterializeTaskIds.includes('materialize-adapter:generic'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'buildInitStagingTemplate smart claude+generic 无 root 默认 .agents/bridge 且 preflight 通过',
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
          {
            id: 'materialize-adapter:claude',
            title: 'claude',
            category: 'adapter-bundle',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
          },
          {
            id: 'materialize-adapter:generic',
            title: 'generic',
            category: 'adapter-bundle',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
          },
          {
            id: 'write-architecture',
            title: 'doc/architecture.md',
            category: 'docs',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'drift',
            default_action: 'skip',
            skippable: true,
            allowed_actions: ['run', 'skip'],
          },
        ],
      };
      const context = {
        materializedAdapters: ['claude', 'generic'],
        configWritePayload: {
          schema_version: '1.1',
          project_name: 'smart-update',
          project_profile: { name: 'generic' },
          materialized_adapters: ['claude', 'generic'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        },
      };
      const staging = buildInitStagingTemplate(plan, context);
      const paths = staging.context.configWritePayload?.paths as Record<string, unknown>;
      assert.strictEqual(paths.agent_bundle_root, '.agents');
      assert.strictEqual(paths.agent_bundle_skill_mode, 'bridge');
      assert(staging.decision.tasks.some(t => t.task_id === 'write-architecture' && t.action === 'skip'));
      const r = preflightExecute(plan, staging.decision, staging.context);
      assert.strictEqual(r.ok, true);
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
