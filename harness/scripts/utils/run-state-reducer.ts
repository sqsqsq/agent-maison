// ============================================================================
// run-state-reducer.ts — 单一 run-state reducer（plan d6b1a8e3 t5⓪-b）
// ----------------------------------------------------------------------------
// report / monitor / supervisor 的**唯一状态来源**。三者此前各自从事件类型、
// halt_reason、liveness 推导状态，于是「同一事故三处说法不同」——决策层说正在自动
// 恢复、monitor 显示 HALTED、报告又按 halt_reason 文案树讲第三种话。
//
// 两条铁律：
//  1. **不重建分类**：本模块只折叠事件里已落盘的 `run_disposition` 投影
//     （由 adjudication.withRunDisposition 在写盘层注入），**不读 halt_reason
//     自行判类**。分类 SSOT 在 adjudication.INCIDENT_REGISTRY。
//  2. **disposition 与 liveness 正交，不合并**：本模块只产 disposition 轴；
//     进程是否还活着由 liveness 探针独立给出。合并成一个大枚举会得到
//     两轴的笛卡尔积状态机——codex 明确否决。
//     消费方（如 supervisor）按 `beacon × run_disposition` 二维矩阵决策。
//
// 全函数性（total function）：任何事件序列——包括空序列、只有 run_start、
// 尚未发生任何事故——都必须给出确定的四态之一，绝不 undefined。
// ============================================================================

import type { Disposition, WaitKind } from './adjudication';

/**
 * 真·终局 status —— 与 runner 的**封卷守卫同源**（goal-runner 只对
 * `CHAIN_SLICE_COMPLETED` / `COMPLETED` 拒绝一切启动面）。
 *
 * codex 订正：此前把 `AWAITING_HUMAN_REVIEW` / `DEFERRED*` / `PARTIAL` 也塞进这里是**错的**
 * ——runner 明确允许它们 `--resume`，判 TERMINAL 会让 supervisor 永不重启、
 * 报告也谎称「结构上无法继续」。它们是**等待**，不是终局。
 */
const SEALED_STATUSES: ReadonlySet<string> = new Set(['CHAIN_SLICE_COMPLETED', 'COMPLETED']);

/** run_end.status → 等待类投影（可 --resume，只是在等某件事发生）。 */
const WAITING_STATUSES: ReadonlyMap<string, WaitKind> = new Map<string, WaitKind>([
  ['AWAITING_HUMAN_REVIEW', 'human'],
  ['DEFERRED', 'external'],
  ['DEFERRED_CAPABILITY_MISSING', 'external'],
]);

export interface RunStateProjection {
  run_disposition: Disposition;
  run_wait_kind?: WaitKind;
  /** 产出当前投影的事件类型（诊断用；无投影事件时为 null=处于初始 RESUME_READY） */
  source_event_type: string | null;
  /** run_end 已落盘：本 run 的事件流已封口，后续更早投影不得翻转 */
  sealed: boolean;
}

interface EventLike {
  type?: unknown;
  status?: unknown;
  run_disposition?: unknown;
  run_wait_kind?: unknown;
}

const DISPOSITIONS: ReadonlySet<string> = new Set([
  'RESUME_READY', 'RECOVERY_PENDING', 'WAITING', 'TERMINAL',
]);

/**
 * 折叠事件流 → 当前 run 的 disposition 投影。
 *
 * 规则（codex 七轮裁决）：
 *  · 初始 / accepted `run_start`（fresh 与 resume 都发这个事件）→ `RESUME_READY`，
 *    并解封——resume 意味着上一轮的终局判断作废，本轮重新开始；
 *  · 事件携带 `run_disposition` → 覆盖当前态（**取最新 authoritative 投影**）；
 *  · `run_end` → 封口，按 status 三分（与 runner 封卷守卫同源）：
 *      - **真终局**（CHAIN_SLICE_COMPLETED / COMPLETED，runner 拒绝一切启动面）→ `TERMINAL`；
 *      - **等待类**（AWAITING_HUMAN_REVIEW → human；DEFERRED* → external）→ `WAITING(kind)`
 *        ——它们可 `--resume`，只是在等某件事发生，判 TERMINAL 是谎报；
 *      - **其余**（HALTED / INTERRUPTED / PARTIAL …）→ **保留停机前最后一次投影**。
 *        「进程停了」是 liveness 的事实，「能不能续」是 disposition 的事实；
 *        生产端在 halt 那一刻用真实结构事实算出的投影才是权威，此处不替它改判。
 */
