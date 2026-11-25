import type { IdentityNeutralDigestReaders } from './identity-neutral-digest';
import { executionCompletionPhases } from './execution-scope';
import { readRepairDependencyContext, workUnitMayWritePath } from './repair-responsibility';
import { phaseCompletionProblems, isBlockingCheck } from './check-disposition';
import { resolveExecutionScope, readScopeRevisionUserControl, applyScopeUserControl, assertRevisionKeepsRequiredObligations, executionScopeFingerprint, effectiveScopeView, scopeProofHistory, phaseEvidenceIsCurrent, scopeRevisionInvalidations, authorizedScopePhases, acceptsDefinitionInputProof, EXECUTION_SOURCE_KINDS, OBLIGATION_PROVIDERS, type ScopeHistoryEvent, type ScopeEvidenceRef, type ScopeImpactJudgement, type ExecutionScope, type ExecutionScopeInput, type ResolvedScopeFacts } from './execution-scope';
import { createHash } from 'crypto';
import * as path from 'path';
import type { WorkflowSpec } from '../../workflow-loader';
import type { AcceptanceSpec, ContractsSpec } from './types';
import { artifactBindingMatches, readBoundInput, DEPENDENCY_ONLY_PROVIDER_IDS, type InputBinding } from './capability-resolution';
import { inferLegacyProjectRoot, isInsideProjectRoot, resolveDependencyPath } from './project-relative-path';
import { loadEffectiveExecutionScope, resolveEffectiveScopeSource } from './goal-run-creation';
import { loadFeatureContracts, contractFingerprint } from './skill-contract';
import { createObservedSourceHashReader, loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness, sha256File } from './phase-evidence-manifest';
import { authoritativeContentDrift, compareAuthoritativeContent, deriveBlueprintSkillInput, describeAuthoritativeDrift, projectionContentEqual } from './blueprint-skill-projection';
import { hasNewSourcedFact } from './execution-scope';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { inferRepoLayout } from '../../repo-layout';
import { SpecLoader } from './spec-loader';
import { featureRelativePath } from './feature-identity';
import type { FidelityTarget } from './fidelity-shared';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, parseChangeUnitFeatureId } from './change-unit-path';
import { loadCanonicalBlueprint } from './component-blueprint-path';
import { isProducedPhaseChange, resolvePhasePathOwnership } from './phase-write-boundary';
import { readHandoffMaterial, type SessionExecutionRequest } from './session-execution-handoff';
import { repairCandidateCanReviseScope, scopeRepairReason, SCOPE_REVISION_FACT_KIND, type RepairCandidate } from './repair-candidates';
import { invocationCompleted } from './invocation-completion';
import { asRecord, asRecords } from './component-blueprint-model';
import { resolveBlueprintTarget } from './blueprint-addressing';
import { normalizeContractFilePath, resolveContractFileReferences, selectContractReferencePaths } from './contract-reference-closure';
import { isUiComponent } from './component-assets';
import { isUiSensitiveFile } from './ui-scope-gate';
import type { GoalRunEvent } from './goal-runner-phase';
import type { ChangeUnitArtifact } from './change-unit-model';
// ============================================================================
// feature-track.ts — feature.yaml 的 track 声明读取（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// feature 级档位声明落盘于 <features_dir>/<feature>/feature.yaml（路径一律经
// paths.features_dir 解析，禁止硬编码 doc/features/——round7 path-governance）。
// 文件缺失 / 解析失败 / 未声明 → null（resolveFeatureTrack 解释为 full，默认零变化）。

import * as fs from 'fs';
import * as YAML from 'yaml';
import { componentIndexPath, featureArtifactPath, featureFilePath, featurePhaseReportsDir, relFeaturesDir, resolveFeatureArtifact } from '../../config';
import type { FeatureCompletion } from './verify-feature-completion';
import { resolveFeatureTrack, type FeatureTrackDecl } from './runtime-policy';

export const FEATURE_DECL_FILENAME = 'feature.yaml';

export function featureTrackDeclPath(projectRoot: string, feature: string): string {
  return featureArtifactPath(projectRoot, feature, FEATURE_DECL_FILENAME);
}

export function loadFeatureTrackDecl(projectRoot: string, feature: string, existingRunId?: string): FeatureTrackDecl | null {
  const runId = existingRunId ?? process.env.MAISON_GOAL_RUN_ID?.trim();
  if (runId && fs.existsSync(featureArtifactPath(projectRoot, feature, 'goal-runs/' + runId + '/manifest.json'))) {
    const legacy = JSON.parse(fs.readFileSync(featureArtifactPath(projectRoot, feature, 'goal-runs/' + runId + '/manifest.json'), 'utf8')) as { phase_chain?: string[] };
    if (Array.isArray(legacy.phase_chain) && legacy.phase_chain.length) resolveFeatureTrack(undefined, legacy.phase_chain);
  }
  try {
    const abs = featureTrackDeclPath(projectRoot, feature);
    if (!fs.existsSync(abs)) return null;
    const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const track = (raw as { track?: unknown }).track;
    if (track === 'lite') {
      console.warn('[lite-retired] feature.yaml 的 track: lite 已忽略；当前请求按义务范围运行，不恢复 change/exit 旧链。');
      return { track: 'full' };
    }
    return typeof track === 'string' ? { track } : {};
  } catch {
    // 解析失败按未声明处理（full），候选范围语法由现有范围入口另行报告
    return null;
  }
}

/** C5-full：修正闭环时 append 到 feature.yaml > history[]（与 track 升档事件共用同一数组）。 */
export interface CorrectionHistoryEntry {
  at: string;
  type: 'correction';
  root_layer: string;
  touched_layers: readonly string[];
}

/**
 * appendFeatureCorrectionHistory：feature.yaml 不存在（no-feature 修正、或 feature 未曾声明 track）时静默跳过——
 * 修正历史是锦上添花的可追溯性记录，不是阻断性契约，文件缺失不应让修正路由（--correction-init）失败。
 */
export function appendFeatureCorrectionHistory(
  projectRoot: string,
  feature: string,
  entry: CorrectionHistoryEntry,
): void {
  const abs = featureTrackDeclPath(projectRoot, feature);
  if (!fs.existsSync(abs)) return;
  try {
    const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return;
    const history = Array.isArray(raw.history) ? raw.history : [];
    history.push(entry);
    raw.history = history;
    fs.writeFileSync(abs, YAML.stringify(raw), 'utf-8');
  } catch {
    // 写入失败不阻断修正闭环——历史记录是可追溯性增强，非红线契约
  }
}

/**
 * 磁盘候选（`feature.yaml` 的 `execution_scope`）**原样**指纹——在 resolver 的任何改写之前取，
 * 否则 `contract_fingerprints` 回填与定义类事实重算会让同一份候选每次都得到不同指纹。
 * D1.2 的「候选被改动而冻结记录未经修订」就是比这一个值。
 */
export function featureScopeCandidateFingerprint(projectRoot: string, feature: string): string {
  const raw = YAML.parse(fs.readFileSync(featureTrackDeclPath(projectRoot, feature), 'utf8')) as { execution_scope?: unknown };
  if (!raw?.execution_scope) throw new Error('[execution-scope] workflow 1.2 缺少运行前范围输入');
  return executionScopeFingerprint(raw.execution_scope);
}

/** Frozen runless candidate's requirement provenance; text remains at its original CLI/file source. */
export function featureRequirementBinding(projectRoot: string, feature: string): InputBinding {
  const raw = YAML.parse(fs.readFileSync(featureTrackDeclPath(projectRoot, feature), 'utf8')) as { execution_scope?: ExecutionScopeInput };
  const binding = raw?.execution_scope?.request.requirement_basis;
  if (!binding || binding.input_id !== 'requirement' || binding.source.kind !== 'derive' || binding.source.provider_id !== 'derive.requirement') {
    throw new Error('[execution-scope] 候选缺少可核验 requirement_basis；请用 --prepare-scope 重新生成');
  }
  return binding;
}

/** Only fresh 1.2 runs read the candidate; resume never consults this mutable file. */
export function resolveFeatureExecutionScope(projectRoot: string, feature: string, workflow: WorkflowSpec, frameworkRoot?: string, requirement?: string, manifestFidelity?: FidelityTarget): ExecutionScope | undefined {
  if (workflow.schema_version !== '1.2') return undefined;
  const raw = YAML.parse(fs.readFileSync(featureTrackDeclPath(projectRoot, feature), 'utf8')) as { execution_scope?: ExecutionScopeInput };
  if (!raw?.execution_scope) throw new Error('[execution-scope] workflow 1.2 缺少运行前范围输入');
  // 出生入口都带着本次需求：候选必须自带 provenance 绑定（`--prepare-scope` 生成的一定有）。
  // 被删或被换 = 这份候选证明不了自己是为这句需求算的 → fail-closed，不猜、不放行。
  if (requirement?.trim() && !raw.execution_scope.request.requirement_basis) {
    throw new Error('[execution-scope] 候选缺少需求 provenance 绑定（request.requirement_basis）——请用 goal-mode-entry --prepare-scope 重新生成，不要手写候选');
  }
  const resolvedFrameworkRoot = frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot;
  raw.execution_scope.contract_fingerprints = loadFeatureContracts(resolvedFrameworkRoot).map(contractFingerprint);
  const ctx = { projectRoot, feature, frameworkRoot: resolvedFrameworkRoot };
  // D0.1「不采信自报」扩到两个定义类 kind：候选里的 design-context / acceptance-context
  // 一律按来源重算，否则手写一条 unknown 就能伪造缺口、顶掉 §4.1.3 子情形 (a) 的 fail-closed。
  recomputeDefinitionFacts(raw.execution_scope, ctx, workflow);
  const factsContext = { ...ctx, requirement: requirement?.trim() || undefined, manifestFidelity };
  const facts = resolveChangeUnitImpactFacts(raw.execution_scope, factsContext);
  return resolveExecutionScope(
    raw.execution_scope,
    workflow,
    readScopeAcceptance(projectRoot, raw.execution_scope, ctx),
    // requirement source: the real `--requirement` / `manifest.requirement`. Both birth entries
    // have one; the change-unit handoff projection has none, and **不编一份**——凭空拿
    // `requested_results` 当需求文本只会让每条 `derive.requirement` 绑定恒判 stale。
    facts,
  );
}

/**
 * plan b2d7f4e9 §3.2：successor 出生按当前输入重生成的候选（`buildFeatureScopeCandidate`，由
 * `resolveSuccessorExecutionScope` 在内存里生成、不写回 feature.yaml）走同一个 resolver、同一套核验：
 *  ① 候选里失效的满足依据（含定义类的输入绑定）**剔除而不是整份拒绝**——失效即该义务未覆盖、责任阶段重做；
 *  ② 按当前输入先解析一次得本次义务；每条 required 义务取上一份**可信**完成记录里其责任阶段的证据引用作
 *     `satisfied_by`，核验走 `collectResolvedScopeFacts` 的阶段证据检查（`executionScopeEvidenceIssues`），核不过即剔除；
 *  ③ 评估入口 `assessFeature` 对这份范围判 uncovered 的义务（CU 绑定失配、阶段结果失效等证据检查看不见的）撤回复用。
 * 结果：无满足依据的 required 义务的责任阶段进 `phase_chain`，其余进 `reused_phases`。
 * 已知上限：出生只排「此刻」uncovered 的阶段；上游重跑后下游证据才失效的，由完成判定暴露、再起 successor。
 */
export function resolveWithPriorEvidence(
  input: ExecutionScopeInput,
  workflow: WorkflowSpec,
  ctx: { projectRoot: string; feature: string; frameworkRoot: string; requirement?: string; requirementSha?: string; manifestFidelity?: FidelityTarget },
): ExecutionScope {
  const { projectRoot, feature, frameworkRoot } = ctx;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { assessFeature } = require('./feature-assessment') as typeof import('./feature-assessment');
  const { resolveChangeUnitExpectedExecution } = require('./change-unit-completion') as typeof import('./change-unit-completion');
  const { FEATURE_COMPLETION_FILENAME } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const resolve = (): ExecutionScope => {
    let facts = collectResolvedScopeFacts(input, ctx);
    const stale = facts.satisfied_by.filter(entry => !entry.ok);
    if (stale.length) {
      for (const fact of input.facts) {
        const drop = stale.filter(entry => entry.obligation_id === fact.id).map(entry => entry.ref_index);
        if (!drop.length || !fact.satisfied_by) continue;
        const kept = fact.satisfied_by.filter((_, index) => !drop.includes(index));
        if (kept.length) fact.satisfied_by = kept; else delete fact.satisfied_by;
      }
      facts = collectResolvedScopeFacts(input, ctx);
    }
    return resolveExecutionScope(input, workflow, readScopeAcceptance(projectRoot, input, { feature, frameworkRoot }), facts);
  };
  const expected = resolveChangeUnitExpectedExecution(projectRoot, feature, false, frameworkRoot);
  const first = resolve();
  if (assessFeature(projectRoot, feature, { ...expected, frameworkRoot }).record.state === 'ok') {
    const projection = JSON.parse(fs.readFileSync(featureFilePath(projectRoot, feature, FEATURE_COMPLETION_FILENAME), 'utf8')) as { original_path: string };
    const original = JSON.parse(fs.readFileSync(path.join(projectRoot, projection.original_path), 'utf8')) as FeatureCompletion;
    const proofs = new Map(original.phases.filter(item => item.evidence_manifest_aggregate).map(item => [item.phase,
      { phase: item.phase, ...(item.run_id ? { run_id: item.run_id } : {}), evidence_manifest_aggregate: item.evidence_manifest_aggregate! }]));
    for (const obligation of first.obligations) {
      const proof = proofs.get(obligation.owner_phase);
      if (obligation.applicability !== 'required' || obligation.satisfied_by?.length || !proof) continue;
      const fact = input.facts.find(item => item.id === obligation.id);
      if (fact) fact.satisfied_by = [proof];
      else {
        const { owner_phase: _owner, ...rest } = structuredClone(obligation);
        input.facts.push({ ...rest, satisfied_by: [proof] });
      }
    }
  }
  let scope = resolve();
  // 覆盖按本次最终需求判：需求变了，按旧需求闭环的阶段结果 requirement lineage 即 stale → 撤回复用、责任阶段入链。
  const uncovered = new Set(assessFeature(projectRoot, feature, { ...expected, frameworkRoot, scope, ...(ctx.requirementSha ? { requirementSha: ctx.requirementSha } : {}) })
    .obligations.filter(item => item.status === 'uncovered').map(item => item.id));
  const withdrawn = input.facts.filter(fact => fact.satisfied_by?.length && uncovered.has(fact.id));
  if (withdrawn.length) {
    for (const fact of withdrawn) delete fact.satisfied_by;
    scope = resolve();
  }
  return scope;
}

