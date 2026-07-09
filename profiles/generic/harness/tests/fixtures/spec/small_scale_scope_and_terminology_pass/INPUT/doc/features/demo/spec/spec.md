# demo（fixture：small 档一次性确认 + scope_matches_catalog 端到端）

> exploration-scale 已知缺口收口：project_scale=small 的术语映射表一次性确认分支与
> scope_matches_catalog 等其它 spec 检查在同一次真实 phase 跑中互不干扰。

## 0. 术语映射表

| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |
|----------|----------|--------|--------|--------|---------|
| 占位 | ModA | 02-Feature | medium | — | [ ] |

- [x] 已对照 architecture.md 模块清单一次性确认全部术语映射

## 1. 功能概述

最小 spec；逐行未确认（用户确认列为 `[ ]`），仅靠 small 档一次性确认行放行。

## 2. Scope 声明

```yaml
in_scope_modules:
  - ModA
out_of_scope_modules: []
rationale: |
  fixture：验证 small 档一次性确认不影响 Scope 声明对 module-catalog 的正常校验。
```

## 3. 目标用户与使用场景

| 字段 | 取值 |
|------|------|
| 用户 | fixture |

## 4. 功能清单

| 编号 | 功能名称 | 优先级 | 描述 |
|------|---------|--------|------|
| F1 | 占位 | P0 | 占位 |

## 5. 页面/界面描述

无界面（fixture）。

## 6. 业务流程图

```mermaid
flowchart LR
  A --> B
```

## 7. 异常/边界场景处理

| 场景 | 描述 |
|------|------|
| 占位 | 占位 |

## 8. 非功能性需求

无量化指标（fixture）。

## 9. 验收标准

**AC-1** (F1): 占位
