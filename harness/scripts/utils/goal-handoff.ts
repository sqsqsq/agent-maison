import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  assertFencedOwner,
  type RunFenceToken,
  type RunOwnerKind,
} from './goal-run-control';

export const HANDOFF_REQUEST_NAME = 'handoff-request.json';

export interface GoalHandoffRequestV1 {
  schema: 'goal-handoff-request@1';
  request_id: string;
  run_id: string;
  from_epoch: number;
  target_owner_kind: RunOwnerKind;
  requested_at: string;
  expires_at: string;
  status: 'pending' | 'consumed' | 'accepted' | 'rejected';
  consumed_at?: string;
  consumed_by_owner?: string;
  accepted_at?: string;
  accepted_epoch?: number;
  rejection_reason?: string;
}

function mailboxPath(runDir: string): string {
  return path.join(runDir, HANDOFF_REQUEST_NAME);
}

function atomicWrite(filePath: string, value: GoalHandoffRequestV1): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readHandoffRequest(runDir: string): GoalHandoffRequestV1 | null {
  const filePath = mailboxPath(runDir);
  if (!fs.existsSync(filePath)) return null;
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as GoalHandoffRequestV1;
  if (
    value.schema !== 'goal-handoff-request@1' ||
    !value.request_id ||
    !value.run_id ||
    !Number.isInteger(value.from_epoch) ||
    (value.target_owner_kind !== 'process' && value.target_owner_kind !== 'session')
  ) {
    throw new Error('[goal-handoff] mailbox shape invalid');
  }
  return value;
}

/** Requester writes only mailbox state; authoritative events remain owner-authored. */
export function writeHandoffRequest(
  runDir: string,
  input: {
    request_id?: string;
    run_id: string;
    from_epoch: number;
    target_owner_kind: RunOwnerKind;
    ttl_ms?: number;
    now_ms?: number;
  },
): GoalHandoffRequestV1 {
  const existing = readHandoffRequest(runDir);
  const requestId = input.request_id ?? randomUUID();
  if (existing?.request_id === requestId) return existing;
  const now = new Date(input.now_ms ?? Date.now());
  if (existing?.status === 'pending') {
    if (new Date(existing.expires_at).getTime() > now.getTime()) {
      throw new Error('[goal-handoff] pending request already exists');
    }
    atomicWrite(mailboxPath(runDir), {
      ...existing,
      status: 'rejected',
      rejection_reason: 'expired',
    });
  }
  const request: GoalHandoffRequestV1 = {
    schema: 'goal-handoff-request@1',
    request_id: requestId,
    run_id: input.run_id,
    from_epoch: input.from_epoch,
    target_owner_kind: input.target_owner_kind,
    requested_at: now.toISOString(),
    expires_at: new Date(now.getTime() + Math.max(1, input.ttl_ms ?? 10 * 60_000)).toISOString(),
    status: 'pending',
  };
  atomicWrite(mailboxPath(runDir), request);
  return request;
}

export type ConsumeHandoffResult =
  | { kind: 'none' }
  | { kind: 'duplicate'; request: GoalHandoffRequestV1 }
  | { kind: 'rejected'; request: GoalHandoffRequestV1; reason: string }
  | { kind: 'consumed'; request: GoalHandoffRequestV1 };

export function consumeHandoffAtBoundary(
  runDir: string,
  token: RunFenceToken,
  nowMs: number = Date.now(),
): ConsumeHandoffResult {
  assertFencedOwner(runDir, token, 'handoff_poll');
  const request = readHandoffRequest(runDir);
  if (!request) return { kind: 'none' };
  if (request.status !== 'pending') return { kind: 'duplicate', request };
  let reason: string | null = null;
  if (request.run_id !== token.run_id) reason = 'wrong_run';
  else if (request.from_epoch !== token.epoch) reason = 'stale_epoch';
  else if (new Date(request.expires_at).getTime() <= nowMs) reason = 'expired';
  if (reason) {
    const rejected: GoalHandoffRequestV1 = {
      ...request,
      status: 'rejected',
      rejection_reason: reason,
    };
    atomicWrite(mailboxPath(runDir), rejected);
    return { kind: 'rejected', request: rejected, reason };
  }
  const consumed: GoalHandoffRequestV1 = {
    ...request,
    status: 'consumed',
    consumed_at: new Date(nowMs).toISOString(),
    consumed_by_owner: token.owner_id,
  };
  atomicWrite(mailboxPath(runDir), consumed);
  return { kind: 'consumed', request: consumed };
}

export function acceptConsumedHandoff(
  runDir: string,
  token: RunFenceToken,
  ownerKind: RunOwnerKind,
): GoalHandoffRequestV1 | null {
  assertFencedOwner(runDir, token, 'handoff_accept');
  const request = readHandoffRequest(runDir);
  if (!request || request.status === 'accepted') return null;
  if (request.status !== 'consumed' || request.target_owner_kind !== ownerKind) return null;
  if (token.epoch !== request.from_epoch + 1) {
    atomicWrite(mailboxPath(runDir), {
      ...request,
      status: 'rejected',
      rejection_reason: 'stale_consumed_epoch',
    });
    return null;
  }
  const accepted: GoalHandoffRequestV1 = {
    ...request,
    status: 'accepted',
    accepted_at: new Date().toISOString(),
    accepted_epoch: token.epoch,
  };
  atomicWrite(mailboxPath(runDir), accepted);
  return accepted;
}
