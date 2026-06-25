/**
 * testing-trace-gates — unit tests for Hylyre outcome gate & report reconciliation.
 */

import * as assert from 'assert';
import {
  evaluateHylyreRunOutcome,
  reconcileReportWithHylyreTrace,
  evaluateUiEntryCoverage,
  parseReportExecutionResults,
  buildEntryUiPriorityMap,
} from '../../scripts/utils/testing-trace-gates';
import type { HylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import type { UseCasesSpec } from '../../scripts/utils/types';

import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

test('evaluateHylyreRunOutcome: partial outcome → fail', () => {
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
  assert.ok(r.reasonLines.some(l => l.includes('partial')));
});

test('evaluateHylyreRunOutcome: success all pass → pass', () => {
  const trace: HylyreTrace = {
    schema_version: '0.2-p4',
    feature: 'f',
    phase: 'testing',
    outcome: 'success',
    cases: [{ id: 'TC-001', status: '通过' }],
  };
  assert.strictEqual(evaluateHylyreRunOutcome(trace).verdict, 'pass');
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
