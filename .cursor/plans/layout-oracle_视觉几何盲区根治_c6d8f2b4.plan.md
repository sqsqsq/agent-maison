---
name: 运行时布局树几何 oracle + 自报度量诚实性治理 + VL critic 闭环 — 视觉回环几何盲区根治
version: 3.0.0
# 版本说明：随当前 3.0.0 版本窗口（package.json 实测 3.0.0；rev1 曾误写 2.4.0 被
# check-plan-version 实锤 FAIL）。用户控版本，不 bump。
# goal/普通模式共用同一 harness 门禁，天然两模式拉齐（capability parity 原则）。
# rev2（2026-07-10）：合并 codex/cursor 双外部 review，逐条 ground-truth 核实后修订，
# 处置台账见文末「外部 review 处置」。
# rev3（2026-07-10）：第二轮 review 合并——codex 两 P0（回执防伪/评估-采集新鲜度解耦）
# 经源码核实全部成立；ocr_capable 语义纠错；close 规则 advisory 起步；critic 熔断指纹化；
# OpenSpec 前置；新增「实施切刀」。cursor 判通过，其五条注记一并落实。
# rev4（2026-07-10）：第三轮 review 双通过收口——字段名统一 evaluation_invalidated、
# candidate-pass 两档位解交互态死锁、OpenSpec 覆盖面/validate 命令、A 类表与 t3 对齐、
# t11 补 forbidden_overlap 前置。定稿待用户批准实施。
# rev5（2026-07-10）：对照 e8f5a2c7（写保护/完整性）与 d7e4b2a9（hap 发现）两 plan 落地
# 后的代码基线做兼容性核查——零文件重叠、行号引用全部仍有效；signed-hap 修复反而是
# t2 指纹绑定的正向依赖；按 consumer-guard 新规补三条实施注记（详见「兼容性核查」节）。
# rev6（2026-07-10）：实施完成——t0-t10 落地（三刀全绿：tsc 0 err / 单测含 14 例新套件 /
# openspec 33/33），8 条实施偏差全量登记（D1-D8），t11 待宿主执行。详见「实施记录」。
# rev7（2026-07-11）：代码 review 修复批（codex Request changes / cursor 5 Important）——
# 五条绕过路径闭合（回执任意 attest 必需+hash 验真+路径/mtime 限制、attest 逐区域覆盖、
# corrupt dump 显式化、schema.json 补字段、capture 升 1.1）+ A-4 补实现 + 指纹纯函数 +
# 3 个 e2e FAIL 用例 + OpenSpec 对齐 D3 + tasks 按实勾选 + D9/D10 登记。
# codex P0（critic loop 未实现）部分受理部分推回，见「rev7 处置」。
overview: >
  【问题】宿主 SimulatedWalletForHmos feature bc-openCard（fidelity_target=pixel_1to1 最严档）
  device-testing 视觉回环 8 屏全 pass 收口后，用户人工逐页检视仍立刻发现三类缺陷：
  (a) card_type_sheet 半模态结构错误——储蓄卡/信用卡应与银行行同处一张白卡内以细分割线分隔，
  实现为两块独立灰底圆角块；(b) 右上角关闭 X 按钮与银行白卡区域重叠；(c) 整体内容间距失衡。
  三类全部是几何/结构类。用户一句话指出后 agent 立即修对——瓶颈不在修复端，在检测端。
  【根因链（五条，逐条有盘上证据）】
  R1 管线内没有任何对运行时几何敏感的确定性信号：T1/T5/P1-C 全是截图 OCR 文本信号
  （文本存在性/越界/相对排布），score_floor 像素直方图已被实测证伪降为 reference_only、
  edge 哨兵永不 gate——重叠/同卡分组/间距这些几何事实无人度量。
  R2 geometric_iou/fidelity_score 纯 VL 自报且无诚实性元门禁：全仓无任何脚本计算这两个字段。
  bc-openCard 实证自报已彻底退化——8 屏 geometric_iou 恒等 0.95（常数填表）；
  7/8 屏 fidelity_score 与脚本算的 score_floor 16 位小数逐位相同（原样抄回）；
  card_type_sheet 压线 0.99=floor；defects 8 屏全 []。灾难地板 FINALIZED_MIN_IOU=0.40
  消费的是自报值，等于假保障。
  R3 spec 侧几何合同对 overlay 屏失守：ui-spec DSL 本有 bbox/layout_group/bg_color/分组容器
  声明能力，主屏都用了，但 card_type_sheet（P0 屏）零 bbox/零 layout_group/零 bg_color 照样过门禁
  ——ui_spec_structure_lint 平铺阈值 STRUCTURE_LINT_FLAT_LIST_MIN=3，该屏只有 2 行 list_selection
  静默放行；参考图中的银行行元素整个未建模（must_have_elements 五项无一银行元素）；
  "这 2 行须与银行行同卡"是跨元素 containment 关系，DSL 无处声明。
  ui-spec verified=unverified 仅 WARN 放行（宿主 receipt 实录）。
  R4 运行时几何数据唾手可得却未接入：Hylyre `dump-ui` 已在采（adhoc-dump-ui.ts、
  snapshot-cache 预热），宿主实测输出（hylyre-hypium-ui-dump-v1，源 hypium.UiTree）
  每节点含 bounds "[x1,y1][x2,y2]"+type/text/clickable/id/key——但框架消费者只正则抽
  text/label 字符串，从不取 bounds。注意：树无背景色/可见性/z-order/clip 语义，
  id/key 大量为空，overlay 开启态是否进树未经验证——它是**候选数据源**，能力边界靠 t0 校准，
  不预设为 ground truth。
  R5 控制回路被明文设计为"单轮后交人"：SSOT device-testing-workflow-detail.md Step 4.6
  回修条款="must-fix 交 coding 修一轮（MVP 单轮+人工决定是否再迭代）"+ 真人确认协议
  "一屏一屏等真人明确表态"——逐页人工检视是框架设计行为，非偶发。且 VL 评审无
  "成对图确已入模"的证据要求（有视觉能力≠本轮真看过图），评审者与实现者同上下文自审。
  【方案总纲·双主线】
  主线 A（确定性 oracle）：采图时同步 dump 运行时布局树，跑分层几何断言
  （A 类 forbidden-overlap 拓扑、B 类 spec 派生结构、C 类间距比例 advisory），
  t0 校准先行、拦不下不硬 gate；同时把自报度量退出一切 gate 输入（改 reported_* 语义），
  退化模式元检测 M1 只作异常拦截；spec 侧补 overlay 屏几何合同与 locator 协议。
  主线 B（VL critic 闭环）：成对图强制入模并留 harness 可验证据（对照 crop +
  critic 调用回执；可证边界=素材物化与调用记录，非模型认知，交互态如实标
  input_provenance=unverified）；评审与实现分离（独立 critic 上下文）；
  回修从"MVP 单轮+人工决定迭代"改为
  "自动迭代至 candidate-pass 或 no-progress 熔断"——真人从逐页调试者后移为
  candidate-pass 后的一次性批量终审（T2 语义不变，时点后移）。
  遵守项目铁律（ui-spec.md L106"绝对位置类度量已被真机证伪，任何新确定性抓手须先过实测
  校准"）：T0 校准先行，以 bc-openCard 三个已知人抓缺陷为回归靶，拦不下的子信号不上 gate。
  【显式非目标（诚实边界）】①不砍 T2 主背靠（P0 pass 屏真人 confirmed_by 保持必需）——
  主线 B 改变的是**何时**找人（candidate-pass 后批量终审）而非**是否**找人；taste 类主观差异
  （质感/风格/细微间距）不承诺自动化；②不做 OmniParser/像素级新度量（已证伪方向不重蹈）；
  ③不动 Hylyre wheel 本体——若 t0 实测发现 overlay 不进树/bounds 不可信，依赖布局树的
  todo 置 cancelled 并登记原因、另立 Hylyre 上游 plan，本 plan 治理项照常落地；
  ④coding 阶段"实现后对照参考图几何自检"另立项（本 plan 面积已满；主线 B 的 critic
  已把"做完才发现"的成本从人发现降到 critic 发现）。
  【验收（分层，不承诺三靶全自动硬拦）】
  ①(b) X 重叠：经 spec 显式 forbidden_overlap 声明对硬拦为 BLOCKER + defect(overlap)
  （宿主复验时为 card_type_sheet 补该声明；默认 close 规则按 t0 校准结论决定是否晋级）；
  ②(a) 同卡结构：以 t0 校准结论为准——预期主责为 t6 spec 合同前置拦截（分组容器
  强制声明+overlay 元素完整性），树侧共容器判定按校准结论定 WARN/advisory；
  ③(c) 间距失衡：C 类 advisory 出现即达标（永不硬 gate）；
  ④M1 对 bc-openCard 既有 visual-diff.json 触发常数/抄 floor 拦截；
  ⑤主线 B：成对图证据/critic 回执缺失可被 harness 拦截（交互态
  input_provenance=unverified 如实标注、不宣称已证明看图）；critic 迭代在演示 run
  中完成 ≥2 轮自动回修收敛或正确熔断；
  ⑥typecheck/全量 unit/fixtures 绿 + 宿主复验按上述分层预期核对。
