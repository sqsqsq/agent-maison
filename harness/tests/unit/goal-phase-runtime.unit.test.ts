import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { execFileSync } from 'child_process';
import { loadWorkflowSpec } from '../../workflow-loader';
import { resolveFeatureArtifact, clearFrameworkConfigCache } from '../../config';
import {
  AttendedGoalPhaseExecutor,
  createWorkUnitExecutionContext,
  observeWorkUnitProviderSession,
  rebuildWorkUnitExecutionContext,
  DetachedGoalPhaseExecutor,
  validateWorkUnitExecutionContext,
  PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS,
  workUnitExecutionRole,
  type WorkUnitExecutionContext,
} from '../../scripts/utils/goal-phase-executor';
import { GoalPhaseRuntime } from '../../scripts/utils/goal-phase-runtime';
import { enrichOutcomesWithProjection } from '../../scripts/goal-phase-runtime';
import { extractPriorFailureContext } from '../../scripts/goal-runner';
import { projectCanonicalLifecycle } from '../../scripts/utils/goal-canonical-lifecycle';
import type { HeadlessInvokePlan } from '../../scripts/utils/agent-invoke';
import { recordDesignRepairInvocation } from '../../scripts/utils/design-repair-unattended';
import { invocationCompleted } from '../../scripts/utils/invocation-completion';
import {
  casAcquireRunOwner,
  ensureRunControl,
  readRunControl,
  releaseRunOwner,
} from '../../scripts/utils/goal-run-control';
import {
  runGoalRuntimeChain,
  setupGoalRuntimeHost,
  backdateLastRunEnd,
  type RunProbe,
  PRODUCT_FILE,
  fixtureReadDependencies,
} from './goal-runner-testing-integrity.unit.test';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityHash,
  loadGoalManifestFromRun,
  writeGoalManifest,
} from '../../scripts/utils/goal-manifest';
import { resolveGoalRunBaseline } from '../../scripts/utils/goal-run-baseline';
import { resolveGoalRunHeadSha } from '../../scripts/utils/goal-run-creation';
import { writeHandoffRequest } from '../../scripts/utils/goal-handoff';
import { runGoalModeSessionStep as runGoalModeSessionStepUnchecked } from '../../scripts/goal-mode-entry';
import { readSessionExecution, acceptedSessionReport } from '../../scripts/utils/session-execution-handoff';
import { withRuntimeTest, preserveRuntimeTestEvidence, type RuntimeTestControl } from '../utils/runtime-test-control';
import { resolveCompletionDisposition } from '../../scripts/utils/verify-feature-completion';
const runGoalModeSessionStep = (options: Parameters<typeof runGoalModeSessionStepUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeSessionStepUnchecked(options));


export interface UnitCaseResult { name: string; ok: boolean; error?: string }
interface Case { name: string; run: () => void | Promise<void> }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(overrides: Partial<WorkUnitExecutionContext> = {}): WorkUnitExecutionContext {
  return createWorkUnitExecutionContext({
    runId: 'run-1',
    feature: 'demo',
    workflowId: 'spec-driven',
    track: 'full',
    chain: ['spec', 'plan', 'coding'],
    phase: 'coding',
    attemptId: 'i1',
    owner: { run_id: 'run-1', owner_id: 'owner-1', epoch: 1, kind: 'process' },
    projectRoot: '/project',
    frameworkRoot: '/project/framework',
    runDir: '/project/doc/features/demo/goal/runs/run-1',
    reportDir: 'doc/features/demo/goal/runs/run-1',
    adapter: 'codex',
    adapterModel: 'gpt-test',
    runtimeFacts: {
      runBaseSha: 'a'.repeat(40),
      receiptRequired: true,
      resume: false,
      successor: false,
    },
    childEnv: { MAISON_GOAL_RUN_ID: 'run-1' },
    ...overrides,
  });
}

function cloneHost(source: string, label: string): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `goal-runtime-${label}-`));
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function canonicalOf(probe: RunProbe): ReturnType<typeof projectCanonicalLifecycle> {
  return projectCanonicalLifecycle(probe.events);
}

function seedUtFailureSummary(root: string, blockers: Array<Record<string, unknown>>): void {
  const reports = path.join(root, 'doc/features/bc-openCard/ut/reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({
    schema_version: '1.2', assurance: 'full', verdict: 'FAIL', blocker_count: blockers.length,
    receipt_status: 'missing', closure_status: 'open', next_action: 'fix_blockers',
    report_validity: 'PASS', release_readiness: 'BLOCKED', completion_status: 'complete',
    capability_resolutions: [], capability_resolution_contract_fingerprint: null,
    blockers, checks: [],
  }, null, 2));
}

function productEvidenceCheck(root: string, marker: string, file = PRODUCT_FILE): import('../../scripts/utils/types').CheckResult {
  const bytes = fs.readFileSync(path.join(root, file));
  return { id: 'file_completeness', category: 'structure', severity: 'BLOCKER', status: bytes.includes(marker) ? 'PASS' : 'FAIL',
    description: 'the controlled producer reads its actual product requirement', details: `Required product content: ${marker}`,
    affected_files: [file], failure_kind: 'code_regression',
    structured: { source_attempt_dependencies: [{ path: file, exists: true,
      sha256: require('crypto').createHash('sha256').update(bytes).digest('hex'), role: 'artifact' }] } };
}

function declareSourceRepairRequest(root: string, requestedPhases: Array<'spec' | 'plan' | 'coding' | 'review' | 'ut' | 'testing'> = ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
  const configPath = path.join(root, 'framework.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.active_workflow = 'obligation-driven'; fs.writeFileSync(configPath, JSON.stringify(config)); clearFrameworkConfigCache();
  const requirement = `核实并修复 ${PRODUCT_FILE} 的受控源码标记断言，执行当前全部适用验证，不改变界面或设备交互。`;
  const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard',
    completionTarget: 'request', requestedResults: ['完成当前源码修复与原验证终点'], requestedPhases: [...requestedPhases], requirement,
    impact: { userVisibleBehaviorChange: false, reason: '受控修复仅添加指定注释标记，不改变实际界面或设备行为。', basisPaths: [PRODUCT_FILE] } });
  assert(prepared.scope.obligations.some(obligation => obligation.kind === 'implementation' && obligation.applicability === 'required'),
    'the original repair fixture must bind its actual source duty at run birth');
  const first = requestedPhases.find(phase => phase === prepared.scope.phase_chain[0]);
  const last = requestedPhases.find(phase => phase === prepared.scope.phase_chain.at(-1));
  assert(first && last, 'the prepared request must have actual runnable check families');
  return { scope: prepared.scope, requestedPhases, launch: { freshRequirement: requirement, freshStartPhase: first, freshEndPhase: last,
    freshManifestContent: YAML.stringify({ feature: 'bc-openCard', adapter: 'codex', requirement, execution_scope: prepared.scope,
      chain_override: prepared.scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }) } };
}

function assertOnlyChangedChecksResume(before: RunProbe, resumed: RunProbe): void {
  const previous = new Map(before.events.filter(event => event.type === 'harness_start').map(event => [event.phase, event.related_input_snapshot]));
  for (const start of resumed.events.slice(before.events.length).filter(event => event.type === 'harness_start')) {
    assert(previous.has(start.phase) && JSON.stringify(previous.get(start.phase)) !== JSON.stringify(start.related_input_snapshot),
      `an unchanged completed check was rerun during recovery: ${start.phase}`);
  }
}

