---
name: 视觉保真假PASS根治与截图态对齐
version: 2.4.0
overview: >
  以 SimulatedWalletForHmos/homepage 真实失败案例为靶，根治「门禁假 PASS + headless 自签放行 + 截图态结构/颜色失真」三层病。
  北极星：仅凭截图也要把结构+颜色对齐到「一眼是同一个页面」（A 环近 1:1，硬指标），美术资产缺口诚实拦截而非静默占位/通用图标冒充品牌 logo。
  自下而上六刀：G0 门禁完整性（schema 错误不得掩盖真 BLOCKER，根因）→ G1 headless 闭环诚实（pending 不可 auto-pass、自签不算人签）→ G2 1:1 意图捕获（别把"完全参考"降成 semantic_layout）→ G3 捕获保真（按钮变体/区域底色/主色采样/复杂区拆解，A 环主战场）→ G4 资产缺口诚实化（B 环不静默不山寨）→ G5 高保真供给通道（可选增强，screenshot-only 不依赖）。
  另设 G4b：保护「从截图裁素材/采色」路径，并让 goal 模式经 halt-confirm 主动携带该特性（普通模式既有、goal 从休眠转可用），与 G1 自签收紧解耦、不被误伤。
  回归基线：把 homepage 归档原样喂回加固后框架必须判 BLOCKER 而非 PASS。framework-only，不 bump 版本。
