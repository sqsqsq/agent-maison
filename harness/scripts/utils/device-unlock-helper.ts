// ============================================================================
// device-unlock-helper.ts — 解锁执行器（openspec device-readiness-and-completion t6）
// ----------------------------------------------------------------------------
// **helper 永不返回凭据**：本模块只暴露 `ensureUnlocked(serial)`，口令自始至终留在
// OS 凭据库与 provider 的 helper 进程内，绝不进入本进程的变量、返回值、日志、事件
// 或异常消息。调用方（gate / 运行期 wrapper）只知道"成功/失败"。
//
// 事故对照（07-28，agent 自建的解锁脚本，三行要害——此处刻意不复制其字面量，
// 以免与"源码不得内含任何候选口令"的反回归断言冲突）：
//   ① 一张**固定分辨率**的数字键坐标表（换机型/分辨率即乱点）；
//   ② 一个**常见口令候选数组**（十项）；
//   ③ 一个遍历该数组逐个试的循环。
// 本模块的约束逐条对着它们：
//   - 对 ①：坐标**必须从当前 UI tree 解析**，0–9 识别不全即零输入，绝不用固定坐标兜底；
//   - 对 ②③：只用**用户登记的那一个**凭据（无候选集、无遍历），且仅当**实际尝试输入后**
//     执行/复验失败才烧毁该凭据版本——换口令重试这条路本身被堵死；零输入分支不烧毁。
//
// 互斥不再依赖文件锁：`claimAndUnlock` 用 CredWrite 的覆盖语义抢占，读回校验 nonce
// 才是赢家（见 device-credential-store 文件头）。
// ============================================================================

import {
  canAttemptUnlock,
  newClaimNonce,
  parseCredentialRef,
  windowsCredentialProvider,
  type CredentialIdentity,
  type CredentialProvider,
} from './device-credential-store';

export interface KeypadKey {
  digit: string;
  x: number;
  y: number;
}

/**
 * **同一份 UI 快照**内同时给出锁屏判定与键位（P0-2）。
 *
 * 为何必须同源：此前 `isLocked` 与 `readKeypad` 是两次独立 dumpLayout，两次之间 UI
 * 可能已经从锁屏切到别的界面。若那个界面恰好也有 0–9 数字键（应用内支付密码框、
 * 计算器…），helper 就会把**手机解锁 PIN 逐位敲进那个应用**。这不是理论风险：
 * 解锁流程本来就常伴随界面跳转。
 *
 * 因此键位**必须**取自被判定为锁屏的那一棵树，且只取锁屏根组件子树内的按键。
 */
export type LockCooldownState = 'cooldown' | 'not_cooldown' | 'ambiguous';

export interface ScreenBounds { left: number; top: number; right: number; bottom: number }

export interface LockScreenSnapshot {
  /** 该快照是否显示锁屏；判不出 → undefined（不猜） */
  locked: boolean | undefined;
  /** **锁屏 PIN 容器内**的数字键位；非锁屏时应为空 */
  keypad: KeypadKey[];
  /** 冷却三态与稳定规则号；不得携带任何 UI 原文。 */
  cooldown: { state: LockCooldownState; ruleId: string };
  /**
   * e5d8a2c4 T3#1：键位识别的结构化归因（非敏感：容器在否/识别到几个/何种校验不过）。
   * 缺省视为未知——旧 stub/夹具不带该字段时按 `digits_incomplete` 处置（可 settle 重试）。
   */
  keypadDiag?: { reason: string; found: number; containerFound: boolean; hiddenSkipped: boolean };
  /** reveal gesture 的相对坐标来源；缺失时不使用固定分辨率兜底。 */
  lockBounds?: ScreenBounds;
}

export interface UnlockDeps {
  /** 取**一份**锁屏 UI 快照：锁屏判定、键位、冷却同源 */
  snapshot(serial: string): LockScreenSnapshot;
  /** 非秘密唤醒 */
  wake(serial: string): void;
  /** 仅展示 PIN 键盘的非秘密上滑；坐标由当前锁屏 bounds 推导。 */
  reveal(serial: string, bounds: ScreenBounds): void;
  /** 点击坐标（argv 只出现数字坐标，**不出现 PIN 字符**） */
  tap(serial: string, x: number, y: number): void;
  /**
   * T3#3：reveal 后每次重取样之前的等待（观察域动作，不碰凭据）。
   *
   * **刻意设为必填**：此前它是可选、生产两处接线都没传，于是"有界 settle"在真机上
   * 恒等于零等待——而单测注入了计数桩，全绿。可选字段的缺省值就是这样变成事故的
   * （fail-open 缺省 = 静默回到坏行为）。现在类型层面强制两条路径都必须显式接线。
   *
   * 间隔本身是**固定常量**（{@link SETTLE_INTERVAL_MS}），不作为依赖注入：
   * 初版把 `settleMs`/`maxResamples`/`now` 都开成注入项，还配了「dump 耗时计入间隔、
   * 只补差额」的计时契约与一套总预算校验。codex 三轮指出那是过度通用化，复盘属实——
   * 那条契约的真实收益是**省延迟**（慢 dump 时不额外等），被我包装成了"正确性契约"。
   * 正确性只要求"存在真实间隔"，固定间隔无条件满足；代价是最坏多等
   * {@link SETTLE_INTERVAL_MS} × {@link MAX_RESAMPLES}，有界且远小于同链路上既有的
   * 同步 spawnSync。假时钟、差额计算、总预算校验一并删除。
   */
  settle(ms: number): void;
}

