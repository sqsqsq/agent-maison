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
  parseHypiumStdout,
  findOhosTestSignedHap,
  loadAppBundleName,
  loadOhosTestModuleName,
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
  // findOhosTestSignedHap
  // --------------------------------------------------------------------------
  {
    name: 'findOhosTestSignedHap: 约定命名 <srcModule>-ohosTest-signed.hap 命中',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/WalletMain';
      const hapDir = path.join(root, srcPath, 'build', 'default', 'outputs', 'ohosTest');
      const expected = path.join(hapDir, 'WalletMain-ohosTest-signed.hap');
      writeFile(expected, 'fake hap');
      const found = findOhosTestSignedHap(root, srcPath, 'WalletMain');
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
      const srcPath = '02-Feature/WalletMain';
      const hapDir = path.join(root, srcPath, 'build', 'product', 'outputs', 'ohosTest');
      const expected = path.join(hapDir, 'WalletMain-ohosTest-signed.hap');
      writeFile(expected, 'fake hap');
      const found = findOhosTestSignedHap(root, srcPath, 'WalletMain', 'product');
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
  // loadOhosTestModuleName
  // --------------------------------------------------------------------------
  {
    name: 'loadOhosTestModuleName: 标准 ohosTest module.json5 → 返回 module.name',
    run: () => withTmpDir(root => {
      const srcPath = '02-Feature/WalletMain';
      writeFile(
        path.join(root, srcPath, 'src', 'ohosTest', 'module.json5'),
        '{ "module": { "name": "walletmain_test", "type": "feature" } }',
      );
      assertEq(loadOhosTestModuleName(root, srcPath), 'walletmain_test', 'module.name');
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
