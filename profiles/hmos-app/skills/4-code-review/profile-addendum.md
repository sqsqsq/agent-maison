# `hmos-app` · Skill `4-code-review` profile addendum

审查 **`*.ets`/ArkUI/资源 `$r`/HAR-HSP 导出/分层 import** 时，默认以 **宿主 ArkTS** 语义与 **`coding-rules` + overlay** 为 BLOCKER 依据。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| 编码规则 overlay | `framework/profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml` |
| ArkTS 易错点（审查时对照） | `framework/profiles/hmos-app/skills/3-coding/reference/arkts-pitfalls.md` |

### skill-assets.yaml 键

| 键 | 相对 `skills/4-code-review/` |
|----|------------------------------|
| `review_checklist` | `templates/review-checklist.md` |

若宿主含 **非 `.ets`** 源码形态，仍以 `contracts.yaml` 与实例 `architecture` 为准，避免套错语言规则。

## Context Exploration Gate（profile 补充）

审查前除读全 `contracts.yaml > files` 外，建议对 **HAR/HSP 库模块 `Index.ets` 导出**、**`$r()` 资源 key` 定义文件** 与 **`route_map.json` / 页面注册** 做抽查，以验证「问题清单」是否遗漏宿主特有 BLOCKER。
