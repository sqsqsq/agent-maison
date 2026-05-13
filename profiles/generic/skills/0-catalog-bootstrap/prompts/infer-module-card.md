# 模块画像推断 Prompt

> 当 AI 需要为**单个模块**生成画像草稿时，按本 prompt 执行。
> 本 prompt 假设：用户已通过 `/catalog-bootstrap <ModuleName>` 指定了目标模块。

---

## 输入信号采集顺序

对指定模块 `<ModuleName>`（设其物理路径为 `<LAYER_DIR>/<ModuleName>/`），按下列**优先级**采集输入：

### 1. 架构文档锚点（最高优先级）

```
Read doc/architecture.md
```

搜索 `<ModuleName>` 关键字，提取：
- 该模块的"一句话职责"（通常就在模块清单表格里）
- 它所处的"层"和"子层"（顶层/中间/底层）
- 它与兄弟模块的依赖关系描述

**如果 architecture.md 里有 `<ModuleName>` 的原文描述**：
- `one_liner` 直接复制，不要自己改写
- `responsibilities` 从相邻段落提取
- `sub_layer` 从"顶层 / 中间 / 底层"字样提取

**如果 architecture.md 没有**：降级到 Step 2。

### 2. 模块 README

```
Read <LAYER_DIR>/<ModuleName>/README.md  (若存在)
```

作为辅锚点，补充 architecture.md 未覆盖的内容。

### 3. oh-package.json5（必读）

```
Read <LAYER_DIR>/<ModuleName>/oh-package.json5
```

提取：
- `name` 字段 → 用来校验 `<ModuleName>` 拼写
- `dependencies` 字段 → 推断该模块依赖哪些下层模块（辅助判断它属于哪一层）
- 模块类型（若有 `module.type`，`entry` → HAP，`har` → HAR；否则看根目录 `build-profile.json5` 里该模块条目）

### 4. Index.ets（必读）

```
Read <LAYER_DIR>/<ModuleName>/Index.ets  (若存在)
```

提取所有 `export { ... }` / `export class X` / `export function y` / `export interface Z`：
- 保留 ≤ 10 个最主要的符号
- 写到 `key_exports` 数组
- 这些符号本身就是"对外核心能力"的强提示，可以反推 `responsibilities`

**HAP 模块（01-Product）通常没有 Index.ets**，改读 `EntryAbility.ets`，`key_exports` 填 `[]`。

### 5. 目录树（必读，只看结构不看内容）

用 `Glob` / `ls` 列出 `<LAYER_DIR>/<ModuleName>/src/main/ets/` 下**深度 ≤ 3** 的目录结构，识别：

- 有 `shared/` `data/` `domain/` `presentation/` 四层 → 是业务 HAR 模块
- 有 `pages/` `components/` → Feature 层的 UI 承载模块
- 有 `repository/` `service/` → 有业务能力的公共模块
- 有 `util/` `helper/` → 工具性质模块

**禁止**：打开任何具体 `.ets` 文件内容（除 Index.ets 已读）。

### 6. 极少量关键文件头部（可选）

若前 5 步信号还不够判断职责，最多读 3 个文件的头部 60 行，文件选择优先级：

1. `presentation/pages/*.ets` 中的任一个（看页面名推业务）
2. `data/repository/*.ets` 中的任一个（看数据模型推能力）
3. `domain/service/*.ets` 中的任一个（看服务类推对外契约）

**禁止**：为了凑字段而批量读实现文件。

---

## 字段推断规则

### `name`

严格等于目录名；若宿主有包清单（如 `package.json`、`oh-package.json5`、`pom.xml`），以其声明的模块名为准核对。不一致时停下来问用户。

### `layer`

1. 读取 `framework.config.json > architecture.outer_layers[].id`，得到**合法外层 id 全集**。
2. 用 `doc/architecture.md` 中该模块所在行 / 依赖说明，对照其物理路径首段目录名（或其他工程约定的定位键），选定**恰好一个**外层 id。
3. 若在文档与 DSL 中对不上（例如重构中目录尚未迁完），**停下来向用户求证**，禁止猜测或沿用旧仓库习惯叫法。

### `sub_layer`

