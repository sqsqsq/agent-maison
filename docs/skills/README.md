# Skills 阶段对外讲解

每个 Skill 配一份 `<idx>-<name>.md`，定位是**对外讲解 + 设计回顾**：

- 这个阶段为什么存在 / 解决什么问题
- 核心产物是什么（schema 摘要，不重复 SKILL.md 全文）
- 关键门禁与背后的"血泪史"
- 与上下游 Skill 的契约
- 常见坑、典型反模式

**不重复**：

- SKILL.md 中的"按 Step 操作"流程（操作手册留在 SKILL.md）
- phase-rules YAML 的逐字段定义（请直接看 spec）

| 文件                                                  | 状态     |
| ----------------------------------------------------- | -------- |
| [`business-ut.md`](./business-ut.md)              | ★ 已写   |
| `spec.md`                                     | 待写     |
| `plan.md`                             | 待写     |
| `coding.md`                                         | 待写     |
| `code-review.md`                                    | 待写     |
| `device-testing.md`                                 | 待写     |

新增一份 Skill 文档时，**别忘了**在 `framework/docs/DOC_INVENTORY.yaml`
中同步登记 `path` + `sources` + `update_triggers`。
