# 术语映射推断 Prompt

> 当 AI 需要为**一批种子术语**生成 glossary 条目草稿时，按本 prompt 执行。
> 前置：`doc/module-catalog.yaml` 已建好（覆盖率 ≥ 80%）。

---

## 输入

1. **种子清单**：`doc/glossary-seed.txt`（用户提供，禁止 AI 自造）
   - 纯文本，每行一个业务名词
   - `#` 开头的行 = 注释，**忽略**
   - 空行忽略
   - 若文件不存在或 "去掉注释和空行后 = 0 行有效数据"，**停下来**跳转 SKILL.md Phase B Step 1.2 自动生成模板并提示用户，**禁止**继续 Step 2
2. **catalog**：`doc/module-catalog.yaml`
3. **种子豁免清单**（可选）：`doc/glossary-seed-allowlist.txt`，格式同种子清单。仅在种子里混入极少数行业通用英文缩写时用（HAP / SDK / NFC 等）。

### 输入预检：种子技术词守门（**强制，读完种子的第一件事**）

对种子清单去注释去空白后的每一行 `<T>`，执行以下判定：

```
tech_word(T) := 以下任一：
  a) T 匹配正则 /^[A-Z][a-zA-Z0-9]+$/      # 纯英文驼峰，疑似类名 / 模块名
  b) T ∈ {m.name for m in catalog.modules} # 直接等于某 catalog module.name
豁免：T ∈ allowlist_file                   # 若用户显式在 allowlist 里放行
```

命中 → **立即停止**，**不要**继续 Step 1 Step 2，在对话里按下面模板提示用户：

```
⚠️ 种子清单含疑似技术词（BLOCKER）：
  - "AccountManager"（与 catalog.modules[].name 重名——技术名而非业务词）
  - "HomeTabPage"（英文驼峰，疑似类名）

glossary 是业务自然语言层，出现上述词会让 Skill 1 Step 1.5 把 PRD 里的类名当成业务词去消歧，直接错分模块。

三选一修复：
  (a) 把这几行从 doc/glossary-seed.txt 删掉
  (b) 替换成业务自然语言（例如 "AccountManager" → "账号"、"HomeTabPage" → "首页"）
  (c) 若确认要保留（如行业通用缩写），追加到 doc/glossary-seed-allowlist.txt

harness 命令 `npx ts-node harness-runner.ts --phase glossary` 会以 BLOCKER 级别兜底抓这类问题。
```

用户修完（或把行加入 allowlist）后重新触发 `/glossary-bootstrap`，再进 Step 1。

---

## 处理流程（**逐条**术语，**不要批量一次生成**）

对每个种子术语 `<T>` 独立生成一个 staging 文件：

```
doc/glossary-staging/<T>.yaml
```

（若 `<T>` 含特殊字符，用 `<T>` 的拼音或 ASCII 化名字，但 staging 文件内的 `term` 字段保留原文）

### Step 1：精确匹配

扫描 catalog，对每个 module 检查：

```
m.typical_business_terms 中是否有某项 === <T>?
```

- **命中** → `confidence: high`，`match_kind: exact_typical_term`，`matched_text: <T>`
- **未命中** → Step 2

### Step 1.5：反向扫描 NOT_responsible_for（**强制，不可跳过**）

> **为什么必须有这步**：catalog 作者可能在同一模块的 `typical_business_terms` 和 `NOT_responsible_for` 里同时提到了同一个业务词（示例：`AccountManager` 既把「账户」列为 typical term，又在 NOT_responsible_for 里排除「业务侧账户」）。弱模型一旦在 Step 1 命中就默认 high 通过，会漏掉这类内部冲突——这是 glossary 误分模块的**首号原因**。

对 Step 1 命中 / 或 Step 2 即将产出的**每个**候选模块 m，**逐条**扫 `m.NOT_responsible_for[i]`：

```
条件触发（满足任一即中）：
  a) <T> 是 NOT_responsible_for[i] 原文的子串
  b) <T> 去空格/标点后是 NOT_responsible_for[i] 去空格/标点后的子串
  c) NOT_responsible_for[i] 含有"**等**"、"**等业务数据**"这类枚举收尾，且 <T> 与其中任一列举项字面相差 ≤ 1 字
```