todos:
  - id: t0-calibration-first
    content: >
      【校准先行·铁律】宿主真机对 bc-openCard 实测布局树能力边界（bounds 存在已证实：
      dump-ui-20260709.json 含 105 处 bounds "[x1,y1][x2,y2]"，无需再验"有没有"）。
      聚焦四个未知：①overlay 半模态**开启态**是否进树（既有两份 dump 均无 card_type_sheet
      文本——须导航到 sheet 开启态再 dump 验证；含系统 showClose X 是否有节点+可信 bounds）；
      ②bounds 语义（视觉边界 vs 触控热区；离屏/不可见节点如何表达——树无 visibility 字段）；
      ③ArkUI `.id()` 是否透传到 dump 的 id/key attr（在宿主设一个 .id() 实测；决定 t1
      locator 主方案）；④三靶可判性与假阳性：(b) X∩银行卡 bbox 相交可判性 + **默认 close 规则
      在全部 8 屏跑 FP 观察**（扩大触控热区/标题行/overlay root/合法悬浮的误伤率，
      决定该规则能否晋级 BLOCKER，rev3）；(a) 树无
      bg/surface 语义，"共白卡"仅能退化为"共最近容器"——记录两块灰底 vs 一张白卡在树上
      是否可区分（预期结论：不可靠，(a) 主责移 t6 spec 合同）；(c) 兄弟间距可测性与
      device≠mockup 比例换算误差。产出 `docs/operations/layout-oracle-calibration.md`：
      逐项结论+假阳性观察+tolerance 建议。**拦不下的子信号降 advisory 或不做，不硬上 gate**。
      宿主侧校准用的临时脚本/中间产物一律走 scratch/ 约定（e8f5a2c7 G4：根目录 tmp
      触发 workspace 卫生 WARN；严禁写宿主 framework/ 树内——G1 写时守卫会拦，rev5）。
      若 overlay 不进树或 bounds 不可信：t2/t3 置 cancelled 并在实施记录登记原因、
      另立 Hylyre 上游需求 plan，本 plan 余项照常。
    status: completed
    # 完成注记（rev6 实施）：离线部分全部完成——docs/operations/layout-oracle-calibration.md
    # 已落盘（dump 格式/bounds 语义/.id 透传实证/三靶可判性/gate 档位决定表）。
    # 重大离线发现：宿主 app 自有 .id()（home_header_add/promo_no_card）已在 dump 中实证透传，
    # t0③ 从"待验证"升"已确证"。真机项（D1-D6：overlay 进树/热区/可见性/close FP/间距区分度）
    # 因设备不在线（hdc list targets 空）定义为步骤清单，随 t11 宿主复验执行——依赖其结论的
    # gate 升级（A-3 close 默认规则→BLOCKER）保持未启用（保守档位已按决定表落码）。
  - id: t1-locator-protocol
    content: >
      ui-spec 元素 ↔ 运行时节点对应协议（B 类断言的前提桥，独立成项）：
      ①主方案：coding 门禁新增——pixel_1to1 P0 屏 ui-spec 声明元素对应 ArkUI 组件
      须设 `.id(<element_id>)`（t0 ③证实透传后启用；coding skill/检查表+harness 静态
      lint 双落点）；②fallback 匹配器（.id 缺位时）：text 锚（唯一文本精确匹配）→
      type+结构路径 → 置信度分级（exact_id > unique_text > structural），歧义
      （同文本多节点/容器无文本/图标按钮）→ 判 unmatched 不强猜；③覆盖率门禁：
      P0 屏声明元素可定位率 < 阈值（校准定，建议 80%）→ 该屏 B 类断言 SKIP+WARN
      注记"locator 覆盖不足"，不带病判定。落点 layout-oracle 共享 util +
      单测（含歧义 fixture）。
    status: completed
    # 完成注记：locator 在 layout-oracle-check.ts（exact_id > unique_text > structural-lite，
    # 歧义即 unmatched；LOCATOR_COVERAGE_THRESHOLD=0.8）；coding 门禁落
    # coding-visual-parity-check.ts `visual_parity_element_id_lint`——实施偏差：首版 WARN
    # 观察期而非硬门禁（缺 .id 不产生错误判定、只降 locator 覆盖率，device 侧 B 类 SKIP+WARN
    # 另有兜底；观察期后按校准数据议升级）。
  - id: t2-layout-dump-capture
    content: >
      采集层接入布局树：`visual-diff-capture.ts` 每屏截图后同步 dump 布局树
      （复用 adhoc-dump-ui.ts 的 hylyre session/dump-ui 链路，勿重复造轮子），
      落 `device-testing/device-screenshots/layout-<screen_id>.json`，
      与 screenshot_hash/evaluated_build_fingerprint 同键绑定（P0-9a 跳采语义拉齐：
      跳采屏不重 dump）。dump 失败写 `layout_dump_status: unavailable`（区分
      能力缺失 vs 采集失败），pixel_1to1 P0 屏缺 dump → WARN（首版不 BLOCKER，
      视 t0 校准结论在后续收紧）。overlay 屏须在 sheet 开启态 dump（与截图同一时点）。
    status: completed
    # 完成注记：visual-diff-capture.ts layoutDumpFn 注入式（与 screenshotFn 同模式，可单测）；
    # 真机实现 buildHylyreLayoutDumpFn（visual-diff-hylyre-screenshot.ts，hylyre dump-ui --out）；
    # check-testing.ts 装配；merge 层保留 layout_dump_status；跳采屏不重 dump（preserved 分支不触碰）。
  - id: t3-layout-invariants-gate
    content: >
      新确定性信号 T8 `visual_diff_layout_invariants`（新文件
      profiles/hmos-app/harness/layout-oracle-check.ts，visual-diff-check.ts 消费）：
      A 类（forbidden-overlap 拓扑，收窄版——不做全量两两扫描，避免嵌套 hitbox/badge/
      浮层假阳性；rev3 再收紧）：硬 gate 首版**只消费显式声明**——spec
      `forbidden_overlap: [elem_a, elem_b]` 对与 `protected_region: <elem>`（schema 进
      ui-spec，t6 联动）+ 控件越出屏幕边界；**默认 close 规则**（overlay 屏关闭钮
      不得与内容 surface 相交）**advisory 起步**，经 t0 ④FP 观察证明零误伤后方可
      晋级 BLOCKER；比较对象采用 t0 ②裁定的 bounds 语义（视觉边界 vs 触控热区
      分清后才定基准）。全量两两相交仅观察期 advisory 记 defects，永不直接 gate。
      B 类（spec 派生结构，依赖 t1 locator，unmatched 即 SKIP）：①同 layout_group 元素
      须共最近容器或同行（y 带重叠）②声明分组容器的 children 运行时须共最近公共容器
      ③ui-spec order → 运行时 y 序单调。**首版 WARN 起步**（树无 surface 语义，
      共容器判定有 FP/FN 风险），gate 档位以 t0 校准+观察期数据为准。
      C 类（参考相对几何，缩放不变）：相邻兄弟间距比例 vs ui-spec ref bbox 推导比例，
      偏差超 tolerance → **永久 advisory**，只进 defects 供 critic/人复核，不 gate。
      A 类硬 gate 命中 → fidelityRatchetFailOrWarn（pixel_1to1→BLOCKER），defect 写回
      visual-diff.json defects[]（class 复用 overlap/clipping/shape_mismatch，附 bbox +
      可执行 note）；**与 P1-C 同语义：VL pass 不可推翻确定性 fail，禁止弃判**。
    status: completed
    # 完成注记：layout-oracle-check.ts（A/B/C 收集器）+ visual-diff-check.ts 消费
    # （hard→ratchet BLOCKER、warn→WARN、advisory→referenceNotes、缺 dump→WARN）。
    # 实施偏差①：defect 不由 harness 写回 visual-diff.json（check 只读设计+tamper-scan 红线
    # ——harness 改判定文件会模糊"判定只能由 capture/真人产生"边界），改为 hits 全量携带
    # signal/bbox/可执行 note，critic/VL 按 rubric 折算进 defects/must_fix；下游 T4/D11 链路
    # 语义不变。实施偏差②：B1 共父豁免排除页面根（单测抓出的真背离吞没 bug，当场修复）。
  - id: t4-selfreport-demotion
    content: >
      自报度量降权 + 退化模式元检测（visual-diff-check.ts + schema 1.1，与 t8 迁移联动）：
      ①自报值退出一切 gate 输入：FINALIZED_MIN_FIDELITY/IOU 灾难地板不再消费自报字段
      ——布局树真算值可得时消费真算，不可得时该地板 SKIP+注记（不装作有保障）；
      字段更名 `reported_fidelity_score`/`reported_geometric_iou`（legacy 字段读入映射，
      见 t8），语义=VL 参考自评，零 gate 权重。
      ②退化模式元检测 M1 `visual_diff_selfreport_integrity`（定位=异常拦截，
      **不是诚实性证明**——换随机数即可绕过，真实举证责任在 t7 成对图证据）：
      跨屏常数（finalized ≥4 屏 iou/fidelity 完全相等）、抄 floor（与 score_floor
      浮点逐位相等 ≥2 屏）→ pixel_1to1 BLOCKER 强制重判；压线（|score-floor|<ε 且
      defects=[] 且 pass）→ WARN。
      ③M1 强制重判=**评估新鲜度**失效，与**采集新鲜度**解耦（rev3 按 codex P0 修正：
      rev2 的"否决 canSkipRecaptureForScreen"会触发设备重采，而状态栏时钟漂移使
      重采 hash 必 ≠ evaluated_hash——mergeCapturedScreenEntry L252-257 将把 verdict
      重置 pending 且 `{...captured}` 丢弃 confirmed_by，与"真人签字不作废"自相矛盾，
      源码实锤见 E16）。改为：M1 命中屏写 `evaluation_invalidated: true`（JSON 层
      标记，**不触发设备重采**、不动截图/指纹/采集持久化语义）；check 层见标记 →
      真人已签屏：保留 verdict/confirmed_by，要求 critic 重跑重填 reported_*/
      region_attest 后清标记，未清则 BLOCKER；未签屏：verdict→pending 全量重判。
      堵"元门禁喊重判、评审装没听见"的缝，采集/评估双新鲜度各管各。
    status: completed
    # 完成注记：schema 1.1（reported_* 更名+legacy 读入映射）；lowScorePass/灾难地板/诚实性
    # 交叉校验全部退出自报消费（SKIP+注记，常量保留待真算值）；M1 三子检测
    # （collectSelfreportDegeneracy 纯函数可单测直打，bc-openCard 反例靶 8 屏常数/7 屏抄 floor
    # 已在单测复现命中）；evaluation_invalidated 门禁+await 资格排除+不触发重采。
  - id: t5-region-attest-evidence
    content: >
      defects 空数组免检收紧 + 证据绑定（定位=举证结构化，不宣称防伪；防伪靠 t7）：
      pixel_1to1 P0 pass 屏 defects=[] 时须附 `region_attest[]`——逐 must_have_elements
      或逐 zone 条目：`{region, verdict: no_diff|diff_logged, method:
      paired_crop_compare|vl_screening|human, evidence?: <crop 路径>, by: <身份>}`；
      method=paired_crop_compare 时 evidence 必填且 harness 验文件存在（与 t7 联动）；
      schema 进 validateVisualDiffJson（1.1），缺失 → 与 D11 缺枚举同级 BLOCKER。
      同步改写 VL rubric（skills/reference/device-testing-workflow-detail.md Step 4.6）：
      pass 的举证责任 = 逐区域对照声明+证据，不是"没看见问题"；并写明 T8/M1 信号语义
      （确定性 fail 不可推翻、reported_* 零 gate 权重）。
    status: completed
    # 完成注记：region_attest schema 校验 + `visual_diff_region_attest` 门禁
    # （pixel_1to1 P0 pass defects=[] 无 attest → ratchet）；rubric 已改写
    # （device-testing-workflow-detail Step 4.6 执行段 + SKILL.md Step 4.6 摘要）。
  - id: t6-spec-geometry-contract
    content: >
      spec 侧几何合同收紧（capture-completeness-check.ts + ui-spec.md + schema）：
      ①STRUCTURE_LINT_FLAT_LIST_MIN 3→2（bc-openCard 实证 2 行漏拦。范围澄清（rev3）：
      该 lint 本就限 pixel_1to1+P0 屏双闸——isPixel1to1 + priority==='P0' 源码核实，
      codex"全局误伤任意双 list"不成立；合法独立双卡结构的既有出口=各行声明各自
      layout_group 或各建 bg_color 容器，出口写进 lint 提示文案，不新增字段）；
      ②overlay 屏合同：pixel_1to1 P0 屏 root 为 overlay_panel 时，直系
      list_selection/action_button 子节点须有 bbox 或 layout_group 至少其一；
      ③跨元素同卡声明（(a) 类缺陷的主责防线）：ui-spec 分组容器规则补明确指引——
      参考图同一白底容器内的行（含"银行行+卡类型行"异型行）必须建同一分组容器节点；
      lint 对 overlay 屏"≥2 个 surface 类兄弟容器"给 advisory 提示复核；
      ④overlay 屏元素完整性：overlay 屏参考图（或其 crop）单独跑 OCR 分母比对，
      堵"银行行挂靠主屏分母、overlay 屏整个漏建模"的洞（card_type_sheet 实证：
      must_have_elements 五项无一银行元素）；装饰字/水印误伤沿用
      capture_completeness_external 既有 defer+真人签出口，不另造白名单机制（rev3）；
      ⑤新 schema 字段 `forbidden_overlap`/`protected_region`（t3-A 类消费）；
      ⑥pixel_1to1 + 宿主**真视觉**在位 + ui-spec verified=unverified → 升 BLOCKER。
      真视觉判据=fresh vision-canary verdict=`tool_read`（几何/颜色题实测通过）；
      **ocr_capable 不算**——其语义=仅文字题对、vision 仍 none（rev3 按
      vision-canary.ts L5-13 纠正，E15）；ocr_capable/none 宿主不升级，
      继续按 d4a8f3c6 降级阶梯钳制。
    status: completed
    # 完成注记：①lint 3→2+出口文案；②overlay 直系子节点合同；③≥2 surface 兄弟容器
    # advisory + ui-spec.md 同卡指引（含异型行）；④overlay 本地 OCR 分母
    # （collectScreenLocalTexts；root bbox 可框定 → ratchet，不可定 → advisory 复核清单——
    # 背景透出 FP 风险按校准铁律降档，OpenSpec spec 同语义）；⑤forbidden_overlap/
    # protected_region 进 JSON schema+运行时校验器+类型；⑥readCanaryToolReadSignal
    # （multimodal-probe 新增）+ spec-ui-spec-check 升 BLOCKER 分支。
  - id: t7-paired-image-evidence
    content: >
      【主线 B①】成对图强制入模证据协议（治 R5"有视觉能力≠看过图"；rev3 诚实边界：
      harness 能证明的是**素材物化 + 调用回执**，不是模型认知——文件存在性证据
      不宣称"已证明看过图"）：
      ①对照 crop 物化：按 region_attest 的 paired_crop_compare 条目，从参考图与
      实测截图**各自**裁出对应区域并排落盘
      `device-testing/device-screenshots/_attest/<screen>_<region>.png`（复用既有
      crop 工具链，绑定三 hash 进 JSON：evaluated_screenshot_hash + ref 文件 hash +
      合成图 hash + source bbox）；harness 校验文件存在/命名一致/mtime 晚于截图。
      ②critic 调用回执 `critic-receipt.json`（framework 可控调用面）：goal 态由
      goal-runner 落盘——critic_run_id、adapter/model、独立上下文标识、prompt hash、
      **实际传入 adapter 的 image_inputs[] 路径+hash**、critic 输出 hash；harness
      校验 image_inputs 覆盖本屏全部 attest crop，缺失/不覆盖 → pixel_1to1 BLOCKER。
      落盘路径钉死 `<features_dir>/<feature>/device-testing/reports/critic-receipt.json`
      （features 目录；**严禁落宿主 framework/ 树内**——e8f5a2c7 G2 extra-file 扫描会判
      BLOCKER、G1 写时守卫会拦写，rev5）。
      ③交互态（Cursor/CC 等外部 agent）无法从外部证明图片已注入模型 → 回执写
      `input_provenance: unverified` 如实标注；防线改由 SSOT 硬条款承担：critic
      上下文写 verdict 前**必须逐屏 Read 对应 _attest crop**（写进
      device-testing-workflow-detail Step 4.6 + verifier prompt；cursor rev3 方案）。
      headless 盲模型宿主按 d4a8f3c6 降级阶梯豁免（reference_only 钳制下不产 attest，
      走既有 T2 HALT 求人路径），不新增噪声。
    status: completed
    # 完成注记：attest 证据存在性校验（visual_diff_attest_evidence）+ critic-receipt.json
    # 结构/覆盖校验（visual_diff_critic_receipt，image_inputs 须覆盖全部 attest crop）+
    # provenance 注记进 details。实施偏差（诚实边界升级）：tool_read 型 adapter（claude/cursor
    # 含 goal 态）由 agent 会话内 Read 图片，调用侧同样无法证明注入——goal 态回执首版也如实
    # unverified，verified 档保留给 native_attach/未来 transcript 验读增强（校准报告 §4 已记）；
    # goal-runner 原生落盘回执不在本刀（SSOT 指令 agent 侧写回执，harness 校验结构与覆盖）。
  - id: t8-openspec-schema-migration
    content: >
      OpenSpec 变更 + schema 迁移（**次序前置**，rev3 采纳 codex P2：t0 校准结论
      落盘后、t2-t7 实现动工前先立 OpenSpec——行为规格先行、实现对齐规格，
      不做实施后补票）：
      ①openspec/changes/layout-oracle-geometry-gates/（proposal.md + specs/visual-diff/
      spec.md 修订 + tasks.md，对齐 visual-diff-defect-enumeration 先例）——覆盖
      T8/M1/region_attest/reported_* 更名/layout_dump_status/forbidden_overlap，
      以及（rev4 补齐）：evaluation_invalidated 双新鲜度语义、critic-receipt.json
      schema 与 input_provenance、candidate-pass 两档位、critic 自动回修+no-progress
      指纹+预算熔断+candidate-pass 前禁 T2 的行为规格；
      ②visual-diff.json schema_version 1.0→1.1：region_attest[]/layout_dump_status/
      evaluation_invalidated/reported_* 新增；legacy 1.0 读入兼容（fidelity_score/
      geometric_iou 映射到 reported_*；M1 对 legacy 文件照常判——bc-openCard 旧文件
      是验收靶）；validateVisualDiffJson 双版本分支 + 模板/文档随动；
      ③ui-spec schema 随 t6 字段同步 bump 并写迁移注记。
    status: completed
    # 完成注记：openspec/changes/layout-oracle-geometry-gates/（proposal + specs/visual-diff
    # 7 项 Requirement + specs/ui-spec 4 项 + tasks），openspec validate --all --strict 33/33；
    # 次序按 rev3 前置执行（t0 校准结论落盘后、代码动工前完成规格）。visual-diff schema 1.1
    # 兼容按规格落地（legacy 读入映射，bc-openCard 旧文件 M1 照判——单测已复现命中）。
    # 注：ui-spec.schema.json 顶层 schema_version 仍 const "1.0"（新增字段为可选、旧文件
    # 全兼容，无破坏性变更故不 bump 文件版本；新字段已进 schema+运行时校验器双落点）。
  - id: t9-critic-iteration-loop
    content: >
      【主线 B②】独立 critic + 有界自动迭代（改 SSOT R5 单轮条款）：
      ①评审/实现分离：device-testing Step 4.6 的 VL 逐屏评审改由独立上下文执行
      （交互态=Task verifier subagent；goal 态=独立 critic phase），实现者不自审自屏；
      ②回修条款改写：「MVP 单轮+人工决定是否再迭代」→「critic must_fix → coding 修 →
      重采重判自动迭代，直至 candidate-pass 或熔断」。**candidate-pass 显式定义**
      （rev3）：无 BLOCKER/major defect + must_fix=[] + 必需 region_attest 与 critic
      回执有效 + T8/M1 无未处置命中 + advisory/minor 已枚举留待批量终审；分阶段语义
      ——A 线未上线时"确定性信号"按既有信号集（T1/T4/T5/P1-C/dedup）计，T8 上线后
      自动并入。**回执"有效"分两档（rev4，解交互态死锁）**：goal 态回执须
      input_provenance=verified → `candidate-pass(verified)`；交互态回执结构完整+
      attest 覆盖齐但 provenance=unverified → `candidate-pass(unverified)`，照常
      进入 T2 批量终审（若 unverified 不算有效，交互态永无 candidate-pass 而又
      禁提前求人=死锁），终审呈现时如实标注"视觉入模未经自动证明"，不得宣称
      已自动完成视觉审查。**no-progress 判据指纹化**（防同义改写逃熔断）：must_fix/defect 折算
      稳定指纹 `screen_id+defect_class+element/region+bbox_bucket` 比对集合，
      而非自然语言字符串比对；熔断=指纹集合两轮不变或达重试预算（复用 goal 既有
      预算语义，交互态默认 3 轮）→ halt 求人并给出残差清单；
      **candidate-pass 前禁止发起 T2 批量确认**；
      ③真人时点后移：candidate-pass 后才发起 T2 批量确认（visual 真人确认协议
      L74 逐屏展示语义不变，只是从"每轮修完就找人"变为"收敛后一次性批量审"）；
      ④与 L68 禁止弃判缝合：确定性 fail 在手必须当场修，不得借"等 critic"拖延。
      落点：skills/reference/device-testing-workflow-detail.md + device-testing SKILL +
      goal phase 配置；harness 侧只加 candidate-pass 判定辅助（既有信号聚合），不改门禁语义。
    status: completed
    # 完成注记：SSOT 单轮条款已改写（critic 独立上下文+五条件 candidate-pass 两档位+指纹化
    # 熔断+candidate-pass 前禁 T2+与禁止弃判缝合）；T2 主背靠段补时点后移；SKILL.md Step 4.6
    # 摘要随动；harness 侧 candidate-pass 档位注记进 await_human_confirm details（按回执
    # provenance 标 verified/unverified）。实施偏差：goal 态"独立 critic phase"以 SSOT 指令
    # +既有 verifier 通道承载，goal-runner 不新增独立 phase 代码（其重试预算/HALT 机制原样
    # 复用——headless 修判回路 L68 本就存在，本刀改的是交互态"单轮即找人"条款）；goal-runner
    # 原生落盘 verified 档回执随 transcript 验读增强另立项（校准报告 §4 诚实边界）。
    # rev8 再收窄（codex 两轮坚持，如实）：**跨轮指纹比较/熔断/自动调度的循环控制器代码
    # 未在本 plan 交付**——本 plan 交付的是熔断的判据设施（指纹纯函数+[fingerprints] 每轮
    # 输出+candidate-pass 机器判定含阻断性 WARN）与 SSOT 行为条款；控制器本体归 f7a3d9c2
    # t1/t3（已立项待 review）。"自动迭代至收敛"不得宣称为本 plan 已完成能力。
  - id: t10-tests-green
    content: >
      单测/fixtures：t0 校准数据脱敏固化为 fixture（bc-openCard layout dump 样本 +
      既有 visual-diff.json 作 M1 反例靶）；新增 layout-oracle A/B 类断言用例（含
      forbidden-overlap 命中/嵌套白名单不误伤/locator unmatched SKIP）、M1 三子检测 +
      evaluation_invalidated 用例（不触发重采/真人签字保留/未清标记 BLOCKER）、
      schema 1.0/1.1 双版本兼容用例、region_attest/critic 回执校验用例（含
      input_provenance=unverified 路径）、structure lint 阈值/overlay 合同用例；
      **critic loop 集成测试**（rev3）：收敛 case/同义改写不逃熔断（指纹稳定性）/
      预算耗尽熔断/candidate-pass 前不得求人/goal-交互两模式 parity；
      既有 p0-9-verdict-persistence / visual-defect-enum / round6-bbox 单测不破。
      cd harness && npx tsc --noEmit → npm run test（unit+fixtures）→ 根目录
      npm run openspec:validate（--all --strict，rev4）全绿。
    status: completed
    # 完成注记：新增 layout-oracle.unit.test.ts 14 例（dump 解析/locator 三级+歧义/A1 命中与
    # 豁免/A2/A3 advisory/B1B3+覆盖率 SKIP/C1 advisory/M1 bc-openCard 反例靶/schema 1.1 映射与
    # region_attest 校验/await 资格排除/t6④ 本地分母/declared 合并）；既有 visual-fidelity 4 例
    # 按新契约更新（缺分数不再 schema 错、灾难地板改 [skipped] 注记断言、await/忠实屏 fixture
    # 补 region_attest——变更均为 OpenSpec 已规格化行为，注释留了变更依据）；单测抓出并当场修复
    # B1 页面根豁免吞真背离 bug。tsc --noEmit 0 err；openspec 33/33；全量 unit+fixtures 见实施记录。
    # 实施偏差：critic loop 集成测试（收敛/熔断五案）未落自动化——熔断逻辑在 SSOT/agent 行为层
    # 而非 harness 代码，无纯函数可打靶；由 t11 宿主复验演示 run 验证（rev3 t10 该项对应此边界）。
  - id: t11-host-reverify
    content: >
      宿主复验（用户执行）：framework 同步宿主后重跑 bc-openCard device-testing——
      按分层验收核对：(b) 宿主先为 card_type_sheet 补
      `forbidden_overlap: [close, bank_surface]` 声明（t6⑤ 字段，rev4 补前置动作），
      随后 X 重叠被 T8-A 拦 BLOCKER+defect(overlap)；(a) 被 t6 spec
      合同前置拦截（树侧按校准结论核对 WARN/advisory 是否如实出现）；(c) C 类
      advisory 出现即达标；M1 对旧 visual-diff.json 触发常数/抄 floor 拦截；
      主线 B 演示 run：篡改 attest 证据可被 harness 拦，critic 迭代收敛或正确熔断。
      未命中项回 t0 校准报告登记为诚实边界，不粉饰。
    status: pending
    # 待宿主执行（rev6）：具体步骤清单见文末「实施记录 · t11 宿主复验步骤」；
    # 含真机校准 D1-D6（t0 顺延项）与三靶分层核对。framework 侧实现已就绪。
