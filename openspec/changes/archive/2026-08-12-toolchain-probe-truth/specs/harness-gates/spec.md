# Delta: Harness Gates — hvigor 错误码证据分层诊断

## ADDED Requirements

### Requirement: Evidence-tiered hvigor error classification

hvigor build 链失败 MUST 按错误码结构化分类：00303217 MUST 归 sdk_home_missing_or_invalid（并提示 framework 调用链已自动派生 DEVECO_SDK_HOME）；00303168 MUST 归 sdk_component_missing（中性事实）；仅当同时取得 SDK manifest 格式/SDK 版本/hvigor 版本证据时才 MAY 升级为 sdk_layout_or_version_incompatible_suspected 并给出装配套 SDK/降级 hvigor/IDE 编译三选一指引。诊断 MUST 头部化（details 首行 ≤180 字，经共享 diagnostic util），构建日志移后。

#### Scenario: 无证据不得断言不兼容
- **WHEN** hvigor 报 00303168 而 SDK manifest/版本证据未取得
- **THEN** 诊断输出 sdk_component_missing 与取证指引，不得出现"版本不兼容"断言

#### Scenario: 诊断不埋日志尾
- **WHEN** compile 失败 details 含 5KB 构建日志
- **THEN** 首行即结构化诊断头（错误码+归类+下一步），日志在其后

> **Enforced by:** `profiles/hmos-app/harness/hvigor-runner.ts`, 共享 diagnostic util
