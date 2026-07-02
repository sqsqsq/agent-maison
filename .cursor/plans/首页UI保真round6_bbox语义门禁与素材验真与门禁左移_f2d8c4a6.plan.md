---
name: 首页UI保真round6 — bbox 坐标语义门禁(P0) / 裁剪产物验真(P0) / 授权≠验真拆分(P0) / spec 完整性外部对照(P0) / coding 文案白名单+parity 升门禁(P1) / review 视觉维度(P1) / device 回环断流归因+可执行must_fix(P1)
version: 2.5.0
deferred_to: 2.5.0
overview: >
  现象（用户回灌 2026-07-02，"6-第五轮优化" vs "0-原始需求"，宿主 SimulatedWalletForHmos goal-run 20260702T061511Z）：
  round5 素材整段化根治（e5b1c2a0，已 completed）落地后，素材确实原子化了（asset-manifest 23 项原子 key），
  但四页 UI 仍大面积崩坏——首页右上按钮/宫格/消息中心/底 tab 图标全是"整屏竖切条"废图、卡包文案跑到页首、
  添加管理卡片按钮全宽错色；我的页凭空多出「金融信息/设置与帮助」两个标题；卡包/添加卡片页副标题该右置的全都题下堆叠、
  行卡分组与原图不符。goal-run 前 5 阶段全 PASS，唯一能发现问题的 device-testing 卡 attempt3、6 屏 verdict 全 pending。
  根因（已逐项 ground-truth 核实，证据见 §二）：
    RC1 bbox 坐标语义转置无门禁：framework SSOT=[x,y,w,h]（image-jimp-worker.cjs:5、ui-spec.md:81），
        但 spec VL 实际吐的是 [y,x,h,w]（"钱包"标题 [0.05,0.05,0.04,0.12]、ill_card_pack_guide [0.12,0.04,0.18,0.92]
        → 裁成 204×2938 竖条，0.18×1084≈195 / 0.92×3110≈2861 完全吻合）。一个转置同时污染素材裁剪、token 采色、
        布局 ground truth 三条线。通用 VLM 徒手报坐标不可靠是业界公认结论（GPT-4V grounding 失准、OmniParser/SoM 即为此而生），
        而我们既无坐标语义校验，又把 VL 坐标当 SSOT 直接消费。
    RC2 裁剪产物零验真：asset-acquisition.ts 裁完即过——204×2938 的"图标"、纯蓝 icon_header_watch、空白 icon_category_transit
        畅通无阻物化进模块 media；无长宽比/尺寸/纯色 sanity，无 VL 独立辨认，无贴回对照确认图。
    RC3 user_requirement 授权语义过宽：isCropHumanConfirmed 对 crop_confirmed_by=user_requirement 恒通过（asset-acquisition.ts:35），
        SKILL.md Step2.1 明确教 agent"用户说过可从截图裁→全量置 human_crop_confirmed:true"。设计意图是"授权裁剪"，
        实际效果是"23 个 bbox 全部免验真"——pixel_1to1 P0 人确认门禁（a3f1c920 主背靠）被一句话整体绕过。
    RC4 spec 完整性自我循环：fidelity_capture_governance PASS 的依据是"capture_completeness 100%（62/62 ref-elements）"，
        分母是 agent 自己抽的清单而非原图真实内容。添加卡片页 5 条右置副标题（"双击电源键便捷支付"等）、
        我的页 ¥119.40/眼睛图标/横幅副文案/去优化、卡包"5"角标全部漏抽；分组容器（原图添加卡片页 5 行同卡）、
        同行关系（卡包副标题右置）、底部浮动胶囊 tab 容器均未建模（schema 有 layout_group/align/width_ratio/children 但 spec 平铺没用）。
    RC5 coding 消费无一致性硬门禁：coding 拿到了 context-images 原图与 ui-spec，但 (a) 可见文案无白名单——把 ref-elements
        的 zone 名 finance/settings 脑补成可见标题「金融信息/设置与帮助」；(b) 副标题位置无声明→按惯用"题下"模式排；
        (c) visual_parity_render 其实抓到了"按钮声明 width_ratio=0.28 却源码全宽"，但被标"低置信 WARN、以 device visual-diff 为准"
        ——正确的上游信号被降级，等 device 兜底。
    RC6 review 阶段零视觉维度：review-report.md 只查架构/契约/规范/逻辑/数据五维，不开素材文件、不对 ui-spec、
        不看参考图；废图+乱布局下"有条件通过"。
    RC7 唯一真裁判后置且脆弱【纠偏 2026-07-02·codex 指出并已核实】：pending 阻断本身有效——goal-report 终态 HALTED、
        testing verdict=FAIL、visual_diff BLOCKER 明确"所有屏 verdict=pending…不得作为视觉保真 PASS"（初稿"pending 不拦"
        写自 08:21 的 RUNNING 中途快照，终态 08:52 已正确拦截）。真问题四点：(a) 它是全链路唯一能发现视觉问题的环节且在最后，
        上游 5 阶段 PASS 的假信心已铸成；(b) headless API 断连（agent-output.log 仅 312B 重试日志）致 VL 判定 3 attempt
        烧 2h+ wall-clock 才 halt，断流未被快速归因（衔接 b8f36a12）；(c) halt 产出 must_fix=0，loop 拿不到"改哪"的可执行信号；
        (d) 像素 score_floor 已被历史实测证伪（本次 card_pack=0.999：UI 全错像素分近满分）仍是唯一数值信号。
  方向（业界实践对照，见 §三）：坐标只能来自确定性算法（OCR/CV 提议 + VL 选择，OmniParser/Set-of-Marks 思路）；
  裁剪授权与 bbox 验真解耦；spec 完整性以原图 OCR 全文清单为外部分母；门禁全链路左移（Design2Code 的
  Text/Block-Match/Position 类确定性度量替代像素直方图）；device 回环断流快速归因 + halt 附可执行 must_fix
  （pending 阻断已存在且本轮已生效，非新增项）。
  约束：framework-only 不碰宿主业务码；版本跟随 2.4.0 未发布窗口不 bump；新门禁 goal/普通模式统一覆盖；
  出口用本次 homepage 真实坏态做回归夹具（转置 ui-spec / 204×2938 crop / 脑补标题 / 按钮全宽），坏态须 FAIL、
  忠实样本须 PASS（FP 校准承重，宁可漏报不可恒误报）。待 review 后动手。
  用户 2026-07-02 决策：①素材供给=**混合（无需外部资产包，框架自愈）**——标准语义图标优先**语义映射 HarmonyOS 系统符号库**（干净矢量、语义对），
  品牌 logo/插画走"修正转置(P0-A)+裁后验真(P0-B)"crop（见 P0-E）。②范围=**三轨全包**（Track A 素材正本清源=P0-A/B/C/E；
  Track B 布局文案上游门禁=P0-D/P1-A/B；Track C 裁决回环=P1-C）。
  【纠偏·ground-truth 核实 2026-07-02】"回退 round5 P0-B 对 sys.symbol 的硬禁"这一表述**不成立**：round5 门禁
  `visual_parity_icon_substitution` 从未硬禁 sys.symbol——它只拦"声明 brand_logo/illustration 却用 sys.symbol **静默替代**"，
  且 suggestion 原文即给出合法出口"确需系统单色图标则声明 icon.kind=system_symbol"（coding-visual-parity-check.ts:255-274）。
  真正把 23 个图标全推向 crop 的是 **spec 侧图标分型规则**（ui-spec.md:84"图标分型（P0-B·命门）"：彩色/品牌图标——并点名
  银行卡/交通卡/门禁/证件/宫格/底 tab——一律声明 brand_logo|illustration+原子裁图；SKILL.md:171 同向）。故 P0-E 的落点是
  **收窄 spec 分型规则**（"彩色即 brand_logo"→"有品牌识别度才 brand_logo"），coding 门禁**保留原样**——拆掉它会让
  Huawei Card/云闪付等真品牌 logo 被 sys.symbol 冒充而无人拦截，round4"☎ 冒充管理非本机卡片"即会回归。
  【外部评审采纳 2026-07-02·cursor/codex 意见已逐条 ground-truth 核实】RC1-RC7 双评审独立复核成立。采纳八项：
  ①执行分批降爆炸半径（§七：夹具+OCR spike 先行 → Track A 素材线 → 宿主 checkpoint → Track B → Track C，
  plan 范围仍三轨全包不变）；②P0-A 增第一层零依赖 orientation 预检（横排多字文本 w<h 系统性出现即拦，OCR 为增强层）；
  ③OCR spike 前置实测 6 张 mockup 识别率再定阈值（"mockup 优于设备截图"由断言改为实测）；④P0-B 验真覆盖已存在/已物化资产
  （asset-acquisition.ts:99 existsSync→continue 正是坏图已落盘仍复通过的洞）；⑤OCR 失败策略写硬（pixel_1to1 下 OCR
  不可用/低置信/覆盖不足→相关 check 不得 PASS，归 toolchain，沿 round5 visual_parity_ocr_unavailable 先例）；
  ⑥P0-E 补 allowlist 硬边界；⑦P1-B 对 pixel_1to1 P0 全覆盖非抽查；⑧RC7/P1-C 纠偏（pending 阻断已生效，
  真问题=后置+断流烧预算+无 must_fix）+ P0-D 补"声明存在≠声明正确"诚实边界。
  未采纳：cursor"Track B/C 观察后续再定"弱于用户已拍板的三轨全包——以 checkpoint 验证代替砍范围；
  codex 引用的 goal-report/testing summary 证据均已亲核属实。
  诚实补记：转置(RC1)是本轮真凶且可确定性根治——修掉转置后 crop 大多能对，故"混合"里 crop 仍是插画/品牌图的主力，
  系统符号只替代"本就是标准语义、无需品牌感"的图标（银行卡/交通卡/门禁/证件/tab）；图标"语义选得对不对"（bus≠map）
  非廉价确定性可判，归 VL/review 视觉维度(P1-B)兜，不做假的语义门禁。
