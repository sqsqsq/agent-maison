# catalog-bootstrap 详细流程（条件加载：执行 Phase A/B 任一步骤时读）

> SSOT 索引见 [`skills/project/catalog-bootstrap/SKILL.md`](../project/catalog-bootstrap/SKILL.md)。本文承载 Phase A（模块画像）与 Phase B（术语表）的完整分步流程；触发条件/核心原则/门禁表仍以主文档为准。

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

**同时建好 staging 目录**（空目录也要建，让后续 Step 3 写入不会因为目录缺失报错）：`doc/catalog-staging/`

> 本 Skill **不使用** `_merged/` 归档目录——合并成功即删 staging 文件，审计走 git 历史。若你在旧版仓库里看到 `doc/catalog-staging/_merged/`，请删掉它。

#### 骨架模板（直接用这段内容写入 `doc/module-catalog.yaml`）

```yaml
# SSOT: 模块画像目录 (Module Catalog)
# 由 catalog-bootstrap · Phase A (`/catalog-bootstrap <ModuleName>`) 逐模块追加
# AI 绝不直接写入本文件，除非拿到用户在对话里的 `y` 确认

schema_version: "1.0"
modules: []
```

> **约束**：骨架里只能有 `schema_version` 和空 `modules`。**禁止**顺手塞示例模块——空列表会触发 `modules_is_list` 的 WARN 提示"尚未追加模块"，这是期望的中间态，不是错误。

### Step 1. 列出候选模块清单

**入口命令**：用户传入一个模块名，如 `/catalog-bootstrap <ModuleFromArchitecture>`。

若用户**没指定**模块名，按以下顺序组装清单：
1. 按当前 profile addendum 声明的模块发现方式，得到"物理存在的模块"全集
2. 对比 `doc/module-catalog.yaml` 的 `modules[].name`，标记每个模块当前是 `未建档` / `已建档`
3. 把两类混合展示给用户，**让用户选一个**作为本轮目标

**禁止**：一次批量处理多个模块。每轮对话只处理一个。

### Step 1.5. 判别 CREATE / UPDATE 模式（**强制**）

用户指定（或从 Step 1 选中）模块名 `<M>` 后，**第一件事**是查 `doc/module-catalog.yaml` 判定本轮属于哪种模式：`<M> ∈ modules[].name` → UPDATE（刷新）；否则 → CREATE（新建）。

两种模式在 **Step 2 / Step 3 / Step 4 完全相同**——都是重新采集输入信号、生成 staging、做自检清单。**唯一区别**在 Step 5.1 的对话展示格式：

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
| 6 | 最多 3 个关键文件的头部 60 行 | 仅用于确认职责 | — |

**上下文控制**：以上全部内容**单个模块**加起来应 < 30K token。大型工程里**不要**通读源码实现。若模块异常大，只读导出入口 + 目录树 + README。

### Step 3. 填充模块画像草稿

读取模板 `framework/profiles/<project_profile.name>/skills/catalog-bootstrap/templates/module-card-template.yaml`，按模板字段填写，**写到 staging 文件** `doc/catalog-staging/<ModuleName>.yaml`。

字段填写要点（详见 `.../prompts/infer-module-card.md`）：

| 字段 | 如何填 |
|------|--------|
| `name` | 严格与 profile 识别出的包名或目录名一致 |
| `layer` | 从路径前缀推出 |
| `sub_layer` | architecture.md 标注"顶层/中间/底层"则填，否则 null |
| `format` | 根据 profile 声明的模块格式枚举填写 |
| `one_liner` | **一句话**核心价值，优先复制 architecture.md 原文 |
| `responsibilities` | 3~6 条具体能力/数据 |
| `NOT_responsible_for` | **最重要**：容易误塞但不归它管的事，**至少 3 条** |
| `typical_business_terms` | 业务口头称呼（反向索引） |
| `easily_confused_with` | 字面相似语义不同的兄弟模块，`module` + `disambiguation` |
| `key_exports` | 主要公开符号，≤ 10 个 |
| `entry_file` | 模块入口相对路径 |

