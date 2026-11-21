import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { spawnSync, execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { loadGoalManifestDefinition, isInitialDesignManifest, buildInitialDesignGoalManifest } from '../../scripts/utils/goal-manifest';
import { prepareInitialDesignRun, projectInitialDesignDelivery, initialDesignRequestOptions, readInitialDesignRequest } from '../../scripts/utils/initial-design-delivery';
import { fixture as requestFixture } from './request-entry.unit.test';
import { readSessionExecution, type SessionExecutionRequest } from '../../scripts/utils/session-execution-handoff';
import { workUnitMayWritePath } from '../../scripts/utils/repair-responsibility';
import { enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { withFreshCuHost } from './lifecycle-evolution.unit.test';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { GoalPhaseRuntime, main as runGoalRunner } from '../../scripts/goal-phase-runtime';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { withRuntimeTest } from '../utils/runtime-test-control';
import { designDeliveryNextStep } from '../../scripts/utils/design-delivery-entry';
import { readRequestIntake } from '../../scripts/utils/request-intake';
import { acceptChangeUnitDecomposition } from '../../scripts/utils/change-unit-design-preparation';
import { runStatusWatchLoop } from '../../scripts/utils/goal-progress';

const FRAMEWORK=path.resolve(__dirname,'../../..');
const requirement='完整交付新增收件箱批量已读能力，按原始需求完成设计、开发与验收。';
const unattended={write_mode:'full-access' as const,approval_mode:'never' as const,timeout_seconds:900};
const budget={max_total_turns:30,wall_clock_minutes:1};
const authorization={mode:'goal_mode' as const,autonomyAuthorized:true};
const json=(file:string):any=>JSON.parse(fs.readFileSync(file,'utf8'));
const eventRows=(file:string):any[]=>fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(row=>JSON.parse(row));

/** Native-format fixture, not a new model/client execution. All product checks below use public CLIs. */
async function withCompactControl(run:(f:ReturnType<typeof compactControlFixture>)=>Promise<void>,excludeReviewTesting=false):Promise<void>{
  const f=compactControlFixture(excludeReviewTesting), priorHome=process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR=f.home;
  try{await run(f);}finally{if(priorHome===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=priorHome;
    const evidence=path.join(FRAMEWORK,'harness/reports/maison-b-scope/c1',path.basename(f.root));fs.mkdirSync(evidence,{recursive:true});
    fs.writeFileSync(path.join(evidence,'public-calls.json'),JSON.stringify({boundary:'isolated native-format fixture; real public CLI and Node checks; no model/SDK/device execution',baseline:f.base,calls:f.observations},null,2));
    const runDir=featureFilePath(f.root,f.feature,'goal-runs/'+f.runId);
    for(const name of ['events.jsonl','manifest.json','session-control.log'])if(fs.existsSync(path.join(runDir,name)))fs.copyFileSync(path.join(runDir,name),path.join(evidence,name));
    const requestReports=path.join(f.root,'doc/reports/request');if(fs.existsSync(requestReports))fs.cpSync(requestReports,path.join(evidence,'request-reports'),{recursive:true});
    clearFrameworkConfigCache();assert(fs.realpathSync(f.root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
function compactControlFixture(excludeReviewTesting=false){
  const f=requestFixture('ut'),root=f.root,frameworkRoot=f.framework,feature='compact-control',runId='medium-original';
  fs.rmSync(path.join(root,'doc/features/live'),{recursive:true,force:true});fs.rmSync(path.join(root,'.current-phase.json'),{force:true});
  fs.renameSync(path.join(frameworkRoot,'profiles/request-test'),path.join(frameworkRoot,'profiles/hmos-app'));
  const profileFile=path.join(frameworkRoot,'profiles/hmos-app/profile.yaml'),profile=YAML.parse(fs.readFileSync(profileFile,'utf8'));
  profile.name='hmos-app';profile.capabilities['coding.compile']={provider:'node-syntax',severity:'BLOCKER'};fs.writeFileSync(profileFile,YAML.stringify(profile));
  fs.writeFileSync(path.join(frameworkRoot,'profiles/hmos-app/harness/coding-host-rules.js'),`const fs=require('fs'),path=require('path'),cp=require('child_process');exports.profileCodingHost={sourceFileSuffixes:['js'],runStructureChecks(){return[]},runTraceabilityChecks(){return[]},checkCodingCompile(){return[]},compileProject(ctx){const r=cp.spawnSync(process.execPath,['--check',path.join(ctx.projectRoot,'src/value.js')],{encoding:'utf8'});fs.writeFileSync(path.join(ctx.reportDir,'node-check.log'),r.stdout+r.stderr);return{checks:[{id:'coding_compile',category:'structure',severity:'BLOCKER',status:r.status===0?'PASS':'FAIL',description:'actual Node syntax',details:r.stdout+r.stderr}],execution:{executed:true,exitCode:r.status,command:'node --check src/value.js'}}}};`);
  fs.writeFileSync(path.join(root,'framework.config.json'),JSON.stringify({schema_version:'1.1',project_name:'compact control',project_profile:{name:'hmos-app'},active_workflow:'obligation-driven',materialized_adapters:['codex'],paths:{features_dir:'doc/features'}}));
  fs.writeFileSync(path.join(root,'AGENTS.md'),'# Isolated request fixture\n');
  writeLocalConfig(root,{schema_version:'1.0',agent_adapter:'codex'});clearFrameworkConfigCache();
  const requirement='把 src/value.js 的 value 从41改为42；单元测试核对42，保留其它行为。',source='requirements/value.txt';
  fs.mkdirSync(path.join(root,'requirements'));fs.writeFileSync(path.join(root,source),requirement+'\n');fs.writeFileSync(path.join(root,'src/value.js'),'exports.value = 41;\n');
  const test=(ref:string)=>`const test=require('node:test'),assert=require('node:assert/strict');\n// expectation: ${ref}\ntest('value',()=>assert.equal(require('../src/value.js').value,42));\n`;
  fs.writeFileSync(path.join(root,'tests/value.test.cjs'),test(source));
  const input=path.join(root,'request-goal.yaml');fs.writeFileSync(input,YAML.stringify({feature,run_id:runId,adapter:'codex',requirement,requirement_source_files:[source],budget:{max_total_turns:20,wall_clock_minutes:5},unattended:{write_mode:'full-access',approval_mode:'never'},user_deadline_at:'2030-01-01T00:00:00.000Z'}));
  fs.writeFileSync(path.join(root,'.gitignore'),'framework/\n.native-fixture/\n.trust/\ndoc/reports/\n');
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
  git('init','-q');git('add','-A');git('-c','user.name=Fixture','-c','user.email=f@example.invalid','-c','commit.gpgsign=false','commit','-qm','baseline');
  const base=git('rev-parse','HEAD'),home=path.join(FRAMEWORK,'harness/reports/maison-b-scope/c1-native',path.basename(root)),session='11111111-3333-4444-8888-555555555555',nativeFile=path.join(home,'projects/fixture',session+'.jsonl');
  fs.mkdirSync(path.dirname(nativeFile),{recursive:true});let counter=0;
  const add=(row:object)=>fs.appendFileSync(nativeFile,JSON.stringify({sessionId:session,cwd:root,timestamp:new Date().toISOString(),...row})+'\n');
  const user=(id:string,text:string)=>{add({type:'user',uuid:id,message:{role:'user',content:text}});return nativeFile+'#'+id;};
  const originalRef=user('original-medium','按中型处理。'+requirement+' 原需求见 '+source+'。'+(excludeReviewTesting?'本次不跑review。本次不跑真机。UT仍须执行。':''));
  const tool=(name:string,input:object,output:string)=>{const id='tool-'+(++counter);add({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id,name,input}]}});add({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:id,content:output}]}});};
  tool('Bash',{command:'git rev-parse HEAD'},base);tool('Bash',{command:'git status --porcelain'},'');
  for(const file of ['src/value.js','tests/value.test.cjs',source])tool('Read',{file_path:path.join(root,file)},fs.readFileSync(path.join(root,file),'utf8'));
  add({type:'assistant',message:{role:'assistant',content:'本请求 original-medium 仅调整value。Q1=否；Q2=否；Q3=否；依赖结果=否；跨部件=否；预期明确=是；做法唯一=是。依据 src/value.js、requirements/value.txt。'}});
  const observations:Array<{script:string;args:string[];status:number|null;stdout:string;stderr:string}>=[];
  type InvocationOptions = { expectedInterruption?: string; timeoutMs?: number };
  const invoke=(script:string,args:string[],{expectedInterruption,timeoutMs=60_000}:InvocationOptions={})=>{
    const env:NodeJS.ProcessEnv={...process.env,CLAUDE_CONFIG_DIR:home,MAISON_GOAL_CHECKPOINT_DIR:path.join(root,'.trust'),TS_NODE_PROJECT:path.join(FRAMEWORK,'harness/tsconfig.json')};
    for(const key of Object.keys(env))if(/^MAISON_GOAL_(?!CHECKPOINT_DIR)/.test(key))delete env[key];
    const result=withRuntimeTest({root,...(expectedInterruption?{expectedInterruption}:{})},()=>spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),path.join(FRAMEWORK,'harness',script),'--project-root',root,...(script==='scripts/compile.ts'?[]:['--framework-root',frameworkRoot]),...args],{cwd:path.join(FRAMEWORK,'harness'),env,encoding:'utf8',timeout:timeoutMs,windowsHide:true}));
    observations.push({script,args,status:result.status,stdout:result.stdout||'',stderr:result.stderr||''});
    assert(!result.error,String(result.error));return result;
  };
  const next=(args:string[]=[],options?:InvocationOptions)=>invoke('scripts/goal-mode-entry.ts',['--feature',feature,'--run-id',runId,'--adapter','codex','--run-mode','attended','--authorize-autonomy',...args],options);
  const value=(result:ReturnType<typeof invoke>)=>{const line=result.stdout.trim().split(/\r?\n/).reverse().find(row=>row.startsWith('{'));assert(line,result.stderr+result.stdout);return JSON.parse(line);};
  return{root,frameworkRoot,feature,runId,requirement,source,input,base,home,nativeFile,originalRef,user,test,invoke,next,value,observations};
}
function writePartialControlBlueprint(file:string):void{
  const original=YAML.parse(fs.readFileSync(file,'utf8')),items=original.discovery.inputs.current_scope_items,provenance=items[0].provenance;
  const partial=Object.fromEntries(['artifact','component_id','blueprint_id','revision','provenance','source_fingerprint','decision_fingerprint','review_summary'].filter(key=>key in original).map(key=>[key,original[key]])) as any;
  partial.discovery={inputs:{current_scope_items:items},requirement_traceability:items.map((item:any)=>({item_id:item.item_id,blueprint_refs:['view:development/node:value']}))};
  partial.design_views=[{view_id:'development',nodes:[{node_id:'value',owner:'value-owner',current_state:'value=41',target_state:'value=42',provenance,verification_refs:['AC-1'],acceptance:{criteria:[{id:'AC-1',priority:'P1',description:'value returns42',testable:true,verification_steps:['read value'],expected_result:'42',ut_layer:'unit',ut_focus:'value result'}]},contracts:{files:['src/value.js']}}]}];
  fs.writeFileSync(file,YAML.stringify(partial));
}
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
  name:'a920 true i13 original shows passed call with three blockers and six open decisions through public status after same-run recovery',
  async run(){await withEmpty(root=>{
    // Historical read-only subset: no canonical product/design is manufactured or admitted.
    fs.symlinkSync(FRAMEWORK,path.join(root,'framework'),process.platform==='win32'?'junction':'dir');
    const fixture=path.join(FRAMEWORK,'harness/tests/fixtures/host-recovery-history/20261115-design-recovery/status-i13');
    const sources=json(path.join(fixture,'sources.json')),output=gunzipSync(fs.readFileSync(path.join(fixture,'questioning-output.json.gz')));
    assert.equal(createHash('sha256').update(output).digest('hex'),sources.files.find((entry:any)=>entry.source.endsWith('/questioning-output.json')).sha256);
    const manifest=prepare(root,'bc-openCard-2').manifest,runDir=path.resolve(root,manifest.report_dir),eventFile=path.join(runDir,'events.jsonl');
    const events=json(path.join(fixture,'events.json')) as Array<Record<string,unknown>>;
    const append=(rows:typeof events)=>fs.appendFileSync(eventFile,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    const read=()=>{
      const result=spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),path.join(FRAMEWORK,'harness/scripts/goal-status.ts'),
        '--project-root',root,'--feature',manifest.feature,'--run-id',manifest.run_id,'--json'],{cwd:path.join(FRAMEWORK,'harness'),encoding:'utf8',timeout:30000,windowsHide:true});
      assert.equal(result.status,0,result.stderr+result.stdout);return JSON.parse(result.stdout);
    };
    append(events.slice(0,2));assert.equal(read().status,'HALTED','保留真实i12停止记录');
    const phaseDir=path.join(runDir,'phases/initial-design-questioning/initial-design-questioning-i13');fs.mkdirSync(phaseDir,{recursive:true});
    fs.copyFileSync(path.join(fixture,'blueprint-scopes.json'),path.join(phaseDir,'blueprint-before.yaml'));
    fs.copyFileSync(path.join(fixture,'request-fields.json'),path.join(phaseDir,'request-e2.json'));
    fs.copyFileSync(path.join(fixture,'result-fields.json'),path.join(phaseDir,'design-result.json'));
    fs.writeFileSync(path.join(phaseDir,'questioning-output.json'),output);
    append(events.slice(2));const resumed=read();
    assert.equal(resumed.status,'RUNNING','真实后续run_start使旧HALT失效');assert.equal(resumed.halt_reason,undefined);
    assert.equal(resumed.current.phase,'initial-design-author');assert.equal(resumed.current.run_id,manifest.run_id);
    assert.equal(resumed.last_invocation.call_status,'passed');assert.equal(resumed.last_invocation.result_usable,true);
    assert.equal(resumed.last_invocation.questioning.blockers,3);assert.equal(resumed.last_invocation.questioning.open_decisions,6);
    assert.equal(resumed.last_invocation.questioning.source,path.relative(root,path.join(phaseDir,'questioning-output.json')).replace(/\\/g,'/'));
    assert.equal(resumed.next_action,'author');assert.equal(resumed.complete,false,'历史Q交回不是当前产品完成');
    assert.equal(fs.existsSync(path.join(root,'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml')),false);
  });},
},{
  name:'status watch observes halt and same-run resume in one refresh and shows the latest active responsibility',
  async run(){await withEmpty(async root=>{
    const manifest=prepare(root,'watch-original').manifest,file=path.resolve(root,manifest.report_dir,'events.jsonl');
    const append=(event:Record<string,unknown>)=>fs.appendFileSync(file,JSON.stringify({ts:new Date().toISOString(),...event})+'\n');
    append({type:'run_start'});append({type:'agent_invoke_start',invoke_id:'author-i1',phase:'initial-design-author'});
    const seen:Array<ReturnType<typeof projectInitialDesignDelivery>>=[];
    await runStatusWatchLoop({intervalMs:1,maxTicks:3,render:()=>{
      seen.push(projectInitialDesignDelivery({projectRoot:root,frameworkRoot:FRAMEWORK,manifest}));
      if(seen.length===1){append({type:'agent_invoke_end',invoke_id:'author-i1',phase:'initial-design-author',status:'waiting'});append({type:'run_end',status:'HALTED',halt_reason:'executor_waiting'});}
      if(seen.length===2){append({type:'run_start'});append({type:'agent_invoke_start',invoke_id:'author-i2',phase:'initial-design-author'});}
    }});
    assert.deepEqual(seen.map(row=>row.status),['RUNNING','HALTED','RUNNING']);
    assert(seen.every(row=>row.run_id===manifest.run_id));assert.equal(seen[2].current?.phase,'initial-design-author');
    assert.equal(seen[2].last_invocation?.call_status,'waiting');assert(!seen[2].complete);
  });},
},{
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
  name:'new roots preserve explicit requested work while historical phase bounds do not restrict the unit author',
  async run(){await withEmpty(root=>{
    const defaultRoot=prepare(root,'default-policy').manifest;assert.deepEqual(defaultRoot.initial_design.requested_phases,[]);
    const explicitRoot=prepare(root,'explicit-policy',{requestedPhases:['testing']}).manifest;assert.deepEqual(explicitRoot.initial_design.requested_phases,['testing']);
    const narrowed=prepare(root,'narrow-policy',{startPhase:'plan',endPhase:'ut'}).manifest;assert.equal(narrowed.start_phase,'plan');assert.equal(narrowed.end_phase,'ut');assert.deepEqual(narrowed.initial_design.requested_phases,[]);
    const requiredCheck=prepare(root,'outside-old-phase-window',{startPhase:'plan',endPhase:'ut',requestedPhases:['testing']}).manifest;
    assert.deepEqual(requiredCheck.initial_design.requested_phases,['testing']);
    assert.throws(()=>prepare(root,'unknown-capability',{requestedPhases:['unknown-check-family']}),/outside request domain/);
    for(const manifest of [defaultRoot,explicitRoot,narrowed])assert.equal(manifest.phase_chain,undefined);
  });},
},{
  name:'public root exposes real activity and an explicit unchanged deadline without synthesizing a quota or default deadline',
  async run(){await withEmpty(root=>{
    const deadline='2030-01-01T00:00:00.000Z';
    const roots=[prepare(root,'activity-default').manifest,prepare(root,'activity-explicit',{requestedPhases:['testing'],userDeadlineAt:deadline}).manifest];
    assert.equal(roots[0].user_deadline_at,undefined);assert.equal(roots[1].user_deadline_at,deadline);
    const again=prepare(root,'activity-explicit',{requestedPhases:['testing'],userDeadlineAt:'2031-01-01T00:00:00.000Z'}).manifest;
    assert.equal(again.run_id,roots[1].run_id);assert.equal(again.user_deadline_at,deadline,'rejoin never silently extends the original explicit deadline');
    for(const manifest of roots){
      const projection=projectInitialDesignDelivery({projectRoot:root,frameworkRoot:FRAMEWORK,manifest});
      assert.equal(projection.activity.calls,0);assert(projection.activity.active_ms>=0);assert(!('budget' in projection));
      assert(!projection.current_disposition.completionEligible && !projection.complete,'missing real design/CU/assembly evidence cannot look complete');
    }
  });},
}];

