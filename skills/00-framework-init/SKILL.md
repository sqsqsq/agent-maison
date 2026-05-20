# Framework 工程初始化 Skill (`00-framework-init`)

## 前置声明

- **本 Skill 是所有其它 Skill（0-catalog-bootstrap～6-device-testing）的前置**：在目标实例工程根生成 `framework.config.json`、由所选 adapter 声明的 **agent 入口文件**（`agent_entry_file.target_path`）、`doc/architecture.md` 与 catalog / glossary 骨架，并可选落地该 adapter 的路由 / 跳板 / 规则文件。
- 执行本 Skill 前，**仓库根下必须已存在 `framework/` 目录**（通常为 `git submodule add …` 引入）。若不存在：只读探测后**停下**，提示用户先完成 submodule 或拷贝，**不要**在实例工程里凭空造一个没有内容的假目录。
- 架构 DSL 的**机器可读契约**写在 `framework.config.json`；运行时校验规则见 [framework/harness/config.ts](../../harness/config.ts)（`validateArchitectureDsl` 会抛错，生成前 AI 必须自检 DAG / 非空内层等元规则）。

## 概述

你是一位**工程架构顾问**（宿主栈与工具链以 `project_profile` 及对应 `framework/profiles/<name>/skills/00-framework-init/profile-addendum.md` 为准）。你的任务是在**已有真实代码树**的工程里，把本仓库的 `framework/` 资产**实例化**：扫描目录与特征文件 → 与用户逐项确认项目元数据、架构 DSL、adapter 选择 → 在**实例工程根**（不是 `framework/` 内部）写出约定产物，并完成 harness 门禁提示。

> **用户确认 UX SSOT**（BLOCKER 确认须 progressive enhancement）：[reference/user-confirmation-ux.md](../reference/user-confirmation-ux.md) · registry：`init.adapter` / `init.populated_diff` / `init.intra_layer_deps` / `init.toolchain_path` 等见 [confirmation-registry.yaml](../reference/confirmation-registry.yaml)。

**产物一律写在实例工程根**；adapter 只消费 `framework/agents/<name>/` 下的模板，不写回 framework 本体。

## 触发条件

- Slash：`/framework-init`
- 自然语言：「在这个工程里初始化 framework / 把 framework 接入本工程 / 生成 framework.config.json」
- 已有 config 时的升级 / 改架构 / 切换 adapter：`/framework-init`（走 **UPDATE** 模式）

## 核心设计原则（弱模型友好）

1. **先只读探测，再提问**：未读完 [prompts/scan-project.md](prompts/scan-project.md) 所列信号前，不要假定层名。
2. **默认三条路径**：**预设 A：五外层架构（与示例工程同款）** / **极简 3 外层示例** / **完全自定义**（问卷见 [prompts/architecture-presets.md](prompts/architecture-presets.md) 与 [templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md)）。
3. **对话式确认**：把扫描推断结果用表格展示，用户对每条给 **确认 / 修改值**；**禁止**在用户未确认前覆盖已有 `framework.config.json`（UPDATE 模式除外，也需显式 diff + 确认）。
4. **adapter 互斥**：一次只激活一个 `agent_adapter`；切换 adapter 时必须先展示「将新增 / 可能冲突的旧文件」清单，得到用户明确同意后再写入（**不自动强删**，删除操作建议用户手工或二次确认执行）。
5. **占位符与模板**：agent 入口文件统一以 [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template) 为源，按 [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) 的 `placeholders` 替换变量；路径类占位符一律用 **POSIX 正斜杠**。
6. **宿主 `.gitignore` 维护**：framework vendor 到真实工程后，会产生 harness 运行产物（`node_modules` / `dist` / `reports` / `trace` / `package-lock.json`）以及 Skill 0 的 staging 草稿目录（`doc/catalog-staging/`、`doc/glossary-staging/`）。本 Skill 必须检查实例工程根 `.gitignore`，缺少上述忽略项时自动补齐；已有等价规则时不重复追加。
7. **生成后 Harness**：在 Step 5.5.4 `npm test` 全绿后，在 Step 6 自动跑全局 phase：`catalog` / `glossary` / **`docs`（v2.4 起，framework 对外文档与清单自检）**。
8. **`project_profile`**：宿主工程的 `project_profile.name`（见 `framework.config.json`）决定 **framework-init 自身的 profile addendum**。执行下文 **Step 0 环境前置检查**与各写入步骤前，须完整阅读 `framework/profiles/<project_profile.name>/skills/00-framework-init/profile-addendum.md`；若配置缺失则以 [framework/harness/config.ts](../../harness/config.ts) 的解析回退为准，仍无对应目录则仅依赖本 SKILL 正文与全局模板路径。
9. **`profile-skill-asset` 占位符**：正文与 `prompts/` 中的 `` `profile-skill-asset:<skill>/<asset_key>` `` 须按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析（**禁止**写死 `framework/profiles/<固定 profile 名>/...` 这类可点击物理路径）。

---

## Step 0. 环境前置检查

> **Shell 中调用 harness 脚本**（含本 Skill 的 `render-agents-md` / `merge-framework-config` 与阶段 Skill 的 `check-receipt`）须遵守 [reference/harness-cli-cwd.md](../reference/harness-cli-cwd.md)。

### 0.1 `framework/` 是否存在

- 若 `<repo-root>/framework/harness/harness-runner.ts` 不存在 → **停下**，输出：

  > 未找到 `framework/`。请先：`git submodule add <url> framework` 或将 framework 拷贝到工程根下的 `framework/`，再重新执行本 Skill。

### 0.2 判定 CREATE / UPDATE 模式

- **若** `<repo-root>/framework.config.json` **不存在** → **CREATE** 模式（预期整工程干净，所有产物均为 MISSING）。
- **若已存在** → **UPDATE** 模式（framework 升级 / 改架构 / 切 adapter 时重跑）。

**无论哪种模式，Step 0.3 的存在性体检都必须执行**：这是本 Skill 唯一能区分"首次落地"与"用户已长期使用的工程"的入口，任何写入都必须以体检结果为依据。

### 0.2.5 显式选定 `agent_adapter`（BLOCKER，所有后续步骤前置）

> **动机**：Step 0.3 体检表第 2、3 项分别扫描「**所选** adapter 的入口文件（`agent_entry_file.target_path`）」与「**所选** adapter `templates/` 将拷贝到实例根的**逐文件**列表」。**没选定 adapter，这两行根本填不出来**，CREATE→UPDATE 降级提示里「将动到哪些文件」的措辞也会失真（把 A adapter 的入口与路径套到 B adapter 上）。因此本 Skill 要求：**adapter 选定必须完成在 Step 0.3 之前**。路径速查见 [framework/agents/README.md](../../agents/README.md)。

按 [prompts/adapter-selection.md](prompts/adapter-selection.md) 执行：

1. 列出 `framework/agents/*/adapter.yaml` 中已实现的 `adapter_name` + `description`，给出**推荐值**（指纹与建议逻辑见 [framework/agents/README.md](../../agents/README.md)）。推荐值仅供参考，**不得**直接当成用户选择。
2. **BLOCKER — 强制等待显式选定**：必须收到用户**具体 `adapter_name` 字符串**（与 `framework/agents/<name>/` 目录名一致；仅仅回复「好」「继续」「ok」不构成选定）。在选定完成前，**严禁**：
   - 进入 Step 0.3（体检表第 2、3 项依赖已选 adapter）；
   - 在任何问题、diff、降级提示里写入**具体入口文件名**或上一版 adapter 留在仓库里的专有目录前缀；必要时用 **「所选 adapter 的入口文件」「templates 将拷贝的路径」** 等占位措辞（与各 adapter 的实际 `target_path` 对齐方式见 agents README）。
   - 写入 / 更新 `framework.config.json` 的 `agent_adapter` 字段、拷贝任何 `framework/agents/<name>/templates/**` 下的文件、渲染任何入口文件。
3. 即便从 IDE 环境、聊天上下文、仓库内已有上一轮 init 落下的目录痕迹能「推断」出最可能的选项，也**必须**把推断作为**推荐值**亮给用户，由用户确认为「选定」；不得直接当成用户决定落盘或拿来描述后续动作。
4. 选定完成后，内存里记录 `agent_adapter`，用于驱动 Step 0.3 的路径扫描与 Step 4.1 的入口文件渲染；`framework.config.json` 的**整文件写入**发生在 **Step 3.5**（在 Step 4 之前）；字段级补缺：**交互 `Q1.A`** 与 **自动 `5.1.B`** 均在 Step **5.1** 触发（详见各节）。
5. **若选定 `generic`（BLOCKER 追加）**：在同一轮必须再收集并写入 `framework.config.json` → `paths`：
   - `agent_bundle_root`：用户指定的 bundle 根目录（相对实例根），如 `.agents`、`.codex`；**必填**。
   - `agent_bundle_skill_mode`：`inline`（默认，从 `framework/skills/` 物化**完整** SKILL，供 Chrys 等 strict 加载器）或 `bridge`（薄跳板 + 链接，仅适用于会跟进链接的 agent）。
   - Step 3.5 写入 config 时与 `agent_adapter` **同批**落盘，**不得**拖到 Step 5.1 白名单补缺。
6. **若选定 `cursor`**：Step 4 拷贝的 skill 跳板来自 `framework/agents/shared/agent-bundle/templates/skills-bridge/`；`name` 必须与目录名一致（含 `00-`/`0-` 数字前缀）。

#### 0.2.5.1 UPDATE 模式：每轮仍须 opt-in 确认 adapter（BLOCKER）

**即使** `<repo-root>/framework.config.json` 已存在且 `agent_adapter` 已有值（含跨会话、跨 cli 重启），**每一轮** `/framework-init` 仍须在本对话收到用户给出的**具体 `adapter_name` 字符串**（`claude` / `cursor` / `generic`），或明确句式 **`保持 <adapter_name>`** / **`保持 claude`**（须含目录名，不能只回复「好」「继续」「ok」）。

- **禁止**仅通知「当前为 UPDATE、config 里已是 claude，否则保持」后**不等待**即执行 Step 0.3.0。
- **禁止**把 harness `check-init` 的 `resolveAdapterName`（UPDATE 下从 config 回落）当成「用户本轮已选定」——config 只作**推荐值**展示。
- **slash 前置（claude `/framework-init`）**：若 [framework-init.md](../../agents/claude/templates/commands/framework-init.md) 已通过 frontmatter `prompts` 注入 `$PROMPT_ADAPTER` 且值为 `claude`/`cursor`/`generic`，**本节 adapter 枚举视为已满足**，直接进入 Step 0.3.0；值为 `keep_current` 时须读 config 并 **决策复述** 具体 `adapter_name` 后进入 Step 0.3.0。
- **BLOCKER — Widget（渐进增强，链 [user-confirmation-ux.md](../reference/user-confirmation-ux.md) Tier 1）**：呈现本节 enum 时须先调宿主 widget 工具——**Claude Code：`AskUserQuestion`**；**Cursor：`AskQuestion`**——**同轮仍附**下方 portable 编号；**禁止**仅用 Markdown 大表作为唯一交互。
- **BLOCKER — Widget 选项文案 SSOT**：`AskUserQuestion` / `AskQuestion` 的 **options label/description 必须逐字引用** [templates/adapter-widget-options.md](templates/adapter-widget-options.md)「固定选项」表；**禁止**仅读 [agents/README.md](../../agents/README.md) 后自行总结路径；**禁止**出现该 SSOT「反模式」段所列字符串（含 `.claude/commands/skills/`、`(Recommended)`）。
- **同轮必须附 portable 编号菜单**（registry `init.adapter`；正文见 adapter-widget-options SSOT）：

  ```text
  请选择（回复编号；widget 可用时可直接选）：
  1. claude
  2. cursor
  3. generic
  4. 保持当前 config 中的 adapter（须复述目录名）
  ```

- **UPDATE 脚注**：展示 enum 时同轮附 adapter-widget-options「UPDATE 说明」段（选项 1 与 4 在 config 已是同一 adapter 时效果相同）。
- 写入前 **决策复述**（见 user-confirmation-ux §3.6）。

### 0.3 产物存在性体检（写入前必做，CREATE / UPDATE 共享）

> 动机：Framework 初始化常常是**升级重跑**——用户已积累 `doc/module-catalog.yaml` / `doc/glossary.yaml` / `doc/architecture.md` / `doc/features/**` 等资产，甚至在**实例根入口文件**（`agent_entry_file`）里补过项目指令。**盲目覆盖就是毁资产**。本步把所有待写路径前置扫一遍，按固定策略矩阵给出动作，**不允许 AI 临场发挥**。

