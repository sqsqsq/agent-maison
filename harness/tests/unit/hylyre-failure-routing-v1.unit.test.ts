/**
 * hylyre-failure-routing-v1 — T4 基数不变式与 Q8 多根语义。
 *
 * 真形态用冻结包 golden（`case/valid/bc-opencard-1.json`）当 oracle：它正是事故那一轮的
 * 「1 根 failed + 未执行后缀 + policy skipped」，旧实现在同一份数据上会产出 N+2 条 BLOCKER。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  collectFailureRoutesV1,
  hasPassedActionBefore,
  routeFailedStepV1,
  verifyPriorStepReferences,
} from '../../scripts/utils/hylyre-failure-routing-v1';
import type { CaseResultV1, StepResultV1, TraceV1 } from '../../scripts/utils/hylyre-result-protocol';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const GOLDEN = path.resolve(__dirname, '..', 'fixtures', 'hylyre-contracts-0.4-p0', 'contracts', 'golden');

function step(partial: Partial<StepResultV1> & { index: number; outcome: StepResultV1['outcome'] }): StepResultV1 {
  return {
    kind: 'touch',
    role: 'action',
    duration_ms: 1,
    device_session: null,
    selector: null,
    artifacts: [],
    diagnostic: null,
    extensions: {},
    ...partial,
  } as StepResultV1;
}

function traceOf(steps: StepResultV1[], id = 'TC-001'): TraceV1 {
  return { cases: [{ id, steps } as unknown as CaseResultV1] } as unknown as TraceV1;
}

const passedAction = (index: number): StepResultV1 =>
  step({ index, role: 'action', outcome: { status: 'passed', observation: { kind: 'action', operation: 'touch', performed: true, facts: {} } } });

const failed = (index: number, domain: string, code: string, role: 'action' | 'assertion' = 'assertion'): StepResultV1 =>
  step({ index, role, outcome: { status: 'failed', failure: { domain: domain as never, code } } });

const blockedPrior = (index: number, root: number): StepResultV1 =>
  step({ index, outcome: { status: 'blocked', cause: { type: 'prior_step', step_index: root } } });

const blockedCause = (index: number, type: 'capability' | 'infrastructure', code: string): StepResultV1 =>
  step({ index, outcome: { status: 'blocked', cause: { type, code, ...(type === 'capability' ? { capability_id: 'toast_listener' } : {}), facts: { probe_status: 'unsupported', probe_source: 'runtime_preflight' } } } });

const skippedPolicy = (index: number): StepResultV1 =>
  step({ index, outcome: { status: 'skipped', reason: { type: 'policy', code: 'expected_check.disabled_by_flag' } } });

test('D3 根治：一根 failed + N 个 blocked/prior_step + 1 个 policy skipped → 恰好 1 条 route', () => {
  const steps = [
    passedAction(0), passedAction(1), failed(2, 'selector', 'selector.not_found'),
    blockedPrior(3, 2), blockedPrior(4, 2), blockedPrior(5, 2), blockedPrior(6, 2),
    skippedPolicy(7),
  ];
  const { routes, dispositions } = collectFailureRoutesV1(traceOf(steps));
  assert.strictEqual(routes.length, 1, `未执行的行不得再造 route，实际 ${routes.length}`);
  assert.strictEqual(routes[0]!.stepIndex, 2);
  assert.strictEqual(routes[0]!.domain, 'selector');
  assert.strictEqual(dispositions.length, 0, 'prior_step / policy skipped 不产 disposition');
});

test('冻结包 bc-opencard-1 真形态：同样只产 1 条 route', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'case/valid/bc-opencard-1.json'), 'utf-8')) as CaseResultV1;
  const { routes, dispositions } = collectFailureRoutesV1({ cases: [golden] } as unknown as TraceV1);
  assert.strictEqual(routes.length, 1, `事故那一轮的真数据必须只产一条 route，实际 ${routes.length}`);
  assert.strictEqual(dispositions.length, 0);
  assert.deepStrictEqual(verifyPriorStepReferences(golden), [], 'golden 正例的跨行引用应全部合法');
});

test('blocked cause：capability / infrastructure 各投一次 disposition，零 route，且 prior_step 不重复投影', () => {
  const cap = collectFailureRoutesV1(traceOf([
    blockedCause(0, 'capability', 'capability.unsupported'),
    blockedPrior(1, 0), blockedPrior(2, 0),
  ]));
  assert.strictEqual(cap.routes.length, 0);
  assert.strictEqual(cap.dispositions.length, 1);
  assert.strictEqual(cap.dispositions[0]!.disposition, 'capability_defer');

  const infra = collectFailureRoutesV1(traceOf([
    blockedCause(0, 'infrastructure', 'infrastructure.device_unavailable'),
    blockedPrior(1, 0),
  ]));
  assert.strictEqual(infra.routes.length, 0);
  assert.strictEqual(infra.dispositions.length, 1);
  assert.strictEqual(infra.dispositions[0]!.disposition, 'external_toolchain');
});

test('failed capability/infrastructure：1 条 route 且自带 disposition、零 coding', () => {
  const cap = collectFailureRoutesV1(traceOf([passedAction(0), failed(1, 'capability', 'capability.unsupported')]));
  assert.strictEqual(cap.routes.length, 1);
  assert.strictEqual(cap.routes[0]!.disposition, 'capability_defer');
  assert.strictEqual(cap.routes[0]!.codingCandidate, false);

  const infra = collectFailureRoutesV1(traceOf([failed(0, 'infrastructure', 'infrastructure.transport_unavailable')]));
  assert.strictEqual(infra.routes[0]!.disposition, 'external_toolchain');
  assert.strictEqual(infra.routes[0]!.owner, 'external');
});

test('wrong-screen 准入：无较小 index 已通过 action 时 assertion 失败零 coding，有则可投', () => {
  const wrongScreen = collectFailureRoutesV1(traceOf([failed(0, 'assertion', 'assertion.mismatch')]));
  assert.strictEqual(wrongScreen.routes.length, 1);
  assert.strictEqual(wrongScreen.routes[0]!.owner, 'testing');
  assert.strictEqual(wrongScreen.routes[0]!.codingCandidate, false);

  const admitted = collectFailureRoutesV1(traceOf([passedAction(0), failed(1, 'assertion', 'assertion.mismatch')]));
  assert.strictEqual(admitted.routes[0]!.owner, 'coding');
  assert.strictEqual(admitted.routes[0]!.codingCandidate, true);

  // 前置 action 自己失败，不算"已通过"
  const failedAction = collectFailureRoutesV1(traceOf([
    failed(0, 'selector', 'selector.not_found', 'action'),
    failed(1, 'assertion', 'assertion.mismatch'),
  ]));
  assert.strictEqual(failedAction.routes.length, 2, '两个真实 failed 各自一条 route');
  assert.strictEqual(failedAction.routes[1]!.codingCandidate, false);
  assert.strictEqual(hasPassedActionBefore([failed(0, 'selector', 'selector.not_found', 'action')], 1), false);
});

test('多个真实 failed 各自一条 route，不做 first-only 去重', () => {
  const { routes } = collectFailureRoutesV1(traceOf([
    failed(0, 'selector', 'selector.not_found'),
    passedAction(1),
    failed(2, 'assertion', 'assertion.mismatch'),
  ]));
  assert.strictEqual(routes.length, 2);
  assert.deepStrictEqual(routes.map(r => r.stepIndex), [0, 2]);
});

// Q8 裁决：prior_step 可引用同 case 内任意更早的 eligible root，不要求最近根。
test('Q8 多根：引用较早而非最近的根合法，且不影响任何投影基数', () => {
  const steps = [
    failed(0, 'selector', 'selector.not_found'),
    passedAction(1),
    failed(2, 'assertion', 'assertion.mismatch'),
    blockedPrior(3, 0), // 指向较早的根，而不是最近的 index=2
  ];
  const c = { id: 'TC-001', steps } as unknown as CaseResultV1;
  assert.deepStrictEqual(verifyPriorStepReferences(c), [], '引用较早的合法根不得判非法');
  const { routes, dispositions } = collectFailureRoutesV1({ cases: [c] } as unknown as TraceV1);
  assert.strictEqual(routes.length, 2, '两个真实 failed 各一条，与 prior_step 选了哪个根无关');
  assert.strictEqual(dispositions.length, 0);
});

// Hylyre 为 Q8 专门冻结的钉死 fixture：同 case 内 index 0/1 两个合法根，index 2 故意引用**较早**的 0。
// 场景真实——batch `on_fail=skip` 下失败后会继续执行，因此同 case 多根是会发生的形态。
test('Q8 冻结 golden：prior-step-references-an-earlier-root 被接受，且引用的是较早根', () => {
  const trace = JSON.parse(fs.readFileSync(
    path.join(GOLDEN, 'trace/valid/prior-step-references-an-earlier-root.json'), 'utf-8',
  )) as TraceV1;
  const target = trace.cases[0]!;

  assert.deepStrictEqual(verifyPriorStepReferences(target), [], '冻结正例不得被判非法');

  const roots = target.steps.filter(s => s.outcome.status === 'failed').map(s => s.index);
  assert.ok(roots.length >= 2, '该 fixture 应含两个合法根');
  const priorRefs = target.steps
    .filter(s => s.outcome.status === 'blocked' && s.outcome.cause.type === 'prior_step')
    .map(s => (s.outcome as { cause: { step_index: number } }).cause.step_index);
  assert.strictEqual(priorRefs.length, 1);
  assert.strictEqual(priorRefs[0], Math.min(...roots), '应引用较早的根');
  assert.notStrictEqual(priorRefs[0], Math.max(...roots), 'nearest-only 若被误实现，这条会红');

  // 投影基数不受"选了哪个合法根"影响。
  const { routes, dispositions } = collectFailureRoutesV1(trace);
  assert.strictEqual(routes.length, roots.length, '每个真实 failed 各一条 route');
  assert.strictEqual(dispositions.length, 0, 'prior_step 行零 disposition');
});

test('Q8 非法引用：跨 case、向后引用、指向另一个 prior_step 均被拒', () => {
  // 跨 case：引用的是更小 index，但该 index 不在本 case 的 steps 里（根在别的 case）。
  const crossCase = { id: 'TC-002', steps: [step({ index: 3, outcome: { status: 'blocked', cause: { type: 'prior_step', step_index: 1 } } })] } as unknown as CaseResultV1;
  assert.ok(
    verifyPriorStepReferences(crossCase).some(p => /不在同一 case/.test(p)),
    '设备中途死亡后，后续 case 必须自建 root，不得跨 case 引用 index',
  );

  // 向后/同索引引用
  const forward = { id: 'TC-001', steps: [blockedPrior(0, 1), failed(1, 'selector', 'selector.not_found')] } as unknown as CaseResultV1;
  assert.ok(verifyPriorStepReferences(forward).some(p => /只能引用更小 index/.test(p)));

  const chained = { id: 'TC-001', steps: [failed(0, 'selector', 'selector.not_found'), blockedPrior(1, 0), blockedPrior(2, 1)] } as unknown as CaseResultV1;
  assert.ok(
    verifyPriorStepReferences(chained).some(p => /必须指向真实根/.test(p)),
    'prior_step → prior_step 链必须被拒',
  );

  const toPassed = { id: 'TC-001', steps: [passedAction(0), blockedPrior(1, 0)] } as unknown as CaseResultV1;
  assert.ok(verifyPriorStepReferences(toPassed).some(p => /必须指向真实根/.test(p)));
});

test('只有 diagnostic、没有 facts 的 capability cause 不得驱动 defer', () => {
  const noFacts = step({ index: 0, outcome: { status: 'blocked', cause: { type: 'capability', code: 'capability.unsupported', capability_id: 'x' } } });
  const { dispositions } = collectFailureRoutesV1(traceOf([noFacts]));
  assert.strictEqual(dispositions.length, 0, '缺 probe facts 时不得投 defer');
});

test('未尝试的行进入责任路由是编程错误，边界必须立刻抛错', () => {
  assert.throws(
    () => routeFailedStepV1('TC-001', blockedPrior(1, 0), []),
    /只消费 outcome.status=failed/,
  );
});

export function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return Promise.resolve(results);
}