/** reveal 后每次重取样之前的固定间隔。与相邻的一次 dumpLayout 同量级。 */
export const SETTLE_INTERVAL_MS = 400;
/** reveal 后额外重取样次数上限（连同首帧共 4 帧）。 */
export const MAX_RESAMPLES = 3;

/**
 * e5d8a2c4 T3#2：解锁失败的**结构化类别**——只设**有处置差异的三类**。
 * 必须是类型字段而不是 note 里的字符串——否则 supervisor / probe / 事件消费者只能
 * 解析文案或**再分类一次**，等于又造第二份分类表（本纲要治的正是这个）。
 * · `credential_unavailable`：凭据不可用/被烧/未登记/非数字 PIN → 走凭据登记流程；
 * · `ui_not_settled`：键盘未稳（动画/遮挡）→ 可自动 settle 重试；
 * · `layout_unsupported`：布局不认识 → 须真机校准，probe=framework/adapter 版本变化。
 *
 * 刻意**不设** `unlock_failed`：输入失败会烧毁凭据版本，下一步同样是**重新登记**
 * ——处置相同即不该分家（codex 二轮：按处置差异收敛，不按事件来源分类）。
 *
 * 也刻意**不设**兜底类（codex 三轮驳回了我加的 `precondition_unmet`）。当时的理由是
 * "冷却/状态不明/bounds 缺失也该有个类"，但真去数它的成员就发现它是个垃圾桶：
 * `absent`（凭据不存在）与 `unsupported`（非数字 PIN）本就是 `credential_unavailable`，
 * 被兜底类**错归**了；剩下的冷却、锁屏状态判不出、并发抢占，处置各不相同，
 * 合成一类等于没分类，只是凭空扩大了下游值空间。故 `failureKind` **可选**：
 * 三类之外**不带 kind**，照走既有 `device_not_ready` 通道（与本改动前一致）。
 */
export type UnlockFailureKind =
  | 'credential_unavailable'
  | 'ui_not_settled'
  | 'layout_unsupported';

export type UnlockOutcome =
  | { ok: true; note: string }
  /** `failureKind` 缺省 = 无可行动类别（前置/并发/等待类），调用方按既有通道处置 */
  | { ok: false; note: string; attempted: boolean; failureKind?: UnlockFailureKind };

export interface UnlockInput {
  serial: string;
  /** framework.local.json 的 opaque credential_ref */
  credentialRef: string;
  deps: UnlockDeps;
  provider?: CredentialProvider;
}

/**
 * 确保设备已解锁。返回值**只有成败**，不含任何凭据信息。
 *
 * 顺序（与 gate 的 ensureDeviceReady 共用同一语义）：
 *   读 CM 状态放行判定 → wake → 首帧取样 → 必要时 reveal + 二帧取样 → 冷却/键位校验 →
 *   claim 抢占并点击（同一 helper 进程内）→ **重新取样**复验 → commit / burn
 */
