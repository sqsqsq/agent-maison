// check-testing-traceability.unit.test.ts — c7e4a2d9 t1：acceptance_to_test_case P0 优先级对齐锚
//
// 冻结 acceptance.yaml 的 P0 优先级锚：ut_layer∈{device,both} 的每个 P0 AC 必须被至少一条
// priority=P0 的 TC 引用（复用既有 parsePlanTcEntries 解析，不另写第二套 parser）。
// 反逃逸：TC P0→P2 降档后引用仍在（普通覆盖率命中）但 P0 优先级对齐缺失 → 原地 BLOCKER FAIL。

import assert from 'assert';

import { checkAcceptanceToTestCase, checkPlanReferencesUnitLayerAc } from '../../scripts/check-testing';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const ACCEPTANCE = {
  schema_version: '1.0',
  feature: 'demo',
  criteria: [
    { id: 'AC-5', priority: 'P0', ut_layer: 'device', description: '点银行直达选择卡类型' },
    { id: 'AC-9', priority: 'P0', ut_layer: 'device', description: '选择卡类型后进结果页' },
    { id: 'AC-8', priority: 'P0', ut_layer: 'both', description: '卡包展示' },
    { id: 'AC-10', priority: 'P1', ut_layer: 'device', description: '列表半模态' },
  ],
};

function planMd(rows: string[]): string {
  return [
    '# 测试计划',
    '',
    '## 测试用例',
    '',
    '| 用例编号 | 用例名称 | 优先级 | 关联 AC |',
    '|---------|---------|--------|---------|',
    ...rows,
  ].join('\n');
}

const PLAN_OK = planMd([
  '| TC-006 | 选卡类型 | P0 | AC-5 |',
  '| TC-009 | 结果页 | P0 | AC-9 |',
  '| TC-011 | 卡包展示 | P0 | AC-8 |',
  '| TC-012 | 列表半模态 | P1 | AC-10 |',
]);

function mkCtx(plan: string | null): CheckContext {
  return {
    phase: 'testing',
    feature: 'demo',
    projectRoot: '/tmp/irrelevant',
    phaseRule: {
      traceability_checks: { acceptance_to_test_case: { description: 'AC→TC 追溯' } },
    },
    featureSpec: { feature: 'demo', acceptance: ACCEPTANCE } as unknown as CheckContext['featureSpec'],
  } as unknown as CheckContext;
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: 'c7e4a2d9：device/both P0 AC 全部被 P0 TC 引用 → PASS，details 并列普通覆盖率与 P0 优先级对齐覆盖率',
    run: () => {
      const r = checkAcceptanceToTestCase(mkCtx(PLAN_OK), PLAN_OK)[0];
      assert.strictEqual(r.status, 'PASS', r.details);
      assert.ok(r.details.includes('P0 AC 覆盖率'), r.details);
      assert.ok(r.details.includes('P0 优先级对齐覆盖率'), 'details 必须并列 P0 优先级对齐覆盖率');
      assert.ok(r.details.includes('3/3'), r.details);
    },
  },
  {
    name: 'c7e4a2d9：唯一关联 TC 从 P0 降为 P2（引用不变）→ BLOCKER FAIL（降档逃逸锚）',
    run: () => {
      const plan = planMd([
        '| TC-006 | 选卡类型 | P2 | AC-5 |',
        '| TC-009 | 结果页 | P0 | AC-9 |',
        '| TC-011 | 卡包展示 | P0 | AC-8 |',
        '| TC-012 | 列表半模态 | P1 | AC-10 |',
      ]);
      const r = checkAcceptanceToTestCase(mkCtx(plan), plan)[0];
      assert.strictEqual(r.status, 'FAIL', r.details);
      assert.ok(r.details.includes('AC-5'), r.details);
      assert.ok(r.details.includes('P0 优先级对齐覆盖率'), r.details);
    },
  },
  {
    name: 'c7e4a2d9：降档 TC 之外另有一条 P0 TC 引用同 AC → PASS（有 P0 锚即合规）',
    run: () => {
      const plan = planMd([
        '| TC-006 | 选卡类型 | P2 | AC-5 |',
        '| TC-013 | 选卡类型回归 | P0 | AC-5 |',
        '| TC-009 | 结果页 | P0 | AC-9 |',
        '| TC-011 | 卡包展示 | P0 | AC-8 |',
        '| TC-012 | 列表半模态 | P1 | AC-10 |',
      ]);
      const r = checkAcceptanceToTestCase(mkCtx(plan), plan)[0];
      assert.strictEqual(r.status, 'PASS', r.details);
    },
  },
  {
    name: 'c7e4a2d9：P0 AC 仅被 P1/P2 TC 引用（有引用但优先级不够）→ BLOCKER FAIL',
    run: () => {
      const plan = planMd([
        '| TC-006 | 选卡类型 | P1 | AC-5 |',
        '| TC-009 | 结果页 | P0 | AC-9 |',
        '| TC-011 | 卡包展示 | P0 | AC-8 |',
        '| TC-012 | 列表半模态 | P1 | AC-10 |',
      ]);
      const r = checkAcceptanceToTestCase(mkCtx(plan), plan)[0];
      assert.strictEqual(r.status, 'FAIL', r.details);
      assert.ok(r.details.includes('AC-5'), r.details);
    },
  },
  {
    name: 'c7e4a2d9：P0 AC 无任何引用 → 仍 BLOCKER FAIL（普通覆盖 + 优先级对齐双缺口）',
    run: () => {
      const plan = planMd([
        '| TC-006 | 选卡类型 | P0 | AC-5 |',
        '| TC-009 | 结果页 | P0 | AC-9 |',
        '| TC-012 | 列表半模态 | P1 | AC-10 |',
      ]);
      const r = checkAcceptanceToTestCase(mkCtx(plan), plan)[0];
      assert.strictEqual(r.status, 'FAIL', r.details);
      assert.ok(r.details.includes('AC-8'), r.details);
    },
  },

  // ------------------------------------------------------------------------
  // R8：plan_references_unit_layer_ac 分档（仅 unit → BLOCKER；混合 → WARN）
  // ------------------------------------------------------------------------
  ...unitLayerCases(),
];

