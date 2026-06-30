---
name: 视觉裁判可信化 · 独立布局硬门禁(P1) / pixel_1to1 P0 人确认兜底(P1) / lightweight 不豁免(P1) / warn 收紧+可执行 must_fix(P1) / 屏身份越界门禁(P1) / goal-mode 熔断+预算分流(P1) / VL 逐元素 bbox 证据链(P2)
version: 2.4.0
overview: >
  现象（用户回灌，2026-06-29 第三轮 "4-第三轮优化"）：最新 framework 进宿主 SimulatedWalletForHmos 跑 homepage，3 轮真机迭代（前 2 轮各满 60 分钟）基本没改善、部分更差（卡包描述+「添加管理卡片」从卡夹下方被挪到上方，越改越错），但 goal-mode 全 6 阶段 PASS / COMPLETED。
  根因（已逐项对 ground-truth 实测）：**"真机测试+对比纠错"的最终视觉裁判 = device-testing 的 agent/VL 自己看图后手填 `fidelity_score / verdict / defects`；framework 里唯一"能 gate"的客观背靠 `score_floor` 是颜色直方图（布局盲）。于是 agent 在白底页随手写 0.98/pass/defects:[]，无任何确定性机制能推翻这个"自洽的谎"。** 与 2026-06-28 那轮（[首页素材物化断桥根治 b4e9d1c7](首页素材物化断桥根治_占位冒充门禁与warn屏下限_b4e9d1c7.plan.md)，已 completed，修的是占位色块/采集新鲜度/warn 地板 0.45）正交：那轮把素材物化好之后，分数上去了，反而把"VL 假高分"这个更底层的洞暴露出来。
    1. 实测 [visual-diff.json](../../../SimulatedWalletForHmos/doc/features/homepage/device-testing/device-screenshots/visual-diff.json)：card_pack=pass/f0.98/floor0.999、add_card=pass/f0.98/floor0.996，但我亲核 framework 自抓的 shot-card_pack.png vs 原始 3.卡包-无卡.jpg——+按钮位置/样式错、副标题竖排错位、「管理非本机卡片」图标渲染成电话☎、底部泄漏全局「首页/我的」Tab。**截图抓得对，错在打分。**
    2. score_floor 布局盲（核心）：[visual-diff-capture.ts:153-167 resolveScoreFloor](../../profiles/hmos-app/harness/visual-diff-capture.ts:153) = `min(全局直方图, 4×4 分块直方图)`（[image-toolkit.ts:192-235](../../profiles/hmos-app/harness/image-toolkit.ts:192)），都是颜色分布——白底+少量蓝黑字的页面恒≈0.99，布局/图标/位置全错也高分。哨兵 [visual-diff-check.ts:598-601](../../profiles/hmos-app/harness/visual-diff-check.ts:598) 仅在 `VL分 − floor ≥ 0.35` 触发，这里两者同高 → 不触发。
    3. 唯一布局敏感的客观指标被刻意阉割成"只 WARN、永不 gate"：[image-toolkit.ts:256-261 computeEdgeDensityTileDivergence](../../profiles/hmos-app/harness/image-toolkit.ts:256)（8×6 z-归一结构散度）注释明写"mockup≠device 像素不对齐、整屏基线偏高 → 仅 WARN 低置信兜底、永不单独 gate"；边缘哨兵 [visual-diff-check.ts:352-371](../../profiles/hmos-app/harness/visual-diff-check.ts:352) `EDGE_SENTINEL_MIN_UNCOVERED=5` 且阈值"真机样本尚不存在、暂定值"。→ 能 gate 的布局盲、布局敏感的不让 gate。
    4. lightweight P0 屏整个跳过视觉门禁：home_no_card `priority=P0 + lightweight:true`（[ui-spec.yaml:6-9](../../../SimulatedWalletForHmos/doc/features/homepage/spec/ui-spec.yaml)）→ [visual-diff-capture.ts:120-126 collectP0CaptureTargets](../../profiles/hmos-app/harness/visual-diff-capture.ts:120) `!s.lightweight` 把它排除采集，json verdict=skipped。用户抱怨最重的"黑块宫格/破图标"那屏从未被评。叠加 json note "MVP 预填 mock 卡导致无卡态不可达"——还暴露 mock 状态/导航 bug。
    5. warn 屏地板压线逃逸 + warn 永不回修：[visual-diff-check.ts:39-40](../../profiles/hmos-app/harness/visual-diff-check.ts:39) `FINALIZED_MIN_FIDELITY=0.45`，home_with_card f0.52 / manage_non_local f0.48 全压线逃过；warn 屏既不产 must_fix 也不进 coding 回修，loop 拿不到"改哪"的信号。
    6. 缺可执行回修信号 → loop 瞎猜：5 屏无任一 must_fix（pass 或非阻断 warn），coding 不知该修什么 → 把卡包描述从卡夹下挪到上"越改越错"。
    7. 子页越界元素无确定性门禁：card_pack/add_card（业务子页 / 非 home scope 屏）渲染出本应只属首页的底部「首页/我的」Tab，这是确定性可查的结构越界，但既无静态规则也无视觉门禁抓到。注：这两屏 ui-spec 的 root 实测亦为 navigation_frame@0，故识别须靠声明式 scope 而非 root 类型（见 T5）。
    8. 时间黑洞：前 2 轮各 60 分钟大概率耗在工具链/schema 门禁（build/install/hylyre/采集/hash）反复失败，与"像不像"无关；视觉差距从未被有效度量。goal-runner 有 [retry/budget 机制:1266-1392](../../harness/scripts/goal-runner.ts:1266)（max_retries_per_phase / checkRunBudget），但无"视觉无改善即熔断求人"与"工具链失败 vs 视觉失败"分流。
  方向（用户 2026-06-29 三项拍板，见 §四）：①裁判可信=**两者都做、分阶段**——先上独立布局硬门禁堵谎(P1)，再补 VL 逐元素 bbox 证据链(P2)；②范围=**纯 framework 机制 + homepage 当可证伪回归靶**，不碰宿主业务码；③loop=**视觉无改善 N 轮即 HALT 求人 + 工具链/视觉预算分流**。
  约束：framework-only；不改宿主业务码；不 bump 版本（2.4.0 未发布窗口）；新门禁/熔断按 [goal 与普通模式能力持续拉齐](../../../../) 两模式统一覆盖；出口用本次 homepage **真实坏态**（card_pack/add_card VL 0.98 假 pass + home lightweight skip + 子页泄漏 Tab + warn 0.48/0.52 压线逃逸）做回归夹具——坏态须被新门禁判 BLOCKER，**修好的真态/忠实渲染须仍 PASS（FP 校准是承重，宁可漏报不可恒误报）**。
  诚实说明：T1（独立布局硬门禁）是 8 份历史 plan 一致 punt 掉的"VL 最不可靠环"——punt 的真实理由是 FP 风险（mockup≠device、整屏基线高、缺真机干净样本）。本 plan **不假装能一步做到像素级判别**，而是把硬门禁收窄到"高置信背离区间"（VL 高分 ∧ 客观布局散度明确超阈 ∧ pixel_1to1 P0）+ 强制用修好的 home 反向校准，宁可只抓崩坏（card_pack 级肉眼差异）不误伤正常残差。能"一眼判同页"的精度即达标，像素级几何仍归可选高保真通道（G5）。