#### 0.3.0 先决条件 —— 必须先跑 `check-init`（v2.6 起，BLOCKER）

> v2.6 引入「init 阶段全局 Harness」：11 项体检的 `MISSING/EMPTY/POPULATED` 判定与 `POPULATED` 项的 diff 摘要全部由 [framework/harness/scripts/check-init.ts](../../harness/scripts/check-init.ts) 计算。**Skill 自身不再做任何字节比对 / EOL 归一化判断 / hash 描述 / "看起来一致" 的口头判定**。

进入 0.3.1 之前**必须**先在终端执行（`<已选定 adapter>` 必须填 Step 0.2.5 已定下的具体 `adapter_name`，**不允许**在命令行里用「多选占位符」代替真实字符串）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase init --adapter <已选定 adapter>
```

> **Shell cwd（BLOCKER）**：上式执行后 shell cwd 通常为 `framework/harness/`。下一步若调用 **类型 A** 独立脚本（`render-agents-md.mjs`、`merge-framework-config.mjs`、`show-last-committed-framework-config.mjs` 等），须先 `cd` 回 **`<repo-root>`**，或改用 harness 内短路径 `node scripts/<name>.mjs` / `npx ts-node scripts/...`。详见 [reference/harness-cli-cwd.md](../reference/harness-cli-cwd.md)。

**0.3.0 之后、Step 4 之前的合法接续示例（二选一）**：

```bash
# 从实例工程根（类型 A）
cd <repo-root>
node framework/harness/scripts/render-agents-md.mjs ...

# 或留在 framework/harness（短路径，与上式 harness-runner 同 shell）
node scripts/render-agents-md.mjs ...
```

执行结果产出两份成果：

1. **stdout 体检表**（来自 `check-init.ts` 的 `buildStdoutTable()`）：含 **`update_policy` 列**，第 3 项可按模板文件**展开多行**；0.3.3 节将原样搬运给用户；
2. **JSON 报告**：写入 `framework/harness/reports/_global/init/<timestamp>/check-init.json`，由 0.3.2 策略矩阵消费（`schema_version: "1.1"`）。

**严禁**跳过本步直接由 AI 描述体检判定结果。**每一行 inspection**的 `状态` 列、`hash_template`、`hash_target`、`diff_summary` 必须**直接搬运** `check-init.json` 的 `inspections[].status` / `hash_*` / `diff_summary` 字段；**禁止**在 SKILL 本节出现"已与模板一致"、"差异主要是项目特定内容"、"基于 DSL 已渲染" 等占位措辞——后者是 v2.6 之前的事故现场，已由本 SKILL「阻塞与上报（BLOCKER）」段的 **init-diff Hallucination Ban** 条款列为 BLOCKER。

如果脚本退出码非 0：
- BLOCKER 类问题（adapter 未指定 / adapter.yaml 不可解析 / template 路径缺失 / 11 项无法判定 / POPULATED 项缺 hash/diff）→ **停下来**修复后重跑，不得绕过。
- 仅 POPULATED 行的 y/n 决策由 SKILL 0.3.2 + 0.3.3 处理，不影响脚本退出码。

#### 0.3.1 体检清单（固定 11 项，按路径顺序扫）

> **本表 11 个体检索引的 `状态` 列必须从 `check-init.json` 的 `inspections[].status` 字段直接搬运**（第 3 索引可对应多行）；下表的「档位分类依据」只描述 `check-init.ts` 的判定算法，便于审计——**不再要求 AI 自行执行该算法**。

所有路径均相对**实例工程根**；多数路径须先从 `framework.config.json`（若存在）的 `paths` 字段解析，UPDATE 模式优先读实例工程的配置，CREATE 模式以 `framework/harness/config.ts` `DEFAULT_PATHS` 为准。

**前置依赖（BLOCKER）**：第 2、3 项的目标路径来自 **Step 0.2.5** 已选定的 `agent_adapter`（`agent_entry_file.target_path`、adapter `templates/` 下待拷贝文件）。若 Step 0.2.5 尚未完成，**不得**进入本节；体检表也不得用臆测文件名占位（严禁「先假定某个最常见 adapter」这类行为）。

| # | 路径 | 档位分类依据 |
|---|------|--------------|
| 1 | `framework.config.json` | 解析成功且 `architecture.outer_layers.length > 0` → POPULATED；`=== 0` → EMPTY；文件不存在 → MISSING（**单独再判第 10 项 toolchain 段**） |
| 2 | 所选 adapter 的 `agent_entry_file.target_path` | 与 `framework/templates/AGENTS.md.template` **按当前 DSL 渲染出的骨架**内容等价 → EMPTY（字节相等或仅 CRLF/LF 不同均算 EMPTY）；真实内容不同 → POPULATED；不存在 → MISSING |
| 3 | 所选 adapter `templates/` 下每一个会被拷贝到实例根的文件 | 与源模板内容等价 → EMPTY（字节相等或仅 CRLF/LF 不同均算 EMPTY）；真实内容不同 → POPULATED；不存在 → MISSING（**逐文件**判定，不按目录整体；路径清单以该 adapter `adapter.yaml` + [agents/README 速查](../../agents/README.md) 为准）。`check-init` stdout/json 为该体检项每条记录附带所属 adapter 段的 `update_policy`（`auto_overwrite` \| `prompt_if_changed`）；缺省为 `prompt_if_changed`。 |
| 4 | `paths.architecture_md`（默认 `doc/architecture.md`） | 与按 `project_profile` 解析的 architecture 骨架模板（见 §5.2：Profiles `doc-skeletons/` → `profiles/generic/` → `skills/00-framework-init/templates/`）渲染后内容等价 → EMPTY（字节相等或仅 CRLF/LF 不同均算 EMPTY）；真实内容不同 → POPULATED |
| 5 | `paths.module_catalog`（默认 `doc/module-catalog.yaml`） | YAML 解析后 `modules` 数组 `=== 0` → EMPTY；否则 POPULATED |
| 6 | `paths.glossary`（默认 `doc/glossary.yaml`） | YAML 解析后 `terms` 数组 `=== 0` → EMPTY；否则 POPULATED |
| 7 | `paths.glossary_seed`（默认 `doc/glossary-seed.txt`） | 与 `templates/glossary-seed.skeleton.txt` 内容等价 → EMPTY（字节相等或仅 CRLF/LF 不同均算 EMPTY）；真实内容不同 → POPULATED |
| 8 | `paths.features_dir`（默认 `doc/features`） | 目录不存在 → MISSING；存在但空目录 / 只含 `.gitkeep` → EMPTY；有任何子目录或文件 → POPULATED |
| 9 | `framework/harness/node_modules/ts-node/package.json` | 存在 → POPULATED；不存在 → MISSING（EMPTY 不适用）。**探测方式必须用不受 `.gitignore` 影响的真实文件系统探测**（Node `fs.existsSync` / PowerShell `Test-Path` / Shell `test -e`）；**禁止**仅用 IDE / agent 自带的、默认跳过 `.gitignore` 条目或仅索引「工作区可见文件」的列举方式代替——`node_modules/` 几乎一定在工程根 `.gitignore` 中，会假阴性而误触发冗余 `npm install`（不致命，但破坏体检准确性）。 |
| 10 | `framework.config.json` 的宿主工具链安装路径（字段路径以 `check-init.ts` 与当前 `project_profile` 为准；实例侧常见为 `toolchain.*.installPath`） | 字段存在且非空字符串且路径在文件系统中存在 → POPULATED；字段缺失 / 空串 / 路径不存在 → MISSING（部分 profile 上若干 harness BLOCKER 规则会依赖该路径；细则见对应 profile 的 `00-framework-init` addendum） |
| 11 | 实例工程根 `.gitignore`（init 约定忽略项：harness 产物 + Skill 0 staging + feature reports + Skill 6 本地产物） | **`check-init` 在 0.3.0 体检前** 已执行 `ensureCanonicalGitignore`（SSOT：`framework/harness/scripts/utils/canonical-gitignore.ts`）；15 条 canonical 均已等价覆盖 → POPULATED；ensure 后仍缺任一项 → MISSING（EMPTY 等同 MISSING） |

#### 0.3.2 策略矩阵（**不许偏离**）

| # | 路径 | MISSING 动作 | EMPTY 动作 | POPULATED 动作 |
|---|------|------|------|------|
| 1 | `framework.config.json` | 走 Step **3.5** 直接写 | 等同 MISSING | **Step 3.5 按 `Q1` 决策**（整文件替换或跳过）；**Step 5.1** 见 `Q1.A` / **`5.1.B`** |
| 2 | agent 入口文件 | 走 Step 4.1 直接写 | **保留现有文件，不重写** | **diff + 用户 `y`**，整文件替换 |
| 3 | adapter 目录下每个文件 | 直接拷贝 | **保留现有文件，不重写** | **`prompt_if_changed`（默认）**：逐文件 diff + 用户 `Q3.x`。**`auto_overwrite`（adapter.yaml 明示）**：`check-init` **PASS** 后自动备份至 `.framework-backup/<timestamp>/` 并对齐模板——**不进入** Step 0.3.4 的 `Q3.x`（仍展示在体检表中）。用户自建、在源模板中不存在的额外文件一律保留。 |
| 4 | `doc/architecture.md` | 走 Step 5.2 写骨架 | **保留现有文件，不重写** | **默认跳过**；向用户打印："`doc/architecture.md` 已被你迭代过，本 Skill 不会自动重置。如需回到骨架重新生成，请手动删除该文件后再重跑 `/framework-init`。" |
| 5 | `doc/module-catalog.yaml` | 写空骨架（`modules: []`） | 保留原骨架，不动 | **永不覆盖**；打印："`doc/module-catalog.yaml` 属于 `catalog-bootstrap` 持续积累的数据资产，本 Skill 不会修改。" |
| 6 | `doc/glossary.yaml` | 写空骨架（`terms: []`） | 保留原骨架 | **永不覆盖**；打印："`doc/glossary.yaml` 属于 `glossary-bootstrap` 积累资产，本 Skill 不会修改。" |
| 7 | `doc/glossary-seed.txt` | 写骨架 | 保留（不因纯换行差异重写） | **默认跳过**；打印："`doc/glossary-seed.txt` 已被编辑，保留原文。" |
| 8 | `paths.features_dir` | 创建空目录 + 可选 `.gitkeep` | 保留 | **不进入、不扫描、不比对**；打印："`<features_dir>` 下已有业务 feature 产物，本 Skill 不会触碰其中任何文件。" |
| 9 | `framework/harness/node_modules` | Step 5.5 执行 `npm install` | 不适用 | Step 5.5 幂等跳过 |
| 10 | 宿主工具链安装路径（以 `check-init` 与 `project_profile` 为准；实例常见字段见 profile addendum） | 走 Step 5.6（若 profile 要求）探测并写入 | 等同 MISSING | **Step 5.6 跳过**；如需重置请用户手工编辑 `framework.config.json` 后再重跑 |
| 11 | `.gitignore` init 约定忽略 block | **`check-init` 体检前 `ensureCanonicalGitignore` 已追加**（见 stderr / `check-init.json` → `gitignore_sync`） | 等同 MISSING | **不再手写**；POPULATED 时跳过；Step 5.4.5 仅核对脚本结果 |

**共性纪律**：

- 所有 `POPULATED` 档位的决策全部在 **Step 0.3 阶段一次性展示完体检表**给用户看，随后在 **Step 3.5**（体检 #1 写入）、**Step 4**（入口 / adapter）、**Step 5**（其余文档骨架与 `Q1.A` / **`5.1.B`**）按序**只执行**体检表与 0.3.4 已决定的动作；不得在中途翻盘或复读 y/n。
- 第 2/3/4/7 项若仅 CRLF/LF 换行符不同，`check-init.ts` 必须判为 `EMPTY` 并在诊断中说明"仅换行符不同，已忽略"；这类项**不得**进入 0.3.4 用户确认流，也**不得**为了"刷新模板"重写文件。
- 用户对第 1/2/3 类的 diff 给出 `n`（拒绝） → 该项跳过写入，**不**中断整体流程，不强制回滚其它已完成项；但必须在 Step 7 的收尾指引里明确列出被跳过项。
- 任何策略里标注 "不会覆盖 / 不会修改 / 不会触碰" 的项，**即使用户口头要求**本 Skill 也不处理；请引导用户走 `catalog-bootstrap` / `glossary-bootstrap` / 手工删除后重跑等既定路径。

#### 0.3.3 汇报表与 CREATE 强制降级

**原样搬运 0.3.0 步骤产生的 `check-init.ts` stdout 体检表**给用户看，再继续 Step 1。脚本输出已经按 Step 0.2.5 选定的 adapter **渲染出第 2/3 索引在实例根的真实相对路径**（第 3 索引可多行；人类可读对照见 [framework/agents/README.md](../../agents/README.md)）。

**搬运纪律（BLOCKER）**：

- **不得**改写脚本给出的**列名与列顺序**（`#`、`产物`、`状态`、`update_policy`、`计划动作`、`诊断`）。
- **不得**删除或合并索引 **#1、#2、#4–#11** 的体检行（各占一行）；索引 **#3** 允许 **≥1 行**（每个需单独决策或自动覆盖的模板目标文件一行；若全部 EMPTY 则脚本可能聚合为一行——以 `check-init` stdout 为准）。
- **不得**改写「状态」列的 `MISSING/EMPTY/POPULATED` 三态值。
- **不得**改写「计划动作」列的策略文案（这些文案与 0.3.2 策略矩阵 / `update_policy` 协议一致）。
- **不得**改写「诊断」列措辞——尤其是 POPULATED 行的 hash/diff 摘要，必须以 `check-init.json` 中 `inspections[].diff_summary` 字段为准；任何"已与模板一致"、"差异主要是项目特定内容"等占位措辞 → 见「阻塞与上报（BLOCKER）」段的 **init-diff Hallucination Ban** 条款，视为本次 init 失败。
- 可以**额外在表后**用一两句话提醒用户重点 POPULATED 行（例："第 2 行你的入口文件与默认骨架有 diff，进入 Step 4.1 时需要你 `y/n` 确认"），但**不得**改写表内字段。

