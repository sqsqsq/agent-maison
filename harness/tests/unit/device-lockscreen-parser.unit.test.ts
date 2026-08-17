// f4b2c8e6 t3 — HarmonyOS 锁屏 parser：容器边界、originalText、几何与冷却隐私
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildRevealSwipeArgs,
  parseLockScreenTree,
  projectHdcExecFact,
  revealLockKeypad,
  REVEAL_GESTURE_POLICY,
  REVEAL_TIMEOUT_FLOOR_MS,
  UITEST_VELOCITY_RANGE,
} from '../../scripts/utils/device-readiness-deps';
import type { UnitCaseResult } from '../run-unit';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try { fn(); results.push({ name, ok: true }); }
  catch (err) { results.push({ name, ok: false, error: (err as Error).stack ?? String(err) }); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const attrs = (attributes: Record<string, unknown>, children: unknown[] = []) => ({ attributes, children });
const text = (value: string, bounds: string) => attrs({ originalText: value, text: '', bounds });
const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'device-lockscreen');
/**
 * 判据面指向**最新一次**真机验收记录（a4e7c2f9 t8）。
 *
 * 2026-07-30 的 `f4b2c8e6-*` 保留为历史档案——其**历史证据部分**（`source_sha256`、
 * 当时的验收结论、`verified_sha256`）未被改写（重写等于伪造真机证据，该纪律由那份记录
 * 自身载明）；该文件仅**状态字段**被更新为已关闭并加反向指针。它验的是旧代码，
 * 欠账已由本条新验收关闭，故不再作为活跃判据。
 */
const ACCEPTANCE_DIR = path.join(
  FIXTURE_DIR,
  'acceptance',
  'a4e7c2f9-live-gate-2026-08-17T110000Z',
);
/** 历史档案：其欠账标记须确实指向上面那条新记录（否则"关闭"只是一句自述） */
const LEGACY_ACCEPTANCE_DIR = path.join(
  FIXTURE_DIR,
  'acceptance',
  'f4b2c8e6-live-gate-2026-07-30T064556Z',
);
/**
 * 真机验收**必须**覆盖的解锁链源码集合——集合本身要精确相等，
 * 否则删掉其中一条哈希就能让"证据绑定生产源码"这条判据形同虚设。
 * `bounded-sync-wait.ts` 是 settle 原语，2026-07-30 验收时尚不存在、曾被刻意排除。
 */
const REQUIRED_ACCEPTANCE_SOURCES = [
  'harness/scripts/utils/bounded-sync-wait.ts',
  'harness/scripts/utils/device-readiness-deps.ts',
  'harness/scripts/utils/device-readiness-gate.ts',
  'harness/scripts/utils/device-unlock-helper.ts',
];
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function keypadNodes(): unknown[] {
  const centers: Record<string, [number, number]> = {
    '1': [260, 1200], '2': [540, 1200], '3': [820, 1200],
    '4': [260, 1450], '5': [540, 1450], '6': [820, 1450],
    '7': [260, 1700], '8': [540, 1700], '9': [820, 1700],
    '0': [540, 1950],
  };
  return Object.entries(centers).map(([digit, [x, y]]) =>
    text(digit, `[${x - 40},${y - 40}][${x + 40},${y + 40}]`));
}

