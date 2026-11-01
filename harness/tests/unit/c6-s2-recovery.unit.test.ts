import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featurePhaseReportsDir, loadFrameworkConfig } from '../../config';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { copyC6HostReplay } from '../utils/c6-host-replay';
import { provisionFrameworkUnder, git } from '../utils/real-chain-host';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { computePromptSha256 } from '../../scripts/utils/verifier-request';
import { evidenceEntryMatchesCurrentFile, loadPhaseEvidenceManifest, IDENTITY_NEUTRAL_EVIDENCE } from '../../scripts/utils/phase-evidence-manifest';
import { countAgentInvokeStarts, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';
import { startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';

const CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
const hash = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(root: string, rel: string, text: string): void {
  const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
}

/** The substitute sees only the delivered current request/material and may write its requested reply. */
export function verifyDeliveredCurrentEvidence(root: string, prompt: string, feature: string, writeReply = true): { subject: string; files: string[]; reply: string } {
  root = path.resolve(root);
  const match = /(\{\s*"schema_version"\s*:\s*"1\.1"[\s\S]*\})\s*$/.exec(prompt);
  assert(match, 'Production recovery must deliver its complete current request JSON');
  const request = JSON.parse(match[1]);
  assert.equal(request.kind, 'maison_verifier_request');
  assert.equal(request.feature, feature);
  const promptFile = path.resolve(root, request.prompt_path);
  assert(promptFile.startsWith(root + path.sep));
  const promptText = fs.readFileSync(promptFile, 'utf8');
  assert.equal(computePromptSha256(promptText), request.prompt_sha256, 'Delivered prompt audit SHA (production EOL contract)');
  const reports = path.dirname(promptFile);
  const material = json(path.join(reports, `verifier.material.${request.subject_id}.json`));
  assert.equal(material.material_sha256, request.material_sha256, 'Delivered material identity');
  if (process.env.C6_REPLAY_REPORT_OUT) {
    const output = path.join(path.dirname(process.env.C6_REPLAY_REPORT_OUT), 's2-delivered');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'recovery-prompt.md'), prompt);
    fs.writeFileSync(path.join(output, 'verifier-request.json'), match[1]);
    fs.copyFileSync(promptFile, path.join(output, 'ai-prompt.md'));
    fs.writeFileSync(path.join(output, 'verifier-material.json'), JSON.stringify(material, null, 2) + '\n');
  }
  const files = new Map<string, string>();
  const phaseManifest = loadPhaseEvidenceManifest(root, feature, request.phase)?.manifest;
  const boundEntries = phaseManifest ? [...phaseManifest.inputs, ...phaseManifest.outputs] : [];
  for (const row of material.files as Array<{ path: string; sha256: string | null }>) {
    if (!row.sha256) continue;
    const file = path.resolve(root, row.path);
    assert(file.startsWith(root + path.sep), row.path);
    const bound = boundEntries.find(entry => entry.path === row.path && entry.sha256 === row.sha256);
    assert(hash(file) === row.sha256 || !!bound && evidenceEntryMatchesCurrentFile(root, bound, feature)
      || evidenceEntryMatchesCurrentFile(root, { ...row, role: 'input', exists: true, identity_neutral: IDENTITY_NEUTRAL_EVIDENCE }, feature),
      `Delivered material binding (raw or existing semantic evidence contract): ${row.path}`);
    files.set(row.path, fs.readFileSync(file, 'utf8'));
  }
  const only = (suffix: string): [string, string] => {
    const matches = [...files.entries()].filter(([file]) => file.endsWith(suffix));
    assert.equal(matches.length, 1, `Necessary evidence must be actually delivered: ${suffix}`);
    return matches[0];
  };
  const [acceptancePath, acceptanceText] = only('/acceptance.yaml');
  const acceptance = YAML.parse(acceptanceText);
  assert.equal(acceptance.criteria.find((item: { id: string }) => item.id === 'AC-3').ut_layer, 'both');
  const [utPath, utText] = only('/bank_open_card_ut.test.ets');
  const [otpPath, otp] = only('/OtpService.ets');
  const [servicePath, service] = only('/BankCardOpeningService.ets');
  const [uiPath, ui] = only('/OtpVerificationSheet.ets');
  const [resultPath, resultText] = only('/frozen.ut-result.WalletMain.json');
  const result = JSON.parse(resultText);
  assert.deepEqual(result.testResult, { total: 26, passed: 26, failed: 0, skipped: 0, failures: [] });
  assert(utText.includes('[AC-3][BD-2]') && utText.includes('state.resend()') && utText.includes('state.tick()'));
  for (const assertion of [
    'expect(state.countdownSeconds).assertEqual(60)', 'expect(otpService.callLog.length).assertEqual(1)',
    'expect(await state.resend()).assertFalse()', 'expect(state.countdownSeconds).assertEqual(0)',
    'expect(await state.resend()).assertTrue()', 'expect(otpService.callLog.length).assertEqual(2)',
    "expect(state.updateOtp('12a34567', 6)).assertEqual('123456')", 'expect(state.canSubmit(6)).assertTrue()',
  ]) assert(utText.includes(assertion), `The delivered test must assert the actual AC-3/BD-2 behavior: ${assertion}`);
  assert(otp.includes('class OtpVerificationState') && otp.includes('resend()') && otp.includes('tick()'));
  assert(service.includes('this.otpState.resend()') && service.includes('this.otpState.tick()'));
  assert(ui.includes('this.openingService.resendOtp()') && ui.includes('this.openingService.tickOtp()'));
  assert(files.has(resultPath.replace('frozen.ut-result.WalletMain.json', 'execution-key.json')), 'Frozen result needs its delivered native execution key');
  const prior = promptText.split('### (prior semantic findings)')[1]?.split('\n### ')[0] ?? '';
  const unchangedPassRows = prior.split(/\r?\n/).filter(line => /^\| [a-z_]+ \| PASS \| (BLOCKER|MAJOR|MINOR|INFO) \|/.test(line));
  assert(unchangedPassRows.some(line => line.startsWith('| reference_crosscheck | PASS |')), 'Preserve the unchanged judgment actually delivered in the prior report');
  const evidence = [acceptancePath, utPath, otpPath, servicePath, uiPath, resultPath].join('; ');
  const issues = ['acceptance_to_interface', ...(prior.includes('late_plan_verification') ? ['late_plan_verification'] : [])];
  let lateFinding: Record<string, unknown> | undefined;
  let lateBasis = '';
  if (issues.includes('late_plan_verification')) {
    const [, review] = only('/blueprint/component-blueprint.review.md');
    assert(review.includes('AC-3'), 'Late verification receives the newly cited original review, not a fabricated material change');
    lateFinding = YAML.parse(/```yaml\s*\n([\s\S]*?)```/.exec(prior)![1]).verification_result.checks
      .find((check: { id: string }) => check.id === 'late_plan_verification');
    const rows = (require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates'))
      .readVerifierSemanticIssues(root, feature, request.phase, prior, '(delivered prior finding)', path.join(root, 'framework'))?.rows;
    lateBasis = rows?.find(row => row.id === 'late_plan_verification')?.summary ?? '';
    assert(lateFinding && lateBasis, 'Refutation preserves the delivered original observation and its complete basis');
  }
  const reply = 'Independent verifier substitute read the production current request/material and their bound originals.\n'
    + '| id | status | severity | evidence |\n|---|---|---|---|\n' + unchangedPassRows.join('\n')
    + issues.map(issue => `\n| ${issue} | ${issue === 'late_plan_verification' ? 'FAIL' : 'PASS'} | MAJOR | ${evidence} |`).join('') + '\n'
    + '```yaml\n' + YAML.stringify({ verification_result: { checks: issues.map(id => id === 'late_plan_verification' ? lateFinding : ({ id, status: 'PASS', severity: 'MAJOR',
      details: 'Current AC-3/BD-2 behavior is exercised through production state and service/UI calls; planning text is a non-required synchronization difference.' })),
      summary: { pass: 1, fail: lateFinding ? 1 : 0, blockers: 0, verdict: 'PASS' } } }) + '```\n'
    + '```issue-verification\n' + YAML.stringify(issues.map(issue => ({ issue, verdict: 'refuted', repair_owner: 'plan',
      evidence: evidence + '; frozen 26/26 execution, real countdown/resend assertions and unchanged material-bound source resolve the previous mandatory acceptance concern.'
        + (issue === 'late_plan_verification' ? '; ' + lateBasis : '') }))) + '```\n';
  if (writeReply) publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports, feature, phase: request.phase,
    subjectId: request.subject_id, skipSummaryPatch: true, reportText: reply });
  return { subject: request.subject_id, files: [...files.keys()], reply };
}