**禁止**：瞎编 `NOT_responsible_for` 和 `easily_confused_with`。没有证据就填 `[]`，不要凭字面相似硬造。

### Step 4. 自检清单

```
[ ] 1. name 与目录名 / profile 包描述中的名称一致
[ ] 2. layer 的前缀与物理路径一致
[ ] 3. format 与 profile 声明的模块格式来源一致
[ ] 4. one_liner 不是"xxx 模块"这类空话
[ ] 5. responsibilities 每条都能在代码 / 架构文档里找到依据
[ ] 6. NOT_responsible_for 至少 3 条（或显式写 "# 暂无已知误塞反例"）
[ ] 7. easily_confused_with 的每个 module 都能在已有 catalog 或本次待建清单里找到
[ ] 8. staging 文件头部必须有 confirmed_by_user: false 字段
```

### Step 5. 在对话里逐条问用户确认（**默认交互式**）

staging 的 `confirmed_by_user` 字段是审计记录，**由 AI 根据用户口头回应来翻转**，用户不需要手动打开文件改 flag。

#### 5.1 展示草稿摘要（人友好汇总表，不是原始 YAML 转储）

CREATE 模式展示格式（示例）：

```
📦 <ModuleName>（新建）  草稿位置：doc/catalog-staging/<ModuleName>.yaml
──────────────────────────────────────────────────
Layer / Sub-layer:   <Layer> / <Sub-layer>
One-liner:           <一句话职责，领域中立>
Responsibilities:    1. <能力1> 2. <能力2> …
NOT_responsible_for: 1. <不归本模块的事项>（归 <SiblingModule>）…
Easily_confused_with: <ModuleB> — <歧义消歧说明>
Key_exports: [<SymbolA>, <SymbolB>, ...]
Signals used: ✓ architecture.md ✓ package descriptor ✓ export entry ✗ README (目录树 depth=3)
```

> 领域填充实例见 `` `profile-skill-asset:catalog-bootstrap/examples_domain_mapping` ``。

UPDATE 模式**字段级 diff**（只高亮变更，不整份重贴——避免用户肉眼比对几百行 YAML）：

```
🔧 <ModuleName>（更新已有画像）
⚠ one_liner: 旧：<旧> → 新：<新>
⚠ responsibilities: + "<新增>"  - "<删除>"  · 其它 N 条不变
✓ 其他字段无变化
```

**硬约束**：unchanged 字段绝不展开；数组/对象逐元素 diff（`+`/`-`）；字段被清空标 `[EMPTIED]`/`[FIRST-FILLED]`；变更字段数 > 6 时警告"建议确认是否发生重大重构"。

#### 5.2 邀请用户给简短回复

只问一个问题（SSOT：[user-confirmation-ux.md](user-confirmation-ux.md) · registry `catalog.staging_module`）：`1`/y 确认并合并 · `2`/e 修改某字段 · `3`/s 跳过（staging 保留） · `4`/q 作废。

CREATE 下 `y`=追加到 catalog，`q`=删 staging 模块继续缺档；UPDATE 下 `y`=整条替换旧画像（旧版靠 git 找回），`q`=删 staging 保留旧画像不动。

#### 5.3 按用户口头回复处理

| 用户回复 | AI 动作 |
|---------|---------|
| `y`/确认 | ① staging `confirmed_by_user: true`（审计痕迹）② 立即 Step 6 合并 ③ 删除 staging ④ 报告并停止 |
| `e <指令>` | 按指令 patch staging（只动点名字段）→ 重新展示 5.1 → 再问 5.2 |
| `s`/跳过 | 保留 staging 不动 |
| `q`/作废 | 删除 staging，不合并 |

#### 5.4 硬约束（**本 Skill 最重要的几条纪律**）

