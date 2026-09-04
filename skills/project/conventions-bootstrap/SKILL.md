---
name: conventions-bootstrap
description: Create or maintain project conventions with evidence-based curation and individual confirmation. Use when the user asks to build or update the conventions knowledge asset, not for ordinary code review.
---

# 工程惯例策展 Skill（`conventions-bootstrap`）

## 前置与触发

实例根必须已有有效 `framework.config.json`。用户显式调用 `/conventions-bootstrap`，或明确要求创建/维护工程惯例时进入；普通 review 只能建议升格，不能代为写入。

先读取 `framework.config.json > paths.conventions`；键缺失使用框架默认 `doc/conventions.md`。这是 skill 侧的既有配置解析约定；harness 消费由 `conventionsPath()` 负责。完整格式只读 [工程惯例 SSOT](../../../docs/concepts/conventions.md)，不要在本 skill 或模板复制字段定义。

**用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · registry `conventions.staging_card`。每张卡独立确认，只有 `1`/`y` 才可写入。

## 工作流

执行时完整读取 [详细流程](../../reference/conventions-bootstrap-workflow.md)。顺序固定：

1. 文件不存在时，从 [空骨架模板](assets/conventions.template.md) 创建，仅含标题和 SSOT 链接。
2. 盘点 review/事故、当前代码和既有文档三类来源；重复问题优先。
3. 为候选尽量执行确定性符合率探针，区分 established、待人裁决、aspirational。
4. 与 DSL/coding-rules/ut-rules/profile 等既有门禁去重；已有判定只能建 gate 索引卡，并确认 `(phase, rule_id)` 在 resolved rules 中真实存在。
5. 每次只展示一张候选卡，按 `conventions.staging_card` 邀请 `y/e/s/q`；未获明确 `y` 绝不写入。
6. 写入后重读全文，确认 `##` id 唯一、gate 字段成对且引用仍可解析；报告本轮新增/修改/跳过/作废。

## 约束

- 用户不手写资产本体；Agent 只按逐条确认结果落盘。
- 既有权威散文采用 adopt-by-reference：只写摘要与精确链接，不复制正文。
- 反例只写伪代码形状，禁止引用生产文件；范例必须指向好例子。
- 不创建 resolver/index/schema/hash/drift/lifecycle/waiver；建议软上限 30 条。
- 不保存探针命令，只保存检索意图与期望结果。
- 不自动修改代码、checker 或其它项目知识资产。

## 输出

唯一持久输出是配置路径指向的 conventions Markdown。候选卡临时草稿只留在对话；不得建立 staging registry、manifest 或第二真源。

条目起点：[卡片模板](assets/convention-card.template.md)（字段定义仍只引用概念 SSOT）。
