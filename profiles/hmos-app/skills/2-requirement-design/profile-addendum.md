# `hmos-app` · Skill `2-requirement-design` profile addendum

宿主默认技术栈：**ArkTS / ArkUI、模块分层 outer_layers + shared→presentation、跨模块导出入口文件名由 DSL `cross_module_exports_file` 定义**。

### hmos-app 设计约定

- 常见模块格式为 `HAP` / `HAR`，模块配置通常涉及 `build-profile.json5`、`oh-package.json5`、`module.json5`。
- 实现文件通常为 `.ets`，数据模型与接口签名必须使用 ArkTS 合法类型。
- 模块内部常见目录为 `shared/`、`data/`、`domain/`、`presentation/`，跨模块导出入口文件名以 `framework.config.json > architecture.cross_module_exports_file` 为准。
- UI 设计可使用 ArkUI 组件术语（如 `Column`、`Row`、`List`、`Tabs`、`Navigation`），但 design 的 scope、contracts 与 architecture 仍以实例 SSOT 为准。

## Context Exploration Gate（profile 补充）

设计前除中立 SKILL 要求外，建议结合：**工程根 `build-profile.json5`**（模块列表与 `srcPath`）、各相关模块 **`module.json5`**、**`oh-package.json5`**；路由与页面注册参见下文「presentation / 路由」中的 **`main_pages.json` / `route_map.json`**（若启用），避免凭记忆臆造入口文件名。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| design 规则 overlay | `framework/profiles/hmos-app/phase-rules-overlays/design-rules.overlay.yaml`（由 harness 与中立 `design-rules.yaml` 合并消费） |
| 设计阶段模板/示例（宿主相关） | 见下文 skill-assets 键表与本目录 `templates/`、`examples/` |

设计中 **architecture_impact、dsl_change、contracts.yaml** 的写法须同时满足：`doc/architecture.md`、中立阶段规则与被合并 overlay 条目。

### skill-assets.yaml 键

机器清单：`framework/profiles/hmos-app/skills/skill-assets.yaml`。根 `SKILL.md` 使用 `` `profile-skill-asset:2-requirement-design/<键>` ``：

| 键 | 相对 `skills/2-requirement-design/` |
|----|---------------------------------------|
| `design_template` | `templates/design-template.md` |
| `api_spec_template` | `templates/api-spec.md` |
| `data_model_template` | `templates/data-model.md` |
| `example_design` | `examples/example-design.md` |

### 示例（仅在 hmos-app 下）

根 `framework/skills/2-requirement-design/SKILL.md` 中述及的 **Navigation + `NavPathStack` + `NavDestination` 页面容器**、**`@Prop` / `@Link` / `@ObjectLink`** 等，均以本 addendum 下文「presentation / 路由」为准，避免在中立 SKILL 正文中写死宿主专名。

## presentation / 路由（ArkUI 细节）

- **典型页面容器**：Feature 模块 `presentation/pages/` 内常见 **`NavDestination`** 页面；产品壳模块（如 `Phone`）侧配合 **`Navigation` + `NavPathStack`**。
- **组件树描述**可使用 ArkUI 状态装饰器术语（`@State` / `@Prop` / `@Link` / `@ObjectLink`、`LazyForEach` 等），与 **profile overlay** 中的 design 规则一致即可。
- **禁止写进 `data_boundaries` 的反例**：`NavPathStack`、`PromptAction`、Toast 等 **UI 运行时能力** —— UI 副作用归入 **`ui_subscription`（design）与 acceptance `device_focus`（Skill 1）**，不进 UT 边界清单。
- **路由/导航设计草稿**应覆盖：页面跳转关系、`NavPathStack` 用法、路由参数；页面路径须在后续 `contracts.yaml > navigation` 与资源侧 `main_pages.json` / `route_map.json`（若启用）中对齐。

## 参考图示（示意，非强制命名）

```
<HomePage> (NavDestination)
├── <SectionA> (复杂组件)
│   └── <Widget> (基础组件)
└── <SectionB> (复杂组件)
```
