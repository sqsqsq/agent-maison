import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import type { GoalManifest } from './goal-manifest';
import { writeGoalManifest } from './goal-manifest';
import { loadEventsJsonl, type GoalRunEvent } from './goal-runner-phase';
import {
  projectGoalProgress,
  writeProgressSnapshotAtomic,
} from './goal-progress';
import type { WorkflowSpec } from '../../workflow-loader';
import { assertFencedOwner, type RunFenceToken } from './goal-run-control';
import { withRunDisposition } from './adjudication';

export function appendGoalEventFenced(
  projectRoot: string,
  manifest: GoalManifest,
  runDir: string,
  token: RunFenceToken,
  event: Record<string, unknown>,
): void {
  assertFencedOwner(runDir, token, 'in_session_event_append');
  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.appendFileSync(
    eventsPath,
    // d6 t5⓪：**投影注入点之二**——session 路径（goal-mode-entry 的 fused、
    // goal-in-session-driver 的 phase 异常）同样必须落 run_disposition，
    // 否则 supervisor 面对会话侧 halt 无判据可依。
    `${JSON.stringify({ ts: new Date().toISOString(), ...withRunDisposition(event) })}\n`,
    'utf8',
  );
}

export function writeGoalManifestFenced(
  projectRoot: string,
  manifest: GoalManifest,
  runDir: string,
  token: RunFenceToken,
): string {
  assertFencedOwner(runDir, token, 'in_session_manifest_write');
  return writeGoalManifest(manifest, projectRoot);
}

export function writeInSessionProgressFenced(
  projectRoot: string,
  manifest: GoalManifest,
  workflow: WorkflowSpec,
  runDir: string,
  token: RunFenceToken,
): void {
  assertFencedOwner(runDir, token, 'in_session_progress_write');
  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  const events = (fs.existsSync(eventsPath) ? loadEventsJsonl(eventsPath) : []) as GoalRunEvent[];
  // e9d4b7a3 t4（二轮 review P1）：featuresDir 必传——真实来源是 cfg.paths.features_dir
  //（report_dir 反推会多带 feature 段，折叠错路径）。session 模式由 config SSOT 派生。
  const featuresDir = (loadFrameworkConfig(projectRoot).paths?.features_dir ?? 'doc/features')
    .replace(/\\/g, '/');
  const snapshot = projectGoalProgress({
    projectRoot,
    manifest,
    workflow,
    events,
    featureLock: null,
    runnerLock: null,
    liveProbe: false,
    featuresDir,
  });
  writeProgressSnapshotAtomic(projectRoot, manifest.report_dir, snapshot, true);
}

export interface InSessionLoopState {
  schema_version: '1.0';
  started_at_ms: number;
  /** 活跃执行段累计时长；跨宿主桥接间隔不计入预算。 */
  active_elapsed_ms?: number;
  total_rounds: number;
  retries_by_phase: Record<string, number>;
  last_fingerprint: string | null;
  repeated_count: number;
  last_phase: string | null;
  last_status: string | null;
  last_details: string | null;
  fuse_reason: string | null;
  reconcile: unknown;
}

export function readInSessionLoopState(runDir: string): InSessionLoopState | null {
  const file = path.join(runDir, 'session-loop-state.json');
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as InSessionLoopState;
  if (parsed?.schema_version !== '1.0' || !Number.isFinite(parsed.started_at_ms) ||
      (parsed.active_elapsed_ms !== undefined && (!Number.isFinite(parsed.active_elapsed_ms) || parsed.active_elapsed_ms < 0)) ||
      !Number.isFinite(parsed.total_rounds) || !parsed.retries_by_phase) {
    throw new Error('[goal-in-session] session-loop-state.json shape invalid');
  }
  return parsed;
}

export function writeInSessionLoopStateFenced(
  runDir: string,
  token: RunFenceToken,
  state: InSessionLoopState,
): void {
  assertFencedOwner(runDir, token, 'in_session_loop_state_write');
  const file = path.join(runDir, 'session-loop-state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staged = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(staged, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(staged, file);
}