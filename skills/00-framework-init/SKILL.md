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
6. **生成后 Harness**：在 Step 5.5.4 `npm test` 全绿后，在 Step 6 自动跑全局 phase：`catalog` / `glossary` / **`docs`（v2.4 起，framework 对外文档与清单自检）**。

---

## Step 0. 环境前置检查

### 0.1 `framework/` 是否存在

- 若 `<repo-root>/framework/harness/harness-runner.ts` 不存在 → **停下**，输出：

  > 未找到 `framework/`。请先：`git submodule add <url> framework` 或将 framework 拷贝到工程根下的 `framework/`，再重新执行本 Skill。

### 0.2 判定 CREATE / UPDATE 模式

- **若** `<repo-root>/framework.config.json` **不存在** → **CREATE** 模式（预期整工程干净，所有产物均为 MISSING）。
- **若已存在** → **UPDATE** 模式（framework 升级 / 改架构 / 切 adapter 时重跑）。

**无论哪种模式，Step 0.3 的存在性体检都必须执行**：这是本 Skill 唯一能区分"首次落地"与"用户已长期使用的工程"的入口，任何写入都必须以体检结果为依据。

### 0.2.5 显式选定 `agent_adapter`（BLOCKER，所有后续步骤前置）

> **动机**：Step 0.3 体检表第 2、3 项分别扫描「**所选** adapter 的入口文件（`AGENTS.md` / `CLAUDE.md`）」与「**所选** adapter `templates/` 下的逐个文件」。**没选定 adapter，这两行根本填不出来**，CREATE→UPDATE 降级提示里「将动到哪些文件」的措辞也会失真（把 `CLAUDE.md` 当 `AGENTS.md`、把 `.claude/` 当 `.cursor/` 之类）。因此本 Skill 要求：**adapter 选定必须完成在 Step 0.3 之前**。

按 [prompts/adapter-selection.md](prompts/adapter-selection.md) 执行：

1. 列出 `framework/agents/*/adapter.yaml` 中已实现的 `adapter_name` + `description`，给出**推荐值**（依据 `adapter-selection.md` 的「默认建议逻辑」，例如仓库已有 `.cursor/` 或 `.claude/` 痕迹）。推荐值仅供参考，**不得**直接当成用户选择。
2. **BLOCKER — 强制等待显式选定**：必须收到用户**具体 `adapter_name` 字符串**（例如「用 cursor」「选 generic」，仅仅回复「好」「继续」「ok」不构成选定）。在选定完成前，**严禁**：
   - 进入 Step 0.3（体检表第 2、3 项依赖已选 adapter）；
   - 在任何问题、diff、降级提示里写入具体的入口文件名或 adapter 目录名（`AGENTS.md` / `CLAUDE.md` / `.cursor/` / `.claude/`）；必要时用**占位措辞**（例如「所选 adapter 的入口文件」）。
   - 写入 / 更新 `framework.config.json` 的 `agent_adapter` 字段、拷贝任何 `framework/agents/<name>/templates/**` 下的文件、渲染任何入口文件。
3. 即便从 IDE 环境、聊天上下文、已有 `.claude/` / `.cursor/` 目录等线索能「推断」出最可能的选项，也**必须**把推断作为**推荐值**亮给用户，由用户确认为「选定」；不得直接当成用户决定落盘或拿来描述后续动作。
4. 选定完成后，内存里记录 `agent_adapter`，用于驱动 Step 0.3 的路径扫描与 Step 4.1 的入口文件渲染；`framework.config.json` 的实际写入仍发生在 Step 5.1，按 Step 0.3 体检结果执行。

### 0.3 产物存在性体检（写入前必做，CREATE / UPDATE 共享）

> 动机：`/framework-init` 常常是**升级重跑**——用户已积累 `doc/module-catalog.yaml` / `doc/glossary.yaml` / `doc/architecture.md` / `doc/features/**` 等资产，甚至在 `CLAUDE.md` / `AGENTS.md` 里补过项目指令。**盲目覆盖就是毁资产**。本步把所有待写路径前置扫一遍，按固定策略矩阵给出动作，**不允许 AI 临场发挥**。

#### 0.3.1 体检清单（固定 9 项，按路径顺序扫）

所有路径均相对**实例工程根**；多数路径须先从 `framework.config.json`（若存在）的 `paths` 字段解析，UPDATE 模式优先读实例工程的配置，CREATE 模式以 `framework/harness/config.ts` `DEFAULT_PATHS` 为准。

**前置依赖（BLOCKER）**：第 2、3 项的目标路径来自 **Step 0.2.5** 已选定的 `agent_adapter`（`agent_entry_file.target_path`、adapter `templates/` 下待拷贝文件）。若 Step 0.2.5 尚未完成，**不得**进入本节；体检表也不得用具体文件名硬编码占位（严禁「反正大多数工程是 cursor，就先按 `AGENTS.md` 体检」这类行为）。

