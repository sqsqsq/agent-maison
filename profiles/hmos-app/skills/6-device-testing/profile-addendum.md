# `hmos-app` · Skill `6-device-testing` profile addendum

真机 / 设备侧验证默认面向 **OpenHarmony / HarmonyOS 设备或模拟器、hdc Hypium / 装机 HAP**。测试步骤描述应可操作、可复述。

## Skill 6 · 主应用打包与装机（hmos-app）

与 **`coding.compile`** 类似，`testing` 阶段可由脚本 harness 触发 **`device_test.build`**（hvigor，产出 **`reports/<feature>/testing/hvigor-app-build.log`**）及 **`device_test.install`**（`hdc install -r`，日志 **`hdc-app-install.log`**）。能力与 **`profile.yaml > capabilities`** 对齐：`hvigor_app` / `hdc_app`。

- **产物指纹**：成功时在 **`reports/<feature>/testing/device-test-build.result.json`** 写入 `resolvedProduct`、`resolvedBuildMode`、`hapPath` 等字段。
- **交互默认值**：见 **`framework/profiles/hmos-app/harness/testing-build-conventions.ts`**（导出 **`listAvailableProducts`**、**`describeDeviceTestHarnessEnvHints`** 等）。
- **可选构建矩阵**：通过环境变量覆盖：`HARNESS_DEVICE_TEST_PRODUCT`、`HARNESS_DEVICE_TEST_BUILD_MODE`（`debug`|`release`）。不要用 **`HARNESS_SKIP_DEVICE_TEST_BUILD` / `HARNESS_SKIP_DEVICE_TEST_INSTALL`** 作为出口——testing harness 会判 **FAIL**。

打包语义依赖宿主 **`toolchain.devEcoStudio`/`hvigor`** 配置（与 coding 门禁同源）；装机语义依赖 **`hdc` 可执行并在 PATH**。

### 装机：版本预检、降级与冲突（脚本 harness）

`device_test.install` 会在 **`hdc install -r`** 之前读取工程 **`AppScope/app.json5`** 的 **`bundleName` / `versionCode`（可选）**，并对设备执行 **`hdc shell bm dump -n <bundleName>`**，尽力解析设备端 **`versionCode`**（输出格式随 API 版本可能为 JSON 或混排文本）。解析不确定时**不会**仅凭猜测阻断装机，完整原始输出写入 **`reports/<feature>/testing/hdc-app-install.log`**，结构化摘要见 **`device-test-install.meta.json`**。

| 场景 | 默认行为 |
|------|----------|
| 设备上 **未安装** 该 bundle | 直接尝试 install。 |
| 设备 **`versionCode` 高于** 工程声明的候选 `versionCode` | **FAIL**（降级）：报告中给出提高 `versionCode`、手动 `bm uninstall`、或启用下方自动化卸载变量的说明。 |
| 工程 **未声明 `versionCode`** | 跳过数值型降级预检，仍执行 install；日志会标注候选版本缺失。 |
| **`hdc install` 失败** | 对合并日志做启发式分类（降级 / 签名 / 冲突 / 通用），**中文摘要 + 修复建议**写入 harness 检查明细与日志。 |

**环境变量（非交互；由用户在 Shell / CI 或 agent 说明）**

| 变量 | 含义 |
|------|------|
| `HARNESS_HDC_TARGET` | 多设备时指定序列号，所有 `hdc` 子命令（含 `bm dump` / `install` / `uninstall`）前置 `-t`。 |
| `HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL` | 设为 `1` / `true` / `yes` 时：若预检判定降级，则先 **`bm uninstall`** 再装；若首次 install 失败且尚未卸载过，则卸载后 **再试一次** install。 |
| `HARNESS_DEVICE_TEST_UNINSTALL_KEEP_DATA` | 与上一变量同时启用时，`bm uninstall` 使用 **`-k`** 保留用户数据。 |

默认 **不** 自动卸载（避免误删数据）。Skill 6 Step 1.5 仍要求 agent 与用户对齐 **product/buildMode**；上述变量由 agent 在降级/冲突场景下向用户解释后再选用。

详细单行清单亦可调用宿主 **`describeDeviceTestHarnessEnvHints()`**（[`testing-build-conventions.ts`](framework/profiles/hmos-app/harness/testing-build-conventions.ts)）。

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
