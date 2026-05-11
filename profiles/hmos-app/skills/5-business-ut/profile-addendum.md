# `hmos-app` · Skill `5-business-ut` profile addendum

## 权威资产清单

| 维度 | 说明 |
|------|------|
| Hypium 与目录 | UT 运行于 `**/src/ohosTest/ets/test/**/*.test.ets`；`List.test.ets` 常作套件注册入口 |
| 模板与样例 | `skills/5-business-ut/templates/`、`examples/card-opening/`（与 `` `profile-skill-asset:5-business-ut/...` `` 一致） |
| Harness | `ut.compile` / `ut.run` 驱动 hvigor + hdc；可被 profile **SKIP**（如 `generic`） |
| 依赖 | `oh-package.json5` 声明 `@ohos/hypium` 等 |

**禁止反改业务架构**：不要为了 UT 新造 `domain/usecase/*.ets` 或 Port；业务嵌在 inline lambda 中时，反馈 Skill 3 抽出命名方法。

### skill-assets.yaml 键

| 键 | 相对 `skills/5-business-ut/` |
|----|------------------------------|
| `use_cases_schema` | `templates/use-cases-schema.md` |
| `dag_schema` | `templates/dag-schema.md` |
| `ut_template` | `templates/ut-template.md` |
| `mock_strategy` | `templates/mock-strategy.md` |
| `testability_audit_template` | `templates/testability-audit-template.md` |
| `mock_plan_schema` | `templates/mock-plan-schema.md` |
| `card_opening_dir` | `examples/card-opening` |
| `card_opening_use_cases` | `examples/card-opening/use-cases.yaml` |

### 示例（仅在 hmos-app 下）

与根 SKILL 交付摘要示例一致时，可采用如下示意（真实 feature 以仓库为准）：

| UseCase | branches 数 | UT 文件 | DAG 数 |
|---------|-------------|---------|--------|
| CardOpeningUseCase | 4 | `card_opening.test.ets` | 4 |

| 文件 | 测试函数 | 用例数 |
|------|----------|--------|
| `card_opening.test.ets` | `cardOpeningUseCaseTest` | 4 |

## `ut_import_whitelist` 禁止符号（与 `framework/profiles/hmos-app/harness/ut-ui-import-ban.ts` 对齐）

UT 源码中不得出现（含 import 行与部分函数体扫描）的典型模式包括：

`@Component` / `@Entry` / `@Preview` / `struct` / `NavPathStack` / `NavDestination` / `showToast` / `$r(` / `$rawfile(` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics` 等 —— **完整列表以 profile  harness 模块为准**，脚本由 `check-ut.ts` 动态加载。