// ---------------------------------------------------------------------------
// D0.1 reading layer: resolve every fact the pure resolver needs, so the resolver
// itself keeps zero `fs` / `projectRoot` (plan §4.1.0).
// ---------------------------------------------------------------------------

// The ONLY providers whose bindings may be verified by `dependencies[]` bytes alone (no parsed
// value in a freeze context, so `content_fingerprint` cannot be recomputed) live in
// `DEPENDENCY_ONLY_PROVIDER_IDS` (capability-resolution.ts) — an allow-list shared with the
// completion side, not "everything that is not a parsed-value provider" (review B7).
const relPosix = (projectRoot: string, abs: string): string => path.relative(projectRoot, abs).replace(/\\/g, '/');

/**
 * Verify one `basis` binding.
 *
 * Two shapes, deliberately different (plan §4.1.0):
 *  - artifact sources and the parsed-value derive providers go through `readBoundInput`,
 *    which checks P1 re-parse + `dependencies[].sha256` + `content_fingerprint`;
 *  - `derive.codebase` / `derive.test-targets` have **no parsed value** in a freeze context
 *    (`capability-resolution.ts:335-339` returns `{state:'resolved'}` without `value`), so
 *    comparing `content_fingerprint` is meaningless and `readBoundInput` would always throw.
 *    These are verified by their `dependencies[]` bytes only.
 *
 * This exemption is for `basis` (and `request.impact.basis`) ONLY — never for `satisfied_by`.
 */
function verifyBasisBinding(projectRoot: string, frameworkRoot: string, feature: string, binding: InputBinding, skipContentCheck = false, requirement?: string | null, legacyRoot?: string): { ok: boolean; detail: string } {
  const at = (dep: { path: string }): string => resolveDependencyPath(projectRoot, dep.path, legacyRoot);
  // `derive.requirement` 的解析值就是需求文本本身（`capability-resolution.ts:273-276`），
  // 所以重解析时必须把**同一份**需求文本交回去；否则该 provider 落到 feature 分支，
  // 只返回摘要不返回 value，`readBoundInput` 必判 stale。两处文本不同 = 候选与出生请求
  // 不是一回事，这时判 stale 正是想要的行为。
  const requirementContext = binding.source.kind === 'derive' && binding.source.provider_id === 'derive.requirement' && requirement?.trim()
    ? { requirement: requirement.trim(), inputContext: { schema_version: '1.1' as const, subject: { feature }, obligations: {}, required_outputs: [] } }
    : {};
  const byDependencies = binding.source.kind === 'derive' && DEPENDENCY_ONLY_PROVIDER_IDS.has(binding.source.provider_id);
  // Project containment is checked for EVERY shape, including the artifact branch: `readBoundInput`
  // re-resolves content but accepts an extra out-of-project dependency that matches its own digest
  // (review B7). Existence is checked as CONSISTENCY, not as "every dependency must exist": a
  // binding aggregates the dependencies of all resolution attempts (`capability-resolution.ts:599`),
  // so a blueprint-derived binding legitimately records the absent physical artifact — demanding
  // existence there would reject every blueprint source, which D0.1 explicitly allows as a basis.
  for (const dep of binding.dependencies) {
    if (!isInsideProjectRoot(projectRoot, at(dep))) return { ok: false, detail: `${binding.input_id}: 依据不在项目内 ${dep.path}` };
    if (fs.existsSync(at(dep)) !== dep.exists) return { ok: false, detail: `${binding.input_id}: 依据存在性变化 ${dep.path}` };
  }
  // 它不该拦住谁：**手上没有需求文本**的只读投影（`resolveChangeUnitExpectedExecution` 的 CU
  // 交接预判）。`derive.requirement` 的解析值就是那段文本，没有对照物就无从比对——依赖项的
  // 项目内与存在性一致性上面已经查过，内容比对留给真正带 `--requirement` 的出生冻结（两个
  // 出生入口都带，见 `goal-mode-entry.ts:103` / `goal-phase-runtime.ts:4564`）。
  if (binding.source.kind === 'derive' && binding.source.provider_id === 'derive.requirement' && !requirement?.trim()) {
    return { ok: true, detail: `${binding.input_id}: 无需求文本可比对（只读投影，不做内容重解析）` };
  }
  try {
    // The content exemption never crosses the provider boundary: a source that HAS a parsed value
    // is always re-resolved through P1 (review B7). Only the no-parsed-value providers can be
    // judged by their dependencies, and even then the source must be real and digest-verifiable.
    if (!byDependencies) {
      readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'spec', track: 'full', ...requirementContext }, binding, legacyRoot);
      return { ok: true, detail: `${binding.input_id}: re-resolved` };
    }
    const present = binding.dependencies.filter(dep => dep.exists);
    // All dependencies absent = nothing was ever observed. Without this, a binding naming a file
    // that does not exist passes existence-consistency, skips every digest and counts as a source.
    if (!present.length) return { ok: false, detail: `${binding.input_id}: 依据没有任何真实来源` };
    for (const dep of present) {
      // An existing dependency with no usable digest cannot be verified at all — that is a failure,
      // not a pass (the old `dep.sha256 &&` guard let a null digest through silently).
      if (!/^[0-9a-f]{64}$/.test(String(dep.sha256))) return { ok: false, detail: `${binding.input_id}: 依据缺少有效摘要 ${dep.path}` };
    }
    if (skipContentCheck) {
      // Birth-time observation (plan §4.1.0 rule 1): the responsible phase is expected to rewrite
      // these very bytes, so only the byte comparison is skipped — the provider boundary, the real
      // source and the digest structure above all still had to hold.
      return { ok: true, detail: `${binding.input_id}: birth-time observation (content not re-compared)` };
    }
    for (const dep of present) {
      if (createHash('sha256').update(fs.readFileSync(at(dep))).digest('hex') !== dep.sha256) {
        return { ok: false, detail: `${binding.input_id}: 依据字节已变化 ${dep.path}` };
      }
    }
    return { ok: true, detail: `${binding.input_id}: dependencies verified (no parsed value for ${(binding.source as { provider_id: string }).provider_id})` };
  } catch (error) {
    return { ok: false, detail: `${binding.input_id}: ${(error as Error).message}` };
  }
}

/** `satisfied_by` bindings are proof that a duty is already met — always fully re-resolved. */
function verifySatisfiedByBinding(projectRoot: string, frameworkRoot: string, feature: string, phase: string, binding: InputBinding, legacyRoot?: string, authorityReaders?: IdentityNeutralDigestReaders): { ok: boolean; detail: string } {
  for (const dep of binding.dependencies) {
    if (!isInsideProjectRoot(projectRoot, resolveDependencyPath(projectRoot, dep.path, legacyRoot))) return { ok: false, detail: `${binding.input_id}: 依据不在项目内 ${dep.path}` };
  }
  try {
    readBoundInput({ projectRoot, frameworkRoot, feature, phase, track: 'full', authorityReaders }, binding, legacyRoot);
    return { ok: true, detail: `${binding.input_id}: re-resolved` };
  } catch (error) {
    return { ok: false, detail: `${binding.input_id}: ${(error as Error).message}` };
  }
}

/**
 * Assemble every already-resolved fact the pure resolver consumes (plan §4.1.0 R1–R4).
 * Shared by Goal birth, the D1 first freeze, the checker-side revision budget and the
 * runtime revision — one fact vocabulary for all four.
 */
type ScopeFactsContext = { projectRoot: string; feature: string; frameworkRoot: string; currentRunId?: string; requirement?: string | null;
    manifestFidelity?: FidelityTarget;
    /** requested_results may support the existing UI heuristic, but is not a fidelity requirement. */
    requirementIsFallback?: boolean;
    /** Identifies an authorized prior judgment. A negative CU judgment can renew only its own non-UI source bytes. */
    impactInherited?: boolean; currentPhasePass?: string };

