# 工程环境探测（只读）

本文件供 `00-framework-init` 中的 AI 执行**只读扫描**时参考。不要跳过；探测结果用表格给用户确认。

## 1. Framework 资产是否存在

- 路径：`<repo-root>/framework/harness/harness-runner.ts`
- 若缺失：停止初始化，提示 `git submodule` 或拷贝 framework。

## 2. 项目身份

- 读取 `oh-package.json5`（若存在）：`name`、`version`、包类型线索。
- 读取 `build-profile.json5`（若存在）：`modules[].srcPath` → 物理模块路径列表。

## 3. 仓库根第一层目录

识别常见模式并打标签（可多选）：

| 模式 | 特征 | 对架构 DSL 的暗示 |
|------|------|-------------------|
| 五层钱包式 | 存在 `01-Product`、`02-Feature`、… | 推荐 wallet 5 外层 preset |
| 扁平特性 | `entry`、`features`、`common` 等 | 可能适合 3 层或自定义 |
| 已接 framework | 已有 `framework.config.json` | UPDATE 模式 |

## 4. Submodule

- 若存在 `.gitmodules` 且含 `framework` 路径 → 注明「framework 可能为 submodule」。
- 若 `framework/.git` 为文件（gitlink）→ 同上。

## 5. 已有文档

- 若存在 `doc/architecture.md`（或 `paths.architecture_md` 将指向的路径）：摘要是否已描述层级；**不**自动信任旧文，需与用户核对是否仍适用。

## 6. Agent 痕迹（仅提示，不强制）

**只做启发、不得替代用户对 `adapter_name` 的显式选定**——具体指纹与建议表见：

- [framework/agents/README.md](../../../agents/README.md) 中「工程指纹与 adapter 推测」

输出要求：用简体中文列「探测结论 + 推荐 default」，避免超过约 40 行。
