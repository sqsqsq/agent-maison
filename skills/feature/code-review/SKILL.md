# Code Review Skill (`code-review`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `review.module_name` / `review.report_save` / `review.ok_to_ut` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。**视觉能力自测（UI 相关需求·交互式）**：personal-setup `ok` 后按 [interactive-vision-canary](../../reference/interactive-vision-canary.md) 后台跑自测卷判卷 CLI（防死锁编排逐步照做）。

**Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。输入缺失（至少 `plan.md`/`contracts.yaml`/`acceptance.yaml`）须报告并回上游补齐。

review 阶段不执行宿主包管理器依赖安装命令，也不使用 `HARNESS_DIFF_BASE_REF=working`——这些属于 coding/UT 的构建与 diff 自愈职责。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/code-review/profile-addendum.md` 时先读。
- **视觉保真维度执行定义（pixel_1to1，UI 需求必做）与 Step 2 各审查子维度详细检查项**：完整读 [code-review-workflow-detail.md](../../reference/code-review-workflow-detail.md)。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](../../reference/agent-behavioral-principles.md)。**Research Sub-Phase 完成前禁止执行 Step 2 审查清单。**
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

## 概述

按当前 `project_profile` 自适配的代码审查员：基于 Spec 契约和编码规范对 coding 产出做系统化 Code Review。流水线**第四环**，上游 coding 源代码，审查报告指导修复；修复后**具备**进 business-ut 的资格，仍须 `review.ok_to_ut`/`phase.next_step` 授权。

## 触发条件

"代码审查"、"Code Review"、"CR"、"审查代码"、"检查代码质量"、"代码走查"、"Review 代码"、"生成审查报告"。

**上游 coding 闭环 alone 不触发（BLOCKER）**：仅因 coding 四件套 PASS、读完回执/trace、或 coding 正文"可进入 code-review"**不得**激活本 Skill。须用户 review 触发意图、batch 授权（§8.2）、或 `coding.ok_to_review`/`phase.next_step` 确认后再进入。

## 审查与改动权的硬边界（BLOCKER）

**只审不改（默认）**：用户仅表达"帮忙 Code Review/出审查报告/走查"而未明示"按 CR 结论直接改代码"时，只产出结构化审查产物（`review-report.md`）；**不得**批量修改实现层产物。**代改须有授权**：审查同时要求修代码须在指令中明示；未经明示至多给建议不写补丁。**与 Harness 顺位**：脚本 harness 不因"顺带修一点"被跳过或后补；以代改为目标须说明 touch 了哪些契约内文件并接受相关规则复检。

## 核心审查维度

| 审查维度 | 主要依据 | 严重级别 |
|----------|---------|---------|
| 架构合规性 | `doc/architecture.md` + `architecture` DSL | BLOCKER |
| 模块内四层分层 / 接口一致性 / 文件完整性 / 资源引用完整性 | `coding-rules.yaml` / `contracts.yaml` | BLOCKER |
| 命名规范 / 硬编码字符串 | `coding-rules.yaml` | MAJOR |
| 异常处理 / 业务逻辑正确性 | `acceptance.yaml` / `plan.md` | MAJOR |
| 数据所有权 / 模拟数据隔离 | `coding-rules.yaml` | MAJOR/MINOR |
| 视觉保真治理 | spec `fidelity_target`/`fidelity_deferrals` + `fidelity_governance` | BLOCKER（`pixel_1to1` defer 须人类签字） |
| **视觉保真**（详见 reference） | spec/coding 落盘的确定性报告 | BLOCKER（`visual_fidelity_review`，证据全覆盖） |

## 输入

| 输入项 | 必需 |
|--------|------|
| 功能模块名 / plan.md / contracts.yaml / acceptance.yaml / coding-rules.yaml | ✅ |
| doc/architecture.md / 源代码（contracts.yaml files 列表） | ✅ |
| spec.md | 可选，验证功能覆盖完整性 |

**上下文缺失**（脚本 harness 归为 `review_context`）：`missing_review_report`→补齐后重跑；`missing_contracts`→回 plan 阶段补齐；`missing_acceptance`→回 spec 阶段提取；`missing_source_from_contracts`→确认 coding 是否完成或同步契约。

## 流程骨架

1. **收集审查上下文**：确认模块名（`review.module_name`：`1=确认` `2=修改`）；读 plan.md/spec.md（若存在）/architecture.md/coding-rules.yaml/contracts.yaml/acceptance.yaml；按 `contracts.yaml > files` 读全部源代码；展示审查范围摘要。
2. **Research Sub-Phase**（Context Facts Gate·BLOCKER，Step 3 审查清单前完成，C4）：必读 Step 1 全部待审源文件 + plan/contracts/acceptance/coding-rules；复合评分 ≥60 或 L4 架构级变更 MUST subagent；追加 `<features_dir>/<feature>/context/facts.md` 的 `## phase_delta: review` 节（全部读完才置该节非空，无新增事实写 "none"）。
3. **系统化审查**（5 子维度，详见 reference）：架构合规性（BLOCKER）→ 接口一致性（BLOCKER）→ 编码规范（MAJOR）→ 业务逻辑（MAJOR）→ 数据层（MAJOR/MINOR）；UI 需求另做视觉保真维度（详见 reference，pixel_1to1 P0 全覆盖不许抽查）。
4. **生成审查报告**：模板 `templates/review-report-template.md`，**必须包含 6 章节**：审查范围 / 审查方法 / 问题清单（编号+严重程度+分类+描述+涉及文件+修复建议）/ 问题统计 / 修复建议摘要 / 结论。问题分类用预定义类别（分层违规/接口不一致/资源引用/命名规范/硬编码/逻辑错误/异常处理/性能/安全/其他）。严重程度：BLOCKER（架构分层违规/接口签名不一致/文件缺失/资源引用缺失）/ MAJOR（命名/硬编码/异常处理/逻辑错误）/ MINOR（模拟数据隔离/风格/注释）/ INFO（改进建议）。结论：BLOCKER>0→不通过；BLOCKER=0 且 MAJOR>0→有条件通过；均 0→通过。
5. **质量门禁自检**（10 项：审查范围明确/问题清单六列格式/严重程度四级值域/分类值域/统计一致/修复建议可操作/结论一致性/涉及文件真实存在/问题有代码证据/元数据齐全）：不通过定位问题自动修正重检。
6. **输出与归档**：展示报告确认（`review.report_save`：`1=确认落盘` `2=修改后再落盘`）→ 保存 `<features_dir>/{module-name}/review/review-report.md`。

