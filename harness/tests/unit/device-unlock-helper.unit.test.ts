// ============================================================================
// device-unlock-helper.unit.test.ts — 解锁执行器的安全约束
//                                     （openspec device-readiness-and-completion t6）
// 每条用例都对着 07-28 事故里 agent 自建解锁脚本的某一行。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  ensureUnlocked,
  MAX_RESAMPLES,
  SETTLE_INTERVAL_MS,
  type KeypadKey,
  type LockScreenSnapshot,
  type RevealOutcome,
  type UnlockDeps,
  type UnlockOutcome,
} from '../../scripts/utils/device-unlock-helper';
import { boundedSyncWait, MAX_SYNC_WAIT_MS } from '../../scripts/utils/bounded-sync-wait';
import {
  credentialRefOf,
  credentialTargetName,
  type CredentialIdentity,
  type CredentialProvider,
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
  reveals: number;
  /** a4e7c2f9 t5：reveal 失败后必须「零 settle / snapshot 不再增加」，故需计数 */
  settles: number;
  snapshots: number;
}
function bench(
  over: {
    lockSeq?: Array<boolean | undefined>;
    keypad?: KeypadKey[];
    cooldown?: 'cooldown' | 'not_cooldown' | 'ambiguous';
    /** a4e7c2f9 t3：注入 reveal 执行事实（缺省成功）——用于钉 reveal_failed 行为 */
    revealOutcome?: RevealOutcome;
    tap?: UnlockDeps['tap'];
  } = {},
): Bench {
  const taps: Array<{ x: number; y: number }> = [];
  let wakes = 0;
  let reveals = 0;
  let settles = 0;
  let snapshots = 0;
  const seq = over.lockSeq;
  let i = 0;
  const deps: UnlockDeps = {
    // P0-2：锁屏判定与键位来自**同一份快照**
    snapshot: () => {
      snapshots += 1;
      const locked = seq ? seq[Math.min(i++, seq.length - 1)] : true;
      return {
        locked,
        keypad: locked === true ? (over.keypad ?? FULL_KEYPAD) : [],
        cooldown: { state: over.cooldown ?? 'not_cooldown', ruleId: 'test_rule' },
        lockBounds: { left: 0, top: 0, right: 1000, bottom: 2000 },
      };
    },
    wake: () => { wakes += 1; },
    reveal: () => { reveals += 1; return over.revealOutcome ?? { ok: true, timedOut: false }; },
    tap: over.tap ?? ((_s, x, y) => { taps.push({ x, y }); }),
    settle: () => { settles += 1; },   // 本 bench 只数次数；时序见 benchFrames 与 T3#3 用例
  };
  return {
    deps, taps,
    get wakes() { return wakes; },
    get reveals() { return reveals; },
    get settles() { return settles; },
    get snapshots() { return snapshots; },
  } as Bench;
}

/**
 * e5d8a2c4 T3：键盘按帧演进的测试床——首若干帧键位不全，第 N 帧齐。
 * 用于钉住「reveal 后有界 settle + 重取样」这条行为（此前 reveal 后零等待，
 * 任何动画延迟都变成永久零输入 → 无人值守停机，2026-08-05 宿主实况）。
 */
