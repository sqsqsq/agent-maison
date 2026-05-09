# 模块画像与术语表自举 Skill (`0-catalog-bootstrap`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 将读写的 catalog、glossary、架构说明等 **paths** 与 **`architecture` 段**已由初始化落地或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

## 概述

你是一位按当前 `project_profile` 自适配的工程架构分析师。实际工作中请以目标实例工程的 `framework.config.json` / `doc/architecture.md` 与 profile addendum 为准。
你的任务是在**已有真实代码工程**上，为之建立两份"单一事实源"：

- `doc/module-catalog.yaml` — 每个模块的画像卡（职责 / `NOT_responsible_for` / `easily_confused_with` / 业务术语）
- `doc/glossary.yaml` — 业务自然语言 ↔ 权威模块映射表

本 Skill 是所有后续 Skill（1~6）的**前置**，只有这两个文件建好，PRD 阶段的「术语消歧」和「Scope 声明」才有可校验的基准。

## Step 0. 载入 `project_profile` addendum（强制）

进入任一 Phase（A/B）的步骤前，完整阅读：

`framework/profiles/<project_profile.name>/skills/0-catalog-bootstrap/profile-addendum.md`

`<project_profile.name>` 取自 `framework.config.json > project_profile.name`（未声明时默认 `hmos-app`）；文件不存在则仅依赖本 SKILL 正文与宿主 `doc/` 路径。

---

## 触发条件

- "建 catalog / 建模块画像"
- "术语表 / glossary / 初始化 glossary"
- `/catalog-bootstrap <ModuleName>`
- `/glossary-bootstrap`
- 用户明确说"这两个文件在真实工程里内容不对，要重建 / 批量修正"

## 核心设计原则（弱模型友好）

1. **一次一个模块**：绝不让模型一次啃 30 个模块。`catalog-bootstrap` 每次只处理 1 个模块，保证上下文 ≪ 200K。
2. **staging 隔离 + 对话式确认**（**默认流程**）：
   - AI 先把草稿写到 `doc/catalog-staging/<Module>.yaml` / `doc/glossary-staging/<term>.yaml`（审计留档）
   - 然后在对话里把**人友好的汇总**展示给用户，用户只需回 `y / n / 改 XXX` 的短回复
   - AI 根据用户口头回应**自主**翻转 `confirmed_by_user` 并立即合并
   - **用户无需手动打开 staging 文件改 flag**。手动模式仅作为 fallback 存在（见下方 Step 5.4 / 3.5）。
3. **AI 绝不直接改** `doc/module-catalog.yaml` / `doc/glossary.yaml` 除非拿到用户 `y`。<br>&nbsp;&nbsp;**唯一例外**：Phase A / Phase B 的 Step 0——若文件完全不存在，AI 可以（且必须）自主创建只含 `schema_version` + 空数组的**骨架**，无需用户 `y`。骨架里禁止塞任何模块/术语条目。
4. **代码信号 + 文档信号双输入**：若有 `doc/architecture.md` / 模块 README，**优先读文档**；若无则按当前 profile addendum 声明的代码信号降级推导。
5. **harness 守门**：最终产物必须通过 `harness-runner.ts --phase catalog` / `--phase glossary` 的结构与交叉引用校验。

---

## Phase A：模块画像自举（`/catalog-bootstrap`）

### Step 0. 初始化骨架（**首次移植到新工程必做**）

先跑一次 harness，看 `module-catalog.yaml` 当前状态：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase catalog
```

**读报告并按下表动作（AI 自主执行，不要问用户"要不要建"）：**

| harness 报告 | AI 应做的动作 |
|-------------|---------------|
| `catalog_file_exists` FAIL：文件不存在 | **你自己**创建 `doc/module-catalog.yaml`，只写骨架（见下方骨架模板），**不加任何模块**。然后再跑一次 harness 确认变为 `modules_is_list` WARN（这是合法中间态）。 |
| `modules_is_list` WARN：已有骨架、`modules: []` | 骨架已就绪，进入 Step 1。 |
| 其它 FAIL | 把报告原文贴给用户、停下来问，不要试图"修复"。 |

**同时建好 staging 目录**（空目录也要建，让后续 Step 3 写入不会因为目录缺失报错）：

```
doc/catalog-staging/
```

> 本 Skill **不使用** `_merged/` 归档目录——合并成功即删 staging 文件，审计走 git 历史。若你在旧版仓库里看到 `doc/catalog-staging/_merged/`，请删掉它。

#### 骨架模板（直接用这段内容写入 `doc/module-catalog.yaml`）

```yaml
# SSOT: 模块画像目录 (Module Catalog)
# 由 Skill 0 · Phase A (`/catalog-bootstrap <ModuleName>`) 逐模块追加
# AI 绝不直接写入本文件，除非拿到用户在对话里的 `y` 确认

