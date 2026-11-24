import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { prepareGoalModeRun, runGoalModeSessionStep as runGoalModeSessionStepUnchecked } from '../../scripts/goal-mode-entry';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { buildInitialDesignGoalManifest, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { readOriginalDeliveryActivity } from '../../scripts/utils/delivery-origin';
import { asChangeUnitArtifact, deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { blueprintAuthorContent } from '../../scripts/utils/component-blueprint-model';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { repairAdapter, s16Born } from './design-authority-repair.unit.test';
import { BLUEPRINT_ID, withFreshCuHost, project, specFirstCuHooks } from './lifecycle-evolution.unit.test';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { reportFixtureQuestioning, seedLedgerQuestioningInput } from '../utils/initial-questioning-fixture';
import { withRuntimeTest, preserveRuntimeTestEvidence, type RuntimeTestControl } from '../utils/runtime-test-control';
const runGoalModeSessionStep = (options: Parameters<typeof runGoalModeSessionStepUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeSessionStepUnchecked(options));


const authorization = { mode: 'goal_mode' as const, autonomyAuthorized: true };
const detail = '独立模型提供方暂不可用；解除条件：提供方恢复后继续原请求。';
const frameworkRoot = path.resolve(__dirname, '../../..');
type Json = Record<string, any>;
const events = (runDir: string): Json[] => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));

async function waitingAuthorLeavesQuestioningReady(): Promise<void> {
  await withFreshCuHost(async host => {
    seedLedgerQuestioningInput(host.root);
    const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
    const workspace = path.dirname(path.dirname(canonical.canonicalPath));
    for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
      const directory = path.dirname(unit.canonicalPath);
      assert(path.resolve(directory).startsWith(path.resolve(workspace) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    }
    fs.unlinkSync(canonical.canonicalPath);
    const blueprint = canonical.blueprint;
    delete (blueprint.review_summary as Json).questioning;
    const requirement = '完成原账目刷新及恢复设计的独立核验。';
    const manifest = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'waiting-author-ready-for-q', adapter: 'claude',
      requirement, initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] } }, { projectRoot: host.root });
    const born = createGoalRun({ projectRoot: host.root, manifest, chain: [] });
    const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: manifest.feature, runId: manifest.run_id,
      adapter: 'claude', runMode: 'attended', sessionFallback: true, authorization };
    const author = await runGoalModeSessionStep(options) as Json;
    assert.equal(author.phase, 'initial-design-author', JSON.stringify(author));
    fs.writeFileSync(canonical.canonicalPath, YAML.stringify(blueprint));
    const next = await runGoalModeSessionStep({ ...options, requestPath: author.request.path,
      report: { status: 'waiting', phase: author.phase, details: '原作者暂不可用，已交回实际蓝图。' } }) as Json;
    assert.equal(next.phase, 'initial-design-questioning', JSON.stringify(next));
    const records = events(path.dirname(born.manifestPath));
    assert(records.some(event => event.type === 'agent_invoke_end' && event.phase === author.phase && event.status === 'waiting'));
    assert(!records.some(event => event.type === 'run_end' && event.status === 'COMPLETED'));
  });
}

