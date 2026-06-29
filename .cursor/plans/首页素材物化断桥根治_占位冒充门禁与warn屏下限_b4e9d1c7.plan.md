---
name: 首页素材物化断桥根治 · 占位冒充门禁(B) / resource_integrity媒体绕过(F) / 采集新鲜度(E) / 物化桥(A) / visual_diff warn屏下限(C) / pixel_1to1兜底复核(D)
version: 2.4.0
overview: >
  现象（用户回灌反馈，2026-06-28）：最新 framework 进宿主 SimulatedWalletForHmos 后，homepage UI 对比上一轮**没变好、部分更差**——卡包插图变纯红块、宫格图标变纯色方块、更多服务广告变纯蓝块压到底 tab。用户直觉："没提供高保真时，从原图截素材效果反而更好"。
  根因（已对 ground-truth 逐项实测，含外部 review 5 条逐条复核）：**裁素材这条路本身是对的，断在最后一公里——裁出的真图没被搬进 App，且 resource_integrity/采集/visual_diff 多处放行坏态**。
    1. 裁图成功且质量好：[doc/.../spec/assets/](../../../SimulatedWalletForHmos/doc/features/homepage/spec/assets) 下 7 张真图都在（card_guide_illustration 948×324/55KB 四卡插图 / promo_banner_finance 988×519/345KB / card_stack_mock 825KB），逐张看过裁得准；ui-spec assets[] 全带 acquisition:crop + human_crop_confirmed:true + crop_confirmed_by:user_requirement，授权齐。
    2. 模块里却是 1×1 占位：宿主 02-Feature/WalletMain/src/main/resources/base/media/ 下同名 7 张**全是 70 字节**，文件头 IHDR 0x01×0x01 = 单像素 PNG；.width('100%') 一拉伸即整块纯色（与截图色块完全对应）。该目录 git 状态 `??`（untracked，coding agent 本次现造）。
    3. **两套占位 + contracts 指错路径 + resource_integrity 被绕过（review#2 实测确认）**：宿主**根目录**还有一份 `./media/*.png`（同样 7×70B），[contracts.yaml:382-394](../../../SimulatedWalletForHmos/doc/features/homepage/contracts.yaml) 的 `resource_keys[].path` 恰好指 `media/<key>.png`（根目录）。而 [coding-host-rules.ts:104-124](../../profiles/hmos-app/harness/coding-host-rules.ts:104) 注册 media key 用的就是 `existsSync(projectRoot + entry.path)`——根占位存在即注册 → `resource_integrity`（BLOCKER）"137 处 $r 全过"实为**验了 contracts 根路径、没验 ArkUI 真正读的模块路径**。ArkUI 运行时 `$r('app.media.<key>')` 解析的是**模块** resources/base/media，与 contracts path 两条道。
    4. **桥是断的**：[asset-acquisition.ts:122](../../profiles/hmos-app/harness/asset-acquisition.ts) 只把裁图写到 resolved_path（doc/ 下）；全 framework 无任何一步（harness 无 copyFile / skill 无指令）把它搬进模块 resources/base/media/。coding agent 为让 $r 编译过 + 过 resource_integrity，自造 1×1 占位（根 + 模块两份）—— 即 [coding/SKILL.md:174-175](../../skills/feature/coding/SKILL.md) 明令禁止的"占位静默替代"，但无门禁拦它。
    5. 静态/渲染门禁假信号：[static-fidelity-score.ts:156-177](../../profiles/hmos-app/harness/static-fidelity-score.ts) 资产覆盖只数"resolved_path(doc)存在 + 源码有 $r 引用"→ 报 100%，从不校验模块里那张是不是真图；[coding-visual-parity-check.ts:168-180](../../profiles/hmos-app/harness/coding-visual-parity-check.ts) collectAssetRenderIssues 恒 MAJOR/WARN（pixel_1to1 也不升）。
    6. **device visual_diff warn 无底洞**：[visual-diff-check.ts:30-33](../../profiles/hmos-app/harness/visual-diff-check.ts) PASS_MIN_FIDELITY=0.6 只管 verdict=pass 屏，注释明写"warn verdict 不设下限"——宿主 6 屏全 warn+fidelity 0.08~0.12+defects:[]，无任一门禁触发。
    7. **采集全失败却沿用旧证据仍 PASS（review#1 实测确认）**：最新 testing 跑（goal-runs/20260628T095851Z）`visual_diff_capture` = `screens=0`+`preserved=1`，6 屏全 `[Errno 13] Permission denied` 截图失败；因 overlay pending 条目使 [visual-diff-capture.ts:399](../../profiles/hmos-app/harness/visual-diff-capture.ts:399) 仍 `ok:true` 并保留旧 visual-diff.json，[check-testing.ts:2085](../../harness/scripts/check-testing.ts:2085) 在 `cap.ok` 即判 **PASS**（6 条失败只当 notes）。这也解释了"shot-home_nocard 内容是弹窗"——磁盘 shot 是陈图、从未刷新；`isStaleVisualDiffVerdict` 因截图没重写、hash 仍等旧 evaluated hash 而漏判。
  为什么"反而更差"：上一轮无正式 assets[]+$r('app.media') 接线，宫格用系统线性图标/文字（糙但可辨认）；这一轮保真改造把 7 个区域全接成 image 引用却一张没物化 → 7 处全色块。保真工作流"把更多区域转成了坏掉的图片引用"。
  方向（用户 2026-06-28 两轮拍板 + 外部 review 加固，全部决策见 §四）：物化机制＝**agent 搬 + 硬门禁强制**（harness 不碰宿主模块源码）；范围＝**A+B+C+D+E+F 全包**；B/E1/E2/F 并列第一优先级（都属"不许假证据/假资源过关"根因）。
  约束：framework-only；不改宿主业务码；不 bump 版本（2.4.0 未发布窗口）；新门禁按"goal 与普通模式能力持续拉齐"两模式统一覆盖；出口用本次宿主**真实坏态**（70B 双占位 / 6 屏 0.1-warn / 采集全 Permission-denied-preserved / 根 media 绕过 resource_integrity）做回归夹具——坏态须被新门禁抓住、真图/新鲜态须仍 PASS。
  诚实说明（逐条核实）：D（pixel_1to1 代码兜底）**已基本实现**于 [fidelity-governance-check.ts:99-117](../../profiles/hmos-app/harness/fidelity-governance-check.ts)，本次宿主 fidelity_target 本就为 pixel_1to1 未触发，D **不是回归根因**，降级为复核+补测。C 是**灾难地板非最终保真保证**（review#5）：物化后仍可能有布局/比例/底 tab/banner 裁切等残差，须靠既有 visual-diff defects 枚举 + 阈值逐步收紧，本 plan 不就 C 过度承诺"比上轮更好"。