schema_version: "1.0"
modules: []
```

> **约束**：骨架里只能有 `schema_version` 和空 `modules`。**禁止**顺手塞示例模块——空列表会触发 `modules_is_list` 的 WARN 提示"尚未追加模块"，这是期望的中间态，不是错误。

### Step 1. 列出候选模块清单

**入口命令**：用户传入一个模块名，如 `/catalog-bootstrap FinancialCard`。

若用户**没指定**模块名，按以下顺序组装清单：
1. 按当前 profile addendum 声明的模块发现方式，得到"物理存在的模块"全集
2. 对比 `doc/module-catalog.yaml` 的 `modules[].name`，标记每个模块当前是 `未建档` / `已建档`
3. 把两类混合展示给用户，**让用户选一个**作为本轮目标。示例：

```
待建档（未在 catalog 中）：
  [1] BankCard
  [2] TransportCard
已建档（可进入 UPDATE 模式刷新画像）：
  [3] CardManager      最近提交动了对外导出入口，建议刷新
  [4] WalletMain       上次刷新 2 周前
...
选一个编号 / 模块名：
```

**禁止**：一次批量处理多个模块。每轮对话只处理一个。

### Step 1.5. 判别 CREATE / UPDATE 模式（**强制**）

用户指定（或从 Step 1 选中）模块名 `<M>` 后，**第一件事**是查 `doc/module-catalog.yaml` 判定本轮属于哪种模式：

```
if <M> ∈ modules[].name → UPDATE 模式（模块已建档，本轮是刷新）
else                    → CREATE 模式（新建）
```

两种模式在 **Step 2 / Step 3 / Step 4 完全相同**——都是重新采集输入信号、生成 staging、做自检清单。**唯一区别**在 Step 5.1 的对话展示格式（详见 §5.1）：

| 模式 | Step 5.1 展示 | Step 5.2 `q` 的含义 |
|---|---|---|
| CREATE | 完整新画像汇总表 | 丢弃 staging，主 catalog 不动（模块继续缺档） |
| UPDATE | **字段级 diff**（新 vs 旧），只高亮变更 | 丢弃本次刷新，保留旧画像不动 |

**禁止**：在 Step 5.1 展示前"忘记"自己是 UPDATE 模式——弱模型很容易一路跑下来按 CREATE 的格式输出，让用户以为是新建。本 Step 的判别结果**必须**在 Step 5.1 的展示标题里明示（`📦 <M>（新建）` 或 `🔧 <M>（更新已有画像）`）。

### Step 2. 采集"输入信号"（顺序很重要）

对**当前一个**模块 `<M>`，按优先级依次读：

| 顺序 | 来源 | 若存在 | 若缺失 |
|------|------|--------|--------|
| 1 | `doc/architecture.md` 里关于 `<M>` 的小节 | **强锚点**，作为职责定义主来源 | 降级到 2 |
| 2 | `<module_path>/README.md` | 辅锚点 | 继续到 3 |
| 3 | profile 声明的模块清单/包描述文件 | 读依赖与模块格式 | 若缺失则按 profile addendum 的降级策略处理 |
| 4 | profile 声明的对外导出入口 | 读公开符号 → `key_exports` | 列空数组 `[]` |
| 5 | profile 声明的源码目录树 | 不读全部源码，**只列目录结构**（深度 ≤ 3） | — |
| 6 | 最多 3 个关键文件的头部 60 行 | 仅用于确认职责（如 Repository/Service 的类名与 JSDoc） | — |

**上下文控制**：以上全部内容**单个模块**加起来应 < 30K token。大型工程里**不要**通读源码实现。若模块异常大，只读导出入口 + 目录树 + README。

### Step 3. 填充模块画像草稿

读取模板：

```
framework/skills/0-catalog-bootstrap/templates/module-card-template.yaml
```

按模板字段填写，**写到 staging 文件**：

```
doc/catalog-staging/<ModuleName>.yaml
```

字段填写要点（详见 `prompts/infer-module-card.md`）：

| 字段 | 如何填 |
|------|--------|
| `name` | 严格与 profile 识别出的包名或目录名一致 |
| `layer` | 从路径前缀推出：`01-Product` / `02-Feature` / `03-CommonBusiness` / `04-BusinessBase` / `05-SystemBase` |
| `sub_layer` | 若 architecture.md 里标注了"顶层 / 中间 / 底层"则填，否则 null |
| `format` | 根据 profile 声明的模块格式枚举填写 |
| `one_liner` | **一句话**核心价值。优先复制 architecture.md 原文，禁止自己发挥 |
| `responsibilities` | 3~6 条，每条具体到"这模块对外提供什么能力 / 持有什么数据" |
| `NOT_responsible_for` | **最重要**：列出"容易被误塞进来但不归它管"的事。**至少 3 条**，参考易混模块 |
| `typical_business_terms` | 业务团队/PM 在口头 / PRD 里称呼这个模块时用的词（反向索引） |
| `easily_confused_with` | 字面相似但语义不同的兄弟模块。每条含 `module` + `disambiguation`（判定规则） |
| `key_exports` | 从 profile 声明的对外导出入口提取主要公开符号，保留 ≤ 10 个 |
| `entry_file` | profile 声明的模块入口或导出入口相对路径 |

**禁止**：瞎编 `NOT_responsible_for` 和 `easily_confused_with`。这两个字段若没有证据就填 `[]`，**不要**凭字面相似硬造。宁可留空，等第二轮补全再加。

### Step 4. 自检清单

草稿写完后，对照以下清单自检：

```
[ ] 1. name 与目录名 / profile 包描述中的名称一致
[ ] 2. layer 的前缀与物理路径一致（不能把 03 层的模块写成 02）
[ ] 3. format 与 profile 声明的模块格式来源一致
[ ] 4. one_liner 不是"xxx 模块"这类空话
[ ] 5. responsibilities 每条都能在代码 / 架构文档里找到依据
[ ] 6. NOT_responsible_for 至少 3 条（或显式写 "# 暂无已知误塞反例"）
[ ] 7. easily_confused_with 的每个 module 都能在已有 catalog 或本次待建清单里找到
[ ] 8. staging 文件头部必须有 confirmed_by_user: false 字段
```

### Step 5. 在对话里逐条问用户确认（**默认交互式**）

这是本 Skill 的**标准确认方式**——staging 的 `confirmed_by_user` 字段是审计记录，**由 AI 根据用户口头回应来翻转**，用户不需要手动打开文件改 flag。

#### 5.1 展示草稿摘要（**人友好的汇总表，不是原始 YAML 转储**）

根据 Step 1.5 的模式判定结果选展示格式：

##### 5.1.A CREATE 模式展示格式（模块首次建档）

```
📦 <ModuleName>（新建）  草稿位置：doc/catalog-staging/<ModuleName>.yaml
──────────────────────────────────────────────────
Layer / Sub-layer:   02-Feature / 底层
Format:              <profile-format>
One-liner:           金融卡模块，内部包含银行卡和 HuaweiCard 两大分类
Responsibilities:
  1. 提供银行卡 CRUD 能力…
  2. 代理 HuaweiCard 的业务…
  3. …
