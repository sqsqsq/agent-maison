---
name: 首页UI保真 round5 · 素材整段化根治(P0-A 烤字门禁/P0-B 原子图标/P0-C 双渲染纪律) + 采集导航闭环(P1-A 导航采集/P1-B failureKind 分流补全/P1-C 报告诚实化)
version: 2.4.0
overview: >
  现象（用户回灌，2026-06-30 "5-第四轮优化" + 真机 testing FAIL→HALTED）：最新 framework 进宿主 SimulatedWalletForHmos 跑 homepage，5/6 阶段 PASS、卡在真机 testing 的 visual_diff（BLOCKER）。用户主诉"做出来的 UI 效果没有想象中好"。逐屏亲核（原图 vs 5-第四轮优化）+ 代码级实锤后，**结论与表象相反：素材本身是高保真真图（b4e9d1c7 已把物化断桥修好），坏在"怎么用"——`crop_from_reference` 把"整段界面"（含文字/多组件/甚至全局 tab）裁成一张背景大图，coding 既贴大图又另搭真实组件 → 系统性双重渲染 + 烤字冲突 + 真组件欠打磨**；同时真机采集不导航、5 屏截同一张图，判定层正确拒绝但 loop 因采集死结无法收敛而 HALT。
  根因（逐项对 ground-truth 实测，含代码级）：
    1. **整段大图双渲染（UI 观感真凶）**：`card_pack_hero_no_card.png` 是一整段（卡堆插画+"卡包/集中管理…"+"添加管理卡片"按钮+宫格+消息栏）；[CardImageBanner.ets:8](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/shared/components/CardImageBanner.ets) 贴这张大图，[CardGuideSection.ets:11](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/presentation/components/CardGuideSection.ets) 用它、又在 :17-46 **再渲染**真实"卡包"标题/副标题/"添加管理卡片"按钮 → 卡包区重复（截图顶部半截卡包 + 下面完整卡包）。
    2. **烤字与真文本并存**：`modal_empty_wallet.png` 把"暂无非本机卡片"烤进图；[ManageNonLocalSheet.ets:24](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/presentation/components/ManageNonLocalSheet.ets) 贴图、:28 又渲染真实 "暂无非本机卡片" → 文字两遍、不居中（must_fix score_floor≈0.21 那屏）。
    3. **好图不用/占位混用 + 全局 tab 被烤进大图**：`promo_banner_0.png` 含手机样机+5 条服务+标题副标题+**底部 tab（带图标）**；[PromoSwiper.ets:17](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/presentation/components/PromoSwiper.ets) 仅 `item.id==='p1'` 才用它、否则 :23-36 灰色占位盒（=截图的灰框），且 :52-60 又把 title/description 叠在已烤字的图上；参考图底 tab 被吸进大图，真实 tab（PhoneIndex）反被搭成纯文字无图标。
    4. **无大图屏用错系统图标**：只裁了"整段大图"、没裁"原子图标"，添加卡片/卡包列表只能用系统单色 glyph 瞎凑——管理非本机卡片配☎电话、交通卡配地图、门禁卡配锁、证件配人像；副标题从右侧错排到标题下方、白卡分组丢失。
    5. **采集不导航→5 屏同图**：`visual_diff_capture` 只对可直达顶层屏裸截图、**不执行 Tab/Nav**；全 framework 对 `visual-diff-nav.json` 零引用（agent 手写的导航脚本没人消费）。实测 [visual-diff.json](../../../SimulatedWalletForHmos/doc/features/homepage/device-testing/device-screenshots/visual-diff.json) 中 home_no_card/home_with_card/mine/card_pack/add_card **5 屏 md5 完全相同**（都是同一张首页），VL 无从逐屏判 → 全 pending。testing agent 自己在 [agent-output.log:18](../../../SimulatedWalletForHmos/doc/features/homepage/goal-runs/20260630T075009Z/phases/testing/agent-output.log) 亦如此诊断。
    6. **自动采覆盖手工补采（西西弗斯）**：[agent-output.log:32] 原话——每次 `--phase testing` 在 device_test.run 后再次自动裸采，覆盖 agent 手工导航补的正确图、[visual-diff-capture.ts mergeCapturedScreenEntry:190-197](../../profiles/hmos-app/harness/visual-diff-capture.ts:190) 因 hash 变把 verdict 打回 pending → 永远 FAIL、手工收敛被自己抹掉。
    7. **failureKind 误判（halt 原因/重试指导指错）**：dedup BLOCKER 叫 `visual_diff_screenshot_dedup`，但 [goal-failure-classifier.ts:38 isCaptureBlockerId](../../harness/scripts/utils/goal-failure-classifier.ts:38) 只认 `visual_diff_capture*` → 该采集 bug 被 :57-58 归成 `visual_gap` → [goal-runner.ts:1427](../../harness/scripts/goal-runner.ts:1427) halt 原因 `no_progress_visual_gap`（误导为 UI 差距）、重试指导变"去修 UI 区域"而非"修采集基建"。该守卫自己注释都写"x-capture-bug：Tab 未切换"。
    8. **报告手写谎言留存**：`visual-diff.md` 里"6 屏 screenshot_hash 均已唯一"是 agent 手写假话（JSON 明明 5 屏同 hash）；机器门禁以 JSON 为准正确推翻、未造成假 PASS，但 [visual-diff-capture.ts:422 if(!reportHasFinalizedVerdicts)](../../profiles/hmos-app/harness/visual-diff-capture.ts:422) 使 md 一旦定型永不再生成，谎言得以留存。
  与前序关系（正交且互补，不重复）：
    - [首页素材物化断桥根治 b4e9d1c7](首页素材物化断桥根治_占位冒充门禁与warn屏下限_b4e9d1c7.plan.md)（completed）修的是"素材是 1×1 占位没物化"，方向"把区域裁成图片引用"。它成功使素材成真图；但**"整段裁成图片"被过度应用**——本 round P0 是对它的收口纠偏（素材须原子化，禁整段烤字/含全局元素）。
    - [视觉裁判可信化 a3f1c920](视觉裁判可信化_独立布局硬门禁与VL证据链与loop熔断_a3f1c920.plan.md)（completed）让裁判会"拒绝"坏 UI、加了 dedup 守卫 + T6 熔断/分流。但**只让裁判会拒绝、没让采集能导航产出干净图**，且 dedup 被 T6 误归 visual_gap——本 round P1 是对它 T6/采集环的补全。
  方向：**纯 framework 机制 + homepage 当可证伪回归靶**，不碰宿主业务码。P0（素材原子化，最直接改善观感、UI 真解）+ P1（采集导航闭环，让 testing 能真正逐屏验收并收敛）合并落地；P0-A 与 P1-A 为承重。
  约束：framework-only；不改宿主业务码；不 bump 版本（2.4.0 未发布窗口，跟随前序）；新门禁按"goal 与普通模式能力持续拉齐"两模式统一覆盖；出口用本次宿主**真实坏态**做回归夹具（card_pack_hero 烤"卡包/添加管理卡片"、modal_empty 烤"暂无非本机卡片"、promo_banner_0 烤底 tab、5 屏同 hash、dedup→visual_gap 误判、md 手写谎言）——坏态须被新门禁/新采集抓住或修复，**原子真图 + 导航后唯一截图 + 单份 md 投影须仍 PASS（FP 校准是承重，宁可漏报不可恒误报）**。
  诚实说明：P0-A 复用 a3f1c920 的**唯一被实测证明鲁棒的 OCR 信号——文本存在性**（device≠mockup 下像素/位置度量均被证伪），只是把它反向用于素材（"该屏声明文本被烤进素材图"=整段大图），不引入新脆弱度量。P1-A 的 Hylyre touch/wait/back 原语已被 testing agent 手工用过（[agent-output.log:23] cold-restart+导航 steps 曾拿到 6 屏唯一 hash），故 P1-A=把 agent 手工做过的导航接进标准采集回环、非从零造原语。本 plan 不承诺一步做到像素级判别；P0 消除的是"结构性双渲染/烤字/错图标"这类肉眼可辨的崩坏，残差仍靠既有 VL/T2 收敛。
