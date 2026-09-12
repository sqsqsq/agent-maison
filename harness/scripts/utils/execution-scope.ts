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
  run_id: string;
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
}

/** These are sourced observations from P1/P3–P6, not phase verdicts or a second task ledger. */
export interface ExecutionScopeInput {
  request: {
    completion_target: 'request' | 'feature';
    requested_results: string[];
    requested_phases: string[];
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

/** Birth-only code observations; current outputs remain bound by phase evidence. */
export function isExecutionSourceBasis(projectRoot: string, scope: ExecutionScope, obligation: ExecutionObligation, dependency: ResolutionDependency): boolean {
  return isInsideProjectRoot(projectRoot, dependency.path) && dependency.role === 'derive'
    && (scope.phase_chain.includes(obligation.owner_phase) || !!obligation.satisfied_by?.some(proof => 'run_id' in proof))
    && ['implementation', 'code-review', 'unit-evidence', 'device-evidence', 'visual-evidence'].includes(obligation.kind);
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
    if (!o || typeof o.id !== 'string' || !o.id || ids.has(o.id) || !o.kind || !o.owner_phase || !o.reason || !['required', 'not_applicable', 'unknown'].includes(o.applicability) || !Array.isArray(o.basis)) fail('义务字段或身份非法');
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
    if (after >= 0 && (before >= after || (before < 0 && !scope.obligations.some(o => o.owner_phase === edge.before && o.satisfied_by?.some(ref => 'run_id' in ref && ref.phase === edge.before))))) fail('冻结范围违反真实控制顺序');
  }
  return scope;
}

/** One pure resolver shared by interactive entry and Goal birth. Execution results are not inputs. */
export function resolveExecutionScope(input: ExecutionScopeInput, workflow: WorkflowSpec, acceptance?: { value: AcceptanceSpec; binding: InputBinding }): ExecutionScope {
  const projectRequest = input.request.completion_target === 'request' && input.request.requested_phases.length > 0
    && input.request.requested_phases.every(id => workflow.artifacts.some(a => a.id === id && a.scope === 'global'));
  if (workflow.schema_version !== '1.2' && !projectRequest) fail('动态范围要求 workflow 1.2');
  if (projectRequest) {
    // Native project phases have request endpoints; requires is information, not auto-execution.
    workflow = { ...workflow, artifacts: workflow.artifacts.filter(a => input.request.requested_phases.includes(a.id)).map(a => ({ ...a, obligation_provider_id: a.obligation_provider_id ?? 'obligations.project' })) };
  }
  input = structuredClone(input);
  const request = input.request;
  if (acceptance) {
    const invalid = checkAcceptanceUtLayerComplete({ featureSpec: { acceptance: acceptance.value } } as CheckContext, (_ctx, _section, id) => id).some(check => check.status === 'FAIL');
    for (const [kind, ids] of [['unit-evidence', invalid ? [] : collectUnitScopeIds(acceptance.value)], ['device-evidence', invalid ? [] : collectDeviceScopeIds(acceptance.value)]] as const) {
      const provider = kind === 'unit-evidence' ? 'obligations.ut' : 'obligations.testing';
      if (request.completion_target !== 'feature' && !workflow.artifacts.some(a => a.obligation_provider_id === provider && request.requested_phases.includes(a.id))) continue;
      const id = `${kind}:acceptance`;
      const previous = input.facts.find(fact => fact.id === id);
      const unknownNfr = kind === 'device-evidence' && hasUnknownPerformanceLayer(acceptance.value);
      const applicability: ObligationApplicability = invalid || unknownNfr ? 'unknown' : ids.length ? 'required' : 'not_applicable';
      const fact = { id, kind, applicability, reason: invalid ? '验收分层尚不可用' : unknownNfr ? '性能义务所需验证层待确定' : `${kind}: ${ids.join(',') || '无该层验收'}`, basis: [acceptance.binding] };
      if (previous) Object.assign(previous, fact); else input.facts.push(fact);
    }
  }
  if (request.completion_target === 'feature') {
    for (const [kind, provider] of [['unit-evidence', 'obligations.ut'], ['device-evidence', 'obligations.testing']]) {
      if (!input.facts.some(f => f.kind === kind) && !workflow.artifacts.some(a => a.obligation_provider_id === provider && request.requested_phases.includes(a.id))) {
        input.facts.push({ id: `${kind}:pending`, kind, applicability: 'unknown', reason: '验证责任尚缺验收或影响依据', basis: [] });
      }
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
      obligations.push({ id: `${kinds[0]}:request:${artifact.id}`, kind: kinds[0], owner_phase: artifact.id, applicability: 'required', reason: `用户明确请求 ${artifact.id}`, basis: [] });
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
  // Definition gaps block their actual downstream consumers; investigation itself remains executable.
  for (const gap of unresolved) {
    const kind = obligations.find(o => o.id === gap.obligation_id)!.kind;
    if (kind === 'acceptance-context' || kind === 'design-context') {
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
  for (const edge of edges) if (!needed.has(edge.before) && !obligations.some(o => o.owner_phase === edge.before && o.satisfied_by?.some(ref => 'run_id' in ref && ref.phase === edge.before))) fail(`真实控制前置尚未满足：${edge.before} → ${edge.after}`);
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
      const refs = obligationsForPhase.flatMap(o => o.satisfied_by ?? []).filter((ref): ref is ScopeEvidenceRef => 'run_id' in ref);
      if (refs.length) reused.push({ phase, obligation_ids: obligationsForPhase.map(o => o.id), evidence_refs: refs });
    }
  }
  return validateExecutionScope({ schema_version: '1.0', completion_target: request.completion_target, requested_results: [...request.requested_results], obligations, phase_chain: chain, reused_phases: reused, unresolved,
    policy_fingerprint: executionScopeFingerprint({ workflow, contracts: input.contract_fingerprints }), ...(edges.length ? { control_edges: structuredClone(edges) } : {}) });
}

export function executionCompletionPhases(scope: ExecutionScope): string[] {
  validateExecutionScope(scope);
  return [...new Set([...scope.reused_phases.map(p => p.phase), ...scope.phase_chain])];
}
