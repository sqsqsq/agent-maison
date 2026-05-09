# `hmos-app` · Skill `3-coding` profile addendum

本工程 `project_profile=hmos-app` 时，编码阶段以 **ArkTS / ArkUI** 为默认宿主形态，并启用 DevEco / hvigor / `.ets` / HAR-HAP 等资源与模块约定。

## 权威资产路径（已迁入本 profile）

| 用途 | 路径 |
|------|------|
| ArkTS 弱模型易错点 | `skills/3-coding/reference/arkts-pitfalls.md`（相对本 profile 根：`framework/profiles/hmos-app/`） |
| ArkUI 模式速查 | `skills/3-coding/reference/arkui-patterns.md` |
| API 指引 | `skills/3-coding/reference/harmony-api-guide.md` |
| 编码规范全文 | `skills/3-coding/templates/coding-standards.md` |
| 模块脚手架 | `skills/3-coding/templates/module-scaffold.md` |

`framework/skills/3-coding/` 下同名路径为**跳板**（仅指针），勿在跳板内追加条款。

## Harness 与 toolchain

- **真实编译 / UT / 真机**相关能力由 `framework/profiles/hmos-app/profile.yaml` → `capabilities` 与 `phase-rules-overlays` 声明；脚本层见 `framework/harness/capability-registry.ts`。
- **hvigor / hdc** 实现位于 `framework/profiles/hmos-app/harness/`（`framework/harness/scripts/utils/*-runner` 为 re-export shim）。
- 写 `.ets` 文件前，先按变更类型阅读 `arkts-pitfalls.md` 相关条目；尤其关注 `@State` 初始化、`$r()` 资源引用、`ForEach keyGenerator`、`Router vs NavPathStack`、HAR `Index.ets` 导出。
- 模块配置与依赖通常落在 `build-profile.json5` / `oh-package.json5` / `module.json5`；新增 HAR/HAP 或调整依赖时必须与 `contracts.yaml`、`doc/architecture.md` 和 `framework.config.json` 对齐。
- 跨模块导出入口文件名由 `architecture.cross_module_exports_file` 声明；本 profile 默认是 `Index.ets`。

## 与中立骨架的关系

- `framework/specs/phase-rules/coding-rules.yaml` 仅保留 **profile 中立骨架**；鸿蒙细则由 `framework/profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml` 合并补齐。