todos:
  - id: diagnosis
    content: round6 全链路根因诊断（四页 16 项问题 → RC1-RC7 ground-truth 映射，证据齐）
    status: completed
  - id: p0-a-bbox-semantic-gate
    content: P0-A bbox 坐标语义确定性门禁——第一层零依赖 orientation 预检（横排多字文本节点 w<h 系统性出现→疑似转置 BLOCKER，无需 OCR）；第二层原图 OCR 词框 × 文本节点 bbox 交叉 IoU（转置 vs 原语义命中率对比+逐节点定位）；OCR 不可用/覆盖不足→不得 PASS（toolchain 归因）；前置 OCR spike 实测 6 张 mockup 识别率定阈值；schema/SKILL 补具体数字 few-shot
    status: completed
  - id: p0-b-crop-validation
    content: P0-B 裁剪产物验真门禁 asset_crop_validation——确定性 sanity（icon 长宽比/面积占比/纯色方差/条状塌缩）+ VL 独立辨认（隔离调用，答案与 purpose 模糊匹配）+ 贴回对照 contact-sheet 证据落盘；不过→BLOCKER 入待人工确认清单；覆盖**全部** crop 资产（新裁/已存在/已物化进模块 media 一律重验，resolved_path 已存在不豁免——堵 asset-acquisition.ts:99 existsSync→continue 的坏图复通过洞）；VL 验真不可用/断流→不得静默 PASS（brand/illustration 类 halt-confirm 或 BLOCKER，sanity 只能否决坏图不能证明语义对）
    status: completed
  - id: p0-c-authorization-split
    content: P0-C user_requirement 授权语义拆分——authorization（允许裁）与 bbox_verified（框对不对）两个独立位；授权仅免"能不能裁"，绝不免 P0-B 验真；pixel_1to1 P0 验真不过仍走 halt-confirm 求人
    status: completed
  - id: p0-d-spec-completeness-external
    content: P0-D spec 完整性外部对照——原图 OCR 全文清单 ↔ ref-elements/ui-spec 文本集双向 diff，未覆盖文本逐条 disposition 才放行；capture_completeness 换真分母；pixel_1to1 P0 屏结构 lint（分组容器/同行 layout_group/subtitle 位置显式声明必填）；OCR 不可用/覆盖不足→不得 PASS（toolchain 归因）；诚实边界：结构 lint 只保"有声明"不保"声明对"（正确性归 P0-A 交叉校验/P1-B/device），门禁绿≠结构对
    status: pending
  - id: p0-e-icon-supply-hybrid
    content: >
      P0-E 图标混合供给（用户 2026-07-02 决策；机制已纠偏，见 overview 纠偏段）——**改的是 spec 侧分型规则，不动 coding 门禁**：
      (1) ui-spec.md:84「图标分型」+ SKILL.md:171 收窄："彩色/品牌图标一律 brand_logo+裁图" → "**有品牌识别度**（Huawei Card/云闪付/
      银行 logo 等）才 brand_logo+crop（须过 P0-A/P0-B）；**标准语义图标**（银行卡/交通卡/门禁/证件/车钥匙/tab 首页·我的/铃铛/加号/
      返回等）即使参考图有色，也**首选 `icon.kind=system_symbol`+`ref=sys.symbol.*`+`color_ref` 着色**（原图本就是单色调线性图标，
      着色矢量近似度高于 JPG 裁图），并在节点记 `fidelity_note` 显式承认此为受控近似"。
      (2) `visual_parity_icon_substitution` 门禁**保留原判**（声明 brand_logo 却 sys.symbol 静默替代→pixel_1to1 BLOCKER）——它是
      round4"☎ 冒充"防线，且从不误伤声明 system_symbol 的元素；仅按需微调 details 文案引导到新分型规则。
      (3) "系统符号语义选得对不对"（交通卡该 bus 非 map）不做假的确定性门禁，归 P1-B review 视觉维度 + device 回环兜；
      可在 spec 模板附常用语义映射建议表（bank_card/bus/house/key/certificate/home/person/bell/plus）降低选错率，但仅提示不 gate。
      (4) allowlist 硬边界（codex 意见采纳）：brand_logo（Huawei Card/云闪付/银行 logo 等具品牌识别度）与
      illustration/promo（卡堆插画/营销图/空态插画）**绝不可** system_symbol 替代（门禁继续拦）；可 system_symbol 的
      仅限标准语义 glyph（bell/plus/back/scan/home/person/settings/help/卡种线性图标），且逐元素在 ui-spec 显式声明 kind。
      触点：skills/feature/spec/reference/ui-spec.md:84、skills/feature/spec/SKILL.md:171、spec 模板（语义映射建议表+fidelity_note 字段）、
      harness/tests/unit（新增"标准语义图标声明 system_symbol 合法通过 / brand_logo 静默替代仍 BLOCKER / 废裁图被 P0-B 拦"用例；
      round5 既有 icon_substitution 用例应全部保持通过——门禁行为不变即回归护栏）。
    status: completed
  - id: p1-a-coding-conformance
    content: P1-A coding 一致性硬化——可见文案白名单（源码+string.json 可见字符串 ⊆ spec 文本集，脑补标题→BLOCKER）；visual_parity_render 静态可判项（width_ratio/align/variant）从低置信 WARN 升为 pixel_1to1 P0 BLOCKER，不再"以 device 为准"
    status: pending
  - id: p1-b-review-visual-dimension
    content: P1-B review 阶段补视觉维度 checklist——素材产物核验（引用 P0-B 报告）、ui-spec↔代码结构复核（pixel_1to1 P0 全覆盖非抽查：全部 must_have_elements/变更屏/P0-B 失败资产/文案 diff/结构声明；非 pixel_1to1 或 P1 屏可抽查）、可见文案 diff 复核；verifier 增加对应 check id，未执行→FAIL
    status: pending
  - id: p1-c-pending-verdict-guard
    content: P1-C device 回环提效（纠偏：pending 阻断已存在且本轮已生效，不重复造）——API 断流快速归因即时 halt，不烧满 attempt/wall-clock（衔接 b8f36a12）；halt 必须附可执行回修信号：OCR 文本块二部匹配（存在+中心偏移+同行分组，Design2Code Text/Position 对齐）产 per-element must_fix 喂回 loop，判定不依赖 VL 会话成功；score_floor 降为 reference_only 注记
    status: pending
  - id: p2-regression-fixtures
    content: P2 回归夹具固化——本次坏态（转置 ui-spec、204×2938/纯色 crop、金融信息脑补、按钮全宽）入 tests/fixtures，新门禁全部判 FAIL；正样本出处已核：fixtures/ocr 已有 mine.png/card_pack.png（a3f1c920 vendored），需补 mine 参考原图配对 + 人工修正转置后的 ui-spec 作 P0-A 正样本；执行上夹具先行（Phase 0，见 §七）
    status: pending