todos:
  - id: P0-A-asset-baked-text-gate
    content: >
      【P0 · 承重 · 素材原子化硬门禁】被 $r('app.media.<key>') 引用的**素材图不得烤入该屏 ui-spec 声明的文本节点**（=把"整段界面"当背景大图）。这是双渲染/烤字冲突的根治闸。
      病灶：card_pack_hero_no_card 烤入"卡包/集中管理您的卡证票券钥匙/添加管理卡片"、modal_empty_wallet 烤入"暂无非本机卡片"、promo_banner_0 烤入"数字金融生活新方式/首页/我的"——coding 贴大图后又渲染真实同文/组件 → 重复。既有 B(占位真图) / collectAssetRenderIssues 只查"是否真图/是否被引用"，不查"图里烤了不该烤的整段内容"。
      改造：
        (1) 复用 [ocr-toolkit.ts](../../profiles/hmos-app/harness/ocr-toolkit.ts) `ocrImageWords`：对每个 acquisition:crop 且非 placeholder、且被某组件 $r 引用的 media key，OCR 其**模块实际** media 文件（复用 P0/B 的模块路径解析，不信 contracts 根路径）。
        (2) 取"引用该 key 的组件所属屏"的 ui-spec `text` 节点集合（≥2 字锚点，复用 a3f1c920 collectGrossMissingAnchorText 的锚点口径），用**模糊子串**（OCR 掉字容错）比对：素材图内命中 ≥K 个（默认 K=2，或命中比例≥50%）声明文本 → 判该素材"烤入整段界面文本"。
        (3) 接入新 result id `visual_parity_asset_baked_text`：pixel_1to1 → BLOCKER/FAIL（沿用 `fidelityRatchetFailOrWarn`）；非 pixel_1to1 → MAJOR/WARN。finding 文案给出命中的文本 + "素材须裁为原子插画（仅图形/无声明文本），文字与交互控件用真实组件渲染"。
        (4)【review·codex X2 加固】OCR 不可用的降级**分档**：非 pixel_1to1 → 降 WARN；**pixel_1to1 下 OCR 是本门禁唯一承重探测，不可用 → 不得 WARN 放行**，落到**确定性 id `visual_parity_ocr_unavailable`**（【codex 二轮 X4】务必写死、**勿**复用 `visual_parity_asset_baked_text`——否则 `visual_parity_*` 掉进 code_regression 被盲重试）、由 P1-B 在 goal-failure-classifier 显式归 `toolchain` → halt 指向“修 OCR 环境”而非改 UI（沿用 b4e9d1c7 B 门“pixel_1to1 无法读取即 ratchet 阻断不 SKIP”同款哲学）。注：OCR 依赖已由 a3f1c920 本地物化（vendor/tessdata chi_sim，非运行时 CDN），不可用应属罕见环境故障。
        (5)【review·cursor C1 加固】human-signed defer 逃生口（与 P0-B 对齐，避免把视觉 HALT 换成门禁死锁）：某素材确需含文字作为**营销/装饰插画的一部分**（典型=promo 样机图里"东方财富 Lite/数字人民币"等气泡）时，允许 `baked_text_defer: true` + human_signed 显式放行；无署名不得放行。
      边界/FP 校准（承重）：**只抓"命中多个声明文本"的整段大图**；原子插画（card 堆插画、空钱包插画、单品牌图标）不含声明文本 → 恒 PASS。**装饰/艺术文本 ≠ ui-spec text 节点**——promo 气泡这类插画内文本**不得**登记为 ui-spec text 节点（spec/plan 侧约定），故正确的原子 promo 插画（样机+气泡、无"数字金融生活新方式"标题/无底 tab）不命中声明文本 → PASS；当前 slab（含标题/副标题/底 tab 文本，均为声明 text 节点）→ FAIL。少量偶发 OCR 误命中单个词不触发（≥K 且须匹配声明 text 节点）。svg/矢量豁免（无栅格 OCR 意义时按 raster 才判）。两模式统一。
      触点：ocr-toolkit.ts（若需批量封装）、visual-parity-backstop.ts（collectBakedTextAssetIssues）、coding-visual-parity-check.ts（注册新 id）、specs/phase-rules + profile overlay、harness/tests/unit + fixtures（本轮 3 张烤字大图为负样本，原子插画为正样本）。
      【已完成 2026-07-01】UiSpecAsset 加 baked_text_defer/baked_text_defer_by；visual-parity-backstop 加 collectBakedTextAssetIssues（screenTextAndAssetRefs 所属屏定位→declaredTextTargetsForAsset 优先所属屏/回退全集→moduleMediaRealnessForKey 取真图→ocrImageWords+fuzzyTextPresent(0.7) 命中≥2→baked_text；defer+isHumanConfirmed 放行；OCR 不可用/失败→ocrUnavailable）；coding-visual-parity-check 注册 visual_parity_asset_baked_text（pixel_1to1 BLOCKER）+ visual_parity_ocr_unavailable（pixel_1to1 toolchain BLOCKER）；overlay 注册两 id。单测：纯逻辑 scoping + **真实设备图 card_pack.png OCR 端到端**（读出35词，命中"管理非本机卡片/银行卡"判 baked_text、无关文本放行、defer 署名放行、自动化署名仍拦）。asset суite 8/8、typecheck 绿。FP 校准：单品牌 logo(<2 文本)/装饰文本(不入 text 节点)不误伤。
    status: completed
  - id: P0-B-atomic-branded-icon-assets
    content: >
      【P0 · 补齐无大图屏的原子图标】列表/宫格屏（add_card 五卡种、card_pack 行、service 宫格、mine 列表）的品牌/彩色图标须有**原子图标素材**或显式 placeholder，禁用系统单色 glyph 瞎凑冒充。
      病灶：只裁了"整段大图"、无原子图标 → 管理非本机卡片☎电话/交通卡地图/门禁卡锁/证件人像等错图标，且全成单色蓝，与参考的多彩品牌图标差距明显。
      改造：
        (1) spec/plan：ui-spec 对"参考图中为彩色/品牌图标"的元素声明独立 asset（acquisition:crop 原子图标），而非留给 coding 选 sys.symbol。plan/SKILL + overlay 增补"图标类元素优先原子素材、系统 glyph 仅限确与参考一致的单色语义图标"。
        (2)【review·codex X3 加固：分档 BLOCKER】coding-visual-parity 新 id `visual_parity_icon_substitution`——ui-spec **显式声明了 required 图标 asset** 的元素、源码却用 `sys.symbol.*`/`$r('sys.*')` 静默替代：**pixel_1to1 → BLOCKER/FAIL**（除非显式 placeholder/defer + human_signed）；非 pixel_1to1 或"仅风格偏差非 required" → MAJOR/WARN。实测坏态佐证：[CardRepository.ets](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets) 交通卡=sys.symbol.map/门禁=lock/证件=person、[HomeRepository.ets](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/data/repository/HomeRepository.ets) 宫格仅 Huawei Card 用真素材、其余全 sys.symbol——正是"效果不好"的一大块。**【Q5 已拍板采纳·2026-07-01】此档＝BLOCKER（非 WARN）；命门在 P0-B(1) spec/plan 须可靠地把"参考图中彩色/品牌图标"元素声明为 required asset——漏声明＝漏报（可接受），不误伤未声明的语义单色 glyph。**
        (3)【review·cursor C2 加固】图标素材声明约定须覆盖**全局/跨屏元素**：底部 tab（首页/我的）图标属 global_element，其图标须可声明为 required asset，否则真实 tab（PhoneIndex 纯文字）无门禁兜底。spec/plan 约定与 P0-B 门禁均纳入 global_elements 的图标。
        (4) 与 P0-A 互补：A 管"素材烤了整段"、B 管"该有原子图标却没有/用错系统图标"。
      边界/FP：仅对 ui-spec **显式声明为 required 图标 asset** 的元素生效，不强制所有图标都裁图（纯单色语义图标——如车钥匙 car——确与参考一致时可继续用系统 glyph）；宁可漏报不误伤。两模式统一。
      触点：skills/feature/spec+plan SKILL/overlay（图标素材声明约定）、coding-visual-parity-check.ts / visual-parity-backstop.ts、harness/tests/unit。
      【已完成 2026-07-01】visual-parity-backstop 加 featureUsesSystemSymbolIcon（feature 全树扫 $r('sys.symbol.*')/SymbolGlyph，覆盖 data 层 repository）+ collectIconSubstitutionIssues（icon.kind∈{brand_logo,illustration} 且品牌 media 未 $r 渲染 且源码用 sys.symbol → icon_substitution；placeholder/system_symbol/无sys.symbol 豁免）；coding-visual-parity-check 注册 visual_parity_icon_substitution（Q5 pixel_1to1 BLOCKER）；overlay 注册；ui-spec.md 写入 P0-B 图标分型约定（品牌图标声明 brand_logo/illustration+ref、含底 tab；漏声明=漏报）。单测 4/4（替代→拦、真图渲染/system_symbol/placeholder/无sys.symbol→放行）、typecheck 绿。命门＝spec 声明 required 品牌图标（已写约定）。
    status: completed
  - id: P0-C-no-double-render-discipline
    content: >
      【P0 · coding 纪律 + 结构自检】素材=原子叶子视觉，文字/交互控件永远真实组件；同屏禁止"贴含内容的大图 + 又渲染同内容真实组件"。
      病灶：CardGuideSection 大图+真文本双份、ManageNonLocalSheet 图内烤字+真文本双份、PromoSwiper 图内烤字+叠加 title 双份——均因 coding 把"整段大图当背景"又补真组件。
      改造：
        (1) coding/SKILL + profile-addendum：明确"assets[] 的图=**原子插画/图标**，仅作叶子 Image；卡包标题/副标题/按钮/空态文案/底部 tab 等一律真实组件，**绝不依赖大图里烤的那份**；若发现某 asset 含标题/按钮/tab（整段），停下按 P0-A 回退重裁原子图，不得贴整段大图糊弄。"
        (2) 结构自检（确定性、低 FP）：同一屏内 ui-spec 声明的同一 `text` 节点在源码被渲染 ≥2 次（真实 Text 重复），或"贴了含该文本的 asset 图 + 又渲染真实同文"（依赖 P0-A 的烤字检测结果做交叉）→ `visual_structure_duplicate_render` WARN（pixel_1to1 可升）。主力仍是 P0-A（源头不让烤字，双渲染自然消失）。
      边界：P0-C 的结构自检为兜底 WARN，避免与 P0-A 重复 gate；真正承重是 P0-A（掐源头）+ SKILL 纪律。两模式统一。
      触点：skills/feature/coding SKILL + profiles/hmos-app/skills/coding/profile-addendum、visual-structure-parity.ts（重复渲染自检）、harness/tests/unit。
      【承重已完成 2026-07-01 · P0-C(2) 显式留后续】profile-addendum ArkUI parity 段写入 P0-C 纪律："素材=原子叶子视觉、禁双渲染——标题/副标题/按钮/空态文案/底部 tab 一律真实组件，绝不贴整段大图；发现 asset 含整段内容即回退 P0-A 重裁；品牌图标 $r(app.media) 禁 sys.symbol 冒充"。**P0-C(2) 结构自检 deferred**：实测三处双渲染（卡包区/空态文字/promo）全是 slab+真组件型，**已被 P0-A 烤字 BLOCKER 从源头覆盖**；纯真组件重复渲染需 text→string-key 映射、属高 FP 低价值 WARN，按"宁可漏报不误报"暂不做，留后续单独一条。
    status: completed
  - id: P1-A-navigated-capture
    content: >
      【P1 · 承重 · 采集导航闭环】`visual_diff_capture` 须**按屏导航到位再截图**，使各屏 screenshot_hash 唯一、重跑幂等，根除"5 屏同图 + 自动采覆盖手工补采"。
      病灶：captureVisualDiff 只对 isLikelyTopLevelScreen 裸截图、逐屏调 screenshotFn 但无导航；visual-diff-nav.json 全 framework 零引用；重跑自动裸采覆盖手工导航结果并把 verdict 打回 pending。
      改造：
        (1) 【Q2 已拍板：固化显式 nav 配置为准】以一份**显式固化**的 per-screen 导航配置为唯一真源（沿用 agent 已用的 touch/wait_for/back/by_id/by_text 语义，形式化 schema + 校验；放 device-testing 下随 feature 版本管理）；capture 前按配置对每屏执行导航步驱动 Hylyre（原语已被 agent 手工验证可用），到达锚点（must_have_elements/标题）后再 screenshot；到不了目标屏 → 该屏 p0CaptureFailures（复用 E1 阻断），不写错图。**页面结构无变化时该配置复用、不需重生成**；仅当屏/入口/导航态变更才更新（缺配置或配置与 ui-spec 屏集不一致 → 明确报错求补，不静默裸采）。"ui-spec 自动推导导航"留作后续增强，本轮不做。
        (2) 幂等：导航感知的自动采 == agent 手工补采的等价物，**取消"裸采覆盖导航采"的路径**；finalized verdict 仅在"重采到的仍是同一目标屏且 hash 因真实 UI 变化才变"时才 invalidate（避免把正确重采误当变更打回 pending）。
        (3) 与 dedup 守卫联动：导航后仍 ≥2 屏同 hash = 导航真失败（非误报），保留 dedup BLOCKER 但归 capture 桶（见 P1-B）。
        (4)【review·codex X1 加固：overlay/screen_id 归一化】同一逻辑屏现存三套 id——ui-spec `manage_non_local`（[ui-spec.yaml:302](../../../SimulatedWalletForHmos/doc/features/homepage/spec/ui-spec.yaml:302)）/ 采集 `manage_non_local__overlay__0`（[visual-diff.json:188](../../../SimulatedWalletForHmos/doc/features/homepage/device-testing/device-screenshots/visual-diff.json:188)）/ nav 配置 `manage_non_local__overlay__manage_non_local_root`（[visual-diff-nav.json:26](../../../SimulatedWalletForHmos/doc/features/homepage/device-testing/visual-diff-nav.json:26)）。**"配置 vs ui-spec 屏集一致性"校验须先经归一化**：显式定义 screen_id ↔ ref_id ↔ overlay_id(`__overlay__*`) ↔ nav_key 的映射规则（复用 visual-diff-check `resolveP0Entry` 的 `__overlay__` 拆分口径），nav 配置以规范化 overlay_id 为 key；否则本已失败的 manage_non_local 仍会被误判"未覆盖/不一致"。此映射须进单测夹具（三套 id 归一到同一屏）。
      边界：先覆盖 homepage 6 屏（含 overlay）；Hylyre 不可用→既有 degraded 降级路径不变。两模式统一。
      触点：visual-diff-capture.ts（导航执行 + 幂等合并）、providers/hylyre（touch/wait 原语接线，若未导出）、device-testing SKILL、visual-diff-targets.ts、harness/tests/unit + fixtures（5 屏同图坏态 → 导航后唯一）。
      【已完成 2026-07-01 · 设备执行归 Q4 宿主重跑验收】新增 visual-diff-nav.ts（NavStep/NavConfig schema + canonicalOverlayBase/navKeyMatchesTarget **X1 归一化** + resolveNavForTargets + validateNavStep/validateNavConfig 一致性 + loadVisualDiffNavConfig 固化配置读取）；visual-diff-capture 加 navConfig/navExecutorFn 选项，主循环**导航到位再截（含非顶层屏，nav 失败即记 p0 失败不截错屏）**，overlay 循环同样导航+截图（ref_id=基屏）；visual-diff-hylyre-screenshot 加 buildHylyreNavExecutorFn（写 steps-file→hylyre run --steps-file）；check-testing 接线（有固化配置则导航、缺则向后兼容旧裸采）；device-testing SKILL Step4.6 写入固化 nav 配置约定。**单测**：nav 模块（X1 同基 overlay 匹配/base 不跨串/校验缺屏/多余键/坏步骤）+ 采集 wiring（导航到达非顶层屏、导航失败不截错屏、无 nav 向后兼容跳过、**overlay 经 X1 归一化导航采集**）。typecheck 0 / **unit 1340** / fixtures 35 全绿。**on-device Hylyre 实际导航执行 + 幂等重采效果由 Q4 宿主重跑端到端验收**（本地无设备，逻辑与 wiring 已 mock 全测）。
      【review 四轮收口 2026-07-01】cursor+codex 双命中同一真缺口：validateNavConfig 曾是死代码（SKILL/plan 承诺"缺配置/不一致→报错求补不静默裸采"但代码没接、X1 的 unmatchedKeys 白造）。已收口：(1) captureVisualDiff 主循环 navEnabled 下某 P0 屏缺 nav 条目 → 拒裸采、记 p0CaptureFailures（防退成空步骤截同一帧）；(2) check-testing 接入 validateNavConfig fail-fast——≥2 P0 屏且缺配置、或配置与屏集不一致/步骤非法 → visual_diff_capture BLOCKER（pixel_1to1）不进 capture。补 fix(1) 单测。
      【review 四轮·FP 根治 2026-07-01】cursor 实测发现接线引入误报：homepage 的 manage_non_local 是 P0 屏且 root 即 overlay_panel，collectP0VisualTargetIds 把 base(manage_non_local)+overlay(__overlay__0) **重复计入 7 个**，nav 配置只需 overlay 键 → base 误判 missing → 回归靶会挂新门禁（且这是既有 coverage 门禁的同一潜在 FP——正是用户截图 manage_non_local 列进"P0 未覆盖"之因）。根治于源头：visual-diff-targets 加 isOverlayRootScreen，collectP0VisualTargetIds **排除 root 即 overlay 的 base 屏**（由其同基 overlay id 代表）；captureVisualDiff 主循环跳过 overlay-root base 屏（由 overlay 循环采集）。实测：targets 收敛为 6 个、realistic host nav（overlay-only 键 + X1 后缀差异）validateNavConfig **ok=true**。补回归夹具（root=overlay_panel + overlay-only nav → ok）+ 强化 overlay 采集测试（base 不记 p0 失败/不重复采）。typecheck0/**unit1342**/fixtures35 全绿。
    status: completed
  - id: P1-B-failurekind-capture-classify
    content: >
      【P1 · 分流补全】把"采集导致的 dedup/pending"正确归入 `capture` 桶，使 halt 原因与重试指导指向基建而非 UI。
      病灶：isCaptureBlockerId 只认 `visual_diff_capture*`，`visual_diff_screenshot_dedup` 落入 visual_gap → halt=no_progress_visual_gap、重试指导"改 UI"，与真因（Tab 未切换/采集）南辕北辙。
      改造：
        (1) [goal-failure-classifier.ts](../../harness/scripts/utils/goal-failure-classifier.ts) isCaptureBlockerId 纳入 `visual_diff_screenshot_dedup`（及明确由"撞 hash/未到达目标屏"导致的采集类 id）；确保其**优先于** isVisualGapBlockerId 判定（现顺序 toolchain→capture→visual_gap 已满足，只需 dedup 归 capture）。
        (2) 复核 goal-runner haltReason 映射：capture → `no_progress_capture` + "修采集基建/设备连接/导航"指导（[goal-runner.ts:552-558]）；确认预算分流（capture 属基建、signature 重复即 halt、不吃视觉迭代预算）对 dedup 生效。
        (3)【codex 二轮 X4】P0-A 的 `visual_parity_ocr_unavailable`（pixel_1to1 下 OCR 承重探测不可用）在 classifier 显式归 `toolchain`（工具依赖缺失，与 build/hylyre 同类；signature 重复即 halt、不吃视觉预算）——防其 `visual_parity_*` 前缀掉进 code_regression 被盲重试。
        (4) 回归：dedup 坏态 summary → classifyFailureKind='capture'、halt=no_progress_capture；`visual_parity_ocr_unavailable` → 'toolchain'；真 UI 差距（must_fix/text_missing/out_of_bounds）仍='visual_gap'。
      边界：只重归"采集/工具身份类"信号；真视觉门禁（layout/must_fix/越界）不动。两模式统一。
      触点：goal-failure-classifier.ts、goal-runner.ts（haltReason/指导文案核对）、harness/tests/unit（classifier 分流单测补 dedup 用例）。
      【已完成 2026-07-01】isCaptureBlockerId 纳入 `visual_diff_screenshot_dedup`（新 CAPTURE_BLOCKER_IDS 集）、isToolchainBlockerId 纳入 `visual_parity_ocr_unavailable`（新 TOOLCHAIN_BLOCKER_IDS 集）。单测 goal-headless-guard 补 3 例：dedup→capture / ocr_unavailable→toolchain / 反向 baked_text·icon_substitution 仍 code_regression。classifier 用例 12/12、typecheck 绿。
    status: completed
  - id: P1-C-visual-diff-md-honest-projection
    content: >
      【P1 · 诚实化】visual-diff.md 改为**永远从 visual-diff.json 投影再生**，含"采集完整性"节，根除手写散文与机器 JSON 背离。
      病灶：buildVisualDiffMdBody 仅在 !reportHasFinalizedVerdicts 时写 → 定型后 agent 手写"6 屏 hash 均已唯一"谎言长存（JSON 实为 5 屏同 hash）。
      改造：
        (1) 每次采集/校验后**无条件**由 JSON 再生 md（删 :422 的 finalized 短路）；md 为纯投影，含各屏 verdict/score_floor/must_fix + 新增"采集完整性：各屏 screenshot_hash 是否唯一、是否到达目标屏、p0CaptureFailures"。
        (2) agent 须在 JSON（结构化）填 verdict/证据，禁在 md 手写与 JSON 矛盾的结论；md 顶部注明"本文件由 JSON 自动生成，勿手改"。
        (3) 回归：给定含重复 hash 的 JSON，再生 md 必须显式列"screenshot_hash 非唯一：<groups>"，不得出现"均已唯一"之类未据 JSON 的表述。
      边界：纯生成/展示层，不改门禁判定（判定始终以 JSON 为准）。两模式统一。
      触点：visual-diff-capture.ts（buildVisualDiffMdBody + 再生时机）、device-testing SKILL（"md 自动生成勿手改"）、harness/tests/unit。
      【已完成 2026-07-01】删 reportHasFinalizedVerdicts 短路→md 每次无条件再生；buildVisualDiffMdBody 改为 JSON 纯投影（屏清单表格含 must_fix + 新增「采集完整性」节：hash 唯一性/P0 采集失败/缺截图/未判屏）+ 导出 collectDuplicateHashGroups；device-testing SKILL Step4.6 写入"md 自动生成勿手改、结论以 JSON 为准"。单测 2 例（重复 hash 报非唯一+投影 must_fix/p0 失败 / 唯一 hash 报✓）、typecheck 绿。
    status: completed