| # | 路径 | 档位分类依据 |
|---|------|--------------|
| 1 | `framework.config.json` | 解析成功且 `architecture.outer_layers.length > 0` → POPULATED；`=== 0` → EMPTY；文件不存在 → MISSING（**单独再判第 10 项 toolchain 段**） |
| 2 | 所选 adapter 的 `agent_entry_file.target_path`（`AGENTS.md` 或 `CLAUDE.md`） | 与 `framework/templates/AGENTS.md.template` **按当前 DSL 渲染出的骨架**字节相等 → EMPTY；否则 POPULATED；不存在 → MISSING |
| 3 | 所选 adapter `templates/` 下每一个会被拷贝的文件（`.claude/**` / `.cursor/**`） | 与源模板字节相等 → EMPTY；否则 POPULATED；不存在 → MISSING（**逐文件**判定，不按目录整体） |
| 4 | `paths.architecture_md`（默认 `doc/architecture.md`） | 与 `templates/architecture.md.skeleton.md` 渲染后字节相等 → EMPTY；否则 POPULATED |
| 5 | `paths.module_catalog`（默认 `doc/module-catalog.yaml`） | YAML 解析后 `modules` 数组 `=== 0` → EMPTY；否则 POPULATED |
| 6 | `paths.glossary`（默认 `doc/glossary.yaml`） | YAML 解析后 `terms` 数组 `=== 0` → EMPTY；否则 POPULATED |
| 7 | `paths.glossary_seed`（默认 `doc/glossary-seed.txt`） | 与 `templates/glossary-seed.skeleton.txt` 字节相等 → EMPTY；否则 POPULATED |
| 8 | `paths.features_dir`（默认 `doc/features`） | 目录不存在 → MISSING；存在但空目录 / 只含 `.gitkeep` → EMPTY；有任何子目录或文件 → POPULATED |
| 9 | `framework/harness/node_modules/ts-node/package.json` | 存在 → POPULATED；不存在 → MISSING（EMPTY 不适用） |
| 10 | `framework.config.json` 的 `toolchain.devEcoStudio.installPath` | 字段存在且非空字符串且路径在文件系统中存在 → POPULATED；字段缺失 / 空串 / 路径不存在 → MISSING（v2.3 起 `coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test` 三条 BLOCKER 规则均依赖该字段） |

#### 0.3.2 策略矩阵（**不许偏离**）

| # | 路径 | MISSING 动作 | EMPTY 动作 | POPULATED 动作 |
|---|------|------|------|------|
| 1 | `framework.config.json` | 走 Step 5.1 直接写 | 等同 MISSING | **Step 5.1 前 diff + 用户 `y` 确认**，整文件替换 |
| 2 | agent 入口文件 | 走 Step 4.1 直接写 | 等同 MISSING | **diff + 用户 `y`**，整文件替换 |
| 3 | adapter 目录下每个文件 | 直接拷贝 | 等同 MISSING | **逐文件 diff + 用户 `y`**；**用户自建、在源模板中不存在的额外文件一律保留** |
| 4 | `doc/architecture.md` | 走 Step 5.2 写骨架 | 等同 MISSING | **默认跳过**；向用户打印："`doc/architecture.md` 已被你迭代过，本 Skill 不会自动重置。如需回到骨架重新生成，请手动删除该文件后再重跑 `/framework-init`。" |
| 5 | `doc/module-catalog.yaml` | 写空骨架（`modules: []`） | 保留原骨架，不动 | **永不覆盖**；打印："`doc/module-catalog.yaml` 属于 `catalog-bootstrap` 持续积累的数据资产，本 Skill 不会修改。" |
| 6 | `doc/glossary.yaml` | 写空骨架（`terms: []`） | 保留原骨架 | **永不覆盖**；打印："`doc/glossary.yaml` 属于 `glossary-bootstrap` 积累资产，本 Skill 不会修改。" |
| 7 | `doc/glossary-seed.txt` | 写骨架 | 保留 | **默认跳过**；打印："`doc/glossary-seed.txt` 已被编辑，保留原文。" |
| 8 | `paths.features_dir` | 创建空目录 + 可选 `.gitkeep` | 保留 | **不进入、不扫描、不比对**；打印："`<features_dir>` 下已有业务 feature 产物，本 Skill 不会触碰其中任何文件。" |
| 9 | `framework/harness/node_modules` | Step 5.5 执行 `npm install` | 不适用 | Step 5.5 幂等跳过 |
| 10 | `toolchain.devEcoStudio.installPath` | 走 Step 5.6 探测并写入 | 等同 MISSING | **Step 5.6 跳过**；如需重置请用户手工编辑 `framework.config.json` 后再重跑 |

**共性纪律**：

- 所有 `POPULATED` 档位的决策全部在 **Step 0.3 阶段一次性展示完体检表**给用户看，随后 Step 5 的各小节**只执行**体检表已决定的动作；不得在 Step 5 里重新询问或翻盘。
- 用户对第 1/2/3 类的 diff 给出 `n`（拒绝） → 该项跳过写入，**不**中断整体流程，不强制回滚其它已完成项；但必须在 Step 7 的收尾指引里明确列出被跳过项。
- 任何策略里标注 "不会覆盖 / 不会修改 / 不会触碰" 的项，**即使用户口头要求**本 Skill 也不处理；请引导用户走 `catalog-bootstrap` / `glossary-bootstrap` / 手工删除后重跑等既定路径。