---

# 首页UI保真 round6 — bbox 语义门禁 · 素材验真 · 门禁左移

## 一、现象：用户 16 项问题 → 根因映射（全部 ground-truth 核实）

对照目录：`D:\1.code\对比结果\0-home-page\{0-原始需求, 6-第五轮优化}`；宿主过程：`SimulatedWalletForHmos/doc/features/homepage`。

| # | 页面 | 用户问题 | 直接病灶（已核实） | 根因 |
|---|------|---------|------------------|------|
| 1 | 首页 | 右上 3 按钮 2 个不对，仅 + 正常 | `icon_header_watch.png`=纯蓝空图、`icon_header_scan.png`=文字碎片；+ 是文本渲染所以幸免 | RC1+RC2 |
| 2 | 首页 | 卡包+集中管理…文字位置完全不对 | ui-spec bbox `[0.22,0.08,…]` 是 [y,x] 语义，被按 [x,y] 消费 → 排到页首 钱包 下方；hero 卡容器未建模 | RC1+RC4 |
| 3 | 首页 | 无卡场景中间截图完全错误 | `ill_card_pack_guide.png` 实为 204×2938 整页竖切条（bbox [0.12,0.04,0.18,0.92] 按 [x,y,w,h] 裁） | RC1+RC2 |
| 4 | 首页 | 添加管理卡片按钮位置/大小/颜色全不对 | spec 本来写了 `width_ratio:0.28, align:end, variant:tonal`，coding 写成全宽；`button.tonal.bg` 采色 bbox 同样转置采错区；**coding 门禁抓到了但只 WARN** | RC5(+RC1) |
| 5 | 首页 | 消息中心左边截图不对 | `icon_msg_bell.png` 废图 | RC1+RC2 |
| 6 | 首页 | 下方 icon 区所有图标截图都不对 | `icon_service_*.png` 全是错位裁剪（huawei_card 裁到卡堆区） | RC1+RC2 |
| 7 | 首页 | 更多服务左侧异常截图、布局奇怪 | `promo_ill_digital_finance.png` 竖切条被塞进左侧；布局 bbox 转置 | RC1+RC2 |
| 8 | 首页/我的 | 底部 首页+我的 布局样式+截图全错 | `icon_tab_*.png` 废图；原图浮动胶囊 tab 容器未建模（spec 平铺两个 tab_item） | RC1+RC2+RC4 |
| 9 | 我的 | 「金融信息」「设置与帮助」凭空出现 | 原图无此二标题；ref-elements 的 zone 名 `finance/settings` 被 coding 脑补成可见 section 标题 | RC5(+RC4) |
| 10 | 我的 | （未提但同源）缺 ¥119.40/眼睛/横幅副文案/去优化；右上邮件图标被指成铃铛 | ref-elements/ui-spec 漏抽；mine_header_msg_icon 复用 icon_msg_bell 资产 | RC4 |
| 11 | 卡包 | 添加卡片左侧截图完全不对 | `icon_add_card_plus_circle.png` 废图 | RC1+RC2 |
| 12 | 卡包 | 副标题应在选择框右侧而非题下 | 原图同行右置；spec 无 layout_group/同行关系声明，coding 按惯用"题下副标题"排 | RC4+RC5 |
| 13 | 卡包 | 管理非本机卡片左图不对、选择框高度不对 | icon 废图 + 题下副标题模式抬高行高，密度 token 无声明 | RC1+RC2+RC4 |
| 14 | 添加卡片 | 非本机卡片宽度不对 | 原图 5 行卡种在**同一张卡**内、非本机卡片独卡；spec 无分组容器 → coding 全做独卡，边距/宽度对不上 | RC4 |
| 15 | 添加卡片 | 所有栏目左侧截图都不对 | `icon_category_*.png` 全空白/错位 | RC1+RC2 |
| 16 | 添加卡片 | 所有副标题应在右侧而非题下 | 5 条副标题 **spec 里根本没有**（ref-elements 漏抽），coding 自行从图补文案+按题下排 | RC4+RC5 |

