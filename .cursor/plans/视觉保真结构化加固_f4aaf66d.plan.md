---
name: 视觉保真结构化加固
overview: 在 agent-maison 2.4.0 窗口内，按"五环短板"重排优先级——把投入从 coding 门禁（第二强环）转向真正的根因：①捕获完整性（参考图→ui-spec 逐元素强制表态、以参考图侧枚举为分母的覆盖校验）与⑤反降级治理（fidelity_target 全链路 ratchet、P0 视觉元素 defer 须人类签字）。再补④验证闭环（双向 diff 残差达标、放水点收紧）与③素材供给（三级策略 + 素材需求清单，拒绝 AI 山寨）。coding 门禁瘦身为背板。命门是严重度：pixel_1to1 下关键视觉项必须 FAIL/BLOCKER，不得做成又一堆 WARN。全程 framework-only、不 bump 版本，并用 A/B/C 三分法诚实管理预期。
todos:
  - id: p01-governance
    content: 治理层（⑤）——visual_handoff 新增 fidelity_target(pixel_1to1|semantic_layout)，复用现有 visual_handoff_enforcement 档位把全链路 spec/coding/testing 视觉门禁 WARN→FAIL/BLOCKER ratchet；P0 视觉元素 defer 须登记 fidelity_deferrals 且人工签字（goal-runner 暂停确认，headless 无批准即 BLOCKER），判据=有无人类签字而非有无登记；消灭 spec 自我 defer + 自我 verified
    status: completed
  - id: p02-capture
    content: 捕获完整性（①，新重心）——ui-spec 扩 semantic_role/color_ref/icon/badge + 屏级 must_have_elements；spec SKILL 增"分区扫描模板"强制 VL 逐区逐元素 implement|defer 二选一并产出 spec/ref-elements.yaml；新增 capture-completeness-check.ts，分母取自参考图侧独立枚举（非 ui-spec 自身/非 countMappableNodes），pixel_1to1 覆盖不足→BLOCKER；诚实标注 VL 依赖与非 100% 上限
    status: completed
  - id: p11-verify-loop
    content: 验证闭环+收紧放水点（④）——C1 static-fidelity:117 placeholder 不再免分母(pixel_1to1 计入未覆盖)；C2 static-fidelity:80-95 改节点→token 绑定校验(非 token 存在性，brand.cmb 等已存在)；visual-diff-check 加双向 diff(反向=参考图有实现无)+截图去重+NxN 分块最小块；pixel_1to1 下 lowScorePass/scoreFloorSentinel/must_fix→BLOCKER；验收升级为残差达标
    status: completed
  - id: p12-asset-supply
    content: 素材供给（③）——联动规则：pixel_1to1 时 asset_acquisition_mode 默认抬升 user_dir+触发 D1 清单，不得静默停在 approximate；spec 阶段盘点产出 spec/asset-manifest.yaml 反馈用户；三级策略：用户素材目录(asset_pack kind 或 spec.asset_sources 自动映射资源 key)＞清晰图裁剪(诚实标覆盖率上限,接通既有 asset-acquisition.ts)＞知情占位(显式占位清单,pixel_1to1 下非空≥WARN)；明确拒绝 AI 生成缺失资产
    status: completed
  - id: p2-coding-backstop
    content: coding 背板（②，瘦身）——coding-visual-parity/static-fidelity 只保留两条轻校验：节点→token 语义色绑定(C2)与 must_have_elements presence(C3)兜底；删除过度项；placeholder 仅限品牌矢量资产；登记 coding-rules.overlay.yaml / verify-coding.md
    status: completed
  - id: scope-tests-baseline
    content: 预期边界+出口——A/B/C 三分法写入 SKILL/文档定预期(C 动态交互不纳入承诺)；补 harness 单测/fixture 注册 run-unit.ts，cd harness && npm test 全 PASS；用 bc-openCard(pixel_1to1+银行 logo 素材目录)跑双向 diff 量化五环提升基线；不动 package.json.version
    status: completed
isProject: false
---

## 视觉保真结构化加固（framework-only，窗口 2.4.0，不 bump 版本）

> 版本绑定 `version: 2.4.0`（与 `package.json.version` 一致，遵循版本演进规则，不改版本号）。改动均属发布内容（`harness/` `specs/` `profiles/` `skills/`），完成后 `cd harness && npm test` 必须全 PASS（AGENTS.md BLOCKER）。

