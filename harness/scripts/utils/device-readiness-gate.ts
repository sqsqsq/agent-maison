// ============================================================================
// device-readiness-gate.ts — 设备就绪门（openspec device-readiness-and-completion t3）
// ----------------------------------------------------------------------------
// 为何是**独立的异步门**而不是复用 runInvokeCapabilityGate：
//   后者是同步函数、只调静态 runCapabilityPreflight、缺口固定产出 verdict='FAIL' +
//   await_human_capability_gap。设备就绪需要异步副作用（模拟器 boot 等待、唤醒、解锁、
//   复验），且"设备不可用"应走既有 external_block defer 契约，而不是冒充静态 capability
//   FAIL。故复用**位置与语义模式**（缺口不产生 agent_invoke_start、不烧轮次、resume 重检），
//   不复用函数。
//
// 为何"未 READY 就不调 agent"是本 change 的结构性核心：
//   framework 无法技术性阻止 agent 用绝对路径调 hdc（AGENTS.md 空白处按"允许"理解），
//   所以"禁止猜密码"只能是指导。真正有效的是让 agent **根本不进入**"发现锁屏后自行
//   处置"的场景——07-28 事故中 agent 正是在这个场景里对用户真机枚举了 10 组常见 PIN。
//
// 顺序（ensureDeviceReady 共享核心，gate 与运行期 wrapper 同一实现）：
//   非秘密 wake → 重新探测 → （已授权则）解锁一次 → 复验 → 必要时按策略选模拟器
// wake 不可省：息屏时 UI tree 不完整，缺了它会直接落入"键位识别不全 → 零输入 fallback"，
// 等于永远处理不了"锁屏了没注意"这个真实场景。
// ============================================================================

import type { LockScreenSnapshot, RevealOutcome, UnlockFailureKind } from './device-unlock-helper';

import {
  capsTestingConclusion,
  classifyTargetKind,
  type DeviceTargetKind,
  type ManagedProcessIdentity,
} from './device-session';
import type { CheckResult } from './types';

export type DeviceReadinessState = 'READY' | 'BLOCKED' | 'AMBIGUOUS';

export interface DeviceTarget {
  serial: string;
  targetKind: DeviceTargetKind;
}

export type ReadinessProbeName =
  | 'device_readiness'
  | 'credential_state_ready'
  | 'adapter_capability_ready';

export interface DeviceReadinessProbeContext {
  configuredSerial?: string | null;
  targets: readonly string[];
  snapshot?: LockScreenSnapshot;
  credentialReady?: boolean;
}

export interface DeviceReadinessProbeResult {
  probe: ReadinessProbeName;
  ready: boolean;
  reason: string;
  category?: UnlockFailureKind;
  diagnostics: {
    target_count: number;
    selected_target: boolean;
    lock_state: 'locked' | 'unlocked' | 'unknown' | 'not_checked';
    container_found: boolean | null;
    digit_count: number | null;
    geometry_failure: boolean | null;
    cooldown: 'cooldown' | 'not_cooldown' | 'ambiguous' | 'unknown';
  };
}

function probeDiagnostics(
  context: DeviceReadinessProbeContext,
  selectedTarget: boolean,
): DeviceReadinessProbeResult['diagnostics'] {
  const snapshot = context.snapshot;
  const reason = snapshot?.keypadDiag?.reason;
  return {
    target_count: context.targets.length,
    selected_target: selectedTarget,
    lock_state:
      snapshot?.locked === true
        ? 'locked'
        : snapshot?.locked === false
          ? 'unlocked'
          : snapshot
            ? 'unknown'
            : 'not_checked',
    container_found: snapshot?.keypadDiag?.containerFound ?? null,
    digit_count: snapshot?.keypadDiag?.found ?? null,
    geometry_failure: snapshot
      ? reason === 'geometry_insane' || reason === 'digit_invalid'
      : null,
    cooldown: snapshot?.cooldown.state ?? 'unknown',
  };
}

export function evaluateDeviceReadinessProbe(
  context: DeviceReadinessProbeContext,
  probe: ReadinessProbeName = 'device_readiness',
): DeviceReadinessProbeResult {
  const configured = context.configuredSerial?.trim();
  const selectedTarget = Boolean(
    configured ? context.targets.includes(configured) : context.targets.length === 1,
  );
  const diagnostics = probeDiagnostics(context, selectedTarget);
  const fail = (reason: string, category?: UnlockFailureKind): DeviceReadinessProbeResult => ({
    probe,
    ready: false,
    reason,
    ...(category ? { category } : {}),
    diagnostics,
  });

  if (probe === 'credential_state_ready') {
    return context.credentialReady === true
      ? { probe, ready: true, reason: 'credential state is ready', diagnostics }
      : fail('credential state is not ready', 'credential_unavailable');
  }
  if (!selectedTarget) {
    return fail(
      configured
        ? 'configured device is not online'
        : context.targets.length === 0
          ? 'no device target is online'
          : 'multiple device targets require explicit target_serial',
    );
  }

  const snapshot = context.snapshot;
  if (!snapshot || snapshot.locked === undefined) {
    return fail('lock state is not observable');
  }
  if (!snapshot.locked) {
    return { probe, ready: true, reason: 'device is unlocked', diagnostics };
  }

  const keypadReason = snapshot.keypadDiag?.reason;
  if (keypadReason === 'pin_container_not_found' ||
      keypadReason === 'geometry_insane' ||
      keypadReason === 'digit_invalid') {
    return fail('lock layout is unsupported (' + keypadReason + ')', 'layout_unsupported');
  }
  if (keypadReason === 'digits_incomplete' ||
      keypadReason === 'keys_hidden') {
    return fail('lock UI is not settled (' + keypadReason + ')', 'ui_not_settled');
  }
  if (snapshot.cooldown.state !== 'not_cooldown') {
    return fail('unlock cooldown is ' + snapshot.cooldown.state);
  }
  if (probe === 'adapter_capability_ready') {
    return keypadReason === 'ok'
      ? { probe, ready: true, reason: 'adapter can observe the lock keypad', diagnostics }
      : fail('lock keypad capability is not ready', 'ui_not_settled');
  }
  return context.credentialReady === true
    ? { probe, ready: true, reason: 'device gate can retry with the registered credential', diagnostics }
    : fail('device is locked and no usable credential is available', 'credential_unavailable');
}

