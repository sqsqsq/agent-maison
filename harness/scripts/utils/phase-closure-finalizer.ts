// ============================================================================
// phase-closure-finalizer.ts — crash-consistent summary closure commit（1.2/1.3 闭环域）
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  featurePhaseReportsDir,
  loadFrameworkConfig,
  resolveFeatureArtifact,
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
  verifyPhaseEvidenceManifestWithStagedOutputs,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from './phase-evidence-manifest';
import { isPidAlive } from './goal-run-lock';
import { validateProjectRelativePath } from './project-relative-path';
import {
  buildSummaryRepairCandidates,
  type RepairCandidateCheckInput,
} from './repair-candidates';
import { loadVerifierReportTextOrNull } from './verifier-evidence';
import {
  SUMMARY_ASSURANCE_SCHEMA_VERSIONS,
  SUMMARY_SCHEMA_VERSION_CURRENT,
} from './quality-axes';
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
  /** Attempt identity already verified by the receipt validator; used to reject cross-attempt staged recovery. */
  goalAttemptId?: string;
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
  /** Fault-injection seam. A selected cut simulates process death and intentionally preserves partial publication. */
  faultAt?: ClosurePublicationCut;
}

export type ClosurePublicationCut =
  | 'after_staged_summary'
  | 'after_manifest_publish'
  | 'after_receipt_pointer'
  | 'after_phase_state'
  | 'after_summary_rename';

export interface FinalizePhaseClosureResult {
  transitioned: boolean;
  evidence_rebound?: boolean;
  recovered_partial?: boolean;
  closure_fingerprint: string;
  summary: HarnessRunSummary;
  manifest_path: string;
  assess?: unknown;
  assess_error?: string;
}

class ClosureCrashSimulation extends Error {
  constructor(readonly cut: ClosurePublicationCut) {
    super(`simulated closure crash at ${cut}`);
  }
}