---

# 证据链（2026-07-10 核实，宿主 + framework 双侧；rev2 增补 E9–E14）

## 宿主侧：bc-openCard 实证（D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard）

| # | 证据 | 结论 |
|---|------|------|
| 1 | `spec/spec.md` L68-70：`ui_change: new_or_changed`、`fidelity_target: pixel_1to1` | 最严档，全部 pixel_1to1 门禁本应生效 |
| 2 | `device-testing/device-screenshots/visual-diff.json`：8 屏全 pass、`defects` 全 `[]`、`geometric_iou` 8 屏恒等 0.95 | 自报退化为填表：真实测量不可能 8 屏同值 |
| 3 | 同文件：7/8 屏 `fidelity_score` 与 `score_floor` **16 位小数逐位相同**（如 add_home_expanded 双双 0.9950983655946058；唯 card_detail 例外 0.850→0.943） | 自报分数=把脚本参考值原样抄回，非独立评审 |
| 4 | 同文件：card_type_sheet `fidelity_score` 0.99 = `score_floor` 0.99 压线；用户判"差异挺大"；add_home_expanded 0.995 用户判"OK" | 自报分数对人的验收标准零区分度（差 0.005） |
| 5 | `spec/ui-spec.yaml`：主屏有 bbox/layout_group/bg_color（L87-123、L159-161），card_type_sheet（P0）零 bbox/零 layout_group/零 bg_color；全文件 grep `spacing/gap/margin/padding/radius` 零命中 | overlay 屏几何合同完全空白，门禁未拦 |
| 6 | `spec/ui-spec.yaml` L2-3：`verified: unverified`/`verified_method: none`；`spec/phase-completion-receipt.md` L58：38 项 PASS 35/WARN 3/FAIL 0，WARN 含 unverified | 未验真的 spec 以 WARN 放行流入下游 |
| 7 | 用户人工检视缺陷清单：(a) 储蓄卡/信用卡未与银行同卡（结构）(b) X 按钮与银行区域重叠（碰撞）(c) 间距失衡（几何） | 全部落在管线无度量的维度；用户口头指出后立即修对 |
| 8 | `visual-diff.md` L27：8 屏全部"build 指纹有效跳采（判定持久，P0-9a）" | 早期宽松 pass 被合法持久化——机制正确，前提（判定可信）失守 |
| E9 | `doc/app-snapshot-cache/.../dump-ui-20260709.json`：schema `hylyre-hypium-ui-dump-v1`、源 `hypium.UiTree`；105 处 `bounds "[x1,y1][x2,y2]"`；attr 仅 bounds/clickable/id/key/scrollable/text/type，**无 bg/visibility/z-order/clip**；样本中 id/key 大量为空 | bounds 存在（cursor 核实一致）；但"白卡"surface 不可直接观测、locator 缺失——树是候选源非既成 ground truth（codex 深层疑虑坐实） |
| E10 | 既有两份 dump（20260708/20260709）grep「选择卡类型/储蓄卡/信用卡/招商银行/同意并继续」零命中 | 半模态**开启态**是否进树未经验证——t0 首要校准项 |
| E13 | `spec/ui-spec.yaml` card_type_sheet `must_have_elements`：title/debit/credit/agree_btn/agreement_hint 五项，**无银行行元素** | 参考图内银行行整个未建模——(a) 类缺陷 spec 元素级缺失，树侧断言无从谈起，主责必须前移 spec 合同（t6④） |

