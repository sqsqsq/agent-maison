import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import {
  loadGoalManifestFromRun,
  type GoalManifest,
} from './goal-manifest';
import {
  assertFencedOwner,
  type RunControlV1,
} from './goal-run-control';

export interface AttendedGoalPhaseIdentity {
  runId: string;
  phase: string;
  attemptId: string;
  ownerId: string;
  ownerEpoch: number;
}

export interface AttendedGoalContext {
  manifest: GoalManifest;
  control: RunControlV1;
  runDir: string;
  identity: AttendedGoalPhaseIdentity;
}

/** Validate an explicitly named attended run; callers must invoke before side effects. */
export function validateAttendedGoalContext(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  phase: string;
  attemptId: string;
  ownerId: string;
  ownerEpoch: number;
  nowMs?: number;
}): AttendedGoalContext {
  const feature = input.feature.trim();
  const runId = input.runId.trim();
  const phase = input.phase.trim();
  const attemptId = input.attemptId.trim();
  const ownerId = input.ownerId.trim();
  const ownerEpoch = input.ownerEpoch;
  if (!feature || !runId || !phase || !attemptId || !ownerId || !Number.isInteger(ownerEpoch) || ownerEpoch < 1) {
    throw new Error('[attended-goal-context] feature/run/phase/attempt/owner/epoch 上下文必须完整');
  }
  const config = loadFrameworkConfig(input.projectRoot);
  const featuresDir = (config.paths.features_dir ?? 'doc/features').replace(/\\/g, '/');
  const manifest = loadGoalManifestFromRun(input.projectRoot, runId, { feature, featuresDir });
  if (manifest.feature !== feature || manifest.run_id !== runId) {
    throw new Error('[attended-goal-context] manifest run/feature mismatch');
  }
  const runDir = path.resolve(input.projectRoot, ...manifest.report_dir.split('/'));
  const identity = { runId, phase, attemptId, ownerId, ownerEpoch };
  const control = assertFencedOwner(
    runDir,
    { run_id: runId, owner_id: ownerId, epoch: ownerEpoch },
    `attended_phase:${phase}:${attemptId}`,
  );
  if (!control?.owner) {
    throw new Error('[attended-goal-context] run-control owner 缺失');
  }
  const owner = control.owner;
  if (
    owner.kind !== 'session' ||
    owner.state !== 'active' ||
    owner.epoch !== control.current_epoch ||
    typeof owner.lease_expires_at !== 'string'
  ) {
    throw new Error('[attended-goal-context] 需要当前 session/active owner 与有效 lease');
  }
  const leaseExpiresAt = new Date(owner.lease_expires_at).getTime();
  if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= (input.nowMs ?? Date.now())) {
    throw new Error('[attended-goal-context] session lease 已过期或非法');
  }
  return { manifest, control, runDir, identity };
}
