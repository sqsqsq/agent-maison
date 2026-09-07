// codex-adapter-verifier-template.unit.test.ts
// plan 7b2e9d4c §6：V1 等值/漂移、V2 骨架逐行 + 正文逐字节、V3a–V3d 临时工程真实执行入口。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { renderCodexAgentToml } from '../../scripts/utils/codex-agent-toml';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';
import type { UnitCaseResult } from '../run-unit';

const { frameworkRoot: FRAMEWORK_ROOT } = detectRepoLayout(path.join(__dirname, '..', '..'));
const MD_REL = 'agents/claude/templates/agents/verifier.md';
const TOML_REL = 'agents/codex/templates/agents/verifier.toml';
const TARGET_REL = '.codex/agents/verifier.toml';

function readMd(): string {
  return fs.readFileSync(path.join(FRAMEWORK_ROOT, MD_REL), 'utf-8');
}

function readTomlNormalized(): string {
  return fs.readFileSync(path.join(FRAMEWORK_ROOT, TOML_REL), 'utf-8').replace(/\r\n/g, '\n');
}

function mkMarkdown(fm: string, body: string): string {
  return `---\n${fm}\n---\n\n${body}\n`;
}

function throwsWith(fn: () => unknown, fragment: string): void {
  let msg = '';
  try {
    fn();
  } catch (e) {
    msg = (e as Error).message;
  }
  assert(msg.includes(fragment), `expected throw containing "${fragment}", got "${msg}"`);
}

function mkTmpProject(preset?: string, adapters: string[] = ['codex']): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-verifier-'));
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'codex-verifier-template',
        materialized_adapters: adapters,
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
  if (preset !== undefined) {
    fs.mkdirSync(path.join(root, '.codex', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, TARGET_REL), preset, 'utf-8');
  }
  clearFrameworkConfigCache();
  return root;
}

function ctxFor(root: string, adapters: string[] = ['codex']): InitExecutionContext {
  const layout = detectRepoLayout(path.join(__dirname, '..', '..'));
  return {
    projectRoot: root,
    harnessRoot: harnessRootFromLayout(layout),
    plan: {
      schema_version: '1.0',
      scope: 'project',
      mode: 'update',
      generated_at: new Date().toISOString(),
      tasks: [],
    },
    materializedAdapters: adapters,
  };
}

