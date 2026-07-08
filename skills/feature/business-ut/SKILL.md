# 业务级 UT Skill (`business-ut` · v2.1)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `ut.plan_confirm` / `ut.mock_plan` / `ut.src_mutation` / `ut.dag_confirm` / `ut.ok_to_testing` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)（harness 之后用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`；只有精确目录是正式 feature，同名归档/前缀条目只是旁证不得读取。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。展示输入矩阵（spec/plan/contracts/acceptance/use-cases 是否存在）；输入缺失回上游补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/business-ut/profile-addendum.md` 时先读（测试源树/命令形态/禁入符号清单等宿主细则）。
- **Lite Mode 判定 / Step 1.0 摘取协议 / Step 1.5 可测性预检 / Step 1.6 Test Double Plan / Step 2 DAG 字段 / Step 3 代码示例与打桩形式 / Step 7.5 编译闭环 / Step 7.6 装机运行闭环与设备失败决策树 / Step 8.0 Core 节点闸门 / 约束#12 HARD STOP 完整流程**：完整读 [business-ut-workflow-detail.md](../../reference/business-ut-workflow-detail.md)。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](../../reference/agent-behavioral-principles.md)。**Research Sub-Phase 完成前禁止输出 UT 规划清单。**
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

## 概述

资深宿主侧业务级 UT 工程师：作为**既有代码的消费者**，读懂业务编排源码（coding 自选形态）与 data 层源码，产出可通过 harness 出口检查的 UT + DAG。UT 运行框架/编译/执行链路以当前 `project_profile` addendum 与 `ut.compile`/`ut.run` capabilities 为准。流水线**第五环**，上游 plan（`use-cases.yaml`，条件式）/coding/code-review，输出流入 device-testing（消费 `acceptance.yaml > device_focus`）。

## 触发条件

"生成 UT"、"生成单元测试"、"写 UT"、"业务级 UT"、"端到端测试"、"UseCase 测试"、"分支覆盖 UT"、"生成 SpyPort/生成打桩类"、"存量 UT"、"回归网"、"characterization 测试"、"基于日志生成 UT"、"给现有流程补测试"。

### 三路径路由（同触发词「生成 UT」）

| 条件 | 路径 | 细则 |
|------|------|------|
| 有 `use-cases.yaml` | path-a | 本文 Step 1~3（UseCase 驱动） |
| 无 use-cases，有 `acceptance.yaml` | path-b | 按 AC/BD + DAG |
| 均无且提供脱敏日志切片 | path-c | [`paths/path-c-characterization.md`](paths/path-c-characterization.md) |
| 否则 | — | 提示先运行 spec 阶段 |

**模块级 seam/mock**：feature 级 audit/mock-plan 优先引用 `doc/modules/<module>/ut-registry/`（见 `` `profile-skill-asset:business-ut/module_seam_registry_schema` ``）。

## 核心理念（v2.1）：UT 是既有代码的消费者，不驱动架构

- 🟢 复杂 feature（有 `use-cases.yaml`）：按 `ui_bindings[].user_actions[].calls` 声明的**命名函数**直接调用；在 `data_boundaries` 处打桩；断言 state 序列 + 调用序列 + 持久化数据。
- 🟢 简单 feature（无 `use-cases.yaml`）：按 `acceptance.yaml` + `dag.yaml`，直接针对 data 层函数/Repository/导出工具函数写 UT，不要硬凑 UseCase 架构。
- 🔴 UI 层绝对禁入 UT：不 import profile addendum 声明的 UI/资源/页面运行时符号，harness BLOCKER 拦截。
- 🔴 不要为了 UT 反过来改架构：业务嵌在 inline lambda 时反馈 coding 抽出命名方法，不要在 UT 里实例化 UI 组件。

