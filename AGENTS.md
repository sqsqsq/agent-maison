# AGENTS.md — AgentMaison 开发指令
> 品牌：**AgentMaison**；消费者 submodule 路径仍为 **framework/**。
## 目录分层（BLOCKER）
**发布内容**：skills/ specs/ harness/ profiles/ agents/ workflows/ templates/ docs/
**开发工具（不进发布件）**：.cursor/ .claude/ .codex/ openspec/
## 开发验收（BLOCKER）
改动发布内容后：`cd harness && npm test` 必须全 PASS。
maison 自身不走 Skill 0–6；harness-runner 在消费者实例工程内跑 phase 集成测试。
