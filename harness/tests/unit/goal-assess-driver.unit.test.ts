import * as fs from 'fs';
import * as path from 'path';
import {
  assessObservation,
  type AssessObservation,
  type AssessRecommendation,
  type AssessResult,
  type ReconcileObservationV1,
} from '../../scripts/utils/assess';
import {
  checkAssessDrivenRunnerSource,
  selectRunnerActionFromAssess,
} from '../../scripts/utils/goal-assess-driver';
import { checkGoalReconcileBoundarySource } from '../../scripts/utils/goal-reconcile-boundary';
import type { PhaseVerdictAction } from '../../scripts/utils/phase-transition-policy';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function observation(overrides: Partial<ReconcileObservationV1> = {}): ReconcileObservationV1 {
  return {
    schema_version: '1.0',
    state: 'active',
    deterministic_defects: [],
    invalidatable_phases: [],
    ...overrides,
  };
}

function result(recommendation: AssessRecommendation, fused = false): AssessResult {
  return {
    schema_version: '1.0',
    kind: 'assess@1',
    feature: 'demo',
    workflow: 'spec-driven',
    track: 'full',
    goal_end: 'testing',
    authorization_context: { mode: 'goal_mode' },
    observed_fingerprint: 'observed',
    fingerprints: {
      workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
      summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
    },
    observed: { phases: chain.map((phase) => ({
      phase,
      summary_state: 'current',
      schema_version: '1.2',
      verdict: 'PASS',
      closure: 'closed',
      assurance: 'full',
      required_assurance: null,
      assurance_satisfied: null,
      deferred: false,
      summary_fingerprint: phase,
      evidence_fingerprint: phase,
    })) },
    gaps: [],
    recommendation,
    alternatives: [],
    stop: { fused, reason: fused ? 'fixture' : null },
    run_status_candidate: null,
    feature_completion: null,
    projection_fingerprint: 'p',
  };
}

function select(
  recommendation: AssessRecommendation,
  currentPhase: string,
  guard: PhaseVerdictAction,
  reconcile = observation(),
): PhaseVerdictAction {
  return selectRunnerActionFromAssess({
    assessment: result(recommendation),
    observation: reconcile,
    currentPhase,
    chain,
    driverGuardAction: guard,
  });
}