todos:
  - id: T1-independent-layout-hard-gate
    content: >
      【P1 · 核心承重墙 · 决策①第一阶段】独立、布局敏感、能 gate 的客观背靠，使 VL 假高分可被否决。这是 8 份历史 plan 一致 punt 的洞。【方向已锁，FP 校准是实现期承重】
      病灶：score_floor 布局盲（直方图，白底恒 0.99）；edge_tile_divergence 布局敏感却"永不 gate"。两者都救不了 card_pack/add_card 的 0.98 假 pass。
      **【实现期实测·重大修正 2026-06-29】像素统计度量被证伪、改走 OCR**：在真实样本（mine=忠实正 / card_pack+add_card=崩坏负）上跑候选度量——区域SSIM 把崩坏 card_pack(0.635) 排在忠实 mine(0.234) 之上（反了）；投影散度 mine=0.636≈card_pack=0.633；CROSS（mine 截图配错误原图）=0.657≈mine 自身配对 0.636=在测噪声。根因：忠实复杂屏的"设备 vs mockup"像素差 > 崩坏简单屏（大片白底）的差。**故 (2) jimp 区域散度当承重硬门禁不成立**（会做出比温和提醒更糟的"噪声门禁"）。改走 **OCR 文本存在/位置**（用户 2026-06-29 拍板）：已实测 tesseract.js chi_sim 在设备截图上可读中文——card_pack 的"首页/我的"在 y≈1920 底部被干净读出（=泄漏 tab 确定性证据）、"管理非本机卡片/银行卡"命中（OCR 有掉字/乱码，须模糊子串匹配）。edge 散度仅保留为低置信 WARN，不 gate。
      **【评审P0 收紧·必读】T1 不得只"把现有 edge sentinel 升级成 gate"**：实测 card_pack/add_card 的 `edge_over_threshold_tiles` 各仅 2 个，而现门槛 `EDGE_SENTINEL_MIN_UNCOVERED=5`（[image-toolkit.ts:254](../../profiles/hmos-app/harness/image-toolkit.ts:254)）——光复用旧 edge 规则，这两个假 pass 仍漏。故 **(2) 区域级布局散度 + (3) 文本框位置核对 必须作为 T1 的承重实现，不是可选证据**；edge-tile 仅作辅助。
      改造（OCR 路径，已实测可行）：
        (T0 前置·OCR 能力)【已完成 2026-06-29】引入 tesseract.js@5.1.1 至 harness/package.json；chi_sim.traineddata(2.47MB) 本地物化于 profiles/hmos-app/vendor/tessdata/（跟随 hylyre wheel 物化惯例，绝不运行时 CDN 拉）；新增 ocr-worker.cjs（spawnSync 子进程，仿 image-jimp-worker）+ ocr-toolkit.ts：`ocrImageWords(path)→{ok,width,height,words:[{text,conf,bbox 归一化[x,y,w,h]}]}`、`isOcrAvailable()`、模糊匹配 `fuzzyTextPresent/fuzzyTextInBand/findFuzzyWords/wordCenterY`（OCR 有掉字须容错）；任何失败→ok:false 优雅降级（不抛、不阻断采集）。.gitattributes 加 `*.traineddata binary`。**实测验证**：card_pack 设备图 OCR 读出"首页/我的"在底部 band（=泄漏 tab 确定性证据）、内容文案命中；单测 profiles/hmos-app/harness/tests/unit/ocr-toolkit.unit.test.ts 8/8（含 OCR 实跑 + 优雅降级），真实样本 vendoring 进 tests/fixtures/ocr/。unit 1248 / fixtures 35 / typecheck 全绿。
        (1) **OCR 文本-位置背离硬门禁（承重·汇聚判据）**：对参考图与截图分别 OCR，比对 ui-spec 声明的关键文案（text 节点）的**存在 + 归一化位置/同行分组**。pixel_1to1 P0 屏 verdict∈{pass} 但 OCR 显示关键文案缺失/纵向位置错位（如"添加管理卡片"描述从卡夹下挪到上、副标题横→竖）→ `visual_diff_layout_divergence` BLOCKER，要求 VL 重判或补 must_fix。**必须对 card_pack/add_card 真实坏态生效**（出口①硬验收）。匹配用**模糊子串**（OCR 有掉字/乱码：实测"添加卡片"→"添卡片"）。
        (2) edge_tile_divergence 保留为**低置信 WARN 兜底**（已证伪为 gate，不再当承重）。
        (3) 阈值校准：用真实样本（mine 忠实须 PASS、card_pack/add_card 崩坏须 BLOCKER）+ 出口②"修好的 home"反向验证不恒误报。位置容差要吸收 mockup≠device 的整体缩放（用归一化坐标 + 同行/区段分组，非绝对像素）。
      边界/FP：OCR 信号为承重；OCR 不可用→降 WARN 不 SKIP 整体。非 pixel_1to1 一律降 WARN。**硬门禁=pixel_1to1 BLOCKER，绝不做成 WARN-only 温和提醒（评审核心警告）。** 两模式统一。
      触点（实现期重新核行号）：新增 ocr-toolkit（tesseract.js 封装 + chi_sim 物化）、image-toolkit.ts、visual-diff-capture.ts（采集层写 OCR 文本框）、visual-diff-check.ts（背离硬门禁）、harness package.json 加 tesseract.js、specs/phase-rules + profile overlay 注册新 check id、harness/tests/unit + fixtures。
      【已完成 2026-06-29 · 第二次实测后缩窄】**T1 文本-位置背离硬门禁也被实测证伪**（在真实 ref+shot 跑：忠实 mine 纵序倒置 0.20/最大Δy 0.36 反而>崩坏 card_pack 0.00/0.11——device≠mockup 使忠实屏文字位置也大偏移，位置/顺序信号同被污染）。**根本规律**：这套 UI 可区分错误压倒性是非文本的（图标/颜色/图片/相对图像挪位），像素与 OCR 位置都看不见；唯一对 device≠mockup 鲁棒的 OCR 信号是**文本存在性**。故 T1 缩为**窄门禁 `visual_diff_text_missing`**：pixel_1to1 P0 pass 屏声明锚点文本（ui-spec text 节点，≥2字、≥3个）**整块缺失**（缺失比例≥50%）→ missing-render BLOCKER，吸收 OCR 掉字 FP。位置/样式/图标类假 PASS 改由 T2 兜。实现于 visual-diff-ocr-gates.ts `collectGrossMissingAnchorText` + visual-diff-check 接入（含 ocrUnavailable 降级 WARN）。单测 6。unit 1264/fixtures 35/typecheck 绿。用户 2026-06-29 拍板：T1 缩窄 + T2 升主背靠。
    status: completed
  - id: T2-pixel1to1-p0-human-confirm-backstop
    content: >
      【P1 · 决策①第一阶段兜底】pixel_1to1 的 P0 屏在 headless 下不得仅凭 VL 自报 pass 闭环——须真人确认或 HALT。
      病灶：本次 6 阶段全 PASS/COMPLETED，card_pack/add_card 仅凭 agent 自报 0.98 就放行，无人看过。
      改造：**复用既有 halt-confirm / §9 保守默认流**（与 deferrals / crop 同模式，无新 goal-runner 机制）：pixel_1to1 P0 屏 verdict=pass 且无真人署名确认 → headless 触发 HALT 求人确认（交互态 stop-and-ask），保守默认=不自动确认→该屏不得作为视觉 PASS 闭环。署名判据复用 [fidelity-shared `requireExplicitSigner` / isCropHumanConfirmed](../../harness/scripts/utils/fidelity-shared.ts) 同款，禁 goal-mode-auto 自签充人签。**与 T1 互补**：T1 能确定性抓住的崩坏直接 BLOCKER 不必等人；T2 兜住 T1 阈值之下、肉眼仍可疑的灰区。
      边界：仅 pixel_1to1 ∧ P0；非 pixel_1to1 不强制人确认（占位/语义档合法）。两模式统一（交互态可当场确认，headless 走 HALT）。
      触点：fidelity-governance-check.ts / fidelity-shared.ts（署名判据）、visual-diff-check.ts（pass 屏人确认门）、device-testing SKILL「pixel_1to1 P0 人确认」、harness/tests/unit。
      【已完成 2026-06-29 · 升为主背靠】两次实测证伪客观度量后，T2 从"灰区兜底"升为 fake-pass 主背靠（用户拍板）。fidelity-shared 新增 `isHumanConfirmed(confirmedBy)`（非空且非 AUTOMATION_SIGNER_IDS，复用 isAutomationSigner）；VisualDiffScreenEntry 加 `confirmed_by`（+ validateVisualDiffJson 校验须字符串）；visual-diff-check：**pixel_1to1 下每个 P0 pass 屏须 confirmed_by 真人署名**，缺/自签 → `visual_diff_human_confirm_required` BLOCKER（headless 经 goal-runner HALT 求人，交互态 agent 当场 stop-and-ask 置 confirmed_by 重判；goal-mode-auto 等不算）。device-testing SKILL step6 写入 T2 主背靠规则。集成单测 visual_diff_t2_human_confirm_required（缺/自签→FAIL、真人→放行 三态）。**即 pixel_1to1 屏无法全自动闭环、必须有人过目——最严档应有之义。** unit 1264/fixtures 35/typecheck 绿。
    status: completed
  - id: T3-lightweight-p0-not-exempt
    content: >
      【P1 · 决策②靶屏直接受益】P0 屏即使 lightweight 也不得被排除采集/静默 skipped 放行。
      病灶：home_no_card P0+lightweight → collectP0CaptureTargets `!s.lightweight` 排除 → verdict=skipped、从未评估；恰是用户抱怨最重的黑块/破图标屏。
      改造：
        (1) [visual-diff-capture.ts:120-126](../../profiles/hmos-app/harness/visual-diff-capture.ts:120) collectP0CaptureTargets：P0 屏一律纳入采集目标（lightweight 不再作为排除依据；lightweight 仅可降低非 P0 屏优先级，不得让 P0 逃采）。
        (2) [visual-diff-check.ts P0 覆盖](../../profiles/hmos-app/harness/visual-diff-check.ts:580) ：**`pixel_1to1 + new_or_changed + P0` 屏 verdict=skipped 直接 BLOCKER**（不再静默通过；must-review 仅作 goal-report 高亮，不替代门禁失败）；若该屏状态不可达（如 home_no_card "mock 预填卡导致无卡态不可达"）→ 产出 must_fix「P0 状态不可达，须可导航到该态后重采」而非 skip 放行。非 pixel_1to1 时 skipped 才走 must-review/WARN。
        (3) device-testing SKILL：明确"P0 屏无论 lightweight 都须被真机评估；状态不可达是缺陷不是豁免理由"。
      边界：非 P0 的 lightweight 仍可轻量处理。两模式统一。
      触点：visual-diff-capture.ts、visual-diff-check.ts、visual-diff-targets.ts、device-testing SKILL、harness/tests/unit。
      【已完成 2026-06-29】visual-diff-targets.ts 新增 `isP0VisualTargetScreen`（P0 一律 target，lightweight 不豁免），collectP0ScreenIds/collectP0OverlayTargetIds/collectP0CaptureTargets 统一改用之；check 层既有 p0Uncovered（new_or_changed + skipped → BLOCKER）随之对 lightweight P0 自动生效。device-testing SKILL Step 4.6 写入规则。新增单测 visual-diff-p0-coverage.unit.test.ts（5/5）。typecheck/unit(1222)/fixtures(35) 全绿。**spec 侧 P0≠lightweight 矛盾守卫未做**（留 T2/后续：ui-spec-gate 仍按 lightweight 跳过 P0 人确认证据）。
    status: completed
  - id: T4-warn-floor-tighten-and-actionable-mustfix
    content: >
      【P1 · 堵压线逃逸 + 给 loop 可执行信号（接 RC5/RC6）】warn 屏地板对 pixel_1to1 P0 收紧，且 warn 必须产出结构化 must_fix 进 coding 回修。
      病灶：FINALIZED_MIN_FIDELITY=0.45 让 0.48/0.52 压线逃逸；warn 不产 must_fix → loop 不知改哪 → 瞎挪卡包描述。
      改造：
        (1) pixel_1to1 P0 屏的灾难地板与 pass 阈值拉齐档（候选：复核 0.45→提高，或改为"warn 屏 pixel_1to1 P0 必须带非空 must_fix，否则视为低分无依据 ratchet"——后者更稳，避免纯调数）。沿用既有 `fidelityRatchetFailOrWarn`。
        (2) **warn/fail 屏强制可执行 must_fix**：每条 must_fix 须可定位（关联 T1(2) 的区域散度 bbox 或声明元素 id）+ 可执行（"卡包描述应在卡夹插画下方而非上方"级别），而非"整体差异大"。device-testing VL rubric 强制；缺则 ratchet。
        (3) must_fix 回灌 coding：确认 warn/fail 屏的 must_fix 进入下一轮 coding 输入（loop 闭环），与 T6 熔断配合（连续 N 轮 must_fix 未消解 → HALT）。
      边界：只对 pixel_1to1 P0 收紧地板，避免误伤一般残差。两模式统一。
      触点：visual-diff-check.ts（地板/ must_fix 非空校验）、device-testing SKILL（must_fix 可执行 rubric）、coding 回灌链路、harness/tests/unit。
      【已完成 2026-06-29，含 review#1 收紧】visual-diff-check.ts 新增导出 `collectWarnP0NoActionable`（pixel_1to1 P0 warn 屏 **must_fix 空** → ratchet BLOCKER；id=visual_diff_warn_no_actionable）。**review#1 关键收紧**：原判据用 must_fix∨defects∨reverse_missing 非空，但真正回灌 coding 的回修通道是 **must_fix**——defects/reverse_missing 只是证据非指令（`defects:[{note}]` 不能告诉 coding 改哪）。故改为**只认 must_fix 非空**：warn 须给可执行 must_fix，残差可接受则判 pass+minor defect。与灾难地板(0.45)互补抓"压线 warn 无 must_fix"（home_with_card 0.52/manage_non_local 0.48）。(2) SKILL Step 4.6 step5 加 must_fix 可执行可定位 rubric、step6 BLOCKER 清单加该门禁。(3) must_fix 回灌经 T6 retry-context 喂 coding。单测 visual-defect-enum +5（含 review#1 翻转用例：仅 defects/reverse_missing 而 must_fix 空 → 仍命中）。**改既有 fixture**：visual_diff 0.7 用例改为 verdict=warn 无 must_fix，断言"0.7>0.45 不触发灾难地板、但经 T4 零指令门禁 FAIL"（验证两机制独立）。unit 1238 / fixtures 35 / typecheck 全绿。
    status: completed
  - id: T5-screen-identity-and-out-of-bounds-element-gate
    content: >
      【P1 · 确定性可查、不依赖 VL】子页越界元素 + 屏身份硬门禁。
      病灶：card_pack/add_card 渲染出本应只属首页的底部「首页/我的」Tab（全局泄漏），确定性可查却无门禁。
      **【评审P1 收紧·必读】不得用"root≠navigation_frame@0"识别子页**：实测 card_pack / add_card 的 root 也是 `type: navigation_frame, order: 0`（[ui-spec.yaml](../../../SimulatedWalletForHmos/doc/features/homepage/spec/ui-spec.yaml)，与 home 同型；manage_non_local 才是 overlay_panel）——靠 root 类型猜，这两屏会被当顶层、识别不出 Tab 泄漏。**必须改成声明式归属，不是启发式。**
      改造：
        (1) **ui-spec 引入显式 `screen_scope` / `allowed_global_elements` / element ownership**：全局元素（tab_home/tab_mine 等底部 Tab）声明其**所属屏集合**（仅 home）；某屏渲染出不属于它的全局元素 → `visual_diff_out_of_bounds_element` 越界门禁，pixel_1to1 BLOCKER / 否则 WARN。判据＝声明归属（SSOT）+ 截图 OCR 命中该越界元素文本于底部 band，**不靠 root 类型猜、不纯靠 VL 自觉**。**【已实测可行 2026-06-29】** 复用 T1 的 OCR 能力：card_pack 设备图 OCR 干净读出"首页"@y≈1921 / "我的"@y≈1920（底部 band）= 泄漏 tab 的确定性证据；mine 同位置则合法（home scope）。即"非 home-scope 屏底部 band 同时出现『首页』+『我的』→ 越界"。
        (2) 屏身份断言固化（接 b4e9d1c7 的 E3，补确定性侧）：截图须命中该屏 must_have_elements 锚点，不符=captured wrong screen / fail。
      边界：元素归属以 ui-spec 新字段为 SSOT；ui-spec 未声明归属时降 WARN 提示补声明（不得静默放行越界）。两模式统一。**硬门禁=pixel_1to1 BLOCKER，非温和提醒。**
      【已完成 2026-06-29】ui-spec-shared.ts 新增 `UiSpecGlobalElement`{id,texts[],owner_screen_ids[],band?} + UiSpecDoc.global_elements；ui-spec.schema.json + ui-spec-schema-validate.ts 放行并校验该字段。新增 visual-diff-ocr-gates.ts `collectOutOfBoundsGlobalElements`（OCR 注入可测、按屏缓存、texts 须全部命中于 band、OCR 失败不误报）；visual-diff-check.ts 接入为 `visual_diff_out_of_bounds_element`（pixel_1to1 BLOCKER/否则 WARN，仅 global_elements 声明+OCR 可用时实跑）。SKILL：device-testing step6 BLOCKER 清单 + spec/reference/ui-spec.md 新增 global_elements 字段文档+示例。单测 visual-diff-ocr-gates 8（逻辑7 注入 OCR + 1 真 OCR 集成：真实 card_pack fixture 经真 OCR 判越界端到端）。**review 补漏**：OCR 不可用/失败原会静默放过（违背"降 WARN 不 SKIP"设计意图）→ 改 collectOutOfBoundsGlobalElements 返回 `{violations, ocrUnavailable}`，非属主屏 OCR 失败进 ocrUnavailable，check 层出 `visual_diff_out_of_bounds_degraded` WARN（不静默）；测试相应改"失败有降级信号"。unit 1256 / fixtures 35 / typecheck 全绿。**判据靠声明式归属，不靠 root 类型（实测子页 root 也是 navigation_frame@0）。**
    status: completed
      触点：visual-diff-check.ts（越界判据，复用 collectAllComponentNodes / must_have_elements）、ui-spec-shared.ts（元素归属/全局元素标注若缺）、device-testing SKILL、harness/tests/unit。
    status: pending
  - id: T6-goalmode-circuit-breaker-and-budget-split
    content: >
      【P1 · 决策③ 回应"testing 3 次 / 177 分钟空转"】goal-mode 视觉无改善即熔断求人 + 工具链/视觉预算分流。
      病灶（实测 [progress.md](../../../SimulatedWalletForHmos/doc/features/homepage/goal-runs/20260629T085254Z/progress.md)）：testing **3 attempts / 177m** 最终 PASS、ut 2 attempts；goal-runner 有 retry/budget（[:1254 classifyFailureKind](../../harness/scripts/goal-runner.ts:1254) / [:1266-1392](../../harness/scripts/goal-runner.ts:1266) max_retries_per_phase / checkRunBudget），但①无"视觉无改善/同类门禁反复失败→HALT 求人"熔断；②工具链失败与视觉差距失败共用预算。
      **【评审P1 收紧·必读】只在 retry 层看现有 `failure_kind` 不够**：实测 testing 两次 timeout/FAIL 都被 [classifyFailureKind](../../harness/scripts/goal-runner.ts:1254) 归成 `code_regression`（[:461 priorFailureKind==='code_regression' 分支](../../harness/scripts/goal-runner.ts:461)），没区分工具链/采集/视觉差距。**必须同步改 summary/check-id → failure_kind 的映射口径**（classifyFailureKind + summary.blocking_class/failure_kind [:301-309](../../harness/scripts/goal-runner.ts:301)），否则分流仍按错分类走。
      改造：
        (1) **失败分类口径修正（承重·前置）**：把 check 结果的 result id/severity 映射到**互斥 bucket**——至少 `toolchain`（device_test.build/install/run/hylyre ensure）、`capture`（visual_diff_capture / IO / Permission denied）、`visual_gap`（visual_diff* / layout_divergence / 越界 / must_fix）、`code_regression`（其余编译/UT/逻辑回归）。改 classifyFailureKind + summary 写入口径，不再把 testing 失败一律塞 code_regression。
        (2) **熔断**：跨 retry 跟踪 testing 的视觉信号（每屏 fidelity / 未消解 must_fix 数 / 同一 check id 反复 FAIL）。连续 N 轮（默认 N=2，可配）无改善或同类门禁反复失败 → 不再无脑 retry，HALT 并汇报"卡在哪、改了什么没改什么"（复用既有 HALT/§9 + Prior-attempt-failure 证据回喂 [:1080-1082](../../harness/scripts/goal-runner.ts:1080)）。
        (3) **预算分流**：按 (1) 的 bucket 分别计数/计预算——`toolchain`/`capture` 反复失败 → 早 HALT 求人修环境，不吃 `visual_gap` 的迭代轮次。
      边界：不改全局 resolveVerdictFromChecks；熔断/分流是 goal-runner 的 retry 决策 + 分类口径增强。普通模式无 retry-loop，但其 HALT/求人交互与 goal 对齐（能力拉齐）。
      触点：harness/scripts/goal-runner.ts（classifyFailureKind :1254 / 映射 :301-309 / retry 决策 :1266-1392 / 预算 :1050-1066 / 证据回喂 :1080）、summary 写入侧 failure_kind/blocking_class、goal manifest budget 字段、harness/tests/unit（**失败分类回归** + 熔断/分流单测）。
      【已完成 2026-06-29，含 review#2 收紧】goal-failure-classifier.ts：FailureKind 扩 toolchain/capture/visual_gap；`SIGNATURE_HALT_KINDS` 纳入四类，`shouldHaltNoProgress` 对 toolchain/capture（纯 signature 重复即 halt=不吃视觉预算）与 visual_gap（同门禁 signature 重复=无改善→熔断；signature 变化=有进展则继续）生效；code_regression 仍永不 guard-halt。goal-runner：retry-context prompt 加 toolchain/capture（基建失败勿改码）与 visual_gap（按 must_fix/越界精修、勿瞎挪布局）分支；haltReason 分流。**review#2 关键收紧**：原 `TOOLCHAIN_BLOCKER_PREFIXES` 含 `device_test_` 前缀，把 device_test_run 一律归 toolchain——但它覆盖派生缺失/真机崩溃/用例失败/trace blocked 多因，用例失败本该归 code_regression（改码可重试），误归 toolchain 会提示"勿改码先查环境"+触发 infra 熔断。改：prefix 窄化为确切 build/install + hylyre/hvigor；新增 `hasToolchainBlockingClass`，check-testing.ts 仅在 device_test_run **`!run.ok` 崩溃路径**打 `blocking_class:'device_toolchain'`→归 toolchain，**用例失败路径不打→code_regression**。单测 goal-headless-guard +11（分类含 device_test_run 崩溃vs用例失败区分 + halt）。**review#3 端到端补漏（关键）**：原修复只在单测手构 summary 有效，真实链路 `writeRunSummary` 的 blockers[] 映射漏传 `blocking_class`、且 types.ts/summary.schema.json 的 blocker 不允许该字段（additionalProperties:false）→ device_toolchain 标签在真跑中丢、device_test_run 崩溃仍误落 code_regression。修：blocker 映射抽至可测纯函数 `scripts/utils/summary-blockers.ts buildSummaryBlockers`（保真传 blocking_class）+ types.ts blocker 加 blocking_class + summary.schema.json blocker $def 放行 + 链路测试（CheckResult.blocking_class → buildSummaryBlockers → summary.blockers[] → classifyFailureKind=toolchain；用例失败无标→code_regression）+ summary-schema sample 带 blocking_class。**设计取舍**：熔断用"同门禁 signature 重复"判无改善，max_retries_per_phase 兜底。unit 1240 / fixtures 35 / typecheck 全绿。
    status: completed
  - id: T7-vl-per-element-bbox-evidence-chain
    content: >
      【P2 · 决策①第二阶段】VL 逐元素 bbox 证据 + 与客观区域散度逐区交叉核对，进一步压缩 VL 自报空间。
      病灶：VL 当前可只填一个总分+verdict 就过；无逐元素证据 → 无法事后审计"它到底看没看 card_pack 的图标/Tab"。
      改造：
        (1) pixel_1to1 P0 屏 verdict=pass 须逐声明元素给出 bbox + 命中证据（在截图中的位置/状态），缺证据元素视为未核对 → ratchet。
        (2) **逐区交叉**：VL 声称"某区一致"但 T1(2) 客观区域散度在该区超阈 → 标背离、要求复核或降级（把 T1 的客观信号与 VL 的主观声明在区域粒度对账，而非整屏一个数）。
        (3) （可选增强）VL 产出标注 overlay 图归档，供人/回归审计。
      边界：P2 在 P1 止血落地并经 homepage 回归验证后启动；依赖 T1(2) 的区域散度坐标网格。
      触点：device-testing SKILL（逐元素 bbox rubric）、visual-diff-check.ts（逐区交叉 + 证据完整性）、visual-diff schema（defects/evidence 字段若需扩）、harness/tests/unit。
    status: pending
  - id: exit-regression-and-tests
    content: >
      【出口 · 可证伪 + FP 校准 + 全单测】
        (1) **回归夹具（坏态须 BLOCKER）**：以本次 homepage 2026-06-29 真实坏态构造 fixture——card_pack/add_card verdict=pass + f0.98 + floor0.99 + defects:[]（VL 假高分）、home_no_card P0+lightweight skipped、card_pack/add_card 渲染底部 Tab（越界）、home_with_card f0.52 / manage_non_local f0.48 warn 压线、5 屏无 must_fix → 加固后框架须判 BLOCKER（现状 PASS，可证伪）。
        (2) **FP 校准（承重、宁可漏报不可恒误报）**：T1 阈值须用"修好的 home / 忠实真机渲染"反向验证不恒误报——对齐 [image-toolkit.ts:245-254 EDGE_SENTINEL 校准注记](../../profiles/hmos-app/harness/image-toolkit.ts:245)（真机干净样本此前不存在的历史欠账）；拿修好后的真态截图重跑 T1，若误报则回调阈值后再定稿。fixture 须同时含"忠实渲染须仍 PASS"的正样本。
        (3) 全部新字段/门禁/熔断补 harness 单测 + fixture，注册 [run-unit.ts](../../harness/tests/run-unit.ts)，`cd harness && npm test` 全 PASS（AGENTS.md BLOCKER）。
        (4) A/B/C 诚实天花板与"独立布局硬门禁止于一眼同页、像素级归 G5 可选"写入 spec/coding/device-testing SKILL，与历史 plan 一致不重复造文档（合并进既有 SKILL 段落）。
      **【评审追加·三条硬验收（任一不满足即本 plan 未达标）】**
        A1. **card_pack/add_card 的真实坏态必须在单测 fixture 中 BLOCKER**——不得只测合成 edge tiles；fixture 直接喂这两屏的真实 visual-diff.json 条目（pass/0.98/defects:[]）+ 对应截图，断言加固后 `visual_diff_layout_divergence` BLOCKER。这是防"T1 做成温和提醒、真实假 pass 仍漏"的硬证伪。
        A2. **T5 必须靠声明式 `screen_scope`/`allowed_global_elements` 抓住底部 Tab 泄漏**——fixture 断言 card_pack/add_card 出现 tab_home/tab_mine 即越界 BLOCKER；不得依赖 root 类型启发式（已证伪：两屏皆 navigation_frame@0）。
        A3. **T6 失败分类回归**——单测断言 timeout / `visual_diff_capture` / `visual_diff_layout_divergence` / 工具链失败落入**互斥 bucket**（不再一律 code_regression），并验证"工具链反复失败不吃视觉预算 + 视觉无改善 N 轮 HALT"。
      触点：harness/tests/fixtures、harness/tests/unit、run-unit.ts、相关 SKILL.md。
    status: pending
