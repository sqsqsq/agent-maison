import { beginUnitCase } from '../utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { resolveCurrentDisposition, phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { readCurrentDispositionInput, resolveCompletionDisposition, collectCleanPassIssues, collectPhaseCompletionIssues } from '../../scripts/utils/verify-feature-completion';
import { reduceRunState } from '../../scripts/utils/run-state-reducer';
import { runDeviceReadinessGate } from '../../scripts/utils/device-readiness-gate';
import { ensureRunControl, casAcquireRunOwner } from '../../scripts/utils/goal-run-control';
import { issueSessionExecution, writePhaseExecutionRequestMaterial, acceptSessionExecution, acceptedSessionReport, sessionToolEventsLogPath } from '../../scripts/utils/session-execution-handoff';
import { runVisionCanaryProbe } from '../../scripts/utils/goal-preflight';
import { generateRandomCanaryAnswerKey } from '../../scripts/utils/vision-canary';
import { loadLocalConfig } from '../../scripts/utils/framework-local-config';
import { countAgentInvokeStarts, resolveResumedBudget } from '../../scripts/utils/goal-runner-phase';
import { invocationCompleted } from '../../scripts/utils/invocation-completion';
import { buildVerificationNoProgressGuidance } from '../../scripts/goal-phase-runtime';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import type { AgentInvokeResult } from '../../scripts/utils/agent-invoke';
import { loadWorkflowSpec } from '../../workflow-loader';
import { clearFrameworkConfigCache } from '../../config';
import { makeVerifierProject, FRAMEWORK_SOURCE_ROOT } from '../utils/verifier-project-fixture';
import { fixture as requestFixture } from './request-entry.unit.test';
import { prepareExplicitRequest } from '../../scripts/utils/capability-resolution-entry-input';
import { readRunControl } from '../../scripts/utils/goal-run-control';
import type { WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { setupRunlessProject } from './execution-scope.unit.test';
import { ensureFeatureExecutionScopeFrozen, readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { readPhaseRepairIssues, phaseIssuesForVerifierSubject } from '../../scripts/utils/repair-candidates';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { featurePhaseReportsDir } from '../../config';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { writeRunEvents, seedCleanCompletionChain } from '../utils/completion-chain-seed';
import { resolveCurrentScopeView } from '../../scripts/utils/feature-track';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { writeRunSummaryBase } from '../../harness-runner';
import { buildNextLine } from '../../harness-runner';
import { repairResponsibilityContext, resolveRepairResponsibility } from '../../scripts/utils/repair-responsibility';
import type { CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { capturePhaseInvocationSnapshot } from '../../scripts/utils/phase-write-boundary';
import { workUnitFeedbackDelivered } from '../../scripts/utils/goal-phase-executor';
import { dispositionFacts, type CompletionEvaluation } from '../../scripts/utils/goal-failure-classifier';

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  ...(['process', 'session'] as const).flatMap(transport => (['author', 'verifier', 'legacy'] as const).map(kind => ({
    name: `86c4d5be frozen ${kind} material survives ${transport} issuance return and cold preparation`,
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-business-input-'));
      const runDir = path.join(root, 'run'); fs.mkdirSync(runDir); fs.mkdirSync(path.join(root, 'product'));
      fs.writeFileSync(path.join(root, 'product/input.txt'), 'actual approved product');
      try {
        ensureRunControl(runDir, 'run');
        const acquired = casAcquireRunOwner(runDir, 'run', 0, { kind: transport, owner_id: 'owner', lease_ms: 60000 });
        assert(acquired.ok); if (!acquired.ok) return;
        const disposition = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'spec', verdict: 'FAIL', schemaCurrent: true, closureCommitted: false,
          checks: [{ id: 'real_required_object', status: 'FAIL', severity: 'MAJOR', repair_owner: 'spec', affected_files: ['product/input.txt'], details: 'report-i1: actual required object missing' }] }] });
        const evaluation: CompletionEvaluation = { acceptanceKey: 'original-acceptance', inputs: { 'product/input.txt': { exists: true, contentHash: 'same-product' } },
          disposition, completed: false, checkFamilies: ['spec'] };
        const verifier = kind === 'verifier';
        const { buildVerifierRequest, renderVerifierRequest, canonicalRequestInput } = require('../../scripts/utils/verifier-request') as typeof import('../../scripts/utils/verifier-request');
        const request = buildVerifierRequest({ feature: 'demo', phase: 'spec', prompt_path: 'product/input.txt', prompt_sha256: 'a'.repeat(64),
          material_sha256: 'b'.repeat(64), gate_fingerprint: null, source_commit_sha: null, worktree_digest: null });
        const purpose = verifier ? 'verifier_format_repair' : 'work-unit-author';
        const instruction = verifier ? `independent review\n${renderVerifierRequest(request)}` : 'original requirement\nreport-i1: actual required object missing';
        const raw: WorkUnitExecutionContext = { runId: 'run', feature: 'demo', workflowId: 'spec-driven', track: 'full', chain: ['spec'],
          phase: verifier ? 'spec-verifier-format-repair' : 'work-unit-author', attemptId: 'i1', owner: { ...acquired.token, kind: transport },
          projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, runDir, reportDir: 'run', adapter: 'claude', executionRole: verifier ? 'verifier' : 'author', instruction,
          ...(kind === 'legacy' ? {} : { workInput: { material: { purpose, segments: verifier ? [canonicalRequestInput(request)] : ['original requirement', dispositionFacts(disposition)] }, evaluation } }),
          runtimeFacts: { receiptRequired: false, resume: false, successor: false }, childEnv: {} };
        const runtime = new GoalPhaseRuntime();
        const prepared = runtime.prepareExecutionContext(raw); assert(!('status' in prepared)); if ('status' in prepared) return;
        assert(!prepared.workInput || Object.isFrozen(prepared.workInput.material.segments));
        const invokeId = `${raw.phase}-i1`;
        const boundary = { projectRoot: root, feature: 'demo', executionRole: raw.executionRole!, phaseOrder: [], domains: [], diagnostics: [], unresolvedSourcePhases: [], protectedRoots: ['product'] };
        const snapshotOptions = { runtimeExcluded: ['run'] };
        const pre = capturePhaseInvocationSnapshot(boundary, snapshotOptions); assert(!pre.failureReason, pre.failureReason ?? 'snapshot must be observable');
        const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
        const input = { context: prepared, invokeId, purpose, issuedAt: new Date().toISOString(), gateTimeoutMs: 0, cleanupReserveMs: 0,
          preSnapshot: pre, writeBoundary: boundary, snapshotOptions };
        if (transport === 'session') {
          emit({ type: 'agent_invoke_start', phase: raw.phase, invoke_id: invokeId, purpose });
          const issued = issueSessionExecution({ ...input, emit });
          acceptSessionExecution({ runDir, issued, report: { phase: raw.phase, status: 'passed', details: 'actual completed return' }, emit });
          assert.deepEqual(issued.request.context.workInput, prepared.workInput);
        } else {
          const issued = writePhaseExecutionRequestMaterial(input);
          emit({ type: 'agent_invoke_start', phase: raw.phase, invoke_id: invokeId, purpose, handoff_request: issued.reference });
          emit({ type: 'agent_invoke_end', phase: raw.phase, invoke_id: invokeId, purpose, exit_code: 0, status: 'passed' });
        }
        const { executionRequestForInvoke } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
        const saved = executionRequestForInvoke(runDir, invokeId)!; assert(saved);
        const next = { ...raw, attemptId: 'i2' };
        const waiting = (value: WorkUnitExecutionContext) => {
          for (const kernel of [runtime, new GoalPhaseRuntime()]) assert.equal((kernel.prepareExecutionContext(value) as { status?: string }).status, 'waiting');
        };
        waiting(next);
        const displayed = verifier ? `new audit hint check-i2/report.json\n${renderVerifierRequest({ ...request, prompt_sha256: 'c'.repeat(64), source_commit_sha: 'd'.repeat(40) })}`
          : 'original requirement\nreport-i2: the same required object is missing\nprevious final answer and rebuilt native session display';
        if (kind === 'legacy') assert(!('status' in new GoalPhaseRuntime().prepareExecutionContext({ ...next, instruction: displayed })), 'old originals keep their strict instruction comparison');
        else {
          waiting({ ...next, instruction: displayed });
          assert(workUnitFeedbackDelivered(saved.request.context, disposition), 'the signed frozen evaluation proves actual feedback delivery');
          const newFeedback = structuredClone(disposition); newFeedback.problems[0].detail = 'overwritten report-i2: same object';
          assert(workUnitFeedbackDelivered(saved.request.context, newFeedback), 'current report wording cannot invalidate already-delivered feedback');
          assert(!('status' in new GoalPhaseRuntime().prepareExecutionContext({ ...next, workInput: { ...raw.workInput!,
            material: { ...raw.workInput!.material, segments: [...raw.workInput!.material.segments, 'real new repair notes or approved capability'] } } })), 'real non-disposition input still reaches the role');
          assert(!('status' in new GoalPhaseRuntime().prepareExecutionContext({ ...next, workInput: { ...raw.workInput!,
            material: { ...raw.workInput!.material, purpose: 'new-approved-responsibility' } } })), 'a new actual responsibility is not merged');
          assert.deepEqual(executionRequestForInvoke(runDir, invokeId)!.request.context.workInput, saved.request.context.workInput, 'current input preparation never backfills an old original');
        }
        fs.writeFileSync(path.join(root, 'product/input.txt'), 'actual changed product');
        assert(!('status' in new GoalPhaseRuntime().prepareExecutionContext(next)), 'a real product change remains dispatchable');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  }))),

 {
  name: 'c6 no-progress guidance names the current verification subject gap and preserves content-repair wording selection',
  run() {
    const issue = { phase: 'plan', owner: 'plan', id: 'open_finding:pending-evidence', action: 'verify' as const,
      affects: 'completion' as const, severity: 'BLOCKER' as const, detail: '缺少当前执行条件与冻结原件的对应核实' };
    const input = { phase: 'plan', subjectId: 'subject-current', request: 'doc/features/demo/plan/reports/verifier.request.subject-current.json',
      problems: [issue], diagnostics: ['pending-evidence：原验证方尚未解释配置变化'] };
    const guidance = buildVerificationNoProgressGuidance(input)!.join('\n');
    for (const required of ['同一 subject subject-current 补核仍有具体缺口', issue.detail, input.request, input.diagnostics[0], '责任方=plan', '由原 verifier', '按新的当前处置继续']) assert(guidance.includes(required), guidance);
    assert(!guidance.includes('同输入修复未取得进展') && !guidance.includes('相关目标未知'));
    assert.equal(buildVerificationNoProgressGuidance({ ...input, problems: [{ ...issue, action: 'repair' }] }), undefined,
      'real repair retains its existing no-progress guidance');
    assert.equal(buildVerificationNoProgressGuidance({ ...input, problems: [issue, { ...issue, id: 'real-external-condition', action: 'wait' }] }), undefined,
      'a real missing external condition is not rendered as pure semantic verification');
  },
},  {
  name: 'c6 goal self-check NEXT lists the current required task before old PASS and closed receipt guidance',
  run() {
    const target = 'doc/features/demo/spec/spec.md';
    const candidate = { id: 'current-required-spec', category: 'spec' as const, files: [target],
      summary: 'doc/features/demo/acceptance.yaml:12-14 AC-2 requires the bank list to declare its approved ordering rule',
      item_fingerprint: 'a'.repeat(64), source_phase: 'spec' };
    for (const next_action of ['fix_verifier_findings_then_rerun_harness', 'fill_receipt_then_sync_closure', 'phase_closed_wait_user']) {
      const summary = { verdict: 'PASS', next_action, closure_status: 'closed', repair_candidates: [candidate] };
      const line = buildNextLine(summary, 'spec', 'demo', { outerGoalRerun: true });
      assert(line.includes(candidate.id) && line.includes(target) && line.includes(candidate.summary));
      assert(line.includes('acceptance.yaml') && line.includes('原验证方复验'));
      assert(!line.includes('停下等待用户指令') && !line.includes('尚未完成的返修任务'), line);
      assert(line.includes('既有闭环证明保留') && summary.closure_status === 'closed', 'new work changes guidance without invalidating the earlier closure proof');
    }
  },
}, {
  name: 'c6 NEXT separates actual owner work from handoffs and keeps every current blocker and lawful closure action',
  run() {
    const f = setupRunlessProject({ chain: ['review'], completionTarget: 'request' });
    try {
      const responsibility = repairResponsibilityContext({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature });
      const coding = { id: 'CR-NEXT', category: 'coding' as const, files: ['src/demo/value.ts'],
        summary: 'acceptance.yaml:8 AC-1 requires value 42', item_fingerprint: 'c'.repeat(64), source_phase: 'review' };
      assert.equal(resolveRepairResponsibility({ ...responsibility, target: coding }).owner, 'coding');
      const unit = { ...coding, id: 'UT-NEXT', category: 'verification' as const, files: [`doc/features/${f.feature}/ut/mock-plan.yaml`], source_phase: 'ut' };
      assert.equal(resolveRepairResponsibility({ ...responsibility, target: unit }).owner, 'ut');
      const unitLine = buildNextLine({ verdict: 'PASS', next_action: 'fill_receipt_then_sync_closure', repair_candidates: [unit] },
        'ut', f.feature, { responsibility });
      assert(unitLine.includes('当前本职责必修任务') && unitLine.includes('责任=ut') && !unitLine.includes('责任=verification'), unitLine);
      for (const outerGoalRerun of [false, true]) for (const closure_status of ['open', 'closed']) {
        const next_action = closure_status === 'closed' ? 'phase_closed_wait_user' : 'fill_receipt_then_sync_closure';
        const summary = { verdict: 'PASS', next_action, closure_status, repair_candidates: [coding] };
        const line = buildNextLine(summary, 'review', f.feature, { outerGoalRerun, responsibility });
        assert(line.includes('他职责交接任务') && line.includes('责任=coding') && line.includes(coding.id), line);
        assert(!line.includes('当前本职责必修任务'), line);
        assert(!line.includes('harness-runner.ts --phase review'), 'a review-only request cannot be told to repair implementation or rerun review before owner work');
        if (!outerGoalRerun) assert(line.includes(closure_status === 'closed' ? '停下等待用户指令' : 'check-receipt --phase review'), line);
        else assert(line.includes('goal runtime 正式 gate') && !line.includes('尚未完成的返修任务'), line);

        const negative = buildNextLine({ ...summary, verdict: 'FAIL', next_action: 'fix_verifier_findings_then_rerun_harness' },
          'review', f.feature, { outerGoalRerun, responsibility });
        assert(negative.includes('原始 FAIL 结论保留') && negative.includes('原验证方复验'), negative);
        assert(!negative.includes('harness-runner.ts --phase review') && !negative.includes('停下等待用户指令') && !negative.includes('check-receipt --phase review'), negative);
      }

      const verification = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'review', verdict: 'FAIL', schemaCurrent: true,
        closureCommitted: false, openFindings: [{ id: coding.id, detail: coding.summary, owner: 'review', verificationRequired: true }] }] });
      const pendingSummary = { verdict: 'FAIL', next_action: 'fix_verifier_findings_then_rerun_harness', repair_candidates: [coding] };
      const pending = buildNextLine(pendingSummary,
        'review', f.feature, { responsibility, currentDisposition: verification });
      assert(verification.completionBlocking.some(problem => problem.id === `open_finding:${coding.id}` && problem.action === 'verify' && problem.owner === 'review'));
      assert(pending.includes(coding.id) && pending.includes(coding.summary) && pending.includes('动作=verify') && pending.includes('责任=review'), pending);
      assert.equal(pendingSummary.verdict, 'FAIL', 'rendering the current verification task cannot rewrite the raw failure');
      assert(!verification.completionEligible && !pending.includes('当前适用验收没有未完项') && !pending.includes('harness-runner.ts --phase review'), pending);

      const spec = { id: 'SPEC-NEXT', category: 'spec' as const, files: [`doc/features/${f.feature}/spec.md`],
        summary: 'acceptance.yaml:8 AC-1 requires its approved behavior', item_fingerprint: 's'.repeat(64), source_phase: 'spec' };
      const owner = resolveRepairResponsibility({ ...responsibility, target: spec }).owner;
      assert.equal(owner, 'spec');
      const blockers = [{ id: 'product_gate', suggestion: 'fix the executed assertion' }, { id: 'receipt_gate', details_excerpt: 'repair the current receipt input' }];
      for (const outerGoalRerun of [false, true]) for (const closure_status of ['open', 'closed']) {
        for (const repair_candidates of [[spec], [spec, coding]]) {
          const disposition = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'spec', verdict: 'FAIL',
            schemaCurrent: true, closureCommitted: closure_status === 'closed',
            failingChecks: blockers.map(blocker => ({ id: blocker.id, status: 'FAIL', severity: 'BLOCKER', details: blocker.suggestion ?? blocker.details_excerpt })),
            openFindings: repair_candidates.map(candidate => ({ id: candidate.id, detail: candidate.summary,
              files: candidate.files, owner: resolveRepairResponsibility({ ...responsibility, target: candidate }).owner ?? undefined, source_phase: candidate.source_phase })) }] });
          const rawSummary = { verdict: 'FAIL', closure_status, next_action: 'fix_verifier_findings_then_rerun_harness', blockers, repair_candidates };
          const line = buildNextLine(rawSummary,
            'spec', f.feature, { outerGoalRerun, responsibility, currentDisposition: disposition });
          for (const candidate of repair_candidates) {
            const problem = disposition.completionBlocking.find(problem => problem.id === `open_finding:${candidate.id}`);
            assert(problem && problem.action === 'repair' && problem.owner === resolveRepairResponsibility({ ...responsibility, target: candidate }).owner);
            assert(line.includes(candidate.id) && line.includes(candidate.summary) && line.includes(`责任=${problem.owner}`), line);
            for (const file of candidate.files) assert(line.includes(file), line);
          }
          for (const blocker of blockers) assert(line.includes(blocker.id) && line.includes((blocker.suggestion ?? blocker.details_excerpt)!), line);
          for (const problem of disposition.problems) assert(line.includes(problem.id) && line.includes(problem.detail) && line.includes(`动作=${problem.action}`), line);
          assert.equal(rawSummary.verdict, 'FAIL');
          assert(!disposition.completionEligible && !line.includes('当前适用验收没有未完项') && !line.includes('停下等待用户指令'), line);
        }
      }
      const gateReport = generateScriptReport(path.join(FRAMEWORK_SOURCE_ROOT, 'harness'), 'review', f.feature, f.root,
        [{ id: 'review_report_exists', category: 'structure', description: 'current report', status: 'PASS', severity: 'BLOCKER', details: 'present' }], FRAMEWORK_SOURCE_ROOT);
      let current: ReturnType<typeof resolveCurrentDisposition> | undefined;
      writeRunSummaryBase(f.root, gateReport, f.frameworkRoot, { onCurrentDisposition: value => { current = value; } });
      assert(current?.completionBlocking.every(problem => problem.phase === 'review'), 'the real writer exposes only its existing synchronous common disposition for NEXT rendering');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'c6 NEXT keeps an ownerless current finding consistent with the ordinary repair next_action',
  run() {
    const candidate = { id: 'OWNERLESS-NEXT', category: 'verification' as const, files: [],
      summary: 'current review evidence requires repair', item_fingerprint: 'd'.repeat(64), source_phase: 'review' };
    const currentDisposition = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'review', verdict: 'PASS',
      schemaCurrent: true, closureCommitted: false, openFindings: [{ id: candidate.id, detail: candidate.summary }] }] });
    assert(currentDisposition.completionBlocking.some(problem => problem.action === 'repair' && !problem.owner && problem.phase === 'review'));
    const summary = { verdict: 'PASS', closure_status: 'open', next_action: 'fix_verifier_findings_then_rerun_harness', repair_candidates: [candidate] };
    const line = buildNextLine(summary, 'review', 'demo', { currentDisposition });
    const problem = currentDisposition.completionBlocking.find(problem => problem.id === `open_finding:${candidate.id}`)!;
    assert(problem && problem.action === 'repair' && problem.owner === undefined && problem.phase === 'review');
    assert(line.includes(candidate.id) && line.includes(candidate.summary) && line.includes('动作=repair') && line.includes('责任=当前工作单元'), line);
    assert(!currentDisposition.completionEligible && !line.includes('当前适用验收没有未完项') && !line.includes('停下等待用户指令'), line);
    assert(!line.includes('harness-runner.ts --phase review --feature demo') && !line.includes('check-receipt --phase review'), line);
    assert.equal(summary.verdict, 'PASS', 'a raw machine PASS cannot erase the actual unresolved repair');
    assert.equal(summary.next_action, 'fix_verifier_findings_then_rerun_harness');
  },
}, {
  name: 'global corrupt run completion problems preserve every current phase proof and remain visible at the completion endpoint',
  run() {
    const f = setupRunlessProject({ chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] });
    const fidelity = require('../../scripts/utils/fidelity-shared') as typeof import('../../scripts/utils/fidelity-shared');
    try {
      const frozen = ensureFeatureExecutionScopeFrozen({ ...f, projectRoot: f.root });
      assert.equal(frozen.status, 'frozen', JSON.stringify(frozen.checks));
      const previous = readFeatureFrozenScope(f.root, f.feature)!.execution_scope;
      const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      seedCleanCompletionChain({ projectRoot: f.root, feature: f.feature, chain });
      writeRunEvents(f.root, f.feature, 'RUN1', [{ type: 'run_start', chain },
        ...chain.map(phase => ({ type: 'phase_verdict', phase, verdict: 'PASS', action: 'advance' }))]);
      const workflow = resolveWorkflowSpec(f.root, { frameworkRoot: f.frameworkRoot });
      const options = { projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature, chain, workflow, executionScope: previous, runId: 'RUN1' };
      const view = () => resolveCurrentScopeView({ ...options, previous, currentRunId: options.runId });
      const baseline = view();
      assert.deepEqual(baseline.phase_chain, [], JSON.stringify({ chain: baseline.phase_chain,
        problems: resolveCurrentDisposition(readCurrentDispositionInput(options)).reasons }));
      const runsDir = path.join(f.root, 'doc/features', f.feature, 'goal-runs');
      const corruptDir = path.join(runsDir, 'unrelated-missing-manifest');
      fs.mkdirSync(corruptDir); fs.writeFileSync(path.join(corruptDir, 'events.jsonl'), '{"type":"run_start"}\n');
      assert(fidelity.classifyGoalRunsDir(runsDir).corruptRuns.some(run => run.runId === 'unrelated-missing-manifest'));
      const disposition = resolveCurrentDisposition(readCurrentDispositionInput(options));
      assert(disposition.completionBlocking.some(problem => problem.id === 'goal_run_identity_intact'));
      assert.equal(disposition.completionEligible, false);
      assert(collectCleanPassIssues(options).some(problem => problem.condition === 'goal_run_identity_intact'));
      assert.deepEqual(phaseCompletionProblems(disposition, chain), []);
      assert.deepEqual(view(), baseline, 'global identity diagnostics cannot invalidate phase evidence');
      for (const phase of chain) assert.deepEqual(collectPhaseCompletionIssues({ ...options, chain: [phase] }), []);
      const summaryPath = path.join(featurePhaseReportsDir(f.root, f.feature, 'coding'), 'summary.json');
      fs.appendFileSync(summaryPath, '\n');
      assert(collectPhaseCompletionIssues({ ...options, chain: ['coding'] }).some(problem => problem.condition === 'lineage_fresh'),
        'real proof byte changes still reopen the responsible phase');
      fs.writeFileSync(path.join(runsDir, 'RUN1', 'manifest.json'), '{broken current identity');
      assert.throws(() => readCurrentDispositionInput(options), 'the attached current run still rejects its own corrupted identity');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
},  {
  name: 'one causal owner handoff retains a raw failure until source rechecks and never borrows an old PASS or an invalidated completion',
  run() {
    const { root } = makeVerifierProject();
    try {
      const feature = 'demo', runId = 'owner-source';
      fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.writeFileSync(path.join(root, 'src/owner-input.ts'), 'export const value = 1;\n');
      const sourceChecks: CheckResult[] = [{ id: 'current_assertion_failure', category: 'structure', description: 'current assertion',
        status: 'FAIL', severity: 'BLOCKER', details: 'original verifier still observes a failure', repair_owner: 'coding', affected_files: ['src/owner-input.ts'] },
        { id: 'testing_failure_routing_current_input', category: 'structure', description: 'executed assertion repair candidate', status: 'FAIL',
          severity: 'BLOCKER', failure_kind: 'assertion', failure_code: 'assertion_mismatch', coding_candidate: true,
          repair_owner: 'coding', affected_files: ['src/owner-input.ts'], details: 'executed assertion points to the same repair object' }];
      const ownerChecks: CheckResult[] = [{ id: 'spec_file_exists', category: 'structure', description: 'owner output',
        status: 'PASS', severity: 'BLOCKER', details: 'owner gate executed its current input' }];
      const report = (phase: string, checks: CheckResult[]) => generateScriptReport(path.join(FRAMEWORK_SOURCE_ROOT, 'harness'), phase, feature, root, checks, FRAMEWORK_SOURCE_ROOT);
      const sourceSummary = writeRunSummaryBase(root, report('testing', sourceChecks), FRAMEWORK_SOURCE_ROOT);
      const ownerSummary = writeRunSummaryBase(root, report('coding', ownerChecks), FRAMEWORK_SOURCE_ROOT);
      const events: Record<string, unknown>[] = [
        { type: 'run_start', chain: ['coding', 'testing'] },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-old' },
        { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'coding-old', exit_code: 0 },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance' },
        { type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'retry' },
      ];
      const read = (checks = ownerChecks, sourceCurrent = false) => {
        writeRunEvents(root, feature, runId, events);
        return resolveCurrentDisposition(readCurrentDispositionInput({ projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, feature, runId,
          chain: ['coding', 'testing'], currentResults: [{ phase: 'coding', summary: ownerSummary, checks },
            ...(sourceCurrent ? [{ phase: 'testing', summary: sourceSummary, checks: sourceChecks }] : [])] }));
      };
      const issue = (value: ReturnType<typeof read>) => value.completionBlocking.find(problem => problem.id === 'current_assertion_failure');
      assert.equal(issue(read())?.owner, 'coding', 'finding after an earlier PASS remains repair work');
      let ownerCalls = 0;
      const complete = () => {
        const invoke_id = `coding-new-${++ownerCalls}`;
        events.push({ type: 'agent_invoke_start', phase: 'coding', invoke_id }, { type: 'agent_invoke_end', phase: 'coding', invoke_id, exit_code: 0 });
      };
      complete();
      assert.equal(issue(read())?.action, 'verify'); assert.equal(issue(read())?.owner, 'testing');
      assert(!read().completionEligible, 'handoff does not close the original failure');
      events.push({ type: 'agent_invoke_start', phase: 'testing', invoke_id: 'testing-recheck' },
        { type: 'agent_invoke_end', phase: 'testing', invoke_id: 'testing-recheck', exit_code: 0 },
        { type: 'harness_start', phase: 'testing', invoke_id: 'testing-recheck' });
      assert.equal(issue(read())?.action, 'verify', 'starting or returning a source invocation cannot make its old report a current verdict');
      assert.equal(issue(read(ownerChecks, true))?.owner, 'coding', 'current source FAIL reopens its actual repair owner');
      assert.equal(issue(read([...ownerChecks, { id: 'required_owner_execution', category: 'structure', description: 'missing execution',
        status: 'SKIP', severity: 'BLOCKER', failure_kind: 'framework_bug', details: 'did not execute' }]))?.owner, 'coding', 'raw PASS cannot borrow mandatory owner execution');
      events.push({ type: 'phase_invalidated', phase: 'coding' });
      assert.equal(issue(read())?.owner, 'coding', 'a later invalidation revokes completed owner work');
      complete();
      assert.equal(issue(read())?.action, 'verify');
      events.push({ type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'retry', stale_summary: false });
      assert.equal(issue(read())?.owner, 'coding', 'a new fresh source verdict reopens repair');
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'current bound raw failures and mandatory gaps survive a PASS summary while explicit current results replace the earlier report',
  run() {
    const { root } = makeVerifierProject();
    try {
      const checks: CheckResult[] = [
        { id: 'current_actual_blocker', category: 'structure', description: 'actual product failure', status: 'FAIL', severity: 'BLOCKER', details: 'actual failed assertion' },
        { id: 'current_required_execution', category: 'structure', description: 'required check did not execute', status: 'SKIP', severity: 'BLOCKER', details: 'execution missing', failure_kind: 'framework_bug' },
      ];
      const report = generateScriptReport(path.join(FRAMEWORK_SOURCE_ROOT, 'harness'), 'coding', 'demo', root, checks, FRAMEWORK_SOURCE_ROOT);
      const summary = writeRunSummaryBase(root, report, FRAMEWORK_SOURCE_ROOT);
      const misleading = { ...summary, verdict: 'PASS', blockers: [], blocker_count: 0, blocking_skips: [], quality_axes: undefined };
      const summaryPath = path.join(featurePhaseReportsDir(root, 'demo', 'coding', FRAMEWORK_SOURCE_ROOT), 'summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify(misleading));
      const opts = { projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, feature: 'demo', chain: ['coding'] };
      const persisted = resolveCurrentDisposition(readCurrentDispositionInput(opts));
      assert(persisted.completionBlocking.some(problem => problem.id === 'current_actual_blocker'));
      assert(persisted.completionBlocking.some(problem => problem.id === 'required_check_conclusion' && problem.detail.includes('current_required_execution')));
      const current = resolveCurrentDisposition(readCurrentDispositionInput({ ...opts, currentResults: [{ phase: 'coding', summary: misleading,
        checks: [{ ...checks[0], status: 'PASS' }] }] }));
      assert(!current.completionBlocking.some(problem => problem.id === 'current_actual_blocker'
        || problem.id === 'required_check_conclusion' && problem.detail.includes('current_required_execution')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'specific current owner and wait cause subsume the generic failed verdict without closing the problem',
  run() {
    const owner = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'review', verdict: 'FAIL', schemaCurrent: true,
      closureCommitted: false, openFindings: [{ id: 'CR-007', detail: 'confirmed implementation defect', owner: 'coding' }] }] });
    assert.equal(owner.completionBlocking[0].owner, 'coding');
    assert(!owner.completionBlocking.some(problem => problem.id === 'verdict_pass'));
    assert(!owner.completionEligible);
    const wait = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'coding', verdict: 'INCOMPLETE', schemaCurrent: true,
      closureCommitted: false, requiredGaps: [{ id: 'native_execution', failure_kind: 'framework_bug', blocking_class: 'framework_internal' }] }] });
    assert.equal(wait.completionBlocking.filter(problem => problem.id === 'required_check_conclusion').length, 1);
    assert.equal(wait.completionBlocking[0].action, 'wait'); assert.equal(wait.completionBlocking[0].owner, 'framework');
  },
}, {
  name: 'transferred Feature semantic reader keeps explicit run identity after gate environment is restored',
  run() {
    const f = setupRunlessProject({ chain: ['spec'], completionTarget: 'request' });
    const previousRun = process.env.MAISON_GOAL_RUN_ID;
    try {
      const runId = 'semantic-explicit-run';
      ensureFeatureExecutionScopeFrozen({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature });
      prepareGoalModeRun({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature, runId, adapter: 'codex', requirement: '把 value 改成 42' });
      const dir = featurePhaseReportsDir(f.root, f.feature, 'plan', f.frameworkRoot);
      fs.mkdirSync(dir, { recursive: true });
      const subjectId = 'a'.repeat(64);
      fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ verifier_subject_id: subjectId }));
      publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: dir, feature: f.feature, phase: 'plan', subjectId,
        reportText: '```yaml\nverification_result:\n  phase: plan\n  feature: runless\n  checks:\n    - { id: reference_crosscheck, status: FAIL, severity: MAJOR }\n```\n' });
      delete process.env.MAISON_GOAL_RUN_ID;
      assert.throws(() => readPhaseRepairIssues(f.root, f.feature, 'plan'), /本次调用没有 run 身份/,
        '无身份读取仍必须拒绝，不可退化为feature范围');
      assert.doesNotThrow(() => readPhaseRepairIssues(f.root, f.feature, 'plan', { frameworkRoot: f.frameworkRoot, runId }),
        '已知manifest身份必须显式透传，不能靠gate进程环境残留');
    } finally {
      if (previousRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = previousRun;
      fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache();
    }
  },
}, {
  name: 'transferred review repair reader uses explicit run identity without a gate environment and rejects missing or wrong identity',
  run() {
    const f = setupRunlessProject();
    const previousRun = process.env.MAISON_GOAL_RUN_ID;
    try {
      const runId = 'explicit-review-run';
      execFileSync('git', ['init', '-q'], { cwd: f.root });
      execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: f.root });
      assert.equal(ensureFeatureExecutionScopeFrozen({ ...f, projectRoot: f.root }).status, 'frozen');
      prepareGoalModeRun({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature, runId, adapter: 'codex', requirement: '把 value 改成 42' });
      const target = 'src/demo/value.ts', fix = 'make value match the required 42';
      const report = path.join(f.root, 'doc/features', f.feature, 'review/review-report.md');
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(report, `# Review\n## 问题清单\n| ID | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |\n|---|---|---|---|---|---|\n| CR-RUN | MAJOR | 逻辑错误 | current value is 1 | ${target} | ${fix} |\n## 结论\n**审查结论**: 不通过\n`);
      const reportsDir = featurePhaseReportsDir(f.root, f.feature, 'review', f.frameworkRoot);
      const subjectId = 'c'.repeat(64);
      fs.mkdirSync(reportsDir, { recursive: true }); fs.writeFileSync(path.join(reportsDir, 'summary.json'), JSON.stringify({ verifier_subject_id: subjectId }));
      publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir, feature: f.feature, phase: 'review', subjectId,
        reportText: `\`\`\`issue-verification\n- issue: CR-RUN\n  verdict: confirmed\n  repair_owner: coding\n  evidence: ${target} | ${fix}\n\`\`\`\n` });
      delete process.env.MAISON_GOAL_RUN_ID;
      const context = { frameworkRoot: f.frameworkRoot, runId };
      const read = readPhaseRepairIssues(f.root, f.feature, 'review', context);
      assert(read, 'the transferred review must keep the explicitly supplied run identity');
      assert(read.rows.some(row => row.id === 'CR-RUN'));
      assert.deepEqual(read.diagnostics, []);
      assert(phaseIssuesForVerifierSubject(f.root, f.feature, 'review', subjectId, f.frameworkRoot, undefined, runId)?.rows.some(row => row.id === 'CR-RUN'));
      assert.equal(readPhaseRepairIssues(f.root, f.feature, 'review', { frameworkRoot: f.frameworkRoot }), null,
        'a transferred feature cannot borrow scope without a run identity');
      assert.equal(readPhaseRepairIssues(f.root, f.feature, 'review', { ...context, runId: 'wrong-run' }), null);
      process.env.MAISON_GOAL_RUN_ID = runId;
      assert.equal(readPhaseRepairIssues(f.root, f.feature, 'review', { ...context, runId: 'wrong-run' }), null,
        'an explicitly wrong identity cannot borrow a valid gate environment');
      assert(readPhaseRepairIssues(f.root, f.feature, 'review', { frameworkRoot: f.frameworkRoot })?.rows.some(row => row.id === 'CR-RUN'), 'legacy environment fallback stays supported');
      process.env.MAISON_GOAL_RUN_ID = 'wrong-environment';
      assert(readPhaseRepairIssues(f.root, f.feature, 'review', context)?.rows.some(row => row.id === 'CR-RUN'), 'explicit identity takes precedence over a different environment');
    } finally {
      if (previousRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = previousRun;
      fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache();
    }
  },
}, {
  name: 'shared invocation writer keeps the same request structure without leaking session lease or issuance to process transport',
  run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-invocation-material-'));
    const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
    try {
      const issuedAt = new Date(Date.now() - 1000).toISOString();
      const context: WorkUnitExecutionContext = { runId: 'run', feature: 'demo', workflowId: 'spec-driven', track: 'full', chain: ['coding'],
        phase: 'coding', attemptId: 'i1', owner: { run_id: 'run', owner_id: 'process-one', epoch: 1, kind: 'process' }, projectRoot: root,
        frameworkRoot: FRAMEWORK_SOURCE_ROOT, runDir, reportDir: 'run', adapter: 'claude', instruction: 'Original complete instruction including the self-check command.',
        runtimeFacts: { runBaseSha: 'a'.repeat(40), receiptRequired: true, resume: false, successor: false },
        childEnv: { MAISON_GOAL_RUN_ID: 'run', PRIVATE_TEST_CREDENTIAL: 'never-persist' } };
      const input = { context, invokeId: 'coding-i1', issuedAt, timeoutMs: 60000, gateTimeoutMs: 30000,
        cleanupReserveMs: 1000, preSnapshot: null, writeBoundary: null };
      const processMaterial = writePhaseExecutionRequestMaterial(input);
      assert.deepEqual(writePhaseExecutionRequestMaterial(input).reference, processMaterial.reference);
      assert(fs.existsSync(path.join(runDir, processMaterial.reference.path)));
      assert.equal(readRunControl(runDir, 'run'), null); assert(!fs.existsSync(path.join(runDir, 'events.jsonl')));
      assert(!JSON.stringify(processMaterial.request).includes('never-persist'));
      ensureRunControl(runDir, 'run');
      const acquired = casAcquireRunOwner(runDir, 'run', 0, { kind: 'session', owner_id: 'session-one', lease_ms: 60000 });
      assert(acquired.ok); if (!acquired.ok) return;
      const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: issuedAt, ...event }) + '\n');
      emit({ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i2' });
      const sessionMaterial = issueSessionExecution({ ...input, context: { ...context, attemptId: 'i2', owner: { ...acquired.token, kind: 'session' } },
        invokeId: 'coding-i2', emit });
      assert.deepEqual(Object.keys(sessionMaterial.request).sort(), Object.keys(processMaterial.request).sort());
      assert.deepEqual(Object.keys(sessionMaterial.request.context).sort(), Object.keys(processMaterial.request.context).sort());
      assert.equal(sessionMaterial.request.deadline, processMaterial.request.deadline);
      assert.equal(sessionMaterial.request.pre_snapshot, processMaterial.request.pre_snapshot);
      assert(sessionMaterial.request.context.instruction?.startsWith(processMaterial.request.context.instruction!));
      assert.equal(readRunControl(runDir, 'run')?.owner?.kind, 'session');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
},    {
  name: 'P3 unreadable shared input preserves an actual current product defect and keeps completion unknown',
  run() {
    const input = { projectRoot: os.tmpdir(), feature: 'partial-facts', chain: ['coding'], endpoint: 'request' as const,
      currentResults: [{ phase: 'coding', summary: { verdict: 'FAIL' }, checks: [{ id: 'actual_native_defect', severity: 'BLOCKER', status: 'FAIL',
        details: '真实已执行编译仍报TS2322', affected_files: ['src/value.ts'], failure_kind: 'code_regression' }] }] };
    Object.defineProperty(input, 'executionScope', { enumerable: true, get() { throw new Error('fixture current scope original unreadable'); } });
    const mixed = resolveCompletionDisposition(input);
    assert(!mixed.completionEligible);
    assert(mixed.completionBlocking.some(problem => problem.id === 'actual_native_defect' && problem.action === 'repair'));
    assert(mixed.completionBlocking.some(problem => problem.action === 'verify' && problem.detail.includes('fixture current scope original unreadable')));
    const missingInput = { projectRoot: input.projectRoot, feature: input.feature, chain: input.chain, endpoint: input.endpoint };
    Object.defineProperty(missingInput, 'executionScope', { enumerable: true, get() { throw new Error('fixture current scope original unreadable'); } });
    const missing = resolveCompletionDisposition(missingInput);
    assert(!missing.completionEligible && !missing.completionBlocking.some(problem => problem.action === 'repair'), 'missing originals cannot invent a product defect');
  },
}, {
  name: 'PreparedRequest uses common current disposition without Feature materials and keeps original strict failure policy',
  run() {
    const f = requestFixture('ut');
    try {
      const request = prepareExplicitRequest(f.options);
      const input = (checks: import('../../scripts/utils/check-disposition').DispositionCheck[]) => readCurrentDispositionInput({
        endpoint: 'request', projectRoot: f.root, request, checks });
      assert.equal(resolveCurrentDisposition(input([{ id: 'native_assertion', status: 'FAIL', severity: 'MAJOR' }])).completionEligible, false);
      const gap = resolveCurrentDisposition(input([{ id: 'request_provider_unavailable', status: 'SKIP', severity: 'BLOCKER', failure_kind: 'capability_missing' }]));
      assert(gap.completionBlocking.some(problem => problem.action === 'wait'));
      const disclosure = resolveCurrentDisposition(input([{ id: 'context_exploration_files_inspected_min', status: 'FAIL', severity: 'BLOCKER' }]));
      assert(disclosure.completionEligible); assert(disclosure.disclosed.length);
      assert(!disclosure.problems.some(problem => ['summary_schema_current', 'closure_commit_present', 'goal_run_identity_intact'].includes(problem.id)));
      assert(!fs.existsSync(path.join(f.root, 'doc/features/ut')));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'request current-result reader binds saved checks to the prepared native input snapshot',
  run() {
    const f = requestFixture('ut');
    try {
      const request = prepareExplicitRequest(f.options);
      fs.mkdirSync(request.reportDir, { recursive: true });
      fs.writeFileSync(path.join(request.reportDir, 'script-report.json'), JSON.stringify({ subject: 'request', request_sha256: request.request_sha256,
        targets: request.bindings, checks: [{ id: 'native_assertion', status: 'PASS', severity: 'BLOCKER' }], summary: { verdict: 'PASS' } }));
      assert(resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'request', projectRoot: f.root, request })).completionEligible);
      fs.writeFileSync(path.join(f.root, 'src/value.js'), 'exports.value = 43;\n');
      assert.throws(() => prepareExplicitRequest(f.options), /another request\/baseline/);
      const changed = prepareExplicitRequest({ ...f.options, reportDir: 'doc/reports/changed' });
      fs.mkdirSync(changed.reportDir, { recursive: true });
      fs.copyFileSync(path.join(request.reportDir, 'script-report.json'), path.join(changed.reportDir, 'script-report.json'));
      assert(!resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'request', projectRoot: f.root, request: changed })).completionEligible);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'canary transport events retain shared elapsed time without changing original business turn accounting',
  run() {
    const events = [{ type: 'run_start', ts: '2026-10-25T10:00:00.000Z' },
      { type: 'agent_invoke_start', phase: 'vision-canary', purpose: 'vision_canary', invoke_id: 'vision-canary-p1', ts: '2026-10-25T10:00:01.000Z' },
      { type: 'agent_invoke_end', phase: 'vision-canary', purpose: 'vision_canary', invoke_id: 'vision-canary-p1', ts: '2026-10-25T10:00:11.000Z' },
      { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1', ts: '2026-10-25T10:00:12.000Z' },
      { type: 'run_end', status: 'HALTED', ts: '2026-10-25T10:00:15.000Z' }];
    assert.equal(countAgentInvokeStarts(events), 1);
    const budget = resolveResumedBudget(events, { nextSessionStartMs: Date.parse('2026-10-25T10:10:00.000Z') });
    assert.equal(budget.totalTurns, 1); assert(budget.priorActiveMs >= 15000);
  },
}, {
  name: 'R9 native case-step coverage recognizes only the matching valid current object',
  run() {
    const { root } = makeVerifierProject();
    try {
      const feature = 'demo', runId = 'native-object-coverage', source = 'src/owner-input.ts';
      fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.writeFileSync(path.join(root, source), 'export const value = 1;\n');
      const ref = { trace_path: 'doc/features/demo/device-testing/trace.json', case_id: 'CASE-1', step_index: 1 };
      const candidate = { id: 'testing_failure_routing_CASE_1_1', category: 'coding', files: [source],
        summary: 'The original native assertion still fails', item_fingerprint: 'a'.repeat(64), source_phase: 'testing', evidence_refs: [ref] };
      const ownerChecks: CheckResult[] = [{ id: 'spec_file_exists', category: 'structure', description: 'owner current result',
        status: 'PASS', severity: 'BLOCKER', details: 'owner returned its work' }];
      const native: CheckResult = { id: candidate.id, category: 'structure', description: 'current native assertion', status: 'FAIL',
        severity: 'BLOCKER', failure_kind: 'assertion', failure_code: 'assertion_mismatch', coding_candidate: true,
        repair_owner: 'coding', affected_files: [source], details: candidate.summary, structured: { repair_evidence: ref } };
      const summaryOf = (phase: string, checks: CheckResult[]) => writeRunSummaryBase(root,
        generateScriptReport(path.join(FRAMEWORK_SOURCE_ROOT, 'harness'), phase, feature, root, checks, FRAMEWORK_SOURCE_ROOT), FRAMEWORK_SOURCE_ROOT);
      const ownerSummary = summaryOf('coding', ownerChecks), sourceSummary = { ...summaryOf('testing', [native]), repair_candidates: [candidate] };
      writeRunEvents(root, feature, runId, [{ type: 'run_start', chain: ['coding', 'testing'] },
        { type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'backtrack_to_phase' },
        { type: 'phase_backtrack_requested', phase: 'testing', from_phase: 'testing', to_phase: 'coding', candidates: [candidate] },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-current' },
        { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'coding-current', exit_code: 0 },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance' },
        { type: 'phase_verdict', phase: 'testing', verdict: 'PASS', action: 'advance', stale_summary: false }]);
      const variants: Array<{ name: string; checks: CheckResult[]; findingRefs?: typeof candidate.evidence_refs; covered: boolean }> = [
        { name: 'matching case and step', checks: [native], covered: true },
        { name: 'another step', checks: [{ ...native, structured: { repair_evidence: { ...ref, step_index: 2 } } }], covered: false },
        { name: 'another case', checks: [{ ...native, structured: { repair_evidence: { ...ref, case_id: 'CASE-2' } } }], covered: false },
        { name: 'missing corresponding check', checks: ownerChecks, covered: false },
        { name: 'another check id', checks: [{ ...native, id: 'other_native_assertion' }], covered: false },
        { name: 'negative step', checks: [{ ...native, structured: { repair_evidence: { ...ref, step_index: -1 } } }], covered: false },
        { name: 'unsafe trace reference', checks: [{ ...native, structured: { repair_evidence: { ...ref, trace_path: '../outside.json' } } }], covered: false },
        { name: 'malformed reference', checks: [{ ...native, structured: { repair_evidence: [ref] } }], covered: false },
        { name: 'no original finding reference', checks: [native], findingRefs: [], covered: false },
      ];
      for (const test of variants) {
        const summary = { ...sourceSummary, repair_candidates: [{ ...candidate, evidence_refs: test.findingRefs ?? candidate.evidence_refs }] };
        const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT,
          feature, runId, chain: ['coding', 'testing'], currentResults: [{ phase: 'coding', summary: ownerSummary, checks: ownerChecks },
            { phase: 'testing', summary, checks: test.checks }] }));
        const problem = disposition.completionBlocking.find(row => row.id === `open_finding:${candidate.id}`);
        assert(problem, test.name);
        assert.equal(problem.action, test.covered ? 'repair' : 'verify', test.name);
        assert.equal(problem.owner, test.covered ? 'coding' : 'testing', test.name);
        if (test.covered) assert(problem.evidence?.includes('case:CASE-1#step:1'), 'I10 must consume the original case/step identity');
        assert.equal(summary.verdict, 'FAIL', 'coverage must not rewrite the raw native failure');
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'current input keeps review findings assigned to coding instead of filtering by source phase',
  run() {
    const { root } = makeVerifierProject();
    try {
      const workflow = loadWorkflowSpec(FRAMEWORK_SOURCE_ROOT, 'obligation-driven');
      const candidate = { id: 'CR-007', category: 'coding', files: [], summary: 'Actual implementation defect', item_fingerprint: 'a'.repeat(64), source_phase: 'review' };
      const input = readCurrentDispositionInput({ projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, feature: 'demo', chain: ['coding', 'review'], workflow,
        currentResults: [{ phase: 'coding', summary: { verdict: 'PASS' }, checks: [] },
          { phase: 'review', summary: { verdict: 'FAIL', repair_candidates: [candidate] }, checks: [] }] });
      const finding = input.phases.find(phase => phase.phase === 'review')?.openFindings?.find(row => row.id === 'CR-007');
      assert(finding, 'cross-phase candidate must remain in the source facts');
      assert.equal(finding.owner, 'coding');
      assert.notEqual(finding.verificationRequired, true, '本轮完整新鲜FAIL结果不能因尚无closed manifest撤掉真实修复候选');
      const disposition = resolveCurrentDisposition(input);
      assert(disposition.completionBlocking.some(problem => problem.id === 'open_finding:CR-007' && problem.owner === 'coding' && problem.source_phase === 'review'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'unverified legacy finding requests original verification and never claims a design repair already closed it',
  run() {
    const result = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'plan', verdict: 'PASS', schemaCurrent: true,
      closureCommitted: true, openFindings: [{ id: 'reference_crosscheck', detail: 'Countdown and navigation contract conflict', owner: 'plan', verificationRequired: true }] }] });
    const problem = result.completionBlocking[0];
    assert(problem, 'unverified finding must remain completion-blocking');
    assert.equal(problem.action, 'verify'); assert.equal(problem.owner, 'plan'); assert.equal(problem.source_phase, 'plan');
    assert.equal(result.releaseBlocking.length, 0);
  },
}, {
  name: 'C6 late verification keeps independent unfinished review until both original judgments resolve',
  run() {
    const closed = { verdict: 'PASS' as const, schemaCurrent: true, closureCommitted: true };
    const input = (planPending: boolean, reviewPending: boolean) => ({ endpoint: 'feature-completion' as const, phases: [
      { ...closed, phase: 'plan', openFindings: planPending ? [{ id: 'late_plan_verification', detail: 'Original plan observation still needs verification', owner: 'plan', verificationRequired: true }] : [] },
      { ...closed, phase: 'review', openFindings: reviewPending ? [{ id: 'unfinished_review', detail: 'Independent current review is still unavailable', owner: 'review', verificationRequired: true }] : [] },
    ] });
    const both = resolveCurrentDisposition(input(true, true));
    for (const owner of ['plan', 'review']) assert(both.completionBlocking.some(problem => problem.owner === owner && problem.action === 'verify'));
    assert(!both.completionEligible && !both.completionBlocking.some(problem => problem.action === 'repair'), 'pure verification cannot create implementation work');
    const remaining = resolveCurrentDisposition(input(false, true));
    assert(!remaining.completionEligible && remaining.completionBlocking.some(problem => problem.owner === 'review'));
    assert(!remaining.completionBlocking.some(problem => problem.owner === 'plan'), 'resolving plan preserves the unrelated unfinished original review');
    assert(resolveCurrentDisposition(input(false, false)).completionEligible, 'both original judgments must actually resolve before completion');
  },
},  {
  name: 'historical finished call without phase halt retains its actual completion observation',
  run() {
    const file = path.join(__dirname, '../fixtures/host-recovery-history/20261023/20261023T044016Z-fe4512/project/doc/features/bc-openCard-2/bank-card-opening-flow/goal-runs/20261023T044016Z-fe4512/events.jsonl');
    const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert(!events.some(event => event.type === 'phase_halt'), 'preserved S0 really has no phase_halt');
    const ended = events.find(event => event.type === 'agent_invoke_end' && event.invoke_id === 'coding-i3');
    assert(ended && invocationCompleted({ ...ended, exitCode: ended.exit_code }), 'the actual historical call remains an observed completion');
  },
}, {
  name: 'stale inherited asset restores actual producer while soft visual debt stays disclosed',
  run() {
    const result = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'testing', verdict: 'PASS', schemaCurrent: true,
      closureCommitted: true, axes: {
        asset: { applicable: true, required_for_release: true, verdict: 'STALE', source_checks: ['stale_inheritance:coding:changed'],
          resolution: { class: 'needs_fix', owner: 'agent', retry_phase: 'coding' } },
        visual: { applicable: true, required_for_release: true, verdict: 'UNVERIFIED' },
      }, openDebt: 1 }] });
    assert(result.completionBlocking.some(problem => problem.owner === 'coding' && problem.action === 'repair'));
    assert(result.releaseBlocking.some(problem => problem.id === 'visual_debt_open'));
    const returned = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'testing', verdict: 'PASS', schemaCurrent: true,
      closureCommitted: true, axes: { asset: { applicable: true, required_for_release: true, verdict: 'STALE',
        source_checks: ['stale_inheritance:coding:changed'], verificationRequired: true,
        resolution: { class: 'needs_fix', owner: 'testing', retry_phase: 'testing' } } } }] });
    assert(returned.completionBlocking.some(problem => problem.owner === 'testing' && problem.action === 'verify'),
      '完成修改职责只交回原检查，旧发现仍阻断完成');
    assert(!returned.completionEligible);
  },
}, {
  name: 'recovery stays through modifier PASS refusal noop and unknown freshness then closes on original fresh verification',
  run() {
    const request = { type: 'phase_backtrack_requested', phase: 'review', to_phase: 'coding', reason: 'repair_candidates', candidates: [{ id: 'CR-007' }] };
    const unchanged = [request, { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', stale_summary: false },
      { type: 'phase_backtrack_completed', to_phase: 'coding', result: 'noop' },
      { type: 'phase_backtrack_completed', to_phase: 'coding', result: 'declined' },
      { type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'advance' }];
    assert(reduceRunState(unchanged).recovery);
    assert(!reduceRunState([...unchanged, { type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'advance', stale_summary: false,
      advance_blocked: false, agent_failed: false }]).recovery);
    assert(reduceRunState([...unchanged, { type: 'phase_verdict', phase: 'review', verdict: 'PASS', action: 'retry', stale_summary: false }]).recovery);
  },
}, {
  name: 'later halt replaces historical repair guidance without borrowing its changed paths',
  run() {
    const state = reduceRunState([{ type: 'phase_backtrack_requested', phase: 'review', to_phase: 'coding', reason: 'repair_candidates', files: ['src/a.ts'] },
      { type: 'phase_halt', phase: 'testing', halt_reason: 'device_not_ready' }]);
    assert.equal(state.recovery?.reason, 'device_not_ready');
    assert.equal(state.recovery?.current_phase, 'testing'); assert.equal(state.recovery?.owner_phase, undefined);
    assert.deepEqual(state.recovery?.changed_paths, []);
  },
}, {
  name: 'physical testing requirement enters existing device wait before invoking an author',
  async run() {
    const events: Record<string, unknown>[] = [];
    const result = await runDeviceReadinessGate({ phase: 'testing', retries: 0, sessionId: 'one',
      input: { configuredSerial: 'emulator', emulatorFallback: 'disabled', deps: { listTargets: () => ['emulator'], isLocked: () => false,
        wake() {}, knownEmulatorSerials: () => ['emulator'], attestPhysical: () => false } }, emitEvent: event => events.push(event) });
    assert.equal(result.outcome?.halt_reason, 'device_not_ready'); assert.equal(result.outcome?.probe, 'device_readiness');
    assert(events.some(event => event.type === 'phase_halt' && event.probe === 'device_readiness'));
    assert.equal(result.env, undefined);
  },
}, {
  name: 'session canary request and accepted original answer reach common grader without a headless binary',
  async run() {
    const { root } = makeVerifierProject();
    const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
    try {
      ensureRunControl(runDir, 'run');
      const acquired = casAcquireRunOwner(runDir, 'run', 0, { kind: 'session', owner_id: 'canary-owner', lease_ms: 60000 });
      assert(acquired.ok); if (!acquired.ok) return;
      const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
      const key = generateRandomCanaryAnswerKey();
      const manifest = { adapter: 'claude', feature: 'demo', run_id: 'run', report_dir: 'run', start_phase: 'spec' } as GoalManifest;
      let issued: ReturnType<typeof issueSessionExecution> | undefined;
      const execute = async (prompt: string) => {
        const received = issued && acceptedSessionReport(runDir, issued);
        if (received) return { exitCode: 0, stdout: received.report.details, stderr: '', command: 'phase_execute_request' } as AgentInvokeResult;
        emit({ type: 'agent_invoke_start', phase: 'vision-canary', invoke_id: 'vision-canary-i1', purpose: 'vision_canary' });
        issued = issueSessionExecution({ context: { runId: 'run', feature: 'demo', workflowId: 'spec-driven', track: 'full', chain: ['vision-canary'],
          phase: 'vision-canary', attemptId: 'vision-canary-i1', owner: { ...acquired.token, kind: 'session' }, projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT,
          runDir, reportDir: 'run', adapter: 'claude', instruction: prompt, runtimeFacts: { receiptRequired: false, resume: false, successor: false }, childEnv: {} },
          invokeId: 'vision-canary-i1', chainPhase: 'spec', purpose: 'vision_canary', timeoutMs: 60000, gateTimeoutMs: 60000,
          cleanupReserveMs: 1, preSnapshot: null, writeBoundary: null, emit });
        return { exitCode: 0, stdout: '', stderr: '', skipped: true, command: 'phase_execute_request' } as AgentInvokeResult;
      };
      const pending = await runVisionCanaryProbe({ projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, manifest, answerKeyFn: () => key,
        executePrompt: execute, retainMaterials: () => true });
      assert(issued && pending.outcome !== 'valid_cached');
      assert(fs.existsSync(path.join(runDir, 'preflight-canary.png')));
      const answer = [...key.geometry_questions.map(question => `${question.id}=${question.expected_color}`), `TEXT_TOKEN=${key.text_token}`].join('\n');
      acceptSessionExecution({ runDir, issued, report: { phase: 'vision-canary', status: 'passed', details: answer }, emit });
      const graded = await runVisionCanaryProbe({ projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, manifest, answerKeyFn: () => key, executePrompt: execute });
      assert.equal(graded.outcome, 'valid_cached'); assert.equal(graded.verdict, 'tool_read');
      assert.equal(loadLocalConfig(root)?.vision?.canary?.run_id, 'run');
      assert(!fs.existsSync(path.join(runDir, 'preflight-canary.png')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'session tool evidence belongs to accepted invocation and never signs stale shared logs',
  run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'current-session-audit-'));
    const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
    try {
      ensureRunControl(runDir, 'run');
      const acquired = casAcquireRunOwner(runDir, 'run', 0, { kind: 'session', owner_id: 'owner', lease_ms: 60000 });
      assert(acquired.ok); if (!acquired.ok) return;
      const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
      emit({ type: 'agent_invoke_start', phase: 'spec', invoke_id: 'spec-i1' });
      const issued = issueSessionExecution({ context: { runId: 'run', feature: 'demo', workflowId: 'spec-driven', track: 'full', chain: ['spec'],
        phase: 'spec', attemptId: 'i1', owner: { ...acquired.token, kind: 'session' }, projectRoot: root, frameworkRoot: FRAMEWORK_SOURCE_ROOT,
        runDir, reportDir: 'run', adapter: 'claude', runtimeFacts: { receiptRequired: true, resume: false, successor: false }, childEnv: {} },
        invokeId: 'spec-i1', timeoutMs: 60000, gateTimeoutMs: 60000, cleanupReserveMs: 1, preSnapshot: null, writeBoundary: null, emit });
      const file = path.join(runDir, path.dirname(issued.reference.path), 'agent-events.jsonl');
      const original = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.png"}}]}}\n';
      fs.writeFileSync(file, original);
      fs.utimesSync(file, new Date(), new Date(Date.now() + 100));
      acceptSessionExecution({ runDir, issued, report: { phase: 'spec', status: 'passed' }, emit });
      const frozen = sessionToolEventsLogPath(runDir, issued);
      assert(frozen && fs.readFileSync(frozen, 'utf8') === original);
      fs.writeFileSync(file, 'later logs must not affect accepted facts');
      assert.equal(sessionToolEventsLogPath(runDir, issued), frozen);
      fs.writeFileSync(frozen!, 'tampered');
      assert.equal(sessionToolEventsLogPath(runDir, issued), null);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}];

export function getCases() { return cases; }
export async function runAll() {
  const selected = cases;
  const results: UnitCaseResult[] = [];
  for (const test of selected) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally {  endUnitCase(); }
  }
  return results;
}
