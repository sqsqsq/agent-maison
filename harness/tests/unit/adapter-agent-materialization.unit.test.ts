import { beginUnitCase, discoveryResult } from '../utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';
import type { UnitCaseResult } from '../run-unit';

const layout = detectRepoLayout(path.join(__dirname, '..', '..'));
const authorTemplate = path.join(layout.frameworkRoot, 'agents/claude/templates/agents/phase-executor.md');
const oldContent = Buffer.from('旧模板\r\n不丢原字节\r\n', 'utf8');
const retiredPaths = ['.claude/agents/verifier.md', '.cac/agents/verifier.md', '.codex/agents/verifier.toml'];

const task = (id: string) => ({
  id, title: id, category: 'adapter-bundle',
  scope: 'project' as const, deps: ['ensure-config'],
  status: 'needed' as const, default_action: 'run' as const, skippable: false, allowed_actions: ['run' as const],
});

function withProject(adapters: string[], run: (ctx: InitExecutionContext) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-agent-'));
  try {
    const config = {
      schema_version: '1.1', project_name: 'adapter-agents', materialized_adapters: adapters,
      architecture: {
        outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
        module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
        cross_module_exports_file: 'index.ets',
      },
      paths: { features_dir: 'doc/features' },
    };
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(config));
    clearFrameworkConfigCache();
    run({
      projectRoot: root, harnessRoot: harnessRootFromLayout(layout),
      plan: { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [] },
      materializedAdapters: adapters,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

function seed(root: string, rel: string, bytes: Buffer): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function backupStamps(root: string): string[] {
  const dir = path.join(root, '.framework-backup');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

const cases = [
  {
    name: '初次物化保留 Claude/CodeAgent 作者模板，三个 adapter 均不写退役角色',
    run: () => withProject(['claude', 'codeagent', 'codex'], ctx => {
      for (const [adapter, target] of [
        ['claude', '.claude/agents/phase-executor.md'],
        ['codeagent', '.cac/agents/phase-executor.md'],
      ]) {
        const entry = checkInitTesting.loadAdapter(adapter!).templateFiles.find(file => file.targetRel === target);
        assert(entry && entry.kind === 'verbatim' && entry.update_policy === 'auto_overwrite');
        assert(entry.origin.startsWith('commands.subagents.template_dir/'));
      }
      for (const adapter of ctx.materializedAdapters!) {
        executeInitTask(task(`materialize-adapter:${adapter}`), 'run', ctx);
      }
      for (const target of ['.claude/agents/phase-executor.md', '.cac/agents/phase-executor.md']) {
        assert.deepStrictEqual(fs.readFileSync(path.join(ctx.projectRoot, target)), fs.readFileSync(authorTemplate));
      }
      assert(retiredPaths.every(rel => !fs.existsSync(path.join(ctx.projectRoot, rel))));
      assert.deepStrictEqual(backupStamps(ctx.projectRoot), []);
    }),
  },
  {
    name: '主位逐文件更新与次位整包更新都先备份作者模板，重复执行幂等',
    run: () => withProject(['claude', 'codeagent'], ctx => {
      const { projectRoot: root } = ctx;
      const primary = '.claude/agents/phase-executor.md';
      const secondary = '.cac/agents/phase-executor.md';
      const planned = probeInitTaskPlan({ projectRoot: root, scope: 'project' }).tasks;
      const sync = planned.find(row => row.id === `sync-auto-overwrite:${primary}`);
      assert(sync && sync.params?.update_policy === 'auto_overwrite');
      assert(!planned.some(row => row.id === `materialize-adapter-file:${primary}`));
      assert(!planned.some(row => row.id === `sync-auto-overwrite:${secondary}`));

      for (const [target, update] of [[primary, sync], [secondary, task('materialize-adapter:codeagent')]] as const) {
        seed(root, target, oldContent);
        const result = executeInitTask(update, 'run', ctx);
        assert.strictEqual(result.file_results?.find(row => row.targetRel === target)?.effect, 'updated');
        assert.deepStrictEqual(fs.readFileSync(path.join(root, target)), fs.readFileSync(authorTemplate));
        const stamps = backupStamps(root);
        const backups = stamps.map(stamp => path.join(root, '.framework-backup', stamp, target)).filter(file => fs.existsSync(file));
        assert.strictEqual(backups.length, 1);
        assert.deepStrictEqual(fs.readFileSync(backups[0]!), oldContent);
        const again = executeInitTask(update, 'run', ctx);
        assert.strictEqual(again.file_results?.find(row => row.targetRel === target)?.effect, 'unchanged');
        assert.deepStrictEqual(backupStamps(root), stamps);
      }
    }),
  },
  {
    name: '授权 UPDATE 只删除三个退役角色并保留原字节，其他角色和用户文件保持完整',
    run: () => withProject(['claude', 'codeagent', 'codex'], ctx => {
      const { projectRoot: root } = ctx;
      const kept = [
        '.claude/agents/phase-executor.md', '.cac/agents/phase-executor.md', '.codex/agents/custom.toml',
      ];
      for (const rel of [...retiredPaths, ...kept]) seed(root, rel, oldContent);
      const cleanup = task('cleanup-deprecated');
      const result = executeInitTask(cleanup, 'run', ctx);
      assert.strictEqual(result.cleanup_effects?.backup_deleted, retiredPaths.length);
      const stamps = backupStamps(root);
      assert.strictEqual(stamps.length, 1);
      for (const rel of retiredPaths) {
        assert(!fs.existsSync(path.join(root, rel)), rel);
        const row = result.cleanup_results?.find(item => item.path === rel);
        assert(row?.backup_path, `遗失原字节备份 ${rel}`);
        assert.deepStrictEqual(fs.readFileSync(path.join(root, row.backup_path)), oldContent);
      }
      for (const rel of kept) assert.deepStrictEqual(fs.readFileSync(path.join(root, rel)), oldContent);
      assert.strictEqual(executeInitTask(cleanup, 'run', ctx).cleanup_results, undefined);
      assert.deepStrictEqual(backupStamps(root), stamps);
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(({ name, run }) => {
    const endUnitCase = beginUnitCase(name);
    if (!endUnitCase) return discoveryResult(name);
    try {
      run();
      return { name, ok: true };
    } catch (err) {
      return { name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    } finally { endUnitCase(); }
  });
}
