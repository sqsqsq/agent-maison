import { resolveExecutionScope, executionScopeFingerprint, EXECUTION_SOURCE_KINDS, OBLIGATION_PROVIDERS, type ExecutionScope, type ExecutionScopeInput, type ResolvedScopeFacts } from './execution-scope';
import { createHash } from 'crypto';
import * as path from 'path';
import type { WorkflowSpec } from '../../workflow-loader';
import type { AcceptanceSpec } from './types';
import { readBoundInput, type InputBinding } from './capability-resolution';
import { isInsideProjectRoot } from './project-relative-path';
import { loadEffectiveExecutionScope } from './goal-run-creation';
import { loadFeatureContracts, contractFingerprint } from './skill-contract';
import { loadPhaseEvidenceManifest, recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';
import { hasNewSourcedFact } from './execution-scope';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { inferRepoLayout } from '../../repo-layout';
// ============================================================================
// feature-track.ts — feature.yaml 的 track 声明读取（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// feature 级档位声明落盘于 <features_dir>/<feature>/feature.yaml（路径一律经
// paths.features_dir 解析，禁止硬编码 doc/features/——round7 path-governance）。
// 文件缺失 / 解析失败 / 未声明 → null（resolveFeatureTrack 解释为 full，默认零变化）。

import * as fs from 'fs';
import * as YAML from 'yaml';
import { featureArtifactPath, featurePhaseReportsDir } from '../../config';
import { resolveFeatureTrack, type FeatureTrackDecl } from './runtime-policy';

export const FEATURE_DECL_FILENAME = 'feature.yaml';

export function featureTrackDeclPath(projectRoot: string, feature: string): string {
  return featureArtifactPath(projectRoot, feature, FEATURE_DECL_FILENAME);
}

export function loadFeatureTrackDecl(projectRoot: string, feature: string, existingRunId?: string): FeatureTrackDecl | null {
  const runId = existingRunId ?? process.env.MAISON_GOAL_RUN_ID?.trim();
  // D1.6 / 批次 3 阻断 1：**现代有效范围在场即 full**，两个载体同口径。
  // 否则 feature.yaml 里残留的 `track: lite` 会在冻结入口之前把 review/ut 判成非法 phase，
  // 闭环出口也会按 lite 口径走——那正是「现代路径被旧 track 门控」的事故形状。
  try {
    if (loadEffectiveExecutionScope(projectRoot, feature, runId)) return { track: 'full' };
  } catch {
    // 权威说不清时（例如记录已转交而本次无 run 身份）不在这里裁决 track——
    // 交给冻结入口 / 统一入口给出明确报错。
  }
  if (runId && fs.existsSync(featureArtifactPath(projectRoot, feature, 'goal-runs/' + runId + '/manifest.json'))) {
    const legacy = JSON.parse(fs.readFileSync(featureArtifactPath(projectRoot, feature, 'goal-runs/' + runId + '/manifest.json'), 'utf8')) as { phase_chain?: string[] };
    if (Array.isArray(legacy.phase_chain) && legacy.phase_chain.length) return { track: resolveFeatureTrack(undefined, legacy.phase_chain) };
  }
  try {
    const abs = featureTrackDeclPath(projectRoot, feature);
    if (!fs.existsSync(abs)) return null;
    const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const track = (raw as { track?: unknown }).track;
    return typeof track === 'string' ? { track } : {};
  } catch {
    // 解析失败按未声明处理（full），不阻断——feature.yaml 语法问题由 change/exit 门禁另行报告
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

/** Only fresh 1.2 runs read the candidate; resume never consults this mutable file. */
export function resolveFeatureExecutionScope(projectRoot: string, feature: string, workflow: WorkflowSpec, frameworkRoot?: string, requirement?: string): ExecutionScope | undefined {
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
  return resolveExecutionScope(
    raw.execution_scope,
    workflow,
    readScopeAcceptance(projectRoot, raw.execution_scope, ctx),
    // requirement source: the real `--requirement` / `manifest.requirement`. Both birth entries
    // have one; the change-unit handoff projection has none, and **不编一份**——凭空拿
    // `requested_results` 当需求文本只会让每条 `derive.requirement` 绑定恒判 stale。
    collectResolvedScopeFacts(raw.execution_scope, { ...ctx, requirement: requirement?.trim() || undefined }),
  );
}

// ---------------------------------------------------------------------------
// D0.1 reading layer: resolve every fact the pure resolver needs, so the resolver
// itself keeps zero `fs` / `projectRoot` (plan §4.1.0).
// ---------------------------------------------------------------------------

/**
 * The ONLY providers whose bindings may be verified by `dependencies[]` bytes alone: they have no
 * parsed value in a freeze context (`capability-resolution.ts:335-339`), so `content_fingerprint`
 * cannot be recomputed. An allow-list, not "everything that is not a parsed-value provider" — a
 * new derive provider must not inherit the weaker check by default (review B7).
 */
const DEPENDENCY_ONLY_PROVIDERS = new Set(['derive.codebase', 'derive.test-targets']);

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
function verifyBasisBinding(projectRoot: string, frameworkRoot: string, feature: string, binding: InputBinding, skipContentCheck = false, requirement?: string | null): { ok: boolean; detail: string } {
  // `derive.requirement` 的解析值就是需求文本本身（`capability-resolution.ts:273-276`），
  // 所以重解析时必须把**同一份**需求文本交回去；否则该 provider 落到 feature 分支，
  // 只返回摘要不返回 value，`readBoundInput` 必判 stale。两处文本不同 = 候选与出生请求
  // 不是一回事，这时判 stale 正是想要的行为。
  const requirementContext = binding.source.kind === 'derive' && binding.source.provider_id === 'derive.requirement' && requirement?.trim()
    ? { requirement: requirement.trim(), inputContext: { schema_version: '1.1' as const, subject: { feature }, obligations: {}, required_outputs: [] } }
    : {};
  const byDependencies = binding.source.kind === 'derive' && DEPENDENCY_ONLY_PROVIDERS.has(binding.source.provider_id);
  // Project containment is checked for EVERY shape, including the artifact branch: `readBoundInput`
  // re-resolves content but accepts an extra out-of-project dependency that matches its own digest
  // (review B7). Existence is checked as CONSISTENCY, not as "every dependency must exist": a
  // binding aggregates the dependencies of all resolution attempts (`capability-resolution.ts:599`),
  // so a blueprint-derived binding legitimately records the absent physical artifact — demanding
  // existence there would reject every blueprint source, which D0.1 explicitly allows as a basis.
  for (const dep of binding.dependencies) {
    if (!isInsideProjectRoot(projectRoot, dep.path)) return { ok: false, detail: `${binding.input_id}: 依据不在项目内 ${dep.path}` };
    if (fs.existsSync(dep.path) !== dep.exists) return { ok: false, detail: `${binding.input_id}: 依据存在性变化 ${dep.path}` };
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
      readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'spec', track: 'full', ...requirementContext }, binding);
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
      if (createHash('sha256').update(fs.readFileSync(dep.path)).digest('hex') !== dep.sha256) {
        return { ok: false, detail: `${binding.input_id}: 依据字节已变化 ${dep.path}` };
      }
    }
    return { ok: true, detail: `${binding.input_id}: dependencies verified (no parsed value for ${(binding.source as { provider_id: string }).provider_id})` };
  } catch (error) {
    return { ok: false, detail: `${binding.input_id}: ${(error as Error).message}` };
  }
}

