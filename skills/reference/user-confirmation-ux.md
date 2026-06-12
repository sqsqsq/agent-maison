# 用户确认 UX（Progressive Enhancement）

> **SSOT**：Framework 内所有「需用户显式确认才能继续」的对话交互，均须遵守本文。
> 机器可读登记见 [confirmation-registry.yaml](./confirmation-registry.yaml)。
> 维护者改 Skill 时须跑 `check-skills-confirmation-ux.ts`（见 [skills/README.md](../README.md) 贡献门禁）。

---

## 1. 设计原则

1. **Canonical 回复值与展示形态解耦**——编号 / widget 选项 id / registry `canonical_map` 映射到同一语义（**禁止**把 legacy `Q1=y` 当作 init/setup 编排的合法确认通道）。
2. **渐进增强（Progressive Enhancement）**：
   - **Tier 1 Widget**（adapter 声明 `structured_widget: supported` 时）：优先 adapter interaction-renderer 声明的结构化选择控件。
   - **Tier 2 Portable**：**同一轮消息末尾必须附编号菜单**（`1` / `2` / `3`），chrys/codemate 等无 widget 宿主只展示本层。
   - **Tier 3 Recap**：写入磁盘或进入下一步前，**结构化复述决策**供用户最后一轮纠错。
3. **禁止仅要求用户打字**：不得把「请逐行回复…」「请按以下格式打字…」作为**唯一**交互；须先有 gate/enum/matrix 或 artifact 路径。
4. **禁止 oral OK**：裸 `好` / `继续` / `ok` / 单字 `y`（多题并存时）不构成确认——各 Skill 原有 BLOCKER 不变。
5. **新增确认点**：先登记 `confirmation-registry.yaml` → SKILL 只链本文 + registry `id`（≤10 行）→ 跑 lint。
6. **虚拟 registry `skill`**：无物理 `skills/<skill>/SKILL.md` 时，`skill` 字段表示分组/追溯用命名空间，须在 `check-skills-confirmation-ux.ts` 的 `VIRTUAL_REGISTRY_SKILLS` 显式登记（**禁止**用 `skill.startsWith('_')` 笼统跳过目录检查）。当前：`_cross_phase`（`phase.next_step` 跨阶段闭环菜单）。

---

## 2. Interaction class（五类）

| class | 适用 | 用户操作 | harness |
|-------|------|----------|---------|
| `gate` | 多行确认的第一步 | `1` 全部维持 / `2` 逐项调整 / `3` 讨论 | 不验对话 |
| `enum` | 单行多选一 | `1`/`2`/… 或 widget | 不验对话 |
| `matrix` | gate=2 后的逐行 | 每行编号子菜单或 widget | 不验对话 |
| `artifact_checkbox` | 须落盘证据 | 改文件 `[x]`；对话编号辅助后 **agent 写回文件** | check-spec 等 |
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

### 3.2 Enum（registry: `init.project_profile` / `setup.adapter` 等）

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
4. sublayer（须 preset/磁盘已含 sublayers[]；否则 STOP，手动编辑 config 后重跑）
```

### 3.4 Artifact + portable（registry: `spec.terminology`）

对话 gate 后 **必须写回** spec `## 0. 术语映射表` 的 `[x]` 列；口头 OK 无效。

```text
1. 全部确认 confidence=high 的行（写回 spec [x]）
2. 逐行确认
3. 逐行修改映射
```

逐行：`1=确认该行` / `2=改映射`。

### 3.5 Freeform + portable（registry: `plan.scope_expansion` / `ut.src_mutation`）

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
| `init.materialized_adapters` | claude / cursor / generic 多选 | checkbox / 编号 | materialized_adapters[] |
| `setup.adapter` | 从已物化列表选 | `1` | from_materialized |
| `init.intra_layer_deps` | 全部维持 / 调整 / 讨论 | `1`/`2`/`3` | 每层 `按默认` 或具体 enum |
| `init.task_decision` | 覆盖 / 保留 | `1`/`2` | overwrite / keep |
| `catalog.staging` | y / e / s / q | `1`/`2`/`3`/`4` | 同左 |
| `spec.terminology` | 全部 high / 逐行 / 修改 | `1`/`2`/`3` | spec 表 `[x]` |

完整列表见 [confirmation-registry.yaml](./confirmation-registry.yaml)。

---

## 5. Adapter 能力（运行时）

由 `framework/agents/<name>/adapter.yaml` → `user_confirmation` 段声明；交互渲染协议见各 adapter 下发的 `interaction-renderer` 规则：

| `structured_widget` | Agent 行为 |
|---------------------|------------|
| `supported` | 按 interaction-renderer 调结构化选择控件 + **同轮** portable 脚注 |
| `unsupported` | **仅** portable 编号菜单（generic interaction-renderer） |

**S4 已闭环例外（framework-init）**：`buildRunSummary` 汇报完成后 init 编排结束；**禁止**再附 S2 registry（`init.task_plan` / `init.materialized_adapters` 等）portable 脚注——即使用户未回复，也不得在摘要末尾挂「编号菜单 (portable)」速查表。

选项文案 SSOT：[confirmation-registry.yaml](./confirmation-registry.yaml)。

chrys / codemate 等内部 agent：实例用 `generic` adapter，等同 `unsupported`。

---

## 6. 反模式（BLOCKER）

