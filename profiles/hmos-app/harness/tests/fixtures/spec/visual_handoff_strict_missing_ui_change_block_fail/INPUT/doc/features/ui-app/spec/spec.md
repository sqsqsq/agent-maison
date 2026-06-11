# UI App（前端工程示例 spec，仅用于 fixture）

> 用于回归 plan §2.0 决策表第 2 行：
> 「spec 无 `ui_change` 块 + framework.config.json `spec.visual_handoff_enforcement: strict` → BLOCKER FAIL」。

## 0. 术语映射表

| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |
|----------|----------|--------|--------|--------|---------|
| 占位 | UiApp | 01-Product | high | — | [x] |

## 1. 功能概述

最小描述，fixture 故意不写 ui_change 块。

## 2. Scope 声明

```yaml
in_scope_modules:
  - UiApp
out_of_scope_modules: []
rationale: |
  fixture 用，不写 ui_change 块；strict 档位下应被 visual_handoff_ui_change 拦下。
```

## 3. 目标用户与使用场景

| 字段 | 取值 |
|------|------|
| 用户 | 演示 |

## 4. 功能清单

| 编号 | 功能名称 | 优先级 | 描述 |
|------|---------|--------|------|
| F1 | 占位 | P0 | 占位 |

## 5. 页面/界面描述

短。

## 6. 业务流程图

```mermaid
flowchart LR
  A --> B
```

## 7. 异常/边界场景

| 场景 | 描述 |
|------|------|
| 占位 | 占位 |

## 8. 非功能性需求

占位。

## 9. 验收标准

**AC-1** (F1): 占位
