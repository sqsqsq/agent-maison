/**
 * testing-trace-gates — unit tests for Hylyre outcome gate & report reconciliation.
 */

import * as assert from 'assert';
import {
  evaluateHylyreRunOutcome,
  parseReportExecutionRows,
  reconcileReportWithDeviceTestTiming,
  reconcileReportWithHylyreTrace,
  evaluateUiEntryCoverage,
  parseReportExecutionResults,
  parseReportConclusionVerdict,
  buildEntryUiPriorityMap,
} from '../../scripts/utils/testing-trace-gates';
import { __testing_checkReportReconcileOnlyPipeline } from '../../scripts/check-testing';
import { resolveFeatureArtifact } from '../../config';
import { extractTables, getSectionContent } from '../../scripts/utils/markdown-parser';
import type { HylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { computeHapBuildFingerprint, computeHapSha256Full } from '../../../profiles/hmos-app/harness/build-fingerprint';
import { parseCaseDurationsFromLogAndTrace } from '../../../profiles/hmos-app/harness/device-test-timings';
import type { UseCasesSpec } from '../../scripts/utils/types';

import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void | Promise<void> }> = [];

function test(name: string, run: () => void | Promise<void>): void {
  CASES.push({ name, run });
}

function loadVendoredTraceGolden(name: string): Record<string, any> {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const file = path.resolve(
    __dirname,
    '../../../profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden/trace/valid',
    name,
  );
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, any>;
}

function reportOnlyGoldenTrace(): Record<string, any> {
  // 只改宿主 identity；outcome/selector/三轴/tool_calls 形状逐字来自冻结 golden。
  const trace = loadVendoredTraceGolden('all-passed.json');
  trace.feature = 'demo';
  trace.cases[0].id = 'TC-001';
  trace.cases[0].name = 'demo';
  trace.cases[0].ac_ref = 'AC-1';
  for (const call of trace.tool_calls as Array<Record<string, unknown>>) call.case = 'TC-001';
  return trace;
}

interface ReportOnlyFixture {
  root: string;
  reportsDir: string;
  tracePath: string;
  hapPath: string;
  buildAt: string;
  installAt: string;
  runStartedAt: string;
  runEndedAt: string;
  timingGeneratedAt: string;
  hapBuiltAt: string;
  reportPath: string;
  timingPath: string;
}

function makeReportOnlyFixture(): ReportOnlyFixture {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-reconcile-only-'));
  const featureDir = path.join(root, 'doc', 'features', 'demo', 'testing');
  const reportsDir = path.join(featureDir, 'reports');
  const runDir = path.join(reportsDir, '20260830T010000Z-001', 'hylyre');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(featureDir, { recursive: true });

  // plan 5e1c7a93 D3：派生统计可被 trace+meta 重建，重建产物的 generated_at 是**当下**。
  // 夹具时间必须落在过去（生产里 run_ended_at 恒在过去），否则重建反而制造时序倒挂。
  const t0 = Date.now() - 60_000;
  const buildAt = new Date(t0).toISOString();
  const installAt = new Date(t0 + 1000).toISOString();
  const runStartedAt = new Date(t0 + 2000).toISOString();
  const runEndedAt = new Date(t0 + 3000).toISOString();
  const timingGeneratedAt = new Date(t0 + 4000).toISOString();
  const hapPath = path.join(root, 'entry-signed.hap');
  fs.writeFileSync(hapPath, 'final-hap-bytes');
  fs.utimesSync(hapPath, new Date(t0 - 100), new Date(t0 - 100));
  const hapStat = fs.statSync(hapPath);
  const hapBuiltAt = new Date(hapStat.mtimeMs).toISOString();
  const tracePath = path.join(runDir, 'trace.json');
  const reportPath = path.join(runDir, 'test-report.md');
  const logPath = path.join(runDir, 'device-test-run.log');
  const timingPath = path.join(reportsDir, 'device-test-timing.json');

  fs.writeFileSync(path.join(featureDir, 'test-plan.md'), [
    '## 测试用例', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| TC-001 | demo | app | tap | pass | P0 | AC-001 |',
  ].join('\n'));
  fs.writeFileSync(path.join(featureDir, 'test-report.md'), [
    '## 一、测试概览', '',
    '### 真机流水线耗时', '',
    '| 阶段 | 耗时 | 说明 |', '| --- | --- | --- |',
    '| 打包 (hvigor) | 120ms | fresh; reused=false |',
    '| 装机 (hdc) | 50ms | fresh; reused=false |',
    '| Hylyre 自动化 | 500ms | 含设备预启动 |',
    '| 快照写入 (page save) | 10ms | 非致命 |',
    '| **合计（脚本统计）** | **—** | harness 各阶段之和 |', '',
    '| 元数据 | 值 |', '| --- | --- |',
    `| HAP 落盘时间 (hapBuiltAt) | ${hapBuiltAt} |`,
    `| 本次 harness 跑 build 门禁时刻 | ${buildAt} |`, '',
    '## 二、测试执行结果', '',
    '| 用例编号 | 用例名称 | 优先级 | 执行状态 | 耗时 | 备注 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| TC-001 | demo | P0 | 通过 | 250ms | |', '',
    '## 五、结论', '', '**测试结论**: 达标',
  ].join('\n'));
  fs.writeFileSync(path.join(runDir, 'test-plan.hylyre.md'), [
    '## 测试用例清单', '',
    '| 用例编号 | 用例名称 | 测试步骤 |', '| --- | --- | --- |',
    '| TC-001 | demo | {"touch":{"by_id":"tab_wallet"}}; {"wait_for":{"by_id":"success_title"}} |',
  ].join('\n'));
  // report-only 正例必须直接穿过发布件自带 golden，禁止再手拼一份“看起来像 v1”的 trace。
  fs.writeFileSync(tracePath, JSON.stringify(reportOnlyGoldenTrace()));
  fs.writeFileSync(reportPath, '# Hylyre report\n');
  fs.writeFileSync(logPath, 'final run log\n');
  fs.writeFileSync(path.join(reportsDir, 'device-test-build.result.json'), JSON.stringify({
    reused: false, hvigorExitCode: 0, hvigorDurationMs: 120,
    hapPath, hapMtimeMs: hapStat.mtimeMs, hapBuiltAt, timestamp: buildAt,
  }));
  fs.writeFileSync(path.join(reportsDir, 'hvigor-app-build.meta.json'), JSON.stringify({ durationMs: 120 }));
  fs.writeFileSync(path.join(reportsDir, 'device-test-install.meta.json'), JSON.stringify({
    ok: true, exitCode: 0, durationMs: 50, hapPath, reused: false,
    hapMtimeMs: hapStat.mtimeMs, hapSizeBytes: hapStat.size,
    hapSha256: computeHapBuildFingerprint(hapPath),
    timestamp: installAt,
  }));
  fs.writeFileSync(path.join(reportsDir, 'device-test-run.meta.json'), JSON.stringify({
    ok: true, exit_code: 0, trace_path: tracePath, report_path: reportPath, log_path: logPath,
    run_started_at: runStartedAt, run_ended_at: runEndedAt, ran_at: runEndedAt,
    run_duration_ms: 500,
    hylyre_page_save: { attempted: true, exit_code: 0, duration_ms: 10 },
  }));
  fs.writeFileSync(timingPath, JSON.stringify({
    schema_version: '1.0', feature: 'demo', generated_at: timingGeneratedAt,
    pipeline: {
      build_ms: 120, build_reused: false, install_ms: 50, install_reused: false,
      hylyre_run_ms: 500, page_save_ms: 10, total_harness_ms: null, hap_built_at: hapBuiltAt,
    },
    cases: [{ id: 'TC-001', duration_ms: 250, step_count: 2 }],
  }));
  return {
    root, reportsDir, tracePath, hapPath, buildAt, installAt, runStartedAt,
    runEndedAt, timingGeneratedAt, hapBuiltAt, reportPath, timingPath,
  };
}

function reportOnlyContext(root: string): import('../../scripts/utils/types').CheckContext {
  return {
    phase: 'testing', feature: 'demo', projectRoot: root,
    phaseRule: { structure_checks: { report_reconcile_only: { description: 'report-only' } } },
    resolvedProfile: { capabilities: {} },
  } as unknown as import('../../scripts/utils/types').CheckContext;
}

