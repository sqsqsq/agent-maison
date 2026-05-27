# AGENTS.md — AgentMaison 开发指令

> 品牌：**AgentMaison**；消费者 submodule / zip 解压路径仍为 **framework/**。

## 目录分层（BLOCKER）

**发布内容**：`skills/` `specs/` `harness/` `profiles/` `agents/` `workflows/` `templates/` `docs/`、`README.md`、`MIGRATION.md`、根 `package.json`（经 sanitize 后）

**开发工具（不进发布件）**：`.cursor/` `.claude/` `.codex/` `openspec/`、根 `scripts/`、`AGENTS.md`、`RELEASE-NOTES-v*.md`、`.gitignore`、`.npmignore`

**排除规则 SSOT**：[`scripts/release-excludes.json`](scripts/release-excludes.json)

## 发版打包

```bash
npm install              # 根目录，拉取 archiver / extract-zip
npm run release:verify   # 规则 + 临时 zip 断言
npm run release:pack     # 产出 dist/framework-<semver>.zip
```

staging 时会对 zip 内 `package.json` **sanitize**：移除 `release:*` scripts 与根级 `devDependencies`。

## 开发验收（BLOCKER）

改动发布内容后：`cd harness && npm test` 必须全 PASS。

maison 自身不走 Skill 0–6；`harness-runner` 在消费者实例工程内跑 phase 集成测试。

**依赖安装契约**：standalone 开发在仓根 `npm run harness:install` 或 `cd harness && npm install`；consumer 仅在 `cd framework/harness && npm install`，禁止在宿主工程根安装 framework runtime。

发版前见 [`docs/operations/release-checklist.md`](docs/operations/release-checklist.md)。
