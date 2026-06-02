# Framework（多 profile Skill + Harness）

本目录是**与具体业务解耦**的通用资产：阶段规则（`specs/phase-rules`）、全生命周期 Skill（`skills/`）、门禁脚本与 runner（`harness/`）、agent 适配插件（`agents/`）、以及初始化用的模板（`templates/`）。业务工程通过 **git submodule** 引入本目录后，用 **Framework 初始化 Skill** 在**实例工程根**生成 `framework.config.json`、`doc/` 骨架与 agent 路由文件。

---

## 能做什么

- **架构可配置**：外层/内层模块依赖、路径根目录等由实例根的 `framework.config.json` 声明，harness 从配置读取，不绑死某一种层数或层名。
- **阶段化工作流**：由实例 `active_workflow` 指向的 YAML（默认 `spec-driven`）声明全局元阶段与 feature 链；**全局**：`extensions` / `init` / `catalog` / `glossary` / `docs`；**功能**：`prd` → `design` → `coding` → `review` / `ut`（自 `coding` 分叉）→ `testing`。每阶段有 YAML 规则 + `check-*.ts`（见 [`docs/operations/harness-runbook.md`](docs/operations/harness-runbook.md)）。完整 DAG 以 [`workflows/spec-driven.workflow.yaml`](workflows/spec-driven.workflow.yaml) 为准。
- **框架升级兼容（compat）**：存量 feature 遇新版本 BLOCKER 时，可在 `doc/features/<feature>/compat.yaml` 做**可过期**临时降级；推荐用 `cd framework/harness && npm run backfill:context` 正规化。详见 [docs/evolution/compat-protocol-v1.md](docs/evolution/compat-protocol-v1.md) 与 [MIGRATION.md §v2.6](MIGRATION.md)。
- **多 agent 入口**：通过 `framework/agents/<adapter>/` 插件，把同一套 Skill 按所选客户端约定暴露出来（slash、跳板、全局说明文件等）；**产品与路径对照仅限** [agents/README.md](agents/README.md)。
- **工程类型 profile（project_profile）**：与 adapter 正交，声明在实例根 `framework.config.json` 的 `project_profile`（默认 `hmos-app`）。每套模板位于 [profiles/](profiles/README.md)，可禁用整阶段 harness 或声明能力档位。

### 逻辑分层（目录角色）

不做物理 `framework/core/` 目录重组（避免海量路径字符串迁移）；顶层目录按**逻辑角色**划分如下：

| 目录 | 角色 | 说明 |
|------|------|------|
| `skills/`、`specs/`、`harness/`、`templates/`、`docs/` | **core** | 通用流程、规则、脚本与模板 |
| `profiles/` | **profile-plugin** | 宿主 toolchain / capability / overlay |
| `agents/` | **agent-plugin** | IDE 适配（slash / 跳板 / rules） |
| `workflows/` | **workflow**（可选） | phase DAG YAML，fork 自定义顺序 |
| 实例根 `doc/extensions/` | **instance-extension** | 业务 SKILL、knowledge、hooks、manifest |

叠加顺序：**framework 默认 → profile → workflow → instance extensions**。详见 [docs/concepts/extensibility.md](docs/concepts/extensibility.md)。

### Profile 加载顺序

1. `framework.config.json > project_profile.name` 选择 active profile；缺失时兼容回退 `hmos-app`，并输出一次 advisory，提示通过 framework-init UPDATE 补字段。
2. `framework/profiles/<profile>/config-defaults.json` 为配置缺省来源；显式写在实例 `framework.config.json` 的字段不会被 defaults 覆盖。
3. 基础 phase rules 先从 `framework/specs/phase-rules/` 读取，再合并 active profile 的 `phase-rules-overlays/`。
4. 阶段 Skill 主体只保留通用流程；宿主语言、模块格式、toolchain 与 UI/测试细节从 `framework/profiles/<profile>/skills/<skill>/profile-addendum.md` 读取。
5. verifier prompt 先读取 `framework/harness/prompts/verify-<phase>.md`，再拼接 active profile 的 `harness/prompts/verify-<phase>.overlay.md`（若存在）。