## 门禁清单表

| 检查 | 判据 | 严重级别 |
|---|---|---|
| 必需章节 | 审查范围/方法/问题清单/统计/建议/结论均存在 | BLOCKER |
| 问题清单表格 | 表头含编号/严重程度/分类/描述/涉及文件/建议 | BLOCKER |
| 严重程度值域 | 仅 BLOCKER/MAJOR/MINOR/INFO | BLOCKER |
| 结论一致性 | 结论与 BLOCKER 数量匹配 | BLOCKER |
| 涉及文件存在性 | 问题清单引用路径真实存在 | BLOCKER |
| 分类值域 / 问题统计一致 | 仅预定义分类 / 计数与清单一致 | MAJOR |
| 元数据 | 模块标识/审查日期/审查版本齐全 | MINOR |

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase review --feature {module-name}
```

**AI Harness**：主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权），prompt 模板 `framework/harness/prompts/verify-review.md`（审查维度覆盖度/问题准确性 BLOCKER/修复建议可操作性/误报率/BLOCKER 与结论一致性 BLOCKER/编码规则追溯）。

## 阶段闭环判定（全局入口 §5.1，四条件缺一不可）

1. `<features_dir>/<feature>/review/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS；4. 完成回执经 `check-receipt.ts` 校验通过。四项全满足后 Review 阶段完成，**具备**进 business-ut 的资格；**不授权**自动开 business-ut。若审查结论为"不通过"或"有条件通过"，开发者需修复代码后重新执行 coding → code-review。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：须 **`review.ok_to_ut`** 或 **`phase.next_step`** 停等（除非 batch 授权）。

## 输出规范

| 产出 | 路径 |
|------|------|
| 审查报告 | `<features_dir>/{module-name}/review/review-report.md` |

问题编号格式：`CR-{NNN}`，从 CR-001 递增。

## 约束

1. 所有审查结论须可追溯到具体 Spec 规则（coding-rules.yaml）或契约（contracts.yaml），避免主观判断。
2. 每条问题须有具体代码证据（文件路径+关键代码），不允许泛泛而谈。
3. 零误报目标：不确定是否为问题降级 INFO 或不报告，宁可漏报不误报。
4. 修复建议须具体到修改哪个文件哪段代码。
5. 本项目模拟数据全部写死，模拟数据类型合法性检查应适度宽容。
6. 中文输出。
7. 不重复 Harness 已覆盖的确定性结构检查（文件存在/分层合规等由脚本自动完成），聚焦语义正确性和架构合理性。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/code-review-workflow-detail.md](../../reference/code-review-workflow-detail.md) |
| 阶段级规约 | `framework/specs/phase-rules/review-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-review.ts` |
| 审查报告模板 | [templates/review-report-template.md](templates/review-report-template.md) |
| 审查检查清单 | `` `profile-skill-asset:code-review/review_checklist` `` |
| Trace | `<features_dir>/<feature>/review/reports/<timestamp>/<model>-review/trace.json`（phase=review）+ 同目录 `gap-notes.md` |

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **开发者** | review-report.md | 按问题清单修复代码 |
| **business-ut** | 修复后的源代码 | 基于修复后的代码生成 UT |
