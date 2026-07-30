// ============================================================================
// device-runtime-recovery.unit.test.ts — 运行期再次锁屏的恢复语义
//                                        （openspec ... t6）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ensureDeviceReadyAtRuntime,
  withDeviceRecovery,
} from '../../scripts/utils/device-runtime-recovery';
import { credentialRefOf } from '../../scripts/utils/device-credential-store';
import { FakeCredentialProvider } from '../helpers/fake-credential-provider';
import type { UnlockDeps } from '../../scripts/utils/device-unlock-helper';
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

const SERIAL = 'PHONE-RT';
const ID = { serial: SERIAL, version: 1 };
const REF = credentialRefOf(ID);

/** 已登记一条可用凭据的 fake OS 凭据库（taps 记录 provider 内部实际点击） */
function readyProvider(taps: number[] = []): FakeCredentialProvider {
  const p = new FakeCredentialProvider({
    onClick: (_s, seq) => { taps.push(...seq.map(t => t.x)); return true; },
  });
  p.seedReady(ID, '123456');
  return p;
}

function depsWith(lockSeq: Array<boolean | undefined>, taps: number[] = []): UnlockDeps {
  let i = 0;
  return {
    snapshot: () => {
      const locked = lockSeq[Math.min(i++, lockSeq.length - 1)];
      return {
        locked,
        keypad: locked === true
          ? '0123456789'.split('').map((d, k) => ({ digit: d, x: k, y: k }))
          : [],
        cooldown: { state: 'not_cooldown', ruleId: 'test_clear' },
        lockBounds: { left: 0, top: 0, right: 100, bottom: 200 },
      };
    },
    wake: () => {},
    reveal: () => {},
    tap: (_s, x) => { taps.push(x); },
  };
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '未锁屏 → 直接放行，零动作', () => {
    const taps: number[] = [];
    const r = ensureDeviceReadyAtRuntime({
      serial: SERIAL, credentialRef: REF, deps: depsWith([false], taps), provider: readyProvider(),
    });
    assertEq(r.recovered, true, '未锁应直接放行');
    assertEq(taps.length, 0, '零输入');
  });

  run(results, '锁屏但**未登记凭据** → 不恢复且零输入，指引"请人解锁"', () => {
    const taps: number[] = [];
    const r = ensureDeviceReadyAtRuntime({
      serial: SERIAL, credentialRef: null, deps: depsWith([true], taps),
    });
    assertEq(r.recovered, false, '未授权不得恢复');
    assert(!r.recovered && r.authorized === false, '须标记未授权');
    assertEq(taps.length, 0, '**零输入**——未授权时结构上不存在输入路径');
    assert(r.note.includes('请人解锁'), `指引须指向人：${r.note}`);
  });

  run(results, '锁屏状态判不出 → 不猜，不恢复', () => {
    const r = ensureDeviceReadyAtRuntime({
      serial: SERIAL, credentialRef: REF, deps: depsWith([undefined]), provider: readyProvider(),
    });
    assertEq(r.recovered, false, '判不出不得放行');
  });

  run(results, '凭据已烧毁 → 运行期同样零输入（放行判定跨路径同源）', () => {
    const taps: number[] = [];
    const provider = readyProvider(taps);
    provider.burnCredential(ID, '先前失败');
    const r = ensureDeviceReadyAtRuntime({
      serial: SERIAL, credentialRef: REF, deps: depsWith([true, false]), provider,
    });
    assertEq(r.recovered, false, 'burned 不得恢复');
    assertEq(taps.length, 0, '零输入');
    assertEq(provider.clickCount, 0, '结构上未进入临界区');
  });

  run(results, 'withDeviceRecovery：锁屏失败 → 恢复一次 → 重试原操作成功', () => {
    let calls = 0;
    const result = withDeviceRecovery<{ ok: boolean; kind?: string }>({
      serial: SERIAL,
      credentialRef: REF,
      provider: readyProvider(),
      deps: depsWith([true, false, false]), // 恢复时：锁 → 输入后解开
      run: () => {
        calls += 1;
        return calls === 1 ? { ok: false, kind: 'device_locked' } : { ok: true };
      },
      isDeviceLockedFailure: r => r.kind === 'device_locked',
    });
    assertEq(calls, 2, '恢复后须重试原操作一次');
    assertEq(result.ok, true, '重试应成功');
  });

  run(results, 'withDeviceRecovery：非锁屏失败 → **不触发恢复**（不拿设备问题掩盖代码问题）', () => {
    let calls = 0;
    const taps: number[] = [];
    const result = withDeviceRecovery<{ ok: boolean; kind?: string }>({
      serial: SERIAL,
      credentialRef: REF,
      provider: readyProvider(),
      deps: depsWith([true, false], taps),
      run: () => { calls += 1; return { ok: false, kind: 'test_failed' }; },
      isDeviceLockedFailure: r => r.kind === 'device_locked',
    });
    assertEq(calls, 1, '用例真实失败不得重试');
    assertEq(taps.length, 0, '不得因用例失败去动设备');
    assertEq(result.ok, false, '如实返回原失败');
  });

  run(results, 'withDeviceRecovery：恢复失败 → 返回原失败，**不重试、不切目标**', () => {
    let calls = 0;
    const notes: Array<{ note: string; recovered: boolean }> = [];
    const result = withDeviceRecovery<{ ok: boolean; kind?: string }>({
      serial: SERIAL,
      credentialRef: null, // 未授权 → 恢复必失败
      deps: depsWith([true]),
      run: () => { calls += 1; return { ok: false, kind: 'device_locked' }; },
      isDeviceLockedFailure: r => r.kind === 'device_locked',
      onRecovery: (note, recovered) => notes.push({ note, recovered }),
    });
    assertEq(calls, 1, '恢复失败不得重试原操作');
    assertEq(result.ok, false, '返回原失败');
    assertEq(notes[0]?.recovered, false, '恢复结果须回调告知');
  });

  run(results, '源码契约：只在同一 serial 恢复，不含任何切换目标的分支', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-runtime-recovery.ts'),
      'utf-8',
    );
    assert(!/emulator|fallback|switchTarget/i.test(src), '运行期恢复不得涉及切换到模拟器');
    assert(/input\.serial/.test(src), '恢复目标须固定为传入 serial');
  });

  return results;
}