---

## 如何引入到其它工程

本 framework 通过 **`project_profile`** 区分宿主能力（默认多为 `hmos-app`）；具体 profile 含义见 [文档：profiles](profiles/README.md)。

在目标仓库根执行（远程 URL 换成你的 framework 托管地址）：

```bash
git submodule add <your-framework-repo-url> framework
git submodule update --init --recursive
```

然后在当前工程所使用的 **AI coding agent** 里触发 **Framework 初始化**（见下一节）。初始化会在**实例根**写出配置与文档骨架，而不会修改 `framework/` 子模块内容。

---

## 初始化入口（Skill 00）

**不要**指望单独一个 CLI 脚本替代交互——标准入口是 Skill：

- 正文：[framework/skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md)
- 典型触发方式因 adapter 而异：slash、技能列表、或直接要求按该 Skill 执行；参见 [agents/README.md](agents/README.md)。

初始化会（在用户确认后）写出 `framework.config.json`、`doc/` 骨架、由各 adapter 声明的实例根入口与路由文件等。**具体文件名与目录**只对齐「当前选中的 `adapter_name`」，一覧见 [agents/README.md](agents/README.md)。完成后应按 Skill 指引跑 harness：**按需** `--phase extensions`、`--phase init --adapter <name>`（接入/升级时）、以及全局 `catalog` / `glossary` / `docs` 校验骨架与文档清单。

**`framework.config.json` 中与 PRD 相关的旋钮**：模板会从 Skeleton 写入 **`prd.visual_handoff_enforcement`**（默认 **`warn`**）。选型含义（何时改用 `strict` / `off`）见 [skills/00-framework-init/prompts/prd-harness-options.md](skills/00-framework-init/prompts/prd-harness-options.md)；PRD 正文写法见 [skills/1-prd-design/reference/visual-handoff.md](skills/1-prd-design/reference/visual-handoff.md)。

**重要**：未跑完 `00-framework-init` 前，不要执行 Skill 0～6；各 Skill 正文开头也写了此前置声明。

---

## 如何告诉 AI 执行初始化 Skill（移植到新工程时必看）

把 `framework/` 移植到新工程后，agent **是否认得**「初始化 Skill」取决于实例根是否已经由 **Skill 00** 写出全局入口与其它路由——不同 adapter 的**具体文件名与触发方式**见 [agents/README.md](agents/README.md)。下面按「有没有已完成过一次 init」分两场景（与具体品牌无关）。

### 场景一：工程里已有 `framework/` **且** 实例根已存在由 init 下发的全局入口

任选其一触发即可：

1. **若当前 adapter 提供 slash**：使用其已为 `framework-init` 注册的 slash（模板由 Skill 00 下发；名称以 adapter 为准）。
2. **自然语言触发**：
   - 「请执行 framework-init skill」
   - 「按 `framework/skills/00-framework-init/SKILL.md` 接入 framework」
   - 全局入口中的 Skill 路由表已指向 Skill 00 时，上述说法通常可被遵守全局约束的 agent 解析。

### 场景二：全新工程——只有 `framework/` 子目录，**尚未**跑过 Skill 00

此时 agent 往往**没有**实例根全局指令，必须用**完整路径**显式引导到 Skill 00：

```text
请完整读一遍 framework/skills/00-framework-init/SKILL.md，然后按里面的 S1 → S4 严格执行，把这个工程的 framework 初始化跑完。不要省略任何步骤，遇到需要我确认的事情停下来问我。
```

要点：
- **必须给完整路径**，不要让 agent 自己猜。
- 强调「完整读一遍」+「严格按步骤」，防止弱模型只扫开头就动手。
- 强调「需要确认就停下来」，契合 Skill 00 S2 的 registry 确认设计（`init.materialized_adapters` 多选是 BLOCKER；generic 默认 bundle 由 template 写入，非标 bundle 根须手动编辑 config 后重跑）。

