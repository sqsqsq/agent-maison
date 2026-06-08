// ============================================================================
// git-diff.ts
// ============================================================================
// 轻量封装 `git diff --name-only <base>..HEAD` 用于：
//   - check-ut.ts  ut_no_src_mutation BLOCKER（检测 business-ut 阶段未授权的业务
//                  源码改动）。
//
// 设计要点：
//   - 使用 spawnSync 避免 PowerShell 拼接问题；
//   - baseRef 未传时默认 **working**（只统计相对 HEAD 的工作区/暂存/未跟踪，与日常感知一致）；
//     需要包含「已提交但未 push 的 commits」时用 HARNESS_DIFF_BASE_REF=HEAD~1 或具体 SHA；
//   - 业务源码目录集由调用方传入（如 UT 红线使用的受保护前缀）。
//   - 测试工作区路径排除由 filterBusinessSourceChanges 的 opts.excludeTestPathRegexes
//     提供（见 project_profile > harness/profile-path-conventions）。
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
  /** baseRef..HEAD 的已提交变更 */
  committedFiles: string[];
  /** HEAD 到工作区的未暂存变更 */
  workingTreeFiles: string[];
  /** 已暂存但未提交的变更 */
  stagedFiles: string[];
  /** 未跟踪文件 */
  untrackedFiles: string[];
  /** 是否只扫描当前工作区（不包含 baseRef..HEAD 历史提交） */
  workingOnly: boolean;
  /** 原始错误信息（若 executed=false） */
  error?: string;
}

export interface DiffStaleness {
  stale: boolean;
  committedCount: number;
  workingSideCount: number;
  reason?: string;
}

export interface TraceLike {
  start_commit?: string;
  [k: string]: unknown;
}

