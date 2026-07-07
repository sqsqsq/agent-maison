# UI-Spec（UI-DSL）— 结构化视觉中间产物

本文档约定 `doc/features/<feature>/spec/ui-spec.yaml` 的写法。它是 **spec → plan → coding** 贯穿的视觉 SSOT，与 [visual-handoff.md](./visual-handoff.md) 并存：**Handoff 声明真源路径，ui-spec 承载可机读的组件树 / token / 资产 / 逐字文案**。

## 何时必填

当 spec 独立 yaml 块中 `ui_change` 为 **`new_or_changed`** 或 **`copy_edits_only`** 时，须产出 `ui-spec.yaml`。

## 文件路径

```
doc/features/<feature>/spec/ui-spec.yaml
```

模板：`` `profile-skill-asset:spec/ui_spec_template` ``（hmos-app profile）。

JSON Schema：`framework/harness/schemas/ui-spec.schema.json`。

## 控件 Taxonomy（7 类）

| type | 含义 | 示例 |
|------|------|------|
| `input` | 输入控件 | TextInput、Search |
| `action_button` | 功能按钮 | 主按钮、勾选、协议链接 |
| `overlay_panel` | 浮层面板 | 半模态、Dialog、Sheet |
| `navigation_frame` | 导航与页框 | NavBar、TabBar、Page 容器 |
| `content_display` | 内容展示 | 标题、Banner、营销标签 |
| `list_selection` | 列表选择 | ListItem、Grid 选项 |
| `logic_condition` | 逻辑条件 | 开关、Radio、Checkbox 组 |

## 按 P0–P3 分层提取（控成本）

| 优先级 | 提取深度 |
|--------|----------|
| **P0** | 完整组件树 + bbox + 采色 + 逐字文案 + 资产清单 |
| **P1** | 同 P0（关键路径屏） |
| **P2/P3** | **轻量版**：`lightweight: true`，仅 token / 文案 / 资产 key；可省略细粒度树与 bbox |

## 根字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `schema_version` | ✅ | 固定 `"1.0"` |
| `verified` | 推荐 | `verified` / `human_confirmed` / `unverified`（见 DSL gate） |
| `verified_method` | 条件 | `vl_multimodal` / `human_gate` / `none` |
| `screens[]` | ✅ | 每屏一条 |
| `tokens` | ✅ | 全局 + 品牌变体 token 表 |
| `assets[]` | ✅ | logo / 图标 / 插图清单 |
| `global_elements[]` | 推荐(T5) | 全局元素归属声明，启用 OCR 越界门禁 |

### `global_elements[]`（T5 · 治"全局元素泄漏到子页"）

当某元素**只应出现在部分屏**（典型：底部「首页/我的」Tab 仅属首页/我的两个 sheet，**不应**出现在卡包/添加卡片等子页），声明其归属，device-testing 阶段会用 OCR 确定性检测越界（非属主屏的指定 band 内出现该元素文本 → `pixel_1to1` BLOCKER）。判据靠**声明式归属**，不靠 root 类型猜（子页 root 常与首页同为 `navigation_frame@0`，猜不出来）。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 元素 id，如 `bottom_tab` |
| `texts` | ✅ | 文本锚点数组（OCR 模糊匹配），**全部**命中于 band 才算出现，如 `['首页','我的']` |
| `owner_screen_ids` | ✅ | 仅这些屏可渲染该元素；其它屏出现=越界 |
| `band` | ⬜ | 纵向检测区 `{start, end?}` 归一化，默认底部 `{start: 0.85}`；可设顶部标题区等 |

```yaml
global_elements:
  - id: bottom_tab
    texts: ['首页', '我的']
    owner_screen_ids: ['home_no_card', 'home_with_card', 'mine']
    # band 省略 → 默认底部 [0.85, 1]
```

### `screens[]`

| 字段 | 说明 |
|------|------|
| `id` | 屏标识，如 `home`、`card_select_modal` |
| `priority` | P0–P3，对齐功能清单 |
| `ref_id` | 对应 Visual Handoff `authoritative_refs[].id` |
| `must_have_elements` | 屏级必备元素 id 列表（`search_bar` / `promo_badge` / `letter_index` 等）；coding 背板 C3 presence 校验 |
| `root` | 组件树根节点（P0/P1 必填；P2/P3 轻量可省略） |
| `lightweight` | `true` 表示 P2/P3 轻量版 |

组件节点字段：`type`、`layout`（column/row/full_width 等）、`order`、`text`（**逐字**，禁止泛化）、`style_ref`、`asset_ref`、`semantic_role`（`success` / `brand_primary` / `danger` / `promo` / `neutral`）、`color_ref`（须被对应组件源码 `$r('app.color.*')` 引用）、`icon`（`{ kind: brand_logo|system_symbol|illustration, ref }`）、`badge`、`bbox`（归一化 `[x,y,w,h]`，**原图侧 ground truth**）、`fidelity_note`（受控近似的显式承认）、`children[]`。

