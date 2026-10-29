import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { prepareGoalModeRun, runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { buildInitialDesignGoalManifest, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { readOriginalDeliveryBudget } from '../../scripts/utils/delivery-origin';
import { asChangeUnitArtifact, deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { runUnattendedDesignRepair, designRepairSignature, designRepairTarget, type DesignRepairBriefLike } from '../../scripts/utils/design-repair-unattended';
import { repairAdapter, s16Born } from './design-authority-repair.unit.test';
import { BLUEPRINT_ID, withFreshCuHost, project, specFirstCuHooks } from './lifecycle-evolution.unit.test';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const authorization = { mode: 'goal_mode' as const, autonomyAuthorized: true };
const detail = '独立模型提供方暂不可用；解除条件：提供方恢复后继续原请求。';
const frameworkRoot = path.resolve(__dirname, '../../..');
type Json = Record<string, any>;
const events = (runDir: string): Json[] => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));

async function initialWaiting(): Promise<void> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'initial-waiting-'));
  const fixture = (name: string) => {
    const projectRoot = path.join(parent, name);
    fs.mkdirSync(path.join(projectRoot, 'doc/features'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: name,
      project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', features_dir: 'doc/features' }));
    clearFrameworkConfigCache();
    const prepared = prepareGoalModeRun({ projectRoot, frameworkRoot, feature: 'waiting-blueprint', runId: 'waiting-root', adapter: 'claude',
      requirement: '正式新增本地未读消息聚合并完整交付。', budget: { max_total_turns: 3, wall_clock_minutes: 120 },
      unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } });
    assert(isInitialDesignManifest(prepared.manifest));
    return { projectRoot, ...prepared, options: { projectRoot, frameworkRoot, feature: prepared.manifest.feature, runId: prepared.manifest.run_id,
      adapter: 'claude', runMode: 'attended' as const, authorization } };
  };
  try {
    const callback = fixture('callback');
    let calls = 0;
    await new GoalPhaseRuntime({ args: ['--feature', callback.manifest.feature, '--resume', callback.manifest.run_id,
      '--project-root', callback.projectRoot, '--framework-root', frameworkRoot, '--foreground-ok'], authorization,
      executor: { async execute(context) { calls++; return { status: 'waiting', phase: context.phase, details: detail,
        exitCode: 0, stdout: '', stderr: '', command: 'waiting-callback' }; } } }).run();
    const session = fixture('session');
    const first = await runGoalModeSessionStep(session.options) as Json;
    const stopped = await runGoalModeSessionStep({ ...session.options, requestPath: first.request.path,
      report: { status: 'waiting', phase: first.phase, details: detail } }) as Json;
    assert.equal(stopped.type, 'goal_session_result');
    assert.equal(stopped.result.status, 'waiting');
    assert.equal(calls, 1);
    for (const lane of [callback, session]) {
      assert.equal(readOriginalDeliveryBudget(lane.projectRoot, lane.manifest)!.totalTurns, 1);
      const rows = events(lane.runDir);
      assert.equal(rows.filter(row => row.type === 'agent_invoke_start').length, 1);
      assert.equal(rows.at(-1)!.status, 'HALTED');
      assert(String(rows.at(-1)!.error).includes(detail));
      assert(!rows.some(row => row.type === 'run_end' && row.status === 'COMPLETED'));
    }
    for (const lane of [callback, session]) {
      const next = await runGoalModeSessionStep(lane.options) as Json;
      assert.equal(next.type, 'phase_execute_request', 'a future explicit continuation must not replay the historical waiting report');
      assert.equal(readOriginalDeliveryBudget(lane.projectRoot, lane.manifest)!.totalTurns, 2);
      assert.equal(events(lane.runDir).filter(row => row.type === 'agent_invoke_start').length, 2);
      if (lane === session) assert.notEqual(next.attempt_id, first.attempt_id);
    }
    const history = fixture('completed-then-waiting');
    const args = ['--feature', history.manifest.feature, '--resume', history.manifest.run_id,
      '--project-root', history.projectRoot, '--framework-root', frameworkRoot, '--foreground-ok'];
    let completedCalls = 0;
    await new GoalPhaseRuntime({ args, authorization, executor: { async execute(context) {
      completedCalls++; return { status: 'passed', phase: context.phase, exitCode: 1, completion_observed: true,
        kill_attempted: true, stdout: '', stderr: '', command: 'completed-with-cleanup-exit' };
    } } }).run();
    assert.equal(completedCalls, 1, 'completion=true with exit1 is completed content and must pause without a duplicate author');
    assert.equal(events(history.runDir).at(-1)!.halt_reason, 'no_progress_guard');
    let waitingCalls = 0;
    await new GoalPhaseRuntime({ args: [...args, '--force-resume'], authorization, executor: { async execute(context) {
      waitingCalls++; return { status: 'waiting', phase: context.phase, details: detail, exitCode: 0, stdout: '', stderr: '', command: 'later-waiting' };
    } } }).run();
    assert.equal(waitingCalls, 1);
    const resumed = await runGoalModeSessionStep(history.options) as Json;
    assert.equal(resumed.type, 'phase_execute_request', 'the latest waiting fact makes the content baseline unknown; do not skip it to reuse older completed content');
    assert.equal(readOriginalDeliveryBudget(history.projectRoot, history.manifest)!.totalTurns, 3);
    assert.equal(events(history.runDir).filter(row => row.type === 'agent_invoke_start').length, 3);

  } finally { fs.rmSync(parent, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

async function unfinishedContentBaseline(kind: 'timeout' | 'terminal-failure' | 'transport'): Promise<void> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `initial-${kind}-baseline-`));
  try {
    fs.mkdirSync(path.join(projectRoot, 'doc/features'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: kind,
      project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', features_dir: 'doc/features' }));
    clearFrameworkConfigCache();
    const prepared = prepareGoalModeRun({ projectRoot, frameworkRoot, feature: 'unfinished-blueprint', runId: 'unfinished-root', adapter: 'claude',
      requirement: '正式完成本地未读消息设计与交付。', budget: { max_total_turns: 3, wall_clock_minutes: 120 },
      unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } });
    let calls = 0;
    await new GoalPhaseRuntime({ args: ['--feature', prepared.manifest.feature, '--resume', prepared.manifest.run_id,
      '--project-root', projectRoot, '--framework-root', frameworkRoot, '--foreground-ok'], authorization,
      executor: { async execute(context) {
        calls++;
        if (calls > 1) return { status: 'waiting', phase: context.phase, details: detail, exitCode: 0, stdout: '', stderr: '', command: 'safe-test-cut' };
        return { status: 'passed', phase: context.phase, exitCode: 0, completion_observed: true, stdout: '', stderr: '', command: kind,
          ...(kind === 'timeout' ? { timed_out: true } : kind === 'terminal-failure' ? { terminal_failure_observed: true }
            : { spawn_error: { code: 'EPIPE', message: 'transport could not deliver the request' } }) };
      } } }).run();
    assert(!events(prepared.runDir).some(row => row.halt_reason === 'no_progress_guard'), `${kind} must not become completed content even with exit0/completion=true`);
    assert.equal(calls, kind === 'transport' ? 1 : 2, 'failed content does not prevent the next real responsibility from being attempted');
    const next = await runGoalModeSessionStep({ projectRoot, frameworkRoot, feature: prepared.manifest.feature, runId: prepared.manifest.run_id,
      adapter: 'claude', runMode: 'attended', authorization }) as Json;
    assert.equal(next.type, 'phase_execute_request');
    assert.equal(readOriginalDeliveryBudget(projectRoot, prepared.manifest)!.totalTurns, calls + 1);
  } finally { fs.rmSync(projectRoot, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

async function repairWaiting(): Promise<void> {
  await withFreshCuHost(async host => {
    for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
      if (unit.changeUnit.change_unit_id !== 'ledger-refresh') fs.rmSync(path.dirname(unit.canonicalPath), { recursive: true, force: true });
    }
    const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
    const original = fs.readFileSync(canonical.canonicalPath);
    const unit = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
    // This protocol fixture begins before construction input preparation; discard the
    // scaffold's older scope candidate instead of presenting it as current design evidence.
    fs.rmSync(path.join(path.dirname(unit.canonicalPath), 'feature.yaml'), { force: true });
    const approved: Json = YAML.parse(fs.readFileSync(unit.canonicalPath, 'utf8'));
    const defective = structuredClone(approved);
    defective.design_refs = defective.design_refs.filter((ref: Json) => ref.target.view_id !== 'development');
    fs.writeFileSync(unit.canonicalPath, YAML.stringify(defective));
    const manifest = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'waiting-repair-root', adapter: 'claude',
      requirement: '补齐账目刷新缺少的已有设计引用并完整交付，不改变产品范围。', budget: { max_total_turns: 8, wall_clock_minutes: 120 },
      unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 },
      initial_design: { completion_target: 'feature', requested_results: ['完整交付'], requested_phases: ['plan', 'coding', 'review', 'ut'] } }, { projectRoot: host.root });
    createGoalRun({ projectRoot: host.root, manifest, chain: [] });
    const runDir = path.join(host.root, manifest.report_dir);
    const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID, runId: manifest.run_id,
      adapter: 'claude', runMode: 'attended' as const, authorization };
    const readiness = deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).perUnit.find(row => row.changeUnitId === 'ledger-refresh')!;
    const brief: DesignRepairBriefLike = { class: 'B2', items: [{ check: 'plan:cu:design-basis', class: 'B2', codes: readiness.issueIds,
      artifacts: [path.relative(host.root, unit.canonicalPath)], basis: readiness.issues.map(issue => issue.message).join('；'), needs: ['补回真实development设计引用'] }] };
    let recording: Array<{ file: string; line: string }> | undefined;
    const emit = (value: Json) => { const line = JSON.stringify({ ts: new Date().toISOString(), ...value }) + '\n';
      const file = path.join(runDir, 'events.jsonl'); fs.appendFileSync(file, line); recording?.push({ file, line }); };
    emit({ type: 'run_start', session_started_at: new Date().toISOString() });
    const seed = await runUnattendedDesignRepair({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
      designTarget: designRepairTarget(host.root, deriveChangeUnitFeatureId(BLUEPRINT_ID, 'ledger-refresh')), phase: 'initial-design', runId: manifest.run_id,
      reportDir: manifest.report_dir, requirement: manifest.requirement, brief, signature: designRepairSignature(BLUEPRINT_ID, 'initial-design', brief.items),
      heldFeatureLock: null, runtimeWrites: [manifest.report_dir], emit, registerLockRelease: () => {},
      recordEventLines: () => { recording = []; return () => { const lines = recording!; recording = undefined; return lines; }; },
      invoke: async purpose => { emit({ type: 'agent_invoke_start', phase: `design-repair-${purpose}`, invoke_id: 'seed-waiting' });
        emit({ type: 'agent_invoke_end', phase: `design-repair-${purpose}`, invoke_id: 'seed-waiting', status: 'waiting', exit_code: 0 });
        return { started: true, ok: false, status: 'waiting', detail }; } });
    assert.equal(seed.outcome, 'waiting');
    const first = await runGoalModeSessionStep(options) as Json;
    assert.equal(first.phase, 'design-repair-author', JSON.stringify(first));
    const pause = await runGoalModeSessionStep({ ...options, requestPath: first.request.path,
      report: { status: 'waiting', phase: first.phase, details: detail } }) as Json;
    assert.equal(pause.type, 'goal_session_result');
    assert.equal(pause.result.status, 'waiting');
    assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, 2);
    assert(fs.existsSync(path.join(runDir, 'design-repair/component-blueprint.yaml')));
    assert(!events(runDir).some(row => row.type === 'design_authority_repair' && row.stage === 'failed'));
    const retry = await runGoalModeSessionStep(options) as Json;
    assert.equal(retry.phase, 'design-repair-author');
    assert.notEqual(retry.attempt_id, first.attempt_id);
    const savedNode = structuredClone(resolveBlueprintTarget(canonical.blueprint, { kind: 'node', view_id: 'logical', id: 'ledger-domain' }));
    const adapter = repairAdapter(host, () => savedNode as Json, { author: (_doc, draft) => fs.writeFileSync(path.join(path.dirname(draft), 'change-unit.yaml'), YAML.stringify(approved)) });
    const request = JSON.parse(fs.readFileSync(retry.request.path, 'utf8'));
    await adapter.onOutOfChain({ phase: retry.phase, prompt: request.context.instruction, attempt: 1, runId: manifest.run_id });
    const questioning = await runGoalModeSessionStep({ ...options, requestPath: retry.request.path,
      report: { status: 'passed', phase: retry.phase, details: '完成当前责任草稿' } }) as Json;
    assert.equal(questioning.phase, 'design-repair-questioning');
    const qPause = await runGoalModeSessionStep({ ...options, requestPath: questioning.request.path,
      report: { status: 'waiting', phase: questioning.phase, details: detail } }) as Json;
    assert.equal(qPause.result.status, 'waiting');
    assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, 4);
    const qRetry = await runGoalModeSessionStep(options) as Json;
    assert.equal(qRetry.phase, 'design-repair-questioning');
    assert.notEqual(qRetry.attempt_id, questioning.attempt_id);
    assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, 5);
    assert.equal(events(runDir).filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
    assert(!events(runDir).some(row => row.type === 'design_authority_repair' && row.stage === 'failed'));
    assert.deepEqual(fs.readFileSync(canonical.canonicalPath), original, 'waiting never publishes a partial draft');
    const qRequest = JSON.parse(fs.readFileSync(qRetry.request.path, 'utf8'));
    await adapter.onOutOfChain({ phase: qRetry.phase, prompt: qRequest.context.instruction, attempt: 1, runId: manifest.run_id });
    await runGoalModeSessionStep({ ...options, requestPath: qRetry.request.path,
      report: { status: 'passed', phase: qRetry.phase, details: '提供方已恢复；独立质询完成' } });
    const after = events(runDir);
    assert.equal(after.filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
    assert(!after.some(row => row.type === 'design_authority_repair' && row.stage === 'failed'));
    assert(after.some(row => row.type === 'design_authority_repair' && row.stage === 'published' && row.outcome === 'recovered'));
    assert.equal(after.filter(row => row.type === 'agent_invoke_start' && row.phase === 'design-repair-author').length, 3, 'completed author is reused after questioning resumes');
    assert.equal(loadCanonicalBlueprint(host.root, BLUEPRINT_ID).blueprint.revision, Number(canonical.blueprint.revision) + 1);
    assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready);
    assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, after.filter(row => row.type === 'agent_invoke_start').length);
  });
}

