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
└── cursor/                      ← Cursor adapter（AGENTS.md + .cursor/skills/ 跳板 + .cursor/rules/）
    ├── adapter.yaml
    └── templates/
        ├── skills/<skill>/SKILL.md
        └── rules/framework.mdc
```

## 关键设计

1. **adapter 不承担任何 skill 逻辑**——skill 本身是纯 Markdown，adapter 只负责
   把 skill 入口按该 agent 的约定暴露出来（slash / 跳板 / rules）。
2. **adapter 不修改 framework 自身**——它只产出**实例工程根**的文件。
3. **adapter 之间互斥**——一个实例工程 `framework.config.json.agent_adapter`
   只允许选一个 adapter；切换时需由初始化 Skill 清理旧产物。
4. **模板共享优先**：各 adapter 的 `agent_entry_file` 共用渲染源
   `framework/templates/AGENTS.md.template`；`target_path`（实例根写入的文件名）由各自
   `adapter.yaml` 声明。

## Skill 跳板：禁止「双源分叉」（适用生成跳板的 adapter）

部分 adapter 会在实例根生成**极短**的 `SKILL.md` 跳板，仅承载 frontmatter 与 **一条**
跳转到 `framework/skills/<n>/SKILL.md` 的链接。

- **禁止**在跳板里追加业务条款、选型表或多个次级文档链接；否则 agent 可能只读跳板、漏掉正文中的 BLOCKER、harness 与 verifier 要求。
- **正确落点**：扩写写到 `framework/skills/<n>/` 正文及同目录 `prompts/`、`templates/`、`reference/`；需要改跳板默认形态时改 **本目录下对应 adapter 子目录** 的 `templates/`，再经 Framework 初始化（Skill 00）render 下发，**勿**仅在实例跳板内手补。
- Cursor 侧的会话级总规则与本条呼应：见 `cursor/templates/rules/framework.mdc`（Skill 路由第三条）。

## Init Skill：`adapter.yaml` 产物速查（与 Step 4 对齐）

| `adapter_name`（目录名） | 入口文件（`agent_entry_file.target_path`） | 典型额外产物 |
|--------------------------|--------------------------------------------|--------------|
| `generic` | `AGENTS.md` | 无 |
| `claude` | `CLAUDE.md` | `.claude/commands/*.md`、`.claude/agents/verifier.md`、`.claude/settings.json`、`.claude/hooks/*.mjs` |
| `cursor` | `AGENTS.md` | `.cursor/skills/<skill>/SKILL.md`、`.cursor/rules/framework.mdc` |

## Init Skill：`adapter.yaml` 字段处理示例（以 claude adapter 为代表）

落地方式：**从选中 adapter 的 `templates/` 拷贝到实例根**，逐字段语义见 `adapter-schema.yaml`。下表仅用 **claude** 示意「模板相对路径 → 实例根路径」的常见形态；其它 adapter 以各自 `adapter.yaml` 为准。

| adapter.yaml 字段 | 处理动作 | 示例（claude） |
|---|---|---|
| `agent_entry_file` | **占位符替换**后写入 `target_path` | `templates/AGENTS.md.template` → `CLAUDE.md` |
| `commands` / `skill_bridge` / `rules` / `commands.subagents` | **整目录原样复制** `template_dir` → `target_dir` | `templates/commands/*.md` → `.claude/commands/*.md` |
| `settings_file`（可选）| **原样复制**（模板内仅允许使用该客户端定义的 `${…}` 变量） | `templates/settings.json` → `.claude/settings.json` |
| `hooks`（可选）| **整目录原样复制** | `templates/hooks/*.mjs` → `.claude/hooks/*.mjs` |

Step 0.3 体检第 3 项必须 **逐文件** 覆盖上表涉及到的全部 `target_path` / `target_dir`（含 `settings_file` / `hooks`）；对 **claude** adapter 而言即 `.claude/commands/**`、`.claude/agents/**`、`.claude/settings.json`、`.claude/hooks/**` 等——**宁可对照本 adapter 的 `adapter.yaml` 列全路径，也不要凭印象漏扫**。

## Adapter 选定建议（承接 Skill 00 Step 0.2.5）

扫描 `framework/agents/` 下含 `adapter.yaml` 的一级子目录即候选 adapter；对每个候选展示 YAML 内的 `adapter_name` 与 `description`（多行描述取首段）。

**默认建议逻辑（可被用户覆盖）**：

| 用户环境线索 | 建议 adapter |
|--------------|--------------|
| 已大量使用 **Claude Code** 的 slash 命令流程 | `claude` |
| 已大量使用 **Cursor** 的技能跳板 / workspace rules | `cursor` |
| 希望最少生成物、与具体 IDE 耦合最弱 | `generic` |

切换 adapter 时：旧入口与其它产物路径可能与新 adapter **不一致**（例如 `.claude/` 与 `.cursor/` 可能在仓库中并存）；须列出「建议删除或手工处理的遗留目录」请用户确认，**不要自动 `rm -rf`**。

## 工程指纹与 adapter 推测（承接 scan-project）

以下为**只读启发**，不能替代用户对 `adapter_name` 的显式选定：

- 存在 `.claude/commands/` → 用户可能期望 **claude** adapter。
- 存在 `.cursor/skills/` → 可能期望 **cursor** adapter。
- 仅有某一种入口 Markdown（由各 adapter 定义的 `agent_entry_file.target_path`）→ 记下当前文件名，切换 adapter 时避免静默覆盖。

## 新增 adapter 步骤

1. 在本目录下新建 `<adapter_name>/` 子目录。
2. 按 `adapter-schema.yaml` 的约束创建 `<adapter_name>/adapter.yaml`。
3. 在 `<adapter_name>/templates/` 下放置 adapter 专属模板（slash / 跳板 / rules）。
4. 跑 `framework/skills/00-framework-init` 的 UPDATE 模式自检，确保 adapter 被列入可选项。
5. 更新 **本文件**「第一版 adapter 列表」一节（及 `framework/README.md` 中指向 `agents/` 的总览句，若有）。

## 占位符

所有模板允许使用 `{{PROJECT_NAME}}` / `{{AGENT_ADAPTER}}` / `{{ARCHITECTURE_SUMMARY}}`
等占位符（完整清单见 `adapter-schema.yaml` 的 `placeholders` 段），由初始化 Skill
在生成阶段根据 `framework.config.json` 和用户交互答复填充。

## 第一版 adapter 列表

| adapter | 入口文件 | slash | skill 跳板 | rules | settings_file | hooks |
|---------|---------|-------|-----------|-------|---------------|-------|
| generic | AGENTS.md | — | — | — | — | — |
| claude  | CLAUDE.md | `.claude/commands/*.md` + `.claude/agents/verifier.md` | — | — | `.claude/settings.json` | `.claude/hooks/*.mjs` |
| cursor  | AGENTS.md | — | `.cursor/skills/<skill>/SKILL.md` | `.cursor/rules/framework.mdc` | — | — |

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