function lockTree(options: {
  pin?: boolean;
  authText?: string;
  notificationText?: string;
  clockDigits?: string[];
} = {}): unknown {
  const bouncerChildren: unknown[] = [];
  if (options.authText) bouncerChildren.push(text(options.authText, '[100,800][980,900]'));
  if (options.pin) bouncerChildren.push(attrs({ id: 'Digital_PSD_Input_Tip', bounds: '[100,1050][980,2100]' }, keypadNodes()));
  const rootChildren: unknown[] = [attrs({ id: 'BouncerView', bounds: '[0,0][1080,2400]' }, bouncerChildren)];
  if (options.notificationText) bouncerChildren.push(attrs({ id: 'NotificationPanel' }, [text(options.notificationText, '[10,100][1000,300]')]));
  if (options.clockDigits) {
    rootChildren.push(attrs(
      { id: 'Text_Digital' },
      options.clockDigits.map((d, i) => attrs({
        originalText: '',
        text: d,
        bounds: `[${i * 80},200][${i * 80 + 60},280]`,
      })),
    ));
  }
  return attrs({ id: 'ScreenLockRootComponent', bounds: '[0,0][1080,2400]' }, rootChildren);
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '四个脱敏真机 fixture 驱动时钟/人脸/完整键盘/混合残帧回归', () => {
    for (const name of ['clock-only.json', 'clock-with-face-hint.json', 'mixed-clock-and-partial.json']) {
      const snap = parseLockScreenTree(fixture(name));
      assertEq(snap.locked, true, `${name} 应识别锁屏`);
      assertEq(snap.keypad.length, 0, `${name} 不得形成完整 PIN 键盘`);
      assertEq(snap.cooldown.state, 'not_cooldown', `${name} 不得误判 PIN 冷却`);
    }
    const stable = parseLockScreenTree(fixture('keypad-stable.json'));
    assertEq(stable.keypad.length, 10, 'stable-keypad 应识别完整十键');
    assertEq(new Set(stable.keypad.map(k => k.digit)).size, 10, 'stable-keypad 的 0–9 必须唯一');
    for (const [digit, x, y] of [
      ['1', 372, 911], ['2', 660, 911], ['3', 948, 911], ['0', 660, 1703],
    ] as const) {
      const key = stable.keypad.find(k => k.digit === digit);
      assert(key?.x === x && key.y === y, `${digit} 坐标应为 (${x},${y})，实际 ${JSON.stringify(key)}`);
    }
    assertEq(stable.cooldown.state, 'not_cooldown', '人脸重试提示不得冒充 PIN 冷却');
  });
  run(results, '真机 gate 验收证据绑定生产源码且事件为 succeeded → physical ready', () => {
    const rawEvents = fs.readFileSync(path.join(ACCEPTANCE_DIR, 'events.jsonl'), 'utf8');
    const events = rawEvents.trim().split('\n').map(line => JSON.parse(line));
    const verification = JSON.parse(
      fs.readFileSync(path.join(ACCEPTANCE_DIR, 'verification.json'), 'utf8'),
    ) as {
      credential_material_recorded: boolean;
      operator_unlocked_manually?: boolean;
      source_sha256: Record<string, string>;
      start_state_proof?: {
        screen_lock_root_present?: boolean;
        pin_container_present?: boolean;
        keypad_diag_reason?: string;
        waited_ms?: number[];
      };
      result: {
        passed: boolean;
        serial_unchanged: boolean;
        credential_state_after?: string;
        reveal_executed?: boolean;
      };
      supersedes?: { record?: string; closes?: string };
    };
    assertEq(events.length, 2, '验收事件数');
    assertEq(events[0].type, 'device_unlock_attempt', '首事件类型');
    assertEq(events[0].outcome, 'succeeded', '解锁结果');
    assertEq(events[1].type, 'device_ready', '次事件类型');
    assertEq(events[1].target_kind, 'physical', '设备类型');
    assertEq(events[1].serial, events[0].serial, '同一 serial');
    assertEq(verification.result.passed, true, '验收结论');
    assertEq(verification.result.serial_unchanged, true, 'serial 冻结');
    assertEq(verification.credential_material_recorded, false, '不得记录凭据材料');
    assert(!/credentialRef|password|"pin"|secret/i.test(rawEvents), '事件不得含秘密字段');

    // ── a4e7c2f9 t8：以下字段是本次验收的**核心证据**，必须由判据面锁住 ──────────
    // 此前本用例只看「两条成功事件 + passed + serial + 无凭据材料」，于是把
    // start_state_proof 整段删掉、或把 pin_container_present 改成 true（= 起点其实停在
    // PIN 页、根本没走 reveal），全测照样绿——等于验收记录里最关键的部分裸奔。

    // ① 必须是**生产 gate 自动解锁**，不得由人工解锁顶替（顶替等于没验自动链路）
    assertEq(verification.operator_unlocked_manually, false, '验收须由生产 gate 自动完成，不得人工解锁顶替');

    // ② 起始态必须**被证明**为时钟锁屏页：锁屏根在场 **且** PIN 容器不在场。
    //    若起点已在 PIN 页，completeKeypad 直接命中十键、**根本不执行 reveal**
    //    （宿主首轮 succeeded 正是这么来的），本次修复的那条路径就没被验到。
    const proof = verification.start_state_proof;
    assert(!!proof, 'verification 须含 start_state_proof（起始态要证明，不能只声明做过 suspend）');
    assertEq(proof?.screen_lock_root_present, true, '起始态须证明锁屏根在场');
    assertEq(proof?.pin_container_present, false, '起始态须证明 PIN 容器不在场（否则绕过 reveal）');
    assert(
      typeof proof?.keypad_diag_reason === 'string' && proof.keypad_diag_reason.length > 0,
      '起始态须记录 keypad 归因',
    );
    assert(
      Array.isArray(proof?.waited_ms) && proof!.waited_ms!.length > 0,
      '须记录实际等待时长——实测 suspend 后 3s 不锁、45s 才锁，只声明 suspend 不足以保证进入锁屏',
    );

    // ③ 全链走到底的两项结论
    assertEq(verification.result.reveal_executed, true, '须记录 reveal 确实执行过');
    assertEq(verification.result.credential_state_after, 'ready', '解锁成功后凭据须回到 ready（未被烧毁）');

    // ④ 覆盖的源码集合**精确相等**：少登记一条即可让哈希绑定失效
    assertEq(
      Object.keys(verification.source_sha256).sort().join('|'),
      [...REQUIRED_ACCEPTANCE_SOURCES].sort().join('|'),
      'source_sha256 须精确覆盖解锁链四个源码文件（含 bounded-sync-wait.ts）',
    );

    // ⑤ 新旧记录**互相指认**：只在自己文件里写一句"已关闭"不算数
    assertEq(
      verification.supersedes?.record,
      'harness/tests/fixtures/device-lockscreen/acceptance/f4b2c8e6-live-gate-2026-07-30T064556Z',
      '新记录须声明其 supersede 的历史记录',
    );
    assertEq(verification.supersedes?.closes, 'PENDING_REAL_DEVICE_REVERIFICATION', '须声明关闭的欠账标记');
    const legacy = JSON.parse(
      fs.readFileSync(path.join(LEGACY_ACCEPTANCE_DIR, 'verification.json'), 'utf8'),
    ) as { superseded_by_source_change?: { status?: string; closed_by?: { record?: string } } };
    assertEq(
      legacy.superseded_by_source_change?.status, 'CLOSED_BY_LATER_ACCEPTANCE',
      '历史记录的欠账标记须已关闭',
    );
    assert(
      (legacy.superseded_by_source_change?.closed_by?.record ?? '').includes('a4e7c2f9-live-gate'),
      '历史记录须反向指向关闭它的那条新验收',
    );
    // 证据绑定生产源码：哈希一致 = 该真机验收仍覆盖当前代码。
    // e5d8a2c4 T3：源码合法演进后**不得为迁就改动而重写哈希**（那是伪造真机证据——
    // 新代码从未在真机上验过）。允许的唯一出路是**如实记录失效并逐个枚举**：
    // superseded 块必须精确覆盖全部失配文件，且每条带 verified/current 双哈希。
    // 于是"改了代码"这件事无法被悄悄抹掉，真机复验欠账始终可见。
    const sup = (verification as unknown as {
      superseded_by_source_change?: {
        status?: string;
        changed_files?: Array<{ path: string; verified_sha256: string; current_sha256: string }>;
      };
    }).superseded_by_source_change;
    const mismatched: string[] = [];
    for (const [rel, expected] of Object.entries(verification.source_sha256)) {
      const actual = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(REPO_ROOT, rel)))
        .digest('hex');
      if (actual !== expected) mismatched.push(rel);
    }
    // **集合精确相等**（codex 订正：只验"每个失配都被登记"允许多登记未失配文件，
    // 等于给记录留了注水空间）；**零失配时旧标记必须关闭**，否则"待真机复验"会永久挂着。
    const declared = [...new Set((sup?.changed_files ?? []).map(c => c.path))].sort();
    if (mismatched.length === 0) {
      assert(
        !sup,
        '源码与真机验收记录已一致，superseded_by_source_change 必须移除——' +
        '否则"待真机复验"欠账永远挂着，失去指示意义。',
      );
    } else {
      assert(
        !!sup && sup.status === 'PENDING_REAL_DEVICE_REVERIFICATION',
        `生产源码已变（${mismatched.join(', ')}）却无 superseded_by_source_change 记录——` +
        '禁止重写 source_sha256 迁就改动（=伪造真机证据），须如实记录待真机复验。',
      );
      assertEq(
        declared.join('|'), [...mismatched].sort().join('|'),
        'superseded.changed_files 须与实际失配集合**精确相等**（不多不少）',
      );
      for (const c of sup!.changed_files ?? []) {
        const now = crypto.createHash('sha256')
          .update(fs.readFileSync(path.join(REPO_ROOT, c.path))).digest('hex');
        assertEq(c.current_sha256, now, `${c.path} 的 current_sha256 须与当前源码一致（记录不得过期）`);
        assertEq(c.verified_sha256, verification.source_sha256[c.path], `${c.path} 的 verified_sha256 须与原验收记录一致`);
      }
    }
  });
  run(results, 'a4e7c2f9 t1 执行事实：超时/非零 status 各自正确投影，且绝不携带 error.message', () => {
    // 形态取自真机实测：spawnSync 超时 ⇒ status:null / signal:'SIGTERM' / error.code:'ETIMEDOUT'
    const timedOut = projectHdcExecFact({
      stdout: '', stderr: '', status: null, signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync D:\\Program Files\\nodejs\\node.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    } as unknown as Parameters<typeof projectHdcExecFact>[0]);
    assertEq(timedOut.ok, false, '超时不得算成功');
    assertEq(timedOut.timedOut, true, '须识别为超时');
    assertEq(timedOut.signal, 'SIGTERM', '须投影 signal');
    assertEq(timedOut.errorCode, 'ETIMEDOUT', '须投影 errorCode');
    // Node 的超时 message 形如 `spawnSync <绝对路径> ETIMEDOUT`，携带本机路径 → 绝不进事实
    assert(!JSON.stringify(timedOut).includes('nodejs'), '执行事实不得携带 error.message（含本机绝对路径）');

    const failed = projectHdcExecFact({
      stdout: 'x', stderr: 'y', status: 1, signal: null, error: undefined,
    } as unknown as Parameters<typeof projectHdcExecFact>[0]);
    assertEq(failed.ok, false, '非零 status 不得算成功');
    assertEq(failed.timedOut, false, '非超时失败不得被标成超时');
    assertEq(failed.status, 1, '须投影 status');
    assertEq(failed.errorCode, null, '无 error 时 errorCode 为 null');

    const okFact = projectHdcExecFact({
      stdout: 'a', stderr: '', status: 0, signal: null, error: undefined,
    } as unknown as Parameters<typeof projectHdcExecFact>[0]);
    assertEq(okFact.ok, true, 'status=0 且无 error ⇒ ok（判据不得放宽或收紧）');
  });

  run(results, 'a4e7c2f9 t2 reveal 策略同源：velocity 与 timeout 均出自策略且各在合法域内', () => {
    // **刻意不做** distance/velocity 的算术相容性断言：旧的坏组合（300px/s + 5s）理论值
    // 921/300≈3.07s 反而"看起来相容"，真机实测却是 5.2s——算术断言只会给它放行。
    // 真正的参数相容性由真机验收证明（plan t8）；这里只钉结构性事实。
    const bounds = { left: 0, top: 117, right: 1320, bottom: 2120 };   // 真机实测取值
    const seen: Array<{ args: string[]; timeoutMs: number }> = [];
    const out = revealLockKeypad('SERIAL-X', bounds, (args, timeoutMs) => {
      seen.push({ args, timeoutMs });
      return { ok: false, out: '', status: null, signal: 'SIGTERM', timedOut: true, errorCode: 'ETIMEDOUT' };
    });
    assertEq(seen.length, 1, 'reveal 只应发一条命令');
    assertEq(seen[0].timeoutMs, REVEAL_GESTURE_POLICY.timeoutMs, 'timeout 须取自策略，不得是独立字面量');
    assertEq(
      seen[0].args[seen[0].args.length - 1], String(REVEAL_GESTURE_POLICY.velocityPxPerSecond),
      'swipe 第 5 参数（velocity）须取自同一策略',
    );
    assertEq(buildRevealSwipeArgs('SERIAL-X', bounds).join(' '), seen[0].args.join(' '), 'argv 须由生产纯函数产出');
    // 合法域与下限
    assert(
      REVEAL_GESTURE_POLICY.velocityPxPerSecond >= UITEST_VELOCITY_RANGE.min &&
      REVEAL_GESTURE_POLICY.velocityPxPerSecond <= UITEST_VELOCITY_RANGE.max,
      `velocity 须在 uitest 合法域 ${UITEST_VELOCITY_RANGE.min}–${UITEST_VELOCITY_RANGE.max} 内`,
    );
    assert(
      REVEAL_GESTURE_POLICY.timeoutMs >= REVEAL_TIMEOUT_FLOOR_MS,
      `timeout 须不低于下限 ${REVEAL_TIMEOUT_FLOOR_MS}ms`,
    );
    // 执行失败必须如实上浮（这条断链正是宿主两次被误判的根源）
    assertEq(out.ok, false, 'exec 失败须如实上浮');
    assertEq(out.timedOut, true, '超时事实须上浮，供上游归 reveal_failed');
    // 断言**生产 revealLockKeypad 的返回值**本身带 errorCode——只测底层投影函数不够，
    // 初版正是在这一跳把 errorCode 丢了（HdcExecFact 有、RevealOutcome 没有）。
    assertEq(out.errorCode, 'ETIMEDOUT', 'errorCode 须由生产 reveal 返回值带出，不得在此跳丢失');
    assertEq(out.signal, 'SIGTERM', 'signal 须一并带出');
  });

  run(results, 'wake 时钟帧的 0/1/5/9 不得冒充 PIN 键盘', () => {
    const snap = parseLockScreenTree(lockTree({ clockDigits: ['0', '1', '5', '9'] }));
    assertEq(snap.locked, true, '应识别锁屏');
    assertEq(snap.keypad.length, 0, 'Digital_PSD_Input_Tip 外的数字必须忽略');
  });

  run(results, 'stable keypad 只读 Digital_PSD_Input_Tip 内 originalText 0–9', () => {
    const snap = parseLockScreenTree(lockTree({ pin: true }));
    assertEq(snap.keypad.length, 10, '应识别完整十键');
    assertEq(new Set(snap.keypad.map(k => k.digit)).size, 10, '0–9 必须唯一');
    const fallback = lockTree({ pin: true }) as any;
    fallback.children[0].children[0].children[0].attributes.text = '0';
    fallback.children[0].children[0].children[0].attributes.originalText = '';
    assertEq(parseLockScreenTree(fallback).keypad.length, 10, 'originalText 为空时须兼容 text');
  });

  run(results, '重复数字或九宫格几何异常均整体拒绝', () => {
    const duplicate = lockTree({ pin: true }) as any;
    duplicate.children[0].children[0].children.push(text('1', '[200,2100][280,2180]'));
    assertEq(parseLockScreenTree(duplicate).keypad.length, 0, '重复数字必须拒绝');
    const skewed = lockTree({ pin: true }) as any;
    skewed.children[0].children[0].children[1].attributes.bounds = '[100,2200][180,2280]';
    assertEq(parseLockScreenTree(skewed).keypad.length, 0, '几何异常必须拒绝');
  });

  run(results, '人脸失败提示是 not_cooldown；明确倒计时是 cooldown；未知重试是 ambiguous', () => {
    assertEq(parseLockScreenTree(lockTree({ authText: '未识别成功，双击屏幕重试' })).cooldown.state, 'not_cooldown', 'face hint');
    assertEq(parseLockScreenTree(lockTree({ authText: '30 秒后重试' })).cooldown.state, 'cooldown', 'explicit cooldown');
    assertEq(parseLockScreenTree(lockTree({ authText: '请重试' })).cooldown.state, 'ambiguous', 'ambiguous retry');
  });

  run(results, '通知子树含 retry/disabled 不参与冷却且解析结果不泄露原文', () => {
    const sentinel = 'PRIVATE_NOTICE retry disabled';
    const snap = parseLockScreenTree(lockTree({ notificationText: sentinel }));
    assertEq(snap.cooldown.state, 'not_cooldown', '通知必须完全排除');
    assert(!JSON.stringify(snap).includes(sentinel), '快照/后续 notes 不得携带通知原文');
  });

  return results;
}
