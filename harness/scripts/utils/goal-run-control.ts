import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const RUN_CONTROL_NAME = 'run-control.json';
const CONTROL_MUTEX_NAME = '.run-control.mutex';

export type RunOwnerKind = 'process' | 'session';
export type RunOwnerState = 'active' | 'quiescing' | 'released' | 'orphaned_session';

export interface RunControlOwner {
  kind: RunOwnerKind;
  owner_id: string;
  epoch: number;
  state: RunOwnerState;
  pid?: number;
  hostname?: string;
  lease_expires_at?: string;
}

export interface RunControlV1 {
  schema: 'run-control@1';
  run_id: string;
  current_epoch: number;
  owner: RunControlOwner | null;
  updated_at: string;
}

export interface RunFenceToken {
  run_id: string;
  owner_id: string;
  epoch: number;
}

export interface AcquireOwnerInput {
  kind: RunOwnerKind;
  owner_id: string;
  pid?: number;
  hostname?: string;
  lease_ms?: number;
}

function controlPath(runDir: string): string {
  return path.join(runDir, RUN_CONTROL_NAME);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function withControlMutex<T>(runDir: string, operation: () => T): T {
  fs.mkdirSync(runDir, { recursive: true });
  const mutexPath = path.join(runDir, CONTROL_MUTEX_NAME);
  let fd: number;
  const acquire = (): number => fs.openSync(mutexPath, 'wx');
  try {
    fd = acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const stat = fs.statSync(mutexPath);
      stale = Date.now() - stat.mtimeMs > 5 * 60_000;
    } catch {
      stale = true;
    }
    if (!stale) throw new Error('[goal-run-control] control mutex busy');
    try { fs.unlinkSync(mutexPath); } catch { /* another contender may recover it */ }
    try { fd = acquire(); } catch { throw new Error('[goal-run-control] control mutex busy'); }
  }
  try {
    return operation();
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(mutexPath); } catch { /* best effort */ }
  }
}

function validateControl(value: unknown, expectedRunId?: string): RunControlV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[goal-run-control] run-control 根节点非法');
  }
  const record = value as Partial<RunControlV1>;
  if (
    record.schema !== 'run-control@1' ||
    typeof record.run_id !== 'string' ||
    !Number.isInteger(record.current_epoch) ||
    (record.current_epoch ?? -1) < 0 ||
    typeof record.updated_at !== 'string'
  ) {
    throw new Error('[goal-run-control] run-control 字段非法');
  }
  if (expectedRunId && record.run_id !== expectedRunId) {
    throw new Error('[goal-run-control] run_id mismatch');
  }
  if (record.owner !== null && record.owner !== undefined) {
    const owner = record.owner as RunControlOwner;
    if (
      (owner.kind !== 'process' && owner.kind !== 'session') ||
      !owner.owner_id ||
      !Number.isInteger(owner.epoch) ||
      owner.epoch !== record.current_epoch ||
      !['active', 'quiescing', 'released', 'orphaned_session'].includes(owner.state)
    ) {
      throw new Error('[goal-run-control] owner/epoch 字段非法');
    }
  }
  return record as RunControlV1;
}

export function readRunControl(runDir: string, expectedRunId?: string): RunControlV1 | null {
  const filePath = controlPath(runDir);
  if (!fs.existsSync(filePath)) return null;
  return validateControl(JSON.parse(fs.readFileSync(filePath, 'utf8')), expectedRunId);
}

