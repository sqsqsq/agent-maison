# HarmonyOS / ArkTS · `verify-coding` 语义补充

在消费主 prompt `framework/harness/prompts/verify-coding.md` 时，额外自检：

1. **装饰器与状态**：`@Component`、`@State`/`@Prop`/`@Link`/`@Provide`/`@Consume` 使用是否与 plan 组件树声明一致。
2. **路由与导航**：`NavDestination`、`NavPathStack`、页面注册（`main_pages.json` / `route_map.json`）是否与 plan「路由/导航设计」章节一致。
3. **跨模块导出**：HAR/HSP 库模块对外 API 是否与 `architecture.cross_module_exports_file`（通常 `index.ets`，大小写因工程而异）及 contracts 对齐；导出入口物理路径以 oh-package `main` 为准。
4. **资源**：用户可见文案是否经由 `$r('app.string.*')` 等解析，与设计登记的资源 key 一致。

若 `project_profile != hmos-app`，以上条目仅在对应 profile overlay 指明适用时采纳。
