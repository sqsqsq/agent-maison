// ============================================================================
// Framework Harness Regression Test Runner
// ============================================================================
//
// 作用：扫描 framework/harness/tests/fixtures/ 下所有 fixture，依次跑 +
//      断言其 EXPECTED.json，输出汇总结果。
//
// 用法（在仓库根目录）：
//   npx ts-node framework/harness/tests/run-tests.ts
//   npx ts-node framework/harness/tests/run-tests.ts --filter v2_2/ut_tsc
//   KEEP_TMPDIR=1 npx ts-node framework/harness/tests/run-tests.ts   # 保留 fixture tmpdir 供调试
//
// 退出码：0 全部通过；1 至少一个 fixture 断言失败。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { runFixture, FixtureRunResult } from './utils/fixture-runner';

const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures');

async function main(): Promise<void> {
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : undefined;

  const fixtures = scanFixtures(FIXTURES_ROOT);
  const targets = filter ? fixtures.filter(f => f.includes(filter)) : fixtures;

  if (targets.length === 0) {
    console.error(`未发现任何 fixture${filter ? `（filter=${filter}）` : ''}`);
    process.exit(1);
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
    process.exit(1);
  }
  process.exit(0);
}

function scanFixtures(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.some(e => e.name === 'INPUT' && e.isDirectory()) &&
        entries.some(e => e.name === 'CMD.json' && e.isFile())) {
      out.push(dir);
      return; // 不再向下递归（INPUT/ 内部不可能有 fixture）
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return out.sort();
}

function printOne(r: FixtureRunResult): void {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    console.log(`  FAIL  ${r.name}  (${r.failures.length} 处断言失败)`);
  }
}

main().catch(err => {
  console.error('test runner 致命错误：', err);
  process.exit(2);
});
