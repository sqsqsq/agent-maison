---
name: 视觉负向优化根治 — 能力真值跨 run 收口/盲档非破坏化/testing→coding 回修环/journal 确定性/两层 golden
version: 3.0.0
# 版本说明：窗口不 bump（用户控版本）。
# v12（2026-07-25，吸收 review 十轮 3 BLOCKER+2P1，全采纳；B2 已自核实）：
# [B1 采纳] **差集右项「已授权 positive scope」无信任来源**——公式对，但若 positive 仍取自
#   agent 写的 plan/ui-spec，agent 只需把 HomeTab 多声明为 positive，它就从 protected 集合
#   里消失，差集防线归零。补 **runner-owned `authorized_positive_scope`**：由需求 SSOT
#   （manifest.requirement + 解引用文档 + ux-reference 图，既有 collectRequirementSsotPaths/
#   computeRunRequirementSha 可复用）派生并绑定 **需求输入哈希 + screen IDs + owner paths +
#   确认依据**；agent 提议额外 positive 页面须 **receipt / 人工确认**。测试须覆盖
#   「agent 擅自多报一个 positive route → 拒绝」。
# [B2 采纳·实锤] **「全量路由/屏 owner 集合」当前不可执行，且本案页面正好在盲区**——宿主
#   `HomeTabPage` 在 `01-Product/Phone/src/main/ets/pages/index.ets:87` 是 `Navigation` 内
#   `if (this.currentTabIndex === 0)` 的**条件 Tab 子树**，**不在 `navDestinationMap`(:27)**：
#   按路由注册表枚举会把本案那个页面整个漏掉。故冻结 **UI owner inventory 的确定性来源**，
#   至少覆盖四类：① Navigation/NavDestination 注册；② Tabs/TabContent 与**根页面条件分支**；
#   ③ @Builder 导出的页面；④ sheet/modal 等非 route 屏。并加 fixture「**从当前 index.ets
#   自动发现 HomeTabPage**」——否则实现极易再次对本案例特判。
# [B3 采纳] **T7b 未采集/绑定 protected-negative 屏证据**——采集集合仍写「10 屏」、receipt
#   也只绑 10 张实拍，而 HomeTab 是**额外的 negative screen**；于是 `unavailable` 分支所称
#   「实拍/uitree 未出现 forbidden anchor」根本没进 receipt。改为：**采集集合 = 10 positive
#   + 本次需验证的全部 protected-negative**；receipt 增 **`negative_screen_evidence[]`**，
#   逐屏绑定 screenshot / UITree·structure hash / HAP identity / bootstrap identity / 断言结果。
# [P1-4 采纳] **trusted-base 一条 feature lineage 只初始化一次并跨 run 复用**，不得每个新 run
#   重新捕获；测试「run1 污染后启动 run2 → run2 不得把污染态重设为 base」。
# [P1-5 采纳] `unavailable` 分支只查 owner_paths 直接文件会漏**传递依赖**（shared component/
#   token/资源改动同样能改页面）：改查 **owner dependency closure**；闭包不可解时退回
#   **run-start observation**（明示「不代表质量正确、只用于本 run 非退化比较」）。
# v11（2026-07-25，吸收 review 九轮 3 BLOCKER+2P1，全采纳——均为 v10 引入的新缺口）：
# [B1 采纳·消双身份] v10 同时称「acceptance.yaml::scope_contract 是 SSOT」与「它只是
#   proposal，runner 另生成 effective」，而 T8 仍直读 acceptance → 实现者可能让门禁读
#   不可信 proposal。**二选一定为前者**：acceptance 节点**只是 proposal**；**runtime SSOT
#   = runner-owned effective scope contract artifact**；T8/T7b/receipt **只消费 effective
#   artifact 及其 pinned hash**，一律不读 acceptance 的 proposal 节点；acceptance/plan/
#   ui-spec 中的 scope 表述降为**一致性投影**（不一致 → 提示同步，不参与裁决）。
# [B2 采纳·锚点缺失] **完整 provenance 链 ≠ 未污染基线**——`source_snapshot → HAP →
#   screenshot` 只证明截图确实出自当前源码，**不证明该源码是授权、干净的**；已污染的
#   HomeTab 同样能生成完整链。补**可信历史锚点**：runner 在 **feature agent 启动前**固化的
#   trusted-base snapshot / 已批准 commit·snapshot / 人工·可信 receipt，三者之一必须在场
#   才可建立 baseline。**legacy 迁移无锚点 → 必须保持 `unavailable`**，不得因「当前源码
#   构建成功」就升级为可信 baseline。
# [B3 采纳·完整性算法] 「逐项核验」只能验 proposal 已列项，**发现不了整项遗漏**（agent 干脆
#   不写 HomeTab）——同「逐条目合法≠集合完整」的既有硬学习。冻结确定性规则：
#   **protected negatives = 全量路由/屏 owner 集合 − 已授权 positive scope**；并加**通用
#   测试**（proposal 故意漏掉一个需求外 route → runner 必须自动补入 protected 或 BLOCKER）
#   ——只验 bc-openCard fixture 属案例特判，不能证明机制完备。
# [P1-4 采纳] `baseline=unavailable` 分支：T7b 不得无条件要求「结构哈希对基线不变」——
#   定义该分支的 PASS 途径（owner_paths 未变 + forbidden_anchors 未出现 + T8 证据），并加
#   迁移用例。
# [P1-5 采纳] T3 验收补两条反例：「verified + placeholder_kind → 仍按 verified」「只有
#   placeholder_kind、无 marker/账本/sanity → 不得授权替换」。
# v10（2026-07-25，吸收 review 八轮 3 BLOCKER+2 一致性，全采纳；三条已自核实）：
# [B1 采纳] **T9 冻结只防后改、不证明首登为真**——v9 让 agent 写 baseline、runner 事后
#   冻结 hash，污染态首页仍可被登记为基线。改为 **runner 生成 effective scope contract**：
#   agent 只产 proposal；runner 依据 coding 前 source snapshot + 路由清单 + 构建产物
#   生成生效版；初始 baseline 必须绑定 `source_snapshot → HAP → structure/screenshot`
#   证据链或持可信 receipt；`update_policy` 为**框架固定策略**，不得由 acceptance.yaml
#   自由声明；pinned hash 持久化到 **runner-owned 证据**（进程重启后仍可核验，**禁止**
#   从当前 acceptance 重算覆盖）。
# [B2 采纳·实锤] **当前 bc-openCard 正好走 legacy WARN 旁路**——宿主
#   doc/features/bc-openCard/acceptance.yaml **零 `scope_contract` 命中**，按 v9 只 WARN：
#   升级 framework 后 HomeTab 仍不被识别为 protected、best_effort 越界仍只 WARN、T7b 也
#   无 negative screen 可断言 → **本事故继续漏过**。改为：**UI/视觉链触发时缺 contract
#   = BLOCKER 且 backtrack 到 spec 生成，或执行可信迁移**；legacy WARN 仅适用非 UI 任务。
#   新增「现有 bc-openCard acceptance 迁移」fixture。
# [B3 采纳] **`ui-spec placeholder_kind` 可把真素材自声明降级**——与 P0-1 同构的反向洞：
#   agent 误标/改标即可把 verified 真素材降为 placeholder 后覆盖。改为：**verified
#   provenance 优先，不可被 ui-spec 字段降级**；placeholder 身份只能来自「素材内嵌
#   marker / runner-owned 物化账本 / 确定性内容检测(sanity)」；`placeholder_kind` 仅作
#   线索，**不能单独授权替换**。
# [P1-4 采纳] T3 Todo 仍写 v8 的「跨类不可比→human receipt」，与正文非对称偏序矛盾——
#   同步，防执行者照 Todo 重新实现出占位锁死。
# [P1-5 采纳] T8 的「扩展 plan/ui-spec scope」绕开唯一 SSOT——改为：提交
#   `scope_contract amendment proposal` → receipt/人工确认 → 新 run → 更新 T9 contract →
#   plan/ui-spec 作**一致性投影**同步更新。
# v9（2026-07-25，吸收 review 七轮 2P0+3 项，全采纳；两条硬主张已自核实）：
# [P0-1 采纳·自伤逻辑纠正] **v8 的 mayReplace 会永久锁死错误占位**——已提交的占位
#   PNG/SVG 同样是 git tracked + `$r` 引用，新裁的 verified 真 logo 与之「跨类」，按 v8
#   「跨类一律拒绝」会被拒 → 框架从「破坏真素材」变成「永久保护错误占位」，UI 仍修不好。
#   改为**非对称偏序**：旧=absent/已识别 placeholder/generated_unverified → 新 verified
#   crop 或 user-provided **允许替换**；old verified → new unverified **永远禁止**；
#   verified→verified 且来源不同 → 需同 asset role/source binding 或 human receipt。
#   **git tracked 只证明历史存在、不证明是真素材**：判定前必须先排除 placeholder marker
#   （ui-spec `placeholder_kind`）与空白/纯色 sanity failure（asset-crop-validation
#   jimp stats，:8/:59 既有）。fixture 必须含「tracked placeholder → verified crop = PASS」。
# [P0-2 采纳] **T9 baseline 可自签**——baseline_provenance/update_policy 写在 agent 生成的
#   acceptance.yaml 里，普通字段不构成信任：agent 可把**已污染的首页**登记成 baseline、
#   可声明宽松 update_policy；「进入新 run」只是执行边界不是授权。补：runner 在 **coding 前
#   冻结 canonical `scope_contract_hash`**；agent 只能提 scope amendment proposal、
#   **不得刷新 baseline**；更新须**同时**满足可信 receipt/人工确认 **且** 新 run（新 run
#   单独不构成授权）；scope contract 变更使 plan/coding/testing/outcome **全链失效**；
#   T7b receipt **必填 `acceptance_sha256` / `scope_contract_hash`**（否则测试后改保护范围
#   仍可复用旧 PASS receipt）。**两类 hash 语义分立**：`baseline_screenshot_hash` 只证明
#   基线**图片文件身份**，**严禁与当前截图做原始字节相等比较**（状态栏/渲染抖动/压缩差异
#   会假失败），实际视觉比较一律走 T5 归一化 metric contract；`baseline_structure_hash`
#   须冻结 canonicalization 规则（排除运行时 ID、时间等易变字段）。初始无可信截图 →
#   显式 `unavailable`，靠 owner_paths + forbidden_anchors 生效，**不得伪造 hash**。
# [采纳] HMAC 隔离扩到**所有不可信子进程**（hvigor / Hylyre / 宿主脚本），非仅 agent；
#   增回归「runner 可签、所有 child process 环境均无 key」。
# [采纳] T7b 验收补完整链：注入快照 **FAIL receipt** → backtrack → 修复快照 **PASS
#   receipt**；宿主指引第 5 条删除「每个用例都连跑两个 run」的残留冲突（仅干净用例两 run）。
# [采纳·字段实锤] T7a 的「asset-manifest 不得 blind_placeholder」不可执行——
#   `blind_placeholder` 在 harness/ 与 profiles/ 全部 TS 代码中**零命中**（宿主产物里是
#   agent 自由文本）。改为机器可执行断言：`asset_acquisition_mode=auto_crop` /
#   有视觉时关键资产 `placeholder !== true` / `resolved_path` 存在 / verified+hash·path
#   binding 有效。
# [文案] 清「优先级 v3 终版」残留。
# v8（2026-07-25，吸收 review 六轮 1P0+5 项，全采纳；三条硬主张已自核实）：
# [P0 采纳·实锤] **受保护页面无可消费 SSOT**——T8/T7b 都要读
#   protected_negative_screens/excluded scope，但全仓无该字段；ui-spec 根字段是封闭白名单
#   `ROOT_ALLOWED_KEYS={schema_version,verified,verified_method,screens,tokens,assets,
#   global_elements}`（ui-spec-schema-validate.ts:124），additionalProperties=false；
#   `.cursor/plans` 不进发布件，运行时消费者无从知道 HomeTab 受保护；T7b「结构哈希对基线
#   不变」也没定义基线来源/哈希口径/更新授权。→ 新增 **T9：scope contract SSOT**
#   （`acceptance.yaml::scope_contract.protected_negative_screens[]`，spec 阶段生成、随
#   feature 产物进宿主，含 screen_id/owner path pattern/forbidden anchors/baseline
#   structure·screenshot hash/baseline provenance/更新授权规则），配套 schema+writer+
#   loader+漂移检查；**T8 与 T7b 消费同一份**。T9 为 T8/T7b 的前置。
# [采纳] decision_id 两 run 断言加强：f6 公式含 execution_identity，故**能力完全相同时
#   run2.decision_id 也必须 ≠ run1**；另加幂等断言（同 run 同输入重复计算 ID 不变）。
# [采纳·消矛盾] T3 provenance 改判据形态：删除「全序」表述（与「跨类不可比」自相矛盾），
#   改为证据判定 `mayReplace(oldEvidence,newEvidence)`；持久化 provenance 只作**派生投影**、
#   不作信任源——`has_source` 是 agent 可写且**当前零校验**的声明（asset-manifest-check.ts:156
#   只统计 assets 数量），不得单独充当 provenance。并**取消二选一**：本轮**只基于现有可信
#   证据**（asset-crop-validation verified+hash/path 绑定 / 本 invocation provider 执行事实 /
#   human receipt），schema 扩展留后续 change；验收随之去掉「全序比较表」，改证据判定用例。
# [P0 采纳·实锤] **T7b 签发端不存在**——confirmation-receipt.ts:19 原文「签发不在本模块
#   （后继 change confirmation-credential-issuance）。签发落地前 registry 通常不存在 →
#   一切校验 INVALID → 消费点 fail-closed 封顶 AWAITING_HUMAN_REVIEW——这是设计行为」，
#   且 `ReceiptAction`(:34) 无 consumer outcome 项。仅「复用原语」会造出永远验不过的
#   receipt，且封顶行为正是本事故同款陷阱。T7b 增显式子任务：新增
#   `consumer_outcome_attestation` action + **runner-owned issuer** + issuer/key/
#   trust-registry 配置 + 独立 HMAC env 且从 agent 子进程环境剥离 + 签发/验证/轮换/吊销
#   测试；并标注与 confirmation-credential-issuance 的依赖关系（不得被其悬置卡死）。
# [采纳] fault-injection 生命周期澄清：**干净用例**连跑两 run（锁 R1'）；**故障用例**验证
#   「污染尝试 FAIL → backtrack → 修复/还原 → 新快照绑定的 PASS」，不强制两个新 run
#   （首个故障 run 常处 HALTED/PARTIAL，会被 fresh-start guard 挡）；确需新 run 时用隔离
#   副本 + audited supersede 流程。
# [采纳] T7b「UI 相关路径」触发集合补齐能力链真实文件：goal-preflight.ts /
#   fidelity-shared.ts / effective-vision-context.ts / multimodal-probe.ts /
#   harness-runner.ts / check-spec.ts（否则改动本次事故最关键的路由代码不触发门禁）。
# [文案] 状态/发布约束标题/overview 前置措辞同步到当前事实（f6 已提交）。
# v7（2026-07-25，吸收 review 五轮 1P0+4 项，全采纳；四条主张已逐条自核实）：
# [P0 采纳·实锤] **严格度轴冲突**——银行卡需求含「尽量一致」，f6 已冻结其三轴为
#   `pixel_1to1 + best_effort + auto_crop`（f6 plan:146-148；openspec goal-runner
#   spec.md:13 场景「the bank-card wording auto-tiers with zero questions」）。v6 的 T7a
#   却断言 `(pixel_1to1, hard, auto_crop)` → golden 必与 5da4ce20 正确路由冲突，且会诱导
#   实施者把「尽量」重新识别成 hard 以让 golden 通过，**直接回退 f6 核心设计**。
#   连带：T8 只在 hard 下 BLOCKER，故真实银行卡（best_effort）下 HomeTabPage 越界仍只
#   WARN——v6 宣称的「唯一直接防首页误开发复发」不成立。修法：真实 golden 断言
#   best_effort；另加合成 hard fixture 专测 hard contract；**protected/excluded 屏的越界
#   修改任何 strictness 恒 BLOCKER**，只有「未列保护的一般跨屏修改」维持 hard=BLOCKER/
#   best_effort=WARN。
# [采纳·修正 v6 过重表述] harness 侧 runId 缺口降为 **legacy/fallback 兼容项**：
#   harness-runner.ts:568-575 实为 `hasVision: capSnap ? capSnap.vision.verdict :
#   (mmProbe.supported && resolvePolicyVisualForHarness(...))`——**snapshot 在场时 live
#   meet 完全不参与**（注释明言「消费面不得自行叠加 meet」）。故只在 snapshot 缺失
#   （legacy/交互式/未经 initializer 的 phase-driven）才落到缺 runId 的 meet。v6「phase-
#   driven 恒盲」表述过重，已改。goal 主链根因仍是 decideVisionCanaryProbe 单轴 skip。
# [采纳] 「连续两 run」从 frontmatter 落进 T1/T7b 正文验收与 Todos，并细化为六条硬断言
#   （run1 写 canary.run_id=run1 / TTL 内起 run2 / run2 不得因 fresh 而 skip / capability-
#   snapshot.execution_identity=run2 / fidelity-intent.execution_identity=run2 且能力输入
#   变化时 decision_id 更新 / run2 仍 visual）。
# [采纳] **best_effort 同样进回修环**——f6 已把大量裁决面切 isHardPixelContract，若
#   backtrack 复用该谓词，银行卡 best_effort 将只记 WARN 不修。冻结谓词分工：
#   isPixelExecutionTarget / needs_fix / P0 结果契约 → 驱动 must_fix→backtrack_to_coding
#   （**strictness 无关**）；isHardPixelContract → 只控质量缺口是否升 BLOCKER、是否
#   HALT/求人；best_effort 照常自动回修，预算耗尽可 PARTIAL+债务，但**不得假称视觉闭环
#   完成**。
# [采纳] T7b receipt 增绑 f6 两份决策 SSOT：fidelity-intent.json sha256 / capability-
#   snapshot.json sha256 / decision_id / execution_identity / canary run identity——
#   `source_snapshot_sha256` 明确排除 reports/，不会间接覆盖它们；缺则 PASS receipt 可能
#   被复用到不同能力或不同定档决策上。
# [采纳·字段实锤] T3 引用了不存在的字段——asset manifest 现结构只有 `has_source?: boolean`
#   （asset-manifest-check.ts:32），无 `source_status`；f6 的可信裁图语义来自
#   asset-crop-validation 的 verified+hash/path 绑定 / 本 invocation provider 执行事实 /
#   human receipt。provenance 全序若要落地须**显式纳入 schema+loader+writer+迁移兼容**，
#   不得假设字段已存在。
# v6（2026-07-25，基线重锚：f6b2d9a4 已提交 5da4ce20，逐文件核实其对本 plan 的影响）：
# [基线变更] 5da4ce20 改 40 文件（harness-runner+49/check-spec+284/goal-runner+152/
#   fidelity-shared+396/goal-preflight+241/profiles 13 文件切 isHardPixelContract）。
#   **effective-vision-context.ts 不在改动清单**——链A 三轴判据本体未动。
# [T1-2 已被完成，删除该项] canary 写盘现已带 `run_id: manifest.run_id`
#   （goal-preflight.ts:396）；framework-local-config 已保留+校验该字段（:254/:292）。
# [T1-3 部分完成] routing 侧已贯通：`resolvePolicyVisualForRouting`（goal-preflight.ts:467）
#   传 runId，注释直指本事故根因。**但 harness 侧仍无 runId**——
#   `resolvePolicyVisualForHarness(projectRoot, feature)`（harness-runner.ts:157）签名里
#   根本没有该参数 → phase-driven/gate harness 对 goal 探测的 canary **恒判盲**，
#   违反「goal 与普通模式能力拉齐」原则。T1-3 保留，范围收窄为 harness 侧。
# [T1-1 升级为最高优先，根因形态变了·**新发现**] `decideVisionCanaryProbe`
#   （goal-preflight.ts:279-311）**仍只用 isVisionCanaryFresh 单轴**判 skip。与「写了
#   run_id」叠加后，悖论从「一次性致盲」变成**永久性陷阱**：goal·tool_read canary TTL=7d
#   （multimodal-probe.ts:41/71），故首次探测的 run（run_id 自匹配）视觉正常，**其后 7 天内
#   的每个新 run 都 fresh→skip probe，而 canary.run_id 属于上一个 run → runMatch=false →
#   adapter_declared → blind_safe**。goal-runner:3211 对 skip 分支不做任何补写/重探。
#   即：**每 7 天只有第一个 run 有视觉，其余全盲**。宿主 07-18(探测·好)→07-24(6 天内·盲·
#   事故) 的实证时间差与该模型精确吻合。f6b2d9a4 写 run_id 反而让陷阱更隐蔽（字段在场，
#   易被误认为已治）。修法不变（fresh ∧ admissible 共用谓词），但优先级最高、
#   **必须与 T2 并列先行**。
# [验收新增·关键] T1 与 T7b 都补「**连续两个 run**」回归：第二个 run 必须仍 visual。
#   单 run 验收无法暴露本陷阱——fidelity-intent-auto-routing tasks#11 宿主复验若只跑一次
#   会假绿，须按两 run 口径执行。
# [复用面·勿新造] f6b2d9a4 已落地可复用件：`CapabilitySnapshot`（fidelity-shared.ts:896-935，
#   execution_identity+decision_id+vision/ocr+tmp/rename 原子写+loader 全字段校验）→ T4
#   provenance 链与 T7b receipt 的 capability 字段、T5 metric contract 的落盘形态均复用该
#   模式；`deriveEffectiveAdapterImageInput`（:885）=能力单源收口 → T3 盲档判定入口消费它，
#   不另起判据；check-spec 新 c2/c3 判据（+284 行）→ T3「参考图在手→needs_fix」须与其
#   对齐；`isHardPixelContract`（profiles 13 文件已切）→ T8「hard pixel 升 BLOCKER」直接用。
# [不受影响] T2（intermediate-rounds-journal/worktree-digest 均未改动）、T6'、T7a 决策链
#   断言（新增 fidelity_routing 三轴投影正好可作断言输入，见 goal-report-generator+41）。
# v5（2026-07-25，吸收 review 四轮 1P0+1 措辞，全采纳；精度断言已自核实）：
# [P0 采纳·精度实锤] 不得用轻量 worktree digest 充当精确源码身份——
#   computeProductWorktreeDigest 是 stale 检测摘要而非密码学快照：最终仅 16 hex=64 bit
#   （worktree-digest.ts:95）、untracked 单项仅 12 hex（:84）、tracked 侧吃 `git diff
#   HEAD` **文本 stdout**（二进制只得 "Binary files … differ"，同路径不同 PNG 不可区分）
#   ——恰好削弱本 plan 最要保护的卡面/logo/插画资产，dirty baseline 下尤甚。v5 新增独立
#   `computeProductSourceSnapshotSha256`：完整 64 hex SHA-256 / 作用域内 tracked+untracked+
#   删除项+文件类型+相对路径稳定排序 / 按原始字节计算（二进制安全）/ 纳入构建配置、排除
#   reports·build 输出 / 任一文件不可读或枚举失败 → unverifiable；**不替换**既有轻量
#   digest（后者继续用于普通 stale 检测）。
# [P0 配套] 证据绑定升级为完整 provenance 链：`source_snapshot_sha256 → HAP sha256 →
#   install session/device package sha256 → screenshot batch → visual journal/receipt`
#   ——截图真正对应的是**设备上安装的 HAP**，不只是截图时刻的工作区源码；每批截图与
#   journal 绑定 HAP/build identity，构建 receipt 再绑定完整源码快照。这才能抓住
#   「改源码 → 构建污染 HAP → 恢复源码 → 再截图」这类 self-revert。
# [措辞更正] 「工作区已干净」不准确——尚有与本 plan 无关的既有改动
#   （.cursor/plans/android_工程适配_5e3400c3.plan.md）：改为「前置 change 已提交；
#   除既有无关 plan 修改外，相关源码工作区干净」。
# v4（2026-07-25，吸收 review 三轮 1P0+2P1+2 事实更新，全采纳；时序断言已自核实）：
# [P0 采纳·时序实锤] 源码完整性闸门必须前置——现 runner 时序为「invocation 返回 →
#   produceCriticReceipt(goal-runner.ts:~4541) → replayJournalIntoLedger(:~4687) →
#   ……(~5540) 才做 phase verdict/source drift」，即 v3 的「污染证据隔离」写了却排在
#   签发与收编之后，落地即失效。v4 重排：invocation 返回 → **源码完整性判定** → 干净
#   才允许签发 receipt/收编 journal/跑 gate。并补 mid-invocation self-revert 盲区
#   （改码→构建→截图→自还原→end diff=0）：(a) 只读边界预防（产品源码只读，仅
#   reports/build 输出可写）；(b) 每次构建/截图批次/test receipt/visual journal 绑定
#   **构建时点**的 product_source_digest（v4 原拟复用 computeProductWorktreeDigest
#   ——**已被 v5 取代**：精度不足，改用新原语 computeProductSourceSnapshotSha256
#   + provenance 链，实施以 v5 为准）；(c) 任一处不符 →
#   **整个 invocation 证据全部隔离**（推翻 v3「保留改码前证据」——无可信文件监控事件
#   即无法证明某证据产生于改码前）；(d) end-state 五形态反打只负责恢复工作区，不承担
#   证明证据纯净的职责。
# [P1 采纳] 视觉指标冻结为机器契约表（metric contract）：现有 FINALIZED_MIN_FIDELITY/
#   PASS_MIN_IOU 不能充当 edge divergence/空白率阈值。契约含指标名+方向+全局/逐屏阈值+
#   归一化方式+缺失时处置+以 07-18 最佳版本校准的 baseline/tolerance+版本号；
#   receipt 绑定 metric_contract_hash（防实现者选宽松阈值把结果门禁做成形式门禁）。
# [P1 采纳] receipt 中 **staging 内容哈希必填，commit 仅辅助元数据**（dirty/sanitize/
#   打包内容均可能与 commit 不同）；签名复用 confirmation-receipt.ts 既有原语
#   （canonicalReceiptPayload 稳定序列化 / domain-separated ReceiptAction / object_hash /
#   HMAC+trust registry），不另造签名协议。
# [事实更新1] **f6b2d9a4 已于 2026-07-25 09:38 提交（5da4ce20，含 post-impl5）**，工作区
#   已干净——前置条件已满足，执行顺序中的「先提交前置 change」改为已完成。
# [事实更新2] fidelity-intent-auto-routing 增 post-impl5 后重编号：宿主实测复验为
#   **tasks#11**，当前 10/11；本 plan 文件仍是仓内唯一未跟踪文件。
# v3（2026-07-24，吸收 review 二轮 4 关键点+2 小项，全采纳）：
# [1 采纳] T4 增「证据失效」环：testing 检出源码写入 → 该 invocation 标记
#   invalidated_by_source_mutation；只保留 mutation audit+改码前已落盘证据；改码后的
#   截图/visual-diff/test receipt/journal 轮次一律隔离进 audit 区，不入正式账本（隔离
#   而非静默收编，与 fail-closed 哲学一致）；反打后无可信的改前确定性 defect → 先重跑
#   一次只读 testing；有 → backtrack_to_coding。hunk 反打覆盖新增/删除/重命名/二进制/
#   冲突五形态，冲突 fail-closed halt（testing_mutation_revert_conflict），绝不退化
#   整文件 checkout。
# [2 采纳·修 v2 自相矛盾] amendment 采纳路径与状态机对齐——v2 写「backtrack 后的
#   spec/plan 增量环节采纳」但状态机只有 backtrack_to_coding，无控制流承载。取 review
#   推荐项：**本 run 永不自动采纳**；testing 只记录 proposal；需要改 acceptance 时
#   结束当前 run，由人工确认后以新 run 从 spec 起点进入（采纳即正常失效下游）。
#   backtrack_to_coding 不承载需求变更；不新增 backtrack_to_spec。
# [3 采纳] T8 升 P1 并入发布约束（它是唯一直接阻止首页误开发复发的门禁——T7a 只查
#   ui-spec 无主页屏、T7b 只采需求内 10 屏，都看不见 HomeTabPage 被改）；hard pixel 下
#   需求外页面修改=BLOCKER；确需跨屏先显式扩展 plan/ui-spec scope（走正常需求域变更，
#   非 testing/coding 私扩）；T7b 增 protected_negative_screens（首页等「不应变化」
#   页面的反向断言）。
# [4 采纳] T7b receipt 从「时间新鲜」升级为「精确对象绑定」：framework staging 内容
#   哈希/sanitized zip 哈希/宿主源码快照哈希（含 dirty）/HAP 哈希/goal manifest+需求+
#   10 参考图哈希/设备型号分辨率系统/checker·metric 版本/10 实拍截图哈希/faultlog 时间窗/
#   签名主体与 key provenance；发布门禁校验「待发布字节 ≡ receipt 绑定字节」；HMAC 密钥
#   不暴露给宿主构建脚本与 testing agent（runner 侧签名）。
# [小1 采纳] 宿主复演拆两用例：干净全链 PASS + 受控 fault-injection 验证 backtrack——
#   删除 v2「至少一轮 backtrack 证据」要求（避免激励人为制造缺陷）。
# [小2 采纳] T3 provenance 定义显式全序+不可比：placeholder < generated_unverified <
#   cropped_verified < user_provided_verified；不可比一律视为「非 ≥」→ 需 human receipt。
# v2（2026-07-24，吸收 review 一轮 3P0+6 项，逐条 ground-truth 核实后全采纳）：
# [P0-1·契约实锤] T4 重设计——原「.id() 白名单自动生成 pre_authorized_mutations」=事后
#   自签，违反既有契约（mutation-authorization.ts:125 RUNNER_MUTATION_POLICIES=空集+
#   "新增须走 openspec change"；await-confirm-guidance.ts:~136"pre_authorized_mutations
#   在任何信任态下都只是意图预登记"）。改为 testing 零产品源码写入（无白名单）；锚点
#   需求上游化（acceptance 声明→coding 落实现）；还原改 invocation 级 patch 反打。
# [P0-2] T7 拆两层（T7a decision-chain=P0 CORE_SUITE / T7b consumer-outcome=P1 宿主
#   机器门禁）+发布约束段；harness/tests/** 已在 release-excludes.json:11 排除；
#   截图脱敏+哈希登记。
# [P0-3·文案实锤] goal-runner.ts:960-966 VISUAL_GAP_RETRY_GUIDANCE 含 "fix the code
#   in THIS retry"，与 SKILL.md:114 正面冲突——guidance 改 phase-aware+四处契约统一。
# [采纳] rollback_coding→backtrack_to_coding（复用既有 authorized_backtrack/
#   backtrackToIdx/post-backtrack 增量复审语义，goal-runner.ts:3840/2323、check-ut.ts:814）；
#   amendment 提案不入裁决；T5 复用 FINALIZED_MIN_FIDELITY=0.45 系列常量接真算；屏级
#   独立 bootstrap；T4/T5 升 P0；T6 拆独立 change；T2 先行（与 T1 同触 harness-runner.ts
#   串行避让）；fidelity-intent-auto-routing 未完成项修正 tasks#10。
# v1（2026-07-24）：三方结论融合初稿（本会话双取证 agent + codex 独立探索，全部主张
#   逐条 ground-truth 核实：journal 时间戳 bug 实锤；回退机制存在但门槛使其从未触发；
#   SKILL 文字禁改码无机器 enforce；部署包=fffdff48 无滞后；best=07-18 run）。
overview: >
  【事故样本（2026-07-24，宿主 SimulatedWalletForHmos，run 20260724T030240Z-5f8dc9，
  cursor adapter，headless goal，desired=pixel_1to1）】比 07-18 好版本全面倒退：logo/卡面/
  插画全丢、全部银行页真机 crash 无诊断、半模态退化纯文本、卡包卡面纯色块、首页被误塞
  卡包银行卡组件；16 用例仅 4 过（28.6%）、六屏视觉裁决全 pending、终局被
  visual_ledger_integrity 击杀。对比素材：D:\1.code\对比结果\1-bc-opencard
  （0-原始需求 / 4-视觉优化后最好的结果=07-18 run / 5-7月24日最新版本效果）。
  【两个前提澄清（取证实锤）】(1) 部署包字节级 = fffdff48（HEAD），不存在部署滞后——
  问题就在最新机制叠加本身；(2)「最好版本」实为 07-18 run 产物（当天 in-run canary 实测
  cursor tool_read 4/4 → hasVision=true → 真素材裁剪），非 round7(07-07)；真回归窗口
  = 07-18→07-24 部署的 e9c4a7f3/a9d4c7e2 批次为主。b4aa7290..HEAD 计 548 files/+80788
  行机制改动，无一条结果级门禁用银行卡 10 屏做回归——机制测试越来越绿，宿主效果可以越来越差。
  【宏观定性】框架优化目标发生偏移：从「把宿主 UI 做得更像参考图」变成「如实记录能力不足、
  避免假 PASS、保护审计链」；后者有价值，但它允许系统以「诚实地做差了」的状态继续推进，
  最终没守住产品效果。诚实记账 ≠ 放行做差。
  【三链根因（全部实证）】
  链A 能力真值断链（首恶）：framework.local.json canary（07-18 tool_read 4/4，
  probed_via=goal，无 run_id）被两层规则同时否定——goal-preflight 判「7 天内新鲜→跳过
  重探」（fffdff48 goal-preflight.ts:308），三轴解析器判「goal canary 无 run_id/跨 run
  →降 adapter_declared→强制 blind_safe」（effective-vision-context.ts:328-345,526-528）。
  同一份缓存「新到不必探」又「旧到不可信」→ hasVision=false → pixel_1to1 钳成
  semantic_layout（fidelity-shared.ts:621-635，fffdff48）。harness 侧
  resolvePolicyVisualForHarness 根本不传 runId（fffdff48 harness-runner.ts:156-174）。
  链B 盲档协议破坏性执行：能力感知 prompt 教「无视觉→用占位勿裁剪」（fffdff48
  goal-runner.ts:731-738）+ blind_crop_prohibited（check-spec.ts:538/541，
  user_requirement 哨兵只授权不验真 :613-614）→ 用户需求明示「从原始截图裁剪获取」被
  静默否决（asset-manifest.yaml:21「盲档 headless run：禁止 acquisition:crop」）；
  coding 删除 07-18 已提交已验证的 4 个真素材 PNG（1.2MB 卡面/logo/插画/缩略图）换占位
  SVG，残留 7 处 $r('app.media.*') 悬空引用→大面积空白；testing 为 Hylyre 锚点把
  AllBanksPage .title() 改成非 @Builder 箭头 builder（真机 crash 高概率元凶）；需求明示
  「搜索本次先不实现」却被实现+配 TC-011；BankCardPackSection 被塞进 HomeTabPage
  （ui-spec 十屏无主页屏、plan F8 只分给 CardPackPage——agent 自由发挥，模块级 scope 门
  放行、盲 review 未拦）。
  链C 回修环三重锁死：(1) classifyPhaseVerdict 只有同阶段 retry(≤2)→halt
  （phase-transition-policy.ts:236-260），既有回退通道 reconcileMutablePhaseSourceDrift
  存在（goal-runner.ts:5528-5549）但门槛=「action!=='retry' ∨ 特定 blocker」且需授权链
  ——本次全程未触发；(2) 视觉裁决 headless 无出路：六屏 pending（all_banks
  score_floor=0.000 都采到了）无任何消费方转 must_fix；VL 判卷需 hasVision（已 false）、
  人审需交互（approval never）、无 MAISON_HMAC_GOAL_CHECKPOINT 终态封顶
  （capRunStatusForVisionTrust，goal-runner.ts:2166-2178）；且 goal-runner.ts:963 的
  重试指导明令 "fix the code in THIS retry"，与 SKILL 禁改码互相矛盾；(3) testing 改
  acceptance.yaml+16 源文件 → upstream_verdict_gate 四上游 stale + review_closure_
  attestation 双锁，越修越堵。终局：journal 收编重放 6 轮 row_hash 全漂移被判篡改→
  visual_ledger_integrity halt（detach.log:1623-1630）。
  【直接代码 bug（codex 定位，已核实）】appendJournalProposal 在 caller 不传 now 时
  用 new Date() 重打 at（intermediate-rounds-journal.ts:104）；生产调用
  consumeVisualRoundPayload 未传评估时刻（harness-runner.ts:858-889）；重放用 journal
  里的新 at 重算（:203）；at 参与 row_hash 不参与 base_state_hash → 现场签名
  「base 全对、fused 全对、row 全错」完全吻合。单测显式同 at 掩盖
  （intermediate-rounds-journal.unit.test.ts:68）。
  【与 f6b2d9a4 的关系（前置**已完成**：5da4ce20）】f6b2d9a4 已覆盖：意图三轴/自声明
  auto_crop 识别/await_human_fidelity_tier 删除/能力真值单源初版（meet 带 run 身份、
  消费面只认 run 快照、adapterImageInput 从快照派生）/crop 免 c3 机器验真通道/SSOT 四态。
  本 plan 不重复其范围，只补其未覆盖缺口；其 openspec change fidelity-intent-auto-routing
  的未完成项 **tasks#11**（宿主实测复验，当前 10/11）并入本 plan T7b 宿主复演合并执行。
  **f6b2d9a4 已于 2026-07-25 09:38 提交（5da4ce20，含 post-impl5），前置条件已满足**；
  除既有无关改动（.cursor/plans/android_工程适配_5e3400c3.plan.md）外，相关源码工作区干净；
  本 plan 文件是仓内唯一未跟踪文件，实施动工时一并纳管。
