import type { HeadlessInvokePlan, AgentInvokeOptions, AgentInvokeResult } from './agent-invoke';
import { invokeAgentHeadless, readProviderSessionId, providerSessionRebuildReason } from './agent-invoke';
import { invocationCompleted, invocationWaitingDetail } from './invocation-completion';
import type { RunFenceToken, RunOwnerKind } from './goal-run-control';
import type { UnattendedContract, GoalRunManifest } from './goal-manifest';
import { loadGoalRunManifestFromRun, effectiveHeadlessUnattended } from './goal-manifest';
import { loadAuthoritativeEvents } from './goal-runner-phase';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { assertFencedOwner } from './goal-run-control';
import { executionRequestForInvoke, observeSessionExecution, readHandoffMaterial, sessionExecutionDeadlineMs, type HandoffReference } from './session-execution-handoff';
import { createCodexTerminalScanner, extractProviderSessionId, isProviderToolResult, resolveTerminalEventParser } from './codex-terminal-events';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots } from './phase-write-boundary';

export interface WorkUnitExecutionContext {
  readonly runId: string;
  readonly feature: string;
  readonly workflowId: string;
  readonly track: string;
  readonly chain: readonly string[];
  readonly phase: string;
  readonly attemptId: string;
  readonly owner: Readonly<RunFenceToken & { kind: RunOwnerKind }>;
  readonly projectRoot: string;
  readonly frameworkRoot: string;
  readonly runDir: string;
  readonly reportDir: string;
  readonly adapter: string;
  readonly adapterModel?: string;
  readonly provider_session_id?: string;
  readonly user_deadline_at?: string;
  /** Derived from the current request's purpose, never a second role authority. */
  readonly executionRole?: 'author' | 'verifier';
  readonly authority?: Pick<UnattendedContract, 'write_mode' | 'approval_mode' | 'allowed_tools'>;
  readonly factsContext?: import('./context-facts').FactsInvocationContext;
  /** Runtime-built phase instruction. Executors transport it; they do not interpret policy. */
  readonly instruction?: string;
  readonly runtimeFacts: Readonly<{
    runBaseSha?: string;
    receiptRequired: boolean;
    resume: boolean;
    successor: boolean;
  }>;
  readonly childEnv: Readonly<Record<string, string>>;
}

export type GoalPhaseExecutorStatus = 'passed' | 'failed' | 'waiting';

export interface GoalPhaseExecutorResult {
  readonly status: GoalPhaseExecutorStatus;
  readonly phase: string;
  readonly details?: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly command: string;
  readonly skipped?: boolean;
  readonly pid?: number;
  readonly duration_ms?: number;
  readonly timed_out?: boolean;
  readonly silent_killed?: boolean;
  readonly completion_observed?: boolean;
  readonly terminal_failure_observed?: boolean;
  readonly terminal_error_excerpt?: string;
  readonly signal?: string | null;
  readonly lingering_pipe?: boolean;
  readonly kill_attempted?: boolean;
  readonly kill_exit_code?: number | null;
  readonly kill_error?: string | null;
  readonly usage?: AgentInvokeResult['usage'];
  readonly spawn_error?: AgentInvokeResult['spawn_error'];
  readonly provider_session_id?: string;
  readonly interrupted?: boolean;
  readonly nativeSessionRebuildReason?: string;
  readonly readonly_enforced?: boolean;
  readonly readonly_diagnostic?: string;
}

export interface GoalPhaseExecutor {
  execute(context: WorkUnitExecutionContext, controls?: WorkUnitExecutionControls): Promise<GoalPhaseExecutorResult>;
}

export interface WorkUnitExecutionControls {
  signal?: AbortSignal;
  cancel?: (reason?: unknown) => void;
  onObservation?: (observation: ReturnType<typeof observeSessionExecution>) => void;
}

export function workUnitExecutionRole(context: Pick<WorkUnitExecutionContext, 'phase' | 'executionRole'>, purpose?: string): 'author' | 'verifier' {
  if (context.executionRole) return context.executionRole;
  const responsibility = purpose ?? context.phase;
  return ['questioning', 'vision_canary', 'vision-canary', 'verifier_format_repair', 'initial-design-questioning', 'design-repair-questioning', 'review'].includes(responsibility)
    || responsibility.endsWith('-verifier-format-repair') ? 'verifier' : 'author';
}

