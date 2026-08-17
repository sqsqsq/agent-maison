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
    // 责任阶段统一路由（plan b6e4c9f2）翻案：缺陷回退的唯一输入是 phase summary 的
    // repair_candidates（挂在 phase 观测上），deterministic_defects 已降为诊断投影、
    // **不再驱动路由**。本例保持"testing 缺陷→回 coding"的行为语义，只换事实来源。
    name: 'testing 可信缺陷（repair_candidates）→ assess 推荐 coding 并映射为回退',
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
        ...(phase === 'testing'
          ? {
              repair_candidates: [{
                id: 'visual_diff:add_card_home', category: 'coding' as const,
                item_fingerprint: 'd'.repeat(64), summary: 'must_fix 原文',
              }],
            }
          : {}),
      }));
      const reconcile = observation({
        phase_outcome: {
          phase: 'testing', verdict: 'FAIL', legacy_action: 'retry',
        },
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
      }) === 'backtrack_to_phase', 'runner mapping（统一路由后唯一回退动作）');
    },
  },
  {
    name: 'invalid backtrack target preserves explicit backtrack action for runner halt classification',
    run: () => {
      // 统一路由后唯一回退动作是 backtrack_to_phase；目标不在链内时仍须把回退意图带到
      // runner（由它落 backtrack_target_absent），不得在 driver 层吞成 halt。
      const recommendation: AssessRecommendation = {
        action: 'rerun_phase', phase: 'missing', reason: 'repair_candidates',
        requires_driver_authorization: true, runner_action: 'backtrack_to_phase',
      };
      assert(selectRunnerActionFromAssess({
        assessment: result(recommendation),
        observation: observation({ invalidatable_phases: ['missing'] }),
        currentPhase: 'testing', chain, driverGuardAction: 'none',
      }) === 'backtrack_to_phase', 'invalid target must reach explicit backtrack classification');
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
    name: 'PASS does not advance past an earlier disk gap',
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
      assert(assessed.recommendation.action === 'run_phase', JSON.stringify(assessed.recommendation));
      assert(assessed.recommendation.phase === 'spec', JSON.stringify(assessed.recommendation));
      assert(assessed.recommendation.runner_action === undefined, JSON.stringify(assessed.recommendation));
      assert(selectRunnerActionFromAssess({
        assessment: assessed, observation: reconcile, currentPhase: 'review', chain,
        driverGuardAction: 'none',
      }) !== 'advance', 'PASS must not skip an earlier gap');
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
      // f9c2e6b4 t3：原断言钉的是 `assess_halt:<reason>` 字面拼接。该写法已被证明会让
      // normalizeIncidentId 截成 `assess_halt` → registry 固定 operator → WAITING/human，
      // 把真实责任类别（内容失败 / 外部条件）抹平。现改为钉**责任类别不被洗白**这条契约。
      assert(
        !runner.includes("'assess_halt:' + assessReason"),
        'assess halt 不得再用 `assess_halt:<reason>` 拼接——会被 normalizeIncidentId 洗成通用 operator',
      );
      // b3e8d4c7 t3：判据已抽成 resolveAssessHaltIncident（纯函数，行为矩阵在
      // adjudication 套件里验）。这里只钉"runner 不得自己就地拼标签"这条契约。
      assert(
        runner.includes('resolveAssessHaltIncident({'),
        'assess-derived halt 须走 resolveAssessHaltIncident 统一判据',
      );
      assert(
        !/haltReason\s*=\s*EXTERNAL_RETRY_RESPONSIBILITY_KINDS/.test(runner),
        'runner 不得就地按 FailureKind 拼 halt 标签（判据只有一处）',
      );
      // plan f3a8c6d2 t2：reason 前会拼一个"gap 归属阶段"标注（crossPhaseNote），
      // 故不再要求 `reason: assessReason ||` 紧邻。守护的契约不变：assessReason 原文
      // 必须出现在 reason 字段的赋值里，只是允许前置补充说明。
      assert(
        /reason:[\s\S]{0,120}assessReason \|\|/.test(runner),
        '详细 assess 原因不得丢失（仍须原样写进 reason 字段）',
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
