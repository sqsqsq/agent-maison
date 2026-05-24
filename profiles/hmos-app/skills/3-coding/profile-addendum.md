# `hmos-app` · Skill `3-coding` profile addendum

本工程 `project_profile=hmos-app` 时，编码阶段以 **ArkTS / ArkUI** 为默认宿主形态，并启用 DevEco / hvigor / `.ets` / HAR-HAP 等资源与模块约定。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| ArkTS 弱模型易错点 | `skills/3-coding/reference/arkts-pitfalls.md`（相对本 profile 根：`framework/profiles/hmos-app/`） |
| ArkUI 模式速查 | `skills/3-coding/reference/arkui-patterns.md` |
| API 指引 | `skills/3-coding/reference/harmony-api-guide.md` |
| 编码规范全文 | `skills/3-coding/templates/coding-standards.md` |
| 模块脚手架 | `skills/3-coding/templates/module-scaffold.md` |

### skill-assets.yaml 键

根 `SKILL.md` 使用 `` `profile-skill-asset:3-coding/<键>` `` 时，与机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml` 对应如下：

| 键 | 相对 `skills/3-coding/` |
|----|-------------------------|
| `coding_standards` | `templates/coding-standards.md` |
| `module_scaffold` | `templates/module-scaffold.md` |
| `arkts_pitfalls` | `reference/arkts-pitfalls.md` |
| `arkui_patterns` | `reference/arkui-patterns.md` |
| `harmony_api_guide` | `reference/harmony-api-guide.md` |

`framework/skills/3-coding/` 下同名路径为**跳板**（仅指针），勿在跳板内追加条款。

## Harness 与 toolchain

- **真实编译 / UT / 真机**相关能力由 `framework/profiles/hmos-app/profile.yaml` → `capabilities` 与 `phase-rules-overlays` 声明；脚本层见 `framework/harness/capability-registry.ts`。
- **hvigor / hdc** 实现位于 `framework/profiles/hmos-app/harness/`（`framework/harness/scripts/utils/*-runner` 为 re-export shim）。
- 写 `.ets` 文件前，先按变更类型阅读 `arkts-pitfalls.md` 相关条目；尤其关注 `@State` 初始化、`$r()` 资源引用、`ForEach keyGenerator`、`Router vs NavPathStack`、HAR `Index.ets` 导出。
- 模块配置与依赖通常落在 `build-profile.json5` / `oh-package.json5` / `module.json5`；新增 HAR/HAP 或调整依赖时必须与 `contracts.yaml`、`doc/architecture.md` 和 `framework.config.json` 对齐。
- 跨模块导出入口文件名由 `architecture.cross_module_exports_file` 声明（以 `framework.config.json` 为准，默认 `index.ets`）；**物理路径**以各模块 `oh-package.json5` → `main` 为准，不固定为 `src/main/ets/`。

## Context Exploration Gate（profile 补充）

编码前探索须覆盖：**`build-profile.json5` / `oh-package.json5` / 涉及模块的 `module.json5`**；**页面注册**（`main_pages.json`、`route_map.json` 等，以工程实际为准）、**资源目录**（`src/main/resources`）与 **各 HAR 模块 oh-package `main` 指向的导出入口文件**（或 DSL 声明的 `cross_module_exports_file`）中与本轮改动相关的条目。真实工程 layout 以 oh-package main 为准；虚拟工程示例中的 `src/main/ets/` 仅为一种合法布局。

## 与中立骨架的关系

- `framework/specs/phase-rules/coding-rules.yaml` 仅保留 **profile 中立骨架**；鸿蒙细则由 `framework/profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml` 合并补齐。

## 业务编排（形态 B/C 与 A 的方法体）禁用 import（BLOCKER）

下列符号 **不得** 出现在业务编排源文件的 import 中（含仅类型引用），即便仅用于类型亦然：

```
@Component, @Entry, @Preview, @Builder, @State, @Prop, @Link（形态 A 仅允许用于 struct 自身 UI 状态声明，不得流入业务方法内的数据模型）
NavPathStack, NavDestination, NavPathInfo from @kit.ArkUI
$r, $rawfile, getUIContext, getContext, UIContext, PromptAction
AppStorage, LocalStorage
showToast, Toast 等 Toast 辅助函数
```

> **形态 A（Page 命名方法）**：方法可读写 `this.xxx`（struct 状态），但方法体内调用的下层函数与传入 data 层的参数须为**普通数据模型**；Toast / 路由 / 弹框等 UI 副作用在返回后由 UI 层翻译（如 `@Watch`）。

## 路由与页面注册

- 产品壳（如 `Phone`）中的 `Navigation` 需注册各功能模块的 **`NavDestination`** 页面。
- 使用系统路由表时，在对应模块 `resources/base/profile/` 下维护 **`route_map.json`**。
- 新增页面须同步 **`main_pages.json`**、字符串 / 颜色等资源，与设计 `contracts.yaml` 一致。

### 示例（仅在 hmos-app 下）

根 SKILL 中为保持 profile-neutral 已删去的具体形态，在此保留速查：

- **页面注册与资源清单**：常见涉及 `main_pages.json`、`route_map.json`、各 `resources/base/element/*.json` 等（以模块实际路径为准）。
- **壳入口**：产品壳常见使用 `@Entry` 装饰的入口组件 + Feature 侧路由页。
- **资源引用**：字符串等常见写法如 `$r('app.string.xxx')`，须与资源定义一致。