---

# 首页 UI 保真 round5 — 素材整段化根治 + 采集导航闭环

> 来源：宿主 SimulatedWalletForHmos，feature=`homepage`，run=`20260630T075009Z`（5/6 阶段 PASS，testing FAIL→HALTED）。
> 用户主诉：最新 framework 做出来的 UI 效果没想象中好；真机 testing 卡在 visual_diff。
> 对比现场：`D:\1.code\对比结果\0-home-page`（`0-原始需求` 原图 / `5-第四轮优化` 最新效果）。
> 范围：用户要求先分析、再出合并 plan（P0+P1）供 review；**本 plan 待 review 通过后才动手**。
> 状态：诊断完成、代码级证据已核实；待用户 review。

---

## 0. 一句话根因

**素材是好的，坏在"整段裁图当背景 + 又搭真组件"的用法（P0），和"采集不导航→截同一张图→loop 死结"的闭环缺失（P1）。** 前者让 UI 观感崩（重复/烤字/错图标），后者让 testing 无法逐屏验收而 HALT。判定层（a3f1c920）没错——它正确拒绝了坏 UI。

## 1. 证据索引（均已亲核）

| # | 证据 | 位置 |
|---|---|---|
| 双渲染·卡包 | 大图贴 + 真组件再渲染 | [CardImageBanner.ets:8](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/shared/components/CardImageBanner.ets) / [CardGuideSection.ets:11,17-46](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/presentation/components/CardGuideSection.ets) |
| 烤字·空态 | 图内烤"暂无非本机卡片" + 真文本 | [ManageNonLocalSheet.ets:24,28](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/presentation/components/ManageNonLocalSheet.ets) |
| 占位混用·promo | 好图仅 p1 用、否则灰盒；叠字重复 | [PromoSwiper.ets:17,34,52-60](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/presentation/components/PromoSwiper.ets) |
| 5 屏同图 | md5 全相同 a2feda2fa5caca02 | [visual-diff.json](../../../SimulatedWalletForHmos/doc/features/homepage/device-testing/device-screenshots/visual-diff.json) |
| 采集不导航·自证 | agent 自诊断 | [testing/agent-output.log:18,32](../../../SimulatedWalletForHmos/doc/features/homepage/goal-runs/20260630T075009Z/phases/testing/agent-output.log) |
| dedup 误分流 | isCaptureBlockerId 只认 capture* | [goal-failure-classifier.ts:38,57](../../harness/scripts/utils/goal-failure-classifier.ts:38) |
| md 谎言留存 | 定型后 md 不再生成 | [visual-diff-capture.ts:422](../../profiles/hmos-app/harness/visual-diff-capture.ts:422) |

