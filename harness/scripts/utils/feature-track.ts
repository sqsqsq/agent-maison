import { resolveExecutionScope, EXECUTION_SOURCE_KINDS, type ExecutionScope, type ExecutionScopeInput, type ResolvedScopeFacts } from './execution-scope';
import { createHash } from 'crypto';
import * as path from 'path';
import type { WorkflowSpec } from '../../workflow-loader';
import type { AcceptanceSpec } from './types';
import { readBoundInput, type InputBinding } from './capability-resolution';
import { isInsideProjectRoot } from './project-relative-path';
import { loadEffectiveExecutionScope } from './goal-run-creation';
import { loadFeatureContracts, contractFingerprint } from './skill-contract';
import { inferRepoLayout } from '../../repo-layout';
// ============================================================================
// feature-track.ts — feature.yaml 的 track 声明读取（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// feature 级档位声明落盘于 <features_dir>/<feature>/feature.yaml（路径一律经
// paths.features_dir 解析，禁止硬编码 doc/features/——round7 path-governance）。
// 文件缺失 / 解析失败 / 未声明 → null（resolveFeatureTrack 解释为 full，默认零变化）。

import * as fs from 'fs';
import * as YAML from 'yaml';
import { featureArtifactPath } from '../../config';
import { resolveFeatureTrack, type FeatureTrackDecl } from './runtime-policy';

export const FEATURE_DECL_FILENAME = 'feature.yaml';

export function featureTrackDeclPath(projectRoot: string, feature: string): string {
  return featureArtifactPath(projectRoot, feature, FEATURE_DECL_FILENAME);
}

export function loadFeatureTrackDecl(projectRoot: string, feature: string, existingRunId?: string): FeatureTrackDecl | null {
  const runId = existingRunId ?? process.env.MAISON_GOAL_RUN_ID?.trim();
  if (runId && loadEffectiveExecutionScope(projectRoot, feature, runId)) return { track: 'full' };
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

/** Only fresh 1.2 runs read the candidate; resume never consults this mutable file. */
export function resolveFeatureExecutionScope(projectRoot: string, feature: string, workflow: WorkflowSpec, frameworkRoot?: string, requirement?: string): ExecutionScope | undefined {
  if (workflow.schema_version !== '1.2') return undefined;
  const raw = YAML.parse(fs.readFileSync(featureTrackDeclPath(projectRoot, feature), 'utf8')) as { execution_scope?: ExecutionScopeInput };
  if (!raw?.execution_scope) throw new Error('[execution-scope] workflow 1.2 缺少运行前范围输入');
  const resolvedFrameworkRoot = frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot;
  raw.execution_scope.contract_fingerprints = loadFeatureContracts(resolvedFrameworkRoot).map(contractFingerprint);
  const ctx = { projectRoot, feature, frameworkRoot: resolvedFrameworkRoot };
  return resolveExecutionScope(
    raw.execution_scope,
    workflow,
    readScopeAcceptance(projectRoot, raw.execution_scope, ctx),
    // requirement source: the real `--requirement` / `manifest.requirement` whenever the caller
    // has one (both birth entries do). Only a candidate resolved with NO run (the change-unit
    // projection) falls back to the request's own declared results.
    collectResolvedScopeFacts(raw.execution_scope, { ...ctx, requirement: requirement?.trim() || raw.execution_scope.request.requested_results.join('\n') }),
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
function verifyBasisBinding(projectRoot: string, frameworkRoot: string, feature: string, binding: InputBinding, skipContentCheck = false): { ok: boolean; detail: string } {
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
  try {
    // The content exemption never crosses the provider boundary: a source that HAS a parsed value
    // is always re-resolved through P1 (review B7). Only the no-parsed-value providers can be
    // judged by their dependencies, and even then the source must be real and digest-verifiable.
    if (!byDependencies) {
      readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'spec', track: 'full' }, binding);
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
    const verdict = verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, ctx.impactInherited === true);
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
  for (const fact of input.facts) {
    for (const binding of fact.basis) {
      const birthObservation = EXECUTION_SOURCE_KINDS.has(fact.kind) && binding.dependencies.every(dep => dep.role === 'derive');
      basis.push({ obligation_id: fact.id, input_id: binding.input_id, ...verifyBasisBinding(projectRoot, frameworkRoot, feature, binding, birthObservation) });
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
