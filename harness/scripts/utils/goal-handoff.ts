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

export interface HandoffMailboxQuarantine {
  original_file: string;
  quarantined_file: string | null;
  reason: 'invalid_json' | 'invalid_shape';
}

export interface ReadHandoffRequestOptions {
  now_ms?: number;
  on_quarantined?: (notice: HandoffMailboxQuarantine) => void;
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

export function isValidHandoffRequest(value: unknown): value is GoalHandoffRequestV1 {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<GoalHandoffRequestV1>;
  const commonValid = request.schema === 'goal-handoff-request@1' &&
    typeof request.request_id === 'string' && request.request_id.length > 0 &&
    typeof request.run_id === 'string' && request.run_id.length > 0 &&
    Number.isInteger(request.from_epoch) && Number(request.from_epoch) >= 0 &&
    (request.target_owner_kind === 'process' || request.target_owner_kind === 'session') &&
    typeof request.requested_at === 'string' && Number.isFinite(new Date(request.requested_at).getTime()) &&
    typeof request.expires_at === 'string' && Number.isFinite(new Date(request.expires_at).getTime()) &&
    (request.status === 'pending' || request.status === 'consumed' ||
      request.status === 'accepted' || request.status === 'rejected');
  if (!commonValid) return false;
  if (request.status === 'pending') return true;
  if (request.status === 'rejected') {
    return typeof request.rejection_reason === 'string' && request.rejection_reason.length > 0;
  }
  const consumedValid =
    typeof request.consumed_at === 'string' && Number.isFinite(new Date(request.consumed_at).getTime()) &&
    typeof request.consumed_by_owner === 'string' && request.consumed_by_owner.length > 0;
  if (!consumedValid || request.status === 'consumed') return consumedValid;
  return typeof request.accepted_at === 'string' && Number.isFinite(new Date(request.accepted_at).getTime()) &&
    Number.isInteger(request.accepted_epoch) && request.accepted_epoch === Number(request.from_epoch) + 1;
}

function quarantineInvalidMailbox(
  filePath: string,
  reason: HandoffMailboxQuarantine['reason'],
  options: ReadHandoffRequestOptions,
): void {
  const stamp = new Date(options.now_ms ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  const parsed = path.parse(filePath);
  let quarantinedFile = path.join(parsed.dir, `${parsed.name}.invalid-${stamp}${parsed.ext}`);
  for (let suffix = 1; fs.existsSync(quarantinedFile); suffix += 1) {
    quarantinedFile = path.join(parsed.dir, `${parsed.name}.invalid-${stamp}-${suffix}${parsed.ext}`);
  }
  let renamedTo: string | null = null;
  try {
    fs.renameSync(filePath, quarantinedFile);
    renamedTo = quarantinedFile;
  } catch {
    // A concurrent owner may have already replaced the mailbox. Never delete the
    // malformed bytes; callers continue with no mailbox and retain the original.
  }
  try {
    options.on_quarantined?.({
      original_file: filePath,
      quarantined_file: renamedTo,
      reason,
    });
  } catch {
    // Quarantine is a recovery path: observer failures must not re-brick a run.
  }
}

export function readHandoffRequest(
  runDir: string,
  options: ReadHandoffRequestOptions = {},
): GoalHandoffRequestV1 | null {
  const filePath = mailboxPath(runDir);
  if (!fs.existsSync(filePath)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    quarantineInvalidMailbox(filePath, 'invalid_json', options);
    return null;
  }
  if (!isValidHandoffRequest(value)) {
    quarantineInvalidMailbox(filePath, 'invalid_shape', options);
    return null;
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
    on_quarantined?: ReadHandoffRequestOptions['on_quarantined'];
  },
): GoalHandoffRequestV1 {
  const existing = readHandoffRequest(runDir, {
    now_ms: input.now_ms,
    on_quarantined: input.on_quarantined,
  });
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
  options: ReadHandoffRequestOptions = {},
): ConsumeHandoffResult {
  assertFencedOwner(runDir, token, 'handoff_poll');
  const request = readHandoffRequest(runDir, { ...options, now_ms: options.now_ms ?? nowMs });
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
