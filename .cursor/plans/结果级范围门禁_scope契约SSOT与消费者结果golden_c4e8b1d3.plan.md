---
name: 结果级范围门禁 — scope 契约 SSOT / 屏级 scope 门 / consumer-outcome golden
version: 3.0.0
# 版本说明：窗口不 bump（用户控版本）。
# v1（2026-07-25）：从 plan d8c5f3a7 拆出（用户拍板：T9 族独立 change，d8c5f3a7 先开工
#   T2/T1）。本文件承接 d8c5f3a7 v8~v12 十轮 review 已冻结的 T9/T8/T7b 全部设计决议，
#   内容逐字迁移、不重新论证；上下文与根因见 d8c5f3a7 的 overview（同一事故：2026-07-24
#   bc-openCard「越优化越差」）。
# 拆分理由：连续三轮 review 的新发现全部集中在这一族（scope contract 信任来源 / UI owner
#   inventory 全集枚举 / trusted-base lineage / 结果级 receipt 签发），T9 已从"一个字段"
#   长成独立子系统，且挡在 T8/T7b 前面；而 d8c5f3a7 的 P0 核心（T1/T2/T4/T5/T7a）自 v9
#   起已收敛。拆分后两条线并行推进，P0 修复不被 P1 设计迭代拖住。
overview: >
  【承接来源】plan d8c5f3a7（视觉负向优化根治）v12 的 T9/T8/T7b 三切片。事故样本、三链
  根因、证据锚点均见 d8c5f3a7 的 frontmatter overview，本 plan 不重复。
  【本 plan 要解的问题】(1) R4 余波：需求外页面被误开发（本案 BankCardPackSection 被塞进
  WalletMain HomeTabPage，ui-spec 十屏无主页屏、plan F8 只分给 CardPackPage，模块级 scope
  门放行、盲 review 未拦）——**这是唯一能直接阻止该类复发的门禁**；(2) R10 结果层：
  b4aa7290..HEAD 计 548 files/+80788 行机制改动，无一条结果级门禁用银行卡 10 屏做回归，
  于是"机制测试越来越绿、宿主效果越来越差"。
  【与 d8c5f3a7 的依赖】本 plan 消费 d8c5f3a7 的两个产物：T4 的
  `computeProductSourceSnapshotSha256` + source→HAP→截图 provenance 链（baseline 可信性
  与 receipt 绑定用）、T5 的视觉指标机器契约 `metric_contract_hash`（归一化比较用）。
  故本 plan 的实施须在 d8c5f3a7 的 T4/T5 落地之后；T9 的设计与 fixture 可先行。
  【⚠️ 依赖失效注记（2026-07-26，d8c5f3a7 v22 删减式重构）】上述两个被消费产物
  （T4 provenance 链、T5 `metric_contract_hash`）已被 d8c5f3a7 v22 的 D5/D6 **删除**——
  本段依赖描述失效。本 plan 动工前必须先重写依赖段：baseline 可信性改锚 fs 快照
  （v22 F2 的 `product-source-snapshot` 重写版）或另行设计；归一化比较不再有 metric
  contract 可引。在依赖段重写并 review 通过前，本 plan 不得开工。
  【关键冻结决议（十轮 review 结论，勿重新论证）】
  ① proposal / effective 两层分立：`acceptance.yaml::scope_contract` 仅为 agent proposal，
  **runtime SSOT = runner-owned effective artifact**，门禁只消费 effective 及其 pinned hash；
  ② 受保护集由**差集推导**而非 proposal 枚举：
  `protected_negatives = UI owner inventory − authorized_positive_scope`，两端各须有信任来源；
  ③ UI owner inventory 必须覆盖四类（含**根页面条件 Tab 分支**——宿主 HomeTabPage 在
  `01-Product/Phone/src/main/ets/pages/index.ets:87` 是 Navigation 内 `if` 子树，
  **不在 navDestinationMap(:27)**，只扫路由注册表会漏掉本案页面）；
  ④ baseline 可信性 = 完整 provenance 链 **∧** 可信历史锚点（trusted-base/已批准 commit/
  人工 receipt），缺锚点恒 `unavailable`；trusted-base 每 feature lineage 只初始化一次、跨
  run 复用；
  ⑤ 受保护屏越界**任何 strictness 恒 BLOCKER**（真实银行卡是 best_effort，hard-only 门禁
  对本事故无效）；
  ⑥ outcome receipt = 精确对象绑定（staging 哈希必填、commit 仅元数据）+ 决策与范围 SSOT
  绑定 + `negative_screen_evidence[]`；**签发端不存在须自建**（confirmation-receipt.ts:19
  明言签发不在该模块，registry 缺失时一切校验 INVALID 并封顶 AWAITING_HUMAN_REVIEW）。
