// ============================================================================
// hylyre-crossrow-verifier.ts — Step Outcome v1 跨行不变量校验（plan a6c4e9f2 T4 返修）
// ----------------------------------------------------------------------------
// 为什么必须有这一层：冻结 `output-schema.json` 只能表达单行结构。实测把
// `golden/trace/invalid-crossrow/` 13 条**全部非法**的 trace 喂给 schema 校验，
// 13 条全部通过——prior_step 指向错根、CaseResult 三轴与 steps 不自洽、
// run outcome 反推不上、candidate_count 与 candidates 对不上、tool_calls 自造根因，
// 这些都是 JSON Schema 表达不了的。只做 schema 校验就等于给这 13 类放行。
//
// 判据来源不是本仓自拟：冻结包自带可执行 oracle
// `contracts/reference_reducer.py::verify_trace`，本文件是它的忠实移植。
// 两边必须对同一批 golden 给出同样结论，因此单测直接跑 valid/invalid-crossrow 全集。
//
// 调用次序有要求：**先 schema 校验、后跨行校验**。reference 的前提就是文档已合 schema
// （它直接 `step["outcome"]["status"]`，缺字段在 Python 侧是 KeyError）；本移植同样
// 假定结构已合法，只判跨行关系。
// ============================================================================

import { verifyPriorStepReferences } from './hylyre-failure-routing-v1';
import type { CaseResultV1, StepResultV1, TraceV1 } from './hylyre-result-protocol';

const SCREEN_ARTIFACT_KINDS = new Set(['screenshot', 'ui_dump', 'visible_elements']);
const EXPECTED_EXCLUDED_MODES = new Set(['disabled_by_flag', 'unavailable_no_vlm']);

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function statusOf(step: StepResultV1): string {
  return String(step.outcome.status);
}

/** 根阻断：blocked 且 cause 是 capability/infrastructure（不是被别的步骤连累）。 */
function isRootBlocked(step: StepResultV1): boolean {
  const outcome = step.outcome;
  if (outcome.status !== 'blocked') return false;
  const type = outcome.cause?.type;
  return type === 'capability' || type === 'infrastructure';
}

/** §8.1：截图能力当场不可用的显式标记——它让 evidence 降级为 incomplete，而不是伪造截图。 */
function captureUnavailable(step: StepResultV1): boolean {
  const capture = asRecord(asRecord(step.extensions)?.['hylyre.capture']);
  return capture?.screen === 'unavailable';
}

/** §8.1：这一行是否欠一张失败边界截图。 */
function boundaryApplies(step: StepResultV1): boolean {
  const outcome = step.outcome;
  if (!step.device_session) return false;
  if (outcome.status !== 'failed') return false;
  const domain = outcome.failure?.domain;
  return domain === 'selector' || domain === 'assertion';
}

/** §9.2：参与 verification 判定的断言行。 */
export function requiredAssertions(steps: StepResultV1[], expectedCheckMode: string): StepResultV1[] {
  return steps.filter(
    s => s.role === 'assertion' &&
      !(s.kind === 'expected_check' && EXPECTED_EXCLUDED_MODES.has(expectedCheckMode)),
  );
}

/** §9.1 */
function reduceExecution(steps: StepResultV1[]): string {
  for (const step of steps) {
    const outcome = step.outcome;
    if (outcome.status === 'failed' && outcome.failure?.domain === 'infrastructure') {
      return 'infrastructure_failed';
    }
    if (outcome.status === 'blocked' && outcome.cause?.type === 'infrastructure') {
      return 'infrastructure_failed';
    }
  }
  for (const step of steps) {
    if (statusOf(step) === 'failed' || isRootBlocked(step)) return 'aborted';
  }
  return 'completed';
}

/** §9.3 */
function reduceEvidence(steps: StepResultV1[], expectedCheckMode: string): string {
  // reference 用 `id(s)` 做对象同一性；这里用引用集合，语义一致。
  const required = new Set(requiredAssertions(steps, expectedCheckMode));
  for (const step of steps) {
    if (boundaryApplies(step) && captureUnavailable(step)) return 'incomplete';
    // 用 outcome.status 直接窄化——observation 只在 passed 分支上存在。
    if (step.outcome.status !== 'passed') continue;
    const observation = step.outcome.observation;
    if (!observation) return 'incomplete';
    if (
      required.has(step) &&
      (observation as unknown as AnyRecord).assertion_type === 'toast' &&
      asRecord((observation as unknown as AnyRecord).facts)?.trigger_window_covered !== true
    ) {
      return 'incomplete';
    }
  }
  return 'complete';
}