async function initialWaiting(): Promise<void> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'initial-waiting-'));
  const projectRoots: string[] = [];
  const fixture = (name: string, maxTurns = 3) => {
    const projectRoot = path.join(parent, name);
    projectRoots.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, 'doc/features'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: name,
      project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', features_dir: 'doc/features' }));
    clearFrameworkConfigCache();
    const prepared = prepareGoalModeRun({ projectRoot, frameworkRoot, feature: 'waiting-blueprint', runId: 'waiting-root', adapter: 'claude',
      requirement: '正式新增本地未读消息聚合并完整交付。', budget: { max_total_turns: maxTurns, wall_clock_minutes: 120 },
      unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } });
    assert(isInitialDesignManifest(prepared.manifest));
    return { projectRoot, ...prepared, options: { projectRoot, frameworkRoot, feature: prepared.manifest.feature, runId: prepared.manifest.run_id,
      adapter: 'claude', runMode: 'attended' as const, authorization } };
  };
  try {
    const callback = fixture('callback');
    let calls = 0;
    await withRuntimeTest({ root: callback.projectRoot }, () => new GoalPhaseRuntime({ args: ['--feature', callback.manifest.feature, '--resume', callback.manifest.run_id,
      '--project-root', callback.projectRoot, '--framework-root', frameworkRoot, '--foreground-ok'], authorization,
      executor: { async execute(context) { calls++; return { status: 'waiting', phase: context.phase, details: detail,
        exitCode: 0, stdout: '', stderr: '', command: 'waiting-callback' }; } } }).run());
    const session = fixture('session');
    const first = await runGoalModeSessionStep(session.options) as Json;
    const stopped = await runGoalModeSessionStep({ ...session.options, requestPath: first.request.path,
      report: { status: 'waiting', phase: first.phase, details: detail } }) as Json;
    assert.equal(stopped.type, 'goal_session_result');
    assert.equal(stopped.result.status, 'waiting');
    assert.equal(calls, 1);
    for (const lane of [callback, session]) {
      assert.equal(readOriginalDeliveryActivity(lane.projectRoot, lane.manifest)!.calls, 1);
      const rows = events(lane.runDir);
      assert.equal(rows.filter(row => row.type === 'agent_invoke_start').length, 1);
      assert.equal(rows.at(-1)!.status, 'HALTED');
      assert(String(rows.at(-1)!.error).includes(detail));
      assert(!rows.some(row => row.type === 'run_end' && row.status === 'COMPLETED'));
    }
    for (const lane of [callback, session]) {
      const next = await runGoalModeSessionStep(lane.options) as Json;
      assert.equal(next.type, 'phase_execute_request', 'a future explicit continuation must not replay the historical waiting report');
      assert.equal(readOriginalDeliveryActivity(lane.projectRoot, lane.manifest)!.calls, 2);
      assert.equal(events(lane.runDir).filter(row => row.type === 'agent_invoke_start').length, 2);
      if (lane === session) assert.notEqual(next.attempt_id, first.attempt_id);
    }
    const history = fixture('completed-then-waiting', 4);
    const args = ['--feature', history.manifest.feature, '--resume', history.manifest.run_id,
      '--project-root', history.projectRoot, '--framework-root', frameworkRoot, '--foreground-ok'];
    let completedCalls = 0;
    await withRuntimeTest({ root: history.projectRoot }, () => new GoalPhaseRuntime({ args, authorization, executor: { async execute(context) {
      completedCalls++;
      if (completedCalls > 1) return { status: 'waiting', phase: context.phase, details: detail, exitCode: 0, stdout: '', stderr: '', command: 'unknown-content-waiting' };
      return { status: 'passed', phase: context.phase, exitCode: 1, completion_observed: true,
        kill_attempted: true, stdout: '', stderr: '', command: 'completed-with-cleanup-exit' };
    } } }).run());
    assert.equal(completedCalls, 2, 'native completion does not manufacture a complete design/Q baseline');
    const completed = events(history.runDir).find(row => row.type === 'agent_invoke_end');
    assert(completed?.completion_observed === true && completed.exit_code === 1 && completed.status === 'passed', 'cleanup exit1 must retain the actual native completion fact');
    assert(!events(history.runDir).some(row => row.halt_reason === 'no_progress_guard' || row.type === 'run_end' && row.status === 'COMPLETED'));
    let waitingCalls = 0;
    await withRuntimeTest({ root: history.projectRoot }, () => new GoalPhaseRuntime({ args: [...args, '--force-resume'], authorization, executor: { async execute(context) {
      waitingCalls++; return { status: 'waiting', phase: context.phase, details: detail, exitCode: 0, stdout: '', stderr: '', command: 'later-waiting' };
    } } }).run());
    assert.equal(waitingCalls, 1);
    const beforeOrdinary = readOriginalDeliveryActivity(history.projectRoot, history.manifest)!.calls;
    const ordinary = await runGoalModeSessionStep(history.options) as Json;
    assert.equal(ordinary.type, 'goal_session_result', JSON.stringify(ordinary));
    assert.equal(ordinary.result.status, 'waiting', 'an unchanged unknown-content waiting result is not completed content or new work');
    assert.equal(readOriginalDeliveryActivity(history.projectRoot, history.manifest)!.calls, beforeOrdinary,
      'ordinary re-entry cannot buy another actor for the same waiting condition');
    const resumed = await runGoalModeSessionStep({ ...history.options, forceTakeover: true }) as Json;
    assert.equal(resumed.type, 'phase_execute_request', 'the latest waiting fact makes the content baseline unknown; do not skip it to reuse older completed content');
    assert.equal(readOriginalDeliveryActivity(history.projectRoot, history.manifest)!.calls, 4);
    assert.equal(events(history.runDir).filter(row => row.type === 'agent_invoke_start').length, 4);

  } catch (error) {
    const saved = preserveRuntimeTestEvidence(projectRoots, String(error));
    throw new Error(`${(error as Error).stack ?? String(error)}\noriginals: ${saved}`);
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
    await withRuntimeTest({ root: projectRoot }, () => new GoalPhaseRuntime({ args: ['--feature', prepared.manifest.feature, '--resume', prepared.manifest.run_id,
      '--project-root', projectRoot, '--framework-root', frameworkRoot, '--foreground-ok'], authorization,
      executor: { async execute(context) {
        calls++;
        if (calls > 1) return { status: 'waiting', phase: context.phase, details: detail, exitCode: 0, stdout: '', stderr: '', command: 'safe-test-cut' };
        return { status: 'passed', phase: context.phase, exitCode: 0, completion_observed: true, stdout: '', stderr: '', command: kind,
          ...(kind === 'timeout' ? { timed_out: true } : kind === 'terminal-failure' ? { terminal_failure_observed: true }
            : { spawn_error: { code: 'EPIPE', message: 'transport could not deliver the request' } }) };
      } } }).run());
    assert(!events(prepared.runDir).some(row => row.halt_reason === 'no_progress_guard'), `${kind} must not become completed content even with exit0/completion=true`);
    assert.equal(calls, kind === 'transport' ? 1 : 2, 'failed content does not prevent the next real responsibility from being attempted');
    const options = { projectRoot, frameworkRoot, feature: prepared.manifest.feature, runId: prepared.manifest.run_id,
      adapter: 'claude', runMode: 'attended' as const, authorization };
    const next = await runGoalModeSessionStep(options) as Json;
    if (kind === 'transport') {
      assert.equal(next.type, 'phase_execute_request');
    } else {
      assert.equal(next.type, 'goal_session_result');
      assert.equal(next.result.status, 'waiting', 'the later explicit waiting result remains unknown content');
      assert.equal(readOriginalDeliveryActivity(projectRoot, prepared.manifest)!.calls, calls, 'ordinary reentry cannot buy another actor for unchanged waiting');
      const resumed = await runGoalModeSessionStep({ ...options, forceTakeover: true }) as Json;
      assert.equal(resumed.type, 'phase_execute_request', 'an explicit continuation retries unknown content instead of borrowing the older failed completion');
    }
    assert.equal(readOriginalDeliveryActivity(projectRoot, prepared.manifest)!.calls, calls + 1);
  } finally { fs.rmSync(projectRoot, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

async function repairWaiting(): Promise<void> {
  await withFreshCuHost(async host => {
    seedLedgerQuestioningInput(host.root);
    for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
      if (unit.changeUnit.change_unit_id !== 'ledger-refresh') fs.rmSync(path.dirname(unit.canonicalPath), { recursive: true, force: true });
    }
    const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
    let original = fs.readFileSync(canonical.canonicalPath);
    const unit = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
    // This protocol fixture begins before construction input preparation; discard the
    // scaffold's older scope candidate instead of presenting it as current design evidence.
    fs.rmSync(path.join(path.dirname(unit.canonicalPath), 'feature.yaml'), { force: true });
    const approved: Json = YAML.parse(fs.readFileSync(unit.canonicalPath, 'utf8'));
    const defective = structuredClone(approved);
    defective.design_refs = defective.design_refs.filter((ref: Json) => ref.target.view_id !== 'development');
    defective.target_predicates[0].desc = '';
    fs.writeFileSync(unit.canonicalPath, YAML.stringify(defective));
    const manifest = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'waiting-repair-root', adapter: 'claude',
      requirement: '补齐账目刷新缺少的已有设计引用并完整交付，不改变产品范围。', budget: { max_total_turns: 8, wall_clock_minutes: 120 },
      unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 },
      initial_design: { completion_target: 'feature', requested_results: ['完整交付'], requested_phases: ['plan', 'coding', 'review', 'ut'] } }, { projectRoot: host.root });
    createGoalRun({ projectRoot: host.root, manifest, chain: [] });
    const runDir = path.join(host.root, manifest.report_dir);
    const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID, runId: manifest.run_id,
      adapter: 'claude', runMode: 'attended' as const, authorization };
    try {
    assert(!deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready, 'the actual current CU still needs its approved business description and reference closure');
    let first = await runGoalModeSessionStep(options) as Json;
    let questions = 0;
    if (first.phase === 'initial-design-questioning') {
      first = await reportFixtureQuestioning(options, first, runDir, canonical.canonicalPath) as Json;
      questions++;
      const admitted = fs.readFileSync(canonical.canonicalPath);
      assert.deepEqual(blueprintAuthorContent(YAML.parse(admitted.toString('utf8'))), blueprintAuthorContent(YAML.parse(original.toString('utf8'))),
        'the legitimate initial Q may update machine admission, never the approved design business content');
      assert.equal(YAML.parse(admitted.toString('utf8')).revision, canonical.blueprint.revision, 'initial Q cannot publish a design revision');
      original = admitted;
    }
    assert.equal(first.phase, 'design-repair-author', JSON.stringify(first));
    const pause = await runGoalModeSessionStep({ ...options, requestPath: first.request.path,
      report: { status: 'waiting', phase: first.phase, details: detail } }) as Json;
    assert.equal(pause.type, 'goal_session_result', JSON.stringify({ type: pause.type, phase: pause.phase,
      invoke: first.invoke_id, events: events(runDir).filter(row => ['agent_invoke_start', 'agent_invoke_end', 'run_end', 'design_authority_repair'].includes(row.type)) }));
    assert.equal(pause.result.status, 'waiting');
    assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, 1 + questions);
    assert(fs.existsSync(path.join(runDir, 'design-repair/component-blueprint.yaml')));
    assert(!events(runDir).some(row => row.type === 'design_authority_repair' && row.stage === 'failed'));
    const unchanged = await runGoalModeSessionStep(options) as Json;
    assert.equal(unchanged.type, 'goal_session_result', 'ordinary next preserves the original waiting condition');
    assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, 1 + questions);
    const retry = await runGoalModeSessionStep({ ...options, forceTakeover: true }) as Json;
    assert.equal(retry.phase, 'design-repair-author');
    assert.notEqual(retry.attempt_id, first.attempt_id);
    const savedNode = structuredClone(resolveBlueprintTarget(canonical.blueprint, { kind: 'node', view_id: 'logical', id: 'ledger-domain' }));
    const adapter = repairAdapter(host, () => savedNode as Json, { author: (_doc, draft) => {
      const file = path.join(path.dirname(draft), 'change-unit.yaml');
      const candidate: Json = YAML.parse(fs.readFileSync(file, 'utf8'));
      candidate.target_predicates = structuredClone(approved.target_predicates);
      candidate.design_refs = approved.design_refs.map((ref: Json) => ({ ...candidate.component_blueprint_ref, target: structuredClone(ref.target) }));
      fs.writeFileSync(file, YAML.stringify(candidate));
    } });
    const request = JSON.parse(fs.readFileSync(retry.request.path, 'utf8'));
    await adapter.onOutOfChain({ phase: retry.phase, prompt: request.context.instruction, attempt: 1, runId: manifest.run_id });
    const questioning = await runGoalModeSessionStep({ ...options, requestPath: retry.request.path,
      report: { status: 'passed', phase: retry.phase, details: '完成当前责任草稿' } }) as Json;
    assert.equal(questioning.phase, 'design-repair-questioning');
    const qPause = await runGoalModeSessionStep({ ...options, requestPath: questioning.request.path,
      report: { status: 'waiting', phase: questioning.phase, details: detail } }) as Json;
    assert.equal(qPause.result.status, 'waiting');
    assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, 3 + questions);
    const unchangedQuestion = await runGoalModeSessionStep(options) as Json;
    assert.equal(unchangedQuestion.type, 'goal_session_result', 'ordinary next cannot buy another unchanged waiting Q');
    assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, 3 + questions);
    const qRetry = await runGoalModeSessionStep({ ...options, forceTakeover: true }) as Json;
    assert.equal(qRetry.phase, 'design-repair-questioning');
    assert.notEqual(qRetry.attempt_id, questioning.attempt_id);
    assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, 4 + questions);
    assert.equal(events(runDir).filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
    assert(!events(runDir).some(row => row.type === 'design_authority_repair' && row.stage === 'failed'));
    assert.deepEqual(fs.readFileSync(canonical.canonicalPath), original, 'waiting never publishes a partial draft');
    const qRequest = JSON.parse(fs.readFileSync(qRetry.request.path, 'utf8'));
    const actual = await adapter.onOutOfChain({ phase: qRetry.phase, prompt: qRequest.context.instruction, attempt: 1, runId: manifest.run_id });
    assert(typeof actual?.details === 'string', 'independent questioning must return its actual JSON result');
    await runGoalModeSessionStep({ ...options, requestPath: qRetry.request.path,
      report: { status: 'passed', phase: qRetry.phase, details: actual!.details } });
    const after = events(runDir);
    assert.equal(after.filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
    assert(!after.some(row => row.type === 'design_authority_repair' && row.stage === 'failed'));
    assert(after.some(row => row.type === 'design_authority_repair' && row.stage === 'published' && row.outcome === 'recovered'));
    assert.equal(after.filter(row => row.type === 'agent_invoke_start' && row.phase === 'design-repair-author').length, 2, 'completed author is reused after questioning resumes');
    assert.equal(loadCanonicalBlueprint(host.root, BLUEPRINT_ID).blueprint.revision, Number(canonical.blueprint.revision) + 1);
    assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready);
    assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, after.filter(row => row.type === 'agent_invoke_start').length);
    } catch (error) {
      const originals = [canonical.canonicalPath, unit.canonicalPath, ...['component-blueprint.yaml', 'change-unit.yaml', 'architecture.json']
        .map(file => path.join(runDir, 'design-repair', file))];
      for (const row of events(runDir).filter(event => typeof event.handoff_request?.path === 'string').slice(-2)) {
        originals.push(path.resolve(runDir, row.handoff_request.path));
      }
      const saved = preserveRuntimeTestEvidence([host.root], String(error), [], originals);
      throw new Error(`${(error as Error).stack ?? String(error)}\noriginals: ${saved}`);
    }
  });
}

