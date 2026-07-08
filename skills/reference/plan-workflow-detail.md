# plan 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/plan/SKILL.md`](../feature/plan/SKILL.md)。本文承载 Scope 扩展提议全流程、UseCase 复杂度判定与 schema、contracts.yaml 提取字段表、架构影响判定五分支的完整机制；触发/门禁清单/闭环判定仍以主文档为准。

## Scope 继承与扩展提议（Scope 守门机制核心，在任何模块设计动作前完成）

**继承**：读 spec.md「Scope 声明」yaml 块，plan.md 显式复述 `in_scope_modules`/`out_of_scope_modules`/`rationale`。从此刻起本次设计原则上只能规划修改 `in_scope_modules` 列出的模块。

**最小改动原则**：就地实现优先（禁止出于"架构美感"把代码提前上提到更高外层或未授权的公共模块）；已有公共能力强制复用（先查 `architecture.md > 各模块公共能力清单`，有则直接用不新增）；禁止默默扩大（哪怕判断合理也不能直接写入 plan.md，必须走扩展提议）。

**扩展提议流程**（唯一合法扩大路径）：仅当 in_scope 模块物理上无法承载（跨层依赖不允许）或公共能力清单确无可复用能力且多 Feature 需要时，才允许提议：

```markdown
## ⚠️ Scope 扩展提议（需用户确认）

**spec 已声明**：in_scope_modules / out_of_scope_modules / rationale

**当前分析发现**需要扩展到：建议新增 in_scope：`{ModuleName}`；原因；备选方案（是否考虑过就地实现）；复用检查（已查阅公共能力清单，确认无可复用）

**请用户明确回复**（`plan.scope_expansion`）：
1. 已读并同意扩展（记录用户原话到 expansions_with_user_approval）
2. 拒绝扩展
3. 修改提议后再议
```

**headless/goal-mode**：无交互用户 → 保守默认 = 拒绝扩展（不写入 `expansions_with_user_approval`），记录被推迟请求到 `headless-assumptions.md`，必要时 goal-run DEFERRED。

用户同意后登记：

```yaml
expansions_with_user_approval:
  - modules: [<ModuleA>, <ModuleB>]
    reason: "<业务理由>"
    approved_by: "{user_name}"
    approved_at: "2026-04-17"
```

未同意的提议**不得**写入 plan.md，退回就地实现。本 Step 结束时 `in_scope_modules`（= spec 继承 ∪ 已批准扩展）冻结，后续所有 Step 的模块选择必须在此集合内。

## UseCase 复杂度判定与 use-cases.yaml（条件式产出）

> `UseCase` 是**文档级业务规约**，不是代码中必须存在的类；真正的业务编排代码由 coding 阶段选择最贴合复杂度的形式落地。

**仅当至少满足下列一条**才产出 `use-cases.yaml`：①多 UI 节点共享状态（≥2 页面/组件订阅同一业务状态且互相渲染依赖）；②多步云侧调用（一个动作触发 ≥2 次独立请求且顺序受前一次结果影响）；③存在回滚/补偿分支；④多路人机交互（≥2 次真实用户输入）。全部不满足则**不产出**，business-ut 走退化模式基于 `acceptance.yaml`+`dag.yaml` 直接对 data 层写 UT。

**若决定产出**，两份文档：

1. **plan.md「业务流程 UseCase 清单」章节**（模板 `` `profile-skill-asset:plan/plan_template` `` 的 `## 六`）：业务入口映射表（ui_bindings 人话版）、状态机 Mermaid（`stateDiagram-v2`，覆盖成功/失败/取消/回滚）、数据边界清单（引用 `contracts.yaml > interfaces[].class` 已存在的 data 层类，不新造 Port）、分支清单表（每条标注对应 AC/BD）。
2. **`use-cases.yaml`**（schema：`` `profile-skill-asset:business-ut/use_cases_schema` ``，样例：`` `profile-skill-asset:business-ut/sample_flow_dir` ``）：必填 `schema_version/feature/use_cases[]`；每个 use_case 含 `id/coordinator/ui_bindings/state_model/branches`（`coordinator_file`/`data_boundaries` 可选）。`coordinator` 只写符号名（类名/`Page.method`/导出函数名），不强制放 `domain/usecase/`；`ui_bindings[].user_actions[].calls` 必须命名函数符号（非 inline lambda）；`data_boundaries[].type` 须与 `contracts.yaml.interfaces[].class` 一一对应，`kind` 取 `cloud`/`storage`/`system`；`branches[].linked_acceptance` 至少关联一条 AC/BD。

**禁止的反模式**：要求"必须在 `domain/usecase/` 下新建 XxxUseCase 类"（代码形态由 coding 决定）；为 data 层类套 `XxxPort` 接口只为 UT 注入方便；把路由/弹窗/Toast 等 UI 副作用登记为 `data_boundaries`（应走 `ui_subscription` + `acceptance.yaml > device_focus`，不进 UT）；对简单 feature 硬凑 use-cases.yaml。