isProject: false
---

# 视觉裁判可信化 · 独立布局硬门禁 / VL 证据链 / loop 熔断（framework-only，窗口 2.4.0，不 bump 版本）

> 版本绑定 `version: 2.4.0`（与 `package.json.version` 一致，未发布窗口）。改动均属发布内容（`harness/` `profiles/` `skills/` `specs/`），完成后 `cd harness && npm test` 必须全 PASS（AGENTS.md BLOCKER）。
> 靶子：`SimulatedWalletForHmos/doc/features/homepage` 2026-06-29 第三轮真实失败 run（[goal-runs/20260629T085254Z](../../../SimulatedWalletForHmos/doc/features/homepage/goal-runs/20260629T085254Z)，testing PASS / COMPLETED 但 card_pack/add_card 与参考图差天共地）。
> 与 [b4e9d1c7 首页素材物化断桥根治](首页素材物化断桥根治_占位冒充门禁与warn屏下限_b4e9d1c7.plan.md)（已 completed，修占位色块/采集新鲜度/warn 地板 0.45）正交互补：那轮把素材物化好，本轮堵"VL 假高分"这个更底层的洞。

> **评审收口（v2，已逐条对 ground-truth 复核后折叠）**：外部评审判"方向对、能打到根因，但 T1/T5/T6 须收紧验收语义，否则实现时又变成'看起来加了门禁、真实坏态仍漏'"。三条 P0/P1 已核实并收紧——① T1 不得只升级 edge sentinel（card_pack/add_card 超阈 tile 各仅 2 < 门槛 5，实测），区域散度+文本框位置改为承重；② T5 不得用 root 类型猜子页（card_pack/add_card 实测皆 navigation_frame@0），改声明式 `screen_scope`/`allowed_global_elements`；③ T6 不能只在 retry 层看 failure_kind（testing 失败实测被一律归 code_regression），须改 classifyFailureKind 映射口径成互斥 bucket。新增出口 A1/A2/A3 三条硬验收防"温和提醒化"。

