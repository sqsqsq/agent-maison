# Framework Agent Adapters

本目录托管 **可插拔的 AI coding agent 适配层**。每个 adapter 是一个独立的插件，告诉
初始化 Skill "如何把 framework 的 skill / 规则 / 入口文件以当前 agent 的方式暴露出来"。

## 目录约定

```
framework/agents/
├── adapter-schema.yaml          ← 每个 adapter.yaml 必须遵守的协议定义
├── README.md                    ← 本文件
├── generic/                     ← 通用 adapter（只产 AGENTS.md）
│   ├── adapter.yaml
│   └── templates/
├── claude/                      ← Claude Code adapter（CLAUDE.md + .claude/commands/ + .claude/agents/ + .claude/settings.json + .claude/hooks/）
│   ├── adapter.yaml
│   └── templates/
│       ├── commands/            ← 每个 slash 一个 *.md 模板
│       ├── agents/              ← 子 agent 模板（如 phase-executor.md）
│       ├── settings.json        ← 客户端配置（注册 Stop / PreToolUse hook）
│       └── hooks/               ← Claude Code hook 脚本（Layer 3 物理拦截）
├── cursor/                      ← Cursor adapter（AGENTS.md + .cursor/skills/ 跳板 + .cursor/rules/）
│   ├── adapter.yaml
│   └── templates/
└── codex/                       ← Codex CLI adapter（AGENTS.md + .codex/skills/ 跳板 + .codex/agents/ + goal_capability）
    ├── adapter.yaml
    └── templates/
├── chrys/                       ← Chrys agent adapter（AGENTS.md + .agents/ bundle + chrys run headless）
│   ├── adapter.yaml
│   └── templates/
├── opencode/                    ← OpenCode adapter（AGENTS.md 共享 + .opencode/ bundle/plugins + opencode run headless）
│   ├── adapter.yaml
│   └── templates/
├── codeagent/                   ← CodeAgent adapter（Claude Code 内核 fork；AGENTS.md + .cac/ 产物 + codeagentcli headless）
│   ├── adapter.yaml
│   └── templates/               ← 仅 settings.json 与 commands/ 自有；agents/hooks/rules/goal-condition 跨目录引用 ../claude/templates/
└── deepseek-harness/            ← DeepSeek Harness（AGENTS.md + .dsh/skills；dsh headless 默认模型）
    ├── adapter.yaml
    └── headless-patch.yaml ← 只读调用级权限/存储认证补丁；所有入口模板跨目录复用
```

各 adapter 可选声明 `goal_capability`（goal-runner 全链路；check-init 仅 WARN，runner preflight BLOCKER）。见 `docs/operations/goal-mode-runbook.md`。

## Goal capability 路由

`goal_capability` 同时描述外部 runner 与会话内调和能力。root 字段：

| 字段 | 含义 |
|---|---|
| `level` | 既有 native/external/hook 能力级别 |
| `in_session_reconcile` | 既有原生会话调和能力；不是共同 next/report 的准入门槛 |
| `phase_context_isolation` | 历史字段名；普通作者始终使用专用单元上下文，缺原生续接则按当前事实重建并披露，不授权主会话代施工 |
| `supports_resume` | 模型 CLI 原生运输恢复能力；不控制框架交接续作 |
| `handoff` | `none` / `to_detached` / `bidirectional` |

约束：

- 可运行框架命令且配置有效的会话统一进入同一 runtime 的 `--next / --report-result`；
- `handoff!=none` 必须声明 `supports_resume=true`；
- 未声明的新字段按保守 `false` / `none` 处理，不从 CLI 存在性推断；
- 作者始终使用该工作单元专用上下文；原生续接不可用时按当前事实重建并披露，不能回主会话代施工，独核仍独立；
- 无人值守仍须通过 `external_runner.unattended` preflight。

Codex、Claude 与 DeepSeek Harness 声明原生 resume、阶段隔离和双向 handoff。八种 adapter 的可命令会话都走同一 `next/report` 请求与结果。用户界面只显示“有人在场 / 无人值守”。

八个 adapter 先消费统一前门的同源外框和用户覆盖：特别简单走直接能力，小型经同协议短蓝图和原 request 完成适用工作，无 CU/独立设计质询/独立评审文件；中型/复杂及已有 CU 的共同入口适用于原始请求初始设计：同一 runtime 派作者、真实独立质询、检查与 CU 准入，再沿 P2 接正常 CU；不先要求主会话完成设计，不强依赖原生 Goal、`in_session_reconcile` 或模型 CLI 原生 resume。原生隔离/续接不可用须重建专用作者上下文并披露，不授权主会话施工；独立质询/verifier仍必需真实独立。后台仍以实际 headless/生存能力与原握手为准，缺能力不得声称已运行；本说明不扩大 adapter YAML 已声明能力。需求/可信授权/显式用户截止从原请求继承，activity如实累计，模板不自选 CU/phase 或把调用退出当任务完成。全部适用CU完成不代签原部件终点；同一root持续必要工作，消费原writer正式closure及真实装配/独核证据。

