import { freezeExistingGoalDelivery } from '../utils/existing-goal-delivery-fixture';
// ============================================================================
// goal-park-resume.unit.test.ts — 恢复场景的行为面（e5d8a2c4 步骤 1"铺红"）
// ----------------------------------------------------------------------------
// 回放对象（宿主 ground truth，fa0663 2026-08-06 两轮实测）：
//   fresh 全链 → ut/testing 撞设备门 `WAITING(external)+halted:false` → PARTIAL 停放
//   → 无 HMAC resume → 撞 `checkpoint_unauthenticated_baseline` requireAck 即 throw；
//   带 ack 过门后 `start_index=链长` 直接收口，ut 永不重跑。
//
// 两格结构：
//   park   —— 停放形态断言（这格是**长期目标行为**，现在就该绿）；
//   resume —— **棘轮**（与 goal-lineage-first-death 同款）：现状=被 ack 门拦、
//              ut 不重跑。垂直恢复闭环（plan 步骤 3：删 requireAck + 重新入队
//              最早未完成的 WAITING(external) phase）落地后本格**必红**，届时翻成
//              目标断言：resume 零拦截 + `phaseStartsThisCall` 含 'ut'，并把
//              T4 smoke 注册表 #3 改 covered。
//
// 经子进程 driver（信号处理器污染，见 goal-run-driver.ts 头注）；宿主由本套件
// 建与删（谁建谁删）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runRuntimeTestChild } from '../utils/runtime-test-control';
import { expectedDriverInterruption, RESULT_MARK, setupMinimalHost, type GoalRunOutcome } from '../helpers/goal-run-driver';
import type { UnitCaseResult } from '../run-unit';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import { findUnclosedGuardianBounds } from '../../scripts/utils/goal-containment-reconcile';

const DRIVER = path.resolve(__dirname, '..', 'helpers', 'goal-run-driver.ts');
const TS_NODE = path.resolve(__dirname, '..', '..', 'node_modules', 'ts-node', 'dist', 'bin.js');

/**
 * Only for controlled fake callbacks that have already returned or thrown without an external process.
 * Close their exact outstanding invocation; never fabricate a process binding or borrow another settlement.
 */