---

# 视觉负向优化根治 (d8c5f3a7)

> 标题注（v23）：文件名与原 H1 中的"盲档非破坏化/两层 golden"等机制已在 v22 删减式重构中移出
> 范围；现行范围 = **T1/T2 保留 + 最小回修闭环（F1-F5）+ 删除批（D1-D10）**。文件名不改（保
> 引用稳定）。

状态：**v23.5 已实施并提交（4a3e86a3，2026-07-26）——14 轮 review 收口**；typecheck 0 / unit 2461 / fixtures 44；**排期更新（用户定案）：先完成 c4e8b1d3（UI 文件级 scope 门 + consumer golden——其 v17 Todo 1-4 已于 2026-07-27 实施完毕），与本 plan 统一打包（candidate zip：npm run candidate:build）后做宿主真实闭环复演**（解禁条件三之三）；复演时宿主装 candidate zip、按 MAISON_GOLDEN_CONTRACT 跑 golden 十固定屏采集、evaluator 裁决 PASS 才 candidate:promote；禁发保持生效直至复演完成

> **v23.4 → v23.5（review 第 14 轮，最后一处）**
> 【必修】gate 侧 `visual_diff_evaluation_invalidated` 改**档位无关 BLOCKER/FAIL**：OpenSpec
> visual-diff 规格明文 "While present, the gate SHALL FAIL until a fresh evaluation clears
> the flag"（无档位条件），旧实现 best_effort 只 WARN——既违规格，也与 runner 侧 unverified
> 通路打架（runner 对该标记 retry/halt，gate 却放行=两层判定不一致）。补一条直接 gate 测试：
> best_effort + evaluation_invalidated=true → visual_diff FAIL/BLOCKER（113 例 visual-fidelity
> 全绿）。runner 侧 v23.4 修复不动、事件名不改。