---

# 结果级范围门禁——scope 契约 SSOT / 屏级 scope 门 / consumer-outcome golden (c4e8b1d3)

状态：**v1 拆分落地，待用户 review**（未实施）

> 本 plan 从 [d8c5f3a7](视觉负向优化根治_能力真值跨run与盲档非破坏与回修环_d8c5f3a7.plan.md) 拆出。
> 切片编号沿用原 plan（T9/T8/T7b），便于与十轮 review 记录对齐。

## 切片

### T9（P1，**T8/T7b 的前置**）scope contract SSOT —— 补 v8 P0 缺口

> **缺口实锤**：T8/T7b 都要读「受保护屏」，但全仓无该字段——ui-spec 根字段是封闭白名单 `ROOT_ALLOWED_KEYS={schema_version, verified, verified_method, screens, tokens, assets, global_elements}`（ui-spec-schema-validate.ts:124，additionalProperties=false），且 `.cursor/plans` 不进发布件，运行时消费者无从得知 HomeTab 受保护。没有 SSOT，T8 写的「best_effort 恒 BLOCKER」在 coding gate 上是空转。

**改动**：
1. **两层落点与唯一 runtime SSOT（v11 B1 定稿，消除双身份）**：
   - **proposal 层**：`acceptance.yaml::scope_contract`——**仅为 agent 提案**（spec 阶段产出，人类可读、便于 review），**任何门禁都不得直接消费**；
   - **runtime SSOT**：**runner-owned effective scope contract artifact**（落 runner 证据区，非 feature 目录内 agent 可写面），由 runner 依第 2 条生成；**T8 / T7b / outcome receipt 一律只消费 effective artifact 及其 pinned hash**；
   - acceptance / plan / ui-spec 中的 scope 表述降为**一致性投影**：与 effective 不一致 → 提示同步并留痕，**不参与裁决**（防读到不可信 proposal）。
   - **不放 ui-spec**——其根字段白名单封闭，扩展代价与语义归属都不合适。

   两层共用结构：
   - `protected_negative_screens[]`：每项含 `screen_id` / `owner_paths[]`（文件或 path pattern）/ `forbidden_anchors[]`（不得出现的组件锚点，如本案 `bank_card_section`）/ `baseline_structure_hash` + `baseline_screenshot_hash`（**语义见 3**）/ `baseline_provenance` / `update_policy`；
   - `excluded_scope[]`：显式声明不在本需求域内的页面/模块。