function maybeCrash(opts: FinalizePhaseClosureOptions, cut: ClosurePublicationCut): void {
  if (opts.faultAt === cut) throw new ClosureCrashSimulation(cut);
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
  maybeCrash(opts, 'after_manifest_publish');
  writeReceiptManifestPointer(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    manifestRel,
    written.sha256,
  );
  maybeCrash(opts, 'after_receipt_pointer');
  opts.persistPhaseState();
  maybeCrash(opts, 'after_phase_state');
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

function recoverPartialPublication(
  opts: FinalizePhaseClosureOptions,
  reportsDir: string,
  summaryPath: string,
): FinalizePhaseClosureResult | null {
  const prefix = `${path.basename(summaryPath)}.staged-`;
  const candidates = fs.existsSync(reportsDir)
    ? fs.readdirSync(reportsDir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(reportsDir, name))
    : [];
  const canonicalManifestRel = path.relative(
    opts.projectRoot,
    phaseEvidenceManifestPath(opts.projectRoot, opts.feature, opts.phase),
  ).replace(/\\/g, '/');
  const valid = candidates.flatMap((stagedPath) => {
    try {
      const raw = fs.readFileSync(stagedPath, 'utf8');
      const parsed = JSON.parse(raw) as HarnessRunSummary;
      const runMatches = !opts.goalRunId || parsed.run_id === opts.goalRunId;
      const attemptMatches = !opts.goalAttemptId || !parsed.visual_round?.attempt ||
        parsed.visual_round.attempt === opts.goalAttemptId;
      if (
        !SUMMARY_ASSURANCE_SCHEMA_VERSIONS.has(String(parsed.schema_version)) ||
        parsed.feature !== opts.feature || parsed.phase !== opts.phase ||
        parsed.verdict !== 'PASS' || parsed.blocker_count !== 0 || parsed.closure_status !== 'closed' ||
        parsed.closure_commit?.schema_version !== '1.0' ||
        parsed.closure_commit.receipt_path !== opts.receipt.receipt_path ||
        parsed.closure_commit.evidence_manifest_path !== canonicalManifestRel ||
        !runMatches || !attemptMatches
      ) return [];
      return [{ stagedPath, raw, parsed, sha256: sha256Bytes(raw) }];
    } catch {
      return [];
    }
  });
  if (valid.length === 0) return null;
  if (valid.length > 1) {
    throw new Error(`closure partial publication 不唯一（${valid.length} 个 staged summary），拒绝猜测事务`);
  }

  const candidate = valid[0];
  const loaded = loadPhaseEvidenceManifest(opts.projectRoot, opts.feature, opts.phase);
  if (!loaded) {
    // Crash occurred immediately after the staged write. No evidence was published,
    // so a freshly receipt-validated caller may discard this temp file and start a
    // new transaction; the old bytes never became trusted.
    fs.unlinkSync(candidate.stagedPath);
    return null;
  }
  const verification = verifyPhaseEvidenceManifestWithStagedOutputs({
    projectRoot: opts.projectRoot,
    feature: opts.feature,
    phase: opts.phase,
    stagedOutputs: [{ canonicalPath: summaryPath, sha256: candidate.sha256 }],
    frameworkRoot: opts.frameworkRoot,
    currentRequirementSha: opts.goalRunId
      ? computeRunRequirementSha(opts.projectRoot, opts.feature, opts.goalRunId)
      : undefined,
    // A previous completed closure may already own the receipt pointer. If the
    // current manifest independently proves the staged summary and all other
    // evidence, this transaction is precisely the writer allowed to advance it.
    allowPriorReceiptPointer: true,
  });
  if (verification.verdict !== 'fresh') {
    // The staged summary is a runner-owned temporary witness. Once the current
    // manifest cannot prove it, retaining that witness only makes every resume
    // rediscover the same untrusted partial transaction. Preserve user files and
    // old closure evidence; the caller will route back to the owner.
    fs.unlinkSync(candidate.stagedPath);
    throw new Error(
      `closure partial publication 无法证明仍等价（${verification.verdict}: ` +
      `${verification.changed_paths.join(', ') || verification.integrity_errors?.join(', ') || 'unknown'}）`,
    );
  }
  const pointer = readReceiptManifestPointer(opts.projectRoot, opts.feature, opts.phase);
  if (pointer !== loaded.fileSha256) {
    writeReceiptManifestPointer(
      opts.projectRoot,
      opts.feature,
      opts.phase,
      canonicalManifestRel,
      loaded.fileSha256,
    );
  }
  opts.persistPhaseState();
  fs.renameSync(candidate.stagedPath, summaryPath);
  return {
    transitioned: true,
    recovered_partial: true,
    closure_fingerprint: candidate.sha256,
    summary: candidate.parsed,
    manifest_path: canonicalManifestRel,
  };
}

export function hasStagedPhaseClosure(input: {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  phase: string;
}): boolean {
  const reportsDir = featurePhaseReportsDir(
    input.projectRoot,
    input.feature,
    input.phase,
    input.frameworkRoot,
  );
  const prefix = 'summary.json.staged-';
  return fs.existsSync(reportsDir) && fs.readdirSync(reportsDir).some((name) => name.startsWith(prefix));
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
  if (!SUMMARY_ASSURANCE_SCHEMA_VERSIONS.has(String(current.parsed.schema_version))) {
    throw new Error(
      `legacy summary ${current.parsed.schema_version} 只能标为 legacy_unverified；` +
        `请重跑 harness 生成 ${SUMMARY_SCHEMA_VERSION_CURRENT} assurance 后再闭环`,
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
      throw new Error(
        'closed summary 与既有 evidence binding 不一致；禁止按当前字节重新绑定，须失效并回退责任阶段',
      );
    }
    return {
      transitioned: false,
      evidence_rebound: false,
      closure_fingerprint: currentSha,
      summary: current.parsed,
      manifest_path: manifestRel,
    };
  }

  const recovered = recoverPartialPublication(opts, reportsDir, summaryPath);
  if (recovered) return recovered;

/**
 * 闭环冻结前重算 verifier 依赖的 repair_candidates（plan a9d4e7c2 P1-5）。
 *
 * 为什么必须在这里、而不是首次 writer：首次 writer 跑在 verifier **之前**，那时当前
 * subject 还没有任何证据；而闭环现在走 `--sync-closure`（它刻意不重跑脚本 harness，
 * 也就不会再进 writer）。不补这一次，review/UT 的 verifier 逐条 confirmed 候选就永远
 * 落不进 closed summary——goal 侧的回退候选输入面恒空。
 *
 * 纪律：
 *   · 复用**同一个**共享实现 `buildSummaryRepairCandidates`，不新写一份组装逻辑；
 *   · verifier 正文取自 `loadVerifierReportTextOrNull`，此刻 summary 已是本轮定稿值，
 *     loader 按 summary 现值锚定，读到的必然是刚验真通过的那一份；
 *   · 读不到 script-report / 组装抛错 → 保留 base 已有候选，绝不清空（best-effort 事实层）。
 */
function recomputeClosureRepairCandidates(
  opts: FinalizePhaseClosureOptions,
  reportsDir: string,
  base: HarnessRunSummary,
): HarnessRunSummary['repair_candidates'] | undefined {
  try {
    const scriptReportPath = path.join(reportsDir, 'script-report.json');
    if (!fs.existsSync(scriptReportPath)) return base.repair_candidates;
    const scriptReport = JSON.parse(fs.readFileSync(scriptReportPath, 'utf8')) as {
      checks?: Array<Record<string, unknown>>;
    };
    const checks = Array.isArray(scriptReport.checks) ? scriptReport.checks : [];
    const verifierReportText = loadVerifierReportTextOrNull(
      opts.projectRoot,
      opts.feature,
      String(opts.phase),
      { frameworkRoot: opts.frameworkRoot },
    );
    // verifier 无证据（能力 disabled，或该阶段本就不产 verifier 候选）→ 维持 base。
    if (!verifierReportText) return base.repair_candidates;
    const reviewDoc =
      String(opts.phase) === 'review'
        ? resolveFeatureArtifact(opts.projectRoot, opts.feature, 'review-report.md')
        : null;
    const reviewReportText =
      reviewDoc && reviewDoc.exists ? fs.readFileSync(reviewDoc.actualPath, 'utf8') : null;
    // 字段名必须是 `failure_kind`——`buildSummaryRepairCandidates` 的输入契约收的是它，
    // 内部才投影成 `classification`。这里若直接写 `classification`，机器归因会被**静默丢弃**
    // （`ut_hvigor_test` 的 code_regression、`p0_coverage_integrity` 的同类合取都会失效），
    // 而 `as never` 恰好把这个结构错误从类型检查里藏了起来。用真实结构子类型接住。
    const candidateChecks: RepairCandidateCheckInput[] = checks.map((c) => {
      const repairOwner = c.repair_owner === 'coding' || c.repair_owner === 'spec' ||
        c.repair_owner === 'plan' || c.repair_owner === 'testing' ||
        c.repair_owner === 'capability' || c.repair_owner === 'external'
        ? c.repair_owner
        : undefined;
      return {
        id: String(c.id ?? ''),
        status: String(c.status ?? ''),
        severity: String(c.severity ?? ''),
        details: typeof c.details === 'string' ? c.details : '',
        ...(typeof c.failure_kind === 'string' ? { failure_kind: c.failure_kind } : {}),
        ...(repairOwner ? { repair_owner: repairOwner } : {}),
        ...(typeof c.coding_candidate === 'boolean' ? { coding_candidate: c.coding_candidate } : {}),
        ...(Array.isArray(c.affected_files) ? { affected_files: c.affected_files as string[] } : {}),
      };
    });
    const candidates = buildSummaryRepairCandidates({
      phase: String(opts.phase),
      checks: candidateChecks,
      reportValidity: (base.report_validity ?? 'PASS') as 'PASS' | 'FAIL' | 'UNVERIFIED',
      reviewReportText,
      verifierReportText,
    });
    return candidates.length > 0 ? candidates : base.repair_candidates;
  } catch {
    // best-effort：重算失败不阻断闭环提交，保留 base 已有候选。
    return base.repair_candidates;
  }
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
  // plan a9d4e7c2 P1-5：verifier 依赖的候选只有到这一步才有可验真的证据可依。
  const closureRepairCandidates = recomputeClosureRepairCandidates(opts, reportsDir, current.parsed);
  const finalSummary: HarnessRunSummary = {
    // plan a9d4e7c2 T3：**保真闭环**——`{...current.parsed}` 原样带走 base 的代际与
    // verifier 字段；这里绝不把 1.3 回写成 1.2（旧写法会让 open→closed 悄悄降代，
    // 下游 upstream gate / attestation 立刻把刚闭环的阶段判成上一代）。
    ...current.parsed,
    ...(closureRepairCandidates && closureRepairCandidates.length > 0
      ? { repair_candidates: closureRepairCandidates }
      : {}),
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
  maybeCrash(opts, 'after_staged_summary');

  try {
    publishEvidenceBinding(opts, summaryPath, summarySha);
    fs.renameSync(stagedSummaryPath, summaryPath);
    maybeCrash(opts, 'after_summary_rename');

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
    // Preserve staged bytes after every publication cut. A later fenced caller
    // either proves and completes the same transaction or rejects it and
    // backtracks the owner; deleting the only transaction witness here made
    // manifest/pointer/state partials permanently unrecoverable.
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