#### 0.3.3 汇报表与 CREATE 强制降级

先向用户**完整打印**下面这张表（没有发现的 MISSING 行也要列，便于用户全貌理解），再继续 Step 1。**表内第 2、3 行的具体文件名必须基于 Step 0.2.5 已选定的 `agent_adapter` 渲染**（例：`cursor` → `AGENTS.md` + `.cursor/**`；`claude` → `CLAUDE.md` + `.claude/**`；`generic` → `AGENTS.md` + 无 adapter 目录），不得写两个候选名一起糊弄：

```text
产物                                          状态         计划动作
---------------------------------------------------------------------
framework.config.json                         <档位>       <策略>
<agent_entry_file.target_path>                <档位>       <策略>
<adapter templates 下各文件>                   <档位/逐项>  <策略>
doc/architecture.md                           <档位>       <策略>
doc/module-catalog.yaml                       <档位>       <策略>
doc/glossary.yaml                             <档位>       <策略>
doc/glossary-seed.txt                         <档位>       <策略>
doc/features/                                 <档位>       <策略>
framework/harness/node_modules/               <档位>       <策略>
toolchain.devEcoStudio.installPath            <档位>       <策略>
```

**CREATE → UPDATE 强制降级**：

若当前标记为 CREATE 模式，但体检中**除第 8 项外**任何一行出现 `POPULATED`，AI 必须停下并打印（**文案中列出的遗留文件名必须按 Step 0.2.5 选定 adapter 渲染**，不允许同时出现 `CLAUDE.md / AGENTS.md` 这种「二选一」措辞）：

> 当前无 `framework.config.json`，按 Step 0.2 判定为 CREATE，但上述体检发现工程中已存在既往初始化产物（例如 `<entry-file>`、`doc/architecture.md`、`doc/module-catalog.yaml`）。本 Skill 将**强制降级为 UPDATE 模式**：对所有 POPULATED 项一律走 diff + 你口头 `y` 的流程，绝不盲目覆盖。继续？(y/N)

用户 `y` → 模式切为 UPDATE，继续；`N` 或无响应 → 终止本次 `/framework-init`，让用户排查遗留文件后再重跑。

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

### Step 3.x. 同层策略逐层确认（BLOCKER，所有路径共用）

无论走选项 A / B / C，在写入 `framework.config.json.architecture` **之前**，必须完成以下动作：

1. 使用 [templates/intra-layer-deps-confirm.template.md](templates/intra-layer-deps-confirm.template.md) 渲染一份「外层 × `intra_layer_deps`」确认表，把当前候选值（preset 默认或问卷答复）填进「当前值」列并展示给用户。
2. 明确提示：**默认值只是推荐**（尤其钱包 preset 的 `forbid` 是「逼横向协作下沉」的设计选择，**不是**「架构禁止同层互依赖」这种唯一答案）；`forbid` / `dag` / `sublayer` 三者语义见 [framework/harness/config.ts](../../harness/config.ts) 的 `IntraLayerDepsMode` 说明。
3. 用户**必须逐行**给出显式回复：`按默认` / `改为 dag` / `改为 forbid` / `改为 sublayer(+ 子层)`。**笼统的「好」「继续」「行」不构成逐层确认**；只要有任一行没有显式回复，就继续追问，不得落盘。
4. 收到全部回复后，再依 Step 3 生成前强制自检（见下节）写入 `framework.config.json`。

> 与 Step 4「adapter 选择 BLOCKER」对称：架构守门有三件事必须显式确认——① adapter；② **每层 `intra_layer_deps`**；③ DSL 自检通过。

**生成前强制自检**（不通过则修正后再写文件）：

- `outer_layers[].id` 唯一；`can_depend_on` 只引用已声明的 id；**外层依赖图无环**。
- `intra_layer_deps === "sublayer"` 时 `sublayers` 合法且子层依赖图无环。
- `module_inner_layers` 非空、无重复项。
- `cross_module_exports_file` 非空字符串。
- **每一个 `outer_layers[*].intra_layer_deps` 的取值都能在本次对话里追溯到用户的显式回复记录**（「按默认」视作显式回复；AI 静默采纳 preset 默认不视作显式回复）。

（前四条逻辑与 [framework/harness/config.ts](../../harness/config.ts) `validateArchitectureDsl` 一致；第五条由本 Skill 在 Step 3.x 自己把关，`validateArchitectureDsl` 不检查对话记录。）

---

## Step 4. agent adapter 产物落地

> **前置**：adapter 的**选定动作**已在 **Step 0.2.5** 完成，**本 Step 不再发起任何关于 `agent_adapter` 的选择问题**。这里只负责把 Step 0.2.5 选定的 adapter 对应的模板拷贝到实例根，并渲染入口文件。