function isDeadLocalProcessOwner(owner: RunControlOwner | null | undefined): boolean {
  return (
    owner?.kind === 'process' &&
    (owner.state === 'active' || owner.state === 'quiescing') &&
    owner.hostname === os.hostname() &&
    typeof owner.pid === 'number' &&
    (() => {
      try { process.kill(owner.pid!, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code !== 'EPERM'; }
    })()
  );
}

export function ensureRunControl(runDir: string, runId: string): RunControlV1 {
  return withControlMutex(runDir, () => {
    const existing = readRunControl(runDir, runId);
    if (existing) return existing;
    const control: RunControlV1 = {
      schema: 'run-control@1',
      run_id: runId,
      current_epoch: 0,
      owner: null,
      updated_at: new Date().toISOString(),
    };
    atomicWriteJson(controlPath(runDir), control);
    return control;
  });
}

export function casAcquireRunOwner(
  runDir: string,
  runId: string,
  expectedEpoch: number,
  input: AcquireOwnerInput,
): { ok: true; control: RunControlV1; token: RunFenceToken } | { ok: false; control: RunControlV1 } {
  return withControlMutex(runDir, () => {
    const current = readRunControl(runDir, runId);
    if (!current) throw new Error('[goal-run-control] run-control 尚未初始化');
    if (current.current_epoch !== expectedEpoch) return { ok: false, control: current };
    const existingOwner = current.owner;
    if (
      existingOwner?.kind === 'session' &&
      existingOwner.state === 'active' &&
      existingOwner.lease_expires_at &&
      new Date(existingOwner.lease_expires_at).getTime() <= Date.now()
    ) {
      const orphaned: RunControlV1 = {
        ...current,
        owner: { ...existingOwner, state: 'orphaned_session' },
        updated_at: new Date().toISOString(),
      };
      atomicWriteJson(controlPath(runDir), orphaned);
      return { ok: false, control: orphaned };
    }
    if (existingOwner?.state === 'orphaned_session') {
      return { ok: false, control: current };
    }
    const deadLocalProcess = isDeadLocalProcessOwner(existingOwner);
    if (
      ((existingOwner?.state === 'active' || existingOwner?.state === 'quiescing') && !deadLocalProcess)
    ) {
      return { ok: false, control: current };
    }
    const epoch = expectedEpoch + 1;
    const now = new Date();
    const owner: RunControlOwner = {
      kind: input.kind,
      owner_id: input.owner_id,
      epoch,
      state: 'active',
      ...(input.kind === 'process'
        ? { pid: input.pid ?? process.pid, hostname: input.hostname ?? os.hostname() }
        : { lease_expires_at: new Date(now.getTime() + Math.max(1, input.lease_ms ?? 60_000)).toISOString() }),
    };
    const next: RunControlV1 = {
      ...current,
      current_epoch: epoch,
      owner,
      updated_at: now.toISOString(),
    };
    atomicWriteJson(controlPath(runDir), next);
    return {
      ok: true,
      control: next,
      token: { run_id: runId, owner_id: input.owner_id, epoch },
    };
  });
}

export function assertFencedOwner(
  runDir: string,
  token: RunFenceToken,
  boundary: string,
): RunControlV1 {
  const control = readRunControl(runDir, token.run_id);
  if (
    !control ||
    control.current_epoch !== token.epoch ||
    control.owner?.owner_id !== token.owner_id ||
    control.owner.epoch !== token.epoch ||
    control.owner.state !== 'active'
  ) {
    throw new Error(`[goal-run-control] stale owner rejected at ${boundary}`);
  }
  return control;
}

export function renewSessionLease(
  runDir: string,
  token: RunFenceToken,
  leaseMs: number,
): RunControlV1 {
  return withControlMutex(runDir, () => {
    const control = assertFencedOwner(runDir, token, 'session_lease_renew');
    if (control.owner?.kind !== 'session') throw new Error('[goal-run-control] owner 不是 session');
    const next: RunControlV1 = {
      ...control,
      owner: {
        ...control.owner,
        lease_expires_at: new Date(Date.now() + Math.max(1, leaseMs)).toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    atomicWriteJson(controlPath(runDir), next);
    return next;
  });
}

export function markExpiredSessionOrphaned(
  runDir: string,
  runId: string,
  nowMs: number = Date.now(),
): RunControlV1 {
  return withControlMutex(runDir, () => {
    const control = readRunControl(runDir, runId);
    if (!control) throw new Error('[goal-run-control] run-control 尚未初始化');
    const owner = control.owner;
    if (
      owner?.kind !== 'session' ||
      owner.state !== 'active' ||
      !owner.lease_expires_at ||
      new Date(owner.lease_expires_at).getTime() > nowMs
    ) {
      return control;
    }
    const next: RunControlV1 = {
      ...control,
      owner: { ...owner, state: 'orphaned_session' },
      updated_at: new Date(nowMs).toISOString(),
    };
    atomicWriteJson(controlPath(runDir), next);
    return next;
  });
}

export function quiesceRunOwner(runDir: string, token: RunFenceToken): RunControlV1 {
  return withControlMutex(runDir, () => {
    const control = assertFencedOwner(runDir, token, 'quiesce');
    const next: RunControlV1 = {
      ...control,
      owner: { ...control.owner!, state: 'quiescing' },
      updated_at: new Date().toISOString(),
    };
    atomicWriteJson(controlPath(runDir), next);
    return next;
  });
}

export function releaseRunOwner(
  runDir: string,
  token: RunFenceToken,
  options: { allowQuiescing?: boolean } = {},
): RunControlV1 {
  return withControlMutex(runDir, () => {
    const control = readRunControl(runDir, token.run_id);
    const validState = control?.owner?.state === 'active' ||
      (options.allowQuiescing && control?.owner?.state === 'quiescing');
    if (
      !control ||
      control.current_epoch !== token.epoch ||
      control.owner?.owner_id !== token.owner_id ||
      !validState
    ) {
      throw new Error('[goal-run-control] stale owner rejected at release');
    }
    const next: RunControlV1 = {
      ...control,
      owner: { ...control.owner, state: 'released' },
      updated_at: new Date().toISOString(),
    };
    atomicWriteJson(controlPath(runDir), next);
    return next;
  });
}

/** Explicit user-authorized takeover; expiry alone never calls this. */
export function forceTakeoverRunOwner(
  runDir: string,
  runId: string,
  expectedEpoch: number,
  input: AcquireOwnerInput,
): { control: RunControlV1; token: RunFenceToken } {
  return withControlMutex(runDir, () => {
    const current = readRunControl(runDir, runId);
    if (!current || current.current_epoch !== expectedEpoch) {
      throw new Error('[goal-run-control] takeover CAS epoch mismatch');
    }
    if (
      (current.owner?.state === 'active' || current.owner?.state === 'quiescing') &&
      !isDeadLocalProcessOwner(current.owner)
    ) {
      throw new Error('[goal-run-control] active owner takeover requires prior cooperative release');
    }
    const epoch = expectedEpoch + 1;
    const now = new Date();
    const owner: RunControlOwner = {
      kind: input.kind,
      owner_id: input.owner_id,
      epoch,
      state: 'active',
      ...(input.kind === 'process'
        ? { pid: input.pid ?? process.pid, hostname: input.hostname ?? os.hostname() }
        : { lease_expires_at: new Date(now.getTime() + Math.max(1, input.lease_ms ?? 60_000)).toISOString() }),
    };
    const next: RunControlV1 = { ...current, current_epoch: epoch, owner, updated_at: now.toISOString() };
    atomicWriteJson(controlPath(runDir), next);
    return { control: next, token: { run_id: runId, owner_id: input.owner_id, epoch } };
  });
}