## 一、北极星与验收门

**仅凭截图**，pixel_1to1 的 P0 屏，**当 agent/VL 给出与肉眼明显不符的高分时，framework 有独立的确定性机制把它判 BLOCKER**——不再"自洽的谎"畅通无阻；warn 屏产出**可执行 must_fix** 让 loop 精准回修而非瞎猜；P0 屏不因 lightweight 逃过评估；子页越界元素（泄漏全局 Tab）被确定性门禁抓住；goal-mode 在视觉无改善/工具链反复失败时**主动 HALT 求人**而非烧满 60 分钟。

- **硬指标**：本次 homepage 坏态喂回 → **判 BLOCKER**（现状 PASS，可证伪）。
- **诚实边界**：独立布局硬门禁止于"一眼判同页/抓崩坏"，**非像素级**；像素级几何归可选高保真通道（G5）。FP 校准是承重——修好的真态/忠实渲染须仍 PASS，宁可漏报不可恒误报。

## 二、命门复盘（每刀钉在证据上）

见 frontmatter `overview` 1–8 条（均已对 ground-truth 实测、附行号）。一句话：**裁判=VL 自报，唯一能 gate 的客观背靠布局盲，唯一布局敏感的客观指标被禁 gate → 假高分无人能否决。**

## 三、五环现状量化（本次 run，对比 06-28）

