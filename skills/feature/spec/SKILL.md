# Spec 阶段 Skill (`spec`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `spec.terminology` / `spec.feature_path` / `spec.freeze` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**Feature 归档定位协议**：先基于 `framework.config.json > paths.features_dir` 解析 `<features_dir>/<feature>/`（本文档下称 `<features_dir>`）。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`（或 `harness-runner --sync-closure`）；exit 0 → 已闭环，**停等 `phase.next_step`**，禁止仅凭 stale state 判未闭环。已存在目录 → 续写 `spec/spec.md`/`acceptance.yaml`；同级归档/同名前缀条目仅作旁证，不得当正式 feature；精确路径存在但非目录 → 停下请用户确认（`spec.feature_path`：`1=换名 2=清理恢复`）。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/spec/profile-addendum.md` 时先读。
- **Step 1.5（术语消歧）与 Step 2/2.1（截图分析+资产裁剪验真，pixel_1to1 相关）执行前**：完整读 [spec-workflow-detail.md](../../reference/spec-workflow-detail.md)——本文档只留骨架，机制细则（6 步术语匹配、7 项截图分析、裁剪验真红线、acceptance 字段表）全在那里。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](../../reference/agent-behavioral-principles.md)（Karpathy 四原则）。**Research Sub-Phase 完成前禁止写入 spec 正文。**
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析；**禁止**写死固定 profile 路径。

## 概述

按当前 `project_profile` 自适配的产品经理：根据用户文字描述和界面截图，生成结构化 spec 文档。本 Skill 是流水线**第一环**，输出 `spec.md` 供下游各阶段消费。宿主扩展通过 `doc/extensions/knowledge/`、`hooks/spec/on_context_load.md`、`phase_rules_overlays.spec` 叠加。

| 叙述产物 | 路径 | 寿命 |
|----------|------|------|
| spec.md | `<features_dir>/<f>/spec/spec.md` | 长期归档 |
| acceptance.yaml | `<features_dir>/<f>/acceptance.yaml` | 长期 |

## 触发条件

"写 spec"、"需求规格"、"spec 设计"、"分析需求"、"需求文档"、"功能规划"，或提供了界面截图要求分析功能。

## 层边界（BLOCKER）

用户仅表达"修订 spec/改验收/Scope/术语表"未同时要求"做实现计划/改 contracts"时，**只激活 spec 阶段**，不得自动滑入 plan。spec-only 回合内**不得**新建/实质改写 plan.md 技术章节或 contracts.yaml 接口契约（本 Skill 允许产物仅限 spec.md + Step 6 的 acceptance.yaml）。中途修正先跑 `--correction-init`（按 AGENTS §4.0 修正三问分层）；`.current-correction.json.auto_confirm_eligible=true` 可直接实施，否则须经 `correction.layer` 1/2 确认。spec.md 落盘后须**先于**宣称"可进 plan"执行 Step 7.1（阶段边界推进原则见 AGENTS §3.8）。

## 流程骨架

1. **收集输入**：功能文字描述 / 界面截图 / 功能模块名（必需）；竞品截图（可选）。
2. **术语消歧**（BLOCKER，详见 reference）：必读 [doc/glossary.yaml](../../../../doc/glossary.yaml)（业务术语↔权威模块）与 [doc/module-catalog.yaml](../../../../doc/module-catalog.yaml)（模块职责画像），生成`## 0. 术语映射表`，所有行 `[x]` 用户确认后才允许生成正文；headless 例外见 reference。**`project_scale=small`**（`framework.config.json`，framework-init 按 catalog 模块数 ≤3 建议）时映射表仍须产出，但可用节末一行 `- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射` 整体替代逐行 `[x]`；Scope/`diff_within_scope` 等红线不受影响。
3. **截图分析 → ui-spec.yaml**（UI 需求，详见 reference）：分区扫描、逐屏识别、组件 taxonomy、token 表、资产清单、保真档位判定、DSL↔原图 gate。
4. **Research Sub-Phase**（Context Facts Gate·BLOCKER，C4）：进入 Step 5 正文前必读本阶段 SSOT（glossary/catalog/architecture.md + 相关既有实现，≥2 源码文件）+ profile 必查路径；填 `context_intent`/`estimated_loc_delta`/`touches_layers`；harness 按 `exploration_strategy` 复合评分决定是否须 subagent。spec 是 full track 的**建立阶段**：在 `<features_dir>/<feature>/context/facts.md` 建立全量事实（frontmatter + `## Code Facts` 表，`ready_to_produce: true` 且 `has_blocker_coverage_risk: false`）——后续 plan/coding/review/ut/testing 各阶段只追加 `## phase_delta: <phase>` 增量节，不重做全量探索。旧版 `spec/context-exploration.md`（per-phase）仍可读但已弃用，SSOT 见 `framework/harness/scripts/utils/context-facts.ts`。
5. **生成 spec 初稿**：读 `` `profile-skill-asset:spec/spec_template` ``，填 10 章节（0 术语映射表 / 1 功能概述 / 2 Scope 声明 / 3 目标用户场景 / 4 功能清单 / 5 页面描述 / 6 业务流程图 / 7 异常边界 / 8 非功能性需求 / 9 验收标准）。Scope 的 `in_scope_modules` 须全部来自已确认映射表的 `canonical_module`。UI 需求须在 Scope 附近增加独立 `yaml` 块（`ui_change` 字段，见 [reference/visual-handoff.md](reference/visual-handoff.md)）；非 UI 且未 opt-in `spec.visual_handoff_enforcement: strict` 时不写该块。**Scope 填写要点**：对照 architecture.md 判断 `in_scope_modules`/`out_of_scope_modules`，`rationale` 须回答"若下游想把逻辑提到公共模块是否同意"；模块名 PascalCase；判断不清宁可窄。
6. **质量自检**（10 项，逐项检查不通过自动修正）：功能概述非空话 / Scope yaml 块+rationale / 用户场景明确 / 功能清单含优先级 / 界面描述覆盖截图元素 / Mermaid 语法+主路径分支 / 异常场景≥3 类 / 非功能性有量化指标 / 验收标准可测试且与功能清单对应 / Visual Handoff 独立块（若 UI）+ ui-spec 已产出且 `verified` 非 unverified（若 `new_or_changed`）。
7. **输出与归档**：写盘 `spec.md`（+ `ui-spec.yaml` 若 UI）→ 对话输出摘要 → **冻结/下游授权**（`spec.freeze`：`1=冻结可进 plan` `2=继续改`，口头 OK 无效）→ 进 Step 8；Step 8 完成后立即进 Step 9，**严禁**跳过 7.1。
8. **提取 acceptance.yaml**（详见 reference 字段表）：`criteria`/`boundaries`/`performance`/`coverage_summary` 四章节，`ut_layer` 分层判定见 reference。

