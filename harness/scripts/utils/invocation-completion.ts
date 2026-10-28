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
}

export function invocationCompleted(facts: InvocationCompletionFacts): boolean {
  if (facts.status === 'waiting' || facts.status === 'failed' || facts.skipped === true) return false;
  if (facts.timed_out === true || facts.kill_reason === 'agent_timeout' || facts.silent_killed === true ||
      facts.terminal_failure_observed === true || facts.spawn_error) return false;
  return facts.exitCode === 0 || facts.completion_observed === true;
}

/** A transport's newly received waiting result is an external pause, never another author turn. */
export function invocationWaitingDetail(facts: InvocationCompletionFacts & { details?: string; detail?: string }): string | undefined {
  if (facts.status !== 'waiting') return undefined;
  const detail = facts.details ?? facts.detail;
  return detail?.trim() ? detail : '执行者报告等待，尚未提供具体解除条件；补齐真实条件后继续原请求。';
}
