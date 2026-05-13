# Evolution · 演进记录

记录 framework 大版本的设计演进、踩过的坑、回退过的决策。
**与 [`framework/MIGRATION.md`](../../MIGRATION.md) 互补**：

| 文档                | 角色                                                         | 形态        |
| ------------------- | ------------------------------------------------------------ | ----------- |
| `MIGRATION.md`      | 升级 / 迁移用户指南（字段级 changelog + 操作步骤）           | 工具书      |
| `evolution/`        | 大版本背后的设计故事（"为什么 v2 翻车 / v2.1 怎么修正"）     | 演进笔记    |

## 候选议题（按需补）

- `v2-to-v2.1-ut-rollback.md`：v2 强制 UseCase 类的失败 + v2.1 回退为 YAML 规约
- `v2.2-real-build-rules.md`：UT "假 PASS" 三道护栏的诞生（tsc / hvigor / hdc）
- `v2.3-deveco-toolchain.md`：DevEco Studio 工具链识别的曲折（hvigorw 消失 → 全局 hvigor → genOnDeviceTestHap + hdc）
- `v2.4-doc-restructure.md`：文档体系迁入 framework/docs（本次）

每篇遵循"事故/契机 → 误区方案 → 真正解法 → 教训"的结构。