1. **禁止**在未收到用户明确 `y`/确认前合并到 `doc/module-catalog.yaml`。
2. **禁止**为了省事折叠 `easily_confused_with`——哪怕只有一条也要完整展示判定规则（Scope 守门真正入口）。
3. **禁止**一轮对话连续处理多个模块的确认；每次只处理 1 个。
4. 用户想手工审阅整份 YAML 可主动请求，但这只是补充手段。

> **异步批量 fallback**：用户明确要"自己慢慢看 N 个 staging 再统一合并"时，退回手动改 `confirmed_by_user: true` + `/catalog-merge` 批量合并的老路（非默认）。

### Step 6. 合并到主 catalog（由 Step 5.3 `y` 分支或用户显式"合并"触发）

1. 范围：来自 Step 5.3 `y` = 当前模块；用户说"合并所有" = 扫描 `doc/catalog-staging/*.yaml` 筛 `confirmed_by_user: true` 的。
2. 每个已确认 staging **只取 `module:` 子树**追加/替换到 `modules[]`；`confirmed_by_user`/`generated_by`/`generated_at`/`signals_used` 等元数据**不进**主 catalog。
3. **删除**已合并的 staging 文件；commit message 约定：`catalog: add <ModuleName> via catalog-bootstrap`（CREATE）/ `catalog: refresh <ModuleName> via catalog-bootstrap (<变更摘要>)`（UPDATE）。
4. 跑 `harness-runner.ts --phase catalog` 校验并把结果贴给用户。

**禁止**：手动重排 `modules` 顺序或改 `schema_version`；把 staging 元数据带进主 catalog；合并成功却不删 staging或移到 `_merged/`（已废弃）。

### Step 6.5. 同步 architecture.md（架构级事件时触发）

| catalog 变化类型 | 架构影响等级 | 需同步的小节 |
|------------------|------------------|------------------------------|
| 新增模块/下线模块/迁到不同外层 | `module_set_change` | 业务模块清单增删一行 + 架构级变更记录追加一行 |
| 某模块职责大幅重写 | `responsibility_rewrite` | 该模块「一句话职责」+ 架构级变更记录追加一行 |
| 仅新增能力项，职责未变 | 非架构级 | **不改** architecture.md |

只维护极简模块清单（模块名 + 所属外层 + 一句话职责 + 链到 catalog），不复制 catalog 完整字段——`doc/module-catalog.yaml` 是唯一 SSOT。准入条件与触发时机以 [plan · Step 12](../feature/plan/SKILL.md) 为准；事件格式：`| YYYY-MM-DD | module_set_change \| responsibility_rewrite | <具体变化> |`。若变化由某 feature 的 design 驱动且已声明 `architecture_impact != none`，在 plan · Step 12 统一处理，本 Skill 不重复追加。

### Step 7. 第二轮补全 `easily_confused_with`（所有模块建完后）

catalog 覆盖 ≥ 80% 模块时，提议跑第二轮：扫描字面相似的模块对（如 XxxManager vs XxxCenter），提示用户考虑加 `easily_confused_with`；每条仍走 staging → 确认流程。

## Phase B：术语表自举（`/glossary-bootstrap`）

**前置**：Phase A 已建好 ≥ 80% 模块的 catalog（否则"反向查 canonical_module"没法做）。

### Step 0. 初始化骨架（首次必做）

`harness-runner.ts --phase glossary`，按报告动作：文件不存在→创建骨架（`schema_version: "1.0"` + `terms: []`）；`terms_is_list` WARN→进 Step 1；依赖 catalog 的 check 报错→停下提示先跑完 `/catalog-bootstrap`。同建 `doc/glossary-staging/`（同 Phase A，不用 `_merged/`）。

### Step 1. 收集种子术语清单

种子文件固定 `doc/glossary-seed.txt`（纯文本每行一个业务名词，`#` 为注释）。

