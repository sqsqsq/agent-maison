// ============================================================================
// phase-closure-finalizer.ts — crash-consistent summary 1.2 closure commit
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  featurePhaseReportsDir,
  loadFrameworkConfig,
} from '../../config';
import { writeReviewClosureAttestation } from './closure-attestation';
import {
  collectRequirementSsotPaths,
  computeRunRequirementSha,
  listAuthoritativeGoalRuns,
} from './fidelity-shared';
import { computeGateFingerprint } from './gate-fingerprint';
import {
  loadPhaseEvidenceManifest,
  phaseEvidenceManifestPath,
  readReceiptManifestPointer,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from './phase-evidence-manifest';
import { isPidAlive } from './goal-run-lock';
import { validateProjectRelativePath } from './project-relative-path';
import type { EvidencePolicySnapshot } from './runtime-policy';
import type { HarnessRunSummary, Phase } from './types';

export interface ClosureCommitV1 {
  schema_version: '1.0';
  committed_at: string;
  receipt_path: string;
  evidence_manifest_path: string;
}

export interface FinalizePhaseClosureOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  /** Goal orchestration must pass the authoritative run id; process env is only a fallback. */
  goalRunId?: string;
  phase: string;
  receipt: {
    status: 'passed';
    receipt_path: string;
    exit_code?: number;
  };
  blockerCount?: number;
  evidencePolicySnapshot?: EvidencePolicySnapshot | null;
  /** Strict state persistence runs after evidence publication and before summary commit. */
  persistPhaseState: () => void;
  now?: () => Date;
  /** Test seam; production callers omit this and use the canonical evidence preparation. */
  prepareEvidence?: () => {
    extraInputs?: string[];
    extraOutputs?: string[];
    requirementSha?: string | null;
  };
  /** Assess is deliberately post-commit; failure does not roll back verified closure. */
  assessAfterCommit?: () => unknown;
}

export interface FinalizePhaseClosureResult {
  transitioned: boolean;
  evidence_rebound?: boolean;
  closure_fingerprint: string;
  summary: HarnessRunSummary;
  manifest_path: string;
  assess?: unknown;
  assess_error?: string;
}

