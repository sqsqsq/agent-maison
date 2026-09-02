// ============================================================================
// hylyre-frozen-conformance.unit.test.ts
//   plan a6c4e9f2 T4 返修：**用冻结包自己的 golden 全集**判生产 parse boundary。
// ----------------------------------------------------------------------------
// 这套件存在的理由是一次真实事故：上一轮的"v1 fixture"只换了外层信封、步骤仍是 0.3 flat，
// 于是 3743 条全绿证明的恰好是**必须被拒绝**的那种输入能过门；与此同时，把冻结包里
// 合法的 `golden/trace/valid/bc-opencard-1.json` 喂给生产 native gate 会得到
// `native=false / 54 条 reasons`。手拼 fixture 在这里是负资产。
//
// 因此本套件只做一件事：让**生产**入口 `requireV1ForGate` 对冻结包 golden 的三类目录
// 给出与契约一致的裁决，且断言里不出现任何手写 trace。
//   valid/            → v1 的必须 ok（legacy 那份必须被判 legacy，不得闭合证据）
//   invalid/          → 必须拒（单行 schema 违规）
//   invalid-crossrow/ → 必须拒（JSON Schema 表达不了的跨行不变量）
//
// golden 读的是 **vendored contracts**，与生产读 schema 的来源同一份——测试路径与
// 发布路径不一致的话，本仓绿灯不能证明宿主可用。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { dispatchHylyreResult, requireV1ForGate } from '../../scripts/utils/hylyre-result-protocol';
import { loadHylyreOutputSchema, locateHylyreOutputSchemas } from '../../scripts/utils/hylyre-contract-schema';
import { auditSchemaSupport } from '../../scripts/utils/lite-json-schema';
import { verifyTraceCrossRow } from '../../scripts/utils/hylyre-crossrow-verifier';
import type { UnitCaseResult } from '../run-unit';

const CONTRACTS = path.resolve(
  __dirname,
  '../../../profiles/hmos-app/vendor/hylyre/src/hylyre/contracts',
);
const GOLDEN_TRACE = path.join(CONTRACTS, 'golden', 'trace');

function readGolden(dir: string): Array<{ name: string; doc: any }> {
  const base = path.join(GOLDEN_TRACE, dir);
  return fs
    .readdirSync(base)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(name => ({ name, doc: JSON.parse(fs.readFileSync(path.join(base, name), 'utf-8')) }));
}

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

test('冻结 schema 从 vendored contracts 定位得到（不得依赖被发布排除的 tests/fixtures）', () => {
  const found = locateHylyreOutputSchemas();
  assert.ok(found.length >= 1, `未定位到 vendored output-schema.json：${JSON.stringify(found)}`);
  for (const p of found) {
    assert.ok(
      p.replace(/\\/g, '/').includes('/vendor/hylyre/src/hylyre/contracts/'),
      `schema 必须来自 vendored contracts，实际：${p}`,
    );
    assert.ok(
      !p.replace(/\\/g, '/').includes('/tests/fixtures/'),
      `schema 不得取自 harness/tests/**（该路径命中发布排除规则）：${p}`,
    );
  }
  const load = loadHylyreOutputSchema();
  assert.strictEqual(load.ok, true, load.ok ? '' : `${load.detail}`);
});

test('校验器覆盖冻结 schema 全部关键字——未覆盖即静默跳过约束，必须 fail-closed', () => {
  const load = loadHylyreOutputSchema();
  assert.ok(load.ok);
  if (!load.ok) return;
  const issues = auditSchemaSupport(load.schema);
  assert.strictEqual(
    issues.length,
    0,
    `冻结 schema 用到未实现关键字：${issues.map(i => `${i.keyword}@${i.pointer}`).join('、')}`,
  );
});

