# Change: lite-demo

## 意图

修复 ModA 的文案展示问题（lite 轨端到端 fixture：exit 坏态——开发期未提交
改动越界到 scope 外模块 ModB，红线 diff_within_scope 应 FAIL）。

## Scope

```yaml
in_scope_modules: [ModA]
out_of_scope_modules: [ModB]
```

## 验收清单

- [x] 文案展示正确（人工确认）

## 任务

- [x] 更新 ModA 文案
