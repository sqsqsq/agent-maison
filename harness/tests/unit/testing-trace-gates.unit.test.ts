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
import { computeHapBuildFingerprint } from '../../../profiles/hmos-app/harness/build-fingerprint';
import { parseCaseDurationsFromLogAndTrace } from '../../../profiles/hmos-app/harness/device-test-timings';
import type { UseCasesSpec } from '../../scripts/utils/types';

import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void): void {
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

  const t0 = Date.now();
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

test('trace pass+skip: timing keeps skip as 0/0 and report reconciliation passes with 0ms', () => {
  const timingCases = parseCaseDurationsFromLogAndTrace(
    'uidriver.touch cost: 1.234s\n',
    {
      tool_calls: [{ case: 'TC-001' }],
      cases: [{ id: 'TC-001', status: '通过' }, { id: 'TC-002', status: '跳过' }],
    },
  );
  assert.deepStrictEqual(timingCases, [
    { id: 'TC-001', duration_ms: 1234, step_count: 1 },
    { id: 'TC-002', duration_ms: 0, step_count: 0 },
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
    '| TC-001 | 通过 | 1234ms |', '| TC-002 | 跳过 | 0ms |',
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

test('report-reconcile-only: 拒绝跨轮时间/复用/feature/case/duration 错配', () => {
  const fs = require('fs') as typeof import('fs');
  const mutations: Array<{ name: string; apply: (fixture: ReportOnlyFixture) => void; expected: RegExp }> = [
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
      expected: /timing\.pipeline\.build_reused/,
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
    },
  ];

  for (const mutation of mutations) {
    const fixture = makeReportOnlyFixture();
    try {
      mutation.apply(fixture);
      const result = __testing_checkReportReconcileOnlyPipeline(reportOnlyContext(fixture.root))[0]!;
      assert.strictEqual(result.status, 'FAIL', `${mutation.name} should fail\n${result.details}`);
      assert.match(result.details ?? '', mutation.expected, `${mutation.name}\n${result.details}`);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('report-reconcile-only: 缺最终 timing 时 fail-closed，不降级为局部重算', () => {
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
  assert.match(result.details, /device-test-timing\.json/);
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

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
