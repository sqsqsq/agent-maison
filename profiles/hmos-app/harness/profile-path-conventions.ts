// hmos-app：业务 git diff / 变更门禁中排除的测试工作区路径（正则以正斜杠路径匹配）

import * as path from 'path';

export const diffExcludeTestPathRegexes: RegExp[] = [/\/src\/ohosTest\//, /\/test\//];

/** HMOS UT source root.  Kept beside the existing test-path convention SSOT. */
export function resolveUtSourceRoots(
  projectRoot: string,
  modules: ReadonlyArray<{ name: string; package_path: string }>,
): string[] {
  return modules.map((module) => path.join(projectRoot, module.package_path, 'src', 'ohosTest'));
}
