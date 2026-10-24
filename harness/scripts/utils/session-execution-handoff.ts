import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { PhaseExecutionContext } from './goal-phase-executor';
import { assertFencedOwner, readRunControl, setSessionExecutionLease, type RunFenceToken } from './goal-run-control';
import { loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, classifyPhaseInvocationChanges,
  type PhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from './phase-write-boundary';
import { parseCredentialRef } from './device-credential-store';

export interface HandoffReference { path: string; sha256: string }
export interface SessionExecutionReport { status: 'passed' | 'failed' | 'waiting'; phase: string; details?: string }
export interface SessionExecutionRequest {
  type: 'phase_execute_request';
  context: PhaseExecutionContext;
  invoke_id: string;
  chain_phase: string;
  purpose?: string;
  issued_at: string;
  deadline: string;
  gate_timeout_ms: number;
  cleanup_reserve_ms: number;
  pre_snapshot: PhaseInvocationSnapshot | null;
  write_boundary: PhaseWriteBoundaryResolution | null;
  snapshot_options?: Parameters<typeof capturePhaseInvocationSnapshot>[1];
}
export interface IssuedSessionExecution { request: SessionExecutionRequest; reference: HandoffReference; event: GoalRunEvent }
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const HANDOFF_ENV_KEYS = [
  'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_ATTEMPT_PHASE', 'MAISON_GOAL_MODEL_PIN',
  'MAISON_GOAL_VISUAL_PROVIDER_ADAPTER', 'MAISON_GOAL_VISUAL_PROVIDER_MODEL', 'HARNESS_HDC_TARGET',
  'MAISON_DEVICE_TARGET_KIND', 'MAISON_DEVICE_SESSION_ID', 'MAISON_DEVICE_ATTEMPT_FROZEN',
] as const;

/** Only runtime-issued identifiers are durable; no ambient environment or secret values. */
function handoffEnvironment(context: PhaseExecutionContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of HANDOFF_ENV_KEYS) if (context.childEnv[key] !== undefined) env[key] = context.childEnv[key];
  const reference = context.childEnv.MAISON_DEVICE_CREDENTIAL_REF;
  if (reference && parseCredentialRef(reference)) env.MAISON_DEVICE_CREDENTIAL_REF = reference;
  return env;
}

export function normalizeSessionReport(value: unknown): SessionExecutionReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[session-handoff] invalid execution result');
  const report = value as SessionExecutionReport;
  if (!['passed', 'failed', 'waiting'].includes(report.status) || typeof report.phase !== 'string'
    || (report.details !== undefined && typeof report.details !== 'string')) throw new Error('[session-handoff] invalid execution result');
  return { status: report.status, phase: report.phase, ...(report.details !== undefined ? { details: report.details } : {}) };
}

export function assertSessionRequestFence(runDir: string, issued: IssuedSessionExecution): void {
  const token = issued.request.context.owner;
  const control = readRunControl(runDir, token.run_id);
  if (!control?.owner || control.current_epoch !== token.epoch || control.owner.owner_id !== token.owner_id
    || !['active', 'orphaned_session'].includes(control.owner.state)) throw new Error('[session-handoff] stale owner fence');
}

/** Shared run-material boundary, including new files beneath a root junction alias. */
export function sessionRunMaterialPath(runDir: string, file: string): string {
  const absolute = path.resolve(file);
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('[session-handoff] material cannot be a symlink');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let parent = path.dirname(absolute);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const physical = path.resolve(fs.realpathSync(parent), path.relative(parent, absolute));
  const resolved = path.relative(fs.realpathSync(runDir), physical);
  if (!resolved) throw new Error('[session-handoff] material must be inside this run');
  if (resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('[session-handoff] material symlink escapes this run');
  return physical;
}

const inside = sessionRunMaterialPath;

function immutableJson(runDir: string, file: string, value: unknown): HandoffReference {
  inside(runDir, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = json(value);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error('[session-handoff] immutable material conflict');
  } else {
    const tmp = `${file}.${process.pid}.tmp`;
    let created = false;
    try {
      fs.writeFileSync(tmp, bytes, { encoding: 'utf8', flag: 'wx' });
      created = true;
      fs.renameSync(tmp, file);
    } finally { if (created) fs.rmSync(tmp, { force: true }); }
  }
  return { path: path.relative(runDir, file).replace(/\\/g, '/'), sha256: digest(bytes) };
}

export function sessionEvents(runDir: string): GoalRunEvent[] {
  const loaded = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl'));
  if (loaded.corruptLines.length) throw new Error('[session-handoff] events are corrupt');
  return loaded.events;
}

export function readHandoffMaterial<T>(runDir: string, ref: HandoffReference): T {
  const file = inside(runDir, path.resolve(runDir, ref.path));
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== ref.sha256) throw new Error('[session-handoff] material digest mismatch');
  return JSON.parse(bytes.toString('utf8')) as T;
}

