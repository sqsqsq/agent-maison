# plan 阶段详细流程（条件加载：执行对应 Step 时读）

正式交付按已有 ut_layer、device_focus、use-cases 和 plan 说明两层各证明什么；both 不是要求 UT 模拟 ArkUI 或重复全条设备流程。定义与可测性不一致先回原责任方裁定，不由 UT 修改 acceptance、减少 required 义务或新建业务抽象。 设计阶段同时明确真实业务入口与最小必要隔离边界，不能先把全部 UI 行为标 both，再让下游为单测改造整套 UI。

> SSOT 索引见 [`skills/feature/plan/SKILL.md`](../feature/plan/SKILL.md)。本文承载核心架构认知、Scope 扩展提议全流程、UseCase 复杂度判定与 schema、contracts.yaml 提取字段表、架构影响判定五分支的完整机制；触发/门禁清单/闭环判定仍以主文档为准。

## 核心架构认知

开始设计前必须读 `doc/architecture.md`（模块架构唯一事实来源），以 `framework.config.json > architecture` 为机器可读依赖规则：①外层依赖只按 `outer_layers[].can_depend_on` 放行；②同层依赖按 `intra_layer_deps`（forbid/dag/sublayer）裁决；③模块内依赖顺序按 `module_inner_layers`+`inner_dependency_direction`；④跨模块访问经 `cross_module_exports_file` 出口；⑤profile 专属目录/语言/格式以 Step 0 addendum 为准。

**功能拆分核心任务**（非 CU-bound）：把 spec 功能点分配到 catalog/architecture 已声明的模块，跨模块依赖不超过 `can_depend_on`；页面/UI→业务模块 presentation；应用壳→壳模块；细分子域→独立业务模块；横切能力→catalog 权威模块；通用 UI/工具→公共模块或 sublayer；无需求不新增模块。

**CU-bound**：模块归属已由蓝图 development 节点 `module` 裁决，这些节点表示预计影响；必要实现调整按真实边界和现行架构核对，不为补预测清单重复回签。

## Scope 预测与真实边界

in_scope_modules/out_of_scope_modules/files 记录预计实施范围，不是逐项许可；原始请求明确限制不能被模型预测覆盖。计划保留行为、验收、公共接口和有效架构，允许下游调整必要的私有组织与位置。

超出预计模块但仍在原需求内的必要改动，在既有 review 显著披露必要性、影响与回归依据；无需登记 expansions_with_user_approval。真实目标/验收变化仍确认；已授权无人值守的原需求内设计或架构变化，由原 owner 经正式修订、质询、发布和重绑接续。有人在场沿原确认点，plan/coding 不自行改 DSL 自授。

## UseCase 复杂度判定与 use-cases.yaml（条件式产出）

**已有蓝图用例优先交付**：当前 CU 合法 typed 投影含 use-cases@1 时，plan 必须写 use-cases.yaml，先使用规范化设计内容，仅按原权威对齐规则补未声明项；原文件存在时仍必交。required_outputs 同时判定投影与物理文件，不能因为交接未提前物化就省略。业务 UT 消费真实文件，不能用 UT 总体 PASS 掩盖缺输入；无投影且无原文件才继续下方条件式判定。

> `UseCase` 是**文档级业务规约**，不是代码中必须存在的类；真正的业务编排代码由 coding 阶段选择最贴合复杂度的形式落地。

**仅当至少满足下列一条**才产出 `use-cases.yaml`：①多 UI 节点共享状态（≥2 页面/组件订阅同一业务状态且互相渲染依赖）；②多步云侧调用（一个动作触发 ≥2 次独立请求且顺序受前一次结果影响）；③存在回滚/补偿分支；④多路人机交互（≥2 次真实用户输入）。全部不满足则**不产出**，business-ut 走退化模式基于 `acceptance.yaml`+`dag.yaml` 直接对 data 层写 UT。

**P2 CU-bound 覆盖规则**：绑定 canonical CU 时不使用作者自选阈值，也不以尚未生成 contracts.change_unit 作为免责条件。use-case 义务由至少两个有序步骤、失败/重试/恢复/补偿、同状态多消费者或生命周期/后台/定时/外部恢复事实机械派生；DAG 再结合 `acceptance.ut_layer=unit|both` 与跨步骤/分支/多消费者事实派生。简单只读/首次加载、单步、无分支、无共享消费者且无生命周期恢复时不得伪造 mutation/subscription 或多余流产物。

