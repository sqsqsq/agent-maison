# Plan 阶段 Skill (`plan`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `plan.scope_expansion` / `plan.ok_to_code` / `plan.arch_impact` / `plan.split_table` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。只有精确目录是正式 feature，同级归档/同名前缀条目仅旁证；目录不存在须快速失败提示先创建；输入缺失（至少 `spec.md`）须报告并回到 spec 阶段补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/plan/profile-addendum.md` 时先读。
- **Step 2.5（Scope 扩展提议）/ Step 6（UseCase 判定）/ Step 11（contracts.yaml 提取）/ Step 12（架构影响判定）执行前**：完整读 [plan-workflow-detail.md](../../reference/plan-workflow-detail.md)——扩展提议全流程、UseCase 复杂度判定与 schema、contracts 字段表、架构影响五分支全部细则均在那里。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](../../reference/agent-behavioral-principles.md)。**Research Sub-Phase 完成前禁止进入 Scope 冻结及后续 plan 撰写。**
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

## 概述

按当前 `project_profile` 自适配的实现规划师：把 spec 转化为可落地的实现计划。流水线**第二环**，上游 `spec.md`，输出流入 coding。

| 叙述产物 | 路径 | 寿命 |
|----------|------|------|
| plan.md（契约草案/来源） | `<features_dir>/<f>/plan/plan.md` | ephemeral（全链路闭环后可归档降级） |
| contracts.yaml / use-cases.yaml（**机器契约真源**） | `<features_dir>/<f>/` | 中生命周期（持续到 review/UT/testing） |

coding/review/UT/harness **一律优先读 `contracts.yaml`**，避免与 plan.md 双源分叉。

## 触发条件

"实现计划"、"写 plan"、"模块规划"、"接口草案"，或明确指向一份 spec.md 要求生成实现计划。

## 核心架构认知

开始设计前必须读 `doc/architecture.md`（模块架构唯一事实来源），以 `framework.config.json > architecture` 为机器可读依赖规则：①外层依赖只按 `outer_layers[].can_depend_on` 放行；②同层依赖按 `intra_layer_deps`（forbid/dag/sublayer）裁决；③模块内依赖顺序按 `module_inner_layers`+`inner_dependency_direction`；④跨模块访问经 `cross_module_exports_file` 出口；⑤profile 专属目录/语言/格式以 Step 0 addendum 为准。

**功能拆分核心任务**：把 spec 功能点分配到 catalog/architecture 已声明的模块，跨模块依赖不超过 `can_depend_on`；页面/UI→业务模块 presentation；应用壳→壳模块；细分子域→独立业务模块；横切能力→catalog 权威模块；通用 UI/工具→公共模块或 sublayer；无需求不新增模块。

## 输入

| 输入项 | 必需 |
|--------|------|
| spec.md | ✅ |
| 功能模块名称 | ✅ |
| doc/architecture.md | ✅ |
| 当前工程代码（AI 自动读取） | ✅ |

缺 spec.md → 提示先跑 spec 阶段。

## 层边界（BLOCKER）

用户仅表达"修订 plan/改 contracts"未同时要求编码（"开始编码/按 plan 实现/写代码"），**只激活本 Skill**，本轮定性为 plan 迭代，不自动滑入 coding。plan 迭代回合内**禁止**新增/修改实现层产物（业务模块源代码树内、`contracts.yaml`/`plan.md` 约定的可编译交付路径），仅可改 plan 侧 SSOT 与文档。中途修正按 AGENTS §4.0 修正三问分层。落盘 → harness → 停等人审：每次 plan.md 写盘后须立即跑 Step 13.1，通过后须 **`plan.ok_to_code` 编号确认**（`1=OK 可编码` `2=继续改 plan`）才能进 coding；即使历史阶段已跑通，本轮改了 plan 侧 SSOT 也重新适用。

## 流程骨架

1. **读取分析 spec**：功能清单/页面列表/业务流程/数据实体/验收标准 → 功能点清单。
2. **读架构文档 & 分析工程结构**：`doc/architecture.md` 已有模块/依赖/公共能力 → 交叉验证代码现状 → 确定新建/修改模块。
3. **Research Sub-Phase**（Context Facts Gate·BLOCKER，功能拆分与 Scope 冻结前完成，C4）：必读 spec/acceptance/architecture/catalog/config + Step 2 规划的全部源码路径（`source_code_paths` ≥5）；plan 阶段**默认 MUST** subagent（仅 L1 trivial 可豁免）；追加 `<features_dir>/<feature>/context/facts.md` 的 `## phase_delta: plan` 节（无新增事实写 "none"；facts.md 由 spec 阶段建立，本阶段不重做全量探索）。
4. **Scope 继承与扩展提议**（详见 reference）：继承 spec Scope 并冻结 `in_scope_modules`；扩展须走提议流程经 `plan.scope_expansion` 用户确认。
5. **功能拆分到模块**：逐功能点分配模块（须落在 in_scope 内），输出拆分表（`plan.split_table`：`1=确认` `2=修改`）。
6. **设计模块架构**：Mermaid 依赖图 + 目录/文件结构规划 + 模块配置变更清单。
7. **设计数据层**：数据模型（interface/class+字段）、数据仓库（方法签名+来源+异步策略）、端云接口（如有远程数据）。
8. **设计领域层**（条件式，详见 reference 复杂度判定）：满足阈值才产出 `use-cases.yaml`；否则跳过，交 business-ut 退化模式处理。
9. **设计展示层**：页面组件树 + Props/回调 + 状态管理方案 + 路由设计；UI 需求须对齐 spec Visual Handoff 真源，产出 `plan/visual-parity.yaml`（映射 asset/token/组件节点 → contracts 可测项；只读 lock 规划不联网不对图）。
10. **构建 spec 功能映射表**：spec 功能编号→优先级→层→模块→内层级→关键文件→说明，须与 Step 5 一致，P0/P1 全覆盖。
11. **质量门禁自检**（14 项，含 Scope 守门/架构合规/模块最小化/功能拆分准确性/文件路径/数据类型/接口签名/无 TBD/组件树/状态管理/路由设计/UseCase 规约达阈值时）：不通过则自动补充重新自检直到全部通过。
12. **输出与归档**：写盘 `plan.md` → 摘要供人审阅 → **立即进 Step 13**，不得先做编码。
13. **提取 contracts.yaml**（详见 reference 字段表）：modules/module_dependencies/data_models/interfaces/components/state_management/navigation/files/resource_keys/prd_to_code_traceability。补充 acceptance.yaml 边界用例（若 spec 未产出）。
14. **架构影响判定**（详见 reference 五分支）：`none`/`dsl_change`/`module_set_change`/`responsibility_rewrite`，从严判 none；绝大多数 feature 应为 none 且不动 architecture.md。`dsl_change` 时须同步修改 [framework.config.json](../../../framework.config.json) 的 `architecture` 段。