test('golden/trace/valid：合法 v1 全部通过生产 required gate', () => {
  const docs = readGolden('valid');
  assert.ok(docs.length >= 10, `valid golden 数量异常：${docs.length}`);
  let v1Count = 0;
  for (const { name, doc } of docs) {
    const dispatched = dispatchHylyreResult(doc);
    if (dispatched.kind !== 'v1') {
      // valid 目录里也放了一份 legacy 只读样本；它**不得**闭合证据。
      assert.strictEqual(
        dispatched.kind,
        'legacy_unsupported',
        `${name}：非 v1 的 valid golden 只能是 legacy_unsupported，实际 ${dispatched.kind}`,
      );
      assert.strictEqual(requireV1ForGate(doc).ok, false, `${name}：legacy 不得闭合 required gate`);
      continue;
    }
    v1Count += 1;
    const verdict = requireV1ForGate(doc);
    assert.strictEqual(verdict.ok, true, `${name} 被误拒：${verdict.detail}`);
  }
  assert.ok(v1Count >= 10, `v1 valid golden 数量异常：${v1Count}`);
});

test('golden/trace/invalid：单行 schema 违规全部被生产 required gate 拒绝', () => {
  const docs = readGolden('invalid');
  assert.ok(docs.length >= 8, `invalid golden 数量异常：${docs.length}`);
  for (const { name, doc } of docs) {
    assert.strictEqual(requireV1ForGate(doc).ok, false, `${name} 应被拒但通过了`);
  }
});

test('golden/trace/invalid-crossrow：跨行不变量违规全部被拒（只做 schema 会 13 条全放行）', () => {
  const docs = readGolden('invalid-crossrow');
  assert.ok(docs.length >= 10, `invalid-crossrow golden 数量异常：${docs.length}`);
  for (const { name, doc } of docs) {
    const verdict = requireV1ForGate(doc);
    assert.strictEqual(verdict.ok, false, `${name} 应被跨行 verifier 拒绝但通过了`);
    // 这些文档故意做成"合 schema"，所以拒绝理由必须来自跨行层，
    // 否则说明 schema 层意外收紧、跨行层其实没起作用。
    assert.ok(
      verdict.detail.includes('跨行不变量'),
      `${name} 的拒绝理由不是跨行不变量，而是：${verdict.detail.slice(0, 160)}`,
    );
  }
});

test('跨行 verifier 覆盖的违规类别不少于冻结 golden 的类别数', () => {
  const docs = readGolden('invalid-crossrow');
  for (const { name, doc } of docs) {
    const problems = verifyTraceCrossRow(doc);
    assert.ok(problems.length > 0, `${name}：跨行 verifier 未报出任何问题`);
  }
});

test('信封合法但内容为空/仍是 0.3 flat 的伪装体一律被拒', () => {
  const envelope = {
    schema_version: '0.4-p0',
    result_protocol: 'hylyre.step-outcome/1',
    environment: { trace_schema_version: '0.4-p0', result_protocol: 'hylyre.step-outcome/1' },
    cases: [{}],
  };
  const shell = requireV1ForGate(envelope);
  assert.strictEqual(shell.ok, false, '空 case 的 v1 信封不得通过——它曾经 ok=true');
  assert.ok(dispatchHylyreResult(envelope).kind === 'v1', 'dispatch 仍应认为信封是 v1（问题不在信封）');

  const real = readGolden('valid').find(d => d.name === 'bc-opencard-1.json');
  assert.ok(real, '缺 bc-opencard-1.json golden');
  const flat = JSON.parse(JSON.stringify(real!.doc));
  for (const step of flat.cases[0].steps) {
    step.status = 'passed';
    step.failure_kind = null;
    step.failure_code = null;
    step.evidence = {};
    step.error = null;
    delete step.outcome;
  }
  const hybrid = requireV1ForGate(flat);
  assert.strictEqual(hybrid.ok, false, '0.3 flat 步骤套 v1 信封必须被拒');
});

export function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of CASES) {
    try {
      testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (e) {
      results.push({
        name: testCase.name,
        ok: false,
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    }
  }
  return Promise.resolve(results);
}
