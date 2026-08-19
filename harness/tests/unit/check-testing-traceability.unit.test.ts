// check-testing-traceability.unit.test.ts — c7e4a2d9 t1：acceptance_to_test_case P0 优先级对齐锚
//
// 冻结 acceptance.yaml 的 P0 优先级锚：ut_layer∈{device,both} 的每个 P0 AC 必须被至少一条
// priority=P0 的 TC 引用（复用既有 parsePlanTcEntries 解析，不另写第二套 parser）。
// 反逃逸：TC P0→P2 降档后引用仍在（普通覆盖率命中）但 P0 优先级对齐缺失 → 原地 BLOCKER FAIL。

import assert from 'assert';

import { checkAcceptanceToTestCase } from '../../scripts/check-testing';
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
];

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