2. **信任模型（v10 收紧：runner 生成生效版，非事后冻结 agent 自签）**：v9 让 agent 写 baseline、runner 事后冻结 hash——**冻结只防后改，不证明首次登记为真**，污染态首页照样可被登记成基线。冻结如下：
   - **产出分工**：agent **只能产出 `scope_contract` proposal**；**runner 生成 effective scope contract**——依据 coding 阶段前的 **source snapshot**（T4 的 `computeProductSourceSnapshotSha256`）+ 路由清单（plan 关键文件/ui-spec 屏 owner + 实际路由注册表）+ 构建产物生成；proposal 与生效版不一致处如实记录，不静默采纳；
   - **完整性算法必须确定性（v11 B3，防整项遗漏）**：「逐项核验」只能验 proposal 已列项，agent 干脆不写 HomeTab 就绕过了（同「逐条目合法 ≠ 集合完整」既有硬学习）。冻结规则：
     **`protected_negatives = UI owner inventory（全集） − authorized_positive_scope`**
     即受保护集由**全集差集推导**、不由 proposal 枚举决定；proposal 只能**补充说明**（forbidden_anchors 细化等），不能减少集合。差集算不出（全集不可枚举/来源缺失）→ **BLOCKER**，不得退化为空集。**两个输入项各自须有信任来源，见下 2a / 2b**（否则差集两端都可被 agent 操纵，公式形同虚设）。

   - **2a. `authorized_positive_scope` 的信任来源（v12 B1）**：若 positive 仍取自 agent 写的 plan/ui-spec，agent 只需把 HomeTab 多声明成 positive，它就从 protected 里消失——差集防线归零。故：
     - **runner-owned `authorized_positive_scope`**：由**需求 SSOT** 派生（manifest.requirement + 解引用文档 + ux-reference 参考图；可复用既有 `collectRequirementSsotPaths` / `computeRunRequirementSha`），runner 核验后固化；
     - 每项绑定 **需求输入哈希 + screen_ids + owner_paths + 确认依据**（哪段需求/哪张参考图授权了该屏）；
     - **agent 提议额外 positive 页面 → 须可信 receipt 或人工确认**，本 run 不自动采纳（与 T4-8 amendment 同构）；
     - 需求输入变化 → positive scope 重新派生并使下游失效。

   - **2b. UI owner inventory（全集）的确定性来源（v12 B2；当前本案页面正在盲区）**：宿主 `HomeTabPage` 在 `01-Product/Phone/src/main/ets/pages/index.ets:87` 是 `Navigation` 内 `if (this.currentTabIndex === 0)` 的**条件 Tab 子树**，**不在 `navDestinationMap`(:27)**——只扫路由注册表会把本案那个页面整个漏掉。故 inventory 采集须覆盖**四类**且规则冻结：
     ① `Navigation` / `NavDestination` 注册项；② **`Tabs`/`TabContent` 与根页面条件分支**（`if/else` 内直接实例化的页面组件）；③ `@Builder` 导出的页面构建器；④ **sheet/modal 等非 route 屏**（`bindSheet`/`bindContentCover` 挂载的组件）。
     采集不完整/存在不可判定构造 → **BLOCKER**（如实报"inventory 不可枚举"），不得静默产出偏小全集。
   - **初始 baseline 的可信性（v11 B2：链完整 ≠ 未污染）**：`source_snapshot → HAP → structure/screenshot` 只证明**截图确实出自当前源码**，**不证明该源码是授权、干净的**——已污染的 HomeTab 同样能产出完整链。故建立 baseline 须**同时**满足：(i) 完整 provenance 链，**且** (ii) **可信历史锚点**三者之一——runner 在 **feature agent 启动前**固化的 trusted-base snapshot / 已批准的 commit·snapshot / 人工或可信 receipt。缺 (ii) → 该屏 baseline 记 **`unavailable`**（靠 owner_paths+forbidden_anchors 保护），**不得以当前状态充当基线**；**legacy 迁移无锚点时必须保持 `unavailable`**，不得因「当前源码构建成功」升级为可信 baseline；
   - **trusted-base 的生命周期（v12 P1-4）**：**一条 feature lineage 只初始化一次，跨 run 复用**——**禁止**每个新 run 重新捕获当前状态作 base（否则 run1 把首页改脏、run2 起来就把脏态当基线，防线自动失效）。base 更新只走「可信 receipt/人工确认 + 新 run」同一授权链；lineage 身份随 feature 而非 run。
   - **`update_policy` 是框架固定策略，不由 acceptance.yaml 自由声明**（agent 不能给自己写宽松规则）；contract 中该字段若与框架策略冲突 → BLOCKER；
   - **pinned hash 持久化到 runner-owned 证据**（与 effective artifact 同域，非 feature 目录内 agent 可写面），**进程重启后仍可核验**；**禁止**在校验时从当前 acceptance/proposal 重算并覆盖 pinned 值（那等于每次都信当下）；
   - **agent 不得刷新 baseline**；更新保护范围须**同时**满足「可信 receipt 或人工确认」**且**「新 run」——**新 run 单独不构成授权**；
   - scope contract 变更 → **plan/coding/testing/outcome 全链失效**并重跑（防"测完再改保护范围"）。
