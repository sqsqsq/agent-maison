// ============================================================================
// har-index-export.unit.test.ts — HAR 导出入口路径解析回归
// ============================================================================
//
// 覆盖内网真实问题：har_index_export 不能硬编码为
// <package_path>/src/main/ets/index.ets。Harmony HAR 的实际入口位置应优先以
// oh-package.json5 的 main 字段为准，但入口文件名仍必须符合 framework 的
// cross_module_exports_file 约定。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveHarExportEntryPath } from '../../har-export-resolve';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'har-index-export-unit-'));
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

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'har_index_export: 优先使用 oh-package main 指向模块根入口',
    run: () => withTmpDir(root => {
      writeFile(path.join(root, '02-Feature/SwipeCard/oh-package.json5'), `{
        "main": "index.ets"
      }`);

      const actual = resolveHarExportEntryPath(root, {
        name: 'SwipeCard',
        package_path: '02-Feature/SwipeCard',
      }, 'index.ets');

      assertEq(actual, {
        relPath: '02-Feature/SwipeCard/index.ets',
        source: 'oh-package.json5 main',
      }, '应按 oh-package main 定位模块根入口');
    }),
  },
  {
    name: 'har_index_export: 支持 oh-package main 指向 src/main/ets/index.ets',
    run: () => withTmpDir(root => {
      writeFile(path.join(root, '02-Feature/FinancialCard/oh-package.json5'), `{
        "main": "src/main/ets/index.ets"
      }`);

      const actual = resolveHarExportEntryPath(root, {
        name: 'FinancialCard',
        package_path: '02-Feature/FinancialCard',
      }, 'index.ets');

      assertEq(actual, {
        relPath: '02-Feature/FinancialCard/src/main/ets/index.ets',
        source: 'oh-package.json5 main',
      }, '应按 oh-package main 定位 src/main/ets 下的 index.ets');
    }),
  },
  {
    name: 'har_index_export: 拒绝 oh-package main 指向非 index.ets 入口',
    run: () => withTmpDir(root => {
      writeFile(path.join(root, '02-Feature/FinancialCard/oh-package.json5'), `{
        "main": "src/main/ets/Main.ets"
      }`);

      const actual = resolveHarExportEntryPath(root, {
        name: 'FinancialCard',
        package_path: '02-Feature/FinancialCard',
      }, 'index.ets');

      assertEq(actual, {
        relPath: '02-Feature/FinancialCard/src/main/ets/Main.ets',
        source: 'oh-package.json5 main',
        error: 'FinancialCard: oh-package.json5 main 指向 src/main/ets/Main.ets，但架构约定 HAR 导出入口文件名必须是 index.ets',
      }, '非 index.ets 入口应被标为架构违规');
    }),
  },
  {
    name: 'har_index_export: 无 oh-package main 时回退默认 index.ets 路径',
    run: () => withTmpDir(root => {
      const actual = resolveHarExportEntryPath(root, {
        name: 'WalletMain',
        package_path: '02-Feature/WalletMain',
      }, 'index.ets');

      assertEq(actual, {
        relPath: '02-Feature/WalletMain/src/main/ets/index.ets',
        source: 'framework.config fallback',
      }, '无 oh-package 时应保留默认路径');
    }),
  },
  {
    name: 'har_index_export: oh-package 解析失败时给出 warning 并回退',
    run: () => withTmpDir(root => {
      writeFile(path.join(root, '02-Feature/Broken/oh-package.json5'), `{ "main": "index.ets",`);

      const actual = resolveHarExportEntryPath(root, {
        name: 'Broken',
        package_path: '02-Feature/Broken',
      }, 'index.ets');

      assertEq(actual, {
        relPath: '02-Feature/Broken/src/main/ets/index.ets',
        source: 'framework.config fallback',
        warning: 'Broken: oh-package.json5 解析失败，已回退到默认出口路径',
      }, '解析失败时应显式暴露 warning');
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
