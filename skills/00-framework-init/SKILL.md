# Framework 工程初始化 Skill (`00-framework-init`)

## 前置声明

- **本 Skill 是所有其它 Skill（0-catalog-bootstrap～6-device-testing）的前置**：在目标实例工程根生成 `framework.config.json`、agent 入口文件（`AGENTS.md` / `CLAUDE.md`）、`doc/architecture.md` 与 catalog / glossary 骨架，并可选落地所选 **agent adapter** 的路由 / 跳板 / 规则文件。
- 执行本 Skill 前，**仓库根下必须已存在 `framework/` 目录**（通常为 `git submodule add …` 引入）。若不存在：只读探测后**停下**，提示用户先完成 submodule 或拷贝，**不要**在实例工程里凭空造一个没有内容的假目录。
- 架构 DSL 的**机器可读契约**写在 `framework.config.json`；运行时校验规则见 [framework/harness/config.ts](../../harness/config.ts)（`validateArchitectureDsl` 会抛错，生成前 AI 必须自检 DAG / 非空内层等元规则）。

## 概述

你是一位资深 HarmonyOS 工程架构顾问。你的任务是在**已有真实代码树**的工程里，把本仓库的 `framework/` 资产**实例化**：扫描目录与特征文件 → 与用户逐项确认项目元数据、架构 DSL、adapter 选择 → 在**实例工程根**（不是 `framework/` 内部）写出约定产物，并完成 harness 门禁提示。

**产物一律写在实例工程根**；adapter 只消费 `framework/agents/<name>/` 下的模板，不写回 framework 本体。

## 触发条件

- Slash：`/framework-init`
- 自然语言：「在这个工程里初始化 framework / 把 framework 接入本工程 / 生成 framework.config.json」
- 已有 config 时的升级 / 改架构 / 切换 adapter：`/framework-init`（走 **UPDATE** 模式）

## 核心设计原则（弱模型友好）

1. **先只读探测，再提问**：未读完 [prompts/scan-project.md](prompts/scan-project.md) 所列信号前，不要假定层名。
2. **默认三条路径**：**钱包同款 5 外层预设** / **极简 3 外层示例** / **完全自定义**（问卷见 [prompts/architecture-presets.md](prompts/architecture-presets.md) 与 [templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md)）。
3. **对话式确认**：把扫描推断结果用表格展示，用户对每条给 **确认 / 修改值**；**禁止**在用户未确认前覆盖已有 `framework.config.json`（UPDATE 模式除外，也需显式 diff + 确认）。
4. **adapter 互斥**：一次只激活一个 `agent_adapter`；切换 adapter 时必须先展示「将新增 / 可能冲突的旧文件」清单，得到用户明确同意后再写入（**不自动强删**，删除操作建议用户手工或二次确认执行）。
5. **占位符与模板**：agent 入口文件统一以 [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template) 为源，按 [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) 的 `placeholders` 替换变量；路径类占位符一律用 **POSIX 正斜杠**。
6. **生成后Harness**：引导用户（或你自动执行）跑 `catalog` / `glossary` 两 phase，确认骨架合法。

---

## Step 0. 环境前置检查

### 0.1 `framework/` 是否存在

- 若 `<repo-root>/framework/harness/harness-runner.ts` 不存在 → **停下**，输出：

  > 未找到 `framework/`。请先：`git submodule add <url> framework` 或将 framework 拷贝到工程根下的 `framework/`，再重新执行本 Skill。

### 0.2 判定 CREATE / UPDATE 模式

- **若** `<repo-root>/framework.config.json` **不存在** → **CREATE** 模式。
- **若已存在** → **UPDATE** 模式：必须先 `Read` 完整现有 JSON，后续任何写入前必须展示 **与本次拟定内容的 diff**（键级 / 架构段级均可），用户口头 **`y` 确认**后才可落盘。

---

## Step 1. 只读探测（扫描工程）

按 [prompts/scan-project.md](prompts/scan-project.md) 执行：

| 信号源 | 用途 |
|--------|------|
| `oh-package.json5` / `build-profile.json5` | 项目名推测、`srcPath` 模块列表 |
| 仓库根第一层目录 | 是否出现 `01-Product`、`02-Feature` 等 **五层命名** 或 `entry` / `features` 等扁平模式 |
| `.gitmodules` / `framework/.git` | 是否为 submodule |
| 已有 `doc/architecture.md` | 若存在且详实，可作为 DSL 问卷的预填参考（仍以用户确认准） |

输出一段**人话摘要**给用户（不超过一屏）。

---

## Step 2. 交互确认：项目元数据

逐项询问并给出推荐默认值（用户可直接回「用默认值」）：

| 字段 | 写入位置 | 说明 |
|------|----------|------|
| `project_name` | `framework.config.json` | 默认取 `oh-package.json5` 的 `name`，缺失则目录名 |
| `project_type` | 同上 | 仅 `app` 或 `atomic_service`（现阶段占位，合法但不触发差异化规则；未来差异化路线见 [framework/docs/atomic-service-roadmap.md](../../docs/atomic-service-roadmap.md)） |
| `schema_version` | 同上 | 固定 `"1.0"`，除非未来框架 bump |
| `paths.*` | 同上 | 默认与 [framework/harness/config.ts](../../harness/config.ts) 中 `DEFAULT_PATHS` 一致；若实例已改目录结构，按用户指定覆盖 |