/**
 * e5d8a2c4 T3#2：本次解锁尝试的**结构化事实**——全链**只有这一份**，逐层原样携带。
 *
 * 为什么必须是一份完整事实而不是散字段（codex 三轮 P1）：初版只在 `ensureDeviceReady`
 * 内留了个局部 `unlockFailureKind`，`fallbackToEmulator` 收不到，于是降级路径上归因
 * 全丢；事件层则用 `notes.find(n => n.startsWith('unlock:'))` 反推——正是本类型注释
 * 自己禁止的"解析文案"。
 *
 * `serial` 是**被尝试解锁的那台**，不是最终 READY 的那台。二者可以不同：真机解锁失败
 * → 降级到模拟器 → READY。旧代码在这一幕里发出的是
 * `device_unlock_attempt{serial: 模拟器, outcome: 'succeeded'}`——一条**凭空捏造的
 * 成功记录**，同时把真机那次失败抹掉。证据链上这是最坏的一类错。
 */
export interface UnlockAttemptFact {
  /** 被尝试解锁的设备（可能与最终 target 不同） */
  serial: string;
  /** **复验后**的结论：helper 报成功但重新探测仍锁 → 仍记 failed */
  outcome: 'succeeded' | 'failed';
  /**
   * 三类可行动归因之一；前置/并发/等待类不带（走既有 device_not_ready 通道）。
   * **闭集类型不得放宽成 string**（codex 四批 P2）——放宽后 adapter 可以静默引入
   * 第四、第五种未登记分类而编译器不报警，等于把刚删掉的兜底类从边界重新放回来。
   */
  failureKind?: UnlockFailureKind;
  /**
   * a4e7c2f9：`reveal_failed` 路径的设备命令执行事实（`timedOut`/`errorCode`/`signal`/
   * `status`）。规格要求执行事实**随解锁结论上浮**——只留 `failureKind` 的话，
   * `ETIMEDOUT` 与 `ENOENT` 在事件层无从区分，消费方就又得回去解析 note 文案。
   */
  revealFact?: RevealOutcome;
  note: string;
}

export type DeviceReadinessResult =
  | {
      state: 'READY';
      target: DeviceTarget;
      managed?: ManagedProcessIdentity;
      notes: string[];
      unlockAttempt?: UnlockAttemptFact;
    }
  /**
   * 设备不可用/仍锁屏：走既有 external_block defer 契约（**不是** capability FAIL）。
   *
   * S10：若本次**已经启动了**托管模拟器但没能就绪，`orphanManaged` 携带它的进程身份——
   * 调用方必须据此落 session，否则那个进程再也无从回收。
   */
  | {
      state: 'BLOCKED';
      reason: string;
      notes: string[];
      unlockAttempt?: UnlockAttemptFact;
      orphanManaged?: ManagedProcessIdentity;
      orphanSerial?: string;
    }
  /** 目标无法唯一确定等歧义态：HALT 求人（继续跑等于赌一个设备） */
  | { state: 'AMBIGUOUS'; reason: string; notes: string[]; unlockAttempt?: UnlockAttemptFact };

/** 模拟器降级策略（来自用户本机配置，非发布 profile——否则所有消费者机器都会自动弹 GUI） */
export type EmulatorFallback = 'disabled' | 'existing' | 'managed';

/** 回收裁决：前两种都表示"没有遗留实例"，只有 refused 需要阻断 */
export type ReclaimVerdict = 'reclaimed' | 'already_absent' | 'refused';

