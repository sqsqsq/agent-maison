// ============================================================================
// framework-init-current-turn — S4 的 turn/run 作用域回归（plan 33714d0c T6）
// ============================================================================
// 事故复述：同一 task 内，用户显式 init 产生唯一真实 run 后，下一条普通消息**零工具
// 调用、零新报告**，Agent 却逐字重播了上一轮 S4 的计数与报告路径。
//
// 本套件证明三件事：
//   1) Maison 已发布的 canonical / 三个 checked-in command 文本含 turn-local S4 约束；
//   2) 两轮 test-only transcript fixture 的事实自洽——Turn B 未选择/读取/调用 Skill、
//      无新 init run、报告集合零增量，因此不得输出 Turn A 的计数或报告路径；
//   3) `buildRunSummary` 本身只总结**传入的那份 log**——跨 turn 重播是模型行为，
//      不能错误归因给 init 内核。
//
// 证明边界（与 plan §9.2 一致）：fixture 只表示主 Agent 层的选择与结果事实。它不能
// 证明真实 Codex/Claude/Cursor/OpenCode 客户端不会误选或预加载 Skill，也不能证明模型
// 在真实长上下文中不会再次重播历史消息。Turn B 的文本**不**被 framework-init 套件读取，
// 也不为它生成任何 route/label。
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { buildRunSummary, type InitRunLog } from '../../scripts/init-orchestrate';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/framework-init-current-turn');

interface TurnFact {
  id: string;
  user_message: string;
  intent: string;
  framework_init: { selected: boolean; read: boolean; invoked: boolean };
  tool_calls: string[];
  new_init_run: null | {
    run_id: string;
    run_log_rel: string;
    summary_rel: string;
    started_at: string;
    finished_at: string;
    executed: number;
    skipped: number;
    failed: number;
  };
  reports_after_turn: string[];
  may_report_s4: boolean;
  forbidden_in_final?: string[];
  handled_by?: string;
}

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as T;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(FRAMEWORK_ROOT, rel), 'utf8');
}

