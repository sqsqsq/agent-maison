// ============================================================================
// device-runtime-recovery.ts — 运行期设备恢复（openspec ... t6）
// ----------------------------------------------------------------------------
// 为什么 pre-invoke 的就绪门不够：
//   用户的真实场景是"鸿蒙无法常亮 + 长时间无人值守"——invoke 前 READY，几分钟后手机
//   自动锁屏。而锁屏信号**只在设备操作期间才暴露**（`aa test` / warmup 启动 Ability
//   失败后才报 device_locked）。所以除了门，还需要在每个设备操作边界前后能恢复一次。
//
// 授权边界（与门完全一致，不放宽）：
//   - 只用用户登记的凭据；未登记 = 不尝试任何输入；
//   - 一次锁屏事件只恢复一次；失败即机器级锁死；
//   - **只在同一 serial 上恢复**——恢复失败即让本 attempt 失败，绝不热切模拟器
//     （热切会产出一半真机一半模拟器的混合证据，而 target_kind 只记一个）。
// ============================================================================

import { ensureUnlocked, type UnlockDeps } from './device-unlock-helper';
import type { CredentialProvider } from './device-credential-store';

export interface RuntimeRecoveryInput {
  serial: string;
  /** null = 未登记凭据（未授权）→ 直接放弃，零输入 */
  credentialRef: string | null;
  deps: UnlockDeps;
  /** 仅测试注入；生产走默认的 OS 凭据库 provider */
  provider?: CredentialProvider;
}

/**
 * 未能就绪的具体原因。调用方据此区分**"确实锁着解不开"（须阻断操作）**与
 * **"探测判不出"（放行，让实际操作去暴露问题）**——后者一刀切阻断会把
 * "uitest 不可用"之类的探测能力问题误报成设备阻断。
 */
export type RuntimeRecoveryReason =
  /** 未锁屏，正常放行 */
  | 'not_locked'
  /** 锁屏状态判不出——不猜，但也不据此阻断 */
  | 'unknown'
  /** 确实锁屏且未登记凭据 → 外部阻断 */
  | 'unauthorized'
  /** 确实锁屏、尝试过解锁但没成 → 外部阻断 */
  | 'unlock_failed';

export type RuntimeRecoveryResult =
  | { recovered: true; note: string; reason: 'not_locked' }
  | { recovered: false; note: string; authorized: boolean; reason: RuntimeRecoveryReason };

/**
 * 设备操作前的就绪保证（幂等，可在每个边界前调用）。
 *
 * 返回 `recovered:false` 时调用方**必须**让当前操作失败并把结果归入
 * `externalBlocked`/`device_blocked`（与 t1 同一契约），而不是重试内容或切换目标。
 */
export function ensureDeviceReadyAtRuntime(input: RuntimeRecoveryInput): RuntimeRecoveryResult {
  // **先唤醒再取样**：息屏时 UI tree 不完整，直接探测必然判不出（undefined），
  // 于是"手机只是息屏"会被当成"状态不可知"直接 BLOCKED —— 而息屏正是无人值守
  // 场景下最常见的形态。wake 是非秘密操作，任何档位都可以做。
  input.deps.wake(input.serial);

  const locked = input.deps.snapshot(input.serial).locked;
  if (locked === false) return { recovered: true, note: '设备未锁屏', reason: 'not_locked' };
  if (locked === undefined) {
    return {
      recovered: false,
      note: '唤醒后仍无法判定锁屏状态（不猜）',
      authorized: false,
      reason: 'unknown',
    };
  }

  if (!input.credentialRef) {
    return {
      recovered: false,
      note: '设备锁屏且未登记自动解锁凭据——请人解锁后重跑；框架不会尝试任何口令',
      authorized: false,
      reason: 'unauthorized',
    };
  }

  const r = ensureUnlocked({
    serial: input.serial,
    credentialRef: input.credentialRef,
    deps: input.deps,
    provider: input.provider,
  });
  return r.ok
    ? { recovered: true, note: r.note, reason: 'not_locked' }
    : { recovered: false, note: r.note, authorized: true, reason: 'unlock_failed' };
}

/**
 * 包装一个设备操作：失败且诊断为锁屏时，允许**一次**有界恢复后重试原操作。
 *
 * 「一次」是对同一次调用而言；后续再锁屏是新的锁屏事件，仍可再恢复一次
 * （凭据没错的情况下这是正常的无人值守形态）。真正的止损是凭据**失败**即机器级锁死。
 */
export function withDeviceRecovery<T>(
  input: RuntimeRecoveryInput & {
    run: () => T;
    /** 该次结果是否因锁屏失败 */
    isDeviceLockedFailure: (result: T) => boolean;
    onRecovery?: (note: string, recovered: boolean) => void;
  },
): T {
  const first = input.run();
  if (!input.isDeviceLockedFailure(first)) return first;

  const rec = ensureDeviceReadyAtRuntime(input);
  input.onRecovery?.(rec.note, rec.recovered);
  if (!rec.recovered) return first;

  // 恢复成功 → 重试原操作**一次**（同一 serial）
  return input.run();
}
