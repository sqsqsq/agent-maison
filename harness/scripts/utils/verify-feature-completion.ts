import { phaseInvocationStart, repairInvocationCompleted, readSupersededAncestorRuns } from './goal-runner-phase';
import type { IdentityNeutralDigestReaders } from './identity-neutral-digest';
import { readRepairDependencyContext, resolveRepairResponsibility } from './repair-responsibility';
import type { WorkflowSpec } from '../../workflow-loader';
// ============================================================================
// verify-feature-completion.ts — feature 完成凭证：生成与唯一验证入口
// （goal-fakepass-hardening t8；openspec goal-runner delta）
// ============================================================================
// 事故背景：run1 HALTED 后 run2 截断链（ut→testing）报 COMPLETED，被读成"需求完成"；
// 上游 PASS 仅是 manifest 文本断言。修复：feature 级完成只认 feature-completion——
// 且消费方**禁止**看文件存在性/自报字段，一切经 `assessFeature()`（feature-assessment.ts）重算：
// 本文件提供它的记录自洽段 `inspectCompletionRecord`（VALID | INVALID，只管记录本身）与 clean-pass。
//
// 当前完成资格从同一处置投影：真实结果/有效输入与独立核验支撑全部适用义务，
// 必修、必要未知、未恢复写入均未闭合时不能签完成。原始比较 FAIL 可以由当前真实
// 独立反证关闭对应待办，但原报告/统计不改写；历史 PASS 不能替代受影响材料复核。
//   plan 1741b6f2 T3：基线在场时的普通源码漂移不在此重判——它已由责任 checker 分级为
//   WARN 并经 readiness signal 披露；这里再判一次会把"披露"变成第三次阻断。
//
// 原件落 runner-owned run 目录（goal-runs/<run_id>/feature-completion.json，原子写），
// feature 根只放投影（路径+sha256 指针）。手工伪造：投影/原件哈希对不上、或重算
// 血缘失配 → 记录 INVALID；源码/输入后改 → 义务 uncovered；更晚未终局 run → blocking。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { validateExecutionScope, executionScopeFingerprint, executionCompletionPhases, isExecutionSourceBasis, isEffectivePhasePass, scopeProofHistory, phaseEvidenceIsCurrent, acceptsDefinitionInputProof, type ExecutionScope } from './execution-scope';
import { loadGoalManifestFromRun, manifestIdentityFieldDigest } from './goal-manifest';
import { assertGoalRunAttachable, loadFrozenExecutionScope, loadEffectiveExecutionScope, resolveEffectiveScopeSource, loadScopeRevisions, loadAuthoritativeRunEvents, eventsWithScopeRevocations, applyScopeRevisions, identityBaseline, normalizeRelatedPath } from './goal-run-creation';
import { requiredSummaryCheckGaps, isRequiredCheckGap, resolveCurrentDisposition, phaseCompletionProblems, type CurrentDisposition, type CurrentDispositionInput, type CurrentDispositionAxisFact, type CurrentDispositionPhaseFact, type DispositionCheck } from './check-disposition';
import { readFeatureFrozenScope, featureEffectiveScope } from './feature-execution-scope';
import { inferLegacyProjectRoot, isInsideProjectRoot, resolveDependencyPath } from './project-relative-path';
import { loadEventsJsonl, resolveEffectiveRunEnd } from './goal-runner-phase';
import { invocationCompleted } from './invocation-completion';
import { parseVerifierRequestFromInstruction } from './verifier-request';
import { readExecutionRequestOriginal } from './session-execution-handoff';
import { implementationFiles } from './diff-scope';

import { featureFilePath, featurePhaseReportsDir, receiptDirPath, resolveFeatureArtifact, relFeaturesDir } from '../../config';
import {
  loadReviewClosureAttestation,
} from './closure-attestation';
import { classifyGoalRunsDir, collectRequirementSsotPaths, computeRunRequirementSha, computeRequirementShaFromText, resolveCurrentRequirementSource } from './fidelity-shared';
import { SUMMARY_ASSURANCE_SCHEMA_VERSIONS, validateSummaryV11 } from './quality-axes';
import { buildSourceInventory } from './closure-attestation';
import {
  deviceTestEvidencePath,
  type DeviceTestEvidenceDoc,
} from './device-test-evidence-shared';
import { dispatchHylyreResult } from './hylyre-result-protocol';
import { phaseManifestBindsRuntimeArtifacts, validateRuntimeFidelityEvidenceDocument } from './runtime-step-evidence';
import { resolveP0DeviceObligations, loadAcceptanceFlowsDoc } from './p0-semantic-gates';
import {
  loadPhaseEvidenceManifest,
  createRuntimeArtifactPredicate,
  recomputePhaseEvidenceStaleness,
  sha256File,
  stableStringify,
  verifyPhaseEvidenceManifestWithStagedOutputs,
  resolvePhaseEvidenceManifest,
  phaseEvidenceBusinessInputs,
  currentEvidenceEntryHash,
} from './phase-evidence-manifest';
import { unrestoredAuthorWrites } from './phase-write-boundary';
import { evaluateCompletionProgress, compareRelatedInputSnapshots, nativeCompileDiagnosticRefs, type CompletionEvaluation, type ArtifactSnapshot } from './goal-failure-classifier';
import { isProviderToolResult } from './codex-terminal-events';
import { asRecord, blueprintAuthorContent, type BlueprintRecord, type BlueprintIssue } from './component-blueprint-model';
import { stableAddressIndex } from './blueprint-addressing';
import { readCurrentActionableEvidence, type ActionableCollectResult } from './actionable-evidence';
import * as YAML from 'yaml';
import { assuranceSatisfies, type Assurance, type MinimumAssurance } from './skill-contract';

export const FEATURE_COMPLETION_FILENAME = 'feature-completion.json';
// 1.1（codex 八轮 P2）：新增 requirement_sha256/testing_source_aggregate/per-phase attempt
// 等必需绑定字段——旧 1.0 completion 结构不同，schema_version 不匹配即 INVALID。
export const FEATURE_COMPLETION_SCHEMA_VERSION = '1.2';
const LEGACY_COMPLETION_SCHEMA_VERSION = '1.1';

/** Recheck P1 bindings and real phase evidence; scope declarations never count as PASS. */
/**
 * `currentRunId` (D2): the run that is executing right now. Evidence produced by *that* run is
 * necessarily not sealed yet — D2 revisions never seal — so the terminal `run_end` check is
 * skipped for it and only for it. Every other check, and every historical run, is unchanged.
 */
/**
 * `pendingOwnerPhase`: the phase executing RIGHT NOW. Its owned outputs are mid-flight by
 * definition, so the existing `ownedOutputIsCurrent` exemption applies to them and only to them
 * (plan b5c1e9d7 §3.2). Callers that are not "some owner is building right now" omit it and keep
 * today's behavior; terminal completion (:412 below) must never claim it.
 */
export function executionScopeEvidenceIssues(projectRoot: string, feature: string, scope: ExecutionScope, obligationIds?: ReadonlySet<string>, currentRunId?: string, pendingOwnerPhase?: string, frameworkRoot?: string, currentPhasePass?: string, authorityReaders?: IdentityNeutralDigestReaders): string[] {
  return executionScopeEvidenceFindings(projectRoot, feature, scope, obligationIds, currentRunId, pendingOwnerPhase, frameworkRoot, currentPhasePass, authorityReaders).map(item => `${item.obligation_id}: ${item.detail}`);
}

/** plan b2d7f4e9 §3.1：同一判据的逐义务结构化出口（assessFeature 消费）；字符串出口是它的投影。 */
export interface ScopeEvidenceFinding { obligation_id: string; detail: string; class: 'binding' | 'evidence' | 'unknown' }

function readCurrentScopeProofHistory(projectRoot: string, feature: string, scope: ExecutionScope, runId?: string, frameworkRoot?: string,
  workflow?: WorkflowSpec, currentPhasePass?: string) {
  const { resolveWorkflowSpec, workflowForExistingRun } = require('../../workflow-loader') as typeof import('../../workflow-loader');
  const { resolveProbeFrameworkRoot } = require('../../repo-layout') as typeof import('../../repo-layout');
  const root = frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot, path.resolve(__dirname, '../..'));
  const active = workflow ?? resolveWorkflowSpec(projectRoot, { frameworkRoot: root });
  const proofWorkflow = runId ? workflowForExistingRun(active, loadGoalManifestFromRun(projectRoot, runId, { feature }), root, projectRoot) : active;
  const { readScopeProofHistory } = require('./feature-track') as typeof import('./feature-track');
  return readScopeProofHistory({ projectRoot, frameworkRoot: root, feature, previous: scope, workflow: proofWorkflow,
    currentRunId: runId, currentPhasePass }).history;
}

export function executionScopeEvidenceFindings(projectRoot: string, feature: string, scope: ExecutionScope, obligationIds?: ReadonlySet<string>, currentRunId?: string, pendingOwnerPhase?: string, frameworkRoot?: string, currentPhasePass?: string, authorityReaders?: IdentityNeutralDigestReaders, workflow?: WorkflowSpec,
  currentHistory?: ReturnType<typeof scopeProofHistory>): ScopeEvidenceFinding[] {
  const freshnessOpts = { authorityReaders, ...(pendingOwnerPhase ? { pendingOwnerPhase } : {}), ...(frameworkRoot ? { frameworkRoot } : {}) };
  validateExecutionScope(scope);
  // plan b2d7f4e9 t4：记录的依赖是写入时工程根下的绝对路径；换根加载按记录内一致前缀重定位（只读侧）。
  const legacyRoot = inferLegacyProjectRoot(projectRoot, scope);
  const issues: ScopeEvidenceFinding[] = scope.unresolved.filter(gap => !obligationIds || obligationIds.has(gap.obligation_id)).map(gap => ({ obligation_id: gap.obligation_id, detail: gap.reason, class: 'unknown' as const }));
  const push = (obligation_id: string, detail: string, cls: ScopeEvidenceFinding['class']): void => { issues.push({ obligation_id, detail, class: cls }); };
  const proofHistory = currentHistory ?? readCurrentScopeProofHistory(projectRoot, feature, scope, currentRunId, frameworkRoot, workflow, currentPhasePass);
  for (const obligation of scope.obligations.filter(o => !obligationIds || obligationIds.has(o.id))) {
    for (const { ref, basis } of [...obligation.basis.map(ref => ({ ref, basis: true })), ...(obligation.satisfied_by ?? []).map(ref => ({ ref, basis: false }))]) {
      if ('input_id' in ref) {
        if (!Array.isArray(ref.dependencies) || !/^[0-9a-f]{64}$/.test(ref.content_fingerprint)) { push(obligation.id, 'invalid input binding', 'binding'); continue; }
        // plan e7a2c4f1 §3.4（G02/G04）：内容等价判据必须**两侧同一个**。resolver 侧自动对齐的
        // 只是账本形状（依赖字节漂移而解析值逐字节相同），若完成侧仍逐字节比旧 sha256，就会出现
        // 「resolver 过了、完成检查照样判 input binding stale」的分裂——冻结的 acceptance.yaml
        // 只加一行注释就永远完成不了。这里复用**同一个** `readBoundInput`（同 input_id + 同 source +
        // 依赖存在性/role 一致 + `content_fingerprint` 相等），而且**不回写冻结记录**：对齐只影响
        // 本次判定。内容真变、依赖存在性或 role 变了，`readBoundInput` 仍会抛，逐字节那条照旧报 stale。
        let contentAligned: boolean | null = null;
        const alignedByContent = (): boolean => {
          if (contentAligned === null) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readBoundInput, bindingHasParsedValue } = require('./capability-resolution') as typeof import('./capability-resolution');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { inferRepoLayout } = require('../../repo-layout') as typeof import('../../repo-layout');
            contentAligned = bindingHasParsedValue(ref) && (() => {
              try {
                readBoundInput({ projectRoot, frameworkRoot: frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot, feature, phase: obligation.owner_phase, track: 'full', authorityReaders }, ref, legacyRoot);
                return true;
              } catch { return false; }
            })();
          }
          return contentAligned;
        };
        for (const dep of ref.dependencies) {
          // Executed output duties describe the input code at birth; their result is
          // checked by the existing write-set/baseline and phase evidence chain.
          if (basis && isExecutionSourceBasis(projectRoot, scope, obligation, dep)) continue;
          const depPath = resolveDependencyPath(projectRoot, dep.path, legacyRoot);
          if (!isInsideProjectRoot(projectRoot, depPath) || fs.existsSync(depPath) !== dep.exists) { push(obligation.id, `input binding stale ${dep.path}`, 'binding'); continue; }
          if (sha256File(depPath) !== dep.sha256 && !alignedByContent()) push(obligation.id, `input binding stale ${dep.path}`, 'binding');
        }
      } else if (!ref.run_id) {
        // D1 §4.2.4：feature 载体的阶段证据引用没有 run 身份（**不伪造**）。判据换成同强度的
        // 本地事实：证据 manifest 完整、aggregate 与引用一致、freshness fresh。run 终局与
        // run 身份两项在无 run 路径上没有等价物，按 D1.5 的同一条豁免处理。
        const evidence = loadPhaseEvidenceManifest(projectRoot, feature, ref.phase);
        if (phaseEvidenceIsCurrent({ fresh: !!evidence?.integrityOk, generatedAt: evidence?.manifest.generated_at,
          invalidatedAt: proofHistory.invalidatedAt.get(ref.phase) }) !== true) push(obligation.id, 'phase proof predates required repair', 'evidence');
        const fresh = recomputePhaseEvidenceStaleness(projectRoot, feature, [ref.phase], freshnessOpts)[0];
        if (!evidence?.integrityOk || evidence.manifest.aggregate_sha256 !== ref.evidence_manifest_aggregate || fresh.verdict !== 'fresh') {
          push(obligation.id, 'reused evidence invalid', 'evidence');
        }
      } else {
        const evidence = loadPhaseEvidenceManifest(projectRoot, feature, ref.phase);
        if (phaseEvidenceIsCurrent({ fresh: !!evidence?.integrityOk, generatedAt: evidence?.manifest.generated_at,
          invalidatedAt: proofHistory.invalidatedAt.get(ref.phase) }) !== true) push(obligation.id, 'phase proof predates required repair', 'evidence');
        try {
          const source = loadGoalManifestFromRun(projectRoot, ref.run_id, { feature });
          assertGoalRunAttachable(projectRoot, source);
          const isCurrentRun = currentRunId !== undefined && ref.run_id === currentRunId;
          const terminal = resolveEffectiveRunEnd(loadEventsJsonl(path.join(projectRoot, source.report_dir, 'events.jsonl')));
          const terminalOk = isCurrentRun || (!!terminal && ['CHAIN_SLICE_COMPLETED', 'COMPLETED'].includes(String(terminal.status)));
          const fresh = recomputePhaseEvidenceStaleness(projectRoot, feature, [ref.phase], freshnessOpts)[0];
          const identity = resolvePhaseRunIds(projectRoot, feature, [ref.phase]);
          if (!terminalOk || identity.runIds[ref.phase] !== ref.run_id || !evidence?.integrityOk || evidence.manifest.aggregate_sha256 !== ref.evidence_manifest_aggregate || fresh.verdict !== 'fresh') push(obligation.id, 'reused evidence invalid', 'evidence');
        } catch { push(obligation.id, 'reused run missing/corrupt', 'evidence'); }
      }
    }
    if (obligation.applicability === 'required' && obligation.satisfied_by?.some(ref => 'input_id' in ref) && !acceptsDefinitionInputProof(obligation.kind)) push(obligation.id, 'output obligation requires execution evidence', 'evidence');
  }
  return issues;
}

/** Empty scopes reuse existing verified results; this operation never creates a run/certificate. */
export function verifyReusedExecutionScope(projectRoot: string, feature: string, scope: ExecutionScope): { complete: boolean; reasons: string[] } {
  const reasons = executionScopeEvidenceIssues(projectRoot, feature, scope);
  if (scope.phase_chain.length) reasons.push('范围仍有待执行阶段');
  if (scope.completion_target === 'feature' && !reasons.length) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { assessFeature, assessmentReasons } = require('./feature-assessment') as typeof import('./feature-assessment');
    const result = assessFeature(projectRoot, feature, { expectedChain: executionCompletionPhases(scope), expectedTrack: 'full' });
    if (!result.complete) reasons.push(...assessmentReasons(result));
    else {
      const projection = JSON.parse(fs.readFileSync(featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME), 'utf8')) as CompletionProjection;
      const original = JSON.parse(fs.readFileSync(path.join(projectRoot, projection.original_path), 'utf8')) as FeatureCompletion;
      const prior = loadEffectiveExecutionScope(projectRoot, feature, original.run_id ?? undefined);
      if (!prior || JSON.stringify(prior.requested_results) !== JSON.stringify(scope.requested_results)) reasons.push('既有完成记录未证明当前请求目标覆盖');
    }
  }
  return { complete: !reasons.length, reasons };
}

/** plan b2d7f4e9 §3.1：只描述**记录自身**是否自洽（仅供 assessFeature 的 record 使用）；完成与否只由 FeatureAssessment 回答。 */
export type CompletionVerdictKind = 'VALID' | 'INVALID';

export interface CompletionPhaseRecord {
  phase: string;
  /** D1 H1：feature 载体（无 run）下必为 null，且与顶层 `scope_source` 联动校验。 */
  run_id: string | null;
  /** per-phase attempt 身份（events phase_start.attempt 字符串化；不可得为 null）——
   * codex 八轮 P1-1：生产接线（resolvePhaseRunIds 读事件），非装饰。 */
  attempt: string | null;
  gate_fingerprint: string | null;
  receipt_sha256: string | null;
  evidence_manifest_aggregate: string | null;
  /** D1 H2：feature 载体的阶段闭环指纹（run 载体沿用 events 血缘，该字段缺省 null）。 */
  closure_fingerprint?: string | null;
}

export interface FeatureCompletion {
  schema_version: string;
  feature: string;
  generated_at: string;
  /** 生成本凭证的 run（原件必须位于该 run 的 runner-owned 目录内）。D1：feature 载体为 null。 */
  run_id: string | null;
  /** D1.5：范围载体。缺省视为 `'run'`（1.1 及更早的记录没有这个字段）。 */
  scope_source?: 'run' | 'feature';
  workflow_track: string;
  /** Required for 1.2; independently verified against the run-created scope. */
  execution_scope_fingerprint?: string;
  /** D2.6: number of scope_revised entries behind the effective scope this record was cut from. */
  scope_revision_count?: number;
  chain: string[];
  artifact_hashes: {
    spec_md: string | null;
    acceptance_yaml: string | null;
    contracts_yaml: string | null;
  };
  /** codex 七轮 P1-3：需求 SSOT 聚合哈希（内联 manifest.requirement + 解引用文档 + ux-reference） */
  requirement_sha256: string | null;
  /** review 闭环快照 aggregate（源码树 inventory）——与 review-closure-attestation 对账 */
  review_attestation_aggregate: string | null;
  /** testing 期产品源码树 aggregate（review attestation 同源或单调演进链） */
  testing_source_aggregate: string | null;
  phases: CompletionPhaseRecord[];
  parent_run_id: string | null;
  supersedes: string[];
}

export interface CompletionProjection {
  schema_version: string;
  original_path: string;
  original_sha256: string;
}

