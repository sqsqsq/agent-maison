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
