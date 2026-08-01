import {
  deriveReconcileObservation,
  preserveLegacyAction,
} from '../../scripts/utils/goal-reconcile-observation';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => void }

const cases: TestCase[] = [
  {
    name: 'boundary extracts verdict, actionability, defects, budgets, invalidations, and signals',
    run: () => {
      const observation = deriveReconcileObservation({
        phase: 'testing',
        verdict: 'FAIL',
        legacyAction: 'backtrack_to_coding',
        failureKind: 'visual_defect',
        blockers: [
          { id: 'visual_diff', blocking_class: 'code_quality' },
          { id: 'device_missing', blocking_class: 'external_device' },
        ],
        deterministicDefects: ['layout-overlap', 'layout-overlap'],
        retriesUsed: 2,
        backtracksUsed: 1,
        repeatedCount: 3,
        invalidatablePhases: ['coding', 'review', 'ut', 'testing'],
        timedOut: true,
        apiDisconnected: true,
      });
      assert(observation.phase_outcome?.legacy_action === 'backtrack_to_coding', 'action');
      assert(observation.blockers?.[0].actionability === 'automatic', 'automatic blocker');
      assert(observation.blockers?.[1].actionability === 'external', 'external blocker');
      assert(observation.deterministic_defects?.length === 1, 'dedupe defects');
      assert(observation.budgets?.retries_used === 2, 'budget');
      assert(observation.signals?.timed_out === true, 'signal');
    },
  },
  {
    name: 'extraction pass-through preserves existing action sequence',
    run: () => {
      for (const action of ['advance', 'retry', 'halt', 'backtrack_to_coding']) {
        const observation = deriveReconcileObservation({
          phase: 'review',
          verdict: action === 'advance' ? 'PASS' : 'FAIL',
          legacyAction: action,
          retriesUsed: 0,
          backtracksUsed: 0,
        });
        assert(preserveLegacyAction(observation, action) === action, `action=${action}`);
      }
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
