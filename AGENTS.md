# AGENTS.md — AgentMaison 开发指令

> 品牌：**AgentMaison**；消费者 submodule / zip 解压路径仍为 **framework/**。

## 目录分层（BLOCKER）

**发布内容**：`skills/` `specs/` `harness/` `profiles/` `agents/` `workflows/` `templates/` `docs/`、`README.md`、`MIGRATION.md`、根 `package.json`（经 sanitize 后）

**开发工具（不进发布件）**：`.cursor/` `.claude/` `.codex/` `openspec/`、根 `scripts/`、`AGENTS.md`、`RELEASE-NOTES-v*.md`、`.gitignore`、`.npmignore`

**排除规则 SSOT**：[`scripts/release-excludes.json`](scripts/release-excludes.json)

## 总设计原则（BLOCKER）

AgentMaison 的“简单优先”“回退重签”“协作可恢复”三条总原则以 [`docs/overview.md §1.2.1`](docs/overview.md#121-三条总设计原则) 为 SSOT。框架设计、plan 与 review 必须同时遵守；不得另建平行版本、用局部便利绕过权责阶段，或以防篡改之名把可恢复的协作失误升级为常态钥匙/人工门禁。

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

**推荐：单命令前台跑完整链路**（typecheck 只跑一次、zip 只打一次、失败不留残留产物）：

```bash
npm install              # 根目录，拉取 archiver / extract-zip
npm run release:all      # check-plans → typecheck → test:unit/fixtures → pack(staging) → verify(--zip) → promote 到 dist/
```

> ⚠️ 请**前台**跑 `release:all`（约 2–3 分钟）；勿丢后台再粗粒度轮询——轮询会把体感放大到十几分钟。任一步失败即中止、不产出 dist 产物。

分步命令（调试/单跑时用）：

```bash
npm run release:verify   # 规则 + 临时 zip 断言（无参=自 pack；--skip-typecheck 跳重复 typecheck；--zip <path> --manifest <path> 校验已 pack 产物）
npm run release:pack     # 产出 dist/framework-<semver>.zip
```

staging 时会对 zip 内 `package.json` **sanitize**：移除 `release:*` scripts 与根级 `devDependencies`。

## 开发验收（BLOCKER）

改动发布内容后：`cd harness && npm test` 必须全 PASS。

maison 自身不走 feature phase skill 管线；`harness-runner` 在消费者实例工程内跑 phase 集成测试。

**依赖安装契约**：standalone 开发在仓根 `npm run harness:install` 或 `cd harness && npm install`；consumer 仅在 `cd framework/harness && npm install`，禁止在宿主工程根安装 framework runtime。

**场外状态红线（plan b7e4d2a9）**：`~/.maison/goal-checkpoints` 是活跃/可恢复 run 的临时恢复区、不是档案库——新增任何场外状态类型须先证明「in-repo 产物 + 签名/哈希绑定」做不到，默认不允许（路径入口：pass-snapshot.ts `goalTrustRootDir()` / goal-runner.ts `visionTrustDir()`）。

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

**待办唯一真源（BLOCKER）**：在窗 plan 的未完成待办必须登记在 frontmatter `todos:`；正文不得使用未完成的 `- [ ]` 承载待办。历史 `- [x]` 可保留但不作为机器状态；重新打开任务必须先在 frontmatter 登记。

## 父目标对齐声明（复杂能力总纲，机器校验）

总纲：[`.cursor/goals/复杂能力建设目标_能力架构蓝图到部件演进与变更单元闭环_75411223.goal.md`](.cursor/goals/复杂能力建设目标_能力架构蓝图到部件演进与变更单元闭环_75411223.goal.md)

声称服务总纲的 plan 按总纲 §12 携带父目标对齐声明（`parent_goal` / `advances` / `relation` / `layer` 等）。该声明已并入现有 `check-plan-version` 扫描器：

- 运行 `node scripts/check-plan-version.mjs` 做默认模式校验；发布门禁运行 `npm run release:check-plans`（`--release`）。两种模式均校验父目标声明；
- 机器声明必须位于 frontmatter，正文提及不构成声明；声明了 `parent_goal` 即要求八字段齐全，数组字段支持显式行内 `[]` 或非空 block-list，块文本按实际缩进正文判空；
- `parent_goal` 指向的 goal 文件必须按 frontmatter `id` 唯一匹配；`advances` 目标 id 只取该 goal §0.1 目标表首列；枚举、格式、`parallel_authority_added: false` 均由扫描器 fail-closed 校验；
- 校验位于 future/deferred 与 legacy allowlist 提前返回之前，顺延或 allowlist plan 的非法声明不得假绿；
- 未声明 `parent_goal` 的 plan 跳过该校验，不新增告警，不强制所有 plan 挂靠总纲；
- 完整字段契约与失败语义见 [OpenSpec capability spec](openspec/specs/complex-capability-meta-model/spec.md)。


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

### Release branch 并行窗口

当前版本因宿主回归或发布验收尚未闭环、但已形成可提交的稳定切点时，可以显式切出
release branch，让主干提前进入下一开发窗口；不得靠未提交工作区或隐藏状态完成交接：

1. release branch 必须从已提交的 cutoff 创建，保留版本 `N`，并成为 `N` 的 plan/OpenSpec、
   回归、发布说明、打包与 tag 唯一责任分支；
2. main 中仍属 `N` 的未完成 plan todo 必须按事实 `completed/cancelled`；责任转交使用
   `cancelled` 并在原 todo 写明 release branch，取消只表示 main 不再拥有任务，不代表验收完成；
3. main 通过既有 `release:version -- bump` 进入 `N+1`，不新增窗口 manifest 或平行版本真源；
4. `N` 的通用修复以 `git cherry-pick -x` 逐提交前向传播到 main，禁止整体 merge release
   branch 把旧 `package.json`、plan 状态和发布专用改动带回；规范归档等需保留的开发资产单独提交、
   单独前向传播；
5. `N+1` 的正式发布仍须晚于 `N`，且各分支分别通过自身版本的既有发布门禁。

### 窗口生命周期

1. **打开**：`package.json.version` = N；新建 plan 写 `version: N`。
2. **开发**：多个 plan 可共享 N；未完成且不进本版发布 → `version` + `deferred_to` 置未来目标（如 `2.2.0`），立即移出当前窗口。
3. **发布**：`npm run release:changelog`（生成维护者 changelog）后跑 `npm run release:all`（前台，内部串联 check-plans→typecheck→test→pack→verify→promote，见「发版打包」）。
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
