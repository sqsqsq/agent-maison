// ============================================================================
// device-unlock-helper.unit.test.ts — 解锁执行器的安全约束
//                                     （openspec device-readiness-and-completion t6）
// 每条用例都对着 07-28 事故里 agent 自建解锁脚本的某一行。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  ensureUnlocked,
  type KeypadKey,
  type UnlockDeps,
} from '../../scripts/utils/device-unlock-helper';
import {
  credentialRefOf,
  credentialTargetName,
  type CredentialIdentity,
} from '../../scripts/utils/device-credential-store';
import { FakeCredentialProvider } from '../helpers/fake-credential-provider';
import type { UnitCaseResult } from '../run-unit';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const SERIAL = '3UJ0225321000395';
const ID: CredentialIdentity = { serial: SERIAL, version: 1 };
const REF = credentialRefOf(ID);
const CANARY_PIN = '907341';

const FULL_KEYPAD: KeypadKey[] = '0123456789'
  .split('')
  .map((d, i) => ({ digit: d, x: 100 + i * 10, y: 200 + i * 10 }));

/** 登记一条可用凭据的 fake provider；taps 记录 provider 内部的实际点击 */
function providerOf(
  secret = CANARY_PIN,
  taps?: Array<{ x: number; y: number }>,
): FakeCredentialProvider {
  const p = new FakeCredentialProvider({
    onClick: (_serial, seq) => {
      taps?.push(...seq);
      return true;
    },
  });
  p.blobs.set(credentialTargetName(ID), secret);
  return p;
}

