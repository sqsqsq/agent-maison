import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir } from '../../config';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { handWriteProjections } from './component-design-handoff.unit.test';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { checkAuthoritativeContentAligned, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { writeRunSummaryBase } from '../../harness-runner';
import { resolvePhaseEvidenceManifest, writePhaseEvidenceManifest, loadPhaseEvidenceManifest, verifyPhaseEvidenceManifestWithStagedOutputs } from '../../scripts/utils/phase-evidence-manifest';
import { readReusableCheckResult, readCurrentDispositionInput, currentCompletionEvaluation, completedCheckResultsFromToolEvents } from '../../scripts/utils/verify-feature-completion';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { ensureRunControl, casAcquireRunOwner } from '../../scripts/utils/goal-run-control';
import { issueSessionExecution, writePhaseExecutionRequestMaterial, observeSessionExecution, sessionEvents, acceptedSessionReport } from '../../scripts/utils/session-execution-handoff';
import { resolvePhaseWriteBoundary, capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, classifyPhaseInvocationChanges } from '../../scripts/utils/phase-write-boundary';
import { GoalPhaseRuntime, bindGuardianOrKill } from '../../scripts/goal-phase-runtime';
import { DetachedGoalPhaseExecutor, createWorkUnitExecutionContext, observeWorkUnitProviderSession, type WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import * as agentInvoke from '../../scripts/utils/agent-invoke';
import { invocationEndFacts } from '../../scripts/utils/invocation-completion';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import { installReplayTransport, type ReplayInput } from '../helpers/completion-replay-transport';
import { withRuntimeTest } from '../utils/runtime-test-control';
import { defaultProcessProbe } from '../../scripts/utils/device-session';

const SOURCE_HARNESS = path.resolve(__dirname, '../..');

/** Real check/writer/manifest/reader chain; both the child and runtime read these same published facts. */
export function produceCheck(input: ReplayInput) {
  clearFrameworkConfigCache();
  const feature = SNAPSHOT_CU_FEATURE, phase = 'spec';
  const ctx = { projectRoot: input.root, frameworkRoot: input.frameworkRoot, feature, phase, phaseRule: {},
    featureSpec: new SpecLoader(input.root, undefined, undefined, input.frameworkRoot).loadFeatureSpec(feature) } as CheckContext;
  const checks = checkAuthoritativeContentAligned(ctx, 'acceptance');
  assert.equal(checks.length, 1, 'the fixture must reach the real authoritative acceptance checker');
  const report = generateScriptReport(SOURCE_HARNESS, phase, feature, input.root, checks, input.frameworkRoot);
  writeRunSummaryBase(input.root, report, input.frameworkRoot);
  const dir = featurePhaseReportsDir(input.root, feature, phase, input.frameworkRoot);
  writePhaseEvidenceManifest(input.root, resolvePhaseEvidenceManifest({ projectRoot: input.root, frameworkRoot: input.frameworkRoot,
    feature, phase, requirementSha: computeRunRequirementSha(input.root, feature, input.runId),
    extraInputs: deriveBlueprintSkillInput(input.root, feature, input.frameworkRoot, 'acceptance').dependencies.map(dependency => dependency.path),
    extraOutputs: ['script-report.json', 'summary.json'].map(name => path.join(dir, name)) }));
  const result = readReusableCheckResult({ projectRoot: input.root, frameworkRoot: input.frameworkRoot, feature, phase, runId: input.runId });
  assert(result, JSON.stringify({ reason: 'the actual newly published report must be readable under its existing evidence manifest',
    freshness: verifyPhaseEvidenceManifestWithStagedOutputs({ projectRoot: input.root, frameworkRoot: input.frameworkRoot, feature, phase, runId: input.runId, stagedOutputs: [] }),
    current_dependencies: deriveBlueprintSkillInput(input.root, feature, input.frameworkRoot, 'acceptance').dependencies.map(dependency => dependency.path),
    bound_inputs: loadPhaseEvidenceManifest(input.root, feature, phase)?.manifest.inputs.map(entry => entry.path) }));
  const options = { projectRoot: input.root, frameworkRoot: input.frameworkRoot, feature, chain: [phase], runId: input.runId,
    endpoint: 'request' as const, currentResults: [result] };
  const disposition = resolveCurrentDisposition(readCurrentDispositionInput(options));
  return { phase, evaluation: currentCompletionEvaluation(options, disposition) };
}

/** Controlled Node author, not model evidence: actual modifications and checks precede every native tool envelope. */
export async function replayAuthor(configFile: string): Promise<void> {
  const input = JSON.parse(fs.readFileSync(configFile, 'utf8')) as ReplayInput;
  const file = featureFilePath(input.root, SNAPSHOT_CU_FEATURE, 'acceptance.yaml');
  const original = YAML.parse(fs.readFileSync(file, 'utf8'));
  for (let round = 0; round < 3; round++) {
    const doc = structuredClone(original);
    if (input.mode === 'stalled') doc.criteria[0].id = round === 2 ? 'renamed-2' : 'renamed-1';
    else if (round === 0) doc.criteria[0].description = 'incorrect candidate description';
    else if (round === 1) doc.criteria[0].priority = original.criteria[0].priority === 'P2' ? 'P1' : 'P2';
    fs.writeFileSync(file, YAML.stringify(doc));
    const completed = produceCheck(input);
    fs.appendFileSync(path.join(input.stateDir, 'actual-checks.jsonl'), JSON.stringify(completed) + '\n');
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'actual authoritative acceptance check',
      exit_code: completed.evaluation.disposition.completionEligible ? 0 : 1, aggregated_output: 'current_check_result=' + JSON.stringify(completed) } }) + '\n');
    fs.writeFileSync(path.join(input.stateDir, `round-${round + 1}-written`), String(process.pid));
    if (round < 2) {
      const until = Date.now() + 5_000;
      while (!fs.existsSync(path.join(input.stateDir, `round-${round + 1}-observed`)) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
      if (!fs.existsSync(path.join(input.stateDir, `round-${round + 1}-observed`))) throw new Error('the actual tool result never reached the runtime observation callback');
    }
  }
  if (input.mode === 'improved') {
    fs.writeFileSync(path.join(input.stateDir, 'natural-completion'), 'all actual stages finished');
    process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n');
  } else setInterval(() => fs.writeFileSync(path.join(input.stateDir, 'still-alive'), String(Date.now())), 100);
}

