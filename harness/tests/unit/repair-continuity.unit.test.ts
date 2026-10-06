import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { repairInvocationCompleted, canRecheckLegacyBacktrackLimit } from '../../scripts/utils/goal-runner-phase';
import { applyInvalidationsToResume, replayAttemptedSignalIdentities } from '../../scripts/goal-phase-runtime';
import { decideRunContinuation } from '../../scripts/utils/goal-run-creation';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { superviseRun } from '../../scripts/utils/goal-supervisor';
import { runGoalRuntimeChain, setupGoalRuntimeHost, PRODUCT_ASSERTION_CHECK, writeVisualDiff, writeCleanTesting, seedI11Host, writeI11VisualDiff, runRealVisualGate } from './goal-runner-testing-integrity.unit.test';
import { applyProviderReviewToScreen, validateVisualProviderReviewPayload } from '../../../profiles/hmos-app/harness/visual-provider-review';
import { loadVisualScreenVerdicts } from '../../scripts/utils/execution-channel-evidence';
import type { VisualDiffScreenEntry } from '../../../profiles/hmos-app/harness/visual-diff-check';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import { projectGoalProgress } from '../../scripts/utils/goal-progress';
import { loadGoalReportJson, writeGoalReport, renderPhaseDispositionCell } from '../../scripts/utils/goal-report-generator';
import { loadWorkflowSpec } from '../../workflow-loader';

const fp = 'a'.repeat(64);
const request = { type: 'phase_backtrack_requested', to_phase: 'coding', invalidated_phases: ['coding', 'review'],
  candidates: [{ identity_schema: 'signal@1', item_fingerprint: fp }] };
const start = { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'R-coding-i17' };
const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });

test('invocation completion and historical fallback are exact and reject missing facts', () => {
  for (const extra of [{ timed_out: true }, { terminal_failure_observed: true }, {}]) {
    const events = [request, start, { type: 'agent_invoke_end', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, ...extra },
      { type: 'agent_process_settled', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, ...extra }];
    assert.strictEqual(repairInvocationCompleted(events, 'coding'), false);
    assert.strictEqual(replayAttemptedSignalIdentities(events).has(fp), false);
    assert.strictEqual(applyInvalidationsToResume(['coding', 'review'], [], events).postAgentPhases.length, 0);
    const completed = [...events, { type: 'phase_verdict', phase: 'coding', invoke_id: start.invoke_id, completion_observed: true, agent_failed: false }];
    assert.strictEqual(repairInvocationCompleted(completed, 'coding'), Object.keys(extra).length === 0);
    assert.strictEqual(repairInvocationCompleted([...events, { type: 'phase_verdict', phase: 'coding', invoke_id: 'other', completion_observed: true }], 'coding', start.invoke_id), false);
  }
  assert.strictEqual(repairInvocationCompleted([{ type: 'agent_process_settled', phase: 'coding' }], 'coding'), false);
  const finished = [request, start, { type: 'agent_invoke_end', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1, completion_observed: true },
    { type: 'agent_process_settled', phase: 'coding', invoke_id: start.invoke_id, exit_code: 1 }];
  assert.strictEqual(replayAttemptedSignalIdentities(finished).has(fp), true);
  assert.deepStrictEqual(applyInvalidationsToResume(['coding', 'review'], [], finished).postAgentPhases, ['coding']);
});

