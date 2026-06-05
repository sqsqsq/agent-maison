// init-orchestrate.unit.test.ts

import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  assertDecisionStructure,
  buildInitStagingTemplate,
  buildRunLogAuditMeta,
  buildRunSummary,
  deriveBaseContextForPlanning,
  deriveContextForExecution,
  deriveUpdateConfigWritePayload,
  executeInitPlan,
  normalizeDecisionMaterializedAdapters,
  normalizeStagingContext,
  preflightExecute,
  readJsonFile,
  reconcileInitRunDecisionForPlan,
  resolveTaskAction,
  stripContextReservedFields,
  syncDecisionAdaptersIntoContext,
  type InitRunDecision,
  validateDecisionJson,
} from '../../scripts/init-orchestrate';
import type { InitTask } from '../../scripts/utils/init-task-planner';
import type { InitExecutionContext } from '../../scripts/utils/init-task-executor';
import {
  prepareInitExecutionPlan,
  prepareInitExecutionPlanWithStaleIds,
  probeInitTaskPlan,
  type InitTaskPlan,
} from '../../scripts/utils/init-task-planner';

const HARNESS_ROOT = path.join(__dirname, '../..');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'init-orch-'));
}

/** spawn 真实 CLI（读 decision/context 文件），与函数级单测互补 */
function runInitOrchestrateCli(
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const scriptRel = 'scripts/init-orchestrate.ts';
  const localTsNode = path.join(HARNESS_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const cwd = HARNESS_ROOT;
  const r = fs.existsSync(localTsNode)
    ? spawnSync(process.execPath, [localTsNode, scriptRel, ...args], {
        cwd,
        encoding: 'utf-8',
        shell: false,
        timeout: 120_000,
      })
    : spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['ts-node', scriptRel, ...args], {
        cwd,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
        timeout: 120_000,
      });
  return {
    status: r.status,
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
  };
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

function projectDecision(
  plan: InitTaskPlan,
  tasks: InitRunDecision['tasks'],
  materialized_adapters: string[] = ['generic'],
  decision_mode: InitRunDecision['decision_mode'] = 'smart',
): InitRunDecision {
  return {
    schema_version: '1.0',
    scope: 'project',
    decision_mode,
    plan_generated_at: plan.generated_at,
    tasks,
    materialized_adapters,
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['generic'],
        tasks: plan.tasks.map(t => ({ task_id: t.id, action: 'run' as const })),
      };
      const r = preflightExecute(
        plan,
        decision,
        { configWritePayload: illegalConfigWritePayload() },
        buildRunLogAuditMeta({ plan, decision, projectRoot: root }),
      );
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['generic'],
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
    name: 'buildRunSummary includes audit artifact paths and staging status when provided',
    run: () => {
      const s = buildRunSummary(
        {
          schema_version: '1.0',
          scope: 'project',
          started_at: '2026-01-01T00:00:00Z',
          finished_at: '2026-01-01T00:01:00Z',
          decision_mode: 'smart',
          entries: [],
        },
        {
          runLogPath: 'D:/tmp/run-log.json',
          summaryPath: 'D:/tmp/summary.md',
          externalStaging: '未创建（smart-auto 内部生成临时上下文）',
        },
      );
      assert(s.includes('run_log: D:/tmp/run-log.json'));
      assert(s.includes('summary: D:/tmp/summary.md'));
      assert(s.includes('external_staging: 未创建'));
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
      assert.strictEqual(devecoEntry?.reason, 'dependency_blocked');
    },
  },
  {
    name: 'resolveTaskAction smart doc drift without explicit entry resolves skip',
    run: () => {
      const task: InitTask = {
        id: 'write-architecture',
        title: 'arch',
        category: 'docs',
        scope: 'project',
        deps: [],
        status: 'drift',
        default_action: 'skip',
        skippable: true,
        allowed_actions: ['run', 'skip'],
      };
      const decision: InitRunDecision = {
        schema_version: '1.0',
        scope: 'project',
        decision_mode: 'smart',
        plan_generated_at: new Date().toISOString(),
        tasks: [],
      };
      assert.strictEqual(resolveTaskAction(task, decision), 'skip');
    },
  },
  {
    name: 'executeInitPlan satisfied skip has reason satisfied',
    run: () => {
      const plan: InitTaskPlan = {
        schema_version: '1.0',
        scope: 'project',
        mode: 'update',
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'materialize-entry-file',
            title: 'CLAUDE.md',
            category: 'adapter-entry',
            scope: 'project',
            deps: [],
            status: 'satisfied',
            default_action: 'skip',
            skippable: true,
            allowed_actions: ['run', 'skip'],
          },
        ],
      };
      const decision = projectDecision(plan, [{ task_id: 'materialize-entry-file', action: 'skip' }]);
      const log = executeInitPlan({
        projectRoot: mkTmp(),
        harnessRoot: HARNESS_ROOT,
        plan,
        decision,
      });
      const entry = log.entries.find(e => e.task_id === 'materialize-entry-file');
      assert.strictEqual(entry?.status, 'skipped');
      assert.strictEqual(entry?.reason, 'satisfied');
      assert.strictEqual(entry?.message, '已满足，跳过');
      assert.strictEqual(log.mode, 'update');
    },
  },
  {
    name: 'preflightExecute blocked entries have preflight_blocked reason and audit meta',
    run: () => {
      const plan = minimalPlan();
      const decision = projectDecision(plan, [{ task_id: 'totally-unknown', action: 'skip' }]);
      const audit = buildRunLogAuditMeta({
        plan,
        decision,
        projectRoot: '/tmp/proj',
      });
      const r = preflightExecute(plan, decision, undefined, audit);
      assert.strictEqual(r.ok, false);
      if (r.ok) return;
      assert.strictEqual(r.blocked.mode, plan.mode);
      assert.strictEqual(r.blocked.project_root, '/tmp/proj');
      const skipped = r.blocked.entries.filter(e => e.status === 'skipped');
      assert(skipped.length > 0);
      assert(skipped.every(e => e.reason === 'preflight_blocked'));
    },
  },
  {
    name: 'normalizeStagingContext strips schema_version scope and reserved keys',
    run: () => {
      const out = normalizeStagingContext({
        schema_version: '1.0',
        scope: 'project',
        projectRoot: '/bad',
        harnessRoot: '/bad',
        plan: {} as InitTaskPlan,
        materializedAdapters: ['claude'],
        configWritePayload: { project_name: 'x' },
      } as never);
      assert(out);
      assert.strictEqual((out as Record<string, unknown>).schema_version, undefined);
      assert.strictEqual((out as Record<string, unknown>).scope, undefined);
      assert.strictEqual((out as Record<string, unknown>).projectRoot, undefined);
      assert.deepStrictEqual(out.materializedAdapters, ['claude']);
    },
  },
  {
    name: 'buildRunSummary includes audit metadata when present',
    run: () => {
      const s = buildRunSummary({
        schema_version: '1.0',
        scope: 'project',
        mode: 'update',
        project_root: 'D:/proj',
        materialized_adapters: ['claude', 'generic'],
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:01:00Z',
        decision_mode: 'smart',
        entries: [],
      });
      assert(s.includes('mode: update'));
      assert(s.includes('project_root: D:/proj'));
      assert(s.includes('materialized_adapters'));
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
        materialized_adapters: ['generic'],
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
        materialized_adapters: ['cursor'],
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
        materialized_adapters: ['cursor'],
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
        materialized_adapters: ['cursor'],
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
        materialized_adapters: ['cursor'],
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
        materialized_adapters: ['cursor'],
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
        materialized_adapters: ['cursor'],
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
      assert.deepStrictEqual(staging.decision.materialized_adapters, []);
      staging.decision.materialized_adapters = ['claude', 'generic'];
      const paths = staging.context.configWritePayload?.paths as Record<string, unknown>;
      assert.strictEqual(paths.agent_bundle_root, '.agents');
      assert.strictEqual(paths.agent_bundle_skill_mode, 'bridge');
      assert(staging.decision.tasks.some(t => t.task_id === 'write-architecture' && t.action === 'skip'));
      const root = mkTmp();
      const r = preflightExecute(
        plan,
        staging.decision,
        staging.context,
        buildRunLogAuditMeta({ plan, decision: staging.decision, projectRoot: root }),
      );
      assert.strictEqual(r.ok, true);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'buildInitStagingTemplate 待补全 materialized_adapters 为空数组',
    run: () => {
      const plan = minimalPlan();
      const staging = buildInitStagingTemplate(plan);
      assert.deepStrictEqual(staging.decision.materialized_adapters, []);
    },
  },
  {
    name: 'deriveUpdateConfigWritePayload 保留 paths/tools 并 canonicalize cross_module_exports_file',
    run: () => {
      const root = mkTmp();
      const cfg = {
        project_name: 'Wallet',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        materialized_adapters: ['claude', 'generic'],
        architecture: {
          outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'dag' }],
          module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'Index.ets',
        },
        paths: {
          features_dir: 'custom/features',
          module_graphs_dir: 'doc/modules/<module>/code-graph.yaml',
        },
        tools: {
          hylyre: { pypi_extra_index_url: 'https://pypi.internal.corp/simple' },
        },
        state_machine: { schema_version: '1.1', ttl_hours: 12 },
        toolchain: { hvigor: { daemon: true } },
      };
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(cfg, null, 2),
      );
      const payload = deriveUpdateConfigWritePayload(root, ['generic']);
      assert(payload);
      assert.strictEqual(payload!.project_name, 'Wallet');
      assert(payload!.architecture);
      assert.strictEqual(
        (payload!.architecture as { cross_module_exports_file: string }).cross_module_exports_file,
        'index.ets',
      );
      assert.deepStrictEqual(payload!.materialized_adapters, ['generic']);
      assert.strictEqual(
        (payload!.paths as { features_dir: string }).features_dir,
        'custom/features',
      );
      assert.strictEqual(
        (payload!.tools as { hylyre: { pypi_extra_index_url: string } }).hylyre.pypi_extra_index_url,
        'https://pypi.internal.corp/simple',
      );
      assert.strictEqual((payload as Record<string, unknown>).state_machine, undefined);
      assert.strictEqual((payload as Record<string, unknown>).toolchain, undefined);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'deriveUpdateConfigWritePayload 自定义 cross_module_exports_file 不被重置',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            project_name: 'Wallet',
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'dag' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'exports.ets',
            },
          },
          null,
          2,
        ),
      );
      const payload = deriveUpdateConfigWritePayload(root, []);
      assert.strictEqual(
        (payload!.architecture as { cross_module_exports_file: string }).cross_module_exports_file,
        'exports.ets',
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'deriveUpdateConfigWritePayload emit 路径不含磁盘 materialized_adapters',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            project_name: 'Wallet',
            materialized_adapters: ['claude', 'generic'],
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'dag' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'Index.ets',
            },
          },
          null,
          2,
        ),
      );
      const payload = deriveUpdateConfigWritePayload(root, []);
      assert(payload);
      assert.strictEqual(
        (payload as Record<string, unknown>).materialized_adapters,
        undefined,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'buildInitStagingTemplate UPDATE 预填 configWritePayload',
    run: () => {
      const root = mkTmp();
      const cfg = {
        project_name: 'Wallet',
        project_profile: { name: 'hmos-app' },
        materialized_adapters: ['claude'],
        architecture: {
          outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'dag' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'Index.ets',
        },
      };
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(cfg, null, 2),
      );
      const plan: InitTaskPlan = {
        ...minimalPlan(),
        mode: 'update',
      };
      const staging = buildInitStagingTemplate(plan, undefined, 'smart', root);
      assert(staging.context.configWritePayload);
      assert.strictEqual(
        (staging.context.configWritePayload as Record<string, unknown>).project_name,
        'Wallet',
      );
      assert.strictEqual(
        (staging.context.configWritePayload as Record<string, unknown>).materialized_adapters,
        undefined,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'deriveContextForExecution UPDATE 缺 payload 从磁盘补全',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            project_name: 'P',
            architecture: {
              outer_layers: [{ id: 'L', can_depend_on: [], intra_layer_deps: 'dag' }],
              module_inner_layers: ['a'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'i.ets',
            },
          },
          null,
          2,
        ),
      );
      const plan: InitTaskPlan = { ...minimalPlan(), mode: 'update' };
      const base = { materializedAdapters: ['claude'] };
      const final = deriveContextForExecution(base, plan, root, ['claude']);
      assert(final.configWritePayload);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'preflightExecute project 缺 materialized_adapters 产出 blocked run-log',
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
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert(
          r.blocked.entries.some(
            e =>
              e.status === 'failed' &&
              e.message.includes('materialized_adapters'),
          ),
        );
      }
    },
  },
  {
    name: 'preflightExecute project decision 与 context adapter 不一致阻断',
    run: () => {
      const plan = docOnlyPlan();
      const decision = projectDecision(
        plan,
        [{ task_id: 'write-architecture', action: 'skip' }],
        ['claude'],
      );
      const r = preflightExecute(plan, decision, { materializedAdapters: ['cursor'] });
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert(r.blocked.entries.some(e => e.message.includes('不一致')));
      }
    },
  },
  {
    name: 'validateDecisionJson satisfied 依赖显式 skip 不违反闭包',
    run: () => {
      const plan: InitTaskPlan = {
        schema_version: '1.0',
        scope: 'project',
        mode: 'update',
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'harness-install',
            title: 'npm',
            category: 'mechanism',
            scope: 'project',
            deps: [],
            status: 'satisfied',
            default_action: 'run',
            skippable: true,
            allowed_actions: ['run', 'skip'],
          },
          {
            id: 'run-global-phases',
            title: 'phases',
            category: 'mechanism',
            scope: 'project',
            deps: ['harness-install'],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
          },
        ],
      };
      const decision = projectDecision(
        plan,
        [
          { task_id: 'harness-install', action: 'skip' },
          { task_id: 'run-global-phases', action: 'run' },
        ],
        ['generic'],
      );
      const r = validateDecisionJson(plan, decision);
      assert.strictEqual(r.ok, true);
    },
  },
  {
    name: 'stripContextReservedFields 移除 root 字段',
    run: () => {
      const stripped = stripContextReservedFields(
        JSON.parse(
          JSON.stringify({
            projectRoot: '/evil',
            harnessRoot: '/evil-h',
            plan: {},
            materializedAdapters: ['claude'],
          }),
        ),
      );
      assert(stripped);
      assert.strictEqual((stripped as Record<string, unknown>).projectRoot, undefined);
      assert.strictEqual((stripped as Record<string, unknown>).harnessRoot, undefined);
      assert.strictEqual((stripped as Record<string, unknown>).plan, undefined);
      assert.deepStrictEqual(stripped!.materializedAdapters, ['claude']);
    },
  },
  {
    name: 'executeInitPlan context projectRoot 不覆盖 CLI root',
    run: () => {
      const root = mkTmp();
      const plan = minimalPlan();
      const decision = projectDecision(
        plan,
        plan.tasks.map(t => ({
          task_id: t.id,
          action: (t.skippable ? 'skip' : 'run') as 'skip' | 'run',
        })),
        ['generic'],
      );
      const log = executeInitPlan({
        projectRoot: root,
        harnessRoot: path.join(__dirname, '../..'),
        plan,
        decision,
        executionContext: JSON.parse(
          JSON.stringify({
            projectRoot: path.join(root, 'WRONG'),
            materializedAdapters: ['generic'],
          }),
        ),
      });
      assert(log.entries.some(e => e.task_id === 'ensure-gitignore' && e.status === 'executed'));
      assert(fs.existsSync(path.join(root, '.gitignore')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'CLI 等价：preflight 须在 sync 前用原始 context 阻断 adapter 冲突',
    run: () => {
      const plan = docOnlyPlan();
      const decision = projectDecision(
        plan,
        [{ task_id: 'write-architecture', action: 'skip' }],
        ['claude'],
      );
      const stripped = { materializedAdapters: ['cursor'] };
      const synced = syncDecisionAdaptersIntoContext(decision, {
        materializedAdapters: ['cursor'],
      });
      assert.strictEqual(preflightExecute(plan, decision, synced).ok, true);
      const r = preflightExecute(plan, decision, stripped);
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert(r.blocked.entries.some(e => e.message.includes('不一致')));
      }
    },
  },
  {
    name: 'syncDecisionAdaptersIntoContext 以 decision 为准覆盖 context',
    run: () => {
      const plan = minimalPlan();
      const decision = projectDecision(plan, [], ['cursor']);
      const synced = syncDecisionAdaptersIntoContext(decision, {
        materializedAdapters: ['claude'],
        configWritePayload: { materialized_adapters: ['claude'] },
      });
      assert.deepStrictEqual(synced.materializedAdapters, ['cursor']);
      assert.deepStrictEqual(
        (synced.configWritePayload as { materialized_adapters?: string[] })?.materialized_adapters,
        ['cursor'],
      );
    },
  },
  {
    name: 'CLI --emit-staging-template 缺 context 文件可输出待补全模板',
    run: () => {
      const root = mkTmp();
      const missingCtx = path.join(root, 'no-context-yet.json');
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--emit-staging-template',
        '--context-file',
        missingCtx,
      ]);
      assert.strictEqual(r.status, 0, r.stderr || r.stdout);
      const parsed = JSON.parse(r.stdout) as {
        decision: { materialized_adapters: string[] };
      };
      assert.deepStrictEqual(parsed.decision.materialized_adapters, []);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'CLI --execute 读 decision/context 文件 adapter 冲突 exit 1 且零写盘',
    run: () => {
      const root = mkTmp();
      const staging = path.join(root, 'staging');
      fs.mkdirSync(staging, { recursive: true });
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project' });
      const decisionPath = path.join(staging, 'decision.json');
      const contextPath = path.join(staging, 'context.json');
      fs.writeFileSync(
        decisionPath,
        JSON.stringify(
          {
            schema_version: '1.0',
            scope: 'project',
            decision_mode: 'smart',
            plan_generated_at: plan.generated_at,
            materialized_adapters: ['claude'],
            tasks: plan.tasks
              .filter(t => t.id === 'write-architecture' || t.skippable)
              .slice(0, 3)
              .map(t => ({ task_id: t.id, action: 'skip' as const })),
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        contextPath,
        JSON.stringify({ materializedAdapters: ['cursor'] }, null, 2),
      );
      const gitignore = path.join(root, '.gitignore');
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--execute',
        '--decision-file',
        decisionPath,
        '--context-file',
        contextPath,
      ]);
      assert.notStrictEqual(r.status, 0);
      assert(r.stdout.includes('不一致') || r.stderr.includes('不一致'));
      assert(!fs.existsSync(gitignore));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'CLI --emit-staging-template --materialized-adapters 含 2 项 materialize-adapter 任务',
    run: () => {
      const root = mkTmp();
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--emit-staging-template',
        '--materialized-adapters',
        'claude,generic',
      ]);
      assert.strictEqual(r.status, 0, r.stderr || r.stdout);
      const parsed = JSON.parse(r.stdout) as {
        decision: { materialized_adapters: string[]; tasks: Array<{ task_id: string }> };
      };
      assert.deepStrictEqual(parsed.decision.materialized_adapters, ['claude', 'generic']);
      const materializeTasks = parsed.decision.tasks.filter(t =>
        t.task_id.startsWith('materialize-adapter:'),
      );
      assert.strictEqual(materializeTasks.length, 2);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'CLI emit context 与 --materialized-adapters 不一致 exit 1',
    run: () => {
      const root = mkTmp();
      const contextPath = path.join(root, 'context.json');
      fs.writeFileSync(
        contextPath,
        JSON.stringify({ materializedAdapters: ['cursor'] }, null, 2),
      );
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--emit-staging-template',
        '--context-file',
        contextPath,
        '--materialized-adapters',
        'claude,generic',
      ]);
      assert.notStrictEqual(r.status, 0);
      assert(r.stderr.includes('不一致') || r.stdout.includes('不一致'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'CLI emit context 与 --materialized-adapters 一致时 CLI 为 SSOT',
    run: () => {
      const root = mkTmp();
      const contextPath = path.join(root, 'context.json');
      fs.writeFileSync(
        contextPath,
        JSON.stringify({ materializedAdapters: ['claude', 'generic'] }, null, 2),
      );
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--emit-staging-template',
        '--context-file',
        contextPath,
        '--materialized-adapters',
        'claude,generic',
      ]);
      assert.strictEqual(r.status, 0, r.stderr || r.stdout);
      const parsed = JSON.parse(r.stdout) as {
        decision: { materialized_adapters: string[]; tasks: Array<{ task_id: string }> };
      };
      assert.deepStrictEqual(parsed.decision.materialized_adapters, ['claude', 'generic']);
      assert.strictEqual(
        parsed.decision.tasks.filter(t => t.task_id.startsWith('materialize-adapter:')).length,
        2,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'CLI --execute --materialized-adapters 无 --smart-auto 自动改道进入执行路径',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'auto-smart-test',
            project_profile: { name: 'hmos-app', sub_variant: 'app' },
            materialized_adapters: ['claude', 'generic'],
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ets',
            },
          },
          null,
          2,
        ),
      );
      fs.mkdirSync(path.join(root, 'doc', 'features'), { recursive: true });
      fs.writeFileSync(path.join(root, 'doc', 'architecture.md'), '# Arch\n');
      fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), 'modules: []\n');
      fs.writeFileSync(path.join(root, 'doc', 'glossary.yaml'), 'terms: []\n');
      fs.writeFileSync(path.join(root, 'doc', 'glossary-seed.txt'), 'seed\n');
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--execute',
        '--materialized-adapters',
        'claude,generic',
      ]);
      assert.notStrictEqual(r.status, null, r.stderr || r.stdout);
      assert(
        r.stderr.includes('自动启用 smart-auto'),
        '应输出自动改道 advisory',
      );
      assert(
        !r.stderr.includes('须配合 --decision-file 或 --smart-auto'),
        '不应输出参数校验拒绝',
      );
      assert(
        r.stdout.includes('executed') || r.stdout.includes('skipped'),
        '应产出执行摘要（自动改道后实际进入 execute 路径）',
      );
      assert(r.stdout.includes('run_log:'), 'stdout 摘要应包含 run_log 路径');
      assert(r.stdout.includes('summary:'), 'stdout 摘要应包含 summary 路径');
      assert(
        r.stdout.includes('external_staging: 未创建'),
        'smart-auto 摘要应说明未创建外部 staging',
      );
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'CLI --execute --materialized-adapters + --context-file 无 --smart-auto 仍报错 exit 1',
    run: () => {
      const root = mkTmp();
      const staging = path.join(root, 'staging');
      fs.mkdirSync(staging, { recursive: true });
      const contextPath = path.join(staging, 'context.json');
      fs.writeFileSync(contextPath, JSON.stringify({}, null, 2));
      const r = runInitOrchestrateCli([
        '--scope',
        'project',
        '--project-root',
        root,
        '--execute',
        '--materialized-adapters',
        'claude,generic',
        '--context-file',
        contextPath,
      ]);
      assert.notStrictEqual(r.status, 0, 'should exit 1 when --context-file present without --smart-auto');
      assert(
        r.stderr.includes('须配合 --decision-file 或 --smart-auto'),
        '应输出标准报错提示',
      );
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
