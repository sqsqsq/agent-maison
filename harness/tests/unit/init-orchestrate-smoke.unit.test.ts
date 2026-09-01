// init-orchestrate-smoke.unit.test.ts — 编排化 init 消费者 smoke（只读探测 + legacy 外迁）

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import YAML from 'yaml';

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
    name: 't7 S1 探测：probeInitTaskPlan 输出携带 framework_identity（runInitProbe 同源），四字段形状合法',
    run: () => {
      const root = mkTmp();
      try {
        const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'generic' });
        assert(plan.framework_identity, 'S1 plan 必须携带 framework_identity');
        const id = plan.framework_identity!;
        assert(['valid', 'corrupt', 'absent'].includes(id.state), `state 须在枚举内，实际=${id.state}`);
        assert(typeof id.version === 'string' && id.version.length > 0);
        assert(typeof id.source_commit === 'string' && id.source_commit.length > 0);
        assert(typeof id.manifest_sha256 === 'string' && id.manifest_sha256.length > 0);
        assert(typeof id.built_at === 'string' && id.built_at.length > 0);
        assert(typeof id.error === 'string' || id.error === null, 'error 须为 string|null');
        if (id.state === 'absent') {
          assert.strictEqual(id.version, 'unknown', 'source/dev 布局如实显示 unknown');
        }
        const probe = runInitProbe({ projectRoot: root, adapterHint: 'generic' });
        assert.strictEqual(probe.framework_identity.state, id.state, 'plan 与 runInitProbe 须同一装载器读数');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'probeInitTaskPlan project scope 不读写宿主 .gitignore / 不创建 local',
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
    name: 'legacy config UPDATE：migrate-config 外迁 personal 字段（t1 无损：probe/hvigorBin/vision/device 交叉保真）',
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
      // 既有 local：toolchain.probe + hvigorBin + vision + device —— migrate-config 不得抹掉
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify(
          {
            schema_version: '1.0',
            agent_adapter: 'cursor',
            toolchain: {
              devEcoStudio: { installPath: 'C:/old', hvigorBin: 'C:/hvigor/bin' },
              probe: { project_compile: { status: 'verified', observed_at: '2026-08-01T00:00:00.000Z' } },
            },
            vision: { image_input_override: 'native_attach' },
            device: { unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' }, target_serial: 'PHONE-1' },
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
      // t1 交叉保真：migrate-config 只合并 agent_adapter + toolchain.devEcoStudio，其余不得丢
      assert.strictEqual(local.toolchain?.devEcoStudio?.hvigorBin, 'C:/hvigor/bin', '既有 hvigorBin 应保留');
      assert.strictEqual(local.toolchain?.probe?.project_compile?.status, 'verified', 'toolchain.probe 应保留');
      assert.strictEqual(local.vision?.image_input_override, 'native_attach', 'vision 应保留');
      assert.strictEqual(local.device?.unlock?.credential_ref, 'maison/device/PHONE-1/v3', 'device.unlock.credential_ref 应保留');
      assert.strictEqual(local.device?.target_serial, 'PHONE-1', 'target_serial 应保留');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'InitTaskPlan 含 materialize-adapter，且不含任何宿主 .gitignore 机制任务',
    run: () => {
      const root = mkTmp();
      const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project', adapter: 'claude' });
      assert(plan.tasks.some(t => t.id.startsWith('materialize-adapter:')));
      // plan 33714d0c：ensure-gitignore 已整体退场，且不得留下改名/永久 SKIP 空壳
      assert(!plan.tasks.some(t => t.id === 'ensure-gitignore'), 'ensure-gitignore 不得回归');
      assert(
        !plan.tasks.some(t => /gitignore/i.test(t.id) || /gitignore/i.test(t.title)),
        '任务表不得出现任何宿主忽略配置机制任务（含改名继任者）',
      );
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
    // plan 33714d0c 复审 P1-4：实现改 10 项后，**机器规则 SSOT** 必须同步——
    // 否则 check-init 产 10 行、init-rules.yaml 仍要求 11 个逻辑索引，规则与实现矛盾，
    // 而只验"probe 没有 #11"的用例照样全绿（正是本条要堵的漏）。
    name: 'init-rules.yaml 机器规则与实现同为 10 项（读真实 SSOT，不硬编码期望）',
    run: () => {
      const rulesPath = path.resolve(__dirname, '../../../specs/phase-rules/init-rules.yaml');
      const rules = YAML.parse(fs.readFileSync(rulesPath, 'utf8')) as {
        applies_to?: string;
        structure_checks?: {
          inspection_table_complete?: {
            description?: string;
            rule?: { required_logical_items?: number; inspection_shape?: { singleton_indices?: number[] } };
          };
        };
      };
      const rule = rules.structure_checks?.inspection_table_complete?.rule;
      assert.strictEqual(rule?.required_logical_items, 10, 'required_logical_items 必须与实现同为 10');
      assert.deepStrictEqual(
        rule?.inspection_shape?.singleton_indices,
        [1, 2, 4, 5, 6, 7, 8, 9, 10],
        'singleton_indices 必须为 1,2,4–10（第 11 项已删除，且不得留改名继任者）',
      );
      assert(
        !/11/.test(String(rules.applies_to ?? '')),
        `applies_to 不得再声称 11 项：${rules.applies_to}`,
      );
      assert(
        !/#11/.test(String(rules.structure_checks?.inspection_table_complete?.description ?? '')),
        'inspection_table_complete 描述不得再点名 #11',
      );

      // 规则 SSOT ↔ 真实 probe 行数：逻辑索引集合必须逐一对上
      const root = mkTmp();
      const probe = runInitProbe({ projectRoot: root, adapterHint: 'claude' });
      const logical = [...new Set(probe.inspections.map(i => i.index))].sort((a, b) => a - b);
      assert.deepStrictEqual(
        logical,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        `probe 逻辑索引集合须为 1–10，实得 ${logical.join(',')}`,
      );
      assert.strictEqual(logical.length, rule!.required_logical_items, '规则数量与 probe 实际逻辑索引数须一致');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'runInitProbe 体检表不含宿主 .gitignore 项（inspection #11 已删除，无空壳继任者）',
    run: () => {
      const root = mkTmp();
      const probe = runInitProbe({ projectRoot: root, adapterHint: 'claude' });
      assert(
        !probe.inspections.some(i => i.index === 11),
        '第 11 项（宿主 .gitignore）必须整体删除，不得保留永久 SKIP/PASS 空壳',
      );
      assert(
        !probe.inspections.some(i => /gitignore/i.test(i.target_path)),
        '体检表不得再以任何索引承载宿主忽略配置',
      );
      // 探测本身也不得创建它
      assert(!fs.existsSync(path.join(root, '.gitignore')), 'probe 不得创建宿主 .gitignore');
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
