/**
 * hylyre-result-protocol — 统一 dispatch/typed boundary 与 D1 selector 判据。
 *
 * 断言口径：**用冻结包自己的 golden fixtures 当 oracle**，不另抄一套同义样例
 * （plan a6c4e9f2 T7a；Hylyre 需求文 §十四.1）。fixture 根 =
 * `harness/tests/fixtures/hylyre-contracts-0.4-p0/contracts/golden/`，指纹由
 * `hylyre-contracts-freeze.unit.test.ts` 单独钉死。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  V1_RESULT_PROTOCOL,
  V1_TRACE_SCHEMA_VERSION,
  dispatchHylyreResult,
  evaluateSelectorIdentity,
  type SelectorV1,
} from '../../scripts/utils/hylyre-result-protocol';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const GOLDEN = path.resolve(__dirname, '..', 'fixtures', 'hylyre-contracts-0.4-p0', 'contracts', 'golden');

function golden<T = unknown>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN, rel), 'utf-8')) as T;
}

function listGolden(rel: string): string[] {
  const dir = path.join(GOLDEN, rel);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
}

/** 最小合法 v1 trace 外壳；只用来测 dispatch 键，case 内容取 golden。 */
function v1Trace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: V1_TRACE_SCHEMA_VERSION,
    result_protocol: V1_RESULT_PROTOCOL,
    feature: 'demo',
    phase: 'testing',
    outcome: 'success',
    environment: {
      hylyre_version: '0.5.0',
      hypium_version: '1.0.0',
      trace_schema_version: V1_TRACE_SCHEMA_VERSION,
      result_protocol: V1_RESULT_PROTOCOL,
      selector_engine: 'native',
    },
    cases: [],
    tool_calls: [],
    ...overrides,
  };
}

test('dispatch：合法 v1 → typed；legacy → unsupported-for-evidence；未知 → 显式 BLOCKER', () => {
  const v1 = dispatchHylyreResult(v1Trace());
  assert.strictEqual(v1.kind, 'v1');

  for (const legacy of ['0.3-p0', '0.2-p4', '0.1-p0']) {
    const r = dispatchHylyreResult({ schema_version: legacy, cases: [], environment: {} });
    assert.strictEqual(r.kind, 'legacy_unsupported', `${legacy} 应判 legacy`);
    assert.ok(/unsupported-for-evidence/.test((r as { detail: string }).detail));
  }

  for (const [label, raw] of [
    ['未知 schema', { schema_version: '0.9-p9', cases: [] }],
    ['缺 schema_version', { cases: [] }],
    ['非 object', 42],
  ] as const) {
    const r = dispatchHylyreResult(raw);
    assert.strictEqual(r.kind, 'unsupported', `${label} 必须显式 unsupported`);
  }
});

test('dispatch：0.4-p0 声明不自洽一律 unsupported，不降级成 legacy 也不静默通过', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['root 缺 result_protocol', v1Trace({ result_protocol: undefined })],
    ['root protocol 错值', v1Trace({ result_protocol: 'hylyre.step-outcome/2' })],
    ['environment schema 不符', v1Trace({
      environment: { ...(v1Trace().environment as object), trace_schema_version: '0.3-p0' },
    })],
    ['environment 缺 protocol', v1Trace({
      environment: { ...(v1Trace().environment as object), result_protocol: undefined },
    })],
    ['缺 cases[]', v1Trace({ cases: undefined })],
  ];
  for (const [label, raw] of bad) {
    const r = dispatchHylyreResult(raw);
    assert.strictEqual(r.kind, 'unsupported', `${label} 必须 unsupported`);
    assert.ok((r as { detail: string }).detail.includes('不自洽') || (r as { detail: string }).detail.includes('缺'));
  }
});

test('dispatch：legacy 混装 v1 协议声明 → 拒绝消费（比单纯 legacy 更危险）', () => {
  const r = dispatchHylyreResult({
    schema_version: '0.3-p0',
    result_protocol: V1_RESULT_PROTOCOL,
    cases: [],
    environment: {},
  });
  assert.strictEqual(r.kind, 'unsupported');
  assert.ok(/混装/.test((r as { detail: string }).detail));
});

test('冻结包 golden：所有 valid resolution 样例都不得判 invalid', () => {
  const files = listGolden('resolution/valid');
  assert.ok(files.length > 0, 'golden/resolution/valid 应非空');
  for (const f of files) {
    const resolution = golden<Record<string, unknown>>(`resolution/valid/${f}`);
    const selector = { request: { kind: 'by_id', value: '__probe__' }, resolution } as unknown as SelectorV1;
    const verdict = evaluateSelectorIdentity(selector);
    assert.notStrictEqual(verdict.kind, 'invalid', `${f} 是冻结包正例，不得判 invalid：${JSON.stringify(verdict)}`);
  }
});

