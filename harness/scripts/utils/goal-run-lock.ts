/**
 * Goal run locks — per-feature primary lock + optional per-run-id inner lock.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const FEATURE_LOCK_NAME = '.feature.lock';
export const RUN_LOCK_NAME = '.runner.lock';

/** Must exceed single-phase max timeout (3600s) when using phase-boundary heartbeat fallback. */
export const STALE_LOCK_MS = 90 * 60 * 1000;

export interface LockRecord {
  ownerId: string;
  pid: number;
  hostname: string;
  started_at: string;
  updated_at: string;
  run_id?: string;
}

export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM on POSIX means process exists but we lack signal permission.
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

export function readLockRecord(lockPath: string): LockRecord | null {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as LockRecord;
  } catch {
    return null;
  }
}

export function isLockStale(record: LockRecord, staleMs: number = STALE_LOCK_MS): boolean {
  const updated = new Date(record.updated_at).getTime();
  if (Number.isNaN(updated)) return true;
  const age = Date.now() - updated;
  return age > staleMs && !isPidAlive(record.pid);
}

function writeLockFile(lockPath: string, record: LockRecord): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = fs.openSync(lockPath, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

const MAX_LOCK_ACQUIRE_ATTEMPTS = 3;

function removeCorruptLock(lockPath: string): void {
  if (!fs.existsSync(lockPath)) return;
  const corruptPath = `${lockPath}.corrupt.${Date.now()}`;
  try {
    fs.renameSync(lockPath, corruptPath);
  } catch {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* best-effort */
    }
  }
}

export function tryAcquireLock(
  lockPath: string,
  partial: Omit<LockRecord, 'ownerId' | 'pid' | 'hostname' | 'started_at' | 'updated_at'> & {
    ownerId?: string;
    pid?: number;
    hostname?: string;
    started_at?: string;
    updated_at?: string;
  },
  staleMs: number = STALE_LOCK_MS,
  attempt: number = 0,
): LockRecord | null {
  if (attempt >= MAX_LOCK_ACQUIRE_ATTEMPTS) return null;

  const now = new Date().toISOString();
  const record: LockRecord = {
    ownerId: partial.ownerId ?? randomUUID(),
    pid: partial.pid ?? process.pid,
    hostname: partial.hostname ?? os.hostname(),
    started_at: partial.started_at ?? now,
    updated_at: partial.updated_at ?? now,
    run_id: partial.run_id,
  };

  try {
    writeLockFile(lockPath, record);
    return record;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }

  const existing = readLockRecord(lockPath);
  if (!existing) {
    if (fs.existsSync(lockPath)) {
      removeCorruptLock(lockPath);
    }
    return tryAcquireLock(lockPath, { ...partial, ownerId: record.ownerId }, staleMs, attempt + 1);
  }

  if (isLockStale(existing, staleMs)) {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      return null;
    }
    return tryAcquireLock(lockPath, { ...partial, ownerId: record.ownerId }, staleMs, attempt + 1);
  }

  if (isPidAlive(existing.pid)) return null;

  try {
    fs.unlinkSync(lockPath);
  } catch {
    return null;
  }
  return tryAcquireLock(lockPath, { ...partial, ownerId: record.ownerId }, staleMs, attempt + 1);
}

export function releaseLock(lockPath: string, ownerId: string): void {
  const existing = readLockRecord(lockPath);
  if (!existing || existing.ownerId !== ownerId) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* best-effort */
  }
}

export function touchLock(lockPath: string, ownerId: string): void {
  const existing = readLockRecord(lockPath);
  if (!existing || existing.ownerId !== ownerId) return;
  existing.updated_at = new Date().toISOString();
  const tmp = `${lockPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, lockPath);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
}

export function formatLockBlocker(lockPath: string, existing: LockRecord | null): string {
  if (!existing) {
    return `[goal-runner] BLOCKER: could not acquire lock ${lockPath} (holder unknown or corrupt)`;
  }
  return (
    `[goal-runner] BLOCKER: another goal-runner holds lock ${lockPath} ` +
    `(pid=${existing.pid}, host=${existing.hostname}, run_id=${existing.run_id ?? '—'}, ` +
    `updated_at=${existing.updated_at})`
  );
}