todos:
  - id: B-placeholder-impersonation-gate
    content: >
      【P1 · 核心承重墙 · 硬门禁，使 A 非可选】被 $r('app.media.<key>') 引用的**模块实际** media 必须是真图，禁 1×1/退化占位冒充。【决策已锁】
      病灶：现 coding 侧 asset 校验止于"声明 asset_ref 却未 $r 引用"（[visual-parity-backstop.ts:535 collectAssetRenderIssues](../../profiles/hmos-app/harness/visual-parity-backstop.ts)，[assetRenderedInRefs:520](../../profiles/hmos-app/harness/visual-parity-backstop.ts)），引用了即算过；不查被引用的模块文件是否真图。static_fidelity_score 同病（查 resolved_path 而非模块实际 media）。
      改造：
        (1) [image-toolkit.ts](../../profiles/hmos-app/harness/image-toolkit.ts) 新增 readImageDimensions(absPath): {w,h,bytes}|null。**退化判定不依赖 jimp**（Q2/Q4 决策）：先读 PNG IHDR 头（字节 16-24 解 w/h）/ 文件字节数即可判退化；jimp 仅用于更丰富的面积/相似度核对。
        (2) visual-parity-backstop.ts 新增 collectPlaceholderAssetIssues(ctx, doc)：对每个 acquisition≠placeholder 且源码存在 $r('app.media.<key>') 引用的 key——**定位以"写 $r 的源码文件所属模块"为准**：<module>/src/main/resources/base/media/<key>.{png,jpg,svg,webp}（**绝不信** contracts.resource_keys.path / 根 media/，那是 F 要堵的绕过点）。**退化判据＝三信号取或（Q2 决策：任一命中即占位）**：① 尺寸 w≤2 || h≤2；② 字节 <256B；③ resolved_path 真图存在且模块图面积比 <5%。命中 → issue「<key> 模块 media 为退化占位(WxH/bytes)，未物化 resolved_path 真图」。
        (3) [coding-visual-parity-check.ts](../../profiles/hmos-app/harness/coding-visual-parity-check.ts) 接入为新 result id `visual_parity_asset_materialized`：pixel_1to1 → BLOCKER/FAIL；非 pixel_1to1 → MAJOR/WARN。**pixel_1to1 下若无法读取被引用 raster 尺寸（非法/读失败）→ 同样 ratchet 阻断，不 SKIP**（Q4 决策）。
        (4) review#4 收紧：collectAssetRenderIssues（asset_ref 声明却未在对应组件/feature 源码真实 $r 渲染）在 pixel_1to1 下从恒 WARN 升 BLOCKER，**除非**该元素显式 placeholder/defer 且 human_signed。与 (2) 互补：(2) 管"引用了但文件是占位"，(4) 管"声明了但没引用渲染"。
        (5) [static-fidelity-score.ts](../../profiles/hmos-app/harness/static-fidelity-score.ts) 资产覆盖口径修正：assetReferenced 命中后额外要求"模块实际 media 为真图"（复用 readImageDimensions）才计入分子，details 注"含真图校验"，消 100% 假信号。
      边界：svg/矢量与动态渲染豁免（无固定 raster 尺寸）；jimp 整体不可用时——非 pixel_1to1 可 SKIP 并显式标注，**pixel_1to1 下退化判定仍用无 jimp 路径执行、不 SKIP**。两模式统一。
      触点：image-toolkit.ts、visual-parity-backstop.ts、coding-visual-parity-check.ts、static-fidelity-score.ts、specs/phase-rules + profile overlay 注册新 check id、harness/tests/unit。
    status: completed
  - id: E-capture-freshness-and-identity-gate
    content: >
      【P1 · 采集新鲜度 + 屏身份（review#1，与 B/F 并列第一优先级 — Q5 决策）】堵"采集失败沿用旧证据仍 PASS"与"截到的不是目标屏"两类假证据。
      病灶（实测）：goal-runs/20260628T095851Z `visual_diff_capture` = screens=0+preserved=1，6 屏全 Permission denied；[visual-diff-capture.ts:399](../../profiles/hmos-app/harness/visual-diff-capture.ts:399) 因 overlay pending 条目仍 `ok:true` 并保留旧 json；[check-testing.ts:2085](../../harness/scripts/check-testing.ts:2085) 在 `cap.ok` 即 PASS（失败仅当 notes）。叠加 shot-home_nocard 实为弹窗陈图、`isStaleVisualDiffVerdict` 漏判（文件未重写 hash 不变）。
      改造：
        (E1 P0 采集失败阻断) captureVisualDiff 返回结构化 `p0CaptureFailures`（区分"P0 顶层屏截图失败"与"非顶层屏跳过 note"）；check-testing.ts:2085：new_or_changed 下若有 P0 屏截图失败、或 screensWritten=0 且靠 preserved 充数 → pixel_1to1 FAIL、否则 blocking WARN（不再 PASS-with-notes）。
        (E2 证据新鲜度) 采集尝试失败而沿用 preserved 旧 finalized verdict 时，标注 evidence_stale；pixel_1to1 P0 屏不得以 preserved 旧判定通过（与 E1 合流）。
        (E3 屏身份断言 — Q4 决策：先只上 VL，不做静态启发式) device-testing VL rubric：finalize 每屏须断言截图呈现的是目标屏（锚点＝must_have_elements/标题/导航态），不符 → verdict=fail+must_fix「captured wrong screen」。**静态启发式（base 屏命中 modal 锚点）本轮不做、留观察**。
      边界：E1/E2 为确定性门禁（承重）；E3 主力在 VL。先覆盖 P0 屏。两模式统一。
      触点：visual-diff-capture.ts、check-testing.ts、device-testing SKILL.md + profile-addendum、capture-completeness-check.ts、harness/tests/unit。
    status: completed
  - id: F-resource-integrity-media-bypass-and-contracts-path
    content: >
      【P1 · 堵 resource_integrity 媒体绕过 + 修 contracts 路径约定 + 清根 media（Q3 决策：1+2 都做）】
      病灶（实测）：[coding-host-rules.ts:104-124](../../profiles/hmos-app/harness/coding-host-rules.ts:104) 用 `existsSync(projectRoot + entry.path)` 从 contracts.resource_keys[].media[].path 注册 media key；宿主 path 指根 `media/<key>.png`，根占位存在即注册 → resource_integrity（BLOCKER）被骗过、`$r('app.media.*')` 误判"有对应资源"。这是与 B 并行的第二个假资源洞（B 管渲染真图、F 管 key 注册口径）。
      改造：
        (1) media key 注册改以**模块实际资源目录**为准：coding-host-rules.ts 注册 media 时解析 <module>/src/main/resources/base/media/<key>.<ext>（in_scope 模块递归），**不信** contracts entry.path 的根相对路径；保留对旧 contracts 的兼容读取但存在性以模块路径判定。
        (2) plan 阶段 contracts 生成约定修正：[plan/SKILL.md:469 resource_keys 章节](../../skills/feature/plan/SKILL.md:469) + [plan-rules.overlay.yaml:220](../../profiles/hmos-app/phase-rules-overlays/plan-rules.overlay.yaml:220) 明确 media 的 path 写**模块资源路径**（或不写 path、由 host-rule 按 key 解析模块），杜绝再生成根相对路径诱导根 media/ 占位。
        (3) 清根 media/：A 的 coding skill 改动里显式声明"media 只落模块 resources/base/media，禁在工程根建 media/"；宿主回灌时清掉误导性 ./media/（Z 执行）。
      边界：与 B 配对——B 验"模块图是真图"、F 验"key 注册看模块路径"，二者都不信 contracts 根路径。兼容既有正确 contracts（path 已指模块的）。两模式统一。
      触点：coding-host-rules.ts、skills/feature/plan/SKILL.md、profiles/hmos-app/phase-rules-overlays/plan-rules.overlay.yaml、skills/feature/coding/SKILL.md（与 A 合）、harness/tests/unit。
    status: completed
  - id: A-materialization-bridge-skill
    content: >
      【P2 · agent 搬 + skill 指令】把"将 resolved_path 真图物化进引用模块 resources/base/media/"写成 coding 阶段明确动作，并显式禁止 1×1/纯色占位冒充。
      病灶：[coding/SKILL.md:174-175](../../skills/feature/coding/SKILL.md) 只说"禁占位静默替代/资产缺失须显式 placeholder"；[profile-addendum.md:29-34](../../profiles/hmos-app/skills/coding/profile-addendum.md) 只说"assets[].key → $r('app.media.<key>')"。**无人告诉 agent 真图就在 resolved_path、要 copy 过去**——这是 agent 造占位的直接诱因。
      改造：
        (1) coding/SKILL.md Step 2.5a / Step 3 资产处理处新增明确步骤："对每个 assets[] 中 acquisition:crop 且非 placeholder 的 key：读 resolved_path（doc/.../spec/assets/<key>.<ext>），将该文件**复制**进引用它的模块 resources/base/media/<key>.<ext>（模块＝写 $r('app.media.<key>') 那个模块，**非工程根 media/**）；**禁止**生成 1×1/纯色/空 PNG 占位冒充；**禁止在工程根建 media/**——缺真图则按 placeholder:true 显式声明并停下求人，不得静默糊弄。"
        (2) profile-addendum.md ArkUI 视觉 parity 段补 HMOS 落地细则：media 物理路径 = <module>/src/main/resources/base/media/<key>.<ext>；提示 B/F 门禁会以此为准校验真图与 key 注册、占位即 FAIL；并提醒 contracts.resource_keys.path 不是渲染解析路径。
        (3) [spec/SKILL.md:183](../../skills/feature/spec/SKILL.md) 在裁图产出 resolved_path 处补一句"resolved_path 是 coding 阶段物化进模块资源的 SSOT 来源"，让上下游契约闭合。
      边界：纯 skill/文档改动，不碰 harness 执行体；与 B/F 门禁配对（失败信息须指向本步骤）。
      触点：skills/feature/coding/SKILL.md、profiles/hmos-app/skills/coding/profile-addendum.md、skills/feature/spec/SKILL.md。
    status: completed
  - id: C-visual-diff-finalized-fidelity-floor
    content: >
      【P2 · 堵 warn 无底洞 · 定位为最低地板非保真保证】device visual_diff 对 finalized(pass∪warn) 屏设保真下限 + 低分必须有缺陷依据，杜绝"全 warn 0.1 放行"。【阈值已锁：0.45/0.40】
      病灶：[visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts) lowScorePass 只筛 passScreens（[:581](../../profiles/hmos-app/harness/visual-diff-check.ts:581)）；warn 屏 fidelity/iou 无任何下限（[:30-33 注释](../../profiles/hmos-app/harness/visual-diff-check.ts:30)"warn 不设下限"）。宿主 6 屏全 warn+0.08~0.12+defects:[]+reverse_missing:[] → hits 为空 → visual_diff 判 PASS。
      改造：
        (1) 新增 FINALIZED_MIN_FIDELITY=0.45 / FINALIZED_MIN_IOU=0.40（warn 灾难地板，低于 PASS_MIN 0.6/0.5 — Q1 决策）。
        (2) 新 check `visual_diff_low_fidelity_floor`：finalized(verdict∈{pass,warn}) 屏 fidelity<0.45 或 iou<0.40 → **pixel_1to1: BLOCKER/FAIL；非 pixel_1to1: MAJOR/WARN**（Q1 决策）；进 finalizeVisualDiffHits（与既有 lowScorePass/defects 去重）。
        (3) 诚实性交叉校验：finalized 屏 fidelity<0.45 但 defects:[] 且 reverse_missing:[] = 低分无依据（自相矛盾/注水）→ 同级 ratchet，逼 VL 补缺陷或修分。
      定位（review#5）：C 只保证"拦住 0.1 这种离谱分"的最低下限，**不**保证修完比上轮更好；像素级质量靠既有 v1 defects 枚举 + 后续阈值逐步收紧。device-testing rubric 须同步说明 warn 也有地板、低分须枚举依据。
      边界：阈值取灾难级（不误伤 0.5 左右正常残差 warn）；两模式统一。
      触点：visual-diff-check.ts、device-testing skill rubric、harness/tests/unit + fixtures。
    status: completed
  - id: D-pixel1to1-backstop-audit
    content: >
      【P3 · 复核既有兜底，非重写】确认 pixel_1to1 意图代码级兜底覆盖到位 + 补测；如实记录其已存在。
      现状（逐条核实）：[fidelity-governance-check.ts:99-117](../../profiles/hmos-app/harness/fidelity-governance-check.ts) 已实现 G2：collectIntentScanText 扫 spec.md + ref 目录原始需求 md，detectPixel1to1Intent（[fidelity-shared.ts:140-149](../../harness/scripts/utils/fidelity-shared.ts) 含 /完全参考/ 等）命中但 fidelity_target≠pixel_1to1 → headless BLOCKER/FAIL、交互 WARN。本次宿主 fidelity_target 本就为 pixel_1to1，未触发。
      工作项（轻）：(1) 审计 collectIntentScanText 扫描面是否覆盖 authoritative_refs 同级"原始需求.md"/截图说明（本案 6× "完全参考 X.jpg" 在原始需求 md，确认被纳入）。(2) 漏扫则补；否则仅补/核单测（visual-fidelity.unit.test.ts 已有 detectPixel1to1Intent 用例）。(3) 报告中明确"D 已实现"，避免误当回归根因。
      边界：除非审计发现真实漏扫，否则不新增逻辑，只补测与文档。
      触点：fidelity-governance-check.ts（仅审计/必要时小补）、harness/tests/unit/visual-fidelity.unit.test.ts。
    status: completed
  - id: Z-regression-fixtures-and-host-replay
    content: >
      【出口验证 · 防复发】用本次宿主真实坏态做回归夹具 + 宿主回灌验证修复闭环。
      夹具（profiles/hmos-app/harness/tests/fixtures 下，仿 v2_3 既有结构）：
        (1) asset_placeholder_impersonation_fail：模块 media 为 1×1、resolved_path 为真图、且根 media/ 也有占位（验 B 以模块为准不被根占位骗）→ B 在 pixel_1to1 下 FAIL；真图态 → PASS。
        (2) resource_integrity_root_media_bypass_fail：contracts.resource_keys.path 指根 media/、根有占位但模块缺/占位 → F 在模块路径判定下 FAIL；模块真图 → PASS。
        (3) visual_diff_warn_low_fidelity_fail：6 屏全 warn+0.1+defects:[] → C 在 pixel_1to1 下 FAIL；warn+0.7 正常残差 → PASS。
        (4) capture_p0_failed_preserved_fail：P0 截图失败 + preserved 旧 json → E1 在 pixel_1to1 下 FAIL；正常采集 → PASS。
        (5) capture_wrong_screen_warn：base 屏 VL 身份断言不符 → E3 fail（VL rubric 例）。
      宿主回灌（按用户通知后再执行，遵守 maison plan 工作流）：
        (6) 让 coding 重跑物化（把 doc 7 张真裁图搬进 WalletMain 模块 media）→ 确认 B/F 转 PASS、模块 media 字节恢复 KB 级、清掉误导性根 ./media/。
        (7) 修采集 Permission denied 后重采 device visual_diff → 确认 fidelity 回升、C/E 不误伤；人眼对照原始需求 1.首页-无卡.jpg 确认插图/宫格/横幅恢复。
      验证：npm test 全绿（现 35 suites 基线）；新夹具坏态全被抓、真图/新鲜态仍 PASS。
      边界：framework 侧只加夹具与单测；宿主回灌是验证手段、不算 framework 交付物。
      触点：profiles/hmos-app/harness/tests/fixtures/**、harness/tests/run-unit.ts、宿主 homepage（仅回灌验证）。
    status: completed
---

# 首页素材物化断桥根治 — 详细 plan（定稿）

> 状态：**framework 侧已实施完成并全绿**（2026-06-29）。5 个开放问题已全部拍板（§四）。宿主回灌（Z·6/7）需设备 + coding 重跑，按用户触发执行。实施记录见 §六。

## 一、一句话根因

裁素材路径本身是对的、这轮也真的裁出了高质量图（doc/.../spec/assets/ 55KB–825KB 真图），但**没有一步把它搬进宿主模块 `resources/base/media/`**；coding agent 用 1×1 纯色占位（根 + 模块两份 70B）填了 `$r('app.media.*')`，而 resource_integrity（验根路径）/ static_fidelity / visual_diff(warn 屏) / 采集(失败沿用旧证据) 多处放行 → 真机渲染成色块、fidelity 0.08–0.12 却判 PASS。

## 二、外部 review 5 条 — 逐条核实结论

| # | review 意见 | ground-truth 核实 | 处置 |
|---|---|---|---|
| 1 | E 要扩为"采集证据新鲜度"门禁（Permission denied 沿用旧 json 仍 PASS） | **属实**：goal-runs/20260628T095851Z screens=0/preserved=1，6 屏全 Permission denied；check-testing.ts:2085 `cap.ok`→PASS | 采纳，E 升级承重门禁（E1/E2），Q5 提至 P1 |
| 2 | B 要防"根目录 media 占位绕过"，以模块实际 media 为准 | **属实**：根 ./media/ 7×70B + contracts.yaml:382-394 path 指根 media/ + coding-host-rules.ts:104 用 path existsSync 注册 | 采纳，B 以模块路径验真图；另立 F 堵 resource_integrity 注册口径 |
| 3 | jimp 不可用/读失败不能轻易 SKIP | 合理：1×1/0B/70B 可不靠 jimp 从 PNG 头判退化 | 采纳，B pixel_1to1 下不 SKIP、退化判定走无 jimp 路径 |
| 4 | asset 声明但未真实渲染仍偏软（恒 WARN） | **属实**：coding-visual-parity-check.ts:168-180 恒 MAJOR/WARN | 采纳，B(4) pixel_1to1 升 BLOCKER（除非 placeholder/defer+签字） |
| 5 | C 是灾难地板非最终保真保证 | 框架正确，无需改码 | 采纳，C 定位为最低下限，像素级靠 defects 枚举+阈值收紧，不过度承诺 |

## 三、修复总览（优先级已按 Q5 调整）

| 项 | 优先级 | 角色 | 落点 |
|---|---|---|---|
| **B** | P1 | 占位冒充硬门禁（模块真图） | visual-parity-backstop / coding-visual-parity-check / static-fidelity-score / image-toolkit |
| **E** | P1 | 采集失败/旧证据/屏身份 | visual-diff-capture / check-testing / device-testing skill |
| **F** | P1 | resource_integrity 媒体绕过 + contracts 路径 | coding-host-rules / plan SKILL+overlay / coding SKILL |
| **A** | P2 | agent 物化指令（行为约定） | coding+spec SKILL / profile-addendum |
| **C** | P2 | visual_diff warn 屏保真下限(0.45/0.40) | visual-diff-check |
| **D** | P3 | pixel_1to1 兜底复核（已实现） | fidelity-governance-check（仅审计/补测） |
| **Z** | 出口 | 回归夹具 + 宿主回灌 | tests/fixtures / 宿主 |

## 四、5 个开放问题 — 最终决策（用户 2026-06-28）

1. **C 阈值** → 0.45/0.40；pixel_1to1 才 FAIL，semantic_layout 下 WARN。
2. **B 退化判据** → 尺寸(w/h≤2) / 字节(<256B) / 面积比(<5%) **三信号取或**，任一命中即占位。
3. **根 media + contracts** → **1+2 都做**：B 无视它（已含）+ 新增 F（修 host-rule 注册口径 + plan contracts 路径约定 + 清根 media/）。
4. **E3 静态启发式** → 先只上 VL 屏身份断言，静态启发式本轮不做、留观察。
5. **E1/E2 优先级** → 提至与 B/F 并列 **P1**（同属"假证据/假资源放行"根因）。

## 五、承重逻辑（B + E + F 三者关系）

- **B** 保证"模块里那张被 $r 引用的图是真图"（渲染端真）。
- **F** 保证"resource_integrity 注册 media key 看模块路径，不被根占位骗"（编译/契约端真）。
- **E** 保证"视觉判定建立在新鲜、正确屏的截图上，不沿用旧/错图"（证据端真）。
- 三者合起来才是"不许假资源 + 假证据过关"的完整闭环；A 是让 agent 把真图搬到位的行为约定，C 是 warn 屏最低地板，D 是既有 pixel_1to1 兜底的复核。

## 六、实施记录（2026-06-29 · framework 侧全部完成）

测试：`npm test` 全绿 —— typecheck 通过 / 单测 **1197 passed**（较基线 +11：9 资产物化 + 2 warn 地板）/ fixtures **35 passed**。

| 项 | 改动文件 | 关键落地 |
|---|---|---|
| **B** | [image-toolkit.ts](../../profiles/hmos-app/harness/image-toolkit.ts)、[visual-parity-backstop.ts](../../profiles/hmos-app/harness/visual-parity-backstop.ts)、[coding-visual-parity-check.ts](../../profiles/hmos-app/harness/coding-visual-parity-check.ts)、[static-fidelity-score.ts](../../profiles/hmos-app/harness/static-fidelity-score.ts)、[coding-rules.overlay.yaml](../../profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml) | `readImageDimensions`(纯TS PNG/JPEG头)；`moduleMediaRealnessForKey`/`findModuleMediaFile`(三信号取或)；新 check `visual_parity_asset_materialized`(pixel_1to1 BLOCKER)；`collectAssetRenderIssues` 加 assetRole + pixel_1to1 升 BLOCKER；static 资产覆盖加真图校验 |
| **F** | [coding-host-rules.ts](../../profiles/hmos-app/harness/coding-host-rules.ts)、[plan/SKILL.md](../../skills/feature/plan/SKILL.md) | media key 注册改以模块 `resources/base/media` 实际文件为准（根/contracts 路径占位不采信，且只认指向模块内 media 的 contracts path）；plan 加 media path 约定 |
| **E** | [visual-diff-capture.ts](../../profiles/hmos-app/harness/visual-diff-capture.ts)、[check-testing.ts](../../harness/scripts/check-testing.ts)、[device-testing/SKILL.md](../../skills/feature/device-testing/SKILL.md) | capture 返回 `p0CaptureFailures`；check-testing：P0 截图失败/`screensWritten=0` 靠 preserved 充数 → pixel_1to1 FAIL（否则 WARN）；VL rubric 加屏身份断言(E3 仅 VL) |
| **A** | [coding/SKILL.md](../../skills/feature/coding/SKILL.md)、[coding profile-addendum.md](../../profiles/hmos-app/skills/coding/profile-addendum.md)、[spec/SKILL.md](../../skills/feature/spec/SKILL.md) | 资产物化步骤(复制 resolved_path 真图进模块 media、禁占位/禁根 media)；media 物理落地细则；resolved_path 为物化 SSOT |
| **C** | [visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts) | `FINALIZED_MIN_FIDELITY=0.45`/`IOU=0.40`：warn 屏低于地板 → pixel_1to1 FAIL；低分+defects空+reverse_missing空 诚实性 ratchet |
| **D** | （仅复核，无改码） | 经核实 [fidelity-governance-check.ts:99-117](../../profiles/hmos-app/harness/fidelity-governance-check.ts) 已实现，且 [visual-fidelity.unit.test.ts](../../harness/tests/unit/visual-fidelity.unit.test.ts) `homepage_combo_*` 已测精确场景 |
| **Z** | [asset-materialization.unit.test.ts](../../profiles/hmos-app/harness/tests/unit/asset-materialization.unit.test.ts)（新）、[visual-fidelity.unit.test.ts](../../harness/tests/unit/visual-fidelity.unit.test.ts) | 9 资产物化用例（含"仅工程根占位→not real"防绕过）+ 2 warn 地板用例；改用对症单测而非全项目 fixture |

**待办（需用户触发）**：Z·6/7 宿主回灌 —— ① coding 重跑把 doc 7 张真裁图物化进 WalletMain 模块 media、清根 `./media/`；② 修宿主截图采集 Permission denied 后重采 device visual_diff，人眼对照原始需求确认插图/宫格/横幅恢复。

### 六.1 外部 review 二轮加固（2026-06-29）

两条均经 ground-truth 核实成立并修复（单测 1200 passed / fixtures 35 passed）：
- **P1 跨模块同名 media 误放行**：原 B 全量扫 `contracts.modules`、任意模块同名 `<key>` 即算可用，违背"模块＝写 $r 的那个模块"决策。修复：新增 [source-ref-scan.ts](../../profiles/hmos-app/harness/source-ref-scan.ts) `scanResourceRefModules`（ref→引用模块 package_path），`findModuleMediaFile`/`moduleMediaRealnessForKey`/`collectPlaceholderAssetIssues` 与 static-fidelity 均加 `restrictPkgPaths`＝引用模块作用域。resource_integrity 维持"扫模块目录"（root-bypass 已堵；跨模块真图由 B per-module + 真编译兜底，职责分离）。
- **P2 svg 无条件豁免**：原 `.svg → real:true` 无条件，coding 丢同名 svg 即绕过"raster 真裁图物化"。修复：svg 仅当资产为矢量（`resolved_path` 非 raster 或缺省）才豁免；`resolved_path` 为 PNG/JPG 真裁图却模块侧仅 svg → not real。
- 新增单测：`跨模块同名→not real`、`svg 矢量(无 resolved)→real`、`resolved=raster 却仅 svg→not real`、`findModuleMediaFile restrict`（asset-materialization 套件 12 例全过）。

### 六.2 外部 review 三轮加固（2026-06-29）

- **P1 union-first-match 仍漏（真 bug）**：`moduleMediaRealnessForKey(restrict=pkgs)` 经 `findModuleMediaFile` 在 pkgs 里**找到第一个**同名 media 即返回；若两模块都引用、其一占位其一真图，可能命中真图放行。修复：`collectPlaceholderAssetIssues` 与 static-fidelity 改为**逐引用模块** `restrict=new Set([pkg])` 校验，任一引用模块非真图即 fail。依据＝A 物化要求"把裁图复制进**引用模块自己**的 media"，own 资源优先解析，他模块真图不改变本模块渲染占位。新增 3 单测（缺图模块→not real / 多引用模块逐一校验 / 全真图无 issue），套件 15 例全过。
- **P2 resource_integrity 全局 key set —— 判定不改（早熟/已兜底）**：reviewer 建议按 `a.filePath` 推导模块后逐模块校验 media。经核实**不改**，理由：① [coding_compile](../../profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml)（canonical BLOCKER）跑**真 hvigor 构建**，`$r('app.media.X')` 真解析不了会编译失败——resource_integrity 只是更快的静态预检，权威性在真编译；② resource_integrity 覆盖全 `$r`（color/string/media/float），逐文件模块严格会**误报跨模块共享资源**（设计 token / 公共资源 HAR 是合法 ArkUI 模式，HAP 可经依赖 HAR merge 解析 `$r`）；③ ui-spec crop 资产已由 `visual_parity_asset_materialized` 逐引用模块严格覆盖。残留（非 ui-spec 的 media `$r`、引用模块无图且无依赖提供）由真编译兜底，无实际假 PASS 漏洞。