/** `satisfied_by` bindings are proof that a duty is already met — always fully re-resolved. */
function verifySatisfiedByBinding(projectRoot: string, frameworkRoot: string, feature: string, phase: string, binding: InputBinding): { ok: boolean; detail: string } {
  for (const dep of binding.dependencies) {
    if (!isInsideProjectRoot(projectRoot, dep.path)) return { ok: false, detail: `${binding.input_id}: 依据不在项目内 ${dep.path}` };
  }
  try {
    readBoundInput({ projectRoot, frameworkRoot, feature, phase, track: 'full' }, binding);
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
export function collectResolvedScopeFacts(
  input: ExecutionScopeInput,
  ctx: { projectRoot: string; feature: string; frameworkRoot: string; currentRunId?: string; requirement?: string | null;
    /** True when `request.impact` was inherited from the effective scope rather than supplied by
     *  this proposal — its basis is then a birth-time observation and its content is not re-compared. */
    impactInherited?: boolean },
): ResolvedScopeFacts {
  const { projectRoot, feature, frameworkRoot } = ctx;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { loadFidelityIntentSsotState, resolveUiRelevanceForRun } = require('./fidelity-shared') as typeof import('./fidelity-shared');
  const { uiSpecAbsPath } = require('./ui-spec-shared') as typeof import('./ui-spec-shared');
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
    visual_acceptance_present: fs.existsSync(uiSpecAbsPath(projectRoot, feature)),
  };

  // Target sets the impact relevance check runs against (§4.1.3). Paths stay project-relative.
  const derivePaths = (predicate: (fact: ExecutionScopeInput['facts'][number]) => boolean): string[] => [...new Set(input.facts.filter(predicate)
    .flatMap(fact => fact.basis.flatMap(binding => binding.dependencies.filter(dep => dep.role === 'derive').map(dep => relPosix(projectRoot, dep.path)))))];
  let contractsFiles: string[] = [];
  let contractsDetail = 'no contracts binding in candidate';
  const contractsBinding = input.facts.flatMap(fact => fact.basis).find(binding => binding.source.kind === 'artifact'
    ? binding.source.artifact === 'contracts@1'
    : binding.source.provider_id === 'derive.blueprint-contracts');
  if (contractsBinding) {
    try {
      const value = readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'plan', track: 'full' }, contractsBinding) as { files?: unknown };
      if (Array.isArray(value?.files)) contractsFiles = value.files.filter((f): f is string => typeof f === 'string').map(f => f.replace(/\\/g, '/'));
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

  const impact_basis = (input.request.impact?.basis ?? []).map(binding => {
    const verdict = verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, ctx.impactInherited === true, ctx.requirement);
    // Relevance is computed here (not in the resolver) because it needs projectRoot to normalise
    // paths; `targets` above is carried through so the decision stays inspectable.
    const paths = binding.dependencies.map(dep => relPosix(projectRoot, dep.path));
    const related = paths.some(p => allowed.has(p));
    return { input_id: binding.input_id, ok: verdict.ok, related, detail: `${verdict.detail}${related ? '' : ` | 目标集合=${[...allowed].join(',') || '空'} | ${contractsDetail}`}` };
  });

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
        ? verifyBasisBinding(projectRoot, frameworkRoot, feature, provenance, false, ctx.requirement)
        : { ok: false, detail: `${provenance.input_id}: 需求 provenance 必须是 derive.requirement 解析出的 requirement 绑定` }) });
  }
  for (const fact of input.facts) {
    for (const binding of fact.basis) {
      const birthObservation = EXECUTION_SOURCE_KINDS.has(fact.kind) && binding.dependencies.every(dep => dep.role === 'derive');
      basis.push({ obligation_id: fact.id, input_id: binding.input_id, ...verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, birthObservation, ctx.requirement) });
    }
  }

  const satisfied_by: ResolvedScopeFacts['satisfied_by'] = [];
  for (const fact of input.facts) {
    (fact.satisfied_by ?? []).forEach((ref, ref_index) => {
      if ('input_id' in ref) {
        const verdict = verifySatisfiedByBinding(projectRoot, frameworkRoot, feature, 'spec', ref);
        satisfied_by.push({ obligation_id: fact.id, ref_index, ...verdict });
        return;
      }
      // Phase evidence reuse: reuse the completion-side checker so the freeze-time and the
      // verify-time rules are literally the same function.
      const probe = { ...structuredClone(fact), owner_phase: ref.phase, satisfied_by: [ref] };
      const issues = executionScopeEvidenceIssues(projectRoot, feature, {
        schema_version: '1.0', completion_target: input.request.completion_target, requested_results: [...input.request.requested_results],
        obligations: [probe], phase_chain: [], reused_phases: [], unresolved: [], policy_fingerprint: '0'.repeat(64),
      } as ExecutionScope, new Set([fact.id]), ctx.currentRunId);
      satisfied_by.push({ obligation_id: fact.id, ref_index, ok: issues.length === 0, detail: issues.join('; ') || `${ref.phase}@${ref.run_id}: evidence verified` });
    });
  }
  return { fidelity, impact_basis, basis, satisfied_by, targets, impact_targets_available: allowed.size > 0 };
}

