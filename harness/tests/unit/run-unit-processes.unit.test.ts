import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { PassThrough, Writable } from 'stream';
import { forwardSuiteLines, orderSuiteTasks, runSuiteProcesses } from '../utils/unit-suite-processes';
import { createTrustIsolation } from '../utils/test-trust-bootstrap';
import type { UnitCaseResult } from '../run-unit';
import { executeUnitModule, filterLegacyCases, matchesUnitCase, selectedUnitCases, startCaseTiming, UnitExecutionTiming } from '../utils/unit-case-selection';

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-process-test-'));
  const check = async (name: string, run: () => void | Promise<void>): Promise<void> => {
    try { await run(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error instanceof Error ? error.stack : String(error) }); }
  };
  const module = (id: string, text: string) => {
    const file = path.join(root, `${id}.js`);
    fs.writeFileSync(file, text, 'utf8');
    return { id, modulePath: file };
  };
  try {
    await check('case 筛选：显示名、标点和逗号都按一个字面子串；基础设施红例不丢', async () => {
      assert(matchesUnitCase('successor-exit: 中文, (a+b)', '中文, (a+b)'));
      assert(!matchesUnitCase('a', 'a,b')); assert(!matchesUnitCase('A', 'a'));
      const results = [{ name: 'target', ok: true }, { name: 'shared red', ok: false },
        { name: 'target <missing>', ok: false, infrastructure: true }];
      const selected = selectedUnitCases(results, 'target', []);
      assert.strictEqual(selected.matchedCaseCount, 1);
      assert.strictEqual(selected.results.length, 3);
      assert.deepStrictEqual(filterLegacyCases(results, 'absent'), [results[2]]);
      const timings: UnitExecutionTiming[] = [];
      const end = startCaseTiming(['target', 'shared red'], timings);
      try { throw new Error('fixture failed'); } catch {} finally { end(); }
      assert(timings.length === 1 && timings[0].durationMs >= 0 && timings[0].caseNames.length === 2);
      let allRan = false;
      await assert.rejects(executeUnitModule({ runAll() { allRan = true; return []; } }, 'unsupported', 'target', true));
      assert(!allRan);
    });
    await check('worker selector 纯参数：合法空分片、共同红结果、缺能力前置拒绝；nested 不继承', async () => {
      const selectable = module('selectable', `exports.runAll=()=>[{name:'target',ok:true},{name:'other',ok:true}]; exports.runSelectedCases=s=>({results:s===undefined?exports.runAll():s==='target'?[{name:'target',ok:true},{name:'shared red',ok:false}]:[],matchedCaseCount:s===undefined?2:s==='target'?1:0,executionTimings:[]});`);
      const marker = path.join(root, 'unsupported-ran');
      const unsupported = module('unsupported', `exports.runAll=()=>{require('fs').writeFileSync(${JSON.stringify(marker)},'bad');return[];};`);
      const nested = module('nested', `exports.runAll=()=>[]; exports.runSelectedCases=async s=>{const r=await require(${JSON.stringify(path.resolve(__dirname, '..', 'utils', 'unit-suite-processes.ts'))}).runSuiteProcesses([${JSON.stringify(selectable)}],1,{});return{results:[{name:s,ok:r[0].results.length===2&&r[0].ok}],matchedCaseCount:1,executionTimings:[]};};`);
      const out = await runSuiteProcesses([{ ...selectable, selector: 'target', requirePreselection: true },
        { ...unsupported, selector: 'target', requirePreselection: true },
        { ...nested, selector: 'target', requirePreselection: true }], 2, {});
      assert.strictEqual(out[0].matchedCaseCount, 1); assert(!out[0].ok && out[0].results.length === 2);
      assert(!out[1].ok && !fs.existsSync(marker)); assert(out[2].ok);
      const [empty] = await runSuiteProcesses([{ ...selectable, selector: 'absent', requirePreselection: true }], 1, {});
      assert(empty.ok && empty.matchedCaseCount === 0 && empty.results.length === 0);
    });
    await check('RS 同块未匹配红结果/missing 保留且不伪造命中；self-check 可显式选择', async () => {
      const priorResultsOut = process.env.RELIABILITY_RESULTS_OUT;
      delete process.env.RELIABILITY_RESULTS_OUT;
      try {
        const rs = await import('./reliability-scenarios.unit.test');
        const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'reliability-scenarios', 'registry.json'), 'utf8'));
        const declared = rs.SCENARIOS.flatMap(s => s.run.flatMap(f => f.produces)).sort();
        const registered = registry.scenarios.flatMap((s: { id: string; branches: Array<{ key: string }> }) => s.branches.map(b => `${s.id}/${b.key}`)).sort();
        assert.deepStrictEqual(declared, registered, 'flow 产出引用覆盖 registry，恰好一次');
        const s3 = rs.SCENARIOS.find(s => s.id === 'S3')!;
        assert.deepStrictEqual(s3.run[0].produces, ['S3/blueprint-bump', 'S10/new-format']);
        const s7 = rs.SCENARIOS.find(s => s.id === 'S7')!.run[0];
        const original = s7.execute;
        const selector = '冲突 A（屏 id 当元素 id）';
        try {
          s7.execute = async (_entry, done) => {
            for (const key of ['disclosed', 'undisclosed-in-chain']) done({ key,
              hit: { ok: key === 'disclosed', evidence: 'controlled shared outcome' },
              prediction: { predicted_chain: [], executed_phases: [], predicted_reruns: 0, note: 'selector test' },
              expectation: () => ({ met: true, detail: 'selector test' }) });
          };
          const shared = await rs.runScenarios(['S7'], false, selector);
          assert(shared.results.length === 2 && shared.matchedCaseCount === 1 && shared.results.some(r => !r.ok));
          assert(shared.executionTimings.length === 1 && shared.executionTimings[0].caseNames.length === 2);
          s7.execute = async () => { throw new Error('driver failed'); };
          const missing = await rs.runScenarios(['S7'], false, selector);
          assert(missing.matchedCaseCount === 0 && missing.results.length === 3 && missing.results.every(r => !r.ok && r.infrastructure));
        } finally { s7.execute = original; }
        const explicit = await rs.runScenarios([], true, '自检 返修 5：');
        assert(explicit.matchedCaseCount === 1 && explicit.results.length === 6 && explicit.results.every(r => r.ok));
        const incidental = await rs.runScenarios([], true, 'absent case');
        assert(incidental.matchedCaseCount === 0 && incidental.results.length === 6);
      } finally {
        if (priorResultsOut === undefined) delete process.env.RELIABILITY_RESULTS_OUT;
        else process.env.RELIABILITY_RESULTS_OUT = priorResultsOut;
      }
    });
    await check('调度：未知优先且稳定，已知耗时最长先发', () => {
      const tasks = ['short', 'new-a', 'long', 'new-b', 'tie'].map(id => ({ id, modulePath: id }));
      assert.deepStrictEqual(orderSuiteTasks(tasks, { short: 1, long: 9, tie: 9 }).map(s => s.id),
        ['new-a', 'new-b', 'long', 'tie', 'short']);
      assert.deepStrictEqual(orderSuiteTasks(tasks, {}).map(s => s.id), tasks.map(s => s.id));
    });
    await check('日志：跨 chunk UTF-8、半行和流尾不丢失，不拼其他 suite 的行', async () => {
      const a = new PassThrough(); const b = new PassThrough();
      let text = '';
      const target = new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done(); } });
      forwardSuiteLines(a, target, 'a'); forwardSuiteLines(b, target, 'b');
      const bytes = Buffer.from('中文\n尾');
      a.write(bytes.subarray(0, 2)); b.write('x'); a.write(bytes.subarray(2)); b.end('y\n'); a.end();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.strictEqual(text, '[a] 中文\n[b] xy\n[a] 尾\n');
    });
    await check('workers 1 仍逐套件独立进程，私有 TMP、信号与 env 不串套件', async () => {
      const a = module('isolated-a', `exports.runAll=()=>{process.env.MAISON_UT_LEAK='yes'; process.emit('SIGINT'); return [{name:JSON.stringify({pid:process.pid,tmp:require('os').tmpdir()}),ok:true}];};`);
      const b = module('isolated-b', `exports.runAll=()=>[{name:JSON.stringify({pid:process.pid,tmp:require('os').tmpdir(),leak:process.env.MAISON_UT_LEAK}),ok:!process.env.MAISON_UT_LEAK}];`);
      const out = await runSuiteProcesses([a, b], 1, {});
      assert(out.every(s => s.status === 'completed' && s.ok));
      const [left, right] = out.map(s => JSON.parse(s.results[0].name));
      assert(left.pid !== right.pid && left.pid !== process.pid && right.pid !== process.pid);
      assert(left.tmp !== right.tmp && !fs.existsSync(left.tmp) && !fs.existsSync(right.tmp));
      assert(out.every(s => s.startupMs !== null && s.totalMs! >= s.startupMs! && s.loadMs !== null));
    });
    await check('并发上限、每个套件恰好执行一次，返回登记顺序', async () => {
      const log = path.join(root, 'dispatch.jsonl');
      const tasks = ['short', 'long', 'medium'].map(id => module(id,
        `exports.runAll=async()=>{const f=require('fs'); const log=${JSON.stringify(log)}; f.appendFileSync(log,JSON.stringify({id:${JSON.stringify(id)},type:'start',at:Date.now()})+'\\n'); await new Promise(r=>setTimeout(r,80)); f.appendFileSync(log,JSON.stringify({id:${JSON.stringify(id)},type:'end',at:Date.now()})+'\\n'); return [{name:${JSON.stringify(id)},ok:true}];};`));
      const out = await runSuiteProcesses(tasks, 2, { short: 1, long: 9, medium: 5 });
      assert.deepStrictEqual(out.map(s => s.id), tasks.map(s => s.id));
      const events = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      let running = 0;
      for (const event of events) { running += event.type === 'start' ? 1 : -1; assert(running >= 0 && running <= 2); }
      assert.strictEqual(running, 0);
      for (const task of tasks) assert.strictEqual(events.filter(e => e.type === 'start' && e.id === task.id).length, 1);
    });
    await check('加载/runAll 异常、无结果、结果后非零退出均失败，普通红例继续汇总', async () => {
      const tasks = [
        { id: 'missing', modulePath: path.join(root, 'missing.js') },
        module('throwing', `exports.runAll=()=>{throw new Error('run exploded')};`),
        module('no-result', `exports.runAll=()=>process.exit(0);`),
        module('late-exit', `exports.runAll=()=>{process.once('exit',()=>{process.exitCode=7}); return [{name:'before exit',ok:true},{name:'unmatched red case',ok:false,error:'assert failed'}];};`),
        module('red', `exports.runAll=()=>[{name:'red case',ok:false,error:'assert failed'}];`),
        module('green', `exports.runAll=()=>[{name:'green case',ok:true}];`),
      ];
      const out = await runSuiteProcesses(tasks, 2, {});
      assert.deepStrictEqual(out.map(s => s.ok), [false, false, false, false, false, true]);
      assert.strictEqual(out[0].status, 'load-error'); assert.strictEqual(out[1].status, 'run-error');
      assert.strictEqual(out[2].status, 'worker-error'); assert.strictEqual(out[3].status, 'worker-error');
      assert(out[3].results.some(c => !c.ok && c.name === '<suite-worker>'), '已有普通红例也须单独保留晚期退出的基础设施失败');
      assert.strictEqual(out[4].status, 'completed'); assert.strictEqual(out[4].results[0].error, 'assert failed');
      const nodeChild = require('child_process') as typeof import('child_process');
      const realFork = nodeChild.fork;
      try {
        nodeChild.fork = (() => { throw new Error('spawn failed'); }) as typeof nodeChild.fork;
        const [failed] = await runSuiteProcesses([tasks[5]], 1, {});
        assert(!failed.ok && failed.status === 'worker-error' && failed.error?.includes('spawn failed'));
      } finally { nodeChild.fork = realFork; }
    });
    await check('有限清理重试仍删不掉 trust 必须失败；worker 清理失败不降级为 PASS', async () => {
      const iso = createTrustIsolation();
      const nodeFs = require('fs') as typeof fs;
      const real = nodeFs.rmSync;
      try {
        nodeFs.rmSync = ((file, options) => {
          if (file === iso.root) { assert.strictEqual(options?.maxRetries, 3); assert.strictEqual(options?.retryDelay, 100); throw new Error('locked'); }
          return real(file, options);
        }) as typeof fs.rmSync;
        assert.deepStrictEqual(iso.cleanupStrict(), { ok: false, leftoverPath: iso.root });
      } finally { nodeFs.rmSync = real; iso.cleanupStrict(); }
      const blocked = module('cleanup-failure', `exports.runAll=()=>{const fs=require('fs'),real=fs.rmSync; fs.rmSync=(p,o)=>{if(require('path').basename(String(p)).startsWith('maison-test-trust-')) throw new Error('locked'); return real(p,o);}; return [{name:'case passed',ok:true}];};`);
      const [out] = await runSuiteProcesses([blocked], 1, {});
      assert.strictEqual(out.ok, false); assert(out.results.some(c => c.name === '<suite-cleanup>' && !c.ok));
    });
    await check('可捕获中断回收本轮 worker 和真实子孙进程，不派发队列余项', async () => {
      const marker = path.join(root, 'descendants.json');
      const task = module('descendants', `exports.runAll=async()=>{const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({worker:process.pid,child:child.pid})); await new Promise(()=>{});};`);
      const never = module('never', `exports.runAll=()=>{require('fs').writeFileSync(${JSON.stringify(path.join(root, 'never-ran'))},'bad'); return [];};`);
      const driver = path.join(root, 'driver.js');
      const scheduler = path.resolve(__dirname, '..', 'utils', 'unit-suite-processes.ts');
      const interrupt = path.join(root, 'interrupt');
      fs.writeFileSync(driver, `const timer=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(interrupt)})){clearInterval(timer);process.emit('SIGINT');}},20); require(${JSON.stringify(scheduler)}).runSuiteProcesses(${JSON.stringify([task, never])},1,{}).then(r=>{clearInterval(timer);require('fs').writeFileSync(${JSON.stringify(path.join(root, 'cancel-results.json'))},JSON.stringify(r)); process.exitCode=r.every(s=>s.ok)?0:1;});`);
      const child = spawn(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), driver], {
        cwd: path.resolve(__dirname, '..', '..'), env: { ...process.env, TS_NODE_PROJECT: path.resolve(__dirname, '..', '..', 'tsconfig.json') },
        stdio: 'ignore', windowsHide: true,
      });
      const closed = new Promise<number | null>(resolve => child.once('close', resolve));
      try {
        const started = Date.now();
        while (!fs.existsSync(marker)) {
          assert(Date.now() - started < 30_000, '子孙进程未出生');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        // Windows 的 child.kill(SIGINT) 是强杀；专用 driver 内发信号，仍走实际父取消入口。
        fs.writeFileSync(interrupt, 'yes');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const status = await Promise.race([closed, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('中断回收未收尾')), 30_000);
          })]);
          assert.notStrictEqual(status, 0);
        } finally { if (timer) clearTimeout(timer); }
        assert(!fs.existsSync(path.join(root, 'never-ran')));
        const pids = JSON.parse(fs.readFileSync(marker, 'utf8')) as { worker: number; child: number };
        for (const pid of [pids.worker, pids.child]) assert.throws(() => process.kill(pid, 0), `本轮进程 ${pid} 残留`);
        const out = JSON.parse(fs.readFileSync(path.join(root, 'cancel-results.json'), 'utf8'));
        assert(out.every((s: { ok: boolean }) => !s.ok) && out[1].status === 'not-run');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const { killProcessTree } = await import('../../scripts/utils/agent-invoke');
          if (fs.existsSync(marker)) await killProcessTree(JSON.parse(fs.readFileSync(marker, 'utf8')).worker);
          if (child.pid) await killProcessTree(child.pid);
          await closed;
        }
      }
    });
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  return results;
}
