// ============================================================================
// worktree-digest.ts — 产品源码工作区状态摘要（t2 v4，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机（codex 阻断3）：agent 开发常在 dirty worktree——HEAD 不动、源码已改时，
// 旧 PASS summary 仅靠 commit sha 绑定仍可复用。本摘要由 harness 写入 summary，
// check-receipt（slim）重算比对，工作区状态变了旧件即失效。
// v4（codex 第三轮阻断2）修复两处盲区：
//   1. untracked 文件此前只进 status 路径清单——内容从 A 改成 B（路径不变）摘要不变。
//      现用 git ls-files --others 枚举 untracked 文件并**哈希内容**；
//   2. 覆盖范围此前只有 architecture 层目录——根级构建/门禁输入（build-profile.json5、
//      framework.config.json 等）不在绑定内。现固定纳入 ROOT_CONFIG_PATHSPECS
//      （跨 profile 并集；缺失的 pathspec 对 git 无害）。
// v5（codex 第四轮阻断1）：ls-files 必须 -z + NUL 切分——默认 core.quotePath=true 下
// 中文等非 ASCII 路径被引号+八进制转义，readFileSync 转义串必失败 → 恒 unreadable →
// 内容变化不可见（实测中文文件 A→B 摘要不变）。
// v6（codex 第五轮 P1）：故障语义收敛为单一 'unverifiable' 哨兵——任一 git 子命令失败、
// 任一 untracked 文件不可读（持续不可读时内容变化同样不可见，不得折叠成稳定常量）
// 都返回 unverifiable；'no-git' 仅保留"status 失败（非 git 仓/git 坏）"信息值。
// 闭环判定收紧在 check-receipt：**只有两侧都是 16 hex（或双 no-layers）才走相等比较**，
// 其余一律 BLOCKER——no-git===no-git / unverifiable===unverifiable 的假匹配被构造性排除。
// doc/（回执/trace/报告）与 framework/ 的变动仍不在摘要内——agent 正常填回执不自我失效。
// 写读两端（harness-runner / check-receipt）共用本函数，天然同一口径。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

/** 根级构建/门禁输入（跨 profile 并集；对不存在的路径 git pathspec 静默为空，无害） */
const ROOT_CONFIG_PATHSPECS = [
  'framework.config.json',
  'build-profile.json5',
  'oh-package.json5',
  'oh-package-lock.json5',
  'hvigorfile.ts',
  'hvigor',
];

function runGit(projectRoot: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? '' };
}

/** 无法核实哨兵（git 子命令失败 / untracked 文件不可读）——check-receipt 见任一侧非 hex 即 BLOCKER */
export const WORKTREE_DIGEST_UNVERIFIABLE = 'unverifiable';

// 测试缝（仓内先例：__testing_setDetectScanForEnsure）：注入读文件失败模拟"持续不可读"故障
let digestReadFile: (abs: string) => Buffer = abs => fs.readFileSync(abs);
export function __testing_setDigestReadFile(fn: ((abs: string) => Buffer) | null): void {
  digestReadFile = fn ?? (abs => fs.readFileSync(abs));
}

/**
 * @param layerDirs architecture outer_layers 的目录 id 列表；空=无产品层声明 → 'no-layers'
 * @returns 16 hex 摘要；status 失败（非 git 仓/git 坏）→ 'no-git'；
 *          其余 git 子命令失败 / untracked 文件不可读 → 'unverifiable'（fail-closed）
 */
export function computeProductWorktreeDigest(projectRoot: string, layerDirs: string[]): string {
  if (layerDirs.length === 0) return 'no-layers';
  try {
    const pathspecs = [
      ...layerDirs.map(d => d.replace(/\\/g, '/')),
      ...ROOT_CONFIG_PATHSPECS,
    ];
    const status = runGit(projectRoot, ['status', '--porcelain', '--', ...pathspecs]);
    if (!status.ok) return 'no-git';
    const diff = runGit(projectRoot, ['diff', 'HEAD', '--', ...pathspecs]);
    if (!diff.ok) return WORKTREE_DIGEST_UNVERIFIABLE;
    // untracked 文件逐个哈希内容（status 只给路径名——同路径改内容必须可见）。
    // -z=NUL 切分且路径**不加引号转义**（quotePath 默认 true 会把中文等转义成
    // "app/\344..." 形式，readFileSync 必失败）；NUL 切分不得 trim（空格是路径合法字符）。
    const untracked = runGit(projectRoot, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspecs]);
    if (!untracked.ok) return WORKTREE_DIGEST_UNVERIFIABLE;
    const untrackedLines: string[] = [];
    for (const rel of untracked.stdout.split('\0').filter(Boolean).sort()) {
      try {
        const content = digestReadFile(path.join(projectRoot, rel));
        untrackedLines.push(`${rel}=${crypto.createHash('sha256').update(content).digest('hex').slice(0, 12)}`);
      } catch {
        // v6：不可读不得折叠成稳定常量（持续不可读时内容变化不可见）——整体判无法核实
        return WORKTREE_DIGEST_UNVERIFIABLE;
      }
    }
    const payload = [
      status.stdout,
      diff.stdout,
      untrackedLines.join('\n'),
    ].join('\n---\n');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  } catch {
    return WORKTREE_DIGEST_UNVERIFIABLE;
  }
}