export interface CompletionVerdict {
  verdict: CompletionVerdictKind;
  reasons: string[];
}

// ----------------------------------------------------------------------------
// clean_pass 检测（生成与验证共用）
// ----------------------------------------------------------------------------

/**
 * clean_pass 违例分类（codex 七轮 P1-2）：
 * - `needs_fix`：确定性故障（verdict FAIL / 血缘 stale-tampered / attestation 缺失失配）
 *   ——须修复或重跑，投影 FEATURE_INCOMPLETE，**不**是"待人工确认"；
 * - `needs_human`：legacy reader compatibility only；当前 writer 不再生成。
 * 当前质量缺口统一由 needs_fix 或 phase outcome 的 capability defer 表达。
 */
export type CleanPassIssueKind = 'needs_fix' | 'needs_human';

export interface CleanPassIssue {
  phase: string;
  condition: string;
  detail: string;
  kind: CleanPassIssueKind;
  /** 合法修改/验证方（来自同一处置；展示消费者用它说明下一步，不另派一单）。 */
  owner?: string;
  action?: import('./check-disposition').CurrentProblemAction;
  source_phase?: string;
  /** lineage_fresh 且只是沿链传染（本阶段自身证据未核）：assessFeature 据此改为逐阶段直查，不把传染当本阶段结果失效。 */
  propagated_from?: string;
}

/** ①b 消费面：schema_version + quality_axes（1.1 多轴；读取失败按 legacy 处理） */
function readSummaryLattice(
  projectRoot: string,
  feature: string,
  phase: string,
  currentSummary?: unknown,
): {
  exists: boolean;
  schemaVersion: string | null;
  axes: Record<string, {
    applicable?: boolean;
    verdict?: string;
    required_for_release?: boolean;
    resolution?: { class?: string; owner?: string; retry_phase?: string } | null;
    source_checks?: readonly string[];
  }> | null;
  releaseReadiness: string | null;
  completionStatus: string | null;
  verdict: string | null;
  reportValidity: string | null;
  closureClosed: boolean;
  closureCommitted: boolean;
  closureCommittedAt: string | null;
  raw: unknown;
} {
  const p = path.join(receiptDirPath(projectRoot, feature, phase), 'reports', 'summary.json');
  if (currentSummary === undefined && !fs.existsSync(p)) {
    return {
      exists: false, schemaVersion: null, axes: null, releaseReadiness: null, completionStatus: null,
      verdict: null, reportValidity: null, closureClosed: false, closureCommitted: false, closureCommittedAt: null, raw: null,
    };
  }
  try {
    const parsed = (currentSummary ?? JSON.parse(fs.readFileSync(p, 'utf-8'))) as {
      schema_version?: string;
      quality_axes?: Record<string, { applicable?: boolean; verdict?: string; required_for_release?: boolean; resolution?: { class?: string; owner?: string; retry_phase?: string } | null; source_checks?: readonly string[] }>;
      release_readiness?: string;
      completion_status?: string;
      verdict?: string;
      report_validity?: string;
      closure_status?: string;
      closure_commit?: { schema_version?: unknown; committed_at?: unknown };
    };
    return {
      exists: true,
      schemaVersion: typeof parsed.schema_version === 'string' ? parsed.schema_version : null,
      axes: parsed.quality_axes ?? null,
      releaseReadiness: typeof parsed.release_readiness === 'string' ? parsed.release_readiness : null,
      completionStatus: typeof parsed.completion_status === 'string' ? parsed.completion_status : null,
      verdict: typeof parsed.verdict === 'string' ? parsed.verdict : null,
      reportValidity: typeof parsed.report_validity === 'string' ? parsed.report_validity : null,
      closureClosed: parsed.closure_status === 'closed',
      closureCommitted: parsed.closure_commit?.schema_version === '1.0',
      closureCommittedAt: typeof parsed.closure_commit?.committed_at === 'string' ? parsed.closure_commit.committed_at : null,
      raw: parsed as unknown,
    };
  } catch {
    return {
      exists: true, schemaVersion: null, axes: null, releaseReadiness: null, completionStatus: null,
      verdict: null, reportValidity: null, closureClosed: false, closureCommitted: false, closureCommittedAt: null, raw: null,
    };
  }
}

export interface CleanPassOptions {
  /** Same synchronous evidence read, supplied by the gate when it has just collected it. */
  actionableEvidence?: ActionableCollectResult;
  resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs;
  authority?: import('./goal-manifest').UnattendedContract;
  authorityReaders?: IdentityNeutralDigestReaders;
  executionScope?: ExecutionScope;
  workflow?: WorkflowSpec;
  endpoint?: 'feature-completion' | 'request';
  /** 本轮生产中的完整原始结果，覆盖同一阶段的旧盘上材料。 */
  currentResults?: ReadonlyArray<{ phase: string; summary: unknown; checks: readonly DispositionCheck[];
    resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs;
    /** Same synchronous read action only; discard after any write or await. */
    phaseIssues?: import('./repair-candidates').PhaseRepairIssues | null;
    acceptanceEvidence?: readonly import('./types').ContextFileEntry[] }>;
  projectRoot: string;
  feature: string;
  chain: string[];
  /** 档位钳制封顶标记（runner 传入；档位被钳制且属强意图时 true） */
  fidelityCapped?: boolean;
  pendingOwnerPhase?: string;
  /** 当前权威 run 的规范化 requirement 内容哈希（P0-2）——血缘重算比对，抓换需求复用旧 closure */
  currentRequirementSha?: string | null;
  /** Explicit quality requirement; independent of invocation counts or scheduling. */
  minimumAssurance?: Partial<Record<string, MinimumAssurance>>;
  /** Same synchronous read action may pass the already-read obligation bindings. */
  scopeFindings?: ReturnType<typeof executionScopeEvidenceFindings>;
  /** 与 closure writer 相同的 framework 身份；省略时由 repo layout 推导。 */
  frameworkRoot?: string;
  /**
   * D2: the run executing right now. Evidence this run just closed is necessarily unsealed
   * (a D2 revision never seals the run), so its terminal `run_end` check is skipped for that run
   * and only that run; every other check and every historical run is unchanged.
   */
  runId?: string;
}

/** Check families come from applicable obligations, never an implicit full workflow. */
export function applicableCheckFamilies(scope: ExecutionScope | undefined, explicit: readonly string[] = []): string[] {
  return [...new Set(scope ? scope.obligations
    .filter(obligation => obligation.applicability !== 'not_applicable').map(obligation => obligation.owner_phase) : explicit)];
}

/** A changed reviewed input needs a fresh request; a newly arrived reply does not rerun its checker. */
export function hasChangedVerifierMaterialInputs(opts: Pick<CleanPassOptions, 'projectRoot' | 'feature' | 'frameworkRoot' | 'authorityReaders'> & {
  phase: string; summary: unknown;
}): boolean {
  const subject = asRecord(opts.summary)?.verifier_subject_id;
  if (typeof subject !== 'string') return false;
  const material = require('./verifier-material') as typeof import('./verifier-material');
  const view = material.readVerifierMaterialOrNull(featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot), subject);
  return !!view && view.files.some(file => !material.verifierMaterialFileMatchesCurrent({ ...opts, material: view, file: file.path }));
}

/** An existing manifest binds completed raw results even before any phase is closed. */
export function readReusableCheckResult(opts: Pick<CleanPassOptions, 'projectRoot' | 'feature' | 'frameworkRoot' | 'currentRequirementSha' | 'runId' | 'resolvedInputs' | 'authorityReaders'> & { phase: string; deviceRequired?: boolean; factsContext?: import('./context-facts').FactsInvocationContext }):
  NonNullable<CleanPassOptions['currentResults']>[number] | null {
  // Native providers own current execution keys, force-fresh and recovery from external conditions.
  // Reading a bound result for observation is separate from deciding to skip another native execution.
  if (opts.deviceRequired) return null;
  try {
    const loaded = loadPhaseEvidenceManifest(opts.projectRoot, opts.feature, opts.phase);
    if (!loaded?.integrityOk || verifyPhaseEvidenceManifestWithStagedOutputs({ ...opts, stagedOutputs: [] }).verdict !== 'fresh') return null;
    if (opts.resolvedInputs) {
      const current = resolvePhaseEvidenceManifest(opts);
      const bound = new Map([...loaded.manifest.inputs, ...loaded.manifest.outputs].map(entry => [entry.path, entry]));
      // Existing freshness readers already decide content equivalence. This only catches new/missing inputs.
      if (current.inputs.some(entry => { const prior = bound.get(entry.path); return !prior || prior.exists !== entry.exists; })) return null;
    }
    const dir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
    const files = ['script-report.json', 'summary.json'].map(name => path.join(dir, name));
    if (!files.every(file => loaded.manifest.outputs.some(entry => path.resolve(opts.projectRoot, entry.path) === path.resolve(file)
      && entry.sha256 === sha256File(file)))) return null;
    const report = JSON.parse(fs.readFileSync(files[0], 'utf8')) as { checks?: DispositionCheck[] };
    const summary = JSON.parse(fs.readFileSync(files[1], 'utf8'));
    if (!Array.isArray(report.checks) || !report.checks.length) return null;
    const authorityKind = ['spec', 'prd'].includes(opts.phase) ? 'acceptance' : ['plan', 'design'].includes(opts.phase) ? 'contracts' : undefined;
    if (authorityKind && report.checks.some(check => check.id === 'authoritative_content_aligned')) {
      const { deriveBlueprintSkillInput } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
      const current = deriveBlueprintSkillInput(opts.projectRoot, opts.feature, opts.frameworkRoot ?? path.resolve(__dirname, '../../..'), authorityKind, opts.authorityReaders);
      const inputs = new Set(loaded.manifest.inputs.map(entry => path.resolve(opts.projectRoot, entry.path)));
      if (current.dependencies.some(dep => !inputs.has(path.resolve(opts.projectRoot, dep.path)))) return null;
    }
    return { phase: opts.phase, summary, checks: report.checks };
  } catch { return null; }
}

/** Fold completed originals; a reused result never advances the comparison baseline. */
export function completionProgressFromHistory(current: CompletionEvaluation, history: readonly CompletionEvaluation[], feedbackDelivered: boolean, authorReturned = false) {
  let previous: CompletionEvaluation | null = null;
  const comparable: CompletionEvaluation[] = [];
  const family = [...current.checkFamilies ?? []].sort().join('\0');
  for (const item of history) {
    if (item.acceptanceKey !== current.acceptanceKey) { previous = null; comparable.length = 0; continue; }
    if ([...item.checkFamilies ?? []].sort().join('\0') !== family) continue;
    const read = evaluateCompletionProgress({ previous, current: item, history: comparable, feedbackDelivered: previous !== null });
    if (!read.reused && read.evaluation) { previous = read.evaluation; comparable.push(read.evaluation); }
  }
  return evaluateCompletionProgress({ previous, current, history: comparable, feedbackDelivered, authorReturned });
}

export function completedCheckResultsFromOutput(text: string): Array<{ phase: string; evaluation: CompletionEvaluation }> {
  return text.split(/\r?\n/).flatMap(line => {
    if (!line.startsWith('current_check_result=')) return [];
    try {
      const result = JSON.parse(line.slice('current_check_result='.length));
      return typeof result.phase === 'string' && typeof result.evaluation?.acceptanceKey === 'string'
        && result.evaluation.inputs && Array.isArray(result.evaluation.disposition?.problems) ? [result] : [];
    } catch { return []; }
  });
}

function repairDeclineComparisonInputs(opts: Pick<CleanPassOptions, 'projectRoot' | 'feature' | 'runId' | 'frameworkRoot'>): ArtifactSnapshot {
  const inputs: ArtifactSnapshot = {};
  const originals = (require('./repair-candidates') as typeof import('./repair-candidates')).readRepairDeclineOriginals(
    opts.projectRoot, opts.feature, opts.runId, opts.frameworkRoot);
  for (const original of originals) {
    const facts = [...new Set(original.entries.map(entry => {
      const { ts: _time, decision_id: _identity, ...decision } = entry;
      return stableStringify(decision);
    }))].sort();
    inputs[original.path] = { exists: true, contentHash: crypto.createHash('sha256').update(stableStringify(facts)).digest('hex') };
  }
  return inputs;
}

/** The original tool start and its bound inputs also govern ordinary public recovery. */
export function readCurrentCheckObservation(opts: { projectRoot: string; frameworkRoot?: string; feature: string; runId: string; phase: string;
  factsContext?: import('./context-facts').FactsInvocationContext }) {
  const events = loadAuthoritativeRunEvents(opts.projectRoot, opts.feature, opts.runId);
  const start = [...events].reverse().find(event => event.type === 'harness_start' && event.phase === opts.phase && event.invoke_id);
  const end = start && events.slice(events.indexOf(start) + 1).find(event => event.type === 'harness_end'
    && event.phase === opts.phase && event.invoke_id === start.invoke_id);
  const returnedSnapshot = end?.related_input_snapshot;
  const returnedInputs = end?.timed_out === false && typeof end.exit_code === 'number' && returnedSnapshot
    && compareRelatedInputSnapshots(returnedSnapshot, returnedSnapshot) === 'unchanged'
    ? returnedSnapshot : undefined;
  const returnedPaths = Object.keys(returnedInputs ?? {}).flatMap(key => {
    if (key.startsWith('<environment:')) return [];
    const relative = normalizeRelatedPath(opts.projectRoot, key);
    return relative ? [relative] : [];
  });
  const loaded = loadPhaseEvidenceManifest(opts.projectRoot, opts.feature, opts.phase);
  const report = readQualifiedPhaseReport(opts.projectRoot, opts.feature, opts.phase);
  const derivesSourceFiles = (source: import('./skill-contract').ContractInputSource | undefined): boolean =>
    source?.kind === 'derive' && ['derive.codebase', 'derive.test-targets'].includes(source.provider_id);
  const sourceInputs = (report?.capabilities ?? []).filter(capability => capability.active
    && capability.state !== 'pruned' && capability.state !== 'not_applicable' && Array.isArray(capability.inputs))
    .flatMap(capability => capability.inputs).filter(input => input && (derivesSourceFiles(input.binding?.source)
      || Array.isArray(input.attempts) && input.attempts.some(attempt => attempt?.kind === 'derive'
        && ['derive.codebase', 'derive.test-targets'].includes(attempt.source))));
  const sourceRefs = sourceInputs.flatMap(input => {
    const binding = input.binding;
    return binding && derivesSourceFiles(binding.source) && Array.isArray(binding.source_refs)
      ? binding.source_refs.filter(ref => typeof ref === 'string' && ref !== '' && ref !== '.') : [];
  });
  const sourceFiles = sourceInputs.length ? implementationFiles(opts.projectRoot, opts.feature, { files: sourceRefs, modules: [] }, opts.runId) : [];
  const boundEntries = new Map((loaded?.integrityOk ? [...loaded.manifest.inputs, ...loaded.manifest.outputs] : []).map(entry => [entry.path, entry]));
  // Observation reads current values, not a new admission from the old author's baseline.
  // The formal producer still resolves and validates its complete binding when it runs.
  const current = resolvePhaseEvidenceManifest({ projectRoot: opts.projectRoot, frameworkRoot: opts.frameworkRoot,
    feature: opts.feature, phase: opts.phase, requirementSha: computeRunRequirementSha(opts.projectRoot, opts.feature, opts.runId),
    extraInputs: returnedPaths });
  const businessInputs = (manifest: typeof current) => phaseEvidenceBusinessInputs(opts.projectRoot, opts.feature, manifest, opts);
  const currentInputs = new Map([...businessInputs(current), ...(loaded?.integrityOk ? businessInputs(loaded.manifest) : [])]
    .map(entry => [entry.path, entry]));
  for (const file of returnedPaths) {
    const entry = boundEntries.get(file);
    if (entry) currentInputs.set(file, entry);
  }
  for (const file of sourceFiles) currentInputs.set(file, boundEntries.get(file) ?? { path: file, role: 'input', exists: false, sha256: null });
  const declineInputs = repairDeclineComparisonInputs(opts);
  const runtime = createRuntimeArtifactPredicate(opts);
  const environmentInput = (value: string | null | undefined) => value == null
    ? { exists: false, contentHash: '' }
    : { exists: true, contentHash: crypto.createHash('sha256').update(String(value)).digest('hex') };
  const snapshot = (entries: ReturnType<typeof businessInputs>, environment: typeof current.environment, observeCurrent = false): ArtifactSnapshot => {
    const inputs: ArtifactSnapshot = {};
    for (const entry of entries) {
      if (runtime(entry.path)) continue;
      const hash = observeCurrent ? declineInputs[entry.path]?.contentHash
        ?? currentEvidenceEntryHash(opts.projectRoot, entry, opts.feature) : entry.sha256;
      inputs[entry.path] = { exists: observeCurrent ? hash !== null : entry.exists, contentHash: hash ?? '' };
    }
    for (const [key, value] of Object.entries(environment)) inputs[`<environment:${key}>`] = environmentInput(value);
    return inputs;
  };
  const inputs = snapshot([...currentInputs.values()], current.environment, true);
  let previous = returnedInputs ?? start?.related_input_snapshot;
  const summary = path.join(featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot), 'summary.json');
  const bound = loaded?.integrityOk && loaded.manifest.outputs.some(entry => path.resolve(opts.projectRoot, entry.path) === summary
    && entry.sha256 === sha256File(summary));
  if (bound && loaded) {
    const recordedSources = sourceFiles.flatMap(file => { const entry = boundEntries.get(file); return entry ? [entry] : []; });
    const recorded = snapshot([...businessInputs(loaded.manifest), ...recordedSources], loaded.manifest.environment);
    // Actual dependencies discovered by this tool extend the original start view, without replacing its observed environment.
    if (previous) previous = { ...recorded, ...previous };
    else previous = recorded;
  }
  const providerKey = '<environment:visual_provider_pin>';
  const hadProviderInput = !!asRecord(previous)?.[providerKey];
  const consumesProvider = report ? report.checks.some(check => ['visual_provider_round', 'visual_diff'].includes(String(asRecord(check.structured)?.kind)))
    || report.capabilities.some(capability => capability.id === 'device_test.visual_diff' && capability.active
      && capability.state !== 'not_applicable' && capability.state !== 'pruned') : hadProviderInput;
  if (consumesProvider) {
    const manifest = loadGoalManifestFromRun(opts.projectRoot, opts.runId, { feature: opts.feature });
    inputs[providerKey] = environmentInput(manifest.visual_provider_pin === undefined ? undefined : manifestIdentityFieldDigest(manifest.visual_provider_pin));
    if (start && !hadProviderInput) {
      const priorFields = identityBaseline(events.slice(0, events.indexOf(start)));
      if (priorFields) previous = { ...previous, [providerKey]: environmentInput(priorFields.visual_provider_pin) };
      else delete inputs[providerKey]; // No trusted old value: do not manufacture a changed producer input.
    }
  } else if (hadProviderInput && report) {
    previous = { ...previous };
    delete previous[providerKey]; // The current qualified producer no longer consumes this input.
  }
  const change = compareRelatedInputSnapshots(previous, inputs);
  const conditionReady = !!start && events.slice(events.indexOf(start) + 1)
    .some(event => event.type === 'condition_wait_ready' && event.phase === opts.phase);
  const changed = conditionReady || change === 'changed' || change === 'unknown' && compareRelatedInputSnapshots(previous, previous ?? {}) === 'unchanged'
    && compareRelatedInputSnapshots(inputs, inputs) === 'unchanged' && Object.keys(previous ?? {}).sort().join('\0') !== Object.keys(inputs).sort().join('\0');
  return { inputs, start, end, change, changed, conditionReady, returned: returnedInputs !== undefined };
}