export function sealLegacyInvokes(host: string, feature: string, runId: string): void {
  const eventsPath = path.join(host, 'doc', 'features', feature, 'goal-runs', runId, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return;
  const events = loadAuthoritativeEvents(eventsPath);
  const open = new Map<string, { phase: string; invoke_id: string }>();
  for (const event of events) {
    if (!event.invoke_id) continue;
    if (event.type === 'agent_invoke_start' && event.phase) open.set(event.invoke_id, { phase: event.phase, invoke_id: event.invoke_id });
    else if (['agent_invoke_end', 'agent_invoke_recovered', 'agent_process_settled', 'orphan_reclaimed'].includes(event.type ?? '')) open.delete(event.invoke_id);
  }
  if (!open.size) return;
  if (findUnclosedGuardianBounds(events).some(bound => open.has(bound.invoke_id))) {
    throw new Error('test callback settlement cannot close an outstanding native binding');
  }
  const now = new Date().toISOString();
  fs.appendFileSync(
    eventsPath,
    [...open.values()].map(invoke => JSON.stringify({ type: 'agent_invoke_end', ...invoke,
      run_id: runId, exit_code: 130, interrupted: true, status: 'failed', ts: now,
      detail: 'controlled test callback has settled without an external process' })).join('\n') + '\n',
    'utf-8',
  );
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function runDriver(scenario: string, feature: string, projectRoot: string, extra?: string): GoalRunOutcome {
  const r = runRuntimeTestChild({ root: projectRoot, expectedInterruption: expectedDriverInterruption(scenario) }, () => spawnSync(
    process.execPath,
    [TS_NODE, '--transpile-only', DRIVER, scenario, feature, '-', projectRoot, ...(extra ? [extra] : [])],
    { encoding: 'utf-8', timeout: 300_000, cwd: path.resolve(__dirname, '..', '..') },
  ));
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

  const host = setupMinimalHost('recovery-park', 'hmos-app');
  freezeExistingGoalDelivery(host, 'recovery-park');
  let runId: string | null = null;
  try {
    run('恢复场景/park：四阶段 PASS → ut/testing 设备停放 PARTIAL', () => {
      const out = runDriver('device_park', 'recovery-park', host);
      const detail = JSON.stringify({ ...out, eventTypes: undefined });
      assert(out.error === null, `park 不应抛异常：${detail}`);
      assert(out.exitCode === 1 && out.runEndStatus === 'HALTED', `实际设备条件未就绪应自然等待：${detail}`);
      assert(
        ['spec', 'plan', 'coding', 'review'].every(p => out.checkFamiliesThisCall.includes(p))
          && !out.checkFamiliesThisCall.some(p => p === 'ut' || p === 'testing'),
        `前四实际检查通过，设备检查在真实设备门之前停放：${detail}`,
      );
      assert(out.authorCallsThisCall === 1, `同单元作者只执行一次；设备检查不另开作者：${detail}`);
      assert(out.phaseHalts.some(event => event.halt_reason === 'device_not_ready'), `具体设备条件必须保留：${detail}`);
      runId = out.runId;
      assert(runId !== null, `须拿到 runId 供 resume：${detail}`);
    });

    run('恢复场景/resume：**目标行为**（垂直闭环已落地）——零 ack、WAITING(external) 重新入队、ut 真正重跑', () => {
      assert(runId !== null, 'park 未产出 runId，前置失败');
      sealLegacyInvokes(host, 'recovery-park', runId as string);
      const out = runDriver('resume_after_park', 'recovery-park', host, runId as string);
      const detail = JSON.stringify({ ...out, eventTypes: undefined });

      // ---- 目标断言（2026-08-06 垂直闭环落地后由棘轮翻转而来；fa0663 的解）----
      // 无 HMAC resume 零拦截（不求 ack、不 throw）；最早未完成的 WAITING(external)
      // phase（ut）真正重新执行；设备仍锁 → 如实再停放 PARTIAL。
      assert(out.error === null && out.exitCode !== 0 && out.runEndStatus === 'HALTED',
        `未变设备条件接续应自然等待：${detail}`);
      assert(!out.checkFamiliesThisCall.length, `未变接续不得重跑已完成检查或未就绪真机：${detail}`);
      assert(out.agentCalls === 0, `设备阶段不烧 agent 轮次：${detail}`);
      // T2 5a 完成刀后：签名维度已删，checkpoint 内容一致即 ok——"未认证基线"概念
      // 消失，resume 不再产生任何信任类观察事件（旧断言要求 checkpoint_absent 事件
      // 在场，那来自已退役的 unauthenticated-baseline 路径）。零信任事件=正确形态。
      assert(!out.eventTypes.includes('vision_ledger_resume_ack'),
        `ack 语义已整体退役，不得再产 ack 事件：${detail}`);
    });

    run('恢复场景/READY：设备恢复后同一 run 无钥匙**真正完成**（codex 第九批 P0 后半闭环）', () => {
      assert(runId !== null, 'park 未产出 runId，前置失败');
      sealLegacyInvokes(host, 'recovery-park', runId as string);
      const out = runDriver('resume_with_device_ready', 'recovery-park', host, runId as string);
      const detail = JSON.stringify({ ...out, eventTypes: undefined });
      assert(out.error === null && out.exitCode === 0,
        `设备 READY 后 run 应完整收官（exit 0）：${detail}`);
      assert(out.checkFamiliesThisCall.includes('ut') && out.checkFamiliesThisCall.includes('testing'),
        `ut/testing 应真正执行：${detail}`);
      assert(out.authorCallsThisCall === 0, `设备条件恢复只补原UT/testing检查，不重买作者：${detail}`);
      // 修 1 的行为面：恢复成功后旧 WAITING 不得残留在报告投影里（PASS 清 halt——
      // enrichOutcomesWithProjection 的有序覆盖语义）
      const reportPath = path.join(host, 'doc', 'features', 'recovery-park', 'goal-runs',
        runId as string, 'goal-report.json');
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as {
        status?: string; phases?: Array<{ phase?: string; run_disposition?: string }>;
      };
      const staleWaiting = (report.phases ?? []).filter(p => p.run_disposition === 'WAITING');
      assert(staleWaiting.length === 0,
        `报告不得残留 WAITING 投影（旧 halt 须被后续 PASS 清除）：${JSON.stringify(report.phases)}`);
      assert(report.status !== 'AWAITING_HUMAN_REVIEW',
        `无钥匙完成态不得封顶人工复核（capRunStatusForVisionTrust 已删）：${report.status}`);
    });
  } finally {
    try { fs.rmSync(host, { recursive: true, force: true }); } catch { /* 占用即留 OS */ }
  }
  return results;
}
