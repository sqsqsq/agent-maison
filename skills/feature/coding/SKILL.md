# 编码 Skill (`coding`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `coding.scope_stop` / `coding.module_batch` / `coding.deps_abc` / `coding.ok_to_review` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。只有精确目录是正式 feature；输入缺失（至少 `plan.md`/`contracts.yaml`/`acceptance.yaml`）须报告并回上游补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/coding/profile-addendum.md` 时先读（宿主语言易错手册/资源规范/导出规则）。
- **Step 2.5a（视觉真源 Read，pixel_1to1 相关）/ Step 3.5（业务编排命名入口）/ Step 6.5+7.1（编译闭环与修复策略）执行前**：完整读 [coding-workflow-detail.md](../../reference/coding-workflow-detail.md)——8 项 pixel_1to1 BLOCKER 门禁、三形态业务编排约束、编译自闭环修复策略全部细则在那里。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](../../reference/agent-behavioral-principles.md)（原则 3 Surgical·原则 4 Verify）。**Research Sub-Phase 完成前禁止写入第一个实现层源文件。**
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析；编码规范/脚手架/易错手册键名见当前 profile 的 `skills/skill-assets.yaml`（如 `coding_standards`、`module_scaffold`）。

## 概述

资深宿主应用开发工程师：按 plan.md 逐模块生成与 `contracts.yaml` 对齐、可通过 harness 出口检查的实现代码。流水线**第三环**，上游 `plan.md`，输出流入 code-review。

## 触发条件

"开始编码"、"实现功能"、"写代码"、"开发模块"、"生成代码"、"落地实现"，或明确指向 plan.md 要求实现。

## 层边界（BLOCKER）

纯设计请求（"修正 plan"、"对齐 spec 改 plan"）不得入境：未激活本 Skill，不得新增/修改实现层产物。**plan 刚修订须先有 harness 顺位**：本会话若刚写入/更新过 plan.md，须已对该 feature 跑 `harness-runner.ts --phase plan` 零 BLOCKER，才可落笔任何实现层产物——禁止"实现先改、plan.harness 后补"。与人审闸门对齐时须取得用户明示可编码，不得把"设计文档已保存"默认等同批准实现；连续执行须用户在指令中同时表达设计定稿与编码开工。中途修正按 AGENTS §4.0 修正三问分层。

**Scope 守门**：编码 git diff 不得越界到 plan.md `in_scope_modules` 之外（`diff_within_scope` 会在 Step 7 阻断）；发现要改 scope 外模块**立刻停下**（`coding.scope_stop`：`1=回 plan 走扩展` `2=收窄实现`）。**逐文件 Lint 门禁**：单文件 Lint 不过不得进入下一文件，严禁批量生成后统一 lint。

## 核心架构认知

开始编码前必须读 `doc/architecture.md`，以 `framework.config.json > architecture` 为机器可读依赖规则：外层依赖按 `can_depend_on`；同层按 `intra_layer_deps`；模块内按 `module_inner_layers`+`inner_dependency_direction`；跨模块经 `cross_module_exports_file` 出口；profile 专属细则见 Step 0 addendum。

## 输入

| 输入项 | 必需 |
|--------|------|
| plan.md / contracts.yaml / acceptance.yaml | ✅ |
| ui-spec.yaml + 原始需求截图 | `ui_change=new_or_changed` 时必填 |
| use-cases.yaml | 仅复杂 feature（多 UI 共享状态/多步云调用/含回滚分支）存在 |
| doc/architecture.md / 当前工程代码 | ✅ |
| spec.md | 可选，交叉验证 |

## 流程骨架

1. **读取解析 plan.md + Spec 契约**：以 `contracts.yaml` 为权威来源（modules/files/data_models/interfaces/components/navigation/resource_keys），plan.md 为补充上下文；acceptance.yaml 提取验收标准和边界用例。输出模块×层实现清单（`coding.module_batch`：`1=下一模块` `2=修改本模块`）。
2. **确定实现顺序**：双重自底向上——模块间按 `outer_layers`/`intra_layer_deps` 声明（被依赖方先落地）；模块内按 profile 声明的层顺序（常见 shared→data→domain→presentation）。
3. **Research Sub-Phase**（Context Facts Gate·BLOCKER，写第一个实现层源文件前完成，C4）：**UI 需求先做 Step 2.5a 视觉真源 Read**（详见 reference，8 项 pixel_1to1 BLOCKER）。必读 plan/contracts/acceptance/use-cases（若有）/architecture DSL/跨模块出口 + 已有源码（`source_code_paths`≥3）；coding **默认 MUST** subagent（仅 L1 trivial 可豁免）；追加 `<features_dir>/<feature>/context/facts.md` 的 `## phase_delta: coding` 节（无新增事实写 "none"）。
4. **逐模块逐层生成代码**（强制逐文件 Lint 门禁）：开文件前自检（重读易错手册相关条 + 确认路径在 in_scope 内）→ 按 contracts.yaml 强契约生成 → 只写当前一个文件 → 立即 `ReadLints` 零 error 才能开下一文件 → 对照易错手册自校对 → 检查层间依赖 → 展示给用户确认。
5. **业务编排**（详见 reference，仅 use-cases.yaml 存在时）：三形态（Page 命名方法/协调类/导出命名函数）按复杂度自选，`named_business_handler` 强制校验命名符号、禁匿名 lambda、禁新造 Port。
6. **模块配置与资源文件**：模块包描述/构建配置/module.json5/根级模块清单/依赖清单；资源文件按 profile 目录布局；路由配置按 profile 约定注册。
7. **质量门禁自检**（13 项：模块完整性/分层合规/文件完整性/接口一致性/编译零 error/资源引用/页面注册/无硬编码字符串/DAG 合规/导入完整/命名入口完整性/UI 层副作用翻译/视觉背板映射）：不通过定位问题自动修复重检。
8. **输出交付摘要**：模块变更表 + 新增文件表 + 质量门禁结果 → 下一步指向 Step 9 Harness 验证。
9. **真实编译闭环**（详见 reference）：`coding.compile` 是必要出口，非可选；agent 自跑 harness、读日志、按错误类型分类修复、重跑直到 PASS。
10. **Harness 验证门禁**：见下方门禁清单表；脚本/编译 FAIL 时的用户可见汇报模板见 reference Step 7.1。