## 2. 落地顺序建议

1. **P1-A（采集导航）先行**：没有干净的逐屏截图，P0 的修好与否根本无法被 testing 验收/回归。承重。
2. **P0-A（烤字门禁）+ P0-C（纪律）**：掐断整段大图源头，双渲染/烤字自然消失——UI 观感的最大单点改善。承重。
3. **P0-B（原子图标）**：补无大图屏的图标缺口。
4. **P1-B（分流补全）+ P1-C（诚实化）**：低成本、消除误导与谎言留存。

## 3. 决策（2026-07-01 用户已拍板 · 全部锁定）

- **Q1 素材粒度强制档 → 直接 BLOCKER**：P0-A 在 pixel_1to1 下 BLOCKER（不做"先 WARN 观察"），把"整段大图"全部逼成原子图 + 真组件、根治双渲染。
- **Q2 导航步来源 → 固化显式 nav 配置为准**：P1-A 以一份显式固化的 nav 配置为唯一真源；**页面结构无变化时复用、不需重生成**；ui-spec 自动推导留作后续增强。
- **Q3 版本窗口 → 2.4.0**：跟随未发布窗口，不 bump。
- **Q4 验收方式 → 宿主重跑为准**：framework 侧仍用本轮**真实坏态**建单测/夹具（3 张烤字大图 / 5 屏同 hash / dedup 误判 / md 谎言——坏态须被抓、修好的原子态+导航后唯一截图须仍 PASS）；**最终验收 = 开发完成后用户把新版本集成进宿主工程、重跑整个 homepage 需求**端到端确认。