**若决定产出**，两份文档：

1. **plan.md「业务流程 UseCase 清单」章节**（模板 `` `profile-skill-asset:plan/plan_template` `` 的 `## 六`）：业务入口映射表（ui_bindings 人话版）、状态机 Mermaid（`stateDiagram-v2`，覆盖成功/失败/取消/回滚）、数据边界清单（引用 `contracts.yaml > interfaces[].class` 已存在的 data 层类，不新造 Port）、分支清单表（每条标注对应 AC/BD）。
2. **`use-cases.yaml`**（schema：`` `profile-skill-asset:business-ut/use_cases_schema` ``，样例：`` `profile-skill-asset:business-ut/sample_flow_dir` ``）：必填 `schema_version/feature/use_cases[]`；每个 use_case 含 `id/coordinator/ui_bindings/state_model/branches`（`coordinator_file`/`data_boundaries` 可选）。`coordinator` 只写符号名（类名/`Page.method`/导出函数名），不强制放 `domain/usecase/`；`ui_bindings[].user_actions[].calls` 必须命名函数符号（非 inline lambda）；`data_boundaries[].type` 须与 `contracts.yaml.interfaces[].class` 一一对应，`kind` 取 `cloud`/`storage`/`system`；`branches[].linked_acceptance` 至少关联一条 AC/BD。

**禁止的反模式**：要求"必须在 `domain/usecase/` 下新建 XxxUseCase 类"（代码形态由 coding 决定）；为 data 层类套 `XxxPort` 接口只为 UT 注入方便；把路由/弹窗/Toast 等 UI 副作用登记为 `data_boundaries`（应走 `ui_subscription` + `acceptance.yaml > device_focus`，不进 UT）；对简单 feature 硬凑 use-cases.yaml。

## contracts.yaml 提取字段表

CU-bound 从已有 typed 设计开始，保留模型、公共接口和运行设计；files 仅作实施预测；本阶段生成整个 change_unit：通过 canonical resolver 取得当前 ref，覆盖每个必需 predicate/provide/design-ref ID 的实现定位线索与真实测试/验证落点，不复制定义、不改写设计、不扩大授权。设计时省略映射不等于施工时豁免；未知 ID、错误 CU、实质设计冲突仍过完整检查；私有文件/符号位置变化按实际源码披露，已有合法 Feature 映射可按原证据复用。

从 plan.md 提取到 `<features_dir>/{module-name}/contracts.yaml`：

| 章节 | 来源 | 关键字段 |
|---|---|---|
| `modules` | 模块架构图 | `name`/`layer`（= outer_layers id）/`format`/`change_type`（new/modify/migrate_and_modify）/`package_path` |
| `module_dependencies` | 架构图依赖箭头 | — |
| `data_models` | 数据模型定义 | `name`/`module`/`file`/`kind`（interface/class/enum）/`fields`（name+type+required） |
| `interfaces` | 服务层接口定义 | `module`/`layer`/`file`/`class`/`methods`（name+params+return+async+description）。**UT/mock-plan 门禁**：`params` 须含完整类型文本，`return` 须准确含 `Promise<...>`——下游 `ut_mock_plan_contracts_consistent` 依赖此信息 |
| `components` | 页面组件树+状态管理方案 | `name`/`module`/`file`/`kind`（page/component/utility）/`state`/`props`/`events`/`children` |
| `change_unit` | canonical CU（仅 CU-bound Feature） | `change_unit_ref` + `predicate_mappings`/`provide_mappings`/`design_ref_mappings`；只映射既有 ID 到 project-relative `file[#symbol]` / test / verification 消费落点，不复制定义 |
| `state_management` | 状态管理方案 | 运行时施工事实唯一权威；CU-bound 时以 `design_ref` 关联 P1 flow，并可含 owner/contract、ordered steps、conditional mutation/publication/subscription/consumer、lifecycle 与 recovery；禁止平行 `runtime_flow_slices` |
| `navigation` | 路由/导航设计 | 3.0 canonical **只有** `config_files[]`（导航注册/配置文件清单，如 `main_pages.json` / `route_map.json`），作为定位线索，无需预填也不构成逐文件许可；其它承载文件路径的 navigation 键（含嵌套 `pages[]`/`routes[]` 形态、`registration_points`）一律判 `unconsumed_file_field` BLOCKER |
| `files` | 目录/文件结构规划 | 预计实现位置；可不穷举，实际改动进入检查和审查，不能用清单封顶 |
| `conventions_applied`（可选） | plan 条件节「遵循的既有惯例」 | `id` + 非空 `planned_locations[]`；location 仅允许项目相对 POSIX 文件/目录前缀，禁 glob/绝对路径/`..`/反斜杠；有所引蓝图时须覆盖其适用且命中本 CU scope 的惯例 |
| `resource_keys` | 宿主资源引用 | 仅使用已有资源时用 `value: app.media.<key>`，来源保留在 spec/asset-manifest，不声明待交付文件；新建或修改的**媒体资源 `path` / `media` 必须指向模块实际资源目录**（如 `<module>/src/main/resources/base/media/<key>.<ext>`），可列入预测 `files`；不得写工程根相对路径——visual-parity 素材门禁以模块资源目录真实文件判定，曾发生 1×1 占位借工程根路径假 PASS |
| `prd_to_code_traceability` | spec 功能映射表 | `key_files[]` 作为定位线索，实际行为覆盖由 review/UT/testing 验证 |

