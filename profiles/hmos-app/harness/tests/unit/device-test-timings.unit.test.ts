import { parseCaseDurationsFromLogAndTrace } from '../../device-test-timings';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'parseCaseDurationsFromLogAndTrace: 按 trace case 边界累加 log cost',
    run: () => {
      const log = `
uidriver.touch cost: 0.341s
uidriver.mouse_scroll cost: 0.356s
uidriver.touch cost: 0.289s
`;
      const trace = {
        tool_calls: [
          { case: 'TC-001' },
          { case: 'TC-001' },
          { case: 'TC-002' },
        ],
        cases: [{ id: 'TC-001' }, { id: 'TC-002' }],
      };
      const parsed = parseCaseDurationsFromLogAndTrace(log, trace);
      if (parsed.length !== 2) throw new Error(`case count: ${parsed.length}`);
      const tc1 = parsed.find(c => c.id === 'TC-001');
      const tc2 = parsed.find(c => c.id === 'TC-002');
      if (!tc1 || !tc2) throw new Error('missing tc');
      if (tc1.duration_ms !== 697) throw new Error(`TC-001 ms: ${tc1.duration_ms}`);
      if (tc2.duration_ms !== 289) throw new Error(`TC-002 ms: ${tc2.duration_ms}`);
    },
  },
  {
    name: 'parseCaseDurationsFromLogAndTrace: trace 中 pass+skip 全量保留，skip 为 0/0',
    run: () => {
      const parsed = parseCaseDurationsFromLogAndTrace(
        'uidriver.touch cost: 0.100s\nuidriver.touch cost: 0.200s\n',
        {
          tool_calls: [{ case: 'TC-001' }, { case: 'TC-001' }],
          cases: [
            { id: 'TC-001', status: '通过' },
            { id: 'TC-002', status: '跳过' },
          ],
        },
      );
      if (parsed.length !== 2) throw new Error(`case count: ${parsed.length}`);
      const pass = parsed.find(c => c.id === 'TC-001');
      const skip = parsed.find(c => c.id === 'TC-002');
      if (!pass || !skip) throw new Error('missing pass/skip case');
      if (pass.duration_ms !== 300 || pass.step_count !== 2) {
        throw new Error(`pass timing: ${JSON.stringify(pass)}`);
      }
      if (skip.duration_ms !== 0 || skip.step_count !== 0) {
        throw new Error(`skip timing: ${JSON.stringify(skip)}`);
      }
    },
  },
  {
    name: 'parseCaseDurationsFromLogAndTrace: native StepResult duration/ledger 优先于 log cost',
    run: () => {
      const parsed = parseCaseDurationsFromLogAndTrace(
        'uidriver.touch cost: 9.999s\nuidriver.touch cost: 8.888s\n',
        {
          schema_version: '0.4-p0',
          tool_calls: [
            { case: 'TC-001', status: 'passed' },
            { case: 'TC-001', status: 'blocked' },
            { case: 'TC-002', status: 'skipped' },
            { case: 'TC-002', kind: 'expected_check' },
          ],
          cases: [
            { id: 'TC-001', steps: [{ duration_ms: 123.4 }, { duration_ms: 7.6, status: 'blocked' }] },
            { id: 'TC-002', steps: [{ duration_ms: 0, status: 'skipped' }, { duration_ms: 45.2, kind: 'expected_check' }] },
          ],
        },
      );
      if (JSON.stringify(parsed) !== JSON.stringify([
        { id: 'TC-001', duration_ms: 131, step_count: 2 },
        { id: 'TC-002', duration_ms: 45, step_count: 2 },
      ])) {
        throw new Error(`native timing: ${JSON.stringify(parsed)}`);
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
