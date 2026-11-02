import * as fs from 'fs';
import * as path from 'path';
import { relFeaturesDir, featureFilePath } from '../../config';
import { loadGoalRunManifestFromRun, isInitialDesignManifest, computeManifestIdentityFields, type GoalManifest, type GoalRunManifest, type InitialDesignGoalManifest } from './goal-manifest';
import { enumerateCanonicalChangeUnits, deriveChangeUnitFeatureId, parseChangeUnitFeatureId, loadCanonicalChangeUnit } from './change-unit-path';
import { loadEventsJsonlStrict, partitionExecutionSessions, resolveEffectiveRunEnd, type GoalRunEvent } from './goal-runner-phase';
import { readRunControl } from './goal-run-control';
import { isPidAlive } from './goal-run-lock';
import { readSessionExecution, acceptedSessionReport } from './session-execution-handoff';

export interface DeliveryRunFacts { manifest: GoalRunManifest; events: GoalRunEvent[] }
export interface DeliveryExecutionFacts extends DeliveryRunFacts {
  runDir: string;
  control: ReturnType<typeof readRunControl>;
  request: ReturnType<typeof readSessionExecution>;
}

/** Existing audited successors carry unfinished corrections; a completed-cycle boundary stays sealed. */
export function currentOriginalDelivery(projectRoot: string, original: InitialDesignGoalManifest): InitialDesignGoalManifest {
  const { deliveryCycleView } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const siblings = deliveryCycleView(projectRoot, original.feature).siblings;
  let current = original;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(current.run_id)) throw new Error('[delivery-origin] cyclic original request succession');
    seen.add(current.run_id);
    const successor = siblings.find(run => run.manifest.successor_of === current.run_id && run.events.some(event => event.type === 'supersede'
      && 'target_run_id' in event && event.target_run_id === current.run_id && 'superseding_run_id' in event && event.superseding_run_id === run.runId
      && !('delivery_cycle_boundary' in event && event.delivery_cycle_boundary === current.run_id)));
    if (!successor) return current;
    const next = loadGoalRunManifestFromRun(projectRoot, successor.runId, { feature: original.feature });
    if (!isInitialDesignManifest(next)) throw new Error('[delivery-origin] original request successor is a construction run');
    current = next;
  }
}

/** Actual execution locator only; no quality, liveness verdict or CU selection. */
export function resolveOriginalDeliveryExecution(projectRoot: string, original: InitialDesignGoalManifest,
  runs?: readonly DeliveryRunFacts[]): DeliveryExecutionFacts {
  original = currentOriginalDelivery(projectRoot, original);
  const facts = (runs ?? readOriginalDeliveryRuns(projectRoot, original)).map(run => {
    const runDir = path.resolve(projectRoot, run.manifest.report_dir);
    return { ...run, runDir, control: readRunControl(runDir, run.manifest.run_id), request: readSessionExecution(runDir) };
  });
  const pending = facts.filter(run => run.request && !acceptedSessionReport(run.runDir, run.request)
    && run.control?.owner && run.control.current_epoch === run.request.request.context.owner.epoch
    && run.control.owner.owner_id === run.request.request.context.owner.owner_id
    && ['active', 'orphaned_session'].includes(run.control.owner.state))
    .sort((a, b) => String(a.request?.request.issued_at).localeCompare(String(b.request?.request.issued_at))).at(-1);
  if (pending) return pending;
  const open = facts.filter(run => !resolveEffectiveRunEnd(run.events) && run.control?.owner
    && ['active', 'quiescing', 'orphaned_session'].includes(run.control.owner.state));
  const invoking = open.map(run => {
    const ended = new Set(run.events.filter(event => event.type === 'agent_invoke_end').map(event => event.invoke_id));
    const invoke = [...run.events].reverse().find(event => event.type === 'agent_invoke_start' && !ended.has(event.invoke_id));
    return { run, invoke };
  }).filter(item => item.invoke).sort((a, b) => String(a.invoke?.ts).localeCompare(String(b.invoke?.ts))).at(-1);
  if (invoking) return invoking.run;
  return open.sort((a, b) => String(a.control?.updated_at).localeCompare(String(b.control?.updated_at))).at(-1)
    ?? facts.find(run => run.manifest.feature === original.feature && run.manifest.run_id === original.run_id)!;
}

export function assertCanonicalDeliveryChild(projectRoot: string, feature: string, origin: { feature: string; run_id: string }): void {
  const identity = parseChangeUnitFeatureId(feature);
  if (identity.blueprintId !== origin.feature) throw new Error('[delivery-origin] child is outside the original blueprint workspace');
  loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId);
}