/** The comparison view uses the same real results and existing manifest bindings. */
export function currentCompletionEvaluation(opts: CleanPassOptions, disposition: CurrentDisposition): CompletionEvaluation {
  const results = opts.currentResults ?? [];
  const checkFamilies = results.map(result => result.phase);
  const completionBlocking = disposition.completionBlocking.filter(problem => checkFamilies.includes(problem.source_phase ?? problem.phase));
  const inputs: CompletionEvaluation['inputs'] = {};
  const definitions = new Map<string, unknown>();
  const reviewedArguments = new Set<string>();
  const processNotes = new Set(opts.chain.map(phase => path.relative(opts.projectRoot,
    path.join(receiptDirPath(opts.projectRoot, opts.feature, phase), 'notes.md')).replace(/\\/g, '/')));
  let completed = results.length > 0 && results.every(result => result.checks.length > 0 && !result.checks.some(check => isRequiredCheckGap(check)))
    && !completionBlocking.some(problem => problem.action === 'verify' || problem.action === 'wait');
  for (const result of results) {
    const loaded = loadPhaseEvidenceManifest(opts.projectRoot, opts.feature, result.phase);
    if (!loaded?.integrityOk) { completed = false; continue; }
    for (const name of ['script-report.json', 'summary.json']) {
      const file = path.join(featurePhaseReportsDir(opts.projectRoot, opts.feature, result.phase, opts.frameworkRoot), name);
      if (!loaded.manifest.outputs.some(entry => path.resolve(opts.projectRoot, entry.path) === path.resolve(file) && entry.sha256 === sha256File(file))) completed = false;
    }
    const subject = asRecord(result.summary)?.verifier_subject_id;
    if (typeof subject === 'string') {
      const material = (require('./verifier-material') as typeof import('./verifier-material')).readVerifierMaterialOrNull(
        featurePhaseReportsDir(opts.projectRoot, opts.feature, result.phase, opts.frameworkRoot), subject);
      for (const file of material?.files ?? []) reviewedArguments.add(file.path);
    }
    const runtime = createRuntimeArtifactPredicate({ ...opts, phase: result.phase });
    for (const entry of [...loaded.manifest.inputs, ...loaded.manifest.outputs]) {
      if (runtime(entry.path) || processNotes.has(entry.path)) continue;
      let hash = entry.sha256;
      try {
        if (/\.(?:ya?ml|json)$/.test(entry.path) && entry.exists) {
          const value = YAML.parse(fs.readFileSync(path.resolve(opts.projectRoot, entry.path), 'utf8'));
          if (asRecord(value)?.artifact === 'component-blueprint@1') hash = crypto.createHash('sha256')
            .update(stableStringify(blueprintAuthorContent(value, false))).digest('hex');
          if (entry.role === 'input' && asRecord(value)?.artifact === 'component-blueprint@1') definitions.set(entry.path, { kind: value.artifact, hash });
          if (entry.role === 'input' && asRecord(value)?.artifact === 'change-unit@1') definitions.set(entry.path, {
            kind: value.artifact, blueprint_id: value.blueprint_id, change_unit_id: value.change_unit_id, revision: value.revision });
        }
      } catch { /* Invalid syntax is still a real byte-bound input; its checker owns that defect. */ }
      if (entry.exists && !hash) completed = false;
      inputs[entry.path] = { exists: entry.exists, contentHash: hash ?? '' };
    }
  }
  for (const [file, semantic] of Object.entries(repairDeclineComparisonInputs(opts))) {
    if (reviewedArguments.has(file) || inputs[file]) inputs[file] = semantic;
  }
  let manifest: ReturnType<typeof loadGoalManifestFromRun> | undefined;
  try { if (opts.runId) manifest = loadGoalManifestFromRun(opts.projectRoot, opts.runId, { feature: opts.feature }); } catch { completed = false; }
  // Only committed birth/revision facts identify acceptance versions. A mutable candidate or
  // refreshed working view must not buy a new convergence window by changing its own bytes.
  let effectiveScope: ExecutionScope | undefined;
  try { effectiveScope = resolveEffectiveScopeSource(opts.projectRoot, opts.feature, opts.runId)?.scope; }
  catch { completed = false; }
  let authority = opts.authority;
  if (!authority && manifest) {
    try {
      const { executionRequestForInvoke } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
      authority = executionRequestForInvoke(path.resolve(opts.projectRoot, manifest.report_dir))?.request.context.authority;
    } catch { /* A runless tool has no signed author context. */ }
  }
  authority ??= manifest?.unattended;
  const acceptanceKey = crypto.createHash('sha256').update(stableStringify({ feature: opts.feature,
    requirement: opts.currentRequirementSha ?? (manifest ? computeRunRequirementSha(opts.projectRoot, opts.feature, manifest.run_id) : null),
    policy: effectiveScope?.policy_fingerprint ?? manifest?.execution_scope?.policy_fingerprint,
    definitions: [...definitions].sort(([left], [right]) => left.localeCompare(right)),
    acceptance: effectiveScope?.obligations.map(obligation => ({ id: obligation.id, kind: obligation.kind,
      applicability: obligation.applicability, owner: obligation.owner_phase,
      // Published definition bindings are target versions; implementation edits and fresh proof receipts are not.
      basis: acceptsDefinitionInputProof(obligation.kind) ? obligation.basis.map(binding => ({ input_id: binding.input_id,
        source: binding.source, source_refs: binding.source_refs, content_fingerprint: binding.content_fingerprint })) : [],
    })),
    authority: authority && { write_mode: authority.write_mode, approval_mode: authority.approval_mode, allowed_tools: authority.allowed_tools },
  })).digest('hex');
  return { acceptanceKey, inputs, completed, disposition, checkFamilies };
}

/** Existing native tool-result originals carry this tool output; no evaluation ledger is written. */
export function completedCheckResultsFromToolEvents(adapter: string, events: readonly unknown[], historical = false): Array<{ phase: string; evaluation: CompletionEvaluation; current: boolean }> {
  const outputStrings = (record: any): string[] => {
    if (record?.type === 'item.completed') return typeof record.item?.aggregated_output === 'string' ? [record.item.aggregated_output] : [];
    if (record?.type === 'user') return (Array.isArray(record.message?.content) ? record.message.content : []).filter((block: any) => block?.type === 'tool_result').flatMap((block: any) =>
      typeof block.content === 'string' ? [block.content] : (Array.isArray(block.content) ? block.content : []).filter((entry: any) => entry?.type === 'text').map((entry: any) => entry.text));
    return ['output', 'result', 'content', 'text'].flatMap(key => typeof record?.[key] === 'string' ? [record[key]] : []);
  };
  const last = [...events].reverse().find(record => isProviderToolResult(record as Record<string, unknown>, adapter));
  if (!historical && (!last || !outputStrings(last).some(text => text.includes('current_check_result=')))) return [];
  const out: Array<{ phase: string; evaluation: CompletionEvaluation; current: boolean }> = [];
  for (const record of events) {
    if (!isProviderToolResult(record as Record<string, unknown>, adapter)) continue;
    for (const text of outputStrings(record)) out.push(...completedCheckResultsFromOutput(text).map(result => ({ ...result, current: record === last })));
  }
  return out;
}

/** 当前完成阻断的薄兼容出口；原报告和发布披露由同一处置保留。 */
export function collectCleanPassIssues(opts: CleanPassOptions): CleanPassIssue[] {
  return resolveCompletionDisposition(opts).completionBlocking.map(completionIssue);
}

/** 当前适用的机器运行证据，同一组装入口提供给 scope/assess/完成消费者。 */
function readRuntimeCompletionIssues(opts: CleanPassOptions): CleanPassIssue[] {
  const { projectRoot, feature, chain } = opts;
  const issues: CleanPassIssue[] = [];
  if (!applicableCheckFamilies(opts.executionScope, chain).includes('testing')) return issues;
  // ⑧ P0 runtime fidelity: only machine observations in the existing
  // Hylyre trace + device-test-evidence artifact can satisfy this obligation.
  // The legacy runtime_fidelity_attestation receipt is intentionally inert.
  {
    let suppliedAcceptance: unknown = undefined;
    if (opts.executionScope) {
      try {
        const { readScopeAcceptance } = require('./feature-track') as typeof import('./feature-track');
        const { inferRepoLayout } = require('../../repo-layout') as typeof import('../../repo-layout');
        suppliedAcceptance = readScopeAcceptance(projectRoot, { facts: opts.executionScope.obligations }, { feature,
          frameworkRoot: opts.frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot, authorityReaders: opts.authorityReaders })?.value ?? null;
      } catch (error) { issues.push({ phase: 'testing', condition: 'acceptance_binding', detail: String(error), kind: 'needs_fix' }); suppliedAcceptance = null; }
    }
    const doc = loadAcceptanceFlowsDoc(projectRoot, feature, suppliedAcceptance);
    const hasP0DeviceFlow = resolveP0DeviceObligations(projectRoot, feature, doc).device.length > 0;
    if (hasP0DeviceFlow) {
      let expectedRunId: string | null = null;
      let expectedAttemptId: string | null = null;
      try {
        const identity = resolvePhaseRunIds(projectRoot, feature, chain);
        expectedRunId = identity.runIds.testing ?? null;
        expectedAttemptId = identity.attempts.testing ?? null;
      } catch (error) {
        issues.push({
          phase: 'testing',
          condition: 'runtime_step_evidence_identity',
          detail: `testing run/attempt 身份无法重算：${(error as Error).message}`,
          kind: 'needs_fix',
        });
      }
      const inputIssue = runtimeFidelityEvidenceIssue(
        projectRoot,
        feature,
        expectedRunId,
        expectedAttemptId,
        false,
      );
      const unpublished = opts.currentResults?.some(result => result.phase === 'testing');
      const runtimeIssue = inputIssue ?? (unpublished ? null : runtimeFidelityEvidenceIssue(
        projectRoot, feature, expectedRunId, expectedAttemptId,
      ));
      if (runtimeIssue) {
      issues.push({
        phase: 'testing',
        condition: 'runtime_step_evidence',
        detail: `P0 runtime fidelity 机器证据无效：${runtimeIssue}`,
        kind: 'needs_fix',
        action: 'verify',
        owner: 'testing',
      });
      }
    }
  }

  return issues;
}

/**
 * 旧 verifier 的具体发现缺当前核实材料时，保留发现并交原验证方补核实。
 * 范围修订、时间先后或其他对象的 PASS 都不能证明这条发现已经解决。
 */