async function replayS2(mode: 'success' | 'budget-full' | 'without-entry-evidence' | 'terminal' | 'terminal-interrupt' | 'terminal-stale' | 'terminal-mixed' = 'success'): Promise<void> {
  const terminalMode = mode.startsWith('terminal');
  const { root, feature, runId, featureDir } = copyC6HostReplay();
  const featureRoot = path.join(root, featureDir);
  const eventsPath = path.join(featureRoot, 'goal-runs', runId, 'events.jsonl');
  const originalEvents = fs.readFileSync(eventsPath);
  const historicalEvents = originalEvents.toString('utf8').trim().split('\n').map(line => JSON.parse(line)) as GoalRunEvent[];
  assert.equal(countAgentInvokeStarts(historicalEvents), 29);
  const factsPath = path.join(featureRoot, 'context/facts.md');
  const factsSha = hash(factsPath);
  const products = ['plan/plan.md', 'contracts.yaml', 'use-cases.yaml'].map(file => ({ file, sha: hash(path.join(featureRoot, file)) }));
  const before = json(path.join(featureRoot, 'goal-runs', runId, 'progress.json'));
  assert.equal(before.budget.turns_used, 29);
  assert.equal(before.budget.turns_limit, 30);
  const previousHdc = process.env.HARNESS_HDC_EXE;
  const replies: Array<{ subject: string; files: string[]; reply: string }> = [];
  const evidenceModule = require('../../scripts/utils/phase-evidence-manifest') as typeof import('../../scripts/utils/phase-evidence-manifest');
  const runtime = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
  const materialModule = require('../../scripts/utils/verifier-material') as typeof import('../../scripts/utils/verifier-material');
  const originalEvidenceCollector = materialModule.collectCurrentAcceptanceEvidence;
  const boundary = require('../../scripts/utils/goal-reconcile-boundary') as typeof import('../../scripts/utils/goal-reconcile-boundary');
  const originalBoundary = boundary.createGoalReconcileBoundary;
  let lateFinding = false;
  let cut = false;
  let planStarts = 0;
  const calls: string[] = [];
  let entryEvidenceSuppressed = mode === 'without-entry-evidence';
  try {
    const { frameworkRoot } = provisionFrameworkUnder(root);
    if (terminalMode) {
      // Controlled late-arrival tests need two verifications; the original S2 29/30 case remains unchanged.
      const manifestPath = path.join(featureRoot, 'goal-runs', runId, 'manifest.json');
      const manifest = json(manifestPath); manifest.budget.max_total_turns = 32;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      boundary.createGoalReconcileBoundary = writer => originalBoundary(event => {
        writer(event);
        if (event.type === 'phase_start' && event.phase === 'plan') {
          planStarts++;
          if (mode === 'terminal-interrupt' && planStarts === 2) {
            cut = true; throw new Error('controlled cut after terminal verification dispatch');
          }
        }
        if (lateFinding || event.type !== 'phase_verdict' || event.phase !== 'plan' || event.verdict !== 'PASS' || event.action !== 'advance') return;
        // A late verifier reply changes no product, manifest, outcome, scope or verdict fact.
        for (const phase of ['coding', 'review', 'ut', 'testing']) assert.equal(evidenceModule.recomputePhaseEvidenceStaleness(root, feature, [phase], { frameworkRoot, runId })[0].verdict, 'fresh', phase);
        lateFinding = true;
        const reports = featurePhaseReportsDir(root, feature, 'plan', frameworkRoot);
        const summary = json(path.join(reports, 'summary.json'));
        const priorReport = fs.readFileSync(path.resolve(root, summary.verifier_report), 'utf8');
        const passRows = priorReport.split(/\r?\n/)
          .filter(line => /^\| [a-z_]+ \| PASS \| (BLOCKER|MAJOR|MINOR|INFO) \|/.test(line));
        const newEvidence = 'doc/features/bc-openCard-2/blueprint/component-blueprint.review.md';
        const previousMaterial = json(path.join(reports, `verifier.material.${summary.verifier_subject_id}.json`));
        assert(!previousMaterial.files.some((file: { path: string }) => file.path === newEvidence), 'The late finding brings an actual previously unreviewed original');
        const evidenceLine = fs.readFileSync(path.join(root, newEvidence), 'utf8').split(/\r?\n/).findIndex(line => line.includes('AC-3')) + 1;
        assert(evidenceLine > 0);
        publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports, feature, phase: 'plan', subjectId: summary.verifier_subject_id,
          skipSummaryPatch: true, reportText: passRows.join('\n') + '\n```yaml\n' + YAML.stringify({ verification_result: { phase: 'plan', feature,
            checks: [{ id: 'late_plan_verification', status: 'FAIL', severity: 'MAJOR', acceptance_ids: ['AC-3'],
              affected_files: [`${featureDir}/plan/plan.md`], details: `\`${featureDir}/acceptance.yaml:54\`；\`${featureDir}/plan/plan.md:231\`；\`${newEvidence}:${evidenceLine}\`：结合新送达的原独立蓝图review核对当前AC-3既有验收实证`,
              suggestion: '由原plan验证方按当前冻结执行实证核实，不修改产品' }], summary: { verdict: 'PASS', blocker_count: 0 } } }) + '```\n'
                + (/```issue-verification\s*\n[\s\S]*?```/.exec(priorReport)?.[0] ?? '') + '\n' });
        if (mode === 'terminal-stale') fs.appendFileSync(path.join(featureRoot, 'plan/plan.md'), '\n新增业务接口约束：BankCardOpeningService 必须提供 cancelOpening。\n');
        if (mode === 'terminal-mixed') fs.appendFileSync(path.join(featureRoot, 'review/reports/summary.json'), '\n');
        console.log('[c6-late-disposition]', JSON.stringify({ mode,
          freshness: evidenceModule.recomputePhaseEvidenceStaleness(root, feature, ['plan'], { frameworkRoot, runId }),
          problems: (require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion'))
            .resolveCompletionDisposition({ projectRoot: root, frameworkRoot, feature, chain: CHAIN, runId }).completionBlocking }));
      });
    }
    write(root, 'AGENTS.md', '# Isolated captured S2 recovery\n');
    write(root, 'no-device.cmd', '@echo off\necho blocked>>"%~dp0device-operations.log"\nexit /b 97\n');
    process.env.HARNESS_HDC_EXE = path.join(root, 'no-device.cmd');
    for (const layer of loadFrameworkConfig(root).architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
    git(root, ['init', '-q']); git(root, ['config', 'core.autocrlf', 'false']); git(root, ['config', 'core.eol', 'lf']);
    write(root, '.gitignore', 'framework/\ntrust-cp/\nobservations/\n');
    git(root, ['add', '-A']); git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Captured S2 recovery inputs']);
    if (mode === 'budget-full') {
      // Controlled budget fault input after the immutable historical prefix; never a historical recovery claim.
      const ts = historicalEvents[historicalEvents.length - 1].ts;
      const injected = [
        { type: 'agent_invoke_start', phase: 'plan-verifier-format-repair', chain_phase: 'plan', purpose: 'verifier_format_repair', invoke_id: 'controlled-budget-boundary-i30', ts },
        { type: 'agent_invoke_end', phase: 'plan-verifier-format-repair', invoke_id: 'controlled-budget-boundary-i30', exit_code: 0, duration_ms: 0, ts },
        { type: 'agent_process_settled', phase: 'plan-verifier-format-repair', invoke_id: 'controlled-budget-boundary-i30', run_id: runId, exit_code: 0, ts },
      ];
      fs.appendFileSync(eventsPath, injected.map(event => JSON.stringify(event)).join('\n') + '\n');
    }
    const runtimeStartEvents = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)) as GoalRunEvent[];
    assert.equal(countAgentInvokeStarts(runtimeStartEvents), mode === 'budget-full' ? 30 : 29);
    if (mode === 'without-entry-evidence') materialModule.collectCurrentAcceptanceEvidence = input =>
      entryEvidenceSuppressed ? [] : originalEvidenceCollector(input);
    console.log('[c6-s2-start]', JSON.stringify({ root, mode, turns: `${countAgentInvokeStarts(runtimeStartEvents)}/30`, factsSha,
      freshness: evidenceModule.recomputePhaseEvidenceStaleness(root, feature, CHAIN, { frameworkRoot, runId }) }));
    runtime.__testing_setCanaryProbeInvoke(async () => ({ exitCode: 1, stdout: '', stderr: 'Explicit unavailable visual substitute, no visual PASS.', command: 'test-model-substitute' }));
    const unexpectedAuthor = (ctx: { phase: string }): never => { calls.push(ctx.phase); throw new Error(`S2 must deliver verification before allocating an author: ${ctx.phase}`); };
    const runOptions: Parameters<typeof runGoalRuntimeChain>[1] = { frameworkRoot, featureId: feature, adapter: 'codex', resume: runId,
      realHarness: true, viaRuntimeClass: true, noAutoForce: true, skipLegacySeal: true, forceResume: true,
      ...(terminalMode ? { resumeExtraArgs: ['--override-manifest'] } : {}),
      onSpec: unexpectedAuthor, onPlan: ctx => {
        if (mode !== 'without-entry-evidence') unexpectedAuthor(ctx);
        assert(ctx.prompt.includes('acceptance_to_interface'), 'Mutated entry still delivers the old repair task, without hidden correct work');
        // The bounded transport transcribes the existing result; only production may choose the subsequent verifier.
        entryEvidenceSuppressed = false;
      }, onCoding: unexpectedAuthor,
      onReview: unexpectedAuthor, onUt: unexpectedAuthor, onTesting: unexpectedAuthor,
      onOutOfChain: ctx => { calls.push(ctx.phase); assert.equal(ctx.phase, 'plan-verifier-format-repair');
        try { replies.push(verifyDeliveredCurrentEvidence(root, ctx.prompt, feature)); }
        catch (error) { console.error('[c6-s2-verifier-error]', (error as Error).stack); throw error; } },
    };
    let probe = await runGoalRuntimeChain(root, { ...runOptions,
      testControl: mode === 'terminal-interrupt' ? { expectedInterruption: 'controlled cut after terminal verification dispatch' } : undefined });
    if (mode === 'terminal-stale' || mode === 'terminal-mixed') {
        assert.equal(probe.exitCode, 1);
        const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)) as GoalRunEvent[];
        const requested = events.slice(runtimeStartEvents.length).filter(event => event.type === 'phase_backtrack_requested');
        assert(requested.length > 0, 'Genuine unfinished work uses the original content recovery');
        assert(requested.some(event => (event as GoalRunEvent & { invalidated_phases?: string[] }).invalidated_phases?.includes('testing')), 'Real content invalidation retains downstream causality');
        if (mode === 'terminal-stale') assert.equal(replies.length, 1, 'Changed business output cannot reuse its invocation for the late verification');
        if (mode === 'terminal-mixed') assert((require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion'))
          .resolveCompletionDisposition({ projectRoot: root, frameworkRoot, feature, chain: CHAIN, runId }).completionBlocking
          .some(problem => problem.id === 'open_finding:late_plan_verification'), 'Handling the independent unfinished review cannot discard the pending plan verification');
        assert(!fs.existsSync(path.join(root, 'device-operations.log')));
        return;
    }
    if (mode === 'terminal-interrupt') {
      assert(cut && probe.exitCode === 1, 'The real runtime must observe the controlled cut');
      probe = await runGoalRuntimeChain(root, runOptions);
    }
    const afterEvents = fs.readFileSync(eventsPath);
    assert(afterEvents.subarray(0, originalEvents.length).equals(originalEvents), 'Historical event prefix stays byte-identical');
    const tail = probe.events.slice(runtimeStartEvents.length);
    console.log('[c6-s2-tail]', JSON.stringify({ exitCode: probe.exitCode, invoked: probe.invokedPhases,
      tail: tail.map(({ type, phase, status, halt_reason, reason }) => ({ type, phase, status, halt_reason, reason })) }));
    if (!terminalMode && mode !== 'success') {
      assert.equal(probe.exitCode, 1);
      assert.deepEqual(probe.invokedPhases, mode === 'without-entry-evidence' ? ['plan'] : [], 'No over-budget verifier may start');
      const halt = [...tail].reverse().find(event => event.type === 'phase_halt');
      assert.equal(halt?.halt_reason, 'budget_turns', JSON.stringify(halt));
      assert(String(halt?.halt_guidance).includes('verifier') && String(halt?.halt_guidance).includes('request='), 'Budget stop names the concrete pending verifier task');
      assert(!fs.existsSync(path.join(featureRoot, 'goal-runs', runId, 'feature-completion.json')));
      assert.equal(hash(factsPath), factsSha);
      assert(!fs.existsSync(path.join(root, 'device-operations.log')));
      if (process.env.C6_REPLAY_REPORT_OUT) fs.writeFileSync(process.env.C6_REPLAY_REPORT_OUT, JSON.stringify({
        ok: true, mode, root, historicalTurns: 29, runtimeInitialTurns: mode === 'budget-full' ? 30 : 29,
        finalTurns: countAgentInvokeStarts(probe.events), actualNewInvocations: probe.invokedPhases,
        halt, featureCompletion: false, deviceExecutions: 0,
        faultInjection: mode === 'budget-full' ? 'Explicit controlled consumed-call input appended after unchanged historical prefix' : 'Suppress current evidence selection only until the first real author allocation',
      }, null, 2) + '\n');
      return;
    }
    assert.equal(probe.exitCode, 0);
    assert.deepEqual(calls, Array.from({ length: terminalMode ? 2 : 1 }, () => 'plan-verifier-format-repair'), 'Only the required verifiers, zero phase authors');
    assert.equal(replies.length, terminalMode ? 2 : 1);
    if (terminalMode) {
      assert(lateFinding && planStarts >= 2, 'The late finding must reach a real second runtime phase boundary');
      assert(!tail.some(event => event.type === 'phase_backtrack_requested' || event.type === 'phase_invalidated'), 'Pure terminal verification never starts a content invalidation transaction');
      if (mode === 'terminal-interrupt') assert(cut && tail.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), 'Recovery replays the actual cut after terminal dispatch');
    }
    assert(!tail.some(event => event.type === 'phase_start' && ['coding', 'review', 'ut', 'testing'].includes(String(event.phase))),
      'Fresh old PASS plus empty current completion work skips all four downstream stages before budget allocation');
    const status = [...tail].reverse().find(event => event.type === 'run_end')?.status;
    assert(['CHAIN_SLICE_COMPLETED', 'COMPLETED'].includes(String(status)), 'S2 must reach formal finalization');
    assert.equal(hash(factsPath), factsSha, 'No research/facts repair in replay preparation or pure verification');
    for (const row of products) assert.equal(hash(path.join(featureRoot, row.file)), row.sha, row.file);
    assert(!fs.existsSync(path.join(root, 'device-operations.log')), 'No actual device execution');
    const completion = json(path.join(featureRoot, 'goal-runs', runId, 'feature-completion.json'));
    const vfc = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
    const record = vfc.inspectCompletionRecord({ projectRoot: root, feature, expectedChain: completion.chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(record.verdict, 'VALID', record.reasons.join('; '));
    const assessed = (require('../../scripts/utils/feature-assessment') as typeof import('../../scripts/utils/feature-assessment')).assessFeature(root, feature,
      { expectedChain: completion.chain, expectedTrack: 'full', frameworkRoot });
    assert.equal(assessed.complete, true, JSON.stringify(assessed));
    const cuPath = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const canonical = cuPath.loadCanonicalChangeUnit(root, 'bc-openCard-2', 'bank-card-opening-flow');
    const cu = (require('../../scripts/utils/change-unit-completion') as typeof import('../../scripts/utils/change-unit-completion'))
      .observeChangeUnitCompletion(root, cuPath.asChangeUnitArtifact(canonical.changeUnit));
    assert.equal(cu.state, 'VALID', cu.reasons.join('; '));
    const driver = require('../../scripts/utils/assess') as typeof import('../../scripts/utils/assess');
    const next = driver.assessFeature({ projectRoot: root, feature, frameworkRoot, authorization: { mode: 'batch_authorized' } });
    assert.equal(next.recommendation.action, 'feature_completed');
    driver.writeNextProjection(root, feature, next);
    assert.equal(json(path.join(featureRoot, 'next.json')).recommendation.action, 'feature_completed');
    assert.equal(json(path.join(featureRoot, 'goal-runs', runId, 'goal-report.json')).status, status);
    const workflow = require('../../workflow-loader').resolveWorkflowSpec(root, { frameworkRoot });
    const scopeSource = (require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation'))
      .resolveEffectiveScopeSource(root, feature, runId)!;
    const resumedView = (require('../../scripts/utils/feature-track') as typeof import('../../scripts/utils/feature-track'))
      .resolveCurrentScopeView({ projectRoot: root, frameworkRoot, feature, workflow, previous: scopeSource.scope, currentRunId: runId });
    assert.deepEqual(resumedView.phase_chain, [], 'Repeated continuation sees the completed original request');
    const testing = json(path.join(featureRoot, 'testing/reports/summary.json'));
    assert.equal(testing.release_readiness, 'BLOCKED');
    assert.equal(testing.quality_axes.visual.verdict, 'UNVERIFIED');
    const report = { ok: true, root, status, initialTurns: 29, finalTurns: json(path.join(featureRoot, 'goal-runs', runId, 'progress.json')).budget.turns_used,
      countedNewInvokes: tail.filter(event => event.type === 'agent_invoke_start' && event.purpose !== 'vision_canary').length,
      canaryCalls: tail.filter(event => event.type === 'agent_invoke_start' && event.purpose === 'vision_canary').length,
      realModelCalls: 0, boundedVerifierSubstitutes: replies.length,
      formalGatePhases: tail.filter(event => event.type === 'harness_start').map(event => event.phase),
      formalGateMs: tail.reduce((sum, event, index) => {
        if (event.type !== 'harness_start') return sum;
        const end = tail.slice(index + 1).find(item => item.type === 'harness_end' && item.invoke_id === event.invoke_id && item.phase === event.phase);
        return end ? sum + Math.max(0, Date.parse(String(end.ts)) - Date.parse(String(event.ts))) : sum;
      }, 0),
      newAuthors: 0, deviceExecutions: 0, featureComplete: assessed.complete, cu: cu.state, next: next.recommendation.action,
      release: testing.release_readiness, verifierInputs: replies, environmentAdaptations: ['Current framework copied under isolated project', 'Local Git baseline', 'No-device command guard', 'Explicit unavailable canary transport substitute'] };
    assert.equal(report.finalTurns, terminalMode ? 31 : 30);
    assert.equal(report.countedNewInvokes, terminalMode ? 2 : 1);
    if (process.env.C6_REPLAY_REPORT_OUT) fs.writeFileSync(process.env.C6_REPLAY_REPORT_OUT, JSON.stringify(report, null, 2) + '\n');
  } finally {
    if (previousHdc === undefined) delete process.env.HARNESS_HDC_EXE; else process.env.HARNESS_HDC_EXE = previousHdc;
    materialModule.collectCurrentAcceptanceEvidence = originalEvidenceCollector;
    boundary.createGoalReconcileBoundary = originalBoundary;
    clearFrameworkConfigCache();
    if (process.env.C6_REPLAY_KEEP === '1') console.log('[c6-s2-preserved]', root);
    else fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const cases = [
  { name: 'S2 terminal verification reuses the valid invocation without revoking fresh downstream proofs', run: () => replayS2('terminal') },
  { name: 'S2 terminal verification survives a cut after dispatch without a content backtrack on replay', run: () => replayS2('terminal-interrupt') },
  { name: 'S2 terminal real business output changes retain the original content backtrack and downstream invalidation', run: () => replayS2('terminal-stale') },
  { name: 'S2 terminal verification preserves mixed unfinished downstream work for the next disposition', run: () => replayS2('terminal-mixed') },
  { name: 'S2 real runtime retains 29/30 and completes with one verifier, zero authors and zero device calls', run: () => replayS2() },
  { name: 'S2 30/30 controlled budget boundary stops pending verification without a 31st call', run: () => replayS2('budget-full') },
  { name: 'S2 removing entry counterevidence consumes an author then rejects the necessary verifier at 30/30', run: () => replayS2('without-entry-evidence') },
];
export async function runSelectedCases(selector?: string): Promise<{ results: UnitCaseResult[]; matchedCaseCount: number; executionTimings: UnitExecutionTiming[] }> {
  const selected = cases.filter(test => !selector || test.name.includes(selector));
  const results: UnitCaseResult[] = []; const executionTimings: UnitExecutionTiming[] = [];
  for (const test of selected) {
    const finishTiming = startCaseTiming([test.name], executionTimings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finishTiming();
  }
  return { results, matchedCaseCount: selected.length, executionTimings };
}
export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
