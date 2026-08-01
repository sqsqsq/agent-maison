// ============================================================================
// assess.unit.test.ts — deterministic diff/recommend/fuse behavior
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assessObservation,
  assessFeature,
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
    minimum_depth_by_phase: minimum,
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
    depth: 'full',
    required_depth: null,
    depth_satisfied: null,
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

const cases: Case[] = [
  {
    name: 'no-reconcile multi-phase gaps choose the first workflow gap',
    run: () => {
      const multi = observation();
      multi.goal_end = 'plan';
      multi.phases = [
        phase({ phase: 'spec', summary_state: 'missing', schema_version: null, verdict: null, closure: 'open', depth: 'unknown' }),
        phase({ phase: 'plan', summary_state: 'missing', schema_version: null, verdict: null, closure: 'open', depth: 'unknown' }),
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
    name: 'PASS-open recommends closure before downstream work',
    run: () => {
      const result = assessObservation(observation({ closure: 'open' }));
      assert(result.gaps[0]?.kind === 'unclosed', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'complete_closure', result.recommendation.action);
      assert(result.run_status_candidate === null, 'open phase cannot complete');
    },
  },
  {
    name: 'legacy closed is legacy_unverified',
    run: () => {
      const result = assessObservation(observation({
        summary_state: 'legacy',
        schema_version: '1.1',
        closure: 'closed',
        depth: 'unknown',
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
    name: 'stale closure requires rerun',
    run: () => {
      const result = assessObservation(observation({ closure: 'stale' }));
      assert(result.gaps[0]?.kind === 'stale', JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'rerun_phase', result.recommendation.action);
    },
  },
  {
    name: 'insufficient contract-local depth restores inputs before rerun',
    run: () => {
      const result = assessObservation(observation({
        depth: 'basic',
        required_depth: 'full',
        depth_satisfied: false,
      }));
      assert(result.gaps[0]?.kind === 'insufficient_depth', JSON.stringify(result.gaps));
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
    name: 'goal minimum depth is normalized and identity-bound',
    run: () => {
      const root = mkProject();
      try {
        const one = buildGoalManifestFromInput(
          goalInput({ ut: 'basic', review: 'full' }),
          { projectRoot: root, runId: 'run-one' },
        );
        const two = buildGoalManifestFromInput(
          goalInput({ ut: 'full', review: 'full' }),
          { projectRoot: root, runId: 'run-one' },
        );
        assert(
          JSON.stringify(one.minimum_depth_by_phase) === JSON.stringify({ review: 'full', ut: 'basic' }),
          JSON.stringify(one.minimum_depth_by_phase),
        );
        assert(
          computeManifestIdentityFields(one).minimum_depth_by_phase !==
            computeManifestIdentityFields(two).minimum_depth_by_phase,
          'minimum depth must participate in manifest identity',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
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