async function normalQuestioningWaiting(): Promise<void> {
  await withFreshCuHost(async host => {
    let authors = 0, questioners = 0;
    const first = await s16Born(host, { adapter: {
      author: () => { authors++; },
      questioning: doc => { questioners++; delete doc.review_summary.questioning;
        return { status: 'waiting', exitCode: 0, details: detail }; },
    } });
    assert.equal(authors, 1);
    assert.equal(questioners, 1);
    assert(!first.events.some(event => event.type === 'design_authority_repair' && event.stage === 'failed'));
    assert(!first.events.some(event => event.type === 'design_authority_repair' && event.stage === 'published'));
    const rawActor = repairAdapter(host, () => first.saved, { author: () => { authors++; }, questioning: () => { questioners++; } });
    const p = project(host, first.feature);
    const hooks = specFirstCuHooks(p, true);
    const helper = require('../../scripts/utils/goal-runner-phase') as typeof import('../../scripts/utils/goal-runner-phase');
    const originalGuard = helper.checkTerminalResumeGuard;
    // Existing test seam: keep the real resume decision and all its conditions,
    // shortening only its cooldown instead of sleeping five minutes.
    helper.checkTerminalResumeGuard = input => originalGuard({ ...input, cooldownMinutes: 0 });
    try {
      await runGoalRuntimeChain(host.root, { frameworkRoot: host.frameworkRoot, featureId: first.feature, adapter: 'codex',
        resume: first.runId, forceResume: true, noAutoForce: true, ...hooks,
        onPlan: () => { throw new Error('test cut after the real design transaction, before downstream product work'); },
        onOutOfChain: rawActor.onOutOfChain });
    } finally { helper.checkTerminalResumeGuard = originalGuard; }
    const directory = featureFilePath(host.root, first.feature, 'goal-runs');
    const rows = fs.readdirSync(directory).filter(name => !name.startsWith('.')).flatMap(name => events(path.join(directory, name)));
    const repairs = rows.filter(row => row.type === 'design_authority_repair');
    console.log('[normal-questioning-waiting]', JSON.stringify({ authors, questioners, repairs,
      ends: rows.filter(row => row.type === 'run_end').map(row => ({ status: row.status, halt_reason: row.halt_reason })) }));
    assert.equal(authors, 1, 'a successful design author must not be invoked again while recovering its waiting questioner');
    assert.equal(questioners, 2, 'only the waiting independent responsibility is called again');
    assert.equal(repairs.filter(row => row.stage === 'attempted').length, 1);
    assert(!repairs.some(row => row.stage === 'failed'));
    assert(repairs.some(row => row.stage === 'published' && row.outcome === 'recovered'), 'the original machine validation/publication/reconcile must really finish');
    const published = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
    assert.equal(published.blueprint.revision, first.baseRevision + 1);
    const current = asChangeUnitArtifact(loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh').changeUnit);
    assert.equal(current.component_blueprint_ref.artifact_sha256, published.artifactSha256, 'the real CU must be rebound to this publication');
    // The normal construction run intentionally remains interrupted at plan, so
    // global P2 readiness is not the terminal predicate of this transaction test.
  });
}

const cases = [
  { name: 'f3b8e6a1 waiting: original session and executor pause once then a later entry can continue', run: initialWaiting },
  ...(['timeout', 'terminal-failure', 'transport'] as const).map(kind => ({ name: `d18f6c42 ${kind} invocation cannot establish a completed-content no-progress baseline`, run: () => unfinishedContentBaseline(kind) })),
  { name: 'f3b8e6a1 waiting: design author and independent questioning keep one open transaction across waiting', run: repairWaiting },
  { name: 'f3b8e6a1 waiting: normal questioning resumes its original transaction without replaying a successful author', run: normalQuestioningWaiting },
];
export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
if (require.main === module) void runSelectedCases().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.results.some(row => !row.ok) ? 1 : 0; });