export function reduceRunState(events: readonly unknown[]): RunStateProjection {
  let current: RunStateProjection = {
    run_disposition: 'RESUME_READY',
    source_event_type: null,
    sealed: false,
  };
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const ev = raw as EventLike;
    const type = typeof ev.type === 'string' ? ev.type : '';
    if (type === 'run_start') {
      current = { run_disposition: 'RESUME_READY', source_event_type: type, sealed: false };
      continue;
    }
    if (type === 'run_end') {
      const status = typeof ev.status === 'string' ? ev.status : '';
      if (SEALED_STATUSES.has(status)) {
        current = { run_disposition: 'TERMINAL', source_event_type: type, sealed: true };
        continue;
      }
      const waitKind = WAITING_STATUSES.get(status);
      if (waitKind) {
        current = {
          run_disposition: 'WAITING', run_wait_kind: waitKind, source_event_type: type, sealed: true,
        };
        continue;
      }
      // codex 第九批收尾 P1：run_end **自带显式投影**时优先采用并封口——启动期
      // BLOCKER（如 supersede_target_invalid）的事件流只有 run_start + run_end，
      // "保留此前投影"会退回 run_start 的 RESUME_READY，supervisor 据此把一个
      // 需要人修参数的 run 重新拉起（最小事件流实测）。
      const explicitD = typeof ev.run_disposition === 'string' ? ev.run_disposition : '';
      if (DISPOSITIONS.has(explicitD)) {
        current = {
          run_disposition: explicitD as Disposition,
          ...(typeof ev.run_wait_kind === 'string' ? { run_wait_kind: ev.run_wait_kind as WaitKind } : {}),
          source_event_type: type, sealed: true,
        };
        continue;
      }
      // 其余（HALTED / INTERRUPTED / PARTIAL …无显式投影）：**保留停机前最后一次投影**。
      // 「进程停了」是 liveness 的事实，「能不能续」是 disposition 的事实——
      // 由生产端在 halt 那一刻用真实结构事实算出的投影才是权威，此处不替它改判。
      current = { ...current, source_event_type: current.source_event_type ?? type, sealed: true };
      continue;
    }
    if (current.sealed) continue;
    const d = typeof ev.run_disposition === 'string' ? ev.run_disposition : '';
    if (!DISPOSITIONS.has(d)) continue;
    const kind = typeof ev.run_wait_kind === 'string' ? ev.run_wait_kind : undefined;
    current = {
      run_disposition: d as Disposition,
      source_event_type: type || null,
      sealed: false,
      ...(d === 'WAITING' && (kind === 'human' || kind === 'external')
        ? { run_wait_kind: kind }
        : {}),
    };
  }
  return current;
}

/**
 * supervisor 决策矩阵（a4f7e2b1 t2 的判据面；此处只给纯函数，OS 计划任务侧另做）。
 * **两条正交轴**：beacon 说进程是否还活着，run_disposition 说该不该续。
 */
export type SupervisorAction = 'no_op' | 'resume' | 'never_restart';

export function supervisorAction(input: {
  beaconStale: boolean;
  state: Pick<RunStateProjection, 'run_disposition'>;
}): SupervisorAction {
  if (!input.beaconStale) return 'no_op'; // 进程还活着，别插手
  switch (input.state.run_disposition) {
    case 'RESUME_READY':
      return 'resume';
    case 'RECOVERY_PENDING':
      // 关键格：回退已发起、进程死在恢复途中——正是「进程死了谁拉起来」要解决的场景。
      // 写成不介入会让该 run 永久搁浅。
      return 'resume';
    case 'WAITING':
      return 'no_op'; // 等人/等环境，拉起来还是等
    default:
      return 'never_restart';
  }
}