## 门禁清单表

| 检查 | 判据 | 严重级别 |
|---|---|---|
| 文件完整性 | contracts.yaml 列出文件均存在 | BLOCKER |
| 分层合规 | 模块内 import 不违反内层顺序 | BLOCKER |
| 模块间依赖 | import 不违反外层依赖矩阵 | BLOCKER |
| 资源引用完整性 | 宿主资源引用 API 与资源定义一致 | BLOCKER |
| 模块导出 / 模块注册 / 页面注册 | 跨模块出口正确导出 / 构建清单注册 / 路由清单登记 | BLOCKER |
| 硬编码字符串 | presentation 层 UI 文本走资源机制 | MAJOR |
| 命名规范 / 禁止 any | 命名约定 / 无 any 类型 | MAJOR |
| pixel_1to1 门禁组（8 项，详见 reference） | 视觉真源/资产物化/文案白名单/渲染几何/透明占位/结构声明台账 | BLOCKER |

> ⚠️ **必须通过 `harness-runner.ts` 入口**：直接跑 `check-coding.ts` 不会触发任何检查，静默返回 0 造成假通过。

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature {module-name} --summary --failures-only
```

**AI Harness**：主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权），prompt 模板 `framework/harness/prompts/verify-coding.md`（业务逻辑正确性/异常处理完整性/接口签名一致性 BLOCKER/组件 Props 一致性/数据所有权合规/模拟数据隔离/验收标准覆盖）。

## 阶段闭环判定（全局入口 §5.1，四条件缺一不可）

1. `<features_dir>/<feature>/coding/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS；4. 完成回执经 `check-receipt.ts` 校验通过。四项全满足后编码阶段完成，**具备**进 code-review 的资格；**不授权**自动开 code-review。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：须 **`coding.ok_to_review`** 或 **`phase.next_step`**（确认菜单+portable 编号）停等，禁止读完 receipt/trace 后同一执行流写 review（除非 batch 授权）。

## 编码规范速记

完整条款以当前 profile `templates/coding-standards.md` 为准：分层规则禁反向依赖；模块格式按 profile 导出规则；组件命名 PascalCase；资源引用走宿主资源系统；业务数据变更经 Repository；异步用宿主推荐范式；大列表用懒加载/虚拟化。

## 约束

1. contracts.yaml 是强契约：文件路径/接口签名/数据模型/组件 Props 须一致；Spec 有问题先向用户指出确认修正方案。
2. 逐模块逐层交付，每批 `coding.module_batch` 确认后继续。
3. 无法接真实后端时在 client 层定义接口，repository 用本地替身实现。
4. 非显而易见的业务逻辑用中文注释说明意图。
5. 渐进式实现：先 P0 可运行，再叠加 P1/P2。
6. 修改现有文件只做增量修改，不改动无关代码。
7. 每完成一层级代码应处于可编译状态。
8. 代码须处理 `acceptance.yaml > boundaries` 定义的所有异常场景。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/coding-workflow-detail.md](../../reference/coding-workflow-detail.md) |
| 编码规范完整版 | `` `profile-skill-asset:coding/coding_standards` `` |
| 阶段级规约 | `framework/specs/phase-rules/coding-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-coding.ts` |
| Trace | `<features_dir>/<feature>/coding/reports/<timestamp>/<model>-code/trace.json`（phase=coding）；`tool_calls` 记 `ReadLints` count/failed_count；`retries` 记 `lint_error`/`language_rule_violation` 自修次数；`harness_checks` 记 `diff_within_scope` 结果；同目录 `gap-notes.md` |

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **code-review** | 源代码 + contracts.yaml | 审查代码与契约一致性 |
| **business-ut** | 源代码 + acceptance.yaml | 基于验收标准生成 UT |
