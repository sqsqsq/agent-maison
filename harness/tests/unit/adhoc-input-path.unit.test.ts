// ============================================================================
// adhoc-input-path.unit.test.ts
// ----------------------------------------------------------------------------
// 全部用例**自建临时 projectRoot 并显式 chdir**（finally 还原）——与旧版的关键差别：
// 旧的「does not escape projectRoot via ..」写死 `D:\proj-test-adhoc` 并断言结果不含
// `D:\doc\`，而返回值实际是 `resolve(process.cwd(), '../../doc/x.json')`，成败**只取决于
// 当前目录距盘符几层**：仓库根（2 层）跑红、`harness/`（3 层，npm test 的规范 cwd）跑绿。
// 于是它天天绿，而被断言的保护在代码里根本不存在。本文件的用例不依赖 cwd 深度。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAdhocInputPath } from '../../scripts/utils/adhoc-input-path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

/** 临时宿主：<root>/doc/features/_adhoc/testing/steps.json + <root>/framework/harness */
function setupHost(): { root: string; target: string; harnessCwd: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-path-')));
  const docDir = path.join(root, 'doc', 'features', '_adhoc', 'testing');
  fs.mkdirSync(docDir, { recursive: true });
  const target = path.join(docDir, 'steps.json');
  fs.writeFileSync(target, '[]\n', 'utf-8');
  const harnessCwd = path.join(root, 'framework', 'harness');
  fs.mkdirSync(harnessCwd, { recursive: true });
  return { root, target, harnessCwd };
}

function inCwd<T>(dir: string, fn: () => T): T {
  const prev = process.cwd();
  try {
    process.chdir(dir);
    return fn();
  } finally {
    process.chdir(prev);
  }
}

function expectThrows(fn: () => unknown, mustInclude: string): void {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    const msg = (e as Error).message;
    if (!msg.includes(mustInclude)) {
      throw new Error(`报错信息应点名「${mustInclude}」，实得：${msg}`);
    }
  }
  if (!threw) throw new Error('应当抛错拒绝，实际放行了');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    // 既有合法用法：agent 从 framework/harness 起跑，用 ../../ 指工程内产物——必须保留
    name: 'resolveAdhocInputPath: project-relative from harness cwd（cwd 优先，结果落在工程内）',
    run: () => {
      const { root, target, harnessCwd } = setupHost();
      inCwd(harnessCwd, () => {
        const resolved = resolveAdhocInputPath(root, '../../doc/features/_adhoc/testing/steps.json');
        if (resolved !== path.resolve(target)) {
          throw new Error(`expected ${target}, got ${resolved}`);
        }
      });
    },
  },
  {
    name: 'resolveAdhocInputPath: `..` 逃出工程根 → 抛错拒绝（不依赖 cwd 深度）',
    run: () => {
      const { root, harnessCwd } = setupHost();
      // 从工程内的深目录跑：cwd 候选与 projectRoot 候选**都**在根之外
      inCwd(harnessCwd, () => {
        expectThrows(
          () => resolveAdhocInputPath(root, '../../../../../../../../etc/passwd'),
          '逃出工程根',
        );
      });
      // 换一个更浅的 cwd 复跑同一输入——**结论必须一致**（旧用例正是在这里翻车的）
      inCwd(root, () => {
        expectThrows(
          () => resolveAdhocInputPath(root, '../../../../../../../../etc/passwd'),
          '逃出工程根',
        );
      });
    },
  },
  {
    name: 'resolveAdhocInputPath: 工程外绝对路径 → 同样拒绝（只拦 `..` 是安全表演）',
    run: () => {
      const { root } = setupHost();
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-outside-')));
      const outsideFile = path.join(outside, 'steps.json');
      fs.writeFileSync(outsideFile, '[]\n', 'utf-8');
      inCwd(root, () => {
        expectThrows(() => resolveAdhocInputPath(root, outsideFile), '逃出工程根');
      });
    },
  },
  {
    name: 'resolveAdhocInputPath: 工程内绝对路径照常放行',
    run: () => {
      const { root, target } = setupHost();
      inCwd(root, () => {
        const resolved = resolveAdhocInputPath(root, target);
        if (resolved !== path.resolve(target)) {
          throw new Error(`工程内绝对路径应原样放行，实得 ${resolved}`);
        }
      });
    },
  },
  {
    // 包含性判断的经典误伤：`..notes` 是工程内的合法目录名，不是父目录逃逸。
    // 写成 `rel.startsWith('..')` 就会把它一并拒掉。
    name: 'resolveAdhocInputPath: 工程内以 `..` 开头的合法目录名不得误伤',
    run: () => {
      const { root } = setupHost();
      const dotDir = path.join(root, '..notes');
      fs.mkdirSync(dotDir, { recursive: true });
      const f = path.join(dotDir, 'steps.json');
      fs.writeFileSync(f, '[]\n', 'utf-8');
      inCwd(root, () => {
        const resolved = resolveAdhocInputPath(root, '..notes/steps.json');
        if (resolved !== path.resolve(f)) {
          throw new Error(`合法的 ..notes 目录被误判，实得 ${resolved}`);
        }
      });
      // 绝对路径形态同样不得误伤
      inCwd(root, () => {
        if (resolveAdhocInputPath(root, f) !== path.resolve(f)) {
          throw new Error('绝对路径形态的 ..notes 也被误判');
        }
      });
    },
  },
  {
    name: 'resolveAdhocInputPath: 文件不存在时回落到**工程内**候选（报错信息不得指向工程外）',
    run: () => {
      const { root, harnessCwd } = setupHost();
      inCwd(harnessCwd, () => {
        // 两个候选都不存在：cwd 候选=<root>/framework/harness/nope.json（在根内）
        const resolved = resolveAdhocInputPath(root, 'nope.json');
        const rel = path.relative(root, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`回落值必须仍在工程内，实得 ${resolved}`);
        }
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