### 工程命题：最终保真度 ≈ 五环相乘（短板决定结果）

`最终保真度 ≈ 捕获完整性 × 转译保真 × 资产供给 × 验证闭环 × 反降级治理`

bc-openCard 五环打分（启发式，用于定优先级，非精确值）：
- ① 捕获完整性（参考图→ui-spec）：~0.4 ← **最大短板**。ui-spec 极抽象，搜索框/角标/logo/图标大量未记，VL 主动 defer。
- ② 转译保真（ui-spec→代码）：~0.85。**coding 忠实实现了一个被降级过的 spec**——这是第二强环，不是瓶颈。
- ③ 资产供给（logo/卡面/插画）：~0.2。全 placeholder，无真素材来源（物理瓶颈）。
- ④ 验证闭环（实现→参考图）：~0.4。全局相似度被白底稀释，无逐元素比对。
- ⑤ 反降级治理：~0.3。spec 可自我 defer + 自我 verified，review 对视觉无感。

**优先级结论**：把精力投在"给 coding 加更多检查"是在第二强环上使劲、ROI 低。本计划重心移到 ①捕获 + ⑤治理（直击根因、不依赖外部素材、投入相对小），coding 门禁瘦身为背板。

### 两条贯穿全计划的命门（执行者务必领会）

1. **严重度是命门，别做成"又一堆 WARN"**：当前视觉检查绝大多数是 MAJOR/WARN，于是 goal-runner / review 一路"有条件通过"，降级照样发生（bc-openCard 的 review 就放行了 4 个 MAJOR）。`fidelity_target: pixel_1to1` 下，关键视觉项**必须 FAIL/BLOCKER**，否则本次改造等于没做。
2. **门禁有数学盲区**：现有所有视觉门禁校验的都是"spec 内部一致性"（spec 声明的有没有被实现），**没有任何一个**校验"spec 相对参考图漏了什么"。漏写进 ui-spec 的搜索框根本不在分母里、覆盖率照样 100%。这是 1:1 的第一性瓶颈，P0-2 专解。

### 根因证据（带行号，动手前先核对）

- **根因一·spec 显式协商降级且无人质疑**：`spec.md:63`「搜索框、NFC、协议跳转…均不在本 scope」；`spec.md:126/127/168`「搜索框本轮不实现」；`spec.md:131/214`「NFC 本轮不实现」；`spec.md:223` 宫格「可 toast 占位」（即图标全变 `⋯` 来源）；`spec.md:340`「100 家文案改为 20 家」；`acceptance.yaml AC-11(P1)` 把「不出现搜索框」写成验收标准。**这些 defer 全是"已登记"的**——故判据必须是"有没有人类签字"，非"有没有登记"。
- **根因二·数学盲区**：`profiles/hmos-app/harness/visual-structure-parity.ts` 的 `countMappableNodes(72-87)` **以 ui-spec 已有节点数当分母**，漏写的元素不在分母、覆盖率仍 100%。
- **根因三·验证放水点**：`static-fidelity-score.ts:117` `if (a.placeholder) continue;`（placeholder 资产被排除出分母，全占位仍报 100%）；`static-fidelity-score.ts:80-95` 的 color ΔE 只比「token 定义色值 vs color.json 色值」，**不校验「哪个节点该用哪个 token」**——故"成功✓该绿用了蓝"不会被发现。**事实修正**：`brand.cmb:#C7000B` 招行红等品牌色 token **已存在且值正确**，真问题是**无节点引用 / 无 semantic 绑定**，所以校验必须是"节点→token 绑定"而非 token 存在性。`visual-diff-check.ts` 基建相当完整（ref 关联 / `PASS_MIN_FIDELITY` / `score_floor` 哨兵 / P0 覆盖 / 防错图 hash），但放水在 (a) 几乎全 MAJOR/WARN、(b) `must_fix` 仅 `verdict=fail` 必填且不强制反向枚举。
- **根因四·无素材供给**：`plan/visual-parity.yaml` 把 logo/卡面/插画全映射 `*_placeholder`、ui-spec `assets` 全 `placeholder:true`；既有裁图/采色（`asset-acquisition.ts`）因全 placeholder **从未触发**。

### 三类差距与"能达到的上限"（诚实管理预期，写入文档）