## contracts.yaml 提取字段表

从 plan.md 提取到 `<features_dir>/{module-name}/contracts.yaml`：

| 章节 | 来源 | 关键字段 |
|---|---|---|
| `modules` | 模块架构图 | `name`/`layer`（= outer_layers id）/`format`/`change_type`（new/modify/migrate_and_modify）/`package_path` |
| `module_dependencies` | 架构图依赖箭头 | — |
| `data_models` | 数据模型定义 | `name`/`module`/`file`/`kind`（interface/class/enum）/`fields`（name+type+required） |
| `interfaces` | 服务层接口定义 | `module`/`layer`/`file`/`class`/`methods`（name+params+return+async+description）。**UT/mock-plan 门禁**：`params` 须含完整类型文本，`return` 须准确含 `Promise<...>`——下游 `ut_mock_plan_contracts_consistent` 依赖此信息 |
| `components` | 页面组件树+状态管理方案 | `name`/`module`/`file`/`kind`（page/component/utility）/`state`/`props`/`events`/`children` |
| `state_management` | 状态管理方案 | — |
| `navigation` | 路由/导航设计 | — |
| `files` | 目录/文件结构规划 | 完整文件清单 |
| `resource_keys` | 宿主资源引用 | **媒体资源 `path` 必须指向模块实际资源目录**（如 `<module>/src/main/resources/base/media/<key>.<ext>`），不得写工程根相对路径——门禁以模块资源目录真实文件判定，曾发生 1×1 占位绕过 `resource_integrity` 假 PASS |
| `prd_to_code_traceability` | spec 功能映射表 | — |

**边界用例补充**：若 `acceptance.yaml` 已由 spec 产出，检查并补充 plan 阶段新发现的边界场景；若 spec 未产出（历史原因）则从 spec.md 提取创建。

## 架构影响判定（五分支，Step 12）

`doc/architecture.md` 是**架构契约**不是 feature 变更日志。**绝大多数 feature 不应动它**——变更历史由 git 与 `<features_dir>/<feature>/` 承担。先判定影响等级，再决定是否更新。

在 plan.md `## Scope 声明与继承` 下补齐 `### 架构影响声明`：

```yaml
architecture_impact:
  impact: none                  # none | dsl_change | module_set_change | responsibility_rewrite
  affected_items: []
  architecture_md_updates: []
  catalog_updates: []
```

| 取值 | 含义 | 典型场景 |
|------|------|-------------|
| `none` | 无架构影响 | 既有模块内新增页面/接口/数据模型；bug 修复；spec 完全落在已声明模块集合内 |
| `dsl_change` | `architecture` 结构变化 | 新增/下线外层、改同层策略、改内层顺序、改 `cross_module_exports_file`、改 `can_depend_on` |
| `module_set_change` | 模块集合变化 | 新增/下线模块、模块迁外层 |
| `responsibility_rewrite` | 模块核心职责大调整 | catalog `primary_responsibility` 被大幅重写 |

> **判定原则**：从严判 `none`。不确定就按 `impact != none` 处理并停下确认。

- **`none`**：`affected_items`等全部 `[]`；不修改 architecture.md/catalog/config；不追加变更记录；跳到 Step 13。
- **`dsl_change`**：同步改 [framework.config.json](../../framework.config.json) 的 `architecture` 段 + [doc/architecture.md](../../../doc/architecture.md) 对应小节；末尾「架构级变更记录」追加一行 `| YYYY-MM-DD | dsl_change | <具体变化> |`；回填 `architecture_md_updates`。
- **`module_set_change`**：更新 [doc/module-catalog.yaml](../../../doc/module-catalog.yaml)（新增/删除/迁层，见 catalog-bootstrap Phase A 增量流程）+ architecture.md 极简模块清单（只增删一行，不扩展完整画像）；可能同时触发 `dsl_change`；追加变更记录；回填两个 updates 数组。
- **`responsibility_rewrite`**：只改 module-catalog.yaml 的 `primary_responsibility`/`NOT_responsible_for`/`easily_confused_with`；同步 architecture.md 那一行"一句话职责"；**不要**在 architecture.md 粘贴完整职责描述；追加变更记录；`catalog_updates` 必填。
- **Feature 级变更禁入 architecture.md**：既有模块内新增/修改页面组件接口数据模型、修 bug/样式/文案、in_scope 完全落在已有模块内、仅 `exposed_capabilities_public` 新增而职责未变——一律不算架构级。

> **为什么这样设计**：architecture.md 负责分层/模块集合/依赖边/出口约定；module-catalog.yaml 负责模块细粒度职责与能力；git history + `<features_dir>/<feature>/` 负责 feature 级变更日志——三者各司其职。