/** Only committed session phase_start rows grant execution, never an unreferenced file. */
export function readSessionExecution(runDir: string, requestPath?: string): IssuedSessionExecution | null {
  const events = sessionEvents(runDir);
  const issued = [...events].reverse().find(event => event.type === 'phase_start' && event.driver === 'session' && event.handoff_request);
  if (!issued?.handoff_request) return null;
  const ref = issued.handoff_request;
  if (requestPath && inside(runDir, requestPath) !== inside(runDir, path.resolve(runDir, ref.path))) {
    // Accepted historical reports remain queryable after the next request was issued.
    const historical = events.find(event => event.type === 'phase_start' && event.handoff_request
      && inside(runDir, path.resolve(runDir, event.handoff_request.path)) === inside(runDir, requestPath));
    if (!historical?.handoff_request || !events.some(event => event.type === 'agent_invoke_end'
      && event.handoff_report?.request_sha256 === historical.handoff_request!.sha256)) throw new Error('[session-handoff] request is not the current signed request');
    return { event: historical, reference: historical.handoff_request, request: readHandoffMaterial(runDir, historical.handoff_request) };
  }
  const request = readHandoffMaterial<SessionExecutionRequest>(runDir, ref);
  const context = request.context;
  if (context.owner.owner_id !== issued.owner_id || context.owner.epoch !== issued.owner_epoch
    || context.attemptId !== issued.attempt_id || context.phase !== issued.phase
    || !events.some(event => event.type === 'agent_invoke_start' && event.invoke_id === request.invoke_id && event.phase === context.phase)) {
    throw new Error('[session-handoff] signed request identity mismatch');
  }
  return { request, reference: ref, event: issued };
}

export function acceptedSessionReport(runDir: string, issued: IssuedSessionExecution): { report: SessionExecutionReport; event: GoalRunEvent } | null {
  const event = sessionEvents(runDir).find(event => event.type === 'agent_invoke_end' && event.invoke_id === issued.request.invoke_id
    && event.handoff_report?.request_sha256 === issued.reference.sha256);
  if (!event?.handoff_report) return null;
  const archived = readHandoffMaterial<{ report: SessionExecutionReport }>(runDir, event.handoff_report);
  return { report: archived.report, event };
}

export function sessionExecutionForInvoke(runDir: string, invokeId: string): IssuedSessionExecution | null {
  const event = [...sessionEvents(runDir)].reverse().find(row => row.type === 'phase_start' && row.invoke_id === invokeId && row.handoff_request);
  return event?.handoff_request ? { event, reference: event.handoff_request, request: readHandoffMaterial(runDir, event.handoff_request) } : null;
}

export function undeliveredSessionInvocation(events: readonly GoalRunEvent[]): GoalRunEvent | undefined {
  return [...events].reverse().find(event => event.type === 'agent_invoke_start' && event.command === 'phase_execute_request'
    && !!event.invoke_id && !!event.owner_id && Number.isInteger(event.owner_epoch)
    && !events.some(later => later.invoke_id === event.invoke_id && (later.type === 'agent_invoke_end'
      || later.type === 'phase_start' && !!later.handoff_request)));
}