3. **两类 hash 语义分立（v9，防假失败与伪造）**：
   - `baseline_screenshot_hash` **只证明基线图片文件身份**（哪张图是基线），**严禁**与当前实拍截图做原始字节相等比较——状态栏、渲染抖动、压缩差异都会造成假失败；**实际视觉比较一律走 T5 归一化 metric contract**；
   - `baseline_structure_hash` 须**冻结 canonicalization 规则**（稳定排序 + 排除运行时 ID、时间戳等易变字段），规则版本随 contract 记录；
   - **初始无可信基线截图时允许显式 `unavailable`**，该屏保护靠 `owner_paths` + `forbidden_anchors` 生效——**不得伪造 hash 充数**（loader 见非法/占位 hash 即 BLOCKER）。
4. 配套 **schema 校验 + writer（spec 阶段产出）+ loader（缺失/损坏/unavailable 三态）+ 漂移检查**（受保护屏漂移且无授权 → BLOCKER）。
5. **T8 与 T7b 消费同一份 contract**（单 SSOT，禁各自定义）。
6. **legacy 缺失的分档处置（v10 B2，堵死本事故的复现路径）**：宿主现有 `doc/features/bc-openCard/acceptance.yaml` **零 `scope_contract`**——若按"缺失只 WARN"，升级后 HomeTab 仍不被识别为 protected、best_effort 越界仍只 WARN、T7b 也无 negative screen 可断言，**本事故原样漏过**。故：
   - **UI/视觉链触发的 feature**（ui_change=true 或存在 ui-spec/视觉门禁）：缺 `scope_contract` → **BLOCKER**，并 **backtrack 到 spec 生成**，或执行**可信迁移**（runner 依既有 ui-spec 屏清单+plan 关键文件推导初版 proposal，再按第 2 条生成生效版；baseline 无可信来源即记 `unavailable`）；
   - **非 UI 任务**：维持 WARN 提示补齐。

**验收/单测**：schema 四态（有效/缺失/损坏/unavailable）；
- **（v11 B3 通用完整性测试，非案例特判）proposal 故意漏掉一个需求外 route → runner 必须按差集自动补入 protected，或 BLOCKER**；全集不可枚举 → BLOCKER 而非空集；
- **（v12 B1）agent 擅自多报一个 positive route（把需求外页面声明成 positive）→ 拒绝**（无 receipt/人工确认不得进 `authorized_positive_scope`）；需求输入变化 → positive scope 重新派生并使下游失效；
- **（v12 B2）inventory 四类采集用例**：`Navigation/NavDestination` / **根页面条件 Tab 分支（fixture：从当前 `01-Product/Phone/src/main/ets/pages/index.ets` 自动发现 `HomeTabPage`——本案页面不在 navDestinationMap，必须被发现）** / `@Builder` 导出页面 / sheet·modal 屏；存在不可判定构造 → BLOCKER 而非偏小全集；
- **（v12 P1-4）run1 污染首页后启动 run2 → run2 不得把污染态重设为 trusted-base**（lineage 只初始化一次，跨 run 复用）；
- **（v11 B1）门禁读的是 effective artifact**：篡改 acceptance 的 proposal 节点不改变 T8/T7b 裁决；消费前 pinned hash 不符 → BLOCKER；
- **（v11 B2）完整 provenance 链但无可信历史锚点 → baseline 必须 `unavailable`**（不得升级为可信基线）；有锚点 → 可建立；
- 本案 fixture=首页列入 protected 且 `forbidden_anchors` 含银行卡分区 → T8 与 T7b 均命中；**agent proposal 与 runner 生效版不一致 → 以生效版为准且留痕**；**agent 自行刷新 baseline → 拒绝**；**acceptance 自带宽松 `update_policy` → BLOCKER**（框架策略固定）；**pinned hash 在进程重启后仍可核验，且不被当前 acceptance 重算覆盖**；**只有新 run 无 receipt → 拒绝**（新 run ≠ 授权）；receipt+新 run 齐备 → 允许且全链失效重跑；**当前截图与 baseline 字节不等但归一化 metric 达标 → PASS**（防假失败）；伪造 hash 充 `unavailable` → BLOCKER；**UI feature 缺 contract → BLOCKER+backtrack（非 WARN）**；**「现有 bc-openCard acceptance 迁移」fixture：无 scope_contract 的真实文件 → 可信迁移出生效 contract 且首页被识别为 protected**；非 UI 任务缺 contract → WARN。

