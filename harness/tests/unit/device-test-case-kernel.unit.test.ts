import { normalizeDeviceTestCases } from '../../scripts/utils/device-test-case-kernel';
import type { AcceptanceSpec } from '../../scripts/utils/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function run(): void {
  const adhoc = normalizeDeviceTestCases({
    mode: 'adhoc',
    natural_language: '打开首页 -> 点击设置；确认标题',
  });
  assert(adhoc.depth === 'adhoc', 'adhoc depth');
  assert(adhoc.cases.length === 1, 'adhoc should normalize to one case');
  assert(adhoc.cases[0].steps.length >= 2, 'adhoc steps should use shared NL splitter');
  assert(adhoc.issues.length === 0, 'valid adhoc should have no issues');

  const acceptance = {
    feature: 'demo',
    source: 'test',
    version: '1',
    criteria: [
      {
        id: 'AC-1',
        prd_function: null,
        priority: 'P0',
        description: 'device case',
        testable: true,
        verification_steps: ['tap'],
        expected_result: 'done',
        ut_layer: 'device',
      },
      {
        id: 'AC-2',
        prd_function: null,
        priority: 'P0',
        description: 'unit only',
        testable: true,
        verification_steps: ['call'],
        expected_result: 'done',
        ut_layer: 'unit',
      },
    ],
    boundaries: [{
      id: 'BD-0',
      prd_exception: 'legacy-no-priority',
      priority: '   ',
      scenario: 'disconnect legacy',
      description: 'legacy boundary',
      handling: 'stop',
      expected_behavior: 'message',
      ut_layer: 'device',
    }, {
      id: 'BD-1',
      prd_exception: 'offline',
      scenario: 'disconnect',
      description: 'offline fallback',
      priority: 'P1',
      handling: 'retry',
      expected_behavior: 'message',
      ut_layer: 'both',
    }],
  } as AcceptanceSpec;
  const phase = normalizeDeviceTestCases({ mode: 'acceptance', acceptance });
  assert(phase.depth === 'full', 'acceptance depth');
  assert(phase.cases.map((item) => item.source_ref).join(',') === 'AC-1,BD-0,BD-1', 'device scope only');
  assert(phase.issues.length === 0, 'valid acceptance should have no issues');
  assert(phase.cases.find((item) => item.source_ref === 'BD-0')?.priority === 'P1',
    'legacy boundary without priority must be retained conservatively');

  const empty = normalizeDeviceTestCases({ mode: 'adhoc', natural_language: '   ' });
  assert(empty.issues.length === 1, 'empty adhoc must fail the common case contract');
}

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  try {
    run();
    return [{ name: 'phase 与 adhoc 共用 cases 归一/校验内核', ok: true }];
  } catch (error) {
    return [{ name: 'phase 与 adhoc 共用 cases 归一/校验内核', ok: false, error: (error as Error).message }];
  }
}
