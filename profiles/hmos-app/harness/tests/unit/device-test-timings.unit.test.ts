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