export function collectResolvedScopeFacts(input: ExecutionScopeInput, ctx: ScopeFactsContext): ResolvedScopeFacts {
  const { projectRoot, feature, frameworkRoot } = ctx;
  // plan b2d7f4e9 t4：候选/有效范围里的记录依赖可能写于另一个工程根，读侧按同一份记录推出的旧根重定位。
  const legacyRoot = inferLegacyProjectRoot(projectRoot, input) ?? (ctx.currentRunId ? (() => {
    const { loadFrozenExecutionScope } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    return inferLegacyProjectRoot(projectRoot, loadFrozenExecutionScope(projectRoot, feature, ctx.currentRunId));
  })() : undefined);
  const relDep = (dep: { path: string }): string => relPosix(projectRoot, resolveDependencyPath(projectRoot, dep.path, legacyRoot));
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { loadFidelityIntentSsotState, resolveUiRelevanceForRun, dereferenceRequirementDocs, resolveFidelityRoutingDecision, computeRequirementShaFromText } = require('./fidelity-shared') as typeof import('./fidelity-shared');
  const { uiSpecAbsPath, loadUiSpecFile } = require('./ui-spec-shared') as typeof import('./ui-spec-shared');
  const { executionScopeEvidenceIssues } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const ssot = loadFidelityIntentSsotState(projectRoot, feature);
  const fidelity: ResolvedScopeFacts['fidelity'] = {
    state: ssot.state === 'valid' ? 'valid' : ssot.state === 'corrupt' ? 'corrupt' : 'missing',
    ...(ssot.state === 'valid' ? { selected_fidelity: ssot.doc.selected_fidelity } : {}),
    // "Does the request/blueprint carry a visual requirement?" uses the SAME function
    // goal-preflight and goal-runner already share (`resolveUiRelevanceForRun`), precisely so a
    // third reading never appears: spec.md present => its `ui_change` field decides
    // (UI_CHANGE_REQUIRES_UI_SPEC); spec.md absent => fall back to the requirement-text
    // heuristic `detectUiRelevantRequirement`.
    // `requirement` source per call site — see each caller's comment.
    visual_requested: resolveUiRelevanceForRun(projectRoot, feature, ctx.requirement ?? null),
    // Existing single read point for the visual acceptance artifact (`ui-spec-shared.ts`), so a
    // `pixel_1to1` decision without it becomes a spec-owned definition gap instead of silently
    // leaving the visual duty undefined.
    // plan e7a2c4f1 §3.4（G30）：判据是"在场**且可读**"，不是 `fs.existsSync`。一份坏掉/空的
    // ui-spec.yaml 让视觉义务的**定义**悬空，与文件缺失同类——沿同一条 definition-gap 出口
    // （`execution-scope.ts` 的 `acceptance-definition:visual`，applicability=unknown，spec 可
    // 执行去填），不降成 WARN、不新开出口。解析复用既有唯一 loader（含形状归一化）。
    visual_acceptance_present: loadUiSpecFile(uiSpecAbsPath(projectRoot, feature)) !== null,
  };
  if (ssot.state === 'missing' && ctx.requirement?.trim() && !ctx.requirementIsFallback) {
    const featuresDirRel = relFeaturesDir(projectRoot);
    const deref = dereferenceRequirementDocs(projectRoot, ctx.requirement, {
      featuresDirRel, excludePrefixes: [`${featuresDirRel}/${featureRelativePath(feature)}/`],
    });
    const manifest = ctx.currentRunId
      ? (require('./goal-manifest') as typeof import('./goal-manifest')).loadGoalManifestFromRun(projectRoot, ctx.currentRunId, { feature }) : undefined;
    // Only selected is consumed; capability/defer and signing remain the runtime preflight's job.
    const routing = resolveFidelityRoutingDecision({ requirementText: deref.combined, manifestFidelity: ctx.manifestFidelity ?? manifest?.fidelity,
      capability: { hasVision: false, ocrAvailable: false }, executionIdentity: ctx.currentRunId ?? `phase:${feature}:spec`,
      requirementSha: computeRequirementShaFromText(projectRoot, feature, ctx.requirement, featuresDirRel) ?? '',
    });
    Object.assign(fidelity, { state: 'valid', selected_fidelity: routing.selected });
  }

  // Target sets the impact relevance check runs against (§4.1.3). Paths stay project-relative.
  const derivePaths = (predicate: (fact: ExecutionScopeInput['facts'][number]) => boolean): string[] => [...new Set(input.facts.filter(predicate)
    .flatMap(fact => fact.basis.flatMap(binding => binding.dependencies.filter(dep => dep.role === 'derive').map(relDep))))];
  let contracts: ContractsSpec | undefined;
  let contractsFiles: string[] = [];
  let contractsDetail = 'no contracts binding in candidate';
  const contractsBinding = input.facts.flatMap(fact => fact.basis).find(binding => binding.source.kind === 'artifact'
    ? binding.source.artifact === 'contracts@1'
    : binding.source.provider_id === 'derive.blueprint-contracts');
  if (contractsBinding) {
    try {
      contracts = readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'plan', track: 'full' }, contractsBinding, legacyRoot) as ContractsSpec;
      if (Array.isArray(contracts?.files)) contractsFiles = contracts.files.filter((f): f is string => typeof f === 'string').map(f => f.replace(/\\/g, '/'));
      contractsDetail = `contracts read ok, files=${contractsFiles.length}`;
    } catch (error) {
      // Surfaced in the relevance detail rather than swallowed: an unreadable construction
      // contract is the usual reason a legitimate impact basis looks "unrelated".
      contractsDetail = `contracts unreadable: ${(error as Error).message}`;
    }
  }
  const targets: ResolvedScopeFacts['targets'] = {
    implementation_files: derivePaths(fact => fact.kind === 'implementation'),
    contracts_files: contractsFiles,
    review_targets: derivePaths(fact => fact.kind === 'code-review'),
    ut_targets: derivePaths(fact => fact.kind === 'unit-evidence'),
  };
  const hasImplementation = input.facts.some(fact => fact.kind === 'implementation' && fact.applicability === 'required');
  const allowed = new Set<string>([
    ...targets.contracts_files,
    ...(hasImplementation ? targets.implementation_files : []),
    ...(hasImplementation ? [] : [...targets.review_targets, ...targets.ut_targets]),
  ]);

  const inheritedCuNegative = ctx.impactInherited === true && feature.startsWith('cu-')
    && input.request.impact?.user_visible_behavior_change === false;
  const original = Array.isArray(input.request.impact?.basis) ? input.request.impact.basis : [];
  const renewed = [...original];
  let nonUi: boolean | undefined;
  const impact_basis = original.map((binding, index) => {
    let verdict = verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, ctx.impactInherited === true && !inheritedCuNegative, ctx.requirement, legacyRoot);
    const paths = binding.dependencies.map(relDep);
    const related = paths.some(file => allowed.has(file));
    if (!verdict.ok && related && inheritedCuNegative && contracts && binding.source.kind === 'derive'
        && binding.source.provider_id === 'derive.codebase' && binding.input_id === 'codebase'
        && binding.dependencies.every(dep => dep.role === 'derive' && dep.exists)
        && verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, true, ctx.requirement, legacyRoot).ok
        && (nonUi ??= nonUiCuWriteSet(projectRoot, contracts, allowed))) {
      // Bind the same files to their current bytes. An external observation in the same binding must still match.
      const current = candidateBinding({ projectRoot, frameworkRoot, feature }, 'plan', 'codebase', paths);
      const observations = new Map(current?.dependencies.map(dep => [relDep(dep), dep]));
      if (current?.source.kind === 'derive' && current.source.provider_id === 'derive.codebase'
          && observations.size === paths.length && binding.dependencies.every((old, i) => {
        const seen = observations.get(paths[i]);
        return seen?.role === 'derive' && seen.exists && /^[0-9a-f]{64}$/.test(seen.sha256 ?? '')
          && (seen.sha256 === old.sha256 || (allowed.has(paths[i]) && contractsFiles.includes(paths[i])));
      })) {
        renewed[index] = current;
        verdict = { ok: true, detail: 'codebase: verified current CU sources' };
      }
    }
    return { input_id: binding.input_id, ok: verdict.ok, related, detail: `${verdict.detail}${related ? '' : ` | 目标集合=${[...allowed].join(',') || '空'} | ${contractsDetail}`}` };
  });
  if (input.request.impact && renewed.some((binding, i) => binding !== original[i])
      && impact_basis.every(result => result.ok && result.related)) {
    input.request.impact = { ...input.request.impact, basis: renewed };
  }

  // Both basis kinds go through the same function (plan §4.1.0). Code observations of the kinds
  // the completion side already exempts keep their path / containment checks but are not
  // byte-compared: the responsible phase is about to rewrite exactly those files.
  const basis: ResolvedScopeFacts['basis'] = [];
  // 请求级 provenance：候选声称自己是为这句需求算的——用**同一个**核验函数重解析，结论走
  // 同一个 `basis` 通道（resolver 对任一 not-ok 拒绝冻结），不另建第二套校验。
  const provenance = input.request.requirement_basis;
  if (provenance) {
    // 先认形态再核内容：`verifyBasisBinding` 只问「这条绑定还成立吗」，同一 feature 的
    // **合法** contracts@1 绑定放在这里也能重解析成功，于是换需求也不 stale。需求 provenance
    // 只能是需求那条绑定本身，形态不对直接判不通过（不另建校验通道，结论仍走 basis）。
    const canonical = provenance.input_id === 'requirement'
      && provenance.source.kind === 'derive' && provenance.source.provider_id === 'derive.requirement';
    basis.push({ obligation_id: 'request:requirement', input_id: provenance.input_id,
      ...(canonical
        ? verifyBasisBinding(projectRoot, frameworkRoot, feature, provenance, false, ctx.requirement, legacyRoot)
        : { ok: false, detail: `${provenance.input_id}: 需求 provenance 必须是 derive.requirement 解析出的 requirement 绑定` }) });
  }
  for (const fact of input.facts) {
    for (const binding of fact.basis) {
      const birthObservation = EXECUTION_SOURCE_KINDS.has(fact.kind) && binding.dependencies.every(dep => dep.role === 'derive');
      basis.push({ obligation_id: fact.id, input_id: binding.input_id, ...verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, birthObservation, ctx.requirement, legacyRoot) });
    }
  }

  const satisfied_by: ResolvedScopeFacts['satisfied_by'] = [];
  for (const fact of input.facts) {
    (fact.satisfied_by ?? []).forEach((ref, ref_index) => {
      if ('input_id' in ref) {
        const verdict = verifySatisfiedByBinding(projectRoot, frameworkRoot, feature, 'spec', ref, legacyRoot);
        satisfied_by.push({ obligation_id: fact.id, ref_index, ...verdict });
        return;
      }
      // Phase evidence reuse: reuse the completion-side checker so the freeze-time and the
      // verify-time rules are literally the same function.
      const probe = { ...structuredClone(fact), owner_phase: ref.phase, satisfied_by: [ref] };
      // 单义务探针可能只剩源码路径，不能再从它自己猜旧工程根；继承本次完整输入已核出的根。
      for (const binding of probe.basis) for (const dependency of binding.dependencies) {
        dependency.path = resolveDependencyPath(projectRoot, dependency.path, legacyRoot);
      }
      const issues = executionScopeEvidenceIssues(projectRoot, feature, {
        schema_version: '1.0', completion_target: input.request.completion_target, requested_results: [...input.request.requested_results],
        obligations: [probe], phase_chain: [], reused_phases: [], unresolved: [], policy_fingerprint: '0'.repeat(64),
      } as ExecutionScope, new Set([fact.id]), ctx.currentRunId, undefined, frameworkRoot, ctx.currentPhasePass);
      satisfied_by.push({ obligation_id: fact.id, ref_index, ok: issues.length === 0, detail: issues.join('; ') || `${ref.phase}@${ref.run_id}: evidence verified` });
    });
  }
  return { fidelity, impact_basis, basis, satisfied_by, targets, impact_targets_available: allowed.size > 0,
    // A definition gap delays relevance. Keep the verified original judgment so the owner can
    // check it again when targets exist; the resolver keeps device work unresolved meanwhile.
    ...(inheritedCuNegative && (!impact_basis.length || impact_basis.some(entry => !entry.ok || (allowed.size > 0 && !entry.related)))
      ? { inherited_impact_unusable: true } : {}) };
}

/** Resolve the admitted UI and route landings shared by positive and negative CU impact decisions. */
function mappedCuUiPaths(projectRoot: string, unit: NonNullable<ContractsSpec['change_unit']>, writeSet: ReadonlySet<string>): string[] {
  const normalize = (file: string): string => normalizeContractFilePath(projectRoot, file, 'CU impact');
  const { blueprint } = loadCanonicalBlueprint(projectRoot, unit.change_unit_ref.blueprint_id);
  return unit.design_ref_mappings.flatMap(({ design_ref: ref, implementation_refs }) => {
    if (!['node', 'flow'].includes(ref.target.kind)) return [];
    const target = resolveBlueprintTarget(blueprint, ref.target);
    const local = asRecord(target.contracts);
    const references = local && resolveContractFileReferences(projectRoot, local as unknown as ContractsSpec);
    const routes = new Set(selectContractReferencePaths(references, 'navigation.config_files'));
    const ui = [target, ...asRecords(local?.components)].filter(entry => isUiComponent(entry) || entry.kind === 'route')
      .flatMap(entry => typeof entry.file === 'string' ? [{ file: normalize(entry.file), name: entry.name }] : []);
    return implementation_refs.flatMap(landing => {
      const [rawFile, symbol] = landing.replace(/^planned:/, '').split('#');
      const file = normalize(rawFile);
      return writeSet.has(file) && (routes.has(file) || ui.some(entry => entry.file === file && (!symbol || symbol === entry.name))) ? [file] : [];
    });
  });
}

function nonUiCuWriteSet(projectRoot: string, contracts: ContractsSpec, allowed: ReadonlySet<string>): boolean {
  if (!contracts.change_unit || !contracts.files?.length) return false;
  try {
    const routes = selectContractReferencePaths(resolveContractFileReferences(projectRoot, contracts), 'navigation.config_files');
    if (routes.some(file => allowed.has(file)) || mappedCuUiPaths(projectRoot, contracts.change_unit, allowed).length) return false;
    const components = asRecords(contracts.components);
    if (components.some(entry => isUiComponent(entry) && typeof entry.file === 'string'
      && allowed.has(normalizeContractFilePath(projectRoot, entry.file, 'CU impact')))) return false;
    for (const relative of allowed) {
      const file = normalizeContractFilePath(projectRoot, relative, 'CU impact');
      const absolute = path.join(projectRoot, file);
      const source = file.endsWith('.ets') && fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
      if (isUiSensitiveFile(file, source)) return false;
    }
    return true;
  } catch { return false; } // An unreadable write set cannot justify carrying a negative impact forward.
}

/** Rebind only an existing positive judgment to verified, explicitly mapped CU UI/route files. */
export function resolveChangeUnitImpactFacts(input: ExecutionScopeInput, ctx: ScopeFactsContext, allowRebind = true,
  priorScope?: ExecutionScope): ResolvedScopeFacts {
  const facts = collectResolvedScopeFacts(input, ctx);
  const impact = input.request.impact;
  if (!allowRebind || !ctx.feature.startsWith('cu-') || input.request.completion_target !== 'feature'
    || impact?.user_visible_behavior_change !== true || !facts.impact_targets_available
    || facts.impact_basis.length && facts.impact_basis.every(entry => entry.ok && entry.related)) return facts;

  let paths: string[];
  const { projectRoot, frameworkRoot, feature } = ctx;
  const constructionContext = { projectRoot, frameworkRoot, feature };
  try {
    const source = candidateInput(constructionContext, 'plan', 'contracts');
    if (!source) return facts;
    const contracts = source.value as ContractsSpec;
    if (authorityGapOf(ctx, 'contracts', source) || !contracts.change_unit) return facts;
    const normalize = (file: string): string => normalizeContractFilePath(ctx.projectRoot, file, 'CU impact');
    const writeSet = new Set((contracts.files ?? []).map(normalize));
    // A successor renews the exact grounded targets first, including non-UI implementation.
    // A stale target that belonged to the prior run cannot be traded for another mapped file.
    const original = priorScope?.request_impact?.basis;
    const oldRoot = priorScope && inferLegacyProjectRoot(projectRoot, priorScope);
    const oldPath = (dependency: { path: string }) => relPosix(projectRoot, resolveDependencyPath(projectRoot, dependency.path, oldRoot));
    const originalPaths = original?.every(binding => binding.source.kind === 'derive' && binding.source.provider_id === 'derive.codebase'
      && binding.dependencies.every(dep => dep.role === 'derive' && dep.exists && /^[0-9a-f]{64}$/.test(dep.sha256 ?? '')))
      ? [...new Set(original.flatMap(binding => binding.dependencies.map(oldPath)))] : [];
    const renewOriginal = originalPaths.length > 0 && originalPaths.every(file => writeSet.has(file));
    const priorTargets = new Set(priorScope?.obligations.filter(fact => ['implementation', 'code-review', 'unit-evidence'].includes(fact.kind))
      .flatMap(fact => fact.basis.flatMap(binding => binding.dependencies.filter(dep => dep.role === 'derive').map(oldPath))) ?? []);
    if (!renewOriginal && originalPaths.some(file => priorTargets.has(file))) return facts;
    if (renewOriginal) paths = originalPaths;
    else {
      const mapped = mappedCuUiPaths(projectRoot, contracts.change_unit, writeSet);
      paths = [...new Set(mapped)].filter(file => {
        try { return fs.statSync(path.resolve(ctx.projectRoot, file)).isFile(); } catch { return false; }
      }).sort();
    }
  } catch { return facts; } // The existing scope/plan checks own invalid construction inputs.
  const binding = paths.length ? candidateBinding(constructionContext, 'plan', 'codebase', paths) : undefined;
  if (!binding) return facts;
  const rebound = { ...impact, basis: [binding] };
  const next = collectResolvedScopeFacts({ ...input, request: { ...input.request, impact: rebound } }, { ...ctx, impactInherited: false });
  if (!next.impact_basis.every(entry => entry.ok && entry.related)) return facts;
  input.request.impact = rebound;
  return next;
}

