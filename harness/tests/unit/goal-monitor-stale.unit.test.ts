// ============================================================================
// goal-monitor-stale.unit.test.ts — monitor stale 误报的 replay fixture
// （plan d6b1a8e3 t2；依赖 t5 的统一 disposition 状态面）
// ----------------------------------------------------------------------------
// 纪律：**先复现再改**。本文件先用 replay fixture 把两个候选根因各钉一个可复现用例，
// 再断言修复后的行为；不复现的猜测不改代码。
//
// 候选根因（plan 原文）：
//   (a) 调用侧 `--since-event 0` 导致历史事件重复消费
//   (b) monitor 历史 verdict 未标 superseded，使旧结论参与判定
//
// 复现结论（本文件用例即证据）：
//   · (a) 成立且是主因——liveness 支路的 edge-trigger 判据是 `latestIndex > sinceEvent`，
//     游标为 0 时对任何有事件的 run 恒成立，于是「一次性异常」退化为每轮必报。
//   · (b) 的实质在 t5 落地后有了更准的判据：run 停着**不等于**异常。框架正在保守恢复
//     （RECOVERY_PENDING）、或已知在等人/等环境（WAITING）、或已终局（TERMINAL）时，
//     liveness=STALLED 是**预期内**的，报出来就是噪音。只有「本该在推进却不动」
//     （RESUME_READY）才是真异常。
// ============================================================================

import { __testing_classifyNotification, type IndexedEvent } from '../../scripts/goal-monitor';
import type { GoalProgressSnapshot } from '../../scripts/utils/goal-progress';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface TestCase { name: string; run: () => void }

function ev(index: number, event: Record<string, unknown>): IndexedEvent {
  return { index, event: event as IndexedEvent['event'] };
}

/** 最小可用 snapshot（只填被 classifyNotification 读到的字段）。 */
function snapshot(over: {
  liveness: GoalProgressSnapshot['liveness']['state'];
  run_disposition?: GoalProgressSnapshot['run_disposition'];
  run_wait_kind?: GoalProgressSnapshot['run_wait_kind'];
}): GoalProgressSnapshot {
  return {
    schema_version: '1.0',
    run_id: 'r1',
    feature: 'bc-openCard',
    status: 'RUNNING',
    status_reason: null,
    run_disposition: over.run_disposition ?? 'RESUME_READY',
    ...(over.run_wait_kind ? { run_wait_kind: over.run_wait_kind } : {}),
    generated_at: new Date().toISOString(),
    next_action: '人工核查',
    source: { events_path: 'e.jsonl', events_count: 4, last_event_at: null, last_event_type: null },
    chain: { phases: [], current_phase: 'testing', current_index: 1, total: 2 },
    phase: { name: 'testing', status: 'running', started_at: null, elapsed_ms: null },
    liveness: { state: over.liveness, seconds_since_activity: 9999 },
    artifacts: { goal_report_path: null },
    phases_summary: [],
  } as unknown as GoalProgressSnapshot;
}

const RUN = [
  ev(0, { type: 'run_start', ts: '2026-08-02T00:00:00Z' }),
  ev(1, { type: 'phase_start', phase: 'spec', ts: '2026-08-02T00:00:01Z' }),
  ev(2, { type: 'phase_verdict', phase: 'spec', verdict: 'PASS', action: 'advance', ts: '2026-08-02T00:10:00Z' }),
  ev(3, { type: 'phase_start', phase: 'testing', ts: '2026-08-02T00:10:01Z' }),
];

const cases: TestCase[] = [
  {
    name: '复现(a)：游标 0 + STALLED → 每轮都报 liveness 异常（edge-trigger 判据 latestIndex>0 恒成立）',
    run: () => {
      const snap = snapshot({ liveness: 'STALLED', run_disposition: 'RESUME_READY' });
      const first = __testing_classifyNotification(RUN, 0, snap);
      // 该场景**应当**报一次（本该推进却不动，是真异常）
      assert(first !== null, '真异常应报出');
      // 但用同一游标 0 反复调用会反复报同一条——这正是「stale 误报」的观感来源。
      const again = __testing_classifyNotification(RUN, 0, snap);
      assert(
        JSON.stringify(again?.notification_kind) === JSON.stringify(first?.notification_kind),
        '同游标重复调用产出同一条通知——调用侧必须推进游标，否则历史被反复消费',
      );
    },
  },
  {
    name: '修复(b)：框架正在保守恢复（RECOVERY_PENDING）时 STALLED **不得**报异常',
    run: () => {
      const snap = snapshot({ liveness: 'STALLED', run_disposition: 'RECOVERY_PENDING' });
      // 游标 2 < latestIndex 3：liveness 支路可达（游标取 3 则分支根本走不到，属假通过）
      const n = __testing_classifyNotification(RUN, 2, snap);
      assert(
        n === null,
        `框架自动恢复中被误报成 stale 异常：${JSON.stringify(n?.notification_kind)}` +
        '——回退/重验期本就不产新事件，报出来是纯噪音',
      );
    },
  },
  {
    name: '修复(b)：已知在等人/等环境（WAITING）或已终局（TERMINAL）时 STALLED 不是异常',
    run: () => {
      for (const d of ['WAITING', 'TERMINAL'] as const) {
        const snap = snapshot({ liveness: 'STALLED', run_disposition: d, run_wait_kind: 'human' });
        const n = __testing_classifyNotification(RUN, 2, snap);
        assert(n === null, `${d} 下不应报 liveness 异常：${JSON.stringify(n?.notification_kind)}`);
      }
    },
  },
  {
    name: '不误杀真异常：本该推进却不动（RESUME_READY + STALLED / ORPHAN_SUSPECTED）仍须报出',
    run: () => {
      for (const l of ['STALLED', 'ORPHAN_SUSPECTED'] as const) {
        const snap = snapshot({ liveness: l, run_disposition: 'RESUME_READY' });
        const n = __testing_classifyNotification(RUN, 2, snap);
        assert(n !== null && n.notification_kind === 'liveness', `${l} 真异常被漏报：${JSON.stringify(n)}`);
      }
    },
  },
  {
    name: '不改动既有优先级：游标之后的 phase_verdict / run_end 仍优先于 liveness 支路',
    run: () => {
      const withVerdict = [
        ...RUN,
        ev(4, { type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'retry', ts: '2026-08-02T01:00:00Z' }),
      ];
      const snap = snapshot({ liveness: 'STALLED', run_disposition: 'RESUME_READY' });
      const n = __testing_classifyNotification(withVerdict, 3, snap);
      assert(n?.notification_kind === 'phase_verdict', `verdict 应优先：${JSON.stringify(n?.notification_kind)}`);
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