- 若**命中** → 该候选立即退化为"内部冲突"，严格按下表处理：

  | 改写字段 | 新值 |
  |---|---|
  | `match_kind` | `typical_term_with_not_responsible_for_conflict` |
  | `confidence` | 降一级（high→medium，medium→low，low 保持） |
  | `candidates_top3[]` | 把该 m 显式加进来，`NOT_responsible_for_hint` **逐字复制** m.NOT_responsible_for[i] 的原文片段（**不要**总结） |
  | `confidence_hint` | 写："catalog 内部冲突——`<m.name>.typical_business_terms` 收录 `<T>`，但 `NOT_responsible_for[<i>]` 又排除了：<逐字原文>。建议 PRD 阶段对 `<T>` 的语义做分界说明。" |

- 若**未命中** → 不改动任何字段，正常进入 Step 2 / Step 4

**弱模型友好提示**：这是一条"查字符串 + 写两行 yaml"的机械指令，**不涉及推理**。**禁止**因为"Step 1 已经 high 命中"就跳过本步。本步是 Step 1 的后置强制校验，不是可选增强。

### Step 2：模糊匹配（按优先级）

| 优先级 | 匹配位置 | match_kind | confidence |
|--------|---------|-----------|-----------|
| 1 | `typical_business_terms[i]` 包含 `<T>` 或被 `<T>` 包含 | `fuzzy_typical_term` | medium |
| 2 | `one_liner` 包含 `<T>` | `fuzzy_one_liner` | medium |
| 3 | `responsibilities[i]` 包含 `<T>` | `fuzzy_responsibility` | low |

扫描整个 catalog，按命中优先级**取 Top-3 候选模块**。

若 3 个候选都是优先级 1，置信度 `medium`；若有任何优先级 3 的参与，置信度降为 `low`。

### Step 2.5：反向指针扫描 NOT_responsible_for（**强制，只要 Step 1 和 Step 2 都零命中就跑**）

> **为什么必须有这步**：catalog 作者经常在 `NOT_responsible_for` 里写"属 03-CommonBusiness 的 CardManager"、"归 SwipeCard 模块"这类**反向指针**——它是"本模块不负责 X，X 应该归 Y 模块"的自然语言标注。Step 1-3 只扫正向字段会**完全漏掉**这条信息，弱模型直接判 TBD，后续 PRD 阶段就等于没有任何线索可用。

对 `doc/module-catalog.yaml` 每个模块 m 的 `NOT_responsible_for[]` 每条文本 nrf，执行以下**机械正则匹配**：

```
正则集（大小写敏感，中文标点原样）：
  P1: /属\s*(\d{2}-\w+(?:\s*的)?\s*)?([A-Z][A-Za-z0-9]+)(?:\s*模块)?/g
  P2: /归\s*([A-Z][A-Za-z0-9]+)(?:\s*类?\s*模块)?/g
  P3: /在\s*(\d{2}-\w+(?:\s*的)?\s*)?([A-Z][A-Za-z0-9]+)\s*里/g
  P4: /→\s*([A-Z][A-Za-z0-9]+)/g
```

对每次正则 match 取捕获组里的模块名 `<X>`，再做一次"上下文相关判定"：

- **条件 a**：nrf 文本中同时含 `<T>`（本术语）或 `<T>` 的近义表达子串 → 强信号
- **条件 b**：nrf 文本含 `<T>` 的字面前 / 后 4 字窗口内有"应"、"属"、"归"、"不归"、"→"等触发词 → 中等信号
- **条件 c**：只是泛泛说"属 X 模块"但不涉及 `<T>` → 忽略

命中条件 a 或 b → 把 `<X>` 作为候选：

