# Change: lite-demo

## 意图

修复 ModA 的文案展示问题。Scope 是模型的模块预测，不是原始请求的明确限制；实际必要改动涉及 ModB，不因预测遗漏判越界。原请求真实限制由共享范围判据的反例覆盖。

## Scope

```yaml
in_scope_modules: [ModA]
out_of_scope_modules: [ModB]
```

## 验收清单

- [x] 文案展示正确（人工确认）

## 任务

- [x] 更新 ModA 文案