> **v23.3 → v23.4（review 第 13 轮，最后一项必修）**
> 【P1】`evaluation_invalidated` 检查**前置**到 verdict/must_fix 判断之前：其语义是"该屏评估
> 整体不可信、待 critic 重评"，与 verdict 无关——放在①②之后时，verdict=pass 的失效屏在①就
> 被跳过，评估不可采信却照样 CHAIN_SLICE_COMPLETED。命中即进既有 unverified 通路（不回退、
> retry 重评、耗尽 halt）；提示语从"证据身份不可核实"泛化为"视觉评估尚不可采信"。新增
> R-6a3 回归（身份有效+pass+invalidated → 不回退、不完成、HALTED）。
> isStaleVisualDiffVerdict 后置复核与显式③④部分重复——按意见记为可选清理项，不扩改。

> **v23.2 → v23.3（review 第 12 轮，全采纳）**
> 1. 【P1】identity **mismatch 统一进 unverified 通路**：v23.2 把"明确不匹配"当正常代谢静默跳过——但"代谢"的前提是重评真的发生；best_effort 下 stale gate 只 WARN，重评没发生时已知 must_fix 会**假绿完成**（R-6a 当时还断言了 CHAIN_SLICE_COMPLETED，把错误行为焊死）。现在：截图不可读/截图 mismatch/build mismatch 与缺失/不可算走同一条通路——不驱动 coding、在产生**当前身份的新判定**前不完成，retry 引导重评，耗尽 halt。无新状态机。
> 2. 【P2】E2E-2c 锁死 halt **优先级**：补断言最终 `phase_halt.halt_reason === 'testing_write_violation'` 且**不含** `vision_ledger_tampered`——旧的错误实现（ledger 先 halt 提示 --resume）同样能过"两类事件都在"的断言，不按 halt_reason 断言就防不了回潮。
> 3. 【P2】goal-runs 文案删过度承诺："Tampering shows up in event/anchor audits" 不实（events.jsonl 是普通 append，现有锚只覆盖 vision ledger 场景）——改为如实的"runner-owned、约定只读、此处无机器保护"。不加递归快照、不加 HMAC。

> **v23.1 → v23.2（review 第 11 轮，全采纳；此后不再堆机制）**
> 1. 【P1】身份不可核实不再静默丢 must_fix：collector 返回 `{ defects, unverified[] }`——
>    **缺失/不可算**（缺 evaluated hash、缺 build fp 字段、currentFp 不可算=install ok 但 meta 写失败的真实生产路径）记 unverified；**明确不匹配**（旧截图/旧 build 的结论）仍属正常代谢静默跳过。runner 侧：仅 unverified 在场时不回退（不可信不驱动改码）也不 advance（must_fix 在场不装干净）——testing 内 retry 引导重采补身份（priorFailure 注入），耗尽 halt `unverifiable_must_fix`。R-6a/R-6a2 断言改为"不回退且不完成"。
> 2. 【P2】组合篡改统一裁决：ledger 比对只落事件；**source violation 在场 → 终止态为主**（新开 run 指引，附注 ledger 同时命中）；ledger-only 才提示 `--resume`——消除"提示 resume 又拒 resume"的自相矛盾指引。
> 3. 【P2】boundary 文案与机器闸门对齐：三段式如实声明——snapshot-enforced（产品层/SSOT/根构建配置）、专项 ledger 检查（vision 两账本）、`goal-runs/**` 明示 **NOT snapshot-covered**（runner 自写域，篡改由事件/锚审计兜）。不做 goal-runs 递归快照（runner 自己在写，按简单化原则收窄文案）。
> - MaxListenersExceededWarning 为测试隔离清理项（集成测试多次 goalMain 重复注册 signal handler），不影响单进程生产运行，按意见不扩方案。

> **v23 → v23.1（review 第 10 轮，全采纳）**
> 1. 【P1】actionable 谓词③④显式化：收集器不再只依赖 `isStaleVisualDiffVerdict`（它对缺 evaluated hash 返回"不 stale"、currentFp 不可算时跳过 build 校验）——现显式要求 evaluated_screenshot_hash 非空且匹配盘上截图、当前 build fingerprint **可算**、evaluated_build_fingerprint 相等，缺任一身份=不 actionable（fail-closed）。R-6a 扩为三反例 + R-6a2 两反例。
> 2. 【P1】预算耗尽不再放行：policy 的 actionable 分支**删预算条件**（旧写法耗尽后 PASS+actionable=advance/FAIL=retry，残留缺陷被当通过推进）；预算/指纹/target 裁决收归 runner 统一分支并在那里 halt。policy 单测反转。
> 3. 【P1】faultlog 基线改 **per-nav**：整批一拍会把 A 屏崩溃归因给其后只是超时的 B 屏（探针实证）；主屏/overlay 每次导航前各拍。补 per-nav 场景单测 + 接线断言（旧整批变量禁回潮）。
> 4. 【P1】缺陷上下文生命周期：授权回退前清空 backtrackCodingContext；事件回放对每条回退事件**无条件** `context = ev.defects ?? []`——授权回退不再重新注入已修好的旧 visual 缺陷。
> 5. 【P1】发布件主 SKILL（device-testing/SKILL.md）矛盾指令清除："本轮重修重判"改为"修码不在 testing 内进行（runner 消费 must_fix 回退 coding）"；第 10 条零源码写入约束从"生成测试文档时"扩到**整个 testing 阶段**（含 SSOT/根构建配置与终止态后果）。
> 6. 【P2】源码检测挪到 vision ledger 比对**之前**（旧时序 ledger tamper continue 早退会丢源码取证）；resume 终止态判据改按 violation **事件**（不看 halt reason 归谁）并落 `resume_rejected` 事件。新增 E2E-2c：并发篡改两类事件都落 + resume 仍拒。
> 7. 【P2】R-8 假绿修真：旧断言统计的是第一次 run 的旧事件（第二次 resume 被 5 分钟 cooldown 拦下根本没进 testing）。cooldown 是硬防线不改语义——测试回拨 run_end 时间戳模拟真实时间流逝 + `--ack-unverified-ledgers` 弱 ack；断言收紧为：确实重入 testing、repeat halt **净增一条**、回退事件数不变。
> 8. 夹具真化：宿主 config 显式 `reports_dir_pattern`（与 SimulatedWalletForHmos 真实值一致）+ install meta/hap 造 build 身份 + golden 截图物化先于 mutate（转录用例算 hash 需文件在场）。

> **实施记录（v23 execution，2026-07-26）**
> - **F2**：product-source-snapshot.ts 整文件重写为 fs 递归哈希（三集合/五类变化/lstat 不跟随 symlink/稳定排序/产品层缺失=unverifiable）；实施中测试抓到真 bug——`resolveFeatureArtifact` 对 ui-spec/acceptance 只给扁平 canonical，而宿主真实产物在 `spec/` 子目录（事故产物为证）→ 已补 `spec/<name>` 候选。
> - **goal-runner 手术**：删 quarantine/invocation-revert/provenance 消费/collector（~500 行）；F1 落地=`ActionableDefect` 统一收集（5 条谓词复用 `isStaleVisualDiffVerdict` 同判据；指纹复用 `computeDefectFingerprint` 结构化锚）+ `roundFingerprintOf` 整轮集合指纹 + 事件持久化 `round_fingerprint`+有界 `defects[]` + `backtrackCodingContext` 恢复 + coding prompt 注入 `buildTestingDefectsBlock` + outcomes filter 对齐完成判定 + 预算统一 `DEFAULT_MAX_BACKTRACKS`(2) + violation=run 终止态拒 resume。
> - **policy**：actionable 判据挪到 **PASS 之前**、只在 testing（UT 不读视觉产物）；单测里"PASS 恒 advance"错误断言已反转。
> - **D1-D10**：8 个模块文件 + 6 个单测文件删除；capability-registry 三侧收敛（悬空 `$r` 扫描迁入 visual-parity-backstop，从 coding.visual_parity 注册）；三侧 phase-rules 声明收敛（coding 保留 media_reference_integrity 一条）。
> - **F3**：faultlog 集合差（导航前 `snapshotFaultlogSet` → 失败后重列 → 新增∧含 bundle）；删 UTC 时间窗；归档 schema 1.2 含 run_id；**实施中发现并修复设计缺口**：同 run 修好后旧 crash 归档会被再消费 → capture 开始时清理本 run 旧归档。
> - **F4**：`visual_parity_asset_materialized` 档位无关 BLOCKER/FAIL（占位声明已豁免）；`visual_parity_asset_render`（静态未渲染，低置信）一律 WARN。
> - **F5**：testing-rules.yaml verdict_abandonment 文案 / workflow-detail 禁止弃判段 / `VISUAL_GAP_RETRY_GUIDANCE_TESTING` / testing-write-boundary prompt 四处对齐"testing 不改码、修码走回退"。
> - **验收**：`goal-runner-testing-integrity` 重写为 **8 项（E2E-1~5 + R-6a/6b/7/8）全绿**——含 E2E-3 全链真跑（PASS+must_fix→回退→第二次 coding prompt 断言含原始 must_fix→修复→run 达 CHAIN_SLICE_COMPLETED）；golden 收缩为 10 例（决策链 A 组保留 + v23 事故回放 3 例改用生产 `collectActionableDefects`：六屏 pending→零 actionable 如实 + F5 转录后→actionable + crash 归档 run 过滤）；新增 device-crash-diagnostics 集合差 6 例；product-source-snapshot 新语义 10 例。
> - **实施中修的自伤 bug**：resume 拒绝误用 `process.exit`（杀测试进程）；spy 夹具 summary 值与 runner `applyClosurePatchFromReceiptValidation` 回写不幂等（`valid`→`passed` 字节变化→lineage stale）——生产链靠同值幂等，夹具对齐；ratchet 元门禁抓到 BLOCKER 字面量形态。
>

