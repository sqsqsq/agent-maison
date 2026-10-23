import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assessObservation,
  observeFeatureState,
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
import { loadWorkflowSpec } from '../../workflow-loader';
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
  { name: '395 explicit device wait keeps current phase; ordinary defer and hard stops stay unchanged', run: () => {
    const recommendation: AssessRecommendation = { action: 'resolve_deferred', phase: 'ut', reason: 'device', requires_driver_authorization: true, runner_action: 'defer_external_and_continue_if_allowed' };
    const device = observation({ phase_outcome: { phase: 'ut', verdict: 'INCOMPLETE', legacy_action: 'none', blocking_class: 'externalBlocked', failure_kind: 'device_blocked' } });
    const base = { assessment: result(recommendation), observation: device, currentPhase: 'ut', chain };
    assert(selectRunnerActionFromAssess({ ...base, driverGuardAction: 'retry' }) === 'retry', 'explicit current-phase device wait');
    assert(selectRunnerActionFromAssess({ ...base, driverGuardAction: 'none' }) === 'defer_external_and_continue_if_allowed', 'ordinary defer unchanged');
    assert(selectRunnerActionFromAssess({ ...base, driverGuardAction: 'halt' }) === 'halt', 'authorization/budget halt wins');
    assert(selectRunnerActionFromAssess({ ...base, assessment: result(recommendation, true), driverGuardAction: 'retry' }) === 'halt', 'fused stop wins');
    assert(selectRunnerActionFromAssess({ ...base, assessment: result({ ...recommendation, action: 'stop' }), driverGuardAction: 'retry' }) === 'halt', 'stop recommendation wins');
  } },
  {
    name: '8d4e6a21 fresh facts-admission failure routes the earlier evidence gap before retry; product and stale-summary failures retain their path',
    run: () => {
      for (const [blocker, fresh, owner] of [['context_exploration_facts_source_stale', true, 'plan'], ['product_failure', true, 'testing'], ['context_exploration_facts_source_stale', false, 'testing']] as const) {
        const reconcile = observation({ current_summary_fresh: fresh, blockers: [{ id: blocker, actionability: 'automatic' }],
          phase_outcome: { phase: 'testing', verdict: 'FAIL', legacy_action: 'none', failure_kind: 'code_regression' },
          budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 }, invalidatable_phases: ['plan', 'coding', 'review', 'ut', 'testing'] });
        const baseline = result({ action: 'rerun_phase', phase: 'testing', reason: 'fixture', requires_driver_authorization: true });
        const phases = baseline.observed.phases.map(phase => ({ ...phase, verdict: phase.phase === 'testing' ? 'FAIL' : 'PASS',
          closure: phase.phase === 'plan' ? 'stale' as const : phase.phase === 'testing' ? 'open' as const : 'closed' as const }));
        const assessed = assessObservation({ schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full', goal_end: 'testing',
          phases, fingerprints: baseline.fingerprints, reconcile }, { mode: 'goal_mode' });
        assert(assessed.recommendation.phase === owner, JSON.stringify(assessed.recommendation));
        assert(selectRunnerActionFromAssess({ assessment: assessed, observation: reconcile, currentPhase: 'testing', chain, driverGuardAction: 'none' })
          === (owner === 'plan' ? 'backtrack_to_phase' : 'retry'), '责任动作须可执行');
        if (owner === 'plan') assert(selectRunnerActionFromAssess({ assessment: assessed, observation: { ...reconcile, invalidatable_phases: [] },
          currentPhase: 'testing', chain, driverGuardAction: 'none' }) === 'halt', '无失效授权仍不能执行回退');
      }
    },
  },
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
        responsibility: { workflow: loadWorkflowSpec(path.resolve(__dirname, '../../..'), 'obligation-driven') },
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
    // plan b7d2e9f4 §3.1/§3.2：宿主 be091c 形状——testing 旧摘要 FAIL 同时带外部 blocker 与 coding 候选，
    // 回退修完 coding→review→ut 全 PASS。延迟只认阶段自身结论，testing 是 failed 而非 deferred，链前进复跑。
    name: 'b7d2e9f4 be091c: testing FAIL + externalBlocked blocker is failed (not deferred) and the chain advances after ut PASS',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b7d2-be091c-'));
      try {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 'b7d2-be091c', project_profile: { name: 'generic' },
          paths: { features_dir: 'doc/features', reports_dir_pattern: 'doc/features/<feature>/<phase>/reports', docs_committed: false },
        }), 'utf-8');
        const featureDir = path.join(root, 'doc', 'features', 'demo');
        fs.mkdirSync(featureDir, { recursive: true });
        fs.writeFileSync(path.join(featureDir, 'feature.yaml'), 'schema_version: "1.0"\ntrack: full\n', 'utf-8');
        for (const phase of chain) {
          const reports = path.join(featureDir, phase, 'reports');
          fs.mkdirSync(reports, { recursive: true });
          fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify(phase === 'testing'
            ? {
                schema_version: '1.2', phase, feature: 'demo', verdict: 'FAIL', closure_status: 'open',
                blockers: [
                  { id: 'testing_failure_routing_TC-004_s11', status: 'FAIL' },
                  { id: 'visual_diff', status: 'FAIL', blocking_class: 'externalBlocked', failure_kind: 'capability_missing' },
                ],
                repair_candidates: [
                  { id: 'testing_failure_routing_TC-004_s11', category: 'coding', item_fingerprint: 'b'.repeat(64) },
                  { id: 'testing_failure_routing_TC-005_s11', category: 'coding', item_fingerprint: 'c'.repeat(64) },
                ],
              }
            : { schema_version: '1.2', phase, feature: 'demo', verdict: 'PASS', closure_status: 'closed' }), 'utf-8');
        }
        const observed = observeFeatureState({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'demo', goalEnd: 'testing' });
        const testing = observed.phases.find((p) => p.phase === 'testing');
        assert(testing?.deferred === false, `testing FAIL 不得判延迟：${JSON.stringify(testing)}`);
        assert(testing?.repair_candidates?.length === 2, JSON.stringify(testing));
        const reconcile = observation({
          phase_outcome: { phase: 'ut', verdict: 'PASS', legacy_action: 'advance' },
          budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 1 },
          invalidatable_phases: ['coding', 'review', 'ut'],
        });
        // 上游 PASS 阶段的闭环提交与 evidence 新鲜度不是本例对象：直接视为已闭环。
        const assessed = assessObservation({
          ...observed,
          phases: observed.phases.map((p) => (p.phase === 'testing' ? p : { ...p, closure: 'closed' as const })),
          reconcile,
        }, { mode: 'goal_mode' });
        assert(assessed.gaps[0]?.phase === 'testing' && assessed.gaps[0]?.kind === 'failed', JSON.stringify(assessed.gaps));
        assert(
          assessed.recommendation.action === 'rerun_phase' && assessed.recommendation.phase === 'testing',
          JSON.stringify(assessed.recommendation),
        );
        const action = selectRunnerActionFromAssess({
          assessment: assessed, observation: reconcile, currentPhase: 'ut', chain, driverGuardAction: 'none',
        });
        assert(action === 'advance', `expected advance (不再落 halt→framework_bug), got ${action}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'b7d2e9f4 downstream INCOMPLETE deferred phase: resolve_deferred review maps to advance, not halt',
    run: () => {
      const reconcile = observation({
        phase_outcome: { phase: 'coding', verdict: 'PASS', legacy_action: 'advance' },
        budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
        invalidatable_phases: ['spec', 'plan', 'coding'],
      });
      const assessed = assessObservation({
        schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full', goal_end: 'testing',
        phases: chain.map((phase) => ({
          phase, summary_state: 'current', schema_version: '1.2',
          verdict: phase === 'review' ? 'INCOMPLETE' : 'PASS',
          closure: phase === 'review' ? 'open' : 'closed', assurance: 'full',
          required_assurance: null, assurance_satisfied: null, deferred: phase === 'review',
          summary_fingerprint: phase, evidence_fingerprint: phase,
        })),
        fingerprints: {
          workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
          summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
        },
        reconcile,
      }, { mode: 'goal_mode' });
      assert(
        assessed.recommendation.action === 'resolve_deferred' && assessed.recommendation.phase === 'review',
        JSON.stringify(assessed.recommendation),
      );
      assert(selectRunnerActionFromAssess({
        assessment: assessed, observation: reconcile, currentPhase: 'coding', chain, driverGuardAction: 'none',
      }) === 'advance', 'downstream deferred phase must advance');
    },
  },
  {
    name: 'PASS does not advance past an earlier disk gap',
    run: () => {
      const reconcile = observation({
        phase_outcome: { phase: 'review', verdict: 'PASS', legacy_action: 'none' },
        budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
        invalidatable_phases: ['spec', 'plan', 'coding', 'review'],
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
      assert(assessed.recommendation.runner_action === 'backtrack_to_phase', JSON.stringify(assessed.recommendation));
      assert(selectRunnerActionFromAssess({
        assessment: assessed, observation: reconcile, currentPhase: 'review', chain,
        driverGuardAction: 'none',
      }) === 'backtrack_to_phase', 'PASS must execute the earlier gap recovery');
    },
  },
  {
    name: 'earlier-gap disposition is total across full/custom owner-current pairs',
    run: () => {
      const chains = [
        { phases: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], track: 'full' as const },
        { phases: ['discover', 'build', 'verify', 'ship'], track: 'full' as const },
      ];
      const recoverable = ['missing', 'failed', 'legacy_unverified', 'stale', 'insufficient_assurance', 'pruned'] as const;
      for (const topology of chains) {
        for (let currentIdx = 1; currentIdx < topology.phases.length; currentIdx += 1) {
          for (let ownerIdx = 0; ownerIdx < currentIdx; ownerIdx += 1) {
            for (const gapKind of recoverable) {
              const currentPhase = topology.phases[currentIdx];
              const ownerPhase = topology.phases[ownerIdx];
              const phases: AssessObservation['phases'] = topology.phases.map((phaseName) => ({
                phase: phaseName,
                summary_state: phaseName === ownerPhase && gapKind === 'missing'
                  ? 'missing'
                  : phaseName === ownerPhase && gapKind === 'legacy_unverified' ? 'legacy' : 'current',
                schema_version: phaseName === ownerPhase && gapKind === 'missing'
                  ? null
                  : phaseName === ownerPhase && gapKind === 'legacy_unverified' ? '1.1' : '1.2',
                verdict: phaseName === ownerPhase && gapKind === 'missing'
                  ? null
                  : phaseName === ownerPhase && gapKind === 'failed' ? 'FAIL' : 'PASS',
                closure: phaseName === ownerPhase && gapKind === 'stale' ? 'stale' : 'closed',
                assurance: phaseName === ownerPhase && gapKind === 'insufficient_assurance' ? 'degraded' : 'full',
                required_assurance: phaseName === ownerPhase && gapKind === 'insufficient_assurance' ? 'full' : null,
                assurance_satisfied: phaseName === ownerPhase && gapKind === 'insufficient_assurance' ? false : null,
                deferred: false,
                summary_fingerprint: phaseName,
                evidence_fingerprint: phaseName,
              }));
              const reconcile = observation({
                phase_outcome: { phase: currentPhase, verdict: 'PASS', legacy_action: 'advance' },
                invalidatable_phases: topology.phases.slice(0, currentIdx + 1),
                budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
              });
              const assessed = assessObservation({
                schema_version: '1.0', feature: 'demo', workflow: 'custom', track: topology.track,
                goal_end: topology.phases.at(-1)!, phases,
                ...(gapKind === 'pruned' ? {
                  pruned_propagations: [{
                    producer_phase: ownerPhase, producer_capability: 'producer',
                    downstream_phase: currentPhase, downstream_capability: 'consumer',
                    input_id: 'input', source: 'fixture',
                  }],
                } : {}),
                fingerprints: {
                  workflow: 'w', track: 't', goal: 'g', run_attempt: 'r',
                  summaries: 's', evidence: 'e', reconcile: 'c', observed: 'o',
                },
                reconcile,
              }, { mode: 'goal_mode' });
              assert(assessed.recommendation.phase === ownerPhase,
                `${topology.phases.join('→')} ${ownerPhase}/${currentPhase}/${gapKind}: ${JSON.stringify(assessed.recommendation)}`);
              assert(assessed.recommendation.runner_action === 'backtrack_to_phase',
                `${ownerPhase}/${currentPhase}/${gapKind} missing executable backtrack`);
              assert(selectRunnerActionFromAssess({
                assessment: assessed, observation: reconcile, currentPhase,
                chain: topology.phases, driverGuardAction: 'none',
              }) === 'backtrack_to_phase', `${ownerPhase}/${currentPhase}/${gapKind} driver action`);
            }
          }
        }
      }
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
      const runner = fs.readFileSync(path.resolve(__dirname, '../../scripts/goal-phase-runtime.ts'), 'utf8');
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