export function ensureUnlocked(input: UnlockInput): UnlockOutcome {
  const { serial, deps } = input;
  const id: CredentialIdentity | null = parseCredentialRef(input.credentialRef);
  if (!id) return { ok: false, note: 'credential_ref 非法', attempted: false };
  if (id.serial !== serial) {
    // A 机凭据绝不用于 B 机
    return { ok: false, note: `凭据绑定的 serial 与目标不符（${id.serial} ≠ ${serial}）`, attempted: false };
  }

  const provider = input.provider ?? windowsCredentialProvider();

  // 放行判定**只读 OS 凭据库状态**（plan D3g 的唯一安全 SSOT）。非 ready 一律零输入。
  const gate = canAttemptUnlock(id, provider);
  if (!gate.ok) return { ok: false, note: gate.reason, attempted: false, failureKind: 'credential_unavailable' };

  // 先唤醒再取快照：息屏时 UI tree 不完整，先探测必然判不出（P1）
  deps.wake(serial);

  // 首帧只用于确认锁屏/冷却/键盘状态；时钟帧不会被误当成 PIN 键盘。
  let snap = deps.snapshot(serial);
  if (snap.locked === undefined) {
    return { ok: false, note: 'unlock_blocked:lock_state_unknown（零输入）', attempted: false };
  }
  if (!snap.locked) return { ok: true, note: '已解锁（无需输入）' };

  const cooldownBlocked = (s: LockScreenSnapshot): UnlockOutcome | null => {
    if (s.cooldown.state === 'cooldown') {
      return { ok: false, note: `unlock_blocked:${s.cooldown.ruleId}（冷却期，零输入）`, attempted: false };
    }
    if (s.cooldown.state === 'ambiguous') {
      return { ok: false, note: `unlock_blocked:${s.cooldown.ruleId}（冷却状态不明确，零输入）`, attempted: false };
    }
    return null;
  };
  const initialCooldown = cooldownBlocked(snap);
  if (initialCooldown) return initialCooldown;

  /**
   * e5d8a2c4 T3#2：设备失败**只保留有处置差异的三类**——多一类就是多一条没人会走的路。
   * · `credential_unavailable` 走凭据登记流程（本函数其余 gate 分支）；
   * · `ui_not_settled`         可自动 settle 重试（本进程已试满）；
   * · `layout_unsupported`     须真机校准，其 probe = framework 版本 / adapter capability 变化。
   * 归因随附**非敏感结构化事实**，让消费方不必再猜（2026-08-05 宿主实况：agent 列了
   * 一串可能原因逐个试）。
   */
  /** **唯一分类点**：note 只做展示，结构化类别由本函数产出（禁两处各判一次） */
  const unlockFailureKindOf = (s: LockScreenSnapshot): UnlockFailureKind => {
    const reason = s.keypadDiag?.reason ?? 'digits_incomplete';
    return reason === 'pin_container_not_found' || reason === 'geometry_insane' || reason === 'digit_invalid'
      ? 'layout_unsupported'
      : 'ui_not_settled';
  };
  const unlockBlockedNote = (s: LockScreenSnapshot): string => {
    const d = s.keypadDiag;
    const reason = d?.reason ?? 'digits_incomplete';
    const cls = unlockFailureKindOf(s);
    const facts = d
      ? `container=${d.containerFound ? 'found' : 'absent'} digits=${d.found}/10 hidden_skipped=${d.hiddenSkipped}`
      : 'diag=unavailable';
    const hint = cls === 'layout_unsupported'
      ? '锁屏布局与当前适配不符——须真机校准（重试无意义；升级 framework/更换 adapter 后重试）'
      : '键盘尚未稳定——已在本进程内有界重取样后仍不齐（遮挡/动画/AOD 等）';
    return `unlock_blocked:${cls}:${reason}（零输入；${facts}；${hint}）`;
  };

  const completeKeypad = (s: LockScreenSnapshot): Map<string, KeypadKey> | null => {
    const map = new Map(s.keypad.map(k => [k.digit, k]));
    return s.keypad.length === 10 && map.size === 10 &&
      '0123456789'.split('').every(d => map.has(d)) ? map : null;
  };

  let byDigit = completeKeypad(snap);
  if (!byDigit) {
    if (!snap.lockBounds) {
      return { ok: false, note: 'unlock_blocked:lock_bounds_missing（无法安全展示键盘，零输入）', attempted: false };
    }
    // 非秘密状态迁移：一次 reveal。**不读取凭据、不输入任何数字。**
    deps.reveal(serial, snap.lockBounds);

    // e5d8a2c4 T3#3：**有界 settle + 重取样**。此前 reveal 后**零等待**直接二帧取样，
    // 于是任何动画延迟都变成"永久零输入 → 无人值守停机等人"（2026-08-05 宿主实况）。
    // 纪律边界写死：既有「不盲重试」防的是**重复输入 PIN**（烧尝试次数、触发冷却）；
    // **重新观察屏幕不碰任何秘密**，二者不可混为一谈。本循环全程 attempted=false。
    //
    // 早先那版注释宣称"重取样本身就是间隔，无需显式等待"——那是把 hdc dump 的偶然
    // 耗时当成保证（取样一变快，间隔就归零），已作废：这里等的是**真的等**。
    for (let i = 0; ; i += 1) {
      snap = deps.snapshot(serial);
      if (snap.locked === undefined) {
        return { ok: false, note: 'unlock_blocked:post_reveal_state_unknown（零输入）', attempted: false };
      }
      if (!snap.locked) return { ok: true, note: '已解锁（reveal 后无需输入）' };
      const postRevealCooldown = cooldownBlocked(snap);
      if (postRevealCooldown) return postRevealCooldown;
      byDigit = completeKeypad(snap);
      if (byDigit) break;
      const kind = unlockFailureKindOf(snap);
      // 布局不认识 / 几何不对 / 树结构异常：再等也不会变——立即停止重取样。
      // 判据复用**唯一分类点**：此前这里把那三个 reason 字面量又列了一遍，正是
      // `unlockFailureKindOf` 的注释自己禁止的"两处各判一次"（改一处漏一处即分流失灵）。
      if (kind === 'layout_unsupported' || i >= MAX_RESAMPLES) {
        return { ok: false, note: unlockBlockedNote(snap), attempted: false, failureKind: kind };
      }
      deps.settle(SETTLE_INTERVAL_MS);
    }
  }
  // 抢占 + 点击一体：CredWrite 覆盖 + 读回验 nonce 即互斥，赢家才会真的点。
  // 写入 claim 这一步同时充当"输入第一个数字前的 durable commit"——它就在 OS 凭据库里，
  // 且崩溃残留会让该版本永久停在 in_flight（等价 disabled），不可靠删文件复位。
  const nonce = newClaimNonce();
  const typed = provider.claimAndUnlock(id, [...byDigit.values()], serial, nonce);

  switch (typed.outcome) {
    case 'clicked':
      break;
    case 'blocked_in_flight':
      // 另一进程正在临界区，或上次崩在临界区——两者都不得再输入，且**不能烧毁**
      //（那会烧掉别人正在用的凭据）
      return { ok: false, note: '凭据正被另一进程使用或上次崩在临界区——零输入', attempted: false };
    case 'blocked_mutex':
      // 另一进程正在读改写临界区——有界等待已耗尽，零输入退出（不得烧毁）
      return { ok: false, note: '未能取得解锁互斥（另一进程正在处理同一凭据）——零输入', attempted: false };
    case 'blocked_race':
      // 兜底：取得互斥后回读仍非自己的 claim。正常不该发生，同样零输入且不烧毁
      return { ok: false, note: '并发抢占竞争失败——本次零输入', attempted: false };
    case 'absent':
      // 未登记/已烧毁：下一步就是重新登记——与 credential_unavailable 同一处置。
      // 兜底类曾把它错归成"前置条件"，等于把一条可行动的路藏起来（codex 三轮）。
      return { ok: false, note: '凭据不存在（未登记或已被烧毁）——零输入', attempted: false, failureKind: 'credential_unavailable' };
    case 'unsupported':
      // 同上：登记的东西本版用不了 → 仍是"重新登记"这条路。
      return { ok: false, note: '登记的凭据不是数字 PIN——本版仅支持数字 PIN', attempted: false, failureKind: 'credential_unavailable' };
    default: {
      // 执行出错：可能已点出若干位（异常也可能发生在点击循环中途），且 claim 可能已写入。
      // 一律按失败烧毁——保守方向，用户重新登记即可，且墓碑能说明原因。
      const burn = provider.burnCredential(id, `解锁执行失败：${typed.error ?? 'unknown'}`);
      return {
        ok: false,
        note: burn.ok ? '解锁执行失败——已烧毁该凭据版本' : '解锁执行失败，且凭据烧毁未成功——须人工清理',
        attempted: true, failureKind: 'credential_unavailable',
      };
    }
  }

  // **重新取样**判定，不凭命令退出码宣称成功
  const after = deps.snapshot(serial).locked;
  if (after === false) {
    const committed = provider.commitUnlock(id, nonce);
    if (!committed.ok) {
      // 已解锁但状态没能回写：设备可用，但凭据停在 in_flight（下次零输入）。
      // 不谎报失败——解锁这件事确实成了。
      return { ok: true, note: '已解锁，但凭据状态未能回写为可用（下次将需重新登记）' };
    }
    return { ok: true, note: '已用登记凭据解锁并复验' };
  }
  // 复验仍锁（或判不出）→ 一律失败 → 烧毁该版本
  const burn = provider.burnCredential(
    id,
    after === undefined ? '解锁后无法复验锁屏状态' : '登记的凭据未能解锁设备',
  );
  return {
    ok: false,
    note: burn.ok
      ? after === undefined
        ? '解锁后无法复验——已保守烧毁凭据'
        : '凭据未能解锁——已烧毁该凭据版本'
      : '解锁失败，且凭据烧毁未成功——须人工清理',
    attempted: true, failureKind: 'credential_unavailable',
  };
}