function readDiagnosticFindings(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot: string | undefined,
  subjectId: string | null,
  runId: string | undefined,
  phaseIssues?: import('./repair-candidates').PhaseRepairIssues | null,
): Array<{ id: string; detail: string; files?: readonly string[]; evidence?: readonly string[] }> {
  if (!subjectId || (phase !== 'spec' && phase !== 'plan')) return [];
  try {
    const { readPhaseRepairIssues, parseIssueVerificationBlock } = require('./repair-candidates') as typeof import('./repair-candidates');
    const bound = phaseIssues === undefined ? readPhaseRepairIssues(projectRoot, feature, phase, { subjectId, frameworkRoot, runId }) : phaseIssues;
    if (!bound) return [];
    const out: Array<{ id: string; detail: string; files?: readonly string[]; evidence?: readonly string[] }> = [];
    for (const diagnostic of bound.diagnostics ?? []) {
      // 诊断以 `<finding id>：` 开头 = 读到了具体发现但缺核实格式；其余是表格/路径级说明。
      const match = /^([A-Za-z][A-Za-z0-9_.-]{2,})：/.exec(diagnostic);
      if (match) out.push({ id: match[1], detail: diagnostic.slice(match[0].length).trim() || diagnostic });
    }
    const verification = parseIssueVerificationBlock(bound.reportText);
    for (const row of bound.rows) {
      if (verification.entries.find(entry => entry.issue === row.id)?.verdict !== 'refuted') {
        out.push({ id: row.id, detail: `具体现实发现须由当前subject核实：${row.summary}` });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** A shared check/screen ID can contain distinct producer-bound objects. */
function currentFindingEvidence(projectRoot: string, phase: string, finding: { id: string; item_fingerprint?: string; evidence?: readonly string[] }, checks: readonly DispositionCheck[]): string[] {
  const check = checks.find(row => row.id === finding.id || `${phase}:${row.id}` === finding.id);
  const diagnostic = [...(check && nativeCompileDiagnosticRefs(check, projectRoot) || check?.evidence || [])];
  const ref = (check?.structured as { repair_evidence?: unknown } | undefined)?.repair_evidence;
  if (ref && (require('./repair-candidates') as typeof import('./repair-candidates')).validateRepairEvidenceRef(ref).length === 0) {
    const original = ref as import('./repair-candidates').RepairEvidenceRef;
    const evidence = `case:${original.case_id}#step:${original.step_index}`;
    if (finding.evidence?.includes(evidence)) diagnostic.push(evidence, original.trace_path,
      ...original.derived_plan_path ? [original.derived_plan_path] : [], ...original.artifact_paths ?? []);
  }
  for (const row of checks) {
    const visual = row.structured as { kind?: unknown; fingerprintable?: unknown; defect_fingerprints?: unknown } | undefined;
    if (visual?.kind !== 'visual_diff' || visual.fingerprintable !== true || !Array.isArray(visual.defect_fingerprints)) continue;
    for (const ref of visual.defect_fingerprints) if (typeof ref === 'string' && ref.trim()
      && crypto.createHash('sha256').update(ref).digest('hex') === finding.item_fingerprint) diagnostic.push(`visual:${ref}`);
  }
  return [...new Set(diagnostic)];
}

function uniqueFindingObjects<T extends { id: string; item_fingerprint?: string }>(findings: readonly T[]): T[] {
  const seen = new Map<string, Set<string | undefined>>();
  return findings.filter(finding => {
    const fingerprint = finding.item_fingerprint || undefined;
    const prior = seen.get(finding.id);
    if (!prior) { seen.set(finding.id, new Set([fingerprint])); return true; }
    if (!fingerprint || prior.has(undefined) || prior.has(fingerprint)) return false;
    prior.add(fingerprint);
    return true;
  });
}

/** 已登记的未处置实质发现：summary.repair_candidates（当前候选）与 issue-verification 设计发现。 */
function readRegisteredFindings(summary: unknown, responsibility: import('./repair-responsibility').RepairResponsibilityContext): Array<{ id: string; owner?: string; detail: string; files?: readonly string[]; evidence?: readonly string[]; item_fingerprint?: string; verificationRequired?: boolean }> {
  const s = (summary ?? {}) as { repair_candidates?: unknown; blockers?: unknown };
  const out: Array<{ id: string; owner?: string; detail: string; files?: readonly string[]; evidence?: readonly string[]; item_fingerprint?: string; verificationRequired?: boolean }> = [];
  if (Array.isArray(s.repair_candidates)) {
    for (const item of s.repair_candidates) {
      const row = item as import('./repair-candidates').RepairCandidate;
      if (typeof row?.id !== 'string') continue;
      const owner = resolveRepairResponsibility({ ...responsibility, target: row }).owner;
      out.push({
        id: row.id,
        ...(owner ? { owner } : {}),
        ...(typeof row.item_fingerprint === 'string' ? { item_fingerprint: row.item_fingerprint } : {}),
        detail: typeof row.summary === 'string' ? row.summary : row.id,
        ...(row.files?.length ? { files: row.files } : {}),
        ...(row.evidence_refs?.length ? { evidence: row.evidence_refs.map(ref => `case:${ref.case_id}#step:${ref.step_index}`) } : {}),
      });
    }
  }
  if (Array.isArray(s.blockers)) {
    for (const item of s.blockers) {
      const row = item as { id?: unknown; source?: unknown; details_excerpt?: unknown; affected_files?: string[]; repair_owner?: string };
      if (row?.source !== 'issue-verification' || typeof row.id !== 'string') continue;
      const owner = resolveRepairResponsibility({ ...responsibility, target: { files: row.affected_files, owner: row.repair_owner } }).owner;
      out.push({ id: row.id, ...(owner ? { owner } : {}), detail: String(row.details_excerpt ?? row.id).slice(0, 500) });
    }
  }
  return uniqueFindingObjects(out);
}

function readQualifiedPhaseReport(projectRoot: string, feature: string, phase: string, summary?: unknown): {
  checks: DispositionCheck[]; capabilities: import('./capability-resolution').CapabilityResolution[];
} | null {
  // featurePhaseReportsDir 已返回 `<phase>/reports`（summary.json 也直接用这个目录）。
  const p = path.join(featurePhaseReportsDir(projectRoot, feature, phase), 'script-report.json');
  try {
    const declared = (summary as { script_report?: unknown } | null)?.script_report;
    const linked = typeof declared === 'string' && path.resolve(projectRoot, declared) === path.resolve(p);
    const manifest = linked ? null : loadPhaseEvidenceManifest(projectRoot, feature, phase);
    const summaryPath = path.join(path.dirname(p), 'summary.json');
    const bound = manifest?.integrityOk && [p, summaryPath].every(file => manifest.manifest.outputs.some(entry =>
      path.resolve(projectRoot, entry.path) === path.resolve(file) && entry.sha256 === sha256File(file)));
    // 原始结果须属于这份summary或同一已冻结证据快照；不把目录里另一轮的报告并进来。
    if (!linked && !bound) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { checks?: unknown; capability_resolutions?: import('./capability-resolution').CapabilityResolution[] };
    return {
      checks: Array.isArray(raw.checks)
        ? raw.checks.filter((check): check is DispositionCheck => !!check && typeof (check as { id?: unknown }).id === 'string') : [],
      capabilities: Array.isArray(raw.capability_resolutions)
        ? raw.capability_resolutions.filter(capability => !!capability && typeof capability === 'object' && typeof capability.id === 'string') : [],
    };
  } catch {
    return null;
  }
}

export function readPhaseChecks(projectRoot: string, feature: string, phase: string, summary?: unknown): DispositionCheck[] {
  return readQualifiedPhaseReport(projectRoot, feature, phase, summary)?.checks ?? [];
}

/**
 * plan 6fd6c8c1 §4.1 **唯一输入组装处**：把本阶段当前适用事实读成同一集合——
 * summary（裁决/轴/闭环）、检查结果、必需缺口、证据新鲜度、review attestation、债务与已登记发现。
 * 不派修、不判终态；不反向调用 assess / scope view 再求一次结论。事实变化后调用方重新组装。
 */
export interface CurrentRequestDispositionOptions {
  endpoint: 'request';
  projectRoot: string;
  request: import('./capability-resolution-entry-input').PreparedRequest;
  checks?: readonly DispositionCheck[];
  summary?: { verdict?: string };
}

export interface CurrentDesignDispositionOptions {
  endpoint: 'design'; projectRoot: string; blueprintPath: string; blueprint: BlueprintRecord | undefined;
  blueprintIssues: readonly BlueprintIssue[]; questioningFindings?: readonly BlueprintRecord[]; phase?: string;
  checks?: readonly DispositionCheck[];
  providerState?: 'available' | 'unavailable' | 'unknown';
}

function blueprintIssueReferences(blueprint: BlueprintRecord | undefined, location: string): string[] {
  if (!blueprint || typeof blueprint.blueprint_id !== 'string') return [];
  try {
    const index = stableAddressIndex(blueprint);
    const pieces = location.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: unknown = blueprint, anchor: string | undefined;
    for (const part of pieces) {
      if (!current || typeof current !== 'object') break;
      const address = [...index].find(([, value]) => value === current)?.[0];
      if (address) anchor = address;
      const scope = asRecord(current)?.scope_ref;
      if (typeof scope === 'string' && /^(?:view|relation|flow|app_lens|terminology):/.test(scope)) anchor = scope;
      current = (current as Record<string, unknown>)[part];
    }
    if (anchor && anchor !== `blueprint:${blueprint.blueprint_id}`) return [`${blueprint.blueprint_id}/${anchor}#${pieces.at(-1) ?? '$'}`];
    return /\[\d+\]/.test(location) ? [] : [`blueprint:${blueprint.blueprint_id}#${location}`];
  } catch { return []; }
}

export function readCurrentDispositionInput(opts: CleanPassOptions | CurrentRequestDispositionOptions | CurrentDesignDispositionOptions): CurrentDispositionInput {
  if ('blueprintIssues' in opts) {
    const phase = opts.phase ?? 'component-design';
    const problems: NonNullable<CurrentDispositionInput['additionalProblems']>[number][] = [];
    const providers = new Set(['blueprint_questioning_provider_missing', 'blueprint_required_provider_missing', 'blueprint_conventions_provider_unreadable']);
    for (const issue of opts.blueprintIssues) {
      if (issue.severity !== 'BLOCKER') continue;
      const itemIndex = /^\$\.review_summary\.questioning\.items\[(\d+)\]\.disposition$/.exec(issue.path)?.[1];
      const items = asRecord(asRecord(opts.blueprint?.review_summary)?.questioning)?.items;
      const item = itemIndex !== undefined && Array.isArray(items) ? asRecord(items[Number(itemIndex)]) : undefined;
      const realNegative = item?.disposition === 'blocker';
      const independentFormat = issue.path.startsWith('$.review_summary.questioning') && !realNegative;
      const action = providers.has(issue.id) ? opts.providerState === 'unavailable' ? 'wait' : 'verify' : independentFormat ? 'verify' : 'repair';
      problems.push({ phase, id: `open_finding:${issue.id}@${issue.path}`, action, affects: 'completion', severity: 'BLOCKER', owner: phase,
        detail: `${issue.id} ${issue.path}: ${issue.message}`, files: [path.relative(opts.projectRoot, opts.blueprintPath).replace(/\\/g, '/')],
        evidence: blueprintIssueReferences(opts.blueprint, issue.path) });
    }
    for (const item of opts.questioningFindings ?? []) {
      const scope = typeof item.scope_ref === 'string' ? item.scope_ref : '';
      problems.push({ phase, id: `open_finding:questioning:${scope}`, action: 'repair', affects: 'completion', severity: 'BLOCKER', owner: phase,
        detail: `独立质询否定 ${scope}：${String(item.question ?? '')}；${String(item.answer ?? '')}`,
        files: [path.relative(opts.projectRoot, opts.blueprintPath).replace(/\\/g, '/')], evidence: scope ? [scope] : [] });
    }
    if (!opts.blueprint && !problems.length) problems.push({ phase, id: 'verdict_pass', action: 'verify', affects: 'completion', severity: 'BLOCKER', detail: '蓝图事实尚不可读取，不能由空问题集推通过。' });
    return { endpoint: 'request', phases: opts.checks?.length ? [{ phase, summaryPresent: false, verdict: null,
      schemaCurrent: false, closureCommitted: false, checks: opts.checks,
      requiredGaps: opts.checks.filter(check => isRequiredCheckGap(check)) }] : [], additionalProblems: problems };
  }
  if ('request' in opts) {
    let checks = opts.checks;
    let summary = opts.summary;
    if (checks === undefined) {
      try {
        const report = JSON.parse(fs.readFileSync(path.join(opts.request.reportDir, 'script-report.json'), 'utf8')) as {
          request_sha256?: string; targets?: import('./capability-resolution-entry-input').PreparedRequest['bindings']; checks?: DispositionCheck[]; summary?: { verdict?: string };
        };
        if (report.request_sha256 === opts.request.request_sha256 && JSON.stringify(report.targets) === JSON.stringify(opts.request.bindings) && Array.isArray(report.checks)) {
          checks = report.checks; summary = report.summary;
        }
      } catch { /* 无当前请求结果就是待验证，不回读无关Feature材料。 */ }
    }
    checks = checks?.map(check => {
      const evidence = typeof check.id === 'string' ? nativeCompileDiagnosticRefs(check, opts.projectRoot) : undefined;
      return evidence === undefined ? check : { ...check, evidence };
    });
    return { endpoint: 'request', phases: [{ phase: opts.request.phase, summaryPresent: !!summary,
      verdict: summary?.verdict ?? null, schemaCurrent: false, closureCommitted: false,
      requiredGaps: (checks ?? []).filter(check => isRequiredCheckGap(check)), checks, failingChecks: (checks ?? []).filter(check => check.status === 'FAIL') }],
      ...(checks === undefined ? { additionalProblems: [{ phase: opts.request.phase, id: 'verdict_pass', action: 'verify' as const,
        affects: 'completion' as const, severity: 'BLOCKER' as const, detail: `当前专项请求 ${opts.request.request_sha256} 尚无结果` }] } : {}) };
  }
  opts = { ...opts, authorityReaders: opts.authorityReaders ?? (require('./identity-neutral-digest') as typeof import('./identity-neutral-digest')).createIdentityNeutralDigestReaders() };
  if (!opts.executionScope && opts.runId) opts = { ...opts, executionScope: resolveEffectiveScopeSource(opts.projectRoot, opts.feature, opts.runId)?.scope };
  const { projectRoot, feature, chain } = opts;
  const endpoint = opts.endpoint ?? (opts.executionScope?.completion_target === 'request' ? 'request' : 'feature-completion');
  const additionalProblems: NonNullable<CurrentDispositionInput['additionalProblems']>[number][] = [];
  const actionableEvidence = applicableCheckFamilies(opts.executionScope, chain).includes('testing') && opts.runId
    ? opts.actionableEvidence ?? readCurrentActionableEvidence(projectRoot, feature, opts.runId, opts.frameworkRoot) : undefined;
  if (actionableEvidence) {
    for (const gap of actionableEvidence.unverified) additionalProblems.push({
      phase: 'testing', source_phase: 'testing', id: 'unverifiable_must_fix', action: 'verify', affects: 'completion', severity: 'BLOCKER', owner: 'testing',
      detail: `${gap.screen_or_case_id}：${gap.reason}。责任=原验证证据 producer；解除条件：补齐该对象的真实截图、安装/build 或设备执行绑定后，仅补原验证；未知不能当产品失败或通过。`,
      files: gap.source === 'visual' ? [path.relative(projectRoot, featureFilePath(projectRoot, feature, 'device-testing/device-screenshots/visual-diff.json')).replace(/\\/g, '/'),
        path.relative(projectRoot, path.join(featurePhaseReportsDir(projectRoot, feature, 'testing', opts.frameworkRoot), 'device-test-install.meta.json')).replace(/\\/g, '/')]
        : [path.relative(projectRoot, deviceTestEvidencePath(featurePhaseReportsDir(projectRoot, feature, 'testing', opts.frameworkRoot))).replace(/\\/g, '/')],
      evidence: [gap.fingerprint],
    });
  }
  const scopeHistory = opts.executionScope ? readCurrentScopeProofHistory(projectRoot, feature, opts.executionScope,
    opts.runId, opts.frameworkRoot, opts.workflow) : undefined;
  const proofFreshness = new Map<string, boolean | undefined>();
  const proofIsCurrent = (phase: string): boolean | undefined => {
    if (!scopeHistory?.invalidatedAt.has(phase)) return true;
    if (!proofFreshness.has(phase)) {
      const evidence = loadPhaseEvidenceManifest(projectRoot, feature, phase);
      // Without a former result, the ordinary missing-evidence facts already require the producer.
      proofFreshness.set(phase, evidence ? phaseEvidenceIsCurrent({ fresh: evidence.integrityOk,
        generatedAt: evidence.manifest.generated_at, invalidatedAt: scopeHistory.invalidatedAt.get(phase) }) : true);
    }
    return proofFreshness.get(phase);
  };
  const scopeFindings = opts.scopeFindings ?? (opts.executionScope ? executionScopeEvidenceFindings(projectRoot, feature, opts.executionScope,
    undefined, opts.runId, undefined, opts.frameworkRoot, undefined, opts.authorityReaders, opts.workflow, scopeHistory) : []);
  if (opts.executionScope) {
    for (const finding of scopeFindings) {
      additionalProblems.push({ phase: 'scope', id: 'execution_scope', action: 'verify', affects: 'completion', severity: 'BLOCKER', detail: `${finding.obligation_id}: ${finding.detail}` });
    }
    if (endpoint === 'feature-completion' && opts.executionScope.completion_target !== 'feature') {
      additionalProblems.push({ phase: 'scope', id: 'execution_scope', action: 'verify', affects: 'completion', severity: 'BLOCKER', detail: 'request-only 不能签发 Feature completion' });
    }
  }
  const staleness = chain.length
    ? recomputePhaseEvidenceStaleness(projectRoot, feature, chain, {
        currentRequirementSha: opts.currentRequirementSha,
        frameworkRoot: opts.frameworkRoot,
        runId: opts.runId,
        authorityReaders: opts.authorityReaders,
        pendingOwnerPhase: opts.pendingOwnerPhase,
      }).map(entry => {
        if (!entry.propagated_from) return entry;
        const own = recomputePhaseEvidenceStaleness(projectRoot, feature, [entry.phase], {
          currentRequirementSha: opts.currentRequirementSha, frameworkRoot: opts.frameworkRoot, runId: opts.runId,
          authorityReaders: opts.authorityReaders, pendingOwnerPhase: opts.pendingOwnerPhase,
        })[0];
        return own?.verdict === 'fresh' ? own : entry;
      })
    : [];
  let openDebt = 0;
  try {
    const { loadVisualDebtEx, countBlockingDebt } = require('./visual-debt') as typeof import('./visual-debt');
    const debt = loadVisualDebtEx(projectRoot, feature);
    if (debt.state === 'valid') openDebt = countBlockingDebt(debt.doc).open;
  } catch {
    /* 账本损坏由既有 DEBT_PIPELINE_ERROR 投影处理，不在这里另加重判据 */
  }
  const responsibility = { projectRoot, feature, frameworkRoot: opts.frameworkRoot ?? path.resolve(__dirname, '../../..'),
    runId: opts.runId, workflow: opts.workflow, executionScope: opts.executionScope, authorityReaders: opts.authorityReaders };
  const independent = new Map<string, import('./verifier-evidence').VerifierEvidence | null>();
  const independentEvidence = (phase: string, subject: string): import('./verifier-evidence').VerifierEvidence | null => {
    const key = `${phase}:${subject}`;
    if (independent.has(key)) return independent.get(key)!;
    const verifier = require('./verifier-evidence') as typeof import('./verifier-evidence');
    const resolvedInputs = opts.currentResults?.find(result => result.phase === phase)?.resolvedInputs
      ?? (opts.resolvedInputs?.phase === phase ? opts.resolvedInputs : undefined);
    const options = { frameworkRoot: opts.frameworkRoot, resolvedInputs };
    const loaded = verifier.loadVerifierEvidenceForSubject(projectRoot, feature, phase, subject, options);
    let result = loaded.ok ? loaded.evidence : loaded.code === 'report_missing'
      ? verifier.findSameMaterialVerifierEvidence(projectRoot, feature, phase, subject, options) : null;
    if (result) {
      const material = require('./verifier-material') as typeof import('./verifier-material');
      const view = material.readVerifierMaterialOrNull(featurePhaseReportsDir(projectRoot, feature, phase, opts.frameworkRoot), subject);
      if (!view || view.files.some(file => !material.verifierMaterialFileMatchesCurrent({ projectRoot, feature,
        material: view, file: file.path, authorityReaders: opts.authorityReaders }))) result = null;
    }
    independent.set(key, result);
    return result;
  };
  const runEvents = opts.runId ? loadAuthoritativeRunEvents(projectRoot, feature, opts.runId) : [];
  const predecessor = opts.runId ? loadGoalManifestFromRun(projectRoot, opts.runId, { feature }).successor_of : undefined;
  const ancestorRuns = readSupersededAncestorRuns({ projectRoot, feature, featuresDir: relFeaturesDir(projectRoot),
    seedTargets: predecessor ? [predecessor] : [], currentEvents: runEvents });
  const repairEvents = [...ancestorRuns.flatMap(run => run.events).sort((a, b) => String(a.ts).localeCompare(String(b.ts))), ...runEvents];
  for (const [file, before] of unrestoredAuthorWrites(projectRoot, repairEvents)) {
    additionalProblems.push({ phase: 'scope', id: 'phase_write_violation', action: 'repair', affects: 'completion', severity: 'BLOCKER',
      detail: `先恢复本单元作者自己尚未恢复的越权写入：${file}；pre_sha256=${before ?? 'missing'}` });
  }
  const runtimeIssues = readRuntimeCompletionIssues(opts);
  let effectiveEvents: typeof repairEvents | undefined;
  const handbacks = new Map<string, boolean>();
  const ownerAwaitingSourceVerification = (source: string, owner: string | undefined, object?: { id: string; item_fingerprint?: string }, covered = false): boolean => {
    if (!owner || owner === source || covered && opts.currentResults?.some(result => result.phase === source)) return false;
    const key = `${source}:${owner}:${object?.id ?? ''}:${object?.item_fingerprint ?? ''}:${covered}`;
    if (handbacks.has(key)) return handbacks.get(key)!;
    handbacks.set(key, false);
    if (!effectiveEvents) {
      const revocations = new Map<typeof repairEvents[number], typeof repairEvents>();
      for (const run of [...ancestorRuns, ...(opts.runId ? [{ run_id: opts.runId, events: runEvents }] : [])]) {
        const birth = loadFrozenExecutionScope(projectRoot, feature, run.run_id);
        const workflow = opts.workflow ?? (birth ? (require('../../workflow-loader') as typeof import('../../workflow-loader'))
          .resolveWorkflowSpec(projectRoot, { frameworkRoot: responsibility.frameworkRoot }) : undefined);
        const projected = eventsWithScopeRevocations(birth, run.events, birth && workflow
          ? readRepairDependencyContext(projectRoot, feature, workflow, birth, responsibility.frameworkRoot) : {});
        const originals = new Set(run.events);
        let previous: typeof repairEvents[number] | undefined;
        for (const event of projected) {
          if (originals.has(event)) previous = event;
          else if (previous) revocations.set(previous, [...revocations.get(previous) ?? [], event]);
        }
      }
      // 每个run的修订只验自己的birth；撤销仍插在原事件之后，沿既有血缘物理顺序消费。
      effectiveEvents = repairEvents.flatMap(event => [event, ...revocations.get(event) ?? []]);
    }
    const history = effectiveEvents;
    // 开始/返回一次验证不等于已经重判；本轮原始结果由currentResults消费，既存结论由fresh verdict锚定。
    const acceptsSourceBoundary = !object || covered;
    let sourceAt = acceptsSourceBoundary
      ? history.map(event => event.phase === source && event.type === 'phase_verdict' && event.stale_summary !== true).lastIndexOf(true)
      : history.map(event => event.type === 'phase_backtrack_requested' && event.to_phase === owner && (event.from_phase ?? event.phase) === source
        && 'candidates' in event && Array.isArray(event.candidates) && event.candidates.some((candidate: { id?: unknown; item_fingerprint?: unknown }) => candidate.id === object.id
          && (!object.item_fingerprint || candidate.item_fingerprint === object.item_fingerprint))).lastIndexOf(true);
    const sourceSummary = readSummaryLattice(projectRoot, feature, source);
    const currentSubject = asRecord(sourceSummary.raw)?.verifier_subject_id;
    try {
      const report = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(projectRoot, feature, source, opts.frameworkRoot), 'script-report.json'), 'utf8'));
      const generated = Date.parse(report.timestamp ?? '');
      if (acceptsSourceBoundary && report.phase === source && report.feature === feature && Number.isFinite(generated)) {
        for (const [index, end] of history.entries()) {
          if (end.type !== 'harness_end' || end.phase !== source || end.timed_out || !end.ts) continue;
          const start = [...history.slice(0, index)].reverse().find(event => event.type === 'harness_start' && event.phase === source && event.invoke_id === end.invoke_id);
          if (start?.ts && Date.parse(start.ts) <= generated && generated <= Date.parse(end.ts)) sourceAt = Math.max(sourceAt, index);
        }
      }
    } catch { /* Missing report originals cannot establish a newer source boundary. */ }
    if (acceptsSourceBoundary && typeof currentSubject === 'string') for (const [index, start] of history.entries()) {
      if (start.type !== 'agent_invoke_start' || start.phase !== `${source}-verifier-format-repair` || !start.invoke_id) continue;
      const endAt = history.findIndex((event, at) => at > index && event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id
        && invocationCompleted({ ...event, exitCode: event.exit_code }));
      if (endAt < 0) continue;
      const runId = [...ancestorRuns, ...(opts.runId ? [{ run_id: opts.runId, events: runEvents }] : [])]
        .find(run => run.events.includes(start))?.run_id ?? opts.runId;
      if (!runId) continue;
      try {
        const original = readExecutionRequestOriginal(featureFilePath(projectRoot, feature, `goal-runs/${runId}`), start.invoke_id);
        const delivered = parseVerifierRequestFromInstruction(original?.request.context.instruction);
        if (delivered?.subject_id === currentSubject && delivered.feature === feature && delivered.phase === source) sourceAt = Math.max(sourceAt, endAt);
      } catch { /* A missing original request never borrows another invocation's result. */ }
    }
    if (sourceAt < 0) return false;
    const revokedAt = history.map(event => event.type === 'phase_invalidated' && event.phase === owner
      || event.type === 'phase_backtrack_requested' && (event.to_phase === owner
        || (event as { invalidated_phases?: string[] }).invalidated_phases?.includes(owner))).lastIndexOf(true);
    const boundary = Math.max(sourceAt, revokedAt);
    const window = history.slice(boundary + 1);
    const completed = window.some((event, index) => event.phase === owner
      && ['agent_invoke_end', 'agent_process_settled', 'phase_verdict'].includes(event.type ?? '')
      && repairInvocationCompleted(window.slice(0, index + 1), owner, event.invoke_id));
    if (!completed) return false;
    const current = opts.currentResults?.find(result => result.phase === owner);
    const summary = readSummaryLattice(projectRoot, feature, owner, current?.summary);
    if (summary.verdict !== 'PASS' || runtimeIssues.some(issue => issue.phase === owner)) return false;
    if (current) {
      const raw = summary.raw as { blocking_skips?: Array<{ id?: string; blocking_class?: string }> };
      const direct = resolveCurrentDisposition({ endpoint: 'feature-completion', phases: [{ phase: owner, verdict: summary.verdict,
        schemaCurrent: SUMMARY_ASSURANCE_SCHEMA_VERSIONS.has(String(summary.schemaVersion)), summaryErrors: validateSummaryV11(summary.raw),
        closureCommitted: true, axes: summary.axes ?? {}, releaseReadiness: summary.releaseReadiness, completionStatus: summary.completionStatus,
        requiredGaps: [...requiredSummaryCheckGaps(raw), ...current.checks.filter(check => isRequiredCheckGap(check))],
        failingChecks: current.checks.filter(check => check.status === 'FAIL') }] });
      if (direct.completionBlocking.length) return false;
      const subject = (summary.raw as { verifier_subject_id?: string }).verifier_subject_id;
      if (subject) {
        const verifier = require('./verifier-evidence') as typeof import('./verifier-evidence');
        const evidence = verifier.loadVerifierEvidenceForSubject(projectRoot, feature, owner, subject, { frameworkRoot: opts.frameworkRoot });
        if ((!evidence.ok || evidence.evidence.verdict !== 'PASS')
          && !verifier.deriveVerifierClosureRecord(projectRoot, feature, owner, opts.frameworkRoot)) return false;
      }
    } else {
      const passAt = history.map(event => event.phase === owner && isEffectivePhasePass(event)).lastIndexOf(true);
      if (passAt <= boundary || !summary.closureCommitted) return false;
      const fresh = recomputePhaseEvidenceStaleness(projectRoot, feature, [owner], { frameworkRoot: opts.frameworkRoot,
        runId: opts.runId, authorityReaders: opts.authorityReaders })[0];
      if (fresh?.verdict !== 'fresh') return false;
    }
    handbacks.set(key, true);
    return true;
  };
  // 来源阶段与修改责任不是同一维度。先读全部适用来源，再按当前终点选择其责任事实。
  const sources = [...new Set([...chain, ...(opts.executionScope ? executionCompletionPhases(opts.executionScope) : []),
    ...(opts.workflow?.artifacts.map(artifact => artifact.id) ?? [])])];
  const isExecutionKey = (require('./verifier-material') as typeof import('./verifier-material')).currentAcceptanceExecutionKeyMatcher(opts);
  let currentAcceptanceEvidence: import('./types').ContextFileEntry[] | undefined;
  const findings = sources.flatMap(source => {
    const current = opts.currentResults?.find(result => result.phase === source);
    const summary = readSummaryLattice(projectRoot, feature, source, current?.summary);
    const subject = (summary.raw as { verifier_subject_id?: string } | null)?.verifier_subject_id ?? null;
    const lateCandidates = subject && independentEvidence(source, subject)
      ? (require('./phase-closure-finalizer') as typeof import('./phase-closure-finalizer')).readCurrentPhaseRepairCandidates({
        projectRoot, frameworkRoot: responsibility.frameworkRoot, feature, phase: source, goalRunId: opts.runId,
        resolvedInputs: current?.resolvedInputs ?? opts.resolvedInputs, authorityReaders: opts.authorityReaders,
        executionScope: opts.executionScope, workflow: opts.workflow,
      }, featurePhaseReportsDir(projectRoot, feature, source, opts.frameworkRoot),
      (summary.raw ?? {}) as Parameters<typeof import('./phase-closure-finalizer').readCurrentPhaseRepairCandidates>[2]) : undefined;
    const registered = readRegisteredFindings(lateCandidates === undefined ? summary.raw
      : { ...asRecord(summary.raw), repair_candidates: lateCandidates }, { ...responsibility, currentPhase: source });
    if (!current && lateCandidates === undefined && readReusableCheckResult({ projectRoot, frameworkRoot: opts.frameworkRoot,
      feature, phase: source, runId: opts.runId, currentRequirementSha: opts.currentRequirementSha, authorityReaders: opts.authorityReaders }) === null) {
      for (const finding of registered) { finding.owner = source; finding.verificationRequired = true; }
    }
    const currentCollected = new Set<typeof registered[number]>();
    if (source === 'testing' && actionableEvidence?.defects.length) {
      const candidates = (require('./repair-candidates') as typeof import('./repair-candidates'))
        .actionableDefectsToCandidates(actionableEvidence.defects, source, responsibility);
      const collected = readRegisteredFindings({ repair_candidates: candidates }, { ...responsibility, currentPhase: source });
      for (const finding of collected) currentCollected.add(finding);
      registered.push(...collected);
    }
    let phaseIssues = current?.phaseIssues;
    if (source === 'spec' || source === 'plan') {
      if (phaseIssues === undefined) phaseIssues = (require('./repair-candidates') as typeof import('./repair-candidates'))
        .readPhaseRepairIssues(projectRoot, feature, source, { subjectId: subject, frameworkRoot: opts.frameworkRoot, runId: opts.runId });
      const { collectCurrentAcceptanceEvidence, readVerifierMaterialOrNull, verifierMaterialFileMatchesCurrent } = require('./verifier-material') as typeof import('./verifier-material');
      const evidence = current?.acceptanceEvidence ?? (currentAcceptanceEvidence ??= collectCurrentAcceptanceEvidence({ ...opts, phase: source, subjectId: subject, phaseIssues }));
      const reviewed = subject ? readVerifierMaterialOrNull(featurePhaseReportsDir(projectRoot, feature, source, opts.frameworkRoot), subject) : null;
      if (evidence.filter(file => !file.label.startsWith('(')).some(file => !reviewed || !verifierMaterialFileMatchesCurrent({
        projectRoot, feature, material: reviewed, file: file.label, authorityReaders: opts.authorityReaders }))) {
        // Current counterevidence needs the original verifier; locating it never refutes a finding by itself.
        if (!registered.length && reviewed?.files.some(file => isExecutionKey(file.path))) {
          const { parseIssueVerificationBlock } = require('./repair-candidates') as typeof import('./repair-candidates');
          const { loadVerifierReportTextOrNull } = require('./verifier-evidence') as typeof import('./verifier-evidence');
          const text = loadVerifierReportTextOrNull(projectRoot, feature, source, { frameworkRoot: opts.frameworkRoot, subjectId: subject });
          for (const entry of parseIssueVerificationBlock(text ?? '').entries) if (entry.evidence) registered.push({
            id: entry.issue, detail: `原核实的验收证据已变化或失效，须重核：${entry.evidence}`, owner: source, verificationRequired: true,
          });
        }
        for (const finding of registered) { finding.owner = source; finding.verificationRequired = true; }
      }
    }
    const sourceChecks = current?.checks ?? readPhaseChecks(projectRoot, feature, source, summary.raw);
    for (const finding of registered) {
      if (ownerAwaitingSourceVerification(source, finding.owner, finding, currentFindingEvidence(projectRoot, source, finding, sourceChecks).length > 0)) {
        // 修改职责已交回，缺陷仍开放；下一步是原验证方复核，不是再给同一修改方派一轮。
        finding.owner = source; finding.verificationRequired = true;
      }
    }
    if (registered.length && !current && !(subject && independentEvidence(source, subject))) {
      const freshness = recomputePhaseEvidenceStaleness(projectRoot, feature, [source], {
        frameworkRoot: opts.frameworkRoot, runId: opts.runId, authorityReaders: opts.authorityReaders, pendingOwnerPhase: opts.pendingOwnerPhase,
      })[0];
      const runtimeArtifact = createRuntimeArtifactPredicate({ projectRoot, feature, phase: source, frameworkRoot: opts.frameworkRoot });
      const onlyRuntimeChanged = freshness?.verdict === 'stale' && !freshness.propagated_from
        && freshness.changed_paths.length > 0 && freshness.changed_paths.every(runtimeArtifact);
      // 修改对象已变化时先交原验证方核实；旧候选不能绕过复验反复派同一修改方。
      if (freshness?.verdict === 'stale' && !onlyRuntimeChanged || freshness?.verdict === 'tampered') for (const finding of registered.filter(finding => !currentCollected.has(finding))) {
        finding.owner = source;
        finding.verificationRequired = true;
      }
    }
    const diagnostics = readDiagnosticFindings(projectRoot, feature, source, opts.frameworkRoot, subject, opts.runId, phaseIssues)
      .filter(finding => !registered.some(row => row.id === finding.id || row.id === `${source}:${finding.id}`))
      .map(finding => ({ ...finding, owner: source, verificationRequired: true }));
    if (subject) {
      const verifier = require('./verifier-evidence') as typeof import('./verifier-evidence');
      const material = require('./verifier-material') as typeof import('./verifier-material');
      const evidenceOptions = { frameworkRoot: opts.frameworkRoot, resolvedInputs: current?.resolvedInputs ?? opts.resolvedInputs };
      const same = independentEvidence(source, subject);
      if (!same) {
        const previous = verifier.findPriorVerifierEvidence(projectRoot, feature, source, { ...evidenceOptions, excludeSubject: subject });
        if (previous) {
          const reports = featurePhaseReportsDir(projectRoot, feature, source, opts.frameworkRoot);
          const oldMaterial = material.readVerifierMaterialOrNull(reports, previous.subject_id);
          const nowMaterial = material.readVerifierMaterialOrNull(reports, subject);
          if (!nowMaterial || material.diffVerifierMaterial(oldMaterial, nowMaterial).length) {
            const repairs = require('./repair-candidates') as typeof import('./repair-candidates');
            const oldIssues = repairs.readPhaseRepairIssues(projectRoot, feature, source,
              { subjectId: previous.subject_id, frameworkRoot: opts.frameworkRoot, runId: opts.runId });
            const original = new Map<string, string>((oldIssues?.rows ?? []).map(row => [row.id, row.summary]));
            for (const entry of repairs.parseIssueVerificationBlock(previous.report_text).entries) original.set(entry.issue,
              `原独立结论=${entry.verdict}；原依据=${entry.evidence ?? ''}`);
            for (const [id, detail] of original) diagnostics.push({ id, detail: `原公开结论尚未核对当前实际变化：${detail}`,
              owner: source, verificationRequired: true });
          }
        }
      }
    }
    const currentVerification = subject ? independentEvidence(source, subject) : null;
    const responses = currentVerification
      ? (require('./repair-candidates') as typeof import('./repair-candidates')).parseIssueVerificationBlock(currentVerification.report_text).entries : [];
    return uniqueFindingObjects([...registered, ...diagnostics]).map(finding => {
      const response = responses.find(entry => entry.issue === finding.id && !entry.invalid_reason && entry.evidence?.trim());
      return { ...finding, source_phase: source, ...(response ? { detail: `${finding.detail}；当前独立核验=${response.verdict}；依据原文：${response.evidence}` } : {}) };
    });
  });
  const phaseNames = [...new Set([...chain, ...applicableCheckFamilies(opts.executionScope)])].filter(phase => {
    if (opts.currentResults?.some(result => result.phase === phase)) return true;
    if (findings.some(finding => finding.source_phase === phase)) return true;
    const observed = readSummaryLattice(projectRoot, feature, phase);
    if (observed.exists && proofIsCurrent(phase) !== true) return true;
    if (observed.exists && opts.runId && asRecord(observed.raw)?.run_id === opts.runId) {
      let lineage = staleness.find(entry => entry.phase === phase);
      if (!lineage) {
        lineage = recomputePhaseEvidenceStaleness(projectRoot, feature, [phase], {
          currentRequirementSha: opts.currentRequirementSha, frameworkRoot: opts.frameworkRoot, runId: opts.runId,
          authorityReaders: opts.authorityReaders, pendingOwnerPhase: opts.pendingOwnerPhase,
        })[0];
        if (lineage) staleness.push(lineage);
      }
      if (lineage?.verdict === 'stale' && lineage.changed_paths.length) return true;
    }
    if (observed.exists && (observed.verdict !== 'PASS' || observed.releaseReadiness === 'BLOCKED'
      || requiredSummaryCheckGaps(observed.raw as Parameters<typeof requiredSummaryCheckGaps>[0]).length || readPhaseChecks(projectRoot, feature, phase, observed.raw)
        .some(check => check.status === 'FAIL' || isRequiredCheckGap(check)))) return true;
    const duties = opts.executionScope?.obligations.filter(item => item.owner_phase === phase && item.applicability !== 'not_applicable');
    // Canonical definition bindings are the actual fulfilled duty, not an instruction to run an empty phase.
    return !duties?.length || !duties.every(item => item.applicability === 'required' && acceptsDefinitionInputProof(item.kind)
      && item.satisfied_by?.length
      && item.satisfied_by.every(ref => 'input_id' in ref)
      && !scopeFindings.some(finding => finding.obligation_id === item.id));
  });
  let minimumAssurance = opts.minimumAssurance;
  if (!minimumAssurance && opts.runId) {
    try { minimumAssurance = loadGoalManifestFromRun(projectRoot, opts.runId, { feature }).minimum_assurance; }
    catch { /* The common identity reader retains corrupt or missing run facts. */ }
  }
  const phases = phaseNames.map(phase => {
    const proofCurrent = proofIsCurrent(phase);
    const current = proofCurrent === false ? undefined : opts.currentResults?.find(result => result.phase === phase);
    const s = readSummaryLattice(projectRoot, feature, phase, current?.summary);
    // 链式传播只是上游缺口的提示，不是本阶段证据已经失效；直接绑定仍由原reader逐项核实。
    const observedLineage = staleness.find(row => row.phase === phase) ?? recomputePhaseEvidenceStaleness(projectRoot, feature, [phase], {
      currentRequirementSha: opts.currentRequirementSha, frameworkRoot: opts.frameworkRoot, runId: opts.runId,
      authorityReaders: opts.authorityReaders, pendingOwnerPhase: opts.pendingOwnerPhase,
    })[0];
    const lineage = observedLineage?.propagated_from ? recomputePhaseEvidenceStaleness(projectRoot, feature, [phase], {
      currentRequirementSha: opts.currentRequirementSha, frameworkRoot: opts.frameworkRoot, runId: opts.runId,
      authorityReaders: opts.authorityReaders, pendingOwnerPhase: opts.pendingOwnerPhase,
    })[0] : observedLineage;
    const schemaCurrent = SUMMARY_ASSURANCE_SCHEMA_VERSIONS.has(String(s.schemaVersion));
    const raw = (s.raw ?? {}) as { blocking_skips?: Array<{ id?: string; blocking_class?: string }> };
    const subject = (s.raw as { verifier_subject_id?: string } | null)?.verifier_subject_id;
    const verified = subject ? independentEvidence(phase, subject) : null;
    const report = readQualifiedPhaseReport(projectRoot, feature, phase, s.raw);
    const phaseChecks = (current?.checks ?? report?.checks ?? []).map(check => {
      const evidence = typeof check.id === 'string' ? nativeCompileDiagnosticRefs(check, projectRoot) : undefined;
      if (evidence !== undefined) check = { ...check, evidence };
      if (check.id === 'coding_existing_test_preserved' && check.affected_files?.length) {
        const { testStrengthVerification } = require('./repair-candidates') as typeof import('./repair-candidates');
        const verification = testStrengthVerification({ check, verifierReportText: verified?.report_text ?? null,
          verifierSubjectCurrent: !!verified });
        return { ...check, verification: verification ?? undefined,
          verificationRequired: !verification || verification.verdict === 'unclear' };
      }
      if (check.status !== 'FAIL') return check;
      const structured = asRecord(check.structured);
      const designAuthority = check.repair_owner === 'external' && structured?.kind === 'design_authority';
      const repair = resolveRepairResponsibility({ ...responsibility, currentPhase: phase,
        target: { files: check.affected_files, owner: check.repair_owner, designAuthority } });
      if (repair.action === 'design') {
        const dependencies = Array.isArray(structured?.source_attempt_dependencies) ? structured.source_attempt_dependencies : [];
        const sources = dependencies.flatMap(dependency => { const file = asRecord(dependency)?.path; return typeof file === 'string' ? [file] : []; });
        const suggestion = asRecord(check)?.suggestion;
        return { ...check, repair_owner: repair.owner ?? check.repair_owner,
          details: [check.details, typeof structured?.reason === 'string' ? `design authority: ${structured.reason}` : undefined,
            Array.isArray(structured?.codes) ? structured.codes.filter((code): code is string => typeof code === 'string').join(', ') : undefined,
            typeof suggestion === 'string' ? suggestion : undefined].filter(Boolean).join('\n'),
          evidence: [...new Set([...check.evidence ?? [], ...sources])] };
      }
      let owner = repair.owner ?? check.repair_owner;
      if (owner && owner !== phase && repair.category) {
        const candidates = (s.raw as { repair_candidates?: import('./repair-candidates').RepairCandidate[] } | null)?.repair_candidates ?? [];
        const delegated = candidates.some(candidate => resolveRepairResponsibility({ ...responsibility, currentPhase: phase,
          target: candidate }).owner === owner
          && (candidate.id === check.id || check.affected_files?.some(file => candidate.files.some(candidateFile =>
            path.resolve(projectRoot, file) === path.resolve(projectRoot, candidateFile)))));
        // 责任披露不是跨阶段派修资格；沿既有候选生产者决定能否交给该修改方。
        if (!delegated) owner = phase;
      }
      return ownerAwaitingSourceVerification(phase, owner, undefined, !!current)
        ? { ...check, repair_owner: phase, verificationRequired: true } : owner ? { ...check, repair_owner: owner } : check;
    });
    const blockedCapabilities = (require('./capability-resolution') as typeof import('./capability-resolution'))
      .collectBlockedCapabilityFacts({ capabilities: report?.capabilities ?? [] });
    for (const capability of blockedCapabilities) {
      const attempts = capability.unresolved.map(input => `input=${input.input}; source=${input.source}${input.detail ? `; ${input.detail}` : ''}`);
      const evidence = [...capability.applicability_dependencies, ...capability.unresolved.flatMap(input => input.dependencies)].map(dependency => dependency.path);
      additionalProblems.push({ phase, id: capability.capability, action: 'verify', affects: 'completion', severity: 'BLOCKER', owner: phase,
        detail: `当前能力输入尚未就绪：${capability.capability}；${attempts.length ? attempts.join('；') : `applicability=${capability.applicability_provider ?? 'unknown'}`}。补齐原来源后仅重验受影响工具，不能以旧报告或调用次数签通过。`,
        ...(evidence.length ? { evidence: [...new Set(evidence)] } : {}) });
    }
    const openFindings = findings.filter(finding => finding.source_phase === phase && !phaseChecks.some(check => check.id === finding.id
      && !!(check.structured as { authoritative_content_drift?: unknown } | undefined)?.authoritative_content_drift)).map(finding => {
        const diagnostic = currentFindingEvidence(projectRoot, phase, finding, phaseChecks);
        return diagnostic?.length ? { ...finding, evidence: [...new Set([...finding.evidence ?? [], ...diagnostic])] } : finding;
      });
    const axes: Record<string, CurrentDispositionAxisFact> = structuredClone(s.axes ?? {});
    if (!current) for (const axis of Object.values(axes)) {
      const owner = axis.resolution?.retry_phase;
      if (!axis.source_checks?.some(check => check.startsWith('stale_inheritance:')) || !ownerAwaitingSourceVerification(phase, owner)) continue;
      // 只交回原检查，不关闭旧发现；本次当前检查再次发现失败时仍回真实修改方。
      axis.verificationRequired = true;
      axis.resolution = { ...axis.resolution, owner: phase, retry_phase: phase };
    }
    const latestPhaseFact = [...runEvents].reverse().find(event => event.phase === phase
      && ['phase_halt', 'phase_verdict', 'agent_invoke_start', 'device_ready'].includes(event.type ?? '')) as
      (Record<string, unknown> | undefined);
    if (!current && latestPhaseFact?.type === 'phase_halt' && latestPhaseFact.run_disposition === 'WAITING'
      && latestPhaseFact.run_wait_kind === 'external' && typeof latestPhaseFact.probe === 'string') {
      // invoke前的原设备/能力门还未产summary；现有权威等待事实不能被“缺summary”改成作者返修。
      return { phase, summaryPresent: false, verdict: 'INCOMPLETE', schemaCurrent: false, closureCommitted: false,
        requiredGaps: [{ id: latestPhaseFact.probe, blocking_class: 'externalBlocked' }], failingChecks: [], axes: {},
        lineage: null, attestationPresent: null, openFindings, ...(phase === 'testing' ? { openDebt } : {}) };
    }
    if (current && !phaseChecks.length) additionalProblems.push({ phase, id: 'required_check_conclusion', action: 'verify', affects: 'completion', severity: 'BLOCKER',
      detail: `检查族 ${phase} 尚无当前可绑定的真实检查结果` });
    if (!current && s.exists && !schemaCurrent) additionalProblems.push({ phase, id: 'summary_schema_current', action: 'verify', affects: 'completion', severity: 'BLOCKER',
      detail: `历史结果 schema=${s.schemaVersion ?? '缺失'} 尚无当前可用的质量依据` });
    if (subject) {
      const summary = asRecord(s.raw);
      const report = typeof summary?.verifier_report === 'string' ? summary.verifier_report : undefined;
      const signals = summary?.readiness_signals;
      const diagnosisRequired = Array.isArray(signals) && signals.some(signal =>
        asRecord(signal)?.id === 'verifier_repair_diagnosis' && asRecord(signal)?.status === 'incomplete');
      const repairs = require('./repair-candidates') as typeof import('./repair-candidates');
      // The writer owns applicability; a newly arrived reply satisfies the same body validator without another tool run.
      const unreadable = verified && diagnosisRequired ? repairs.findUnreadableDiagnosisChecks(phase, verified.report_text,
        repairs.buildCurrentVerifierDiagnosisContext({ projectRoot, feature, phase, frameworkRoot: opts.frameworkRoot,
          runId: opts.runId, subjectId: subject, phaseIssues: current?.phaseIssues })) : [];
      if (unreadable.length) {
        additionalProblems.push({ phase, id: 'attestation_present', action: 'verify',
          affects: 'completion', severity: 'BLOCKER', owner: phase, ...(report ? { files: [report] } : {}),
          detail: `当前独立核验正文仍待补核：${unreadable.join('；')}；subject=${subject}` });
        const pendingDiagnosis = phaseChecks.map(check => check.id === 'negative_verdict_closure' && check.status === 'FAIL'
          ? { ...check, verificationRequired: true } : check);
        const knownRepair = resolveCurrentDisposition({ endpoint, phases: [{ phase, verdict: s.verdict, schemaCurrent,
          closureCommitted: s.closureCommitted, checks: pendingDiagnosis, openFindings }] }).completionBlocking.some(problem => problem.action === 'repair');
        if (!knownRepair) phaseChecks.splice(0, phaseChecks.length, ...pendingDiagnosis);
      }
      else if (!verified || verified.verdict !== 'PASS') additionalProblems.push({ phase, id: 'attestation_present',
        action: verified ? 'repair' : 'verify', affects: 'completion', severity: 'BLOCKER', owner: phase,
        ...(report ? { files: [report] } : {}),
        detail: verified ? `当前独立核验仍否定：${verified.md_path_rel}` : `当前独立核验结果待补：${subject}` });
    }
    const requiredAssurance = minimumAssurance?.[phase];
    const actualAssurance = asRecord(s.raw)?.assurance;
    if (requiredAssurance && !assuranceSatisfies(String(actualAssurance ?? 'not_applicable') as Assurance, requiredAssurance)) {
      additionalProblems.push({ phase, id: 'insufficient_assurance', action: 'verify', affects: 'completion', severity: 'BLOCKER', owner: phase,
        detail: `actual=${actualAssurance ?? 'unknown'}, required=${requiredAssurance}；补齐当前质量证据后重验，不按调用次数停止。` });
    }
    if (proofCurrent === undefined) additionalProblems.push({ phase, id: 'execution_scope', action: 'verify', affects: 'completion',
      severity: 'BLOCKER', owner: phase, detail: '当前修后证明的生成时间或原失效时间不可核实；保留原件，恢复该绑定后再验。' });
    return {
      phase,
      summaryPresent: s.exists,
      verdict: s.verdict,
      schemaCurrent,
      summaryErrors: schemaCurrent ? validateSummaryV11(asRecord(s.raw)?.closure_status === undefined
        ? { ...asRecord(s.raw), closure_status: 'open' } : s.raw) : [],
      closureCommitted: s.closureCommitted,
      requiredGaps: s.exists ? [...requiredSummaryCheckGaps(raw),
        ...phaseChecks.filter(check => isRequiredCheckGap(check))] : [],
      failingChecks: phaseChecks.filter(check => check.status === 'FAIL'),
      checks: phaseChecks,
      axes,
      releaseReadiness: s.releaseReadiness,
      completionStatus: s.completionStatus,
      lineage: proofCurrent === false ? 'stale' : current ? null : lineage ? lineage.verdict : null,
      ...(proofCurrent === false ? { lineageDetail: `当前证据早于最近一次要求重验：${scopeHistory?.invalidatedAt.get(phase) ?? 'unknown'}` } : lineage && lineage.changed_paths.length
        ? { lineageDetail: lineage.changed_paths.join(', ') + (lineage.propagated_from ? `（传染自 ${lineage.propagated_from}）` : '') }
        : {}),
      ...(lineage?.propagated_from ? { lineagePropagatedFrom: lineage.propagated_from } : {}),
      attestationPresent: chain.includes('review') && phase === 'review' ? !!loadReviewClosureAttestation(projectRoot, feature) : null,
      ...(phase === 'testing' ? { openDebt } : {}),
      openFindings,
    };
  });
  const corruptRuns = classifyGoalRunsDir(featureFilePath(projectRoot, feature, 'goal-runs')).corruptRuns
    .map(run => ({ runId: run.runId, reason: run.reason }));
  return {
    endpoint,
    phases,
    additionalProblems: [...additionalProblems, ...findings.filter(finding => !phaseNames.includes(finding.source_phase)).map(finding => ({
      phase: finding.source_phase, id: `open_finding:${finding.id}`, action: finding.verificationRequired ? 'verify' as const : 'repair' as const,
      ...('item_fingerprint' in finding && typeof finding.item_fingerprint === 'string' ? { item_fingerprint: finding.item_fingerprint } : {}),
      affects: 'completion' as const, severity: 'BLOCKER' as const, detail: finding.detail, owner: finding.owner, source_phase: finding.source_phase,
      ...('files' in finding && finding.files?.length ? { files: finding.files } : {}),
      ...('evidence' in finding && finding.evidence?.length ? { evidence: finding.evidence } : {}),
    })), ...runtimeIssues.map(issue => ({ phase: issue.phase, id: issue.condition, detail: issue.detail,
      action: issue.action ?? 'verify' as const, affects: 'completion' as const, severity: 'BLOCKER' as const, owner: issue.owner ?? issue.phase }))],
    ...(opts.fidelityCapped ? { fidelityCapped: true } : {}),
    ...(corruptRuns.length ? { corruptRuns } : {}),
  };
}

/** 同一次评估的处置（纯判定）：完成/发布/披露都从这个结果投影。 */
export function resolveCompletionDisposition(opts: CleanPassOptions): CurrentDisposition {
  try { return resolveCurrentDisposition(readCurrentDispositionInput(opts)); }
  catch (error) {
    const phases: CurrentDispositionInput['phases'] = (opts.currentResults ?? []).map(result => {
      const raw = asRecord(result.summary);
      return { phase: result.phase, summaryPresent: !!raw, verdict: typeof raw?.verdict === 'string' ? raw.verdict : null,
        schemaCurrent: SUMMARY_ASSURANCE_SCHEMA_VERSIONS.has(String(raw?.schema_version)), closureCommitted: false,
        checks: result.checks, failingChecks: result.checks.filter(check => check.status === 'FAIL'),
        axes: asRecord(raw?.quality_axes) as CurrentDispositionPhaseFact['axes'] };
    });
    return resolveCurrentDisposition({ endpoint: opts.endpoint ?? 'feature-completion', phases, additionalProblems: [{
      phase: '*', id: 'required_check_conclusion', action: 'verify', affects: 'completion', severity: 'BLOCKER', owner: 'framework',
      detail: `当前完成事实无法读取，保留未知；恢复所指原件或输入后重验：${String(error)}`,
    }] });
  }
}

/**
 * 普通完成只消费**阻断完成**的当前问题；披露项不进这里——否则会把可披露残差重新变成必修，
 * 让 run 收在 PARTIAL。发布资格继续由 summary 的 release_readiness/轴投影表达（仍 BLOCKED）。
 */
export function collectPhaseCompletionIssues(opts: CleanPassOptions): CleanPassIssue[] {
  return phaseCompletionProblems(resolveCompletionDisposition(opts), opts.chain).map(completionIssue);
}

function completionIssue(problem: import('./check-disposition').CurrentDispositionProblem): CleanPassIssue {
  return {
    phase: problem.phase,
    condition: problem.id,
    detail: problem.detail,
    kind: 'needs_fix' as const,
    ...(problem.owner ? { owner: problem.owner } : {}),
    action: problem.action,
    ...(problem.source_phase ? { source_phase: problem.source_phase } : {}),
    ...(problem.propagated_from ? { propagated_from: problem.propagated_from } : {}),
  };
}

/** 披露项：普通完成不阻断、发布仍 BLOCKED（展示/报告消费；不伪造 PASS，也不得进 classify）。 */
export interface CompletionDisclosure {
  phase: string;
  condition: string;
  detail: string;
}

export function collectDisclosedCompletionIssues(opts: CleanPassOptions): CompletionDisclosure[] {
  return resolveCompletionDisposition(opts).releaseBlocking.map(problem => ({
    phase: problem.phase,
    condition: problem.id,
    detail: problem.detail,
  }));
}

export function runtimeFidelityEvidenceIssue(
  projectRoot: string,
  feature: string,
  expectedGoalRunId: string | null,
  expectedAttemptId: string | null,
  requirePhaseManifestBinding = true,
): string | null {
  const evidencePath = deviceTestEvidencePath(
    path.join(receiptDirPath(projectRoot, feature, 'testing'), 'reports'),
  );
  let doc: DeviceTestEvidenceDoc;
  try {
    doc = JSON.parse(fs.readFileSync(evidencePath, 'utf-8')) as DeviceTestEvidenceDoc;
  } catch (error) {
    return `device-test-evidence.json 缺失或不可解析：${(error as Error).message}`;
  }
  // 身份：run/attempt 由 resolvePhaseRunIds 重算，doc 自报值须相等（文案沿用 legacy 两条）。
  if (expectedGoalRunId && doc.goal_run_id !== expectedGoalRunId) {
    return `runtime evidence goal_run_id 不匹配（${doc.goal_run_id} vs ${expectedGoalRunId}）`;
  }
  if (expectedAttemptId && doc.attempt_id !== expectedAttemptId) {
    return `runtime evidence attempt_id 不匹配（${doc.attempt_id} vs ${expectedAttemptId}）`;
  }
  // plan a3f7c1d9 D2：按 trace 协议三态分派（runtime-step-evidence spec：native 是唯一裁决源）。
  // native 分支只确认"是 v1、身份对、artifact_binding 在、manifest 冻结未改"——schema/binding/
  // HAP 已由 testing 门禁闭环时验过并被 manifest 冻结、⑤ lineage_fresh 保证未改，完成侧不重算
  // （同一批事实只裁决一次）。
  // plan b2d7f4e9 t4：trace_path 按写入时工程根记成绝对路径；换根加载按同一文档推出的旧根重定位（只读侧）。
  if (typeof doc.trace_path === 'string') doc = { ...doc, trace_path: resolveDependencyPath(projectRoot, doc.trace_path, inferLegacyProjectRoot(projectRoot, doc)) };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(doc.trace_path, 'utf-8'));
  } catch (error) {
    return `trace 不可读：${(error as Error).message}`;
  }
  const dispatch = dispatchHylyreResult(raw);
  switch (dispatch.kind) {
    case 'v1':
      if (!doc.artifact_binding) return 'native trace 在场但缺 artifact_binding';
      return requirePhaseManifestBinding ? phaseManifestBindsRuntimeArtifacts(projectRoot, feature, doc) : null;
    case 'legacy_unsupported':
      // 过渡：legacy trace 只在 doc 带 runtime_fidelity 时走原 legacy 校验（逐字不变）。
      if (!doc.runtime_fidelity) return '既无 native v1 trace 也无 legacy runtime_fidelity';
      return validateRuntimeFidelityEvidenceDocument({
        projectRoot,
        feature,
        doc,
        expectedGoalRunId,
        expectedAttemptId,
        requirePhaseManifestBinding,
      });
    default:
      // 不可判别/混装：即使 doc 带 runtime_fidelity 也不回落 legacy（产出方自身不自洽）。
      return `trace 协议不可判别/混装：${dispatch.detail}`;
  }
}