**关键澄清**：被测单元 = 命名业务入口（非强制 UseCase 类）；外部依赖抽象用 `data_boundaries[]`（引用 contracts.yaml 既有 data 层类，非新造 Port）；无 UseCase 代码产物，`use-cases.yaml` 只是文档规约；Stub 用子类化/原型替换（非实现 Port 接口）；一个 `it()` 端到端驱动一个 branch（或一条 AC/BD），断言含 state 序列+调用序列+数据；UI 交互交 device-testing。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| `use-cases.yaml` | ⚠️仅复杂 feature | plan 产出，含 coordinator/ui_bindings/data_boundaries/state_model/branches，主规划来源 |
| 业务编排源代码 | ✅ | coding 产出，代码形态自选 |
| data 层源代码 | ✅ | UT 在 profile 允许边界打桩 |
| contracts.yaml | ✅ | `data_boundaries[].type` 须来自 `interfaces[].class` |
| acceptance.yaml | ✅ | 含 `ut_layer`；简单 feature 时是主规划来源 |
| `ut/testability-audit.md` | ✅ | Step 1.5 产出 |
| `ut/mock-plan.yaml` | ⚠️存在 L0/L1/L2 可测项时必填 | Step 1.6 产出 |
| plan.md / spec.md / doc/architecture.md | ✅ | 上下文 |

**缺 use-cases.yaml**：不阻塞，按 acceptance.yaml + dag.yaml 直接写 UT；WARN 非 BLOCKER；严禁为此回头要求补 use-cases.yaml 套架构。**缺 acceptance.yaml**：提示先运行 spec 阶段。

## 规约参考

| 规约 | 路径 |
|------|------|
| UseCase Schema / DAG Schema(v2) | `` `profile-skill-asset:business-ut/use_cases_schema` `` / `` `profile-skill-asset:business-ut/dag_schema` `` |
| UT+Spy 模板 / 打桩策略 | `` `profile-skill-asset:business-ut/ut_template` `` / `` `profile-skill-asset:business-ut/mock_strategy` `` |
| 可测性预检模板 / mock-plan Schema | `` `profile-skill-asset:business-ut/testability_audit_template` `` / `` `profile-skill-asset:business-ut/mock_plan_schema` `` |
| 规范级样例 | `` `profile-skill-asset:business-ut/sample_flow_dir` `` |

## UT 可测性/mock-plan 策略决议（v2.3 · SSOT）

1. **存量 feature 迁移**：仅当再次进入 business-ut 并变更 UT 相关产物才回补 audit/mock-plan；新 feature 一律强制。
2. **L3+option_b 接缝白名单**：仅允许构造注入/包装 wrapper/提取命名方法/setter 注入；禁止"换一种全局单例"式敷衍。
3. **可测性预检独立切入**：只想完成 Step 1.5/1.6 后暂停须在入口明确告知 agent；完整闭环仍由 `/business-ut` 收尾。

## 流程骨架