function sha256Bytes(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isGoalEnvironment(): boolean {
  return (
    process.env.MAISON_GOAL_RUNNER === '1' ||
    process.env.MAISON_GOAL_HEADLESS === '1' ||
    Boolean(process.env.MAISON_GOAL_RUN_ID?.trim())
  );
}

function capabilityResolutionEvidenceInputs(
  summaryPath: string,
  projectRoot: string,
): string[] {
  const paths = new Set<string>();
  const isProjectInput = (candidate: string): boolean => {
    const relative = path.relative(projectRoot, path.resolve(candidate));
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
    const capabilities = Array.isArray(summary.capability_resolutions) ? summary.capability_resolutions : [];
    for (const capability of capabilities) {
      if (!capability || typeof capability !== 'object') continue;
      const c = capability as Record<string, unknown>;
      const addDependencies = (value: unknown) => {
        if (!Array.isArray(value)) return;
        for (const entry of value) {
          if (!entry || typeof entry !== 'object') continue;
          const candidate = (entry as Record<string, unknown>).path;
          if (
            typeof candidate === 'string' &&
            candidate.trim() &&
            isProjectInput(candidate)
          ) {
            paths.add(path.resolve(candidate));
          }
        }
      };
      addDependencies(c.applicability_dependencies);
      if (!Array.isArray(c.inputs)) continue;
      for (const input of c.inputs) {
        if (!input || typeof input !== 'object') continue;
        const attempts = (input as Record<string, unknown>).attempts;
        if (!Array.isArray(attempts)) continue;
        for (const attempt of attempts) {
          if (attempt && typeof attempt === 'object') addDependencies((attempt as Record<string, unknown>).dependencies);
        }
      }
    }

  } catch {
    // Summary parse failure is handled by the surrounding closure validation;
    // never invent a partial evidence chain here.
  }
  return [...paths].sort();
}

/**
 * 本阶段 PASS check 实际引用、且真实存在的项目文件（去重、项目根相对）。
 *
 * 这些文件就是该阶段证据的"被执行对象"。不把它们登记进 manifest，血缘对它们就是空门：
 * 改动它们不会让任何阶段 stale，旧 PASS 报告会继续为改动后的源码背书
 * （下游消费点 `component-closure-evidence.ts` 的 `manifestTracksAuthority`）。
 */
function executedEvidenceInputs(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string[] {
  const reportAbs = path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'script-report.json');
  if (!fs.existsSync(reportAbs)) return [];
  let checks: Array<{ status?: unknown; affected_files?: unknown }>;
  try {
    const doc = JSON.parse(fs.readFileSync(reportAbs, 'utf-8')) as { checks?: unknown };
    checks = Array.isArray(doc.checks) ? (doc.checks as typeof checks) : [];
  } catch {
    // 报告本身损坏由所在阶段的门禁负责报告，这里不臆造证据链。
    return [];
  }
  const out = new Set<string>();
  for (const check of checks) {
    if (check?.status !== 'PASS' || !Array.isArray(check.affected_files)) continue;
    for (const raw of check.affected_files) {
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      // 路径边界只认既有 SSOT，不另起一套判断（它显式禁止 `rel.startsWith('..')`，
      // 也拒绝绝对路径——两者本模块都不得自行放宽）。
      let rel: string;
      try {
        rel = validateProjectRelativePath(projectRoot, raw, `evidence affected_file:${raw}`);
      } catch {
        continue;
      }
      const abs = path.resolve(projectRoot, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      out.add(rel);
    }
  }
  return [...out];
}

function productionEvidence(
  opts: FinalizePhaseClosureOptions,
  summaryPath: string,
): { extraInputs: string[]; extraOutputs: string[]; requirementSha: string | null } {
  const extraOutputs: string[] = [];
  if (opts.phase === 'review') {
    const runId = opts.goalRunId?.trim() || process.env.MAISON_GOAL_RUN_ID?.trim();
    const attempt = process.env.MAISON_GOAL_ATTEMPT?.trim();
    const attestation = writeReviewClosureAttestation({
      projectRoot: opts.projectRoot,
      feature: opts.feature,
      expectProductSources: true,
      gateFingerprint: computeGateFingerprint(opts.frameworkRoot, opts.phase),
      runIdentity: runId
        ? { run_id: runId, ...(attempt ? { attempt } : {}) }
        : null,
    });
    extraOutputs.push(attestation.absPath);
  }

  const featuresDirRel = (
    loadFrameworkConfig(opts.projectRoot).paths?.features_dir ?? 'doc/features'
  ).replace(/\\/g, '/');
  const runInventory = listAuthoritativeGoalRuns(
    opts.projectRoot,
    opts.feature,
    featuresDirRel,
  );
  if (runInventory.corruptRuns.length > 0) {
    throw new Error(
      'goal-runs 存在损坏 run，closure 血缘无法完整重建：' +
        runInventory.corruptRuns.map((run) => run.runId).join('、'),
    );
  }
  const runId = opts.goalRunId?.trim() || process.env.MAISON_GOAL_RUN_ID?.trim();
  const requirementSha = computeRunRequirementSha(
    opts.projectRoot,
    opts.feature,
    runId,
    featuresDirRel,
  );
  if ((Boolean(opts.goalRunId?.trim()) || isGoalEnvironment()) && requirementSha === null) {
    throw new Error(
      `goal 环境闭环无法计算 requirement 血缘哈希（run=${runId ?? '<missing>'}）`,
    );
  }
  return {
    extraInputs: [...new Set([
      ...collectRequirementSsotPaths(opts.projectRoot, opts.feature, featuresDirRel),
      ...capabilityResolutionEvidenceInputs(summaryPath, opts.projectRoot),
      ...executedEvidenceInputs(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot),
    ])].sort(),
    extraOutputs,
    requirementSha,
  };
}

function readSummary(summaryPath: string): { raw: string; parsed: HarnessRunSummary } {
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`summary.json 不存在：${summaryPath}`);
  }
  const raw = fs.readFileSync(summaryPath, 'utf8');
  return { raw, parsed: JSON.parse(raw) as HarnessRunSummary };
}