export function issueSessionExecution(input: {
  context: PhaseExecutionContext; invokeId: string; chainPhase?: string; purpose?: string;
  timeoutMs: number; gateTimeoutMs: number; cleanupReserveMs: number;
  preSnapshot: PhaseInvocationSnapshot | null; writeBoundary: PhaseWriteBoundaryResolution | null;
  snapshotOptions?: Parameters<typeof capturePhaseInvocationSnapshot>[1];
  emit: (event: Record<string, unknown>) => void;
}): IssuedSessionExecution {
  const { context } = input;
  assertFencedOwner(context.runDir, context.owner, 'session_issue');
  const current = readSessionExecution(context.runDir);
  if (current && !acceptedSessionReport(context.runDir, current)) throw new Error('[session-handoff] an execution request is already outstanding');
  const start = [...sessionEvents(context.runDir)].reverse().find(event => event.type === 'agent_invoke_start' && event.invoke_id === input.invokeId);
  if (!start?.ts) throw new Error('[session-handoff] invocation has not been started');
  const deadlineMs = Date.parse(start.ts) + input.timeoutMs;
  setSessionExecutionLease(context.runDir, context.owner, deadlineMs);
  let request: SessionExecutionRequest = {
    type: 'phase_execute_request', context: { ...context, childEnv: handoffEnvironment(context),
      instruction: `${context.instruction ?? ''}\n执行本次命令时同时传递 context.childEnv 中的冻结标识（run/attempt、设备目标、provider 与合法 opaque 凭据引用）；不要改读当前默认目标，不读取或打印凭据值。` }, invoke_id: input.invokeId,
    chain_phase: input.chainPhase ?? context.phase, ...(input.purpose ? { purpose: input.purpose } : {}),
    issued_at: start.ts, deadline: new Date(deadlineMs).toISOString(),
    gate_timeout_ms: input.gateTimeoutMs, cleanup_reserve_ms: input.cleanupReserveMs,
    pre_snapshot: input.preSnapshot, write_boundary: input.writeBoundary,
    ...(input.snapshotOptions ? { snapshot_options: input.snapshotOptions } : {}),
  };
  const file = path.join(context.runDir, 'phases', context.phase, input.invokeId, `request-e${context.owner.epoch}.json`);
  if (fs.existsSync(file)) {
    const original = JSON.parse(fs.readFileSync(inside(context.runDir, file), 'utf8')) as SessionExecutionRequest;
    if (original.invoke_id !== input.invokeId || original.context.owner.owner_id !== context.owner.owner_id
      || original.context.owner.epoch !== context.owner.epoch || original.context.phase !== context.phase) throw new Error('[session-handoff] incomplete issuance identity conflict');
    request = original;
  }
  const reference = immutableJson(context.runDir, file, request);
  const event: GoalRunEvent = { type: 'phase_start', phase: context.phase, driver: 'session', attempt_id: context.attemptId,
    invoke_id: input.invokeId, owner_id: context.owner.owner_id, owner_epoch: context.owner.epoch, handoff_request: reference };
  input.emit({ ...event });
  return { request, reference, event };
}

/** Explicit takeover re-signs authority, never the invocation's start, input or attempt. */
export function resignSessionExecution(runDir: string, issued: IssuedSessionExecution, token: RunFenceToken,
  emit: (event: Record<string, unknown>) => void): IssuedSessionExecution {
  assertFencedOwner(runDir, token, 'session_resign');
  const current = readSessionExecution(runDir);
  if (!current || current.reference.sha256 !== issued.reference.sha256 || acceptedSessionReport(runDir, issued)
    || token.run_id !== issued.request.context.runId || token.epoch <= issued.request.context.owner.epoch) throw new Error('[session-handoff] invalid execution re-sign');
  const old = issued.request.context.owner;
  const instruction = (issued.request.context.instruction ?? '').split(old.owner_id).join(token.owner_id)
    .replace(new RegExp(`(--goal-owner-epoch\\s+)${old.epoch}(?=\\s|$)`, 'g'), `$1${token.epoch}`);
  const request: SessionExecutionRequest = { ...issued.request, context: { ...issued.request.context,
    owner: { ...token, kind: 'session' }, instruction } };
  setSessionExecutionLease(runDir, token, Date.parse(request.deadline));
  const file = path.join(runDir, 'phases', request.context.phase, request.invoke_id, `request-e${token.epoch}.json`);
  const reference = immutableJson(runDir, file, request);
  const event: GoalRunEvent = { type: 'phase_start', phase: request.context.phase, driver: 'session',
    attempt_id: request.context.attemptId, invoke_id: request.invoke_id, owner_id: token.owner_id, owner_epoch: token.epoch, handoff_request: reference };
  emit({ ...event });
  return { request, reference, event };
}

interface SessionReportMaterial {
  report: SessionExecutionReport;
  post_snapshot: PhaseInvocationSnapshot | null;
  draft_outputs?: Record<string, string>;
}