## 3.5 外部 review 核实与加固（2026-07-01，cursor + codex，逐条对 ground-truth 核实）

两份 review 事实主张**全部核实属实**，无臆造/无早熟；已并入上方 todo：

| 来源 | 建议 | 核实 | 处置 |
|---|---|---|---|
| codex X1 | overlay/screen_id 三套 id 不一致须归一化 | 属实（manage_non_local / __overlay__0 / __overlay__manage_non_local_root） | 并入 **P1-A(4)** + 单测夹具 |
| codex X2 | P0-A 直接 BLOCKER 与"OCR 不可用降 WARN"冲突 | 属实（OCR 是承重探测，挂了则 slab 漏过） | 并入 **P0-A(4)**：pixel_1to1 OCR 不可用 → toolchain 类 BLOCKER 不放行（id `visual_parity_ocr_unavailable`） |
| cursor C1 | P0-A 缺 human-signed 逃生口 + promo 气泡文本 FP | 属实（否则视觉 HALT 换门禁死锁） | 并入 **P0-A(5)** + 边界"装饰文本≠text 节点"校准 |
| cursor C2 | P0-B 图标约定须覆盖全局底 tab | 属实（真 tab 纯文字无兜底） | 并入 **P0-B(3)** |
| codex X3 | P0-B 对错图标偏软、应 BLOCKER | 属实（4/5 卡种 + 宫格多数用 sys.symbol） | 并入 **P0-B(2)** 分档 BLOCKER，**Q5 已采纳** |