/** Re-read the selected acceptance source through P1; never scan history or write artifacts. */
export function readScopeAcceptance(projectRoot: string, input: Pick<ExecutionScopeInput, 'facts'>, context: { feature: string; frameworkRoot: string; authorityReaders?: IdentityNeutralDigestReaders }): { value: AcceptanceSpec; binding: InputBinding } | undefined {
  const bindings = input.facts.flatMap(fact => fact.basis);
  const binding = bindings.find(binding => binding.source.kind === 'artifact' && binding.source.artifact === 'acceptance@1')
    ?? bindings.find(binding => binding.source.kind === 'derive' && binding.source.provider_id === 'derive.blueprint-acceptance');
  if (!binding) return undefined;
  const legacyRoot = inferLegacyProjectRoot(projectRoot, input);
  if (binding.dependencies.some(dep => !isInsideProjectRoot(projectRoot, resolveDependencyPath(projectRoot, dep.path, legacyRoot)))) throw new Error('[execution-scope] acceptance source outside project');
  const value = readBoundInput({ ...context, projectRoot, phase: 'spec', track: 'full' }, binding, legacyRoot) as AcceptanceSpec;
  return { value, binding };
}

// ---------------------------------------------------------------------------
// D0.2 — 候选范围生成入口（机器负责绑定 / 指纹 / 派生；主 Agent 只给四项输入）
// ---------------------------------------------------------------------------

export interface PrepareScopeCandidateInput {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  /** 主 Agent 四项职责之一：完成终点。 */
  completionTarget: 'request' | 'feature';
  /** 之二：请求结果（要交付什么）。 */
  requestedResults: string[];
  /** 之三：明确的请求动作（改代码 / 只验证 / 完整交付），落为 requested_phases。 */
  requestedPhases: string[];
  /** 之四：影响判断（含来源路径）；缺省 = 不给判断（device 义务保持 unknown）。 */
  impact?: { userVisibleBehaviorChange: boolean; reason: string; basisPaths: string[] };
  /** Existing immutable judgment from the authorizing run; retain its digest until verified. */
  inheritedImpact?: ScopeImpactJudgement;
  /** The successor can renew concrete sources observed by its predecessor. */
  priorScope?: ExecutionScope;
  /**
   * 需求文本：与 `--prepare-run` 用的是同一份（视觉相关性由它判定）。缺省才回落
   * `requestedResults`——两处不同源会让候选与出生时的 visual 结论对不上。
   */
  requirement?: string;
  /** `resolveRequirementInput().sources`; provenance only, never a second text snapshot. */
  requirementSourceFiles?: string[];
  /** 候选已存在且内容不同时，显式覆盖。 */
  overwrite?: boolean;
}

export interface PrepareScopeCandidateResult {
  path: string;
  written: boolean;
  /** created 新建 / unchanged 同输入字节不变 / differs 与磁盘不一致且未给 --overwrite。 */
  state: 'created' | 'unchanged' | 'differs';
  candidate: ExecutionScopeInput;
  scope: ExecutionScope;
  /** 模板化说明（用户可见输出；纯投影，不调模型）。 */
  explanation: string;
}

/** Mechanical arguments for the existing candidate writer. */
export function prepareChangeUnitScopeInput(input: {
  projectRoot: string; frameworkRoot: string; changeUnit: ChangeUnitArtifact;
  requirement: string; requirementSourceFiles?: string[];
  requestedResults: string[]; requestedPhases: string[];
  obligations?: ExecutionScope['obligations'];
  impact?: PrepareScopeCandidateInput['impact']; inheritedImpact?: ScopeImpactJudgement; overwrite?: boolean;
}): PrepareScopeCandidateInput {
  return {
    projectRoot: input.projectRoot, frameworkRoot: input.frameworkRoot,
    feature: deriveChangeUnitFeatureId(input.changeUnit.blueprint_id, input.changeUnit.change_unit_id),
    completionTarget: 'feature',
    requirement: input.requirement,
    ...(input.requirementSourceFiles?.length ? { requirementSourceFiles: [...input.requirementSourceFiles] } : {}),
    requestedResults: [...input.requestedResults],
    requestedPhases: [...new Set([...input.requestedPhases, ...(input.obligations ?? [])
      .filter(obligation => obligation.applicability === 'required' && !obligation.satisfied_by?.length)
      .map(obligation => obligation.owner_phase)])],
    ...(input.impact ? { impact: structuredClone(input.impact) } : {}),
    ...(input.inheritedImpact ? { inheritedImpact: structuredClone(input.inheritedImpact) } : {}),
    ...(input.overwrite !== undefined ? { overwrite: input.overwrite } : {}),
  };
}

/** 候选里的每一条绑定都来自生产解析器——没有任何手写指纹、手写 basis 的余地。 */
/**
 * 两个定义类 kind（`design-context` / `acceptance-context`）的**唯一**派生点：生成器与冻结
 * 读取层共用同一份判定，把 D0.1「不采信候选自报、按来源重算」从 unit/device/visual 扩到它们。
 *
 * 定义从 contracts/acceptance 正式绑定派生；files 仅提供初始研究目标，不授予逐文件许可。
 */
function deriveDefinitionContext(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string },
  workflow: WorkflowSpec,
  requestedPhases: string[],
): {
  contracts?: InputBinding; acceptance?: InputBinding; writeSet: string[]; writeSetBinding?: InputBinding;
  wantsImplementation: boolean; designAvailable: boolean; acceptanceAvailable: boolean;
  /** plan c4e7a9b2 A1：手写产物与当前设计权威的对齐缺口（人读）；对齐 / 不适用为 undefined。 */
  acceptanceGap?: string; contractsGap?: string;
} {
  const contractsInput = candidateInput(ctx, 'plan', 'contracts');
  const acceptanceInput = candidateInput(ctx, 'ut', 'acceptance');
  const contracts = contractsInput?.binding;
  const acceptance = acceptanceInput?.binding;
  const implementationPhases = workflow.artifacts
    .filter(artifact => (OBLIGATION_PROVIDERS[artifact.obligation_provider_id ?? ''] ?? []).includes('implementation'))
    .map(artifact => artifact.id);
  const wantsImplementation = requestedPhases.some(phase => implementationPhases.includes(phase));
  const writeSet = wantsImplementation ? readCandidateWriteSet(ctx, contracts) : [];
  const existingWriteSet = writeSet.filter(file => {
    try { return fs.statSync(path.resolve(ctx.projectRoot, file)).isFile(); } catch { return false; }
  });
  const writeSetBinding = existingWriteSet.length ? candidateBinding(ctx, 'plan', 'codebase', existingWriteSet) : undefined;
  return {
    contracts, acceptance, writeSet, writeSetBinding, wantsImplementation,
    designAvailable: !!contracts,
    acceptanceAvailable: !!acceptance,
    acceptanceGap: authorityGapOf(ctx, 'acceptance', acceptanceInput),
    contractsGap: authorityGapOf(ctx, 'contracts', contractsInput, wantsImplementation || requestedPhases.some(phase => workflow.artifacts.some(artifact => artifact.id === phase && artifact.obligation_provider_id === 'obligations.plan'))),
  };
}

/**
 * plan c4e7a9b2 §3.1 A1：按 artifact 绑定的手写验收 / 设计（值取同一 P1 解析器的规范化结果）与当前规范化投影的对齐缺口。
 * 候选派生、修订重算与 `assessFeature` 共用；derive 来源的值本身就是投影，不比。
 */
export function definitionAuthorityGap(ctx: { projectRoot: string; frameworkRoot: string; feature: string }, kind: 'acceptance' | 'contracts'): string | undefined {
  return authorityGapOf(ctx, kind, candidateInput(ctx, kind === 'acceptance' ? 'ut' : 'plan', kind));
}
function authorityGapOf(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string },
  kind: 'acceptance' | 'contracts',
  input: { binding: InputBinding; value: unknown } | undefined,
  needsConstruction = true,
): string | undefined {
  if (!input) return undefined;
  const drift = input.binding.source.kind === 'artifact'
    ? describeAuthoritativeDrift(authoritativeContentDrift(ctx.projectRoot, ctx.feature, ctx.frameworkRoot, kind, input.value), kind)
    : undefined;
  if (drift || kind !== 'contracts' || !needsConstruction || !ctx.feature.startsWith('cu-')) return drift;
  const { resolveChangeUnitConstructionInputs } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
  const candidate = resolveChangeUnitConstructionInputs(ctx.projectRoot, ctx.feature, ctx.frameworkRoot, input.value as ContractsSpec);
  if (candidate.gap) return candidate.gap;
  return undefined; // The shared candidate reader already checked the same projection.
}

/**
 * 冻结时按来源重算候选里**已有**的两条定义类事实。手写一条 `acceptance-context: unknown`
 * 伪造缺口、借此把 §4.1.3 子情形 (a) 的 fail-closed 顶掉，这里当场被重算回 `required`。
 *
 * 它不该拦住谁：① 验收/设计**确实不存在**时，手写结果与机器派生一致，照常进 definition-gap；
 * ② 视觉缺口 `acceptance-definition:visual` 是另一个 kind、本来就是机器派生，不受影响；
 * ③ 候选里合法的人工补充（impact、requested_phases）不在重算范围内——那是 D0.2 幂等规则
 * （手改报差异、显式覆盖）的职责，这里不做整份候选比对。
 *
 * 出生（`resolveFeatureExecutionScope`）与两条修订路径（R3 设计事实提案、R4 runtime 修订）
 * 都在**各自的 proposal 副本**上调用它——否则修订输入照样能携带自报的 unknown 把
 * `definitionGapPending` 伪造出来。它只改这两个 kind，不读也不写已冻结的 manifest / 出生范围。
 *
 * `onlyTighten`（修订路径固定为 true）：**只把假缺口收紧成真责任，不做降级**。降级是出生
 * 路径的职责——那里生成与冻结走的是同一个 `deriveDefinitionContext`，两者必然一致；而修订
 * 发生在真实阶段上下文里（蓝图投影、run-bound 快照、本轮刚产出的产物），它们的解析面比这里
 * 的独立探针更全，按探针的「解析不出来」去降级会凭空造出假缺口、把已兑现的责任判成被删除
 * （实测：`blueprint-skill-projection` 的 P2 验收用例当场变成「设计修订静默删除冻结义务」）。
 */
export function recomputeDefinitionFacts(
  input: ExecutionScopeInput,
  ctx: { projectRoot: string; frameworkRoot: string; feature: string },
  workflow: WorkflowSpec,
  onlyTighten = false,
): void {
  const derived = deriveDefinitionContext(ctx, workflow, input.request.requested_phases);
  for (const fact of input.facts) {
    if (fact.kind !== 'design-context' && fact.kind !== 'acceptance-context') continue;
    const design = fact.kind === 'design-context';
    const available = design ? derived.designAvailable : derived.acceptanceAvailable;
    const binding = design ? derived.contracts : derived.acceptance;
    if (available && binding) {
      // 只重算**结论**与它的来源。`satisfied_by`（这条责任已被谁兑现）不在重算范围内：
      // 「产物在场」不等于「责任已了结」——修订里由 spec/plan 重新产出的定义责任正是
      // 「产物在场但必须重做」，代它写一份满足证明会把责任阶段直接从链上抹掉。
      fact.applicability = 'required';
      fact.basis = [binding];
      fact.reason = design ? '已有设计可用' : '已有验收可用';
      // A1：手写产物与当前设计权威不一致 → 责任仍在、未兑现（出生与修订共用，防修订输入带回满足证明）。
      const gap = design ? derived.contractsGap : derived.acceptanceGap;
      if (gap) { delete fact.satisfied_by; fact.reason = gap; }
    } else {
      // 来源不可用 → **无条件**清掉满足证明（含 `onlyTighten` 的修订路径）：那份「证明」
      // 同样是自报，留着会让 `execution-scope.ts` 把这条责任当成「已兑现」而跳过责任阶段。
      delete fact.satisfied_by;
      // 降级本身只在出生路径做：修订路径的解析面比这里的探针更全，按探针降级会造出假缺口。
      if (!onlyTighten) {
        fact.applicability = 'unknown';
        fact.reason = design
          ? (derived.contracts ? '设计来源不可核验' : '本 feature 尚无可解析的设计来源')
          : '本 feature 尚无可解析的验收来源';
      }
    }
  }
  const implementationBasis = derived.writeSetBinding ?? derived.contracts;
  if (derived.wantsImplementation && implementationBasis) {
    const implementation = input.facts.find(fact => fact.kind === 'implementation');
    const update = {
      applicability: 'required' as const,
      reason: '本次请求包含改代码',
      basis: [implementationBasis],
    };
    if (implementation) Object.assign(implementation, update);
    else input.facts.push({ id: 'implementation:request', kind: 'implementation', ...update });
  }
}

