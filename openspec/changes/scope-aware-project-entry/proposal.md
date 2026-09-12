## Why

P4/P5 需要真实的无 Feature 专项入口，现有 harness 仍在进入 checker 前要求 Feature 身份。§3.1–3.2 专项入口及 P4/P5 已通过，本批继续完成已定稿 P6 项目级能力与统一用户入口。

## What Changes

- 在现有 harness CLI 增加 request-file/report-dir/prepare-request 分支。
- 复用 P1 输入与 facts，冻结实际目标和解析后的 Git 基线。
- 共享 checker 接收明确 request subject，复用报告、检查和既有 profile/provider 边界，禁止落入 Feature 完成链。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-contracts`: 无 Feature 请求输入与 checker 上下文。
- `workflow-tracks`: 专项请求完成边界和隔离报告落点。
- `code-graph-entrypoints`: 模块来源复用、局部生成/校验与可选策展终点。

## Impact

影响 harness-runner、输入解析、review/UT/testing 入口、报告序列化和专项调用说明。扩展项目局部校验、Graph 来源复用、自然语言职责边界与各 adapter 共享入口说明；复用已通过的 P4/P5。既有 Feature CLI 不变，无发布默认切换，MIGRATION.md 随 P7 汇总。
