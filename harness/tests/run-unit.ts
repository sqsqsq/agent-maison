// ============================================================================
// run-unit.ts — Framework Harness 单元测试 runner
// ============================================================================
//
// 与 run-tests.ts 的区别：
//   - run-tests.ts：扫 fixtures/，对 framework checker 跑端到端断言
//   - run-unit.ts ：直接 import 工具函数（hdc-runner / spec-loader 等的纯函数），
//                   做白盒级断言，DevEco / hypium 升级时第一时间挂出来
//
// 用法（在仓库根）：
//   npx ts-node framework/harness/tests/run-unit.ts
//   npx ts-node framework/harness/tests/run-unit.ts --filter parseHypium
//
// 退出码：0 全部通过；1 至少一个用例失败。
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';
import type { UnitCaseResult } from './unit/hdc-runner.unit.test';

const SUITES: Array<{ id: string; modulePath: string }> = [
  { id: 'hdc-runner',     modulePath: './unit/hdc-runner.unit.test' },
  { id: 'doc-freshness',  modulePath: './unit/doc-freshness.unit.test' },
  { id: 'detect-product', modulePath: './unit/detect-product.unit.test' },
  { id: 'hvigor-args',    modulePath: './unit/hvigor-args.unit.test' },
];

interface SuiteSummary {
  id: string;
  results: UnitCaseResult[];
}

function main(): void {
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : undefined;

  console.log('\nFramework Harness Unit Tests\n');
  console.log('='.repeat(72));

  const summaries: SuiteSummary[] = [];

  for (const suite of SUITES) {
    const fullPath = path.resolve(__dirname, suite.modulePath + '.ts');
    if (!fs.existsSync(fullPath)) {
      console.log(`  [SKIP] suite ${suite.id} 不存在：${fullPath}`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(suite.modulePath) as { runAll: () => UnitCaseResult[] };
    if (typeof mod.runAll !== 'function') {
      console.log(`  [FAIL] suite ${suite.id} 未导出 runAll()`);
      summaries.push({ id: suite.id, results: [{ name: '<suite-load>', ok: false, error: '未导出 runAll()' }] });
      continue;
    }
    const all = mod.runAll();
    const filtered = filter ? all.filter(r => r.name.includes(filter)) : all;
    summaries.push({ id: suite.id, results: filtered });
  }

  console.log('');
  let totalPass = 0;
  let totalFail = 0;
  for (const s of summaries) {
    const passed = s.results.filter(r => r.ok).length;
    const failed = s.results.length - passed;
    totalPass += passed;
    totalFail += failed;
    console.log(`Suite [${s.id}]  PASS=${passed}  FAIL=${failed}`);
    for (const r of s.results) {
      if (r.ok) {
        console.log(`  PASS  ${r.name}`);
      } else {
        console.log(`  FAIL  ${r.name}`);
        if (r.error) {
          for (const line of r.error.split('\n')) {
            console.log(`        ${line}`);
          }
        }
      }
    }
    console.log('');
  }

  console.log('='.repeat(72));
  console.log(`\n结果：${totalPass} passed, ${totalFail} failed (共 ${totalPass + totalFail})\n`);

  process.exit(totalFail > 0 ? 1 : 0);
}

main();