function fixture(mode: ReplayInput['mode'], ownerKind: 'process' | 'session') {
  const host = loadHostSnapshot(); clearFrameworkConfigCache(); handWriteProjections(host.root);
  const feature = SNAPSHOT_CU_FEATURE, runId = `running-${mode}-${ownerKind}`;
  const manifest = buildGoalManifestFromInput({ feature, run_id: runId, adapter: 'codex', start_phase: 'spec', end_phase: 'spec',
    requirement: '核验已批准账本验收候选；原canonical设计和验收不变。', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: host.root });
  createGoalRun({ manifest, projectRoot: host.root, chain: ['spec'] });
  const runDir = path.join(host.root, manifest.report_dir), stateDir = path.join(host.root, 'controlled-author'); fs.mkdirSync(stateDir);
  const input: ReplayInput = { root: host.root, frameworkRoot: host.frameworkRoot, runId, stateDir, mode };
  const configFile = path.join(stateDir, 'fixture.json'); fs.writeFileSync(configFile, JSON.stringify(input));
  ensureRunControl(runDir, runId);
  const acquired = casAcquireRunOwner(runDir, runId, 0, { kind: ownerKind, owner_id: 'actual-running-owner', lease_ms: 60_000 });
  assert(acquired.ok); if (!acquired.ok) throw new Error('cannot acquire the actual fixture fence');
  const context = createWorkUnitExecutionContext({ runId, feature, workflowId: 'obligation-driven', track: 'full', chain: ['spec'], phase: 'spec', attemptId: 'author-one',
    owner: { ...acquired.token, kind: ownerKind }, projectRoot: host.root, frameworkRoot: host.frameworkRoot, runDir, reportDir: manifest.report_dir,
    adapter: 'codex', authority: { write_mode: 'full-access', approval_mode: 'never' }, instruction: '修复当前实际验收差额，读取每次真实检查反馈；不得改canonical原验收。',
    childEnv: { MAISON_GOAL_RUN_ID: runId }, runtimeFacts: { receiptRequired: true, resume: false, successor: false } });
  const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  const boundary = resolvePhaseWriteBoundary({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, runId, executionRole: 'author',
    phaseOrder: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], track: 'full', productLayerDirs: ['02-Feature', 'src'], profileDir: path.join(host.frameworkRoot, 'profiles/test-chain') });
  const invokeId = 'spec-author-one'; emit({ type: 'agent_invoke_start', phase: 'spec', invoke_id: invokeId, owner_id: acquired.token.owner_id, owner_epoch: acquired.token.epoch });
  const requestInput = { context, invokeId, preSnapshot: capturePhaseInvocationSnapshot(boundary), writeBoundary: boundary, gateTimeoutMs: 30_000, cleanupReserveMs: 500 };
  const issued = ownerKind === 'session' ? issueSessionExecution({ ...requestInput, emit })
    : { ...writePhaseExecutionRequestMaterial({ ...requestInput, issuedAt: new Date().toISOString() }), event: { type: 'agent_invoke_start', phase: 'spec', invoke_id: invokeId } };
  return { ...host, input, configFile, context, runDir, stateDir, emit, issued, invokeId, boundary };
}

