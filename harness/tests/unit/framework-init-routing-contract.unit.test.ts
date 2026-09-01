// framework-init-routing-contract — textual applicability contract + materialized entry consistency

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
const ROUTING_START = '<!-- framework-init-routing-contract:start -->';
const ROUTING_END = '<!-- framework-init-routing-contract:end -->';
const GATE_MARKER = '<!-- framework-init-applicability-gate -->';

const ROUTING_CASES = [
  { route: 'framework_init', input: '“首次接入 Maison 发布件并生成 framework.config”' },
  { route: 'framework_init', input: '“集成新发布件后刷新全部 adapter”' },
  { route: 'framework_init', input: '“执行 /framework-init”' },
  { route: 'continue_current_init_s2', input: '本轮真实 S1 后“计划=智能；adapter=codex,cursor”' },
  { route: 'git_l0', input: '“整理下 framework 及其衍生物并提交，不相关的别动”' },
  { route: 'git_l0', input: '“查看 framework 更新产生的 diff”' },
  { route: 'git_l0', input: '“只提交当前已暂存的 Framework，业务代码别动”' },
  { route: 'git_l0', input: '“git status 后提交，不要 push”' },
  { route: 'exit_init_to_git_l0', input: '“停止 init，只提交代码”' },
  { route: 'exit_init', input: '“不要继续刚才的 framework-init”' },
] as const;

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

function routingRows(text: string): Array<{ route: string; input: string }> {
  const start = text.indexOf(ROUTING_START);
  const end = text.indexOf(ROUTING_END);
  assert(start >= 0 && end > start, 'routing contract anchors missing/order invalid');
  return text
    .slice(start + ROUTING_START.length, end)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^- `([a-z0-9_]+)` \| (.+)$/);
      assert(match, `invalid routing contract row: ${line}`);
      return { route: match![1]!, input: match![2]! };
    });
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

function assertCommandGateFirst(text: string, label: string): void {
  const gate = text.indexOf(GATE_MARKER);
  assert(gate >= 0, `${label}: applicability gate marker missing`);
  assert(text.indexOf('canonical framework-init Skill', gate) > gate, `${label}: canonical read missing after gate`);
  for (const token of ['S0 Tier_1', 'init-readiness.mjs', 'scripts/init-orchestrate.ts']) {
    const at = text.indexOf(token);
    assert(at < 0 || gate < at, `${label}: ${token} appears before applicability gate`);
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'canonical publishes exactly ten anchored routing examples before readiness',
    run: () => {
      const canonical = fs.readFileSync(CANONICAL, 'utf8');
      const rows = routingRows(canonical);
      assert.deepStrictEqual(rows, ROUTING_CASES.map(row => ({ ...row })));
      const routeOf = (input: string) => rows.find(row => row.input === input)?.route;
      assert.strictEqual(routeOf('“停止 init，只提交代码”'), 'exit_init_to_git_l0');
      assert.strictEqual(routeOf('“不要继续刚才的 framework-init”'), 'exit_init');
      assert.notStrictEqual(routeOf('“停止 init，只提交代码”'), 'continue_current_init_s2');
      assert.notStrictEqual(routeOf('“不要继续刚才的 framework-init”'), 'framework_init');
      const gate = canonical.indexOf('## 适用性与最新意图门');
      const gateEnd = canonical.indexOf(ROUTING_END) + ROUTING_END.length;
      const readiness = canonical.indexOf('## 进入 S1 前：Tier_1 readiness');
      const probe = canonical.indexOf('init-readiness.mjs');
      assert(gate >= 0 && readiness > gate && probe > gate, 'applicability gate must precede readiness/S1');
      for (const token of ['## 前置声明', 'S1 只读探测', '只读探测 → 计划批准']) {
        const at = canonical.indexOf(token);
        assert(at > gateEnd, `${token} must appear after the complete applicability gate`);
      }
      assert(canonical.includes('不得运行 readiness、S1、planner 或 harness'), 'L0 early-exit effect missing');
      assert(canonical.includes('当前对话已实际展示本项目、本发布件、本轮 `InitTaskPlan`'), 'current S1 continuation precondition missing');
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
        assert(canonical.includes(token), `canonical init core contract missing: ${token}`);
      }
      assert(lineCount(canonical) <= 260, `canonical Skill line budget exceeded: ${lineCount(canonical)}`);
    },
  },
  {
    name: 'skills index is the single framework-init description source for checked-in entries',
    run: () => {
      const index = loadSkillsIndex(FRAMEWORK_ROOT, true);
      const expected = index.skills.find(skill => skill.id === 'framework-init')?.description.trim();
      assert(expected, 'framework-init index description missing');
      assert(expected.includes('Git/SCM') && expected.includes('L0 direct'), expected);
      assert.strictEqual(
        frontmatterDescription(read('agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md')),
        expected,
      );
      for (const rel of COMMAND_TEMPLATES) {
        const command = read(rel);
        assert.strictEqual(frontmatterDescription(command), expected, rel);
        assertCommandGateFirst(command, rel);
      }
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
    name: 'AGENTS template keeps Git/SCM direct and framework nouns do not trigger init',
    run: () => {
      const template = read('templates/AGENTS.md.template');
      assert(template.includes('Git status/diff/add/stage/commit/push'), 'Git L0 row missing');
      assert(template.includes('仅出现 framework、Framework 产物或衍生物名词不构成 framework-init 意图'), 'main-action rule missing');
      assert(lineCount(template) <= 120, `AGENTS template lines=${lineCount(template)}`);
    },
  },
  {
    name: 'actual adapter materialization preserves command and bridge routing contract',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-init-routing-'));
      const adapters = ['generic', 'chrys', 'opencode', 'codex', 'cursor', 'claude', 'codeagent'];
      try {
        fs.writeFileSync(
          path.join(root, 'framework.config.json'),
          JSON.stringify({
            schema_version: '1.1',
            project_name: 'routing-contract',
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
