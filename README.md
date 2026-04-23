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

## 如何告诉 AI 执行初始化 Skill（移植到新工程时必看）

把 `framework/` 移植到一个新工程后，首次启动的 AI agent（无论内外 Claude、Cursor、还是别的 adapter）**本身并不认识 `framework-init`**——它的"认识"完全依赖实例根下是否已经有 `CLAUDE.md` / `AGENTS.md` / `.claude/commands/` / `.cursor/skills/` 这些由初始化产物生成的入口文件。因此要根据工程当前的状态用不同的方式引导它：

### 场景一：工程里已有 `framework/` + 实例根入口文件（`CLAUDE.md` / `AGENTS.md` 等）

这是"已经初始化过一次、现在只是升级或切 adapter"的情况。任选其一即可：

1. **原生 slash（Claude Code 最省事）**：直接敲 `/framework-init`。Claude Code 启动时会自动扫 `.claude/commands/*.md`，不需要额外引导。
2. **自然语言触发**：
   - 「请执行 framework-init skill」
   - 「按 `framework/skills/00-framework-init/SKILL.md` 接入 framework」
   - 因为 `CLAUDE.md` / `AGENTS.md` 第四章的 Skill 路由表已经写明了 Skill 00 的路径，agent 启动时会自动加载全局入口，所以这些触发词都认得。

### 场景二：全新工程——只有 `framework/` 子目录，**还没有** `CLAUDE.md` / `AGENTS.md` / `.claude/commands/`

这是"首次移植"最关键的情况。此时 agent 启动时没有任何全局指令，它**不会自动知道**本目录是什么。必须用完整路径手动把它引到 Skill 00：

```text
请完整读一遍 framework/skills/00-framework-init/SKILL.md，然后按里面的 Step 0 → Step 7 严格执行，把这个工程的 framework 初始化跑完。不要省略任何步骤，遇到需要我确认的事情停下来问我。
```

要点：
- **必须给完整路径**，不要让 agent 自己猜。
- 强调「完整读一遍」+「严格按步骤」，防止弱模型只扫开头就动手。
- 强调「需要确认就停下来」，契合 Skill 00 的对话式确认设计（Step 0.2.5 的 adapter 选定是 BLOCKER，必须由用户显式选字符串）。

跑完 Step 0 ～ 7 后，实例根会生成 `CLAUDE.md` / `AGENTS.md`、`.claude/commands/framework-init.md` 或 `.cursor/skills/00-framework-init/SKILL.md` 等入口文件，以后再进这个工程就回到**场景一**。

### 场景三：连 `framework/` 子目录都没有

按 Skill 00 Step 0.1 的规定，先在工程根执行：

```bash
git submodule add <your-framework-repo-url> framework
git submodule update --init --recursive
```

然后回到**场景二**的引导语。Skill 00 里专门拦截过这一步："若 `framework/harness/harness-runner.ts` 不存在 → 停下，提示用户先 submodule，不要凭空造一个假 framework 目录"——即便你忘了，合规的 agent 也会自己停住。

### 万能引导语（三种场景通用）

未来移植到其它工程时，下面这段话可以**直接贴给 AI**，不论当前工程有没有 framework、有没有 `CLAUDE.md` 都适用：

```text
这个工程已经把 framework/ 作为 git submodule 引入（如果没有，请先 git submodule add <framework-repo-url> framework 再继续）。
请完整阅读 framework/skills/00-framework-init/SKILL.md，按里面的 Step 0 → Step 7 严格执行，
完成 framework 在本工程的初始化或升级。涉及架构 DSL、adapter 选择、产物路径等关键决策，
必须停下来让我确认，不要静默写入。
```

这一句话覆盖了：指明入口 SKILL → 规定执行模式 → 预留人工确认点，在内/外 Claude、Cursor 以及其他遵守 Skill 协议的 agent 上都通用。

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

在实例仓库中，于 `framework/harness` 目录执行（具体 phase 与 `--feature` 以各 Skill 为准）。**首次进入前**（包括新克隆、换机器、CI）需先安装 npm 依赖——`framework/harness/` 的 `node_modules/` 与 `package-lock.json` 均不随框架分发（内网 registry 与外网不同，lock 文件本地生成更稳）：

```bash
cd framework/harness
npm install                   # 仅首次或 package.json 变更后执行
npx ts-node harness-runner.ts --phase <phase> [--feature <feature-name>]
```

初始化时由 `/framework-init`（Skill 00 Step 5.5）自动完成 `npm install`，此处仅作手动说明。

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
