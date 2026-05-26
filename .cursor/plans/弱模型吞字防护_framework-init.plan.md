---
name: 弱模型吞字防护 / framework-init 数据驱动化
overview: 解决内网中低端模型在 framework init 过程中"吞字反转语义"的问题（如模板里"不要"落地成"要"）。核心思路：把能机械生成的都从 LLM 的文字流里摘出去——adapter 模板走字节级 copy，agent 入口文件走占位符替换，architecture.md 走数据驱动渲染；剩余真·AI 散文区用分区哨兵 + negation-diff verifier 兜底。
todos:
  - id: init_copy_script
    content: 新增 framework/harness/init-copy.ts：按 adapter.yaml 做字节级拷贝，替代 LLM"按模板生成"；SKILL Step 4 改为调脚本
    status: pending
  - id: render_entry_script
    content: 新增 framework/harness/render-entry.ts：AGENTS.md.template 占位符机械替换；SKILL Step 4.1 改为调脚本
    status: pending
  - id: render_architecture_script
    content: 新增 framework/harness/render-architecture.ts：由 config + build-profile + catalog 渲染 architecture.md；SKILL Step 5.2 改为调脚本
    status: pending
  - id: skeleton_partition
    content: architecture.md.skeleton.md + AGENTS.md.template 引入 HTML 注释三分区（skeleton / data / narrative），规范"骨架禁改、数据可重算、叙述允许 AI 生成"
    status: pending
  - id: check_framework_init
    content: 新增 framework/harness/scripts/check-framework-init.ts：skeleton 区 sha 比对 / data 区重渲染比对 / narrative 区极性词 WARN
    status: pending
  - id: negative_to_positive
    content: 滚一遍 00-framework-init SKILL.md + AGENTS.md.template + CLAUDE.md：把可改的负向表达（"不要 X" / "不得 X" / "严禁 X"）改为正向白名单（"仅 Y" / "唯一允许 Y"）
    status: pending
  - id: verifier_negation_diff
    content: 新增 framework/harness/prompts/verify-framework-init.md 的 negation-diff 专项：对落地产物逐条比对极性词翻转；在 verifier 子 agent 里跑
    status: pending
  - id: skill_discipline
    content: 00-framework-init SKILL.md 追加"弱模型纪律"小节：Write 长文本一律原样、禁止改写；关键段要求逐字保留并附锚点；Step 4/5 开头显式重申
    status: pending
  - id: smoke_test
    content: 在干净的测试工程里跑一遍 /framework-init（用弱模型），验证三类产物吞字都能被 check-framework-init.ts 拦住
    status: pending
isProject: false
---

## 零、背景与问题

内网可用的中低端模型在执行 `/framework-init` 时，**经常把模板里的负向词吞掉**，导致语义反转：

| 现象 | 落地影响 |
|------|---------|
| "本 Skill **不**会覆盖 `doc/module-catalog.yaml`" → "本 Skill 会覆盖…" | 下次重跑直接毁 catalog-bootstrap 积累资产 |
| "**不要**自动删除旧 adapter 产物" → "要自动删除…" | 切 adapter 时自动删用户文件 |
| "**禁止**逆向依赖" → "允许逆向依赖" | 架构契约失效 |
| "**严禁**在用户未确认前覆盖 `framework.config.json`" → "在用户未确认前覆盖…" | 绕过人工门禁 |

中文"不"字单字吞掉后语法仍然通顺、语义完全反转，是这类模型最容易翻车的语法结构；英文 `don't` 丢一个字符起码会留下 `do` 的痕迹能被查出来。当前 `00-framework-init/SKILL.md` 里有 20+ 条"严禁 / 不得 / 不要"负向表达，全部是潜在翻转点。

**根本原因**：让 LLM "按模板重写整段长文本"——只要它在重写，就有吞字机会。

## 一、改造目标与核心原则