export function workUnitNativeReadonly(context: Pick<WorkUnitExecutionContext, 'phase'>, purpose?: string): boolean {
  return ['questioning', 'vision_canary', 'vision-canary', 'initial-design-questioning', 'design-repair-questioning'].includes(purpose ?? context.phase);
}

export function workUnitExecutionInputs(manifest: GoalRunManifest, purpose?: string, projectRoot?: string): Partial<WorkUnitExecutionContext> {
  const origin = projectRoot && manifest.delivery_origin && (manifest.delivery_origin.feature !== manifest.feature || manifest.delivery_origin.run_id !== manifest.run_id)
    ? (require('./delivery-origin') as typeof import('./delivery-origin')).originalDeliveryForManifest(projectRoot, manifest) : undefined;
  const { write_mode, approval_mode, allowed_tools } = effectiveHeadlessUnattended(origin?.unattended ?? manifest.unattended);
  const deadline = origin?.user_deadline_at ?? manifest.user_deadline_at;
  return { authority: { write_mode, approval_mode, ...(allowed_tools ? { allowed_tools } : {}) },
    ...(deadline ? { user_deadline_at: deadline } : {}),
    ...(purpose ? { executionRole: workUnitExecutionRole({ phase: purpose }, purpose) } : {}) };
}

function deepFreezeContext(input: WorkUnitExecutionContext): WorkUnitExecutionContext {
  const childEnv = { ...input.childEnv };
  for (const key of Object.keys(childEnv)) {
    if (key.toUpperCase() === 'HARNESS_DIFF_BASE_REF') delete childEnv[key];
  }
  const context: WorkUnitExecutionContext = {
    ...input,
    chain: Object.freeze([...input.chain]),
    owner: Object.freeze({ ...input.owner }),
    runtimeFacts: Object.freeze({ ...input.runtimeFacts }),
    childEnv: Object.freeze(childEnv),
    ...(input.authority ? { authority: Object.freeze({ ...input.authority,
      ...(input.authority.allowed_tools ? { allowed_tools: Object.freeze([...input.authority.allowed_tools]) as unknown as string[] } : {}) }) } : {}),
    ...(input.factsContext ? { factsContext: Object.freeze(structuredClone(input.factsContext)) } : {}),
  };
  return Object.freeze(context);
}

export function createWorkUnitExecutionContext(input: WorkUnitExecutionContext, observed: Partial<WorkUnitExecutionContext> = {}): WorkUnitExecutionContext {
  return deepFreezeContext({ ...input, ...observed });
}

export function rebuildWorkUnitExecutionContext(context: WorkUnitExecutionContext, reason: string): WorkUnitExecutionContext {
  return deepFreezeContext({ ...context, provider_session_id: undefined,
    instruction: `${context.instruction ?? ''}\n专用上下文按当前权威输入、成果、有效结果和未完项重建：${reason}。这不等于无损恢复原生私有状态。` });
}

function stoppedBeforeExecution(context: WorkUnitExecutionContext, controls?: WorkUnitExecutionControls): GoalPhaseExecutorResult | undefined {
  const expired = context.user_deadline_at && Date.parse(context.user_deadline_at) <= Date.now();
  if (!expired && !controls?.signal?.aborted) return undefined;
  return { phase: context.phase, status: 'waiting', exitCode: 1, stdout: '', stderr: '', skipped: true,
    command: 'phase_execute_request', ...(expired ? { timed_out: true } : { interrupted: true }),
    details: expired ? '用户明示时限已到；已保留成果，不启动新工作。' : '用户或协调器已取消本次执行；已保留成果。' };
}

