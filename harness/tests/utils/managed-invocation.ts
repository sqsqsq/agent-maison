import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../config';
import { createWorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { writePhaseExecutionRequestMaterial } from '../../scripts/utils/session-execution-handoff';

/** Issue a real request in disposable output; historical execution records are never assigned a new identity. */
export function issueManagedInvocation(projectRoot: string, frameworkRoot: string, feature: string,
  runId: string, phase: string, attemptId: string, chain = ['ut', 'testing']) {
  const runDir = path.join(featureDir(projectRoot, feature), 'goal-runs', runId);
  const reportDir = path.relative(projectRoot, runDir).replace(/\\/g, '/');
  fs.mkdirSync(runDir, { recursive: true });
  const manifest = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ feature, run_id: runId, report_dir: reportDir }));
  const context = createWorkUnitExecutionContext({ runId, feature, workflowId: 'spec-driven', track: 'full', chain,
    phase, attemptId, owner: { run_id: runId, owner_id: 'fixture-owner', epoch: 1, kind: 'process' },
    projectRoot, frameworkRoot, runDir, reportDir, adapter: 'generic',
    runtimeFacts: { runBaseSha: 'a'.repeat(40), receiptRequired: false, resume: false, successor: false }, childEnv: {} });
  const invokeId = `${phase}-${attemptId}`;
  const issuedAt = new Date().toISOString();
  const material = writePhaseExecutionRequestMaterial({ context, invokeId, issuedAt, preSnapshot: null,
    writeBoundary: null, gateTimeoutMs: 60_000, cleanupReserveMs: 0 });
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ type: 'agent_invoke_start', ts: issuedAt,
    phase, invoke_id: invokeId, attempt_id: attemptId, handoff_request: material.reference }) + '\n');
  return { MAISON_GOAL_RUN_ID: runId, MAISON_GOAL_ATTEMPT_PHASE: phase, MAISON_GOAL_ATTEMPT: attemptId };
}
