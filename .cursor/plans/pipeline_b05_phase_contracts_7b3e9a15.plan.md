---
name: 六阶段重构 B05 提纲 — 既有策略配置与适用性出口
overview: 仅F08、剩余F09、plan不适用出口和数量WARN口径；保留goal默认strict，不重写阶段角色、测试体系或可测性流程。
version: 3.0.0
todos:
  - id: b05-detail-after-b04
    content: 根据前批宿主反馈将四项范围细化为具体代码/提示改法、代价、提交边界与命令，未细化不实施。
    status: pending
  - id: b05-quality-policy
    content: 保留goal默认strict，允许用户显式evidence_profile配置生效并沿用现有保留阶段集合；不统一强制降档或改变质量目标。
    status: pending
  - id: b05-facts-and-prompts
    content: B01已删除的过时指令不重复改；仅核对剩余F09和本批行为文案，源Skill/模板/物化口径一致。
    status: pending
  - id: b05-plan-applicability
    content: 给确实不涉及模型/服务/页面树的HMOS plan合法不适用出口；contracts仍是真源，真实涉及项不能以n/a豁免。
    status: pending
  - id: b05-test-quality
    content: 静态it_drives_flow原已WARN，保持；仅修正数量建议与verifier仅凭单expect判FAIL，真正业务流程/覆盖/断言要求保留。
    status: pending
  - id: b05-testability-frontload
    content: 本轮取消可测性前移体系和测试质量体系重写；没有宿主浪费证据不增加设计机制，后续需重新登记。
    status: cancelled
  - id: b05-local-acceptance
    content: 完成默认/显式配置、n/a真假、数量提示与实际业务缺陷的目标测试，文档/OpenSpec和candidate本地验收。
    status: pending
  - id: b05-host-acceptance
    content: 用户触发bc-openCard-1的C-U受影响goal窗口，确认配置/适用性/提示有效且真实缺陷仍被发现，闭环后进入B06差异验收。
    status: pending
---

# B05滚动提纲

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。依赖B04宿主反馈。只保留以下四项，不重新设计整个六阶段工作流。

## 四项边界

| 项 | 最小方向 | 不做 |
|---|---|---|
| F08 | [runtime-policy](../../harness/scripts/utils/runtime-policy.ts)保留无配置时goal strict；显式balanced按既有配置/保留phase生效 | 不因“同风险”一刀切默认降档，不发明风险评分器 |
| 剩余F09 | B01已修的facts/attestation/无provider文案复用；同步剩余确认过的矛盾及本批变化 | 不全仓重写历史计划，不重复删同一处 |
| plan不适用出口 | [check-plan](../../harness/scripts/check-plan.ts)及HMOS overlay对确实不涉及项接受依据明确的n/a | 不靠n/a跳过真实契约，不改成新适用性账本 |
| 数量启发式 | [check-ut](../../harness/scripts/check-ut.ts)现有it_drives_flow已是MAJOR WARN；对齐建议及 [verify-ut](../../harness/prompts/verify-ut.md)中仅凭单expect硬判 | 不取消真实流程/边界断言，不重写DAG/mock/覆盖体系 |

显式配置只改变证据工作量，不降低用户冻结的功能/视觉目标，不覆盖真实失败。manual/batch授权、设备安全和预算仍按原规则。

## 取消范围

可测性前移、测试体系重写、全阶段角色重新分配、去除所有重叠审查、native /goal重构不进入本批。原b05-testability-frontload取消，不能在实施中借“简单优先”扩成新的架构流程。

## 细化与验收

施工前明确每个n/a判据的实际数据来源、受影响check及假n/a负例；明确配置默认/显式行为表、受影响保留phase；区分单expect但断言有效与多expect但没测真实业务。命令使用已有suite/fixture，不新增测试框架。

每批仍需本地目标/发布内容验收和用户触发C-U受影响窗口；核心四格契约覆盖、K/A仅补充fixture，未实测不写PASS。