**BLOCKER**：若本 Step 检测到「`agent_adapter` 未在本次对话中由 Step 0.2.5 显式选定」（例如体检阶段被跳过、内存里没有 `agent_adapter` 值），**立即停下回到 Step 0.2.5**，不得在本 Step 重新推断或兜底默认。

| adapter | 入口文件 | 典型额外产物 |
|---------|----------|----------------|
| `generic` | `AGENTS.md` | 无 |
| `claude` | `CLAUDE.md` | `.claude/commands/*.md`、`.claude/agents/verifier.md` |
| `cursor` | `AGENTS.md` | `.cursor/skills/<skill>/SKILL.md`、`.cursor/rules/*.mdc` |

落地方式：**从对应 adapter 的 `templates/` 目录拷贝到实例根**，若存在 `commands` / `skill_bridge` / `rules` / `subagents`，按该 adapter 的 `adapter.yaml` 中 **相对 adapter 目录** 的 `template_dir` → **相对实例根** 的 `target_dir` 原样复制（保持相对路径引用 `../../framework/skills/...` 与现有一致）。

**逐文件按 Step 0.3 第 3 项体检结果执行**：MISSING / EMPTY 直拷；POPULATED 展示 diff + 用户 `y` 后单文件替换；源模板中不存在但目标目录已有的用户自建文件**一律保留**。

**不得**同时生成两套入口文件（例如同时写 `CLAUDE.md` 与一份冲突的 `AGENTS.md` 同名模板变体）；以 Step 0.2.5 选中 adapter 的 `agent_entry_file.target_path` 为准。切换 adapter 重跑时，**旧 adapter 的既有产物不由本 Skill 自动删除**，由用户自行清理（在 Step 7 收尾时打印提示）。

### 4.1 渲染 `AGENTS.md` / `CLAUDE.md`

**按 Step 0.3 体检结果执行**：第 2 项为 MISSING / EMPTY 时直接写；POPULATED 时必须先展示新旧内容 diff，用户 `y` 才写入；否则跳过。

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

> 本步骤的每一小节**仅执行** Step 0.3 体检表已决定的动作；不得在这里重新判断是否覆盖，也不得向用户二次询问。

### 5.1 `framework.config.json`

**按 Step 0.3 第 1 项体检结果执行**：

- `MISSING` / `EMPTY`：将 Step 2～4 汇总的 JSON **格式化（2 空格缩进）** 写入实例根。
- `POPULATED`：必须已经在 Step 0.3 汇报表阶段展示过 diff 并得到用户 `y`，此处才覆盖；用户 `n` → 跳过，**不得**中断整体流程。

### 5.2 `doc/architecture.md`（或 `paths.architecture_md` 指向的路径）

**按 Step 0.3 第 4 项体检结果执行**：

- `MISSING` / `EMPTY`：以 [templates/architecture.md.skeleton.md](templates/architecture.md.skeleton.md) 为起点生成（见下方渲染步骤）。
- `POPULATED`：**默认跳过**，不展示 diff、不提议覆盖；本 Skill 不替用户决定是否重置他手工迭代过的架构文档。

MISSING / EMPTY 时的渲染步骤：

- 替换占位符：
  - `{{PROJECT_NAME}}` → 与 `project_name` 一致
  - `{{MODULE_INNER_LAYERS_CSV}}` → `module_inner_layers` 用英文逗号 + 空格连接（例：`shared, data, domain, presentation`）
  - `{{CROSS_MODULE_EXPORTS_FILE}}` → `architecture.cross_module_exports_file`
- 再补充：
  - `framework.config.json` 路径说明（相对仓库根）
  - 基于当前 DSL 的 **Mermaid 外层依赖示意**（可只画层间关系，不必填满业务模块）
  - **层间依赖表**可逐行根据 `outer_layers` 自动生成
  - 顶部注明：基于 framework 模板生成，后续随需求迭代更新

### 5.3 `module-catalog.yaml` / `glossary.yaml` / `glossary-seed.txt`

**按 Step 0.3 第 5/6/7 项体检结果执行**：

- `module-catalog.yaml`：`MISSING` 写空骨架；`EMPTY` / `POPULATED` **不动**（POPULATED 属 `catalog-bootstrap` 积累资产，绝不覆盖）。
- `glossary.yaml`：同上规则（POPULATED 属 `glossary-bootstrap` 积累资产）。
- `glossary-seed.txt`：`MISSING` 写骨架；`EMPTY` / `POPULATED` **不动**。

骨架内容（仅 MISSING 档位使用）：

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

**按 Step 0.3 第 8 项体检结果执行**：

- `MISSING`：创建 `paths.features_dir`（默认 `doc/features`）空目录；若仓库需要被 git 跟踪空目录，可在该目录下放一个 `.gitkeep`。
- `EMPTY`：保留现状。
- `POPULATED`：**不进入、不扫描、不比对**该目录下任何内容；本 Skill 绝不触碰业务 feature 资产。

