# 用户确认 UX（Progressive Enhancement）

> **SSOT**：Framework 内所有「需用户显式确认才能继续」的对话交互，均须遵守本文。
> 机器可读登记见 [confirmation-registry.yaml](./confirmation-registry.yaml)。
> 维护者改 Skill 时须跑 `check-skills-confirmation-ux.ts`（见 [skills/README.md](../README.md) 贡献门禁）。

---

## 1. 设计原则

1. **Canonical 回复值与展示形态解耦**——`1` / widget 选项 id / `全部按默认` / `Q1=y` 映射到同一语义（见 registry `canonical_map`）。
2. **渐进增强（Progressive Enhancement）**：
   - **Tier 1 Widget**（adapter 声明 `structured_widget: supported` 时）：优先 AskQuestion（Cursor）或宿主原生选项（Claude Code）。
   - **Tier 2 Portable**：**同一轮消息末尾必须附编号菜单**（`1` / `2` / `3`），chrys/codemate 等无 widget 宿主只展示本层。
   - **Tier 3 Recap**：写入磁盘或进入下一步前，**结构化复述决策**供用户最后一轮纠错。
3. **禁止仅要求用户打字**：不得把「请逐行回复…」「请按以下格式打字…」作为**唯一**交互；须先有 gate/enum/matrix 或 artifact 路径。
4. **禁止 oral OK**：裸 `好` / `继续` / `ok` / 单字 `y`（多题并存时）不构成确认——各 Skill 原有 BLOCKER 不变。
5. **新增确认点**：先登记 `confirmation-registry.yaml` → SKILL 只链本文 + registry `id`（≤10 行）→ 跑 lint。

---

## 2. Interaction class（五类）

| class | 适用 | 用户操作 | harness |
|-------|------|----------|---------|
| `gate` | 多行确认的第一步 | `1` 全部维持 / `2` 逐项调整 / `3` 讨论 | 不验对话 |
| `enum` | 单行多选一 | `1`/`2`/… 或 widget | 不验对话 |
| `matrix` | gate=2 后的逐行 | 每行编号子菜单或 widget | 不验对话 |
| `artifact_checkbox` | 须落盘证据 | 改文件 `[x]`；对话编号辅助后 **agent 写回文件** | check-prd 等 |
| `freeform_approval` | Scope 扩展、改源码授权 | 先展示完整提议/变更描述 → `1=授权 2=拒绝 3=先看 diff` → **须保留用户原话** | check-ut gap-notes 等 |

---

## 3. 展示模板（复制时替换 `{…}`）

### 3.1 Gate（registry: `init.intra_layer_deps` 等）

```text
请选择（回复编号；支持 widget 时可直接选，同轮仍附下列编号）：
1. {全部维持摘要 — 等价于每层「按默认」}
2. 我要调整某几项（进入 matrix）
3. 先讨论语义 / 看说明
```

合法批量速记：`1`（gate 上下文）、`全部按默认`、`all=default`（仅当 registry 声明）。

### 3.2 Enum（registry: `init.adapter` 等）

```text
请选择（回复编号）：
1. {选项 A}
2. {选项 B}
…
```

### 3.3 Matrix 子菜单（逐层 / 逐行）

```text
外层 {layer-id} — 请选择：
1. 按默认（当前值：{value}）
2. dag
3. forbid
4. sublayer（+ 子层问卷）
```

### 3.4 Artifact + portable（registry: `prd.terminology`）

对话 gate 后 **必须写回** PRD `## 0. 术语映射表` 的 `[x]` 列；口头 OK 无效。

```text
1. 全部确认 confidence=high 的行（写回 PRD [x]）
2. 逐行确认
3. 逐行修改映射
```

逐行：`1=确认该行` / `2=改映射`。

### 3.5 Freeform + portable（registry: `design.scope_expansion` / `ut.src_mutation`）

**不得省略**提议正文 / 变更描述 / gap-notes 用户原话字段。

```text
（完整提议或变更描述已展示于上）

请选择：
1. 授权 / 同意（须能引用用户原话写入 trace 或 gap-notes）
2. 拒绝
3. 先看 diff / 再讨论
```

### 3.6 决策复述（Recap，写入前）

```text
决策已记录（{registry_id}）：
  …
若需修改请直接说明；否则我将按上述决策继续。
```

---

## 4. Widget ↔ Portable 映射（示例）

| registry id | widget 选项（示意） | portable | canonical |
|-------------|---------------------|----------|-----------|
| `init.adapter` | claude / cursor / generic / 保持 | `1`/`2`/`3`/`4` | adapter 名字符串 |
| `init.intra_layer_deps` | 全部维持 / 调整 / 讨论 | `1`/`2`/`3` | 每层 `按默认` 或具体 enum |
| `init.populated_diff` | all=y / all=n / 逐项 | `1`/`2`/`3` | `Q1=y …` 或 `all=y` |
| `catalog.staging` | y / e / s / q | `1`/`2`/`3`/`4` | 同左 |
| `prd.terminology` | 全部 high / 逐行 / 修改 | `1`/`2`/`3` | PRD 表 `[x]` |

完整列表见 [confirmation-registry.yaml](./confirmation-registry.yaml)。

---

## 5. Adapter 能力（运行时）

由 `framework/agents/<name>/adapter.yaml` → `user_confirmation` 段声明：

| `structured_widget` | Agent 行为 |
|---------------------|------------|
| `supported` | 调 widget + **同轮** portable 脚注 |
| `unsupported` | **仅** portable 编号菜单 |

chrys / codemate 等内部 agent：实例用 `generic` adapter，等同 `unsupported`。

---

## 6. 反模式（BLOCKER）

- ❌ 仅展示 Markdown 表让用户逐行打字，无 gate/enum
- ❌ widget 可用却仅给表格
- ❌ widget option 的 label/description **自造路径**或未逐字引用 registry 登记的 `widget_options_ref`（如 `init.adapter` → [adapter-widget-options.md](../00-framework-init/templates/adapter-widget-options.md)）
- ❌ 聊天 OK 但未写回 artifact（PRD `[x]`、gap-notes）
- ❌ freeform 提议未展示正文只要用户回 `1`
- ❌ 多题并存时接受裸 `y` / `好`（见 Skill 00 §0.3.4.3）

---

## 7. 索引

- Registry：[confirmation-registry.yaml](./confirmation-registry.yaml)
- Lint：`framework/harness/scripts/check-skills-confirmation-ux.ts`
- Init 编号 Q 特例：Skill 00 §0.3.4（`Q1=y` / `all=y`，已合规）