function candidateBinding(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string; requirement?: string; requirementSourceFiles?: string[] },
  phase: string,
  inputId: string,
  testTargets: string[] = [],
): InputBinding | undefined {
  return candidateInput(ctx, phase, inputId, testTargets)?.binding;
}

function candidateInput(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string; requirement?: string; requirementSourceFiles?: string[] },
  phase: string,
  inputId: string,
  testTargets: string[] = [],
): { binding: InputBinding; value: unknown } | undefined {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { resolveCapabilityInputs } = require('./capability-resolution') as typeof import('./capability-resolution');
  /* eslint-enable @typescript-eslint/no-require-imports */
  try {
    const value = resolveCapabilityInputs({
      projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, feature: ctx.feature, phase, track: 'full',
      ...(testTargets.length ? { testTargets } : {}),
      ...(ctx.requirement ? { requirement: ctx.requirement } : {}),
      ...(ctx.requirementSourceFiles?.length ? { requirementSourceFiles: ctx.requirementSourceFiles } : {}),
      inputContext: { schema_version: '1.1', subject: { feature: ctx.feature }, obligations: {}, required_outputs: [] },
    }).inputs?.values?.[inputId];
    return value && value.state === 'resolved' ? { binding: value.binding, value: value.value } : undefined;
  } catch {
    return undefined;
  }
}

/** Reparse only still-valid inputs; content/authority changes remain the original owner's work. */
export function refreshScopeBindingInput(ctx: { projectRoot: string; frameworkRoot: string; feature: string; requirement?: string },
  previous: ExecutionScope): ExecutionScopeInput | undefined {
  const legacyRoot = inferLegacyProjectRoot(ctx.projectRoot, previous);
  const comparison = scopeAtProjectRoot(ctx.projectRoot, previous, legacyRoot);
  let changed = false;
  const facts = structuredClone(comparison.obligations);
  const refresh = (binding: InputBinding, phase: string): InputBinding => {
    if (binding.source.kind === 'derive' && ['derive.codebase', 'derive.test-targets', ...DEPENDENCY_ONLY_PROVIDER_IDS].includes(binding.source.provider_id)) return binding;
    try { readBoundInput({ ...ctx, phase, track: 'full' }, binding, legacyRoot); } catch { return binding; }
    const current = candidateInput(ctx, phase, binding.input_id)?.binding;
    if (!current || JSON.stringify(current.source) !== JSON.stringify(binding.source)) return binding;
    if (executionScopeFingerprint(current) !== executionScopeFingerprint(binding)) { changed = true; return current; }
    return binding;
  };
  for (const fact of facts) {
    fact.basis = fact.basis.map(binding => refresh(binding, fact.owner_phase));
    fact.satisfied_by = fact.satisfied_by?.map(proof => 'input_id' in proof ? refresh(proof, fact.owner_phase) : proof);
  }
  const candidate = scopeWithRefreshedBindings(previous, facts);
  if (changed && hasNewSourcedFact(comparison, facts, '')) return candidate;
  if (ctx.feature.startsWith('cu-') && previous.request_impact?.user_visible_behavior_change === false
    && collectResolvedScopeFacts(candidate, { ...ctx, impactInherited: true }).inherited_impact_unusable) return candidate;
  return undefined;
}

function scopeWithRefreshedBindings(previous: ExecutionScope, facts: ExecutionScopeInput['facts']): ExecutionScopeInput {
  return { request: { completion_target: previous.completion_target, requested_results: [...previous.requested_results],
    requested_phases: executionCompletionPhases(previous), ...(previous.request_impact ? { impact: structuredClone(previous.request_impact) } : {}) },
    facts, contract_fingerprints: [], ...(previous.control_edges ? { control_edges: structuredClone(previous.control_edges) } : {}) };
}

function artifactAcceptanceBindings(facts: ExecutionScopeInput['facts']): InputBinding[] {
  return facts.flatMap(fact => fact.basis).filter(binding => binding.source.kind === 'artifact' && binding.source.artifact === 'acceptance@1');
}

export function hasStaleContractsScopeProof(ctx: { projectRoot: string; frameworkRoot: string; feature: string }, previous: ExecutionScope): boolean {
  const legacyRoot = inferLegacyProjectRoot(ctx.projectRoot, previous);
  return previous.obligations.some(fact => fact.kind === 'design-context' && fact.satisfied_by?.some(ref => 'input_id' in ref
    && !verifySatisfiedByBinding(ctx.projectRoot, ctx.frameworkRoot, ctx.feature, fact.owner_phase, ref, legacyRoot).ok));
}

/** A proposal from an unrelated correction must not launder a changed acceptance file. */
export function assertScopeAcceptanceRevision(ctx: { projectRoot: string; frameworkRoot: string; feature: string },
  previous: ExecutionScope, next: ExecutionScope, owned: ExecutionScopeInput | undefined, checkedSpec?: ExecutionScopeInput): void {
  if (!ctx.feature.startsWith('cu-')) return;
  const before = artifactAcceptanceBindings(previous.obligations)[0];
  if (!before) return;
  const after = artifactAcceptanceBindings(next.obligations)[0];
  const legacyRoot = inferLegacyProjectRoot(ctx.projectRoot, previous);
  const admitted = owned && artifactAcceptanceBindings(owned.facts)[0];
  const matchesAdmitted = (binding: InputBinding): boolean => projectionContentEqual(admitted, {
    ...binding, dependencies: binding.dependencies.map(dep => ({ ...dep, path: resolveDependencyPath(ctx.projectRoot, dep.path, legacyRoot) })),
  });
  if (admitted && checkedSpec) {
    const checked = artifactAcceptanceBindings(checkedSpec.facts);
    if (!checked.length || checked.some(binding => !matchesAdmitted(binding))) {
      throw new Error('[execution-scope] spec 的验收提案与当前 CU 已签发交回的验收绑定不一致，责任方 spec');
    }
  }
  if (after && before.content_fingerprint === after.content_fingerprint) return;
  if (after && admitted && matchesAdmitted(after)) return;
  try {
    readBoundInput({ ...ctx, phase: 'spec', track: 'full' }, before, legacyRoot);
  } catch {
    throw new Error('[execution-scope] 验收内容变化缺少当前 CU 已签发责任方的适用交回');
  }
}

/** An author can add structural evidence anchors. Replacing an approved value requires the current design authority. */
function keepsAcceptanceCommitments(previous: AcceptanceSpec, current: unknown, authority: unknown): boolean {
  const old = asRecord(previous), next = asRecord(current), approved = asRecord(authority);
  if (!old || !next || !approved || compareAuthoritativeContent(approved, next).state !== 'aligned') return false;
  const keepsFields = (before: Record<string, unknown>, after: Record<string, unknown>, basis: Record<string, unknown>, additions: string[]): boolean => {
    const tier = after.ut_layer !== before.ut_layer && after.ut_layer === basis.ut_layer ? after.ut_layer : undefined;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].every(field => projectionContentEqual(before[field], after[field])
      || after[field] !== undefined && (before[field] === undefined && additions.includes(field)
        || basis[field] !== undefined && projectionContentEqual(basis[field], after[field]))
      || after[field] === undefined && basis[field] === undefined && (tier === 'unit' && field === 'device_focus' || tier === 'device' && field === 'ut_focus'));
  };
  const definitions = ['criteria', 'boundaries', 'performance'];
  const metadata = (doc: Record<string, unknown>) => Object.fromEntries(Object.entries(doc).filter(([field]) => field !== 'source' && !definitions.includes(field)));
  if (!keepsFields(metadata(old), metadata(next), metadata(approved), ['flows'])) return false;
  for (const field of definitions) {
    const rows = asRecords(next[field]);
    const byId = new Map(rows.map(row => [row.id, row]));
    if (byId.size !== rows.length) return false;
    const declared = new Map(asRecords(approved[field]).map(row => [row.id, row]));
    for (const before of asRecords(old[field])) {
      const after = byId.get(before.id);
      if (!after || before.priority !== after.priority
        || !keepsFields(before, after, declared.get(before.id) ?? {}, ['checkpoint', 'requirement_ref'])) return false;
      byId.delete(before.id);
    }
    if ([...byId.keys()].some(id => !declared.has(id))) return false;
  }
  return true;
}

function matchesProducedComponentIndex(projectRoot: string, feature: string, events: readonly GoalRunEvent[],
  relative: string, before: string | null, after: string | null): boolean {
  const productions = new Map<string, { phase: string; before: unknown; after: unknown }>();
  for (const event of events) {
    const record = event as Record<string, unknown>;
    if (event.type !== 'phase_write_observed' || !event.phase || !event.invoke_id
      || record.feature !== feature || record.producer !== 'component-index') continue;
    for (const row of asRecords(record.produced).filter(row => row.path === relative)) {
      const first = productions.get(event.invoke_id);
      productions.set(event.invoke_id, { phase: event.phase, before: first ? first.before : row.pre_sha256, after: row.post_sha256 });
    }
  }
  let expected = before;
  let advanced = false;
  for (const [invokeId, production] of productions) {
    if (!advanced && production.before !== expected) continue;
    if (typeof production.after !== 'string' || !isProducedPhaseChange(projectRoot, production.phase,
      { path: relative, how: expected === null ? 'added' : 'modified', preSha256: expected, postSha256: production.after },
      { events, invokeId })) return false;
    expected = production.after;
    advanced = true;
  }
  return advanced && expected === after;
}