/** §9.2 */
function reduceVerification(
  steps: StepResultV1[],
  expectedCheckMode: string,
  execution: string,
  evidence: string,
): string {
  if (execution !== 'completed') return 'failed';
  if (steps.some(s => statusOf(s) === 'failed' || statusOf(s) === 'blocked')) return 'failed';
  const required = requiredAssertions(steps, expectedCheckMode);
  if (required.length === 0) return 'inconclusive';
  if (required.some(s => statusOf(s) === 'skipped')) return 'inconclusive';
  if (!required.every(s => statusOf(s) === 'passed')) return 'inconclusive';
  if (evidence !== 'complete') return 'inconclusive';
  if (expectedCheckMode === 'checked_vlm') {
    const expectedRows = steps.filter(s => s.kind === 'expected_check');
    if (expectedRows.length !== 1 || statusOf(expectedRows[0]) !== 'passed') return 'inconclusive';
  }
  return 'passed';
}

/** §9.5：中文 legacy status 是**派生投影**，不是独立事实源。 */
function reduceLegacyStatus(steps: StepResultV1[], execution: string, verification: string): string {
  if (execution === 'infrastructure_failed') return '阻塞';
  if (verification === 'passed') return '通过';
  if (steps.some(s => statusOf(s) === 'failed')) return '失败';
  if (steps.some(s => statusOf(s) === 'blocked')) return '阻塞';
  return '跳过';
}

export interface ReducedCase {
  execution: string;
  verification: string;
  evidence: string;
  status: string;
}

/** 由 steps 反推一个 case 的四个派生值。 */
export function reduceCase(traceCase: CaseResultV1): ReducedCase {
  const steps = [...(traceCase.steps ?? [])];
  const mode = String(traceCase.expected_check_mode);
  const execution = reduceExecution(steps);
  const evidence = reduceEvidence(steps, mode);
  const verification = reduceVerification(steps, mode, execution, evidence);
  return { execution, verification, evidence, status: reduceLegacyStatus(steps, execution, verification) };
}

/** §9.6，首条命中者胜。读的是 case 上**声明**的三轴（声明与反推是否一致另行比对）。 */
export function runOutcome(cases: CaseResultV1[]): string {
  if (cases.length === 0) return 'aborted';
  const fullyPassed = cases.filter(
    c => c.execution === 'completed' && c.verification === 'passed' && c.evidence === 'complete',
  );
  if (fullyPassed.length === cases.length) return 'success';
  if (
    cases.some(
      c => c.execution === 'infrastructure_failed' ||
        (c.steps ?? []).some(s => statusOf(s) === 'blocked'),
    )
  ) {
    return 'failed';
  }
  if (cases.some(c => c.verification === 'failed')) return fullyPassed.length > 0 ? 'partial' : 'failed';
  return 'partial';
}

/** §12：给定这批 case，`tool_calls` 唯一合法取值。 */
export function toolCallsProjection(cases: CaseResultV1[]): AnyRecord[] {
  const calls: AnyRecord[] = [];
  for (const traceCase of cases) {
    for (const step of traceCase.steps ?? []) {
      const outcome = step.outcome;
      const status = outcome.status;
      const projection: AnyRecord = { status };
      if (status === 'failed') {
        projection.failure = { domain: outcome.failure.domain, code: outcome.failure.code };
      } else if (status === 'blocked') {
        const cause = outcome.cause as unknown as AnyRecord;
        projection.cause = cause.type === 'prior_step'
          ? { type: 'prior_step', step_index: cause.step_index }
          : { type: cause.type, code: cause.code };
      } else if (status === 'skipped') {
        projection.reason = { type: outcome.reason.type, code: outcome.reason.code };
      }
      calls.push({
        case: traceCase.id,
        index: step.index,
        kind: step.kind,
        role: step.role,
        outcome: projection,
      });
    }
  }
  return calls;
}

/** Python dict/list `==` 是深比较且与键序无关；这里等价实现。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const ra = asRecord(a);
  const rb = asRecord(b);
  if (!ra || !rb) return false;
  const ka = Object.keys(ra);
  const kb = Object.keys(rb);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(rb, k) && deepEqual(ra[k], rb[k]));
}

/** §6.1 豁免：不可计数的 unresolvable 允许只列出部分候选，此时不回填 candidate_count。 */
function candidateCountExempt(resolution: AnyRecord): boolean {
  return resolution.state === 'unresolvable' && asRecord(resolution.facts)?.candidate_countable === false;
}

