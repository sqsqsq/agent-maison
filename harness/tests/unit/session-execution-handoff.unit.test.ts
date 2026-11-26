import assert from 'assert';
import { bindControlledProcess, controlledModelBinding, installControlledCodex } from '../utils/controlled-model-process';
import { adapterModelBinding, freezeModelPin, parseAdapterModelBinding } from '../../scripts/utils/adapter-model';
import { deriveDshInvokeUsage } from '../../scripts/utils/usage-capture';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { issueSessionExecution, readSessionExecution, acceptSessionExecution, acceptedSessionReport,
  readHandoffMaterial, sessionValidationOnlyEligibility, sessionEvents, resignSessionExecution,
  sessionRunMaterialPath, sessionReportInputPath, sessionExecutionDeadlineMs,
  observeSessionExecution, interruptSessionExecution, capturePhaseBinding,
  type SessionExecutionReport } from '../../scripts/utils/session-execution-handoff';
import { ensureRunControl, casAcquireRunOwner, readRunControl, releaseRunOwner, markExpiredSessionOrphaned } from '../../scripts/utils/goal-run-control';
import { authorWritePreimages, capturePhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from '../../scripts/utils/phase-write-boundary';
import { DetachedGoalPhaseExecutor, type WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { repairInvocationCompleted } from '../../scripts/utils/goal-runner-phase';
import { runGoalRuntimeChain, setupGoalRuntimeHost } from './goal-runner-testing-integrity.unit.test';
import { runGoalModeSessionStep as runGoalModeSessionStepUnchecked } from '../../scripts/goal-mode-entry';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import * as goalManifest from '../../scripts/utils/goal-manifest';
import { execFileSync, spawn, spawnSync } from 'child_process';
import * as YAML from 'yaml';
import { buildGoalManifestFromInput, writeGoalManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { GoalPhaseRuntime, __testing_setDetachSpawn } from '../../scripts/goal-phase-runtime';
import { interruptedIssuanceCli, reusedGatePidCli, junctionSessionCli } from '../utils/session-recovery-cli';
import { reconcileGuardianOwnership } from '../../scripts/utils/goal-containment-reconcile';
import { invokeAgentHeadless as nativeInvokeAgentHeadless } from '../../scripts/utils/agent-invoke';
const invokeAgentHeadless = bindControlledProcess(nativeInvokeAgentHeadless);
import { invocationCompleted } from '../../scripts/utils/invocation-completion';
import { readReusableCheckResult } from '../../scripts/utils/verify-feature-completion';
import { withRuntimeTest, preserveRuntimeTestEvidence, type RuntimeTestControl } from '../utils/runtime-test-control';
const runGoalModeSessionStep = (options: Parameters<typeof runGoalModeSessionStepUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeSessionStepUnchecked(options));


const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture(prefix = 'session-handoff-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const runDir = path.join(root, 'doc/features/demo/goal-runs/run-1'); fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/value.ts'), 'before\n');
  ensureRunControl(runDir, 'run-1');
  const acquired = casAcquireRunOwner(runDir, 'run-1', 0, { kind: 'session', owner_id: 'session-one', lease_ms: 60_000 });
  assert(acquired.ok); if (!acquired.ok) throw new Error('fixture owner unavailable');
  const boundary: PhaseWriteBoundaryResolution = { projectRoot: root, feature: 'demo', phaseOrder: ['coding', 'ut'],
    domains: [{ owner: 'coding', kind: 'source', match: 'prefix', path: 'src', source: 'fixture product source domain' }],
    protectedRoots: ['src'], diagnostics: [], unresolvedSourcePhases: [] };
  const context: WorkUnitExecutionContext = { runId: 'run-1', feature: 'demo', workflowId: 'obligation-driven', track: 'full', chain: ['coding', 'ut'],
    phase: 'coding', attemptId: 'attempt-one', owner: { ...acquired.token, kind: 'session' }, projectRoot: root, frameworkRoot: path.join(root, 'framework'),
    runDir, reportDir: 'doc/features/demo/coding/reports', adapter: 'codex', adapterModel: controlledModelBinding('codex', root), instruction: 'Use the original issued snapshot and execute the requested coding change.',
    runtimeFacts: { runBaseSha: 'a'.repeat(40), receiptRequired: true, resume: false, successor: false },
    childEnv: { MAISON_GOAL_RUN_ID: 'run-1', PRIVATE_TEST_CREDENTIAL: 'must-never-be-persisted' } };
  const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  const start = (invokeId = 'invoke-one', ts = new Date().toISOString()) => emit({ type: 'agent_invoke_start', phase: context.phase, invoke_id: invokeId, attempt_id: context.attemptId, ts });
  const issue = (invokeId = 'invoke-one', emitter = emit, timeoutMs = 60_000) => issueSessionExecution({ context, invokeId, timeoutMs, gateTimeoutMs: 30_000, cleanupReserveMs: 500,
    preSnapshot: capturePhaseInvocationSnapshot(boundary), writeBoundary: boundary, emit: emitter });
  const bind = (issued: ReturnType<typeof issue>) => emit({ type: 'agent_process_bound', phase: context.phase, invoke_id: issued.request.invoke_id,
    owner_id: issued.request.context.owner.owner_id, owner_epoch: issued.request.context.owner.epoch, binding_snapshot: capturePhaseBinding(runDir, issued) });
  const report: SessionExecutionReport = { status: 'passed', phase: 'coding', details: 'executor completed; formal gate is still required' };
  const files = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const visit = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else out[path.relative(root, file)] = fs.readFileSync(file).toString('base64'); } }; visit(root); return out;
  };
  return { root, runDir, context, boundary, emit, start, issue, bind, report, files, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
  name: '3ec91fa7 minted controls run verbatim from a dependency-free consumer cwd and preserve the signed request',
  async run() {
    const f = fixture("session consumer 'quoted' ");
    const frameworkRoot = path.resolve(__dirname, '../../..');
    try {
      const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'run-1', adapter: 'codex', start_phase: 'coding', end_phase: 'coding',
        adapter_model_pin: parseAdapterModelBinding('codex', f.context.adapterModel), run_base_sha: 'a'.repeat(40),
        unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
      createGoalRun({ projectRoot: f.root, frameworkRoot, manifest, chain: ['coding'], resolveHead: () => 'a'.repeat(40) });
      Object.assign(f.context, { frameworkRoot, reportDir: manifest.report_dir });
      f.start(); const issued = f.issue();
      const returned = await runGoalModeSessionStep({ projectRoot: f.root, frameworkRoot, feature: 'demo', runId: 'run-1', adapter: 'codex', runMode: 'attended' });
      assert.equal(returned.type, 'phase_execute_request');
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^TS_NODE_|^NODE_OPTIONS$/i.test(name)));
      assert(!fs.existsSync(path.join(f.root, 'node_modules')) && !fs.existsSync(path.join(f.root, 'tsconfig.json')));
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const cli = (command: unknown) => {
        assert.equal(typeof command, 'string');
        return spawnSync(shell, [...(process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command'] : ['-c']), String(command)],
          { cwd: f.root, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
      };
      const ok = (command: unknown) => {
        const result = cli(command);
        assert.equal(result.status, 0, String(result.error ?? result.stderr));
        return JSON.parse(result.stdout);
      };
      assert.equal(ok(returned.observe_command).observation.invoke_id, issued.request.invoke_id);
      const refused = cli(returned.interrupt_command);
      assert.equal(refused.status, 1, refused.stdout + refused.stderr);
      assert.match(refused.stderr, /没有可核实的原生进程绑定/);
      assert.equal(acceptedSessionReport(f.runDir, issued), null);
      f.emit({ type: 'agent_process_settled', phase: f.context.phase, invoke_id: issued.request.invoke_id, status: 'passed', exit_code: 0, completion_observed: true });
      const received = ok(returned.execute_command);
      assert.equal(received.type, 'goal_session_report_received');
      assert.equal(received.status, 'passed');
      assert.equal(acceptedSessionReport(f.runDir, issued)?.event.handoff_report?.request_sha256, issued.reference.sha256);
      assert.equal(ok(returned.interrupt_command).interrupted, false);
      assert.equal(ok(returned.execute_command).duplicate, true);
      Object.assign(f.context, { attemptId: 'attempt-two' }); f.start('invoke-two'); const next = f.issue('invoke-two');
      assert.equal(ok(received.next_command).request.sha256, next.reference.sha256);
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_end').length, 1);
    } finally { f.cleanup(); }
  },
}, {
  name: '3ec91fa7 public attended next detaches an existing signed request and observers never start a second executor',
  async run() {
    const f = fixture();
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const program = path.join(f.root, 'controlled-work.cjs');
    const count = path.join(f.root, 'execution-count.txt');
    fs.writeFileSync(program, `const f=require('fs');process.stdin.resume();process.stdin.on('end',()=>{
f.appendFileSync(${JSON.stringify(count)},'once\\n');setTimeout(()=>{
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));},1000);});`);
    const restore = installControlledCodex(f.root, program);
    const previousClaude = process.env.CLAUDE_CONFIG_DIR;
    let runner: ReturnType<typeof spawn> | undefined;
    let runnerClosed: Promise<void> | undefined;
    try {
      const requirement = '完成这次接口文档交付。请无人值守，后台继续到验收。';
      process.env.CLAUDE_CONFIG_DIR = path.join(f.root, 'native-claude');
      const session = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'fixture', 'fixture-claude.jsonl');
      fs.mkdirSync(path.dirname(session), { recursive: true });
      fs.writeFileSync(session, JSON.stringify({ type: 'user', uuid: 'user-one', sessionId: 'fixture-claude', cwd: f.root,
        timestamp: new Date().toISOString(), message: { role: 'user', content: requirement } }) + '\n');
      fs.writeFileSync(path.join(f.root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'Handoff fixture',
        project_profile: { name: 'generic' }, materialized_adapters: ['codex'] }));
      fs.writeFileSync(path.join(f.root, 'AGENTS.md'), '# Protocol fixture\n');
      const model = parseAdapterModelBinding('codex', f.context.adapterModel)!;
      fs.mkdirSync(path.dirname(model.config_source!), { recursive: true }); fs.writeFileSync(model.config_source!, '[features]\n');
      const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'run-1', adapter: 'codex', requirement, adapter_model_pin: model,
        start_phase: 'coding', end_phase: 'coding', run_base_sha: 'a'.repeat(40), unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
      createGoalRun({ projectRoot: f.root, frameworkRoot, manifest, chain: ['coding'], resolveHead: () => 'a'.repeat(40) });
      Object.assign(f.context, { frameworkRoot, reportDir: manifest.report_dir });
      f.start(); const issued = f.issue();
      const common = { projectRoot: f.root, frameworkRoot, feature: 'demo', runId: 'run-1', adapter: 'codex', runMode: 'attended' };
      const result = await runGoalModeSessionStep({ ...common, authorization: { mode: 'goal_mode', autonomyAuthorized: true } });
      assert.equal(result.type, 'phase_execute_request', JSON.stringify(result));
      const optedIn = { ...common, sessionRef: `${session}#user-one` };
      __testing_setDetachSpawn(((_file: string, args: string[], options: object) => spawn(path.join(f.root, 'absent-runner.exe'), args, options)) as typeof spawn);
      try {
        const fallback = await runGoalModeSessionStep(optedIn);
        assert.equal((fallback.request as { path?: string })?.path, path.resolve(f.runDir, issued.reference.path));
        assert.equal(typeof fallback.execute_command, 'string');
        assert.equal(typeof fallback.transport_fallback, 'string');
        assert.equal(fs.existsSync(count), false);
      } finally { __testing_setDetachSpawn(null); }
      __testing_setDetachSpawn(((file: string, args: string[], options: object) => {
        const child = spawn(file, args, options);
        runner = child;
        runnerClosed = new Promise<void>(resolve => child.once('close', () => resolve()));
        return child;
      }) as typeof spawn);
      let selected: Awaited<ReturnType<typeof runGoalModeSessionStep>>;
      try { selected = await runGoalModeSessionStep(optedIn); }
      finally { __testing_setDetachSpawn(null); }
      assert.equal(selected.detached, true, JSON.stringify(selected));
      assert.equal(selected.run_id, manifest.run_id);
      assert.equal(typeof selected.wait_command, 'string');
      const watch = { ...common, action: 'observe' as const, requestPath: path.resolve(f.runDir, issued.reference.path) };
      await Promise.all([runGoalModeSessionStepUnchecked(watch), runGoalModeSessionStepUnchecked(watch)]);
      const until = Date.now() + 12_000;
      while (!acceptedSessionReport(f.runDir, issued) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
      assert(acceptedSessionReport(f.runDir, issued), fs.readFileSync(path.join(f.runDir, 'detach.log'), 'utf8'));
      assert.equal(fs.readFileSync(count, 'utf8'), 'once\n');
      const rows = sessionEvents(f.runDir).filter(event => event.invoke_id === issued.request.invoke_id);
      for (const type of ['phase_start', 'agent_process_bound', 'agent_invoke_end']) assert.equal(rows.filter(event => event.type === type).length, 1, type);
    } finally {
      if (runner) {
        runner.ref();
        if (runner.exitCode === null && runner.signalCode === null) runner.kill();
        await runnerClosed;
      }
      if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaude;
      restore(); f.cleanup();
    }
  },
}, {
  name: '3ec91fa7 write windows reject contaminated handback without assigning a writer or issuing a restore',
  run() {
    const f = fixture();
    try {
      const target = path.join(f.root, 'src/value.ts');
      f.boundary.executionRole = 'author';
      f.boundary.immutableInputPaths = ['src/value.ts'];
      f.start(); const issued = f.issue();
      fs.writeFileSync(target, 'after signature, before binding\n');
      f.bind(issued);
      fs.writeFileSync(target, 'after binding\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      const events = sessionEvents(f.runDir);
      const violation = events.find(event => event.type === 'phase_write_violation') as { violations?: Array<{ window: string; pre_sha256: string; post_sha256: string }> };
      assert.deepEqual(violation.violations?.map(change => change.window), ['before_binding', 'execution_window']);
      assert.equal(violation.violations?.[0].post_sha256, violation.violations?.[1].pre_sha256);
      assert.equal(acceptedSessionReport(f.runDir, issued)?.event.status, 'failed');
      assert.equal(authorWritePreimages(events).size, 0);
      assert.equal(fs.readFileSync(target, 'utf8'), 'after binding\n');
      fs.writeFileSync(target, 'later third party\n');
      const observed = observeSessionExecution(f.runDir, issued);
      assert.equal(observed.postSnapshot?.entries[0].sha256, hash('after binding\n'));
    } finally { f.cleanup(); }
  },
}, {
  name: '3ec91fa7 old handback retains in-scope byte observations with unknown binding provenance',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue();
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'legacy change\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      const observed = sessionEvents(f.runDir).find(event => event.type === 'phase_write_observed') as unknown as {
        owned: unknown[]; observations: Array<{ path: string; window: string; disposition: string; post_sha256: string }> };
      assert.deepEqual(observed.owned, []);
      assert.deepEqual(observed.observations.map(write => [write.path, write.window, write.disposition, write.post_sha256]),
        [['src/value.ts', 'unverified', 'unattributed', hash('legacy change\n')]]);
      assert.equal(acceptedSessionReport(f.runDir, issued)?.event.status, 'passed');
    } finally { f.cleanup(); }
  },
}, {
  name: 'a920 public execute-request preserves real R1 DSH usage into settled and accepted invocation once',
  async run() {
    const sourceRoot = path.resolve(__dirname, '../fixtures/host-recovery-history/20261115-design-recovery/session-return-usage');
    const sources = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'sources.json'), 'utf8')).sources as Array<{ fixture: string; fixture_sha256: string; observed_steps: number }>;
    for (const source of sources) {
      const f = fixture(), priorPath = process.env.PATH;
      try {
        const bytes = fs.readFileSync(path.join(sourceRoot, source.fixture)); assert.equal(hash(bytes.toString('utf8')), source.fixture_sha256);
        const expected = deriveDshInvokeUsage(bytes.toString('utf8')); assert.equal(expected.requests, source.observed_steps);
        const frameworkRoot = f.context.frameworkRoot, adapterDir = path.join(frameworkRoot, 'agents/deepseek-harness');
        fs.mkdirSync(adapterDir, { recursive: true });
        for (const name of ['adapter.yaml', 'headless-patch.yaml']) fs.copyFileSync(path.resolve(__dirname, '../../../agents/deepseek-harness', name), path.join(adapterDir, name));
        const modelSource = path.join(f.root, '.native-dsh/profiles/desktop/cordis.patch.yml');
        fs.mkdirSync(path.dirname(modelSource), { recursive: true });
        fs.writeFileSync(modelSource, YAML.stringify([{ id: 'llm-pi-ai', config: { providers: { fixture: { baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'fixture-model', contextWindow: 1000, input: ['text'] }] } } } }]));
        const pin = freezeModelPin({ adapter: 'deepseek-harness', provider: 'fixture', value: 'fixture-model', config_source: modelSource }, f.root)!;
        const stream = path.join(f.root, 'native-usage.jsonl'); fs.writeFileSync(stream, bytes);
        const nativeDir = path.join(f.root, 'native-bin'); fs.mkdirSync(nativeDir);
        const script = path.join(nativeDir, 'dsh-fixture.cjs');
        fs.writeFileSync(script, `const fs=require('fs');if(process.argv.includes('--dump-config')){console.log(JSON.stringify([{id:'agent-default-model',config:{provider:'fixture',model:'fixture-model'}},{id:'permission',config:{defaultPreset:'danger-full-access'}},{id:'llm-pi-ai',config:{providers:{fixture:{baseURL:'https://fixture.invalid/v1',apiKeyEnv:'FIXTURE_KEY',models:[{id:'fixture-model',contextWindow:1000,input:['text']}]}}}}]));}else{process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync('execution-count.txt','once\\n');process.stdout.write(fs.readFileSync(${JSON.stringify(stream)},'utf8'));});}\n`);
        if (process.platform === 'win32') fs.writeFileSync(path.join(nativeDir, 'dsh.cmd'), '@echo off\nset "_prog=node"\n"%_prog%" "%~dp0dsh-fixture.cjs" %*\n');
        else fs.writeFileSync(path.join(nativeDir, 'dsh'), `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
        process.env.PATH = nativeDir + path.delimiter + (priorPath ?? '');
        const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'run-1', adapter: pin.adapter, adapter_model_pin: pin,
          start_phase: 'coding', end_phase: 'coding', run_base_sha: 'a'.repeat(40), unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
        writeGoalManifest(manifest, f.root); Object.assign(f.context, { adapter: pin.adapter, adapterModel: adapterModelBinding(pin), reportDir: manifest.report_dir });
        f.start(); const issued = f.issue();
        const args = ['-r', require.resolve('ts-node/register/transpile-only'), path.resolve(__dirname, '../../scripts/goal-mode-entry.ts'),
          '--feature', 'demo', '--run-id', 'run-1', '--adapter', pin.adapter, '--run-mode', 'attended', '--project-root', f.root,
          '--framework-root', frameworkRoot, '--request', path.resolve(f.runDir, issued.reference.path), '--execute-request'];
        const call = () => JSON.parse(withRuntimeTest({ root: f.root }, () => execFileSync(process.execPath, args, {
          cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, DSH_HOME: path.join(f.root, '.native-dsh') },
        })));
        const first = call(); assert.equal(first.status, 'passed', JSON.stringify({ first, report: acceptedSessionReport(f.runDir, issued)?.report }));
        const events = sessionEvents(f.runDir).filter(event => event.invoke_id === 'invoke-one');
        for (const type of ['agent_process_settled', 'agent_invoke_end']) assert.deepEqual((events.find(event => event.type === type) as Record<string, unknown>)?.usage, expected, type + ' lost native usage');
        assert.equal(call().duplicate, true); assert.equal(fs.readFileSync(path.join(f.root, 'execution-count.txt'), 'utf8'), 'once\n');
        assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_end').length, 1, 'repeated receipt cannot add another usage record');
      } finally { if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath; f.cleanup(); }
    }
  },
}, {
  name: 'P1 R3 execute recovery preserves real settled failure and completion-cleanup facts instead of trusting raw terminal text',
  async run() {
    const producer = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-r3-natural-exit-'));
    try {
      const failed = await invokeAgentHeadless({ argv: [process.execPath, '-e', `process.stdout.write(JSON.stringify({type:'turn.completed'})+String.fromCharCode(10));process.exit(1);`],
        label: 'real Node natural exit 1', adapterName: 'codex' }, producer,
      { outputLogPath: path.join(producer, 'agent-output.log'), toolEventCapture: 'structured_events' });
      assert.equal(failed.exitCode, 1); assert.equal(failed.kill_attempted, false); assert.equal(invocationCompleted(failed), false);
      const vectors: Array<{ name: string; facts?: Record<string, unknown>; expected: string; complete: boolean }> = [
        { name: 'natural-exit-1', facts: { status: 'failed', exit_code: failed.exitCode, completion_observed: failed.completion_observed, kill_attempted: failed.kill_attempted }, expected: 'failed', complete: false },
        { name: 'completion-cleanup-1', facts: { status: 'passed', exit_code: 1, completion_observed: true, kill_attempted: true }, expected: 'passed', complete: true },
        { name: 'timeout', facts: { status: 'failed', exit_code: 1, completion_observed: true, timed_out: true }, expected: 'failed', complete: false },
        { name: 'interrupted', facts: { status: 'waiting', exit_code: 1, completion_observed: true, interrupted: true }, expected: 'waiting', complete: false },
        { name: 'terminal-failure', facts: { status: 'failed', exit_code: 1, completion_observed: true, terminal_failure_observed: true }, expected: 'failed', complete: false },
        { name: 'bare-terminal', expected: 'failed', complete: false },
      ];
      for (const vector of vectors) {
        const f = fixture();
        try {
          const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'run-1', adapter: 'codex', start_phase: 'coding', end_phase: 'coding',
            adapter_model_pin: parseAdapterModelBinding('codex', f.context.adapterModel),
            run_base_sha: 'a'.repeat(40), unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
          writeGoalManifest(manifest, f.root); Object.assign(f.context, { reportDir: manifest.report_dir });
          f.start(); const issued = f.issue();
          fs.copyFileSync(path.join(producer, 'agent-events.jsonl'), path.join(f.runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'));
          if (vector.facts) f.emit({ type: 'agent_process_settled', phase: 'coding', invoke_id: 'invoke-one', ...vector.facts });
          else f.emit({ type: 'agent_process_bound', phase: 'coding', invoke_id: 'invoke-one', run_id: 'run-1', pid: 2147483647,
            started_at_ms: 1, executable: process.execPath, token: 'run-1/invoke-one' });
          const result = await runGoalModeSessionStep({ projectRoot: f.root, frameworkRoot: f.context.frameworkRoot, feature: 'demo', runId: 'run-1', adapter: 'codex', runMode: 'attended',
            requestPath: path.resolve(f.runDir, issued.reference.path), action: 'execute' });
          const accepted = acceptedSessionReport(f.runDir, issued)!;
          assert.equal(result.status, vector.expected, vector.name);
          assert.equal(repairInvocationCompleted(sessionEvents(f.runDir), 'coding', 'invoke-one'), vector.complete, vector.name);
          if (vector.facts) assert.equal(accepted.event.exit_code, vector.facts.exit_code, `${vector.name} exit was rewritten`);
          for (const field of ['completion_observed', 'timed_out', 'interrupted', 'terminal_failure_observed']) if (vector.facts?.[field] === true) {
            assert.equal((accepted.event as Record<string, unknown>)[field], true, `${vector.name} lost ${field}`);
          }
          assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_start').length, 1, `${vector.name} spawned another author`);
          assert(!('usage' in accepted.event), `${vector.name} legacy event without usage must not gain invented counts`);
        } finally { f.cleanup(); }
      }
    } finally { fs.rmSync(producer, { recursive: true, force: true }); }
  },
}, {
  name: 'P1 R2 real request CLI executes once and exposes the same running facts before owner-bound interruption',
  async run() {
    if (process.platform !== 'win32') return;
    const f = fixture();
    let child: ReturnType<typeof spawn> | undefined;
    let done: Promise<{ status: number | null; signal: NodeJS.Signals | null; pid: number | undefined; stdout: string }> | undefined;
    let stdout = '', stderr = '';
    let restoreNative = () => {};
    try {
      const frameworkRoot = path.join(f.root, 'framework');
      fs.mkdirSync(path.join(frameworkRoot, 'agents/codex'), { recursive: true });
      const native = path.join(f.root, 'native-fixture.cjs');
      fs.writeFileSync(native, `const fs=require('fs');fs.appendFileSync('execution-count.txt','once\\n');fs.writeFileSync('src/value.ts','actual partial write\\n');process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'actual check',exit_code:1}})+'\\n');setInterval(()=>{},1000);\n`);
      const adapter = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../../../agents/codex/adapter.yaml'), 'utf8'));
      adapter.goal_capability.tool_event_provenance = 'structured_events';
      fs.writeFileSync(path.join(frameworkRoot, 'agents/codex/adapter.yaml'), YAML.stringify(adapter));
      restoreNative = installControlledCodex(f.root, native);
      const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'run-1', adapter: 'codex', start_phase: 'coding', end_phase: 'coding',
        adapter_model_pin: parseAdapterModelBinding('codex', f.context.adapterModel),
        run_base_sha: 'a'.repeat(40), unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
      writeGoalManifest(manifest, f.root);
      Object.assign(f.context, { adapter: 'codex', frameworkRoot, reportDir: manifest.report_dir });
      f.start(); const issued = f.issue();
      const entry = path.resolve(__dirname, '../../scripts/goal-mode-entry.ts');
      const args = ['-r', require.resolve('ts-node/register/transpile-only'), entry, '--feature', 'demo', '--run-id', 'run-1', '--adapter', 'codex', '--run-mode', 'attended',
        '--project-root', f.root, '--framework-root', frameworkRoot, '--request', path.resolve(f.runDir, issued.reference.path)];
      const cli = (action: string) => JSON.parse(withRuntimeTest({ root: f.root }, () => execFileSync(process.execPath, [...args, action],
        { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000 })));
      child = spawn(process.execPath, [...args, '--execute-request'], { cwd: path.resolve(__dirname, '../..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
      done = withRuntimeTest({ root: f.root, timeoutMs: 120_000 }, () => new Promise<{ status: number | null; signal: NodeJS.Signals | null; pid: number | undefined; stdout: string }>((resolve, reject) => {
        child!.once('close', (status, signal) => resolve({ status, signal, pid: child?.pid, stdout })); child!.once('error', reject);
      }));
      while (!fs.existsSync(path.join(f.root, 'execution-count.txt')) || !sessionEvents(f.runDir).some(event => event.type === 'agent_process_bound')) {
        assert(child.exitCode === null && child.signalCode === null, stderr || stdout);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(fs.existsSync(path.join(f.root, 'execution-count.txt')), stderr || stdout);
      const observed = cli('--observe').observation;
      assert.equal(observed.settled, false); assert.equal(observed.toolEvents.length, 1); assert.equal(observed.changes.kind, 'changed');
      assert.deepEqual(observed, JSON.parse(JSON.stringify(observeSessionExecution(f.runDir, issued))));
      assert.equal(cli('--execute-request').status, 'execution_running');
      const interrupted = cli('--interrupt'); assert.equal(interrupted.interrupted, true);
      await done;
      assert.equal(child.exitCode, 0, stderr + stdout);
      const accepted = acceptedSessionReport(f.runDir, issued)!;
      assert.equal(accepted.report.status, 'waiting');
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_end').length, 1);
      assert.equal(fs.readFileSync(path.join(f.root, 'src/value.ts'), 'utf8'), 'actual partial write\n');
      assert.equal(cli('--execute-request').duplicate, true);
      assert.equal(fs.readFileSync(path.join(f.root, 'execution-count.txt'), 'utf8'), 'once\n');
      Object.assign(f.context, { attemptId: 'attempt-two' }); f.start('invoke-two'); const second = f.issue('invoke-two');
      const priorExitCode = process.exitCode;
      try {
        const execution = runGoalModeSessionStep({ projectRoot: f.root, frameworkRoot, feature: 'demo', runId: 'run-1', adapter: 'codex', runMode: 'attended',
          requestPath: path.resolve(f.runDir, second.reference.path), action: 'execute' });
        const until = Date.now() + 20000;
        while (fs.readFileSync(path.join(f.root, 'execution-count.txt'), 'utf8') !== 'once\nonce\n' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(fs.readFileSync(path.join(f.root, 'execution-count.txt'), 'utf8'), 'once\nonce\n');
        process.emit('SIGINT');
        const result = await execution;
        assert.equal(result.status, 'waiting');
        assert.equal(acceptedSessionReport(f.runDir, second)!.event.interrupted, true);
        assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_end' && event.invoke_id === 'invoke-two').length, 1);
      } finally { process.exitCode = priorExitCode; }
      Object.assign(f.context, { attemptId: 'attempt-three', authority: { write_mode: 'workspace-write', approval_mode: 'never', allowed_tools: ['Read'] } });
      f.start('invoke-three'); const third = f.issue('invoke-three');
      const narrowed = await runGoalModeSessionStep({ projectRoot: f.root, frameworkRoot, feature: 'demo', runId: 'run-1', adapter: 'codex', runMode: 'attended',
        requestPath: path.resolve(f.runDir, third.reference.path), action: 'execute' });
      assert.equal(narrowed.status, 'failed', 'unsupported native tool restrictions cannot expand to full-access defaults');
      assert.equal(fs.readFileSync(path.join(f.root, 'execution-count.txt'), 'utf8'), 'once\nonce\n', 'an adapter without the narrower permission capability was started at full access');
    } finally {
      try {
        if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill();
        if (done) await done;
      } finally { restoreNative(); f.cleanup(); }
    }
  },
}, {
  name: 'P1 running observations reuse native facts and owner-bound interruption preserves writes without declaring completion',
  async run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue();
      assert.equal(issued.request.deadline, undefined, 'a phase timeout must not become an implicit user deadline');
      const raw = path.join(f.runDir, path.dirname(issued.reference.path), 'agent-events.jsonl');
      fs.writeFileSync(raw, JSON.stringify({ type: 'thread.started', thread_id: 'precise-running-alpha' }) + '\n'
        + JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'actual-check', exit_code: 1 } }) + '\n');
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'partial legitimate work\n');
      const one = observeSessionExecution(f.runDir, issued), two = observeSessionExecution(f.runDir, issued);
      assert.deepEqual(two, one); assert.equal(one.provider_session_id, 'precise-running-alpha');
      assert.equal(one.toolEvents.length, 2); assert.equal(one.settled, false); assert.equal(one.changes?.kind, 'changed');
      await assert.rejects(interruptSessionExecution({ runDir: f.runDir, issued, reason: 'coordinator pause', stop: async () => false, emit: f.emit }), /unconfirmed/);
      assert.equal(acceptedSessionReport(f.runDir, issued), null, 'unconfirmed stop cannot settle a live author');
      let stopped = 0;
      await interruptSessionExecution({ runDir: f.runDir, issued, reason: 'P2 supplied the pause decision', stop: async () => { stopped++; return true; }, emit: f.emit });
      await interruptSessionExecution({ runDir: f.runDir, issued, reason: 'duplicate', stop: async () => { stopped++; return true; }, emit: f.emit });
      assert.equal(stopped, 1); assert.equal(fs.readFileSync(path.join(f.root, 'src/value.ts'), 'utf8'), 'partial legitimate work\n');
      const end = acceptedSessionReport(f.runDir, issued)!;
      assert.equal(end.report.status, 'waiting'); assert.equal(end.event.interrupted, true);
      assert.equal(end.event.provider_session_id, 'precise-running-alpha');
      assert(!repairInvocationCompleted(sessionEvents(f.runDir), 'coding', issued.request.invoke_id));
      assert.equal(sessionEvents(f.runDir).filter(row => row.type === 'phase_write_observed').length, 1);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 real CLI junction project-root aliases share one signed request and waiting report without duplicate invocation',
  run: junctionSessionCli,
}, {
  name: '1804 real next recovers request commit throw and external kill before signing without another invocation or force',
  run: interruptedIssuanceCli,
}, {
  name: '1804 real gate ignores a reused live PID without killing it and actually runs its next gate',
  run: reusedGatePidCli,
}, {
  name: '1804 real CLI resumes a gate whose PID was reused by a SYSTEM process without killing it',
  run: () => reusedGatePidCli(true),
}, {
  name: '1804 session calls are excluded from legacy process cleanup while genuine unclosed headless invocations remain protected',
  run() {
    const probe = { identify: () => null, killTree: () => false };
    assert.equal(reconcileGuardianOwnership([{ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1', command: 'phase_execute_request' }], probe).kind, 'no_unclosed_bounds');
    for (const command of ['codex exec task', undefined]) assert.equal(reconcileGuardianOwnership([{ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1', command }], probe).kind, 'legacy_run');
  },
}, {
  name: '1804 junction run material paths allow missing directories but reject parent escape and final symlinks',
  run() {
    const f = fixture();
    const alias = `${f.root}-alias`;
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'session-handoff-outside-'));
    try {
      fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const aliasRun = path.join(alias, path.relative(f.root, f.runDir));
      const nested = path.join(aliasRun, 'not-created', 'nested', 'report.json');
      assert.equal(sessionRunMaterialPath(aliasRun, nested), path.join(fs.realpathSync(f.runDir), 'not-created', 'nested', 'report.json'));
      const aliasContext = { ...f.context, runDir: aliasRun, projectRoot: alias };
      f.start(); const issued = issueSessionExecution({ context: aliasContext, invokeId: 'invoke-one', timeoutMs: 60_000,
        gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot: capturePhaseInvocationSnapshot(f.boundary), writeBoundary: f.boundary, emit: f.emit });
      assert.deepEqual(readSessionExecution(aliasRun)!.reference, issued.reference);
      acceptSessionExecution({ runDir: aliasRun, issued, report: f.report, emit: f.emit });
      assert(acceptedSessionReport(aliasRun, issued));
      assert.throws(() => sessionRunMaterialPath(aliasRun, path.join(outside, 'escape.json')), /inside this run|escapes this run/);
      fs.symlinkSync(outside, path.join(f.runDir, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => sessionRunMaterialPath(aliasRun, path.join(aliasRun, 'outside-link', 'missing', 'result.json')), /inside this run|escapes this run/);
      const material = path.join(f.runDir, issued.reference.path);
      const finalLink = path.join(f.runDir, 'linked-material');
      // A junction is a final symlink too, and can be created without Windows elevation.
      fs.symlinkSync(path.dirname(material), finalLink, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => sessionRunMaterialPath(aliasRun, path.join(aliasRun, 'linked-material')), /cannot be a symlink/);
    } finally {
      if (fs.existsSync(alias)) fs.unlinkSync(alias);
      if (fs.existsSync(path.join(f.runDir, 'outside-link'))) fs.unlinkSync(path.join(f.runDir, 'outside-link'));
      f.cleanup(); fs.rmSync(outside, { recursive: true, force: true });
    }
  },
}, {
  name: '1804 report input excludes only its exact current-fence file while neighboring run materials stay in the guarded snapshot',
  run() {
    const f = fixture();
    try {
      const runRelative = path.relative(f.root, f.runDir);
      const boundary = { ...f.boundary, protectedRoots: ['src', runRelative] };
      const options = { ownedPrefixes: [runRelative], runtimeExcluded: [`${runRelative}/existing-runtime-output.txt`] };
      f.start();
      const issued = issueSessionExecution({ context: f.context, invokeId: 'invoke-one', purpose: 'author', timeoutMs: 60_000,
        gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot: capturePhaseInvocationSnapshot(boundary, options), writeBoundary: boundary, snapshotOptions: options, emit: f.emit });
      const input = sessionReportInputPath(f.runDir, issued);
      fs.writeFileSync(input, JSON.stringify(f.report));
      fs.writeFileSync(path.join(f.runDir, 'existing-runtime-output.txt'), 'still excluded by the original snapshot options\n');
      fs.writeFileSync(path.join(path.dirname(input), 'result-other-fence.json'), 'unapproved neighboring write\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      const accepted = acceptedSessionReport(f.runDir, issued)!;
      const archive = readHandoffMaterial<{ post_snapshot: { entries: Array<{ path: string }> } }>(f.runDir, accepted.event.handoff_report!);
      const entries = archive.post_snapshot.entries.map(entry => entry.path);
      assert(!entries.includes(path.relative(f.root, input).replace(/\\/g, '/')));
      assert(!entries.some(file => file.endsWith('/existing-runtime-output.txt')));
      assert(entries.some(file => file.endsWith('/result-other-fence.json')), 'an unrelated run file must remain visible to the existing design guard');
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 report archive precedes observed writes and replay freezes the original post after an observation crash',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); f.bind(issued); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'original reported output\n');
      const archive = path.join(f.runDir, path.dirname(issued.reference.path), `execution-report-e${issued.request.context.owner.epoch}.json`);
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: event => {
        f.emit(event);
        if (event.type === 'phase_write_observed') {
          assert(fs.existsSync(archive), 'immutable report and post must exist before observation commit');
          throw new Error('observation committed before process interruption');
        }
      } }), /observation committed before process interruption/);
      const original = fs.readFileSync(archive);
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'later collaboration output\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      assert(fs.readFileSync(archive).equals(original));
      const observed = sessionEvents(f.runDir).filter(event => event.type === 'phase_write_observed');
      assert.equal(observed.length, 1);
      assert.equal((observed[0] as any).post_snapshot, JSON.parse(original.toString()).post_snapshot.sha256);
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_end').length, 1);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 unqueryable old gate identity waits without a fake harness end and later validates the accepted author',
  async run() {
    const root = setupGoalRuntimeHost('codex').root, runId = 'session-gate-identity-wait';
    const probes = require('../../scripts/utils/device-session') as typeof import('../../scripts/utils/device-session');
    const original = probes.defaultProcessProbe;
    try {
      await assert.rejects(() => runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        testControl: { expectedInterruption: 'pause before executor report' },
        onAuthor: () => { throw new Error('pause before executor report'); } }), /pause before executor report/);
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
      const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
      fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'harness_start', phase: 'spec',
        invoke_id: `spec-${issued.request.context.attemptId}`, process_role: 'harness', run_id: runId,
        pid: process.pid, started_at_ms: 1, executable: process.execPath, token: 'old-gate-token' }) + '\n');
      probes.defaultProcessProbe = () => ({ ...original(), identify: () => null, readStartedAtMs: () => null });
      const parked = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true, realHarness: true });
      assert(acceptedSessionReport(runDir, issued), 'the real report must commit before the gate check');
      assert(!parked.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), 'unavailable identity is a recoverable condition');
      assert(parked.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting'));
      assert(!parked.events.some(event => event.type === 'harness_end'), 'no new gate ran and the unknown old gate has not ended');
      assert.equal(sessionValidationOnlyEligibility(parked.events)?.invoke_id, issued.request.invoke_id);
      probes.defaultProcessProbe = original;
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      assert.equal(resumed.exitCode, 0);
      assert.deepEqual(resumed.invokedPhases, [], 'the accepted executor must not be invoked again');
      assert.deepEqual(resumed.harnessPhases, ['spec']);
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start').length, 1);
    } finally { probes.defaultProcessProbe = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 interruption before gate handback commits checks once and preserves the accepted author',
  async run() {
    const root = setupGoalRuntimeHost('codex').root, runId = 'session-bound-gate-recovery';
    try {
        let interrupted = false;
        await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
          testControl: { expectedInterruption: 'bound gate interruption after accepted report' },
          afterHarnessPass: () => { interrupted = true; throw new Error('bound gate interruption after accepted report'); } });
        assert(interrupted);
        const observationOptions = { projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId, phase: 'spec' };
        const reader = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
        const before = reader.readCurrentCheckObservation(observationOptions);
        assert(!before.returned && !before.end, 'this hook interrupts the writer before its formal harness_end, unlike the native bound-job recovery case');
        const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
        assert.deepEqual(resumed.invokedPhases, []);
        assert.deepEqual(resumed.harnessPhases, ['spec'], 'an unpublished check must acquire its formal origin once; real completed bound-job reuse is covered by session-slow-gate');
        assert(reader.readCurrentCheckObservation(observationOptions).returned, 'the resumed check must really return its original-bound result');
        assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start').length, 1);
        assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_end' && event.handoff_report).length, 1);
        assert.equal(resumed.exitCode, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 cooperative owner re-sign preserves the original attempt, deadline and pre-snapshot while rejecting the old unconsumed report',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); const original = fs.readFileSync(path.join(f.runDir, issued.reference.path));
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'partial work before takeover\n');
      releaseRunOwner(f.runDir, f.context.owner);
      const acquired = casAcquireRunOwner(f.runDir, 'run-1', f.context.owner.epoch, { kind: 'session', owner_id: 'cooperative-new-owner', lease_ms: 120_000 });
      assert(acquired.ok); if (!acquired.ok) throw new Error('fixture cooperative takeover failed');
      const reissued = resignSessionExecution(f.runDir, issued, acquired.token, f.emit);
      assert.notEqual(reissued.reference.path, issued.reference.path);
      assert.equal(reissued.request.context.attemptId, issued.request.context.attemptId);
      assert.equal(reissued.request.invoke_id, issued.request.invoke_id);
      assert.equal(reissued.request.issued_at, issued.request.issued_at);
      assert.equal(reissued.request.deadline, issued.request.deadline);
      assert.deepEqual(reissued.request.pre_snapshot, issued.request.pre_snapshot);
      assert.deepEqual(fs.readFileSync(path.join(f.runDir, issued.reference.path)), original);
      assert.equal(issued.request.deadline, undefined, 'owner lease is not a user deadline');
      const before = f.files();
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit }), /stale request/);
      assert.deepEqual(f.files(), before);
      f.bind(reissued);
      acceptSessionExecution({ runDir: f.runDir, issued: reissued, report: f.report, emit: f.emit });
      const events = sessionEvents(f.runDir);
      assert.equal(events.filter(event => event.type === 'agent_invoke_start').length, 1);
      assert.equal(events.filter(event => event.type === 'phase_start' && event.handoff_request).length, 2);
      assert.equal(events.filter(event => event.type === 'agent_invoke_end').length, 1);
      const violations = (events.find(event => event.type === 'phase_write_violation') as unknown as { violations: Array<{ window: string; pre_sha256: string; post_sha256: string }> }).violations;
      assert.equal(violations[0].window, 'before_binding');
      assert.equal(violations[0].pre_sha256, hash('before\n')); assert.equal(violations[0].post_sha256, hash('partial work before takeover\n'));
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 unsigned material cannot dispatch; replaying committed reads preserves request bytes, deadline, snapshot and invocation count',
  run() {
    const f = fixture();
    try {
      f.start();
      assert.throws(() => f.issue('invoke-one', () => { throw new Error('crash before phase_start commit'); }), /crash before/);
      assert.equal(readSessionExecution(f.runDir), null, 'unreferenced request file grants no authority');
      const issued = f.issue(); const before = f.files();
      for (let i = 0; i < 3; i++) {
        const same = readSessionExecution(f.runDir)!;
        assert.deepEqual(same.reference, issued.reference); assert.deepEqual(same.request, issued.request);
      }
      assert.deepEqual(f.files(), before, 're-reading a request must be read only');
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_start').length, 1);
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'phase_start').length, 1);
      const bytes = fs.readFileSync(path.join(f.runDir, issued.reference.path), 'utf8');
      assert(!bytes.includes('must-never-be-persisted')); assert.equal(issued.request.context.childEnv.MAISON_GOAL_RUN_ID, 'run-1');
      assert.equal(issued.request.context.childEnv.PRIVATE_TEST_CREDENTIAL, undefined);
      assert.throws(() => f.issue('invoke-two'), /already outstanding/);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 handoff retains frozen device/provider identifiers and opaque credential references while excluding raw secret and ambient values',
  run() {
    const originalTarget = process.env.HARNESS_HDC_TARGET;
    try {
      for (const reference of ['maison/device/synthetic-1804/v2', 'SYNTHETIC_INVALID_CREDENTIAL_VALUE']) {
        const f = fixture();
        try {
          Object.assign(f.context.childEnv, { HARNESS_HDC_TARGET: 'synthetic-1804', MAISON_DEVICE_TARGET_KIND: 'physical', MAISON_DEVICE_SESSION_ID: 'device-session-one',
            MAISON_DEVICE_ATTEMPT_FROZEN: '1', MAISON_DEVICE_CREDENTIAL_REF: reference, MAISON_GOAL_ATTEMPT: 'attempt-one', MAISON_GOAL_ATTEMPT_PHASE: 'coding',
          MAISON_GOAL_VISUAL_PROVIDER_ADAPTER: 'claude', MAISON_GOAL_VISUAL_PROVIDER_MODEL: 'fixture-model', AMBIENT_UNAPPROVED: 'must-not-be-carried',
          MAISON_GOAL_AUTONOMY_AUTHORIZED: 'SYNTHETIC_EPHEMERAL_AUTHORITY', MAISON_GOAL_AUTHORIZE_AUTONOMY: 'SYNTHETIC_EPHEMERAL_AUTHORITY' });
          f.start(); const issued = f.issue();
          process.env.HARNESS_HDC_TARGET = 'different-current-default';
          const restored = readSessionExecution(f.runDir)!.request.context.childEnv;
          assert.equal(restored.HARNESS_HDC_TARGET, 'synthetic-1804'); assert.equal(restored.MAISON_DEVICE_ATTEMPT_FROZEN, '1');
          assert.equal(restored.MAISON_DEVICE_TARGET_KIND, 'physical'); assert.equal(restored.MAISON_DEVICE_SESSION_ID, 'device-session-one');
          assert.equal(restored.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER, 'claude'); assert.equal(restored.MAISON_GOAL_VISUAL_PROVIDER_MODEL, 'fixture-model');
          assert.equal(restored.MAISON_GOAL_RUN_ID, 'run-1'); assert.equal(restored.MAISON_GOAL_ATTEMPT, 'attempt-one');
          assert.equal(restored.MAISON_DEVICE_CREDENTIAL_REF, reference.startsWith('maison/device/') ? reference : undefined);
          assert.equal(restored.AMBIENT_UNAPPROVED, undefined); assert.equal(restored.PRIVATE_TEST_CREDENTIAL, undefined);
        assert.equal(restored.MAISON_GOAL_AUTONOMY_AUTHORIZED, undefined); assert.equal(restored.MAISON_GOAL_AUTHORIZE_AUTONOMY, undefined);
          const material = fs.readFileSync(path.join(f.runDir, issued.reference.path), 'utf8');
        assert(!material.includes('SYNTHETIC_INVALID_CREDENTIAL_VALUE')); assert(!material.includes('must-never-be-persisted')); assert(!material.includes('must-not-be-carried'));
        assert(!material.includes('SYNTHETIC_EPHEMERAL_AUTHORITY'), 'nonpersistent autonomy cannot become request environment authority');
        } finally { f.cleanup(); }
      }
    } finally {
    if (originalTarget === undefined) delete process.env.HARNESS_HDC_TARGET; else process.env.HARNESS_HDC_TARGET = originalTarget;
    }
  },
}, {
  name: '1804 wrong phase, invalid report and stale owner fence reject before report or attribution writes',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'after\n');
      let before = f.files();
      for (const report of [{ ...f.report, phase: 'ut' }, { ...f.report, status: 'success' }, { ...f.report, details: 42 }]) {
        assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: report as SessionExecutionReport, emit: f.emit }), /invalid execution/);
        assert.deepEqual(f.files(), before);
      }
      releaseRunOwner(f.runDir, f.context.owner);
      const next = casAcquireRunOwner(f.runDir, 'run-1', 1, { kind: 'session', owner_id: 'session-two', lease_ms: 60_000 }); assert(next.ok);
      before = f.files();
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit }), /stale owner fence/);
      assert.deepEqual(f.files(), before);
      assert.equal(acceptedSessionReport(f.runDir, issued), null);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 signed event identity mismatch and modified request bytes reject without side effects',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue();
      const eventPath = path.join(f.runDir, 'events.jsonl'); const events = sessionEvents(f.runDir);
      events[events.length - 1].attempt_id = 'wrong-attempt'; fs.writeFileSync(eventPath, events.map(event => JSON.stringify(event)).join('\n') + '\n');
      let before = f.files(); assert.throws(() => readSessionExecution(f.runDir), /identity mismatch/); assert.deepEqual(f.files(), before);
      events[events.length - 1].attempt_id = f.context.attemptId; fs.writeFileSync(eventPath, events.map(event => JSON.stringify(event)).join('\n') + '\n');
      fs.appendFileSync(path.join(f.runDir, issued.reference.path), ' '); before = f.files();
      assert.throws(() => readSessionExecution(f.runDir), /digest mismatch/); assert.deepEqual(f.files(), before);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 accepted report attributes writes against the issued pre-snapshot and duplicate reports do not recount or reattribute',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); f.bind(issued); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'after\n');
      const restored = readSessionExecution(f.runDir)!;
      const result = acceptSessionExecution({ runDir: f.runDir, issued: restored, report: f.report, emit: f.emit });
      assert.deepEqual(result, { duplicate: false, timedOut: false });
      const writes = sessionEvents(f.runDir).filter(event => event.type === 'phase_write_observed'); assert.equal(writes.length, 1);
      const owned = (writes[0] as { owned?: Array<{ path: string; pre_sha256: string; post_sha256: string }> }).owned!;
      assert.deepEqual(owned.map(write => ({ path: write.path, pre: write.pre_sha256, post: write.post_sha256 })), [{ path: 'src/value.ts', pre: hash('before\n'), post: hash('after\n') }]);
      const before = f.files();
      assert.deepEqual(acceptSessionExecution({ runDir: f.runDir, issued: restored, report: f.report, emit: f.emit }), { duplicate: true, timedOut: false });
      assert.deepEqual(f.files(), before);
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued: restored, report: { ...f.report, status: 'failed' }, emit: f.emit }), /conflicting execution report/);
      assert.deepEqual(f.files(), before);
      const events = sessionEvents(f.runDir); assert.equal(events.filter(event => event.type === 'agent_invoke_end').length, 1);
      assert(!events.some(event => event.type === 'agent_process_settled'));
      assert.deepEqual(sessionValidationOnlyEligibility(events), { phase: 'coding', invoke_id: 'invoke-one' });
    } finally { f.cleanup(); }
  },
}, {
  name: 'historical handback without a preimage uses its accepted current product without replay',
  run() {
    const f = fixture();
    try {
      const boundary = { ...f.boundary, executionRole: 'author' as const, protectedRoots: ['src', 'parallel.txt'] };
      f.start();
      const issued = issueSessionExecution({ context: f.context, invokeId: 'invoke-one', timeoutMs: 60_000,
        gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot: null, writeBoundary: boundary, emit: f.emit });
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'author result\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      const accepted = acceptedSessionReport(f.runDir, issued);
      assert.equal(accepted?.event.status, 'passed');
      const source = readHandoffMaterial<{ post_snapshot?: ReturnType<typeof capturePhaseInvocationSnapshot> }>(
        f.runDir, accepted!.event.handoff_report!);
      assert(source.post_snapshot?.entries.some(entry => entry.path === 'src/value.ts' && entry.sha256 === hash('author result\n')));
      const context = { ...f.context, attemptId: 'attempt-followup' };
      const runtime = new GoalPhaseRuntime();
      fs.writeFileSync(path.join(f.root, 'parallel.txt'), 'another request\n');
      const duplicate = runtime.prepareExecutionContext(context);
      assert('status' in duplicate && duplicate.status === 'waiting' && duplicate.details?.includes('沿原交回验证当前成果'));
      assert(!duplicate.details?.includes('恢复该原观察'));
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'current related correction\n');
      assert(!('status' in runtime.prepareExecutionContext(context)), 'an actual related change can be reassessed on current material');
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_start').length, 1);
    } finally { f.cleanup(); }
  },
}, {
  name: 'session handback preserves parallel edits and scopes rejection to signed inputs or proven writes',
  run() {
    for (const scenario of ['parallel', 'signed', 'native', 'native-no-pre'] as const) {
      const f = fixture();
      try {
        const boundary = { ...f.boundary, executionRole: 'author' as const, protectedRoots: ['src', 'parallel.ts'],
          immutableInputPaths: scenario === 'signed' ? ['parallel.ts'] : [] };
        const context = f.context;
        f.start();
        const preSnapshot = scenario === 'native-no-pre' ? null : capturePhaseInvocationSnapshot(boundary);
        const issued = issueSessionExecution({ context, invokeId: 'invoke-one', purpose: 'author', timeoutMs: 60_000,
          gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot, writeBoundary: boundary, emit: f.emit });
        if (preSnapshot) f.bind(issued);
        fs.writeFileSync(path.join(f.root, 'parallel.ts'), 'current user bytes\n');
        const native = scenario.startsWith('native');
        if (native) {
          const result = { type: 'item.completed', item: { type: 'file_change', id: 'write-1', status: 'completed', changes: [{ path: 'parallel.ts', kind: 'add' }] } };
          fs.writeFileSync(path.join(f.runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'),
            JSON.stringify(result) + '\n');
        }
        acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
        const accepted = acceptedSessionReport(f.runDir, issued)!;
        assert.equal(accepted.event.status, scenario === 'parallel' ? 'passed' : 'failed');
        const violation = sessionEvents(f.runDir).find(event => event.type === 'phase_write_violation');
        const rows = (violation as { violations?: Array<{ authority_confirmed?: boolean }> } | undefined)?.violations;
        assert.equal(rows?.some(row => row.authority_confirmed === true) ?? false, native);
        assert.equal(fs.readFileSync(path.join(f.root, 'parallel.ts'), 'utf8'), 'current user bytes\n');
      } finally { f.cleanup(); }
    }
  },
}, {
  name: 'P3 native executor preserves the actual canary tool deadline without reviving a default author phase deadline',
  async run() {
    for (const canary of [false, true]) {
      const f = fixture();
      try {
        Object.assign(f.context, { phase: canary ? 'vision-canary' : 'coding' });
        f.start();
        const issued = issueSessionExecution({ context: f.context, invokeId: 'invoke-one', emit: f.emit,
          ...(canary ? { purpose: 'vision_canary' } : {}), gateTimeoutMs: canary ? 500 : 1, cleanupReserveMs: 0,
          preSnapshot: capturePhaseInvocationSnapshot(f.boundary), writeBoundary: f.boundary });
        let spawned = false;
        const executor = new DetachedGoalPhaseExecutor(() => ({ cwd: f.root,
          plan: { argv: [process.execPath, '-e', canary ? 'setInterval(()=>{},1000)' : 'setTimeout(()=>process.exit(0),200)', '--', 'exec'], label: 'controlled deadline transport', adapterName: 'codex' },
          options: { timeoutMs: 1, deadlineMs: Date.now() - 1, onActiveChild: () => { spawned = true; },
            outputLogPath: path.join(f.runDir, path.dirname(issued.reference.path), 'agent-output.log') } }));
        const result = await executor.execute(f.context);
        assert(spawned, 'the deadline check must exercise an actual native child');
        assert.equal(result.timed_out === true, canary, JSON.stringify(result));
        assert.equal(invocationCompleted(result), !canary, 'a real timed-out tool cannot manufacture executor completion');
        if (canary) {
          assert(result.kill_attempted && !result.kill_error && !result.lingering_pipe, 'the controlled child must actually settle after the tool timeout');
          spawned = false;
          const repeated = await executor.execute(f.context);
          assert(repeated.skipped && repeated.timed_out && !spawned, 'the original expired tool window cannot restart from the next execution call');
        }
      } finally { f.cleanup(); }
    }
  },
}, {
  name: 'P3 author deadline ignores old default phase fields and actual canary tool deadline preserves its original issue instant',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue();
      const old = { ...issued.request, deadline: new Date(Date.now() - 60_000).toISOString(), gate_timeout_ms: 1 };
      assert.equal(sessionExecutionDeadlineMs(old), Infinity, 'legacy default phase deadline/gate values cannot become a user deadline');
      const user = new Date(Date.parse(issued.request.issued_at) + 500).toISOString();
      const limited = { ...old, context: { ...old.context, user_deadline_at: user } };
      assert.equal(sessionExecutionDeadlineMs(limited), Date.parse(user));
      const canary = { ...old, purpose: 'vision_canary', gate_timeout_ms: 300 };
      assert.equal(sessionExecutionDeadlineMs(canary), Date.parse(issued.request.issued_at) + 300);
      assert.equal(sessionExecutionDeadlineMs({ ...canary, context: { ...canary.context, user_deadline_at: new Date(Date.parse(issued.request.issued_at) + 200).toISOString() } }), Date.parse(issued.request.issued_at) + 200);
      assert.equal(sessionExecutionDeadlineMs({ ...old, purpose: 'questioning' }), Infinity, 'a verifier role is not a canary tool purpose');
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 same-fence expired and orphaned reports time out once without physical kill or validation eligibility',
  run() {
    const f = fixture();
    try {
      const startMs = Date.now() - 1000;
      Object.assign(f.context, { user_deadline_at: new Date(startMs + 500).toISOString() });
      f.start('invoke-one', new Date(startMs).toISOString()); const issued = f.issue('invoke-one', f.emit, 500);
      const expires = Date.parse(readRunControl(f.runDir)!.owner!.lease_expires_at!);
      markExpiredSessionOrphaned(f.runDir, 'run-1', expires + 1);
      const result = acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit, nowMs: expires + 1 });
      assert.deepEqual(result, { duplicate: false, timedOut: true });
      const end = sessionEvents(f.runDir).find(event => event.type === 'agent_invoke_end')!;
      assert.equal(end.timed_out, true); assert.equal(end.kill_reason, 'agent_timeout'); assert.equal(end.exit_code, 1);
      assert.equal(end.duration_ms, expires + 1 - startMs); assert.equal(end.effective_timeout_ms, 500);
      assert.equal((end as unknown as Record<string, unknown>).kill_attempted, undefined, 'a session timeout is not proof of a physical kill');
      assert.equal(sessionValidationOnlyEligibility(sessionEvents(f.runDir)), null);
      assert.equal(readRunControl(f.runDir)!.current_epoch, f.context.owner.epoch, 'module acceptance grants no takeover');
      const before = f.files(); acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit, nowMs: expires + 20_000 });
      assert.deepEqual(f.files(), before, 'duplicate timeout does not extend/recount its duration');
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 waiting and failed reports remain truthful and a later retry or invalidation removes validation-only eligibility',
  run() {
    for (const status of ['waiting', 'failed', 'passed'] as const) {
      const f = fixture();
      try {
        f.start(); const issued = f.issue(); acceptSessionExecution({ runDir: f.runDir, issued, report: { ...f.report, status }, emit: f.emit });
        assert.equal(acceptedSessionReport(f.runDir, issued)!.report.status, status);
        assert.equal(Boolean(sessionValidationOnlyEligibility(sessionEvents(f.runDir))), status !== 'waiting');
        assert.equal(repairInvocationCompleted(sessionEvents(f.runDir), 'coding', issued.request.invoke_id), status === 'passed', 'waiting cannot complete a repair owner');
        assert(!sessionEvents(f.runDir).some(event => event.type === 'harness_end' || event.type === 'phase_verdict'), 'executor reports never manufacture formal PASS');
        f.emit({ type: 'phase_invalidated', phase: 'coding' }); assert.equal(sessionValidationOnlyEligibility(sessionEvents(f.runDir)), null);
      } finally { f.cleanup(); }
    }
  },
}, {
  name: '1804 crash after attribution or report material preserves exactly one write observation and one accepted report',
  run() {
    for (const crashAt of ['phase_write_observed', 'agent_invoke_end']) {
      const f = fixture();
      try {
        f.start(); const issued = f.issue(); f.bind(issued); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'after\n');
        let crashed = false;
        assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: event => {
          if (!crashed && event.type === crashAt) { crashed = true; if (crashAt === 'phase_write_observed') f.emit(event); throw new Error('injected report process interruption'); }
          f.emit(event);
        } }), /injected report process interruption/);
        assert.equal(acceptedSessionReport(f.runDir, issued), null);
        acceptSessionExecution({ runDir: f.runDir, issued: readSessionExecution(f.runDir)!, report: f.report, emit: f.emit });
        const events = sessionEvents(f.runDir);
        assert.equal(events.filter(event => event.type === 'phase_write_observed').length, 1);
        assert.equal(events.filter(event => event.type === 'agent_invoke_end').length, 1);
        const accepted = acceptedSessionReport(f.runDir, issued)!;
        const archive = readHandoffMaterial<{ post_snapshot: { entries: Array<{ path: string; sha256: string }> } }>(f.runDir, accepted.event.handoff_report!);
        assert.equal(archive.post_snapshot.entries.find(entry => entry.path === 'src/value.ts')!.sha256, hash('after\n'));
      } finally { f.cleanup(); }
    }
  },
}, {
  name: '1804 production session entry duplicate next/report and wrong-phase report preserve the same dispatch and formal gates',
  async run() {
    const root = setupGoalRuntimeHost('codex').root;
    const observations: Array<Promise<void>> = [];
    const options = { projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId: 'session-independent-entry', adapter: 'codex', runMode: 'attended' };
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: options.runId, freshEndPhase: 'ut', viaSessionStep: true,
        onAuthor: () => {
          const manifest = loadGoalManifestFromRun(root, options.runId, { feature: options.feature }); const runDir = path.resolve(root, manifest.report_dir);
          const issued = readSessionExecution(runDir)!; const before = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
          observations.push(runGoalModeSessionStep(options).then(result => { assert.equal(result.type, 'phase_execute_request'); assert.equal((result.request as { sha256: string }).sha256, issued.reference.sha256); }));
          observations.push(runGoalModeSessionStep({ ...options, requestPath: path.join(runDir, issued.reference.path), report: { status: 'passed', phase: 'ut' } })
            .then(() => { throw new Error('wrong-phase report was accepted'); }, error => { assert.match(String(error), /invalid execution phase/); }));
          assert.equal(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'), before, 'entry queries/rejection cannot dispatch or write events');
        },
        afterHarnessPass: ({ phase }) => {
          if (phase !== 'spec') return;
          const manifest = loadGoalManifestFromRun(root, options.runId, { feature: options.feature }); const runDir = path.resolve(root, manifest.report_dir);
          const issued = readSessionExecution(runDir)!; const before = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
          observations.push(runGoalModeSessionStep({ ...options, requestPath: path.join(runDir, issued.reference.path), report: { status: 'passed', phase: issued.request.context.phase } })
            .then(result => { assert.equal(result.type, 'goal_session_report_received'); assert.equal(result.duplicate, true); }));
          assert.equal(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'), before, 'duplicate report cannot rerun a live formal gate');
        },
      });
      await Promise.all(observations);
      assert.equal(probe.exitCode, 0);
      assert.equal(probe.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length, 1);
      assert.equal(probe.events.filter(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author').length, 1);
      assert.equal(probe.harnessPhases.filter(phase => phase === 'spec').length, 1);
      assert(!probe.events.some(event => event.type === 'agent_process_settled'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production session accepted report survives a gate interruption and resumes validation without author reinvocation',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const runId = 'session-independent-resume'; let interrupted = false;
    try {
      try {
        await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'ut', viaSessionStep: true,
          testControl: { expectedInterruption: 'injected session formal gate interruption' },
          onHarnessSummary: ({ phase }) => { if (phase === 'ut' && !interrupted) { interrupted = true; throw new Error('injected session formal gate interruption'); } return null; },
        });
      } catch (error) { assert.match(String(error), /injected session formal gate interruption/); }
      assert(interrupted, 'must reach the production gate after report acceptance');
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }); const runDir = path.resolve(root, manifest.report_dir);
      const before = sessionEvents(runDir);
      assert.equal(before.filter(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author' && event.handoff_report).length, 1);
      assert(!before.some(event => event.type === 'phase_verdict' && event.phase === 'ut'));
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
      assert(!resumed.invokedPhases.includes('work-unit-author'), 'accepted executor must not be called again after gate interruption');
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length, 1);
      assert(!resumed.harnessPhases.includes('spec'), 'the completed bound producer is reused after the callback interruption');
      assert.deepEqual(resumed.harnessPhases, ['ut'], 'only the interrupted producer lacking its committed result runs again');
      assert(readReusableCheckResult({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId, phase: 'ut' }),
        'completion must reuse the current original producer proof rather than invent a missing phase verdict');
      const summary = JSON.parse(fs.readFileSync(path.join(root, 'doc/features/bc-openCard/ut/reports/summary.json'), 'utf8'));
      assert.equal(summary.receipt_status, 'passed'); assert.equal(summary.closure_status, 'closed');
    } catch (error) {
      const feature = path.join(root, 'doc/features/bc-openCard');
      const files = fs.readdirSync(feature, { recursive: true }).map(file => path.join(feature, String(file))).filter(file => fs.statSync(file).isFile());
      preserveRuntimeTestEvidence([root], String(error), ['1804 accepted report producer interruption'], files);
      throw error;
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: 'P1 production sessions do not inherit a default deadline from the old phase timeout',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const original = goalManifest.buildGoalManifestFromInput;
    const exports = goalManifest as unknown as Record<string, unknown>;
    try {
      exports.buildGoalManifestFromInput = (input: Record<string, unknown>, options: Parameters<typeof original>[1]) => original({ ...input,
        budget: { max_total_turns: 2, max_retries_per_phase: 1 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 0.01 } }, options);
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'session-native-deadline', freshEndPhase: 'spec', viaSessionStep: true,
        onAuthor: () => { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']); },
      });
      const starts = probe.events.filter(event => event.type === 'agent_invoke_start');
      const reports = probe.events.filter(event => event.type === 'agent_invoke_end' && event.handoff_report);
      assert.equal(starts.length, 1, 'an old phase timeout cannot create another dedicated author invocation');
      assert.equal(reports.length, starts.length);
      assert(reports.every(event => event.timed_out === false && event.kill_reason === undefined));
      assert(!probe.events.some(event => event.type === 'agent_process_settled'));
      assert(!probe.events.some(event => event.type === 'force_takeover' || event.type === 'owner_force_takeover'));
      const signed = probe.events.filter(event => event.type === 'phase_start' && event.handoff_request);
      assert.equal(signed.length, 1);
      assert.equal(probe.exitCode, 0, 'a completed original invocation still receives the real gate');
    } finally { exports.buildGoalManifestFromInput = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production waiting report preserves the original condition and only explicit continuation retries its author',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const runId = 'session-real-waiting';
    try {
      await assert.rejects(() => runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        testControl: { expectedInterruption: 'client paused with the original pending request' },
        onAuthor: () => { throw new Error('client paused with the original pending request'); },
      }), /client paused/);
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }); const runDir = path.resolve(root, manifest.report_dir);
      const issued = readSessionExecution(runDir)!; assert(issued);
      const parked = await runGoalModeSessionStep({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId, adapter: 'codex', runMode: 'attended',
        requestPath: path.join(runDir, issued.reference.path), report: { phase: issued.request.context.phase, status: 'waiting', details: 'client is waiting for a real external condition' } });
      assert.equal(parked.type, 'goal_session_result'); assert.equal((parked.result as { status: string }).status, 'waiting');
      const waiting = sessionEvents(runDir);
      assert.equal(sessionValidationOnlyEligibility(waiting), null);
      assert(!waiting.some(event => event.type === 'harness_start' || event.type === 'harness_end' || event.type === 'phase_verdict' && event.verdict === 'PASS'));
      assert(waiting.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting'));
      const held = await runGoalModeSessionStep({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId,
        adapter: 'codex', runMode: 'attended' });
      assert.equal(held.type, 'goal_session_result');
      assert.equal(sessionEvents(runDir).filter(event => event.type === 'agent_invoke_start').length, 1, 'accepted waiting report is not a transport-specific retry grant');
      const eventsPath = path.join(runDir, 'events.jsonl');
      fs.writeFileSync(eventsPath, fs.readFileSync(eventsPath, 'utf8').split('\n').map(line => {
        if (!line.trim()) return line;
        const event = JSON.parse(line) as { type: string; ts?: string };
        if (event.type === 'run_end') event.ts = new Date(Date.now() - 10 * 60_000).toISOString();
        return JSON.stringify(event);
      }).join('\n'));
      const unchanged = await runGoalModeSessionStep({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId,
        adapter: 'codex', runMode: 'attended' });
      assert.equal(unchanged.type, 'goal_session_result', 'elapsed time cannot invent a changed waiting condition');
      assert.equal(sessionEvents(runDir).filter(event => event.type === 'agent_invoke_start').length, 1);
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, forceResume: true, viaSessionStep: true, skipLegacySeal: true });
      assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
      assert(resumed.invokedPhases.includes('work-unit-author'), 'a waiting author has not earned validation-only recovery');
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author').length, 2);
      assert.equal(resumed.harnessPhases.filter(phase => phase === 'spec').length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: 'P1 production next reuses an unreported session beyond an old phase timeout without resigning it',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const original = goalManifest.buildGoalManifestFromInput; const runId = 'session-next-no-report';
    const exports = goalManifest as unknown as Record<string, unknown>;
    try {
      exports.buildGoalManifestFromInput = (input: Record<string, unknown>, options: Parameters<typeof original>[1]) => original({ ...input,
        budget: { max_total_turns: 2, max_retries_per_phase: 1 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 0.01 } }, options);
      await assert.rejects(() => runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        testControl: { expectedInterruption: 'client exited without reporting' },
        onAuthor: () => { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']); throw new Error('client exited without reporting'); },
      }), /client exited without reporting/);
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }); const runDir = path.resolve(root, manifest.report_dir);
      const originalRequest = readSessionExecution(runDir)!;
      const requestBytes = fs.readFileSync(path.join(runDir, originalRequest.reference.path));
      assert.equal(acceptedSessionReport(runDir, originalRequest), null);
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      const accepted = acceptedSessionReport(runDir, originalRequest)!;
      assert(accepted); assert.equal(accepted.event.timed_out, false); assert.equal(accepted.report.status, 'passed');
      assert.deepEqual(fs.readFileSync(path.join(runDir, originalRequest.reference.path)), requestBytes, 'timeout closure must not rewrite the signed original');
      const starts = probe.events.filter(event => event.type === 'agent_invoke_start'); assert.equal(starts.length, 1);
      const signed = probe.events.filter(event => event.type === 'phase_start' && event.handoff_request); assert.equal(signed.length, 1);
      assert(!probe.events.some(event => event.type === 'agent_process_settled'), JSON.stringify(probe.events.filter(event => event.type === 'agent_process_settled')));
    } finally { exports.buildGoalManifestFromInput = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}];

export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
