import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { enumerateFeatures } from '../../config';
import { loadGoalRunManifestFromRun } from './goal-manifest';
import { executionRequestForInvoke, type SessionExecutionRequest } from './session-execution-handoff';
import { loadAuthoritativeEvents, loadEventsJsonlStrict, type GoalRunEvent } from './goal-runner-phase';
import { assertFencedOwner } from './goal-run-control';
import { compareRelatedInputSnapshots, type ArtifactSnapshot } from './goal-failure-classifier';
import { invocationCompleted } from './invocation-completion';

export interface ManagedGoalInvocation {
  run_id: string; phase: string; attempt_id: string;
  invoke_id: string; run_dir: string;
  owner: import('./goal-phase-executor').WorkUnitExecutionContext['owner'];
}

/** Environment names a signed producer; it cannot create one. Returned requests remain valid for its formal check. */
export function resolveManagedGoalInvocation(input: {
  projectRoot: string; feature?: string; phase?: string; env?: NodeJS.ProcessEnv;
}): ManagedGoalInvocation | undefined {
  const env = input.env ?? process.env;
  const runId = env.MAISON_GOAL_RUN_ID?.trim();
  const actorPhase = env.MAISON_GOAL_ATTEMPT_PHASE?.trim();
  const attemptId = env.MAISON_GOAL_ATTEMPT?.trim();
  if (!runId || !actorPhase || !attemptId) return undefined;
  const features = input.feature ? [input.feature] : enumerateFeatures(input.projectRoot).map(item => item.featureId);
  for (const feature of features) {
    try {
      const manifest = loadGoalRunManifestFromRun(input.projectRoot, runId, { feature });
      const runDir = path.resolve(input.projectRoot, manifest.report_dir);
      const loaded = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl'));
      if (loaded.missing) continue;
      for (const start of [...loaded.events].reverse()) {
        if (start.type !== 'agent_invoke_start' || start.phase !== actorPhase || !start.invoke_id) continue;
        const original = executionRequestForInvoke(runDir, start.invoke_id);
        const context = original?.request.context;
        if (!context || context.runId !== runId || context.feature !== feature
          || context.phase !== actorPhase || context.attemptId !== attemptId
          || path.resolve(context.projectRoot) !== path.resolve(input.projectRoot)
          || path.resolve(context.runDir) !== runDir
          || input.phase && input.phase !== actorPhase && !context.chain.includes(input.phase as never)) continue;
        return { run_id: runId, phase: actorPhase, attempt_id: attemptId,
          invoke_id: original!.request.invoke_id, run_dir: runDir, owner: context.owner };
      }
    } catch { /* Try the next known feature; a locator is not authority. */ }
  }
  return undefined;
}

export interface ManagedAuthorCheck {
  readonly actor: ManagedGoalInvocation;
  readonly phase: string;
  readonly invokeId: string;
  readonly startedAt: string;
  readonly inputs: ArtifactSnapshot;
}

function allowsManagedAuthorCheck({ context, purpose }: SessionExecutionRequest): boolean {
  const { workUnitExecutionRole } = require('./goal-phase-executor') as typeof import('./goal-phase-executor');
  return context.phase === 'work-unit-author' && (purpose === undefined || purpose === 'work-unit-author')
    && workUnitExecutionRole(context, purpose) === 'author';
}

