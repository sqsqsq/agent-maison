// ============================================================================
// hylyre-utf8-roundtrip.unit.test.ts — 中文 round-trip doctor 判定回归
// （visual-capability-truth S2 / P0-B）
// ============================================================================

import {
  ROUNDTRIP_PROBE_TEXTS,
  containsMojibake,
  verifyRoundTripOutput,
} from '../../hylyre-utf8-roundtrip';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const GOOD_STDOUT = JSON.stringify({ predicates: [...ROUNDTRIP_PROBE_TEXTS] });

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '全链保真：predicate 逐字符一致 → ok',
    run: () => {
      const r = verifyRoundTripOutput(GOOD_STDOUT, ROUNDTRIP_PROBE_TEXTS);
      assert(r.ok, r.detail);
      assert(!r.mojibake, 'no mojibake expected');
    },
  },
  {
    name: '乱码形态（事故实测 \'����\'）→ FAIL 且 mojibake=true，detail 点名 PYTHONIOENCODING',
    run: () => {
      const bad = JSON.stringify({ predicates: ['����', '招商银行', '更多', '卡包Z区'] });
      const r = verifyRoundTripOutput(bad, ROUNDTRIP_PROBE_TEXTS);
      assert(!r.ok, 'mojibake must fail');
      assert(r.mojibake, 'mojibake flag');
      assert(r.mismatches.length === 1 && r.mismatches[0].expected === '添加管理卡片', JSON.stringify(r.mismatches));
      assert(r.detail.includes('PYTHONIOENCODING'), r.detail);
    },
  },
  {
    name: 'predicate 缺失/为 null → FAIL 逐条点名',
    run: () => {
      const bad = JSON.stringify({ predicates: ['添加管理卡片', null] });
      const r = verifyRoundTripOutput(bad, ROUNDTRIP_PROBE_TEXTS);
      assert(!r.ok, 'missing predicates must fail');
      assert(r.mismatches.length === 3, `want 3 mismatches got ${r.mismatches.length}`);
    },
  },
  {
    name: 'stdout 混有日志行 → 取最后 JSON 行仍可判定',
    run: () => {
      const mixed = `2026-07-18 pid=1 some hylyre log line\n${GOOD_STDOUT}`;
      const r = verifyRoundTripOutput(mixed, ROUNDTRIP_PROBE_TEXTS);
      assert(r.ok, r.detail);
    },
  },
  {
    name: '输出完全不可解析 → FAIL（不误判 PASS）',
    run: () => {
      const r = verifyRoundTripOutput('Traceback (most recent call last): ...', ROUNDTRIP_PROBE_TEXTS);
      assert(!r.ok, 'unparseable must fail');
      assert(r.mismatches.length === ROUNDTRIP_PROBE_TEXTS.length, 'all expected reported missing');
    },
  },
  {
    name: 'containsMojibake：U+FFFD 检出；正常中文不误报',
    run: () => {
      assert(containsMojibake('pred=����'), 'U+FFFD must be detected');
      assert(!containsMojibake('添加管理卡片 Z'), 'normal Chinese must not flag');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
