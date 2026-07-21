// ============================================================================
// attempt-axes-timeline.unit.test.ts — P1-6（plan 7c4f2e9b）
// 四正交轴时间线：事故 fixture 回放——i2 同属「超时」与「PASS 被拦」两轴，
// 汇总与 attempt 数逐项可对账（不再出现 3+2+1=6≠5 的互斥伪计数）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { buildAttemptAxesTimeline } from '../../scripts/utils/goal-report-generator';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIX = path.resolve(__dirname, '..', 'fixtures', 'cc-spec-deadlock');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'axes: 事故 fixture 回放——五 attempt 五行 + i2 = timeout × PASS × advance_blocked',
    run: () => {
      const events = fs
        .readFileSync(path.join(FIX, 'events-condensed.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));
      const rows = buildAttemptAxesTimeline(events, 'spec');
      const attemptRows = rows.filter(r => r.startsWith('- spec-i'));
      if (attemptRows.length !== 5) throw new Error(`应 5 行 attempt，得 ${attemptRows.length}:\n${rows.join('\n')}`);
      const i2 = attemptRows.find(r => r.includes('spec-i2'));
      if (!i2 || !i2.includes('timeout') || !i2.includes('PASS') || !i2.includes('advance_blocked')) {
        throw new Error(`i2 双轴断言失败：${i2}`);
      }
      const i3 = attemptRows.find(r => r.includes('spec-i3'));
      if (!i3 || !i3.includes('exit0') || !i3.includes('FAIL')) throw new Error(`i3 轴断言失败：${i3}`);
      const summaryRow = rows[rows.length - 1];
      // 事故实况：3 超时（i1/i2/i5）、2 非超时内容 FAIL（i3/i4）、1 次 PASS 被闭环拦（i2）
      if (!summaryRow.includes('5 attempts')) throw new Error(summaryRow);
      if (!summaryRow.includes('3 次超时')) throw new Error(`超时计数失实：${summaryRow}`);
      if (!summaryRow.includes('2 次非超时内容 FAIL')) throw new Error(`内容 FAIL 计数失实：${summaryRow}`);
      if (!summaryRow.includes('1 次 harness PASS 被闭环拦截')) throw new Error(`PASS 被拦计数失实：${summaryRow}`);
      if (!summaryRow.includes('轴可重叠，非互斥计数')) throw new Error('须声明轴可重叠');
    },
  },
  {
    name: 'axes: 空事件/无该 phase → 空时间线不炸',
    run: () => {
      if (buildAttemptAxesTimeline([], 'spec').length !== 0) throw new Error('空事件应空');
      const other = [{ type: 'agent_invoke_end', phase: 'plan', invoke_id: 'plan-i1', exit_code: 0 }];
      if (buildAttemptAxesTimeline(other, 'spec').length !== 0) throw new Error('异 phase 应空');
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