export interface DeviceReadinessDeps {
  /** hdc list targets 之类；返回当前在线 serial 列表 */
  listTargets(): string[];
  /** 是否锁屏；无法判定 → undefined（不猜） */
  isLocked(serial: string): boolean | undefined;
  /** Optional single-source snapshot for the supervisor's read-only probe. */
  snapshot?(serial: string): LockScreenSnapshot;
  /** 非秘密唤醒（power-shell wakeup 等）——不涉及任何凭据 */
  wake(serial: string): void;
  /** 已关联到既有 Emulator profile/process 的 serial（用于 target_kind 正面分类） */
  knownEmulatorSerials?(): string[];
  /** 真机正面证据（已验证 HDC 属性组合）；未探测/不确定 → undefined */
  attestPhysical?(serial: string): boolean | undefined;
  /**
   * t6 注入的凭据解锁能力。**本 Todo 不实现**——但 gate 必须调用它，
   * 否则"启动时已锁屏 → BLOCKED → agent 不启动 → 运行期 wrapper 永无机会执行"成死锁。
   */
  unlockWithCredential?(serial: string): {
    ok: boolean;
    note: string;
    failureKind?: UnlockFailureKind;
    revealFact?: RevealOutcome;
  };
  /** 托管启动模拟器（Todo 2 能力）；返回其 serial 与进程身份 */
  launchManagedEmulator?(): Promise<{ ok: boolean; serial?: string; identity?: ManagedProcessIdentity; note: string }>;
  /**
   * 回收一个本 run 此前托管的实例。用于"旧实例不可用 → 新建之前先收干净"，
   * 避免单文件 session 被覆盖后丢失回收凭证。
   *
   * **三态**（四轮 review）：`'reclaimed'`（已终止并确认消失）与 `'already_absent'`
   * （进程本就不在了）都表示"没有遗留实例"，可以安全新建；只有 `'refused'`
   * （身份无法核实 / 终止未确认）才必须阻断。
   * 此前只认 `reclaimed`，于是旧进程**自然退出**这个最常见的情况被当成失败，
   * 明明可以安全新建却永久 BLOCKED。
   */
  reclaimManaged?(identity: ManagedProcessIdentity): ReclaimVerdict;
  /** 等待模拟器就绪（有界）；返回是否就绪 */
  awaitEmulatorReady?(serial: string, budgetMs: number): Promise<boolean>;
}

export interface DeviceReadinessInput {
  /** 用户配置的目标 serial；未配置则由 listTargets 唯一性决定 */
  configuredSerial?: string | null;
  /** R12：本次 attempt 冻结的凭据引用（注入子进程供运行期恢复复用，不重读配置） */
  credentialRef?: string | null;
  emulatorFallback: EmulatorFallback;
  /** 模拟器 boot/readiness 预算（有界，防止 gate 自己变成新的无限等待） */
  emulatorBootBudgetMs?: number;
  /**
   * 本 run 此前已托管启动的模拟器（P1，三轮 review）。
   * 需要降级时优先复用它，避免每个设备 phase 各起一个实例、后写的 session 覆盖前一个
   * 而让旧进程失去回收凭证。`--resume` 同样经此复用。
   */
  existingManaged?: { serial: string | null; identity: ManagedProcessIdentity } | null;
  deps: DeviceReadinessDeps;
}

const DEFAULT_EMULATOR_BOOT_BUDGET_MS = 180_000;

/**
 * 共享就绪核心。gate（invoke 前）与运行期 wrapper（agent 内再次锁屏）**必须同一实现**，
 * 否则两条路径的安全语义会漂移。
 */
export async function ensureDeviceReady(input: DeviceReadinessInput): Promise<DeviceReadinessResult> {
  const notes: string[] = [];
  const { deps } = input;

  const resolved = await resolveTarget(input, notes);
  // 降级路径产出的 READY 已经是**完整结果**（含 managed 身份与 emulator 分类），
  // 直接返回——不得再走下面的 wake/lock/classify 流程，否则会把 targetKind 覆盖成
  // unknown、把 managed 身份丢掉（丢了就再也回收不了那个模拟器）。
  if (resolved.kind !== 'target') return resolved.result;
  const serial = resolved.serial;

  // ① 非秘密 wake（息屏时 UI tree 不完整；wake 不涉及凭据，任何档位都做）
  try {
    deps.wake(serial);
    notes.push(`wake(${serial})`);
  } catch (err) {
    notes.push(`wake 失败（忽略，继续探测）：${(err as Error).message}`);
  }

  // e5d8a2c4 T3#2：本次解锁尝试的**唯一一份**结构化事实（原样来自 ensureUnlocked，
  // 不在此重新分类）。**每一条返回路径都必须带上它**——包括降级到模拟器那条。
  let unlockAttempt: UnlockAttemptFact | undefined;
  const withAttempt = <T extends object>(r: T): T & { unlockAttempt?: UnlockAttemptFact } =>
    (unlockAttempt ? { ...r, unlockAttempt } : r);

  // ② 重新探测锁屏
  let locked = deps.isLocked(serial);
  if (locked === undefined) {
    return withAttempt({ state: 'BLOCKED' as const, reason: `无法判定设备 ${serial} 的锁屏状态`, notes });
  }

  // ③ 已授权则解锁一次 → ④ 复验（t6 注入；未注入=未授权，直接走降级）
  if (locked) {
    if (deps.unlockWithCredential) {
      const attempt = deps.unlockWithCredential(serial);
      notes.push(`unlock: ${attempt.note}`);
      // **先按失败记**：只有复验真的看到未锁屏才改判成功。helper 报 ok 不作数
      // ——这与下面"不凭返回值宣称成功"是同一条纪律，只是也落到了结构化事实上。
      unlockAttempt = {
        serial,
        outcome: 'failed',
        ...(attempt.failureKind ? { failureKind: attempt.failureKind } : {}),
        ...(attempt.revealFact ? { revealFact: attempt.revealFact } : {}),
        note: attempt.note,
      };
      if (attempt.ok) {
        // 复验：不凭返回值宣称成功，必须重新探测
        locked = deps.isLocked(serial);
        if (locked === undefined) {
          return withAttempt({ state: 'BLOCKED' as const, reason: `解锁后无法复验 ${serial} 锁屏状态`, notes });
        }
        if (!locked) unlockAttempt = { ...unlockAttempt, outcome: 'succeeded' };
      }
    } else {
      notes.push('未配置自动解锁（或本次未授权）——不尝试任何密码输入');
    }
  }

  if (!locked) {
    return withAttempt({
      state: 'READY' as const,
      target: { serial, targetKind: classifyKind(input, serial, null) },
      notes,
    });
  }

  // ⑤ 仍锁屏 → 按策略选模拟器。**解锁事实随之带走**：降级成功不改变"这台真机没解开"
  // 这个事实，丢了它，事件里就只剩一条模拟器上的假成功。
  const fallback = await fallbackToEmulator(input, notes, `设备 ${serial} 仍处于锁屏`);
  return withAttempt(fallback);
}