> **v20 → v21：为什么推倒**（8 条核实全部实锤，保留作依据）
>
> 1. `classifyPhaseVerdict` 里 `PASS` 先行 return——best_effort（银行卡真实档位）下视觉缺陷是 WARN、verdict=PASS → **回修环从未可达**；单测还固化了该行为。
> 2. backtrack 分支不清 outcomes，而完成判定是 `outcomes.length === chain.length` → **即使修好 run 也永远完不成**。
> 3. 指纹熔断读进程启动时的 priorEvents → 同进程内失效；`blocker:id` 粒度过粗。
> 4. `worktreeChangeSet` 建在 git status 上，而 `goal-runs/`、`reports/*` 本就在 canonical gitignore；`docs_committed:false` 宿主 doc 域整体不进 git → **写边界在真实宿主上半盲**；SSOT 按 dirty-vs-HEAD 判 → 新 goal 未提交需求被永久误伤。
> 5. 通用指标建在被证伪的度量上：`score_floor` 在既有代码里明写 **reference_only（历史多次实测证伪，不参与任何判定）**，collector 却把它喂进 must_fix；`blank_area_ratio` 实测好坏版本分布几乎相同（最好版 6/8 超阈值，首页 0.8906）。
> 6. provenance 登记 merge 后全部屏——历史保留屏被登记成本批次产物，**制造假 provenance**。
> 7. `required_anchors` 无 spec 侧生产者 → 永久 SKIP；acceptance-amendment 无生产调用方 → 死代码。
> 8. `product-source-snapshot.ts` 含 2 个真实 NUL 字节；依赖 git（排除 ignored 文件）。
>
> **教训**：不是"机制不够"，是**在错误地基上叠机制**。删减，不补洞。
>
> **v23 收敛补钉（review 第 9 轮，全采纳；3 P1 + 1 整理——本轮后停止 review，开工）**：
> ① 整轮指纹端到端统一：`phase_backtrack_requested` 显式保存**完整 `round_fingerprint`** 字段；`seenRoundFingerprints` **直接从该字段恢复**，不从有界 defects[] 反算（截断+上限 20 的 defects[] 无法可靠重建指纹）；验收 #8 改为按 roundFingerprint 断言。
> ② crash 交接结构统一：新增 **`ActionableDefect`** 统一结构（source/screen_or_case_id/instructions[]/fingerprint/evidence_path），视觉缺陷 must_fix→instructions，崩溃生成确定性修复指令附诊断路径；**evidence_path 由 runner 生成，不信任产物自报**；验收 #4 补 crash 指令进 prompt 的断言。
> ③ "只在 testing"措辞收窄误伤既有授权回退（现有 authorized drift 回退在 ut/testing 都运行）：改为**新增的 visual/crash actionable 检测只在 testing 执行；统一回退事务仍供既有 ut/testing authorized-backtrack 调用，不删除不收窄原授权调用点**。
> ④ 版本标签统一 v23（执行方案/发布约束/执行顺序），H1 加范围收缩注记。
>
> **v22 → v23（review 第 8 轮，全采纳；1 P0 + 3 P1 + 2 小整理）**：
> ① 【P0】补上闭环**最后一段电线——缺陷交接给 coding**：此前 F1 只定义了识别/回退/失效，没定义"缺陷内容如何交给下一次 coding invocation"（`buildPhasePrompt` 无 defect 参数、事件只存短标签、coding prompt 无 must_fix 注入 → 回去了也不知道修什么 → 原样重跑 → 熔断）。F1 新增交接四步（事件持久化有界 defects[] / 进程内 context / 重启恢复 / prompt 必做段），E2E #3 升级为断言 prompt 文本。
> ② 【P1】新鲜度口径修正：**由 identity 判定，不看 run_id**——visual-diff 判定本就设计为同 build 跨轮持久（capture 侧同 build 同截图跳过重采保留 verdict/must_fix），"上一 run 一律不回退"会破坏它。上一 run 但 build+截图一致 → 仍是有效 actionable defect。回归 #6 拆两方向。
> ③ 【P1】悬空 `$r` 等结构性素材问题**移出 testing 回退输入**——F4 已把它们做成 coding 侧确定性 FAIL，coding 阶段就会失败，不需要绕到 testing 再发现一次。testing 回退输入收窄为两项。
> ④ 【P1】指纹熔断明确为**整轮集合指纹**：`roundFingerprint = hash(sort(actionable fingerprints))`，整轮集合完全相同才判无进展；{A,B} 修成 {B} 允许再回退。
> ⑤ 宿主配套 1-4 从历史区提炼进 v23 现行 Todos；F2 补 lstat/不跟随 symlink/稳定排序/产品层缺失=快照失败 四条实现约束。
>
> **v21 → v22（review 第 7 轮，全采纳）**：v21 方向确认，但 (a) plan 里旧方案与新方案并存会让实施者把 v21 当补充说明——本版完成文档降级整理；(b) 补钉五个边界：violation=run 终止态拒 resume、must_fix 新鲜度谓词冻结、统一回退四条细则、指令面统一入范围、asset FAIL 收窄到确定性事实；(c) 发布约束与 c4e8b1d3 依赖按删减后现实重写。
>
> ## v23 执行方案（唯一目标 = 最小闭环跑通）
>
> **核心闭环**：testing 不改码 → testing 产出可信缺陷 → runner 回 coding → 修复后重测 → **run 正常完成**。
>
> ### 一、修（5 项）
>
> **F1 统一回修环 `requestBacktrackToCoding()`**（授权回退与缺陷回退共用）
> - 触发：**新增的 visual/crash actionable 检测只在 testing 执行**（UT 不读视觉产物）；在 PASS/advance 判定**之前**评估——actionable 缺陷非空即回退，与 verdict 无关（best_effort 的 WARN 同样回）。**统一回退事务仍供既有 ut/testing authorized-backtrack 调用点使用——不删除、不收窄原授权路径**（现有授权 drift 回退在 ut/testing 都会运行）。
> - **actionable 谓词（冻结，5 条同时满足才算）**：
>   ① 该屏 `verdict ∈ {warn, fail}`；② `must_fix[]` 非空；③ `evaluated_screenshot_hash` 与当前截图文件 hash 一致；④ `evaluated_build_fingerprint` 与当前 build 指纹一致；⑤ 当前 visual_diff checker 未把该屏判 stale/invalid。
>   **新鲜度由 ③④ 的 identity 判定，不看 run_id**：上一 build 或 identity 不匹配 → 不回退；**上一 run 但 build+截图完全一致 → 仍是有效 actionable defect**（visual-diff 判定本就设计为同一构建下跨轮持久——capture 侧同 build 同截图跳过重采并保留 verdict/must_fix；源码和 HAP 都没变，缺陷就还是真缺陷，不因换 run_id 失效）。污染 invocation 遗留的 visual-diff 也由 ③④ 自动失效——**不需要 quarantine**。
> - 输入并集（**只有两项**）：新鲜 visual must_fix（上述谓词）+ 本轮导航**新增** faultlog 的 crash_suspected。
>   悬空 `$r`/素材缺失/文件损坏等结构性问题**不进 testing 回退输入**——F4 已把它们做成 coding 侧确定性 FAIL，coding 阶段就会失败，不需要绕到 testing 再发现一次。
> - **统一交接结构 `ActionableDefect`**（两个来源归一；交接、指纹、熔断全用同一形状）：
>   `{ source: 'visual_diff' | 'crash'; screen_or_case_id: string; instructions: string[]; fingerprint: string; evidence_path: string }`
>   视觉缺陷：`must_fix[]` 逐条映射为 `instructions[]`；崩溃：生成**确定性修复指令**（形如「进入 <screen> 即崩溃（faultlog 新增 <文件名>），修复崩溃本身而非导航/选择器；诊断摘要见 evidence_path」）并附诊断归档路径。**`evidence_path` 一律由 runner 按已知目录结构拼接生成，不信任产物自报的路径**（防指到任意文件）。
> - 统一细则（四条）：
>   ① **总预算共用一个常量 2**（删现有 1 与 2 两种口径）；
>   ② **整轮集合指纹**：`roundFingerprint = hash(sort(本轮全部 actionable defect fingerprints))`——**只有整轮集合完全相同**才判无进展熔断；第一次 {A,B} 修复后变 {B}，允许再回退（单缺陷仍在 ≠ 无进展）。`seenRoundFingerprints` **启动时从本 run 有效 events 初始化**，随后内存实时更新——进程重启后同集合不得再回退；
>   ③ 优先级：operator/integrity/source-write 等**安全 halt → actionable defect 回退 → 普通 PASS/FAIL**；
>   ④ chain 不含 coding → 直接 `backtrack_target_absent` halt。
> - 指纹：**优先复用结构化锚**（screen/class/element/region/bbox）；仅无结构化锚点时退回规范化文案哈希。
> - 回退动作：从 outcomes **splice 掉被失效阶段**旧条目（修完成判定）+ passSnapshotMemory 清理 + 既有 invalidation tx（begin+commit）。
> - **缺陷交接（本环最后一段电线——review 第 8 轮 P0）**：识别/回退/失效之外，必须把缺陷内容真实交到下一次 coding invocation，否则"回到 coding → 不知道修什么 → 原样重跑 → 熔断"：
>   ① `phase_backtrack_requested` 事件持久化两个字段：**完整 `round_fingerprint`**（熔断恢复的唯一依据）+ **有界 `defects[]`**（`ActionableDefect` 形状；单条 instructions 文本截断、总条数上限 20 超出记 count——它只服务交接内容，**指纹恢复不从它反算**）；
>   ② 同进程保存在 `backtrackCodingContext`；
>   ③ 进程重启时：`seenRoundFingerprints` **直接从各事件的 `round_fingerprint` 字段恢复**；`backtrackCodingContext` 从最近一条事件的 `defects[]` 恢复（一次遍历取两者）；
>   ④ 下一次 coding 的 prompt 注入「**Testing defects to fix（必做）**」段——逐条列 screen_or_case_id + instructions + evidence_path（visual 与 crash 两种来源同列）。
> - 同集合指纹重现或预算耗尽 → halt（不原地 retry testing）。没有 visual-diff.json 时**不新造**人工阻断——既有 visual_diff 检查已负责 P0 缺屏与无有效判定。
>
> **F2 testing 写保护 = fs 递归哈希的 invocation 前后快照**（重写 product-source-snapshot.ts；不依赖 git，消灭 NUL，覆盖 gitignored 与 docs_committed:false 宿主）
> - 快照范围三个集合：① 产品源码层目录；② 当前 feature 的 SSOT——**经 `resolveFeatureArtifact` 定位 canonical/legacy 真实路径**的 `acceptance.yaml / contracts.yaml / ui-spec.yaml / spec.md / plan.md / use-cases.yaml`；③ 少量根构建配置：`build-profile.json5`、`oh-package.json5`、`hvigorfile.ts`。
> - 覆盖：文件**新增、删除、内容、路径、类型**五类变化。
> - **invoke 前快照失败 → 不得调用 agent**（fail-closed）。
> - 判据：invoke 前后对比，不与 HEAD 比——pre-existing dirty 合法，本 invocation 新增变化才违规。
> - 违规处置：不签 receipt / 不收编 journal / 不跑 gate / halt 并精确列出变更文件；**不自动反打、不 retry、不搬 quarantine**。
> - **`testing_write_violation` 是该 run 的终止状态：同 run `--resume` 一律拒绝**（否则 resume 的新前快照会把遗留修改当合法基线，违规被洗白）；人工整理现场后必须新开 run。不为此造恢复事务。
> - 实现约束：递归用 `lstat`，**不跟随 symlink/junction**（防 Windows junction 循环或逃出预期范围）；路径**稳定排序**后再哈希；**配置声明的产品层目录缺失/不可枚举 = invoke 前快照失败**（同样不得调 agent）。
> - 已知接受的盲区（明示，防日后又把 provenance 加回来）："写入后自行恢复"的瞬时修改暂不检测。
>
> **F3 崩溃诊断改 faultlog 集合差**
> - 导航前记录 faultlog 文件名集合 → 失败后重列 → **新增 ∧ 含当前 bundle** 才 crash_suspected。
> - 删文件名时间戳窗口逻辑（Date.UTC 解析设备本地时间 = 时区坑）。
> - 诊断结论**直接**作为回修信号（不绕 crash_free 指标）；归档保留且含 run_id。
>
> **F4 素材硬门禁收窄到确定性事实**（改既有 coding-visual-parity-check，不建新体系）
> - **档位无关 FAIL 仅限**：required/brand-critical 物化文件缺失；文件损坏/空白/纯色；`$r('app.media.*')` 悬空；明确映射到 owner struct 且确定不存在对应资源引用。
> - "静态扫描没找到渲染引用"**继续 WARN**（该检查自注低置信、动态渲染可能漏判）——实际页面未渲染交给新鲜 visual-diff must_fix。刚删掉不可靠指标，不再引入另一个不可靠硬门禁。
> - "换成另一张错误真图"机器判不了，继续交视觉对照。
>
> **F5 指令面统一**（原事故直接根因之一：发布出去的指令仍要求 testing 改码）
> - `specs/phase-rules/testing-rules.yaml` `visual_diff_verdict_abandonment`："重试轮内修码重测" → "verdict=fail + 信号转 must_fix 转录；修码由 runner 回退 coding 执行"。
> - `skills/reference/device-testing-workflow-detail.md` "禁止弃判"段同改（"在本 testing 重试轮内直接修码并重采重判"表述删除）。
> - `goal-runner.ts` `VISUAL_GAP_RETRY_GUIDANCE_TESTING`：删 quarantine 与 required_anchors/acceptance 声明表述，对齐"违规=halt、缺陷=回 coding"。
> - 全库一致性清扫：grep testing 语境下"修码/修复重测"类指令，逐条对齐。
>
> ### 二、删（整体删除，不修）
> D1 `acceptance-amendment.ts` + t4-provenance-amendment 相关单测（无生产调用方）
> D2 `acceptance-anchors.ts` + coding-rules 的 acceptance_anchor_coverage 声明（无生产者，永久 SKIP）
> D3 `invocation-revert.ts` + source-baseline 备份 + 单测（自动改用户文件比停在现场风险更高）
> D4 按 mtime 的 evidence quarantine（goal-runner 内；新鲜度谓词已让污染证据自动失效）
> D5 `evidence-provenance-chain.ts` + `provenance-recorder.ts` + build/install/capture 三处 hook + 单测（登记合并全屏=假 provenance）
> D6 `visual-metric-contract.ts/.yaml` + `visual-metric-compute.ts` + goal-runner 内 collector（~220 行）+ `deterministic_signal_unavailable` 分支 + 单测（score_floor 系 reference_only；blank_ratio 无区分力）
> D7 六分区机器分类器接线：`worktreeChangeSet` + `classifyWritePath` 生产调用（git status 在真实宿主半盲）；testing-write-boundary 保留**静态 prompt 文案**（措辞对齐 F2 真实行为）
> D8 `asset-nondestructive.ts` 五级证据/非对称偏序/跨 run baseline + spec/coding/testing 三侧 rule 声明收敛（悬空 `$r` 检查迁入既有 parity-check 后删模块）
> D9 device-crash-diagnostics 的时间窗逻辑（被 F3 集合差替代）
> D10 golden 中依赖 score_floor/blank_ratio/通用 metric contract 的断言（事故产物 artifacts 保留）
>
> ### 三、保留（直接修真实事故、成本低）
> - T1：canary fresh ∧ run admissibility 同一谓词 + fallback harness 透传 run ID（已完成）
> - T2：journal 显式传入 `at`，禁内部再造时间戳（已完成）
> - testing 首轮 prompt「只采证、不改码」约束 + testing 视觉缺陷指导文案（措辞随 F5 对齐）
> - 崩溃诊断入口与结构化归档（F3 集合差版）
> - 既有 invalidation transaction
> - bc-openCard 事故产物 regression fixture（断言收缩为真实闭环）
>
> ### 四、验收 = 5 个 E2E + 3 个回归
> 1. invoke 前已有未提交 acceptance/source，testing 不写任何内容 → **正常放行**（不误伤新 goal）。
> 2. testing 改产品源码或当前 feature SSOT → gate 不运行、立即 halt、精确报告文件。
> 3. best_effort + PASS + 新鲜 must_fix → 回 coding，**断言第二次 coding prompt 文本确实包含首轮 testing 的原始 must_fix 内容**（fake coding agent 不得靠测试代码直接改文件绕过交接验证），修复后重新 review/UT/testing，**run 最终正常完成**（outcomes 对齐）。
> 4. 本轮新增 faultlog → 回 coding，**且断言第二次 coding prompt 包含 crash 修复指令与诊断归档路径**（ActionableDefect 交接对 crash 同样生效）；旧 run/faultlog 残留 → 不回退。
> 5. logo 文件删除 / `$r` 悬空 / required 素材物化缺失 → coding 门禁确定性 FAIL（档位无关）。
> 6a.（回归）**上一 build 或截图/build identity 不匹配**的 must_fix 不触发回退（谓词 ③④ 生效）。
> 6b.（回归）**上一 run 但 build+截图完全一致**的 must_fix **仍**触发回退——保护 visual-diff 既有的同 build 跨轮持久化设计，防止日后有人加 run_id 强制失效。
> 7. （回归）testing 写违规后，同 run `--resume` 被拒绝。
> 8. （回归）进程重启后，**同一 `roundFingerprint`（同一整轮 actionable 集合）仍熔断**（从事件 `round_fingerprint` 字段恢复生效）；集合发生变化（{A,B}→{B}）**不**熔断、允许再回退。
>
> ### 发布约束（v23，替代 v13）
> - 本 plan 解禁条件只剩三项：**v23 重构完成（删+修+指令面统一）**、**上述 8 项验收全绿 + 全量 unit/fixtures 全绿**、**宿主真实闭环复演**（干净全链连跑两 run 口径保留；fault-injection 用例验证回修环真实触发一次）。
> - 屏级 bootstrap、通用视觉指标、结果级 receipt **移出本 plan**（不再作为禁发条件；需要时另行立项）。
> - c4e8b1d3 依赖注记：该 plan 声称消费本 plan 的 provenance 链与 `metric_contract_hash`——两者将被 D5/D6 删除，**c4 依赖段须在其动工前重写**（已在 c4 文件加注记）。
>
> ### 执行顺序（v23）
> F2（fs 快照原语，其余项的地基）→ D1-D10（删除批，先删后修避免改死代码）→ F1（统一回修环）→ F3 → F4 → F5（指令面）→ 测试收缩与 8 项验收 → 文档收尾（c4 注记核对、宿主配套下发）。宿主配套 1-4 随时可先行。
>
> 预估净删 ~2500-3000 行生产代码 + 对应单测；新增集中在 F1（~150 行）与 F2（~120 行）。

