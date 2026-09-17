import * as crypto from 'crypto';
import type { WorkflowSpec } from '../../workflow-loader';
import type { InputBinding, ResolutionDependency } from './capability-resolution';
import { isInsideProjectRoot } from './project-relative-path';
import type { AcceptanceSpec, CheckContext } from './types';
import { checkAcceptanceUtLayerComplete } from './check-acceptance';
import { collectDeviceScopeIds, collectUnitScopeIds, hasUnknownPerformanceLayer } from './acceptance-layering';

export type ObligationApplicability = 'required' | 'not_applicable' | 'unknown';
export interface ScopeEvidenceRef {
  phase: string;
  /** D1 §4.2.4：feature 载体（无 run）没有 run 身份——**不伪造**，此处缺省。 */
  run_id?: string;
  evidence_manifest_aggregate: string;
}
export type EvidenceOrInputRef = InputBinding | ScopeEvidenceRef;
export interface ExecutionObligation {
  id: string;
  kind: string;
  owner_phase: string;
  applicability: ObligationApplicability;
  reason: string;
  basis: InputBinding[];
  satisfied_by?: EvidenceOrInputRef[];
}
export interface ExecutionScope {
  schema_version: '1.0';
  completion_target: 'request' | 'feature';
  requested_results: string[];
  obligations: ExecutionObligation[];
  phase_chain: string[];
  reused_phases: Array<{ phase: string; obligation_ids: string[]; evidence_refs: ScopeEvidenceRef[] }>;
  unresolved: Array<{ obligation_id: string; needed_by: string[]; owner: string; reason: string }>;
  policy_fingerprint: string;
  control_edges?: ExecutionScopeInput['control_edges'];
  /** D0.1: the sourced impact judgement this scope was resolved with; revisions inherit it. */
  request_impact?: ExecutionScopeInput['request']['impact'];
}

/** D0.1 impact judgement: an AI-submitted, sourced statement about user-visible behaviour change. */
export interface ScopeImpactJudgement {
  user_visible_behavior_change: boolean;
  reason: string;
  basis: InputBinding[];
}

/**
 * D0.1: facts the reading layer resolved before calling the pure resolver.
 * The resolver reads conclusions only — it never touches `fs` or `projectRoot`.
 * Omitted entirely (legacy callers / pure unit tests) => evidence kinds derive to `unknown`,
 * so "no source given" can never prune a duty.
 */
export interface ResolvedScopeFacts {
  /** Fidelity SSOT state plus whether the request/blueprint carries a visual requirement at all. */
  /** No binding: the SSOT is a derivation source, not a P1-resolvable input, so it never enters an obligation basis. */
  /** `visual_acceptance_present`: does the feature already carry the visual acceptance artifact
   *  (`spec/ui-spec.yaml`, read through the existing `uiSpecAbsPath`)? A `pixel_1to1` decision
   *  without it is a spec-owned definition gap, not a reason to drop the visual duty. */
  fidelity: { state: 'missing' | 'corrupt' | 'valid'; selected_fidelity?: string; visual_requested: boolean; visual_acceptance_present?: boolean };
  /** Per-basis verdict for `request.impact.basis`: `ok` = binding verified, `related` = intersects the real targets. */
  impact_basis: Array<{ input_id: string; ok: boolean; related: boolean; detail: string }>;
  /** Per-binding verdict for every `obligation.basis` element (plan §4.1.0: both basis kinds covered). */
  basis: Array<{ obligation_id: string; input_id: string; ok: boolean; detail: string }>;
  /**
   * Was there any target set at all to check relevance against? When false, `related` carries no
   * information and MUST NOT be read as "unrelated" — see the two sub-cases in `resolveExecutionScope`.
   */
  impact_targets_available: boolean;
  /** Per-element verdict for every `satisfied_by` reference (bindings re-resolved, evidence refs checked). */
  satisfied_by: Array<{ obligation_id: string; ref_index: number; ok: boolean; detail: string }>;
  /** Target sets the relevance check was computed against; kept for diagnosis (§4.1.3). */
  targets: { implementation_files: string[]; contracts_files: string[]; review_targets: string[]; ut_targets: string[] };
}

