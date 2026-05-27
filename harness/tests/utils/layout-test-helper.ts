import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext } from '../../scripts/utils/types';
import { detectRepoLayout, inferRepoLayout, type RepoLayout } from '../../repo-layout';

const DEFAULT_LAYOUT = detectRepoLayout(__dirname);

/** consumer 形 tmp host：补最小 framework 树供 inferRepoLayout */
export function ensureConsumerFrameworkTree(hostRoot: string): void {
  fs.mkdirSync(path.join(hostRoot, 'framework', 'workflows'), { recursive: true });
}

/** standalone 形 tmp：补最小 framework 树 */
export function ensureStandaloneFrameworkTree(root: string): void {
  fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
}

/** 单测/ fixture 构造 CheckContext 时补齐 layout 字段（当前 checkout standalone） */
export function withDefaultLayoutFields<T extends Partial<CheckContext>>(
  ctx: T,
): T & Pick<CheckContext, 'frameworkRoot' | 'frameworkRel' | 'harnessRoot' | 'layoutKind'> {
  return {
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    ...ctx,
  };
}

/** tmp host projectRoot 的 layout 字段（consumer 形） */
export function layoutFieldsForHost(
  projectRoot: string,
): Pick<CheckContext, 'frameworkRoot' | 'frameworkRel' | 'harnessRoot' | 'layoutKind'> {
  ensureConsumerFrameworkTree(projectRoot);
  const layout = inferRepoLayout(projectRoot);
  return {
    frameworkRoot: layout.frameworkRoot,
    frameworkRel: layout.frameworkRel,
    harnessRoot: path.join(layout.frameworkRoot, 'harness'),
    layoutKind: layout.kind,
  };
}

/** tmp host + 仓外 frameworkRoot（无 framework 树，layoutKind=standalone） */
export function externalStandaloneLayout(
  projectRoot: string,
  frameworkRoot: string = DEFAULT_LAYOUT.frameworkRoot,
): RepoLayout {
  return {
    kind: 'standalone',
    projectRoot: path.resolve(projectRoot),
    frameworkRoot: path.resolve(frameworkRoot),
    frameworkRel: '',
  };
}

export { DEFAULT_LAYOUT };
