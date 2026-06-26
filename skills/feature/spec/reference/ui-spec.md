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

### `screens[]`

| 字段 | 说明 |
|------|------|
| `id` | 屏标识，如 `home`、`card_select_modal` |
| `priority` | P0–P3，对齐功能清单 |
| `ref_id` | 对应 Visual Handoff `authoritative_refs[].id` |
| `must_have_elements` | 屏级必备元素 id 列表（`search_bar` / `promo_badge` / `letter_index` 等）；coding 背板 C3 presence 校验 |
| `root` | 组件树根节点（P0/P1 必填；P2/P3 轻量可省略） |
| `lightweight` | `true` 表示 P2/P3 轻量版 |

组件节点字段：`type`、`layout`（column/row/full_width 等）、`order`、`text`（**逐字**，禁止泛化）、`style_ref`、`asset_ref`、`semantic_role`（`success` / `brand_primary` / `danger` / `promo` / `neutral`）、`color_ref`（须被对应组件源码 `$r('app.color.*')` 引用）、`icon`（`{ kind: brand_logo|system_symbol|illustration, ref }`）、`badge`、`bbox`（归一化 `[x,y,w,h]`，**原图侧 ground truth**）、`children[]`。

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
```

| acquisition | 含义 |
|-------------|------|
| `crop` | 按 `source_bbox` 从原图裁出（宽松框 + auto trim；关键资产须 `human_crop_confirmed`；**G4b headless** 下还须 `crop_confirmed_by` 为真人非自动化身份——堵 agent 自报，对齐 deferral `signed_by`） |
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
