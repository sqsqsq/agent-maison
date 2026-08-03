// ============================================================================
// goal-supervisor.ts — 无人值守 supervisor 决策核（plan a4f7e2b1 t2）
// ----------------------------------------------------------------------------
// 立项事实：2026-08-02 宿主两起无人值守卡死中**进程都活得好好的**，是被自己的门禁
// 合法停的——所以 supervisor 必须在 a5f9c3e2（recover 语义）与 d6b1a8e3（统一投影）
// 之后做。先做等于给一个会自杀的 run 装自动复活，复活了还在同一位置再死。
//
// 铁律（plan 硬约束 2，codex 七轮再订正为**行为约束**而非字符串扫描）：
//   · **唯一业务处置输入是 `run_disposition`**——supervisor 不得用 halt_reason /
//     blocking_class 推导重启动作。原稿「按事件 type 扫描 resume 拒绝判据」的写法
//     照做会原地复活再死，且每加一种 halt 就要改 supervisor 一次 = 第二张分类表。
//   · beacon、重试预算、退避这些**不是业务分类**，仍是合法输入。
//   · 依赖边界：本模块**不得** import decide / lookupIncident / INCIDENT_REGISTRY
//     ——那会迫使它重建 IncidentFacts/AuthorityFacts/ExecutionContext，实为第二个
//     裁决入口。只消费 run-state reducer 的投影。
//
// 判据是 **beacon × run_disposition 两条正交轴**（不合并成更大的状态枚举）：
//   fresh  × 任意              → 不介入（进程还活着）
//   stale  × RESUME_READY      → resume
//   stale  × RECOVERY_PENDING  → resume（继续未完成的保守恢复；**这一格最关键**）
//   stale  × WAITING           → 不拉起（拉起来还是等）
//   stale  × TERMINAL          → 永不拉起
// ============================================================================

import { reduceRunState, supervisorAction, type SupervisorAction } from './run-state-reducer';
import { assessLivenessBeacon, isBeaconStale, readLivenessBeacon } from './liveness-beacon';
import type { ProcessProbe } from './device-session';

/** 单 run 的重启上限——防重启风暴。超过即停手并留痕，绝不无限拉。 */
export const MAX_SUPERVISED_RESTARTS = 3;

/** 退避基数；第 n 次重启前等待 base × 2^(n-1)（指数退避，上界见 MAX_BACKOFF_MS）。 */
export const RESTART_BACKOFF_BASE_MS = 30_000;
export const MAX_RESTART_BACKOFF_MS = 10 * 60_000;

export function restartBackoffMs(restartsSoFar: number): number {
  if (restartsSoFar <= 0) return 0;
  return Math.min(RESTART_BACKOFF_BASE_MS * 2 ** (restartsSoFar - 1), MAX_RESTART_BACKOFF_MS);
}

export type SupervisorDecision =
  | { action: 'no_op'; reason: string }
  | { action: 'resume'; reason: string; backoff_ms: number; restart_seq: number }
  | { action: 'never_restart'; reason: string }
  /** 重启次数已达上限——与 never_restart 分开，便于报告区分「结构上不该重启」与「已重启太多次」 */
  | { action: 'restart_budget_exhausted'; reason: string; restarts: number };

export interface SupervisorInput {
  /** run 的 events（authoritative 顺序）——只用于折叠 disposition 投影 */
  events: readonly unknown[];
  /** 本 run 已由 supervisor 重启过几次（从 events 的 supervisor_restart 计数） */
  restartsSoFar: number;
  beaconStale: boolean;
}

/**
 * 纯决策（无 I/O、无副作用）。**唯一业务输入是 events 折出的 run_disposition**；
 * beacon 与重启预算是运行面输入，不是事故分类。
 */
export function decideSupervision(input: SupervisorInput): SupervisorDecision {
  const state = reduceRunState(input.events);
  const base: SupervisorAction = supervisorAction({
    beaconStale: input.beaconStale,
    state,
  });
  if (base === 'no_op') {
    return {
      action: 'no_op',
      reason: input.beaconStale
        ? `run_disposition=${state.run_disposition}${state.run_wait_kind ? `(${state.run_wait_kind})` : ''}——` +
          '等待中，拉起来还是等'
        : '进程仍存活（beacon 新鲜）——不介入',
    };
  }
  if (base === 'never_restart') {
    return { action: 'never_restart', reason: `run_disposition=${state.run_disposition}——结构上无法继续` };
  }
  // base === 'resume'
  if (input.restartsSoFar >= MAX_SUPERVISED_RESTARTS) {
    return {
      action: 'restart_budget_exhausted',
      restarts: input.restartsSoFar,
      reason:
        `已由 supervisor 重启 ${input.restartsSoFar} 次（上限 ${MAX_SUPERVISED_RESTARTS}）——` +
        '停手求人：反复拉起同一个 run 说明问题不在进程死亡本身',
    };
  }
  return {
    action: 'resume',
    restart_seq: input.restartsSoFar + 1,
    backoff_ms: restartBackoffMs(input.restartsSoFar),
    reason:
      `beacon 陈旧（进程已死）且 run_disposition=${state.run_disposition}——` +
      (state.run_disposition === 'RECOVERY_PENDING'
        ? '框架的保守恢复尚未跑完，续上'
        : '可续跑'),
  };
}

/** 从 events 数出本 run 已被 supervisor 重启的次数（跨进程持久，--resume 不丢）。 */
export function countSupervisorRestarts(events: readonly unknown[]): number {
  let n = 0;
  for (const e of events) {
    if (e && typeof e === 'object' && (e as { type?: unknown }).type === 'supervisor_restart') n += 1;
  }
  return n;
}

/**
 * 组装决策所需的运行面输入并给出决策（读 beacon，仍**不写**任何东西——
 * 探针只读是 t1 的约束，supervisor 是探针的消费者）。
 */
export function superviseRun(args: {
  projectRoot: string;
  reportDir: string;
  runId: string;
  events: readonly unknown[];
  probe?: ProcessProbe;
}): SupervisorDecision {
  const beacon = readLivenessBeacon(args.projectRoot, args.reportDir);
  const verdict = assessLivenessBeacon({ beacon, runId: args.runId, probe: args.probe });
  return decideSupervision({
    events: args.events,
    restartsSoFar: countSupervisorRestarts(args.events),
    beaconStale: isBeaconStale(verdict),
  });
}

// ---------------------------------------------------------------------------
// 平台边界（与 a7f2e5d1 t6 凭据面同款诚实口径：Windows 优先，其余显式 unsupported）
// ---------------------------------------------------------------------------

export type SchedulerSupport =
  | { supported: true; platform: 'win32'; mechanism: 'schtasks' }
  | { supported: false; platform: string; reason: string };

/**
 * OS 计划任务能力真值。**不做半可用实现**——非 Windows 显式 unsupported，
 * 由调用方如实告知「本机不支持自动拉起，需人工 --resume」，不假装装上了。
 */
export function schedulerSupport(platform: string = process.platform): SchedulerSupport {
  if (platform === 'win32') return { supported: true, platform: 'win32', mechanism: 'schtasks' };
  return {
    supported: false,
    platform,
    reason:
      `${platform} 暂不支持 supervisor 计划任务（本框架 Windows 优先；` +
      '不做半可用实现——需要自动拉起请在 Windows 宿主运行，或人工 --resume）',
  };
}