**结构声明（P0-D·round6 命门，门禁 `ui_spec_structure_lint` pixel_1to1 P0 屏强制）**：
- **副标题**：list_row 的副标题（如"银行卡/交通卡/门禁卡等"）必须建模在**主节点**上：`subtitle: <逐字文本>` +
  `subtitle_position: trailing|below`（trailing=与主标题同行右置，below=题下）——**禁止**把副标题拆成独立平铺
  content_display 节点（round6 实证：不声明位置 coding 惯用题下排错，右置副标题全军覆没）。
- **分组容器**：原图中同一张卡片/白底容器内的多行（如添加卡片页 5 行卡种），须建**分组容器节点**
  （带 `bg_color`/圆角语义的父节点 + `children`）或逐行声明同一 `layout_group`——禁止 ≥3 行 list_selection
  直接平铺在 root 下（coding 会全做独卡，边距/宽度对不上）。
- **浮动容器**：底部悬浮胶囊 tab 等 global_elements，其容器节点必须声明 `bg_color`（否则 coding 易搭成裸文字行）。
- **完整性外部对照（`capture_completeness_external`）**：门禁会用参考原图 OCR 全文当**真分母**逐行比对——
  原图上任何 ≥2 字的文本（含金额如 ¥119.40）没进 ref-elements/ui-spec 就 BLOCKER；分区扫描时**逐字抄全**，
  漏了要么补建模、要么 defer+真人签，删分母删不掉（分母是原图）。

**结构声明的验真分工（P1-4③·c9e2a7f4，诚实边界——写给所有下游阶段）**：结构声明落进 spec 后，
"实现对不对"由四层分工兜、各有明确边界，**不存在全自动验真**：
1. **coding 台账**（门禁 `structure_declaration_ledger`）：每条声明逐条登记实现归属——只消灭
   "被静默无视"，自报不验真；
2. **device 确定性信号**（P1-C `visual_diff_text_placement`）：**仅文本类**结构可确定性验真
   （trailing 副标题被排成题下=参考图同行文本对实测分居两行，OCR 相对信号缩放不变）；
3. **review 台账逐条人审**（P1-4②）：非文本类结构（tab 容器视觉/分组容器/独卡边距）的唯一
   静态人审关口——ArkUI 结构静态判定不可行（Row/Column/Builder 组合爆炸必产 FP，round6 两轮
   评审均判"不可判"）；
4. **用户终审**（T2 逐屏 confirmed_by）：最终防线。
   round7 候选（不在当前批冒进）：OmniParser 结构判定、容器 bbox 区域采色——绝对位置类度量
   已被真机证伪，任何新确定性抓手须先过实测校准。

**bbox 坐标语义（P0-A·round6 命门，门禁 `ui_spec_bbox_semantic` 系统性拦截）**：顺序**严格 [横向x, 纵向y, 宽w, 高h]**，绝非 [y,x,h,w]。具体数字 few-shot——竖屏左上角标题「钱包」≈ `[0.04, 0.02, 0.30, 0.05]`（x 小、y 小、**w 明显大于 h**）；页面中部横向 hero 插画 ≈ `[0.08, 0.15, 0.84, 0.20]`；底部 tab 行 ≈ `[0.10, 0.93, 0.80, 0.05]`。**自检口诀：横排多字文本恒 w>h**——若你写出的文本节点 w<h，就是把 y/x 或 h/w 写反了（round6 事故：全文档转置 → 素材全裁成竖切废条+文字排到页首）。`tokens[].source_bbox` / `assets[].source_bbox` 同一语义。