async function runDetached(mode: ReplayInput['mode']) {
    const f = fixture(mode, 'process'); let undo = () => {};
    const controller = new AbortController();
    try {
      undo = installReplayTransport(f.configFile);
      const directory = path.join(f.runDir, path.dirname(f.issued.reference.path));
      const result = await withRuntimeTest({ root: f.root, timeoutMs: 120_000 }, () => new GoalPhaseRuntime().executeExecutor(f.context, new DetachedGoalPhaseExecutor(() => ({
        plan: { argv: [process.execPath, '-e', 'throw Error("the unreplaced transport must never run")'], adapterName: 'terminal-replay-fixture', label: 'replaced transport only' }, cwd: f.root,
        options: { outputLogPath: path.join(directory, 'agent-output.log'), toolEventCapture: 'structured_events',
          ...(process.platform === 'win32' ? { containment: { runId: f.input.runId, invokeId: f.invokeId } } : {}),
          onActiveChild: ({ pid }) => {
            const bound = bindGuardianOrKill(pid, `${f.input.runId}/${f.invokeId}`); assert(bound.ok, JSON.stringify(bound));
            if (bound.ok) f.emit({ type: 'agent_process_bound', phase: 'spec', invoke_id: f.invokeId, pid, started_at_ms: bound.identity.startedAtMs,
              executable: bound.identity.executable, token: `${f.input.runId}/${f.invokeId}` });
          } } })), { signal: controller.signal, cancel: reason => controller.abort(reason) }));
      f.emit({ type: 'agent_process_settled', phase: 'spec', invoke_id: f.invokeId, status: result.status, ...invocationEndFacts(result) });
      f.emit({ type: 'agent_invoke_end', phase: 'spec', invoke_id: f.invokeId, status: result.status, details: result.details, ...invocationEndFacts(result) });
      const rounds = fs.existsSync(path.join(f.stateDir, 'actual-checks.jsonl')) ? fs.readFileSync(path.join(f.stateDir, 'actual-checks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
      const diagnostics = { result, rounds, manifest: loadPhaseEvidenceManifest(f.root, f.context.feature, 'spec'), events: sessionEvents(f.runDir) };
      assert.equal(rounds.length, 3, JSON.stringify(diagnostics));
      assert(rounds.every(round => round.evaluation.completed), JSON.stringify(diagnostics));
      if (mode === 'stalled') {
        assert(result.interrupted && result.kill_attempted && !result.completion_observed, JSON.stringify(diagnostics));
        assert(result.details?.startsWith('no_progress_guard:'), JSON.stringify(diagnostics));
        assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'phase_halt' && event.halt_reason === 'no_progress_guard').length, 1);
        assert(fs.readFileSync(featureFilePath(f.root, f.context.feature, 'acceptance.yaml'), 'utf8').includes('renamed-2'), 'legitimate partial work survives the real stop');
        assert(!fs.existsSync(path.join(f.stateDir, 'natural-completion')));
      } else {
        assert.equal(result.status, 'passed', JSON.stringify(diagnostics));
        assert.equal(result.completion_observed, true, JSON.stringify(diagnostics));
        assert(!result.interrupted && !sessionEvents(f.runDir).some(event => event.halt_reason === 'no_progress_guard'), JSON.stringify(diagnostics));
        assertActualReplacement(rounds);
      }
      const view = observeSessionExecution(f.runDir, f.issued);
      assert(view.settled && (mode === 'improved' || view.changes?.kind === 'changed') && !view.writes?.violations.length,
        JSON.stringify({ settled: view.settled, changes: view.changes, writes: view.writes }));
      assert.equal(completedCheckResultsFromToolEvents('codex', view.toolEvents, true).length, 3, 'the original native stream preserves all actual check outputs');
      const input = { ...f.context, attemptId: 'author-two' };
      const recovered = observeWorkUnitProviderSession(input);
      assert(!('status' in recovered), 'the actual stopped invocation must be recoverable');
      const resumed = createWorkUnitExecutionContext(input, recovered);
      assert.equal(resumed.attemptId, 'author-two'); assert.equal(resumed.provider_session_id, undefined);
      assert(resumed.instruction?.includes('不等于无损恢复'), 'without a native ID the original facts rebuild context, never guess a private session');
      if (mode === 'improved') {
        const pre = capturePhaseInvocationSnapshot(f.boundary);
        const file = path.join(f.frameworkRoot, 'README.md');
        const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
        fs.writeFileSync(file, 'controlled out-of-authority framework write');
        try {
          const changes = diffPhaseInvocationSnapshots(pre, capturePhaseInvocationSnapshot(f.boundary));
          assert.equal(changes.kind, 'changed');
          if (changes.kind !== 'changed') return;
          const classified = classifyPhaseInvocationChanges(f.boundary, 'spec', changes.changes);
          assert(classified.violations.some(row => row.path === 'framework/README.md' && row.violation === 'outside_authority'));
          f.emit({ type: 'phase_write_violation', phase: 'spec', invoke_id: f.invokeId,
            violations: classified.violations.map(row => ({ path: row.path, violation: row.violation, pre_sha256: row.preSha256, post_sha256: row.postSha256 })) });
          for (let reread = 0; reread < 2; reread++) {
            const current = produceCheck(f.input);
            assert(current.evaluation.disposition.completionBlocking.some(problem => problem.phase === 'scope' && problem.id === 'phase_write_violation'),
              'current raw PASS or repeated effective result cannot wash an unrecovered P1 authorization violation');
          }
        } finally { if (original) fs.writeFileSync(file, original); else fs.unlinkSync(file); }
      }
    } finally { undo(); clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
}

function assertActualReplacement(rounds: any[]) {
  const repairs = rounds.map(round => round.evaluation.disposition.completionBlocking.filter((problem: any) => problem.action === 'repair'));
  assert.equal(repairs[0].length, repairs[1].length, 'a total does not identify actual improvement');
  assert.notDeepEqual(repairs[0].flatMap((problem: any) => problem.evidence), repairs[1].flatMap((problem: any) => problem.evidence), 'the real producer must expose distinct canonical field objects');
  assert.equal(repairs[2].length, 0, JSON.stringify(rounds));
}

async function runPublic(mode: ReplayInput['mode']) {
    const f = fixture(mode, 'session');
    let child: ReturnType<typeof spawn> | undefined;
    let stdout = '', stderr = '';
    try {
      const preload = path.join(f.stateDir, 'replace-transport.cjs');
      fs.writeFileSync(preload, `require(${JSON.stringify(path.resolve(__dirname, '../helpers/completion-replay-transport.ts'))}).installReplayTransport(${JSON.stringify(f.configFile)});\n`);
      const args = ['-r', require.resolve('ts-node/register/transpile-only'), '-r', preload, path.join(SOURCE_HARNESS, 'scripts/goal-mode-entry.ts'),
        '--feature', f.context.feature, '--run-id', f.input.runId, '--adapter', 'codex', '--run-mode', 'attended',
        '--project-root', f.root, '--framework-root', f.frameworkRoot, '--request', path.resolve(f.runDir, f.issued.reference.path), '--execute-request'];
      const execution = await withRuntimeTest({ root: f.root, timeoutMs: 120_000 }, () => {
        child = spawn(process.execPath, args, { cwd: SOURCE_HARNESS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, TS_NODE_PROJECT: path.join(SOURCE_HARNESS, 'tsconfig.json') } });
        child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
        return new Promise<{ status: number | null; signal: NodeJS.Signals | null; pid: number | undefined; stdout: string }>((resolve, reject) => {
          child!.once('close', (status, signal) => resolve({ status, signal, pid: child?.pid, stdout })); child!.once('error', reject);
        });
      });
      const code = execution.status;
      const rounds = fs.existsSync(path.join(f.stateDir, 'actual-checks.jsonl')) ? fs.readFileSync(path.join(f.stateDir, 'actual-checks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
      const diagnostics = JSON.stringify({ code, stdout, stderr, rounds, events: sessionEvents(f.runDir) });
      assert.equal(code, 0, diagnostics);
      assert.equal(rounds.length, 3, diagnostics);
      assert(rounds.every(round => round.evaluation.completed), diagnostics);
      const accepted = acceptedSessionReport(f.runDir, f.issued);
      if (mode === 'improved') {
        assertActualReplacement(rounds);
        assert(!sessionEvents(f.runDir).some(event => event.type === 'phase_halt' && event.halt_reason === 'no_progress_guard'), diagnostics);
        assert(fs.existsSync(path.join(f.stateDir, 'natural-completion')), diagnostics);
        assert.equal(accepted?.report.status, 'passed', diagnostics);
        assert.equal(accepted?.event.completion_observed, true, diagnostics);
        assert.equal(accepted?.event.interrupted, undefined, diagnostics);
      } else {
        assert.equal(accepted?.report.status, 'waiting', diagnostics);
        assert.equal(accepted?.event.interrupted, true, diagnostics);
        assert(!accepted?.event.completion_observed && !fs.existsSync(path.join(f.stateDir, 'natural-completion')), diagnostics);
        assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'phase_halt' && event.halt_reason === 'no_progress_guard').length, 1, diagnostics);
        assert(accepted?.report.details?.startsWith('no_progress_guard:'), diagnostics);
        assert(fs.readFileSync(featureFilePath(f.root, f.context.feature, 'acceptance.yaml'), 'utf8').includes('renamed-2'), diagnostics);
      }
      const plans = fs.readFileSync(path.join(f.stateDir, 'transport-plans.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(plans.length, 1, 'the public CLI starts exactly one controlled transport');
      assert.equal(plans[0].adapter, 'codex', 'the public request retains the real declared adapter before transport substitution');
      assert.equal(plans[0].executed_argv[0], process.execPath, 'only the controlled Node process may execute');
      assert(!plans[0].executed_argv.includes('--sandbox') && !plans[0].executed_argv.includes('exec'), 'Node is not masquerading as a model CLI');
      const observation = observeSessionExecution(f.runDir, f.issued);
      assert.equal(completedCheckResultsFromToolEvents('codex', observation.toolEvents, true).length, 3, diagnostics);
      assert(!observation.writes?.violations.length, JSON.stringify(observation.writes));
    } finally {
      if (child?.pid && child.exitCode === null && child.signalCode === null) await agentInvoke.killProcessTree(child.pid);
      clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true });
    }
}

