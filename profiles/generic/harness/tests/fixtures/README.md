# Profile 契约测试数据（generic）

`project_profile=generic` 的 **最小**Harness 断言（典型：`phases_disabled` → 阶段 SKIP），与宿主 ArkTS toolchain **解耦**。

## 布局

| 子树 | 说明 |
|------|------|
| `profile_generic/` | generic profile 下 coding 等阶段禁用路径的回放 |

由 [`run-tests.ts`](../../../../../harness/tests/run-tests.ts) 与 `hmos-app`、主干 `tests/fixtures/` 一并扫描。