仅当 DSL 中为该外层声明 `sublayers` 或与 `architecture.md` 明示「顶层/中间/底层」时使用；若无则填 `null`。

### `format`

必须由宿主工程的真实模块载体决定（Maven 模块、`package.json`、`build.gradle` target、HAP/HAR 等）。若无信号，填 `<TBD>` 并在 staging 列出缺失文件。

### HarmonyOS / `.ets` 快捷信号（仅在宿主为 hmos-app 时启用）

当选中 profile 指向 ArkTS/HAR/HAP，可补充读取 `oh-package.json5`、`Index.ets`、`EntryAbility.ets`、`build-profile.json5` —— **generic 宿主无此链路时可整段跳过**。

### `one_liner`

**一句话**描述该模块的对外核心价值。优先级：

1. architecture.md 里的原文（最高）
2. README.md 里的概述第一句
3. 基于 Index.ets 主要导出符号的推断

**反例**（禁止写成这样）：
- "xxx 模块" ← 重复模块名，没信息
- "提供 xxx 相关功能" ← 空话
- "负责 xxx 业务" ← 模糊

**正例**：
- "应用壳模块：聚合导航并编排首屏与各业务 Feature 模块"
- "跨 Feature 的任务编排服务：草稿校验 / 远端受理 / 本地 pending 生命周期"

### `responsibilities`

3~6 条，每条都要能回答"这个模块**对外**提供什么？**独占**持有什么数据？"：

- 不要写实现细节（"调用了 X 接口"）
- 不要写通用技术能力（"提供日志"← 这是 05 层的事）
- 要写对外契约（"提供 TaskRepository：统一草稿 CRUD 与最近一次提交状态缓存"）

### `NOT_responsible_for`（**最重要的字段**）

这是防 scope creep 的核心。要求**至少 3 条**。每条都应该对应一个"曾经有人想把 XX 塞进这个模块但错了"的反模式。

如何生成：

1. **看 easily_confused_with 的反面**：如果 A 容易被误当成 B，那 A 的 `NOT_responsible_for` 就应该写"B 的职责"
2. **看层级反面**：
   - 最外层聚合壳 → 写"不承担具体业务域的领域规则 / 不承担数据持久化"
   - 业务 Feature 承载 UI → 写"不承担跨 Feature 的共享领域服务"
   - 共享领域服务层 → 写"不承担最终用户可见页面布局与路由"
   - 基础设施 / 平台能力层 → 写"不承担业务流程编排与产品规则"
3. **从 architecture.md 取**：若架构文档里有"本模块不负责 ..."之类的原文，直接复制

**硬规则**：若真没任何线索，**至少填 2 条层级反面**，宁可粗不能空。

#### 反向自检（**强制，draft 落地前最后一步**）

草稿 `NOT_responsible_for` 和 `typical_business_terms` 都写完后，做一次机械字符串扫描：

```
for each term in typical_business_terms:
  for each nrf in NOT_responsible_for:
    if term (normalized: 去空格/标点) 是 nrf (normalized) 的子串:
      → 触发自相矛盾告警
```

命中 → **必须**二选一修复，不允许带冲突入库：

| 选项 | 动作 | 何时选 |
|---|---|---|
| A. 从 `typical_business_terms` 移除该词 | 直接删 | 该词实际不归本模块（放进去只是手一滑） |
| B. 在对应 `NOT_responsible_for[i]` 原文里加消歧规则 | 把原文改成"X 指 A 时属本模块；指 B 时不属（详述 B 属何模块）" | 同词多义 |

**为什么要反扫**：下游 glossary 阶段的 `infer-glossary-term.md` Step 1.5 会因这种冲突把命中置信度从 high 降到 medium——但**最干净的防线是 catalog 自己不出冲突**。Harness `--phase catalog` 会有一条 `typical_vs_not_responsible_conflict` 扫描把这类遗漏抓成 WARN，可作二次兜底，但 AI 自己就该主动解决。

**弱模型友好提示**：这是一步"for 循环 + 子串判定 + 编辑 yaml"的机械动作，不需要推理。**禁止跳过**。

### `typical_business_terms`

业务团队 / PM / 用户在口头或 PRD 里会怎么叫这个模块？例如：

