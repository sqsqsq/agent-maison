// ============================================================================
// assess.unit.test.ts — deterministic diff/recommend/fuse behavior
// ============================================================================

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { runlessCompletionThenRevision, setupRunlessProject } from './execution-scope.unit.test';
import {
  assessObservation,
  assessFeature,
  observeFeatureState,
  nextProjectionPath,
  readFreshNextOrRecompute,
  type AssessObservation,
  type AssessPhaseObservation,
} from '../../scripts/utils/assess';
import { parseAssessCliArgs } from '../../scripts/assess';
import { buildGoalManifestFromInput, computeManifestIdentityFields, writeGoalManifest } from '../../scripts/utils/goal-manifest';
import {
  __testing_resetAssessRenderer,
  assessAndRenderNextStep,
  formatAssessNextStep,
} from '../../scripts/utils/assess-renderer';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case {
  name: string;
  run: () => void;
}

const H = 'a'.repeat(64);
const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS_ROOT = path.resolve(__dirname, '..', '..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assess-'));
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1',
    project_name: 'assess-test',
    active_workflow: 'spec-driven',
    project_profile: { name: 'generic' },
    agent_adapter: 'generic',
    architecture: {
      outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['content'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ts',
    },
    paths: {
      features_dir: 'doc/features',
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    },
  }), 'utf8');
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
  return root;
}

function goalInput(minimum: Record<string, string>): Record<string, unknown> {
  return {
    feature: 'demo',
    minimum_assurance: minimum,
    unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
  };
}


function phase(overrides: Partial<AssessPhaseObservation> = {}): AssessPhaseObservation {
  return {
    phase: 'spec',
    summary_state: 'current',
    schema_version: '1.2',
    verdict: 'PASS',
    closure: 'closed',
    assurance: 'full',
    required_assurance: null,
    assurance_satisfied: null,
    deferred: false,
    summary_fingerprint: H,
    evidence_fingerprint: H,
    ...overrides,
  };
}

function observation(
  phaseOverrides: Partial<AssessPhaseObservation> = {},
  reconcile: AssessObservation['reconcile'] = null,
): AssessObservation {
  return {
    schema_version: '1.0',
    feature: 'demo',
    workflow: 'spec-driven',
    track: 'full',
    goal_end: 'spec',
    phases: [phase(phaseOverrides)],
    fingerprints: {
      workflow: H,
      track: H,
      goal: H,
      run_attempt: H,
      summaries: H,
      evidence: H,
      reconcile: H,
      observed: H,
    },
    reconcile,
  };
}