- **A 结构与样式**（搜索框有无、成功/颜色、角标、文案数量、布局、字号、品牌色）：信息代码可表达 → **framework 主战场，可逼近 1:1**。
- **B 美术资产**（bank logo、向日葵卡面、扫码插画）：代码写不出、缩略图裁不全 → **取决于素材供给，零素材输入做不到 1:1**。
- **C 动态与交互**（动效、转场、点击反馈、滚动）：参考图（静态截图）根本不含此信息 → **不纳入"参考图复刻"承诺**。

天花板：用户给"需求+参考图+素材目录+声明 1:1" → 可做到很高保真；只给"需求+参考图、零素材" → 结构逼近、美术资产做不到 1:1。任何"只给参考图就能全自动 1:1"的说法都是在 B、C 上撒谎。

---

## P0-1 治理层（⑤反降级，根因开关，投入最小）

把"1:1 意图"变成一条全链路硬开关 + P0 视觉元素 defer 的人工 gate。

- 需求入口识别用户"尽可能 1:1 / 像素级 / 严格按设计图"诉求 → 在 visual_handoff yaml 块置 `fidelity_target: pixel_1to1`（默认 `semantic_layout`，保持既有行为/零噪声）。解析见 [`harness/scripts/utils/ui-spec-shared.ts`](harness/scripts/utils/ui-spec-shared.ts) 的 `parseVisualHandoffYamlRoot`（已拿到整个 yaml 根，在此读 `fidelity_target` 并透传进 [`harness/scripts/utils/types.ts`](harness/scripts/utils/types.ts) 的 `CheckContext`）。
- **ratchet 贯穿三阶段（注意：无现成跨阶段档位可直接复用）**：现状 [`skills/feature/spec/reference/visual-handoff.md`](skills/feature/spec/reference/visual-handoff.md) 的 `visual_handoff_enforcement` **仅在 spec 阶段生效**；coding 的 static-fidelity 读的是另一个 `visual_parity_enforcement`、testing 的 [`visual-diff-check.ts`](profiles/hmos-app/harness/visual-diff-check.ts) 读 `uiChange` + 硬编码 severity，二者都**不读** spec 那个档位。所以"贯穿"实际要做的是：把 `fidelity_target` **透传进 coding/testing 的 check 并新增 severity 映射分支**（`pixel_1to1` → 关键视觉项 WARN 升 FAIL/BLOCKER），而非"改个配置就贯穿"。沿用既有 enforcement 思路、不另造并行档位，但**须逐阶段接线**（具体收紧点见 P1-1 与 P2）。
- **判据修正（消灭逻辑漏洞）**：bc-openCard 的 defer 全是"已登记"的，所以判据**不是"登没登记"，而是"P0 视觉元素的 defer 有没有人类签字"**。`pixel_1to1` 下 VL **不得自行 defer 任何 P0 视觉元素**（搜索框/角标/品牌 logo/语义色/插画/独立功能区如 NFC）；要 defer，必须登记进 `fidelity_deferrals:` **并经人工确认**——goal-runner 在该阶段暂停要求人类显式批准，**headless 模式下无批准即判 BLOCKER**。
- 落点：[`profiles/hmos-app/harness/spec-visual-handoff-check.ts`](profiles/hmos-app/harness/spec-visual-handoff-check.ts) 增 `fidelity_target` 解析与 ratchet；goal-runner 暂停/求确认接到现有 halt 机制（参见 [`harness/scripts/goal-runner.ts`](harness/scripts/goal-runner.ts)，复用既有 halt_reason，不新造裁决路径）。
- 文档：[`skills/feature/spec/SKILL.md`](skills/feature/spec/SKILL.md) + [`harness/prompts/verify-spec.md`](harness/prompts/verify-spec.md) 要求产出"保真档位与偏离登记（含人类签字）"小节。
- 验收：以 bc-openCard 的 spec 为输入，置 `pixel_1to1` 且把搜索框/NFC 写进 `fidelity_deferrals` 但**无人工签字** → 门禁判 BLOCKER。

## P0-2 捕获层（①捕获完整性，新重心，最难、最该投入）

解决"门禁数学上发现不了漏捕获"这个结构盲区。

