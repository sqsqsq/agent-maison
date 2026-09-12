## Context

执行已定稿 P4，前置 P1/P2/P3 与 P6 专项 CLI 已交付。当前 coding 仍直接从 plan.md 取模块范围，UI 白名单固定取 plan closure；review 的输入能力仍捆绑 spec/plan 文档。

## Goals / Non-Goals

**Goals:** coding/review 使用真实绑定的施工输入；无叙述设计时仍验证写集、CU、契约和编译；独立 review 保留内容及基线检查。

**Non-Goals:** 不新增范围权威、基线文件或状态协议；不修改义务计算和蓝图 writer，不迁移 UT/testing 或发布默认值。

## Decisions

1. coding/review contract 使用现有 1.1 schema、P3 蓝图来源和 P1 base/enhancement/obligation 分类。旧 workflow 调用保留窄兼容入口，现代调用不按 track 再分路。
2. 模块/文件授权由解析后的 typed contracts 与 run 出生绑定承接；继续使用既有 diff、run baseline、UI scope 和引用闭包实现。叙述章节仅在有真实消费文档时检查。
3. 组合 review 对照 resolved contracts/acceptance 与蓝图引用；专项使用现有 request context 和输出路径。报告格式、负面结论及 Feature attestation 责任不变。
4. Skill/phase rules/verifier 明确首阶段 facts、设计回退与请求终点；回退和后继继续消费 P2 原协议，不能自行扩大授权。

## Risks / Trade-offs

- 缺文档被误当缺设计 → 使用同一 P1/P3 解析来源；无合法契约仍失败。
- 跳过 plan 丢失写集冻结 → 核验既有出生绑定与当前输入，不接受仅有 live contracts 的自我授权。
- 宿主实现差异 → 保留 profile 编译与结构检查，使用真实最小代码夹具验收；真实宿主验证由 P7 汇总。

## Migration Plan

本批只迁移 coding/review 消费与合同，旧 run/默认 workflow 的公开迁移仍由 P7 负责；不发版、不另设开关。
