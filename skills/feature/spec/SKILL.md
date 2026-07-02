# Spec 阶段 Skill (`spec`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `spec.terminology` / `spec.feature_path` / `spec.freeze` / `phase.next_step`。

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths**（如 feature 文档目录、`module-catalog.yaml`、`glossary.yaml` 等）及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

**Harness 运行时前置**：执行本 Skill 中任意 `harness-runner` / `npx ts-node harness-runner.ts` / `check-receipt.ts`（依赖 harness npm）前，须满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)（§7.1 跑完 harness 后，§7.3 用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。

**Personal setup（BLOCKER）**：跑 harness 前须 [personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

### Feature 归档定位协议（spec 阶段是创建者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 解析目标归档路径，默认是 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：若 receipt 可能已存在，须**先**自跑 `check-receipt.ts`（或 `harness-runner --sync-closure`）。exit 0 → 该 phase 已闭环，**停等 `phase.next_step`**，禁止仅凭 stale state/summary 判未闭环或重跑本阶段。

- 若 `doc/features/<feature>/` 已存在且是目录：在该目录的 **`spec/spec.md`**（canonical）与根目录 **`acceptance.yaml`** 续写/更新，不要扫描同级同名前缀条目来替代它。
- 若该目录不存在：可以创建该目录作为本 feature 的正式归档目录。
- 若同级存在 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 等归档，或 `<feature>-old/`、`<feature>.md` 等同名前缀条目：仅作为旁证展示给用户，不得自动解压、不得把它们当正式 feature、不得优先读取其内容。
- 若精确路径 `doc/features/<feature>` 已存在但不是目录：必须停下来请用户确认 feature 名称或清理/恢复路径，不能覆盖该文件。**交互**（`spec.feature_path`）：`1=换 feature 名` / `2=清理或恢复路径`。

## Step 0. 载入 `project_profile` addendum（强制）

继续下文前，完整阅读：

`framework/profiles/<project_profile.name>/skills/spec/profile-addendum.md`

其中 `<project_profile.name>` 取自 `framework.config.json > project_profile.name`（未声明时由 harness 按仓库指纹回落默认 profile，见 init Skill S2.1（`project_profile`））。若该文件不存在，则仅依赖本 SKILL 正文 + 对应 profile 下模板/示例路径。

> **Agent 行为规约（BLOCKER）**：完整阅读 [`agent-behavioral-principles.md`](../../reference/agent-behavioral-principles.md)（Karpathy 四原则 · Research First / Minimum Viable / Surgical / Verify Before Proceed）。**Research Sub-Phase 完成前禁止写入 spec 正文。**

> **动态资产引用**：正文中的 `` `profile-skill-asset:<skill>/<asset_key>` `` 须按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析；**禁止**在根 SKILL 写死 `framework/profiles/<某固定 profile>/...`。

---

## 概述

你是一位按当前 `project_profile` 自适配的产品经理。你的任务是根据用户提供的文字描述和界面截图，生成结构化、可执行的 spec 文档。

本 Skill 是项目全生命周期流水线的**第一环**，其输出（spec.md）将作为后续 plan、编码、测试等阶段的输入。

### 阶段定性（spec）

| 叙述产物 | 路径 | 寿命 |
|----------|------|------|
| spec.md（需求规格快照） | `doc/features/<f>/spec/spec.md` | 长期归档 |
| acceptance.yaml | `doc/features/<f>/acceptance.yaml` | 长期 |

宿主扩展通过 `doc/extensions/knowledge/`、`hooks/spec/on_context_load.md` 与 `phase_rules_overlays.spec` 叠加；可选 `provides.skill_assets` 覆盖 profile 模板资产。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "写 spec"、"需求规格"、"spec 设计"、"分析需求"
- "需求文档"、"功能规划"、"产品设计"
- 提供了界面截图并要求分析功能

## 工作流程

### spec 与下游阶段的会话内硬边界（BLOCKER，弱模型必读）

与 plan 阶段「plan / 编码」分界同理：防止「改完 spec 就顺手生成实现计划或改实现」。

1. **请求路由**：用户仅表达「修订 spec / 更新需求文档 / 改验收条目 / Scope / 术语表」而未在同一条或明确承接的指令中要求「做实现计划 / 写 plan / 更新 contracts 设计契约」时，**只激活 spec 阶段**，不得自动滑入 plan 阶段 Skill。
2. **BLOCKER**：上述「spec-only」回合内**不得**新建或实质改写 **`plan.md` 中与「怎么做」相关的技术章节**、`contracts.yaml` 中的接口/文件契约（均属 plan 阶段）。本 Skill 允许的下游产物仅限于 **`spec.md` 与 Step 6 从 spec 提取的 `acceptance.yaml`**（及相关 spec 阶段 Spec）。若用户要「spec 定稿后立刻出 plan」，须在指令中**同时明示**两重意图。
3. **Harness 顺位**：spec.md（及 Step 6 产出）落盘后须**先于**宣称「可进入 plan 阶段」执行 **Step 7.1**（`harness-runner --phase spec`）；禁止「先入 plan 再回头补 spec.harness」。若用户明确要求「先人工审 spec 再立项 plan」，则在 Step 7.1 PASS 后交付摘要并等人审，**未获明示前不得开写 `plan.md`**。

### Step 1: 收集输入

向用户确认以下信息（缺失项需主动询问）：

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能文字描述 | ✅ | 用户想要实现的功能意图和场景说明 |
| 界面截图 | ✅ | 目标应用的真实界面截图，用于参考 UI 布局和交互模式 |
| 功能模块名称 | ✅ | 用于确定文档归档路径（如 `home-page`、`card-management`） |
| 竞品截图 | ❌ | 可选，用于补充交互参考 |

### Step 1.5: 术语消歧（BLOCKER，必做，不可跳过）

> **本步骤是 spec 阶段 Scope 守门机制的真正入口。**
> 用户的自然语言描述中经常出现与模块字面相似但语义错位的术语
> （典型：两个中文名相似但落在不同 `canonical_module`；**领域填充实例**见 `` `profile-skill-asset:spec/examples_spec_mapping` ``。）
> 弱模型若直接进入 Step 2 截图分析并写 spec，非常可能把错误术语映射固化进文档。
>
> **本步骤就是把"隐式的术语理解"变成"显式的术语映射表"，交给用户逐条人工确认。**

#### 1.5.1 必读输入

- [doc/glossary.yaml](../../../../doc/glossary.yaml) — 业务术语 ↔ 权威模块映射表
- [doc/module-catalog.yaml](../../../../doc/module-catalog.yaml) — 每个模块的职责画像（含 `NOT_responsible_for` / `easily_confused_with`）

#### 1.5.2 执行步骤

1. **提取业务名词**
   从用户的原始需求文字中，抽出所有可能指代"功能 / 页面 / 模块 / 能力"的业务名词（含中文和英文），不要自行合并或重命名。

2. **逐个查询 glossary**
   对每个名词，在 `doc/glossary.yaml` 里做匹配：
   - **精确命中 `term`** → 置信度 `high`，记录 `canonical_module`
   - **命中 `aliases`** → 置信度 `high`，记录 `canonical_module` 并注明来自别名
   - **未命中** → 置信度 `low`，进入下一步在 catalog 里找候选

3. **未命中则查询 module-catalog 找 Top-3 候选**
   对每个未命中术语，在 `doc/module-catalog.yaml` 的 `typical_business_terms` / `one_liner` / `responsibilities` 里做子串匹配，给出候选模块 Top-3，附每个候选的 `NOT_responsible_for`（让用户直观判断"是不是真的选错了"）。置信度统一 `low`。

4. **对每个已命中术语，强制检查 `easily_confused_with`**
   即便已精确命中，若该术语 / 其 `canonical_module` 存在 `easily_confused_with`，**必须在映射表里显示该混淆项**，置信度从 `high` 降级为 `medium`。这一步是本 Skill 的核心反模式：**"命中不等于正确，混淆项必须亮给用户看"**。

5. **生成「术语映射表」并停下来等人工确认**（registry `spec.terminology` · artifact `[x]` + 对话 gate）

   先展示 gate（同轮 portable；widget 可用时按 adapter interaction-renderer 呈现）：

   ```text
   1. 全部确认 confidence=high 的行（写回 spec [x]）
   2. 逐行确认
   3. 逐行修改映射
   ```

   逐行时：`1=确认该行（写回 [x]）` / `2=改映射`。

   以下面的格式输出为 spec 的前置章节：

   ```markdown
   ## 0. 术语映射表（用户确认前不得生成后续章节）

   | 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项（必读） | 用户确认 |
   |---------|---------|--------|--------|---------------|---------|
   | <业务术语 A> | <FeatureModule> | <Layer> | medium | <易混模块> — <消歧一句话> | [ ] |
   | <业务术语 B> | <FeatureModule> | <Layer> | high | — | [ ] |
   | （未命中示例）X | 候选①：A / 候选②：B / 候选③：C | — | low | 各候选的 NOT_responsible_for 简述 | [ ] |
   ```

   - **所有行的「用户确认」必须为 `[x]` 才允许生成 spec 正文**（这是 BLOCKER）。
   - 即使置信度是 `high` 也必须人工确认（按项目约定，不启用 auto-approve）。
   - **headless / goal-mode 下例外（就地中和）**：无交互用户时，按 [user-confirmation-ux.md §9](../../reference/user-confirmation-ux.md) 自动写回 `[x]`（glossary 命中 → high 直确认；新术语 → medium/low + DEFERRED-review）并**继续写完 spec 正文**；**禁止**停下问人。本例外**覆盖**上两条停步要求。
   - 用户如对某条映射不满意，要求修正 → AI 把修正后的映射写入本表并再次等用户确认（**仅交互态**）。

6. **回写 glossary（用户批准后）**
   所有用户确认过的**新术语**或**被修正过的术语映射**，必须在 spec 归档前追加或更新到 `doc/glossary.yaml`（带 `confidence_hint: "user-approved on YYYY-MM-DD"`），作为下一次复用的种子。
   **不得**在未获得用户明确同意时修改 glossary。

#### 1.5.3 强约束

1. **禁止在 Step 1.5 完成前进入 Step 2**。
2. **禁止跨过本步骤**——即便用户说"简单需求直接写 spec"，也要输出一张极简的映射表（至少列出需求中出现的主要业务名词）。
3. 映射表必须放在 spec 的 `## 0. 术语映射表` 章节。`check-spec.ts` 会强制校验：
   - 该章节存在
   - 所有行的「用户确认」列为 `[x]`
   - `canonical_module` 字段的值必须存在于 `doc/module-catalog.yaml` 的模块名集合里
   - **每一行的「权威模块」必须同时出现在 Scope 声明的 `in_scope_modules` 或 `out_of_scope_modules` 里**（`terminology_modules_within_scope` BLOCKER）——写了某术语的消歧归属，却忘把对应模块声明进 Scope，属于典型自相矛盾。
4. 若任何一条映射的置信度是 `medium/low` 且用户未确认，`terminology_mapping_table` BLOCKER 会 FAIL，阻塞后续流程。
5. **兜底网**：若 `doc/glossary.yaml` 里的某术语（含 aliases）在 spec 正文出现但未进本映射表，`glossary_terms_used_in_body` WARN 会提示——可能是作者把业务术语当成"普通词"写进正文。补进映射表即可清 WARN；若确认只是偶然带过的非业务用词，忽略 WARN 也不阻断流程。

#### 1.5.4 反模式（禁止）

- ❌ 将用户口语术语直接等同为**错误**的 `canonical_module`，因为"看起来差不多"
- ❌ 置信度一律标 `high`，让用户全量打钩了事
- ❌ 用户在聊天里口头说了"OK"，但没把 `[ ]` 改成 `[x]` 就继续
- ❌ Step 2 截图分析中又出现了未在映射表里的新业务名词，却没有回到 Step 1.5 补条目
- ❌ 术语映射表某行的权威模块与 Scope 的 in/out_of_scope_modules **均无关**（自相矛盾）

---

### Step 2: 截图分析 → 产出 ui-spec.yaml

仔细分析用户提供的界面截图，产出 **`doc/features/<feature>/spec/ui-spec.yaml`**（规范见 [reference/ui-spec.md](reference/ui-spec.md)）：

1. **分区扫描（捕获完整性）**：按顶部导航 / 内容主体 / 底部 / 浮层逐区枚举元素；每元素强制 `implement | defer`，落 **`spec/ref-elements.yaml`**（分母独立于 ui-spec，供 capture_completeness 校验）。**复杂区逐项拆解（G3）**：宫格/轮播/列表须把**每个图标/卡片/广告**枚举为独立元素（如 `service_grid_huawei_card` / `service_grid_unionpay` / `promo_ad_0`），**禁止压成单个 `service_grid`/`promo_swiper` 节点**（否则漏项不进分母、覆盖率虚高）；图标分型按**品牌识别度**（round6 P0-E 收窄）：有品牌识别度（app logo/银行 logo/营销图）才标 `icon.kind: brand_logo` + crop；标准语义图标（tab/铃铛/加号/卡种线性图标等，**即使原图有色**）首选 `icon.kind: system_symbol` + `color_ref` 着色 + `fidelity_note`，详见 reference/ui-spec.md「图标分型」
2. **逐屏识别**：对照 Visual Handoff `authoritative_refs`，每屏一条 `screens[]`（含 `must_have_elements[]`、`semantic_role` / `color_ref` / `icon` / `badge`；**G3 捕获保真**：按钮 `variant`（filled/ghost/text/tonal/outlined，治"实心蓝 vs 浅灰药丸"）、同行元素 `layout_group` + `align` + `width_ratio`（治"全宽 vs 右侧药丸"、左对齐 vs 居中）、区域 `bg_color`（治灰底 vs 蓝底）；P0/P1 完整树 + bbox + 逐字文案）
3. **组件 taxonomy**：节点 `type` 取自 7 类控件（input / action_button / overlay_panel / navigation_frame / content_display / list_selection / logic_condition）
4. **token 表**：品牌色、间距、字号等；色值优先 **半确定性采样**（模型给 `source_bbox`，脚本采像素——见 M2 asset 子步骤）。**采色精度（G3）**：`source_bbox` 须取**目标元素的精确区域**（依赖分区扫描定位的元素 bbox），勿给整屏/大区——否则采到背景白底、得错色
5. **资产清单**：logo/图标 → `acquisition` + `resolved_path` 或显式 `placeholder`；`pixel_1to1` 时联动产出 **`spec/asset-manifest.yaml`**
6. **保真档位（先识别意图，再声明）**：从**原始需求/用户输入**识别强 1:1 信号——"完全参考 / 严格按图 / 像素级 / 1比1 / 逐像素 / 100% 还原 / 照着图做"——**命中即置 `fidelity_target: pixel_1to1`**。`semantic_layout`（默认）仅用于明确不追求逐屏还原的需求；**有截图 + "完全参考"类措辞却用 semantic_layout = 降级，禁止**。`pixel_1to1` 时 defer 须 `fidelity_deferrals` + **真人签字**（`signed_by: goal-mode-auto` 等自签不算人签）；见 [reference/visual-handoff.md](reference/visual-handoff.md)
7. **DSL↔原图 gate**：人工逐屏 `[x]` 确认 → `verified: human_confirmed`；或无 VL 时 `verified: unverified`（下游降级，见 ui-spec.md）。**headless / goal-mode**：按 §9 自动标记并留痕，未签字 defer → BLOCKER。

**模型档位（K2）**：本 Step **必须用强 VL 模型**（Composer 2.5 等）；内网弱模型勿跑提取（garbage in）。

#### Step 2.1 资产落地（review#2）

对每个 `assets[]` 按 `acquisition` 真正产出 `resolved_path`：`crop` 从原图裁 logo（关键资产须 `human_crop_confirmed`）；缺则 `placeholder: true` + `rationale`。**自然语言授权识别**：用户只需说“资源可以从原始图片/截图/素材图中裁剪获取”“从图里截元素/截图取资源”等自然话，即视为授权 Maison 使用截图裁剪路径；agent 必须自行翻译为 `acquisition: crop`、精确 `source_ref/source_bbox`、确定性 `resolved_path`，并记录 `human_crop_confirmed: true` + `crop_confirmed_by: user_requirement`（授权来自用户需求文本，不是 agent 自签）。**授权 ≠ 逐框验真（P0-C·round6 命门）**：`user_requirement` 只是"允许走截图裁剪路径"的**总体授权**，**绝不等于**"这 N 个 bbox 都框对了"的逐框确认——round6 事故正是把一句授权当 23 个 bbox 的免检金牌，废图全数放行。产物验真由独立门禁 `asset_crop_validation` 把关（见下），授权恒不豁免验真。**G4b goal 模式裁剪**：若缺少上述用户授权或 bbox 仍不确定，crop 待确认门禁触发——goal-runner **暂停求人确认/微调 bbox**，确认后置 `human_crop_confirmed`（**headless 须连同 `crop_confirmed_by` 真人/用户授权来源**）自动裁剪；headless 无真人/用户授权确认即 BLOCKER（**自报不算**）。用户也可在需求入口**前置**给 bbox/素材目录（`user_dir`/`asset_pack`）→ 免 mid-run halt 直接裁。这让"无高保真时用原始截图搞定资源"在 goal 模式从休眠转可用。**下游契约（物化 SSOT）**：`resolved_path` 是 coding 阶段把真裁图**物化进模块 `resources/base/media/`** 的唯一来源——coding 须从此路径复制真图，不得另造 1×1/纯色占位；门禁 `visual_parity_asset_materialized` 会校验模块 media 为真图。**裁后验真（P0-B·必做）**：裁剪完成后对**每张** crop 产物做 VL 独立辨认——**新开隔离会话，只给 crop 图**（不给 ui-spec/上下文）问"这张图是什么元素"，将辨认结果与该资产用途比对，逐项落 `spec/reports/asset-crop-vl.yaml`（`entries[].key / identified_as / match / by`）；**不许由裁图的同一上下文自己宣布"裁对了"**（自报无效）。门禁 `asset_crop_validation` 会先跑确定性 sanity（条状/纯色/空白/长宽比可一票否决），sanity 过了还须 VL match 或真人 `bbox_verified_by`（对照 `spec/reports/asset-contact-sheet-*.png` 确认）才判 verified；未 verified 的 crop 在 coding 被 `visual_parity_unverified_crop` 拦下不得物化。VL 不可用/断流 ≠ 放行——headless 走 halt-confirm 求人。

仍可在 spec.md「页面/界面描述」保留散文补充，但 **ui-spec.yaml 为 coding parity 的结构化 SSOT**。

### Step 2.5: Research Sub-Phase（Context Exploration Gate · BLOCKER）

在**首次写入「功能概述」等 spec 正文大块之前**（即进入 **Step 3** 之前），必须完成本 Step。**未完成不得写 spec 正文。**

#### 2.5.1 启动探索

1. **读本阶段 SSOT**：`doc/glossary.yaml`、`doc/module-catalog.yaml`、`doc/architecture.md`；用户视觉/文本输入；相关 feature 既有实现（**至少 `source_code_paths` 含 2 个源码文件**）。
2. **宿主路径**：按 Step 0 `profile-addendum.md`「Context Exploration」+ profile `exploration-snippets` 声明的必查路径（见 `framework/profiles/<profile>/harness/exploration-snippets.yaml`）。
3. **frontmatter 变更信号**：填写 `change_intent`、`estimated_loc_delta`、`touches_layers`、`adds_new_exports`；harness 按 `exploration_strategy` **复合评分**（模块 LOC / scope / 跨层 / fan-out）决定是否须 subagent；评分 ≥ 60 时 MUST explore 子 agent（`exploration_mode: subagent`），无 subagent 能力时用 `sequential` + 倍率阈值。

#### 2.5.2 收集 Code Facts

填写 [`context-exploration.md`](../../../../harness/templates/context-exploration.md) 正文 **Code Facts** 表格（路径 + 事实 + 对 spec 的影响）。

#### 2.5.3 落盘

- 路径：`doc/features/<feature>/spec/context-exploration.md`
- frontmatter：**`schema_version: "1.1.0"`**，`source_code_paths` / `decisions_unlocked` 非空，`key_inputs_read` 覆盖 glossary、module-catalog、architecture 及 profile 子串
- 自检通过后：`ready_to_produce: true`，`has_blocker_coverage_risk: false`

### Step 3: 生成 spec 初稿

读取 spec 文档模板：`` `profile-skill-asset:spec/spec_template` ``（解析规则见 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol)）。**勿**在 `framework/skills/feature/spec/templates/` 找它（那里只有通用 `feature-card.md`）——它在 `framework/profiles/<project_profile.name>/skills/spec/templates/spec-template.md`。