/**
 * 目标解析：配置优先；未配置时要求唯一；零设备/不在线走模拟器策略。
 *
 * 只负责"选出一个待检查的真实目标"或"直接给出终局结果"，**不做** wake/解锁——
 * 那是 ensureDeviceReady 的职责，避免两处各写一遍导致语义漂移。
 */
type TargetResolution =
  | { kind: 'target'; serial: string }
  | { kind: 'settled'; result: DeviceReadinessResult };

async function resolveTarget(
  input: DeviceReadinessInput,
  notes: string[],
): Promise<TargetResolution> {
  const targets = input.deps.listTargets().map(s => s.trim()).filter(Boolean);
  const configured = input.configuredSerial?.trim();

  if (configured) {
    if (!targets.includes(configured)) {
      notes.push(`已配置目标 ${configured} 不在线（在线：${targets.join(', ') || '无'}）`);
      return { kind: 'settled', result: await fallbackToEmulator(input, notes, `配置的目标 ${configured} 不在线`) };
    }
    return { kind: 'target', serial: configured };
  }

  if (targets.length === 0) {
    notes.push('无在线设备');
    return { kind: 'settled', result: await fallbackToEmulator(input, notes, '无在线设备') };
  }
  if (targets.length > 1) {
    // 多设备不唯一：**停止要求配置**，不赌"第一个"——凭据/操作打到别人的手机上不可接受
    return {
      kind: 'settled',
      result: {
        state: 'AMBIGUOUS',
        reason: `检测到多个设备（${targets.join(', ')}）且未配置 target_serial，无法唯一确定目标`,
        notes,
      },
    };
  }
  return { kind: 'target', serial: targets[0] };
}

async function fallbackToEmulator(
  input: DeviceReadinessInput,
  notes: string[],
  reason: string,
): Promise<DeviceReadinessResult> {
  const { deps, emulatorFallback } = input;
  if (emulatorFallback === 'disabled') {
    return { state: 'BLOCKED', reason: `${reason}；模拟器降级未启用`, notes };
  }

  if (emulatorFallback === 'existing') {
    const known = deps.knownEmulatorSerials?.() ?? [];
    const online = deps.listTargets();
    const hit = known.find(s => online.includes(s));
    if (!hit) return { state: 'BLOCKED', reason: `${reason}；无可复用的既有模拟器`, notes };
    notes.push(`复用既有模拟器 ${hit}（不回收：非本 run 启动）`);
    return { state: 'READY', target: { serial: hit, targetKind: 'emulator' }, notes };
  }

  // managed：本 run 托管启动
  //
  // P1（三轮 review）：**先看本 run 是否已经有一个还活着的托管实例**。
  // 每个设备 phase 都会重新走一遍就绪判定，真机若一直锁着，UT 起一个、testing 再起
  // 一个——第二个 session 覆盖第一个，前一个实例就此失去回收凭证。--resume 同理。
  // 复用的前提是它**此刻确实可用**（在 hdc 里 + 未锁屏），否则照常新建。
  // P1（四轮 review）：判据是 **identity**，不是 serial。启动失败的 session 允许
  // `serial:null` 而 `managed` 有值（gate 自己就会写这种记录）——此前要求 serial 为真，
  // 那类 session 会整段跳过回收，直接起第二个实例，旧的永久泄漏。
  const reusable = input.existingManaged;
  if (reusable?.identity) {
    const online = reusable.serial ? deps.listTargets().includes(reusable.serial) : false;
    const locked = online && reusable.serial ? deps.isLocked(reusable.serial) : undefined;
    if (online && locked === false) {
      notes.push(`复用本 run 已托管的模拟器 ${reusable.serial}（pid=${reusable.identity.pid}），不再新建实例`);
      return {
        state: 'READY',
        target: { serial: reusable.serial!, targetKind: 'emulator' },
        managed: reusable.identity,
        notes,
      };
    }
    // P1（三轮 review）：**旧实例必须先回收再新建**。
    // session 是单文件模型：新实例一写就覆盖旧记录，而当前 run 又被
    // `collectForeignManagedSessions` 排除、退出清理只读最新 session —— 旧实例的
    // pid 四元组就此永久丢失，必然泄漏。回收不确认就 BLOCKED，不赌。
    const verdict = deps.reclaimManaged?.(reusable.identity);
    // 三态：reclaimed / already_absent 都表示"没有遗留实例"，可安全新建；
    // 只有 refused（身份无法核实、终止未确认）与"没有回收能力"才阻断。
    if (verdict !== 'reclaimed' && verdict !== 'already_absent') {
      return {
        state: 'BLOCKED',
        reason:
          `${reason}；本 run 已托管的模拟器 ${reusable.serial ?? '(serial 未知)'}` +
          `（pid=${reusable.identity.pid}）此刻不可用，` +
          `且未能确认回收（${verdict === undefined ? '未提供回收能力' : '回收被拒绝'}）——` +
          '拒绝新建第二个实例（会丢失旧实例的回收凭证）',
        notes,
        orphanManaged: reusable.identity,
        ...(reusable.serial ? { orphanSerial: reusable.serial } : {}),
      };
    }
    notes.push(
      `本 run 曾托管 ${reusable.serial ?? '(serial 未知)'}，此刻不可用` +
        `（online=${online} locked=${String(locked)}）；` +
        `旧实例已确认无遗留（${verdict}，pid=${reusable.identity.pid}），可安全新建`,
    );
  }

  if (!deps.launchManagedEmulator) {
    return { state: 'BLOCKED', reason: `${reason}；本 profile 未提供模拟器托管能力`, notes };
  }
  const launched = await deps.launchManagedEmulator();
  notes.push(`launchManagedEmulator: ${launched.note}`);
  if (!launched.ok || !launched.serial) {
    // S10：**失败也要把 identity 交出去**。进程可能已经起来了（只是没在 hdc 里出现），
    // 丢掉 identity 就等于丢掉唯一的回收凭证 —— 那个模拟器会一直挂着没人管。
    return {
      state: 'BLOCKED',
      reason: `${reason}；模拟器启动失败`,
      notes,
      orphanManaged: launched.identity,
    };
  }
  const budget = input.emulatorBootBudgetMs ?? DEFAULT_EMULATOR_BOOT_BUDGET_MS;
  const ready = (await deps.awaitEmulatorReady?.(launched.serial, budget)) ?? false;
  if (!ready) {
    // 有界超时——gate 自己绝不能变成新的无限等待（这正是本 change 要根治的病）
    return {
      state: 'BLOCKED',
      reason: `${reason}；模拟器 ${launched.serial} 在 ${budget}ms 内未就绪`,
      notes,
      orphanManaged: launched.identity,
      orphanSerial: launched.serial,
    };
  }
  notes.push(`托管模拟器 ${launched.serial} 已就绪（本 run 启动，退出时回收）`);
  return {
    state: 'READY',
    target: { serial: launched.serial, targetKind: 'emulator' },
    managed: launched.identity,
    notes,
  };
}

