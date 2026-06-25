/**
 * Goal-runner failure classification — SSOT for no-progress guard + retry context.
 * Consumed by goal-runner.ts (guard + priorFailure prompt shaping).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  isDeferrableExternalBlock,
  type DependencyPolicy,
  DEFAULT_DEPENDENCY_POLICY,
} from './phase-transition-policy';

export type FailureKind =
  | 'deterministic_gate_or_artifact_missing'
  | 'code_regression'
  | 'external_block';

/**
 * Blocker ids where retry without user input is structurally pointless.
 * Grep-verified against harness/scripts/check-*.ts (no ghost ids).
 * Coverage: spec/plan/review artifact gates + receipt trace/context gates.
 */
export const DETERMINISTIC_GATE_BLOCKER_IDS = new Set<string>([
  // check-spec.ts
  'spec_file_exists',
  'terminology_mapping_table',
  // check-plan.ts
  'plan_file_exists',
  // check-review.ts
  'review_report_exists',
  // check-receipt.ts (trace + context exploration)
  'trace_json_exists_false',
  'trace_json_path_missing',
  'trace_json_file_not_found',
  'context_exploration_exists_false',
  'context_exploration_summary_path_missing',
  'context_exploration_file_not_found',
  'verifier_report_missing',
  'verifier_report_path_missing',
]);

export interface GoalSummaryBlocker {
  id?: string;
  blocking_class?: string;
  classification?: string;
  affected_files?: string[];
}

export interface GoalSummaryLike {
  verdict?: string;
  blocking_class?: string;
  failure_kind?: string;
  blockers?: GoalSummaryBlocker[];
}

export interface ArtifactSnapshotEntry {
  exists: boolean;
  contentHash: string;
}

export type ArtifactSnapshot = Record<string, ArtifactSnapshotEntry>;

function blockerIds(summary: GoalSummaryLike | null | undefined): string[] {
  if (!summary?.blockers?.length) return [];
  return summary.blockers
    .map((b) => b.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
}

function topBlockingMeta(summary: GoalSummaryLike | null | undefined): {
  blocking_class?: string;
  failure_kind?: string;
} {
  if (!summary) return {};
  if (summary.blocking_class || summary.failure_kind) {
    return { blocking_class: summary.blocking_class, failure_kind: summary.failure_kind };
  }
  const b = summary.blockers?.[0];
  if (!b) return {};
  return { blocking_class: b.blocking_class, failure_kind: b.classification };
}

/**
 * Stable signature for cross-attempt comparison (sorted blocker ids).
 */
export function extractBlockerSignature(summary: GoalSummaryLike | null | undefined): string {
  const ids = blockerIds(summary);
  return ids.length > 0 ? ids.join('|') : '';
}

/**
 * Classify harness failure for guard + retry-context. Unknown ids → code_regression (prefer retry).
 */
export function classifyFailureKind(
  summary: GoalSummaryLike | null | undefined,
  dependencyPolicy: DependencyPolicy = DEFAULT_DEPENDENCY_POLICY,
): FailureKind {
  const meta = topBlockingMeta(summary);
  if (
    isDeferrableExternalBlock(meta.blocking_class, meta.failure_kind, dependencyPolicy)
  ) {
    return 'external_block';
  }
  const ids = blockerIds(summary);
  if (ids.some((id) => DETERMINISTIC_GATE_BLOCKER_IDS.has(id))) {
    return 'deterministic_gate_or_artifact_missing';
  }
  return 'code_regression';
}

/** Collect affected_files from deterministic blockers on the summary. */
export function extractDeterministicAffectedFiles(
  summary: GoalSummaryLike | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const b of summary?.blockers ?? []) {
    if (!b.id || !DETERMINISTIC_GATE_BLOCKER_IDS.has(b.id)) continue;
    for (const f of b.affected_files ?? []) {
      if (f.trim()) out.add(f.trim().replace(/\\/g, '/'));
    }
  }
  return [...out];
}

function hashFileContent(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Snapshot existence + content hash (not mtime). */
export function snapshotArtifacts(
  projectRoot: string,
  relativePaths: string[],
): ArtifactSnapshot {
  const snap: ArtifactSnapshot = {};
  for (const rel of relativePaths) {
    const norm = rel.replace(/\\/g, '/');
    const abs = path.join(projectRoot, norm);
    if (!fs.existsSync(abs)) {
      snap[norm] = { exists: false, contentHash: '' };
    } else {
      try {
        snap[norm] = { exists: true, contentHash: hashFileContent(abs) };
      } catch {
        snap[norm] = { exists: true, contentHash: '' };
      }
    }
  }
  return snap;
}

/**
 * True when any watched artifact gained existence or changed content (ignores mtime-only bumps).
 */
export function artifactsProgressed(
  prior: ArtifactSnapshot | null | undefined,
  current: ArtifactSnapshot,
): boolean {
  if (!prior || Object.keys(prior).length === 0) return false;
  for (const [rel, cur] of Object.entries(current)) {
    const prev = prior[rel];
    if (!prev) {
      if (cur.exists) return true;
      continue;
    }
    if (prev.exists !== cur.exists) return true;
    if (cur.exists && prev.contentHash !== cur.contentHash) return true;
  }
  return false;
}

export interface NoProgressGuardInput {
  failureKind: FailureKind;
  priorBlockerSignature: string | null;
  currentBlockerSignature: string;
  priorArtifactSnapshot: ArtifactSnapshot | null;
  currentArtifactSnapshot: ArtifactSnapshot;
}

/** Halt when deterministic gate repeats with zero artifact delta (2nd+ identical failure). */
export function shouldHaltNoProgress(input: NoProgressGuardInput): boolean {
  if (input.failureKind !== 'deterministic_gate_or_artifact_missing') return false;
  if (!input.priorBlockerSignature || input.priorBlockerSignature.length === 0) return false;
  if (input.priorBlockerSignature !== input.currentBlockerSignature) return false;
  return !artifactsProgressed(input.priorArtifactSnapshot, input.currentArtifactSnapshot);
}