1. **Data-driven over LLM-driven**：凡是能从结构化来源（JSON / YAML / 模板字节）机械推导的内容，**退出 LLM 文字流**，改由 `framework/harness/` 下的脚本渲染。
2. **三分区纪律**：所有受框架管理的 Markdown 文档都显式划分为 `skeleton` / `data` / `narrative` 三区，harness 能分区校验。
3. **正向 over 负向**：能用白名单 / "仅 X" 说清楚的，不用"不要 X"。负向表达是吞字反转的主要载体，源头消除。
4. **机制 over 文字**：硬规则下沉到脚本（init-copy.ts / render-*.ts / check-*.ts）与 IO 层；SKILL.md 里的文字规则只作为给模型看的导航，**不**作为唯一保障。
5. **不破坏用户已有资产**：所有脚本都必须尊重 Step 0.3 体检表已定的"MISSING / EMPTY / POPULATED"策略矩阵，不得绕过。

## 二、吞字面分类与对策映射

### 类 1：adapter 模板文件（`framework/agents/<name>/templates/**`）

- **现状**：SKILL Step 4 要求"按 adapter.yaml 原样复制到实例根"，但弱模型常常"按模板生成"——一字字重抄，触发吞字。
- **对策（todo#1 init_copy_script）**：加 `framework/harness/init-copy.ts`，参数 `--adapter <name>`，按 `adapter.yaml` 的 `template_dir` → `target_dir` 做字节级 `copyFile`；逐文件按 Step 0.3 第 3 项体检结果决定 MISSING/EMPTY 直拷或 POPULATED 先出 diff。SKILL Step 4 的落地方式改写为"调用 `init-copy.ts`"，显式禁止用 Write 工具逐文件重写模板内容。

### 类 2：agent 入口文件（`AGENTS.md` / `CLAUDE.md`）

- **现状**：读取 `framework/templates/AGENTS.md.template`、替换 `{{...}}` 占位符、写文件——现在整个流程都由 LLM 完成，长模板整个经过它的"重写"。
- **对策（todo#2 render_entry_script）**：加 `framework/harness/render-entry.ts`，输入 `AGENTS.md.template` + 一份 `{"AGENT_ENTRY_FILE":"AGENTS.md","PROJECT_NAME":"...",...}` 的小 JSON，做纯 `replaceAll`，输出目标文件。LLM 在 Step 4.1 的职责退化为"构造那份小 JSON"——字段都是短字符串，吞字风险极低。

### 类 3：`doc/architecture.md`（数据驱动渲染）

- **现状**：Step 5.2 让 AI 基于 `architecture.md.skeleton.md` 与 DSL / build-profile / catalog 数据"生成"完整文档。实测产物（109 行）里：
  - 74% 是骨架字节（标题、引言、变更触发表、各章节说明）
  - 24% 是结构化数据展开（Mermaid 外层图、层间依赖表、`module_inner_layers` CSV、物理目录表、业务模块清单表）
  - **0% 真·AI 散文**
- **对策（todo#3 render_architecture_script）**：加 `framework/harness/render-architecture.ts`：
  - 输入：`framework.config.json`、`build-profile.json5`、`doc/module-catalog.yaml`、`architecture.md.skeleton.md`
  - 处理：骨架字节原样保留；`{{...}}` 占位符填数据；循环段用简单"mini 模板语法"渲染（`{{#each outer_layers}}...{{/each}}` 之类，或直接写死几个循环 helper 也可）
  - 输出：`doc/architecture.md`
- LLM 在 Step 5.2 的职责退化为"调脚本"，不再自己码 Markdown。

### 类 4：分区 + 哨兵（针对所有受管文档）

- **现状**：模板里关键负向表达（"本 Skill 不会覆盖…" / "禁入内容…"）散落在骨架各处，无法机器校验。
- **对策（todo#4 skeleton_partition + todo#5 check_framework_init）**：在 `architecture.md.skeleton.md` 与 `AGENTS.md.template` 里用 HTML 注释三分区：

```markdown
<!-- framework:skeleton begin id="change-trigger-table" -->
## 变更触发条件
...（字节不变的规则性文字）...
<!-- framework:skeleton end id="change-trigger-table" -->

<!-- framework:data begin id="layer-dep-table" -->
### 层间依赖表
| 外层 id | ... | ... |
| 01-Product | ... | dag |
<!-- framework:data end id="layer-dep-table" -->

<!-- framework:narrative begin id="change-log-entry-2026-04-23" -->
本次把 05-SystemBase 拆成 CommUI / CommFunc 是因为...
<!-- framework:narrative end id="change-log-entry-2026-04-23" -->
```

