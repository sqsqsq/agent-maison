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

maison 自身不走 feature phase skill 管线；`harness-runner` 在消费者实例工程内跑 phase 集成测试。

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

## Plan 执行（开发仓，非发布件）

本仓用 [`.cursor/plans/`](.cursor/plans/) 记录大型重构/演进蓝本；与 OpenSpec 提案可并存（plan 偏实施清单，OpenSpec 偏规格归档）。

**按用户已定稿 plan 实施时**（含 Cursor Plan 模式「Do NOT edit the plan file」类系统提示）：

| 允许 | 禁止（除非用户明确要求改 plan 本身） |
|------|--------------------------------------|
| 更新 plan frontmatter 中 todo 的 `status`（`completed` / `in_progress` / `cancelled`） | 改写目标、背景、设计、改造点、验收标准等**正文** |
| 用户要求时，在文末追加 **「实施记录」**（日期、验收命令、偏离说明） | 用实施中新发现**替换**原 scope（应新开变更或先与用户确认） |

细则见 Cursor 规则 [`.cursor/rules/plan-execution.mdc`](.cursor/rules/plan-execution.mdc)（`alwaysApply: true`）。

**含义澄清**：「不要改 plan 文件」= **不要改计划内容**；勾选 todo 完成状态**不算**改 plan。

## 回复语言（BLOCKER）

面向用户的自然语言回复默认使用 **中文**。

代码、命令、文件路径、配置键、API 名称、错误码、包名、英文专有名词、日志/diff/终端原文可保留英文；解释、结论、review、计划、状态更新仍用中文。

## 版本演进策略（dev-only）

当前在研版本 SSOT = 根 `package.json` 的 `version`（打包产出 `framework-<semver>.zip`）。`.cursor/plans/*.plan.md` 用 frontmatter `version` 绑定窗口；可选 `deferred_to`（**必须等于** `version`）表示顺延到未来窗口。

### Semver 语义（窗口级）

| 级别 | 典型内容 | 示例 |
|------|----------|------|
| **patch** | 小 bugfix、小型 plan 修补；多项可合并 | `2.1.0` → `2.1.1` |
| **minor** | 中/大型 plan 及后续小演进、bugfix | `2.1.0` → `2.2.0` |
| **major** | 超大型框架重构、架构变更 | `2.1.0` → `3.0.0` |

### 窗口生命周期

1. **打开**：`package.json.version` = N；新建 plan 写 `version: N`。
2. **开发**：多个 plan 可共享 N；未完成且不进本版发布 → `version` + `deferred_to` 置未来目标（如 `2.2.0`），立即移出当前窗口。
3. **发布**：`npm run release:check-plans`（`--release`）→ `npm run release:changelog` → `cd harness && npm test` → `npm run release:verify` → `npm run release:pack`。
4. **归档**：撰写 `RELEASE-NOTES-vN.md`（消费者向）。
5. **切换**：`npm run release:version -- bump --patch|--minor|--major`（先过 release 门禁，再改 `package.json.version`）。

### 文档分工

| 文档 | 受众 | 说明 |
|------|------|------|
| `RELEASE-NOTES-vN.md` | 消费者 | 人工撰写；`MIGRATION.md` 所称「framework 的 CHANGELOG / 发布说明」指此类 |
| `MIGRATION.md` | 消费者（发布件） | 破坏性变更与迁移步骤 |
| `MAINTAINER-CHANGELOG.md` | 维护者（dev-only） | 由 plan 自动生成，速查与 RELEASE-NOTES 草稿来源 |

### 命令

| 命令 | 说明 |
|------|------|
| `node scripts/check-plan-version.mjs` | 开发期轻量校验（默认模式） |
| `npm run release:check-plans` | 发布门禁（`--release`） |
| `npm run release:changelog` | 生成 `MAINTAINER-CHANGELOG.md` |
| `npm run release:changelog -- --from A --to B` | 两版本间 plan 变更摘要 |
| `npm run release:version -- status` | 当前窗口与 plan 统计 |
| `npm run release:version -- bump --patch` | 推进 patch（`--minor` / `--major` 同理） |

legacy 历史 plan（**有 frontmatter**、todos 非空且全 completed/cancelled、**且无** `version`/`deferred_to`）列入 `scripts/plan-version-legacy-allowlist.json`。无 frontmatter 的史前 plan 列入 `scripts/plan-version-pre-frontmatter-allowlist.json`（显式登记，避免空 todos 误判）。已打版本或顺延的 plan **不得**在 legacy allowlist 中。在研 plan 数量以脚本扫描为准，不写死。
