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
├── opencode/                    ← OpenCode CLI adapter（AGENTS.md 共享 + 自有 .opencode/ bundle + opencode run headless）
│   ├── adapter.yaml
│   └── templates/
└── codeagent/                   ← CodeAgent adapter（Claude Code 内核 fork；AGENTS.md + .cac/ 产物 + codeagentcli headless）
    ├── adapter.yaml
    └── templates/               ← 仅 settings.json 与 commands/ 自有；agents/hooks/rules/goal-condition 跨目录引用 ../claude/templates/
```

各 adapter 可选声明 `goal_capability`（goal-runner 全链路；check-init 仅 WARN，runner preflight BLOCKER）。见 `docs/operations/goal-mode-runbook.md`。

## Goal capability 路由

`goal_capability` 同时描述外部 runner 与会话内调和能力。root 字段：

| 字段 | 含义 |
|---|---|
| `level` | 既有 native/external/hook 能力级别 |
| `in_session_reconcile` | 宿主可运行 assess 驱动的会话内循环 |
| `phase_context_isolation` | 每个 phase 可在新鲜隔离上下文执行 |
| `supports_resume` | 能恢复同一 goal ledger |
| `handoff` | `none` / `to_detached` / `bidirectional` |

约束：

- `in_session_reconcile=true` 必须同时声明 `phase_context_isolation=true`；
- `handoff!=none` 必须声明 `supports_resume=true`；
- 未声明的新字段按保守 `false` / `none` 处理，不从 CLI 存在性推断；
- adapter 缺会话隔离时，用户的“有人在场”请求降级为手动 harness+assess；
- 无人值守仍须通过 `external_runner.unattended` preflight。

当前显式声明：Codex 支持会话内隔离、resume 与双向 handoff；Claude 支持会话内隔离，但不声明 resume/handoff。其他 adapter 保持保守默认，继续走既有 external runner 或手动路径。用户界面只显示“有人在场 / 无人值守”，不显示内部能力层级。

schema、组合约束与 fallback 以 [`adapter-schema.yaml`](./adapter-schema.yaml) 和 [`goal-adapter-capability.ts`](../harness/scripts/utils/goal-adapter-capability.ts) 为准。

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
| `codeagent` | `AGENTS.md` | `.cac/commands/*.md`（自有副本，身份行=codeagent）、`.cac/agents/verifier.md`、`.cac/settings.json`（变量 `${CODEAGENT3_PROJECT_DIR}`）、`.cac/hooks/*.mjs`、`.cac/rules/*.md`（与 claude 共享模板） |

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

## Adapter 选定建议（personal setup · framework-initb）

**项目 init 不再选 active adapter。** 个人 setup（`setup.adapter`）只能从 **`materialized_adapters` 已物化** 的目录名中选；未物化则引导回项目 init。

| 用户环境线索 | setup 建议 |
|--------------|------------|
| 日常用 Claude Code slash | personal `claude` |
| 日常用 Cursor skills/rules | personal `cursor` |
| 日常用 Chrys headless | personal `chrys` |
| 日常用 OpenCode CLI | personal `opencode` |
| 日常用 CodeAgent（.cac / codeagentcli） | personal `codeagent` |
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
| codeagent | AGENTS.md | `.cac/commands/*.md`（自有副本）+ `.cac/agents/verifier.md`（共享模板） | — | `.cac/rules/*.md`（共享模板） | `.cac/settings.json` | `.cac/hooks/*.mjs`（共享模板） |

### Layer 3 物理拦截能力（settings_file + hooks）

`claude` 与 `codeagent` adapter 通过 `settings_file` + `hooks` 两个可选字段提供「弱模型工作流强制门」
的 Layer 3 物理拦截能力（详见 `CLAUDE.md` §5.1；两者共享同一份 hook 脚本模板，settings.json 仅差
目录与项目根变量——claude=`${CLAUDE_PROJECT_DIR}`、codeagent=`${CODEAGENT3_PROJECT_DIR}`）：

- `settings_file` 注册 `Stop` / `SubagentStop` hook；
- `hooks/check-phase-completion.mjs` 在主 agent 即将结束消息时按 CLAUDE.md §5.1 四条件物理拦截"假完成"；
- `hooks/record-verifier-report.mjs` 在 verifier 子 agent 结束时**做身份绑定后**发布
  `verifier.report.<subject>.json`（唯一机器真源），供 `check-receipt.ts` 与其余机器消费者经
  `loadVerifierEvidence()` 读取；同名 `.md` 只是它生成的人读投影。

### verifier 能力声明（plan a9d4e7c2）

verifier 不是每阶段必跑的仪式，而是按 workflow 声明 + evidence policy + **adapter 能力**动态
启用的能力。adapter 侧的声明面是 `adapter.yaml` 的 `verifier_capability`
（`transport` / `publisher` / `modes`），运行时由 `resolveVerifierPlan` 解析为
`disabled | enabled | blocked` 三态，runner / check-receipt / Skill 指引共享同一结果。

**只登记真实实测过的 mode**：claude / codeagent 的 `interactive` 已由 SubagentStop 实抓验收；
headless / goal 目前仍走 bedside 旁路，未验收前不得预填——虚标会让 runner 生成一份永远
没人发布的 request。未声明该字段的 adapter = 无能力：`required` × `interactive` 下解析为
`blocked`（脚本诊断照常完整执行，脚本 PASS 后才报 `INCOMPLETE / verifier_provider_unavailable`）。

### SubagentStop payload 消费契约（plan e5b8c3f7 / a9d4e7c2）

hook 消费的字段：`agent_id`（子 agent 身份）、`agent_transcript_path`（**子代理**转录，取首条
user prompt —— 它必须恰好是那份 request JSON）、`last_assistant_message`（子代理终答，取唯一
版本化终态块）、`agent_type`（来源标注）。`transcript_path` 指**主会话**，身份与结论都不从它取。
`agent_type` 可能是空串（发射点为 `a ?? ""`），故只如实记录、不据此 fail-closed。

绑定=四方对账：request 自述 subject == 按 request 字段**重算**的 subject ==
`summary.verifier_subject_id` == 终态块回显；且 `prompt_path` 等于由 config 推导的 canonical
路径、`prompt_sha256` 等于该文件的磁盘实测哈希（subject 本身按 `material_sha256` 审前材料视图派生，模板时间戳不换代；材料变了但历史有 PASS 时 check-receipt 沿用闭环并登记差异）。任一字段缺失、转录不可读、request 不可解析
（手抄/夹带/改字段）、subject 不等或已换代、prompt 已被新一轮 harness 换代 → 落
`framework/harness/state/last-verifier-report.json` 的 **bedside** 非权威记录（带机器可读
`reason`），canonical 证据一字不动，`.current-phase.json` 一字不写。

**降级矩阵**：

| adapter | payload 实证 | 状态 |
| --- | --- | --- |
| claude | 已实证（Claude Code 2.1.246 发行二进制内 zod schema + 发射点） | 支持 verifier 闭环 |
| codeagent | 已实证（宿主采集 2026-08-29） | 支持 verifier 闭环，共享同一份 hook、无 adapter-specific 分支 |
| cursor / codex / generic / … | 无 SubagentStop 物理层 | 未声明 `verifier_capability` = 无能力；`required` × interactive 下解析为 `blocked`（脚本诊断不受影响） |

codeagent 侧的两点实抓事实：payload 多出 `is_kia_repo` / `process_id`（本 hook 不消费，未知字段
一律忽略），少一个 claude 侧本就可选的 `prompt_id`；**SubagentStop 的 matcher 不按 agent type
过滤**，注册项一律触发。后者不改变任何结论——非 verifier 子 agent 的转录里没有机器块，一律
`invocation_request_unparseable` → bedside——但意味着 **settings.json 的 matcher 只是提示、不是过滤器**，
任何 adapter 都不得把它当身份闸门。（非 verifier 子 agent 的转录首条 prompt 不是一份合法 request JSON，一律 `invocation_request_unparseable` → bedside。）

> codeagent 的 hard_hook 档位对外声明以 plan c7a9e2f4 T6 宿主验收（PreToolUse exit2 真拒写 /
> Stop 真拦收尾 / SubagentStop 真落报告）完成为准；其中 SubagentStop 一项已由 2026-08-29 的
> payload 实抓覆盖。

`cursor` / `generic` adapter 暂无等价物理层，闭环依赖 Layer 1（CLAUDE.md §5.1 + §6.5）+ Layer 2
（`framework/harness/templates/phase-completion-receipt.md` + `framework/harness/scripts/check-receipt.ts`）
共同保证。后续如要补 cursor 侧的 hooks，按 `adapter-schema.yaml` 中的 `settings_file` / `hooks` 字段定义
扩展即可。
