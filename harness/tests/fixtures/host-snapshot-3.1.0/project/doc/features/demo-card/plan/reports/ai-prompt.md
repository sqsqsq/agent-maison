# Plan 阶段语义验证 — demo-card

**P3 显式 1.1 调用**：以已解析验收与施工内容为准，不要求未列入 required_outputs 的 spec.md/plan.md。仍审查精确文件写集、类型/接口、外部 DTO 映射、runtime 生命周期、CU sidecar 与用例；不得用缺叙述为由跳过这些责任。共同决策冲突回蓝图/外部 owner，职责修订沿既有 P2 successor，不在原 run 改写范围。

**CU-bound（Feature 名以 `cu-` 开头）**：术语、Scope 模块范围与架构影响已由部件演进蓝图裁决（可修改模块 = CU touches 派生；架构影响 = 蓝图 `architecture_impact` 决策 id 投影）。检查 3、4、7 及检查 R 中涉及这三项的判断只核对与蓝图投影一致，不重新裁决模块归属、范围扩展或架构影响等级；检查 7 在 CU-bound 下按"架构影响段 `decisions` 与蓝图决策一致"判定，不要求 plan 更新 architecture.md。不一致指回 `/component-design` 做蓝图 revision。

> 自动生成于 2026-09-25T04:32:15.357Z
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-plan.overlay.md`，须与本正文**合并阅读**。

---

## 一、你的角色

你是一名**独立的plan 审查员**，负责对实现计划（plan）做语义级质量验证。宿主分层、模块格式与实现语言以 **`project_profile` + `doc/architecture.md` + `framework.config.json > architecture`** 为准；细则可对照本阶段 profile 的 `verify-plan.overlay.md`。你的任务是根据下方提供的 **Spec 规约**、**plan 文档**和 **spec**，逐项评估plan 文档是否满足语义约束。

**关键原则：**
- 你独立于文档编写者，避免"自己验自己"的偏差
- 仅基于 Spec 规则和 spec 需求给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（章节存在性、表格格式、映射覆盖率等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: demo-card
- **阶段**: plan

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/plan-rules.yaml` 的完整内容，定义了设计阶段的通用约束规则：