| 环 | 06-28 | 06-29 | 说明 |
|---|---|---|---|
| ①捕获(采集) | 失败 preserved | **OK** | b4e9d1c7 修好采集新鲜度，本轮截图是真的新图 |
| ②转译(coding) | 色块 | 部分改善/部分更差 | 卡包描述被瞎挪到上方（无 must_fix 信号所致） |
| ③资产 | 全占位 70B | 部分物化 | b4e9d1c7 物化桥+占位门禁见效 |
| ④验证(裁判) | 全 warn 0.1 | **假 pass 0.98（核心病灶）** | 素材物化后分上去，VL 假高分暴露 |
| ⑤治理(loop) | — | **3 轮 60 分钟空转** | 无 must_fix/无熔断/工具链吃预算 |

## 四、决策（用户 2026-06-29 拍板）

1. **裁判可信路径 = 两者都做、分阶段**：P1 先上独立布局硬门禁(T1)+pixel_1to1 P0 人确认兜底(T2)堵谎；P2 补 VL 逐元素 bbox 证据链(T7)。
2. **范围 = 纯 framework 机制 + homepage 当可证伪回归靶**：只改 `harness/`/`profiles/`/`skills/`/`specs/`，不碰宿主业务码；homepage 坏态做 fixture。
3. **loop 失败处置 = 视觉无改善 N 轮即 HALT 求人 + 工具链/视觉预算分流**（T6）。