1. **Step 1 规划 DAG 与 UT**：先判 Lite Mode（≤7 条 unit/both AC/BD 且全 L0/L1 且无 use-cases.yaml，详见 reference）→ Step 1.0 Research Sub-Phase（Context Facts Gate·C4，rg 签名摘取 ≤300 行，追加 facts.md 的 `## phase_delta: ut` 节，详见 reference）→ 按路径 A（branches×ui_bindings）或路径 B（AC/BD 逐条）列「UT 规划清单」→ **HARD STOP `ut.plan_confirm`**：`1=确认` `2=调整`，未确认禁止写文件。
2. **Step 1.5 可测性预检**（`ut/testability-audit.md`，详见 reference）：对每条 unit/both AC/BD 给 L0-L3 结论；**L3 必须 STOP** 展示 option_a(降级 device-only)/option_b(源码改造+gap-notes 授权) 由用户选择，全部选完才可继续。
3. **Step 1.6 Test Double Plan**（`ut/mock-plan.yaml`，详见 reference）：`target_class`/`methods` 须对齐 contracts.yaml；策略 spy/mockkit/fake 选型；**HARD STOP `ut.mock_plan`**：`1=确认` `2=调整`。
4. **Step 2 生成 DAG**：默认 ephemeral 写入 `ut/reports/flow-dag/`（触及 Code Graph core 节点或用户要求才归档 `{module}/test/dag/`）；必填字段与节点类型详见 reference；展示 Mermaid **HARD STOP `ut.dag_confirm`**：`1=确认` `2=修改`。
5. **Step 3.0 写入路径 Gate**：`<repo-root>` 非 `framework/harness`；上一条 shell 为 `cd framework/harness` 时 Write 前须先 `cd <repo-root>` 或用绝对路径；禁止 Write 到 `framework/harness/` 下宿主源码。
6. **Step 3 生成 UT 代码**：路径 A/B 骨架、打桩三形式、断言要求、命名规则、import 白名单，完整示例详见 reference。
7. **Step 4 测试注册**：套件注册入口登记新增用例；测试框架依赖已声明；无测试目录时按 profile 标准目录创建。
8. **Step 5 质量门禁自检**（14 项，见门禁清单表 + reference 详述）。
9. **Step 6 机器回执**：harness PASS 后写 `ut/reports/ac-coverage.json`（unit 层覆盖摘要，非 SSOT）；device/both 缺 `device_focus` 回 spec 补全，不新建平行 todo。
10. **Step 7 输出交付摘要**：UseCase/DAG/UT 文件清单 + 覆盖率统计 → 下一步指向 Step 8 Harness 验证。
11. **Step 7.5/7.6 编译与装机运行闭环**（必要出口，详见 reference）：`ut.compile`/`ut.run` 是必要出口非可选；自闭环修复策略按错误类型分类；**触及业务源码进约束#12 HARD STOP**；设备失败按 selfHealable/needsConfirmation/externalBlocked/clear 四类分流；绝不允许把"无设备"标 SKIP/PASS。
12. **Step 8 Harness 验证门禁**：见下方门禁清单表；`stale_diff_base` 自动 `HARNESS_DIFF_BASE_REF=working` 重跑；`summary.verdict=INCOMPLETE`（device 阻塞）不满足闭环；状态面板须完整贴给用户。
13. **Step 8.0 Core 节点闭环闸门**：改动触及 Code Graph `core: true` 节点时启动可行性探测+更新图谱+同步 characterization/spec-driven UT（详见 reference）。
14. **Step 8.2 AI Harness**：主动通过 Task 工具触发 `subagent_type: verifier`，prompt 模板 `framework/harness/prompts/verify-ut.md`（state_model_completeness / ui_bindings_completeness / end_to_end_driving(BLOCKER) / branch_coverage_semantic / device_ac_delegation / stub_reasonableness / test_isolation）。

## 门禁清单表（v2.1 检查覆盖项）

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| usecase_spec_recommended | 复杂度达阈值时建议产出 use-cases.yaml | WARN |
| usecase_spec_schema | use-cases.yaml schema 合规 | BLOCKER |
| usecase_ui_bindings_nonempty | 每个 use_case 的 ui_bindings & user_actions 非空 | BLOCKER |
| boundary_matches_contracts | data_boundaries[].type 在 contracts.yaml 中 | MAJOR |
| named_business_handler | calls 所列符号是命名符号非匿名 lambda | BLOCKER |
| dag_linked_usecase | DAG.use_case 回指 use-cases.yaml | BLOCKER |
| dag_boundary_matches_spec | port_call_* 节点 boundary 匹配 | MAJOR |
| dag_node_type_valid | 节点类型合法 | BLOCKER |
| ut_import_whitelist | UT 未 import 禁止清单符号 | BLOCKER |
| ut_tsc_compiles | UT 文件 tsc --noEmit 零 Error | BLOCKER |
| boundaries_all_stubbed | 每个 data_boundary 有替身证据 | BLOCKER |
| it_name_has_ac_or_branch_tag | 用例名带 [AC-X]/[BRANCH-X] 标签 | BLOCKER |
| it_drives_flow | 路径 A 严格判；路径 B 退化为 ≥2 expect | MAJOR |
| branch_coverage_full | 每个 branch 都有对应 it() | BLOCKER |
| ut_case_per_unit_ac | 每条 unit/both P0/P1 AC 都有 it() | BLOCKER |
| acceptance_coverage | 分母只计 ut_layer∈{unit,both} | BLOCKER |
| boundary_coverage | 每条 unit/both 的 BD 都有覆盖 | MAJOR |

