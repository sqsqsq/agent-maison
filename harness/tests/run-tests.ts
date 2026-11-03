// ============================================================================
// Framework Harness Regression Test Runner
// ============================================================================
//
// 作用：扫描若干 `tests/fixtures/` 根目录下所有 fixture，依次跑 +
//      断言其 EXPECTED.json，输出汇总结果。
//
// 扫描根：**相对 `framework/` 的列表见 `FIXTURE_TREE_ROOTS_REL_TO_FRAMEWORK`**（须以 harness/tests/fixtures
// subtree 收口；缺失目录自动跳过）。逻辑名锚定见 fixture-runner `fixtureDisplayName`。

// 用法（在仓库根目录）：
//   npx ts-node framework/harness/tests/run-tests.ts
//   npx ts-node framework/harness/tests/run-tests.ts --filter v2_2/ut_tsc
//   KEEP_TMPDIR=1 npx ts-node framework/harness/tests/run-tests.ts   # 保留 fixture tmpdir 供调试
//
// 退出码：0 全部通过；1 至少一个 fixture 断言失败。
// ============================================================================

import './utils/transpile-only-env'; // 须为首个 import：本进程+子进程走 transpile-only（见 plan a7c3e1f9 P0）
// b7e4d2a9 Todo1：第二个 import 必须是 trust 隔离 bootstrap——先于 fixture-runner 等
// 一切可能读 MAISON_GOAL_CHECKPOINT_DIR 的静态加载，无条件覆写到独立临时根。
import { cleanupStrict } from './utils/test-trust-bootstrap';
import { runFixture, FixtureRunResult, fixtureDisplayName } from './utils/fixture-runner';

import { collectAllFixtureDirs } from './utils/fixture-registry';

async function main(): Promise<void> {
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : undefined;

  const fixtures = collectAllFixtureDirs();
  const targets = filter
    ? fixtures.filter(
        f =>
          fixtureDisplayName(f).includes(filter) ||
          f.replace(/\\/g, '/').includes(filter.replace(/\\/g, '/')),
      )
    : fixtures;

  if (targets.length === 0) {
    console.error(`未发现任何 fixture${filter ? `（filter=${filter}）` : ''}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nFramework Harness Regression — 共 ${targets.length} 个 fixture\n`);
  console.log('='.repeat(72));

  const results: FixtureRunResult[] = [];
  for (const dir of targets) {
    const res = await runFixture(dir);
    results.push(res);
    printOne(res);
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;

  console.log('='.repeat(72));
  console.log(`\n结果：${passed} passed, ${failed} failed (共 ${results.length})\n`);

  if (failed > 0) {
    console.log('失败 fixture 详情：');
    for (const r of results) {
      if (r.ok) continue;
      console.log(`\n  [FAIL] ${r.name}`);
      for (const f of r.failures) {
        console.log(`    - ${f}`);
      }
      if (r.tmpdir && process.env.KEEP_TMPDIR) {
        console.log(`    tmpdir 保留：${r.tmpdir}`);
      }
    }
    console.log('');
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

function printOne(r: FixtureRunResult): void {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    console.log(`  FAIL  ${r.name}  (${r.failures.length} 处断言失败)`);
  }
}

void (async () => {
  try {
    await main();
  } catch (err) {
    console.error('test runner 致命错误：', err);
    process.exitCode = 2;
  } finally {
    // b7e4d2a9 Todo1 严格语义：临时 trust 根删不掉=留垃圾——非零退出并打印路径
    const r = cleanupStrict();
    if (!r.ok) {
      console.error(`[test-trust-bootstrap] 临时 trust 根清理失败，遗留：${r.leftoverPath}`);
      process.exitCode = process.exitCode || 1;
    }
  }
})();
