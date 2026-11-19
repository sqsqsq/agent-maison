import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { resolveWorkflowSpec, workflowForExistingRun } from '../../workflow-loader';
import { isInitialDesignManifest, loadGoalRunManifestFromRun, type GoalRunManifest } from './goal-manifest';
import { projectInitialDesignDelivery } from './initial-design-delivery';
import { originalDeliveryForManifest, resolveOriginalDeliveryExecution } from './delivery-origin';
import { deliveryCycleView } from './goal-run-creation';
import { loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';
import { readLockRecord, isPidAlive, FEATURE_LOCK_NAME, RUN_LOCK_NAME, type LockRecord } from './goal-run-lock';
import { buildLiveGoalStatusSnapshot, observeProgressFreshness, resolveFeatureLockPath, resolveRunnerLockPath, SOFT_STALL_MS } from './goal-progress';
import { featureRelativePath } from './feature-identity';

export const DEFAULT_GOAL_WAIT_TIMEOUT_MS = 60 * 60 * 1000;

export interface GoalWaitBinding { projectRoot: string; feature: string; runId: string }
export interface GoalWaitObservation {
  feature: string; run_id: string; status: string; complete: boolean; event_count: number;
  attention: boolean; stopped: boolean; detail?: string;
  snapshot: ReturnType<typeof projectInitialDesignDelivery> | ReturnType<typeof buildLiveGoalStatusSnapshot>;
}
interface WaitCursor { schema: 1; project: string; feature: string; requested_run_id: string; run_id: string; observed_feature?: string; event_count: number; attention?: string }
export interface GoalWaitResult {
  reason: 'stopped' | 'attention' | 'changed' | 'timeout' | 'cancelled' | 'read_error';
  cursor?: string; observed_at: string; elapsed_ms: number; detail?: string; observation?: GoalWaitObservation;
}

export function goalStatusWaitCommand(projectRoot: string, frameworkRoot: string, feature: string, runId: string): string {
  const quote = (value: string): string => process.platform === 'win32'
    ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
  const harness = path.join(frameworkRoot, 'harness');
  return ['node', path.join(harness, 'node_modules/ts-node/dist/bin.js'), '--project', path.join(harness, 'tsconfig.json'),
    path.join(harness, 'scripts/goal-status.ts'), '--project-root', projectRoot, '--feature', feature, '--run-id', runId, '--wait', '--json']
    .map((arg, index) => index === 0 ? arg : quote(arg)).join(' ');
}

export function parseGoalWaitCursor(value: string): WaitCursor {
  const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as WaitCursor;
  if (cursor.schema !== 1 || ![cursor.project, cursor.feature, cursor.requested_run_id, cursor.run_id].every(item => typeof item === 'string' && !!item)
    || !Number.isSafeInteger(cursor.event_count) || cursor.event_count < 0
    || cursor.attention !== undefined && (typeof cursor.attention !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.attention))) throw new Error('[goal-status] invalid --after cursor');
  return cursor;
}

/** A received, live recoverable warning can be acknowledged by the existing stateless cursor. */
function continuableAttention(observation: GoalWaitObservation): string | undefined {
  const snapshot = observation.snapshot;
  if (!observation.attention || !['WAITING_EXTERNAL', 'STALLED'].includes(observation.status) || observation.complete
    || !('liveness' in snapshot) || snapshot.liveness.signals.child_process !== 'alive'
    || snapshot.liveness.state === 'DONE' || snapshot.run_disposition === 'TERMINAL' || snapshot.run_wait_kind === 'human') return undefined;
  return createHash('sha256').update(JSON.stringify({ feature: observation.feature, run_id: observation.run_id,
    status: observation.status, reason: snapshot.status_reason, disposition: snapshot.run_disposition, wait_kind: snapshot.run_wait_kind,
    phase: { name: snapshot.phase.name, status: snapshot.phase.status, attempt: snapshot.phase.attempt }, invocation: snapshot.invocation,
    current: 'current' in snapshot ? snapshot.current : undefined, recovery: snapshot.recovery,
    problems: snapshot.current_disposition?.completionBlocking.map(problem => ({ phase: problem.phase, id: problem.id,
      action: problem.action, owner: problem.owner, detail: problem.detail })),
  })).digest('hex');
}