- 新增 `framework/harness/scripts/check-framework-init.ts`：
  - **skeleton 区**：对每个 `id` 的段落做 sha256 比对（基准值存在源骨架里）；任何 diff → BLOCKER。吞字在这里被直接抓住。
  - **data 区**：重新跑一次 `render-architecture.ts` / `render-entry.ts`，与落地文件比对；diff → BLOCKER。
  - **narrative 区**：允许 AI 生成；但若里面出现"不 / 禁 / 严 / 仅 / 必须"等极性词 → WARN（提示"叙述区不应承载硬规则，请把规则挪到 skeleton"）。

### 类 5：SKILL.md 自己（规则文字的源头）

- **现状**：SKILL.md 里 20+ 条"严禁 / 不得 / 不要"，即使 SKILL.md 本身不被覆盖，**模型在写其它文件时仍会从 SKILL.md 读规则**，读的时候也可能吞字——读错规则就会做错事。
- **对策（todo#6 negative_to_positive）**：滚一遍 `framework/skills/00-framework-init/SKILL.md` + `framework/templates/AGENTS.md.template` + `CLAUDE.md` + `.cursor/rules/framework.mdc`，把可改的负向表达改为正向白名单：

| 改前 | 改后 |
|------|------|
| **不要**同时生成两套入口文件 | **仅**生成 `agent_entry_file.target_path` 指向的那一份入口文件 |
| **不得**自动删除旧 adapter 产物 | 旧 adapter 产物**保留原样**，交由用户手工处理 |
| **不要**擅自改 registry | **仅**使用用户 `~/.npmrc` 中已有的配置 |
| **严禁**在用户未确认前覆盖 `framework.config.json` | **仅**在用户对 diff 回复 `y` 后覆盖 `framework.config.json` |
| 用户未确认前**不得**写入 | 用户确认后**才**写入 |

"仅 X"即使吞字变成"X"也还是同义，语气弱一点；"不要 X"吞字变"要 X"是彻底反义。

### 类 6：Verifier 兜底

- **对策（todo#7 verifier_negation_diff）**：新增 `framework/harness/prompts/verify-framework-init.md`，内含 "negation-diff 专项"段：
  - 输入：源模板（SKILL 可见）+ 落地产物 + 极性词白名单（`不 / 禁 / 严 / 仅 / 必须 / 务必 / 唯一`）
  - 任务：逐行找"源模板里带极性词的句子，在产物里极性是否翻转"
  - 输出：违规行号 + 原文 + 落地文
- 挂到 `verifier` 子 agent（可以选比主 init 流程强的模型，反正只做只读审查）。

### 类 7：Prompt 工程兜底（配菜）

- **对策（todo#8 skill_discipline）**：在 `00-framework-init/SKILL.md` 追加"弱模型纪律"小节，Step 4 / Step 5 开头显式重申：
  > 本步骤涉及的所有模板长文本一律使用 `init-copy.ts` / `render-entry.ts` / `render-architecture.ts` 渲染；**仅在脚本不可用时**回退到 Write 工具原样写入，回退时必须逐字保留源模板中的极性词（"不 / 禁 / 严 / 仅"等），不得概括、润色、翻译或改写。
- 关键段落前后留显式指纹注释行：`<!-- keep-verbatim: do not paraphrase -->`，配合 todo#5 的哨兵检测。

## 三、改造面（按文件分组）

### 3.1 新增脚本（`framework/harness/`）

| 文件 | 职责 | 对应 todo |
|------|------|----------|
| `framework/harness/init-copy.ts` | adapter 模板字节级拷贝 | #1 |
| `framework/harness/render-entry.ts` | AGENTS.md / CLAUDE.md 占位符替换 | #2 |
| `framework/harness/render-architecture.ts` | architecture.md 数据驱动渲染 | #3 |
| `framework/harness/scripts/check-framework-init.ts` | 三分区哨兵校验 | #5 |

所有新脚本遵循现有 `framework/harness/` 风格（`ts-node` 可跑、输出 JSON 结构化报告、与 `harness-runner.ts` 的 phase 机制对齐）。考虑新增 phase `framework-init` 供 `harness-runner.ts --phase framework-init` 调用 `check-framework-init.ts`。

### 3.2 模板与骨架