跑完 S1～S4 后，实例根会生成由**物化 adapter 清单** 约定的入口与路由文件（路径见 [agents/README.md](agents/README.md)），以后再进这个工程就回到**场景一**。

### 场景三：连 `framework/` 子目录都没有

按 Skill 00 S1.1 的规定，先在工程根执行：

```bash
git submodule add <your-framework-repo-url> framework
git submodule update --init --recursive
```

然后回到**场景二**的引导语。Skill 00 里专门拦截过这一步："若 `framework/harness/harness-runner.ts` 不存在 → 停下，提示用户先 submodule，不要凭空造一个假 framework 目录"——即便你忘了，合规的 agent 也会自己停住。

### 万能引导语（三种场景通用）

未来移植到其它工程时，下面这段话可以**直接贴给 AI**，不论当前工程有没有 framework、有没有全局入口文件都适用：

```text
这个工程已经把 framework/ 作为 git submodule 引入（如果没有，请先 git submodule add <framework-repo-url> framework 再继续）。
请完整阅读 framework/skills/00-framework-init/SKILL.md，按里面的 S1 → S4 严格执行，
完成 framework 在本工程的初始化或升级。涉及架构 DSL、adapter 选择、产物路径等关键决策，
必须停下来让我确认，不要静默写入。
```

这一句话覆盖了：指明入口 SKILL → 规定执行模式 → 预留人工确认点；对任何能读仓库文件、遵守 Skill 约束的 agent 都适用。

---

## 已支持的 agent adapter

**唯一 SSOT**：[framework/agents/README.md](agents/README.md)（含对照表、路径、Layer 3 行为与扩展步骤）。本文件不复制各品牌差异，避免双源。

协议结构见 [framework/agents/adapter-schema.yaml](agents/adapter-schema.yaml)。

---

## Harness 常用命令

在实例仓库中，于 `framework/harness` 目录执行（具体 phase 与 `--feature` 以各 Skill 为准）。**首次进入前**（包括新克隆、换机器、CI）需先安装 npm 依赖——`framework/harness/` 的 `node_modules/` 与 `package-lock.json` 均不随框架分发（内网 registry 与外网不同，lock 文件本地生成更稳）：

```bash
cd framework/harness
npm install                   # 仅首次或 package.json 变更后执行（Tier_1 详见 framework/skills/reference/host-harness-readiness.md）
npx ts-node harness-runner.ts --phase <phase> [--feature <feature-name>]
```

初始化时由 Skill 00 S3（`harness-install` 任务）自动完成 `npm install`，此处仅作手动说明。

**Framework 自身回归**（**仅源仓**；发布件 `npm test` 已重定义为 `check:global`）：在同一目录执行 `npm test`，会跑 **单元 + fixture**。含 `INPUT/`/`CMD.json` 的契约基线分列在 [`profiles/hmos-app/harness/tests/fixtures/`](profiles/hmos-app/harness/tests/fixtures) 与 [`profiles/generic/harness/tests/fixtures/`](profiles/generic/harness/tests/fixtures)；入口脚本 [harness/tests/run-tests.ts](harness/tests/run-tests.ts)。

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

1. 阶段规则、脚本与 Skill 的正文以本仓库 `framework/` 为 SSOT；合并前应用本仓库绑定的 `project_profile`（及至少一个代表性 feature）跑通关键 phase 的 harness 回归。
2. 新增 adapter：在 `framework/agents/<name>/` 增加目录与 `adapter.yaml`，遵守 `adapter-schema.yaml`；并更新 `agents/README.md` 中的列表与说明。
3. 元服务（`atomic_service`）等扩展位见 `framework/docs/atomic-service-roadmap.md`，避免在通用规则里硬编码单一场景假设。
