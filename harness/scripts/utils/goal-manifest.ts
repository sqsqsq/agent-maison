/**
 * Goal manifest parser — SSOT for goal-runner CLI and goal-runs/<run-id>/manifest.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { FeaturePhase } from './phase-transition-policy';
import {
  DEFAULT_DEPENDENCY_POLICY,
  type DependencyPolicy,
} from './phase-transition-policy';

export interface GoalBudget {
  max_retries_per_phase?: number;
  max_total_turns?: number;
  wall_clock_minutes?: number;
}

export interface UnattendedContract {
  write_mode: 'workspace-write' | 'accept-edits' | 'full-access';
  approval_mode: 'never' | 'on-request' | 'always';
  max_turns?: number;
  timeout_seconds?: number;
  allowed_tools?: string[];
}

export interface GoalManifest {
  schema_version: '1.0';
  start_phase: FeaturePhase;
  end_phase: FeaturePhase;
  feature: string;
  requirement?: string;
  adapter?: string;
  chain_override?: FeaturePhase[];
  budget: Required<GoalBudget>;
  dependency_policy: Required<DependencyPolicy>;
  unattended: UnattendedContract;
  run_id: string;
  report_dir: string;
  created_at: string;
}

export interface GoalManifestParseOptions {
  projectRoot: string;
  runId?: string;
}

const DEFAULT_BUDGET: Required<GoalBudget> = {
  max_retries_per_phase: 2,
  max_total_turns: 30,
  wall_clock_minutes: 480,
};

function newRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function normalizePhase(v: unknown, fallback: FeaturePhase): FeaturePhase {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  return v.trim() as FeaturePhase;
}

function mergeDependencyPolicy(raw?: Partial<DependencyPolicy>): Required<DependencyPolicy> {
  return {
    deferrable_blocking_classes:
      raw?.deferrable_blocking_classes ??
      DEFAULT_DEPENDENCY_POLICY.deferrable_blocking_classes ??
      ['externalBlocked'],
    deferrable_failure_kinds:
      raw?.deferrable_failure_kinds ??
      DEFAULT_DEPENDENCY_POLICY.deferrable_failure_kinds ??
      ['device_blocked'],
    propagate_to_downstream: raw?.propagate_to_downstream ?? true,
  };
}

function mergeBudget(raw?: GoalBudget): Required<GoalBudget> {
  return {
    max_retries_per_phase: raw?.max_retries_per_phase ?? DEFAULT_BUDGET.max_retries_per_phase,
    max_total_turns: raw?.max_total_turns ?? DEFAULT_BUDGET.max_total_turns,
    wall_clock_minutes: raw?.wall_clock_minutes ?? DEFAULT_BUDGET.wall_clock_minutes,
  };
}

export function validateUnattendedContract(u: Partial<UnattendedContract> | undefined): string[] {
  const issues: string[] = [];
  if (!u || typeof u !== 'object') {
    issues.push('unattended 缺失');
    return issues;
  }
  const writeModes = new Set(['workspace-write', 'accept-edits', 'full-access']);
  const approvalModes = new Set(['never', 'on-request', 'always']);
  if (!u.write_mode || !writeModes.has(u.write_mode)) {
    issues.push('unattended.write_mode 必须为 workspace-write|accept-edits|full-access');
  }
  if (!u.approval_mode || !approvalModes.has(u.approval_mode)) {
    issues.push('unattended.approval_mode 必须为 never|on-request|always');
  }
  return issues;
}

export function buildGoalManifestFromInput(
  input: Record<string, unknown>,
  opts: GoalManifestParseOptions,
): GoalManifest {
  const runId = (typeof input.run_id === 'string' && input.run_id.trim()) || opts.runId || newRunId();
  const reportDir =
    (typeof input.report_dir === 'string' && input.report_dir.trim()) ||
    path.join('goal-runs', runId).replace(/\\/g, '/');

  const chainOverride = Array.isArray(input.chain_override)
    ? (input.chain_override.filter((x) => typeof x === 'string') as FeaturePhase[])
    : undefined;

  return {
    schema_version: '1.0',
    start_phase: normalizePhase(input.start_phase, 'prd'),
    end_phase: normalizePhase(input.end_phase, 'testing'),
    feature: String(input.feature ?? '').trim(),
    requirement: typeof input.requirement === 'string' ? input.requirement : undefined,
    adapter: typeof input.adapter === 'string' ? input.adapter.trim() : undefined,
    chain_override: chainOverride,
    budget: mergeBudget(input.budget as GoalBudget | undefined),
    dependency_policy: mergeDependencyPolicy(input.dependency_policy as DependencyPolicy | undefined),
    unattended: input.unattended as UnattendedContract,
    run_id: runId,
    report_dir: reportDir,
    created_at: new Date().toISOString(),
  };
}

export function loadGoalManifestFile(filePath: string, projectRoot: string): GoalManifest {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
  return buildGoalManifestFromInput(raw, { projectRoot });
}

export function writeGoalManifest(manifest: GoalManifest, projectRoot: string): string {
  const abs = path.join(projectRoot, manifest.report_dir, 'manifest.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return abs;
}

export function loadGoalManifestFromRun(projectRoot: string, runId: string): GoalManifest {
  const abs = path.join(projectRoot, 'goal-runs', runId, 'manifest.json');
  if (!fs.existsSync(abs)) {
    throw new Error(`[goal-manifest] 未找到 run manifest: ${abs}`);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as GoalManifest;
}