## 门禁清单表

| 检查 | 判据 | 失败处置 |
|---|---|---|
| Scope 守门 | in_scope_modules ⊆ spec.in_scope ∪ 已批准扩展 | BLOCKER：回 Step 4 走扩展提议或收窄 |
| 外层依赖矩阵 | `outer_layers[].can_depend_on` | verifier BLOCKER |
| 模块内分层 | `module_inner_layers` 依赖方向 | verifier BLOCKER |
| 数据类型合法性 | 契约字段类型符合 profile 类型系统 | verifier BLOCKER |
| P0/P1 无未决项 | 无 TBD/TODO | verifier BLOCKER |
| plan 章节完整/追溯 | `plan-rules.yaml` | 见 `check-plan.ts` 报告修正 |

> ⚠️ **必须通过 `harness-runner.ts` 入口**：直接跑 `check-plan.ts` 不会触发任何检查，静默返回 0 造成假通过。

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase plan --feature {module-name}
```

**AI Harness**：主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权），prompt 模板 `framework/harness/prompts/verify-plan.md`（9 项语义检查：外层依赖/模块内分层/模块最小性/拆分合理性/数据类型/P0P1 未决/架构一致/导航一致/验收追溯）。

## 阶段闭环判定（全局入口 §5.1，四条件缺一不可）

1. `<features_dir>/<feature>/plan/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS；4. 完成回执经 `check-receipt.ts` 校验通过。四项全满足后设计阶段完成，**具备**进 coding 的资格；**不授权**自动开 coding。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：四件套 PASS 后须 **`plan.ok_to_code`** 或 **`phase.next_step`** 停等（除非 batch 授权）。

## 输出规范

设计文档**必须包含 9 个章节**（模板 `` `profile-skill-asset:plan/plan_template` ``）：1 Scope 声明与继承 / 2 模块架构图 / 3 目录文件结构规划 / 4 数据模型定义 / 5 页面组件树 / 6 状态管理方案 / 7 服务层接口定义 / 8 路由导航设计 / 9 spec 功能映射表。

| 产出 | 路径 |
|------|------|
| 设计文档 | `<features_dir>/{module-name}/plan/plan.md` |
| 接口契约 Spec | `<features_dir>/{module-name}/contracts.yaml` |

## 设计决策原则

简单优先，避免过度设计；分层清晰（宁可多一文件不违反依赖方向）；无法接真实后端时在 client/adapter 定义接口由 repository 用本地替身实现；复用优先；P0 完整设计，P2/P3 可标"预留扩展点"；方案须可直接编码，不含无法落地的抽象。

## 约束

1. spec 是唯一需求来源，不得自行添加未提及的功能。
2. 严格遵循分层架构，设计阶段就杜绝分层违规。
3. 组件/接口设计优先用 profile addendum 声明的宿主原生能力。
4. 数据模型类型须符合宿主语言类型系统。
5. 设计即契约：接口签名/文件路径/组件 Props 是 coding 阶段强契约，务必精确。
6. contracts.yaml 必须同步产出（Step 13），精确度直接影响编码质量与自动化验证有效性。
7. 中文输出；模块最小化，只创建 spec 实际需要的模块。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/plan-workflow-detail.md](../../reference/plan-workflow-detail.md) |
| 项目架构文档 | [doc/architecture.md](../../../../doc/architecture.md) |
| 模块画像 SSOT | [doc/module-catalog.yaml](../../../../doc/module-catalog.yaml) |
| 设计文档模板 | `` `profile-skill-asset:plan/plan_template` `` |
| 阶段级规约 | `framework/specs/phase-rules/plan-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-plan.ts` |
| Trace | `<features_dir>/<feature>/plan/reports/<timestamp>/<model>-plan/trace.json`（schema=trace.schema.json，phase=plan）；`human_interventions` 须记 Scope 扩展批准（`type: scope_expansion_approval`），模型擅自扩展被拦截记 `human_pain_points`（category=`scope_creep`）+ 同目录 `gap-notes.md` |

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **coding** | plan.md + contracts.yaml | 按文件规划和接口契约逐模块生成代码 |
| **code-review** | plan.md + contracts.yaml | 对照检查实现一致性 |
| **business-ut** | plan.md + contracts.yaml | 读业务流程信息生成 DAG |