function benchFrames(
  frames: Array<{
    keypad: KeypadKey[];
    diag?: LockScreenSnapshot['keypadDiag'];
    /** 逐帧 cooldown（缺省 not_cooldown）——用于钉「重采样期间 cooldown 每帧优先」 */
    cooldown?: LockScreenSnapshot['cooldown'];
  }>,
  /** a4e7c2f9 t3：reveal 执行事实（缺省成功）——失败时 helper 必须立即零输入退出 */
  revealOutcome: RevealOutcome = { ok: true, timedOut: false },
): {
  deps: UnlockDeps; settles: number; settleArgs: number[]; snapshots: number; reveals: number;
} {
  let snapshots = 0;
  let reveals = 0;
  const settleArgs: number[] = [];
  const deps: UnlockDeps = {
    snapshot: () => {
      const f = frames[Math.min(snapshots++, frames.length - 1)];
      return {
        locked: true,
        keypad: f.keypad,
        ...(f.diag ? { keypadDiag: f.diag } : {}),
        cooldown: f.cooldown ?? { state: 'not_cooldown', ruleId: 'test_rule' },
        lockBounds: { left: 0, top: 0, right: 1000, bottom: 2000 },
      };
    },
    wake: () => { /* no-op */ },
    reveal: () => { reveals += 1; return revealOutcome; },
    tap: () => { /* no-op */ },
    // 记录**被请求的间隔**——只数次数看不出"到底等够了没有"
    settle: ms => { settleArgs.push(ms); },
  };
  return {
    deps,
    get settles() { return settleArgs.length; },
    get settleArgs() { return settleArgs; },
    get snapshots() { return snapshots; },
    get reveals() { return reveals; },
  } as { deps: UnlockDeps; settles: number; settleArgs: number[]; snapshots: number; reveals: number };
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'T3#3 reveal 后首帧键盘未稳、settle 重取样后齐 → 继续解锁（此前直接零输入退出）', () => {
    const partial = FULL_KEYPAD.slice(0, 7);
    const b = benchFrames([
      { keypad: partial, diag: { reason: 'digits_incomplete', found: 7, containerFound: true, hiddenSkipped: false } },
      { keypad: partial, diag: { reason: 'digits_incomplete', found: 7, containerFound: true, hiddenSkipped: false } },
      { keypad: FULL_KEYPAD },
    ]);
    const p = providerOf();
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assert(b.settles >= 1, `须真的 settle 过（实得 ${b.settles} 次）`);
    // 键盘齐了就会去输入——这里只关心"没有在首帧就零输入退出"
    assert(!/keypad_incomplete|ui_not_settled/.test(r.note), `不应停在键盘未稳：${r.note}`);
  });

  run(results, 'T3#3 间隔是**固定常量**且真的传给 settle（不是碰巧靠 dump 耗时）', () => {
    const partial = FULL_KEYPAD.slice(0, 7);
    const diag = { reason: 'digits_incomplete', found: 7, containerFound: true, hiddenSkipped: false };
    // 首帧在 reveal 之前就被消费；重取样从第二帧开始，故未稳一帧产生一次等待
    const b = benchFrames([{ keypad: partial, diag }, { keypad: partial, diag }, { keypad: FULL_KEYPAD }]);
    ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: providerOf() });
    assertEq(b.settleArgs.length, 1, '未稳一帧 → 应等一次');
    assertEq(
      b.settleArgs[0],
      SETTLE_INTERVAL_MS,
      '必须等**完整**间隔（旧注释宣称"重取样本身就是间隔"，那是把 hdc dump 的偶然' +
      '耗时当成保证；取样一变快，间隔就归零）',
    );
  });

  run(results, 'T3#3 同步等待**真的会耗时**（生产注入的就是这个原语，不是计数桩）', () => {
    // 前面几条用假时钟验证"请求了多少补足"，这条验证"请求真的变成了等待"——
    // 少了它，settle 可以是个永远立即返回的空壳而全绿（正是此前生产侧的实况）。
    const t0 = Date.now();
    boundedSyncWait(30);
    const elapsed = Date.now() - t0;
    assert(elapsed >= 20, `boundedSyncWait(30) 应真的阻塞约 30ms，实测 ${elapsed}ms`);
    assert(elapsed < 1_000, `不得远超请求值（实测 ${elapsed}ms）`);
  });

  run(results, 'T3#3 单次等待超硬上限 → **抛**而不是静默截断', () => {
    let threw = false;
    try {
      boundedSyncWait(MAX_SYNC_WAIT_MS + 1);
    } catch (err) {
      threw = true;
      assert(/超过硬上限/.test((err as Error).message), `错误须说明原因：${(err as Error).message}`);
    }
    assert(threw, 'clamp 会让调用方以为自己拿到了请求的间隔——宁可当场炸');
    // 负数/0 是正常输入（差额为负），不得抛
    boundedSyncWait(0);
    boundedSyncWait(-5);
    // 非有限值（codex 四批 P3）：`Infinity` 是所有输入里最该炸的那个，此前却和
    // "负数/0" 一起走了最安静的分支——与"越界必须抛、绝不静默"的契约相矛盾。
    for (const bad of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      let nonFiniteThrew = false;
      try { boundedSyncWait(bad); } catch { nonFiniteThrew = true; }
      assert(nonFiniteThrew, `boundedSyncWait(${String(bad)}) 必须抛，不得静默返回`);
    }
  });

  run(results, 'T3#3 两条生产接线**共用同一处** unlock deps（此前各拼一份，恢复那条漏了 settle）', () => {
    // 事故形态：门这边讨论过 settle，运行期恢复那边连字段都没写；settle 当时是可选，
    // 于是缺的那份静默零等待——而单测注入了计数桩，全绿。类型层面已把 settle 改必填，
    // 但"两处各拼一份"这个**形态**本身才是病根，故在此结构性钉死。
    const files: Array<{ path: string; label: string }> = [
      { path: path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-readiness-deps.ts'), label: '就绪门' },
      {
        path: path.join(
          __dirname, '..', '..', '..', 'profiles', 'hmos-app', 'harness', 'device-recovery-bridge.ts',
        ),
        label: '运行期恢复桥',
      },
    ];
    for (const f of files) {
      const code = fs.readFileSync(f.path, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      assert(
        /buildUnlockDeps\(\)/.test(code),
        `${f.label}（${path.basename(f.path)}）必须经 buildUnlockDeps()，不得再手拼一份 UnlockDeps`,
      );
      assert(
        !/settle:\s*\(\s*\)\s*=>\s*\{\s*\}/.test(code),
        `${f.label} 不得注入空 settle——那等于把"有界等待"重新变回零等待`,
      );
    }
    // 且这一处接线给出的 settle 必须是**真会阻塞**的原语，不是占位
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const deps = require('../../scripts/utils/device-readiness-deps') as
      typeof import('../../scripts/utils/device-readiness-deps');
    const t0 = Date.now();
    deps.buildUnlockDeps().settle(30);
    assert(Date.now() - t0 >= 20, 'buildUnlockDeps().settle 必须真的等待');
  });

  run(results, 'f4c8d2b7 t3 容器持续未找到 → 跑满有界窗口后归类 layout_unsupported（不再首帧早退）', () => {
    const absentFrame = { keypad: [] as KeypadKey[], diag: { reason: 'pin_container_not_found' as const, found: 0, containerFound: false, hiddenSkipped: false } };
    const b = benchFrames([absentFrame, absentFrame, absentFrame, absentFrame, absentFrame]);
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: providerOf() });
    assertEq(r.ok, false, '不应解锁');
    assert(r.ok === false && r.attempted === false, '零输入（绝不因诊断增强而输入）');
    assertEq(r.ok === false ? r.failureKind : undefined, 'layout_unsupported', '窗口耗尽后仍归 layout_unsupported');
    assert(r.note.includes('container=absent'), `须带结构化事实：${r.note}`);
    // 首帧早退已删（宿主实锤：reveal 动画中容器未挂载是过渡态）——须跑满整个观察窗口
    assertEq(b.settles, MAX_RESAMPLES, `容器缺失也须跑满有界窗口（实得 ${b.settles}/${MAX_RESAMPLES}）`);
  });

  run(results, 'f4c8d2b7 t3 容器晚挂载（前两帧缺席、后一帧齐）→ 恢复并继续走解锁输入（观察期零输入,不判永久布局不支持）', () => {
    const absentFrame = { keypad: [] as KeypadKey[], diag: { reason: 'pin_container_not_found' as const, found: 0, containerFound: false, hiddenSkipped: false } };
    const b = benchFrames([absentFrame, absentFrame, { keypad: FULL_KEYPAD }]);
    const p = providerOf();
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assert(!/layout_unsupported/.test(r.note), `过渡态容器缺席不得判永久布局不支持：${r.note}`);
    assert(b.settles >= 1 && b.settles <= MAX_RESAMPLES, `观察须有界（实得 ${b.settles}）`);
  });

  run(results, 'f4c8d2b7 t3 表驱动：geometry_insane / digit_invalid 同样跑满有界窗口后才归 layout_unsupported', () => {
    // 复检意见 3：t3 承诺「所有失败 kind 统一有界观察」，不只 pin_container_not_found。
    const table: Array<{ reason: 'geometry_insane' | 'digit_invalid'; found: number }> = [
      { reason: 'geometry_insane', found: 10 },
      { reason: 'digit_invalid', found: 7 },
    ];
    for (const { reason, found } of table) {
      const frame = { keypad: [] as KeypadKey[], diag: { reason, found, containerFound: true, hiddenSkipped: false } };
      const b = benchFrames([frame, frame, frame, frame, frame]);
      const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: providerOf() });
      assertEq(r.ok, false, `${reason}: 不应解锁`);
      assert(r.ok === false && r.attempted === false, `${reason}: 零输入`);
      assertEq(r.ok === false ? r.failureKind : undefined, 'layout_unsupported', `${reason}: 窗口耗尽后归 layout_unsupported`);
      assertEq(b.settles, MAX_RESAMPLES, `${reason}: 须跑满有界窗口（实得 ${b.settles}/${MAX_RESAMPLES}）`);
    }
  });

  // ── a4e7c2f9：reveal 执行真值。宿主 run 20260817T065727Z-1896c1 两次撞的形态是
  //    「reveal 被 5s 超时 SIGTERM 砍断 → 页面仍是时钟页 → 被误判 layout_unsupported」。
  //    真机实测同参数不限超时可跑完（5.2s）并正确识别十键——布局从来没问题。─────────

  run(results, 'a4e7c2f9 reveal 超时 → reveal_failed；零 settle / 零点击 / reveal 后不再取样', () => {
    const p = providerOf();
    const b = bench({
      keypad: [],   // 首帧无键盘 ⇒ 必然走 reveal
      revealOutcome: { ok: false, timedOut: true, signal: 'SIGTERM', status: null, errorCode: 'ETIMEDOUT' },
    });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, 'reveal 未完成即不得宣称解锁');
    assertEq(r.ok === false ? r.failureKind : undefined, 'reveal_failed', '须归 reveal_failed');
    // 执行事实必须**结构化**随结论上浮：只留 failureKind 的话，ETIMEDOUT 与 ENOENT
    // 在消费面无从区分，消费方就又得回去解析 note 文案（本模块明令禁止的做法）。
    assertEq(
      r.ok === false ? r.revealFact?.errorCode : undefined, 'ETIMEDOUT',
      'errorCode 须随解锁结论上浮，不得只落在 note 里',
    );
    assertEq(r.ok === false ? r.revealFact?.timedOut : undefined, true, 'timedOut 须随结论上浮');
    assert(r.note.includes('error_code=ETIMEDOUT'), `note 也应带 error_code：${r.note}`);
    assert(r.ok === false && r.attempted === false, '零输入');
    assertEq(p.clickCount, 0, '**零 PIN 点击**');
    assertEq(p.inspect(ID).state, 'ready', '零输入则凭据不得被烧');
    assertEq(b.reveals, 1, '同一 attempt 最多 reveal 一次——不得原地自动重滑');
    assertEq(b.settles, 0, 'reveal 失败后不得进入重采样窗口');
    assertEq(b.snapshots, 1, 'reveal 失败后不得再取样（只剩 reveal 前那一帧）');
    assert(r.note.includes('timed_out=true'), `须带结构化执行事实：${r.note}`);
  });

  run(results, 'a4e7c2f9 reveal 失败后即便快照恰为时钟页形态，也绝不产出 layout_unsupported', () => {
    // 这正是宿主看到的那张脸：container=absent digits=0/10。区别只在 reveal 有没有成功——
    // 有成功证据才允许谈布局，没有就只能谈命令执行（否则就是把人指向"须真机校准"这条死路）。
    const clockPage = {
      keypad: [] as KeypadKey[],
      diag: { reason: 'pin_container_not_found' as const, found: 0, containerFound: false, hiddenSkipped: false },
    };
    const b = benchFrames(
      [clockPage, clockPage, clockPage, clockPage, clockPage],
      { ok: false, timedOut: true, signal: 'SIGTERM', status: null },
    );
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: providerOf() });
    assertEq(r.ok === false ? r.failureKind : undefined, 'reveal_failed', '须 reveal_failed 而非 layout_unsupported');
    assert(!/layout_unsupported/.test(r.note), `note 不得出现 layout_unsupported：${r.note}`);
    assert(!/真机校准/.test(r.note), `note 不得出现"须真机校准"——那正是把人引向错误方向的话：${r.note}`);
    assertEq(b.settles, 0, 'reveal 失败后零 settle');
    assertEq(b.snapshots, 1, 'reveal 失败后不再取样');
  });

  run(results, 'a4e7c2f9 reveal 非超时执行失败（exec_failed）→ 同样 reveal_failed 且零输入', () => {
    const p = providerOf();
    const b = bench({
      keypad: [],
      revealOutcome: { ok: false, timedOut: false, signal: null, status: 127, errorCode: 'ENOENT' },
    });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok === false ? r.failureKind : undefined, 'reveal_failed', '非超时失败同样归 reveal_failed');
    assert(r.note.includes('exec_failed'), `须区分 timeout 与 exec_failed：${r.note}`);
    // ENOENT（hdc 缺失/设备掉线）必须可与 ETIMEDOUT 区分——这正是丢 errorCode 时
    // 退化最严重的一类：只剩 `exec_failed + signal=none status=none`，诊断归零。
    assertEq(
      r.ok === false ? r.revealFact?.errorCode : undefined, 'ENOENT',
      'ENOENT 须结构化上浮，不得与 ETIMEDOUT 混同',
    );
    assertEq(r.ok === false ? r.revealFact?.status : undefined, 127, 'status 须随结论上浮');
    assertEq(p.clickCount, 0, '零 PIN 点击');
    assertEq(b.settles, 0, '零 settle');
  });

  run(results, 'f4c8d2b7 t3 重采样中途出现 cooldown → 每帧优先判、立即零输入退出（不继续烧窗口）', () => {
    const absentFrame = { keypad: [] as KeypadKey[], diag: { reason: 'pin_container_not_found' as const, found: 0, containerFound: false, hiddenSkipped: false } };
    const cooldownFrame = { ...absentFrame, cooldown: { state: 'cooldown' as const, ruleId: 'auth_cooldown_explicit' } };
    // 帧序：初始快照（无 cooldown）→ reveal → 循环第一帧即 cooldown
    const b = benchFrames([absentFrame, cooldownFrame, absentFrame, absentFrame]);
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: providerOf() });
    assertEq(r.ok, false, '不应解锁');
    assert(r.ok === false && r.attempted === false, '零输入');
    assert(r.note.includes('auth_cooldown_explicit') && r.note.includes('冷却'), `须以 cooldown 归因退出：${r.note}`);
    assertEq(b.settles, 0, `cooldown 优先于窗口推进——不得再 settle（实得 ${b.settles}）`);
  });

  run(results, 'T3#2 键盘始终不齐 → 有界重取样后归类 ui_not_settled，且携带 digits=N/10', () => {
    const partial = FULL_KEYPAD.slice(0, 4);
    const b = benchFrames([
      { keypad: partial, diag: { reason: 'digits_incomplete', found: 4, containerFound: true, hiddenSkipped: false } },
    ]);
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: providerOf() });
    assertEq(r.ok, false, '不应解锁');
    assert(r.ok === false && r.attempted === false, '零输入');
    assertEq(r.ok === false ? r.failureKind : undefined, 'ui_not_settled', '须归 ui_not_settled');
    assert(r.note.includes('digits=4/10'), `须带识别到的数字个数：${r.note}`);
    // 上界钉在**常量本身**，不写魔数——常量调大时这条会跟着走，不会变成永真断言
    assert(b.settles >= 1 && b.settles <= MAX_RESAMPLES, `重取样须有界于 ${MAX_RESAMPLES}（实得 ${b.settles}）`);
    // **诊断里不得出现任何 UI 原文/秘密**
    assert(!r.note.includes(CANARY_PIN), '诊断不得泄露 PIN');
  });

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

    assertEq(r.ok === false ? r.failureKind : undefined, 'credential_unavailable', '烧毁 → 须归凭据类');

    // 再来一次：零输入。且**凭据已不存在**，不是靠某个可删的标志位挡住的
    const before = p.clickCount;
    const b2 = bench({ lockSeq: [true, false] });
    const r2 = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b2.deps, provider: p });
    assertEq(r2.ok, false, '烧毁后不得再试');
    assertEq(p.clickCount, before, '烧毁后必须零输入');
    assertEq(
      r2.ok === false ? r2.failureKind : undefined,
      'credential_unavailable',
      '凭据不存在 → 仍是"去重新登记"',
    );
  });

  run(results, 'T3#2 claim 期 absent/unsupported（TOCTOU 竞态）→ 仍归 credential_unavailable', () => {
    // codex 三轮：这两条曾被兜底类 precondition_unmet **错归**——它们的下一步和
    // "凭据被烧"完全一样（重新登记），处置相同就不该分家。
    //
    // 覆盖这两个分支必须走**竞态**：`canAttemptUnlock` 已经把 absent/burned/
    // in_flight/unsupported 挡在前面，所以 `claimAndUnlock` 的同名 outcome 只在
    // "放行判定时 ready、真正抢占前被删/被改" 这个窗口里出现。
    // （第一版我把断言写在"烧毁后重试"那条路上——那条走的是 gate 分支，
    //  变异复验证明它根本不咬这两行。）
    const raced = (outcome: 'absent' | 'unsupported'): UnlockOutcome => {
      const base = providerOf();
      const provider: CredentialProvider = {
        ...base,
        available: () => base.available(),
        inspect: id => base.inspect(id),                       // 放行判定：ready
        claimAndUnlock: () => ({ outcome }),                    // 抢占时已经没了 / 形态不对
        commitUnlock: (id, nonce) => base.commitUnlock(id, nonce),
        burnCredential: (id, reason) => base.burnCredential(id, reason),
        promptAndWrite: (id, prompt) => base.promptAndWrite(id, prompt),
        remove: id => base.remove(id),
        listVersions: s => base.listVersions(s),
        reserveVersion: (s, v, n) => base.reserveVersion(s, v, n),
      };
      const b = bench({ lockSeq: [true, true] });
      return ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider });
    };
    for (const outcome of ['absent', 'unsupported'] as const) {
      const r = raced(outcome);
      assertEq(r.ok, false, `${outcome} 须失败`);
      assert(r.ok === false && r.attempted === false, `${outcome} 必须零输入`);
      assertEq(
        r.ok === false ? r.failureKind : undefined,
        'credential_unavailable',
        `${outcome} 的下一步同样是重新登记 → 须归凭据类`,
      );
    }
  });

  run(results, '键位不全 → **零输入**（对着事故里的固定分辨率坐标表）', () => {
    const p = providerOf();
    const partial = FULL_KEYPAD.slice(0, 7); // 只识别到 7 个键
    const b = bench({ keypad: partial, lockSeq: [true, true] });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, '键位不全须失败');
    assertEq(p.clickCount, 0, '**零输入**——绝不用固定坐标兜底');
    assert(r.ok === false && !r.attempted, '未尝试输入');
    assertEq(p.inspect(ID).state, 'ready', '未输入则凭据保持可用，不得被误烧');
  });

  run(results, 'wake 后无键盘 → reveal 恰好一次 → 新快照完整后才允许输入', () => {
    const p = providerOf();
    let snapshots = 0;
    let reveals = 0;
    const deps: UnlockDeps = {
      wake: () => {},
      reveal: () => { reveals += 1; return { ok: true, timedOut: false }; },
      tap: () => {},
      settle: () => {},
      snapshot: () => {
        snapshots += 1;
        if (snapshots === 1) {
          return {
            locked: true,
            keypad: [],
            cooldown: { state: 'not_cooldown', ruleId: 'test_clear' },
            lockBounds: { left: 0, top: 0, right: 1080, bottom: 2400 },
          };
        }
        return {
          locked: snapshots === 2,
          keypad: snapshots === 2 ? FULL_KEYPAD : [],
          cooldown: { state: 'not_cooldown', ruleId: 'test_clear' },
          lockBounds: { left: 0, top: 0, right: 1080, bottom: 2400 },
        };
      },
    };
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps, provider: p });
    assertEq(r.ok, true, `应在 reveal 后解锁：${r.note}`);
    assertEq(reveals, 1, '非秘密 reveal 必须恰好一次');
    assertEq(p.clickCount, 1, '只有第二帧完整键盘后才可进入一次凭据临界区');
  });

  run(results, 'ambiguous 冷却只输出 rule_id，不泄露 UI/通知原文且零输入', () => {
    const p = providerOf();
    const sentinel = 'PRIVATE_NOTIFICATION_retry_disabled';
    const b = bench({ lockSeq: [true], cooldown: 'ambiguous' });
    const r = ensureUnlocked({ serial: SERIAL, credentialRef: REF, deps: b.deps, provider: p });
    assertEq(r.ok, false, 'ambiguous 必须保守拒绝');
    assertEq(p.clickCount, 0, 'ambiguous 必须零输入');
    assert(!JSON.stringify(r).includes(sentinel), 'note 不得携带 UI 原文');
    assert(r.note.includes('test_rule'), `note 只应给稳定 rule_id：${r.note}`);
  });
  run(results, '锁定冷却期 → 零输入（再输只会加重系统惩罚）', () => {
    const p = providerOf();
    const b = bench({ lockSeq: [true, false], cooldown: 'cooldown' });
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
