## Context

按已定稿 P3 实施，P1 typed 输入与 P2 冻结范围已提交。蓝图/CU 的现有 resolver、准入与检查仍是权威；引用存在不代表设计内容完整。

## Goals / Non-Goals

**Goals:** 蓝图验收与施工输入、受约束的物化、spec/plan 独立设计及真实 checker 消费。

**Non-Goals:** 不重做蓝图架构、不猜补外部语义、不放宽写集、不新增状态文件，不提前迁移 P4–P7。

## Decisions

1. 在 P1 静态 provider 表接入两种派生源，读取 canonical CU 的 design_refs，经既有 resolver 核对 revision/hash、来源、准入与当前切片。选中目标中明确的 acceptance/contracts/use_cases 内容才可投影；纯文本和 verification_refs 只产生缺口，不作推断。
2. 验收使用 AcceptanceSpec 和 check-acceptance 的共同语义。施工使用 ContractsSpec/UseCasesSpec、file-reference closure、CU sidecar/runtime 检查。规范化只能复制明确字段；沿蓝图 contracts.change_unit 的显式 ID-only 施工/测试映射生成 sidecar 并补入 canonical 身份，映射内容缺失仍回 plan，不能把 touches 当授权。
3. 派生输入与产物输入进入同一 ResolvedPhaseInputs。唯一物化入口沿现有 artifact path 写入真实机器契约，先验证所有内容和来源，再检查既有产物冲突；不生成 spec/plan summary 或空叙述文件。
4. 新调用的 spec/plan checker 将叙述格式检查限定在 required_outputs，继续执行机器契约、事实、视觉适用性与来源检查。旧调用保留原检查语义；P2 负责修订和设计请求终点。

## Risks / Trade-offs

- 未有精确施工/验收字段 → 明确返回 spec、plan、蓝图或外部 owner 缺口，不把缺字段当可跳过。
- 投影可能过期或覆盖人工决策 → 复用绑定与 canonical 身份校验；物化拒绝冲突，已有人工文件仍为有序 artifact 来源。
- 新旧调用并存 → 使用既有 inputContext/contract 版本分流，默认 workflow 不切换；真实宿主验收仍由 P7 汇总。

## Migration Plan

先实现 provider 与负例，再接 checker/Skill/输出与 P2 测试。全量 harness 与 OpenSpec 通过后交 P4/P5；正式发布沿现有 release:verify/release:all，MIGRATION.md 由 P7 汇总。

## Open Questions

无新增产品裁决。
