# HarmonyOS Framework（可复用 Skill + Harness）

本目录是**与具体业务解耦**的通用资产：阶段规则（`specs/phase-rules`）、全生命周期 Skill（`skills/`）、门禁脚本与 runner（`harness/`）、agent 适配插件（`agents/`）、以及初始化用的模板（`templates/`）。业务工程通过 **git submodule** 引入本目录后，用 **Framework 初始化 Skill** 在**实例工程根**生成 `framework.config.json`、`doc/` 骨架与 agent 路由文件。

---

## 能做什么

- **架构可配置**：外层/内层模块依赖、路径根目录等由实例根的 `framework.config.json` 声明，harness 从配置读取，不绑死某一种层数或层名。
- **阶段化工作流**：catalog / glossary → PRD → design → coding → review → UT → testing，每阶段有 Skill 文档 + YAML 规则 + `check-*.ts` 机械守门。
- **多 agent 入口**：通过 `framework/agents/<adapter>/` 把同一套 Skill 暴露为 Claude slash、Cursor 跳板、或仅 `AGENTS.md` 的通用模式。

---

## 如何引入到其它 HarmonyOS 工程

在目标仓库根执行（远程 URL 换成你的 framework 托管地址）：

```bash
git submodule add <your-framework-repo-url> framework
git submodule update --init --recursive
```

然后在 AI agent（Claude Code / Cursor 等）中触发 **Framework 初始化**（见下一节）。初始化会在**实例根**写出配置与文档骨架，而不会修改 `framework/` 子模块内容。

---

## 初始化入口：`/framework-init`

**不要**指望单独一个 CLI 脚本替代交互——标准入口是 Skill：

- 正文：[framework/skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md)
- 典型触发：slash `/framework-init`，或自然语言「把 framework 接入本工程 / 生成 framework.config.json」。

初始化会（在用户确认后）生成或更新例如：`framework.config.json`、`AGENTS.md` 或 `CLAUDE.md`、`doc/architecture.md`、catalog/glossary 空骨架、以及所选 adapter 的 `.claude/` / `.cursor/` 等产物。完成后应按 Skill 指引跑 harness 的 `catalog` / `glossary` phase 验证骨架。

**重要**：未跑完 `00-framework-init` 前，不要执行 Skill 0～6；各 Skill 正文开头也写了此前置声明。

---

## 已支持的 agent adapter

| adapter | 说明 | 入口与产物（由初始化写入实例根） |
|---------|------|----------------------------------|
| `generic` | 仅生成全局入口 `AGENTS.md` | 无 slash / 无跳板 |
| `claude` | Claude Code | `CLAUDE.md`、`.claude/commands/`、`.claude/agents/` 等 |
| `cursor` | Cursor | `AGENTS.md`、`.cursor/skills/` 跳板、`.cursor/rules/` 等 |

协议与扩展方式见 [framework/agents/README.md](agents/README.md) 与 [framework/agents/adapter-schema.yaml](agents/adapter-schema.yaml)。

---

## Harness 常用命令

在实例仓库中，于 `framework/harness` 目录执行（具体 phase 与 `--feature` 以各 Skill 为准）：

```bash
cd framework/harness
npx ts-node harness-runner.ts --phase <phase> [--feature <feature-name>]
```

Skill 0 的全局 phase（无 `--feature`）示例：

```bash
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
```

---

## Skill 索引

见 [framework/skills/README.md](skills/README.md)。

---

## 升级与迁移

见 [framework/MIGRATION.md](MIGRATION.md)。

---

## 贡献指南（framework 维护者）

1. 阶段规则、脚本与 Skill 的正文以本仓库 `framework/` 为 SSOT；合并前应用本仓库钱包示例跑通关键 phase 回归。
2. 新增 adapter：在 `framework/agents/<name>/` 增加目录与 `adapter.yaml`，遵守 `adapter-schema.yaml`；并更新本文「已支持的 agent adapter」表与 `agents/README.md`。
3. 元服务（`atomic_service`）等扩展位见 `framework/docs/atomic-service-roadmap.md`，避免在通用规则里硬编码单一场景假设。