/** These are sourced observations from P1/P3–P6, not phase verdicts or a second task ledger. */
export interface ExecutionScopeInput {
  request: {
    completion_target: 'request' | 'feature';
    requested_results: string[];
    requested_phases: string[];
    impact?: ScopeImpactJudgement;
    /**
     * D0.2 provenance：这份候选是**为哪句需求**算出来的。由 `--prepare-scope` 经既有
     * `derive.requirement` 解析得到（不是手写），冻结时与当次 `--requirement` /
     * `manifest.requirement` 重解析比对——两者分叉即 `input binding stale`，不得静默换需求。
     * 校验走 §4.1.0 既有的 `resolved.basis` 通道，不另建第二套。
     */
    requirement_basis?: InputBinding;
  };
  facts: Array<Omit<ExecutionObligation, 'owner_phase'>>;
  /** Conditional control facts; an information producer is not automatically a predecessor. */
  control_edges?: Array<{ before: string; after: string; basis: InputBinding[] }>;
  contract_fingerprints: string[];
}

export const OBLIGATION_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  'obligations.spec': ['acceptance-context', 'acceptance-definition'],
  'obligations.plan': ['design-context', 'design-decision'],
  'obligations.coding': ['implementation'],
  'obligations.review': ['code-review'],
  'obligations.ut': ['unit-evidence'],
  'obligations.testing': ['device-evidence', 'visual-evidence'],
  'obligations.project': ['project-result'],
};

export function executionScopeFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)])) : item;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** A scoped no-op is not a test PASS; legacy callers have no scope and use their old path. */
export function hasNoTestingObligation(scope: ExecutionScope): boolean {
  if (scope.unresolved.length || scope.phase_chain.includes('testing')) return false;
  const obligations = scope.obligations.filter(item => item.owner_phase === 'testing' || ['device-evidence', 'visual-evidence'].includes(item.kind));
  return obligations.every(item => item.applicability === 'not_applicable')
    && (scope.completion_target === 'request' || obligations.some(item => item.kind === 'device-evidence'));
}

/**
 * "A revision must not delete or downgrade a required obligation" — the single predicate.
 *
 * Identity is `id` + `kind`: keeping the id while switching the kind replaces the responsibility
 * (review B3), so it counts as a subtraction. `owner_phase` adds nothing — it is a function of
 * `kind` through `OBLIGATION_PROVIDERS`.
 * `not_applicable -> required` is an upgrade and stays legal; `required -> anything else` does not.
 */
export function findSubtractedRequiredObligations(previous: ExecutionScope, next: ExecutionScope): string[] {
  return previous.obligations
    .filter(old => old.applicability === 'required'
      && !next.obligations.some(fact => fact.id === old.id && fact.kind === old.kind && fact.applicability === 'required'))
    .map(old => old.id);
}

/**
 * Does this proposal stand on anything the frozen scope does not already have?
 *
 * Two shapes count, and only these two:
 *  - a `basis` binding the previous scope does not carry (a genuinely new source), or
 *  - a phase-closure reference **this very run** just produced for a duty that had none — the only
 *    new fact a phase re-run after a revocation can offer is its own fresh, verified closure.
 * A historical run's evidence is NOT new: it existed before this revision was proposed, so it can
 * never be the reason for one (review B3).
 */
export function hasNewSourcedFact(previous: ExecutionScope, facts: ExecutionScopeInput['facts'], currentRunId: string): boolean {
  const same = (a: unknown, b: unknown): boolean => executionScopeFingerprint(a) === executionScopeFingerprint(b);
  // The frozen impact judgement's own basis is a source the scope already carries — re-presenting it
  // is not a new fact either (review 建议 3).
  const carried = [...previous.obligations.flatMap(obligation => obligation.basis), ...(previous.request_impact?.basis ?? [])];
  return facts.some(fact =>
    fact.basis.some(binding => !carried.some(prior => same(prior, binding)))
    || (fact.satisfied_by ?? []).some(ref => 'evidence_manifest_aggregate' in ref && ref.run_id === currentRunId
      && !previous.obligations.some(obligation => obligation.id === fact.id && obligation.satisfied_by?.some(prior => same(prior, ref)))));
}

