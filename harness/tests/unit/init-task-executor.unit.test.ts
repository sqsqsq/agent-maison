// init-task-executor.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { __testing_setDetectScanForEnsure } from '../../scripts/utils/personal-setup-gate';
import type { InitTaskPlan } from '../../scripts/utils/init-task-planner';
import type { CleanupResult } from '../../scripts/utils/init-sync-telemetry';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { listAvailableAdapters } from '../../scripts/utils/adapter-catalog';
import { executeInitPlan } from '../../scripts/init-orchestrate';

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
    name: 'cleanup 工程内未识别引用：保留该脚本记 blocked，其余 adapter/旧跳板继续，任务不 failed 且后继任务照常执行',
    run: () => {
      const root = mkTmp();
      const write = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      };
      try {
        write('framework.config.json', JSON.stringify(legalCursorConfigWritePayload()));
        write('.claude/hooks/record-verifier-report.mjs', 'claude-old');
        write('.claude/commands/goal-orchestration.md', 'old bridge');
        write('.codex/hooks/check-phase-completion.mjs', 'codex-stop');
        write('.codex/hooks/record-verifier-report.mjs', 'codex-report');
        const source = JSON.stringify({ hooks: { Stop: [{ command: 'node "$VAR"/.codex/hooks/check-phase-completion.mjs --flag' }] } });
        write('.codex/hooks.json', source);
        write('.cac/hooks/record-verifier-report.mjs', 'ca-old');
        write('.opencode/skill/prd-design/SKILL.md', 'old');
        clearFrameworkConfigCache();
        const plan: InitTaskPlan = { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [
          { ...ensureConfigTask, id: 'cleanup-deprecated' },
          { ...ensureConfigTask, id: 'dependent', deps: ['cleanup-deprecated'] },
        ] };
        const options = { projectRoot: root, harnessRoot: path.resolve(__dirname, '../..'), plan,
          decision: { schema_version: '1.0' as const, scope: 'project' as const, decision_mode: 'smart' as const,
            materialized_adapters: ['cursor'],
            plan_generated_at: '', tasks: plan.tasks.map(t => ({ task_id: t.id, action: 'run' as const })) } };
        const log = executeInitPlan(options);
        const cleanup = log.entries[0]!;
        assert.strictEqual(cleanup.status, 'executed');
        assert.strictEqual(log.entries[1]!.status, 'executed');
        assert.notStrictEqual(log.entries[1]!.reason, 'dependency_blocked');
        assert.strictEqual(cleanup.cleanup_effects?.blocked, 1);
        assert(!cleanup.cleanup_effects?.failed, 'blocked 不得升级成 failed');
        assert(cleanup.cleanup_results?.some(r => r.path === '.codex/hooks/check-phase-completion.mjs' && r.status === 'blocked'));
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf-8'), source);
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'utf-8'), 'codex-stop');
        for (const rel of ['.claude/hooks/record-verifier-report.mjs', '.claude/commands/goal-orchestration.md',
          '.cac/hooks', '.codex/hooks/record-verifier-report.mjs', '.opencode/skill/prd-design']) {
          assert(!fs.existsSync(path.join(root, rel)), `未继续清理 ${rel}`);
        }
        assert(cleanup.cleanup_results?.some(r => r.adapter === 'codeagent' && r.backup_path));
        write('.codex/hooks.json', '{}');
        const retried = executeInitTask(plan.tasks[0]!, 'run', { projectRoot: root, harnessRoot: options.harnessRoot, plan });
        assert.strictEqual(retried.failed, false);
        assert(!fs.existsSync(path.join(root, '.codex/hooks')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'cleanup 异常路径：settings.json 非法 JSON → 任务 failed、脚本保留、后继任务 dependency_blocked',
    run: () => {
      const root = mkTmp();
      const write = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      };
      try {
        write('framework.config.json', JSON.stringify(legalCursorConfigWritePayload()));
        write('.claude/settings.json', 'invalid-json');
        write('.claude/hooks/record-verifier-report.mjs', 'claude-old');
        write('.cac/hooks/record-verifier-report.mjs', 'ca-old');
        clearFrameworkConfigCache();
        const plan: InitTaskPlan = { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [
          { ...ensureConfigTask, id: 'cleanup-deprecated' },
          { ...ensureConfigTask, id: 'dependent', deps: ['cleanup-deprecated'] },
        ] };
        const log = executeInitPlan({ projectRoot: root, harnessRoot: path.resolve(__dirname, '../..'), plan,
          decision: { schema_version: '1.0' as const, scope: 'project' as const, decision_mode: 'smart' as const,
            materialized_adapters: ['cursor'],
            plan_generated_at: '', tasks: plan.tasks.map(t => ({ task_id: t.id, action: 'run' as const })) } });
        const cleanup = log.entries[0]!;
        assert.strictEqual(cleanup.status, 'failed');
        assert.strictEqual(cleanup.cleanup_effects?.failed, 1);
        assert.strictEqual(log.entries[1]!.reason, 'dependency_blocked');
        assert(cleanup.cleanup_results?.some(r => r.adapter === 'claude' && r.status === 'failed' && r.message?.includes('settings.json')));
        assert.strictEqual(fs.readFileSync(path.join(root, '.claude/hooks/record-verifier-report.mjs'), 'utf-8'), 'claude-old');
        assert(!fs.existsSync(path.join(root, '.cac/hooks')), '其他 adapter 应继续清理');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    // 缺陷 1：Claude Code / codeagent 都会读 settings.local.json 的 hooks；框架从不写该文件，
    // 但宿主可能手工注册——只声明 settings.json 会删脚本却留下悬空注册。
    // 走 executeInitTask（生产接线），不直接调 applyDeprecatedArtifactsCleanup。
    name: 'cleanup：settings.json 与 settings.local.json（含 .cac/）同时注册时逐份移除并备份',
    run: () => {
      const root = mkTmp();
      const write = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      };
      const registration = (dir: string) => `${JSON.stringify({ hooks: { SubagentStop: [{ matcher: '*', hooks: [
        { type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/${dir}/hooks/record-verifier-report.mjs"` },
        { type: 'command', command: 'node host-hook.mjs' },
      ] }] } }, null, 2)}\n`;
      const configs = new Map<string, string>([
        ['.claude/settings.json', registration('.claude')],
        ['.claude/settings.local.json', registration('.claude')],
        ['.cac/settings.local.json', registration('.cac')],
      ]);
      try {
        write('framework.config.json', JSON.stringify(legalCursorConfigWritePayload()));
        write('.claude/hooks/record-verifier-report.mjs', 'claude-old');
        write('.cac/hooks/record-verifier-report.mjs', 'ca-old');
        for (const [rel, text] of configs) write(rel, text);
        clearFrameworkConfigCache();
        const result = executeInitTask({ ...ensureConfigTask, id: 'cleanup-deprecated' }, 'run', {
          projectRoot: root, harnessRoot: path.resolve(__dirname, '../..'), materializedAdapters: ['cursor'],
          plan: { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [] },
        } as InitExecutionContext);
        assert.strictEqual(result.failed, false);
        assert(!result.cleanup_effects?.blocked && !result.cleanup_effects?.warning,
          `不应有 blocked/warning：${JSON.stringify(result.cleanup_effects)}`);
        for (const rel of ['.claude/hooks/record-verifier-report.mjs', '.cac/hooks']) {
          assert(!fs.existsSync(path.join(root, rel)), `未删除 ${rel}`);
        }
        for (const [rel, original] of configs) {
          const next = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
          assert.deepStrictEqual(next.hooks.SubagentStop, [{ matcher: '*',
            hooks: [{ type: 'command', command: 'node host-hook.mjs' }] }], `${rel} 内旧注册未移除`);
          const record = result.cleanup_results?.find(r => r.path === rel && r.kind === 'hook_registration');
          assert(record?.backup_path, `${rel} 未备份`);
          assert.strictEqual(fs.readFileSync(path.join(root, record!.backup_path!), 'utf-8'), original,
            `${rel} 备份非改前原件`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    // isOutsideProject 的反向锚：解析得出、但落在**工程内**的绝对路径引用必须 blocked。
    // （既有 blocked 用例用的是带参数复合命令，extractNodeScriptPath 返回 null，区分不了变异。）
    name: 'cleanup：hooks.json 引用工程内绝对路径（非 owned 位置）→ blocked、脚本保留、不记 warning',
    run: () => {
      const root = mkTmp();
      try {
        const adapter = checkInitTesting.loadAdapter('codex');
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        const inside = path.join(root, 'other', 'check-phase-completion.mjs');
        fs.writeFileSync(path.join(root, '.codex/hooks.json'),
          JSON.stringify({ hooks: { Stop: [{ command: `node "${inside.replace(/\\/g, '/')}"` }] } }));
        fs.writeFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'local-copy');
        const result = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update');
        assert.deepStrictEqual(result.warnings, [], '工程内引用不得记 warning');
        assert.strictEqual(result.blocked.length, 1, JSON.stringify(result.blocked));
        assert.strictEqual(result.blocked[0]!.path, '.codex/hooks/check-phase-completion.mjs');
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'utf-8'),
          'local-copy', '工程内仍有引用时脚本须保留');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    // M1：工程自身经 junction 别名注册（字面路径越界、realpath 后仍在工程内）——
    // 必须按工程内引用处理，脚本保留、配置逐字不变，不得当成"别的仓库"删掉。
    name: 'cleanup：工程自身的 junction 别名路径 → blocked、脚本保留、hooks.json 逐字不变',
    run: () => {
      const root = fs.realpathSync(mkTmp());
      const linkDir = fs.realpathSync(mkTmp());
      const alias = path.join(linkDir, 'project-alias');
      try {
        fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
        const adapter = checkInitTesting.loadAdapter('codex');
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        const source = `${JSON.stringify({ version: 1, hooks: { Stop: [
          { command: `node '${path.join(alias, '.codex', 'hooks', 'check-phase-completion.mjs')}'` },
        ] } }, null, 2)}\n`;
        fs.writeFileSync(path.join(root, '.codex/hooks.json'), source);
        fs.writeFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'local-copy');
        const result = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update');
        assert.deepStrictEqual(result.warnings, [], 'junction 别名不是工程外');
        assert.strictEqual(result.blocked.length, 1, JSON.stringify(result.blocked));
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'utf-8'),
          'local-copy', 'junction 别名引用不得删脚本');
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf-8'), source,
          'hooks.json 须逐字不变');
      } finally {
        fs.rmSync(alias, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(linkDir, { recursive: true, force: true });
      }
    },
  },
  {
    // 缺陷 2：宿主 .codex/hooks.json 的 Stop 指向**另一个仓库**的绝对路径（那边文件已不存在）。
    // 文件名兜底不得据此判"仍被引用"，更不得把 blocked 升级成任务 failed。
    name: 'cleanup：hooks.json 引用工程外绝对路径 → 删本地副本、配置逐字不变、记 warning 且任务不 failed',
    run: () => {
      const root = mkTmp();
      try {
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(legalCursorConfigWritePayload()));
        const outside = path.resolve(os.tmpdir(), 'outside-project-repo', '.codex', 'hooks', 'check-phase-completion.mjs');
        const source = `${JSON.stringify({ version: 1, hooks: { Stop: [{ command: `node '${outside}'` }] } }, null, 2)}\n`;
        fs.writeFileSync(path.join(root, '.codex/hooks.json'), source);
        fs.writeFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'local-copy');
        clearFrameworkConfigCache();
        const ctx: InitExecutionContext = {
          projectRoot: root, harnessRoot: path.resolve(__dirname, '../..'), materializedAdapters: ['cursor'],
          plan: { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [] },
        };
        const result = executeInitTask({ ...ensureConfigTask, id: 'cleanup-deprecated' }, 'run', ctx);
        assert.strictEqual(result.failed, false);
        assert.strictEqual(result.cleanup_effects?.warning, 1);
        assert(!result.cleanup_effects?.blocked, '工程外引用不得记 blocked');
        assert(!fs.existsSync(path.join(root, '.codex/hooks/check-phase-completion.mjs')), '工程外引用不应阻断删除本地副本');
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf-8'), source, 'hooks.json 须逐字不变');
        const warn = result.cleanup_results?.find(r => r.status === 'warning');
        assert(warn?.message?.includes(outside.replace(/\\/g, '/')), `warning 须点名工程外路径：${warn?.message}`);
        assert(result.cleanup_results?.some(r => r.path === '.codex/hooks/check-phase-completion.mjs' && r.backup_path));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    // M2：工程外 command 与工程内引用**同处一个对象**时，只能剔除 command 键；
    // 丢掉整个对象会连带丢掉 args 里的工程内引用，把 blocked 误降成 warning + 删脚本。
    name: 'cleanup：同一对象内 工程外 command + 工程内 args → blocked、脚本保留、hooks.json 不变',
    run: () => {
      const root = mkTmp();
      try {
        const adapter = checkInitTesting.loadAdapter('codex');
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        const outside = path.resolve(os.tmpdir(), 'outside-project-repo', '.codex', 'hooks', 'check-phase-completion.mjs');
        const source = JSON.stringify({ hooks: { Stop: [
          { command: `node '${outside.replace(/\\/g, '/')}'`, args: ['.codex/hooks/check-phase-completion.mjs'] },
        ] } });
        fs.writeFileSync(path.join(root, '.codex/hooks.json'), source);
        fs.writeFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'local-copy');
        const result = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update');
        assert.deepStrictEqual(result.warnings, [], 'args 里仍有工程内引用，不得只记 warning');
        assert.strictEqual(result.blocked.length, 1, JSON.stringify(result.blocked));
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'utf-8'), 'local-copy');
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf-8'), source, 'hooks.json 须逐字不变');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    // M1：工程内以两个点开头的合法目录名（`..cache/`）不是越界——
    // `rel.startsWith('..')` 会把它判成工程外，删掉仍被引用的本地脚本。
    name: 'cleanup：hooks.json 引用工程内 ..cache/ 目录 → blocked、脚本保留、不记 warning',
    run: () => {
      const root = fs.realpathSync(mkTmp());
      try {
        const adapter = checkInitTesting.loadAdapter('codex');
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        fs.mkdirSync(path.join(root, '..cache'), { recursive: true });
        const inside = path.join(root, '..cache', 'check-phase-completion.mjs');
        fs.writeFileSync(inside, 'dot-dot-dir-copy');
        fs.writeFileSync(path.join(root, '.codex/hooks.json'),
          JSON.stringify({ hooks: { Stop: [{ command: `node "${inside.replace(/\\/g, '/')}"` }] } }));
        fs.writeFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'local-copy');
        const result = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update');
        assert.deepStrictEqual(result.warnings, [], '..cache 是工程内合法目录，不得记 warning');
        assert.strictEqual(result.blocked.length, 1, JSON.stringify(result.blocked));
        assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'utf-8'),
          'local-copy', '工程内仍有引用时脚本须保留');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    // P2：路径含**未展开变量**（`$env:VAR`、`%VAR%`）时字面目录必然不存在，祖先上溯会落到
    // Temp 等工程外目录 → 误判工程外删本地副本，宿主 hook 随即 MODULE_NOT_FOUND。
    // 运行时展开后可能正指向本工程；框架不解释 shell，一律保守当工程内。
    name: 'cleanup：hooks.json 引用含未展开变量的绝对路径 → blocked、脚本保留、hooks.json 逐字不变、不记 warning',
    run: () => {
      const root = fs.realpathSync(mkTmp());
      try {
        const adapter = checkInitTesting.loadAdapter('codex');
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        for (const variable of ['$env:MAISON_REVIEW_DIR', '%MAISON_REVIEW_DIR%']) {
          const unexpanded = path.resolve(os.tmpdir(), variable, '.codex', 'hooks', 'check-phase-completion.mjs');
          const source = JSON.stringify({ hooks: { Stop: [
            { command: `node "${unexpanded.replace(/\\/g, '/')}"` },
          ] } });
          fs.writeFileSync(path.join(root, '.codex/hooks.json'), source);
          fs.writeFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'local-copy');
          const result = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update');
          assert.deepStrictEqual(result.warnings, [], `${variable}：未展开变量不得判工程外`);
          assert.strictEqual(result.blocked.length, 1, `${variable}：${JSON.stringify(result.blocked)}`);
          assert.strictEqual(result.blocked[0]!.path, '.codex/hooks/check-phase-completion.mjs');
          assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks/check-phase-completion.mjs'), 'utf-8'),
            'local-copy', `${variable}：脚本须保留`);
          assert.strictEqual(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf-8'), source,
            `${variable}：hooks.json 须逐字不变`);
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '无法识别的复合、拼接引用在 removed/unchanged 两种分支均保留脚本，缺失脚本仍记录 blocked',
    run: () => {
      const root = mkTmp();
      try {
        const adapter = checkInitTesting.loadAdapter('codex');
        const scriptRel = '.codex/hooks/check-phase-completion.mjs';
        fs.mkdirSync(path.join(root, '.codex/hooks'), { recursive: true });
        for (const command of [`node "$VAR"/${scriptRel} --flag`, `node ${scriptRel} && node host.mjs`, `node ${scriptRel} --flag`]) {
          for (const recognized of [false, true]) {
            fs.writeFileSync(path.join(root, scriptRel), 'old');
            fs.writeFileSync(path.join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { Stop: [
              { command }, ...(recognized ? [{ command: `node ${scriptRel}` }] : []),
            ] } }));
            const result = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update');
            assert.strictEqual(result.blocked.length, 1, command);
            assert.strictEqual(result.cleaned.length, recognized ? 1 : 0);
            assert.strictEqual(fs.readFileSync(path.join(root, scriptRel), 'utf-8'), 'old');
          }
        }
        fs.unlinkSync(path.join(root, scriptRel));
        assert.strictEqual(checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update').blocked.length, 1);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'UPDATE 全 adapter 退役：离开物化列表也清理，备份原件、保留现行/宿主产物、重复执行幂等',
    run: () => {
      const root = mkTmp();
      const frameworkRoot = path.resolve(__dirname, '../../..');
      const write = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      };
      try {
        write('framework.config.json', JSON.stringify(legalCursorConfigWritePayload()));
        const retired = new Map<string, string>();
        const preserved = new Map<string, string>();
        for (const name of listAvailableAdapters(frameworkRoot).names) {
          const adapter = checkInitTesting.loadAdapter(name);
          const cfg = adapter.rawConfig as any;
          const targets = [
            { dir: name === 'generic' ? '.agents/skills' : cfg.skill_bridge?.target_dir, suffix: '/SKILL.md' },
            { dir: cfg.commands?.target_dir, suffix: '.md' },
          ];
          for (const target of targets.filter(t => t.dir)) {
            const old = `${target.dir}/goal-orchestration${target.suffix}`;
            retired.set(old, `old:${old}`);
            preserved.set(`${target.dir}/coding${target.suffix}`, 'current');
            preserved.set(`${target.dir}/host-custom${target.suffix}`, 'host');
          }
          for (const entry of adapter.deprecatedArtifacts) {
            if (!entry.path.startsWith('hooks/')) continue;
            const base = cfg.rules.target_dir.replace(/\/rules$/, '');
            retired.set(`${base}/${entry.path}`, `old:${name}:${entry.path}`);
          }
        }
        for (const [rel, content] of [...retired, ...preserved]) write(rel, content);
        const configs = new Map<string, string>();
        for (const base of ['.claude', '.cac', '.codex']) {
          const rel = `${base}/${base === '.codex' ? 'hooks.json' : 'settings.json'}`;
          const commands = [...retired.keys()].filter(p => p.startsWith(`${base}/hooks/`));
          const settings = base === '.codex' ? null : JSON.parse(fs.readFileSync(path.join(frameworkRoot,
            'agents', base === '.cac' ? 'codeagent' : 'claude', 'templates/settings.json'), 'utf-8'));
          const templateCommand = settings?.hooks.Stop[0].hooks[0].command as string | undefined;
          const original = JSON.stringify({ keep: 'host-config', hooks: { Stop: [{ matcher: '*', extra: true,
            hooks: [...commands.map(p => ({ type: 'command', command: templateCommand
              ? templateCommand.replace('check-phase-completion.mjs', path.basename(p)) : `node "${p}"` })),
              { type: 'command', command: 'node host-hook.mjs' }],
          }] } });
          write(rel, original);
          configs.set(rel, original);
        }
        clearFrameworkConfigCache();
        const ctx: InitExecutionContext = {
          projectRoot: root, harnessRoot: path.join(frameworkRoot, 'harness'), materializedAdapters: ['cursor'],
          plan: { schema_version: '1.0', scope: 'project', mode: 'update', generated_at: '', tasks: [] },
        };
        const task = { ...ensureConfigTask, id: 'cleanup-deprecated' };
        const result = executeInitTask(task, 'run', ctx);
        for (const [rel, content] of retired) {
          assert(!fs.existsSync(path.join(root, rel)), `残留 ${rel}`);
          const record = result.cleanup_results?.find(item => rel.startsWith(item.path.replace(/\/$/, '') + '/') || item.path === rel);
          assert(record?.backup_path, `未记录备份 ${rel}`);
          const backupFile = record.path.endsWith('/') ? `${record.backup_path}SKILL.md` : record.backup_path;
          assert.strictEqual(fs.readFileSync(path.join(root, backupFile), 'utf-8'), content);
        }
        for (const [rel, content] of preserved) assert.strictEqual(fs.readFileSync(path.join(root, rel), 'utf-8'), content);
        for (const [rel, original] of configs) {
          const next = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
          assert.strictEqual(next.keep, 'host-config');
          assert.deepStrictEqual(next.hooks.Stop, [{ matcher: '*', extra: true,
            hooks: [{ type: 'command', command: 'node host-hook.mjs' }] }]);
          const record = result.cleanup_results?.find(item => item.path === rel);
          assert.strictEqual(record?.kind, 'hook_registration');
          assert.strictEqual(fs.readFileSync(path.join(root, record!.backup_path!), 'utf-8'), original);
        }
        assert.strictEqual(result.cleanup_effects?.hook_configs_updated, 3);
        assert.strictEqual(result.cleanup_effects?.backup_deleted, retired.size);
        assert.strictEqual(executeInitTask(task, 'run', ctx).cleanup_results, undefined);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: '所有 adapter 共用退役 hook 清理：脚本已丢失仍清注册；非法 JSON/schema 与越界声明零写入',
    run: () => {
      const frameworkRoot = path.resolve(__dirname, '../../..');
      for (const name of listAvailableAdapters(frameworkRoot).names) {
        const root = mkTmp();
        try {
          const adapter = checkInitTesting.loadAdapter(name);
          const targetRoot = '.custom';
          adapter.deprecatedArtifacts = [{ path: 'hooks/retired.mjs', action: 'backup_delete', reason: 'test', hookConfigs: ['hooks.json'] }];
          fs.mkdirSync(path.join(root, targetRoot, 'hooks'), { recursive: true });
          const configFile = path.join(root, targetRoot, 'hooks.json');
          fs.writeFileSync(configFile, JSON.stringify({ keep: 1, hooks: { Stop: [{ command: 'node .custom/hooks/retired.mjs' }] } }));
          const cleaned = checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update', { targetRoot: ' .custom/ ' }).cleaned;
          assert.deepStrictEqual(cleaned.map(c => c.action), ['remove_hook_registration'], name);
          assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, 'utf-8')), { keep: 1, hooks: {} });
          const script = path.join(root, targetRoot, 'hooks/retired.mjs');
          fs.writeFileSync(script, 'old');
          for (const invalid of ['not-json', '{"hooks":{"Stop":{}}}']) {
            fs.writeFileSync(configFile, invalid);
            assert.throws(() => checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update', { targetRoot }), /无法安全清理/);
            assert.strictEqual(fs.readFileSync(configFile, 'utf-8'), invalid);
            assert.strictEqual(fs.readFileSync(script, 'utf-8'), 'old');
          }
          adapter.deprecatedArtifacts[0]!.path = '../host.txt';
          assert.throws(() => checkInitTesting.applyDeprecatedArtifactsCleanup(root, adapter, 'update', { targetRoot }), /非法相对路径/);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    },
  },
  {
    // plan 33714d0c：宿主 .gitignore 不再属于 Maison 契约——writer 已整体删除。
    // 这条是**退役回归**：即使旧 decision/run-log 仍带该 task_id（历史 staging 复用），
    // executor 也不得写盘、不得恢复兼容 writer。
    name: '退役回归：ensure-gitignore 已无 executor 实现，零 .gitignore 写盘',
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
      const result = executeInitTask(task, 'run', ctx);
      assert(!fs.existsSync(path.join(root, '.gitignore')), `不得写宿主 .gitignore：${result.message}`);
      assert(
        result.message.includes('无 executor 实现'),
        `不得保留兼容 writer 或空壳分支：${result.message}`,
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 't1 executeInitTask record-adapter（非 goal record-adapter）经 updateLocalConfig 无损：device/unlock.credential_ref + vision + toolchain 交叉保真',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          project_profile: { name: 'generic' },
          materialized_adapters: ['claude'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({
          schema_version: '1.0',
          agent_adapter: 'cursor',
          vision: { image_input_override: 'tool_read', canary: { adapter: 'cursor', verdict: 'tool_read', probed_at: '2026-07-09T00:00:00.000Z' } },
          toolchain: { devEcoStudio: { installPath: 'C:/DevEco' } },
          device: { unlock: { mode: 'credential', credential_ref: 'maison/device/3UJ0/v2' }, target_serial: '3UJ0225321000395' },
        }, null, 2),
      );
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: path.join(layout.frameworkRoot, 'harness'),
        plan: { schema_version: '1.0', scope: 'personal', mode: 'update', generated_at: '', tasks: [] },
        activeAdapter: 'claude',
        materializedAdapters: ['claude'],
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
      assert.strictEqual(local.agent_adapter, 'claude');
      assert.strictEqual(local.device?.unlock?.mode, 'credential', 'device.unlock.mode 应保留');
      assert.strictEqual(local.device?.unlock?.credential_ref, 'maison/device/3UJ0/v2', 'credential_ref 应原样保留（本次事故根因）');
      assert.strictEqual(local.device?.target_serial, '3UJ0225321000395', 'target_serial 应保留');
      assert.strictEqual(local.vision?.image_input_override, 'tool_read', 'vision 应保留');
      assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, 'C:/DevEco', 'toolchain 应保留');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask record-adapter best-effort writes deveco installPath',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          project_profile: { name: 'hmos-app', sub_variant: 'app' },
          materialized_adapters: ['claude'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      fs.writeFileSync(
        path.join(root, 'framework.local.json'),
        JSON.stringify({
          schema_version: '1.0',
          agent_adapter: 'cursor',
          vision: { image_input_override: 'tool_read' },
          toolchain: { devEcoStudio: { installPath: 'C:/old' } },
          device: { unlock: { mode: 'credential', credential_ref: 'maison/device/3UJ0/v2' }, target_serial: '3UJ0225321000395' },
        }, null, 2),
      );

      const fakeInstall = path.join(root, 'fake-deveco');
      const hvigorBin = path.join(
        fakeInstall,
        'tools',
        'hvigor',
        'bin',
        process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw',
      );
      fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
      fs.writeFileSync(hvigorBin, '');

      __testing_setDetectScanForEnsure(() => ({
        candidates: [],
        recommended: {
          status: 'ok',
          installPath: fakeInstall,
          source: 'scan',
          missing: [],
        },
      }));
      try {
        clearFrameworkConfigCache();
        const ctx: InitExecutionContext = {
          projectRoot: root,
          harnessRoot: path.join(layout.frameworkRoot, 'harness'),
          plan: { schema_version: '1.0', scope: 'personal', mode: 'update', generated_at: '', tasks: [] },
          activeAdapter: 'claude',
          materializedAdapters: ['claude'],
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
        assert.strictEqual(local.agent_adapter, 'claude');
        assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, fakeInstall);
        assert.strictEqual(local.device?.unlock?.credential_ref, 'maison/device/3UJ0/v2', 't1：--ensure toolchain 写回不得丢 device.unlock.credential_ref');
        assert.strictEqual(local.vision?.image_input_override, 'tool_read', 't1：--ensure toolchain 写回不得丢 vision');
      } finally {
        __testing_setDetectScanForEnsure(null);
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'executeInitTask record-adapter no deveco candidate keeps agent_adapter only',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          project_profile: { name: 'hmos-app', sub_variant: 'app' },
          materialized_adapters: ['claude'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# stub\n');
      __testing_setDetectScanForEnsure(() => ({ candidates: [] }));
      try {
        clearFrameworkConfigCache();
        const ctx: InitExecutionContext = {
          projectRoot: root,
          harnessRoot: path.join(layout.frameworkRoot, 'harness'),
          plan: { schema_version: '1.0', scope: 'personal', mode: 'update', generated_at: '', tasks: [] },
          activeAdapter: 'claude',
          materializedAdapters: ['claude'],
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
        const result = executeInitTask(task, 'run', ctx);
        assert.match(result.message, /agent_adapter=claude/);
        assert.match(result.message, /DevEco 工具链未自动探测到/);
        const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
        assert.strictEqual(local.agent_adapter, 'claude');
        assert.strictEqual(local.toolchain?.devEcoStudio?.installPath, undefined);
      } finally {
        __testing_setDetectScanForEnsure(null);
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'executeInitTask record-adapter throws on non-DevEco ensure failure',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          project_profile: { name: 'hmos-app', sub_variant: 'app' },
          materialized_adapters: ['claude'],
          architecture: {
            outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
            module_inner_layers: ['shared'],
            inner_dependency_direction: 'upward',
            cross_module_exports_file: 'index.ets',
          },
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      __testing_setDetectScanForEnsure(() => ({ candidates: [] }));
      try {
        clearFrameworkConfigCache();
        const ctx: InitExecutionContext = {
          projectRoot: root,
          harnessRoot: path.join(layout.frameworkRoot, 'harness'),
          plan: { schema_version: '1.0', scope: 'personal', mode: 'update', generated_at: '', tasks: [] },
          activeAdapter: 'claude',
          materializedAdapters: ['claude'],
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
        assert.throws(
          () => executeInitTask(task, 'run', ctx),
          /record-adapter 后 personal setup 未就绪/,
        );
        const local = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
        assert.strictEqual(local.agent_adapter, 'claude');
      } finally {
        __testing_setDetectScanForEnsure(null);
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
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
      const result = executeInitTask(task, 'run', ctx);
      const skillPath = path.join(root, '.agents', 'skills', 'framework-init', 'SKILL.md');
      assert(fs.existsSync(skillPath), `${result.message}; expected ${skillPath}`);
      const bridge = fs.readFileSync(skillPath, 'utf-8');
      assert(bridge.includes('完整 Skill 定义请阅读'));
      assert(bridge.includes('framework/skills/project/framework-init/SKILL.md'));
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
      const result = executeInitTask(task, 'run', ctx);
      const claudePath = path.join(root, 'CLAUDE.md');
      assert(fs.existsSync(claudePath), `${result.message}; expected ${claudePath}`);
      const body = fs.readFileSync(claudePath, 'utf-8');
      assert(!body.includes('{{EXTENSION_SKILL_SECTION}}'), 'placeholder must be replaced');
      assert(body.includes('实例扩展 Skill'), 'extension section must be rendered from projectRoot');
      assert(body.includes(skillSlug), `expected extension skill slug in CLAUDE.md`);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask materialize-adapter:claude delegates owned per-file targets',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const targetRel = '.claude/rules/interaction-renderer.md';
      const custom = '# custom keep content\n';
      fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(root, targetRel), custom, 'utf-8');
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'ownership-test',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      const plan: InitTaskPlan = {
        schema_version: '1.0',
        scope: 'project',
        mode: 'update',
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: `materialize-adapter-file:${targetRel}`,
            title: targetRel,
            category: 'adapter-template',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'drift',
            default_action: 'prompt',
            skippable: true,
            allowed_actions: ['overwrite', 'keep'],
            target_path: targetRel,
          },
          {
            id: 'materialize-adapter:claude',
            title: '同步已选 adapter bundle: claude（幂等）',
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

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan,
        materializedAdapters: ['claude'],
      };
      const result = executeInitTask(plan.tasks[1]!, 'run', ctx);
      assert(result.file_results?.length, 'bundle should emit file_results');
      const owned = result.file_results!.find(r => r.targetRel === targetRel);
      assert(owned, `expected ${targetRel} in file_results`);
      assert.strictEqual(owned!.effect, 'delegated');
      assert.strictEqual(fs.readFileSync(path.join(root, targetRel), 'utf-8'), custom);
      const rels = result.file_results!.map(r => r.targetRel);
      assert.strictEqual(new Set(rels).size, rels.length, 'targetRel must be unique');
      const sum =
        (result.file_effects?.created ?? 0) +
        (result.file_effects?.updated ?? 0) +
        (result.file_effects?.unchanged ?? 0) +
        (result.file_effects?.delegated ?? 0);
      assert.strictEqual(sum, result.file_results!.length);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask materialize-adapter:generic inline 不重复计入 file_results',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'inline-telemetry',
            materialized_adapters: ['generic'],
            architecture: minimalArchitecture(),
            paths: {
              features_dir: 'doc/features',
              agent_bundle_root: '.agents',
              agent_bundle_skill_mode: 'inline',
            },
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
          generated_at: new Date().toISOString(),
          tasks: [],
        },
        materializedAdapters: ['generic'],
      };
      const result = executeInitTask(
        {
          id: 'materialize-adapter:generic',
          title: '同步已选 adapter bundle: generic（幂等）',
          category: 'adapter-bundle',
          scope: 'project',
          deps: ['ensure-config'],
          status: 'needed',
          default_action: 'run',
          skippable: false,
          allowed_actions: ['run'],
        },
        'run',
        ctx,
      );
      assert(result.file_results?.length, 'inline bundle should emit file_results');
      const rels = result.file_results!.map(r => r.targetRel);
      assert.strictEqual(
        new Set(rels).size,
        rels.length,
        `targetRel must be unique: ${rels.join(', ')}`,
      );
      assert(rels.some(r => r.startsWith('.agents/skills/') && r.endsWith('/SKILL.md')));
      const sum =
        (result.file_effects?.created ?? 0) +
        (result.file_effects?.updated ?? 0) +
        (result.file_effects?.unchanged ?? 0) +
        (result.file_effects?.delegated ?? 0);
      assert.strictEqual(sum, result.file_results!.length);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask sync-auto-overwrite 仅处理自身 target',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'mechanism-per-target',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
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
          generated_at: new Date().toISOString(),
          tasks: [],
        },
        materializedAdapters: ['claude'],
      };
      const settingsTarget = '.claude/settings.json';
      const hooksTarget = '.claude/hooks/check-phase-completion.mjs';

      const settingsResult = executeInitTask(
        {
          id: `sync-auto-overwrite:${settingsTarget}`,
          title: settingsTarget,
          category: 'adapter-template-sync',
          scope: 'project',
          deps: ['ensure-config'],
          status: 'needed',
          default_action: 'run',
          skippable: false,
          allowed_actions: ['run'],
          target_path: settingsTarget,
        },
        'run',
        ctx,
      );
      assert.strictEqual(settingsResult.file_results?.length, 1);
      assert.strictEqual(settingsResult.file_results![0]!.targetRel, settingsTarget);

      const hooksResult = executeInitTask(
        {
          id: `sync-auto-overwrite:${hooksTarget}`,
          title: hooksTarget,
          category: 'adapter-template-sync',
          scope: 'project',
          deps: ['ensure-config'],
          status: 'needed',
          default_action: 'run',
          skippable: false,
          allowed_actions: ['run'],
          target_path: hooksTarget,
        },
        'run',
        ctx,
      );
      assert.strictEqual(hooksResult.file_results?.length, 1);
      assert.strictEqual(hooksResult.file_results![0]!.targetRel, hooksTarget);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask sync-auto-overwrite：hooks_config 目标非法 → 任务 throw（第八轮 codex P1-1：init 不得假宣成功）',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'hooks-config-blocked',
            materialized_adapters: ['cursor'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();
      fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(root, '.cursor', 'hooks.json'), '{ not valid json', 'utf-8');
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: new Date().toISOString(),
          tasks: [],
        },
        materializedAdapters: ['cursor'],
      };
      const target = '.cursor/hooks.json';
      assert.throws(
        () =>
          executeInitTask(
            {
              id: `sync-auto-overwrite:${target}`,
              title: target,
              category: 'adapter-template-sync',
              scope: 'project',
              deps: ['ensure-config'],
              status: 'needed',
              default_action: 'run',
              skippable: false,
              allowed_actions: ['run'],
              target_path: target,
            },
            'run',
            ctx,
          ),
        /不可安全合并|守卫未安装/,
        'blocked 必须让任务失败而非返回"已对齐"',
      );
      // 宿主文件未被覆盖（拒绝改写的另一半承诺）
      assert.strictEqual(fs.readFileSync(path.join(root, '.cursor', 'hooks.json'), 'utf-8'), '{ not valid json');
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask materialize-adapter:cursor（secondary adapter）：合法第三方 hooks 结构化合并不整文件覆盖（第十轮 codex P1）',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'secondary-adapter-merge',
            materialized_adapters: ['claude', 'cursor'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();
      fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
      const thirdParty = {
        team_meta: { owner: 'host' },
        hooks: { preToolUse: [{ matcher: 'Shell', command: 'node scripts/team-hook.js' }] },
      };
      fs.writeFileSync(
        path.join(root, '.cursor', 'hooks.json'),
        JSON.stringify(thirdParty, null, 2),
        'utf-8',
      );
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: new Date().toISOString(),
          tasks: [],
        },
        materializedAdapters: ['claude', 'cursor'],
      };
      const result = executeInitTask(
        {
          id: 'materialize-adapter:cursor',
          title: '物化 adapter: cursor',
          category: 'adapter-bundle',
          scope: 'project',
          deps: ['ensure-config'],
          status: 'needed',
          default_action: 'run',
          skippable: false,
          allowed_actions: ['run'],
          params: { adapter: 'cursor' },
        },
        'run',
        ctx,
      );
      const merged = JSON.parse(fs.readFileSync(path.join(root, '.cursor', 'hooks.json'), 'utf-8'));
      assert.deepStrictEqual(merged.team_meta, { owner: 'host' }, `第三方顶层字段必须保留；${result.message}`);
      const pre = merged.hooks?.preToolUse;
      assert(Array.isArray(pre), 'preToolUse 应为数组');
      assert(
        pre.some((e: any) => e?.command === 'node scripts/team-hook.js'),
        '第三方 hook 条目必须保留',
      );
      assert(
        pre.some((e: any) => typeof e?.command === 'string' && e.command.includes('guard-framework-write.mjs')),
        'framework 守卫条目必须合并进来',
      );
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask materialize-adapter:cursor（secondary adapter）：hooks 非法 → throw 且宿主文件原样（第十轮 codex P1 复现路径钉死）',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'secondary-adapter-blocked',
            materialized_adapters: ['claude', 'cursor'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();
      fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
      // codex 复现用的宿主原始内容：hooks 非对象 → invalid_schema
      const hostContent = JSON.stringify({ team_meta: { owner: 'host' }, hooks: 'team-owned' }, null, 2);
      fs.writeFileSync(path.join(root, '.cursor', 'hooks.json'), hostContent, 'utf-8');
      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: new Date().toISOString(),
          tasks: [],
        },
        materializedAdapters: ['claude', 'cursor'],
      };
      assert.throws(
        () =>
          executeInitTask(
            {
              id: 'materialize-adapter:cursor',
              title: '物化 adapter: cursor',
              category: 'adapter-bundle',
              scope: 'project',
              deps: ['ensure-config'],
              status: 'needed',
              default_action: 'run',
              skippable: false,
              allowed_actions: ['run'],
              params: { adapter: 'cursor' },
            },
            'run',
            ctx,
          ),
        /不可安全合并|守卫未安装/,
        'materialize 路径 blocked 也必须让任务失败',
      );
      assert.strictEqual(
        fs.readFileSync(path.join(root, '.cursor', 'hooks.json'), 'utf-8'),
        hostContent,
        '宿主 hooks.json 必须逐字节原样（不整文件覆盖）',
      );
      // 第十一轮 codex P2：第二道防线整任务零写盘——同任务内 commands/rules 等
      // 其他 adapter 文件也不得先落盘（批量物化前 dry-run 拦截）
      assert.deepStrictEqual(
        fs.readdirSync(root).sort(),
        ['.cursor', 'framework.config.json'],
        'blocked 时不得产生任何其他写盘',
      );
      assert.deepStrictEqual(
        fs.readdirSync(path.join(root, '.cursor')).sort(),
        ['hooks.json'],
        '.cursor 下不得出现 commands/rules 等物化产物',
      );
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'executeInitTask materialize-adapter:claude auto_overwrite owned 目标 delegated 且不重复',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const autoTarget = '.claude/settings.json';
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'auto-overwrite-delegated',
            materialized_adapters: ['claude'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      const plan: InitTaskPlan = {
        schema_version: '1.0',
        scope: 'project',
        mode: 'update',
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: `sync-auto-overwrite:${autoTarget}`,
            title: autoTarget,
            category: 'adapter-template-sync',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
            target_path: autoTarget,
          },
          {
            id: 'materialize-adapter:claude',
            title: '同步已选 adapter bundle: claude（幂等）',
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

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot: harnessRootFromLayout(layout),
        plan,
        materializedAdapters: ['claude'],
      };
      const result = executeInitTask(plan.tasks[1]!, 'run', ctx);
      const matches = result.file_results!.filter(r => r.targetRel === autoTarget);
      assert.strictEqual(matches.length, 1, 'auto_overwrite target should appear once');
      assert.strictEqual(matches[0]!.effect, 'delegated');
      const rels = result.file_results!.map(r => r.targetRel);
      assert.strictEqual(new Set(rels).size, rels.length);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'cleanup-deprecated CREATE：磁盘有 config + 遗留跳板仍 0 删除',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['cursor'],
          architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      fs.mkdirSync(path.join(root, '.cursor', 'skills', '3-coding'), { recursive: true });
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'create',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['cursor'],
      };
      const task = {
        id: 'cleanup-deprecated',
        title: 'cleanup',
        category: 'mechanism',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const],
      };
      const result = executeInitTask(task, 'run', ctx);
      assert.match(result.message, /CREATE 跳过/);
      assert(!result.cleanup_results?.length);
      assert(fs.existsSync(path.join(root, '.cursor', 'skills', '3-coding')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'cleanup-deprecated UPDATE cursor：删 3-coding 留 coding',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['cursor'],
          architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      fs.mkdirSync(path.join(root, '.cursor', 'skills', '3-coding'), { recursive: true });
      fs.mkdirSync(path.join(root, '.cursor', 'skills', 'coding'), { recursive: true });
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['cursor'],
      };
      const task = {
        id: 'cleanup-deprecated',
        title: 'cleanup',
        category: 'mechanism',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const],
      };
      const result = executeInitTask(task, 'run', ctx);
      assert(result.cleanup_effects?.backup_deleted);
      assert(!fs.existsSync(path.join(root, '.cursor', 'skills', '3-coding')));
      assert(fs.existsSync(path.join(root, '.cursor', 'skills', 'coding')));
      assert(result.cleanup_results?.some(r => r.path.includes('3-coding')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'cleanup-deprecated UPDATE cursor：删 prd-design/requirement-design 留 spec/plan',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['cursor'],
          architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      for (const id of ['prd-design', 'requirement-design', 'spec', 'plan']) {
        fs.mkdirSync(path.join(root, '.cursor', 'skills', id), { recursive: true });
      }
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['cursor'],
      };
      const task = {
        id: 'cleanup-deprecated',
        title: 'cleanup',
        category: 'mechanism',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const],
      };
      const result = executeInitTask(task, 'run', ctx);
      assert(result.cleanup_effects?.backup_deleted);
      assert(!fs.existsSync(path.join(root, '.cursor', 'skills', 'prd-design')));
      assert(!fs.existsSync(path.join(root, '.cursor', 'skills', 'requirement-design')));
      assert(fs.existsSync(path.join(root, '.cursor', 'skills', 'spec')));
      assert(fs.existsSync(path.join(root, '.cursor', 'skills', 'plan')));
      assert(result.cleanup_results?.some(r => r.path.includes('prd-design')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'cleanup-deprecated UPDATE claude：删语义旧名 .md 留 spec/plan',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['claude'],
          architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      const commandsDir = path.join(root, '.claude', 'commands');
      fs.mkdirSync(commandsDir, { recursive: true });
      for (const file of [
        'prd-design.md',
        'requirement-design.md',
        '1-prd-design.md',
        'spec.md',
        'plan.md',
      ]) {
        fs.writeFileSync(path.join(commandsDir, file), file);
      }
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
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
        id: 'cleanup-deprecated',
        title: 'cleanup',
        category: 'mechanism',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const],
      };
      const result = executeInitTask(task, 'run', ctx);
      assert(result.cleanup_effects?.backup_deleted);
      assert(!fs.existsSync(path.join(commandsDir, 'prd-design.md')));
      assert(!fs.existsSync(path.join(commandsDir, 'requirement-design.md')));
      assert(!fs.existsSync(path.join(commandsDir, '1-prd-design.md')));
      assert(fs.existsSync(path.join(commandsDir, 'spec.md')));
      assert(fs.existsSync(path.join(commandsDir, 'plan.md')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'cleanup-deprecated UPDATE generic+.codex：清 .codex/skills/3-coding',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['generic'],
          architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features', agent_bundle_root: '.codex' },
        }, null, 2),
      );
      fs.mkdirSync(path.join(root, '.codex', 'skills', '3-coding'), { recursive: true });
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['generic'],
        activeAdapter: 'cursor',
      };
      const task = {
        id: 'cleanup-deprecated',
        title: 'cleanup',
        category: 'mechanism',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const],
      };
      const result = executeInitTask(task, 'run', ctx);
      assert(result.cleanup_results?.some(r => r.path === '.codex/skills/3-coding/'));
      assert(!fs.existsSync(path.join(root, '.codex', 'skills', '3-coding')));
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'cleanup-deprecated UPDATE 幂等：第二次 0 cleaned',
    run: () => {
      const root = mkTmp();
      const layout = detectRepoLayout(path.join(__dirname, '../..'));
      const harnessRoot = harnessRootFromLayout(layout);
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.1',
          project_name: 't',
          materialized_adapters: ['cursor'],
          architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features' },
        }, null, 2),
      );
      fs.mkdirSync(path.join(root, '.cursor', 'skills', '3-coding'), { recursive: true });
      clearFrameworkConfigCache();

      const ctx: InitExecutionContext = {
        projectRoot: root,
        harnessRoot,
        plan: {
          schema_version: '1.0',
          scope: 'project',
          mode: 'update',
          generated_at: '',
          tasks: [],
        },
        materializedAdapters: ['cursor'],
      };
      const task = {
        id: 'cleanup-deprecated',
        title: 'cleanup',
        category: 'mechanism',
        scope: 'project' as const,
        deps: ['ensure-config'],
        status: 'needed' as const,
        default_action: 'run' as const,
        skippable: true,
        allowed_actions: ['run' as const],
      };
      const first = executeInitTask(task, 'run', ctx);
      assert(first.cleanup_effects?.backup_deleted);
      const second = executeInitTask(task, 'run', ctx);
      assert(!second.cleanup_effects?.backup_deleted);
      assert.match(second.message, /无 deprecated/);
      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  ...[
    {
      adapters: ['cursor', 'claude', 'codeagent', 'generic'],
      entryPaths: [
        '.cursor/commands/component-design.md', '.cursor/skills/component-design/SKILL.md',
        '.claude/commands/component-design.md', '.cac/commands/component-design.md',
        '.codex/skills/component-design/SKILL.md',
      ],
    },
    // 独立消费者，避免 generic 自定义 .codex 清理掩盖原生 codex 分支遗漏。
    { adapters: ['codex'], entryPaths: ['.codex/skills/component-design/SKILL.md'] },
    { adapters: ['chrys'], entryPaths: ['.agents/skills/component-design/SKILL.md'] },
    { adapters: ['opencode'], entryPaths: ['.opencode/skill/component-design/SKILL.md'] },
  ].map(({ adapters, entryPaths }) => ({
    name: `设计入口 CREATE/UPDATE ${adapters.join('+')}：旧入口备份可恢复且统一入口/用户内容保留`,
    run: () => {
      const root = mkTmp();
      const legacyPaths = entryPaths.map(p => p.replace('component-design', 'app-component-blueprint'));
      const userPaths = entryPaths.map(p => p.replace('component-design', 'my-design'));
      try {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 'entry-convergence',
          materialized_adapters: adapters, architecture: minimalArchitecture(),
          paths: { features_dir: 'doc/features', agent_bundle_root: '.codex' },
        }));
        clearFrameworkConfigCache();
        const ctx: InitExecutionContext = {
          projectRoot: root,
          harnessRoot: harnessRootFromLayout(detectRepoLayout(path.join(__dirname, '../..'))),
          plan: { schema_version: '1.0', scope: 'project', mode: 'create', generated_at: '', tasks: [] },
          materializedAdapters: adapters,
        };
        const task = {
          id: 'cleanup-deprecated', title: 'cleanup', category: 'mechanism', scope: 'project' as const,
          deps: [], status: 'needed' as const, default_action: 'run' as const,
          skippable: true, allowed_actions: ['run' as const],
        };
        const materialize = () => {
          for (const adapter of adapters) executeInitTask({
            ...task, id: `materialize-adapter:${adapter}`, params: { adapter },
          }, 'run', ctx);
        };
        materialize();
        for (const p of entryPaths) assert(fs.existsSync(path.join(root, p)), `CREATE 缺 ${p}`);
        for (const p of legacyPaths) assert(!fs.existsSync(path.join(root, p)), `CREATE 暴露 ${p}`);
        const entryBytes = entryPaths.map(p => fs.readFileSync(path.join(root, p), 'utf8'));
        for (const p of [...legacyPaths, ...userPaths]) {
          fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
          fs.writeFileSync(path.join(root, p), `original content: ${p}`);
        }
        ctx.plan.mode = 'update';
        // 只重新物化、未执行 cleanup-deprecated 时，旧入口仍在，不能宣称已清理。
        materialize();
        for (const p of legacyPaths) assert(fs.existsSync(path.join(root, p)), `物化不应越权清理 ${p}`);
        const result = executeInitTask(task, 'run', ctx);
        assert.strictEqual(result.cleanup_results?.length, legacyPaths.length);
        for (const p of legacyPaths) {
          assert(!fs.existsSync(path.join(root, p)), `UPDATE 未移除 ${p}`);
          const row: CleanupResult | undefined = result.cleanup_results!.find(r => p === r.path || p.startsWith(r.path.replace(/\/$/, '') + '/'));
          assert(row?.backup_path, `${p} 缺恢复路径`);
          assert(!fs.existsSync(path.join(root, row.path)), `旧入口目录/文件残留：${row.path}`);
          const suffix = p.slice(row.path.replace(/\/$/, '').length);
          assert.strictEqual(fs.readFileSync(path.join(root, row.backup_path + suffix), 'utf8'), `original content: ${p}`);
        }
        materialize();
        for (const p of legacyPaths) assert(!fs.existsSync(path.join(root, p)), `UPDATE 又物化了 ${p}`);
        entryPaths.forEach((p, i) => assert.strictEqual(fs.readFileSync(path.join(root, p), 'utf8'), entryBytes[i]));
        for (const p of userPaths) assert.strictEqual(fs.readFileSync(path.join(root, p), 'utf8'), `original content: ${p}`);
        assert(!executeInitTask(task, 'run', ctx).cleanup_results?.length, '再次清理应为 no-op');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  })),
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
