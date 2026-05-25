# phase.next_step — Widget 选项固定文案（SSOT）

> registry：`phase.next_step`（各 feature phase 闭环后复用；`{next_skill_label}` 由 agent 按当前 phase 替换）

---

## next_step（阶段闭环后 · BLOCKER）

| # | value | label |
|---|-------|-------|
| 1 | `enter_next` | 进入下一 Skill — {next_skill_label} |
| 2 | `pause` | 暂停 — 本阶段到此，暂不进入下游 |
| 3 | `other` | 其它 — 我在对话中说明意图 |

Portable：`1=进入下一 Skill` / `2=暂停` / `3=其它（说明）`

**按 phase 的 `{next_skill_label}` 速查**：

| 当前 phase | next_skill_label |
|------------|------------------|
| prd | Skill 2 技术设计 |
| design | Skill 3 编码 |
| coding | Skill 4 Code Review |
| review | Skill 5 业务级 UT |
| ut | Skill 6 真机测试 |
| testing | （无下一 Skill；选项 1 改为「结束交付 / 归档」或引导用户说明） |
