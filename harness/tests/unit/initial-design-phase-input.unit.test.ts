import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { loadGoalManifestDefinition, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { prepareInitialDesignRun, projectInitialDesignDelivery } from '../../scripts/utils/initial-design-delivery';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { resolveWallClockMinutes } from '../../scripts/utils/goal-timeout';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { withRuntimeTest } from '../utils/runtime-test-control';

const FRAMEWORK=path.resolve(__dirname,'../../..');
const DOMAIN=['spec','plan','coding','review','ut','testing'];
const requirement='完整交付新增收件箱批量已读能力，按原始需求完成设计、开发与验收。';
const unattended={write_mode:'full-access' as const,approval_mode:'never' as const,timeout_seconds:900};
const budget={max_total_turns:30,wall_clock_minutes:1};
const authorization={mode:'goal_mode' as const,autonomyAuthorized:true};
const json=(file:string):any=>JSON.parse(fs.readFileSync(file,'utf8'));
async function withEmpty(run:(root:string)=>void|Promise<void>):Promise<void>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'initial-phase-input-')));
  const priorTrust=process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR=path.join(root,'.trust');
  try{
    fs.mkdirSync(path.join(root,'doc/features'),{recursive:true});
    fs.writeFileSync(path.join(root,'framework.config.json'),JSON.stringify({schema_version:'1.0',project_name:'PhaseInputs',project_profile:{name:'hmos-app'},active_workflow:'obligation-driven',features_dir:'doc/features'})+'\n');
    fs.writeFileSync(path.join(root,'doc/requirement.md'),requirement+'\n');
    writeLocalConfig(root,{schema_version:'1.0',agent_adapter:'codex'});clearFrameworkConfigCache();
    await run(root);
  }finally{
    clearFrameworkConfigCache();
    if(priorTrust===undefined)delete process.env.MAISON_GOAL_CHECKPOINT_DIR;else process.env.MAISON_GOAL_CHECKPOINT_DIR=priorTrust;
    assert(root.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
function definition(root:string,feature:string,extra:Record<string,unknown>={}){
  const input={feature,adapter:'codex',requirement,requirement_source_files:['doc/requirement.md'],budget,unattended,...extra};
  const file=path.join(root,`${feature}.yaml`);fs.writeFileSync(file,YAML.stringify(input));return file;
}
function prepare(root:string,feature:string,extra:Partial<Parameters<typeof prepareInitialDesignRun>[0]>={}){
  return prepareInitialDesignRun({projectRoot:root,frameworkRoot:FRAMEWORK,feature,adapter:'codex',requirement,budget,unattended,...extra});
}
const cases:Array<{name:string;run():Promise<void>}>= [{
  name:'raw manifest declarations preserve absent E and explicit top-level or nested actions without normal defaults',
  async run(){await withEmpty(root=>{
    for(const extra of [{},{requested_phases:[]},{requested_phases:['testing']},{initial_design:{requested_phases:['testing']}}]){
      const file=definition(root,'raw-input',extra);const before=fs.readFileSync(file);const loaded=loadGoalManifestDefinition(file,root);
      const expected='requested_phases' in extra?extra.requested_phases:'initial_design' in extra?['testing']:undefined;
      assert.deepEqual(loaded.requestedPhases,expected);assert.deepEqual(fs.readFileSync(file),before);
    }
    assert.throws(()=>loadGoalManifestDefinition(definition(root,'conflict',{requested_phases:['ut'],initial_design:{requested_phases:['testing']}}),root),/conflicting requested_phases/);
    assert.deepEqual(fs.readdirSync(path.join(root,'doc/features')),[]);
  });},
},{
  name:'both public manifest entries leave unspecified E empty while retaining the same domain and original input bytes',
  async run(){await withEmpty(async root=>{
    const sessionInput=definition(root,'session-entry'),inputBefore=fs.readFileSync(sessionInput);
    const cli=withRuntimeTest({ root: root }, () => spawnSync(process.execPath,['-r','ts-node/register/transpile-only','scripts/goal-mode-entry.ts','--project-root',root,'--framework-root',FRAMEWORK,'--prepare-run','--run-mode','attended','--manifest',sessionInput],{cwd:path.join(FRAMEWORK,'harness'),encoding:'utf8',timeout:30_000,windowsHide:true}));
    assert.equal(cli.status,0,`${cli.stdout}\n${cli.stderr}`);const prepared=JSON.parse(cli.stdout.trim());assert.equal(prepared.type,'goal_run_prepared');
    const session=json(prepared.manifest);assert(isInitialDesignManifest(session));assert.deepEqual(session.initial_design.requested_phases,[]);
    assert.equal(session.start_phase,'spec');assert.equal(session.end_phase,'testing');assert.deepEqual(fs.readFileSync(sessionInput),inputBefore);
    const backendInput=definition(root,'backend-entry'),backendBefore=fs.readFileSync(backendInput);let calls=0;
    const exit=await withRuntimeTest({ root: root }, () => new GoalPhaseRuntime({args:['--manifest',backendInput,'--project-root',root,'--framework-root',FRAMEWORK,'--foreground-ok','--authorize-autonomy'],authorization,
      executor:{async execute(context){calls++;assert.equal(context.phase,'initial-design-author');assert(context.instruction?.includes(requirement));return {status:'waiting',phase:context.phase,details:'受控运输仅证明原始输入出生，不产生设计或通过结果。',exitCode:0,stdout:'',stderr:'',command:'bounded-phase-input-observer'};}}}).run());
    assert.equal(calls,1);assert.notEqual(exit,0);
    const runs=featureFilePath(root,'backend-entry','goal-runs');const ids=fs.readdirSync(runs).filter(id=>!id.startsWith('.'));assert.equal(ids.length,1);
    const backend=json(path.join(runs,ids[0],'manifest.json'));assert(isInitialDesignManifest(backend));
    assert.deepEqual(backend.initial_design.requested_phases,[]);assert.equal(backend.start_phase,'spec');assert.equal(backend.end_phase,'testing');
    assert.deepEqual(fs.readFileSync(backendInput),backendBefore);
    for(const manifest of [session,backend])for(const field of ['execution_scope','phase_chain','chain_override','run_base_sha'] as const)assert.equal(manifest[field],undefined,field);
  });},
},{
  name:'new roots preserve explicit requested actions and original domain boundaries without a construction scope',
  async run(){await withEmpty(root=>{
    const defaultRoot=prepare(root,'default-policy').manifest;assert.deepEqual(defaultRoot.initial_design.requested_phases,[]);
    const explicitRoot=prepare(root,'explicit-policy',{requestedPhases:['testing']}).manifest;assert.deepEqual(explicitRoot.initial_design.requested_phases,['testing']);
    const narrowed=prepare(root,'narrow-policy',{startPhase:'plan',endPhase:'ut'}).manifest;assert.equal(narrowed.start_phase,'plan');assert.equal(narrowed.end_phase,'ut');assert.deepEqual(narrowed.initial_design.requested_phases,[]);
    assert.throws(()=>prepare(root,'outside-policy',{startPhase:'plan',endPhase:'ut',requestedPhases:['testing']}),/outside request domain/);
    for(const manifest of [defaultRoot,explicitRoot,narrowed])assert.equal(manifest.phase_chain,undefined);
  });},
},{
  name:'public root budget floor uses domain D equally with absent or explicit narrow E',
  async run(){await withEmpty(root=>{
    const roots=[prepare(root,'budget-default').manifest,prepare(root,'budget-explicit',{requestedPhases:['testing']}).manifest];
    const expected=resolveWallClockMinutes(roots[0],DOMAIN);assert(expected>resolveWallClockMinutes(roots[0],['testing']));
    for(const manifest of roots){
      const projection=projectInitialDesignDelivery({projectRoot:root,frameworkRoot:FRAMEWORK,manifest});
      assert.equal(projection.budget.wall_clock_minutes,expected);assert.equal(projection.budget.total_turns,0);assert(projection.budget.active_ms>=0);
      assert.equal(manifest.budget.wall_clock_minutes,1,'the original budget declaration is not rewritten to a derived floor');
    }
  });},
}];

export function getCases(){return cases;}
export async function runSelectedCases(filter?:string){const results:UnitCaseResult[]=[],timings:UnitExecutionTiming[]=[];
  for(const test of cases){if(!matchesUnitCase(test.name,filter))continue;const finish=startCaseTiming([test.name],timings);try{await test.run();results.push({name:test.name,ok:true});}catch(error){results.push({name:test.name,ok:false,error:(error as Error).stack??String(error)});}finally{finish();}}
  return selectedUnitCases(results,filter,timings);
}
export async function runAll(){return(await runSelectedCases()).results;}
