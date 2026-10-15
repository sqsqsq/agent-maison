---
description: 为指定函数或本地新改代码补充、修复或运行 UT；无需需求号，写测试前确认载体。
argument-hint: '[函数或代码范围 | 测试文件 | feature-name]'
---

# /business-ut — 业务级 UT / DAG

**用户输入**：$ARGUMENTS

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/business-ut/SKILL.md](../../framework/skills/feature/business-ut/SKILL.md)**
