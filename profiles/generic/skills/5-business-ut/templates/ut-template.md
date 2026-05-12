# UT 代码模板占位 · `generic` profile

`generic` **通常禁用**可执行 UT harness（无 Hypium/hvigor）。本文件只保留**宿主无关**的流程约束；需要 **ArkTS / `@ohos/hypium` / `ohosTest` 目录约定** 的全文模板时，请切换到 `hmos-app` profile 并打开同名的 `ut-template.md`。

## 仍适用于 generic 的契约

1. **`use-cases.yaml` 驱动的分支**：每条 `branches[]` 建议在测试计划里对应至少一个可验收场景（自动化或人工）。
2. **命名业务入口**：UT/集成测试应优先调用 `coordinator` / `ui_bindings.user_actions.calls` 声明的命名方法，而不是通过 UI 手势模拟（UI 交给 Skill 6 或端到端框架）。
3. **数据边界**：对 `data_boundaries[]` 中的外部系统使用 Spy / Fake / 替身，避免真实网络/磁盘。
4. **禁止在纯单测中绑 UI**：宿主若提供 import 白名单（ArkUI 等），在 `generic` 下通常不强制 —— 切到端侧 profile 后由 overlay 执行。

## 伪代码骨架（语言无关）

```
for each branch in use_cases[].branches:
  test "[BRANCH-{branch.id}] ...":
    arrange spies for each data_boundary method used in branch.setup
    act   call triggers[].call on coordinator with triggers[].with
    assert final state + boundary call order + persisted data (if any)
```

## 示例规约（无代码）

与 `` `profile-skill-asset:5-business-ut/sample_flow_use_cases` `` 同目录下的 `use-cases.yaml` 对齐阅读。

## 与 Skill 6 的分工

| 维度 | generic / 文档为先 | 端侧 profile |
|------|-------------------|--------------|
| 业务编排与数据边界 | 仍可写 mock-plan / DAG 作为**设计资产** | `check-ut.ts` 可强制结构 |
| UI / 真机交互 | `device-testing-todo.md` | 同左 + 可能跑 harness |

> `ut_layer in [device, both]` 的 AC 仍建议在 `device-testing-todo.md` 中写明人工或 E2E 验证步骤。