| 改写字段 | 新值 |
|---|---|
| `match_kind` | `negative_hint_pointer` |
| `confidence` | `low`（仍低，但比 unmatched 信息量高） |
| `candidates_top3[]` | 加入一条：`{module: "<X>", why: "catalog 中 <m.name>.NOT_responsible_for 文本显式指向该模块（正则 <P?>）：<nrf 原文片段>", NOT_responsible_for_hint: []}` |
| `confidence_hint` | "catalog 反向指针：`<m.name>` 的 NOT_responsible_for 里提示 `<T>` 归 `<X>` 模块。注意：`<X>` 可能尚未在 catalog 中建档——若 `<X> ∉ catalog.modules[].name`，canonical_module 仍必须填 TBD，由用户决定先 /catalog-bootstrap `<X>` 还是作废 term" |

**关键约束**：
- 即使抓到反向指针，`canonical_module` **不得**擅自填 `<X>`。必须仍填 TBD——除非 `<X>` 已在 catalog 中（这种情况走 Step 1 / Step 2 路径就已经命中了，不会到 Step 2.5）
- 正则抓到多个候选 → 全部列入 candidates_top3（最多 3 个，按出现顺序）
- 若未抓到任何指针 → 继续 Step 3

**弱模型友好提示**：这是一条"正则 + 短窗口字面判定"的纯机械步骤，**不涉及推理**。正则表达式原样抄进去就能跑。

### Step 3：如仍零命中（Step 1 + 2 + 2.5 全空）

`confidence: low`，`match_kind: unmatched`，`candidates_top3: []`。
在 staging 文件里**显式写**"AI 无法从 catalog 推断，请用户补充该术语所指代的场景或手填 canonical_module"。

### Step 4：选 canonical_module

- Step 1 命中 → 该模块就是 canonical
- Step 2 多候选 → 取 Top-1，**但必须在 staging 里列完整 Top-3 候选**让用户复核
- Step 2.5 反向指针命中（negative_hint_pointer） → `canonical_module: "TBD"`，candidates_top3 里给出被指向的模块名；**绝对不得**擅自把指针指向的模块填进 canonical（因为该模块可能尚未在 catalog 建档）
- Step 3 零命中 → `canonical_module: "TBD"`，用户必须手填
- Step 1.5 触发冲突 → canonical 仍取命中模块，但 confidence 已降级；用户 y 前必须在 confidence_hint 里看到冲突原文

### Step 4.5：同 canonical_module 的 alias-merge 分支（**强制检查**）

> **为什么必须有这步**：种子清单里"账号"和"账户"、"列表入口"和"列表详情页"这类同义对是常态。若为每个都新建独立 term，glossary 会被同义词撑爆，还会污染 Skill 1 Step 1.5 的消歧逻辑（同一模块出现多个几乎等价的 term，反而降低命中质量）。

在写 staging **之前**，扫以下两处：
1. `doc/glossary.yaml` 已入库的 `terms[]`
2. 本批次其余已落地的 `doc/glossary-staging/*.yaml`

对每个已存在的 term `<T'>`（`T' ≠ T`），检查是否同时满足：

| 条件 | 判定 |
|---|---|
| 同 `canonical_module` | `glossary[T'].canonical_module === <候选 canonical>` |
| 字面高度相似 | 满足任一：<br>① `<T>` 是 `<T'>` 的子串或超集<br>② `<T>` 与 `<T'>` 字符级相似度 ≥ 0.5（长度相近、≤ 2 字不同）<br>③ `<T>` 在 `<T'>.aliases` 里、或 `<T'>` 在 `<T>.aliases` 里 |

**全满足 → 触发 alias-merge 候选**，按下表写 staging：

| 字段 | 值 |
|---|---|
| `match_kind` | `alias_merge_candidate` |
| `confidence` | 降级（high→medium） |
| `term.canonical_module / owner_layer` | 正常填 |
| `confidence_hint` | "本 term `<T>` 与已存在的 `<T'>`（canonical=`<ModuleName>`）字面相似度高、同归属，建议作为 `<T'>` 的 alias 合并而非新建独立 term" |

展示时（SKILL.md §3.2），AI 必须把"推荐动作"默认成 `e 并入 <T'>` 而不是 `y`，以免用户盲按 y 产生冗余条目。

