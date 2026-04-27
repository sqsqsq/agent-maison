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
4. **模板共享优先**：agent 入口文件（AGENTS.md / CLAUDE.md）共用
   `framework/templates/AGENTS.md.template`；只有 target_path 不同。

## 新增 adapter 步骤

1. 在本目录下新建 `<adapter_name>/` 子目录。
2. 按 `adapter-schema.yaml` 的约束创建 `<adapter_name>/adapter.yaml`。
3. 在 `<adapter_name>/templates/` 下放置 adapter 专属模板（slash / 跳板 / rules）。
4. 跑 `framework/skills/00-framework-init` 的 UPDATE 模式自检，确保 adapter 被列入可选项。
5. 更新 `framework/README.md`：在 "已支持的 adapter" 列表中追加本 adapter。

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