const COMMAND_TEMPLATES = [
  'agents/claude/templates/commands/framework-init.md',
  'agents/codeagent/templates/commands/framework-init.md',
  'agents/cursor/templates/commands/framework-init.md',
] as const;

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'canonical 与三个显式命令都发布了 turn-local S4 约束',
    run: () => {
      const canonical = read('skills/project/framework-init/SKILL.md');
      for (const token of [
        '结果只属于当前 turn',
        'S4 只证明其 `run_log` 中 `started_at`/`finished_at`/`project_root` 对应的那次 S3 run',
        '旧 `InitTaskPlan`、run-log、summary 与 S4 只是历史上下文',
        '本 turn 未新建 S3 run/报告时',
        '禁止**宣称「本轮 init 已完成」',
        '复述旧的 executed/skipped/failed 计数',
        '把旧报告列为本轮产物',
        'task title、历史 Skill 选择与 prior S4 都不自动续入 init',
      ]) {
        assert(canonical.includes(token), `canonical current-turn 契约缺: ${token}`);
      }
      for (const rel of COMMAND_TEMPLATES) {
        const command = read(rel);
        for (const token of [
          '结果只属于当前 turn',
          'S4 只证明产生它的那次 S3 run',
          '本 turn 未新建 init run/报告时',
          '不得宣称本轮 init 已完成、复述旧计数或列出旧报告路径',
        ]) {
          assert(command.includes(token), `${rel}: current-turn 契约缺: ${token}`);
        }
      }
      // 该约束是 turn-local 文本，不得演化成运行时状态协议
      for (const token of ['nonce', 'lease', 'route_db', 'turn_token', 'session_state']) {
        assert(!canonical.includes(token), `canonical 不得引入 ${token}`);
      }
    },
  },
  {
    name: '两轮 fixture：Turn B 未选择/读取/调用 Skill、零新 run，且不得复述 Turn A 的 S4',
    run: () => {
      const doc = readFixture<{ turns: TurnFact[] }>('two-turn-transcript.json');
      assert.strictEqual(doc.turns.length, 2, 'fixture 须恰好两轮');
      const [a, b] = doc.turns as [TurnFact, TurnFact];

      // Turn A：显式 init，产生唯一新 run，可以报告 S4
      assert.strictEqual(a.intent, 'explicit_init');
      assert.strictEqual(a.framework_init.invoked, true, 'Turn A 必须真的调用了 Skill');
      assert(a.new_init_run !== null, 'Turn A 必须产生真实 run');
      assert.strictEqual(a.may_report_s4, true);
      assert.deepStrictEqual(a.reports_after_turn, [a.new_init_run!.run_id]);

      // Turn B：普通请求，三项全 false、零工具调用、零新 run、报告集合零增量
      assert.strictEqual(b.intent, 'ordinary_request');
      assert.strictEqual(b.framework_init.selected, false, 'Turn B: selected 必须为 false');
      assert.strictEqual(b.framework_init.read, false, 'Turn B: read 必须为 false');
      assert.strictEqual(b.framework_init.invoked, false, 'Turn B: invoked 必须为 false');
      assert.strictEqual(b.tool_calls.length, 0, 'Turn B 无 init 工具调用');
      assert.strictEqual(b.new_init_run, null, 'Turn B 无新 init run');
      assert.deepStrictEqual(
        b.reports_after_turn,
        a.reports_after_turn,
        'Turn B 后报告集合必须零增量',
      );
      assert.strictEqual(b.may_report_s4, false, 'Turn B 不得报告 S4');
      assert.strictEqual(b.handled_by, 'main_agent', 'Turn B 由主 Agent 正常处理');

      // 事故形态本身：Turn A 的计数与报告路径必须登记为 Turn B 的禁止输出
      const forbidden = b.forbidden_in_final ?? [];
      const run = a.new_init_run!;
      for (const token of [
        `executed=${run.executed}`,
        `skipped=${run.skipped}`,
        `failed=${run.failed}`,
        '本轮 init 已完成',
      ]) {
        assert(forbidden.includes(token), `Turn B 禁止输出清单缺: ${token}`);
      }
      assert(
        forbidden.some(t => t.includes(run.run_id)),
        'Turn B 禁止输出清单须含 Turn A 的报告目录',
      );

      // Turn B 不得"先进入 Skill 再返回"——三项 false 已排除，这里再钉死语义
      assert(
        !JSON.stringify(b).includes('exit_init') && !JSON.stringify(b).includes('route'),
        'Turn B 不得以 route/label 形态登记',
      );
    },
  },
  {
    name: '误加载 fixture：只断言零 init 副作用退出，不断言普通任务类别或后续执行',
    run: () => {
      const doc = readFixture<{
        skill_loaded_by_client: boolean;
        positive_init_intent: boolean;
        expected: Record<string, boolean>;
      }>('misload-transcript.json');
      assert.strictEqual(doc.skill_loaded_by_client, true);
      assert.strictEqual(doc.positive_init_intent, false);
      for (const key of [
        'readiness_probe_run',
        's1_probe_run',
        'planner_run',
        'harness_command_run',
        'init_report_created',
        'init_result_restated',
        'asked_whether_to_run_init',
        'asked_user_to_rephrase_invocation',
      ]) {
        assert.strictEqual(doc.expected[key], false, `误加载 fixture: ${key} 必须为 false`);
      }
      assert.strictEqual(doc.expected.skill_stopped_before_any_init_command, true);
      // 只证明"零副作用退出"：fixture 的**字段名**里不得出现分类/路由/结果概念，
      // 也不得声明普通任务的类别或后续执行（那属于主 Agent，不在本 fixture 射程内）。
      const keys = [
        ...Object.keys(doc as unknown as Record<string, unknown>),
        ...Object.keys(doc.expected),
      ];
      for (const forbidden of ['route', 'label', 'taxonomy', 'handled_by', 'outcome', 'category']) {
        assert(
          !keys.some(k => k.toLowerCase().includes(forbidden)),
          `误加载 fixture 不得声明字段 ${forbidden}（实得 keys=${keys.join(',')}）`,
        );
      }
    },
  },
  {
    name: 'buildRunSummary 只总结传入的那份 log——跨 turn 重播不是 init 内核行为',
    run: () => {
      const mk = (stamp: string, executed: number): InitRunLog => ({
        schema_version: '1.0',
        scope: 'project',
        started_at: `${stamp}T00:00:00.000Z`,
        finished_at: `${stamp}T00:00:10.000Z`,
        decision_mode: 'smart',
        mode: 'update',
        entries: Array.from({ length: executed }, (_, i) => ({
          task_id: `task-${i}`,
          action: 'run',
          status: 'executed' as const,
          message: 'ok',
        })),
      });

      const first = buildRunSummary(mk('2099-01-01', 3), { runLogPath: '/reports/A/run-log.json' });
      const second = buildRunSummary(mk('2099-01-02', 1), { runLogPath: '/reports/B/run-log.json' });

      assert(first.includes('executed=3'), first);
      assert(first.includes('/reports/A/run-log.json'), first);
      assert(second.includes('executed=1'), second);
      assert(second.includes('/reports/B/run-log.json'), second);
      // 第二份摘要里不得出现第一份的任何计数或路径（内核无跨 run 记忆）
      assert(!second.includes('executed=3'), '摘要不得携带上一 run 的计数');
      assert(!second.includes('/reports/A/'), '摘要不得携带上一 run 的报告路径');
      assert(second.includes('2099-01-02T00:00:00.000Z'), '摘要须反映本次 run 的时间戳');
      assert(!second.includes('2099-01-01'), '摘要不得携带上一 run 的时间戳');
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
