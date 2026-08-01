import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertFencedOwner,
  casAcquireRunOwner,
  ensureRunControl,
  forceTakeoverRunOwner,
  markExpiredSessionOrphaned,
  quiesceRunOwner,
  readRunControl,
  releaseRunOwner,
  renewSessionLease,
} from '../../scripts/utils/goal-run-control';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function withRun(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-run-control-'));
  try { run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

interface TestCase { name: string; run: () => void }
const cases: TestCase[] = [
  {
    name: 'epoch persists after projection release',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const acquired = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(acquired.ok, 'acquire');
      if (!acquired.ok) return;
      releaseRunOwner(dir, acquired.token);
      assert(readRunControl(dir, 'r1')?.current_epoch === 1, 'epoch must persist');
    }),
  },
  {
    name: 'two CAS takeovers from one epoch yield one winner',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const first = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      const second = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p2' });
      assert(first.ok && !second.ok, 'exactly one winner');
    }),
  },
  {
    name: 'expired session becomes orphaned and needs explicit takeover',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const acquired = casAcquireRunOwner(dir, 'r1', 0, { kind: 'session', owner_id: 's1', lease_ms: 1 });
      assert(acquired.ok, 'session acquire');
      if (!acquired.ok) return;
      markExpiredSessionOrphaned(dir, 'r1', Date.now() + 10);
      const control = readRunControl(dir, 'r1')!;
      assert(control.owner?.state === 'orphaned_session', 'orphan state');
      const takeover = forceTakeoverRunOwner(dir, 'r1', 1, { kind: 'session', owner_id: 's2' });
      assert(takeover.token.epoch === 2, 'takeover increments epoch');
    }),
  },
  {
    name: 'orphaned session cannot start through ordinary CAS without explicit takeover',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const acquired = casAcquireRunOwner(dir, 'r1', 0, {
        kind: 'session', owner_id: 's1', lease_ms: 1,
      });
      assert(acquired.ok, 'session acquire');
      if (!acquired.ok) return;
      markExpiredSessionOrphaned(dir, 'r1', Date.now() + 10);
      const ordinary = casAcquireRunOwner(dir, 'r1', 1, { kind: 'process', owner_id: 'p2' });
      assert(!ordinary.ok, 'ordinary CAS must not grant orphan takeover');
      assert(ordinary.control.owner?.state === 'orphaned_session', 'orphan state retained');
    }),
  },
  {
    name: 'dead quiescing process owner is reclaimable',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const acquired = casAcquireRunOwner(dir, 'r1', 0, {
        kind: 'process', owner_id: 'dead-process', pid: 999999, hostname: os.hostname(),
      });
      assert(acquired.ok, 'dead process acquire');
      if (!acquired.ok) return;
      quiesceRunOwner(dir, acquired.token);
      const ordinary = casAcquireRunOwner(dir, 'r1', 1, { kind: 'process', owner_id: 'replacement' });
      assert(ordinary.ok, 'dead quiescing process must not block ordinary CAS');
      if (!ordinary.ok) return;
      assert(ordinary.token.epoch === 2, 'reclaimed epoch');
    }),
  },  {
    name: 'stale run-control mutex is recovered',
    run: () => withRun((dir) => {
      const mutex = path.join(dir, '.run-control.mutex');
      fs.writeFileSync(mutex, 'stale', 'utf8');
      const old = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(mutex, old, old);
      assert(ensureRunControl(dir, 'r1').run_id === 'r1', 'stale mutex recovery');
    }),
  },  {
    name: 'old owner is fenced after takeover',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const first = casAcquireRunOwner(dir, 'r1', 0, { kind: 'session', owner_id: 's1', lease_ms: 1 });
      assert(first.ok, 'first');
      if (!first.ok) return;
      markExpiredSessionOrphaned(dir, 'r1', Date.now() + 10);
      forceTakeoverRunOwner(dir, 'r1', 1, { kind: 'process', owner_id: 'p2' });
      let rejected = false;
      try { assertFencedOwner(dir, first.token, 'phase_invoke'); } catch { rejected = true; }
      assert(rejected, 'stale owner must be rejected');
    }),
  },
  {
    name: 'session lease renewal retains epoch and ownership',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const acquired = casAcquireRunOwner(dir, 'r1', 0, { kind: 'session', owner_id: 's1', lease_ms: 10 });
      assert(acquired.ok, 'acquire');
      if (!acquired.ok) return;
      const renewed = renewSessionLease(dir, acquired.token, 60_000);
      assert(renewed.current_epoch === 1 && renewed.owner?.owner_id === 's1', 'renew');
    }),
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
