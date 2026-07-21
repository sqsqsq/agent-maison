// ============================================================================
// timeout-ratchet-closure.unit.test.ts — P0-5（plan 7c4f2e9b）
// 超时高水位棘轮（事故序列 67.5min 不回落）+ closure_kind 五态 total function
// fixture：cc-spec-deadlock/events-condensed.jsonl（真实事故事件流重建）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  extractTimeoutRatchetFromEvents,
  resolveEffectiveTimeoutMs,
} from '../../scripts/utils/goal-timeout';
import { classifyClosureKind } from '../../scripts/utils/goal-runner-phase';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const MIN = 60_000;
const FIX = path.resolve(__dirname, '..', 'fixtures', 'cc-spec-deadlock');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'ratchet: 事故序列（i1超时→i2超时→escalate 67.5→i3 exit0@49.6）→ i4 预算=67.5min 不回落',
    run: () => {
      const events = [
        { type: 'agent_invoke_start', phase: 'spec', effective_timeout_ms: 45 * MIN },
        { type: 'agent_invoke_end', phase: 'spec', exit_code: 1, timed_out: true, duration_ms: 45 * MIN, effective_timeout_ms: 45 * MIN },
        { type: 'agent_invoke_end', phase: 'spec', exit_code: 1, timed_out: true, duration_ms: 45 * MIN, effective_timeout_ms: 45 * MIN },
        { type: 'timeout_escalated', phase: 'spec', effective_timeout_ms: 67.5 * MIN },
        { type: 'agent_invoke_end', phase: 'spec', exit_code: 0, timed_out: false, duration_ms: 49.6 * MIN, effective_timeout_ms: 67.5 * MIN },
      ];
      const obs = extractTimeoutRatchetFromEvents(events, 'spec');
      if (obs.grantedHighwaterMs !== 67.5 * MIN) throw new Error(`highwater=${obs.grantedHighwaterMs}`);
      if (obs.maxCompletedDurationMs !== 49.6 * MIN) throw new Error(`completed=${obs.maxCompletedDurationMs}`);
      // i4：i3 未超时 → consecutiveTimeouts=0，旧逻辑回落 45min；新逻辑取 max(45, 67.5, 59.52)=67.5
      const r = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: false, consecutiveTimeouts: 0, observations: obs,
      });
      if (r.effectiveMs !== 67.5 * MIN) throw new Error(`effective=${r.effectiveMs / MIN}min`);
      if (r.source !== 'granted_highwater') throw new Error(`source=${r.source}`);
    },
  },
  {
    name: 'ratchet: completed SSOT=exit0&&!timed_out——i2（harness PASS 但超时）不入棘轮',
    run: () => {
      const events = [
        // i2 形态：exit 1 + timed_out（harness 层 PASS 与棘轮无关）
        { type: 'agent_invoke_end', phase: 'spec', exit_code: 1, timed_out: true, duration_ms: 45 * MIN, effective_timeout_ms: 45 * MIN },
      ];
      const obs = extractTimeoutRatchetFromEvents(events, 'spec');
      if (obs.maxCompletedDurationMs !== 0) throw new Error('超时 attempt 不得计入 completed');
    },
  },
  {
    name: 'ratchet: 无高水位/无完成史 → base；observed 单独驱动时 1.2 系数',
    run: () => {
      const base = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: false, consecutiveTimeouts: 0,
        observations: { grantedHighwaterMs: 0, maxCompletedDurationMs: 0 },
      });
      if (base.effectiveMs !== 45 * MIN || base.source !== 'base') throw new Error(JSON.stringify(base));
      const observed = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: false, consecutiveTimeouts: 0,
        observations: { grantedHighwaterMs: 0, maxCompletedDurationMs: 50 * MIN },
      });
      if (observed.effectiveMs !== Math.ceil(50 * MIN * 1.2)) throw new Error(String(observed.effectiveMs));
      if (observed.source !== 'observed_ratchet') throw new Error(observed.source);
    },
  },
  {
    name: 'ratchet: 连续超时升档仍在（consecutive 2 次→×1.5），与高水位取 max',
    run: () => {
      const r = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: false, consecutiveTimeouts: 2,
        observations: { grantedHighwaterMs: 0, maxCompletedDurationMs: 0 },
      });
      if (r.effectiveMs !== 67.5 * MIN || r.source !== 'consecutive_timeouts') throw new Error(JSON.stringify(r));
    },
  },
  {
    name: 'ratchet: 显式配置=hard cap 不被棘轮突破 + 预算过小 advisory',
    run: () => {
      const r = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: true, consecutiveTimeouts: 1,
        observations: { grantedHighwaterMs: 90 * MIN, maxCompletedDurationMs: 44 * MIN },
      });
      if (r.effectiveMs !== 45 * MIN) throw new Error('显式配置被突破');
      if (r.source !== 'explicit_cap') throw new Error(r.source);
      if (!r.advisory || !/疑似过小/.test(r.advisory)) throw new Error('缺预算过小 advisory');
      const quiet = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: true, consecutiveTimeouts: 0,
        observations: { grantedHighwaterMs: 0, maxCompletedDurationMs: 10 * MIN },
      });
      if (quiet.advisory !== null) throw new Error('远离上限不应有 advisory');
    },
  },
  {
    name: 'ratchet: resume 从真实事故 fixture events 重建（granted 高水位 67.5min 在案）',
    run: () => {
      const lines = fs.readFileSync(path.join(FIX, 'events-condensed.jsonl'), 'utf-8').split('\n').filter(Boolean);
      const events = lines.map(l => JSON.parse(l));
      const obs = extractTimeoutRatchetFromEvents(events, 'spec');
      if (obs.grantedHighwaterMs !== 4050000) throw new Error(`fixture highwater=${obs.grantedHighwaterMs}（应 67.5min=4050000）`);
      // i3/i4 exit0 完成：i3=2975507ms、i4=205950ms → max=2975507
      if (obs.maxCompletedDurationMs !== 2975507) throw new Error(`fixture completed=${obs.maxCompletedDurationMs}`);
      const r = resolveEffectiveTimeoutMs({
        baseMs: 45 * MIN, explicit: false, consecutiveTimeouts: 0, observations: obs,
      });
      if (r.effectiveMs !== 4050000) throw new Error(`事故重建 effective=${r.effectiveMs}——i5 不该再被 45min 腰斩`);
    },
  },
  {
    name: 'closure: 五态 total function 矩阵（passed/missing/failed/error/not_applicable）',
    run: () => {
      const m = (s: 'passed' | 'failed' | 'missing' | 'error' | 'not_applicable') => classifyClosureKind(s);
      if (m('passed').kind !== 'deterministic_recheck') throw new Error('passed');
      if (m('missing').kind !== 'receipt_repair_with_verifier') throw new Error('missing');
      if (m('failed').kind !== 'receipt_repair_with_verifier') throw new Error('failed');
      const err = m('error');
      if (err.kind !== 'halt' || err.reason !== 'closure_probe_error') throw new Error('error 应 halt closure_probe_error（不调 agent）');
      const na = m('not_applicable');
      if (na.kind !== 'halt' || na.reason !== 'closure_state_invariant') throw new Error('not_applicable+blocked 应状态机不变量 halt');
    },
  },
  {
    name: 'closure: 事故 i2 场景——unclosed 掩盖下探得 passed → deterministic（不再整轮重试）',
    run: () => {
      // advance_block_reason=agent_timeout_unclosed 仅 telemetry；分类只看探针真值
      const route = classifyClosureKind('passed');
      if (route.kind !== 'deterministic_recheck') throw new Error(JSON.stringify(route));
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

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
