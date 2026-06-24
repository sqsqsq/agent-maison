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
│       ├── agents/              ← 子 agent 模板（如 verifier.md）
│       ├── settings.json        ← 客户端配置（注册 Stop / SubagentStop 等 hook）
│       └── hooks/               ← Claude Code hook 脚本（Layer 3 物理拦截）
├── cursor/                      ← Cursor adapter（AGENTS.md + .cursor/skills/ 跳板 + .cursor/rules/）
│   ├── adapter.yaml
│   └── templates/
└── codex/                       ← Codex CLI adapter（AGENTS.md + .codex/skills/ 跳板 + goal_capability）
    ├── adapter.yaml
    └── templates/
├── chrys/                       ← Chrys agent adapter（AGENTS.md + .agents/ bundle + chrys run headless）
│   ├── adapter.yaml
│   └── templates/
└── opencode/                    ← OpenCode CLI adapter（AGENTS.md 共享 + 自有 .opencode/ bundle + opencode run headless）
    ├── adapter.yaml
    └── templates/
```

各 adapter 可选声明 `goal_capability`（goal-runner 全链路；check-init 仅 WARN，runner preflight BLOCKER）。见 `docs/operations/goal-mode-runbook.md`。

## 关键设计

1. **adapter 不承担任何 skill 逻辑**——skill 本身是纯 Markdown，adapter 只负责
   把 skill 入口按该 agent 的约定暴露出来（slash / 跳板 / rules）。
2. **adapter 不修改 framework 自身**——它只产出**实例工程根**的文件。
3. **双 adapter 模型（编排化重构）**：
   - **`materialized_adapters: string[]`**（项目级，写入 `framework.config.json`）：本仓库要生成/维护哪些 adapter 产物。
   - **`agent_adapter`**（个人级，`framework.local.json`，gitignored）：开发者当前使用的 adapter；由阶段入口 **`check-personal-setup.ts --json --ensure`** 内联写入，**不在项目 init 中选择**。
   - 物化时 render-env 用**正在物化的 adapter**，不把 personal active adapter 写进提交产物。
4. **模板共享优先**：各 adapter 的 `agent_entry_file` 共用 `framework/templates/AGENTS.md.template`。

## Skill 跳板：禁止「双源分叉」（适用生成跳板的 adapter）

部分 adapter 会在实例根生成**极短**的 `SKILL.md` 跳板，仅承载 frontmatter 与 **一条**
跳转到 `framework/skills/<n>/SKILL.md` 的链接。

- **禁止**在跳板里追加业务条款、选型表或多个次级文档链接；否则 agent 可能只读跳板、漏掉正文中的 BLOCKER、harness 与 verifier 要求。
- **正确落点**：扩写写到 `framework/skills/<n>/` 正文及同目录 `prompts/`、`templates/`、`reference/`；需要改跳板默认形态时改 **本目录下对应 adapter 子目录** 的 `templates/`，再经 Framework 初始化（framework-init）render 下发，**勿**仅在实例跳板内手补。
- Cursor 侧的会话级总规则与本条呼应：见 `cursor/templates/rules/framework.mdc`（Skill 路由第三条）。

**v2.3+ 扁平 skill-id**：实例根跳板目录/文件使用扁平名（如 `.cursor/skills/coding/`、`.claude/commands/coding.md`），不再生成编号形态的旧目录。UPDATE `framework-init` 的 `cleanup-deprecated` 任务会按 `materialized_adapters` 自动 `backup_delete` 遗留 skill 跳板（含语义旧名如 `prd-design` / `requirement-design`；备份 `.framework-backup/<timestamp>/`）；**勿**再依赖宿主手工删旧跳板。旧 adapter 级废弃目录（`adapter.yaml` `deprecated_artifacts`）仍走同一任务。

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
| `claude` | `CLAUDE.md` | `.claude/commands/*.md`、`.claude/agents/verifier.md`、`.claude/settings.json`、`.claude/hooks/*.mjs` |
| `cursor` | `AGENTS.md` | `.cursor/skills/<skill>/SKILL.md`（8 份内置跳板）、`.cursor/rules/framework.mdc` |
| `codex` | `AGENTS.md` | `.codex/skills/<skill>/SKILL.md`（bridge 跳板）、`.codex/rules/interaction-renderer.md` |
| `chrys` | `AGENTS.md` | `.agents/skills/<skill>/SKILL.md`（bridge 跳板）、`.agents/rules/interaction-renderer.md` |
| `opencode` | `AGENTS.md` | `.opencode/skill/<skill>/SKILL.md`（自有原生目录；bridge 跳板；技能自动注册为 slash）、`.opencode/rules/interaction-renderer.md` |

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
| 其它自定义 bundle | `["generic"]`（默认 `.agents`/bridge 零配置；仅非标 bundle 根须显式配置 `paths.agent_bundle_root`） |

切换/增删 adapter：UPDATE init 更新 `materialized_adapters` 并重跑物化；**旧 adapter 目录可能残留**，列给用户手工处理，不自动 `rm -rf`。

## Adapter 选定建议（personal setup · framework-initb）

**项目 init 不再选 active adapter。** 个人 setup（`setup.adapter`）只能从 **`materialized_adapters` 已物化** 的目录名中选；未物化则引导回项目 init。

| 用户环境线索 | setup 建议 |
|--------------|------------|
| 日常用 Claude Code slash | personal `claude` |
| 日常用 Cursor skills/rules | personal `cursor` |
| 日常用 Chrys headless | personal `chrys` |
| 日常用 OpenCode CLI | personal `opencode` |
| 使用 `.agents` / `.codex` bundle 加载（其它自定义 agent） | personal `generic` |

## Claude Code 确认 Widget（interaction-renderer）

- **工具名**：`AskUserQuestion`（Claude adapter 专属；见 `.claude/rules/interaction-renderer.md`）。
- **会话规则**：`.claude/rules/interaction-renderer.md`（claude adapter `rules` 段下发，与 CLAUDE.md 同优先级）——**BLOCKER**：所有用户选择须 AskUserQuestion + portable 脚注；选项文案 SSOT 在 [confirmation-registry.yaml](../skills/reference/confirmation-registry.yaml)。
- **slash 强约束**：各 `.claude/commands/*.md` 含一句 AskUserQuestion BLOCKER，链 interaction-renderer。
- **init BLOCKER**：framework-init S2 — `init.task_plan` / `init.materialized_adapters` / `init.task_decision`；personal — framework-initb `setup.*`。
- **实例下发**：vendor 升级后用户自行 `/framework-init` UPDATE；check-init UPDATE 会自动 `backup_delete` 废弃的 `confirmation-ux.md` / `widget-options/`。
- **Cursor 对称**：`.cursor/rules/interaction-renderer.mdc`（AskQuestion）。

## 内部 agent（Chrys / OpenCode / Codemate 等）

**chrys** 与 **opencode** 为独立 adapter（`structured_widget: unsupported`，portable 编号菜单）。实例分别选 personal `chrys` / `opencode`。**chrys** 与 generic 默认 `.agents` bridge bundle 字节一致、可幂等共存；**opencode** 用自有原生 `.opencode/skill` bundle（AGENTS.md 仍共享，像 cursor 各用各 skill 目录、互不冲突）。差异仅在 headless 运行器与 skill 落盘目录。**codemate** 等尚无专用 adapter 时仍可用 **`generic`**。

- `adapter.yaml` → `user_confirmation.structured_widget: unsupported`
- 确认交互只展示 **portable 编号菜单**（见 `.agents/rules/interaction-renderer.md` 与 [user-confirmation-ux.md](../skills/reference/user-confirmation-ux.md)）
- 禁止假设结构化 widget 可用
- **opencode 额外说明**：maison opencode adapter 物化到其**原生主目录** `.opencode/skill/<id>/SKILL.md` + `.opencode/rules/`（`AGENTS.md` 共享，技能自动注册为 slash 命令）。选 `.opencode/skill` 而非 `.agents/skills` 的原因：`.opencode/skill` 是 opencode 长期稳定的主 skill 目录（兼容当前版本及传统原生目录）；`.agents` 外部 skill 发现是较新特性，旧版 `opencode-ai` 读不到。**`.opencode/rules/*` 不被 opencode 自动加载**（`*.mdc` 为 Cursor 格式，对 opencode 惰性），是「引用可达」被动文档（同 chrys `.agents/rules`），非有效规则入口；maison **不**为此创建/覆盖用户的 `.opencode/opencode.json`。与 claude/generic/chrys 同时物化时各写各目录（`.opencode/skill` vs `.claude/skills` vs `.agents/skills`），如扫到同名 skill 仅 logWarning（无害）。

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
| claude  | CLAUDE.md | `.claude/commands/*.md` + `.claude/agents/verifier.md` | — | `.claude/rules/*.md` | `.claude/settings.json` | `.claude/hooks/*.mjs` |
| cursor  | AGENTS.md | — | `.cursor/skills/<skill>/SKILL.md`（模板 SSOT：`shared/agent-bundle/templates/skills-bridge`） | `.cursor/rules/*.mdc` | — | — |
| codex   | AGENTS.md | — | `.codex/skills/<skill>/SKILL.md`（bridge 跳板） | `.codex/rules/interaction-renderer.md` | — | — |
| chrys   | AGENTS.md | — | `.agents/skills/<skill>/SKILL.md`（bridge 跳板） | `.agents/rules/interaction-renderer.md` | — | — |
| opencode | AGENTS.md | —（技能自动注册 slash） | `.opencode/skill/<skill>/SKILL.md`（自有原生目录；bridge 跳板） | `.opencode/rules/interaction-renderer.md` | — | — |

### Layer 3 物理拦截能力（settings_file + hooks）

`claude` adapter 通过 `settings_file` + `hooks` 两个可选字段提供「弱模型工作流强制门」的 Layer 3
物理拦截能力（详见 `CLAUDE.md` §5.1）：

- `settings_file` 注册 `Stop` / `SubagentStop` hook；
- `hooks/check-phase-completion.mjs` 在主 agent 即将结束消息时按 CLAUDE.md §5.1 四条件物理拦截"假完成"；
- `hooks/record-verifier-report.mjs` 在 verifier 子 agent 结束时落地报告，供 `check-receipt.ts` 引用。

`cursor` / `generic` adapter 暂无等价物理层，闭环依赖 Layer 1（CLAUDE.md §5.1 + §6.5）+ Layer 2
（`framework/harness/templates/phase-completion-receipt.md` + `framework/harness/scripts/check-receipt.ts`）
共同保证。后续如要补 cursor 侧的 hooks，按 `adapter-schema.yaml` 中的 `settings_file` / `hooks` 字段定义
扩展即可。
