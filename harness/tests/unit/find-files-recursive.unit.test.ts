// ============================================================================
// find-files-recursive.unit.test.ts — 递归文件枚举工具
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findFilesRecursive } from '../../scripts/utils/find-files-recursive';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function withTmpDir<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-files-recursive-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'findFilesRecursive: 不存在的目录返回空数组',
    run: () => {
      const res = findFilesRecursive(path.join(os.tmpdir(), 'definitely-not-here-xyz'), /.*/);
      assert(Array.isArray(res) && res.length === 0, `expected empty, got ${JSON.stringify(res)}`);
    },
  },
  {
    name: 'findFilesRecursive: 命中匹配文件并递归进入子目录',
    run: () => {
      withTmpDir(root => {
        fs.writeFileSync(path.join(root, 'a.json'), '{}', 'utf-8');
        fs.writeFileSync(path.join(root, 'b.txt'), 'x', 'utf-8');
        const sub = path.join(root, 'nested', 'deep');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'c.json'), '{}', 'utf-8');

        const res = findFilesRecursive(root, /\.json$/).map(p => path.basename(p)).sort();
        assert(
          res.length === 2 && res[0] === 'a.json' && res[1] === 'c.json',
          `expected [a.json, c.json], got ${JSON.stringify(res)}`,
        );
      });
    },
  },
  {
    name: 'findFilesRecursive: 无匹配时返回空数组',
    run: () => {
      withTmpDir(root => {
        fs.writeFileSync(path.join(root, 'only.txt'), 'x', 'utf-8');
        const res = findFilesRecursive(root, /\.md$/);
        assert(res.length === 0, `expected empty, got ${JSON.stringify(res)}`);
      });
    },
  },
  {
    name: 'findFilesRecursive: 返回绝对路径',
    run: () => {
      withTmpDir(root => {
        fs.writeFileSync(path.join(root, 'x.log'), 'x', 'utf-8');
        const res = findFilesRecursive(root, /\.log$/);
        assert(res.length === 1 && path.isAbsolute(res[0]), `expected 1 abs path, got ${JSON.stringify(res)}`);
      });
    },
  },
  {
    name: 'findFilesRecursive: 空目录返回空数组',
    run: () => {
      withTmpDir(root => {
        const res = findFilesRecursive(root, /.*/);
        assert(res.length === 0, `expected empty, got ${JSON.stringify(res)}`);
      });
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

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