### T8（P1，v3 升格并入发布约束；**依赖 T9**）屏级 scope 门 —— 修 R4 余波

> **v7 P0 修正**：v6 写「hard pixel 下越界=BLOCKER」，但真实银行卡请求是 **best_effort**（见 T7a），照此首页误开发仍只 WARN——门禁对本事故失效。改按「是否受保护」而非「strictness」分级。

**改动**：coding 侧文件级意图校验：coding diff 触及的 UI 页面文件 ↔ plan「关键文件」清单+ui-spec 屏 owner 映射 + **T9 的 runner-owned effective scope contract（唯一 runtime SSOT；v11 B1：**不读** acceptance 里的 proposal 节点，消费前先核对 pinned hash）**，两级处置：
1. **受保护/显式排除范围**（命中 T9 `protected_negative_screens` 的 `owner_paths`/`forbidden_anchors`，或列入 `excluded_scope`，如本案首页 HomeTab）→ **任何 strictness 下越界修改恒 BLOCKER**（与 f6「确定性完整性错误不受 strictness 影响」同构）；
2. **未列保护的一般跨屏修改** → hard contract=BLOCKER / best_effort=WARN+review 必审。

确需跨屏修改 → **走 T9 唯一 SSOT 的正道链路（v10 P1-5）**：提交 `scope_contract amendment proposal` → 可信 receipt / 人工确认 → **新 run** → 更新 T9 生效 contract → plan/ui-spec 作**一致性投影**同步更新（不再表述为「扩展 plan/ui-spec scope」——那会绕开唯一 SSOT）。非 coding/testing 私扩，与 T4-8 amendment 原则同构。goal/普通模式同覆盖。

**验收/单测**：**HomeTabPage 越界 fixture 在 best_effort 下必须 BLOCKER**（本事故真实档位，v7 关键）；未保护页面越界 → hard=BLOCKER / best_effort=WARN；CardPackPage 合法 → PASS；「先扩 scope 再改」路径 → PASS。

### T7b（P1）consumer-outcome golden —— 修 R10（结果层，机器门禁）

**改动**：
1. framework 提供 `golden:consumer-outcome` harness 套件（宿主执行）：真实 hvigor 构建 → hdc 装机 → 屏级 bootstrap **采齐「10 个 positive screens + 本次需验证的全部 protected-negative screens」**（v12 B3：negative 屏是**额外采集对象**，不含在 10 屏内；漏采即无法支撑 `unavailable` 分支的弱断言）→ 确定性断言（必需图片资产存在且非占位/屏级结构锚点在场/布局几何+edge divergence 达标（复用 T5 常量）/截图覆盖率 100% P0/crash-free：faultlog 窗口零新增）→ **protected_negative_screens（v3；v11 补 unavailable 分支）**：需求外「不应变化」页面（首页 HomeTab 等）反向断言，**按 baseline 可用性分两支**：
   - **baseline 可用**（有完整 provenance 链 + 可信历史锚点）：无银行卡组件锚点 ∧ `baseline_structure_hash` 按冻结 canonicalization 规则比对不变（截图侧走 T5 归一化 metric，**不做字节相等**）；
   - **`baseline=unavailable`**（legacy 迁移/无锚点）：**不得无条件要求「结构哈希不变」**——PASS 途径 = **`owner_paths` 的依赖闭包**未被本需求 diff 触及 ∧ `forbidden_anchors` 在实拍/uitree 中未出现 ∧ T8 侧无越界证据；三者任一不满足 → FAIL。
     - **依赖闭包（v12 P1-5）**：只查 owner_paths 直接文件会漏**传递依赖**——shared component / design token / 资源文件改动同样能改变页面。须取 **owner dependency closure**（import 图 + `$r` 资源引用）；闭包不可解析时退回 **run-start observation**（run 开始时对该屏的实拍/uitree 快照），并**明示其语义**：「不代表质量正确，仅用于本 run 内的非退化比较」。
     - 该分支须留痕「基线不可用，按弱断言通过」，并进债务清单提示补锚点。