for(const mode of ['automatic','explicit','blank','legacy-rejoin','goal-runner','goal-runner-explicit','goal-runner-legacy'] as const)cases.push({
  name:`automatic origin public prepare-run ${mode} preserves the actual user and original intake boundary`,
  async run(){await withEmpty(async root=>{
    const prior=Object.fromEntries(['CODEX_HOME','CODEX_THREAD_ID','CODEX_SESSION_ID'].map(key=>[key,process.env[key]]));
    const calls:Array<{script:string;args:string[];status:number|null;stdout:string;stderr:string}>=[];
    try{
      const runner=mode.startsWith('goal-runner'),legacy=mode==='legacy-rejoin'||mode==='goal-runner-legacy',explicitMode=mode==='explicit'||mode==='goal-runner-explicit';
      const valid=path.join(FRAMEWORK,'harness/tests/fixtures/component-blueprint/valid'),feature='ledger-app-blueprint';
      fs.cpSync(valid,root,{recursive:true,filter:source=>{const relative=path.relative(valid,source).replace(/\\/g,'/'),prefix='doc/features/'+feature+'/';return !relative.startsWith(prefix)||relative.slice(prefix.length).split('/')[0]==='blueprint';}});
      const source='src/ledger/ScaleTarget.ets',text='本请求完成账目设计，原需求见 requirements/ledger.md。';
      fs.writeFileSync(path.join(root,source),'export const scaleTarget = 1;\n');
      fs.writeFileSync(path.join(root,'.gitignore'),'.native-codex/\n.trust/\n');
      const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
      git(['init','-q']);git(['add','-A']);git(['-c','user.name=AutoOriginTest','-c','user.email=auto@example.invalid','-c','commit.gpgsign=false','commit','-qm','isolated origin baseline']);
      const home=path.join(root,'.native-codex');fs.mkdirSync(path.join(home,'sessions'),{recursive:true});
      process.env.CODEX_HOME=home;delete process.env.CODEX_SESSION_ID;
      const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(home,'state_5.sqlite'));
      db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT)');
      const sources=new Map<string,string>();
      // Synthetic Codex-format/SQLite fixtures; no native client or model execution is claimed.
      for(const [session,user]of [['auto-original','original-user'],['auto-other','other-user']]){
        const file=path.join(home,'sessions','rollout-'+session+'.jsonl'),rows:object[]=[{type:'session_meta',payload:{id:session,session_id:session,cwd:root,thread_source:'user',originator:'isolated origin fixture'}},
          {type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',id:user,role:'user',content:[{type:'input_text',text}]}}];
        let n=0;const command=(cmd:string,output:string)=>{const call_id='origin-call-'+(++n);rows.push({type:'response_item',payload:{type:'function_call',name:'exec_command',call_id,arguments:JSON.stringify({cmd,workdir:root})}},
          {type:'response_item',payload:{type:'function_call_output',call_id,output:JSON.stringify({chunk_id:call_id,exit_code:0,output})}});};
        command('git rev-parse HEAD',git(['rev-parse','HEAD']));command('git status --porcelain',git(['status','--porcelain']));
        command('Get-Content -Raw '+source,fs.readFileSync(path.join(root,source),'utf8'));
        rows.push({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:`本请求 ${user}：Q1=是；Q2=否；Q3=否；依赖结果=否；跨部件=否；预期明确=是；做法唯一=否。依据 ${source}。`}]}});
        fs.writeFileSync(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');db.prepare('INSERT INTO threads VALUES(?,?,?)').run(session,file,root);sources.set(user,file+'#'+user);
      }
      db.close();fs.appendFileSync(path.join(root,source),'// controlled fixture change\n');
      if(legacy)delete process.env.CODEX_THREAD_ID;else process.env.CODEX_THREAD_ID=explicitMode?'auto-other':'auto-original';
      const explicit=explicitMode?sources.get('original-user'):mode==='blank'?'  ':undefined;
      const options={projectRoot:root,frameworkRoot:FRAMEWORK,feature,requirement:text,sessionRef:explicit};
      if(!legacy){
        const intake=readRequestIntake({...options,sessionRef:explicit?.trim()||undefined});assert.equal(intake.policy.selected,'medium');assert.deepEqual(intake.gaps,[]);
        const entry=designDeliveryNextStep(options);assert(entry?.type==='design_preparation_required');
        assert.equal(entry.materials.session_ref,sources.get('original-user'));
        if(mode==='automatic')assert.equal(designDeliveryNextStep({...options,sessionRef:'  '})?.materials.session_ref,sources.get('original-user'));
      }
      const invoke=(script:string,args:string[])=>{
        const result=withRuntimeTest({root},()=>spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),path.join(FRAMEWORK,'harness',script),'--project-root',root,
          ...(script==='scripts/goal-mode-entry.ts'?['--framework-root',FRAMEWORK]:[]),...args],{cwd:path.join(FRAMEWORK,'harness'),env:{...process.env,TS_NODE_PROJECT:path.join(FRAMEWORK,'harness/tsconfig.json')},encoding:'utf8',timeout:60_000,windowsHide:true}));
        calls.push({script,args,status:result.status,stdout:result.stdout,stderr:result.stderr});assert(!result.error,String(result.error));return result;
      };
      const prepareArgs=['--prepare-run','--run-mode','attended','--feature',feature,'--adapter','codex','--run-id','origin-'+mode,'--requirement',text,...(explicit?['--session-ref',explicit]:[])];
      const boundedRunner=async()=>{
        const args=['--project-root',root,'--framework-root',FRAMEWORK,'--foreground-ok','--authorize-autonomy',...prepareArgs.slice(3)];let authors=0;
        const writer=require('../../scripts/utils/initial-design-delivery') as typeof import('../../scripts/utils/initial-design-delivery'),originalWriter=writer.prepareInitialDesignRun;let births=0;
        writer.prepareInitialDesignRun=input=>{births++;assert.equal(input.sessionRef,sources.get('original-user'),'fresh runner dropped the producer canonical source');
          const result=originalWriter(input),options=initialDesignRequestOptions(root,FRAMEWORK,result.manifest);
          assert.equal(json(path.resolve(root,options.requestFile)).intake_context.user.id,'original-user','carrier was not written by the original birth writer');return result;};
        let code:number;try{code=await withRuntimeTest({root},()=>runGoalRunner({args,authorization,executor:{async execute(context){
          authors++;assert(context.phase.startsWith('initial-design-'));
          const manifest=json(featureFilePath(root,feature,'goal-runs/origin-'+mode+'/manifest.json')),carrier=initialDesignRequestOptions(root,FRAMEWORK,manifest),requestFile=path.resolve(root,carrier.requestFile);
          if(legacy)assert(!fs.existsSync(requestFile),'goal-runner rejoin manufactured intake');else assert.equal(json(requestFile).intake_context.user.id,'original-user','goal-runner dispatched before its canonical source carrier existed');
          return{status:'waiting',phase:context.phase,details:'受控executor仅核真实出生与来源载体，不执行模型或伪造设计通过。',exitCode:0,stdout:'',stderr:'',command:'bounded-origin-entry-observer'};
        }}}));}finally{writer.prepareInitialDesignRun=originalWriter;}
        assert.equal(births,legacy?0:1,'legacy rejoin called a fresh writer');
        assert.equal(authors,1,'bounded runner must stop at its first real executor request');assert.notEqual(code,0,'controlled waiting is not a completed delivery');
        calls.push({script:'goal-phase-runtime.main with controlled first executor',args,status:code,stdout:'bounded executor calls='+authors,stderr:''});
        return{manifest:featureFilePath(root,feature,'goal-runs/origin-'+mode+'/manifest.json')};
      };
      assert(!fs.existsSync(path.join(root,'doc/reports/request')),'intake was prepared before the public producer/writer call');
      let born:{manifest:string};
      if(runner&&!legacy)born=await boundedRunner();else{const prepared=invoke('scripts/goal-mode-entry.ts',prepareArgs);assert.equal(prepared.status,0,prepared.stderr+prepared.stdout);born=JSON.parse(prepared.stdout);}
      const manifest=json(born.manifest),carrier=initialDesignRequestOptions(root,FRAMEWORK,manifest),file=path.resolve(root,carrier.requestFile);
      if(legacy){
        assert(!fs.existsSync(file),'source-free legacy birth manufactured intake');const before=fs.readFileSync(born.manifest);
        process.env.CODEX_THREAD_ID='auto-original';assert.equal(readRequestIntake(options).policy.selected,'medium');
        if(runner)assert.equal(json((await boundedRunner()).manifest).run_id,manifest.run_id);
        else{const resumed=invoke('scripts/goal-mode-entry.ts',prepareArgs);assert.equal(resumed.status,0,resumed.stderr+resumed.stdout);assert.equal(json(JSON.parse(resumed.stdout).manifest).run_id,manifest.run_id);}
        assert(!fs.existsSync(file),'rejoin backfilled a new intake');assert.deepEqual(fs.readFileSync(born.manifest),before);
      }else{
        assert(fs.existsSync(file),'automatic source was lost between entry and the original Goal writer');
        const request=json(file);assert.equal(request.intake_context.user.id,'original-user');assert.equal(request.intake_context.session_ref,sources.get('original-user'));assert.equal(request.intake_context.policy.selected,'medium');assert.equal(request.intake_context.policy.source,'rule');
        assert.equal(request.origin_request,path.relative(root,born.manifest).replace(/\\/g,'/'));
      }
      const candidateFile=path.join(root,'doc/features',feature,'blueprint/change-unit-candidates.json');
      const candidates=['origin-a','origin-b'].map(id=>{const artifact=YAML.parse(fs.readFileSync(path.join(valid,'doc/features',feature,'ledger-refresh/change-unit.yaml'),'utf8'));artifact.change_unit_id=id;artifact.provenance.extraction_method='builtin-vertical-slice-decomposition + isolated-origin-test';return{providerId:'builtin-vertical-slice-decomposition',artifact};});
      fs.writeFileSync(candidateFile,JSON.stringify(candidates));const blueprint=featureFilePath(root,feature,'blueprint/component-blueprint.yaml'),beforeBlueprint=fs.readFileSync(blueprint);
      if(runner){
        if(!legacy){let feedback='';try{acceptChangeUnitDecomposition(root,feature,candidates);}catch(error){feedback=(error as Error).message;}
          assert(feedback.includes('原分解作者'),feedback);assert.equal(enumerateCanonicalChangeUnits(root,feature).length,0);assert.deepEqual(fs.readFileSync(blueprint),beforeBlueprint);}
        return;
      }
      const accepted=invoke('scripts/check-change-unit.ts',['--blueprint',feature,'--accept-candidates',path.relative(root,candidateFile),'--json']);
      if(legacy){assert.equal(accepted.status,0,accepted.stderr+accepted.stdout);assert.equal(enumerateCanonicalChangeUnits(root,feature).length,2);assert(!fs.existsSync(file));}
      else{assert.notEqual(accepted.status,0);assert((accepted.stderr+accepted.stdout).includes('原分解作者'),accepted.stderr+accepted.stdout);assert.equal(enumerateCanonicalChangeUnits(root,feature).length,0);assert.deepEqual(fs.readFileSync(blueprint),beforeBlueprint);assert(fs.existsSync(candidateFile));}
    }finally{
      for(const [key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;
      const evidence=path.join(FRAMEWORK,'harness/reports/medium-single-cu/auto-origin-public');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,mode+'-'+path.basename(root)+'.json'),JSON.stringify({boundary:'isolated native-format/SQLite fixture; public CLI only; no model/client/host acceptance',calls},null,2)+'\n');
    }
  });},
});