async function normalQuestioningWaiting(): Promise<void> {
  await withFreshCuHost(async host => {
    try {
    let authors = 0, questioners = 0;
    const invokeFacts = (source: Json[]) => source.filter(row => row.type === 'agent_invoke_start' || row.type === 'agent_invoke_end')
      .map(row => ({ type: row.type, phase: row.phase, invoke_id: row.invoke_id, status: row.status, exit_code: row.exit_code,
        completion_observed: row.completion_observed, timed_out: row.timed_out, interrupted: row.interrupted,
        terminal_failure_observed: row.terminal_failure_observed }));
    const first = await s16Born(host, { adapter: {
      author: () => { authors++; },
      questioning: doc => { questioners++; delete doc.review_summary.questioning;
        return { status: 'waiting', exitCode: 0, details: detail }; },
    } });
    const beforeManifest = JSON.parse(fs.readFileSync(featureFilePath(host.root, first.feature, `goal-runs/${first.runId}/manifest.json`), 'utf8'));
    console.log('[normal-questioning-waiting-before]', JSON.stringify({ authors, questioners, chain: first.chain,
      scope_chain: beforeManifest.execution_scope?.phase_chain, phase_chain: beforeManifest.phase_chain,
      invocations: invokeFacts(first.events), attempts: first.events.filter(row => row.type === 'design_authority_repair') }));
    assert.equal(authors, 1, JSON.stringify({ authors, questioners, events: first.events.filter(row => ['phase_halt', 'run_end', 'design_authority_repair'].includes(row.type)) }));
    assert.equal(questioners, 1);
    assert(!first.events.some(event => event.type === 'design_authority_repair' && event.stage === 'failed'));
    assert(!first.events.some(event => event.type === 'design_authority_repair' && event.stage === 'published'));
    const rawActor = repairAdapter(host, () => first.saved, { author: () => { authors++; }, questioning: () => { questioners++; } });
    const p = project(host, first.feature);
    const hooks = specFirstCuHooks(p, true);
    const resumed = await runGoalRuntimeChain(host.root, { frameworkRoot: host.frameworkRoot, featureId: first.feature, adapter: 'codex',
      resume: first.runId, forceResume: true, noAutoForce: true, ...hooks,
      realHarness: false, onAuthor: () => {},
      onHarnessFailureWithoutSummary: () => '本例当前施工工具不可用；保留已真实完成的设计事务，工具恢复后继续原施工请求。',
      onOutOfChain: rawActor.onOutOfChain });
    assert(!resumed.events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'), 'a downstream author wait cannot complete the business delivery');
    const directory = featureFilePath(host.root, first.feature, 'goal-runs');
    const rows = fs.readdirSync(directory).filter(name => !name.startsWith('.')).flatMap(name => events(path.join(directory, name)));
    const repairs = rows.filter(row => row.type === 'design_authority_repair');
    console.log('[normal-questioning-waiting]', JSON.stringify({ authors, questioners, repairs,
      before: { chain: first.chain, invocations: invokeFacts(first.events) }, resumed: { invocations: invokeFacts(rows),
        resumes: rows.filter(row => row.type === 'resume') },
      ends: rows.filter(row => row.type === 'run_end').map(row => ({ status: row.status, halt_reason: row.halt_reason })) }));
    assert.equal(authors, 1, 'a successful design author must not be invoked again while recovering its waiting questioner');
    assert.equal(questioners, 2, 'only the waiting independent responsibility is called again: '
      + JSON.stringify(rows.filter(row => ['phase_halt', 'run_end'].includes(row.type)).slice(-5)));
    assert.equal(repairs.filter(row => row.stage === 'attempted').length, 1);
    assert(!repairs.some(row => row.stage === 'failed'));
    assert(repairs.some(row => row.stage === 'published' && row.outcome === 'recovered'), 'the original machine validation/publication/reconcile must really finish');
    const published = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
    assert.equal(published.blueprint.revision, first.baseRevision + 1);
    const current = asChangeUnitArtifact(loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh').changeUnit);
    assert.equal(current.component_blueprint_ref.artifact_sha256, published.artifactSha256, 'the real CU must be rebound to this publication');
    // The normal construction unit intentionally remains waiting for its executor, so
    // global P2 readiness is not the terminal predicate of this transaction test.
    } catch (error) {
      const saved = preserveRuntimeTestEvidence([host.root], String(error));
      throw new Error(`${(error as Error).stack ?? String(error)}\noriginals: ${saved}`);
    }
  });
}

const cases = [
  { name: 'f3b8e6a1 waiting: original session and executor pause once then a later entry can continue', run: initialWaiting },
  { name: '77105c47 waiting author can hand back a real blueprint and let independent questioning proceed', run: waitingAuthorLeavesQuestioningReady },
  ...(['timeout', 'terminal-failure', 'transport'] as const).map(kind => ({ name: `d18f6c42 ${kind} invocation cannot establish a completed-content no-progress baseline`, run: () => unfinishedContentBaseline(kind) })),
  { name: 'f3b8e6a1 waiting: design author and independent questioning keep one open transaction across waiting', run: repairWaiting },
  { name: 'f3b8e6a1 waiting: normal questioning resumes its original transaction without replaying a successful author', run: normalQuestioningWaiting },
];
export function getCases() { return cases; }
const dailyPrefixes = [
  "77105c47 waiting author",
  "d18f6c42 timeout invocation",
  "d18f6c42 terminal-failure invocation",
  "d18f6c42 transport invocation"
];
export const listCaseGroups = () => unitCaseGroups(cases.map(test => test.name)).map(group => ({ ...group,
  releaseOnly: !group.caseNames.some(name => dailyPrefixes.some(prefix => name.startsWith(prefix))) }));
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