`doc/features/` 的使用约定（仅作提示，不由本 Skill 生成）：每个 feature 一个子目录，扁平归档 PRD.md / design.md / contracts.yaml / acceptance.yaml / boundaries.yaml / review-report.md / test-plan.md / test-report.md 等全部产物。**不要**编造示例 feature 内容。

---

## Step 5.5. 安装 harness 本地依赖（Step 6 前置）

Step 6 会调用 `framework/harness/harness-runner.ts`，依赖 `ts-node` / `yaml` 等 npm 包。`framework/harness/node_modules/` 与 `package-lock.json` 均已被 `.gitignore` 排除（**内网 registry URL 与外网不同，lock 文件不适合随框架分发**），新克隆的工程此处**必无** `node_modules`，若直接跑 Step 6 会以 `Cannot find module 'ts-node'` / `'yaml'` 失败。由本 Skill 在此统一解决。

### 5.5.1 幂等检测

- 若 `<repo-root>/framework/harness/node_modules/ts-node/package.json` 存在 → **跳过** 5.5.2（不重复 `npm install`），**仍须**执行 5.5.4 自检与 Step 5.6 / Step 6，**不得**从本节直接进入 Step 6 而绕过 5.5.4。
- 否则继续 5.5.2。

### 5.5.2 在 `framework/harness/` 内执行 `npm install`

- 运行目录**必须**是 `<repo-root>/framework/harness/`；**不要**把 npm 依赖污染到实例工程根或 `framework/` 根。
- 命令示例（PowerShell / bash 通用）：`cd framework/harness && npm install`。
- **不得**传 `--registry` 参数、**不得**生成 `.npmrc`：尊重用户本地镜像配置（内网用户通常在 `~/.npmrc` 或企业镜像里已配好；外网用户走默认 registry）。
- 首次安装视网络耗时 30s - 2min，AI 执行时请设置对应等待窗口。

### 5.5.3 失败处理

若 `npm install` 非零退出：**停下**，向用户报以下三点排查清单（**不要**擅自改 registry / 关 integrity 校验）：

1. `npm config get registry` 输出的 URL 在当前网络是否可达？（内网用户确认镜像 URL 正确）
2. 是否处于代理后？`HTTP_PROXY` / `HTTPS_PROXY` 环境变量是否设置正确？
3. `node --version` ≥ 18？`npm --version` 与 `node` 版本匹配？

用户修好环境后重跑 5.5.2；安装成功前**不要**进入 5.5.4 / Step 5.6 / Step 6。

> 关于鸿蒙侧依赖：`ohpm install`（`oh_modules/`）是实例工程自身 ArkTS 代码的依赖，由 DevEco / Skill 3 编码阶段负责触发，**与本 Skill 无关**，这里不代管。

### 5.5.4 自检：跑 framework 自带回归测试套件（Step 5.6 / Step 6 前置 BLOCKER）

> **动机**：vendor 模式下，用户把 `framework/` 整目录从源仓库同步到目标工程时**可能漏文件**（rsync exclude 配错、zip 解包不完整、git 浅克隆等）。如果直接进 Step 6（catalog / glossary / docs 校验）只能间接发现 framework 损坏（表现为 `Cannot find module` 或某条规则莫名 throw），定位非常慢。本节用 framework 自带的 `tests/` 套件做**整体性自检**，把"framework 文件健康度"和"业务工程配置健康度"解耦：前者由本节兜底，后者由 Step 6 兜底。

#### 5.5.4.1 执行

`npm install` 成功后，**强制**在 `<repo-root>/framework/harness/` 执行：

```bash
cd framework/harness && npm test
```

期望：unit + fixture 全绿（v2.4 起为 33 unit + 9 fixture = **42 PASS / 0 FAIL**；`doc-freshness` 等 suite 的条数以 `framework/harness/tests/run-unit.ts` 的 `SUITES` 与 `framework/harness/tests/run-tests.ts` 为准，整体耗时约 30s 量级）。

> 该套件**不依赖**真机 / DevEco / hvigor / hdc，纯逻辑 fixture + 纯函数 unit，新工程未配 `toolchain.devEcoStudio.installPath` 也能立即跑通。所以**不允许**以"还没配工具链"为理由跳过本节。

#### 5.5.4.2 失败处理

若 `npm test` 任一用例失败：**停下**，按以下顺序排查；**严禁**用 `--filter` 缩小集合后报 PASS、**严禁**在用户没看完失败列表前继续 Step 5.6：

1. **fixture 失败**且失败信息含 `ENOENT` / `找不到文件` / `Cannot find module` → 大概率是 framework vendor 不完整。比对源仓库的 `framework/` 全树（重点 `harness/scripts/` / `harness/tests/fixtures/` / `templates/` / `agents/`），重新同步缺失文件后重跑 5.5.4.1。
2. **unit 失败**（`hdc-runner.unit.test`） → 通常意味着 framework 维护者升级了 `hdc-runner.ts` 但忘改 unit 期望值，**这是 framework 自身 bug**。把失败用例名 + 错误信息原文反馈给 framework 维护者；本次 `/framework-init` **暂停**，待 framework 修复后重跑。
3. **node 版本不对** / **ts-node 报语法错** → `node --version` 必须 ≥ 18；若版本对但 ts-node 报 "Unexpected token"，检查 `framework/harness/node_modules/typescript/package.json` 中的 `version` 是否 ≥ 5.0。
4. **git fixture 失败**（fixture runner 报 `not a git repository` / `git: command not found`） → 检查 `git --version`、PATH 是否包含 git；fixture runner 内部会做 `git init + commit baseline`，本应不依赖目标工程是不是 git 仓库。

