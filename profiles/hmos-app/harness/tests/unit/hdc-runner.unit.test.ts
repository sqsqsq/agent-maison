// ============================================================================
// hdc-runner.unit.test.ts — v2.3 P2 纯函数单元回归
// ============================================================================
//
// 为什么写这层而不是 fixture 反向注入：
//   v2.3 引入的 BLOCKER（coding_hvigor_build / ut_hvigor_build / ut_hvigor_test）
//   全部依赖真实工具链（hvigor / hdc / 真机），fixture 隔离 tmpdir 里无法复现完整
//   失败路径，只能 mock 整个 spawnSync 输出，价值低。
//
//   真正高回归风险的点是 hdc-runner 里那几个**纯函数**：
//     - parseHypiumStdout：DevEco / hypium 升级时输出格式可能变
//     - findOhosTestSignedHap：DevEco 升级时 hap 命名约定可能变
//     - loadAppBundleName / loadOhosTestModuleName：json5 注释/尾逗号兼容
//
//   把这些用裸 assert 圈住，DevEco 一旦升级把输出/命名改了，本测试立刻挂出来，
//   倒逼 hdc-runner 同步升级。
//
// 用法：
//   npx ts-node framework/harness/tests/run-unit.ts
//   或 cd framework/harness && npm run test:unit
//
// 退出码：本文件本身不直接退出，由 run-unit.ts 汇总后决定。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyAaTestFailure,
  parseHypiumStdout,
  findOhosTestSignedHap,
  discoverOhosTestArtifacts,
  describeOhosTestSignSkipDiagnosis,
  loadAppBundleName,
  loadOhosTestModuleName,
  loadAppInstallCandidateMeta,
  parseInstalledBundleVersionFromDump,
  diagnoseHdcInstallFailure,
  mergeEnvWithHdcOnPath,
  resetHdcExecutableCache,
  buildHdcSpawnOptions,
  HDC_ISOLATED_CWD,
  resolveKillHdcServerPolicy,
  MAISON_KILL_HDC_ON_FINISH_ENV,
  resetHdcUsed,
  isHdcListTargetsProbeOk,
  writeHdcCleanupArtifact,
} from '../../../../../harness/scripts/utils/hdc-runner';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