**流程侧事实**：goal-run 20260702T061511Z spec/plan/coding/review/ut 全 PASS；device-testing 3 次 attempt 后
因 6 屏 verdict=pending 被 `visual_diff` BLOCKER **正确阻断**（goal-report 终态 HALTED、testing FAIL——初稿"pending 不拦"
系中途快照误判，已纠偏），但代价是 2h+ wall-clock、`agent-output.log` 仅 312B API 断连重试日志、must_fix=0 无任何
可执行回修信号；card_pack 像素 score_floor=0.999（UI 全错仍近满分，像素度量第 N 次实证无效）。
**全链路没有任何一道在"废图/转置/脑补"发生的当时把它拦下来——唯一拦住的门在最后一环，且只能说"没判成"，说不出"哪错了"。**

## 二、七大根因与证据

| 根因 | 一句话 | 关键证据 |
|------|--------|---------|
| RC1 bbox 语义转置无门禁 | VL 吐 [y,x,h,w]，SSOT 是 [x,y,w,h]，无任何机器校验 | `image-jimp-worker.cjs:5`（SSOT 注释）；宿主 `ui-spec.yaml` 全部 bbox（"钱包" [0.05,0.05,0.04,0.12]）；204×2938=0.18/0.92 换算吻合 |
| RC2 裁剪产物零验真 | 裁完即物化，无 sanity/辨认/对照 | `asset-acquisition.ts:122-129`（crop.ok 即 pass）；spec/assets 下 4 类废图实物 |
| RC3 授权≠验真被合并 | user_requirement 恒通过=23 个 bbox 全免检 | `asset-acquisition.ts:35`；`skills/feature/spec/SKILL.md` Step2.1 |
| RC4 spec 完整性自我循环 | 62/62 的分母是自己的清单 | `spec/reports/verifier.report.md` fidelity_capture_governance；ref-elements 缺 5 副标题/¥119.40/角标5 |
| RC5 coding 无一致性硬门禁 | 脑补文案无白名单；抓到的 parity 违规被降级 WARN | `coding/reports/script-report.json` visual_parity_render WARN；static_fidelity_score 文案 exact-match 86% 仍整体 PASS、"资产覆盖 23/23"=源码引用计数（废图也算覆盖）；round5 截图「金融信息/设置与帮助」 |
| RC6 review 零视觉维度 | 五维 checklist 无一条看图 | `review/review-report.md` §二 审查方法表 |
| RC7 后置裁判脆弱（纠偏：非"不拦"） | pending 已正确阻断（HALTED/testing FAIL），但后置+断流烧 2h+/3 attempt 才 halt+must_fix=0 无回修信号+像素分误导 | `goal-report.md`(Status: HALTED、testing FAIL)；`testing/reports/summary.json`（visual_diff BLOCKER："所有屏 verdict=pending…不得作为视觉保真 PASS"）；`agent-output.log`(312B 断连重试) |

