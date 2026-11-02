import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { repairInvocationCompleted, canRecheckLegacyBacktrackLimit } from '../../scripts/utils/goal-runner-phase';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import { loadGoalReportJson, writeGoalReport, renderPhaseDispositionCell } from '../../scripts/utils/goal-report-generator';
import { runGoalRuntimeChain, setupGoalRuntimeHost, productAssertionCheck, writeCleanTesting, seedI11Host, writeI11VisualDiff, runRealVisualGate,
  seedSignalHost, writeCurrentSignals, currentSignalGateChecks, PRODUCT_FILE } from './goal-runner-testing-integrity.unit.test';
import { applyProviderReviewToScreen, validateVisualProviderReviewPayload } from '../../../profiles/hmos-app/harness/visual-provider-review';
import { loadVisualScreenVerdicts } from '../../scripts/utils/execution-channel-evidence';
import type { VisualDiffScreenEntry } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';
import type { CheckResult } from '../../scripts/utils/types';
import { sha256File, loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import { executionRequestForInvoke } from '../../scripts/utils/session-execution-handoff';
import { asRecord } from '../../scripts/utils/component-blueprint-model';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { ensureFeatureExecutionScopeFrozen } from '../../scripts/utils/feature-execution-scope';
import { initializeFidelityRouting } from '../../scripts/utils/goal-preflight';
import { resolveCompletionDisposition } from '../../scripts/utils/verify-feature-completion';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type SelectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';

const fp = 'a'.repeat(64);
const request = { type: 'phase_backtrack_requested', to_phase: 'coding', invalidated_phases: ['coding', 'review'],
  candidates: [{ identity_schema: 'signal@1', item_fingerprint: fp }] };
const start = { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'R-coding-i17' };
const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });

function withProductRead(root: string, checks: CheckResult[]): CheckResult[] {
  return checks.map(check => ({ ...check, structured: { ...(asRecord(check.structured) ?? {}),
    source_attempt_dependencies: [{ path: PRODUCT_FILE, exists: true, sha256: sha256File(path.join(root, PRODUCT_FILE)), role: 'artifact' }],
  } }));
}

function prepareProductRepairRequest(root: string, requirement = '真机测试银行卡开卡流程'): void {
  const frameworkRoot = path.resolve(__dirname, '../../..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
  config.active_workflow = 'obligation-driven';
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(config)); clearFrameworkConfigCache();
  initializeFidelityRouting({ projectRoot: root, frameworkRoot, feature: 'bc-openCard', requirement,
    featuresDirRel: 'doc/features', executionIdentity: 'repair-continuity-fixture', requirementProvenance: 'explicit_cli' });
  prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature: 'bc-openCard', completionTarget: 'request',
    requestedResults: ['repair the original implementation and verify its existing obligations'], requestedPhases: ['coding', 'review', 'ut', 'testing'],
    requirement, overwrite: true });
  ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature: 'bc-openCard' });
}

test('invocation completion and historical fallback are exact and reject missing facts', () => {
  for (const extra of [{ timed_out: true }, { terminal_failure_observed: true }, {}]) {
    const events = [request, start, { type: 'agent_invoke_end', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, ...extra },
      { type: 'agent_process_settled', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, ...extra }];
    assert.strictEqual(repairInvocationCompleted(events, 'coding'), false);
    const completed = [...events, { type: 'phase_verdict', phase: 'coding', invoke_id: start.invoke_id, completion_observed: true, agent_failed: false }];
    assert.strictEqual(repairInvocationCompleted(completed, 'coding'), Object.keys(extra).length === 0);
    assert.strictEqual(repairInvocationCompleted([...events, { type: 'phase_verdict', phase: 'coding', invoke_id: 'other', completion_observed: true }], 'coding', start.invoke_id), false);
  }
  assert.strictEqual(repairInvocationCompleted([{ type: 'agent_process_settled', phase: 'coding' }], 'coding'), false);
  const finished = [request, start, { type: 'agent_invoke_end', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, completion_observed: true },
    { type: 'agent_process_settled', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1 }];
  assert.strictEqual(repairInvocationCompleted(finished, 'coding'), true, '真实完成仍可复用；并未恢复旧阶段队列');
});

