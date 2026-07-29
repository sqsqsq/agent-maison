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
//   - 对 ②③：只用**用户登记的那一个**凭据（无候选集、无遍历），且任何一次失败即
//     烧毁该凭据版本——换口令重试这条路本身被堵死。
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
export interface LockScreenSnapshot {
  /** 该快照是否显示锁屏；判不出 → undefined（不猜） */
  locked: boolean | undefined;
  /** **锁屏子树内**的数字键位；非锁屏时应为空 */
  keypad: KeypadKey[];
  /** 系统是否处于失败惩罚冷却期（此时任何输入都会加重惩罚）；判不出 → undefined */
  lockoutCooldown?: boolean;
}

export interface UnlockDeps {
  /** 取**一份**锁屏 UI 快照：锁屏判定与键位同源，杜绝两次 dump 之间的界面漂移 */
  snapshot(serial: string): LockScreenSnapshot;
  /** 非秘密唤醒 */
  wake(serial: string): void;
  /** 点击坐标（argv 只出现数字坐标，**不出现 PIN 字符**） */
  tap(serial: string, x: number, y: number): void;
}

export type UnlockOutcome =
  | { ok: true; note: string }
  | { ok: false; note: string; attempted: boolean };

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
 *   读 CM 状态放行判定 → wake → **一次**取样 → 冷却检查 → 键位完整性 →
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
  if (!gate.ok) return { ok: false, note: gate.reason, attempted: false };

  // 先唤醒再取快照：息屏时 UI tree 不完整，先探测必然判不出（P1）
  deps.wake(serial);

  // **一次**取样：锁屏判定与键位同源（P0-2）
  const snap = deps.snapshot(serial);
  if (snap.locked === undefined) {
    return { ok: false, note: '无法判定锁屏状态', attempted: false };
  }
  // 可能在此期间已被人工解锁 → 无需输入直接成功
  if (!snap.locked) return { ok: true, note: '已解锁（无需输入）' };

  // 锁定冷却期内输入只会加重惩罚 → 零输入
  if (snap.lockoutCooldown === true) {
    return { ok: false, note: '设备处于锁定冷却期——零输入', attempted: false };
  }

  // 键位取自**同一份被判定为锁屏的快照**；不全即放弃（不得用固定分辨率坐标兜底）
  const byDigit = new Map(snap.keypad.map(k => [k.digit, k]));
  const complete = '0123456789'.split('').every(d => byDigit.has(d));
  if (!complete) {
    return {
      ok: false,
      note: `未能从锁屏 UI 完整识别 0–9 键位（识别到 ${byDigit.size} 个）——零输入`,
      attempted: false,
    };
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
      return { ok: false, note: '凭据不存在（未登记或已被烧毁）——零输入', attempted: false };
    case 'unsupported':
      return { ok: false, note: '登记的凭据不是数字 PIN——本版仅支持数字 PIN', attempted: false };
    default: {
      // 执行出错：可能已点出若干位（异常也可能发生在点击循环中途），且 claim 可能已写入。
      // 一律按失败烧毁——保守方向，用户重新登记即可，且墓碑能说明原因。
      const burn = provider.burnCredential(id, `解锁执行失败：${typed.error ?? 'unknown'}`);
      return {
        ok: false,
        note: burn.ok ? '解锁执行失败——已烧毁该凭据版本' : '解锁执行失败，且凭据烧毁未成功——须人工清理',
        attempted: true,
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
    attempted: true,
  };
}
