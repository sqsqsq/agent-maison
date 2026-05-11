# PRD 术语映射表示例（钱包域，由根 Skill 迁入）

| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项（必读） | 用户确认 |
|---------|---------|--------|--------|---------------|---------|
| 卡中心 | WalletMain | 02-Feature | medium | 卡管理 (CardManager) — 卡中心是 UI 页面，卡管理是后端能力 | [ ] |
| 添卡入口 | WalletMain | 02-Feature | high | — | [ ] |

反模式示例：勿将「卡中心」直接映射为 `CardManager`；勿在映射表写 `卡中心 → CardManager` 却不在 Scope 中声明 `CardManager`。