**文件引用**：沿同一 resolver 检查安全的工程相对路径；引用不必属于预测 files，读引用不授予写权。物理存在不证明实现完成；实际来源、接口与路由由相应消费者核验，错误引用由责任方修正。

**边界用例只读复核**：plan 可检查 `acceptance.yaml` 与 spec/plan 的边界场景是否一致，但不得创建或补写 spec-owned 文件。发现缺失、漏场景或矛盾时，让 `scope_consistency_with_spec` 以机器事实失败并生成 spec repair candidate；runner 回退 spec 修改后，再重走 plan 及下游。

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

> **判定原则**：从严判 `none`。不确定就按 `impact != none` 处理；能由当前目标裁决的不确定按目标裁决并留痕，目标本身冲突或缺失且无法裁决时才停下确认（见 [agent-behavioral-principles.md「权威判定」](agent-behavioral-principles.md#权威判定)）。

- **`none`**：`affected_items`等全部 `[]`；不修改 architecture.md/catalog/config；不追加变更记录；跳到 Step 13。
- **`dsl_change`**：plan 不是 DSL writer。DSL 改写走 framework-init 既有获准路径（`init.architecture_preset` 预设，或[手工编辑 config 后本地校验并重跑 UPDATE](../project/framework-init/templates/custom-architecture-questionnaire.md)），落盘后过 `validateArchitectureDsl`；需要刷新物化产物时再跑 UPDATE。plan 只同步 [doc/architecture.md](../../../doc/architecture.md) 对应小节；末尾「架构级变更记录」追加一行 `| YYYY-MM-DD | dsl_change | <具体变化> |`；回填 `architecture_md_updates`。
- **`module_set_change`**：更新 [doc/module-catalog.yaml](../../../doc/module-catalog.yaml)（新增/删除/迁层，见 catalog-bootstrap Phase A 增量流程）+ architecture.md 极简模块清单（只增删一行，不扩展完整画像）；可能同时触发 `dsl_change`；追加变更记录；回填两个 updates 数组。
- **`responsibility_rewrite`**：只改 module-catalog.yaml 的 `primary_responsibility`/`NOT_responsible_for`/`easily_confused_with`；同步 architecture.md 那一行"一句话职责"；**不要**在 architecture.md 粘贴完整职责描述；追加变更记录；`catalog_updates` 必填。
- **Feature 级变更禁入 architecture.md**：既有模块内新增/修改页面组件接口数据模型、修 bug/样式/文案、in_scope 完全落在已有模块内、仅 `exposed_capabilities_public` 新增而职责未变——一律不算架构级。

> **为什么这样设计**：architecture.md 负责分层/模块集合/依赖边/出口约定；module-catalog.yaml 负责模块细粒度职责与能力；git history + `<features_dir>/<feature>/` 负责 feature 级变更日志——三者各司其职。

### CU-bound（`cu-` Feature，正式需求）：架构影响只投影蓝图决策

架构影响已在蓝图以 `kind: architecture_impact` 决策裁决（一条决策一个变化项：`add_module` / `retire_module` / `move_module` / `responsibility_rewrite` / `dependency_edge` / `dsl_other`），上面五分支判定与 `plan.arch_impact` 不适用，plan 不手填、不改 architecture.md / catalog / DSL：

- **plan.md 叙述路径**：`### 架构影响声明` 的 yaml 写 `architecture_impact: { decisions: [<蓝图全部 architecture_impact 决策 id>] }`；蓝图无此类决策时写 `impact: none`（有决策时不得写 none）。沿用 `architecture_impact_declared` 同 id 核对集合相等，`plan_to_architecture` 做与投影相同的相关决策核对，details 注明「来源=蓝图」。typed 路径（plan.md 非 required）无此段。
- **`cu_architecture_impact_not_effective`**（BLOCKER，共享 `validateChangeUnitFeatureProjection`，与 `cu_scope_matches_blueprint` 同点）：与本 CU 相关（在 CU `design_refs` 中，或模块/端点落在可修改模块或其所在外层）的 `add_module` / `move_module` / `dependency_edge` 必须已 `decided_with_authority`（`open_decision` 即当前 CU 不得施工），`add_module` 的 `layer`、`move_module` 的 `from_layer`/`to_layer` 须在当前 DSL `outer_layers`；`dependency_edge` 端点须解析为获准模块或外层 id，并用既有 DSL 许可判定按操作核对——`direction: add` 要求当前 DSL **已允许**该边，`direction: remove` 要求当前 DSL **已不允许**（仍允许 = 删除未生效），不符即 FAIL。
- **`cu_architecture_dsl_other`**（WARN）：`dsl_other`（内层顺序、出口文件名等 `affected_items`）只登记不机检，提示人工核对已经权威批准并落盘。
- **归位**：`add_module` / `retire_module` / `move_module` / `responsibility_rewrite` 在蓝图期不改 catalog，对应 CU 落地后由 component closure 知识归位承接。
- **DSL 写路径**：plan 不是 writer。DSL 只经 framework-init 既有获准路径改写——`init.architecture_preset` 预设，或手工编辑 config 后本地校验并重跑 UPDATE（见上 `dsl_change` 条），统一要求权威批准（蓝图决策 `decided_with_authority` 或用户在 init registry 确认）且落盘后过 `validateArchitectureDsl`。范围或架构变化回 `/component-design` 做蓝图 revision。

## 组件选型施工投影（index 文件存在时）

字段与判据只读 [组件资产 SSOT](../../docs/concepts/component-assets.md)。Context Facts 必读 index/catalog、CU design_refs 指向的蓝图选型 decision、候选定义及 live 调用点。页面/UI 的 asset_selection 和 design_ref_mappings 由同一权威投影：目标明确且决定唯一时缺失项自动派生，plan 不必重复手填；实质冲突仍须责任方修正。rationale 保留上游施工契约的组件说明，缺失时沿决定理由；bindings 为本地施工信息，implementation_refs 定位 file#name。多组件沿 children 拆条目，不自行裁决或造 decision_ref。工具类 kind 豁免，无 index 时不新增本节产物要求。

依赖使用 components[].module→index.module 经现有 DSL helper 实时预检。evolve provider 的实际修改须披露，并核实公共契约和现行 DSL；换选返回蓝图重签，下沉须写进 plan 范围。normal 与 goal 均回设计方重签：无人值守原需求内的新边由设计 owner 自动裁决、经配置 writer 落盘后继续；有人在场保留确认，plan 不自改 DSL 或重写需求。

无人值守完整交付时，原需求内的蓝图/CU与必要架构变更由 runner 交设计 owner 静默修订、隔离质询、检查、发布和重绑后继续；不需要个人 B1 开关，不由 plan/coding 或外层主 Agent 就地自授。有人在场沿原确认流程。改变原需求或实质验收、真实秘密/不可逆外部动作、突破用户总预算或明确禁止仍须用户决定。
