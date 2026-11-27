import { runUnitCasesAsync } from '../utils/unit-cases';
import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { writeLocalConfig } from '../../scripts/utils/framework-local-config';
import { loadGoalManifestDefinition, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { initialRequestWriteTargets, prepareInitialDesignRun, projectInitialDesignDelivery } from '../../scripts/utils/initial-design-delivery';
import { executionRequestForInvoke } from '../../scripts/utils/session-execution-handoff';
import { GoalPhaseRuntime } from '../../scripts/goal-phase-runtime';
import { withRuntimeTest } from '../utils/runtime-test-control';
import { runStatusWatchLoop } from '../../scripts/utils/goal-progress';
import { prepareAutomaticRequest, prepareDesignRequest } from '../../scripts/utils/automatic-request';
import { fixture as requestFixture } from './request-entry.unit.test';

const FRAMEWORK=path.resolve(__dirname,'../../..');
const requirement='完整交付新增收件箱批量已读能力，按原始需求完成设计、开发与验收。';
const unattended={write_mode:'full-access' as const,approval_mode:'never' as const,timeout_seconds:900};
const budget={max_total_turns:30,wall_clock_minutes:1};
const authorization={mode:'goal_mode' as const,autonomyAuthorized:true};
const json=(file:string):any=>JSON.parse(fs.readFileSync(file,'utf8'));
const eventRows=(file:string):any[]=>fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(row=>JSON.parse(row));

/** Native-format fixture, not a new model/client execution. All product checks below use public CLIs. */
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
      executor:{async execute(context){calls++;assert.equal(context.phase,'initial-design-author');assert(context.instruction?.includes(requirement));assert(!context.instruction?.includes('## Knowledge inputs'));return {status:'waiting',phase:context.phase,details:'受控运输仅证明原始输入出生，不产生设计或通过结果。',exitCode:0,stdout:'',stderr:'',command:'bounded-phase-input-observer'};}}}).run());
    assert.equal(calls,1);assert.notEqual(exit,0);
    const runs=featureFilePath(root,'backend-entry','goal-runs');const ids=fs.readdirSync(runs).filter(id=>!id.startsWith('.'));assert.equal(ids.length,1);
    const backend=json(path.join(runs,ids[0],'manifest.json'));assert(isInitialDesignManifest(backend));
    assert.deepEqual(backend.initial_design.requested_phases,[]);assert.equal(backend.start_phase,'spec');assert.equal(backend.end_phase,'testing');
    assert.deepEqual(fs.readFileSync(backendInput),backendBefore);
    for(const manifest of [session,backend])for(const field of ['execution_scope','phase_chain','chain_override','run_base_sha'] as const)assert.equal(manifest[field],undefined,field);
  });},
},{
  name:'managed initial author freezes only the effective design knowledge in the actual request and keeps the blueprint write boundary',
  async run(){await withEmpty(async root=>{
    const feature='design-knowledge-input';
    const source='doc/extensions/knowledge/design.md';
    const body='# 真正由宿主提供的设计文本\n按原需求保留默认值决策与正式交接。\n';
    fs.mkdirSync(path.dirname(path.join(root,source)),{recursive:true});
    fs.writeFileSync(path.join(root,source),body,'utf8');
    fs.writeFileSync(path.join(root,'doc/extensions/manifest.yaml'),YAML.stringify({
      schema_version:'1.1',name:'installed-design-knowledge',provides:{skill_assets:{'component-design':{knowledge:'knowledge/design.md'}}},
    }));
    const input=definition(root,feature);let calls=0;
    const exit=await withRuntimeTest({root},()=>new GoalPhaseRuntime({
      args:['--manifest',input,'--project-root',root,'--framework-root',FRAMEWORK,'--foreground-ok','--authorize-autonomy'],authorization,
      executor:{async execute(context){
        calls++;
        const issued=executionRequestForInvoke(context.runDir,context.attemptId);
        assert(issued,'原作者执行前须真实签发请求');
        assert.equal(issued.request.context.phase,'initial-design-author');
        assert.equal(issued.request.context.instruction,context.instruction);
        assert.equal(context.instruction?.split(body).length,2,'生效正文在作者提示中恰好交付一次');
        assert(context.instruction?.includes(source));
        const material=context.workInput?.material;
        assert.deepEqual(issued.request.context.workInput?.material,material);
        const segments=material?.segments as unknown[] | undefined;
        const delivered=segments?.filter(segment=>typeof segment==='string'&&segment.includes(body));
        assert.equal(delivered?.length,1);
        assert(String(delivered?.[0]).includes(source));
        assert.deepEqual(issued.request.snapshot_options?.ownedPrefixes,[`doc/features/${feature}/blueprint`]);
        assert.equal(fs.readFileSync(path.join(root,source),'utf8'),body);
        return {status:'waiting',phase:context.phase,exitCode:0,stdout:'',stderr:'',command:'design-knowledge-observer'};
      }},
    }).run());
    assert.equal(calls,1);assert.notEqual(exit,0);
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

cases.push({
  name: 'a18 original request grants explicit test preparation without granting read or verification targets',
  async run() {
    const f = requestFixture('ut');
    const previousHome = process.env.CLAUDE_CONFIG_DIR;
    try {
      const home = path.join(f.root, 'native');
      const sessionFile = path.join(home, 'projects', 'fixture', 'grant-test.jsonl');
      const testFile = 'tests/value.test.cjs', source = 'src/value.js', auxiliary = 'src/aux.js';
      process.env.CLAUDE_CONFIG_DIR = home;
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(path.join(f.root, auxiliary), 'exports.aux = 1;\n');
      const event = { cwd: f.root, sessionId: 'grant-test', timestamp: new Date().toISOString() };
      const native = [
        { type: 'user', uuid: 'original', message: { role: 'user', content: '按特别简单处理：修复 src/value.js 的数值。' } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'read-test', name: 'Read', input: { file_path: path.join(f.root, testFile) } }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-test', content: fs.readFileSync(path.join(f.root, testFile), 'utf8') }] } },
      ];
      fs.writeFileSync(sessionFile, native.map(row => JSON.stringify({ ...event, ...row })).join('\n') + '\n');
      const sessionRef = sessionFile + '#original';
      const prepared = prepareDesignRequest({ projectRoot: f.root, frameworkRoot: f.framework,
        blueprintId: 'grant-test', sessionRef, targets: [source], reportDir: 'doc/reports/grant-test' });
      assert(prepared.intake && !prepared.originGap, prepared.originGap);
      assert.equal(prepared.intake.source_reads, undefined, 'ordinary intake does not turn native Read into a grant');
      assert.deepEqual(json(prepared.requestFile).baseline, { head: 'WORKTREE' });
      const observation = {
        kind: 'construction', blueprintPath: '', candidatesPath: '', issues: [],
        request: { frame: 'trivial', prepared, implementation: true },
      } as const;
      assert.deepEqual(initialRequestWriteTargets(f.root, f.framework, { ...observation, issues: [] }), [source]);
      prepareAutomaticRequest(f.root, f.framework, {
        phase: 'ut', 'session-ref': sessionRef, target: auxiliary, 'test-target': testFile,
        'allow-test-write': testFile, 'prepare-request': true,
        'report-dir': path.relative(f.root, path.join(prepared.reportDir, 'ut')),
      }, { requestFile: prepared.requestFile, sourceRefs: prepared.sourceRefs, intake: prepared.intake, requestedResult: prepared.intake.user.text });
      const writes = initialRequestWriteTargets(f.root, f.framework, { ...observation, issues: [] });
      assert.deepEqual(writes.sort(), [source, testFile].sort(), 'the explicit test grant does not grant writes to the verification target');
    } finally {
      if (previousHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousHome;
      clearFrameworkConfigCache();
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  },
});

export const runAll = () => runUnitCasesAsync(cases);
