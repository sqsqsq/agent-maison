# Change: lite-demo

## 意图

修复 ModA 的文案展示问题（lite 轨端到端 fixture：exit 阶段 PASS 形态——
in_scope 内有未提交改动、全部 checkbox 勾选、无越界）。

## Scope

```yaml
in_scope_modules: [ModA]
out_of_scope_modules: []
```

## 验收清单

- [x] 文案展示正确（人工确认）

## 任务

- [x] 更新 ModA 文案