---

## Step 3. 架构 DSL（`architecture` 段）

读 [prompts/architecture-presets.md](prompts/architecture-presets.md)。

1. 若 Step 1 扫描到明显 **5 层 + 数字前缀** 目录结构 → **优先推荐「参考实例 5+4 preset」**（模板片段见 [templates/preset-wallet-5-layer.sample.json](templates/preset-wallet-5-layer.sample.json)），说明可与 `framework/harness/config.ts` 内 `LEGACY_DEFAULT_DSL` 对齐以便回归。
2. 若用户要「简单 App」→ 推荐 **极简 3 外层 preset**（见 [templates/preset-minimal-3-layer.sample.json](templates/preset-minimal-3-layer.sample.json)）。
3. 否则 → 使用 [templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md) 逐项问清：
   - 每个外层的 `id`、`can_depend_on`、`intra_layer_deps`（及 `sublayers` 若需要）
   - `module_inner_layers` 数组顺序（**顺序即依赖顺序**，仅支持 `inner_dependency_direction: "upward"`）
   - `cross_module_exports_file`（默认 `Index.ets`）

**生成前强制自检**（不通过则修正后再写文件）：

- `outer_layers[].id` 唯一；`can_depend_on` 只引用已声明的 id；**外层依赖图无环**。
- `intra_layer_deps === "sublayer"` 时 `sublayers` 合法且子层依赖图无环。
- `module_inner_layers` 非空、无重复项。
- `cross_module_exports_file` 非空字符串。

（逻辑与 [framework/harness/config.ts](../../harness/config.ts) `validateArchitectureDsl` 一致。）

---

## Step 4. 选择 agent adapter

按 [prompts/adapter-selection.md](prompts/adapter-selection.md)：

1. 列出 `framework/agents/*/adapter.yaml` 中已实现的 `adapter_name` + `description`。
2. 用户选择一个 → 写入 `framework.config.json` 的 `agent_adapter` 字段。
3. **不得**同时生成两套入口文件（例如同时写 `CLAUDE.md` 与一份冲突的 `AGENTS.md` 同名模板变体）；以选中 adapter 的 `agent_entry_file.target_path` 为准。

| adapter | 入口文件 | 典型额外产物 |
|---------|----------|----------------|
| `generic` | `AGENTS.md` | 无 |
| `claude` | `CLAUDE.md` | `.claude/commands/*.md`、`.claude/agents/verifier.md` |
| `cursor` | `AGENTS.md` | `.cursor/skills/<skill>/SKILL.md`、`.cursor/rules/*.mdc` |

落地方式：**从对应 adapter 的 `templates/` 目录拷贝到实例根**，若存在 `commands` / `skill_bridge` / `rules` / `subagents`，按该 adapter 的 `adapter.yaml` 中 **相对 adapter 目录** 的 `template_dir` → **相对实例根** 的 `target_dir` 原样复制（保持相对路径引用 `../../framework/skills/...` 与现有一致）。

### 4.1 渲染 `AGENTS.md` / `CLAUDE.md`

1. 读取 [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template)。
2. 替换下列占位符（与 `adapter-schema.yaml` 对齐）：

| 占位符 | 含义 |
|--------|------|
| `{{AGENT_ENTRY_FILE}}` | 展示用文件名，如 `CLAUDE.md` 或 `AGENTS.md` |
| `{{PROJECT_NAME}}` | 项目名 |
| `{{PROJECT_TYPE}}` | `app` / `atomic_service` |
| `{{PROJECT_TYPE_LABEL}}` | 展示文案，按 `project_type` 映射：`app` → `应用工程`；`atomic_service` → `元服务工程`。若未来新增 `project_type` 值，此处同步追加映射 |
| `{{AGENT_ADAPTER}}` | 所选 adapter 名 |
| `{{ARCHITECTURE_SUMMARY}}` | 一句话，如：「5 个外层（01-Product…05-SystemBase），模块内 4 层 shared→presentation，跨模块出口 Index.ets」 |
| `{{ARCHITECTURE_MD_PATH}}` | 来自 `paths.architecture_md` |
| `{{MODULE_CATALOG_PATH}}` | `paths.module_catalog` |
| `{{GLOSSARY_PATH}}` | `paths.glossary` |
| `{{FEATURES_DIR}}` | `paths.features_dir`（阶段 9 合并前为 `feature_docs_dir` + `feature_specs_dir` 两字段） |

3. 写入路径 = 所选 adapter 的 `agent_entry_file.target_path`（实例根相对路径）。

---

## Step 5. 生成目录与文档骨架

### 5.1 `framework.config.json`

