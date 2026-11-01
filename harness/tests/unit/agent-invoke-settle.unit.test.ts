// agent-invoke-settle.unit.test.ts — exit-first child settlement + pipe inheritance integration

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import {
  createChildSettleWaiter,
  DEFAULT_CHILD_SETTLE_GRACE_MS,
  DEFAULT_FORCE_SETTLE_AFTER_KILL_MS,
  normalizeChildExitCode,
  awaitPromiseWithTimeout,
  killProcessTree,
  probeAdapterVersion,
  defaultHeadlessInvokePlan,
  invokeAgentHeadless,
  resolveAgentOutputIdleMs,
  readProviderSessionId,
  withProviderSession,
  withInvocationAuthorization,
  providerSessionRebuildReason,
  providerSessionUnavailableReason,
  extractProviderSessionId,
  extractProviderFinalText,
} from '../../scripts/utils/agent-invoke';
import { createCodexTerminalScanner } from '../../scripts/utils/codex-terminal-events';
import { extractCodexAgentMessageText } from '../../scripts/utils/codex-terminal-events';
import { applyIndependentQuestioningOutput, validateBlueprintQuestioning } from '../../scripts/utils/blueprint-questioning';
import * as agentInvoke from '../../scripts/utils/agent-invoke';
import { createWorkUnitExecutionContext, DetachedGoalPhaseExecutor, type WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { invocationCompleted, invocationEndFacts } from '../../scripts/utils/invocation-completion';
import { writePhaseExecutionRequestMaterial } from '../../scripts/utils/session-execution-handoff';
import { buildInitialDesignGoalManifest, writeGoalManifest } from '../../scripts/utils/goal-manifest';
import * as YAML from 'yaml';
import type { UnitCaseResult } from '../run-unit';
import { clearFrameworkConfigCache } from '../../config';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function fakeChild(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'P1 native author recovery validates seeds against real design targets and keeps implementation and verifier streams separate',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-author-unit-'));
      const runDir = path.join(root, 'caller-run'); fs.mkdirSync(runDir);
      const base: WorkUnitExecutionContext = { runId: 'caller', feature: 'cu-existing', workflowId: 'obligation-driven', track: 'full', chain: ['coding'], phase: 'coding', attemptId: 'current',
        owner: { run_id: 'caller', owner_id: 'owner', epoch: 1, kind: 'process' }, projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), runDir, reportDir: 'caller-run', adapter: 'codex',
        childEnv: {}, runtimeFacts: { receiptRequired: false, resume: false, successor: false } };
      const append = (directory: string, event: Record<string, unknown>) => fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(event) + '\n');
      const record = async (ctx: WorkUnitExecutionContext, id: string) => {
        append(ctx.runDir, { type: 'agent_invoke_start', phase: ctx.phase, purpose: 'author', invoke_id: ctx.attemptId });
        const issued = writePhaseExecutionRequestMaterial({ context: ctx, invokeId: ctx.attemptId, purpose: 'author', preSnapshot: null, writeBoundary: null,
          gateTimeoutMs: 10_000, cleanupReserveMs: 100, issuedAt: new Date().toISOString() });
        const outputLogPath = path.join(ctx.runDir, path.dirname(issued.reference.path), 'agent-output.log');
        const stream = [{ type: 'thread.started', thread_id: id }, { type: 'turn.completed' }].map(row => JSON.stringify(row)).join('\n') + '\n';
        const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(stream)});`], label: 'controlled native author identity', adapterName: 'codex' }, root, { outputLogPath });
        assert(invocationCompleted(result) && result.provider_session_id === id, 'the original invocation must supply the native identity');
        append(ctx.runDir, { type: 'agent_invoke_end', phase: ctx.phase, invoke_id: ctx.attemptId, ...invocationEndFacts(result) });
        return outputLogPath;
      };
      const target = (blueprintId: string) => {
        const original = { baseline: Buffer.from(YAML.stringify({ artifact: 'component-blueprint@1', blueprint_id: blueprintId, component_id: 'different-component-id', revision: 1 })).toString('base64') };
        const file = path.join(runDir, `original-${blueprintId}.json`); const bytes = JSON.stringify(original); fs.writeFileSync(file, bytes);
        append(runDir, { type: 'design_authority_repair', stage: 'attempted', blueprint_id: blueprintId, signature: blueprintId,
          handoff_context: { path: path.basename(file), sha256: require('crypto').createHash('sha256').update(bytes).digest('hex') } });
      };
      try {
        await record({ ...base, attemptId: 'implementation-one' }, 'implementation-native');
        assert(createWorkUnitExecutionContext({ ...base, phase: 'design-repair-author', provider_session_id: 'implementation-native' }).provider_session_id === undefined,
          'a design label without an original target cannot inherit the CU implementation seed');
        target('blueprint-one');
        assert(createWorkUnitExecutionContext({ ...base, phase: 'design-repair-author', provider_session_id: 'implementation-native' }).provider_session_id === undefined,
          'a real design target still starts new when only an implementation SID exists');
        const designLog = await record({ ...base, phase: 'design-repair-author', attemptId: 'design-one' }, 'design-native');
        assert(createWorkUnitExecutionContext({ ...base, phase: 'design-repair-author', provider_session_id: 'implementation-native' }).provider_session_id === 'design-native', 'same real design target recovers its own SID rather than trusting the supplied CU seed');
        assert(createWorkUnitExecutionContext({ ...base, phase: 'ut', provider_session_id: 'design-native' }).provider_session_id === 'implementation-native', 'implementation methods share their own author while rejecting the design seed');
        assert(createWorkUnitExecutionContext({ ...base, phase: 'questioning', provider_session_id: 'design-native' }).provider_session_id === undefined, 'independent Q never inherits either author');
        target('blueprint-two');
        assert(createWorkUnitExecutionContext({ ...base, phase: 'design-repair-author', provider_session_id: 'design-native' }).provider_session_id === undefined, 'another actual design object does not inherit the old object session');
        target('blueprint-one'); fs.unlinkSync(path.join(path.dirname(designLog), 'agent-events.jsonl'));
        assert(createWorkUnitExecutionContext({ ...base, phase: 'design-repair-author', provider_session_id: 'implementation-native' }).provider_session_id === undefined, 'legacy missing design native bytes cannot fall back to the CU author');
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'native-unit-test', project_profile: { name: 'generic' }, paths: { features_dir: 'doc/features' } }));
        const manifest = buildInitialDesignGoalManifest({ feature: 'root-blueprint', run_id: 'real-design-root', adapter: 'codex', requirement: 'existing independent design unit',
          initial_design: { completion_target: 'feature', requested_results: ['approved design'], requested_phases: ['plan'] }, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
        const rootRun = path.dirname(writeGoalManifest(manifest, root));
        const rootContext = { ...base, feature: manifest.feature, runId: manifest.run_id, runDir: rootRun, reportDir: manifest.report_dir,
          owner: { ...base.owner, run_id: manifest.run_id }, phase: 'initial-design-author', attemptId: 'root-author-one' };
        await record(rootContext, 'root-design-native');
        assert(createWorkUnitExecutionContext({ ...rootContext, attemptId: 'root-author-two', provider_session_id: 'implementation-native' }).provider_session_id === 'root-design-native', 'an actual initial-design manifest resumes only its original root author');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 output-idle protection kills a real silent tree, preserves unknown work and recovers the exact native session',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-idle-native-'));
      const runDir = path.join(root, 'run');
      const directory = path.join(runDir, 'phases/coding/idle-one'); fs.mkdirSync(directory, { recursive: true });
      const timers = agentInvoke as unknown as { DEFAULT_AGENT_OUTPUT_IDLE_MS: number };
      const originalIdle = timers.DEFAULT_AGENT_OUTPUT_IDLE_MS;
      const ctx: WorkUnitExecutionContext = { runId: 'idle-run', feature: 'demo', workflowId: 'obligation-driven', track: 'full', chain: ['coding'],
        phase: 'coding', attemptId: 'idle-one', owner: { run_id: 'idle-run', owner_id: 'idle-owner', epoch: 1, kind: 'process' },
        projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), runDir, reportDir: 'run', adapter: 'codex',
        childEnv: {}, runtimeFacts: { receiptRequired: false, resume: false, successor: false } };
      const events = path.join(runDir, 'events.jsonl');
      const tick = path.join(root, 'grandchild-tick');
      const pidFile = path.join(root, 'grandchild-pid');
      fs.writeFileSync(path.join(directory, 'request-e1.json'), JSON.stringify({ context: ctx }));
      fs.writeFileSync(events, JSON.stringify({ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'idle-one' }) + '\n');
      let grandchild = 0;
      try {
        timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = 1_500;
        const grand = `const fs=require('fs');setInterval(()=>fs.writeFileSync(${JSON.stringify(tick)},String(Date.now())),25);`;
        const body = `const fs=require('fs');const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:'ignore',windowsHide:true});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));fs.writeFileSync(${JSON.stringify(path.join(root, 'partial-work'))},'legitimate partial work');process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'idle-native-42'})+'\\n');setInterval(()=>{},1000);`;
        const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', body], label: 'controlled silent native protocol', adapterName: 'codex' }, root,
          { outputLogPath: path.join(directory, 'agent-output.log') });
        grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
        assert(result.interrupted === true && result.kill_attempted === true && !invocationCompleted(result), JSON.stringify(result));
        assert(!result.timed_out && !result.terminal_failure_observed && result.provider_session_id === 'idle-native-42', 'silence is unknown, not an author deadline or product failure');
        assert(result.stderr.includes('results unknown') && fs.readFileSync(path.join(root, 'partial-work'), 'utf8') === 'legitimate partial work', 'diagnostic and legitimate bytes survive');
        const lastTick = fs.readFileSync(tick, 'utf8');
        await new Promise(resolve => setTimeout(resolve, 120));
        assert(fs.readFileSync(tick, 'utf8') === lastTick, 'the real grandchild must stop, not just release a pipe');
        fs.appendFileSync(events, JSON.stringify({ type: 'agent_invoke_end', phase: 'coding', invoke_id: 'idle-one', ...invocationEndFacts(result) }) + '\n');
        const next = createWorkUnitExecutionContext({ ...ctx, phase: 'ut', attemptId: 'idle-two' });
        assert(next.provider_session_id === 'idle-native-42', 'the next request resumes the original observed native identity');
        const nativePlan = defaultHeadlessInvokePlan('codex', { write_mode: 'full-access', approval_mode: 'never' }, 'continue');
        const expected = withProviderSession(nativePlan, next.provider_session_id);
        const fakeCli = path.join(root, 'resume-cli.cjs'), received = path.join(root, 'resume-received.json');
        fs.writeFileSync(fakeCli, `const fs=require('fs'),assert=require('assert').strict;
