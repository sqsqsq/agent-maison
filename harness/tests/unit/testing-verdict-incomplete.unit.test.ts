// ============================================================================
// testing-verdict-incomplete.unit.test.ts — testing 阶段「设备不可用→INCOMPLETE」终态
// 对齐 UT 版（ut-verdict-incomplete），并落实 Codex P2：
//   INCOMPLETE 仅在 device_test_install externalBlocked 是唯一 BLOCKER FAIL 时成立；
//   依赖门禁保留 producer 已知的设备外因，不应破坏 INCOMPLETE；独立内容缺件仍须修复。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { resolveVerdictFromChecks, generateScriptReport } from '../../scripts/utils/report-generator';
import { checkReportTraceReconciliation } from '../../scripts/check-testing';
import { executeCheck } from '../../scripts/utils/check-execution';
import { writeRunSummaryBase } from '../../harness-runner';
import { classifyFailureKind } from '../../scripts/utils/goal-failure-classifier';
import { classifyPhaseVerdict } from '../../scripts/utils/phase-transition-policy';
import { setupGoalRuntimeHost } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache } from '../../config';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';
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

function reconciliationSkip(external = true, report: string | null = '# report exists'): CheckResult[] {
  const ctx = { phaseRule: { structure_checks: {} }, resolvedProfile: { capabilities: {} } } as unknown as CheckContext;
  const pipeline = { installPassed: false, installExternallyBlocked: external } as Parameters<typeof checkReportTraceReconciliation>[2];
  return executeCheck(ctx, () => checkReportTraceReconciliation(ctx, report, pipeline), 'report_trace_reconciliation');
}

function testIncompleteWhenCompilePassDeviceBlocked(): void {
  const checks: CheckResult[] = [buildPass(), installExternalBlocked()];
  assert(resolveVerdictFromChecks(checks) === 'INCOMPLETE', 'expected INCOMPLETE');
}

function testIncompleteSurvivesBlockerSkip(): void {
  // 真实 producer 透传已知装机外因；普通缺件不能仅因另有设备问题而被掩盖。
  const checks: CheckResult[] = [
    buildPass(),
    installExternalBlocked(),
    ...reconciliationSkip(),
  ];
  assert(resolveVerdictFromChecks(checks) === 'INCOMPLETE', 'expected INCOMPLETE despite BLOCKER SKIP');
  const { root } = setupGoalRuntimeHost('codex');
  try {
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const report = generateScriptReport('', 'testing', 'bc-openCard', root, checks, frameworkRoot);
    report.assurance = 'full';
    const summary = writeRunSummaryBase(root, report, frameworkRoot);
    assert(summary.verdict === 'INCOMPLETE' && summary.completion_status === 'INCOMPLETE', 'report and summary must retain external incompleteness');
    assert(summary.blocking_skips[0]?.blocking_class === 'externalBlocked', 'summary preserves dependency cause');
    assert(classifyFailureKind(summary) === 'external_block', 'runtime keeps device cause, not content/framework');
    assert(classifyPhaseVerdict({ phase: 'testing', verdict: summary.verdict, blocking_class: checks[1].blocking_class,
      failure_kind: checks[1].failure_kind }) === 'defer_external_and_continue_if_allowed', 'runtime policy retains original device defer');
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

function testFailWhenStaticBlockerCoexists(): void {
  // device 不是唯一 BLOCKER FAIL（有真实静态问题）→ FAIL，不得 INCOMPLETE。
  const checks: CheckResult[] = [
    buildPass(),
    installExternalBlocked(),
    ...reconciliationSkip(),
    { id: 'ui_entry_coverage', category: 'structure', description: 'coverage', severity: 'BLOCKER', status: 'FAIL', details: 'P0 入口缺覆盖' },
  ];
  assert(resolveVerdictFromChecks(checks) === 'FAIL', 'expected FAIL when static blocker coexists');
}

function testUnclassifiedSkipPreservesLegacyVerdict(): void {
  assert(resolveVerdictFromChecks([buildPass(), ...reconciliationSkip(false)]) === 'PASS', 'unclassified SKIP retains the original verifier review path');
  assert(resolveVerdictFromChecks([buildPass(), installExternalBlocked(), ...reconciliationSkip(true, null)]) === 'INCOMPLETE', 'unclassified report SKIP does not override the known device blocker');
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'INCOMPLETE when build pass + testing device blocked', fn: testIncompleteWhenCompilePassDeviceBlocked },
    { name: 'INCOMPLETE survives report_trace_reconciliation BLOCKER SKIP (P2)', fn: testIncompleteSurvivesBlockerSkip },
    { name: 'FAIL when a static blocker coexists with device block (P2)', fn: testFailWhenStaticBlockerCoexists },
    { name: 'unclassified report/install SKIP keeps the legacy verdict and known device cause', fn: testUnclassifiedSkipPreservesLegacyVerdict },
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