## framework 侧：机制溯源（探查 agent 2026-07-10 逐文件核实）

| # | 事实 | 位置 |
|---|------|------|
| F1 | `geometric_iou`/`fidelity_score` 全仓**无任何脚本计算/写入**，仅 `validateVisualDiffJson` 校验范围 [0,1]；采集层只写 pending 骨架 | `profiles/hmos-app/harness/visual-diff-check.ts` L211-383；`visual-diff-capture.ts` L512-529 |
| F2 | 灾难地板 `FINALIZED_MIN_FIDELITY=0.45`/`FINALIZED_MIN_IOU=0.40` 消费的是自报值 | visual-diff-check.ts L44-45 |
| F3 | 确定性信号全景：T1 锚点文本缺失（OCR）、T2 真人签字、T4 warn 须 must_fix、T5 全局元素越界（OCR）、P1-C 文本相对排布（OCR）、dedup 撞图——**无一几何信号**；score_floor 已降 reference_only、edge 哨兵永不 gate | visual-diff-check.ts L878-1103；visual-diff-ocr-gates.ts |
| F4 | Hylyre `dump-ui` 已接入（session start + dump-ui --out），输出落 snapshot-cache；框架消费者仅正则抽 `text/label/contentDescription`，**从不取 bounds** | `harness/scripts/utils/adhoc-dump-ui.ts` L38-79；`adhoc-summarize-dump.ts` L19-55；`app-snapshot-cache-hint.ts` L91-106 |
| F5 | Hylyre 为二进制 wheel，dump 完整语义（overlay/可见性/热区）仓内不可见 → 须真机实测（t0） | `profiles/hmos-app/vendor/hylyre/`；E9/E10 补充实测事实 |
| F6 | defects 契约是反向的：pass 须 defects 空 + 字段须存在（可为 `[]`）——空数组即免检，无逐区域举证要求 | visual-diff-check.ts L657-660、L696-699、L1117-1127 |
| F7 | `STRUCTURE_LINT_FLAT_LIST_MIN = 3`：card_type_sheet 2 行 list_selection 低于阈值静默放行 | `profiles/hmos-app/harness/capture-completeness-check.ts` L578 |
| F8 | ui-spec DSL 节点几何字段仅 bbox/width_ratio/align/layout_group；无 spacing/gap/containment 关系字段；containment 仅靠 children 嵌套隐含 | `harness/scripts/utils/ui-spec-shared.ts` L40-71；`harness/schemas/ui-spec.schema.json` |
| F9 | 项目铁律已成文："绝对位置类度量已被真机证伪，任何新确定性抓手须先过实测校准"；"ArkUI 运行时几何不可**静态** IoU"（静态≠运行时 dump，本 plan 走运行时） | `skills/feature/spec/reference/ui-spec.md` L106、L150 |
| F10 | P0-9a 跳采三硬前提（指纹非 null/指纹一致/截图 hash 一致）与 stale 重判逻辑健全 | visual-diff-capture.ts L217-233；visual-diff-check.ts L149-166 |
| E11 | 回修条款="must-fix 交 coding 修一轮（**MVP 单轮+人工决定是否再迭代**）"；真人确认协议="逐屏展示…一屏一屏等真人明确表态" | `skills/reference/device-testing-workflow-detail.md` Step 4.6 L63、L74——**逐页人工检视是设计行为**（R5 证据，codex 核实一致） |
| E12 | `package.json` version=3.0.0；`node scripts/check-plan-version.mjs` 对本 plan rev1（2.4.0）实测 FAIL："version < 当前 仍有未完成 todo，须 completed/cancelled" | 版本窗口修正 3.0.0；todo 终态词表=completed/cancelled（无 blocked） |
| E14 | OpenSpec 惯例：`openspec/changes/<name>/{proposal.md, specs/<cap>/spec.md, tasks.md}`，视觉链路先例 `visual-diff-defect-enumeration` | t8 依此建 change |
| E15 | vision-canary 三级判定：几何/颜色题全对=`tool_read`（真视觉）；**仅文字题对=`ocr_capable`、vision 仍 none**（疑似 Bash/OCR 代答）；全错=none | `harness/scripts/utils/vision-canary.ts` L5-13、L20——t6⑥ 视觉在位判据须用 tool_read（rev3 纠错） |
| E16 | 强制重采必丢真人签字：merge 层 `capturedHash !== evalHash` → `{...captured, verdict:'pending'}`（不带 confirmed_by）；且"像素恒等作新鲜度键被真机证伪（状态栏时钟/轮播必漂移）"——重采 hash 必变 | `profiles/hmos-app/harness/visual-diff-capture.ts` L240-272、L215——t4③ 评估/采集新鲜度必须解耦（rev3 codex P0 实锤） |