/** Follow only the existing audited successor relation; a separate delivery cycle remains its own request. */
function currentConstructionRun(projectRoot: string, manifest: GoalRunManifest): GoalRunManifest {
  const siblings = deliveryCycleView(projectRoot, manifest.feature).siblings;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(manifest.run_id)) throw new Error('[goal-status] cyclic run successors');
    seen.add(manifest.run_id);
    const next = siblings.filter(run => run.manifest.successor_of === manifest.run_id && run.events.some(event => event.type === 'supersede'
      && 'target_run_id' in event && event.target_run_id === manifest.run_id
      && 'superseding_run_id' in event && event.superseding_run_id === run.runId
      && !('delivery_cycle_boundary' in event && event.delivery_cycle_boundary === manifest.run_id)));
    if (!next.length) return manifest;
    if (next.length !== 1) throw new Error('[goal-status] ambiguous audited successor');
    manifest = loadGoalRunManifestFromRun(projectRoot, next[0].runId, { feature: manifest.feature });
  }
}

type WaitReadInput = GoalWaitBinding & { frameworkRoot: string; featuresDir: string; previousRun?: { feature: string; runId: string } };
interface WaitView { observation: GoalWaitObservation; manifest: GoalRunManifest; events: GoalRunEvent[]; lock?: LockRecord | null }