/** Rebind the admitted CU's acceptance after the exact authorized author settles, before requiring spec PASS. */
export function refreshOwnedAcceptanceScopeInput(ctx: { projectRoot: string; frameworkRoot: string; feature: string; requirement?: string; runId: string; runDir: string },
  previous: ExecutionScope, events: readonly GoalRunEvent[]): ExecutionScopeInput | undefined {
  if (!ctx.feature.startsWith('cu-')) return undefined;
  const prior = artifactAcceptanceBindings(previous.obligations)[0];
  if (!prior) return undefined;
  const { projectRoot, frameworkRoot, feature, runId, runDir } = ctx;
  const legacyRoot = inferLegacyProjectRoot(projectRoot, previous);
  const acceptance = resolveFeatureArtifact(projectRoot, feature, 'acceptance.yaml');
  if (!acceptance.exists) return undefined;
  const file = acceptance.actualPath;
  const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
  const before = prior.dependencies.find(dep => dep.role === 'artifact' && resolveDependencyPath(projectRoot, dep.path, legacyRoot) === file)?.sha256;
  const after = sha256File(file);
  if (!before || !after || before === after) return undefined;
  try { readBoundInput({ ...ctx, phase: 'spec', track: 'full' }, prior, legacyRoot); return undefined; } catch { /* Inspect the exact observed transition. */ }
  const current = candidateInput(ctx, 'ut', 'acceptance');
  if (!current || !projectionContentEqual(current.binding.source, prior.source)
    || !current.binding.dependencies.some(dep => dep.path === file && dep.sha256 === after)) return undefined;
  const changedInputs = prior.dependencies.flatMap(dep => {
    const absolute = resolveDependencyPath(projectRoot, dep.path, legacyRoot);
    return absolute !== file && (fs.existsSync(absolute) !== dep.exists || dep.exists && sha256File(absolute) !== dep.sha256) ? [{ ...dep, path: absolute }] : [];
  });
  const observed = createObservedSourceHashReader(projectRoot, feature, { frameworkRoot, runId, ownershipEvents: events, includeAuthorArtifacts: true });
  if (observed({ path: relative, role: 'input', sha256: before, exists: true }, 'scope')?.sha256 !== after) return undefined;
  try {
    const observedSource = createObservedSourceHashReader(projectRoot, feature, { frameworkRoot, runId, ownershipEvents: events });
    const designInputs = changedInputs.filter(dep => {
      if (!isInsideProjectRoot(projectRoot, dep.path)) return true;
      const relative = relPosix(projectRoot, dep.path);
      const hash = sha256File(dep.path);
      if (dep.path === componentIndexPath(projectRoot)) return !matchesProducedComponentIndex(projectRoot, feature, events, relative, dep.sha256, hash);
      const source = observedSource({ path: relative, role: 'input', exists: dep.exists, sha256: dep.sha256 }, 'scope');
      return !source || source.sha256 !== hash || source.exists !== fs.existsSync(dep.path);
    });
    let expected = before;
    let originalRequest: SessionExecutionRequest | undefined;
    let last: { request: SessionExecutionRequest; start: GoalRunEvent } | undefined;
    for (const [at, event] of events.entries()) {
      if (event.type !== 'phase_write_observed' || !event.invoke_id) continue;
      const observation = event as Record<string, unknown>;
      const writes = asRecords(observation.owned).filter(row => row.path === relative && row.pre_sha256 !== row.post_sha256);
      if (!writes.length || !originalRequest && writes[0].pre_sha256 !== expected) continue;
      const [write] = writes;
      if (writes.length !== 1 || write.pre_sha256 !== expected || typeof write.post_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(write.post_sha256)) return undefined;
      const start = events.find(item => item.type === 'agent_invoke_start' && item.invoke_id === event.invoke_id);
      const issued = events.find(item => item.type === 'phase_start' && item.invoke_id === event.invoke_id && item.handoff_request) ?? start;
      const end = events.find(item => item.type === 'agent_invoke_end' && item.invoke_id === event.invoke_id);
      if (!start || !issued?.handoff_request || !end || start.phase !== event.phase || events.indexOf(issued) >= at
        || events.indexOf(end) <= events.indexOf(start) || !invocationCompleted({ ...end, exitCode: end.exit_code })
        || events.some(item => item.type === 'phase_write_violation' && item.invoke_id === event.invoke_id)) return undefined;
      const request = readHandoffMaterial<SessionExecutionRequest>(runDir, issued.handoff_request);
      const boundary = request.write_boundary;
      if (request.invoke_id !== event.invoke_id || request.context.feature !== feature || request.context.runId !== runId
        || request.context.phase !== start.phase || request.context.owner.owner_id !== start.owner_id || request.context.owner.epoch !== start.owner_epoch
        || !boundary || path.resolve(boundary.projectRoot) !== path.resolve(projectRoot) || boundary.executionRole !== 'author'
        || !workUnitMayWritePath(boundary, relative) || resolvePhasePathOwnership(boundary, relative).owner !== 'spec'
        || observation.pre_snapshot !== request.pre_snapshot?.sha256
        || !request.pre_snapshot?.entries.some(entry => entry.path === relative && entry.kind === 'file' && entry.sha256 === expected)) return undefined;
      if (end.handoff_report) {
        if (end.handoff_report.request_sha256 !== issued.handoff_request.sha256) return undefined;
        const report = readHandoffMaterial<{ post_snapshot?: SessionExecutionRequest['pre_snapshot'] }>(runDir, end.handoff_report);
        if (report.post_snapshot?.sha256 !== observation.post_snapshot
          || !report.post_snapshot?.entries.some(entry => entry.path === relative && entry.kind === 'file' && entry.sha256 === write.post_sha256)) return undefined;
      }
      originalRequest ??= request;
      last = { request, start };
      expected = write.post_sha256;
    }
    if (!originalRequest || !last || expected !== after) return undefined;
    const { request, start } = last;
    const { blueprintId, changeUnitId } = parseChangeUnitFeatureId(feature);
    const unit = loadCanonicalChangeUnit(projectRoot, blueprintId, changeUnitId);
    if (designInputs.length) {
      const blueprint = loadCanonicalBlueprint(projectRoot, blueprintId);
      const design = events.slice(0, events.indexOf(start)).filter(event => event.type === 'design_authority_repair') as Array<GoalRunEvent & {
        blueprint_id?: string; stage?: string; new_revision?: number; outcome?: string; failed_step?: string; signature?: string;
        handoff_context?: import('./session-execution-handoff').HandoffReference;
      }>;
      const publication = [...design].reverse().find(event => event.blueprint_id === blueprintId && event.stage === 'published'
        && event.new_revision === blueprint.blueprint.revision && (event.outcome === 'recovered' || event.failed_step === 'probe'));
      const attempt = publication && design.slice(0, design.indexOf(publication)).reverse().find(event =>
        event.signature === publication.signature && event.stage === 'attempted' && event.handoff_context);
      if (!attempt?.handoff_context || sha256File(path.join(runDir, 'design-repair/component-blueprint.yaml')) !== sha256File(blueprint.canonicalPath)) return undefined;
      const previousDesign = readHandoffMaterial<{ baseline: string; cu?: string }>(runDir, attempt.handoff_context);
      const original = new Map([[blueprint.canonicalPath, previousDesign.baseline], [unit.canonicalPath, previousDesign.cu]]);
      if (designInputs.some(dep => {
        const bytes = original.get(dep.path);
        const relative = path.relative(projectRoot, dep.path).replace(/\\/g, '/');
        return !bytes || createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex') !== dep.sha256
          || !request.pre_snapshot?.entries.some(entry => entry.path === relative && entry.kind === 'file' && entry.sha256 === sha256File(dep.path));
      })) return undefined;
    }
    const authority = deriveBlueprintSkillInput(projectRoot, feature, frameworkRoot, 'acceptance');
    if (authority.state !== 'resolved') return undefined;
    let priorAcceptance = authority.value as AcceptanceSpec;
    if (originalRequest.acceptance_preimage) {
      const bytes = Buffer.from(originalRequest.acceptance_preimage, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== before) return undefined;
      const parsed = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, {
        context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] },
        phase: 'spec', values: {}, artifacts: { 'acceptance@1': YAML.parse(bytes.toString('utf8')) },
      });
      if (!parsed.acceptance || parsed.shape_issues?.length) return undefined;
      priorAcceptance = parsed.acceptance;
    }
    if (!artifactBindingMatches(ctx, prior, priorAcceptance) || !keepsAcceptanceCommitments(priorAcceptance, current.value, authority.value)
      || sha256File(file) !== after) return undefined;
    const replace = (binding: InputBinding): InputBinding => binding.source.kind === 'artifact' && binding.source.artifact === 'acceptance@1'
      ? current.binding : binding;
    const facts = structuredClone(previous.obligations);
    for (const fact of facts) {
      if (!fact.basis.some(binding => replace(binding) !== binding)) continue;
      fact.basis = fact.basis.map(replace);
      delete fact.satisfied_by;
    }
    return scopeWithRefreshedBindings(previous, facts);
  } catch { return undefined; }
}

/**
 * 生成 feature.yaml 的 execution_scope 候选，并用**同一个** resolver 投影结果。
 *
 * 机器负责：设计 / 验收绑定与 satisfied_by、写集来源、影响判断的来源绑定、全部指纹
 * （复用 resolveCapabilityInputs，与冻结时的重解析同源）；unit / device / visual 三类
 * 证据义务**不写进候选**——它们由 resolver 从验收分层与 fidelity SSOT 派生（D0.1：候选
 * 自报一律不采信，写了也会被原样覆盖）。code-review 同理由 resolver 的义务闭包补齐。
 */
export function prepareFeatureScopeCandidate(input: PrepareScopeCandidateInput): PrepareScopeCandidateResult {
  const { projectRoot, frameworkRoot, feature } = input;
  const candidate = buildFeatureScopeCandidate(input);
  // 同一个 resolver、同一份已解析事实——投影出来的就是冻结时会得到的结果。
  const scope = resolveExecutionScope(candidate, resolveWorkflowSpecForCandidate(projectRoot, frameworkRoot),
    readScopeAcceptance(projectRoot, candidate, { feature, frameworkRoot }),
    collectResolvedScopeFacts(candidate, { projectRoot, feature, frameworkRoot, requirement: input.requirement?.trim() || input.requestedResults.join('\n'), requirementIsFallback: !input.requirement?.trim() }));

  const abs = featureTrackDeclPath(projectRoot, feature);
  const existing = fs.existsSync(abs) ? (YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown> | null) ?? {} : {};
  const next = { ...existing, execution_scope: JSON.parse(JSON.stringify(candidate)) as unknown };
  const bytes = YAML.stringify(next);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
  const explanation = explainScope(scope);
  if (current === bytes) return { path: abs, written: false, state: 'unchanged', candidate, scope, explanation };
  if (current !== null && existing.execution_scope !== undefined && !input.overwrite) {
    return { path: abs, written: false, state: 'differs', candidate, scope, explanation };
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes, 'utf-8');
  return { path: abs, written: true, state: 'created', candidate, scope, explanation };
}

/**
 * D0.2 候选生成（纯内存、不写盘）：`--prepare-scope` 与 successor 出生（plan b2d7f4e9 §3.2 第 2 步，
 * `resolveSuccessorExecutionScope`）共用的唯一生成点。
 */
export function buildFeatureScopeCandidate(input: Omit<PrepareScopeCandidateInput, 'overwrite'>): ExecutionScopeInput {
  const { projectRoot, frameworkRoot, feature } = input;
  if (!input.requestedResults.length) throw new Error('[prepare-scope] --requested-results 必填（请求结果是主 Agent 的职责之一）');
  if (!input.requestedPhases.length) {
    throw new Error('[prepare-scope] 请求动作须由 --requested-phases 显式给出（改代码 → 含 coding；只补验证 → 只列验证阶段）——机器不猜动作');
  }
  const ctx = { projectRoot, frameworkRoot, feature };
  const workflow = resolveWorkflowSpecForCandidate(projectRoot, frameworkRoot);
  // 两个定义类事实的派生与冻结时**同一个函数**（`deriveDefinitionContext`）——生成的与
  // 冻结重算的必然一致，手写的那份则会被重算覆盖。
  const derived = deriveDefinitionContext(ctx, workflow, input.requestedPhases);
  const contracts = derived.contracts;
  const acceptance = derived.acceptance;
  // generic / 单职责 request / 合法存量的无蓝图兜底；design-lens 新完整交付已在公开出生入口分流。
  // 需求绑定同样走既有 resolver（`derive.requirement`，带 inputContext 时返回需求文本作解析值），
  // **不自造 provider**、不伪造蓝图。
  // provenance：**始终**生成需求绑定——它是「这份候选为哪句需求而算」的机器凭据，
  // 不只在缺产物时才有意义。缺设计 / 验收时它同时充当那两条缺口事实的来源。
  const requirementText = input.requirement?.trim() || input.requestedResults.join('\n');
  const requirementBinding = candidateBinding({ ...ctx, requirement: requirementText, requirementSourceFiles: input.requirementSourceFiles }, 'spec', 'requirement');
  if (!requirementBinding) throw new Error('[prepare-scope] 需求无法经 derive.requirement 解析为绑定——候选缺少 provenance，不生成');
  const gapBasis = [requirementBinding];
  const facts: ExecutionScopeInput['facts'] = [];
  // implementation **由请求动作决定**，不由 completion_target 决定：只有当请求里含实现
  // provider 的阶段时才产出，写集来源取契约声明的文件（D0.1 规则 (a) 要求可核验写集）。
  // 初始源码可为空；实现义务仍由有效契约给出来源。
  const wantsImplementation = derived.wantsImplementation;
  const writeSet = derived.writeSet;
  const writeSetBinding = derived.writeSetBinding;
  const implementationBasis = writeSetBinding ?? contracts;
  // A1（plan c4e7a9b2 §3.1）：手写产物与当前设计权威不一致时责任仍 required、不写 satisfied_by——责任阶段入链对齐，
  // 下游按链序等待；出生不拒绝。
  if (derived.designAvailable) facts.push({ id: 'design-context:candidate', kind: 'design-context', applicability: 'required', reason: derived.contractsGap ?? '已有设计可用', basis: [contracts!], ...(derived.contractsGap ? {} : { satisfied_by: [contracts!] }) });
  // 缺设计 ≠ 没有设计责任：落一条 unknown 的 design-context（owner=plan），由既有 definition-gap
  // 通路把下游（含 coding）挂进 needed_by，等设计阶段产出 contracts 后再由 D0.3/D2 同 run 补链。
  else facts.push({ id: 'design-context:pending', kind: 'design-context', applicability: 'unknown', reason: '本 feature 尚无可解析的设计来源（仅有需求）', basis: gapBasis });
  if (acceptance) facts.push({ id: 'acceptance-context:candidate', kind: 'acceptance-context', applicability: 'required', reason: derived.acceptanceGap ?? '已有验收可用', basis: [acceptance], ...(derived.acceptanceGap ? {} : { satisfied_by: [acceptance] }) });
  // 缺验收 ≠ 没有验收责任：落一条 unknown 的 acceptance-context（resolver 会把它送进
  // unresolved、owner=spec），不静默省略、也不伪造蓝图（需求 D0.2 原文）。
  else facts.push({ id: 'acceptance-context:pending', kind: 'acceptance-context', applicability: 'unknown', reason: '本 feature 尚无可解析的验收来源', basis: gapBasis });
  // 跳过设计时仍需有效契约；没有文件预测不构成设计缺口。
  const designPhases = workflow.artifacts
    .filter(artifact => ['obligations.spec', 'obligations.plan'].includes(artifact.obligation_provider_id ?? ''))
    .map(artifact => artifact.id);
  const requestsDesign = input.requestedPhases.some(phase => designPhases.includes(phase));
  if (wantsImplementation && !requestsDesign) {
    if (!contracts) throw new Error('[prepare-scope] 请求跳过设计阶段直接改代码，但缺少有效设计来源——责任方 plan');
    if (!implementationBasis) throw new Error('[prepare-scope] 设计或初始源码无法解析为项目内绑定：' + writeSet.join(', '));
    facts.push({ id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: '本次请求包含改代码', basis: [implementationBasis] });
  } else if (wantsImplementation && implementationBasis) {
    facts.push({ id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: '本次请求包含改代码', basis: [implementationBasis] });
  }
  const impactBasis = input.impact?.basisPaths.length ? candidateBinding(ctx, 'plan', 'codebase', input.impact.basisPaths) : undefined;
  if (input.impact && !impactBasis) throw new Error('[prepare-scope] --impact-basis 无法解析为项目内绑定（影响判断必须有可核验来源）');
  const candidate: ExecutionScopeInput = {
    request: {
      completion_target: input.completionTarget,
      requested_results: [...input.requestedResults],
      requested_phases: [...input.requestedPhases],
      requirement_basis: requirementBinding,
      ...(input.impact && impactBasis
        ? { impact: { user_visible_behavior_change: input.impact.userVisibleBehaviorChange, reason: input.impact.reason, basis: [impactBasis] } }
        : input.inheritedImpact ? { impact: structuredClone(input.inheritedImpact) } : {}),
    },
    facts,
    contract_fingerprints: loadFeatureContracts(frameworkRoot).map(contractFingerprint),
  };
  if (feature.startsWith('cu-') && candidate.request.impact) {
    // The new run needs current bytes even when the judgment came from an authorized prior run.
    const inherited = !!input.inheritedImpact && !input.impact;
    const inheritedNegative = inherited && candidate.request.impact.user_visible_behavior_change === false;
    if (inheritedNegative && input.priorScope) {
      // The new candidate already contains local bindings. Only the old signed scope can identify the former checkout.
      const previousRoot = inferLegacyProjectRoot(projectRoot, input.priorScope);
      if (previousRoot) relocateScopeBindings(projectRoot, [], candidate.request.impact, previousRoot);
    }
    const verified = resolveChangeUnitImpactFacts(candidate, { ...ctx, requirement: requirementText,
      impactInherited: inheritedNegative }, inherited, input.priorScope);
    if (verified.inherited_impact_unusable) delete candidate.request.impact;
  }
  return candidate;
}

