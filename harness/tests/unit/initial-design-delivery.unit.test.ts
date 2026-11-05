import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import { provisionFrameworkUnder, git } from '../utils/real-chain-host';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { clearFrameworkConfigCache } from '../../config';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { reportFixtureQuestioning, seedLedgerQuestioningInput } from '../utils/initial-questioning-fixture';
import { runRuntimeTestChild, withRuntimeTest, preserveRuntimeTestEvidence } from '../utils/runtime-test-control';

const ORIGINAL_BUDGET={max_total_turns:30,wall_clock_minutes:120,max_retries_per_phase:3};
const UNATTENDED={write_mode:'full-access' as const,approval_mode:'never' as const,timeout_seconds:900,max_turns:20};
const MODULE='02-Feature/Inbox',SOURCE_DIR=MODULE+'/src/main/ets';
type Project={root:string;frameworkRoot:string;harnessDir:string;feature:string;requirement:string;requirementSourceFiles:string[]};
async function withProject(run:(project:Project)=>void|Promise<void>):Promise<void>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'initial-design-control-'))),root=path.join(directory,'host');
  const priorTrust=process.env.MAISON_GOAL_CHECKPOINT_DIR;process.env.MAISON_GOAL_CHECKPOINT_DIR=path.join(directory,'.trust');
  try{
    fs.mkdirSync(path.join(root,'doc/features'),{recursive:true});
    const framework=provisionFrameworkUnder(root);
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
  const invoke=()=>spawnSync(process.execPath,['-r','ts-node/register/transpile-only',`scripts/${script}.ts`,'--project-root',project.root,'--feature',project.feature,...args],{cwd:project.harnessDir,encoding:'utf8',timeout:30_000});
  const result=script==='goal-mode-entry'?runRuntimeTestChild({root:project.root},invoke):invoke();
  assert.equal(result.status,0,`${script}: ${result.stderr}\n${result.stdout}\n${result.error??''}`);return JSON.parse(result.stdout.trim());
}
const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
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
}, {
  name: 'f3b8e6a1 public preparation births a managed raw-request root without fake construction identity and preserves explicit inputs on reentry',
  async run() {
    for (const turns of [20, 61]) await withProject(project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const manifests = require(path.join(project.harnessDir, 'scripts/utils/goal-manifest')) as typeof import('../../scripts/utils/goal-manifest');
      const input = { ...project, projectRoot: project.root, adapter: 'claude', runId: `initial-budget-${turns}`, budget: { ...ORIGINAL_BUDGET, max_total_turns: turns },
        unattended: UNATTENDED, adapterModelPin: { adapter: 'claude', value: 'claude-opus-5-5' },
        visualProviderPin: { adapter: 'claude', model: 'claude-opus-5-5' }, fidelity: 'reference_only' as const };
      const prepared = entry.prepareGoalModeRun(input);
      assert(manifests.isInitialDesignManifest(prepared.manifest), 'formal raw requirement must birth a managed initial-design root');
      const manifest = prepared.manifest;
      assert.equal(manifest.requirement, project.requirement);
      assert.deepEqual(manifest.requirement_source_files, project.requirementSourceFiles);
      assert.equal(manifest.budget, undefined);
      assert.deepEqual(manifest.unattended, { write_mode: 'full-access', approval_mode: 'never' });
      assert.deepEqual(manifest.adapter_model_pin, input.adapterModelPin);
      assert.deepEqual(manifest.visual_provider_pin, input.visualProviderPin);
      for (const key of ['execution_scope', 'phase_chain', 'chain_override', 'run_base_sha']) assert.equal((manifest as unknown as Record<string, unknown>)[key], undefined, key);
      const birth = fs.readFileSync(prepared.manifestPath, 'utf8');
      const events = () => fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events().filter(event => event.type === 'run_created').length, 1);
      assert(!events().some(event => ['phase_verdict', 'run_end', 'feature_complete'].includes(event.type)));
      const repeated = entry.prepareGoalModeRun({ ...input, runId: undefined });
      assert.equal(repeated.manifest.run_id, prepared.manifest.run_id);
      assert.equal(repeated.continuation.kind, 'rejoin');
      assert.equal(fs.readFileSync(prepared.manifestPath, 'utf8'), birth);
      assert.equal(events().filter(event => event.type === 'run_created').length, 1);
      assert.deepEqual(fs.readdirSync(path.dirname(prepared.runDir)).filter(file => !file.startsWith('.')), [manifest.run_id]);
      const beforeScopeProjection = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
      publicCli(project, 'goal-mode-entry', ['--prepare-scope', '--completion-target', 'feature', '--requested-results', project.requirement,
        '--requested-phases', 'spec,plan,coding,review,ut,testing', '--requirement-file', 'doc/requirement.md']);
      assert.equal(fs.readFileSync(prepared.manifestPath, 'utf8'), birth, 'raw-root scope reentry must remain a read-only delivery projection');
      assert.deepEqual(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl')), beforeScopeProjection);
      assert(!fs.existsSync(path.join(project.root, 'doc/features', project.feature, 'feature.yaml')), 'a managed raw request must not acquire a flat construction candidate');
    });
  },
}, {
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
}, {
  name: 'f3b8e6a1 public next reuses the original signed design request, rejects a wrong report, and never treats author exit as completion',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: 'initial-public-next', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: { ...ORIGINAL_BUDGET, max_total_turns: 2 }, unattended: UNATTENDED,
        adapterModelPin: { adapter: 'claude', value: 'claude-opus-5-5' }, autonomyAuthorized: true });
      const manifestBefore = fs.readFileSync(prepared.manifestPath);
      const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        adapter: 'claude', runId: prepared.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const first = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
      assert.equal(first.type, 'phase_execute_request', 'the managed raw request must issue its real design execution instead of returning early');
      assert.equal(first.status, 'execution_required');
      const reference = first.request as { path: string; sha256: string };
      const bytes = fs.readFileSync(reference.path);
      const issued = handoff.readSessionExecution(prepared.runDir, reference.path)!;
      assert(issued);
      const instruction = issued.request.context.instruction;
      assert(instruction);
      assert(instruction.includes(project.requirement));
      assert(instruction.includes('doc/requirement.md'));
      for (const file of ['app-component-blueprint.schema.json', 'runtime-data-flow.schema.json', 'change-unit.schema.json']) assert(instruction.includes(file), `the actual signed instruction must deliver the current schema ${file}`);
      assert(instruction.includes('尚无蓝图'));
      const repeated = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
      assert.deepEqual(repeated.request, reference);
      assert.equal(repeated.deadline, first.deadline);
      assert.deepEqual(fs.readFileSync(reference.path), bytes);
      const events = () => handoff.sessionEvents(prepared.runDir);
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 1);
      const wrongPhase = issued.request.context.phase === 'ut' ? 'coding' : 'ut';
      await assert.rejects(() => withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
        report: { status: 'passed', phase: wrongPhase, details: 'wrong request/phase must be rejected before acceptance' } })), /phase|execution result/);
      assert.equal(handoff.acceptedSessionReport(prepared.runDir, issued), null);
      const report = { status: 'passed' as const, phase: issued.request.context.phase, details: 'Author exited normally but produced no design.' };
      const continued = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path, report }));
      assert.equal(continued.type, 'phase_execute_request', 'native completion without a real design/current Q remains unknown work');
      assert(!events().some(event => event.type === 'run_end' && event.halt_reason === 'no_progress_guard'), 'an incomplete design/Q packet cannot manufacture no-progress acceptance');
      const duplicate = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path, report }));
      assert.equal(duplicate.type, 'goal_session_report_received'); assert.equal(duplicate.duplicate, true);
      const next = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
      assert.deepEqual(next.request, continued.request, 'ordinary next must reuse the actual pending continuation');
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 2);
      assert.equal(origin.readOriginalDeliveryActivity(project.root, prepared.manifest)!.calls, 2);
      assert(!events().some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))));
      assert(!fs.existsSync(path.join(project.root, 'doc/features', project.feature, 'completion.json')));
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 2);
      const retryReference = next.request as { path: string; sha256: string };
      const retry = handoff.readSessionExecution(prepared.runDir, retryReference.path)!;
      assert.notEqual(retry.request.invoke_id, issued.request.invoke_id);
      assert(retry.request.context.instruction?.includes(project.requirement), 'the incomplete real task remains in the original author scope');
      const terminal = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: retryReference.path,
        report: { status: 'waiting', phase: retry.request.context.phase, details: '受控入口夹具尚未执行后续设计；保留该原请求，真实执行者就绪后继续。' } }));
      assert.notEqual(terminal.type, 'phase_execute_request', 'a real waiting result must not silently purchase another author');
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 2);
      assert(!events().some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))));
      assert(!events().some(event => event.halt_reason === 'budget_turns'), 'retired quota metadata cannot terminate the current request');
      const budget = origin.readOriginalDeliveryActivity(project.root, prepared.manifest)!;
      assert.equal(budget.calls, 2);
      assert.deepEqual(fs.readFileSync(prepared.manifestPath), manifestBefore);
    });
  },
}, {
  name: 'f3b8e6a1 independent CLI next processes recover the same initial request and public status monitor assess show real incomplete design work',
  async run() {
    await withProject(project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: 'initial-cli-readers', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED, autonomyAuthorized: true });
      const statusBefore = publicCli(project, 'goal-status', ['--run-id', prepared.manifest.run_id, '--json']);
      assert.equal(statusBefore.kind, 'initial_design_delivery');
      assert.equal(statusBefore.complete, false);
      assert.equal(statusBefore.activity.calls, 0);
      assert(!('budget' in statusBefore));
      const args = ['--run-id', prepared.manifest.run_id, '--adapter', 'claude', '--run-mode', 'attended', '--authorize-autonomy', '--next'];
      const first = publicCli(project, 'goal-mode-entry', args);
      assert.equal(first.type, 'phase_execute_request');
      const bytes = fs.readFileSync(first.request.path);
      const recovered = publicCli(project, 'goal-mode-entry', args);
      assert.deepEqual(recovered.request, first.request, 'an exited control CLI must leave its original signed author request recoverable');
      assert.equal(recovered.deadline, first.deadline);
      assert.deepEqual(fs.readFileSync(first.request.path), bytes);
      const eventBytes = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
      const blueprintFile = path.join(project.root, 'doc/features', project.feature, 'blueprint/component-blueprint.yaml');
      const preparedBlueprint = fs.readFileSync(blueprintFile);
      const status = publicCli(project, 'goal-status', ['--run-id', prepared.manifest.run_id, '--json']);
      assert.equal(status.complete, false);
      assert.equal(status.activity.calls, 1);
      assert.equal(status.current.phase, first.phase);
      const monitor = publicCli(project, 'goal-monitor', ['--run-id', prepared.manifest.run_id, '--json', '--max-seconds', '0']);
      assert(!['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(monitor.status));
      assert.equal(monitor.phase, first.phase);
      const assessment = publicCli(project, 'assess', ['--run-id', prepared.manifest.run_id, '--framework-root', project.frameworkRoot, '--no-write']);
      assert.equal(assessment.kind, 'initial_design_delivery');
      assert.equal(assessment.complete, false);
      assert.equal(assessment.current.phase, first.phase);
      assert.notEqual(assessment.next_action, 'delivery_completed');
      assert(/initial-design|初始设计/.test(JSON.stringify(assessment)), 'assess must report the actual initial-design owner instead of idle construction');
      assert.deepEqual(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl')), eventBytes, 'public readers must not advance or rewrite the author history');
      assert.deepEqual(fs.readFileSync(blueprintFile), preparedBlueprint, 'readers must not rewrite the machine draft prepared by the original next');
    });
  },
}, {
  name: 'f3b8e6a1 unadmitted design requests cannot expand their write set into product tests or framework capabilities',
  async run() {
    for (const target of [`${SOURCE_DIR}/InboxStore.ets`, `${MODULE}/src/ohosTest/ets/test/InboxExisting.test.ets`, 'framework/profiles/hmos-app/harness/coding-host-rules.ts']) {
      await withProject(async project => {
        const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
        const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
        const absolute = path.join(project.root, target);
        fs.appendFileSync(absolute, '\n// Legitimate user dirty bytes before the design author starts.\n');
        const original = fs.readFileSync(absolute);
        const originalSha = createHash('sha256').update(original).digest('hex');
        const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
          runId: 'initial-write-boundary', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
          budget: ORIGINAL_BUDGET, unattended: UNATTENDED, autonomyAuthorized: true });
        const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, runId: prepared.manifest.run_id,
          adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
        const request = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
        assert.equal(request.type, 'phase_execute_request');
        const reference = request.request as { path: string };
        const issued = handoff.readSessionExecution(prepared.runDir, reference.path)!;
        fs.appendFileSync(absolute, '\n// Exact unauthorized write injected after the signed design request.\n');
        const changed = fs.readFileSync(absolute);
        const rejected = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
          report: { status: 'passed', phase: issued.request.context.phase, details: 'A normal author exit cannot authorize the injected write.' } }));
        assert.equal(rejected.type, 'phase_execute_request', 'the same unadmitted author must restore its own unauthorized delta');
        const recoveryReference = rejected.request as { path: string };
        const recovery = handoff.readSessionExecution(prepared.runDir, recoveryReference.path)!;
        assert.equal(recovery.request.context.phase, issued.request.context.phase);
        assert.equal(recovery.request.purpose, 'author');
        assert(recovery.request.context.instruction?.includes('Restore only your previous unauthorized writes')
          && recovery.request.context.instruction.includes(target) && recovery.request.context.instruction.includes(`pre_sha256=${originalSha}`),
          'recovery must carry the first real dirty preimage, not HEAD or later unauthorized bytes');
        assert(fs.readFileSync(absolute).equals(changed), 'runtime must preserve untrusted bytes for author recovery, not silently restore them');
        assert.deepEqual((await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options))).request, rejected.request, 'an outstanding restoration request must be reused');
        const beforeRestore = handoff.sessionEvents(prepared.runDir);
        const violation = beforeRestore.find(event => event.type === 'phase_write_violation');
        assert((violation as Record<string, any>)?.violations.some((row: Record<string, unknown>) => row.path === target && row.pre_sha256 === originalSha));
        assert(!beforeRestore.some(event => event.type === 'phase_verdict' || event.type === 'feature_completion_generated'),
          'unrestored unauthorized bytes cannot reach a construction gate or completion');
        const manifest = JSON.parse(fs.readFileSync(prepared.manifestPath, 'utf8'));
        assert(manifest.initial_design && !manifest.execution_scope && !manifest.phase_chain, 'recovery grants no construction scope');
        fs.writeFileSync(absolute, original);
        const restored = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: recoveryReference.path,
          report: { status: 'passed', phase: recovery.request.context.phase, details: 'Restored only the original invocation preimage; the requested design remains incomplete.' } }));
        assert(fs.readFileSync(absolute).equals(original), 'legitimate pre-existing dirty bytes must survive recovery');
        const events = handoff.sessionEvents(prepared.runDir);
        assert(events.some(event => event.type === 'phase_write_observed' && event.invoke_id === recovery.request.invoke_id
          && ((event as Record<string, any>).observations ?? []).some((row: Record<string, unknown>) => row.path === target && row.post_sha256 === originalSha)),
          'the real restored bytes must close the original write constraint');
        assert(!events.some(event => ['unauthorized_source_mutation', 'phase_write_violation_repeat'].includes(String(event.halt_reason))), JSON.stringify(restored));
        assert(!events.some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))));
      });
    }
  },
}, {
  name: 'f3b8e6a1 author-written completed questioning is rejected while an empty incomplete questioning skeleton remains repairable design work',
  async run() {
    for (const selfSigned of [false, true]) await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: `initial-questioning-${selfSigned}`, requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED, autonomyAuthorized: true });
      const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, runId: prepared.manifest.run_id,
        adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const request = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
      assert.equal(request.type, 'phase_execute_request');
      const reference = request.request as { path: string };
      const issued = handoff.readSessionExecution(prepared.runDir, reference.path)!;
      assert.equal(issued.request.purpose, 'author');
      const blueprint = path.join(project.root, 'doc/features', project.feature, 'blueprint/component-blueprint.yaml');
      fs.mkdirSync(path.dirname(blueprint), { recursive: true });
      const bytes = YAML.stringify({ artifact: 'component-blueprint@1', blueprint_id: project.feature,
        review_summary: { questioning: { status: selfSigned ? 'complete' : 'incomplete', items: selfSigned
          ? [{ question_id: 'author-self-signed', question: '作者是否独立？', answer: '作者自行宣称通过', scope_ref: 'requirement', evidence_refs: ['doc/requirement.md'] }] : [] } } });
      fs.writeFileSync(blueprint, bytes);
      const result = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
        report: { status: 'passed', phase: issued.request.context.phase, details: 'Bounded author response supplied only the specified questioning fault or incomplete skeleton.' } }));
      const events = handoff.sessionEvents(prepared.runDir);
      const authorityFailure = events.some(event => event.type === 'run_end' && event.halt_reason === 'unauthorized_source_mutation');
      assert.equal(authorityFailure, selfSigned, 'completed questioning written by the author must be rejected; an empty incomplete skeleton must remain repairable');
      if (selfSigned) { assert.equal(result.type, 'goal_session_result'); assert.equal(result.exit_code, 1); }
      else {
        assert.equal(result.type, 'phase_execute_request', 'ordinary missing design fields must return to their author');
        const retry = handoff.readSessionExecution(prepared.runDir, (result.request as { path: string }).path)!;
        assert.equal(retry.request.purpose, 'author');
        const delivery = require(path.join(project.harnessDir, 'scripts/utils/initial-design-delivery')) as typeof import('../../scripts/utils/initial-design-delivery');
        const manifests = require(path.join(project.harnessDir, 'scripts/utils/goal-manifest')) as typeof import('../../scripts/utils/goal-manifest');
        assert(manifests.isInitialDesignManifest(prepared.manifest));
        const diagnostics = delivery.readInitialDesignDelivery({ projectRoot: project.root, manifest: prepared.manifest }).issues;
        assert(diagnostics.length > 0, 'the malformed author draft must produce actual checker diagnostics');
        for (const diagnostic of diagnostics) assert(retry.request.context.instruction?.includes(diagnostic),
          `the real schema diagnostic id and reason must reach the responsible author: ${diagnostic}`);
      }
      const accepted = handoff.acceptedSessionReport(prepared.runDir, issued)!;
      assert(accepted);
      const archive = handoff.readHandoffMaterial<{ draft_outputs: Record<string, string> }>(prepared.runDir, accepted.event.handoff_report!);
      assert.equal(Buffer.from(archive.draft_outputs['initial-design-blueprint.yaml'], 'base64').toString('utf8'), bytes, 'the accepted raw author bytes stay available after machine admission projection');
    });
  },
}, {
  name: 'f3b8e6a1 prepared CU pipeline repeats root next without recreating or recounting its already signed child request',
  async run() {
    const hostFixture = require('./lifecycle-evolution.unit.test') as typeof import('./lifecycle-evolution.unit.test');
    const entry = require('../../scripts/goal-mode-entry') as typeof import('../../scripts/goal-mode-entry');
    const manifests = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const creation = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
    const scopes = require('../../scripts/utils/feature-track') as typeof import('../../scripts/utils/feature-track');
    const origin = require('../../scripts/utils/delivery-origin') as typeof import('../../scripts/utils/delivery-origin');
    const runtime = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
    const identity = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const requirement = '新增一笔账目后刷新账页并在重启后恢复余额';
    runtime.__testing_setInvokeAgent(async () => { throw new Error('A public next request must not launch a headless model.'); });
    runtime.__testing_setCanaryProbeInvoke(async () => { throw new Error('This prepared nonvisual pipeline must not launch a canary model.'); });
    try { await hostFixture.withFreshCuHost(async host => {
      const blueprint = 'ledger-app-blueprint';
      const original = manifests.buildInitialDesignGoalManifest({ feature: blueprint, run_id: 'pending-request-root', adapter: 'codex', requirement,
        initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: ['plan', 'coding', 'review', 'ut'] },
        budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended: UNATTENDED }, { projectRoot: host.root });
      creation.createGoalRun({ projectRoot: host.root, manifest: original, chain: [] });
      const feature = identity.deriveChangeUnitFeatureId(blueprint, 'ledger-refresh');
      scopes.prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
        completionTarget: 'feature', requestedResults: [requirement], requestedPhases: ['plan', 'coding', 'review', 'ut'], requirement, overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '既有账目领域函数，不含设备或UI目标', basisPaths: ['src/ledger/LedgerFeature.ets'] } });
      const prepared = entry.prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
        runId: 'pending-request-child', adapter: 'codex', requirement, deliveryOrigin: { feature: blueprint, run_id: original.run_id } });
      const control = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: blueprint, runId: original.run_id,
        adapter: 'codex', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const controlProcess = (extra: Record<string, unknown> = {}): Record<string, any> => {
        const program = `const path=require('path');const h=${JSON.stringify(host.harnessDir)};const rt=require(path.join(h,'scripts/goal-phase-runtime'));rt.__testing_setInvokeAgent(async()=>{throw Error('unexpected headless actor in a next/report control probe')});rt.__testing_setCanaryProbeInvoke(async()=>{throw Error('unexpected canary actor in a nonvisual control probe')});require(path.join(h,'scripts/goal-mode-entry')).runGoalModeSessionStep(${JSON.stringify({ ...control, ...extra })}).then(value=>console.log(JSON.stringify(value))).catch(error=>console.log(JSON.stringify({error:String(error)})));`;
        const result = withRuntimeTest({ root: host.root }, () => spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', program], { cwd: host.harnessDir,
          env: { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(host.root, 'trust-cp') }, encoding: 'utf8', timeout: 90_000, windowsHide: true }));
        assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}\n${result.error ?? ''}`);
        return JSON.parse(result.stdout.trim());
      };
      const sourceHashes = Object.fromEntries(['scripts/goal-mode-entry.ts', 'scripts/goal-phase-runtime.ts', 'scripts/utils/session-execution-handoff.ts']
        .map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(host.harnessDir, file))).digest('hex')]));
      console.log('[f3-pending-child-control-hashes]', JSON.stringify(sourceHashes));
      const first = controlProcess();
      assert.equal(first.type, 'phase_execute_request', JSON.stringify(first));
      assert.equal(first.run_id, prepared.manifest.run_id);
      const reference = first.request as { path: string; sha256: string };
      const bytes = fs.readFileSync(reference.path);
      assert.equal(origin.readOriginalDeliveryActivity(host.root, original)!.calls, 1);
      const wrong = controlProcess({ requestPath: reference.path, report: { status: 'passed', phase: first.phase === 'ut' ? 'coding' : 'ut', details: 'Injected wrong phase; no actor has run.' } });
      assert.match(String(wrong.error), /invalid execution (?:phase|result)/, 'a wrong child report must be rejected before changing pending work');
      assert.deepEqual(fs.readFileSync(reference.path), bytes);
      assert.equal(origin.readOriginalDeliveryActivity(host.root, original)!.calls, 1);
      const second = controlProcess();
      assert.equal(second.type, 'phase_execute_request', 'root recovery must re-deliver its pending child instead of allocating an outstanding conflicting request');
      assert.deepEqual(second.request, reference);
      assert.equal(second.deadline, first.deadline);
      assert.deepEqual(fs.readFileSync(reference.path), bytes);
      assert.equal(origin.readOriginalDeliveryActivity(host.root, original)!.calls, 1, 'repeated root next cannot charge a phantom second child invocation');
      for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(host.harnessDir, file))).digest('hex'), hash, 'all control processes must execute the same copied source version');
    }); } finally {
      runtime.__testing_setInvokeAgent(null); runtime.__testing_setCanaryProbeInvoke(null);
    }
  },
}];

for (const scenario of ['definition-gap', 'empty-chain'] as const) cases.push({
  name: `9f6c2e41 initial construction ${scenario === 'definition-gap' ? 'births spec and plan with unresolved definitions' : 'returns an empty executable chain to its scope owner'}`,
  async run() {
    const { withFreshCuHost } = require('./lifecycle-evolution.unit.test') as typeof import('./lifecycle-evolution.unit.test');
    const entry = require('../../scripts/goal-mode-entry') as typeof import('../../scripts/goal-mode-entry');
    const manifests = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const { createGoalRun } = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
    const { prepareFeatureScopeCandidate } = require('../../scripts/utils/feature-track') as typeof import('../../scripts/utils/feature-track');
    const { resolveBirthExecutionScope } = require('../../scripts/utils/feature-execution-scope') as typeof import('../../scripts/utils/feature-execution-scope');
    const { resolveWorkflowSpec } = require('../../workflow-loader') as typeof import('../../workflow-loader');
    const { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, enumerateCanonicalChangeUnits, asChangeUnitArtifact } = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const { readOriginalDeliveryActivity } = require('../../scripts/utils/delivery-origin') as typeof import('../../scripts/utils/delivery-origin');
    const { readSessionExecution } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const runtime = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
    runtime.__testing_setInvokeAgent(async () => { throw new Error('A public next request must not launch a headless model.'); });
    runtime.__testing_setCanaryProbeInvoke(async () => { throw new Error('This nonvisual birth regression must not launch a canary model.'); });
    try { await withFreshCuHost(async host => {
      seedLedgerQuestioningInput(host.root);
      const blueprint = 'ledger-app-blueprint', requirement = '新增一笔账目后刷新账页并在重启后恢复余额';
      const original = manifests.buildInitialDesignGoalManifest({ feature: blueprint, run_id: `scope-birth-${scenario}`, adapter: 'codex', requirement,
        initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] },
        budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended: UNATTENDED }, { projectRoot: host.root });
      const root = createGoalRun({ projectRoot: host.root, manifest: original, chain: [] });
      const rootRunDir = path.dirname(root.manifestPath);
      const feature = deriveChangeUnitFeatureId(blueprint, 'ledger-refresh');
      if (scenario === 'empty-chain') {
        const { handWriteProjections } = require('./component-design-handoff.unit.test') as typeof import('./component-design-handoff.unit.test');
        handWriteProjections(host.root);
      }
      const originalContracts = scenario === 'empty-chain' ? fs.readFileSync(path.join(host.root, 'doc/features', blueprint, 'ledger-refresh/contracts.yaml'), 'utf8') : undefined;
      const prepared = prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
        completionTarget: 'feature', requestedResults: [requirement], requirement, overwrite: true,
        requestedPhases: scenario === 'definition-gap' ? ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] : ['coding', 'review', 'ut'],
        impact: { userVisibleBehaviorChange: false, reason: '既有账目领域函数，不含设备或UI目标', basisPaths: ['src/ledger/LedgerFeature.ets'] } });
      prepared.candidate.facts.push(scenario === 'definition-gap'
        ? { id: 'acceptance-definition:pending', kind: 'acceptance-definition', applicability: 'unknown', reason: '新增验收定义仍待 spec 责任方补齐', basis: [prepared.candidate.request.requirement_basis!] }
        : { id: 'implementation:pending', kind: 'implementation', applicability: 'unknown', reason: '当前实现义务尚不可执行，下游必须等待', basis: prepared.candidate.facts.find(fact => fact.kind === 'implementation')!.basis });
      const candidate = YAML.parse(fs.readFileSync(prepared.path, 'utf8'));
      candidate.execution_scope = prepared.candidate;
      fs.writeFileSync(prepared.path, YAML.stringify(candidate));
      const scope = resolveBirthExecutionScope(host.root, feature, resolveWorkflowSpec(host.root, { frameworkRoot: host.frameworkRoot }), host.frameworkRoot, requirement).scope!;
      assert.deepEqual(scope.phase_chain, scenario === 'definition-gap' ? ['spec', 'plan'] : []);
      assert(scope.unresolved.length > 0);
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: blueprint,
        runId: original.run_id, adapter: 'codex', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const { repairAdapter } = require('./design-authority-repair.unit.test') as typeof import('./design-authority-repair.unit.test');
      const { asRecord, asRecords } = require('../../scripts/utils/component-blueprint-model') as typeof import('../../scripts/utils/component-blueprint-model');
      const { resolveBlueprintTarget } = require('../../scripts/utils/blueprint-addressing') as typeof import('../../scripts/utils/blueprint-addressing');
      const repairedUnits = new Set<string>();
      const approvedCriterion = (doc: Parameters<typeof resolveBlueprintTarget>[0], candidate: ReturnType<typeof asChangeUnitArtifact>): string => {
        const originalUnit = asChangeUnitArtifact(loadCanonicalChangeUnit(host.root, blueprint, candidate.change_unit_id).changeUnit);
        const ref = originalUnit.design_refs.find(item => item.target.kind === 'node' && item.target.view_id === 'logical');
        assert(ref, 'the existing CU must name its approved logical design');
        const node = asRecord(resolveBlueprintTarget(doc, ref.target));
        const acceptance = asRecord(node?.acceptance), contracts = asRecord(node?.contracts);
        const canonical = YAML.parse(fs.readFileSync(path.join(host.root, 'doc/features', blueprint, 'blueprint/component-blueprint.yaml'), 'utf8'));
        const originalNode = asRecord(resolveBlueprintTarget(canonical, ref.target));
        assert.deepEqual(acceptance?.criteria, asRecord(originalNode?.acceptance)?.criteria, 'a mapping repair may not invent another approved criterion');
        const approved = asRecords(acceptance?.criteria).filter(item => item.description === 'refresh and recover');
        assert.equal(approved.length, 1, 'only the original approved refresh/recovery criterion may supply this mapping');
        assert(typeof approved[0].id === 'string');
        assert(asRecords(contracts?.modules).some(item => item.name === 'ledger'), 'the approved owner must still be the ledger module');
        assert(fs.readFileSync(path.join(host.root, 'contracts/ledger-api.yaml'), 'utf8').includes('createEntry'), 'the approved source contract must be real');
        assert.deepEqual(candidate.provides, originalUnit.provides); assert.deepEqual(candidate.requires, originalUnit.requires);
        return approved[0].id;
      };
      const repair = repairAdapter(host, () => undefined, { fix: () => undefined, author: (doc, draft) => {
        const candidatePath = path.join(path.dirname(draft), 'change-unit.yaml');
        assert(fs.existsSync(candidatePath), 'a CU mapping finding must reach its actual CU draft, not a blueprint-only author');
        const candidate = asChangeUnitArtifact(YAML.parse(fs.readFileSync(candidatePath, 'utf8')));
        const mapApprovedCriterion = (unit: ReturnType<typeof asChangeUnitArtifact>): Set<string> => {
          const originalUnit = asChangeUnitArtifact(loadCanonicalChangeUnit(host.root, blueprint, unit.change_unit_id).changeUnit);
          const criterion = 'acceptance:' + approvedCriterion(doc, unit), changed = new Set<string>();
          assert.deepEqual(unit.target_predicates.map(item => item.predicate_id), originalUnit.target_predicates.map(item => item.predicate_id));
          for (const predicate of unit.target_predicates) {
            const prior = originalUnit.target_predicates.find(item => item.predicate_id === predicate.predicate_id)!;
            assert.deepEqual({ ...predicate, verification_refs: undefined }, { ...prior, verification_refs: undefined }, 'only the actual missing mapping is authored');
            assert(prior.verification_refs.every(ref => predicate.verification_refs.includes(ref)), 'retain every original predicate verification source');
            if (!predicate.verification_refs.includes(criterion)) {
              predicate.verification_refs.push(criterion);
              predicate.provide_ids.forEach(id => changed.add(id));
            }
          }
          if (changed.size) repairedUnits.add(unit.change_unit_id);
          return changed;
        };
        const changedProvides = mapApprovedCriterion(candidate);
        fs.writeFileSync(candidatePath, YAML.stringify(candidate));
        const consumers = enumerateCanonicalChangeUnits(host.root, blueprint).map(row => asChangeUnitArtifact(row.changeUnit))
          .filter(unit => unit.requires.some(ref => ref.from_change_unit_id === candidate.change_unit_id && changedProvides.has(ref.provide_id)))
          .map(unit => { mapApprovedCriterion(unit); return { providerId: 'design-repair', artifact: unit }; });
        fs.writeFileSync(path.join(path.dirname(draft), 'change-unit-candidates.json'), JSON.stringify(consumers, null, 2) + '\n');
      }, questioning: (doc, draft) => {
        const candidate = asChangeUnitArtifact(YAML.parse(fs.readFileSync(path.join(path.dirname(draft), 'change-unit.yaml'), 'utf8')));
        const consumers = JSON.parse(fs.readFileSync(path.join(path.dirname(draft), 'change-unit-candidates.json'), 'utf8')) as Array<{ providerId: string; artifact: ReturnType<typeof asChangeUnitArtifact> }>;
        for (const unit of [candidate, ...consumers.map(row => row.artifact)]) {
          const criterion = 'acceptance:' + approvedCriterion(doc, unit);
          assert(unit.target_predicates.every(item => item.verification_refs.includes(criterion)), 'independent Q must read the complete actual primary/consumer mappings');
        }
        fs.readFileSync(path.join(host.root, 'requirements/ledger.md'), 'utf8');
        fs.readFileSync(path.join(host.root, 'contracts/ledger-api.yaml'), 'utf8');
      } });
      let result = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options)), questions = 0;
      if (result.phase === 'initial-design-questioning') {
        result = await reportFixtureQuestioning(options, result, rootRunDir, path.join(host.root, 'doc/features', blueprint, 'blueprint/component-blueprint.yaml'));
        questions++;
      }
      while (result.type === 'phase_execute_request' && String(result.phase).startsWith('design-repair-')) {
        const requestPath = (result.request as { path: string }).path;
        const issued = readSessionExecution(rootRunDir, requestPath)!;
        const returned = await repair.onOutOfChain({ phase: issued.request.context.phase, prompt: issued.request.context.instruction!, attempt: 1, runId: original.run_id });
        result = await withRuntimeTest({ root: host.root }, () => entry.runGoalModeSessionStep({ ...options, requestPath,
          report: { status: 'passed', phase: issued.request.context.phase, details: typeof returned?.details === 'string' ? returned.details : 'read the original approved criterion, owner and contract and repaired the current CU draft' } }));
      }
      const family = readOriginalDeliveryActivity(host.root, original)!;
      const starts = family.events.filter(event => event.type === 'agent_invoke_start');
      const { workUnitExecutionRole } = require('../../scripts/utils/goal-phase-executor') as typeof import('../../scripts/utils/goal-phase-executor');
      const authors = starts.filter(event => {
        const purpose = asRecord(event)?.purpose;
        return typeof event.phase === 'string' && workUnitExecutionRole({ phase: event.phase }, typeof purpose === 'string' ? purpose : undefined) === 'author';
      });
      console.log('INITIAL_BIRTH_DIAGNOSTIC ' + JSON.stringify({ scenario, type: result.type, phase: result.phase,
        calls: family.calls, authorCalls: authors.length, authors: authors.map(event => ({ phase: event.phase, invoke_id: event.invoke_id })),
        lastEvents: family.events.slice(-5), result }));
      const children = family.runs.filter(run => !manifests.isInitialDesignManifest(run.manifest));
      if (result.type !== 'phase_execute_request' || scenario === 'empty-chain' && children.length) {
        const originals = [path.join(host.root, 'doc/features', blueprint, 'blueprint/component-blueprint.yaml'), path.join(rootRunDir, 'session-control.log'),
          ...['feature.yaml', 'contracts.yaml', 'acceptance.yaml', 'use-cases.yaml'].map(name => path.join(host.root, 'doc/features', blueprint, 'ledger-refresh', name)),
          ...['component-blueprint.yaml', 'change-unit.yaml', 'change-unit-candidates.json', 'architecture.json'].map(name => path.join(rootRunDir, 'design-repair', name)),
          ...enumerateCanonicalChangeUnits(host.root, blueprint).map(unit => unit.canonicalPath)];
        const attempted = [...family.events].reverse().map(event => asRecord(event))
          .find(event => event?.type === 'design_authority_repair' && event.stage === 'attempted' && asRecord(event.handoff_context));
        const originalContext = asRecord(attempted?.handoff_context);
        if (typeof originalContext?.path === 'string') originals.push(path.resolve(rootRunDir, originalContext.path));
        const { executionRequestForInvoke } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
        for (const event of starts.slice(-2)) if (typeof event.invoke_id === 'string') {
          const issued = executionRequestForInvoke(rootRunDir, event.invoke_id);
          if (issued) originals.push(path.resolve(rootRunDir, issued.reference.path));
        }
        console.log('INITIAL_BIRTH_ORIGINALS ' + preserveRuntimeTestEvidence([host.root], 'current root design did not reach its original responsibility', [], originals,
          { stdout: JSON.stringify({ scopeBeforePublication: scope, contractsBeforePublication: originalContracts }) }));
      }
      assert.equal(result.type, 'phase_execute_request', JSON.stringify(result));
      assert(authors.length < 10, 'this finite original design fixture must not repurchase an unbounded author loop');
      if (scenario === 'definition-gap') {
        assert.equal(children.length, 1);
        const child = children[0].manifest;
        assert(!manifests.isInitialDesignManifest(child));
        assert.deepEqual(child.delivery_origin, { feature: blueprint, run_id: original.run_id });
        const reboundScope = JSON.parse(JSON.stringify(scope)) as typeof scope;
        const reboundFiles = new Set([path.resolve(host.root, 'doc/features', blueprint, 'blueprint/component-blueprint.yaml'),
          path.resolve(loadCanonicalChangeUnit(host.root, blueprint, 'ledger-refresh').canonicalPath)]);
        let reboundHashes = 0;
        for (const [index, obligation] of reboundScope.obligations.entries()) for (const [bindingIndex, binding] of obligation.basis.entries()) {
          for (const [dependencyIndex, dependency] of binding.dependencies.entries()) {
            if (!reboundFiles.has(path.resolve(dependency.path))) continue;
            const actual = child.execution_scope!.obligations[index].basis[bindingIndex].dependencies[dependencyIndex];
            assert.equal(actual.path, dependency.path);
            const currentSha = createHash('sha256').update(fs.readFileSync(dependency.path)).digest('hex');
            assert.equal(actual.sha256, currentSha, 'each rebound blueprint/CU dependency must name its actual current bytes');
            dependency.sha256 = currentSha;
            reboundHashes++;
          }
        }
        assert.equal(reboundHashes, 8, 'only the eight observed blueprint/CU raw dependency hashes may be rebound');
        assert.deepEqual(child.execution_scope, reboundScope, `shared preparation must freeze the same unresolved and needed_by obligations: ${JSON.stringify({ expected: reboundScope, actual: child.execution_scope })}`);
        assert.deepEqual(child.phase_chain, ['spec', 'plan']);
        const issued = readSessionExecution(path.resolve(host.root, child.report_dir), (result.request as { path: string }).path)!;
        assert.equal(issued.request.context.phase, 'work-unit-author');
        assert.equal(issued.request.context.factsContext?.first_phase, 'spec', 'the immutable child birth anchor is still its real spec duty');
        assert.equal(result.run_id, child.run_id);
        assert(!fs.readFileSync(path.join(rootRunDir, 'events.jsonl'), 'utf8').includes('initial-design-scope-'), 'the scope owner must not be called again');
      } else {
        assert.equal(children.length, 0, `an empty chain must not birth a child: ${JSON.stringify(children.map(child => ({ feature: child.manifest.feature, execution_scope: child.manifest.execution_scope })))}`);
        const issued = readSessionExecution(rootRunDir, (result.request as { path: string }).path)!;
        assert(issued.request.context.phase.startsWith('initial-design-scope-'));
        assert(issued.request.context.instruction?.includes('当前实现义务尚不可执行'));
      }
      assert.equal(family.calls, family.events.filter(event => event.type === 'agent_invoke_start').length, 'activity counts every actual original-family invocation once');
      assert(family.calls >= 1 + questions);
      assert.equal(repairedUnits.size, 3, 'all three existing published-probe mapping gaps must pass the real author/Q/publication path');
    }); } finally {
      runtime.__testing_setInvokeAgent(null); runtime.__testing_setCanaryProbeInvoke(null);
    }
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
}, {
  name: 'P2 notes-only initial design stays unknown across real waiting and explicit continuation retains the original request and activity',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const old = seedLegacyContentLimitHistory(project, 7);
      const input = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'codex', requirement: project.requirement };
      const successor = entry.prepareGoalModeRun({ ...input, runId: 'quota-successor', supersede: [old.manifest.run_id] });
      const step = { ...input, runId: successor.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      let next = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep(step));
      assert.equal(next.type, 'phase_execute_request', 'the still-valid original authorization is relayed explicitly; a mode string never grants execution');
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) next = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep({ ...step, forceTakeover: true }));
        assert.equal(next.type, 'phase_execute_request');
        assert.deepEqual((await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep(step))).request, next.request);
        const requestPath = (next.request as { path: string }).path;
        const request = handoff.readSessionExecution(successor.runDir, requestPath)!;
        fs.appendFileSync(old.note, `只增笔记${attempt}\n`);
        next = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep({ ...step, requestPath, report: { status: 'waiting', phase: request.request.context.phase, details: `本轮仍未交付蓝图${attempt}；提供方暂不可用，恢复后继续原请求。` } }));
        assert.equal((next.result as { status: string }).status, 'waiting');
        assert(!handoff.sessionEvents(successor.runDir).some(event => event.type === 'run_end' && (event.halt_reason === 'no_progress_guard' || event.status === 'COMPLETED')),
          'notes and an unfinished provider cannot establish a completed design/Q baseline');
        const starts = handoff.sessionEvents(successor.runDir).filter(event => event.type === 'agent_invoke_start').length;
        assert.equal(starts, attempt, 'each actual continuation consumes exactly one original call');
      }
      assert.equal(next.type, 'goal_session_result');
      assert(!handoff.sessionEvents(successor.runDir).some(event => event.halt_reason === 'no_progress_guard'));
      assert.equal(origin.readOriginalDeliveryActivity(project.root, successor.manifest)!.calls, 6);
      assert(!handoff.sessionEvents(successor.runDir).some(event => event.halt_reason === 'budget_turns'), 'legacy numeric metadata cannot end a current continuation');
    });
  },
}, {
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
      for (const authorized of [false, true]) for (const kind of ['author', 'questioning'] as const) {
        const prompt = delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest,
          observation: { kind, blueprintPath, candidatesPath, issues: ['当前机器缺口'] }, autonomyAuthorized: authorized, deliveryRuns: [] });
        assert.equal(prompt.includes('本次控制入口已核实可信原请求'), authorized, 'default never and goal mode must not supply authority');
        for (const line of renderDesignAuthorityBoundary(kind)) assert.equal(prompt.includes(line), authorized);
        assert.equal(prompt.includes('§9 自动决议'), authorized);
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

cases.push({
  name: 'P2 M1 notes-only executor work remains unverified until actual waiting and public continuation preserves the original request and activity',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const runtime = require(path.join(project.harnessDir, 'scripts/goal-phase-runtime')) as typeof import('../../scripts/goal-phase-runtime');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        runId: 'M1-process-notes', adapter: 'codex', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED });
      const manifestBefore = fs.readFileSync(prepared.manifestPath);
      const note = path.join(project.root, 'doc/features', project.feature, 'blueprint/author-findings.md');
      const noteBody = '已有真实调查中间材料；仍未交付schema蓝图。\n';
      fs.mkdirSync(path.dirname(note), { recursive: true }); fs.writeFileSync(note, noteBody);
      const publicReply = '原样正常交回：蓝图仍未完成，本次未改变设计、源码或调查材料。';
      let calls = 0;
      const instructions: string[] = [];
      const driver = new runtime.GoalPhaseRuntime({ args: ['--project-root', project.root, '--framework-root', project.frameworkRoot,
        '--feature', project.feature, '--resume', prepared.manifest.run_id], executor: { async execute(context) {
        calls++;
        assert.equal(context.phase, 'initial-design-author');
        instructions.push(context.instruction ?? '');
        console.log('[M1-normal-return]', JSON.stringify({ call: calls,
          instruction_sha256: createHash('sha256').update(context.instruction ?? '').digest('hex') }));
        assert.equal(fs.readFileSync(note, 'utf8'), noteBody);
        const stdout = [JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: publicReply } }),
          JSON.stringify({ type: 'turn.completed' })].join('\n');
        fs.writeFileSync(path.join(context.runDir, 'phases', context.phase, context.attemptId, 'agent-output.log'), stdout);
        return { status: 'passed' as const, phase: context.phase, details: publicReply,
          exitCode: 0, stdout, stderr: '', command: 'bounded-notes-executor', completion_observed: true };
      } } });
      assert.equal(await withRuntimeTest({ root: project.root }, () => driver.run()), 1);
      const rows = handoff.sessionEvents(prepared.runDir);
      console.log('[M1-process-notes]', JSON.stringify({ calls, halt_reason: rows.at(-1)?.halt_reason,
        runtime_sha256: createHash('sha256').update(fs.readFileSync(path.join(project.harnessDir, 'scripts/goal-phase-runtime.ts'))).digest('hex') }));
      assert(!rows.some(event => event.type === 'run_end' && (event.halt_reason === 'no_progress_guard' || event.status === 'COMPLETED')),
        'missing design/Q facts cannot manufacture a completed acceptance evaluation');
      assert.equal(calls, 2, 'the first real public feedback is delivered once; unchanged normal returns must then wait without a fixture stop');
      assert(instructions[1].includes(publicReply), 'the original complete public feedback must reach the next real author');
      assert.equal(rows.at(-1)?.halt_reason, 'executor_waiting');
      assert(rows.filter(event => event.type === 'agent_invoke_end').every(event => event.completion_observed === true),
        'actual native completion must remain distinct from product acceptance');
      assert(!rows.some(event => event.type === 'phase_start' && event.handoff_request), 'this regression must use transport-independent request material');
      const spent = origin.readOriginalDeliveryActivity(project.root, prepared.manifest)!;
      assert.equal(spent.calls, calls);
      const starts = rows.filter(event => event.type === 'agent_invoke_start').length;
      const unstarted = path.join(prepared.runDir, 'phases/initial-design-author', `initial-design-author-i${starts + 1}`);
      assert(!fs.existsSync(unstarted), 'a rejected common dispatch must not pre-create the next guard or prompt');
      fs.mkdirSync(unstarted, { recursive: true });
      fs.writeFileSync(path.join(unstarted, 'prompt.md'), 'old unstarted machine preparation');
      fs.writeFileSync(path.join(unstarted, 'blueprint-before.yaml'), 'old unstarted preimage, not reusable');
      const next = await withRuntimeTest({ root: project.root }, () => entry.runGoalModeSessionStep({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        runId: prepared.manifest.run_id, adapter: 'codex', runMode: 'attended' }));
      assert.equal(next.type, 'goal_session_result', 'ordinary unchanged next must preserve the actual unknown wait');
      assert.equal(handoff.sessionEvents(prepared.runDir).filter(event => event.type === 'agent_invoke_start').length, starts);
      assert.equal(fs.readFileSync(path.join(unstarted, 'blueprint-before.yaml'), 'utf8'), 'old unstarted preimage, not reusable',
        'an unchanged observation must not consume or rewrite an unadmitted preparation');
      const continued = await withRuntimeTest({ root: project.root }, () => entry.runGoalModeSessionStep({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        runId: prepared.manifest.run_id, adapter: 'codex', runMode: 'attended', forceTakeover: true }));
      assert.equal(continued.type, 'phase_execute_request', 'a real explicit continuation may request the next original author once');
      const continuedRequest = handoff.readSessionExecution(prepared.runDir, (continued.request as { path: string }).path)!;
      assert.equal(continuedRequest.request.invoke_id, `initial-design-author-i${starts + 1}`);
      const currentBlueprint = path.join(project.root, 'doc/features', project.feature, 'blueprint/component-blueprint.yaml');
      assert.deepEqual(fs.readFileSync(path.join(unstarted, 'blueprint-before.yaml')),
        fs.existsSync(currentBlueprint) ? fs.readFileSync(currentBlueprint) : Buffer.alloc(0),
        'admitted continuation must capture the actual current preimage instead of reusing stale preparation');
      assert.equal(handoff.sessionEvents(prepared.runDir).filter(event => event.type === 'agent_invoke_start').length, starts + 1);
      assert.equal(origin.readOriginalDeliveryActivity(project.root, prepared.manifest)!.calls, calls + 1);
      assert.deepEqual(fs.readFileSync(prepared.manifestPath), manifestBefore);
    });
  },
}, {
  name: 'P2 M1 unqualified blank-line Q answers remain full historical context and later changes reach the next real author',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const blueprint = path.join(project.root, 'doc/features', project.feature, 'blueprint/component-blueprint.yaml');
      const firstParagraph = '共享首段：当前失败恢复责任未闭合。';
      const answer = firstParagraph + '\n\n第二段：保留完整卡数据和失败后的原入口。\n第三行：作者仍须修复。';
      fs.mkdirSync(path.dirname(blueprint), { recursive: true });
      fs.writeFileSync(blueprint, YAML.stringify({ artifact: 'component-blueprint@1', component_id: 'Inbox', blueprint_id: project.feature,
        revision: 1, decisions_and_gaps: { gaps: [] }, review_summary: { questioning: { status: 'complete', provider_id: 'independent-questioner',
          isolated_context: true, writes_ssot: false, items: [{ question_id: 'recovery', question: '失败后数据与返回责任是否闭合？',
            disposition: 'blocker', scope_ref: 'view:runtime', answer }] } } }));
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        runId: 'M1-multiline-questioning', adapter: 'codex', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED });
      const manifestBefore = fs.readFileSync(prepared.manifestPath);
      const step = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        runId: prepared.manifest.run_id, adapter: 'codex', runMode: 'attended' };
      let next = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep(step));
      let calls = 0;
      for (const currentAnswer of [answer, answer + '\n\n新增后段：补偿责任仍未声明。', firstParagraph]) {
        if (calls > 0) {
          const doc = YAML.parse(fs.readFileSync(blueprint, 'utf8'));
          doc.review_summary.questioning.items[0].answer = currentAnswer;
          fs.writeFileSync(blueprint, YAML.stringify(doc));
          next = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep(step));
        }
        assert.equal(next.type, 'phase_execute_request', 'a real change after the same first paragraph must remain actionable');
        const requestPath = (next.request as { path: string }).path;
        const issued = handoff.readSessionExecution(prepared.runDir, requestPath)!;
        assert.equal(issued.request.context.phase, 'initial-design-author');
        assert(issued.request.context.instruction!.includes(currentAnswer), JSON.stringify({ calls, currentAnswer,
          publicQuestioning: YAML.parse(fs.readFileSync(blueprint, 'utf8')).review_summary.questioning,
          priorContext: issued.request.context.instruction!.split('已有公开质询未闭合项')[1]?.slice(0, 2000) }));
        calls++;
        fs.appendFileSync(path.join(path.dirname(blueprint), 'author-findings.md'), `只写笔记${calls}\n`);
        const paused = await withRuntimeTest({ root: step.projectRoot }, () => entry.runGoalModeSessionStep({ ...step, requestPath,
          report: { status: 'waiting', phase: issued.request.context.phase, details: '蓝图与历史Q尚未独立核实；提供方暂不可用，保留完整旧回答等待继续。' } }));
        console.log('[M1-multiline-questioning]', JSON.stringify({ calls, type: paused.type, halt_reason: (paused.result as { halt_reason?: string } | undefined)?.halt_reason }));
        assert.equal(paused.type, 'goal_session_result');
        assert.equal((paused.result as { status: string }).status, 'waiting');
        assert(!handoff.sessionEvents(prepared.runDir).some(event => event.type === 'run_end' && (event.halt_reason === 'no_progress_guard' || event.status === 'COMPLETED')),
          'unqualified historical Q cannot become a completed no-progress evaluation');
        const starts = handoff.sessionEvents(prepared.runDir).filter(event => event.type === 'agent_invoke_start').length;
        assert.equal(starts, calls, 'each real feedback change permits one author call');
        const budget = origin.readOriginalDeliveryActivity(project.root, prepared.manifest)!;
        assert.equal(budget.calls, calls);
        assert.deepEqual(fs.readFileSync(prepared.manifestPath), manifestBefore);
      }
    });
  },
});

cases.push({
  name: 'P2 M1 current initial Q denial and a completed no-op author return converge once without consuming repeated reports',
  async run() {
    const { withFreshCuHost, BLUEPRINT_ID } = require('./lifecycle-evolution.unit.test') as typeof import('./lifecycle-evolution.unit.test');
    const entry = require('../../scripts/goal-mode-entry') as typeof import('../../scripts/goal-mode-entry');
    const handoff = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const { buildInitialDesignGoalManifest } = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const { createGoalRun } = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
    const { enumerateCanonicalChangeUnits } = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const { loadCanonicalBlueprint } = require('../../scripts/utils/component-blueprint-path') as typeof import('../../scripts/utils/component-blueprint-path');
    const { validateComponentBlueprint } = require('../../scripts/utils/component-blueprint-validator') as typeof import('../../scripts/utils/component-blueprint-validator');
    const { diffPhaseInvocationSnapshots } = require('../../scripts/utils/phase-write-boundary') as typeof import('../../scripts/utils/phase-write-boundary');
    const { readOriginalDeliveryActivity } = require('../../scripts/utils/delivery-origin') as typeof import('../../scripts/utils/delivery-origin');
    await withFreshCuHost(async host => {
      const workspace = path.join(host.root, 'doc/features', BLUEPRINT_ID);
      for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
        const directory = path.dirname(unit.canonicalPath);
        assert(path.resolve(directory).startsWith(path.resolve(workspace) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
      }
      const source = path.join(host.root, 'src/ledger/LedgerRepository.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      const dirtySource = 'export const currentLedgerInput = true;\n// pre-existing operator dirty bytes\n';
      fs.writeFileSync(source, dirtySource);
      const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
      assert(!validateComponentBlueprint(canonical.blueprint, { projectRoot: host.root, canonicalPath: canonical.canonicalPath })
        .some(issue => issue.severity === 'BLOCKER'), 'the fixture must begin with a known legal blueprint');
      const requirement = '按当前账目蓝图的原范围完成失败恢复设计、独立质询和后续完整交付，不降低验收。';
      const manifest = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'I10-current-initial-root', adapter: 'claude', requirement,
        initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] },
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED }, { projectRoot: host.root });
      const born = createGoalRun({ projectRoot: host.root, manifest, chain: [] }), runDir = path.dirname(born.manifestPath);
      const manifestBytes = fs.readFileSync(born.manifestPath);
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID, runId: manifest.run_id,
        adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const q = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
      assert.equal(q.phase, 'initial-design-questioning', JSON.stringify(q));
      const qPath = (q.request as { path: string }).path, qRequest = handoff.readSessionExecution(runDir, qPath)!;
      assert(qRequest.request.pre_snapshot && qRequest.request.write_boundary?.executionRole === 'verifier');
      const beforeQ = fs.readFileSync(canonical.canonicalPath);
      const items = YAML.parse(beforeQ.toString('utf8')).review_summary.questioning.items;
      const answer = '真实当前否定：失败恢复责任没有闭合。\n\n第二段必须完整保留：不能丢失既有账目，仍须从原入口恢复。';
      Object.assign(items[0], { disposition: 'blocker', question: '失败恢复是否满足当前原验收？', answer });
      const output = JSON.stringify({ items });
      const qReport = { status: 'passed' as const, phase: String(q.phase), details: output };
      const author = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: qPath, report: qReport }));
      assert.equal(author.phase, 'initial-design-author', JSON.stringify(author));
      const accepted = handoff.acceptedSessionReport(runDir, qRequest)!;
      const original = handoff.readHandoffMaterial<{ post_snapshot: NonNullable<typeof qRequest.request.pre_snapshot> }>(runDir, accepted.event.handoff_report!);
      assert.equal(diffPhaseInvocationSnapshots(qRequest.request.pre_snapshot!, original.post_snapshot).kind, 'clean');
      const qDirectory = path.join(runDir, 'phases', String(q.phase), qRequest.request.invoke_id);
      assert.deepEqual(fs.readFileSync(path.join(qDirectory, 'blueprint-before.yaml')), beforeQ);
      assert.equal(fs.readFileSync(path.join(qDirectory, 'questioning-output.json'), 'utf8'), output);
      const authorPath = (author.request as { path: string }).path, authorRequest = handoff.readSessionExecution(runDir, authorPath)!;
      assert(authorRequest.request.context.instruction!.includes(answer), 'the actual author must receive the complete current denial');
      const qualifiedBlueprint = fs.readFileSync(canonical.canonicalPath);
      const authorReport = { status: 'passed' as const, phase: String(author.phase), details: '实际作者已经读取全部当前问题；本次原样交回，没有修改任何设计或源码。' };
      const stopped = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath: authorPath, report: authorReport }));
      assert.equal(stopped.type, 'goal_session_result', JSON.stringify(stopped));
      assert.equal((stopped.result as { halt_reason?: string }).halt_reason, 'no_progress_guard', JSON.stringify(stopped));
      const starts = () => handoff.sessionEvents(runDir).filter(event => event.type === 'agent_invoke_start');
      assert.deepEqual(starts().map(event => event.phase), ['initial-design-questioning', 'initial-design-author']);
      for (const [requestPath, report] of [[qPath, qReport], [authorPath, authorReport]] as const) {
        const repeated = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath, report }));
        assert(repeated.type === 'goal_session_report_received' && repeated.duplicate === true, JSON.stringify(repeated));
      }
      for (let read = 0; read < 2; read++) {
        const observed = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
        assert.equal(observed.type, 'goal_session_result', JSON.stringify(observed));
        assert.equal((observed.result as { halt_reason?: string }).halt_reason, 'no_progress_guard');
      }
      assert.equal(starts().length, 2, 'repeated reports/observations cannot buy another author or comparison window');
      assert.equal(readOriginalDeliveryActivity(host.root, manifest)!.calls, 2);
      assert.deepEqual(fs.readFileSync(canonical.canonicalPath), qualifiedBlueprint, 'the current independent answers and unpublished design bytes must remain intact');
      assert.equal(fs.readFileSync(source, 'utf8'), dirtySource, 'the original dirty source bytes must be retained');
      assert.deepEqual(fs.readFileSync(born.manifestPath), manifestBytes);
      assert(!handoff.sessionEvents(runDir).some(event => event.type === 'run_end' && event.status === 'COMPLETED'));
    });
  },
});

cases.push({
  name: 'P2 review R1 process initial Q reuses only actual unchanged invocation originals across a new runtime',
  async run() {
    const { withFreshCuHost, BLUEPRINT_ID } = require('./lifecycle-evolution.unit.test') as typeof import('./lifecycle-evolution.unit.test');
    const { enumerateCanonicalChangeUnits } = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const { loadCanonicalBlueprint } = require('../../scripts/utils/component-blueprint-path') as typeof import('../../scripts/utils/component-blueprint-path');
    const { buildInitialDesignGoalManifest } = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const { createGoalRun } = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
    const { sessionEvents, executionRequestForInvoke } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const { readDesignQuestioningOriginal } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
    const { GoalPhaseRuntime } = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
    for (const scenario of ['unchanged', 'business', 'dependency', 'missing-original'] as const) await withFreshCuHost(async host => {
      const workspace = path.join(host.root, 'doc/features', BLUEPRINT_ID);
      for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
        const directory = path.dirname(unit.canonicalPath);
        assert(path.resolve(directory).startsWith(path.resolve(workspace) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
      }
      const source = path.join(host.root, 'src/ledger/LedgerRepository.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, 'export const currentLedgerInput = true;\n// original dirty operator bytes\n');
      const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
      const manifest = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: `review-r1-process-${scenario}`, adapter: 'claude',
        requirement: '按当前账目蓝图原范围完成失败恢复设计、独立质询及交付，不降低验收。',
        initial_design: { completion_target: 'feature', requested_results: ['完整交付'], requested_phases: [] },
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED }, { projectRoot: host.root });
      const born = createGoalRun({ projectRoot: host.root, manifest, chain: [] }), runDir = path.dirname(born.manifestPath);
      const manifestBefore = fs.readFileSync(born.manifestPath), calls: string[] = [];
      let resuming = false;
      const executor = { async execute(context: import('../../scripts/utils/goal-phase-executor').WorkUnitExecutionContext) {
        calls.push(context.phase);
        // Stop the controlled replacement at the first genuinely required new Q; do not manufacture its completion.
        if (resuming || calls.length > 2) return { status: 'waiting' as const, phase: context.phase, exitCode: 0, stdout: '', stderr: '',
          command: 'controlled-Q-recovery', details: '当前真实输入需要新的独立阅读；受控提供方尚未提交结果。' };
        let details = '真实作者已收到当前完整否定；本次原样完成交回，没有修改设计或源码。';
        if (context.phase === 'initial-design-questioning') {
          const items = YAML.parse(fs.readFileSync(canonical.canonicalPath, 'utf8')).review_summary.questioning.items;
          Object.assign(items[0], { disposition: 'blocker', question: '失败恢复是否满足当前原验收？', answer: '当前失败恢复责任尚未闭合，原验收必须保留。' });
          details = JSON.stringify({ items });
        } else assert(context.instruction?.includes('当前失败恢复责任尚未闭合'), 'the actual no-op author must receive the real denial');
        return { status: 'passed' as const, phase: context.phase, exitCode: 0, stdout: '', stderr: '', command: 'controlled-Q-recovery', completion_observed: true, details };
      } };
      const run = () => withRuntimeTest({ root: host.root }, () => new GoalPhaseRuntime({ args: ['--project-root', host.root, '--framework-root', host.frameworkRoot,
        '--feature', BLUEPRINT_ID, '--resume', manifest.run_id], executor }).run());
      const first = await run(), events = sessionEvents(runDir);
      assert.deepEqual(calls, ['initial-design-questioning', 'initial-design-author'], JSON.stringify({ scenario, first }));
      assert.equal([...events].reverse().find(event => event.type === 'run_end')?.halt_reason, 'no_progress_guard');
      assert(!events.some(event => event.type === 'phase_start' && event.handoff_request), 'this must cover process originals, not session handoff archives');
      const start = events.find(event => event.type === 'agent_invoke_start' && event.phase === 'initial-design-questioning')!;
      assert(start?.invoke_id);
      const original = readDesignQuestioningOriginal(runDir, start), request = executionRequestForInvoke(runDir, start.invoke_id!);
      assert(original?.completed && original.output && original.preSnapshot && original.postSnapshot, `${scenario}: real completed/readonly invocation originals must survive`);
      assert.deepEqual(original.preSnapshot, request?.request.pre_snapshot, 'the original preimage must come from the signed process request');
      const directory = path.join(runDir, 'phases', start.phase!, start.invoke_id!), resultFile = path.join(directory, 'design-result.json');
      const resultBytes = fs.readFileSync(resultFile), outputFile = path.join(directory, 'questioning-output.json'), outputBytes = fs.readFileSync(outputFile);
      if (scenario === 'business') {
        const changed = YAML.parse(fs.readFileSync(canonical.canonicalPath, 'utf8'));
        changed.review_summary.summary += '\n作者新增真实业务陈述：失败恢复还需重新核对当前余额投影。';
        fs.writeFileSync(canonical.canonicalPath, YAML.stringify(changed));
      } else if (scenario === 'dependency') fs.appendFileSync(source, '\nexport const recoveryDependencyChanged = true;\n');
      else if (scenario === 'missing-original') {
        fs.unlinkSync(resultFile);
        fs.unlinkSync(path.join(directory, 'draft-output.yaml'));
        const missing = readDesignQuestioningOriginal(runDir, start);
        assert(!missing?.postSnapshot && !missing?.afterBlueprint, 'without either actual historical postimage, an old completed end cannot prove unchanged inputs');
      }
      const blueprintBefore = fs.readFileSync(canonical.canonicalPath), sourceBefore = fs.readFileSync(source);
      resuming = true;
      const resumed = await run(), after = sessionEvents(runDir);
      if (scenario === 'unchanged') {
        assert.equal(calls.length, 2, JSON.stringify({ calls, resumed }));
        assert.equal([...after].reverse().find(event => event.type === 'run_end')?.halt_reason, 'no_progress_guard');
        assert.deepEqual(fs.readFileSync(canonical.canonicalPath), blueprintBefore, 'an unchanged observation preserves the independent answer bytes');
      } else assert.deepEqual(calls, ['initial-design-questioning', 'initial-design-author', 'initial-design-questioning'], JSON.stringify({ scenario, resumed, calls }));
      assert.deepEqual(fs.readFileSync(source), sourceBefore, 'recovery cannot discard actual source or prior dirty bytes');
      assert.deepEqual(fs.readFileSync(outputFile), outputBytes, 'new work cannot rewrite the previous independent raw output');
      if (scenario !== 'missing-original') assert.deepEqual(fs.readFileSync(resultFile), resultBytes, 'the completed original is immutable');
      assert.deepEqual(fs.readFileSync(born.manifestPath), manifestBefore);
      assert(!after.some(event => event.type === 'run_end' && event.status === 'COMPLETED'), 'a reused negative result cannot claim completion');
    });
  },
});

cases.push({
  name: 'P2 Q a production archived dirty post cannot be replaced by an unchanged blueprint original',
  async run() {
    const { withFreshCuHost, BLUEPRINT_ID } = require('./lifecycle-evolution.unit.test') as typeof import('./lifecycle-evolution.unit.test');
    const entry = require('../../scripts/goal-mode-entry') as typeof import('../../scripts/goal-mode-entry');
    const handoff = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const { buildInitialDesignGoalManifest } = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const { createGoalRun } = require('../../scripts/utils/goal-run-creation') as typeof import('../../scripts/utils/goal-run-creation');
    const { enumerateCanonicalChangeUnits } = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const { loadCanonicalBlueprint } = require('../../scripts/utils/component-blueprint-path') as typeof import('../../scripts/utils/component-blueprint-path');
    const { diffPhaseInvocationSnapshots } = require('../../scripts/utils/phase-write-boundary') as typeof import('../../scripts/utils/phase-write-boundary');
    const { invocationCompleted } = require('../../scripts/utils/invocation-completion') as typeof import('../../scripts/utils/invocation-completion');
    const { readDesignQuestioningOriginal, reusableDesignQuestioning } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
    await withFreshCuHost(async host => {
      const workspace = path.join(host.root, 'doc/features', BLUEPRINT_ID);
      for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
        const directory = path.dirname(unit.canonicalPath);
        assert(path.resolve(directory).startsWith(path.resolve(workspace) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
      }
      const source = path.join(host.root, 'src/ledger/LedgerRepository.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, 'export const originalDirtyOperatorInput = true;\n');
      const sourceBefore = fs.readFileSync(source), canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
      const manifest = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'Q-known-dirty-post', adapter: 'claude',
        requirement: '按当前账目蓝图原范围完成失败恢复设计与独立质询，不降低验收。',
        initial_design: { completion_target: 'feature', requested_results: ['完整交付'], requested_phases: [] },
        budget: ORIGINAL_BUDGET, unattended: UNATTENDED }, { projectRoot: host.root });
      const born = createGoalRun({ projectRoot: host.root, manifest, chain: [] }), runDir = path.dirname(born.manifestPath);
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID, runId: manifest.run_id,
        adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const q = await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep(options));
      assert.equal(q.phase, 'initial-design-questioning');
      const requestPath = (q.request as { path: string }).path, issued = handoff.readSessionExecution(runDir, requestPath)!;
      const before = fs.readFileSync(canonical.canonicalPath, 'utf8');
      const items = YAML.parse(before).review_summary.questioning.items;
      Object.assign(items[0], { disposition: 'blocker', question: '失败恢复是否满足当前原验收？', answer: '原失败恢复责任尚未闭合。' });
      const output = JSON.stringify({ items });
      fs.appendFileSync(source, '\nexport const unauthorizedQuestionerWrite = true;\n');
      await withRuntimeTest({ root: options.projectRoot }, () => entry.runGoalModeSessionStep({ ...options, requestPath, report: { status: 'passed', phase: String(q.phase), details: output } }));
      const accepted = handoff.acceptedSessionReport(runDir, issued)!;
      const archived = handoff.readHandoffMaterial<{ post_snapshot: NonNullable<typeof issued.request.pre_snapshot>; draft_outputs: Record<string, string> }>(runDir, accepted.event.handoff_report!);
      assert.equal(diffPhaseInvocationSnapshots(issued.request.pre_snapshot!, archived.post_snapshot).kind, 'changed', 'the dirty post is captured by the real session acceptance path');
      const afterBlueprint = Buffer.from(archived.draft_outputs['initial-design-blueprint.yaml'], 'base64').toString('utf8');
      assert.equal(afterBlueprint, before, 'the actual archived Q blueprint is unchanged even though its scope post is dirty');
      const archivedBytes = fs.readFileSync(path.resolve(runDir, accepted.event.handoff_report!.path));
      fs.writeFileSync(source, sourceBefore);
      assert.equal(reusableDesignQuestioning({ projectRoot: host.root, blueprintPath: canonical.canonicalPath,
        blueprint: YAML.parse(before), beforeBlueprint: before, output, providerId: 'initial-design-questioning',
        completed: invocationCompleted({ ...accepted.event, exitCode: accepted.event.exit_code }),
        preSnapshot: issued.request.pre_snapshot ?? undefined, postSnapshot: archived.post_snapshot, afterBlueprint }), null,
      'restored current inputs or another real blueprint postimage cannot wash a known failed original post');
      const start = handoff.sessionEvents(runDir).find(event => event.type === 'agent_invoke_start' && event.invoke_id === issued.request.invoke_id)!;
      const original = readDesignQuestioningOriginal(runDir, start);
      assert(!original || !reusableDesignQuestioning({ ...original, projectRoot: host.root, blueprintPath: canonical.canonicalPath, blueprint: YAML.parse(before) }),
        'the shared historical reader cannot repurchase validity for the rejected invocation');
      assert.deepEqual(fs.readFileSync(path.resolve(runDir, accepted.event.handoff_report!.path)), archivedBytes, 'the known dirty archive is never rewritten');
      assert(!handoff.sessionEvents(runDir).some(event => event.type === 'run_end' && event.status === 'COMPLETED'));
    });
  },
});

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
