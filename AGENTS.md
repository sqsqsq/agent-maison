# AGENTS.md — AgentMaison 开发指令

> 品牌：**AgentMaison**；消费者 submodule / zip 解压路径仍为 **framework/**。

## 目录分层（BLOCKER）

**发布内容**：`skills/` `specs/` `harness/` `profiles/` `agents/` `workflows/` `templates/` `docs/`、`README.md`、`MIGRATION.md`、根 `package.json`（经 sanitize 后）

**开发工具（不进发布件）**：`.cursor/` `.claude/` `.codex/` `openspec/`、根 `scripts/`、`AGENTS.md`、`RELEASE-NOTES-v*.md`、`.gitignore`、`.npmignore`

**排除规则 SSOT**：[`scripts/release-excludes.json`](scripts/release-excludes.json)

## 行尾（LF，BLOCKER）

文本文件统一 **LF**（与历史 framework 发布件一致）。SSOT：根 [`.gitattributes`](.gitattributes) + [`.editorconfig`](.editorconfig)。

克隆或拉取后在本仓执行一次（仅影响本仓库 local config）：

```bash
git config --local core.autocrlf false
git config --local core.eol lf
```

若工作区行尾与索引不一致（例如从 Windows `autocrlf=true` 环境迁入），一次性归一化：

```bash
git config --local core.autocrlf false
git config --local core.eol lf
node scripts/normalize-repo-eol.mjs
git add --renormalize .
git status   # 确认 diff 仅为 CRLF→LF 时可提交
```

发版打包脚本仍会强制 staging 文本为 LF（`release:verify` 含 LF 断言），与上述策略双保险。

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

## OpenSpec（框架自身演进）

`openspec/` 管理 AgentMaison **自身**变更提案与行为说明（非运行时 SSOT，非消费者工程）。

**CLI（BLOCKER）**：使用仓内固定版本，勿依赖全局 `openspec`：

```bash
npm install                    # 安装 @fission-ai/openspec@1.3.1（devDependency）
npm run openspec -- --help
npm run openspec:validate      # openspec validate --all --strict
```

Cursor 命令：`/opsx-propose` `/opsx-apply` `/opsx-archive` `/opsx-explore`（连字符，与 `.cursor/commands/opsx-*.md` 一致）。