function classifyKind(
  input: DeviceReadinessInput,
  serial: string,
  managedSerial: string | null,
): DeviceTargetKind {
  return classifyTargetKind({
    serial,
    managedEmulatorSerial: managedSerial,
    knownEmulatorSerials: input.deps.knownEmulatorSerials?.() ?? [],
    physicalAttested: input.deps.attestPhysical?.(serial),
  });
}

export interface DeviceGateOutcome {
  phase: string;
  verdict: 'FAIL';
  halted: boolean;
  retries: number;
  halt_reason?: string;
  halt_guidance?: string;
  /** BLOCKED 走既有设备阻断契约，供上层归入 external_block（不是 capability FAIL） */
  blocking_class?: string;
  failure_kind?: string;
  probe?: ReadinessProbeName;
}

export interface DeviceGateDecision {
  /** 非空 = 未取得 READY：调用方**必须**据此终止本 attempt，且不得产生 agent_invoke_start */
  outcome?: DeviceGateOutcome;
  /** READY 时的子进程 env 片段 */
  env?: Record<string, string>;
  target?: DeviceTarget;
  managed?: ManagedProcessIdentity;
  notes: string[];
}

/**
 * runner 适配层：把 ensureDeviceReady 的三态翻译成 goal 的 outcome/事件语义。
 *
 * - `BLOCKED`   → `external_block` 契约（`externalBlocked`/`device_blocked`），可 defer、指引修环境；
 * - `AMBIGUOUS` → HALT 求人（多设备无法唯一确定时继续跑等于赌一台别人的手机）；
 * - `READY`     → 返回 env 片段供 `extraEnv` 注入。
 *
 * **调用方契约**：outcome 非空时必须在 `agent_invoke_start` **之前**结束本 attempt。
 * 这是"agent 根本不进入锁屏自处置场景"的执行点。
 */