参考表头格式（实际行内容由脚本生成，AI 不渲染；`update_policy` 列仅 #3 非聚合行有值）：

```text
| # | 产物                                | 状态       | update_policy      | 计划动作                          | 诊断 |
|---|-------------------------------------|------------|--------------------|-----------------------------------|------|
| 1 | framework.config.json               | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 2 | <agent_entry_file.target_path>      | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 3 | <adapter 模板目标路径之一>           | <脚本生成> | auto_overwrite 或 prompt… | <脚本生成>                 | <脚本生成> |
| … | …                                   | …          | …                  | …                                 | …    |
| 4 | doc/architecture.md                 | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 5 | doc/module-catalog.yaml             | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 6 | doc/glossary.yaml                   | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 7 | doc/glossary-seed.txt               | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 8 | doc/features/                       | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 9 | framework/harness/node_modules/...  | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 10| 宿主工具链 installPath（脚本渲染字段名）  | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
| 11| .gitignore init canonical ignores   | <脚本生成> | —                  | <脚本生成>                        | <脚本生成> |
```

**CREATE → UPDATE 强制降级**：

若当前标记为 CREATE 模式，但体检中**除第 8 项外**任何一行出现 `POPULATED`，AI 必须停下并打印（**文案中列出的遗留文件名必须按 Step 0.2.5 选定 adapter 渲染为唯一确定的 `target_path`**，不允许在尚未选定 adapter 时并列猜测两个可能的入口文件名）：

> 当前无 `framework.config.json`，按 Step 0.2 判定为 CREATE，但上述体检发现工程中已存在既往初始化产物（例如 `<entry-file>`、`doc/architecture.md`、`doc/module-catalog.yaml`）。本 Skill 将**强制降级为 UPDATE 语义**（仍以 CREATE 脚本通道跑一次体检）：对已 POPULATED 项一律依赖 Step 0.3.4 的 diff + `Q1/Q2/Q3.*` —— **绝不盲目覆盖**。继续？(y/N)

**附加提醒（强烈推荐）**：你主动删除了工作区内的 `framework.config.json`，原先的 **`architecture`、`intra_layer_deps`、`paths`、宿主工具链条目（由各 profile `00-framework-init` addendum 点名，常见落在 `toolchain` 顶层段）** 等定制可能已不可用。若在 **Step 1**「Git 快照」能取回最后一次提交的 JSON，请以此为 Step 3 / Step 3.x **预填与同层策略表「当前值」**；否则会退回到 preset / `config-defaults.json` 的默认（可能与旧工程不一致）。**宿主工具链路径**主要靠 Step **5.6**（profile 要求时）重装或由 Git 快照恢复的 config **回填并经用户确认**。

用户 `y` → 记下「语义 UPDATE」并继续后续步骤；`N` 或无响应 → 终止本次 `/framework-init`，让用户从 git 找回 config 或清理遗留产物后再重跑。

#### 0.3.4 POPULATED 项决策收集（BLOCKER，结构化回复）

> **动机**：Step 0.3.3 展示完体检表后，所有标注「diff + 用户 `y` 确认」的 POPULATED 项**必须在本节一次性收齐 y/n 决策**，再进入 Step 1 之后的写入步骤。这避免两种已发生的事故：
> - AI 把多个 POPULATED 项分散到 Step 4 / Step 5 各小节分别问 y/n，用户难以全局把握、漏决策；
> - AI 在 Step 4 把**入口文件**覆盖确认 + **adapter templates** 多文件漂移确认**并排抛出两个独立 y/n 问题**，用户回一个 `y`，AI 把它自由解释成「对两个问题都同意」并连续覆盖——这违反 [`{{AGENT_ENTRY_FILE}}` §6.5 反假设条款](../../templates/AGENTS.md.template)。

##### 0.3.4.1 适用范围

需要进入本节决策的 POPULATED 项（按 0.3.2 策略矩阵索引）：

| 体检 # | 路径 | 是否进入 0.3.4 |
|--------|------|-----------------|
| 1 | `framework.config.json`（整文件覆盖决策） | ✅（`Q1`） |
| 1.A | `framework.config.json` 白名单字段缺失（**当 `inspection.missing_keys` 非空且用户已选 `Q1=n` 时**触发的"字段级只补缺合并"子问题） | ✅（`Q1.A`；执行落在 **§5.1**，不再写整文件） |
| 2 | agent 入口文件（所选 `agent_entry_file.target_path`） | ✅ |
| 3 | adapter `templates/` 下**每一个**漂移文件（`update_policy=prompt_if_changed` 或缺省） | ✅（**逐文件**一项，**严禁**整体折叠为一个"Q3：5 个文件"） |
| 3 | 同上，但 `update_policy=auto_overwrite`（机制段，如部分 hooks / settings / verifier 子 agent） | ❌（由 `check-init` PASS 后自动备份并对齐模板，**不进入** `Q3.x`） |
| 4 | `doc/architecture.md` | ❌（POPULATED 默认跳过，无需用户决策） |
| 5–8 | catalog / glossary / glossary-seed / features_dir | ❌（POPULATED 永不覆盖，无需用户决策） |
| 9 | `framework/harness/node_modules/` | ❌（npm 幂等） |
| 10 | 宿主工具链路径（细则见 profile `00-framework-init` addendum） | ❌（POPULATED 跳过；MISSING 在 Step 5.6（若存在）单独走自己的确认流程） |
| 11 | `.gitignore` init 约定忽略 block | ❌（POPULATED 跳过；MISSING 在 5.4.5 直接追加，无需 y/n） |

##### 0.3.4.2 操作纪律（BLOCKER）

1. **逐项编号枚举**：把上表「✅」中**实际为 POPULATED**的项按体检表 # 顺序枚举，统一前缀 `Q`，第 3 项中 **`update_policy=prompt_if_changed`（或缺省）**的每个文件一个独立子编号 `Q3.1` / `Q3.2` / …（**不含** `auto_overwrite` 机制段，后者已在 `check-init` PASS 时自动处理）。例：

   ```text
   待你逐项确认的覆盖决策（共 N 项）：

   Q1   framework.config.json（POPULATED）
        diff 摘要：<check-init.json 的 inspections[0].diff_summary 前几行>
        回 y → Step **3.5** 整文件替换；回 n → 保留当前磁盘文件（本节不写入）

   Q1.A framework.config.json 字段补缺合并（仅当 inspections[0].missing_keys 非空、且 Q1=n 时枚举）
        缺失字段：<inspections[0].missing_keys 前若干条；超过 5 个时截断"... 共 N 项，详见 check-init.json">
        回 y → **Step 5.1** 调 `merge-framework-config.mjs --apply`（先备份原文到 .framework-backup/<UTC>/ 再"只补缺、不覆盖"合并）；回 n → 跳过，Step 7 汇报里列出建议补齐清单
        （注：Q1=y 时本子问题自动跳过——Step 5.1.B 会在 Step 3.5 写入后无条件补缺，无需用户决策；missing_keys 为空时本行不出现。）

   Q2   <agent_entry_file.target_path 的具体文件名由脚本渲染>（POPULATED）
        diff 摘要：<inspections[1].diff_summary>
        回 y → Step 4.1 整文件替换；回 n → 保留当前文件

   Q3.1 <adapter 拷贝目标路径之一，见 check-init.json / diff_summary，如某 commands/*.md>（POPULATED）
        diff 摘要：<inspections[2].diff_summary 中该文件那一段>
        回 y → 单文件覆盖；回 n → 保留
   Q3.2 <同上，另一目标文件>（POPULATED）
        ...
   ```

2. **回复格式约束**（强制）：
   - **标准格式**：`Q1=y Q2=n Q3.1=y Q3.2=y Q3.3=n …`，空格 / 换行 / 逗号分隔均可，大小写不敏感。
   - **等价语义**：`y` / `yes` / `好` / `1` → 是；`n` / `no` / `否` / `0` → 否。
   - **全选速记**：用户回 `all=y` / `all=n` / `全部 y` / `全部 n` 表示**所有 Q 同向**；这是用户已通读 diff 后明确表达"统一处置"的合法快捷方式。
   - **严禁接受**（Q 数 ≥ 2 时）：裸 `y` / `yes` / `好` / `继续` / `1` —— 这类回复**无法精确映射**到 Q 编号集合，按 0.3.4.3 处理为「歧义」。

3. **AI 输出的提问模板**（强制：先 gate + widget，再允许 Q 格式；见 user-confirmation-ux `init.populated_diff`）：

   **BLOCKER**：先调 widget——Claude **`AskUserQuestion`** / Cursor **`AskQuestion`**（[user-confirmation-ux.md](../reference/user-confirmation-ux.md) Tier 1）——同轮仍附下列 gate 编号；禁止仅 Markdown 表。

   ```text
   请选择（回复编号）：
   1. all=y（全部 POPULATED 项同意覆盖 / 等价于下方 all=y）
   2. all=n（全部保留当前磁盘）
   3. 逐项指定（进入 Q1=y Q2=n … 格式）
   ```

   若用户选 `3` 或直接进入逐项模式，**强制末尾追加**：

   > **请按以下任一格式回复**（共 `<N>` 项）：
   > - `Q1=y Q2=n Q3.1=y …`（逐项指定）
   > - `all=y` / `all=n`（统一处置全部 `<N>` 项）
   >
   > 单字 `y` / `n` / `好` 不构成有效回复（Q 数 ≥ 2 时无法映射到具体项）。

##### 0.3.4.3 歧义处理（BLOCKER，AI 必须遵守）

用户回复出现以下任一情况 → **AI 必须停下来逐题再问**（每次仅问一个 Q，等单独回答后再问下一个），**严禁**自行假设"y 涵盖所有问题"或"按推荐默认值落"：

- 回复仅含单一 `y` / `n` / `yes` / `no` / `好` / `继续` / `1` / `0`，且 Q 数 ≥ 2；
- 回复缺少**任一** Q 编号（如只回 `Q1=y Q2=n` 但有 5 个 Q）；
- 回复包含未在 Q 集合内的编号（如 `Q4=y` 但本次只有 Q1/Q2/Q3.1/Q3.2/Q3.3）；
- 回复语义无法明确映射 `y` / `n`（如「都按你说的」「随便」「看你」）。

退化路径示例：

> 你的回复 `y` 在本次需要决策的 5 项里无法精确映射。逐项再问：
>
> Q1：framework.config.json 是否用模板覆盖？(y/n)

得到 Q1 单独回答后再追问 Q2，依此类推，直到全部 Q 收齐。

##### 0.3.4.4 决策复述与归档