> **v19 → v20（review 第 5 轮：3 P0 + 2 P1，全部属实；本轮问题集中在"新接线产生了错误动作"）**
>
> 1. **【P0】`blank_area_ratio` 会把最佳版本一起判坏——已实测复现**。
>    我用归档的「最好版本」与「最差版本」各 8 张真机截图跑生产 `computeImageStats`：
>
>    | | 最好版本 | 最差版本 |
>    |---|---|---|
>    | 超阈值(0.55) | **6/8** | 6/8 |
>    | 添卡首页 | 0.8906 FAIL | 0.9387 FAIL |
>    | 首页点更多 | 0.8602 FAIL | 0.9125 FAIL |
>    | 选卡页 | 0.8582 FAIL | 0.9449 FAIL |
>
>    两版共有的 6 屏 **verdict 完全相同**（4 FAIL / 2 pass）。数值方向是对的（坏版每屏都更高），
>    但绝对阈值零区分力——`contentRatio` 把近白/近黑都算空白，与契约声明的"背景归一化 +
>    排除状态栏/导航条"根本不是一回事。启用它只会稳定打回好版本。
>    **处置（通用规则，不是单点补丁）**：契约里 `baseline: null` 就是"从未用真机产物校准"的
>    SSOT 标记。此类**连续量**不得单独驱动回修——只有落到量程退化端点（higher_is_better ≤ 0
>    = 完全无匹配；lower_is_better ≥ 1 = 完全发散）才判 must_fix，端点是量纲事实、不需校准。
>    其余一律 `not_evaluable` 且**带上实测值**留档供校准。这条同时覆盖 `edge_divergence`
>    （阈值 0.35 同样 `baseline: null`，而事故产物里 0.5996 出现在 fidelity 0.9965 的屏上——
>    同一个坑）。事故的真信号 `all_banks score_floor = 0.0` 落在端点，仍然抓得住。
>
> 2. **【P0】UT 的回修环被视觉产物反向截断**：ut 阶段本就不产 visual-diff.json，我上一轮加的
>    unavailable→halt 在 ut 一律触发 → UT 失败根本走不到 backtrack。改为**只在 testing** 执行
>    视觉 unavailable 策略。同时 `DETERMINISTIC_BACKTRACK_BLOCKER_IDS` 此前是**导出后无人消费**
>    的常量——现已并入回修判据（与视觉缺陷取并集），指纹与清单也一并计入，避免判重失灵。
>
> 3. **【P0】六分区写边界只是"表面接线"**：`classifyWritePath` 拿到的路径来自产品源码快照，
>    而该快照只扫产品层 + 少量根配置——改 `acceptance.yaml` 前后 hash 完全相同、判 clean。
>    这正是死锁事故的直接动作面。新增 `worktreeChangeSet()`（`git status --porcelain -z -uall`）
>    枚举**整个工作区**，逐条分区判定。两处细节：
>    - **作者归属**：runner 自己也在 `goal-runs/**` 合法写入（provenance 链、source-baseline
>      备份），文件系统层面分不出作者 → 该域只**记录**（`runner_evidence_zone_touched`）不判污染，
>      否则第一轮就把自己误伤了（实测确实误伤，已修）。
>    - **需求 SSOT 按状态判、不按"本轮是否新改"判**：只看"本轮新增"有洞——第二次 attempt 时
>      该文件已在 pre 集合里，会被当成用户既有改动放过，**重试即绕过**（集成测试实测到了）。
>      现在只要 invoke 结束时它相对 HEAD 是脏的，本轮证据即无效。
>
> 4. **【P1】所有屏被硬编码 P0**：解析时丢了 `priority`，于是 ui-spec 明写 P1 的
>    `bank_card_list_sheet` 也产出"P0 屏未采集"。改为消费真实档位（缺声明时保守按 P0）。
>
> 5. **【P1】`required_asset_present` 名不副实**：它只证明**静态素材可用性**，不证明 UI 真的
>    引用并渲染了正确那张。宿主反例：`BankListItem` 忽略 `bank.logoKey`、所有银行硬编码同一个
>    logo——素材一验真本指标照样 PASS。已在契约 label、YAML SSOT 与函数注释三处正名，并写明
>    "屏上素材在场/映射正确"须由布局树（T8）或视觉结果门禁回答。
>
> **新增回归**：最小复现「只改 acceptance.yaml → 写边界判越权且 gate 零执行」、「runner 自身写
> goal-runs 不得被误判」、素材指标三态（无 contracts 不可评估 / 占位判 0 / 已验真判 1）。

> **v18 → v19（review 第 4 轮：3 P0 + 3 P1，逐条核实后全部属实）**
>
> **已修**
> 1. **【P0】计算失败仍不触发任何动作**：`collectDeterministicVisualDefects` 失败只打日志返回 `[]`，调用方按 `length === 0` 判"无缺陷"→ 不回退也不求人，原事故第二根因原样复发。改签名为 `{ defects, unavailable }`——**「算过了没缺陷」与「根本没算出来」必须可区分**；runner 在 `unavailable !== null && !envBlocked && verdict !== 'PASS'` 时落 `deterministic_signal_unavailable` 事件并 **halt 求人**（回退 coding 修不了损坏产物，重试也修不了）。
> 2. **【P0】四项计划内指标未接生产链**——接了两项、如实保留两项：
>    - `required_asset_present`：新增 `assetPresenceByScreen()`，按屏遍历 `asset_ref` × T3 证据分级判定。这是本案十个 UI 缺陷**第一条**（添卡首页 logo 全丢）该抓的信号。此前我说"两道 BLOCKER 已覆盖"**不成立**——非破坏门只保护历史已验真素材（首次就是占位无从谈起），引用完整性只查文件存在（占位图同样存在）。
>    - `blank_area_ratio`：`computeScreenObservation` 在 jimp 可用时本来就真算 `contentRatio`，此前被我误列进"未接线"。现纳入 WIRED，日志不再谎报。
>    - `geometric_iou` / `required_element_coverage`：确需运行时布局树几何 = **T8**，已随 c4e8b1d3 拆出；继续记 `not_evaluable` 并在日志点名。
>    - 顺带堵一个我自己引入的坑：无 contracts 时 `locate` 恒 null 会把**每一屏**判成素材缺失（fail-open 换成 fail-noisy）。故 WIRED 改为**动态**——只有确实拿到判定才纳入 missing 策略。
> 3. **【P1】崩溃诊断无 run 新鲜度**：归档路径是 feature 共享的 `<screen>.json`，跨 run 残留会把上一 run 的崩溃当成本轮的 → 错误 backtrack。归档升 schema 1.1（`run_id` / `attempt_id` / `window_start_ms` / `generated_at`），消费侧**只认本 run**；无 `run_id` 的旧格式按过期处理。
> 4. **【P1】overlay 归并只认 `__overlay__0`**：实际后缀是任意的（`OVERLAY_SEP` + `overlayBaseName`，见 visual-diff-nav.ts:120），于是命名 overlay 或 `__overlay__1` 采到了也会把基屏误报成缺屏。改为按基名归并。
> 5. **【P1】`classifyWritePath` 零生产调用方**：接进 testing 越权检测——越界文件按分区归类进事件与报文（`write_zones` 统计 + 每条 `[zone]` 标注），与 prompt 用同一判据。同时**撤回"runner enforced"这类表述**：写入边界目前是"检测 + 报文"，不是写时拦截。
>
> **未修（第二类，用户已定不做；但表述按 review 意见修正）**
> - provenance 链**伪造**、baseline **删除洗白**、quarantine 的 **mtime 回拨/复制旧截图**——三者都需要 agent 主动改证据。review 指出"事故 agent 曾改 16 个文件和 acceptance，称其为恶意前提不稳妥"，这一点接受：**不再声称已防住**，plan 与代码注释一律表述为「未处理」而非「已归类为无害」。真正的解法是内容认证锚（HMAC/receipt），属独立 change。
>
> **T7a 降为部分完成（review 第 4 轮 P0-3，属实）**
> - 已达成：真产物回放、**生产 consumer** 而非手工 observation、字段名反证、崩溃归档→must_fix 端到端、跨 run 新鲜度、overlay 归并。
> - **未达成**（plan 原文要求）：`goal-report.json::fidelity_routing`（宿主未提供该产物，不可伪造）、acceptance/bootstrap fixture、脱敏低清参考图副本（**有意不做**：原图含真实 PII，框架仓要打包发宿主）、verified asset 的**正向**结果、独立 hard / `DEFERRED_CAPABILITY_MISSING` fixture。参考图断言目前只校验登记串形似 sha256，未校验任何图像字节。
> - 结论：当前 golden 能证明"部分旧事故会被判缺陷"，**不能**证明"修复后的完整决策链会得出正确结果"。故不标 completed。

> **v17 → v18（review 第 3 轮：5 P0 + 1 P1，逐条对 ground-truth 核实后分流）**
>
> **已修（诚实路径上就会失效的真 bug）**
> 1. **provenance 校验常年不通电**：`if (chain)` —— 链文件不存在或 JSON 损坏时 `loadProvenanceChain` 返回 null，整段校验被**跳过**，截图照常进正式 gate。而 recorder 只在 `MAISON_GOAL_RUN_ID` 在场且 goal-runs 目录已建时才写盘，任一不满足就没有链。改为：有截图（或截图目录数不出来）而无可用链 = 断链。
> 2. **确定性缺陷计算静默 fail-open**：`if (!existsSync) return []` 与整段 `catch { return [] }` 把"文件没了 / JSON 损坏 / profile 模块加载失败"一律变成"本轮零缺陷"。改为如实报错留痕（仍返回空集，但人看得见原因）。
> 3. **崩溃诊断没形成结构化闭环**（本轮最要紧的一条）：诊断结论此前只拼进错误字符串，机器读不到 → crash 永远进不了 must_fix。现在采集侧 `diagnoseCaptureFailure` + `archiveTimeoutDiagnosis` 归档三态，消费侧回读 `crash-diagnostics/*.json` 供 `crash_free`；生成器补一条：未采屏若判定为**进入即崩溃**，额外产一条 crash 缺陷（"没采到"与"崩了"是两条不同的修复指令）；无判定则**不补**，避免噪声。`crash_free` 从此进入 WIRED。
>    - 顺带抓到同类坑：`crashFree` 在 compute 侧只认 `boolean`，先前写的 0/1 会被静默忽略——"看着接了其实没接"。
> 4. **golden 替生产干活**：原用例手填 `geometric_iou=0.8 / 素材·元素·crash=1` 再直呼生成器，所以上一轮生产侧字段名读错时 golden 依旧全绿。现在物化最小宿主工程、跑 **`collectDeterministicVisualDefects` 本尊**，并补一条**反证**用例（把 `score_floor` 改名 → fidelity 缺陷必须消失），以及崩溃归档 → must_fix 的端到端。
> 5. **quarantine 扫描异常被吞**：`readdir`/`stat` 的 catch 一律静默 return，目录被锁/权限不足时调用方误判"已隔离干净"。改为非 ENOENT 错误进 `errors[]`（调用方已 fail-closed）。
> 6. **禁发条件误解除**（见下方待办）。
>
> **未做（按用户口径属第二类"对抗恶意 agent"，本轮明确不做，非遗漏）**
> - provenance 链**伪造**（链文件无认证，agent 可重写内容冒充干净）——删除已被 ①堵住，伪造需 HMAC 类锚，属第二类。
> - 素材 baseline **删除洗白**（文件不存在按空基线处理）——首轮无基线是合法态，害处需"先删基线"这一恶意前提。
> - quarantine 的 mtime delta 可被**复制旧截图/回拨时钟**绕过——同属恶意前提。
> - 素材 verdict 的 `resolved_path` 未与 ui-spec 对账——sha256 已与**当前文件内容**强绑定，路径声明失配的诚实危害很低。
>
> **未接线且如实标注（不属 bug，缺口在日志里可见）**
> - `geometric_iou` / `required_element_coverage` 依赖布局树几何 = **T8**，已随 c4e8b1d3 拆出。
> - `required_asset_present` / `blank_area_ratio` 不接本指标：素材完整性由 spec/coding/testing 三侧的 `asset_non_destructive` + `media_reference_integrity` 两道 **BLOCKER** 直接把关，重复接线只会双重报警。
> - 以上四项一律记 `not_evaluable` 并在 `[visual-metric]` 日志点名。

> **v16 → v17（review 第 2 轮实锤 7 项，全部为"机制绿但生产无效"同一病症）**
> 1. **墙钟依赖测试**：`visual-metric-compute.unit.test.ts` 用硬编码 faultlog 时间戳打默认 24h 窗，过日期即漂成 `element_absent`——实测在 07-25 23:28 已红。故 v16 报的"unit 2508 全绿"是**时钟相关的假绿**。改注入 `now`/`windowStartMs`，并补窗外历史崩溃不得命中一例。
> 2. **确定性缺陷生产消费者读错字段**：`collectDeterministicVisualDefects` 读 `reference_path` 等不存在的字段 → 全表走 missing 策略 → 每屏凭空多出"素材缺失/崩溃/元素缺失"三条**伪缺陷**，回退 coding 后又因同指纹熔断。改按真实 schema 读 `score_floor`→`fidelityScore`、`edge_tile_divergence`→`edgeDivergence`。
> 3. **缺屏未算**：P0 缺屏靠解析 `spec/ui-spec.yaml` 与实采屏 id 差集得出（含 `__overlay__N` 变体），此前完全没算。
> 4. **未接线指标伪装成失败**：`generateDeterministicDefects` 新增 `evaluatedMetricIds`，未接线项记 `not_evaluable`（说明写明"未接线"）而非触发 missing 策略；已接线却缺值仍照 missing 处置（不放水）。缺口在日志里可见。
> 5. **证据隔离搬 0 个文件且搬错目录**：原实现 rename 整个共享目录（会连**历史干净证据**一起搬），且 `moved` 恒 0 却仍宣称"已隔离"，集成测试只断言事件存在故照样 PASS。改按 `sinceMs`（invoke 起点）逐文件搬本轮产物，搬运有错 → `evidence_quarantine_failed` halt 求人；测试改断言 `moved_count>0` + 正式目录已清 + 隔离区含该截图 + 干净轮不得误伤。
> 6. **素材基线过早自刷新**：`checkAssetNonDestructive` 只要自己 PASS 就刷基线，同阶段 crop 验真还在 FAIL 时就把历史改写了（给验真失败的素材发通行证）。改为 crop 验真存在 `failed` 即跳过刷新并在报文留痕；写失败不再静默吞（改为在 details 里点名，人可见）。
> 7. **T3 两道检查漏注册 testing 侧** + **崩溃诊断模块零生产调用方**：前者补进 `dispatchDeviceVisualDiff` 与 `testing-rules.yaml`；后者把 `describeCaptureFailureDiagnosis` 接到 `visual-diff-capture` 主屏/overlay 两处到达失败分支（诊断不可用如实写"诊断不可用"，绝不写"未崩溃"），并补一条**接线回归**断言生产文件确实引用它 ≥2 处。
>
> 顺带修正：集成测试夹具此前不落 provenance 链，干净轮被 `evidence_provenance_broken` 正确拦下——说明夹具不真而非防线有错；已改为在 fake agent 内套上 runner 注入的 `extraEnv` 后调**生产 recorder**，干净轮现在真的穿过链校验。

## 根因编号表（证据锚点见 frontmatter overview）

| # | 根因 | 归属 | 本 plan 切片 |
|---|------|------|-------------|
| R1 | canary run 域悖论：preflight「新鲜不重探」vs 三轴「跨 run 不采信」两层规则打架，凭空致盲 | 链A | T1 |
| R1' | **（v6 新发现）canary 悖论的永久形态**：写了 run_id 后，goal·tool_read TTL=7d 内每个新 run 都 fresh→skip probe，而 canary.run_id 属上一个 run→不可采信→盲。**每 7 天只有第一个 run 有视觉** | 链A | T1（最高优先） |
| R2 | 需求裁剪授权被静默丢弃 + 盲档禁裁 | 链B | f6b2d9a4（已提交 5da4ce20）+T3 兜底 |
| R3 | 盲档破坏性执行：删已验证素材、悬空 $r 引用、占位替换真资产 | 链B | T3 |
| R4 | testing 越权改产品码：SKILL:114 仅文字禁令 + goal-runner:963 反向明令 "fix the code in THIS retry"（矛盾指令）；锚点改崩 AllBanksPage、发明搜索、污染 HomeTabPage | 链B/C | T4/T8 |
| R5 | testing FAIL 无回修环：仅同阶段 retry→halt；既有 backtrack 通道门槛过高从未触发 | 链C | T4 |
| R6 | headless 视觉裁决无消费方：pending/score_floor=0 不产 must_fix；主链串联致 P0 三屏永采不到；crash 无诊断采集 | 链C | T5 |
| R7 | upstream stale + review_closure_attestation 双锁死锁 | 链C | T4 |
| R8 | journal 时间戳不确定性 → visual_ledger_integrity 误杀（本次 halt 直接代码 bug） | 独立 | T2 |
| R9 | tamper 检查先于 legacy 迁移 + 裸 throw→uncaught；HMAC 缺失静默封顶 | 独立 | **拆出独立 change**（见 T6'） |
| R10 | 机制回归绿 ≠ 结果回归绿：548 文件改动无结果级门禁 | 系统性 | T7a/T7b/T8 |

---

# ⚠️ 以下全部内容为历史记录（v1-v20 实施轨迹）——不再构成实施要求