# 设计要点

## 三类几何不变量的置信分层（rev2 按 review 收窄）

| 类 | 信号源 | 阈值性质 | 首版 gate 档位 |
|----|--------|----------|----------------|
| **A forbidden-overlap 拓扑** | 仅运行时布局树；硬 gate 首版**只吃显式 forbidden_overlap/protected_region 声明 + 越界**；close 默认规则与全量两两扫描 advisory 起步（rev4 与 t3 对齐） | 零阈值拓扑事实 | 显式声明对：校准通过后 pixel_1to1 BLOCKER；close 默认规则：t0 FP 观察零误伤才晋级 |
| **B spec 派生结构** | 布局树 × ui-spec（依赖 t1 locator，unmatched 即 SKIP） | 关系判定；树无 surface 语义，共容器有 FP/FN 风险 | **WARN 起步**，校准+观察期后议升级 |
| **C 参考相对几何** | 布局树 × ui-spec ref bbox（间距比例） | 连续量 tolerance，最像被证伪的旧度量 | **永久 advisory**，只进 defects 不 gate |

历史证伪的对象是**截图像素/OCR 绝对位置估计**（device≠mockup 恒误报）；A/B 类读的是 UI 框架布局系统坐标（同源单侧、拓扑关系、缩放无关），与被证伪度量不同类。但仍按铁律全部过 t0 实测校准，拦不下就降级，不硬上。**(a) 同卡结构的主责防线是 t6 spec 合同**（分组容器强制声明+overlay 元素完整性），树侧 B 类只做辅助——树无背景色语义，"两块灰底 vs 一张白卡"在树上未必可区分（E9/E13）。

## 双主线分工（rev2 新增，治 R5）

```
主线 A：确定性 oracle
  t0 校准 → t1 locator → t2 采集 → t3 不变量 → t4 自报降权 → t6 spec 合同
  产出：客观几何缺陷在人看之前被确定性信号拦截

主线 B：VL critic 闭环
  t7 成对图证据 → t9 独立 critic + 自动迭代（单轮条款改写）→ 熔断/candidate-pass
  产出：主观/半主观差异由 critic 多轮自动收敛，人后移为批量终审
        ↑ critic must_fix → coding → 重采重判 ─┘（no-progress 或预算耗尽即熔断求人）
```

两线正交，candidate-pass 分阶段消解依赖（rev3）：B 线先行时 candidate-pass 按既有确定性信号集（T1/T4/T5/P1-C/dedup）+critic 计；A 线 T8 上线后自动并入硬前提。

## 实施切刀（rev3，采纳 cursor：12 todo 不在单窗口一次做完）

