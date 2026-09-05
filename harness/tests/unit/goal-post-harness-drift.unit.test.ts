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
    run('post-harness 源码漂移 → 单次裁决：不回退、不 halt，run 跑完并如实披露', () => {
      const out = runDriver('ut_source_drift_post_harness', feature, host);
      const detail = JSON.stringify({ ...out, eventTypes: undefined });

      assert(out.error === null, `不得裸崩：${detail}`);
      // 核心判据：runner 不再就同一批漂移事实做第二次裁决。责任 checker
      // （ut_no_src_mutation / review_closure_attestation）已按 classifyDriftRisk 分级，
      // runner 重判只会把「可继续、披露未复核」升级成「必须整链回退」。
      assert(
        !out.invalidationRecords.some(r => r.reason === 'untrusted_source_drift_revalidation'),
        `runner 不得再产出 untrusted_source_drift_revalidation（该裁决已退役）：${detail}`,
      );
      assert(
        !out.eventTypes.includes('phase_backtrack_requested'),
        `窗口外漂移不得触发强制回退：${detail}`,
      );
      assert(
        !out.invalidationRecords.some(r => r.reason === 'phase_write_violation'),
        `窗口外漂移不得被归属为 agent 越界写：${detail}`,
      );

      // 收官判据：run 走完全链、零 halt，coding 不被二次拉起。
      assert(out.phaseHalts.length === 0, `不得 halt：${detail}`);
      assert(
        out.phaseStartsThisCall.filter(p => p === 'coding').length === 1,
        `coding 不得被重复拉起（无回退）：${detail}`,
      );
      assert(
        out.phaseStartsThisCall.includes('testing'),
        `链须走到 testing，由它的 checker 裁决漂移：${detail}`,
      );

      // 收官判据：普通漂移只裁决一次，completion 侧不得再判 needs_fix 把 run 压成
      // PARTIAL / exit 2 / 无完成凭证——那是第三次阻断，不是披露。披露面是责任 checker
      // 的分级 WARN 与本轮 summary 的 readiness signal（各有独立单测）。
      assert(out.exitCode === 0, `普通漂移不得阻断收官（exit 0）：${detail}`);
      assert(
        out.runEndStatus === 'CHAIN_SLICE_COMPLETED' || out.runEndStatus === 'COMPLETED',
        `须正常收官（实得 ${out.runEndStatus}）：${detail}`,
      );
    });
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
  }

  return results;
}
