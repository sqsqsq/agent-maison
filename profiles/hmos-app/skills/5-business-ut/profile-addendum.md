# `hmos-app` · Skill `5-business-ut` profile addendum

- **Hypium**：UT 运行于 `**/src/ohosTest/ets/test/**/*.test.ets`，框架 import 与白名单见 `phase-rules overlay`（`ut_import_whitelist`）。
- **模板与样例**：`framework/profiles/hmos-app/skills/5-business-ut/templates/`、`examples/card-opening/`（权威路径）。
- **Harness**：`ut.compile` / `ut.run` 能力键驱动 `hvigor` + `hdc`；可被 profile **SKIP**（见 `generic`）。
- **hvigor ohosTest 编译**：默认对齐 DevEco「Run ohosTest」链路，生成 `ohosTest` HAP 后再由 `hdc shell aa test` 触发 Hypium。
- **路径约定**：测试文件通常位于 `{module}/src/ohosTest/ets/test/*.test.ets`，`List.test.ets` 注册所有新增测试，`oh-package.json5` 声明 `@ohos/hypium`。
- **禁止反改业务架构**：不要为了 UT 新造 `domain/usecase/*.ets` 或 Port；业务嵌在 inline lambda 中时，反馈 Skill 3 抽出命名方法。