不通过项定位后自动修复重检，直到全部通过。

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature {feature} --summary --failures-only
```

优先读 `summary.json`，禁止用 `grep` 解析完整控制台日志。

## 阶段闭环判定（全局入口 §5.1，四条件缺一不可）

1. `<features_dir>/<feature>/ut/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS；4. 完成回执经 `check-receipt.ts` 校验通过。四项全满足后业务级 UT 阶段完成，**具备**进 device-testing 的资格；**不授权**自动开 device-testing。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：须 **`ut.ok_to_testing`** 或 **`phase.next_step`** 停等（除非 batch 授权）。物理拦截层会读 `.current-phase.json` 与上述四份凭证决定能否放行。

## 约束与注意事项

1. UT 是消费者不驱动架构：绝对禁止为了 UT 反向要求 plan 新增特定目录类/接口；抽出命名方法而非在 UT 里实例化 UI 组件。
2. use-cases.yaml 非必需，仅复杂 feature 才有。
3. 分支 1:1 映射（路径 A）：branches ↔ DAG branches ↔ UT it() 严格 1:1（允许 1 个 DAG 覆盖多分支，总并集需覆盖全部）。
4. AC 分层：只测 ut_layer∈{unit,both}；device 的 AC 须在 `device_focus` 声明，绝不在 UT 硬凑。
5. Mock 不真调：严禁真实网络/系统 API/IO。
6. 用例隔离：beforeEach 重建替身；原型替换须 afterEach 还原。
7. 替身类型须与 contracts.yaml 既有类签名一致。
8. ut_import_whitelist 强约束。
9. P0 优先，再扩展 P1/P2。
10. DAG/UT description 用中文。
11. Harness 验证闭环：agent 必须自跑 Step 8 + 主动触发 verifier；`ut_no_src_mutation` 报告历史变更多时优先怀疑 diff 基线过旧，设 `HARNESS_DIFF_BASE_REF=working`，禁止要求用户"批量授权历史变更"。
12. **【HARD STOP 不可绕过】禁止擅自修改业务源码**：完整流程（动手前 `ut.src_mutation` 请求→用户书面同意→gap-notes.md 登记 `approved_src_mutations[]`→未登记视为违规触发 `ut_no_src_mutation`→禁止的"便利性"借口清单→headless/goal-mode 默认拒绝）见 [business-ut-workflow-detail.md](../../reference/business-ut-workflow-detail.md)。违反会被 code-review 追溯标记为质量事件。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/business-ut-workflow-detail.md](../../reference/business-ut-workflow-detail.md) |
| 阶段级规约 | `framework/specs/phase-rules/ut-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-ut.ts` |
| AI Harness Prompt | `framework/harness/prompts/verify-ut.md` |
| Trace | `<features_dir>/<feature>/ut/reports/<timestamp>/<model>-ut/trace.json`（phase=ut）+ 同目录 `gap-notes.md` |

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **device-testing** | acceptance.yaml(device_focus) + UT + DAG | 真机 test-plan 与追溯 |
| **Harness（验证层）** | use-cases.yaml + DAG + UT | 脚本/AI 验证 UT 质量 |
| **开发者** | DAG + 业务编排源码 | 理解业务流程，维护 UT |

## Slash/trace 约定

通过 `/business-ut` 或等价快捷入口触发时，须在阶段结束时产出 trace 凭证：`<features_dir>/<feature>/ut/reports/<timestamp>/<model>-ut/trace.json`（Schema：[trace.schema.json](../../../../harness/trace/trace.schema.json)，`phase: ut`）；同目录 `gap-notes.md`（模板 [gap-notes.template.md](../../../../harness/trace/gap-notes.template.md)）。

## 运行时交付约定（内网/弱模型）

```
<features_dir>/<feature>/ut/reports/<timestamp>/<model>-ut/
├── trace.json             # phase = "ut"
├── gap-notes.md
├── check-ut.report.md
└── verifier.report.md     # verifier 跑 verify-ut.md（可选）
```
