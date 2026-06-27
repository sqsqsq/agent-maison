---
name: 宿主homepage视觉保真round2 · 渲染缺陷枚举门禁 / 边缘哨兵(采集层) / 渲染忠实度校验 / asset真渲染
version: 2.4.0
overview: >
  round1（plan 43de34da，已 completed）回灌后宿主 homepage 显著变好（顶栏三按钮、卡包插图、金融轮播、消息条箭头到位）。但「原始需求 vs round1 开发效果(= 宿主 device-screenshots/shot-*.png，逐屏一致)」复核仍有 6 处肉眼必现偏离，而 visual-diff.json **6 屏全 verdict=pass(fidelity 0.88–0.93)**——门禁放过了所有可见缺陷。
  根因两层（经第二轮 review 对宿主 ui-spec.yaml 逐字核验后改写）：(I) 验收侧——device visual-diff 保真仲裁＝单一全局自评分 + 直方图客观背板(score_floor)，直方图对「裁切/重叠/形态」无判别力(坏图 score_floor 仍 0.94–1.0)，哨兵方向(fidelity−floor≥0.35)永不触发，三类缺陷全盲区；(II) 下游忠实度侧——**spec 其实高保真**：ui-spec 已记 variant:tonal / width_ratio:0.35 / align / color_ref / bbox / asset_ref / icon.kind / must_have，**形态没在 spec 丢**；真正失真是 coding 无视这些已声明约束(tonal→全宽实心 brand 蓝、asset_ref→只渲染文字、Swiper 裁切/叠帧)，且**无任何门禁校验「渲染是否忠实于 spec 已声明约束」**(width_ratio 至今无人读)。
  方向已敲定（2026-06-27，三问 + 第二轮 review 修正）：D1 两层并行全做；D2 客观背板＝结构化缺陷枚举为主 + 轻量边缘密度 tile 哨兵兜底(落采集层、提为与 v1 并列第一优先级)；D3 素材＝复用既有 icon.kind + #6「asset 真渲染」校验，尊重 crop 授权、不推 symbol/矢量；D7 渲染忠实度/通用 variant 强制范围 P0 屏先行；D8 根因改写 + #4 形态澄清(浅灰 tonal 内联、非药丸)；D9 a2 并入 v3 + 保留一条通用低优先 variant 声明增强；D10 s1 只做真渲染校验。
  三大主题：V) 验收侧让三类缺陷可门禁拦截(v1 缺陷枚举 schema+门禁+rubric / v2 采集层边缘哨兵 / v3 渲染忠实于 spec 已声明几何+填充)；A) 生成侧防患(a1 ArkUI 防裁切叠帧 WARN / a2 通用 variant 声明增强，解耦低优先)；S) asset 真渲染校验 + icon.kind 复用(s1)。
  约束：framework-only，不 bump 版本(2.4.0 未发布窗口)，不改宿主业务码；新门禁按「goal 与普通模式能力持续拉齐」两模式统一覆盖；出口用 round1 真实坏图做回归夹具——6 缺陷须被新门禁抓住、干净参考须仍 PASS。