function reportArchivePath(runDir: string, issued: IssuedSessionExecution): string {
  return path.join(runDir, path.dirname(issued.reference.path), `execution-report-e${issued.request.context.owner.epoch}.json`);
}

/** The one editable report input belongs to this request and fence. */
export function sessionReportInputPath(runDir: string, issued: IssuedSessionExecution): string {
  return inside(runDir, path.join(runDir, path.dirname(issued.reference.path), `result-e${issued.request.context.owner.epoch}.json`));
}

/** Uncommitted material is a replay input, never execution or validation authority. */
function readUncommittedReport(runDir: string, issued: IssuedSessionExecution): { material: SessionReportMaterial; reference: HandoffReference } | null {
  const current = inside(runDir, reportArchivePath(runDir, issued));
  const legacy = inside(runDir, path.join(path.dirname(current), 'execution-report.json'));
  const firstIssue = sessionEvents(runDir).find(event => event.type === 'phase_start' && event.invoke_id === issued.request.invoke_id && event.handoff_request);
  const file = fs.existsSync(current) ? current : firstIssue?.owner_epoch === issued.request.context.owner.epoch && fs.existsSync(legacy) ? legacy : null;
  if (!file) return null;
  const bytes = fs.readFileSync(file);
  const material = JSON.parse(bytes.toString('utf8')) as SessionReportMaterial;
  material.report = normalizeSessionReport(material.report);
  if (material.report.phase !== issued.request.context.phase) throw new Error('[session-handoff] archived report phase mismatch');
  return { material, reference: { path: path.relative(fs.realpathSync(runDir), file).replace(/\\/g, '/'), sha256: digest(bytes) } };
}

/** Automatic deadline closure retains a real report already saved before event commit. */
export function uncommittedSessionReport(runDir: string, issued: IssuedSessionExecution): SessionExecutionReport | null {
  return readUncommittedReport(runDir, issued)?.material.report ?? null;
}

