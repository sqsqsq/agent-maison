// ============================================================================
// path-candidates.ts — 缺失文件的 basename 候选检索（t1c，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 场景：contracts.yaml files 路径前缀与物理路径不一致（2.3.0 宿主反馈：计划路径缺
// `02-Feature/FinancialCard/` 前缀）时，file_completeness 只报"缺失"无法定位真因。
// 本模块在 architecture 声明的层目录内做**一次共享遍历**，按 basename 收集候选真实
// 位置，供报错附「疑似前缀不一致，实际存在于 X」诊断。只提示不改判定。
//
// 开销约束：单次遍历、跳过依赖/产物目录、访问文件数硬上限——超限即截断返回已收集结果
// （诊断是 best-effort，绝不拖慢门禁）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'oh_modules',
  '.git',
  '.hvigor',
  'build',
  'dist',
  '.preview',
  '.cxx',
  '.idea',
]);

export interface BasenameCandidateOptions {
  /** 遍历访问的文件数硬上限（默认 20000）——超限截断，best-effort */
  maxVisitedFiles?: number;
  /** 每个 basename 最多收集的候选数（默认 3） */
  maxCandidatesPerName?: number;
}

/**
 * 在 projectRoot 下指定的层目录内检索给定 basename 的真实位置。
 * @returns basename → 相对 projectRoot 的候选路径列表（正斜杠）
 */
export function findBasenameCandidates(
  projectRoot: string,
  layerDirs: string[],
  basenames: string[],
  options: BasenameCandidateOptions = {},
): Map<string, string[]> {
  const maxVisited = options.maxVisitedFiles ?? 20000;
  const maxPerName = options.maxCandidatesPerName ?? 3;
  const wanted = new Set(basenames);
  const found = new Map<string, string[]>();
  if (wanted.size === 0 || layerDirs.length === 0) return found;

  let visited = 0;
  const stack: string[] = [];
  for (const dir of layerDirs) {
    const abs = path.join(projectRoot, dir);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) stack.push(abs);
  }

  while (stack.length > 0 && visited < maxVisited) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (visited >= maxVisited) break;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(ent.name)) stack.push(full);
        continue;
      }
      visited += 1;
      if (!wanted.has(ent.name)) continue;
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
      const list = found.get(ent.name) ?? [];
      if (list.length < maxPerName) {
        list.push(rel);
        found.set(ent.name, list);
      }
    }
  }
  return found;
}

/**
 * 把候选检索结果格式化为可附加到 file_completeness details 的诊断行；无候选返回 null。
 */
export function formatPrefixMismatchHint(
  missing: string[],
  candidates: Map<string, string[]>,
): string | null {
  const lines: string[] = [];
  for (const rel of missing) {
    const hits = candidates.get(path.basename(rel));
    if (!hits || hits.length === 0) continue;
    // 与声明路径完全一致的命中不可能出现（missing 前提），列出即为"别处存在"。
    lines.push(`  - ${rel} → 疑似路径前缀不一致，同名文件实际存在于：${hits.join('、')}`);
    if (lines.length >= 10) break;
  }
  if (lines.length === 0) return null;
  return `疑似前缀不一致诊断（只提示不改判定）：\n${lines.join('\n')}\n请核对 contracts.yaml files 的路径前缀与物理布局（计划路径应与仓库真实目录逐段一致）。`;
}