/** Re-read the selected acceptance source through P1; never scan history or write artifacts. */
export function readScopeAcceptance(projectRoot: string, input: Pick<ExecutionScopeInput, 'facts'>, context: { feature: string; frameworkRoot: string }): { value: AcceptanceSpec; binding: InputBinding } | undefined {
  const bindings = input.facts.flatMap(fact => fact.basis);
  const binding = bindings.find(binding => binding.source.kind === 'artifact' && binding.source.artifact === 'acceptance@1')
    ?? bindings.find(binding => binding.source.kind === 'derive' && binding.source.provider_id === 'derive.blueprint-acceptance');
  if (!binding) return undefined;
  if (binding.dependencies.some(dep => !isInsideProjectRoot(projectRoot, dep.path))) throw new Error('[execution-scope] acceptance source outside project');
  const value = readBoundInput({ ...context, projectRoot, phase: 'spec', track: 'full' }, binding) as AcceptanceSpec;
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
  /**
   * 需求文本：与 `--prepare-run` 用的是同一份（视觉相关性由它判定）。缺省才回落
   * `requestedResults`——两处不同源会让候选与出生时的 visual 结论对不上。
   */
  requirement?: string;
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

/** 候选里的每一条绑定都来自生产解析器——没有任何手写指纹、手写 basis 的余地。 */
/**
 * 两个定义类 kind（`design-context` / `acceptance-context`）的**唯一**派生点：生成器与冻结
 * 读取层共用同一份判定，把 D0.1「不采信候选自报、按来源重算」从 unit/device/visual 扩到它们。
 *
 * 写集授权**只认 `contracts.files`** 这一条受信设计来源。候选自带的 `implementation` basis 是
 * **自报**：它能指向任意项目内文件，而 `verifyBasisBinding` 只验路径 / 存在性 / 摘要，同一条绑定
 * 随后又被算进 impact 的目标集合——用它当写集授权等于让候选自证相关性（第七轮阻断 1）。
 */
function deriveDefinitionContext(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string },
  workflow: WorkflowSpec,
  requestedPhases: string[],
): {
  contracts?: InputBinding; acceptance?: InputBinding; writeSet: string[]; writeSetBinding?: InputBinding;
  wantsImplementation: boolean; designAvailable: boolean; acceptanceAvailable: boolean;
} {
  const contracts = candidateBinding(ctx, 'plan', 'contracts');
  const acceptance = candidateBinding(ctx, 'ut', 'acceptance');
  const implementationPhases = workflow.artifacts
    .filter(artifact => (OBLIGATION_PROVIDERS[artifact.obligation_provider_id ?? ''] ?? []).includes('implementation'))
    .map(artifact => artifact.id);
  const wantsImplementation = requestedPhases.some(phase => implementationPhases.includes(phase));
  const writeSet = wantsImplementation ? readCandidateWriteSet(ctx, contracts) : [];
  const writeSetBinding = writeSet.length ? candidateBinding(ctx, 'plan', 'codebase', writeSet) : undefined;
  return {
    contracts, acceptance, writeSet, writeSetBinding, wantsImplementation,
    designAvailable: !!contracts && (!wantsImplementation || !!writeSetBinding),
    acceptanceAvailable: !!acceptance,
  };
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
    } else {
      // 来源不可用 → **无条件**清掉满足证明（含 `onlyTighten` 的修订路径）：那份「证明」
      // 同样是自报，留着会让 `execution-scope.ts` 把这条责任当成「已兑现」而跳过责任阶段。
      delete fact.satisfied_by;
      // 降级本身只在出生路径做：修订路径的解析面比这里的探针更全，按探针降级会造出假缺口。
      if (!onlyTighten) {
        fact.applicability = 'unknown';
        fact.reason = design
          ? (derived.contracts ? '设计已存在但未声明可核验写集（contracts.files 为空或不可解析）' : '本 feature 尚无可解析的设计来源')
          : '本 feature 尚无可解析的验收来源';
      }
    }
  }
}