| 刀 | todo | 说明 |
|----|------|------|
| 第一刀 P0 治理 | t0 → t8（OpenSpec 前置）→ t4 → t6 | 零布局树实现依赖，自报退出 gate + spec 合同立即有用 |
| 第二刀 A 线 oracle | t1 → t2 → t3 | 依赖 t0 校准结论与 t8 规格 |
| 第三刀 B 线闭环 | t5 → t7 → t9 | 行为面最大改动，**单独里程碑验收**（与 T2 HALT/禁止弃判的语义缝合须实装仔细） |
| 收口 | t10 → t11 | 每刀完成即跑对应测试子集，t11 全量宿主复验 |

## 自报度量的定位（rev2 修正：退出 gate，而非围绕自报加规则）

`reported_fidelity_score`/`reported_geometric_iou` = VL 参考自评，零 gate 权重；灾难地板改吃真算值或 SKIP。M1 元检测只拦"退化模式"（常数/抄 floor/压线），定位是异常检测不是诚实性证明——真正的举证责任由 t5 region_attest（结构化）+ t7 成对图 crop 证据（harness 可验）承担，且 t9 使评审者独立于实现者。

## 人工介入面的演进路径（回答立项之问"为什么没做到全自动"）

现状：人=唯一对几何敏感的组件，且 SSOT 明文"单轮+人工决定迭代"（E11）→ 逐页调试者。
本 plan 后：A 线拦客观几何缺陷于人看之前；B 线让 critic 自动迭代到 candidate-pass；
人=收敛后的一次性批量终审（T2 语义不变、时点后移）+ taste 终审。
不承诺取消人看——taste/未形式化几何仍归人；承诺的是把人从"发现 X 按钮重叠"这类
机器可判的工作里解放出来。

## 与既有机制的缝合点

- T8 findings 以 check hits 报告（signal/bbox/可执行 note 全量携带），critic/VL 按 rubric 转录进 `defects[]`/`must_fix`（class 复用既有枚举）——harness 对判定文件保持只读（D3，tamper-scan 红线），下游 T4/D11/blockingDefectPass 经转录后消费（rev7 与 OpenSpec 已对齐此语义）。
- M1 与 T8 均走 `fidelityRatchetFailOrWarn`（pixel_1to1→BLOCKER），semantic_layout 档零噪声。
- 布局树文件与 P0-9a 同键持久（screenshot_hash + build 指纹），跳采屏不重 dump；M1 命中屏 `evaluation_invalidated` 只失效**评估**、不触发设备重采（t4③；采集/评估双新鲜度解耦，真人签字与采集持久化零扰动）。
- t9 critic 迭代复用 L68 禁止弃判的 headless 修判回路与 goal 重试预算，不另造循环机制。
- goal/普通模式：门禁全落 harness check 层，两模式天然同门禁；t9 的 critic 分离在两模式各有落点（verifier subagent / goal phase）。

# 外部 review 处置（rev2，逐条 ground-truth 核实）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex P0-1 | 缺"模型视觉 critic 回环"主线，plan 与用户目标不一致 | **成立**：SSOT L63"MVP 单轮+人工决定迭代"实锤（E11） | 采纳：新增主线 B（t7/t9）；保留 cursor 边界——T2 不砍，人后移批量终审 |
| codex P0-2 | dump-ui 只是候选源，不能先称 ground truth | **大部成立**：bounds 已实测存在（cursor 对），但无 bg/visibility/z-order、overlay 进树未验证、(a) 不可直接观测全部坐实（E9/E10） | t0 重写聚焦四个未知；R4 措辞改"候选数据源" |
| codex P0-3 | 缺 ui-spec↔运行时 locator 协议 | **成立**：dump 中 id/key 大量为空（E9） | 新增 t1（.id() 注入主方案+fallback 匹配器+覆盖率门禁） |
| codex P1-1 | 全量两两相交过宽 | **成立** | A 类收窄：关闭钮默认规则+spec 声明对；全量扫描降 advisory |
| codex P1-2 | M1/region_attest 治形式非事实；自报应退出门禁 | **成立** | t4 重写：reported_* 更名+退出 gate+灾难地板改真算/SKIP；M1 定位改异常检测；t5 绑定证据；t7 承担举证 |
| codex P1-3 | 验收自相矛盾（C 类 advisory vs 三类全拦） | **成立**（rev1 L44 vs L77-78） | 验收改分层：(b) 硬拦/(a) 依校准/(c) advisory 即达标 |
| codex P1-4 / cursor 1 | 版本 2.4.0 应为 3.0.0 | **成立**：check-plan-version 实测 FAIL（E12） | 已改 3.0.0 |
| codex P1-5 | 缺 schema 迁移与 OpenSpec | **成立**：仓内有 OpenSpec 惯例（E14） | 新增 t8 |
| codex 附注 | blocked 非法状态词 | **成立**：门禁词表 completed/cancelled（E12） | t0 失败分支改 cancelled+另立 plan |
| cursor 2 | (a) 同卡可判性偏乐观，主责应是 spec 合同 | **成立**：树无 surface 语义+银行行未建模（E9/E13） | t0 预期结论明写；t6 新增④元素完整性；B 类 WARN 起步 |
| cursor 3 | 验收话术须与"不取消人看"对齐 | **成立** | 同 codex P1-3 处置+新增"人工介入面演进路径"节 |
| cursor 4 | t0 不必再验"有没有 bounds" | **成立**（E9） | t0 重写 |
| cursor 5 | coding 侧实现后自检缺失 | 成立但**面积外** | 非目标④显式登记另立项；critic 回环部分缓解 |
| cursor 6 | M1 与 confirmed_by/跳采交互未定义 | **成立** | t4③显式定义（真人签字不作废；rev3 进一步改评估/采集解耦） |

## rev3（第二轮 review，codex Request changes / cursor 通过）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex rev3 P0-1 | crop 文件存在 ≠ 模型真看过图 | **成立**（逻辑必然：文件证据只证明预处理产出） | t7 重写：goal 态 critic 调用回执（image_inputs[]+hash 全链）；交互态 input_provenance=unverified 如实标注 + SSOT 强制 Read crop（采 cursor 方案）；措辞改"素材物化+调用回执，非模型认知" |
| codex rev3 P0-2 | selfreport_invalidated 把重判做成重采，会丢真人签字 | **成立**：merge 层 hash 漂移 → `{...captured, verdict:'pending'}` 丢 confirmed_by；时钟漂移使重采 hash 必变（E16 源码实锤） | t4③ 改 `evaluation_invalidated`——评估/采集双新鲜度解耦，不触发重采、签字保留、未清标记 BLOCKER |
| codex rev3 P1-1 | ocr_capable ≠ 视觉在位 | **成立**：vision-canary.ts L5-13——ocr_capable=仅文字题对、vision 仍 none（E15） | t6⑥ 判据改 fresh canary verdict=tool_read；ocr_capable/none 不升级 |
| codex rev3 P1-2 | close 默认规则仍过宽 | **成立** | t3 硬 gate 首版只吃显式 forbidden_overlap/protected_region；close 默认规则 advisory 起步、t0 ④FP 观察零误伤才晋级；bounds 语义（视觉 vs 热区）t0 ②裁定 |
| codex rev3 P1-3 | no-progress 可被同义改写逃逸；candidate-pass 未定义 | **成立** | t9 指纹化（screen_id+defect_class+element/region+bbox_bucket）+ candidate-pass 五条件显式定义 + candidate-pass 前禁求人；t10 加 critic loop 集成测试五案 |
| codex rev3 P2-1 | OpenSpec 应前置而非收口件 | **成立** | t8 次序改"t0 后、实现前"；切刀表固化顺序 |
| codex rev3 P2-2 | lint 3→2 全局误伤任意双 list | **部分不成立**：lint 源码本就 isPixel1to1+priority==='P0' 双闸限定；既有出口=各行独立 layout_group/各建 bg_color 容器 | t6① 补范围澄清与出口文案，不新增 separate_surfaces 字段 |
| cursor rev3 1 | 切刀顺序；candidate-pass"A 硬前提 vs B 并行"表述拧巴 | **成立** | 新增「实施切刀」节；candidate-pass 分阶段语义 |
| cursor rev3 2 | 同 codex P0-1，防线应落 SSOT Read 强制 | **成立** | t7③ 采纳 |
| cursor rev3 3 | M1 不会单独翻案已签屏（有意为之） | 属实 | 维持设计；验收仅承诺"M1 触发拦截" |
| cursor rev3 4 | t9 行为面最大，单独里程碑 | **成立** | 切刀第三刀单独验收 |
| cursor rev3 5 | overlay OCR 分母防装饰字误伤 | **成立** | t6④ 沿用 defer+真人签既有出口 |

## rev4（第三轮 review，codex 有条件通过 / cursor 通过，收口件）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex rev4 P1-1 / cursor rev4 1 | t8 残留旧字段名 selfreport_invalidated | **成立**（rev3 只改了 t4/t10/缝合点，漏 t8） | t8 统一 evaluation_invalidated |
| codex rev4 P1-2 | 交互态 unverified 回执与 candidate-pass 互斥成死锁 | **成立**（t9"回执有效"未定义档位） | t9 增两档位：goal 态 verified 档；交互态 unverified 档照常进 T2 终审并如实标注 |
| codex rev4 P2 | OpenSpec 覆盖面欠列 + 缺 validate 命令 | **成立**（`npm run openspec:validate` 实测存在：openspec validate --all --strict） | t8① 补五项覆盖；t10 加 validate 命令 |
| cursor rev4 2 | 三类几何表 A 行与 t3 不同步 | **成立** | 表改"硬 gate 只吃显式声明；close 默认 advisory 起步" |
| cursor rev4 附带 | t11 (b) 漏写宿主先补 forbidden_overlap | **成立** | t11 补前置动作 |

