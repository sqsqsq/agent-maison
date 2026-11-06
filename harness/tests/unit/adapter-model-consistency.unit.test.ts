import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as YAML from 'yaml';
import { adapterModelBinding, parseAdapterModelBinding, decodeDshSession, readFrontendModelRequest, launchModelPin, assertModelReplay, rebindTaskModel, modelMismatchInEvents, nativeOpenCodeModelMismatch, nativeDshModelMismatch, freezeModelPin } from '../../scripts/utils/adapter-model';
import { defaultHeadlessInvokePlan, invokeAgentHeadless, buildAgentSpawnEnv, agentEventsLogPath, withFrozenModelArguments } from '../../scripts/utils/agent-invoke';
import { buildGoalManifestFromInput, writeGoalManifest, computeManifestIdentityFields, type AdapterModelPin } from '../../scripts/utils/goal-manifest';
import { GoalPhaseRuntime, parseGoalRuntimeArgs, buildDetachedChildArgv } from '../../scripts/goal-phase-runtime';
import { verifyDshModelConfig } from '../../scripts/utils/adapter-model';
import { observeWorkUnitProviderSession, type WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { ensureRunControl, casAcquireRunOwner, releaseRunOwner, markExpiredSessionOrphaned } from '../../scripts/utils/goal-run-control';
import { issueSessionExecution, readSessionExecution, acceptedSessionReport, acceptSessionExecution } from '../../scripts/utils/session-execution-handoff';
import { applyGoalVisualProviderEnv, readGoalVisualProviderEnv } from '../../scripts/utils/phase-state';
import { resolveVisualProviderInvokePlan } from '../../scripts/utils/visual-provider-invoke';
import { loadVisualProviderDeclaration } from '../../scripts/utils/adapter-catalog';
import { invocationCompleted, invocationEndFacts } from '../../scripts/utils/invocation-completion';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { resolveInvokeHardCliFailure } from '../../scripts/utils/vision-canary';
import { warnRetiredModelAlternatives } from '../../scripts/utils/framework-local-config';
import { canaryAdmissibleForExecution } from '../../scripts/utils/multimodal-probe';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const authority = { write_mode: 'full-access' as const, approval_mode: 'never' as const };
const pin: AdapterModelPin = { adapter: 'codex', value: 'gpt-6.1-sol', provider: 'route-one', reasoning_effort: 'high' };
function dshSource(root: string, profile = 'custom-foreground', baseURL = 'http://127.0.0.1:1/v1'): string {
  const file = path.join(root, 'native-home/profiles', profile, 'cordis.patch.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify([{ id: 'llm-pi-ai', config: { providers: { volcengine: { api: 'openai-completions', baseURL, apiKeyEnv: 'VOLC_API_KEY',
    models: ['volcengine/deepseek-v4.1-flash', 'another/formal-model'].map(id => ({ id, contextWindow: 1_000_000, input: ['text', 'image'] })) } } } }]));
  return file;
}
function fixture(adapterPin = pin) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-model-'));
  adapterPin = { ...adapterPin, ...(['codex', 'claude', 'codeagent'].includes(adapterPin.adapter) ? { config_source: path.join(root, 'controlled-home', adapterPin.adapter === 'codex' ? 'config.toml' : 'settings.json') } : {}) };
  const manifest = buildGoalManifestFromInput({ feature: 'model-test', run_id: 'model-run', adapter: adapterPin.adapter,
    adapter_model_pin: adapterPin, start_phase: 'spec', end_phase: 'spec', requirement: 'fixed business input', unattended: authority }, { projectRoot: root });
  writeGoalManifest(manifest, root);
  const runDir = path.resolve(root, manifest.report_dir);
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  ensureRunControl(runDir, manifest.run_id);
  const acquired = casAcquireRunOwner(runDir, manifest.run_id, 0, { kind: 'session', owner_id: 'model-owner', lease_ms: 60_000 });
  assert(acquired.ok); if (!acquired.ok) throw new Error('fixture owner');
  const context: WorkUnitExecutionContext = { runId: manifest.run_id, feature: manifest.feature, workflowId: 'obligation-driven', track: 'full', chain: ['spec'],
    phase: 'work-unit-author', attemptId: 'old', owner: { ...acquired.token, kind: 'session' }, projectRoot: root, frameworkRoot, runDir, reportDir: manifest.report_dir,
    adapter: adapterPin.adapter, adapterModel: adapterModelBinding(adapterPin), authority, instruction: 'fixed instruction', workInput: { material: { purpose: 'author', segments: ['fixed business input'] } },
    runtimeFacts: { receiptRequired: false, resume: false, successor: false }, childEnv: {} };
  const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n');
  const issue = (invokeId = 'old-invoke') => {
    emit({ type: 'agent_invoke_start', phase: context.phase, invoke_id: invokeId, attempt_id: context.attemptId });
    return issueSessionExecution({ context, invokeId, purpose: 'author', timeoutMs: 60_000, gateTimeoutMs: 30_000,
      cleanupReserveMs: 500, preSnapshot: null, writeBoundary: null, emit });
  };
  return { root, runDir, manifest, context, emit, issue, cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
  name: 'followup DSH builtin official and account routes freeze by native version without profile declarations or model requests',
  run() {
    const f = fixture(), previous = { PATH: process.env.PATH, MODEL_TEST_DSH_VERSION: process.env.MODEL_TEST_DSH_VERSION };
    try {
      const source = dshSource(f.root), bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
      const configured = fs.readFileSync(source, 'utf8');
      const commands = path.join(f.root, 'commands.jsonl'), script = path.join(bin, 'metadata.cjs');
      fs.writeFileSync(script, `const fs=require('fs'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(commands)},JSON.stringify(args)+'\\n');
if(args.includes('--version')){console.log(process.env.MODEL_TEST_DSH_VERSION);process.exit(0);}
if(args.includes('--dump-config')){const pin=JSON.parse(process.env.MAISON_GOAL_MODEL_PIN);console.log(JSON.stringify([{id:pin.provider==='deepseek-official'?'llm-deepseek':'llm-deepseek-account',config:{baseURL:process.env.MODEL_TEST_DUMP_ENDPOINT}},{id:'agent-default-model',config:{provider:pin.provider,model:pin.value,reasoningEffort:pin.reasoning_effort}},{id:'permission',config:{defaultPreset:'danger-full-access'}}]));process.exit(0);}
throw Error('model invocation forbidden');`);
      fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'dsh.cmd' : 'dsh'), process.platform === 'win32'
        ? `@echo off\n@set "_prog=node"\n"%_prog%" "${script}" %*\n` : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
      process.env.PATH = bin + path.delimiter + previous.PATH; process.env.MODEL_TEST_DSH_VERSION = '0.2.2-rc.1';
      for (const provider of ['deepseek-official', 'deepseek-account']) {
        const selected = freezeModelPin({ adapter: 'deepseek-harness', provider, value: 'deepseek-flash', config_source: source })!;
        assertModelReplay(selected);
        const plan = defaultHeadlessInvokePlan(selected.adapter, authority, 'never submitted', undefined, adapterModelBinding(selected));
        const env = buildAgentSpawnEnv(process.env, { MAISON_GOAL_MODEL_PIN: adapterModelBinding(selected)! }, selected.adapter);
        assert.equal(verifyDshModelConfig(plan.argv, selected, env, f.root), undefined);
        const plugin = provider === 'deepseek-official' ? 'llm-deepseek' : 'llm-deepseek-account';
        const endpointA = 'http://127.0.0.1:11111', endpointB = 'http://127.0.0.1:22222';
        const setEndpoint = (url: string) => fs.writeFileSync(source, YAML.stringify([...YAML.parse(configured), { id: plugin, config: { baseURL: url } }]));
        setEndpoint(endpointA);
        const bound = freezeModelPin({ ...selected, route_identity: undefined }, f.root)!;
        const replayEnv = { ...env, MAISON_GOAL_MODEL_PIN: adapterModelBinding(bound)!, MODEL_TEST_DUMP_ENDPOINT: endpointA };
        assert.equal(verifyDshModelConfig(plan.argv, bound, replayEnv, f.root), undefined);
        assert.match(verifyDshModelConfig(plan.argv, bound, { ...replayEnv, MODEL_TEST_DUMP_ENDPOINT: endpointB }, f.root)!, /endpoint/);
        setEndpoint(endpointB);
        assert.throws(() => assertModelReplay(bound, f.root), /路由.*变化/);
        fs.writeFileSync(source, configured);
        process.env.MODEL_TEST_DSH_VERSION = '0.2.3';
        assert.throws(() => assertModelReplay(selected), /路由.*变化/);
        process.env.MODEL_TEST_DSH_VERSION = '0.2.2-rc.1';
      }
      assert(fs.readFileSync(commands, 'utf8').trim().split('\n').map(line => JSON.parse(line)).every(args => args.includes('--version') || args.includes('--dump-config')));
    } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; f.cleanup(); }
  },
}, {
  name: 'review DSH startup inherits the last request header and actual non-desktop profile without model arguments',
  run() {
    const f = fixture(), keys = ['DSH_SESSION_ID', 'DSH_HOME', 'DSH_PROFILE_DIR'];
    const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      const source = dshSource(f.root), sid = 'session-foreground';
      const file = path.join(f.root, 'native-home/sessions/project', sid, 'session.v4.jsonl.zstd'); fs.mkdirSync(path.dirname(file), { recursive: true });
      const rows = [{ type: 'session/header', data: { id: sid, cwd: f.root } },
        { type: 'request/header', seq: 21, data: { header: { config: { provider: 'old-route', model: 'old-model' } } } },
        { type: 'request/header', seq: 598, data: { header: { config: { provider: 'volcengine', model: 'volcengine/deepseek-v4.1-flash', reasoningEffort: 'high' } } } },
        { type: 'turn/start', seq: 599, data: { turn: 7 } },
        { type: 'request/context', seq: 699, data: { provider: 'volcengine', model: 'volcengine/deepseek-v4.1-flash' } }];
      fs.writeFileSync(file, Buffer.concat(rows.map(row => (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n')))));
      Object.assign(process.env, { DSH_SESSION_ID: sid, DSH_HOME: path.join(f.root, 'native-home'), DSH_PROFILE_DIR: path.dirname(source) });
      const selected = freezeModelPin(launchModelPin({}, 'deepseek-harness', f.root))!;
      assert.equal(selected.provider, 'volcengine'); assert.equal(selected.value, 'volcengine/deepseek-v4.1-flash');
      assert.equal(selected.reasoning_effort, 'high'); assert.equal(selected.config_source, source); assert.match(selected.route_identity!, /^[a-f0-9]{64}$/);
      assert.match(nativeDshModelMismatch({ ...selected, provider: 'wrong-route' }, sid, f.root, process.env, 7)!, /model_binding_mismatch/);
      assert.equal(launchModelPin({}, 'deepseek-harness', f.root, selected), undefined, 'later foreground UI changes do not reselect an existing task');
      assert.throws(() => launchModelPin({}, 'deepseek-harness', path.join(f.root, 'other-project')), /session.*项目/);
      const explicit = launchModelPin({ 'adapter-model': selected.value, 'adapter-provider': selected.provider, 'adapter-model-config': source,
        'adapter-reasoning': 'high' }, selected.adapter, path.join(f.root, 'other-project'))!;
      assertModelReplay(explicit); assert.equal(explicit.provider, selected.provider);
      delete process.env.DSH_PROFILE_DIR;
      assert.throws(() => launchModelPin({}, 'deepseek-harness', f.root), /环境不完整/);
    } finally { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; f.cleanup(); }
  },
}, {
  name: 'review DSH endpoint edits at an unchanged config path cannot pass a frozen route',
  run() {
    const f = fixture();
    try {
      const source = dshSource(f.root);
      const selected = freezeModelPin({ adapter: 'deepseek-harness', provider: 'volcengine', value: 'volcengine/deepseek-v4.1-flash', config_source: source })!;
      const original = adapterModelBinding(selected); assertModelReplay(selected);
      const childArgs = buildDetachedChildArgv(['--adapter-model', selected.value, '--adapter-provider', selected.provider!, '--adapter-model-config', source,
        '--captured-model-pin', JSON.stringify(selected)], 'detached-model-child', { resume: false });
      const parsedChild = parseGoalRuntimeArgs(childArgs);
      assert.deepEqual(launchModelPin(parsedChild, selected.adapter, f.root), selected);
      dshSource(f.root, 'custom-foreground', 'http://127.0.0.1:2/v1');
      assert.equal(adapterModelBinding(selected), original);
      assert.throws(() => assertModelReplay(selected), /路由.*变化/);
      const child = launchModelPin(parsedChild, selected.adapter, f.root)!;
      assert.deepEqual(child, selected, 'child must not recompute the captured route from redundant launch arguments');
      assert.throws(() => assertModelReplay(child), /路由.*变化/);
      assert.throws(() => verifyDshModelConfig(['dsh', '--profile', 'headless'], child, process.env, f.root), /路由.*变化/);
      const authorized = launchModelPin({ 'adapter-provider': 'volcengine' }, selected.adapter, f.root, selected)!;
      assert.notEqual(adapterModelBinding(authorized), original); assertModelReplay(authorized);
    } finally { f.cleanup(); }
  },
}, {
  name: 'review model rebinding rereads locked manifest and cannot rebase away an existing deadline drift',
  run() {
    const f = fixture();
    try {
      f.manifest.user_deadline_at = '2030-01-01T00:00:00.000Z'; writeGoalManifest(f.manifest, f.root);
      f.emit({ type: 'run_created', manifest_identity_fields: computeManifestIdentityFields(f.manifest) });
      const drifted = { ...f.manifest }; delete drifted.user_deadline_at; writeGoalManifest(drifted, f.root);
      const eventsBefore = fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8');
      assert.throws(() => rebindTaskModel(f.manifest, { ...f.manifest.adapter_model_pin!, provider: 'route-two' }, f.root, true), /user_deadline_at/);
      assert.equal(fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8'), eventsBefore);
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.runDir, 'manifest.json'), 'utf8')).user_deadline_at, undefined);
      writeGoalManifest(f.manifest, f.root);
      const result = rebindTaskModel(f.manifest, { ...f.manifest.adapter_model_pin!, provider: 'route-two' }, f.root, true);
      assert.equal(result.user_deadline_at, f.manifest.user_deadline_at);
      const rebased = JSON.parse(fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8').trim().split('\n').at(-1)!);
      assert.deepEqual(rebased.changed_fields, ['adapter_model_pin']);
      assert.equal(rebased.to_fields.user_deadline_at, computeManifestIdentityFields(f.manifest).user_deadline_at);
    } finally { f.cleanup(); }
  },
}, {
  name: 'review DSH context omitting effort is unknown while a header declaring a different effort is a mismatch',
  run() {
    const expected = { adapter: 'deepseek-harness', provider: 'volcengine', value: 'volcengine/deepseek-v4.1-flash', reasoning_effort: 'high' };
    const rows = [{ type: 'request/header', data: { header: { config: { provider: expected.provider, model: expected.value, reasoningEffort: 'high' } } } },
      { type: 'request/context', data: { provider: expected.provider, model: expected.value } }];
    assert.equal(modelMismatchInEvents(expected.adapter, adapterModelBinding(expected), rows.map(row => JSON.stringify(row)).join('\n')), undefined);
    (rows[0] as any).data.header.config.reasoningEffort = 'low';
    assert.match(modelMismatchInEvents(expected.adapter, adapterModelBinding(expected), rows.map(row => JSON.stringify(row)).join('\n'))!, /model_binding_mismatch/);
  },
}, {
  name: 'review OpenCode user-message model.variant survives foreground export and native SQLite observation',
  run() {
    const f = fixture();
    try {
      const file = path.join(f.root, 'export.json');
      fs.writeFileSync(file, JSON.stringify({ info: { id: 'native-sid', directory: f.root }, messages: [{ info: { id: 'native-message', role: 'user', model: { providerID: 'fixture', modelID: 'model', variant: 'high' } } }] }));
      const selected = readFrontendModelRequest({ adapter: 'opencode', projectRoot: f.root, file, sessionId: 'native-sid', requestId: 'native-message', configSource: '.config/opencode' });
      assert.equal(selected.reasoning_effort, 'high');
      const dbFile = path.join(f.root, '.local/share/opencode/opencode.db'); fs.mkdirSync(path.dirname(dbFile), { recursive: true });
      const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(dbFile);
      db.exec('CREATE TABLE session(id TEXT,directory TEXT);CREATE TABLE message(session_id TEXT,time_created INTEGER,data TEXT);');
      db.prepare('INSERT INTO session VALUES(?,?)').run('native-sid', f.root);
      db.prepare('INSERT INTO message VALUES(?,?,?)').run('native-sid', 1, JSON.stringify({ role: 'user', model: { providerID: 'fixture', modelID: 'model', variant: 'low' } })); db.close();
      assert.match(nativeOpenCodeModelMismatch(selected, 'native-sid', f.root, 0, new Map())!, /reasoning_effort.*low/);
      const final = withFrozenModelArguments(defaultHeadlessInvokePlan('opencode', authority, 'controlled', undefined, adapterModelBinding(selected)));
      assert.equal(final.argv[final.argv.indexOf('--variant') + 1], 'high');
    } finally { f.cleanup(); }
  },
}, {
  name: 'review durable mismatch completion facts exclude a wrong native SID during cold same-binding recovery',
  run() {
    const f = fixture();
    try {
      const issued = f.issue(), dir = path.join(f.runDir, path.dirname(issued.reference.path));
      fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: 'wrong-provider-sid' }) + '\n');
      f.emit({ type: 'agent_invoke_end', phase: f.context.phase, invoke_id: issued.request.invoke_id,
        ...invocationEndFacts({ exitCode: 1, model_binding_mismatch: 'expected provider differs', provider_session_id: 'wrong-provider-sid' }) });
      const recovered = observeWorkUnitProviderSession({ ...f.context, attemptId: 'cold-retry' });
      assert(!('status' in recovered)); assert.equal(recovered.provider_session_id, undefined);
    } finally { f.cleanup(); }
  },
}, {
  name: 'review historical approved_alternative loses execution authorization before source-free identity projection',
  async run() {
    const selected: AdapterModelPin = { adapter: 'cursor', value: 'formal-model', provider: 'cursor', source: 'approved_alternative' };
    const binding = adapterModelBinding(selected); assert.equal(binding, undefined);
    let starts = 0;
    const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', 'process.exit(0)'], label: 'retired alternative', adapterName: 'cursor', modelBinding: binding }, frameworkRoot,
      { onActiveChild: () => starts++ });
    assert.equal(starts, 0); assert.equal(result.skipped, true);
  },
}, {
  name: 'A2 explicit model inherits launching route and reasoning; frozen routing survives later home changes',
  run() {
    const f = fixture();
    try {
      const file = path.join(f.root, 'request.jsonl');
      fs.writeFileSync(file, [{ type: 'session', id: 'front', cwd: f.root }, { type: 'request/header', seq: 7, data: { header: { config: {
        provider: 'volcengine', model: 'volcengine/deepseek-v4.1-flash', reasoningEffort: 'high' } } } }].map(row => JSON.stringify(row)).join('\n'));
      const selected = launchModelPin({ 'adapter-model': 'another/formal-model', 'frontend-request-file': file, 'frontend-session-id': 'front', 'frontend-request-id': '7', 'adapter-model-config': dshSource(f.root) }, 'deepseek-harness', f.root)!;
      assert.equal(selected.value, 'another/formal-model'); assert.equal(selected.provider, 'volcengine'); assert.equal(selected.reasoning_effort, 'high');
      const same = launchModelPin({ 'adapter-model': pin.value }, 'codex', f.root, f.manifest.adapter_model_pin)!;
      assert.equal(adapterModelBinding(same), f.context.adapterModel);
      fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'front' }) + '\n' + JSON.stringify({ type: 'request/header', seq: 7, data: { header: { config: { provider: 'volcengine', model: 'm' } } } }));
      assert.throws(() => readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: process.cwd(), file, sessionId: 'front', requestId: '7' }), /session.*项目/);
    } finally { f.cleanup(); }
  },
}, {
  name: 'A4 A10 missing binding across every adapter produces zero child starts',
  async run() {
    const f = fixture();
    try {
      for (const adapter of ['deepseek-harness', 'claude', 'codeagent', 'codex', 'cursor', 'opencode', 'chrys', 'generic', 'custom']) {
        let starts = 0;
        const result = await invokeAgentHeadless({ argv: [process.execPath, '-e', "throw Error('must not start')"], adapterName: adapter, label: 'unbound adapter' }, f.root,
          { onActiveChild: () => starts++ });
        assert.equal(starts, 0, adapter); assert.notEqual(result.exitCode, 0, adapter);
      }
    } finally { f.cleanup(); }
  },
}, {
  name: 'A8 released and orphaned unexecuted requests can be rebound without resetting original request input',
  run() {
    for (const state of ['released', 'orphaned']) {
      const f = fixture();
      try {
        const signed = f.issue();
        const originalInstruction = signed.request.context.instruction;
        if (state === 'released') releaseRunOwner(f.runDir, f.context.owner);
        else markExpiredSessionOrphaned(f.runDir, f.context.runId, Date.now() + 120_000);
        const changed = rebindTaskModel(f.manifest, { ...f.manifest.adapter_model_pin!, provider: 'route-two' }, f.root, true);
        const original = readSessionExecution(f.runDir)!;
        assert.equal(acceptedSessionReport(f.runDir, original)?.report.status, 'waiting');
        assert.equal(original.request.context.instruction, originalInstruction);
        assert.equal(changed.requirement, f.manifest.requirement);
      } finally { f.cleanup(); }
    }
  },
}, {
  name: 'A9 independent visual route survives manifest and env and reaches final readonly CLI flags',
  run() {
    const f = fixture();
    try {
      const provider = { adapter: 'codex', model: 'gpt-6.1-sol', provider: 'visual-route', reasoning_effort: 'high', config_source: path.join(f.root, 'visual-home/config.toml') };
      const env: NodeJS.ProcessEnv = {}; applyGoalVisualProviderEnv(env, provider);
      assert.deepEqual(readGoalVisualProviderEnv(env), provider);
      const declaration = loadVisualProviderDeclaration(frameworkRoot, 'codex'); assert(declaration.ok);
      if (!declaration.ok) throw new Error('fixture declaration');
      const plan = resolveVisualProviderInvokePlan({ provider, projectRoot: f.root, declaration: declaration.declaration, imagePaths: [], prompt: 'read only' });
      const final = withFrozenModelArguments(plan.plan);
      assert(final.argv.includes('model_provider="visual-route"')); assert(final.argv.includes('model_reasoning_effort="high"'));
      assert(final.argv.includes('read-only')); assert(!final.argv.includes('danger-full-access'));
      assert.equal(parseAdapterModelBinding('codex', final.modelBinding)?.provider, 'visual-route');
    } finally { f.cleanup(); }
  },
}, {
  name: 'A6 OpenCode reads only exact-session native request metadata and rejects route drift',
  run() {
    const f = fixture();
    try {
      const { DatabaseSync } = require('node:sqlite');
      const file = path.join(f.root, '.local/share/opencode/opencode.db'); fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file); db.exec('CREATE TABLE session(id TEXT,directory TEXT);CREATE TABLE message(session_id TEXT,time_created INTEGER,data TEXT);');
      db.prepare('INSERT INTO session VALUES(?,?)').run('exact-sid', f.root);
      const row = db.prepare('INSERT INTO message VALUES(?,?,?)');
      row.run('unrelated-sid', 1, JSON.stringify({ role: 'assistant', providerID: 'wrong', modelID: 'other' }));
      row.run('exact-sid', 1, JSON.stringify({ role: 'user', model: { providerID: 'fixture', modelID: 'model', variant: 'high' } }));
      const expected = { adapter: 'opencode', value: 'fixture/model', provider: 'fixture', reasoning_effort: 'high', config_source: path.join(f.root, '.config/opencode') };
      assert.equal(nativeOpenCodeModelMismatch(expected, 'exact-sid', f.root, 0, new Map()), undefined);
      row.run('exact-sid', 2, JSON.stringify({ role: 'assistant', providerID: 'wrong', modelID: 'model' })); db.close();
      assert.match(nativeOpenCodeModelMismatch(expected, 'exact-sid', f.root, 0, new Map())!, /model_binding_mismatch/);
    } finally { f.cleanup(); }
  },
}, {
  name: 'A1 DSH desktop-only source with and without credential reaches direct and attended execute with zero fallback requests',
  async run() {
    const f = fixture({ adapter: 'deepseek-harness', provider: 'volcengine', value: 'volcengine/deepseek-v4.1-flash' });
    const saved = { PATH: process.env.PATH, VOLC_API_KEY: process.env.VOLC_API_KEY, DSH_HOME: process.env.DSH_HOME };
    try {
      const source = path.join(f.root, 'native-home', 'profiles', 'desktop', 'cordis.patch.yml'); fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, YAML.stringify([{ id: 'llm-pi-ai', config: { providers: { volcengine: { baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'VOLC_API_KEY',
        models: [{ id: 'volcengine/deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] }] } } } }]));
      const bound = freezeModelPin({ ...f.manifest.adapter_model_pin!, config_source: source })!;
      f.manifest.adapter_model_pin = bound; writeGoalManifest(f.manifest, f.root);
      (f.context as any).adapterModel = adapterModelBinding(bound);
      const requests = path.join(f.root, 'model-requests.jsonl'), argsFile = path.join(f.root, 'assembled-argv.jsonl');
      const script = path.join(f.root, 'dsh.cjs');
      fs.writeFileSync(script, `const fs=require('fs');const args=process.argv.slice(2);const pin=JSON.parse(process.env.MAISON_GOAL_MODEL_PIN||'{}');
const patches=args.filter((a,i)=>args[i-1]==='--patch');
fs.appendFileSync(${JSON.stringify(argsFile)},JSON.stringify(args)+'\\n');
if(args.includes('--dump-config')){if(patches.length!==2||patches[0]!==${JSON.stringify(source)}||!patches[1].endsWith('headless-patch.yaml'))process.exit(2);
console.log(JSON.stringify([{id:'llm-pi-ai',config:{providers:{volcengine:{baseURL:'https://fixture.invalid/v1',apiKeyEnv:'VOLC_API_KEY',models:[{id:'volcengine/deepseek-v4.1-flash',contextWindow:1000000,input:['text','image']}]}}}},{id:'agent-default-model',config:{provider:pin.provider,model:pin.value,reasoningEffort:pin.reasoning_effort}},{id:'permission',config:{defaultPreset:'danger-full-access'}}]));process.exit(0);}
setTimeout(()=>{if(!process.env.VOLC_API_KEY){console.error('dsh: MISSING_CREDENTIAL: selected source requires key');process.exit(1);}
fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({provider:pin.provider,model:pin.value})+'\\n');
for(const row of [{type:'session',sessionId:'session-controlled'},{type:'request/header',data:{header:{config:{provider:pin.provider,model:pin.value}}}},{type:'final',sessionId:'session-controlled',text:'controlled result'},{type:'status',phase:'turn_end',reason:{kind:'completed'}}])console.log(JSON.stringify(row));},2000);`);
      const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
      const shim = path.join(bin, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
      fs.writeFileSync(shim, process.platform === 'win32' ? `@echo off\n@set "_prog=node"\n"%_prog%" "${script}" %*\n` : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
      process.env.PATH = bin + path.delimiter + saved.PATH; process.env.DSH_HOME = path.join(f.root, 'native-home');
      const plan = () => defaultHeadlessInvokePlan('deepseek-harness', authority, 'controlled author or questioning', undefined, adapterModelBinding(bound));
      delete process.env.VOLC_API_KEY;
      const missing = await invokeAgentHeadless(plan(), f.root);
      assert.match(resolveInvokeHardCliFailure(missing, { formalInvoke: true })!, /所选模型来源要求的密钥/);
      assert(!fs.existsSync(requests));
      const issued = f.issue();
      const attended = await runGoalModeSessionStep({ projectRoot: f.root, frameworkRoot, feature: f.context.feature, runId: f.context.runId,
        adapter: 'deepseek-harness', runMode: 'attended', requestPath: path.resolve(f.runDir, issued.reference.path), action: 'execute' });
      assert.equal(attended.status, 'waiting', JSON.stringify({ attended, report: acceptedSessionReport(f.runDir, issued)?.report }));
      assert.match(acceptedSessionReport(f.runDir, issued)!.report.details!, /MISSING_CREDENTIAL.*所选模型来源要求的密钥/);
      assert(!fs.existsSync(requests));
      process.env.VOLC_API_KEY = 'fixture-only-not-a-real-key';
      for (const role of ['author', 'questioning']) {
        const result = await invokeAgentHeadless(plan(), f.root); assert.equal(result.exitCode, 0, `${role}: ${result.stderr}`);
      }
      const second = f.issue('credentialed-invoke');
      const credentialed = await runGoalModeSessionStep({ projectRoot: f.root, frameworkRoot, feature: f.context.feature, runId: f.context.runId,
        adapter: 'deepseek-harness', runMode: 'attended', requestPath: path.resolve(f.runDir, second.reference.path), action: 'execute' });
      assert.equal(credentialed.status, 'passed', JSON.stringify(credentialed));
      const actual = fs.readFileSync(requests, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(actual, Array(3).fill({ provider: 'volcengine', model: 'volcengine/deepseek-v4.1-flash' }));
      const commands = fs.readFileSync(argsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert(commands.some(args => args.includes('--dump-config')));
      assert(commands.every(args => args[args.indexOf('--profile') + 1] === 'headless'));
      assert.equal(fs.readFileSync(source, 'utf8').includes('fixture-only'), false);
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      f.cleanup();
    }
  },
}, {
  name: 'A3 A4 exact launching request and concatenated DSH frames preserve full slash ID; no lastUsed or UI fallback',
  run() {
    const f = fixture();
    try {
      const rows = [{ type: 'session', id: 'foreground', cwd: f.root }, { type: 'request/header', seq: 7, data: { header: { config: { provider: 'volcengine', model: 'volcengine/deepseek-v4.1-flash', reasoningEffort: 'high' } } } },
        { type: 'request/header', seq: 19, data: { header: { config: { provider: 'other', model: 'changed-after-launch' } } } }];
      const bytes = Buffer.concat(rows.map(row => (zlib as any).zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n'))));
      const file = path.join(f.root, 'session.v4.jsonl.zstd'); fs.writeFileSync(file, bytes);
      assert.equal(decodeDshSession(bytes).trim().split('\n').length, 3);
      const selected = readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: f.root, file, sessionId: 'foreground', requestId: '7', configSource: dshSource(f.root) });
      assert.equal(selected.value, 'volcengine/deepseek-v4.1-flash'); assert.equal(selected.provider, 'volcengine');
      assert.equal(selected.reasoning_effort, 'high');
      assert.throws(() => readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: f.root, file, sessionId: 'wrong', requestId: '7' }), /准确 session/);
      assert.throws(() => readFrontendModelRequest({ adapter: 'deepseek-harness', projectRoot: f.root, file, sessionId: 'foreground', requestId: '8' }), /启动轮/);
      assert.throws(() => assertModelReplay(undefined), /未启动模型请求/);
      assert.throws(() => assertModelReplay({ adapter: 'cursor', value: 'Auto' }), /未启动模型请求/);
      for (const adapter of ['chrys', 'generic']) assert.throws(() => assertModelReplay({ adapter, value: 'formal-model' }), /回放契约/);
    } finally { f.cleanup(); }
  },
}, {
  name: 'A5 A8 provider-only and effort-only binding changes permit dispatch, exclude old SID, invalidate canary; equal bindings retain dedup',
  run() {
    const f = fixture();
    try {
      const issued = f.issue();
      fs.writeFileSync(path.join(f.runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: 'provider-one-sid' }) + '\n');
      f.emit({ type: 'agent_invoke_end', phase: f.context.phase, invoke_id: 'old-invoke', exit_code: 0 });
      const same = { ...f.context, attemptId: 'new', adapterModel: adapterModelBinding(JSON.parse(JSON.stringify(f.manifest.adapter_model_pin))) };
      assert.equal(observeWorkUnitProviderSession(same).provider_session_id, 'provider-one-sid');
      assert('status' in new GoalPhaseRuntime().prepareExecutionContext(same), 'same business input and binding must remain deduplicated');
      for (const changed of [{ ...f.manifest.adapter_model_pin!, provider: 'route-two' }, { ...f.manifest.adapter_model_pin!, reasoning_effort: 'xhigh' }]) {
        const next = { ...same, adapterModel: adapterModelBinding(changed) };
        const observed = observeWorkUnitProviderSession(next); assert(!('status' in observed)); assert.equal(observed.provider_session_id, undefined);
        const prepared = new GoalPhaseRuntime().prepareExecutionContext(next);
        assert(!('status' in prepared), 'only route/effort changed: new dispatch is authorized');
        assert.equal(prepared.provider_session_id, undefined);
        assert.equal(canaryAdmissibleForExecution({ run_id: f.context.runId, model: f.context.adapterModel, probed_via: 'goal' } as any,
          { runId: f.context.runId, modelPin: next.adapterModel }), false);
      }
      const env = buildAgentSpawnEnv({ maison_goal_model_pin: 'stale' }, { MAISON_GOAL_MODEL_PIN: adapterModelBinding(pin)! });
      assert.deepEqual(Object.keys(env).filter(key => key.toUpperCase() === 'MAISON_GOAL_MODEL_PIN'), ['MAISON_GOAL_MODEL_PIN']);
      assert.equal(parseAdapterModelBinding('codex', env.MAISON_GOAL_MODEL_PIN)?.provider, pin.provider);
    } finally { f.cleanup(); }
  },
}, {
  name: 'A8 unexecuted old request is retired on authorized rebind while completed results remain readable',
  run() {
    const f = fixture();
    try {
      const issued = f.issue();
      assert.throws(() => rebindTaskModel(f.manifest, { ...f.manifest.adapter_model_pin!, provider: 'route-two' }, f.root, false), /override-manifest/);
      const changed = rebindTaskModel(f.manifest, { ...pin, provider: 'route-two' }, f.root, true);
      assert.equal(changed.adapter_model_pin?.provider, 'route-two');
      assert.equal(acceptedSessionReport(f.runDir, issued)?.report.status, 'waiting');
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.runDir, 'manifest.json'), 'utf8')).adapter_model_pin.provider, 'route-two');
    } finally { f.cleanup(); }
  },
}, {
  name: 'A6 native mismatch cancels on first event beyond memory-tail limits and cannot be accepted as passed',
  async run() {
    const f = fixture({ adapter: 'claude', provider: 'anthropic', value: 'claude-opus-5-5' });
    try {
      const script = path.join(f.root, 'native.cjs');
      fs.writeFileSync(script, `process.stdout.write(JSON.stringify({type:'system',subtype:'init',model:'claude-sonnet-5-5',padding:'x'.repeat(80000)})+'\\n'+'x'.repeat(80000)+'\\n');setTimeout(()=>process.stdout.write('LATER_REQUEST\\n'),1500);setInterval(()=>{},1000);`);
      const issued = f.issue(); const output = path.join(f.runDir, path.dirname(issued.reference.path), 'agent-output.log');
      const result = await invokeAgentHeadless({ argv: [process.execPath, script], label: 'controlled native', adapterName: 'claude', modelBinding: f.context.adapterModel }, f.root, { outputLogPath: output, timeoutMs: 10_000, ...(process.platform === 'win32' ? { containment: { runId: f.context.runId, invokeId: issued.request.invoke_id } } : {}) });
      assert(result.model_binding_mismatch); assert.equal(result.stdout.length, 65536); assert(!result.stdout.includes('claude-sonnet-5-5')); assert.equal(invocationCompleted(result), false); assert(!result.stdout.includes('LATER_REQUEST'));
      const raw = fs.readFileSync(agentEventsLogPath(output), 'utf8'); assert(raw.includes('claude-sonnet-5-5'));
      assert(modelMismatchInEvents('claude', f.context.adapterModel, raw));
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: { status: 'passed', phase: f.context.phase }, emit: f.emit }), /不能.*通过/);
    } finally { f.cleanup(); }
  },
}, {
  name: 'A6 A9 later main-request drift is rejected; native auxiliary Claude calls keep their model',
  run() {
    const bound = adapterModelBinding({ adapter: 'claude', value: 'claude-opus-5-5' });
    const native = [{ type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
      { type: 'system', subtype: 'init', model: 'claude-haiku-5-5', parent_tool_use_id: 'native-subtask' }];
    assert.equal(modelMismatchInEvents('claude', bound, native.map(row => JSON.stringify(row)).join('\n')), undefined);
    native.push({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' });
    assert(modelMismatchInEvents('claude', bound, native.map(row => JSON.stringify(row)).join('\n')));
  },
}, {
  name: 'A6 attended execute retains native mismatch and cold recovery cannot turn it into passed',
  async run() {
    const f = fixture({ adapter: 'claude', value: 'claude-opus-5-5', provider: 'anthropic' });
    const previous = process.env.PATH;
    try {
      const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
      const script = path.join(bin, 'native.cjs');
      fs.writeFileSync(script, `if(process.argv.includes('--input-format')){process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{for(const line of chunk.trim().split('\\n')){const row=JSON.parse(line);if(row.type==='control_request')console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:row.request_id,response:{models:[{resolvedModel:'claude-opus-5-5',supportedEffortLevels:['high']}]}}}));}});process.stdin.on('end',()=>process.exit(0));}else{setTimeout(()=>{console.log(JSON.stringify({type:'system',subtype:'init',model:'claude-sonnet-5-5'}));process.stdout.write('x'.repeat(80000)+'\\n');setTimeout(()=>console.log('LATER_REQUEST'),1500);},2000);setInterval(()=>{},1000);}`);
      const shim = path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude');
      fs.writeFileSync(shim, process.platform === 'win32' ? '@echo off\nSET "dp0=%~dp0"\nSET "_prog=node"\n"%_prog%" "%dp0%native.cjs" %*\n'
        : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
      process.env.PATH = bin + path.delimiter + previous;
      const issued = f.issue();
      const options = { projectRoot: f.root, frameworkRoot, feature: f.context.feature, runId: f.context.runId, adapter: 'claude', runMode: 'attended' as const,
        requestPath: path.resolve(f.runDir, issued.reference.path), action: 'execute' as const };
      const first = await runGoalModeSessionStep(options);
      assert.equal(first.status, 'waiting', JSON.stringify(first));
      const accepted = acceptedSessionReport(f.runDir, issued)!;
      assert.match(accepted.report.details!, /model_binding_mismatch/);
      assert.equal(invocationCompleted({ ...accepted.event, exitCode: accepted.event.exit_code }), false);
      const raw = fs.readFileSync(path.join(f.runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'), 'utf8');
      assert(raw.includes('claude-sonnet-5-5')); assert(!raw.includes('LATER_REQUEST'));
      const cold = await runGoalModeSessionStep(options); assert.equal(cold.status, 'waiting'); assert.equal(cold.duplicate, true);
    } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; f.cleanup(); }
  },
}, {
  name: 'A7 retired approved_models is ignored for every shape and emits one startup warning',
  run() {
    const original = console.warn; const warnings: string[] = []; console.warn = value => warnings.push(String(value));
    try {
    for (const value of [['alternate'], 'invalid', null, 3, { arbitrary: true }]) {
      const local = { schema_version: '1.0', adapters: { codex: { approved_models: value }, claude: { approved_models: value } } } as any;
      warnRetiredModelAlternatives(local);
    }
    } finally { console.warn = original; }
    assert.equal(warnings.length, 1); assert.match(warnings[0], /已停用并忽略/);
  },
}];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
  }
  return results;
}