/** Called under the runtime's physical run/feature locks, before any new dispatch. */
export function acceptSessionExecution(input: {
  runDir: string; issued: IssuedSessionExecution; report: SessionExecutionReport;
  emit: (event: Record<string, unknown>) => void; nowMs?: number;
}): { duplicate: boolean; timedOut: boolean } {
  const { runDir, issued } = input;
  const report = normalizeSessionReport(input.report);
  const prior = acceptedSessionReport(runDir, issued);
  if (prior) {
    if (json(prior.report) !== json(report)) throw new Error('[session-handoff] conflicting execution report');
    return { duplicate: true, timedOut: prior.event.timed_out === true };
  }
  if (!['passed', 'failed', 'waiting'].includes(report.status) || report.phase !== issued.request.context.phase
    || (report.details !== undefined && typeof report.details !== 'string')) throw new Error('[session-handoff] invalid execution result');
  const current = readSessionExecution(runDir);
  if (!current || current.reference.sha256 !== issued.reference.sha256) throw new Error('[session-handoff] stale request');
  const token = issued.request.context.owner;
  const control = readRunControl(runDir, token.run_id);
  if (!control?.owner || control.current_epoch !== token.epoch || control.owner.owner_id !== token.owner_id
    || !['active', 'orphaned_session'].includes(control.owner.state)) throw new Error('[session-handoff] stale owner fence');
  const nowMs = input.nowMs ?? Date.now();
  const timedOut = nowMs >= Date.parse(issued.request.deadline);
  if (control.owner.state !== 'active' && !timedOut) throw new Error('[session-handoff] inactive execution window');
  const saved = readUncommittedReport(runDir, issued);
  if (saved && json(saved.material.report) !== json(report)) throw new Error('[session-handoff] conflicting execution report');
  const { pre_snapshot: pre, write_boundary: boundary } = issued.request;
  const post = saved ? saved.material.post_snapshot : pre && boundary ? capturePhaseInvocationSnapshot(boundary, {
    ...issued.request.snapshot_options,
    runtimeExcluded: [...(issued.request.snapshot_options?.runtimeExcluded ?? []),
      path.relative(fs.realpathSync(boundary.projectRoot), sessionReportInputPath(runDir, issued))],
  }) : null;
  const file = reportArchivePath(runDir, issued);
  const draftOutputs: Record<string, string> = saved?.material.draft_outputs ?? {};
  if (!saved && (issued.request.purpose === 'author' || issued.request.purpose === 'questioning')) {
    for (const name of ['component-blueprint.yaml', 'change-unit.yaml', 'architecture.json']) {
      const draft = path.join(runDir, 'design-repair', name);
      if (fs.existsSync(draft)) draftOutputs[name] = fs.readFileSync(draft).toString('base64');
    }
  }
  // Persist the replay input before any observation can refer to its post-snapshot.
  const archive = saved?.reference ?? immutableJson(runDir, file, { report, post_snapshot: post, ...(Object.keys(draftOutputs).length ? { draft_outputs: draftOutputs } : {}) });
  if (pre && boundary && post && !issued.request.purpose) {
    const diff = diffPhaseInvocationSnapshots(pre, post);
    if (diff.kind === 'changed') {
      const writes = classifyPhaseInvocationChanges(boundary, report.phase, diff.changes);
      const owned = writes.allowed.filter(write => write.roles.some(role => role.kind === 'artifact'
        || (report.phase === 'ut' || report.phase === 'coding') && role.kind === 'source'));
      if ((writes.observed.length || owned.length) && !sessionEvents(runDir).some(event => event.type === 'phase_write_observed'
        && event.invoke_id === issued.request.invoke_id)) input.emit({
        type: 'phase_write_observed', phase: report.phase, invoke_id: issued.request.invoke_id,
        owned: owned.map(write => ({ path: write.path, how: write.how, pre_sha256: write.preSha256, post_sha256: write.postSha256, roles: write.roles })),
        observations: writes.observed.map(write => ({ path: write.path, how: write.how, disposition: write.disposition,
          owner: write.owner, owner_candidates: write.ownerCandidates, pre_sha256: write.preSha256, post_sha256: write.postSha256, roles: write.roles })),
        observed_count: writes.observed.length, pre_snapshot: pre.sha256, post_snapshot: post.sha256,
      });
    } else if (diff.kind === 'unverifiable') input.emit({ type: 'phase_write_boundary_degraded', phase: report.phase, invoke_id: issued.request.invoke_id, detail: diff.reason });
  }
  input.emit({ type: 'agent_invoke_end', phase: report.phase, invoke_id: issued.request.invoke_id,
    status: report.status,
    ...(issued.request.purpose ? { purpose: issued.request.purpose, chain_phase: issued.request.chain_phase } : {}),
    command: 'phase_execute_request', exit_code: report.status === 'failed' || timedOut ? 1 : 0,
    duration_ms: Math.max(0, nowMs - Date.parse(issued.request.issued_at)), timed_out: timedOut,
    ...(timedOut ? { kill_reason: 'agent_timeout' } : {}),
    effective_timeout_ms: Date.parse(issued.request.deadline) - Date.parse(issued.request.issued_at),
    handoff_report: { ...archive, request_sha256: issued.reference.sha256 },
  });
  return { duplicate: false, timedOut };
}

/** New session completion source; legacy process completion requirements stay intact. */
export function sessionValidationOnlyEligibility(events: readonly GoalRunEvent[]): { phase: string; invoke_id: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'agent_invoke_end' || !event.handoff_report || !event.phase || !event.invoke_id) continue;
    if ((event as Record<string, unknown>).chain_phase && (event as Record<string, unknown>).chain_phase !== event.phase) continue;
    if (event.timed_out || event.kill_reason === 'agent_timeout' || event.status === 'waiting') return null;
    if (events.slice(i + 1).some(later => later.phase === event.phase && ['agent_invoke_start', 'phase_verdict', 'phase_invalidated'].includes(later.type ?? '')
      || later.type === 'phase_backtrack_requested' && Array.isArray((later as Record<string, unknown>).invalidated_phases)
        && ((later as Record<string, unknown>).invalidated_phases as unknown[]).includes(event.phase))) return null;
    const issue = events.slice(0, i).reverse().find(row => row.type === 'phase_start' && row.handoff_request?.sha256 === event.handoff_report!.request_sha256);
    if (!issue?.handoff_request) return null;
    return { phase: event.phase, invoke_id: event.invoke_id };
  }
  return null;
}

export function sessionRequestFence(issued: IssuedSessionExecution): RunFenceToken { return issued.request.context.owner; }