/** legacy needs_human 仍可被读取；当前 collectCleanPassIssues 不再生成它。 */
export function classifyCleanPassIssues(issues: CleanPassIssue[]): {
  needsHuman: boolean;
  needsFix: boolean;
} {
  return {
    needsHuman: issues.some((i) => i.kind === 'needs_human'),
    needsFix: issues.some((i) => i.kind === 'needs_fix'),
  };
}

/**
 * Legacy compatibility helper：旧 needs_human 记录仍可读；当前 writer 已不再生成该类，
 * completion 会从当前机器证据重投影为 needs_fix / capability defer / advisory。
 */
export function hasPendingHumanReview(opts: CleanPassOptions): boolean {
  return classifyCleanPassIssues(collectCleanPassIssues(opts)).needsHuman;
}

// ----------------------------------------------------------------------------
// 生成（runner-owned）
// ----------------------------------------------------------------------------

export interface GenerateCompletionOptions extends Omit<CleanPassOptions, 'runId'> {
  workflowTrack: string;
  /** D1：feature 载体（无 run）传 null。 */
  runId: string | null;
  /** 原件目录绝对路径：run 载体 = `goal-runs/<run_id>`；feature 载体 = `<feature>/completion/`。 */
  runDirAbs: string;
  phaseRunIds: Record<string, string>;
  /** per-phase attempt 身份（events 回放序数）；缺省 null */
  phaseAttempts?: Record<string, string>;
  parentRunId?: string | null;
  supersedes?: string[];
  now?: () => Date;
}

