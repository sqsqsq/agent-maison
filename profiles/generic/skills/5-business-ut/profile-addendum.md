# `generic` · Skill `5-business-ut` profile addendum

`generic` 通常**禁用 UT 阶段Harness**（无 `ohosTest`、无 hvigor 装机用例）。本 Skill 的流程与模板仍可作为**文档化 UT 策略**参考，但不要求生成可执行的 `.test.ets` 或 Hypium 产物。

- **`device-testing-todo.md`**：仍可按 AC/BD 的 `ut_layer` 整理真机待验证项，即使无自动化 UT。
- 需要 **Hypium / hdc / 编译 HAP** 时，应切换至 `hmos-app`（或等价端侧 profile）并阅读其 `profile-addendum` 与 `profiles/hmos-app/skills/5-business-ut/` 资产。

## Context Exploration Gate（profile 补充）

未启用 Hypium 时，`context-exploration.md` 仍须覆盖 acceptance/PRD/design/contracts 与计划中的 device 待验项；自动化 UT 相关目录可标为 N/A。