收齐所有 Q 后，AI 必须**向用户复述一次最终决策**再进入 Step 1，便于用户最后一次纠错：

```text
决策已记录：
  Q1=y   → Step **3.5** 整文件替换 framework.config.json
  Q2=n   → 入口文件保留当前内容，不覆盖
  Q3.1=y → 覆盖 Q3.1 对应的那份 adapter 模板目标文件
  Q3.2=n → 保留 Q3.2 对应的那份 adapter 模板目标文件
  ...
后续 Step **3.5** / Step 4 / Step 5… 各小节将仅执行上述决策，不再重复询问。
```

后续 Step 3.5 / Step 4 / Step 5.1 等小节**只读取本节已记录的决策**，**不得**再向用户发起新一轮 y/n 询问；这是 [`{{AGENT_ENTRY_FILE}}` §6.5 反假设条款](../../templates/AGENTS.md.template)在 Skill 0 的具体落地。

---

## Step 1. 只读探测（扫描工程）

按 [prompts/scan-project.md](prompts/scan-project.md) 执行：

| 信号源 | 用途 |
|--------|------|
| 宿主工程根部的**模块/依赖清单**与**模块注册配置**（文件名以当前 profile addendum 为准） | 项目名推测、`srcPath` 模块列表 |
| 仓库根第一层目录 | 是否出现 `01-Product`、`02-Feature` 等 **五层命名** 或 `entry` / `features` 等扁平模式 |
| `.gitmodules` / `framework/.git` | 是否为 submodule |
| 已有 `doc/architecture.md` | 若存在且详实，可作为 DSL 问卷的预填参考（仍以用户确认准） |

输出一段**人话摘要**给用户（不超过一屏）。

### Step 1.25 Git 快照中的 `framework.config.json`（config MISSING / 曾被删场景，BLOCKER：**强烈建议探测**）

> **动机**：工作区删掉 config 不会自动删除 git 历史中最后一次提交的副本；用它做 Step **3.x** 「当前值」与 **toolchain** 预填，可避免 `intra_layer_deps`「按默认」误降回 forbid、避免 **宿主 IDE 安装路径**（见 profile addendum 字段名）凭空丢失。

在继续 Step 2 之前，若 **Step 0.3** 判定体检 #1 为 `MISSING`（或对用户而言属「磁盘上暂无 config」等价场景），且 `<repo-root>/.git` 存在或可执行 `git`，在实例工程根执行：

```bash
cd <repo-root> && node framework/harness/scripts/show-last-committed-framework-config.mjs
```

（默认读取 `HEAD:framework.config.json`；可用 `--ref HEAD~1` 等查看更旧版本。**stdout 即 JSON**；若要落盘可读副本，可先 `mkdir .framework-backup-last` 再自行 shell 重定向，或仅把输出保留在对话上下文中。）

- 脚本 **exit 0**：将解析得到的对象作为 **`recovered_framework_config`** 内存快照；Step **3.x** 填「当前值」列时**优先使用**快照里各层 `architecture.outer_layers[*].intra_layer_deps`，其次才是 preset（见 [prompts/architecture-presets.md](prompts/architecture-presets.md)）。
- **非 0**（路径从未进过 git / 裸仓无提交 / 未装 git）：在 Step 1 摘要末尾**单列一行** advisory，直接进入 Step **2**，不得假装存在快照。

快照**仅作文本预填与用户确认依据**——最终落盘内容仍以 Step **2～3** 与用户答复 + Step **3.5** 写入为准；不要将快照不经确认写回磁盘。

---

## Step 1.5～1.7. `project_profile` 探测 / 用户确认 / defaults 合并（v3.1+）

> **动机**：编码/UT/真机类 harness 行为由 `project_profile` + `capabilities` 驱动；init 必须把该维度与 `agent_adapter` **并列**写清，避免工程长期缺字段却依赖运行时默认。

### 1.5 启发式探测（只做推荐，不当成用户默许）

在展示表格前，扫描并给出**推荐** `project_profile.name`（及可选 `sub_variant`）：

| 信号 | 倾向 |
|------|------|
| 仓库呈现当前 config 所识别的 **Harmony/OpenHarmony 应用工程指纹**（元数据文件 + 主模块源码树等，细则见 [framework/harness/config.ts](../../harness/config.ts) `normalizeProjectProfile`） | 推荐 **非 generic** 的应用宿主 profile（具体名称以 `framework/profiles/*/profile.yaml` 为准） |
| 用户明确描述「纯文档 / 无宿主编译 / 不写宿主源码」且无上述信号 | 可推荐 `generic` |
| `project_type`（或用户口述）为元服务 / atomic | 在已选应用类 profile 下推荐 `sub_variant: element-service`（与 `normalizeProjectProfile` 推导一致） |

列出 `framework/profiles/*/profile.yaml` 中**已存在**的 profile 名称供用户改选。

### 1.6 用户显式确认（BLOCKER）

必须用表格同时展示：**推荐 profile**、**依据**、**将启用的 capabilities 摘要**（可读 `profile.yaml` / `config-defaults.json`）。

**交互**（registry `init.project_profile` · user-confirmation-ux §3.2）：列出 profile 名称后附编号菜单，例如 `1=hmos-app 2=generic 3=自定义（请给字符串）`；含糊的「好 / 继续」不构成确认。

### 1.7 与 `config-defaults.json` 合并

- 在用户确认后，读取 `framework/profiles/<选定 profile>/config-defaults.json`（若存在），将其与 **Step 3.5** 即将落盘的 `framework.config.json` skeleton **深度合并**（对象递归合并；数组与标量以 defaults 填缺省，不强行覆盖用户已在 Step **2～3** explicit 给出的字段）。
- **UPDATE 模式**：若已有 `project_profile` 段，**默认保留用户原值**，仅当用户本次明确要切换 profile 时才覆盖；切换时必须在 Step 7 汇报中说明差异与对 harness 行为的影响。

---

## Step 2. 交互确认：项目元数据

逐项询问并给出推荐默认值（用户可直接回「用默认值」）：

| 字段 | 写入位置 | 说明 |
|------|----------|------|
| `project_name` | `framework.config.json` | 默认取宿主包清单中的**项目名**字段（字段名以 profile 为准），缺失则目录名 |
| `project_type` | 同上 | 仅 `app` 或 `atomic_service`（现阶段占位，合法但不触发差异化规则；未来差异化路线见 [framework/docs/atomic-service-roadmap.md](../../docs/atomic-service-roadmap.md)） |
| `schema_version` | 同上 | 固定 `"1.1"`（v2.8 起从 `"1.0"` bump 至 `"1.1"`，包含 workflow/extensions/hooks/state_machine 语义）；未来框架 bump 时以模板与 `BACKFILL_FIELDS` 为准 |
| `paths.*` | 同上 | 默认与 [framework/harness/config.ts](../../harness/config.ts) 中 `DEFAULT_PATHS` 一致；若实例已改目录结构，按用户指定覆盖 |
| `state_machine.*`（v2.8 起） | 同上 | 可选；CREATE / UPDATE 模式都按 [templates/../templates/framework.config.template.json](../../templates/framework.config.template.json) skeleton 显式写入这一段（`grace_period_minutes=5` / `ttl_hours=12` / `schema_version="1.1"`）以便工程方一眼看到旋钮。**默认不主动追问用户**——直接落 skeleton 默认值即可；用户如主动要求自定义，按 [framework/harness/config.ts](../../harness/config.ts) 的 `STATE_MACHINE_RANGES` 边界（grace ≥ 1, ttl ≥ 1）校验后落盘。**UPDATE 模式不要把这一段从用户老 config 里抹掉**——若老 config 已有，按老 config 既有值保留；若老 config 没有，建议加上（写在 `paths` 段后，最末尾） |
| `paths.docs_committed`（v3.0+） | `framework.config.json` | **默认 skeleton 中为 `false`，不单独追问**。表示是否假定把 `doc/features/**` 过程产物提交进主仓；影响完成回执 Q3 的路径存在性守门。归档型演示仓可显式改为 `true`；细则见模板 `$schema_docs.field_notes.paths.docs_committed` 与 [framework/docs/visual-handoff-config-migration.md](../../docs/visual-handoff-config-migration.md)。 |

> **备注（Step 2 不再追问 `prd` 段）**：自 v3.0 起 init **不再就 Visual Handoff 守门发起任何交互**——模板 skeleton **不写**顶层 `prd`，CREATE 模式按 skeleton 落盘；UPDATE 模式若老 `framework.config.json` **已含** `prd` 段则**原样保留**整段，并在 Step 7 汇报里追加一句 `已保留 opt-in prd（含 strict/warn/reachable/off 档位），详见 prompts/prd-harness-options.md`。若工程是 UI 形态且需要脚本级 Visual Handoff 守门，由维护者在 init 完成后按 [prompts/prd-harness-options.md](prompts/prd-harness-options.md) **手工合并** `prd`（含 `visual_handoff_enforcement` 与可选 `visual_sources`）；不要把这件事塞回 Step 2 的交互表。

---

## Step 3. 架构 DSL（`architecture` 段）

读 [prompts/architecture-presets.md](prompts/architecture-presets.md)。

1. 若 Step 1 扫描到明显 **5 层 + 数字前缀** 目录结构 → **优先推荐「参考实例 5+4 preset」**（模板片段见 `` `profile-skill-asset:00-framework-init/preset_5_layer_sample` ``），说明可与 `framework/harness/config.ts` 内 `LEGACY_DEFAULT_DSL` 对齐以便回归。
2. 若用户要「简单 App」→ 推荐 **极简 3 外层 preset**（见 [templates/preset-minimal-3-layer.sample.json](templates/preset-minimal-3-layer.sample.json)）。
3. 否则 → 使用 [templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md) 逐项问清：
   - 每个外层的 `id`、`can_depend_on`、`intra_layer_deps`（及 `sublayers` 若需要）
   - `module_inner_layers` 数组顺序（**顺序即依赖顺序**，仅支持 `inner_dependency_direction: "upward"`）
   - `cross_module_exports_file`（默认占位名由所选 architecture preset / 模板给出，以实例 DSL 为准）

### Step 3.x. 同层策略逐层确认（BLOCKER，所有路径共用）

无论走选项 A / B / C，在写入 `framework.config.json.architecture` **之前**，必须完成以下动作（SSOT：`init.intra_layer_deps` · [user-confirmation-ux.md](../reference/user-confirmation-ux.md)）：

#### Step 3.x.0 Gate（默认路径，BLOCKER）

1. 使用 [templates/intra-layer-deps-confirm.template.md](templates/intra-layer-deps-confirm.template.md) 渲染确认表，「当前值」列预填：**若存在 Step 1.25 的 `recovered_framework_config` 快照**，必须以快照中的 `intra_layer_deps` 为预填并说明来源；无快照时才用 preset / 问卷默认值。
2. 明确提示：`forbid` / `dag` / `sublayer` 语义见 [framework/harness/config.ts](../../harness/config.ts) 的 `IntraLayerDepsMode`；**默认值只是推荐**。
3. **先展示 gate**（同轮附 portable；**BLOCKER**：Claude 须 **`AskUserQuestion`**，Cursor 须 **`AskQuestion`**，见 [user-confirmation-ux.md](../reference/user-confirmation-ux.md) Tier 1；禁止仅 Markdown 大表）：

   ```text
   请选择（回复编号）：
   1. 全部维持「当前值」列所示策略（等价于每层显式回复「按默认」；合法速记：`1` / `全部按默认` / `all=default`）
   2. 我要调整某几层（进入 Step 3.x.1 matrix）
   3. 先讨论 forbid / dag / sublayer 语义
   ```

4. 用户选 `1` 或等价 widget → **视为每一外层均已显式「按默认」**，无需逐行打字；**决策复述**后进入生成前自检。
5. 用户选 `2` → Step 3.x.1；选 `3` → 解释语义后回到 gate。
6. **笼统的「好」「继续」「行」不构成确认**。

#### Step 3.x.1 Matrix（仅 gate=2）

对需调整的外层，每层附编号子菜单（user-confirmation-ux §3.3）：`1=按默认 2=dag 3=forbid 4=sublayer(+子层问卷)`。表格保留作可读摘要，**不得**作为唯一交互。

7. 收到全部层级的显式取值后，再依 Step 3 生成前强制自检汇编 JSON —— **磁盘落盘由 Step 3.5 统一执行**。