for (const kind of ['native-timeout', 'provider-terminal'] as const) test(`${kind}: real request producer and runtime retain interrupted owner after static PASS`, async () => {
  const root = setupGoalRuntimeHost('codex', false).root;
  try {
    if (kind === 'provider-terminal') seedSignalHost(root);
    let interruptedOwner = false;
    const repairPrompts: string[] = [];
    const repaired = (r: string) => fs.readFileSync(path.join(r, PRODUCT_FILE), 'utf8').includes('r4-provider-owner-fixed');
    const observeProvider = ({ root: r }: { root: string }) => {
      writeCurrentSignals(r, [], []);
      const file = path.join(r, 'doc/features/bc-openCard/device-testing/device-screenshots/visual-diff.json');
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fixed = repaired(r);
      applyProviderReviewToScreen(doc.screens[0], { screen_id: 'add_card_home', must_fix: fixed ? [] : ['repair blocked control'],
        defects: fixed ? [] : [{ class: 'clipping', element: 'hc_page_title', bbox: [0.1, 0.2, 0.3, 0.4], severity: 'blocker', note: 'blocked control', must_fix_refs: [0] }],
        region_attest: doc.screens[0].region_attest },
      { invokeId: 'critic-i1', provider: { adapter: 'claude', model: 'm' }, hardPixel: false, evaluatedScreenshotHash: doc.screens[0].screenshot_hash });
      fs.writeFileSync(file, JSON.stringify(doc));
    };
    const options: NonNullable<Parameters<typeof runGoalRuntimeChain>[1]> = {
      adapter: 'codex', runId: 'repair-continuity-' + kind,
      onAuthor: ({ root: r, prompt }) => {
        if (prompt.includes('repair blocked control') || prompt.includes('testing_failure_routing_TC-005_s24')) repairPrompts.push(prompt);
        if (interruptedOwner && repairPrompts.includes(prompt)) {
          fs.writeFileSync(path.join(r, PRODUCT_FILE), 'struct AllBanksPage { build() { Text("r4-provider-owner-fixed") } }');
        }
      },
      onTestingHarness: kind === 'provider-terminal' ? observeProvider : ({ root: r }) => writeCleanTesting(r),
      ...(kind === 'provider-terminal' ? { testingGateChecks: ctx => withProductRead(ctx.root, currentSignalGateChecks(ctx)) } : {}),
      onHarnessSummary: ({ phase }) => kind === 'native-timeout' && phase === 'testing' && !repaired(root)
        ? { checks: withProductRead(root, [productAssertionCheck(root)]) } : null,
      invokeResultFor: (phase, attempt) => {
        if (phase === 'work-unit-author' && attempt === 2 && !interruptedOwner) {
          interruptedOwner = true;
          return { exitCode: 1, completion_observed: false, ...(kind === 'native-timeout' ? { timed_out: true } : { terminal_failure_observed: true }), stderr: 'interrupted owner' };
        }
        return phase === 'work-unit-author' && repaired(root) ? { exitCode: 1, completion_observed: true } : null;
      },
    };
    prepareProductRepairRequest(root);
    const first = await runGoalRuntimeChain(root, options);
    const interrupted = first.events.find(event => event.type === 'agent_invoke_end'
      && (event.timed_out === true || event.terminal_failure_observed === true));
    assert.ok(interrupted, 'the real native interrupted end must be persisted');
    assert.strictEqual(interrupted.completion_observed, false, 'a static PASS cannot sign native completion');
    assert.ok(first.events.some(event => event.type === 'run_end' && event.run_disposition === 'WAITING'), JSON.stringify(first.events.slice(-5)));
    const resumed = await runGoalRuntimeChain(root, { ...options, runId: undefined, resume: 'repair-continuity-' + kind, forceResume: true });
    assert.strictEqual(resumed.exitCode, 0, JSON.stringify(resumed.events.slice(-5)));
    assert.ok(resumed.events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'));
    assert.ok(repaired(root) && repairPrompts.length > 0, 'the exact delivered repair must reach and be fixed by the original unit author');
    assert.ok(resumed.events.some(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author' && event.completion_observed === true),
      'real completion-observed cleanup may be reused only after the native producer supplies it');
    assert.ok(first.invokedPhases.length + resumed.invokedPhases.length <= 4, 'interruption cannot buy an idle phase loop');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('retired backtrack history can rejoin current facts without rewriting history or restoring quotas', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const first = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'legacy-limit', freshEndPhase: 'coding',
      onHarnessSummary: ({ phase }) => phase === 'coding' ? { blockers: [{ id: 'old-stop', severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression' }] } : null });
    const file = path.join(first.reportDir, 'events.jsonl');
    const rows = first.events.map(event => event.type === 'phase_halt' || event.type === 'run_end'
      ? { ...event, halt_reason: 'backtrack_limit', run_disposition: 'TERMINAL' } : event);
    fs.writeFileSync(file, rows.map(event => JSON.stringify(event)).join('\n') + '\n');
    const bytes = fs.readFileSync(file);
    assert.strictEqual(canRecheckLegacyBacktrackLimit({ projectRoot: root, feature: 'bc-openCard', runId: 'legacy-limit', events: rows }), true,
      'the old reason permits a current observation, not a renewed quota');
    const prepared = prepareGoalModeRun({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', adapter: 'codex', requirement: '真机测试银行卡开卡流程' });
    assert.strictEqual(prepared.continuation.kind, 'rejoin');
    assert.ok(bytes.equals(fs.readFileSync(file)), 'preparation must preserve the original historical event bytes');
    const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'legacy-limit', forceResume: true });
    assert.ok(resumed.invokedPhases.every(phase => phase === 'work-unit-author') && resumed.invokedPhases.length <= 1,
      'explicit continuation gets only actual current work, not a renewed phase queue');
    assert.ok(fs.readFileSync(file).subarray(0, bytes.length).equals(bytes), 'original history must remain a byte-exact prefix');
    assert.ok(!resumed.events.slice(rows.length).some(event => ['budget_turns', 'backtrack_limit'].includes(String(event.halt_reason))),
      'the old label cannot regain current stopping authority');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('three distinct verified product repairs stay in the original unit without a retired backtrack cap', async () => {
  const root = setupGoalRuntimeHost('codex', false).root;
  try {
    prepareProductRepairRequest(root);
    const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'third-native-backtrack',
      onTestingHarness: ({ root: r }) => writeCleanTesting(r),
      onAuthor: ({ root: r, attempt }) => {
        if (attempt > 1) fs.writeFileSync(path.join(r, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets'), `struct AllBanksPage { build() { Text("fix${attempt}") } }`);
      },
      onHarnessSummary: ({ phase }) => {
        const product = fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8');
        if (phase !== 'testing' || product.includes('fix4')) return null;
        const remaining = product.includes('fix3') ? 23 : product.includes('fix2') ? 22 : 21;
        return { checks: withProductRead(root, [productAssertionCheck(root, { stepIndex: remaining })]) };
      },
    });
    assert.strictEqual(probe.harnessPhases.filter(phase => phase === 'testing').length, 4, 'three actual findings require their own real affected verification');
    assert.ok(probe.events.some(e => e.type === 'run_end' && e.status === 'CHAIN_SLICE_COMPLETED'));
    assert.ok(fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes('fix4'), 'all three delivered repairs must actually reach the original author');
    assert.ok(!probe.events.some(e => e.halt_reason === 'backtrack_limit'));
    assert.ok(probe.events.filter(e => e.type === 'agent_invoke_start').length === 4);
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('superseded legacy runs stay non-resumable while their historical terminal reports remain readable', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const stop = ({ phase }: { phase: string }) => phase === 'coding'
      ? { blockers: [{ id: 'old-stop', severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression' }] } : null;
    const source = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'claimed-limit', freshEndPhase: 'coding', onHarnessSummary: stop });
    const oldEvents = path.join(source.reportDir, 'events.jsonl');
    const history = source.events.map(event => event.type === 'phase_halt' || event.type === 'run_end'
      ? { ...event, halt_reason: 'backtrack_limit', run_disposition: 'TERMINAL' } : event);
    fs.writeFileSync(oldEvents, history.map(event => JSON.stringify(event)).join('\n') + '\n');
    const originalBytes = fs.readFileSync(oldEvents), manifest = loadGoalManifestFromRun(root, 'claimed-limit', { feature: 'bc-openCard' });
    const current = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'current-limit', supersede: ['claimed-limit'], onHarnessSummary: stop });
    assert.ok(current.events.some(event => event.type === 'supersede' && event.target_run_id === 'claimed-limit'), 'the successor must audit its actual ancestor');
    assert.ok(fs.readFileSync(oldEvents).subarray(0, originalBytes.length).equals(originalBytes), 'superseding cannot rewrite the old native history');
    const report = loadGoalReportJson(root, manifest.report_dir);
    assert.ok(report, 'the actual old report must remain readable');
    report.phases = report.phases.map(phase => phase.phase === 'coding'
      ? { ...phase, halted: true, halt_reason: 'backtrack_limit', run_disposition: 'TERMINAL' as const } : phase);
    const halted = report.phases.find(phase => phase.phase === 'coding');
    assert.ok(halted, 'the actual old coding result is retained');
    const written = writeGoalReport(root, manifest.report_dir, report, { frameworkRoot: path.resolve(__dirname, '../../..') });
    assert.ok(fs.readFileSync(written.mdPath, 'utf8').includes(renderPhaseDispositionCell(halted)), 'historical terminal display remains intact');
    const rejected = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'claimed-limit', forceResume: false, noAutoForce: true });
    assert.ok(rejected.exitCode !== 0 && rejected.invokedPhases.length === 0, 'the claimed ancestor cannot be resumed without the actual current authority');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('real completion-observed cleanup exit1 plus gate crash resumes validation-only without invoking owner again', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    let crashed = false;
    const first = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'completion-cleanup-crash', freshEndPhase: 'coding',
      testControl: { expectedInterruption: 'gate crash after completed cleanup' },
      invokeResultFor: phase => phase === 'work-unit-author' ? { exitCode: 1, completion_observed: true } : null,
      afterHarnessPass: ({ phase }) => {
        if (phase === 'coding') { crashed = true; throw new Error('gate crash after completed cleanup'); }
      },
    });
    assert.ok(crashed, 'the real current coding writer must finish before the injected gate crash');
    const originalEnd = first.events.find(event => event.type === 'agent_invoke_end' && event.completion_observed === true);
    assert.ok(originalEnd && originalEnd.exit_code === 1, 'real native completion must be persisted before the gate crash');
    const currentProof = loadPhaseEvidenceManifest(root, 'bc-openCard', 'coding');
    assert.ok(currentProof?.integrityOk, 'the actual current checker and its complete input/output binding must exist before the later cleanup fault');
    const checks = asRecord(JSON.parse(fs.readFileSync(path.join(root, 'doc/features/bc-openCard/coding/reports/script-report.json'), 'utf8')))?.checks;
    assert.ok(Array.isArray(checks) && checks.length > 0 && checks.every(check => asRecord(check)?.status === 'PASS'),
      'a PASS header alone cannot justify transaction-only recovery');
    const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'completion-cleanup-crash', forceResume: true });
    assert.deepStrictEqual(resumed.invokedPhases, [], 'completed native work must not be repurchased for a missing tool end');
    const finalProof = loadPhaseEvidenceManifest(root, 'bc-openCard', 'coding');
    assert.ok(finalProof?.integrityOk && recomputePhaseEvidenceStaleness(root, 'bc-openCard', ['coding'], { frameworkRoot: path.resolve(__dirname, '../../..') })[0]?.verdict === 'fresh',
      'the original complete current checks must remain qualified after the real finalizer transaction resumes');
    assert.deepStrictEqual(finalProof.manifest.inputs.map(({ path, exists, sha256 }) => ({ path, exists, sha256 })),
      currentProof.manifest.inputs.map(({ path, exists, sha256 }) => ({ path, exists, sha256 })), 'transaction recovery cannot change the original checked business bytes');
    const actual = loadGoalManifestFromRun(root, 'completion-cleanup-crash', { feature: 'bc-openCard' });
    const observed = { projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard',
      runId: actual.run_id, chain: actual.phase_chain ?? ['spec', 'plan', 'coding'], endpoint: 'request' as const };
    const current = resolveCompletionDisposition(observed);
    assert.ok(current.completionEligible,
      'only the qualified current completion disposition can finish transaction recovery: ' + JSON.stringify(current.reasons));
    assert.strictEqual(resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length, 1);
    assert.ok(resumed.events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'));
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('real native interrupted end stays unfinished and explicit resume retains its original request', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const first = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'repair-gate-crash', freshEndPhase: 'coding',
      invokeResultFor: phase => phase === 'work-unit-author' ? { exitCode: 1, completion_observed: false, timed_out: true } : null,
    });
    const original = first.events.find(event => event.type === 'agent_invoke_end' && event.timed_out === true);
    assert.ok(original && original.completion_observed !== true, 'a native timeout never becomes a completed author');
    assert.deepStrictEqual(first.harnessPhases, [], 'tools cannot manufacture completion for the interrupted native call');
    const issued = executionRequestForInvoke(first.reportDir, String(original.invoke_id));
    assert.ok(issued, 'the native interruption must retain the real signed request');
    const requestFile = path.resolve(first.reportDir, issued.reference.path), originalBytes = fs.readFileSync(requestFile);
    const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'repair-gate-crash', forceResume: true });
    assert.ok(resumed.invokedPhases.includes('work-unit-author'), 'unfinished native work must be resumed by the actual original unit');
    assert.ok(fs.readFileSync(requestFile).equals(originalBytes), 'resume must not rewrite the old request or failed native end');
    assert.ok(resumed.events.some(event => event.type === 'agent_invoke_end' && event.invoke_id === original.invoke_id && event.timed_out === true));
    assert.ok(resumed.events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'));
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const severity of ['minor', 'major', 'blocker'] as const) for (const hard of [false, true]) {
  test(`real provider payload ${severity}/${hard ? 'hard' : 'soft'} shares writer, gate, runtime candidates, channel evidence and debt`, async () => {
    const root = setupGoalRuntimeHost('codex', false).root;
    try {
      seedI11Host(root);
      let gate: ReturnType<typeof runRealVisualGate> | undefined;
      const observeProvider = ({ root: r }: { root: string }) => {
          const fixed = fs.readFileSync(path.join(r, PRODUCT_FILE), 'utf8').includes('r4-visual-effective-fixed');
          writeI11VisualDiff(r);
          const file = path.join(r, 'doc/features/bc-openCard/device-testing/device-screenshots/visual-diff.json');
          const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
          const targets = doc.screens.map((s: VisualDiffScreenEntry) => ({ screen_id: s.screen_id, refHash: 'ref-' + s.screen_id, shotHash: s.screenshot_hash,
            refAbs: '', shotAbs: '', screenshotRel: s.screenshot_path }));
          const body = JSON.stringify({ schema_version: '1.0', run_id: 'R', attempt_id: 'A', image_hashes: targets.flatMap((t: { refHash: string; shotHash: string }) => [t.refHash, t.shotHash]),
            screens: doc.screens.map((s: VisualDiffScreenEntry, i: number) => ({ screen_id: s.screen_id, reference_image_hash: targets[i].refHash, evaluated_screenshot_hash: targets[i].shotHash,
              must_fix: fixed ? [] : s.must_fix, defects: fixed ? [] : s.defects!.map(d => ({ ...d, severity })), region_attest: (s.region_attest ?? []).map(region => fixed ? { ...region, verdict: 'no_diff' } : region) })) });
          const parsed = validateVisualProviderReviewPayload(body, { targets, runId: 'R', attemptId: 'A', requireRegionAttest: false });
          assert.ok(parsed.ok, JSON.stringify(parsed));
          if (!parsed.ok) return;
          doc.screens.forEach((s: VisualDiffScreenEntry, i: number) => {
            s.must_fix = []; s.defects = []; s.region_attest = [];
            applyProviderReviewToScreen(s, parsed.screens[i], { invokeId: 'provider-real-payload', provider: { adapter: 'claude', model: 'm' }, hardPixel: hard, evaluatedScreenshotHash: s.screenshot_hash });
            assert.strictEqual(s.verdict, fixed ? 'pass' : severity === 'minor' || (severity === 'major' && !hard) ? 'warn' : 'fail');
          });
          fs.writeFileSync(file, JSON.stringify(doc));
      };
      const repairPrompts: string[] = [];
      const requirement = hard ? '添卡流程必须像素级还原参考截图，不接受降级。' : '添卡流程页面按参考截图 1:1 还原。';
      prepareProductRepairRequest(root, requirement);
      const probe = await runGoalRuntimeChain(root, {
        adapter: 'codex', runId: `visual-effective-${severity}-${hard}`, freshRequirement: requirement,
        onTestingHarness: observeProvider,
        onAuthor: ({ root: r, prompt }) => {
          if (prompt.includes('visual_diff:card_type_sheet') || prompt.includes('visual_diff:sms_verification_sheet')) {
            repairPrompts.push(prompt);
            fs.writeFileSync(path.join(r, PRODUCT_FILE), 'struct AllBanksPage { build() { Text("r4-visual-effective-fixed") } }');
          }
        },
        testingGateChecks: ({ root: r, feature, fields }) => {
          const current = runRealVisualGate(r, feature, fields);
          gate ??= current;
          return withProductRead(r, [{ id: 'test_plan_exists', category: 'structure', description: 'functional fact', severity: 'BLOCKER', status: 'PASS', details: 'test transport functional fact' }, current]);
        },
      });
      assert.ok(gate);
      assert.strictEqual(probe.exitCode, 0, JSON.stringify(probe.events.slice(-5)));
      assert.ok(probe.events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'), 'provider cases must naturally complete current verification');
      const structured = gate!.structured as { channel_evidence_usable: boolean; downgraded_screens: string[] };
      const authorCalls = probe.events.filter(e => e.type === 'agent_invoke_start' && e.phase === 'work-unit-author');
      const pathDebt = path.join(root, 'doc/features/bc-openCard/visual-debt.json');
      const open = fs.existsSync(pathDebt) ? JSON.parse(fs.readFileSync(pathDebt, 'utf8')).entries.filter((e: { status: string }) => e.status === 'open') : [];
      if (severity === 'minor' || (severity === 'major' && !hard)) {
        assert.strictEqual(repairPrompts.length, 0, 'disclosed visual debt must not dispatch repair');
        assert.strictEqual(structured.channel_evidence_usable, true, gate!.details);
        assert.strictEqual(open.length > 0, severity === 'major', JSON.stringify(open));
        const evidence = loadVisualScreenVerdicts({ projectRoot: root, feature: 'bc-openCard', visualGate: gate! } as never);
        assert.ok([...evidence.byScreen.values()].every(e => e.usable), JSON.stringify([...evidence.byScreen]));
      } else {
        assert.ok(repairPrompts.length > 0 && authorCalls.length <= 3, 'real current visual defects must reach the original unit author without an idle phase loop');
        assert.strictEqual(structured.channel_evidence_usable, false);
        assert.ok(fs.readFileSync(path.join(root, PRODUCT_FILE), 'utf8').includes('r4-visual-effective-fixed'), 'a real blocker cannot be waived by the soft/effective flag; the delivered current finding must be repaired');
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases.filter(c => matchesUnitCase(c.name, selector))) {
    const endTiming = startCaseTiming([c.name], timings);
    try { await c.run(); results.push({ name: c.name, ok: true }); }
    catch (e) { results.push({ name: c.name, ok: false, error: String((e as Error).message) }); }
    finally { endTiming(); }
  }
  return selectedUnitCases(results, selector, timings);
}

export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
