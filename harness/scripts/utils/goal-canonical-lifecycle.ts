import type { GoalRunEvent } from './goal-runner-phase';
import type { RunOwnerKind } from './goal-run-control';

export type CanonicalLifecycleEvent =
  | { type: 'run_created'; manifest_identity_hash?: string; run_base_sha_digest?: string }
  | { type: 'phase_start'; phase: string }
  | {
      type: 'phase_verdict';
      phase: string;
      verdict?: string;
      action?: string;
      halt_reason?: string;
      failure_kind?: string;
      blocking_class?: string;
      advance_blocked?: boolean;
    }
  | { type: 'phase_halt'; phase: string; halt_reason?: string }
  | {
      type: 'phase_backtrack_requested';
      phase?: string;
      from_phase?: string;
      to_phase?: string;
      invalidated_phases?: string[];
    }
  | { type: 'owner_handoff'; from: RunOwnerKind; to: RunOwnerKind; outcome: 'success' | 'failed' | 'pending' }
  | { type: 'run_end'; status?: string; halt_reason?: string };

type EventRecord = GoalRunEvent & Record<string, unknown>;

const EXECUTOR_PRIVATE_EVENT = /^(agent_invoke_|agent_process_|adapter_|stdio_|lease_)/;
const HANDOFF_RAW_TYPES = new Set([
  'handoff_requested',
  'handoff_accepted',
  'handoff_rejected',
  'owner_handoff',
]);

function ownerKind(value: unknown): RunOwnerKind | null {
  return value === 'process' || value === 'session' ? value : null;
}

function opposite(owner: RunOwnerKind): RunOwnerKind {
  return owner === 'process' ? 'session' : 'process';
}

interface HandoffProjection {
  firstIndex: number;
  from: RunOwnerKind;
  to: RunOwnerKind;
  outcome: 'success' | 'failed' | 'pending';
}

function deriveHandoffs(events: readonly EventRecord[]): Map<number, HandoffProjection> {
  const byKey = new Map<string, HandoffProjection>();
  events.forEach((event, index) => {
    if (!HANDOFF_RAW_TYPES.has(String(event.type))) return;
    const explicitFrom = ownerKind(event.from);
    const explicitTo = ownerKind(event.to);
    const target = ownerKind(event.target_owner_kind) ?? ownerKind(event.owner_kind) ?? explicitTo;
    const from = explicitFrom ?? (target ? opposite(target) : null);
    const to = target ?? (from ? opposite(from) : null);
    if (!from || !to) return;
    const key = typeof event.request_id === 'string' && event.request_id
      ? `request:${event.request_id}`
      : `index:${index}`;
    const current = byKey.get(key) ?? { firstIndex: index, from, to, outcome: 'pending' as const };
    if (event.type === 'handoff_accepted' || event.outcome === 'success') current.outcome = 'success';
    else if (event.type === 'handoff_rejected' || event.outcome === 'failed') current.outcome = 'failed';
    current.from = from;
    current.to = to;
    byKey.set(key, current);
  });
  return new Map([...byKey.values()].map(value => [value.firstIndex, value]));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Pure semantic projection; executor/transport telemetry never enters the returned sequence. */
export function projectCanonicalLifecycle(
  input: readonly (GoalRunEvent | Record<string, unknown>)[],
): CanonicalLifecycleEvent[] {
  const events = input as readonly EventRecord[];
  const handoffs = deriveHandoffs(events);
  const out: CanonicalLifecycleEvent[] = [];
  events.forEach((event, index) => {
    const type = String(event.type ?? '');
    if (EXECUTOR_PRIVATE_EVENT.test(type)) return;
    const handoff = handoffs.get(index);
    if (handoff) {
      out.push({
        type: 'owner_handoff',
        from: handoff.from,
        to: handoff.to,
        outcome: handoff.outcome,
      });
      return;
    }
    if (HANDOFF_RAW_TYPES.has(type)) return;
    const phase = stringValue(event.phase);
    switch (type) {
      case 'run_created':
        out.push({
          type: 'run_created',
          ...(stringValue(event.manifest_identity_hash)
            ? { manifest_identity_hash: stringValue(event.manifest_identity_hash) }
            : {}),
          ...(stringValue(event.run_base_sha_digest)
            ? { run_base_sha_digest: stringValue(event.run_base_sha_digest) }
            : {}),
        });
        break;
      case 'phase_start':
        if (phase) out.push({ type: 'phase_start', phase });
        break;
      case 'phase_verdict':
        if (phase) {
          out.push({
            type: 'phase_verdict',
            phase,
            ...(stringValue(event.verdict) ? { verdict: stringValue(event.verdict) } : {}),
            ...(stringValue(event.action) ? { action: stringValue(event.action) } : {}),
            ...(stringValue(event.halt_reason) ? { halt_reason: stringValue(event.halt_reason) } : {}),
            ...(stringValue(event.failure_kind) ? { failure_kind: stringValue(event.failure_kind) } : {}),
            ...(stringValue(event.blocking_class) ? { blocking_class: stringValue(event.blocking_class) } : {}),
            ...(typeof event.advance_blocked === 'boolean'
              ? { advance_blocked: event.advance_blocked }
              : {}),
          });
        }
        break;
      case 'phase_halt':
        if (phase) {
          out.push({
            type: 'phase_halt',
            phase,
            ...(stringValue(event.halt_reason) ? { halt_reason: stringValue(event.halt_reason) } : {}),
          });
        }
        break;
      case 'phase_backtrack_requested': {
        const invalidated = Array.isArray(event.invalidated_phases)
          ? event.invalidated_phases.filter((item): item is string => typeof item === 'string')
          : undefined;
        out.push({
          type: 'phase_backtrack_requested',
          ...(phase ? { phase } : {}),
          ...(stringValue(event.from_phase) ? { from_phase: stringValue(event.from_phase) } : {}),
          ...(stringValue(event.to_phase) ? { to_phase: stringValue(event.to_phase) } : {}),
          ...(invalidated && invalidated.length > 0 ? { invalidated_phases: invalidated } : {}),
        });
        break;
      }
      case 'run_end':
        out.push({
          type: 'run_end',
          ...(stringValue(event.status) ? { status: stringValue(event.status) } : {}),
          ...(stringValue(event.halt_reason) ? { halt_reason: stringValue(event.halt_reason) } : {}),
        });
        break;
      default:
        break;
    }
  });
  return out;
}
