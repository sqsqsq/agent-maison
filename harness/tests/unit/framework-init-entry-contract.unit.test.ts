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
    name: 'D0.2 AGENTS template and entry docs hand the candidate to the machine, not to hand-written bindings',
    run: () => {
      // 主 Agent 的职责收到四项；候选由 --prepare-scope 生成。四份入口文本里不得再出现
      // 任何「手写」来源 / 指纹的表述——那正是 D0.2 要消除的东西。
      const template = read('templates/AGENTS.md.template');
      for (const token of ['--prepare-scope', '完成终点', '请求结果', '--requested-phases', '影响判断']) {
        assert(template.includes(token), `AGENTS 模板缺 D0.2 四项职责要素: ${token}`);
      }
      const entryTexts = [
        template,
        read('docs/operations/project-entry.md'),
        read('skills/project/goal-mode/SKILL.md'),
        read('skills/project/change-unit-progression/SKILL.md'),
      ];
      for (const text of entryTexts) {
        assert(!text.includes('手写'), '入口文本仍在提「手写」来源/指纹');
      }
      for (const text of entryTexts.slice(1)) {
        assert(text.includes('--prepare-scope'), '入口文档未指向候选生成入口');
      }
    },
  },
  {
    name: 'AGENTS 模板：普通请求由主 Agent 负责，framework-init 不是全局 preflight/public gate',
    run: () => {
      const template = read('templates/AGENTS.md.template');
      for (const token of [
        '**普通请求由主 Agent 负责**',
        'framework-init 仅用于明确安装、更新、配置或 adapter 物化意图',
        '产物提及 framework 不构成 init 意图',
        'init-next-steps 是可选建议',
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
  // ==========================================================================
  // 单职责路径入口指引（plan a9f3c7d2 第一笔 · R1/R3/R4/R6）
  // --------------------------------------------------------------------------
  // 锚词选取规则（改文档时先读这段，别直接删断言）：
  //   · 默认只锁**语义承诺**的最短可辨识词，不锁整句、不锁标点、不锁段落顺序——换句式不该红，删承诺才该红；
  //   · **两处例外（R4 禁止语、R3 能力缺口停止承诺）改为整句逐字锁定**：这两条是「禁止 / 停止」语义，
  //     短词锚被连续三种语义反转绕过（不要停在该处 / 不能不裸调 / 不建议用户避免运行），
  //     故按裁决改成 `includes` 原句比对——**改这两句措辞必须同步改本文件的常量**；
  //   · 每条锚附 why，指明它在锁需求哪一条；后人要删时先回答「这条需求还成立吗」；
  //   · 结构性断言优先于文字断言。
  // 需求：.cursor/requirement/需求_单职责路径从入口到执行的衔接_宿主验收回灌.md
  // ==========================================================================
  {
    name: 'entry routing states both the scope question and the acceptance-semantics question',
    run: () => {
      const template = read('templates/AGENTS.md.template');
      const section = template.slice(template.indexOf('### 4.0 需求路由'), template.indexOf('### 4.0.1'));
      assert(section.length > 0, '模板缺 §4.0 需求路由节');
      // R1：判类必须先后回答「范围」与「验收语义」两问；缺任一即回到事故当时的单判据。
      for (const anchor of ['范围', '验收语义', '不改实现']) {
        assert(section.includes(anchor), `AGENTS 模板 §4.0 缺两问锚词: ${anchor}（需求 R1 第一条）`);
      }
      // R1：project-entry 与模板同源，不能只改一处。
      const entry = read('docs/operations/project-entry.md');
      for (const anchor of ['范围', '验收语义']) {
        assert(entry.includes(anchor), `project-entry 未与模板同步两问: ${anchor}（需求 R1 验收第二条）`);
      }
    },
  },
  {
    name: 'entry routing tells the agent to check existing basis before asking',
    run: () => {
      const template = read('templates/AGENTS.md.template');
      const section = template.slice(template.indexOf('### 4.0 需求路由'), template.indexOf('### 4.0.1'));
      // R1：先查已有依据（acceptance / 蓝图 / catalog / 约束知识），查完仍缺才只就该缺口问。
      for (const anchor of ['先查已有依据', 'acceptance', '只就该缺口']) {
        assert(section.includes(anchor), `AGENTS 模板 §4.0 缺「先查依据再问」锚词: ${anchor}（需求 R1 第二、三条）`);
      }
      const entry = read('docs/operations/project-entry.md');
      assert(entry.includes('先查已有依据'), 'project-entry 缺「先查已有依据」（需求 R1 验收第二条）');
    },
  },
  {
    name: 'compile and test verification is routed to the framework executor in the entry and the skills',
    run: () => {
      const template = read('templates/AGENTS.md.template');
      const coding = read('skills/feature/coding/SKILL.md');
      const ut = read('skills/feature/business-ut/SKILL.md');
      // R4：入口与两份技能都要说「经框架执行器、不裸调 hvigor、不引导用户跑宿主脚本」。
      // **整句逐字锁定**（第二轮代码 review 裁决）：正则版被连续三种语义反转绕过——
      // 「不要停在该处」被通配区吞掉、「不能不裸调」从内层起匹配、「不建议用户避免运行」把禁止关系反转。
      // 跟正则打地鼠是打不完的；这里改成从原文取整个分句 includes 比对。
      // **能保证的**：锁定句内部字节一旦改变（前插「不能不…」、改词、删字）即失配。
      // **不保证的**：在锁定句之外另起一句推翻它（例如后面补「以下情形不适用」），本断言看不出来——
      // 那属于全文语义的人工 review 范围，不在 smoke 射程内（第三轮代码 review 的已知上限）。
      // 三份文件的这句话已统一为完全相同的措辞，故只需一条常量。
      const R4_EXECUTOR_SENTENCE =
        '任何需要编译或跑测试的校验一律经框架执行器（专项 request CLI 或 `harness-runner --phase`）；不裸调 hvigor，也不引导用户去运行宿主自带脚本。';
      for (const [label, text] of [['AGENTS 模板', template], ['coding SKILL', coding], ['business-ut SKILL', ut]] as const) {
        assert(
          text.includes(R4_EXECUTOR_SENTENCE),
          `${label} 缺 R4 禁止语原句（需求 R4 第一、二条）。期望逐字包含：\n${R4_EXECUTOR_SENTENCE}`,
        );
      }
      assert(template.includes('framework.local.json'), 'AGENTS 模板未写明执行器派生工具链环境的理由（需求 R4 第一条）');
      // R4 裁决：工具链确认是「执行入口」，诊断是它之后的事——两者不得互换。
      for (const [label, text] of [['coding SKILL', coding], ['business-ut SKILL', ut]] as const) {
        assert(text.includes('check-personal-setup.ts --json --ensure'), `${label} 缺工具链确认的执行入口（需求 R4 裁决第二段）`);
        assert(text.includes('envProbe'), `${label} 缺同次 metadata 诊断口径（需求 R4 第二条）`);
        assert(text.includes('当前值'), `${label} 未把重新解析出来的值标为「当前值」（需求 R4 第二条）`);
      }
      assert(coding.includes('框架当前不提供即时编译校验'), 'coding SKILL 缺第三段路径的如实报告措辞（需求 R4 裁决）');
      // 「不引导用户去运行宿主自带脚本」已并进上面那条整句常量里，不再单独用正则锁（正则版被
      // 「不建议用户避免运行宿主自带脚本」这种反转绕过，第二轮代码 review 反例 3）。
    },
  },
  {
    name: 'review / UT / testing standalone sections state inputs, landing points and profile capability',
    run: () => {
      const review = read('skills/feature/code-review/SKILL.md');
      const ut = read('skills/feature/business-ut/SKILL.md');
      const testing = read('skills/feature/device-testing/SKILL.md');
      // 结构性断言优先：三份专项技能都必须链到同一份 request CLI 文档。
      for (const [label, text] of [['code-review', review], ['business-ut', ut], ['device-testing', testing]] as const) {
        assert(text.includes('docs/operations/request-harness.md'), `${label} 未链到 request CLI 文档（需求 R3 第一条）`);
        assert(text.includes('--prepare-request'), `${label} 未告知准备期入口（需求 R3 第三条）`);
      }
      // R3：hmos UT 只执行已配置模块 src/ohosTest/ 下的 Hypium 用例；能力缺口如实停在该处。
      assert(ut.includes('src/ohosTest/'), 'business-ut 未写明合法落点（需求 R3 第一条）');
      assert(ut.includes('Hypium'), 'business-ut 未写明当前 profile 实际执行什么（需求 R3 第一条）');
      // R3 第二条的核心是**停止**语义。同样**整句逐字锁定**：正则版的通配区会把
      // 「不要停在该处」这种反转吞掉（第二轮代码 review 反例 1）。这一句同时覆盖
      // 「不改投其它目录」「不用其它模块的通过代替」两条承诺，故不再单独断言。
      const UT_CAPABILITY_STOP_SENTENCE = '报 profile 能力缺口时**如实停在该处**，不改投其它目录、不用其它模块的通过代替。';
      assert(
        ut.includes(UT_CAPABILITY_STOP_SENTENCE),
        `business-ut 缺「能力缺口 → 停在该处」原句（需求 R3 第二条）。期望逐字包含：\n${UT_CAPABILITY_STOP_SENTENCE}`,
      );
      // R3：testing 写明用例须含可执行步骤与预期结果。
      assert(testing.includes('可执行步骤'), 'device-testing 缺「可执行步骤」（需求 R3 第一条）');
      assert(testing.includes('预期结果'), 'device-testing 缺「明确预期结果」（需求 R3 第一条）');
      // R3：review 的输入与报告落点。
      assert(review.includes('report-dir'), 'code-review 未写明报告落点（需求 R3 第一条）');
      assert(review.includes('targets.files'), 'code-review 未写明专项输入（需求 R3 第一条）');
    },
  },
  {
    name: 'ut skill requires announcing a test-carrier or build-config change before making it',
    run: () => {
      const ut = read('skills/feature/business-ut/SKILL.md');
      // R3 新增条款：补测试载体 / 改模块构建配置属范围外改动——「先说明」与「得到认可」两句都要在，
      // 只锁前者的话，删掉「得到认可后再做」仍能通过（第一轮 codex 必修 3）。
      for (const anchor of ['测试载体', 'build-profile', '先向用户说明', '得到认可']) {
        assert(ut.includes(anchor), `business-ut 缺范围外改动约定锚词: ${anchor}（需求 R3 第三条）`);
      }
      // 反向锚：这条沿用既有「范围外改动先说明」约定，不得新增确认点 id。
      assert(!/ut\.carrier_confirm|ut\.scope_confirm/.test(ut), 'business-ut 新增了确认点 id（需求 R3 第三条明确不新增确认点机制）');
    },
  },
  {
    name: 'single-duty skills declare the request endpoint',
    run: () => {
      // R5：spec / plan / coding 三份技能都要写明「只做本职责、在请求终点停止、不冒充 Feature 整体完成、
      // 不自动追加后续阶段」。三处措辞统一，故同样**整句逐字锁定**（与 R4 同一口径）。
      const SINGLE_DUTY_SENTENCE =
        '**单职责终点**：入口只请求本阶段时，只做本职责、在请求终点停止；不冒充 Feature 整体完成，也不自动追加后续阶段（完成判定由冻结范围决定）。';
      for (const rel of ['skills/feature/spec/SKILL.md', 'skills/feature/plan/SKILL.md', 'skills/feature/coding/SKILL.md']) {
        assert(read(rel).includes(SINGLE_DUTY_SENTENCE), `${rel} 缺单职责终点原句（需求 R5 第一条）。期望逐字包含：\n${SINGLE_DUTY_SENTENCE}`);
      }
    },
  },
  {
    name: 'ut skill states the expectation-provenance step',
    run: () => {
      const ut = read('skills/feature/business-ut/SKILL.md');
      // R2：四步可执行动作 + **判别句**（现状记载不构成来源依据）+ 逐条标注位置。
      for (const anchor of [
        '读具体条目', '区分现状描述与授权要求', '逐类核对', '逐条登记或标注',
        '不构成来源依据', 'characterization', '// expectation:',
      ]) {
        assert(ut.includes(anchor), `business-ut 缺预期来源步骤锚词: ${anchor}（需求 R2 第一条）`);
      }
      // 判别句是这一段的要害：现状记载类条目不得当授权预期——整句逐字锁定。
      const PROVENANCE_RULE =
        '**catalog / 源码注释 / 既有测试 / 实现代码这类「记载当前是什么」的条目不构成来源依据**';
      assert(ut.includes(PROVENANCE_RULE), `business-ut 缺判别句原句（需求 R2 裁决）。期望逐字包含：\n${PROVENANCE_RULE}`);
      // 「标注写在每条断言自己身上、文件头/describe 不算」同样是承诺，不是措辞。
      const NO_INHERIT =
        '**写在 `describe(` 上或文件头的总括注释不算登记**（框架不做作用域继承，`/* */` 块注释也不算）';
      assert(ut.includes(NO_INHERIT), `business-ut 缺「无作用域继承」原句（需求 R2）。期望逐字包含：\n${NO_INHERIT}`);
      // 应当失败的断言必须保留失败——这条是「不为跑绿改期望」的文字面。
      assert(ut.includes('应当失败的断言保留失败与原因'), 'business-ut 缺「保留真实失败」承诺（需求 R2 第二条）');
    },
  },
  // ==========================================================================
  // plan 7e1d4b93（主 Agent 前置责任与交付授权延续）——**十条整句常量**
  // --------------------------------------------------------------------------
  // 为什么全部整句、不用短锚：短锚挡不住**句内反转**（codex 第一轮 B3 实证——把
  // 「可以并行」改成「不可以并行」、「不强迫建蓝图或 Feature」改成「必须建蓝图和
  // Feature」，短锚版照绿）。故本批每条必要承诺都用整句 `includes` 比对，沿用上方
  // `R4_EXECUTOR_SENTENCE` 的做法。**改这些措辞必须同步改本文件常量。**
  //
  // 射程：只证明「这十条常量还逐字在文档里、常量**内部**没被删改或反转」。常量之外
  // 的文字改动、以及 S6 两个标记串所在句子的语义，都不在射程内（留人工审 diff / 宿主
  // 观察点 H1–H5）。
  // 需求：.cursor/requirement/需求_主Agent前置责任与交付授权延续_宿主开卡回灌.md
  // ==========================================================================
  {
    name: 'the entry states the principal agent precondition duty',
    run: () => {
      // R1：主责任**含首句**。codex 第二轮阻断：常量若从「同一交付单元……」起笔，
      // 把首句改成「不必把本次请求接入对应执行路径。」全部常量仍匹配——核心责任被
      // 反转而 smoke 不红。故首句必须在常量里。
      const PRINCIPAL_DUTY_SENTENCE =
        '**主 Agent 的前置责任**：把本次请求接入对应执行路径。同一交付单元的下游产出必须以**已具备的上游依据和有效范围**为输入——不得边补前置边提前施工，不得要求设计追认已写好的实现。';
      const REUSE_HANDBACK_SENTENCE = '已有有效输入与证据按规则复用，缺口交回责任方。';
      for (const rel of ['templates/AGENTS.md.template', 'docs/operations/project-entry.md']) {
        const text = read(rel);
        assert(text.includes(PRINCIPAL_DUTY_SENTENCE), `${rel} 缺主 Agent 前置责任原句（需求 R1 第一条）。期望逐字包含：\n${PRINCIPAL_DUTY_SENTENCE}`);
        assert(text.includes(REUSE_HANDBACK_SENTENCE), `${rel} 缺「复用 / 交回责任方」原句（需求 R1 第一条）。期望逐字包含：\n${REUSE_HANDBACK_SENTENCE}`);
      }
    },
  },
  {
    name: 'delegation does not exempt the principal agent',
    run: () => {
      // R5 与 R1 分成两条常量、两条用例：合并成一条同样挡得住删改（整句 includes 一样会红），
      // 分开是为了**定位**——红的时候直接看出是 R1 的责任句还是 R5 的委派句被动了。
      const DELEGATION_SENTENCE =
        '**委派不豁免你**：子 Agent 的边界是它那个 Skill 的边界，不解除你自己的前置责任。';
      for (const rel of ['templates/AGENTS.md.template', 'docs/operations/project-entry.md']) {
        assert(read(rel).includes(DELEGATION_SENTENCE), `${rel} 缺「委派不豁免」原句（需求 R5）。期望逐字包含：\n${DELEGATION_SENTENCE}`);
      }
    },
  },
  {
    name: 'the entry separates the scope candidate from the freeze',
    run: () => {
      // R2：三个关键承诺必须同时在 §4.0 节内。要把入口写成「prepare-scope 冻结范围」，
      // 必须先删掉其中一句 → 红。
      // **不锁**「候选写入 feature.yaml」「核对范围投影」「完整命令行」这些步骤细节——
      // 完整步骤由模板正文承载、由宿主观察点 H1 核验。
      const template = read('templates/AGENTS.md.template');
      const section = template.slice(template.indexOf('### 4.0 需求路由'), template.indexOf('### 4.0.1'));
      assert(section.length > 0, '模板缺 §4.0 需求路由节');
      const DESIGN_HANDOFF_SENTENCE =
        '**设计交接**（admitted blueprint + ready CU）是范围候选的输入——蓝图与 CU 不是可并行赶的文书，是范围的来源';
      const CANDIDATE_NOT_FREEZE_SENTENCE = '**`--prepare-scope` 只生成候选、不冻结范围**';
      const FIRST_PHASE_FREEZE_SENTENCE = '**首次阶段调用**冻结 feature 级范围记录并核对候选指纹';
      for (const [why, sentence] of [
        ['设计交接是候选的输入（需求 R2 第二条）', DESIGN_HANDOFF_SENTENCE],
        ['候选与冻结分清，不得写成 prepare-scope 冻结范围（需求 R2 第一条）', CANDIDATE_NOT_FREEZE_SENTENCE],
        ['冻结发生在首次阶段调用（需求 R2 第一条）', FIRST_PHASE_FREEZE_SENTENCE],
      ] as const) {
        assert(section.includes(sentence), `AGENTS 模板 §4.0 缺原句：${why}。期望逐字包含：\n${sentence}`);
      }
    },
  },
  {
    name: 'the entry states the three preparation boundaries',
    run: () => {
      // R1 第二条：三条边界各自独立成句，逐句锁定——避免制造「任何事都必须先跑六阶段」，
      // 也避免单处句内反转绕过。
      const template = read('templates/AGENTS.md.template');
      const section = template.slice(template.indexOf('### 4.0 需求路由'), template.indexOf('### 4.0.1'));
      const BOUNDARY_PARALLEL_SENTENCE =
        '**准备工作（读代码、看截图、查依据）可以并行**，禁的只是依赖未满足就提前施工。';
      const BOUNDARY_LOCAL_REQUEST_SENTENCE =
        '**局部 review / UT / testing 请求**走各自的 request 准备路径，不强迫建蓝图或 Feature；**无 Feature 的独立测试请求，落笔写测试之前先跑 `--prepare-request` 确认落点与载体**；**已有 Feature/CU 上下文的测试沿其有效范围和阶段入口执行**，不得把正式交付中的测试拆成独立请求。';
      const BOUNDARY_RESUME_SENTENCE =
        '**恢复已有任务**复用既有有效范围与证据，不因本节重跑完整链。';
      for (const [why, sentence] of [
        ['准备工作可并行（需求 R1 边界①）', BOUNDARY_PARALLEL_SENTENCE],
        ['局部请求走各自准备路径 + 写测试前先 --prepare-request（需求 R1 边界② / task_d09f8f18）', BOUNDARY_LOCAL_REQUEST_SENTENCE],
        ['恢复已有任务复用有效范围（需求 R1 边界③）', BOUNDARY_RESUME_SENTENCE],
      ] as const) {
        assert(section.includes(sentence), `AGENTS 模板 §4.0 缺边界原句：${why}。期望逐字包含：\n${sentence}`);
      }
      // project-entry 侧锁的是**时点半句**，不只是命令名。
      // 措辞用「落笔写测试之前」而非「动手写之前」：后者含子串「手写」，会踩中既有
      // `D0.2 …` 用例对「手写来源/指纹」的全文禁词断言（:304）。语义时点不变，
      // 不去削弱那条既有断言（偏离登记见 plan §10）。
      const PREPARE_REQUEST_TIMING = '**落笔写测试之前先跑 `--prepare-request` 确认落点与载体**';
      assert(
        read('docs/operations/project-entry.md').includes(PREPARE_REQUEST_TIMING),
        `project-entry 缺「写之前先跑 --prepare-request」时点半句（需求 R1 边界②）。期望逐字包含：\n${PREPARE_REQUEST_TIMING}`,
      );
    },
  },
  {
    name: 'full delivery authority continues to the endpoint',
    run: () => {
      // R4：整句含「既有确认点」五项枚举——删掉枚举或反转前半句都会失配。
      // **只锁「授权延续到终点」这一句**；「建 run 具体怎么做」由模板 §4.0 的上下文说明承载。
      const AUTHORITY_CONTINUATION_SENTENCE =
        '**用户已授权完整交付时，走完这条链到完成终点是主 Agent 自己的事**——不把正式闭环当收尾时可再问一次的可选项，仍须询问的只有既有确认点（真实授权、策展语义、预算、外部不可逆动作、设计缺口澄清）。';
      const template = read('templates/AGENTS.md.template');
      const section = template.slice(template.indexOf('### 4.0 需求路由'), template.indexOf('### 4.0.1'));
      assert(section.includes(AUTHORITY_CONTINUATION_SENTENCE), `AGENTS 模板 §4.0 缺交付授权延续原句（需求 R4）。期望逐字包含：\n${AUTHORITY_CONTINUATION_SENTENCE}`);
      assert(read('docs/operations/project-entry.md').includes(AUTHORITY_CONTINUATION_SENTENCE), `project-entry 缺交付授权延续原句（需求 R4）。期望逐字包含：\n${AUTHORITY_CONTINUATION_SENTENCE}`);
    },
  },
  {
    name: 'the freeze wording is mirrored in the downstream docs',
    run: () => {
      // R2 第三条：三份下游文档同步。**结构性断言，措辞如实**——只防这两个标记串被删，
      // **不证明**三处口径一致、也不证明这些句子的语义正确（句式随各文件上下文，
      // 无法整句同源；语义一致留人工审 diff）。
      for (const rel of [
        'docs/operations/project-entry.md',
        'MIGRATION.md',
        'skills/project/change-unit-progression/SKILL.md',
      ]) {
        const text = read(rel);
        for (const marker of ['首次阶段调用', '只生成候选、不冻结范围']) {
          assert(text.includes(marker), `${rel} 未与入口同步冻结口径标记: ${marker}（需求 R2 第三条）`);
        }
      }
    },
  },
  {
    name: 'standalone request skills add no verifier round',
    run: () => {
      // 需求 R2 末条 / §4 第 4 条：不给专项测试新增 verifier 环节。
      for (const rel of [
        'skills/feature/code-review/SKILL.md',
        'skills/feature/business-ut/SKILL.md',
        'skills/feature/device-testing/SKILL.md',
      ]) {
        const text = read(rel);
        assert(!/专项.{0,12}新增.{0,6}verifier|为专项测试.{0,10}verifier/.test(text), `${rel} 出现为专项测试新增 verifier 的表述`);
      }
    },
  },
  {
    // plan e7a2c4f1 §3.7（G29）：模式正确的 harness 调用指引须在三处已发布文本同时在场
    // （Skill / operations / phase-executor 模板）——少一处，agent 就会在另一条路径上照旧误传。
    name: 'P3-T16 published guidance gives the mode-correct harness call and the two boundary sentences',
    run: () => {
      const carriers = [
        'skills/project/goal-mode/SKILL.md',
        'skills/reference/goal-mode-operations.md',
        'agents/claude/templates/agents/phase-executor.md',
      ] as const;
      for (const rel of carriers) {
        const text = read(rel);
        assert(text.includes('模式不匹配'), `${rel} 缺「模式不匹配」这条模式误用判词`);
        assert(/detach/i.test(text), `${rel} 未点名 detached 模式`);
        assert(text.includes('入口拒绝 ≠ 执行了测试'), `${rel} 缺「入口拒绝 ≠ 执行了测试」边界句`);
      }
      // 两句边界至少在 operations 与模板两处完整在场（Skill 主干受行数预算约束，只承载模式判词）
      for (const rel of ['skills/reference/goal-mode-operations.md',
        'agents/claude/templates/agents/phase-executor.md'] as const) {
        assert(read(rel).includes('部分检查通过 ≠ 完整上游验证'),
          `${rel} 缺「部分检查通过 ≠ 完整上游验证」边界句`);
      }
      // detached 的可执行命令形式必须写出来，且写明不带 --goal-* 参数
      const ops = read('skills/reference/goal-mode-operations.md');
      assert(ops.includes('npx ts-node harness-runner.ts --phase <phase> --feature <feature>'),
        'operations 缺 detached 模式可直接执行的 harness 命令');
      assert(ops.includes('这组参数是 attended 专用'),
        'operations 未写明 --goal-* 是 attended 专用（detached 不带）');
      // codex review 建议 6：`docs-authoring-lint` 只给 SKILL.md 通用 150 行预算，
      // reference/ 与 agent 模板没有机器预算。§3.7 要求"原位改句、不加长"，用既有
      // lineCount 把两处钉在当前基线上（要加长须连同这里一起裁决）。
      const docBudget: ReadonlyArray<readonly [string, number]> = [
        ['skills/reference/goal-mode-operations.md', 225],
        ['agents/claude/templates/agents/phase-executor.md', 50],
      ];
      for (const [rel, budget] of docBudget) {
        const lines = lineCount(read(rel));
        assert(lines <= budget, `${rel} 行数 ${lines} 超出预算 ${budget}——§3.7 要求原位改句不加长`);
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
