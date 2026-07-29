// ============================================================================
// device-test-run-lock-classify.unit.test.ts — testing 侧锁屏的失败分类
//                                              （openspec ... t1/t6）
// ----------------------------------------------------------------------------
// 三轮 review P1：`aa start` 检出锁屏、恢复失败后仍写成 aa_start_preflight_failed，
// 结论层只标通用 device_toolchain —— 指引把人带向"查签名/环境"，而真因是"手机锁了"。
// 契约：恢复失败 → 当前 attempt INCOMPLETE / external_block（与 UT 侧同一 SSOT）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

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

/** 去注释后的可执行代码——源码级断言不得命中它自己的说明文字 */
function executableCode(file: string): string {
  return fs
    .readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

const RUN_PROVIDER = path.join(__dirname, '..', '..', 'providers', 'device-test-run.ts');
const CHECK_TESTING = path.join(
  __dirname, '..', '..', '..', '..', '..', 'harness', 'scripts', 'check-testing.ts',
);

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'P1：锁屏且恢复失败 → run_failure_kind=device_locked（不再混入 preflight_failed）', () => {
    const code = executableCode(RUN_PROVIDER);
    assert(/\| 'device_locked'/.test(code), 'RunFailureKind 须含 device_locked');
    assert(
      /lockedAndUnrecovered\s*\n?\s*\?\s*'device_locked'\s*\n?\s*:\s*'aa_start_preflight_failed'/.test(code),
      '恢复失败须落 device_locked，恢复成功/非锁屏才是 aa_start_preflight_failed',
    );
    assert(
      /if \(!pre\.ok\) lockedAndUnrecovered = true;/.test(code),
      '仅当"命中锁屏信号且恢复后仍失败"才置该标记',
    );
  });

  run(results, 'P1：**trace 必须回传**，否则结论层永远读不到这个 kind', () => {
    const code = executableCode(RUN_PROVIDER);
    // 此前 preflight 失败分支写了 trace 文件却 return `trace: null` —— 写了等于没写
    const branch = /const preflightKind: RunFailureKind[\s\S]*?omitBundleForHylyre = true;/.exec(code);
    assert(branch !== null, '应能定位 preflight 失败分支');
    assert(
      /trace: readJsonSafe<HylyreTrace>\(tracePathResolved\)/.test(branch![0]),
      'preflight 失败时必须回传 trace（否则 run_failure_kind 到不了结论层）',
    );
    assert(
      !/tracePath: null,\s*\n\s*trace: null,/.test(branch![0]),
      '不得再返回 trace: null',
    );
  });

  run(results, 'P1：check-testing 把 device_locked 归 externalBlocked/device_blocked', () => {
    const code = executableCode(CHECK_TESTING);
    assert(
      /const deviceLocked = run\.trace\?\.run_failure_kind === 'device_locked';/.test(code),
      'check-testing 须读 run_failure_kind',
    );
    assert(
      /blocking_class: deviceLocked \? 'externalBlocked' : 'device_toolchain'/.test(code),
      '锁屏须归 externalBlocked，其余仍是 device_toolchain',
    );
    assert(
      /\.\.\.\(deviceLocked \? \{ failure_kind: 'device_blocked' \} : \{\}\)/.test(code),
      '须带 failure_kind=device_blocked（goal 据此归 external_block）',
    );
    assert(
      /人工解锁设备后重跑/.test(code),
      '指引须指向"人解锁"，而不是查签名/环境',
    );
  });

  return results;
}
