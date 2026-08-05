// ============================================================================
// adhoc-input-path — 即席 CLI 的 --plan / --steps-file 路径解析
// ----------------------------------------------------------------------------
// 先试 cwd（agent 常从 framework/harness 起跑），再试 projectRoot；
// **两个候选都必须落在 projectRoot 内**，逃出者一律拒绝。
//
// 为什么补这条：此前本函数**完全没有包含性检查**，最后一行 `return fromCwd` 直接把
// `path.resolve(process.cwd(), userPath)` 返回，`--steps-file ../../x.json` 就读到工程外。
// 更糟的是配套用例名叫「does not escape projectRoot via ..」，却是靠**当前目录深度**
// 巧合通过的：断言写死「结果不含 `D:\doc\`」，而返回值取决于 cwd 距盘符几层——
// 仓库根（2 层）跑必红、`harness/`（3 层，`npm test` 的规范 cwd）跑必绿。
// 于是这条"保护"从来没被真正验证过，而代码里根本不存在它。假绿的典型形态。
//
// 绝对路径同样受约束：只拦 `..` 而放行绝对路径逃逸等于安全表演；且文档里
// `--plan` / `--steps-file` 的用法一律是工程内路径
// （skills/reference/device-testing-workflow-detail.md），没有跨工程用例。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { isInsideProjectRoot } from './project-relative-path';

export function resolveAdhocInputPath(projectRoot: string, userPath: string): string {
  const p = userPath.trim();
  if (!p) return p;
  const root = path.resolve(projectRoot);
  const candidates = path.isAbsolute(p)
    ? [path.normalize(p)]
    // cwd 优先是既有行为（agent 常从 framework/harness 起跑，用 `../../doc/...` 指工程内产物）
    : [path.resolve(process.cwd(), p), path.resolve(root, p)];

  const inRoot = candidates.filter(c => isInsideProjectRoot(root, c));
  if (inRoot.length === 0) {
    throw new Error(
      `[adhoc-input-path] 路径逃出工程根：${userPath}\n` +
      `  projectRoot: ${root}\n` +
      `  解析候选：${candidates.join('  |  ')}\n` +
      '  --plan / --steps-file 只接受 projectRoot 内的路径。',
    );
  }
  // 存在者优先；都不存在时回落到**工程内**的第一个候选——报错信息才指向有意义的位置
  return inRoot.find(c => fs.existsSync(c)) ?? inRoot[0];
}
