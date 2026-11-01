import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSuiteProcesses, type UnitSuiteTask } from '../utils/unit-suite-processes';
import { filterLegacyCases, matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const helper = path.resolve(__dirname, '../utils/runtime-test-control.ts');
const cases = [{
  name: 'synchronous child timeout preserves returned output explicit logs and original run despite caught errors and fixture cleanup',
  async run() {
    await isolated(async (_root, task) => {
      const program = String.raw`const fs=require('fs'),path=require('path'),root=process.argv[1],failed=process.argv[2]==='failed';const dir=path.join(root,'doc/features/f/goal-runs/r');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'events.jsonl'),'{"type":"run_start"}\n'+(failed?'{"type":"run_end","status":"HALTED"}\n':''));fs.writeFileSync(path.join(dir,'manifest.json'),'{"original":true}');fs.writeFileSync(path.join(dir,'run-control.json'),JSON.stringify({owner:{state:failed?'released':'active'}}));fs.writeFileSync(path.join(dir,'goal-report.json'),JSON.stringify({status:failed?'HALTED':'RUNNING'}));process.stdout.write('owned stdout\n');process.stderr.write('owned stderr\n');if(failed)process.exitCode=1;else setInterval(()=>{},1000);`;
      const invoke = (mode: string) => `require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(program)},root,${JSON.stringify(mode)}],{encoding:'utf8',timeout:1500,windowsHide:true})`;
      const out = await runSuiteProcesses([
        task('returned-timeout', `const end=beginTestCase(['caller returned']);try{try{runRuntimeTestChild({root,expectedInterruption:'test child',evidenceFiles:['observations/stdout.log','observations/stderr.log']},()=>{const result=${invoke('timeout')};fs.mkdirSync(path.join(root,'observations'));fs.writeFileSync(path.join(root,'observations/stdout.log'),result.stdout??'');fs.writeFileSync(path.join(root,'observations/stderr.log'),result.stderr??'');return result;});}catch{}}finally{end();fs.rmSync(root,{recursive:true,force:true});}`),
        task('natural-child-failure', `const result=runRuntimeTestChild({root},()=>${invoke('failed')});require('assert').equal(result.status,1);fs.rmSync(root,{recursive:true,force:true});`),
        task('blocked-with-logs', String.raw`withRuntimeTest({root,timeoutMs:200,evidenceFiles:['observations/stdout.log','observations/stderr.log']},()=>{write(undefined);fs.writeFileSync(path.join(dir,'goal-report.json'),'{"status":"RUNNING"}');fs.mkdirSync(path.join(root,'observations'));fs.writeFileSync(path.join(root,'observations/stdout.log'),'owned stdout\n');fs.writeFileSync(path.join(root,'observations/stderr.log'),'owned stderr\n');while(true){};});`),
      ], 2, {});
      assert.deepEqual(out.map(row => row.ok), [false, true, false], JSON.stringify(out));
      const caught = out[0];
      assert(caught.results.length === 1 && caught.results[0].name === 'caller returned' && !caught.results[0].ok,
        'caught child timeout must fail the original case without an extra infrastructure row');
      assert(caught.results[0].error?.includes('test child timeout:'), 'an expected interruption cannot waive ETIMEDOUT');
      for (const row of [out[0], out[2]]) {
        const error = row.results.map(result => result.error ?? '').join('\n');
        const saved = /originals: ([^\r\n]+)/.exec(error)?.[1];
        assert(saved, error);
        const original = JSON.parse(fs.readFileSync(path.join(saved!, 'failure.json'), 'utf8'));
        assert(!fs.existsSync(original.saved[0].root), 'the fixture must already be cleaned up');
        for (const name of ['events.jsonl', 'manifest.json', 'run-control.json', 'goal-report.json'])
          assert(fs.existsSync(path.join(saved!, '0', name)), `missing original ${name}`);
        assert.equal(fs.readFileSync(path.join(saved!, '0/events.jsonl'), 'utf8'), '{"type":"run_start"}\n');
        assert.equal(original.logs.length, 2, 'explicit fixture logs must survive both local and outer worker timeout');
        for (const [index, stream] of ['stdout', 'stderr'].entries())
          assert.equal(fs.readFileSync(path.join(saved!, original.logs[index].file), 'utf8'), `owned ${stream}\n`);
      }
      const saved = /originals: ([^\r\n]+)/.exec(caught.results[0].error!)![1];
      for (const stream of ['stdout', 'stderr'])
        assert.equal(fs.readFileSync(path.join(saved, `child.${stream}.log`), 'utf8'), `owned ${stream}\n`);
    });
  },
}, {
  name: 'runtime signal reason is singular while undeclared signal and timeout remain failures',
  async run() {
    await isolated(async (_root, task) => {
      const killed = `{pid:process.pid,status:null,signal:'SIGKILL',stdout:''}`;
      const out = await runSuiteProcesses([
        task('declared-signal', `withRuntimeTest({root,expectedInterruption:'SIGKILL'},()=>{write(undefined,'active');return ${killed};});`),
        task('unknown-signal', `try{withRuntimeTest({root},()=>{write(undefined,'active');return ${killed};});}catch{}`),
        task('signal-timeout', `try{withRuntimeTest({root,expectedInterruption:'SIGKILL'},()=>{write(undefined,'active');return {...${killed},error:{code:'ETIMEDOUT',message:'test child deadline'}};});}catch{}`),
      ], 2, {});
      assert.deepEqual(out.map(row => row.ok), [true, false, false], JSON.stringify(out));
      assert(out[1].results.some(row => row.error?.includes('test child terminated by signal: SIGKILL')));
      assert(out[2].results.some(row => row.error?.includes('test child timeout:')));
    });
  },
}, {
  name: 'runtime driver natural completion includes success waiting product failure boundary and handoff',
  async run() {
    await isolated(async (root, task) => {
      const bodies = [
        `withRuntimeTest({root},()=>{write('COMPLETED');return 0;});`,
        `withRuntimeTest({root},()=>{write('HALTED','released', {halt_reason:'executor_waiting',run_disposition:'WAITING'});return 2;});`,
        `withRuntimeTest({root},()=>{write('HALTED');return 1;});`,
        `withRuntimeTest({root},()=>{write('HALTED','released',{halt_reason:'no_progress_guard'});return {status:'waiting',signal:'SIGTERM',error:{code:'ETIMEDOUT'}};});`,
        `withRuntimeTest({root},()=>{write(undefined);return 0;});`,
        `withRuntimeTest({root},()=>{write(undefined);return {pid:process.pid,status:2,signal:null,stdout:JSON.stringify({type:'phase_execute_request',request:{path:'original.json'}})};});`,
        `withRuntimeTest({root},()=>{write(undefined,'quiescing',{},[{type:'handoff_requested'}]);return 3;});`,
        `withRuntimeTest({root,expectedInterruption:'intentional fixture cut'},()=>{write('INTERRUPTED','released',{reason:'uncaught_exception',error:'intentional fixture cut'});return 1;});`,
      ];
      const out = await runSuiteProcesses(bodies.map((body, n) => task(`natural-${n}`, body)), 2, {});
      assert(out.every(row => row.ok), JSON.stringify(out));
    });
  },
}, {
  name: 'runtime driver unplanned quiesce stays FAIL after caller catch and preserves original events',
  async run() {
    await isolated(async (_root, task) => {
      const cli = `const fs=require('fs'),path=require('path'),root=process.argv[1],dir=path.join(root,'doc/features/f/goal-runs/r');try{require(${JSON.stringify(helper)}).withRuntimeTest({root},()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'events.jsonl'),'{"type":"run_start"}\\n');fs.writeFileSync(path.join(dir,'run-control.json'),JSON.stringify({owner:{state:'quiescing'}}));return 0;});}catch{};`;
      const out = await runSuiteProcesses([
        task('swallowed', `try{withRuntimeTest({root},()=>{write(undefined,'quiescing');return 0;});}catch{}`),
        task('other-interruption', `try{withRuntimeTest({root,expectedInterruption:'intentional fixture cut'},()=>{write('INTERRUPTED','quiescing',{error:'intentional fixture cut'});return 0;});}catch{}`),
        task('windows-killed-cli', `try{withRuntimeTest({root},()=>{write(undefined,'active');return {pid:process.pid,status:1,signal:null,stdout:''};});}catch{}`),
        task('failed-cli-spawn', `try{withRuntimeTest({root},()=>{write(undefined);return {pid:0,status:null,signal:null,error:{code:'ENOENT',message:'driver did not start'}};});}catch{}`),
        task('thrown-cli-timeout', `write('COMPLETED');try{withRuntimeTest({root,expectedInterruption:'timeout'},()=>{throw Object.assign(new Error('exec timeout'),{pid:process.pid,status:null,signal:'SIGTERM',code:'ETIMEDOUT'});});}catch{}`),
        task('failure-after-result', `void withRuntimeTest({root},async()=>{await new Promise(r=>setTimeout(r,100));write(undefined,'quiescing');return 0;}).catch(()=>{});`),
        task('attributed-catch', `const end=beginTestCase(['caller returned']);try{withRuntimeTest({root},()=>{write(undefined,'quiescing');return 0;});}catch{}end();`),
        task('attributed-rejects', `const end=beginTestCase(['caller returned']);await require('assert').rejects(async()=>withRuntimeTest({root},()=>{write(undefined,'quiescing');return 0;}));end();`),
        task('cli-swallowed', `require('child_process').spawnSync(process.execPath,['-r',${JSON.stringify(require.resolve('ts-node/register/transpile-only'))},'-e',${JSON.stringify(cli)},root],{env:process.env,stdio:'ignore',windowsHide:true});`),
      ], 2, {});
      for (const row of out) {
        if (row.id.startsWith('attributed-')) {
          assert(!row.ok && row.results.length === 1 && row.results[0].name === 'caller returned'
            && row.results[0].ok === false && !row.results.some(result => result.ok), 'the original case must be FAIL with zero false PASS and no duplicate infrastructure row');
          assert.deepEqual(filterLegacyCases(row.results, 'unmatched selector'), row.results, 'a case-attributed driver failure cannot be filtered back to green');
        } else assert(!row.ok && row.results.some(result => result.name === '<suite-runtime>' && !result.ok), JSON.stringify(row));
        const error = row.results.find(result => !result.ok)!.error!;
        const saved = /originals: ([^\r\n]+)/.exec(error)?.[1];
        assert(saved && fs.existsSync(path.join(saved, '0/events.jsonl')), error);
        const bytes = fs.readFileSync(path.join(saved!, '0/events.jsonl'), 'utf8');
        assert(bytes.startsWith('{"type":"run_start"}\n'), 'events must be copied, never reconstructed');
      }
    });
  },
}, {
  name: 'runtime driver async sync case suite and result-close timeouts fail with originals and reclaim their test trees',
  async run() {
    await isolated(async (root, task) => {
      const marker = (id: string) => path.join(root, `${id}-pids.json`);
      const descendant = (id: string) => `const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(${JSON.stringify(marker(id))},JSON.stringify([process.pid,child.pid]));`;
      const tasks = [
        task('async-timeout', `await withRuntimeTest({root,timeoutMs:200,expectedInterruption:'timeout'},async()=>{write(undefined);${descendant('async-timeout')}await new Promise(()=>{});});`),
        task('sync-timeout', `withRuntimeTest({root,timeoutMs:200},()=>{write(undefined);${descendant('sync-timeout')}while(true){};});`),
        task('case-timeout', `const end=beginTestCase(['blocked case'],200);withRuntimeTest({root,timeoutMs:20000},()=>{write(undefined);while(true){};});end();`),
        { ...task('suite-timeout', `write(undefined);setInterval(()=>{},1000);await new Promise(()=>{});`), timeoutMs: 5_000 },
        { ...task('result-close-timeout', `write('COMPLETED');setInterval(()=>{},1000);`), closeTimeoutMs: 200 },
      ];
      const out = await runSuiteProcesses(tasks, 2, {});
      for (const row of out) {
        assert(!row.ok && row.results.some(result => !result.ok && String(result.error).includes('timeout')), JSON.stringify(row));
        const error = row.results.map(result => result.error ?? '').join('\n');
        const saved = /originals: ([^\r\n]+)/.exec(error)?.[1];
        assert(saved && fs.existsSync(path.join(saved, '0/events.jsonl')), error);
      }
      const reported = out.find(row => row.id === 'result-close-timeout')!;
      assert(reported.results.some(row => row.name === 'caller returned' && row.ok)
        && reported.error?.includes('worker close timeout after result'), 'a reported green result is not a natural worker close');
      for (const id of ['async-timeout', 'sync-timeout']) {
        assert(fs.existsSync(marker(id)), `the test child was not created: ${id}`);
        for (const pid of JSON.parse(fs.readFileSync(marker(id), 'utf8')) as number[]) assert.throws(() => process.kill(pid, 0), `test process ${pid} survived`);
      }
    });
  },
}];

async function isolated(run: (root: string, task: (id: string, body: string) => UnitSuiteTask) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-control-test-'));
  const task = (id: string, body: string): UnitSuiteTask => {
    const file = path.join(root, `${id}.js`);
    fs.writeFileSync(file, `const fs=require('fs'),path=require('path'),os=require('os');const {withRuntimeTest,runRuntimeTestChild,beginTestCase}=require(${JSON.stringify(helper)});exports.runAll=async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-'));const dir=path.join(root,'doc/features/f/goal-runs/r');function write(status,owner='released',extra={},events=[]){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'events.jsonl'),[{type:'run_start'},...events,...(status?[{type:'run_end',status,...extra}]:[])].map(x=>JSON.stringify(x)).join('\\n')+'\\n');fs.writeFileSync(path.join(dir,'manifest.json'),'{}');fs.writeFileSync(path.join(dir,'run-control.json'),JSON.stringify({owner:{state:owner}}));}${body}return[{name:'caller returned',ok:true}];};`);
    return { id, modulePath: file, timeoutMs: 30_000 };
  };
  try { await run(root, task); }
  finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}

export function getCases() { return cases; }
export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, selector)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