schema、组合约束与 fallback 以 [`adapter-schema.yaml`](./adapter-schema.yaml) 和 [`goal-adapter-capability.ts`](../harness/scripts/utils/goal-adapter-capability.ts) 为准。

无人值守以真实用户原话或既有确切运输选择为依据。后台握手确认前，观察原请求和进程绑定。确认后台无法启动，且同 adapter 能在当前会话运行已签专用执行命令时，按回执接续会话并维持其存活。原生可执行器、准确模型身份或必要权限缺失时，保留原 run 和签发，待同 adapter 的可用环境接回。各客户端的实际验证关注以下原件。

| Adapter | 核对的入口与原件 |
| --- | --- |
| DeepSeek Harness | 精确 `DSH_SESSION_ID` 的真实用户消息和对应 profile。Windows 一次性 `headless` 前台会回收它启动的进程。回执要求保持前台时，程序仍执行原签发，按 `wait_command` 观察。使用具备持久运输的前台时，另核对退出后活性与交回。 |
| Claude Code | 已配置存储内的准确 Claude 用户消息。用 `claude -p` 核对原生身份和受理，复用原 SID 时使用准确 `--resume`。 |
| Codex | 精确线程索引下的用户 turn。用 `codex exec` 核对绑定和原生终态，测试命令宿主实际给出的后台生存边界。 |
| OpenCode | 已物化前台 hook 或准确会话中的用户原件。用 `opencode run` 核对原生绑定和交回，原生续接缺失时由专用执行器重建。 |
| Cursor | 当前读者能读历史包络。运输选择需有可核实的用户来源或明确启动选择，并在实际 Cursor 环境检查 `cursor-agent` 可用性。 |
| CodeAgent | 核对 `.cac` 的真实原请求和 `codeagentcli`。原生续接缺失时按当前证据重建专用上下文。 |
| Chrys | 可信入口传递运输选择，检查实际 `chrys run`、专用任务原件及后台握手。 |
| generic | 由实际接入方提供可信用户选择及可执行 adapter 配置。按所接入的命令、原签原件和握手确认能力。 |

协议回放检查请求、进程时段和交回。实际客户端的回放记录还须核对用户来源、原生进程、受理与正式终点。

## 关键设计

1. **adapter 不承担任何 skill 逻辑**——skill 本身是纯 Markdown，adapter 只负责
   把 skill 入口按该 agent 的约定暴露出来（slash / 跳板 / rules）。
2. **adapter 不修改 framework 自身**——它只产出**实例工程根**的文件。
3. **双 adapter 模型（编排化重构）**：
   - **`materialized_adapters: string[]`**（项目级，写入 `framework.config.json`）：本仓库要生成/维护哪些 adapter 产物。
   - **`agent_adapter`**（个人级，`framework.local.json`）：开发者当前使用的 adapter；由阶段入口 **`check-personal-setup.ts --json --ensure`** 内联写入，**不在项目 init 中选择**。
   - 物化时 render-env 用**正在物化的 adapter**，不把 personal active adapter 写进提交产物。
4. **模板共享优先**：各 adapter 的 `agent_entry_file` 共用 `framework/templates/AGENTS.md.template`。

## Skill 跳板：禁止「双源分叉」（适用生成跳板的 adapter）

部分 adapter 会在实例根生成**极短**的 `SKILL.md` 跳板，仅承载 frontmatter 与 **一条**
跳转到 `framework/skills/<n>/SKILL.md` 的链接。

- **禁止**在跳板里追加业务条款、选型表或多个次级文档链接；否则 agent 可能只读跳板、漏掉正文中的 BLOCKER、harness 与 verifier 要求。
- **正确落点**：扩写写到 `framework/skills/<n>/` 正文及同目录 `prompts/`、`templates/`、`reference/`；需要改跳板默认形态时改 **本目录下对应 adapter 子目录** 的 `templates/`，再经 Framework 初始化（framework-init）render 下发，**勿**仅在实例跳板内手补。
- Cursor 侧的会话级总规则与本条呼应：见 `cursor/templates/rules/framework.mdc`（Skill 路由第三条）。

**全 adapter 升级清理**：UPDATE `framework-init` 的 `cleanup-deprecated` 检查发布件中全部 adapter，包含已退出 `materialized_adapters` 的历史残留。旧 skill/command 名（编号、`prd-design` / `requirement-design`、`goal-orchestration` 等）按各 adapter 的物化目录声明清理，generic 跟随 `paths.agent_bundle_root`。专属退役文件登记在 `adapter.yaml` 的 `deprecated_artifacts`；退役 hook 同时登记 `hook_configs`，先移除旧注册再删除脚本，保留宿主其他 hook/配置。所有修改先备份到 `.framework-backup/<timestamp>/`，S3 run-log 分别记录删除数与 hook 配置更新数。配置仍含脚本引用时保留脚本并记 blocked（任务不因此 failed）；引用全部解析到工程外的绝对路径时不阻断删除本地副本，配置逐字不变并记 warning 待人工核对；非法配置/清理抛错记 failed。三类诊断都进 run-log，其余 adapter/旧跳板一律继续处理。CREATE 或跳过清理任务不执行此操作。

