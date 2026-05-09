# `generic` · Skill `3-coding` profile addendum

`generic` 常在 `project_profile.phases_disabled` 中**禁用 coding 阶段**：本 Skill 的流程骨架仍可读，但 **不得**假设会跑 hvigor、`check-coding` 的 ArkTS 专有子项或存在 `.ets` 树。

- 若宿主无 ArkTS：实现形态、lint 工具与 harness 检查以**实际选中的 profile**及其 `phase-rules-overlays` 为准。
- 切换到 `hmos-app`（或其它端侧 profile）后，再启用本仓库的 **ArkTS 易错手册、编码规范、coding overlay** 全套闸门。

`framework/skills/3-coding/SKILL.md` 内指向 `framework/profiles/hmos-app/skills/3-coding/` 的路径，在 `generic` 下仅作**能力说明**；未切 profile 前勿把该树当作当前工程强制 SSOT。
