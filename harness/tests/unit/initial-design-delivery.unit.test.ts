import { beginUnitCase } from '../utils/unit-cases';
import { testCliArgs } from '../utils/test-cli-args';
import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, spawn, spawnSync, type ExecFileException } from 'child_process';
import * as YAML from 'yaml';
import { provisionFrameworkUnder, git, writeHostFile } from '../utils/real-chain-host';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';
import { runRuntimeTestChild, withRuntimeTest } from '../utils/runtime-test-control';

const ORIGINAL_BUDGET={max_total_turns:30,wall_clock_minutes:120,max_retries_per_phase:3};
const UNATTENDED={write_mode:'full-access' as const,approval_mode:'never' as const,timeout_seconds:900,max_turns:20};
const MODULE='02-Feature/Inbox',SOURCE_DIR=MODULE+'/src/main/ets';
type Project={root:string;frameworkRoot:string;harnessDir:string;feature:string;requirement:string;requirementSourceFiles:string[]};
async function withProject(run:(project:Project)=>void|Promise<void>):Promise<void>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'initial-design-delivery-'))),root=path.join(directory,'host');
  const priorTrust=process.env.MAISON_GOAL_CHECKPOINT_DIR;process.env.MAISON_GOAL_CHECKPOINT_DIR=path.join(directory,'.trust');
  try{
    fs.mkdirSync(path.join(root,'doc/features'),{recursive:true});
    const framework=provisionFrameworkUnder(root, { linkDependencies: true });
    fs.writeFileSync(path.join(root,'framework.config.json'),JSON.stringify({schema_version:'1.0',project_name:'InitialDesignControl',project_profile:{name:'hmos-app'},active_workflow:'obligation-driven',features_dir:'doc/features'})+'\n');
    writeLocalConfig(root,{schema_version:'1.0',agent_adapter:'claude'});clearFrameworkConfigCache();
    const requirement='为已有Inbox新增批量已读内部能力，完整完成设计、独立质询、实施与验收，保留已有单条已读行为。';
    const write=(file:string,value:string)=>{const absolute=path.join(root,file);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,value);};
    write('doc/requirement.md',requirement+'\n');
    write(SOURCE_DIR+'/InboxStore.ets','export class InboxStore { markRead(id: string): boolean { return id.length > 0; } }\n');
    write(MODULE+'/index.ets',"export { InboxStore } from './src/main/ets/InboxStore';\n");
    write(MODULE+'/src/ohosTest/ets/test/InboxExisting.test.ets',"import { describe, it, expect } from '@ohos/hypium';\nexport default function inboxExisting(){describe('Inbox existing',()=>{it('existing boolean',0,()=>expect(true).assertTrue());});}\n");
    write('doc/request-input.yaml',YAML.stringify({feature:'inbox-batch-read',adapter:'claude',requirement,requirement_source_files:['doc/requirement.md'],budget:ORIGINAL_BUDGET,unattended:UNATTENDED,adapter_model_pin:{adapter:'claude',value:'claude-opus-5-5'}}));
    write('.gitignore','framework/\nframework.local.json\n.trust/\n');
    git(root,['init','-q','-b','main']);git(root,['add','-A']);
    git(root,['-c','user.name=Control Fixture','-c','user.email=control-fixture@test','commit','-qm','Original control inputs']);
    await run({root,...framework,feature:'inbox-batch-read',requirement,requirementSourceFiles:['doc/requirement.md']});
  }finally{
    for(const file of Object.keys(require.cache))if(file.startsWith(directory+path.sep))delete require.cache[file];
    clearFrameworkConfigCache();if(priorTrust===undefined)delete process.env.MAISON_GOAL_CHECKPOINT_DIR;else process.env.MAISON_GOAL_CHECKPOINT_DIR=priorTrust;
    assert(directory.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
function publicCli(project:Project,script:string,args:string[]):Record<string,any>{
  const invoke=()=>spawnSync(process.execPath,[...testCliArgs(path.join(project.harnessDir, 'scripts', script + '.ts')), '--project-root',project.root,'--feature',project.feature,...args],{cwd:project.harnessDir,encoding:'utf8',timeout:30_000});
  const result=script==='goal-mode-entry'?runRuntimeTestChild({root:project.root},invoke):invoke();
  assert.equal(result.status,0,`${script}: ${result.stderr}\n${result.stdout}\n${result.error??''}`);return JSON.parse(result.stdout.trim());
}
const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
  name: '3ec91fa7 same native followup selects original run transport only when the request is identified',
  async run() {
    const entry = require('../../scripts/goal-mode-entry') as typeof import('../../scripts/goal-mode-entry');
    const runtime = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-followup-')));
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const sid = 'user-transport-followup';
    const home = path.join(projectRoot, 'native-claude');
    const file = path.join(home, 'projects', 'fixture', sid + '.jsonl');
    const environment = {
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_SESSION_ID: sid,
      MAISON_GOAL_CHECKPOINT_DIR: path.join(projectRoot, '.trust'),
    };
    const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, environment);
      const requirement = '为 Inbox 新增批量已读，完成设计、独立质询、实施与验收，保留已有单条已读行为。';
      writeHostFile(projectRoot, 'framework.config.json', JSON.stringify({
        schema_version: '1.0', project_name: 'NativeFollowup', project_profile: { name: 'hmos-app' },
        materialized_adapters: ['claude'], active_workflow: 'obligation-driven', features_dir: 'doc/features',
        paths: { state_file: 'doc/.current-phase.json' },
      }));
      writeHostFile(projectRoot, 'CLAUDE.md', '# Host fixture\n');
      writeHostFile(projectRoot, 'doc/requirement.md', requirement + '\n');
      writeLocalConfig(projectRoot, { schema_version: '1.0', agent_adapter: 'claude' });
      git(projectRoot, ['init', '-q', '-b', 'main']);
      git(projectRoot, ['add', 'CLAUDE.md', 'framework.config.json', 'doc/requirement.md']);
      git(projectRoot, ['-c', 'user.name=Control Fixture', '-c', 'user.email=control-fixture@test', 'commit', '-qm', 'Original request']);

      fs.mkdirSync(path.dirname(file), { recursive: true });
      const user = (uuid: string, content: string) => fs.appendFileSync(file, JSON.stringify({
        type: 'user', uuid, sessionId: sid, cwd: projectRoot, timestamp: new Date().toISOString(),
        message: { role: 'user', content },
      }) + '\n');
      user('origin', requirement + '\n我会看着。');
      const options = { projectRoot, frameworkRoot, feature: 'inbox-batch-read',
        runId: 'followup-transport-original', adapter: 'claude', runMode: 'attended' };
      entry.prepareGoalModeRun({ ...options, requirement, requirementSourceFiles: ['doc/requirement.md'], sessionRef: file + '#origin' });

      const next = () => withRuntimeTest({ root: projectRoot }, () => entry.runGoalModeSessionStep(options));
      const launches: string[][] = [];
      runtime.__testing_setDetachSpawn(((_file: string, args: string[]) => {
        launches.push([...args]);
        return spawn(process.execPath, ['-e', 'process.exit(7)'], { windowsHide: true });
      }) as unknown as typeof spawn);

      user('unbound-followup', '我离开一会，继续跑。');
      const retained = await next();
      assert.equal(launches.length, 0, 'a native message without original identity does not grant transport');
      assert.equal(retained.type, 'phase_execute_request');
      assert.equal(retained.run_id, options.runId);
      const request = (retained.request as { path: string }).path;
      const requestBytes = fs.readFileSync(request);

      user('bound-followup', '继续同一份 ' + options.runId + ' 已签请求。我离开一会，继续跑。');
      const transferred = await next();
      assert.equal(launches.length, 1);
      assert.equal(launches[0][launches[0].indexOf('--resume') + 1], options.runId);
      assert.equal(transferred.type, 'goal_detach_result');
      assert.equal(transferred.run_id, options.runId);
      assert.deepEqual(fs.readFileSync(request), requestBytes, 'transport handoff preserves the original signed request');
    } finally {
      runtime.__testing_setDetachSpawn(null);
      clearFrameworkConfigCache();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
}, {
  name: '8f2c6b91 followup visual birth rejects an input-manifest route change without authorization',
  async run() {
    await withProject(async project => {
      const source = path.join(project.root, 'native-codex/config.toml'), input = path.join(project.root, 'doc/request-input.yaml');
      const definition = YAML.parse(fs.readFileSync(input, 'utf8'));
      definition.visual_provider_pin = { adapter: 'codex', model: 'gpt-6.1-sol', provider: 'route-a', config_source: source };
      fs.writeFileSync(input, YAML.stringify(definition)); const before = fs.readFileSync(input);
      const args = ['--prepare-run', '--run-mode', 'attended', '--manifest', 'doc/request-input.yaml', '--visual-adapter', 'codex',
        '--visual-model', 'gpt-6.1-sol', '--visual-provider', 'route-b', '--visual-model-config', source];
      const denied = runRuntimeTestChild({ root: project.root }, () => spawnSync(process.execPath,
        [...testCliArgs(path.join(project.harnessDir, 'scripts/goal-mode-entry.ts')), '--project-root', project.root, '--feature', project.feature, ...args],
        { cwd: project.harnessDir, encoding: 'utf8', timeout: 30000 }));
      assert.equal(denied.status, 1); assert.match(denied.stderr, /visual_provider_pin.*override-manifest/s);
      assert.deepEqual(fs.readFileSync(input), before); assert.deepEqual(fs.readdirSync(path.join(project.root, 'doc/features')), []);
      const launch = () => withRuntimeTest({ root: project.root }, () => new Promise<{
        pid?: number; status: number | null; signal?: string | null; error?: ExecFileException; stdout: string; stderr: string;
      }>(resolve => {
        const child = execFile(process.execPath,
          [...testCliArgs(path.join(project.harnessDir, 'scripts/goal-mode-entry.ts')), '--project-root', project.root, '--feature', project.feature,
            ...args, '--override-manifest'], { cwd: project.harnessDir, encoding: 'utf8', timeout: 30_000 },
          (error, stdout, stderr) => resolve({ pid: child.pid, status: error ? typeof error.code === 'number' ? error.code : null : 0,
            signal: error?.signal, error: error ?? undefined, stdout, stderr }));
      }));
      const results = await Promise.all([launch(), launch()]);
      const [born, duplicate] = results.map((result, index) => {
        const detail = `authorized prepare ${index + 1}: status=${result.status} signal=${result.signal ?? ''} error=${result.error?.message ?? ''}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
        assert.equal(result.status, 0, detail);
        assert(result.stdout.trim(), detail);
        let reply: { type: string; manifest: string; run_id: string; continuation: string };
        try { reply = JSON.parse(result.stdout); }
        catch (error) { throw new Error(`${detail}\n${String(error)}`); }
        assert.equal(reply.type, 'goal_run_prepared', detail);
        return reply;
      });
      assert.equal(JSON.parse(fs.readFileSync(born.manifest, 'utf8')).visual_provider_pin.provider, 'route-b');
      assert.equal(duplicate.run_id, born.run_id, 'parallel authorized prepares share one root');
      assert.deepEqual([born.continuation, duplicate.continuation].sort(), ['fresh', 'rejoin']);
      const runs = path.dirname(path.dirname(born.manifest));
      assert.deepEqual(fs.readdirSync(runs), [born.run_id], 'successful creation leaves exactly one root and releases the birth lock');
      const events = fs.readFileSync(path.join(path.dirname(born.manifest), 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events.filter(event => event.type === 'run_created').length, 1);
    });
  },
}, {
  name: '8f2c6b91 followup OpenCode public prepare reads variant from frontend with only a source directory',
  async run() {
    await withProject(project => {
      const file = path.join(project.root, 'frontend-export.json'), config = path.join(project.root, 'native-home/.config/opencode');
      fs.mkdirSync(config, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ info: { id: 'session-export', directory: project.root }, messages: [{ info: { id: 'message-export', role: 'user',
        model: { providerID: 'fixture', modelID: 'model', variant: 'high' } } }] }));
      const prepared = publicCli(project, 'goal-mode-entry', ['--prepare-run', '--run-mode', 'attended', '--adapter', 'opencode',
        '--requirement-file', 'doc/requirement.md', '--frontend-request-file', file, '--frontend-session-id', 'session-export',
        '--frontend-request-id', 'message-export', '--adapter-model-config', config]);
      const manifest = JSON.parse(fs.readFileSync(prepared.manifest, 'utf8'));
      assert.deepEqual(manifest.adapter_model_pin, { adapter: 'opencode', value: 'fixture/model', source: 'frontend', provider: 'fixture', reasoning_effort: 'high', config_source: config });
      assert(!fs.readFileSync(path.join(path.dirname(prepared.manifest), 'events.jsonl'), 'utf8').includes('agent_invoke_start'));
    });
  },
},  {
  name: '8f2c6b91 detached launcher treats explicit new run-id as birth and captures the pin before controlled child startup',
  async run() {
    await withProject(async project => {
      const runtime = require(path.join(project.harnessDir, 'scripts/goal-phase-runtime')) as typeof import('../../scripts/goal-phase-runtime');
      const before = process.argv, id = 'new-detached-model-task'; let spawns = 0;
      const configFile = path.join(project.root, 'framework.config.json');
      fs.writeFileSync(configFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(configFile, 'utf8')), materialized_adapters: ['claude'] }));
      fs.writeFileSync(path.join(project.root, 'CLAUDE.md'), '# Controlled host entry\n');
      const runDir = path.join(project.root, 'doc/features', project.feature, 'goal-runs', id);
      assert(!fs.existsSync(path.join(runDir, 'manifest.json')));
      const args = ['--project-root', project.root, '--feature', project.feature, '--detach', '--run-id', id, '--adapter', 'claude',
        '--requirement-file', 'doc/requirement.md', '--adapter-model', 'claude-opus-5-5', '--adapter-provider', 'anthropic',
        '--adapter-model-config', path.join(project.root, 'native/settings.json')];
      runtime.__testing_setDetachSpawn(((_exec: string, childArgs: string[]) => {
        spawns++; const captured = JSON.parse(childArgs[childArgs.indexOf('--captured-model-pin') + 1]);
        assert.equal(captured.value, 'claude-opus-5-5'); assert.equal(captured.provider, 'anthropic');
        fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: id }));
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ type: 'run_start', run_id: id }) + '\n');
        return { pid: process.pid, exitCode: null, once: () => undefined, unref: () => undefined };
      }) as never);
      try {
        process.argv = [process.execPath, path.join(project.harnessDir, 'scripts/goal-runner.ts'), ...args];
        const result = await withRuntimeTest({ root: project.root }, () => runtime.main({ args }));
        assert.equal(result, 0); assert.equal(spawns, 1);
      } finally { process.argv = before; runtime.__testing_setDetachSpawn(null); }
    });
  },
}, {
  name: '8f2c6b91 backend initial author persists model mismatch and cold recovery excludes its native SID',
  async run() {
    await withProject(async project => {
      writeLocalConfig(project.root, { schema_version: '1.0', agent_adapter: 'claude', vision: { image_input_override: 'none' } });
      const runtime = require(path.join(project.harnessDir, 'scripts/goal-phase-runtime')) as typeof import('../../scripts/goal-phase-runtime');
      const phases = require(path.join(project.harnessDir, 'scripts/utils/goal-phase-executor')) as typeof import('../../scripts/utils/goal-phase-executor');
      let calls = 0, observed: import('../../scripts/utils/goal-phase-executor').WorkUnitExecutionContext | undefined;
      const args = ['--project-root', project.root, '--feature', project.feature, '--adapter', 'claude', '--requirement-file', 'doc/requirement.md',
        '--foreground-ok', '--authorize-autonomy', '--runtime-executor', 'detached', '--runtime-owner', 'process', '--adapter-model', 'claude-opus-5-5',
        '--adapter-provider', 'anthropic', '--adapter-model-config', path.join(project.root, 'native/settings.json')];
      const result = await withRuntimeTest({ root: project.root }, () => new runtime.GoalPhaseRuntime({ args, ownerKind: 'process', executor: {
        async execute(context) { calls++; observed = context; return { status: 'failed', phase: context.phase, exitCode: 1, stdout: '', stderr: '',
          command: 'controlled-model-result', provider_session_id: 'wrong-native-sid', model_binding_mismatch: 'controlled native provider mismatch' }; },
      } }).run());
      assert.notEqual(result, 0); assert.equal(calls, 1); assert(observed);
      const events = fs.readFileSync(path.join(observed.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const ended = events.find(event => event.type === 'agent_invoke_end');
      assert.equal(ended.model_binding_mismatch, 'controlled native provider mismatch');
      const recovered = phases.observeWorkUnitProviderSession({ ...observed, attemptId: 'cold-model-retry' });
      assert(!('status' in recovered)); assert.equal(recovered.provider_session_id, undefined);
    });
  },
},  {
  name: 'f3b8e6a1 real public prepare CLI preserves the explicit user deadline and model pin while ignoring legacy quota fields',
  async run() {
    await withProject(project => {
      assert.deepEqual(fs.readdirSync(path.join(project.root, 'doc/features')), []);
      const inputPath = path.join(project.root, 'doc/request-input.yaml');
      const definition = YAML.parse(fs.readFileSync(inputPath, 'utf8'));
      definition.user_deadline_at = '2030-01-01T00:00:00.000Z';
      fs.writeFileSync(inputPath, YAML.stringify(definition));
      const inputBytes = fs.readFileSync(inputPath);
      const result = publicCli(project, 'goal-mode-entry', ['--prepare-run', '--manifest', 'doc/request-input.yaml', '--run-mode', 'attended']);
      assert.equal(result.type, 'goal_run_prepared');
      const manifest = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
      assert(manifest.initial_design);
      assert.equal(manifest.requirement, project.requirement);
      assert.deepEqual(manifest.requirement_source_files, ['doc/requirement.md']);
      assert.equal(manifest.user_deadline_at, definition.user_deadline_at);
      assert.equal(manifest.budget, undefined);
      assert.equal(manifest.unattended.timeout_seconds, undefined);
      assert.equal(manifest.unattended.max_turns, undefined);
      assert.equal(manifest.unattended.phase_timeout_seconds, undefined);
      assert.deepEqual(manifest.adapter_model_pin, { adapter: 'claude', value: 'claude-opus-5-5' });
      assert.equal(manifest.execution_scope, undefined);
      const events = fs.readFileSync(path.join(path.dirname(result.manifest), 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events.filter(event => event.type === 'run_created').length, 1);
      assert(!events.some(event => event.type === 'agent_invoke_start'));
      assert(!fs.existsSync(path.join(project.root, 'doc/features', project.feature, 'blueprint')));
      assert.deepEqual(fs.readFileSync(inputPath), inputBytes, 'the source input definition is not mutated into runtime state');
    });
  },
},  {
  name: 'f3b8e6a1 an explicit review-only request retains its original responsibility and never births an initial-design root',
  async run() {
    await withProject(project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const manifests = require(path.join(project.harnessDir, 'scripts/utils/goal-manifest')) as typeof import('../../scripts/utils/goal-manifest');
      let prepared: ReturnType<typeof entry.prepareGoalModeRun> | undefined;
      try {
        prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
          runId: 'review-only', requirement: '只读审查现有 InboxStore 和 MemoryStorage 的单条 markRead 行为。仅交 review 本职结果，不做设计，不改产品，不声明完整交付。',
          startPhase: 'review', endPhase: 'review', requestedPhases: ['review'] });
      } catch (error) {
        assert(!String(error).includes('design_preparation_required'), 'an original missing-input failure must not be turned into App design work');
      }
      if (prepared) assert(!manifests.isInitialDesignManifest(prepared.manifest));
      const feature = path.join(project.root, 'doc/features', project.feature, 'goal-runs');
      if (fs.existsSync(feature)) for (const directory of fs.readdirSync(feature)) {
        const file = path.join(feature, directory, 'manifest.json');
        if (fs.existsSync(file)) assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).initial_design, undefined);
      }
    });
  },
}, ];


cases.push({
  name: '5247db24 signed design retains the original extension input through a host toggle',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const extension = 'doc/extensions';
      const skill = `${extension}/skills/ux/SKILL.md`;
      const manifest = `${extension}/manifest.yaml`;
      writeHostFile(project.root, skill, '# Original UX action\n');
      writeHostFile(project.root, `${extension}/intake.md`, '主持有的独立设计背景。\n');
      writeHostFile(project.root, manifest, YAML.stringify({
        schema_version: '2.0', name: 'host-design', provides: { skills: ['ux'], skill_assets: { 'component-design': { knowledge: 'intake.md' } } },
        bindings: { ux: { fill: { at: 'component-design.before_discovery@1', kind: 'action', ref: 'ux', enabled_by_default: true } } },
      }));
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot,
        feature: project.feature, adapter: 'claude', runId: 'initial-extension-window', requirement: project.requirement,
        requirementSourceFiles: project.requirementSourceFiles, unattended: UNATTENDED, autonomyAuthorized: true });
      const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: prepared.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const next = (changes: Partial<typeof options & { requestPath: string; report: import('../../scripts/utils/session-execution-handoff').SessionExecutionReport }> = {}) =>
        withRuntimeTest({ root: project.root }, () => entry.runGoalModeSessionStep({ ...options, ...changes }));
      const first = await next();
      assert.equal(first.type, 'phase_execute_request');
      const reference = first.request as { path: string };
      const issued = handoff.readSessionExecution(prepared.runDir, reference.path)!;
      const { context, invoke_id: invokeId } = issued.request;
      assert(context.instruction?.includes(`设计前动作 ux:fill [${skill}]`));
      assert(context.instruction?.includes('\nextension-result: {"ability":"能力ID","binding":"绑定ID","status":"reused"'));
      assert(context.instruction?.includes('主持有的独立设计背景。'));
      assert(context.instruction?.includes('doc/requirement.md'));
      assert(issued.request.write_boundary?.immutableInputPaths?.includes(skill));
      const binding_snapshot = handoff.capturePhaseBinding(prepared.runDir, issued);
      assert(binding_snapshot);
      fs.appendFileSync(path.join(prepared.runDir, 'events.jsonl'), JSON.stringify({ type: 'agent_process_bound',
        phase: context.phase, invoke_id: invokeId, owner_id: context.owner.owner_id, owner_epoch: context.owner.epoch,
        pid: 42, binding_snapshot, ts: new Date().toISOString() }) + '\n');
      const cli = (childEnv: Readonly<Record<string, string>>) => spawnSync(process.execPath,
        [...testCliArgs(path.join(project.harnessDir, 'scripts/extension.ts')), 'disable', 'ux', '--project-root', project.root, '--json'],
        { cwd: project.harnessDir, encoding: 'utf8', timeout: 15_000,
          env: { ...process.env, MAISON_GOAL_RUN_ID: '', MAISON_GOAL_ATTEMPT: '', ...childEnv } });
      const denied = cli(context.childEnv);
      assert.equal(denied.status, 1, denied.stderr + denied.stdout);
      assert.match(denied.stderr, /宿主管理入口/);
      const changed = cli({});
      assert.equal(changed.status, 0, changed.stderr + changed.stdout);
      assert.equal(JSON.parse(changed.stdout).mutation.changed, true);
      assert.deepEqual((await next()).request, first.request, 'ordinary next reuses the original signed inputs');
      assert.equal(fs.readFileSync(path.join(project.root, skill), 'utf8'), '# Original UX action\n');
      await next({ requestPath: reference.path, report: { status: 'passed', phase: context.phase, details: '执行结束，初建设计仍未交付。' } });
      assert.equal(handoff.acceptedSessionReport(prepared.runDir, issued)?.event.status, 'passed');
      const events = handoff.sessionEvents(prepared.runDir);
      assert(events.some(event => event.type === 'phase_write_observed' && event.invoke_id === invokeId
        && 'producer' in event && event.producer === 'extension-management' && 'produced' in event
        && Array.isArray(event.produced) && event.produced.some(write => write.path === manifest)));
      assert(!events.some(event => event.type === 'phase_write_violation' && event.invoke_id === invokeId));
      const retry = handoff.readSessionExecution(prepared.runDir);
      if (retry && retry.request.invoke_id !== invokeId) {
        assert(!retry.request.context.instruction?.includes('设计前动作 ux:fill'));
        assert(retry.request.context.instruction?.includes('主持有的独立设计背景。'));
      }
    });
  },
}, {
  name: '5247db24 the signed design author cannot write a configured extension root inside its blueprint workspace',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const extensionDir = `doc/features/${project.feature}/blueprint/local-extensions`;
      const config = path.join(project.root, 'framework.config.json');
      const previous = JSON.parse(fs.readFileSync(config, 'utf8'));
      fs.writeFileSync(config, JSON.stringify({ ...previous, paths: { ...previous.paths, extension_dir: extensionDir } }));
      clearFrameworkConfigCache();
      const target = `${extensionDir}/manifest.yaml`;
      writeHostFile(project.root, target, 'schema_version: "2.0"\nname: local\n');
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        adapter: 'claude', runId: 'initial-extension-write', requirement: project.requirement,
        requirementSourceFiles: project.requirementSourceFiles, unattended: UNATTENDED, autonomyAuthorized: true });
      const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: prepared.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const first = await withRuntimeTest({ root: project.root }, () => entry.runGoalModeSessionStep(options));
      assert.equal(first.type, 'phase_execute_request');
      const reference = first.request as { path: string };
      const issued = handoff.readSessionExecution(prepared.runDir, reference.path)!;
      assert(issued.request.snapshot_options?.ownedPrefixes?.some(prefix => target.startsWith(prefix + '/')));
      const absolute = path.join(project.root, target);
      fs.appendFileSync(absolute, 'description: A managed author tried to update configuration.\n');
      fs.writeFileSync(path.join(path.dirname(reference.path), 'agent-events.jsonl'), [
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-manifest', name: 'Edit', input: { file_path: absolute } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit-manifest', content: 'Applied edit.' }] } },
      ].map(row => JSON.stringify(row)).join('\n') + '\n');
      await withRuntimeTest({ root: project.root }, () => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
        report: { status: 'passed', phase: issued.request.context.phase } }));
      assert.equal(handoff.acceptedSessionReport(prepared.runDir, issued)?.event.status, 'failed');
      assert(handoff.sessionEvents(prepared.runDir).some(event => event.type === 'phase_write_violation'
        && event.invoke_id === issued.request.invoke_id && 'violations' in event && Array.isArray(event.violations)
        && event.violations.some(write => write.path === target && write.violation === 'outside_authority' && write.authority_confirmed)));
    });
  },
});

// Reduced legacy process history, matching 960fa0: the old three-author policy halted with total budget left.
// These are historical input events; today's runtime must not be used to recreate that retired local limit.
function seedLegacyContentLimitHistory(project: Project, maxTurns = 30) {
  const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
  const manifests = require(path.join(project.harnessDir, 'scripts/utils/goal-manifest')) as typeof import('../../scripts/utils/goal-manifest');
  const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
    adapter: 'codex', runId: 'exhausted-original', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
    requestedResults: ['原始请求完整交付'], budget: { ...ORIGINAL_BUDGET, max_total_turns: maxTurns, max_retries_per_phase: 2 }, unattended: UNATTENDED });
  const eventsPath = path.join(prepared.runDir, 'events.jsonl');
  const append = (event: Record<string, unknown>, offset: number) => fs.appendFileSync(eventsPath,
    JSON.stringify({ ...event, run_id: prepared.manifest.run_id, ts: new Date(Date.now() - 6000 + offset).toISOString() }) + '\n');
  append({ type: 'run_start' }, 0);
  for (let index = 1; index <= 3; index++) {
    const invokeId = `initial-design-author-i${index}`;
    append({ type: 'agent_invoke_start', phase: 'initial-design-author', invoke_id: invokeId, purpose: 'author' }, index * 1000);
    const directory = path.join(prepared.runDir, 'phases', 'initial-design-author', invokeId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'agent-output.log'), [
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'TOOL-DATA'.repeat(20000) } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: `事故原调用最终正文${index}：已写发现笔记，尚未交付蓝图。` } }),
      JSON.stringify({ type: 'turn.completed' }),
    ].join('\n'));
    append({ type: 'agent_invoke_end', phase: 'initial-design-author', invoke_id: invokeId, purpose: 'author', status: 'passed',
      completion_observed: true, exit_code: 1, duration_ms: 500 }, index * 1000 + 500);
  }
  append({ type: 'run_end', status: 'HALTED', halt_reason: 'content_retry_exhausted', run_disposition: 'TERMINAL' }, 4500);
  const note = path.join(project.root, 'doc/features', project.feature, 'blueprint/author-findings.md');
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, '真实发现中间材料，不能作为蓝图或准入。\n');
  assert(manifests.isInitialDesignManifest(prepared.manifest));
  return { ...prepared, manifest: prepared.manifest, eventsPath, note };
}

cases.push({
  name: '9f6c2e41 explicit successor preserves exhausted history and process feedback across session handoff without branching',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const old = seedLegacyContentLimitHistory(project);
      const originalBytes = fs.readFileSync(old.eventsPath);
      const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'codex',
        requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles, supersede: [old.manifest.run_id] };
      assert.throws(() => entry.prepareGoalModeRun({ ...options, adapter: 'claude' }), /adapter/);
      const legacyEnd = handoff.sessionEvents(old.runDir).at(-1)!;
      assert.equal(legacyEnd.halt_reason, 'content_retry_exhausted');
      assert('run_disposition' in legacyEnd && legacyEnd.run_disposition === 'TERMINAL');
      assert.equal(origin.readOriginalDeliveryActivity(project.root, old.manifest)!.calls, 3);
      assert.equal(handoff.sessionEvents(old.runDir).filter(event => event.type === 'agent_invoke_start').length, 3);
      assert(!fs.existsSync(path.join(old.runDir, 'phases/initial-design-author/initial-design-author-i4/prompt.md')));
      assert.equal(entry.prepareGoalModeRun({ ...options, supersede: undefined }).manifest.run_id, old.manifest.run_id);
      const stoppedBytes = fs.readFileSync(old.eventsPath);
      const successor = entry.prepareGoalModeRun({ ...options, runId: 'explicit-successor', adapterModelPin: { adapter: 'codex', value: 'gpt-6.1-terra' } });
      const manifests = require(path.join(project.harnessDir, 'scripts/utils/goal-manifest')) as typeof import('../../scripts/utils/goal-manifest');
      assert(manifests.isInitialDesignManifest(successor.manifest));
      assert.equal(successor.continuation.kind, 'successor');
      assert.equal(successor.manifest.successor_of, old.manifest.run_id);
      assert.deepEqual(successor.manifest.initial_design, old.manifest.initial_design);
      assert.deepEqual(successor.manifest.requirement_source_files, old.manifest.requirement_source_files);
      assert.equal(successor.manifest.requirement, old.manifest.requirement);
      assert.equal(origin.readOriginalDeliveryActivity(project.root, successor.manifest)!.calls, 3);
      assert(origin.readOriginalDeliveryActivity(project.root, successor.manifest)!.active_ms >= 1500);
      assert.deepEqual(fs.readFileSync(old.eventsPath), stoppedBytes, 'successor cannot rewrite its source history');
      assert(stoppedBytes.subarray(0, originalBytes.length).equals(originalBytes));
      const step = { ...options, runId: successor.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const next = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep(step));
      assert.equal(next.type, 'phase_execute_request');
      const request = handoff.readSessionExecution(successor.runDir, (next.request as { path: string }).path)!;
      const instruction = request.request.context.instruction!;
      assert(instruction.includes('事故原调用最终正文3'), 'session successor must read the old process output');
      assert(instruction.includes(old.note) && instruction.includes('必须实际编写或补齐'));
      assert(!instruction.includes('TOOL-DATA') && instruction.length < 20000, 'tool stdout must not inflate continuation');
      assert.equal(origin.readOriginalDeliveryActivity(project.root, successor.manifest)!.calls, 4);
      assert.deepEqual((await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep(step))).request, next.request);
      assert.equal(origin.readOriginalDeliveryActivity(project.root, successor.manifest)!.calls, 4);
      assert.throws(() => entry.prepareGoalModeRun({ ...options, supersede: [successor.manifest.run_id], runId: 'blocked-by-pending' }), /尚未报告/);
      const rejoined = entry.prepareGoalModeRun({ ...options, runId: 'must-not-fork' });
      assert.equal(rejoined.manifest.run_id, successor.manifest.run_id, 'stale target must rejoin the current audited successor');
      assert(!fs.existsSync(path.join(path.dirname(successor.runDir), 'must-not-fork')));
    });
  },
},  {
  name: '9f6c2e41 public prepare CLI and runtime both honor explicit same-requirement supersede',
  async run() {
    for (const lane of ['prepare', 'runtime']) await withProject(async project => {
      const old = seedLegacyContentLimitHistory(project);
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      if (lane === 'prepare') {
        const launch = path.join(project.root, 'doc/successor-input.yaml');
        fs.writeFileSync(launch, YAML.stringify({ ...old.manifest, adapter_model_pin: { adapter: 'codex', value: 'gpt-6.1-terra' } }));
        const result = publicCli(project, 'goal-mode-entry', ['--prepare-run', '--manifest', launch, '--run-mode', 'attended', '--supersede', old.manifest.run_id]);
        assert.equal(result.continuation, 'successor');
        const manifest = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
        assert.equal(manifest.successor_of, old.manifest.run_id);
        assert.deepEqual(manifest.initial_design.requested_results, old.manifest.initial_design.requested_results);
        assert.equal(manifest.adapter_model_pin.value, 'gpt-6.1-terra');
        assert.equal(origin.readOriginalDeliveryActivity(project.root, manifest)!.calls, 3);
        assert.equal(manifest.budget, undefined);
      } else {
        const runtime = require(path.join(project.harnessDir, 'scripts/goal-phase-runtime')) as typeof import('../../scripts/goal-phase-runtime');
        const end = JSON.parse(fs.readFileSync(old.eventsPath, 'utf8').trim().split('\n').at(-1)!);
        assert.equal(end.halt_reason, 'content_retry_exhausted'); assert.equal(end.run_disposition, 'TERMINAL');
        const historyBefore = fs.readFileSync(old.eventsPath);
        const recoveryArgs = ['--project-root', project.root, '--framework-root', project.frameworkRoot, '--feature', project.feature,
          '--manifest', old.manifestPath, '--supersede', old.manifest.run_id];
        assert(recoveryArgs.includes('--manifest') && recoveryArgs.includes('--supersede'));
        assert(!recoveryArgs.includes('--requirement') && !recoveryArgs.includes('--authorize-autonomy'));
        let calls = 0;
        const driver = new runtime.GoalPhaseRuntime({ args: recoveryArgs,
          executor: { async execute(context) { calls++; assert(context.instruction?.includes('事故原调用最终正文3'));
            return { status: 'waiting', phase: context.phase, details: 'Bounded transport observation.', exitCode: 0, stdout: '', stderr: '', command: 'bounded-executor' }; } } });
        assert.equal(await withRuntimeTest({ root: project.root }, () => driver.run()), 1);
        assert.equal(calls, 1);
        const current = origin.currentOriginalDelivery(project.root, old.manifest as never);
        assert.notEqual(current.run_id, old.manifest.run_id);
        assert.equal(current.successor_of, old.manifest.run_id);
        assert.equal(origin.readOriginalDeliveryActivity(project.root, current)!.calls, 4);
        assert.equal(current.budget, undefined);
        assert.deepEqual(fs.readFileSync(old.eventsPath), historyBefore, 'runtime supersede preserves the legacy source events');
      }
    });
  },
}, {
  name: '9f6c2e41 stale supersede with changed requirement preserves the increment and succeeds from the current request',
  async run() {
    for (const lane of ['prepare', 'runtime']) await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const old = seedLegacyContentLimitHistory(project);
      const common = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'codex', requirement: project.requirement };
      const current = entry.prepareGoalModeRun({ ...common, runId: 'current-successor', supersede: [old.manifest.run_id] });
      fs.appendFileSync(path.join(current.runDir, 'events.jsonl'), JSON.stringify({ type: 'run_start', run_id: current.manifest.run_id,
        ts: new Date().toISOString() }) + '\n');
      const increment = '新增要求：批量已读结果必须保留失败条目的原状态。';
      if (lane === 'prepare') {
        const next = entry.prepareGoalModeRun({ ...common, requirement: increment, runId: 'increment-successor', supersede: [old.manifest.run_id] });
        assert.equal(next.manifest.successor_of, current.manifest.run_id);
        assert(next.manifest.requirement!.includes(project.requirement) && next.manifest.requirement!.includes(increment));
        assert.equal(next.continuation.kind, 'successor');
        if (next.continuation.kind === 'successor') { assert.equal(next.continuation.change, 'requirement_increment'); assert.equal(next.continuation.explicit, false); }
      } else {
        const runtime = require(path.join(project.harnessDir, 'scripts/goal-phase-runtime')) as typeof import('../../scripts/goal-phase-runtime');
        let calls = 0;
        const driver = new runtime.GoalPhaseRuntime({ args: ['--project-root', project.root, '--framework-root', project.frameworkRoot,
          '--feature', project.feature, '--adapter', 'codex', '--requirement', increment, '--supersede', old.manifest.run_id],
          executor: { async execute(context) { calls++; assert(context.instruction?.includes(project.requirement) && context.instruction.includes(increment));
            return { status: 'waiting', phase: context.phase, details: 'Only observe increment delivery.', exitCode: 0, stdout: '', stderr: '', command: 'bounded-executor' }; } } });
        assert.equal(await withRuntimeTest({ root: project.root }, () => driver.run()), 1);
        assert.equal(calls, 1);
        const next = origin.currentOriginalDelivery(project.root, old.manifest);
        assert.equal(next.successor_of, current.manifest.run_id);
        assert(next.requirement!.includes(increment));
        assert.equal(origin.readOriginalDeliveryActivity(project.root, next)!.calls, 4);
      }
    });
  },
});

cases.push({
  name: '9f6c2e41 equivalent provenance observation spellings preserve role boundaries while changed verdict source or instant remains rejected',
  run() {
    const { validateInitialDesignInvocation } = require('../../scripts/utils/initial-design-delivery') as typeof import('../../scripts/utils/initial-design-delivery');
    const { validateProvenanceRecord } = require('../../scripts/utils/blueprint-provenance') as typeof import('../../scripts/utils/blueprint-provenance');
    const { validateLiteSchema } = require('../../scripts/utils/lite-json-schema') as typeof import('../../scripts/utils/lite-json-schema');
    const provenance = { source_kind: 'independent_review', source_ref: 'doc/requirement.md', observed_at: '2026-10-28T00:00:00Z', evidence_strength: 'observed', extraction_method: 'source_review' };
    const before = { revision: 1, provenance, note: '2026-10-28T00:00:00Z', review_summary: { questioning: { status: 'complete', provider_id: 'independent-questioner',
      items: [{ disposition: 'blocker', answer: '必须补齐真实交接', provenance: { ...provenance } }] } } };
    const after = structuredClone(before);
    after.revision = 2;
    after.review_summary.questioning.items[0].provenance.observed_at = '2026-10-28 00:00:00+00:00';
    const original = YAML.stringify(before);
    assert.equal(validateInitialDesignInvocation('author', original, YAML.stringify(after)), null);
    for (const change of [
      (doc: typeof after) => { doc.review_summary.questioning.items[0].disposition = 'answered_with_evidence'; },
      (doc: typeof after) => { doc.review_summary.questioning.provider_id = 'author'; },
      (doc: typeof after) => { doc.review_summary.questioning.items[0].answer = '已通过'; },
      (doc: typeof after) => { doc.review_summary.questioning.items[0].provenance.source_ref = 'different-source.md'; },
      (doc: typeof after) => { doc.review_summary.questioning.items[0].provenance.observed_at = '2026-10-28 00:00:01+00:00'; },
    ]) {
      const changed = structuredClone(after); change(changed);
      assert(validateInitialDesignInvocation('author', original, YAML.stringify(changed)), 'real questioning changes must remain unauthorized');
    }
    const questioned = structuredClone(before);
    questioned.provenance.observed_at = '2026-10-28 00:00:00+00:00';
    questioned.review_summary.questioning.items[0].answer = '本次新质询的真实结果';
    assert.equal(validateInitialDesignInvocation('questioning', original, YAML.stringify(questioned)), null);
    for (const change of [
      (doc: typeof questioned) => { doc.provenance.observed_at = '2026-10-28 00:00:01+00:00'; },
      (doc: typeof questioned) => { doc.provenance.source_ref = 'different-source.md'; },
      (doc: typeof questioned) => { doc.note = '2026-10-28 00:00:00+00:00'; },
    ]) {
      const changed = structuredClone(questioned); change(changed);
      assert(validateInitialDesignInvocation('questioning', original, YAML.stringify(changed)), 'only defined provenance timestamps may compare by instant');
    }
    for (const name of ['app-component-blueprint.schema.json', 'change-unit.schema.json']) {
      const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas', name), 'utf8'));
      assert.deepEqual(validateLiteSchema(questioned.provenance, schema.$defs.provenance), [], 'the same serialization must pass the actual provenance schema');
    }
    assert.deepEqual(validateProvenanceRecord(questioned.provenance, '$.provenance'), []);
    assert.equal(YAML.stringify(before), original, 'comparison must not rewrite the original artifact');
  },
});

cases.push({
  name: '9f6c2e41 current authority reaches both roles and first versus repeat questioning keeps the existing reading contract',
  async run() {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'initial-authority-')));
    const frameworkRoot = path.resolve(__dirname, '../../..');
    const delivery = require('../../scripts/utils/initial-design-delivery') as typeof import('../../scripts/utils/initial-design-delivery');
    const manifests = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const { createGoalRun } = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
    const entry = require('../../scripts/goal-mode-entry') as typeof import('../../scripts/goal-mode-entry');
    const { readSessionExecution } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const { renderDesignAuthorityBoundary } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
    const { requiredQuestioningScopes } = require('../../scripts/utils/blueprint-questioning') as typeof import('../../scripts/utils/blueprint-questioning');
    try {
      fs.writeFileSync(path.join(directory, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'AuthorityPrompt',
        project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', features_dir: 'doc/features' }));
      clearFrameworkConfigCache();
      const requirement = 'ORIGINAL_SOURCE_ONLY_AFTER_READING';
      const manifest = manifests.buildInitialDesignGoalManifest({ feature: 'authority-design', run_id: 'authority-root', adapter: 'codex', requirement,
        requirement_source_files: ['doc/requirement.md'], initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] },
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED }, { projectRoot: directory });
      const blueprintPath = path.join(directory, 'doc/features/authority-design/blueprint/component-blueprint.yaml');
      const candidatesPath = path.join(path.dirname(blueprintPath), 'change-unit-candidates.json');
      fs.mkdirSync(path.dirname(blueprintPath), { recursive: true });
      const blueprint = { blueprint_id: manifest.feature, design_views: ['logical', 'runtime', 'development', 'deployment', 'scenarios'].map((view_id, index) => ({
        view_id, applicability: 'applicable', evolution_impact: 'changed', runtime_data_flows: index < 2 ? [{ flow_id: `flow-${index}` }] : [],
      })), relations: [{ relation_id: 'r1' }, { relation_id: 'r2' }], review_summary: {} };
      fs.writeFileSync(blueprintPath, YAML.stringify(blueprint));
      const review = path.join(path.dirname(blueprintPath), 'component-blueprint.review.md');
      fs.writeFileSync(review, '# 设计\n## 方案\n正文\n<a id="reference"></a>\n## 技术与追溯参考\n参考\n');
      const extensionRoot = path.join(directory, 'doc/extensions');
      fs.mkdirSync(extensionRoot, { recursive: true });
      const designText = '# 仅设计作者取得的完整宿主知识\n';
      fs.writeFileSync(path.join(extensionRoot, 'intake.md'), designText);
      fs.writeFileSync(path.join(extensionRoot, 'manifest.yaml'), YAML.stringify({
        schema_version: '1.1', name: 'author-knowledge', provides: { skill_assets: { 'component-design': { knowledge: 'intake.md' } } },
      }));
      for (const authorized of [false, true]) for (const kind of ['author', 'questioning'] as const) {
        const prompt = delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest,
          observation: { kind, blueprintPath, candidatesPath, issues: ['当前机器缺口'] }, autonomyAuthorized: authorized, deliveryRuns: [] });
        assert.equal(prompt.includes('本次控制入口已核实可信原请求'), authorized, 'default never and goal mode must not supply authority');
        for (const line of renderDesignAuthorityBoundary(kind)) assert.equal(prompt.includes(line), authorized);
        assert.equal(prompt.includes('§9 自动决议'), authorized);
        assert.equal(prompt.includes(designText), kind === 'author');
        if (kind === 'questioning') {
          assert(!prompt.includes(requirement), 'first reader receives source locations, not original requirement text');
          assert(prompt.includes('doc/requirement.md') && prompt.includes('正文阅读后'));
          assert(prompt.includes('这是首次独立阅读') && prompt.includes('第1–4行'));
          assert(!prompt.includes('前次真实否定仍待复核'));
          assert(!prompt.includes('执行前读取工程AGENTS'));
          const scopes = requiredQuestioningScopes(blueprint);
          assert.equal(scopes.size, 19);
          for (const scope of scopes.keys()) assert(prompt.includes(`- ${scope}（`), 'all substantive scopes remain required');
        }
      }
      for (const kind of ['decompose', 'scope'] as const) {
        const scope = kind === 'scope' ? { feature: 'bounded-scope', candidatePath: path.join(directory, 'doc/features/bounded-scope/feature.yaml'), command: 'prepare-scope --overwrite' } : undefined;
        const prompt = delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest, autonomyAuthorized: true,
          observation: { kind, blueprintPath, candidatesPath, issues: [], ...(scope ? { scope } : {}) }, deliveryRuns: [] });
        assert(prompt.includes('本次控制入口已核实可信原请求') && prompt.includes('§9 自动决议'));
        assert(prompt.includes('留痕只记入当前写集内既有设计材料，不另写phase账本'));
        assert(prompt.includes('只在本次签发写集内完成'));
        assert(!prompt.includes(designText));
        assert(!prompt.includes('可补节点、选型、关系') && !prompt.includes('原文有不同表述时'));
      }
      const runDir = path.join(directory, manifest.report_dir);
      const publicReply = 'FIRST_REAL_ERROR\n' + '完整公开反馈与拒修依据\n'.repeat(1000) + 'LAST_PUBLIC_DENIAL doc/requirement.md#evidence';
      const renderPreviousAuthor = (invokeId: string, body: string, status = 'passed', timedOut = false) => {
        const folder = path.join(runDir, 'phases/initial-design-author', invokeId);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'agent-output.log'), [
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: body } }),
          JSON.stringify({ type: 'turn.completed' }),
        ].join('\n'));
        return delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest, autonomyAuthorized: false,
          observation: { kind: 'author', blueprintPath, candidatesPath, issues: ['同一真实缺口'] },
          deliveryRuns: [{ manifest, events: [{ type: 'agent_invoke_end', phase: 'initial-design-author', invoke_id: invokeId,
            status, exit_code: status === 'passed' ? 0 : 1, timed_out: timedOut }] }] });
      };
      const priorAuthor = renderPreviousAuthor('initial-design-author-i1', publicReply);
      assert.equal(renderPreviousAuthor('initial-design-author-i2', publicReply), priorAuthor,
        'only a new invocation ID or audit log location must not create new author work');
      assert(priorAuthor.includes(publicReply) && priorAuthor.includes(path.join(runDir, 'events.jsonl')),
        'the complete real public reply, evidence reference and existing audit entry stay reachable');
      assert.notEqual(renderPreviousAuthor('initial-design-author-i3', publicReply + '\n新的真实错误'), priorAuthor, 'real feedback changes must remain visible');
      assert.notEqual(renderPreviousAuthor('initial-design-author-i4', publicReply, 'failed'), priorAuthor, 'actual failed status is not audit jitter');
      assert.notEqual(renderPreviousAuthor('initial-design-author-i5', publicReply, 'passed', true), priorAuthor, 'actual timeout remains a real condition');
      const priorDir = path.join(runDir, 'phases/initial-design-questioning/previous-questioning');
      fs.mkdirSync(priorDir, { recursive: true });
      fs.writeFileSync(path.join(priorDir, 'draft-output.yaml'), YAML.stringify({ ...blueprint, review_summary: { questioning: {
        status: 'complete', items: [{ disposition: 'blocker', scope_ref: 'view:runtime', question: '旧交接问题是否已修复？', answer: '前次真实否定仍待复核' }],
      } } }));
      const previous = { ...manifest, run_id: 'previous-root', unattended: { ...UNATTENDED, approval_mode: 'never' as const } };
      const events = [{ type: 'agent_invoke_end', phase: 'initial-design-questioning', invoke_id: 'previous-questioning', status: 'passed', exit_code: 0 }];
      // The published draft no longer contains questioning after the author repair; the archived role result still does.
      const recheck = delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest, autonomyAuthorized: false,
        observation: { kind: 'questioning', blueprintPath, candidatesPath, issues: [] }, deliveryRuns: [{ manifest: previous, events }] });
      assert(recheck.includes('这是首次独立阅读'), 'a loose postimage without a completed clean invocation is not a trusted previous review');
      assert(recheck.includes('第1–4行') && !recheck.includes('本次控制入口已核实可信原请求'));
      assert(!recheck.includes('前次真实否定仍待复核') && !recheck.includes('旧交接问题是否已修复？'));
      assert(!recheck.includes(path.join(priorDir, 'draft-output.yaml')));
      for (const scope of requiredQuestioningScopes(blueprint).keys()) assert(recheck.includes(`- ${scope}（`));
      fs.unlinkSync(path.join(priorDir, 'draft-output.yaml'));
      const unfinished = delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest, autonomyAuthorized: false,
        observation: { kind: 'questioning', blueprintPath, candidatesPath, issues: [] }, deliveryRuns: [{ manifest: previous, events }] });
      assert(unfinished.includes('这是首次独立阅读'), 'an exited call without a questioning artifact cannot skip the first reading');
      assert(!unfinished.includes('前次真实否定仍待复核'));
      for (const authorized of [false, true]) {
        const live = manifests.buildInitialDesignGoalManifest({ ...manifest, feature: `authority-${authorized}`, run_id: `runtime-${authorized}`, report_dir: undefined }, { projectRoot: directory });
        const born = createGoalRun({ projectRoot: directory, manifest: live, chain: [] });
        const result = await withRuntimeTest({ root: directory }, () => entry.runGoalModeSessionStep({ projectRoot: directory, frameworkRoot, feature: live.feature, runId: live.run_id,
          adapter: 'codex', runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: authorized } }));
        assert.equal(result.type, 'phase_execute_request', 'lack of autonomy must not block the original author duty');
        const issued = readSessionExecution(path.dirname(born.manifestPath), (result.request as { path: string }).path)!;
        assert.equal(issued.request.context.instruction!.includes('本次控制入口已核实可信原请求'), authorized, 'runtime passes current policy before transport dispatch');
      }
    } finally {
      clearFrameworkConfigCache();
      assert(directory.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
});

export function getCases() { return cases; }
export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally {  endUnitCase(); }
  }
  return results;
}