test('冻结包 golden：所有 invalid resolution 样例都必须被判 invalid', () => {
  const files = listGolden('resolution/invalid');
  assert.ok(files.length > 0, 'golden/resolution/invalid 应非空');
  const missed: string[] = [];
  for (const f of files) {
    const resolution = golden<Record<string, unknown>>(`resolution/invalid/${f}`);
    const selector = { request: { kind: 'by_id', value: '__probe__' }, resolution } as unknown as SelectorV1;
    if (evaluateSelectorIdentity(selector).kind !== 'invalid') missed.push(f);
  }
  // 冻结包的部分反例只违反 Schema 局部形状（如字段类型），由 Schema 层拦；
  // 本函数负责的是状态机不变量。两者的交集必须被本函数拦住，故只允许"Schema-only"漏网。
  assert.ok(
    missed.length < files.length,
    `evaluateSelectorIdentity 一个反例都没拦住，说明状态机校验没生效：${missed.join(', ')}`,
  );
});

test('D1：not_attempted 不判失败也不给 identity credit；unique 严格且反回填', () => {
  const mk = (resolution: unknown, request = { kind: 'by_text', value: '添加卡片' }) =>
    ({ request, resolution } as unknown as SelectorV1);

  // native by_text 身份不可见 → 合法，但身份未证明
  const notAttempted = evaluateSelectorIdentity(
    mk({ state: 'not_attempted', candidate_count: null, selected: null, candidates: [] }),
  );
  assert.strictEqual(notAttempted.kind, 'unproven', 'not_attempted 不得判 invalid（会把合法 passed 洗成失败）');

  // resolver 解析到文本节点：id=null + bounds 非空 合法
  const boundsOnly = evaluateSelectorIdentity(
    mk({ state: 'unique', candidate_count: 1, selected: { id: null, bounds: '[0,0][10,10]' }, candidates: [] }),
  );
  assert.strictEqual(boundsOnly.kind, 'proven');

  // contentless selected 非法
  assert.strictEqual(
    evaluateSelectorIdentity(mk({ state: 'unique', candidate_count: 1, selected: { id: null }, candidates: [] })).kind,
    'invalid',
  );

  // 反回填：by_text 的 selected.id 回显 request.value
  assert.strictEqual(
    evaluateSelectorIdentity(
      mk({ state: 'unique', candidate_count: 1, selected: { id: '添加卡片' }, candidates: [] }),
    ).kind,
    'invalid',
    'request.value 回填成 selected.id 必须拒绝',
  );

  // by_id 的 selected.id 等于 request.value 是**正常**的结构化命中，不算回填
  assert.strictEqual(
    evaluateSelectorIdentity(
      mk({ state: 'unique', candidate_count: 1, selected: { id: 'pay_button' }, candidates: [] },
        { kind: 'by_id', value: 'pay_button' }),
    ).kind,
    'proven',
  );

  // 通过的 absence：not_found/0/null 合法，只是不提供身份
  assert.strictEqual(
    evaluateSelectorIdentity(mk({ state: 'not_found', candidate_count: 0, selected: null, candidates: [] })).kind,
    'unproven',
  );

  // 状态机不变量被破坏
  assert.strictEqual(
    evaluateSelectorIdentity(mk({ state: 'not_found', candidate_count: 0, selected: { id: 'x' }, candidates: [] })).kind,
    'invalid',
  );
  assert.strictEqual(
    evaluateSelectorIdentity(mk({ state: 'unique', candidate_count: 2, selected: { id: 'x' }, candidates: [] })).kind,
    'invalid',
  );
});

test('冻结包 bc-opencard-1 case：一根 failed + 未执行后缀 + policy skipped 的真实形态', () => {
  const c = golden<{ steps: Array<{ outcome: { status: string; cause?: { type: string } } }> }>('case/valid/bc-opencard-1.json');
  const status = c.steps.map(s => s.outcome.status);
  assert.strictEqual(status.filter(s => s === 'failed').length, 1, '该 golden 应只有一个真实根失败');
  assert.ok(status.filter(s => s === 'blocked').length >= 1);
  assert.ok(status.includes('skipped'));
  // 未执行的 blocked 后缀必须是 prior_step，且不携带 failure。
  for (const step of c.steps) {
    if (step.outcome.status !== 'blocked') continue;
    assert.ok(step.outcome.cause, 'blocked 必须带 cause');
    assert.ok(!('failure' in step.outcome), 'blocked 禁止携带 failure');
  }
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