todos:
  - id: g0-gate-integrity
    content: >
      G0 门禁完整性（最高 ROI / 根因）：visual-diff-check 的 schema/结构校验失败**不得早退出**掩盖实质门禁。
      病灶证据（已核验行号）：homepage testing 因 screens[5] overlay 截图缺失触发 schema FAIL，[visual-diff-check.ts:392-402] **早退出**（severity=MAJOR/FAIL，且失败时不返回 report），走不到 :472-495「ui_change=new_or_changed + P0 全 pending → BLOCKER」与 :445 撞-hash WARN；而 report-generator 裁定「verdict=FAIL ⟺ blockers>0」（:457 + merged-report 行为印证），MAJOR/FAIL 放行 → testing PASS。
      改造（含 Cursor P2/P3 纠偏）：
      (1) **重构 validateVisualDiffJson 返回 best-effort 部分 report**（合法屏照进、非法屏标 finding），使缺一张图时仍能继续算 P0-pending/缺屏/撞-hash/score-floor——这是真重构，非「重排严重度」那么轻；
      (2) ui_change=new_or_changed 下 P0 视觉关键失败在 **check 层**定成 BLOCKER；
      (3) **不动全局 resolveVerdictFromChecks**（report-generator，跨阶段共用、爆炸半径大；已核实仅 BLOCKER 挂阶段）——靠 check 层 BLOCKER 达成挂阶段，全局裁定语义保持不变。
      触点：profiles/hmos-app/harness/visual-diff-check.ts:392-402 + 472-495 校验重构/严重度；**不碰 report-generator.ts resolveVerdictFromChecks**。
    status: completed
  - id: g1-headless-honesty
    content: >
      G1 headless 闭环诚实：headless goal-mode 下 P0 视觉屏仍 verdict=pending（VL 未闭环）→ HALT 求人填 verdict 或 BLOCKER，不得 PASS；
      `signed_by: goal-mode-auto` / auto `verified: human_confirmed` **不满足人类签字判据**——回到前序「结构化加固」本意（headless 无真人批准即 BLOCKER）。
      **与 crop 闸门解耦**：`human_crop_confirmed` 不套用本条「自签即 BLOCKER」，改走 G4b 的 halt-confirm（见 g4b-crop-color-goal），避免把「从截图裁素材」在 goal 模式焊死。
      病灶证据：spec.md fidelity_deferrals 全 signed_by=goal-mode-auto；ui-spec verified=human_confirmed 亦 auto；visual-diff.json 5 屏全 pending 仍 COMPLETED。
      触点：定位 goal-mode 自动产 spec/defer/verified 签名处 + fidelity-shared 人签判据 + 前序 deferrals gate；**开工前核实自签字串来源行号**（harness/scripts/goal-runner.ts 及 spec 生成链路）。
    status: completed
  - id: g2-fidelity-intent
    content: >
      G2 1:1 意图捕获（激活全链 ratchet 的总开关）：spec 生成识别强 1:1 信号（完全参考/像素级/严格按图/1比1）→ 置 fidelity_target=pixel_1to1；
      识别不到也不静默选最弱档（headless 留 must-review，交互态问人）。
      病灶证据：原始需求 6 次「页面布局完全参考 X.jpg」，headless auto-spec 仍置 semantic_layout → ratchet 全程不升级。
      触点：skills/feature/spec/SKILL.md + spec 生成 prompt + visual-handoff 意图解析（parseVisualHandoffYamlRoot / fidelity-shared）。
    status: completed
  - id: g3-capture-fidelity
    content: >
      G3 捕获保真（A 环，screenshot-only 主战场；结构+颜色+**布局关系**一致的核心）：
      (e) **布局关系捕获（最大欠账，Cursor P1）**：ui-spec 当前是拍平 children[]+order，不携带「谁与谁同行/左右对齐/占宽几何」——正是「添加管理卡片 右侧药丸→全宽实心」「文案左对齐→居中」「丢卡包标题」这类错位的根因，按钮变体/底色都修不掉它。扩 layout_group / align / width_ratio / same_row 字段 + 分区扫描模板强制标注同行分组与对齐；static-fidelity/coding 校验布局分组。**诚实：非像素级**（精确间距/比例归 G5）。
      (a) ui-spec 扩**按钮变体** filled/ghost/text/tonal，根治「brand_primary 实心蓝 vs 浅灰药丸」错绑（ui-spec.yaml:34/52），coding/static-fidelity 校验变体匹配；
      (b) ui-spec/must_have 扩**区域背景色**（卡包区灰底 vs 实现蓝底），加颜色校验；
      (c) **主色采样而非编造**：接 asset-acquisition.ts 既有采色，**排在 (e) 区域 bbox 之后**（采色须有可靠区域框，否则采错区/退整屏均值——Cursor P4），按区采真实主色填 token，禁止凭空 #2563EB；
      (d) **复杂区强制拆解**：宫格 N 图标 / 轮播 N 项不得压成 1 节点（service_grid/promo_swiper），分区扫描模板逐项，capture-completeness 分母按真实子项数。
      触点：harness/scripts/utils/ui-spec-shared.ts 扩字段（含 layout_group/align/width_ratio）+ profiles/hmos-app/harness/static-fidelity-score.ts / capture-completeness-check.ts + spec 分区扫描模板 + asset-acquisition.ts 采色接线。
    status: completed
  - id: g4-asset-honesty
    content: >
      G4 资产缺口诚实化（B 环，screenshot-only 物理不可达 → 不静默/不山寨）：
      pixel_1to1 下 asset_acquisition_mode 抬 user_dir + **强制 asset-manifest** 列明插画/品牌 logo/轮播大图；无真实素材 → 阻塞决策浮现 + report 醒目占位清单。
      **硬规则**：占位必须标「非 1:1 占位」；**禁止用通用线框图标冒充品牌 logo**（homepage 把 Huawei Card/云闪付/加油站做成通用蓝图标，比纯占位更误导）。
      病灶证据：asset_acquisition_mode=approximate、两资产全 placeholder:true、无 asset-manifest.yaml。
      触点：asset-manifest gate + static-fidelity 占位计分（前序已有骨架，收紧 severity + 加「品牌资产不得通用图标替身」校验）。
    status: completed
  - id: g4b-crop-color-goal
    content: >
      G4b 保护「从截图裁素材/采色」路径，并让 **goal 模式主动携带**该特性（用户补充诉求）。**裁图与采色分开对待（Cursor 二轮 #1/#3，二者休眠根因不同）**：
      现状：crop（asset-acquisition.ts:69-108，**有** human_crop_confirmed 人类闸门，headless 无法满足→休眠；homepage assets 全 repo_ref+placeholder 被 :70 跳过）；sampleColorFromBbox（:110-126，**无**人类闸门，休眠纯因 token 缺 source_bbox——homepage tokens 无 bbox）。
      改造：
      ▶ **裁图 crop（有人类闸门）· 已实现为门禁**：(a) 与 G1 解耦——human_crop_confirmed 不走「自签即 BLOCKER」，改为**门禁 asset_crop_confirm_required**（未确认即 ratchet：pixel_1to1→BLOCKER，否则 WARN）。**机制澄清（Cursor 二轮 P1.2）**：所谓 halt-confirm = **复用既有 BLOCKER/halt + §9 保守默认流（与 deferrals 完全同模式，goal-runner 无任何 fidelity/deferral 专属机制，故无新 goal-runner 代码）**——交互态 agent stop-and-ask 求人确认/微调 bbox → 人置 human_crop_confirmed 后重跑即确定性裁剪；headless §9 保守默认=不自动确认→BLOCKER。**残留已闭**：headless 下 human_crop_confirmed 的自报风险——已加 `crop_confirmed_by` 字段（type + schema + JSON SSOT）+ headless 校验 `isCropHumanConfirmed`（无非自动化真人署名即视为自报→门禁），对齐 G1 deferral 的 `requireExplicitSigner`。
      (b) **休眠→BLOCKER 须条件化（Cursor #2）**：触发谓词 = `pixel_1to1` ∨ 显式 `crop/auto_crop/user_dir` 意图；**否则**（semantic_layout 默认、用户没要裁图）占位是合法 B 环，**不拦、不 BLOCKER**。
      ▶ **采色 color（无人类闸门，不需 halt-confirm/不防 G1，Cursor #3）**：(c) 只需把 G3(e) 产出的区域 bbox 写进 token.source_bbox 即按区采真实主色——挂在 G3(e) 上，G1 对它无风险。
      ▶ **前置通道**：(d) 用户在需求入口直接给 asset bbox / 素材目录（user_dir/asset_pack）→ goal 模式免 mid-run halt 直接裁/采；auto_crop 意图在 goal 模式不再静默落 approximate（接 G2/G4）。
      触点：profiles/hmos-app/harness/asset-acquisition.ts（crop 确认门禁 + 裁/采色逻辑）+ **复用既有 BLOCKER/halt + §9 流（无新 goal-runner 代码）** + skills/feature/spec/SKILL.md「goal crop 触发与确认」+ visual-handoff/ui-spec 文档。
    status: completed
  - id: g5-hifi-optional
    content: >
      G5 高保真供给通道（**可选增强，主路径不依赖**）：用户提供 Figma/高保真源时复用已落地的「在线高保真对照」——结构化派生喂 ref-elements + 导出真实素材，把 B 环也拉到 1:1。
      明确标注 optional：screenshot-only 路径下本刀不触发、不作为达标前提。
      触点：复用 fidelity-lock / structured-ref-elements / fetch_fidelity 契约，文档说明「截图态够用，高保真为加分项」。
    status: completed
  - id: x-capture-bug
    content: >
      横切 采集 bug 修复（比初稿更糟，Cursor P5）：
      (1) 撞 hash 真相是 **Tab 根本没切过去**——mine_tab 截的还是 home（同 d3bea384…），VL 从头到尾没见过「我的」页，④验证不是「没闭」而是「对着错图在闭」；修 Tab 切换实切 + 切后 hash 必变校验。
      (2) overlay 屏 ref_id=non_local_modal__overlay__0 与 ui-spec screen_non_local_sheet **对不上**（采集自造 id）= 第二个 schema 错；要求采集产出 screen_id/ref_id **必须联结回 ui-spec**，否则 G0 修完早退出，此噪声仍以新形态触发。
      (3) overlay 截图缺失本身（Sheet 采集）。缺屏/撞 hash/id 不联结 严重度归 G0（升 BLOCKER）。
      触点：profiles/hmos-app/harness/visual-diff-capture.ts 采集流程（Tab 实切 / Sheet 采集 / id 联结）+ device-testing SKILL Step。
    status: completed
  - id: exit-tests-docs
    content: >
      出口：用 homepage 真实归档造**回归夹具**——缺 overlay + 5 屏 pending + 两屏撞 hash + semantic_layout-but-1:1-intent → **必须 BLOCKER**（现状 PASS，可证伪）。
      A 环新字段/门禁补 harness 单测，注册 harness/tests/run-unit.ts，`cd harness && npm test` 全 PASS（BLOCKER）。
      g4b：goal 模式 crop halt-confirm 流程补单测（确认→裁剪落地；**headless 无审批且 pixel_1to1/显式 crop 意图→BLOCKER，semantic_layout 无 crop 意图→占位合法不拦**；前置 bbox/素材目录→免 halt 直裁；采色仅凭 G3(e) bbox 落地）。A/B/C 诚实天花板写入 spec/coding/device-testing SKILL；不 bump 版本、不新建发布说明、不改 simulatedWallet 业务码。
    status: completed