2. **outcome receipt = 精确对象绑定（v3 重定义，时间仅参考；v4 收紧 staging 与签名复用）**，绑定字段：**framework staging 内容哈希（必填）**+ sanitized framework zip 哈希 / **宿主源码完整快照 `source_snapshot_sha256`**（含 dirty workspace 状态；用 v5 新原语 `computeProductSourceSnapshotSha256`，**不用**轻量 `computeProductWorktreeDigest`）/ **构建 HAP sha256 + install session·device package sha256**（provenance 链中段）/ goal manifest+需求文档+10 参考图哈希 / 设备型号·分辨率·系统版本 / checker 版本 + **`metric_contract_hash`（T5 契约表）** / **决策与范围 SSOT 绑定（v7/v9，必填）：`fidelity-intent.json` sha256 + `capability-snapshot.json` sha256 + `decision_id` + `execution_identity` + canary run identity + `acceptance_sha256` + **`scope_contract_hash`（T9 的 runner-owned effective artifact 的 pinned hash——**非** acceptance proposal 节点的哈希；缺则「测完再改保护范围」可复用旧 PASS receipt）**（`source_snapshot_sha256` 明确排除 `reports/`，不会间接覆盖这些文件；缺则 PASS receipt 可被复用到**不同能力或不同定档决策**上）/ 10 实拍截图哈希（各自绑定所属 HAP identity）/ **`negative_screen_evidence[]`（v12 B3，必填）：每个 protected-negative 屏逐项绑定 screenshot hash + UITree·structure hash + HAP identity + bootstrap identity + 断言结果**（否则「forbidden anchor 未出现」这一结论不进 receipt，等于没验）/ faultlog 时间窗 / 签名主体与 key provenance。**commit id 仅作辅助元数据、不得作为绑定依据**（dirty worktree / sanitize / 打包内容均可能与 commit 不同）。签名**复用 confirmation-receipt.ts 既有原语**（`canonicalReceiptPayload` 稳定序列化 + domain-separated `ReceiptAction` + `object_hash` + HMAC/trust registry），**不另造签名协议**——但**必须自建签发端**（见下 2b）。

2b. **签发端建设（v8 新增，否则 T7b 死在起跑线）**：confirmation-receipt.ts:19 原文「**签发不在本模块**（后继 change `confirmation-credential-issuance`）。签发落地前 registry 通常不存在 → 一切校验 INVALID → 消费点 fail-closed 封顶 `AWAITING_HUMAN_REVIEW`——这是设计行为」，且 `ReceiptAction`(:34) 无 consumer outcome 项。仅"复用原语"会造出**永远验不过的 receipt**，且那个封顶正是本事故同款陷阱。故 T7b 显式含：
   - 新增 `consumer_outcome_attestation` action（domain-separated）；
   - **runner-owned issuer**（签发只在 runner 信任域内发生，agent 与宿主构建脚本均不可签）；
   - issuer / key / trust-registry 配置落地（含 registry 条目 schema 与部署指引）；
   - **独立 HMAC env**，且从**所有不可信子进程**环境剥离——不止 agent，**hvigor / Hylyre / 宿主脚本同样净化**（否则宿主构建脚本可读密钥自签 receipt）；不与 `MAISON_HMAC_GOAL_CHECKPOINT` 混用同一密钥；
   - 签发 / 验证 / 轮换 / 吊销（`revoked=true` 即全失效）四类测试 + **「runner 可签、所有 child process 环境均无 key」回归**。
   - **依赖标注**：与后继 change `confirmation-credential-issuance` 范围重叠——本 plan 只做 consumer outcome 这一 action 的最小签发闭环，**不等待该 change**，避免 T7b 被悬置卡死；届时按其通用方案收敛。**发布门禁校验「当前待发布字节 ≡ receipt 绑定字节」**（staging/zip 哈希比对），不满足即拒发；HMAC 密钥仅 runner 侧持有，**不暴露给宿主构建脚本与 testing agent**。