> 与 Step 4「adapter 选择 BLOCKER」对称：架构守门有三件事必须显式确认——① adapter；② **每层 `intra_layer_deps`**；③ DSL 自检通过。

**生成前强制自检**（不通过则修正后再写文件）：

- `outer_layers[].id` 唯一；`can_depend_on` 只引用已声明的 id；**外层依赖图无环**。
- `intra_layer_deps === "sublayer"` 时 `sublayers` 合法且子层依赖图无环。
- `module_inner_layers` 非空、无重复项。
- `cross_module_exports_file` 非空字符串。
- **每一个 `outer_layers[*].intra_layer_deps` 的取值都能在本次对话里追溯到用户的显式回复记录**（「按默认」视作显式回复；AI 静默采纳 preset 默认不视作显式回复）。

（前四条逻辑与 [framework/harness/config.ts](../../harness/config.ts) `validateArchitectureDsl` 一致；第五条由本 Skill 在 Step 3.x 自己把关，`validateArchitectureDsl` 不检查对话记录。）

---

## Step 3.5 `framework.config.json` — 整文件落盘（先于 Step 4，`render-agents-md` 前置）

> **动机**：[render-agents-md.ts](../../harness/scripts/render-agents-md.ts) 默认从仓库根的 `framework.config.json`（或 `--config`）读取占位符。**若把整个 JSON 的写作推迟到原 Step 5.1**，则 Step 4.1 执行时磁盘上尚无文件，`render-agents-md` 会直接 exit 1 —— 「删 config 后重跑 `/framework-init`」真实事故已由本节前移修复。

### 执行时机（BLOCKER）

- **必须**在 **Step 2～3** 交互完成、DSL 自检通过、`Step 1.25`（若试过）快照已解析或已确认为不可得之后执行。
- **必须**早于 **Step 4**（adapter 拷贝 + 入口渲染）。

### 与 Step **5.1**（交互 `Q1.A` / 自动 **`5.1.B`**）分工

| 体检 #1 + `Q1` | 本节 Step 3.5 | Step **5.1** |
|---|---|---|
| `MISSING` / `EMPTY` | 写入 Step **2～3** 确认的完整 JSON | **`5.1.B`** 无条件跑 `merge-framework-config.mjs --apply` 做安全网补缺 |
| `POPULATED` + `Q1=y` | 同上，整文件替换 | **`5.1.B`** 同上（AI 手写整文件不可靠，`BACKFILL_FIELDS` 只补缺不覆盖）；交互 **`Q1.A`** 不出现 |
| `POPULATED` + `Q1=n` | **跳过本节** — 磁盘仍为既有文件 | **`5.1.A` / `Q1.A`** 按其 y/n **可能**触发 `merge-framework-config.mjs --apply`；**不适用 `5.1.B`** |

### 本节动作（仅此一段，不重问）

**按 Step 0.3 第 1 项 + Step 0.3.4 已收的 `Q1` 决策**：

- `MISSING` / `EMPTY`：汇总 Step **2～3**、`config-defaults` 与用户确认，`validateArchitectureDsl` 自检通过后，格式化为 **2 空格 JSON** 写入 `<repo-root>/framework.config.json`。**若 Step 1.25** 快照含用户仍认可的 **`toolchain` / `prd` / 其它顶层段**，在 Step 2 未明示删除的前提下可与用户确认后**并入**本节 JSON（仍为显式 DSL 与用户答复优先）。
- `POPULATED` 且 `Q1=y`：同上路径整文件替换。
- `POPULATED` 且 `Q1=n`：不触碰磁盘上的 `framework.config.json`。

本节结束后，凡接下来要跑 **§4.1.1** `render-agents-md.mjs`，须保证 **`--config` 默认路径可读**——若你暂时把 JSON 写到旁路路径，须同时传 `--config <path>`（见下文 §4.1.1）。

---

## Step 4. agent adapter 产物落地

> **前置**：① adapter 选定已在 Step **0.2.5** 完成；② **实例根已存在可读** `framework.config.json`（或由 Step **3.5** 刚写入——**POPULATED 且 Q1=n** 时仍为旧文件，亦视为可读）。本节**仍然不得**再问 adapter 选型。

**BLOCKER**：若本 Step 检测到「`agent_adapter` 未在本次对话中由 Step 0.2.5 显式选定」（例如体检阶段被跳过、内存里没有 `agent_adapter` 值），**立即停下回到 Step 0.2.5**，不得在本 Step 重新推断或兜底默认。

各 `adapter_name` 的典型入口文件名与 `templates/` → 实例根产物树、以及「`adapter.yaml` 字段 → 拷贝动作」的分组示例，**只在** [framework/agents/README.md](../../agents/README.md) 维护（避免与 Skill 正文双源）。

落地方式：**从对应 adapter 的 `templates/` 目录拷贝到实例根**，逐字段语义见 [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml)。

### 4.0 `update_policy`（adapter.yaml）与机制自动同步

[adapter-schema.yaml](../../agents/adapter-schema.yaml) 允许在若干段声明可选字段 `update_policy`：

- `prompt_if_changed`（**缺省**）：UPDATE 下目标已存在且与模板不同 → 体检表 POPULATED，进入 Step 0.3.4 的 `Q3.x`；Step 4 仅执行已收决策。
- `auto_overwrite`：**仅用于** framework 控制的机制产物（典型：Claude adapter 的 `hooks/*.mjs`、`.claude/settings.json`、`commands.subagents` → `.claude/agents/verifier.md`）。体检仍逐文件列出 POPULATED 与 diff；**不进入** 0.3.4 的 `Q3.x`。当 [check-init.ts](../../harness/scripts/check-init.ts) **PASS** 且未设置 `CHECK_INIT_SKIP_MECHANISM_SYNC=1` 时，脚本自动将此类目标对齐到当前模板：有内容差异则先备份到 **`.framework-backup/<UTC 时间戳>/`**（相对实例根）再覆盖。`check-init.json`（`schema_version: "1.1"`）含 `mechanism_backup_rel_dir` / `mechanism_synced_files` 供审计。

> 用户仍可手工编辑实例侧机制文件；下次 init 体检 PASS 时会被覆盖（带备份），不是「禁止修改」的硬门禁。单测 / fixture 禁写盘时可设 `CHECK_INIT_SKIP_MECHANISM_SYNC=1`。

> 保持相对路径引用 `../../framework/skills/...` 与现有一致；模板里硬编码的 `framework/harness/...`、`doc/features/...` 等路径**不做替换**——这些路径在 framework.config.json 里另有 SSOT，但 adapter 模板原样保留即可（与现有 commands 模板做法一致）。

**逐文件按 Step 0.3 第 3 项体检结果 + Step 0.3.4 已收决策执行**：

- MISSING → 直拷；
- EMPTY → 保留现有文件，不重写（包含仅 CRLF/LF 不同但内容等价的场景）；
- POPULATED 且 `check-init.json` 中该记录的 `update_policy=auto_overwrite` → **`check-init` PASS 时已自动对齐**（备份至 `.framework-backup/<timestamp>/`）；Step 本节**不再**为该路径征询 `Q3.x`；
- POPULATED 且 `update_policy=prompt_if_changed`（或缺省）且 Step 0.3.4 对应 `Q3.x=y` → 单文件替换；
- POPULATED 且 `prompt_if_changed` 且 Step 0.3.4 对应 `Q3.x=n` → 跳过该文件（在 Step 7 收尾汇报里列出）；
- 源模板中不存在但目标目录已有的用户自建文件**一律保留**。

> **严禁**在本节就 POPULATED 项重新向用户发起 y/n 询问——决策已在 Step 0.3.4 收齐。若发现 Step 0.3.4 漏收某 Q（如 0.3.4 漏判定 adapter 模板新增字段对应的目标路径），**回到 Step 0.3.4 补收**，不在本节临场问。

> Step 0.3 第 3 项的扫描范围**包含**该 adapter `adapter.yaml` 声明的每一个 `target_path` / `target_dir` 下的**逐文件**（含可选的 `settings_file` / `hooks`）；路径枚举以 YAML 为准，辅以 [agents/README](../../agents/README.md) 示意表，**不要凭印象漏扫**。

**不得**同时生成两套与不同 adapter 冲突的入口 Markdown；以 Step 0.2.5 选中 adapter 的 `agent_entry_file.target_path` 为准。切换 adapter 重跑时，**旧 adapter 的既有产物不由本 Skill 自动删除**，由用户自行清理（在 Step 7 收尾时打印提示）。

### 4.1 渲染入口文件（`agent_entry_file`）

**按 Step 0.3 体检结果 + Step 0.3.4 已收决策执行**：

- 第 2 项 MISSING → 直接写；
- 第 2 项 EMPTY → 保留现有文件，不重写（包含仅 CRLF/LF 不同但内容等价的场景）；
- 第 2 项 POPULATED 且 Step 0.3.4 `Q2=y` → 整文件替换；
- 第 2 项 POPULATED 且 Step 0.3.4 `Q2=n` → 跳过（在 Step 7 收尾汇报列出）。

> **严禁**在本节再向用户发起 y/n 询问——`Q2` 决策已在 Step 0.3.4 收齐，diff 也已在 0.3.3 体检表 / 0.3.4 决策模板里展示给用户。

#### 4.1.1 首选路径：`render-agents-md.mjs` → `render-agents-md.ts`（v2.8.3 起，弱模型强制）

**默认必须使用** [framework/harness/scripts/render-agents-md.mjs](../../harness/scripts/render-agents-md.mjs)（薄 shim：同目录 `render-agents-md.ts` 承载占位符替换与 `instance_skill_bridge` 产物写入）。**Shell cwd** 见 [reference/harness-cli-cwd.md](../reference/harness-cli-cwd.md)（Step 0.3.0 后勿在同一 shell 误用 `framework/harness/scripts/...` 前缀）。

一次性完成占位符替换 + 写文件（**须在 `<repo-root>` 执行，或 Step 0.3.0 后使用 harness 短路径**）：

```bash
cd <repo-root> && node framework/harness/scripts/render-agents-md.mjs \
  --entry-file <与 target_path 一致的展示名> \
  --summary "<架构摘要一句话>" \
  --out <与 target_path 一致的写出路径> \
  [--config <可选；默认仓库根 framework.config.json，相对仓库根或绝对路径>]
```

**与 Step 0.3.0 同 shell 接续（cwd 仍在 `framework/harness/` 时）**：

```bash
node scripts/render-agents-md.mjs \
  --entry-file <与 target_path 一致的展示名> \
  --summary "<架构摘要一句话>" \
  --out <与 target_path 一致的写出路径>
```

> **`--entry-file` / `--summary` / `--out` 必填**；**其余占位符**从 config JSON 读出。默认读取 `<repo-root>/framework.config.json`；若确需旁路路径，显式传入 `--config`。

为何强制走脚本路径：

- 渲染产物 200+ 行中文 markdown，**弱模型在通过 LLM tool-call 协议向 Write 工具传递大
  content 参数时容易出现 `InputValidationError: file_path/content missing` / 参数构造失败**
  （**真实工程已发生事故**，详见 §4.1.3 事故现场）。脚本在 Node 进程内完成替换 + 落盘，
  整个大 content 不经过 tool-call 协议传递，从机制上规避此类失败。
- 占位符表（§4.1.4）作为脚本 `vars` 与手工渲染兜底的共享 SSOT，新增占位符时三处同步更新。

#### 4.1.2 兜底路径：手工读模板 → 占位符替换 → Write 工具写入

**仅当**首选脚本路径**不可用**（如 framework vendor 不完整、`render-agents-md.mjs` 缺失、
脚本依赖损坏）时才允许使用。流程：

1. 用 Read 工具读 [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template)；
2. 按 §4.1.4 占位符表逐项替换；
3. 用 Write 工具写到所选 adapter 的 `agent_entry_file.target_path`（实例根相对路径）。

#### 4.1.3 事故与重试纪律（BLOCKER，v2.8.3 起）

> **事故现场**：v2.8.2 后某真实工程跑 `/framework-init` 走兜底路径，AI 调用 Write 工具
> 时连续两次返回 `InputValidationError: Write failed due to the following issues: The
> required parameter file_path is missing / The required parameter content is missing`，
> AI 无法恢复，整个 init 流程卡死，用户被迫重启会话。

工具调用失败时的强制纪律：

1. **重试上限**：用兜底路径调用 Write / 编辑工具写入 entry-file 时，若返回任何错误
   （含 `InputValidationError`、参数 missing / null、超时、内容过长、`tool_use_error`）
   **≥ 2 次**，**严禁**继续以同一方式第三次重试。
