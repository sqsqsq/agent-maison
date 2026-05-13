# Cloud SVC（云侧/库工程示例 PRD，仅用于 fixture）

> 用于回归 plan §2.0 决策表第 1 行：
> 「PRD 无 `ui_change` 块 + framework.config.json 无 `prd` 段 → check-prd 静默」。

## 0. 术语映射表

| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |
|----------|----------|--------|--------|--------|---------|
| 占位 | CloudSvc | 01-Service | high | — | [x] |

## 1. 功能概述

最小功能描述（fixture 仅断言 visual_handoff*）。

## 2. Scope 声明

```yaml
in_scope_modules:
  - CloudSvc
out_of_scope_modules: []
rationale: |
  fixture 用，不写 ui_change 块，期待 check-prd 不产出 visual_handoff*。
```

## 3. 目标用户与使用场景

| 字段 | 取值 |
|------|------|
| 用户 | 服务端调用方 |

## 4. 功能清单

| 编号 | 功能名称 | 优先级 | 描述 |
|------|---------|--------|------|
| F1 | 占位 | P0 | 占位 |

## 5. 页面/界面描述

无界面（云侧）。

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

无量化指标（fixture）。

## 9. 验收标准

**AC-1** (F1): 占位
