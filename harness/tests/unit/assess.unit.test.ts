import { beginUnitCase } from '../utils/unit-cases';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache } from '../../config';
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
import { resolveCurrentDisposition, type CurrentDispositionPhaseFact } from '../../scripts/utils/check-disposition';
import { repairResponsibilityContext } from '../../scripts/utils/repair-responsibility';
import { fixture as unitFixture } from './standalone-coding-review.unit.test';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case {
  name: string;
  run: () => void | Promise<void>;
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
      assert(result.gaps.length > 0, JSON.stringify(result.gaps));
      assert(result.recommendation.action === 'continue_work_unit' && result.recommendation.phase === null, JSON.stringify(result.recommendation));
      assert(result.recommendation.runner_action === undefined, 'projection must not grant a phase dispatch');
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

  },
};
const cases: Case[] = [
  authorizedDegradationCase,
  prunedPropagationCase,
  producerOwnedInputGapCase,
  {
    name: 'current endpoint matrix preserves every actual gap and never selects a cold phase or historical quota exit',
    run: () => {
      const facts: CurrentDispositionPhaseFact[] = [
        { phase: 'spec', summaryPresent: false, verdict: null, schemaCurrent: false, closureCommitted: false },
        { phase: 'spec', summaryPresent: true, schemaCurrent: false, verdict: 'PASS', closureCommitted: true,
          summaryErrors: ['historical summary has no current verified contract'] },
        { phase: 'spec', summaryPresent: true, schemaCurrent: true, verdict: 'PASS', closureCommitted: true,
          lineage: 'stale', lineageDetail: 'doc/features/demo/acceptance.yaml changed' },
        { phase: 'spec', summaryPresent: true, schemaCurrent: true, verdict: 'FAIL', closureCommitted: false,
          checks: [{ id: 'real_assertion', status: 'FAIL', severity: 'BLOCKER', details: 'exact original failure' }] },
        { phase: 'spec', summaryPresent: true, schemaCurrent: true, verdict: 'INCOMPLETE', closureCommitted: false,
          checks: [{ id: 'missing_device', status: 'FAIL', severity: 'BLOCKER', details: 'exact device recovery condition',
            failure_kind: 'device_blocked', blocking_class: 'externalBlocked' }] },
      ];
      for (const fact of facts) {
        const currentDisposition = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [fact] });
        const assessed = assessObservation({ ...observation(), currentDisposition, reconcile: {
          schema_version: '1.0', state: 'fused', reason: 'historical quota', residual_fingerprints: [],
          budgets: { retries_used: 999, max_retries_per_phase: 0, backtracks_used: 999 } } });
        assert(assessed.recommendation.phase === null && assessed.recommendation.runner_action === undefined, 'projection cannot dispatch old phases');
        assert(!assessed.stop.fused && assessed.run_status_candidate === null,
          'old controls cannot stop current work or sign completion: ' + JSON.stringify({ fact, currentDisposition, assessed }));
        for (const problem of currentDisposition.completionBlocking) assert(assessed.recommendation.reason.includes(problem.detail), 'all original current facts must survive');
      }
      const currentDisposition = resolveCurrentDisposition({ endpoint: 'request', phases: [{ phase: 'spec', verdict: 'PASS', schemaCurrent: true,
        closureCommitted: false, checks: [{ id: 'actual_checked_object', status: 'PASS', severity: 'BLOCKER' }] }] });
      const completed = assessObservation({ ...observation(), currentDisposition });
      assert(completed.recommendation.action === 'validate_feature_completion' && completed.feature_completion === 'REQUIRES_VALIDATION',
        'completed request still requires its distinct formal endpoint');
    },
  },
  {
    name: 'current disposition wait outranks derived publication gaps while genuine repair, verification and changed inputs remain executable',
    run: () => {
      const unit = unitFixture();
      try {
        const review: CurrentDispositionPhaseFact = { phase: 'review', summaryPresent: true, verdict: 'INCOMPLETE', schemaCurrent: true,
          closureCommitted: false, lineage: 'missing', attestationPresent: false,
          requiredGaps: [{ id: 'missing_required_executor', failure_kind: 'framework_bug', blocking_class: 'framework_internal' }] };
        const currentView = (fact: CurrentDispositionPhaseFact) => resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [fact, { phase: 'ut', summaryPresent: true, verdict: 'PASS', schemaCurrent: true,
          closureCommitted: true, lineage: 'fresh' }] });
        const assess = (fact: CurrentDispositionPhaseFact, observedReview: Partial<AssessPhaseObservation> = {}) => assessObservation({
          ...observation(), goal_end: 'ut', phases: [phase({ phase: 'review', verdict: 'INCOMPLETE', closure: 'open', deferred: true,
            verification_gaps: [{ id: 'missing_required_executor', blocking_class: 'framework_internal' }], ...observedReview }), phase({ phase: 'ut' })],
          responsibility: repairResponsibilityContext({ projectRoot: unit.root, frameworkRoot: FRAMEWORK_ROOT, feature: unit.manifest.feature, runId: unit.manifest.run_id }),
          currentDisposition: currentView(fact),
          reconcile: { schema_version: '1.0', state: 'active', current_summary_fresh: true, residual_fingerprints: [],
            phase_outcome: { phase: 'ut', verdict: 'PASS', legacy_action: 'none' },
            budgets: { retries_used: 0, max_retries_per_phase: 2, backtracks_used: 0 }, invalidatable_phases: ['review', 'ut'] },
        }, { mode: 'goal_mode' });
        const waiting = assess(review);
        assert(waiting.recommendation.phase === null && waiting.recommendation.runner_action === undefined, JSON.stringify(waiting.recommendation));
        for (const problem of currentView(review).completionBlocking) assert(waiting.gaps.some(gap => gap.detail === `${problem.id}: ${problem.detail}`),
          `the recommendation must retain every actual publication and waiting fact: ${problem.id}`);
        assert(waiting.observed.phases.find(phase => phase.phase === 'review')?.closure === 'open' && waiting.run_status_candidate === null,
          'an incomplete waiting stage stays open and cannot claim completion');
        const repaired = assess({ ...review, openFindings: [{ id: 'current_required_review_work', detail: 'current independently confirmed work', owner: 'review' }] });
        assert(repaired.recommendation.action === 'continue_work_unit' && repaired.recommendation.phase === null, JSON.stringify(repaired.recommendation));
        assert(repaired.recommendation.reason.includes('current_required_review_work'), 'a real repair must not be hidden by the framework wait');
        const verify = assess({ ...review, requiredGaps: [], axes: { evidence: { applicable: true, required_for_release: true,
          verdict: 'UNVERIFIED', resolution: { class: 'needs_fix', owner: 'review', retry_phase: 'review' }, source_checks: ['current_material'] } } },
          { verification_gaps: undefined });
        assert(verify.recommendation.action === 'continue_work_unit' && verify.recommendation.phase === null, 'a deferred display flag cannot suppress a real current verification task');
        const changedInput = assess({ ...review, verdict: 'PASS', requiredGaps: [], closureCommitted: true, lineage: 'stale',
          lineageDetail: 'src/demo/value.ts changed', attestationPresent: true },
          { verdict: 'PASS', deferred: false, closure: 'stale', closure_stale_detail: 'src/demo/value.ts changed', verification_gaps: undefined });
        assert(changedInput.recommendation.action === 'continue_work_unit' && changedInput.recommendation.phase === null, 'real input drift must still return to its verification owner');
      } finally { clearFrameworkConfigCache(); fs.rmSync(unit.root, { recursive: true, force: true }); }
    },
  },  {
    name: 'assess CLI --no-write maps to write=false',
    run: () => {
      const argv = parseAssessCliArgs(['--feature', 'demo', '--no-write']);
      assert(argv.write === false, JSON.stringify(argv));
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
        assert(result.recommendation.action === 'continue_work_unit' && result.recommendation.phase === null, JSON.stringify(result.recommendation));
        assert(result.recommendation.reason.includes(newDuty), result.recommendation.reason);
        assert(!result.recommendation.reason.includes('--supersede'), result.recommendation.reason);
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
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
        const first = assessFeature({ ...opts, writeProjection: true });
        const second = assessFeature(opts);
        assert(first.projection_fingerprint === second.projection_fingerprint, 'assessment not idempotent');
        assert(readFreshNextOrRecompute(opts).source === 'fresh_projection', 'projection should be fresh');

        fs.writeFileSync(nextProjectionPath(root, 'demo'), '{broken', 'utf8');
        assert(readFreshNextOrRecompute(opts).source === 'recomputed_corrupt', 'corrupt cache not recomputed');
        assert(fs.readFileSync(nextProjectionPath(root, 'demo'), 'utf8') === '{broken', 'read must not rewrite corrupt cache');
        assessFeature({ ...opts, writeProjection: true });

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
    name: 'renderer preserves current feedback outside HARNESS_SUMMARY and remains process-once',
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
        assert(formatted.startsWith('NEXT_STEP\n'), formatted);
        assert(formatted.includes(result.recommendation.reason), 'current actionable feedback must remain complete');
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

async function executeCases(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases) {
    const endUnitCase = beginUnitCase(testCase.name);
    if (!endUnitCase) continue;
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).message });
    } finally { endUnitCase(); }
  }
  return results;
}

export const runAll = () => executeCases();
