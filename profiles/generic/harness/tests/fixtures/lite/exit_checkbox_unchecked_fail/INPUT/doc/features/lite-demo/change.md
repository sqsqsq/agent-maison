# Change: lite-demo

## 意图

修复 ModA 的文案展示问题（lite 轨端到端 fixture：exit 坏态——任务未勾选，
闭环判据不成立）。

## Scope

```yaml
in_scope_modules: [ModA]
out_of_scope_modules: []
```

## 验收清单

- [x] 文案展示正确（人工确认）

## 任务

- [ ] 更新 ModA 文案