// plan a6c4e9f2 T4 返修：以下两条原本用 legacy（0.2-p4）+ 中文 case status 做判据，
// 其中"全部中文『通过』→ verdict=pass"直接把必须废止的 legacy 回落钉成了正例。
// v1 里中文 status 是**派生投影**，可以与 steps 完全脱节；拿它当独立事实源正是
// plan T5 第 20 条点名要消灭的那条路径。现在 legacy 一律 fail，且不产出任何计数。
test('evaluateHylyreRunOutcome: legacy trace 一律 fail，且不得凭中文 status 产出计数', () => {
  const trace: HylyreTrace = {
    schema_version: '0.2-p4',
    feature: 'f',
    phase: 'testing',
    outcome: 'partial',
    cases: [
      { id: 'TC-001', status: '通过' },
      { id: 'TC-004', status: '失败' },
    ],
  };
  const r = evaluateHylyreRunOutcome(trace);
  assert.strictEqual(r.verdict, 'fail');
  assert.ok(
    r.reasonLines.some(l => l.includes('hylyre.step-outcome/1')),
    `拒绝理由必须点明结果协议，实际：${JSON.stringify(r.reasonLines)}`,
  );
  // 关键：不得从中文 status 反推出"1 通过 1 失败"这类计数——那等于承认它是事实源。
  assert.strictEqual(r.passedCount, 0);
  assert.strictEqual(r.failedCount, 0);
});

test('evaluateHylyreRunOutcome: legacy 全部中文「通过」也不得返回 pass', () => {
  const trace: HylyreTrace = {
    schema_version: '0.2-p4',
    feature: 'f',
    phase: 'testing',
    outcome: 'success',
    cases: [{ id: 'TC-001', status: '通过' }],
  };
  const r = evaluateHylyreRunOutcome(trace);
  assert.strictEqual(r.verdict, 'fail', 'legacy trace 不得闭合 run outcome');
  assert.strictEqual(r.passedCount, 0);
});

test('reconcileReportWithHylyreTrace: fake success report vs partial trace', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-recon-'));
  const hylyreDir = path.join(dir, '20260101-120000', 'hylyre');
  fs.mkdirSync(hylyreDir, { recursive: true });
  const tracePath = path.join(hylyreDir, 'trace.json');
  fs.writeFileSync(
    tracePath,
    JSON.stringify({
      schema_version: '0.2-p4',
      feature: 'f',
      phase: 'testing',
      outcome: 'partial',
      cases: [
        { id: 'TC-001', status: '失败' },
        { id: 'TC-004', status: '失败' },
      ],
    }),
  );

  const report = [
    '## 测试执行结果',
    '',
    '| 用例编号 | 执行状态 |',
    '| --- | --- |',
    '| TC-001 | 通过 |',
    '| TC-004 | 通过 |',
    '',
    '## 结论',
    '',
    '本次测试达标。',
  ].join('\n');

  const recon = reconcileReportWithHylyreTrace(report, tracePath);
  assert.strictEqual(recon.ok, false);
  assert.ok(recon.mismatches.some(m => m.includes('TC-001')));
  assert.ok(tracePath.replace(/\\/g, '/').includes('/hylyre/trace.json'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseReportExecutionResults: extracts TC statuses', () => {
  const report = [
    '## 测试执行结果',
    '',
    '| 用例编号 | 执行状态 |',
    '| --- | --- |',
    '| TC-001 | 通过 |',
  ].join('\n');
  const m = parseReportExecutionResults(report);
  assert.strictEqual(m.get('TC-001'), '通过');
});

test('parseReportExecutionRows: report duration uses integer Nms and reads comma grouping', () => {
  const comma = [
    '## 测试执行结果', '',
    '| 用例编号 | 执行状态 | 耗时 |', '| --- | --- | --- |',
    '| TC-001 | 通过 | 1,234ms |',
  ].join('\n');
  assert.strictEqual(parseReportExecutionRows(comma)[0]?.durationMs, 1234);

  const seconds = comma.replace('1,234ms', '1.2s');
  assert.strictEqual(parseReportExecutionRows(seconds)[0]?.durationMs, null);
  const timing = {
    schema_version: '1.0' as const,
    feature: 'demo',
    generated_at: '2026-08-30T01:00:04.000Z',
    pipeline: {
      build_ms: 0, build_reused: true, install_ms: 0, install_reused: true,
      hylyre_run_ms: 1, page_save_ms: 0, total_harness_ms: null, hap_built_at: null,
    },
    cases: [{ id: 'TC-001', duration_ms: 1234, step_count: 1 }],
  };
  const recon = reconcileReportWithDeviceTestTiming(seconds, { timing });
  assert.ok(!recon.ok && recon.mismatches.some(m => m.includes('TC-001')));
});

// plan 5e1c7a93 D3：legacy `0.3-p0` 的 cost 分配分支里，日志没有对应 cost 行的 case =
// **没量到**（duration_ms=null），报告格写 `—`；这与 v1 分支 `steps=[]` 求和得 0 的
// **正确的 0** 是两回事（v1 分支一行不改，见下一个用例）。
test('trace pass+skip: legacy 无 cost 行的 skip case 记 null（不是 0ms），报告 — 占位对账通过', () => {
  const timingCases = parseCaseDurationsFromLogAndTrace(
    'uidriver.touch cost: 1.234s\n',
    {
      tool_calls: [{ case: 'TC-001' }],
      cases: [{ id: 'TC-001', status: '通过' }, { id: 'TC-002', status: '跳过' }],
    },
  );
  assert.deepStrictEqual(timingCases, [
    { id: 'TC-001', duration_ms: 1234, step_count: 1 },
    { id: 'TC-002', duration_ms: null, step_count: 0 },
  ]);
  const timing: import('../../../profiles/hmos-app/harness/device-test-timings').DeviceTestTimingDocument = {
    schema_version: '1.0', feature: 'demo', generated_at: '2026-08-30T01:00:04.000Z',
    pipeline: {
      build_ms: 0, build_reused: true, install_ms: 0, install_reused: true,
      hylyre_run_ms: 1234, page_save_ms: 0, total_harness_ms: null, hap_built_at: null,
    },
    cases: timingCases,
  };
  const report = [
    '## 一、测试概览', '', '### 真机流水线耗时', '',
    '| 阶段 | 耗时 | 说明 |', '| --- | --- | --- |',
    '| 打包 (hvigor) | 0ms | reused=true |',
    '| 装机 (hdc) | 0ms | reused=true |',
    '| Hylyre 自动化 | 1234ms | |',
    '| 快照写入 (page save) | 0ms | |',
    '| **合计（脚本统计）** | **—** | |', '',
    '| 元数据 | 值 |', '| --- | --- |', '| HAP 落盘时间 (hapBuiltAt) | — |', '',
    '## 二、测试执行结果', '',
    '| 用例编号 | 执行状态 | 耗时 |', '| --- | --- | --- |',
    '| TC-001 | 通过 | 1234ms |', '| TC-002 | 跳过 | — |',
  ].join('\n');
  const recon = reconcileReportWithDeviceTestTiming(report, { timing });
  assert.deepStrictEqual(recon, { ok: true, mismatches: [] });
});

// plan b3d7e5a1 E（当前 change tasks 6.7c）：writer 恒写 total_harness_ms=null，模板已明示
// "合计填 —，不得自行加总"。钉住：把各阶段加总填成 Nms 必须被判"应为无数据占位"。
test('pipeline 合计：timing total_harness_ms=null 时报告合计加总成 Nms 被拒，— 占位通过', () => {
  const timing: import('../../../profiles/hmos-app/harness/device-test-timings').DeviceTestTimingDocument = {
    schema_version: '1.0', feature: 'demo', generated_at: '2026-08-30T01:00:04.000Z',
    pipeline: {
      build_ms: 100, build_reused: false, install_ms: 50, install_reused: false,
      hylyre_run_ms: 1234, page_save_ms: 0, total_harness_ms: null, hap_built_at: null,
    },
    cases: [{ id: 'TC-001', duration_ms: 1234, step_count: 1 }],
  };
  const report = (total: string): string => [
    '## 一、测试概览', '', '### 真机流水线耗时', '',
    '| 阶段 | 耗时 | 说明 |', '| --- | --- | --- |',
    '| 打包 (hvigor) | 100ms | reused=false |',
    '| 装机 (hdc) | 50ms | reused=false |',
    '| Hylyre 自动化 | 1234ms | |',
    '| 快照写入 (page save) | 0ms | |',
    `| **合计（脚本统计）** | **${total}** | harness 各阶段之和 |`, '',
    '| 元数据 | 值 |', '| --- | --- |', '| HAP 落盘时间 (hapBuiltAt) | — |', '',
    '## 二、测试执行结果', '',
    '| 用例编号 | 执行状态 | 耗时 |', '| --- | --- | --- |',
    '| TC-001 | 通过 | 1234ms |',
  ].join('\n');
  const summed = reconcileReportWithDeviceTestTiming(report('1384ms'), { timing });
  assert.ok(!summed.ok, '加总的合计不得通过');
  assert.ok(summed.mismatches.some(m => m.includes('合计') && m.includes('应为无数据占位')), summed.mismatches.join('；'));
  const placeholder = reconcileReportWithDeviceTestTiming(report('—'), { timing });
  assert.deepStrictEqual(placeholder, { ok: true, mismatches: [] });
});

test('generic test-report template: every execution row has the six header columns', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const templatePath = path.resolve(
    __dirname,
    '../../../profiles/generic/skills/device-testing/templates/test-report-template.md',
  );
  const section = getSectionContent(fs.readFileSync(templatePath, 'utf8'), '测试执行结果');
  assert.ok(section, 'generic template must contain execution section');
  const table = extractTables(section!)[0];
  assert.ok(table, 'generic template must contain execution table');
  for (const [index, row] of table!.rows.entries()) {
    assert.strictEqual(row.length, table!.headers.length, `template row ${index + 1}: ${row.join('|')}`);
  }
});

