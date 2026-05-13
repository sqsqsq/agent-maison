# 领域建模填充示例（hmos-app profile）

> **中性示例**：占位模块名仅代表「业务领域 → catalog 条目」的写作方式；与具体行业无关。

## CREATE 模式展示示例（节选）

```
📦 FeatureDemoHome（新建）
One-liner:           宿主端 feature 宿主壳层，负责任务入口聚合与宿主级导航占位
NOT_responsible_for:
  1. 具体业务表单或领域规则（由各 FeatureXXX 模块承担）
  2. 跨 feature 的一致性策略编排（由各协调模块承担）
Easily_confused_with:
  • FeatureCoordinator — 多步业务流程编排 vs 宿主壳只做入口呈现
```

## Glossary 逐条确认示例

术语「主页」→ Canonical module: FeatureDemoHome；易混：任务协调模块 (FeatureCoordinator)。