2. **立即切首选路径**：第二次失败后**必须**立即改走 §4.1.1 脚本路径（即便最初判定为
   "脚本不可用"，也应**重新尝试**——很多时候第一次跳过脚本只是 AI 的偷懒选择）。
3. **脚本路径也失败**：把脚本 `exit_code` / `stdout` / `stderr` 原样反馈给用户，请求人工介入；
   **严禁**再切回兜底路径"再试一次"——同一根因（弱模型 tool-call 大 content 不稳定）
   在两条路径都已暴露，继续重试只会消耗用户时间。

#### 4.1.4 占位符表（脚本 / 手工兜底共享 SSOT）

| 占位符 | 含义 |
|--------|------|
| `{{AGENT_ENTRY_FILE}}` | 展示用文件名，须与 `agent_entry_file.target_path` 一致 |
| `{{PROJECT_NAME}}` | 项目名 |
| `{{PROJECT_TYPE}}` | `app` / `atomic_service` |
| `{{PROJECT_TYPE_LABEL}}` | 展示文案，按 `project_type` 映射：`app` → `应用工程`；`atomic_service` → `元服务工程`。若未来新增 `project_type` 值，此处同步追加映射 |
| `{{PROJECT_PROFILE_NAME}}` | `framework.config.json → project_profile.name`；缺失时由 harness 按仓库指纹回落默认（见 [framework/harness/config.ts](../../harness/config.ts)） |
| `{{PROJECT_PROFILE_SUB_VARIANT}}` | `project_profile.sub_variant`，无则用 `标准应用`（与 `DEFAULT_PROJECT_PROFILE_SUB_VARIANT_DISPLAY` 常量一致） |
| `{{AGENT_ADAPTER}}` | 所选 adapter 名 |
| `{{ARCHITECTURE_SUMMARY}}` | 一句话，如：「5 个外层（01-Product…05-SystemBase），模块内 4 层 shared→presentation，跨模块出口见 DSL `cross_module_exports_file`」 |
| `{{ARCHITECTURE_MD_PATH}}` | 来自 `paths.architecture_md` |
| `{{MODULE_CATALOG_PATH}}` | `paths.module_catalog` |
| `{{GLOSSARY_PATH}}` | `paths.glossary` |
| `{{FEATURES_DIR}}` | `paths.features_dir`（阶段 9 合并前为 `feature_docs_dir` + `feature_specs_dir` 两字段） |
| `{{PROFILE_AGENT_SSOT_ROWS}}` | 由脚本 / `check-init` 从 `framework/profiles/<project_profile.name>/templates/agents-md/agent-ssot-rows.partial.md` 注入原文；若无则回落 `profiles/generic/` 同名文件 |
| `{{PROFILE_AGENT_GUARDRAILS}}` | 同上目录下 `agent-guardrails.partial.md` |
| `{{EXTENSION_SKILL_SECTION}}` | 由 `render-agents-md` 扫描 `paths.extension_dir/skills/*/SKILL.md` 动态注入；无扩展时为空字符串 |

新增占位符时**必须同时**：① 更新 `render-agents-md.mjs`（shim → `render-agents-md.ts`）的 `vars` 对象；② 更新本表；③ 更新 [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) 中 `placeholders` 段。
脚本启动时会扫剩余 `{{...}}` 并失败退出，作为三处同步的最后兜底。

---

## Step 5. 生成目录与文档骨架

> 本步骤的每一小节**仅执行** Step 0.3 体检表与 Step **3.5**～4 已完成动作之外的剩余项；不得在这里翻盘已收敛的 POPULATED 决策，也不得向用户二次询问（含 `Q1.A`：**仍**只允许执行在 0.3.4 已记录的 `y`）；**§5.1.B** 后置安全网补缺除外（脚本自动运行，不要求用户口令）。

### 5.1 `framework.config.json` — **`Q1.A`（交互补缺）与 `5.1.B`（自动安全网）**

> **`Q1`/整文件写**已由 **Step 3.5** 完成或由 `POPULATED + Q1=n` 明确跳过。**5.1.A** 仅对「体检 #1 为 `POPULATED` + `Q1=n` + `missing_keys` 非空」走交互 `Q1.A`。**5.1.B**（v3.2 起）凡 Step **3.5** 实际写入了 `<repo-root>/framework.config.json`（MISSING / EMPTY / `POPULATED + Q1=y`），即在本节稍后**无条件**跑 `merge-framework-config.mjs --apply`。

#### 5.1.A 字段级补缺合并（v3.1 起；与 Q1 共存的第三档）

> 「整文件替换 vs 跳过」二档解决不了**新版本 framework 引入的字段在老 config 中漂没**的问题
> （典型：`paths.extension_dir` / `paths.state_file` / `state_machine.*` /
> `active_workflow` / `lifecycle_hooks_enabled` / `paths.docs_committed` /
> 各 profile 在 `toolchain.*` 下的工具链子段等）。
> 自 v3.1 起 `inspect01` 在 POPULATED 时会读 `framework.config.json` 原文，调
> [scripts/utils/config-field-merger.ts](../../harness/scripts/utils/config-field-merger.ts) 的
> `BACKFILL_FIELDS` 白名单（完整字段表见该文件 SSOT），把"白名单内 + 当前 raw 缺失"的字段
> 汇总到 `Inspection.missing_keys` 与 JSON 报告里。

**执行规则（POPULATED 且 `missing_keys.length > 0` 时）**：

1. Step 0.3.4 在 `Q1`（整文件替换） 之外追加 `Q1.A`：
   > `Q1.A：framework.config.json 缺失 N 个白名单字段（如 paths.extension_dir、state_machine.*、各 profile 在 toolchain.* 下的工具链子段等），是否按当前 framework 默认值"只补缺、不覆盖"合并？(y/N)`
   > （**默认 N**；用户已选 `Q1=y`（整文件替换）时，本子问题**自动跳过**——由 **§5.1.B** 在 Step **3.5** 后对磁盘 JSON 补缺，本条不再征询。）
2. 用户回 `y` → 本节在 **`<repo-root>`** 执行（或 `cd framework/harness && node scripts/merge-framework-config.mjs --apply`）：
   `cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --apply`：脚本先把原文备份到
   `<repo>/.framework-backup/<UTC>/framework.config.json`，再字段级合并写回（已有字段一律保留，
   不动 `architecture` / `project_name` / `project_type` / `agent_adapter` / `prd` 等敏感段）。
3. 用户回 `n`（或缺失为 0）→ 跳过补缺，Step 7 收尾汇报列出"建议补齐的字段清单"。

**白名单 SSOT**：[`scripts/utils/config-field-merger.ts`](../../harness/scripts/utils/config-field-merger.ts)
的 `BACKFILL_FIELDS`。新增框架默认字段时：在 `framework/harness/config.ts` 的
`DEFAULT_PATHS` / `DEFAULT_STATE_MACHINE`（或同级常量）里加好默认值 → 在 `BACKFILL_FIELDS`
追加一条 → 老工程下一次 `/framework-init` UPDATE 自动机器化追平，无需维护者手工跟。

**严禁补缺的字段**：`project_name`、`project_type`、`agent_adapter`、`architecture.*`、
profile-specific 的宿主工具链路径段（由 Step 5.6 detect 子流程单独处理，参见各 profile
addendum）、`prd.*`（opt-in，须维护者手工选档）、`atomic_service.*`（预留位）、
`paths.reports_dir_pattern`（未配置时 harness 回退到 legacy 报告路径，自动补会让老工程升级后
报告搬家，属于行为级变更，须维护者显式选）。这些字段的缺失走 Skill 主流程。

> **`Q1.A` 不适用场景**：体检 #1 **`MISSING` / `EMPTY`** 或 **`POPULATED + Q1=y`** 时不会出现交互 `Q1.A`——白名单补缺改由 **`§5.1.B`** 在 Step **3.5** 后置自动运行（仍只补缺不覆盖）。**仅当** `POPULATED + Q1=n`（磁盘 JSON 未被 Step **3.5** 重写）且 `missing_keys` 非空时，才可能需要用户在 0.3.4 对 `Q1.A` 给 `y`；`missing_keys` 的报告仅在 POPULATED 时出现。

#### 5.1.B 后置安全网补缺（v3.2 起）

> **动机**：Step **3.5** 输出的 `framework.config.json` 往往由 AI 汇编；即便意图对齐 [framework.config.template.json](../../templates/framework.config.template.json) 与 [`BACKFILL_FIELDS`](../../harness/scripts/utils/config-field-merger.ts)，仍可能遗漏 `lifecycle_hooks_enabled`、`paths.receipt_dir_pattern`、`toolchain` 段若干白名单子键（如四条构建调优布尔/枚举开关）等。不可靠地假设「手写整文件已等同模板 + 白名单」会复现你已见的字段漂移。

**前置**：Step **3.5** **已写入或整文件替换**了 `<repo-root>/framework.config.json`（即体检 #1 为 `MISSING` / `EMPTY`，或 **`POPULATED + Q1=y`**）。**不执行**：体检 #1 为 **`POPULATED + Q1=n`**（磁盘仍是旧文件，走 §5.1.A 交互 `Q1.A`）。

**动作**（BLOCKER：**不得**再问用户 `y/N`，直接执行一次）：

```bash
cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --apply
```

- 若 stdout 表明 **missing fields: 0** → 不写盘或与磁盘一致退出 0 → Step 7 可注明「后置补缺无新增字段」。
- 若脚本写回并补缺 N（N>0）→ 在 Step **7** 收尾汇报中列出脚本 stdout（或简述补了哪些路径）；备份目录按脚本约定 `.framework-backup/<UTC>/framework.config.json`。

**`prd` 段（Visual Handoff，opt-in）**：模板 skeleton **默认不写** `prd`。若 Step 2 **未**与用户约定追加，则生成的 `framework.config.json` **不应**含顶层 `prd`。若工程需要脚本级 Visual Handoff 守门，请在 init 完成后由维护者按 [prompts/prd-harness-options.md](prompts/prd-harness-options.md) **手工合并** `prd`（含 `visual_handoff_enforcement` 与可选 `visual_sources`）。**UPDATE** 模式：若用户老 config **已含** `prd` → **原样保留**整段，仅在 Step 7 汇报中提示「已保留 opt-in `prd`；档位含 `reachable`，详见 prd-harness-options.md」。

### 5.2 `doc/architecture.md`（或 `paths.architecture_md` 指向的路径）

**按 Step 0.3 第 4 项体检结果执行**：

- `MISSING`：以 architecture 骨架 Markdown 为起点生成（**路径解析顺序**：`framework/profiles/<project_profile.name>/doc-skeletons/architecture.md.skeleton.md` → `framework/profiles/generic/doc-skeletons/architecture.md.skeleton.md` → [templates/architecture.md.skeleton.md](templates/architecture.md.skeleton.md)；与 [check-init.ts](../../harness/scripts/check-init.ts) 体检第 4 项同源），见下方渲染步骤。
- `EMPTY`：保留现有文件，不重写（包含仅 CRLF/LF 不同但内容等价的场景）。
- `POPULATED`：**默认跳过**，不展示 diff、不提议覆盖；本 Skill 不替用户决定是否重置他手工迭代过的架构文档。

MISSING 时的渲染步骤：

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

- `module-catalog.yaml`：`MISSING` 写空骨架（可先尝试拷贝 `framework/profiles/<project_profile.name>/doc-skeletons/module-catalog.skeleton.yaml`，不存在则回落 `profiles/generic/` 同名文件，再不存在则用下方 YAML 块）；`EMPTY` / `POPULATED` **不动**（POPULATED 属 `catalog-bootstrap` 积累资产，绝不覆盖）。
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

### 5.4.6 `paths.extension_dir`（实例扩展根目录；默认 `doc/extensions`）

**目的**：承载实例级扩展协议（`manifest.yaml`、`skills/`、`knowledge/`、`hooks/`），与业务需求目录 `paths.features_dir` 分离。

执行规则：