isProject: false
---

# 视觉保真 · 假PASS根治与截图态结构色彩对齐（framework-only，窗口 2.4.0，不 bump 版本）

> 版本绑定 `version: 2.4.0`（与 `package.json.version` 一致）。改动均属发布内容（`harness/` `profiles/` `skills/` `specs/`），完成后 `cd harness && npm test` 必须全 PASS（AGENTS.md BLOCKER）。
> 靶子：`SimulatedWalletForHmos/doc/features/homepage` 真实失败 run（20260626T025006Z，testing PASS 但 UI 与参考图差天共地）。

## 一、北极星与验收门

**仅凭截图**，五屏的**结构（布局/层级/区块） + 颜色（主色/区域底色/按钮变体）**与参考图一致到「一眼是同一个页面」；**美术资产缺口诚实暴露为阻塞决策**，不再出现「纯蓝方块 vs 灰底插画、通用线框图标冒充品牌 logo、testing 全 PASS」。

- **硬指标（A 环）**：结构区块齐 + 颜色对 + **布局关系对（同行/对齐/占宽）** + 一眼同页；**诚实非像素级**——精确间距/比例的像素级 1:1 归 G5（可选）。这正对齐你的「结构颜色一致、不能差别太大」，而非「像素级」。
- **诚实边界（B 环）**：美术资产（插画/品牌 logo/轮播大图）screenshot-only 物理不可达 → 拦截/占位，不静默、不山寨。
- **可证伪回归**：homepage 归档原样喂回加固后框架 → **判 BLOCKER**（现状 PASS）。

