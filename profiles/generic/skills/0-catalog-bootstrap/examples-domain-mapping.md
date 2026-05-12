# 领域填充实例（中性示例 · `generic` profile）

> 仅供演示 **catalog / glossary 字段怎么写**。模块名与业务词请替换为你自己工程的真实命名；外层 `layer` 必须能在 `framework.config.json > architecture.outer_layers[].id` 中找到。

## CREATE 模式展示示例（节选）

```
📦 InventoryService（示例公共能力模块）
One-liner:           条目元数据校验与聚合读模型，可被多个 Feature 复用
NOT_responsible_for:
  1. 具体页面布局与路由（归各 Feature UI 模块）
  2. 账号与会话签发（归属平台层帐号能力模块）
Easily_confused_with:
  • FeatureItemsUI — 用户可见列表/详情 vs 本条目的领域服务编排
```

## Glossary 逐条确认示例

术语「条目库」→ canonical module: InventoryService；易混：列表页 (FeatureItemsUI)。
