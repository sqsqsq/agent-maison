// ============================================================================
// ut-verdict-incomplete.unit.test.ts — INCOMPLETE verdict 判定
// ============================================================================

import { resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import type { CheckResult } from '../../scripts/utils/types';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function deviceBlockedTest(): CheckResult {
  return {
    id: 'ut_hvigor_test',
    category: 'structure',
    description: 'test',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: 'no device',
    failure_kind: 'device_blocked',
    blocking_class: 'externalBlocked',
  };
}

function testIncompleteWhenCompilePassDeviceBlocked(): void {
  const checks: CheckResult[] = [
    {
      id: 'ut_hvigor_build',
      category: 'structure',
      description: 'build',
      severity: 'BLOCKER',
      status: 'PASS',
      details: 'ok',
    },
    deviceBlockedTest(),
  ];
  assert(resolveVerdictFromChecks(checks) === 'INCOMPLETE', 'expected INCOMPLETE');
}

function testFailWhenOtherBlockersPresent(): void {
  const checks: CheckResult[] = [
    {
      id: 'ut_hvigor_build',
      category: 'structure',
      description: 'build',
      severity: 'BLOCKER',
      status: 'PASS',
      details: 'ok',
    },
    deviceBlockedTest(),
    {
      // plan f7045213 第二批：原用 it_name_has_ac_or_branch_tag，它已登记为披露（账本与形状），不再是"其它阻断"；
      // 换成未登记的真实覆盖门，语义不变。
      id: 'ut_case_per_unit_ac',
      category: 'traceability',
      description: 'coverage',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'AC 未覆盖',
    },
  ];
  assert(resolveVerdictFromChecks(checks) === 'FAIL', 'expected FAIL');
  // 已登记为披露的命名门与设备阻塞并存：仍是 INCOMPLETE（披露不算其它阻断）
  const withDisclosed: CheckResult[] = [checks[0], checks[1], { ...checks[2], id: 'it_name_has_ac_or_branch_tag', details: 'bad name' }];
  assert(resolveVerdictFromChecks(withDisclosed) === 'INCOMPLETE', 'disclosed naming gate must not turn device-blocked INCOMPLETE into FAIL');
}

function testPassWhenNoBlockers(): void {
  assert(resolveVerdictFromChecks([]) === 'PASS', 'expected PASS');
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'INCOMPLETE when compile pass + device blocked', fn: testIncompleteWhenCompilePassDeviceBlocked },
    { name: 'FAIL when other blockers coexist', fn: testFailWhenOtherBlockersPresent },
    { name: 'PASS when no blockers', fn: testPassWhenNoBlockers },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