const semanticReviewCases: Case[] = (['normal', 'api429'] as const).map(mode => ({
  name: mode === 'normal' ? '3f8a6c21 repaired product reaches independent review without a report-format failure'
    : '3f8a6c21 interrupted semantic review retries before any check can consume the old report',
  run: async () => {
    const adapter = mode === 'normal' ? 'deepseek-harness' : 'codex';
    const root = setupGoalRuntimeHost(adapter, false).root;
    const reportRel = 'doc/features/bc-openCard/review/review-report.md', report = path.join(root, reportRel);
    const marker = 'CR_001_FIXED_3F8A6C21';
    let authors = 0, reviewers = 0;
    try {
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(report, '# Original review\nCR-001: pending product repair\n**审查结论**: 不通过\n');
      const launch = declareSourceRepairRequest(root, ['coding', 'review']).launch;
      const sourceManifest = YAML.parse(launch.freshManifestContent); sourceManifest.adapter = adapter;
      const probe = await runGoalRuntimeChain(root, { ...launch, freshManifestContent: YAML.stringify(sourceManifest),
        adapter, runId: `3f8a6c21-semantic-review-${mode}`,
        invokeResultFor: (phase, attempt) => phase === 'review' && mode === 'api429' && attempt === 1 ? {
          exitCode: 1, stdout: '', stderr: 'API Error: 429 finite review interruption', terminal_failure_observed: true,
          terminal_error_excerpt: 'turn.failed: {"type":"error","status":429,"error":{"type":"rate_limit_error","message":"finite review interruption"}}',
        } : null,
        onAuthor: ctx => {
          assert(++authors <= 4, 'same required work must not dispatch forever');
          if (ctx.prompt.includes('CR-001') && !fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes(marker)) {
            fs.appendFileSync(path.join(root, PRODUCT_FILE), `\n// ${marker}\n`);
          }
        },
        onReview: ctx => {
          assert(++reviewers <= 2, 'unchanged handback cannot trigger another semantic review');
          assert(ctx.prompt.includes('CR-001'), 'the reviewer must receive the actual unresolved finding');
          assert(fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes(marker), 'independent review must see the actual repair');
          if (mode === 'api429' && reviewers === 1) return;
          fs.writeFileSync(report, '# Updated independent review\nCR-001: verified fixed\n**审查结论**: 通过\n');
        },
        onHarnessSummary: ({ phase }) => {
          if (phase === 'coding') return { checks: fixtureReadDependencies(root, [productEvidenceCheck(root, marker)], [PRODUCT_FILE]) };
          if (phase !== 'review') return null;
          assert(!(mode === 'api429' && reviewers === 1), 'a failed review must be retried before the checker stamps its old report');
          const fixed = fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes(marker);
          const reviewed = fs.readFileSync(report, 'utf8').includes('verified fixed');
          return { checks: fixtureReadDependencies(root, [
            { id: 'file_completeness', category: 'structure', severity: 'BLOCKER', status: fixed ? 'PASS' : 'FAIL',
              description: 'original product requirement', details: 'CR-001 requires actual product repair', affected_files: [PRODUCT_FILE] },
            { id: 'negative_verdict_closure', category: 'structure', severity: 'BLOCKER', status: reviewed ? 'PASS' : 'FAIL',
              description: 'independent verdict', details: 'CR-001 must be independently rechecked', failure_kind: 'negative_review_verdict' },
          ], [PRODUCT_FILE, reportRel]) };
        },
      });
      assert(probe.exitCode === 0 && reviewers === (mode === 'api429' ? 2 : 1), `the original request must complete after a successful independent recheck: exit=${probe.exitCode} reviewers=${reviewers}`);
      assert(probe.events.some(event => event.type === 'agent_invoke_start' && event.phase === 'review'), 'a real independent invocation must be recorded');
      if (mode === 'api429') assert(probe.events.filter(event => event.type === 'transient_api_retry_scheduled' && event.phase === 'review').length === 1,
        'the original failed call must remain visible and buy exactly one bounded transport retry');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}));

const cases: Case[] = [...semanticReviewCases, {
  name: '3f8a6c21 unchanged old review wakes after scope proof invalidation and a no-op author handback',
  run: async () => {
    const root = setupGoalRuntimeHost('deepseek-harness', false).root;
    const reportRel = 'doc/features/bc-openCard/review/review-report.md', report = path.join(root, reportRel);
    const marker = 'UNCHANGED_PRODUCT_3F8A6C21';
    const findings = ['CR-001', 'CR-002', 'CR-003', 'CR-004', 'CR-005'];
    let authors = 0, reviewers = 0;
    try {
      fs.appendFileSync(path.join(root, PRODUCT_FILE), `\n// ${marker}\n`);
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(report, '# Original independent report\n' + findings.join('\n') + '\n**审查结论**: 不通过\n');
      const options = {
        adapter: 'deepseek-harness', onAuthor: () => { authors++; },
        onReview: (ctx: { prompt: string }) => {
          reviewers++;
          assert(findings.every(id => ctx.prompt.includes(id)), 'all original findings, including the still-unproven one, must reach the reviewer');
          fs.writeFileSync(report, '# Current independent report\nCR-001 through CR-004 verified repaired; CR-005 remains unproven\n**审查结论**: 不通过\n');
        },
        onHarnessSummary: ({ phase }: { phase: string }) => phase === 'coding'
          ? { checks: fixtureReadDependencies(root, [productEvidenceCheck(root, marker)], [PRODUCT_FILE]) }
          : phase === 'review' ? { checks: fixtureReadDependencies(root, [{
            id: 'negative_verdict_closure', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
            description: 'original independent findings', details: findings.join(', '), failure_kind: 'negative_review_verdict',
          } as import('../../scripts/utils/types').CheckResult], [PRODUCT_FILE, reportRel]) } : null,
      };
      const launch = declareSourceRepairRequest(root, ['coding', 'review']).launch;
      const sourceManifest = YAML.parse(launch.freshManifestContent); sourceManifest.adapter = options.adapter;
      const first = await runGoalRuntimeChain(root, { ...options, ...launch, freshManifestContent: YAML.stringify(sourceManifest) });
      assert(reviewers === 0 && authors > 0, 'unchanged old report alone must not purchase a reviewer');
      const runId = path.basename(first.reportDir);
      const before = (require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion'))
        .readCurrentCheckObservation({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId, phase: 'review' });
      assert(before.returned && !before.changed, 'the recovery point must already have a returned unchanged review check');
      const productBytes = fs.readFileSync(path.join(root, PRODUCT_FILE));
      // Historical proof withdrawal is fixture input; publication itself is exercised by the real-plan V4 case.
      fs.appendFileSync(path.join(first.reportDir, 'events.jsonl'), JSON.stringify({
        type: 'phase_invalidated', phase: 'review', ts: new Date().toISOString(), reason: 'scope proof withdrawn after the old review check',
      }) + '\n');
      backdateLastRunEnd(root, runId);
      const resumed = await runGoalRuntimeChain(root, { ...options, resume: runId, forceResume: true });
      assert(Number(reviewers) === 1 && fs.readFileSync(path.join(root, PRODUCT_FILE)).equals(productBytes),
        'scope invalidation must wake exactly one independent review despite no new product write');
      assert(resumed.exitCode !== 0 && !resumed.events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'),
        'the remaining CR-005 cannot disappear when other findings are reviewed');
      const resumedEvents = resumed.events.slice(first.events.length);
      const lastAuthor = resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').at(-1);
      assert(lastAuthor && !resumed.events.some(event => event.type === 'phase_write_observed' && event.invoke_id === lastAuthor.invoke_id
        && ((event as any).owned?.length || (event as any).observations?.length)), 'the latest author must really have handed back without writes');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: 'goal alignment: independent output oscillation pauses through common progress and resumes the same run',
  run: async () => {
    for (const mode of ['oscillate', 'improve', 'unavailable-verify'] as const) {
      const root = setupGoalRuntimeHost('codex', false).root;
      const reportRel = 'doc/features/bc-openCard/review/review-report.md';
      const reportPath = path.join(root, reportRel);
      let writers = 0, finish = false;
      try {
        const options: Parameters<typeof runGoalRuntimeChain>[1] = { ...declareSourceRepairRequest(root).launch,
          adapter: 'codex', runId: 'goal-alignment-' + mode, onAuthor: () => undefined,
          onReview: () => {
            assert(++writers <= 5, 'the production comparison must stop oscillation without a simulated timeout');
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            if (finish || mode === 'improve' && writers > 1) fs.writeFileSync(reportPath, '# Review\n## 结论\n**审查结论**: 通过\n');
            else if (writers % 2) fs.writeFileSync(reportPath, '# Review without conclusion\n');
            else fs.rmSync(reportPath, { force: true });
          },
          onHarnessSummary: async ({ phase }) => {
            if (phase === 'ut' && mode === 'unavailable-verify') return { checks: fixtureReadDependencies(root, [{
              id: 'capability_resolution_contract', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
              description: 'the current checker cannot execute', details: 'controlled framework checker exception',
              failure_kind: 'framework_bug', blocking_class: 'framework_internal',
            }], [PRODUCT_FILE]) };
            if (phase !== 'review') return null;
            const frameworkRoot = path.resolve(__dirname, '../../..');
            const review = (await import('../../scripts/check-review')).default;
            const { SpecLoader } = await import('../../scripts/utils/spec-loader');
            const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
            const actual = await review.check({ subject: 'feature', phase: 'review', feature: 'bc-openCard', projectRoot: root, frameworkRoot,
              phaseRule: loader.loadPhaseRule('review'), featureSpec: loader.loadFeatureSpec('bc-openCard') } as import('../../scripts/utils/types').CheckContext<'feature'>);
            const reportChecks = actual.filter(check => ['review_report_exists', 'conclusion_with_verdict'].includes(check.id));
            assert(reportChecks.length > 0 && reportChecks.every(check => check.affected_files?.includes(reportRel)),
              'the production report checker must identify its actual artifact producer');
            const checks: import('../../scripts/utils/types').CheckResult[] = fixtureReadDependencies(root, [...reportChecks, {
              id: 'file_completeness', category: 'structure', severity: 'BLOCKER', status: 'PASS',
              description: 'the controlled check reads the current product', details: fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8'),
              affected_files: [PRODUCT_FILE],
            }], [PRODUCT_FILE]);
            const reports = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
            reports.generateMergedReport(path.join(frameworkRoot, 'harness'), root, 'review', 'bc-openCard',
              reports.buildScriptReport('review', 'bc-openCard', root, checks), undefined, frameworkRoot);
            return { checks };
          },
        };
        const first = await runGoalRuntimeChain(root, options);
        assert(writers === 2, 'each new report deficit gets its actual opportunity, a repeated signature does not: ' + writers);
        assert(!first.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), 'no external stop proves convergence');
        if (mode === 'improve') {
          assert(first.exitCode === 0 && !first.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'no_progress_guard'),
            'a real repaired conclusion must complete without a no-progress halt');
        } else {
          assert(first.exitCode !== 0 && first.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'no_progress_guard'),
            'missing report and missing conclusion oscillation must pause through common progress');
          if (mode === 'unavailable-verify') {
            assert(first.harnessPhases.filter(phase => phase === 'ut').length === 1, 'unavailable verification cannot spin or buy repeated checks');
            assert(first.events.some(event => event.type === 'phase_halt' && event.run_disposition === 'WAITING'), 'paused producer must yield a resumable wait');
            continue;
          }
          const resume = { ...options, resume: path.basename(first.reportDir), noAutoForce: true, skipLegacySeal: true };
          const unchanged = await runGoalRuntimeChain(root, resume);
          assert(unchanged.invokedPhases.length === 0 && writers === 2, 'unchanged cold resume preserves the real pause');
          finish = true;
          const continued = await runGoalRuntimeChain(root, { ...resume, forceResume: true });
          assert(continued.exitCode === 0 && Number(writers) === 3, 'explicit continuation repairs and completes the original run: '
            + JSON.stringify(continued.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
          assert(continued.reportDir === first.reportDir, 'continuation cannot replace the run or its history');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  },
}, {
  name: 'P4 t5 rewriting an invalid review report is not new work for its independent writer',
  run: async () => {
    for (const newProof of [false, true]) {
    const root = setupGoalRuntimeHost('codex', false).root;
    const reportRel = 'doc/features/bc-openCard/review/review-report.md';
    const reportPath = path.join(root, reportRel);
    const proofRel = 'doc/features/bc-openCard/testing/reports/external-proof/summary.json';
    let proofPublished = false;
    let reviewers = 0;
    try {
      const probe = await runGoalRuntimeChain(root, { ...declareSourceRepairRequest(root).launch,
        adapter: 'codex', runId: 'p4-review-output-is-not-input', onAuthor: () => undefined,
        onReview: () => {
          assert(++reviewers <= 4, 'unchanged checked feedback must converge without an external kill');
          fs.mkdirSync(path.dirname(reportPath), { recursive: true });
          fs.writeFileSync(reportPath, `# Draft ${reviewers}\nThe required conclusion is still missing. Evidence: ${proofRel}\n`);
        },
        onHarnessSummary: ({ phase }) => {
          if (phase !== 'review') return null;
          if (newProof && reviewers === 2 && !proofPublished) {
            fs.mkdirSync(path.dirname(path.join(root, proofRel)), { recursive: true });
            fs.writeFileSync(path.join(root, proofRel), '{"actual_new_input":true}\n');
            proofPublished = true;
          }
          const checks = fixtureReadDependencies(root, [{
          id: fs.existsSync(reportPath) ? 'conclusion_with_verdict' : 'review_report_exists',
          category: 'structure', severity: 'BLOCKER', status: 'FAIL', description: 'a readable independent review conclusion is required',
          details: fs.existsSync(reportPath) ? '审查结论声明仍缺失' : '独立审查报告缺失', affected_files: [reportRel],
          }], [PRODUCT_FILE]);
          const reports = require('../../scripts/utils/report-generator') as typeof import('../../scripts/utils/report-generator');
          const frameworkRoot = path.resolve(__dirname, '../../..');
          reports.generateMergedReport(path.join(frameworkRoot, 'harness'), root, 'review', 'bc-openCard',
            reports.buildScriptReport('review', 'bc-openCard', root, checks), undefined, frameworkRoot);
          return { checks };
        },
      });
      assert(reviewers === (newProof ? 3 : 2), 'only changed feedback or actual new evidence may buy a writer call: ' + reviewers);
      assert(probe.exitCode !== 0 && probe.events.some(event => event.type === 'phase_halt'), 'the unchanged real FAIL must remain waiting');
      assert(!probe.events.some(event => event.type === 'run_end' && ['COMPLETED', 'INTERRUPTED'].includes(String(event.status))),
        'convergence must neither fabricate completion nor rely on an external interruption');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  },
}, {
  name: 'P4 t5 unchanged returned review does not suppress an actionable source repair',
  run: async () => {
    const root = setupGoalRuntimeHost('codex', false).root;
    const marker = 'P4_T5_ACTUAL_REPAIR';
    let invalidatedReview = false;
    let repaired = false;
    let authors = 0;
    try {
      const probe = await runGoalRuntimeChain(root, { ...declareSourceRepairRequest(root).launch,
        adapter: 'codex', runId: 'p4-repair-before-wait',
        onAuthor: ctx => {
          authors++;
          if (ctx.prompt.includes(marker) && !repaired) {
            fs.appendFileSync(path.join(root, PRODUCT_FILE), `\n// ${marker}\n`);
            repaired = true;
          }
        },
        onHarnessSummary: ({ phase }) => {
          if (phase !== 'ut') return null;
          if (!invalidatedReview) {
            // The real return remains in events; its report publication is no longer reusable.
            fs.writeFileSync(path.join(root, 'doc/features/bc-openCard/review/reports/phase-evidence-manifest.json'), '{}');
            invalidatedReview = true;
          }
          return { checks: [productEvidenceCheck(root, marker)] };
        },
      });
      assert(repaired && authors === 2, JSON.stringify({ repaired, authors, invoked: probe.invokedPhases }));
      const repairReturn = probe.events.map(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author').lastIndexOf(true);
      const haltedAt = probe.events.findIndex(event => event.type === 'phase_halt');
      assert(haltedAt > repairReturn && !probe.events.some(event => event.type === 'run_end' && event.status === 'COMPLETED'),
        'repair must finish before the remaining unavailable review proof waits; missing proof never becomes PASS');
      assert(probe.harnessPhases.filter(phase => phase === 'ut').length === 2, 'only the actual repair changes the UT input');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'P4 t5 missing review report invokes its independent writer within the original work loop',
  run: async () => {
    for (const executorMode of ['detached', 'attended'] as const) {
    const root = setupGoalRuntimeHost('codex', false).root;
    const reportRel = 'doc/features/bc-openCard/review/review-report.md';
    const reportPath = path.join(root, reportRel);
    let authors = 0;
    let reviewers = 0;
    try {
      const request = declareSourceRepairRequest(root);
      const probe = await runGoalRuntimeChain(root, { ...request.launch, adapter: 'codex', runId: 'p4-independent-review', executorMode,
        invokeResultFor: phase => phase === 'work-unit-author' ? { provider_session_id: 'p4-original-author-session' } : null,
        onAuthor: (ctx, context) => {
          authors++;
          assert(workUnitExecutionRole(context) === 'author', 'implementation uses its original author');
          assert(ctx.prompt.indexOf('完成当前源码修复与原验证终点') < ctx.prompt.indexOf('核实并修复'), 'the frozen unit goal precedes the parent requirement');
        },
        onReview: ctx => {
          reviewers++;
          assert(ctx.prompt.includes('独立审查') && ctx.prompt.includes('作者原件'), 'independent review receives the original author arguments');
          fs.mkdirSync(path.dirname(reportPath), { recursive: true });
          fs.writeFileSync(reportPath, '# Actual independent review\nRead the actual source and its frozen request.\n');
        },
        onHarnessSummary: ({ phase }) => phase === 'review' ? { checks: fixtureReadDependencies(root, [{
          id: 'review_report_exists', category: 'structure', severity: 'BLOCKER',
          status: fs.existsSync(reportPath) ? 'PASS' : 'FAIL', description: 'the actual independent review report exists',
          details: fs.existsSync(reportPath) ? 'actual report returned' : 'independent review report missing',
          affected_files: [reportRel], failure_kind: 'missing_review_report', blocking_class: 'review_context',
        }], [PRODUCT_FILE]) } : null,
      });
      assert(authors === 1 && reviewers === 1, JSON.stringify({ authors, reviewers, invoked: probe.invokedPhases }));
      const start = probe.events.find(event => event.type === 'agent_invoke_start' && event.phase === 'review');
      assert(start?.handoff_request, 'review is a real issued work-unit invocation');
      const original = require('../../scripts/utils/session-execution-handoff').executionRequestForInvoke(probe.reportDir, start.invoke_id);
      assert(workUnitExecutionRole(original.request.context) === 'verifier', 'review must not reuse the implementation role');
      assert(original.request.context.provider_session_id !== 'p4-original-author-session', 'independent review cannot inherit the implementation session');
      assert(path.resolve(root, original.request.write_boundary.verifierResultPath) === path.resolve(reportPath), 'review has only its report write grant');
      assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(event => event.type === 'run_end')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    }
  },
}, {
  name: 'P1 R2 an unbound historical execution cannot be force re-signed and its partial report remains immutable',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root, runId = 'receipt-unbound-takeover';
    const nodeFs = require('fs') as typeof fs, append = nodeFs.appendFileSync;
    let injected = false;
    try {
      try { await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        testControl: { expectedInterruption: 'injected unbound report commit interruption' },
        onAuthor: () => { nodeFs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
          if (!injected && path.basename(String(args[0])) === 'events.jsonl' && String(args[1]).includes('"type":"agent_invoke_end"')) { injected = true; throw new Error('injected unbound report commit interruption'); }
          return append(...args);
        }) as typeof fs.appendFileSync; },
      }); } catch (error) { assert(String(error).includes('injected unbound report'), String(error)); }
      finally { nodeFs.appendFileSync = append; }
      assert(injected, 'the original report was not archived before the commit interruption');
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
      const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
      const requestPath = path.resolve(runDir, issued.reference.path), requestBytes = fs.readFileSync(requestPath);
      const reportPath = path.join(path.dirname(requestPath), fs.readdirSync(path.dirname(requestPath)).find(file => file.startsWith('execution-report'))!);
      const reportBytes = fs.readFileSync(reportPath);
      releaseRunOwner(runDir, issued.request.context.owner);
      const events = fs.readFileSync(path.join(runDir, 'events.jsonl')), control = fs.readFileSync(path.join(runDir, 'run-control.json'));
      let rejected = false;
      try { await runGoalModeSessionStep({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId,
        adapter: 'codex', runMode: 'attended', forceTakeover: true }); }
      catch (error) { rejected = String(error).includes('没有可核实的原生进程绑定'); }
      assert(rejected, 'lease/release and a saved report cannot prove an old external execution stopped');
      assert(fs.readFileSync(requestPath).equals(requestBytes) && fs.readFileSync(reportPath).equals(reportBytes), 'the failed takeover replaced original evidence');
      assert(fs.readFileSync(path.join(runDir, 'events.jsonl')).equals(events) && fs.readFileSync(path.join(runDir, 'run-control.json')).equals(control), 'the failed takeover changed invocation or owner state');
    } finally { nodeFs.appendFileSync = append; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 receipt replay preserves its original post-snapshot while current checks detect later collaborative input changes',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root, runId = 'receipt-upstream-change';
    const nodeFs = require('fs') as typeof fs, append = nodeFs.appendFileSync;
    let injected = false;
    const acceptanceFile = resolveFeatureArtifact(root, 'bc-openCard', 'acceptance.yaml').actualPath;
    const originalAcceptance = fs.readFileSync(acceptanceFile);
    try {
      try {
        await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'plan', viaSessionStep: true,
          testControl: { expectedInterruption: 'injected plan receipt interruption' },
          onAuthor: () => {
            fs.appendFileSync(resolveFeatureArtifact(root, 'bc-openCard', 'contracts.yaml').actualPath, '\n# original plan output\n');
            nodeFs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
              if (!injected && path.basename(String(args[0])) === 'events.jsonl' && String(args[1]).includes('"type":"phase_write_observed"')
                && String(args[1]).includes('"phase":"work-unit-author"')) { append(...args); injected = true; throw new Error('injected plan receipt interruption'); }
              return append(...args);
            }) as typeof fs.appendFileSync;
          },
        });
      } catch (error) { assert(String(error).includes('injected plan receipt'), String(error)); }
      finally { nodeFs.appendFileSync = append; }
      assert(injected, 'must interrupt the real plan report after its archive write');
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
      const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
      const archiveDir = path.join(runDir, path.dirname(issued.reference.path));
      const archiveName = fs.readdirSync(archiveDir).find(file => file.startsWith('execution-report'));
      assert(archiveName, 'the immutable post/report must be saved before the observation is committed');
      const archiveFile = path.join(archiveDir, archiveName);
      const archiveBytes = fs.readFileSync(archiveFile);
      const changedAcceptance = Buffer.from('feature: bc-openCard\ncriteria:\n  - unapproved-change-after-receipt-archive\n');
      fs.writeFileSync(acceptanceFile, changedAcceptance);
      let ownerSawChange = false;
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true,
        onAuthor: () => { ownerSawChange = fs.readFileSync(acceptanceFile).equals(changedAcceptance); fs.writeFileSync(acceptanceFile, originalAcceptance); },
        onHarnessSummary: ({ phase }) => phase === 'spec' && !fs.readFileSync(acceptanceFile).equals(originalAcceptance)
          ? { checks: [{ id: 'acceptance_content_complete', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
              description: 'current acceptance input remains incomplete', details: 'Later collaborative acceptance input must be reconciled by its current author.',
              affected_files: [path.relative(root, acceptanceFile).replace(/\\/g, '/')], failure_kind: 'code_regression',
              structured: { source_attempt_dependencies: [{ path: path.relative(root, acceptanceFile).replace(/\\/g, '/'), exists: true,
                sha256: require('crypto').createHash('sha256').update(fs.readFileSync(acceptanceFile)).digest('hex'), role: 'artifact' }] } }] }
          : null,
      });
      assert(fs.readFileSync(archiveFile).equals(archiveBytes), 'post-receipt collaboration cannot replace the original archived post');
      const violations = resumed.events.filter(event => event.type === 'phase_write_violation' && event.invoke_id === issued.request.invoke_id);
      assert(!violations.some(event => JSON.stringify(event.violations).includes('acceptance.yaml')), 'a later collaborator write was falsely attributed to the archived execution');
      assert(resumed.invokedPhases.includes('work-unit-author') && resumed.harnessPhases.includes('spec'), 'an old report cannot bless the later changed input without a current check and repair');
      assert(ownerSawChange, 'the runtime must preserve the later change for its real owner, without silently rolling it back');
      assert(resumed.exitCode === 0, 'the responsible owner and normal gates must be able to recover');
      assert(resumed.events.filter(event => event.type === 'agent_invoke_end' && event.invoke_id === issued.request.invoke_id).length === 1, 'partial report replay commits once');
      assert(!resumed.events.some(event => event.type === 'agent_process_settled'), 'no process settlement may be fabricated');
    } finally { nodeFs.appendFileSync = append; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production receipt I/O interruption preserves the pending owner and reuses an immutable report after artifacts change',
  run: async () => {
    const nodeFs = require('fs') as typeof fs;
    for (const cut of ['agent_invoke_end', 'archive_rename'] as const) {
      const root = setupGoalRuntimeHost('codex').root;
      const runId = `receipt-io-${cut}`;
      const append = nodeFs.appendFileSync, rename = nodeFs.renameSync;
      let injected = false, failure: unknown;
      try {
        try {
          await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
            testControl: { expectedInterruption: 'injected receipt' },
            onAuthor: () => {
              nodeFs.appendFileSync(path.join(root, 'doc/features/bc-openCard/spec/spec.md'), '\nOriginal executor output before report.\n');
              nodeFs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
                if (cut === 'agent_invoke_end' && !injected && path.basename(String(args[0])) === 'events.jsonl'
                  && String(args[1]).includes('"type":"agent_invoke_end"')) {
                  injected = true; throw new Error('injected receipt event commit interruption');
                }
                return append(...args);
              }) as typeof fs.appendFileSync;
              nodeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
                if (cut === 'archive_rename' && !injected && path.basename(String(to)).startsWith('execution-report')) {
                  injected = true; throw Object.assign(new Error('injected receipt rename EPERM'), { code: 'EPERM' });
                }
                return rename(from, to);
              }) as typeof fs.renameSync;
            },
          });
        } catch (error) { failure = error; }
        finally { nodeFs.appendFileSync = append; nodeFs.renameSync = rename; }
        assert(injected && String(failure).includes('injected receipt'), `the production report path must hit ${cut}: ${failure}`);
        const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
        const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
        const requestPath = path.join(runDir, issued.reference.path), requestBytes = fs.readFileSync(requestPath);
        assert(!acceptedSessionReport(runDir, issued), 'a failed event commit cannot count as an accepted report');
        const control = readRunControl(runDir, runId)!;
        assert(control.owner?.state === 'active' && control.current_epoch === issued.request.context.owner.epoch,
          `${cut}: an unaccepted current request must keep its original owner: ${JSON.stringify(control)}`);
        const reportDir = path.dirname(requestPath);
        assert(!fs.readdirSync(reportDir).some(file => file.endsWith('.tmp')), 'failed rename must clean only its own temporary material');
        const archiveName = fs.readdirSync(reportDir).find(file => file.startsWith('execution-report'));
        const originalArchive = archiveName ? fs.readFileSync(path.join(reportDir, archiveName)) : null;
        fs.appendFileSync(path.join(root, 'doc/features/bc-openCard/spec/spec.md'), '\nCollaboration changed the artifact after the interrupted report.\n');
        const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
        const accepted = acceptedSessionReport(runDir, issued)!;
        assert(accepted && resumed.exitCode === 0, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
        assert(fs.readFileSync(requestPath).equals(requestBytes), 'report recovery cannot reissue or replace the original request');
        if (originalArchive) assert(fs.readFileSync(path.join(runDir, accepted.event.handoff_report!.path)).equals(originalArchive), 'receipt retry must retain the first archived post-snapshot and report bytes');
        assert(resumed.events.filter(event => event.type === 'agent_invoke_start').length === 1, 'I/O retry cannot reset or recount the original invocation');
        assert(resumed.events.filter(event => event.type === 'agent_invoke_end').length === 1, 'the report commits once');
        assert(resumed.harnessPhases.join(',') === 'spec', 'only the accepted report may enter one formal gate');
        assert(!resumed.events.some(event => event.type === 'agent_process_settled'), 'receipt recovery cannot invent process settlement');
      } finally { nodeFs.appendFileSync = append; nodeFs.renameSync = rename; fs.rmSync(root, { recursive: true, force: true }); }
    }
  },
}, {
  name: '1804 detached empty failed process remains an execution failure without a fabricated quality verdict',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'detached-empty-failure', freshEndPhase: 'spec',
        invokeResultFor: () => ({ exitCode: 1, duration_ms: 10000, stdout: '', stderr: '' }),
        onHarnessSummary: () => ({ checks: [{ id: 'acceptance_content_complete', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
          description: 'the formal checker rejects incomplete output', details: 'The acceptance definition remains incomplete.', failure_kind: 'code_regression' }] }),
      });
      const end = probe.events.find(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author');
      assert(end?.status === 'failed' && end.exit_code === 1 && !invocationCompleted({ ...end, exitCode: end.exit_code }), JSON.stringify(end));
      assert(probe.exitCode !== 0 && probe.invokedPhases.length === 1, 'a genuinely empty failed CLI process must retain its stop policy');
      assert(probe.harnessPhases.length === 0 && !probe.events.some(event => event.type === 'phase_verdict'), 'an uncompleted invocation cannot fabricate a formal quality observation');
      assert(!probe.events.some(event => event.handoff_report), 'this control uses the detached process transport');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 an elapsed session failed report without details retains its execution fact and later verifies real repaired output',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const marker = '// actual session repair completed';
      const candidate = 'doc/features/bc-openCard/spec/spec.md';
      let failedExecution = false;
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'stepwise-elapsed-failure', freshEndPhase: 'spec', viaSessionStep: true,
        failExecutorFor: phase => phase === 'work-unit-author' && failedExecution,
        onAuthor: () => {
          failedExecution = !fs.readFileSync(path.join(root, candidate), 'utf8').includes(marker);
          if (failedExecution) {
            execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
            fs.appendFileSync(path.join(root, candidate), `\n${marker}\n`);
          }
        },
        onHarnessSummary: ({ phase }) => phase === 'spec' ? { checks: [productEvidenceCheck(root, marker, candidate)] } : null,
      });
      const end = probe.events.find(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author');
      assert(end?.status === 'failed' && end.exit_code === 1 && Number(end.duration_ms) >= 10000 && Number(end.duration_ms) < 30000, JSON.stringify(end));
      const archivePath = path.join(probe.reportDir, (end!.handoff_report as { path: string }).path);
      const archiveBytes = fs.readFileSync(archivePath);
      const archived = JSON.parse(archiveBytes.toString('utf8'));
      assert(archived.report.details === undefined, 'a failed report does not require prose details to prove execution');
      const processLog = path.join(probe.reportDir, 'phases/work-unit-author', String(end.invoke_id), 'agent-output.log');
      assert(!fs.existsSync(processLog) || fs.statSync(processLog).size === 0, 'the session has no native CLI output');
      assert(!probe.events.some(event => event.failure_kind_classified === 'agent_no_output' || event.halt_reason === 'agent_no_output'), 'session reports must not inherit a native CLI empty-output heuristic');
      assert(probe.invokedPhases.join(',') === 'work-unit-author,work-unit-author' && probe.harnessPhases.join(',') === 'spec' && probe.exitCode === 0,
        'the current original unit and actual repaired product must reach the real gate/finalizer once');
      const normalEnd = probe.events.find(event => event.type === 'agent_invoke_end' && event.status === 'passed');
      assert(normalEnd && probe.events.indexOf(normalEnd) < probe.events.findIndex(event => event.type === 'harness_start'),
        'the failed execution was substituted for a normally completed executor before formal quality verification');
      assert(fs.readFileSync(archivePath).equals(archiveBytes), 'successful recovery rewrote the failed execution original');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 executor failure remains an execution fact while the formal gate independently judges quality',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const marker = 'actual partial output survives the failed execution';
      const candidate = 'doc/features/bc-openCard/spec/spec.md';
      let failedExecution = false;
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'stepwise-failed-report', freshEndPhase: 'ut', viaSessionStep: true,
        failExecutorFor: phase => phase === 'work-unit-author' && failedExecution,
        onAuthor: () => {
          failedExecution = !fs.readFileSync(path.join(root, candidate), 'utf8').includes(marker);
          if (failedExecution) fs.appendFileSync(path.join(root, candidate), `\n${marker}\n`);
        },
        onHarnessSummary: ({ phase }) => phase === 'spec' ? { checks: [productEvidenceCheck(root, marker, candidate)] } : null,
      });
      const failed = probe.events.find(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author');
      assert(failed?.status === 'failed' && failed.handoff_report, 'the original failed executor report was not preserved');
      const archive = path.join(probe.reportDir, (failed.handoff_report as { path: string }).path);
      const failedBytes = fs.readFileSync(archive);
      assert(probe.harnessPhases.includes('spec') && probe.exitCode === 0 && probe.invokedPhases.length === 2,
        'normal executor recovery still requires an independent formal quality gate and reuses real partial output');
      const quality = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'spec');
      assert(quality?.verdict === 'PASS' && !quality.agent_failed, 'quality was replaced with the executor failure status');
      assert(JSON.parse(failedBytes.toString('utf8')).report.status === 'failed'
        && fs.readFileSync(archive).equals(failedBytes), 'a later quality PASS erased the original execution failure');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 nonresident requests share runtime gate, ownership and finalizer',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'stepwise-parity', freshEndPhase: 'ut', viaSessionStep: true });
      assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(e => e.type === 'phase_halt' || e.type === 'run_end')));
      const starts = probe.events.filter(e => e.type === 'agent_invoke_start');
      const reports = probe.events.filter(e => e.type === 'agent_invoke_end' && e.handoff_report);
      assert(starts.length === reports.length && starts.length > 0, JSON.stringify({starts, reports}));
      assert(!probe.events.some(e => e.type === 'agent_process_settled'), 'session must not manufacture process settled');
      assert(probe.harnessPhases.length >= reports.length, JSON.stringify(probe.harnessPhases));
      assert(readRunControl(probe.reportDir)?.owner?.state === 'released', 'terminal session owner releases');
    } finally { fs.rmSync(root, {recursive:true,force:true}); }
  },
}, {
    // V7（plan 3a7f9c12 D2.5）：goal 失败回喂必须把"写完报告即回传"讲清楚——
    // 少了这段，agent 只看到一串 blocker 就去改产品（这些失败恰恰要先由 verifier
    // 逐条确认），或为了拿候选自己再跑一次 harness（外层马上还要跑一次，纯重复）。
    name: 'D1 repair diagnosis feedback: deliver request, write report, return without re-running harness',
    run: () => {
      const feed = extractPriorFailureContext({
        verdict: 'FAIL',
        next_action: 'run_verifier_for_repair',
        verifier_request: 'doc/features/f1/review/reports/verifier.request.abc.json',
        verifier_report: 'doc/features/f1/review/reports/verifier.report.abc.md',
        blockers: [{ id: 'negative_verdict_closure', details_excerpt: '审查结论=「不通过」' }],
      });
      assert(feed.includes('run_verifier_for_repair'), feed);
      assert(feed.includes('verifier.request.abc.json'), `must name the request path: ${feed}`);
      assert(feed.includes('verifier.report.abc.md'), `must name the report path: ${feed}`);
      assert(/Do NOT edit product code yet/.test(feed), `must hold off on product edits: ${feed}`);
      assert(/Do NOT re-run the harness yourself/.test(feed), `must not ask the agent to re-run: ${feed}`);
      assert(
        feed.replace(/\s+/g, ' ').includes('do NOT wait for candidates or closure before returning'),
        `must not require candidates/closure before returning: ${feed}`,
      );
      // 常规 FAIL 一字不变（没有 next_action 就不该冒出诊断段落）
      const plain = extractPriorFailureContext({
        verdict: 'FAIL',
        next_action: 'fix_blockers_then_rerun',
        blockers: [{ id: 'demo_fail', details_excerpt: 'x' }],
      });
      assert(!plain.includes('run_verifier_for_repair'), plain);
    },
  },
  {
    name: 'P2-T1 fresh facts-baseline early summary uses deterministic guidance, never code-regression revert',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const delivered: string[] = [];
      try {
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'fresh-facts-baseline-ut', freshEndPhase: 'ut',
          onAuthor: ctx => { delivered.push(ctx.prompt); },
          onHarnessSummary: ({ phase }) => phase === 'ut'
            ? { checks: [{
                id: 'capability_resolution_contract', category: 'structure' as const,
                description: 'feature capability contract resolves before checker execution',
                severity: 'BLOCKER' as const, status: 'FAIL' as const,
                details: 'facts baseline stale: return to plan before UT',
                suggestion: 'return to the establishing phase and rebuild current facts',
              }] }
            : null,
        });
        const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdict?.stale_summary === false, JSON.stringify(verdict));
        assert(verdict?.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(verdict));
        assert(verdict?.blocker_signature === 'capability_resolution_contract', JSON.stringify(verdict));
        assert(delivered.some(prompt => prompt.includes('facts baseline stale')), '真实单元作者必须收到当前研究缺口');
        assert(delivered.every(prompt => !prompt.includes('revert that change first')), '研究资料缺口不冒充代码回退');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P2-T2 first nonzero harness exit without any summary is current execution failure, not timeout',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'absent-summary-ut', freshEndPhase: 'ut',
          onHarnessFailureWithoutSummary: ({ phase, attempt }) => phase === 'ut'
            ? `${'progress before fatal '.repeat(30)}\nCURRENT_NO_SUMMARY_${attempt}: writer failed`
            : null,
        });
        const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdict?.stale_summary === false, JSON.stringify(verdict));
        assert(verdict?.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(verdict));
        assert(verdict?.blocker_signature !== 'agent_timeout@ut', JSON.stringify(verdict));
        assert(String(verdict?.harness_error_excerpt).includes('CURRENT_NO_SUMMARY_1'), JSON.stringify(verdict));
        assert(!String(verdict?.harness_error_excerpt).includes('\n'), 'event diagnostic must remain one line');
        assert(probe.exitCode !== 0 && probe.harnessPhases.filter(phase => phase === 'ut').length === 1,
          'a failed gate without a conclusion must naturally leave the runtime instead of repeating unchanged checks');
        assert(probe.invokedPhases.filter(phase => phase === 'work-unit-author').length === 1
          && probe.events.some(event => event.type === 'phase_halt' && event.run_disposition === 'WAITING')
          && !probe.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'),
          'the original completed author and an actionable recovery exit must survive without external quiesce');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'D2 telemetry deferral waits once after a changed current input; ready rechecks only its producer and unchanged returns reuse it',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const registry = require('../../capability-registry') as typeof import('../../capability-registry');
      const originalPreflight = registry.preflightDeviceTestEvidenceCapability;
      const artifact = 'doc/features/bc-openCard/testing/test-report.md';
      let nativeAvailable = true;
      const probes: boolean[] = [];
      try {
        fs.writeFileSync(path.join(root, 'doc/features/bc-openCard/acceptance.yaml'), YAML.stringify({
          flows: { checkout: { screens: ['home', 'success'] } },
          criteria: [{ id: 'AC-1', priority: 'P0', ut_layer: 'device', linked_flow: 'checkout',
            checkpoint: { pre_screen: 'home', action: { type: 'touch', target_element_id: 'pay_button' },
              post_screen: 'success', required_element_ids: ['success_title'], forbidden_element_ids: ['error_banner'] } }],
        }));
        fs.mkdirSync(path.dirname(path.join(root, artifact)), { recursive: true });
        fs.writeFileSync(path.join(root, artifact), '# actual testing prerequisite is not ready\n');
        registry.preflightDeviceTestEvidenceCapability = () => {
          probes.push(nativeAvailable);
          return nativeAvailable ? { mode: 'native', native: true } : { mode: 'unsupported', native: false, reason: 'D2 actual native capability unavailable' };
        };
        const options: NonNullable<Parameters<typeof runGoalRuntimeChain>[1]> = {
          adapter: 'codex', runId: 'd2-telemetry-current-input',
          testingGateChecks: () => {
            const text = fs.readFileSync(path.join(root, artifact), 'utf8');
            const ready = text.includes('D2 actual restored report');
            const check: import('../../scripts/utils/types').CheckResult = { id: 'file_completeness', category: 'structure',
              severity: 'BLOCKER', status: ready ? 'PASS' : 'SKIP', description: 'read the actual testing prerequisite',
              details: ready ? 'The actual report prerequisite is restored.' : 'The actual report prerequisite remains unavailable.' };
            if (!ready) { check.failure_kind = 'capability_missing'; check.actionability = 'framework_blocked'; }
            return fixtureReadDependencies(root, [check], [artifact]);
          },
        };
        const held = await runGoalRuntimeChain(root, options);
        const oldEnd = held.events.find(event => event.type === 'harness_end' && event.phase === 'testing');
        assert(oldEnd && oldEnd.timed_out === false && typeof oldEnd.exit_code === 'number' && oldEnd.related_input_snapshot,
          'the starting evidence must be an actual normal testing return with its observed inputs');
        assert(held.exitCode !== 0 && held.harnessPhases.filter(phase => phase === 'testing').length === 1,
          'the original controlled producer must really observe and retain its unavailable prerequisite');
        nativeAvailable = false;
        fs.writeFileSync(path.join(root, artifact), '# D2 actual restored report\n');
        const probesBefore = probes.length;
        const blocked = await runGoalRuntimeChain(root, { ...options, resume: path.basename(held.reportDir), noAutoForce: true, skipLegacySeal: true });
        const blockedEvents = blocked.events.slice(held.events.length);
        assert(blocked.exitCode !== 0 && blocked.invokedPhases.length === 0 && blocked.harnessPhases.length === 0,
          'the unavailable telemetry gate must wait before a new native invocation or tool starts');
        assert(probes.length === probesBefore + 1 && probes.at(-1) === false,
          'the changed input must reach the real telemetry preflight once, not spin on its deferred outcome');
        assert(blockedEvents.filter(event => event.type === 'phase_verdict' && event.probe === 'native_step_evidence_preflight').length === 1
          && blockedEvents.filter(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting').length === 1,
          'one deferred observation must produce one existing WAIT exit without unbounded event growth');
        assert(!blockedEvents.some(event => event.type === 'harness_start' || event.type === 'harness_end')
          && blockedEvents.some(event => event.type === 'phase_halt' && event.run_disposition === 'WAITING'
            && String(event.halt_guidance).includes('D2 actual native capability unavailable')),
          'the gate must preserve its concrete original readiness guidance and not fabricate a tool end');
        nativeAvailable = true;
        const restored = await runGoalRuntimeChain(root, { ...options, resume: path.basename(held.reportDir), noAutoForce: true, skipLegacySeal: true });
        assert(restored.invokedPhases.length === 0 && restored.harnessPhases.join(',') === 'testing',
          'readiness must let the original changed-input producer recheck once without another author');
        const freshEnd = restored.events.slice(blocked.events.length).find(event => event.type === 'harness_end' && event.phase === 'testing');
        assert(freshEnd && freshEnd.timed_out === false && freshEnd.related_input_snapshot,
          'the real producer must replace the old observation only with its new normal return');
        const unchanged = await runGoalRuntimeChain(root, { ...options, resume: path.basename(held.reportDir), noAutoForce: true, skipLegacySeal: true });
        assert(unchanged.invokedPhases.length === 0 && unchanged.harnessPhases.length === 0,
          'the normal updated result with unchanged inputs must not buy another native invocation or tool');
        assert(!unchanged.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'),
          'natural convergence must not rely on external stopping');
      } catch (error) {
        const reports = path.join(root, 'doc/features/bc-openCard/testing/reports');
        const evidence = preserveRuntimeTestEvidence([root], String(error), ['D2 telemetry main-loop deferred result'],
          [path.join(root, artifact), ...['script-report.json', 'summary.json', 'phase-evidence-manifest.json'].map(name => path.join(reports, name))]);
        fs.writeFileSync(path.join(evidence, 'preflight-observations.json'), JSON.stringify({ nativeAvailable, probes }, null, 2));
        throw error;
      } finally {
        registry.preflightDeviceTestEvidenceCapability = originalPreflight;
        fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache();
      }
    },
  },
  ...(['explicit_continue', 'input'] as const).map(recovery => ({
    name: `P2 missing gate conclusion naturally resumes after real ${recovery} recovery without another author`,
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const condition = path.join(root, recovery === 'input' ? 'doc/features/bc-openCard/spec/spec.md' : 'writer-ready.txt');
      const options = { adapter: 'codex', runId: `absent-summary-recovery-${recovery}`, freshEndPhase: 'spec',
        onHarnessFailureWithoutSummary: ({ phase }: { phase: string }) => phase === 'spec'
          && (!fs.existsSync(condition) || !fs.readFileSync(condition, 'utf8').includes('writer-ready')) ? `CURRENT_WRITER_UNAVAILABLE: ${path.relative(root, condition)}` : null };
      try {
        const held = await runGoalRuntimeChain(root, options);
        assert(held.exitCode !== 0 && held.invokedPhases.join(',') === 'work-unit-author' && held.harnessPhases.join(',') === 'spec',
          'the first gate must run and then return its real unresolved conclusion');
        if (fs.existsSync(condition)) fs.appendFileSync(condition, '\nwriter-ready\n'); else fs.writeFileSync(condition, 'writer-ready\n');
        const resumed = await runGoalRuntimeChain(root, { ...options, resume: path.basename(held.reportDir), forceResume: recovery === 'explicit_continue', skipLegacySeal: true });
        assert(resumed.exitCode === 0 && resumed.invokedPhases.length === 0 && resumed.harnessPhases.join(',') === 'spec',
          JSON.stringify({ exit: resumed.exitCode, authors: resumed.invokedPhases, gates: resumed.harnessPhases,
            halt: resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end') }));
        assert(!resumed.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), 'recovery relied on an external stop');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  })),
  {
    name: 'P2-T1/T4 stale content report never drives a current failed UT producer or repeated author',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        seedUtFailureSummary(root, [{
          id: 'ut_hvigor_build', severity: 'BLOCKER', status: 'FAIL',
          classification: 'code_regression', details_excerpt: 'OLD_COMPILE_ERROR',
        }]);
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'stale-ut-three', freshEndPhase: 'ut',
          onHarnessFailureWithoutSummary: ({ phase, attempt }) =>
            phase === 'ut' ? `CURRENT_PREFLIGHT_${attempt}: facts baseline stale` : null,
        });
        const verdicts = probe.events.filter(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdicts.length === 1, `未变的未知producer只实际执行一次：${JSON.stringify(verdicts)}`);
        for (const [index, event] of verdicts.entries()) {
          assert(event.stale_summary === true, `attempt ${index + 1} not stale`);
          assert(event.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(event));
          assert(!event.blocker_signature, `old signature leaked: ${JSON.stringify(event)}`);
          assert(String(event.harness_error_excerpt).includes(`CURRENT_PREFLIGHT_${index + 1}`), JSON.stringify(event));
          assert(!JSON.stringify(event).includes('ut_hvigor_build'), `old blocker leaked: ${JSON.stringify(event)}`);
        }
        assert(probe.invokedPhases.length === 1 && probe.exitCode !== 0, '当前producer未知须自然等待，不新买阶段作者');
        assert(!probe.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), '不得借外停证明收敛');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P2-T2/T4 fresh UT failure is delivered once; real source change rechecks its producer and retains raw FAIL through current unknown',
    run: async () => {
      const root = setupGoalRuntimeHost('codex', false).root;
      let changed = false;
      let originalReport: Buffer | undefined;
      let missingObjectProof = false;
      try {
        const oldIds = ['boundaries_all_stubbed', 'ut_hvigor_build', 'ut_hvigor_test'];
        const probe = await runGoalRuntimeChain(root, {
          ...declareSourceRepairRequest(root).launch,
          adapter: 'codex', runId: 'fresh-then-stale-ut',
          onAuthor: ctx => {
            if (ctx.prompt.includes('FRESH_COMPILE_') && !changed) {
              const current = resolveCompletionDisposition({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'),
                feature: 'bc-openCard', runId: ctx.runId, chain: ['ut'] });
              missingObjectProof = current.completionBlocking.some(problem => oldIds.includes(problem.id) && !problem.evidence?.length);
              assert(missingObjectProof, '本例必须命中当前必修发现缺少可比对象原件，而非假定unknown');
              originalReport = fs.readFileSync(path.join(root, 'doc/features/bc-openCard/ut/reports/script-report.json'));
              fs.appendFileSync(path.join(root, PRODUCT_FILE), '\n// actual repair changes the checked product\n'); changed = true;
            }
          },
          onHarnessSummary: ({ phase, attempt }) => phase === 'ut' && attempt === 1
            ? { blockers: oldIds.map(id => ({
                id, severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression',
                details_excerpt: `FRESH_COMPILE_${id}`,
              })) }
            : null,
          onHarnessFailureWithoutSummary: ({ phase, attempt }) =>
            phase === 'ut' && attempt > 1 ? `CURRENT_BINDING_${attempt}: input binding stale` : null,
        });
        const verdicts = probe.events.filter(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(changed, 'the actual author callback must reach its source edit');
        assert(missingObjectProof, 'the actual current finding must lack verified object refs');
        assert(verdicts.length === 2, `真实来源变化后只补一次原producer：${JSON.stringify(verdicts)}`);
        const authors = probe.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
        const returned = probe.events.find(event => event.type === 'agent_invoke_end' && event.invoke_id === authors[1]?.invoke_id);
        assert(returned && invocationCompleted({ ...returned, exitCode: returned.exit_code }), '产品变化来自已真实正常交回的原作者');
        assert(probe.events.some(event => event.type === 'phase_write_observed' && event.invoke_id === returned.invoke_id
          && [...(Array.isArray(event.owned) ? event.owned : []), ...(Array.isArray(event.observations) ? event.observations : [])]
            .some(write => write.path === PRODUCT_FILE && write.pre_sha256 !== write.post_sha256)),
        '实际写入观察必须证明产品字节改变，不能只用fixture变量宣称');
        const afterReturn = probe.events.slice(probe.events.indexOf(returned) + 1);
        const nextWork = afterReturn.find(event => event.type === 'harness_start' || event.type === 'agent_invoke_start');
        assert(nextWork?.type === 'harness_start' || nextWork?.type === 'agent_invoke_start' && String(nextWork.phase).includes('verifier'),
          `正常交回后的下一工作必须是真实工具/独核，不可再派作者：${JSON.stringify(nextWork)}`);
        assert(afterReturn.some(event => event.type === 'harness_start' && event.phase === 'ut')
          && !afterReturn.some(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author'),
        '缺refs时先补原UT producer；本次仍无新可用观察，不能再买第二个返修作者');
        assert(verdicts[0].stale_summary === false, JSON.stringify(verdicts[0]));
        assert(verdicts[0].failure_kind_classified === 'code_regression', JSON.stringify(verdicts[0]));
        assert(oldIds.every(id => String(verdicts[0].blocker_signature).includes(id)), JSON.stringify(verdicts[0]));
        for (const [offset, event] of verdicts.slice(1).entries()) {
          assert(event.stale_summary === true, JSON.stringify(event));
          assert(event.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(event));
          assert(!event.blocker_signature, `fresh signature leaked into stale attempt: ${JSON.stringify(event)}`);
          assert(String(event.harness_error_excerpt).includes(`CURRENT_BINDING_${offset + 2}`), JSON.stringify(event));
        }
        const raw = JSON.parse(fs.readFileSync(path.join(root, 'doc/features/bc-openCard/ut/reports/script-report.json'), 'utf8'));
        assert(originalReport && fs.readFileSync(path.join(root, 'doc/features/bc-openCard/ut/reports/script-report.json')).equals(originalReport),
          '未知producer没有产生新可用原件；原始rawFAIL字节保持');
        assert(oldIds.every(id => raw.checks.some((check: { id: string; status: string }) => check.id === id && check.status === 'FAIL')),
          '原始真实FAIL不能被后来的producer未知改写或签PASS');
        assert(probe.exitCode !== 0 && probe.invokedPhases.filter(phase => phase === 'work-unit-author').length === 2
          && !probe.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), 'stale-check recovery must naturally report its real failure');
        assert(probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting' && event.run_disposition === 'WAITING')
          && !probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'no_progress_guard')
          && !probe.events.some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))),
        '没有合格观察必须保unknown自然WAITING，不能伪no_progress或完成');
      } catch (error) {
        const reports = path.join(root, 'doc/features/bc-openCard/ut/reports');
        const evidence = preserveRuntimeTestEvidence([root], String(error), ['P2 current source change before its producer observation'],
          [path.join(root, PRODUCT_FILE), ...['script-report.json', 'summary.json', 'phase-evidence-manifest.json'].map(name => path.join(reports, name))]);
        fs.writeFileSync(path.join(evidence, 'actual-source-callback.json'), JSON.stringify({ changed, missingObjectProof,
          originalReportSha256: originalReport ? require('crypto').createHash('sha256').update(originalReport).digest('hex') : null }, null, 2));
        throw error;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 structural zero: thin shells and executors contain no private lifecycle or gate path',
    run: () => {
      const scripts = path.resolve(__dirname, '../../scripts');
      const runnerShell = fs.readFileSync(path.join(scripts, 'goal-runner.ts'), 'utf-8');
      const driverShell = fs.readFileSync(path.join(scripts, 'utils/goal-in-session-driver.ts'), 'utf-8');
      const hostEntry = fs.readFileSync(path.join(scripts, 'goal-mode-entry.ts'), 'utf-8');
      const executor = fs.readFileSync(path.join(scripts, 'utils/goal-phase-executor.ts'), 'utf-8');
      const processRuntime = fs.readFileSync(path.join(scripts, 'goal-phase-runtime.ts'), 'utf-8');
      const supervisor = fs.readFileSync(path.join(scripts, 'goal-supervise.ts'), 'utf-8');
      assert(!/while\s*\(|for\s*\([^)]*phase/.test(runnerShell), 'goal-runner shell retained a phase loop');
      assert(!/assessFeature|runHarnessPhase|phase_verdict/.test(runnerShell), 'goal-runner shell retained lifecycle ownership');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(|while\s*\(/.test(driverShell),
        'compatibility driver retained private progression');
      assert(!/for\s*\(let round|runInSessionRound|assessFeature/.test(hostEntry),
        'attended host entry retained independent progression');
      assert(!/runHarnessPhase|assessFeature|phase_verdict|writeReceiptScaffold/.test(executor),
        'executor owns a gate or lifecycle transition');
      assert(!/while\s*\(!phaseDone\)/.test(processRuntime)
        && processRuntime.includes('const readWork = () =>') && processRuntime.includes('while (!halted && !dryRun)'),
        'runtime must use current unit facts without retaining the retired phase-attempt queue');
      assert(processRuntime.includes('GoalPhaseRuntime') && processRuntime.includes('DetachedGoalPhaseExecutor'),
        'detached runtime is not wired through the shared runtime/executor boundary');
      assert(!executor.includes('--rebaseline-to') && !supervisor.includes('--rebaseline-to'),
        'executor or supervisor can construct management rebaseline');
    },
  },
  {
    name: 'M2 production parity: attended/detached fresh and retry run the same birth/runtime/gate/projection chain',
    run: async () => {
      const base = setupGoalRuntimeHost('codex', false).root;
      const roots: string[] = [base];
      try {
        const request = declareSourceRepairRequest(base);
        for (const lifecycle of ['fresh', 'retry'] as const) {
          const detachedRoot = cloneHost(base, `${lifecycle}-detached`);
          const attendedRoot = cloneHost(base, `${lifecycle}-attended`);
          roots.push(detachedRoot, attendedRoot);
          const marker = '// parity requirement repaired';
          const repairOptions = (root: string) => lifecycle === 'retry' ? {
            onAuthor: ({ prompt }: { prompt: string }) => { if (prompt.includes(marker)) fs.appendFileSync(path.join(root, PRODUCT_FILE), `\n${marker}\n`); },
            onHarnessSummary: ({ phase }: { phase: string }) => phase === 'coding' ? { checks: [productEvidenceCheck(root, marker)] } : null,
          } : {};
          const detached = await runGoalRuntimeChain(detachedRoot, {
            adapter: 'codex', runId: `matrix-${lifecycle}`, ...request.launch,
            executorMode: 'detached', ...repairOptions(detachedRoot),
          });
          const attended = await runGoalRuntimeChain(attendedRoot, {
            adapter: 'codex', runId: `matrix-${lifecycle}`, ...request.launch,
            executorMode: 'attended', ...repairOptions(attendedRoot),
          });
          assert(detached.exitCode === 0 && attended.exitCode === 0,
            `${lifecycle} did not close: detached=${detached.exitCode} attended=${attended.exitCode}`);
          assert(JSON.stringify(canonicalOf(detached)) === JSON.stringify(canonicalOf(attended)),
            `${lifecycle} canonical projection drift`);
          assert(JSON.stringify(detached.harnessPhases) === JSON.stringify(attended.harnessPhases),
            `${lifecycle} gate sequence drift`);
          if (lifecycle === 'retry') {
            assert(detached.invokedPhases.filter(phase => phase === 'work-unit-author').length === 2
              && attended.invokedPhases.filter(phase => phase === 'work-unit-author').length === 2,
              `the actual original unit did not receive its product repair: ${detached.invokedPhases.join('→')}`);
            assert(fs.readFileSync(path.join(detachedRoot, PRODUCT_FILE), 'utf8').includes(marker)
              && fs.readFileSync(path.join(attendedRoot, PRODUCT_FILE), 'utf8').includes(marker), 'parity passed without a real product repair');
          }
          assert(canonicalOf(attended)[0]?.type === 'run_created', `${lifecycle} lost birth`);
        }
      } catch (error) {
        preserveRuntimeTestEvidence(roots, String(error), ['actual scoped fresh/retry transport parity'],
          roots.flatMap(root => [path.join(root, PRODUCT_FILE), path.join(root, 'doc/features/bc-openCard/feature.yaml')]));
        throw error;
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 executor contract: WorkUnitExecutionContext is deeply immutable and provider-private fields are absent',
    run: () => {
      const ctx = context();
      assert(Object.isFrozen(ctx), 'context must be frozen');
      assert(Object.isFrozen(ctx.chain), 'chain must be frozen');
      assert(Object.isFrozen(ctx.owner), 'owner must be frozen');
      assert(Object.isFrozen(ctx.runtimeFacts), 'runtime facts must be frozen');
      assert(Object.isFrozen(ctx.childEnv), 'child env must be frozen');
      const serialized = JSON.stringify(ctx).toLowerCase();
      for (const field of PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS) {
        assert(!serialized.includes(field), `provider-private field leaked: ${field}`);
      }
      const scrubbed = context({ childEnv: { HARNESS_DIFF_BASE_REF: 'attacker', KEEP: 'yes' } });
      assert(!('HARNESS_DIFF_BASE_REF' in scrubbed.childEnv), 'goal baseline env override was not scrubbed');
      assert(scrubbed.childEnv.KEEP === 'yes', 'unrelated child env changed');
    },
  },
  {
    name: 'M1 production resume keeps the birth phase chain after workflow auto_chain changes',
    run: async () => {
      const root = setupGoalRuntimeHost('codex', false).root;
      try {
        const request = declareSourceRepairRequest(root);
        let originalMethodSet: readonly string[] | undefined;
        const marker = '// frozen chain quality repaired';
        const halted = await runGoalRuntimeChain(root, {
          adapter: 'codex', ...request.launch,
          runId: 'frozen-chain-resume',
          onAuthor: (_ctx, actual) => { originalMethodSet ??= [...actual.chain]; },
          onHarnessSummary: ({ phase }) => phase === 'coding' ? { checks: [productEvidenceCheck(root, marker)] } : null,
        });
        assert(halted.exitCode === 1, `fixture did not halt: ${halted.exitCode}`);
        const manifestBefore = loadGoalManifestFromRun(root, 'frozen-chain-resume', { feature: 'bc-openCard' });
        assert(manifestBefore.phase_chain?.join(',') === request.scope.phase_chain.join(','),
          `birth chain=${manifestBefore.phase_chain?.join(',')}`);

        const resumed = await runGoalRuntimeChain(root, {
          resume: 'frozen-chain-resume', forceResume: true, adapter: 'codex',
          onAuthor: (_ctx, actual) => {
            assert(JSON.stringify(actual.chain) === JSON.stringify(originalMethodSet), 'the current unit lost its original signed request family set');
            fs.appendFileSync(path.join(root, PRODUCT_FILE), `\n${marker}\n`);
          },
          onHarnessSummary: ({ phase }) => phase === 'coding' ? { checks: [productEvidenceCheck(root, marker)] } : null,
          workflowTransform: workflow => ({
            ...workflow,
            auto_chain: ['spec', 'plan', 'coding', 'ut', 'review', 'testing'],
          }),
        });
        assert(resumed.exitCode === 0, `resume exit=${resumed.exitCode}`);
        assert(resumed.invokedPhases.join(',') === 'work-unit-author' && resumed.harnessPhases.includes('coding'),
          `resume must retain the signed family set and reuse unaffected completed checks: ${resumed.harnessPhases.join('→')}`);
        assertOnlyChangedChecksResume(halted, resumed);
        assert(halted.harnessPhases.indexOf('review') >= 0 && halted.harnessPhases.indexOf('review') < halted.harnessPhases.indexOf('ut'),
          'the original current producers did not follow their frozen request family order');
        const manifestAfter = loadGoalManifestFromRun(root, 'frozen-chain-resume', { feature: 'bc-openCard' });
        assert(JSON.stringify(manifestAfter.phase_chain) === JSON.stringify(manifestBefore.phase_chain),
          'resume rewrote frozen phase chain');
      } catch (error) {
        preserveRuntimeTestEvidence([root], String(error), ['actual scoped request family freeze'], [path.join(root, PRODUCT_FILE)]);
        throw error;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 production parity: attended/detached resume and automatic successor preserve lifecycle and lineage baseline',
    run: async () => {
      const base = setupGoalRuntimeHost('codex', false).root;
      const roots: string[] = [base];
      const marker = '// resume and successor quality repaired';
      const repairOptions = (root: string) => ({
        onAuthor: ({ prompt }: { prompt: string }) => { if (prompt.includes(marker)) fs.appendFileSync(path.join(root, PRODUCT_FILE), `\n${marker}\n`); },
        onHarnessSummary: ({ phase }: { phase: string }) => phase === 'coding' ? { checks: [productEvidenceCheck(root, marker)] } : null,
      });
      try {
        const request = declareSourceRepairRequest(base);
        const halted = await runGoalRuntimeChain(base, {
          adapter: 'codex', runId: 'matrix-resume', executorMode: 'detached', ...request.launch,
          onHarnessSummary: ({ phase }) => phase === 'coding' ? { checks: [productEvidenceCheck(base, marker)] } : null,
        });
        assert(halted.exitCode === 1, `resume fixture did not halt: ${halted.exitCode}`);
        const sourceManifest = loadGoalManifestFromRun(base, 'matrix-resume', { feature: 'bc-openCard' });

        const detachedResumeRoot = cloneHost(base, 'resume-detached');
        const attendedResumeRoot = cloneHost(base, 'resume-attended');
        roots.push(detachedResumeRoot, attendedResumeRoot);
        const detachedResume = await runGoalRuntimeChain(detachedResumeRoot, {
          resume: 'matrix-resume', forceResume: true, adapter: 'codex', executorMode: 'detached',
          ...repairOptions(detachedResumeRoot),
        });
        const attendedResume = await runGoalRuntimeChain(attendedResumeRoot, {
          resume: 'matrix-resume', forceResume: true, adapter: 'codex', executorMode: 'attended',
          ...repairOptions(attendedResumeRoot),
        });
        assert(detachedResume.exitCode === 0 && attendedResume.exitCode === 0,
          `resume did not close: detached=${detachedResume.exitCode} attended=${attendedResume.exitCode}`);
        assert(JSON.stringify(canonicalOf(detachedResume)) === JSON.stringify(canonicalOf(attendedResume)),
          'resume canonical projection drift');
        assert(JSON.stringify(detachedResume.harnessPhases) === JSON.stringify(attendedResume.harnessPhases),
          'resume gate sequence drift');
        assert(
          loadGoalManifestFromRun(detachedResumeRoot, 'matrix-resume', { feature: 'bc-openCard' }).run_base_sha ===
            sourceManifest.run_base_sha &&
          loadGoalManifestFromRun(attendedResumeRoot, 'matrix-resume', { feature: 'bc-openCard' }).run_base_sha ===
            sourceManifest.run_base_sha,
          'resume changed immutable birth baseline',
        );

        const detachedSuccessorRoot = cloneHost(base, 'successor-detached');
        const attendedSuccessorRoot = cloneHost(base, 'successor-attended');
        roots.push(detachedSuccessorRoot, attendedSuccessorRoot);
        const detachedSuccessor = await runGoalRuntimeChain(detachedSuccessorRoot, {
          adapter: 'codex', runId: 'matrix-successor', executorMode: 'detached', ...request.launch,
          supersede: ['matrix-resume'],
          ...repairOptions(detachedSuccessorRoot),
        });
        const attendedSuccessor = await runGoalRuntimeChain(attendedSuccessorRoot, {
          adapter: 'codex', runId: 'matrix-successor', executorMode: 'attended', ...request.launch,
          supersede: ['matrix-resume'],
          ...repairOptions(attendedSuccessorRoot),
        });
        assert(detachedSuccessor.exitCode === 0 && attendedSuccessor.exitCode === 0,
          `successor did not close: detached=${detachedSuccessor.exitCode} attended=${attendedSuccessor.exitCode}`);
        const detachedSuccessorManifest = loadGoalManifestFromRun(
          detachedSuccessorRoot, 'matrix-successor', { feature: 'bc-openCard' },
        );
        const attendedSuccessorManifest = loadGoalManifestFromRun(
          attendedSuccessorRoot, 'matrix-successor', { feature: 'bc-openCard' },
        );
        const relativeManifest = (manifest: ReturnType<typeof loadGoalManifestFromRun>, root: string) => {
          const normalized = structuredClone(manifest), scope = normalized.execution_scope;
          assert(scope, 'the successor must retain its actual frozen source scope');
          const relativeBinding = (binding: { dependencies: Array<{ path: string }> }) => {
            for (const dependency of binding.dependencies) {
              const relative = path.relative(root, dependency.path);
              if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) dependency.path = relative.replace(/\\/g, '/') || '.';
            }
          };
          for (const obligation of scope.obligations) {
            obligation.basis.forEach(relativeBinding);
            for (const proof of obligation.satisfied_by ?? []) if ('input_id' in proof) relativeBinding(proof);
          }
          scope.request_impact?.basis.forEach(relativeBinding);
          return normalized;
        };
        const detachedBusiness = relativeManifest(detachedSuccessorManifest, detachedSuccessorRoot);
        const attendedBusiness = relativeManifest(attendedSuccessorManifest, attendedSuccessorRoot);
        assert(JSON.stringify(detachedBusiness.execution_scope) === JSON.stringify(attendedBusiness.execution_scope),
          'successor source bindings differ beyond their actual clone roots');
        const checkedCanonical = (probe: RunProbe, manifest: ReturnType<typeof loadGoalManifestFromRun>, business: ReturnType<typeof relativeManifest>) => {
          const created = probe.events.find(event => event.type === 'run_created' && event.run_id === manifest.run_id);
          assert(created?.manifest_identity_hash === computeManifestIdentityHash(manifest), 'the actual created identity is not bound to its real manifest');
          return canonicalOf(probe).map(event => event.type === 'run_created'
            ? { ...event, manifest_identity_hash: computeManifestIdentityHash(business) } : event);
        };
        assert(JSON.stringify(checkedCanonical(detachedSuccessor, detachedSuccessorManifest, detachedBusiness))
          === JSON.stringify(checkedCanonical(attendedSuccessor, attendedSuccessorManifest, attendedBusiness)), 'successor canonical projection drift');
        assert(JSON.stringify(detachedSuccessor.harnessPhases) === JSON.stringify(attendedSuccessor.harnessPhases), 'successor gate sequence drift');
        assert(detachedSuccessorManifest.successor_of === 'matrix-resume' &&
          attendedSuccessorManifest.successor_of === 'matrix-resume', 'successor lineage missing');
        assert(detachedSuccessorManifest.run_base_sha === sourceManifest.run_base_sha &&
          attendedSuccessorManifest.run_base_sha === sourceManifest.run_base_sha,
        'successor washed out ancestor baseline');
      } catch (error) {
        preserveRuntimeTestEvidence(roots, String(error), ['actual scoped resume/successor parity'],
          roots.flatMap(root => [path.join(root, PRODUCT_FILE), path.join(root, 'doc/features/bc-openCard/feature.yaml')]));
        throw error;
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 runtime precondition: missing immutable baseline stops before executor without agent retry',
    run: async () => {
      let invoked = false;
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        invoked = true;
        return { status: 'passed', phase: ctx.phase };
      });
      let error = '';
      try {
        await new GoalPhaseRuntime().executeExecutor(context({
          owner: { run_id: 'run-1', owner_id: 'dry-run', epoch: 0, kind: 'session' },
          runtimeFacts: { receiptRequired: true, resume: false, successor: false },
        }), executor);
      } catch (caught) {
        error = (caught as Error).message;
      }
      assert(error.includes('framework_corruption') && error.includes('run_base_sha'), error);
      assert(!invoked, 'runtime-owned fact failure must not be fed back to the agent');
    },
  },
  {
    name: 'M2 attended protocol has one host entry and runtime rejects missing injected executor',
    run: async () => {
      const code = await new GoalPhaseRuntime({
        args: [
          '--runtime-executor', 'attended',
          '--runtime-owner', 'session',
        ],
        ownerKind: 'session',
      }).run();
      assert(code === 1, `runtime accepted implicit attended stdio executor: ${code}`);
    },
  },
  {
    name: 'M2 production handoff parity: session→process and process→session resume through the same fenced runtime',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const sessionToProcessRoot = cloneHost(base, 'handoff-session-process');
      const processToSessionRoot = cloneHost(base, 'handoff-process-session');
      const roots = [base, sessionToProcessRoot, processToSessionRoot];
      try {
        const executeTransfer = async (
          root: string,
          runId: string,
          from: 'session' | 'process',
          to: 'session' | 'process',
        ): Promise<{ first: RunProbe; resumed: RunProbe }> => {
          let requestId = '';
          const first = await runGoalRuntimeChain(root, {
            adapter: 'codex',
            runId,
            executorMode: from === 'session' ? 'attended' : 'detached',
            viaHostBridge: from === 'session',
            afterHarnessPass: ({ phase, runId: activeRunId }) => {
              if (phase !== 'spec' || requestId) return;
              const manifest = loadGoalManifestFromRun(root, activeRunId, { feature: 'bc-openCard' });
              const runDir = path.resolve(root, manifest.report_dir);
              const control = readRunControl(runDir, activeRunId);
              assert(control?.owner?.kind === from && control.owner.state === 'active',
                `production ${from} owner missing at boundary`);
              requestId = writeHandoffRequest(runDir, {
                run_id: activeRunId,
                from_epoch: control.current_epoch,
                target_owner_kind: to,
              }).request_id;
            },
          });
          assert(first.exitCode === 0 && requestId, `${from} source did not publish/consume handoff`);
          assert(first.events.some(event =>
            event.type === 'handoff_requested' && event.request_id === requestId),
          `${from} source runtime did not emit handoff_requested`);
          const resumed = await runGoalRuntimeChain(root, {
            resume: runId,
            adapter: 'codex',
            executorMode: to === 'session' ? 'attended' : 'detached',
            viaHostBridge: to === 'session',
          });
          return { first, resumed };
        };

        const sessionToProcess = await executeTransfer(
          sessionToProcessRoot, 'matrix-handoff', 'session', 'process',
        );
        const processToSession = await executeTransfer(
          processToSessionRoot, 'matrix-handoff', 'process', 'session',
        );
        const toProcess = sessionToProcess.resumed;
        const toSession = processToSession.resumed;
        assert(toProcess.exitCode === 0 && toSession.exitCode === 0,
          `handoff targets did not close: process=${toProcess.exitCode} session=${toSession.exitCode}`);
        const processProjection = canonicalOf(toProcess);
        const sessionProjection = canonicalOf(toSession);
        assert(JSON.stringify(processProjection).includes('"from":"session","to":"process","outcome":"success"'),
          'session→process canonical handoff missing');
        assert(JSON.stringify(sessionProjection).includes('"from":"process","to":"session","outcome":"success"'),
          'process→session canonical handoff missing');
        assert(processProjection.filter(event => event.type === 'owner_handoff').length === 1 &&
          sessionProjection.filter(event => event.type === 'owner_handoff').length === 1,
        'handoff projected more than once');
        assert(JSON.stringify(processProjection.filter(event => event.type !== 'owner_handoff')) ===
          JSON.stringify(sessionProjection.filter(event => event.type !== 'owner_handoff')),
        `handoff modes drifted outside direction\nprocess=${JSON.stringify(processProjection)}\n` +
          `session=${JSON.stringify(sessionProjection)}`);
        const processGates = [...sessionToProcess.first.harnessPhases, ...toProcess.harnessPhases];
        const sessionGates = [...processToSession.first.harnessPhases, ...toSession.harnessPhases];
        assert(JSON.stringify(processGates) === JSON.stringify(sessionGates),
          'handoff gate sequence drift');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M5 incident closure: legacy HALTED acafa0 can start an audited rebaseline successor in both modes',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      try {
        const legacy = buildGoalManifestFromInput({
          feature: 'bc-openCard',
          run_id: 'acafa0',
          requirement: '历史 attended 事故占位者',
          start_phase: 'spec',
          end_phase: 'testing',
          adapter: 'codex',
          unattended: { write_mode: 'full-access', approval_mode: 'never' },
        }, { projectRoot: base });
        const legacyManifestPath = writeGoalManifest(legacy, base);
        const legacyEventsPath = path.join(path.dirname(legacyManifestPath), 'events.jsonl');
        fs.writeFileSync(legacyEventsPath, [
          JSON.stringify({
            type: 'run_start',
            ts: '2026-08-27T00:00:00.000Z',
            manifest_identity_fields: { feature: 'bc-openCard' },
          }),
          JSON.stringify({
            type: 'run_end',
            ts: '2026-08-27T00:01:00.000Z',
            status: 'HALTED',
            halt_reason: 'ui_scope_base_missing',
          }),
        ].join('\n') + '\n', 'utf8');
        const unresolved = resolveGoalRunBaseline(base, 'bc-openCard', 'acafa0');
        assert(!unresolved.available, 'incident source unexpectedly has a trusted legacy baseline');
        const head = resolveGoalRunHeadSha(base);

        const detachedRoot = cloneHost(base, 'incident-rebaseline-detached');
        const attendedRoot = cloneHost(base, 'incident-rebaseline-attended');
        roots.push(detachedRoot, attendedRoot);
        const detachedSourceBytes = fs.readFileSync(
          path.join(detachedRoot, legacy.report_dir, 'events.jsonl'), 'utf8');
        const attendedSourceBytes = fs.readFileSync(
          path.join(attendedRoot, legacy.report_dir, 'events.jsonl'), 'utf8');

        const detached = await runGoalRuntimeChain(detachedRoot, {
          adapter: 'codex',
          executorMode: 'detached',
          runId: 'incident-rebaseline',
          supersede: ['acafa0'],
          rebaselineTo: head,
          freshRequirement: '按当前 HEAD 重建问责边界并继续',
        });
        const attended = await runGoalRuntimeChain(attendedRoot, {
          adapter: 'codex',
          executorMode: 'attended',
          runId: 'incident-rebaseline',
          supersede: ['acafa0'],
          rebaselineTo: head,
          freshRequirement: '按当前 HEAD 重建问责边界并继续',
        });

        assert(detached.exitCode === 0 && attended.exitCode === 0,
          `rebaseline successor did not start/close: detached=${detached.exitCode} attended=${attended.exitCode}`);
        assert(JSON.stringify(canonicalOf(detached)) === JSON.stringify(canonicalOf(attended)),
          'incident canonical projection drift');
        assert(JSON.stringify(detached.harnessPhases) === JSON.stringify(attended.harnessPhases),
          'incident gate sequence drift');
        for (const [root, probe] of [[detachedRoot, detached], [attendedRoot, attended]] as const) {
          const manifest = loadGoalManifestFromRun(root, 'incident-rebaseline', { feature: 'bc-openCard' });
          assert(manifest.successor_of === 'acafa0', 'incident successor lineage missing');
          assert(manifest.run_base_sha === head, 'operator-supplied exact HEAD was not frozen');
          const created = probe.events.find(event => event.type === 'run_created');
          const supersede = probe.events.find(event => event.type === 'supersede');
          assert(created?.rebaseline_from_run_id === 'acafa0', 'run_created lacks rebaseline source audit');
          assert(supersede?.target_run_id === 'acafa0' && supersede?.rebaseline_to === head,
            `supersede audit incomplete: ${JSON.stringify(supersede)}`);
        }
        assert(fs.readFileSync(path.join(detachedRoot, legacy.report_dir, 'events.jsonl'), 'utf8') === detachedSourceBytes,
          'detached management command rewrote the source run');
        assert(fs.readFileSync(path.join(attendedRoot, legacy.report_dir, 'events.jsonl'), 'utf8') === attendedSourceBytes,
          'attended management command rewrote the source run');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 owner fence: stale executor result cannot cross the runtime post-invoke boundary',
    run: async () => {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-runtime-fence-'));
      try {
        const control = ensureRunControl(runDir, 'run-1');
        const acquired = casAcquireRunOwner(runDir, 'run-1', control.current_epoch, {
          kind: 'process', owner_id: 'owner-1', pid: process.pid,
        });
        assert(acquired.ok, 'initial owner acquisition failed');
        const ctx = context({ runDir, owner: { ...acquired.token, kind: 'process' } });
        const executor = new AttendedGoalPhaseExecutor(async (actual) => {
          releaseRunOwner(runDir, actual.owner);
          const next = ensureRunControl(runDir, 'run-1');
          const replacement = casAcquireRunOwner(runDir, 'run-1', next.current_epoch, {
            kind: 'session', owner_id: 'owner-2',
          });
          assert(replacement.ok, 'replacement owner acquisition failed');
          return { status: 'passed', phase: actual.phase };
        });
        let rejected = false;
        try { await new GoalPhaseRuntime().executeExecutor(ctx, executor); }
        catch { rejected = true; }
        assert(rejected, 'stale executor result crossed the post-invoke fence');
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 attended executor: callback transport returns normalized output and cannot own a gate',
    run: async () => {
      let receivedPhase = '';
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        receivedPhase = ctx.phase;
        return { status: 'passed', phase: ctx.phase, details: 'host callback done' };
      });
      const result = await executor.execute(context({ owner: {
        run_id: 'run-1', owner_id: 'session-1', epoch: 2, kind: 'session',
      } }));
      assert(receivedPhase === 'coding', 'callback did not receive immutable context');
      assert(result.status === 'passed' && result.exitCode === 0, JSON.stringify(result));
      assert(result.command === 'phase_execute_request', JSON.stringify(result));
    },
  },
  {
    name: 'P1 detached executor: old phase timeout is not an author deadline and invocation output stays truthful',
    run: async () => {
      const plan = { argv: ['codex'], label: 'codex exec', env: {}, adapterName: 'codex' } as HeadlessInvokePlan;
      let called = 0;
      const executor = new DetachedGoalPhaseExecutor(
        (ctx) => ({ plan, cwd: ctx.projectRoot, options: { timeoutMs: 1234, extraEnv: { ...ctx.childEnv } } }),
        async (actualPlan, cwd, options) => {
          called += 1;
          assert(actualPlan.argv === plan.argv && actualPlan.adapterName === 'codex' && actualPlan.modelBinding === context().adapterModel && cwd === '/project', 'invocation plan/cwd drift');
          assert(options?.timeoutMs === undefined && options?.deadlineMs === undefined, 'old phase timeout leaked into the dedicated author');
          return {
            exitCode: 7,
            stdout: 'stdout',
            stderr: 'stderr',
            command: actualPlan.label,
            timed_out: true,
            duration_ms: 55,
            kill_attempted: true,
          };
        },
      );
      const result = await executor.execute(context());
      assert(called === 1, `called=${called}`);
      assert(result.status === 'failed', JSON.stringify(result));
      assert(result.exitCode === 7 && result.timed_out === true && result.duration_ms === 55, JSON.stringify(result));
      assert(result.stdout === 'stdout' && result.stderr === 'stderr', JSON.stringify(result));
    },
  },
  {
    name: 'P1 work-unit executor resumes only the exact author stream across milestones and isolates verifier or changed authority',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-native-recovery-'));
      const runDir = path.join(root, 'goal-runs', 'run-1');
      const dir = path.join(runDir, 'phases', 'coding', 'old-invoke');
      try {
        fs.mkdirSync(dir, { recursive: true });
        const authority = { write_mode: 'full-access' as const, approval_mode: 'never' as const };
        const old = context({ projectRoot: root, runDir, authority, attemptId: 'old-attempt' });
        fs.writeFileSync(path.join(dir, 'request-e1.json'), JSON.stringify({ context: old }));
        fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: 'precise-alpha' }) + '\n');
        const starts = [{ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'old-invoke' }];
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), [...starts, { type: 'agent_invoke_end', invoke_id: 'old-invoke' }].map(row => JSON.stringify(row)).join('\n') + '\n');
        const observedContext = (overrides: Partial<WorkUnitExecutionContext> = {}) => {
          const requested = context({ projectRoot: root, runDir, authority, attemptId: 'new-invoke', ...overrides });
          const observed = observeWorkUnitProviderSession(requested);
          assert(!('status' in observed), `the original invocation is not yet reconciled: ${JSON.stringify(observed)}`);
          return createWorkUnitExecutionContext(requested, observed);
        };
        const continued = observedContext({ phase: 'ut' });
        validateWorkUnitExecutionContext(continued);
        assert(continued.provider_session_id === 'precise-alpha', 'UT milestone lost its author session');
        const rebuilt = rebuildWorkUnitExecutionContext(continued, '上下文压缩后缺少关键背景，按当前产物与上一反馈重建');
        assert(!rebuilt.provider_session_id && rebuilt.instruction?.includes('不等于无损'), 'context reconstruction claimed to preserve private native state');
        assert(observedContext({ phase: 'questioning' }).provider_session_id === undefined, 'verifier reused the author');
        assert(observedContext({ authority: { ...authority, write_mode: 'workspace-write' } }).provider_session_id === undefined, 'changed permissions reused native state');
        fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), '');
        assert(observedContext().provider_session_id === undefined, 'missing native identity was invented');
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), starts.map(row => JSON.stringify(row)).join('\n') + '\n');
        const outstandingBytes = fs.readFileSync(path.join(runDir, 'events.jsonl'));
        const outstanding = observeWorkUnitProviderSession(context({ projectRoot: root, runDir, authority, attemptId: 'new-invoke' }));
        assert('status' in outstanding && outstanding.status === 'waiting' && outstanding.details?.includes('old-invoke'),
          'another author started before the outstanding call was reconciled');
        assert(fs.readFileSync(path.join(runDir, 'events.jsonl')).equals(outstandingBytes), 'waiting observation fabricated an end or changed the original');
        fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: 'precise-alpha' }) + '\n');
        fs.appendFileSync(path.join(runDir, 'events.jsonl'), '{damaged line\n' + JSON.stringify({ type: 'orphan_reclaimed', invoke_id: 'old-invoke' }) + '\n');
        assert(observedContext().provider_session_id === 'precise-alpha', 'the existing orphan reconciliation did not unlock exact continuation');
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), [...starts, { type: 'legacy_run_override', run_id: 'run-1' }].map(row => JSON.stringify(row)).join('\n') + '\n');
        assert(observedContext().provider_session_id === 'precise-alpha', 'the explicit legacy cleanup acknowledgement was ignored');
        const later = path.join(runDir, 'phases', 'coding', 'unclosed-new'); fs.mkdirSync(later);
        fs.writeFileSync(path.join(later, 'request-e1.json'), JSON.stringify({ context: old }));
        fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'unclosed-new' }) + '\n');
        const laterOutstanding = observeWorkUnitProviderSession(context({ projectRoot: root, runDir, authority, attemptId: 'new-invoke' }));
        assert('status' in laterOutstanding && laterOutstanding.status === 'waiting' && laterOutstanding.details?.includes('unclosed-new'),
          'a historical cleanup acknowledgement cleared a later outstanding author');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 work-unit executor accepts non-chain milestones and forwards absolute deadline, observation and cancellation',
    run: async () => {
      const deadline = '2099-10-29T12:30:00.000Z';
      const controller = new AbortController();
      const observations: string[] = [];
      const actualContext = context({ phase: 'repair-implementation-and-tests', user_deadline_at: deadline });
      validateWorkUnitExecutionContext(actualContext);
      const executor = new DetachedGoalPhaseExecutor(() => ({ plan: { argv: ['codex'], label: 'codex exec' }, cwd: '/project',
        options: { timeoutMs: 1, deadlineMs: 1 } }), async (_plan, _cwd, options) => {
        assert(options?.userDeadlineAt === deadline && options.signal === controller.signal, 'explicit user control was lost');
        options.onObservation?.({ type: 'stdout', chunk: 'actual native fact' });
        return { exitCode: 1, command: 'codex exec', stdout: '', stderr: '', interrupted: true, completion_observed: true };
      });
      const result = await executor.execute(actualContext, { signal: controller.signal,
        onObservation: observation => { observations.push(observation.invoke_id); } });
      assert(result.status === 'waiting' && result.interrupted === true, 'interrupted invocation became completed');
      assert(observations.length === 0, 'a missing original request must not produce invented observation facts');
      let expiredCalls = 0;
      const expired = new AttendedGoalPhaseExecutor(async () => { expiredCalls++; return { status: 'passed' }; });
      const stopped = await expired.execute(context({ user_deadline_at: '2000-01-01T00:00:00.000Z' }));
      assert(stopped.status === 'waiting' && expiredCalls === 0, 'expired user constraint started new work');
      const unlimited = new DetachedGoalPhaseExecutor(() => ({ plan: { argv: ['codex'], label: 'codex' }, cwd: '/project' }),
        async () => ({ exitCode: 0, stdout: '', stderr: '', command: 'codex' }));
      for (let i = 0; i < 35; i++) assert((await unlimited.execute(context())).status === 'passed', 'old cumulative call quota returned');
    },
  },
  {
    name: 'P1 R2 session author preserves its complete candidate review report after a generic completion detail',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const report = resolveFeatureArtifact(root, 'bc-openCard', 'review-report.md').actualPath;
      const expected = '# Review report\n\nP1 actual independent review return transport.\n';
      let consumed = false;
      try {
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'p1-review-result', freshEndPhase: 'review', viaSessionStep: true,
          onAuthor: () => { fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, expected); },
          invokeResultFor: phase => phase === 'work-unit-author' ? { details: '完成' } : null,
          onHarnessSummary: ({ phase }) => { if (phase === 'review') consumed = fs.readFileSync(report, 'utf8') === expected; return null; },
        });
        assert(consumed && probe.harnessPhases.includes('review'), 'formal checker did not receive the returned independent report');
        assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 R2 real self-check commands produce summaries and phase state inside the production session loop without write violations',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'p1-real-self-check', freshEndPhase: 'plan', viaSessionStep: true, sessionSelfCheck: true });
        assert(!probe.events.some(event => event.type === 'phase_write_violation'), JSON.stringify(probe.events.filter(event => event.type === 'phase_halt' || event.type === 'phase_write_violation')));
        assert(probe.harnessPhases.includes('spec') && probe.harnessPhases.includes('plan'), 'real self-check outputs prevented the formal runtime gates');
        assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(event => event.type === 'run_end')));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 R2 the same author restores only its unauthorized delta and preserves pre-existing dirty bytes',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const file = path.join(root, 'framework/workflows/pre-existing-dirty.txt');
      const original = 'pre-existing user dirty bytes, absent from HEAD\n';
      fs.writeFileSync(file, original); let calls = 0;
      try {
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'p1-restore-own-delta', freshEndPhase: 'spec', viaSessionStep: true,
          onAuthor: ({ prompt }) => { calls++; if (calls === 1) fs.appendFileSync(file, 'unauthorized author delta\n'); else {
            assert(prompt.includes('blind git restore') && prompt.includes('pre_sha256='), 'the author did not receive the exact original-byte restoration boundary');
            fs.writeFileSync(file, original);
          } },
        });
        assert(calls === 2 && fs.readFileSync(file, 'utf8') === original, 'restoration replaced prior user dirty work');
        assert(!probe.events.some(event => event.halt_reason === 'backtrack_target_absent' || event.halt_reason === 'phase_write_violation_repeat'), JSON.stringify(probe.events.filter(event => event.type === 'phase_halt')));
        assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(event => event.type === 'run_end')));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  ...(['noop', 'partial', 'drift'] as const).map(mode => ({
    name: `P1 R3 unresolved ${mode} restoration cannot enter a gate and retains the first dirty preimage`,
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const files = ['first', 'second'].map(name => path.join(root, `framework/workflows/dirty-${name}.txt`));
      const originals = ['first original user dirty bytes\n', 'second original user dirty bytes\n'];
      files.forEach((file, index) => fs.writeFileSync(file, originals[index]));
      const expected = require('crypto').createHash('sha256').update(originals[0]).digest('hex');
      let calls = 0;
      try {
        const onAuthor = ({ prompt }: { prompt: string }) => {
            calls++;
            if (calls === 1) { fs.appendFileSync(files[0], 'unauthorized B\n'); if (mode === 'partial') fs.appendFileSync(files[1], 'unauthorized second\n'); }
            else if (mode === 'partial' && calls === 2) fs.writeFileSync(files[0], originals[0]);
            else if (mode === 'drift') {
              assert(prompt.includes(`pre_sha256=${expected}`), 'A was replaced with the later unauthorized B/C as the restoration target');
              fs.writeFileSync(files[0], calls === 2 ? 'unauthorized C\n' : originals[0]);
            }
          };
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: `p1-r3-${mode}`, freshEndPhase: 'spec', viaSessionStep: mode !== 'drift', onAuthor });
        if (mode === 'drift') {
          assert(calls === 2 && probe.exitCode !== 0 && probe.harnessPhases.length === 0 && fs.readFileSync(files[0], 'utf8') === 'unauthorized C\n',
            'a wrong restoration must preserve its actual bytes and wait without running a formal gate');
          const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'p1-r3-drift', forceResume: true, skipLegacySeal: true, onAuthor });
          assert(Number(calls) === 3 && resumed.exitCode === 0 && resumed.harnessPhases.length === 1 && fs.readFileSync(files[0], 'utf8') === originals[0],
            'explicit continuation must restore the first dirty preimage before its formal gate');
        }
        else {
          assert(probe.exitCode !== 0 && probe.harnessPhases.length === 0, 'unrestored bytes reached a formal gate');
          assert(calls === (mode === 'noop' ? 2 : 3), 'the existing repeat/recovery boundary changed');
          assert(fs.readFileSync(files[mode === 'partial' ? 1 : 0], 'utf8').includes('unauthorized'), 'runtime silently restored user bytes');
          if (mode === 'partial') assert(fs.readFileSync(files[0], 'utf8') === originals[0], 'a completed partial restoration was lost');
        }
      } catch (error) {
        preserveRuntimeTestEvidence([root], String(error), [`P1 R3 unresolved ${mode} actual unit restoration`], files);
        throw error;
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  })),
  {
    name: 'P1 R3 a unit author edits its registered candidate across methods and formal checks consume the actual artifact',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      const acceptance = resolveFeatureArtifact(root, 'bc-openCard', 'acceptance.yaml').actualPath;
      const original = fs.readFileSync(acceptance, 'utf8'); let calls = 0;
      try {
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'p1-r3-review-artifact', freshEndPhase: 'review',
          onAuthor: () => { calls++; fs.appendFileSync(acceptance, '\n# current unit candidate update\n'); },
          onHarnessSummary: ({ phase }) => {
            if (phase === 'spec') assert(fs.readFileSync(acceptance, 'utf8') === original + '\n# current unit candidate update\n', 'formal verification missed the actual current candidate');
            return null;
          },
        });
        assert(calls === 1 && probe.exitCode === 0 && probe.harnessPhases.includes('spec'), JSON.stringify(probe.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
        assert(!probe.events.some(event => event.type === 'phase_write_violation'), 'the retired method-label boundary rejected an authorized unit candidate');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 R3 completed adapter cleanup exit1 reaches its formal gate once without another author or fake settlement',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'p1-r3-cleanup', freshEndPhase: 'spec',
          invokeResultFor: phase => phase === 'work-unit-author' ? { exitCode: 1, completion_observed: true, kill_attempted: true } : null,
        });
        assert(probe.exitCode === 0 && probe.invokedPhases.length === 1 && probe.harnessPhases.join(',') === 'spec', JSON.stringify(probe.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
        const end = probe.events.find(event => event.type === 'agent_invoke_end')!;
        assert(end.exit_code === 1 && end.completion_observed === true && end.status === 'passed', 'transport rewrote the actual cleanup exit instead of retaining its completed fact');
        assert(!probe.events.some(event => event.type === 'agent_process_settled'), 'the adapter result contract cannot fabricate OS settlement');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 R3 bare terminal text without a reconciled process cannot complete or restart the original session request',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root, runId = 'p1-r3-missing-result';
      try {
        let interrupted = false;
        try { await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
          testControl: { expectedInterruption: 'test cut before any execution report' },
          onAuthor: () => { throw new Error('test cut before any execution report'); },
        }); } catch (error) { interrupted = String(error).includes('test cut'); }
        assert(interrupted, 'the test did not leave its real signed request pending');
        const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }), runDir = path.resolve(root, manifest.report_dir);
        const issued = readSessionExecution(runDir)!;
        const requestPath = path.resolve(runDir, issued.reference.path), originalRequest = fs.readFileSync(requestPath);
        fs.writeFileSync(path.join(runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'), JSON.stringify({ type: 'turn.completed' }) + '\n');
        const originalEvents = fs.readFileSync(path.join(runDir, 'events.jsonl'));
        const recovered = await runGoalModeSessionStep({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId,
          adapter: 'codex', runMode: 'attended', requestPath, action: 'execute' });
        assert(recovered.status === 'waiting' && String(recovered.detail).includes('没有可核实绑定') && !acceptedSessionReport(runDir, issued),
          'a bare terminal envelope became a completed result or started a second native execution');
        assert(fs.readFileSync(requestPath).equals(originalRequest) && fs.readFileSync(path.join(runDir, 'events.jsonl')).equals(originalEvents),
          'unknown execution recovery changed the original request or fabricated process/agent end facts');
      } catch (error) {
        preserveRuntimeTestEvidence([root], String(error), ['P1 actual pending session without a process binding']);
        throw error;
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 R2 review-only work retains tools but rejects product writes before its formal gate',
    run: async () => {
      const root = setupGoalRuntimeHost('codex', false).root;
      const source = path.join(root, PRODUCT_FILE), original = fs.readFileSync(source, 'utf8');
      const report = resolveFeatureArtifact(root, 'bc-openCard', 'review-report.md').actualPath;
      let calls = 0;
      try {
        const configFile = path.join(root, 'framework.config.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.active_workflow = 'obligation-driven';
        fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
        const requirement = 'Review the current implementation only; do not modify product source.';
        const scope = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard',
          completionTarget: 'request', requestedResults: ['review existing implementation'], requestedPhases: ['review'], requirement });
        assert(scope.scope.phase_chain.join(',') === 'review', JSON.stringify(scope.scope));
        const definition = YAML.stringify({ feature: 'bc-openCard', adapter: 'codex', requirement, execution_scope: scope.scope, chain_override: scope.scope.phase_chain,
          unattended: { write_mode: 'full-access', approval_mode: 'never' } });
        const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'p1-review-only-write', freshManifestContent: definition, freshStartPhase: 'review', freshEndPhase: 'review',
          freshRequirement: requirement,
          onAuthor: ({ prompt }) => { calls++; fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, '# Candidate review\n');
            if (calls === 1) fs.appendFileSync(source, '\n// unauthorized review implementation\n');
            else { assert(prompt.includes('pre_sha256='), 'the review was allowed to repair arbitrary implementation'); fs.writeFileSync(source, original); }
          },
        });
        assert(calls === 2 && fs.readFileSync(source, 'utf8') === original, JSON.stringify({ calls, phases: probe.invokedPhases,
          events: probe.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end' || event.type === 'phase_write_violation') }));
        assert(probe.events.some(event => event.type === 'phase_write_violation' && event.phase === 'work-unit-author'), 'the actual review-only unit write boundary did not observe the mutation');
        assert(probe.invokedPhases.every(phase => phase === 'work-unit-author') && probe.harnessPhases.join(',') === 'review' && probe.exitCode === 0, 'review-only work gained a coding grant or gated before restoring its own change');
      } catch (error) {
        preserveRuntimeTestEvidence([root], String(error), ['P1 actual review-only unit source authority'], [source, report]);
        throw error;
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'M2 detached executor: an explicit waiting result retains its reason instead of becoming failed',
    run: async () => {
      const detail = '独立提供方暂不可用；提供方恢复后继续原窗口。';
      const executor = new DetachedGoalPhaseExecutor(
        () => ({ plan: { argv: ['codex'], label: 'codex exec' } as HeadlessInvokePlan, cwd: '/project' }),
        async () => ({ status: 'waiting', details: detail, exitCode: 0, stdout: '', stderr: '', command: 'codex exec' }),
      );
      const result = await executor.execute(context());
      assert(result.status === 'waiting', JSON.stringify(result));
      assert(result.details === detail, JSON.stringify(result));
      assert(result.exitCode === 0, JSON.stringify(result));
      const withoutReason = new DetachedGoalPhaseExecutor(
        () => ({ plan: { argv: ['codex'], label: 'codex exec' } as HeadlessInvokePlan, cwd: '/project' }),
        async () => ({ status: 'waiting', details: '', exitCode: 0, stdout: '', stderr: '', command: 'codex exec' }),
      );
      const incomplete = await withoutReason.execute(context());
      assert(incomplete.status === 'waiting' && !!incomplete.details, 'an absent reason must not turn waiting into an author failure');
    },
  },
  {
    name: 'M2 design invocation originals stay readonly; real end facts preserve completed waiting and failed outcomes without restoring drafts',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-result-replay-'));
      const invokeId = 'design-repair-author-i1';
      const eventFile = path.join(root, 'events.jsonl');
      fs.mkdirSync(path.join(root, 'design-repair'), { recursive: true });
      fs.mkdirSync(path.join(root, 'phases/design-repair-author', invokeId), { recursive: true });
      const draft = path.join(root, 'design-repair/component-blueprint.yaml');
      const rows = [{ type: 'design_authority_repair', stage: 'attempted', signature: 'real-design' },
        { type: 'agent_invoke_start', phase: 'design-repair-author', invoke_id: invokeId },
        { type: 'agent_invoke_end', phase: 'design-repair-author', invoke_id: invokeId, exit_code: 0, status: 'passed' }];
      try {
        fs.writeFileSync(eventFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
        fs.writeFileSync(draft, 'original author bytes\n');
        recordDesignRepairInvocation(root, 'author', invokeId, { started: true, ok: true, status: 'passed', detail: 'actual invocation output' });
        const originalFile = path.join(root, 'phases/design-repair-author', invokeId, 'design-result.json');
        const original = fs.readFileSync(originalFile);
        fs.writeFileSync(draft, 'later machine invalidation\n');
        const saved = JSON.parse(original.toString('utf8'));
        assert(saved.outcome.ok && Buffer.from(saved.draft_outputs['component-blueprint.yaml'], 'base64').toString('utf8') === 'original author bytes\n', 'the producer preserves real output for current-fact recovery');
        assert(invocationCompleted({ ...rows[2], exitCode: rows[2].exit_code }), 'actual completed facts remain reusable');
        for (const status of ['waiting', 'failed']) {
          fs.writeFileSync(eventFile, rows.map(row => JSON.stringify(row.type === 'agent_invoke_end' ? { ...row, status, exit_code: status === 'failed' ? 1 : 0 } : row)).join('\n') + '\n');
          const ended = JSON.parse(fs.readFileSync(eventFile, 'utf8').trim().split('\n').at(-1)!);
          assert(!invocationCompleted({ ...ended, exitCode: ended.exit_code }), 'an archived passed claim cannot overwrite current waiting or failed end facts');
          assert(fs.readFileSync(originalFile).equals(original) && fs.readFileSync(draft, 'utf8') === 'later machine invalidation\n', 'reading an original never restores old drafts over current work');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'M2 canonical projection: attended/detached lifecycle is equal while executor telemetry and volatile identity differ',
    run: () => {
      const birth = { type: 'run_created', ts: 'A', manifest_identity_hash: 'hash', run_base_sha_digest: 'base' };
      const detached = [
        birth,
        { type: 'adapter_probe', pid: 10 },
        { type: 'phase_start', phase: 'coding', ts: 'A', pid: 10, epoch: 1, attempt: 1 },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'detached-i1' },
        { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'detached-i1', exit_code: 0 },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: 'A' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED', ts: 'A', pid: 10 },
      ];
      const attended = [
        { ...birth, ts: 'B' },
        { type: 'phase_start', phase: 'coding', ts: 'B', owner_id: 'session', epoch: 99, round: 3 },
        { type: 'stdio_request', phase: 'coding', request_id: 'stdio-1' },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: 'B' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED', ts: 'B', pid: 99 },
      ];
      const a = projectCanonicalLifecycle(detached);
      const b = projectCanonicalLifecycle(attended);
      assert(JSON.stringify(a) === JSON.stringify(b), `detached=${JSON.stringify(a)}\nattended=${JSON.stringify(b)}`);
      assert(a.map(event => event.type).join(',') === 'run_created,phase_start,phase_verdict,run_end', JSON.stringify(a));
    },
  },
  {
    name: 'M2 canonical projection: bidirectional handoff direction/outcome is preserved exactly once',
    run: () => {
      const projected = projectCanonicalLifecycle([
        { type: 'handoff_requested', request_id: 'a', target_owner_kind: 'process', from_epoch: 1 },
        { type: 'lease_poll', request_id: 'a' },
        { type: 'handoff_accepted', request_id: 'a', owner_kind: 'process', epoch: 2 },
        { type: 'handoff_requested', request_id: 'b', target_owner_kind: 'session', from_epoch: 2 },
        { type: 'handoff_accepted', request_id: 'b', owner_kind: 'session', epoch: 3 },
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'owner_handoff', from: 'session', to: 'process', outcome: 'success' },
        { type: 'owner_handoff', from: 'process', to: 'session', outcome: 'success' },
      ]), JSON.stringify(projected));
    },
  },
  {
    name: 'M2 production rejected handoff retains target direction in canonical lifecycle',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        let requestId = '';
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex',
          runId: 'production-handoff-rejected',
          onAuthor: ({ runId }) => {
            const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
            const runDir = path.resolve(root, manifest.report_dir);
            const control = readRunControl(runDir, runId);
            assert(control?.owner?.kind === 'process', 'production process owner missing');
            const request = writeHandoffRequest(runDir, {
              run_id: runId,
              from_epoch: control.current_epoch + 1,
              target_owner_kind: 'session',
            });
            requestId = request.request_id;
          },
        });
        assert(probe.exitCode === 0, `rejected handoff run exit=${probe.exitCode}`);
        const rejected = probe.events.find(event =>
          event.type === 'handoff_rejected' && event.request_id === requestId);
        assert(rejected?.target_owner_kind === 'session',
          `production rejection lost target: ${JSON.stringify(rejected)}`);
        const handoffs = canonicalOf(probe).filter(event => event.type === 'owner_handoff');
        assert(JSON.stringify(handoffs) === JSON.stringify([
          { type: 'owner_handoff', from: 'process', to: 'session', outcome: 'failed' },
        ]), `canonical rejection=${JSON.stringify(handoffs)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 canonical projection: halt/backtrack semantics are retained without volatile fields',
    run: () => {
      const projected = projectCanonicalLifecycle([
        { type: 'phase_halt', phase: 'review', halt_reason: 'source_drift', ts: 'x', owner_id: 'p' },
        { type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'coding', invalidated_phases: ['review', 'ut'], epoch: 4 },
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'phase_halt', phase: 'review', halt_reason: 'source_drift' },
        { type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'coding', invalidated_phases: ['review', 'ut'] },
      ]), JSON.stringify(projected));
      const outcome: { phase: string; verdict: string; halted: boolean; run_disposition?: string; probe?: string } = {
        phase: 'testing', verdict: 'PASS', halted: false,
      };
      const history = [{ type: 'phase_halt', phase: 'testing', run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'device_readiness' },
        { type: 'phase_verdict', phase: 'testing', verdict: 'PASS', harness_exit: 0, stale_summary: false }];
      const current = enrichOutcomesWithProjection([outcome], history)[0];
      assert(!current.run_disposition && !current.probe, 'current real PASS retained the old device wait projection');
      const unknown = enrichOutcomesWithProjection([outcome], [...history,
        { type: 'phase_halt', phase: 'testing', run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'current_evidence_missing' }])[0];
      assert(unknown.run_disposition === 'WAITING' && unknown.probe === 'current_evidence_missing', 'a later real unknown was cleared by historical PASS');
    },
  },
];

export async function runSelectedCases(selector?: string): Promise<import('../utils/unit-case-selection').SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases.filter(item => selector === undefined || item.name.includes(selector))) {
    try { await testCase.run(); results.push({ name: testCase.name, ok: true }); }
    catch (error) { results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) }); }
  }
  return { results, matchedCaseCount: results.length, executionTimings: [] };
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) });
    }
  }
  return results;
}
