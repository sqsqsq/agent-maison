# `hmos-app` · Skill `1-prd-design` profile addendum

宿主 `project_profile=hmos-app` 时，PRD 常以 **HarmonyOS 应用功能**为背景（ArkUI 页面、能力与权限、多端形态等）。

描述 UI 组件时可优先使用 ArkUI 组件术语（如 `Column`、`Row`、`List`、`Tabs`、`Navigation`），但仍须以用户提供的截图/描述为准，不得凭平台惯例补需求。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| 阶段规则（中立骨架 + 合并） | `framework/specs/phase-rules/prd-rules.yaml`；profile 专属补充以 `framework/profiles/hmos-app/profile.yaml` → `phase-rules-overlays` 为准（若存在与本 stage 对齐的条目） |
| Visual Handoff / `ui_change`（若启用） | `framework/skills/1-prd-design/` 正文与 `prompts/` |

### skill-assets.yaml 键

机器清单：`framework/profiles/hmos-app/skills/skill-assets.yaml`。根 `SKILL.md` 使用 `` `profile-skill-asset:1-prd-design/<键>` `` 指向下列文件：

| 键 | 相对 `skills/1-prd-design/` |
|----|------------------------------|
| `prd_template` | `templates/prd-template.md` |
| `example_prd` | `examples/example-prd.md` |
| `examples_prd_mapping` | `examples-prd-mapping.md` |

## `generic` / 中立工程提醒

本体 Skill 正文中的示例（外层占位名、示意截图类型）均以**参考仓库**为准；实际 **Scope、`in_scope_modules`、术语映射**必须与当前实例的 `doc/module-catalog.yaml` 一致。

## Context Exploration Gate（profile 补充）

- 可选旁证：`oh-package.json5`（包名）、`build-profile.json5`（模块 `srcPath`），用于核对 Scope 与物理模块路径。
- **UI 真源**以 PRD Visual Handoff / 用户截图为准；`context-exploration.md` 须能指向像素权威（`authoritative_refs` 或等价路径）。
