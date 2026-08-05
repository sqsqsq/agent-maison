// ============================================================================
// project-relative-path — 实例根下相对路径安全校验
// ============================================================================

import * as path from 'path';

/**
 * 绝对路径 `abs` 是否落在 `root` 内。
 *
 * **不得写成 `rel.startsWith('..')`**：那会把工程内合法的 `..notes/x.json`（文件名以点
 * 开头）误判成越界。只有 `rel === '..'` 或以 `..<sep>` 开头才是真的往上跳。
 */
export function isInsideProjectRoot(root: string, abs: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // 跨盘符
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/** 校验相对路径落在 projectRoot 内（拒绝绝对路径、盘符与 `..` 段）。 */
export function validateProjectRelativePath(
  projectRoot: string,
  relPath: string,
  label: string,
): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) {
    throw new Error(`[project-relative-path] ${label} 不能为空`);
  }
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`[project-relative-path] ${label} 必须是相对 project-root 的安全路径`);
  }
  if (normalized.split('/').some(seg => seg === '..')) {
    throw new Error(`[project-relative-path] ${label} 不得包含 ".." 段`);
  }
  if (!isInsideProjectRoot(projectRoot, path.resolve(projectRoot, normalized))) {
    throw new Error(`[project-relative-path] ${label} 必须落在 project-root 内`);
  }
  return normalized;
}
