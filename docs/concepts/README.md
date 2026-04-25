# 跨 Skill 概念

收纳 framework 中**横切多个 Skill 的设计理念**。每份文档不是"某个 Skill 怎么做"，
而是"贯穿整个流程的某条思路"。

| 文件                                                       | 写了什么                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [`terminology-guarding.md`](./terminology-guarding.md)     | 术语守门：catalog + glossary + 三道 BLOCKER + 演进路线图              |

## 候选议题（按需补）

- `scope-guarding.md`：三阶段 Scope 守门（PRD 声明 → design 继承 → coding diff 比对）
- `dual-harness.md`：脚本 Harness vs AI Harness 的分工 + 模型无关性的实现
- `weak-model-defense.md`：弱模型吞字反转语义的防护策略（三分区纪律 / negation-diff verifier）
- `vendoring-vs-submodule.md`：framework 在目标工程中的两种部署模式对比
