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
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const prepared = entry.prepareGoalModeRun({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'claude',
        runId: 'initial-public-next', requirement: project.requirement, requirementSourceFiles: project.requirementSourceFiles,
        budget: { ...ORIGINAL_BUDGET, max_total_turns: 2 }, unattended: UNATTENDED,
        adapterModelPin: { adapter: 'claude', value: 'claude-opus-5-5' }, autonomyAuthorized: true });
      const manifestBefore = fs.readFileSync(prepared.manifestPath);
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
      const report = { status: 'passed' as const, phase: issued.request.context.phase, details: 'Author exited normally but produced no design.' };
      const paused = await entry.runGoalModeSessionStep({ ...options, requestPath: reference.path, report });
      assert.equal(paused.type, 'goal_session_result', 'an unchanged missing design must pause before spending another author call');
      assert(events().some(event => event.type === 'run_end' && event.halt_reason === 'no_progress_guard'));
      const duplicate = await entry.runGoalModeSessionStep({ ...options, requestPath: reference.path, report });
      assert.equal(duplicate.type, 'goal_session_report_received'); assert.equal(duplicate.duplicate, true);
      assert.equal((await entry.runGoalModeSessionStep(options)).type, 'goal_session_result');
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, 1);
      assert.equal(origin.readOriginalDeliveryBudget(project.root, prepared.manifest)!.totalTurns, 1);
      const next = await entry.runGoalModeSessionStep({ ...options, forceTakeover: true });
      assert.equal(next.type, 'phase_execute_request', 'explicit continuation may use the remaining original budget');
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
      const budget = origin.readOriginalDeliveryBudget(project.root, prepared.manifest)!;
      assert.equal(budget.totalTurns, 2); assert.equal(budget.budget.max_total_turns, 2);
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
    const { deriveChangeUnitFeatureId } = require('../../scripts/utils/change-unit-path') as typeof import('../../scripts/utils/change-unit-path');
    const { readOriginalDeliveryBudget } = require('../../scripts/utils/delivery-origin') as typeof import('../../scripts/utils/delivery-origin');
    const { readSessionExecution } = require('../../scripts/utils/session-execution-handoff') as typeof import('../../scripts/utils/session-execution-handoff');
    const runtime = require('../../scripts/goal-phase-runtime') as typeof import('../../scripts/goal-phase-runtime');
    runtime.__testing_setInvokeAgent(async () => { throw new Error('A public next request must not launch a headless model.'); });
    runtime.__testing_setCanaryProbeInvoke(async () => { throw new Error('This nonvisual birth regression must not launch a canary model.'); });
    try { await withFreshCuHost(async host => {
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
      const result = await entry.runGoalModeSessionStep({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: blueprint,
        runId: original.run_id, adapter: 'codex', runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: true } });
      assert.equal(result.type, 'phase_execute_request', JSON.stringify(result));
      const family = readOriginalDeliveryBudget(host.root, original)!;
      const children = family.runs.filter(run => !manifests.isInitialDesignManifest(run.manifest));
      if (scenario === 'definition-gap') {
        assert.equal(children.length, 1);
        const child = children[0].manifest;
        assert(!manifests.isInitialDesignManifest(child));
        assert.deepEqual(child.delivery_origin, { feature: blueprint, run_id: original.run_id });
        assert.deepEqual(child.execution_scope, scope, 'shared preparation must freeze the same unresolved and needed_by obligations');
        assert.deepEqual(child.phase_chain, ['spec', 'plan']);
        const issued = readSessionExecution(path.resolve(host.root, child.report_dir), (result.request as { path: string }).path)!;
        assert.equal(issued.request.context.phase, 'spec');
        assert.equal(result.run_id, child.run_id);
        assert(!fs.readFileSync(path.join(rootRunDir, 'events.jsonl'), 'utf8').includes('initial-design-scope-'), 'the scope owner must not be called again');
      } else {
        assert.equal(children.length, 0, 'an empty chain must not birth a child');
        const issued = readSessionExecution(rootRunDir, (result.request as { path: string }).path)!;
        assert(issued.request.context.phase.startsWith('initial-design-scope-'));
        assert(issued.request.context.instruction?.includes('当前实现义务尚不可执行'));
      }
      assert.equal(family.totalTurns, 1, 'only the signed request consumes the original budget');
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
      assert.equal(origin.readOriginalDeliveryBudget(project.root, old.manifest)!.budget.max_total_turns, 30);
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
      assert.equal(origin.readOriginalDeliveryBudget(project.root, successor.manifest)!.totalTurns, 3);
      assert(origin.readOriginalDeliveryBudget(project.root, successor.manifest)!.priorActiveMs >= 1500);
      assert.deepEqual(fs.readFileSync(old.eventsPath), stoppedBytes, 'successor cannot rewrite its source history');
      assert(stoppedBytes.subarray(0, originalBytes.length).equals(originalBytes));
      const step = { ...options, runId: successor.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const next = await entry.runGoalModeSessionStep(step);
      assert.equal(next.type, 'phase_execute_request');
      const request = handoff.readSessionExecution(successor.runDir, (next.request as { path: string }).path)!;
      const instruction = request.request.context.instruction!;
      assert(instruction.includes('事故原调用最终正文3'), 'session successor must read the old process output');
      assert(instruction.includes(old.note) && instruction.includes('必须实际编写或补齐'));
      assert(!instruction.includes('TOOL-DATA') && instruction.length < 20000, 'tool stdout must not inflate continuation');
      assert.equal(origin.readOriginalDeliveryBudget(project.root, successor.manifest)!.totalTurns, 4);
      assert.deepEqual((await entry.runGoalModeSessionStep(step)).request, next.request);
      assert.equal(origin.readOriginalDeliveryBudget(project.root, successor.manifest)!.totalTurns, 4);
      assert.throws(() => entry.prepareGoalModeRun({ ...options, supersede: [successor.manifest.run_id], runId: 'blocked-by-pending' }), /尚未报告/);
      const rejoined = entry.prepareGoalModeRun({ ...options, runId: 'must-not-fork' });
      assert.equal(rejoined.manifest.run_id, successor.manifest.run_id, 'stale target must rejoin the current audited successor');
      assert(!fs.existsSync(path.join(path.dirname(successor.runDir), 'must-not-fork')));
    });
  },
}, {
  name: 'd18f6c42 notes-only initial design pauses and explicit continuation retains the original total budget',
  async run() {
    await withProject(async project => {
      const entry = require(path.join(project.harnessDir, 'scripts/goal-mode-entry')) as typeof import('../../scripts/goal-mode-entry');
      const handoff = require(path.join(project.harnessDir, 'scripts/utils/session-execution-handoff')) as typeof import('../../scripts/utils/session-execution-handoff');
      const origin = require(path.join(project.harnessDir, 'scripts/utils/delivery-origin')) as typeof import('../../scripts/utils/delivery-origin');
      const old = seedLegacyContentLimitHistory(project, 7);
      const input = { projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature, adapter: 'codex', requirement: project.requirement };
      const successor = entry.prepareGoalModeRun({ ...input, runId: 'quota-successor', supersede: [old.manifest.run_id] });
      const step = { ...input, runId: successor.manifest.run_id, runMode: 'attended', authorization: { mode: 'goal_mode' as const, autonomyAuthorized: false } };
      let next = await entry.runGoalModeSessionStep(step);
      assert.equal(next.type, 'phase_execute_request', 'original author duty must not require additional autonomy in a successor');
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) next = await entry.runGoalModeSessionStep({ ...step, forceTakeover: true });
        assert.equal(next.type, 'phase_execute_request');
        assert.deepEqual((await entry.runGoalModeSessionStep(step)).request, next.request);
        const requestPath = (next.request as { path: string }).path;
        const request = handoff.readSessionExecution(successor.runDir, requestPath)!;
        fs.appendFileSync(old.note, `只增笔记${attempt}\n`);
        next = await entry.runGoalModeSessionStep({ ...step, requestPath, report: { status: 'passed', phase: request.request.context.phase, details: `本轮仍未交付蓝图${attempt}` } });
        const pausedEnd = handoff.sessionEvents(successor.runDir).filter(event => event.type === 'run_end' && event.halt_reason === 'no_progress_guard').at(-1)!;
        const [guidance, ...issues] = String('error' in pausedEnd ? pausedEnd.error : '').split('\n');
        assert(guidance.includes('--force-resume') && guidance.includes('--force-takeover') && guidance.includes('原预算与历史保留'));
        assert.deepEqual(issues, ['尚无蓝图，按原始需求与真实工程事实完成当前交付切片。'], 'continuation operations stay on the first line and never become author issues');
        const starts = handoff.sessionEvents(successor.runDir).filter(event => event.type === 'agent_invoke_start').length;
        assert.equal((await entry.runGoalModeSessionStep(step)).type, 'goal_session_result', 'ordinary public next cannot wake unchanged no-progress work');
        assert.equal(handoff.sessionEvents(successor.runDir).filter(event => event.type === 'agent_invoke_start').length, starts);
        const supervisor = require(path.join(project.harnessDir, 'scripts/utils/goal-supervisor')) as typeof import('../../scripts/utils/goal-supervisor');
        assert.equal(supervisor.decideSupervision({ events: handoff.sessionEvents(successor.runDir), restartsSoFar: 0, beaconStale: true }).action, 'no_op', 'elapsed time cannot restart the paused responsibility');
      }
      assert.equal(next.type, 'goal_session_result');
      assert(handoff.sessionEvents(successor.runDir).some(event => event.halt_reason === 'no_progress_guard'));
      assert.equal(origin.readOriginalDeliveryBudget(project.root, successor.manifest)!.totalTurns, 6);
      const last = entry.prepareGoalModeRun({ ...input, runId: 'last-budget-successor', supersede: [successor.manifest.run_id] });
      const lastStep = { ...step, runId: last.manifest.run_id };
      const lastNext = await entry.runGoalModeSessionStep(lastStep);
      assert.equal(lastNext.type, 'phase_execute_request');
      const requestPath = (lastNext.request as { path: string }).path;
      const request = handoff.readSessionExecution(last.runDir, requestPath)!;
      const exhausted = await entry.runGoalModeSessionStep({ ...lastStep, requestPath, report: { status: 'passed', phase: request.request.context.phase, details: 'Still no blueprint.' } });
      assert.equal(exhausted.type, 'goal_session_result');
      assert(handoff.sessionEvents(last.runDir).some(event => event.halt_reason === 'budget_turns'));
      assert.equal(origin.readOriginalDeliveryBudget(project.root, last.manifest)!.totalTurns, 7);
      const empty = entry.prepareGoalModeRun({ ...input, runId: 'no-budget-successor', supersede: [last.manifest.run_id] });
      assert.equal((await entry.runGoalModeSessionStep({ ...step, runId: empty.manifest.run_id })).type, 'goal_session_result');
      assert.equal(handoff.sessionEvents(empty.runDir).filter(event => event.type === 'agent_invoke_start').length, 0);
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
        assert.equal(origin.readOriginalDeliveryBudget(project.root, manifest)!.totalTurns, 3);
        assert.equal(origin.readOriginalDeliveryBudget(project.root, manifest)!.budget.max_total_turns, 30);
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
        assert.equal(await driver.run(), 1);
        assert.equal(calls, 1);
        const current = origin.currentOriginalDelivery(project.root, old.manifest as never);
        assert.notEqual(current.run_id, old.manifest.run_id);
        assert.equal(current.successor_of, old.manifest.run_id);
        assert.equal(origin.readOriginalDeliveryBudget(project.root, current)!.totalTurns, 4);
        assert.equal(origin.readOriginalDeliveryBudget(project.root, current)!.budget.max_total_turns, 30);
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
        assert.equal(await driver.run(), 1);
        assert.equal(calls, 1);
        const next = origin.currentOriginalDelivery(project.root, old.manifest);
        assert.equal(next.successor_of, current.manifest.run_id);
        assert(next.requirement!.includes(increment));
        assert.equal(origin.readOriginalDeliveryBudget(project.root, next)!.totalTurns, 4);
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
      assert(recheck.includes('这是修订后的独立复核') && recheck.includes('不重做完整八问'));
      assert(recheck.includes('第1–4行') && !recheck.includes('本次控制入口已核实可信原请求'));
      assert(recheck.includes('前次真实否定仍待复核') && recheck.includes('view:runtime') && recheck.includes('旧交接问题是否已修复？'));
      assert(recheck.includes(path.join(priorDir, 'draft-output.yaml')) && recheck.includes('不是当前结论'));
      for (const scope of requiredQuestioningScopes(blueprint).keys()) assert(recheck.includes(`- ${scope}（`));
      fs.unlinkSync(path.join(priorDir, 'draft-output.yaml'));
      const unfinished = delivery.initialDesignAuthorInstruction({ projectRoot: directory, frameworkRoot, manifest, autonomyAuthorized: false,
        observation: { kind: 'questioning', blueprintPath, candidatesPath, issues: [] }, deliveryRuns: [{ manifest: previous, events }] });
      assert(unfinished.includes('这是首次独立阅读'), 'an exited call without a questioning artifact cannot skip the first reading');
      assert(!unfinished.includes('前次真实否定仍待复核'));
      for (const authorized of [false, true]) {
        const live = manifests.buildInitialDesignGoalManifest({ ...manifest, feature: `authority-${authorized}`, run_id: `runtime-${authorized}`, report_dir: undefined }, { projectRoot: directory });
        const born = createGoalRun({ projectRoot: directory, manifest: live, chain: [] });
        const result = await entry.runGoalModeSessionStep({ projectRoot: directory, frameworkRoot, feature: live.feature, runId: live.run_id,
          adapter: 'codex', runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: authorized } });
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
  name: 'd18f6c42 M1 injected executor notes-only work pauses without a third call and ordinary public next preserves budget',
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
      let calls = 0;
      const driver = new runtime.GoalPhaseRuntime({ args: ['--project-root', project.root, '--framework-root', project.frameworkRoot,
        '--feature', project.feature, '--resume', prepared.manifest.run_id], executor: { async execute(context) {
        calls++;
        assert.equal(context.phase, 'initial-design-author');
        fs.mkdirSync(path.dirname(note), { recursive: true }); fs.appendFileSync(note, `只写调查笔记${calls}\n`);
        return { status: calls >= 3 ? 'waiting' : 'passed', phase: context.phase, details: '未修改真实设计；第三次仅作测试安全止损。',
          exitCode: 0, stdout: '', stderr: '', command: 'bounded-notes-executor', completion_observed: true };
      } } });
      assert.equal(await driver.run(), 1);
      const rows = handoff.sessionEvents(prepared.runDir);
      console.log('[M1-process-notes]', JSON.stringify({ calls, halt_reason: rows.at(-1)?.halt_reason,
        runtime_sha256: createHash('sha256').update(fs.readFileSync(path.join(project.harnessDir, 'scripts/goal-phase-runtime.ts'))).digest('hex') }));
      assert(rows.some(event => event.type === 'run_end' && event.halt_reason === 'no_progress_guard'));
      assert(calls > 0 && calls < 3, 'unchanged real work cannot dispatch a third executor call');
      assert(!rows.some(event => event.type === 'phase_start' && event.handoff_request), 'this regression must use transport-independent request material');
      const spent = origin.readOriginalDeliveryBudget(project.root, prepared.manifest)!;
      assert.equal(spent.totalTurns, calls); assert.equal(spent.budget.max_total_turns, ORIGINAL_BUDGET.max_total_turns);
      const starts = rows.filter(event => event.type === 'agent_invoke_start').length;
      const next = await entry.runGoalModeSessionStep({ projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: project.feature,
        runId: prepared.manifest.run_id, adapter: 'codex', runMode: 'attended' });
      assert.equal(next.type, 'goal_session_result');
      assert.equal(handoff.sessionEvents(prepared.runDir).filter(event => event.type === 'agent_invoke_start').length, starts);
      assert.equal(origin.readOriginalDeliveryBudget(project.root, prepared.manifest)!.totalTurns, calls);
      assert.deepEqual(fs.readFileSync(prepared.manifestPath), manifestBefore);
    });
  },
}, {
  name: 'd18f6c42 M1 blank-line questioning answers pause unchanged work and later paragraph changes resume exactly once',
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
      let next = await entry.runGoalModeSessionStep(step);
      let calls = 0;
      for (const currentAnswer of [answer, answer + '\n\n新增后段：补偿责任仍未声明。', firstParagraph]) {
        if (calls > 0) {
          const doc = YAML.parse(fs.readFileSync(blueprint, 'utf8'));
          doc.review_summary.questioning.items[0].answer = currentAnswer;
          fs.writeFileSync(blueprint, YAML.stringify(doc));
          next = await entry.runGoalModeSessionStep(step);
        }
        assert.equal(next.type, 'phase_execute_request', 'a real change after the same first paragraph must remain actionable');
        const requestPath = (next.request as { path: string }).path;
        const issued = handoff.readSessionExecution(prepared.runDir, requestPath)!;
        assert.equal(issued.request.context.phase, 'initial-design-author');
        assert(issued.request.context.instruction!.includes(currentAnswer), 'the complete independent answer must reach its real author');
        calls++;
        fs.appendFileSync(path.join(path.dirname(blueprint), 'author-findings.md'), `只写笔记${calls}\n`);
        const paused = await entry.runGoalModeSessionStep({ ...step, requestPath,
          report: { status: 'passed', phase: issued.request.context.phase, details: '作者没有改动真实蓝图。' } });
        console.log('[M1-multiline-questioning]', JSON.stringify({ calls, type: paused.type, halt_reason: (paused.result as { halt_reason?: string } | undefined)?.halt_reason }));
        assert.equal(paused.type, 'goal_session_result', 'unchanged multiline/blank-line feedback must pause instead of being regrouped as new issues');
        assert(handoff.sessionEvents(prepared.runDir).some(event => event.type === 'run_end' && event.halt_reason === 'no_progress_guard'));
        const starts = handoff.sessionEvents(prepared.runDir).filter(event => event.type === 'agent_invoke_start').length;
        assert.equal(starts, calls, 'each real feedback change permits one author call');
        assert.equal((await entry.runGoalModeSessionStep(step)).type, 'goal_session_result');
        assert.equal(handoff.sessionEvents(prepared.runDir).filter(event => event.type === 'agent_invoke_start').length, starts);
        const budget = origin.readOriginalDeliveryBudget(project.root, prepared.manifest)!;
        assert.equal(budget.totalTurns, calls); assert.equal(budget.budget.max_total_turns, ORIGINAL_BUDGET.max_total_turns);
        assert.deepEqual(fs.readFileSync(prepared.manifestPath), manifestBefore);
      }
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
