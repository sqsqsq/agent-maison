// hmos-app：业务 git diff / 变更门禁中排除的测试工作区路径（正则以正斜杠路径匹配）

export const diffExcludeTestPathRegexes: RegExp[] = [/\/src\/ohosTest\//, /\/test\//];
