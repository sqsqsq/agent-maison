// ============================================================================
// project-relative-path — 实例根下相对路径安全校验
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';

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

const toSlash = (p: string): string => p.replace(/\\/g, '/');
const isRecordedAbsolute = (p: string): boolean => /^(?:[A-Za-z]:)?\//.test(toSlash(p));

/**
 * plan b2d7f4e9 t4：绑定依赖 `dependencies[].path` 由 `capability-resolution.ts` 的 `dependency()`
 * 按**写入时的工程根**记成绝对路径，并进入范围指纹与修订链——写入格式与指纹一律不动，只在读侧解析：
 * 相对路径按 `projectRoot` 拼；绝对路径在 `projectRoot` 内原样；在外且给了 `legacyRoot`（写入时的根）
 * 则把该前缀换成 `projectRoot`（`\` 与 `/` 都认，盘符路径按 Windows 规则大小写不敏感）。
 * 返回值不做越界放行：调用方照旧用 `isInsideProjectRoot` 判定，重定位后仍在外即 stale。
 */
export function resolveDependencyPath(projectRoot: string, recordedPath: string, legacyRoot?: string): string {
  if (!isRecordedAbsolute(recordedPath)) return path.resolve(projectRoot, recordedPath);
  if (!legacyRoot || (path.isAbsolute(recordedPath) && isInsideProjectRoot(projectRoot, recordedPath))) return recordedPath;
  const recorded = toSlash(recordedPath);
  const base = toSlash(legacyRoot).replace(/\/+$/, '');
  const windowsLike = /^[A-Za-z]:\//.test(base);
  const hit = windowsLike ? recorded.toLowerCase().startsWith(base.toLowerCase() + '/') : recorded.startsWith(base + '/');
  return hit ? path.resolve(projectRoot, ...recorded.slice(base.length + 1).split('/')) : recordedPath;
}

const legacyRootCache = new WeakMap<object, Map<string, string | undefined>>();

/**
 * 从一份已记录的范围（或任意含 `path` / `*_path` 路径字段的记录）推出写入时的工程根：落在
 * `projectRoot` 外的绝对路径里 `/<features_dir>/` 段每处出现的前缀都是候选旧根；唯一候选即取，多个候选取
 * 重定位后依赖在当前工程内存在最多者；无候选或并列返回 undefined（如实 stale，不猜）。每个记录对象只推一次。
 */
export function inferLegacyProjectRoot(projectRoot: string, recorded: unknown): string | undefined {
  if (!recorded || typeof recorded !== 'object') return undefined;
  const perRoot = legacyRootCache.get(recorded) ?? new Map<string, string | undefined>();
  legacyRootCache.set(recorded, perRoot);
  if (perRoot.has(projectRoot)) return perRoot.get(projectRoot);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
  const marker = '/' + toSlash(loadFrameworkConfig(projectRoot).paths.features_dir).replace(/^\.?\/+|\/+$/g, '') + '/';
  // 记录路径的字段约定：`dependencies[].path` 与证据文档里的 `*_path`（如 device-test-evidence 的 trace_path）。
  const recordedPaths: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, p] of Object.entries(value)) {
      if (typeof p !== 'string') { visit(p); continue; }
      if ((key !== 'path' && !key.endsWith('_path')) || !isRecordedAbsolute(p) || (path.isAbsolute(p) && isInsideProjectRoot(projectRoot, p))) continue;
      recordedPaths.push(p);
    }
  };
  visit(recorded);
  // 旧根本身可能含 features 段（如 `D:/archives/doc/features/host`）：marker 的每处出现都是候选旧根。
  const candidates = new Map<string, string>();
  for (const p of recordedPaths) {
    const slashed = toSlash(p);
    for (let idx = slashed.indexOf(marker); idx > 0; idx = slashed.indexOf(marker, idx + 1)) {
      const root = p.slice(0, idx);
      const key = /^[A-Za-z]:\//.test(slashed) ? toSlash(root).toLowerCase() : toSlash(root);
      if (!candidates.has(key)) candidates.set(key, root);
    }
  }
  let found: string | undefined;
  if (candidates.size === 1) found = [...candidates.values()][0];
  else if (candidates.size > 1) {
    // 用已知依赖确认：重定位后在当前工程内存在者最多的候选胜出；并列（含全为 0）不可判 → undefined（如实 stale）。
    const scored = [...candidates.values()].map(root => ({ root, hits: recordedPaths.filter(p => {
      const moved = resolveDependencyPath(projectRoot, p, root);
      return isInsideProjectRoot(projectRoot, moved) && fs.existsSync(moved);
    }).length })).sort((a, b) => b.hits - a.hits);
    if (scored[0].hits > scored[1].hits) found = scored[0].root;
  }
  perRoot.set(projectRoot, found);
  return found;
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

/** Resolve existing ancestors first so a not-yet-created report directory cannot hide a junction. */
export function realProjectPath(projectRoot: string, relative: string, label: string): string {
  const safe = validateProjectRelativePath(projectRoot, relative, label);
  let parent = path.resolve(projectRoot, safe);
  const suffix: string[] = [];
  while (!fs.existsSync(parent)) { suffix.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) throw new Error(`${label}: no existing ancestor`); parent = next; }
  if (suffix.length && !fs.statSync(parent).isDirectory()) throw new Error(`${label}: parent is not a directory`);
  const actual = path.join(fs.realpathSync(parent), ...suffix);
  if (!isInsideProjectRoot(fs.realpathSync(projectRoot), actual)) throw new Error(`${label}: outside project through a link`);
  return actual;
}