修复后**重跑** `npm test` 直至全绿，再进入 Step 5.6。

#### 5.5.4.3 严禁的偷懒行为

- 把 5.5.4.1 的 FAIL 解释为"环境问题"而跳过——framework 自带套件**故意不依赖任何外部工具链**，没有合理的"环境失败"。
- 用 `npm test -- --filter <某子集>` 把失败用例排除在外，凑出 PASS 上交。
- 把"我装好了 node_modules"等同于"自检通过"——Step 0.3 第 9 项体检只验证依赖是否在，**不验证依赖能否正确执行**，这一节才是后者。

---

## Step 5.6. DevEco Studio 工具链路径配置（Step 6 前置 + 阶段 3/5 真机闭环前置）

> **背景**：自 framework v2.3 起，编码阶段 (`coding_hvigor_build`) 与业务级 UT 阶段 (`ut_hvigor_build` / `ut_hvigor_test`) 引入了三条 BLOCKER 规则，**强依赖** DevEco Studio 自带的 hvigor / sdk / jbr 工具链。**现代 DevEco Studio (≥ 5.0) 不再在工程根生成 `hvigorw.bat` 包装脚本**，统一从安装目录调用，因此 framework 必须知道 DevEco 装在哪里。
>
> 本步骤的目标只有一个：在 `framework.config.json` 写入合法的 `toolchain.devEcoStudio.installPath`，使后续 `coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test` 不会因"找不到 hvigor"而 BLOCKER FAIL。

### 5.6.1 幂等检测

**按 Step 0.3 第 10 项体检结果执行**：

- `POPULATED`（已有 installPath 且文件系统存在）→ **跳过本节**，直接进入 Step 6。
- `MISSING` / `EMPTY` → 继续 5.6.2。

### 5.6.2 自动探测候选路径

执行：

```bash
npx ts-node framework/harness/scripts/detect-deveco.ts --json
```

`detect-deveco.ts` 会按平台扫描常见安装位置（Windows：`D:/Program Files/Huawei/DevEco Studio` 等 7 个；macOS：`/Applications/DevEco-Studio.app/Contents` 等；Linux：`/opt/deveco-studio` 等），对每个候选验证 `tools/hvigor/bin/hvigorw[.bat]` / `sdk/` / `jbr/bin/java[.exe]` 三个关键子目录是否齐全。

输出 JSON 形态：

```json
{
  "recommended": {
    "status": "ok",
    "source": "scan",
    "installPath": "D:/Program Files/Huawei/DevEco Studio",
    "hvigorBin": "...hvigorw.bat",
    "sdkHome": "...sdk",
    "jbrHome": "...jbr",
    "missing": []
  },
  "candidates": [ ... ]
}
```

### 5.6.3 用户确认（**BLOCKER**）

按探测结果分三种情况，**严禁未经用户显式回复就落盘 `installPath`**（与 Step 0.2.5 / Step 3.x 同等纪律）：

1. **recommended.status === 'ok'**：
   把 `recommended.installPath` 作为**推荐值**展示给用户，并提示一句：
   > 已探测到 DevEco Studio 在 `<path>`，hvigor / sdk / jbr 子目录齐全。是否使用此路径？(y / 自定义路径 / 跳过)
   - 用户回 `y` → 写入 `framework.config.json > toolchain.devEcoStudio.installPath = <path>`。
   - 用户回**自定义路径字符串** → 用 `npx ts-node framework/harness/scripts/detect-deveco.ts --path "<user-path>" --json` 验证，命中 `status === 'ok'` 才写入；`incomplete` / `not_found` 把 `missing[]` 列给用户重选。
   - 用户回 `跳过` → 不写入；进入 Step 5.6.4 警示。

2. **recommended 不存在 / status !== 'ok'**：
   把所有 `candidates` 的 `[status] installPath` 列给用户参考，提示：
   > 未在常见路径找到完整的 DevEco Studio 安装。请提供 installPath（DevEco Studio 安装根目录，下面应当能看到 `tools/hvigor` / `sdk` / `jbr` 三个子目录），或回复 `跳过`。
   收到自定义路径后走第 1 种的"自定义路径"分支验证。

3. **不允许 AI 替用户臆测**：即便 IDE 环境变量里有 `DEVECO_STUDIO_HOME` 之类痕迹也只能作为**推荐值**亮给用户，不得直接当作用户决定。这与 Step 0.2.5 选定 `agent_adapter` 的纪律对称。

### 5.6.4 用户选择"跳过"时的警示