// R8 夹具：AC-003=unit、AC-004=unit、AC-5=device、AC-8=both、NFR-1=性能。
const UNIT_ACCEPTANCE = {
  schema_version: '1.0',
  feature: 'demo',
  criteria: [
    { id: 'AC-003', priority: 'P0', ut_layer: 'unit', description: 'RDB 写入去重' },
    { id: 'AC-004', priority: 'P1', ut_layer: 'unit', description: 'RDB 读回排序' },
    { id: 'AC-5', priority: 'P0', ut_layer: 'device', description: '点银行直达' },
    { id: 'AC-8', priority: 'P0', ut_layer: 'both', description: '卡包展示' },
    { id: 'AC-7', priority: 'P2', description: '未声明 ut_layer（由 acceptance_ut_layer_complete 负责）' },
  ],
  boundaries: [{ id: 'BD-1', ut_layer: 'unit', description: '空库边界' }],
  performance: [{ id: 'NFR-1', metric: 'p95', target: '<800ms' }],
};

function unitCtx(): CheckContext {
  return {
    phase: 'testing',
    feature: 'demo',
    projectRoot: '/tmp/irrelevant',
    phaseRule: {
      traceability_checks: { plan_references_unit_layer_ac: { description: 'TC 仅关联 unit 层 AC' } },
    },
    featureSpec: { feature: 'demo', acceptance: UNIT_ACCEPTANCE } as unknown as CheckContext['featureSpec'],
  } as unknown as CheckContext;
}