## 二、命门复盘（每刀钉在证据上）

1. **门禁假 PASS（根因）**：[testing merged-report](../../../SimulatedWalletForHmos/doc/features/homepage/goal-runs/20260626T025006Z/phases/testing/harness/merged-report.md) = FAIL 1 / BLOCKER 0 / 裁定 PASS。唯一 FAIL 是 `screens[5]` overlay 截图缺失的 **schema 错误**，触发 [visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts) **早退出**，掩盖了 :472-495「P0 全 pending→BLOCKER（ui_change=new_or_changed）」与 :445 撞-hash WARN；且 schema FAIL 非 BLOCKER，阶段「无 BLOCKER 即 PASS」。
2. **headless 自签放行**：`fidelity_deferrals` 全 `signed_by: goal-mode-auto`，ui-spec `verified: human_confirmed` 亦 auto；[visual-diff.json](../../../SimulatedWalletForHmos/doc/features/homepage/device-testing/device-screenshots/visual-diff.json) 5 屏 verdict 全 `pending` 仍 COMPLETED。
3. **1:1 意图被降级**：原始需求 6 次「完全参考 X.jpg」，spec 仍 `fidelity_target: semantic_layout` → ratchet 全程不升级。
4. **截图态捕获失真**：按钮变体错绑（`card_pack_cta`/`+` 标 `brand_primary` 实心，设计是浅灰药丸/圆形灰底）、宫格 3 图标压成 1 节点、轮播整块压成 1 节点、区域底色未捕获、主色编了通用蓝 `#2563EB`。
5. **采集 bug**：overlay 截图缺失；home_no_card 与 mine_tab 共用 `d3bea384…`（截了同一屏）。

## 三、五环现状量化（本次 run）