## 五、切法（自下而上，前置决定后置）

- **T1 独立布局硬门禁**（核心承重墙）：补上"能否决 VL 假高分"的客观确定性机制——8 份历史 plan 一致 punt 的洞。分层：背离硬门禁(低 FP) ← 区域散度(可 gate 候选) ← 文本框位置核对(强证据)。
- **T2 pixel_1to1 P0 人确认兜底**：T1 阈值之下的灰区，headless 不得仅凭 VL 自报 pass 闭环，复用 halt-confirm。
- **T3 lightweight P0 不豁免**：让用户抱怨最重的 home 屏进入评估。
- **T4 warn 收紧 + 可执行 must_fix**：堵压线逃逸，给 loop"改哪"的信号。
- **T5 屏身份/越界元素门禁**：确定性抓泄漏 Tab，不依赖 VL。
- **T6 goal-mode 熔断 + 预算分流**：回应"3 轮浪费 60 分钟"。
- **T7 VL 逐元素 bbox 证据链**（P2）：压缩 VL 自报空间，与 T1 区域散度逐区对账。

## 六、A/B/C 诚实天花板（沿用历史 plan，写入 SKILL，不重复造文档）

- **A 结构/颜色/布局关系/文案/越界元素**：本 plan 主战场，独立硬门禁可做到"一眼判同页/抓崩坏"；**精确像素级非承诺**。
- **B 美术资产**：screenshot-only 物理不可达 → 诚实拦截/占位（b4e9d1c7 已落地）。
- **C 动效/交互**：静态截图不含，不纳入。

