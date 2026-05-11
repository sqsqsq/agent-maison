# `hmos-app` · Skill `6-device-testing` profile addendum

真机 / 设备侧验证默认面向 **OpenHarmony / HarmonyOS 设备或模拟器、hdc Hypium / 装机 HAP**。测试步骤描述应可操作、可复述。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| Profile 能力与阶段覆盖 | `framework/profiles/hmos-app/profile.yaml`（`capabilities`、`phases_disabled` 等） |
| hdc/hvigor 实现侧 | `framework/profiles/hmos-app/harness/`（runner 经由 `framework/harness` shim） |

上游 **Skill 5** 产物 `device-testing-todo.md` 在宿主侧常为 **Hypium DAG + 打桩契约**的补充清单；计划/报告仍以 AC/BD 与 todo 为第一来源。

### skill-assets.yaml 键

| 键 | 相对 `skills/6-device-testing/` |
|----|-----------------------------------|
| `test_plan_template` | `templates/test-plan-template.md` |
| `test_report_template` | `templates/test-report-template.md` |
