# 钱包域示例（由根 `framework/skills/0-catalog-bootstrap/SKILL.md` 迁入）

> 仅供 **hmos-app / 钱包类工程** 参考；根 Skill 正文已中性化为 `<ModuleName>` / `<FeatureModule>` 占位。

## CREATE 模式展示示例（节选）

```
📦 FinancialCard（新建）
One-liner:           金融卡模块，内部包含银行卡和 HuaweiCard 两大分类
NOT_responsible_for:
  1. 卡聚合 UI 页面（归 WalletMain）
  2. 跨卡种统一管理（归 CardManager）
Easily_confused_with:
  • CardManager — 管理所有卡种的统一能力 vs 金融卡专有业务
```

## Glossary 逐条确认示例

术语「卡中心」→ Canonical module: WalletMain；易混：卡管理 (CardManager)。