const argv=process.argv.slice(2);let stdin='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>stdin+=chunk);
process.stdin.on('end',()=>{
 assert.deepEqual(argv,${JSON.stringify(expected.argv.slice(1))});
 const at=argv.indexOf('exec');assert.equal(argv[at+1],'resume');assert.deepEqual(argv.slice(-2),['idle-native-42','-']);
 assert.equal(stdin,'continue');const work=fs.readFileSync(${JSON.stringify(path.join(root, 'partial-work'))},'utf8');assert.equal(work,'legitimate partial work');
 fs.writeFileSync(${JSON.stringify(received)},JSON.stringify({argv,stdin,work}));
 process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'idle-native-42'})+'\\n'+JSON.stringify({type:'turn.completed'})+'\\n');
});
`);
        const resumedDirectory = path.join(runDir, 'phases/ut/idle-two'); fs.mkdirSync(resumedDirectory, { recursive: true });
        const resumed = await invokeAgentHeadless({ ...nativePlan, argv: [process.execPath, fakeCli, ...nativePlan.argv.slice(1)],
          resolvedBinary: undefined, label: 'controlled fake Codex CLI receives actual resume argv/stdin' }, root,
          { providerSessionId: next.provider_session_id, outputLogPath: path.join(resumedDirectory, 'agent-output.log') });
        const receipt = JSON.parse(fs.readFileSync(received, 'utf8'));
        assert(invocationCompleted(resumed) && resumed.provider_session_id === next.provider_session_id && !resumed.interrupted && !resumed.kill_attempted,
          'the second real fake-CLI process must consume the exact resume transport and naturally complete');
        console.log('NATIVE_RESUME_PROTOCOL_EXECUTED ' + JSON.stringify({ executable: process.execPath, entry: fakeCli, ...receipt,
          provider_session_id: resumed.provider_session_id, completion_observed: resumed.completion_observed, controlled_fake_cli: true }));
      } finally { timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = originalIdle; if (grandchild) await killProcessTree(grandchild); fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 output-idle window follows the public tool limit: configured two-hour tool survives scaled hundred-minute silence',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-idle-configured-'));
      const timers = agentInvoke as unknown as { DEFAULT_AGENT_OUTPUT_IDLE_MS: number };
      const originalIdle = timers.DEFAULT_AGENT_OUTPUT_IDLE_MS;
      const writeTimeout = (timeoutMs: number, aaTestTimeoutMs?: number) => {
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: 'generic',
          toolchain: { hvigor: { timeoutMs }, ...(aaTestTimeoutMs ? { hmosDevice: { aaTestTimeoutMs } } : {}) } }));
        clearFrameworkConfigCache();
      };
      try {
        assert(resolveAgentOutputIdleMs(root) === 90 * 60_000, 'default coding45min/UT15min retain the90min floor');
        writeTimeout(2 * 60 * 60_000);
        assert(resolveAgentOutputIdleMs(root) === 165 * 60_000, 'real public2h configuration includes45min checking headroom');
        writeTimeout(6 * 60 * 60_000);
        assert(resolveAgentOutputIdleMs(root) === 405 * 60_000, 'the existing public6h limit is honored without an author total deadline');
        writeTimeout(45 * 60_000, 2 * 60 * 60_000);
        assert(resolveAgentOutputIdleMs(root) === 165 * 60_000, 'the public aa-test limit uses the same recipe');
        // Same recipe, 1 logical minute = 10ms; no real model or100-minute wait.
        timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = 900;
        writeTimeout(1_200);
        const result = await invokeAgentHeadless({ argv: [process.execPath, '-e',
          `process.stdout.write('{"type":"thread.started","thread_id":"configured-native"}\\n');setTimeout(()=>process.stdout.write('{"type":"turn.completed"}\\n'),1000);`],
          label: 'configured silent tool replay, scaled time', adapterName: 'codex' }, root);
        assert(invocationCompleted(result) && result.provider_session_id === 'configured-native' && !result.interrupted && !result.kill_attempted,
          '100min scaled silence exceeds the old90min floor but remains inside the actual configured tool window');
      } finally {
        timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = originalIdle;
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P1 output-idle protection permits active authors beyond an obsolete phase timeout and preserves terminal cleanup',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-idle-active-'));
      const timers = agentInvoke as unknown as { DEFAULT_AGENT_OUTPUT_IDLE_MS: number };
      const originalIdle = timers.DEFAULT_AGENT_OUTPUT_IDLE_MS;
      let terminalPid = 0;
      try {
        timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = 1_000;
        const ctx: WorkUnitExecutionContext = { runId: 'active-run', feature: 'demo', workflowId: 'obligation-driven', track: 'full', chain: ['coding'], phase: 'coding', attemptId: 'active-one',
          owner: { run_id: 'active-run', owner_id: 'active-owner', epoch: 1, kind: 'process' }, projectRoot: root, frameworkRoot: root, runDir: root, reportDir: '.', adapter: 'codex',
          childEnv: {}, runtimeFacts: { receiptRequired: false, resume: false, successor: false } };
        const body = `const t=setInterval(()=>process.stderr.write('actual native progress\\n'),100);setTimeout(()=>{clearInterval(t);process.stdout.write('{"type":"turn.completed"}\\n');},2200);`;
        const executor = new DetachedGoalPhaseExecutor(() => ({ cwd: root, plan: { argv: [process.execPath, '-e', body], label: 'controlled active author', adapterName: 'terminal-replay-fixture' },
          options: { timeoutMs: 20, terminalEventParser: 'codex_turn_jsonl' } }));
        const result = await executor.execute(ctx);
        assert(result.status === 'passed' && result.completion_observed === true && !result.interrupted && !result.kill_attempted && (result.duration_ms ?? 0) > 2_000, JSON.stringify(result));
        // The accelerated idle window above tests active output, not native-process startup latency.
        // Terminal cleanup uses the real idle policy; a separate fixture watchdog still makes a hung cleanup fail.
        timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = originalIdle;
        const terminalStarted = Date.now();
        const observations: Array<{ after_ms: number; type: string }> = [];
        const pending = invokeAgentHeadless({ argv: [process.execPath, '-e', `process.stdout.write('{"type":"turn.completed"}\\n');setInterval(()=>{},1000);`], label: 'completed child still alive', adapterName: 'terminal-replay-fixture' }, root,
          { terminalEventParser: 'codex_turn_jsonl', completionGraceMs: 100,
            onActiveChild: child => { terminalPid = child.pid; },
            onObservation: observation => observations.push({ after_ms: Date.now() - terminalStarted, type: observation.type }) });
        const completed = await awaitPromiseWithTimeout<Awaited<typeof pending> | null>(pending, agentInvoke.resolveKillGraceMs() + 5_000, null);
        if (!completed) {
          if (terminalPid) await killProcessTree(terminalPid);
          throw new Error('terminal cleanup did not settle within the independent fixture watchdog: ' + JSON.stringify({ terminalPid, observations }));
        }
        let childAlive = false;
        try { process.kill(terminalPid, 0); childAlive = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        console.log('NATIVE_TERMINAL_CLEANUP_EXECUTED ' + JSON.stringify({ observations, child_alive_after_return: childAlive, result: completed }));
        assert(completed.completion_observed === true && completed.kill_attempted === true && !completed.interrupted && !completed.timed_out,
          'terminal completion retains its existing grace/tree cleanup: ' + JSON.stringify({ observations, result: completed }));
        assert(!childAlive, 'terminal cleanup must actually stop the original still-running process, not merely settle its pipe');
      } finally {
        timers.DEFAULT_AGENT_OUTPUT_IDLE_MS = originalIdle;
        if (terminalPid) {
          try { process.kill(terminalPid, 0); await killProcessTree(terminalPid); } catch { /* Already exited. */ }
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P1 structured tool results publish persisted observations; commentary and text delta never trigger snapshots',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-native-tool-result-'));
      const records: Record<string, unknown[]> = {
        codex: [
          { type: 'item.completed', item: { type: 'agent_message', text: 'tool_result: I will inspect files.' } },
          { type: 'item.started', item: { type: 'command_execution', command: 'echo tool_result' } },
          ...['command_execution', 'mcp_tool_call', 'file_change', 'web_search'].map(type => ({ type: 'item.completed', item: { type, status: 'completed' } })),
          { type: 'turn.completed' },
        ],
        claude: [
          { type: 'assistant', message: { content: [{ type: 'text', text: 'tool_result' }, { type: 'tool_use', name: 'Read', id: 'call-1' }] } },
          { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'tool_result' } } },
          { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'real output' }] } },
          { type: 'result', subtype: 'success', is_error: false, result: 'DONE' },
        ],
        'deepseek-harness': [
          { type: 'text', text: 'tool_result' },
          { type: 'thinking', text: 'I will run a tool_result check.' },
          { type: 'tool_call', callId: 'call-1', tool: 'read', input: {} },
          { type: 'tool_result', callId: 'call-1', status: 'completed', result: 'real output' },
          { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } },
        ],
      };
      try {
        for (const [adapter, events] of Object.entries(records)) {
          const directory = path.join(root, adapter); fs.mkdirSync(directory);
          const outputLogPath = path.join(directory, 'agent-output.log');
          const raw = events.map(record => JSON.stringify(record)).join('\n') + '\n';
          const completedTools = adapter === 'codex' ? events.slice(2, 6) : [events[adapter === 'claude' ? 2 : 3]];
          let observations = 0;
          const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(raw)});`],
            label: 'structured-tool-fixture', adapterName: adapter }, root, { outputLogPath, onObservation: observation => {
              if (observation.type !== 'tool_result') return;
              observations++;
              assert(fs.readFileSync(path.join(directory, 'agent-events.jsonl'), 'utf8').includes(JSON.stringify(completedTools[observations - 1])),
                'raw provider result must be persisted before observation');
            } });
          assert(result.exitCode === 0 && observations === (adapter === 'codex' ? 4 : 1), `${adapter}: only real structured tool results notify`);
        }
        for (const terminalEventParser of ['codex_turn_jsonl', 'none'] as const) {
          const directory = path.join(root, `neutral-${terminalEventParser}`); fs.mkdirSync(directory);
          const outputLogPath = path.join(directory, 'agent-output.log');
          const raw = records.codex.map(record => JSON.stringify(record)).join('\n') + '\n';
          let observations = 0;
          const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(raw)});`],
            label: 'neutral-protocol-fixture', adapterName: 'terminal-replay-fixture' }, root, {
            outputLogPath, terminalEventParser, ...(terminalEventParser === 'none' ? { toolEventCapture: 'structured_events' as const } : {}), onObservation: observation => {
              if (observation.type !== 'tool_result') return;
              observations++;
              assert(fs.readFileSync(path.join(directory, 'agent-events.jsonl'), 'utf8').includes(JSON.stringify(records.codex[observations + 1])), 'neutral protocol raw result must precede notification');
            },
          });
          assert(result.exitCode === 0 && observations === (terminalEventParser === 'codex_turn_jsonl' ? 4 : 0), 'only an explicit known structured protocol can notify for a neutral transport');
          assert(result.provider_session_id === undefined && !result.command.includes('--sandbox'), 'a replay parser must not turn Node into a native Codex invocation');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 Codex questioning consumes final JSON after commentary without changing canary projection',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-native-final-'));
      try {
        const blueprint = path.join(root, 'blueprint.yaml');
        const initial = 'review_summary:\n  authored_by: author\n';
        fs.writeFileSync(blueprint, initial);
        const preamble = { type: 'item.completed', item: { type: 'agent_message', text: '我会先检查当前产物。' } };
        const answer = JSON.stringify({ items: [{ question_id: 'q1' }] });
        const message = { type: 'item.completed', item: { type: 'agent_message', text: answer } };
        const stream = [preamble, message, { type: 'turn.completed' }].map(record => JSON.stringify(record)).join('\n');
        const final = extractProviderFinalText(stream, 'codex');
        assert(final === answer, 'commentary must not prefix final JSON');
        const applied = applyIndependentQuestioningOutput(blueprint, path.join(root, 'questioning.json'), final!, 'independent-q');
        assert(applied.provider_id === 'independent-q' && Array.isArray(applied.items), 'real questioning writer receives final JSON');
        assert(extractCodexAgentMessageText(stream) === `${preamble.item.text}\n${answer}`, 'canary keeps ordered messages');
        const onlyPreamble = [preamble, { type: 'turn.completed' }].map(record => JSON.stringify(record)).join('\n');
        fs.writeFileSync(blueprint, initial);
        let rejected = false;
        try { applyIndependentQuestioningOutput(blueprint, path.join(root, 'missing.json'),
          extractProviderFinalText(onlyPreamble, 'codex')!, 'independent-q'); } catch { rejected = true; }
        assert(rejected && fs.readFileSync(blueprint, 'utf8') === initial, 'commentary alone cannot write questioning');
        assert(validateBlueprintQuestioning({ review_summary: { authored_by: 'author' } })
          .some(item => item.id === 'blueprint_questioning_provider_missing'), 'existing checker keeps missing result');
        assert(extractProviderFinalText(JSON.stringify(message), 'codex') === null, 'no terminal cannot supply final');
        assert(extractProviderFinalText(stream + '\n{"type":"turn.failed"}', 'codex') === null, 'failure cannot supply final');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 readonly is independent from review identity and unsupported native readonly is disclosed',
    run: async () => {
      const full = { write_mode: 'full-access' as const, approval_mode: 'never' as const };
      const review = withInvocationAuthorization(defaultHeadlessInvokePlan('claude', full, 'review'), {
        authorization: full, executionRole: 'verifier', readonlyInvocation: false,
      });
      assert(review.argv.includes('--dangerously-skip-permissions') && !review.argv.includes('--tools'), 'independent review keeps its original tools');
      for (const adapter of ['deepseek-harness', 'codeagent', 'cursor', 'opencode', 'generic']) {
        const plan = { argv: ['fixture-cli'], adapterName: adapter, label: 'fixture' };
        assert(withInvocationAuthorization(plan, { authorization: full, executionRole: 'verifier', readonlyInvocation: true })
          .argv.join(' ') === 'fixture-cli', `${adapter}: existing snapshot fallback keeps original native tools`);
      }
      const generic = await invokeAgentHeadless({ argv: [process.execPath, '-e', "process.stdout.write('OK')"],
        adapterName: 'generic', label: 'fixture' }, process.cwd(), {
        authorization: full, executionRole: 'verifier', readonlyInvocation: true,
      });
      assert(generic.exitCode === 0 && generic.readonly_enforced === false && !!generic.readonly_diagnostic,
        'caller can apply its existing write snapshot; lack of native readonly is not permanent transport failure');
    },
  },
  {
    name: 'P1 completion before cancel stays completed; failure or cancel first never becomes completed',
    run: async () => {
      for (const first of ['completed', 'failed', 'cancelled']) {
        const controller = new AbortController();
        const event = first === 'cancelled' ? '{"type":"thread.started","thread_id":"cancel-first"}'
          : `{"type":"turn.${first}"}`;
        const source = `process.stdout.write(${JSON.stringify(event + '\n')}); setTimeout(() => { process.stdout.write('{"type":"turn.completed"}\\n'); process.exit(0); }, 80);`;
        const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', source], label: 'fixture', adapterName: 'codex' }, process.cwd(), {
          signal: controller.signal, completionGraceMs: 150, timeoutMs: 2000,
          onObservation: observation => {
            if (observation.type === 'terminal' || first === 'cancelled' && observation.type === 'provider_session') controller.abort();
          },
        });
        assert(first === 'completed' ? result.completion_observed === true && !result.interrupted
          : result.exitCode !== 0 && !result.completion_observed, JSON.stringify({ first, result }));
      }
    },
  },
  {
    name: 'P1 missing native sessions use exact sampled errors, never auth/quota failure or model prose',
    run: () => {
      const id = 'exact-42';
      assert(providerSessionUnavailableReason('codex', id, '', `Error: thread/resume: thread/resume failed: no rollout found for thread id ${id} (code -32600)`) === 'provider_session_not_found', 'codex missing');
      assert(providerSessionUnavailableReason('claude', id, JSON.stringify({ type: 'result', is_error: true, errors: [`No conversation found with session ID: ${id}`] }), '') === 'provider_session_not_found', 'Claude missing');
      assert(providerSessionUnavailableReason('deepseek-harness', id, JSON.stringify({ type: 'error', message: `session "${id}" does not exist; omit --session-id to start a new Session` }), '') === 'provider_session_not_found', 'DSH missing');
      for (const adapter of ['codex', 'claude', 'deepseek-harness']) {
        assert(!providerSessionUnavailableReason(adapter, id, '{"type":"error","message":"429 quota unavailable"}', '401 authentication failed'), 'environment failure stays environment');
      }
      assert(!extractProviderSessionId({ type: 'result', is_error: true, subtype: 'error_during_execution', session_id: id }, 'claude'), 'failed lookup echoes no live session');
      assert(!extractProviderSessionId({ type: 'assistant', content: `session_id=${id}` }, 'codex'), 'no prose identity');
    },
  },
  {
    name: 'P1 DSH final text and waiting are not completion; committed turn terminal is shared fact',
    run: () => {
      const scanner = createCodexTerminalScanner({}, 'deepseek_run_jsonl');
      scanner.push('{"type":"session","sessionId":"session-42"}\n{"type":"final","text":"PASS"}\n');
      assert(!scanner.state().completionObserved, 'text is not completion');
      scanner.push('{"type":"status","phase":"turn_end","reason":{"kind":"waiting"}}\n');
      assert(!scanner.state().completionObserved, 'waiting unfinished');
      scanner.push('{"type":"status","phase":"turn_end","reason":{"kind":"completed"}}\n');
      assert(scanner.state().completionObserved, 'native completed');
      scanner.push('{"type":"error","message":"real terminal failure"}\n');
      assert(!scanner.state().completionObserved && scanner.state().terminalFailureObserved, 'failure wins');
      assert(extractProviderFinalText('{"type":"final","text":"actual answer"}\n', 'deepseek-harness') === 'actual answer', 'text projection');
    },
  },
  {
    name: 'P1 exact native resume keeps current sandbox/model and never selects --last',
    run: () => {
      const authority = { write_mode: 'full-access' as const, approval_mode: 'never' as const, max_turns: 1 };
      for (const adapter of ['codex', 'claude', 'deepseek-harness']) {
        const plan = defaultHeadlessInvokePlan(adapter, authority, 'continue', undefined, 'pinned-model');
        const resumed = withProviderSession(plan, 'exact-id-42');
        assert(!resumed.argv.includes('--last'), adapter);
        assert(!resumed.argv.includes('--max-turns') && !resumed.argv.includes('--max-budget-usd'), 'no quota');
        assert(resumed.argv.includes('exact-id-42'), 'exact ID');
        if (adapter === 'codex') {
          assert(resumed.argv.includes('resume') && resumed.argv.includes('sandbox_mode="danger-full-access"'), 'codex resume sandbox');
          assert(resumed.argv.includes('pinned-model'), 'model preserved');
        } else assert(resumed.argv.includes(adapter === 'claude' ? '--resume' : '--session-id'), 'native flag');
      }
      let refused = false;
      try { withProviderSession({ argv: ['custom'], label: 'custom', adapterName: 'generic' }, 'exact-id'); }
      catch { refused = true; }
      assert(refused, 'unknown resume is not invented');
    },
  },
  {
    name: 'P1 current permissions are real native flags and changed authority rebuilds',
    run: () => {
      const full = { write_mode: 'full-access' as const, approval_mode: 'never' as const };
      const narrow = { write_mode: 'workspace-write' as const, approval_mode: 'never' as const };
      const codex = withInvocationAuthorization(defaultHeadlessInvokePlan('codex', full, 'p'), { authorization: narrow });
      assert(codex.argv[codex.argv.indexOf('--sandbox') + 1] === 'workspace-write', 'current sandbox');
      const implicit = withInvocationAuthorization({ argv: ['codex', 'exec', '--json'], adapterName: 'codex', label: 'codex exec' }, { authorization: narrow });
      assert(implicit.argv[implicit.argv.indexOf('--sandbox') + 1] === 'workspace-write'
        && implicit.argv.indexOf('--ask-for-approval') < implicit.argv.indexOf('exec'), 'valid implicit defaults compile to current explicit authorization');
      let invalidCodex = false;
      try { withInvocationAuthorization({ argv: [process.execPath, 'script.js'], adapterName: 'codex', label: 'invalid' }, { authorization: full }); }
      catch { invalidCodex = true; }
      assert(invalidCodex, 'vendor authorization is not silently ignored for a non-Codex command');
      const q = withInvocationAuthorization(defaultHeadlessInvokePlan('claude', full, 'p'), { executionRole: 'verifier', readonlyInvocation: true });
      assert(!q.argv.includes('--dangerously-skip-permissions'), 'readonly cannot inherit bypass');
      assert(q.argv.includes('Read,Glob,Grep') && q.argv.includes('--strict-mcp-config'), 'readonly tools, no MCP write route');
      assert(providerSessionRebuildReason('claude', { previousAuthorization: full, authorization: narrow }) === 'provider_session_authorization_changed', 'authority rebuild');
      assert(providerSessionRebuildReason('claude', { previousAuthorization: full, authorization: full, instructionsChanged: true }) === 'provider_session_system_prompt_snapshot', 'Claude snapshot rebuild');
      assert(providerSessionRebuildReason('codex', { previousAuthorization: full, authorization: full }) === undefined, 'ordinary continuation');
      assert(providerSessionRebuildReason('claude', { previousAuthorization: full, authorization: { ...full, allowed_tools: [] } }) === 'provider_session_authorization_changed', 'empty tools narrow from unrestricted');
    },
  },
  {
    name: 'P1 identity envelope persists before observation, survives memory truncation and recovers from same stream',
    run: async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-native-id-'));
      try {
        const output = path.join(root, 'agent-output.log');
        let observed = false;
        const source = `process.stdout.write('{"type":"thread.started","thread_id":"exact-42"}\\n'); setTimeout(() => { process.stdout.write('x'.repeat(70000)+'\\n'); process.stdout.write('{"type":"turn.completed"}\\n'); }, 30);`;
        const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', source], label: 'fixture', adapterName: 'codex' }, root, {
          timeoutMs: 2000,
          outputLogPath: output,
          onObservation: observation => {
            if (observation.type !== 'provider_session') return;
            observed = true;
            assert(readProviderSessionId(path.join(root, 'agent-events.jsonl'), 'codex') === 'exact-42', 'already on disk');
          },
        });
        assert(observed && result.provider_session_id === 'exact-42', 'live ID');
        assert(result.completion_observed === true && !result.stdout.includes('thread.started'), 'memory truncation does not lose persisted ID');
        fs.appendFileSync(path.join(root, 'agent-events.jsonl'), '{"type":"thread.started","thread_id":"other"}\n');
        let conflict = false;
        try { readProviderSessionId(path.join(root, 'agent-events.jsonl'), 'codex'); } catch { conflict = true; }
        assert(conflict, 'conflicting stream is not borrowed');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 coordinator interruption keeps native ID, reports unfinished, and deadline is absolute',
    run: async () => {
      const controller = new AbortController();
      const result = await invokeAgentHeadless({
        argv: [process.execPath, '-e', `process.stdout.write('{"type":"thread.started","thread_id":"interrupt-42"}\\n'); setTimeout(() => process.exit(0), 1000);`],
        label: 'fixture', adapterName: 'codex',
      }, process.cwd(), {
        timeoutMs: 2000,
        signal: controller.signal,
        onObservation: observation => { if (observation.type === 'provider_session') controller.abort(); },
      });
      assert(result.interrupted === true && result.provider_session_id === 'interrupt-42', 'interrupted native facts');
      assert(result.exitCode !== 0 && !result.completion_observed, 'interruption is not completion');
      let spawned = false;
      const expired = await invokeAgentHeadless({ argv: [process.execPath], label: 'never' }, process.cwd(), {
        userDeadlineAt: '2000-01-01T00:00:00Z', onActiveChild: () => { spawned = true; },
      });
      assert(expired.timed_out === true && !spawned, 'expired request never starts');
    },
  },
  {
    name: 'normalizeChildExitCode: null code with signal → 1',
    run: () => {
      assert(normalizeChildExitCode(null, 'SIGTERM') === 1, 'signal exit');
      assert(normalizeChildExitCode(0, null) === 0, 'zero');
      assert(normalizeChildExitCode(2, null) === 2, 'nonzero');
    },
  },
  {
    name: 'createChildSettleWaiter: exit without close resolves after grace with lingering_pipe',
    run: async () => {
      const child = fakeChild();
      const { promise } = createChildSettleWaiter(child, { graceMs: 50 });
      child.emit('exit', 0, null);
      const settled = await promise;
      assert(settled.exitCode === 0, `exitCode ${settled.exitCode}`);
      assert(settled.lingering_pipe === true, 'lingering_pipe');
    },
  },
  {
    name: 'createChildSettleWaiter: close resolves immediately without lingering_pipe',
    run: async () => {
      const child = fakeChild();
      const { promise } = createChildSettleWaiter(child, { graceMs: 5000 });
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      const settled = await promise;
      assert(settled.exitCode === 0, 'exitCode');
      assert(settled.lingering_pipe === false, 'no lingering');
    },
  },
  {
    name: 'createChildSettleWaiter: error resolves with exit 1 and structured spawn_error',
    run: async () => {
      const child = fakeChild();
      const { promise } = createChildSettleWaiter(child, { graceMs: 50 });
      // plan d7f3a9c4 t4：真实 child spawn error 事件携带 ErrnoException（code/message）——
      // 链路 `child.on(\'error\') → createChildSettleWaiter → ChildSettledResult` 必须保留
      // 结构化 spawn_error（resolvedBinary 短路同构；下游硬失败分类据此判定，不靠 stderr 猜）。
      const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      child.emit('error', err);
      const settled = await promise;
      assert(settled.exitCode === 1, 'exitCode');
      assert(settled.spawn_error?.code === 'ENOENT', `spawn_error.code=${String(settled.spawn_error?.code)}`);
      assert(settled.spawn_error?.message === 'spawn ENOENT', `spawn_error.message=${String(settled.spawn_error?.message)}`);
    },
  },
  {
    name: 'createChildSettleWaiter: armForceSettleAfterKill resolves when no exit/close',
    run: async () => {
      const child = fakeChild();
      const { promise, armForceSettleAfterKill } = createChildSettleWaiter(child, {
        graceMs: 60_000,
        forceSettleAfterKillMs: 50,
      });
      armForceSettleAfterKill();
      const settled = await promise;
      assert(settled.lingering_pipe === true, 'forced lingering');
      assert(settled.exitCode === 1, 'default exit');
    },
  },
  {
    name: 'awaitPromiseWithTimeout: resolves fallback when promise is slow',
    run: async () => {
      const v = await awaitPromiseWithTimeout(
        new Promise<number>((r) => setTimeout(() => r(42), 500)),
        30,
        -1,
      );
      assert(v === -1, `expected fallback, got ${v}`);
    },
  },
  {
    name: 'awaitPromiseWithTimeout: returns promise result when fast',
    run: async () => {
      const v = await awaitPromiseWithTimeout(Promise.resolve(7), 500, -1);
      assert(v === 7, `expected 7, got ${v}`);
    },
  },
  {
    name: 'integration: detached inherit grandchild — exit+grace resolves without hanging',
    run: async () => {
      if (process.platform === 'win32') {
        // Same semantics on Windows; run with short grace.
      }
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-settle-test-'));
      const heartbeatPath = path.join(workDir, 'heartbeat.txt');
      const pidPath = path.join(workDir, 'heartbeat.pid');
      const parentScript = `
        const { spawn } = require('child_process');
        const fs = require('fs');
        const hb = process.argv[1];
        const pidFile = process.argv[2];
        const grand = spawn(process.execPath, ['-e', \`
          const fs = require('fs');
          const p = process.argv[1];
          const pf = process.argv[2];
          try { fs.writeFileSync(pf, String(process.pid)); } catch {}
          setInterval(() => { try { fs.writeFileSync(p, String(Date.now())); } catch {} }, 20);
          setTimeout(() => {
            try { fs.unlinkSync(p); } catch {}
            try { fs.unlinkSync(pf); } catch {}
            process.exit(0);
          }, 5000);
        \`, hb, pidFile], { stdio: 'inherit', detached: true, windowsHide: true });
        grand.unref();
        setTimeout(() => process.exit(0), 30);
      `;
      const child = spawn(process.execPath, ['-e', parentScript, heartbeatPath, pidPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      try {
        const { promise } = createChildSettleWaiter(child, { graceMs: 200 });
        const start = Date.now();
        const settled = await promise;
        const elapsed = Date.now() - start;
        assert(elapsed < 5000, `should not hang: ${elapsed}ms`);
        assert(settled.lingering_pipe === true, 'pipe held by detached grandchild');
        assert(settled.exitCode === 0, 'parent exit 0');
        await new Promise((r) => setTimeout(r, 100));
        assert(fs.existsSync(heartbeatPath), 'grandchild alive during grace');
      } finally {
        let grandPid = 0;
        try {
          if (fs.existsSync(pidPath)) {
            grandPid = Number.parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
            if (grandPid > 0) {
              await killProcessTree(grandPid);
              for (let i = 0; i < 25; i++) {
                try {
                  process.kill(grandPid, 0);
                } catch {
                  grandPid = 0;
                  break;
                }
                await new Promise((r) => setTimeout(r, 20));
              }
            }
          }
        } catch {
          /* best-effort */
        }
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL');
          } catch {
            /* already dead */
          }
        }
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
  },
  // ==========================================================================
  // P0-4（plan d9b4f7e2 rev5/rev6）：bounded Windows tree-kill
  // ==========================================================================
  {
    name: 'P0-4 bounded kill: taskkill 永不退出 stub → 按时返回 kill_process_tree_timeout 且 helper 被结束/释放',
    run: async () => {
      const calls = { killed: 0, destroyed: 0, unref: 0, listenersRemoved: 0 };
      // 永不调用 callback 的 fake helper——模拟卡死的 taskkill。
      const fakeHelper = Object.assign(new EventEmitter(), {
        kill: () => {
          calls.killed++;
          return true;
        },
        unref: () => {
          calls.unref++;
        },
        stdout: { destroy: () => calls.destroyed++ },
        stderr: { destroy: () => calls.destroyed++ },
        stdin: { destroy: () => calls.destroyed++ },
      });
      const origRemove = fakeHelper.removeAllListeners.bind(fakeHelper);
      (fakeHelper as unknown as { removeAllListeners: () => unknown }).removeAllListeners = () => {
        calls.listenersRemoved++;
        return origRemove();
      };
      const stubExecFile = ((..._args: unknown[]) =>
        fakeHelper) as unknown as typeof import('child_process').execFile;
      const t0 = Date.now();
      const r = await killProcessTree(123456, {
        execFileImpl: stubExecFile,
        waitMs: 120,
        forceWin32: true,
      });
      const elapsed = Date.now() - t0;
      assert(r.kill_error === 'kill_process_tree_timeout', `expect timeout marker got ${r.kill_error}`);
      assert(r.kill_attempted === true, 'kill_attempted');
      assert(elapsed < 5_000, `bounded：须在 waitMs 量级返回（实际 ${elapsed}ms）`);
      assert(calls.killed >= 1, '超时后必须主动结束 helper（存活 helper 持有 handle 阻止 Node 退出）');
      assert(calls.destroyed >= 3, '超时后必须销毁 helper stdio');
      assert(calls.listenersRemoved >= 1, '超时后必须移除监听');
    },
  },
  {
    // 第四轮复审（codex P2）：probe 超时行为测试——卡死的 --version 须走 bounded
    // tree-kill（win32 shell 壳杀不到孙进程）+ 销毁 stdio/监听，且按时返回 unknown。
    name: 'P0-4 probeAdapterVersion: 卡死的 --version → 按时 unknown + bounded tree-kill + handle 释放',
    run: async () => {
      const calls = { killTree: 0, destroyed: 0, listenersRemoved: 0, unref: 0 };
      const fakeChild = Object.assign(new EventEmitter(), {
        pid: 424242,
        kill: () => true,
        unref: () => {
          calls.unref++;
        },
        stdout: Object.assign(new EventEmitter(), { destroy: () => calls.destroyed++ }),
        stderr: Object.assign(new EventEmitter(), { destroy: () => calls.destroyed++ }),
      });
      const origRemove = fakeChild.removeAllListeners.bind(fakeChild);
      (fakeChild as unknown as { removeAllListeners: () => unknown }).removeAllListeners = () => {
        calls.listenersRemoved++;
        return origRemove();
      };
      const stubSpawn = ((..._args: unknown[]) => fakeChild) as unknown as typeof spawn;
      const t0 = Date.now();
      const v = await probeAdapterVersion('stuck-cli-unit-test', 120, {
        spawnImpl: stubSpawn,
        killTreeImpl: async (pid: number) => {
          calls.killTree++;
          assert(pid === 424242, 'killTree 须收到 probe 子进程 pid');
          return { kill_attempted: true, kill_exit_code: 0, kill_error: null };
        },
        noCache: true,
      });
      assert(v === 'unknown', `expect unknown got ${v}`);
      assert(Date.now() - t0 < 5_000, 'bounded：须在 timeout 量级返回');
      assert(calls.killTree === 1, '超时须走 bounded tree-kill（非 child.kill 壳杀）');
      assert(calls.destroyed >= 2, '超时须销毁 stdout/stderr');
      assert(calls.listenersRemoved >= 1, '超时须移除监听');
    },
  },
  {
    name: 'P0-4 probeAdapterVersion: 正常输出 → 取首行并缓存语义（noCache 隔离验证）',
    run: async () => {
      const mkChild = (): ChildProcess => {
        const c = Object.assign(new EventEmitter(), {
          pid: 1,
          kill: () => true,
          unref: () => undefined,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        }) as unknown as ChildProcess;
        setTimeout(() => {
          (c.stdout as unknown as EventEmitter).emit('data', 'chrys 9.9.9\nextra');
          (c as unknown as EventEmitter).emit('close', 0);
        }, 10);
        return c;
      };
      const stubSpawn = ((..._args: unknown[]) => mkChild()) as unknown as typeof spawn;
      const v = await probeAdapterVersion('ok-cli-unit-test', 3_000, {
        spawnImpl: stubSpawn,
        noCache: true,
      });
      assert(v === 'chrys 9.9.9', `expect first line got ${v}`);
    },
  },
  {
    name: 'P0-4 bounded kill: helper 正常退出 → 回传其 exit code、不触发 timeout 标记',
    run: async () => {
      const fakeHelper = Object.assign(new EventEmitter(), {
        kill: () => true,
        unref: () => undefined,
        stdout: { destroy: () => undefined },
        stderr: { destroy: () => undefined },
        stdin: { destroy: () => undefined },
      });
      const stubExecFile = ((...args: unknown[]) => {
        const cb = args[args.length - 1] as (e: Error | null, so: string, se: string) => void;
        setTimeout(() => cb(null, 'SUCCESS', ''), 10);
        return fakeHelper;
      }) as unknown as typeof import('child_process').execFile;
      const r = await killProcessTree(123456, {
        execFileImpl: stubExecFile,
        waitMs: 5_000,
        forceWin32: true,
      });
      assert(r.kill_exit_code === 0, `expect 0 got ${r.kill_exit_code}`);
      assert(r.kill_error === null, `expect no error got ${r.kill_error}`);
    },
  },
];

export async function runAgentInvokeSettleUnitTests(selector?: string): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases.filter(candidate => !selector || candidate.name.includes(selector))) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

export function runAll(): UnitCaseResult[] | Promise<UnitCaseResult[]> {
  return runAgentInvokeSettleUnitTests();
}

export async function runSelectedCases(selector?: string) {
  const results = await runAgentInvokeSettleUnitTests(selector);
  return { results, matchedCaseCount: results.length, executionTimings: [] };
}
