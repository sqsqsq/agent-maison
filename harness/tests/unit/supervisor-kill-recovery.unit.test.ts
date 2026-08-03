// ============================================================================
// supervisor-kill-recovery.unit.test.ts — supervisor 生产链的**真进程**集成验收
// （plan a4f7e2b1 t2 原验收：/F 强杀 → 自动 resume）
// ----------------------------------------------------------------------------
// 为什么必须真跑：上一版只用正则扫源码里有没有 `spawn` / `--resume` 字面量，
// 于是**漏掉了「启动期 60s 无 beacon 窗口」**——源码结构齐全、行为却是错的。
// 本文件不引入新测试框架，只做三件真事：
//   ① 起一个真子进程当「run 的 owner」，按生产同款函数写 beacon；
//   ② 用 taskkill /F（非 Windows 用 SIGKILL）**真强杀**它——强杀不给清理机会，
//      beacon 文件必然原样留着，这正是要识破的形态；
//   ③ 跑 supervisor CLI（真子进程，--dry-run）断言判定层：强杀前不介入、强杀后要 resume；
//   ④ **再跑一次非 dry-run**（进程内入口 + runner 替身），把 dry-run 提前 return 掉的
//      那半条链补上：先记账 → 真 spawn → 新进程真写出 beacon → 二次判定不再重启。
//
// 边界诚实声明（codex 复核后收窄到这一句）：④ 的 runner 是替身，证明的是
// **supervisor 侧**的记账/拉起/收敛闭环；「真 goal-runner 能续跑到底」需要真实工程、
// adapter 与设备，属宿主回归，单测不冒充。
// ============================================================================

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeLivenessBeacon, readLivenessBeacon, assessLivenessBeacon } from '../../scripts/utils/liveness-beacon';
import { defaultProcessProbe } from '../../scripts/utils/device-session';
import { superviseRun } from '../../scripts/utils/goal-supervisor';
import { __testing_main as superviseMain, __testing_setRunnerScript } from '../../scripts/goal-supervise';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => Promise<void> | void }

const RUN_ID = '20260802T120000Z-killrec';

/** 起一个真子进程并等它就绪；返回 pid。自带自杀兜底，绝不把测试挂死。 */
async function spawnVictim(): Promise<{ pid: number; kill: () => void }> {
  const child = spawn(
    process.execPath,
    ['-e', 'const t=setTimeout(()=>process.exit(0),20000); if(t.unref) t.unref(); setInterval(()=>{},1000);'],
    { stdio: 'ignore', windowsHide: true },
  );
  await new Promise((r) => setTimeout(r, 300)); // 等进程真正起来（probe 才查得到）
  const pid = child.pid ?? -1;
  return {
    pid,
    kill: () => {
      // **真 /F 强杀**：不给进程执行任何清理代码的机会——beacon 只能靠对账识破
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 });
      } else {
        try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ }
      }
    },
  };
}

/** 用生产同款写入函数，但把身份指向 victim 进程（模拟「那个 run 的 owner 是它」）。 */
function writeBeaconFor(root: string, reportDir: string, pid: number): void {
  const probe = defaultProcessProbe();
  const real = probe.identify(pid);
  assert(real, `探不到 victim(pid=${pid}) 身份——本机 probe 不可用，用例无法成立`);
  writeLivenessBeacon({
    projectRoot: root,
    reportDir,
    runId: RUN_ID,
    probe: { identify: () => real, killTree: () => true },
  });
}

