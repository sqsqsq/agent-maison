import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { provisionFrameworkUnder, git } from '../utils/real-chain-host';
import { clearFrameworkConfigCache, loadFrameworkConfig, featureFilePath } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { loadGoalRunManifestFromRun, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { readOriginalDeliveryBudget } from '../../scripts/utils/delivery-origin';
import { enumerateCanonicalChangeUnits, deriveChangeUnitFeatureId, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { prepareFeatureScopeCandidate, resolveFeatureExecutionScope } from '../../scripts/utils/feature-track';
import { executionScopeFingerprint } from '../../scripts/utils/execution-scope';
import { assertGoalRunAttachable } from '../../scripts/utils/goal-run-creation';
import { goalRequiredPrerequisites } from '../../scripts/utils/goal-preflight';
import { evaluatePersonalSetupGate } from '../../scripts/utils/personal-setup-gate';
import type { FeaturePhase } from '../../scripts/utils/phase-transition-policy';
import { buildChangeUnitGoalRequest } from '../../scripts/utils/change-unit-progress-loop';
import type { SessionExecutionRequest } from '../../scripts/utils/session-execution-handoff';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const FIXTURE=path.resolve(__dirname,'../fixtures/host-recovery-history/20261028-initial-design-scope');
const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json=(file:string):any=>JSON.parse(fs.readFileSync(file,'utf8'));
const cases:Array<{name:string;run():Promise<void>}>= [{
  name:'published rev2 stale unfrozen candidate returns to its original scope author for complete regeneration and strict child birth',
  async run(){
    const source=json(path.join(FIXTURE,'source-index.json')).lanes.find((row:any)=>row.lane==='detached');assert(source);
    for(const file of source.files)assert.equal(sha(path.join(FIXTURE,'detached',file.path)),file.sha256,file.path);
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'initial-scope-replay-'))),priorTrust=process.env.MAISON_GOAL_CHECKPOINT_DIR;
    process.env.MAISON_GOAL_CHECKPOINT_DIR=path.join(root,'.trust');
    try{
      const fixture=path.join(FIXTURE,'detached');fs.cpSync(fixture,root,{recursive:true,filter:file=>path.relative(fixture,file).split(path.sep)[0]!=='baseline-git'});
      git(root,['init','-q','-b','main']);
      for(const object of source.git_baseline.objects){const from=path.join(fixture,'baseline-git',object.path);assert.equal(sha(from),object.sha256);const to=path.join(root,'.git',object.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
      git(root,['update-ref','refs/heads/main',source.git_baseline.head]);git(root,['reset','--mixed','--quiet',source.git_baseline.head]);
      const framework=provisionFrameworkUnder(root);writeLocalConfig(root,{schema_version:'1.0',agent_adapter:'codex'});clearFrameworkConfigCache();
      const original=loadGoalRunManifestFromRun(root,source.run_id,{feature:source.feature});assert(isInitialDesignManifest(original));assert(typeof original.requirement==='string');
      const runDir=path.resolve(root,original.report_dir),readEvents=():Array<Record<string,any>>=>fs.readFileSync(path.join(runDir,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
      const beforeEvents=readEvents(),published=[...beforeEvents].reverse().find(event=>event.type==='design_authority_repair'&&event.stage==='published');assert(published);assert.equal(published.new_revision,2);
      assert(beforeEvents.filter(event=>event.type==='agent_invoke_start'&&event.phase.startsWith('initial-design-scope-')&&event.ts<published.ts).length>=4);
      const originalError=beforeEvents.at(-1)?.error;assert.equal(typeof originalError,'string');const diagnostic=originalError.slice(0,originalError.indexOf(source.original_root));assert(diagnostic.length>30);
      const unit=enumerateCanonicalChangeUnits(root,original.feature)[0];assert(unit);const feature=deriveChangeUnitFeatureId(original.feature,String(unit.changeUnit.change_unit_id));
      assert.equal(readFeatureFrozenScope(root,feature),null);assert(!fs.existsSync(featureFilePath(root,feature,'goal-runs')));
      const blueprint=path.join(root,'doc/features/inbox-batch-read/blueprint/component-blueprint.yaml'),protectedBefore=[sha(blueprint),sha(unit.canonicalPath)];
      const before=readOriginalDeliveryBudget(root,original)!;
      const options={projectRoot:root,frameworkRoot:framework.frameworkRoot,feature:original.feature,runId:original.run_id,adapter:'codex',runMode:'attended' as const,authorization:{mode:'goal_mode' as const,autonomyAuthorized:true}};
      const first=await runGoalModeSessionStep(options);assert.equal(first.type,'phase_execute_request');const reference=first.request as {path:string};assert(typeof reference.path==='string');
      const request=json(reference.path) as SessionExecutionRequest,instruction=request.context.instruction;assert(typeof instruction==='string');assert(request.context.phase.startsWith('initial-design-scope-'));
      for(const expected of [original.requirement,diagnostic,'--prepare-scope','--overwrite','component-blueprint.yaml'])assert(instruction.includes(expected),expected);
      assert.deepEqual((request.snapshot_options?.ownedPrefixes??[]).map(file=>path.resolve(root,file)),[featureFilePath(root,feature,'feature.yaml')]);
      const existingSource=fs.readFileSync(path.join(root,'02-Feature/Inbox/src/main/ets/InboxStore.ts'),'utf8');assert(existingSource.includes('markRead(')&&!existingSource.includes('markAllRead('));
      const handoff=buildChangeUnitGoalRequest(root,asChangeUnitArtifact(unit.changeUnit));
      const prepared=prepareFeatureScopeCandidate({projectRoot:root,frameworkRoot:framework.frameworkRoot,feature,completionTarget:'feature',requestedResults:[handoff.requirement],requestedPhases:original.initial_design.requested_phases,
        requirement:original.requirement,requirementSourceFiles:original.requirement_source_files,overwrite:true,impact:{userVisibleBehaviorChange:false,reason:'已消费本次scope任务、原需求及真实源码；本次仅内部API，无新增最终用户可操作入口。保留原请求阶段及完整验收义务。',basisPaths:['02-Feature/Inbox/index.ts','02-Feature/Inbox/src/main/ets/InboxStore.ts']}});
      assert.equal(prepared.scope.unresolved.length,0,'the real scope resolver must accept the entire regenerated input');
      const profile=loadResolvedProfile(root,loadFrameworkConfig(root),framework.frameworkRoot);
      const prerequisites=goalRequiredPrerequisites(prepared.scope.phase_chain as FeaturePhase[],profile);prerequisites.delete('agent_adapter');
      const gate=evaluatePersonalSetupGate(root,{requiredPrerequisites:prerequisites});assert(!gate.ok);assert.equal(gate.code,'deveco_toolchain_missing');
      let blocked=false;
      try{
        await runGoalModeSessionStep({...options,requestPath:reference.path,report:{status:'passed',phase:request.context.phase,details:'仅在实际scope请求后用正式prepare-scope生产函数整份重算候选；不改P1或写任何施工PASS。'}});
      }catch(error){
        assert(error instanceof Error);assert.equal(error.message,'[goal-runner] preflight BLOCKER: '+gate.message);
        assert(error.stack?.includes('at runGoalPreflight ('),'the original machine preflight must be the rejecting source');blocked=true;
      }
      assert(blocked,'the real HMOS prerequisite must still block construction');
      const after=readOriginalDeliveryBudget(root,original)!;const children=after.runs.filter(run=>!isInitialDesignManifest(run.manifest));assert.equal(children.length,1);
      const child=children[0].manifest;assert(!isInitialDesignManifest(child));assert(child.execution_scope&&child.phase_chain?.length);assert.deepEqual(child.delivery_origin,{feature:original.feature,run_id:original.run_id});assert.equal(child.requirement,original.requirement);
      assertGoalRunAttachable(root,child);
      const currentScope=resolveFeatureExecutionScope(root,feature,resolveWorkflowSpec(root,{frameworkRoot:framework.frameworkRoot}),framework.frameworkRoot,original.requirement,original.fidelity);assert(currentScope);
      assert.equal(executionScopeFingerprint(currentScope),executionScopeFingerprint(prepared.scope),'the stale-basis error is gone under the original strict reader');
      assert.equal(executionScopeFingerprint(child.execution_scope),executionScopeFingerprint(currentScope),'child birth freezes that same valid scope');
      const childEvents=fs.readFileSync(path.resolve(root,child.report_dir,'events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(childEvents.filter(event=>event.type==='run_created').length,1);
      assert(!childEvents.some(event=>['agent_invoke_start','harness_start','harness_end','phase_verdict'].includes(event.type)),'no construction author or machine PASS may bypass the missing toolchain');
      assert.deepEqual([sha(blueprint),sha(unit.canonicalPath)],protectedBefore);
      const newStarts=readEvents().slice(beforeEvents.length).filter(event=>event.type==='agent_invoke_start');assert.equal(newStarts.length,1);assert.equal(newStarts[0].phase,request.context.phase);
      assert.equal(after.totalTurns,before.totalTurns+1);assert(after.priorActiveMs>=before.priorActiveMs);assert.equal(child.budget.max_total_turns,30);assert.equal(child.budget.wall_clock_minutes,120);assert.equal(child.unattended.timeout_seconds,900);
      // This consumer stops at child birth; it claims no Node, device, phase, or P3 acceptance.
    }finally{
      for(const file of Object.keys(require.cache))if(file.startsWith(root+path.sep))delete require.cache[file];clearFrameworkConfigCache();
      if(priorTrust===undefined)delete process.env.MAISON_GOAL_CHECKPOINT_DIR;else process.env.MAISON_GOAL_CHECKPOINT_DIR=priorTrust;
      assert(root.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  },
}];
export function getCases(){return cases;}
export async function runSelectedCases(filter?:string){const results:UnitCaseResult[]=[],timings:UnitExecutionTiming[]=[];for(const test of cases){if(!matchesUnitCase(test.name,filter))continue;const finish=startCaseTiming([test.name],timings);try{await test.run();results.push({name:test.name,ok:true});}catch(error){results.push({name:test.name,ok:false,error:(error as Error).stack??String(error)});}finally{finish();}}return selectedUnitCases(results,filter,timings);}
export async function runAll(){return(await runSelectedCases()).results;}
