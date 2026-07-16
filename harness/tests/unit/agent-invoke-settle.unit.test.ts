// agent-invoke-settle.unit.test.ts — exit-first child settlement + pipe inheritance integration

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import {
  createChildSettleWaiter,
  DEFAULT_CHILD_SETTLE_GRACE_MS,
  DEFAULT_FORCE_SETTLE_AFTER_KILL_MS,
  normalizeChildExitCode,
  awaitPromiseWithTimeout,
  killProcessTree,
  probeAdapterVersion,
} from '../../scripts/utils/agent-invoke';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function fakeChild(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'normalizeChildExitCode: null code with signal → 1',
    run: () => {
      assert(normalizeChildExitCode(null, 'SIGTERM') === 1, 'signal exit');
      assert(normalizeChildExitCode(0, null) === 0, 'zero');
      assert(normalizeChildExitCode(2, null) === 2, 'nonzero');
    },
  },
  {
    name: 'createChildSettleWaiter: exit without close resolves after grace with lingering_pipe',
    run: async () => {
      const child = fakeChild();
      const { promise } = createChildSettleWaiter(child, { graceMs: 50 });
      child.emit('exit', 0, null);
      const settled = await promise;
      assert(settled.exitCode === 0, `exitCode ${settled.exitCode}`);
      assert(settled.lingering_pipe === true, 'lingering_pipe');
    },
  },
  {
    name: 'createChildSettleWaiter: close resolves immediately without lingering_pipe',
    run: async () => {
      const child = fakeChild();
      const { promise } = createChildSettleWaiter(child, { graceMs: 5000 });
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      const settled = await promise;
      assert(settled.exitCode === 0, 'exitCode');
      assert(settled.lingering_pipe === false, 'no lingering');
    },
  },
  {
    name: 'createChildSettleWaiter: error resolves with exit 1',
    run: async () => {
      const child = fakeChild();
      const { promise } = createChildSettleWaiter(child, { graceMs: 50 });
      child.emit('error', new Error('spawn fail'));
      const settled = await promise;
      assert(settled.exitCode === 1, 'exitCode');
    },
  },
  {
    name: 'createChildSettleWaiter: armForceSettleAfterKill resolves when no exit/close',
    run: async () => {
      const child = fakeChild();
      const { promise, armForceSettleAfterKill } = createChildSettleWaiter(child, {
        graceMs: 60_000,
        forceSettleAfterKillMs: 50,
      });
      armForceSettleAfterKill();
      const settled = await promise;
      assert(settled.lingering_pipe === true, 'forced lingering');
      assert(settled.exitCode === 1, 'default exit');
    },
  },
  {
    name: 'awaitPromiseWithTimeout: resolves fallback when promise is slow',
    run: async () => {
      const v = await awaitPromiseWithTimeout(
        new Promise<number>((r) => setTimeout(() => r(42), 500)),
        30,
        -1,
      );
      assert(v === -1, `expected fallback, got ${v}`);
    },
  },
  {
    name: 'awaitPromiseWithTimeout: returns promise result when fast',
    run: async () => {
      const v = await awaitPromiseWithTimeout(Promise.resolve(7), 500, -1);
      assert(v === 7, `expected 7, got ${v}`);
    },
  },
  {
    name: 'integration: detached inherit grandchild — exit+grace resolves without hanging',
    run: async () => {
      if (process.platform === 'win32') {
        // Same semantics on Windows; run with short grace.
      }
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-settle-test-'));
      const heartbeatPath = path.join(workDir, 'heartbeat.txt');
      const pidPath = path.join(workDir, 'heartbeat.pid');
      const parentScript = `
        const { spawn } = require('child_process');
        const fs = require('fs');
        const hb = process.argv[1];
        const pidFile = process.argv[2];
        const grand = spawn(process.execPath, ['-e', \`
          const fs = require('fs');
          const p = process.argv[1];
          const pf = process.argv[2];
          try { fs.writeFileSync(pf, String(process.pid)); } catch {}
          setInterval(() => { try { fs.writeFileSync(p, String(Date.now())); } catch {} }, 20);
          setTimeout(() => {
            try { fs.unlinkSync(p); } catch {}
            try { fs.unlinkSync(pf); } catch {}
            process.exit(0);
          }, 5000);
        \`, hb, pidFile], { stdio: 'inherit', detached: true, windowsHide: true });
        grand.unref();
        setTimeout(() => process.exit(0), 30);
      `;
      const child = spawn(process.execPath, ['-e', parentScript, heartbeatPath, pidPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      try {
        const { promise } = createChildSettleWaiter(child, { graceMs: 200 });
        const start = Date.now();
        const settled = await promise;
        const elapsed = Date.now() - start;
        assert(elapsed < 5000, `should not hang: ${elapsed}ms`);
        assert(settled.lingering_pipe === true, 'pipe held by detached grandchild');
        assert(settled.exitCode === 0, 'parent exit 0');
        await new Promise((r) => setTimeout(r, 100));
        assert(fs.existsSync(heartbeatPath), 'grandchild alive during grace');
      } finally {
        let grandPid = 0;
        try {
          if (fs.existsSync(pidPath)) {
            grandPid = Number.parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
            if (grandPid > 0) {
              await killProcessTree(grandPid);
              for (let i = 0; i < 25; i++) {
                try {
                  process.kill(grandPid, 0);
                } catch {
                  grandPid = 0;
                  break;
                }
                await new Promise((r) => setTimeout(r, 20));
              }
            }
          }
        } catch {
          /* best-effort */
        }
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL');
          } catch {
            /* already dead */
          }
        }
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
  },
  // ==========================================================================
  // P0-4（plan d9b4f7e2 rev5/rev6）：bounded Windows tree-kill
  // ==========================================================================
  {
    name: 'P0-4 bounded kill: taskkill 永不退出 stub → 按时返回 kill_process_tree_timeout 且 helper 被结束/释放',
    run: async () => {
      const calls = { killed: 0, destroyed: 0, unref: 0, listenersRemoved: 0 };
      // 永不调用 callback 的 fake helper——模拟卡死的 taskkill。
      const fakeHelper = Object.assign(new EventEmitter(), {
        kill: () => {
          calls.killed++;
          return true;
        },
        unref: () => {
          calls.unref++;
        },
        stdout: { destroy: () => calls.destroyed++ },
        stderr: { destroy: () => calls.destroyed++ },
        stdin: { destroy: () => calls.destroyed++ },
      });
      const origRemove = fakeHelper.removeAllListeners.bind(fakeHelper);
      (fakeHelper as unknown as { removeAllListeners: () => unknown }).removeAllListeners = () => {
        calls.listenersRemoved++;
        return origRemove();
      };
      const stubExecFile = ((..._args: unknown[]) =>
        fakeHelper) as unknown as typeof import('child_process').execFile;
      const t0 = Date.now();
      const r = await killProcessTree(123456, {
        execFileImpl: stubExecFile,
        waitMs: 120,
        forceWin32: true,
      });
      const elapsed = Date.now() - t0;
      assert(r.kill_error === 'kill_process_tree_timeout', `expect timeout marker got ${r.kill_error}`);
      assert(r.kill_attempted === true, 'kill_attempted');
      assert(elapsed < 5_000, `bounded：须在 waitMs 量级返回（实际 ${elapsed}ms）`);
      assert(calls.killed >= 1, '超时后必须主动结束 helper（存活 helper 持有 handle 阻止 Node 退出）');
      assert(calls.destroyed >= 3, '超时后必须销毁 helper stdio');
      assert(calls.listenersRemoved >= 1, '超时后必须移除监听');
    },
  },
  {
    // 第四轮复审（codex P2）：probe 超时行为测试——卡死的 --version 须走 bounded
    // tree-kill（win32 shell 壳杀不到孙进程）+ 销毁 stdio/监听，且按时返回 unknown。
    name: 'P0-4 probeAdapterVersion: 卡死的 --version → 按时 unknown + bounded tree-kill + handle 释放',
    run: async () => {
      const calls = { killTree: 0, destroyed: 0, listenersRemoved: 0, unref: 0 };
      const fakeChild = Object.assign(new EventEmitter(), {
        pid: 424242,
        kill: () => true,
        unref: () => {
          calls.unref++;
        },
        stdout: Object.assign(new EventEmitter(), { destroy: () => calls.destroyed++ }),
        stderr: Object.assign(new EventEmitter(), { destroy: () => calls.destroyed++ }),
      });
      const origRemove = fakeChild.removeAllListeners.bind(fakeChild);
      (fakeChild as unknown as { removeAllListeners: () => unknown }).removeAllListeners = () => {
        calls.listenersRemoved++;
        return origRemove();
      };
      const stubSpawn = ((..._args: unknown[]) => fakeChild) as unknown as typeof spawn;
      const t0 = Date.now();
      const v = await probeAdapterVersion('stuck-cli-unit-test', 120, {
        spawnImpl: stubSpawn,
        killTreeImpl: async (pid: number) => {
          calls.killTree++;
          assert(pid === 424242, 'killTree 须收到 probe 子进程 pid');
          return { kill_attempted: true, kill_exit_code: 0, kill_error: null };
        },
        noCache: true,
      });
      assert(v === 'unknown', `expect unknown got ${v}`);
      assert(Date.now() - t0 < 5_000, 'bounded：须在 timeout 量级返回');
      assert(calls.killTree === 1, '超时须走 bounded tree-kill（非 child.kill 壳杀）');
      assert(calls.destroyed >= 2, '超时须销毁 stdout/stderr');
      assert(calls.listenersRemoved >= 1, '超时须移除监听');
    },
  },
  {
    name: 'P0-4 probeAdapterVersion: 正常输出 → 取首行并缓存语义（noCache 隔离验证）',
    run: async () => {
      const mkChild = (): ChildProcess => {
        const c = Object.assign(new EventEmitter(), {
          pid: 1,
          kill: () => true,
          unref: () => undefined,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        }) as unknown as ChildProcess;
        setTimeout(() => {
          (c.stdout as unknown as EventEmitter).emit('data', 'chrys 9.9.9\nextra');
          (c as unknown as EventEmitter).emit('close', 0);
        }, 10);
        return c;
      };
      const stubSpawn = ((..._args: unknown[]) => mkChild()) as unknown as typeof spawn;
      const v = await probeAdapterVersion('ok-cli-unit-test', 3_000, {
        spawnImpl: stubSpawn,
        noCache: true,
      });
      assert(v === 'chrys 9.9.9', `expect first line got ${v}`);
    },
  },
  {
    name: 'P0-4 bounded kill: helper 正常退出 → 回传其 exit code、不触发 timeout 标记',
    run: async () => {
      const fakeHelper = Object.assign(new EventEmitter(), {
        kill: () => true,
        unref: () => undefined,
        stdout: { destroy: () => undefined },
        stderr: { destroy: () => undefined },
        stdin: { destroy: () => undefined },
      });
      const stubExecFile = ((...args: unknown[]) => {
        const cb = args[args.length - 1] as (e: Error | null, so: string, se: string) => void;
        setTimeout(() => cb(null, 'SUCCESS', ''), 10);
        return fakeHelper;
      }) as unknown as typeof import('child_process').execFile;
      const r = await killProcessTree(123456, {
        execFileImpl: stubExecFile,
        waitMs: 5_000,
        forceWin32: true,
      });
      assert(r.kill_exit_code === 0, `expect 0 got ${r.kill_exit_code}`);
      assert(r.kill_error === null, `expect no error got ${r.kill_error}`);
    },
  },
];

export async function runAgentInvokeSettleUnitTests(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

export function runAll(): UnitCaseResult[] | Promise<UnitCaseResult[]> {
  return runAgentInvokeSettleUnitTests();
}