function tmpRun(): { root: string; reportDir: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kill-recovery-'));
  const reportDir = 'doc/features/bc-openCard/goal-runs/' + RUN_ID;
  fs.mkdirSync(path.join(root, reportDir), { recursive: true });
  return { root, reportDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const cases: TestCase[] = [
  {
    name: '真 /F 强杀闭环：进程活着→判 alive；强杀后 beacon 原样留着→对账仍判 stale',
    run: async () => {
      if (process.platform !== 'win32') {
        // defaultProcessProbe 在非 Windows 保守返回 null（无可移植的创建时间），
        // 四元组对账无法成立——如实跳过，不做半可用断言。
        return;
      }
      const { root, reportDir, cleanup } = tmpRun();
      const victim = await spawnVictim();
      try {
        writeBeaconFor(root, reportDir, victim.pid);
        const beacon = readLivenessBeacon(root, reportDir);
        assert(beacon !== null, 'beacon 应已写入');

        const alive = assessLivenessBeacon({ beacon, runId: RUN_ID });
        assert(alive.state === 'alive', `进程还活着却判 ${alive.state}：${JSON.stringify(alive)}`);

        victim.kill();
        await new Promise((r) => setTimeout(r, 800)); // 等 OS 真正回收

        // 强杀不给清理机会——beacon 文件必然还在，内容一切「正常」
        assert(fs.existsSync(path.join(root, reportDir, 'liveness.json')), '强杀后 beacon 应原样留着');
        const after = assessLivenessBeacon({ beacon: readLivenessBeacon(root, reportDir), runId: RUN_ID });
        assert(
          after.state === 'stale',
          `强杀后仍判 ${after.state}——「文件还在」被当成了存活证据，反强杀失效`,
        );
      } finally {
        victim.kill();
        cleanup();
      }
    },
  },
  {
    name: '生产链真跑（CLI --dry-run）：强杀后 supervisor 判定 resume；进程活着时判定不介入',
    run: async () => {
      if (process.platform !== 'win32') return;
      const { root, reportDir, cleanup } = tmpRun();
      const victim = await spawnVictim();
      const eventsPath = path.join(root, reportDir, 'events.jsonl');
      const cli = path.resolve(__dirname, '..', '..', 'scripts', 'goal-supervise.ts');
      const tsNode = require.resolve('ts-node/dist/bin.js');
      const runCli = (): { out: string; code: number | null } => {
        const r = spawnSync(
          process.execPath,
          [tsNode, cli, '--feature', 'bc-openCard', '--run-id', RUN_ID, '--dry-run',
           '--project-root', root],
          { cwd: root, encoding: 'utf-8', timeout: 120_000, windowsHide: true,
            env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' } },
        );
        return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status };
      };
      try {
        // run 处于「框架正在保守恢复」的状态
        fs.writeFileSync(
          eventsPath,
          [
            JSON.stringify({ ts: new Date().toISOString(), type: 'run_start' }),
            JSON.stringify({
              ts: new Date().toISOString(), type: 'phase_backtrack_requested',
              phase: 'ut', run_disposition: 'RECOVERY_PENDING',
            }),
          ].join('\n') + '\n',
          'utf-8',
        );
        writeBeaconFor(root, reportDir, victim.pid);

        // ① 进程还活着 → 不介入（这一条正是「启动期空窗」类 bug 的守卫）
        const aliveRun = runCli();
        assert(aliveRun.code === 0, `CLI 异常退出：${aliveRun.out}`);
        assert(
          /no_op/.test(aliveRun.out),
          `进程活着却要拉起（会误吃重启预算）：\n${aliveRun.out}`,
        );

        // ② 真强杀后 → 判定 resume
        victim.kill();
        await new Promise((r) => setTimeout(r, 800));
        const deadRun = runCli();
        assert(deadRun.code === 0, `CLI 异常退出：${deadRun.out}`);
        assert(
          /resume/.test(deadRun.out),
          `强杀后未判自动恢复——a4 立项场景仍未闭环：\n${deadRun.out}`,
        );

        // ③ dry-run 不得写 supervisor_restart（只有真拉起才记账）
        const events = fs.readFileSync(eventsPath, 'utf-8');
        assert(!events.includes('supervisor_restart'), 'dry-run 不应记账重启');
        // ④ no_op 不得污染事件流（周期任务每 5 分钟一次，落事件会把已完成 run 刷爆）
        assert(!events.includes('supervisor_observation'), 'no_op 不应落事件');
      } finally {
        victim.kill();
        cleanup();
      }
    },
  },
  {
    name: '非 dry-run 真拉起：先记账→真 spawn→新进程写出新 beacon→二次判定收敛为不介入',
    run: async () => {
      if (process.platform !== 'win32') return;
      const { root, reportDir, cleanup } = tmpRun();
      const runDirAbs = path.join(root, reportDir);
      const eventsPath = path.join(runDirAbs, 'events.jsonl');
      const victim = await spawnVictim();
      let childPid: number | null = null;
      try {
        fs.writeFileSync(
          eventsPath,
          [
            JSON.stringify({ ts: new Date().toISOString(), type: 'run_start' }),
            JSON.stringify({
              ts: new Date().toISOString(), type: 'phase_backtrack_requested',
              phase: 'ut', run_disposition: 'RECOVERY_PENDING',
            }),
          ].join('\n') + '\n',
          'utf-8',
        );
        writeBeaconFor(root, reportDir, victim.pid);
        victim.kill();
        await new Promise((r) => setTimeout(r, 800));

        // runner 替身：用**生产同款** writeLivenessBeacon 写自己的 beacon（证明「被拉起来的
        // 那个进程确实产出了新的存活证据」），再留下 argv 供断言拉起指令正确。
        const beaconMod = path.resolve(__dirname, '..', '..', 'scripts', 'utils', 'liveness-beacon.ts');
        const stub = path.join(root, 'stub-runner.ts');
        // 临时工程需要一份 tsconfig：ts-node 找不到时会退到「module=NodeNext +
        // moduleResolution 未同步」的默认组合而**编译失败**（transpile-only 也压不住
        // 配置级诊断）。真实宿主工程本来就有 tsconfig，这里补齐同一前提。
        fs.writeFileSync(
          path.join(root, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              module: 'commonjs', target: 'es2020', moduleResolution: 'node',
              esModuleInterop: true, skipLibCheck: true,
            },
          }, null, 2) + '\n',
          'utf-8',
        );
        fs.writeFileSync(
          stub,
          [
            'const fs = require("fs");',
            `const { writeLivenessBeacon } = require(${JSON.stringify(beaconMod)});`,
            `const RUN_DIR = ${JSON.stringify(runDirAbs)};`,
            `writeLivenessBeacon({ projectRoot: ${JSON.stringify(root)},` +
              ` reportDir: ${JSON.stringify(reportDir)}, runId: ${JSON.stringify(RUN_ID)} });`,
            'fs.appendFileSync(RUN_DIR + "/events.jsonl", JSON.stringify(' +
              '{ ts: new Date().toISOString(), type: "stub_runner_started", pid: process.pid }) + "\\n", "utf-8");',
            // argv 最后写：它是「一切就绪」的哨兵，轮询到它即可安全断言其余产物
            'fs.writeFileSync(RUN_DIR + "/stub-argv.json", JSON.stringify(process.argv.slice(2)), "utf-8");',
            'setTimeout(function () { process.exit(0); }, 15000);',
          ].join('\n') + '\n',
          'utf-8',
        );

        const prevArgv = process.argv;
        const prevTranspile = process.env.TS_NODE_TRANSPILE_ONLY;
        let code: number;
        try {
          __testing_setRunnerScript(stub);
          process.env.TS_NODE_TRANSPILE_ONLY = '1'; // 替身在临时工程里，无 tsconfig
          process.argv = [
            'node', 'goal-supervise.ts', '--feature', 'bc-openCard',
            '--run-id', RUN_ID, '--project-root', root,
          ];
          code = await superviseMain();
        } finally {
          process.argv = prevArgv;
          __testing_setRunnerScript(null);
          if (prevTranspile === undefined) delete process.env.TS_NODE_TRANSPILE_ONLY;
          else process.env.TS_NODE_TRANSPILE_ONLY = prevTranspile;
        }
        assert(code === 0, `supervisor 非 dry-run 退出码 ${code}`);

        // 等被拉起的进程真正起来（ts-node 冷启动可能数秒）
        const argvFile = path.join(runDirAbs, 'stub-argv.json');
        const deadline = Date.now() + 60_000;
        while (!fs.existsSync(argvFile) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
        }
        assert(fs.existsSync(argvFile), '被拉起的进程没留下任何痕迹——spawn 这一步是死的');

        const childArgv = JSON.parse(fs.readFileSync(argvFile, 'utf-8')) as string[];
        assert(
          childArgv[childArgv.indexOf('--resume') + 1] === RUN_ID,
          `拉起指令没带对 run：${JSON.stringify(childArgv)}`,
        );
        assert(childArgv[childArgv.indexOf('--feature') + 1] === 'bc-openCard', `feature 未透传：${childArgv}`);
        assert(childArgv.includes('--detach'), `未带 --detach，supervisor 退出会带走 run：${childArgv}`);

        const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
          .map((l) => JSON.parse(l) as Record<string, unknown>);
        const iRestart = lines.findIndex((e) => e.type === 'supervisor_restart');
        const iSpawned = lines.findIndex((e) => e.type === 'supervisor_restart_spawned');
        childPid = typeof lines[iSpawned]?.pid === 'number' ? (lines[iSpawned].pid as number) : null;
        assert(iRestart >= 0, '未记账 supervisor_restart——拉起失败将永远重试，重启预算形同虚设');
        // 本断言只锁「意图事件早于结果事件」。真正的不变量「记账先于 spawn」是**外部不可观测**的
        // ——实测把 append 挪到 spawn 之后本用例照样绿（父进程写得比子进程冷启动快得多）。
        // 那条不变量改由下一个用例从**它存在的理由**入手验：拉起失败也必须已计数。
        assert(iSpawned > iRestart, 'supervisor_restart（意图）晚于 supervisor_restart_spawned（结果）');
        assert(lines[iRestart].restart_seq === 1, `restart_seq 应为 1，实为 ${lines[iRestart].restart_seq}`);
        assert(typeof childPid === 'number', 'spawn 未产出 pid');
        assert(lines.some((e) => e.type === 'stub_runner_started'), '新进程未写入本 run 的事件流');

        // 新 beacon 必须是**新进程**的身份，且立刻可判 alive（对应 runner 取锁即写 beacon）
        const fresh = readLivenessBeacon(root, reportDir);
        assert(fresh !== null, '被拉起的进程没写出 beacon');
        assert(fresh!.proc.pid !== victim.pid, 'beacon 仍是旧进程身份——没被刷新');
        assert(
          assessLivenessBeacon({ beacon: fresh, runId: RUN_ID }).state === 'alive',
          '新 beacon 判不出 alive',
        );

        // 闭环收敛：拉起之后再判一次必须**不再重启**，否则周期任务会踩成重启风暴
        const again = superviseRun({ projectRoot: root, reportDir, runId: RUN_ID, events: lines });
        assert(again.action === 'no_op', `拉起后仍判 ${again.action}——重启风暴：${again.reason}`);
      } finally {
        victim.kill();
        if (childPid !== null) {
          spawnSync('taskkill', ['/PID', String(childPid), '/T', '/F'], { windowsHide: true, timeout: 15_000 });
        }
        cleanup();
      }
    },
  },
  {
    // 「先记账再 spawn」存在的**理由**是：拉起失败也要计数，否则周期任务永远重试同一个 run。
    // 顺序本身外部观测不到，但这条理由可以直接验：让拉起必然失败，看预算有没有真的被消耗。
    name: '拉起失败也已计数：子进程起不来，重启预算照样推进（不会无限重试）',
    run: async () => {
      if (process.platform !== 'win32') return;
      const { root, reportDir, cleanup } = tmpRun();
      const eventsPath = path.join(root, reportDir, 'events.jsonl');
      const victim = await spawnVictim();
      try {
        fs.writeFileSync(
          eventsPath,
          JSON.stringify({ ts: new Date().toISOString(), type: 'run_start' }) + '\n',
          'utf-8',
        );
        writeBeaconFor(root, reportDir, victim.pid);
        victim.kill();
        await new Promise((r) => setTimeout(r, 800));

        const prevArgv = process.argv;
        let code: number;
        try {
          // 指向一个根本不存在的 runner：spawn 在 OS 层成功、子进程随即失败退出
          __testing_setRunnerScript(path.join(root, 'no-such-runner.ts'));
          process.argv = [
            'node', 'goal-supervise.ts', '--feature', 'bc-openCard',
            '--run-id', RUN_ID, '--project-root', root,
          ];
          code = await superviseMain();
        } finally {
          process.argv = prevArgv;
          __testing_setRunnerScript(null);
        }
        assert(code === 0, `supervisor 退出码 ${code}`);

        const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
          .map((l) => JSON.parse(l) as Record<string, unknown>);
        assert(
          lines.some((e) => e.type === 'supervisor_restart' && e.restart_seq === 1),
          '拉起失败就不计数——下一轮又会重来，重启预算永远吃不满，这正是无限重试的形态',
        );

        // beacon 仍是被强杀那个进程的（新进程根本没起来）→ 下一轮必须是**第 2 次**，不是重置回第 1 次
        const next = superviseRun({ projectRoot: root, reportDir, runId: RUN_ID, events: lines });
        assert(next.action === 'resume', `下一轮判 ${next.action}，预期继续 resume`);
        const seq = next.action === 'resume' ? next.restart_seq : -1;
        assert(seq === 2, `重启序号未推进（${seq}）——预算被重置等于没有上限`);
      } finally {
        victim.kill();
        cleanup();
      }
    },
  },
];

export async function runAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const out: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      out.push({ name: testCase.name, ok: true });
    } catch (error) {
      out.push({ name: testCase.name, ok: false, error: (error as Error).message });
    }
  }
  return out;
}
