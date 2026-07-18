// ============================================================================
// test-plan-derive-hint.unit.test.ts — 顶层 test-plan.md「测试用例」抽取 + 导航 hint
// ============================================================================

import {
  attachNavigationHints,
  buildNavigationHintForCase,
  extractTopPlanTestCasesForDeriveHint,
  type DeriveHintTestCaseRow,
} from '../../scripts/utils/test-plan-derive-hint';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PLAN_MD = [
  '# 测试计划',
  '',
  '## 测试用例',
  '',
  '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| TC-001 | 打开详情 | 已启动 app | 点击卡片 | 进入详情页 | P0 | AC-1 |',
  '| TC-002 | 返回首页 | 需先系统返回 | 手势返回 | 回到首页 | P1 | AC-2 |',
  '| 非法行 | x | y | z | w | P2 | AC-3 |',
  '',
].join('\n');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'extractTopPlanTestCasesForDeriveHint: 无「测试用例」节 → 空数组',
    run: () => {
      const rows = extractTopPlanTestCasesForDeriveHint('# 计划\n\n## 其它\n正文');
      assert(rows.length === 0, `expected empty, got ${rows.length}`);
    },
  },
  {
    name: 'extractTopPlanTestCasesForDeriveHint: 有节但无表格 → 空数组',
    run: () => {
      const rows = extractTopPlanTestCasesForDeriveHint('## 测试用例\n\n暂无用例。');
      assert(rows.length === 0, `expected empty, got ${rows.length}`);
    },
  },
  {
    name: 'extractTopPlanTestCasesForDeriveHint: 按列解析并跳过无 TC- 编号行',
    run: () => {
      const rows = extractTopPlanTestCasesForDeriveHint(PLAN_MD);
      assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
      const first = rows[0];
      assert(first.tc_id === 'TC-001', `tc_id=${first.tc_id}`);
      assert(first.name === '打开详情', `name=${first.name}`);
      assert(first.precondition === '已启动 app', `pre=${first.precondition}`);
      assert(first.steps_natural_language === '点击卡片', `steps=${first.steps_natural_language}`);
      assert(first.expected === '进入详情页', `expected=${first.expected}`);
      assert(first.priority === 'P0', `priority=${first.priority}`);
      assert(first.ac_ref === 'AC-1', `ac=${first.ac_ref}`);
    },
  },
  {
    name: 'extractTopPlanTestCasesForDeriveHint: TC 编号大小写归一化为大写',
    run: () => {
      const md = [
        '## 测试用例',
        '',
        '| 编号 | 名称 | 前置条件 | 步骤 | 预期结果 | 优先级 | 关联 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| tc-009 | 小写编号 | - | - | - | P0 | - |',
        '',
      ].join('\n');
      const rows = extractTopPlanTestCasesForDeriveHint(md);
      assert(rows.length === 1 && rows[0].tc_id === 'TC-009', `got ${JSON.stringify(rows)}`);
    },
  },
  {
    name: 'buildNavigationHintForCase: 预期进入子页 → teardown back',
    run: () => {
      const row: DeriveHintTestCaseRow = {
        tc_id: 'TC-001',
        name: 'x',
        precondition: '已启动 app',
        steps_natural_language: '点击',
        expected: '进入详情页',
        priority: 'P0',
        ac_ref: '',
      };
      const hint = buildNavigationHintForCase(row);
      assert(hint.requires_nav_reset === false, `requires=${hint.requires_nav_reset}`);
      assert(
        hint.suggested_teardown_steps.includes('{"back":{}}'),
        `teardown=${JSON.stringify(hint.suggested_teardown_steps)}`,
      );
    },
  },
  {
    name: 'buildNavigationHintForCase: 前置需返回 → requires_nav_reset + preamble back + forbidden',
    run: () => {
      const row: DeriveHintTestCaseRow = {
        tc_id: 'TC-002',
        name: 'x',
        precondition: '需先系统返回至首页',
        steps_natural_language: '手势返回',
        expected: '回到首页',
        priority: 'P1',
        ac_ref: '',
      };
      const hint = buildNavigationHintForCase(row);
      assert(hint.requires_nav_reset === true, `requires=${hint.requires_nav_reset}`);
      assert(
        hint.suggested_preamble_steps.includes('{"back":{}}'),
        `preamble=${JSON.stringify(hint.suggested_preamble_steps)}`,
      );
      assert(
        hint.forbidden_patterns.includes('swipe.horizontal.without_area'),
        `forbidden=${JSON.stringify(hint.forbidden_patterns)}`,
      );
    },
  },
  {
    name: 'buildNavigationHintForCase: 无约束 → 默认 reason',
    run: () => {
      const row: DeriveHintTestCaseRow = {
        tc_id: 'TC-003',
        name: 'x',
        precondition: '无',
        steps_natural_language: '滑动',
        expected: '列表刷新',
        priority: 'P2',
        ac_ref: '',
      };
      const hint = buildNavigationHintForCase(row);
      assert(hint.requires_nav_reset === false, `requires=${hint.requires_nav_reset}`);
      assert(hint.reason === '无额外导航约束', `reason=${hint.reason}`);
      assert(hint.suggested_teardown_steps.length === 0, `teardown=${JSON.stringify(hint.suggested_teardown_steps)}`);
    },
  },
  {
    name: 'attachNavigationHints: 逐行附加 navigation_hint 并保留原字段',
    run: () => {
      const rows = extractTopPlanTestCasesForDeriveHint(PLAN_MD);
      const withNav = attachNavigationHints(rows);
      assert(withNav.length === rows.length, `len mismatch`);
      for (const r of withNav) {
        assert(!!r.navigation_hint, `missing navigation_hint on ${r.tc_id}`);
        assert(typeof r.navigation_hint.requires_nav_reset === 'boolean', `bad hint on ${r.tc_id}`);
      }
      assert(withNav[0].tc_id === 'TC-001', `tc_id preserved`);
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