**唯一可执行方案 = 上方「v22 执行方案」。** 下述旧 T3/T4/T5/T7a 正文、冻结原则、发布约束（v13）、
执行顺序与 Todos 描述的机制大部分将被 v22 的 D1-D10 删除；保留在此仅供追溯"当时为什么这么做、
后来为什么推翻"。任何与 v22 冲突之处，以 v22 为准。

## 设计原则（历史冻结，v1-v20；v22 后仅 T1/T2 相关条款仍有效）

1. **auto-match-over-fail**：非关键冲突不 halt——自动匹配最合适方案+透明记录；halt 只留真冲突。
2. **诚实记账 ≠ 放行做差**（最高原则）：P0 结果债（参考图在手却零素材/P0 屏未采/score_floor 崩塌/crash 嫌疑）必须阻塞「完成宣称」，阻塞方式优先是**回修（backtrack）**，不是停等人工。
3. **破坏性动作升级授权**：删除/替换已验证产物需显式授权或更高 provenance+验真；无授权时保留现状+记债，绝不销毁。
4. **能力真值单一裁决**：「要不要重探」与「可不可采信」必须同一谓词裁决——任何 skip 决策以「消费端将采信」为前提。
5. **fail-closed 保留，但先保证被 fail 的是事实不是自身 bug**：信任链哲学不动，重放/比对输入先确定性化。
6. **testing 零产品源码写入**：testing 只复现、采证、产结构化缺陷；一切代码变更（含测试锚点）经 backtrack 由 coding 实施。授权语义不软化：agent 任何形态的自签不构成授权（对齐 mutation-authorization.ts:119-125）。**被污染的证据不入正式账本**（v3）。
7. goal 与普通模式能力持续拉齐（各门禁两模式同覆盖）。
8. **回修与严重度分离（v7 冻结谓词分工）**：f6 已把大量裁决面切到 `isHardPixelContract`，若 backtrack 也复用它，银行卡的 **best_effort 将只记 WARN 而不修**——本事故正是这一档。故冻结：
   - `isPixelExecutionTarget` / `needs_fix` 债 / P0 结果契约（P0 屏采集、必需素材、crash-free）→ 驱动 **must_fix → backtrack_to_coding，与 strictness 无关**；
   - `isHardPixelContract` → **只**控制质量缺口是否升 BLOCKER、是否 HALT/求人；
   - best_effort 同样自动回修；预算耗尽后可 PARTIAL+记债收尾，但**不得假称视觉闭环完成**。

## 切片（编号保持稳定；优先级 v13：T2/T1/T3/T4/T5/T7a=P0；T9/T8/T7b 已拆出至 c4e8b1d3）

### T2（P0，**第一个独立落地**）journal 时间戳确定性 —— 修 R8

> 确定性低风险直接 bugfix；与 T1 同触 harness-runner.ts，先行合入避免并行冲突。

**改动**：
1. `intermediate-rounds-journal.ts::appendJournalProposal`：删除 `new Date()` 兜底，评估时刻改**必填**——编译期逼所有调用方传值。
2. `harness-runner.ts::consumeVisualRoundPayload`：传 `now: () => row.at`（claimed row_hash 的评估时刻与 journal 落盘 at 同源）。
3. replay 失配报文升级：附字段级 diff（at/base/row/fused 各自「重放值≟claimed 值」），「评估器漂移」与「journal 被篡改」话术拆开；**halt 语义保留**。
4. 单测：新增「生产调用形状」回归（复刻 consumeVisualRoundPayload 调用方式走 append→replay 全链断言 ok）；现有 :68 显式同 at 用例保留。

**验收**：宿主复演同 manifest → 中间轮收编不再 visual_ledger_integrity 误杀。

### T1（P0，**与 T2 并列先行**）能力真值跨 run 收口 —— 修 R1/**R1'**

> **v6 基线重锚**：f6b2d9a4（5da4ce20）已完成原 T1-2（canary 写 run_id，goal-preflight.ts:396）与 T1-3 的 routing 侧（`resolvePolicyVisualForRouting` 传 runId，:467）。**但核心悖论未解，且形态升级为永久性**：`decideVisionCanaryProbe`（:279-311）仍只用 `isVisionCanaryFresh` 判 skip，goal·tool_read TTL=7d → 首探 run 之后 7 天内每个新 run 都 skip probe 且 run_id 不匹配 → **恒盲**；goal-runner:3211 的 skip 分支不做任何补写。写了 run_id 反使问题更隐蔽。

**改动**：
1. **（核心）** `effective-vision-context.ts` 导出共享谓词 `canaryAdmissibleForRun(canary, {runId})`（语义=三轴 resolver 会否给 run_probed/interactive 采信）；`decideVisionCanaryProbe` 判据升级为 **fresh ∧ admissible**：fresh 但不可采信（无 run_id / run 不匹配）→ `action='probe'` 当场重探，不再 skip。preflight 与 resolver 共用同一实现（契约测试钉死引用同源）。**效果=goal canary 的实际语义回归"每 run 一探"，TTL 仅对同 run 内与 interactive 生效**。
2. ~~canary 写盘补 run_id~~ —— **f6b2d9a4 已完成**，本 plan 不再重复；仅补回归断言（写入值 == 当前 manifest.run_id）。
3. **harness 侧 runId 贯通（v7 降级为 legacy/fallback 兼容项，非主链根因）**：harness-runner.ts:568-575 为 `hasVision: capSnap ? capSnap.vision.verdict : (mmProbe.supported && resolvePolicyVisualForHarness(...))`——**snapshot 在场时 live meet 不参与**（注释：消费面不得自行叠加 meet）。故缺口只在 **snapshot 缺失**（legacy feature / 交互式 / 未经 initializer 的 phase-driven）时生效。补 `resolvePolicyVisualForHarness`（:157）的 run 身份透传（goal 态取 `MAISON_GOAL_RUN_ID`，phase-driven 用显式 phase execution identity，与 f6b2d9a4 routing 侧同口径），并加断言：snapshot 在场时结论与 snapshot 一致、snapshot 缺失时 goal 与 phase-driven 结论一致（拉齐）。
4. 重探语义：成功→run_probed 采信；实测确盲→盲档（走 f6b2d9a4 素材轴 auto_crop 逐项 fallback）；不可执行→按现降级并记 downgrade_reason。run 内 memo 防重复探测（同 run 不重复付探测成本）。

**验收/单测**：
- **连续两 run 硬断言（v6/v7 关键，单 run 验收必假绿）**——六条缺一不可：
  (1) run#1 无可采信缓存 → probe 执行，写 `canary.run_id = run#1`；
  (2) 在 TTL（goal·tool_read=7d）内启动 run#2；
  (3) run#2 **不得**因 fresh 而 skip，须重新探测（`decideVisionCanaryProbe → action='probe'`）；
  (4) `capability-snapshot.execution_identity == run#2`；
  (5) `fidelity-intent.execution_identity == run#2`；**`run#2.decision_id != run#1.decision_id` 即使能力输入完全相同**（f6 公式含 execution_identity，同 run 复用/跨 run 复用是两回事）；另加**幂等断言**：同一 run、同一输入重复计算 → decision_id 不变；
  (6) run#2 仍为 **visual**，pixel_1to1 不被钳、prompt 无 "Vision: NO"。
- fixture「07-24 现场」（tool_read/goal/无 run_id/6 天龄+新 runId）→ decide=probe；
- 「TTL 过期」「重探确盲」「重探不可执行」三分支；
- **harness 侧**：snapshot 在场 → 结论 == snapshot（live meet 不叠加）；snapshot 缺失 → goal 与 phase-driven 结论一致（拉齐断言）；
- 契约测试：preflight 与 resolver 引用同一 admissible 谓词。

### T3（P0）盲档非破坏化 —— 修 R3（+R2 兜底）

> **v6 复用约束**：盲档判定入口一律消费 f6b2d9a4 的能力单源 `deriveEffectiveAdapterImageInput`（fidelity-shared.ts:885）与 `CapabilitySnapshot`，**不另起判据**；「参考图在手→needs_fix」的归类须与 check-spec 新 c2/c3 判据（5da4ce20 +284 行）对齐，不重复定义验真语义。

**改动**（profiles/hmos-app 为主）：
1. 素材物化前置盘点：materialize 占位前枚举既有素材 → 既有真素材**只读**；替换唯一通道 = 通过下述 `mayReplace` 证据判定，或 human receipt。无授权时：保留现状+占位仅补缺口+记债。
2. **替换判据 = 证据判定的非对称偏序（v9 纠正 v8 自伤逻辑）**：实现 `mayReplace(oldEvidence, newEvidence): boolean`，输入为**当前可信证据**而非 YAML 声明。

   > **v8 错误**：v8 写「跨类不可比 → 一律拒绝替换」。但已提交的占位 PNG/SVG 同样是 tracked+`$r` 引用，新裁的 verified 真 logo 与之正是跨类——照此**永久锁死错误占位**，框架从"破坏真素材"变成"保护错误占位"，UI 依旧修不好。方向必须非对称。

   - **旧素材证据分级前置**：`git tracked` 只证明**历史存在**，**不证明是真素材**。但 placeholder 身份的**认定来源受限**（v10 B3，防反向洞）：只能来自 **① 素材内嵌 marker、② runner-owned 物化账本、③ 确定性内容检测**（`asset-crop-validation` sanity：空白/纯色 jimp stats，:8/:59 既有能力）三者之一。
     - **`ui-spec placeholder_kind` 仅作线索，不能单独授权替换**——它是 agent 可写字段，若允许其降级，agent 只需误标/改标即可把 **verified 真素材**降为 placeholder 后覆盖（与本节要防的 P0-1 同构的反向洞）；
     - **verified provenance 优先级最高，不可被任何 ui-spec 声明降级**：已有 verified+绑定证据的素材，即便被标 `placeholder_kind`，仍按 verified 处理（冲突如实记债并提示人工核对）。
   - **允许替换（自愈方向）**：旧 = `absent` / 已识别 `placeholder` / `generated_unverified` → 新 = **verified crop 或 user-provided verified** → **PASS**（本案"占位换回真 logo"必须走通）。
   - **永远禁止（防退化）**：旧 = `verified` → 新 = `unverified`（任何形态）→ **拒绝**。
   - **需授权**：`verified → verified` 且来源不同 → 要求**同 asset role / source binding 一致**，否则需 human receipt。
   - 可信证据来源（本轮唯一采信集）：`asset-crop-validation` verified + hash/path 绑定 / **本 invocation** provider 执行事实 / human receipt。**`has_source` 不得单独充当 provenance**——agent 可写且**当前零校验**（asset-manifest-check.ts:156 只统计 `assets.length`），仅作交叉对账参考。
   - 持久化 provenance 字段（若将来引入）只作**派生投影**，不作信任源。**本轮不扩 schema**；显式枚举字段与迁移留待后续 change。
3. 新增**资源引用完整性检查**：全量扫描 `$r('app.media.X')` ↔ media 文件存在性，任何阶段产生悬空引用 → BLOCKER（档位无关；coding/testing 两侧都跑）。
4. 债务归类修正：**参考图在手**且素材缺失/占位 → `resolution_class=needs_fix`（进 T5 确定性 must_fix 集合）；真无来源才 `needs_human`。

**验收/单测**：已验真 PNG+盲档 run → 素材保留+占位只补缺口；「删 png 未清引用」→ BLOCKER；「参考图在手的占位债」→ needs_fix；**`mayReplace` 非对称偏序用例组**：
- **「tracked placeholder → verified crop」= PASS**（v9 关键：自愈方向必须走通，本案换回真 logo）；
- 「tracked 但 sanity 判空白/纯色」→ 归 placeholder，不享只读保护；
- 「old verified → new unverified」= 拒绝（任何形态）；
- 「verified → verified 来源不同」→ role/binding 一致才过，否则要 human receipt；
- **仅 `has_source: true` 声明而无任何验真证据 → 拒绝替换**（防 agent 自声明开门）；本 invocation provider 未执行/SKIP → 不授信；
- **（v11 反向洞反例）「verified 素材 + 被标 `placeholder_kind` → 仍按 verified 处理」**（不得被 ui-spec 声明降级后覆盖）；
- **（v11）「只有 `placeholder_kind`、无内嵌 marker / runner 账本 / sanity 证据 → 不得授权替换」**。

### T4（P0）testing 零写入 + 证据失效 + backtrack_to_coding —— 修 R4/R5/R7

**改动**：
1. **三处契约统一（矛盾指令根除）**：testing prompt/SKILL=只复现、采证、产 defect（含 verdict=fail+must_fix 填写义务），明令零产品源码写入；`VISUAL_GAP_RETRY_GUIDANCE`（goal-runner.ts:960-966）改 **phase-aware**（coding 视觉环保留本轮修码；testing 版=「set verdict=fail + must_fix + defect fingerprint → 请求 backtrack」，删除 "fix the code in THIS retry"）；coding prompt 增 defect-fingerprint 消费段；review/ut/testing 按既有 post-backtrack 事务失效+增量复审重跑（goal-runner.ts:2323）。
2. **源码完整性闸门前置（v4 重排，实施硬约束）**：现 runner 时序为「invocation 返回 → `produceCriticReceipt`（goal-runner.ts:~4541）→ `replayJournalIntoLedger`（:~4687）→ …（~5540）phase verdict/source drift」——签发与收编全部早于完整性判定，v3 的「污染证据隔离」若不改时序落地即失效。**新时序：invocation 返回 → 源码完整性判定（+反打）→ 仅当判定干净才允许签发 critic receipt、收编 journal、spawn gate harness**；判定为污染时这三步一律不执行（而非执行后再撤）。
3. **三层防污染（v4，覆盖 mid-invocation self-revert 盲区）**：仅靠结束时 diff 有盲区——agent 改码 → 构建/截图 → 自行还原 → end diff=0，产物仍出自污染源码。
   - (a) **预防（最强项）**：testing 运行在产品源码**只读边界**内，仅 `reports/`、构建输出目录可写；
   - (b) **精确源码快照（v5 新原语，不用轻量 digest）**：新增 `computeProductSourceSnapshotSha256(projectRoot, layerDirs)`——**完整 64 hex SHA-256**；作用域内 **tracked + untracked + 删除项 + 文件类型（regular/symlink/gitlink）+ 相对路径**稳定排序；**按文件原始字节**计算（二进制安全，PNG 内容变更必可见）；**纳入构建配置**（oh-package/build-profile 等），**排除 `reports/`、构建输出**；任一文件不可读或枚举失败 → `unverifiable`（fail-closed）。**不替换** `computeProductWorktreeDigest`（worktree-digest.ts:64，16 hex/12 hex/文本 diff 口径）——后者继续用于普通 stale 检测，二者职责分离、不得互相冒充。
   - (c) **完整 provenance 链绑定（v5）**：`source_snapshot_sha256 → HAP sha256 → install session / device package sha256 → screenshot batch → visual journal / test receipt`。截图真正对应的是**设备上安装的 HAP**，不是截图时刻的工作区源码：每批截图与每行 journal 绑定 **HAP/build identity**，构建 receipt 再绑定**完整源码快照**。链上任一环断裂或与基线不符 → 判污染。这才能抓住「改源码 → 构建污染 HAP → 恢复源码 → 再截图」（此时工作区已还原，仅 HAP 身份能揭穿）。
   - (d) **结束时复核**：invocation 返回后立即重算快照，在任何 receipt/journal 操作之前。
4. **整轮证据失效（v4 收紧，推翻 v3 的部分保留）**：上述任一层检出写入 → 该 invocation 标记 `invalidated_by_source_mutation`，**整轮证据全部隔离到 audit 区**（截图/visual-diff/test receipt/中间轮 journal 行；quarantine 路径+events 记录，正式账本零写入），**不再尝试保留「改码前证据」**——无可信文件监控事件即无法证明某证据确实产生于改码前。仅保留 mutation audit（改了哪些文件+反打结果）。受污染 invocation 的 PASS/FAIL 不参与阶段裁决；反打后一律**先重跑一次只读 testing** 取干净证据（占该阶段 retry 预算），拿到确定性 defect 再 backtrack_to_coding。
5. **工作区恢复（职责收窄）**：end-state hunk 级反打（保留用户既有 dirty 改动，不整文件 checkout），覆盖**新增/删除/重命名/二进制/冲突**五形态，**冲突 fail-closed** → halt `testing_mutation_revert_conflict`（列冲突文件+处置指引）。**反打只负责恢复工作区，不承担证明证据纯净的职责**（纯净性由 2-4 的 digest 链承担）。不新增任何 runner policy、不生成任何 pre_authorized_mutations。
6. **锚点需求上游化**：acceptance.yaml（spec 阶段）声明各屏 required by_id 锚点 → check-coding 新增锚点覆盖校验（缺→coding 阶段即 FAIL）→ testing 只消费；锚点缺失=确定性缺陷 → backtrack，绝不就地改。
7. **backtrack_to_coding 转移**（扩展既有 backtrackToIdx/authorized_backtrack 语义）：触发源=P0 级确定性缺陷指纹（crash 嫌疑/needs_fix 素材债/score_floor 崩塌/锚点缺失）且 testing 无法零写入解决；**触发判据与 strictness 解耦**（设计原则 8）——`isHardPixelContract` 只决定该缺口是否升 BLOCKER/HALT，**不决定是否回修**；best_effort 同样触发 backtrack，预算耗尽转 PARTIAL+债务且不得宣称闭环完成；`reconcileMutablePhaseSourceDrift` 调用门放宽为 ut/testing 每次 verdict 后都跑分类。预算 `max_backtracks`（默认 2）+轮次指纹熔断防 ping-pong。
8. **acceptance 受控修订（v3 定稿：本 run 永不采纳）**：testing 期变更只落 `testing/reports/acceptance-amendment-proposal.yaml`；**当前 run 内 proposal 永不参与任何验收裁决、永不自动采纳**；确需变更 acceptance → 结束当前 run，人工确认后以**新 run 从 spec 起点**进入（采纳即正常失效下游全链）。backtrack_to_coding 不承载需求变更；不新增 backtrack_to_spec。amendment 命中需求 SSOT 否定词（「搜索…本次先不实现」）→ 拒绝+缺陷记录（复用 f6b2d9a4 否定优先规则）。