function latestTime(...values: Array<unknown>): string | undefined {
  const times = values.filter((value): value is string => typeof value === 'string').map(Date.parse).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

function eventTime(events: GoalRunEvent[], runId: string): string | undefined {
  let newest = -Infinity;
  for (const event of events) if (!('run_id' in event) || event.run_id === runId) {
    const time = typeof event.ts === 'string' ? Date.parse(event.ts) : NaN;
    if (Number.isFinite(time)) newest = Math.max(newest, time);
  }
  return Number.isFinite(newest) ? new Date(newest).toISOString() : undefined;
}

function matchingLock(value: LockRecord | Record<string, unknown> | null | undefined, manifest: GoalRunManifest): LockRecord | null {
  return value?.run_id === manifest.run_id && typeof value.hostname === 'string' && value.hostname !== ''
    && Number.isInteger(value.pid) && Number(value.pid) > 0 ? value as unknown as LockRecord : null;
}

function readCurrentLock(input: WaitReadInput, manifest: GoalRunManifest): LockRecord | null {
  return matchingLock(readLockRecord(resolveFeatureLockPath(input.projectRoot, input.featuresDir, manifest.feature)), manifest)
    ?? matchingLock(readLockRecord(resolveRunnerLockPath(input.projectRoot, input.featuresDir, manifest.feature, manifest.run_id, manifest.report_dir)), manifest);
}

function progressTime(value: Record<string, any> | undefined, manifest: GoalRunManifest, projectRoot: string): string | undefined {
  if (value?.run_id !== manifest.run_id || value.feature !== manifest.feature
    || value.source?.events_path && path.resolve(projectRoot, value.source.events_path) !== path.resolve(projectRoot, manifest.report_dir, 'events.jsonl')) return undefined;
  return latestTime(value.generated_at);
}

function observeWaitFreshness(observation: GoalWaitObservation, runnerTime: string | undefined, lock: LockRecord | null): GoalWaitObservation {
  if (observation.attention || observation.stopped) return observation;
  const result = observeProgressFreshness(runnerTime, { liveProbe: true, featureLock: lock });
  if (!result) return observation;
  if (result.status === 'RUNNING') return observation.status === 'UNKNOWN' ? { ...observation, status: 'RUNNING' } : observation;
  const orphan = result.liveness === 'ORPHAN_SUSPECTED';
  return { ...observation, status: 'UNKNOWN', stopped: false, attention: orphan,
    detail: `${result.status_reason}：${orphan ? '当前同机运行器已失活；报告原因并保留原任务，条件恢复后通过原入口接回。'
      : '当前活性无法确认；本段观察有界等待，到期携原游标接续，不据此判定运行器死亡或自动恢复。'}` };
}

/** Business projection and actual executor selection remain the existing public readers' responsibility. */
function readWaitView(input: WaitReadInput): WaitView {
  if (input.previousRun) {
    const known = loadGoalRunManifestFromRun(input.projectRoot, input.previousRun.runId, { feature: input.previousRun.feature, featuresDir: input.featuresDir });
    const events = loadEventsJsonlStrict(path.resolve(input.projectRoot, known.report_dir, 'events.jsonl'));
    if (events.missing || events.corruptLines.length) throw new Error('[goal-status] previously observed run events became unreadable');
  }
  let manifest = loadGoalRunManifestFromRun(input.projectRoot, input.runId, { feature: input.feature, featuresDir: input.featuresDir });
  const original = originalDeliveryForManifest(input.projectRoot, manifest);
  const requestedOriginal = isInitialDesignManifest(manifest);
  const originalSnapshot = original && projectInitialDesignDelivery({ ...input, manifest: original });
  const activeChild = requestedOriginal && originalSnapshot && originalSnapshot.current?.feature !== original?.feature
    ? originalSnapshot.current : undefined;
  if (original && originalSnapshot && (requestedOriginal && !activeChild?.run_id || originalSnapshot.complete)) {
    const snapshot = originalSnapshot;
    const execution = resolveOriginalDeliveryExecution(input.projectRoot, original);
    const owner = execution.control?.owner;
    const expired = owner?.kind === 'session' && owner.state === 'active'
      && typeof owner.lease_expires_at === 'string' && Date.parse(owner.lease_expires_at) <= Date.now();
    return { manifest: execution.manifest, events: execution.events,
      observation: { feature: snapshot.feature, run_id: snapshot.run_id, status: snapshot.status, complete: snapshot.complete,
        event_count: snapshot.event_count, stopped: snapshot.status !== 'RUNNING',
        attention: snapshot.status === 'HALTED' || !!expired, snapshot,
        ...(expired ? { detail: '当前 session 租约已过期；报告原因，再经原入口接回同一任务。' }
          : snapshot.halt_reason ? { detail: snapshot.halt_reason } : {}) } };
  }
  if (activeChild?.run_id) manifest = loadGoalRunManifestFromRun(input.projectRoot, activeChild.run_id,
    { feature: activeChild.feature, featuresDir: input.featuresDir });
  manifest = currentConstructionRun(input.projectRoot, manifest);
  if (original && originalDeliveryForManifest(input.projectRoot, manifest)?.run_id !== original.run_id) {
    throw new Error('[goal-status] construction successor changed original delivery');
  }
  const loaded = loadEventsJsonlStrict(path.resolve(input.projectRoot, manifest.report_dir, 'events.jsonl'));
  if (loaded.missing || loaded.corruptLines.length) throw new Error('[goal-status] run events missing or unreadable');
  if (isInitialDesignManifest(manifest)) throw new Error('[goal-status] construction successor changed request kind');
  const workflow = workflowForExistingRun(resolveWorkflowSpec(input.projectRoot, { frameworkRoot: input.frameworkRoot }), manifest, input.frameworkRoot, input.projectRoot);
  const lock = readCurrentLock(input, manifest);
  const snapshot = buildLiveGoalStatusSnapshot({ ...input, manifest, workflow, feature: manifest.feature, runId: manifest.run_id, featureLock: lock });
  const attention = ['STALLED', 'WAITING_EXTERNAL', 'AWAITING_HUMAN_REVIEW', 'DEFERRED_CAPABILITY_MISSING'].includes(snapshot.status)
    || snapshot.run_disposition === 'WAITING' && snapshot.run_wait_kind === 'human';
  return { manifest, events: loaded.events, lock, observation: { feature: manifest.feature, run_id: manifest.run_id, status: snapshot.status,
    complete: !original && ['COMPLETED', 'CHAIN_SLICE_COMPLETED'].includes(snapshot.status) && snapshot.current_disposition?.completionEligible === true,
    event_count: snapshot.source.events_count, attention, stopped: snapshot.run_disposition === 'TERMINAL' || !['RUNNING', 'PENDING', 'UNKNOWN'].includes(snapshot.status), snapshot,
    ...(attention && snapshot.status_reason ? { detail: `${snapshot.status_reason}：报告当前原因，保留原任务并通过原入口处理；观察不恢复或终止运行器。` } : {}) } };
}

/** The clock comes from matching runner files/events; observer-generated snapshots never renew it. */
export function readGoalWaitObservation(input: WaitReadInput): GoalWaitObservation {
  const view = readWaitView(input);
  const lock = view.lock === undefined ? readCurrentLock(input, view.manifest) : view.lock;
  let progress: Record<string, any> | undefined;
  try { progress = JSON.parse(fs.readFileSync(path.resolve(input.projectRoot, view.manifest.report_dir, 'progress.json'), 'utf8')); } catch { /* Events and bound lock heartbeat remain applicable. */ }
  return observeWaitFreshness(view.observation, latestTime(progressTime(progress, view.manifest, input.projectRoot),
    eventTime(view.events, view.manifest.run_id), lock?.updated_at), lock);
}

/** Poll only existing event/control/progress files. Full business projection runs on real changes, never on heartbeat alone. */
export function createGoalWaitReader(input: GoalWaitBinding & { frameworkRoot: string; featuresDir: string }):
  (previousRun?: { feature: string; runId: string }) => GoalWaitObservation {
  type FileView = { stamp: string; size: number; tail?: Buffer; semantic?: string; owner?: Record<string, unknown>; alive?: string;
    eventTime?: string; progress?: Record<string, any> };
  const files = new Map<string, FileView>();
  const features = new Set([input.feature]);
  let cached: GoalWaitObservation | undefined;
  let execution: GoalRunManifest | undefined;
  let pending = false;
  let outputStalled = false;
  const boundedRead = (file: string, start: number, length: number): Buffer => {
    const fd = fs.openSync(file, 'r');
    try { const buffer = Buffer.alloc(length); return buffer.subarray(0, fs.readSync(fd, buffer, 0, length, start)); }
    finally { fs.closeSync(fd); }
  };
  const tail = (file: string, size: number) => boundedRead(file, Math.max(0, size - 512), Math.min(size, 512));
  const paths = (): Set<string> => {
    const result = new Set<string>();
    for (const feature of features) {
      const directory = path.join(input.projectRoot, input.featuresDir, featureRelativePath(feature));
      if (!fs.existsSync(directory)) continue;
      result.add(resolveFeatureLockPath(input.projectRoot, input.featuresDir, feature));
      const roots = [directory, ...fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== 'goal-runs' && !entry.name.startsWith('.'))
        .map(entry => path.join(directory, entry.name))];
      for (const root of roots) {
        const runs = path.join(root, 'goal-runs');
        if (!fs.existsSync(runs)) continue;
        result.add(path.join(runs, FEATURE_LOCK_NAME));
        for (const entry of fs.readdirSync(runs, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          for (const name of ['manifest.json', 'events.jsonl', 'progress.json', 'run-control.json', RUN_LOCK_NAME]) {
            result.add(path.join(runs, entry.name, name));
          }
        }
      }
    }
    return result;
  };
  const poll = (prime = false): boolean => {
    let changed = false;
    const current = paths();
    for (const file of files.keys()) if (!current.has(file)) { files.delete(file); changed = true; }
    for (const file of current) {
      const old = files.get(file);
      let stat: fs.Stats | undefined;
      try { stat = fs.statSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const stamp = stat ? `${stat.dev}/${stat.ino}/${stat.size}/${stat.mtimeMs}/${stat.ctimeMs}` : 'missing';
      let view = old;
      if (!old || old.stamp !== stamp) {
        view = { stamp, size: stat?.size ?? 0 };
        files.set(file, view);
        if (!stat) { if (old && old.stamp !== 'missing') changed = true; continue; }
        const name = path.basename(file);
        if (name === 'events.jsonl') {
          view.tail = tail(file, stat.size);
          if (old && stat.size > old.size && stat.size - old.size <= 64 * 1024
            && old.tail?.equals(tail(file, old.size))) {
            const text = boundedRead(file, old.size, stat.size - old.size).toString('utf8');
            try {
              const events = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as GoalRunEvent);
              view.eventTime = latestTime(old.eventTime, eventTime(events, path.basename(path.dirname(file))));
              if (events.some(event => event.type !== 'heartbeat')) changed = true;
            }
            catch { changed = true; }
          } else if (!prime) changed = true;
        } else {
          try {
            const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
            if (name === 'progress.json') view.progress = { run_id: value.run_id, feature: value.feature, generated_at: value.generated_at,
              source: value.source?.events_path ? { events_path: value.source.events_path } : undefined };
            view.owner = name === 'run-control.json' ? value.owner : name === FEATURE_LOCK_NAME || name === RUN_LOCK_NAME ? value : undefined;
            view.semantic = JSON.stringify(name === 'progress.json' ? {
              status: value.status, run_disposition: value.run_disposition, run_wait_kind: value.run_wait_kind,
              current: value.current, phase: { name: value.phase?.name, status: value.phase?.status, substep: value.phase?.substep },
              invocation: value.invocation, liveness: value.liveness?.state,
            } : view.owner ? { epoch: value.current_epoch, owner: {
              id: view.owner.owner_id ?? view.owner.ownerId, epoch: view.owner.epoch, kind: view.owner.kind,
              state: view.owner.state, pid: view.owner.pid, hostname: view.owner.hostname,
            } } : value);
            if (!prime && old?.semantic !== view.semantic) changed = true;
          } catch { if (!prime) changed = true; }
        }
      }
      if (view?.owner) {
        const owner = view.owner;
        const active = owner.state === undefined || owner.state === 'active' || owner.state === 'quiescing';
        const alive = !active ? 'inactive' : owner.hostname === os.hostname() && typeof owner.pid === 'number'
          ? String(isPidAlive(owner.pid)) : owner.kind === 'session' && typeof owner.lease_expires_at === 'string'
            ? String(Date.parse(owner.lease_expires_at) > Date.now()) : 'unknown';
        if (old?.alive !== undefined && old.alive !== alive) changed = true;
        view.alive = alive;
      }
    }
    if (cached && 'artifacts' in cached.snapshot && cached.snapshot.liveness.agent_output_stalled_ms !== null
      && cached.snapshot.artifacts.agent_output_log) {
      const file = path.resolve(input.projectRoot, cached.snapshot.artifacts.agent_output_log);
      try {
        const stalled = Date.now() - fs.statSync(file).mtimeMs >= SOFT_STALL_MS;
        if (stalled !== outputStalled) changed = true;
        outputStalled = stalled;
      } catch { changed = true; }
    }
    return changed;
  };
  // A child entry can name its original request without loading the blueprint or admission projection.
  const requested = loadGoalRunManifestFromRun(input.projectRoot, input.runId, { feature: input.feature, featuresDir: input.featuresDir });
  if ('delivery_origin' in requested && requested.delivery_origin) features.add(requested.delivery_origin.feature);
  poll(true);
  const observed = (): GoalWaitObservation => {
    if (!cached || !execution) throw new Error('[goal-status] missing current observation');
    const reports = path.resolve(input.projectRoot, execution.report_dir);
    const lock = matchingLock(files.get(resolveFeatureLockPath(input.projectRoot, input.featuresDir, execution.feature))?.owner, execution)
      ?? matchingLock(files.get(resolveRunnerLockPath(input.projectRoot, input.featuresDir, execution.feature, execution.run_id, execution.report_dir))?.owner, execution);
    return observeWaitFreshness(cached, latestTime(progressTime(files.get(path.join(reports, 'progress.json'))?.progress, execution, input.projectRoot),
      files.get(path.join(reports, 'events.jsonl'))?.eventTime, lock?.updated_at), lock);
  };
  return previousRun => {
    if (previousRun) features.add(previousRun.feature);
    if (cached && !pending && !poll()) return observed();
    let result: GoalWaitObservation;
    do {
      const view = readWaitView({ ...input, previousRun });
      cached = view.observation;
      execution = view.manifest;
      features.add(cached.feature);
      features.add(execution.feature);
      if ('current' in cached.snapshot && cached.snapshot.current) features.add(cached.snapshot.current.feature);
      pending = poll();
      const events = files.get(path.resolve(input.projectRoot, execution.report_dir, 'events.jsonl'));
      if (events) events.eventTime = latestTime(events.eventTime, eventTime(view.events, execution.run_id));
      result = observed();
      // A concurrent resume/successor must not let an older terminal projection escape.
    } while (pending && (result.stopped || result.attention));
    return result;
  };
}

/** One bounded observation segment; its expiry never changes the producer run. */
export async function waitForGoalStatus(input: GoalWaitBinding & {
  read: (previousRun?: { feature: string; runId: string }) => GoalWaitObservation; after?: string; timeoutMs?: number; signal?: AbortSignal;
  pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number;
}): Promise<GoalWaitResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_GOAL_WAIT_TIMEOUT_MS;
  let observation: GoalWaitObservation | undefined;
  let acknowledgedAttention: string | undefined;
  const project = fs.realpathSync(input.projectRoot);
  const finish = (reason: GoalWaitResult['reason'], detail?: string): GoalWaitResult => ({ reason,
    observed_at: new Date(now()).toISOString(), elapsed_ms: now() - started,
    ...(observation ? { observation, cursor: Buffer.from(JSON.stringify({ schema: 1, project, feature: input.feature,
      requested_run_id: input.runId, run_id: observation.run_id, observed_feature: observation.feature, event_count: observation.event_count,
      attention: continuableAttention(observation) ?? (reason === 'timeout' ? acknowledgedAttention : undefined) } satisfies WaitCursor)).toString('base64url') } : {}),
    ...((detail ?? observation?.detail) ? { detail: detail ?? observation?.detail } : {}) });
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('[goal-status] --timeout-ms must be positive');
    let previousRun: { feature: string; runId: string } | undefined;
    if (input.after) {
      const prior = parseGoalWaitCursor(input.after);
      if (prior.project !== project || prior.feature !== input.feature || prior.requested_run_id !== input.runId) {
        throw new Error('[goal-status] --after belongs to another project, feature or request');
      }
      previousRun = { feature: prior.observed_feature ?? input.feature, runId: prior.run_id };
      acknowledgedAttention = prior.attention;
    }
    for (;;) {
      if (input.signal?.aborted) return finish('cancelled');
      observation = input.read(previousRun);
      previousRun = { feature: observation.feature, runId: observation.run_id };
      const continuing = !!acknowledgedAttention && continuableAttention(observation) === acknowledgedAttention;
      if (observation.attention && !continuing) return finish('attention', continuableAttention(observation)
        ? `${observation.detail ?? observation.status} 当前同机运行器仍存活且可续等；在同一主会话用返回游标执行 --after <cursor> 续等原请求。`
        : undefined);
      if (observation.stopped && !continuing) return finish('stopped');
      if (acknowledgedAttention && !observation.attention && !observation.stopped && ['RUNNING', 'PENDING'].includes(observation.status)) {
        return finish('changed', `原障碍已解除，当前状态 ${observation.status}；先读新状态，尚在运行时在同一主会话用新返回的游标执行 --after <cursor> 继续等待。`);
      }
      if (now() - started >= timeoutMs) return finish('timeout');
      const interval = Math.min(input.pollMs ?? 2000, Math.max(1, timeoutMs - (now() - started)));
      await (input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(interval);
    }
  } catch (error) { return finish('read_error', (error as Error).message); }
}
