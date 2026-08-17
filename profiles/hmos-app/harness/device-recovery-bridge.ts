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

import type { UnlockFailureKind } from '../../../harness/scripts/utils/device-unlock-helper';

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
  /**
   * e5d8a2c4 T3#2：解锁失败的结构化归因。**消费方按它决定下一步，禁止解析 `note` 文案。**
   * 前置/并发/等待类失败不带该字段——照走既有 `device_blocked` 通道。
   *
   * 用**闭集类型**而非 string（codex 四批 P2）：放宽成 string 后，adapter 可以静默
   * 产出第四、第五种未登记分类而编译器不报警——等于把刚删掉的兜底类从边界放回来。
   * 这里是 `import type`（编译期擦除），不会形成本文件头注说的那种 require 环。
   */
  failureKind?: UnlockFailureKind;
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
 * 设备操作**前**的就绪保证（操作前兜底 + 运行中再次锁屏的恢复）。
 *
 * **目标不在这里解析**（b3f7d9a2 t2）：目标由**入口**解析一次并注入
 * `HARNESS_HDC_TARGET`——goal 侧是就绪门（deviceEnvFor），普通模式是
 * harness-runner 的设备前置。本桥只消费那个已解析的目标，**绝不读 config、
 * 绝不自建第三套解析**：桥内再解析一次的下场是"解锁 A、hdc 操作 B"
 * （hdc 经 hdcTargetPrefix 在 env 未设时隐式选唯一在线设备）。
 *
 * 因此"未显式指定目标 → 跳过"在入口门存在后只剩两种成因：本 phase 不需要设备，
 * 或调用方在设备门之外的路径上（两者都不该在此对未知目标动手）。
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
      // e5d8a2c4 T3#3：解锁 deps 走 harness 的**唯一**接线，不在此再拼一份。
      // 此前这里手拼四个字段、独独漏了 settle（当时是可选字段，不报错），于是
      // 运行期恢复这条路在真机上恒零等待——正是 2026-08-05 宿主"永久零输入"的那条路。
      deps: deps.buildUnlockDeps(),
    });
    // 只有"确实锁着且没解开"才算外部阻断；"判不出"不阻断（见 blocked 字段说明）
    const blocked = !r.recovered && (r.reason === 'unauthorized' || r.reason === 'unlock_failed');
    return {
      ready: r.recovered,
      note: r.note,
      authorized: r.recovered ? true : r.authorized,
      blocked,
      ...(!r.recovered && r.failureKind ? { failureKind: r.failureKind } : {}),
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
