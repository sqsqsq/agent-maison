// ============================================================================
// testing-verdict-incomplete.unit.test.ts — testing 阶段「设备不可用→INCOMPLETE」终态
// 对齐 UT 版（ut-verdict-incomplete），并落实 Codex P2：
//   INCOMPLETE 仅在 device_test_install externalBlocked 是唯一 BLOCKER FAIL 时成立；
//   依赖门禁（report_trace_reconciliation 等）的 BLOCKER SKIP 不计 verdict，不应破坏 INCOMPLETE。
// ============================================================================

import { resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function buildPass(): CheckResult {
  return { id: 'device_test_build', category: 'structure', description: 'build', severity: 'BLOCKER', status: 'PASS', details: 'ok' };
}

function installExternalBlocked(): CheckResult {
  return {
    id: 'device_test_install',
    category: 'structure',
    description: 'install',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: 'no device/emulator',
    failure_kind: 'device_blocked',
    blocking_class: 'externalBlocked',
  };
}

function testIncompleteWhenCompilePassDeviceBlocked(): void {
  const checks: CheckResult[] = [buildPass(), installExternalBlocked()];
  assert(resolveVerdictFromChecks(checks) === 'INCOMPLETE', 'expected INCOMPLETE');
}

function testIncompleteSurvivesBlockerSkip(): void {
  // Codex P2：report_trace_reconciliation 在 install 未过时判 BLOCKER SKIP，
  // BLOCKER SKIP 不计入 verdict 统计 → 仍应 INCOMPLETE，而非被拖成 FAIL。
  const checks: CheckResult[] = [
    buildPass(),
    installExternalBlocked(),
    { id: 'report_trace_reconciliation', category: 'structure', description: 'recon', severity: 'BLOCKER', status: 'SKIP', details: 'install 未过，跳过对账' },
  ];
  assert(resolveVerdictFromChecks(checks) === 'INCOMPLETE', 'expected INCOMPLETE despite BLOCKER SKIP');
}

function testFailWhenStaticBlockerCoexists(): void {
  // device 不是唯一 BLOCKER FAIL（有真实静态问题）→ FAIL，不得 INCOMPLETE。
  const checks: CheckResult[] = [
    buildPass(),
    installExternalBlocked(),
    { id: 'ui_entry_coverage', category: 'structure', description: 'coverage', severity: 'BLOCKER', status: 'FAIL', details: 'P0 入口缺覆盖' },
  ];
  assert(resolveVerdictFromChecks(checks) === 'FAIL', 'expected FAIL when static blocker coexists');
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'INCOMPLETE when build pass + testing device blocked', fn: testIncompleteWhenCompilePassDeviceBlocked },
    { name: 'INCOMPLETE survives report_trace_reconciliation BLOCKER SKIP (P2)', fn: testIncompleteSurvivesBlockerSkip },
    { name: 'FAIL when a static blocker coexists with device block (P2)', fn: testFailWhenStaticBlockerCoexists },
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