todos:
  - id: v1-defect-enumeration-gate
    content: >
      主题V · device visual-diff 结构化缺陷枚举（核心：把「裁切/重叠/形态/缺图」从全局自评分拆出来，pass 须枚举为空）。【D2 主路径】
      病灶：[visual-diff-check.ts](profiles/hmos-app/harness/visual-diff-check.ts) 的 VisualDiffScreenEntry 只有全局 fidelity_score + reverse_missing（参考有/实现无）；缺「实现有但渲染错」的正向缺陷维度。agent VL 自评 0.9/pass，#1 宫格图标被裁、#2 更多服务叠两帧、#3 卡包插图压标题、#4 按钮全宽实心化全被全局分洗掉。
      改造：(1) VisualDiffScreenEntry 新增 defects?: Array<{ class: 'clipping'|'overlap'|'shape_mismatch'|'missing_render'|'other'; element?: string; bbox?: number[]; severity: 'blocker'|'major'|'minor'; note: string }>；validateVisualDiffJson 校验枚举（class/severity 合法、bbox 4 数）。(2) 门禁：verdict=pass 的屏若含 severity∈{blocker,major} 的 defect → 与 lowScorePass 同级（pixel_1to1 经 fidelityRatchetFailOrWarn 升 FAIL，否则 WARN），写 must_fix；defects 与 reverse_missing 对称、同进 finalizeVisualDiffHits。**向后兼容（D11）：pixel_1to1 下 finalized verdict 的 defects===undefined → ratchet WARN 逼逐屏枚举（可为 []），与既有 screensMissingReverseEnum 对齐；非 pixel_1to1 旧 consumer json 无 defects 字段不受影响。**(3) device-testing VL rubric（root SKILL.md visual-diff 步骤 / profile-addendum）：逐屏按类枚举缺陷，给 homepage 6 例作 in-skill 示例（宫格图标上半被裁=clipping、Swiper 同屏两帧=overlap、插图压标题=overlap、按钮 width_ratio 声明 0.35 却全宽实心=shape_mismatch、tab 声明 asset_ref 却只渲染文字=missing_render），显式声明「pass 须 defects 为空且无 reverse_missing」。
      边界：枚举仍 agent 填，靠 v2 采集层哨兵兜底诚实性。两模式统一（同 gate + 同 skill）。
      触点：profiles/hmos-app/harness/visual-diff-check.ts、device-testing skill（root SKILL.md + profile-addendum visual-diff rubric）、harness/tests/unit。
      落地：visual-diff-check.ts 加 VisualDiffDefect 类型/校验/门禁（blocker|major defect→pixel_1to1 FAIL、D11 defects===undefined→WARN）+ details defects 计数；device-testing SKILL.md Step4 rubric 接 defects[] 枚举（4 类 + bbox/severity + pass 须空 + 边缘哨兵说明）。单测 visual-defect-enum 13 例全过；npm test 35 suites 全绿。
    status: completed
  - id: v2-edge-density-tile-sentinel
    content: >
      主题V · 轻量边缘密度 tile 哨兵（**采集层**客观兜底，防 agent 自报 defects:[] 注水）。【D2 兜底，与 v1 并列第一优先级】
      病灶：现客观背板 score_floor＝直方图+tile-min，由 [visual-diff-capture.ts](profiles/hmos-app/harness/visual-diff-capture.ts) 的 resolveScoreFloor([:146](profiles/hmos-app/harness/visual-diff-capture.ts:146)) 算并写 json，[visual-diff-check.ts] 只读。直方图对裁切/重叠/形态无感(坏图 0.94–1.0)。需一条「结构密度」客观维度。
      改造（F3 修正——必须落采集层）：(1) [image-jimp-worker.cjs](profiles/hmos-app/harness/image-jimp-worker.cjs) 新增 edge-tile 算子（灰度梯度幅值→N×M 粗 tile 边缘密度，默认 6×8）；[image-toolkit.ts](profiles/hmos-app/harness/image-toolkit.ts) 新增 computeEdgeDensityTileDivergence(refPath, shotPath)。(2) **在 visual-diff-capture.ts resolveScoreFloor 同处计算**（ref 图索引、jimp 可用性此层已具备），随 score_floor 一起写 json 新字段 edge_tile_divergence + over_threshold_tiles[]（tile 坐标）。(3) [visual-diff-check.ts] 只**读** json 该字段，做「超阈 tile 是否被某 defect.bbox / reverse_missing 覆盖」的诚实性比对，未覆盖 → WARN 逼 VL 复核该 tile 区域。**坐标对账**：over_threshold_tiles 为 tile 网格行列坐标、defect.bbox 为归一化 0–1，须明确定义 bbox→覆盖 tile 集合的换算。
      对齐（实测 reconcile，见 D12）：两图均整页捕获但比例差大(稿 0.349 vs 机 0.623)，合成同内容 FP 探针证 **stretch(3 FP) 显著优于 letterbox(8 FP)**（letterbox 因不同比例占不同子区反而错位），故采**拉伸整页对齐** + check 层「最小未覆盖 tile 数=5」吸收状态栏偏移残留 FP；哨兵只发 WARN、永不单独 FAIL、粗 tile+高阈值。
      出口（F4）：夹具用**真实 ref/shot**（非自比）验假阳性率达标方算完成。
      触点：profiles/hmos-app/harness/image-jimp-worker.cjs、image-toolkit.ts、**visual-diff-capture.ts（采集层落点）**、visual-diff-check.ts、harness/tests/unit。
      落地（实测修正 + FP 校准）：① 能量均值差实测 inert（坏图 max 0.05），经用户选 A 改为**结构化 z-MAD + 拉伸整页对齐**（180×360，z-归一像素 MAD、亮度不变）。② **FP 校准（reviewer 出口，已补）**：合成同内容探针证 stretch(3 FP)≪letterbox(8 FP)、纯比例差拉伸后 0 FP，残留 ~3 FP 来自状态栏偏移；真实 5 对——modal 0/card 3（忠实静默）、add 6(已核为真缺陷)/mine 8/home 10（命中）。FP 地板≈3、真缺陷≥6，间隙清晰。③ 据此加 **check 层最小未覆盖 tile 数=5**（落在 3 与 6 间吸收 FP 地板）；z-MAD 阈值 0.55 经 toolkit 传入 worker（m3 集中）。**⚠️ 地板=5 为暂定**：mine/add 混了真缺陷+合法差异+FP、非干净样本，唯一干净 FP 是合成探针(3)，真忠实真机渲染样本尚不存在；待 v3/a1 逼宿主修好 home 后，拿**修好的 home** 重跑 edge-tile，掉到 <5 静默方终验「忠实渲染不误报」并定稿地板。④ reconcile：worker 注释去掉假 F4 合规、改实测说明（见 D12）。⑤ edge 字段由采集层 resolveEdgeSentinel 写 json，check 经 EDGE_TILE 网格换算与 defect.bbox 求交、过最小数门槛。单测：schema + 坐标对账(含覆盖夹具) + **FP-safe 合成端到端**，15 例全过；npm test 1151+35 全绿。
    status: completed
  - id: v3-render-faithfulness
    content: >
      主题V · 渲染忠实于 spec 已声明几何/填充（覆盖 #4，**取代**原「变体多元素定位」方案）。【D8 修正后核心抓手之一】
      病灶（F1 修正）：#4 真相＝spec 已声明 `variant: tonal` + `width_ratio: 0.35` + `align: end`(浅灰 tonal 内联约占 35%)，但渲染成**全宽实心 brand 蓝**。原 v3 想放宽 collectVariantParityIssues 的 buttonCount，但 tonal∉NON_FILL_VARIANTS={ghost,text,outlined} → 该按钮在 buttonCount 前就 continue 跳过；且 hasSolidButtonBackground 对 tonal 浅底也返 true，无法区分「对的浅 tonal / 错的实心 brand」。**width_ratio 至今无任何门禁读取**——这是最干净的新抓手。
      改造：(1) 新增「声明约束渲染忠实度」校验——主信号 **width_ratio/align**（声明内联 0.35 却渲染全宽 → 命中；从源码区分 `.width('100%')`/`layoutWeight`/缺省撑满 易误漏，故低置信）；辅信号 **填充色 token 比对**（**coding 期无截图，非图像采样**：解析源码 `backgroundColor` 的 `$r` token/hex → `hexToLab`/`deltaE2000` 比 brand.primary，声明 tonal 浅调却解析到高饱和 brand 蓝 → 命中）。(2) 校验集纳入 tonal/filled（不止 NON_FILL）；多 Button struct 用按钮 copy/string key 定位对应 Button。(3) 定位不到 / token 不可解析 → 保守跳过。**定位：v3 为低置信静态早警，#4 主牙在 v1 shape_mismatch rubric + v2 采集层哨兵；v3 命中加分、不命中不背锅，以 device visual-diff 为准**。范围 P0 屏先行(D7)。
      触点：profiles/hmos-app/harness/visual-parity-backstop.ts、（采色复用）image-toolkit.ts、harness/tests/unit。
    status: pending
  - id: a1-arkui-anti-clip-rules
    content: >
      主题A · ArkUI 防裁切/防叠帧静态规则（生成侧防患 #1/#2/#3）。
      病灶：宫格(ServiceGridSwiper)图标被裁上半、更多服务(PromoSwiper)同屏叠两帧、卡包插图压标题——ArkUI 常见布局陷阱：Swiper 固定高度不足裁切 Image / Swiper 未设 displayCount 致多项可见或未吸附 / Image 覆盖 Text 未 clip。
      改造：[arkui-static-rules.ts](profiles/hmos-app/harness/arkui-static-rules.ts)（现仅 bindsheet/push/sheet-subscriber 三条 nav 规则）追加低置信 WARN（以 device visual-diff 为准）：(1) Swiper/Grid 含 Image 子项且容器固定高度偏小(< 子项声明尺寸+label) → 裁切风险；(2) 单 banner 语义 Swiper 未显式 .displayCount(1) 或含多项可见配置 → 叠帧风险；(3) Stack/绝对定位中 Image 覆盖 Text 区且父未 .clip(true) → 重叠风险。阈值/匹配数据驱动便于调。
      触点：profiles/hmos-app/harness/arkui-static-rules.ts、harness/tests/unit。
    status: pending
  - id: a2-generic-spec-variant
    content: >
      主题A · 通用 spec 质量增强：pixel_1to1 下 action_button 须声明 variant（**与本案解耦、低优先**）。【D9】
      说明（F2 修正）：homepage 的 spec **已**忠实声明 variant/width_ratio/asset_ref，「强制声明」对本案冗余、**不是 homepage 6 缺陷的修复路径**（#4 修复走 v3 渲染忠实度）。本 todo 仅为防「别的 feature 的 agent 偷懒不填 variant」留通用门禁：pixel_1to1、P0 屏先行(D7) 的 action_button 缺 variant → WARN/FAIL(ratchet)。
      枚举对齐（F2）：严格用 [UiSpecButtonVariant](harness/scripts/utils/ui-spec-shared.ts:30)=filled|tonal|outlined|ghost|text，**不引入 pill/fill**，避免类型冲突。
      触点：harness/scripts/utils/ui-spec-shared.ts（schema 校验）或对应 spec-phase check、profiles/hmos-app/skills/{spec,coding}/profile-addendum.md、harness/tests/unit。
    status: pending
  - id: s1-asset-render-check
    content: >
      主题S · asset 真渲染校验 + 复用 icon.kind（覆盖 #6 tab 图标漏渲染；**不推 symbol/矢量**）。【D10】
      病灶（F5/F6 修正）：#6 真缺口＝bottom_tab_home/mine 已在 must_have 且带 `asset_ref: tab_icon_*`，但只渲染了文字；[collectMustHavePresenceIssues](profiles/hmos-app/harness/visual-parity-backstop.ts) 只查 id presence(容器在就过)，**不验 asset_ref 的图是否真渲染**。
      改造：(1) 新增独立校验——节点声明了 asset_ref → 映射 struct 是否真 $r('media.<key>') 引用该 media（区别于 presence）；声明却未引用 → 反向缺失/WARN(命中 #6)。(2) 素材分型**复用既有** [UiSpecIconRef.kind](harness/scripts/utils/ui-spec-shared.ts:35)=brand_logo|system_symbol|illustration 做覆盖统计，**不另起 bbox 分类**；tab 等缺 kind 者可提示补 system_symbol(仅提示)。(3) **尊重 crop 授权**：crop_confirmed_by:user_requirement 的裁切**不报「建议改 symbol/矢量」噪声**；#5 小图标糊为「裁 JPEG 小图」的已确认取舍，本轮不强推替换。
      触点：profiles/hmos-app/harness/{visual-parity-backstop,static-fidelity-score,source-ref-scan}.ts、harness/tests/unit。
    status: pending
  - id: specs-docs
    content: >
      登记与文档：新增/调整 check（defect 枚举门禁、edge_tile 哨兵、渲染忠实度、asset 真渲染、通用 variant、ArkUI 防裁切）在对应 *-rules.yaml 登记 check id + 严重度；更新 device-testing/spec/coding SKILL 与 verify prompt 说明缺陷枚举 rubric、edge 哨兵语义、渲染忠实度判别(width_ratio/tonal 采色)、asset 真渲染。
      openspec change：缺陷枚举 + edge_tile 字段使 visual-diff.json schema 与 pass 契约变化 → 建 openspec/changes/ 一条（defects[] + edge_tile_divergence schema 扩展 + MIGRATION：旧 json 无新字段的兼容、及 **pixel_1to1 下 defects===undefined→WARN 逼填的契约语义(D11)**）；渲染忠实度/asset/ArkUI 属既有门禁增强，rules.yaml + docs 即足。
      触点：specs/、profiles/hmos-app/**/rules.yaml、docs/、openspec/changes/、MIGRATION.md。
    status: pending
  - id: tests-acceptance
    content: >
      出口（BLOCKER）：用 round1 真实坏图做回归夹具（拷宿主 device-screenshots/shot-*.png 进 fixtures）——
      (v1) 含 severity=blocker/major defect 的 pass 屏 → 判不过(pixel_1to1 FAIL)；defects:[]+reverse_missing:[] 且分数达标 → PASS；非法 defect → schema FAIL；**pixel_1to1 下 defects===undefined（finalized）→ WARN 逼填（与 reverse_missing 对齐）、非 pixel_1to1 旧 json 不受影响（D11）**。
      (v2) **采集层** edge-tile 用**真实 ref/shot**：宫格裁切/更多服务叠帧区超阈 tile 命中且未登记 → WARN；干净区不命中；**defect.bbox 恰覆盖超阈 tile → 不再 WARN（验坐标换算）**；**假阳性率**达标（等比+letterbox 对齐）。
      (v3) spec 声明 width_ratio:0.35/tonal 但实现全宽实心 brand → 命中；内联浅 tonal → 不命中。
      (a2) pixel_1to1 action_button 缺 variant → WARN/FAIL；齐全 → PASS（通用，非 homepage）。
      (s1) asset_ref 声明却未 $r 引用(tab 只渲染文字) → 命中；user_requirement 已确认 crop → 不报 symbol 噪。
      (a1) Swiper 矮高度含 Image / 未 displayCount(1) → WARN；正确写法 → 不命中。
      各项补 harness 单测并注册 [run-unit.ts](harness/tests/run-unit.ts)，cd harness && npm test 全 PASS。不 bump 版本(package.json=2.4.0)、不改 SimulatedWallet 业务码。
      触点：harness/tests/、harness/tests/fixtures/。
    status: pending
isProject: false
---

# 宿主 homepage 视觉保真 round2 · 渲染缺陷枚举门禁 / 边缘哨兵(采集层) / 渲染忠实度校验 / asset 真渲染（framework-only，窗口 2.4.0，不 bump 版本）

> 版本绑定 `version: 2.4.0`（与 `package.json.version` 一致，未发布窗口，按既定惯例不 bump）。改动全部在**发布内容**（`profiles/` `harness/` `specs/` `docs/`），完成后 `cd harness && npm test` 必须全 PASS（AGENTS.md BLOCKER）。承接 round1（plan `43de34da`，已 completed）。**本 plan 经第二轮 review 对宿主 `ui-spec.yaml` 逐字核验后已修正根因与 v3/a2/v2/s1（见下「复盘修正」）。**

## 背景与目标

round1 回灌 testing 设备终态、HMOS 资源格式、防漂移门禁后，宿主 homepage（像素级保真需求）效果明显变好，但仍有差距。本 plan 以「原始需求 / round1 开发效果」对比数据为靶，定位「为什么还差」并把修复回灌 framework。

**证据来源**：`D:\1.code\对比结果\0-home-page\{0-原始需求, 1-开发效果, 2-第一轮优化后开发效果}` + 宿主 `doc/features/homepage`（其中 `device-testing/device-screenshots/shot-*.png` 与「第一轮优化后开发效果」逐屏一致，确认为真实设备渲染）+ 宿主 `spec/ui-spec.yaml`（保真约束 SSOT）。

## 问题诊断（首页无卡屏，6 处偏离 + 门禁全放过）

| # | 缺陷 | 现象 | 类别 | spec 是否已声明 |
|---|---|---|---|---|
| 1 | 宫格图标被裁/被压 | Huawei Card/信用卡还款/优惠加油 仅露底部碎片 | 裁切/溢出 | 是（icon.kind/bbox）|
| 2 | 更多服务轮播叠帧 | 同屏并排 2 个手机样机帧，文案穿插 | 重叠/重复渲染 | 是（promo_swiper_banner）|
| 3 | 卡包插图压标题 | 插图白底与「卡包」标题重叠重影 | 重叠 | 是（illustration/title bbox）|
| 4 | 「添加管理卡片」按钮 | 原图=浅灰 **tonal 内联**(width_ratio 0.35)；实现=整行**实心蓝**全宽 | 组件形态/版式 | **是**（variant:tonal+width_ratio:0.35+align:end）|
| 5 | 顶栏图标低清发虚 | watch/scan 糊（裁 JPEG 小图） | 素材质量 | 是（crop，user_requirement 已确认）|
| 6 | 底部 tab 缺图标 | 实现仅文字 | asset 漏渲染 | **是**（节点带 asset_ref:tab_icon_* 且在 must_have）|

**门禁为何全放过**：`visual-diff.json` 6 屏全 `verdict=pass`，fidelity 0.88–0.93。`score_floor`(直方图，采集层 `resolveScoreFloor` 算) 对裁切/重叠无感、坏图仍 0.94–1.0；哨兵要求 `fidelity−floor≥0.35`，现实 floor 比 fidelity 还高 → 永不触发。`reverse_missing` 无「实现有但渲染错」维度；`collectVariantParityIssues` 因 tonal∉NON_FILL 跳过 #4；`collectMustHavePresenceIssues` 只查 id presence、放过 #6 asset 漏渲染。

**两层根因（修正版）**：(I) 验收侧——单一全局自评分 + 直方图背板，缺局部缺陷枚举与布局敏感客观背板；(II) **下游忠实度侧——spec 高保真（形态/几何/资产全记），但 coding 无视已声明约束，且无门禁校验「渲染是否忠实于 spec 已声明约束」**（width_ratio 无人读、asset_ref 不验真渲染）。

## 复盘修正（2026-06-27，第二轮 review 逐字核验宿主 ui-spec.yaml 后）

原 plan 把根因归为「spec 阶段磨平形态/tab 图标」——**经核验为误判**。宿主 spec 实测高保真，6 缺陷的根因是「下游无视声明 + 无渲染忠实度门禁」。据此六处修正：

- **#4 形态澄清**：目标＝浅灰 **tonal 内联**（width_ratio 0.35、brand 蓝字），**非描边药丸**；spec `variant: tonal` 已正确，原 plan「药丸/幽灵」措辞有误。
- **v3 重定位**：从「放宽 buttonCount 多元素定位」改为「**渲染忠实于已声明 width_ratio/align 几何 + tonal 填充采色**」；tonal/filled 纳入校验集（原方案 tonal 被 NON_FILL 过滤、根本到不了）。
- **v2 落采集层**：edge-tile 须在 `visual-diff-capture.ts:resolveScoreFloor` 同层算并写 json，check 只读（原方案放 check 层，ref 图未必可达、jimp 未必可用、与既有架构割裂）。
- **a2 解耦降级**：homepage 已声明 variant，「强制声明」对本案冗余；保留为**通用低优先** spec 质量增强；枚举对齐 `UiSpecButtonVariant`（删 pill/fill）。
- **s1 转真渲染校验**：#6 真缺口是「asset_ref 是否真渲染」（非 must_have presence）；复用既有 `icon.kind`，**不另起分类**；**豁免 user_requirement 确认的 crop、不推 symbol/矢量**（#5 糊为已知取舍）。
- **F4 对齐（已 reconcile，见 D12）**：实测「整页稿 vs 整页设备图」用 **stretch(3 FP) 优于 letterbox(8 FP)**，故采拉伸 + 最小未覆盖 tile 数吸收残留 FP；letterbox 仅适用同比例/视口裁切。真实 ref/shot + 合成同内容探针 FP 已验。

## 改造点

详见 frontmatter todos。推进顺序：**V 主题先行且 v1/v2 并列第一优先级**（v1 缺陷枚举门禁 + v2 采集层边缘哨兵——把「假 PASS」堵死、检测力真正来自此二者；v3 渲染忠实度紧随）→ **A/S 主题并行防患**（a1 ArkUI、s1 asset 真渲染、a2 通用 variant 低优先）→ specs-docs + tests-acceptance 收口。

## 决策（已敲定 2026-06-27）

- **D1 · 优化重心 → 两层并行全做**（verify + authoring）。
- **D2 · 客观背板 → 结构化缺陷枚举为主 + 轻量边缘密度 tile 哨兵兜底**；哨兵**落采集层**、提为与 v1 并列第一优先级；只 WARN、粗 tile、高阈值、等比对齐。
- **D3 · 素材 → 复用 icon.kind + #6 asset 真渲染校验**；尊重 crop 授权、不推 symbol/矢量、#5 糊为已确认取舍。
- **D4 · 模式覆盖 → 普通 + goal 全模式统一**（落实「goal 与普通模式能力持续拉齐」）。
- **D5 · 版本 → 保持 2.4.0**，不 bump。
- **D6 · openspec → defect 枚举 + edge_tile 字段契约必做一条 change**（schema 扩展 + MIGRATION）。
- **D7 · 渲染忠实度/通用 variant 强制范围 → P0 屏先行**（可后续放宽到全量 pixel_1to1）。依据：#4 按钮、#6 tab 均在 P0 屏；P0 屏内 P1 子块(宫格/广告)由屏级 v1/v2/a1 兜；与框架 ratchet 渐进收紧一致。
- **D8 · 根因改写 + #4 形态澄清**（第二轮 review）：spec 未丢真，失真在「coding 无视声明 + 无渲染忠实度门禁」；#4＝浅灰 tonal 内联(width_ratio 0.35)，非药丸。
- **D9 · a2 → 并入 v3 渲染忠实度 + 保留一条通用低优先 variant 声明增强**（非 homepage 修复路径）；变体枚举对齐 `UiSpecButtonVariant`=filled|tonal|outlined|ghost|text。
- **D10 · s1 → 只做 #6 asset 真渲染校验 + 复用/补全 icon.kind**；不推 symbol/矢量、豁免 `crop_confirmed_by: user_requirement`。
- **D11 · defects 向后兼容契约（D6 change 敲定）**：pixel_1to1 下 finalized verdict 的 defects===undefined → ratchet WARN 逼逐屏枚举（可为 []），与既有 reverse_missing(screensMissingReverseEnum) 对齐；非 pixel_1to1 旧 consumer json 无 defects 不受影响；openspec/MIGRATION 写清此语义（否则省略 defects 字段即可绕过「pass 须枚举为空」）。
- **D12 · v2 对齐策略 reconcile（实测定，修订 plan 初版 F4）**：F4 初版「绝不拉伸/用 letterbox」对「整页设计稿 vs 整页设备图（比例 0.349 vs 0.623、同内容）」是错误先验——合成同内容 FP 探针实测 **stretch 3 FP ≪ letterbox 8 FP**（letterbox 因不同比例占不同子区反而错位；纯比例差拉伸后 0 FP，残留 ~3 FP 来自状态栏偏移）。故采拉伸整页对齐 + check 层「最小未覆盖 tile 数=5」吸收残留 FP（FP 地板≈3、真缺陷≥6）；worker 注释不再宣称 F4 合规、改记实测依据。F4 的 letterbox 指引仅适用同比例/视口裁切场景。

## 出口

round1 真实坏图回归夹具（6 缺陷须被新门禁抓住：v1 枚举判不过 / v2 采集层哨兵命中且假阳性达标 / v3 width_ratio+tonal 命中 / a1 ArkUI WARN / s1 asset 漏渲染命中；a2 通用项另造夹具）+ 干净参考须仍 PASS + `cd harness && npm test` 全 PASS（见 tests-acceptance）；framework-only，不 bump 版本，不改宿主业务码。

## 不在本 plan 范围

- 重 CV 路径（全屏 SSIM / 特征点几何精对齐 / OCR 文本框检测）——D2 走「枚举为主+轻量边缘哨兵」，不做。
- **#5 小图标裁切糊**：源于「裁 JPEG 小图」，且 `crop_confirmed_by: user_requirement` 已确认 → 本轮作为已知取舍，s1 仅提示、不报噪、不强推 symbol/矢量替换。
- 宿主业务码修改（ServiceGridSwiper/PromoSwiper/CardGuideSection 实际修复）属宿主工程操作，由 framework 门禁逼出后在宿主侧改。
- round1 已落地项（设备终态、HMOS 资源格式、防漂移门禁）、版本 bump、宿主侧 commit 拆分。