| 环 | 分 | 短板 |
|---|---|---|
| ①捕获 | ~0.5 | 抓了大块文字但按钮变体编码错、复杂区压扁、区域底色缺、插画仅 placeholder |
| ②转译 | ~0.6 | 忠实实现了「被编码错的蓝」，并自作主张做成纯蓝方块、丢「卡包」标题 |
| ③资产 | ~0.1 | approximate + 全 placeholder + 无 asset-manifest（最大短板） |
| ④验证 | ~0.15 | 5 屏全 pending、overlay 缺图、两屏撞 hash，闭环没闭 |
| ⑤治理 | ~0.15 | semantic_layout + 全自签人类章，闸门尽失 |

## 四、切法（自下而上，前置决定后置）

> 详见 frontmatter todos 的 G0–G5 + 横切；以下为顺序与意图补充。
>
> **诚实分层（Cursor P6）**：G0–G2 是「止血 + 不再骗你」——让烂 UI 不再静默 PASS，**一个像素都不改善**；真正把像素拉近的是 **G3（含 (e) 布局捕获）+ coding 转译**，G5 为想要像素级者的可选正道。故「如何不被骗」重心在 G0，「如何更像」重心在 G3+布局。G3 仍重度依赖 VL 枚举（最不可靠环），故 A 环承诺止于「一眼同页」而非像素级。

- **G0 门禁完整性** — schema 错误只能追加 finding，不得掩盖 P0-pending/撞-hash/缺屏/score-floor 实质门禁；ui_change=new_or_changed 下视觉关键失败一律 BLOCKER。没有 G0，下面一切改进仍被假 PASS 吞掉。
- **G1 headless 闭环诚实** — pending 不可 auto-pass；`goal-mode-auto` 自签不算人签（但 crop 闸门 `human_crop_confirmed` 解耦，走 G4b halt-confirm，不被焊死）。
- **G2 1:1 意图捕获** — 「完全参考」→ pixel_1to1，激活全链 ratchet 的总开关。
- **G3 捕获保真（A 环主战场）** — 按钮变体 / 区域底色 / 主色采样 / 复杂区拆解。**这是「结构颜色一致」硬指标的主体。**
- **G4 资产缺口诚实化（B 环）** — 强制 asset-manifest + 占位诚实标注 + 禁止通用图标冒充品牌 logo。
- **G4b 截图裁素材/采色 · goal 模式携带** — 裁图(有人类闸门)经 halt-confirm 或前置 bbox/素材目录触发，**休眠→BLOCKER 仅在 `pixel_1to1` ∨ 显式 crop 意图时**（semantic_layout 无 crop 意图→占位合法不拦）；采色(无闸门)只需 G3(e) 区域 bbox、不防 G1。这让「无高保真时用原始截图搞定资源」在 goal 模式从休眠转可用。
- **G5 高保真供给（可选）** — 有 Figma/高保真源时把 B 环也拉到 1:1；screenshot-only 不依赖。
- **横切采集修复** — overlay/Tab 采集 bug，严重度归 G0。

## 五、A/B/C 诚实天花板（写入文档）

- **A 结构/颜色/布局关系/文案/按钮变体**：framework 主战场，screenshot-only 可做到「一眼同页、不差别太大」（本 plan 硬指标）；**精确像素级（间距/比例）非承诺**，要像素级须 G5 结构化几何（可选）。
- **B 美术资产**：screenshot-only **做不到 1:1**，只能诚实拦截/占位；要 1:1 须 G5 或用户素材目录。
- **C 动效/交互**：静态截图不含，不纳入「参考图复刻」承诺。

## 六、出口

- **回归夹具**：以 homepage 归档构造样例（缺 overlay + 5 屏 pending + 两屏撞 hash + semantic_layout 但需求含 1:1 信号）→ 加固后判 **BLOCKER**。
- A 环新字段/门禁补 harness 单测与 fixture，注册 [run-unit.ts](../../harness/tests/run-unit.ts)；`cd harness && npm test` 全 PASS（BLOCKER）。
- A/B/C 边界与「截图态够用、高保真为加分项」写入 spec/coding/device-testing SKILL。

## 七、明确不做

- 不 AI 生成/山寨缺失美术资产；不把通用图标当品牌 logo。
- 不把高保真打通设为达标必选（G5 可选）。
- 不在 maison 内置 headless 浏览器/渲染器。
- 不改 simulatedWallet 业务代码；不 bump 版本、不新建发布说明（framework-only）。