interface Bench {
  deps: UnlockDeps;
  taps: Array<{ x: number; y: number }>;
  wakes: number;
}
function bench(
  over: {
    lockSeq?: Array<boolean | undefined>;
    keypad?: KeypadKey[];
    cooldown?: boolean;
    tap?: UnlockDeps['tap'];
  } = {},
): Bench {
  const taps: Array<{ x: number; y: number }> = [];
  let wakes = 0;
  const seq = over.lockSeq;
  let i = 0;
  const deps: UnlockDeps = {
    // P0-2：锁屏判定与键位来自**同一份快照**
    snapshot: () => {
      const locked = seq ? seq[Math.min(i++, seq.length - 1)] : true;
      return {
        locked,
        keypad: locked === true ? (over.keypad ?? FULL_KEYPAD) : [],
        lockoutCooldown: over.cooldown,
      };
    },
    wake: () => { wakes += 1; },
    tap: over.tap ?? ((_s, x, y) => { taps.push({ x, y }); }),
  };
  return { deps, taps, get wakes() { return wakes; } } as Bench;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '正常路径：解锁并**重新探测**复验 → 成功，凭据 commit 回 ready', () => {
    const taps: Array<{ x: number; y: number }> = [];
    const p = providerOf(CANARY_PIN, taps);
    const b = bench({ lockSeq: [true, false] }); // 输入前锁 / 输入后已解
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, true, `应解锁成功：${r.note}`);
    assertEq(taps.length, CANARY_PIN.length, '应逐位点击（点击发生在 provider 内，口令不出该进程）');
    assertEq(p.inspect(ID).state, 'ready', '成功后 commit 回 ready，可再次使用');
  });

  run(results, '**退出码不作数**：输入后仍锁 → 判失败并烧毁该凭据版本', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [true, true] }); // 输入后仍锁
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '仍锁必须判失败');
    assertEq(p.inspect(ID).state, 'burned', '失败即烧毁该凭据版本');

    // 再来一次：零输入。且**凭据已不存在**，不是靠某个可删的标志位挡住的
    const before = p.clickCount;
    const b2 = bench({ lockSeq: [true, false] });
    const r2 = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b2.deps, provider: p });
    assertEq(r2.ok, false, '烧毁后不得再试');
    assertEq(p.clickCount, before, '烧毁后必须零输入');
  });

  run(results, '键位不全 → **零输入**（对着事故里的固定分辨率坐标表）', () => {
    const p = providerOf();
    const partial = FULL_KEYPAD.slice(0, 7); // 只识别到 7 个键
    const b = bench({ keypad: partial, lockSeq: [true, false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '键位不全须失败');
    assertEq(p.clickCount, 0, '**零输入**——绝不用固定坐标兜底');
    assert(r.ok === false && !r.attempted, '未尝试输入');
    assertEq(p.inspect(ID).state, 'ready', '未输入则凭据保持可用，不得被误烧');
  });

  run(results, '锁定冷却期 → 零输入（再输只会加重系统惩罚）', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [true, false], cooldown: true });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '冷却期须拒绝');
    assertEq(p.clickCount, 0, '零输入');
    assertEq(p.inspect(ID).state, 'ready', '冷却期拒绝不得烧毁凭据');
  });

  run(results, '等待期间已被人工解锁 → 直接成功，不做任何输入', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, true, '已解锁应直接成功');
    assertEq(p.clickCount, 0, '无需输入');
  });

  run(results, 'A 机凭据绝不用于 B 机', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [true, false] });
    const r = ensureUnlocked({
      serial: 'OTHER-PHONE', credentialRef: REF, deps: b.deps, provider: p,
    });
    assertEq(r.ok, false, 'serial 不符须拒绝');
    assertEq(p.clickCount, 0, '零输入');
    assert(r.note.includes('serial'), r.note);
  });

  run(results, '非数字 PIN（手势/字母）→ 明确 unsupported，不猜输入方式', () => {
    const p = providerOf('L-shape-gesture');
    const b = bench({ lockSeq: [true, false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '非数字 PIN 须拒绝');
    assertEq(p.clickCount, 0, '零输入');
  });

  run(results, '锁屏状态判不出 → 不猜，零输入', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [undefined] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '判不出须失败');
    assertEq(p.clickCount, 0, '零输入');
  });

  run(results, '已烧毁的凭据 → 零输入（放行判定只读 OS 凭据库）', () => {
    const p = providerOf();
    p.burnCredential(ID, '先前失败');
    const b = bench({ lockSeq: [true, false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, 'burned 须拒绝');
    assertEq(p.clickCount, 0, '零输入');
    assert(/永久禁用|重新登记/.test(r.note), `须提示重新登记：${r.note}`);
  });

  run(results, '并发：另一进程持 claim 时零输入，且**不得烧掉对方的凭据**', () => {
    const p = providerOf();
    p.seedClaim(ID, 'aaaaaaaaaaaaaaaa', CANARY_PIN); // 别人在临界区
    const b = bench({ lockSeq: [true, false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, 'in_flight 须拒绝');
    assertEq(p.clickCount, 0, '零输入');
    assertEq(p.inspect(ID).state, 'in_flight', '不得烧掉别人正在用的凭据');
  });

  run(results, '抢占竞争输了 → 零点击退出，且不烧毁（赢家还在用）', () => {
    const taps: Array<{ x: number; y: number }> = [];
    const p = new FakeCredentialProvider({
      onClick: (_s, seq) => { taps.push(...seq); return true; },
      beforeReadback: id => {
        // 另一方在本方写 claim 后立刻覆盖
        p.blobs.set(credentialTargetName(id), 'MAISON-CLAIM/cccccccccccccccc/907341');
      },
    });
    p.seedReady(ID, CANARY_PIN);
    const b = bench({ lockSeq: [true, false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '抢输须失败');
    assertEq(taps.length, 0, '抢输的一方一次都不能点');
    assertEq(p.inspect(ID).state, 'in_flight', '赢家的 claim 须保留，不得被烧');
  });

  run(results, '点击执行出错（hdc 挂掉）→ 保守烧毁（可能已点出若干位）', () => {
    const p = new FakeCredentialProvider({ onClick: () => false });
    p.seedReady(ID, CANARY_PIN);
    const b = bench({ lockSeq: [true, false] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '执行出错须失败');
    assert(r.ok === false && r.attempted, '须标记为已尝试');
    assertEq(p.inspect(ID).state, 'burned', '执行出错保守烧毁——不赌"可能没输进去"');
  });

  run(results, '已解锁但 commit 失败 → 如实报成功（设备确实可用），不谎报失败', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [true, false] });
    // 点击后把 claim 换成别人的 → commit 校验不过
    const orig = p.commitUnlock.bind(p);
    p.commitUnlock = () => ({ ok: false, error: '模拟 commit 失败' });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    p.commitUnlock = orig;
    assertEq(r.ok, true, '解锁这件事确实成了，不得谎报失败');
    assert(/未能回写/.test(r.note), `须说明状态未回写：${r.note}`);
  });

  run(results, '**口令不泄露**：返回值/note 中不得出现 PIN；tap 只收坐标', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [true, true] }); // 走失败路径（note 最长）
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    const serialized = JSON.stringify(r);
    assert(!serialized.includes(CANARY_PIN), `返回值不得含 PIN：${serialized}`);
    for (const t of b.taps) {
      assert(typeof t.x === 'number' && typeof t.y === 'number', 'tap 参数只应是坐标');
    }
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-unlock-helper.ts'),
      'utf-8',
    );
    assert(
      !/export function (readCredential|getSecret|revealPin)/.test(src),
      'helper 永不提供读取/返回凭据的接口',
    );
  });

  run(results, '**禁枚举**：只用登记的那一个凭据，至多进入临界区一次', () => {
    const taps: Array<{ x: number; y: number }> = [];
    const p = new FakeCredentialProvider({
      onClick: (_s, seq) => { taps.push(...seq); return true; },
    });
    p.seedReady(ID, CANARY_PIN);
    const b = bench({ lockSeq: [true, true] }); // 失败路径——最容易诱发"再试一个"
    ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(p.clickCount, 1, '一次调用至多进一次临界区（无候选集、无重试）');
    assertEq(taps.length, CANARY_PIN.length, '只输入这一个 PIN 的位数');

    // 源码级：不得存在候选口令集合
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-unlock-helper.ts'),
      'utf-8',
    );
    const executable = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*)/.test(l))
      .join('\n');
    assert(
      !/\[\s*'\d{4,}'\s*,/.test(executable),
      'helper 源码不得内含任何候选口令数组（事故第 ② 行）',
    );
    assert(!/for .* of .*candidates|CANDIDATE_PINS/.test(executable), '不得存在候选口令遍历');
  });

  return results;
}