function backupStamps(root: string): string[] {
  const dir = path.join(root, '.framework-backup');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** 5 月契约手写版片段（plan 7b2e9d4c F02）——只用作「旧内容」 */
const LEGACY_TOML = [
  'name = "verifier"',
  'description = "阶段产物审查员（宿主 2026-05-25 手写版）"',
  'developer_instructions = """',
  '读取 verify-<phase>.md 与 phase-rules/<phase>-rules.yaml，输出 Markdown 表加 BLOCKER FAIL 数。',
  '"""',
  '',
].join('\n');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'V1 等值：renderCodexAgentToml(verifier.md) 与磁盘 verifier.toml 逐字节相等',
    run: () => {
      assert.strictEqual(renderCodexAgentToml(readMd()), readTomlNormalized());
    },
  },
  {
    name: 'V1 漂移：verifier.md 正文改一个字符再渲染必须与磁盘不等',
    run: () => {
      const md = readMd();
      const drifted = md.replace('你是一个**独立的审查员**', '你是一个**独立的审查员x**');
      assert(drifted !== md, '反例未命中正文——verifier.md 正文结构变了，请更新本用例');
      assert.notStrictEqual(renderCodexAgentToml(drifted), readTomlNormalized());
    },
  },
  {
    name: 'V2 结构：骨架前 9 行逐行等于 D1 顺序；正文逐字节保留',
    run: () => {
      const md = readMd();
      const toml = renderCodexAgentToml(md);

      const desc = /^description: (.*)$/m.exec(md.replace(/\r\n/g, '\n'))?.[1]?.trim();
      assert(desc, 'verifier.md frontmatter 无 description');
      // D1 骨架逐行（顺序即文件顺序）——顺序或措辞变动都在这里失败
      assert.deepStrictEqual(toml.split('\n').slice(0, 9), [
        '# 生成文件：由 agents/claude/templates/agents/verifier.md 渲染（cd harness && npm run sync:codex-agents），勿手改。',
        '# 等值由 harness/tests/unit/codex-adapter-verifier-template.unit.test.ts 守护（plan 7b2e9d4c）。',
        'name = "verifier"',
        `description = '''${desc}'''`,
        '# verifier.md 的 tools: Read, Glob, Grep → 角色默认沙箱 read-only。',
        '# 仅为默认值：Codex spawn_agent 会用父线程实时权限覆盖（goal 父进程为 danger-full-access），',
        '# 不写盘的约束由下方 developer_instructions 的硬性规则承担（plan 7b2e9d4c D3）。',
        'sandbox_mode = "read-only"',
        "developer_instructions = '''",
      ]);

      assert(toml.endsWith("\n'''\n"), 'developer_instructions 必须以 literal 结束标记收尾');
      assert(!toml.includes('\r'), '输出不得含 CR');

      // 正文逐字保留：只归一 EOL + 尾部恰好一个换行（D1）。用合成 markdown 断言，
      // 不复用与生产同样裁剪的 helper——首空行与行尾空格都必须原样出现。
      const open = "developer_instructions = '''\n";
      const synthetic = '---\nname: verifier\ndescription: 审查员\ntools: Read, Glob, Grep\n---\n\nline  \n\n';
      const rendered = renderCodexAgentToml(synthetic.replace(/\n/g, '\r\n'));
      const openAt = rendered.indexOf(open);
      assert(openAt > 0, 'developer_instructions 起始标记缺失');
      assert.strictEqual(rendered.slice(openAt + open.length), "\nline  \n'''\n");
    },
  },
  {
    name: 'V2 抛错：正文含 三引号 / description 含 三引号 / tools 越出只读集合 / name 非 verifier',
    run: () => {
      const fm = 'name: verifier\ndescription: 审查员\ntools: Read, Glob, Grep';
      throwsWith(() => renderCodexAgentToml(mkMarkdown(fm, "正文里有 ''' 三引号")), '正文含');
      throwsWith(
        () => renderCodexAgentToml(mkMarkdown("name: verifier\ndescription: 审 ''' 员\ntools: Read", '正文')),
        'description含',
      );
      throwsWith(
        () => renderCodexAgentToml(mkMarkdown('name: verifier\ndescription: 审查员\ntools: Read, Write', '正文')),
        '只读集合已变',
      );
      throwsWith(
        () => renderCodexAgentToml(mkMarkdown('name: reviewer\ndescription: 审查员\ntools: Read', '正文')),
        '只承诺 verifier 角色',
      );
      throwsWith(() => renderCodexAgentToml('没有 frontmatter\n'), '缺少 frontmatter');
    },
  },
  {
    name: 'V3a 首次生成：materialize-adapter:codex 在临时工程写出 .codex/agents/verifier.toml',
    run: () => {
      const root = mkTmpProject();
      try {
        const result = executeInitTask(
          {
            id: 'materialize-adapter:codex',
            title: '同步已选 adapter bundle: codex（幂等）',
            category: 'adapter-bundle',
            scope: 'project',
            deps: ['ensure-config'],
            status: 'needed',
            default_action: 'run',
            skippable: false,
            allowed_actions: ['run'],
          },
          'run',
          ctxFor(root),
        );
        const written = path.join(root, TARGET_REL);
        assert(fs.existsSync(written), `${result.message}；期望写出 ${TARGET_REL}`);
        assert(
          fs.readFileSync(written).equals(fs.readFileSync(path.join(FRAMEWORK_ROOT, TOML_REL))),
          '实例文件须与模板逐字节相等',
        );
        const row = result.file_results?.find(r => r.targetRel === TARGET_REL);
        assert(row, `file_results 须含 ${TARGET_REL}`);
        assert.strictEqual(row!.effect, 'created');
        assert.strictEqual(backupStamps(root).length, 0, '首次生成不得产生备份目录');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'V3b 旧 toml 备份后覆盖 + 再执行幂等（sync-auto-overwrite）',
    run: () => {
      const root = mkTmpProject(LEGACY_TOML);
      try {
        const ctx = ctxFor(root);
        const task = {
          id: `sync-auto-overwrite:${TARGET_REL}`,
          title: TARGET_REL,
          category: 'adapter-template-sync',
          scope: 'project' as const,
          deps: ['ensure-config'],
          status: 'needed' as const,
          default_action: 'run' as const,
          skippable: false,
          allowed_actions: ['run' as const],
          target_path: TARGET_REL,
          params: { update_policy: 'auto_overwrite' },
        };

        const first = executeInitTask(task, 'run', ctx);
        const written = path.join(root, TARGET_REL);
        assert(
          fs.readFileSync(written).equals(fs.readFileSync(path.join(FRAMEWORK_ROOT, TOML_REL))),
          '覆盖后须与模板逐字节相等',
        );
        assert.strictEqual(first.file_results?.length, 1);
        assert.strictEqual(first.file_results![0]!.targetRel, TARGET_REL);
        assert.strictEqual(first.file_results![0]!.effect, 'updated');
        assert(first.message.includes('备份'), `message 须提及备份：${first.message}`);

        const stamps = backupStamps(root);
        assert.strictEqual(stamps.length, 1, `期望恰好一个备份目录，实际 ${stamps.join(', ')}`);
        const backup = path.join(root, '.framework-backup', stamps[0]!, TARGET_REL);
        assert(fs.existsSync(backup), `备份缺失：${backup}`);
        assert.strictEqual(fs.readFileSync(backup, 'utf-8'), LEGACY_TOML, '备份内容须等于旧文件原文');

        const second = executeInitTask(task, 'run', ctx);
        assert(
          fs.readFileSync(written).equals(fs.readFileSync(path.join(FRAMEWORK_ROOT, TOML_REL))),
          '幂等：第二次执行不得改变文件',
        );
        assert.strictEqual(second.file_results?.[0]!.effect, 'unchanged');
        assert.deepStrictEqual(backupStamps(root), stamps, '幂等：不得新增备份目录');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'V3d 次位 adapter 整包物化：materialize-adapter:codex 覆盖旧 toml 前先备份（D8）',
    run: () => {
      // 宿主两份 materialized_adapters 都是 chrys/claude/codeagent/codex/cursor——codex 是次位，
      // 没有逐文件 sync 任务（plan.tasks 为空即此形态），全靠整包任务写盘。
      const root = mkTmpProject(LEGACY_TOML, ['claude', 'codex']);
      try {
        const ctx = ctxFor(root, ['claude', 'codex']);
        const task = {
          id: 'materialize-adapter:codex',
          title: '同步已选 adapter bundle: codex（幂等）',
          category: 'adapter-bundle',
          scope: 'project' as const,
          deps: ['ensure-config'],
          status: 'needed' as const,
          default_action: 'run' as const,
          skippable: false,
          allowed_actions: ['run' as const],
        };

        const first = executeInitTask(task, 'run', ctx);
        const written = path.join(root, TARGET_REL);
        assert(
          fs.readFileSync(written).equals(fs.readFileSync(path.join(FRAMEWORK_ROOT, TOML_REL))),
          '覆盖后须与模板逐字节相等',
        );
        const row = first.file_results?.find(r => r.targetRel === TARGET_REL);
        assert(row, `file_results 须含 ${TARGET_REL}：${first.message}`);
        assert.strictEqual(row!.effect, 'updated');
        assert(first.message.includes('备份'), `message 须提及备份：${first.message}`);

        const stamps = backupStamps(root);
        assert.strictEqual(stamps.length, 1, `期望恰好一个备份目录，实际 ${stamps.join(', ')}`);
        assert.strictEqual(
          fs.readFileSync(path.join(root, '.framework-backup', stamps[0]!, TARGET_REL), 'utf-8'),
          LEGACY_TOML,
          '备份内容须等于旧文件原文',
        );

        const second = executeInitTask(task, 'run', ctx);
        assert(
          fs.readFileSync(written).equals(fs.readFileSync(path.join(FRAMEWORK_ROOT, TOML_REL))),
          '幂等：第二次执行不得改变文件',
        );
        assert.strictEqual(
          second.file_results?.find(r => r.targetRel === TARGET_REL)?.effect,
          'unchanged',
        );
        assert.deepStrictEqual(backupStamps(root), stamps, '幂等：不得新增备份目录');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
  {
    name: 'V3c planner 产出 sync-auto-overwrite 任务；adapter 清单条目来自顶层 subagents',
    run: () => {
      for (const preset of [LEGACY_TOML, undefined]) {
        const root = mkTmpProject(preset);
        try {
          const plan = probeInitTaskPlan({ projectRoot: root, scope: 'project' });
          const sync = plan.tasks.find(t => t.id === `sync-auto-overwrite:${TARGET_REL}`);
          assert(sync, `缺 sync-auto-overwrite 任务（preset=${preset ? 'legacy' : 'none'}）：`
            + plan.tasks.map(t => t.id).join(', '));
          assert.strictEqual((sync!.params as { update_policy?: string } | undefined)?.update_policy, 'auto_overwrite');
          assert(
            !plan.tasks.some(t => t.id === `materialize-adapter-file:${TARGET_REL}`),
            'auto_overwrite 目标不得同时产出 materialize-adapter-file 任务',
          );
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
          clearFrameworkConfigCache();
        }
      }

      const codex = checkInitTesting.loadAdapter('codex');
      const entry = codex.templateFiles.find(f => f.targetRel === TARGET_REL);
      assert(entry, `codex templateFiles 缺 ${TARGET_REL}`);
      assert.strictEqual(entry!.kind, 'verbatim');
      assert.strictEqual(entry!.update_policy, 'auto_overwrite');
      assert(
        entry!.origin.startsWith('subagents.template_dir/'),
        `origin 须来自顶层 subagents：${entry!.origin}`,
      );

      // claude / codeagent 零 churn：仍走 commands.subagents
      for (const [name, targetRel] of [
        ['claude', '.claude/agents/verifier.md'],
        ['claude', '.claude/agents/phase-executor.md'],
        ['codeagent', '.cac/agents/verifier.md'],
        ['codeagent', '.cac/agents/phase-executor.md'],
      ] as const) {
        const f = checkInitTesting.loadAdapter(name).templateFiles.find(x => x.targetRel === targetRel);
        assert(f, `${name} templateFiles 缺 ${targetRel}`);
        assert(
          f!.origin.startsWith('commands.subagents.template_dir/'),
          `${targetRel} origin 不得变动：${f!.origin}`,
        );
      }
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
