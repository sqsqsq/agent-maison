---
name: framework-init 误触发纠偏（方案已撤回）
version: 3.0.0
# 本文件原先承载 a49772ad / d47e2ea6 两轮 Git/SCM 专用自然语言路由方案。
# 2026-09-01 后续真实宿主证据证明该方案职责错误，现整体撤回；不再保留设计、
# 实施步骤、fixture、验收规则或可复用机制。当前唯一方案见 plan 33714d0c。
todos:
  - id: withdrawn-git-specific-routing-record
    content: 撤回本 plan 原有 Git/SCM 专用自然语言路由方案；a49772ad 与 d47e2ea6 仅作为历史 commit 存在，不再代表当前有效能力。后续纠偏、实现与验收唯一依据为 `framework-init正向意图收口_删除Git专用路由与runtime完整性残留_33714d0c.plan.md`。
    status: cancelled
overview: >
  本 plan 的原方案已全部撤回，只保留事故与撤回事实。不得从本文件恢复、参考或推导
  framework-init 对普通任务的专用分类、交接或执行规则。当前唯一 SSOT 为 plan 33714d0c。
---

# framework-init 误触发纠偏：方案已撤回（d3a7f1c8）

状态：**已撤回；仅作简短事实记录，不是设计或实施依据。**

## 1. 原事故事实

2026-09-01，真实宿主 `D:/1.code/SimulatedWalletForHmos` 的普通任务请求曾被错误带入 framework-init。最初调查把问题归因为 framework-init 缺少对普通版本控制任务的专用分流，并据此形成了本 plan 的原方案。

随后 `a49772ad` 与 `d47e2ea6` 两轮提交围绕该判断继续增加 framework-init 自然语言分类与交接文本。后续真实回归证明，这两轮属于错误修复方向：framework-init 不应解释、枚举或接管普通任务。

同一 Codex task 的决定性证据是：

- 用户先显式调用 framework-init，再批准本轮计划与 adapters；
- 唯一真实 init run 为 `20260901T122648Z`，结果 `executed=14`、`skipped=6`、`failed=0`；
- 用户下一条普通任务消息没有工具调用、没有第二个 init report、没有产生提交；
- Agent 已先正确表示会回到普通任务，随后却重播上一轮 S4。

因此直接故障是历史 S4 被错误当成 current-turn 完成结果；给 framework-init 增加普通任务专用分类不能修复该问题，反而扩大职责并制造平行自然语言规则。

## 2. 撤回结论

本 plan 原有规范内容、实施步骤、测试场景与验收矩阵已全部删除。它们不代表当前有效能力，也不得作为后续 coder、review、测试或文档的参考来源。

`a49772ad`、`d47e2ea6` 可继续作为不可变 Git 提交历史存在；不做 rebase、filter-branch、force-push 或其它历史改写。后续只通过删除这两轮在当前代码树中的错误效果完成回滚。

## 3. 当前唯一方案

当前唯一 SSOT：

[`framework-init正向意图收口_删除Git专用路由与runtime完整性残留_33714d0c.plan.md`](framework-init正向意图收口_删除Git专用路由与runtime完整性残留_33714d0c.plan.md)

该新 plan 负责正向 init 意图、通用返回当前任务、current-turn outcome 隔离、init Git 特例退场及相应验收。本文件不再补充任何规则。
