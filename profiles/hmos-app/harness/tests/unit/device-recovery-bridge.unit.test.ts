// ============================================================================
// device-recovery-bridge.unit.test.ts — 四个设备边界共用的就绪/恢复语义
//                                       （openspec device-readiness-and-completion t6）
// ----------------------------------------------------------------------------
// 三轮 review 的两条 P1 落成断言：
//   ① attempt 冻结后**不得**回落读实时配置（manual 模式跑到一半改配置就提权）；
//   ② 四个边界都必须在**操作前**做就绪保证，不只是失败后补救。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { resolveAttemptCredentialRef } from '../../../../../harness/scripts/utils/device-readiness-deps';
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
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const PROFILE_HARNESS = path.join(__dirname, '..', '..');

/** 去注释后的可执行代码——源码级断言不得命中它自己的说明文字 */
function executableCode(file: string): string {
  return fs
    .readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'P1：attempt 已冻结且**未授权** → 绝不回落读实时配置', () => {
    withEnv(
      { MAISON_DEVICE_ATTEMPT_FROZEN: '1', MAISON_DEVICE_CREDENTIAL_REF: undefined },
      () => {
        // 即便当前配置里写着 credential 模式，本 attempt 也必须保持未授权。
        // 传一个真实存在的项目根即可——判定必须在读配置之前就短路。
        assertEq(
          resolveAttemptCredentialRef(process.cwd()),
          null,
          'manual 模式起跑的 attempt 不得因运行中改配置而获得自动解锁权',
        );
      },
    );
  });

  run(results, 'P1：attempt 已冻结且已授权 → 用冻结的那个 ref，不重读配置', () => {
    withEnv(
      {
        MAISON_DEVICE_ATTEMPT_FROZEN: '1',
        MAISON_DEVICE_CREDENTIAL_REF: 'maison/device/PHONE-X/v7',
      },
      () => {
        assertEq(
          resolveAttemptCredentialRef(process.cwd()),
          'maison/device/PHONE-X/v7',
          '须用冻结快照（运行中轮换不得静默换版本）',
        );
      },
    );
  });

  run(results, '普通模式（未经 gate、无冻结标记）仍按配置解析——两模式能力拉齐', () => {
    withEnv(
      { MAISON_DEVICE_ATTEMPT_FROZEN: undefined, MAISON_DEVICE_CREDENTIAL_REF: undefined },
      () => {
        // 没有 gate 就没有冻结；此时读配置是唯一路径，不能一刀切返回 null，
        // 否则普通模式永远拿不到解锁能力（goal 与普通模式须持续拉齐）。
        const src = executableCode(
          path.join(__dirname, '..', '..', '..', '..', '..', 'harness', 'scripts', 'utils', 'device-readiness-deps.ts'),
        );
        assert(
          /if \(process\.env\.MAISON_DEVICE_ATTEMPT_FROZEN === '1'\) return null;/.test(src),
          '冻结判据须显式',
        );
        assert(
          /return resolveUnlockCredentialRef\(projectRoot\);/.test(src),
          '未冻结时须回落配置（普通模式）',
        );
      },
    );
  });

  run(results, '**四个边界都走同一个桥**：不得再各自复制一份恢复代码', () => {
    const boundaries = [
      'hdc-runner.ts',
      'app-snapshot-warmup.ts',
      path.join('providers', 'device-test-install.ts'),
      path.join('providers', 'device-test-run.ts'),
    ];
    for (const rel of boundaries) {
      const code = executableCode(path.join(PROFILE_HARNESS, rel));
      assert(
        /device-recovery-bridge/.test(code),
        `${rel} 须经 device-recovery-bridge（此前四处各抄一份，三轮 review 各抓出一次不一致）`,
      );
      assert(
        !/frozenRef \|\| /.test(code),
        `${rel} 不得再有 "frozenRef || 读配置" 的回落（attempt 冻结会被绕过）`,
      );
      assert(
        !/ensureDeviceReadyAtRuntime\(\{/.test(code),
        `${rel} 不得再直接拼装恢复调用——语义只能有一处`,
      );
    }
  });

  run(results, 'P1：**操作前**就绪保证已接入（不只是失败后补救）', () => {
    const preBoundaries: Array<{ file: string; marker: RegExp }> = [
      { file: 'app-snapshot-warmup.ts', marker: /ensureReadyBefore\(opts\.projectRoot, serial\)/ },
      { file: path.join('providers', 'device-test-install.ts'), marker: /ensureReadyBefore\(opts\.projectRoot\)/ },
      { file: path.join('providers', 'device-test-run.ts'), marker: /ensureReadyBefore\(opts\.projectRoot, opts\.deviceSn\)/ },
    ];
    for (const b of preBoundaries) {
      const code = executableCode(path.join(PROFILE_HARNESS, b.file));
      assert(b.marker.test(code), `${b.file} 须在操作前调用 ensureReadyBefore`);
    }
  });

  run(results, 'P1：前检**确认阻断**时 blocked=true（不是只记日志然后照跑）', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const recovery = require('../../../../../harness/scripts/utils/device-runtime-recovery') as typeof import('../../../../../harness/scripts/utils/device-runtime-recovery');
    /* eslint-enable @typescript-eslint/no-require-imports */

    // 锁屏 + 未登记凭据 → 确认为外部阻断
    const locked = recovery.ensureDeviceReadyAtRuntime({
      serial: 'PHONE-B',
      credentialRef: null,
      deps: {
        snapshot: () => ({ locked: true, keypad: [], cooldown: { state: 'not_cooldown', ruleId: 'test_clear' } }),
        wake: () => {},
        reveal: () => {},
        tap: () => {},
        settle: () => {},
      },
    });
    assertEq(locked.recovered, false, '锁屏未授权不得就绪');
    assertEq(locked.reason, 'unauthorized', '须归为 unauthorized（确认阻断）');

    // 判不出 → **不**算阻断（探测能力问题不能把好设备判死）
    const unknown = recovery.ensureDeviceReadyAtRuntime({
      serial: 'PHONE-B',
      credentialRef: null,
      deps: {
        snapshot: () => ({ locked: undefined, keypad: [], cooldown: { state: 'ambiguous', ruleId: 'test_unknown' } }),
        wake: () => {},
        reveal: () => {},
        tap: () => {},
        settle: () => {},
      },
    });
    assertEq(unknown.recovered, false, '判不出不得宣称就绪');
    assertEq(unknown.reason, 'unknown', '判不出须与"确认锁屏"区分——否则 uitest 不可用会误报设备阻断');
  });

  run(results, 'P1：**四个边界在 blocked 时设备命令零执行**（不是只记日志）', () => {
    // review 三轮：上一版四处都只 `logLines.push(note)` 然后照常 install/aa start。
    // 这里逐个边界断言"blocked 分支里没有设备命令，且有明确的阻断出口"。
    const boundaries: Array<{ file: string; blockedBranch: RegExp; forbidden: RegExp[] }> = [
      {
        file: path.join('providers', 'device-test-install.ts'),
        blockedBranch: /if \(preReady\.blocked\) \{[\s\S]*?\n    \} else \{/,
        forbidden: [/installHap\(/, /runHdc/],
      },
      {
        file: path.join('providers', 'device-test-run.ts'),
        blockedBranch: /let pre = preReady\.blocked[\s\S]*?runAaStartPreflight\(opts\.bundleName, pageName, opts\.deviceSn, logPath\);/,
        // 三元的 true 分支里不得出现真正的 aa start 调用
        forbidden: [],
      },
      {
        file: 'app-snapshot-warmup.ts',
        blockedBranch: /if \(preReady\.blocked\) \{[\s\S]*?\n  \}/,
        forbidden: [/runWarmupOnce\(/],
      },
      {
        file: 'hdc-runner.ts',
        blockedBranch: /if \(preReady\.blocked\) \{[\s\S]*?\n    \}\n  \}/,
        forbidden: [/installHap\(/, /runAaTest\(/],
      },
    ];
    for (const b of boundaries) {
      const code = executableCode(path.join(PROFILE_HARNESS, b.file));
      const m = b.blockedBranch.exec(code);
      assert(m !== null, `${b.file}：应能定位 blocked 分支（前检必须是硬前置）`);
      for (const bad of b.forbidden) {
        assert(!bad.test(m![0]), `${b.file}：blocked 分支内不得出现设备命令 ${bad}`);
      }
      // 阻断必须产出可被上游归类的结论，而不是静默继续
      assert(
        /device_locked|blocked/i.test(m![0]),
        `${b.file}：阻断须产出 device_locked 结论（供 externalBlocked/device_blocked 归类）`,
      );
    }

    // testing run 的三元分支：blocked 时走的是常量对象，不调 runAaStartPreflight
    const runCode = executableCode(path.join(PROFILE_HARNESS, 'providers', 'device-test-run.ts'));
    assert(
      /let pre = preReady\.blocked\s*\n\s*\? \{[\s\S]*?\}\s*\n\s*: runAaStartPreflight\(/.test(runCode),
      'testing run：blocked 时不得调用 runAaStartPreflight',
    );
    assert(
      /let lockedAndUnrecovered = preReady\.blocked;/.test(runCode),
      'testing run：前检阻断须直接进入 device_locked 分类',
    );
  });

  run(results, 'P1：install 前检**不可被卸载重装分支穿透**（上一版有两条穿透路径）', () => {
    const code = executableCode(path.join(PROFILE_HARNESS, 'providers', 'device-test-install.ts'));

    // ① 前检必须排在降级卸载**之前**——上一版 runUninstallOnce() 在前检之前就执行了
    const preIdx = code.indexOf('bridge.ensureReadyBefore(opts.projectRoot)');
    const downgradeUninstallIdx = code.indexOf('if (downgradeDetected && uninstallBefore) {');
    assert(preIdx >= 0, '应能定位前检调用');
    assert(downgradeUninstallIdx >= 0, '应能定位降级卸载分支');
    assert(
      preIdx < downgradeUninstallIdx,
      '前检必须排在降级卸载之前——否则明确阻断前已经把应用卸了',
    );

    // ② blocked 分支之后的**公共重试**不得再执行设备变更。
    //    上一版的穿透就在这里：`if (!install.ok && uninstallBefore && !uninstallAttempted)`
    //    在 blocked（install.ok=false）时照样 bm uninstall + installHap。
    const blockedBranch = /if \(preReady\.blocked\) \{[\s\S]*?\n    \} else \{/.exec(code);
    assert(blockedBranch !== null, '应能定位 blocked 分支');
    assert(!/installHap\(|runUninstallOnce\(/.test(blockedBranch![0]), 'blocked 分支内不得有设备命令');

    // 公共重试必须落在 else（设备可用）分支内，且额外排除 device_locked
    const elseBranch = /\} else \{\n      if \(downgradeDetected && uninstallBefore\)[\s\S]*$/.exec(code);
    assert(elseBranch !== null, '设备可用分支应能定位');
    assert(
      /if \(!install\.ok && uninstallBefore && !uninstallAttempted\n\s*&& install\.diagnosis\?\.kind !== 'device_locked'\) \{/.test(
        elseBranch![0],
      ),
      '公共重试须排除 device_locked——恢复失败后设备还锁着，不得卸载重装',
    );
    // 该重试块**不得**出现在 blocked 分支可达的位置
    const retryIdx = code.indexOf("&& install.diagnosis?.kind !== 'device_locked') {");
    const elseIdx = code.indexOf('} else {\n      if (downgradeDetected && uninstallBefore)');
    assert(retryIdx > elseIdx && elseIdx > 0, '公共重试必须在"设备可用"分支之内');
  });

  run(results, 'P1：install 的 device_locked **能到达** external_block（不被重新探测覆盖）', () => {
    const checkTesting = executableCode(
      path.join(__dirname, '..', '..', '..', '..', '..', 'harness', 'scripts', 'check-testing.ts'),
    );
    // provider 的诊断必须被传进来，且优先于 diagnoseInstallBlocking 的重新探测——
    // 后者只看 HDC 在线性与版本，"手机连着但锁屏"会被判成 clear
    assert(
      /installDiagnosisKind\?: string,/.test(checkTesting),
      'buildDeviceInstallFailResults 须接收 provider 侧诊断',
    );
    assert(
      /res\.install\?\.diagnosis\?\.kind,/.test(checkTesting),
      '装机失败时须把 provider 诊断传进结论构造',
    );
    const priority = /if \(installDiagnosisKind === 'device_locked'\) \{[\s\S]*?\n  \}/.exec(checkTesting);
    assert(priority !== null, 'device_locked 须有独立分支');
    assert(
      /failure_kind: 'device_blocked'/.test(priority![0]) &&
        /blocking_class: 'externalBlocked'/.test(priority![0]),
      'device_locked 须产出 externalBlocked/device_blocked（goal 据此归 external_block）',
    );
    // 该分支必须在重新探测**之前**
    const kindIdx = checkTesting.indexOf("if (installDiagnosisKind === 'device_locked')");
    const rediagIdx = checkTesting.indexOf('const diag = diagnoseInstallBlocking(ctx.projectRoot);');
    assert(kindIdx > 0 && kindIdx < rediagIdx, 'provider 诊断须优先于重新探测');
  });

  run(results, 'P1：桥不可用时 recoverAfterLockFailure **不得**报 recovered:true', () => {
    const code = executableCode(path.join(PROFILE_HARNESS, 'device-recovery-bridge.ts'));
    // ensureReadyBefore 的 catch 返回 ready:true 只表示"没做检查"，
    // 若 recoverAfterLockFailure 照搬，调用方会误以为设备已恢复而重试原操作
    assert(
      /if \(\/检查不可用\/\.test\(r\.note\)\) return \{ recovered: false/.test(code),
      '桥不可用须回 recovered:false（否则后置恢复会把它解释成恢复成功并重试）',
    );
    assert(
      /if \(!r\.ready \|\| r\.blocked\) return \{ recovered: false/.test(code),
      '未就绪或确认阻断都不得报恢复成功',
    );
  });

  run(results, '桥：未指定目标时不动手（对未知设备操作比不操作更危险）', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const bridge = require('../../device-recovery-bridge') as typeof import('../../device-recovery-bridge');
    /* eslint-enable @typescript-eslint/no-require-imports */
    withEnv({ HARNESS_HDC_TARGET: undefined }, () => {
      const pre = bridge.ensureReadyBefore(process.cwd(), null);
      assertEq(pre.ready, true, '无目标时不拦截正常流程');
      assert(/未显式指定目标/.test(pre.note), pre.note);
      const rec = bridge.recoverAfterLockFailure(process.cwd(), null);
      assertEq(rec.recovered, false, '无目标时不做恢复');
      assert(/不对未知目标做恢复/.test(rec.note), rec.note);
    });
  });

  return results;
}