- 将 Step 2～4 汇总的 JSON **格式化（2 空格缩进）** 写入实例根。
- **CREATE** 模式：首次创建。
- **UPDATE** 模式：仅在被用户确认 diff 后覆盖。

### 5.2 `doc/architecture.md`（或 `paths.architecture_md` 指向的路径）

- 以 [templates/architecture.md.skeleton.md](templates/architecture.md.skeleton.md) 为起点，替换占位符：
  - `{{PROJECT_NAME}}` → 与 `project_name` 一致
  - `{{MODULE_INNER_LAYERS_CSV}}` → `module_inner_layers` 用英文逗号 + 空格连接（例：`shared, data, domain, presentation`）
  - `{{CROSS_MODULE_EXPORTS_FILE}}` → `architecture.cross_module_exports_file`
- 再补充：
  - `framework.config.json` 路径说明（相对仓库根）
  - 基于当前 DSL 的 **Mermaid 外层依赖示意**（可只画层间关系，不必填满业务模块）
  - **层间依赖表**可逐行根据 `outer_layers` 自动生成
  - 顶部注明：基于 framework 模板生成，后续随需求迭代更新

### 5.3 `module-catalog.yaml` / `glossary.yaml` / `glossary-seed.txt`

**与 Skill 0 Step 0 骨架对齐**（内容不得编造业务模块 / 术语）：

- **module-catalog.yaml**：仅

```yaml
schema_version: "1.0"
modules: []
```

- **glossary.yaml**：仅

```yaml
schema_version: "1.0"
terms: []
```

（注释头可与 Skill 0 一致，便于后续 `catalog-bootstrap` / `glossary-bootstrap`。）

- **glossary-seed.txt**：使用 [templates/glossary-seed.skeleton.txt](templates/glossary-seed.skeleton.txt)（含用法说明注释；无真实业务词时可只保留注释）。

以上路径一律取 `framework.config.json` 的 `paths` 字段解析结果。

### 5.4 功能目录

创建 `paths.features_dir`（默认 `doc/features`）。每个 feature 一个子目录，扁平归档 PRD.md / design.md / contracts.yaml / acceptance.yaml / boundaries.yaml / review-report.md / test-plan.md / test-report.md 等全部产物。若仓库需要被 git 跟踪空目录，可在该目录下放一个 `.gitkeep`（**不要**编造示例 feature 内容）。

---

## Step 6. Harness 验证（初始化完成门禁）

在实例工程根执行（**无 `--feature`**）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase catalog
cd framework/harness && npx ts-node harness-runner.ts --phase glossary
```

- 期望：骨架下多为 **WARN**（空 catalog / 空 glossary），不应有 **BLOCKER** 级结构错误。
- 若 FAIL：根据报告逐项修正 `framework.config.json` 或 YAML，**不要**为通过校验而删减 `schema_version` 等必填字段。

---

## Step 7. 收尾：下一步指引

向用户固定输出以下指引（可精简不可省略意图）：

1. 为已有模块跑 Skill 0：`/catalog-bootstrap <ModuleName>`，直至 catalog 覆盖主要模块。
2. 跑 `/glossary-bootstrap` 建立术语表。
3. 再进入 `/prd-design`（Skill 1）及后续阶段。

---

## UPDATE 模式补充

1. **改 DSL**：重新执行 Step 3，展示 `architecture` 段 **diff**，强调 `check-coding` / `check-catalog` 等行为将随 DSL 变化；用户 **`y`** 后写入。
2. **切换 `agent_adapter`**：
   - 列出旧 adapter 特有文件（如 `.claude/commands/` vs `.cursor/skills/`）；
   - 建议用户手动删除冲突旧文件或备份后覆盖；
   - 再按新 adapter 拷贝模板。
3. **禁止静默扩大 scope**：不要顺带修改 `doc/features` 下已有业务文档，除非用户明确要求。

---

## 阻塞与上报（BLOCKER）

- 无法形成满足 `validateArchitectureDsl` 的 DSL → **不得**写入；继续与用户迭代问卷。
- 探测不到 `framework/` → **不得**生成假 framework；停下并指引 submodule。
- 用户拒绝确认 diff（UPDATE）→ **不得**覆盖 `framework.config.json`。

---

## 关联文件

| 类型 | 路径 |
|------|------|
| Adapter 协议 | [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) |
| generic / claude / cursor | [generic](../../agents/generic)、[claude](../../agents/claude)、[cursor](../../agents/cursor) |
| 共享 AGENTS 模板 | [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template) |
| Config 与 DSL 校验 | [framework/harness/config.ts](../../harness/config.ts) |
| 扫描 prompt | [prompts/scan-project.md](prompts/scan-project.md) |
| 预设与问卷 | [prompts/architecture-presets.md](prompts/architecture-presets.md)、[templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md) |

---

## Claude Code CLI / 自动化备注

通过 `/framework-init` 进入时，若用户需要交付 trace，路径与字段见 [framework/harness/trace/trace.schema.json](../../harness/trace/trace.schema.json)；phase 可记为 `framework-init` 或项目约定的 `catalog` 前置步骤。

**中文输出。**