若用户明确不想配置（多见于：仅做 PRD/design/glossary 阶段，不准备真机跑 UT），**允许跳过**，但必须打印以下警示到 Step 7 收尾的"被跳过项汇报"中：

```text
toolchain.devEcoStudio.installPath（用户跳过，未配置）
  影响：以下三条 v2.3 BLOCKER 规则将无法通过：
    - coding_hvigor_build（编码阶段必跑 hvigor assembleApp）
    - ut_hvigor_build    （UT 阶段必跑 hvigor genOnDeviceTestHap）
    - ut_hvigor_test     （UT 阶段必跑 hdc install + aa test，需要 DevEco SDK 提供 hdc）
  跑这些阶段前请手工编辑 framework.config.json 补齐 toolchain.devEcoStudio.installPath。
```

### 5.6.5 写入 `framework.config.json` 的 `toolchain` 段

最终落盘形态（与 [framework/harness/config.ts](../../harness/config.ts) `ToolchainConfig` 对齐）：

```json
{
  "toolchain": {
    "devEcoStudio": {
      "installPath": "D:/Program Files/Huawei/DevEco Studio",
      "hvigorBin": ""
    }
  }
}
```

字段说明：

- `installPath`（必填）：DevEco Studio 安装根目录。`hvigor-runner.ts` 会从这里派生 hvigor 路径、`DEVECO_SDK_HOME`、`JAVA_HOME`、JBR `bin` 加 PATH。
- `hvigorBin`（可选）：显式指定 hvigor 可执行文件路径。仅当 DevEco 内部目录结构异于约定（`<installPath>/tools/hvigor/bin/hvigorw[.bat]`）时使用；空串视为不指定。

> 路径分隔符：写入时**统一用 POSIX 正斜杠 `/`**，跨平台 + json 可读。`hvigor-runner.ts` 内部已处理 Windows 反斜杠/带空格路径的 quoting。

---

## Step 6. Harness 验证（初始化完成门禁）

**前置**：Step 5.5 已成功完成（`framework/harness/node_modules/` 存在）。