/** Derive the actual author unit from existing requests and design transaction originals. */
export function authorUnit(context: WorkUnitExecutionContext, events: ReturnType<typeof loadAuthoritativeEvents>, before: number): string | undefined {
  if (!context.phase.startsWith('initial-design-') && context.phase !== 'design-repair-author') return 'implementation';
  try {
    const manifest = loadGoalRunManifestFromRun(context.projectRoot, context.runId, { feature: context.feature });
    if ('initial_design' in manifest && manifest.feature === context.feature && manifest.run_id === context.runId) return `design-root:${context.feature}`;
  } catch { /* A legacy design repair can still be identified by its original transaction. */ }
  if (context.phase !== 'design-repair-author') return undefined;
  type DesignEvent = (typeof events)[number] & {
    stage?: unknown; handoff_context?: HandoffReference; blueprint_id?: unknown; signature?: unknown;
  };
  const history = events.slice(0, before) as DesignEvent[];
  const attempted = [...history].reverse().find(event => event.type === 'design_authority_repair' && event.stage === 'attempted');
  if (!attempted || !attempted.handoff_context || typeof attempted.blueprint_id !== 'string') return undefined;
  if (history.slice(history.indexOf(attempted) + 1).some(event => event.type === 'design_authority_repair'
    && event.signature === attempted.signature && ['failed', 'published'].includes(String(event.stage)))) return undefined;
  try {
    const original = readHandoffMaterial<{ baseline: string; cu?: string }>(context.runDir, attempted.handoff_context);
    const blueprint = YAML.parse(Buffer.from(original.baseline, 'base64').toString('utf8'));
    if (blueprint?.blueprint_id !== attempted.blueprint_id || typeof blueprint?.component_id !== 'string') return undefined;
    const cu = original.cu ? YAML.parse(Buffer.from(original.cu, 'base64').toString('utf8')) : undefined;
    if (cu && (typeof cu.change_unit_id !== 'string' || cu.component_blueprint_ref?.blueprint_id !== attempted.blueprint_id)) return undefined;
    return JSON.stringify([attempted.blueprint_id, blueprint.component_id, cu?.change_unit_id ?? null]);
  } catch { return undefined; }
}