```
phase: plan
version: "1.0"
applies_to: doc/features/{module}/plan/plan.md
structure_checks:
  acceptance_content_complete:
    severity: BLOCKER
    description: 显式 typed 验收须含可执行步骤、精确预期、合法 ID 与分层关注点。
  design_scope_facts:
    severity: BLOCKER
    description: 新设计事实只经既有 P2 报告提议重签，不删除冻结 required 义务。
  acceptance_use_cases_resolvable:
    severity: BLOCKER
    description: typed 验收的 linked_flow/linked_branch 必须指向真实用例。
  construction_content_complete:
    severity: BLOCKER
    description: 施工文件、类型和接口签名须完整，不能用叙述省略减弱内容检查。
  usecase_spec_schema:
    severity: BLOCKER
    description: 复用 UT 的 UseCasesSpec schema 检查，必要用例不能使用占位条目。
semantic_checks: {}
traceability_checks:
  component_asset_selection:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_asset_projection:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_export_registered:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_new_static_checks:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_uncurated:
    severity: MAJOR
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  change_unit_feature_projection:
    description: CU-bound Feature 必须以 canonical change_unit_ref 和完整 ID-only mappings
      施工，且机械派生 use-case/DAG 义务
    severity: BLOCKER
  cu_scope_matches_blueprint:
    description: CU-bound contracts.modules 必须 ⊆ 蓝图可修改模块集合（只由 CU touches 解析到
      development 节点 module）；越界回 /component-design 调和
    severity: BLOCKER
  cu_architecture_impact_not_effective:
    description: 相关
      architecture_impact（add_module/move_module/dependency_edge）须已裁决且与当前 DSL
      一致；dependency_edge 按 add/remove 核对目标许可
    severity: BLOCKER
  cu_architecture_dsl_other:
    description: architecture_impact dsl_other 只登记不机检，提示人工核对已经权威批准落盘
    severity: MAJOR
  contract_file_reference_closure:
    description: >
      contracts.yaml 中所有 schema 声明的文件引用必须属于规范化 contracts.files； files
      是唯一授权集合，现有文件或内容相同不能豁免
    severity: BLOCKER
  spec_constraint_traceability:
    description: |
      acceptance.yaml 中结构化 NFR/安全/性能/DFX 约束须在 plan.md 或 contracts.yaml 有实现引用
    severity: BLOCKER
exploration_thresholds:
  min_files_inspected: 8
  min_source_code_paths: 5
  min_searches: 5
  min_code_facts: 5
  require_subagent_when_scope_gte: 2
  exploration_mode_allowed:
    - subagent
    - sequential
exploration_strategy:
  default_mode: subagent
  trivial_exemption:
    enabled: true
    conditions_any:
      - intent:
          - rename
          - extract_function
          - move_file
          - typo_fix
      - prd_loc_delta_lt: 30
      - single_function_scope: true
  scoring:
    threshold: 60
    dimensions:
      - id: module_loc
        weight: 25
        tiers:
          - gte: 50000
            score: 25
          - gte: 20000
            score: 15
          - gte: 5000
            score: 8
      - id: scope_breadth
        weight: 20
        tiers:
          - gte: 3
            score: 20
          - gte: 2
            score: 12
          - gte: 1
            score: 5
      - id: cross_layer
        weight: 20
        signal: touches_multiple_outer_layers
        score_if_true: 20
      - id: new_api_surface
        weight: 15
        signal: adds_exports_or_public_api
        score_if_true: 15
      - id: dependency_fan_out
        weight: 20
        tiers:
          - gte: 10
            score: 20
          - gte: 5
            score: 12
          - gte: 2
            score: 5
  sequential_multiplier: 2
  sequential_min_files_inspected_add: 5

```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-plan.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{
  "phase": "plan",
  "feature": "demo-card",
  "timestamp": "2026-09-25T04:32:15.346Z",
  "project_root": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur",
  "assurance": "full",
  "capability_resolutions": [
    {
      "id": "capability_plan_context",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "fail",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "acceptance",
          "state": "resolved",
          "selected_source": "acceptance@1",
          "selected_source_fingerprint": "352b678a652cf596cc0cb311600a4590404c3d9ef08267470b868b529866a080",
          "binding": {
            "input_id": "acceptance",
            "source": {
              "kind": "artifact",
              "artifact": "acceptance@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\acceptance.yaml",
                "exists": true,
                "sha256": "b0e125f7bf85e4a13539c65fedc059e82f6d5b74f9d17b2204fe0ebbdb236f03",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/demo-card/acceptance.yaml"
            ],
            "content_fingerprint": "352b678a652cf596cc0cb311600a4590404c3d9ef08267470b868b529866a080"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "acceptance@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\acceptance.yaml",
                  "exists": true,
                  "sha256": "b0e125f7bf85e4a13539c65fedc059e82f6d5b74f9d17b2204fe0ebbdb236f03",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "spec",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\acceptance.yaml"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_plan_codebase",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "codebase",
          "state": "resolved",
          "selected_source": "derive.codebase",
          "selected_source_fingerprint": "56d19a72f750aae9bc0951705ac102fa51828b634b2d9d59717401e32651efe4",
          "binding": {
            "input_id": "codebase",
            "source": {
              "kind": "derive",
              "provider_id": "derive.codebase"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\index.ets",
                "exists": true,
                "sha256": "a9b0b1df1389f949c79b0b1f221244ba5f2301acca119841f4586d11a63f1e7d",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\AllBanksPage.ets",
                "exists": true,
                "sha256": "a2310641c4a15fe462df3c127583c97cb6b61392bd0437f13fa0783d23c2bcbb",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankModel.ets",
                "exists": true,
                "sha256": "85bf14be522a0c0815a787be2b9e1f739e86be41fb8a25b9f83f47324996b1c4",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankRepository.ets",
                "exists": true,
                "sha256": "fa10a20e27b5fa016f02a0e0608747e1f892974bb0a6cf10f7f3021e3ac3c907",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankService.ets",
                "exists": true,
                "sha256": "bca6edbcaabe61fba6090d8f396f0105962a18d13dc2eacd88d0802d58045fb6",
                "role": "derive"
              }
            ],
            "source_refs": [
              "02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets",
              "02-Feature/FinancialCard/src/main/ets/BankRepository.ets",
              "02-Feature/FinancialCard/src/main/ets/BankModel.ets",
              "02-Feature/FinancialCard/src/main/ets/BankService.ets",
              "02-Feature/FinancialCard/index.ets"
            ],
            "content_fingerprint": "56d19a72f750aae9bc0951705ac102fa51828b634b2d9d59717401e32651efe4"
          },
          "attempts": [
            {
              "kind": "derive",
              "source": "derive.codebase",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\AllBanksPage.ets",
                  "exists": true,
                  "sha256": "a2310641c4a15fe462df3c127583c97cb6b61392bd0437f13fa0783d23c2bcbb",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankRepository.ets",
                  "exists": true,
                  "sha256": "fa10a20e27b5fa016f02a0e0608747e1f892974bb0a6cf10f7f3021e3ac3c907",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankModel.ets",
                  "exists": true,
                  "sha256": "85bf14be522a0c0815a787be2b9e1f739e86be41fb8a25b9f83f47324996b1c4",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankService.ets",
                  "exists": true,
                  "sha256": "bca6edbcaabe61fba6090d8f396f0105962a18d13dc2eacd88d0802d58045fb6",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\index.ets",
                  "exists": true,
                  "sha256": "a9b0b1df1389f949c79b0b1f221244ba5f2301acca119841f4586d11a63f1e7d",
                  "role": "derive"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "capability_plan_existing_design",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "contracts",
          "state": "resolved",
          "selected_source": "contracts@1",
          "selected_source_fingerprint": "93c49db2c4ed32f462a1dd1f4c29e576704f41b04f53b5f9b457dd86597fa8c1",
          "binding": {
            "input_id": "contracts",
            "source": {
              "kind": "artifact",
              "artifact": "contracts@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\contracts.yaml",
                "exists": true,
                "sha256": "62d1104bc2c30d70e590280deb55788b3cca87b43442882ffc1635caa2931db0",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/demo-card/contracts.yaml"
            ],
            "content_fingerprint": "93c49db2c4ed32f462a1dd1f4c29e576704f41b04f53b5f9b457dd86597fa8c1"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "contracts@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\contracts.yaml",
                  "exists": true,
                  "sha256": "62d1104bc2c30d70e590280deb55788b3cca87b43442882ffc1635caa2931db0",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\contracts.yaml"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_plan_visual_context",
      "axis": "visual",
      "active": false,
      "state": "not_applicable",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.ui",
      "applicability_dependencies": [],
      "applicability_detail": "visual-evidence explicitly not applicable",
      "inputs": []
    }
  ],
  "capability_resolution_contract_fingerprint": "7f14954ae8ce523af21a02485241f8ad2e7aa4e32a7d6acd993a9415b8fffd12",
  "checks": [],
  "summary": {
    "total": 15,
    "pass": 15,
    "fail": 0,
    "warn": 0,
    "skip": 0,
    "blockers": 0,
    "verdict": "PASS"
  },
  "passed_check_ids": [
    "node_options_injection",
    "construction_content_complete",
    "acceptance_use_cases_resolvable",
    "contract_file_reference_closure",
    "spec_constraint_traceability",
    "acceptance_yaml_present",
    "acceptance_content_complete",
    "acceptance_ut_layer_complete",
    "acceptance_device_focus_present",
    "legacy_device_testing_todo_deprecated",
    "context_exploration_facts_phase_delta_present",
    "design_scope_facts",
    "capability_plan_context",
    "capability_plan_codebase",
    "capability_plan_existing_design"
  ]
}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 10 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: 五层架构合规性 (five_layer_compliance)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 阅读模块架构图中的 Mermaid 图和模块变更摘要表
  2. 逐个模块检查是否在正确的架构层：
     - 01-Product：应用/产品壳层主入口（模块格式以 catalog 与设计为准）
     - 02-Feature：特性层功能模块（可含业务 UI 与数据）
     - 03-CommonBusiness：跨 Feature 共享的业务能力
     - 04-BusinessBase：基础业务能力（账号、鉴权与外部结算能力等）
     - 05-SystemBase：与业务无关的基础工具（UI 组件、工具类）
  3. 检查依赖方向是否全部自上而下（01→02→03→04→05），不允许逆向依赖
  4. 检查 Feature 子层级是否合理（如 02-Feature 内部模块不应互相依赖）

### 检查 2: 模块内四层合规性 (module_internal_layer_compliance)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 逐个文件检查其路径是否符合 shared/data/domain/presentation 四层规则：
     - `shared/`：常量、工具、公共组件
     - `data/model/`：数据模型定义
     - `data/repository/`：数据仓库（模拟数据封装）
     - `domain/service/`：领域服务
     - `presentation/pages/`：页面
     - `presentation/components/`：UI 组件
  2. 重点检查：
     - 模型类是否放在 data/model 而非 presentation
     - Repository 是否放在 data/repository 而非 domain
     - 页面是否放在 presentation/pages 而非根目录

### 检查 3: 模块最小性 (module_minimality)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐个审查新增模块，确认每个模块都有 spec 功能点直接驱动
  2. 检查「不创建的模块」章节是否合理解释了排除原因
  3. 若存在没有 spec 功能引用的新增模块，判为 FAIL
  4. 若 03-CommonBusiness 层创建了模块但无跨 Feature 共享需求，判为 FAIL

### 检查 4: 功能拆分合理性 (feature_split_accuracy)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐条审查 spec 功能映射表中的「分配模块」列
  2. 判断每个功能点是否分配到了职责最匹配的模块：
     - 账号相关 → AccountManager
     - 通用 UI 组件 → CommUI
     - 工具能力（日志、格式化）→ CommFunc
     - 页面 UI 和业务逻辑 → Feature 层对应模块
  3. 若功能拆分存在明显的职责混乱（如业务逻辑放在 SystemBase 层），判为 FAIL

### 检查 5: 数据类型合法性 (data_type_legality)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 审查「数据模型定义」中所有代码块里的字段类型
  2. 确认都是**当前宿主/设计约定**的合法类型（禁止无依据的 `any`、松散 `object`）：
     - 基础类型：string、number、boolean（及宿主等价物）
     - 平台类型：由 profile/设计声明的资源、样式、国际化等类型（若有）
     - 集合类型：Array、Map 或宿主等价集合
     - 自定义枚举：在文档中有定义
     - 可空标记：文档中与宿主一致的联合/可空写法（如 `Type | null`）
  3. 不允许使用 `any`、`object`（无约束）、或未定义的自造类型
  4. 若发现非法类型，逐一列出

### 检查 6: P0/P1 无未决项 (no_tbd_in_p0_p1)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 在设计文档全文中搜索以下标记：
     - "待定"、"TBD"、"TODO"、"待确认"、"待补充"、"后续"
  2. 对找到的每处标记，判断其是否在 P0/P1 功能的上下文中
  3. P0/P1 范围内存在任何未决标记，判为 FAIL
  4. P2 或附录中的未决标记可标为 WARN

### 检查 7: 架构文档一致性 (architecture_doc_consistency)

- **严重等级**: MAJOR
- **前置条件**: 先读取 plan.md「架构影响声明 (architecture_impact)」子节中的 yaml，获取 `impact` 字段
- **评估方法**:
  1. **若 `impact == none`** —— 直接返回 `status: NOT_APPLICABLE`（在 YAML 中使用 `status: PASS` 并在 details 注明"architecture_impact=none，feature 级变更不要求与 architecture.md 对齐"），**不再**做任何对比
  2. **若 `impact != none`**：
     - 对比 plan.md 中的「分层归属（外层 id）」、「跨模块依赖边」、「出口约定（`architecture.cross_module_exports_file` 声明的文件名）」与 `doc/architecture.md` 及 `framework.config.json > architecture` 是否一致
     - **不要**比对业务模块清单的行级细节（该职责已由 `doc/module-catalog.yaml` 承担）
     - 对照 plan.md「架构影响声明.architecture_md_updates」列出的每一条，核查相应更新是否已在 architecture.md 中落盘（业务模块清单行、架构级变更记录条目、分层/依赖/出口章节等）
     - 若分层 / 依赖边 / 出口约定存在不一致且未在 plan 中说明差异原因，判为 FAIL
     - 若 `architecture_md_updates` 中声明的更新未在 architecture.md 中找到对应落盘证据，判为 FAIL
  3. 若 architecture.md 不在上下文文件中，标为 WARN

### 检查 8: 导航流程一致性 (navigation_flow_consistency)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 plan.md 的「路由/导航设计」中提取页面跳转路径
  2. 从 spec 的「业务流程图」中提取业务操作流转
  3. 对比：
     - spec 中每条跳转路径是否在导航设计中有对应配置
     - 导航设计中的返回路径是否与 spec 流程一致
     - 路由设计中的目标页 / 路由项是否覆盖 spec 流程中的每条跳转（宿主导航 API 以 `project_profile` 为准；补充语义见同目录 `verify-plan.overlay.md`，由 profile 挂载）
  4. 若存在 spec 流程图中的路径在导航设计中缺失，判为 FAIL

### 检查 9: 验收标准到接口追溯 (acceptance_to_interface)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 spec 的验收标准中提取涉及数据展示/操作的 AC 项
  2. 对每条 AC，在 plan.md 中查找支撑实现的：
     - 数据模型（是否有对应字段来存储 AC 描述的数据）
     - 接口方法（是否有方法来获取/操作 AC 描述的数据）
     - 组件定义（是否有 UI 组件来展示 AC 描述的内容）
  3. 对每条 P0 AC 给出追溯结果
  4. 若 P0 AC 在设计中找不到任何支撑，判为 FAIL

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 逐条核对本阶段产物里的跨文件引用——plan 引用的验收标准编号、接口名、模块路径 ↔ spec.md / contracts.yaml / architecture.md 中的真实条目。每条引用都要打开被引用的原文核对，不凭记忆、不凭上下文摘要。
- **判定标准**: 引用对象存在且含义一致 → PASS；个别引用漂移（行号/名称过期但对象仍可定位） → WARN；关键引用指向不存在或含义相反的对象 → FAIL
- **证据**: 列出核对过的引用（`引用 → 原文位置`）与不一致项


---

## 六、上下文文件

以下是本次验证的上下文：被审产物与直接依据内联；上游文档与源码只给**路径清单**，需要核对时用 Read 按路径读取，不要全量通读。

被审 feature 根目录：`doc/features/demo-card/`（相对仓根；下方清单里的相对路径同样相对仓根）。

### (resolved input acceptance)

```
feature: demo-card
source: approved
version: "1"
flows:
  open_card:
    - all_banks
    - open_card_entry
criteria:
  - id: AC-1
    feature: F2
    description: 点击银行条目进入开卡流程
    target: 银行条目
    priority: P0
    testable: true
    verification_steps:
      - 在全部银行页点击银行条目
    expected_result: 进入开卡流程页
    ut_layer: device
    device_focus: 真机点击银行条目核对跳转开卡流程
    linked_flow: open_card
    checkpoint:
      pre_screen: all_banks
      action:
        type: touch
        target_element_id: bank_row_cmb
      post_screen: open_card_entry
      required_element_ids:
        - open_card_title
    requirement_ref:
      source_path: doc/features/demo-card/requirements/requirement.md
      snippet: 点击银行条目进入开卡流程
  - id: AC-2
    feature: F1
    description: 银行列表展示
    target: 银行列表
    priority: P1
    testable: true
    verification_steps:
      - 打开全部银行页
    expected_result: 列表展示银行条目
    ut_layer: both
    ut_focus: AllBanksPage 列表渲染
    device_focus: 真机打开全部银行页核对列表渲染
boundaries: []

```

### (resolved input codebase)

```
- path: 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  content: |
    @Component
    export struct AllBanksPage {
      build() {
        Text("全部银行")
      }
    }
- path: 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  content: |
    export class BankRepository {
      list(): string[] { return []; }
    }
- path: 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  content: |
    export interface BankModel {
      id: string;
      name: string;
    }
- path: 02-Feature/FinancialCard/src/main/ets/BankService.ets
  content: |
    export class BankService {
      openCard(id: string): Promise<boolean> { return Promise.resolve(!!id); }
    }
- path: 02-Feature/FinancialCard/index.ets
  content: |
    export { AllBanksPage } from './src/main/ets/AllBanksPage';

```

### (resolved input contracts)

```
feature: demo-card
source: approved
version: "1"
modules:
  - name: FinancialCard
    layer: 02-Feature
    package_path: 02-Feature/FinancialCard
files:
  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  - 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  - 02-Feature/FinancialCard/src/main/ets/BankService.ets
  - 02-Feature/FinancialCard/index.ets
  - 02-Feature/FinancialCard/src/main/ets/BankListItem.ets
  - 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png
  - 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png
module_dependencies: {}
data_models: []
interfaces: []
components: []
prd_to_code_traceability:
  - prd_id: AC-1
    key_files:
      - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - prd_id: AC-2
    key_files:
      - 02-Feature/FinancialCard/src/main/ets/BankService.ets

```

### doc/features/demo-card/contracts.yaml

```
feature: demo-card
source: approved
version: '1'
modules:
  - name: FinancialCard
    layer: 02-Feature
    package_path: 02-Feature/FinancialCard
files:
  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  - 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  - 02-Feature/FinancialCard/src/main/ets/BankService.ets
  - 02-Feature/FinancialCard/index.ets
  - 02-Feature/FinancialCard/src/main/ets/BankListItem.ets
  - 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png
  - 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png
module_dependencies: {}
data_models: []
interfaces: []
components: []
prd_to_code_traceability:
  - prd_id: AC-1
    key_files:
      - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - prd_id: AC-2
    key_files:
      - 02-Feature/FinancialCard/src/main/ets/BankService.ets

```

### doc/features/demo-card/context/facts.md

```
---
schema_version: "1.1"
feature: demo-card
run_id: 20260925T043142Z-233c9c
established_by: spec
ready_to_produce: true
has_blocker_coverage_risk: false
exploration_mode: sequential
key_inputs_read:
  - doc/glossary.yaml
  - doc/module-catalog.yaml
  - doc/architecture.md
subagents_used: none
decisions_unlocked:
  - all_banks_page_list
files_inspected_count: 9
searches_performed_estimate: 6
source_code_paths:
  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  - 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  - 02-Feature/FinancialCard/src/main/ets/BankService.ets
  - 02-Feature/FinancialCard/index.ets
---

## Code Facts

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets | AllBanksPage 目前只渲染标题文本 | 列表需新增 |
| 02-Feature/FinancialCard/src/main/ets/BankRepository.ets | BankRepository.list 返回空数组 | 列表数据源需接入 |
| 02-Feature/FinancialCard/src/main/ets/BankModel.ets | BankModel 已定义银行字段 | 列表条目直接复用 |
| 02-Feature/FinancialCard/src/main/ets/BankService.ets | BankService 暴露 openCard 入口 | 点击回调接它 |
| 02-Feature/FinancialCard/index.ets | index.ets 已导出 AllBanksPage | 新增组件需同步导出 |

## phase_delta: spec

本阶段研究结论已确认。

## phase_delta: plan

本阶段研究结论已确认。

```

---

## 七、输出格式（必须严格遵循）

先给**汇总表**（每个检查项一行，PASS 也要列），再只对 **status ≠ PASS** 的项写 YAML 明细。
PASS 项不写论证，证据一行即可；证据不足时给 WARN 并说明缺什么，不要硬判 FAIL。
不要复述脚本 Harness 已判定的结构项，不要输出本节之外的自由文本。

本轮检查项与严重等级：

| id | severity |
|---|---|
| five_layer_compliance | BLOCKER |
| module_internal_layer_compliance | BLOCKER |
| module_minimality | MAJOR |
| feature_split_accuracy | MAJOR |
| data_type_legality | BLOCKER |
| no_tbd_in_p0_p1 | BLOCKER |
| architecture_doc_consistency | MAJOR |
| navigation_flow_consistency | MAJOR |
| acceptance_to_interface | MAJOR |
| reference_crosscheck | MAJOR |

### 7.1 汇总表

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| <check_id> | PASS / WARN / FAIL / SKIP | <severity> | <一行证据> |

### 7.2 非 PASS 项明细

```yaml
verification_result:
  phase: "plan"
  feature: "demo-card"
  timestamp: "2026-09-25T04:32:15.357Z"
  checks:            # 只列 status ≠ PASS 的项；每项字段固定
    - id: <check_id>
      status: FAIL | WARN | SKIP
      severity: <该项声明的 severity>
      details: |
        <证据：文件路径 + 行号/引文 + 判断依据>
      suggestion: |
        <修正建议：谁改、改哪个文件、改成什么>
  summary:
    total: 10
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（章节存在性、表格列完整性、spec 覆盖率等）
2. 若设计文档缺少某个章节导致无法进行语义检查，将该检查标为 WARN 并说明原因
3. 本项目为模拟应用，数据全部写死——对"模拟数据"的类型合法性检查应适度宽容
4. 对每一项检查，请给出**具体的文档证据**（章节名 + 关键引文 / 文件路径），而非泛泛而谈
5. 五层架构和四层规则是 BLOCKER 级别，严格审查依赖方向和文件放置位置

---

## 终态块（唯一版本化结论出口 · 必填）

> **你收到的 Task prompt 是一份 request JSON**（`kind: "maison_verifier_request"`），
> 不是本文件全文。按其中的 `prompt_path` 用 Read 工具读取磁盘上的 `ai-prompt.md`，
> 那才是本轮要审的材料（可达上百 KB，刻意不走传输面）。
>
> 结束时，回答的**最后**必须且只能出现一个终态块，`verifier_subject_id` **逐字回显**
> request 里的 `subject_id`（不得改写、不得截断、不得自行编造）：
>
> ```
> <!-- maison-verifier-result:v1 -->
> verifier_subject_id: <request.subject_id，64 位小写 hex>
> verdict: PASS | FAIL
> blocker_count: <BLOCKER 级 FAIL 数量，整数>
> <!-- /maison-verifier-result:v1 -->
> ```
>
> `verdict=PASS` 当且仅当 `blocker_count=0`；两者不一致的报告一律判为无效证据。
>
> 若你收到的**不是**这样一份 request JSON（例如被手抄成模板、只给了 feature/phase，
> 或 JSON 前后夹带了额外指令）：照常输出审查结论，并在正文显著位置说明
> 「未收到合法 verifier request，本次报告不可入闭环，请调用方把
> `summary.verifier_request` 指向的 JSON 整段重投」。**不要自行编造 subject。**
