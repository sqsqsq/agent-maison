---
# Context Exploration Gate — 阶段探索摘要（与 phase-completion-receipt 同目录落盘）
# 路径：doc/features/<feature>/<phase>/context-exploration.md（默认，以 framework.config.json paths 为准）
# 模板：framework/harness/templates/context-exploration.md
# 机器门禁：check-* 校验 frontmatter；深度充分性由 verify-*.md 语义审查。
#
schema_version: "1.0.0"
feature: "<feature-name>"
phase: "<prd | design | coding | review | ut>"
ready_to_produce: false
# 仍存在未读清即可能影响 BLOCKER 级结论的缺口时置 true（脚本 harness 将 FAIL）
has_blocker_coverage_risk: false
# 每条一行说明：读了什么、路径或关键词、结论一句（须覆盖当前阶段最低输入类别，见各 SKILL「Context Exploration Gate」）
key_inputs_read:
  - "paths.module_catalog — 已读"
  - "paths.glossary — 已读"
  - "paths.architecture_md — 已读"
# 若启动了只读探索子 agent，简述角色与范围；否则填 "not_available" 或等价说明
subagents_used: ""
# 检索次数（估算或精确）、检视文件数（填入数字便于 trace 回填）
searches_performed_estimate: 0
files_inspected_count: 0
---

## 探索预算与检索

> 记录关键词、目录范围、目的；勿粘贴大段代码。

- ...

## 已检视文件与原因

| 路径（相对仓库根） | 为何读 |
|-------------------|--------|
| ...               | ...    |

## 关键结论（支撑本阶段产出）

- ...

## 覆盖风险（诚实声明）

| 风险 | 处理 |
|------|------|
| ...  | 接受 / 待补 / BLOCKER |

## 进入产出

仅在 `ready_to_produce: true` 且 `has_blocker_coverage_risk: false` 时进入本阶段主产物撰写。