## 门禁清单表

| 检查 | 判据 | 失败处置 |
|---|---|---|
| `terminology_mapping_table` | `## 0. 术语映射表`存在且所有行 `[x]` | BLOCKER：回 Step 2 补齐确认 |
| `terminology_modules_within_scope` | 每行权威模块须出现在 Scope in/out_of_scope_modules | BLOCKER：同步补 Scope 声明 |
| `scope_matches_catalog` | in/out_of_scope_modules 存在于 module-catalog | BLOCKER：先跑 catalog-bootstrap 或改模块名 |
| spec 章节完整性/追溯 | `spec-rules.yaml` 通用规则 | 见 `check-spec.ts` 报告修正 |
| verifier 语义检查 | `verify-spec.md`：验收标准可测试性等 8 项 | BLOCKER FAIL 修正后重验 |

> ⚠️ **一定要通过 `harness-runner.ts` 入口**：直接跑 `check-spec.ts` 不会触发任何检查（无 CLI 入口），静默返回 0 造成假通过。

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase spec --feature {module-name}
```

**AI Harness**：agent 必须主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权，不得仅"告知用户可运行"），prompt 模板 `framework/harness/prompts/verify-spec.md`。

## 阶段闭环判定（全局入口 §5.1，四条件缺一不可）

1. `<features_dir>/<feature>/spec/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS；4. 完成回执经 `check-receipt.ts` 校验通过。四项全满足后 spec 阶段完成，**具备**进 plan 的资格；**不授权**自动开 plan。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：除非 batch 多阶段授权（§8.2），否则须 **`phase.next_step`**（确认菜单+portable 编号）停等。`spec.freeze` 只冻结 spec 内容，不等同于可自动写 plan.md。

## 输出规范

| 产出 | 路径 |
|------|------|
| spec 文档 | `<features_dir>/{module-name}/spec/spec.md` |
| 验收标准 Spec | `<features_dir>/{module-name}/acceptance.yaml` |

优先级：P0 必须实现（核心功能）/ P1 应当实现（影响核心体验）/ P2 最好实现 / P3 可延后。

## 约束

1. 截图是关键输入，界面描述不可忽略任何可见元素。
2. 描述 UI/交互组件优先用当前 profile addendum 声明的宿主术语。
3. 涉及真实后端但当前阶段接不到真实服务的功能，须在 spec 标注"模拟数据"。
4. spec 关注"做什么"，技术实现细节留给 plan 阶段。
5. 中文输出。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/spec-workflow-detail.md](../../reference/spec-workflow-detail.md) |
| spec 模板 / 示例 | `` `profile-skill-asset:spec/spec_template`` / ``profile-skill-asset:spec/example_spec` `` |
| 阶段级规约 | `framework/specs/phase-rules/spec-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-spec.ts` |
| Trace | `<features_dir>/<feature>/spec/reports/<timestamp>/<model>-spec/trace.json`（schema: `harness/trace/trace.schema.json`，phase=spec）+ 同目录 `gap-notes.md` |

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **plan** | spec.md | 读功能清单，生成实现计划 |
| **coding** | acceptance.yaml | 参照验收标准和边界用例实现 |
| **business-ut** | acceptance.yaml | 参照验收标准生成 UT 断言 |
| **device-testing** | acceptance.yaml | 参照验收标准生成测试用例 |