- ui-spec 模型扩字段（[`harness/scripts/utils/ui-spec-shared.ts`](harness/scripts/utils/ui-spec-shared.ts)）：`UiSpecComponentNode` 增 `semantic_role`（success/brand_primary/danger/promo/neutral）、`color_ref`、`icon{kind,ref}`、`badge`；`UiSpecScreen` 增 `must_have_elements[]`。解析向后兼容透传。同步 [`profiles/hmos-app/skills/spec/templates/ui-spec-template.yaml`](profiles/hmos-app/skills/spec/templates/ui-spec-template.yaml) 示例。
- **强制逐元素枚举协议（捕获端，提示词层）**：改造 [`skills/feature/spec/SKILL.md`](skills/feature/spec/SKILL.md) + [`profiles/hmos-app/skills/spec/profile-addendum.md`](profiles/hmos-app/skills/spec/profile-addendum.md) + [`skills/feature/spec/reference/ui-spec.md`](skills/feature/spec/reference/ui-spec.md)：不再让 VL 自由"描述页面"，而给一个**分区扫描模板**（顶部导航/内容主体/底部/浮层，逐区回答"这里有哪些元素"），对每个元素强制填：`type`/`text`/`semantic_role`/`color_ref`/`icon`(身份)/`badge`/相对位置/尺寸量级，并逐个标 `implement | defer`。把"开放式描述"改成"强制逐项表态"。枚举结果落 `spec/ref-elements.yaml`（参考图元素清单）。
- **覆盖校验脚本（门禁端，新增，本方案核心）**：新增 [`profiles/hmos-app/harness/capture-completeness-check.ts`](profiles/hmos-app/harness/capture-completeness-check.ts)（挂 spec 阶段 capability）：用 [`profiles/hmos-app/harness/authoritative-ref-images.ts`](profiles/hmos-app/harness/authoritative-ref-images.ts) 取参考图，校验"`spec/ref-elements.yaml` 参考图元素清单"与"ui-spec 节点 + `must_have_elements`"的覆盖——**分母必须来自参考图侧的独立枚举，不能来自 ui-spec 自身**（与 `countMappableNodes` 的本质区别，务必不要重蹈以 ui-spec 为分母的覆辙）。`pixel_1to1` 下覆盖不足 → BLOCKER；`semantic_layout` 下 → WARN。
- **诚实能力边界**：这依赖 VL 视觉能力，做不到 100%；它根治"主动 defer"，对"被动漏看"靠 P1-1 反向 diff 兜底。两者叠加，捕获完整性可从 ~0.4 提到 ~0.85+，但不是 1.0。
- 验收：用 bc-openCard 参考图，若 ui-spec 缺 `search_bar`/`promo_badge` 而参考图清单里有 → 捕获完整性 check 在 `pixel_1to1` 下判 BLOCKER。

## P1-1 验证层（④验证闭环 + 收紧放水点，同时兜底①的漏网）

把"实现截图 ↔ 参考图"的双向 diff 作为闭环验收，并堵住已证实的放水点。

- **C1 placeholder 不再免分母**：[`profiles/hmos-app/harness/static-fidelity-score.ts`](profiles/hmos-app/harness/static-fidelity-score.ts) 第 117 行当前 `if (a.placeholder) continue;`。改为 `pixel_1to1` 下被标 placeholder 的**品牌资产仍计入分母**（视为未覆盖）拉低资产覆盖分；`semantic_layout` 维持现状。配合 P1-2 占位清单，使"资产全占位"无法报 100%。
- **C2 节点→token 绑定校验（非 token 存在性）**：`static-fidelity-score.ts:80-95` + [`profiles/hmos-app/harness/coding-visual-parity-check.ts`](profiles/hmos-app/harness/coding-visual-parity-check.ts) 增：带 `semantic_role`/`color_ref` 的节点，其指定 token 须 (a) 在 color 资源有定义、(b) 被对应组件源码 `$r('app.color.*')` **实际引用**。**校验"这个节点用对了 token"，不是"token 存在且色值对"**（`brand.cmb` 等本就存在，真问题是无节点引用）。错绑/缺失 → `pixel_1to1` 下 FAIL。
- **C4 双向 diff + 升 BLOCKER**：[`profiles/hmos-app/harness/visual-diff-check.ts`](profiles/hmos-app/harness/visual-diff-check.ts)：
  - **双向 diff**：正向=spec 声明的元素实现里有没有；反向=参考图里有、但实现里没有的元素清单（抓"漏捕获"的最后一道防线，兜 P0-2 被动漏看）。要求 VL 报告**每屏逐元素枚举**反向差异，不只 `verdict=fail` 时填 `must_fix`。
  - **升 BLOCKER**：`pixel_1to1` 下把 `lowScorePass` / `scoreFloorSentinel` / `must_fix` 非空从 WARN **升为 BLOCKER**（复用现有 `PASS_MIN_FIDELITY`/`SCORE_FLOOR_SENTINEL_GAP` 逻辑，只改严重度映射）。
  - **NxN 分块**：在全局相似度外加分块最小块相似度喂哨兵（破"红 logo 变蓝被整体白底稀释"），落点 [`profiles/hmos-app/harness/image-toolkit.ts`](profiles/hmos-app/harness/image-toolkit.ts) + 采集侧填 `score_floor`。
  - **截图去重**：≥2 个 finalized 屏共享同一 `screenshot_hash` → WARN（呼应本案例 `edeba609e264a3b8` 撞值采集 bug）。
