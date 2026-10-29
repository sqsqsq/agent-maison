# 钱包侧 RPC / 调用约定（演示 reference）

演示用附录：与 `wallet-sdk-onboarding` Skill 同目录存放，便于 agentskills.io 式相对引用。

- 请求/响应体字段命名使用稳定英文 snake_case 或业务 glossary 已映射中文术语的英文对。
- 超时、重试与幂等键应在 design `contracts.yaml` 中显式约定；本附录不写硬编码阈值。

白名单路径：plan §7.13 skills/wallet-sdk-onboarding/reference/wallet-rpc-conventions.md