## rev7（代码 review：codex Request changes / cursor 建议修 5 条后合入）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex P0 | critic 自动循环未实现（无独立 critic 启动/自动回 coding/指纹比较/熔断/禁提前 T2 的代码） | **部分成立**：指纹无代码、goal critic phase 未落（rev6 完成注记已如实登记）；**部分不成立**——"禁提前 T2"已是机器强制：awaitHumanOnly 仅在全部 FAIL hit 均为 T2 时归类 await_human_confirm，任何 T8/M1/attest/回执 FAIL 在手都不会触发求人路径（e2e 用例 rev7_attest_without_receipt 断言了这一点）；"自动回 coding"在 goal 态=既有重试回路（L68 禁止弃判），交互态=SSOT 驱动（框架架构即 skills 驱动 agent） | 受理可落码部分：指纹纯函数三件套（computeDefectFingerprint/collect/setsEqual，0.1 网格分桶+同义改写免疫，单测覆盖）+ check details 输出 [fingerprints] 行（两轮逐字相同=no-progress 机器可比）；goal-runner 原生 critic phase 与 verified 回执生产 → D9 另立项（OpenSpec tasks 5.4 open，不冒称完成） |
| codex P1-1 | vl_screening-only attest 可免回执进 candidate-pass(unverified) | **成立**（绕过路径实锤） | 回执在**任何** region_attest 存在时必需；e2e 回归靶 rev7_attest_without_receipt_blocks_e2e |
| codex P1-2 / cursor 4 | region_attest 只验非空，泛化 region 可替代逐区域 | **成立** | 补 must_have_elements 覆盖校验 + diff_logged 须关联 defect/must_fix；e2e 回归靶 |
| codex P1-3 | 回执 hash 从不重算、evidence 不限目录 | **成立** | image_inputs[].hash 提供即重算比对；verified 档逐项 hash 必填；evidence 限 _attest/ 目录 + mtime 不早于被评截图 |
| codex P1-4 / cursor 2 | T8 不写回 defects[] 与 OpenSpec 冲突 | **成立**（规格-实现失配） | 采 cursor 方案：OpenSpec 改为 D3 语义（check hits 报告+critic 转录，harness 对判定文件只读）；plan 缝合点文案同步 |
| codex P1-5 | status=captured 但 dump 缺失/损坏 → 静默跳过 | **成立** | 显式 WARN"声称已采集但文件缺失/不可解析" |
| codex P2 | capture 仍写 schema 1.0；ui-spec.schema.json 未登记新字段；tasks 2/21；集成测试缺 | **成立**（schema.json 系 rev6 一次 Edit 失败后漏补——低级失误） | capture 升 1.1；schema.json 补 forbidden_overlap/protected_region/must_have_elements；tasks 按实勾选（5.4/6.3 保持 open）；补 3 个 e2e FAIL 用例 |
| cursor 1 | A-4 宣称未实现且不在偏差台账 | **成立** | 补实现（两两 advisory 上限 8）+ 单测 + D10 登记失误 |
| cursor 3 | schema.json 靠 additionalProperties 偷过 | **成立**（同 codex P2） | 同上 |
| cursor 5 | e2e 缺口 + tasks 与 plan 状态不一致 | **成立** | 同 codex P2 处置 |
| cursor minor | crop mtime 未验/指纹无纯函数/缝合点文案矛盾 | **成立** | 全部落码/改文案；.id() lint WARN 档维持 D4（t11 话术已强调补 .id） |

## rev8（第二轮代码 review：codex Request changes / cursor Minor 不挡合入）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex P0 | 自动 critic 循环仍未落地；且 collectDefectFingerprints 只读 defects[]——"只有 must_fix"轮次指纹空集，熔断比较真空成立 | 循环控制器部分**维持 rev7 处置**（跨轮状态/比较/调度归 f7a3d9c2 t1/t3，用户已立项待 review；t9 完成注记已再度收窄措辞）；**指纹空集是新实锤，受理** | must_fix 按条数入纹（`screen\|must_fix_count\|N`，计数式措辞免疫：改写文案条数不变→判无进展正确，修掉一条→条数变→判有进展）；单测三态覆盖 |
| codex P1-1 | candidate-pass 忽略未处置 T8/M1 WARN | **成立**（awaitHumanOnly 只排除额外 FAIL） | 新增阻断性 WARN 集（layout_invariants/selfreport_integrity）取消 candidate 资格；**边界修正（实施中自查）**：dump 缺失/OCR 降级是能力降级非未处置发现，纳入阻断会让无该能力宿主永远无法收口（死锁），不入集、随批量终审呈现——OpenSpec 已写明此边界；单测 (d) 分支 + M1 压线阻断案 |
| codex P1-2 | verified 回执可用空 image_inputs 伪造（"每项有 hash"对空数组真空成立） | **成立**（codex 反例逐字复现进单测） | adapter 必填；image_inputs 非空且逐项合法 path（任何档位）；verified 追加 output_hash 必填 + 覆盖全部被评截图；三处夹具随新契约更新；负例单测 rev8_verified_empty_inputs |
| codex P1-3 | _attest crop 只验"存在+新鲜"，未绑定"内容对应"（plan t7 原文的三 hash+bbox 未落） | **成立** | RegionAttestEntry 增 evidence_hash/source_screenshot_hash/source_ref_hash/source_bbox（paired 必填，schema 拦）；门禁重算 evidence_hash、比对 source_screenshot_hash 与该屏 evaluated hash——任意图片拷进 _attest 刷 mtime 不再作数 |
| cursor minor-1 | A-4 缺专测，D10"已补码+单测"说满 | **成立** | 补 A-4 三案（相交 advisory/亲缘豁免/上限 8）；D10 措辞修正 |
| cursor minor-2 | t11/D9 保持 open | 属实（按设计） | 不变 |

## rev9（第三轮代码 review：codex Request changes——2 修实/1 部分/1 已拆入后续 plan 的余量收口）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex P0 | 自动闭环仍未实现（本轮已不冒称完成，方向确认） | 定性确认，非新问题 | 维持：判据设施在本 plan、控制器在 f7a3d9c2（用户指示本轮不动新 plan）；t9 注记 rev8 已写明"不得宣称已完成" |
| codex P1-1 | unverified 回执可引用不存在/无关图片（不存在文件、不覆盖被评截图） | **成立**（codex 反例逐字复现进单测） | 文件存在性 + 被评截图覆盖改为**两档通用**——unverified 只豁免"注入证明"（hash/output_hash），不豁免"文件真实且与本轮相关"；顺带修出检查自身的路径归一化 bug（Windows 正/反斜杠混用致覆盖比对假阴，path.resolve 双侧归一） |
| codex P1-2 | source_ref_hash/source_bbox 只必填不验真 | **成立** | ref hash 可解析时重算比对（任意字符串不再作数）；source_bbox 如实定位为声明性元数据——像素级"crop 确为该区域"归 critic/人审，确定性门禁不做图像重裁（超出零阈值承诺，OpenSpec 已写明边界） |
| codex P1-3 | must_fix_count 计数入纹会把"同数异质问题"误判成无进展 → 错误熔断 | **成立**（rev8 修法引入的新缺陷，撤销） | 采纳 codex 方案：新增 isRoundFingerprintable——must_fix 未转录为结构化 defects 的轮次**无资格**参与指纹比较（[fingerprints] 行显式标 ineligible），转录（f7a3d9c2 t2 audit）使其恢复资格；单测覆盖无资格/已转录/纯 defects 三态 |

## rev10（第四轮代码 review：codex Request changes——余量两条全收）

| 来源 | 意见 | 核实结论 | 处置 |
|------|------|----------|------|
| codex P1-1 | "部分转录"轮次（must_fix 2 条+defects 1 条）仍获指纹资格——未转录余量漏纹，下一轮换个问题仍可能指纹相同 → 错误熔断 | **成立**（rev9 修法的边界漏洞） | isRoundFingerprintable 收紧为逐屏 `must_fix ≤ defects` **必要条件近似**——错向安全侧（宁可判无资格推迟熔断退回预算兜底，绝不误熔断）；注释与 OpenSpec 均如实声明"完整逐条对账归 transcription audit/关联 id，本函数不冒称"；单测补部分转录负例 |
| codex P1-2 | 结构合法的手写 verified 回执（真实路径+真实 hash+任意 output_hash）仍可产 candidate-pass(verified) | **成立**——且按 D5/D9，verified 档**当前本无合法生产者**，今天任何 verified 回执必为手写冒充 | 采纳 codex 方案一：签发链（f7a3d9c2 t3 runner 签发段）落地前 verified 主张一律**降级 unverified 呈现**+显式 WARN（"暂不采信"）；verified 主张触发的更严校验照常执行（主张更强查得更严）；tier 恒 candidate-pass(unverified)（TS 死代码检查顺带确认）；e2e 复现 codex 反例（真实 hash 手写回执 → 降级+WARN+无 verified 字样） |