- **[framework/skills/00-framework-init/templates/architecture.md.skeleton.md](framework/skills/00-framework-init/templates/architecture.md.skeleton.md)** 引入 `<!-- framework:skeleton/data/narrative begin/end id="..." -->` 分区注释；为每个 skeleton 段 id 在源骨架头部附 sha256 基准（或在 `check-framework-init.ts` 运行时动态计算源骨架）。
- **[framework/templates/AGENTS.md.template](framework/templates/AGENTS.md.template)** 同上分区改造；占位符保持 `{{...}}` 不变，供 `render-entry.ts` 消费。

### 3.3 Skill 文档

- **[framework/skills/00-framework-init/SKILL.md](framework/skills/00-framework-init/SKILL.md)**：
  - Step 4（adapter 落地）：落地方式改为"调 `init-copy.ts --adapter <name>`"；保留 Step 0.3 体检结果驱动的 MISSING/EMPTY/POPULATED 策略
  - Step 4.1（入口文件渲染）：改为"构造占位符 JSON + 调 `render-entry.ts`"
  - Step 5.2（architecture.md）：改为"调 `render-architecture.ts`"，骨架段 sha / data 段重渲染一致性由 Step 6 的 `check-framework-init` 兜底
  - Step 6（Harness 验证）：追加一条 `cd framework/harness && npx ts-node harness-runner.ts --phase framework-init`
  - 末尾追加"弱模型纪律"小节（todo#8）

### 3.4 全局规则

- **[CLAUDE.md](CLAUDE.md) / [.cursor/rules/framework.mdc](.cursor/rules/framework.mdc) / [AGENTS.md](AGENTS.md)**（按仓库现有 adapter）：负向 → 正向改写，与 SKILL.md 一致。

### 3.5 Verifier

- **新增 [framework/harness/prompts/verify-framework-init.md](framework/harness/prompts/verify-framework-init.md)**：negation-diff 专项 + 通用语义审查。
- `verifier` 子 agent 调用时传 `phase=framework-init`，参照既有 `verify-<phase>.md` 套路。

## 四、执行顺序与验证

1. **先做脚本**（todo#1/#2/#3）：三个渲染/拷贝脚本；每个脚本带单元自测用例（跑一遍 → 输出字节 == 预期字节）。这一步做完，init 主流程已经无吞字机会。
2. **分区改造**（todo#4）：给 `architecture.md.skeleton.md` + `AGENTS.md.template` 加三分区注释。
3. **哨兵脚本**（todo#5）：`check-framework-init.ts` + 接入 `harness-runner.ts` phase。
4. **正向改写**（todo#6）：源头消除负向词，SKILL.md / 全局规则同步滚一遍。
5. **Verifier**（todo#7）：negation-diff prompt + 挂载。
6. **纪律文字**（todo#8）：SKILL.md 追加"弱模型纪律"小节。
7. **烟雾测试**（todo#9）：在干净的测试工程里用弱模型跑一次 `/framework-init`：
   - 故意观察它是否走脚本路径（不再长文本 Write 模板）
   - `check-framework-init` 报告应当 PASS 或仅 narrative 区 WARN
   - 如果人为"污染"一段 skeleton（模拟吞字），哨兵应当 BLOCKER

## 五、非目标（本 plan 不做）

- **不改**其它 Skill（1-prd-design / 2-requirement-design / ... / 6-device-testing）的类似吞字问题。本 plan 聚焦 `00-framework-init`；其它 Skill 可复用同一套分区 + 哨兵 + verifier 框架，但各自的数据源和脚本不同，单开 plan。
- **不改** `doc/architecture.md` 的**业务内容**（那是"架构文档变更门禁收窄"那份 plan 的范围）。本 plan 只动**生成机制**，不动已落盘内容。
- **不追求**覆盖 LLM 生成"真散文"场景的 100% 防翻转——对 narrative 区只做 WARN 级极性词检测 + verifier 二次审查；更强的散文语义保障留给未来 plan。

## 六、与现有 plan 的关系

- **[架构文档变更门禁收窄](架构文档变更门禁收窄_243f47d3.plan.md)**：那份管"**谁能改** `doc/architecture.md`"（feature 级变更不准改、只有 `dsl_change` / `module_set_change` / `responsibility_rewrite` 三类事件可改）。本份管"**怎么正确生成** `doc/architecture.md`"。两份互补，落地顺序不冲突：那份已完成，本份后续启动也无需回改那份。