async function runPublicOutputIdle(active: boolean) {
  const f = fixture('improved', 'session');
  let child: ReturnType<typeof spawn> | undefined;
  let stdout = '', stderr = '';
  const idleMs = 12_000;
  try {
    const actor = path.join(f.stateDir, 'idle-author.cjs');
    const partialFile = featureFilePath(f.root, f.context.feature, 'spec/notes.md');
    const args = ['-r', require.resolve('ts-node/register/transpile-only'), path.join(SOURCE_HARNESS, 'harness-runner.ts'),
      '--project-root', f.root, '--framework-root', f.frameworkRoot, '--feature', f.context.feature, '--phase', 'spec', '--summary'];
    fs.writeFileSync(actor, `const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const state=${JSON.stringify(f.stateDir)};
const command=${JSON.stringify(args)};
process.stdout.write(JSON.stringify({type:'item.started',item:{type:'command_execution',command:command.join(' ')}})+'\\n');
const tool=spawn(process.execPath,command,{cwd:${JSON.stringify(SOURCE_HARNESS)},env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',errors='';
tool.stdout.on('data',chunk=>{output+=chunk;process.stderr.write(chunk);});
tool.stderr.on('data',chunk=>{errors+=chunk;process.stderr.write(chunk);});
tool.on('close',code=>{
 fs.writeFileSync(path.join(state,'actual-selfcheck.json'),JSON.stringify({command,code,stdout:output,stderr:errors}));
 fs.mkdirSync(path.dirname(${JSON.stringify(partialFile)}),{recursive:true});fs.writeFileSync(${JSON.stringify(partialFile)},'actual author partial notes\\n');
 process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:command.join(' '),status:code===0?'completed':'failed',exit_code:code,aggregated_output:output}})+'\\n');
 if(${JSON.stringify(active)}){const timer=setInterval(()=>process.stdout.write('actual native output growth\\n'),200);setTimeout(()=>{clearInterval(timer);fs.writeFileSync(path.join(state,'natural-completion'),'done');process.stdout.write('{"type":"turn.completed"}\\n');},${idleMs + 500});}
 else {const grand=spawn(process.execPath,['-e',"const fs=require('fs');setInterval(()=>fs.writeFileSync("+JSON.stringify(path.join(state,'grandchild-tick'))+",String(Date.now())),25);"],{stdio:'ignore',windowsHide:true});fs.writeFileSync(path.join(state,'grandchild-pid'),String(grand.pid));setInterval(()=>{},1000);}
});
`);
    const preload = path.join(f.stateDir, 'idle-transport.cjs');
    fs.writeFileSync(preload, `const fs=require('fs'),path=require('path');
const api=require(${JSON.stringify(path.join(SOURCE_HARNESS, 'scripts/utils/agent-invoke.ts'))});
api.DEFAULT_AGENT_OUTPUT_IDLE_MS=${idleMs};
const interval=global.setInterval;let beats=0;global.setInterval=(fn,ms,...args)=>interval(ms===30000?()=>{fn(...args);fs.writeFileSync(${JSON.stringify(path.join(f.stateDir, 'framework-heartbeats'))},String(++beats));}:fn,ms===30000?100:ms,...args);
const original=api.invokeAgentHeadless;
api.invokeAgentHeadless=(plan,cwd,options)=>{const argv=[process.execPath,${JSON.stringify(actor)}];fs.writeFileSync(${JSON.stringify(path.join(f.stateDir, 'transport-plan.json'))},JSON.stringify({originalAdapter:plan.adapterName,originalArgv:plan.argv,executedArgv:argv,hasOldTimeout:options.timeoutMs!==undefined}));return original({argv,label:'controlled native output-idle replay; no model CLI',adapterName:'terminal-replay-fixture'},cwd,{...options,terminalEventParser:'codex_turn_jsonl',toolEventCapture:'structured_events'});};
`);
    const command = ['-r', require.resolve('ts-node/register/transpile-only'), '-r', preload, path.join(SOURCE_HARNESS, 'scripts/goal-mode-entry.ts'),
      '--feature', f.context.feature, '--run-id', f.input.runId, '--adapter', 'codex', '--run-mode', 'attended',
      '--project-root', f.root, '--framework-root', f.frameworkRoot, '--request', path.resolve(f.runDir, f.issued.reference.path), '--execute-request'];
    const execution = await withRuntimeTest({ root: f.root, timeoutMs: 120_000 }, () => {
      child = spawn(process.execPath, command, { cwd: SOURCE_HARNESS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TS_NODE_PROJECT: path.join(SOURCE_HARNESS, 'tsconfig.json') } });
      child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
      return new Promise<{ status: number | null; signal: NodeJS.Signals | null; pid: number | undefined; stdout: string }>((resolve, reject) => {
        child!.once('close', (status, signal) => resolve({ status, signal, pid: child?.pid, stdout })); child!.once('error', reject);
      });
    });
    const code = execution.status;
    const accepted = acceptedSessionReport(f.runDir, f.issued);
    const actual = JSON.parse(fs.readFileSync(path.join(f.stateDir, 'actual-selfcheck.json'), 'utf8'));
    const diagnostics = JSON.stringify({ code, accepted, actual, stdout, stderr });
    assert.equal(code, 0, diagnostics);
    assert(actual.stdout.includes('current_check_result=') && actual.command.includes('--summary'), 'the real public self-check must execute its actual checker/reader');
    assert(Number(fs.readFileSync(path.join(f.stateDir, 'framework-heartbeats'), 'utf8')) > 0, 'actual coordinator lease heartbeats ran and did not count as native activity');
    const plan = JSON.parse(fs.readFileSync(path.join(f.stateDir, 'transport-plan.json'), 'utf8'));
    assert.equal(plan.executedArgv[0], process.execPath); assert.equal(plan.originalAdapter, 'codex'); assert.equal(plan.hasOldTimeout, false);
    assert(!plan.executedArgv.includes('--sandbox') && !plan.executedArgv.includes('exec'), 'only neutral Node transport, never a model CLI');
    assert.equal(fs.readFileSync(partialFile, 'utf8'), 'actual author partial notes\n');
    if (active) {
      assert.equal(accepted?.report.status, 'passed', diagnostics);
      assert.equal(accepted?.event.completion_observed, true, diagnostics);
      assert(!accepted?.event.interrupted && fs.existsSync(path.join(f.stateDir, 'natural-completion')), diagnostics);
    } else {
      assert.equal(accepted?.report.status, 'waiting', diagnostics); assert.equal(accepted?.event.interrupted, true, diagnostics);
      assert(!accepted?.event.completion_observed && !fs.existsSync(path.join(f.stateDir, 'natural-completion')), diagnostics);
      const tick = fs.readFileSync(path.join(f.stateDir, 'grandchild-tick'), 'utf8');
      await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal(fs.readFileSync(path.join(f.stateDir, 'grandchild-tick'), 'utf8'), tick, 'the public stop kills the real descendant tree');
      assert(observeSessionExecution(f.runDir, f.issued).settled, 'the original accepted interrupted request remains observable for continuation');
    }
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) await agentInvoke.killProcessTree(child.pid);
    const pidFile = path.join(f.stateDir, 'grandchild-pid');
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert(Number.isSafeInteger(pid) && pid > 0, 'the controlled descendant must have a real PID');
      let running = false;
      try { process.kill(pid, 0); running = true; }
      catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH', String(error)); }
      if (running) {
        const identity = defaultProcessProbe().identify(pid);
        const normalize = (value: string) => value.replace(/\\+/g, '/').toLowerCase();
        assert(identity && normalize(identity.executable) === normalize(process.execPath)
          && normalize(identity.commandLine ?? '').includes(normalize(f.stateDir)), 'refusing to clean a descendant without this fixture identity');
        await agentInvoke.killProcessTree(pid);
        assert.fail('the native descendant survived its expected product stop and required test cleanup');
      }
    }
    clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true });
  }
}

const cases = [
  { name: 'P1 public output-idle protection interrupts a silent native tree after a real self-check despite framework heartbeats', run: () => runPublicOutputIdle(false) },
  { name: 'P1 public output-idle protection keeps active native output running beyond its idle window after a real self-check', run: () => runPublicOutputIdle(true) },
  { name: 'P2 running detached author is truly interrupted after relevant changes repeat the same canonical deficit; unchanged FAIL is reused', run: () => runDetached('stalled') },
  { name: 'P2 running detached author continues after an equal-count real finding replacement and naturally completes', run: () => runDetached('improved') },
  { name: 'P2 public execute-request CLI keeps equal-count real finding replacement running and accepts natural completion', run: () => runPublic('improved') },
  { name: 'P2 public execute-request CLI truly stops a live author with the same unresolved canonical deficit and accepts waiting', run: () => runPublic('stalled') },
];

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases.filter(test => matchesUnitCase(test.name, selector))) {
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
