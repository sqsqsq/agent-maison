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
import { loadEventsJsonlStrict } from './goal-runner-phase';

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
  // plan e7a2c4f1 §3.7（G29）：身份判据一个字不改（它保护的是越权接管）——只把
  // **模式误用**从"租约"话术里分出来。owner.kind 就是这个 run 的真实运行模式：
  // detached run 由 process 持柄，phase 上下文靠 manifest/events 与注入 env 继承，
  // 根本不该传 attended 专用参数；旧文案说"需要有效 lease"，被读成"等一会儿租约就好了"，
  // 于是宿主对着一个模式错误干等（09-18 轮实录）。
  if (owner.kind !== 'session') {
    throw new Error(
      `[attended-goal-context] 模式不匹配：本 run 当前为 ${owner.kind === 'process' ? 'detached' : String(owner.kind)} ` +
      '模式，phase 上下文由 manifest/events 继承，不应传 ' +
      '--goal-run-id/--goal-phase/--goal-attempt-id/--goal-owner-id/--goal-owner-epoch' +
      '（这组参数是 attended 专用）。去掉它们直接跑本阶段 harness 即可；等待租约不会改变结果。',
    );
  }
  if (
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
  const loaded = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl'));
  if (loaded.missing || loaded.corruptLines.length > 0) {
    throw new Error('[attended-goal-context] 当前 session phase_start 签发记录缺失或损坏');
  }
  const issued = [...loaded.events].reverse().find((event) => {
    const row = event as Record<string, unknown>;
    return row.type === 'phase_start' && row.driver === 'session' &&
      row.owner_id === ownerId && row.owner_epoch === ownerEpoch;
  }) as (Record<string, unknown> | undefined);
  if (!issued) {
    throw new Error('[attended-goal-context] 当前 owner fence 未签发 phase_start');
  }
  if (issued.phase !== phase || issued.attempt_id !== attemptId) {
    throw new Error(
      `[attended-goal-context] phase/attempt 未与当前签发记录精确匹配：` +
      `issued=${String(issued.phase)}/${String(issued.attempt_id)} ` +
      `received=${phase}/${attemptId}`,
    );
  }
  return { manifest, control, runDir, identity };
}