# 兼容性核查（rev5：对照 e8f5a2c7 + d7e4b2a9 落地后基线，2026-07-10）

两 plan 均已入主干（e8f5a2c7=46536232，d7e4b2a9=ec3ca25d），逐项核查结论：

| # | 核查项 | 结论 |
|---|--------|------|
| C1 | **文件重叠** | **零重叠**。两 commit 触碰面（agents/ hooks、init 链、framework-integrity、canonical-gitignore、pack 脚本 / hvigor-runner、hdc-runner、device-test-build-reuse、check-testing build 门禁文案）与本 plan 落点（visual-diff-capture/check、capture-completeness-check、fidelity-shared、adhoc-dump-ui、vision-canary、device-testing SSOT、ui-spec schema）无交集；git log 核实 visual-diff 系文件最后修改仍是 d5686a37/a62d0898——本 plan 全部 file:line 引用仍有效 |
| C2 | **check-testing.ts 改动** | 仅 device_test_build 门禁 FAIL/PASS 的 details 文案增强（scannedDirs/候选歧义/stale 提示），不触 visual-diff 调度——t3 T8 / t4 M1 接入点不受影响 |
| C3 | **build 指纹链（t2 绑定键）** | **正向依赖修复**：resolveCurrentBuildFingerprint 读 install meta hapPath 现算 sha256，hapPath 来自被 d7e4b2a9 去硬编码的产物发现链——先前 `outputs/<product>` 布局宿主 hapPath=null→指纹 null→P0-9a/await_human_confirm 失能；现已修复，t2 的 dump-指纹绑定在更多宿主布局下可用。detectStaleSignedSuspect 纯观测，指纹始终现算自实际安装文件，语义不变 |
| C4 | **runtime-artifact-policy.json（G1/G2 SSOT）** | 本 plan 宿主侧运行产物（layout-\*.json、\_attest/\*.png、critic-receipt.json、visual-diff 增字段）全部落 `<features_dir>` 下，**不在** 宿主 framework/ 树管辖域——无需登记。防御性规则（写给实施者）：**若实现中新增任何落宿主 framework/ 树内的运行时产物，必须先登记 policy json**（三方同源，单测钉死），否则 G2 判 foreign BLOCKER |
| C5 | **新增框架源文件**（layout-oracle-check.ts 等） | pack-release 生成 manifest 时自动纳入，无需手工登记；G3a EOL 归一对新 .ts 文件自动生效 |
| C6 | **G1 写时守卫 vs 本 plan 实施** | 实施发生在 framework 源仓（本仓），守卫只作用于宿主的 materialized framework/——不拦；t0/t11 宿主侧动作只写 features 目录与 scratch/（t0/t7 已补注记） |
| C7 | **t11 宿主复验的同步链** | init 防覆盖链（preflight→materialize/sync 结构化合并）是 framework 升级的合法路径，framework-owned 文件正常更新；hooks 走 hooks_config upsert 不整文件覆盖——同步本 plan 改动无额外动作 |

新增实施注记两条（已写入 todo）：t0 宿主临时脚本走 scratch/（G4）；t7 critic-receipt.json 路径钉死 features 目录（G2/G1）。

# 实施记录（2026-07-10，rev6）

## 完成态

三刀全部落地（t0-t10 completed，t11 待宿主执行）：
- **第一刀 P0 治理**：t0 离线校准报告（`docs/operations/layout-oracle-calibration.md`）→
  t8 OpenSpec（`layout-oracle-geometry-gates`，validate 33/33）→ t4 自报降权+M1+评估解耦 →
  t6 spec 合同六项。
- **第二刀 A 线**：t1 locator（layout-oracle-check.ts + coding `visual_parity_element_id_lint`）→
  t2 采集 dump（layoutDumpFn 注入式 + buildHylyreLayoutDumpFn + check-testing 装配）→
  t3 T8 门禁（`visual_diff_layout_invariants` A/B/C 分层，档位按校准决定表保守起步）。
- **第三刀 B 线**：t5 region_attest 门禁+rubric → t7 attest 物证+critic 回执校验+provenance →
  t9 SSOT 单轮条款改写（critic 迭代/指纹熔断/candidate-pass 两档/禁提前 T2/T2 时点后移）。

## 验证

- `npx tsc --noEmit`：0 错误。
- 单测：layout-oracle 新套件 14/14；visual-fidelity 86/86（4 例按 OpenSpec 新契约更新）；
  全量 unit+fixtures 全绿（见收口运行记录）。
- `npm run openspec:validate`：33/33。
- check-plan-version：PASS。

## 实施偏差台账（对照 approved plan，全部当场登记）

| # | 偏差 | 理由 |
|---|------|------|
| D1 | t0 拆"离线校准（本轮完成）+ 真机 D1-D6（步骤清单，随 t11 执行）" | 实施时 `hdc list targets` 空（无连线设备）；依赖真机结论的 gate 升级（A-3→BLOCKER）保持未启用，保守档位落码 |
| D2 | t0③ 结论升级：ArkUI .id() 透传**已离线确证**（dump 中宿主自有 `home_header_add`/`promo_no_card` 在案），非"待真机验证" | 既有 dump 数据即证据，t1 主方案直接启用 |
| D3 | T8 findings 不由 harness 写回 visual-diff.json defects[]，改为 check hits 全量携带（signal/bbox/note），critic 按 rubric 折算 | check 只读设计 + tamper-scan 红线（"判定只能由 capture/真人产生"）——harness 写判定文件会模糊自己划的边界；下游 T4/D11 语义不变 |
| D4 | t1 coding .id() lint 首版 WARN（非硬门禁） | 缺 .id 不产生错误判定、只降 locator 覆盖率（device 侧 B 类 SKIP+WARN 双保险）；观察期后按数据议升级 |
| D5 | t7 goal 态回执首版也 `input_provenance: unverified` | tool_read 型 adapter（claude/cursor 含 goal 态）由 agent 会话内 Read 图片，调用侧同样无法证明注入——verified 档保留给 native_attach/未来 transcript 验读；比 plan 原文更诚实 |
| D6 | t6④ overlay 本地分母：root bbox 可框定 → ratchet；不可定 → advisory 复核清单 | overlay 参考图含背景透出的基屏文本（合法归属基屏），无区域界定的硬 gate 必产 FP——校准铁律"拦不下降 advisory" |
| D7 | critic loop 收敛/熔断五案集成测试未自动化，由 t11 演示 run 验证 | 熔断逻辑在 SSOT/agent 行为层，harness 无纯函数可打靶 |
| D8 | ui-spec.schema.json 文件版本不 bump（仍 1.0） | 新增字段全部可选、零破坏性；visual-diff.json 才有 1.0→1.1 语义变化（reported_* 更名），已双版本兼容 |
| D9 | goal-runner 原生 critic phase 与 verified 档回执（transcript 验读）另立项（OpenSpec tasks 5.4 保持 open） | tool_read 型 adapter（claude/cursor 含 goal 态）调用侧无法证明图片注入——verified 档当前**没有诚实的生产者**，先造生产设施再挂门禁；unverified 档链路（回执结构+覆盖+hash 验真）已闭环 |
| D10 | rev6 曾在注释/校准表宣称 A-4 但未实现（cursor 抓出），rev7 补实现、rev8 补专测（相交/亲缘豁免/上限 8——rev7 时"已补单测"亦说满，cursor 二度抓出） | 承认失误 ×2：宣称先于实现、宣称先于测试；现实现+专测齐 |
| D11（rev8） | layout dump 采集改为仅 pixel_1to1 档 wiring（初版对所有 ui_change=new_or_changed 特性无差别采集） | 轻量化守恒（用户 2026-07-11 质询触发核查）：semantic_layout/reference_only 档不应付每屏 dump-ui 设备调用成本——违反本 plan 自己"semantic_layout 档零噪声"承诺；T8 对低档本就只 WARN 观察，重量跟着保真承诺走（d4a7c1e8 原则） |

## t11 宿主复验步骤（用户执行，framework 同步宿主后）

1. **真机校准 D1-D6**（`docs/operations/layout-oracle-calibration.md` §2，设备连线后）：
   重点 D1——导航至 card_type_sheet 开启态 dump，确认 overlay 进树（不进树 → 按 t0 分支
   将 t2/t3 布局子信号置 cancelled 另立 Hylyre 上游 plan）。
2. **宿主 ui-spec 补声明**：card_type_sheet 补 `forbidden_overlap: [[close_btn, bank_surface]]`
   （连同银行行/分组容器建模——t6 门禁会引导）；coding 为 P0 屏声明元素补 `.id()`。
3. **重跑 device-testing**，分层核对：(b) X 重叠被 T8-A1 拦 BLOCKER；(a) 被 t6 spec 合同
   前置拦（lint 3→2 + overlay 合同 + 本地分母）；(c) C1 advisory 出现；M1 对旧
   visual-diff.json 触发常数/抄 floor 拦截并要求 evaluation_invalidated 重评。
4. **主线 B 演示 run**：篡改 attest 证据路径 → harness 拦；critic 迭代 ≥2 轮收敛或正确熔断；
   candidate-pass 前无 T2 批量确认请求。
5. 未命中项回校准报告登记为诚实边界，不粉饰。