function candidateBinding(
  ctx: { projectRoot: string; frameworkRoot: string; feature: string; requirement?: string },
  phase: string,
  inputId: string,
  testTargets: string[] = [],
): InputBinding | undefined {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { resolveCapabilityInputs } = require('./capability-resolution') as typeof import('./capability-resolution');
  /* eslint-enable @typescript-eslint/no-require-imports */
  try {
    const value = resolveCapabilityInputs({
      projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, feature: ctx.feature, phase, track: 'full',
      ...(testTargets.length ? { testTargets } : {}),
      ...(ctx.requirement ? { requirement: ctx.requirement } : {}),
      inputContext: { schema_version: '1.1', subject: { feature: ctx.feature }, obligations: {}, required_outputs: [] },
    }).inputs?.values?.[inputId];
    return value && value.state === 'resolved' ? value.binding : undefined;
  } catch {
    return undefined;
  }
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
  // 无蓝图合法入口（非 CU feature）：设计 / 验收产物都还不存在时，来源就只有需求本身。
  // 需求绑定同样走既有 resolver（`derive.requirement`，带 inputContext 时返回需求文本作解析值），
  // **不自造 provider**、不伪造蓝图。
  // provenance：**始终**生成需求绑定——它是「这份候选为哪句需求而算」的机器凭据，
  // 不只在缺产物时才有意义。缺设计 / 验收时它同时充当那两条缺口事实的来源。
  const requirementText = input.requirement?.trim() || input.requestedResults.join('\n');
  const requirementBinding = candidateBinding({ ...ctx, requirement: requirementText }, 'spec', 'requirement');
  if (!requirementBinding) throw new Error('[prepare-scope] 需求无法经 derive.requirement 解析为绑定——候选缺少 provenance，不生成');
  const gapBasis = [requirementBinding];
  const facts: ExecutionScopeInput['facts'] = [];
  // implementation **由请求动作决定**，不由 completion_target 决定：只有当请求里含实现
  // provider 的阶段时才产出，写集来源取契约声明的文件（D0.1 规则 (a) 要求可核验写集）。
  // 「声明了文件却绑不出来」与「没声明」是同一种缺陷（都拿不出可核验写集），由
  // `deriveDefinitionContext` 一并判掉，不能一个走缺口、另一个被静默省略。
  const wantsImplementation = derived.wantsImplementation;
  const writeSet = derived.writeSet;
  const writeSetBinding = derived.writeSetBinding;
  // 契约在、却拿不出可核验写集（`contracts.files: []` 是 schema 允许的）＝**设计没给出写集**，
  // 这正是 plan 的责任缺口。此时不能把 design-context 当「已有设计可用」记成 required——否则
  // 既没有缺口挡住 coding，resolver 又会自动补一条 basis 为空的 implementation 请求标记，
  // 等于放一条无来源的实现义务进链。降成 unknown 走既有 definition-gap 通路（与「压根没有
  // 契约」同一条路），只在**请求跳过设计阶段**时才拒绝（见下方 fail-closed）。
  if (derived.designAvailable) facts.push({ id: 'design-context:candidate', kind: 'design-context', applicability: 'required', reason: '已有设计可用', basis: [contracts!], satisfied_by: [contracts!] });
  else if (contracts) facts.push({ id: 'design-context:pending', kind: 'design-context', applicability: 'unknown', reason: '设计已存在但未声明可核验写集（contracts.files 为空或不可解析）', basis: [contracts] });
  // 缺设计 ≠ 没有设计责任：落一条 unknown 的 design-context（owner=plan），由既有 definition-gap
  // 通路把下游（含 coding）挂进 needed_by，等设计阶段产出 contracts 后再由 D0.3/D2 同 run 补链。
  else facts.push({ id: 'design-context:pending', kind: 'design-context', applicability: 'unknown', reason: '本 feature 尚无可解析的设计来源（仅有需求）', basis: gapBasis });
  if (acceptance) facts.push({ id: 'acceptance-context:candidate', kind: 'acceptance-context', applicability: 'required', reason: '已有验收可用', basis: [acceptance], satisfied_by: [acceptance] });
  // 缺验收 ≠ 没有验收责任：落一条 unknown 的 acceptance-context（resolver 会把它送进
  // unresolved、owner=spec），不静默省略、也不伪造蓝图（需求 D0.2 原文）。
  else facts.push({ id: 'acceptance-context:pending', kind: 'acceptance-context', applicability: 'unknown', reason: '本 feature 尚无可解析的验收来源', basis: gapBasis });
  // 请求里是否**同时**含产出设计的阶段（spec / plan 家族）：含 → 写集本来就该由本次设计产出，
  // 交给 definition-gap 通路挡住 coding；不含 → 这是「跳过设计直接改代码却没有写集」，当场拒。
  const designPhases = workflow.artifacts
    .filter(artifact => ['obligations.spec', 'obligations.plan'].includes(artifact.obligation_provider_id ?? ''))
    .map(artifact => artifact.id);
  const requestsDesign = input.requestedPhases.some(phase => designPhases.includes(phase));
  if (wantsImplementation && !requestsDesign) {
    // 跳过设计阶段就必须拿得出**可核验的写集**：契约缺失 / files 为空 / 绑定解析不出来时
    // 在这里 fail-closed，而不是让 resolver 事后补一条空 basis 的请求标记，把问题推到 coding。
    if (!writeSet.length) throw new Error('[prepare-scope] 请求跳过设计阶段直接改代码，但契约没有声明可核验的写集（contracts.files 为空或不可解析）——责任方 plan');
    if (!writeSetBinding) throw new Error('[prepare-scope] 写集无法解析为项目内绑定：' + writeSet.join(', '));
    facts.push({ id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: '本次请求包含改代码', basis: [writeSetBinding] });
  } else if (wantsImplementation && writeSetBinding) {
    facts.push({ id: 'implementation:request', kind: 'implementation', applicability: 'required', reason: '本次请求包含改代码', basis: [writeSetBinding] });
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
        : {}),
    },
    facts,
    contract_fingerprints: loadFeatureContracts(frameworkRoot).map(contractFingerprint),
  };
  // 同一个 resolver、同一份已解析事实——投影出来的就是冻结时会得到的结果。
  const scope = resolveExecutionScope(candidate, workflow,
    readScopeAcceptance(projectRoot, candidate, { feature, frameworkRoot }),
    collectResolvedScopeFacts(candidate, { projectRoot, feature, frameworkRoot, requirement: input.requirement?.trim() || input.requestedResults.join('\n') }));

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

