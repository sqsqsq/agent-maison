// init-task-executor.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import type { InitTaskPlan } from '../../scripts/utils/init-task-planner';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';

function minimalArchitecture(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'init-exec-'));
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

function legalCursorConfigWritePayload(): Record<string, unknown> {
  return {
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
}

const ensureConfigTask = {
  id: 'ensure-config',
  title: 'config',
  category: 'config',
  scope: 'project' as const,
  deps: [],
  status: 'needed' as const,
  default_action: 'run' as const,
  skippable: false,
  allowed_actions: ['run' as const],
};

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'executeInitTask ensure-gitignore creates .gitignore',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] },
      };
      const task = {
        id: 'ensure-gitignore',
        title: 'gitignore',
        category: 'mechanism',
        scope: 'project' as const,
        deps: [],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: false,
        allowed_actions: ['run' as const],
      };
      const msg = executeInitTask(task, 'run', ctx);
      assert(fs.existsSync(path.join(root, '.gitignore')), msg);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitTask record-adapter writes local',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['claude', 'cursor'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: path.join(layout.frameworkRoot, 'harness'),
        plan: { schema_version: '1.0', scope: 'personal', mode: 'update', generated_at: '', tasks: [] },
        activeAdapter: 'cursor',
        materializedAdapters: ['claude', 'cursor'],
      };
      const task = {
        id: 'record-adapter',
        title: 'adapter',
        category: 'personal',
        scope: 'personal' as const,
        deps: [],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: false,
        allowed_actions: ['run' as const],
      };
      executeInitTask(task, 'run', ctx);
      const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
      assert.strictEqual(local.agent_adapter, 'cursor');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitTask ensure-config 无 configWritePayload 抛错',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] },
      };
      const task = ensureConfigTask;
      assert.throws(
        () => executeInitTask(task, 'run', ctx),
        /configWritePayload 缺失/,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitTask ensure-config 非法 architecture 不写盘',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] },
        configWritePayload: illegalConfigWritePayload(),
      };
      const task = ensureConfigTask;
      assert.throws(
        () => executeInitTask(task, 'run', ctx),
        /config 校验失败/,
      );
      assert(!fs.existsSync(path.join(root, 'framework.config.json')));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitTask ensure-config 合法 payload 不写 agent_adapter',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] },
        configWritePayload: legalCursorConfigWritePayload(),
      };
      executeInitTask(ensureConfigTask, 'run', ctx);
      const written = JSON.parse(
        fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'),
      ) as Record<string, unknown>;
      assert.strictEqual(written.agent_adapter, undefined);
      assert.strictEqual(written.project_type, undefined);
      assert.strictEqual(written.schema_version, '1.1');
      assert.deepStrictEqual(written.materialized_adapters, ['cursor']);
      assert.strictEqual(written.tools, undefined);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitTask write-architecture 无 docWritePayload 抛错',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] },
      };
      const task = {
        id: 'write-architecture',
        title: 'arch',
        category: 'docs',
        scope: 'project' as const,
        deps: [],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const, 'skip' as const],
        target_path: 'doc/architecture.md',
      };
      assert.throws(
        () => executeInitTask(task, 'run', ctx),
        /docWritePayload\.architecture_md 缺失/,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'executeInitTask materialize-adapter:generic 无 agent_bundle_root 且 local active claude 物化 .agents/bridge',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'dual-materialized',
            materialized_adapters: ['claude', 'generic'],
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

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['claude', 'generic'],
      };
      const task = {
        id: 'materialize-adapter:generic',
        title: '物化 adapter: generic',
        category: 'adapter-bundle',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: false,
        allowed_actions: ['run' as const],
        params: { adapter: 'generic' },
      };
      const msg = executeInitTask(task, 'run', ctx);
      const skillPath = path.join(root, '.agents', 'skills', '00-framework-init', 'SKILL.md');
      assert(fs.existsSync(skillPath), `${msg}; expected ${skillPath}`);
      assert(fs.readFileSync(skillPath, 'utf-8').includes('完整流程见 framework/skills/00-framework-init/SKILL.md'));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask materialize-adapter:claude 用 projectRoot 渲染扩展 Skill 段',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const skillSlug = 'wallet-sdk-onboarding';
      fs.mkdirSync(path.join(root, 'doc', 'extensions', 'skills', skillSlug), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'doc', 'extensions', 'skills', skillSlug, 'SKILL.md'),
        '# Demo extension skill\n',
      );
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'ext-skill-test',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features', extension_dir: 'doc/extensions' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['claude'],
      };
      const task = {
        id: 'materialize-adapter:claude',
        title: '物化 adapter: claude',
        category: 'adapter-bundle',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: false,
        allowed_actions: ['run' as const],
        params: { adapter: 'claude' },
      };
      const msg = executeInitTask(task, 'run', ctx);
      const claudePath = path.join(root, 'CLAUDE.md');
      assert(fs.existsSync(claudePath), `${msg}; expected ${claudePath}`);
      const body = fs.readFileSync(claudePath, 'utf-8');
      assert(!body.includes('{{EXTENSION_SKILL_SECTION}}'), 'placeholder must be replaced');
      assert(body.includes('实例扩展 Skill'), 'extension section must be rendered from projectRoot');
      assert(body.includes(skillSlug), `expected extension skill slug in CLAUDE.md`);
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
