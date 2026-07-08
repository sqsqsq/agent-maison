# spec 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/spec/SKILL.md`](../feature/spec/SKILL.md)。本文承载 Step 1.5（术语消歧）、Step 2/2.1（截图分析 + 视觉资产验真，pixel_1to1 相关）、Step 6（acceptance 提取字段表）的完整机制；触发/门禁清单/闭环判定仍以主文档为准。

## Step 1.5：术语消歧完整机制

**本步骤是 spec 阶段 Scope 守门机制的真正入口。** 用户的自然语言描述中经常出现与模块字面相似但语义错位的术语（**领域填充实例**见 `` `profile-skill-asset:spec/examples_spec_mapping` ``）。弱模型若直接进入 Step 2 截图分析并写 spec，非常可能把错误术语映射固化进文档——本步骤把"隐式的术语理解"变成"显式的术语映射表"，交给用户逐条人工确认。

**必读输入**：`doc/glossary.yaml`（业务术语↔权威模块）、`doc/module-catalog.yaml`（模块职责画像，含 `NOT_responsible_for`/`easily_confused_with`）。

**执行步骤**：

1. **提取业务名词**：从用户原始需求文字中抽出所有可能指代"功能/页面/模块/能力"的业务名词，不自行合并或重命名。
2. **逐个查询 glossary**：精确命中 `term` 或 `aliases` → 置信度 `high`，记录 `canonical_module`；未命中 → 置信度 `low`，进下一步。
3. **未命中则查 module-catalog 找 Top-3 候选**：在 `typical_business_terms`/`one_liner`/`responsibilities` 子串匹配，附每候选的 `NOT_responsible_for`。
4. **强制检查 `easily_confused_with`**：即便精确命中，若术语/其 `canonical_module` 存在易混项，**必须在映射表显示**，置信度从 `high` 降为 `medium`——"命中不等于正确，混淆项必须亮给用户看"。
5. **生成「术语映射表」并停下来等人工确认**（registry `spec.terminology`）：

   ```markdown
   ## 0. 术语映射表（用户确认前不得生成后续章节）

   | 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项（必读） | 用户确认 |
   |---------|---------|--------|--------|---------------|---------|
   | <业务术语 A> | <FeatureModule> | <Layer> | medium | <易混模块> — <消歧一句话> | [ ] |
   ```

   - **所有行的「用户确认」必须为 `[x]` 才允许生成 spec 正文**（BLOCKER）；即使 `high` 也须人工确认。
   - **headless/goal-mode 例外**：无交互用户时按 [user-confirmation-ux.md §9](user-confirmation-ux.md) 自动写回 `[x]`（glossary 命中→high 直确认；新术语→medium/low + DEFERRED-review）并继续写完正文，**禁止**停下问人；此例外覆盖上一条停步要求。
   - 用户不满意某条映射 → 修正后写回本表再等确认（仅交互态）。

6. **回写 glossary（用户批准后）**：新术语/被修正的映射须在归档前追加/更新到 `doc/glossary.yaml`（带 `confidence_hint: "user-approved on YYYY-MM-DD"`）；**不得**未获同意时修改 glossary。

