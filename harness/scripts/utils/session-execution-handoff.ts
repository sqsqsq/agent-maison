import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { WorkUnitExecutionContext } from './goal-phase-executor';
import { featureFilePath } from '../../config';
import { assertFencedOwner, readRunControl, setSessionExecutionLease, type RunFenceToken } from './goal-run-control';
import { loadEventsJsonlStrict, loadAuthoritativeEvents, resolveValidationOnlyEligibility, type GoalRunEvent } from './goal-runner-phase';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots, classifyPhaseInvocationChanges,
  type PhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from './phase-write-boundary';
import { parseCredentialRef } from './device-credential-store';
import { readProviderSessionId } from './agent-invoke';
import { createCodexTerminalScanner, resolveTerminalEventParser } from './codex-terminal-events';
import { reconcileGuardianOwnership, terminateGuardianProcessOnly, awaitGuardianGone } from './goal-containment-reconcile';
import { defaultProcessProbe } from './device-session';
import { invocationCompleted, invocationEndFacts } from './invocation-completion';

export interface HandoffReference { path: string; sha256: string }
export interface SessionExecutionReport { status: 'passed' | 'failed' | 'waiting'; phase: string; details?: string }
export interface SessionExecutionRequest {
  type: 'phase_execute_request';
  context: WorkUnitExecutionContext;
  invoke_id: string;
  chain_phase: string;
  purpose?: string;
  issued_at: string;
  deadline?: string;
  gate_timeout_ms: number;
  cleanup_reserve_ms: number;
  pre_snapshot: PhaseInvocationSnapshot | null;
  write_boundary: PhaseWriteBoundaryResolution | null;
  snapshot_options?: Parameters<typeof capturePhaseInvocationSnapshot>[1];
}
export interface IssuedSessionExecution { request: SessionExecutionRequest; reference: HandoffReference; event: GoalRunEvent }
export function sessionExecutionDeadlineMs(request: SessionExecutionRequest): number {
  const userDeadline = request.context.user_deadline_at ? Date.parse(request.context.user_deadline_at) : Infinity;
  const toolDeadline = request.purpose === 'vision_canary' && Number.isFinite(request.gate_timeout_ms) && request.gate_timeout_ms > 0
    ? Date.parse(request.issued_at) + request.gate_timeout_ms : Infinity;
  return Math.min(userDeadline, toolDeadline);
}
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const HANDOFF_ENV_KEYS = [
  'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_ATTEMPT_PHASE', 'MAISON_GOAL_MODEL_PIN',
  'MAISON_GOAL_VISUAL_PROVIDER_ADAPTER', 'MAISON_GOAL_VISUAL_PROVIDER_MODEL', 'HARNESS_HDC_TARGET',
  'MAISON_DEVICE_TARGET_KIND', 'MAISON_DEVICE_SESSION_ID', 'MAISON_DEVICE_ATTEMPT_FROZEN',
] as const;

