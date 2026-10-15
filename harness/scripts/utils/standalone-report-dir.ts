import * as path from 'path';
import { isInsideProjectRoot, realProjectPath } from './project-relative-path';
import { requestProtectedPaths } from './capability-resolution-entry-input';

/** 独立操作与 request 使用同一宿主写边界，不借用 Feature 报告目录。 */
export function standaloneReportDir(projectRoot: string, frameworkRoot: string, requested: string): string {
  const dir = realProjectPath(projectRoot, requested, 'report-dir');
  if (path.resolve(dir) === path.resolve(projectRoot)
    || requestProtectedPaths(projectRoot, frameworkRoot).some(root => isInsideProjectRoot(root, dir))) {
    throw new Error('report-dir 必须是宿主内独立目录，不能写入 framework、.git 或 Feature 证据目录');
  }
  return dir;
}
