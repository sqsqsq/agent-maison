import type { HeadlessInvokePlan, AgentInvokeOptions, AgentInvokeResult } from './agent-invoke';
import { invokeAgentHeadless } from './agent-invoke';
import type { RunFenceToken, RunOwnerKind } from './goal-run-control';

export interface PhaseExecutionContext {
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
}

export interface GoalPhaseExecutor {
  execute(context: PhaseExecutionContext): Promise<GoalPhaseExecutorResult>;
}

function deepFreezeContext(input: PhaseExecutionContext): PhaseExecutionContext {
  const childEnv = { ...input.childEnv };
  for (const key of Object.keys(childEnv)) {
    if (key.toUpperCase() === 'HARNESS_DIFF_BASE_REF') delete childEnv[key];
  }
  const context: PhaseExecutionContext = {
    ...input,
    chain: Object.freeze([...input.chain]),
    owner: Object.freeze({ ...input.owner }),
    runtimeFacts: Object.freeze({ ...input.runtimeFacts }),
    childEnv: Object.freeze(childEnv),
  };
  return Object.freeze(context);
}

export function createPhaseExecutionContext(input: PhaseExecutionContext): PhaseExecutionContext {
  return deepFreezeContext(input);
}

export function validatePhaseExecutionContext(context: PhaseExecutionContext): void {
  if (!context.runId || !context.feature || !context.workflowId || !context.phase || !context.attemptId) {
    throw new Error('[goal-phase-runtime] runtime context identity is incomplete');
  }
  if (context.owner.run_id !== context.runId) {
    throw new Error('[goal-phase-runtime] owner fence run_id does not match execution context');
  }
  if (!context.chain.includes(context.phase)) {
    throw new Error(`[goal-phase-runtime] phase ${context.phase} is outside the resolved workflow chain`);
  }
  const baselineApplicable = context.chain.some((phase) => phase === 'coding' || phase === 'ut');
  if (baselineApplicable && !/^[0-9a-f]{40}$/.test(context.runtimeFacts.runBaseSha ?? '')) {
    throw new Error('[goal-phase-runtime] framework_corruption: immutable run_base_sha is unavailable');
  }
  if (Object.keys(context.childEnv).some((key) => key.toUpperCase() === 'HARNESS_DIFF_BASE_REF')) {
    throw new Error('[goal-phase-runtime] HARNESS_DIFF_BASE_REF must be scrubbed from goal child env');
  }
}

export type AttendedPhaseCallback = (
  context: PhaseExecutionContext,
) => Promise<{ status: GoalPhaseExecutorStatus; phase?: string; details?: string }>;

/** Existing phase_execute_request transport, with no gate or lifecycle policy. */
export class AttendedGoalPhaseExecutor implements GoalPhaseExecutor {
  constructor(private readonly callback: AttendedPhaseCallback) {}

  async execute(context: PhaseExecutionContext): Promise<GoalPhaseExecutorResult> {
    const result = await this.callback(context);
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
  context: PhaseExecutionContext,
) => DetachedInvocation;

/** Adapter process transport only. All gate/verdict/backtrack decisions remain runtime-owned. */
export class DetachedGoalPhaseExecutor implements GoalPhaseExecutor {
  constructor(
    private readonly resolveInvocation: DetachedInvocationResolver,
    private readonly invoke: typeof invokeAgentHeadless = invokeAgentHeadless,
  ) {}

  async execute(context: PhaseExecutionContext): Promise<GoalPhaseExecutorResult> {
    const invocation = this.resolveInvocation(context);
    const result = await this.invoke(invocation.plan, invocation.cwd, invocation.options);
    return {
      ...result,
      status: result.exitCode === 0 || result.completion_observed === true ? 'passed' : 'failed',
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
