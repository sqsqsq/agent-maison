# Visual Handoff 回归覆盖说明

> 三层回归：**单元（白盒）+ fixture（端到端）+ 实例 demo（home-page）**。本目录仅存说明；端到端 fixture 在
> [`profiles/hmos-app/harness/tests/fixtures/prd/`](../../../../profiles/hmos-app/harness/tests/fixtures/prd)，单元用例在
> [`tests/unit/visual-handoff.unit.test.ts`](../../unit/visual-handoff.unit.test.ts)。

## 单元（`tests/unit/visual-handoff.unit.test.ts`，由 `tests/run-unit.ts` 挂载）

| 场景 | 用例 id |
|------|---------|
| 无 `ui_change` yaml、无顶层 `prd` 段 → 静默零条结果 | `no_ui_yaml_and_no_prd_section_returns_empty_array` |
| `enforcement=strict` 且缺整块 yaml → FAIL | `missing_ui_yaml_strict_fail` |
| 仓库内相对路径不存在、无 `prd` → FAIL（声明即承诺） | `unreachable_repo_relative_implicit_strict_fail` |
| 同上、`enforcement=reachable` → WARN（`agent-reachable=false`） | `unreachable_repo_relative_reachable_warns` |
| `${ENV_VAR}` 前缀根解析可达 → PASS + `env_substituted` 行 | `external_root_ENV_reachable_pass` |
| 绝对路径、未获准 → FAIL | `absolute_path_denied_by_default_fail` |
| `allow_absolute_paths=true` → PASS | `absolute_path_allowed_pass` |
| `resolveAuthoritativePath` 普通相对路径不被当作 ENV 替换 | `resolver_plain_relative_not_env_substitution` |

## Fixture（`prd/visual_handoff_*`，`tests/run-tests.ts`；目录 `profiles/hmos-app/harness/tests/fixtures/prd/`）

对应 plan §2.0 决策表第 1/2/4 行——通过 `EXPECTED.json.rules` 的 `must_be_absent` 与
`details_includes` 字段断言局部规则结果，**不**约束其它 prd 检查的状态：

| Fixture | 决策表行 | 验证点 |
|---------|----------|--------|
| `prd/visual_handoff_silent_no_ui_change_no_prd_section` | 第 1 行：云侧/库工程默认静默 | 无 `ui_change` + 无 `prd` 段 → 报告里**不出现** `visual_handoff*` 任一规则 |
| `prd/visual_handoff_strict_missing_ui_change_block_fail` | 第 2 行：UI 工程主动拦截缺块 | 无 `ui_change` + `prd.strict` → `visual_handoff_ui_change=FAIL/BLOCKER`，详情含「opt-in」字样 |
| `prd/visual_handoff_repo_assets_reachable_pass` | 第 4 行：声明 + 可达 → PASS | `ui_change=new_or_changed` + 仓库内可达 path → `visual_handoff=PASS`，无残留 `visual_handoff_refs` 报错 |

## 工程实例 demo

本仓库示例中 `doc/features/home-page` 曾用于跑通 strict + 可达的范式，可作为参考（路径以当前实例为准）。

## 未覆盖场景（仍依赖单元）

* 绝对路径开关 ON/OFF（fixture 难以构造稳定的"系统级真实路径"，留在单元）
* UNC 网络路径（同上）
* `${UX_ROOT}` 在不同 OS 下的根解析（依赖运行环境，留在单元）

如未来 `fixture-runner` 增强了系统路径桩能力，可把这些场景一并迁回 fixture。
