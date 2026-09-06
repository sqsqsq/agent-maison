---
name: 六阶段重构 B04 提纲 — 归因与prior review消费一致
overview: 收缩为已有失败归因和旧审查消费口径两项；one-shot与新变化范围调度暂不实施，等待真实宿主证据。
version: 3.0.0
todos:
  - id: b04-detail-after-b03
    content: 根据B01至B03宿主反馈细化仅归因和prior review消费两项，明确具体分支、文件、代价及验收命令。
    status: pending
  - id: b04-failure-attribution
    content: 修正已证实的缺证/调用故障被误归产品回归及相应NEXT，复用既有结构化分类，不建立新根因系统。
    status: pending
  - id: b04-prior-review-consumers
    content: 统一check-receipt/finalizer/snapshot/goal和非goal展示对prior PASS与未重审差异的口径，不改旧审查复用政策。
    status: pending
  - id: b04-effective-attempt
    content: 本轮暂不实施one-shot与无进展改造；函数复现不足以推翻08-26熔断经验，等真实浪费证据后重新登记。
    status: cancelled
  - id: b04-change-scope
    content: 本轮取消新增变化范围补查调度；继续使用已有revalidate/风险分级，不建语义diff或新状态。
    status: cancelled
  - id: b04-local-acceptance
    content: 完成归因与prior review生产消费者等值测试、必要文档/OpenSpec和candidate本地验收。
    status: pending
  - id: b04-host-acceptance
    content: 用户触发bc-openCard-1的C-U受影响goal窗口，验证诊断/审查覆盖说明与实际一致，闭环后才进B05。
    status: pending
---

# B04滚动提纲

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。依赖B03宿主反馈。本轮仅两项，不按原“局部回修/有效重试”大范围实施。

## 保留项

1. 归因：定位具体缺证/调用问题被默认code_regression的分支，消费现有check结构化信息给正确下一步；未知就是未知，不新造自动根因推理器。
2. prior review：已有completed_with_prior_review及未重审差异是正确取舍；对照check-receipt、finalizer、snapshot、goal报告和非goal呈现，避免一处已沿用另一处又误报没审过。不得将旧PASS说成当前材料完整重审。

位置：[goal-failure-classifier](../../harness/scripts/utils/goal-failure-classifier.ts)、[verifier-evidence](../../harness/scripts/utils/verifier-evidence.ts)、[goal-phase-snapshot](../../harness/scripts/utils/goal-phase-snapshot.ts)、[phase-closure-finalizer](../../harness/scripts/utils/phase-closure-finalizer.ts)。具体需改分支在细化时以宿主证据冻结。

## 暂不实施

保留one-shot、08-26防交替死循环熔断和现有预算。timeout settled进入attempted是代码事实，但尚无宿主实证证明浪费了有效修复机会；不据此重做恢复协议。原effective-attempt任务本轮cancelled，表示退出本轮实施范围，不表示以后永不讨论。

不新增变化范围补查调度，不改全链失效政策、不重做revalidate/assess；既有分级提示与检查工具照常可用。可测性/测试架构不在本批。后续新证据需重新登记todo，不能作为正文隐性待办。

## 细化与验收

细化需给出输入错误→旧动作→新动作，以及prior/current报告选择和消费者一致表；配真实生产读取测试，确保不拿旧正文造当前新候选。无任何新失败归因证据时不为了完成计划造变更。

四主格代码覆盖、K/A回放fixture；用户触发C-U受影响窗口，核对说明准确、原熔断与授权不回归。candidate和命令准备好后交用户，host通过才进B05。