NOT_responsible_for:
  1. 卡聚合 UI 页面（归 WalletMain）
  2. 跨卡种统一管理（归 CardManager）
  3. …
Easily_confused_with:
  • CardManager — 管理所有卡种的统一能力 vs 金融卡专有业务
Key_exports: [BankCardService, HuaweiCardService, ...]
Entry_file:  <profile-entry-file>

Signals used:
  ✓ architecture.md  ✓ profile package descriptor  ✓ public export entry  ✗ README.md  (目录树 depth=3)
```

##### 5.1.B UPDATE 模式展示格式（**字段级 diff，只高亮变更**）

> **为什么不用 CREATE 格式**：整份画像再给用户看一遍，用户要自己用肉眼跟旧版本比对——几百行 YAML 一扫一个不准。UPDATE 模式的核心价值是 **"告诉用户改了什么，没改的别让用户浪费注意力"**。

实现步骤（AI 在对话前本地完成）：

1. 读 `doc/module-catalog.yaml` 里的旧 `modules[name==<M>]` 子树作为 `old`
2. 读本轮刚生成的 `doc/catalog-staging/<M>.yaml` 的 `module:` 子树作为 `new`
3. 按字段逐一对比，分三类：
   - **changed**：`old[k] !== new[k]`（对数组/对象做 JSON 规范化后再比）
   - **added**：`k` 只在 `new` 里有值（旧是 `null` / `[]` / 缺字段）
   - **removed**：`k` 只在 `old` 里有值
   - **unchanged**：完全相等 → 折叠成一行"✓ 其他 N 个字段无变化"

展示格式：

```
🔧 <ModuleName>（更新已有画像）  草稿位置：doc/catalog-staging/<ModuleName>.yaml
──────────────────────────────────────────────────
⚠ one_liner:
    旧：管理所有卡种的统一能力，包括增删改查/数据订阅/功能代理
    新：管理所有卡种的统一能力，包括增删改查/订阅/代理/事件总线

⚠ responsibilities:
    + "对外提供统一事件总线 CardEventBus"      ← 新增
    - "持有卡面样式配置"                        ← 删除（已移交 WalletMain）
    · 其它 4 条不变

⚠ key_exports:
    旧：[CardManager, CardRepository, CardService]
    新：[CardManager, CardRepository, CardService, CardEventBus]

⚠ easily_confused_with:
    + module: PassManager   disambiguation: "Pass 是专有名词代指…"

✓ 其他 6 个字段无变化（name, layer, sub_layer, format, NOT_responsible_for, entry_file）

Signals used:
  ✓ architecture.md  ✓ profile package descriptor  ✓ public export entry  ✗ README.md  (目录树 depth=3)