function unitLayerCases(): Case[] {
  const run = (rows: string[]) => {
    const plan = planMd(rows);
    return checkPlanReferencesUnitLayerAc(unitCtx(), plan)[0]!;
  };
  return [
    {
      name: 'R8：TC 仅关联 unit 层 AC → BLOCKER FAIL，details 点名 TC 与 AC，并禁掉改 UT / manual 绕路',
      run: () => {
        const r = run([
          '| TC-101 | RDB 去重 | P0 | AC-003 |',
          '| TC-102 | RDB 排序+边界 | P1 | AC-004, BD-1 |',
          '| TC-103 | 点银行直达 | P0 | AC-5 |',
        ]);
        assert.strictEqual(r.status, 'FAIL', r.details);
        assert.strictEqual(r.severity, 'BLOCKER', JSON.stringify(r));
        assert.strictEqual(r.failure_kind, 'plan_contract', JSON.stringify(r));
        for (const needle of ['TC-101', 'AC-003', 'TC-102', 'AC-004', 'BD-1']) {
          assert.ok(r.details.includes(needle), `details 必须点名 ${needle}：${r.details}`);
        }
        assert.ok(!r.details.includes('TC-103'), `device 层 TC 不得被点名：${r.details}`);
        assert.match(r.details, /从 test-plan\.md 删除/, r.details);
        assert.match(r.details, /不要求修改 UT，也不能通过 manual 通道解决/, r.details);
      },
    },
    {
      name: 'R8：unit + device / unit + both 混合引用 → MINOR WARN（不是 BLOCKER）',
      run: () => {
        const r = run([
          '| TC-101 | 去重+直达 | P0 | AC-003, AC-5 |',
          '| TC-102 | 排序+卡包 | P1 | AC-004, AC-8 |',
        ]);
        assert.strictEqual(r.status, 'WARN', r.details);
        assert.strictEqual(r.severity, 'MINOR', JSON.stringify(r));
        assert.ok(r.details.includes('TC-101') && r.details.includes('AC-003'), r.details);
      },
    },
    {
      name: 'R8：unit AC + NFR 引用 → 不是 BLOCKER（性能引用只能真机量测）',
      run: () => {
        const r = run(['| TC-101 | 去重耗时 | P0 | AC-003, NFR-1 |']);
        assert.strictEqual(r.severity, 'MINOR', JSON.stringify(r));
        assert.strictEqual(r.status, 'WARN', r.details);
      },
    },
    {
      name: 'R8：空引用 / 未知引用 / 未声明 ut_layer → 本检查不裁决（PASS，交其他 trace 门）',
      run: () => {
        const r = run([
          '| TC-101 | 无关联 | P0 |  |',
          '| TC-102 | 引用不存在的 AC | P0 | AC-999 |',
          '| TC-103 | 引用未声明 ut_layer 的 AC | P2 | AC-7 |',
        ]);
        assert.strictEqual(r.status, 'PASS', r.details);
        assert.strictEqual(r.severity, 'MINOR', JSON.stringify(r));
      },
    },
    {
      // codex review P2-1：未知引用不是"混合引用"，本检查对该 TC 沉默（交 test_case_to_acceptance）
      name: 'R8：unit AC + 未知引用 → 本检查不裁决（PASS，不是 WARN）',
      run: () => {
        const r = run(['| TC-101 | 去重 | P0 | AC-003, AC-999 |']);
        assert.strictEqual(r.status, 'PASS', r.details);
        assert.strictEqual(r.severity, 'MINOR', JSON.stringify(r));
      },
    },
    {
      // codex review P2-1：未声明 ut_layer ≠ 非 unit，判 WARN 等于替 acceptance_ut_layer_complete 下结论
      name: 'R8：unit AC + 未声明 ut_layer 的 AC → 本检查不裁决（PASS）',
      run: () => {
        const r = run(['| TC-101 | 去重+未声明层级 | P0 | AC-003, AC-7 |']);
        assert.strictEqual(r.status, 'PASS', r.details);
        assert.strictEqual(r.severity, 'MINOR', JSON.stringify(r));
      },
    },
    {
      // codex review P1-2：ACCEPTANCE_ID_PATTERN 静默丢掉 AC-XYZ，过滤后的集合"看起来全是 unit"
      name: 'R8：unit AC + 不合词法引用（AC-XYZ）→ 本检查不裁决（PASS，不得判 BLOCKER）',
      run: () => {
        const r = run(['| TC-101 | 去重 | P0 | AC-003, AC-XYZ |']);
        assert.strictEqual(r.status, 'PASS', r.details);
        assert.ok(!r.details.includes('TC-101'), r.details);
      },
    },
    {
      // codex review P1-1：编号建立不了 TC-\d+ 关联时 extractTcNfrRefs 不产条目，
      // "查不到 NFR" 只是缺映射——不能据此判 BLOCKER 要求删掉性能 TC
      name: 'R8：编号无 TC-N 关联（TC-ABC）+ unit AC + NFR → 本检查不裁决（PASS）',
      run: () => {
        const r = run(['| TC-ABC | 去重耗时 | P0 | AC-003, NFR-1 |']);
        assert.strictEqual(r.status, 'PASS', r.details);
        assert.ok(!r.details.includes('TC-ABC'), r.details);
      },
    },
    {
      // codex review P2-2：BLOCKER 是"照单删除"清单，第 11 条不得被截断
      name: 'R8：11 条仅 unit TC → BLOCKER details 逐条列全，不截断',
      run: () => {
        const rows = Array.from({ length: 11 }, (_, i) => `| TC-2${String(i).padStart(2, '0')} | 去重 | P0 | AC-003 |`);
        const r = run(rows);
        assert.strictEqual(r.status, 'FAIL', r.details);
        for (let i = 0; i < 11; i++) {
          assert.ok(r.details.includes(`TC-2${String(i).padStart(2, '0')}`), `第 ${i + 1} 条被截断：${r.details}`);
        }
        assert.ok(!/还有 \d+ 项/.test(r.details) && !/\.\.\./.test(r.details), r.details);
      },
    },
  ];
}

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `check-testing-traceability: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `check-testing-traceability: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
