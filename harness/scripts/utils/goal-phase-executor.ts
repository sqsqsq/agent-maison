import type { HeadlessInvokePlan, AgentInvokeOptions, AgentInvokeResult } from './agent-invoke';
import { invokeAgentHeadless, readProviderSessionId, providerSessionRebuildReason } from './agent-invoke';
import { invocationCompleted, invocationWaitingDetail } from './invocation-completion';
import type { RunFenceToken, RunOwnerKind } from './goal-run-control';
import type { UnattendedContract, GoalRunManifest } from './goal-manifest';
import { loadGoalRunManifestFromRun, effectiveHeadlessUnattended } from './goal-manifest';
import { loadAuthoritativeEvents } from './goal-runner-phase';
import * as fs from 'fs';
import * as path from 'path';
import { assertFencedOwner } from './goal-run-control';
import { executionRequestForInvoke, observeSessionExecution } from './session-execution-handoff';

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
  const { write_mode, approval_mode, allowed_tools } = effectiveHeadlessUnattended(manifest.unattended);
  const origin = projectRoot && manifest.delivery_origin && (manifest.delivery_origin.feature !== manifest.feature || manifest.delivery_origin.run_id !== manifest.run_id)
    ? loadGoalRunManifestFromRun(projectRoot, manifest.delivery_origin.run_id, { feature: manifest.delivery_origin.feature }) : undefined;
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

export function createWorkUnitExecutionContext(input: WorkUnitExecutionContext): WorkUnitExecutionContext {
  return deepFreezeContext({ ...input, ...recoverWorkUnitProviderSession(input) });
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

/** Native identity is recovered only from this run's original invocation stream. */
export function recoverWorkUnitProviderSession(context: WorkUnitExecutionContext): Partial<WorkUnitExecutionContext> {
  if (workUnitExecutionRole(context) === 'verifier') return { provider_session_id: undefined };
  if (context.provider_session_id) return { provider_session_id: context.provider_session_id };
  const eventsPath = path.join(context.runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return {};
  const events = loadAuthoritativeEvents(eventsPath);
  for (const event of [...events].reverse()) {
    if (event.type !== 'agent_invoke_start' || !event.invoke_id || !event.phase || event.invoke_id === context.attemptId
      || event.invoke_id === `${context.phase}-${context.attemptId}`
      || workUnitExecutionRole({ phase: event.phase }, (event as Record<string, any>).purpose) !== 'author') continue;
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
      || workUnitExecutionRole(previous, request.purpose) !== 'author') continue;
    const at = events.indexOf(event);
    const nextStart = events.findIndex((row, index) => index > at && row.type === 'agent_invoke_start' && row.invoke_id !== event.invoke_id);
    const reconciled = events.slice(at + 1).some(row =>
      ['agent_invoke_end', 'agent_process_settled', 'orphan_reclaimed', 'agent_invoke_recovered'].includes(row.type ?? '') && row.invoke_id === event.invoke_id)
      || events.slice(at + 1, nextStart < 0 ? undefined : nextStart).some(row => row.type === 'legacy_run_override'
        && (!(row as Record<string, any>).run_id || (row as Record<string, any>).run_id === context.runId));
    if (!reconciled) {
      throw new Error('[work-unit-execution] the previous author invocation is still outstanding; reconcile it before another execution');
    }
    const ended = [...events].reverse().find(row => row.type === 'agent_invoke_end' && row.invoke_id === event.invoke_id);
    const unavailable = (ended as Record<string, any> | undefined)?.nativeSessionRebuildReason;
    if (unavailable === 'provider_session_not_found' || unavailable === 'provider_session_id_conflict') return rebuildWorkUnitExecutionContext(context, unavailable);
    // A native session must not retain a previous permission contract after authority changes.
    const reason = providerSessionRebuildReason(context.adapter, { previousAuthorization: previous.authority, authorization: context.authority });
    if (reason) return rebuildWorkUnitExecutionContext(context, reason);
    try {
      const id = readProviderSessionId(path.join(dir, 'agent-events.jsonl'), context.adapter);
      return id ? { provider_session_id: id } : rebuildWorkUnitExecutionContext(context, '上一调用未留下可恢复的原生ID，不猜最近会话');
    } catch (error) {
      if (!(error as Error).message.startsWith('provider_session_id_conflict:')) throw error;
      return rebuildWorkUnitExecutionContext(context, '原始流的会话ID冲突，不复用冲突ID');
    }
  }
  return {};
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
    let result = await this.invoke(invocation.plan, invocation.cwd, { ...options,
      providerSessionId: context.provider_session_id,
      userDeadlineAt: context.user_deadline_at,
      authorization: context.authority,
      executionRole: workUnitExecutionRole(context),
      readonlyInvocation: workUnitNativeReadonly(context),
      ...(controls?.signal ? { signal: controls.signal } : {}),
      onObservation: observation => {
        options.onObservation?.(observation);
        if (!controls?.onObservation || !context.runDir || !['provider_session', 'tool_result', 'terminal'].includes(observation.type)) return;
        if (originalRequest) controls.onObservation(observeSessionExecution(context.runDir, originalRequest));
      },
    });
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