/** 需求 SSOT 聚合哈希（内联 manifest.requirement + 解引用文档 + ux-reference 的稳定摘要） */
export function computeRequirementSsotAggregate(projectRoot: string, feature: string, runId?: string, frameworkRoot?: string): string | null {
  const scope = runId ? loadEffectiveExecutionScope(projectRoot, feature, runId) : undefined;
  if (scope) {
    const { readBoundInput } = require('./capability-resolution') as typeof import('./capability-resolution');
    const { inferRepoLayout } = require('../../repo-layout') as typeof import('../../repo-layout');
    const fwRoot = frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot;
    const legacyRoot = inferLegacyProjectRoot(projectRoot, scope);
    const contents = scope.obligations.flatMap(obligation => obligation.basis
      .filter(binding => binding.source.kind === 'artifact' || ['derive.blueprint-acceptance', 'derive.blueprint-contracts'].includes(binding.source.provider_id))
      .map(binding => ({ input_id: binding.input_id, source: binding.source, value: readBoundInput({ projectRoot, frameworkRoot: fwRoot, feature, phase: obligation.owner_phase, track: 'full' }, binding, legacyRoot) })));
    return executionScopeFingerprint({ requirement: computeRunRequirementSha(projectRoot, feature, runId, relFeaturesDir(projectRoot)), contents });
  }
  const featuresDir = relFeaturesDir(projectRoot);
  const source = resolveCurrentRequirementSource(projectRoot, feature, featuresDir, runId);
  const requirement = source?.kind === 'run' ? source.requirement : source?.text;
  const paths = collectRequirementSsotPaths(projectRoot, feature, featuresDir, { runId });
  if (paths.length === 0 && requirement === undefined) return null;
  const parts: string[] = [];
  if (requirement !== undefined) parts.push('requirement:' + computeRequirementShaFromText(projectRoot, feature, requirement, featuresDir));
  for (const rel of paths) {
    const h = sha256File(path.join(projectRoot, rel));
    parts.push(rel + ':' + (h === null ? 'missing' : h));
  }
  parts.sort();
  return crypto.createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex');
}

/**
 * 「现在可以生成完成凭证了吗」的**唯一判据**——goal runtime 与无 run 出口共用，判据零复制。
 *
 *  · 有范围时：`completion_target === 'feature'` 且 `unresolved` 为空（范围本身还没交代完，
 *    谈不上完成）；无范围（legacy run）沿用旧语义，只看 clean-pass；
 *  · 完整完成链的每个阶段都过既有 `collectCleanPassIssues`（血缘 fresh / attestation /
 *    must-review / waiver / verdict / 运行时证据，含「完成链与冻结范围失配」那一条）。
 *
 * 记录中的 phase_chain 保持原样；完成只消费当前有效证明投影，不用历史队列推断完成。
 */
export function shouldGenerateFeatureCompletion(
  scope: ExecutionScope | undefined,
  opts: CleanPassOptions,
): { eligible: boolean; issues: CleanPassIssue[] } {
  if (scope && (scope.completion_target !== 'feature' || scope.unresolved.length > 0)) return { eligible: false, issues: [] };
  const issues = collectCleanPassIssues({ ...opts, executionScope: scope });
  if (scope && !issues.length) {
    const { resolveCurrentScopeView } = require('./feature-track') as typeof import('./feature-track');
    const { resolveWorkflowSpec, workflowForExistingRun } = require('../../workflow-loader') as typeof import('../../workflow-loader');
    const { resolveProbeFrameworkRoot } = require('../../repo-layout') as typeof import('../../repo-layout');
    const frameworkRoot = opts.frameworkRoot ?? resolveProbeFrameworkRoot(opts.projectRoot, path.resolve(__dirname, '../..'));
    let workflow = opts.workflow ?? resolveWorkflowSpec(opts.projectRoot, { frameworkRoot });
    if (!opts.workflow && opts.runId) workflow = workflowForExistingRun(workflow, loadGoalManifestFromRun(opts.projectRoot, opts.runId, { feature: opts.feature }), frameworkRoot, opts.projectRoot);
    const view = resolveCurrentScopeView({ ...opts, frameworkRoot, workflow, previous: scope, currentRunId: opts.runId });
    for (const phase of view.phase_chain) issues.push({ phase, condition: 'execution_scope', kind: 'needs_fix', detail: '当前义务尚无本次修复之后的有效证明' });
  }
  return { eligible: issues.length === 0, issues };
}

