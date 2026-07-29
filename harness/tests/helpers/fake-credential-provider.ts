// ============================================================================
// fake-credential-provider.ts — **仅测试**用的内存版凭据库
// ----------------------------------------------------------------------------
// 刻意放在 tests/ 下而不是发布 runtime：生产 provider 不得存在任何"读回明文"的接口，
// 否则 agent 直接 import 就能拿到手机 PIN（review 三轮 P0）。本文件不被任何 scripts/
// 代码引用——`device-credential-store.unit.test.ts` 里有反回归断言盯着这条边界。
//
// 语义须与 Windows Credential Manager 逐条对齐，否则测试会绿在假语义上：
//   - blob 是 target → 字符串的映射，**覆盖写**（last-writer-wins）；
//   - 读不到即 null；删除后读不到；
//   - `claimAndUnlock` 内部严格按 读 → 判形态 → 覆盖写 claim → **读回校验 nonce**
//     的顺序，且在写与读回之间开放 `beforeReadback` 钩子——用来构造真实交错，
//     证明"两个赢家"不可能出现。
// ============================================================================

import {
  CLAIM_PATTERN,
  PIN_PATTERN,
  credentialTargetName,
  mutexNameFor,
  tombstoneTargetName,
  type CredentialIdentity,
  type CredentialProvider,
  type CredentialStateRead,
  type ClaimOutcome,
} from '../../scripts/utils/device-credential-store';

export interface FakeProviderOptions {
  /**
   * 点击回调，收到的是**实际被点击的坐标序列**（按凭据逐位展开，与真实现同构）。
   * 返回 false 表示点击执行失败（模拟 hdc 挂掉）。
   */
  onClick?(serial: string, taps: ReadonlyArray<{ x: number; y: number }>): boolean;
  /** 写入 claim 之后、读回校验之前触发——用于构造并发交错 */
  beforeReadback?(id: CredentialIdentity, nonce: string): void;
  /**
   * **进入互斥、读取 blob 之后**触发——用于构造 review 三轮指出的危险时序：
   * 双方都先读到裸 PIN。持锁期间闯入者必须被 mutex 挡在外面。
   */
  insideCriticalSection?(id: CredentialIdentity, nonce: string): void;
  /** 整个 provider 不可用（模拟非 Windows） */
  unavailable?: boolean;
  /** 让 inspect 报错（模拟凭据库读取失败）——放行判定必须因此收紧 */
  inspectError?: string;
}

export class FakeCredentialProvider implements CredentialProvider {
  /** target → blob。测试可直接读写以构造场景。 */
  readonly blobs = new Map<string, string>();
  /** 观测：点击过几次（"零输入"断言的硬证据） */
  clickCount = 0;
  /** 内存版 named mutex 持有集——与真实现的 OS mutex 语义等价 */
  private readonly mutexHeld = new Set<string>();

  constructor(private readonly opts: FakeProviderOptions = {}) {}

  /** 便捷：登记一条可用凭据 */
  seedReady(id: CredentialIdentity, pin: string): void {
    this.blobs.set(credentialTargetName(id), pin);
  }

  /** 便捷：制造一条遗留 claim（模拟上次崩在临界区） */
  seedClaim(id: CredentialIdentity, nonce: string, pin: string): void {
    this.blobs.set(credentialTargetName(id), `MAISON-CLAIM/${nonce}/${pin}`);
  }

  available(): boolean {
    return !this.opts.unavailable;
  }

  promptAndWrite(id: CredentialIdentity, _prompt: string): { ok: boolean; error?: string } {
    if (!this.available()) return { ok: false, error: 'unavailable' };
    // 真 provider 从 TTY 读；fake 用固定值——测试只关心"写成功"这一事实
    this.blobs.set(credentialTargetName(id), '123456');
    return { ok: true };
  }

  inspect(id: CredentialIdentity): CredentialStateRead {
    if (!this.available()) return { state: 'absent', error: 'unavailable' };
    if (this.opts.inspectError) return { state: 'absent', error: this.opts.inspectError };
    const blob = this.blobs.get(credentialTargetName(id));
    if (blob === undefined) {
      const tomb = this.blobs.get(tombstoneTargetName(id));
      return tomb === undefined ? { state: 'absent' } : { state: 'burned', reason: tomb };
    }
    const claim = CLAIM_PATTERN.exec(blob);
    if (claim) return { state: 'in_flight', nonce: claim[1] };
    if (PIN_PATTERN.test(blob)) return { state: 'ready' };
    return { state: 'unsupported' };
  }