/** Observe unfinished originals first; only the same author's native identity is reusable. */
export function observeWorkUnitProviderSession(context: WorkUnitExecutionContext): Partial<WorkUnitExecutionContext> | GoalPhaseExecutorResult {
  const role = workUnitExecutionRole(context);
  const eventsPath = path.join(context.runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return { provider_session_id: undefined };
  const events = loadAuthoritativeEvents(eventsPath);
  const currentStart = events.findIndex(event => event.type === 'agent_invoke_start' && event.phase === context.phase
    && (event.invoke_id === context.attemptId || event.invoke_id === `${context.phase}-${context.attemptId}`));
  const unit = role === 'author' ? authorUnit(context, events, currentStart < 0 ? events.length : currentStart) : undefined;
  if (role === 'author' && !unit) return { provider_session_id: undefined };
  let recovered: Partial<WorkUnitExecutionContext> | undefined;
  for (const event of [...events].reverse()) {
    if (event.type !== 'agent_invoke_start' || !event.invoke_id || !event.phase || event.invoke_id === context.attemptId
      || event.invoke_id === `${context.phase}-${context.attemptId}`
      || workUnitExecutionRole({ phase: event.phase }, (event as Record<string, any>).purpose) !== role
      || role === 'verifier' && event.phase !== context.phase) continue;
    const dir = path.resolve(context.runDir, 'phases', event.phase, event.invoke_id);
    if (!dir.startsWith(path.resolve(context.runDir) + path.sep) || !fs.existsSync(dir)) continue;
    const names = fs.readdirSync(dir).filter(name => /^request-e\d+\.json$/.test(name)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
    if (!names.length) continue;
    const request = JSON.parse(fs.readFileSync(path.join(dir, names[0]), 'utf8')) as { context: WorkUnitExecutionContext; purpose?: string };
    const previous = request.context;
    if (previous.attemptId === context.attemptId && previous.phase === context.phase
      && previous.owner.owner_id === context.owner.owner_id && previous.owner.epoch === context.owner.epoch) continue;
    if (previous.runId !== context.runId || previous.feature !== context.feature
      || previous.adapter !== context.adapter || previous.adapterModel !== context.adapterModel
      || path.resolve(previous.projectRoot) !== path.resolve(context.projectRoot)
      || workUnitExecutionRole(previous, request.purpose) !== role) continue;
    const at = events.indexOf(event);
    if (role === 'author' && authorUnit(previous, events, at) !== unit) continue;
    const nextStart = events.findIndex((row, index) => index > at && row.type === 'agent_invoke_start' && row.invoke_id !== event.invoke_id);
    const reconciled = events.slice(at + 1).some(row =>
      ['agent_invoke_end', 'agent_process_settled', 'orphan_reclaimed', 'agent_invoke_recovered'].includes(row.type ?? '') && row.invoke_id === event.invoke_id)
      || events.slice(at + 1, nextStart < 0 ? undefined : nextStart).some(row => row.type === 'legacy_run_override'
        && (!(row as Record<string, any>).run_id || (row as Record<string, any>).run_id === context.runId));
    if (!reconciled) {
      let nativeId = previous.provider_session_id;
      try { nativeId = readProviderSessionId(path.join(dir, 'agent-events.jsonl'), context.adapter) ?? nativeId; }
      catch { /* Conflicting raw identities remain unknown; they cannot authorize another author. */ }
      return { status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', skipped: true,
        command: 'phase_execute_request', ...(nativeId ? { provider_session_id: nativeId } : {}),
        details: `原${role === 'author' ? '作者' : '独立核验'}调用 ${event.invoke_id}（${event.phase}）尚无真实结束或回收/调和事实；保留原请求 ${path.join(dir, names[0])}，原生SID=${nativeId ?? '尚未记录可核实ID'}。等待该原调用真实交回、进程退出及owner对账；事实补齐后沿原run的next/resume继续，不启动第二个执行者，也不补写原生结束。` };
    }
    if (role === 'verifier' || recovered) continue;
    const ended = [...events].reverse().find(row => row.type === 'agent_invoke_end' && row.invoke_id === event.invoke_id);
    const unavailable = (ended as Record<string, any> | undefined)?.nativeSessionRebuildReason;
    if (unavailable === 'provider_session_not_found' || unavailable === 'provider_session_id_conflict' || unavailable === 'provider_session_resume_not_accepted') { recovered = rebuildWorkUnitExecutionContext(context, unavailable); continue; }
    // A native session must not retain a previous permission contract after authority changes.
    const reason = providerSessionRebuildReason(context.adapter, { previousAuthorization: previous.authority, authorization: context.authority });
    if (reason) { recovered = rebuildWorkUnitExecutionContext(context, reason); continue; }
    try {
      const id = readProviderSessionId(path.join(dir, 'agent-events.jsonl'), context.adapter);
      recovered = id ? { provider_session_id: id } : rebuildWorkUnitExecutionContext(context, '上一调用未留下可恢复的原生ID，不猜最近会话');
    } catch (error) {
      if (!(error as Error).message.startsWith('provider_session_id_conflict:')) throw error;
      recovered = rebuildWorkUnitExecutionContext(context, '原始流的会话ID冲突，不复用冲突ID');
    }
  }
  return recovered ?? { provider_session_id: undefined };
}

export function validateWorkUnitExecutionContext(context: WorkUnitExecutionContext): void {
  if (!context.runId || !context.feature || !context.workflowId || !context.phase || !context.attemptId) {
    throw new Error('[goal-phase-runtime] runtime context identity is incomplete');
  }
  if (context.owner.run_id !== context.runId) {
    throw new Error('[goal-phase-runtime] owner fence run_id does not match execution context');
  }
  if (context.user_deadline_at && !Number.isFinite(Date.parse(context.user_deadline_at))) throw new Error('[goal-phase-runtime] invalid user deadline');
  const baselineApplicable = context.chain.some((phase) => phase === 'coding' || phase === 'ut');
  if (baselineApplicable && !/^[0-9a-f]{40}$/.test(context.runtimeFacts.runBaseSha ?? '')) {
    throw new Error('[goal-phase-runtime] framework_corruption: immutable run_base_sha is unavailable');
  }
  if (Object.keys(context.childEnv).some((key) => key.toUpperCase() === 'HARNESS_DIFF_BASE_REF')) {
    throw new Error('[goal-phase-runtime] HARNESS_DIFF_BASE_REF must be scrubbed from goal child env');
  }
}

export type AttendedPhaseCallback = (
  context: WorkUnitExecutionContext,
  controls?: WorkUnitExecutionControls,
) => Promise<{ status: GoalPhaseExecutorStatus; phase?: string; details?: string }>;

/** Existing phase_execute_request transport, with no gate or lifecycle policy. */
export class AttendedGoalPhaseExecutor implements GoalPhaseExecutor {
  constructor(private readonly callback: AttendedPhaseCallback) {}

  async execute(context: WorkUnitExecutionContext, controls?: WorkUnitExecutionControls): Promise<GoalPhaseExecutorResult> {
    const stopped = stoppedBeforeExecution(context, controls);
    if (stopped) return stopped;
    const result = await this.callback(context, controls);
    if (result.phase && result.phase !== context.phase) {
      throw new Error(
        `[goal-phase-executor] attended phase mismatch: ${result.phase} != ${context.phase}`,
      );
    }
    return {
      status: result.status,
      phase: context.phase,
      details: result.details,
      exitCode: result.status === 'failed' ? 1 : 0,
      stdout: '',
      stderr: result.status === 'failed' ? result.details ?? '' : '',
      command: 'phase_execute_request',
    };
  }
}

export interface DetachedInvocation {
  plan: HeadlessInvokePlan;
  cwd: string;
  options?: AgentInvokeOptions;
}

export type DetachedInvocationResolver = (
  context: WorkUnitExecutionContext,
) => DetachedInvocation;

/** Adapter process transport only. All gate/verdict/backtrack decisions remain runtime-owned. */
export class DetachedGoalPhaseExecutor implements GoalPhaseExecutor {
  constructor(
    private readonly resolveInvocation: DetachedInvocationResolver,
    private readonly invoke: typeof invokeAgentHeadless = invokeAgentHeadless,
  ) {}

  async execute(context: WorkUnitExecutionContext, controls?: WorkUnitExecutionControls): Promise<GoalPhaseExecutorResult> {
    const stopped = stoppedBeforeExecution(context, controls);
    if (stopped) return stopped;
    const invocation = this.resolveInvocation(context);
    if (!invocation.options?.dryRun && fs.existsSync(path.join(context.runDir, 'run-control.json'))) {
      assertFencedOwner(context.runDir, context.owner, 'work_unit_execution');
    }
    const { timeoutMs: _phaseTimeout, deadlineMs: _phaseDeadline, ...options } = invocation.options ?? {};
    const candidate = context.runDir ? executionRequestForInvoke(context.runDir) : null;
    const originalRequest = candidate?.request.context.attemptId === context.attemptId && candidate.request.context.owner.owner_id === context.owner.owner_id
      && candidate.request.context.owner.epoch === context.owner.epoch ? candidate : null;
    const toolDeadline = originalRequest?.request.purpose === 'vision_canary' ? sessionExecutionDeadlineMs(originalRequest.request) : Infinity;
    if (Number.isFinite(toolDeadline) && toolDeadline <= Date.now()) return {
      status: 'waiting', phase: context.phase, exitCode: 1, stdout: '', stderr: '', command: 'phase_execute_request', skipped: true, timed_out: true,
      details: '原视觉金丝雀工具窗口已到；保留原请求与结果，不重置截止或启动新的工具进程。',
    };
    const eventsBefore = context.provider_session_id ? loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl')) : [];
    const snapshotBefore = context.provider_session_id && originalRequest?.request.write_boundary
      ? capturePhaseInvocationSnapshot(originalRequest.request.write_boundary, originalRequest.request.snapshot_options) : null;
    let envelopeObserved = false, workObserved = false, environmentDiagnostic = '';
    const resumeScanner = context.provider_session_id ? createCodexTerminalScanner({ onRecord: record => {
      const type = String(record.type ?? '');
      envelopeObserved ||= context.adapter === 'codex' ? /^(thread\.|turn\.|item\.|error$)/.test(type)
        : ['claude', 'codeagent'].includes(context.adapter) ? ['system', 'assistant', 'user', 'result', 'error'].includes(type)
          : context.adapter === 'deepseek-harness' && ['session', 'status', 'assistant', 'tool_call', 'tool_result', 'error'].includes(type);
      workObserved ||= !!extractProviderSessionId(record, context.adapter) || isProviderToolResult(record, context.adapter)
        || ['turn.started', 'item.started', 'assistant', 'tool_call'].includes(type);
      if (type === 'error' || type === 'turn.failed' || type === 'result' && record.is_error === true
        || type === 'system' && record.subtype === 'api_retry') environmentDiagnostic = JSON.stringify(record);
    } }, resolveTerminalEventParser(context.adapter)) : null;
    let result: AgentInvokeResult & Partial<Pick<GoalPhaseExecutorResult, 'status' | 'details'>> = await this.invoke(invocation.plan, invocation.cwd, { ...options,
      providerSessionId: context.provider_session_id,
      userDeadlineAt: context.user_deadline_at,
      ...(Number.isFinite(toolDeadline) ? { deadlineMs: toolDeadline, timeoutMs: Math.max(1, toolDeadline - Date.now()) } : {}),
      authorization: context.authority,
      executionRole: workUnitExecutionRole(context),
      readonlyInvocation: workUnitNativeReadonly(context),
      ...(controls?.signal ? { signal: controls.signal } : {}),
      onObservation: observation => {
        options.onObservation?.(observation);
        if (observation.type === 'stdout' && observation.chunk) resumeScanner?.push(observation.chunk);
        if (observation.type === 'provider_session' || observation.type === 'tool_result') workObserved = true;
        if (!controls?.onObservation || !context.runDir || !['provider_session', 'tool_result', 'terminal'].includes(observation.type)) return;
        if (originalRequest) controls.onObservation(observeSessionExecution(context.runDir, originalRequest));
      },
    });
    if (resumeScanner) {
      if (!envelopeObserved) resumeScanner.push(result.stdout);
      resumeScanner.flush();
      const events = loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl'));
      const ownIds = new Set([context.attemptId, `${context.phase}-${context.attemptId}`, ...(originalRequest ? [originalRequest.request.invoke_id] : [])]);
      workObserved ||= events.slice(eventsBefore.length).some(event => !!event.invoke_id && ownIds.has(event.invoke_id) && ['harness_start', 'harness_end', 'phase_write_observed'].includes(event.type ?? ''));
      const changes = snapshotBefore && originalRequest?.request.write_boundary
        ? diffPhaseInvocationSnapshots(snapshotBefore, capturePhaseInvocationSnapshot(originalRequest.request.write_boundary, originalRequest.request.snapshot_options)) : null;
      const environmentFailure = /\b(?:401|403|429|5\d\d)\b|(?:authentication|authorization)\s+(?:failed|error|required|expired)|unauthori[sz]ed|permission denied|not logged in|please (?:log|sign) in|quota|rate[ _-]?limit|usage[ _-]?limit|insufficient credits?|billing (?:error|required|limit)|ECONN|ETIMEDOUT|fetch failed|socket hang up/i.test(result.stderr + '\n' + environmentDiagnostic);
      if (workObserved || changes?.kind === 'changed' || environmentFailure) {
        // A real attempt must keep its failure/writes; a session diagnostic cannot buy a clean replay.
        if (result.nativeSessionRebuildReason === 'provider_session_not_found') result = { ...result, nativeSessionRebuildReason: undefined };
      } else {
        if (!envelopeObserved && !result.skipped
          && !result.spawn_error && !result.timed_out && !result.interrupted && !result.terminal_failure_observed && !result.signal && !controls?.signal?.aborted) {
          result = changes?.kind === 'clean'
            ? { ...result, exitCode: result.exitCode || 1, nativeSessionRebuildReason: result.nativeSessionRebuildReason ?? 'provider_session_resume_not_accepted',
              details: '准确原生续接已退出，缺有效结构信封，原签发快照及已保存工具事实均未见本次开始工作的证据；保留原调用，按当前目标、授权、成果与未完项重建专用上下文。' }
            : { ...result, status: 'waiting', exitCode: result.exitCode || 1, nativeSessionRebuildReason: undefined,
              details: '准确原生续接已退出且缺有效结构信封；当前缺可信写入对账，无法确认是否已执行。保留原调用及成果，补齐该原请求的真实执行/写入事实后继续，不自动重放。' };
        }
      }
      if (!workObserved && changes?.kind !== 'changed' && environmentFailure && !invocationCompleted({ ...result, exitCode: result.exitCode || 1 })) {
        result = { ...result, status: 'waiting', exitCode: result.exitCode || 1, nativeSessionRebuildReason: undefined,
          details: '原生续接返回认证、额度或服务故障；保留原SID、失败与成果，实际环境恢复后沿原请求继续，不把环境故障当作会话丢失。' };
      }
    }
    const interrupted = context.runDir && loadAuthoritativeEvents(path.join(context.runDir, 'events.jsonl')).some(event =>
      (event.type === 'agent_process_settled' && event.interrupted === true || event.type === 'phase_halt' && event.halt_reason === 'executor_waiting')
      && (event.invoke_id === originalRequest?.request.invoke_id || event.invoke_id === context.attemptId || event.invoke_id === `${context.phase}-${context.attemptId}`));
    if (interrupted && !invocationCompleted(result)) result = { ...result, interrupted: true };
    const waitingDetail = invocationWaitingDetail(result);
    return {
      ...result,
      status: waitingDetail || result.interrupted && !invocationCompleted(result) ? 'waiting' : invocationCompleted(result) ? 'passed' : 'failed',
      ...(waitingDetail ? { details: waitingDetail } : result.interrupted ? { details: '当前执行已中断；实际调用流和合法成果已保留，可按原请求继续。' } : {}),
      phase: context.phase,
    };
  }
}

export const PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS = Object.freeze([
  'hylyre',
  'vendor',
  'vendor_artifact_kind',
  'provider_installation',
  'build_src',
] as const);