3. 消费范围：**UI/能力链相关路径**变更的发版要求绑定匹配的 PASS receipt；非相关变更不强制。触发集合 release 配置显式列举，**除 profiles/*/harness 视觉链、goal-runner 视觉段、skills 视觉文案外，必须包含本次事故的能力链真实文件（v8 补齐）**：`harness/scripts/utils/goal-preflight.ts`、`harness/scripts/utils/fidelity-shared.ts`、`harness/scripts/utils/effective-vision-context.ts`、`harness/scripts/utils/multimodal-probe.ts`、`harness/harness-runner.ts`、`harness/scripts/check-spec.ts`——否则改动最关键的能力路由代码却不触发结果门禁（正是本次事故的成因形态）。
4. **宿主复演两用例（v8 澄清生命周期）**：
   - **(a) 干净全链**：**必须连跑两个 run**（第二个在 7 天 TTL 内启动）——第二 run 的 canary 已 fresh 且 run_id 属前一 run，是 R1' 永久陷阱的**唯一暴露口径**，单 run 必假绿。两 run 均 PASS 才算通过；
   - **(b) 受控 fault-injection**：验证链路为「污染尝试 **FAIL** → backtrack → 修复/还原 → **新快照绑定的 PASS**」，**不强制两个新 run**——首个故障 run 常处 HALTED/PARTIAL，会被 fresh-start guard 挡住直接建 run2；确需新 run 时使用**隔离工作副本 + audited supersede 流程**（留痕谁、何时、以何依据取代前一 run）。
   - 与 fidelity-intent-auto-routing **tasks#11**（当前 10/11）合并执行，**该项按 (a) 的两 run 口径**；截图按 `D:\1.code\对比结果\1-bc-opencard\<N>-<标签>` 归档。

**验收**：宿主干净全链（**连跑两 run**，第二 run 仍 visual 且 receipt PASS）→ 存档；fault-injection「删素材」「占位替换」「首页塞组件（打 protected_negative，**best_effort 档亦须 BLOCKER**）」各一例 → **完整链断言：注入快照 FAIL receipt → backtrack → 修复快照 PASS receipt**（不止 FAIL），且指纹指向对应断言；伪造场景（旧 receipt 配新 zip / 未来时间戳 / 同 commit 但 staging 内容不同 / **同字节但 decision_id·capability-snapshot 不同**）→ 发布门禁拒绝。

## 发布约束

本 plan 全部完成前，**UI 相关变更的发版**须附一次宿主人工复演记录作为过渡等价物（按「干净全链」口径，含连跑两 run）。T7b receipt 机制落地后转为机器门禁。

> 注：d8c5f3a7 的发布约束（T1~T5+T7a 完成前禁发）独立生效，两者叠加。

## 执行顺序

d8c5f3a7 的 T4/T5 落地 →（本 plan）**T9** → **T8** → **T7b**（宿主）。T9 的 schema/fixture 设计可与 d8c5f3a7 并行先行。

## 风险与开放问题

- Q1 UI owner inventory 四类采集的实现代价：ArkTS 条件分支/Builder/sheet 挂载的静态可判定性存疑，不可判定构造须 BLOCKER 而非猜测——首轮实现后按真实命中率校准。
- Q2 `authorized_positive_scope` 从需求 SSOT 派生的精度：需求文本→屏 ID 的映射由谁裁决（runner 规则 or spec agent 提议+runner 核验）。
- Q3 trusted-base 首次初始化时机：feature 首个 run 之前宿主可能已有历史改动，"干净"的定义需与用户约定。
- Q4 T7b「UI 相关路径」触发集合粒度（过宽=发版瘫痪、过窄=漏网）；v1 先显式列举+发版 checklist 人工兜底。
- Q5 签发端与后继 change `confirmation-credential-issuance` 的收敛路径。
- Q6 golden fixture 维护流程：需求变更时由谁、以何 receipt 更新期望断言（防 golden 自身腐化假绿）。

## Todos

- [ ] T9 scope contract SSOT（见上，含 proposal/effective 分层、差集完整性算法、四类 inventory、trusted-base lineage、框架固定 update_policy、pinned hash 持久化、UI feature 缺 contract=BLOCKER、bc-openCard 迁移 fixture）
- [ ] T8 屏级 scope 门（消费 T9 effective SSOT；受保护屏任何 strictness 恒 BLOCKER；扩 scope 走 amendment 正道）
- [ ] T7b consumer-outcome golden（宿主机器门禁+对象绑定 receipt+自建 runner-owned 签发端+negative_screen_evidence+两用例复演）
- [ ] unit 全量绿 + 新增 fixture 全绿
- [ ] 宿主复演（与 d8c5f3a7 的宿主配套第 5 条合并执行）