- **基建已就位**：`authoritative-ref-images.ts` 的 `resolveRefSourceImage` 已能按 id 把参考图喂进来，不用重建图供给侧。**验收定义升级**：从"门禁 PASS"改为"实现截图 vs 参考图双向 diff 残差达标"。
- 文档：[`skills/feature/device-testing/SKILL.md`](skills/feature/device-testing/SKILL.md) Step 4.6 + [`harness/prompts/verify-testing.md`](harness/prompts/verify-testing.md) 要求 must-fix 逐元素枚举。

## P1-2 素材层（③素材供给，物理瓶颈，核心是诚实而非假装自动生成）

按质量排序的三级供给策略 + 让"美术资产缺口"变成用户知情的决策点。

- 需求级意图 `asset_acquisition_mode: approximate（默认） | auto_crop | user_dir`（与 P0-1 同块）。
- **联动规则（消灭新放水口，BLOCKER 级内聚性）**：`fidelity_target: pixel_1to1` 时，`asset_acquisition_mode` **默认抬升为 `user_dir`**（并触发 D1 产出 `spec/asset-manifest.yaml` 向用户索要素材），**不得静默停在 `approximate`**；用户未提供素材目录时，D4 占位清单必须作为**显式决策浮现**（≥WARN + 配合 C1 拉低资产覆盖），杜绝"声明了 1:1、美术资产却仍静默占位"成为新的静默放水口。这与最初"默认近似、按需采集"决策不冲突——是 `pixel_1to1` 这一更强信号覆盖 asset 默认值；framework 仍**不强制生成**，只强制把"提供素材 / 接受占位"的决策摊到台面。
- **D1 素材需求清单盘点（spec 阶段）**：从 ui-spec `assets` + `icon.kind=brand_logo/illustration` 的节点盘点"本需求需要哪些美术资产"，产出 `spec/asset-manifest.yaml`（资产 key、用途、对应屏、是否已有来源），反馈用户，让"提供素材 / 接受占位"成为台面上的决策。
- **D2 用户素材目录映射（最高质量、1:1 唯一可靠路径）**：约定用户在需求里除参考图外再给一个素材目录——Visual Handoff `authoritative_refs` 增一类 `asset_pack`，或 `framework.config > spec.asset_sources` 配置；framework 按文件名/约定**自动映射到资源 key**并落库，用户无需懂代码引用。
- **D3 有限裁剪（中等，复用既有能力）**：对参考图里清晰出现的大图，接通既有 [`profiles/hmos-app/harness/asset-acquisition.ts`](profiles/hmos-app/harness/asset-acquisition.ts)（`acquisition: crop` + `source_bbox` + `human_crop_confirmed`，capability `spec.asset_acquisition`，bc-openCard 因全 placeholder 从未触发）。**文档诚实标注覆盖率上限**（缩略图/未出现的 logo 无效，100 家里只有十几个有源、向日葵卡面裁不出来）。
- **D4 知情占位（兜底）**：素材缺失允许 placeholder，但**必须产出"占位资产清单"**写入报告显式告知"这些为占位、非 1:1"；`pixel_1to1` 下占位清单非空 → 至少 WARN 并在最终验收摘要醒目列出（配合 C1）。
- **明确不做**：拒绝 AI 生成缺失 logo/插画/卡面（"像但不对"的山寨资产比占位更具误导性）。
- 文档：[`skills/feature/spec/reference/visual-handoff.md`](skills/feature/spec/reference/visual-handoff.md) + [`skills/feature/spec/reference/ui-spec.md`](skills/feature/spec/reference/ui-spec.md) 记素材目录约定与 crop 字段联动；jimp 不可用时优雅 SKIP（沿用现有降级）。

