// ============================================================================
// project-relative-path — 实例根下相对路径安全校验
// ============================================================================

import * as path from 'path';

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
  const abs = path.resolve(projectRoot, normalized);
  const root = path.resolve(projectRoot);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`[project-relative-path] ${label} 必须落在 project-root 内`);
  }
  return normalized;
}