**维护约定**：删除或迁移已发布的模板时，必须同步登记旧产物路径或共享旧 skill/command 名，并验证升级清理；仅删除发布件模板不会自动删除宿主文件。无专属退役项的 adapter 可省略 `deprecated_artifacts`，仍支持共享清理机制。共享目录内仍被其他 adapter 使用的现行产物、未知宿主自有文件不作整目录清空；“无 deprecated 需清理”仅表示已登记范围没有命中，不代表任意历史误生成文件均不存在。

## Init Skill：编排流（framework-init · S1–S4）

项目级 **`/framework-init`** 不再逐步 Q1=y；流程为：

1. **S1** — `init-orchestrate.ts --scope project` 只读产出 `InitTaskPlan`
2. **S2** — `init.task_plan` + `init.materialized_adapters` + `init.task_decision`（手动）
3. **S3** — `--execute --decision-file` + `context.json`（OS 临时目录绝对路径；含 `configWritePayload`）→ preflight + `executeInitPlan`
4. **S4** — `buildRunSummary(run-log)`

个人 setup 无独立 slash：各阶段入口 `--ensure` 写 `framework.local.json`（多 adapter 时 `setup.adapter`）；feature/catalog/glossary phase 前须完成（harness-runner 在 `fallback` 时阻断）。

## Init Skill：`adapter.yaml` 产物速查（与物化任务对齐）

| `adapter_name`（目录名） | 入口文件（`agent_entry_file.target_path`） | 典型额外产物 |
|--------------------------|--------------------------------------------|--------------|
| `generic` | `AGENTS.md` | `{paths.agent_bundle_root}/skills/` + `{paths.agent_bundle_root}/rules/`（根目录名由用户指定，如 `.agents`） |
| `claude` | `CLAUDE.md` | `.claude/commands/*.md`、`.claude/agents/phase-executor.md`、`.claude/settings.json`、`.claude/hooks/*.mjs` |
| `cursor` | `AGENTS.md` | `.cursor/skills/<skill>/SKILL.md`（16 份内置跳板）、`.cursor/rules/framework.mdc` |
| `codex` | `AGENTS.md` | `.codex/skills/<skill>/SKILL.md`（bridge 跳板）、`.codex/rules/interaction-renderer.md` |
| `chrys` | `AGENTS.md` | `.agents/skills/<skill>/SKILL.md`（bridge 跳板）、`.agents/rules/interaction-renderer.md` |
| `opencode` | `AGENTS.md` | `.opencode/skill/<skill>/SKILL.md`（自有原生目录；bridge 跳板；技能自动注册为 slash）、`.opencode/rules/interaction-renderer.md`、`.opencode/plugins/maison-native-intake.js`（普通前台的来源/写前接线） |
| `codeagent` | `AGENTS.md` | `.cac/commands/*.md`（自有副本，身份行=codeagent）、`.cac/agents/phase-executor.md`、`.cac/settings.json`（变量 `${CODEAGENT3_PROJECT_DIR}`）、`.cac/hooks/*.mjs`、`.cac/rules/*.md`（与 claude 共享模板） |

> **常见误写**：claude adapter **无** `.claude/commands/skills/` 目录；slash 在 `.claude/commands/`，Skill 正文 SSOT 在 `framework/skills/`。`.cursor/skills/` 式 skill 跳板是 **cursor** 专属。

## Init Skill：`adapter.yaml` 字段处理示例（以 claude adapter 为代表）

落地方式：**从选中 adapter 的 `templates/` 拷贝到实例根**，逐字段语义见 `adapter-schema.yaml`。下表仅用 **claude** 示意「模板相对路径 → 实例根路径」的常见形态；其它 adapter 以各自 `adapter.yaml` 为准。

| adapter.yaml 字段 | 处理动作 | 示例（claude） |
|---|---|---|
| `agent_entry_file` | **占位符替换**后写入 `target_path` | `templates/AGENTS.md.template` → `CLAUDE.md` |
| `commands` / `skill_bridge` / `rules` / `commands.subagents` | **整目录原样复制** `template_dir` → `target_dir` | `templates/commands/*.md` → `.claude/commands/*.md` |
| `settings_file`（可选）| **原样复制**（模板内仅允许使用该客户端定义的 `${…}` 变量） | `templates/settings.json` → `.claude/settings.json` |
| `hooks`（可选）| **整目录原样复制** | `templates/hooks/*.mjs` → `.claude/hooks/*.mjs` |

S1 探测任务表（`materialize-adapter-file:*` 驱动）必须 **逐文件** 覆盖上表涉及到的全部 `target_path` / `target_dir`（含 `settings_file` / `hooks`）；对 **claude** adapter 而言即 `.claude/commands/**`、`.claude/agents/**`、`.claude/settings.json`、`.claude/hooks/**` 等——**宁可对照本 adapter 的 `adapter.yaml` 列全路径，也不要凭印象漏扫**（planner 任务 `materialize-adapter-file:*` / `materialize-adapter:<name>` 驱动执行）。

## `materialized_adapters` 多选建议

