# 编码规范 · `generic` profile（宿主无关概要）

适用场景：`project_profile=generic`，通常禁用 coding harness，本文件只做**与技术栈无关**的占位说明。

## 必读 SSOT

- 模块边界与依赖方向：**只承认** `framework.config.json > architecture` 与 `doc/architecture.md`。
- 宿主语言、lint、产物扩展名、coding overlay：以切换到目标 profile（如 `hmos-app`）后的 addendum + `phase-rules-overlays` 为准。

## 最小约定

1. **不要深路径跨模块**：只通过 DSL 声明的跨模块导出文件暴露 API。
2. **不要做反向层依赖**：外层仅允许引用 `outer_layers[].can_depend_on` 列出的下层。
3. **模块内层级**：遵从 `architecture.module_inner_layers` 与 `inner_dependency_direction`。

需要 ArkTS/Harmony 细则时，切换到 `hmos-app` profile 并使用其 `coding_standards`、`arkts_pitfalls` 等正文资产。