- 若 `<extension_dir>` **不存在**：补缺 `<extension_dir>/`，并按 [templates/extension-skeleton/](templates/extension-skeleton/) 拷贝 `skills/`、`knowledge/`、`hooks/` 各目录内的 **`.gitkeep`**（或直接拷贝上述三棵子目录树），以便 **Git 能跟踪初始空文件夹**。
- 若 `<extension_dir>/manifest.yaml` **不存在**：拷贝 [templates/extension-skeleton/manifest.yaml.template](templates/extension-skeleton/manifest.yaml.template) 为该路径（可同步阅读同目录 [README.md](templates/extension-skeleton/README.md)）。
- 若扩展根或 manifest **已存在**：**不得覆盖**用户内容；仅在缺子目录时补缺，且对新创建的空子目录同样放置模板中的 `.gitkeep`。

**UPDATE 模式**：老实例缺少 `paths.extension_dir`、`active_workflow`、`lifecycle_hooks_enabled` 或需 bump `schema_version` 时，在 Step **5.4.6 / `Q1.A` / Migration**指引下合并模板字段；详见 [framework/MIGRATION.md](../../MIGRATION.md) § v2.5。

§4.1.1 `render-agents-md` 除替换占位符外，会读取 adapter.yaml 的 `instance_skill_bridge`，向 `.cursor/skills/` 与/或 `.claude/commands/` 下发扩展 Skill 跳板 / slash（与内置 Skill **同名**时自动 `ext-` 前缀 + stderr 告警）。

### 5.4.5 宿主 `.gitignore`：init 约定忽略项（harness 运行产物 + Skill 0 staging）

**权威落盘由 `check-init` 在 Step 0.3.0 体检前自动执行**（`ensureCanonicalGitignore`）；本 Step **禁止 agent 手抄或粘贴**下方 block。Agent 仅核对体检表 #11 状态、`check-init.json` → `gitignore_sync.added` 与 stderr 摘要，并在 Step 7 向用户汇报追加项（若有）。

> 目标：真实工程只提交 framework 本体与已定稿的 SSOT（如 `doc/module-catalog.yaml` / `doc/glossary.yaml`），不提交 `/framework-init`、harness 自检、docs phase、后续 phase 运行时产生的本地依赖和报告，也不提交 Skill 0 合并前的 staging 草稿目录。

#### 5.4.5.1 必须覆盖的忽略项

以下为 canonical ignore patterns（路径相对实例工程根，统一 POSIX 正斜杠；**机器 SSOT** 与 [`canonical-gitignore.ts`](../../harness/scripts/utils/canonical-gitignore.ts) 保持一致，勿分叉）：

```gitignore
# Framework runtime artifacts (managed by /framework-init)
framework/harness/node_modules/
framework/harness/dist/
framework/harness/reports/*
!framework/harness/reports/.gitkeep
framework/harness/trace/
framework/harness/package-lock.json

# 阶段状态机：每开发者本地运行时文件，不入仓；目录占位由 .gitkeep 保留
framework/harness/state/*
!framework/harness/state/.gitkeep

# Skill 0 staging：合并入 SSOT 前的 catalog / glossary 草稿，不入仓
doc/catalog-staging/
doc/glossary-staging/

# Framework auto-overwrite backup：init / check-init 对齐机制模板时的旧文件备份根，不入仓
.framework-backup/

# Feature-phase harness：`paths.reports_dir_pattern` 写到各 phase `reports/` 下的本地产物
doc/features/*/*/reports/*

# Skill 6：真机自动化相关的本地 Python venv 与 app 页面快照根（未跑过 Skill 6 时可不存在）
/.hylyre/
/doc/app-snapshot-cache/
# Skill 6 即席（自然语言）用例临时产物根
/doc/features/_adhoc/
```

说明：

- `node_modules/`：Step 5.5 `npm install` 的本地依赖。
- `dist/`：harness TypeScript 编译/构建产物（若存在）。
- `reports/*`：每次 phase 运行生成的报告；保留 `reports/.gitkeep` 让空目录可随 framework 分发。
- `trace/`：调试 trace / 临时记录目录（若存在）。
- `package-lock.json`：由目标工程本地 registry / npm 版本生成，不随 framework 分发；内网、外网 lock 内容可能不同。
- `state/*` + `!state/.gitkeep`：「弱模型工作流强制门」Layer 2/3 写入的本地阶段状态机（如 `.current-phase.json`），**仅本机运行时凭证**；保留 `state/.gitkeep` 让空目录可随 framework 分发，避免 hooks 因目录缺失抛错。
- `doc/catalog-staging/`、`doc/glossary-staging/`：Skill 0 Phase A/B 在写入权威 YAML 前的本地草稿目录；审计仍以合并后的 `doc/module-catalog.yaml` / `doc/glossary.yaml` 与 git 历史为准。
- `.framework-backup/`：`check-init` 在 PASS 后对 `adapter.yaml` 中 `update_policy=auto_overwrite` 的目标做模板对齐前，对被覆盖文件的备份根目录。
- `doc/features/*/*/reports/*`：配置了 `paths.reports_dir_pattern`（默认在各 phase 目录下 `reports/`）时，feature 维度的 harness 脚本报告、合并报告、trace、verifier 产出、宿主编译/装机日志等通常不入仓。
- `/.hylyre/`：真机自动化侧 harness 可能在本机创建的隔离 Python venv（无对应工具或未执行时目录可不存在）。
- `/doc/app-snapshot-cache/`：真机自动化相关的 app 页面快照缓存根（跨 feature；未跑过对应步骤时可不存在）。
- `/doc/features/_adhoc/`：即席自然语言用例生成的临时派生计划与报告目录（不入仓）。

#### 5.4.5.2 等价覆盖规则

检查 `.gitignore` 时不要只做机械字符串查找；以下更宽泛规则可视为已覆盖：

| canonical pattern | 可接受的等价覆盖 |
| --- | --- |
| `framework/harness/node_modules/` | `**/node_modules`、`**/node_modules/`、`node_modules/`、`framework/**/node_modules/` |
| `framework/harness/package-lock.json` | `**/package-lock.json`、`package-lock.json`、`framework/**/package-lock.json` |
| `framework/harness/dist/` | `framework/harness/dist`、`framework/harness/dist/`、`framework/**/dist/` |
| `framework/harness/reports/*` | `framework/harness/reports/*` |
| `!framework/harness/reports/.gitkeep` | `!framework/harness/reports/.gitkeep` |
| `doc/features/*/*/reports/*` | `doc/features/*/*/reports`、`doc/features/*/*/reports/` |
| `framework/harness/trace/` | `framework/harness/trace`、`framework/harness/trace/` |
| `framework/harness/state/*` | `framework/harness/state/*`、`framework/harness/state`、`framework/harness/state/` |
| `!framework/harness/state/.gitkeep` | `!framework/harness/state/.gitkeep` |
| `doc/catalog-staging/` | `doc/catalog-staging`、`doc/catalog-staging/`、`**/catalog-staging/` |
| `doc/glossary-staging/` | `doc/glossary-staging`、`doc/glossary-staging/`、`**/glossary-staging/` |
| `.framework-backup/` | `.framework-backup`、`.framework-backup/`、`**/.framework-backup/` |
| `/.hylyre/` | `.hylyre/`、`/.hylyre/`、`/**/.hylyre/` |
| `/doc/app-snapshot-cache/` | `doc/app-snapshot-cache/`、`doc/app-snapshot-cache`、`/**/app-snapshot-cache/` |
| `/doc/features/_adhoc/` | `doc/features/_adhoc/`、`doc/features/_adhoc` |

#### 5.4.5.3 写入策略（脚本执行，agent 禁止代劳）

- **BLOCKER**：agent **不得**在实例根 `.gitignore` 手写、粘贴或「按记忆」追加 5.4.5.1 中的 pattern；一律由 `check-init` → `ensureCanonicalGitignore` 幂等落盘。
- 脚本行为（与概述第 6 条一致）：
  - `.gitignore` 不存在 → 创建并写入完整分段 block；
  - 已存在且全部 canonical 已等价覆盖 → 不修改；
  - 只缺部分 → 在文件末尾按分段注释 **只追加缺失行**；不重排、不删除、不因 CRLF/LF 重写整文件；追加前保证原文件以换行结尾。
- 该步骤不需要用户 y/n；但必须在 **Step 7** 列出 `gitignore_sync.added`（若有）。
- `inspect11` 可能对疑似错路径输出 **advisory**（如 `/harness/reports/*` 缺 `framework/` 前缀）：**不**作为 BLOCKER，提示用户手删错行即可。
- **厂商包目录例外**：`framework/profiles/<project_profile.name>/vendor/` 下由 profile 随框架分发的三方 wheel 等**须入库**，禁止用本节 canonical block 覆盖；若用户自定义 `.gitignore` 误写了 `**/vendor/`，应提示其收窄规则以免把 profile vendor 排进忽略。

---

## Step 5.5. 安装 harness 本地依赖（Step 6 前置）

> **Tier_1 权威 SSOT（交叉引用）**：日常克隆与独立拉起其它 Skill 时的叙事锚点为 [`../reference/host-harness-readiness.md`](../reference/host-harness-readiness.md)。**本节不可替代为「仅阅读 SSOT」**——init 流程仍须在本 Step **落地执行** `npm install`、失败排查与 **5.5.4 `npm test`** 自检。

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

> 宿主工程自身的包管理器依赖（语言/平台因实例而异）由后续编码阶段与本地工具链负责触发，**与本 Skill 无关**，这里不代管。

### 5.5.4 自检：跑 framework 自带回归测试套件（Step 5.6 / Step 6 前置 BLOCKER）

> **动机**：vendor 模式下，用户把 `framework/` 整目录从源仓库同步到目标工程时**可能漏文件**（rsync exclude 配错、zip 解包不完整、git 浅克隆等）。如果直接进 Step 6（catalog / glossary / docs 校验）只能间接发现 framework 损坏（表现为 `Cannot find module` 或某条规则莫名 throw），定位非常慢。本节用 framework 自带的 `tests/` 套件做**整体性自检**，把"framework 文件健康度"和"业务工程配置健康度"解耦：前者由本节兜底，后者由 Step 6 兜底。

#### 5.5.4.1 执行

`npm install` 成功后，**强制**在 `<repo-root>/framework/harness/` 执行：

```bash
cd framework/harness && npm test
```

期望：unit + fixture 全绿（v2.4 起为 33 unit + 9 fixture = **42 PASS / 0 FAIL**；`doc-freshness` 等 suite 的条数以 `framework/harness/tests/run-unit.ts` 的 `SUITES` 与 `framework/harness/tests/run-tests.ts` 为准，整体耗时约 30s 量级）。

> 该套件**不依赖**真机、外部 IDE 安装目录、设备通道 CLI 等环境，纯逻辑 fixture + 纯函数 unit，新工程未配宿主工具链也能立即跑通（具体哪些 harness 阶段仍强制工具链由 `project_profile` 决定）。所以**不允许**以"还没配工具链"为理由跳过本节。

#### 5.5.4.2 失败处理

若 `npm test` 任一用例失败：**停下**，按以下顺序排查；**严禁**用 `--filter` 缩小集合后报 PASS、**严禁**在用户没看完失败列表前继续 Step 5.6：

1. **fixture 失败**且失败信息含 `ENOENT` / `找不到文件` / `Cannot find module` → 大概率是 framework vendor 不完整。比对源仓库的 `framework/` 全树（重点 `harness/scripts/`、`harness/tests/fixtures/`（多为说明条目）、`framework/profiles/*/harness/tests/fixtures/`、`templates/`、`agents/`），重新同步缺失文件后重跑 5.5.4.1。
2. **unit 失败**（`framework/profiles/*/harness/tests/unit/*.unit.test.ts` 等 profile 工具链单测） → 通常意味着 framework 维护者升级了对应 harness 工具脚本但忘改 unit 期望值，**这是 framework 自身 bug**。把失败用例名 + 错误信息原文反馈给 framework 维护者；本次 `/framework-init` **暂停**，待 framework 修复后重跑。
3. **node 版本不对** / **ts-node 报语法错** → `node --version` 必须 ≥ 18；若版本对但 ts-node 报 "Unexpected token"，检查 `framework/harness/node_modules/typescript/package.json` 中的 `version` 是否 ≥ 5.0。
4. **git fixture 失败**（fixture runner 报 `not a git repository` / `git: command not found`） → 检查 `git --version`、PATH 是否包含 git；fixture runner 内部会做 `git init + commit baseline`，本应不依赖目标工程是不是 git 仓库。

修复后**重跑** `npm test` 直至全绿，再进入 Step 5.6。

#### 5.5.4.3 严禁的偷懒行为

