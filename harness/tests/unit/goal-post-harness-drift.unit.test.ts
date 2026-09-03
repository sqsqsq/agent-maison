// ============================================================================
// goal-post-harness-drift.unit.test.ts — post-harness 源码漂移的**运行时**回归
// ----------------------------------------------------------------------------
// 为什么单独立一个套件（2026-09-03，codex review 第 3 条 BLOCKER）：
//
// 未受信源码漂移有两条都活着的生产路由：
//   · `phase_write_violation`——改写落在 agent invoke 窗口内，由 pre/post 快照直接
//     归属到该次 invocation（goal-phase-runtime.ts:7504）。consumer smoke 的
//     goal/#5 覆盖这条。
//   · `untrusted_source_drift_revalidation`——**不在任何 invoke 窗口内**的漂移，由
//     ut/testing harness **之后**的 `reconcileMutablePhaseSourceDrift`
//     （同文件 :9198）比对 review closure 基线发现，经 :9340 落事件。
//
// 2026-09-03 把 smoke goal/#5 的期望从后者切到前者（那才是它实际制造的形态）后，
// 后者一度**零运行时覆盖**：`adjudication.unit.test.ts` 只调纯函数 `decide()`，
// 既不执行 `reconcileMutablePhaseSourceDrift`，也不验证 :9340 的事件接线。
// 本套件补上那一格——真实制造 harness 后漂移，断言生产事件与失效记录。
//
// 经子进程 driver（信号处理器污染，见 goal-run-driver.ts 头注）；宿主由本套件建与删。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { RESULT_MARK, setupMinimalHost, type GoalRunOutcome } from '../helpers/goal-run-driver';
import type { UnitCaseResult } from '../run-unit';

const DRIVER = path.resolve(__dirname, '..', 'helpers', 'goal-run-driver.ts');
const TS_NODE = path.resolve(__dirname, '..', '..', 'node_modules', 'ts-node', 'dist', 'bin.js');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function runDriver(scenario: string, feature: string, projectRoot: string): GoalRunOutcome {
  const r = spawnSync(
    process.execPath,
    [TS_NODE, '--transpile-only', DRIVER, scenario, feature, '-', projectRoot],
    { encoding: 'utf-8', timeout: 300_000, cwd: path.resolve(__dirname, '..', '..') },
  );
  const at = (r.stdout ?? '').lastIndexOf(RESULT_MARK);
  if (at < 0) {
    throw new Error(
      `driver 未返回结果（exit ${r.status}）：\n${(r.stdout ?? '').slice(-800)}\n${(r.stderr ?? '').slice(-800)}`,
    );
  }
  return JSON.parse((r.stdout ?? '').slice(at + RESULT_MARK.length)) as GoalRunOutcome;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const run = (name: string, fn: () => void): void => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: (e as Error).message });
    }
  };

  const feature = 'ut-post-harness-drift';
  const host = setupMinimalHost(feature, 'hmos-app');
  try {
    run('post-harness 源码漂移 → untrusted_source_drift_revalidation 自动回 coding（非 write violation）', () => {
      const out = runDriver('ut_source_drift_post_harness', feature, host);
      const detail = JSON.stringify({ ...out, eventTypes: undefined });

      assert(out.error === null, `不得裸崩：${detail}`);

      // 路由判据：必须走 post-harness 基线对账那条，**不是** invoke 窗口归属那条。
      const drift = out.invalidationRecords.find(r =>
        r.reason === 'untrusted_source_drift_revalidation');
      assert(
        drift !== undefined,
        `漂移落在 invoke 窗口外时，必须由 reconcileMutablePhaseSourceDrift 判定并落 `
        + `untrusted_source_drift_revalidation（goal-phase-runtime.ts:9340）：${detail}`,
      );
      assert(
        !out.invalidationRecords.some(r => r.reason === 'phase_write_violation'),
        `窗口外漂移不得被归属为 agent 越界写（那会掩盖本路由）：${detail}`,
      );

      // 语义判据：失效 coding 起的下游并回 coding 全量重验。
      assert(drift!.to_phase === 'coding', `须回 coding 重验：${detail}`);
      assert(
        (drift!.invalidated_phases ?? []).includes('coding')
        && (drift!.invalidated_phases ?? []).includes('review'),
        `coding 与 review 的旧 closure 都须失效：${detail}`,
      );

      // 接线判据：事件真的落盘，且不退化成求人 / 终局。
      assert(
        out.eventTypes.includes('phase_backtrack_requested'),
        `须产出 phase_backtrack_requested：${detail}`,
      );
      assert(
        !out.phaseHalts.some(h => h.halt_reason === 'awaiting_human_review'),
        `保守恢复不得退回人工签字：${detail}`,
      );
    });
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
  }

  return results;
}