## P2 coding 背板（②转译，瘦身为兜底，不再是中心）

coding 是第二强环，只保留轻量兜底，防止"spec 记了、coding 又丢了"。

- [`profiles/hmos-app/harness/coding-visual-parity-check.ts`](profiles/hmos-app/harness/coding-visual-parity-check.ts) + [`profiles/hmos-app/harness/static-fidelity-score.ts`](profiles/hmos-app/harness/static-fidelity-score.ts) 仅保留两条：
  1. **C2 节点→token 语义色绑定**（见 P1-1，堵"成功✓蓝、招行按钮/logo 没用 brand.cmb"）。
  2. **C3 must_have_elements presence**：屏级必备元素（搜索框/字母索引/角标）在源码/string 资源 presence 命中（堵"静默丢搜索框"）。注意：这些**不是 asset，无 placeholder 豁免路径**。
- 删除原计划堆的过度项；placeholder 仅对**真实品牌矢量资产**合法（与三级供给一致）。
- 登记 [`profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml`](profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml) / [`harness/prompts/verify-coding.md`](harness/prompts/verify-coding.md) / [`skills/feature/coding/SKILL.md`](skills/feature/coding/SKILL.md) 第 13 项。

---

## 出口：测试 + 量化基线 + 预期边界

- A/B/C 三分法与诚实天花板写入 spec/device-testing SKILL 与文档（C 动态交互显式不在承诺内）。
- 为 P0-1/P0-2/P1-1/P1-2/P2 新字段/门禁补 harness 单测与 fixture，注册 [`harness/tests/run-unit.ts`](harness/tests/run-unit.ts)，新 fixture 入 `v2_3/`（**执行前确认该 fixture 目录约定仍有效**）；`cd harness && npm test` 全 PASS（BLOCKER）。
- **离线回归**：用 bc-openCard 归档构造样例 ui-spec（带 `semantic_role`/`must_have_elements`/`fidelity_target: pixel_1to1`），验证新门禁能把"成功✓蓝 / 按钮全局蓝 / 缺搜索框 / 缺角标 / 资产全占位"判出 FAIL/BLOCKER。
- **真实闭环量化基线（最终检验）**：用加固后的 framework，以 `pixel_1to1` + 提供一个银行 logo 素材目录**重跑 bc-openCard**，用 P1-1 双向 diff 逐环度量提升（捕获覆盖率/语义色命中/must_have presence/资产覆盖/visual-diff 残差），建立可证伪基线，避免凭感觉迭代。
- 不动 `package.json.version`（保持 2.4.0）。

## 落地顺序（按 ROI 与依赖）

1. 先做 **P0-1（治理）+ P0-2（捕获）**：不依赖外部素材、直击根因、投入相对小，且是后续前提（没有 `fidelity_target` 档位，P1-1 的"升 BLOCKER"无从挂载；没有捕获完整性，后面修得再好也漏元素）。
2. 用 bc-openCard 跑 P1-1 双向 diff 量化基线，判断每块补强的真实 ROI。
3. 再做 **P1-1（验证闭环）+ P1-2（素材供给）**；**P2（coding 背板）** 随 P0-2 落地顺带收口。
4. **出口贯穿**：每块完成即补对应单测；全部完成后做真实闭环度量。

## 范围边界（按用户决策）

- 资产采集三级模式，默认 `approximate`；`auto_crop`/`user_dir` 仅在用户明确要求时由意图识别开启（**`pixel_1to1` 下按 P1-2 联动规则自动抬升为 `user_dir`**）；**不引入图像生成/AI 山寨资产**。
- 不改 simulatedWallet 任何代码（framework-only）。
- 不 bump 版本、不新建发布说明。
- 是重排优先级 + 补三块结构性能力（捕获/闭环/素材），**复用** handoff / structure-parity / ref-images / static-fidelity / visual-diff / asset-acquisition 既有零件，**非推翻重写**。