- **Q5（2026-07-01 已拍板：采纳 BLOCKER）**：P0-B 采纳"pixel_1to1 + ui-spec 显式声明 required 图标 asset + 源码静默用 sys.symbol 替代 → BLOCKER（human-signed defer 可放行）"。触发条件精确、有署名逃生口不死锁、漏声明只漏报不误报；命门＝P0-B(1) spec/plan 的 required 图标声明约定须写死。
- **X4（review·codex 二轮收口）OCR 不可用的确定性 failure id + classifier 归类**：P0-A 的"pixel_1to1 OCR 不可用 → BLOCKER"须落到一个**确定性 id `visual_parity_ocr_unavailable`**（`visual_parity_*` 既不 startsWith('visual_diff') 也不在 capture 白名单 → 现会掉进 code_regression 被盲重试）；已并入 **P0-A(4)** 定义该 id + **P1-B** 在 [goal-failure-classifier.ts](../../harness/scripts/utils/goal-failure-classifier.ts) 显式归 `toolchain`（工具依赖缺失、signature 重复即 halt、不吃视觉预算），杜绝被 visual_gap/code_regression 吃掉。
- **C3 澄清（promo 灰盒由谁兜）**：实测 [HomeRepository.ets:43,49](../../../SimulatedWalletForHmos/02-Feature/WalletMain/src/main/ets/data/repository/HomeRepository.ets) p2=`sys.symbol.rectangle_stack`、p3=`sys.symbol.doc_plaintext`（=截图灰盒文档图标），仅 p1 用真素材。归属：**若 spec 把 3 个 promo 都声明为 required banner asset → P0-B(2) 抓（sys.symbol 替代）**；若按原始需求"mock 3 个广告"仅要求轮播效果、p2/p3 可为简态 → 属可接受 mock、不 gate。**取舍留 spec 决定**（本 plan 不新增专门 gate）；但"灰盒难看"这类回退观感仍属重跑后 coding 收敛项。

## 4. 非目标（本 plan 不做）

- 不改宿主业务码（framework-only；宿主侧修 UI 由后续 coding 轮按新门禁自然收敛）。
- 不追求像素级几何判别（a3f1c920 已实测证伪；残差仍靠 VL/T2 人确认收敛）。
- 不 bump 框架版本、不动已 completed 的 b4e9d1c7/a3f1c920 既有 todo。
- 【已知局限·review·cursor 三轮·后续可选】P0-A/P0-B 的 `visual_parity_*` id 归 `code_regression`（偏好重试让 coding 修，符合预期——它们是 coding 可修的结构坏态，非环境类）；副作用＝`code_regression` 不进 no-progress 熔断集，若某轮 coding 反复产出烤字/错图标且 signature 不变，会重试到吃满预算而非早停求人。此为既有 coding-phase 门禁通性、**非本 plan 引入的回归**；"coding 侧结构坏态反复不改善即早停熔断"留作后续单独一条，本轮不做（X4 只需处理环境类 `ocr_unavailable`）。
