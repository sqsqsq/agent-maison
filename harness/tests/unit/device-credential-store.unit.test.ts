// ============================================================================
// device-credential-store.unit.test.ts — 凭据身份不可变 / 状态即凭据本身 / 互斥
//                                        （openspec device-readiness-and-completion t6）
// ----------------------------------------------------------------------------
// 三轮 review 的 P0 全部落成这里的可执行断言：
//   - 没有任何旁路状态文件可删（"删文件复位锁存"整类攻击消失）；
//   - claim 抢占不存在 ABA（用 beforeReadback 钩子构造真实交错）；
//   - 发布 runtime 不含任何能读回口令的接口。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  allocateCredentialVersion,
  canAttemptUnlock,
  credentialRefOf,
  credentialTargetName,
  isValidSerial,
  mutexNameFor,
  newClaimNonce,
  parseCredentialRef,
  tombstoneTargetName,
  windowsCredentialProvider,
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

const STORE_SRC = path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-credential-store.ts');
const HELPER_SRC = path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-unlock-helper.ts');

/** 去注释——源码级断言绝不能命中它自己的说明文字（前几轮实测踩过三次） */
function executableCode(file: string): string {
  return fs
    .readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|#)/.test(l))
    .join('\n');
}

const V1: CredentialIdentity = { serial: '3UJ0225321000395', version: 1 };
const V2: CredentialIdentity = { serial: '3UJ0225321000395', version: 2 };

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '凭据身份：ref 往返；target 名**含 version**（否则轮换会原地覆盖）', () => {
    assertEq(credentialRefOf(V1), 'maison/device/3UJ0225321000395/v1', 'ref 形态');
    const back = parseCredentialRef(credentialRefOf(V2));
    assertEq(back?.serial, V2.serial, 'serial 往返');
    assertEq(back?.version, V2.version, 'version 往返');
    assert(
      credentialTargetName(V1) !== credentialTargetName(V2),
      'v1 与 v2 的 target 必须不同——否则轮换原地覆盖，旧 ref 会读到新口令',
    );
    assertEq(parseCredentialRef('maison/device/a b/v1'), null, 'serial 非法字符须拒绝');
    assertEq(parseCredentialRef('maison/device/x/v0'), null, 'version 必须为正整数');
  });

  run(results, '状态**就是那条凭据的形态**：五态映射（无旁路状态文件）', () => {
    const p = new FakeCredentialProvider();
    assertEq(p.inspect(V1).state, 'absent', '未登记 → absent');
    p.seedReady(V1, '123456');
    assertEq(p.inspect(V1).state, 'ready', '裸 PIN → ready');
    p.seedClaim(V1, 'abcdef0123456789', '123456');
    assertEq(p.inspect(V1).state, 'in_flight', 'claim → in_flight');
    p.blobs.set(credentialTargetName(V1), 'swipe-pattern');
    assertEq(p.inspect(V1).state, 'unsupported', '非数字口令 → unsupported');
    p.burnCredential(V1, '测试烧毁');
    assertEq(p.inspect(V1).state, 'burned', '烧毁 → burned（墓碑带原因）');
    assertEq(p.inspect(V1).reason, '测试烧毁', '墓碑须保留原因');
  });

  run(results, '放行判定只认 ready；其余四态一律零输入', () => {
    const p = new FakeCredentialProvider();
    assertEq(canAttemptUnlock(V1, p).ok, false, 'absent 不放行');
    p.seedReady(V1, '123456');
    assertEq(canAttemptUnlock(V1, p).ok, true, 'ready 放行');
    p.seedClaim(V1, 'abcdef0123456789', '123456');
    assertEq(canAttemptUnlock(V1, p).ok, false, 'in_flight 不放行');
    p.blobs.set(credentialTargetName(V1), 'abc');
    assertEq(canAttemptUnlock(V1, p).ok, false, 'unsupported 不放行');
    p.burnCredential(V1, 'x');
    assertEq(canAttemptUnlock(V1, p).ok, false, 'burned 不放行');
  });

  run(results, '**P0 回归：任何删除组合都不能让状态复位为可试**（此前删 json 即可再试）', () => {
    // 这是三轮 review 的核心攻击面：把所有可删对象逐一/组合删掉，
    // 断言没有任何一种删法能把 canAttemptUnlock 从 false 变回 true。
    const p = new FakeCredentialProvider();
    p.seedReady(V1, '123456');
    p.burnCredential(V1, '口令错误');
    assertEq(canAttemptUnlock(V1, p).ok, false, '烧毁后不可试');

    const deletable = [credentialTargetName(V1), tombstoneTargetName(V1)];
    for (let mask = 1; mask < 1 << deletable.length; mask++) {
      const snapshot = new Map(p.blobs);
      for (let i = 0; i < deletable.length; i++) {
        if (mask & (1 << i)) p.blobs.delete(deletable[i]);
      }
      assertEq(
        canAttemptUnlock(V1, p).ok,
        false,
        `删除组合 mask=${mask} 后仍不得放行（fail-safe 方向：删凭据 = 不能试）`,
      );
      p.blobs.clear();
      for (const [k, v] of snapshot) p.blobs.set(k, v);
    }
  });

  run(results, '**P0 回归：双方都先读到裸 PIN 的危险时序**——互斥必须挡住闯入者', () => {
    // 这是三轮 review 指出的、上一版实现真正会翻车的时序（此前的用例只构造了
    // "B 在 A 写完 claim 后才 read"，那当然会 blocked，等于没测）：
    //   ① A 读到裸 PIN；② B 也读到裸 PIN；③ A 写 claim-A 回读 → 点击；
    //   ④ B 写 claim-B 回读 → **也**点击。
    // CredWrite 是 last-writer-wins，回读只证明"此刻是我"，拦不住后来者；
    // 所以读改写必须由 OS named mutex 保护。
    const nonceA = 'aaaaaaaaaaaaaaaa';
    const nonceB = 'bbbbbbbbbbbbbbbb';
    let bOutcome = '';
    const p = new FakeCredentialProvider({
      // A 已读到裸 PIN、尚未写 claim —— 危险窗口正在此刻
      insideCriticalSection: (id, nonce) => {
        if (nonce !== nonceA) return;
        bOutcome = p.claimAndUnlock(id, keypad(), id.serial, nonceB).outcome;
      },
    });
    p.seedReady(V1, '123456');
    const a = p.claimAndUnlock(V1, keypad(), V1.serial, nonceA);

    assertEq(bOutcome, 'blocked_mutex', 'B 必须被互斥挡在临界区外——而不是也读到裸 PIN');
    assertEq(a.outcome, 'clicked', 'A 是唯一赢家');
    assertEq(p.clickCount, 1, '**只能有一次点击**——两个赢家即互斥失效');
  });

  run(results, 'P0 回归：claim 已落库后闯入者读到 in_flight（持久排他，无需持锁）', () => {
    const nonceA = 'aaaaaaaaaaaaaaaa';
    const nonceB = 'bbbbbbbbbbbbbbbb';
    let bOutcome = '';
    const p = new FakeCredentialProvider({
      // A 已写完 claim、还没读回 —— 此时闯入者看到的是 claim
      beforeReadback: (id, nonce) => {
        if (nonce !== nonceA) return;
        bOutcome = p.claimAndUnlock(id, keypad(), id.serial, nonceB).outcome;
      },
    });
    p.seedReady(V1, '123456');
    const a = p.claimAndUnlock(V1, keypad(), V1.serial, nonceA);
    // 注意：这里 B 仍在 A 的 mutex 内闯入，故先被 mutex 挡住——
    // 这正说明临界区的两道防线是叠加的，不是二选一
    assertEq(bOutcome, 'blocked_mutex', '临界区内闯入先被互斥挡住');
    assertEq(a.outcome, 'clicked', 'A 正常完成');
    assertEq(p.clickCount, 1, '只有一次点击');

    // 临界区**之外**的闯入：claim 已落库，靠 claim 本身排他
    const later = p.claimAndUnlock(V1, keypad(), V1.serial, nonceB);
    assertEq(later.outcome, 'blocked_in_flight', 'claim 是持久排他标记，出了 mutex 依然挡得住');
    assertEq(p.clickCount, 1, '仍然只有一次点击');
  });

  run(results, 'P0 回归：版本分配的读改写同样受互斥保护（按 serial 串行）', () => {
    const p = new FakeCredentialProvider();
    // 直接验证互斥语义：持锁期间同 serial 的分配必须被拒
    const held = (p as unknown as { mutexHeld: Set<string> }).mutexHeld;
    const allocKey = mutexNameFor('alloc:SHARED-DEVICE');
    held.add(allocKey);
    const blocked = p.reserveVersion('SHARED-DEVICE', 1, newClaimNonce());
    assertEq(blocked.ok, false, '持锁期间同 serial 的版本抢占必须被拒');
    assert(/互斥/.test(blocked.error ?? ''), `原因须点明互斥：${blocked.error}`);
    // 别的 serial 不受影响（锁按 serial 分，不是全局一把）
    const other = p.reserveVersion('OTHER-DEVICE', 1, newClaimNonce());
    assertEq(other.ok, true, '不同设备的登记不得互相阻塞');
    held.delete(allocKey);
    assertEq(p.reserveVersion('SHARED-DEVICE', 1, newClaimNonce()).ok, true, '释放后可正常抢占');
  });

  run(results, 'P0 回归：源码级——读改写必须在 OS mutex 内，不得只靠 CredWrite 覆盖', () => {
    const code = executableCode(STORE_SRC);
    assert(/System\.Threading\.Mutex/.test(code), '须使用 OS named mutex（跨进程原子原语）');
    assert(/AbandonedMutexException/.test(code), '须处理持有者崩溃（接管而非死锁）');
    // 两处读改写都要被保护：解锁抢占 + 版本分配
    const guarded = code.match(/Enter-MaisonMutex \$env:MAISON_CRED_MUTEX/g) ?? [];
    assert(guarded.length >= 2, `解锁与版本分配都须取锁（实得 ${guarded.length} 处）`);
    // 取锁必须有界，且拿不到时零输入
    assert(/MUTEXTIMEOUT/.test(code), '取锁须有界，超时须有明确出口');
    assert(/Exit-MaisonMutex \$mutex/.test(code), '须在 finally 中释放');
    // 点击**不得**在临界区内（否则锁会被持有整个输入过程，崩溃即长期锁死）
    const claimScript = /\$mutex = Enter-MaisonMutex[\s\S]*?Exit-MaisonMutex \$mutex\n\}/.exec(code);
    assert(claimScript !== null, '应能定位解锁临界区');
    assert(!/uiInput click/.test(claimScript![0]), '点击必须在临界区之外——claim 已足够排他');
  });

  run(results, 'claim 被他人覆盖时，本方读回校验失败 → blocked_race（不点击）', () => {
    const nonceA = 'aaaaaaaaaaaaaaaa';
    const p = new FakeCredentialProvider({
      beforeReadback: (id, nonce) => {
        if (nonce !== nonceA) return;
        // 模拟另一方直接覆盖了 target（last-writer-wins）
        p.blobs.set(credentialTargetName(id), 'MAISON-CLAIM/cccccccccccccccc/123456');
      },
    });
    p.seedReady(V1, '123456');
    const a = p.claimAndUnlock(V1, keypad(), V1.serial, nonceA);
    assertEq(a.outcome, 'blocked_race', '读回不是自己的 nonce → 退出');
    assertEq(p.clickCount, 0, '抢输的一方**一次都不能点**');
  });

  run(results, 'commit 只认自己的 nonce；别人的 claim 不得被推回 ready', () => {
    const p = new FakeCredentialProvider();
    p.seedClaim(V1, 'aaaaaaaaaaaaaaaa', '123456');
    assertEq(p.commitUnlock(V1, 'bbbbbbbbbbbbbbbb').ok, false, '非本方 nonce 不得 commit');
    assertEq(p.inspect(V1).state, 'in_flight', '失败的 commit 不得改变状态');
    assertEq(p.commitUnlock(V1, 'aaaaaaaaaaaaaaaa').ok, true, '本方 nonce 可 commit');
    assertEq(p.inspect(V1).state, 'ready', 'commit 后回 ready');
  });

  run(results, '遗留 claim（上次崩在临界区）→ 永久 in_flight → 零输入', () => {
    const p = new FakeCredentialProvider();
    p.seedClaim(V1, 'deadbeefdeadbeef', '123456');
    assertEq(canAttemptUnlock(V1, p).ok, false, '遗留 claim 不得放行');
    assertEq(
      p.claimAndUnlock(V1, keypad(), V1.serial, newClaimNonce()).outcome,
      'blocked_in_flight',
      '遗留 claim 下不得进入临界区',
    );
    assertEq(p.clickCount, 0, '零输入');
  });

  run(results, '凭据库读取失败 → 一律零输入（provider 错误绝不 fail-open）', () => {
    const p = new FakeCredentialProvider({ inspectError: '凭据库无响应' });
    const r = canAttemptUnlock(V1, p);
    assertEq(r.ok, false, '读不出状态时不得放行');
    assert(/不可读|不存在/.test(r.reason), `原因须说明不可读：${r.reason}`);
  });

  run(results, 'R4：版本机器级唯一——递增分配，且**已烧毁的版本号不得复用**', () => {
    const p = new FakeCredentialProvider();
    const a = allocateCredentialVersion('SHARED-DEVICE', p);
    assert(a.ok, '首次分配应成功');
    const b = allocateCredentialVersion('SHARED-DEVICE', p);
    assert(b.ok, '二次分配应成功');
    assert(a.ok && b.ok && a.version !== b.version, `两次分配不得撞号（${JSON.stringify([a, b])}）`);

    // 烧毁 v1 后再分配，绝不能回收 v1——否则旧 ref 会指向新口令
    p.seedReady({ serial: 'SHARED-DEVICE', version: 1 }, '123456');
    p.burnCredential({ serial: 'SHARED-DEVICE', version: 1 }, '失败');
    const c = allocateCredentialVersion('SHARED-DEVICE', p);
    assert(c.ok && c.version !== 1, `烧毁过的 v1 不得被复用（拿到 ${JSON.stringify(c)}）`);
  });

  run(results, 'R15：serial 字符集收敛；target **不拼进** PowerShell 源码', () => {
    assert(isValidSerial('3UJ0225321000395'), '正常 serial 应通过');
    assert(isValidSerial('127.0.0.1:5555'), '模拟器 loopback serial 应通过');
    assert(!isValidSerial('a b'), '空格须拒绝');
    assert(!isValidSerial("a';calc;'"), '注入形态须拒绝');
    const code = executableCode(STORE_SRC);
    // 真判据：**PowerShell 脚本块内不得有任何插值**。String.raw 不阻止 `${}` 求值，
    // 所以只要脚本里出现插值，外部输入就有机会进脚本源码。
    // （前一版断言写成"源码里不得出现 ${credentialTargetName"，会误伤 JS 侧正常的
    //   模板字符串——tombstoneTargetName 就是这么被冤枉的。）
    const rawBlocks = code.match(/String\.raw`[\s\S]*?`/g) ?? [];
    assert(rawBlocks.length > 0, '应能取到 PowerShell 脚本块');
    for (const block of rawBlocks) {
      assert(
        !/\$\{/.test(block),
        `PowerShell 脚本块内不得插值（外部输入须经环境变量传递）：${block.slice(0, 120)}`,
      );
    }
    assert(/MAISON_CRED_TARGET/.test(code), 'target 须经 env 传递');
  });

  run(results, '**P0 回归：发布 runtime 不含任何读回口令的接口**', () => {
    const store = executableCode(STORE_SRC);
    const helper = executableCode(HELPER_SRC);
    // 接口层：没有任何方法返回 secret
    assert(!/secret\??:\s*string/.test(store), 'CredentialProvider 不得有返回 secret 的签名');
    assert(!/\bread\s*\(id/.test(store), '不得存在 read(id) 形式的口令读取接口');
    // 脚本层：没有把 blob 直接写到 stdout 的路径
    assert(
      !/\[Console\]::Out\.Write\(\$s\)|Write-Output \$s\b|Write-Output \$pin/.test(store),
      'PowerShell 片段不得把口令写回 stdout',
    );
    // helper 层：口令从不进入 Node 变量
    assert(!/unlockWithStoredPin|provider\.read\(/.test(helper), 'helper 不得有读回口令的调用');
    // fake provider 是 dev-only：scripts/ 下不得引用
    const scriptsDir = path.join(__dirname, '..', '..', 'scripts');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.ts') && /fake-credential-provider/.test(fs.readFileSync(full, 'utf-8'))) {
          offenders.push(full);
        }
      }
    };
    walk(scriptsDir);
    assertEq(offenders.length, 0, `发布代码不得引用测试用 fake provider：${offenders.join(', ')}`);
  });

  run(results, '**P2 回归：同步阻塞原语已整删**（Atomics.wait / 自旋忙等）', () => {
    const store = executableCode(STORE_SRC);
    const helper = executableCode(HELPER_SRC);
    assert(!/Atomics\.wait/.test(store), 'store 不得再用 Atomics.wait 阻塞事件循环');
    assert(!/Atomics\.wait/.test(helper), 'helper 不得再用 Atomics.wait');
    assert(!/while\s*\(\s*Date\.now\(\)/.test(store + helper), '不得用忙等自旋');
  });

  run(results, 'provider：口令**不进 argv**（走 TTY）；非 Windows 显式 unsupported', () => {
    const code = executableCode(STORE_SRC);
    assert(/Read-Host -AsSecureString/.test(code), '登记须走 SecureString');
    assert(
      /stdio:\s*\['inherit',\s*'pipe',\s*'inherit'\]/.test(code),
      'stdin 须继承真实 TTY——用 pipe 就等于口令过管道',
    );
    if (process.platform !== 'win32') {
      const p = windowsCredentialProvider();
      assertEq(p.available(), false, '非 Windows 须 unavailable');
      assertEq(p.inspect(V1).state, 'absent', '非 Windows inspect 须保守');
      assertEq(canAttemptUnlock(V1, p).ok, false, '非 Windows 不得放行');
    }
  });

  return results;
}

function keypad(): Array<{ digit: string; x: number; y: number }> {
  return '0123456789'.split('').map((d, i) => ({ digit: d, x: 100 + i * 10, y: 200 }));
}