export async function runDeviceReadinessGate(opts: {
  phase: string;
  retries: number;
  sessionId: string;
  input: DeviceReadinessInput;
  emitEvent: (event: Record<string, unknown>) => void;
}): Promise<DeviceGateDecision> {
  const res = await ensureDeviceReady(opts.input);

  // t6：解锁尝试的**审计投影**——安全 SSOT 是机器级 Credential Manager 锁存
  //（device-credential-store），goal events 只作可回溯记录，**不参与放行判定**。
  // 这也保证 events 里永远看不到口令本身（note 由 helper 产出，已剔除凭据细节）。
  //
  // 事实**原样来自** res.unlockAttempt，三态共用同一段代码。此前 READY 与非 READY
  // 各写一遍、且都靠 `notes.find(n => n.startsWith('unlock:'))` 反推，于是：
  //   · READY 分支把 outcome 硬编码成 'succeeded'、serial 取**最终 target**
  //     → "真机解锁失败 + 模拟器降级成功"会产出一条模拟器上的**假成功**记录，
  //       真机那次失败被彻底抹掉；
  //   · 非 READY 分支硬编码 'failed' 且不带 serial。
  // 现在成败与 serial 都由事实本身说了算（codex 三轮 P1）。
  const attempt = res.unlockAttempt;
  const probe: ReadinessProbeName | undefined =
    res.state === 'AMBIGUOUS'
      ? undefined
      : attempt?.failureKind === 'credential_unavailable'
        ? 'credential_state_ready'
        : attempt?.failureKind === 'layout_unsupported'
          ? 'adapter_capability_ready'
          : 'device_readiness';
  if (attempt) {
    opts.emitEvent({
      type: 'device_unlock_attempt',
      phase: opts.phase,
      serial: attempt.serial,
      outcome: attempt.outcome,
      ...(attempt.failureKind ? { failure_kind: attempt.failureKind } : {}),
      // a4e7c2f9：reveal 命令执行事实（全脱敏枚举/数字）。消费方按 error_code 区分
      // ETIMEDOUT 与 ENOENT，无须解析 note 文案。
      ...(attempt.revealFact
        ? {
            reveal_exec: {
              timed_out: attempt.revealFact.timedOut,
              error_code: attempt.revealFact.errorCode ?? null,
              signal: attempt.revealFact.signal ?? null,
              status: attempt.revealFact.status ?? null,
            },
          }
        : {}),
      ...(probe ? { probe } : {}),
      note: attempt.note,
    });
  }

  if (res.state === 'READY') {
    opts.emitEvent({
      type: 'device_ready',
      phase: opts.phase,
      serial: res.target.serial,
      target_kind: res.target.targetKind,
      managed: Boolean(res.managed),
      notes: res.notes,
    });
    return {
      // R12：把本次解析到的凭据引用一并冻结进子进程 env
      env: deviceEnvFor(res.target, opts.sessionId, opts.input.credentialRef ?? null),
      target: res.target,
      managed: res.managed,
      notes: res.notes,
    };
  }

  const halted = res.state === 'AMBIGUOUS';
  const haltReason = halted ? 'device_target_ambiguous' : 'device_not_ready';
  opts.emitEvent({
    type: 'phase_halt',
    phase: opts.phase,
    halt_reason: haltReason,
    verdict: 'FAIL',
    reason: res.reason,
    // 三类可行动归因随 halt 一并落盘，供 supervisor/probe **按类别**决定下一步
    // （重新登记 / 真机校准 / 自动重试），而不是去 grep notes 文案
    ...(attempt?.failureKind ? { unlock_failure_kind: attempt.failureKind } : {}),
    ...(probe ? { probe } : {}),
    notes: res.notes,
  });
  return {
    // S10：BLOCKED 时若有孤儿托管进程，交给调用方落 session 以便回收
    ...(res.state === 'BLOCKED' && res.orphanManaged
      ? { managed: res.orphanManaged, target: { serial: res.orphanSerial ?? '', targetKind: 'emulator' as const } }
      : {}),
    outcome: {
      phase: opts.phase,
      verdict: 'FAIL',
      halted,
      retries: opts.retries,
      halt_reason: haltReason,
      halt_guidance: res.reason,
      // BLOCKED 复用既有设备阻断分类（与 t1 的 ut 侧同一套契约），使其可 defer 且
      // 指引指向"修环境"而非"改代码"；AMBIGUOUS 是配置问题，不打设备阻断标。
      ...(res.state === 'BLOCKED'
        ? { blocking_class: 'externalBlocked', failure_kind: 'device_blocked' }
        : {}),
      ...(probe ? { probe } : {}),
    },
    notes: res.notes,
  };
}

// ---------------------------------------------------------------------------
// 普通模式入口适配层（b3f7d9a2 t2）
// ---------------------------------------------------------------------------

/**
 * 普通模式（`harness-runner --phase ut|testing`）的设备前置。
 *
 * 与 `runDeviceReadinessGate`（goal 适配层）**共用同一就绪核心 ensureDeviceReady**，
 * 只是出口语义不同：goal 侧翻译成 outcome/事件，这里翻译成"前脚本 fail-fast"。
 *
 * 为什么必须有这个门（2026-08-17 宿主事故）：
 *   ① 解锁链的目标解析只认显式 serial / `HARNESS_HDC_TARGET`，而普通模式**没人注入**
 *      该 env（只有 goal 的就绪门经 deviceEnvFor 注入）；同时 hdc 经 hdcTargetPrefix
 *      在 env 未设时**隐式选唯一在线设备**。于是 UT 能对设备装机执行，解锁链却
 *      "不知道对哪台动手"而整体跳过——凭据 ready 也不会被使用。
 *   ② 普通模式此前只有 SKILL 文档要求跑 `device-policy --check`，无进程级门；
 *      agent 直跑 hvigor/aa test 就绕过了四选一。
 *
 * 契约：**目标只解析一次**，解析结果经 `deviceEnvFor` 注入本进程 env，后续
 * wake/解锁/`bm dump`/install/`aa test` 全链经 hdcTargetPrefix 共用同一 serial。
 */
