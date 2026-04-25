// ============================================================================
// git-diff.ts
// ============================================================================
// 轻量封装 `git diff --name-only <base>..HEAD` 用于：
//   - check-ut.ts  ut_no_src_mutation BLOCKER（检测 Skill 5 阶段未授权的业务
//                  源码改动）。
//
// 设计要点：
//   - 使用 spawnSync 避免 PowerShell 拼接问题；
//   - 支持回退 baseRef：优先用 `trace.json.start_commit`，无则用 HEAD~1；
//   - 业务源码目录集由调用方传入（硬编码在 check-ut.ts 中：
//     02-Feature/**/src/main, 01-Business, 00-Common 等）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface GitDiffResult {
  /** git 命令是否成功执行 */
  executed: boolean;
  /** 使用的 baseRef */
  baseRef: string;
  /** baseRef 是否是回退值（没有 trace.start_commit 时 = true） */
  baseIsFallback: boolean;
  /** 被改动的文件列表（相对项目根，正斜杠） */
  changedFiles: string[];
  /** 原始错误信息（若 executed=false） */
  error?: string;
}

export interface TraceLike {
  start_commit?: string;
  [k: string]: unknown;
}

/**
 * 从 reports/<feature>/<phase>/trace.json 或 harness 其他位置加载 start_commit。
 * 找不到时返回 undefined，让调用方走 HEAD~1 回退。
 */
export function readTraceStartCommit(tracePath: string): string | undefined {
  if (!fs.existsSync(tracePath)) return undefined;
  try {
    const raw = fs.readFileSync(tracePath, 'utf-8');
    const json = JSON.parse(raw) as TraceLike;
    if (json.start_commit && typeof json.start_commit === 'string') {
      return json.start_commit;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface GitDiffOpts {
  /** 项目根（cwd） */
  projectRoot: string;
  /** baseRef（如 start_commit SHA）；缺省时回退 HEAD~1 */
  baseRef?: string;
  /** 限定的路径前缀（glob 或目录相对路径），传给 git diff `-- <pathspec>` */
  pathspecs?: string[];
}

/**
 * 对工作区 + staged 做 diff（含 staged/unstaged/untracked）。
 * 流程：
 *   1. git diff --name-only <base>...HEAD  → committed 变更
 *   2. git diff --name-only HEAD          → unstaged 变更
 *   3. git diff --name-only --cached      → staged 变更
 *   4. git ls-files --others --exclude-standard  → untracked 新文件
 *   合并去重后返回。
 *
 * 若 <base> 不存在（即无有效 commit），自动回退 HEAD~1；再失败则视为空初始库，
 * 只比较 HEAD vs 工作区。
 */
export function diffChangedFiles(opts: GitDiffOpts): GitDiffResult {
  const cwd = opts.projectRoot;
  const pathspecs = opts.pathspecs ?? [];
  const pathspecArgs = pathspecs.length > 0 ? ['--', ...pathspecs] : [];

  // 先决：cwd 是否是 git 仓库
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd, encoding: 'utf-8', shell: false,
  });
  if (probe.status !== 0) {
    return {
      executed: false,
      baseRef: '',
      baseIsFallback: false,
      changedFiles: [],
      error: `非 git 仓库或 git 不可用：${probe.stderr?.trim() ?? ''}`,
    };
  }

  // 解析 baseRef：优先使用传入，其次 HEAD~1
  let baseRef = opts.baseRef ?? '';
  let baseIsFallback = false;
  if (!baseRef) {
    baseRef = 'HEAD~1';
    baseIsFallback = true;
  }
  const verify = spawnSync('git', ['rev-parse', '--verify', baseRef], {
    cwd, encoding: 'utf-8', shell: false,
  });
  if (verify.status !== 0) {
    // 比如全新初始化的仓库，HEAD~1 不存在 → 退到空树（相当于对比 HEAD）
    baseRef = 'HEAD';
    baseIsFallback = true;
  }

  const all = new Set<string>();

  // 1. commits since baseRef
  const commit = spawnSync(
    'git',
    ['diff', '--name-only', `${baseRef}..HEAD`, ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (commit.status === 0 && commit.stdout) {
    commit.stdout.split(/\r?\n/).filter(Boolean).forEach(f => all.add(f));
  }

  // 2. unstaged working-tree changes
  const wt = spawnSync(
    'git',
    ['diff', '--name-only', 'HEAD', ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (wt.status === 0 && wt.stdout) {
    wt.stdout.split(/\r?\n/).filter(Boolean).forEach(f => all.add(f));
  }

  // 3. staged changes
  const staged = spawnSync(
    'git',
    ['diff', '--name-only', '--cached', ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (staged.status === 0 && staged.stdout) {
    staged.stdout.split(/\r?\n/).filter(Boolean).forEach(f => all.add(f));
  }

  // 4. untracked files
  const untracked = spawnSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (untracked.status === 0 && untracked.stdout) {
    untracked.stdout.split(/\r?\n/).filter(Boolean).forEach(f => all.add(f));
  }

  return {
    executed: true,
    baseRef,
    baseIsFallback,
    changedFiles: Array.from(all).map(f => f.replace(/\\/g, '/')).sort(),
  };
}

/**
 * 基于一组"受保护目录前缀"过滤出落入保护范围的变更文件。
 * 典型 protectedPrefixes：['02-Feature/', '01-Business/', '00-Common/']
 * 同时**排除**测试目录：`/src/ohosTest/` 与 `/test/`（这些是 UT 合法工作区）。
 */
export function filterBusinessSourceChanges(
  changedFiles: string[],
  protectedPrefixes: string[],
): string[] {
  return changedFiles.filter(f => {
    const normalized = f.replace(/\\/g, '/');
    if (!protectedPrefixes.some(p => normalized.startsWith(p))) return false;
    // 排除 ohosTest / test 目录
    if (/\/src\/ohosTest\//.test(normalized)) return false;
    if (/\/test\//.test(normalized)) return false;
    // 只看 src/main 下的文件（业务源码；资源文件等也计入）
    if (normalized.includes('/src/main/')) return true;
    // 00-Common / 01-Business / 02-Feature 层的顶层子文件无 src/main 但也属于业务
    // 这里放宽：只要不是 test/ohosTest 就计入
    return true;
  });
}

/**
 * 读取 gap-notes.md 里的 approved_src_mutations[] 清单。
 * 返回被授权的文件路径集合（相对项目根的正斜杠路径）。
 *
 * 兼容两种格式：
 *  (a) YAML code block：```yaml\napproved_src_mutations:\n  - file: "..."\n    ...\n```
 *  (b) bullet list：`- file: "..."` 形式
 */
export function readApprovedMutations(gapNotesPath: string): Set<string> {
  const approved = new Set<string>();
  if (!fs.existsSync(gapNotesPath)) return approved;
  const text = fs.readFileSync(gapNotesPath, 'utf-8');

  // 抓 `file: "..."` 或 `file: '...'` 或 `file: path` 行
  // 注意：只在 approved_src_mutations 段落内计入，避免误抓其它段落
  const sectionMatch = text.match(/approved_src_mutations\s*:\s*([\s\S]*?)(?=\n##\s|\n---|\n$)/i);
  if (!sectionMatch) return approved;
  const section = sectionMatch[1];
  const fileRe = /^\s*-?\s*file\s*:\s*["']?([^"'\n]+?)["']?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(section)) !== null) {
    const p = m[1].trim();
    // 跳过模板里的注释示例（`# - file: "..."` 形式会被注释符过滤）
    if (p.startsWith('#') || p === '') continue;
    approved.add(p.replace(/\\/g, '/'));
  }
  return approved;
}