export function generateFeatureCompletion(opts: GenerateCompletionOptions): {
  originalAbs: string;
  projectionAbs: string;
  completion: FeatureCompletion;
} {
  const runId = opts.runId ?? undefined;
  const carrier = resolveEffectiveScopeSource(opts.projectRoot, opts.feature, runId);
  const scope = carrier?.scope;
  if (!scope && opts.executionScope) throw new Error('[feature-completion] 调用期候选不能替代真实出生范围');
  // 完成链从**同一有效范围**派生：调用方传的是本轮 replay 链（可能因某次修订把阶段移入
  // reused_phases 而少一段），而消费侧 inspectCompletionRecord 按 executionCompletionPhases
  // 对账。两处必须同一事实，否则会生成一份自己就判 INVALID 的完成原件。
  if (scope) opts = { ...opts, executionScope: scope, chain: executionCompletionPhases(scope) };
  const completionGate = shouldGenerateFeatureCompletion(scope, {
    ...opts,
    runId,
    currentRequirementSha: opts.currentRequirementSha ?? computeRunRequirementSha(opts.projectRoot, opts.feature, runId),
  });
  const issues = completionGate.issues;
  if (!completionGate.eligible) {
    const brief = issues.slice(0, 6).map((i) => `[${i.phase}] ${i.condition}: ${i.detail}`).join('；');
    throw new Error(`[feature-completion] 非 clean_pass，禁止生成完成凭证：${brief || '范围目标或未决义务尚未闭合'}${issues.length > 6 ? '…' : ''}`);
  }
  const { projectRoot, feature } = opts;

  const phases: CompletionPhaseRecord[] = opts.chain.map((phase) => {
    const manifest = loadPhaseEvidenceManifest(projectRoot, feature, phase);
    return {
      phase,
      run_id: opts.phaseRunIds[phase] ?? opts.runId ?? null,
      attempt: opts.phaseAttempts?.[phase] ?? null,
      gate_fingerprint: manifest?.manifest.environment.gate_fingerprint ?? null,
      receipt_sha256: null,
      evidence_manifest_aggregate: manifest?.manifest.aggregate_sha256 ?? null,
      // D1 H2：feature 载体把阶段闭环指纹写进凭证，verify 侧与 summary 重算对账。
      ...(carrier?.source === 'feature' ? { closure_fingerprint: readPhaseClosureFingerprint(projectRoot, feature, phase, opts.frameworkRoot) } : {}),
    };
  });

  const art = (name: string): string | null => {
    const r = resolveFeatureArtifact(projectRoot, feature, name);
    return r.exists ? sha256File(r.actualPath) : null;
  };
  const attestation = loadReviewClosureAttestation(projectRoot, feature);

  const completion: FeatureCompletion = {
    schema_version: scope ? FEATURE_COMPLETION_SCHEMA_VERSION : LEGACY_COMPLETION_SCHEMA_VERSION,
    feature,
    generated_at: (opts.now ? opts.now() : new Date()).toISOString(),
    run_id: opts.runId,
    ...(carrier ? { scope_source: carrier.source } : {}),
    workflow_track: opts.workflowTrack,
    ...(scope ? { execution_scope_fingerprint: executionScopeFingerprint(scope),
      // D2.6: how many revisions produced this effective scope — reconciled on verify.
      // D1：feature 载体的修订记在冻结记录的 `revisions[]` 里，数的是同一件事。
      scope_revision_count: runId
        ? loadScopeRevisions(loadAuthoritativeRunEvents(opts.projectRoot, opts.feature, runId), loadFrozenExecutionScope(opts.projectRoot, opts.feature, runId)!).length
        : (readFeatureFrozenScope(opts.projectRoot, opts.feature)?.revisions.length ?? 0) } : {}),
    chain: [...opts.chain],
    artifact_hashes: {
      spec_md: art('spec.md'),
      acceptance_yaml: art('acceptance.yaml'),
      contracts_yaml: art('contracts.yaml'),
    },
    requirement_sha256: computeRequirementSsotAggregate(projectRoot, feature, runId, opts.frameworkRoot),
    review_attestation_aggregate: attestation?.inventory.aggregate_sha256 ?? null,
    testing_source_aggregate: buildSourceInventory(projectRoot, { expectProductSources: false }).aggregate_sha256,
    phases,
    parent_run_id: opts.parentRunId ?? null,
    supersedes: opts.supersedes ?? [],
  };

  const originalAbs = path.join(opts.runDirAbs, FEATURE_COMPLETION_FILENAME);
  fs.mkdirSync(path.dirname(originalAbs), { recursive: true });
  const text = JSON.stringify(completion, null, 2) + '\n';
  const tmp = `${originalAbs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, originalAbs);

  const projection: CompletionProjection = {
    schema_version: completion.schema_version,
    original_path: path.relative(projectRoot, originalAbs).split(path.sep).join('/'),
    original_sha256: crypto.createHash('sha256').update(text, 'utf-8').digest('hex'),
  };
  const projectionAbs = featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME);
  fs.mkdirSync(path.dirname(projectionAbs), { recursive: true });
  fs.writeFileSync(projectionAbs, JSON.stringify(projection, null, 2) + '\n', 'utf-8');

  return { originalAbs, projectionAbs, completion };
}

// ----------------------------------------------------------------------------
// 唯一验证入口
// ----------------------------------------------------------------------------

/** goal-runs 目录内所有 run 的最新 run_end 状态（更晚未终局 run 检测用） */
function scanRunTerminalStates(
  projectRoot: string,
  feature: string,
): Array<{ run_id: string; status: string | null; last_ts: string | null }> {
  const runsDir = featureFilePath(projectRoot, feature, 'goal-runs');
  if (!fs.existsSync(runsDir)) return [];
  const out: Array<{ run_id: string; status: string | null; last_ts: string | null }> = [];
  // plan e7c2a4d8 T1d：权威枚举单一入口——.dry/残留不影响 completion freshness。
  for (const runId of classifyGoalRunsDir(runsDir).runs) {
    const eventsPath = path.join(runsDir, runId, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) continue;
    let status: string | null = null;
    let lastTs: string | null = null;
    try {
      for (const line of fs.readFileSync(eventsPath, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; status?: string; ts?: string };
          if (ev.ts) lastTs = ev.ts;
          if (ev.type === 'run_end') status = ev.status ?? null;
        } catch { /* 单行损坏不吞整文件 */ }
      }
    } catch { /* unreadable → 视为未知 run */ }
    out.push({ run_id: runId, status, last_ts: lastTs });
  }
  return out;
}

const NON_TERMINAL_OK = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);
/** 可作为 clean 血缘的 run 终局态（成功侧）——AWAITING_HUMAN_REVIEW 有待人工事项不算 */
const RUN_END_LINEAGE_OK = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);

/**
 * goal-runner completion 生成辅助：逐 phase 解析"最后一次执行该 phase 的 run"——
 * 扫描各 run events 的 phase_start 事件，按事件 ts 取最新。当前 run 已执行的 phase
 * 由调用方覆盖（本 run 身份权威）。
 */
function readRunEventLines(projectRoot: string, feature: string, runId: string): Array<Record<string, unknown>> {
  const eventsPath = featureFilePath(projectRoot, feature, path.join('goal-runs', runId, 'events.jsonl'));
  if (!fs.existsSync(eventsPath)) return [];
  const out: Array<Record<string, unknown>> = [];
  try {
    for (const line of fs.readFileSync(eventsPath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch { /* 单行损坏跳过 */ }
    }
  } catch { /* unreadable */ }
  return out;
}

/**
 * codex 九轮 P1：per-phase attempt 的**规范口径**——run 内该 phase 最后一次
 * agent_invoke_start 的 invoke_id 尾段（`i${totalTurns}` invocation 序数，跨 resume
 * 单调，critic-loop 同源）。phase_start.attempt=retries+1 会在 resume 归零，不是身份。
 *
 * codex 十轮 P1：三态返回——malformed invoke_id 不得退化为 null（否则与"无 invocation"
 * 不可区分，null===null 直接放行）。任何一条该 phase 的 agent_invoke_start 事件
 * invoke_id 缺失/畸形即 invalid（生产 invoke_id 全部框架生成，畸形=损坏/篡改）；
 * 完全无 invoke 事件（legacy/非 goal）→ absent 兼容态。
 */
export type PhaseInvocationAttempt =
  | { kind: 'absent' }
  | { kind: 'valid'; ordinal: string }
  | { kind: 'invalid'; detail: string };

export function derivePhaseInvocationAttempt(
  events: Array<Record<string, unknown>>,
  phase: string,
): PhaseInvocationAttempt {
  let out: PhaseInvocationAttempt = { kind: 'absent' };
  for (const ev of events) {
    if (ev.type !== 'agent_invoke_start' || ev.phase !== phase) continue;
    const invokeId = typeof ev.invoke_id === 'string' ? ev.invoke_id : '';
    const m = /-(i\d+)$/.exec(invokeId);
    if (!m) {
      return { kind: 'invalid', detail: invokeId ? `invoke_id 畸形（无 i<N> 尾段）：${invokeId}` : 'invoke_id 缺失' };
    }
    out = { kind: 'valid', ordinal: m[1] };
  }
  const source = phaseInvocationStart(events, phase);
  if (source?.type === 'agent_invoke_start' && source.phase === 'work-unit-author') {
    const invokeId = source.invoke_id ?? '';
    const match = /-(i\d+)$/.exec(invokeId);
    if (!match) return { kind: 'invalid', detail: `工作单元 invoke_id 畸形：${invokeId}` };
    return { kind: 'valid', ordinal: match[1] };
  }
  return out;
}

export function resolvePhaseRunIds(
  projectRoot: string,
  feature: string,
  chain: string[],
): { runIds: Record<string, string>; attempts: Record<string, string> } {
  const runsDir = featureFilePath(projectRoot, feature, 'goal-runs');
  const latest: Record<string, { run_id: string; ts: string }> = {};
  // plan e7c2a4d8 T1d：权威枚举单一入口——更晚的 .dry run/残留不得被选为最新阶段证据。
  for (const runId of classifyGoalRunsDir(runsDir).runs) {
    const events = readRunEventLines(projectRoot, feature, runId);
    for (const phase of chain) {
      const ev = phaseInvocationStart(events, phase);
      if (!ev?.ts) continue;
      const cur = latest[phase];
      if (!cur || ev.ts > cur.ts) latest[phase] = { run_id: runId, ts: ev.ts };
    }
  }
  const runIds: Record<string, string> = {};
  const attempts: Record<string, string> = {};
  for (const phase of chain) {
    if (!latest[phase]) continue;
    runIds[phase] = latest[phase].run_id;
    const attempt = derivePhaseInvocationAttempt(
      readRunEventLines(projectRoot, feature, latest[phase].run_id),
      phase,
    );
    // codex 十轮 P1：invocation 事件存在但不可推导 → 生成侧 fail-closed（拒产凭证），
    // 不得静默落 attempt:null 冒充"无 invocation"。
    if (attempt.kind === 'invalid') {
      throw new Error(
        `[feature-completion] phase ${phase} run ${latest[phase].run_id} invocation 事件非法（${attempt.detail}）——attempt 不可推导，拒绝生成`,
      );
    }
    if (attempt.kind === 'valid') attempts[phase] = attempt.ordinal;
  }
  return { runIds, attempts };
}

export interface VerifyCompletionOptions {
  projectRoot: string;
  feature: string;
  /**
   * 期望链（由调用方独立自 workflow SSOT/track 解析，如 resolveWorkflowSpec +
   * loadFeatureTrackDecl）——codex 五轮 P0：verifier 不得信凭证自报 chain，
   * 否则 chain=["testing"] 缩链即 VALID（事故原形）。
   */
  expectedChain: string[];
  /**
   * 消费方独立解析的 track（九轮 P2：workflow_track 自报同样不作数）。
   * codex 十轮 P2：必填——可选参数=fail-open API，省略即绕过 track 对账。
   */
  expectedTrack: string;
  /** 与 closure writer 相同的 framework 身份；省略时由 repo layout 推导（与 CleanPassOptions 同义）。 */
  frameworkRoot?: string;
}

/**
 * D1.5 H2：feature 载体的**阶段证明**。run 载体靠 events 的 phase_start / run_end / attempt 对账；
 * 无 run 路径上那三样不存在，于是判据换成 feature 侧同强度的五项事实——每一项都是既有机制，
 * 没有为这条路径新造任何凭证：
 *   ① 阶段 summary 的 `verdict === 'PASS'`；
 *   ② `closure_status === 'closed'`；
 *   ③ `closure_commit.schema_version === '1.0'`（①②③ 与 assess 判「closed」用的是同一把尺）；
 *   ④ `loadPhaseEvidenceManifest(...).integrityOk`；
 *   ⑤ `recomputePhaseEvidenceStaleness(...) === 'fresh'`。
 * **attempt 与 run 终局两维显式豁免**（D1.5 明写：轻量路径上确实不存在对应事实，不伪造 run_id 去凑）。
 */
/**
 * 阶段闭环指纹 = **已闭环 summary 的内容哈希**，与生产 `finalizePhaseClosure` 返回的
 * `closure_fingerprint`（`phase-closure-finalizer.ts:502`/`:746`：staged summary 的 sha256）同义。
 * 只有 `closure_commit` 合法的已闭环 summary 才给值——open 的阶段没有闭环可言。
 */
function readPhaseClosureFingerprint(projectRoot: string, feature: string, phase: string, frameworkRoot?: string): string | null {
  try {
    const abs = path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'summary.json');
    if (!fs.existsSync(abs)) return null;
    const summary = JSON.parse(fs.readFileSync(abs, 'utf8')) as { closure_status?: unknown; closure_commit?: { schema_version?: unknown } };
    if (summary.closure_status !== 'closed' || summary.closure_commit?.schema_version !== '1.0') return null;
    return sha256File(abs);
  } catch { return null; }
}

function featureCarrierPhaseLineageIssues(
  projectRoot: string,
  feature: string,
  rec: CompletionPhaseRecord,
  frameworkRoot?: string,
): { record: string[]; evidence: string[] } {
  // plan b2d7f4e9 §3.1：记录自报值（attempt、闭环指纹）失配 = 记录不可信；阶段 summary / manifest /
  // freshness 是**当前证据**的状态，交义务侧按阶段判 evidence 缺口，不把世界变化判成记录伪造。
  const record: string[] = [];
  const out: string[] = [];
  if (rec.attempt !== null) record.push(`[${rec.phase}] feature 载体不得声明 attempt（无 run 路径没有 invocation 序数）`);
  const summaryPath = path.join(featurePhaseReportsDir(projectRoot, feature, rec.phase, frameworkRoot), 'summary.json');
  let summary: { verdict?: unknown; closure_status?: unknown; closure_commit?: { schema_version?: unknown } } | null = null;
  try {
    summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null;
  } catch { summary = null; }
  if (!summary) { out.push(`[${rec.phase}] 缺少阶段 summary.json——无 run 路径的阶段证明不成立`); return { record, evidence: out }; }
  if (summary.verdict !== 'PASS') out.push(`[${rec.phase}] 阶段 verdict 非 PASS：${String(summary.verdict)}`);
  if (summary.closure_status !== 'closed') out.push(`[${rec.phase}] 阶段未闭环：closure_status=${String(summary.closure_status)}`);
  if (summary.closure_commit?.schema_version !== '1.0') out.push(`[${rec.phase}] closure_commit 版本非法或缺失`);
  const manifest = loadPhaseEvidenceManifest(projectRoot, feature, rec.phase);
  if (!manifest?.integrityOk) out.push(`[${rec.phase}] 证据 manifest 缺失或完整性失败`);
  const fresh = recomputePhaseEvidenceStaleness(projectRoot, feature, [rec.phase], frameworkRoot ? { frameworkRoot } : undefined)[0];
  if (fresh?.verdict !== 'fresh') out.push(`[${rec.phase}] 阶段证据非 fresh：${String(fresh?.verdict)}`);
  const closure = readPhaseClosureFingerprint(projectRoot, feature, rec.phase, frameworkRoot);
  if (!closure) out.push(`[${rec.phase}] 阶段闭环指纹缺失`);
  else if (rec.closure_fingerprint !== closure) record.push(`[${rec.phase}] closure_fingerprint 与阶段闭环记录失配`);
  return { record, evidence: out };
}

/**
 * plan b2d7f4e9 §3.1：`assessFeature` 的 record 部分——只回答「这份完成记录本身可不可信」。
 * 投影/原件哈希、schema/字段守卫、chain↔workflow、phases↔chain、run_id 载体、run 事件血缘
 * （phase_start / run_end / attempt / gate_fingerprint）、按记录**自己的** run 范围核指纹与修订计数、supersede 审计。
 * 世界后变（输入/证据/源码变化、更晚未终局 run）不在这里裁决：以 `drift` / `laterRuns` 交给调用方按义务与 blocking 呈现。
 */
export interface CompletionRecordInspection extends CompletionVerdict {
  completion?: FeatureCompletion;
  /** 覆盖用的当前有效范围（1.2）：run 载体 = 该 run 有效范围；feature 载体 = 冻结记录最新有效范围；legacy 1.1 为 undefined。 */
  scope?: ExecutionScope;
  /** 记录值与当前阶段证据 / legacy 顶层绑定不符：交义务侧（按责任阶段），不是记录不可信。 */
  drift: Array<{ phase: string; detail: string; class: 'binding' | 'evidence' }>;
  /** 晚于凭证的未终局 run（经审计的 supersede 豁免）。 */
  laterRuns: string[];
}

export function inspectCompletionRecord(opts: VerifyCompletionOptions): CompletionRecordInspection {
  const { projectRoot, feature } = opts;
  const reasons: string[] = [];
  const drift: CompletionRecordInspection['drift'] = [];
  const invalid = (reason: string, completion?: FeatureCompletion): CompletionRecordInspection => ({ verdict: 'INVALID', reasons: [reason], completion, drift: [], laterRuns: [] });
  if (!Array.isArray(opts.expectedChain) || opts.expectedChain.length === 0) {
    return invalid('expectedChain 缺失——消费方必须独立解析 workflow 链，不得信凭证自报');
  }
  // codex 十轮 P2：expectedTrack 与 expectedChain 同为消费方义务——缺失/空即 INVALID
  if (typeof opts.expectedTrack !== 'string' || opts.expectedTrack.length === 0) {
    return invalid('expectedTrack 缺失——消费方必须独立解析 workflow track，不得信凭证自报');
  }

  const projectionAbs = featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME);
  if (!fs.existsSync(projectionAbs)) return invalid('无 feature-completion 投影');
  let projection: CompletionProjection;
  try {
    projection = JSON.parse(fs.readFileSync(projectionAbs, 'utf-8')) as CompletionProjection;
  } catch {
    return invalid('投影 JSON 解析失败');
  }
  if (!projection.original_path || !projection.original_sha256) {
    return invalid('投影缺 original_path/original_sha256（禁止以文件存在性为完成依据）');
  }
  const originalAbs = path.join(projectRoot, projection.original_path);
  if (!fs.existsSync(originalAbs)) return invalid(`原件缺失：${projection.original_path}`);
  const originalText = fs.readFileSync(originalAbs, 'utf-8');
  const originalSha = crypto.createHash('sha256').update(originalText, 'utf-8').digest('hex');
  if (originalSha !== projection.original_sha256) return invalid('投影与原件哈希失配（疑似手工改写）');
  let completion: FeatureCompletion;
  try {
    completion = JSON.parse(originalText) as FeatureCompletion;
  } catch {
    return invalid('原件 JSON 解析失败');
  }
  // codex 八轮 P2：完整结构校验——畸形/旧版应 INVALID 而非 .map 抛异常。
  if (![FEATURE_COMPLETION_SCHEMA_VERSION, LEGACY_COMPLETION_SCHEMA_VERSION].includes(completion.schema_version)) {
    return invalid(`schema_version 非法/旧版：${String(completion.schema_version)}（要求 ${FEATURE_COMPLETION_SCHEMA_VERSION}）`);
  }
  if (completion.schema_version === FEATURE_COMPLETION_SCHEMA_VERSION && projection.schema_version !== completion.schema_version) return invalid('投影与原件 schema_version 失配');
  if (completion.schema_version === FEATURE_COMPLETION_SCHEMA_VERSION && !/^[0-9a-f]{64}$/.test(completion.execution_scope_fingerprint ?? '')) return invalid('新完成记录缺少合法 execution_scope_fingerprint');
  if (!Array.isArray(completion.chain) || completion.chain.length === 0 || !completion.chain.every((p) => typeof p === 'string')) {
    return invalid('chain 非法（须非空字符串数组）');
  }
  // 以下失败时 chain 已可信地解析出来：随结果带回，供调用方按阶段核当前证据。
  const invalidRecord = (reason: string): CompletionRecordInspection => invalid(reason, completion);
  if (!Array.isArray(completion.phases)) return invalidRecord('phases 非数组');
  // D1.5 H1：`scope_source` 决定 run 身份位的形状——`'feature'` 载体下逐阶段 run_id **必为 null**，
  // `'run'`（含缺省的旧记录）下必为非空 string。两者不得混。
  const featureCarrier = completion.scope_source === 'feature';
  if (completion.scope_source !== undefined && completion.scope_source !== 'run' && completion.scope_source !== 'feature') {
    return invalidRecord(`scope_source 非法：${String(completion.scope_source)}`);
  }
  const structOk = completion.phases.every(
    (p) =>
      p && typeof p === 'object' &&
      typeof p.phase === 'string' &&
      (featureCarrier ? p.run_id === null : typeof p.run_id === 'string') &&
      (p.attempt === null || typeof p.attempt === 'string') &&
      (p.gate_fingerprint === null || typeof p.gate_fingerprint === 'string') &&
      (p.receipt_sha256 === null || typeof p.receipt_sha256 === 'string') &&
      (p.evidence_manifest_aggregate === null || typeof p.evidence_manifest_aggregate === 'string') &&
      // D1 H2：`closure_fingerprint` 只由 feature 载体写。run 载体（含缺省 scope_source 的旧
      // 1.2 记录）允许**缺省**，但不允许放一个非法类型的值蒙混进后续校验。
      (featureCarrier
        ? typeof p.closure_fingerprint === 'string' && !!p.closure_fingerprint
        : p.closure_fingerprint === undefined || p.closure_fingerprint === null),
  );
  if (!structOk) return invalidRecord('phases 记录字段类型非法');
  for (const [k, v] of [
    ['requirement_sha256', completion.requirement_sha256],
    ['review_attestation_aggregate', completion.review_attestation_aggregate],
    ['testing_source_aggregate', completion.testing_source_aggregate],
  ] as const) {
    if (v !== null && typeof v !== 'string') return invalidRecord(`${k} 类型非法`);
  }
  // codex 九轮 P2：完整字段守卫——缺 artifact_hashes/supersedes 等应 INVALID 而非抛异常
  if (
    !completion.artifact_hashes || typeof completion.artifact_hashes !== 'object' ||
    ([completion.artifact_hashes.spec_md, completion.artifact_hashes.acceptance_yaml, completion.artifact_hashes.contracts_yaml]
      .some((v) => v !== null && typeof v !== 'string'))
  ) {
    return invalidRecord('artifact_hashes 缺失/类型非法');
  }
  if (!Array.isArray(completion.supersedes) || !completion.supersedes.every((s) => typeof s === 'string')) {
    return invalidRecord('supersedes 缺失/类型非法');
  }
  if (typeof completion.generated_at !== 'string' || Number.isNaN(Date.parse(completion.generated_at))) {
    return invalidRecord('generated_at 缺失/非法时间戳');
  }
  if (typeof completion.workflow_track !== 'string' || !completion.workflow_track) {
    return invalidRecord('workflow_track 缺失/类型非法');
  }
  if (completion.parent_run_id !== null && typeof completion.parent_run_id !== 'string') {
    return invalidRecord('parent_run_id 类型非法');
  }
  // 记录按**它自己的** run 范围核验（plan b2d7f4e9 §3.1「两套范围不混用」）：指纹、修订计数、
  // 完成目标与完成链都对自身有效范围对账；范围内证据是否仍覆盖义务由 assessFeature 另判，不在这里。
  let frozenScope: ExecutionScope | undefined;
  /** 交给覆盖侧的当前有效范围：run 载体 = 记录核验范围；feature 载体 = 冻结记录的最新有效范围。 */
  let currentScope: ExecutionScope | undefined;
  try {
    // D2.6: the completion was cut from the EFFECTIVE scope (birth + applied revisions), so the
    // fingerprint and the expected chain reconcile against that — while the birth scope is still
    // loaded first, because a missing birth record is still INVALID.
    const featureRecord = completion.run_id ? null : readFeatureFrozenScope(projectRoot, feature);
    const birthScope = completion.run_id
      ? loadFrozenExecutionScope(projectRoot, feature, completion.run_id)
      : featureRecord?.execution_scope;
    if (completion.schema_version === FEATURE_COMPLETION_SCHEMA_VERSION && !birthScope) return invalidRecord('新完成记录缺少出生范围');
    if (birthScope) {
      // D2.6: a 1.2 record MUST carry the count. `?? 0` would accept a stripped field as "no
      // revisions", i.e. a damaged certificate reading as a clean zero-revision run.
      const declared = completion.scope_revision_count;
      if (completion.schema_version === FEATURE_COMPLETION_SCHEMA_VERSION && (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 0)) {
        return invalidRecord('完成记录缺少合法的 scope_revision_count');
      }
      if (completion.run_id) {
        // run 载体：完成后的修订只发生在后继 run，本 run 的修订数必须与凭证相等。
        frozenScope = resolveEffectiveScopeSource(projectRoot, feature, completion.run_id)?.scope;
        const revisions = loadScopeRevisions(loadAuthoritativeRunEvents(projectRoot, feature, completion.run_id), birthScope).length;
        if ((declared ?? 0) !== revisions) return invalidRecord(`scope_revision_count 与事件失配：凭证=${declared ?? 0} ≠ 事件=${revisions}`);
        currentScope = loadEffectiveExecutionScope(projectRoot, feature, completion.run_id);
      } else {
        // feature 载体（plan b2d7f4e9 §3.1 / §6 #15）：完成后的合法修订追加在同一份冻结记录上，
        // 所以记录按**凭证登记的修订位置**回放历史范围核验（与 featureEffectiveScope 同一个 applyScopeRevisions），
        // 与转交无关；只有声明了不存在的修订才是坏记录。覆盖仍读最新有效范围。
        const revisions = featureRecord!.revisions;
        if ((declared ?? 0) > revisions.length) return invalidRecord(`scope_revision_count 声明了不存在的修订：凭证=${declared ?? 0} > 冻结记录=${revisions.length}`);
        frozenScope = applyScopeRevisions(birthScope, revisions.slice(0, declared ?? 0) as never);
        currentScope = featureEffectiveScope(featureRecord!);
      }
    }
    if (frozenScope) {
      if (completion.schema_version !== FEATURE_COMPLETION_SCHEMA_VERSION || completion.execution_scope_fingerprint !== executionScopeFingerprint(frozenScope)) return invalidRecord('execution_scope_fingerprint 与有效范围失配');
      if (frozenScope.completion_target !== 'feature') return invalidRecord('完成记录的有效范围不是 Feature 完成目标');
      opts = { ...opts, expectedChain: executionCompletionPhases(frozenScope) };
    }
  } catch (error) { return invalidRecord(`完成出生范围不可验证：${String(error)}`); }
  if (!frozenScope && completion.workflow_track !== opts.expectedTrack) {
    return invalidRecord(`workflow_track 与消费方解析失配：${completion.workflow_track} ≠ ${opts.expectedTrack}`);
  }

  // ---- 自报字段对账（codex 五轮 P0：缩链/跨 feature/落点漂移全部在此拦） ----
  if (completion.feature !== feature) return invalidRecord(`凭证 feature 失配：${completion.feature} ≠ ${feature}`);
  if (
    completion.chain.length !== opts.expectedChain.length ||
    completion.chain.some((p, i) => p !== opts.expectedChain[i])
  ) {
    return invalidRecord(`凭证 chain 与 workflow 解析链失配：[${completion.chain.join(',')}] ≠ [${opts.expectedChain.join(',')}]（缩链冒充全链即事故原形）`);
  }
  const phaseList = completion.phases.map((p) => p.phase);
  if (phaseList.length !== completion.chain.length || phaseList.some((p, i) => p !== completion.chain[i])) {
    return invalidRecord(`phases 与 chain 不一一对应：[${phaseList.join(',')}]`);
  }
  if (featureCarrier ? completion.run_id !== null : (typeof completion.run_id !== 'string' || !completion.run_id)) {
    return invalidRecord(featureCarrier ? 'feature 载体的凭证 run_id 必须为 null（不允许伪造 run 身份）' : '凭证缺 run_id');
  }
  // 原件落点按载体二分；两者都锁在 runner 拥有的目录内，语义不放松。
  const expectedOriginalDir = path.resolve(featureCarrier
    ? featureFilePath(projectRoot, feature, 'completion')
    : featureFilePath(projectRoot, feature, path.join('goal-runs', completion.run_id!)));
  if (!path.resolve(originalAbs).startsWith(expectedOriginalDir + path.sep) && path.resolve(path.dirname(originalAbs)) !== expectedOriginalDir) {
    return invalidRecord(`原件落点非法（须在 ${featureCarrier ? feature + '/completion/' : 'goal-runs/' + completion.run_id + '/'} 内）：${projection.original_path}`);
  }
  // run-event 血缘核验（codex 六轮 P0-4：只查 events.jsonl 存在=没验血缘）——
  // 每个检查族沿同一真实调用读取器验证执行血缘；历史 phase_start 兼容，run 终局仍须成功。
  for (const rec of completion.phases) {
    if (featureCarrier) {
      // D1.5 H2：feature 载体没有 run events；记录自报的 attempt / 闭环指纹在这里核，
      // 阶段 summary / manifest / freshness 是当前证据，交义务侧（drift）。
      const lineage = featureCarrierPhaseLineageIssues(projectRoot, feature, rec, opts.frameworkRoot);
      reasons.push(...lineage.record);
      drift.push(...lineage.evidence.map(detail => ({ phase: rec.phase, detail, class: 'evidence' as const })));
      continue;
    }
    const evAbs = featureFilePath(projectRoot, feature, path.join('goal-runs', rec.run_id!, 'events.jsonl'));
    if (!fs.existsSync(evAbs)) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 无 events.jsonl——自报失配`);
      continue;
    }
    let sawPhaseExecution = false;
    let runEndStatus: string | null = null;
    try {
      const events: Array<Record<string, unknown>> = [];
      for (const line of fs.readFileSync(evAbs, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; phase?: string; status?: string };
          events.push(ev);
          if (ev.type === 'run_end') runEndStatus = ev.status ?? null;
        } catch { /* 单行损坏跳过 */ }
      }
      sawPhaseExecution = !!phaseInvocationStart(events, rec.phase);
    } catch {
      reasons.push(`[${rec.phase}] run ${rec.run_id} events.jsonl 不可读`);
      continue;
    }
    if (!sawPhaseExecution) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 从未执行该检查族（无真实调用或历史 phase_start）——血缘不成立`);
    }
    // codex 七轮 P0-1：run_end **缺失**（崩溃/中断/截断）同样不得作 clean 血缘——
    // null 放行是漏洞（run 未终局也能证完成）。要求成功侧 run_end 显式存在。
    if (runEndStatus === null) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 无 run_end 事件（未终局/崩溃/截断）——血缘不成立`);
    } else if (!RUN_END_LINEAGE_OK.has(runEndStatus)) {
      reasons.push(`[${rec.phase}] 引用 run ${rec.run_id} 终局为 ${runEndStatus}（非成功态不得作为 clean 血缘）`);
    }
    // codex 九轮 P1：attempt 与事件对账（规范口径=最后一次 agent_invoke_start 的
    // invocation 序数）——自报 attempt 改写即 INVALID，不再是装饰字段。
    // codex 十轮 P1：三态——invalid（事件存在但 invoke_id 缺失/畸形）单独 fail-closed，
    // 不与 absent 合流成 null===null 放行。
    const derivedAttempt = derivePhaseInvocationAttempt(
      readRunEventLines(projectRoot, feature, rec.run_id!),
      rec.phase,
    );
    if (derivedAttempt.kind === 'invalid') {
      reasons.push(
        `[${rec.phase}] run ${rec.run_id} invocation 事件非法（${derivedAttempt.detail}）——attempt 不可推导，血缘不成立`,
      );
    } else {
      const expected = derivedAttempt.kind === 'valid' ? derivedAttempt.ordinal : null;
      if ((rec.attempt ?? null) !== expected) {
        reasons.push(
          `[${rec.phase}] attempt 与事件推导失配：凭证=${rec.attempt ?? 'null'} ≠ 事件=${expected ?? 'null'}`,
        );
      }
    }
  }
  // 生成 run 自身必须有 events；D1.5 H3：feature 载体换成「冻结记录存在且结构 / 修订链完整」。
  if (featureCarrier) {
    try {
      const record = readFeatureFrozenScope(projectRoot, feature);
      // 指纹已在上方对「按凭证修订位置回放的范围」核过；这里只要求冻结记录在场。
      if (!record) reasons.push('feature 载体的完成凭证缺少冻结记录——自报失配');
    } catch (error) { reasons.push(`feature 冻结记录不可验证：${String(error)}`); }
  } else {
    const genEv = featureFilePath(projectRoot, feature, path.join('goal-runs', completion.run_id!, 'events.jsonl'));
    if (!fs.existsSync(genEv)) reasons.push(`生成 run ${completion.run_id} 无 events.jsonl——自报失配`);
  }

  // 逐阶段自报值 vs 当前阶段证据。当前 manifest 与记录的 aggregate 相同 = 仍是记录切出时那份证据，
  // 此时 gate_fingerprint 不等只能是记录被改写 → 记录不可信（第一轮阻断 8）；aggregate 不同 =
  // 该阶段证据后变（重跑、删除、损坏）→ 交义务侧 evidence 缺口（plan b2d7f4e9 §6 #9：记录仍可信）。
  for (const rec of completion.phases) {
    // 当前 writer 不再生成回执摘要；旧非 null 记录保留既有 drift 语义，不重算回执字节。
    if (rec.receipt_sha256 !== null) {
      drift.push({ phase: rec.phase, detail: '回执规范化哈希与凭证记录失配（阶段证据后变）', class: 'evidence' });
    }
    const manifest = loadPhaseEvidenceManifest(projectRoot, feature, rec.phase);
    if ((manifest?.manifest.aggregate_sha256 ?? null) !== rec.evidence_manifest_aggregate) {
      drift.push({ phase: rec.phase, detail: 'evidence manifest aggregate 与凭证记录失配（阶段证据后变）', class: 'evidence' });
    } else if ((manifest?.manifest.environment.gate_fingerprint ?? null) !== rec.gate_fingerprint) {
      reasons.push(`[${rec.phase}] gate_fingerprint 与阶段证据记录失配`);
    }
  }
  // legacy 1.1（无出生范围）保留顶层绑定比对，结果按责任阶段交义务侧；1.2 下这些输入已是义务绑定，不再单独比。
  if (!frozenScope) {
    const artNow = (name: string): string | null => {
      const r = resolveFeatureArtifact(projectRoot, feature, name);
      return r.exists ? sha256File(r.actualPath) : null;
    };
    for (const [name, recorded, phase] of [
      ['spec.md', completion.artifact_hashes.spec_md, 'spec'],
      ['acceptance.yaml', completion.artifact_hashes.acceptance_yaml, 'spec'],
      ['contracts.yaml', completion.artifact_hashes.contracts_yaml, 'plan'],
    ] as const) {
      if (artNow(name) !== recorded) drift.push({ phase, detail: `顶层 artifact 变更：${name}`, class: 'binding' });
    }
    // codex 七轮 P1-3：需求 SSOT/testing 源码/review attestation 绑定字段重算对账
    try {
      if (computeRequirementSsotAggregate(projectRoot, feature, completion.run_id ?? undefined, opts.frameworkRoot) !== completion.requirement_sha256) drift.push({ phase: 'spec', detail: 'requirement_sha256 与凭证记录失配（需求 SSOT 变更）', class: 'binding' });
    } catch (error) { drift.push({ phase: 'spec', detail: '需求绑定失效：' + String(error), class: 'binding' }); }
    const attNow = loadReviewClosureAttestation(projectRoot, feature);
    if ((attNow?.inventory.aggregate_sha256 ?? null) !== completion.review_attestation_aggregate) {
      drift.push({ phase: 'review', detail: 'review_attestation_aggregate 与凭证记录失配', class: 'evidence' });
    }
    if (buildSourceInventory(projectRoot, { expectProductSources: false }).aggregate_sha256 !== completion.testing_source_aggregate) {
      drift.push({ phase: 'testing', detail: 'testing_source_aggregate 与凭证记录失配（产品源码树变更）', class: 'binding' });
    }
  }

  // supersedes 审计核验（codex 五轮 P1：自报 Set 直接豁免=把绕过固化）：
  // 每个被废弃 run 必须在生成 run 的 events.jsonl 里有 {type:'supersede', target_run_id}
  // 审计事件；无事件的自报条目不生效且判自报失配。
  const auditedSupersedes = new Set<string>();
  {
    const genEvents = featureFilePath(projectRoot, feature, path.join('goal-runs', completion.run_id ?? '', 'events.jsonl'));
    if (fs.existsSync(genEvents)) {
      for (const line of fs.readFileSync(genEvents, 'utf-8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as { type?: string; target_run_id?: string };
          if (ev.type === 'supersede' && typeof ev.target_run_id === 'string') {
            auditedSupersedes.add(ev.target_run_id);
          }
        } catch { /* 单行损坏跳过 */ }
      }
    }
    for (const claimed of completion.supersedes) {
      if (!auditedSupersedes.has(claimed)) {
        reasons.push(`supersedes 自报 ${claimed} 无对应审计事件（--supersede 未真实执行）——自报失配`);
      }
    }
  }

  // 更晚未终局 run（仅经审计核验的 supersede 生效豁免）——世界事实，交调用方 blocking。
  const laterRuns: string[] = [];
  const gen = completion.generated_at;
  for (const run of scanRunTerminalStates(projectRoot, feature)) {
    if (auditedSupersedes.has(run.run_id) && completion.supersedes.includes(run.run_id)) continue;
    if (run.run_id === completion.run_id) continue;
    if (run.last_ts && run.last_ts > gen && !NON_TERMINAL_OK.has(run.status ?? '')) {
      laterRuns.push(`存在晚于凭证的未终局 run：${run.run_id}（status=${run.status ?? '未知'}）`);
    }
  }

  return { verdict: reasons.length === 0 ? 'VALID' : 'INVALID', reasons, completion, scope: currentScope, drift, laterRuns };
}