```

**硬约束**：
- **unchanged 字段绝不能展开**——展开就违背了 diff 视角的初衷
- 若某字段是数组或对象，**逐元素 diff**（展示 `+ <new>` / `- <old>`），**不要**整数组贴新旧两份
- 若某字段被完全清空（`[]` → 非空 / 非空 → `[]`），标 `[EMPTIED]` 或 `[FIRST-FILLED]` 前缀让用户立刻注意到
- 若 diff 的变更字段数 > 6（半数以上字段都在动），AI 应在末尾加一行警告：`⚠ 本轮变更范围较大（N 个字段），建议确认是否 <M> 模块发生了重大重构`——让用户警惕"这到底是刷新还是误操作"

#### 5.2 邀请用户给简短回复

**只问一个问题**，不要一次塞一堆选项让用户找：

> 请选择：
>   `y` 确认并合并
>   `e <修改指令>` 修改某字段（例：`e 把 one_liner 改成 XXX` / `e 给 NOT_responsible_for 加一条："不处理卡面样式"` / `e 删掉 easily_confused_with 的 CardManager`）
>   `s` 跳过（staging 保留，之后再决定）
>   `q` 作废

| 回复 | CREATE 模式下的含义 | UPDATE 模式下的含义 |
|---|---|---|
| `y` | 把新画像追加到 catalog | 用新画像**整条替换**旧画像（旧版靠 git 历史找回） |
| `q` | 删 staging，模块继续缺档 | 删 staging，**保留旧画像不动**（本次刷新作废） |

#### 5.3 按用户口头回复处理（AI 自主动作，不再要求用户改文件）

| 用户回复 | AI 动作 |
|---------|---------|
| `y` / `确认` / `OK` / `是` | ① 把 staging 文件的 `confirmed_by_user` 字段改为 `true`（git 能抓到"AI 确认合并前"的那一瞬间，作为审计痕迹）<br>② 立即执行 Step 6 合并<br>③ **删除** staging 文件（审计靠 git 历史）<br>④ 报告"已合并并删除 staging"然后停止 |
| `e <修改指令>` / 自然语言改某字段 | ① 按指令 patch staging 文件（只动用户点名的字段）<br>② 重新展示 Step 5.1 汇总表<br>③ 再次问 Step 5.2 |
| `s` / `跳过` / `稍后` | 保留 staging 不动，告知"staging 已留档，下次回来可直接说'继续确认 FinancialCard'" |
| `q` / `作废` / `丢弃` | 删除 staging 文件，不合并 |

#### 5.4 硬约束（**本 Skill 最重要的几条纪律**）

1. **禁止**在未收到用户明确 `y` / `确认` 前合并到 `doc/module-catalog.yaml`。
2. **禁止**为了省事把 `easily_confused_with` 展示折叠——哪怕只有一条也要完整展示判定规则（这是 Scope 守门的真正入口）。
3. **禁止**一轮对话连续处理多个模块的确认；每次只处理 1 个，确认完让用户自行决定是否继续下一个。
4. **若用户想手工审阅整份 YAML**：可以主动请求"打开 staging 原文给我看看"，AI 再把完整 YAML 贴出来。但这只是补充手段，不是默认流程。

> **异步批量模式（fallback）**：若用户明确说"我要自己慢慢看 N 个 staging 再统一合并"，则退回"用户手动改 `confirmed_by_user: true` + `/catalog-merge` 批量合并"的老路。这属于少数场景，不是默认。

### Step 6. 合并到主 catalog（由 Step 5.3 `y` 分支或用户显式 "合并" 触发）

1. **确认合并范围**：
   - 从 Step 5.3 `y` 来 → 范围 = 当前这个模块的 staging
   - 用户显式说"合并所有 / merge all" → 扫描 `doc/catalog-staging/*.yaml`，筛出 `confirmed_by_user: true` 的
2. 对每个已确认 staging，**追加**到 `doc/module-catalog.yaml` 的 `modules` 列表末尾（若已存在同名模块，则**替换**整条）。合并时**只取 staging 的 `module:` 子树**，`confirmed_by_user` / `generated_by` / `generated_at` / `signals_used` 等元数据**不进**主 catalog。
3. **删除**已合并的 staging 文件（`fs.unlink` / `rm` 均可）。审计溯源靠 git 历史——主 catalog 的 commit message 用下列约定方便回查：
   - CREATE 模式：`catalog: add <ModuleName> via Skill 0`
   - UPDATE 模式：`catalog: refresh <ModuleName> via Skill 0 (<变更摘要>)`<br>&nbsp;&nbsp;&nbsp;&nbsp;其中 `<变更摘要>` 取 Step 5.1.B diff 里动过的字段名列表，如 `one_liner + key_exports + easily_confused_with`
4. 跑 `harness-runner.ts --phase catalog` 做结构校验并把结果贴给用户

**禁止**：
- 手动重排 `modules` 顺序或改 `schema_version`。
- 把 staging 的 `generated_by` / `signals_used` 等元数据带进主 catalog。
- 合并成功却不删 staging，或把 staging 移到 `_merged/`（本 Skill 已废弃该归档目录）。

### Step 6.5. 同步 architecture.md（架构级事件时触发）

catalog 的变化常伴随 `doc/architecture.md` 的架构级变更，按下表判定：

| catalog 变化类型 | 对应架构影响等级 | 需同步 architecture.md 的小节 |
|------------------|------------------|------------------------------|
| 新增模块 / 下线模块 / 迁到不同外层 | `module_set_change` | 业务模块清单增删一行（模块名 + 所属外层 + 一句话职责） + 架构级变更记录追加一行 |
| 某模块 `primary_responsibility` 大幅重写 | `responsibility_rewrite` | 业务模块清单该模块的「一句话职责」+ 架构级变更记录追加一行 |
| 仅新增/修改 `exposed_capabilities_public` 等能力项，职责未变 | 非架构级 | **不改** architecture.md |

操作要点：

- 只维护 architecture.md 的**极简模块清单**（模块名 + 所属外层 + 一句话职责 + 链到 catalog），不要把 catalog 的完整字段复制过来——`doc/module-catalog.yaml` 是这些细节的唯一 SSOT。
- 架构级变更记录表的准入条件和触发时机以 [Skill 2 · Step 12](../2-requirement-design/SKILL.md) 为准，事件描述格式：`| YYYY-MM-DD | module_set_change \| responsibility_rewrite | <具体变化> |`。
- 若 catalog 变化是由一个具体 feature 的 design 驱动的，且该 design 已经声明了 `architecture_impact != none`，则在 Skill 2 · Step 12 分支中统一处理，不要在本 Skill 里重复追加。

### Step 7. 第二轮补全 `easily_confused_with`（所有模块建完后）

当 catalog 已覆盖工程的大部分模块（≥ 80%）时，提议跑第二轮：

- 扫描整个 catalog，对字面相似的模块对（如 XxxManager vs XxxCenter）提示用户考虑加 `easily_confused_with`
- 每条仍然走 staging → 用户确认流程

---

## Phase B：术语表自举（`/glossary-bootstrap`）

### 前置条件

Phase A 已建好 ≥ 80% 模块的 catalog。否则 Phase B 的"反向查 canonical_module"没法做。

### Step 0. 初始化骨架（**首次必做**）

先跑一次 harness：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase glossary
```

**按下表动作（AI 自主执行，不要问用户）：**

| harness 报告 | AI 应做的动作 |
|-------------|---------------|
| `glossary_file_exists` FAIL：文件不存在 | **你自己**创建 `doc/glossary.yaml`，只写骨架（见下方模板），**不加任何术语**。然后再跑一次 harness 确认变为 `terms_is_list` WARN。 |
| `terms_is_list` WARN：已有骨架、`terms: []` | 骨架就绪，进入 Step 1。 |
| `canonical_module_exists_in_catalog` 之类依赖 catalog 的 check 报错 | 说明 `doc/module-catalog.yaml` 覆盖率不足。**停下来**提示用户先跑完 `/catalog-bootstrap`，禁止先把 glossary 建起来。 |

**同时建好 staging 目录**：

```
doc/glossary-staging/
```

> 同 Phase A：合并成功即删 staging 文件，**不用** `_merged/` 归档目录，审计走 git。

#### 骨架模板（直接写入 `doc/glossary.yaml`）

```yaml
# SSOT: 业务术语 ↔ 技术模块映射表 (Glossary)
# 由 Skill 0 · Phase B (`/glossary-bootstrap`) 逐条追加
# AI 绝不直接写入本文件，除非拿到用户在对话里的 `y` 确认

schema_version: "1.0"
terms: []
```

### Step 1. 收集种子术语清单（**AI 自动生成带注释模板，不要空手等用户**）

种子文件路径固定为 `doc/glossary-seed.txt`（纯文本，每行一个业务名词；`#` 开头的行为注释，harness 与后续逻辑都会忽略）。

#### 1.1 检测文件是否存在

| 情况 | AI 动作 |
|------|---------|
| 文件不存在 | **你自己**用下方模板创建 `doc/glossary-seed.txt`，然后**停下来**提示用户去填，**不要**继续 Step 2 |
| 文件存在但全是注释 / 空行 / 只有占位内容（无实际术语） | 报告"种子清单仍为空，请按文件顶部说明填入业务名词"，**停下来**等用户 |
| 文件存在且含 ≥ 1 条非注释非空白行 | 进入 Step 2 |

#### 1.2 创建种子模板（AI 自动写入）

把下面这段**原封不动**写到 `doc/glossary-seed.txt`：

```text
# ============================================================================
# 业务术语种子清单 (doc/glossary-seed.txt)
# ============================================================================
# 作用：供 Skill 0 Phase B 用来反向查 canonical_module。每条会在对话里
#      让 AI 给出匹配建议，然后由你 y/e/s/q 决定怎么入 glossary.yaml。
#
# 格式：
#   - 纯文本，每行一个业务名词
#   - 以 # 开头的行 = 注释，程序忽略
#   - 空行被忽略
#   - 顺序不重要，但建议按"页面/入口/动作/功能"大致分组
#
# 怎么整理你的种子清单（**必须由你自己来，AI 不准代编**）：
#   1) 翻你过去 3 个月的 PRD / 需求评审纪要，把里面出现的业务名词摘下来
#   2) 看产品原型图，把 Tab / 页面标题 / 功能卡片标题 / Banner 文案摘下来
#   3) 想想你和 PM / 测试口头讨论时常用的功能称呼
#   4) 特别要收录"意思相近但字面不同"的词（例如：卡中心 / 卡管理 / 卡包
#      这种 3 个字面都像、但归属完全不同的词组），这才是 glossary 真正的价值
#
# 规模建议：真实工程一般 50-150 条；沙盒 10-30 条足够验证流程
# ----------------------------------------------------------------------------
# 删掉本注释块之前，先把下方示例删掉，按"# --- 分组名 ---"自己分组；
# 示例里的词**不代表本工程必有**，它们只是提醒你"这类词要收录"。
# ============================================================================

# --- 页面 / 入口 类 ---
# 首页
# 我的
# 卡包
# 添卡入口
# 设置

# --- 业务对象 类（以钱包工程为例，仅演示分组填法，实际按自己工程替换）---
# 钱包账户
# 卡中心
# 卡管理
# 优惠券

# --- 动作 / 功能 类 ---
# 刷卡
# 登录
# 扫码支付

# --- 易混组：同层兄弟 / 字面相似 / PM 混用 类 ---
# 账号
# 账户
```

#### 1.3 停下来告诉用户

模板建完后，在对话里提示（**别继续 Step 2**）：

> 已创建 `doc/glossary-seed.txt` 模板。请你按文件头部注释整理种子清单（一行一个业务名词，`#` 开头为注释）。填完后对我说"种子清单填好了"或再次触发 `/glossary-bootstrap`，我会走 Step 2。

#### 1.4 硬约束

- **禁止** AI 凭印象 / 从 `doc/architecture.md` 里自动提取词作为种子——那等于 AI 自问自答，失去用户视角的"真实业务口径"
- **禁止** 把 `typical_business_terms`（catalog 的反向索引字段）直接当种子——那只会让 glossary 变成 catalog 的字面重排
- **允许** 在用户填完后做一次"可疑漏项"提示（例："你填了'卡包'但没填'添卡'，要不要也加上？"），但不替用户决定

### Step 2. 逐条术语提出映射建议（一次一条或一批）

对每个术语 `<T>`，读 `doc/module-catalog.yaml`，执行 `framework/skills/0-catalog-bootstrap/prompts/infer-glossary-term.md` 的 Step 1 → Step 6，核心骨架：

0. **输入预检：种子技术词守门**（prompt **Step 1 前置，强制**）：读种子清单时，对每行执行 `^[A-Z][a-zA-Z0-9]+$` 正则 + `catalog.modules[].name` 重名检测；命中即停并提示用户修复（三选一：删除 / 改业务自然语言 / 加入 `doc/glossary-seed-allowlist.txt`）。harness `--phase glossary` 会以 BLOCKER 兜底。
1. **精确匹配**（prompt Step 1）：`<T>` 是否出现在某模块的 `typical_business_terms` 里？若是 → 置信度 `high`
2. **反向扫描 NOT_responsible_for**（prompt **Step 1.5，强制**）：若命中模块的 `NOT_responsible_for` 文本包含 `<T>` → 触发 catalog 内部冲突，`match_kind = typical_term_with_not_responsible_for_conflict`，置信度降一级
3. **模糊匹配**（prompt Step 2）：`<T>` 是否作为子串出现在任何模块的 `typical_business_terms` / `one_liner` / `responsibilities` 里？→ 置信度 `medium`，列 Top-3 候选
4. **反向指针扫描**（prompt **Step 2.5，强制，仅当 Step 1/2 全空时跑**）：用正则从 `NOT_responsible_for` 抓"属 X 模块"/"归 Y 类模块"/"→ Z"式反向指针；命中 → `match_kind = negative_hint_pointer`、canonical 仍填 TBD、candidates_top3 里给出被指向的模块名 + 原文片段
5. **未命中**（prompt Step 3）：无任何线索 → 置信度 `low`，要求用户补充该术语所指代的场景
6. **alias-merge 分支**（prompt **Step 4.5，强制**）：写 staging 前扫已入库 `glossary.yaml` + 同批 staging；若存在同 canonical、字面相似（子串/相似度 ≥ 0.5）的 `<T'>`，`match_kind = alias_merge_candidate`，展示时默认推荐 `e 并入 <T'>`

> Step 0（输入预检）、Step 1.5、Step 2.5、Step 4.5 均是**弱模型护栏**，不可省略。详细规则见 `prompts/infer-glossary-term.md`。

对每条术语生成 staging 条目：

```
doc/glossary-staging/<term>.yaml
```

模板见 `framework/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml`。

**易混项强制补全**：若匹配到的 `canonical_module` 在 catalog 里有 `easily_confused_with`，必须把对应条目复制到 staging 的 `easily_confused_with`，让用户直观看到"这个术语也可能被理解成隔壁模块"。

### Step 3. 在对话里逐条问用户确认（**默认交互式，同 Phase A**）

staging 落地后，**不要一次把 N 条全部 dump 出来**——逐条在对话里询问，用户给口头 `y/n/改` 即可，AI 负责更新 staging flag 和合并。

#### 3.1 开场：告知本轮总数与分布

```
已落 15 条 staging 到 doc/glossary-staging/：
  high: 9 条    medium: 4 条    low: 2 条（"GeneralPassCard"、"卫星卡"）

开始逐条确认，你只要回 y/n/改 xxx 就行：
```

#### 3.2 逐条展示 + 提问（对每条术语）

```
【1/15】术语："卡中心"
───────────────────────────────────
匹配置信度: high
Canonical module: WalletMain (02-Feature)
匹配依据: typical_business_terms[3] = "卡中心"
Aliases: []

⚠️ 易混项（必读，Scope 守门入口）：
  • 卡管理 (CardManager) — "卡中心" 指 UI 聚合入口页；"卡管理" 指跨 Feature 的卡 CRUD 服务。
    判定：PRD 若描述"用户打开、滚动、点击"的行为 → WalletMain；若描述"增删改查 / 数据订阅" → CardManager。

Sample usage: "用户打开卡中心可以看到所有卡片"

请选择：y（确认） / e <改指令>（例："改 canonical 为 CardManager"、"加 alias: 卡聚合页"） / s（跳过） / q（作废）
```

#### 3.3 按用户口头回复处理

| 回复 | AI 动作 |
|------|---------|
| `y` / `确认` | ① staging 的 `confirmed_by_user: true`（git 能抓到合并前瞬间）<br>② 立刻合并本条到 `doc/glossary.yaml`（只取 `term:` 子树，`generated_by` / `match_info` 等元数据**不进**主 glossary）<br>③ **删除** staging 文件（审计靠 git 历史）<br>④ 进入下一条【N/Total】 |
| `e <指令>` | ① 按指令 patch staging（只动点名字段）<br>② 重新展示 3.2 汇总<br>③ 再次问 y/e/s/q |
| `s` / `跳过` | 保留 staging，跳到下一条 |
| `q` / `作废` | 删除 staging，跳到下一条 |

#### 3.4 收尾

遍历完所有 staging 后，汇报：

```
✅ 本轮完成：合并 N 条，修改 M 条，跳过 K 条，作废 L 条
剩余 staging（s 跳过的）：<列表>

运行 harness 校验：
cd framework/harness && npx ts-node harness-runner.ts --phase glossary
```

然后**停止**。不要自动跑 harness（让用户决定）。

#### 3.5 硬约束

1. **禁止**一次把多条 glossary 合并请求打包问"这批都 y 吗？"——每条必须独立展示易混项再问，弱模型上这一步最容易塌。
2. **禁止**在未 `y` 前就写入 `doc/glossary.yaml`。
3. **禁止**为了省事把 `easily_confused_with` 折叠；哪怕 high 置信度也要把 catalog 里那条 disambiguation 完整贴出来。
4. **异步批量模式（fallback）**：若用户明确说"我要自己批量改 staging 后一次合并"，退回 "用户手动改 `confirmed_by_user: true` + 用户显式要求合并" 的老路。

### Step 4. 合并到 glossary.yaml（由 Step 3.3 `y` 分支触发）

1. 把 staging 的 `term` 子树追加到 `doc/glossary.yaml` 的 `terms[]`（若已存在同名 term 则替换整条）。`confirmed_by_user` / `generated_by` / `match_info` 等元数据**不进**主 glossary。
2. **删除**已合并的 staging 文件。审计溯源靠 git 历史——commit message 建议带 `via Skill 0 from <term>.yaml`。
3. （Step 3.4 收尾时）提示用户跑 `harness-runner.ts --phase glossary`

**禁止**：保留 staging 不删，或把 staging 移到 `_merged/`（本 Skill 已废弃该归档目录）。

---

## Harness 验证门禁

两个新增 phase：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase catalog
cd framework/harness && npx ts-node harness-runner.ts --phase glossary
```

> 注意：这两个 phase **无需 `--feature` 参数**（它们是全局文件，不归属于任何 feature）。

### catalog 阶段检查项（完整列表见 `framework/specs/phase-rules/catalog-rules.yaml`）

- **Structure**：schema_version 存在；每条 module 必填字段完整；layer 值合法；format 属于当前 profile 声明的合法集合；name 不重复
- **Traceability**：`easily_confused_with.module` 指向的模块必须在本文件内存在；`entry_file` 路径在磁盘上真实存在（WARN）；`key_exports` 与该模块 profile 导出入口的 top-level export 保持同步（漂移即 WARN）；**feature 反向完整性**（`feature_scope_integrity` WARN）：扫描 `doc/features/*/PRD.md` 与 `design.md` 的 Scope 声明，提示哪些 feature 引用了本 catalog 未建档的模块——这些 feature 在跑 `--phase prd/design` 时会 BLOCKER on `scope_matches_catalog`，catalog 阶段提前告警。

### glossary 阶段检查项（完整列表见 `framework/specs/phase-rules/glossary-rules.yaml`）

- **Structure**：schema_version 存在；每条 term 必填字段完整；term 不重复；aliases 跨 term 不重复
- **Traceability**：`canonical_module` 必须存在于 `doc/module-catalog.yaml`；`owner_layer` 与 catalog 中该模块的 layer 一致；`easily_confused_with.module` 必须存在于 catalog

---

## 输出规范

| 产出 | 路径 | 阶段 |
|------|------|------|
| 模块画像 staging（合并后删） | `doc/catalog-staging/<Module>.yaml` | Phase A Step 3 → Step 6 删 |
| 已合并 catalog | `doc/module-catalog.yaml` | Phase A Step 6 |
| 术语种子 | `doc/glossary-seed.txt`（用户提供） | Phase B Step 1 |
| 术语 staging（合并后删） | `doc/glossary-staging/<term>.yaml` | Phase B Step 2 → Step 4 删 |
| 已合并 glossary | `doc/glossary.yaml` | Phase B Step 4 |

> **审计方式**：staging 生命周期 = "AI 写入 → 用户 `y` 后翻 flag → 合并 → 删除"。这三步之间的状态都能被 git `log -p --follow doc/catalog-staging/<Module>.yaml` 回放，包括 `generated_by` / `signals_used` 等元数据；因此不再保留 `_merged/` 归档目录。

---

## 关联文件

- 模块画像模板：[templates/module-card-template.yaml](templates/module-card-template.yaml)
- 术语条目模板：[templates/glossary-term-template.yaml](templates/glossary-term-template.yaml)
- 模块画像推断 prompt：[prompts/infer-module-card.md](prompts/infer-module-card.md)
- 术语映射推断 prompt：[prompts/infer-glossary-term.md](prompts/infer-glossary-term.md)
- Catalog 阶段规约：`framework/specs/phase-rules/catalog-rules.yaml`
- Glossary 阶段规约：`framework/specs/phase-rules/glossary-rules.yaml`
- Catalog 检查脚本：`framework/harness/scripts/check-catalog.ts`
- Glossary 检查脚本：`framework/harness/scripts/check-glossary.ts`

---

## 下游消费者

本 Skill 的产出是整个框架的**起点**。建好之后所有 Skill 都会消费：

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 1 (PRD)** Step 1.5 | catalog + glossary | 术语消歧、Scope 声明校验 |
| **Skill 2 (Design)** Step 2.5 | catalog | Scope 扩展提议时查候选模块 |
| **harness check-prd** | catalog + glossary | `scope_matches_catalog` / `terminology_mapping_table` BLOCKER |
| **harness check-design** | catalog | `scope_consistency_with_prd` 交叉校验 |

---

## 约束与反模式

1. **禁止**一次对话处理多个模块。
2. **禁止**AI 未经用户 `y` 就直接改 `doc/module-catalog.yaml` / `doc/glossary.yaml`。
3. **禁止**`NOT_responsible_for` / `easily_confused_with` 凭字面瞎编；宁可空也不要错。
4. **禁止**跳过用户确认步骤直接合并；即使用户只回了 `好的` / `嗯` 这类歧义应答，也要再次问一句"确认 y 合并吗？"——**禁止把暧昧答复当作 `y`**。
5. **禁止**一次列 N 条 glossary 等用户"一起 y"——每条必须独立展示易混项再问。
6. **禁止**为了让用户省事，悄悄折叠/截断 `easily_confused_with` 和 `NOT_responsible_for`——这两个字段是 Scope 守门真正入口，必须完整展示。
7. **禁止**为了绕过 harness FAIL 而修改 `schema_version` 或删除必填字段。
8. 中文输出。

---

## Slash / 快捷入口触发时的 trace 约定

通过适配器下发的 slash（如 `/catalog-bootstrap`、`/glossary-bootstrap`，命令名以实例根模板为准）进入本 Skill 时，**必须**在阶段结束前产出 trace：

```
framework/harness/reports/_catalog/<timestamp>/<model>-catalog/trace.json
framework/harness/reports/_glossary/<timestamp>/<model>-glossary/trace.json
```

（`_catalog` / `_glossary` 是特殊 feature 标识，表示这是全局性产物）

其它约定同其他 Skill：gap-notes.md + check-*.report.md 同目录产出。
