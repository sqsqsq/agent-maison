# Change: lite-demo

## 意图

修复 ModA 的解析函数（lite 轨端到端 fixture：exit 坏态——验收清单声明了
[unit] 条目，但 in_scope 模块下没有任何 UT 文件，条件 UT 应 fail-closed）。

## Scope

```yaml
in_scope_modules: [ModA]
out_of_scope_modules: []
```

## 验收清单

- [x] [unit] parseFoo 对空输入返回 null

## 任务

- [x] 实现 parseFoo