/** §6.1：candidate_count 必须能从 candidates 复算。 */
function verifySelectors(traceCase: CaseResultV1): string[] {
  const problems: string[] = [];
  for (const step of traceCase.steps ?? []) {
    const selector = asRecord(step.selector);
    if (!selector) continue;
    const resolution = asRecord(selector.resolution);
    if (!resolution) continue;
    const candidates = Array.isArray(resolution.candidates) ? resolution.candidates : [];
    if (candidates.length === 0) continue;
    if (candidateCountExempt(resolution)) continue;
    if (resolution.candidate_count !== candidates.length) {
      problems.push(
        `${traceCase.id}:${step.index}: candidate_count ${String(resolution.candidate_count)} ` +
        `与 candidates 实际 ${candidates.length} 项不符`,
      );
    }
  }
  return problems;
}

/** §9.7 / 判定表 D-28：checked_vlm 不允许把 expected_check 写成 skipped。 */
function verifyExpectedCheckPolicy(traceCase: CaseResultV1): string[] {
  if (traceCase.expected_check_mode !== 'checked_vlm') return [];
  const problems: string[] = [];
  for (const step of traceCase.steps ?? []) {
    if (step.kind !== 'expected_check') continue;
    if (statusOf(step) === 'skipped') {
      const code = (step.outcome as AnyRecord & { reason?: AnyRecord }).reason?.code;
      problems.push(
        `${traceCase.id}:${step.index}: expected_check_mode=checked_vlm 不得携带 skipped/${String(code)}`,
      );
    }
  }
  return problems;
}

/** §8.1：根失败必须留下失败边界截图，或显式标 capture 不可用。 */
function verifyBoundaryArtifacts(traceCase: CaseResultV1): string[] {
  const problems: string[] = [];
  for (const step of traceCase.steps ?? []) {
    if (!boundaryApplies(step)) continue;
    const artifacts = Array.isArray(step.artifacts) ? step.artifacts : [];
    const hasScreen = artifacts.some(a => SCREEN_ARTIFACT_KINDS.has(String(asRecord(a)?.kind)));
    if (!hasScreen && !captureUnavailable(step)) {
      problems.push(
        `${traceCase.id}:${step.index}: 根失败既无失败边界截图，也无 capture-unavailable 标记`,
      );
    }
  }
  return problems;
}

/**
 * 返回一份 0.4-p0 trace 的全部跨行违规（干净时为空数组）。
 *
 * 前提：`trace` 已通过冻结 `output-schema.json` 校验。
 */
export function verifyTraceCrossRow(trace: TraceV1): string[] {
  const problems: string[] = [];
  const cases = [...(trace.cases ?? [])];

  const seen = new Set<string>();
  for (const traceCase of cases) {
    if (seen.has(traceCase.id)) problems.push(`case id 重复：${traceCase.id}`);
    seen.add(traceCase.id);

    const indexes = (traceCase.steps ?? []).map(s => s.index);
    if (indexes.length !== new Set(indexes).size) problems.push(`${traceCase.id}: step index 重复`);

    problems.push(...verifyPriorStepReferences(traceCase));
    problems.push(...verifySelectors(traceCase));
    problems.push(...verifyExpectedCheckPolicy(traceCase));
    problems.push(...verifyBoundaryArtifacts(traceCase));

    const derived = reduceCase(traceCase);
    for (const axis of ['execution', 'verification', 'evidence', 'status'] as const) {
      const declared = (traceCase as unknown as AnyRecord)[axis];
      if (declared !== derived[axis]) {
        problems.push(`${traceCase.id}: ${axis}=${JSON.stringify(declared)} 但由 steps 反推应为 ${JSON.stringify(derived[axis])}`);
      }
    }
  }

  const expectedOutcome = runOutcome(cases);
  if (trace.outcome !== expectedOutcome) {
    problems.push(`run outcome=${JSON.stringify(trace.outcome)} 但由 cases 反推应为 ${JSON.stringify(expectedOutcome)}`);
  }

  const expectedCalls = toolCallsProjection(cases);
  if (!deepEqual(trace.tool_calls ?? [], expectedCalls)) {
    problems.push('tool_calls 不是 cases[].steps[] 的投影——不得自造根因或改写归因');
  }

  return problems;
}
