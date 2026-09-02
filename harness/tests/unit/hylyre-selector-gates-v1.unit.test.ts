/**
 * hylyre-selector-gates-v1 — D1 运行时门。
 *
 * 这套用例的存在意义是把事故那条链的**第二刀**钉死：静态门误杀入口之后，旧运行时门
 * 还有一条「canonical ui-spec 映射为空即失败」的封闭世界分支再补一刀。新门不看 ui-spec，
 * 也不裁决成败，只复算 resolution 状态机并汇总已证明身份。
 */
import * as assert from 'assert';
import {
  evaluateSelectorRuntimeV1,
  hasProvenIdentity,
} from '../../scripts/utils/hylyre-selector-gates-v1';
import type { StepResultV1, TraceV1 } from '../../scripts/utils/hylyre-result-protocol';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function step(index: number, selector: unknown, outcome?: StepResultV1['outcome']): StepResultV1 {
  return {
    index, kind: 'touch', role: 'action', duration_ms: 1, device_session: true,
    outcome: outcome ?? { status: 'passed', observation: { kind: 'action', operation: 'touch', performed: true, facts: {} } },
    selector: selector as StepResultV1['selector'],
    artifacts: [], diagnostic: null, extensions: {},
  };
}

const trace = (steps: StepResultV1[], id = 'TC-001'): TraceV1 =>
  ({ cases: [{ id, steps }] } as unknown as TraceV1);

const sel = (kind: string, value: string, resolution: unknown) =>
  ({ request: { kind, value }, resolution });

test('native by_text 的 passed + not_attempted 是合法形态，不产生任何 violation', () => {
  const r = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_text', '添加卡片', { state: 'not_attempted', candidate_count: null, selected: null, candidates: [] })),
  ]));
  assert.deepStrictEqual(r.violations, [], '旧口径会在这里误杀整片 by_text');
  assert.strictEqual(r.provenIdentitiesByCase.size, 0, 'not_attempted 不得获得 identity credit');
});

test('不做封闭世界：不在 feature ui-spec 的既有入口，真机唯一命中即通过', () => {
  // 该门根本不读 ui-spec —— 这里用一个 ui-spec 里肯定没有的 id 证明这一点。
  const r = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_id', 'card_category_row_c1',
      { state: 'unique', candidate_count: 1, selected: { id: 'card_category_row_c1' }, candidates: [] })),
  ]));
  assert.deepStrictEqual(r.violations, []);
  assert.ok(hasProvenIdentity(r, 'TC-001', 'card_category_row_c1'));
});

test('resolver 解析文本节点：unique + id=null + bounds 非空 合法，但不构成 by_id 身份证明', () => {
  const r = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_text', '我的卡包',
      { state: 'unique', candidate_count: 1, selected: { id: null, bounds: '[0,0][10,10]' }, candidates: [] })),
  ]));
  assert.deepStrictEqual(r.violations, []);
  // 身份护栏：bounds-only 命中不能替代 required_element_ids 的 id 身份
  assert.strictEqual(hasProvenIdentity(r, 'TC-001', 'card_pack_title'), false);
});

test('回填冒充身份被单独分类（identity_impersonated）', () => {
  const r = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_text', '添加卡片',
      { state: 'unique', candidate_count: 1, selected: { id: '添加卡片' }, candidates: [] })),
  ]));
  assert.strictEqual(r.violations.length, 1);
  assert.strictEqual(r.violations[0]!.code, 'identity_impersonated');
});

test('状态机不变量违例被拦，但 passed absence 的 not_found/0/null 合法', () => {
  const bad = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_id', 'x', { state: 'unique', candidate_count: 3, selected: { id: 'x' }, candidates: [] })),
  ]));
  assert.strictEqual(bad.violations[0]!.code, 'resolution_invariant_violated');

  const absence = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_id', 'error_banner', { state: 'not_found', candidate_count: 0, selected: null, candidates: [] }),
      { status: 'passed', observation: { kind: 'assertion', assertion_type: 'absence', matched: true, facts: {} } }),
  ]));
  assert.deepStrictEqual(absence.violations, [], '通过的 absence 断言正是 not_found/0/null');
});

test('失败步骤不因 resolution 被洗白，也不因 resolution 被二次判失败', () => {
  // failed + not_attempted：既不产生 selector violation（成败不归本门），
  // 也不会被本门改判成通过——成败始终由 outcome 承载。
  const r = evaluateSelectorRuntimeV1(trace([
    step(0, sel('by_text', '添加卡片', { state: 'not_attempted', candidate_count: null, selected: null, candidates: [] }),
      { status: 'failed', failure: { domain: 'assertion', code: 'assertion.mismatch' } }),
  ]));
  assert.deepStrictEqual(r.violations, []);
  assert.strictEqual(r.provenIdentitiesByCase.size, 0);
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