| 情况 | AI 动作 |
|------|---------|
| 文件不存在 | 用模板 [`glossary-seed-template.txt`](../project/catalog-bootstrap/templates/glossary-seed-template.txt) 原文创建 `doc/glossary-seed.txt`，**停下来**提示用户去填 |
| 文件存在但全是注释/空行/占位 | 报告"种子清单仍为空"，停下等用户 |
| 文件存在且含 ≥1 条非注释行 | 进入 Step 2 |

**硬约束**：**禁止** AI 凭印象/从 architecture.md 自动提取词作为种子（那是 AI 自问自答）；**禁止**把 `typical_business_terms` 直接当种子；**允许**在用户填完后做一次"可疑漏项"提示，但不替用户决定。

### Step 2. 逐条术语提出映射建议

对每个术语 `<T>`，读 catalog，执行 `.../prompts/infer-glossary-term.md` 的 6 步骨架（Step 0/1.5/2.5/4.5 均是**弱模型护栏，不可省略**）：

0. **种子技术词守门**（强制前置）：每行执行 `^[A-Z][a-zA-Z0-9]+$` 正则 + `catalog.modules[].name` 重名检测；命中即停并提示三选一（删除/改业务自然语言/加入 allowlist）。harness `--phase glossary` 以 BLOCKER 兜底。
1. **精确匹配**：`<T>` 出现在某模块 `typical_business_terms` → 置信度 `high`。
2. **反向扫描 NOT_responsible_for**（强制）：命中冲突 → `match_kind = typical_term_with_not_responsible_for_conflict`，置信度降一级。
3. **模糊匹配**：子串命中 `typical_business_terms`/`one_liner`/`responsibilities` → 置信度 `medium`，列 Top-3。
4. **反向指针扫描**（强制，仅 1/2 全空时跑）：正则抓"属 X 模块"/"归 Y 类"/"→ Z" → `match_kind = negative_hint_pointer`。
5. **未命中**：置信度 `low`，要求用户补充场景。
6. **alias-merge 分支**（强制）：写 staging 前扫已入库 glossary + 同批 staging，字面相似（≥0.5）→ `match_kind = alias_merge_candidate`，默认推荐并入。

对每条生成 staging（`doc/glossary-staging/<term>.yaml`，模板 `.../templates/glossary-term-template.yaml`）。**易混项强制补全**：匹配到的 `canonical_module` 若有 `easily_confused_with`，必须复制到 staging，让用户看到"这个术语也可能被理解成隔壁模块"。

### Step 3. 逐条问用户确认（同 Phase A，**不批量 dump**）

开场告知总数与置信度分布；逐条展示（术语/置信度/canonical module/匹配依据/易混项/示例用语）+ 问 `y`/`e`/`s`/`q`（同 5.2 编号约定）。

| 回复 | AI 动作 |
|------|---------|
| `y`/确认 | staging `confirmed_by_user: true` → 立刻合并本条到 glossary.yaml（只取 `term:` 子树） → 删除 staging → 下一条 |
| `e <指令>` | patch staging → 重新展示 → 再问 |
| `s`/跳过 | 保留 staging，下一条 |
| `q`/作废 | 删除 staging，下一条 |

收尾汇报合并/修改/跳过/作废计数，提示跑 `harness-runner.ts --phase glossary`，然后**停止**（不自动跑）。

**硬约束**：**禁止**一次打包问"这批都 y 吗"——每条独立展示易混项再问；**禁止**未 `y` 前写入 glossary.yaml；**禁止**折叠 `easily_confused_with`（哪怕 high 置信度）；异步批量 fallback 同 Phase A。

### Step 4. 合并到 glossary.yaml

`term` 子树追加/替换到 `terms[]`（元数据不进主 glossary）→ 删除 staging（commit message 带 `via catalog-bootstrap from <term>.yaml`）→ 提示跑 harness。**禁止**保留 staging 不删或移到 `_merged/`。