- ❌ init/setup matrix 选 `sublayer` 后在对话追问子层 id / members（须 preset 或磁盘 JSON 预置完整 `sublayers[]`）
- ❌ 仅展示 Markdown 表让用户逐行打字，无 gate/enum
- ❌ widget 可用却仅给表格
- ❌ widget option 的 label/description **自造路径**或未逐字引用 registry `options`（如 `init.materialized_adapters` → [confirmation-registry.yaml](./confirmation-registry.yaml)）
- ❌ 聊天 OK 但未写回 artifact（spec `[x]`、gap-notes）
- ❌ freeform 提议未展示正文只要用户回 `1`
- ❌ 多题并存时接受裸 `y` / `好`（init/setup 编排须 registry 编号；见 §3 gate/enum）
- ❌ 阶段四件套 PASS 后在**同一 agent 执行流**自动 Read 下一 Skill 并开干（见 §8）
- ❌ 把 `phase-completion-receipt.md` / trace / 「可进入 Skill N」当作下一阶段授权

---

## 8. 阶段边界推进（BLOCKER）

**阶段闭环（harness + verifier + receipt + trace 四件套 PASS）只证明当前 phase 完成，不授权下一 Skill。**

「可进入 Skill N」= **资格**，≠ **授权**。Stop hook 只管「假完成」，不管「擅自开下一阶段」。

### 8.1 默认策略 `transition_policy=manual`

启动下一 Skill 前，须满足以下**任一**：

1. 用户消息含下一 Skill **触发意图**（各 SKILL「触发条件」关键词）；
2. 用户消息含 **batch 多阶段意图**（§8.2）→ `transition_policy=batch_authorized`；
3. 用户通过 **`phase.next_step`** 或对应 **`*.ok_to_*`** 闭环闸门确认（见 registry）；
4. **`goal_mode`**：`goal-runner` manifest 显式启动（见 [goal-mode/SKILL.md](../project/goal-mode/SKILL.md)）；自然语言触发词为「目标模式 / 全自动」等；裁决 SSOT 在 runner，非对话内自驱动。

**禁止**：读完 `phase-completion-receipt.md` 或 trace 后，在同一 agent 执行流内自动 Read 下一 Skill 并开干。

**闭环后默认动作（manual）**：汇报本 phase 摘要 → 调 **`phase.next_step`**（确认菜单 + portable 编号）→ **停等**。

| 当前 phase 闭环后 | 专用闸门（可选，与 `phase.next_step` 等价语义） |
|-------------------|--------------------------------------------------|
| spec | `phase.next_step`（`spec.freeze` 只冻结 spec 内容，不替代闭环停等，除非 batch 授权） |
| plan | `plan.ok_to_code`（Step 13.1 PASS 后 **每次** MUST，含首遍 plan） |
| coding | `coding.ok_to_review` 或 `phase.next_step` |
| review | `review.ok_to_ut` 或 `phase.next_step` |
| ut | `ut.ok_to_testing` 或 `phase.next_step` |
| testing | `phase.next_step`（通常仅「暂停 / 结束」） |

### 8.2 Batch 多阶段授权（`batch_authorized`）

用户**同一条或可追溯承接**的消息声明多阶段范围时，允许在**已声明范围内**连续执行；**超出范围仍须停等**。

启发式示例（非穷举）：

- 「做到 review / 做到 CR / coding 并 review」
- 「spec 到 UT / 全链路交付 / 从 plan 到真机测试」
- 「对 `<feature>` 做到 `<phase>` 为止」

解析 SSOT：`framework/harness/scripts/utils/phase-transition-policy.ts`（lint + unit test）。

### 8.2b Goal 模式（`goal_mode` / goal-runner）

用户通过 `/goal-mode`、自然语言（**目标模式 / 全自动 / 无人值守全自动**）或 [goal-mode](../project/goal-mode/SKILL.md) 显式启动时，`transition_policy=goal_mode`。解析 SSOT：`resolveTransitionPolicy` — **goal_mode 优先于** §8.2 的 `batch_authorized`（同句同时命中时以 goal 为准）。

主 agent **自跑** goal-runner（勿让用户手跑 harness）；跨 phase 推进由 **runner + harness verdict** 裁决，**不是**对话内自驱动。运行证据：`doc/features/<feature>/goal-runs/<run-id>/`。

- DEFERRED（外部阻塞）≠ completed；最终报告仅 `COMPLETED` 表示无 DEFERRED。
- 运行手册：`framework/docs/operations/goal-mode-runbook.md`

### 8.3 `phase.next_step` portable 模板

```text
{current_phase} 阶段已闭环（harness / verifier / receipt / trace 齐全）。

请选择下一步（回复编号；支持 widget 时可直接选，同轮仍附下列编号）：
1. 进入下一 Skill — {next_skill_label}
2. 暂停 — 本阶段到此，暂不进入下游
3. 其它 — 我在对话中说明意图
```

选项 1 的 `{next_skill_label}` 按当前 phase 替换（如 spec→plan、coding→code-review review）。

---

## 7. 索引

- Registry：[confirmation-registry.yaml](./confirmation-registry.yaml)
- Lint：`framework/harness/scripts/check-skills-confirmation-ux.ts`
- Init/setup 编排：`init.task_plan` + `init.task_decision` + `init.architecture_preset`（**禁止** legacy `Q1=y` / `all=y` 与 architecture 对话问卷）