const authorizedDegradationCase: Case = {
  name: 'floor-satisfying pruned capability is observed as a controlled degradation without a parallel gap',
  run: () => {
    const root = mkProject();
    try {
      const reports = path.join(root, 'doc', 'features', 'demo', 'spec', 'reports');
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({
        schema_version: '1.2',
        verdict: 'PASS',
        assurance: 'degraded',
        capability_resolutions: [{ id: 'capability_optional_visual', axis: 'visual', active: true, state: 'pruned' }],
      }), 'utf8');
      const observed = observeFeatureState({
        projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', goalEnd: 'spec',
        minimumAssurance: { spec: 'degraded' },
      });
      assert(observed.degradations?.length === 1, JSON.stringify(observed.degradations));
      assert(observed.degradations?.[0]?.reason_code === 'capability_pruned', JSON.stringify(observed.degradations));
      const result = assessObservation(observed);
      assert(!result.gaps.some((gap) => gap.kind === 'insufficient_assurance'), JSON.stringify(result.gaps));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
const prunedPropagationCase: Case = {
  name: 'upstream pruned becomes a producer-targeted gap only when it blocks a downstream core capability',
  run: () => {
    const root = mkProject();
    try {
      for (const [phaseName, capability_resolutions] of [
        ['spec', [{ id: 'capability_spec_optional', axis: 'visual', active: true, state: 'pruned', on_missing: 'prune', inputs: [] }]],
        ['plan', [{
          id: 'capability_plan_core', axis: 'functional', active: true, state: 'blocked', on_missing: 'fail',
          inputs: [{ id: 'spec_input', attempts: [{ kind: 'artifact', source: 'spec@1', state: 'absent', dependencies: [], upstream_producer: 'spec' }] }],
        }]],
      ] as Array<[string, unknown[]]>) {
        const reports = path.join(root, 'doc', 'features', 'demo', phaseName, 'reports');
        fs.mkdirSync(reports, { recursive: true });
        fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({
          schema_version: '1.2', verdict: phaseName === 'spec' ? 'PASS' : 'INCOMPLETE',
          assurance: phaseName === 'spec' ? 'degraded' : 'blocked', capability_resolutions,
        }), 'utf8');
      }
      const observed = observeFeatureState({
        projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', goalEnd: 'plan',
      });
      assert(observed.pruned_propagations?.length === 1, JSON.stringify(observed.pruned_propagations));
      const result = assessObservation(observed);
      assert(result.gaps[0]?.kind === 'pruned', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'restore_inputs_and_rerun', JSON.stringify(result.recommendation));
      assert(result.recommendation.phase === 'spec', JSON.stringify(result.recommendation));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
const producerOwnedInputGapCase: Case = {
  name: 'P2-T5 a blocked downstream SourceAttempt returns to its frozen upstream producer',
  run: () => {
    const root = mkProject();
    try {
      const reports = path.join(root, 'doc', 'features', 'demo', 'plan', 'reports');
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({
        schema_version: '1.2', verdict: 'INCOMPLETE', assurance: 'blocked',
        capability_resolutions: [{
          id: 'capability_plan_core', axis: 'functional', active: true, state: 'blocked', on_missing: 'fail',
          inputs: [{ id: 'acceptance', attempts: [{ kind: 'artifact', source: 'acceptance@1', state: 'absent', dependencies: [], upstream_producer: 'spec' }] }],
        }],
      }));
      const observed = observeFeatureState({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', goalEnd: 'plan' });
      const plan = observed.phases.find(item => item.phase === 'plan')!;
      assert(plan.deferred === false, JSON.stringify(plan));
      assert(plan.blocked_capabilities?.[0]?.unresolved[0]?.upstream_producer === 'spec', JSON.stringify(plan));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }

    const phases: AssessObservation['phases'] = [
      phase({ phase: 'spec' }),
      phase({
        phase: 'plan', verdict: 'FAIL', closure: 'open', deferred: false,
        blocked_capabilities: [{
          capability: 'capability_plan_core', axis: 'functional', applicability_provider: null,
          applicability_dependencies: [],
          unresolved: [{ input: 'acceptance', source: 'acceptance@1',
            upstream_producer: 'spec', detail: 'acceptance@1 missing', dependencies: [] }],
        }],
      }),
    ];
    const reconcile: AssessObservation['reconcile'] = {
      schema_version: '1.0', state: 'active',
      phase_outcome: { phase: 'plan', verdict: 'FAIL', legacy_action: 'retry' },
      budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
      residual_fingerprints: [], invalidatable_phases: ['spec', 'plan'],
    };
    const assessed = assessObservation({
      schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full', goal_end: 'plan', phases,
      fingerprints: { workflow: H, track: H, goal: H, run_attempt: H, summaries: H, evidence: H, reconcile: H, observed: H },
      reconcile,
    }, { mode: 'goal_mode' });
    assert(assessed.gaps[0]?.phase === 'spec' && assessed.gaps[0]?.detail.includes('acceptance@1'), JSON.stringify(assessed.gaps));
    assert(assessed.recommendation.phase === 'spec' && assessed.recommendation.runner_action === 'backtrack_to_phase', JSON.stringify(assessed.recommendation));
  },
};
const cases: Case[] = [
  authorizedDegradationCase,
  prunedPropagationCase,
  producerOwnedInputGapCase,
  {
    name: 'P2-T5 fresh coding regression wins over unrelated stale plan observation',
    run: () => {
      const phases = [
        phase({ phase: 'plan', closure: 'stale', closure_stale_detail: 'src/demo/value.ts' }),
        phase({ phase: 'coding', verdict: 'FAIL', closure: 'open' }),
      ];
      const result = assessObservation({
        schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full', goal_end: 'coding', phases,
        fingerprints: { workflow: H, track: H, goal: H, run_attempt: H, summaries: H, evidence: H, reconcile: H, observed: H },
        reconcile: {
          schema_version: '1.0', state: 'active',
          phase_outcome: { phase: 'coding', verdict: 'FAIL', legacy_action: 'retry', failure_kind: 'code_regression' },
          budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
          residual_fingerprints: [], invalidatable_phases: ['plan', 'coding'],
        },
      }, { mode: 'goal_mode' });
      assert(result.recommendation.phase === 'coding' && result.recommendation.runner_action === 'retry', JSON.stringify(result.recommendation));
    },
  },
  {
    name: 'P2-T5 external defer wins over a simultaneous upstream producer input',
    run: () => {
      const phases = [phase({ phase: 'spec' }), phase({
        phase: 'plan', verdict: 'INCOMPLETE', closure: 'open', deferred: true,
        blocked_capabilities: [{
          capability: 'capability_plan_core', axis: 'functional', applicability_provider: null,
          applicability_dependencies: [], unresolved: [{ input: 'acceptance', source: 'acceptance@1', upstream_producer: 'spec', dependencies: [] }],
        }],
      })];
      const result = assessObservation({
        schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full', goal_end: 'plan', phases,
        fingerprints: { workflow: H, track: H, goal: H, run_attempt: H, summaries: H, evidence: H, reconcile: H, observed: H },
        reconcile: {
          schema_version: '1.0', state: 'active',
          phase_outcome: { phase: 'plan', verdict: 'INCOMPLETE', legacy_action: 'none', failure_kind: 'device_blocked', blocking_class: 'externalBlocked', dependency_policy: { deferrable_blocking_classes: ['externalBlocked'], deferrable_failure_kinds: ['device_blocked'], propagate_to_downstream: false } },
          budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 }, residual_fingerprints: [],
        },
      }, { mode: 'goal_mode' });
      assert(result.recommendation.action === 'resolve_deferred' && result.recommendation.runner_action === 'defer_external_and_halt', JSON.stringify(result.recommendation));
    },
  },
  {
    name: 'P2-T5 stale owner input is display-only while the current harness failure decides',
    run: () => {
      const phases = [phase({ phase: 'spec' }), phase({
        phase: 'plan', verdict: 'FAIL', closure: 'open', deferred: false,
        blocked_capabilities: [{
          capability: 'capability_plan_core', axis: 'functional', applicability_provider: null,
          applicability_dependencies: [], unresolved: [{ input: 'acceptance', source: 'acceptance@1', upstream_producer: 'spec', dependencies: [] }],
        }],
      })];
      const assess = (fresh: boolean) => assessObservation({
        schema_version: '1.0', feature: 'demo', workflow: 'spec-driven', track: 'full', goal_end: 'plan', phases,
        fingerprints: { workflow: H, track: H, goal: H, run_attempt: H, summaries: H, evidence: H, reconcile: H, observed: H },
        reconcile: {
          schema_version: '1.0', state: 'active', current_summary_fresh: fresh,
          phase_outcome: { phase: 'plan', verdict: 'FAIL', legacy_action: 'halt', failure_kind: 'deterministic_gate_or_artifact_missing' },
          budgets: { retries_used: 2, max_retries_per_phase: 2, backtracks_used: 0 }, residual_fingerprints: [],
        },
      }, { mode: 'goal_mode' });
      const stale = assess(false);
      assert(stale.recommendation.phase !== 'spec' && stale.recommendation.runner_action === 'halt', JSON.stringify(stale.recommendation));
      const fresh = assess(true);
      assert(fresh.recommendation.phase === 'spec' && fresh.recommendation.runner_action === 'backtrack_to_phase', JSON.stringify(fresh.recommendation));
    },
  },
  {
    name: 'no-reconcile multi-phase gaps choose the first workflow gap',
    run: () => {
      const multi = observation();
      multi.goal_end = 'plan';
      multi.phases = [
        phase({ phase: 'spec', summary_state: 'missing', schema_version: null, verdict: null, closure: 'open', assurance: 'unknown' }),
        phase({ phase: 'plan', summary_state: 'missing', schema_version: null, verdict: null, closure: 'open', assurance: 'unknown' }),
      ];
      const result = assessObservation(multi);
      assert(result.recommendation.action === 'run_phase', JSON.stringify(result.recommendation));
      assert(result.recommendation.phase === 'spec', JSON.stringify(result.recommendation));
    },
  },  {
    name: 'assess CLI --no-write maps to write=false',
    run: () => {
      const argv = parseAssessCliArgs(['--feature', 'demo', '--no-write']);
      assert(argv.write === false, JSON.stringify(argv));
    },
  },
  {
    // plan c4e7a9b2 §3.5 / §6 D-2：无 run 时推荐以完成评估入口为准，CLI stdout 与 next.json 同源。
    name: 'D-2 无 run CLI：评估判 uncovered 在 coding（spec 由输入绑定复用、spec summary 缺）→ run_phase coding（不是 spec），next.json 与 stdout 一致',
    run: () => {
      const s = loadHostSnapshot();
      try {
        const feature = SNAPSHOT_CU_FEATURE;
        clearFrameworkConfigCache();
        assert(!fs.existsSync(featureFilePath(s.root, feature, 'spec/reports/summary.json')), '前提：spec summary 缺');
        fs.rmSync(featureFilePath(s.root, feature, 'coding/reports/phase-evidence-manifest.json'));
        const cli = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', path.join(HARNESS_ROOT, 'scripts', 'assess.ts'),
          '--feature', feature, '--project-root', s.root, '--framework-root', s.frameworkRoot], {
          cwd: HARNESS_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, TS_NODE_PROJECT: path.join(HARNESS_ROOT, 'tsconfig.json') },
        });
        assert(cli.status === 0, `assess CLI exit=${cli.status}: ${cli.stderr}`);
        const out = JSON.parse(cli.stdout.slice(cli.stdout.indexOf('{'))) as {
          recommendation: { action: string; phase: string | null; reason: string }; projection_fingerprint: string;
          feature_assessment: { record: { state: string; run_id: string }; uncovered: Array<{ owner_phase: string }> };
        };
        assert(out.feature_assessment.record.state === 'ok', JSON.stringify(out.feature_assessment.record));
        assert(JSON.stringify([...new Set(out.feature_assessment.uncovered.map(o => o.owner_phase))]) === '["coding"]', `前提：只有 coding uncovered：${JSON.stringify(out.feature_assessment.uncovered)}`);
        assert(out.recommendation.action === 'run_phase' && out.recommendation.phase === 'coding', JSON.stringify(out.recommendation));
        assert(out.recommendation.reason.includes(`--supersede ${out.feature_assessment.record.run_id}`), out.recommendation.reason);
        const next = JSON.parse(fs.readFileSync(nextProjectionPath(s.root, feature), 'utf8')) as typeof out;
        assert(JSON.stringify(next.recommendation) === JSON.stringify(out.recommendation), `next.json ≠ stdout：${JSON.stringify(next.recommendation)}`);
        assert(next.projection_fingerprint === out.projection_fingerprint, 'projection_fingerprint 不一致');
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(s.root, { recursive: true, force: true });
      }
    },
  },
  {
    // codex 批二 P2：feature 载体完成记录 run_id=null，没有可 supersede 的 run——不得拼出 `--supersede null`。
    name: 'D-2b 无 run assess：feature 载体完成后追加修订、新增义务 uncovered → 保留责任阶段推荐，提示先追加范围修订再起新 run',
    run: () => {
      const { root, frameworkRoot, feature } = setupRunlessProject();
      try {
        const { newDuty } = runlessCompletionThenRevision(root, frameworkRoot, feature);
        const result = assessFeature({ projectRoot: root, frameworkRoot, feature, writeProjection: false });
        assert(result.recommendation.action === 'run_phase' && result.recommendation.phase === 'plan', JSON.stringify(result.recommendation));
        assert(result.recommendation.reason.includes(newDuty), result.recommendation.reason);
        assert(!result.recommendation.reason.includes('--supersede'), result.recommendation.reason);
        assert(result.recommendation.reason.includes('feature 载体：先按当前输入追加范围修订再起新 run'), result.recommendation.reason);
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'PASS-open recommends closure before downstream work',
    run: () => {
      const result = assessObservation(observation({ closure: 'open' }));
      assert(result.gaps[0]?.kind === 'unclosed', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'complete_closure', result.recommendation.action);
      assert(result.run_status_candidate === null, 'open phase cannot complete');
    },
  },
  {
    name: 'PASS-open closure recommendation is identical with an active PASS reconcile outcome',
    run: () => {
      const baseline = assessObservation(observation({ closure: 'open' }));
      const reconciled = assessObservation(observation({ closure: 'open' }, {
        schema_version: '1.0',
        state: 'active',
        phase_outcome: { phase: 'spec', verdict: 'PASS', legacy_action: 'advance' },
        budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
        residual_fingerprints: [],
      }));
      assert(reconciled.recommendation.action === baseline.recommendation.action, JSON.stringify(reconciled.recommendation));
      assert(reconciled.recommendation.phase === baseline.recommendation.phase, JSON.stringify(reconciled.recommendation));
      assert(reconciled.recommendation.reason === baseline.recommendation.reason, JSON.stringify(reconciled.recommendation));
    },
  },  {
    name: 'legacy closed is legacy_unverified',
    run: () => {
      const result = assessObservation(observation({
        summary_state: 'legacy',
        schema_version: '1.1',
        closure: 'closed',
        assurance: 'unknown',
      }));
      assert(result.gaps[0]?.kind === 'legacy_unverified', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'rerun_phase', result.recommendation.action);
    },
  },
  {
    name: 'FAIL and DEFERRED remain distinct',
    run: () => {
      const failed = assessObservation(observation({ verdict: 'FAIL', closure: 'open' }));
      const deferred = assessObservation(observation({
        verdict: 'INCOMPLETE',
        closure: 'open',
        deferred: true,
      }));
      assert(failed.gaps[0]?.kind === 'failed', JSON.stringify(failed.gaps));
      assert(deferred.gaps[0]?.kind === 'deferred', JSON.stringify(deferred.gaps));
      assert(deferred.recommendation.action === 'resolve_deferred', deferred.recommendation.action);
    },
  },
  {
    name: 'stale closure requires rerun（gap detail 携带 changed_paths 原文——读者不用猜根因）',
    run: () => {
      const result = assessObservation(observation({
        closure: 'stale',
        closure_stale_detail: 'doc/features/demo/spec/reports/fidelity-intent.json',
      }));
      assert(result.gaps[0]?.kind === 'stale', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'rerun_phase', result.recommendation.action);
      // codex 定点（宿主 run 6cb1da 两连误判归因的根治）：detail 必须含具体变更路径原文
      assert(
        (result.gaps[0]?.detail ?? '').includes('doc/features/demo/spec/reports/fidelity-intent.json'),
        `stale gap detail 应携带 changed_paths 原文：${result.gaps[0]?.detail}`,
      );
      // 无明细时保持旧文案（不崩、不带空括号）
      const bare = assessObservation(observation({ closure: 'stale' }));
      assert(bare.gaps[0]?.detail === 'phase evidence manifest 非 fresh', bare.gaps[0]?.detail);
    },
  },
  {
    name: 'insufficient assurance restores inputs before rerun',
    run: () => {
      const result = assessObservation(observation({
        assurance: 'degraded',
        required_assurance: 'full',
        assurance_satisfied: false,
      }));
      assert(result.gaps[0]?.kind === 'insufficient_assurance', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'restore_inputs_and_rerun', result.recommendation.action);
    },
  },
  {
    name: 'reconciled state emits chain-slice candidate and still requires validation',
    run: () => {
      const result = assessObservation(observation());
      assert(result.gaps.length === 0, JSON.stringify(result.gaps));
      assert(result.run_status_candidate === 'CHAIN_SLICE_COMPLETED', String(result.run_status_candidate));
      assert(result.feature_completion === 'REQUIRES_VALIDATION', String(result.feature_completion));
      assert(!JSON.stringify(result).includes('"COMPLETED"'), 'must not emit naked COMPLETED');
    },
  },
  {
    name: 'stop/halt recommendation cannot emit a completed candidate',
    run: () => {
      const result = assessObservation(observation({}, {
        schema_version: '1.0',
        state: 'active',
        phase_outcome: { phase: 'spec', verdict: 'FAIL', legacy_action: 'retry' },
        budgets: { retries_used: 2, max_retries_per_phase: 2, backtracks_used: 0 },
        residual_fingerprints: [],
      }));
      assert(result.gaps.length === 0, JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'stop', JSON.stringify(result.recommendation));
      assert(result.recommendation.runner_action === 'halt', JSON.stringify(result.recommendation));
      assert(result.run_status_candidate === null, String(result.run_status_candidate));
      assert(result.feature_completion === null, String(result.feature_completion));
      const retrying = assessObservation(observation({}, {
        schema_version: '1.0',
        state: 'active',
        phase_outcome: { phase: 'spec', verdict: 'FAIL', legacy_action: 'retry' },
        budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 },
        residual_fingerprints: [],
      }));
      assert(retrying.recommendation.action === 'rerun_phase', JSON.stringify(retrying.recommendation));
      assert(retrying.run_status_candidate === null, 'retrying failure cannot complete');
    },
  },  {
    name: 'fuse stops recommendation without reading orchestration events',
    run: () => {
      const reconcile = {
        schema_version: '1.0' as const,
        state: 'fused' as const,
        reason: 'same fingerprint repeated',
        residual_fingerprints: ['deadbeef'],
      };
      const fused = assessObservation(observation({}, reconcile));
      const resumed = assessObservation(observation({}, { ...reconcile, state: 'active', reason: 'resumed' }));
      assert(fused.stop.fused, 'fuse flag missing');
      assert(fused.recommendation.action === 'stop', fused.recommendation.action);
      assert(fused.stop.reason === 'same fingerprint repeated', String(fused.stop.reason));
      assert(!resumed.stop.fused, 'active reconcile must not inherit fused stop');
      assert(resumed.recommendation.action !== 'stop', resumed.recommendation.action);
    },
  },
  {
    name: 'authorization context is echoed but recommendation never grants execution',
    run: () => {
      const result = assessObservation(
        observation({ phase: 'ut', summary_state: 'missing', verdict: null, closure: 'open' }),
        { mode: 'batch_authorized', through_phase: 'review' },
      );
      assert(result.authorization_context.through_phase === 'review', 'authorization context lost');
      assert(result.recommendation.requires_driver_authorization === true, 'assess granted execution');
    },
  },
  {
    name: 'next projection is fresh only while authoritative fingerprints match',
    run: () => {
      const root = mkProject();
      try {
        const opts = {
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          goalEnd: 'spec',
        };
        const first = assessFeature(opts);
        const second = assessFeature(opts);
        assert(first.projection_fingerprint === second.projection_fingerprint, 'assessment not idempotent');
        assert(readFreshNextOrRecompute(opts).source === 'fresh_projection', 'projection should be fresh');

        fs.writeFileSync(nextProjectionPath(root, 'demo'), '{broken', 'utf8');
        assert(readFreshNextOrRecompute(opts).source === 'recomputed_corrupt', 'corrupt cache not recomputed');

        const reports = path.join(root, 'doc', 'features', 'demo', 'spec', 'reports');
        fs.mkdirSync(reports, { recursive: true });
        fs.writeFileSync(path.join(reports, 'summary.json'), '{broken', 'utf8');
        const stale = readFreshNextOrRecompute(opts);
        assert(stale.source === 'recomputed_stale', stale.source);
        assert(stale.result.gaps[0]?.kind === 'failed', JSON.stringify(stale.result.gaps));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal minimum assurance is normalized and identity-bound',
    run: () => {
      const root = mkProject();
      try {
        const one = buildGoalManifestFromInput(
          goalInput({ ut: 'degraded', review: 'full' }),
          { projectRoot: root, runId: 'run-one' },
        );
        const two = buildGoalManifestFromInput(
          goalInput({ ut: 'full', review: 'full' }),
          { projectRoot: root, runId: 'run-one' },
        );
        assert(
          JSON.stringify(one.minimum_assurance) === JSON.stringify({ review: 'full', ut: 'degraded' }),
          JSON.stringify(one.minimum_assurance),
        );
        assert(
          computeManifestIdentityFields(one).minimum_assurance !==
            computeManifestIdentityFields(two).minimum_assurance,
          'minimum assurance must participate in manifest identity',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal manifest schema and parser accept minimum_assurance only',
    run: () => {
      const root = mkProject();
      try {
        const schema = YAML.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'workflows', 'goal-manifest.schema.yaml'), 'utf8')) as {
          fields?: Record<string, { additionalProperties?: { enum?: string[] } }>;
        };
        assert(!('minimum_depth_by_phase' in (schema.fields ?? {})), 'legacy depth field remains in goal manifest schema');
        const assurance = schema.fields?.minimum_assurance;
        assert(
          JSON.stringify(assurance?.additionalProperties?.enum) === JSON.stringify(['degraded', 'full']),
          'minimum_assurance schema enum drifted',
        );
        let legacyError = '';
        try {
          buildGoalManifestFromInput({
            ...goalInput({}),
            minimum_depth_by_phase: { testing: 'full' },
          }, { projectRoot: root, runId: 'run-one' });
        } catch (error) {
          legacyError = (error as Error).message;
        }
        assert(legacyError.includes('minimum_depth_by_phase'), `legacy field was accepted: ${legacyError}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'renderer is bounded, outside HARNESS_SUMMARY, and process-once',
    run: () => {
      const root = mkProject();
      const writes: string[] = [];
      const oldLog = console.log;
      try {
        const result = assessFeature({
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          goalEnd: 'spec',
          writeProjection: false,
        });
        const formatted = formatAssessNextStep(result, {
          phase: 'spec',
          mode: 'manual',
          status: 'PASS/open',
        });
        assert(formatted.split('\n').length === 7, formatted);
        assert(!formatted.includes('HARNESS_SUMMARY'), 'renderer polluted machine block');

        __testing_resetAssessRenderer();
        console.log = (...args: unknown[]) => { writes.push(args.map(String).join(' ')); };
        const opts = {
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          phase: 'spec',
          mode: 'manual' as const,
          status: 'PASS/open',
          goalEnd: 'spec',
        };
        assessAndRenderNextStep(opts);
        assessAndRenderNextStep(opts);
        assert(writes.filter((line) => line.includes('NEXT_STEP')).length === 1, JSON.stringify(writes));
      } finally {
        console.log = oldLog;
        __testing_resetAssessRenderer();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'gate harness renderer restores goal bounds from run manifest even in manual mode',
    run: () => {
      const root = mkProject();
      const previousRunId = process.env.MAISON_GOAL_RUN_ID;
      const previousGate = process.env.MAISON_GOAL_GATE_HARNESS;
      const oldLog = console.log;
      try {
        const manifest = buildGoalManifestFromInput({ ...goalInput({ review: 'full' }), end_phase: 'spec' }, {
          projectRoot: root,
          runId: 'gate-run',
        });
        writeGoalManifest(manifest, root);
        process.env.MAISON_GOAL_RUN_ID = 'gate-run';
        process.env.MAISON_GOAL_GATE_HARNESS = '1';
        __testing_resetAssessRenderer();
        console.log = () => undefined;
        const result = assessAndRenderNextStep({
          projectRoot: root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          phase: 'review',
          mode: 'manual',
          status: 'PASS',
        });
        assert(result?.goal_end === 'spec', JSON.stringify(result));
        assert(Boolean(result?.gaps.some((gap) => gap.phase === 'spec')), JSON.stringify(result?.gaps));
      } finally {
        console.log = oldLog;
        __testing_resetAssessRenderer();
        if (previousRunId === undefined) delete process.env.MAISON_GOAL_RUN_ID;
        else process.env.MAISON_GOAL_RUN_ID = previousRunId;
        if (previousGate === undefined) delete process.env.MAISON_GOAL_GATE_HARNESS;
        else process.env.MAISON_GOAL_GATE_HARNESS = previousGate;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'direct harness, check-receipt, and sync-closure expose one guarded outer render hook',
    run: () => {
      const runner = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'harness-runner.ts'), 'utf8');
      const receipt = fs.readFileSync(
        path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'check-receipt.ts'),
        'utf8',
      );
      const state = fs.readFileSync(
        path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'utils', 'phase-state.ts'),
        'utf8',
      );
      const runnerCall = runner.indexOf('    assessAndRenderNextStep({');
      assert(runnerCall > runner.indexOf('printStableSummary(runSummary)'), 'renderer must follow HARNESS_SUMMARY');
      assert(runner.indexOf("if (args['adhoc-correction'])") < runnerCall, 'adhoc path must exit before renderer');
      assert(
        runner.includes('if (!phaseIsGlobal && feature !== GLOBAL_FEATURE_SENTINEL)'),
        'global/sentinel silence guard missing',
      );
      assert(
        runner.split('assessAndRenderNextStep({').length - 1 === 1,
        'direct harness must have one render call',
      );
      const receiptCall = receipt.indexOf('      assessAndRenderNextStep({');
      assert(receipt.slice(receiptCall - 80, receiptCall).includes('if (!skipStateSync)'), 'nested receipt guard missing');
      assert(receipt.split('assessAndRenderNextStep({').length - 1 === 1, 'receipt must have one render call');
      assert(
        state.split('assessAndRenderNextStep({').length - 1 === 1,
        'sync-closure must have one render call',
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
