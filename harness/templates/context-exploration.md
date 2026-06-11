---
# Context Exploration Gate — 阶段探索摘要（与 phase-completion-receipt 同目录落盘）
# 路径：doc/features/<feature>/<phase>/context-exploration.md（默认，以 framework.config.json paths 为准）
# 模板：framework/harness/templates/context-exploration.md
# 机器门禁：check-* 校验 frontmatter + schema 1.1.0 量化阈值；语义审查见 verify-*.md behavior_* 检查项。
# 行为规约：framework/skills/reference/agent-behavioral-principles.md（Research Sub-Phase 必读）
#
schema_version: "1.1.0"
feature: "<feature-name>"
phase: "<spec | plan | coding | review | ut>"
ready_to_produce: false
has_blocker_coverage_risk: false
key_inputs_read:
  - "paths.module_catalog — 已读"
  - "paths.glossary — 已读"
  - "paths.architecture_md — 已读"
# 实际 Read/Grep 过的源码/实现文件（相对仓库根；harness 验证磁盘存在）
source_code_paths: []
# subagent | sequential | minimal（复杂度越阈时禁止 minimal）
exploration_mode: "sequential"
# 变更意图（v2.10 exploration_strategy 分类器输入）
change_intent: "feature"
estimated_loc_delta: 0
touches_layers: []
adds_new_exports: false
single_function_scope: false
# 本次探索解锁、即将写入主产物的决策（1:1 对应后续章节/文件）
decisions_unlocked: []
subagents_used: ""
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

## Code Facts（代码事实，BLOCKER 级必填）

| 路径 | 发现的事实 | 对本阶段产出的影响 |
|------|-----------|------------------|
| ...  | ...       | ...              |

## 关键结论（支撑本阶段产出）

- ...

## 覆盖风险（诚实声明）

| 风险 | 处理 |
|------|------|
| ...  | 接受 / 待补 / BLOCKER |

## 进入产出

仅在 `ready_to_produce: true` 且 `has_blocker_coverage_risk: false` 时进入本阶段主产物撰写。
完成 Research Sub-Phase 自检清单（见 agent-behavioral-principles.md）后再置 `ready_to_produce: true`。