test('parseReportConclusionVerdict: 声明=达标 + 下一步建议含"若结论为不达标" → 达标（旧整段 includes 会误取不达标）', () => {
  const report = [
    '## 五、结论',
    '',
    '**测试结论**: 达标',
    '',
    '**下一步建议**（按上方测试结论执行）:',
    '- 若结论为"不达标"：修复所有 BLOCKER 和 P0 失败用例后重新测试',
    '- 若结论为"有条件达标"：修复 MAJOR 缺陷后回归测试',
    '- 若结论为"达标"：功能模块验收完成，可发布',
  ].join('\n');
  assert.strictEqual(parseReportConclusionVerdict(report), '达标');
});

test('parseReportConclusionVerdict: 声明=不达标 → 不达标', () => {
  const report = ['## 结论', '', '**测试结论**: 不达标', '存在 P0 失败用例。'].join('\n');
  assert.strictEqual(parseReportConclusionVerdict(report), '不达标');
});

test('reconcileReportWithHylyreTrace: 报告声明达标 vs trace.outcome=partial → 命中 trace.outcome 矛盾', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-recon-verdict-'));
  const hylyreDir = path.join(dir, '20260101-120000', 'hylyre');
  fs.mkdirSync(hylyreDir, { recursive: true });
  const tracePath = path.join(hylyreDir, 'trace.json');
  fs.writeFileSync(
    tracePath,
    JSON.stringify({
      schema_version: '0.2-p4',
      feature: 'f',
      phase: 'testing',
      outcome: 'partial',
      cases: [{ id: 'TC-001', status: '通过' }],
    }),
  );
  const report = [
    '## 测试执行结果',
    '| 用例编号 | 执行状态 |',
    '| --- | --- |',
    '| TC-001 | 通过 |',
    '## 五、结论',
    '**测试结论**: 达标',
    '**下一步建议**:',
    '- 若结论为"不达标"：重测',
  ].join('\n');
  const recon = reconcileReportWithHylyreTrace(report, tracePath);
  assert.strictEqual(recon.ok, false);
  assert.ok(recon.mismatches.some(m => m.includes('trace.outcome')), '应命中 达标 vs trace.outcome 矛盾');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evaluateUiEntryCoverage: AC-8 from acceptance.yaml → P0 blocker', () => {
  const acMap = new Map([['AC-8', 'P0']]);
  const spec: UseCasesSpec = {
    schema_version: '2.0',
    feature: 'f',
    use_cases: [
      {
        id: 'uc1',
        coordinator: 'Flow',
        ui_bindings: [
          {
            ui: 'BankCardAddPage',
            role: 'entry',
            user_actions: [{ trigger: 'tap bank', calls: 'flow.selectBank' }],
          },
          {
            ui: 'AllBanksPage',
            role: 'entry',
            user_actions: [{ trigger: 'tap bank', calls: 'flow.selectBank' }],
          },
        ],
        state_model: { phases: ['start'] },
        branches: [{ id: 'b1', scenario: 'select bank', linked_acceptance: ['AC-8'] }],
      },
    ],
  };
  const derived = [
    '---',
    'derived_cases:',
    '  - tc_id: TC-010',
    '    entry_ui: BankCardAddPage',
    '    calls: flow.selectBank',
    '---',
    '',
    '## 测试用例清单',
    '| 用例编号 | entry_ui | calls |',
    '| TC-010 | BankCardAddPage | flow.selectBank |',
  ].join('\n');
  const entryPriorities = buildEntryUiPriorityMap(spec, acMap);
  assert.strictEqual(entryPriorities.get('BankCardAddPage'), 'P0');
  const cov = evaluateUiEntryCoverage(spec, derived, entryPriorities);
  assert.ok(cov.blockers.some(b => b.includes('AllBanksPage')));
  assert.strictEqual(cov.majors.length, 0);
});

test('reconcileReportWithHylyreTrace: skip vs fail mismatch', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-recon-skip-'));
  const hylyreDir = path.join(dir, '20260101-120000', 'hylyre');
  fs.mkdirSync(hylyreDir, { recursive: true });
  const tracePath = path.join(hylyreDir, 'trace.json');
  fs.writeFileSync(
    tracePath,
    JSON.stringify({
      schema_version: '0.2-p4',
      feature: 'f',
      phase: 'testing',
      outcome: 'partial',
      cases: [{ id: 'TC-002', status: '失败' }],
    }),
  );
  const report = [
    '## 测试执行结果',
    '',
    '| 用例编号 | 执行状态 |',
    '| --- | --- |',
    '| TC-002 | 跳过 |',
  ].join('\n');
  const recon = reconcileReportWithHylyreTrace(report, tracePath);
  assert.strictEqual(recon.ok, false);
  assert.ok(recon.mismatches.some(m => m.includes('TC-002') && m.includes('跳过') && m.includes('失败')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reconcileReportWithHylyreTrace: both skip → ok', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-recon-ok-'));
  const hylyreDir = path.join(dir, '20260101-120000', 'hylyre');
  fs.mkdirSync(hylyreDir, { recursive: true });
  const tracePath = path.join(hylyreDir, 'trace.json');
  fs.writeFileSync(
    tracePath,
    JSON.stringify({
      schema_version: '0.2-p4',
      feature: 'f',
      phase: 'testing',
      outcome: 'success',
      cases: [{ id: 'TC-003', status: '跳过' }],
    }),
  );
  const report = [
    '## 测试执行结果',
    '',
    '| 用例编号 | 执行状态 |',
    '| --- | --- |',
    '| TC-003 | 跳过 |',
  ].join('\n');
  assert.strictEqual(reconcileReportWithHylyreTrace(report, tracePath).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report-reconcile-only: 只读最终 trace/timing/meta 并完整通过输入校验', () => {
  const fs = require('fs') as typeof import('fs');
  const fixture = makeReportOnlyFixture();
  try {
    const traceBefore = fs.readFileSync(fixture.tracePath);
    const results = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root));
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[0].id, 'report_reconcile_only');
    assert.strictEqual(results[0].status, 'PASS', results[0].details);
    assert.match(results[0].details, /未调用设备、hvigor、hdc、Hylyre 或视觉采集/);
    assert.match(results[0].details, /路径\/指纹\/时间戳\/复用状态\/精确 case 集合\/报告耗时/);
    assert.deepStrictEqual(
      results.slice(1).map(result => [result.id, result.status]),
      [['device_test_build', 'PASS'], ['device_test_install', 'PASS'], ['device_test_run', 'PASS']],
    );
    assert.deepStrictEqual(fs.readFileSync(fixture.tracePath), traceBefore, 'authoritative trace bytes must remain unchanged');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// plan 5e1c7a93 D3：这张表现在同时钉住**分桶**——动摇「哪个包/哪台设备/哪次 run/哪些 case