**示例**：glossary 已有 `term: "账号", canonical: AccountManager`。本批种子含"账户"，Step 1 命中 AccountManager.typical_business_terms[7]，Step 1.5 又因 NOT_responsible_for 冲突降 medium。Step 4.5 看到：同 canonical + 长度 2 + 1 字差 → 触发 alias_merge_candidate。最终 staging：match_kind = `alias_merge_candidate`，confidence_hint 建议并入"账号"条目。

### Step 5：**强制**补全 easily_confused_with

查 `catalog[canonical_module].easily_confused_with`：
- 若**非空** → 把每条转换成 glossary 的 `{term, module, disambiguation}` 格式复制过来
  - `term`: 对应模块的某个 `typical_business_terms`（选最能代表那个模块的词）
  - `module`: 对应模块 name
  - `disambiguation`: 直接复用 catalog 里 disambiguation 原文
- 若**空** → `easily_confused_with: []`

**禁止**：凭想象编易混项。必须来自 catalog 已有数据。

### Step 6：填其余字段

| 字段 | 填法 |
|------|------|
| `term` | 原始 `<T>`（不做大小写 / 繁简转换） |
| `owner_layer` | 必须等于 `catalog[canonical_module].layer`（不一致就是 bug） |
| `aliases` | 若种子清单里有多个术语指向同一 canonical_module，可作为 aliases（但保持保守，宁缺勿滥） |
| `sample_usage` | 若在 catalog / architecture.md 里找到该术语的使用例句就复制；否则留 `""` 让用户补 |
| `confidence_hint` | 记录你的判定依据，例如："匹配位置：TaskDemo.typical_business_terms[3]"；或用户修正时的规则 |
| `match_info.*` | 如实填你的匹配过程（让用户能 audit） |

---

## 输出格式

每条术语一个独立文件：

```
doc/glossary-staging/<term>.yaml
```

严格遵循 `framework/profiles/hmos-app/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml`。

---

## 完成后（**默认交互式确认，按 `SKILL.md Phase B Step 3` 执行**）

staging 全部落地后，**不要**一次把原始 YAML 倒给用户看，也**不要**要求用户手动改 flag。走对话式逐条确认：

### 1. 开场汇报（一次）

```
已落 N 条 staging 到 doc/glossary-staging/：
  high: X 条   medium: Y 条   low/unmatched: Z 条（<列出名称>）

开始逐条确认，你只要回 y / e <改指令> / s / q 即可：
```

### 2. 对每条术语（严格 1 条 1 条问，绝不合批）

展示格式照 `SKILL.md §3.2`，必须包含：
- `【i/N】术语："<T>"`
- Canonical module + layer
- 匹配置信度 + 匹配依据（哪个字段命中）
- Aliases
- ⚠️ 易混项（**必出**，即便为空也写"（catalog 未声明）"）——每条含 disambiguation 判定规则
- Sample usage

然后问 `y / e / s / q`。

### 3. 按用户回应自主处理（AI 动手，不让用户改文件）

| 回应 | 动作 |
|------|------|
| `y` | ① staging 的 `confirmed_by_user: true`<br>② 只取 staging 的 `term:` 子树追加/替换到 `doc/glossary.yaml`<br>③ **删除** staging 文件（审计靠 git 历史，不用 `_merged/` 归档）<br>④ 进入下一条 |
| `e <指令>` | patch staging → 重新展示本条 → 再问 |
| `s` | 保留 staging 不动，进入下一条 |
| `q` | 删 staging，进入下一条 |

### 4. 收尾（一次）

```
✅ 合并 A 条 / 修改 B 条 / 跳过 C 条 / 作废 D 条
剩余待确认 staging：<列表>

建议跑：cd framework/harness && npx ts-node harness-runner.ts --phase glossary
```

然后停止，不要自动跑 harness。

**禁止**：
- 在未 `y` 前写入 `doc/glossary.yaml`
- 把多条打包问 "这批都 y 吗？"
- 把 `好的` / `嗯` 当 `y`
- 折叠 easily_confused_with（glossary 的核心防御就靠这一栏）
- 处理用户种子清单外的术语
