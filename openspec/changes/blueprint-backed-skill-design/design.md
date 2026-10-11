## Context

按已定稿 P3 实施，P1 typed 输入与 P2 冻结范围已提交。蓝图/CU 的现有 resolver、准入与检查仍是权威；引用存在不代表设计内容完整。

## Goals / Non-Goals

**Goals:** 蓝图验收与施工输入、受约束的物化、spec/plan 独立设计及真实 checker 消费。

**Non-Goals:** 不重做蓝图架构、不猜补外部语义、不放宽写集、不新增状态文件，不提前迁移 P4–P7。

## Decisions

1. 在 P1 静态 provider 表接入两种派生源，读取 canonical CU 的 design_refs，经既有 resolver 核对 revision/hash、来源、准入与当前切片。设计 owner 在设计期给目标写入已有 acceptance/contracts/use_cases；缺失归原补设计职责，已声明文字或坏结构为 invalid，不作推断。引用目标整体继承内容，数组按原行身份去重/合并且拒绝冲突，对象只接受完全相等声明；共享目标仅放共同内容，专属验收/写集/用例放独占目标，整个 change_unit 归 plan，不按 predicate 过滤。
2. 验收使用 AcceptanceSpec 和 check-acceptance 的共同语义。施工使用 ContractsSpec/UseCasesSpec、file-reference closure、CU sidecar/runtime 检查。规范化只能复制明确字段；设计投影保留事实/验收/模型/接口/files，忽略存量 change_unit；plan 在 Feature contracts.yaml 生成精确 canonical CU 身份与显式 ID-only 施工/测试映射，缺映射仍安排 plan，不能把 touches 当授权。
3. 派生输入与产物输入进入同一 ResolvedPhaseInputs。交接 readiness 在调和非 busy 后，对全部未退役且原 constructable CU 调用默认只读检查，逐类校验且保留手写 use-cases 冲突检查；不物化或产 phase 证据，absent 不加新门，invalid 复用原原因 not-ready。正常交接不物化，spec/plan 直接消费推导输入各写本阶段产物；投影带用例时 plan 必须写 use-cases.yaml 供真实业务 UT，required_outputs 不只看文件存在。显式物化兼容入口沿现有 artifact path 写入真实机器契约，先验证所有内容和来源，再检查既有产物冲突；不生成 spec/plan summary 或空叙述文件。已有带戳文件可沿同一权威对齐补缺；仅身份刷新保留阶段补充字节，设计/CU 内容真变退责任，不合并。文档只用 canonical 纯选取/合并结果展示声明，不冒充完整交接校验。
4. 新调用的 spec/plan checker 将叙述格式检查限定在 required_outputs，直接消费已写入的 typed 设计，只补本职责未声明内容，继续执行机器契约、事实、视觉适用性与来源检查。无 ui-spec 依据的 P0 真机验收保留步骤/预期/分层/focus，真实 UI 关联由 spec 不冲突补缺键，保留原权威预期及原对齐/P0 门。旧调用保留原检查语义；P2 负责修订和设计请求终点。

## Risks / Trade-offs

- 未有精确施工/验收字段 → 明确返回 spec、plan、蓝图或外部 owner 缺口，不把缺字段当可跳过。
- 投影可能过期或覆盖人工决策 → 复用绑定与 canonical 身份校验；物化拒绝冲突，已有人工文件仍为有序 artifact 来源。
- 新旧调用并存 → 使用既有 inputContext/contract 版本分流，默认 workflow 不切换；真实宿主验收仍由 P7 汇总。

## Migration Plan

先实现 provider 与负例，再接 checker/Skill/输出与 P2 测试。全量 harness 与 OpenSpec 通过后交 P4/P5；正式发布沿现有 release:verify/release:all，MIGRATION.md 由 P7 汇总。

## Open Questions

无新增产品裁决。