/** 写集来源：契约声明的文件（contracts@1 的 files）——不猜、不扫描。 */
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
  completedPhases?: ReadonlySet<string>;
  currentRunId?: string;
  requirement?: string;
}): { scope: ExecutionScope; input: ExecutionScopeInput } | null {
  if (input.proposals.length > 1) throw new Error('[execution-scope] multiple revision proposals');
  if (!input.proposals.length) return null;
  const { projectRoot, frameworkRoot, feature, workflow, previous } = input;
  const proposal = structuredClone(input.proposals[0]) as ExecutionScopeInput;
  proposal.contract_fingerprints = loadFeatureContracts(frameworkRoot).map(contractFingerprint);
  proposal.control_edges ??= structuredClone(previous.control_edges);
  if (proposal.request.completion_target !== previous.completion_target
    || JSON.stringify(proposal.request.requested_results) !== JSON.stringify(previous.requested_results)) {
    throw new Error('[execution-scope] revision changes request boundary');
  }
  // plan a9f3c7d2 第二笔：request 终点是单职责请求——修订只能关闭本阶段的定义缺口，
  // **不得把新阶段塞进请求动作**。边界取**冻结授权链**（见 `authorizedPhases` 注释）。
  if (previous.completion_target === 'request' && proposal.request.requested_phases.some(phase => !input.authorizedPhases.includes(phase))) {
    throw new Error('[execution-scope] request-scope revision cannot add phases');
  }
  const completed = input.completedPhases ?? new Set<string>();
  const revoked = new Set(previous.obligations
    .filter(obligation => obligation.satisfied_by?.length
      && proposal.facts.some(fact => fact.id === obligation.id && !fact.satisfied_by?.length))
    .map(obligation => obligation.id));
  for (const obligation of previous.obligations) {
    if (obligation.applicability !== 'required') continue;
    const existing = proposal.facts.find(fact => fact.id === obligation.id);
    if (completed.has(obligation.owner_phase) && !revoked.has(obligation.id)) {
      const evidence = loadPhaseEvidenceManifest(projectRoot, feature, obligation.owner_phase);
      if (!evidence?.integrityOk) throw new Error('[execution-scope] completed phase has no valid closure evidence');
      const proof = {
        phase: obligation.owner_phase,
        ...(input.currentRunId ? { run_id: input.currentRunId } : {}),
        evidence_manifest_aggregate: evidence.manifest.aggregate_sha256,
      };
      const fact = { ...(existing ?? obligation), satisfied_by: [proof] };
      if (existing) Object.assign(existing, fact); else proposal.facts.push(fact);
    } else if (!existing) proposal.facts.push({ ...obligation });
  }
  if (proposal.request.impact === null) throw new Error('[execution-scope] 影响判断为 null——请给出判断或不要携带该字段');
  if (proposal.request.impact === undefined) proposal.request.impact = previous.request_impact;
  const impactInherited = proposal.request.impact === undefined
    || (previous.request_impact !== undefined
      && executionScopeFingerprint(proposal.request.impact) === executionScopeFingerprint(previous.request_impact));
  if (!impactInherited && !(proposal.request.impact?.basis ?? []).some(binding => !previous.obligations.some(obligation => obligation.basis.some(prior => executionScopeFingerprint(prior) === executionScopeFingerprint(binding)))
    && !(previous.request_impact?.basis ?? []).some(prior => executionScopeFingerprint(prior) === executionScopeFingerprint(binding)))) {
    throw new Error('[execution-scope] impact correction requires its own new sourced basis');
  }
  const ctx = { projectRoot, feature, frameworkRoot, ...(input.currentRunId ? { currentRunId: input.currentRunId } : {}), ...(input.requirement ? { requirement: input.requirement } : {}), impactInherited };
  recomputeDefinitionFacts(proposal, { projectRoot, feature, frameworkRoot }, workflow, true);
  let facts = collectResolvedScopeFacts(proposal, ctx);
  const stale = facts.satisfied_by.filter(entry => !entry.ok
    && !('input_id' in (proposal.facts.find(fact => fact.id === entry.obligation_id)?.satisfied_by?.[entry.ref_index] ?? { input_id: '' })));
  if (stale.length) {
    for (const fact of proposal.facts) {
      const drop = stale.filter(entry => entry.obligation_id === fact.id).map(entry => entry.ref_index);
      if (!drop.length || !fact.satisfied_by) continue;
      const kept = fact.satisfied_by.filter((_, index) => !drop.includes(index));
      if (kept.length) fact.satisfied_by = kept; else delete fact.satisfied_by;
    }
    facts = collectResolvedScopeFacts(proposal, ctx);
  }
  const resolved = resolveExecutionScope(proposal, workflow, readScopeAcceptance(projectRoot, proposal, { feature, frameworkRoot }), facts);
  if (executionScopeFingerprint(resolved) === executionScopeFingerprint(previous)) return null;
  if (!hasNewSourcedFact(previous, proposal.facts, input.currentRunId ?? '')) throw new Error('[execution-scope] revision requires new sourced facts');
  return { scope: resolved, input: proposal };
}
