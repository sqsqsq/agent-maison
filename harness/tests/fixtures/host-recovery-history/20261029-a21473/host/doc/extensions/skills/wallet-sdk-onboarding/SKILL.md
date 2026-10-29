---
name: wallet-sdk-onboarding
description: 钱包 SDK 接入向导（实例扩展演示；agentskills.io 风格 frontmatter 对齐）
license: MIT
---

# 钱包 SDK 接入向导（演示 Skill）

本 Skill 位于 **`doc/extensions/skills/`**，由实例扩展 manifest 声明，不属于 `framework/skills/` 核心链。

## 何时使用

- 需要在模拟钱包工程中接入第三方支付 SDK 前的**自检清单**与术语对齐。

## Step 1 — 阅读 SSOT

1. 模块边界以仓库 `doc/module-catalog.yaml` 为准。
2. 宿主编码规范仍以当前 `project_profile` 的 Skill 3 addendum 为准。

## Step 2 — 产出

演示阶段不要求额外落盘；真实工程中应在 PRD/design 中声明 SDK 依赖与权限范围。

## 完成标准

读完本文并能在对话中复述：**扩展 Skill 正文只在 `doc/extensions/`，跳板由 `render-agents-md` 按 adapter 自动生成。**
