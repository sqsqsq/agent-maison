// ============================================================================
// lite-json-schema.unit.test.ts — t2 v3（plan e6a3c9f4）schema 子集校验器
// ----------------------------------------------------------------------------
// codex 高优4 点名的三类逃逸负例：错误类型 / 额外字段（additionalProperties:false）/
// 非法嵌套数组元素；第三轮追加原型键逃逸（constructor/toString/__proto__——`in` 走
// 原型链的洞）；正例=真实 summary.schema.json 校验合法 summary。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { validateLiteSchema } from '../../scripts/utils/lite-json-schema';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SUMMARY_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'summary.schema.json'), 'utf-8'),
) as Record<string, unknown>;

function validSummary(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    phase: 'review',
    feature: 'demo',
    verdict: 'PASS',
    blocker_count: 0,
    fail_count: 0,
    warn_count: 0,
    gate_fingerprint: '3.0.0:0123456789ab',
    script_report: 'x/script-report.json',
    merged_report: 'x/merged-report.md',
    ai_prompt: 'x/ai-prompt.md',
    summary_json: 'x/summary.json',
    run_statuses: [],
    readiness_signals: [],
    blocking_warnings: [],
    blocking_skips: [],
    blockers: [],
    next_action: 'fill_receipt_then_check',
    closure_status: 'open',
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '正例：合法 summary 过真实 schema 零违规',
    run: () => {
      const v = validateLiteSchema(validSummary(), SUMMARY_SCHEMA);
      assert(v.length === 0, `expected clean, got: ${JSON.stringify(v)}`);
    },
  },
  {
    name: '负例①错误类型：blocker_count 为字符串 → 违规',
    run: () => {
      const s = validSummary();
      s.blocker_count = '0';
      const v = validateLiteSchema(s, SUMMARY_SCHEMA);
      assert(v.some(x => x.path.includes('blocker_count')), `应命中类型违规：${JSON.stringify(v)}`);
    },
  },
  {
    name: '负例②额外字段：顶层未知键 → additionalProperties 违规',
    run: () => {
      const s = validSummary();
      (s as Record<string, unknown>).totally_bogus_key = 1;
      const v = validateLiteSchema(s, SUMMARY_SCHEMA);
      assert(v.some(x => x.path.includes('totally_bogus_key')), `应命中额外字段：${JSON.stringify(v)}`);
    },
  },
  {
    name: '负例③非法嵌套元素：blockers[0] 缺必填/类型错 → $ref 递归违规',
    run: () => {
      const s = validSummary();
      s.blockers = [{ id: 123 }]; // id 类型错 + 缺 severity/status/details_excerpt
      const v = validateLiteSchema(s, SUMMARY_SCHEMA);
      assert(v.some(x => x.path.includes('blockers[0]')), `应命中嵌套违规：${JSON.stringify(v)}`);
    },
  },
  {
    name: '负例④enum/pattern：verdict 非法值与 gate_fingerprint 坏 pattern → 违规',
    run: () => {
      const s1 = validSummary();
      s1.verdict = 'MAYBE';
      assert(validateLiteSchema(s1, SUMMARY_SCHEMA).some(x => x.path.includes('verdict')), 'enum 应拦');
      const s2 = validSummary();
      s2.gate_fingerprint = 'not-a-fingerprint';
      assert(validateLiteSchema(s2, SUMMARY_SCHEMA).some(x => x.path.includes('gate_fingerprint')), 'pattern 应拦');
    },
  },
  {
    name: '负例⑤原型键逃逸（codex 第三轮）：constructor/toString/__proto__ 额外字段必须拦；required 原型键不得假通过',
    run: () => {
      // `key in props` 走原型链——constructor/toString 曾被误认作 schema 已声明字段而逃过
      // additionalProperties:false（codex 实测 {constructor:1} 通过）。修复=hasOwnProperty。
      for (const key of ['constructor', 'toString']) {
        const s = validSummary();
        s[key] = 1;
        const v = validateLiteSchema(s, SUMMARY_SCHEMA);
        assert(v.some(x => x.path.includes(key)), `${key} 额外字段应拦：${JSON.stringify(v)}`);
      }
      // __proto__：JSON.parse 产生 own property（不走 setter），同样必须拦
      const withProto = { ...validSummary(), ...JSON.parse('{"__proto__": 1}') } as Record<string, unknown>;
      const vp = validateLiteSchema(withProto, SUMMARY_SCHEMA);
      assert(vp.some(x => x.path.includes('__proto__')), `__proto__ 额外字段应拦：${JSON.stringify(vp)}`);
      // required 侧同病：required:['constructor'] 对 {}——原型上的 Function ≠ own 字段，须报缺失
      const reqSchema = {
        type: 'object',
        required: ['constructor'],
        properties: { constructor: { type: 'number' } },
      } as Record<string, unknown>;
      const vr = validateLiteSchema({}, reqSchema);
      assert(vr.some(x => x.path.includes('constructor') && x.message.includes('必填')), 'required 原型键须报缺失');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
