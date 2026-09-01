// ============================================================================
// framework-init-entry-contract — framework-init 纯正向入口的**已发布文本**契约
// ============================================================================
// 证明边界（plan 33714d0c §9.2，测试命名与失败信息须与之一致）：
//
//   本套件能证明——Maison 发布了纯正向 description、无名称的误加载零副作用退出、
//   turn-local S4 文本；七类 adapter 的物化字节共享同一 canonical/描述；init 生产
//   代码里没有 route map/parser/状态机/env key。
//
//   本套件**不能**证明——真实 Codex / Claude / Cursor / OpenCode 客户端一定按该文本
//   正确处理任意自然语言，也不能证明客户端不会为普通请求误选或预加载 framework-init。
//   那属于客户端选择算法与模型长上下文行为，不在 Maison 已发布字节的射程内。
//
// 因此：这里只做**精确文本断言**与真实物化对比，不写自然语言关键词分类函数，不维护
// 第二份 route 表，也不把普通请求登记成本 Skill 的正常输入用例。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import { loadSkillsIndex } from '../../scripts/utils/resolve-skill-path';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const CANONICAL = path.join(FRAMEWORK_ROOT, 'skills/project/framework-init/SKILL.md');
const GATE_MARKER = '<!-- framework-init-applicability-gate -->';

/** 负向 discovery token：description 出现任一即判红（plan 33714d0c §6.1） */
const FORBIDDEN_DISCOVERY_TOKENS = ['Git', 'SCM', 'status', 'diff', 'add', 'stage', 'commit', 'push'] as const;

const COMMAND_TEMPLATES = [
  'agents/claude/templates/commands/framework-init.md',
  'agents/codeagent/templates/commands/framework-init.md',
  'agents/cursor/templates/commands/framework-init.md',
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(FRAMEWORK_ROOT, rel), 'utf8');
}

function frontmatterDescription(text: string): string {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(block, 'frontmatter missing');
  const parsed = YAML.parse(block[1]!) as { description?: unknown };
  const description = parsed.description;
  assert.strictEqual(typeof description, 'string', 'description missing');
  return String(description).trim();
}

function lineCount(text: string): number {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n').length
    : normalized.split('\n').length;
}

function minimalArchitecture(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

function materializeAdapter(root: string, adapter: string, materialized: string[]): void {
  const layout = detectRepoLayout(path.join(__dirname, '../..'));
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
    materializedAdapters: materialized,
  };
  executeInitTask(
    {
      id: `materialize-adapter:${adapter}`,
      title: `物化 adapter: ${adapter}`,
      category: 'adapter-bundle',
      scope: 'project',
      deps: ['ensure-config'],
      status: 'needed',
      default_action: 'run',
      skippable: false,
      allowed_actions: ['run'],
      params: { adapter },
    },
    'run',
    ctx,
  );
}