按模板结构填充内容，**必须包含以下 10 个章节**。  
**Visual Handoff**：仅当需求为 **UI 形态**（新屏 / 改版 / 需对齐设计真源）时，须在 Scope 附近增加 **独立** `yaml` 块（根字段含 `ui_change`），写法见 [reference/visual-handoff.md](reference/visual-handoff.md)；**后端 / 库 / 云侧无界面**需求且团队未 opt-in `framework.config.json` 的 `spec.visual_handoff_enforcement: strict` 时，**不写**该块不产生脚本噪声。**doc/features/** 是否提交主仓由实例 **`paths.docs_committed`** 决定，harness 不隐含「必须入库」。

0. **术语映射表** — Step 1.5 产物，所有映射必须 `[x]` 已确认（BLOCKER 起点）
1. **功能概述** — 一句话描述该功能模块的核心价值
2. **Scope 声明** — 本需求允许修改哪些模块、明确不改哪些模块、为什么（Scope 守门机制第二道）
3. **目标用户与使用场景** — 明确谁在什么场景下使用
4. **功能清单** — 每项含：功能名、优先级（P0-P3）、描述
5. **页面/界面描述** — 从截图提取的布局、组件、交互动作详细描述
6. **业务流程图** — 使用 Mermaid flowchart 描述核心业务流
7. **异常/边界场景处理** — 网络异常、空数据、权限不足等
8. **非功能性需求** — 性能、兼容性、安全性要求
9. **验收标准** — 可量化、可测试的条件列表

> **Scope 声明必须与术语映射表一致**：`in_scope_modules` 的所有条目必须来自映射表里已确认的 `canonical_module`，不允许出现映射表未涉及的模块。

#### Visual Handoff（与截图 / 设计稿对齐）

- UI 形态：写完 Scope 后，按 [reference/visual-handoff.md](reference/visual-handoff.md) 增加**单独**的 ` ```yaml ` 块，根字段含 `ui_change`。
- 不动 UI 或 UI 已外落成：在同一独立块中使用 `none` / `reuse_only` / `impl_out_of_band`（**勿**在无依据时写 `new_or_changed`）。
- 有界面改版或新屏：`new_or_changed`（或 `copy_edits_only`）+ `visual_handoff`；`path` 可为**仓内相对**、**`${UX_ROOT}/...`** 或通过配置允许的绝对路径/UNC；`url` 类 kind 写明 http(s)。
- **在线高保真**（内网 Figma / 门户）：`visual_handoff.kind: fidelity_snapshot` + `source_link`；spec 阶段 **显式调用宿主 MCP `fetch_fidelity`** 落盘 `ux-reference/_fidelity-cache/`（PNG + `fidelity.lock.yaml`）；`screens[].id` **必须等于** ui-spec 各屏 `ref_id`/`source_ref`。详见 [reference/visual-handoff.md](reference/visual-handoff.md) 与 [fidelity-fetch-mcp-contract.md](../../../docs/operations/fidelity-fetch-mcp-contract.md)。
- spec 内嵌缩略图仅辅助；**像素权威以 handoff 声明的路径/URL 或 lock 快照为准**。

#### Step 3.1 Scope 声明填写规则（必读）

Scope 声明是 plan 阶段和 coding（Coding）能否"不扩大改动范围"的唯一依据，**必须在生成 spec 正文前先确定**：

1. 通读需求描述 + 截图，识别要实现的功能。
2. 对照 `doc/architecture.md` 的"模块清单"，判断哪些模块**必须改**（= `in_scope_modules`）、哪些模块**看似相关但本需求不需要改**（= `out_of_scope_modules`）。
3. 在 `rationale` 中回答一个问题："如果后续 plan 阶段 想把逻辑提到公共模块，我是否同意？不同意的理由是什么？"
4. `in_scope_modules` 的模块名必须使用 PascalCase，且与 `doc/architecture.md` 保持一致（如 `FeatureModuleA`、`FeatureModuleB`，**不要**使用 `kebab-case` 或 `snake_case`）。
5. 如果确实判断不清楚，宁可把 scope 声明得窄一些（只列最核心那 1 个模块），让 plan 阶段 遇到问题时触发用户确认流程，也不要先写得宽松留"后路"。

### Step 4: 质量门禁自检

生成初稿后，执行以下自检清单（逐项检查，不通过则自动修正）：

```
[ ] 1. 功能概述：是否为一句简洁明确的描述？（非"xxx功能"这种空泛表述）
[ ] 2. Scope 声明：是否有 yaml 代码块？in_scope_modules 是否至少 1 项且与 architecture.md 模块名一致？rationale 是否真正解释了"为什么不改 out_of_scope_modules"？
[ ] 3. 目标用户：是否明确了用户角色？使用场景是否具体？
[ ] 4. 功能清单：是否每项都有 P0-P3 优先级标注？描述是否具体到可实现？
[ ] 5. 界面描述：是否覆盖了截图中所有可见的 UI 元素？布局描述是否可复现？
[ ] 6. 业务流程图：Mermaid 语法是否正确？是否覆盖了主路径和关键分支？
[ ] 7. 异常场景：是否至少覆盖了网络异常、数据为空、权限不足三种基本场景？
[ ] 8. 非功能性需求：是否有具体的量化指标（如页面加载 < 2s）？
[ ] 9. 验收标准：每条标准是否可测试、可量化？是否与功能清单一一对应？
[ ] 10. Visual Handoff：若为 UI 需求，是否有独立 yaml 块且含 `ui_change`？若 `new_or_changed`，handoff `path`/`url` 是否指向可比 spec 内嵌图更精确的真源（含外链 `${UX_ROOT}` 等范式）？非 UI / 后端需求可明示 `none` 等或省略整块（与实例 `spec` 段 / `paths.docs_committed` 策略一致）。
[ ] 11. ui-spec.yaml：若 `ui_change=new_or_changed`，是否已产出 ui-spec（screens/tokens/assets）？P0 屏是否有组件树 + 逐字文案？`verified` 是否已过 gate（非 unverified 进 plan）？
```

**不通过项**：找出具体缺失点，自动补充完善后重新自检，直到 **10** 项全部通过。

### Step 5: 输出与归档

> **顺序纠错**：必须先把 `spec.md` 写入磁盘，脚本 harness（Step 7.1）与 Spec 对齐检查才能读到文件。**「用户确认」指是否冻结需求并授权下游（plan 阶段）或继续迭代 spec**，不是「确认后才允许写入 spec.md」。

1. 将 spec 保存（或更新）至：
   ```
   doc/features/{module-name}/spec/spec.md
   doc/features/{module-name}/spec/ui-spec.yaml   # ui_change=new_or_changed 时必填
   ```
2. 在对话中输出变更摘要，便于人工审阅；用户若有修改意见，回到 Step 4（及前置 Step）迭代后再回到本 Step。
3. **冻结 / 下游授权**（`spec.freeze`）：`1=冻结 spec，可进 plan 阶段` / `2=继续改 spec`（口头 OK 无效）。
4. 进入 **Step 6**；Step 6 完成后**立即进入 Step 7**，**严禁**跳过 **Step 7.1**。若产品与流程要求「先审 spec 再进 plan」，在 Step 7.1 PASS 之后停等明示，其行为约束见上文「spec 与下游阶段的会话内硬边界」。

### Step 6: 提取功能级 Spec

spec 归档后，**必须**同步提取功能级规约文件到 `doc/features/{module-name}/` 目录。Spec 是连接生成层（Skill）和验证层（Harness）的枢纽，也是后续 Skill（编码、UT、测试）的参照基准。

#### 6.1 提取验收标准

从 spec.md 中提取结构化验收标准，写入 `doc/features/{module-name}/acceptance.yaml`：

**`criteria` 章节**（从 spec「验收标准」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 验收标准编号 | 如 AC-1、AC-2 |
| `prd_function` | 功能清单编号 | 如 F1、F2，建立追溯链 |
| `priority` | 功能清单优先级 | P0/P1/P2/P3 |
| `description` | 验收标准描述 | 可测试的验收条件 |
| `testable` | 固定 true | 所有 AC 必须可测试 |
| `verification_steps` | 从描述中提炼 | 具体的验证操作步骤列表 |
| `expected_result` | 从描述中提炼 | 可观察的预期结果 |
| `data_constraints` | 从描述中提炼 | 数据约束（数量、具体值等，可选） |
| `ut_layer` | **必填** | UT 分层：`unit`（仅 profile 宿主业务 UT 覆盖）/ `device`（仅真机 UI 自动化覆盖）/ `both`（两层都需要覆盖）。详见下方《6.1.1 ut_layer 分层指引》 |
| `ut_focus` | 若 ut_layer ∈ {unit, both} 必填 | 简要说明 UT 要断言什么（如"state 最终为 Success；storage.save 被调用；save 数据字段完整"）；不写具体代码，只点明关切点 |
| `device_focus` | 若 ut_layer ∈ {device, both} 必填 | 真机可观察要点（导航目标页、Toast 文案、布局/性能等）；**both 禁止**把 UI 要点只写进 `ut_focus` |
| `linked_flow` | 若 ut_layer ∈ {unit, both} 建议填 | 指向 `doc/features/{feature}/use-cases.yaml > use_cases[].id`，如 `<flow_id>` |
| `linked_branch` | 若 ut_layer ∈ {unit, both} 建议填 | 指向该 use_case 的 `branches[].id`，如 `<branch_id>` |

**`boundaries` 章节**（从 spec「异常/边界场景处理」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 边界编号 | 如 BD-1、BD-2 |
| `prd_exception` | 异常场景编号 | 如 E1、E2 |
| `scenario` | 场景标识 | 如 network_offline、empty_data |
| `description` | 场景描述 | |
| `handling` | 处理方式 | spec 中定义的处理策略 |
| `expected_behavior` | 预期行为 | 处理后的可观察结果 |
| `ut_layer` | **必填** | 同 `criteria.ut_layer` |
| `ut_focus` | 若 ut_layer ∈ {unit, both} 必填 | 简要说明 UT 关切点 |
| `device_focus` | 若 ut_layer ∈ {device, both} 必填 | 真机可观察要点（同 criteria） |
| `linked_flow` / `linked_branch` | 若 ut_layer ∈ {unit, both} 建议填 | 同 `criteria` 字段 |

#### 6.1.1 ut_layer 分层指引

一条 AC / BD 应该归到哪一层，按以下规则判定（从严判 `device`）：

| ut_layer | 典型特征 |
|---|---|
| `unit` | 验收点是业务流程/数据/状态层面：数据是否加载成功、Repository 是否返回预期、UseCase 分支是否进入预期 state、本地持久化是否回滚 |
| `device` | 验收点是 UI 表现/真人交互：Tab 切换动画、点击区域是否可达、Toast 是否出现、键盘/输入焦点、`navPathStack.pushPath` 的真实跳转、深色模式主题切换 |
| `both` | 既有数据/状态断言，又强依赖真实 UI 反馈（如"点击卡片后跳转到详情页且详情页数据正确"） |

**原则**：
1. **纯 UI/交互 AC 必须落 device**——业务 UT 中禁止依赖真实 UI 导航/Toast（见 ut-rules.yaml `no_ui_dep_in_ut` BLOCKER；细则随 `project_profile`）
2. **业务流程分支必须落 unit**——"成功/失败/取消/回滚"这类状态流转由 UseCase 在 UT 中端到端覆盖
3. **ut_layer = both 的 AC**：必须分别填写 `ut_focus`（业务）与 `device_focus`（UI/真机），禁止混写在单段 `ut_focus` 中；UT 只承担业务部分，UI 由 device-testing 按 `device_focus` 派生 test-plan

**`performance` 章节**（从 spec「非功能性需求」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | NFR 编号 | 如 NFR-1 |
| `metric` | 指标名称 | 如"页面首屏加载" |
| `threshold` | 量化阈值 | 如 "<= 1.5s" |

**`coverage_summary` 章节**（自动统计）：

统计 P0/P1/P2 功能的 AC 覆盖率，确保每个 P0/P1 功能至少有一条 AC 覆盖。

#### 6.2 输出文件与参考

```
doc/features/{module-name}/acceptance.yaml
```

参考已有示例：`doc/features/home-page/acceptance.yaml`

> **为什么这一步如此重要**：`acceptance.yaml` 是后续 Harness 验证编码完整性、business-ut 生成 UT 断言、device-testing 生成测试用例的基准。若不提取，下游无法自动验证。

### Step 7: Harness 验证门禁（agent 必须自跑）

> **全局入口 §4.1 明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

Spec 文件提取完成后，agent **必须自己**完成下列验证，再宣布 spec 阶段完成。

> **顺位（BLOCKER）**：Step 6 结束后的**下一件正事就是 7.1**；不得在「已开始 plan 阶段 / 改写 plan」之后，才回补本阶段的 spec.harness（除非回档 plan 侧 SSOT，以 spec 仍为 SSOT 为前提）。

#### 7.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase spec --feature {module-name}
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。

> ⚠️ **一定要通过 `harness-runner.ts` 入口**：直接 `ts-node scripts/check-spec.ts` 不会触发任何检查（`check-*.ts` 只是导出 checker 模块，没有 CLI 入口），会静默返回 0 造成"假通过"。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/spec-rules.yaml` — 阶段级通用规则（章节存在性、表格格式、优先级合法性、追溯完整性等）
- `doc/features/{module-name}/acceptance.yaml` — 功能级验收标准（若存在则加载；spec 阶段通常不依赖）

**若报告中存在 BLOCKER 级问题**：必须修正 spec 并重新提取 acceptance.yaml（回到 Step 4），直到零 BLOCKER。

#### 7.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 `subagent_type: verifier`（不是"告诉用户去跑"），把 feature / phase / 脚本报告路径传入：

- **Prompt 模板**：`framework/harness/prompts/verify-spec.md`（由 verifier 子 agent 自行读取）
- **触发方式**：Task 工具，subagent_type=verifier，prompt 中给出 feature/phase/脚本报告路径
- **语义检查覆盖项**：
  1. 功能概述清晰度
  2. 使用场景具体性
  3. 功能描述可执行性
  4. 验收标准可测试性（BLOCKER 级）
  5. UI 组件术语规范
  6. 模拟范围意识
  7. 业务流程分支覆盖
  8. 使用场景到页面追溯

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 阶段闭环判定（全局入口 §5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」：**部分 adapter** 经 framework-init 在实例根下发 **Stop hook**，在消息结束前读取 state 并阻断「假完成」（Layer 3 行为与路径见 [framework/agents/README.md](../../../../agents/README.md)）。**未**配置该能力的 adapter 不设物理层豁免，仍须满足 Layer 1（全局入口 §6.5「反假设条款」）+ Layer 2（完成回执 + `check-receipt.ts`）——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

spec 阶段宣布"完成"前必须**同时**满足：

1. `doc/features/<feature>/spec/reports/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/spec/phase-completion-receipt.md` 已填写并通过 `cd framework/harness && npx ts-node scripts/check-receipt.ts --feature <feature> --phase spec` 校验（与 §7.1 同 shell 接续；勿用 `framework/harness/scripts/...` 前缀）。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，spec 阶段完成，**具备**进入 plan 阶段 Skill 的**资格**；**不授权**自动开 plan 阶段。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：除非用户消息为 **batch 多阶段授权**（§8.2），否则须 **`phase.next_step`**（确认菜单 + portable 编号）停等。**`spec.freeze` 只冻结 spec 内容**，不等同于 harness 通过后可在同一执行流自动写 `plan.md`。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

## 输出规范

### 文件路径

| 产出 | 路径 |
|------|------|
| spec 文档 | `doc/features/{module-name}/spec/spec.md` |
| 验收标准 Spec | `doc/features/{module-name}/acceptance.yaml` |

### 文档格式
- 使用 Markdown 格式
- 流程图使用 Mermaid 语法
- 功能清单使用表格
- 验收标准使用有序列表

### Spec 格式
- 使用 YAML 格式
- 遵循 `doc/features/home-page/acceptance.yaml` 的结构模式
- 所有 ID 字段（AC-N、BD-N、NFR-N）保持唯一

### 优先级定义

| 优先级 | 含义 | 说明 |
|--------|------|------|
| P0 | 必须实现 | 核心功能，缺失则模块不可用 |
| P1 | 应当实现 | 重要功能，影响核心体验 |
| P2 | 最好实现 | 增强功能，提升用户体验 |
| P3 | 可以延后 | 锦上添花，不影响基本使用 |

## 关联文件

- spec 模板: `` `profile-skill-asset:spec/spec_template` ``
- 功能卡片模板: [templates/feature-card.md](templates/feature-card.md)（通用，仍位于本 Skill 树内）
- 示例 spec: `` `profile-skill-asset:spec/example_spec` ``
- 阶段级规约: `framework/specs/phase-rules/spec-rules.yaml`
- 功能级 Spec 示例: `doc/features/home-page/acceptance.yaml`
- 脚本 Harness: `framework/harness/scripts/check-spec.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-spec.md`

## 下游消费者

本 Skill 的输出将被以下 Skill 和 Harness 消费：

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **plan 阶段 (需求设计)** | spec.md | 读取功能清单，生成实现计划文档 |
| **coding (编码)** | acceptance.yaml | 参照验收标准和边界用例实现代码 |
| **business-ut (业务级 UT)** | acceptance.yaml | 参照验收标准生成 UT 断言 |
| **device-testing (真机测试)** | acceptance.yaml | 参照验收标准生成测试用例 |
| **Harness (验证层)** | acceptance.yaml | 脚本/AI 验证编码和 UT 的完整性 |

## 约束与注意事项

1. **截图是关键输入**：截图中的 UI 细节是 spec 界面描述的主要依据，不可忽略截图中的任何可见元素
2. **宿主生态适配**：描述 UI 或交互组件时优先使用当前 profile addendum 声明的宿主术语
3. **模拟数据标注**：涉及真实后端（第三方结算网关、账务或金融类开放接口等）的功能，若当前阶段无法接入真实服务，应在 spec 中标注为"模拟数据"
4. **不要过度设计**：spec 关注"做什么"而非"怎么做"，技术实现细节留给 plan 阶段
5. **中文输出**：所有 spec 内容使用简体中文

---

## Slash / 快捷入口触发时的 trace 约定

当本 Skill 通过适配器下发的 slash（如 `/spec`，名称以实例根模板为准）或其它等价快捷入口触发时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`doc/features/<feature>/spec/reports/<timestamp>/<model>-spec/trace.json`
  - `<feature>`：功能名，与 `doc/features/<feature>/` 对应
  - `<timestamp>`：`YYYYMMDD-HHmmss` 格式
  - `<model>`：实际运行的模型标识，如 `minimax-2.5` / `glm-4.5` / `<vendor-llm-id>`
- **Schema**：[framework/harness/trace/trace.schema.json](../../../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `spec`。
- **痛点回填**：同目录下再产出一份 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../../../framework/harness/trace/gap-notes.template.md)。
- **用途**：trace.json 是内网弱模型试运行的主要回传物，用于驱动 skills/spec/harness 的下一轮迭代。**不要省略**。

---

## 运行时交付约定（内网 / 弱模型）

当本 Skill 在脚本化或弱约束 agent 运行时（尤其是内网弱模型场景），**阶段结束前必须**在以下目录产出交付凭证：

```
doc/features/<feature>/spec/reports/<timestamp>/<model>-spec/
├── trace.json          # 结构见 framework/harness/trace/trace.schema.json（phase = "spec"）
├── gap-notes.md        # 痛点回传，结构见 framework/harness/trace/gap-notes.template.md
└── check-spec.report.md # check-spec.ts 的输出（若已运行）
```

用途：
1. 内网弱模型跑动后将 trace.json + gap-notes.md 回传给维护 `framework/` 工程的协作通道，迭代 skills / specs / harness；
2. 对比不同模型在同一 feature 上的表现；
3. 定位"框架没兜住的问题"，驱动下一波改造。


## 宿主扩展治理（extension 介入路径）

core 模板只收通用、可验证、跨宿主成立的维度。宿主细则通过 `doc/extensions/knowledge/`、`hooks/spec/on_context_load.md`、`phase_rules_overlays.spec` 叠加。流程性事项（管理台排期、打点/SVN、翻译/TA）走 extension checklist，不进 core 模板。见 [phase-terminology.md](../../../../../docs/concepts/phase-terminology.md)。

**机器可读契约**：本阶段产出 `acceptance.yaml`（长期归档）；`contracts.yaml` / `use-cases.yaml` 由 plan 阶段维护，coding/review/UT 以 `contracts.yaml` 为真源。
