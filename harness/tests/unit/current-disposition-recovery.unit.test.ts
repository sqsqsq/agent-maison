import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { resolveCurrentDisposition, phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { readCurrentDispositionInput, collectCleanPassIssues, collectPhaseCompletionIssues } from '../../scripts/utils/verify-feature-completion';
import { reduceRunState } from '../../scripts/utils/run-state-reducer';
import { runDeviceReadinessGate } from '../../scripts/utils/device-readiness-gate';
import { ensureRunControl, casAcquireRunOwner } from '../../scripts/utils/goal-run-control';
import { issueSessionExecution, writePhaseExecutionRequestMaterial, acceptSessionExecution, acceptedSessionReport, sessionToolEventsLogPath } from '../../scripts/utils/session-execution-handoff';
import { runVisionCanaryProbe } from '../../scripts/utils/goal-preflight';
import { generateRandomCanaryAnswerKey } from '../../scripts/utils/vision-canary';
import { loadLocalConfig } from '../../scripts/utils/framework-local-config';
import { countAgentInvokeStarts, resolveResumedBudget } from '../../scripts/utils/goal-runner-phase';
import { resolvePhaseHarnessVerdict } from '../../scripts/utils/goal-runner-phase';
import { resolveFrameworkOwnerRevisionGuard, buildVerificationNoProgressGuidance } from '../../scripts/goal-phase-runtime';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import type { AgentInvokeResult } from '../../scripts/utils/agent-invoke';
import { loadWorkflowSpec } from '../../workflow-loader';
import { clearFrameworkConfigCache } from '../../config';
import { makeVerifierProject, FRAMEWORK_SOURCE_ROOT } from '../utils/verifier-project-fixture';
import { fixture as requestFixture } from './request-entry.unit.test';
import { prepareExplicitRequest } from '../../scripts/utils/capability-resolution-entry-input';
import { runGoalRuntimeChain, setupGoalRuntimeHost } from './goal-runner-testing-integrity.unit.test';
import { readRunControl } from '../../scripts/utils/goal-run-control';
import type { WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { setupRunlessProject } from './execution-scope.unit.test';
import { ensureFeatureExecutionScopeFrozen, readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { readPhaseRepairIssues, phaseIssuesForVerifierSubject, itemFingerprintOf } from '../../scripts/utils/repair-candidates';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { featurePhaseReportsDir } from '../../config';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { writeRunEvents, seedCleanCompletionChain } from '../utils/completion-chain-seed';
import { resolveCurrentScopeView } from '../../scripts/utils/feature-track';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { visualDebtJsonPath } from '../../scripts/utils/visual-debt';
import { writeRunSummaryBase } from '../../harness-runner';
import { buildNextLine } from '../../harness-runner';
import { repairResponsibilityContext, resolveRepairResponsibility } from '../../scripts/utils/repair-responsibility';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import type { CheckResult } from '../../scripts/utils/types';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import { selectRunnerActionFromAssess, type SelectRunnerActionInput } from '../../scripts/utils/goal-assess-driver';
import type { UnitCaseResult } from '../run-unit';

/** 可把 executeAuthor 换成真实 CLI；输入仍是正常 runtime 实际物化的 prompt。 */
export async function prepareSamePhaseRequiredWorkCase(executeAuthor?: (ctx: Parameters<NonNullable<NonNullable<Parameters<typeof runGoalRuntimeChain>[1]>['onSpec']>>[0]) => void) {
  const YAML = await import('yaml');
  const { provisionRealChainProject, scaffoldRealChainHost, REAL_CHAIN_REQUIREMENT } = await import('../utils/real-chain-host');
  const { writeSpecMaterials, writePlanMaterials } = await import('./real-chain.unit.test');
  const { parseVerifierRequest } = await import('../../scripts/utils/verifier-request');
  const { readVerifierSemanticIssues } = await import('../../scripts/utils/repair-candidates');
  const project = provisionRealChainProject();
  scaffoldRealChainHost(project);
  // 单职责兼容入口；1.2/S2范围与下游恢复另由原生组合用例覆盖。
  const configPath = path.join(project.root, 'framework.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.active_workflow = 'spec-driven';
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.rmSync(path.join(project.root, 'doc/features', project.feature, 'feature.yaml'), { force: true });
  const required = '银行列表按银行名称升序排列';
  const requirement = `${REAL_CHAIN_REQUIREMENT}\n${required}`;
  const featureRoot = `doc/features/${project.feature}`;
  const target = `${featureRoot}/spec/spec.md`, acceptance = `${featureRoot}/acceptance.yaml`;
  fs.appendFileSync(path.join(project.root, featureRoot, 'requirements/requirement.md'), `\n${required}\n`);
  writeSpecMaterials(project); writePlanMaterials(project);
  const requireOrdering = (): void => {
    const doc = YAML.parse(fs.readFileSync(path.join(project.root, acceptance), 'utf8'));
    doc.criteria.find((criterion: { id: string }) => criterion.id === 'AC-2').expected_result += `；${required}`;
    fs.writeFileSync(path.join(project.root, acceptance), YAML.stringify(doc));
  };
  fs.unlinkSync(path.join(project.root, acceptance));
  const observations = { authorPrompts: [] as string[], verifierRequests: [] as string[], rawRequiredPass: false, closureBlocked: false };
  const options: Parameters<typeof runGoalRuntimeChain>[1] = { frameworkRoot: project.frameworkRoot, featureId: project.feature,
    realHarness: true, viaRuntimeClass: true, adapter: 'codex', freshEndPhase: 'spec', freshRequirement: requirement,
    onSpec: ctx => {
      project.runId = ctx.runId;
      if (ctx.attempt === 1) {
        writeSpecMaterials(project);
        requireOrdering();
        return;
      }
      observations.authorPrompts.push(ctx.prompt);
      if (executeAuthor) return executeAuthor(ctx);
      // 替身只消费收到的任务和原验收；缺送达就不会猜目标或替框架补实现。
      if (!ctx.prompt.includes('required_bank_order') || !ctx.prompt.includes(target)) return;
      const doc = YAML.parse(fs.readFileSync(path.join(project.root, acceptance), 'utf8'));
      const expected = doc.criteria.find((criterion: { id: string }) => criterion.id === 'AC-2').expected_result;
      fs.appendFileSync(path.join(project.root, target), `\n${expected}\n`);
    },
    onOutOfChain: ctx => {
      const request = parseVerifierRequest(ctx.prompt.slice(ctx.prompt.lastIndexOf('\n{') + 1));
      assert(request && request.feature === project.feature && request.phase === 'spec', 'original verifier consumes the actual current request');
      observations.verifierRequests.push(request!.subject_id);
      const summaryPath = path.join(featurePhaseReportsDir(project.root, project.feature, 'spec', project.frameworkRoot), 'summary.json');
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      assert.equal(summary.verifier_subject_id, request!.subject_id);
      fs.readFileSync(path.resolve(project.root, request!.prompt_path), 'utf8');
      const doc = YAML.parse(fs.readFileSync(path.join(project.root, acceptance), 'utf8'));
      const expected = doc.criteria.find((criterion: { id: string }) => criterion.id === 'AC-2').expected_result;
      const spec = fs.readFileSync(path.join(project.root, target), 'utf8');
      const missing = !spec.includes(expected);
      const text = '```yaml\n' + YAML.stringify({ verification_result: { phase: 'spec', feature: project.feature,
        checks: missing ? [{ id: 'required_bank_order', status: 'FAIL', severity: 'MAJOR', acceptance_ids: ['AC-2'], affected_files: [target],
          details: `\`${acceptance}:1\`；\`${target}:1\`：AC-2 的明确预期尚未完整写入本职责spec`, suggestion: `在spec明确记录当前AC-2预期：${expected}` }] : [],
        summary: { verdict: 'PASS', blocker_count: 0 } } }) + '```\n';
      const issues = readVerifierSemanticIssues(project.root, project.feature, 'spec', text, '(current independent verification)', project.frameworkRoot, ctx.runId);
      assert(!missing || issues?.rows.length, JSON.stringify({ issues, acceptance: doc }));
      const verification = missing ? `\`\`\`issue-verification\n- issue: required_bank_order\n  verdict: confirmed\n  repair_owner: spec\n  evidence: ${target} | ${issues!.rows[0].summary}\n\`\`\`\n` : '';
      publishFixtureVerifierEvidence({ projectRoot: project.root, reportsDir: path.dirname(summaryPath), feature: project.feature,
        phase: 'spec', subjectId: request!.subject_id, reportText: text + verification, skipSummaryPatch: true });
      if (missing) {
        const rawReport = JSON.parse(fs.readFileSync(path.join(path.dirname(summaryPath), 'script-report.json'), 'utf8'));
        observations.rawRequiredPass = rawReport.summary.verdict === 'PASS';
        assert.throws(() => finalizePhaseClosure({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
          feature: project.feature, phase: 'spec', goalRunId: ctx.runId, persistPhaseState: () => undefined }), /required_bank_order/);
        observations.closureBlocked = true;
      }
    },
  };
  return { project, target, acceptance, requirement, options, observations };
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
  name: 'c6 verifier model consumes the complete current request with process or session transport and rejects an undelivered or wrong request',
  async run() {
    const { buildVerifierRequest, renderVerifierRequest, verifierRequestFilename } = await import('../../scripts/utils/verifier-request');
    const { publishRequestedVerifier } = await import('./real-chain.unit.test');
    const { root } = makeVerifierProject();
    try {
      const promptPath = 'doc/features/demo/plan/reports/ai-prompt.md';
      const dir = path.join(root, path.dirname(promptPath)); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(root, promptPath), 'Read the current isolated acceptance evidence.');
      const request = buildVerifierRequest({ feature: 'demo', phase: 'plan', prompt_path: promptPath,
        prompt_sha256: '1'.repeat(64), material_sha256: '2'.repeat(64), gate_fingerprint: null, source_commit_sha: null, worktree_digest: null });
      const text = renderVerifierRequest(request);
      fs.writeFileSync(path.join(dir, verifierRequestFilename(request.subject_id)), text);
      fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ verifier_subject_id: request.subject_id,
        verifier_request: path.posix.join(path.posix.dirname(promptPath), verifierRequestFilename(request.subject_id)) }));
      const project = { root, frameworkRoot: FRAMEWORK_SOURCE_ROOT, harnessDir: path.join(FRAMEWORK_SOURCE_ROOT, 'harness'), feature: 'demo', module: 'app', modulePath: 'app' };
      const ctx = { phase: 'plan-verifier-format-repair', runId: 'transport-check' };
      assert(publishRequestedVerifier(project, { ...ctx, prompt: `Verify the current request:\n${text.trimEnd()}` }));
      assert(publishRequestedVerifier(project, { ...ctx, prompt: `Verify the current request:\r\n${text.replace(/\n/g, '\r\n')}\r\n执行本次命令时同时传递 context.childEnv 中的冻结标识。` }));
      assert.throws(() => publishRequestedVerifier(project, { ...ctx, prompt: 'The request exists on disk; use it without receiving its contents.' }), /actually be delivered/);
      const wrong = renderVerifierRequest(buildVerifierRequest({ ...request, material_sha256: '3'.repeat(64) }));
      assert.throws(() => publishRequestedVerifier(project, { ...ctx, prompt: wrong }), /actually be delivered/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
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
}, {
  name: 'c6 real spec gate delivers a same-phase mandatory MAJOR beneath raw PASS and closes only after original verification',
  async run() {
    const fixture = await prepareSamePhaseRequiredWorkCase();
    try {
      const result = await runGoalRuntimeChain(fixture.project.root, fixture.options);
      const reportsDir = featurePhaseReportsDir(fixture.project.root, fixture.project.feature, 'spec', fixture.project.frameworkRoot);
      const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8'));
      assert(fixture.observations.rawRequiredPass && fixture.observations.closureBlocked);
      assert.equal(fixture.observations.authorPrompts.length, 1, JSON.stringify({ phases: result.invokedPhases, summary }));
      assert(fixture.observations.authorPrompts[0].includes('required_bank_order') && fixture.observations.authorPrompts[0].includes(fixture.target));
      assert(fixture.observations.verifierRequests.length >= 2, 'original verifier must judge the changed owned artifact');
      assert.equal(summary.verdict, 'PASS'); assert.equal(summary.closure_status, 'closed');
      assert.equal(summary.repair_candidates?.length ?? 0, 0);
      assert.equal(result.exitCode, 2, 'legacy Goal honestly reports PARTIAL for a spec-only slice; the authorized stage itself must be closed');
      assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'spec' && event.verdict === 'PASS' && event.action === 'advance'));
      assert(!result.invokedPhases.some(phase => ['coding', 'review', 'ut', 'testing'].includes(phase)), 'the authorized spec endpoint does not expand scope');
    } finally { fs.rmSync(fixture.project.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
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
      const pending = buildNextLine({ verdict: 'FAIL', next_action: 'fix_verifier_findings_then_rerun_harness', repair_candidates: [coding] },
        'review', f.feature, { responsibility, currentDisposition: verification });
      assert(pending.includes('当前待核任务') && pending.includes('责任=review') && pending.includes('原始 FAIL 结论保留'), pending);
      assert(!pending.includes('当前本职责必修任务') && !pending.includes('harness-runner.ts --phase review'), pending);

      const spec = { id: 'SPEC-NEXT', category: 'spec' as const, files: [`doc/features/${f.feature}/spec.md`],
        summary: 'acceptance.yaml:8 AC-1 requires its approved behavior', item_fingerprint: 's'.repeat(64), source_phase: 'spec' };
      const owner = resolveRepairResponsibility({ ...responsibility, target: spec }).owner;
      assert.equal(owner, 'spec');
      const blockers = [{ id: 'product_gate', suggestion: 'fix the executed assertion' }, { id: 'receipt_gate', details_excerpt: 'repair the current receipt input' }];
      for (const outerGoalRerun of [false, true]) for (const closure_status of ['open', 'closed']) {
        for (const repair_candidates of [[spec], [spec, coding]]) {
          const disposition = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'spec', verdict: 'FAIL',
            schemaCurrent: true, closureCommitted: closure_status === 'closed',
            failingChecks: blockers.map(blocker => ({ id: blocker.id, status: 'FAIL', severity: 'BLOCKER' })),
            openFindings: repair_candidates.map(candidate => ({ id: candidate.id, detail: candidate.summary,
              owner: resolveRepairResponsibility({ ...responsibility, target: candidate }).owner ?? undefined, source_phase: candidate.source_phase })) }] });
          const line = buildNextLine({ verdict: 'FAIL', closure_status, next_action: 'fix_verifier_findings_then_rerun_harness', blockers, repair_candidates },
            'spec', f.feature, { outerGoalRerun, responsibility, currentDisposition: disposition });
          assert(line.includes('当前本职责必修任务') && line.includes('责任=spec') && line.includes(spec.id), line);
          for (const blocker of blockers) assert(line.includes(blocker.id), line);
          assert.equal(line.includes('他职责交接任务'), repair_candidates.length === 2, line);
          assert(line.includes(outerGoalRerun ? 'goal runtime 正式 gate' : 'harness-runner.ts --phase spec'), line);
          assert(!line.includes('停下等待用户指令'), line);
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
    assert(line.includes('当前本职责必修任务') && line.includes('责任=review') && line.includes(candidate.id), line);
    assert(line.includes('harness-runner.ts --phase review --feature demo') && !line.includes('他职责交接任务') && !line.includes('待既有责任链确定'), line);
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
}, {
  name: 'a real debt writer failure waits for framework verification before closure without rewriting raw PASS or retrying the author',
  async run() {
    const { root } = setupGoalRuntimeHost('codex');
    let debtPath = '';
    try {
      const probe = await runGoalRuntimeChain(root, { frameworkRoot: FRAMEWORK_SOURCE_ROOT, freshEndPhase: 'spec', adapter: 'codex', viaRuntimeClass: true,
        onHarnessSummary: ({ phase }) => {
          if (phase !== 'spec') return null;
          // Inject the framework writer failure at its own seam, not as an author ledger write.
          debtPath = visualDebtJsonPath(root, 'bc-openCard');
          fs.mkdirSync(path.dirname(debtPath), { recursive: true }); fs.writeFileSync(debtPath, '{broken debt');
          return { checks: [{ id: 'spec_file_exists', category: 'structure', description: 'actual successful check', status: 'PASS' as const, severity: 'BLOCKER' as const, details: 'spec exists' }] };
        },
      });
      const summary = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, 'bc-openCard', 'spec'), 'summary.json'), 'utf8'));
      assert.equal(summary.verdict, 'PASS'); assert.equal(summary.completion_status, 'DEBT_PIPELINE_ERROR');
      assert.equal(fs.readFileSync(debtPath, 'utf8'), '{broken debt', 'the failing ledger stays available for diagnosis');
      assert.deepEqual(probe.invokedPhases, ['spec']);
      assert(!probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'closure_finalization_failed'));
      assert(!probe.events.some(event => event.type === 'phase_backtrack_requested'));
      const raw = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'spec');
      assert.equal(raw?.verdict, 'PASS');
      assert(probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting'
        && event.run_wait_kind === 'external' && String(event.halt_guidance).includes('责任方=framework')));
      assert.notEqual(probe.exitCode, 0, 'framework verification cannot produce clean completion');
      const mixed = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: 'testing', verdict: 'FAIL',
        schemaCurrent: true, closureCommitted: true, completionStatus: 'DEBT_PIPELINE_ERROR', failingChecks: [
          { id: 'actual_product_failure', status: 'FAIL', severity: 'BLOCKER', repair_owner: 'coding' }] }] });
      assert(mixed.completionBlocking.some(problem => problem.id === 'actual_product_failure' && problem.action === 'repair' && problem.owner === 'coding'));
      assert(mixed.completionBlocking.some(problem => problem.id === 'debt_pipeline_healthy' && problem.action === 'verify' && problem.owner === 'framework'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
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
  name: 'a current closure retry preserves an authorized earlier repair owner while process and authority stops still win',
  run() {
    const input = { assessment: { recommendation: { action: 'rerun_phase', phase: 'coding', runner_action: 'backtrack_to_phase' }, stop: { fused: false } },
      observation: { phase_outcome: { phase: 'testing', verdict: 'PASS' }, invalidatable_phases: ['coding', 'testing'], signals: {} },
      currentPhase: 'testing', chain: ['coding', 'testing'], driverGuardAction: 'retry' } as SelectRunnerActionInput;
    assert.equal(selectRunnerActionFromAssess(input), 'backtrack_to_phase', 'closure retry must not erase the actual repair owner');
    assert.equal(selectRunnerActionFromAssess({ ...input, driverGuardAction: 'halt' }), 'halt');
    assert.equal(selectRunnerActionFromAssess({ ...input, observation: { ...input.observation,
      signals: { timed_out: true, operator_interrupted: false, api_disconnected: false } } }), 'retry');
    assert.equal(selectRunnerActionFromAssess({ ...input, observation: { ...input.observation, invalidatable_phases: [] } }), 'retry');
  },
}, {
  name: 'framework closure gaps yield only to a verified owner pending revision while missing authority and process guards retain retry',
  run() {
    const f = setupRunlessProject();
    try {
      assert.equal(ensureFeatureExecutionScopeFrozen({ ...f, projectRoot: f.root }).status, 'frozen');
      const pendingScopeRevision = readFeatureFrozenScope(f.root, f.feature)!.execution_scope;
      const raw = resolvePhaseHarnessVerdict({ dryRun: false, agentExitCode: 0, agentSkipped: false, harnessExitCode: 0,
        summaryBeforeMtime: 1, summaryAfterMtime: 2, summaryVerdict: 'PASS', receiptRequired: true,
        closureStatus: 'open', receiptStatus: 'missing' });
      assert.equal(raw.verdict, 'PASS'); assert(raw.advance_blocked);
      const boundary = { assessment: { recommendation: { action: 'revise_scope', phase: null }, stop: { fused: false } },
        observation: { phase_outcome: { phase: 'review', verdict: raw.verdict }, invalidatable_phases: ['coding', 'review'], signals: {} },
        currentPhase: 'review', chain: ['coding', 'review'], driverGuardAction: 'retry' } as SelectRunnerActionInput;
      assert.equal(selectRunnerActionFromAssess(boundary), 'retry', 'counterexample: an ordinary closure retry hides the pending owner revision');
      const input = { guard: 'retry' as const, rawVerdict: raw.verdict, advanceBlocked: raw.advance_blocked,
        frameworkVerificationGap: true, executableOwnerRecovery: true, pendingScopeRevision, recommendationAction: 'revise_scope' as const };
      const selected = (patch: Partial<Parameters<typeof resolveFrameworkOwnerRevisionGuard>[0]>) => selectRunnerActionFromAssess({
        ...boundary, driverGuardAction: resolveFrameworkOwnerRevisionGuard({ ...input, ...patch }) });
      assert.equal(selected({}), 'advance', 'apply the approved revision before dispatching its actual owner; this does not sign completion');
      for (const patch of [{ executableOwnerRecovery: false }, { pendingScopeRevision: undefined }, { frameworkVerificationGap: false },
        { recommendationAction: 'rerun_phase' as const }, { rawVerdict: 'FAIL' }, { advanceBlocked: false },
        { closureFinalizationError: 'transaction failed' }, { timedOut: true }, { apiDisconnected: true }]) {
        assert.equal(selected(patch), 'retry', JSON.stringify(patch));
      }
      assert.equal(selected({ guard: 'halt' }), 'halt');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
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
}, {
  name: 'shared invocation material is persisted by the real detached runtime before its executor consumes the original prompt',
  async run() {
    const { root } = setupGoalRuntimeHost('codex');
    let observed = false;
    try {
      const probe = await runGoalRuntimeChain(root, { freshEndPhase: 'spec', adapter: 'codex', viaRuntimeClass: true, onSpec: ctx => {
        const directory = path.dirname(ctx.outputLogPath);
        const file = fs.readdirSync(directory).find(name => /^request-e\d+\.json$/.test(name));
        assert(file, 'detached runtime must persist its common request before executing');
        const material = JSON.parse(fs.readFileSync(path.join(directory, file!), 'utf8'));
        assert.equal(material.type, 'phase_execute_request'); assert.equal(material.context.owner.kind, 'process');
        assert.equal(material.context.instruction, fs.readFileSync(path.join(material.context.runDir, 'phases', material.context.phase, 'prompt.md'), 'utf8'));
        assert(ctx.prompt.includes(material.context.instruction), 'CLI运输必须消费同一完整instruction');
        assert.equal(material.context.attemptId, ctx.goalAttemptId);
        assert.equal(material.invoke_id, `spec-${ctx.goalAttemptId}`);
        const eventsFile = path.join(directory, '../../../events.jsonl');
        const events = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const start = events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === material.invoke_id);
        assert.equal(material.issued_at, start.ts);
        assert.equal(material.deadline, material.context.user_deadline_at, 'only an explicit user deadline limits the author');
        assert(Number.isFinite(material.gate_timeout_ms) && material.gate_timeout_ms > 0, 'the concrete formal tool timeout must remain bounded');
        assert(!events.some(event => event.driver === 'session' || event.handoff_request));
        observed = true;
      } });
      assert(observed, JSON.stringify(probe.events.filter(event => event.type === 'run_end'))); assert.equal(probe.exitCode, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'terminal candidate collector delivers the retained source candidate files and evidence through the real event and author prompt',
  async run() {
    const { root } = setupGoalRuntimeHost('codex');
    const reader = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
    const original = reader.resolveCompletionDisposition;
    const target = 'doc/features/bc-openCard/spec/spec.md';
    const evidence = 'doc/features/bc-openCard/plan/reports/confirmed-target.json';
    const sourceSummary = path.join(featurePhaseReportsDir(root, 'bc-openCard', 'plan'), 'summary.json');
    const summary = `confirmed spec obligation is missing its observed requirement; evidence=${evidence}`;
    const candidate = { id: 'SPEC-TERMINAL', category: 'spec' as const, files: [target], summary,
      item_fingerprint: itemFingerprintOf('SPEC-TERMINAL', [target], summary), source_phase: 'plan' };
    let supplied = false, repaired = false, authorCalls = 0, prompt = '';
    try {
      // Only the retained independent conclusion is substituted. Runtime collection, event
      // serialization, owner resolution and prompt construction remain production.
      reader.resolveCompletionDisposition = opts => {
        const result = original(opts);
        if (opts.projectRoot !== root || supplied || opts.currentResults || opts.authorityReaders || !opts.workflow || !opts.runId) return result;
        const events = path.join(root, 'doc/features/bc-openCard/goal-runs', opts.runId, 'events.jsonl');
        const history = fs.existsSync(events) ? fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
        const latest = [...history].reverse().find(event => event.phase === 'spec' && ['phase_start', 'phase_verdict'].includes(event.type));
        if (latest?.type !== 'phase_verdict' || latest.verdict !== 'PASS' || latest.action !== 'advance') return result;
        supplied = true;
        fs.mkdirSync(path.dirname(sourceSummary), { recursive: true });
        fs.writeFileSync(sourceSummary, JSON.stringify({ verdict: 'PASS', repair_candidates: [candidate] }));
        fs.writeFileSync(path.join(root, evidence), JSON.stringify({ target, observed: fs.readFileSync(path.join(root, target), 'utf8'), required: 'verified terminal requirement' }));
        const problem = { phase: 'plan', source_phase: 'plan', owner: 'spec', id: `open_finding:${candidate.id}`,
          action: 'repair' as const, affects: 'completion' as const, severity: 'BLOCKER' as const, detail: candidate.summary };
        return { ...result, problems: [...result.problems, problem], completionBlocking: [...result.completionBlocking, problem], completionEligible: false };
      };
      const probe = await runGoalRuntimeChain(root, { frameworkRoot: FRAMEWORK_SOURCE_ROOT, freshEndPhase: 'spec', adapter: 'codex', viaRuntimeClass: true,
        onSpec: ctx => {
          authorCalls++;
          if (!supplied) return;
          prompt = ctx.prompt;
          assert(prompt.includes('Verified repair candidates for this phase') && prompt.includes(candidate.id), 'production terminal collector must inject its candidate into the actual owner prompt');
          assert(prompt.includes(target) && prompt.includes(evidence) && prompt.includes(candidate.item_fingerprint));
          const finding = JSON.parse(fs.readFileSync(path.join(root, evidence), 'utf8'));
          assert.equal(finding.target, target); assert.equal(fs.readFileSync(path.join(root, target), 'utf8'), finding.observed);
          fs.appendFileSync(path.join(root, target), `\n${finding.required}\n`);
          repaired = fs.readFileSync(path.join(root, target), 'utf8').includes(finding.required);
          fs.writeFileSync(sourceSummary, JSON.stringify({ verdict: 'PASS', repair_candidates: [] }));
        },
      });
      assert(supplied && repaired && authorCalls === 2, JSON.stringify({ supplied, repaired, authorCalls }));
      const request = probe.events.find(event => event.type === 'phase_backtrack_requested' && event.from_phase === 'plan' && event.to_phase === 'spec');
      assert.deepEqual(request?.candidates, [candidate], 'the production backtrack event must retain the original candidate identity, target and basis');
      assert(prompt.includes(candidate.summary));
      assert(!probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'backtrack_target_absent'));
    } finally { reader.resolveCompletionDisposition = original; fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  },
}, {
  name: 'terminal verification recovery stops unchanged inputs despite fresh closure outputs and accepts a real input change',
  async run() {
    const reader = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
    const original = reader.resolveCompletionDisposition;
    for (const changedInput of [false, true]) {
      const { root } = setupGoalRuntimeHost('codex');
      const source = path.join(root, 'src/recovery-input.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, 'export const value = 1;\n');
      let gates = 0;
      try {
        reader.resolveCompletionDisposition = opts => {
          const result = original(opts);
          const summaryPath = path.join(featurePhaseReportsDir(root, 'bc-openCard', 'spec'), 'summary.json');
          const closed = fs.existsSync(summaryPath) && JSON.parse(fs.readFileSync(summaryPath, 'utf8')).closure_status === 'closed';
          const runDir = opts.runId && path.join(root, 'doc/features/bc-openCard/goal-runs', opts.runId);
          const eventsFile = runDir && path.join(runDir, 'events.jsonl');
          const history = eventsFile && fs.existsSync(eventsFile)
            ? fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
          const lastPhase = history.reverse().find(event => event.phase === 'spec' && ['phase_start', 'phase_verdict'].includes(event.type));
          if (opts.projectRoot !== root || opts.currentResults || !closed || lastPhase?.type !== 'phase_verdict'
            || lastPhase?.verdict !== 'PASS' || changedInput && gates >= 3) return result;
          // A retained verifier conclusion is the scheduler input; the real gate and closure writer
          // below still generate reports/manifests, including the file the PASS check executed.
          const problem = { phase: 'spec', id: 'lineage_fresh', action: 'verify' as const, affects: 'completion' as const,
            severity: 'BLOCKER' as const, owner: 'spec', detail: 'retained verification needs the current responsibility input' };
          return { ...result, problems: [...result.problems, problem], completionBlocking: [...result.completionBlocking, problem], completionEligible: false };
        };
        const probe = await runGoalRuntimeChain(root, { frameworkRoot: FRAMEWORK_SOURCE_ROOT, freshEndPhase: 'spec', adapter: 'codex', viaRuntimeClass: true,
          onHarnessSummary: ({ phase }) => {
            if (phase !== 'spec') return null;
            gates++;
            assert(gates <= 4, 'unchanged verification input must not create another gate-only recovery round');
            if (changedInput && gates === 2) fs.writeFileSync(source, 'export const value = 2;\n');
            return { checks: [{ id: 'spec_file_exists', category: 'structure', description: 'executed responsibility input',
              status: 'PASS', severity: 'BLOCKER', details: 'current gate executed src/recovery-input.ts', affected_files: ['src/recovery-input.ts'] }] };
          },
        });
        const repairs = probe.events.filter(event => event.type === 'phase_backtrack_requested');
        assert.equal(probe.invokedPhases.filter(phase => phase === 'spec').length, 1, 'verification does not rewrite the phase product');
        if (changedInput) {
          assert.equal(repairs.length, 2, 'a changed executed input permits a new recovery opportunity');
          assert.equal(gates, 3); assert.equal(probe.exitCode, 0);
        } else {
          assert.equal(repairs.length, 1, 'unchanged inputs must reach the existing repeat-recovery exit after one backtrack');
          assert.equal(gates, 2, 'closure output resigning is not new recovery progress');
          assert(probe.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'backtrack_fingerprint_repeat'));
        }
      } finally {
        reader.resolveCompletionDisposition = original;
        fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache();
      }
    }
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
export async function runSelectedCases(filter?: string) {
  const selected = cases.filter(test => matchesUnitCase(test.name, filter));
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const test of selected) {
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
