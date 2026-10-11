## Context

实施边界由已批准 plan 7c2e9a41 冻结。现有 renderer 仅消费蓝图，publication 逐字节校验，设计准备和 B1 已有唯一持锁调和入口。真实宿主 rev3 缺 review_summary 标题/摘要、部分 rationale，两个 CU 目的相同；样稿不能替代正式设计流程验收。

## Goals / Non-Goals

**Goals:** 默认同页展示需求、方案、CU 拆分、风险验收；可读草稿；canonical 内容变化或批次指针调和后同步；来源与格式差异可重建。

**Non-Goals:** 不新增设计 schema、注册状态、BLOCKER、人工审批、外部平台或语言配置。不改变原准入、授权、readiness、recovered 与锁所有权。

## Decisions

- 复用 canonical loader 和目录规则，抽出路径枚举供逐项容错展示；严格消费者保持一项失败整批失败。使用既有退役判定、模块派生与 identityNeutralDigest，摘要实现原样下移避免循环依赖。
- 文档是蓝图与 CU 的单向派生物。稳定地址和 closure 共用精确直接引用判定；不把直接引用作覆盖裁决。待升版 CU 保留自身契约，派生模块和设计链接待绑定；真实错误独立披露。
- 唯一 writer 完整渲染、复核源集合和字节、临时文件替换；同字节不重写。generation 不调和、不升 revision、不重新质询。publication 共用收集/renderer，比对全文与历史 CU 附录。
- 在接受、readiness、持锁整批调和与 B1 发布后接线；内部刷新与外层补生成按最终状态汇总，保留所有实际写入路径。展示失败只影响文档结果，原业务判定继续。
- 中文固定标题；源叙述原样展示。设计 owner 在现有字段按项目语言写清背景、方案、非范围与取舍，不为凑文档新增 decision。

## Risks / Trade-offs

- [存量设计缺少叙述] → 如实标未记录，设计 owner 沿既有权责修订；t5 用正式设计流程验收。
- [手工写入不受锁约束] → 写前复核 canonical 与 CU 集合，来源变化返回可重试失败。
- [文件系统故障] → 保留旧文件和 canonical 结果，输出重建命令；不新增施工停机原因。

## Migration Plan

发布件集成后执行既有 check:component-blueprint --write-review。旧 @1 投影按 @2 重建，不修改 canonical revision。hmos-app 设计 lens 边界和可选 publication adapter 保持；真实宿主采用由主代理协调。

## Open Questions

无实施阻断问题。真实宿主 t5 等待已校验发布件采用，不以样稿代替。