| 团队情况 | 建议 `materialized_adapters` |
|----------|------------------------------|
| 全员 Claude Code | `["claude"]` |
| 全员 Cursor | `["cursor"]` |
| 混合 IDE | `["claude","cursor"]` |
| Chrys 实例 | `["chrys"]`（与 generic 默认 `.agents` bridge 字节一致、可幂等共存） |
| OpenCode 实例 | `["opencode"]`（自有 `.opencode/skill` bundle，AGENTS.md 共享；像 cursor 各用各目录） |
| CodeAgent 实例 | `["codeagent"]`（`.cac/` 产物；Claude Code 内核，可与 claude 共存各写各目录） |
| 其它自定义 bundle | `["generic"]`（默认 `.agents`/bridge 零配置；仅非标 bundle 根须显式配置 `paths.agent_bundle_root`） |

切换/增删 adapter：UPDATE init 更新 `materialized_adapters` 并重跑物化；**旧 adapter 目录可能残留**，列给用户手工处理，不自动 `rm -rf`。

实例扩展另走 `/extension materialize`：它只读项目级 `materialized_adapters[]`，为每个已物化 adapter
刷新 extension Skill bridge 与 AGENTS/CLAUDE 扩展段；不读个人 active adapter。

## Adapter 选定建议（personal setup · framework-initb）

**项目 init 不再选 active adapter。** 个人 setup（`setup.adapter`）只能从 **`materialized_adapters` 已物化** 的目录名中选；未物化则引导回项目 init。

| 用户环境线索 | setup 建议 |
|--------------|------------|
| 日常用 Claude Code slash | personal `claude` |
| 日常用 Cursor skills/rules | personal `cursor` |
| 日常用 Chrys headless | personal `chrys` |
| 日常用 OpenCode CLI | personal `opencode` |
| 日常用 CodeAgent（.cac / codeagentcli） | personal `codeagent` |
| 日常用 DeepSeek Harness（dsh） | personal `deepseek-harness` |
| 使用 `.agents` / `.codex` bundle 加载（其它自定义 agent） | personal `generic` |

## Claude-kernel 确认 Widget（interaction-renderer）

- **工具名**：`AskUserQuestion`（Claude-kernel 家族——claude / codeagent，同名同签名，codeagent 侧 2026-07-29 宿主实证真实渲染；见 `.claude|.cac/rules/interaction-renderer.md`）。
- **会话规则**：`.claude/rules/interaction-renderer.md` 与 `.cac/rules/interaction-renderer.md`（同一份共享模板，各自 adapter `rules` 段下发，与入口 Markdown 同优先级）——**BLOCKER**：所有用户选择须 AskUserQuestion + portable 脚注；选项文案 SSOT 在 [confirmation-registry.yaml](../skills/reference/confirmation-registry.yaml)。
- **slash 强约束**：各 `.claude/commands/*.md` 与 `.cac/commands/*.md` 含一句 AskUserQuestion BLOCKER，链 interaction-renderer。
- **init BLOCKER**：framework-init S2 — `init.task_plan` / `init.materialized_adapters` / `init.task_decision`；personal — framework-initb `setup.*`。
- **实例下发**：vendor 升级后用户自行 `/framework-init` UPDATE；check-init UPDATE 会自动 `backup_delete` 废弃的 `confirmation-ux.md` / `widget-options/`。
- **Cursor 对称**：`.cursor/rules/interaction-renderer.mdc`（AskQuestion）。

## 内部 agent（Chrys / OpenCode / Codemate 等）

**chrys** 与 **opencode** 为独立 adapter（`structured_widget: unsupported`，portable 编号菜单）。实例分别选 personal `chrys` / `opencode`。**chrys** 与 generic 默认 `.agents` bridge bundle 字节一致、可幂等共存；**opencode** 用自有原生 `.opencode/skill` bundle（AGENTS.md 仍共享，像 cursor 各用各 skill 目录、互不冲突）。差异仅在 headless 运行器与 skill 落盘目录。**codemate** 等尚无专用 adapter 时仍可用 **`generic`**。

- `adapter.yaml` → `user_confirmation.structured_widget: unsupported`
- 确认交互只展示 **portable 编号菜单**（见 `.agents/rules/interaction-renderer.md` 与 [user-confirmation-ux.md](../skills/reference/user-confirmation-ux.md)）
- 禁止假设结构化 widget 可用
- **opencode 额外说明**：maison opencode adapter 物化到其**原生主目录** `.opencode/skill/<id>/SKILL.md` + `.opencode/rules/`（`AGENTS.md` 共享，技能自动注册为 slash 命令）。选 `.opencode/skill` 而非 `.agents/skills` 的原因：`.opencode/skill` 是 opencode 长期稳定的主 skill 目录（兼容当前版本及传统原生目录）；`.agents` 外部 skill 发现是较新特性，旧版 `opencode-ai` 读不到。**`.opencode/rules/*` 不被 opencode 自动加载**（`*.mdc` 为 Cursor 格式，对 opencode 惰性），是「引用可达」被动文档（同 chrys `.agents/rules`），非有效规则入口；maison **不**为此创建/覆盖用户的 `.opencode/opencode.json`。与 claude/generic/chrys 同时物化时各写各目录（`.opencode/skill` vs `.claude/skills` vs `.agents/skills`），如扫到同名 skill 仅 logWarning（无害）。