**验收/单测**：
- 复刻本次死锁 fixture（testing 改 16 文件+acceptance 重编号）→ hunk 反打后工作区=基线、用户 dirty 无损、invocation 标记 invalidated_by_source_mutation、**整轮证据在 audit 区且正式账本零写入**、产出缺陷清单+只读重跑→backtrack 转移，无 upstream stale 死锁；
- **时序断言（v4 关键）**：污染 invocation 下 `produceCriticReceipt` 与 `replayJournalIntoLedger` **一次都不被调用**（spy 断言），gate harness 不 spawn；
- **self-revert 盲区 fixture（v4/v5 关键，两形态）**：(i) 改码→构建→截图→自还原→end diff=0 → 因构建时点快照 ≠ 基线被判污染；(ii) 改码→构建污染 HAP→**还原源码后再截图** → 快照已还原但 **HAP identity ≠ 干净源码构建**，仍被 provenance 链判污染；
- **快照精度 fixture（v5 关键）**：同路径替换不同 PNG（等大小/仅内容不同）→ `computeProductSourceSnapshotSha256` 必须变化（对照断言：轻量 `computeProductWorktreeDigest` 在该场景可能不变——证明二者不可互相冒充）；
- 快照不可核实（`unverifiable`）或 provenance 链缺环 → fail-closed 按污染处置；
- 反打五形态矩阵（含二进制与冲突→halt）；「需求外提案（搜索）」→ 拒绝且本 run 不生效；backtrack 熔断（同指纹二连）→ halt 求人；锚点缺失 → coding FAIL。

### T5（P0）headless 视觉确定性回修信号 + 屏级独立引导 —— 修 R6

**改动**：
1. **视觉指标机器契约（v4 P1，先于生成器落地）**：现有 `FINALIZED_MIN_FIDELITY=0.45`/`PASS_MIN_IOU` 只覆盖 fidelity/IoU，**不能充当 edge divergence、空白率等指标的阈值**。冻结一张 `visual-metric-contract.yaml`（framework 侧 SSOT，T5/T7b 共用），每指标定义：**名称 / 方向（越大越好 or 越小越好）/ 阈值（全局或逐屏）/ 参考图·实拍图归一化方式（分辨率·DPR·状态栏裁切口径）/ 指标缺失时处置（FAIL / BLOCKER / 不可评估）/ baseline+tolerance（以 07-18「最佳版本」实拍校准）/ 契约版本号**。既有 fidelity/IoU 常量并入该表（值不变），新指标（edge·layout divergence、空白面积占比、必需素材存在性、required visual element 覆盖）新增条目。**receipt 必须绑定 `metric_contract_hash`**——防实现者自选宽松阈值把结果门禁做成形式门禁。契约变更走正常 change + 需人工确认 baseline 重校准。
2. **确定性 must_fix 生成器**（零 VL、零人依赖）：按上表接入采集侧真算值（visual-diff-check.ts:53-57 注释预留的「真算几何值接入」即此）；信号集合=本次实证清单：score_floor<地板 / 必需图片素材缺失（T3 needs_fix 债）/ required visual element 缺失（ui-spec 结构）/ edge·layout divergence / 空白面积占比 / crash log 在场。命中→defect fingerprint 写视觉轮账本，作 T4 backtrack 输入。**生成与 strictness 无关**（设计原则 8）：best_effort 下同样生成 must_fix 并驱动回修，`isHardPixelContract` 只决定这些缺口是否升 BLOCKER/求人。VL 语义判卷保留人审后置，不与此混淆。
3. **P0 采集完整性 = 视觉闭环完成前置**：P0 屏缺一不得宣称视觉闭环完成——处置是 needs_fix 回修，不是 skip 也不是停等。
4. **屏级独立 bootstrap（去串联）**：acceptance 为每个 P0 屏声明独立进入方式（dev-only route/预置 RDB state fixture，由 coding 按声明实现产品侧 seam，非 testing 私改）；hylyre 计划派生支持 per-TC bootstrap——TC-003 失败不再级联锁死后半程采集与判定。
5. **设备侧 crash 诊断采集**：元素等待超时 → 自动拉 hilog/faultlogger 归档+「进入即崩溃嫌疑」缺陷分类。
6. `capRunStatusForVisionTrust` 保留，但**只封完成宣称，不拦截 backtrack 回修迭代**（兼容断言）。

**验收/单测**：契约表 schema 校验+缺指标处置三态用例+`metric_contract_hash` 绑定断言；score_floor 0.000+pending → must_fix 指纹+backtrack 请求；P0 缺屏 → needs_fix；超时 → faultlog 采集调用断言；bootstrap fixture=TC-003 失败时其余 P0 屏仍完成采集。

### T7a（P0）decision-chain golden —— 修 R10（快检层）

**改动**：冻结 `harness/tests/golden/bc-opencard/` fixture（断言输入直接消费 f6b2d9a4 新增的 `goal-report.json::fidelity_routing` 三轴投影，goal-report-generator +41）：需求原文+10 屏参考图**哈希登记+脱敏低清副本**+期望决策链断言。**两份 fixture 分立（v7 P0 修正）**：

- **(a) 真实银行卡 golden（权威）**：intent 三轴 = **`pixel_1to1 + best_effort + auto_crop`**——与 f6 冻结口径逐字一致（f6 plan:146-148；openspec goal-runner spec.md:13）。**严禁**为让 golden 通过而把「尽量一致」重识别为 hard（那等于回退 f6 核心设计）。其余断言：capability=tool_read 时 effective 不钳（**含连续两 run：第二 run 仍不钳**）；**素材断言改机器可执行（v9：`blind_placeholder` 在全部 TS 代码零命中，非 canonical 字段）**——`asset_acquisition_mode=auto_crop` ∧ 有视觉时关键资产 `placeholder !== true` ∧ `resolved_path` 存在 ∧ verified+hash·path binding 有效；ui-spec 含 10 屏、不含任何主页银行卡屏；P0 屏清单完整；acceptance 含 required anchors 与屏级 bootstrap 声明；**best_effort 下质量缺口记债不 HALT，但仍产 must_fix 驱动回修**（与 T4/T5 谓词分工对齐）。
- **(b) 合成 hard fixture（专测 hard contract）**：需求措辞「必须像素级还原，不接受降级」→ 三轴 = `pixel_1to1 + hard + auto_crop`，盲档下唯一阻塞形态 `DEFERRED_CAPABILITY_MISSING`；覆盖 severity 抬升/人确认/封顶类判定，**不与 (a) 混用**。

决策链回放形式（无需真机），**注册进 CORE_SUITES**。发布件不含（release-excludes.json:11）。

**验收**：对 fffdff48 行为跑 → 必须 FAIL（逐断言点复现本事故）；**对 5da4ce20 行为跑 (a) 的三轴断言 → 必须 PASS**（守住既有正确路由，防本 plan 与 f6 冲突）；本 plan 完成态 → 全 PASS。

### T9 / T8 / T7b（**已拆出为独立 change**）scope 契约 SSOT / 屏级 scope 门 / consumer-outcome golden

**2026-07-25 用户拍板拆分**：连续三轮 review 的新发现全部集中在这一族（scope contract 信任来源 / UI owner inventory 全集枚举 / trusted-base lineage / 结果级 receipt 签发），T9 已从「一个字段」长成独立子系统且挡在 T8/T7b 前面；而本 plan 的 P0 核心（T1/T2/T4/T5/T7a）自 v9 起已收敛。为使 P0 修复不被 P1 设计迭代拖住，三切片迁出至：

> **[结果级范围门禁_scope契约SSOT与消费者结果golden_c4e8b1d3.plan.md](结果级范围门禁_scope契约SSOT与消费者结果golden_c4e8b1d3.plan.md)**（v8~v12 十轮 review 冻结的设计决议逐字迁移，未重新论证）

**拆分后本 plan 的覆盖缺口（诚实记录）**：
- **R4 余波（首页误开发复发防护）不再由本 plan 覆盖**——T8 是唯一能直接阻止该类复发的门禁，现随新 change 推进；在其落地前，宿主侧靠配套指引第 3 条人工移除+review 必审兜底；
- **R10 结果层（consumer-outcome 机器门禁）不再由本 plan 覆盖**——本 plan 只保留 T7a 决策链快检；结果级回归在新 change 落地前，UI 变更发版继续依赖宿主人工复演记录。

**反向依赖**：新 change 消费本 plan 的 T4（`computeProductSourceSnapshotSha256` + provenance 链）与 T5（`metric_contract_hash`），故其实施排在本 plan T4/T5 之后。

### T6'（拆出，不在本 plan 实施）信任链稳健化 —— 修 R9

独立 change：legacy 迁移先于 head 比对、tamper/absent 裸 throw→优雅 halt、HMAC 未配置引导。本 plan 仅保留衔接：(a) 宿主复演前若遇 legacy 账本 tamper 误判，按 detach.log 指引人工核查清理；(b) 独立 change 立项时引用本事故 run1/run4 事实。

## 发布约束（v13——历史，已被 v22 版替代，见状态段）

~~**T1~T5、T7a 全部完成（unit+fixture 全绿）前，禁止发布新版本到宿主**~~（T9/T8/T7b 已拆出，其发布约束随新 change c4e8b1d3 独立生效并与本约束叠加）；T7b receipt 机制落地前，UI 相关变更的发版须附一次宿主人工复演记录作为过渡等价物（按「干净全链」口径，**含连跑两 run**，不要求 backtrack 发生）。

## 宿主侧配套（NL 指引；1-4 可在源仓动工前先行）

1. 「恢复 07-18 已验证素材并修复引用：从提交 aeb4730 恢复 `02-Feature/FinancialCard/src/main/resources/base/media/` 下 cmb_bank_logo.png、bank_card_face_cmb.png、bank_card_row_thumb.png、add_card_result_illustration.png 四个文件；确认 7 处 `$r('app.media.*')` 引用全部可解析。回报：编译 PASS+四文件存在+引用零悬空。」
2. 「修复 AllBanksPage 崩溃嫌疑：`.title()` 当前传非 @Builder 箭头函数 builder，改回字符串 title 或 @Builder 方法；真机验证点击『查看全部银行』可进入。回报：进入成功截图+无 crash。」
3. 「移除需求外实现：HomeTabPage 的 BankCardPackSection/bindSheet 整段移除；搜索实现与 TC-011 按需求『本次先不实现』移除。回报：主页恢复原布局截图+test-plan 更新。」
4. 「配置 MAISON_HMAC_GOAL_CHECKPOINT（32 字节随机 hex）。回报：下次 goal run 的 events.jsonl 不再出现 vision_checkpoint_unauthenticated。」
5. 「框架升级到本 plan 完成版后，执行 T7b 两用例，**干净用例连跑两个 goal run（第二个在 7 天 TTL 内启动）；故障用例不强制两 run**：干净全链（回报：两个 run 的 outcome receipt 均 PASS、第二 run 的 canary 重探记录、两 run 的 effective 均为 pixel_1to1、三轴均为 pixel_1to1+best_effort+auto_crop、对比截图归档）；受控 fault-injection（回报：注入快照的 FAIL receipt → backtrack 触发证据 → 修复/还原后**新快照绑定的 PASS receipt**）。合并 fidelity-intent-auto-routing tasks#11 复验——**该项也须按两 run 口径，单跑一次会假绿**。」

## 执行顺序（历史，v1-v20；v22 执行顺序见状态段）

~~f6b2d9a4 review+提交~~（**前置已完成**：2026-07-25 09:38 提交 5da4ce20，含 post-impl5；v6 已按其现状重锚 T1/T3/T7a/T7b）→ **T2 与 T1 并列先行**（T2 触 intermediate-rounds-journal+harness-runner:consumeVisualRoundPayload，T1 触 harness-runner:resolvePolicyVisualForHarness——同文件不同函数，先落 T2 再落 T1 避免冲突）→ T3 → T4+T5（回修环整体；T4 内 `computeProductSourceSnapshotSha256` 新原语先于闸门接线，T5 契约表先于生成器）→ T7a。**T9/T8/T7b 已拆出至 c4e8b1d3**（其排期在本 plan T4/T5 之后）。T6' 独立 change 另行立项。宿主配套 1-4 随时可先行。除既有无关 plan 修改外相关工作区干净；本 plan 文件为仓内唯一未跟踪文件，动工时纳管。

## 风险与开放问题

- Q1 重探成本：每 run 一次轻量金丝雀 VL 调用（run 内 memo 去重）；可接受性待宿主实测回报。
- Q2 backtrack ping-pong：max_backtracks 默认 2+指纹熔断是否足够；极端场景需观察。
- Q3 HMAC 是否 auto-provision：随 T6' 独立 change 讨论。
- Q5 amendment 通道与既有 phase-evidence-manifest schema 的兼容迁移。
- Q6 golden fixture 维护流程：需求变更时由谁、以何 receipt 更新期望断言。
- Q7 T7b「UI 相关路径」集合圈定粒度：v1 先显式列举+发版 checklist 人工兜底，实测后校准。
- Q8 屏级 bootstrap 的 dev-only seam 形态（编译开关裁剪 or 运行时 flag）：实施前与宿主约定。
- Q9（新）fault-injection fixture 形态：临时工作副本内注入-验证-还原的隔离与自动清理，不得污染宿主真实工作区。
- （v1 Q4 白名单严格度——已随 T4 取消白名单作废。）

## Todos（v22 删减式重构——唯一执行清单）

**保留项（已完成，v22 不动）**
- [x] T1 能力真值跨 run 收口（canaryAdmissibleForRun 共享谓词 + run_id 透传，已提交实现见历史 Todos）
- [x] T2 journal 确定性（at 必填 + 生产调用传评估时刻，已提交实现见历史 Todos）
- [x] bc-openCard 事故产物 artifacts（golden 断言随 D10 收缩，artifacts 本体保留）

**v22 待办**
- [x] F2 fs 递归哈希快照原语——**已实施**（含 spec/ 子目录候选补丁：resolveFeatureArtifact 扁平 canonical 对宿主真实形态失明，单测抓到）
- [x] D1-D10 删除批——**已实施**（8 模块 + 6 单测删除；registry/phase-rules 三侧收敛；悬空 $r 迁 visual-parity-backstop）
- [x] F1 统一回修环——**已实施**（谓词 5 条·identity 判新鲜 / ActionableDefect / 只在 testing·授权回退不收窄 / **PASS 前评估** / outcomes filter / 整轮集合指纹·事件存 round_fingerprint·恢复直读 / 预算 2 / 交接四步·E2E-3 断言 prompt 文本）
- [x] F2 接线：testing_write_violation = run 终止态，同 run --resume 拒绝——**已实施**（R-7 验收覆盖）
- [x] F3 faultlog 集合差崩溃诊断——**已实施**（+capture 开始清理本 run 旧归档，防修好后旧归档再消费）
- [x] F4 素材硬门禁收窄——**已实施**（materialized=无条件 BLOCKER/FAIL；render=一律 WARN）
- [x] F5 指令面统一——**已实施**（四处对齐 + testing-write-boundary 收敛为静态文案模块）
- [x] V1 验收：8 项全绿；全量 typecheck 0 / unit 2456 / fixtures 44 全绿
- [x] V2 c4e8b1d3 依赖失效注记已在位（其依赖段重写在该 plan 动工前进行，非本 plan 范围）
- [ ] 宿主配套 1-4 下发 + 回报核收（v23 现行版，从历史区提炼；原文见历史"宿主侧配套"节）：
  1. 恢复 07-18 已验证素材：从提交 aeb4730 恢复 `02-Feature/FinancialCard/.../media/` 下 cmb_bank_logo.png、bank_card_face_cmb.png、bank_card_row_thumb.png、add_card_result_illustration.png 四文件；确认 7 处 `$r('app.media.*')` 全部可解析。回报：编译 PASS + 四文件存在 + 引用零悬空。
  2. 修 AllBanksPage 崩溃嫌疑：`.title()` 传非 @Builder 箭头函数，改回字符串 title 或 @Builder 方法；真机验证点击「查看全部银行」可进入。回报：进入成功截图 + 无 crash。
  3. 移除需求外实现：HomeTabPage 的 BankCardPackSection/bindSheet 整段移除；搜索实现与 TC-011 按需求「本次先不实现」移除。回报：主页恢复原布局截图 + test-plan 更新。
  4. 配置 MAISON_HMAC_GOAL_CHECKPOINT（32 字节随机 hex）。回报：下次 goal run 的 events.jsonl 不再出现 vision_checkpoint_unauthenticated。