**与历史 plan 的关系**：e5b1c2a0（round5 素材整段化）解决了"整段大图双渲染"，但新的原子化裁剪管线把
"VL 坐标可信"当了默认前提——RC1/RC2 是它引入的新暴露面；a3f1c920（视觉裁判可信化）建立的 OCR 能力
（ocr-toolkit.ts，tesseract chi_sim 已 vendored 实测可用）正是本轮 P0-A/P0-D/P1-C 的现成地基；
RC7 的 API 断流归因衔接 b8f36a12 P0-D；pixel_1to1 人确认兜底被 RC3 绕过，本轮 P0-C 补洞。

## 三、业界实践对照（为什么这么改）

1. **坐标不能让通用 VLM 徒手报**：GPT-4V 级模型的 UI grounding 失准是公认结论；工业方案（Microsoft
   [OmniParser](https://arxiv.org/abs/2408.00203)、Set-of-Marks）是**确定性检测器产框+编号叠标，VLM 只做
   "选哪个编号"的语义判断**——加上 OCR 文本与图标描述可把 grounding 准确率从 0.705 提到 0.938。
   对应 P0-A（OCR 词框交叉校验，坐标真值来自确定性 OCR）与长期方向（icon 候选框由 CV/OCR 提议、VL 只选择）。
2. **保真度量用结构化确定性指标而非像素**：[Design2Code](https://arxiv.org/abs/2403.03163)（斯坦福，
   screenshot-to-code 事实标准 benchmark）的低层指标=文本块检测+二部匹配（Jonker-Volgenant）后算
   Text（Sørensen-Dice）/ Block-Match / Position（中心偏移）/ Color（CIEDE2000），高层才用 CLIP——
   没有一项是原始像素 diff。这与我们"像素直方图已三次实测证伪、OCR 文本鲁棒"的内部结论完全一致。
   对应 P1-C 的度量升级。
3. **裁剪授权 ≠ 逐框验真**：安全领域"授权一次、动作逐个验证"的最小惊讶原则；对应 P0-C 拆位。
4. **Shift-left**：视觉验收若只在最后真机环节做，上游全绿=假信心；每阶段产出须有机器可验证的中间产物门禁
   （spec：OCR 对照+bbox 校验+crop 验真；coding：文案白名单+静态 parity；review：视觉 checklist；
   device：兜底而非唯一防线）。本次事故 5 阶段全 PASS 而成品崩坏，就是反面教材。

## 四、Todos 实现要点

### P0-A bbox 坐标语义确定性门禁（新 check：`ui_spec_bbox_semantic`，spec 阶段 BLOCKER）
- **第 0 层·零依赖 orientation 预检（cursor 意见采纳，OCR 挂了也能拦）**：横排多字文本节点（text 长度≥2、非竖排声明）
  按 [x,y,w,h] 读出 w<h 属形态反常；全 spec 系统性出现（多字文本节点 ≥60% 反常）→ 直接 BLOCKER"疑似 [y,x,h,w] 转置"。
  本次宿主 ui-spec 的"钱包"[w=0.04<h=0.12]、"集中管理…"[w=0.04<h=0.55] 等几乎全部命中，零成本可拦。
  单字符（+/5）与近方形文本不计入分母防误伤。
- **前置 spike（动手第一步）**：用 ocr-toolkit 对 6 张 mockup 原图实测 OCR 识别率（对照 ref-elements 已知文本算召回），
  据此标定第 1 层阈值；"mockup 识别率高于设备截图"由断言改为实测结论后才定判。
- 第 1 层：对每张 authoritative_ref 原图 OCR；对 ui-spec 每个带 `text`+`bbox` 的节点：找 OCR 词框模糊匹配 →
  计算声明 bbox 与 OCR 框的 IoU/中心距，同时计算**转置解释** `[b[1],b[0],b[3],b[2]]` 的 IoU。
- **OCR 失败策略（codex 意见采纳，写硬）**：pixel_1to1 下 OCR 不可用/低置信/文本覆盖率不足 → 本 check 不得 PASS，
  判 BLOCKER 或进人工确认，归 toolchain 归因（沿 round5 `visual_parity_ocr_unavailable` 先例），绝不静默 SKIP——
  否则只是把"VLM 徒手坐标不可靠"换成"OCR 静默缺证据"。此时第 0 层 orientation 预检仍独立生效。
- 判定：转置解释系统性优于原语义（如 ≥60% 文本节点转置命中且原语义 IoU≈0）→ BLOCKER
  `bbox 坐标语义疑似 [y,x,h,w] 转置`，details 给逐节点对照表与回写建议（自动回写须过 P0-B 验真或人确认，不自动自签）。
- 个别节点失配（非系统性）→ 列 must_fix WARN。无文本的 asset bbox 借同屏文本节点的系统性判定结果连坐拦截。
- schema `ui-spec.schema.json` bbox description 与 spec SKILL 模板补**具体数字 few-shot**（"钱包"左上标题 ≈ [0.04,0.02,0.30,0.05]），降低 VL 出错率；但门禁不依赖提示词生效。
- 夹具：本次宿主 ui-spec.yaml 匿名化后入 fixtures → 必须 BLOCKER；人工修正转置后的版本 → 必须 PASS。

### P0-B 裁剪产物验真（新 check：`asset_crop_validation`，spec 阶段；pixel_1to1→BLOCKER，否则 WARN）
- 确定性 sanity（jimp，零模型成本，先跑）：
  - kind=icon（key/purpose 含 icon）：trim 后长宽比 ∈[1/3,3]；面积占原图 ≤8%；非近纯色（像素方差/唯一色数阈值）；
  - kind=illustration/promo：长宽比与声明 bbox 长宽比偏差 ≤2×；非条状（长边/短边 ≤4）；
  - 任一违反 → FAIL 该资产（本次 204×2938、纯蓝、空白三类全部命中）。
- VL 独立辨认（证据链，隔离调用防自报）：新会话仅给 crop 图问"这是什么元素"，答案与 `purpose` 模糊匹配；
  失配 → 入待人工确认清单（goal halt-confirm / 交互模式直接问）。
- **VL 不可用策略（codex 意见采纳，与 P0-A OCR 失败策略同构）**：VL 调用失败/超时/断流时**不得静默 PASS**——
  确定性 sanity 只能否决坏图，不能单独证明语义正确；pixel_1to1 下 brand_logo/illustration/promo 类 crop 的 VL 验真
  不可用 → halt-confirm 求人（附 contact-sheet）或 BLOCKER，归 toolchain/断流归因（衔接 b8f36a12），绝不降级放行。
- 阈值 FP 注记（cursor 提示）：icon 面积 ≤8%、长宽比 ∈[1/3,3] 为启发初值，可能误伤偏宽/偏高的合法图标——
  Phase 0 夹具 + checkpoint 专门用于校准，首跑 FP 风暴按 §七 先校准再前进。
- 贴回对照 contact-sheet：每屏生成"原图+bbox 叠框+各 crop 缩略图"拼图落 `spec/reports/asset-contact-sheet-<screen>.png`，
  人 3 秒可判，headless 留审计证据。
- **覆盖范围（codex 意见采纳）**：验真对象=全部 `acquisition:crop` 资产，**无论本轮新裁、历史已存在、还是已物化进模块
  media**——现状 `asset-acquisition.ts:99` 对 resolved_path 已存在直接 continue，正是"坏图已落盘则永远复通过"的洞；
  本 check 独立遍历资产清单逐一验真，不吃"已存在"豁免；模块 media 中的物化副本一并核 hash 一致。
- 与 `visual_parity_asset_materialized` 衔接：materialize 前置依赖本 check PASS，废图不得进模块 media。

### P0-C 授权/验真拆位（改 `asset-acquisition.ts` + SKILL.md + fidelity-shared）
- `crop_confirmed_by=user_requirement` 语义收窄为 **crop_authorized**（允许走裁剪路径）；
  新增独立判据 **bbox_verified**：P0-B 全绿 或 真人确认（halt-confirm 回执/交互确认），二者缺一 pixel_1to1 P0 即 BLOCKER。
- headless：授权在而验真不过 → halt 求人（附 contact-sheet），绝不静默裁剪物化；两模式行为一致。
- SKILL.md Step2.1 措辞同步改写：自然语言授权≠逐框确认，明确写"授权只解锁裁剪路径，验真由 asset_crop_validation 把关"。

### P0-D spec 完整性外部对照（升级 `capture_completeness` / fidelity_capture_governance）
- 原图 OCR 全文清单（状态栏 band 剔除、len≥2 去噪）↔ ref-elements/ui-spec 文本集双向模糊 diff：
  - OCR 有而 spec 无 → 逐条要求 disposition（implement / explicit_skip+rationale），未处置即 BLOCKER；
  - 覆盖率 = 命中 OCR 文本数 / OCR 文本总数，替换"62/62"自我循环分母。
  - 本次可当场抓住：5 条右置副标题、¥119.40、去优化、"5"角标（OCR 单字符+数字白名单处理）。
- 结构 lint（pixel_1to1 P0 屏必填）：list_row 有 subtitle 时必须显式 `subtitle_position: trailing|below`；
  多行同卡须有分组容器节点（children 非平铺）；悬浮 tab/胶囊容器须建模 `container` 节点带 bg/radius；
  缺失 → BLOCKER 并在 details 指认屏与元素。
- ui-spec `verified: vl_multimodal` 自报位降级为参考注记，门禁只认上述确定性 check。
- OCR 失败策略与 P0-A 同款写硬：pixel_1to1 下 OCR 不可用/覆盖不足 → 本 check 不得 PASS（toolchain 归因）。
- **诚实边界（cursor 意见采纳）**：结构 lint 只能保证"有声明"，不能保证"声明对"——填 subtitle_position/layout_group/
  container 的仍是会犯错的 VL。文本类声明的正确性由 P0-A 的 OCR 交叉校验兜（位置可验）；纯结构声明（分组/容器）的正确性
  归 P1-B review 视觉维度 + device 回环，**本门禁绿≠结构对**，check details 里显式写明此边界，防"结构门禁绿了=结构对了"
  的假信心（正是 RC4 的翻版风险）。

### P1-A coding 一致性硬化
- 新 check `visible_text_whitelist`（coding 阶段 BLOCKER）：源码/string.json 中用户可见字符串（Text()/title/label 等
  AST 可静态枚举的）⊆ spec 文本集 ∪ 显式豁免表；「金融信息」「设置与帮助」这类脑补当场挡。
  技术占位/日志/无障碍描述走豁免表，防误伤。
- `visual_parity_render`：width_ratio/align/variant/subtitle_position 等**源码静态可判**项，pixel_1to1 P0 屏
  从"低置信 WARN·以 device 为准"升为 BLOCKER；仅真正静态不可判的留 WARN。按钮全宽案例入回归夹具。

### P1-B review 视觉维度
- review SKILL checklist 增加第 6 维「视觉保真」；review verifier 增加对应 check id，缺执行证据 → FAIL。
- **覆盖定义（codex 意见采纳：pixel_1to1 P0 不许"抽查"）**：① 全部 `must_have_elements`；② 全部新增/变更屏；
  ③ 全部 P0-B FAIL/WARN 资产（对照 contact-sheet 逐一确认处置）；④ 全部 visible-text diff 条目；
  ⑤ 结构声明正确性复核（分组容器/同行关系/浮动 tab——P0-D 诚实边界里明确归 review 兜的那部分）。
  非 pixel_1to1 或 P1 屏可降为抽查。
- 与 RC6 对齐：review 不重跑度量，**消费** spec/coding 阶段落盘的确定性报告（P0-B 报告、contact-sheet、
  文案 diff、static_fidelity_score 未命中清单），成本可控。

### P1-C device 回环提效（纠偏后范围：断流归因 + 可执行 must_fix，非"补 pending 阻断"）
- **纠偏（codex 指出，已核 goal-report/testing summary）**：pending 阻断已存在且本轮已正确生效（HALTED/testing FAIL、
  `visual_diff` BLOCKER 明确拒绝 pending 作 PASS）——不重复造。本 todo 修的是它的三个短板：
- 断流快速归因：VL 判定 attempt 因 API 断连失败时，按 b8f36a12 的 FailureKind 管线即时归因 halt（附断流证据），
  不烧满 attempt/wall-clock（本次 3 attempt/2h+ 才停）。
- halt 必须可执行：确定性主观测（参考图与设备截图各 OCR → 文本块二部匹配 → 存在性+中心偏移+同行分组三项得分，
  Design2Code Text/Position 对齐）**不依赖 VL 会话成功**，即使 VL 断流也能产 per-element `must_fix`
  （"副标题'银行卡/交通卡/门禁卡等'应与主标题同行右置，实测在题下"级别的可执行信号）喂回 loop；
  VL verdict 仍在但不可推翻确定性 FAIL（延续 a3f1c920"独立背靠可否决 VL"原则）。
- score_floor 保留字段但重命名注记为 reference_only，不再参与任何判定展示权重。

### P2 回归夹具
- fixtures 固化四类坏态 + 正样本：转置 ui-spec、204×2938/纯蓝/空白 crop、金融信息脑补源码片段、按钮全宽源码片段。
- **正样本出处（cursor 疑问已核实落地）**：本轮 run 全部转置、不存在忠实样本，正样本三路来：
  ① `profiles/hmos-app/harness/tests/fixtures/ocr/` 已有 mine.png/card_pack.png（a3f1c920 轮 vendored 的历史设备截图），
  供 OCR 类门禁校准；需补 vendor mine 对应参考原图（`0-原始需求/2.我的.jpg`）成对；
  ② P0-A 正样本=本次转置 ui-spec 的**人工修正版**——防自洽循环（cursor 提示）：人核步骤须用 OCR 实测词框位置对齐验证，
  而非仅机械 [y,x,h,w]→[x,y,w,h] 翻轴（若造样本与判定逻辑同轴语义，样本通过只证明检测器自洽，FP 测试无效力）；
  ③ P0-B 正样本=按修正 bbox 重裁的真图标 crop。三路均在 Phase 0 落实后各门禁才动工。
- 验收：新门禁对坏态 100% FAIL、对真态 0 误报；单测进 harness/tests/unit 与 profiles/hmos-app/harness/tests/unit 既有布局；
  round5 既有 icon_substitution/烤字/占位用例全绿（行为不回归护栏）。

## 五、验收出口

1. 夹具回归：§四各 todo 的坏态/真态判定全部符合预期（P2 清单）。
2. 宿主重跑（用户触发）：homepage 重出 spec 后——素材 23 项全部通过 asset_crop_validation（contact-sheet 人 3 秒可核）；
   OCR 完整性 diff 为空或全部有 disposition；coding 无白名单外可见文案；device-testing 无 pending 收工。
3. 诚实条款：任何一步实现中发现与本 plan 假设不符，当场同步用户修正 plan，不闷头简化
   （OCR 识别率已前移为 Phase 0 主动 spike，此条为剩余未知的兜底）。

## 六、明确不做（本轮）

- 不做"VL 徒手 bbox 换成 CV 候选框提议+VL 选择"的完整 OmniParser 化改造（P0-A 的 OCR 交叉校验已能挡住本类事故；
  候选框提议管线成本高，列为 round7 候选，届时先做 icon 类资产试点）。
- 不碰宿主业务代码与本次 homepage 产物的手工修复（重跑由新门禁保障）。
- 不引入新的像素级几何度量（历史三次证伪，不再重蹈）。
- 不重复实现 pending 阻断（已存在且本轮已生效，见 RC7 纠偏）。

## 七、执行顺序（外部评审采纳：分批降爆炸半径，范围仍三轨全包）

> cursor 担忧"一轮 5+ 新 BLOCKER 每个都是新误报面"成立；codex 建议"每道新门禁先证明能拦住本次真实坏态"成立。
> 合并为下述分阶段执行，**plan 范围不变**（用户已拍板三轨全包），checkpoint 是验证点不是砍范围点。

- **Phase 0（前置，先于一切门禁）**：① OCR spike——6 张 mockup 实测识别率/召回，标定 P0-A/P0-D 阈值；
  ② P2 夹具 vendoring——四类坏态 + 三路正样本落 fixtures（此后每个门禁开发即以夹具为可证伪验收）。
- **Phase 1（Track A 素材线）**：P0-A → P0-C → P0-B → P0-E（依赖序：先能判坐标，再拆授权语义，再验裁剪产物，最后动分型规则）。
- **Checkpoint（宿主重跑 · 用户触发）**：homepage 重出 spec——素材线出口验收（23 资产全过验真、contact-sheet 人核、
  无转置告警）。若新门禁出现 FP 风暴，先校准再进 Phase 2，不带病叠门禁。
- **Phase 2（Track B 上游门禁）**：P0-D → P1-A → P1-B。
- **Phase 3（Track C 回环提效）**：P1-C。
- 每 Phase 完成即勾对应 todo 并跑全量单测/typecheck；Phase 间发现 plan 假设不符按 §五.3 诚实条款同步。

## 八、实施记录（2026-07-02 · Phase 0 + Phase 1 完成，等待 Checkpoint）

> 版本窗口标签说明：Phase 0+1 成果已实现并随 **2.4.0** 发布（用户打包集成宿主做 checkpoint）；
> frontmatter `version/deferred_to: 2.5.0` 表示**剩余 todos（Phase 2/3：P0-D/P1-A/P1-B/P1-C/P2 收尾）**
> 推迟至下一窗口继续——release:check-plans 发版门禁的合法出口（version-evolve bump 至 2.5.0 时自动清 deferred_to）。
> 工程版本 package.json 未动。

**Phase 0 实测结论**：
- OCR spike（6 张 mockup 全跑）：召回 5/6 屏 100%、mine 屏 88.9%（唯一 miss=脱敏邮箱特殊符号）、
  均值置信 66-78、耗时 0.6-1.7s/屏——"mockup OCR 可承重"由断言转实测成立。
- bbox 语义判定（行聚类+逐候选最大 IoU）：坏态 22:0 判转置、换轴修正态 22:0 判正确、零交叉污染；
  46/47 文本节点可匹配。阈值定稿：margin=0.04、floor=0.08、min_decisive=5、转置占比=0.8、覆盖率下限=0.5、
  orientation 反常率=0.6/最少 5 节点/h≥w×1.15。
- 夹具落位 `profiles/hmos-app/harness/tests/fixtures/round6/`（转置 ui-spec、三废图、脑补 string.json、
  按钮全宽源码、add_card/mine-ref mockup），详见其 README。

**Phase 1 落地清单**（typecheck ✅ / 单测 1376+35 全绿 ✅ / 新增 round6 套件 14 用例全绿，坏态全 FAIL、正样本全 PASS）：
- P0-A：`ui-spec-bbox-semantic.ts` 新 check `ui_spec_bbox_semantic`（spec.ui_spec capability），
  orientation 第 0 层 + OCR 交叉第 1 层 + `ui_spec_bbox_semantic_ocr_unavailable` toolchain 硬策略；
  schema json bbox few-shot + reference/ui-spec.md「bbox 坐标语义」节 + 自检口诀。
- P0-B：`asset-crop-validation.ts` 新 check `asset_crop_validation`（spec.asset_acquisition capability）；
  jimp worker 新 op `stats`（纯色/空白）与 `contact`（贴回对照拼图）；VL 隔离辨认契约
  `spec/reports/asset-crop-vl.yaml`；机器裁决 `spec/reports/asset-crop-validation.json`；
  coding 新门禁 `visual_parity_unverified_crop`（物化前置，报告缺失=整组未验真）。
- P0-C：`isCropHumanConfirmed`→`isCropAuthorized` 语义收窄；asset 新字段 `bbox_verified_by`
  （真人验真署名，schema/validator/TS 类型三处同步）；SKILL Step2.1 补"授权≠逐框验真"与裁后验真流程。
- P0-E：reference/ui-spec.md 图标分型按品牌识别度收窄 + allowlist 硬边界 + 语义映射建议表（仅提示）+
  `fidelity_note` 字段；SKILL:171 同步；`visual_parity_icon_substitution` 行为保留原判（既有用例全绿护栏），
  仅 details/suggestion 引导语对齐新规则。
- 顺手修复既有不一致：round5 `baked_text_defer/baked_text_defer_by` 在 TS 类型有、validator/schema 漏登记——已补齐。

**与 plan 的实现偏离（诚实条款）**：
1. P0-A"个别节点失配→列 must_fix WARN"：实现为 systematicAsIs PASS 结果的 details 内列复核清单，
   未单独出 WARN 结果（避免非系统性噪声在 pixel_1to1 下被 ratchet 放大成新 FP 面；系统性判定不受影响）。
2. P0-B"VL 独立辨认（隔离调用）"：TS check 为确定性脚本、不直接发 VL 调用——实现为**契约文件**
   `asset-crop-vl.yaml`（SKILL 指令 spec agent 以隔离会话逐图辨认后落盘，check 强制其存在与 match，
   缺/失配/自动化署名一律不放行）——与 visual-diff verdict 的既有契约模式一致。
3. P0-E"spec 模板附语义映射表"：落在 reference/ui-spec.md（spec skill 的模板性 reference 即此文档），未新建模板文件。

**Phase 1 代码 review 修复（2026-07-02·cursor/codex 双评审，逐条核实后采纳）**：
- codex P1（属实）：VL 契约 `match:true` 未校验署名——`by: goal-mode-auto`/空 by 可放行，与本记录"自动化署名
  一律不放行"矛盾。修复：新增 `isValidVlSigner`（非空且非 AUTOMATION_SIGNER_IDS），署名非法的 match:true
  → pending 不 verified；用例 `p0b_vl_selfsign_rejected`。
- codex P2（属实）：裁决仅按 key 查，重裁/换图/改 source_bbox 后旧 verified 复用。修复：裁决条目记
  sha256+resolved_path+source_bbox 快照，coding 消费时重算比对（`collectUnverifiedCropLines`），
  任一漂移=绑定失效不放行；contracts 可用时模块 media 物化副本一并核 hash 一致（补齐 plan §四 P0-B 原文要求）；
  用例 `p0b_stale_verdict_binding_rejected`（换图/改 bbox/media 换图三路全拦，一致放行）。
- cursor 非阻断提示（采纳其一）：sanity 启发阈值误伤无出口（合法超长横幅 long/short>4 恒 FAIL）——
  修复：真人 `bbox_verified_by` 可翻案 sanity fail（对照 contact-sheet 人核合法，翻案留痕 reasons；
  自动化署名不能翻），与"pixel_1to1 人确认主背靠"原则一致；用例 `p0b_human_overrule_sanity_fail`。
  另一条（VL 契约软约束）维持现状：sanity+contact-sheet 是硬兜底，接受为已知边界。
- codex 二轮 P1（属实）：绑定校验写成"字段存在才查"——手写最小 verified（无 sha256/resolved_path/source_bbox）
  可整体绕过，且 `materialize_gate_verified_report_clears` 用例把漏洞行为锁成了预期。修复：verified 强制绑定字段
  齐全（缺 sha256/resolved_path 即"旧格式/非门禁产出"拦下；source_bbox 快照与当前声明须一致含双缺省）；
  该用例反转为 `materialize_gate_requires_full_binding`（最小 verified 拦 + 完整绑定一致放行）。
  本格式本轮引入、无真实存量，无兼容包袱。
- 修复后全量：typecheck ✅ / 1379 单测 ✅ / 35 fixture ✅。

**Checkpoint（下一步，用户触发）**：宿主 SimulatedWalletForHmos homepage 重出 spec——预期链条：
`ui_spec_bbox_semantic` 拦转置 → agent 换轴修正 → 重裁 → `asset_crop_validation`（sanity+VL 落盘+contact-sheet）
→ 23 资产 verified → coding 物化放行。若 FP 风暴，按 §七先校准再进 Phase 2（P0-D/P1-A/P1-B）。
