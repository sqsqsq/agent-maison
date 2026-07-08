# 模块画像与术语表自举 Skill (`catalog-bootstrap`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 将读写的 catalog、glossary、架构说明等 **paths** 与 **`architecture` 段**已由初始化落地或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

**Harness 运行时前置**：执行 `harness-runner.ts` 前须满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md)。

**Personal setup（BLOCKER）**：跑 harness 前须 [personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `catalog.staging_module` / `catalog.staging_glossary`。

## 概述

在**已有真实代码工程**上，为之建立两份"单一事实源"：`doc/module-catalog.yaml`（每个模块的画像卡）与 `doc/glossary.yaml`（业务自然语言 ↔ 权威模块映射表）。本 Skill 是所有后续六篇 feature 阶段 Skill 的**前置**——只有这两个文件建好，spec 阶段的「术语消歧」和「Scope 声明」才有可校验的基准。

## 触发条件

- "建 catalog / 建模块画像" / "术语表 / glossary / 初始化 glossary"
- `/catalog-bootstrap <ModuleName>` / `/glossary-bootstrap`
- 用户明确说"这两个文件在真实工程里内容不对，要重建 / 批量修正"

## 核心设计原则（弱模型友好）

1. **一次一个模块**：绝不让模型一次啃 30 个模块，保证上下文 ≪ 200K。
2. **staging 隔离 + 对话式确认**（默认流程）：AI 先把草稿写到 `doc/catalog-staging/<Module>.yaml` / `doc/glossary-staging/<term>.yaml`（审计留档），在对话里展示人友好汇总，用户回 `y/n/改 XXX` 短回复，AI 据此翻转 `confirmed_by_user` 并合并。用户无需手动改 flag。
3. **AI 绝不直接改** `doc/module-catalog.yaml` / `doc/glossary.yaml` 除非拿到用户 `y`。**唯一例外**：Step 0 骨架创建（文件完全不存在时，AI 可自主创建只含 `schema_version` + 空数组的骨架，禁止塞任何条目）。
4. **代码信号 + 文档信号双输入**：有 `doc/architecture.md`/模块 README 优先读文档；无则按 profile addendum 声明的代码信号降级推导。
5. **harness 守门**：最终产物必须通过 `--phase catalog` / `--phase glossary` 的结构与交叉引用校验。

## 条件加载索引

- **执行 Phase A（模块画像，`/catalog-bootstrap`）或 Phase B（术语表，`/glossary-bootstrap`）任一步骤前**：完整读 [catalog-bootstrap-workflow.md](../../reference/catalog-bootstrap-workflow.md)——两阶段的骨架初始化、CREATE/UPDATE 判别、输入信号采集、staging 确认对话格式（y/e/s/q）、合并机制、architecture.md 同步触发条件、术语匹配 6 步管线全部细则均在那里，本文档只留触发/原则/门禁/输出骨架。
- 存在 `framework/profiles/<project_profile.name>/skills/catalog-bootstrap/profile-addendum.md` 时先读（宿主专属细则）。
- 正文 `` `profile-skill-asset:catalog-bootstrap/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

## 流程骨架

**Phase A**（每轮一个模块）：Step 0 初始化骨架 → Step 1 列候选清单 → Step 1.5 判别 CREATE/UPDATE → Step 2 采集输入信号 → Step 3 填草稿到 staging → Step 4 自检清单 → Step 5 对话确认（y/e/s/q）→ Step 6 合并主 catalog → Step 6.5 视情况同步 architecture.md → Step 7（覆盖 ≥80% 后）第二轮补全易混项。

**Phase B**（前置：Phase A 已覆盖 ≥80%）：Step 0 初始化骨架 → Step 1 收集种子术语清单（`doc/glossary-seed.txt`，**用户自己填，AI 不代编**）→ Step 2 逐条术语匹配建议（6 步管线）→ Step 3 对话确认（同 A，不批量 dump）→ Step 4 合并 glossary.yaml。

## Harness 验证门禁

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase catalog
cd framework/harness && npx ts-node harness-runner.ts --phase glossary
```

> 两个 phase **无需 `--feature`**（全局文件，不归属任何 feature）。

| 检查 | 判据 | 失败处置 |
|---|---|---|
| catalog 结构/交叉引用 | schema/字段完整/layer 合法/name 不重复；`easily_confused_with.module` 存在；`entry_file` 落地（WARN）；`key_exports` 与 profile 导出同步（WARN 漂移） | 见 `catalog-rules.yaml`；BLOCKER 修正后重跑 |
| catalog `feature_scope_integrity` | 各 feature Scope 声明引用的模块须在 catalog 存在 | WARN 提前告警——否则该 feature 跑 spec/plan 会在 `scope_matches_catalog` BLOCKER |
| glossary 结构/交叉引用 | schema/字段完整/term 不重复；`canonical_module` 存在于 catalog；`owner_layer` 一致；`easily_confused_with.module` 存在于 catalog | 见 `glossary-rules.yaml`；BLOCKER 修正后重跑 |

完整检查项：`framework/specs/phase-rules/catalog-rules.yaml` / `glossary-rules.yaml`；脚本：`check-catalog.ts` / `check-glossary.ts`。

## 输出规范

| 产出 | 路径 | 阶段 |
|------|------|------|
| 模块画像 staging（合并后删） | `doc/catalog-staging/<Module>.yaml` | Phase A |
| 已合并 catalog | `doc/module-catalog.yaml` | Phase A |
| 术语种子 | `doc/glossary-seed.txt`（用户提供） | Phase B |
| 术语 staging（合并后删） | `doc/glossary-staging/<term>.yaml` | Phase B |
| 已合并 glossary | `doc/glossary.yaml` | Phase B |

> **审计方式**：staging 生命周期 = "AI 写入 → 用户 `y` 后翻 flag → 合并 → 删除"，全程可用 `git log -p --follow` 回放；不再保留 `_merged/` 归档目录。

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **spec** Step 1.5 | catalog + glossary | 术语消歧、Scope 声明校验 |
| **plan (Design)** Step 2.5 | catalog | Scope 扩展提议时查候选模块 |
| **harness check-spec** | catalog + glossary | `scope_matches_catalog` / `terminology_mapping_table` BLOCKER |
| **harness check-plan** | catalog | `scope_consistency_with_spec` 交叉校验 |

## 约束与反模式

1. **禁止**一次对话处理多个模块。
2. **禁止**AI 未经用户 `y` 就直接改 `doc/module-catalog.yaml` / `doc/glossary.yaml`。
3. **禁止**`NOT_responsible_for` / `easily_confused_with` 凭字面瞎编；宁可空也不要错。
4. **禁止**把暧昧应答（"好的"/"嗯"）当作 `y`；即使跳过用户确认步骤也要再次明确问一句。
5. **禁止**一次列 N 条 glossary 等用户"一起 y"——每条必须独立展示易混项再问。
6. **禁止**为了让用户省事悄悄折叠/截断 `easily_confused_with` 和 `NOT_responsible_for`——这两个字段是 Scope 守门真正入口。
7. **禁止**为了绕过 harness FAIL 而修改 `schema_version` 或删除必填字段。
8. 中文输出。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/catalog-bootstrap-workflow.md](../../reference/catalog-bootstrap-workflow.md) |
| 模块画像模板 | `framework/profiles/<project_profile.name>/skills/catalog-bootstrap/templates/module-card-template.yaml` |
| 术语条目模板 | `framework/profiles/<project_profile.name>/skills/catalog-bootstrap/templates/glossary-term-template.yaml` |
| 种子清单模板 | [templates/glossary-seed-template.txt](templates/glossary-seed-template.txt) |
| 推断 prompt | `.../prompts/infer-module-card.md`、`.../prompts/infer-glossary-term.md` |
| Trace | 全局 phase：`framework/harness/reports/_global/{catalog,glossary}/<timestamp>/<model>-<phase>/trace.json`；同目录产出 `gap-notes.md` + `check-*.report.md` |
