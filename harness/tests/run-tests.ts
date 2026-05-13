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

import * as fs from 'fs';
import * as path from 'path';
import { runFixture, FixtureRunResult, fixtureDisplayName } from './utils/fixture-runner';

/** 当前文件在 `framework/harness/tests/` */
const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');

/**
 * 相对 `framework/` 的 Harness fixture 树根；每项须以 …/tests/fixtures 收口。
 * 新增带契约用例的 project_profile 时：在对应 profile 下落目录后 **在此追加一行**。
 */
const FIXTURE_TREE_ROOTS_REL_TO_FRAMEWORK = [
  ['harness', 'tests', 'fixtures'],
  ['profiles', 'hmos-app', 'harness', 'tests', 'fixtures'],
  ['profiles', 'generic', 'harness', 'tests', 'fixtures'],
] as const;

function resolveExistingFixtureRoots(): string[] {
  return FIXTURE_TREE_ROOTS_REL_TO_FRAMEWORK.map(segments =>
    path.join(FRAMEWORK_ROOT, ...segments),
  ).filter(abs => fs.existsSync(abs));
}

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

/** 合并多根扫描；fixtureDisplayName 相同的目录视为重复，阻断（防止双份漂移）。 */
function collectAllFixtureDirs(): string[] {
  const roots = resolveExistingFixtureRoots();
  const dirs = roots.flatMap(r => scanFixtures(r));
  const logicalToDir = new Map<string, string>();
  for (const dir of dirs) {
    const key = fixtureDisplayName(dir);
    const prev = logicalToDir.get(key);
    if (prev !== undefined && prev !== dir) {
      throw new Error(
        `fixture 逻辑路径重复 "${key}"：\n  A: ${prev}\n  B: ${dir}\n仅保留其一。`,
      );
    }
    logicalToDir.set(key, dir);
  }
  return [...logicalToDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, dir]) => dir);
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
