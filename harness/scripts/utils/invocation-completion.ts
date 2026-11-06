import type { AgentInvokeResult } from './agent-invoke';

/** Existing transport/event facts only; completion does not imply a gate or product PASS. */
export interface InvocationCompletionFacts {
  readonly status?: unknown;
  readonly exitCode?: unknown;
  readonly completion_observed?: unknown;
  readonly terminal_failure_observed?: unknown;
  readonly timed_out?: unknown;
  readonly silent_killed?: unknown;
  readonly skipped?: unknown;
  readonly spawn_error?: unknown;
  readonly kill_reason?: unknown;
  readonly interrupted?: unknown;
  readonly model_binding_mismatch?: unknown;
}

export function invocationCompleted(facts: InvocationCompletionFacts): boolean {
  if (facts.status === 'waiting' || facts.status === 'failed' || facts.skipped === true || facts.interrupted === true) return false;
  if (facts.timed_out === true || facts.kill_reason === 'agent_timeout' || facts.silent_killed === true ||
      facts.terminal_failure_observed === true || facts.spawn_error || facts.model_binding_mismatch) return false;
  return facts.exitCode === 0 || facts.completion_observed === true;
}

/** A transport's newly received waiting result is an external pause, never another author turn. */
export function invocationWaitingDetail(facts: InvocationCompletionFacts & { details?: string; detail?: string }): string | undefined {
  if (facts.status !== 'waiting') return undefined;
  const detail = facts.details ?? facts.detail;
  return detail?.trim() ? detail : '执行者报告等待，尚未提供具体解除条件；补齐真实条件后继续原请求。';
}

/** Project the same native end facts into process, waiting and accepted-session records. */
export function invocationEndFacts(facts: Partial<AgentInvokeResult> & { exit_code?: number; kill_reason?: string }) {
  return {
    exit_code: facts.exitCode ?? facts.exit_code,
    skipped: facts.skipped, timed_out: facts.timed_out, silent_killed: facts.silent_killed,
    interrupted: facts.interrupted, signal: facts.signal, spawn_error: facts.spawn_error,
    completion_observed: facts.completion_observed, terminal_failure_observed: facts.terminal_failure_observed,
    terminal_error_excerpt: facts.terminal_error_excerpt,
    model_binding_mismatch: facts.model_binding_mismatch,
    kill_reason: facts.kill_reason ?? (facts.timed_out === true ? 'agent_timeout' : undefined),
    provider_session_id: facts.provider_session_id, nativeSessionRebuildReason: facts.nativeSessionRebuildReason,
    readonly_enforced: facts.readonly_enforced, readonly_diagnostic: facts.readonly_diagnostic,
  };
}
