import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acceptConsumedHandoff,
  consumeHandoffAtBoundary,
  readHandoffRequest,
  writeHandoffRequest,
} from '../../scripts/utils/goal-handoff';
import {
  casAcquireRunOwner,
  ensureRunControl,
  quiesceRunOwner,
  releaseRunOwner,
} from '../../scripts/utils/goal-run-control';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function withRun(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-handoff-'));
  try { run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

interface TestCase { name: string; run: () => void }
const cases: TestCase[] = [
  {
    name: 'requester writes mailbox; owner consumes idempotently',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const owner = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(owner.ok, 'owner');
      if (!owner.ok) return;
      writeHandoffRequest(dir, { request_id: 'q1', run_id: 'r1', from_epoch: 1, target_owner_kind: 'session' });
      assert(consumeHandoffAtBoundary(dir, owner.token).kind === 'consumed', 'consume');
      assert(consumeHandoffAtBoundary(dir, owner.token).kind === 'duplicate', 'duplicate');
    }),
  },
  {
    name: 'stale/wrong-run request never quiesces owner',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const owner = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(owner.ok, 'owner');
      if (!owner.ok) return;
      writeHandoffRequest(dir, { request_id: 'q1', run_id: 'wrong', from_epoch: 1, target_owner_kind: 'session' });
      assert(consumeHandoffAtBoundary(dir, owner.token).kind === 'rejected', 'wrong run rejected');
      assert(readHandoffRequest(dir)?.status === 'rejected', 'auditable rejection');
    }),
  },
  {
    name: 'release/acceptance crash remains quiescent and resumable',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const old = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(old.ok, 'old');
      if (!old.ok) return;
      writeHandoffRequest(dir, { request_id: 'q1', run_id: 'r1', from_epoch: 1, target_owner_kind: 'session' });
      consumeHandoffAtBoundary(dir, old.token);
      quiesceRunOwner(dir, old.token);
      releaseRunOwner(dir, old.token, { allowQuiescing: true });
      assert(readHandoffRequest(dir)?.status === 'consumed', 'no acceptance yet');
    }),
  },
  {
    name: 'new owner must accept before work and epoch is fenced',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const old = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(old.ok, 'old');
      if (!old.ok) return;
      writeHandoffRequest(dir, { request_id: 'q1', run_id: 'r1', from_epoch: 1, target_owner_kind: 'session' });
      consumeHandoffAtBoundary(dir, old.token);
      quiesceRunOwner(dir, old.token);
      releaseRunOwner(dir, old.token, { allowQuiescing: true });
      const next = casAcquireRunOwner(dir, 'r1', 1, { kind: 'session', owner_id: 's2' });
      assert(next.ok, 'next');
      if (!next.ok) return;
      const accepted = acceptConsumedHandoff(dir, next.token, 'session');
      assert(accepted?.status === 'accepted' && accepted.accepted_epoch === 2, 'accepted');
    }),
  },
  {
    name: 'stale consumed mailbox is rejected without bricking a later owner',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const old = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(old.ok, 'old');
      if (!old.ok) return;
      writeHandoffRequest(dir, {
        request_id: 'q1', run_id: 'r1', from_epoch: 1, target_owner_kind: 'process',
      });
      consumeHandoffAtBoundary(dir, old.token);
      releaseRunOwner(dir, old.token);
      const skipped = casAcquireRunOwner(dir, 'r1', 1, { kind: 'process', owner_id: 'p2' });
      assert(skipped.ok, 'epoch2');
      if (!skipped.ok) return;
      releaseRunOwner(dir, skipped.token);
      const later = casAcquireRunOwner(dir, 'r1', 2, { kind: 'process', owner_id: 'p3' });
      assert(later.ok, 'epoch3');
      if (!later.ok) return;
      assert(acceptConsumedHandoff(dir, later.token, 'process') === null, 'stale accept returns null');
      assert(readHandoffRequest(dir)?.rejection_reason === 'stale_consumed_epoch', 'stale cleaned');
    }),
  },
  {
    name: 'expired pending mailbox is replaced by a fresh request',
    run: () => withRun((dir) => {
      writeHandoffRequest(dir, {
        request_id: 'old', run_id: 'r1', from_epoch: 1, target_owner_kind: 'session',
        ttl_ms: 1_000, now_ms: 1_000,
      });
      const fresh = writeHandoffRequest(dir, {
        request_id: 'fresh', run_id: 'r1', from_epoch: 1, target_owner_kind: 'session', now_ms: 3_000,
      });
      assert(fresh.request_id === 'fresh' && fresh.status === 'pending', 'fresh request');
    }),
  },  {
    name: 'target owner kind mismatch cannot accept',
    run: () => withRun((dir) => {
      ensureRunControl(dir, 'r1');
      const old = casAcquireRunOwner(dir, 'r1', 0, { kind: 'process', owner_id: 'p1' });
      assert(old.ok, 'old');
      if (!old.ok) return;
      writeHandoffRequest(dir, { request_id: 'q1', run_id: 'r1', from_epoch: 1, target_owner_kind: 'session' });
      consumeHandoffAtBoundary(dir, old.token);
      quiesceRunOwner(dir, old.token);
      releaseRunOwner(dir, old.token, { allowQuiescing: true });
      const next = casAcquireRunOwner(dir, 'r1', 1, { kind: 'process', owner_id: 'p2' });
      assert(next.ok, 'next');
      if (!next.ok) return;
      assert(acceptConsumedHandoff(dir, next.token, 'process') === null, 'wrong target');
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