**强约束**：Step 1.5 完成前禁止进 Step 2；即便"简单需求"也要输出极简映射表；映射表须放 `## 0. 术语映射表`（`check-spec.ts` 校验章节存在/`[x]`全勾/`canonical_module`在 catalog 中/**每行权威模块须同时出现在 Scope 的 in/out_of_scope_modules**——`terminology_modules_within_scope` BLOCKER）；`medium/low` 未确认 → `terminology_mapping_table` BLOCKER FAIL；`glossary_terms_used_in_body` WARN 提示正文出现但未入映射表的术语。

**反模式**：口语术语直接等同错误 canonical_module；置信度一律标 high 图省事；口头"OK"未落 `[x]`；Step 2 冒出新业务名词却不回补映射表；映射表某行权威模块与 Scope in/out 均无关（自相矛盾）。

## Step 2：截图分析 → ui-spec.yaml（pixel_1to1 相关，UI 需求必读）

产出 `<features_dir>/<feature>/spec/ui-spec.yaml`（规范见 [reference/ui-spec.md](../feature/spec/reference/ui-spec.md)）：

1. **分区扫描（捕获完整性）**：按顶部导航/内容主体/底部/浮层逐区枚举元素；每元素强制 `implement|defer`，落 `spec/ref-elements.yaml`。**复杂区逐项拆解**：宫格/轮播/列表须把每个图标/卡片枚举为独立元素，**禁止压成单节点**（否则漏项不进分母、覆盖率虚高）；图标按**品牌识别度**分型：有品牌识别度（logo/营销图）→ `icon.kind: brand_logo` + crop；标准语义图标（tab/铃铛等，即使原图有色）→ `icon.kind: system_symbol` + `color_ref` 着色 + `fidelity_note`。
2. **逐屏识别**：对照 Visual Handoff `authoritative_refs`，每屏一条 `screens[]`（`must_have_elements[]`、`semantic_role`/`color_ref`/`icon`/`badge`；按钮 `variant`、同行元素 `layout_group`+`align`+`width_ratio`、区域 `bg_color`；P0/P1 完整树+bbox+逐字文案）。
3. **组件 taxonomy**：7 类控件（input/action_button/overlay_panel/navigation_frame/content_display/list_selection/logic_condition）。
4. **token 表**：品牌色/间距/字号；色值优先半确定性采样（`source_bbox` 须取目标元素精确区域，勿给整屏/大区）。
5. **资产清单**：logo/图标 → `acquisition`+`resolved_path` 或显式 `placeholder`；`pixel_1to1` 时联动产出 `spec/asset-manifest.yaml`。
6. **保真档位**：识别强 1:1 信号（"完全参考/严格按图/像素级/1比1/逐像素/100%还原/照着图做"）→ 置 `fidelity_target: pixel_1to1`；有截图+"完全参考"类措辞却用 `semantic_layout` = **禁止的降级**。`pixel_1to1` defer 须 `fidelity_deferrals` + **真人签字**（`signed_by: goal-mode-auto` 等自签不算）。
7. **DSL↔原图 gate**：人工逐屏 `[x]` → `verified: human_confirmed`；无 VL → `verified: unverified`（下游降级）。headless/goal-mode 按 §9 自动标记留痕，未签字 defer → BLOCKER。

**模型档位**：本 Step 必须用强 VL 模型；内网弱模型勿跑提取。

### Step 2.1 资产落地（裁剪验真，pixel_1to1 核心红线）

对每个 `assets[]` 按 `acquisition` 产出 `resolved_path`：`crop` 从原图裁 logo（关键资产须 `human_crop_confirmed`）；缺则 `placeholder: true`+`rationale`。

**自然语言授权识别**：用户说"资源可以从原始图片/截图/素材图中裁剪获取"等即视为授权 Maison 走截图裁剪路径；agent 须翻译为 `acquisition: crop`、精确 `source_ref/source_bbox`、确定性 `resolved_path`，记录 `human_crop_confirmed: true`+`crop_confirmed_by: user_requirement`。

**授权 ≠ 逐框验真**（历史事故命门）：`user_requirement` 只是"允许走截图裁剪路径"的总体授权，**绝不等于**"这 N 个 bbox 都框对了"的逐框确认——把一句总体授权当逐框免检金牌曾导致废图全数放行。产物验真由独立门禁 `asset_crop_validation` 把关，授权恒不豁免验真。

**goal 模式裁剪**：缺用户授权或 bbox 不确定 → goal-runner 暂停求人确认/微调 bbox，确认后置 `human_crop_confirmed`（headless 须连同 `crop_confirmed_by` 真人来源）自动裁剪；headless 无真人确认即 BLOCKER（自报不算）。用户也可在需求入口前置给 bbox/素材目录免 mid-run halt。

**下游物化契约**：`resolved_path` 是 coding 阶段把真裁图物化进模块 `resources/base/media/` 的唯一来源；coding 须从此路径复制真图，不得另造占位；门禁 `visual_parity_asset_materialized` 校验模块 media 为真图。

**裁后验真（必做）**：裁剪完成后对每张 crop 产物做 VL 独立辨认——**新开隔离会话，只给 crop 图**（不给 ui-spec/上下文）问"这张图是什么元素"，辨认结果与用途比对，落 `spec/reports/asset-crop-vl.yaml`（`entries[].key/identified_as/match/by`）；**不许由裁图的同一上下文自己宣布"裁对了"**（自报无效）。门禁 `asset_crop_validation` 先跑确定性 sanity（条状/纯色/空白/长宽比一票否决），过了还须 VL match 或真人 `bbox_verified_by`（对照 `asset-contact-sheet-*.png`）才判 verified；未 verified 的 crop 在 coding 被 `visual_parity_unverified_crop` 拦下不得物化。VL 不可用/断流 ≠ 放行——headless 走 halt-confirm 求人。

## Step 6：提取 acceptance.yaml 字段表

`criteria` 章节（从「验收标准」提取）：`id`（AC-N）/`prd_function`（功能清单编号）/`priority`/`description`/`testable`（固定 true）/`verification_steps`/`expected_result`/`data_constraints`（可选）/`ut_layer`（**必填**，见下）/`ut_focus`（ut_layer∈{unit,both} 必填）/`device_focus`（ut_layer∈{device,both} 必填，both 禁止把 UI 要点只写 ut_focus）/`linked_flow`/`linked_branch`（建议填，指向 use-cases.yaml）。

`boundaries` 章节（从「异常/边界场景处理」提取）：`id`（BD-N）/`prd_exception`/`scenario`/`description`/`handling`/`expected_behavior`/`ut_layer`+`ut_focus`/`device_focus`（同上）。

**ut_layer 分层判定**（从严判 device）：

| ut_layer | 典型特征 |
|---|---|
| `unit` | 数据加载/Repository 返回/UseCase 分支/本地持久化回滚等业务流程状态 |
| `device` | Tab 切换动画/点击可达/Toast/键盘焦点/真实跳转/深色模式切换等 UI 表现 |
| `both` | 既有数据/状态断言又强依赖真实 UI 反馈 |

原则：纯 UI/交互 AC 必须落 device（业务 UT 禁依赖真实 UI 导航，`no_ui_dep_in_ut` BLOCKER）；业务流程分支必须落 unit；both 的 AC 必须分别填 `ut_focus`（业务）与 `device_focus`（UI），禁止混写。

`performance` 章节：`id`（NFR-N）/`metric`/`threshold`。`coverage_summary`：自动统计 P0/P1/P2 功能的 AC 覆盖率，确保每个 P0/P1 功能至少一条 AC 覆盖。

参考已有示例：`doc/features/home-page/acceptance.yaml`。