const CLOSURE_MUTEX_STALE_MS = 5 * 60 * 1000;

function withClosureMutex<T>(summaryPath: string, fn: () => T): T {
  const mutexPath = `${summaryPath}.finalize.lock`;
  fs.mkdirSync(path.dirname(mutexPath), { recursive: true });
  const acquire = (): number => {
    try {
      const fd = fs.openSync(mutexPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const stat = fs.statSync(mutexPath);
        const parsed = JSON.parse(fs.readFileSync(mutexPath, 'utf8')) as { pid?: unknown };
        stale =
          (typeof parsed.pid === 'number' && !isPidAlive(parsed.pid)) ||
          Date.now() - stat.mtimeMs > CLOSURE_MUTEX_STALE_MS;
      } catch {
        try {
          stale = Date.now() - fs.statSync(mutexPath).mtimeMs > CLOSURE_MUTEX_STALE_MS;
        } catch {
          stale = true;
        }
      }
      if (!stale) throw new Error(`closure finalization busy：${mutexPath}`);
      fs.unlinkSync(mutexPath);
      return acquire();
    }
  };
  const fd = acquire();
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } finally {
      try {
        fs.unlinkSync(mutexPath);
      } catch {
        // A later owner may already have recovered a stale lock.
      }
    }
  }
}

function publishEvidenceBinding(
  opts: FinalizePhaseClosureOptions,
  summaryPath: string,
  summarySha: string,
): { manifestRel: string; manifestSha: string } {
  const manifestAbs = phaseEvidenceManifestPath(opts.projectRoot, opts.feature, opts.phase);
  const manifestRel = path.relative(opts.projectRoot, manifestAbs).replace(/\\/g, '/');
  const evidence = opts.prepareEvidence ? opts.prepareEvidence() : productionEvidence(opts, summaryPath);
  const manifest = resolvePhaseEvidenceManifest({
    projectRoot: opts.projectRoot,
    feature: opts.feature,
    phase: opts.phase as Phase,
    extraInputs: evidence.extraInputs ?? [],
    extraOutputs: [...(evidence.extraOutputs ?? []), summaryPath],
    frameworkRoot: opts.frameworkRoot,
    requirementSha: evidence.requirementSha ?? null,
    stagedOutputs: [{ canonicalPath: summaryPath, sha256: summarySha }],
    now: opts.now,
  });
  const written = writePhaseEvidenceManifest(opts.projectRoot, manifest);
  writeReceiptManifestPointer(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    manifestRel,
    written.sha256,
  );
  opts.persistPhaseState();
  return { manifestRel, manifestSha: written.sha256 };
}

function evidenceBindingMatches(
  opts: FinalizePhaseClosureOptions,
  summaryPath: string,
  summarySha: string,
  manifestRel: string,
): boolean {
  const canonicalManifestRel = path.relative(
    opts.projectRoot,
    phaseEvidenceManifestPath(opts.projectRoot, opts.feature, opts.phase),
  ).replace(/\\/g, '/');
  if (manifestRel !== canonicalManifestRel) return false;
  const loaded = loadPhaseEvidenceManifest(opts.projectRoot, opts.feature, opts.phase);
  if (!loaded?.integrityOk) return false;
  const summaryRel = path.relative(opts.projectRoot, summaryPath).replace(/\\/g, '/');
  const summaryEntry = loaded.manifest.outputs.find((entry) => entry.path === summaryRel);
  if (!summaryEntry?.exists || summaryEntry.sha256 !== summarySha) return false;
  return readReceiptManifestPointer(opts.projectRoot, opts.feature, opts.phase) === loaded.fileSha256;
}

/**
 * Final commit point is the staged-summary rename. Anything before it may leave
 * recomputable evidence, but canonical summary remains open and cannot advance.
 */
