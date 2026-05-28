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
      id: 'it_name_has_ac_or_branch_tag',
      category: 'traceability',
      description: 'naming',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'bad name',
    },
  ];
  assert(resolveVerdictFromChecks(checks) === 'FAIL', 'expected FAIL');
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
