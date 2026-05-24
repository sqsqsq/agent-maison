// ============================================================================
// oh-package-dependencies.unit.test.ts — oh_package_dependencies 匹配回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isDependencyDeclared } from '../../coding-host-rules';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-package-deps-unit-'));
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
    name: 'oh_package_dependencies: @wallet/common-functions 匹配 CommonFunctions',
    run: () => withTmpDir(root => {
      const ok = isDependencyDeclared(
        { '@wallet/common-functions': 'file:../../05-SystemBase/CommonFunctions' },
        'CommonFunctions',
        '05-SystemBase/CommonFunctions',
        root,
      );
      if (!ok) throw new Error('应通过归一化 dep key 匹配');
    }),
  },
  {
    name: 'oh_package_dependencies: file: 路径匹配目标 package_path',
    run: () => withTmpDir(root => {
      const ok = isDependencyDeclared(
        { '@aspect/CommFunc': 'file:../../05-SystemBase/CommFunc' },
        'CommFunc',
        '05-SystemBase/CommFunc',
        root,
      );
      if (!ok) throw new Error('应通过 file: 路径匹配');
    }),
  },
  {
    name: 'oh_package_dependencies: oh-package name 精确匹配 dep key',
    run: () => withTmpDir(root => {
      writeFile(
        path.join(root, '05-SystemBase/CommFunc/oh-package.json5'),
        '{ "name": "@aspect/CommFunc", "main": "index.ets" }',
      );
      const ok = isDependencyDeclared(
        { '@aspect/CommFunc': 'file:../../05-SystemBase/CommFunc' },
        'CommFunc',
        '05-SystemBase/CommFunc',
        root,
      );
      if (!ok) throw new Error('应通过目标模块 oh-package name 匹配');
    }),
  },
  {
    name: 'oh_package_dependencies: 无关依赖不应误匹配',
    run: () => withTmpDir(root => {
      const ok = isDependencyDeclared(
        { '@wallet/unrelated-lib': 'file:../../99-Other/Unrelated' },
        'CommonFunctions',
        '05-SystemBase/CommonFunctions',
        root,
      );
      if (ok) throw new Error('无关 dep 不应匹配 CommonFunctions');
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
