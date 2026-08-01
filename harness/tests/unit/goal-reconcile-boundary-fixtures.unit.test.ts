import {
  deriveReconcileObservation,
  preserveLegacyAction,
} from '../../scripts/utils/goal-reconcile-observation';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const fixtures = [
  {
    name: 'happy-terminal',
    events: [
      { phase: 'spec', verdict: 'PASS', action: 'advance' },
      { phase: 'plan', verdict: 'PASS', action: 'advance' },
    ],
  },
  {
    name: 'retry-then-advance',
    events: [
      { phase: 'coding', verdict: 'FAIL', action: 'retry' },
      { phase: 'coding', verdict: 'PASS', action: 'advance' },
    ],
  },
  {
    name: 'testing-backtrack',
    events: [
      { phase: 'testing', verdict: 'FAIL', action: 'backtrack_to_coding' },
      { phase: 'coding', verdict: 'PASS', action: 'advance' },
    ],
  },
  {
    name: 'external-defer-halt',
    events: [
      { phase: 'testing', verdict: 'INCOMPLETE', action: 'defer_external_and_halt' },
    ],
  },
  {
    name: 'fused-halt',
    events: [
      { phase: 'review', verdict: 'FAIL', action: 'halt' },
    ],
  },
] as const;

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return fixtures.map((fixture) => {
    try {
      const before = fixture.events.map((event) => event.action);
      const after = fixture.events.map((event, index) => {
        const observation = deriveReconcileObservation({
          phase: event.phase,
          verdict: event.verdict,
          legacyAction: event.action,
          retriesUsed: event.action === 'retry' ? 1 : 0,
          backtracksUsed: event.action === 'backtrack_to_coding' ? 1 : 0,
          fused: event.action === 'halt',
          fuseReason: event.action === 'halt' ? 'fixture_halt' : undefined,
          repeatedCount: index,
        });
        return preserveLegacyAction(observation, event.action);
      });
      assert(JSON.stringify(before) === JSON.stringify(after), `${fixture.name} action sequence changed`);
      return { name: `boundary fixture: ${fixture.name}`, ok: true };
    } catch (error) {
      return { name: `boundary fixture: ${fixture.name}`, ok: false, error: (error as Error).message };
    }
  });
}