- `TaskFeature` 模块 → ["任务列表", "草稿箱", "最近一次提交状态"]
- `PlatformCore` 模块 → ["远端受理 API", "租户级限流配置"]

**信号来源**：
- architecture.md 里该模块的自然语言描述
- Index.ets 里导出的 Page 类名（去掉 "Page" 后缀）
- `src/main/resources/.../string.json` 里的显示文案（若能识别属于该模块）

**禁止**：把技术名（类名、函数名）当业务术语。这里要的是"自然语言"。

### `easily_confused_with`

只在**有证据**时填。证据来自：

1. architecture.md 里同层相邻模块，名字字面相似（如 XxxManager vs XxxCenter）
2. 已有 catalog 中已注册的其他模块，它的 `easily_confused_with` 里提到了本模块
3. 用户明确说"这个模块容易跟那个搞混"

每条必须包含：
- `module`: 另一个模块的 name（必须存在于 catalog 中，或在本轮批量建中）
- `disambiguation`: **判定规则**，格式推荐："如果 PRD 说 A → 本模块；如果说 B → 另一模块。判定：..."

**禁止**：只因为两模块字面相似（如都叫 Card）就列为 easily_confused。要有语义歧义的实锤。

### `key_exports`

从 Index.ets 直接取，保留 ≤ 10 个最主要的。保留顺序：Page > Class > Interface > Function > Constant。

### `entry_file`

- HAP → `01-Product/<ModuleName>/src/main/ets/entryability/EntryAbility.ets`（或该工程实际路径）
- HAR → `<LAYER_DIR>/<ModuleName>/src/main/ets/Index.ets`

---

## 输出格式

把推断结果写到：

```
doc/catalog-staging/<ModuleName>.yaml
```

严格遵守 `framework/profiles/hmos-app/skills/0-catalog-bootstrap/templates/module-card-template.yaml` 的结构。

**必填写入：**
- `confirmed_by_user: false`（不要擅自改 true）
- `generated_by`: 你的模型标识
- `generated_at`: 当前时间（YYYY-MM-DD HH:mm:ss）
- `signals_used`: **如实**填你实际读过的信号（用户会据此判断你的推断是否可信）
- `module.*`: 按上面规则填

---

## 完成后（**默认交互式确认，不要要求用户手改文件**）

staging 写完后，**不要**吐原始 YAML，也**不要**停止等用户 offline 改 flag。按 `SKILL.md Phase A Step 5` 的流程：

### 1. 在对话里展示人友好的草稿汇总

格式严格照 `SKILL.md §5.1`，包含：
- Layer / Sub-layer / Format
- One-liner
- Responsibilities（编号列）
- NOT_responsible_for（编号列）
- Easily_confused_with（每条含 disambiguation 一行）
- Key_exports / Entry_file
- Signals used（✓/✗ 列表，对应 `signals_used`）

### 2. 问用户一个问题（只问一次，不要用复杂选项轰炸）

> 请选择：
>   `y` 确认并合并
>   `e <修改指令>` 修改某字段
>   `s` 跳过
>   `q` 作废

### 3. 按用户口头回应自主处理

| 回应 | 动作 |
|------|------|
| `y` / 确认 / OK | ① 改 staging 的 `confirmed_by_user: true`（git 能抓到这一瞬间）<br>② 只取 staging 的 `module:` 子树追加/替换到 `doc/module-catalog.yaml`（`generated_by` / `signals_used` 等元数据**不进**主 catalog）<br>③ **删除** staging 文件（审计靠 git 历史，不用 `_merged/` 归档）<br>④ 报告"已合并并删除 staging"后停止 |
| `e <指令>` | patch staging 对应字段 → 回到第 1 步重新展示 |
| `s` / 跳过 | staging 保留，告知"下次回来说'继续确认 <ModuleName>'即可" |
| `q` / 作废 | 删 staging |

**禁止**：
- 在未收到明确 `y` / `确认` 前写入 `doc/module-catalog.yaml`
- 把 `好的` / `嗯` / `收到` 等暧昧回复当作 `y`——必须再问一次"y 吗？"
- 一次对话连续处理下一个模块（必须让用户另起 `/catalog-bootstrap <NextModule>`）
- 折叠 / 截断 `NOT_responsible_for` 与 `easily_confused_with`（Scope 守门关键字段）