/** 显式入口薄命令：gate 在任何 init 命令之前，且承载零副作用退出 + turn 作用域 */
function assertCommandGateFirst(text: string, label: string): void {
  const gate = text.indexOf(GATE_MARKER);
  assert(gate >= 0, `${label}: applicability gate marker missing`);
  assert(text.indexOf('canonical framework-init Skill', gate) > gate, `${label}: canonical read missing after gate`);
  for (const token of ['S0 Tier_1', 'init-readiness.mjs', 'scripts/init-orchestrate.ts']) {
    const at = text.indexOf(token);
    assert(at < 0 || gate < at, `${label}: ${token} appears before applicability gate`);
  }
  for (const token of [
    '显式 `/framework-init` 直接进入 canonical Tier_1 readiness→S1，S3 仍须 S2 批准',
    '明确取消只终止尚未完成的 init，不产生 S3/报告',
    '立即停止、零 init 副作用',
    '不运行 readiness/S1/planner/harness',
    '不询问是否执行 init',
    '普通任务由主 Agent 正常处理',
    'S4 只证明产生它的那次 S3 run',
    '不得宣称本轮 init 已完成',
  ]) {
    assert(text.includes(token), `${label}: entry contract missing: ${token}`);
  }
  // 旧两轮 Git taxonomy 的交接文案不得以任何形态回归
  for (const forbidden of [
    'Git/其它主动作',
    '最新获授权主动作',
    '明确有序多动作',
    'Git L0',
    'Git-only',
    '若结果为 Git/SCM L0 或退出 init，立即返回',
  ]) {
    assert(!text.includes(forbidden), `${label}: retired Git handoff wording remains: ${forbidden}`);
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'canonical 只声明正向入口 / 真实 S1 continuation / 明确取消，且不含任何 route 机制',
    run: () => {
      const canonical = fs.readFileSync(CANONICAL, 'utf8');

      // (1) 正向进入条件五条 + S3 仍须 S2
      for (const token of [
        '## 适用性（先于任何 init 指令）',
        '用户明确选择或调用 framework-init',
        '用户明确要求首次接入 Maison 发布件',
        '用户明确要求创建、补齐或迁移 `framework.config.json`',
        '用户明确要求集成新发布件后刷新 config、adapters 或 materialized artifacts',
        '直接进入 Tier_1 readiness→S1',
        'S3 仍须 S2 批准',
      ]) {
        assert(canonical.includes(token), `canonical 正向入口缺: ${token}`);
      }

      // (2) 真实 S1 continuation 的前置事实（裸批准不触发）
      assert(
        canonical.includes('当前对话已展示本项目、本发布件、本轮 `InitTaskPlan` 与 adapter 选项'),
        'current S1 continuation precondition missing',
      );
      assert(
        canonical.includes('尚未完成**的 S1 给出合法 plan/adapters 批准（裸 `计划=…；adapter=…` 不触发）'),
        'bare approval must not trigger init',
      );

      // (3) 明确取消只停 init
      assert(
        canonical.includes('用户明确取消时只终止当前尚未完成的 init，不产生 S3/报告'),
        'explicit cancellation contract missing',
      );

      // (4) 不是全局 router；普通请求不选择/读取/经过
      for (const token of [
        '不是全局请求路由、preflight 或 public gate',
        '不选择、不读取、不经过本 Skill',
        '不解释、分类、命名或交还这些任务',
        '由主 Agent 理解顺序',
      ]) {
        assert(canonical.includes(token), `canonical 职责边界缺: ${token}`);
      }

      // (5) 误加载兜底：无名称、零副作用、位置在 readiness/S1/harness 之前
      for (const token of [
        '立即停止本 Skill，零 init 副作用',
        '不运行 readiness、S1、planner、harness 或任何 init 工具',
        '不生成、复述或链接 init 结果',
        '不追问是否执行 init',
      ]) {
        assert(canonical.includes(token), `误加载兜底缺: ${token}`);
      }
      const gate = canonical.indexOf('## 适用性（先于任何 init 指令）');
      const gateEnd = canonical.indexOf('## 前置声明');
      const readiness = canonical.indexOf('## 进入 S1 前：Tier_1 readiness');
      const probe = canonical.indexOf('init-readiness.mjs');
      assert(gate >= 0 && gateEnd > gate, 'applicability section boundaries invalid');
      assert(readiness > gateEnd && probe > gateEnd, '适用性必须先于 readiness / S1 探测命令');
      for (const token of ['S1 只读探测', '只读探测 → 计划批准']) {
        assert(canonical.indexOf(token) > gateEnd, `${token} must appear after the applicability section`);
      }

      // (6) 原 init 内核未被误删
      for (const token of [
        '解析 stdout **`InitTaskPlan` JSON**',
        '**`init.task_plan`**',
        '**`init.materialized_adapters`**',
        '**`init.task_decision`**',
        '--decision-file',
        '--smart-auto',
        '## S4. 摘要',
        'buildRunSummary',
      ]) {
        assert(canonical.includes(token), `canonical init 内核缺: ${token}`);
      }

      // (7) 两轮错误优化的全部效果必须清零：route 表/锚点/label/Git-only 优先级
      for (const forbidden of [
        'framework-init-routing-contract',
        'exit_init_continue_git_l0',
        'git_l0_then_framework_init',
        'continue_current_init_s2',
        'return_to_current_task',
        'current_task_then_framework_init',
        'exit_init',
        'framework_init',
        'Git-only',
        'Git L0',
        '最新意图门',
        // 普通任务负向枚举（哪怕只是"举例"）＝重新建立排除 taxonomy，plan 明令禁止
        '问答、改码、review、文档、版本控制',
        '普通请求（',
      ]) {
        assert(!canonical.includes(forbidden), `canonical 不得残留 route 机制: ${forbidden}`);
      }
      assert(!/ROUTING_CASES/.test(canonical), 'canonical 不得出现 route 用例表');

      // (8) 行数预算不得提高
      assert(lineCount(canonical) <= 260, `canonical Skill line budget exceeded: ${lineCount(canonical)}`);
    },
  },
  {
    name: 'skills index 是 framework-init description 唯一 SSOT，且只含正向动作',
    run: () => {
      const index = loadSkillsIndex(FRAMEWORK_ROOT, true);
      const expected = index.skills.find(skill => skill.id === 'framework-init')?.description.trim();
      assert(expected, 'framework-init index description missing');

      // 正向范围四要素
      for (const token of [
        '显式选择或调用 framework-init',
        '首次接入 Maison 发布件',
        'framework.config',
        'adapters',
      ]) {
        assert(expected.includes(token), `description 缺正向要素: ${token}（实得：${expected}）`);
      }
      // 八个负向 discovery token 严格拒绝
      for (const token of FORBIDDEN_DISCOVERY_TOKENS) {
        assert(
          !expected.toLowerCase().includes(token.toLowerCase()),
          `description 不得含负向 discovery token「${token}」：${expected}`,
        );
      }

      // bridge 与三个 checked-in command frontmatter 逐字相等
      assert.strictEqual(
        frontmatterDescription(read('agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md')),
        expected,
      );
      for (const rel of COMMAND_TEMPLATES) {
        const command = read(rel);
        assert.strictEqual(frontmatterDescription(command), expected, rel);
        assertCommandGateFirst(command, rel);
      }

      // 不得回归第二份 description map / frontmatter parser
      const pathSource = read('harness/scripts/utils/agent-bundle-paths.ts');
      assert(!pathSource.includes('BUILTIN_SKILL_BRIDGE_DESCRIPTIONS'), 'parallel description map regrew');
      const materializer = read('harness/scripts/utils/materialize-agent-bundle-skills.ts');
      assert(materializer.includes('resolveSkillDescription'), 'materializer must consume skills index description');
      const executor = read('harness/scripts/utils/init-task-executor.ts');
      assert(
        /renderBridgeSkillStubMarkdown\([\s\S]*?resolved\.skillMdRepoRel,[\s\S]*?fwRoot,/.test(executor),
        'goal-mode special materialization must pass the current fwRoot explicitly',
      );
    },
  },
  {
    name: 'AGENTS 模板：普通请求由主 Agent 负责，framework-init 不是全局 preflight/public gate',
    run: () => {
      const template = read('templates/AGENTS.md.template');
      for (const token of [
        '**普通请求由主 Agent 负责**',
        '不是**全局请求路由、preflight 或 public gate',
        '仅出现 framework、Framework 产物或衍生物名词不构成 init 意图',
        '先完成 X，到明确 init 动作时才调用',
      ]) {
        assert(template.includes(token), `AGENTS 模板缺: ${token}`);
      }
      // 删除的 Git 专用枚举 / 优先级 / handoff 不得回归
      for (const forbidden of [
        'Git status/diff/add/stage/commit/push',
        'Git-only',
        'Git/SCM 主动作保持 L0',
        '只退出 init 子流程',
        'push 授权',
      ]) {
        assert(!template.includes(forbidden), `AGENTS 模板不得残留 Git taxonomy: ${forbidden}`);
      }
      assert(lineCount(template) <= 120, `AGENTS template lines=${lineCount(template)}`);
    },
  },
  {
    name: '入口文本与 init 生产代码都没有 router / route state / 普通任务分类',
    run: () => {
      const entryText = [
        read('skills/project/framework-init/SKILL.md'),
        read('skills/skills.index.yaml'),
        read('templates/AGENTS.md.template'),
        read('skills/README.md'),
        ...COMMAND_TEMPLATES.map(read),
      ].join('\n');
      for (const token of [
        'FRAMEWORK_INIT_ROUTE',
        'framework_init_route_state',
        'framework_init_route_token',
        'framework_init_route_lease',
        'process.env',
        'child_process',
        'git status --porcelain',
        'git rev-parse',
      ]) {
        assert(!entryText.includes(token), `forbidden route mechanism appeared: ${token}`);
      }
      assert(!/\brouter\b/i.test(entryText), 'keyword router must not enter production entry text');

      // 生产代码侧：init 三件套不得出现 route/label/宿主 gitignore 机制
      for (const rel of [
        'harness/scripts/check-init.ts',
        'harness/scripts/utils/init-task-planner.ts',
        'harness/scripts/utils/init-task-executor.ts',
        'harness/scripts/init-orchestrate.ts',
      ]) {
        const src = read(rel);
        for (const token of [
          'exit_init',
          'git_l0',
          'ROUTING_CASES',
          'ensureCanonicalGitignore',
          'canonical-gitignore',
          'CHECK_INIT_SKIP_GITIGNORE_SYNC',
        ]) {
          assert(!src.includes(token), `${rel} 不得残留 ${token}`);
        }
      }
    },
  },
  {
    name: '真实物化：七类 adapter 入口共享同一正向 description 与 canonical 契约',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-init-entry-'));
      const adapters = ['generic', 'chrys', 'opencode', 'codex', 'cursor', 'claude', 'codeagent'];
      try {
        fs.writeFileSync(
          path.join(root, 'framework.config.json'),
          JSON.stringify({
            schema_version: '1.1',
            project_name: 'entry-contract',
            materialized_adapters: adapters,
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          }, null, 2),
          'utf8',
        );
        clearFrameworkConfigCache();
        for (const adapter of adapters) materializeAdapter(root, adapter, adapters);
        const expected = loadSkillsIndex(FRAMEWORK_ROOT, true).skills
          .find(skill => skill.id === 'framework-init')!.description.trim();
        const bridges = [
          '.agents/skills/framework-init/SKILL.md',
          '.opencode/skill/framework-init/SKILL.md',
          '.codex/skills/framework-init/SKILL.md',
          '.cursor/skills/framework-init/SKILL.md',
        ];
        for (const rel of bridges) {
          assert.strictEqual(frontmatterDescription(fs.readFileSync(path.join(root, rel), 'utf8')), expected, rel);
        }
        for (const rel of [
          '.claude/commands/framework-init.md',
          '.cac/commands/framework-init.md',
          '.cursor/commands/framework-init.md',
        ]) {
          const command = fs.readFileSync(path.join(root, rel), 'utf8');
          assert.strictEqual(frontmatterDescription(command), expected, rel);
          assertCommandGateFirst(command, rel);
        }
        // 物化不得顺手创建宿主 SCM 配置
        assert(!fs.existsSync(path.join(root, '.gitignore')), '物化不得创建宿主 .gitignore');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        clearFrameworkConfigCache();
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(testCase => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).stack ?? (error as Error).message };
    }
  });
}
