# `hmos-app` · Skill `business-ut` profile addendum

## 权威资产清单

| 维度 | 说明 |
|------|------|
| Hypium 与目录 | UT 运行于 `**/src/ohosTest/ets/test/**/*.test.ets`；`List.test.ets` 常作套件注册入口 |
| 模板与样例 | 键见机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml` 的 `business-ut` 段（如 `ut_template`、`sample_flow_dir`）；根 SKILL 用 `` `profile-skill-asset:business-ut/<键>` `` 引用 |
| Harness | `ut.compile` / `ut.run` 驱动 hvigor + hdc；可被 profile **SKIP**（如 `generic`） |
| 依赖 | `oh-package.json5` 声明 `@ohos/hypium` 等 |

## Context Exploration Gate（profile 补充）

UT 规划前除读 Spec 与业务源码外，须打开：**`**/src/ohosTest/ets/test/`** 下拟扩展的测试文件、**套件注册入口**（如 `List.test.ets`）、以及 **`oh-package.json5`** 中与 Hypium/测试依赖相关的条目；Spy 类目录与 `mock-plan.yaml` 拟落位路径须在 `context-exploration.md` 中写明。

**禁止反改业务架构**：不要为了 UT 新造 `domain/usecase/*.ets` 或 Port；业务嵌在 inline lambda 中时，反馈 coding 抽出命名方法。

## UT 写入路径（BLOCKER）

| ✅ 正确（相对 `<repo-root>`） | ❌ 错误 |
|------------------------------|--------|
| `02-Feature/Demo/src/ohosTest/ets/test/foo.test.ets` | `framework/harness/02-Feature/Demo/src/ohosTest/...` |
| `02-Feature/Demo/test/dag/flow.dag.yaml` | `framework/harness/02-Feature/Demo/test/dag/...` |
| `02-Feature/Demo/src/ohosTest/ets/test/spy/SpyX.ets` | 任意 Write 到 `framework/harness/` 下宿主 module 树 |

路径取自 `contracts.yaml > modules[].package_path`。`cd framework/harness && harness-runner` 后 Write 前须 `cd <repo-root>`（见 `harness-cli-cwd.md` §2.5）。门禁：`harness_host_artifact_pollution`。

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.business-ut` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:business-ut/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

### 示例（仅在 hmos-app 下）

与根 SKILL 交付摘要示例一致时，可采用如下示意（真实 feature 以仓库为准）：

| UseCase | branches 数 | UT 文件 | DAG 数 |
|---------|-------------|---------|--------|
| task_submission | 6 | `sample_flow.test.ets` | 1 |

| 文件 | 测试函数 | 用例数 |
|------|----------|--------|
| `sample_flow.test.ets` | `taskSubmitFlowTest` | 6 |

## `ut_import_whitelist` 禁止符号（与 `framework/profiles/hmos-app/harness/ut-ui-import-ban.ts` 对齐）

UT 源码中不得出现（含 import 行与部分函数体扫描）的典型模式包括：

`@Component` / `@Entry` / `@Preview` / `struct` / `NavPathStack` / `NavDestination` / `showToast` / `$r(` / `$rawfile(` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics` 等 —— **完整列表以 profile  harness 模块为准**，脚本由 `check-ut.ts` 动态加载。