/** Membership comes only from canonical CUs and immutable child birth identity in this workspace. */
export function readOriginalDeliveryRuns(projectRoot: string, original: InitialDesignGoalManifest): DeliveryRunFacts[] {
  const read = (manifest: GoalRunManifest): DeliveryRunFacts => {
    const { assertGoalRunAttachable } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    assertGoalRunAttachable(projectRoot, manifest);
    const loaded = loadEventsJsonlStrict(path.resolve(projectRoot, manifest.report_dir, 'events.jsonl'));
    if (loaded.corruptLines.length) throw new Error('[delivery-origin] corrupt bound run events');
    return { manifest, events: loaded.events };
  };
  const runs = [read(original)];
  const origins = new Set([original.run_id]);
  let ancestor = runs[0];
  while (ancestor.manifest.successor_of) {
    const sourceId = ancestor.manifest.successor_of;
    const audited = ancestor.events.some(event => event.type === 'supersede' && 'target_run_id' in event && event.target_run_id === sourceId
      && 'superseding_run_id' in event && event.superseding_run_id === ancestor.manifest.run_id);
    if (!audited) throw new Error('[delivery-origin] original request successor is missing its existing supersede audit');
    if (ancestor.events.some(event => event.type === 'supersede' && 'delivery_cycle_boundary' in event && event.delivery_cycle_boundary === sourceId)) break;
    if (origins.has(sourceId)) throw new Error('[delivery-origin] cyclic original request lineage');
    const source = loadGoalRunManifestFromRun(projectRoot, sourceId, { feature: original.feature });
    if (!isInitialDesignManifest(source)) throw new Error('[delivery-origin] original request lineage contains a construction run');
    origins.add(sourceId); ancestor = read(source); runs.push(ancestor);
  }
  for (const unit of enumerateCanonicalChangeUnits(projectRoot, original.feature)) {
    const feature = deriveChangeUnitFeatureId(original.feature, String(unit.changeUnit.change_unit_id));
    const directory = featureFilePath(projectRoot, feature, 'goal-runs');
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name, 'manifest.json');
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<GoalManifest>;
      if (raw.delivery_origin?.feature !== original.feature || !origins.has(raw.delivery_origin.run_id)) continue;
      const manifest = loadGoalRunManifestFromRun(projectRoot, entry.name, { feature });
      if (isInitialDesignManifest(manifest)) throw new Error('[delivery-origin] a construction child cannot be another original request');
      runs.push(read(manifest));
    }
  }
  return runs;
}

export function originalDeliveryForManifest(projectRoot: string, manifest: GoalRunManifest): InitialDesignGoalManifest | null {
  if (isInitialDesignManifest(manifest)) return currentOriginalDelivery(projectRoot, manifest);
  if (!manifest.delivery_origin) return null;
  assertCanonicalDeliveryChild(projectRoot, manifest.feature, manifest.delivery_origin);
  const original = loadGoalRunManifestFromRun(projectRoot, manifest.delivery_origin.run_id, { feature: manifest.delivery_origin.feature });
  if (!isInitialDesignManifest(original)) throw new Error('[delivery-origin] origin is not an initial design request');
  return currentOriginalDelivery(projectRoot, original);
}

export function readOriginalDeliveryActivity(projectRoot: string, manifest: GoalRunManifest, nowMs = Date.now()): {
  calls: number; active_ms: number; firstAuthoritativeStartMs: number | null;
  events: GoalRunEvent[]; runs: DeliveryRunFacts[];
} | null {
  const original = originalDeliveryForManifest(projectRoot, manifest);
  if (!original) return null;
  const runs = readOriginalDeliveryRuns(projectRoot, original);
  const authorizations = runs[0].events.filter(event => event.type === 'run_created' || event.type === 'manifest_identity_rebase');
  const latest = authorizations.at(-1);
  const fields = latest?.type === 'run_created' && 'manifest_identity_fields' in latest ? latest.manifest_identity_fields
    : latest && 'to_fields' in latest ? latest.to_fields : undefined;
  if (fields && typeof fields === 'object') {
    const expected = fields as Record<string, unknown>;
    const current = computeManifestIdentityFields(original);
    const changed = [...new Set([...Object.keys(expected), ...Object.keys(current)])].filter(key => expected[key] !== current[key]);
    if (changed.length) throw new Error(`[delivery-origin] original ${changed.join(', ')} changed without its existing override authorization`);
  }
  const intervals: Array<{ startMs: number; endMs: number }> = [];
  let totalTurns = 0;
  const childStarts = runs.filter(run => !isInitialDesignManifest(run.manifest)).flatMap(run => run.events.filter(event => event.type === 'run_start')
    .map(event => Date.parse(String('session_started_at' in event ? event.session_started_at : event.ts))).filter(Number.isFinite));
  for (const run of runs) {
    const owner = readRunControl(path.resolve(projectRoot, run.manifest.report_dir), run.manifest.run_id)?.owner;
    const live = owner?.state === 'active' && (owner.kind === 'session' || typeof owner.pid === 'number' && isPidAlive(owner.pid));
    const partitioned = partitionExecutionSessions(run.events, { tailCapMs: nowMs, ...(live ? { liveTailMs: nowMs } : {}) });
    totalTurns += partitioned.totalTurns;
    for (const session of partitioned.sessions.filter(item => item.mode === 'authoritative')) {
      for (const interval of session.intervals) {
        const childStart = isInitialDesignManifest(run.manifest)
          ? childStarts.filter(start => start >= interval.startMs && start < interval.endMs).sort((a, b) => a - b)[0] : undefined;
        intervals.push({ startMs: interval.startMs, endMs: childStart ?? interval.endMs });
      }
    }
  }
  const merged: typeof intervals = [];
  for (const interval of intervals.filter(item => item.endMs > item.startMs).sort((a, b) => a.startMs - b.startMs)) {
    const prior = merged.at(-1);
    if (prior && interval.startMs <= prior.endMs) prior.endMs = Math.max(prior.endMs, interval.endMs);
    else merged.push({ ...interval });
  }
  return { calls: totalTurns, active_ms: merged.reduce((sum, interval) => sum + interval.endMs - interval.startMs, 0),
    firstAuthoritativeStartMs: merged[0]?.startMs ?? null,
    events: runs.flatMap(run => run.events.map(event => ({ ...event, run_id: run.manifest.run_id }))).sort((a, b) => String(a.ts).localeCompare(String(b.ts))), runs };
}