**round5 P0-A/P0-B 素材声明约定（pixel_1to1 承重，务必遵守）**：
- **图标分型（P0-B/P0-E·命门，round6 收窄）**：分型按**品牌识别度**而非"有没有颜色"（旧规则"彩色即 brand_logo+裁图"把 23 个标准图标全推向裁剪，bbox 一错全军覆没）：
  - **必须 `brand_logo`/`illustration` + crop 原子裁图（allowlist 硬边界，绝不可 system_symbol 替代）**：有品牌识别度的图标（Huawei Card / 云闪付 / 银行 logo / app 宫格图标）、营销图、卡片堆插画、空态插画。裁图须过 `ui_spec_bbox_semantic`（坐标语义）与 `asset_crop_validation`（产物验真）两道门禁。
  - **首选 `kind: system_symbol` + `ref: sys.symbol.<name>` + `color_ref` 着色**：标准语义图标——铃铛/加号/返回/扫码/设置/箭头、底部 tab 首页·我的、银行卡/交通卡/门禁卡/车钥匙/证件等卡种线性图标。**即使参考图中它们有色**也优先系统符号：原图本就是单色调线性图标，着色矢量的近似度高于 JPG 裁图，且没有裁错风险。此为受控近似，须在节点记 `fidelity_note`（如"原图橙色线性银行卡图标，以 sys.symbol + brand.bank_orange 着色近似"）。
  - 常用语义映射建议（仅提示不 gate；选对语义靠 review 视觉维度 + device 回环兜——交通卡该 bus 不该 map）：银行卡→`creditcard`、交通卡→`bus`、门禁卡→`house`/`lock`、车钥匙→`car`/`key`、证件→`person_2/idcard 类`、首页→`house_fill`、我的→`person_fill`、消息→`bell`、添加→`plus`、扫码→`qrcode/scan 类`、返回→`chevron_left`。
  - **门禁 `visual_parity_icon_substitution` 保持原判**：声明 `brand_logo|illustration` 却用 sys.symbol 静默替代 → pixel_1to1 BLOCKER（round4"☎ 冒充"防线）；声明 `system_symbol` 的元素本就不触发。**底部 tab 等全局元素的图标同样须声明**。漏声明=漏报（可接受），不会误伤未声明的语义单色 glyph。
- **素材原子化（P0-A·承重）**：`assets` 里 `acquisition: crop` 的素材图**只能是原子插画/单图标**（仅图形），**绝不能把"整段界面"裁成一张背景大图**——若素材图内烤入了本 ui-spec 声明的**文本节点**（≥2 个，如卡包区大图烤入"卡包/集中管理/添加管理卡片"、promo 大图烤入"数字金融生活新方式/首页/我的"、空态图烤入"暂无非本机卡片"），门禁 `visual_parity_asset_baked_text` 判 BLOCKER（pixel_1to1）。标题/副标题/按钮/空态文案/底部 tab 一律**真实组件**渲染，大图只做叶子插画。营销/装饰插画确需含字（如 promo 样机气泡"东方财富 Lite"）→ 该文本**不要**登记为 ui-spec text 节点；仍被判则给该 asset 设 `baked_text_defer: true` + `baked_text_defer_by: <真人标识>` 放行。

**G3 捕获保真字段**（pixel_1to1 下务必逐项捕获，否则 coding 易默认错误样式/布局）：

| 字段 | 取值 | 治什么 |
|------|------|--------|
| `variant` | `filled` / `tonal` / `outlined` / `ghost` / `text` | 按钮"实心蓝 vs 浅灰药丸/幽灵按钮"错绑 |
| `layout_group` | 字符串 id | 同一 id 的元素在**同一行/容器**内（同行分组） |
| `align` | `start` / `center` / `end` / `space_between` / `stretch` | 左对齐 vs 居中、靠右 |
| `width_ratio` | 0–1 | "全宽按钮 vs 右侧药丸"（如 0.4≈占 40% 宽） |
| `bg_color` | token 名 | 区域/容器底色（卡包区灰底 vs 实现蓝底） |

## 捕获完整性：`ref-elements.yaml`（v2.4+）

与 ui-spec 并列产出 **`doc/features/<feature>/spec/ref-elements.yaml`**：参考图侧**独立枚举**（分母不得取自 ui-spec 自身）。

```yaml
schema_version: "1.0"
elements:
  - element_id: search_bar
    zone: top_nav
    type: search_field
    disposition: implement   # implement | defer
  - element_id: nfc_entry
    disposition: defer       # defer 须登记 spec.md fidelity_deferrals 且 human_signed
```

- `pixel_1to1` 下 `disposition: defer` **必须**在 spec Visual Handoff 块有 `fidelity_deferrals` + `human_signed: true`
- `disposition: implement` 须被 ui-spec 节点 id 或 `must_have_elements` 覆盖

## 素材清单：`asset-manifest.yaml`（v2.4+）

`fidelity_target: pixel_1to1` 联动 `asset_acquisition_mode: user_dir` 时须产出，向用户索要素材；framework **不** AI 生成缺失 logo/插画。

> **静态门禁边界**：bbox 供 F 阶段渲染 diff 的几何 IoU 与人工核对；**ArkUI 运行时几何不可静态 IoU**，静态侧只用 `type`/`order`/`layout` 做结构顺序匹配（见 check-visual-parity / 静态保真分）。

### `tokens`

```yaml
tokens:
  brand.cmb:
    kind: color
    value: "#C7000B"
    source_bbox: [0.02, 0.12, 0.18, 0.04]
    sampled: true
```

- **半确定性采色（M2+）**：`source_bbox` 由模型看图给出，**色值 `value` 由脚本区域中位数/众数采样**（过滤近白/近黑）；文档如实写「区域模型给、采样脚本定」。
- 品牌色示例：招商红 `brand.cmb`、工商红 `brand.icbc` 等**每品牌独立 token**，禁止全局蓝替代。