for(const frame of ['small','trivial'] as const)cases.push({
  name:`C1 public existing medium run accepts late ${frame} and keeps the original source baseline history and real UT obligation`,
  async run(){await withCompactControl(async f=>{
    const prepared=f.invoke('scripts/goal-mode-entry.ts',['--prepare-run','--run-mode','attended','--manifest',f.input,'--run-id',f.runId,'--session-ref',f.originalRef]);
    assert.equal(prepared.status,0,prepared.stderr+prepared.stdout);const born=f.value(prepared),manifest=json(born.manifest);
    assert(isInitialDesignManifest(manifest));assert.equal(manifest.run_id,f.runId);const originalBytes=fs.readFileSync(born.manifest);
    const first=f.next(['--next','--session-ref',f.originalRef]);assert.equal(first.status,0,first.stderr+first.stdout);const old=f.value(first);
    assert.equal(old.type,'phase_execute_request');const oldRequest=json(old.request.path) as SessionExecutionRequest;
    assert(readSessionExecution(born.run_dir,old.request.path),'public author request lacks the existing signed handoff');
    assert.equal(oldRequest.context.phase,'initial-design-author');assert(oldRequest.write_boundary);
    assert(!workUnitMayWritePath(oldRequest.write_boundary!,'src/value.js'),'full initial author acquired product write authority before a user adjustment');
    const options=initialDesignRequestOptions(f.root,f.frameworkRoot,manifest),originalRequest=json(path.resolve(f.root,options.requestFile));
    assert.equal(originalRequest.baseline.base,f.base);assert.equal(originalRequest.intake_context.user.id,'original-medium');
    if(frame==='trivial')assert.deepEqual(originalRequest.intake_context.control.excluded,['review','testing']);
    assert.equal(readInitialDesignRequest(f.root,f.frameworkRoot,manifest),undefined);
    const ordinary=f.value(f.next(['--next']));assert.equal(ordinary.request.path,old.request.path,'ordinary continuation silently selected a light frame');
    const fake=path.join(f.root,'pretend.jsonl');fs.copyFileSync(f.nativeFile,fake);
    const rejected=f.next(['--next','--session-ref',fake+'#original-medium'],{expectedInterruption:'原件不在已配置客户端的原生存储内'});assert.notEqual(rejected.status,0,'non-native file acquired user authority');assert(rejected.stderr.includes('原生存储'),rejected.stderr);fs.rmSync(fake);
    const blueprint=featureFilePath(f.root,f.feature,'blueprint/component-blueprint.yaml');
    if(frame==='small')writePartialControlBlueprint(blueprint);
    const late=f.user('late-fixed',frame==='small'?'本次按小型处理。':'本次按特别简单处理。');
    const handoff=f.next(['--request',old.request.path,'--report-result',JSON.stringify({phase:oldRequest.context.phase,status:'passed',details:'作者已交回本职已有材料；真实用户调整后继续同一请求。'}),'--session-ref',late]);
    assert.equal(handoff.status,0,handoff.stderr+handoff.stdout);let current=f.value(handoff);assert.equal(current.type,'phase_execute_request',handoff.stderr+handoff.stdout);
    let active=json(current.request.path) as SessionExecutionRequest;
    assert.equal(active.context.runId,f.runId);assert(active.context.instruction?.includes(frame==='small'?'小型':'特别简单'));
    assert(workUnitMayWritePath(active.write_boundary!,'src/value.js'),'adjusted original author cannot reach the original product target');
    assert(workUnitMayWritePath(active.write_boundary!,'tests/value.test.cjs'),'originally read test target is not writable');
    assert(!workUnitMayWritePath(active.write_boundary!,'framework/agents/README.md'));
    const subject=readInitialDesignRequest(f.root,f.frameworkRoot,manifest)!;assert.equal(subject.frame,frame);
    assert.equal(subject.prepared.intake?.baseline.base,f.base);assert.equal(subject.prepared.intake?.user.id,'original-medium');assert(!subject.prepared.originGap,subject.prepared.originGap);
    assert(!subject.prepared.intake?.control.excluded.includes('ut'));assert.deepEqual(subject.prepared.sourceRefs,[f.source]);
    if(frame==='trivial')assert.deepEqual(subject.prepared.intake?.control.excluded,['review','testing'],'completion exclusions did not retain the original user source');
    assert.equal(json(subject.prepared.requestFile).origin_request,path.relative(f.root,born.manifest).replace(/\\/g,'/'));
    const eventsFile=path.join(born.run_dir,'events.jsonl'),before=eventRows(eventsFile),calls=before.filter(row=>row.type==='agent_invoke_start').length;
    for(const extra of [[],['--session-ref',late]]){const again=f.value(f.next(['--next',...extra]));assert.equal(again.request.path,current.request.path);}
    assert.equal(eventRows(eventsFile).filter(row=>row.type==='agent_invoke_start').length,calls,'unchanged next/resume purchased another author');
    assert.equal(eventRows(eventsFile).filter(row=>row.user_control?.user?.id==='late-fixed').length,1,'same user source was applied twice');
    if(frame==='trivial'){
      const auxiliary='src/aux.js',auxFile=path.join(f.root,auxiliary),testFile='tests/value.test.cjs';
      assert(!fs.existsSync(auxFile));assert(!workUnitMayWritePath(active.write_boundary!,auxiliary),'known targets already allowed an unprepared auxiliary file');
      const args=['--phase','ut','--request-file',options.requestFile,'--target',auxiliary,'--test-target',testFile,'--allow-test-write',testFile];
      const preparation=f.invoke('harness-runner.ts',[...args,'--prepare-request']);assert.equal(preparation.status,0,preparation.stderr+preparation.stdout);
      const planned=JSON.parse(preparation.stdout);assert(planned.gaps.includes(auxiliary));assert(planned.targets.files.includes(auxiliary));
      assert(planned.bindings.some((binding:any)=>binding.path===auxiliary&&!binding.exists&&binding.sha256===null));
      assert(!('verdict' in planned));assert(!fs.existsSync(path.join(planned.reportDir,'summary.json')));assert(!fs.existsSync(path.join(planned.reportDir,'native-test.log')));
      const missing=f.invoke('harness-runner.ts',args);assert.notEqual(missing.status,0);assert((missing.stderr+missing.stdout).includes('target missing: '+auxiliary),missing.stderr+missing.stdout);
      assert(!fs.existsSync(path.join(planned.reportDir,'native-test.log')),'missing planned source reached the test provider');
      const plainFile=path.join(f.root,'doc/requests/task.json'),plainBytes=fs.readFileSync(plainFile);
      try{
        const plain=JSON.parse(plainBytes.toString('utf8'));plain.targets={files:[auxiliary],tests:[testFile]};plain.allowed_test_writes=[testFile];fs.writeFileSync(plainFile,JSON.stringify(plain));
        const ordinary=f.invoke('harness-runner.ts',['--phase','ut','--request-file','doc/requests/task.json','--report-dir','doc/reports/plain-aux','--prepare-request']);
        assert.notEqual(ordinary.status,0);assert((ordinary.stderr+ordinary.stdout).includes('target missing: '+auxiliary),ordinary.stderr+ordinary.stdout);
      }finally{fs.writeFileSync(plainFile,plainBytes);}
      assert(!fs.existsSync(auxFile),'a preparation wrote the planned product source');
      const previousRequest=current.request.path;
      const next=f.next(['--request',previousRequest,'--report-result',JSON.stringify({phase:active.context.phase,status:'passed',details:'已沿原request准备尚缺的src/aux.js，尚未写该路径或运行测试；请求下一同源作者窗口继续实际实现。'})]);
      assert.equal(next.status,0,next.stderr+next.stdout);current=f.value(next);assert.equal(current.type,'phase_execute_request',next.stderr+next.stdout);
      assert.notEqual(current.request.path,previousRequest);assert(readSessionExecution(born.run_dir,current.request.path));active=json(current.request.path) as SessionExecutionRequest;
      assert.equal(active.context.runId,f.runId);assert.equal(active.context.runtimeFacts.runBaseSha,f.base);
      assert(workUnitMayWritePath(active.write_boundary!,auxiliary),'prepared auxiliary target did not reach the next original owner window');
      assert(!workUnitMayWritePath(active.write_boundary!,'framework/agents/README.md'));
      assert(!workUnitMayWritePath(active.write_boundary!,'doc/features/other-goal/goal-runs/foreign/manifest.json'));
      fs.writeFileSync(auxFile,'exports.nextValue = () => 42;\n');fs.writeFileSync(path.join(f.root,'src/value.js'),"exports.value = require('./aux').nextValue();\n");
    }else fs.writeFileSync(path.join(f.root,'src/value.js'),'exports.value = 42;\n');
    fs.writeFileSync(path.join(f.root,'tests/value.test.cjs'),f.test(frame==='small'?path.relative(f.root,blueprint).replace(/\\/g,'/')+'#AC-1':f.source));
    if(frame==='small'){
      const check=f.invoke('scripts/check-component-blueprint.ts',['--blueprint',f.feature,'--request-file',options.requestFile,'--prepare-source','--json']);
      assert.equal(check.status,0,check.stderr+check.stdout);assert.equal(JSON.parse(check.stdout).design_scope,'small-request-design');
    }
    const compile=f.invoke('scripts/compile.ts',['--session-ref',f.originalRef,'--target','src/value.js','--report-dir',options.reportDir+'/compile','--json']);
    assert.equal(compile.status,0,compile.stderr+compile.stdout);
    assert(json(path.join(f.root,options.reportDir,'compile/compile-report.json')).execution.executed);
    const ut=f.invoke('harness-runner.ts',['--phase','ut','--request-file',options.requestFile,'--test-target','tests/value.test.cjs','--allow-test-write','tests/value.test.cjs']);
    assert.equal(ut.status,0,ut.stderr+ut.stdout);
    const report=json(path.join(f.root,options.reportDir,'ut/script-report.json'));
    assert(report.checks.some((check:any)=>check.id==='request_test_execution'&&check.status==='PASS'));
    assert(report.checks.some((check:any)=>check.id==='request_expectation_source'&&check.status==='PASS'));
    assert(fs.readFileSync(path.join(f.root,options.reportDir,'ut/native-test.log'),'utf8').includes('# pass 1'));
    // small 的最终交回还要签发下一作者请求，覆盖采集时这次 CLI 可能超过 60 秒。
    const returned=f.next(['--request',current.request.path,'--report-result',JSON.stringify({phase:active.context.phase,status:'passed',details:frame==='trivial'?'已实际修改原目标并执行Node语法及UT；原user明确未安排review/真机，交框架按原请求适用义务判定终点。':'实际修改原目标并执行Node语法及UT；独立review尚未做，不声称原请求完成。'})],
      frame==='small'?{timeoutMs:120_000}:undefined);
    assert.equal(returned.status,0,returned.stderr+returned.stdout);
    const history=eventRows(eventsFile);assert(!history.some(row=>row.type==='phase_write_violation'&&row.violations?.some((item:any)=>['src/value.js','src/aux.js','tests/value.test.cjs'].includes(item.path))),JSON.stringify(history.slice(-8)));
    assert(!history.some(row=>row.type==='agent_invoke_start'&&String(row.phase).includes('questioning')));
    if(frame==='trivial'){
      const response=f.value(returned);assert.equal(response.type,'goal_session_result');assert.equal(response.result.status,'completed',returned.stderr+returned.stdout);
      const end=history.filter(row=>row.type==='run_end'&&row.status==='COMPLETED').at(-1);assert(end,JSON.stringify(history.slice(-8)));assert.equal(end.completion_target,'request');
      assert(projectInitialDesignDelivery({projectRoot:f.root,frameworkRoot:f.frameworkRoot,manifest}).complete);
      for(const phase of ['review','testing']){assert(!fs.existsSync(path.join(f.root,options.reportDir,phase,'summary.json')));assert(!history.some(row=>row.type==='phase_verdict'&&row.phase===phase&&row.verdict==='PASS'));}
      assert(!fs.existsSync(featureFilePath(f.root,f.feature,'feature-completion.json')),'request completion manufactured a Feature receipt');
    }else assert(!history.some(row=>row.type==='run_end'&&row.status==='COMPLETED'),'missing independent review became a completed delivery');
    assert.equal(enumerateCanonicalChangeUnits(f.root,f.feature).length,0);assert(!fs.existsSync(path.join(path.dirname(blueprint),'component-blueprint.review.md')));
    assert.deepEqual(fs.readFileSync(born.manifest),originalBytes,'adjustment rewrote the original goal/budget/deadline');
    assert.equal(fs.readdirSync(featureFilePath(f.root,f.feature,'goal-runs')).filter(id=>!id.startsWith('.')).length,1);
    assert.equal(history.filter(row=>row.type==='run_created').length,1);assert(history.filter(row=>row.type==='agent_invoke_start').length>=calls);
  },frame==='trivial');},
});
cases.push({name:'B2-1 public small resume preserves malformed YAML and returns parser feedback to the same author without interruption',async run(){
  await withCompactControl(async f=>{
    const preparation=f.invoke('scripts/goal-mode-entry.ts',['--prepare-run','--run-mode','attended','--manifest',f.input,'--run-id',f.runId,'--session-ref',f.originalRef]);
    assert.equal(preparation.status,0,preparation.stderr+preparation.stdout);const born=f.value(preparation),manifest=json(born.manifest),manifestBytes=fs.readFileSync(born.manifest);
    const first=f.next(['--next','--session-ref',f.originalRef]);assert.equal(first.status,0,first.stderr+first.stdout);const original=f.value(first);
    assert.equal(original.type,'phase_execute_request');const originalRequest=json(original.request.path) as SessionExecutionRequest;
    const blueprint=featureFilePath(f.root,f.feature,'blueprint/component-blueprint.yaml');writePartialControlBlueprint(blueprint);
    const late=f.user('late-small','本次按小型处理。');
    const small=f.next(['--request',original.request.path,'--report-result',JSON.stringify({phase:originalRequest.context.phase,status:'passed',details:'交回本次四项设计草稿，继续真实user指定的小型原请求。'}),'--session-ref',late]);
    assert.equal(small.status,0,small.stderr+small.stdout);const current=f.value(small);assert.equal(current.type,'phase_execute_request',small.stderr+small.stdout);
    assert.equal(readInitialDesignRequest(f.root,f.frameworkRoot,manifest)?.frame,'small');
    const active=json(current.request.path) as SessionExecutionRequest,validBytes=fs.readFileSync(blueprint),badBytes=Buffer.from('a: [');
    assert(workUnitMayWritePath(active.write_boundary!,path.relative(f.root,blueprint).replace(/\\/g,'/')));
    fs.writeFileSync(blueprint,badBytes);
    const resumed=f.next(['--request',current.request.path,'--report-result',JSON.stringify({phase:active.context.phase,status:'passed',details:'作者交回当前草稿，由原解析器核对；不声明设计检查通过。'})]);
    assert.equal(resumed.status,0,resumed.stderr+resumed.stdout);const feedback=f.value(resumed);assert.equal(feedback.type,'phase_execute_request',resumed.stderr+resumed.stdout);
    assert.deepEqual(fs.readFileSync(blueprint),badBytes,'machine source preparation changed a malformed author draft');
    const repair=json(feedback.request.path) as SessionExecutionRequest;
    assert.equal(repair.context.runId,f.runId);assert.equal(repair.context.phase,'initial-design-author');assert.equal(repair.context.runtimeFacts.runBaseSha,f.base);
    assert(/canonical YAML 无法解析/.test(repair.context.instruction??''),repair.context.instruction);
    assert(workUnitMayWritePath(repair.write_boundary!,path.relative(f.root,blueprint).replace(/\\/g,'/')));assert(!workUnitMayWritePath(repair.write_boundary!,'framework/agents/README.md'));
    const again=f.next(['--next']);assert.equal(again.status,0,again.stderr+again.stdout);assert.equal(f.value(again).request.path,feedback.request.path);assert.deepEqual(fs.readFileSync(blueprint),badBytes);
    const badEvidence=path.join(FRAMEWORK,'harness/reports/maison-b-scope/c1-bad-yaml',path.basename(f.root)+'.yaml');fs.mkdirSync(path.dirname(badEvidence),{recursive:true});fs.copyFileSync(blueprint,badEvidence);
    // The real next owner repairs its own bytes; normal observation must resume without force/no-progress bypasses.
    fs.writeFileSync(blueprint,validBytes);
    const fixed=f.next(['--request',feedback.request.path,'--report-result',JSON.stringify({phase:repair.context.phase,status:'passed',details:'已在原作者窗口恢复合法四项设计草稿，沿原请求继续尚未执行的实现和验证。'})]);
    assert.equal(fixed.status,0,fixed.stderr+fixed.stdout);const next=f.value(fixed);assert.equal(next.type,'phase_execute_request',fixed.stderr+fixed.stdout);
    const nextRequest=json(next.request.path) as SessionExecutionRequest;assert.equal(nextRequest.context.runId,f.runId);assert(nextRequest.context.instruction?.includes('小型'));
    const history=eventRows(path.join(born.run_dir,'events.jsonl'));assert(!history.some(row=>row.type==='run_end'&&row.status==='INTERRUPTED'),JSON.stringify(history.slice(-8)));
    assert(!history.some(row=>row.type==='agent_invoke_start'&&String(row.phase).includes('questioning')));assert.equal(enumerateCanonicalChangeUnits(f.root,f.feature).length,0);
    assert.deepEqual(fs.readFileSync(born.manifest),manifestBytes);assert.equal(readInitialDesignRequest(f.root,f.frameworkRoot,manifest)?.prepared.intake?.baseline.base,f.base);
  });
}});
cases.push({name:'C1 public late fixed source does not reopen or erase published canonical CU responsibility',async run(){
  await withFreshCuHost(async host=>{
    const feature='ledger-app-blueprint',runId='published-fixed-root',units=enumerateCanonicalChangeUnits(host.root,feature);assert(units.length>0);
    const originals=units.map(unit=>({path:unit.canonicalPath,bytes:fs.readFileSync(unit.canonicalPath)}));
    const manifest=buildInitialDesignGoalManifest({feature,run_id:runId,adapter:'codex',requirement:'继续既有账本正式交付',initial_design:{completion_target:'feature',requested_results:['继续既有账本正式交付'],requested_phases:['coding']},unattended}, {projectRoot:host.root});
    const born=createGoalRun({projectRoot:host.root,manifest,chain:[]}),home=path.join(FRAMEWORK,'harness/reports/maison-b-scope/c1-native','published-'+Date.now()),session='99999999-3333-4444-8888-555555555555',file=path.join(home,'projects/fixture',session+'.jsonl');
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({type:'user',uuid:'late-small',sessionId:session,cwd:host.root,timestamp:new Date().toISOString(),message:{role:'user',content:'本次按小型处理。'}})+'\n');
    const priorHome=process.env.CLAUDE_CONFIG_DIR;process.env.CLAUDE_CONFIG_DIR=home;
    try{
      const result=withRuntimeTest({root:host.root},()=>spawnSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),path.join(host.harnessDir,'scripts/goal-mode-entry.ts'),'--project-root',host.root,'--framework-root',host.frameworkRoot,'--feature',feature,'--run-id',runId,'--adapter','codex','--run-mode','attended','--next','--session-ref',file+'#late-small'],{cwd:host.harnessDir,env:{...process.env,CLAUDE_CONFIG_DIR:home,MAISON_GOAL_CHECKPOINT_DIR:path.join(host.root,'.trust')},encoding:'utf8',timeout:60_000,windowsHide:true}));
      assert(!result.error,String(result.error));const events=eventRows(path.join(host.root,manifest.report_dir,'events.jsonl'));
      assert(events.some(event=>event.type==='run_start'&&event.user_control?.user?.id==='late-small'),result.stderr+result.stdout);
      assert.equal(readInitialDesignRequest(host.root,host.frameworkRoot,manifest),undefined,'published CU was converted into a no-CU short request');
      for(const original of originals)assert.deepEqual(fs.readFileSync(original.path),original.bytes,'fixed workflow choice rewrote a published CU');
      assert.equal(enumerateCanonicalChangeUnits(host.root,feature).length,units.length);assert(!events.some(event=>event.type==='run_end'&&event.status==='COMPLETED'));
      assert.equal(json(born.manifestPath).requirement,manifest.requirement);
      const evidence=path.join(FRAMEWORK,'harness/reports/maison-b-scope/c1','published-'+Date.now());fs.mkdirSync(evidence,{recursive:true});
      fs.writeFileSync(path.join(evidence,'public-result.json'),JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr,events},null,2));
    }finally{if(priorHome===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=priorHome;}
  });
}});

export function getCases(){return cases;}
export async function runSelectedCases(filter?:string){const results:UnitCaseResult[]=[],timings:UnitExecutionTiming[]=[];
  for(const test of cases){if(!matchesUnitCase(test.name,filter))continue;const finish=startCaseTiming([test.name],timings);try{await test.run();results.push({name:test.name,ok:true});}catch(error){results.push({name:test.name,ok:false,error:(error as Error).stack??String(error)});}finally{finish();}}
  return selectedUnitCases(results,filter,timings);
}
export async function runAll(){return(await runSelectedCases()).results;}