普通 OpenCode 前台从 `.opencode/plugins/maison-native-intake.js` 加载本次 shell 的来源桥及已覆盖编辑工具的共享写前守卫；`--pure` 会禁用外部插件，不具备这条自动来源/写前路径。PTY 若原生只给 cwd，桥不伪造 session/call ID，仍须沿已有原请求引用或如实保留来源缺口。

## DeepSeek Harness

DeepSeek Harness 使用 `deepseek-harness` adapter、自有 `.dsh/skills` 和共享 `AGENTS.md`；
`.dsh/rules` 是按需引用文档。实例扩展技能名须为小写 kebab-case
（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）；大写/下划线可能被 DSH 告警后忽略，Maison 不自动改名。
默认模型、环境凭据、权限覆盖和实测范围见
[Goal runbook · DeepSeek Harness](../docs/operations/goal-mode-runbook.md#deepseek-harnessdsh)。
独立视觉使用单独的只读 patch 与公共模型绑定；开发全权限和视觉只读的接线、锁定版本实测及限制见同节。

## 工程指纹与 adapter 推测（承接 scan-project）

以下为**只读启发**，不能替代用户对 `adapter_name` 的显式选定：

- 存在 `.claude/commands/` → 用户可能期望 **claude** adapter。
- 存在 `.cursor/skills/` → 可能期望 **cursor** adapter。
- 仅有某一种入口 Markdown（由各 adapter 定义的 `agent_entry_file.target_path`）→ 记下当前文件名，切换 adapter 时避免静默覆盖。

## 新增 adapter 步骤

1. 在本目录下新建 `<adapter_name>/` 子目录，按 `adapter-schema.yaml` 创建 `adapter.yaml` 与 `templates/`。
2. 在 [confirmation-registry.yaml](../skills/reference/confirmation-registry.yaml) `init.materialized_adapters.options` 补 **`value` / `label` / `portable`**（文案 SSOT）。
3. 跑 `cd harness && npm test`；候选将经 S1 **`InitTaskPlan.adapter_catalog[]`** 自动进入 init 菜单（磁盘成员 + registry join）；锚点门禁拦菜单口径段硬编码遗漏。

> **候选 vs 参考**：带 `<!-- adapter-candidates:start/end -->` 的 Skill/ucux 段为**候选菜单口径**（禁止写死 adapter 名）；本文件「产物速查」「多选建议」「第一版 adapter 列表」等为**参考表**（保留列全、非候选源）。

4. 跑 `framework/skills/project/framework-init` UPDATE 自检物化任务覆盖新 adapter 产物路径。
5. 更新本文件「第一版 adapter 列表」及 `framework/README.md` 总览句（若有）。

## 占位符

所有模板允许使用 `{{PROJECT_NAME}}` / `{{AGENT_ADAPTER}}` / `{{ARCHITECTURE_SUMMARY}}`
等占位符（完整清单见 `adapter-schema.yaml` 的 `placeholders` 段），由初始化 Skill
在生成阶段根据 `framework.config.json` 和用户交互答复填充。

## 第一版 adapter 列表

| adapter | 入口文件 | slash | skill 跳板 | rules | settings_file | hooks |
|---------|---------|-------|-----------|-------|---------------|-------|
| generic | AGENTS.md | — | `{agent_bundle_root}/skills/*`（bridge 薄跳板；inline 已废弃） | `{agent_bundle_root}/rules/*.mdc` | — | — |
| claude  | CLAUDE.md | `.claude/commands/*.md` + `.claude/agents/phase-executor.md` | — | `.claude/rules/*.md` | `.claude/settings.json` | `.claude/hooks/*.mjs` |
| cursor  | AGENTS.md | — | `.cursor/skills/<skill>/SKILL.md`（模板 SSOT：`shared/agent-bundle/templates/skills-bridge`） | `.cursor/rules/*.mdc` | — | — |
| codex   | AGENTS.md | — | `.codex/skills/<skill>/SKILL.md`（bridge 跳板） | `.codex/rules/interaction-renderer.md` | — | `.codex/hooks.json`（结构化 upsert；仅 PreToolUse 编辑守卫） |
| chrys   | AGENTS.md | — | `.agents/skills/<skill>/SKILL.md`（bridge 跳板） | `.agents/rules/interaction-renderer.md` | — | — |
| opencode | AGENTS.md | —（技能自动注册 slash） | `.opencode/skill/<skill>/SKILL.md`（自有原生目录；bridge 跳板） | `.opencode/rules/interaction-renderer.md` | — | `.opencode/plugins/maison-native-intake.js`（普通前台） |
| codeagent | AGENTS.md | `.cac/commands/*.md`（自有副本）+ `.cac/agents/phase-executor.md`（共享模板） | — | `.cac/rules/*.md`（共享模板） | `.cac/settings.json` | `.cac/hooks/*.mjs`（共享模板） |
| deepseek-harness | AGENTS.md | —（原生技能入口） | `.dsh/skills/<skill>/SKILL.md`（共享薄跳板） | `.dsh/rules/`（按需引用） | — | — |

### 前门规则与真实客户端证据

所有 adapter 的根入口/常驻规则/Skill 跳板必须引用 [project-entry.md](../docs/operations/project-entry.md) 的唯一规则，不各维护档位表；这是统一入口的规则要求，不代表各客户端的新原生来源读取链已全覆盖。原 compile/request 从可用原生环境自动取得同一 session/project 与真实 user 来源；已有请求沿返回的 `session_ref` 复用，需显式交接时把该引用原样传给 `--session-ref`，不要求用户在可自动取得时手配。引用可以是原生 JSONL 原件加消息 ID（相应格式可用 `line:n`）、DSH 压缩原件加真实 `user/message.data.id`，或 OpenCode 原生 SQLite/session/user 引用；不能以 assistant 转述、路径存在或模型自称授权替代原件。普通“继续”不因新增 user 消息重复加载，语义新请求/本请求豁免边界归原入口，不归纯 hook。

自动精确来源现已接 Codex 线程索引、Claude 原生 shell session、DSH_HOME + DSH_SESSION_ID 及 OpenCode 普通前台插件的当次 session/call。先设计、先 CLI 无需先触发编辑 hook；只消费本次来源，不扫描最近会话，不把外层 Codex 标记冒充当前 DSH/OpenCode/Claude。Codex 信号与单一其它有效宿主会话信号（Claude、DSH 或 OpenCode）同时存在时，采用该其它宿主会话；多个非 Codex 宿主信号冲突仍保留 gap，OpenCode PTY 缺少 sessionID/callID 时不回退使用 Codex。DSH 首次取准确原件最后一条已落盘真实 user；原 request/Goal 已有引用后固定沿用，不随追加消息换锚。CodeAgent 仍沿 hook/已有显式引用，待内网回传真实 shell 信号及生产守卫结果；Cursor 仅接已核历史格式，未知原生来源/授权继续降级。

已由原生短例核实的编辑 hook，只在对应工具和场景机械证明同一会话可消费上下文中已加载前门规则，缺失拒绝当前产品写入、补读即恢复；最近压缩明确保留加载事实可复用。实现按既有 RUN_ID/ATTEMPT/ATTEMPT_PHASE/HEADLESS 信号并集识别 Maison 派出作者免重复入口，客户端实际环境以下表为准；仍不免 framework 只读、实际写界和真实完成核验。该信号是合作约定，不声称抵抗任意 Shell 伪造，不增加令牌/身份层。

下表是 **2026-11-11 至 14 隔离原生短例、历史结构及本机合成前台诊断**，不代表正式发布件、业务宿主、设备、完整四档或全能力验收，也不构成效率基准。早期原件保存在开发验证目录 `temp/native-client-probes/` 的 `RESULTS.md`、`A8-PRODUCTION-RESULTS.md`；Codex/CodeAgent 证据与补测包在 `harness/reports/a6-client-validation/`；历史调查在 `harness/reports/adapter-intake-probe/`。本轮实现证据在 `harness/reports/multi-host-intake/` 的 `claude-cli/public-*`、`opencode/frontend-*-evidence.json`、`dsh/live-report.json`、`dsh/live-selfcheck.json` 及定向测试报告。以上均为开发证据、不随发布件；原报告中的权限拒绝、程序失败、未知和后续恢复分别保留，不用最后成功改写首因。旧 hook 原生调用绑定当时源码哈希；本轮从旧验证 worktree 的保留原件取得五个真实调用前缀，以最终生产源再回放 5/5 通过，见 `harness/reports/multi-host-intake/core/legacy-claude-prefix-final-source-replay.json`。该回放不是新的原生调用；下表分别标明本轮实际前台结果。

| 客户端 | 框架实现状态 | 本次原生格式 / CLI 证据 | 未测或降级边界 |
|---|---|---|---|
| Claude Code 2.1.322（旧 hook，claude-sonnet-5-5）；2.1.325（本轮 CLI，claude-sonnet-4-6） | 生产 hook、原生 reader、公共自动 request/Node UT 与无编辑 hook 的 shell 自动 session 来源已接通 | 旧生产 hook 短例实测 Edit 首拒、读后同改动恢复、中途 commit 后继续；作者 RUN_ID/ATTEMPT 等信号免重复入口但 framework 仍拒写。原 request 保留初始 clean 基线及 before→after→final diff，公共 Node UT 1 pass/0 fail/0 skipped，执行/预期来源/对账均 PASS。本轮纯 CLI 不传启动 session-id/session-ref，真实 shell SID、CLI 返回、原件与项目匹配，外层 Codex 标记未误用；先设计和公共 compile 取得同一真实 user/用户小型覆盖，Node 语法实际执行 PASS | 旧 review 因缺独立 review-report 整体 FAIL 保留；本轮 design 的请求边界解释 gap 仍保留，不签完整请求/设计完成。首次权限拒绝和后续恢复分别留原件。旧普通/作者42.281s/24.147s、hook约39–46ms不作效率基准；历史回放不算新原生调用。不代业务宿主、HMOS、设备或新一轮生产 hook 全验 |
| Codex Desktop，header `cli_version=0.167.0-alpha.4.1`，模型 gpt-6.1-sol | 精确线程定位、原生 reader 与生产共享前门/写保护已接通 | 新根真实用户隔离请求首次拒写；真实工具完整读取生产 entry 后，原错误补丁已过前门但因独立 `before` 行发生原生 context 校验 FAIL，原件保留。同请求续作改用准确整行补丁成功，framework 两次均拒写，最终 after/protected。reader 核唯一真实 user、已读入口及成功编辑路径，续作工具转发不新增授权；项目层及1项生产 hook 信任经明确授权的官方接口登记 | 仅验证本隔离守卫及来源读取链；fixture 未物化根 AGENTS/framework.config，全局 Skill 调查不适用，不据此判 hook 失败。未跑 compile/request/UT，未验用户覆盖、hook 耗时或业务宿主。PrimaryRuntime 26.1110.778.0 是 shell 路径组件而非 Desktop 包号。fork/history_base 或只有注入/转发时仍降级，不签完整请求/review PASS，不推定豁免/固定档位 |
| CodeAgent `1.2615.02.03`（内网回传） | `CODEAGENT3_CONFIG_DIR`（默认 `~/.cac`）下 `projects/` reader 复用原解析；生产守卫待验 | 已回传原生观察器 PreToolUse/PostToolUse/Stop 共9事件、Read3/Edit1，与同会话/工具摘要及 BEFORE→AFTER 对应，version/help exit0，来源根由用户确证。固定补测入口 `harness/reports/a6-client-validation/codeagent-production-probe.zip` 已更新并离线自检；新增原生 shell 仅采集匹配的环境键名：按会话/对话标识、定位名及已知家族 PID/PROCESS_ID 等名称匹配，空匹配和缺回执分开 | 观察器未运行 Maison 生产守卫；用户说明采集器7项调整但未提供改后源码，来源仍为采集器自报。新包不导出环境值、值哈希或全量环境，真实内网尚未执行；入口首拒、真实完整 Read、同请求恢复、framework 保护及当前 shell 身份仍待回传，不以离线包自检或最终 AFTER 代签 |
| Cursor CLI 2026.07.23-e383d2b；Desktop 3.15.6 | 历史 role/message.content reader、`line:n` 与有限 wrapper 归一已接入；共享入口与 hook 壳已实现 | Maison 历史四份 JSONL 结构已核，55个 user text part 中54个含 `<user_query>`、13个完整外层包装；仅完整已知外层和唯一 user_query 归一，未知/嵌套包装保原文。session/cwd 仍须原件元数据或真实 hook context；55个真实历史 `line:n` 的回放由测试提供身份，不代表在线会话定位已验；缺工具结果不造成功 Read。既有隔离 CLI 在模型前 Authentication required、exit1 | 用户暂缓在线认证；wrapper 授权/当前在线对应未验，`userControlVerified=false`，历史读取不授豁免或固定档位；守卫如实降级，避免无结果历史永久拒写。父子/压缩、真实生产 hook/作者环境、Write/Delete/StrReplace 对应未在线验；认证缺口不等于产品不支持 |
| OpenCode CLI/TUI 1.18.14，默认 volcengine/glm-5.3-flash | 普通前台项目插件、当次 shell session/call 来源桥、只读 SQLite user/tool reader 与已覆盖编辑工具的共享写前守卫已接通 | 本轮普通非 pure TUI 的原生提交驱动四个合成请求：edit 首拒→真实 read 前门→同改动成功，40→42，framework 拒写且原字节未变；真实 TUI 工具 shell 调用未手填引用，`probe.cjs` 从桥自动派生当前 call→assistant.parentID 对应的 user 引用后，在内部传给公共 API；compile 实际 Node 语法 PASS/特别简单，先设计在产品 read/edit 前取得真实原文/小型。另用同一真实 SID/call 元数据及原件离线回放，公共 `runCompile`/`prepareDesignRequest` 完全省略 `options.sessionRef` 仍同源成功，见 `api-no-session-ref-replay-report.json`；该项不是新前台调用；真实用户豁免+复杂覆盖后未读前门的edit42→43成功。旧CLI read/edit/missing-file及原生 snapshot 精确 before/after 证据保留 | `--pure` 禁插件；原生 PTY 实测只给 cwd、无SID/call，桥不补造ID，外层Codex不冒充。首次fixture漏profiles导致 MODULE_NOT_FOUND/exit1，命令多余句点的权限拒绝及旧权限pattern错误均留原件。design的初始dirty/源码调研/归属/边界gap仍保留，不签设计完成；未验GUI真人、真实压缩、全部工具、四档全自动或业务交付。read展示/通用hunk不是精确前像 |
| DeepSeek Harness（DSH）0.2.2-rc.3，默认 volcengine/deepseek-v4.1-flash | 准确 SID 定位/多帧解码由模型绑定与 v4 user/tool reader 共用；原 compile/request 自动来源已接通，无新增写前 hook | 新隔离 headless 真实工具 shell保留外层Codex两ID，仍以DSH_SESSION_ID/HOME精确核原件/项目/user；native read→产品编辑前公共compile无ref实际PASS→native edit40→42→read→公共compile无ref实际PASS，两次同源、同user、特别简单。call/result seq+ID及job exit均核实；read完整行窗与非精确字节分开。首次最后真实user、已有引用追加后固定、四档及用户覆盖的正反例有定向测试 | 无request/message/turn环境ID；最后真实user是首次约定，不声称一般并发/steer当前call唯一对应。暂未flush的结果保留gap并沿原源重读，不补造成功。旧sandbox/脚本内部exit1/恢复入口exit1及本轮探针漏模型pin的启动失败均留原件。本次持久化read/edit少末尾LF，不能作精确前像；内部before/after不等于已持久化。仅headless实跑，web/desktop、真实并发/压缩/子代理和全部工具未验 |
| Chrys | AGENTS/`.agents` bundle 与调用构造已实现；rules 仅引用可达，原生来源未接入 | 用户确认本机未安装，本轮无原生格式、CLI 或 hook 实证；没有安装或全盘搜索 | 现有权限旗标未核，detached 预检以 adapter_headless_permission_unsupported 拒绝，dry-run 为 WARN；不泛化为所有有人会话不可用。不能因文档/argv 存在宣称完整 headless、读图或工具审计支持 |
| generic | 固定 native reader 不适用；共享入口、显式 `--target/--test-target` 及同 schema 自动 request 的 `origin_gap` 已有 | 任意外部 CLI 无统一原生格式，本轮没有其专用线上实证 | 只保证实际执行的显式局部目标结果；读不到原话时不核档位/完整 diff 归属，不签完整 review 或请求 PASS，不据此授豁免。实际能力仍由宿主 provider/profile 决定，不因有 bundle 或命令模板就称已执行 |

Claude 实际落盘 `uuid` 为原始 user 引用，hook 的 prompt_id 对应原件 promptId，二者不等；新版 api-request-blob 为缓存快照、压缩总结虽 type=user 但带 isCompactSummary/isVisibleInTranscriptOnly，均不得当新用户授权。compact_boundary 是 system 记录，落盘字段 compactMetadata；能明确保留已读规则才复用。Codex 原件中的 agent_message 代理通讯不能当用户；已知 `# AGENTS.md instructions`、`<environment_context>` 等客户端指令/环境注入即使落为 role=user，也不能当用户原请求或流程授权。标有 `thread_source: subagent` 或子代理血缘的会话不能冒充根用户来源，须沿原请求核准确根线程原件；不能从子代理唯一一条 user 记录推定根用户授权。字段按真实版本解析，不以角色、格式可解析或文件存在宣称真实用户来源/语义已由机器证明。

原生 trust/逐 hook review 仍由用户控制；框架物化不自动绕过或改全局信任。Codex 的 `.codex/hooks.json` 含本机绝对路径，是本机生成文件。工程移动或克隆后必须重跑 init，并按新定义重新完成 native 信任。Codex 必须信任准确的项目层及当前 hook 定义，祖先目录 trusted 不保证新嵌套项目已启用；未启用或原件不可读时如实降级。Shell 重定向、脚本、场外进程和未覆盖编辑工具是明确盲区；无 hook 时常驻规则及首次 compile/request 后验只覆盖实际进入框架的调用，完全绕开且不再检查的会话没有发现保证。前门保证和原有 framework 编辑写保护分别报告。

### Layer 3 合作式拦截（settings_file + hooks）

`claude` 与 `codeagent` adapter 通过 `settings_file` + `hooks` 两个可选字段提供已接入原生事件的
Layer 3 合作式编辑/Stop 拦截能力（详见 `CLAUDE.md` §5.1；两者共享同一份 hook 脚本模板，settings.json 仅差
目录与项目根变量——claude=`${CLAUDE_PROJECT_DIR}`、codeagent=`${CODEAGENT3_PROJECT_DIR}`）：

- `settings_file` 注册 `Stop` / `PreToolUse` hook；
- `hooks/check-phase-completion.mjs` 在主 agent 即将结束消息时按 CLAUDE.md §5.1 四条件物理拦截"假完成"；
- `hooks/guard-framework-write.mjs` 在 PreToolUse 拦截对只读发布件 `framework/` 的编辑类写入。

### 阶段独立核验

适用性由 profile、workflow 和 evidence policy 决定。模型绑定与运输按实际客户端解析；需要核验但当前无法执行时，保留未完成及恢复条件。完整交付与单阶段入口、request 和报告交回均按[独立阶段核验](../skills/reference/agents-entry-detail.md#独立阶段核验)执行。

由 `framework-init` UPDATE 的 `cleanup-deprecated` 处理已退役受管角色 `.claude/agents/verifier.md`、`.cac/agents/verifier.md` 和 `.codex/agents/verifier.toml`。任务先在 `.framework-backup/<stamp>/` 按原路径备份，再删除该文件；其余角色与用户文件保留。

`cursor` / `generic` adapter 暂无等价物理层，闭环依赖 Layer 1（CLAUDE.md §5.1 + §6.5）+ Layer 2
（`framework/harness/templates/phase-completion-receipt.md` + `framework/harness/scripts/check-receipt.ts`）
共同保证。后续如要补 cursor 侧的 hooks，按 `adapter-schema.yaml` 中的 `settings_file` / `hooks` 字段定义
扩展即可。