/** Runtime-side form: throws with the offending ids. Same predicate, one implementation. */
export function assertRevisionKeepsRequiredObligations(previous: ExecutionScope, next: ExecutionScope): void {
  const subtracted = findSubtractedRequiredObligations(previous, next);
  if (subtracted.length) throw new Error(`[execution-scope] 修订不得删除或降级 required 义务：${subtracted.join(', ')}`);
}

/**
 * Obligation kinds whose `derive` basis is a *birth-time observation of code* the responsible phase
 * rewrites; their later verification is carried by that phase's closure evidence, so their bytes
 * are not re-compared. One list, shared by the completion-side exemption and the freeze-time
 * reading layer — never two copies.
 * The last two (§5.1.1a) are revision triggers: the file a rejected proposal reverts.
 */
export const EXECUTION_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'implementation', 'code-review', 'unit-evidence', 'device-evidence', 'visual-evidence',
  'design-decision', 'acceptance-definition',
]);

/** Birth-only code observations; current outputs remain bound by phase evidence. */
export function isExecutionSourceBasis(projectRoot: string, scope: ExecutionScope, obligation: ExecutionObligation, dependency: ResolutionDependency): boolean {
  return isInsideProjectRoot(projectRoot, dependency.path) && dependency.role === 'derive'
    && (scope.phase_chain.includes(obligation.owner_phase) || !!obligation.satisfied_by?.some(proof => 'evidence_manifest_aggregate' in proof))
    && EXECUTION_SOURCE_KINDS.has(obligation.kind);
}

function fail(reason: string): never { throw new Error(`[execution-scope] ${reason}`); }
function strings(value: unknown, label: string, nonempty = false): asserts value is string[] {
  if (!Array.isArray(value) || (nonempty && !value.length) || value.some(x => typeof x !== 'string' || !x.trim()) || new Set(value).size !== value.length) fail(`${label} 必须为不重复字符串数组`);
}
export function validateExecutionScope(value: unknown): ExecutionScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('范围缺失或损坏');
  const scope = value as ExecutionScope;
  if (scope.schema_version !== '1.0' || !['request', 'feature'].includes(scope.completion_target)) fail('范围版本或完成终点非法');
  strings(scope.requested_results, 'requested_results', true);
  strings(scope.phase_chain, 'phase_chain');
  if (!Array.isArray(scope.obligations) || !Array.isArray(scope.reused_phases) || !Array.isArray(scope.unresolved) || !/^[0-9a-f]{64}$/.test(scope.policy_fingerprint)) fail('范围字段不完整');
  const ids = new Set<string>();
  for (const o of scope.obligations) {
    if (!o || typeof o.id !== 'string' || !o.id || ids.has(o.id) || !o.kind || !o.owner_phase || !o.reason || !['required', 'not_applicable', 'unknown'].includes(o.applicability) || !Array.isArray(o.basis)) fail(`义务字段或身份非法：${(o as { id?: string })?.id ?? '(无 id)'}`);
    ids.add(o.id);
    if (Object.prototype.hasOwnProperty.call(o, 'satisfied')) fail('不得手写 satisfied');
    if (o.satisfied_by !== undefined && (!Array.isArray(o.satisfied_by) || !o.satisfied_by.length)) fail('满足依据必须非空');
    if (o.applicability === 'required' && !o.satisfied_by?.length && !scope.phase_chain.includes(o.owner_phase) && !scope.unresolved.some(gap => gap.obligation_id === o.id)) fail(`必需义务未执行或交代缺口：${o.id}`);
    if (o.applicability === 'unknown' && !scope.unresolved.some(gap => gap.obligation_id === o.id)) fail(`未知义务被删除：${o.id}`);
  }
  for (const gap of scope.unresolved) {
    if (!gap || !ids.has(gap.obligation_id) || !gap.owner || !gap.reason) fail('未知缺口未绑定义务');
    strings(gap.needed_by, 'unresolved.needed_by');
  }
  for (const reuse of scope.reused_phases) {
    if (!reuse.phase || !Array.isArray(reuse.evidence_refs) || !reuse.evidence_refs.length || scope.phase_chain.includes(reuse.phase)) fail('复用阶段非法');
    strings(reuse.obligation_ids, 'reused obligation_ids', true);
    if (reuse.obligation_ids.some(id => !scope.obligations.some(o => o.id === id && o.owner_phase === reuse.phase && o.satisfied_by?.length))) fail('复用义务失配');
  }
  for (const edge of scope.control_edges ?? []) {
    if (!edge.before || !edge.after || !Array.isArray(edge.basis) || !edge.basis.length) fail('控制前置记录非法');
    const after = scope.phase_chain.indexOf(edge.after), before = scope.phase_chain.indexOf(edge.before);
    if (after >= 0 && (before >= after || (before < 0 && !scope.obligations.some(o => o.owner_phase === edge.before && o.satisfied_by?.some(ref => 'evidence_manifest_aggregate' in ref && ref.phase === edge.before))))) fail('冻结范围违反真实控制顺序');
  }
  return scope;
}