### `assets[]`

```yaml
assets:
  - key: bank_logo_cmb
    acquisition: crop
    source_ref: home
    source_bbox: [0.04, 0.08, 0.12, 0.10]
    resolved_path: doc/features/bank-card/spec/assets/bank_logo_cmb.png
    human_crop_confirmed: true
    crop_confirmed_by: user_requirement
```

| acquisition | 含义 |
|-------------|------|
| `crop` | 按 `source_bbox` 从原图裁出（宽松框 + auto trim；关键资产须 `human_crop_confirmed`；**G4b headless** 下还须 `crop_confirmed_by` 为真人非自动化身份或 `user_requirement`——表示用户在需求中自然语言授权“可从原图/截图裁剪资源”，堵 agent 自报，对齐 deferral `signed_by`） |
| `svg_grab` | 抓取品牌矢量 |
| `repo_ref` | 复用仓内已有资源 |

缺资产时 **必须** `placeholder: true` + `rationale`，禁止静默替换。

## DSL↔原图校验 gate

ui-spec 生成后、进 plan 前：

1. **人工 gate**：逐屏 `[x]` 确认（类比术语映射表），设 `verified: human_confirmed` + `verified_method: human_gate`。
2. **多模态 gate**（M3，条件具备）：VL 核对后设 `verified: verified` + `verified_method: vl_multimodal`。
3. **无 VL + 无人工**：只能 `verified: unverified` → 连带降级 C/D/K（见下表）。

| 场景 | ui-spec 状态 | 视觉链行为 |
|------|-------------|------------|
| 有 VL | `verified` | 全链生效 |
| 无 VL、有人工 | `human_confirmed` | A/C/D/K 生效；E/F 视设备/多模态 |
| 无 VL、无人工 | `unverified` | C 尽力而为；**D 只报结构不报保真**；K 标基线未校验 |

## 提取模型 vs 编码模型解耦（J）

- **提取（看图）**：强 VL / Composer / 人工校验。
- **编码（写代码）**：内网弱模型**只消费** ui-spec 文本（树 + token + 资产 key + 文案），无需自己看图。
- **反模式**：用看不到图的弱模型跑 Step 2 提取 → garbage in。

## 推荐模型档位（K2）

| 步骤 | 推荐 |
|------|------|
| spec Step 2 提取 ui-spec | 强 VL（Composer 2.5 等） |
| coding Read 原图 | 强 VL；弱模型读 ui-spec 文本即可 |
| verify-coding 多模态对照 | 强 VL verifier |

跨模型基准：用银行卡案例按静态保真分写入 `trace.json` / `gap-notes.md` 回灌。

## 激励示例（银行卡添卡）

```yaml
schema_version: "1.0"
verified: human_confirmed
verified_method: human_gate
screens:
  - id: home
    priority: P0
    ref_id: screen_1_home
    root:
      type: navigation_frame
      layout: column
      order: 0
      children:
        - type: content_display
          order: 0
          text: "支持 100 家银行"
          style_ref: text.promo
        - type: list_selection
          order: 1
          layout: row
          text: "招商银行"
          asset_ref: bank_logo_cmb
          style_ref: brand.cmb
  - id: card_select_modal
    priority: P0
    ref_id: screen_3_modal
    root:
      type: overlay_panel
      layout: column
      order: 0
      children:
        - type: list_selection
          order: 0
          layout: full_width
          text: "储蓄卡"
        - type: list_selection
          order: 1
          layout: full_width
          text: "信用卡"
tokens:
  brand.cmb:
    kind: color
    value: "#C7000B"
    sampled: true
  brand.icbc:
    kind: color
    value: "#C7000B"
    sampled: true
assets:
  - key: bank_logo_cmb
    acquisition: crop
    source_ref: home
    resolved_path: doc/features/bank-card/spec/assets/bank_logo_cmb.png
    human_crop_confirmed: true
  - key: bank_logo_icbc
    acquisition: crop
    source_ref: home
    resolved_path: doc/features/bank-card/spec/assets/bank_logo_icbc.png
    human_crop_confirmed: true
```

## 与 Visual Handoff 打通

- `screens[].ref_id` 须能对应 `visual_handoff.authoritative_refs[].id`。
- 资产 `resolved_path` 宜落在 `doc/features/<feature>/spec/assets/` 下。

## 脚本守门

- spec：`ui_spec_structure`（结构完整，**非**对图保真）
- plan：`visual_parity_coverage`（ui-spec ↔ contracts 映射）
- coding：`visual_parity`（确定性「在不在」核对，**必要不充分**）

配置旋钮（opt-in）：`framework.config.json` → `spec.ui_spec_enforcement`、`coding.visual_parity_enforcement`（默认 `warn`/`reachable`，非 `strict`）。
