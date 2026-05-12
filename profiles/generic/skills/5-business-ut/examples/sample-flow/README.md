# 示例：中性多步业务流程（`generic` profile）

本目录仅展示 **use-cases.yaml 规约长什么样**，不绑定宿主语言或目录前缀。实现文件路径、测试框架、DAG 形态由你选定的 `project_profile`（如 `hmos-app`）与其 addendum 决定。

- Schema 权威：`profile-skill-asset:5-business-ut/use_cases_schema`
- 需要可编译的 ArkTS / Hypium 参考时，请切换到 `hmos-app` 并查看其 `examples/sample-flow/`（或等价端侧示例目录）

## 阅读顺序

1. 读 `use-cases.yaml` 内的 `coordinator` / `ui_bindings` / `data_boundaries` / `branches`
2. 在真实 feature 中把这些信息落到 `doc/features/<feature>/use-cases.yaml`
3. 按当前 profile 的工具链决定是否生成 DAG、mock-plan、自动化 UT
