// ============================================================================
// finalize-init-run-log.ts — derive next_steps + writeRunArtifacts 统一收口
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { resolveProbeFrameworkRoot } from '../../repo-layout';
import type { InitRunLog, RunSummaryOptions } from '../init-orchestrate';
import type { InitTaskPlan } from './init-task-planner';
import type { TaskScope } from './init-task-planner';
import {
  deriveInitNextSteps,
  type InitNextStep,
  type InitNextStepsContext,
  type InitNextStepsMinContext,
} from './init-next-steps';

export interface FinalizeInitRunLogOptions {
  minCtx: InitNextStepsMinContext;
  phase1Ctx?: Pick<InitNextStepsContext, 'frameworkRoot' | 'plan' | 'workflowSpec'>;
  summaryOptions?: Omit<RunSummaryOptions, 'runLogPath' | 'summaryPath'>;
}

export interface WriteRunArtifactsResult {
  runLogPath: string;
  summaryPath: string;
  summary: string;
}

export function buildInitNextStepsMinContext(input: {
  projectRoot: string;
  harnessRoot: string;
  scope: TaskScope;
  log: InitRunLog;
}): InitNextStepsMinContext {
  return {
    projectRoot: input.projectRoot,
    harnessRoot: input.harnessRoot,
    scope: input.scope,
    materialized_adapters: input.log.materialized_adapters,
  };
}

export function buildInitNextStepsPhase1Context(
  minCtx: InitNextStepsMinContext,
  input: {
    frameworkRoot?: string;
    projectRoot: string;
    harnessRoot: string;
    plan?: InitTaskPlan;
  },
): InitNextStepsContext | undefined {
  const frameworkRoot =
    input.frameworkRoot?.trim() ||
    resolveProbeFrameworkRoot(input.projectRoot, input.harnessRoot);
  if (!frameworkRoot) return undefined;
  return {
    ...minCtx,
    frameworkRoot,
    plan: input.plan,
  };
}

export function finalizeInitRunLog(
  log: InitRunLog,
  options: FinalizeInitRunLogOptions,
): InitNextStep[] {
  const phase1 = options.phase1Ctx
    ? ({
        ...options.minCtx,
        frameworkRoot: options.phase1Ctx.frameworkRoot,
        plan: options.phase1Ctx.plan,
        workflowSpec: options.phase1Ctx.workflowSpec,
      } satisfies InitNextStepsContext)
    : undefined;
  const steps = deriveInitNextSteps(log, phase1);
  log.next_steps = steps;
  return steps;
}

function summaryPathForRunLog(runLogPath: string): string {
  return path.join(path.dirname(runLogPath), 'summary.md');
}

export function writeRunArtifacts(
  harnessRoot: string,
  log: InitRunLog,
  buildSummary: (log: InitRunLog, options: RunSummaryOptions) => string,
  options: FinalizeInitRunLogOptions,
): WriteRunArtifactsResult {
  finalizeInitRunLog(log, options);
  const stamp = log.started_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = path.join(harnessRoot, 'reports', '_global', 'init-orchestrate', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const runLogPath = path.join(dir, 'run-log.json');
  const summaryPath = summaryPathForRunLog(runLogPath);
  fs.writeFileSync(runLogPath, JSON.stringify(log, null, 2), 'utf-8');
  const summary = buildSummary(log, {
    ...(options.summaryOptions ?? {}),
    runLogPath,
    summaryPath,
  });
  fs.writeFileSync(summaryPath, `${summary}\n`, 'utf-8');
  return { runLogPath, summaryPath, summary };
}