function finalizePhaseClosureUnlocked(
  opts: FinalizePhaseClosureOptions,
): FinalizePhaseClosureResult {
  const reportsDir = featurePhaseReportsDir(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot,
  );
  const summaryPath = path.join(reportsDir, 'summary.json');
  const current = readSummary(summaryPath);
  if (current.parsed.schema_version !== '1.2') {
    throw new Error(
      `legacy summary ${current.parsed.schema_version} 只能标为 legacy_unverified；请重跑 harness 生成 1.2 assurance 后再闭环`,
    );
  }
  if (current.parsed.verdict !== 'PASS' || current.parsed.blocker_count !== 0) {
    throw new Error(
      `summary 不满足 closure：verdict=${current.parsed.verdict}, blocker_count=${current.parsed.blocker_count}`,
    );
  }
  if (!current.parsed.assurance) {
    throw new Error('summary.assurance 缺失；须重跑 harness 或执行显式验证迁移');
  }
  if (current.parsed.assurance === 'blocked') {
    throw new Error('blocked capability assurance 不得提交 PASS closure');
  }
  if (
    current.parsed.closure_status === 'closed' &&
    current.parsed.closure_commit?.schema_version === '1.0'
  ) {
    const currentSha = sha256Bytes(current.raw);
    const manifestRel = current.parsed.closure_commit.evidence_manifest_path;
    if (!evidenceBindingMatches(opts, summaryPath, currentSha, manifestRel)) {
      const rebound = publishEvidenceBinding(opts, summaryPath, currentSha);
      return {
        transitioned: false,
        evidence_rebound: true,
        closure_fingerprint: currentSha,
        summary: current.parsed,
        manifest_path: rebound.manifestRel,
      };
    }
    return {
      transitioned: false,
      evidence_rebound: false,
      closure_fingerprint: currentSha,
      summary: current.parsed,
      manifest_path: manifestRel,
    };
  }

  const committedAt = (opts.now ? opts.now() : new Date()).toISOString();
  const manifestAbs = phaseEvidenceManifestPath(
    opts.projectRoot,
    opts.feature,
    opts.phase,
  );
  const manifestRel = path.relative(opts.projectRoot, manifestAbs).replace(/\\/g, '/');
  const closureCommit: ClosureCommitV1 = {
    schema_version: '1.0',
    committed_at: committedAt,
    receipt_path: opts.receipt.receipt_path,
    evidence_manifest_path: manifestRel,
  };
  const finalSummary: HarnessRunSummary = {
    ...current.parsed,
    schema_version: '1.2',
    receipt_status: 'passed',
    closure_status: 'closed',
    next_action: 'phase_closed_wait_user',
    closure_commit: closureCommit,
  };
  const finalBytes = JSON.stringify(finalSummary, null, 2);
  const summarySha = sha256Bytes(finalBytes);
  fs.mkdirSync(reportsDir, { recursive: true });
  const stagedSummaryPath = `${summaryPath}.staged-${process.pid}-${Date.now()}`;
  fs.writeFileSync(stagedSummaryPath, finalBytes, 'utf8');

  try {
    publishEvidenceBinding(opts, summaryPath, summarySha);
    fs.renameSync(stagedSummaryPath, summaryPath);

    const result: FinalizePhaseClosureResult = {
      transitioned: true,
      closure_fingerprint: summarySha,
      summary: finalSummary,
      manifest_path: manifestRel,
    };
    if (opts.assessAfterCommit) {
      try {
        result.assess = opts.assessAfterCommit();
      } catch (error) {
        result.assess_error = (error as Error).message;
      }
    }
    return result;
  } catch (error) {
    try {
      if (fs.existsSync(stagedSummaryPath)) fs.unlinkSync(stagedSummaryPath);
    } catch {
      // The original finalization error remains authoritative.
    }
    throw error;
  }
}
export function finalizePhaseClosure(
  opts: FinalizePhaseClosureOptions,
): FinalizePhaseClosureResult {
  const reportsDir = featurePhaseReportsDir(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot,
  );
  return withClosureMutex(
    path.join(reportsDir, 'summary.json'),
    () => finalizePhaseClosureUnlocked(opts),
  );
}
