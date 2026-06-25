# `hmos-app` · Skill `spec` profile addendum

宿主 `project_profile=hmos-app` 时，spec 常以 **HarmonyOS 应用功能**为背景（ArkUI 页面、能力与权限、多端形态等）。

描述 UI 组件时可优先使用 ArkUI 组件术语（如 `Column`、`Row`、`List`、`Tabs`、`Navigation`），但仍须以用户提供的截图/描述为准，不得凭平台惯例补需求。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| 阶段规则（中立骨架 + 合并） | `framework/specs/phase-rules/spec-rules.yaml`；profile 专属补充以 `framework/profiles/hmos-app/profile.yaml` → `phase-rules-overlays` 为准（若存在与本 stage 对齐的条目） |
| Visual Handoff / `ui_change`（若启用） | `framework/skills/feature/spec/` 正文与 `prompts/` |
| UI-Spec（ui-spec.yaml） | `framework/skills/feature/spec/reference/ui-spec.md` |
| ui-spec 模板 | `` `profile-skill-asset:spec/ui_spec_template` `` |

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.spec` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:spec/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

## `generic` / 中立工程提醒

本体 Skill 正文中的示例（外层占位名、示意截图类型）均以**参考仓库**为准；实际 **Scope、`in_scope_modules`、术语映射**必须与当前实例的 `doc/module-catalog.yaml` 一致。

## Context Exploration Gate（profile 补充）

- 可选旁证：`oh-package.json5`（包名）、`build-profile.json5`（模块 `srcPath`），用于核对 Scope 与物理模块路径。
- **UI 真源**以 spec Visual Handoff / 用户截图为准；`context-exploration.md` 须能指向像素权威（`authoritative_refs` 或等价路径）。

## 视觉保真捕获（v2.4+ · pixel_1to1）

- Step 2 须按**分区扫描**产出 `spec/ref-elements.yaml`（参考图侧独立枚举；`implement | defer` 二选一）。
- `ref-elements` 中 `disposition: defer` 须在 spec Visual Handoff 块登记 `fidelity_deferrals` 且 **`human_signed: true`**。
- ui-spec 须写 `must_have_elements` / `semantic_role` / `color_ref` / `icon` / `badge`；plan 阶段补 `visual-parity.yaml` 组件映射供 coding **组件级** token 绑定校验。
- `pixel_1to1` 联动产出 `spec/asset-manifest.yaml`（素材需求清单，拒绝 AI 山寨资产）。