/** Evidence kinds whose candidate-declared applicability is never trusted (D0.1). */
const DERIVED_EVIDENCE_KINDS: ReadonlyArray<{ kind: string; provider: string }> = Object.freeze([
  { kind: 'unit-evidence', provider: 'obligations.ut' },
  { kind: 'device-evidence', provider: 'obligations.testing' },
  { kind: 'visual-evidence', provider: 'obligations.testing' },
]);

/** One pure resolver shared by interactive entry and Goal birth. Execution results are not inputs. */
export function resolveExecutionScope(input: ExecutionScopeInput, workflow: WorkflowSpec, acceptance?: { value: AcceptanceSpec; binding: InputBinding }, resolved?: ResolvedScopeFacts): ExecutionScope {
  const projectRequest = input.request.completion_target === 'request' && input.request.requested_phases.length > 0
    && input.request.requested_phases.every(id => workflow.artifacts.some(a => a.id === id && a.scope === 'global'));
  if (workflow.schema_version !== '1.2' && !projectRequest) fail('动态范围要求 workflow 1.2');
  if (projectRequest) {
    // Native project phases have request endpoints; requires is information, not auto-execution.
    workflow = { ...workflow, artifacts: workflow.artifacts.filter(a => input.request.requested_phases.includes(a.id)).map(a => ({ ...a, obligation_provider_id: a.obligation_provider_id ?? 'obligations.project' })) };
  }
  input = structuredClone(input);
  const request = input.request;
  // -------------------------------------------------------------------------
  // D0.1: evidence duties are derived from their real sources; whatever the
  // candidate declared for unit/device/visual applicability is overwritten.
  // "Candidate says X" is never a reason to reject — the generator writes the
  // derived result into the candidate itself.
  // -------------------------------------------------------------------------
  const inPlay = (provider: string): boolean => request.completion_target === 'feature'
    || workflow.artifacts.some(a => a.obligation_provider_id === provider && request.requested_phases.includes(a.id));
  const acceptanceInvalid = acceptance
    ? checkAcceptanceUtLayerComplete({ featureSpec: { acceptance: acceptance.value } } as CheckContext, (_ctx, _section, id) => id).some(check => check.status === 'FAIL')
    : false;
  const deriveFromAcceptance = (kind: 'unit-evidence' | 'device-evidence'): { source: string; applicability: ObligationApplicability; reason: string; basis: InputBinding[] } => {
    if (!acceptance) return { source: 'acceptance', applicability: 'unknown', reason: `${kind}: 验收缺失`, basis: [] };
    const ids = acceptanceInvalid ? [] : kind === 'unit-evidence' ? collectUnitScopeIds(acceptance.value) : collectDeviceScopeIds(acceptance.value);
    const unknownNfr = kind === 'device-evidence' && hasUnknownPerformanceLayer(acceptance.value);
    return {
      source: 'acceptance',
      applicability: acceptanceInvalid || unknownNfr ? 'unknown' : ids.length ? 'required' : 'not_applicable',
      reason: acceptanceInvalid ? '验收分层尚不可用' : unknownNfr ? '性能义务所需验证层待确定' : `${kind}: ${ids.join(',') || '无该层验收'}`,
      basis: [acceptance.binding],
    };
  };
  // visual never derives from acceptance layering; its single source is the fidelity SSOT.
  const deriveVisual = (): { source: string; applicability: ObligationApplicability; reason: string; basis: InputBinding[] } => {
    const basis: InputBinding[] = [];
    if (!resolved) return { source: 'fidelity', applicability: 'unknown', reason: 'fidelity 定档来源未解析', basis };
    const { state, selected_fidelity: selected, visual_requested: requested } = resolved.fidelity;
    if (state === 'corrupt') return { source: 'fidelity', applicability: 'unknown', reason: 'fidelity ssot corrupt', basis };
    if (state === 'missing') {
      return requested
        ? { source: 'fidelity', applicability: 'unknown', reason: '请求含视觉要求而定档尚未完成', basis }
        : { source: 'fidelity', applicability: 'not_applicable', reason: 'fidelity 未定档且请求无视觉要求', basis };
    }
    return selected === 'pixel_1to1'
      ? { source: 'fidelity', applicability: 'required', reason: 'fidelity ssot: pixel_1to1', basis }
      : { source: 'fidelity', applicability: 'not_applicable', reason: `fidelity ssot: selected_fidelity=${selected}`, basis };
  };
  const derivations = new Map<string, { source: string; applicability: ObligationApplicability; reason: string; basis: InputBinding[] }>();
  for (const { kind } of DERIVED_EVIDENCE_KINDS) {
    derivations.set(kind, kind === 'visual-evidence' ? deriveVisual() : deriveFromAcceptance(kind as 'unit-evidence' | 'device-evidence'));
  }
  // Which kinds count as a *definition* gap comes from the provider registry — one source of
  // truth, so `acceptance-definition` / `design-decision` are covered without a second literal list.
  const definitionKinds = new Set<string>([...OBLIGATION_PROVIDERS['obligations.spec'], ...OBLIGATION_PROVIDERS['obligations.plan']]);
  // 判定顺序：**definition-gap 先于 impact 目标相关性**。设计缺口还在时，写集本来就还没确定，
  // 把「拿不出写集」算到范围声明头上是错的——那条缺口马上就会把实现阶段挡在链外。
  const definitionGapPending = input.facts.some(fact => fact.applicability === 'unknown' && definitionKinds.has(fact.kind));
  // `completion_target=feature` additionally requires a sourced impact judgement before
  // device verification may be pruned. Missing impact => unknown (testing is NOT pruned).
  if (request.completion_target === 'feature') {
    const impact = request.impact;
    const device = derivations.get('device-evidence')!;
    // An empty target set is never evidence that the basis is "unrelated" — there was simply
    // nothing to compare against. Which of the two real problems it is depends on whether this
    // request carries an implementation duty at all.
    const implementationPhases = workflow.artifacts
      .filter(a => (OBLIGATION_PROVIDERS[a.obligation_provider_id ?? ''] ?? []).includes('implementation'))
      .map(a => a.id);
    const implementationDuty = input.facts.some(fact => fact.kind === 'implementation')
      || implementationPhases.some(phase => request.requested_phases.includes(phase));
    let missingImpactReason = '影响依据缺失';
    let usableImpact = impact;
    if (impact !== undefined) {
      // An explicit `null` (or any non-object) is a malformed judgement, never "no judgement":
      // absence is a gap, a bad value is an error.
      if (impact === null || typeof impact !== 'object') fail('影响判断结构非法');
      if (!resolved) fail('影响判断需要已解析的来源核验');
      // An impact judgement prunes device verification, so it must BE a judgement: a real boolean,
      // a stated reason and at least one source. A missing field is not an implicit `false`.
      if (typeof impact.user_visible_behavior_change !== 'boolean') fail('影响判断缺少 user_visible_behavior_change 布尔值');
      if (typeof impact.reason !== 'string' || !impact.reason.trim()) fail('影响判断缺少 reason');
      if (!Array.isArray(impact.basis) || !impact.basis.length) fail('影响判断缺少来源（basis 为空）');
      for (const binding of impact.basis) {
        const verdict = resolved.impact_basis.find(entry => entry.input_id === binding.input_id);
        if (!verdict || !verdict.ok) fail(`影响依据不可用：${verdict?.detail ?? binding.input_id}`);
      }
      if (!resolved.impact_targets_available) {
        // (a) There *is* an implementation duty, so a declared write set must exist. Blame the
        // scope declaration, not the impact basis — same verdict check-coding.ts:326 already makes
        // at coding time ("施工契约缺少 files/modules"), just moved forward to freeze time.
        // 它不该拦住谁：**请求里带着设计阶段**的那条合法入口——设计缺口（design-context /
        // acceptance-context unknown）会把 coding 挡进 `needed_by`，写集要等 plan 产出 contracts
        // 之后才由 D2 同 run 修订重判。此时按 (b) 处理，而不是当场判范围声明有错。
        if (implementationDuty && !definitionGapPending) fail('范围未声明可核验的写集（contracts.files 为空且 implementation 无写集来源），责任方 plan');
        // (b) No implementation duty and no review/UT target (e.g. a [spec]/[plan] birth chain):
        // relevance is simply not checkable, so the impact judgement cannot be relied on. Falls
        // onto the existing "impact missing" path — device unknown, testing NOT pruned.
        usableImpact = undefined;
        missingImpactReason = '影响依据无可核验范围';
      } else {
        for (const binding of impact.basis) {
          const verdict = resolved.impact_basis.find(entry => entry.input_id === binding.input_id)!;
          if (!verdict.related) fail(`影响依据与本次范围无关：${verdict.detail}`);
        }
      }
    }
    // The impact judgement only gates *pruning*. An acceptance layer that really demands device
    // verification stays `required` regardless — letting a missing impact downgrade it would be
    // exactly the wash D0.1 exists to stop.
    const visualRequired = derivations.get('visual-evidence')!.applicability === 'required';
    derivations.set('device-evidence', usableImpact === undefined
      ? device.applicability === 'not_applicable'
        ? { ...device, applicability: 'unknown', reason: missingImpactReason }
        : device
      : usableImpact.user_visible_behavior_change
        ? { ...device, applicability: 'required', reason: '影响判断：存在用户可见行为变化' }
        : device.applicability === 'not_applicable' && !visualRequired
          ? { ...device, reason: '影响判断：无用户可见行为变化' }
          : device);
  }
  for (const { kind, provider } of DERIVED_EVIDENCE_KINDS) {
    if (!inPlay(provider)) continue;
    const derivation = derivations.get(kind)!;
    const existing = input.facts.filter(fact => fact.kind === kind);
    if (existing.length) {
      // Override every candidate fact of this kind — not just the same-id one. Original basis is
      // kept (it may carry real sources); the derivation's own basis is appended.
      for (const fact of existing) {
        const merged = [...fact.basis];
        for (const binding of derivation.basis) if (!merged.some(b => b.input_id === binding.input_id)) merged.push(binding);
        Object.assign(fact, { applicability: derivation.applicability, reason: derivation.reason, basis: merged });
      }
      continue;
    }
    // No candidate fact of this kind: *creating* one is governed by the pre-existing rules, not by
    // the override rule. Inventing an `unknown` fact for an explicitly requested phase would let
    // the definition-gap pass prune the very phase the user asked for.
    const hasRealSource = kind === 'visual-evidence' ? resolved !== undefined : acceptance !== undefined;
    const phaseRequested = workflow.artifacts.some(a => a.obligation_provider_id === provider && request.requested_phases.includes(a.id));
    if (hasRealSource) {
      input.facts.push({ id: `${kind}:${derivation.source}`, kind, applicability: derivation.applicability, reason: derivation.reason, basis: [...derivation.basis] });
    } else if (request.completion_target === 'feature' && kind !== 'visual-evidence' && !phaseRequested) {
      input.facts.push({ id: `${kind}:pending`, kind, applicability: 'unknown', reason: '验证责任尚缺验收或影响依据', basis: [] });
    }
  }
  // A `pixel_1to1` decision with no visual acceptance artifact is a DEFINITION gap owned by spec:
  // the visual duty stays `required`, and spec becomes executable to fill the gap (scheme A below).
  // The gap is DERIVED, both ways: it is opened while the artifact is missing and removed once it
  // exists. Only stopping to re-add it would leave an inherited `unknown` blocking every later
  // phase forever, because a revision carries the previous obligations forward (review B5).
  if (resolved && resolved.fidelity.visual_acceptance_present !== undefined) {
    const missing = resolved.fidelity.visual_acceptance_present === false
      && input.facts.some(fact => fact.kind === 'visual-evidence' && fact.applicability === 'required')
      && workflow.artifacts.some(a => a.obligation_provider_id === 'obligations.spec');
    const gap = { id: 'acceptance-definition:visual', kind: 'acceptance-definition', applicability: 'unknown' as const, reason: 'pixel_1to1 定档缺视觉验收条目', basis: [] };
    const declared = input.facts.find(fact => fact.id === gap.id);
    if (missing && declared) Object.assign(declared, gap);
    else if (missing) input.facts.push(gap);
    else if (declared) input.facts.splice(input.facts.indexOf(declared), 1);
  }
  if (resolved) {
    for (const entry of resolved.basis) {
      if (!entry.ok) fail(`义务依据冻结时核验失败：${entry.obligation_id} ${entry.detail}`);
    }
    for (const entry of resolved.satisfied_by) {
      if (!entry.ok) fail(`满足依据冻结时核验失败：${entry.obligation_id}#${entry.ref_index} ${entry.detail}`);
    }
  }
  strings(request.requested_results, 'requested_results', true);
  strings(request.requested_phases, 'requested_phases', true);
  strings(input.contract_fingerprints, 'contract_fingerprints');
  // Formality/admission stays with the existing entry and CU design gate, not writable scope flags.
  const phases = new Map(workflow.artifacts.map(a => [a.id, a]));
  for (const phase of request.requested_phases) if (!phases.has(phase)) fail(`未知请求阶段：${phase}`);
  const obligations: ExecutionObligation[] = [];
  for (const artifact of workflow.artifacts) {
    const provider = artifact.obligation_provider_id;
    const kinds = provider && OBLIGATION_PROVIDERS[provider];
    if (!kinds) fail(`phase ${artifact.id} 缺少已注册义务 provider`);
    const applicableFacts = input.facts.filter(fact => kinds.includes(fact.kind));
    for (const fact of applicableFacts) obligations.push({ ...structuredClone(fact), owner_phase: artifact.id });
    if (request.requested_phases.includes(artifact.id) && !applicableFacts.some(f => f.applicability === 'required')) {
      const id = `${kinds[0]}:request:${artifact.id}`;
      // A request marker states what the USER asked for; it is not a candidate observation. When a
      // revision carries one forward it arrives as a fact of an evidence kind and the derivation
      // above rewrites it — re-assert it here instead of pushing a second obligation with the same
      // id (which `validateExecutionScope` rejects outright). At birth this branch simply creates it.
      const carried = obligations.find(o => o.id === id && o.owner_phase === artifact.id);
      if (carried) Object.assign(carried, { applicability: 'required', reason: `用户明确请求 ${artifact.id}` });
      else obligations.push({ id, kind: kinds[0], owner_phase: artifact.id, applicability: 'required', reason: `用户明确请求 ${artifact.id}`, basis: [] });
    }
  }
  for (const fact of input.facts) if (!obligations.some(o => o.id === fact.id)) fail(`未知义务：${fact.kind}`);
  const implementation = obligations.find(o => o.kind === 'implementation' && o.applicability === 'required' && !o.satisfied_by?.length);
  if (request.completion_target === 'feature' && implementation && !obligations.some(o => o.kind === 'code-review' && o.applicability === 'required')) {
    const reviewer = workflow.artifacts.find(a => a.obligation_provider_id === 'obligations.review');
    if (!reviewer) fail('实现交付缺少审查责任 provider');
    obligations.push({ id: 'code-review:implementation', kind: 'code-review', owner_phase: reviewer.id, applicability: 'required', reason: '本次实现交付需要审查', basis: [...implementation.basis] });
  }
  const needed = new Set(obligations.filter(o => o.applicability === 'required' && !o.satisfied_by?.length).map(o => o.owner_phase));
  const unresolved: ExecutionScope['unresolved'] = obligations.filter(o => o.applicability === 'unknown').map(o => ({ obligation_id: o.id, owner: o.owner_phase, reason: o.reason, needed_by: [o.owner_phase] }));
  const investigation = new Set(workflow.artifacts.filter(a => ['obligations.spec', 'obligations.plan'].includes(a.obligation_provider_id ?? '')).map(a => a.id));
  // A definition gap must stay executable by its own owner: the investigation phase is the one
  // that fills it, so put the owner back into `needed` even though unknown duties never do.
  for (const gap of unresolved) {
    const owner = obligations.find(o => o.id === gap.obligation_id)!;
    if (definitionKinds.has(owner.kind) && investigation.has(gap.owner) && phases.has(gap.owner)) needed.add(gap.owner);
  }
  // Definition gaps block their actual downstream consumers; investigation itself remains executable.
  for (const gap of unresolved) {
    const kind = obligations.find(o => o.id === gap.obligation_id)!.kind;
    if (definitionKinds.has(kind)) {
      gap.needed_by = [...needed].filter(p => !investigation.has(p));
      for (const blocked of gap.needed_by) {
        needed.delete(blocked);
        for (const o of obligations.filter(o => o.owner_phase === blocked && o.applicability === 'required' && !o.satisfied_by?.length)) {
          unresolved.push({ obligation_id: o.id, owner: gap.owner, reason: gap.reason, needed_by: [blocked] });
        }
      }
    } else if (needed.has(gap.owner) && !investigation.has(gap.owner)) {
      needed.delete(gap.owner);
      for (const o of obligations.filter(o => o.owner_phase === gap.owner && o.applicability === 'required' && !o.satisfied_by?.length)) unresolved.push({ obligation_id: o.id, owner: gap.owner, reason: gap.reason, needed_by: [gap.owner] });
    }
  }
  const edges = (input.control_edges ?? []).filter(edge => needed.has(edge.after));
  for (const edge of edges) if (!phases.has(edge.before) || !phases.has(edge.after) || !edge.basis.length) fail('控制边缺少合法阶段或真实依据');
  for (const edge of edges) if (!needed.has(edge.before) && !obligations.some(o => o.owner_phase === edge.before && o.satisfied_by?.some(ref => 'evidence_manifest_aggregate' in ref && ref.phase === edge.before))) fail(`真实控制前置尚未满足：${edge.before} → ${edge.after}`);
  for (const edge of edges) for (const obligation of obligations.filter(o => o.owner_phase === edge.after && o.applicability === 'required')) obligation.basis.push(...edge.basis);
  const defaults = [...new Set([...(workflow.auto_chain ?? []), ...phases.keys()])];
  const chain: string[] = [];
  while (needed.size) {
    const next = defaults.find(phase => needed.has(phase) && edges.every(edge => edge.after !== phase || !needed.has(edge.before)));
    if (!next) fail('适用控制依赖存在环');
    chain.push(next); needed.delete(next);
  }
  const reused: ExecutionScope['reused_phases'] = [];
  for (const phase of phases.keys()) {
    const obligationsForPhase = obligations.filter(o => o.owner_phase === phase && o.applicability === 'required');
    if (!chain.includes(phase) && obligationsForPhase.length && obligationsForPhase.every(o => o.satisfied_by?.length)) {
      const refs = obligationsForPhase.flatMap(o => o.satisfied_by ?? []).filter((ref): ref is ScopeEvidenceRef => 'evidence_manifest_aggregate' in ref);
      if (refs.length) reused.push({ phase, obligation_ids: obligationsForPhase.map(o => o.id), evidence_refs: refs });
    }
  }
  return validateExecutionScope({ schema_version: '1.0', completion_target: request.completion_target, requested_results: [...request.requested_results], obligations, phase_chain: chain, reused_phases: reused, unresolved,
    policy_fingerprint: executionScopeFingerprint({ workflow, contracts: input.contract_fingerprints }), ...(edges.length ? { control_edges: structuredClone(edges) } : {}),
    // Carried so every revision rebuild inherits the sourced impact judgement instead of
    // silently dropping it (which would send device back to `unknown` on each revision).
    ...(request.impact ? { request_impact: structuredClone(request.impact) } : {}) });
}

export function executionCompletionPhases(scope: ExecutionScope): string[] {
  validateExecutionScope(scope);
  return [...new Set([...scope.reused_phases.map(p => p.phase), ...scope.phase_chain])];
}
