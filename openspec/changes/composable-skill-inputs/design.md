## Context

按动态工作流 P1（a6d3b8f1）实施，g1 已通过。旧 contracts 默认 1.0，现有阶段与消费者默认行为保持；新 reader 和调用接口供 P2–P6 使用。

## Goals / Non-Goals

**Goals:** 内容和 binding 进入同一 CheckContext/SpecLoader/verifier/evidence；真实首调用建立 facts；旧协议显式兼容。

**Non-Goals:** 不实现 P2 范围求解/Goal 出生、P3 蓝图语义映射、P4/P5 专项 checker 策略、P6 新 CLI 或 P7 默认切换。没有动态 provider、额外数据库/manifest/场外状态。

## Decisions

- 复用 schema/loader、artifact/derive 和静态 provider。contract 1.1 使用 obligation_kinds，未绑定者显式 input_role=base/enhancement；以 schema 与 parser 同判拒绝混用，而非把新字段塞进 1.0。
- resolveCapabilityInputs 返回 report 与调用期 inputs；旧 resolveCapabilityReport 委托同一内核。每个 input 一次解析，invalid 停止，required 缺失不能 prune。报告保留 binding/attempts，内容不重复落盘。
- 注册 schema 与 SpecLoader 字段归一先于内容绑定；SpecLoader 新入口、CheckContext、verifier 上下文与材料指纹、evidence 使用同一结果。旧文件表只在 legacy 调用使用，required_outputs 由上游范围提供。
- FactsInvocationContext 由真实入口提供 subject、首阶段、当前目标和可选已验证基线。1.1 允许实际 phase 建立；继承保持原建立身份与 baseline fingerprint/依赖，增量不触发另一阶段的全量探索。request 使用显式报告目录、拒绝 Feature 完成 writer。
- profile snippets/阈值读取实际 phase；探索评分继续使用既有算法，只允许已解析内容代替旧物理文档。pass snapshot 已退役，仅改当前 checkpoint/evidence 路径，不复活场外机制。

## Risks / Trade-offs

- 运行接线分批交付 → 所有默认 contracts 保持 1.0；缺少匹配的 1.1 调用上下文直接报协议不匹配，不自动降回旧 full。
- 同一来源可能在 checker 后改变 → evidence 检查 binding 新鲜度，拒绝把新字节绑定到旧输入；正常责任修订仍交 P2 correction。
- 蓝图等价输入属于 P3 → P1 不注册空实现冒充可用，验收覆盖注册 artifact 的等价内容、现有静态 derive、真实 checker 消费、来源/版本负例；蓝图字段映射的业务语义由 P3/P5/P7 补齐。

## Migration Plan

P2/P6 经 capability-resolution-entry-input 的 invocation 接口传入已验证范围/subject/facts，并向 closure/verifier/checkpoint 传同一上下文。P3/P4/P5 逐个迁移 contract 与物理输入消费者；本次只接共享入口和所有 facts checker 调用点。公开切换及 MIGRATION.md 归 P7。
验证执行 OpenSpec 严格检查与 `cd harness && npm test`。正式发版仍必须 `npm run release:verify`（或 release:all）；按总纲 §11，本次不打包、不安装宿主、不运行发布门。

## Open Questions

无新增设计裁决；真实蓝图投影与专项完整闭环按后续 plan 验收，不以 P1 单测宣称已上线。