// 真跑过」的仍是 hard（BLOCKER FAIL）；只是 timing/报告这层派生投影陈旧的走 soft：先由
// trace+meta 重建，重建后闭合即 PASS，且绝不出现在 hard 桶里（那正是本批要消除的
// 「一行陈旧统计逼一次真机重跑」）。
test('report-reconcile-only: 执行事实错配仍 FAIL；派生投影陈旧走重建通道', () => {
  const fs = require('fs') as typeof import('fs');
  const mutations: Array<{ name: string; apply: (fixture: ReportOnlyFixture) => void; expected: RegExp; derived?: true }> = [
    {
      name: 'build after install',
      apply: fixture => {
        const p = fixture.reportsDir + '/device-test-build.result.json';
        const value = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
        value.timestamp = new Date(Date.parse(fixture.installAt) + 1000).toISOString();
        fs.writeFileSync(p, JSON.stringify(value));
      },
      expected: /pipeline 时间顺序错误|build → install → run_started_at 时间链不闭合/,
    },
    {
      name: 'timing reused disagrees with meta',
      apply: fixture => {
        const p = fixture.timingPath;
        const value = JSON.parse(fs.readFileSync(p, 'utf8')) as { pipeline: Record<string, unknown> };
        value.pipeline.build_reused = true;
        fs.writeFileSync(p, JSON.stringify(value));
      },
      // 源 meta 合法，陈旧的只是投影 → 重建即闭合
      expected: /timing\.pipeline\.build_reused/,
      derived: true,
    },
    {
      name: 'timing contains an old case',
      apply: fixture => {
        const p = fixture.timingPath;
        const value = JSON.parse(fs.readFileSync(p, 'utf8')) as { cases: unknown[] };
        value.cases.push({ id: 'TC-999', duration_ms: 1, step_count: 1 });
        fs.writeFileSync(p, JSON.stringify(value));
      },
      expected: /最终 timing 含 trace 不存在的旧 case：TC-999/,
      derived: true,
    },
    {
      name: 'trace feature differs from current feature',
      apply: fixture => {
        const value = JSON.parse(fs.readFileSync(fixture.tracePath, 'utf8')) as Record<string, unknown>;
        value.feature = 'other-feature';
        fs.writeFileSync(fixture.tracePath, JSON.stringify(value));
      },
      expected: /authoritative trace\.feature=other-feature/,
    },
    {
      name: 'report case duration differs from final timing',
      apply: fixture => {
        const path = require('path') as typeof import('path');
        const p = fixture.root + '/doc/features/demo/testing/test-report.md';
        const value = fs.readFileSync(p, 'utf8').replace('250ms', '252ms');
        assert.ok(value.includes('252ms'), `test fixture mutation did not hit report: ${p}`);
        fs.writeFileSync(p, value);
        assert.strictEqual(resolveFeatureArtifact(fixture.root, 'demo', 'test-report.md').actualPath, path.resolve(p));
        assert.strictEqual(parseReportExecutionRows(value)[0]?.durationMs, 252);
        const timing = JSON.parse(fs.readFileSync(fixture.timingPath, 'utf8'));
        const directRecon = reconcileReportWithDeviceTestTiming(value, { timing, buildTimestamp: fixture.buildAt });
        assert.strictEqual(directRecon.ok, false, JSON.stringify(directRecon));
      },
      expected: /报告 case TC-001 耗时=252ms/,
      derived: true,
    },
  ];

  for (const mutation of mutations) {
    const fixture = makeReportOnlyFixture();
    try {
      mutation.apply(fixture);
      const result = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root))[0]!;
      const details = result.details ?? '';
      const hardBlock = details.split('派生统计 UNKNOWN')[0]!;
      if (mutation.derived) {
        assert.strictEqual(result.status, 'PASS', `${mutation.name} 属派生投影，重建后应闭合\n${details}`);
        assert.ok(!mutation.expected.test(hardBlock), `${mutation.name} 不得留在 hard 桶\n${hardBlock}`);
      } else {
        assert.strictEqual(result.status, 'FAIL', `${mutation.name} should fail\n${details}`);
        assert.match(hardBlock, mutation.expected, `${mutation.name}\n${details}`);
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// plan 5e1c7a93 D3 验收：V7⑤（UNKNOWN + WARN）/ V7b（原始协议缺口仍 hard）/ V9（性能类 AC）
// ---------------------------------------------------------------------------

/** 报告对账全程不得发生 hvigor/hdc/Hylyre/python 的进程调用（计数在 spawnSync 边界）。 */
function withSpawnGuard<T>(fn: () => T): { value: T; spawned: string[] } {
  const cp = require('child_process') as { spawnSync: (...a: unknown[]) => unknown };
  const original = cp.spawnSync;
  const spawned: string[] = [];
  cp.spawnSync = function (file: unknown, args: unknown, ...rest: unknown[]): unknown {
    const command = [String(file), ...(Array.isArray(args) ? args.map(String) : [])].join(' ');
    if (/hvigor|hdc|hylyre|python/i.test(command)) {
      spawned.push(command);
      return { status: 0, signal: null, stdout: '', stderr: '', pid: 0, output: [] };
    }
    return (original as (...a: unknown[]) => unknown).call(cp, file, args, ...rest);
  };
  try {
    return { value: fn(), spawned };
  } finally {
    cp.spawnSync = original;
  }
}

// V7⑤：device-test-run.meta.json 缺 run_duration_ms —— UNKNOWN 的唯一可达现场之一
// （pipeline 段耗时的源 meta 不在 trace 里，requireV1ForGate 管不到，重建也无从推导）。
test('V7⑤ report-only: pipeline 段源 meta 缺 durationMs → WARN + derived_statistic_unavailable，全程零设备调用', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const fixture = makeReportOnlyFixture();
  try {
    const runMetaPath = path.join(fixture.reportsDir, 'device-test-run.meta.json');
    const runMeta = JSON.parse(fs.readFileSync(runMetaPath, 'utf8')) as Record<string, unknown>;
    delete runMeta.run_duration_ms;
    fs.writeFileSync(runMetaPath, JSON.stringify(runMeta));

    const { value: results, spawned } = withSpawnGuard(
      () => __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root)),
    );
    const result = results[0]!;
    assert.strictEqual(result.status, 'WARN', result.details);
    assert.strictEqual(result.severity, 'BLOCKER', 'severity 保持 BLOCKER（BLOCKER 级 WARN 形态）');
    assert.strictEqual(result.failure_kind, 'derived_statistic_unavailable', JSON.stringify(result));
    assert.match(result.details ?? '', /UNKNOWN/, result.details);
    assert.match(result.details ?? '', /不构成执行事实结论/, result.details);
    assert.match(result.details ?? '', /run_duration_ms/, result.details);
    assert.deepStrictEqual(spawned, [], `report-only 不得发生任何设备/工具进程调用：${spawned.join(' | ')}`);

    // 报告耗时格必须是空值占位，不能是 UNKNOWN 字面量（parseDurationCell 只认 — - n/a na 不适用）
    const reportMd = fs.readFileSync(
      path.join(fixture.root, 'doc', 'features', 'demo', 'testing', 'test-report.md'),
      'utf8',
    );
    assert.ok(!/\|\s*UNKNOWN\s*\|/.test(reportMd), 'UNKNOWN 不得写进被 parseDurationCell 读的格子');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// V7b 反例守卫：v1 trace 的某个 step 删掉 duration_ms —— 这是**原始协议缺口**，
// 必须由 requireV1ForGate 判 hard（BLOCKER FAIL），不得进 soft 桶、不得走 WARN 通道。
test('V7b report-only: v1 step 缺 duration_ms 是原始协议缺口 → hard FAIL，不进派生桶', () => {
  const fs = require('fs') as typeof import('fs');
  const fixture = makeReportOnlyFixture();
  try {
    const trace = JSON.parse(fs.readFileSync(fixture.tracePath, 'utf8')) as {
      cases?: Array<{ steps?: Array<Record<string, unknown>> }>;
    };
    const firstStep = trace.cases?.[0]?.steps?.[0];
    assert.ok(firstStep && 'duration_ms' in firstStep, 'golden trace 应有 step.duration_ms');
    delete firstStep!.duration_ms;
    fs.writeFileSync(fixture.tracePath, JSON.stringify(trace));

    const result = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root))[0]!;
    assert.strictEqual(result.status, 'FAIL', result.details);
    assert.notStrictEqual(result.failure_kind, 'derived_statistic_unavailable', JSON.stringify(result));
    const hardBlock = (result.details ?? '').split('派生统计 UNKNOWN')[0]!;
    assert.match(hardBlock, /duration_ms|结果协议|schema/, hardBlock);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// V9：性能类 AC 的耗时不得由重建路径提供。①识别到（performance[].id ∩「关联 AC」列的 NFR）
// → 归 hard 桶 BLOCKER FAIL；②识别不到（列里没写 NFR）→ 按 soft 处理，不误伤成 FAIL。
test('V9 report-only: 性能类 TC 的耗时缺口归 hard；识别不到时按 soft 不误伤', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const planRow = (acCell: string) => [
    '## 测试用例', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| TC-001 | demo | app | tap | pass | P0 | ${acCell} |`,
  ].join('\n');
  const perfCtx = (root: string) => {
    const ctx = reportOnlyContext(root) as unknown as Record<string, unknown>;
    ctx.featureSpec = { acceptance: { performance: [{ id: 'NFR-1', metric: 'p95', target: '<800ms' }] } };
    return ctx as unknown as import('../../scripts/utils/types').CheckContext;
  };

  for (const [acCell, expected] of [['AC-001, NFR-1', 'FAIL'], ['AC-001', 'PASS']] as const) {
    const fixture = makeReportOnlyFixture();
    try {
      const featureDir = path.join(fixture.root, 'doc', 'features', 'demo', 'testing');
      fs.writeFileSync(path.join(featureDir, 'test-plan.md'), planRow(acCell));
      // 报告里 TC-001 的耗时与最终 timing 不符：非性能 TC 时由重建抹平，性能 TC 时必须留在 hard 桶
      const reportPath = path.join(featureDir, 'test-report.md');
      fs.writeFileSync(reportPath, fs.readFileSync(reportPath, 'utf8').replace('250ms', '252ms'));

      const result = __testing_checkReportReconcileOnlyPipeline(perfCtx(fixture.root))[0]!;
      assert.strictEqual(result.status, expected, `关联 AC=${acCell}\n${result.details}`);
      if (expected === 'FAIL') {
        const hardBlock = (result.details ?? '').split('派生统计 UNKNOWN')[0]!;
        assert.match(hardBlock, /TC-001/, hardBlock);
        assert.match(hardBlock, /性能类 AC：耗时必须真实量测/, hardBlock);
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

// V9 生产入口版（codex review 第 1 轮 #2）：完整 checker 在进入对账之前就用
// regenerateTestReport 从 trace 整份重写了报告正文（check-testing.ts:5844），只看重写后的
// 正文时 252ms↔250ms 这条性能缺口凭空消失。这一例跑**完整 checker**，钉住性能缺口在
// **首次重建之前**被识别并留在 hard 桶。
test('V9 完整 checker：性能类 TC 的耗时缺口在首次重建前被扣下（识别不到时仍不误伤）', async () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const checker = require('../../scripts/check-testing').default as {
    check: (ctx: import('../../scripts/utils/types').CheckContext) => Promise<Array<import('../../scripts/utils/types').CheckResult>>;
  };
  const planRow = (acCell: string) => [
    '## 测试用例', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| TC-001 | demo | app | tap | pass | P0 | ${acCell} |`,
  ].join('\n');

  for (const [acCell, expected] of [['AC-001, NFR-1', 'FAIL'], ['AC-001', 'PASS']] as const) {
    const fixture = makeReportOnlyFixture();
    try {
      const featureDir = path.join(fixture.root, 'doc', 'features', 'demo', 'testing');
      fs.writeFileSync(path.join(featureDir, 'test-plan.md'), planRow(acCell));
      // timing 先对齐 trace 的可重建值（0ms）——这样重建后一切闭合，唯一残留的缺口就是
      // **重写前**那份报告与 timing 的差；否则重建本身制造的瞬时差会掩盖本例要问的问题。
      const timing = JSON.parse(fs.readFileSync(fixture.timingPath, 'utf8')) as {
        cases: Array<{ duration_ms: number | null }>;
      };
      timing.cases[0]!.duration_ms = 0;
      fs.writeFileSync(fixture.timingPath, JSON.stringify(timing));
      const reportPath = path.join(featureDir, 'test-report.md');
      fs.writeFileSync(reportPath, fs.readFileSync(reportPath, 'utf8').replace('250ms', '252ms'));

      const ctx = reportOnlyContext(fixture.root) as unknown as Record<string, unknown>;
      ctx.reportReconcileOnly = true;
      ctx.featureSpec = { acceptance: { performance: [{ id: 'NFR-1', metric: 'p95', target: '<800ms' }] } };
      const { value: results, spawned } = withSpawnGuard(
        () => checker.check(ctx as unknown as import('../../scripts/utils/types').CheckContext),
      );
      const all = await results;
      // 前置：生产入口确实先重写过报告——否则这一例证不了"重建前扣下"
      const generated = all.find(r => r.id === 'test_report_generated');
      assert.strictEqual(
        generated?.status, 'PASS',
        `完整 checker 必须先整份重写报告：${JSON.stringify(generated)}`,
      );
      assert.ok(
        !fs.readFileSync(reportPath, 'utf8').includes('252ms'),
        '重写后盘上正文里的 252ms 应已被 trace 的真实耗时抹平（缺口只存在于重写前那一份）',
      );
      const reconcile = all.find(r => r.id === 'report_reconcile_only');
      assert.ok(reconcile, `完整 checker 必须产出 report_reconcile_only：${all.map(r => r.id).join(',')}`);
      assert.strictEqual(reconcile!.status, expected, `关联 AC=${acCell}\n${reconcile!.details}`);
      if (expected === 'FAIL') {
        const hardBlock = (reconcile!.details ?? '').split('派生统计 UNKNOWN')[0]!;
        assert.match(hardBlock, /TC-001/, hardBlock);
        assert.match(hardBlock, /性能类 AC：耗时必须真实量测/, hardBlock);
      }
      assert.deepStrictEqual(spawned, [], `report-only 完整 checker 不得发生设备/工具进程调用：${spawned.join(' | ')}`);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

// V8（codex review 第 1 轮 #4）：复用轮**只回填一次**冻结件——重建后的完整 timing 不得
// 被不完整的旧冻结副本盖回去；最终报告读取的必须是重建结果。
test('V8 复用回填：重建后的 timing 不被旧冻结件覆盖，报告读到的是重建结果', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const { __testing_adoptFrozenRunArtifactsForReuse } = require('../../scripts/check-testing') as {
    __testing_adoptFrozenRunArtifactsForReuse: (
      ctx: import('../../scripts/utils/types').CheckContext,
      reusable: { runDir: string; dirStamp: string; record: Record<string, unknown> },
      rebuildRequired: boolean,
    ) => boolean;
  };
  const fixture = makeReportOnlyFixture();
  try {
    const runDir = path.join(fixture.reportsDir, '20260830T010000Z-001', 'hylyre');
    // 执行事实组冻结件完整；派生组（timing）是**缺一条 case** 的陈旧投影
    fs.copyFileSync(
      path.join(fixture.reportsDir, 'device-test-run.meta.json'),
      path.join(runDir, 'frozen.device-test-run.meta.json'),
    );
    const stale = JSON.parse(fs.readFileSync(fixture.timingPath, 'utf8')) as { cases: unknown[] };
    stale.cases = [];
    fs.writeFileSync(path.join(runDir, 'frozen.device-test-timing.json'), JSON.stringify(stale));
    fs.writeFileSync(fixture.timingPath, JSON.stringify(stale));

    const ok = __testing_adoptFrozenRunArtifactsForReuse(
      reportOnlyContext(fixture.root),
      {
        runDir,
        dirStamp: '20260830T010000Z-001',
        record: {
          trace_path: fixture.tracePath,
          timing_complete: false,
          frozen_files: ['frozen.device-test-timing.json', 'frozen.device-test-run.meta.json'],
        },
      },
      true,
    );
    assert.strictEqual(ok, true, '执行事实齐备 + trace 完整 → 重建应成功');
    const finalTiming = JSON.parse(fs.readFileSync(fixture.timingPath, 'utf8')) as {
      cases: Array<{ id: string; duration_ms: number | null }>;
    };
    assert.deepStrictEqual(
      finalTiming.cases.map(c => c.id),
      ['TC-001'],
      '最终盘上的 timing 必须是重建结果，不得被旧冻结副本覆盖回去',
    );
    // 报告消费者读到的就是这一份：完整 timing → 对账闭合
    const result = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root))[0]!;
    assert.strictEqual(result.status, 'PASS', result.details);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// 接线锁：复用路径全仓只允许**一处** restoreFrozenRunArtifacts 调用（就在上面那个 helper 里）。
// 再加一处就会把重建结果覆盖回去——这正是 codex #4 报的缺陷形态。
test('接线：check-testing 的复用路径只回填一次冻结件', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/check-testing.ts'),
    'utf-8',
  );
  const calls = src.match(/restoreFrozenRunArtifacts\(/g) ?? [];
  assert.strictEqual(calls.length, 1, `复用路径只允许一处回填调用，实际 ${calls.length} 处`);
});

// plan b3d7e5a1 T2（codex P1）：registry 未登记的 provider id 只是声明 BLOCKER；report-only 的派生/trace/timing
// 精确对账必须继续按 hylyre 集合，不得退回 legacy 全 TC 口径而对历史 run 虚报"派生计划缺少顶层 TC"。
test('report-reconcile-only: hylyre + 未登记 provider 通道 → 仍按 hylyre 集合对账，不虚报派生缺失', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const fixture = makeReportOnlyFixture();
  try {
    const featureDir = path.join(fixture.root, 'doc', 'features', 'demo', 'testing');
    fs.writeFileSync(path.join(featureDir, 'test-plan.md'), [
      '## 测试用例', '',
      '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| TC-001 | demo | app | tap | pass | P0 | AC-001 | hylyre |',
      '| TC-002 | perf | app | probe | pass | P1 | AC-002 | provider:device-test.perf-probe |',
    ].join('\n'));
    const ctx = reportOnlyContext(fixture.root); // resolvedProfile.capabilities = {} → perf-probe 未登记
    const results = __testing_checkReportReconcileOnlyPipeline(ctx);
    const details = results.map(r => `${r.id}:${r.status}\n${r.details ?? ''}`).join('\n');
    assert.ok(!/派生计划缺少顶层 TC/.test(details), `不得退回 legacy 全 TC 口径虚报缺失：\n${details}`);
    assert.ok(!/派生计划缺少 channel=hylyre/.test(details), `hylyre 集合（TC-001）本就完整：\n${details}`);
    assert.ok(!/派生计划包含/.test(details), `TC-001 属 hylyre 集合，不是多余 TC：\n${details}`);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// plan 5e1c7a93 D3：timing 文件缺失属**派生统计**缺口（可由 trace+meta 重建），
// 不再单独把一轮真实完整的 run 判成执行事实缺口。这里锁的是：仍然 FAIL，但 FAIL 的
// 理由必须是**执行事实/协议**缺口，timing 那条不得再出现在 hard 桶里。
test('report-reconcile-only: 缺最终 timing 走重建通道；FAIL 仍由执行事实/协议缺口驱动', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-reconcile-only-missing-'));
  const reportsDir = path.join(root, 'doc', 'features', 'demo', 'testing', 'reports');
  const runDir = path.join(reportsDir, '20260830T010000Z-001', 'hylyre');
  fs.mkdirSync(runDir, { recursive: true });
  const tracePath = path.join(runDir, 'trace.json');
  fs.writeFileSync(path.join(runDir, 'test-plan.hylyre.md'), '## 测试用例清单\n\n| 用例编号 | 用例名称 |\n| --- | --- |\n| TC-001 | demo |');
  fs.writeFileSync(tracePath, JSON.stringify({ feature: 'demo', phase: 'testing', outcome: 'success', cases: [] }));
  fs.writeFileSync(path.join(reportsDir, 'device-test-build.result.json'), JSON.stringify({ reused: true, hapPath: 'x' }));
  fs.writeFileSync(path.join(reportsDir, 'device-test-install.meta.json'), JSON.stringify({ ok: true, hapPath: 'x' }));
  fs.writeFileSync(path.join(reportsDir, 'device-test-run.meta.json'), JSON.stringify({ ok: true, trace_path: tracePath }));

  const result = __testing_checkReportReconcileOnlyPipeline({
    phase: 'testing',
    feature: 'demo',
    projectRoot: root,
    phaseRule: { structure_checks: { report_reconcile_only: { description: 'report-only' } } },
    resolvedProfile: { capabilities: {} },
  } as unknown as import('../../scripts/utils/types').CheckContext)[0];
  assert.strictEqual(result.status, 'FAIL', result.details);
  assert.match(result.details, /结果协议无法消费/, result.details);
  const hardBlock = result.details!.split('派生统计 UNKNOWN')[0]!;
  assert.ok(!/缺失或无效的最终 device-test-timing\.json/.test(hardBlock), hardBlock);
  fs.rmSync(root, { recursive: true, force: true });
});

test('report-reconcile-only: 真实 CLI 跳过 provider、视觉采集与 executable lifecycle hooks', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const crypto = require('crypto') as typeof import('crypto');
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const fixture = makeReportOnlyFixture();
  const sourceRoot = path.resolve(__dirname, '..', '..', '..');
  const events = [
    'pre_phase', 'post_phase', 'pre_check', 'post_check',
    'pre_verifier', 'post_verifier', 'on_context_load', 'on_violation',
  ];
  const sha256 = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const copyTree = (source: string, target: string): void => {
    fs.cpSync(source, target, {
      recursive: true,
      filter: (candidate: string) => {
        const rel = path.relative(sourceRoot, candidate).replace(/\\/g, '/');
        return !rel.includes('/node_modules/') &&
          !rel.includes('/.git/') &&
          !rel.startsWith('harness/reports/') &&
          !rel.startsWith('harness/state/') &&
          !rel.startsWith('harness/trace/') &&
          !rel.startsWith('harness/tests/') &&
          !rel.includes('/vendor/');
      },
    });
  };

  try {
    for (const name of ['harness', 'skills', 'specs', 'profiles', 'workflows', 'agents', 'templates', 'scripts']) {
      copyTree(path.join(sourceRoot, name), path.join(fixture.root, name));
    }
    for (const name of ['package.json', '.editorconfig', '.gitattributes']) {
      fs.copyFileSync(path.join(sourceRoot, name), path.join(fixture.root, name));
    }

    const hookDir = path.join(fixture.root, 'harness', 'hooks', 'testing');
    fs.mkdirSync(hookDir, { recursive: true });
    for (const event of events) {
      fs.writeFileSync(path.join(hookDir, `${event}.mjs`), 'throw new Error("REPORT_ONLY_HOOK_INVOKED");\n');
    }
    const markerDir = path.join(fixture.root, 'harness', 'node_modules', 'ts-node');
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(path.join(markerDir, 'package.json'), '{}\n');

    const forbiddenLoader = path.join(fixture.root, 'report-only-forbidden.cjs');
    fs.writeFileSync(forbiddenLoader, [
      "const Module = require('module');",
      'const originalLoad = Module._load;',
      'const modulePattern = /capability-registry|hooks-dispatcher|hdc-runner|hvigor-runner|hylyre-spawn|visual-diff-capture|device-test-run|device-test-build|device-test-install/;',
      'const exportPattern = /^(dispatchDeviceTest|dispatchDeviceVisualDiff|captureVisualDiff|runHylyre|ensureHylyre|installDeviceTest|buildDeviceTest|installHap|probeDevices|runHdc|spawnHylyre|dispatchLifecycleHooks|recoverDevice|ensureReady|runAa|screenshot|layoutDump)/;',
      'Module._load = function(request, parent, isMain) {',
      '  const value = originalLoad.apply(this, arguments);',
      '  if (request === "child_process" && value && typeof value.spawnSync === "function" && !value.__reportOnlyGuarded) {',
      '    const originalSpawnSync = value.spawnSync;',
      '    value.spawnSync = function(file, args) {',
      '      const command = [file, ...(Array.isArray(args) ? args : [])].join(" ");',
      '      if (/hvigor|hdc|hylyre|python/i.test(command)) throw new Error("REPORT_ONLY_FORBIDDEN_CALL:child_process");',
      '      return originalSpawnSync.apply(this, arguments);',
      '    };',
      '    value.__reportOnlyGuarded = true;',
      '  }',
      '  if (typeof request === "string" && modulePattern.test(request) && value && typeof value === "object") {',
      '    for (const key of Object.keys(value)) {',
      '      if (key === "dispatchVisualDiffDeterministicOnly" || /^parse/.test(key) || !exportPattern.test(key) || typeof value[key] !== "function") continue;',
      '      value[key] = function() { throw new Error("REPORT_ONLY_FORBIDDEN_CALL:" + key); };',
      '    }',
      '  }',
      '  return value;',
      '};',
      '',
    ].join('\n'));

    const traceBefore = sha256(fixture.tracePath);
    fs.writeFileSync(path.join(fixture.reportsDir, 'script-report.json'), JSON.stringify({ stale: true }));
    fs.writeFileSync(path.join(fixture.reportsDir, 'summary.json'), JSON.stringify({ stale: true }));
    const tsNodeRegister = path.join(sourceRoot, 'harness', 'node_modules', 'ts-node', 'register', 'transpile-only.js');
    const env = {
      ...process.env,
      NODE_PATH: [
        path.join(sourceRoot, 'harness', 'node_modules'),
        path.join(sourceRoot, 'node_modules'),
        process.env.NODE_PATH,
      ].filter(Boolean).join(path.delimiter),
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${forbiddenLoader}`].filter(Boolean).join(' '),
      TS_NODE_TRANSPILE_ONLY: '1',
    };
    const run = spawnSync(
      process.execPath,
      [
        '-r', tsNodeRegister,
        path.join(fixture.root, 'harness', 'harness-runner.ts'),
        '--phase', 'testing', '--feature', 'demo', '--report-reconcile-only', '--failures-only',
      ],
      { cwd: path.join(fixture.root, 'harness'), env, encoding: 'utf8', timeout: 120000, windowsHide: true },
    );
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    assert.strictEqual(run.error, undefined, run.error?.message);
    assert.notStrictEqual(run.status, null, output);
    assert.ok(!output.includes('REPORT_ONLY_FORBIDDEN_CALL'), `report-only 调用了被禁止的 provider：\n${output}`);
    assert.ok(!output.includes('REPORT_ONLY_HOOK_INVOKED'), `report-only 调用了 executable hook：\n${output}`);
    assert.match(output, /HARNESS_SUMMARY/, `真实 CLI 未完成 summary 输出：\n${output}`);

    const scriptReportPath = path.join(fixture.reportsDir, 'script-report.json');
    const summaryPath = path.join(fixture.reportsDir, 'summary.json');
    assert.ok(fs.existsSync(scriptReportPath), '真实 CLI 应重算 script-report.json');
    assert.ok(fs.existsSync(summaryPath), '真实 CLI 应重算 summary.json');
    const scriptReport = JSON.parse(fs.readFileSync(scriptReportPath, 'utf8')) as { checks?: Array<{ id?: string }> };
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { quality_axes?: unknown };
    assert.ok(scriptReport.checks?.some(check => check.id === 'report_reconcile_only'), 'script-report 缺 report-only check');
    assert.ok(summary.quality_axes, 'summary 缺 quality_axes 完整重算结果');
    assert.strictEqual(sha256(fixture.tracePath), traceBefore, '真实 CLI 不得改写 authoritative trace 字节');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('report-reconcile-only: native trace 必须绑定同一 derived plan/trace SHA，不能用当前最新计划重解释', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const crypto = require('crypto') as typeof import('crypto');
  const fixture = makeReportOnlyFixture();
  const sha256 = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  try {
    const topPlanPath = path.join(fixture.root, 'doc', 'features', 'demo', 'testing', 'test-plan.md');
    const derivedPlanPath = path.join(fixture.reportsDir, '20260830T010000Z-001', 'hylyre', 'test-plan.hylyre.md');
    const runPath = path.join(fixture.reportsDir, 'device-test-run.meta.json');
    const trace = reportOnlyGoldenTrace();
    trace.artifacts.plan = derivedPlanPath.replace(/\\/g, '/');
    fs.writeFileSync(fixture.tracePath, JSON.stringify(trace, null, 2));
    fs.writeFileSync(path.join(fixture.root, 'doc', 'features', 'demo', 'acceptance.yaml'), [
      'flows:', '  demo:', '    screens: [home, success]', 'criteria:',
      '  - id: AC-1', '    priority: P0', '    ut_layer: device', '    linked_flow: demo',
      '    checkpoint:', '      pre_screen: home', '      action: { type: touch, target_element_id: tab_wallet }',
      '      post_screen: success', '      required_element_ids: [success_title]',
    ].join('\n'));
    const vendorDir = path.join(fixture.root, 'framework', 'profiles', 'hmos-app', 'vendor', 'hylyre');
    fs.mkdirSync(vendorDir, { recursive: true });
    fs.writeFileSync(path.join(vendorDir, 'release.manifest.json'), JSON.stringify({ schema: 1, hylyre_version: '0.5.0' }));
    fs.writeFileSync(path.join(fixture.reportsDir, 'hylyre-ready.meta.json'), JSON.stringify({
      ok: true, doctorOk: true, installed_version: '0.5.0', manifest_version: '0.5.0', version_consistent: true,
    }));
    const runMeta = JSON.parse(fs.readFileSync(runPath, 'utf-8')) as Record<string, unknown>;
    runMeta.artifact_binding = {
      test_plan_path: path.resolve(topPlanPath), test_plan_sha256: sha256(topPlanPath),
      derived_plan_path: path.resolve(derivedPlanPath), derived_plan_sha256: sha256(derivedPlanPath),
      trace_path: path.resolve(fixture.tracePath), trace_sha256: sha256(fixture.tracePath),
    };
    assert.strictEqual(
      (runMeta.artifact_binding as Record<string, unknown>).derived_plan_sha256,
      sha256(derivedPlanPath),
      'fixture binding must be computed from the same derived plan bytes',
    );
    fs.writeFileSync(runPath, JSON.stringify(runMeta, null, 2));
    const first = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root));
    assert.strictEqual(first[0].status, 'PASS', first.map(item => item.details).join('\n'));
    assert.strictEqual(first.find(item => item.id === 'hylyre_evidence_gate')?.status, 'PASS');

    fs.writeFileSync(derivedPlanPath, fs.readFileSync(derivedPlanPath, 'utf-8').replace('tab_wallet', 'tab_wallet_changed'));
    const stale = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root));
    assert.strictEqual(stale[0].status, 'FAIL', stale.map(item => item.details).join('\n'));
    assert.match(stale[0].details, /derived-plan SHA-256/);
    const staleGate = stale.find(item => item.id === 'hylyre_evidence_gate');
    assert.ok(staleGate && staleGate.failure_kind === undefined && staleGate.blocking_class === undefined,
      `ready 已证明 native 时坏 trace 不得伪装 capability missing：${JSON.stringify(staleGate)}`);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B08 D2（plan 9b2d5e7c）V3：装机复用分支与真装分支同源回传当前 HAP 的 64 位 sha256 → 两路径同键。
// 只 mock hdc 传输面（probe / bm dump / install / 候选元数据 / 装前就绪桥），provider 主体走生产代码。
// ---------------------------------------------------------------------------
test('B08-V3 同一 HAP：一次真装、一次装机复用 → 两条记录 inputs.hap_sha256_full 均为同一 64 位 hex，execution_key 相等', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { installDeviceTestApp } = require('../../../profiles/hmos-app/harness/providers/device-test-install') as typeof import('../../../profiles/hmos-app/harness/providers/device-test-install');
  const { computeExecutionKey } = require('../../../profiles/hmos-app/harness/execution-key') as typeof import('../../../profiles/hmos-app/harness/execution-key');
  const hdc = require('../../../profiles/hmos-app/harness/hdc-runner') as Record<string, unknown>;
  const bridge = require('../../../profiles/hmos-app/harness/device-recovery-bridge') as Record<string, unknown>;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b08-install-reuse-'));
  const saved = {
    probeDevices: hdc.probeDevices, runHdcShellBmDump: hdc.runHdcShellBmDump, installHap: hdc.installHap,
    parseInstalledBundleVersionFromDump: hdc.parseInstalledBundleVersionFromDump, loadAppInstallCandidateMeta: hdc.loadAppInstallCandidateMeta,
    ensureReadyBefore: bridge.ensureReadyBefore,
    envForce: process.env.HARNESS_DEVICE_TEST_FORCE_INSTALL, envSkip: process.env.HARNESS_SKIP_DEVICE_TEST_INSTALL,
    envUninstall: process.env.HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL,
  };
  let installCalls = 0;
  try {
    delete process.env.HARNESS_DEVICE_TEST_FORCE_INSTALL;
    delete process.env.HARNESS_SKIP_DEVICE_TEST_INSTALL;
    delete process.env.HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL;
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.1', project_name: 'T', project_profile: { name: 'hmos-app', sub_variant: 'app' },
      architecture: { outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' },
      paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
      materialized_adapters: ['cursor'],
    }));
    const hapPath = path.join(root, 'entry-signed.hap');
    fs.writeFileSync(hapPath, 'same-hap-bytes-for-both-paths');
    hdc.probeDevices = () => ({ hdcPresent: true, available: true, targets: ['dev-A'] });
    hdc.runHdcShellBmDump = () => ({ exitCode: 0, output: 'versionCode: 1' });
    hdc.parseInstalledBundleVersionFromDump = () => ({ installed: true, versionCode: 1 });
    hdc.loadAppInstallCandidateMeta = () => ({ bundleName: 'com.example.b08', versionCode: 1, versionName: '1.0.0' });
    hdc.installHap = () => { installCalls += 1; return { ok: true, exitCode: 0, durationMs: 1, output: 'install ok' }; };
    bridge.ensureReadyBefore = () => ({ ready: true, blocked: false, note: 'mock ready', authorized: true });
    const opts = { projectRoot: root, harnessRoot: root, feature: 'demo', phase: 'testing', hapPath };
    const real = installDeviceTestApp({ ...opts, buildReused: false });
    assert.strictEqual(real.ok, true, `真装须成功：${JSON.stringify(real.errors)}`);
    assert.strictEqual(real.reused, false);
    assert.strictEqual(installCalls, 1, '真装调用 hdc install 一次');
    const reused = installDeviceTestApp({ ...opts, buildReused: true });
    assert.strictEqual(reused.ok, true, `复用须成功：${JSON.stringify(reused.errors)}`);
    assert.strictEqual(reused.reused, true, `第二次须走装机复用：${JSON.stringify(reused)}`);
    assert.strictEqual(installCalls, 1, '复用不再调用 hdc install');
    const full = computeHapSha256Full(hapPath)!;
    assert.ok(/^[0-9a-f]{64}$/.test(full));
    assert.strictEqual(real.hapSha256Full, full, '真装回传 64 位完整摘要');
    assert.strictEqual(reused.hapSha256Full, full, '装机复用分支须同源回传 64 位完整摘要（不为 null、不是 12 位短指纹）');
    const inputsOf = (hap: string | null | undefined) => ({
      hap_sha256_full: hap ?? null, derived_plan_sha256: 'b'.repeat(64), device: 'dev-A', display_env: '', reset_mode: 'cold_restart',
      hylyre_version: '0.5.1', manifest_version: '0.5.1', profile: 'hmos-app', tool_config_sha256: 'c'.repeat(64), flags: ['--skip-assert-expected'],
    });
    assert.strictEqual(computeExecutionKey(inputsOf(real.hapSha256Full)), computeExecutionKey(inputsOf(reused.hapSha256Full)), '两路径执行键相等');
    assert.notStrictEqual(computeExecutionKey(inputsOf(reused.hapSha256Full)), computeExecutionKey(inputsOf(null)), '与 hap=null 记录的键不同（旧记录最多导致一次正常真跑）');
  } finally {
    hdc.probeDevices = saved.probeDevices; hdc.runHdcShellBmDump = saved.runHdcShellBmDump; hdc.installHap = saved.installHap;
    hdc.parseInstalledBundleVersionFromDump = saved.parseInstalledBundleVersionFromDump; hdc.loadAppInstallCandidateMeta = saved.loadAppInstallCandidateMeta;
    bridge.ensureReadyBefore = saved.ensureReadyBefore;
    for (const [k, v] of [['HARNESS_DEVICE_TEST_FORCE_INSTALL', saved.envForce], ['HARNESS_SKIP_DEVICE_TEST_INSTALL', saved.envSkip], ['HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL', saved.envUninstall]] as Array<[string, string | undefined]>) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// B08 D1 V4：decideReuse 提取 isExecutionRecordReusable 后行为逐字不变——[success A] → [failed A] 不复用；
// 派生不齐（timing_complete=false）在身份判据里不是拒绝理由（decideReuse 走重建），采信不得比复用更严。
test('B08-V4 最新一条规则不变：[success A] → [failed A] → decideReuse 不复用；isExecutionRecordReusable 与之同源、派生不齐仍 ok', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const ek = require('../../../profiles/hmos-app/harness/execution-key') as typeof import('../../../profiles/hmos-app/harness/execution-key');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b08-exec-key-'));
  try {
    const key = 'a'.repeat(64);
    const inputs = { hap_sha256_full: 'h'.repeat(64), derived_plan_sha256: 'b'.repeat(64), device: 'dev-A', display_env: '', reset_mode: 'cold_restart', hylyre_version: '0.5.1', manifest_version: '0.5.1', profile: 'hmos-app', tool_config_sha256: 'c'.repeat(64), flags: [] };
    const writeRun = (stamp: string, outcome: string, timingComplete: boolean) => {
      const runDir = path.join(base, stamp, 'hylyre');
      fs.mkdirSync(runDir, { recursive: true });
      const tracePath = path.join(runDir, 'trace.json');
      fs.writeFileSync(tracePath, '{}');
      for (const f of ek.FROZEN_RUN_ARTIFACTS) fs.writeFileSync(path.join(runDir, f.frozen), '{}');
      ek.writeExecutionKeyRecord(runDir, {
        schema_version: '1.0', execution_key: key, inputs, trace_path: tracePath, run_started_at: new Date().toISOString(),
        outcome, trace_sha256: null, timing_complete: timingComplete, frozen_files: ek.FROZEN_RUN_ARTIFACTS.map(f => f.frozen),
      });
      return runDir;
    };
    const okDir = writeRun('20260907-000001', 'success', false);
    const rebuild = ek.decideReuse(base, key);
    assert.ok(rebuild.reusable && rebuild.evidenceRebuildRequired === true, `派生不齐 → 先重建：${JSON.stringify(rebuild)}`);
    const okRecord = JSON.parse(fs.readFileSync(path.join(okDir, ek.EXECUTION_KEY_FILE), 'utf-8'));
    assert.strictEqual(ek.isExecutionRecordReusable(okRecord, okDir, { executionKey: key }).ok, true, '身份判据：timing_complete=false 不是拒绝理由');
    assert.strictEqual(ek.isExecutionRecordReusable(okRecord, okDir, { executionKey: 'z'.repeat(64) }).ok, false, '身份判据：键不同拒');
    const failDir = writeRun('20260907-000002', 'failed', true);
    const later = ek.decideReuse(base, key);
    assert.strictEqual(later.reusable, null, '最新同键失败不得复用更早成功');
    assert.strictEqual(later.reason, '最新同键 run 20260907-000002 outcome=failed，重新真跑', 'decideReuse 原因逐字不变');
    const failRecord = JSON.parse(fs.readFileSync(path.join(failDir, ek.EXECUTION_KEY_FILE), 'utf-8'));
    const identity = ek.isExecutionRecordReusable(failRecord, failDir, { executionKey: key, label: '20260907-000002' });
    assert.deepStrictEqual(identity, { ok: false, reason: later.reason }, '采信端与 decideReuse 共用同一判据与原因');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// R8 生产入口版：「TC 仅关联 unit 层 AC」是计划契约错误，必须在 build/install/device 之前
// 拦住，并且短路文案要写真实原因（宿主案例里 AI 看不到跑机之后那条 MINOR 提示，于是改 UT、
// 改标 manual 绕了一大圈）。这里跑**完整 checker**，通道声明刻意闭合，排除"被通道门顺手拦下"。
function r8Fixture(): { root: string; planPath: string } {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const fixture = makeReportOnlyFixture();
  const planPath = path.join(fixture.root, 'doc', 'features', 'demo', 'testing', 'test-plan.md');
  fs.writeFileSync(planPath, [
    '## 测试用例', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| TC-001 | demo | app | tap | pass | P0 | AC-001 | hylyre |',
  ].join('\n'));
  return { root: fixture.root, planPath };
}

const R8_UNIT_ACCEPTANCE = {
  acceptance: { criteria: [{ id: 'AC-001', priority: 'P0', ut_layer: 'unit', description: 'RDB 去重' }] },
};

test('R8 完整 checker：TC 仅关联 unit 层 AC → 设备流水线零动作，device_test_run 短路文案写真实原因', async () => {
  const fs = require('fs') as typeof import('fs');
  const checker = require('../../scripts/check-testing').default as {
    check: (ctx: import('../../scripts/utils/types').CheckContext) => Promise<Array<import('../../scripts/utils/types').CheckResult>>;
  };
  const { root } = r8Fixture();
  try {
    const ctx = reportOnlyContext(root) as unknown as Record<string, unknown>;
    ctx.reportReconcileOnly = false;
    ctx.featureSpec = R8_UNIT_ACCEPTANCE;
    const { value, spawned } = withSpawnGuard(
      () => checker.check(ctx as unknown as import('../../scripts/utils/types').CheckContext),
    );
    const all = await value;

    const unitAc = all.filter(r => r.id === 'plan_references_unit_layer_ac');
    assert.strictEqual(unitAc.length, 1, `分层结果只算一次：${JSON.stringify(unitAc.map(r => r.status))}`);
    assert.strictEqual(unitAc[0]!.status, 'FAIL', unitAc[0]!.details);
    assert.strictEqual(unitAc[0]!.severity, 'BLOCKER', JSON.stringify(unitAc[0]));

    // 前置：通道声明本身是闭合的——所以下面的短路只可能来自 R8 这条门
    const channel = all.find(r => r.id === 'testing_execution_channel');
    assert.strictEqual(channel?.status, 'PASS', `通道门必须闭合：${JSON.stringify(channel)}`);

    const run = all.find(r => r.id === 'device_test_run');
    assert.strictEqual(run?.status, 'SKIP', JSON.stringify(run));
    assert.strictEqual(run?.severity, 'BLOCKER', JSON.stringify(run));
    assert.match(run!.details ?? '', /测试计划含仅关联 unit 层 AC 的用例，已在设备动作前停下/, run!.details);
    assert.ok(
      !(run!.details ?? '').includes('执行通道声明未闭合'),
      `短路文案不得沿用通道未闭合的假原因：${run!.details}`,
    );
    assert.match(run!.details ?? '', /TC-001/, run!.details);
    for (const id of ['device_test_build', 'device_test_install']) {
      assert.ok(!all.some(r => r.id === id), `不得启动设备流水线，却出现了 ${id}`);
    }
    assert.deepStrictEqual(spawned, [], `BLOCKER 短路后不得发生任何设备/工具进程调用：${spawned.join(' | ')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R8 完整 checker：--report-reconcile-only 不因该 BLOCKER 提前返回，仍完整只读分析', async () => {
  const fs = require('fs') as typeof import('fs');
  const checker = require('../../scripts/check-testing').default as {
    check: (ctx: import('../../scripts/utils/types').CheckContext) => Promise<Array<import('../../scripts/utils/types').CheckResult>>;
  };
  const { root } = r8Fixture();
  try {
    const ctx = reportOnlyContext(root) as unknown as Record<string, unknown>;
    ctx.reportReconcileOnly = true;
    ctx.featureSpec = R8_UNIT_ACCEPTANCE;
    const { value, spawned } = withSpawnGuard(
      () => checker.check(ctx as unknown as import('../../scripts/utils/types').CheckContext),
    );
    const all = await value;

    assert.strictEqual(
      all.find(r => r.id === 'plan_references_unit_layer_ac')?.status, 'FAIL',
      'report-only 也照常记账这条 BLOCKER',
    );
    // 只读重算照跑到底：报告重写 + 对账都必须产出（BLOCKER 不得把诊断路径一起关掉）
    assert.strictEqual(all.find(r => r.id === 'test_report_generated')?.status, 'PASS',
      `report-only 必须仍整份重写报告：${JSON.stringify(all.find(r => r.id === 'test_report_generated'))}`);
    assert.ok(all.some(r => r.id === 'report_reconcile_only'),
      `report-only 必须仍产出对账结果：${all.map(r => r.id).join(',')}`);
    assert.ok(
      !all.some(r => (r.details ?? '').includes('已在设备动作前停下')),
      'report-only 不走 R8 短路分支（只读分析照跑到底）',
    );
    assert.deepStrictEqual(spawned, [], `report-only 不得发生任何设备/工具进程调用：${spawned.join(' | ')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