for (const kind of ['native-timeout', 'provider-terminal'] as const) test(`${kind}: real request producer and runtime retain interrupted owner after static PASS`, async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const probe = await runGoalRuntimeChain(root, {
      adapter: 'codex', runId: 'repair-continuity-' + kind, onCoding: () => {},
      onTesting: ({ root: r, attempt }) => {
        if (kind === 'provider-terminal' && attempt === 1) {
          writeVisualDiff(r, [{ id: 'add_card_home', verdict: 'pending', mustFix: [] }]);
          const file = path.join(r, 'doc/features/bc-openCard/device-testing/device-screenshots/visual-diff.json');
          const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
          applyProviderReviewToScreen(doc.screens[0], { screen_id: 'add_card_home', must_fix: ['repair blocked control'],
            defects: [{ class: 'clipping', element: 'hc_title', severity: 'blocker', note: 'blocked control', must_fix_refs: [0] }] },
          { invokeId: 'critic-i1', provider: { adapter: 'claude', model: 'm' }, evaluatedScreenshotHash: doc.screens[0].screenshot_hash });
          fs.writeFileSync(file, JSON.stringify(doc));
        } else writeCleanTesting(r);
      },
      onHarnessSummary: ({ phase, attempt }) => kind === 'native-timeout' && phase === 'testing' && attempt === 1
        ? { checks: [PRODUCT_ASSERTION_CHECK] } : null,
      invokeResultFor: (phase, attempt) => phase === 'coding' && attempt === 2
        ? { exitCode: 1, ...(kind === 'native-timeout' ? { timed_out: true } : { terminal_failure_observed: true }), stderr: 'interrupted owner' }
        : phase === 'coding' && attempt === 3 ? { exitCode: 1, completion_observed: true } : null,
    });
    const requests = probe.events.filter(e => e.type === 'phase_backtrack_requested');
    assert.strictEqual(requests.length, 1, JSON.stringify(requests));
    const ends = probe.events.filter(e => e.type === 'agent_invoke_end' && e.phase === 'coding');
    assert.ok(ends.length >= 3, JSON.stringify(ends));
    const interrupted = ends[1];
    const nextStart = probe.events.findIndex(e => e.type === 'agent_invoke_start' && e.invoke_id === ends[2].invoke_id);
    const window = probe.events.slice(probe.events.indexOf(interrupted), nextStart);
    assert.ok(!window.some(e => e.type === 'phase_backtrack_completed'), JSON.stringify(window));
    assert.ok(window.some(e => e.type === 'phase_verdict' && e.action === 'retry' && e.verdict !== 'PASS'), JSON.stringify(window));
    assert.strictEqual(ends[2].completion_observed, true, 'completion must be produced on end before the gate');
    assert.ok(probe.codingPrompts[2].includes('repair') || probe.codingPrompts[2].includes('blocked'), 'original work must remain in continuation prompt');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('retired backtrack limit reaches repeated request, explicit resume, attended and supervisor without rewriting history', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const first = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'legacy-limit', freshEndPhase: 'coding',
      onHarnessSummary: ({ phase }) => phase === 'coding' ? { blockers: [{ id: 'old-stop', severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression' }] } : null });
    const file = path.join(first.reportDir, 'events.jsonl');
    const rows = first.events.map(e => e.type === 'phase_halt' || e.type === 'run_end'
      ? { ...e, halt_reason: 'backtrack_limit', run_disposition: 'TERMINAL' } : e);
    fs.writeFileSync(file, rows.map(e => JSON.stringify(e)).join('\n') + '\n');
    const bytes = fs.readFileSync(file);
    const input = { projectRoot: root, feature: 'bc-openCard', runId: 'legacy-limit', events: rows };
    assert.strictEqual(canRecheckLegacyBacktrackLimit(input), true);
    assert.strictEqual(decideRunContinuation({ projectRoot: root, feature: 'bc-openCard', call: {} }).kind, 'rejoin');
    assert.strictEqual(prepareGoalModeRun({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', adapter: 'codex', requirement: '真机测试银行卡开卡流程' }).continuation.kind, 'rejoin');
    assert.strictEqual(superviseRun({ ...input, reportDir: path.relative(root, first.reportDir), probe: { identify: () => null, killTree: () => false } }).action, 'resume');
    assert.ok(bytes.equals(fs.readFileSync(file)), 'public read-only recheck must preserve historical bytes');
    assert.strictEqual(canRecheckLegacyBacktrackLimit({ ...input, events: [...rows, { type: 'phase_halt', halt_reason: 'budget_turns' }] }), false);
    const manifestFile = path.join(first.reportDir, 'manifest.json');
    const manifestBytes = fs.readFileSync(manifestFile);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    manifest.budget.max_total_turns = rows.filter(e => e.type === 'agent_invoke_start').length;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.strictEqual(canRecheckLegacyBacktrackLimit(input), false, 'retired policy does not renew consumed calls');
    fs.writeFileSync(manifestFile, manifestBytes);
    const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'legacy-limit', forceResume: false });
    assert.ok(resumed.invokedPhases.includes('coding'), 'explicit resume must reach original owner');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('a third productive native backtrack retains hard resource accounting in the same run', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'third-native-backtrack',
      onTesting: ({ root: r }) => writeCleanTesting(r),
      onCoding: ({ root: r, attempt }) => {
        if (attempt > 1) fs.writeFileSync(path.join(r, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets'), `struct AllBanksPage { build() { Text("fix${attempt}") } }`);
      },
      onHarnessSummary: ({ phase, attempt }) => phase === 'testing' && attempt <= 3 ? { checks: [
        { ...PRODUCT_ASSERTION_CHECK, id: `testing_failure_routing_TC-005_s${20 + attempt}` },
      ] } : null,
    });
    assert.strictEqual(probe.events.filter(e => e.type === 'phase_backtrack_requested').length, 3);
    assert.ok(!probe.events.some(e => e.halt_reason === 'backtrack_limit'));
    assert.ok(probe.events.filter(e => e.type === 'agent_invoke_start').length <= 30);
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('superseded and previous-cycle legacy limit runs never gain automatic recheck eligibility', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    const stop = ({ phase }: { phase: string }) => phase === 'coding'
      ? { blockers: [{ id: 'legacy-stop', severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression' }] } : null;
    const legacyRows = (probe: Awaited<ReturnType<typeof runGoalRuntimeChain>>) => {
      const rows = probe.events.map(e => e.type === 'phase_halt' || e.type === 'run_end'
        ? { ...e, halt_reason: 'backtrack_limit', run_disposition: 'TERMINAL' } : e);
      fs.writeFileSync(path.join(probe.reportDir, 'events.jsonl'), rows.map(e => JSON.stringify(e)).join('\n') + '\n');
      return rows;
    };
    const source = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'claimed-limit', freshEndPhase: 'coding', onHarnessSummary: stop });
    const sourceRows = legacyRows(source);
    const current = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'current-limit', supersede: ['claimed-limit'], onHarnessSummary: stop });
    const currentRows = legacyRows(current);
    assert.ok(currentRows.some(e => e.type === 'supersede' && e.target_run_id === 'claimed-limit'), 'real successor must audit its claim');
    const old = { projectRoot: root, feature: 'bc-openCard', runId: 'claimed-limit', events: sourceRows };
    const now = { ...old, runId: 'current-limit', events: currentRows };
    assert.strictEqual(canRecheckLegacyBacktrackLimit(old), false);
    assert.strictEqual(canRecheckLegacyBacktrackLimit(now), true, 'current unclaimed run still rechecks remaining resources');
    const workflow = loadWorkflowSpec(path.resolve(__dirname, '../../..'), 'spec-driven');
    const manifest = loadGoalManifestFromRun(root, old.runId, { feature: old.feature });
    const progress = projectGoalProgress({ projectRoot: root, manifest, events: sourceRows, workflow, featuresDir: 'doc/features' });
    assert.strictEqual(progress.run_disposition, 'TERMINAL');
    const report = loadGoalReportJson(root, manifest.report_dir)!;
    report.phases = report.phases.map(phase => phase.halted
      ? { ...phase, halt_reason: 'backtrack_limit', run_disposition: 'TERMINAL' } : phase);
    const written = writeGoalReport(root, manifest.report_dir, report);
    const halted = report.phases.find(phase => phase.halted)!;
    assert.strictEqual(halted.run_disposition, 'TERMINAL');
    assert.ok(fs.readFileSync(written.mdPath, 'utf8').includes(renderPhaseDispositionCell(halted)), 'old terminal report remains terminal');
    assert.strictEqual(superviseRun({ ...old, reportDir: manifest.report_dir, probe: { identify: () => null, killTree: () => false } }).action, 'never_restart');
    const rejected = await runGoalRuntimeChain(root, { adapter: 'codex', resume: old.runId, forceResume: false, noAutoForce: true });
    assert.ok(rejected.exitCode !== 0 && rejected.invokedPhases.length === 0, 'explicit old resume without force must remain denied');
    const completed = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'completed-cycle', freshEndPhase: 'coding' });
    assert.ok(completed.events.some(e => e.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(e.status))), 'real completed run creates the existing cycle boundary');
    assert.ok(!completed.events.some(e => e.type === 'supersede' && e.target_run_id === now.runId), 'prior-cycle run is unclaimed, excluded by the completion boundary itself');
    assert.strictEqual(canRecheckLegacyBacktrackLimit(now), false, 'old cycle cannot reopen its smaller resource fold');
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('real completion-observed cleanup exit1 plus gate crash resumes validation-only without invoking owner again', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    let crashed = false;
    const first = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'completion-cleanup-crash', onCoding: () => {},
      onTesting: ({ root: r }) => writeCleanTesting(r),
      onHarnessSummary: ({ phase, attempt }) => phase === 'testing' && attempt === 1 ? { checks: [PRODUCT_ASSERTION_CHECK] } : null,
      invokeResultFor: (phase, attempt) => phase === 'coding' && attempt === 2 ? { exitCode: 1, completion_observed: true } : null,
      afterHarnessPass: ({ phase, root: r, runId }) => {
        if (phase !== 'coding') return;
        const rows = fs.readFileSync(path.join(r, `doc/features/bc-openCard/goal-runs/${runId}/events.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
        const end = [...rows].reverse().find(e => e.type === 'agent_invoke_end' && e.phase === phase);
        if (end?.exit_code === 1 && end.completion_observed === true) { crashed = true; throw new Error('gate crash after completed cleanup'); }
      },
    });
    assert.ok(crashed);
    const originalEnd = first.events.find(e => e.type === 'agent_invoke_end' && e.completion_observed === true)!;
    assert.strictEqual(originalEnd.exit_code, 1, 'real producer persisted completion before gate crash');
    const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'completion-cleanup-crash', forceResume: true,
      onTesting: ({ root: r }) => writeCleanTesting(r) });
    assert.ok(!resumed.invokedPhases.includes('coding'), JSON.stringify(resumed.invokedPhases));
    assert.ok(resumed.harnessPhases.includes('coding'), 'owner gate really revalidates');
    assert.strictEqual(resumed.events.filter(e => e.type === 'agent_invoke_start' && e.phase === 'coding').length, 2);
    assert.strictEqual(resumed.events.filter(e => e.type === 'phase_backtrack_requested').length, 1);
    assert.deepStrictEqual(resumed.events.find(e => e.type === 'phase_backtrack_requested')!.candidates,
      first.events.find(e => e.type === 'phase_backtrack_requested')!.candidates);
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('real native interrupted end survives a gate crash and resumes its original request', async () => {
  const root = setupGoalRuntimeHost('codex').root;
  try {
    let crashed = false;
    const first = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'repair-gate-crash', onCoding: () => {},
      onTesting: ({ root: r }) => writeCleanTesting(r),
      onHarnessSummary: ({ phase, attempt }) => phase === 'testing' && attempt === 1 ? { checks: [PRODUCT_ASSERTION_CHECK] } : null,
      invokeResultFor: (phase, attempt) => phase === 'coding' && attempt === 2 ? { exitCode: 1, timed_out: true } : null,
      afterHarnessPass: ({ phase, root: r, runId }) => {
        if (phase !== 'coding') return;
        const events = fs.readFileSync(path.join(r, `doc/features/bc-openCard/goal-runs/${runId}/events.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
        if (events.some(e => e.type === 'agent_invoke_end' && e.timed_out === true)) { crashed = true; throw new Error('gate crash after interrupted end'); }
      },
    });
    assert.ok(crashed);
    const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: 'repair-gate-crash', forceResume: true,
      onCoding: () => {}, onTesting: ({ root: r }) => writeCleanTesting(r) });
    assert.strictEqual(resumed.events.filter(e => e.type === 'phase_backtrack_requested').length, 1);
    assert.ok(resumed.invokedPhases.includes('coding'), JSON.stringify(resumed.invokedPhases));
    const original = first.events.find(e => e.type === 'phase_backtrack_requested')!;
    assert.deepStrictEqual(resumed.events.find(e => e.type === 'phase_backtrack_requested')!.candidates, original.candidates);
    assert.deepStrictEqual(resumed.events.find(e => e.type === 'phase_backtrack_requested')!.related_input_snapshot, original.related_input_snapshot);
  } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const severity of ['minor', 'major', 'blocker'] as const) for (const hard of [false, true]) {
  test(`real provider payload ${severity}/${hard ? 'hard' : 'soft'} shares writer, gate, runtime candidates, channel evidence and debt`, async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      seedI11Host(root);
      let gate: ReturnType<typeof runRealVisualGate> | undefined;
      const probe = await runGoalRuntimeChain(root, {
        adapter: 'codex', runId: `visual-effective-${severity}-${hard}`, freshRequirement: hard ? '添卡流程必须像素级还原参考截图，不接受降级。' : '添卡流程页面按参考截图 1:1 还原。',
        onTesting: ({ root: r, attempt }) => {
          if (attempt !== 1) { writeCleanTesting(r); return; }
          writeI11VisualDiff(r);
          const file = path.join(r, 'doc/features/bc-openCard/device-testing/device-screenshots/visual-diff.json');
          const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
          const targets = doc.screens.map((s: VisualDiffScreenEntry) => ({ screen_id: s.screen_id, refHash: 'ref-' + s.screen_id, shotHash: s.screenshot_hash,
            refAbs: '', shotAbs: '', screenshotRel: s.screenshot_path }));
          const body = JSON.stringify({ schema_version: '1.0', run_id: 'R', attempt_id: 'A', image_hashes: targets.flatMap((t: { refHash: string; shotHash: string }) => [t.refHash, t.shotHash]),
            screens: doc.screens.map((s: VisualDiffScreenEntry, i: number) => ({ screen_id: s.screen_id, reference_image_hash: targets[i].refHash, evaluated_screenshot_hash: targets[i].shotHash,
              must_fix: s.must_fix, defects: s.defects!.map(d => ({ ...d, severity })), region_attest: s.region_attest })) });
          const parsed = validateVisualProviderReviewPayload(body, { targets, runId: 'R', attemptId: 'A', requireRegionAttest: false });
          assert.ok(parsed.ok, JSON.stringify(parsed));
          if (!parsed.ok) return;
          doc.screens.forEach((s: VisualDiffScreenEntry, i: number) => {
            s.must_fix = []; s.defects = []; s.region_attest = [];
            applyProviderReviewToScreen(s, parsed.screens[i], { invokeId: 'provider-real-payload', provider: { adapter: 'claude', model: 'm' }, hardPixel: hard, evaluatedScreenshotHash: s.screenshot_hash });
            assert.strictEqual(s.verdict, severity === 'minor' || (severity === 'major' && !hard) ? 'warn' : 'fail');
          });
          fs.writeFileSync(file, JSON.stringify(doc));
        },
        testingGateChecks: ({ root: r, feature, fields }) => {
          if (gate) return null;
          gate = runRealVisualGate(r, feature, fields);
          return [{ id: 'test_plan_exists', category: 'structure', description: 'functional fact', severity: 'BLOCKER', status: 'PASS', details: 'test transport functional fact' }, gate];
        },
      });
      assert.ok(gate);
      const structured = gate!.structured as { channel_evidence_usable: boolean; downgraded_screens: string[] };
      const requests = probe.events.filter(e => e.type === 'phase_backtrack_requested');
      const pathDebt = path.join(root, 'doc/features/bc-openCard/visual-debt.json');
      const open = fs.existsSync(pathDebt) ? JSON.parse(fs.readFileSync(pathDebt, 'utf8')).entries.filter((e: { status: string }) => e.status === 'open') : [];
      if (severity === 'minor' || (severity === 'major' && !hard)) {
        assert.strictEqual(requests.length, 0, JSON.stringify(requests));
        assert.strictEqual(structured.channel_evidence_usable, true, gate!.details);
        assert.strictEqual(open.length > 0, severity === 'major', JSON.stringify(open));
        const evidence = loadVisualScreenVerdicts({ projectRoot: root, feature: 'bc-openCard', visualGate: gate! } as never);
        assert.ok([...evidence.byScreen.values()].every(e => e.usable), JSON.stringify([...evidence.byScreen]));
      } else {
        assert.ok(requests.some(e => (e.candidates as Array<{ id: string }>).some(c => c.id.startsWith('visual_diff:'))), JSON.stringify(requests));
        assert.strictEqual(structured.channel_evidence_usable, false);
      }
    } finally { clearFrameworkConfigCache(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) try { await c.run(); results.push({ name: c.name, ok: true }); }
  catch (e) { results.push({ name: c.name, ok: false, error: String((e as Error).message) }); }
  return results;
}
