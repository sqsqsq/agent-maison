import type { ExecutionScope } from '../../scripts/utils/execution-scope';

export interface HistoryFinding { index: number; kind: 'waiting_advanced' | 'owner_skipped' | 'owner_absent' | 'unsafe_guidance' | 'execution_misclassified'; phase?: string; }
export type HistoryEvent = Record<string, any>;

/** Development-only checks of existing goal-runner/goal-mode-operations promises, not a scheduler. */
export function auditHostHistory(birth: ExecutionScope, events: HistoryEvent[], executionDiagnosis?: string): HistoryFinding[] {
  const findings: HistoryFinding[] = [];
  let scope = birth;
  let waiting: string | undefined;
  let newOwners: string[] = [];
  events.forEach((event, index) => {
    if (['run_start', 'resume', 'device_ready'].includes(event.type)) waiting = undefined;
    if (event.type === 'phase_halt' && event.run_disposition === 'WAITING') waiting = event.phase;
    if (event.type === 'phase_verdict' && event.phase === waiting && event.action === 'defer_external_and_continue_if_allowed') waiting = undefined;
    if (event.type === 'scope_revised') {
      const next = event.execution_scope as ExecutionScope;
      newOwners = next.obligations.filter(o => o.applicability === 'required' && !o.satisfied_by?.length
        && !scope.obligations.some(prior => prior.id === o.id)).map(o => o.owner_phase)
        .filter(owner => next.phase_chain.includes(owner));
      scope = next;
    }
    if (event.type === 'phase_start') {
      if (waiting) findings.push({ index, kind: 'waiting_advanced', phase: event.phase });
      const firstOwner = newOwners.sort((a, b) => scope.phase_chain.indexOf(a) - scope.phase_chain.indexOf(b))[0];
      if (firstOwner && scope.phase_chain.indexOf(event.phase) > scope.phase_chain.indexOf(firstOwner)) findings.push({ index, kind: 'owner_skipped', phase: firstOwner });
      newOwners = [];
    }
    if (event.type === 'phase_halt' && event.halt_reason === 'backtrack_target_absent'
      && scope.completion_target === 'feature' && scope.obligations.some(o => o.owner_phase === event.target_phase && o.applicability === 'required')) {
      findings.push({ index, kind: 'owner_absent', phase: event.target_phase });
    }
    // Match the prohibited positive recipe, not warnings or legitimate explicit user commands.
    if (event.type === 'phase_halt' && /起 fresh successor run，用.*--supersede/.test(event.halt_guidance ?? '')) {
      findings.push({ index, kind: 'unsafe_guidance', phase: event.phase });
    }
    if (event.type === 'phase_verdict' && event.phase === 'ut' && event.failure_kind_classified === 'code_regression'
      && executionDiagnosis === 'aa_test_no_result') findings.push({ index, kind: 'execution_misclassified', phase: event.phase });
  });
  return findings;
}
