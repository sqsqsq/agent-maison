---
name: 编号 skill 残留清扫
version: 2.4.0
superseded_by: 编号_skill_彻底清扫_5cfd4d43.plan.md
overview: "【已作废】最小档 plan：仅 A+C + 故意保留桶。请改读 superseded_by 指向的彻底清扫 plan。"
todos:
  - id: fix-code-review-title
    content: "A: skills/feature/code-review/SKILL.md L1 标题 `4-code-review` → `code-review`"
    status: cancelled
  - id: normalize-init-labels
    content: "B(可选): 6 个 feature SKILL.md L7 链接 label `00-framework-init` → `framework-init`"
    status: cancelled
  - id: harden-scanner
    content: "C: no-numbered-skill-scan.ts 增加反引号 id 形检测"
    status: cancelled
  - id: verify-tests
    content: "D: 全仓复扫仅剩故意保留桶；npm test PASS"
    status: cancelled
isProject: false
---

# 编号 skill 残留清扫

> **已作废**：本 plan 已被 [`编号_skill_彻底清扫_5cfd4d43.plan.md`](编号_skill_彻底清扫_5cfd4d43.plan.md) 取代。
> 作废原因：Review 指出区间缩写（`spec~6`、`Skill (1-6)` 等）漏网且旧验收 D 会假绿；用户确认 **purge_everywhere**（含 MIGRATION 编号对照表）。
> 下文保留作历史参考，**勿按本文件实施**。

## 原改造点（归档）

- A：code-review 标题 `` `4-code-review` ``
- B（可选）：6× `` `00-framework-init` `` label
- C：反引号 id 扫描
- D：`npm test` + 故意保留桶

详见新 plan Phase A–C。