/**
 * 从 reports/<feature>/<phase>/trace.json 或 harness 其他位置加载 start_commit。
 * 找不到时返回 undefined（调用方可能对 diff 另行默认 working）。
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
  /** baseRef（如 start_commit SHA）；传入 "working" 时只比较当前工作区相对 HEAD；缺省时默认即为 working */
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
 * 若传入非 working 的 baseRef 不存在，再失败则视为空初始库，只比较 HEAD vs 工作区。
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
      committedFiles: [],
      workingTreeFiles: [],
      stagedFiles: [],
      untrackedFiles: [],
      workingOnly: false,
      error: `非 git 仓库或 git 不可用：${probe.stderr?.trim() ?? ''}`,
    };
  }

  // 解析 baseRef：显式传入优先；未传入时默认 working（与「git status / 本地改动」感知一致）
  let baseRef = (opts.baseRef ?? '').trim();
  let baseIsFallback = false;
  if (!baseRef) {
    baseRef = 'working';
    baseIsFallback = true;
  }
  const workingOnly = baseRef === 'working';
  if (workingOnly) {
    baseRef = 'HEAD';
  }
  if (!workingOnly) {
    const verify = spawnSync('git', ['rev-parse', '--verify', baseRef], {
      cwd, encoding: 'utf-8', shell: false,
    });
    if (verify.status !== 0) {
      // 比如全新初始化的仓库，HEAD~1 不存在 → 退到空树（相当于对比 HEAD）
      baseRef = 'HEAD';
      baseIsFallback = true;
    }
  }

  const all = new Set<string>();
  const committedFiles = new Set<string>();
  const workingTreeFiles = new Set<string>();
  const stagedFiles = new Set<string>();
  const untrackedFiles = new Set<string>();

  // 1. commits since baseRef
  if (!workingOnly) {
    const commit = spawnSync(
      'git',
      ['diff', '--name-only', `${baseRef}..HEAD`, ...pathspecArgs],
      { cwd, encoding: 'utf-8', shell: false },
    );
    if (commit.status === 0 && commit.stdout) {
      commit.stdout.split(/\r?\n/).filter(Boolean).forEach(f => {
        committedFiles.add(f);
        all.add(f);
      });
    }
  }

  // 2. unstaged working-tree changes
  const wt = spawnSync(
    'git',
    ['diff', '--name-only', 'HEAD', ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (wt.status === 0 && wt.stdout) {
    wt.stdout.split(/\r?\n/).filter(Boolean).forEach(f => {
      workingTreeFiles.add(f);
      all.add(f);
    });
  }

  // 3. staged changes
  const staged = spawnSync(
    'git',
    ['diff', '--name-only', '--cached', ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (staged.status === 0 && staged.stdout) {
    staged.stdout.split(/\r?\n/).filter(Boolean).forEach(f => {
      stagedFiles.add(f);
      all.add(f);
    });
  }

  // 4. untracked files
  const untracked = spawnSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', ...pathspecArgs],
    { cwd, encoding: 'utf-8', shell: false },
  );
  if (untracked.status === 0 && untracked.stdout) {
    untracked.stdout.split(/\r?\n/).filter(Boolean).forEach(f => {
      untrackedFiles.add(f);
      all.add(f);
    });
  }

  const normalizeSorted = (items: Set<string>): string[] =>
    Array.from(items).map(f => f.replace(/\\/g, '/')).sort();

  return {
    executed: true,
    baseRef,
    baseIsFallback,
    changedFiles: normalizeSorted(all),
    committedFiles: normalizeSorted(committedFiles),
    workingTreeFiles: normalizeSorted(workingTreeFiles),
    stagedFiles: normalizeSorted(stagedFiles),
    untrackedFiles: normalizeSorted(untrackedFiles),
    workingOnly,
  };
}

export function analyzeDiffStaleness(diff: GitDiffResult): DiffStaleness {
  const workingSide = new Set([
    ...diff.workingTreeFiles,
    ...diff.stagedFiles,
    ...diff.untrackedFiles,
  ]);
  const committedCount = new Set(diff.committedFiles).size;
  const workingSideCount = workingSide.size;
  const stale =
    !diff.workingOnly &&
    committedCount >= 20 &&
    (workingSideCount === 0 || committedCount > workingSideCount * 5);
  return {
    stale,
    committedCount,
    workingSideCount,
    reason: stale
      ? 'committed 历史差异远多于当前工作区差异，baseRef 很可能早于本轮阶段起点。'
      : undefined,
  };
}

export interface FilterBusinessSourceOpts {
  /**
   * 额外排除：匹配相对路径（正斜杠）的正则列表（由宿主 profile 的 `profile-path-conventions` 等贡献）。
   * 根 harness 不再默认排除任何测试路径；未传时不排除测试目录。
   */
  excludeTestPathRegexes?: RegExp[];
}

/**
 * 基于一组"受保护目录前缀"过滤出落入保护范围的变更文件。
 * 典型 protectedPrefixes：`deriveBusinessSourcePathPrefixes(projectRoot)` 产出（或由调用方传入），
 * 每个值为 `architecture.outer_layers[].id` 规范化为目录前缀；无配置时退回历史默认。
 *
 * **测试工作区排除**由 `excludeTestPathRegexes` 提供（见各 project_profile 的
 * `harness/profile-path-conventions`）；根目录不再硬编码具体宿主路径。
 */
export function filterBusinessSourceChanges(
  changedFiles: string[],
  protectedPrefixes: string[],
  opts?: FilterBusinessSourceOpts,
): string[] {
  const exclude = opts?.excludeTestPathRegexes ?? [];
  return changedFiles.filter(f => {
    const normalized = f.replace(/\\/g, '/');
    if (!protectedPrefixes.some(p => normalized.startsWith(p))) return false;
    if (exclude.some(rx => rx.test(normalized))) return false;
    // 只看 src/main 下的文件（业务源码；资源文件等也计入）
    if (normalized.includes('/src/main/')) return true;
    // 非标准 layout 的工程：前缀匹配已落在某外层目录内的路径也视作业务源码
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
