// ============================================================================
// device-recovery-bridge.ts — profile 侧统一的设备就绪/恢复入口
//                             （openspec device-readiness-and-completion t6）
// ----------------------------------------------------------------------------
// 此前 UT / warmup / testing install / testing run 四处各自复制了一份恢复代码，
// 三轮 review 各抓出一次不一致（凭据回落、只在失败后恢复、结论未落 external_block）。
// 合并成这一个桥，四个边界共用同一语义：
//
//   - **操作前**：`ensureReadyBefore` —— 主动确保设备可用（plan 的原文要求）；
//   - **操作后**：`recoverAfterLockFailure` —— 命中锁屏诊断时允许一次有界恢复再重试。
//
// 凭据引用一律经 `resolveAttemptCredentialRef`：attempt 冻结后不重读实时配置
// （否则运行中改配置即可给 manual 模式的 attempt 静默提权）。
//
// 用 require 而非静态 import：profile 侧模块被 harness 以多种入口加载，
// 静态依赖会在部分入口形成环。
// ============================================================================

export interface DeviceReadyOutcome {
  ready: boolean;
  note: string;
  /** 是否登记了自动解锁凭据（false = 只能人工解锁） */
  authorized: boolean;
  /**
   * **确认为外部阻断**（设备确实锁着且没解开）。调用方看到 true 必须**立即让当前
   * 操作失败**并归入 `externalBlocked`/`device_blocked`，不得继续碰设备。
   *
   * 与 `ready === false` 刻意区分：探测判不出（`uitest` 不可用、UI 树结构不认识…）
   * 也会 `ready:false`，但那是**探测能力**问题，不是设备阻断——一刀切阻断会把
   * 一台好设备判死。判不出时放行，让实际操作去暴露真实问题。
   */
  blocked: boolean;
}

function loadDeps(): {
  ensureDeviceReadyAtRuntime: typeof import('../../../harness/scripts/utils/device-runtime-recovery').ensureDeviceReadyAtRuntime;
  deps: typeof import('../../../harness/scripts/utils/device-readiness-deps');
} {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { ensureDeviceReadyAtRuntime } =
    require('../../../harness/scripts/utils/device-runtime-recovery') as typeof import('../../../harness/scripts/utils/device-runtime-recovery');
  const deps =
    require('../../../harness/scripts/utils/device-readiness-deps') as typeof import('../../../harness/scripts/utils/device-readiness-deps');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { ensureDeviceReadyAtRuntime, deps };
}

/**
 * 设备操作**前**的就绪保证。
 *
 * 未显式指定目标时不做任何事——对未知目标动手比不动更危险。
 * 返回 `ready:false` 时调用方须让当前操作失败并归入 `externalBlocked`/`device_blocked`，
 * **不得**重试内容或切换目标。
 */
export function ensureReadyBefore(projectRoot: string, serial?: string | null): DeviceReadyOutcome {
  const target = (serial ?? process.env.HARNESS_HDC_TARGET)?.trim();
  if (!target) {
    return {
      ready: true,
      note: '未显式指定目标，跳过就绪检查（不对未知设备动手）',
      authorized: false,
      blocked: false,
    };
  }
  try {
    const { ensureDeviceReadyAtRuntime, deps } = loadDeps();
    const r = ensureDeviceReadyAtRuntime({
      serial: target,
      credentialRef: deps.resolveAttemptCredentialRef(projectRoot),
      deps: {
        snapshot: deps.readLockScreenSnapshot,
        wake: deps.wakeDevice,
        tap: deps.tapAt,
      },
    });
    // 只有"确实锁着且没解开"才算外部阻断；"判不出"不阻断（见 blocked 字段说明）
    const blocked = !r.recovered && (r.reason === 'unauthorized' || r.reason === 'unlock_failed');
    return {
      ready: r.recovered,
      note: r.note,
      authorized: r.recovered ? true : r.authorized,
      blocked,
    };
  } catch (err) {
    // 桥自身加载/执行失败：这是框架问题，不是设备阻断。放行让实际操作去暴露真实原因，
    // 但**如实说明没做检查**——绝不能悄悄当成"已就绪"。
    return {
      ready: true,
      note: `设备就绪检查不可用（${(err as Error).message}），已跳过`,
      authorized: false,
      blocked: false,
    };
  }
}

/**
 * 操作失败且诊断为锁屏后的**一次**有界恢复。语义与 `ensureReadyBefore` 同源，
 * 区别只在调用时机与返回字段命名（保持既有调用点的语义）。
 */
export function recoverAfterLockFailure(
  projectRoot: string,
  serial?: string | null,
): { recovered: boolean; note: string } {
  const target = (serial ?? process.env.HARNESS_HDC_TARGET)?.trim();
  if (!target) return { recovered: false, note: '未显式指定 HARNESS_HDC_TARGET，不对未知目标做恢复' };
  const r = ensureReadyBefore(projectRoot, target);
  // 桥不可用时 `ready:true` 只代表"没做检查"，**不代表恢复成功**——
  // 若照搬会让调用方以为设备已恢复而去重试原操作（P1，三轮 review）。
  if (!r.ready || r.blocked) return { recovered: false, note: r.note };
  if (/检查不可用/.test(r.note)) return { recovered: false, note: r.note };
  return { recovered: true, note: r.note };
}
