本清单只追踪已批准计划中的规范冲突及直接验收；代码实施状态以 plan frontmatter 为准。

- [x] 1. 收敛现行棘轮完成样本定义，保留已有终态完成要求、倍率、上限及预算钳制。
- [x] 2. 为非零清理完成与 waiting/exit0 增加直接规范场景，不复制既有能力或新增运行机制。
- [x] 3. 运行共享完成、棘轮及实际运输目标回归；集中 `cd harness && npm test` 后记录结果。
- [x] 4. 执行 `npm run openspec:validate`、plan 校验、diff 与 LF 检查。

本次用户授权明确禁打包，故不执行通用发布步骤 `npm run release:verify`（该命令会隐式 pack）；此项未验证，不以其它检查冒充。发布时仍须遵守仓库正式发布门禁。