export interface PhaseEntryDeviceGateDecision {
  ok: boolean;
  /** 未通过时的人读原因（调用方原样打印后非零退出，不再调用任何 checker/provider） */
  reason?: string;
  notes: string[];
  /** 通过且本次真的解析了目标时给出；调用方据此注入 env */
  env?: Record<string, string>;
  target?: DeviceTarget;
  /**
   * 本次托管启动的模拟器（调用方须注册退出回收）。
   *
   * **READY 与非 READY 都可能有**：托管实例"起来了但没就绪"（boot 超时/仍锁屏）
   * 是普通的可执行清理失败路径——丢掉它那个进程就零凭证泄漏。故与 goal 适配层
   * 同款投影 `orphanManaged`，且调用方必须在任何退出分支**之前**登记回收。
   */
  managed?: ManagedProcessIdentity;
  /** 非 READY 时孤儿实例的 serial（可能为 null：启动失败时就没拿到 serial） */
  orphanSerial?: string | null;
  /** true = 命中 goal 已冻结的 attempt 上下文，本门整体让路（零解析、零策略查询） */
  reusedFrozen?: boolean;
}

/**
 * 冻结上下文的判据是**双字段**。
 *
 * goal 的就绪门成功时经 `deviceEnvFor` **成组**注入 target/session/frozen；只看
 * `MAISON_DEVICE_ATTEMPT_FROZEN` 一个字段就让路，等于"手工设一个环境变量即可绕过本门
 * 并重获隐式设备路径"。故 frozen 但缺 target = 冻结上下文损坏，**fail-closed**。
 */
function readFrozenContext(env: NodeJS.ProcessEnv): { frozen: boolean; target: string | null } {
  return {
    frozen: env.MAISON_DEVICE_ATTEMPT_FROZEN === '1',
    target: env.HARNESS_HDC_TARGET?.trim() || null,
  };
}

export async function runPhaseEntryDeviceGate(opts: {
  projectRoot: string;
  phase: string;
  /** 注入点：默认读真实 process.env */
  env?: NodeJS.ProcessEnv;
  /** 注入点：默认 collectPolicyStatus（可抛 = 策略检查执行失败，由调用方 fail-fast） */
  policy?: () => { code: 'ok' | 'device_policy_unset'; guidance: string };
  /** 注入点：默认 buildDeviceReadinessInput(projectRoot) */
  buildInput?: () => DeviceReadinessInput;
  /** 注入点：默认 ensureDeviceReady */
  ensureReady?: (input: DeviceReadinessInput) => Promise<DeviceReadinessResult>;
  /** 注入点：默认 deviceEnvFor */
  sessionId?: string;
}): Promise<PhaseEntryDeviceGateDecision> {
  const env = opts.env ?? process.env;
  const notes: string[] = [];

  // ① 冻结优先（双字段）
  const { frozen, target: envTarget } = readFrozenContext(env);
  if (frozen) {
    if (!envTarget) {
      return {
        ok: false,
        notes,
        reason:
          '[device] attempt 已标记冻结（MAISON_DEVICE_ATTEMPT_FROZEN=1）却没有 HARNESS_HDC_TARGET——\n' +
          '  冻结上下文损坏，拒绝继续（不回落"隐式选唯一在线设备"，否则手工设一个环境变量即可绕过设备门）。\n' +
          '  正常情况下二者由 goal 的设备就绪门成组注入。请清掉该环境变量后重跑，或经 goal 模式启动。',
      };
    }
    notes.push(`复用已冻结的 attempt 目标 ${envTarget}（不重解析、不重查策略）`);
    return { ok: true, notes, reusedFrozen: true };
  }

  // ② 策略检查（provider 读失败会抛 → 调用方按"执行失败"停止）
  const status = opts.policy
    ? opts.policy()
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../device-policy') as typeof import('../device-policy')).collectPolicyStatus(opts.projectRoot);
  if (status.code !== 'ok') {
    return {
      ok: false,
      notes,
      reason:
        `[device] 本阶段需要设备，但设备策略不可用（code=${status.code}）。\n` +
        `${status.guidance}`,
    };
  }
  notes.push('设备策略检查通过（code=ok）');

  // ③ 目标解析 + 就绪：**唯一路径** buildDeviceReadinessInput → ensureDeviceReady。
  // 显式 env 优先于 config：否则手工设了 HARNESS_HDC_TARGET 而 config 另指一台时，
  // 解锁链解析到 config 那台、hdc 却用 env 那台——正是本次要消灭的目标分裂。
  const base = opts.buildInput
    ? opts.buildInput()
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./device-readiness-deps') as typeof import('./device-readiness-deps')).buildDeviceReadinessInput(
        opts.projectRoot,
      );
  const input: DeviceReadinessInput = envTarget ? { ...base, configuredSerial: envTarget } : base;
  const res = await (opts.ensureReady ?? ensureDeviceReady)(input);
  notes.push(...res.notes);

  if (res.state !== 'READY') {
    const head =
      res.state === 'AMBIGUOUS'
        ? '[device] 设备目标无法唯一确定——停止求人（继续跑等于赌一台别人的手机）。'
        : '[device] 设备未就绪，已在执行任何设备操作之前阻断。';
    return {
      ok: false,
      notes,
      // 孤儿托管实例随失败一起交出（与 goal 适配层的 orphanManaged 投影同款）：
      // 调用方必须先登记回收再退出，否则这个已启动的进程再无回收凭证。
      ...(res.state === 'BLOCKED' && res.orphanManaged
        ? { managed: res.orphanManaged, orphanSerial: res.orphanSerial ?? null }
        : {}),
      reason:
        `${head}\n  ${res.reason}\n` +
        '  修复建议：按上面的具体原因处理（人工解锁 / 稍后重试 / 重新登记凭据 / 配置 device.target_serial ' +
        '/ 启用已授权的模拟器降级），然后重跑本阶段。',
    };
  }

  return {
    ok: true,
    notes,
    // 复用 deviceEnvFor：env 形状**只有一份**。此前 profile 侧手拼字段漏了 settle，
    // 造成真机恒零等待（见 device-recovery-bridge 头注），不再手拼第二份。
    env: deviceEnvFor(res.target, opts.sessionId ?? `harness-${opts.phase}-${process.pid}`, input.credentialRef ?? null),
    target: res.target,
    ...(res.managed ? { managed: res.managed } : {}),
  };
}