/** 初始研究线索；不是权限或完成依据。 */
function readCandidateWriteSet(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string },
  contracts: InputBinding | undefined,
): string[] {
  if (!contracts) return [];
  try {
    const value = readBoundInput({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, feature: ctx.feature, phase: 'plan', track: 'full' }, contracts) as { files?: unknown };
    return Array.isArray(value?.files) ? value.files.filter((file): file is string => typeof file === 'string') : [];
  } catch {
    return [];
  }
}

function resolveWorkflowSpecForCandidate(projectRoot: string, frameworkRoot: string): WorkflowSpec {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { loadWorkflowSpec } = require('../../workflow-loader') as typeof import('../../workflow-loader');
  const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return loadWorkflowSpec(frameworkRoot, loadFrameworkConfig(projectRoot).active_workflow ?? 'spec-driven');
}

/** 模板化说明：纯投影，不调模型（需求 R2 的用户可见输出）。 */
function explainScope(scope: ExecutionScope): string {
  const reused = scope.reused_phases.map(reuse => reuse.phase);
  const device = scope.obligations.filter(obligation => obligation.kind === 'device-evidence');
  const deviceNote = device.some(obligation => obligation.applicability === 'required') ? '需要设备验证'
    : device.some(obligation => obligation.applicability === 'unknown') ? '设备义务待定（缺有来源的影响判断）'
    : '无设备义务';
  const parts = [
    reused.length ? '已有可复用的 ' + reused.join(' / ') + ' 结果' : '无可复用的既有结果',
    scope.phase_chain.length ? '本次执行 ' + scope.phase_chain.join(' → ') : '本次无需执行任何阶段（现有结果已覆盖请求）',
    deviceNote,
  ];
  if (scope.unresolved.length) {
    parts.push('待澄清：' + scope.unresolved.map(gap => gap.obligation_id + '（' + gap.owner + '）').join('、'));
  }
  return parts.join('；') + '。';
}

/**
 * D0.2 的机器体检：`--requested-phases` 缺席时，机器只呈现**既有阶段证据检查**的事实
 * （证据完整性 / 新鲜度 / 阶段 summary 的裁决与闭环态），不猜请求动作。
 */
export function featureScopePhaseHealth(
  projectRoot: string,
  frameworkRoot: string,
  feature: string,
): Array<{ phase: string; evidence_ok: boolean; freshness: string; verdict: string | null; closure_status: string | null }> {
  const workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot });
  const phases = workflow.artifacts.filter(artifact => artifact.scope === 'feature').map(artifact => artifact.id);
  return phases.map(phase => {
    const evidence = loadPhaseEvidenceManifest(projectRoot, feature, phase);
    const fresh = recomputePhaseEvidenceStaleness(projectRoot, feature, [phase], { frameworkRoot })[0];
    let verdict: string | null = null;
    let closure: string | null = null;
    try {
      const summaryPath = path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'summary.json');
      if (fs.existsSync(summaryPath)) {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as { verdict?: string; closure_status?: string };
        verdict = summary.verdict ?? null;
        closure = summary.closure_status ?? null;
      }
    } catch { /* 读不出就是读不出，如实报 null */ }
    return { phase, evidence_ok: evidence?.integrityOk === true, freshness: fresh?.verdict ?? 'unresolved', verdict, closure_status: closure };
  });
}

/**
 * 范围修订**提案校验的唯一实现**——run 路径（goal runtime）与 feature 路径（无 run 收尾）
 * 都调它，不各写一套（批次 3 第一轮阻断 6）。
 *
 * 它做的每一件事都来自 D2.3 / §4.1.0，顺序与原 runtime 内联实现逐行一致：
 *  ① 一次只允许一个提案（同一份报告里两条即拒）；
 *  ② 请求边界（completion_target / requested_results）不可改；
 *  ③ 已完成阶段的既有满足证明按当前证据补齐，**被主动撤销的不补**；
 *  ④ impact：`null` 即错、缺省即继承、修正必须自带新来源；
 *  ⑤ 定义类事实按来源重算（只收紧）、`satisfied_by` 失效项剔除后重解析；
 *  ⑥ 结果与当前有效范围**完全相同** → no-op（返回 null）；不同 → 必须站在新来源上，否则抛错。
 *
 * 载体差异只有一处：`currentRunId`（run 载体有、feature 载体没有）——它只影响
 * 「本轮新产生的阶段闭环证据算不算新事实」与补证明时写不写 run 身份，**不放宽任何判据**。
 */