- 把 5.5.4.1 的 FAIL 解释为"环境问题"而跳过——framework 自带套件**故意不依赖任何外部工具链**，没有合理的"环境失败"。
- 用 `npm test -- --filter <某子集>` 把失败用例排除在外，凑出 PASS 上交。
- 把"我装好了 node_modules"等同于"自检通过"——Step 0.3 第 9 项体检只验证依赖是否在，**不验证依赖能否正确执行**，这一节才是后者。

---

## Step 5.6. 宿主 IDE / 构建工具链路径（profile 定义；可选）

> **profile-neutral 编排**：是否配置、字段名、探测/验证脚本、用户确认话术与跳过时的影响清单，**全部以** `framework/profiles/<project_profile.name>/skills/00-framework-init/profile-addendum.md` **为准**。  
> - 若当前 profile 的 addendum **未**要求工具链段（例如 typical `generic`）→ **跳过本节**，直接进入 Step 6。  
> - 若 addendum **要求配置宿主 IDE / 构建工具链路径** → **完整执行** addendum 中的 **「工具链路径配置」** 章节（含用户确认与 `framework.config.json` 写入）。

> **宿主 IDE / 编译工具链的安装路径**，通常在 skeleton 与 **`Q1.A` 白名单补缺**之外，由本节 addendum **单独写入**（字段路径以 **addendum 为准**）；若在 **Step 4.1 `render-agents-md` / adapter 拷贝**中遇非致命错误：**不得**以此终止全流程并跳过本节 —— profile **要求在 config 中声明宿主工具链路径**时，仍需到达 Step **5.6**，按 addendum **完整执行探测或让用户显式 `跳过`**（并记入 Step 7 受影响清单）。本节与入口 Markdown 成功与否**正交**。

本节在根 SKILL 中**不**重复宿主名词，避免与单一 profile 绑定；维护宿主细则时只改对应 profile addendum。

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
- 某 `commands/*.md`（POPULATED，你对 diff 回复了 n）
```

无跳过项时明确打印"本次无跳过项"。

**7.2 下一步指引**（固定输出，可精简不可省略意图）：

1. 为已有模块跑 Skill 0：`/catalog-bootstrap <ModuleName>`，直至 catalog 覆盖主要模块。
2. 跑 `/glossary-bootstrap` 建立术语表。
3. 再进入 `/prd-design`（Skill 1）及后续阶段。

---

## UPDATE 模式补充（体检外的两类动作）

> 「产物是否写 / 如何写」已由 Step 0.3 体检表完全覆盖；本节只补充三件**体检表之外**的、UPDATE 特有的变更语义。

1. **改 DSL**：重新执行 Step 3。DSL 变化的**语义影响**需要显式提醒用户——`check-coding` / `check-catalog` 等 harness 行为会跟着变，既有模块画像的 `allowed_dependencies` 可能突然违规。展示 `architecture` 段 diff 时附带一句"本次变更将影响以下 harness 检查：…"，用户 `y` 后按 **Step 3.5（及适用时的 Step 5.1 `Q1.A`）** 写入。
2. **切换 `agent_adapter`**：用户在 Step 0.2.5 选了与当前 `framework.config.json.agent_adapter` 不同的 adapter 即视为切换。新旧 adapter 的产物路径可能完全不相交（对照 [framework/agents/README.md](../../agents/README.md)）。Step 0.3 体检表**只扫描新 adapter** 的目标路径；旧 adapter 的遗留产物需要在本节**按真实相对路径额外列给用户**，建议用户手动删除或备份后再继续，**本 Skill 不自动删除其它 adapter 的产物**。
3. **adapter 模板新增字段（如 `settings_file` / `hooks`）的 framework 升级**：当 framework 升级后某 adapter 的 `adapter.yaml` 新增了 `settings_file` / `hooks` 等可选字段（典型如 Layer 3 物理拦截），UPDATE 模式必须按 Step 0.3 第 3 项**补扫这些新字段对应的目标路径**，按 MISSING / EMPTY / POPULATED 各档处置；**不得**因为"老工程没有这两个产物"就静默跳过——这正是 UPDATE 应该补齐的内容。展示 diff 时附带一句「详见 `{{AGENT_ENTRY_FILE}}` §5.1 与各 adapter 说明」。

---

## 阻塞与上报（BLOCKER）

- 无法形成满足 `validateArchitectureDsl` 的 DSL → **不得**写入；继续与用户迭代问卷。
- 探测不到 `framework/` → **不得**生成假 framework；停下并指引 submodule。
- **未经用户明确选定 `agent_adapter`（具体 `adapter_name` 字符串）就进入 Step 0.3 体检 / 在降级提示里写入未按 Step 0.2.5 解析的具体入口文件名或 adapter 专有目录 / 写入 `framework.config.json.agent_adapter` / 拷贝任何 adapter `templates/` 下的文件 / 渲染入口文件** → 严禁；adapter 选定必须在 Step 0.2.5 完成，IDE 环境或目录痕迹只能作为**推荐值**亮给用户，不得当成用户决定。
- **Step 0.3 体检表或 CREATE→UPDATE 降级提示中，在未解析出唯一 `agent_entry_file.target_path` 前就并列写出两个可能的入口文件名** → 严禁，必须回到 Step 0.2.5 让用户显式选定后再打印体检表。
- **未经用户逐层显式确认 `outer_layers[*].intra_layer_deps` 就写入 `framework.config.json.architecture`** → 严禁；preset 默认值只能作为**推荐值**展示，必须按 Step 3.x gate（`1`=全部按默认 或 matrix 子菜单）拿到显式回复后才能落盘。
- 用户拒绝确认 diff（POPULATED 项）→ **该项跳过**，**不得**强行覆盖；但允许其它 MISSING / EMPTY 项继续写入，并在 Step 7 如实列出被跳过清单。
- **跳过 Step 0.3 体检直接写入** → 严禁；任何写操作前必须先完成体检并打印汇报表。
- **覆盖 POPULATED 的 `doc/module-catalog.yaml` / `doc/glossary.yaml` / `doc/glossary-seed.txt` / `doc/architecture.md` / `doc/features/**`** → 严禁，无论用户是否要求；这些均属持续积累资产或手工迭代产物，本 Skill 不是它们的维护者，请引导用户走 `catalog-bootstrap` / `glossary-bootstrap` / 手工删除后重跑。
- CREATE 模式体检命中 POPULATED 而用户未同意强制降级为 UPDATE → 终止本次 `/framework-init`。
- Step 5.5 的 `npm install` 失败 → **不得**跳过直接跑 Step 6；**不得**擅自改 registry 或 `.npmrc` 绕过；按 5.5.3 三点让用户排查后重试。
- **Step 5.5.4 的 `npm test` 自检失败而进入 Step 5.6 / Step 6** → 严禁；**不得**用 `--filter` 缩小集合凑 PASS、**不得**把失败解释为"环境问题"绕过（framework 自带套件不依赖任何外部工具链）。失败必须按 5.5.4.2 排查清单一项一项过，全绿后才能继续。
- **未经用户显式确认宿主工具链 `installPath`（字段路径以 profile addendum / `detect-*.ts` 为准）就写入 `framework.config.json`** → 严禁；自动探测结果只能作为**推荐值**，必须按 profile addendum 拿到用户 `y` 或自定义路径回复后才能落盘；用户回 `跳过` 视为显式拒绝，不写入但必须按 addendum 列入 Step 7 跳过项汇报。
- **`tool-call retry-loop Ban`（v2.8.3 BLOCKER）**：在 Step 4.1 渲染 entry-file 时，**严禁**对同一种工具路径连续失败 ≥ 2 次后继续重试。详细纪律见 §4.1.3：
  - 兜底路径（手工 Read + Write）失败 ≥ 2 次 → 必须切首选脚本路径 `render-agents-md.mjs`，**严禁**第三次重试 Write 工具；
  - 首选脚本路径也失败 → 把 exit_code / stdout / stderr 原样反馈给用户请求人工介入，**严禁**再切回兜底路径循环重试；
  - **严禁**在 SKILL 之外的 README / 跳板 / 用户回复里把脚本路径描述为"可选辅助"——v2.8.3 起脚本路径是首选 / 默认 / 弱模型强制路径，措辞不容偷换。
  事故现场：弱模型（如内网 lingxi-v3 / minimax-m2.7）在调用 Write 工具构造 200+ 行中文 markdown content 时会返回 `InputValidationError: The required parameter file_path / content is missing`，AI 重试两次仍失败、无法恢复、整个 init 流程卡死直到用户重启会话。本条 ban 是该事故的根本性补丁。
- **`multi-question single-y Ban`（v2.8.2 BLOCKER）**：在 Step 0.3.4 决策收集阶段，若需要决策的 Q 数 ≥ 2，**禁止**接受裸 `y` / `yes` / `好` / `继续` / `1` 这类无 Q 编号的回复并将其解释为"对所有 Q 都同意"。任何这类含混回复必须按 0.3.4.3 退化为逐题再问；**严禁**：
  - 把单个 `y` 自由解释为「Q1=y AND Q2=y AND ...」；
  - 在 Step 4 / Step 4.1 / Step 5.1 等下游小节再次发起独立 y/n 询问（决策必须从 Step 0.3.4 已记录的结果读，下游不重问）；
  - 同一轮消息里把**入口文件**覆盖确认 + **adapter 模板多项**漂移确认**并排抛出两个独立 y/n 问题**（这是事故现场，已发生）；正确做法是回 Step 0.3.4 一次性收齐结构化回复。
  事故现场：v2.8.1 后用户在真实工程跑 init，Step 4 同时抛出两个独立 y/n（入口 + 多文件模板），用户回 `y`，AI 解释为"两个都覆盖"并连续执行——这违反 [`{{AGENT_ENTRY_FILE}}` §6.5 反假设条款](../../templates/AGENTS.md.template)。本条 ban 是该事故的根本性补丁。
- **`init-diff Hallucination Ban`（v2.6 BLOCKER）**：禁止在 Step 0.3 任何位置自行描述 11 项体检的 `MISSING/EMPTY/POPULATED` 状态、字节相等性、hash 一致性、与模板的差异程度。所有判定**必须且只能**来自 [framework/harness/scripts/check-init.ts](../../harness/scripts/check-init.ts) 生成的 `check-init.json`。下列措辞一律视作幻觉、本次 init 失败、必须退出回到 Step 0.3.0 重新跑脚本——
   - "入口文件当前已与模板渲染结果一致"
   - "diff 无实质变更"
   - "差异主要是项目特定内容"
   - "基于 DSL 已渲染"
   - "与模板字节相等" / "与骨架基本一致" 等任何无 sha256 + diff_summary 支撑的"一致性"声明
   - 任何**口头描述体检判定**（而未先执行 `npx ts-node harness-runner.ts --phase init --adapter <X>` 并搬运脚本输出）的行为

  事故现场背景：v2.6 之前 SKILL 把 11 项判定交给 AI 自行执行，弱模型在内网移植时把**入口文件**与新模板（含 commit `a234ca7`）的真实 diff 描述为"已与模板一致"，从而绕过用户 y/n 确认。本条 ban 是该事故的根本性补丁，不接受任何"diff 太大读不下"为理由的偷懒；脚本输出有 50 行截断和聚合 hash，已经控制了上下文体积。

---

## 关联文件

| 类型 | 路径 |
|------|------|
| Adapter 协议 | [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) |
| adapter 插件 | [framework/agents/](../../agents/README.md) |
| 共享 AGENTS 模板 | [framework/templates/AGENTS.md.template](../../templates/AGENTS.md.template) |
| Config 与 DSL 校验 | [framework/harness/config.ts](../../harness/config.ts) |
| 宿主工具链探测脚本（由 profile addendum 引用时启用） | profile addendum → [framework/harness/scripts/detect-deveco.ts](../../harness/scripts/detect-deveco.ts) |
| 扫描 prompt | [prompts/scan-project.md](prompts/scan-project.md) |
| 预设与问卷 | [prompts/architecture-presets.md](prompts/architecture-presets.md)、[templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md) |
| PRD harness：opt-in `prd` 段与 Visual Handoff | [prompts/prd-harness-options.md](prompts/prd-harness-options.md) |

---

## CLI / 自动化备注

通过 adapter 暴露的 init 触发方式（如 slash，名称以该 adapter 模板为准）进入时，若用户需要交付 trace，路径与字段见 [framework/harness/trace/trace.schema.json](../../harness/trace/trace.schema.json)；phase 可记为 `framework-init` 或项目约定的 `catalog` 前置步骤。

**中文输出。**