/**
 * 把门产出的冻结上下文**整组原子**应用到一个 env 对象（普通模式：该对象就是
 * `process.env`）。提成函数是为了让"原子性"能被行为测试直接验证，而不是只靠源码正则。
 *
 * 规则：**整组以 `gateEnv` 为准**。
 * - `MAISON_DEVICE_*` 是本次 attempt 的冻结上下文，应用后 MUST 恰好等于 `gateEnv` 的产出
 *   ——**未返回的键一律删除**。此前逐键"不存在才写"会留下继承来的陈旧
 *   `MAISON_DEVICE_CREDENTIAL_REF`，而 `resolveAttemptCredentialRef` 优先取它，于是
 *   **manual 策略下也会自动输入 PIN**：这是越权路径，不是配置瑕疵。
 * - `HARNESS_HDC_TARGET` **同样以门返回值为准，不保留旧值**。显式目标的优先级已经在门的
 *   **输入阶段**兑现（envTarget → configuredSerial），到这一步 `gateEnv` 里的 target 就是
 *   最终裁决：没降级时它本来就等于显式值；发生**已授权降级**时它是模拟器 serial。
 *   此前在这里保留旧值，会造出 `HARNESS_HDC_TARGET=离线真机` 与
 *   `MAISON_DEVICE_TARGET_KIND=emulator` 并存的**目标分裂**——hdc 去操作离线真机，而门与
 *   testing 封顶都以为目标是模拟器，正是本 change 要消灭的那个形态。
 */
export function applyFrozenDeviceEnv(
  procEnv: NodeJS.ProcessEnv,
  gateEnv: Record<string, string>,
): void {
  for (const k of Object.keys(procEnv)) {
    if (k.startsWith('MAISON_DEVICE_') && !(k in gateEnv)) delete procEnv[k];
  }
  for (const [k, v] of Object.entries(gateEnv)) {
    procEnv[k] = v;
  }
}

/**
 * 模拟器/未知目标的 testing 结论封顶（harness-gates spec：`target_kind ∈ {emulator,
 * unknown}` 时 MUST 封顶，MUST NOT 判定整体通过；`unknown` 与模拟器同等处理，禁反向推断）。
 *
 * 判据复用既有 `capsTestingConclusion`；归因走既有 `externalBlocked`/`device_blocked`
 * 通道（环境类可 defer，不是代码回归）。**不依赖 agent 自报**——分类由设备门给出。
 * 返回 `undefined` = 无需封顶。
 */
export function buildTestingTargetKindCap(phase: string, target: DeviceTarget): CheckResult | undefined {
  if (!capsTestingConclusion(phase, target.targetKind)) return undefined;
  const isUnknown = target.targetKind === 'unknown';
  return {
    id: 'device_target_kind_caps_testing',
    category: 'structure',
    description: 'testing 结论不得由模拟器/未知目标冒充真机通过',
    severity: 'BLOCKER',
    status: 'FAIL',
    details:
      `本次 testing 的设备目标 ${target.serial} 分类为 \`${target.targetKind}\`（非 physical），` +
      '依 harness-gates 规格**结论封顶**，不得判定整体通过。\n' +
      (isUnknown
        ? '  `unknown` = 未能由正面证据确认是真机（禁反向推断），与模拟器同等封顶。'
        : '  模拟器上的 testing 不能替代真机验收。'),
    suggestion: isUnknown
      ? '接入真机并完成 physical attestation 校准后重跑 testing；或如实按模拟器结论对待本轮。'
      : '接入真机后重跑 testing；模拟器结论只能作为过程证据。',
    blocking_class: 'externalBlocked',
    failure_kind: 'device_blocked',
  };
}

/** 就绪结果 → 注入 agent 子进程的 env（**不写全局 process.env**，否则多 phase/run 串 target） */
export function deviceEnvFor(
  target: DeviceTarget,
  sessionId: string,
  /** R12：invoke 前冻结的凭据引用——运行期恢复须用它，不得重读当前配置 */
  credentialRef?: string | null,
): Record<string, string> {
  return {
    HARNESS_HDC_TARGET: target.serial,
    MAISON_DEVICE_TARGET_KIND: target.targetKind,
    MAISON_DEVICE_SESSION_ID: sessionId,
    // P1（三轮 review）：**冻结标记必须无条件注入**。此前只在有 ref 时注入 ref，
    // 于是"以 manual 模式开跑的 attempt"在下游看来与"根本没跑 gate"无法区分，
    // 运行期便回落去读实时配置——用户中途改配置就能给正在跑的 attempt 静默提权。
    // 有了这个标记，下游可以判定"本 attempt 已冻结且未授权"，从而拒绝回落。
    MAISON_DEVICE_ATTEMPT_FROZEN: '1',
    ...(credentialRef ? { MAISON_DEVICE_CREDENTIAL_REF: credentialRef } : {}),
  };
}

export { capsTestingConclusion };