export function readScopeProofHistory(input: {
  projectRoot: string; frameworkRoot: string; feature: string; workflow: WorkflowSpec; previous: ExecutionScope;
  currentRunId?: string; currentPhasePass?: string;
}) {
  const { projectRoot, frameworkRoot, feature } = input;
  const { loadFrozenExecutionScope, loadAuthoritativeRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const { readFeatureFrozenScope } = require('./feature-execution-scope') as typeof import('./feature-execution-scope');
  const record = input.currentRunId ? undefined : readFeatureFrozenScope(projectRoot, feature);
  const birth = input.currentRunId ? loadFrozenExecutionScope(projectRoot, feature, input.currentRunId) ?? input.previous : record?.execution_scope ?? input.previous;
  const events: ScopeHistoryEvent[] = input.currentRunId ? loadAuthoritativeRunEvents(projectRoot, feature, input.currentRunId) : record?.revisions ?? [];
  if (input.currentPhasePass) events.push({ type: 'phase_verdict', phase: input.currentPhasePass, verdict: 'PASS', action: 'advance' });
  const order = [...new Set([...(input.workflow.auto_chain ?? []), ...input.workflow.artifacts.map(a => a.id)])];
  const dependencies = readRepairDependencyContext(projectRoot, feature, input.workflow, input.previous, frameworkRoot);
  const history = scopeProofHistory(birth, events, order, undefined, input.workflow, dependencies);
  return { birth, events, dependencies, history };
}

export function resolveCurrentScopeView(input: {
  projectRoot: string; frameworkRoot: string; feature: string; workflow: WorkflowSpec; previous: ExecutionScope;
  currentRunId?: string; completedPhases?: ReadonlySet<string>; currentPhase?: string; reopen?: string; authorityReaders?: IdentityNeutralDigestReaders;
  currentResults?: import('./verify-feature-completion').CleanPassOptions['currentResults'];
}): ExecutionScope {
  input = { ...input, authorityReaders: input.authorityReaders
    ?? (require('./identity-neutral-digest') as typeof import('./identity-neutral-digest')).createIdentityNeutralDigestReaders() };
  const { projectRoot, frameworkRoot, feature } = input;
  const currentPhasePass = input.currentPhase && input.completedPhases?.has(input.currentPhase) ? input.currentPhase : undefined;
  const { birth, events, dependencies, history } = readScopeProofHistory({ ...input, currentPhasePass });
  const proofs = new Map<string, ScopeEvidenceRef>();
  const stale = new Set<string>();
  const { resolveCompletionDisposition, applicableCheckFamilies, executionScopeEvidenceFindings, resolvePhaseRunIds,
    currentScopeProofRunId } = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  const scopeFindings = input.currentRunId ? executionScopeEvidenceFindings(projectRoot, feature, input.previous,
    undefined, input.currentRunId, undefined, frameworkRoot, currentPhasePass, input.authorityReaders, input.workflow, history) : undefined;
  const disposition = resolveCompletionDisposition({ projectRoot, feature, chain: applicableCheckFamilies(input.previous),
    workflow: input.workflow, executionScope: input.previous, frameworkRoot, runId: input.currentRunId,
    pendingOwnerPhase: input.currentPhase, authorityReaders: input.authorityReaders, currentResults: input.currentResults, scopeFindings });
  const actualResults = [...new Set(input.previous.obligations.filter(obligation => obligation.applicability !== 'not_applicable')
    .map(obligation => obligation.owner_phase))].filter(phase => !!loadPhaseEvidenceManifest(projectRoot, feature, phase));
  const candidates = new Set([...history.passed, ...input.completedPhases ?? [], ...input.previous.reused_phases.map(p => p.phase), ...actualResults]);
  const invalidProofIds = new Set(scopeFindings?.filter(finding => finding.class === 'evidence').map(finding => finding.obligation_id));
  const priorRefs = input.previous.obligations.flatMap(obligation => (obligation.satisfied_by ?? [])
    .filter((ref): ref is ScopeEvidenceRef => !('input_id' in ref)).map(ref => ({ ref, obligationId: obligation.id })));
  const newProofs = new Map<string, string>();
  for (const phase of candidates) {
    const evidence = loadPhaseEvidenceManifest(projectRoot, feature, phase);
    // 新发现交真实责任方处理；它不等于来源阶段的证明字节已经过期。
    const fresh = evidence?.integrityOk && !phaseCompletionProblems(disposition, [phase]).some(problem =>
      !problem.id.startsWith('open_finding:') || (problem.owner ?? problem.phase) === phase);
    if (!fresh) { stale.add(phase); continue; }
    const eligible = phaseEvidenceIsCurrent({ fresh: !!fresh, generatedAt: evidence?.manifest.generated_at,
      invalidatedAt: history.invalidatedAt.get(phase) });
    if (eligible !== true || !evidence) continue;
    const aggregate = evidence.manifest.aggregate_sha256;
    if (!input.currentRunId) { proofs.set(phase, { phase, evidence_manifest_aggregate: aggregate }); continue; }
    const recorded = priorRefs.filter(({ ref }) => ref.phase === phase && ref.evidence_manifest_aggregate === aggregate);
    if (!recorded.length) newProofs.set(phase, aggregate);
    else if (recorded.some(({ obligationId }) => invalidProofIds.has(obligationId))) stale.add(phase);
    else proofs.set(phase, recorded[0].ref);
  }
  if (input.currentRunId && newProofs.size) {
    const producerRuns: Record<string, string | null> = {};
    try { Object.assign(producerRuns, resolvePhaseRunIds(projectRoot, feature, [...newProofs.keys()]).runIds); }
    catch {
      // A malformed invocation can invalidate one phase while other producers remain verifiable.
      for (const phase of newProofs.keys()) {
        try { Object.assign(producerRuns, resolvePhaseRunIds(projectRoot, feature, [phase]).runIds); }
        catch { producerRuns[phase] = null; }
      }
    }
    for (const [phase, aggregate] of newProofs) {
      const observed = producerRuns[phase];
      const producer = observed === undefined ? currentScopeProofRunId(projectRoot, feature, phase, input.currentRunId, events) : observed;
      if (producer) proofs.set(phase, { phase, run_id: producer, evidence_manifest_aggregate: aggregate });
      else stale.add(phase);
    }
  }
  const definitionProofs = new Map<string, readonly InputBinding[]>();
  const legacyRoot = inferLegacyProjectRoot(projectRoot, input.previous);
  for (const [id, refs] of history.definitionProofs) {
    const obligation = input.previous.obligations.find(item => item.id === id);
    if (!obligation || !refs.every(ref => verifySatisfiedByBinding(projectRoot, frameworkRoot, feature, obligation.owner_phase, ref, legacyRoot, input.authorityReaders).ok)) continue;
    if (phaseCompletionProblems(disposition, [obligation.owner_phase]).some(problem =>
      !problem.id.startsWith('open_finding:') || (problem.owner ?? problem.phase) === obligation.owner_phase)) continue;
    definitionProofs.set(id, refs);
  }
  return effectiveScopeView({ birth, events, workflow: input.workflow, proofs, definitionProofs, stalePhases: [...stale], reopen: input.reopen, inputOwners: dependencies.inputOwners, inputEdges: dependencies.inputEdges });
}

function relocateScopeBindings(projectRoot: string, facts: ExecutionScopeInput['facts'], impact: ExecutionScope['request_impact'], legacyRoot?: string): void {
  const relocate = (binding: InputBinding): void => {
    for (const dependency of binding.dependencies) dependency.path = resolveDependencyPath(projectRoot, dependency.path, legacyRoot);
  };
  for (const fact of facts) {
    fact.basis.forEach(relocate);
    for (const proof of fact.satisfied_by ?? []) if ('input_id' in proof) relocate(proof);
  }
  impact?.basis.forEach(relocate);
}

/** A checkout move gives no new source. The signed historical scope stays on disk verbatim. */
function scopeAtProjectRoot(projectRoot: string, scope: ExecutionScope, legacyRoot?: string): ExecutionScope {
  if (!legacyRoot) return scope;
  const copy = structuredClone(scope);
  relocateScopeBindings(projectRoot, copy.obligations, copy.request_impact, legacyRoot);
  return copy;
}

function repeatsOpenRepairScope(previous: ExecutionScope, resolved: ExecutionScope, candidates: readonly RepairCandidate[]): boolean {
  const { obligations: prior, ...signedFields } = previous;
  const { obligations: next, ...resolvedFields } = resolved;
  if (executionScopeFingerprint(signedFields) !== executionScopeFingerprint(resolvedFields) || prior.length !== next.length) return false;
  const byId = new Map(next.map(obligation => [obligation.id, obligation]));
  if (byId.size !== next.length || new Set(prior.map(obligation => obligation.id)).size !== prior.length) return false;
  const movable = new Set<string>();
  for (const before of prior) {
    const after = byId.get(before.id);
    if (!after) return false;
    const current = before.applicability === 'required' && !before.satisfied_by?.length && before.basis.length
      ? candidates.filter(candidate => before.id === `${before.kind}:${candidate.id}`) : [];
    const reason = current.some(candidate => after.reason === scopeRepairReason(before.owner_phase, candidate)) ? before.reason : after.reason;
    if (executionScopeFingerprint(before) !== executionScopeFingerprint({ ...after, reason })) return false;
    // The definition finding's codebase binding records what triggered the repair.
    // Keep authority-bearing bindings and ordered execution targets in their original positions.
    if (current.length && (before.kind === SCOPE_REVISION_FACT_KIND.spec || before.kind === SCOPE_REVISION_FACT_KIND.plan)
      && before.basis.every(binding => binding.input_id === 'codebase' && binding.source.kind === 'derive'
        && binding.source.provider_id === 'derive.codebase' && binding.dependencies.every(dependency => dependency.role === 'derive'))) movable.add(before.id);
  }
  return prior.every((before, index) => {
    const after = next[index];
    return before.id === after.id || movable.has(before.id) && movable.has(after.id)
      && before.owner_phase === after.owner_phase && before.kind === after.kind;
  });
}

export function resolveScopeRevisionProposal(input: {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  workflow: WorkflowSpec;
  proposals: readonly ExecutionScopeInput[];
  previous: ExecutionScope;
  /**
   * 请求动作的**授权边界＝出生／冻结链**（不是 `previous.phase_chain`——后者是已应用修订后的
   * 有效链，会随义务被满足而缩短甚至变空，拿它当边界会把「同一份合法提案再收一次尾」判成越权）。
   * `ExecutionScope` 没有 `requested_phases` 字段，故由调用方把冻结那一份链传进来。
   */
  authorizedPhases: readonly string[];
  repairCandidates?: readonly RepairCandidate[];
  completedPhases?: ReadonlySet<string>;
  currentPhase?: string;
  currentRunId?: string;
  requirement?: string;
  currentResults?: import('./verify-feature-completion').CleanPassOptions['currentResults'];
}): { scope: ExecutionScope; input: ExecutionScopeInput } | null {
  if (input.proposals.length > 1) throw new Error('[execution-scope] multiple revision proposals');
  if (!input.proposals.length) return null;
  const { projectRoot, frameworkRoot, feature, workflow, previous } = input;
  const proposal = structuredClone(input.proposals[0]) as ExecutionScopeInput;
  const { loadFrozenExecutionScope } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const { readFeatureFrozenScope } = require('./feature-execution-scope') as typeof import('./feature-execution-scope');
  const featureRecord = input.currentRunId ? undefined : readFeatureFrozenScope(projectRoot, feature);
  const birth = input.currentRunId ? loadFrozenExecutionScope(projectRoot, feature, input.currentRunId) : featureRecord?.execution_scope;
  const legacyRoot = inferLegacyProjectRoot(projectRoot, previous) ?? inferLegacyProjectRoot(projectRoot, birth);
  // Resolve copied dependencies against the current checkout before re-reading their evidence.
  relocateScopeBindings(projectRoot, proposal.facts, proposal.request.impact, legacyRoot);
  const comparison = scopeAtProjectRoot(projectRoot, previous, legacyRoot);
  const priorImpact = comparison.request_impact;
  proposal.contract_fingerprints = loadFeatureContracts(frameworkRoot).map(contractFingerprint);
  proposal.control_edges ??= structuredClone(previous.control_edges);
  if (proposal.request.completion_target !== previous.completion_target
    || JSON.stringify(proposal.request.requested_results) !== JSON.stringify(previous.requested_results)) {
    throw new Error('[execution-scope] revision changes request boundary');
  }
  // plan a9f3c7d2 第二笔：request 终点是单职责请求——修订只能关闭本阶段的定义缺口，
  // **不得把新阶段塞进请求动作**。边界取**冻结授权链**（见 `authorizedPhases` 注释）。
  if (proposal.request.requested_phases.some(phase => !authorizedScopePhases(birth ?? previous, workflow).includes(phase))) {
    throw new Error('[execution-scope] request-scope revision cannot add phases');
  }
  const progress = resolveCurrentScopeView(input);
  const { loadAuthoritativeRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const control = readScopeRevisionUserControl(previous, proposal, input.currentRunId ? {
    projectRoot, feature, runId: input.currentRunId, events: loadAuthoritativeRunEvents(projectRoot, feature, input.currentRunId), completedPhases: input.completedPhases,
    failedPhases: new Set((input.currentResults ?? []).filter(result => result.checks.some(check => isBlockingCheck(check)
      && !['externalBlocked', 'framework_internal'].includes(check.blocking_class ?? ''))).map(result => result.phase)),
  } : undefined);
  if (control.source) proposal.request.user_control = control.source;
  else delete proposal.request.user_control;
  const repairFactIds = new Set(proposal.facts.filter(fact => (input.repairCandidates ?? []).some(candidate => fact.id.endsWith(`:${candidate.id}`))).map(fact => fact.id));
  for (const obligation of previous.obligations) {
    if (obligation.applicability !== 'required') continue;
    if (control.allowedSubtractions.has(obligation.id)) {
      const declared = proposal.facts.find(fact => fact.id === obligation.id && fact.kind === obligation.kind);
      if (declared) declared.applicability = obligation.applicability;
      else proposal.facts.push(structuredClone(obligation));
      continue;
    }
    const existing = proposal.facts.find(fact => fact.id === obligation.id);
    const effective = progress.obligations.find(item => item.id === obligation.id)!;
    if (!existing) proposal.facts.push(structuredClone(effective));
    else if (acceptsDefinitionInputProof(existing.kind) && existing.satisfied_by?.length && existing.satisfied_by.every(ref => 'input_id' in ref)) {
      // The owner supplied a definition binding; the common binding validator below judges it.
    }
    else if (repairFactIds.has(existing.id) && !existing.satisfied_by?.length) {
      // A current trusted finding reopens its owner even if the last recorded scope predates its PASS.
    }
    else if (!obligation.satisfied_by?.length || existing.satisfied_by?.length
      || existing.kind === obligation.kind && existing.applicability === obligation.applicability
        && executionScopeFingerprint(existing.basis) === executionScopeFingerprint(obligation.basis)) {
      if (effective.satisfied_by?.length) existing.satisfied_by = structuredClone(effective.satisfied_by);
      else delete existing.satisfied_by;
    }
  }
  const order = [...new Set([...(workflow.auto_chain ?? []), ...workflow.artifacts.map(a => a.id)])];
  const nextDuties = proposal.facts.map(fact => ({ ...fact, owner_phase: workflow.artifacts.find(a => (OBLIGATION_PROVIDERS[a.obligation_provider_id ?? ''] ?? []).includes(fact.kind))?.id ?? '' }));
  const revoked = new Set(scopeRevisionInvalidations(progress, { obligations: nextDuties }, order, undefined, workflow, readRepairDependencyContext(projectRoot, feature, workflow, progress, frameworkRoot)));
  for (const fact of proposal.facts) if (revoked.has(nextDuties.find(o => o.id === fact.id)!.owner_phase)) delete fact.satisfied_by;
  if (proposal.request.impact === null) throw new Error('[execution-scope] 影响判断为 null——请给出判断或不要携带该字段');
  if (proposal.request.impact === undefined) proposal.request.impact = structuredClone(priorImpact);
  // A stored pre-revision check can still carry the original request judgment after we have rebound it.
  const birthImpact = birth?.request_impact && scopeAtProjectRoot(projectRoot, birth, legacyRoot).request_impact;
  if (feature.startsWith('cu-') && proposal.request.impact && birthImpact
    && executionScopeFingerprint(proposal.request.impact) === executionScopeFingerprint(birthImpact)) {
    proposal.request.impact = structuredClone(priorImpact);
  }
  const impactInherited = proposal.request.impact === undefined
    || (priorImpact !== undefined
      && executionScopeFingerprint(proposal.request.impact) === executionScopeFingerprint(priorImpact));
  if (!impactInherited && !(proposal.request.impact?.basis ?? []).some(binding => !previous.obligations.some(obligation => obligation.basis.some(prior => executionScopeFingerprint(prior) === executionScopeFingerprint(binding)))
    && !(priorImpact?.basis ?? []).some(prior => executionScopeFingerprint(prior) === executionScopeFingerprint(binding)))) {
    throw new Error('[execution-scope] impact correction requires its own new sourced basis');
  }
  const currentPhasePass = input.currentPhase && input.completedPhases?.has(input.currentPhase) ? input.currentPhase : undefined;
  const ctx = { projectRoot, feature, frameworkRoot, ...(input.currentRunId ? { currentRunId: input.currentRunId } : {}), ...(input.requirement ? { requirement: input.requirement } : {}), impactInherited, currentPhasePass };
  recomputeDefinitionFacts(proposal, { projectRoot, feature, frameworkRoot }, workflow, true);
  const formerImpact = proposal.request.impact;
  let facts = resolveChangeUnitImpactFacts(proposal, ctx, impactInherited);
  const impactRebound = formerImpact !== proposal.request.impact;
  const stale = facts.satisfied_by.filter(entry => !entry.ok
    && !('input_id' in (proposal.facts.find(fact => fact.id === entry.obligation_id)?.satisfied_by?.[entry.ref_index] ?? { input_id: '' })));
  if (stale.length) {
    for (const fact of proposal.facts) {
      const drop = stale.filter(entry => entry.obligation_id === fact.id).map(entry => entry.ref_index);
      if (!drop.length || !fact.satisfied_by) continue;
      const kept = fact.satisfied_by.filter((_, index) => !drop.includes(index));
      if (kept.length) fact.satisfied_by = kept; else delete fact.satisfied_by;
    }
    facts = collectResolvedScopeFacts(proposal, impactRebound ? { ...ctx, impactInherited: false } : ctx);
  }
  const resolved = applyScopeUserControl(resolveExecutionScope(proposal, workflow, readScopeAcceptance(projectRoot, proposal, { feature, frameworkRoot }), facts), workflow, control);
  assertRevisionKeepsRequiredObligations(previous, resolved, control.allowedSubtractions);
  if (resolved.phase_chain.some(phase => !authorizedScopePhases(birth ?? previous, workflow).includes(phase))) throw new Error('[execution-scope] request-scope revision cannot add phases');
  // A fresh qualified owner proof must be recorded even when this proposal already
  // describes the live progress view. Only the recorded scope is the no-op baseline.
  if (executionScopeFingerprint(resolved) === executionScopeFingerprint(previous)) return null;
  const confirmedRepair = input.repairCandidates?.some(candidate => {
    const fact = proposal.facts.find(item => repairFactIds.has(item.id) && item.id.endsWith(':' + candidate.id) && item.applicability === 'required');
    return (candidate.files.length > 0 || candidate.category === 'coding') && !!fact?.basis.length && !previous.obligations.some(item => item.id === fact.id);
  });
  const reopened = proposal.facts.some(fact => repairFactIds.has(fact.id)
    && !fact.satisfied_by?.length && progress.obligations.some(prior => prior.id === fact.id && prior.satisfied_by?.length));
  // A current trusted finding is new knowledge; its unchanged product file need not be rewritten to earn recovery.
  if (!control.newSource && !impactRebound && !facts.inherited_impact_unusable && !hasNewSourcedFact(comparison, proposal.facts, input.currentRunId ?? '') && !confirmedRepair && !reopened
    && !previous.obligations.some(prior => prior.satisfied_by?.length && !progress.obligations.find(o => o.id === prior.id)?.satisfied_by?.length)) {
    const current = (input.repairCandidates ?? []).filter(candidate => repairCandidateCanReviseScope(candidate)
      && (!input.currentPhase || candidate.source_phase === input.currentPhase));
    if (repeatsOpenRepairScope(comparison, resolved, current)) return null;
    throw new Error('[execution-scope] revision requires new sourced facts');
  }
  return { scope: resolved, input: proposal };
}