/** Only runtime-issued identifiers are durable; no ambient environment or secret values. */
function handoffEnvironment(context: WorkUnitExecutionContext): Record<string, string> {
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

/** Shared public transport prelude, before any runtime attempt or owner allocation. */
export function inspectSessionExecutionBeforeRuntime(options: {
  runDir: string; requestPath?: string; report?: SessionExecutionReport; forceTakeover?: boolean;
}) {
  const current = readSessionExecution(options.runDir, options.requestPath);
  const report = options.report ? normalizeSessionReport(options.report) : undefined;
  if (report && !current) throw new Error('[session-handoff] report has no signed request');
  if (current && report && current.request.context.phase !== report.phase) throw new Error('[session-handoff] invalid execution phase');
  const accepted = current ? acceptedSessionReport(options.runDir, current) : null;
  if (accepted && report && JSON.stringify(accepted.report) !== JSON.stringify(report)) throw new Error('[session-handoff] conflicting execution report');
  let reusable: IssuedSessionExecution | null = null;
  if (current && !accepted) {
    const control = readRunControl(options.runDir, current.request.context.runId);
    if (options.forceTakeover && !report && (control?.owner?.state === 'released' || control?.owner?.state === 'orphaned_session')) {
      const stopped = stopBoundExecution(options.runDir, current, event => fs.appendFileSync(path.join(options.runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n'), { allowReleased: true });
      if (!stopped.stopped) throw new Error(stopped.detail ?? '原生执行已完成但尚在收尾，等待原结果；不重签仍运行的调用。');
    }
    const releasedForTakeover = options.forceTakeover && !report && control?.owner?.state === 'released'
      && control.current_epoch === current.request.context.owner.epoch && control.owner.owner_id === current.request.context.owner.owner_id;
    if (!releasedForTakeover) assertSessionRequestFence(options.runDir, current);
    if (!releasedForTakeover && !report && sessionExecutionDeadlineMs(current.request) > Date.now()) reusable = current;
  }
  return { current, report, accepted, reusable };
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

/** A repeat read returns the same original facts, never another business progress assessment. */
export function observeSessionExecution(runDir: string, issued: IssuedSessionExecution) {
  const { request } = issued;
  const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
  const settled = events.some(event => event.type === 'agent_invoke_end' && event.invoke_id === request.invoke_id);
  if (!settled) assertSessionRequestFence(runDir, issued);
  const log = inside(runDir, path.join(runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'));
  const toolEvents: unknown[] = [];
  if (fs.existsSync(log)) {
    const lines = fs.readFileSync(log, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { toolEvents.push(JSON.parse(lines[i])); }
      catch { /* Keep the original stream; unstructured or incomplete text is not a tool fact. */ }
    }
  }
  const postSnapshot = request.pre_snapshot && request.write_boundary
    ? capturePhaseInvocationSnapshot(request.write_boundary, request.snapshot_options) : null;
  const changes = request.pre_snapshot && postSnapshot ? diffPhaseInvocationSnapshots(request.pre_snapshot, postSnapshot) : null;
  return { invoke_id: request.invoke_id,
    provider_session_id: readProviderSessionId(log, request.context.adapter),
    toolEvents, postSnapshot, changes,
    writes: changes?.kind === 'changed' && request.write_boundary
      ? classifyPhaseInvocationChanges(request.write_boundary, request.context.phase, changes.changes) : null,
    invocation: [...events].reverse().find(event => event.invoke_id === request.invoke_id && (event.type === 'agent_invoke_end' || event.type === 'agent_process_settled' || event.type === 'agent_invoke_start')),
    settled };
}

/** Read original request material for evidence; copied paths do not authorize current execution. */
export function readExecutionRequestOriginal(runDir: string, invokeId?: string): IssuedSessionExecution | null {
  const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
  const start = [...events].reverse().find(event => event.type === 'agent_invoke_start' && (!invokeId || event.invoke_id === invokeId));
  if (!start?.invoke_id || !start.phase) return null;
  const signed = sessionExecutionForInvoke(runDir, start.invoke_id);
  if (signed) return signed;
  const directory = inside(runDir, path.join(runDir, 'phases', start.phase, start.invoke_id, 'request'));
  if (!fs.existsSync(path.dirname(directory))) return null;
  const files = fs.readdirSync(path.dirname(directory)).filter(file => /^request-e\d+\.json$/.test(file)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  if (!files[0]) return null;
  const bytes = fs.readFileSync(inside(runDir, path.join(path.dirname(directory), files[0])));
  const request = JSON.parse(bytes.toString('utf8')) as SessionExecutionRequest;
  if (request.invoke_id !== start.invoke_id || request.context.phase !== start.phase) throw new Error('[session-handoff] execution request identity mismatch');
  return { request, event: start, reference: { path: path.relative(runDir, path.join(path.dirname(directory), files[0])).replace(/\\/g, '/'), sha256: digest(bytes) } };
}

/** The same saved request locates current observations; preserve the existing process authority boundary. */
export function executionRequestForInvoke(runDir: string, invokeId?: string): IssuedSessionExecution | null {
  const original = readExecutionRequestOriginal(runDir, invokeId);
  if (!original) return null;
  if (original.event.type === 'phase_start' && original.event.handoff_request) return original;
  return path.resolve(original.request.context.runDir) === path.resolve(runDir) ? original : null;
}

/** Stop only an exact existing native binding. Unknown external executions cannot be force-re-signed. */
export function stopBoundExecution(runDir: string, issued: IssuedSessionExecution,
  emit: (event: Record<string, unknown>) => void, options: { allowReleased?: boolean } = {}): { stopped: boolean; completed: boolean; detail?: string } {
  const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
  if (events.some(event => event.type === 'agent_invoke_end' && event.invoke_id === issued.request.invoke_id)) return { stopped: true, completed: true };
  const control = readRunControl(runDir, issued.request.context.runId);
  const released = options.allowReleased && control?.owner?.state === 'released'
    && control.owner.owner_id === issued.request.context.owner.owner_id && control.current_epoch === issued.request.context.owner.epoch;
  if (!released) assertSessionRequestFence(runDir, issued);
  if (nativeExecutionCompleted(runDir, issued)) return { stopped: false, completed: true };
  const own = events.filter(event => event.invoke_id === issued.request.invoke_id);
  if (own.some(event => event.type === 'agent_process_settled' || event.type === 'orphan_reclaimed')) return { stopped: true, completed: false };
  const reconciled = reconcileGuardianOwnership(own, defaultProcessProbe());
  if (reconciled.kind !== 'outcomes' || !reconciled.items.length) return { stopped: false, completed: false, detail: '没有可核实的原生进程绑定；旧外部执行必须先明确停止，不能仅凭租约重签。' };
  if (reconciled.items.some(item => item.kind === 'guardian_alive_matching') && !own.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting')) emit({
    type: 'phase_halt', phase: issued.request.context.phase, invoke_id: issued.request.invoke_id, halt_reason: 'executor_waiting',
    owner_id: issued.request.context.owner.owner_id, owner_epoch: issued.request.context.owner.epoch,
    detail: '协调器请求中断当前绑定执行；实际停止和写入保全以随后调用事实为准。',
  });
  for (const item of reconciled.items) {
    if (item.kind === 'guardian_alive_matching' && (!terminateGuardianProcessOnly(item.bound.pid) || !awaitGuardianGone(item.bound.pid))) return { stopped: false, completed: false, detail: '当前绑定执行尚未确认停止。' };
    if (item.kind === 'guardian_identity_unverifiable' && !item.identity_mismatch) return { stopped: false, completed: false, detail: item.reason };
  }
  emit({ type: 'agent_process_settled', phase: issued.request.context.phase, invoke_id: issued.request.invoke_id,
    owner_id: issued.request.context.owner.owner_id, owner_epoch: issued.request.context.owner.epoch, interrupted: true, exit_code: 1 });
  return { stopped: true, completed: false };
}

export function nativeExecutionCompleted(runDir: string, issued: IssuedSessionExecution): boolean {
  const settled = [...loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'))].reverse().find(event => event.type === 'agent_process_settled'
    && event.invoke_id === issued.request.invoke_id) as Record<string, unknown> | undefined;
  if (settled) return invocationCompleted({ ...settled, exitCode: settled.exit_code });
  const stream = inside(runDir, path.join(runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'));
  const parser = resolveTerminalEventParser(issued.request.context.adapter);
  if (parser === 'none' || !fs.existsSync(stream)) return false;
  const scanner = createCodexTerminalScanner({}, parser); scanner.push(fs.readFileSync(stream, 'utf8')); scanner.flush();
  return scanner.state().completionObserved && !scanner.state().terminalFailureObserved;
}

/** The caller uses its existing owner-bound process/session cancellation primitive. */
export async function interruptSessionExecution(input: {
  runDir: string; issued: IssuedSessionExecution; reason: string;
  stop: (request: SessionExecutionRequest) => Promise<boolean>;
  emit: (event: Record<string, unknown>) => void;
}): Promise<{ duplicate: boolean; timedOut: boolean }> {
  const prior = acceptedSessionReport(input.runDir, input.issued);
  if (prior) return { duplicate: true, timedOut: prior.event.timed_out === true };
  assertSessionRequestFence(input.runDir, input.issued);
  if (!await input.stop(input.issued.request)) throw new Error('[session-handoff] execution stop is unconfirmed; retain the outstanding request');
  assertSessionRequestFence(input.runDir, input.issued);
  return acceptSessionExecution({ ...input, interrupted: true, report: {
    status: 'waiting', phase: input.issued.request.context.phase,
    details: input.reason,
  } });
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

export interface PhaseExecutionRequestMaterialInput {
  context: WorkUnitExecutionContext; invokeId: string; chainPhase?: string; purpose?: string;
  issuedAt: string;
  timeoutMs?: number; gateTimeoutMs: number; cleanupReserveMs: number;
  preSnapshot: PhaseInvocationSnapshot | null; writeBoundary: PhaseWriteBoundaryResolution | null;
  snapshotOptions?: Parameters<typeof capturePhaseInvocationSnapshot>[1];
}

/** 两运输共用的调用原件；保存材料本身不签发session权限、不写lease或事件。 */
export function writePhaseExecutionRequestMaterial(input: PhaseExecutionRequestMaterialInput): { request: SessionExecutionRequest; reference: HandoffReference } {
  const { context } = input;
  const { executionRole: _derivedRole, ...durableContext } = context;
  let request: SessionExecutionRequest = {
    type: 'phase_execute_request', context: { ...durableContext, childEnv: handoffEnvironment(context) }, invoke_id: input.invokeId,
    chain_phase: input.chainPhase ?? context.phase, ...(input.purpose ? { purpose: input.purpose } : {}),
    issued_at: input.issuedAt, ...(context.user_deadline_at ? { deadline: context.user_deadline_at } : {}),
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
  return { request, reference };
}

export function sessionExecutionTransportInstructionSuffix(context: Pick<WorkUnitExecutionContext, 'runDir' | 'phase'>, invokeId: string): string {
  return `\n执行本次命令时同时传递 context.childEnv 中的冻结标识（run/attempt、设备目标、provider 与合法 opaque 凭据引用）；不要改读当前默认目标，不读取或打印凭据值。\n实际执行者若能导出原生结构化工具事件，将本次调用的原始事件流保存到 ${path.join(context.runDir, 'phases', context.phase, invokeId, 'agent-events.jsonl')}；只接受实际工具事件，不从自然语言说明构造记录。没有可导出的审计材料时如实保持未验证。`;
}

export function issueSessionExecution(input: Omit<PhaseExecutionRequestMaterialInput, 'issuedAt'> & {
  emit: (event: Record<string, unknown>) => void;
}): IssuedSessionExecution {
  const { context } = input;
  assertFencedOwner(context.runDir, context.owner, 'session_issue');
  const current = readSessionExecution(context.runDir);
  if (current && !acceptedSessionReport(context.runDir, current)) throw new Error('[session-handoff] an execution request is already outstanding');
  const start = [...sessionEvents(context.runDir)].reverse().find(event => event.type === 'agent_invoke_start' && event.invoke_id === input.invokeId);
  if (!start?.ts) throw new Error('[session-handoff] invocation has not been started');
  setSessionExecutionLease(context.runDir, context.owner, context.user_deadline_at ? Date.parse(context.user_deadline_at) : Date.now() + 60_000);
  const { request, reference } = writePhaseExecutionRequestMaterial({ ...input, issuedAt: start.ts, context: { ...context,
    instruction: `${context.instruction ?? ''}${sessionExecutionTransportInstructionSuffix(context, input.invokeId)}` } });
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
  const deadline = sessionExecutionDeadlineMs(request);
  setSessionExecutionLease(runDir, token, Number.isFinite(deadline) ? deadline : Date.now() + 60_000);
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
  interrupted?: boolean;
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
  const nativeEnd = [...sessionEvents(runDir)].reverse().find(event => event.type === 'agent_process_settled' && event.invoke_id === issued.request.invoke_id) as Record<string, unknown> | undefined;
  const timedOut = nativeEnd ? nativeEnd.timed_out === true : nowMs >= sessionExecutionDeadlineMs(issued.request);
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
  const toolEvents = inside(runDir, path.join(runDir, path.dirname(issued.reference.path), 'agent-events.jsonl'));
  const acceptedToolEvents = inside(runDir, path.join(runDir, path.dirname(issued.reference.path), `accepted-agent-events-e${token.epoch}.jsonl`));
  if (!saved && fs.existsSync(toolEvents) && fs.statSync(toolEvents).mtimeMs >= Date.parse(issued.request.issued_at)) {
    const bytes = fs.readFileSync(toolEvents);
    draftOutputs['agent-events.jsonl'] = bytes.toString('base64');
    if (fs.existsSync(acceptedToolEvents)) {
      if (!fs.readFileSync(acceptedToolEvents).equals(bytes)) throw new Error('[session-handoff] conflicting tool audit material');
    } else fs.writeFileSync(acceptedToolEvents, bytes, { flag: 'wx' });
  }
  if (!saved && (issued.request.purpose === 'author' || issued.request.purpose === 'questioning')) {
    if (issued.request.context.phase.startsWith('initial-design-') && boundary) {
      const blueprint = featureFilePath(boundary.projectRoot, issued.request.context.feature, 'blueprint/component-blueprint.yaml');
      if (fs.existsSync(blueprint)) draftOutputs['initial-design-blueprint.yaml'] = fs.readFileSync(blueprint).toString('base64');
    }
    for (const name of ['component-blueprint.yaml', 'change-unit.yaml', 'change-unit-candidates.json', 'architecture.json']) {
      const draft = path.join(runDir, 'design-repair', name);
      if (fs.existsSync(draft)) draftOutputs[name] = fs.readFileSync(draft).toString('base64');
    }
  }
  // Persist the replay input before any observation can refer to its post-snapshot.
  const archive = saved?.reference ?? immutableJson(runDir, file, { report, post_snapshot: post, ...(Object.keys(draftOutputs).length ? { draft_outputs: draftOutputs } : {}) });
  if (pre && boundary && post) {
    const diff = diffPhaseInvocationSnapshots(pre, post);
    if (diff.kind === 'changed') {
      const writes = classifyPhaseInvocationChanges(boundary, report.phase, diff.changes);
      const owned = writes.allowed.filter(write => write.roles.some(role => role.kind === 'artifact' || role.kind === 'source'));
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
    command: 'phase_execute_request',
    ...invocationEndFacts({ ...nativeEnd,
      exit_code: typeof nativeEnd?.exit_code === 'number' ? nativeEnd.exit_code : report.status === 'failed' || timedOut ? 1 : 0,
      interrupted: input.interrupted || nativeEnd?.interrupted === true ? true : undefined,
      provider_session_id: readProviderSessionId(toolEvents, issued.request.context.adapter), timed_out: timedOut }),
    duration_ms: Math.max(0, nowMs - Date.parse(issued.request.issued_at)),
    ...(Number.isFinite(sessionExecutionDeadlineMs(issued.request))
      ? { effective_timeout_ms: sessionExecutionDeadlineMs(issued.request) - Date.parse(issued.request.issued_at) } : {}),
    handoff_report: { ...archive, request_sha256: issued.reference.sha256 },
  });
  return { duplicate: false, timedOut };
}

/**
 * New session completion source; legacy process completion requirements stay intact.
 * plan 6fd6c8c1 §4.2：业务资格与后台路径共用 `resolveValidationOnlyEligibility`；
 * 这里只声明“会话报告本身即停等形状”，不再单独决定谁能复用。
 */
export function sessionValidationOnlyEligibility(events: readonly GoalRunEvent[]): { phase: string; invoke_id: string } | null {
  return resolveValidationOnlyEligibility(events as ReadonlyArray<Record<string, unknown>>, { requireInterrupt: false });
}

export function sessionRequestFence(issued: IssuedSessionExecution): RunFenceToken { return issued.request.context.owner; }

/** 当前报告已接收并冻结的真实工具流；不读 phase 共享目录里上一次后台的日志。 */
export function sessionToolEventsLogPath(runDir: string, issued: IssuedSessionExecution): string | null {
  const accepted = acceptedSessionReport(runDir, issued);
  if (!accepted?.event.handoff_report) return null;
  const material = readHandoffMaterial<SessionReportMaterial>(runDir, accepted.event.handoff_report);
  const bytes = material.draft_outputs?.['agent-events.jsonl'];
  if (!bytes) return null;
  const file = inside(runDir, path.join(runDir, path.dirname(issued.reference.path), `accepted-agent-events-e${issued.request.context.owner.epoch}.jsonl`));
  return fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(bytes, 'base64')) ? file : null;
}
