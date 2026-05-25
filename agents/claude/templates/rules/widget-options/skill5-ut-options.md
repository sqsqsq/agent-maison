# Skill 5 UT — Widget 选项固定文案（SSOT）

> registry：`ut.plan_confirm` / `ut.mock_plan` / `ut.src_mutation` / `ut.dag_confirm` / `ut.ok_to_testing`

---

## plan_confirm（Step 1 HARD STOP · gate）

| # | value | label |
|---|-------|-------|
| 1 | `confirm_plan` | 确认 UT 规划清单 — 可进入 Step 1.5+ / DAG |
| 2 | `adjust_plan` | 调整清单 — 我要修改 UT 规划后再继续 |

Portable：`1=确认 UT 规划清单` / `2=调整清单`

---

## mock_plan（Step 1.6 HARD STOP）

| # | value | label |
|---|-------|-------|
| 1 | `confirm_mock` | 确认 mock-plan — 按当前 mock-plan 继续 |
| 2 | `adjust_mock` | 调整 mock-plan — 我要修改 spy/preset 计划 |

Portable：`1=确认 mock-plan` / `2=调整 mock-plan`

---

## src_mutation（约束 #12 / §7.5.4 · freeform）

**须先展示完整变更描述**（路径、签名、理由、影响面），再调 AskUserQuestion：

| # | value | label |
|---|-------|-------|
| 1 | `approve` | 授权改源码 — 记录用户原话到 gap-notes approved_src_mutations |
| 2 | `reject` | 拒绝 — 不改受保护业务源码 |
| 3 | `see_diff` | 先看 diff — 展示 diff 后再决定 |

Portable：`1=授权` / `2=拒绝` / `3=先看 diff`

---

## dag_confirm（Mermaid DAG）

| # | value | label |
|---|-------|-------|
| 1 | `confirm_dag` | 确认 DAG — 按当前 DAG 继续 |
| 2 | `edit_dag` | 修改 DAG — 我要调整 DAG 结构 |

Portable：`1=确认 DAG` / `2=修改 DAG`

---

## ok_to_testing（Step 8 闭环 · UT→testing）

| # | value | label |
|---|-------|-------|
| 1 | `ok_testing` | UT OK — 可进入 Skill 6 真机测试 |
| 2 | `pause` | 暂停 — 暂不进入真机测试 |
| 3 | `other` | 其它 — 我在对话中说明意图 |

Portable：`1=UT OK，可进 Skill 6` / `2=暂停` / `3=其它（说明）`
