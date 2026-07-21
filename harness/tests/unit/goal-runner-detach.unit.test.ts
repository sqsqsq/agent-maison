// goal-runner-detach.unit.test.ts — `--detach` launcher argv/run-id + orphan guard

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildDetachedChildArgv,
  evaluateForegroundSurvival,
  resolveOrphanedIncompleteRun,
} from '../../scripts/goal-runner';
import { newRunId } from '../../scripts/utils/goal-manifest';
import { FEATURE_LOCK_NAME } from '../../scripts/utils/goal-run-lock';
import type { UnitCaseResult } from '../run-unit';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkFeatureRunsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goal-orphan-'));
}

function writeFeatureLock(dir: string, rec: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FEATURE_LOCK_NAME), JSON.stringify(rec), 'utf-8');
}

function writeRunEvents(dir: string, runId: string, events: Array<Record<string, unknown>>): void {
  const runDir = path.join(dir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8',
  );
}

/** Stale-by-heartbeat lock: same host + alive pid + very old updated_at. */
function staleLock(runId: string): Record<string, unknown> {
  const old = new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(); // 4h ago > 90m TTL
  return {
    ownerId: 'o1',
    pid: process.pid,
    hostname: os.hostname(),
    started_at: old,
    updated_at: old,
    run_id: runId,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'buildDetachedChildArgv: fresh run drops --detach, adds --detached-child + --run-id',
    run: () => {
      const raw = ['--feature', 'bc', '--requirement', 'x', '--adapter', 'chrys', '--detach'];
      const out = buildDetachedChildArgv(raw, '20260101T000000Z', { resume: false });
      assert(!out.includes('--detach'), out.join(' '));
      assert(out.includes('--detached-child'), out.join(' '));
      const i = out.indexOf('--run-id');
      assert(i >= 0 && out[i + 1] === '20260101T000000Z', out.join(' '));
      // original args preserved
      assert(out.includes('--feature') && out[out.indexOf('--feature') + 1] === 'bc', out.join(' '));
      assert(out.includes('--adapter') && out[out.indexOf('--adapter') + 1] === 'chrys', out.join(' '));
    },
  },
  {
    name: 'buildDetachedChildArgv: resume run does NOT add --run-id (id carried by --resume)',
    run: () => {
      const raw = ['--resume', '20260101T010101Z', '--feature', 'bc', '--detach', '--force-resume'];
      const out = buildDetachedChildArgv(raw, '20260101T010101Z', { resume: true });
      assert(!out.includes('--detach'), out.join(' '));
      assert(out.includes('--detached-child'), out.join(' '));
      assert(!out.includes('--run-id'), `resume must not inject --run-id: ${out.join(' ')}`);
      assert(out.includes('--resume') && out[out.indexOf('--resume') + 1] === '20260101T010101Z', out.join(' '));
      assert(out.includes('--force-resume'), out.join(' '));
    },
  },
  {
    name: 'buildDetachedChildArgv: pre-existing --run-id is replaced canonically',
    run: () => {
      const raw = ['--feature', 'bc', '--run-id', 'STALE', '--detach'];
      const out = buildDetachedChildArgv(raw, 'CANON', { resume: false });
      const occurrences = out.filter((a) => a === '--run-id').length;
      assert(occurrences === 1, `exactly one --run-id expected: ${out.join(' ')}`);
      assert(!out.includes('STALE'), `stale run-id value must be dropped: ${out.join(' ')}`);
      assert(out[out.indexOf('--run-id') + 1] === 'CANON', out.join(' '));
    },
  },
  {
    name: 'newRunId: 时间戳+6hex 随机后缀（六轮 P1：同秒跨工程不碰撞）',
    run: () => {
      const id = newRunId();
      assert(/^\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(id), `unexpected run_id format: ${id}`);
      assert(newRunId() !== newRunId() || newRunId() !== id, '随机后缀应使同秒生成互异');
    },
  },
  {
    name: 'resolveOrphanedIncompleteRun: no feature.lock → null (clean fresh start)',
    run: () => {
      const dir = mkFeatureRunsDir();
      try {
        assert(resolveOrphanedIncompleteRun(dir) === null, 'expected null');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveOrphanedIncompleteRun: stale lock + incomplete run → guides resume',
    run: () => {
      const dir = mkFeatureRunsDir();
      try {
        const runId = '20260101T000000Z';
        writeFeatureLock(dir, staleLock(runId));
        writeRunEvents(dir, runId, [
          { type: 'run_start' },
          { type: 'phase_start', phase: 'spec' },
        ]); // no run_end → incomplete
        const r = resolveOrphanedIncompleteRun(dir);
        assert(r !== null && r.runId === runId, JSON.stringify(r));
        assert(typeof r!.reason === 'string' && r!.reason.length > 0, 'reason expected');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveOrphanedIncompleteRun: stale lock + COMPLETED run → null (leftover lock only)',
    run: () => {
      const dir = mkFeatureRunsDir();
      try {
        const runId = '20260101T010101Z';
        writeFeatureLock(dir, staleLock(runId));
        writeRunEvents(dir, runId, [
          { type: 'run_start' },
          { type: 'run_end', status: 'COMPLETED' },
        ]);
        assert(resolveOrphanedIncompleteRun(dir) === null, 'completed run must not block fresh start');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveOrphanedIncompleteRun: fresh/live lock → null (acquireGoalLocks handles)',
    run: () => {
      const dir = mkFeatureRunsDir();
      try {
        const now = new Date().toISOString();
        writeFeatureLock(dir, {
          ownerId: 'o1', pid: process.pid, hostname: os.hostname(),
          started_at: now, updated_at: now, run_id: '20260101T020202Z',
        });
        assert(resolveOrphanedIncompleteRun(dir) === null, 'live lock must not trigger orphan guard');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateForegroundSurvival: blocks foreground unattended run without --detach',
    run: () => {
      const ev = evaluateForegroundSurvival;
      // OS-detached child and dry-run are always fine
      assert(ev({ detachedChild: true, dryRun: false, foregroundOk: false, approvalMode: 'never' }) === 'ok', 'detached child → ok');
      assert(ev({ detachedChild: false, dryRun: true, foregroundOk: false, approvalMode: 'never' }) === 'ok', 'dry-run → ok');
      // real unattended (approval_mode=never) foreground without --detach → block
      assert(ev({ detachedChild: false, dryRun: false, foregroundOk: false, approvalMode: 'never' }) === 'block', 'foreground never → block');
      // --foreground-ok downgrades the block to a warning
      assert(ev({ detachedChild: false, dryRun: false, foregroundOk: true, approvalMode: 'never' }) === 'warn', 'foreground-ok → warn');
      // non-never (interactive) foreground is not blocked
      assert(ev({ detachedChild: false, dryRun: false, foregroundOk: false, approvalMode: 'on-request' }) === 'ok', 'on-request → ok');
      assert(ev({ detachedChild: false, dryRun: false, foregroundOk: false, approvalMode: undefined }) === 'ok', 'undefined approval → ok');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).message };
    }
  });
}