- [ ] 宿主真实闭环复演（两 run 口径 + fault-injection 一次真实回修）

---

## 历史 Todos（v1-v20 实施轨迹——其中 T3/T4/T5/T7a 产物将被 v22 删除，不再构成要求）

- [x] T2 journal 确定性（at 必填+生产调用传评估时刻+失配字段级 diff+生产形状单测）——**已实施 2026-07-25**：`intermediate-rounds-journal.ts::appendJournalProposal` 删 `new Date()` 兜底改 `at` 必填（空串运行时抛错）；`harness-runner.ts::consumeVisualRoundPayload` 传 `at: row.at`；replay 失配报文按字段级 diff + 归因分流（「仅 row_hash 不符」判时间戳未同源，不再一律甩篡改，halt 语义不变）；新增 3 例（生产形态多轮收编通过 / 事故形态可检出且归因正确 / at 必填兜底）
- [x] T1 能力真值跨 run 收口——**已实施 2026-07-25**：`effective-vision-context.ts` 导出共享谓词 `canaryAdmissibleForRun`，resolver 与 `goal-preflight.ts::decideVisionCanaryProbe` 共用（后者判据升级为 fresh ∧ admissible，新增 `probe/fresh_but_not_admissible_for_run`）；`harness-runner.ts::resolvePolicyVisualForHarness` 补 `MAISON_GOAL_RUN_ID` 透传（fallback 路径）；canary 写盘 run_id 补回归断言。新增 7 例（事故现场复现 / 永久陷阱两 run / interactive 不绑 run / 两侧谓词契约同源 / 两 run decision_id 不复用 + 幂等 / 能力真值直达档位）；既有 2 例按新语义更正（原用例编码的是致盲行为）
  - **偏离记录（1 处）**：plan 原写「snapshot 缺失时 goal 与 phase-driven 结论一致（拉齐断言）」——实现时发现该断言在语义上不成立：goal canary 携带的是 goal run_id，纯 phase-driven 调用不存在该运行身份，永远无法匹配（`run_probed 不跨 run` 是 f6 冻结语义）。故改为两条可成立的断言：**snapshot 在场时结论 == snapshot**（live meet 不叠加）、**goal gate harness 经 env 透传后可采信本 run 的 canary**；phase-driven 无 goal 身份时保持保守降级，已在代码注释中标注为**设计内分歧**而非缺陷。若要真正拉齐，须让 phase-driven 也走 f6 的 initializer 产出 capability-snapshot（该路径已存在，属 f6 范围）
- [x] T3 盲档非破坏化——**已实施 + review 修正（2026-07-25）**：`asset-nondestructive.ts`（证据五级 / `mayReplace` 非对称偏序 / 非破坏门禁 / 悬空 `$r` 门禁 / 基线读写）。
  - **review 修正三处**：① 绑定判定由 fail-open 改 **fail-closed**（原 `!v.sha256 || !sha ||` 会把「裁决没写 sha」「文件读不出」都当绑定成功；现要求 sha256 **与** resolved_path 都在场且与当前事实一致）；② 异源 verified 替换补 **source binding** 判据（role 相同不够——同为 brand_logo 也可能换成别家 logo）；③ 门禁**跨阶段注册**到 coding（原来只在 spec，而删素材的现场正是 coding，真实事故路径根本不会跑到它）+ 基线由门禁**在 PASS 时自动刷新**（原来零生产调用，跨阶段跨 run 比对从未发生）+ 损坏基线不再按空基线放行（改 BLOCKER）。
  - 19 例（含 fail-closed 两例、异源 binding 两例）
  - **偏离记录（1 处）**：plan 写「provenance 全序…本轮不扩 schema」，实现时**未新增任何 ui-spec/manifest 字段**——证据等级完全由盘上事实 + runner 账本派生，持久化只落 runner-owned 的 `spec/reports/asset-evidence-baseline.json`（非 agent 可写面），比 plan 更保守，与「持久化 provenance 只作派生投影」一致
- [x] T4 testing 零写入 + 回修环——**已实施 + review 修正（2026-07-25）**
  - 已有：完整性闸门前置 / 精确源码快照 / hunk 反打（五形态+用户 dirty 无损+冲突 fail-closed）/ 三处契约统一 / 锚点上游化 / amendment proposal 通道 / backtrack_to_coding
  - **review 修正六处**：① **污染轮不再 spawn gate harness**（原来只挡 receipt/journal，gate 照跑，污染截图仍进正式目录被消费）+ 证据整体 **quarantine** 到 run 目录 + **强制只读重跑**（超预算 → `testing_source_mutation_repeated` halt）；② backtrack 分支补 **`commitInvalidationTx`**（原来只 begin 不 commit，残留 pending 事务、第二次回退必失败）；③ 补**同 defect fingerprint 连续出现即熔断**（`backtrack_fingerprint_repeat`）；④ 回退判据不再只看 `summary.blockers[]`（那只收 FAIL+BLOCKER，best_effort 的 must_fix 进不去、且 `device_test_run` 白名单会把环境类失败也误判回退）——改为**消费 T5 真算缺陷 SSOT** 并排除 `toolchain/capture/externalBlocked`；⑤ 写入边界 guidance 覆盖**首次** testing invocation（原来只在 visual_gap 重试块注入）；⑥ 基线备份失败**不再继续 invoke**（改 halt——备份不成功还跑，等于拿工作区赌运气）
  - **provenance 链全接线（2026-07-25 补完）**：runner 侧 init + gate 前 verify；**采集侧三点已接**——新增 `profiles/hmos-app/harness/provenance-recorder.ts` 统一入口，接到 `device-test-build`（构建**当刻**重算源码快照并绑 HAP）、`device-test-install`（含复用路径）、`visual-diff-capture`（逐张截图哈希 + 绑装机会话）；session id 由 `installSessionIdOf()` 单点供给，装机与采集同源；非 goal 态静默 no-op；hapPath 不可读则不登记（宁缺勿伪，由 verify 的空链分支兜住）。7 例回归，含**核心那条**：改码→构建→截图→自行还原，端点快照已等于基线（端点比对的盲区），链仍判断链
  - 34 例
  - ✅ **完整性闸门前置**：invoke 返回后、`produceCriticReceipt`/`replayJournalIntoLedger` **之前**判定；污染时二者一律不执行
  - ✅ **精确源码快照** `product-source-snapshot.ts`（64 hex/按字节/二进制安全/含 deleted 与文件类型/纳入构建配置/排除 reports·build/不可读即 unverifiable）；不替换轻量 digest
  - ✅ **整轮证据失效**：`testing_source_mutation_detected` + `invocation_evidence_invalidated` 事件，receipt 不签、journal 不收编
  - ✅ **hunk 级反打** `invocation-revert.ts`：五形态（新增/修改/删除/重命名/二进制）+ **用户既有 dirty 无损**（不用整文件 checkout）+ 反打后自检 + **冲突 fail-closed halt** `testing_mutation_revert_conflict`；invoke 前把基线内容备份到 run 目录
  - ✅ **逐产物 provenance 链** `evidence-provenance-chain.ts`：`source_snapshot → HAP → install session → screenshot batch`，构建时点绑定源码快照——**抓 self-revert**（改码→构建→截图→自还原，端点 diff=0 也断链）；缺环判断链
  - ✅ **只读边界（预防层）** `testing-write-boundary.ts`：`classifyWritePath` 六分区纯函数 + `renderWriteBoundaryGuidance` 注入 testing prompt（与检测层同一判据，杜绝「提示说能写、门禁说不能」）
  - ✅ **三处契约统一**：`VISUAL_GAP_RETRY_GUIDANCE_TESTING`（删「fix the code in THIS retry」、明令零源码写入、指出 backtrack 出路与锚点属缺陷），消费点按 phase 分流
  - ✅ **锚点需求上游化** `acceptance-anchors.ts`：acceptance `required_anchors` 声明 → coding 阶段 `acceptance_anchor_coverage` BLOCKER 校验（`.id()` 扫描），legacy 无该节 SKIP；已进 coding-rules.yaml
  - ✅ **acceptance amendment 通道** `acceptance-amendment.ts`：proposal 落 `testing/reports/`（**不碰 acceptance.yaml** → 四上游不 stale）、`adopted_in_this_run` 恒 false、`proposalParticipatesInVerdict()` 恒 false 堵死后门、**否定优先**拦截（「搜索…本次先不实现」类提案直接拒绝并留证）
  - ✅ **backtrack_to_coding**：`classifyPhaseVerdict` 新增该 action（判据 = 确定性 P0 缺陷 ∧ 可变阶段 ∧ 预算未尽，**与 strictness 解耦**）+ runner 消费**复用既有 authorized_backtrack 失效事务**与同一预算计数器
  - 新增 32 例（快照 10 / 反打 4 / provenance+amendment 7 / 转移 4 / guidance 1 / 锚点覆盖随 coding 门禁生效 + 其余）
- [x] T5 视觉确定性回修信号——**已实施 + review 修正（2026-07-25）**：指标机器契约（7 项 + 契约哈希）/ 确定性 must_fix 生成器 / 真算接线（复用 `computeEdgeDensityTileDivergence` + `computeImageStats`）/ 崩溃诊断三态
  - **review 修正两处**：① **生产接线**——`collectDeterministicVisualDefects()` 在 goal-runner 里读 `visual-diff.json` 屏清单 → 真算观测 → 生成 must_fix → 驱动 backtrack（此前三个模块零生产调用，真实链路既不算指标也不产缺陷）；② 崩溃诊断补**时间窗过滤**（`deps.now` 原来完全未使用，任何历史 faultlog 都会让该应用永久判 crash_suspected）
  - 21 例
  - **YAML SSOT 外置（2026-07-25 补完）**：`profiles/hmos-app/harness/visual-metric-contract.yaml` 为阈值/口径的唯一权威来源，`loadVisualMetricContract()` 加载并逐条校验（方向/阈值/归一化/缺失三态），文件缺失或含非法条目 → 回落内置常量**但带 fallbackReason 且 runner 打 WARN**（阈值来源不明本身要被看见，不得静默）；goal-runner 的确定性缺陷生成已改为消费该 SSOT。新增 3 例（YAML 与内置口径逐项一致、fail-soft 不静默两分支、改宽阈值即变 hash）
  - ⚠️ **剩余两项须宿主侧完成，非代码**：① 4 个指标的 `baseline` 仍为 null——须用 07-18 最佳版本**实拍图**跑一遍回填（本地无真机做不了，且刻意不填数字充数）；② `metric_contract_hash` 绑进 outcome receipt——receipt 签发本身属 c4e8b1d3 范围，函数已就绪待其消费
  - ✅ **视觉指标机器契约** `visual-metric-contract.ts`：7 项指标各带方向/阈值(含逐屏覆盖)/归一化口径/缺失三态/baseline+tolerance/版本号；fidelity=0.45、iou=0.4 沿用既有常量数值；`visualMetricContractHash()` 供 receipt 绑定（放宽阈值即变哈希）
  - ✅ **确定性 must_fix 生成器**：零 VL 零人依赖；P0 缺采 / 未达阈值 / 缺失且 missing=fail·blocker → must_fix，not_evaluable 如实记；指纹稳定；**入参不含 strictness 维度**
  - ✅ **真算指标接线** `visual-metric-compute.ts`：复用既有 `computeEdgeDensityTileDivergence`（edge_divergence）与 `computeImageStats.contentRatio`（blank_area_ratio）；**算不出的项不写入 metrics**（不用默认值冒充，交契约 missing 策略）——不吃 VL 自报值
  - ✅ **崩溃诊断采集** `device-crash-diagnostics.ts`：元素超时 → 拉 faultlog 判 `crash_suspected`/`element_absent`/`diagnosis_unavailable` 三态；**诊断跑不通 → crashFree=undefined**（契约按 blocker 处置，「采不到崩溃日志」绝不等于「没崩」）；诊断归档到 reports/crash-diagnostics
  - 新增 21 例（契约 13 + 真算接线与崩溃诊断 8）
  - ⚠️ **说明**：屏级独立 bootstrap 属 acceptance schema + hylyre 派生的产品侧改造，与 `required_anchors`（T4 已落）同源；本轮以 `required_anchors` 通道覆盖锚点问题，per-TC bootstrap 待宿主实测后按需扩展
- [x] （T9/T8/T7b 已拆出 → c4e8b1d3）
- [~] T7a decision-chain golden——**部分完成**（真产物回放 + 生产 consumer 已落；fixture 未达 plan 全量，见状态段 v19）
  - 早期版本被 review 正确批评为「写死常量的单测，不是 fixture replay」。现已冻结 `harness/tests/golden/bc-opencard/`：`artifacts/` 下**从宿主原样拷来的事故产物**（goal-runs manifest / ui-spec / asset-manifest / visual-parity / visual-diff / visual-debt，41K），`reference-images.registry.json` 登记 10 张参考图的 sha256+尺寸
  - **参考图不入仓**（比 plan 的「脱敏低清副本」更保守）：`0-原始需求` 截图含真实 PII（姓名/身份证号/人像），框架仓要打包发给宿主，PII 进去就随发布包扩散；决策链回放不需要像素。已扫描拷入产物确认无 PII
  - 10 例分两类：**(A) 决策链正向**——需求原文从事故 manifest **读取**（非常量）→ 三轴 `pixel_1to1+best_effort+auto_crop`、tool_read 不钳、连续两 run 不钳且 decision_id 不复用、真 ui-spec 十屏且无主页屏、指标契约完备；**(B) 事故产物反向**——把真产物喂进新门禁必须判缺陷：blind_placeholder 与 auto_crop 授权冲突、被钳的 semantic_layout 与当前正确结论相反、六屏全 pending → 产 must_fix、P0 三屏缺采 → 各产一条、素材占位债在当前口径为可回修
  - (B) 组即 plan 要求的「旧行为必红」凭据——用**真事故数据**，不是手写返回错值的假函数
- [ ] 发布约束生效检查——**禁发条件恢复**（review 第 3 轮修正）
  - 前一版写「T1~T5+T7a 已全部完成 → 禁发解除」，与同一文件里 T5 的 ⚠️「屏级独立 bootstrap 待宿主实测后按需扩展」自相矛盾：**bootstrap 是 T5 的验收项**，未做就不能算 T5 完成，更不能据此解禁。
  - 现口径：T5 记 **部分完成**（确定性缺陷生成器 + 真算接线 + 崩溃诊断结构化闭环已落；**屏级独立 bootstrap 未落**）。TC-003 崩溃导致后续屏级联采不到这条事故链，因此**仍未被结构性解决**——它需要 acceptance schema + hylyre 的产品侧改造，必须在宿主真机上做。
  - 禁发在 bootstrap 落地并经宿主实测前**保持生效**。
- [x] unit 全量绿+新增 fixture 全绿（**typecheck 0 / unit 2521 / fixtures 44**；基线 2405 → 新增 116 例）
- [~] **plan 代码部分**（2026-07-26）：T1/T2/T3/T4 完成；**T5 部分完成**（屏级 bootstrap + geometric_iou/required_element_coverage 未落）；**T7a 部分完成**（fixture 未达 plan 全量）
- [x] **runner 级集成测试**——**已实施（2026-07-25）**：`goal-runner-testing-integrity.unit.test.ts` 5 例，在**进程内跑真实 phase 循环全链**（spec→testing 六阶段），断言时序与副作用：
  - **污染轮 testing 的 gate harness 零调用**（按阶段断言，不是总次数）——review 指出的核心洞
  - 污染轮落 `invocation_evidence_invalidated` + `invocation_evidence_quarantined`
  - 污染轮工作区被反打还原（产品源码回到 invoke 前）
  - 干净轮 testing 的 gate 照常跑（证明闸门没把正常流程堵死）
  - invoke 前落源码基线备份 + provenance 链（64 hex 精确快照）
  - **为此新增 4 个测试缝**（生产路径零行为差异，仓内有 `__testing_setDigestReadFile` 等先例）：`__testing_setInvokeAgent` / `__testing_setRunHarnessPhase` / `__testing_setRepoLayout` / `__testing_setValidateReceipt`，并导出 `main`
  - 附带产出可复用夹具 `tests/utils/closed-feature-fixture.ts`（用**生产 writer** 造闭环产物，不手工伪造哈希链）
  - **过程记录（有价值的硬事实）**：打通过程依次撞过 6 道真实前置——adapter 物化 → DevEco 工具链 → workflow 加载 → summary 裁决（spy 必须补写 summary.json）→ 回执存在性（runner 会按真实回执重算 receipt_status/closure_status）→ 闭环探针子进程 → review closure attestation（缺它则 ut→testing 判 `goal_review_closure_baseline_unavailable`）。每一道都验证了测试确实走生产路径而非旁路
- [ ] 宿主配套 1-4 下发+回报核收；T6' 独立 change 立项（引用 R9 事实）
