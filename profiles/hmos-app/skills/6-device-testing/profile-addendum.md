# `hmos-app` · Skill `6-device-testing` profile addendum

真机 / 设备侧验证默认面向 **OpenHarmony / HarmonyOS 设备或模拟器、hdc Hypium / 装机 HAP**。测试步骤描述应可操作、可复述。

## Skill 6 · 主应用打包与装机（hmos-app）

与 **`coding.compile`** 类似，`testing` 阶段可由脚本 harness 触发 **`device_test.build`**（hvigor，产出 **`reports/<feature>/testing/hvigor-app-build.log`**）及 **`device_test.install`**（`hdc install -r`，日志 **`hdc-app-install.log`**）。能力与 **`profile.yaml > capabilities`** 对齐：`hvigor_app` / `hdc_app`。

- **产物指纹**：成功时在 **`reports/<feature>/testing/device-test-build.result.json`** 写入 `resolvedProduct`、`resolvedBuildMode`、`hapPath` 等字段。
- **交互默认值**：见 **`framework/profiles/hmos-app/harness/testing-build-conventions.ts`**（导出 **`listAvailableProducts`**、**`describeDeviceTestHarnessEnvHints`** 等）。
- **可选构建矩阵**：通过环境变量覆盖：`HARNESS_DEVICE_TEST_PRODUCT`、`HARNESS_DEVICE_TEST_BUILD_MODE`（`debug`|`release`）。不要用 **`HARNESS_SKIP_DEVICE_TEST_BUILD` / `HARNESS_SKIP_DEVICE_TEST_INSTALL`** 作为出口——testing harness 会判 **FAIL**。

打包语义依赖宿主 **`toolchain.devEcoStudio`/`hvigor`** 配置（与 coding 门禁同源）；装机语义依赖 **`hdc` 可执行并在 PATH**。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| Profile 能力与阶段覆盖 | `framework/profiles/hmos-app/profile.yaml`（`capabilities`、`phases_disabled` 等） |
| hdc/hvigor 实现侧 | `framework/profiles/hmos-app/harness/`（runner 经由 `framework/harness` shim） |
| Skill 6 打包维度 / env 提示 | `framework/profiles/hmos-app/harness/testing-build-conventions.ts` |

上游 **Skill 5** 产物 `device-testing-todo.md` 在宿主侧常为 **Hypium DAG + 打桩契约**的补充清单；计划/报告仍以 AC/BD 与 todo 为第一来源。

### skill-assets.yaml 键

| 键 | 相对 `skills/6-device-testing/` |
|----|-----------------------------------|
| `test_plan_template` | `templates/test-plan-template.md` |
| `test_report_template` | `templates/test-report-template.md` |