/** The harness process signs its own tool observation under the current author invocation. */
export function beginManagedAuthorCheck(input: {
  projectRoot: string; frameworkRoot: string; feature: string; phase: string;
}): ManagedAuthorCheck {
  const actor = resolveManagedGoalInvocation(input);
  if (!actor || !['coding', 'ut', 'testing'].includes(input.phase)) {
    throw new Error('本检查需要当前已签发的工作单元作者及其原有构建、UT 或设备职责。');
  }
  const original = executionRequestForInvoke(actor.run_dir, actor.invoke_id)?.request;
  if (!original || path.resolve(original.context.frameworkRoot) !== path.resolve(input.frameworkRoot)
    || original.context.user_deadline_at && Date.parse(original.context.user_deadline_at) <= Date.now()) {
    throw new Error('本检查的框架路径或用户时限与原工作单元不符。');
  }
  if (!allowsManagedAuthorCheck(original)) throw new Error('本次职责不授权启动正式检查。');
  for (const key of ['HARNESS_DEVICE_TEST_PRODUCT', 'HARNESS_DEVICE_TEST_BUILD_MODE', 'HARNESS_HDC_TARGET',
    'MAISON_DEVICE_TARGET_KIND', 'MAISON_DEVICE_SESSION_ID', 'MAISON_DEVICE_CREDENTIAL_REF', 'MAISON_DEVICE_ATTEMPT_FROZEN']) {
    const issued = original.context.childEnv?.[key];
    if ((issued ?? '') !== (process.env[key] ?? '')) throw new Error(`当前工具参数 ${key} 与原工作单元签发的值不符。`);
  }
  const eventsPath = path.join(actor.run_dir, 'events.jsonl');
  const assertActive = () => {
    assertFencedOwner(actor.run_dir, actor.owner, 'managed_author_check');
    if (loadAuthoritativeEvents(eventsPath).some(event => event.type === 'agent_invoke_end' && event.invoke_id === actor.invoke_id)) {
      throw new Error('原工作单元作者已交回，不能再用该调用启动检查。');
    }
  };
  assertActive();
  const invokeId = `${input.phase}-${actor.attempt_id}-tool-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const { readCurrentCheckObservation } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  const relatedInputs = readCurrentCheckObservation({ ...input, runId: actor.run_id }).inputs;
  assertActive();
  writeManagedCheckEvent(actor, { ts: startedAt, type: 'harness_start', phase: input.phase, invoke_id: invokeId,
    related_input_snapshot: relatedInputs });
  return { actor, phase: input.phase, invokeId, startedAt, inputs: relatedInputs };
}

export function finishManagedAuthorCheck(check: ManagedAuthorCheck, result: {
  exitCode: number; verdict: string; manifestSha256: string; inputs: ArtifactSnapshot;
  stablePaths: string[];
  device?: { serial: string | null; target_kind: string | null; session_id: string | null };
}): void {
  const { actor } = check;
  if (loadAuthoritativeEvents(path.join(actor.run_dir, 'events.jsonl')).some(event =>
    event.type === 'agent_invoke_end' && event.invoke_id === actor.invoke_id)) return;
  if (result.stablePaths.some(file => check.inputs[file] && result.inputs[file]
    && check.inputs[file].contentHash !== result.inputs[file].contentHash)) return;
  writeManagedCheckEvent(actor, { ts: new Date().toISOString(), type: 'harness_end', phase: check.phase, invoke_id: check.invokeId,
    exit_code: result.exitCode, verdict: result.verdict, timed_out: false, duration_ms: Date.now() - Date.parse(check.startedAt),
    related_input_snapshot: result.inputs, author_tool_evidence_sha256: result.manifestSha256, author_tool_device: result.device });
}

/** A published check is only eligible when its original author returned and its bytes still match. */
export function qualifiedManagedAuthorCheck(input: { runDir: string; feature: string; projectRoot: string; frameworkRoot: string },
  start: GoalRunEvent, end: GoalRunEvent, evidenceSha: string):
  ReturnType<typeof executionRequestForInvoke> {
  if (!start.author_tool_invoke_id || start.author_tool_invoke_id !== end.author_tool_invoke_id
    || start.attempt_id !== end.attempt_id || start.owner_id !== end.owner_id || start.owner_epoch !== end.owner_epoch
    || end.author_tool_evidence_sha256 !== evidenceSha || end.timed_out !== false || start.phase !== end.phase) return null;
  let original: ReturnType<typeof executionRequestForInvoke>;
  try { original = executionRequestForInvoke(input.runDir, start.author_tool_invoke_id); }
  catch { return null; }
  if (!original || !allowsManagedAuthorCheck(original.request)) return null;
  const { context } = original.request;
  if (context.feature !== input.feature
    || path.resolve(context.projectRoot) !== path.resolve(input.projectRoot) || path.resolve(context.frameworkRoot) !== path.resolve(input.frameworkRoot)
    || context.runId !== end.run_id || context.attemptId !== end.attempt_id
    || context.owner.owner_id !== end.owner_id || context.owner.epoch !== end.owner_epoch || !context.chain.includes(end.phase as never)) return null;
  const events = loadAuthoritativeEvents(path.join(input.runDir, 'events.jsonl'));
  const began = events.findIndex(event => event.type === 'agent_invoke_start' && event.invoke_id === start.author_tool_invoke_id);
  const finished = events.findIndex(event => event.type === 'agent_invoke_end' && event.invoke_id === start.author_tool_invoke_id);
  const observed = events.findIndex(event => event.type === 'harness_end' && event.invoke_id === end.invoke_id && event.ts === end.ts);
  return began >= 0 && observed > began && finished > observed
    && invocationCompleted({ ...events[finished], exitCode: events[finished].exit_code }) ? original : null;
}

/** A normal check run can refresh independent material using the same proven native PASS. */
export function managedAuthorCheckMatchesEvidence(input: {
  projectRoot: string; frameworkRoot: string; feature: string; phase: string; runId: string; evidenceSha256: string;
  device?: { serial?: string; targetKind?: string };
}): boolean {
  const manifest = loadGoalRunManifestFromRun(input.projectRoot, input.runId, { feature: input.feature });
  const runDir = path.resolve(input.projectRoot, manifest.report_dir);
  const events = loadAuthoritativeEvents(path.join(runDir, 'events.jsonl'));
  const end = [...events].reverse().find(event => event.type === 'harness_end' && event.phase === input.phase);
  if (!end?.author_tool_invoke_id || end.verdict !== 'PASS' || end.author_tool_evidence_sha256 !== input.evidenceSha256) return false;
  if (input.device && (!input.device.serial || !input.device.targetKind
    || input.device.serial !== end.author_tool_device?.serial || input.device.targetKind !== end.author_tool_device?.target_kind)) return false;
  const start = events.find(event => event.type === 'harness_start' && event.invoke_id === end.invoke_id);
  if (!start || !qualifiedManagedAuthorCheck({ ...input, runDir }, start, end, input.evidenceSha256)) return false;
  // The same observation determines whether the coordinator must run new machine work.
  const { readCurrentCheckObservation } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  return compareRelatedInputSnapshots(end.related_input_snapshot, readCurrentCheckObservation(input).inputs) === 'unchanged';
}

function writeManagedCheckEvent(actor: ManagedGoalInvocation, event: GoalRunEvent): void {
  assertFencedOwner(actor.run_dir, actor.owner, 'managed_author_check');
  fs.appendFileSync(path.join(actor.run_dir, 'events.jsonl'), JSON.stringify({
    ...event, run_id: actor.run_id, attempt_id: actor.attempt_id, owner_id: actor.owner.owner_id, owner_epoch: actor.owner.epoch,
    author_tool_invoke_id: actor.invoke_id,
  }) + '\n', 'utf8');
}

/** Nested goal commands cannot grant fresh execution; the public manual CLI retains its explicit switch. */
export function effectiveForceDevice(requested: boolean | undefined,
  input: Parameters<typeof resolveManagedGoalInvocation>[0]): boolean {
  if (!requested || resolveManagedGoalInvocation(input)) return false;
  const env = input.env ?? process.env;
  // A damaged bound goal journal cannot turn an inherited managed context into a fresh-execution grant.
  if (env.MAISON_GOAL_RUN_ID?.trim() && env.MAISON_GOAL_ATTEMPT?.trim() && env.MAISON_GOAL_ATTEMPT_PHASE?.trim()) {
    const features = input.feature ? [input.feature] : enumerateFeatures(input.projectRoot).map(item => item.featureId);
    for (const feature of features) try {
      const manifest = loadGoalRunManifestFromRun(input.projectRoot, env.MAISON_GOAL_RUN_ID.trim(), { feature });
      const journal = loadEventsJsonlStrict(path.resolve(input.projectRoot, manifest.report_dir, 'events.jsonl'));
      if (journal.corruptLines.length) return false;
    } catch { /* No bound run: ordinary manual CLI semantics remain unchanged. */ }
  }
  return true;
}