在实例工程根执行（**无 `--feature`**）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase catalog
cd framework/harness && npx ts-node harness-runner.ts --phase glossary
cd framework/harness && npx ts-node harness-runner.ts --phase docs
```

- **catalog / glossary**：期望骨架下多为 **WARN**（空 catalog / 空 glossary），不应有 **BLOCKER** 级结构错误。
- **docs（v2.4 起）**：检查 `framework/docs/DOC_INVENTORY.yaml` 与已登记的 `framework/docs/**.md` 是否一致、源路径可解析、基于 git 的**文档新鲜度**；规则最高 **MAJOR**（不引入 BLOCKER），但初始化时应力争 **5 项检查全部 PASS**（见 [`framework/docs/operations/harness-runbook.md`](../../docs/operations/harness-runbook.md) §6）。`docs` 依赖本仓库为 git 工作区且可执行 `git`；若用户环境无 git，`doc_freshness` 会 **SKIP** 而非 FAIL，其余结构检查仍应通过。
- 若 FAIL：根据报告逐项修正 `framework.config.json` 或 YAML，**不要**为通过校验而删减 `schema_version` 等必填字段。
- 若报 `Cannot find module` 类错误 → 回到 Step 5.5，确认 `framework/harness/node_modules/` 确实装好。

---

## Step 7. 收尾：下一步指引

**7.1 被跳过项汇报（如有）**

把 Step 0.3 / Step 5 中被判定为"保留 / 默认跳过 / 用户对 diff 回 n"的产物**逐项列出**，例如：

```text
本次初始化跳过以下产物（均未被写入 / 未被覆盖）：
- doc/architecture.md（POPULATED，用户已手工迭代；如需重置请删除后重跑）
- doc/module-catalog.yaml（POPULATED，属 catalog-bootstrap 持续积累资产）
- doc/glossary.yaml（POPULATED，属 glossary-bootstrap 持续积累资产）
- .claude/commands/coding.md（POPULATED，你对 diff 回复了 n）
```

无跳过项时明确打印"本次无跳过项"。

**7.2 下一步指引**（固定输出，可精简不可省略意图）：

1. 为已有模块跑 Skill 0：`/catalog-bootstrap <ModuleName>`，直至 catalog 覆盖主要模块。
2. 跑 `/glossary-bootstrap` 建立术语表。
3. 再进入 `/prd-design`（Skill 1）及后续阶段。

---

## UPDATE 模式补充（体检外的两类动作）

> 「产物是否写 / 如何写」已由 Step 0.3 体检表完全覆盖；本节只补充两件**体检表之外**的、UPDATE 特有的变更语义。

1. **改 DSL**：重新执行 Step 3。DSL 变化的**语义影响**需要显式提醒用户——`check-coding` / `check-catalog` 等 harness 行为会跟着变，既有模块画像的 `allowed_dependencies` 可能突然违规。展示 `architecture` 段 diff 时附带一句"本次变更将影响以下 harness 检查：…"，用户 `y` 后按 Step 5.1 写入。
2. **切换 `agent_adapter`**：用户在 Step 0.2.5 选了与当前 `framework.config.json.agent_adapter` 不同的 adapter 即视为切换。新旧 adapter 的产物路径不同（例 `.claude/` ↔ `.cursor/`）。Step 0.3 体检表**只扫描新 adapter** 的目标路径；旧 adapter 的遗留产物需要在本节**额外列给用户看**（`.claude/commands/*.md` 之类），建议用户手动删除或备份后再继续，**本 Skill 不自动删除其它 adapter 的产物**。

---

## 阻塞与上报（BLOCKER）

- 无法形成满足 `validateArchitectureDsl` 的 DSL → **不得**写入；继续与用户迭代问卷。
- 探测不到 `framework/` → **不得**生成假 framework；停下并指引 submodule。
- **未经用户明确选定 `agent_adapter`（具体 `adapter_name` 字符串）就进入 Step 0.3 体检 / 在降级提示里写入具体入口文件名或 adapter 目录名 / 写入 `framework.config.json.agent_adapter` / 拷贝任何 adapter `templates/` 下的文件 / 渲染 `AGENTS.md` 或 `CLAUDE.md`** → 严禁；adapter 选定必须在 Step 0.2.5 完成，IDE 环境或目录痕迹只能作为**推荐值**亮给用户，不得当成用户决定。
- **Step 0.3 体检表或 CREATE→UPDATE 降级提示中，采用"`CLAUDE.md / AGENTS.md`"这类二选一措辞**（即尚未按 Step 0.2.5 的选定结果渲染到具体文件名） → 严禁，必须回到 Step 0.2.5 让用户显式选定后再打印体检表。
- **未经用户逐层显式确认 `outer_layers[*].intra_layer_deps` 就写入 `framework.config.json.architecture`** → 严禁；preset 默认值（包括钱包 `LEGACY_DEFAULT_DSL`）只能作为**推荐值**展示，必须按 Step 3.x 的确认表逐行拿到「按默认 / 改为 X」的显式回复后才能落盘。
- 用户拒绝确认 diff（POPULATED 项）→ **该项跳过**，**不得**强行覆盖；但允许其它 MISSING / EMPTY 项继续写入，并在 Step 7 如实列出被跳过清单。
- **跳过 Step 0.3 体检直接写入** → 严禁；任何写操作前必须先完成体检并打印汇报表。
- **覆盖 POPULATED 的 `doc/module-catalog.yaml` / `doc/glossary.yaml` / `doc/glossary-seed.txt` / `doc/architecture.md` / `doc/features/**`** → 严禁，无论用户是否要求；这些均属持续积累资产或手工迭代产物，本 Skill 不是它们的维护者，请引导用户走 `catalog-bootstrap` / `glossary-bootstrap` / 手工删除后重跑。
- CREATE 模式体检命中 POPULATED 而用户未同意强制降级为 UPDATE → 终止本次 `/framework-init`。
- Step 5.5 的 `npm install` 失败 → **不得**跳过直接跑 Step 6；**不得**擅自改 registry 或 `.npmrc` 绕过；按 5.5.3 三点让用户排查后重试。
- **Step 5.5.4 的 `npm test` 自检失败而进入 Step 5.6 / Step 6** → 严禁；**不得**用 `--filter` 缩小集合凑 PASS、**不得**把失败解释为"环境问题"绕过（framework 自带套件不依赖任何外部工具链）。失败必须按 5.5.4.2 排查清单一项一项过，全绿后才能继续。
- **未经用户显式确认 `toolchain.devEcoStudio.installPath` 就写入 `framework.config.json`** → 严禁；`detect-deveco.ts` 探测出的 `recommended.installPath` 只能作为**推荐值**，必须按 Step 5.6.3 拿到用户 `y` 或自定义路径回复后才能落盘；用户回 `跳过` 视为显式拒绝，不写入但必须按 5.6.4 列入 Step 7 跳过项汇报。

---

## 关联文件

| 类型 | 路径 |
|------|------|
| Adapter 协议 | [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) |
| generic / claude / cursor | [generic](../../agents/generic)、[claude](../../agents/claude)、[cursor](../../agents/cursor) |
| 共享 AGENTS 模板 | [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template) |
| Config 与 DSL 校验 | [framework/harness/config.ts](../../harness/config.ts) |
| DevEco Studio 路径探测 | [framework/harness/scripts/detect-deveco.ts](../../harness/scripts/detect-deveco.ts) |
| 扫描 prompt | [prompts/scan-project.md](prompts/scan-project.md) |
| 预设与问卷 | [prompts/architecture-presets.md](prompts/architecture-presets.md)、[templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md) |

---

## Claude Code CLI / 自动化备注

通过 `/framework-init` 进入时，若用户需要交付 trace，路径与字段见 [framework/harness/trace/trace.schema.json](../../harness/trace/trace.schema.json)；phase 可记为 `framework-init` 或项目约定的 `catalog` 前置步骤。

**中文输出。**