  claimAndUnlock(
    id: CredentialIdentity,
    keys: ReadonlyArray<{ digit: string; x: number; y: number }>,
    serial: string,
    nonce: string,
  ): { outcome: ClaimOutcome; error?: string } {
    if (!this.available()) return { outcome: 'error', error: 'unavailable' };
    const target = credentialTargetName(id);

    // ---- 临界区（真实现用 OS named mutex；fake 用同名的内存持有集，语义等价）----
    // 这段必须原子：否则双方都读到裸 PIN，然后各写各的 claim，两个都成"赢家"。
    const mutexKey = mutexNameFor(target);
    if (this.mutexHeld.has(mutexKey)) return { outcome: 'blocked_mutex' };
    this.mutexHeld.add(mutexKey);
    let blob: string;
    try {
      const current = this.blobs.get(target);
      if (current === undefined) return { outcome: 'absent' };
      if (/^MAISON-CLAIM\//.test(current)) return { outcome: 'blocked_in_flight' };
      if (!PIN_PATTERN.test(current)) return { outcome: 'unsupported' };
      // 已读到裸 PIN、尚未写 claim —— review 三轮指出的危险窗口就在这里
      this.opts.insideCriticalSection?.(id, nonce);

      this.blobs.set(target, `MAISON-CLAIM/${nonce}/${current}`);
      this.opts.beforeReadback?.(id, nonce);
      const back = this.blobs.get(target);
      if (back === undefined || !back.startsWith(`MAISON-CLAIM/${nonce}/`)) {
        return { outcome: 'blocked_race' };
      }
      blob = current;
    } finally {
      this.mutexHeld.delete(mutexKey);
    }
    // ---- 临界区结束：claim 已落库，它本身就是持久排他标记，点击无需持锁 ----

    // 与真实现同构：在 helper 内按口令**逐位**查表点击；缺键即报错（不做任何兜底坐标）
    this.clickCount += 1;
    const byDigit = new Map(keys.map(k => [k.digit, k]));
    const taps: Array<{ x: number; y: number }> = [];
    for (const ch of blob.split('')) {
      const k = byDigit.get(ch);
      if (!k) return { outcome: 'error', error: 'keypad missing digit' };
      taps.push({ x: k.x, y: k.y });
    }
    const clicked = this.opts.onClick ? this.opts.onClick(serial, taps) : true;
    return clicked ? { outcome: 'clicked' } : { outcome: 'error', error: 'click failed' };
  }

  commitUnlock(id: CredentialIdentity, nonce: string): { ok: boolean; error?: string } {
    if (!this.available()) return { ok: false, error: 'unavailable' };
    const target = credentialTargetName(id);
    const blob = this.blobs.get(target);
    if (blob === undefined) return { ok: false, error: 'credential missing' };
    const m = CLAIM_PATTERN.exec(blob);
    if (!m || m[1] !== nonce) return { ok: false, error: 'claim 已不属于本次调用' };
    this.blobs.set(target, m[2]);
    return { ok: true };
  }

  burnCredential(id: CredentialIdentity, reason: string): { ok: boolean; error?: string } {
    if (!this.available()) return { ok: false, error: 'unavailable' };
    // 与真实现同序：先落墓碑再删凭据
    this.blobs.set(tombstoneTargetName(id), reason);
    this.blobs.delete(credentialTargetName(id));
    return { ok: true };
  }

  remove(id: CredentialIdentity): { ok: boolean; error?: string } {
    this.blobs.delete(credentialTargetName(id));
    this.blobs.delete(tombstoneTargetName(id));
    return { ok: true };
  }

  listVersions(serial: string): { ok: boolean; versions?: number[]; error?: string } {
    if (!this.available()) return { ok: false, error: 'unavailable' };
    const versions = new Set<number>();
    for (const target of this.blobs.keys()) {
      const m = new RegExp(`^MaisonDeviceUnlock:${serial}:v(\\d+)(?:#\\w+)?$`).exec(target);
      if (m) versions.add(Number(m[1]));
    }
    return { ok: true, versions: [...versions] };
  }

  reserveVersion(serial: string, version: number, nonce: string): { ok: boolean; won?: boolean; error?: string } {
    if (!this.available()) return { ok: false, error: 'unavailable' };
    // 版本分配按 **serial** 整体串行（按 version 取锁等于没锁——各锁各的号）
    const allocMutex = mutexNameFor(`alloc:${serial}`);
    if (this.mutexHeld.has(allocMutex)) {
      return { ok: false, error: '未能取得版本分配互斥（另一进程正在登记同一台设备）' };
    }
    this.mutexHeld.add(allocMutex);
    try {
      return this.reserveVersionLocked(serial, version, nonce);
    } finally {
      this.mutexHeld.delete(allocMutex);
    }
  }

  /** 临界区内的读改写——测试可用 insideAllocSection 在此闯入验证互斥 */
  private reserveVersionLocked(serial: string, version: number, nonce: string): { ok: boolean; won?: boolean; error?: string } {
    const id = { serial, version };
    if (this.blobs.has(credentialTargetName(id))) return { ok: true, won: false };
    if (this.blobs.has(tombstoneTargetName(id))) return { ok: true, won: false };
    const reserve = `MaisonDeviceUnlock:${serial}:v${version}#reserve`;
    const existing = this.blobs.get(reserve);
    if (existing !== undefined && existing !== nonce) return { ok: true, won: false };
    this.blobs.set(reserve, nonce);
    return { ok: true, won: this.blobs.get(reserve) === nonce };
  }
}