interface TestCase { name: string; run: () => void }
const cases: TestCase[] = [
  {
    name: 'assess selects same-phase retry, later advance, and completion advance',
    run: () => {
      assert(select({
        action: 'rerun_phase', phase: 'review', reason: 'failed',
        requires_driver_authorization: true,
      }, 'review', 'advance') === 'retry', 'same phase');
      assert(select({
        action: 'run_phase', phase: 'ut', reason: 'missing',
        requires_driver_authorization: true,
      }, 'review', 'retry') === 'advance', 'later phase');
      assert(select({
        action: 'validate_feature_completion', phase: null, reason: 'done',
        requires_driver_authorization: true,
      }, 'testing', 'retry') === 'advance', 'completion');
    },
  },
  {
    name: 'driver guard retains halt and external defer authorization',
    run: () => {
      const retry: AssessRecommendation = {
        action: 'rerun_phase', phase: 'testing', reason: 'failed',
        requires_driver_authorization: true,
      };
      assert(select(retry, 'testing', 'halt') === 'halt', 'halt guard');
      assert(
        select(retry, 'testing', 'defer_external_and_halt') === 'defer_external_and_halt',
        'defer guard',
      );
      assert(selectRunnerActionFromAssess({
        assessment: result(retry),
        observation: observation({
          phase_outcome: { phase: 'testing', verdict: 'PASS', legacy_action: 'retry' },
        }),
        currentPhase: 'testing', chain, driverGuardAction: 'retry',
      }) === 'retry', 'PASS evidence guard');
    },
  },
  {
    name: 'deterministic testing defect is recommended and mapped back to coding',
    run: () => {
      const phases: AssessObservation['phases'] = chain.map((phase) => ({
        phase,
        summary_state: 'current',
        schema_version: '1.2',
        verdict: phase === 'testing' ? 'FAIL' : 'PASS',
        closure: phase === 'testing' ? 'open' : 'closed',
        assurance: 'full',
        required_assurance: null,
        assurance_satisfied: null,
        deferred: false,
        summary_fingerprint: phase,
        evidence_fingerprint: phase,
      }));
      const reconcile = observation({
        phase_outcome: {
          phase: 'testing', verdict: 'FAIL', legacy_action: 'backtrack_to_coding',
        },
        deterministic_defects: ['visual_score_floor'],
        invalidatable_phases: ['coding', 'review', 'ut', 'testing'],
      });
      const assessed = assessObservation({
        schema_version: '1.0',
        feature: 'demo',
        workflow: 'spec-driven',
        track: 'full',
        goal_end: 'testing',
        phases,
        fingerprints: {
          workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
          summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
        },
        reconcile,
      }, { mode: 'goal_mode' });
      assert(assessed.recommendation.phase === 'coding', 'assess must recommend coding');
      assert(selectRunnerActionFromAssess({
        assessment: assessed,
        observation: reconcile,
        currentPhase: 'testing',
        chain,
        driverGuardAction: 'retry',
      }) === 'backtrack_to_coding', 'runner mapping');
    },
  },
  {
    name: 'invalid backtrack target preserves explicit backtrack action for runner halt classification',
    run: () => {
      const recommendation: AssessRecommendation = {
        action: 'run_phase', phase: 'missing', reason: 'deterministic defect',
        requires_driver_authorization: true, runner_action: 'backtrack_to_coding',
      };
      assert(selectRunnerActionFromAssess({
        assessment: result(recommendation),
        observation: observation({ deterministic_defects: ['gate'], invalidatable_phases: ['missing'] }),
        currentPhase: 'testing', chain, driverGuardAction: 'none',
      }) === 'backtrack_to_coding', 'invalid target must reach explicit backtrack classification');
    },
  },
  {
    name: 'assess preserves DEFERRED propagation action from phase-transition SSOT',
    run: () => {
      for (const [propagate, expected] of [
        [true, 'defer_external_and_continue_if_allowed'],
        [false, 'defer_external_and_halt'],
      ] as const) {
        const reconcile = observation({
          phase_outcome: {
            phase: 'ut',
            verdict: 'INCOMPLETE',
            legacy_action: 'none',
            failure_kind: 'device_blocked',
            blocking_class: 'externalBlocked',
            dependency_policy: {
              deferrable_blocking_classes: ['externalBlocked'],
              deferrable_failure_kinds: ['device_blocked'],
              propagate_to_downstream: propagate,
            },
          },
          budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
        });
        const input: AssessObservation = {
          schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full',
          goal_end: 'testing',
          phases: chain.map((phase) => ({
            phase, summary_state: 'current', schema_version: '1.2',
            verdict: phase === 'ut' ? 'INCOMPLETE' : 'PASS',
            closure: phase === 'ut' ? 'open' : 'closed', assurance: 'full',
            required_assurance: null, assurance_satisfied: null, deferred: phase === 'ut',
            summary_fingerprint: phase, evidence_fingerprint: phase,
          })),
          fingerprints: {
            workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
            summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
          },
          reconcile,
        };
        const assessed = assessObservation(input, { mode: 'goal_mode' });
        assert(assessed.recommendation.action === 'resolve_deferred', 'deferred recommendation');
        assert(assessed.recommendation.runner_action === expected, 'SSOT action lost');
        assert(selectRunnerActionFromAssess({
          assessment: assessed, observation: reconcile, currentPhase: 'ut', chain,
          driverGuardAction: 'none',
        }) === expected, `expected ${expected}`);
      }
    },
  },
  {
    name: 'PASS advances from current phase even when an earlier disk gap exists',
    run: () => {
      const reconcile = observation({
        phase_outcome: { phase: 'review', verdict: 'PASS', legacy_action: 'none' },
        budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
      });
      const assessed = assessObservation({
        schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full',
        goal_end: 'testing',
        phases: chain.map((phase) => ({
          phase,
          summary_state: phase === 'spec' || phase === 'ut' ? 'missing' : 'current',
          schema_version: phase === 'spec' || phase === 'ut' ? null : '1.2',
          verdict: phase === 'spec' || phase === 'ut' ? null : 'PASS',
          closure: phase === 'spec' || phase === 'ut' ? 'open' : 'closed',
          assurance: phase === 'spec' || phase === 'ut' ? 'unknown' : 'full',
          required_assurance: null, assurance_satisfied: null, deferred: false,
          summary_fingerprint: null, evidence_fingerprint: null,
        })),
        fingerprints: {
          workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
          summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
        },
        reconcile,
      }, { mode: 'goal_mode' });
      assert(assessed.recommendation.phase === 'ut', JSON.stringify(assessed.recommendation));
      assert(assessed.recommendation.runner_action === 'advance', 'advance marker lost');
      assert(selectRunnerActionFromAssess({
        assessment: assessed, observation: reconcile, currentPhase: 'review', chain,
        driverGuardAction: 'none',
      }) === 'advance', 'PASS must advance');
    },
  },
  {
    name: 'PASS with current insufficient assurance retries within budget then halts',
    run: () => {
      for (const [retriesUsed, expected] of [[0, 'retry'], [2, 'halt']] as const) {
        const reconcile = observation({
          phase_outcome: { phase: 'review', verdict: 'PASS', legacy_action: 'none' },
          budgets: { retries_used: retriesUsed, max_retries_per_phase: 2, backtracks_used: 0 },
        });
        const assessed = assessObservation({
          schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full',
          goal_end: 'testing',
          phases: chain.map((phase) => ({
            phase,
            summary_state: 'current',
            schema_version: '1.2',
            verdict: 'PASS',
            closure: 'closed',
            assurance: phase === 'review' ? 'degraded' : 'full',
            required_assurance: phase === 'review' ? 'full' : null,
            assurance_satisfied: phase === 'review' ? false : null,
            deferred: false,
            summary_fingerprint: phase,
            evidence_fingerprint: phase,
          })),
          fingerprints: {
            workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
            summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
          },
          reconcile,
        }, { mode: 'goal_mode' });
        assert(assessed.recommendation.phase === 'review', JSON.stringify(assessed.recommendation));
        assert(assessed.recommendation.runner_action === expected, `expected ${expected}`);
        assert(selectRunnerActionFromAssess({
          assessment: assessed, observation: reconcile, currentPhase: 'review', chain,
          driverGuardAction: 'none',
        }) === expected, `driver expected ${expected}`);
      }
    },
  },
  {
    name: 'same-phase FAIL stops when retry budget is exhausted',
    run: () => {
      const reconcile = observation({
        phase_outcome: { phase: 'ut', verdict: 'FAIL', legacy_action: 'none' },
        budgets: { retries_used: 2, max_retries_per_phase: 2, backtracks_used: 0 },
      });
      const assessed = assessObservation({
        schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full',
        goal_end: 'testing',
        phases: chain.map((phase) => ({
          phase, summary_state: 'current', schema_version: '1.2',
          verdict: phase === 'ut' ? 'FAIL' : 'PASS',
          closure: phase === 'ut' ? 'open' : 'closed', assurance: 'full',
          required_assurance: null, assurance_satisfied: null, deferred: false,
          summary_fingerprint: phase, evidence_fingerprint: phase,
        })),
        fingerprints: {
          workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
          summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
        },
        reconcile,
      }, { mode: 'goal_mode' });
      assert(assessed.recommendation.action === 'stop', JSON.stringify(assessed.recommendation));
      assert(selectRunnerActionFromAssess({
        assessment: assessed, observation: reconcile, currentPhase: 'ut', chain,
        driverGuardAction: 'none',
      }) === 'halt', 'exhausted retry budget must halt');
    },
  },  {
    name: 'runner source has one assess selection boundary and no legacy passthrough',
    run: () => {
      const runner = fs.readFileSync(path.resolve(__dirname, '../../scripts/goal-runner.ts'), 'utf8');
      const errors = [
        ...checkAssessDrivenRunnerSource(runner),
        ...checkGoalReconcileBoundarySource(runner),
      ];
      assert(errors.length === 0, errors.join('; '));
      assert(
        runner.includes("haltReason = assessReason ? 'assess_halt:' + assessReason.slice(0, 160) : 'assess_halt';"),
        'assess-derived halt must get a named reason',
      );
      assert(
        /insufficient_assurance\/advance_blocked 时 retries_used 永远为 0，只能靠全局轮数兜底。\r?\n\s*retries\+\+;/.test(runner),
        'agent timeout retry must consume phase budget',
      );
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((test) => {
    try {
      test.run();
      return { name: test.name, ok: true };
    } catch (error) {
      return { name: test.name, ok: false, error: (error as Error).message };
    }
  });
}