## 七、出口

- 回归夹具：homepage 2026-06-29 坏态喂回 → 判 BLOCKER；忠实渲染正样本须仍 PASS（FP 校准承重）。
- 全部新门禁/熔断补 harness 单测 + fixture，注册 run-unit.ts，`cd harness && npm test` 全 PASS。
- A/B/C 边界合并写入既有 spec/coding/device-testing SKILL。

## 八、明确不做

- 不在 maison 内置 headless 浏览器/渲染器；不 AI 生成/山寨缺失美术资产。
- 不把像素级几何/高保真打通设为达标必选（G5 可选）。
- 不改 simulatedWallet 业务代码；不 bump 版本、不新建发布说明（framework-only）。
- 不动全局 `resolveVerdictFromChecks`（跨阶段共用、爆炸半径大）——靠 check 层 BLOCKER 挂阶段。
- T1 不假装一步做到像素级判别；阈值未经修好-home 反向 FP 校准前不定稿（宁可漏报不可恒误报）。

## 九、实现期纪律

- 所有"触点"行号为探索期快照，实现前须**重新核对 ground-truth**（代码会漂移），分清真 bug / 旧视图 / 早熟建议（[verify-review-claims-maison]）。
- 改进合并回既有文件，不擅自新建平行文件（[merge-not-new-files]）；情况不对先问。
- 新门禁/熔断默认 **goal 与普通模式两侧统一覆盖**（[goal-and-normal-mode-capability-parity]）。