// ---- 微型断言工具：避免引入外部 test framework ---------------------------------
function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function assertNull(actual: unknown, label: string): void {
  if (actual !== null && actual !== undefined) {
    throw new Error(`${label}\n    expected: null/undefined\n    actual:   ${JSON.stringify(actual)}`);
  }
}
function assertThrows(fn: () => unknown, includes: string, label: string): void {
  try {
    fn();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes(includes)) return;
    throw new Error(`${label}\n    expected error to include: "${includes}"\n    actual error: "${msg}"`);
  }
  throw new Error(`${label}\n    expected throw with "${includes}", but did not throw`);
}
function assertIncludes(actual: string, expected: string, label: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${label}\n    expected to include: "${expected}"\n    actual: "${actual}"`);
  }
}
function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

// ---- 临时目录管理 ------------------------------------------------------------
function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-runner-unit-'));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

// ============================================================================
// 测试用例
// ============================================================================

const cases: Array<{ name: string; run: () => void }> = [
  // --------------------------------------------------------------------------
  // parseHypiumStdout
  // --------------------------------------------------------------------------
  {
    name: 'parseHypiumStdout: 完整 PASS 输出（home-page 实测样本）',
    run: () => {
      const sample = [
        'start ability successfully.',
        '',
        'OHOS_REPORT_SUM: 2',
        'OHOS_REPORT_STATUS: class=HomePageBusinessUT',
        'OHOS_REPORT_STATUS: current=1',
        'OHOS_REPORT_STATUS: id=JS',
        'OHOS_REPORT_STATUS: numtests=2',
        'OHOS_REPORT_STATUS: stream=',
        'OHOS_REPORT_STATUS: test=[AC-1] HomeRepository 返回非空',
        'OHOS_REPORT_STATUS_CODE: 0',
        'OHOS_REPORT_STATUS: consuming=1',
        '',
        'OHOS_REPORT_RESULT: stream=Tests run: 2, Failure: 0, Error: 0, Pass: 2, Ignore: 0',
        'OHOS_REPORT_CODE: 0',
      ].join('\n');
      const r = parseHypiumStdout(sample);
      assertEq(r?.total, 2, 'total');
      assertEq(r?.passed, 2, 'passed');
      assertEq(r?.failed, 0, 'failed');
      assertEq(r?.skipped, 0, 'skipped');
      assertEq(r?.failures.length, 0, 'failures.length');
    },
  },
  {
    name: 'parseHypiumStdout: 含 Failure + Error 列（failed = Failure + Error）',
    run: () => {
      const sample = 'OHOS_REPORT_RESULT: stream=Tests run: 5, Failure: 2, Error: 1, Pass: 2, Ignore: 0';
      const r = parseHypiumStdout(sample);
      assertEq(r?.total, 5, 'total');
      assertEq(r?.passed, 2, 'passed');
      assertEq(r?.failed, 3, 'failed (Failure 2 + Error 1)');
      assertEq(r?.skipped, 0, 'skipped');
    },
  },
  {
    name: 'parseHypiumStdout: 缺省 Ignore 列（hypium 老版本格式）',
    run: () => {
      const sample = 'OHOS_REPORT_RESULT: stream=Tests run: 3, Failure: 0, Error: 0, Pass: 3';
      const r = parseHypiumStdout(sample);
      assertEq(r?.total, 3, 'total');
      assertEq(r?.passed, 3, 'passed');
      assertEq(r?.skipped, 0, 'skipped (缺省视为 0)');
    },
  },
  {
    name: 'parseHypiumStdout: 没有 OHOS_REPORT_RESULT 行 → undefined',
    run: () => {
      const sample = [
        'start ability successfully.',
        'OHOS_REPORT_STATUS: class=Foo',
        'OHOS_REPORT_STATUS_CODE: 1',
      ].join('\n');
      const r = parseHypiumStdout(sample);
      assertEq(r, undefined, '应当返回 undefined（aa test 未跑通）');
    },
  },
  {
    name: 'parseHypiumStdout: 解析失败用例的 suite/test/stack',
    run: () => {
      const sample = [
        'OHOS_REPORT_STATUS: class=MySuite',
        'OHOS_REPORT_STATUS: test=should compute total correctly',
        'OHOS_REPORT_STATUS_CODE: -2',
        'OHOS_REPORT_STATUS: stack=AssertionError: expected 5 to equal 6',
        'OHOS_REPORT_RESULT: stream=Tests run: 1, Failure: 1, Error: 0, Pass: 0, Ignore: 0',
      ].join('\n');
      const r = parseHypiumStdout(sample);
      assertEq(r?.failures.length, 1, 'failures.length');
      assertEq(r?.failures[0].suite, 'MySuite', 'failure.suite');
      assertEq(r?.failures[0].test, 'should compute total correctly', 'failure.test');
      assertEq(
        r?.failures[0].message,
        'AssertionError: expected 5 to equal 6',
        'failure.message',
      );
    },
  },

  // --------------------------------------------------------------------------
  // classifyAaTestFailure
  // --------------------------------------------------------------------------
  {
    name: 'classifyAaTestFailure: 锁屏导致 ability 启动失败 → device_locked',
    run: () => {
      const sample = [
        'error: failed to start ability.',
        'Error Code:10106102  Error Message:The device screen is locked during the application launch, unlock screen failed.',
        'Error cause: The current mode is developer mode, and the screen cannot be unlocked automatically',
        'TestFinished-ResultCode: -3',
      ].join('\n');
      const r = classifyAaTestFailure(sample, 0);
      assertEq(r.kind, 'device_locked', 'kind');
      assertIncludes(r.suggestion, '解锁', 'suggestion should mention unlock');
    },
  },
  {
    name: 'classifyAaTestFailure: ability 启动失败但非锁屏 → ability_start_failed',
    run: () => {
      const sample = [
        'error: failed to start ability.',
        'TestFinished-ResultCode: -3',
      ].join('\n');
      const r = classifyAaTestFailure(sample, 0);
      assertEq(r.kind, 'ability_start_failed', 'kind');
    },
  },
  {
    name: 'classifyAaTestFailure: 无 OHOS_REPORT_RESULT → aa_test_no_result',
    run: () => {
      const r = classifyAaTestFailure('start ability successfully.', 0);
      assertEq(r.kind, 'aa_test_no_result', 'kind');
    },
  },

  // --------------------------------------------------------------------------
  // findOhosTestSignedHap
  // --------------------------------------------------------------------------
  {
    name: 'findOhosTestSignedHap: 约定命名 <srcModule>-ohosTest-signed.hap 命中',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/FeatureAlpha';
      const hapDir = path.join(root, srcPath, 'build', 'default', 'outputs', 'ohosTest');
      const expected = path.join(hapDir, 'FeatureAlpha-ohosTest-signed.hap');
      writeFile(expected, 'fake hap');
      const found = findOhosTestSignedHap(root, srcPath, 'FeatureAlpha');
      assertEq(found, expected, '应命中约定命名');
    }),
  },
  {
    name: 'findOhosTestSignedHap: 约定命名缺失但有同目录 *-signed.hap 兜底',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/Demo';
      const hapDir = path.join(root, srcPath, 'build', 'default', 'outputs', 'ohosTest');
      const fallback = path.join(hapDir, 'OtherName-ohosTest-signed.hap');
      writeFile(fallback, 'fake');
      const found = findOhosTestSignedHap(root, srcPath, 'Demo');
      assertEq(found, fallback, '应兜底返回目录内首个 *-signed.hap');
    }),
  },
  {
    name: 'findOhosTestSignedHap: outputs/ohosTest 目录不存在 → null',
    run: () => withTmpDir(root => {
      const found = findOhosTestSignedHap(root, '02-Feature/Empty', 'Empty');
      assertNull(found, '目录不存在应返回 null');
    }),
  },
  {
    name: 'findOhosTestSignedHap: build/product/outputs/ohosTest 约定命名（非 default product）',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/FeatureAlpha';
      const hapDir = path.join(root, srcPath, 'build', 'product', 'outputs', 'ohosTest');
      const expected = path.join(hapDir, 'FeatureAlpha-ohosTest-signed.hap');
      writeFile(expected, 'fake hap');
      const found = findOhosTestSignedHap(root, srcPath, 'FeatureAlpha', 'product');
      assertEq(found, expected, '应优先命中传入的 product 段');
    }),
  },
  {
    name: 'findOhosTestSignedHap: 未传 product 时扫描 build/* 命中 product 目录',
    run: () => withTmpDir(root => {
      const srcPath = 'mod/A';
      const hapDir = path.join(root, srcPath, 'build', 'product', 'outputs', 'ohosTest');
      const expected = path.join(hapDir, 'A-ohosTest-signed.hap');
      writeFile(expected, 'x');
      const found = findOhosTestSignedHap(root, srcPath, 'A');
      assertEq(found, expected, '应扫描到 build/product/...');
    }),
  },

  // --------------------------------------------------------------------------
  // discoverOhosTestArtifacts / describeOhosTestSignSkipDiagnosis（plan d7e4b2a9 t3）
  // --------------------------------------------------------------------------
  {
    name: 'discoverOhosTestArtifacts: 与 findOhosTestSignedHap 行为等价（薄包装）',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/FeatureAlpha';
      const expected = path.join(root, srcPath, 'build', 'default', 'outputs', 'ohosTest', 'FeatureAlpha-ohosTest-signed.hap');
      writeFile(expected, 'fake hap');
      const viaDiscover = discoverOhosTestArtifacts(root, srcPath, 'FeatureAlpha').signedPath;
      const viaFind = findOhosTestSignedHap(root, srcPath, 'FeatureAlpha');
      assertEq(viaFind, viaDiscover, 'find* 薄包装应与 discover*.signedPath 一致');
      assertEq(viaFind, expected, '且应命中预期路径');
    }),
  },
  {
    name: 'discoverOhosTestArtifacts: 记录同目录 unsignedPath',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/FeatureAlpha';
      const dir = path.join(root, srcPath, 'build', 'default', 'outputs', 'ohosTest');
      writeFile(path.join(dir, 'FeatureAlpha-ohosTest-unsigned.hap'), 'unsigned');
      const result = discoverOhosTestArtifacts(root, srcPath, 'FeatureAlpha');
      assertNull(result.signedPath, '只有 unsigned 时 signedPath 应为 null');
      assertEq(result.unsignedPath, path.join(dir, 'FeatureAlpha-ohosTest-unsigned.hap'), '应记录 unsignedPath');
    }),
  },
  {
    name: 'describeOhosTestSignSkipDiagnosis: unsigned 不存在 → 返回 null（回退通用 "请先 genOnDeviceTestHap" 文案）',
    run: () => {
      const result = describeOhosTestSignSkipDiagnosis({ signedPath: null, unsignedPath: null, scannedDirs: [] });
      assertNull(result, 'unsigned 不存在时不应给出 sign-skip 诊断');
    },
  },
  {
    name: 'describeOhosTestSignSkipDiagnosis: (b) signingConfigMissing=true → 文案含确切归因短语',
    run: () => {
      const discovery = { signedPath: null, unsignedPath: '/x/A-ohosTest-unsigned.hap', scannedDirs: [] };
      const msg = describeOhosTestSignSkipDiagnosis(discovery, { signSkipped: true, signingConfigMissing: true });
      assert(Boolean(msg), '应返回诊断文案');
      assertIncludes(msg!, 'ohosTest HAP 已构建但未发现对应 signed HAP', '应含确定层文案');
      assertIncludes(msg!, 'hvigor 明确报告 signingConfigs 未配置', '(b) 层应含明确归因短语');
    },
  },
  {
    name: 'describeOhosTestSignSkipDiagnosis: (c) 仅 signSkipped=true → 文案含"见构建日志"，不臆测 signingConfigs',
    run: () => {
      const discovery = { signedPath: null, unsignedPath: '/x/A-ohosTest-unsigned.hap', scannedDirs: [] };
      const msg = describeOhosTestSignSkipDiagnosis(discovery, { signSkipped: true, signingConfigMissing: false });
      assertIncludes(msg!, 'hvigor 明确跳过签名，具体原因见构建日志', '(c) 层应指向日志而非臆测');
      if (msg!.includes('hvigor 明确报告 signingConfigs 未配置')) {
        throw new Error('(c) 层不应断言 signingConfigs 未配置（未收到该机读标志）');
      }
    },
  },
  {
    name: 'describeOhosTestSignSkipDiagnosis: (d) 标志未传但 unsigned 存在 → 只给确定层 + 核查建议，不得断言 signingConfigs 未配置',
    run: () => {
      const discovery = { signedPath: null, unsignedPath: '/x/A-ohosTest-unsigned.hap', scannedDirs: [] };
      const msg = describeOhosTestSignSkipDiagnosis(discovery, undefined);
      assertIncludes(msg!, 'ohosTest HAP 已构建但未发现对应 signed HAP', '(d) 层仍应给确定层文案');
      if (msg!.includes('hvigor 明确报告 signingConfigs 未配置')) {
        throw new Error('(d) 层（标志未传）不得断言 signingConfigs 未配置');
      }
      if (msg!.includes('hvigor 明确跳过签名，具体原因见构建日志')) {
        throw new Error('(d) 层不应误用 (c) 层的措辞（没有 signSkipped 标志）');
      }
    },
  },
  {
    name: 'describeOhosTestSignSkipDiagnosis: 矛盾证据——mainAppSignedPath 非空时输出弱证据句（不断言本环境已验证可签名）+ 复用 (b)/(c)/(d) 原因层',
    run: () => {
      const discovery = { signedPath: null, unsignedPath: '/x/A-ohosTest-unsigned.hap', scannedDirs: [] };
      const msg = describeOhosTestSignSkipDiagnosis(discovery, {
        signSkipped: true,
        signingConfigMissing: true,
        mainAppSignedPath: '/x/Phone-product-signed.hap',
      });
      assertIncludes(msg!, '磁盘上检测到已签名的主 HAP', '应提及盘上检测到的主 HAP（弱证据表述）');
      assertIncludes(msg!, '来源未核实', '不得断言来源，需承认不确定性（codex round5）');
      assertIncludes(msg!, 'hvigor 明确报告 signingConfigs 未配置', '原因层应复用 (b) 拼接，不重复造词');
      if (msg!.includes('同一 headless 环境已能执行宿主自定义主 HAP 签名')) {
        throw new Error('不得断言"同一 headless 环境已验证可签名"这类过强因果结论（codex round5 P1）');
      }
      if (msg!.includes('直接原因是 signingConfigs 未配置或自定义任务未覆盖')) {
        throw new Error('不得使用早期版本的写死措辞（round4 已收窄）');
      }
    },
  },
  {
    name: 'describeOhosTestSignSkipDiagnosis: 矛盾证据负例——无主 signed 时不得提及盘上检测到的签名证据',
    run: () => {
      const discovery = { signedPath: null, unsignedPath: '/x/A-ohosTest-unsigned.hap', scannedDirs: [] };
      const msg = describeOhosTestSignSkipDiagnosis(discovery, {
        signSkipped: true,
        signingConfigMissing: true,
        mainAppSignedPath: null,
      });
      if (msg!.includes('磁盘上检测到已签名的主 HAP')) {
        throw new Error('无主 signed 证据时不应提及"盘上检测到已签名主 HAP"');
      }
    },
  },

  {
    name: 'loadAppBundleName: 标准 app.json5 → 返回 bundleName',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'AppScope', 'app.json5'),
        '{\n  "app": {\n    "bundleName": "com.example.demo",\n    "vendor": "x"\n  }\n}',
      );
      assertEq(loadAppBundleName(root), 'com.example.demo', 'bundleName');
    }),
  },
  {
    name: 'loadAppBundleName: 含注释 + 尾逗号（典型 json5）',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'AppScope', 'app.json5'),
        [
          '{',
          '  // 顶级注释',
          '  "app": {',
          '    "bundleName": "com.example.j5", /* 行内 */',
          '    "vendor": "x", // 尾逗号 below',
          '  },',
          '}',
        ].join('\n'),
      );
      assertEq(loadAppBundleName(root), 'com.example.j5', 'bundleName');
    }),
  },
  {
    name: 'loadAppBundleName: 文件不存在 → throw',
    run: () => withTmpDir(root => {
      assertThrows(
        () => loadAppBundleName(root),
        '未找到',
        '应明确告知文件缺失',
      );
    }),
  },
  {
    name: 'loadAppBundleName: bundleName 字段缺失 → throw',
    run: () => withTmpDir(root => {
      writeFile(path.join(root, 'AppScope', 'app.json5'), '{ "app": { "vendor": "x" } }');
      assertThrows(
        () => loadAppBundleName(root),
        'bundleName',
        '错误消息应点出缺失字段',
      );
    }),
  },

  // --------------------------------------------------------------------------
  // loadAppInstallCandidateMeta / parseInstalledBundleVersionFromDump / diagnoseHdcInstallFailure
  // --------------------------------------------------------------------------
  {
    name: 'loadAppInstallCandidateMeta: versionCode 数字 + versionName',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'AppScope', 'app.json5'),
        '{ "app": { "bundleName": "com.example.app", "versionCode": 10002, "versionName": "1.0.2" } }',
      );
      const m = loadAppInstallCandidateMeta(root);
      assertEq(m.bundleName, 'com.example.app', 'bundleName');
      assertEq(m.versionCode, 10002, 'versionCode');
      assertEq(m.versionName, '1.0.2', 'versionName');
    }),
  },
  {
    name: 'loadAppInstallCandidateMeta: versionCode 字符串数字',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'AppScope', 'app.json5'),
        '{ "app": { "bundleName": "com.example.app", "versionCode": "90001" } }',
      );
      const m = loadAppInstallCandidateMeta(root);
      assertEq(m.versionCode, 90001, 'versionCode');
    }),
  },
  {
    name: 'loadAppInstallCandidateMeta: 未声明 versionCode → null',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, 'AppScope', 'app.json5'),
        '{ "app": { "bundleName": "com.example.app" } }',
      );
      const m = loadAppInstallCandidateMeta(root);
      assertEq(m.versionCode, null, 'versionCode 缺失应为 null');
    }),
  },
  {
    name: 'parseInstalledBundleVersionFromDump: JSON 含 versionCode',
    run: () => {
      const dump = '{"bundleName":"com.example.app","versionCode":5000001}\n';
      const p = parseInstalledBundleVersionFromDump(dump);
      assertEq(p.installed, true, 'installed');
      assertEq(p.versionCode, 5000001, 'versionCode');
    },
  },
  {
    name: 'parseInstalledBundleVersionFromDump: 文本混排 versionCode',
    run: () => {
      const dump = [
        'bundleName: com.example.app',
        '"versionCode": 42',
        'hapModuleInfos:',
      ].join('\n');
      const p = parseInstalledBundleVersionFromDump(dump);
      assertEq(p.installed, true, 'installed');
      assertEq(p.versionCode, 42, 'versionCode');
    },
  },
  {
    name: 'parseInstalledBundleVersionFromDump: 未安装提示',
    run: () => {
      const p = parseInstalledBundleVersionFromDump('bundle does not exist on device');
      assertEq(p.installed, false, 'installed');
      assertEq(p.versionCode, null, 'versionCode');
    },
  },
  {
    name: 'diagnoseHdcInstallFailure: downgrade → install_downgrade',
    run: () => {
      const d = diagnoseHdcInstallFailure('install failed: downgrade versionCode lower than installed', 255);
      assertEq(d.kind, 'install_downgrade', 'kind');
      assertIncludes(d.suggestion, 'HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL', '应提示可选 env');
    },
  },
  {
    name: 'diagnoseHdcInstallFailure: signature → install_signature_mismatch',
    run: () => {
      const d = diagnoseHdcInstallFailure('verify signature failed', 1);
      assertEq(d.kind, 'install_signature_mismatch', 'kind');
    },
  },
  {
    name: 'diagnoseHdcInstallFailure: conflict → install_conflict',
    run: () => {
      const d = diagnoseHdcInstallFailure('bundle conflict detected', 1);
      assertEq(d.kind, 'install_conflict', 'kind');
    },
  },
  {
    name: 'diagnoseHdcInstallFailure: 未知 → install_failed',
    run: () => {
      const d = diagnoseHdcInstallFailure('something obscure happened', 9);
      assertEq(d.kind, 'install_failed', 'kind');
    },
  },

  // --------------------------------------------------------------------------
  // loadOhosTestModuleName
  // --------------------------------------------------------------------------
  {
    name: 'loadOhosTestModuleName: 标准 ohosTest module.json5 → 返回 module.name',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/FeatureAlpha';
      writeFile(
        path.join(root, srcPath, 'src', 'ohosTest', 'module.json5'),
        '{ "module": { "name": "featurealpha_test", "type": "feature" } }',
      );
      assertEq(loadOhosTestModuleName(root, srcPath), 'featurealpha_test', 'module.name');
    }),
  },
  {
    name: 'loadOhosTestModuleName: 文件不存在 → throw',
    run: () => withTmpDir(root => {
      assertThrows(
        () => loadOhosTestModuleName(root, '02-Feature/Missing'),
        '未找到',
        '应明确告知文件缺失',
      );
    }),
  },
  {
    name: 'loadOhosTestModuleName: module.name 字段缺失 → throw',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/Bad';
      writeFile(
        path.join(root, srcPath, 'src', 'ohosTest', 'module.json5'),
        '{ "module": { "type": "feature" } }',
      );
      assertThrows(
        () => loadOhosTestModuleName(root, srcPath),
        'module.name',
        '错误消息应点出缺失字段',
      );
    }),
  },

  // --------------------------------------------------------------------------
  // mergeEnvWithHdcOnPath — Hypium 子进程 PATH 注入
  // --------------------------------------------------------------------------
  {
    name: 'mergeEnvWithHdcOnPath: HARNESS_HDC_EXE 存在时 prepend toolchains 到 PATH',
    run: () => withTmpDir(root => {
      const hdcDir = path.join(root, 'toolchains');
      fs.mkdirSync(hdcDir, { recursive: true });
      const hdcExe = path.join(hdcDir, process.platform === 'win32' ? 'hdc.exe' : 'hdc');
      fs.writeFileSync(hdcExe, '');
      const prevExe = process.env.HARNESS_HDC_EXE;
      process.env.HARNESS_HDC_EXE = hdcExe;
      resetHdcExecutableCache();
      try {
        const merged = mergeEnvWithHdcOnPath({ PATH: '/usr/bin' });
        assertIncludes(merged.PATH ?? '', hdcDir, 'PATH should prepend toolchains');
        if (process.platform === 'win32') {
          assertIncludes(merged.Path ?? '', hdcDir, 'Path should prepend toolchains on win32');
        }
      } finally {
        if (prevExe === undefined) {
          delete process.env.HARNESS_HDC_EXE;
        } else {
          process.env.HARNESS_HDC_EXE = prevExe;
        }
        resetHdcExecutableCache();
      }
    }),
  },
  {
    name: 'buildHdcSpawnOptions: cwd is isolated (not framework/harness)',
    run: () => {
      const opts = buildHdcSpawnOptions('hdc', { timeout: 5000 });
      assertEq(opts.cwd, HDC_ISOLATED_CWD, 'cwd');
      assert(!String(opts.cwd).includes('framework'), 'cwd must not be under framework');
      assertEq(opts.encoding, 'utf-8', 'encoding');
    },
  },
  {
    name: '十轮 P0：buildHdcSpawnOptions env 剥离信任锚（HDC 可由 HARNESS_HDC_EXE 指定=宿主可控）',
    run: () => {
      const prev = {
        k1: process.env.MAISON_HMAC_GOAL_CHECKPOINT,
        k2: process.env.MAISON_TRUST_REGISTRY,
        k3: process.env.MAISON_GOAL_CHECKPOINT_DIR,
      };
      process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'secret';
      process.env.MAISON_TRUST_REGISTRY = '/r';
      process.env.MAISON_GOAL_CHECKPOINT_DIR = '/cp';
      try {
        const env = buildHdcSpawnOptions('hdc').env as NodeJS.ProcessEnv;
        assert(env !== undefined, 'env 必须显式设置（不再默认继承完整 process.env）');
        assert(env.MAISON_HMAC_GOAL_CHECKPOINT === undefined, 'HDC env 不得含 HMAC 密钥');
        assert(env.MAISON_TRUST_REGISTRY === undefined, 'HDC env 不得含 registry 路径');
        assert(env.MAISON_GOAL_CHECKPOINT_DIR === undefined, 'HDC env 不得含 checkpoint 路径');
      } finally {
        if (prev.k1 === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prev.k1;
        if (prev.k2 === undefined) delete process.env.MAISON_TRUST_REGISTRY; else process.env.MAISON_TRUST_REGISTRY = prev.k2;
        if (prev.k3 === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prev.k3;
      }
    },
  },
  {
    name: 'isHdcListTargetsProbeOk: requires exit 0 and no spawn error',
    run: () => {
      assert(isHdcListTargetsProbeOk({ status: 0, error: undefined }), 'ok probe');
      assert(!isHdcListTargetsProbeOk({ status: 1, error: undefined }), 'nonzero');
      assert(!isHdcListTargetsProbeOk({ status: 0, error: new Error('timeout') }), 'error');
    },
  },
  {
    name: 'writeHdcCleanupArtifact: writes hdc-cleanup.json with policy fields',
    run: () => {
      withTmpDir((dir) => {
        const written = writeHdcCleanupArtifact(dir, {
          attempted: false,
          ok: true,
          exitCode: null,
          error: null,
          policy: { shouldKill: false, source: 'dev_default' },
          used: true,
          skipped_reason: 'policy_disabled',
        });
        assert(written !== null, 'written path');
        const payload = JSON.parse(fs.readFileSync(path.join(dir, 'hdc-cleanup.json'), 'utf-8')) as {
          used: boolean;
          policy: { source: string };
          skipped_reason: string;
        };
        assertEq(payload.used, true, 'used');
        assertEq(payload.policy.source, 'dev_default', 'policy');
        assertEq(payload.skipped_reason, 'policy_disabled', 'skip');
      });
    },
  },
  {
    name: 'resolveKillHdcServerPolicy: env override beats defaults',
    run: () => {
      const prev = process.env[MAISON_KILL_HDC_ON_FINISH_ENV];
      const prevCi = process.env.CI;
      try {
        delete process.env.CI;
        process.env[MAISON_KILL_HDC_ON_FINISH_ENV] = '1';
        const on = resolveKillHdcServerPolicy();
        assertEq(on.shouldKill, true, 'env on');
        assertEq(on.source, 'env', 'env source');
        process.env[MAISON_KILL_HDC_ON_FINISH_ENV] = '0';
        const off = resolveKillHdcServerPolicy();
        assertEq(off.shouldKill, false, 'env off');
      } finally {
        if (prev === undefined) delete process.env[MAISON_KILL_HDC_ON_FINISH_ENV];
        else process.env[MAISON_KILL_HDC_ON_FINISH_ENV] = prev;
        if (prevCi === undefined) delete process.env.CI;
        else process.env.CI = prevCi;
        resetHdcUsed();
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
