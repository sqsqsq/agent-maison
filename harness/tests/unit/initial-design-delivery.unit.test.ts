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
  const result=spawnSync(process.execPath,['-r','ts-node/register/transpile-only',`scripts/${script}.ts`,'--project-root',project.root,'--feature',project.feature,...args],{cwd:project.harnessDir,encoding:'utf8',timeout:30_000});
  assert.equal(result.status,0,`${script}: ${result.stderr}\n${result.stdout}\n${result.error??''}`);return JSON.parse(result.stdout.trim());
}
const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
  name: 'f3b8e6a1 real public prepare CLI consumes a raw-only input definition and preserves the explicit original budget timeout and model pin',
  async run() {
    await withProject(project => {
      assert.deepEqual(fs.readdirSync(path.join(project.root, 'doc/features')), []);
      const inputPath = path.join(project.root, 'doc/request-input.yaml');
      const inputBytes = fs.readFileSync(inputPath);
      const result = publicCli(project, 'goal-mode-entry', ['--prepare-run', '--manifest', 'doc/request-input.yaml', '--run-mode', 'attended']);
      assert.equal(result.type, 'goal_run_prepared');
      const manifest = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
      assert(manifest.initial_design);
      assert.equal(manifest.requirement, project.requirement);
      assert.deepEqual(manifest.requirement_source_files, ['doc/requirement.md']);
      assert.equal(manifest.budget.max_total_turns, 30);
      assert.equal(manifest.budget.wall_clock_minutes, 120);
      assert.equal(manifest.unattended.timeout_seconds, 900);
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
      assert.deepEqual(manifest.budget, { ...ORIGINAL_BUDGET, max_total_turns: turns, max_transient_api_retries: 3 });
      assert.deepEqual(manifest.unattended, UNATTENDED);
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
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: 'initial-public-next', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: { ...ORIGINAL_BUDGET, max_total_turns: 2 }, unattended: UNATTENDED,
        adapterModelPin: { adapter: 'claude', value: 'claude-opus-5-5' }, autonomyAuthorized: true });
      const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        adapter: 'claude', runId: prepared.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const first = await entry.runGoalModeSessionStep(options);
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
      const repeated = await entry.runGoalModeSessionStep(options);
      assert.deepEqual(repeated.request, reference);
      assert.equal(repeated.deadline, first.deadline);
      assert.deepEqual(fs.readFileSync(reference.path), bytes);
      const events = () => handoff.sessionEvents(prepared.runDir);
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 1);
      const wrongPhase = issued.request.context.phase === 'ut' ? 'coding' : 'ut';
      await assert.rejects(() => entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
        report: { status: 'passed', phase: wrongPhase, details: 'wrong request/phase must be rejected before acceptance' } }), /phase|execution result/);
      assert.equal(handoff.acceptedSessionReport(prepared.runDir, issued), null);
      let next = await entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
        report: { status: 'passed', phase: issued.request.context.phase, details: 'Author exited normally but produced no design.' } });
      if (next.type !== 'phase_execute_request') next = await entry.runGoalModeSessionStep(options);
      assert.equal(next.type, 'phase_execute_request', 'missing design must return to its responsible author within the remaining real budget');
      assert(!events().some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))));
      assert(!fs.existsSync(path.join(project.root, 'doc/features', project.feature, 'completion.json')));
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 2);
      const retryReference = next.request as { path: string; sha256: string };
      const retry = handoff.readSessionExecution(prepared.runDir, retryReference.path)!;
      assert.notEqual(retry.request.invoke_id, issued.request.invoke_id);
      assert(retry.request.context.instruction?.includes('尚无蓝图'));
      const terminal = await entry.runGoalModeSessionStep({ ...options, requestPath: retryReference.path,
        report: { status: 'passed', phase: retry.request.context.phase, details: 'Second author also has no deliverable.' } });
      assert.notEqual(terminal.type, 'phase_execute_request', 'a third author call must not bypass the two-call budget');
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 2);
      assert(!events().some(event => event.type === 'run_end' && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(String(event.status))));
      assert(events().some(event => event.halt_reason === 'budget_turns'), 'the original hard budget must explain the incomplete result');
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
      assert.equal(statusBefore.budget.total_turns, 0);
      assert.equal(statusBefore.budget.max_total_turns, 30);
      assert.equal(statusBefore.budget.wall_clock_minutes, 120);
      const args = ['--run-id', prepared.manifest.run_id, '--adapter', 'claude', '--run-mode', 'attended', '--authorize-autonomy', '--next'];
      const first = publicCli(project, 'goal-mode-entry', args);
      assert.equal(first.type, 'phase_execute_request');
      const bytes = fs.readFileSync(first.request.path);
      const recovered = publicCli(project, 'goal-mode-entry', args);
      assert.deepEqual(recovered.request, first.request, 'an exited control CLI must leave its original signed author request recoverable');
      assert.equal(recovered.deadline, first.deadline);
      assert.deepEqual(fs.readFileSync(first.request.path), bytes);
      const eventBytes = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
      const status = publicCli(project, 'goal-status', ['--run-id', prepared.manifest.run_id, '--json']);
      assert.equal(status.complete, false);
      assert.equal(status.budget.total_turns, 1);
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
      assert(!fs.existsSync(path.join(project.root, 'doc/features', project.feature, 'blueprint')), 'status and assess do not author the missing design');
    });
  },
}, {
  name: 'f3b8e6a1 unadmitted design requests cannot expand their write set into product tests or framework capabilities',
  async run() {
    for (const target of [`${SOURCE_DIR}/InboxStore.ets`, `${MODULE}/src/ohosTest/ets/test/InboxExisting.test.ets`, 'framework/profiles/hmos-app/harness/coding-host-rules.ts']) {
      await withProject(async project => {
        const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
        const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
        const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
          runId: 'initial-write-boundary', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
          budget: ORIGINAL_BUDGET, unattended: UNATTENDED, autonomyAuthorized: true });
        const options = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, runId: prepared.manifest.run_id,
          adapter: 'claude', runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
        const request = await entry.runGoalModeSessionStep(options);
        assert.equal(request.type, 'phase_execute_request');
        const reference = request.request as { path: string };
        const issued = handoff.readSessionExecution(prepared.runDir, reference.path)!;
        fs.appendFileSync(path.join(project.root, target), '\n// Exact unauthorized write injected after the signed design request.\n');
        const rejected = await entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
          report: { status: 'passed', phase: issued.request.context.phase, details: 'A normal author exit cannot authorize the injected write.' } });
        assert.equal(rejected.type, 'goal_session_result');
        assert.equal(rejected.exit_code, 1);
        const events = handoff.sessionEvents(prepared.runDir);
        assert(events.some(event => event.type === 'run_end' && event.halt_reason === 'unauthorized_source_mutation'), target);
        assert.equal(events.filter(event => event.type === 'agent_invoke_start').length, 1);
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
      const request = await entry.runGoalModeSessionStep(options);
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
      const result = await entry.runGoalModeSessionStep({ ...options, requestPath: reference.path,
        report: { status: 'passed', phase: issued.request.context.phase, details: 'Bounded author response supplied only the specified questioning fault or incomplete skeleton.' } });
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
        const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', program], { cwd: host.harnessDir,
          env: { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(host.root, 'trust-cp') }, encoding: 'utf8', timeout: 90_000, windowsHide: true });
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
      assert.equal(origin.readOriginalDeliveryBudget(host.root, original)!.totalTurns, 1);
      const wrong = controlProcess({ requestPath: reference.path, report: { status: 'passed', phase: first.phase === 'ut' ? 'coding' : 'ut', details: 'Injected wrong phase; no actor has run.' } });
      assert.match(String(wrong.error), /invalid execution (?:phase|result)/, 'a wrong child report must be rejected before changing pending work');
      assert.deepEqual(fs.readFileSync(reference.path), bytes);
      assert.equal(origin.readOriginalDeliveryBudget(host.root, original)!.totalTurns, 1);
      const second = controlProcess();
      assert.equal(second.type, 'phase_execute_request', 'root recovery must re-deliver its pending child instead of allocating an outstanding conflicting request');
      assert.deepEqual(second.request, reference);
      assert.equal(second.deadline, first.deadline);
      assert.deepEqual(fs.readFileSync(reference.path), bytes);
      assert.equal(origin.readOriginalDeliveryBudget(host.root, original)!.totalTurns, 1, 'repeated root next cannot charge a phantom second child invocation');
      for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(host.harnessDir, file))).digest('hex'), hash, 'all control processes must execute the same copied source version');
    }); } finally {
      runtime.__testing_setInvokeAgent(null); runtime.__testing_setCanaryProbeInvoke(null);
    }
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
