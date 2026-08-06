// f4b2c8e6 t3 — HarmonyOS 锁屏 parser：容器边界、originalText、几何与冷却隐私
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseLockScreenTree } from '../../scripts/utils/device-readiness-deps';
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
const ACCEPTANCE_DIR = path.join(
  FIXTURE_DIR,
  'acceptance',
  'f4b2c8e6-live-gate-2026-07-30T064556Z',
);
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
      source_sha256: Record<string, string>;
      result: { passed: boolean; serial_unchanged: boolean };
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
