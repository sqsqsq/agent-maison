// ============================================================================
// usage-capture.unit.test.ts — C-ab-eval 采集基建契约单测（plan d4a7c1e8）
// ============================================================================
// 锁死：none/失败 → proxy 降级（token 字段 null、不新增 proxy 字段）；
// stdout_json 的 claude 式信封解析（tokens/cost/model identity）；
// stderr_regex；trace best-effort 合并（缺失/已有 usage 不覆盖）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  deriveInvokeUsage,
  deriveDshInvokeUsage,
  createDshUsageCapture,
  extractTrailingJsonObject,
  mergeUsageIntoTraceFile,
} from '../../scripts/utils/usage-capture';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

const CLAUDE_ENVELOPE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  num_turns: 12,
  total_cost_usd: 1.23,
  usage: { input_tokens: 120000, output_tokens: 4500 },
  modelUsage: { 'claude-sonnet-5': { inputTokens: 120000 } },
});

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'DSH ended i1-i14 original counter replay matches frozen steps/cache/output without counting mirrored logs twice',
    run: () => {
      const root = path.resolve(__dirname, '../fixtures/host-recovery-history/20261115-design-recovery/usage');
      const sources = JSON.parse(fs.readFileSync(path.join(root, 'sources.json'), 'utf8')).sources as Array<{ invocation: number; fixture: string; fixture_sha256: string; usage: unknown }>;
      let raw = '';
      for (const [index, source] of sources.entries()) {
        eq(source.invocation, index + 1, '调用顺序');
        const bytes = fs.readFileSync(path.join(root, source.fixture));
        eq(createHash('sha256').update(bytes).digest('hex'), source.fixture_sha256, '脱敏原件哈希');
        eq(deriveDshInvokeUsage(bytes.toString('utf8')), source.usage, '逐调用原生计数'); raw += bytes.toString('utf8');
      }
      const usage = deriveDshInvokeUsage(raw + raw);
      eq(usage.requests, 918, '原生步数'); eq(usage.input_tokens, 3793173, '新增输入');
      eq(usage.observed_cache_read_tokens, 346986496, '已观测缓存读取'); eq(usage.output_tokens, 945433, '输出');
      eq(usage.missing_reason?.includes('非完整缓存总数'), true, '缺省缓存字段不填零');
      eq(deriveDshInvokeUsage(sources.slice(0, 13).map(source => fs.readFileSync(path.join(root, source.fixture), 'utf8')).join('')).requests, 847, 'i1-i13独立截止');
    },
  },
  {
    name: 'DSH native step_end sums per-step new input/cache/output once across mirrors and turns; ignores provider totals',
    run: () => {
      const session = (sessionId: string) => ({ type: 'session', sessionId });
      const step = (turn: number, id: number, inputTokens: number, cacheReadTokens: number, outputTokens: number) =>
        ({ type: 'status', phase: 'step_end', turn, step: id, usage: { inputTokens, cacheReadTokens, outputTokens, totalTokens: 9999 } });
      const rows = [session('A'), step(1, 1, 2, 100, 3), step(1, 1, 2, 100, 3),
        { type: 'status', phase: 'turn_end', usage: { inputTokens: 10000 } }, step(2, 1, 5, 200, 7),
        session('B'), step(1, 1, 11, 300, 13), session('A'), step(1, 1, 2, 100, 3)];
      const usage = deriveDshInvokeUsage(rows.map(row => JSON.stringify(row)).join('\n'));
      eq(usage.input_tokens, 18, '新增输入'); eq(usage.observed_cache_read_tokens, 600, '缓存读取独立');
      eq(usage.output_tokens, 23, '输出'); eq(usage.requests, 3, '原生步数'); eq(usage.cost_estimate, null, '不推费用');
      eq(usage.confidence, 'measured', '原生计数');
      eq(deriveInvokeUsage('none', rows.map(row => JSON.stringify(row)).join('\n'), '').input_tokens, null, '其它adapter采集规则不变');
    },
  },
  {
    name: 'DSH interrupted invocation retains observed steps; missing counts stay null with a reason',
    run: () => {
      const capture = createDshUsageCapture();
      capture.observe({ type: 'session', sessionId: 'A' });
      capture.observe({ type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 3 } });
      capture.observe({ type: 'status', phase: 'step_start', turn: 1, step: 2 });
      const usage = capture.result();
      eq(usage.input_tokens, 2, '已观测输入'); eq(usage.output_tokens, 3, '已观测输出'); eq(usage.requests, 1, '未完成步不计');
      eq(usage.observed_cache_read_tokens, null, '缺缓存计数'); eq(usage.missing_reason?.includes('cacheReadTokens'), true, '缺口可见');
      eq(deriveDshInvokeUsage('{"type":"status","phase":"step_end"}').requests, null, '无身份不猜计数');
    },
  },
  {
    name: 'none/undefined → proxy：token 全 null，capture_method 保真',
    run: () => {
      for (const m of ['none', undefined] as const) {
        const u = deriveInvokeUsage(m, 'whatever', '');
        eq(u.confidence, 'proxy', `${m} confidence`);
        eq(u.input_tokens, null, `${m} input`);
        eq(u.capture_method, 'none', `${m} method`);
        eq('model_identity' in u, false, `${m} 无 model_identity`);
      }
    },
  },
  {
    name: 'stdout_json：claude 式信封 → measured + tokens/cost/turns/model identity',
    run: () => {
      const u = deriveInvokeUsage('stdout_json', `noise line\n${CLAUDE_ENVELOPE}\n`, '');
      eq(u.confidence, 'measured', 'confidence');
      eq(u.input_tokens, 120000, 'input');
      eq(u.output_tokens, 4500, 'output');
      eq(u.cost_estimate, 1.23, 'cost');
      eq(u.requests, 12, 'requests=num_turns');
      eq(u.model_identity?.model, 'claude-sonnet-5', 'model');
      eq(u.model_identity?.source, 'response_metadata', 'identity source=响应元数据（非自报）');
    },
  },
  {
    name: 'stdout_json：无信封 / 信封无用量事实 → 降 proxy（采集失败不冒充 measured）',
    run: () => {
      eq(deriveInvokeUsage('stdout_json', 'plain text output', '').confidence, 'proxy', '无 JSON');
      eq(
        deriveInvokeUsage('stdout_json', '{"type":"result","subtype":"success"}', '').confidence,
        'proxy',
        '信封无 tokens/cost',
      );
    },
  },
  {
    name: 'stderr_regex：命中 token 计数 → measured；未命中 → proxy',
    run: () => {
      const hit = deriveInvokeUsage('stderr_regex', '', 'total input tokens: 42,000 / output tokens: 900');
      eq(hit.confidence, 'measured', 'hit');
      eq(hit.input_tokens, 42000, 'input 千分位');
      eq(hit.output_tokens, 900, 'output');
      eq(deriveInvokeUsage('stderr_regex', '', 'no numbers here').confidence, 'proxy', 'miss');
    },
  },
  {
    name: 'sidecar/api：声明位无实现 → proxy 且 capture_method 保真（缺口可见）',
    run: () => {
      for (const m of ['sidecar', 'api'] as const) {
        const u = deriveInvokeUsage(m, CLAUDE_ENVELOPE, '');
        eq(u.confidence, 'proxy', `${m} proxy`);
        eq(u.capture_method, m, `${m} method 保真`);
      }
    },
  },
  {
    name: 'extractTrailingJsonObject：取最后一个合法 JSON 行；数组/垃圾不取',
    run: () => {
      const doc = extractTrailingJsonObject('{"a":1}\ngarbage\n{"b":2}\n[3]\n');
      eq(doc, { b: 2 }, '最后合法对象');
      eq(extractTrailingJsonObject('nothing json'), null, '无 JSON');
    },
  },
  {
    name: 'mergeUsageIntoTraceFile：写入一次；trace 缺失或已有 usage 不动',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-merge-'));
      try {
        const traceAbs = path.join(dir, 'trace.json');
        const usage = deriveInvokeUsage('none', '', '');
        eq(mergeUsageIntoTraceFile(traceAbs, usage), false, 'trace 缺失 → false');
        fs.writeFileSync(traceAbs, JSON.stringify({ schema_version: '1.0.0', feature: 'f' }), 'utf-8');
        eq(mergeUsageIntoTraceFile(traceAbs, usage), true, '首次合并 true');
        const doc = JSON.parse(fs.readFileSync(traceAbs, 'utf-8')) as { usage?: { confidence?: string } };
        eq(doc.usage?.confidence, 'proxy', '落盘内容');
        eq(mergeUsageIntoTraceFile(traceAbs, { ...usage, confidence: 'measured' }), false, '已有 usage 不覆盖');
        const doc2 = JSON.parse(fs.readFileSync(traceAbs, 'utf-8')) as { usage?: { confidence?: string } };
        eq(doc2.usage?.confidence, 'proxy', '原值保持');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
