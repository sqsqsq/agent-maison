# Profile 契约测试数据（hmos-app）

本目录承载 **宿主 profile=hmos-app** 侧常用 Harness **fixture**（含 init / PRD Visual Handoff 与 ArkTS·hvigor 契约）。

## 当前布局

| 子树 | 说明 |
|------|------|
| `init/` | `check-init` 体检链路 |
| `prd/` | Visual Handoff / `check-prd` 决策表行 |
| `v2_2/` | coding / ut / named-handler 等与 hvigor·ohosTest 绑定的契约基线 |

`project_profile=generic` 专用最小用例见：

[`profiles/generic/harness/tests/fixtures/`](../../../../generic/harness/tests/fixtures)

## 运行器

[`run-tests.ts`](../../../../../harness/tests/run-tests.ts) 合并扫描 **主干** `framework/harness/tests/fixtures/`（现多仅为说明文案）与本目录、`generic` profile 目录。同一逻辑名在两处并存会 **收集即抛错**。
