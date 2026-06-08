/**
 * Goal-runner phase helpers — summary freshness, resume chain, event parsing (unit-testable).
 */

import * as fs from 'fs';
import type { GoalPhaseOutcome } from './goal-report-generator';
import type {
  FeaturePhase,
  HarnessVerdict,
  PhaseVerdictAction,
} from './phase-transition-policy';
import { FEATURE_PHASE_ORDER } from './phase-transition-policy';

const FEATURE_PHASE_SET = new Set<string>(FEATURE_PHASE_ORDER);

export function getSummaryMtime(summaryPath: string | null): number | null {
  if (!summaryPath || !fs.existsSync(summaryPath)) return null;
  return fs.statSync(summaryPath).mtimeMs;
}

/** Summary is fresh when newly created or mtime advanced since phase start. */
export function isSummaryFresh(beforeMtime: number | null, afterMtime: number | null): boolean {
  if (afterMtime === null) return false;
  if (beforeMtime === null) return true;
  return afterMtime > beforeMtime;
}

export interface PhaseVerdictResolveInput {
  dryRun: boolean;
  agentExitCode: number;
  agentSkipped?: boolean;
  harnessExitCode: number;
  summaryBeforeMtime: number | null;
  summaryAfterMtime: number | null;
  summaryVerdict?: HarnessVerdict;
}

export interface PhaseVerdictResolveResult {
  verdict: HarnessVerdict;
  stale_summary: boolean;
  agent_failed: boolean;
}

/**
 * Resolve harness verdict for a phase run. Rejects stale on-disk summary.json
 * when agent/harness did not produce a fresh artifact.
 */
export function resolvePhaseHarnessVerdict(input: PhaseVerdictResolveInput): PhaseVerdictResolveResult {
  const fresh = isSummaryFresh(input.summaryBeforeMtime, input.summaryAfterMtime);
  const agentFailed = !input.agentSkipped && input.agentExitCode !== 0;

  if (input.dryRun) {
    const verdict = (input.summaryVerdict ?? 'PASS') as HarnessVerdict;
    return { verdict, stale_summary: false, agent_failed: false };
  }

  if (fresh && input.summaryVerdict) {
    return { verdict: input.summaryVerdict, stale_summary: false, agent_failed: agentFailed };
  }

  if (fresh && !input.summaryVerdict) {
    return { verdict: 'FAIL', stale_summary: false, agent_failed: agentFailed };
  }

  const stale = input.summaryAfterMtime !== null && !fresh;
  if (stale || agentFailed || input.harnessExitCode !== 0 || input.summaryAfterMtime === null) {
    return { verdict: 'FAIL', stale_summary: stale, agent_failed: agentFailed };
  }

  return { verdict: 'FAIL', stale_summary: false, agent_failed: agentFailed };
}

export interface GoalRunEvent {
  type?: string;
  phase?: string;
  action?: PhaseVerdictAction;
  verdict?: string;
  status?: string;
}

/** Check run budget before each phase attempt (turns + wall clock). */
export function checkRunBudget(
  totalTurns: number,
  maxTotalTurns: number,
  elapsedMs: number,
  wallClockMs: number,
): 'ok' | 'wall_clock' | 'turns' {
  if (elapsedMs > wallClockMs) return 'wall_clock';
  if (totalTurns >= maxTotalTurns) return 'turns';
  return 'ok';
}

/**
 * Rebuild terminal phase outcomes from events.jsonl (when goal-report.json is missing).
 * Ignores non-terminal `retry` verdicts; orders by chain.
 */
export function rebuildOutcomesFromEvents(
  events: GoalRunEvent[],
  chain: FeaturePhase[],
): GoalPhaseOutcome[] {
  const lastTerminal = new Map<FeaturePhase, GoalRunEvent>();
  for (const e of events) {
    if (e.type !== 'phase_verdict' || !e.phase || !FEATURE_PHASE_SET.has(e.phase)) continue;
    if (e.action === 'retry') continue;
    lastTerminal.set(e.phase as FeaturePhase, e);
  }

  const outcomes: GoalPhaseOutcome[] = [];
  for (const phase of chain) {
    const e = lastTerminal.get(phase);
    if (!e) break;

    const verdict = (e.verdict ?? 'FAIL') as string;
    if (e.action === 'advance') {
      outcomes.push({ phase, verdict });
      continue;
    }
    if (
      e.action === 'defer_external_and_continue_if_allowed' ||
      e.action === 'defer_external_and_halt'
    ) {
      outcomes.push({
        phase,
        verdict,
        deferred: true,
        deferred_reason: 'external_blocked',
      });
      continue;
    }
    if (e.action === 'halt') {
      outcomes.push({ phase, verdict, halted: true });
      break;
    }
    break;
  }
  return outcomes;
}

/** Resume state from events when goal-report.json is absent. */
export function resolveResumeFromEvents(
  chain: FeaturePhase[],
  events: GoalRunEvent[],
): ResumeState {
  const priorOutcomes = rebuildOutcomesFromEvents(events, chain);
  return resolveResumeState(chain, priorOutcomes);
}

/** Phases finished (PASS advance or DEFERRED) from events.jsonl. */
export function parseCompletedPhasesFromEvents(events: GoalRunEvent[]): Set<FeaturePhase> {
  const done = new Set<FeaturePhase>();
  for (const e of events) {
    if (e.type !== 'phase_verdict' || !e.phase || !FEATURE_PHASE_SET.has(e.phase)) continue;
    if (
      e.action === 'advance' ||
      e.action === 'defer_external_and_continue_if_allowed' ||
      e.action === 'defer_external_and_halt'
    ) {
      done.add(e.phase as FeaturePhase);
    }
  }
  return done;
}

export function loadEventsJsonl(absPath: string): GoalRunEvent[] {
  if (!fs.existsSync(absPath)) return [];
  const lines = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const out: GoalRunEvent[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as GoalRunEvent);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export interface ResumeState {
  priorOutcomes: GoalPhaseOutcome[];
  startIndex: number;
  deferredUpstream: Array<{ phase: FeaturePhase; reason: string }>;
}

/**
 * Determine resume index and rehydrate prior outcomes from goal-report or events.
 */
export function resolveResumeState(
  chain: FeaturePhase[],
  priorOutcomes: GoalPhaseOutcome[],
): ResumeState {
  const deferredUpstream = priorOutcomes
    .filter((o) => o.deferred)
    .map((o) => ({
      phase: o.phase,
      reason: o.deferred_reason ?? 'external_blocked',
    }));

  if (priorOutcomes.length === 0) {
    return { priorOutcomes: [], startIndex: 0, deferredUpstream: [] };
  }

  const last = priorOutcomes[priorOutcomes.length - 1];
  if (last.halted) {
    const idx = chain.indexOf(last.phase);
    return {
      priorOutcomes: priorOutcomes.slice(0, -1),
      startIndex: idx >= 0 ? idx : 0,
      deferredUpstream,
    };
  }

  const done = new Set(priorOutcomes.map((o) => o.phase));
  let startIndex = chain.length;
  for (let i = 0; i < chain.length; i++) {
    if (!done.has(chain[i])) {
      startIndex = i;
      break;
    }
  }

  return { priorOutcomes, startIndex, deferredUpstream };
}
