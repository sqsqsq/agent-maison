---
name: testing 回灌纠偏 — selector 运行时裁决、执行通道、首失败与身份隔离
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan。来源是
# testing证据消费收编_StepResult唯一真源与推测退场_d8b3f6a1 的首次 Hylyre 0.4.1
# 宿主真机回灌；不替换原 plan，而是收编实现后才暴露的 selector/skip/routing 三项
# Maison 缺口、一项 Hylyre taxonomy 缺口，以及既有 framework 身份机制的过度扩张。
#
# 2026-08-31 实证（宿主 SimulatedWalletForHmos / feature=bc-openCard-1 / run
# 20260830T164617Z-771）：
# [E1] Hylyre 0.4.1 source ready、trace schema 0.3-p0、CaseResult/StepResult 必需字段、
#   native-only、report-reconcile-only 均已真实跑通；旧 wait_for 假通过已经关死。
# [E2] 派生计划 frontmatter 登记 14 executed + 16 explicit skip，正文仍写 20+10；同一文档
#   一面声明 card_category_row_c1/card_pack_add_card_row 已由 contracts/acceptance 授权且
#   “不以此跳过”，一面又因不在 feature ui-spec 将入口 TC 全部 explicit skip。
# [E3] shared-session 入口被跳过后，首个执行 TC-015 的前置仍写“已在收起态”，但计划没有
#   任何 producer/setup 把首页推进到收起态；设备因此停在首页，14 个执行 case 全部级联失败。
# [E4] 两个入口 ID 不是猜测：acceptance checkpoint 与 contracts 均有结构化/明确声明，源码
#   也有 .id() 落点；真正仍缺稳定 canonical anchor 的是首页→卡包入口。新静态门把“已有
#   checkpoint ID”与“真正缺锚点”混成同一种 ui-spec miss。
# [E5] collectHylyreFailureRoutes 当前仅排除 status=passed，故把根 failed 后所有 blocked
#   step，以及 expected_check_mode=disabled_by_flag 产生的 skipped expected_check，全部再造为
#   独立 failure route：一次 run 生成 56 selector + 14 capability 共 70 个 BLOCKER。OpenSpec
#   4.2 原文只允许消费已执行 status=failed 的失败事实。
# [E6] Hylyre native wait_for 对 canonical presence 未出现抛 SelectorResolutionError，落
#   selector_not_found；wait_gone 对目标仍在却落 AssertionMismatch。两者同为 assertion
#   期望不成立却分类不对称，使真实产品缺元素永远被路由 testing。外部修复要求见
#   docs/vendor/hylyre-0.5.0-执行观测与结果反馈协议重构需求.md。
# [E7] framework_integrity 并非本轮新增：2026-06-27 commit 215f06b46 引入逐文件
#   SHA256；07-05 增真人具名放行；07-10 增 manifest sidecar/foreign-file/write guard/tmp
#   hygiene；07-16 增 framework_integrity_block 首触 halt 与分型恢复；08-13 增
#   source_commit/built_at。原始事故是 goal agent 在宿主静默改 13 个 framework 文件，
#   核心防护有真实价值，但机制已从一个检查扩成一族状态与恢复分支。
# [E8] 本次直接反例：发布文档 docs/vendor/hylyre-0.4.1-*.md 仅少一个文末空行，事实 hash
#   检测正确，却让 catalog/testing/goal 全部 BLOCKER；第一次 framework-init 通过，文件被
#   编辑器/恢复流程收窄尾空行后第二次 init 才失败。该文档不参与运行，裁决严重度与恢复
#   成本明显失配；manifest/sidecar 又在同一可写目录，机制不是严格安全边界。
# [E9] 2026-08-31 用户复审推翻三项初版方案：①不做 ui-spec/acceptance/contracts canonical
#   白名单并集——feature ui-spec 是开放世界，缺声明只能 WARN，真实有效性由 native runtime
#   evidence 决定；②不以“可达性检查”掩盖 free-form skip 根因——派生 AI 退役自行添加
#   explicit skip 的权力，由顶层 test plan 声明执行通道；③framework 防改不再保留 runtime
#   hash 核心——真正身份隔离由 task sandbox/OS ACL/只读挂载提供；无法强隔离时只保留
#   合作式 Write/Edit 守卫并诚实承认 shell/脚本/场外进程盲区，不再用 Git dirty 补偿。
# [E10] 2026-08-31 交付前提再次冻结：不发布、不集成 Hylyre 中间运行版本；0.5.0 完成后由
#   Maison 一次集成并进入宿主正式回归。为避免串行返工，Hylyre 先交付 Phase 0 Schema/协议/
#   builder 判定表/golden fixtures，Maison 对同一契约并行改消费侧；MCP/session 只做 smoke，
#   0.3-p0 不做迁移承诺，进程无 trace crash 继续由既有 subprocess 分类器兜底。
# [E11] 2026-08-31 Phase 0 复审补齐边界：empty/invalid plan 的 pre-run reject 是协议内 contract
#   决策，stdout 单一 v1 JSON（含结构化 rejection）、exit=2、零设备且不产 trace/report；Maison 先解析该 envelope，
#   缺失/非法才进入无 trace crash 兜底。四个 code 面含 resolution.reason_code；failure-boundary
#   artifact 仍只限真实 selector/assertion 根失败，不扩成每步/成功路径截图。
#
# 简单原则冻结：不新增 selector registry、setup sidecar、屏幕状态机、failure ledger、runtime
# hash/sidecar、requested/selected 双账本；静态 selector 只拦可确定错误，派生器只编译顶层
# 已声明通道且不能自行 skip，failure route 只消费实际 failed step，宿主身份由模型外权限提供。
todos:
  - id: t1-contract-and-openspec-freeze
    content: T1 契约先行：testing 语义继续增补 testing-stepresult-evidence-consumption；framework 身份/发布边界另建独立 OpenSpec change，并显式 supersede consumer guard/framework-integrity 旧谱系，不把两个领域塞进同一 change。冻结 ui-spec miss 只 WARN且 runtime StepResult 最终裁决、execution_channel 由顶层计划声明且进入 review 面、Hylyre case setup/action 先行、manual 无机器证据时不能关闭质量门、Step Outcome failed route 与 blocked cause disposition 分离、trace schema 统一 dispatch 且未知 fail-closed、framework 写权限由模型外身份隔离且 runtime hash 家族退场。两 change strict validate 后再改对应生产代码。
    status: completed
  - id: t2-selector-static-lint-boundary
    content: T2 selector 静态边界：撤回 ui-spec 封闭白名单与多真源并集；保留非法 match/格式、ui-spec 已证明的多映射无消歧、富文本聚合父目标等确定 BLOCKER；仅当同一 acceptance checkpoint 绑定 action 的结构化 target_element_id 与计划 action by_id 明确不等时判冲突，不解析散文。feature ui-spec miss 只给 provenance WARN并允许执行；evaluateRuntimeSelectorGate 不再因 canonical ui-spec miss 拒绝已由 native evidence 证明的命中；runtime 判据按 Phase 0 §6.1 分工——成败读 outcome/observation，resolution 只提供身份事实与否定证据（unique 需 candidate_count=1 且 id/bounds 至少一个非空、禁 request 回填；not_attempted 既不判败也不给 identity credit；not_found 仅 absence 通过时合法）。dump/cache 不授权，acceptance/contracts 不创建第二真源。
    status: completed
  - id: t3-execution-channel-and-skip-retirement
    content: T3 执行通道与 skip 退场：顶层 test-plan 每 TC 增唯一 compile-time execution_channel（hylyre/visual/manual/provider:<id>），列值及变更进入 plan review/phase evidence，派生器不得新增或改写；hylyre case 首个 assertion 前须有同 case setup/navigation action，任一 case 无法编译则整份 Hylyre 计划不运行。visual per-TC 机器证据绑定已完成；manual 永久 fail-closed；provider 保留为 fail-closed 预留通道，其 per-TC 实现已转交独立 plan e7cecd22（provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md）。coverage 与 --report-reconcile-only 按 channel 精确对账，legacy explicit_skip 仅只读兼容。
    status: completed
  - id: t4-root-failure-only-routing
    content: T4 首失败归因：0.4-p0 仅以 outcome.status=failed + outcome.failure 生成 failure route；blocked/skipped 不生成 owner/coding route，无 steps legacy completeness 单独记 testing FAIL。capability/external disposition 同时消费 attempted failed 的 failure.domain 与未尝试 blocked 的 cause.type：capability 投 defer、infrastructure 投 external，prior_step/policy 不重复投影。routing 只读 outcome.* 与 selector.request/resolution，不把 0.3 flat status/failure_kind/evidence.executed 写死。assertion.mismatch 只有同 case 较小 index 存在 outcome=passed 的 action 才可 codingCandidate=true。
    status: completed
  - id: t5-regression-and-report-cardinality
    content: T5 回归矩阵：锁定 selector/open-world、channel/manual、setup/action、wrong-screen、report-only 精确 case 集；Step Outcome 覆盖一个 failed+N prior_step+policy skipped 只产一 route、capability failed route→defer、capability blocked cause→零 route+一 defer、infrastructure blocked cause→零 route+一 external、无 StepResult 零 route、多 failed 各自路由、根 UI failure screen artifact；0.4-p0 全链 required gates 必须运行，legacy-only/未知 schema 响亮失败而非 []/fallback。summary/repair candidates 不因投影膨胀。
    status: completed
  - id: t6-host-maintainer-identity-isolation
    content: T6 宿主/维护者身份隔离与 runtime Git/hash 退场：Maison maintainer、host consumer agent、user-triggered updater 三角色由 task sandbox/OS ACL/只读挂载等模型外权限区分；普通宿主只读 framework 控制面、updater 独占临时写权。删除 phase per-file manifest/hash/sidecar/selfcheck/foreign/subtype/allowlist 与 scoped Git dirty/HEAD 身份读取；普通 init/phase 不产 framework_integrity。暂不能强隔离时只保留合作式 Write/Edit 守卫并明确 shell/脚本/场外进程盲区；发布/明确集成边界验包，package identity 只作非阻断展示且来自 manifest/sidecar。强隔离与降级验收按实际环境条件二选一，不互相卡住。
    status: completed
  - id: t7a-hylyre-050-contract-fixture-migration
    content: T7a Phase 0 契约与 Maison 并行迁移：Hylyre 先冻结 output-schema 0.4-p0（含 pre_run_reject definition）、step-outcome-v1、builder 判定表及同一组 golden fixtures，补齐 failure/cause/reason/resolution 四个 code 面与 facts、optional/required VLM、unresolvable facts、tool_calls 映射及 Schema/builder/reducer/verifier 分工。Maison 直接据此建统一 dispatch/typed view；合法 pre-run reject 按 stdout JSON+exit2 归 plan contract，缺失/非法才进 crash 兜底；routing/selector/P0/report-only 对 fixtures 跑通，不另抄协议、不固化 0.3 flat 临时接口、不安装宿主或声称运行交付。
    status: completed
  - id: t7b-hylyre-050-source-integration
    content: T7b Hylyre 0.5.0 真实 source 集成：单一 OperationOutcome→StepResult builder、Case/Run pure reduce、真实 CLI pre-run reject、发布关键入口完整 conformance、atomic/MCP/session 各一 smoke、legacy 仅隔离不迁移、root UI failure artifact 全部符合 Phase 0；Maison 换接真实 source，最低版本/trace 门提升到 0.5.0/0.4-p0，未知 schema BLOCKER且 required gate 禁止 no-op/fallback，合法 reject 与无 trace crash 先结构化分流，既有 subprocess crash 分类器保留。
    status: completed
  - id: t8-host-replay-and-closeout
    content: T8 宿主回灌与收口（用户触发的宿主动作，不由 Maison 实施 agent 擅改宿主）：顶层测试计划先明确并 review execution_channel，指引明示任一 manual TC 都使本 feature testing 无法 PASS；Hylyre 完整编译并执行入口链，验 selector resolution、required/forbidden、TC-015、failure-boundary screen artifact、failed route、blocked capability/external disposition 与 report-only。报告按 selector/channel/Step Outcome/Hylyre/identity-package 分栏独立裁决；按事实完成原 plan 状态并跑定向/全量/strict/plan/diff/LF，历史 p0-skip t7 不夹带。
    status: pending
overview: >
  Hylyre 0.4.1 已证明“失败能诚实落盘”，但首次宿主回灌又暴露 Maison 在失败之前和失败之后
  各有一个越权：静态 lint 把不完整的 feature ui-spec 当封闭白名单，派生 AI 又能把不会做的
  入口随意改成 skip；运行后一个根 failed 的 blocked/skipped 投影被扩成 70 个责任路由。
  Hylyre 同时把 presence assertion 未满足归 selector；framework 防改则因缺模型外身份隔离而
  堆成长链 hash/sidecar/halt。最终方案回到职责本身：静态只拦确定错误、runtime 决定 selector
  真值；测试作者声明执行通道、派生器无 skip 权；Hylyre 升级到 0.5.0 Step Outcome Protocol v1，
  Maison 只把实际 failed 作为 responsibility route，并把机器 blocked capability/infrastructure
  cause 分别投影 defer/external disposition；宿主靠外部只读权限与 updater 身份隔离，无法强隔离
  时只保留合作式编辑守卫并承认盲区，普通运行不再维护 Git/hash 身份家族。
---

# testing 回灌纠偏：selector 运行时裁决、执行通道、Step Outcome 与身份隔离（a6c4e9f2）

状态：**宿主实证已冻结，待 OpenSpec delta 先行后实施。**

关联资产：

- 原 plan：[testing证据消费收编_StepResult唯一真源与推测退场_d8b3f6a1.plan.md](./testing证据消费收编_StepResult唯一真源与推测退场_d8b3f6a1.plan.md)
- 当前 change：[testing-stepresult-evidence-consumption](../../openspec/changes/testing-stepresult-evidence-consumption/)
- Hylyre 外部需求：[hylyre-0.5.0-执行观测与结果反馈协议重构需求.md](../../docs/vendor/hylyre-0.5.0-执行观测与结果反馈协议重构需求.md)
- provider per-TC 后续独立 plan：[provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md](./provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md)

---

## 零、讨论决策纪要（2026-08-31）

本节记录用户复审后的最终决策，优先级高于本 plan 早期草案；实施者不得恢复已否决方案。

### D1 selector：撤回“多真源白名单并集”，恢复开放世界语义

**问题追问**：旧版如何工作，为什么本版把合法入口误杀？

**实证答案**：旧版同样只从 feature ui-spec 查询，但 miss 仅 `WARN`；Hylyre 仍可在真机用 contracts/acceptance 已知 ID 成功定位。当前未提交实现把 violation 从固定 `WARN` 提升为 `BLOCKER`，同时假定 feature ui-spec 覆盖整座 App。真实 feature ui-spec 只建模新增页面，既有入口天然缺席，因此这是本版新引入的封闭世界回归。

**最终决策**：

- 静态 lint 只阻止能够确定的错误：非法 selector/match、ui-spec 已证明的多映射无消歧、富文本聚合父节点冒充独立 target；
- selector 不在 feature ui-spec 只给 WARN，不作为非法证明；
- acceptance/contracts 可用于解释 provenance 和提示责任，但不合成第二套 canonical registry；
- **步骤成败由 `outcome` + `observation` 裁决**（经 Schema 与跨行校验）；`selector.resolution`
  描述执行器实际取得的解析/身份事实，**不是所有 operation 的第二个成功状态**。判据不得写成按
  `request.kind` 的固定旁路——实际语义取决于执行路径（Phase 0 冻结包 `step-outcome-v1.md` §6.1）：
  - native provider 侧解析、目标在场且 request 为 `by_id`/`by_key` → `unique` 且携带真实结构化身份；
  - native provider 侧解析、目标在场但身份对 Hylyre 不可见（典型如 `by_text`）→
    合法产生 `outcome=passed + resolution=not_attempted`；
  - Hylyre resolver 自己解析到文本节点时，`by_text` 也可能是 `unique`，且
    `selected.id=null`、`selected.bounds` 非空同样合法。
- `unique` 的严格条件：`candidate_count=1`、`selected` 非空、`selected.id` 与 `selected.bounds`
  **至少一个非空**、且禁止把 `request.value` 回填成 `selected.id` 冒充实际身份。
- `not_attempted` = **没有 selector identity 证据**：既不能据此把一个合法 passed StepResult 改判失败，
  也不能拿它证明"实际选中了某个 target"。下游若要求 selected identity，该项身份要求保持**未证明**，
  但不得篡改原 StepResult 的 outcome。
- `not_found` 是"resolver 确认 0 候选"的事实，不是统一失败：action/presence 由 outcome 表达失败，
  而**通过的 absence 断言**合法使用 `not_found + candidate_count=0 + selected=null`。
- `ambiguous`/`unresolvable` 按冻结契约与 builder 判定表消费，不据 resolution 另造一套 status。
- **身份护栏**：P0 checkpoint 的 required/forbidden 身份证据必须由 `by_id` 断言承载；`by_text` 的
  observation 成功**不得**替代身份证明（`required_element_ids` 本就是 id）。这条防的是把身份检查
  换成文本断言、把 identity binding 洗掉。

**否决方案**：`ui-spec ∪ acceptance checkpoint ∪ contracts trigger` 白名单并集。理由：会立即引入优先级、冲突、失效同步和散文解析问题，重新长出 selector registry。

### D2 skip：撤回“可达性检查是主修复”，取消派生 AI 的自由 skip 权

**问题追问**：为什么入口可以被随意 skip？只检查下游不可达是否在隐藏根因？执行器怎样知道未进入 Hylyre 的 case 应该怎么做？

**实证答案**：旧版没有 machine reachability，但人工派生的 20+10 计划保留了入口链，所以实际可达；本版静态 BLOCKER 后，派生 AI 把不会处理的入口塞入 `explicit_skip_tc_ids`，而 coverage 只验 TC 集合，没有限制 skip 权责。问题根因是 agent-generated skip 逃生口，不是缺一套屏幕状态机。

**最终决策**：

- 顶层 `test-plan.md` 增一个 compile-time `execution_channel`，由测试作者决定：`hylyre | visual | manual | provider:<capability-id>`；
- 派生器只能编译 `hylyre` case，不得新增、删除或改写通道，不得把编译失败转成 skip；
- 任一 `hylyre` case 无法编译时，整份 Hylyre 执行计划不启动，并返回该 TC 的真实根因/下一责任阶段；
- visual case 已接入既有机器证据链；manual 永久 fail-closed；provider 当前只保留 fail-closed 预留通道，
  无 per-TC evidence 时继续留在分母、不记为通过，后续实现转交独立 plan `e7cecd22`；
- `manual` 当前没有可复用的机器质量证据载体，也不得复活已退役的 `confirmed_by`/人工 receipt：它只显式保留“尚未自动取证”的测试义务，继续在分母中 FAIL/UNVERIFIED；人工观察可转成后续 correction 输入，但不能关闭本 run 的 testing/release；
- `execution_channel` 列及其变更必须进入 test-plan review 与 phase evidence；P0 runtime checkpoint 仍须满足既有 StepResult 机器证据，不能靠改成 visual/manual 逃避；
- `explicit_skip_tc_ids` 对历史产物只读兼容，新正式派生不再生成；
- 不建完整 screen state graph。现有顺序/nav lint 只作基本一致性，主保证来自“通道由顶层决定 + Hylyre 编译全有或全无”。

**否决方案**：保留 free-form skip，再追加 producer/pre_screen/post_screen 可达性状态机。理由：只能在错误发生后隐藏/拦截结果，不能回答 skipped case 应由谁执行，还引入第二套状态推导。

### D3 failure routing：确认是本版新增实现 bug，不归咎旧链

**问题追问**：旧版是否也会把一个失败放大成 70 个？

**实证答案**：不会。`hylyre-failure-routing.ts` 是本轮新增、旧 HEAD 不存在；旧版的问题是没有 native StepResult 精细归因，只能粗看 case/explicit skip。新实现误写为“所有 non-passed 都路由”，而 OpenSpec 已限定“executed status=failed”。测试只断言 blocked 不产 coding candidate，没有断言 blocked 根本不产 route。

**最终决策**：该 0.3-p0 bug 的不变量保留，但最终实现按 D4 的 v1 形状落地：collector 只接收
`outcome.status=failed` 的本 step failure；blocked/skipped 不进入 responsibility writer。另由
blocked capability/infrastructure root cause 投影非 failure 的 defer/external disposition。补真实
ledger cardinality 回归，不退回旧版粗粒度归因，也不先固化 flat reader 再二次改形。

### D4 Hylyre Step Outcome：从局部 taxonomy 修补升级为结果协议重构

**复审结论**：wait/blocked/expected-check/selected_id 不是四个孤立 bug，而是 Driver 任意返回值/exception、flat StepResult、CaseResult 与投影之间没有规范化 Outcome 协议。只改异常类型会在下一种 operation 上复发。

**最终决策**：目标升级为 Hylyre 0.5.0、`hylyre.step-outcome/1`、trace `0.4-p0`。passed/failed 表示实际尝试，blocked/skipped 表示未执行；failure/cause/reason 分离；selector request/resolution 分离；所有 driver/plan/fake/batch/CLI/MCP/session 走单一瞬态 OperationOutcome→StepResult builder。Maison 不根据 role/error 修补上游字段，0.3-p0 只保留 unsupported-for-evidence/可选诊断边界且不承诺迁移，未知 schema 必须 fail-closed。

**交付前提与提速决策**：不存在 0.4.1 新语义的中间消费期，也不先发一个临时 Hylyre/Maison 版本。Hylyre 先交 Phase 0：`output-schema.json` 0.4-p0 终稿、协议规范、规范性 builder 判定表和 golden fixtures；Maison 立即基于同一批资产并行改 typed consumer。Phase 0 不安装宿主、不形成运行证据。真实 0.5.0 实现完成后再一次集成、一次宿主回灌，避免“Hylyre 全做完→Maison 才发现歧义→返修”的串行往返。

Phase 0 必须在开工前清零四类歧义：

1. `cause/reason` 核心 type、namespaced code 与扩展注册规则；空 case 是 plan contract reject，设备中途死亡的当前 step/同 case 后缀/后续 case 分别落 failed、prior_step、root infrastructure；
2. capability/infrastructure cause 必须带机器 `facts.probe_status/probe_source`，不能靠 diagnostic；`observation.kind` 只保留 action/assertion，不与原因域交叉；
3. builder 判定表明确 attempted、`performed=false+failed`、prior_step 直指根 outcome、required/optional 能力与 CaseResult reduce；
4. `expected_check.disabled_by_flag`、`expected_check.unavailable_no_vlm`、checked_vlm 因前序失败 blocked 的不同落点。

同时冻结 tool_calls 的 0.4-p0 有损映射、`resolution.state=unresolvable` 的 reason/dump/resolver/fragment facts，以及职责分工：Schema 只验 variant 局部形状，builder 构造，reducer 聚合，verifier 复算跨行引用/CaseResult/投影。必须删除旧 `status != passed → failure 必填` 规则，而不是换名复制。

pre-run plan validation 也属于协议：empty case/静态 invalid step 不生成伪 StepResult/CaseResult，但必须 stdout 只输出一个 `result_protocol=hylyre.step-outcome/1,command_status=rejected,phase=pre_run_validation,rejection={contract.*}` JSON，固定 exit=2、零设备调用且不创建/改写 trace/report。validator 可按稳定顺序返回首个违规，不为此新增聚合状态。Maison 先解析这个 envelope 并归 testing/plan contract；只有 envelope 缺失/非法且无 trace 才进入既有 subprocess crash 分类。code 注册边界明确包括 `failure.code/cause.code/reason.code/resolution.reason_code` 四面，不能让 unresolvable reason 再变成自由字符串。

**范围裁剪**：real plan、fake、steps-file/batch 是发布关键入口，做完整 conformance；atomic CLI、MCP、session 因不产 Maison 正式证据，只要求共用 builder 与每入口一条 smoke。0.3-p0/0.2 只隔离并明确不能作为 evidence，不承诺迁移工具或完整读取兼容。Maison 现有“进程崩溃且无 trace”subprocess 分类器是协议外兜底，保留但不纳入 0.5.0 关键路径。

capability/infrastructure 的 status 仍按 attempted 事实决定：已尝试后失败落
`outcome.status=failed + failure.domain`；执行前机器已证明不可用落
`outcome.status=blocked + cause.type`。前者进入 failed responsibility route，后者不生成 failure
route，但两者分别复用既有 capability defer/external disposition；`blocked/prior_step` 不重复投影。

为避免错误页面被误归产品 assertion，Hylyre case 必须先执行并通过 setup/navigation identity，再执行页面内 assertion；setup action 失败时后续 assertion outcome 应为 blocked/prior_step。

该纪律的本期机器落点冻结为最小可判定规则，而不是新建 screen 状态机：每个 `channel=hylyre`
case 的首个 assertion 之前，必须在同 case 至少有一个 setup/navigation action；运行时只有当
同 case 较小 index 存在 `role=action && outcome.status=passed` 时，后续
`outcome.failure.code=assertion.mismatch` 才可产生 coding candidate。若没有该前置事实，失败仍可形成 testing route，
但 `codingCandidate=false`；前置 action 失败后其余 step 由 Hylyre 投影为 blocked。该判据是防止
TC-015 一类 wrong-screen 首断言被误投 coding 的最低准入，不声称推导完整页面状态。

### D5 framework 身份：撤回 runtime hash 核心，权限隔离优先

**问题追问**：如何真正区分宿主与 Maison 开发者，而不是继续加检查？

**最终决策**：身份不能来自 env/config/agent 自报/当前目录，必须由模型无法伪造的执行环境授予：

1. Maison maintainer task：Maison 源仓 read-write；
2. host consumer task：宿主产品/feature/runtime read-write，framework 控制面 read-only；
3. user-triggered updater：唯一临时拥有宿主 framework 写权，完成原子升级后恢复只读。

首选实现是 task sandbox/只读挂载或不同 OS 安全主体/ACL。若 Maison 开发和宿主 agent 都运行在同一个 Windows 用户且无受限 token，则不存在真正身份隔离；不得用 hash 或 Git 伪称安全。该环境只采用合作型降级：保留 Write/Edit/MultiEdit/NotebookEdit guard，明确 shell 重定向、脚本、`node -e` 与场外进程均不在射程；不再增加查时 detector。

**删除范围**：consumer phase per-file hash、runtime manifest/sidecar selfcheck、独立 foreign-file check、tmp hygiene integrity subtype、真人 drift allowlist、scoped Git dirty/HEAD 身份读取与六 subtype halt/recovery 矩阵。包 hash 只在 Maison 发布和 updater 集成时各验证一次；manifest/sidecar 的 version/source_commit/built_at/manifest SHA 可作非阻断 package identity。

**否决方案**：语义 hash、规范化 hash、更多 sidecar、签名字段、身份环境变量、新 trust DB、scoped Git dirty、宿主 HEAD/source commit 混用，以及 updater 记录 install Git tree/ref 后由 phase 对比 HEAD tree。理由：同一可写主体可一并修改文件、commit 与本地 baseline，不能形成身份边界；Git object id 也不能靠换名成为新的 runtime identity 真源。

---

## 一、问题边界与定性

### 1.1 已经成立的链路，不重做

本次真实宿主 run 已证明以下实现有效，后续不得以新问题为由推倒重来：

1. Hylyre 0.4.1 source 安装与 ready version chain；
2. trace schema `0.3-p0` 与 CaseResult/StepResult 三轴/ledger；
3. `wait_for` 缺目标不再假通过；
4. native StepResult 唯一真源，旧 telemetry 已退场；
5. P0/acceptance 缺 required/forbidden 证据时 fail-closed；
6. structured selector ID 在成功/失败序列化路径不再被文本脱敏；
7. `--report-reconcile-only` 同 run 完整重算且 trace 字节不变。

原 plan 的 T4（三重判据与 legacy）、T6（telemetry 退场）、T7（report-only）已经具备真实宿主证据；实现本 plan 时应按事实更新其 frontmatter，不能继续因业务 FAIL 一概保留 `in_progress`。

### 1.2 Maison 问题 A：把不完整 ui-spec 从提示源升级成封闭白名单

旧版 `SELECTOR-SPEC-001` 对 ui-spec miss 固定输出 WARN，允许真机用 runtime 事实裁决；当前实现把 violation 升为 BLOCKER，并把 derive policy 写成 `by_id MUST resolve to ui-spec node`。变化本身没有配套真实宿主迁移：feature ui-spec 只建模本次新增页面，首页/卡包/添加卡片等既有入口不会重复建模。

因此“ui-spec 没写”只说明静态信息不完整，不能推出 selector 非法。真正能静态确定的错误是非法 match、已知多映射无消歧、富文本聚合父节点等；目标是否在真实设备唯一存在，应由 Hylyre runtime evidence 判定。

### 1.3 Maison 问题 B：agent-generated explicit skip 成为编译逃生口

当前派生器允许 AI 自行写 `explicit_skip_tc_ids`。当新静态 BLOCKER 拒绝入口时，AI没有回报“无法编译”，而是把 TC-001/002/003/011/012/018 从 executable 集合移到 skip，仍宣称顶层 30 条已覆盖；剩余 case 的前置状态随后全部失真。

旧版没有 screen reachability machine gate，但人工计划保留了完整入口顺序，所以未触发。根因不是先缺一套可达性状态机，而是派生器拥有改变测试执行责任的权力，却没有回答这些 case 应交给谁、如何取证。

### 1.4 Maison 问题 C：根失败被 ledger 投影倍增

Hylyre 为保证 `steps[]` 与计划等长，会给根失败后的未执行步骤写 `status=blocked`，并给禁用的 expected-check 写 `status=skipped`。这两类行是账本完整性，不是新的执行失败。

Maison 当前 `collectHylyreFailureRoutes` 只排除 `passed`，导致：

```text
1 个真实 failed
+ N 个 blocked（继承根 failure_kind/code）
+ 1 个 expected_check skipped（disabled_by_flag）
= N+2 个 BLOCKER 路由
```

这违反既有 OpenSpec 4.2 的“executed status=failed”域，也让 capability defer、报告 blocker 数、repair 预算和责任统计全部失真。

### 1.5 Hylyre 外部问题：assertion 与 selector taxonomy 不对称

对于已经合法编译的 presence assertion：

```text
wait_for(required target) + observed_present=false
```

应表达“预期没有满足”，而非“测试 selector 自身错误”。当前 native/resolver `wait_for` 落 `selector_not_found`，但 `wait_gone` 观察到目标仍在却落 `assertion_mismatch`。这会让产品真实缺元素永久归 testing，无法进入既有 coding/product candidate。

此问题必须由 Hylyre 修复 taxonomy；Maison 不得依据 `role` 或 `error` 重解释上游 `failure_kind`，否则双方再次形成平行分类真源。

### 1.6 Maison 问题 D：framework_integrity 用事后 hash 代替身份隔离

机制来源与演化已经由 Git 历史实锤：

| 时间 | 变更 | 目的 |
|---|---|---|
| 2026-06-27 / `215f06b46` | per-file SHA256 + 全局 preflight | 阻止宿主 agent 静默修改 13 个 framework 文件 |
| 2026-07-05 | 真人具名 drift 放行 | 避免 agent 自批本地 fork |
| 2026-07-10 | manifest sidecar、foreign-file、write guard、tmp hygiene | 保护 manifest、补查新增文件、前置阻写 |
| 2026-07-16 | `framework_integrity_block`、六 subtype、首触 halt/恢复话术 | 防 goal agent 反复回滚/修复拉锯 |
| 2026-08-13 | `source_commit/built_at` | 展示包来源身份 |

原始价值成立：可执行门禁或 agent 指令在 consumer 被静默改动时，宿主不应继续把它当官方 Maison。它还可发现不完整/混装的 framework。

但当前实现把三个维度都推到最大：

- **范围**：manifest 中所有发布字节，包括不参与运行的 vendor 移交需求；
- **严重度**：任何一个字节一律所有 phase BLOCKER；
- **恢复面**：restore/release、具名 allowlist、sidecar selfcheck、foreign-file、六 subtype halt。

本次只有 Markdown 文末 `\n\n → \n`，hash 事实无误，但 catalog、testing 与设备执行均被阻断。此机制不是严格安全边界：manifest、sidecar 与被校验文件在同一可写目录，同一主体有能力一起修改；它主要防误操作和不守边界的 agent，不能以“安全”名义无限增加自保护层。

定性：原始“宿主 agent 不得改 Maison 控制面”目标成立，但当前实现没有区分宿主与维护者身份，只能在两者都可写之后事后算 hash；随后为保护检查本身继续增加 sidecar、allowlist、subtype 与 halt。正确修复是把写权限从宿主身份拿走，而不是保留一个更精细的 runtime hash 核心。

---

## 二、目标模型

### 2.1 运行前：静态 lint 是提示/确定错误检查，runtime 才是 selector 真值

不再构造 canonical 多源并集。静态结论分两类：

```text
可确定错误 → BLOCKER
静态资料不足 → WARN，允许进入 runtime
```

BLOCKER 仅包括：

- selector 结构或 match 非法；
- 正式 by_text 未显式写 `exact|contains`；
- ui-spec 已明确证明当前 screen 多映射而计划没有 `index/scope/within/all`；
- contains 只命中有 children 的聚合 Text/Row、没有独立 interaction target；
- 计划 selector 与 acceptance checkpoint 明确冲突。

最后一项只允许结构化机器判定：同一 AC/checkpoint 已绑定的 action step 同时声明
`checkpoint.action.target_element_id` 与计划 `by_id`，且两者非空、不相等时才是冲突；不得从
用例名、precondition、expected、contracts 散文或相邻 step 猜绑定关系。

以下只给 WARN：

- by_id/by_text 不在当前 feature ui-spec；
- selector 属于已有入口/前置页面，feature ui-spec 未覆盖；
- acceptance/contracts 能解释其来源，但不足以把它升级为新的静态白名单真值。

dump/cache 仍只用于候选建议。最终裁决只认 StepResult v1，且**分工明确**：步骤成败读
`outcome`+`observation`，`selector.resolution` 提供身份事实与否定证据。
`unique` 要求 `candidate_count=1`、`selected` 非空、`selected.id`/`selected.bounds` 至少一个非空，
且禁止回填 `request.value` 冒充身份；`not_found`(0/null) 是 resolver 确认零候选的事实——通过的
absence 断言正是这个形态；`ambiguous`/`unresolvable` 按冻结契约拒绝。
`not_attempted` 表示没有身份证据：**不得**据此把合法 passed 改判失败，也不得用它冒充"已证明选中"。
`evaluateRuntimeSelectorGate` 不得因 selector 缺席于 feature ui-spec 再次拒绝一个已由 native
evidence 证明的开放世界命中。ui-spec 仍可证明已知歧义，但 miss 不是 runtime 失败条件。
P0 required/forbidden 的身份证据必须由 `by_id` 断言承载，文本断言的成功不替代身份证明。

### 2.2 顶层执行通道决定“谁做”，派生器不再决定“跳过”

`test-plan.md` 的每条 TC 增一个编译期字段：

```text
execution_channel = hylyre | visual | manual | provider:<capability-id>
```

它不是执行状态，也不进入第二套结果账本；只告诉编译器调用哪个机器执行入口，或显式保留当前无法自动取证的 manual 义务：

- `hylyre`：必须完整编译；任一 case 编译失败则整份 Hylyre 计划不启动，输出该 TC 根因和下一责任阶段；
- `visual`：交给既有 visual capture/diff，未取证不通过；
- `manual`：当前没有质量 PASS 载体；仅把 TC 保留为显式未完成义务并继续 FAIL/UNVERIFIED，
  不接受用户回复、`confirmed_by`、人工 receipt 或 manual resume 作为本 run 完成证据；
- `provider:<id>`：当前交给既有 capability registry 做能力可用性解析，但没有 per-TC result 时固定
  FAIL/UNVERIFIED；provider 缺失则明确 capability gap，不改成 skip。per-TC 机器证据实现由独立 plan
  [`e7cecd22`](./provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md) 跟踪。

正式派生器不得新增、删除或改写 execution_channel，也不得生成新的 `explicit_skip_tc_ids`。legacy explicit skip 只为读取历史产物保留，不再由新 writer 产出。

每条 TC 的 channel 是 test-plan review/phase evidence 的显式字段；writer 改 channel 会改变计划
identity，不能在 derive 或回灌时静默重写。P0 device checkpoint 的机器 StepResult 义务保持不变，
`visual/manual` 不能成为规避 Hylyre/runtime evidence 的绿灯。

不新增完整 screen reachability graph。Hylyre 通道采用全有或全无编译：入口/setup case 也是正式 `hylyre` case，不能因派生困难被单独挪走；现有顺序/nav lint 继续检查基本导航纪律。长期可减少跨 case 状态依赖，但不在本 plan 建状态机。
此外，派生 lint 要求每个 Hylyre case 的首个 assertion 前存在同 case setup/navigation action；
这是 D4 的结构化最低防线，不解析 precondition 散文，也不推导跨 case screen state。

### 2.3 运行后：只路由真实执行失败

failure route 的消费集合冻结为：

```text
step.outcome.status == "failed"
∧ step.outcome.failure.domain/code 合法
```

- `failed`：唯一 responsibility failure route；按 `failure.domain` 路由、按 namespaced code 说明；
- `blocked/prior_step`：仅说明未执行因果，不产生 owner/candidate/defer；
- `blocked/capability`：不产生 failure route/coding candidate，但机器 cause 投影一次既有
  capability defer；后续 prior_step 不重复；
- `blocked/infrastructure`：不产生 failure route/coding candidate，但机器 cause 投影一次既有
  external/toolchain disposition；
- `skipped expected_check`：由 `outcome.reason` 与 `expected_check_mode` 解释，不产生 capability defer；
- legacy explicit skip（无 CaseResult/StepResult）：只读兼容时仍由既有 case completeness 路径记 testing FAIL、零 coding；新正式计划改由 execution_channel 分派，不再生成 skip；
- `failed/failure.domain=capability`：该 failed route 的 disposition 为 capability defer、零 coding；
- 一个 case 若运行策略允许多个实际 failed step，则逐个路由，不做“只取第一个”的猜测去重。

capability/external disposition 与 failure route 是两个内存投影，不新增 ledger/sidecar/持久状态。
blocked cause 只有 `capability|infrastructure` 的根 cause 可投影，且按
`case/index/cause.type/code` 去重；不得把所有 blocked 当 failure，也不得让 prior_step 放大根因。

`collectHylyreFailureRoutes` 不再为无 steps 的 legacy `status=跳过|阻塞` case 合成 case-level route；
这类缺口只由 completeness/通道对账报告。对 `assertion + assertion_mismatch`，只有同 case 较小
index 已有 `role=action + outcome.status=passed` 才允许 `codingCandidate=true`；否则 owner 留 testing，避免
wrong-screen 首断言伪造产品修复候选。

### 2.4 身份与权限：宿主从物理上无权写，开发者/Updater 才有写权

身份不能由 Maison 内部字段声明。目标模型是三个模型外安全主体：

| 身份 | 可写范围 | 身份来源 |
|---|---|---|
| Maison maintainer | Maison 源仓与发布产物 | maintainer task sandbox / OS principal |
| Host consumer agent | 宿主产品、feature、runtime；framework 控制面只读 | host task sandbox / restricted token / read-only mount |
| User-triggered updater | 仅升级窗口临时写宿主 framework | 用户/CI 显式启动的受控更新进程 |

首选由 Codex/agent host 的任务权限、容器只读挂载或 Windows 不同安全主体 + NTFS ACL 实现。若维护者与宿主 agent 都运行在同一 Windows 用户且没有受限 token，则不能声称身份隔离；env/config/agent name 均可伪造。

运行时目录按现有 policy 单独可写（如 `node_modules/reports/state/trace`），控制面源文件只读；必要时后续再把 runtime 外移，不在本 plan 为此重构布局。

无法获得强权限隔离的兼容环境只保留现有 Write/Edit/MultiEdit/NotebookEdit guard，提前拒绝其射程内的普通 framework 写入。该守卫 fail-open，无法覆盖 shell 重定向、脚本、`node -e` 或场外进程；这些是同一主体环境的真实盲区，不得用 Git/hash/sidecar 事后 detector 假装补齐。

Maison 构建并校验发布件，宿主解压/集成到 `framework/`；宿主是否使用 Git、是否 tracked/staged/committed/clean、HEAD 是否仍是旧发布件均不参与 Maison verdict 或 Framework identity。package identity 只读 manifest version/source_commit/built_at 与 sidecar 声明的 manifest SHA，全部非阻断。
强隔离验收只在确有 restricted token/ACL/只读挂载的环境执行；当前同一 Windows 用户环境只验
降级项，二者按环境条件裁决而非要求同一机器同时提供。

framework 身份/发布边界以独立 OpenSpec change 承载，显式处理 canonical
`framework-integrity`、`runtime-policy` anti-cheat 条款及 archived
`consumer-framework-integrity-guard`/`consumer-write-guard` 谱系的 supersede；不并入
`testing-stepresult-evidence-consumption`，避免 testing change 跨域承担 archive 责任。

删除 consumer runtime per-file hash、manifest/sidecar selfcheck、独立 foreign-file、tmp integrity subtype、drift allowlist 和六 subtype halt/recovery。发布包 hash 只在 Maison pack 与 updater install 时验证，不进入普通 phase。

---

## 三、实施批次

### T1 契约与 OpenSpec 先行

- 增补 `testing-stepresult-evidence-consumption` 的 design/spec/tasks：ui-spec miss 从非法结论退为静态未知；runtime evidence 最终裁决；Step Outcome v1 的 failed responsibility route 与 blocked capability/infrastructure disposition 分离；wrong-screen 首断言没有同 case passed action 时不得投 coding。
- 增补 testing plan/schema 契约：`execution_channel` 是唯一编译分派，正式派生器不再拥有 explicit skip 决策权；channel 属 review/phase-evidence 面；`manual` 无机器 PASS 载体，只保留未完成分母且不得复活人工质量 receipt。
- 冻结 Maison trace schema dispatch：`0.4-p0 + hylyre.step-outcome/1` 正式消费、`0.3-p0`
  只读诊断、未知 schema 显式 BLOCKER；required gate 禁止因 schema 不匹配返回空数组/SKIP、
  降为 legacy status 或改读 telemetry/log/tool_calls。
- 另建独立 framework identity/boundary change，修订 `framework-integrity`、`runtime-policy`、goal 与 release-boundary 相关 spec：身份隔离是外部权限边界，runtime Git/hash 家族全部退场；无法强隔离时只保留合作式编辑守卫并明确盲区。该 change 必须显式 supersede archived consumer guard 谱系，且先清点与 active `runtime-policy-core` 的 compatible/conflict 关系。
- 外部 Hylyre 0.5.0 Step Outcome Protocol v1 先形成 T7a Phase 0 gate：Schema、协议、builder 判定表与 golden fixtures 同时冻结；Maison 由此并行迁移，不把外部缺陷偷塞进 flat-field 兼容分支，也不等待 0.5.0 生产实现完成后才开始。
- 两个 change 分别在各自第一刀生产代码前跑 strict validate，archive/验收也分域，不用 testing 结果替 framework boundary 背书。

### T2 selector 静态 lint 边界

- `selector-contract.ts` 撤回“所有 miss 都 BLOCKER”：恢复 ui-spec miss WARN，并保留明确非法/已知歧义/聚合富文本的 BLOCKER。
- derive hint 文案从 `MUST resolve to ui-spec` 改为“ui-spec 是静态提示，native StepResult 是最终真值”；继续要求 by_text 显式 match、禁止 runtime fallback。
- acceptance/contracts 仅在 WARN details 中解释 selector 来源/责任，不改变 canonical index、不持久化 provenance ledger、不解析散文；唯一静态冲突是同一 checkpoint 已结构化绑定 action 且 `target_element_id != plan.by_id`，没有明确绑定则不得猜。
- `evaluateRuntimeSelectorGate` 删除“canonical ui-spec 映射为空即失败”的封闭世界分支；改为按 v1
  `selector.request/resolution` 消费**身份事实**而非成败：`unique` 严格校验
  candidate_count=1 / selected 非空 / id 或 bounds 至少一个非空 / 禁 request 回填；`ambiguous`
  与 `unresolvable` 拒绝；`not_found` 只在 absence 通过时合法；`not_attempted` 不判失败也不给
  identity credit。步骤成败一律以 `outcome` 为准。补 fixture：native `by_text` 的
  `passed + not_attempted`、resolver `by_text` 的 `unique/id=null/bounds≠null`、
  passed absence 的 `not_found/0/null`、request 回填冒充 selected 被拒、
  “既有页面 ID 不在 feature ui-spec 但真机唯一命中”。

### T3 execution_channel 与自由 skip 退场

- 更新 test-plan 模板/结构门、parser 与 derive payload，加入每 TC 唯一 `execution_channel` 列/字段，值域冻结为 `hylyre|visual|manual|provider:<capability-id>`；该列纳入 plan review、phase evidence/freshness，修改即改变计划 identity。
- 新正式计划缺 channel 直接要求一次性迁移，不按测试文字启发式猜执行器；legacy 计划只读兼容，不把旧 explicit skip 迁成 PASS。
- derive writer 只输出 channel=hylyre 的完整集合；任一 hylyre case lint/selector/step 编译失败，或首个 assertion 前没有同 case setup/navigation action，即不产 runnable plan并输出根因。不得写新 explicit skip frontmatter。
- visual per-TC binding 已复用既有机器执行与报告入口完成；manual 不新增提交入口并永久留在
  FAIL/UNVERIFIED 分母；provider 在本 plan 内保持 fail-closed 预留通道，per-TC binding 转交
  [`e7cecd22`](./provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md)。
  P0 runtime checkpoint 无论 channel 如何都不能缺 StepResult 机器证据而 PASS。
- coverage/reconcile 从“executed ∪ explicit skip”改为“顶层 channel 分派 ∧ 各通道证据”，移除 agent 自由 skip 的修复建议；`checkHylyreCaseExecutionCompleteness`、`collectReportOnlyDerivedPlanStaticIssues`、`reconcileReportWithHylyreTrace`、`reconcileReportWithDeviceTestTiming` 与 `--report-reconcile-only` 的 derived/trace/timing 精确集合只取 `channel=hylyre`，报告总表仍与顶层全部 TC 精确闭合。非 Hylyre TC 由各自证据/耗时规则对账，不能误报 trace 缺失或伪装 legacy skip。

### T4 首失败事实路由

- 最终 routing 只消费 schema-dispatched v1 typed view：`outcome.status=failed` 与
  `outcome.failure.domain/code`；不得把当前 0.3-p0 flat `status`、`failure_kind`、`failure_code`、
  `evidence.executed` 固化为新接口。0.3 flat reader 只为 legacy diagnostics，不能闭合 v1 route。
- 删除 collector 对无 `steps[]` 且 case status=`跳过|阻塞` 的 case-level route 分支；legacy explicit skip/unexecuted 只由 completeness 记 testing FAIL，route 基数保持 0。
- `routeHylyreFailure` 对非 failed 输入只在开发/测试边界报错，生产 collector 不传入；不增加 `ignored` owner 或第三种 failure route 状态。
- capability/external disposition 另从 typed outcome 投影：failed capability/infrastructure 由其唯一
  failed route 给出 defer/external disposition；blocked root cause 的 capability/infrastructure 产生
  0 failure route + 1 defer/external disposition；prior_step/policy 不投影且必须去重。
- assertion mismatch 的 coding 准入读取同一 CaseResult ledger：仅当较小 index 有
  `role=action,outcome.status=passed` 才 `codingCandidate=true`；否则返回 testing route、零 coding，
  不从 precondition/diagnostic 猜 screen。
- expected-check skipped 继续保留在 StepResult ledger 和执行结果表，但不写 `testing_failure_routing_*` 或 capability defer。
- summary/repair candidates 只消费真实 failure route；同一根失败不再按 blocked step 数消耗预算。

### T5 回归与报告基数

定向覆盖至少包括：

1. ui-spec 明确 singleton/消歧正常通过；
2. selector 不在 feature ui-spec → WARN，但 runtime 证据合法时真实通过：native `by_id` 的
   `unique/1/selected.id`、native `by_text` 的 `passed + not_attempted`、resolver `by_text` 的
   `unique/id=null/bounds≠null` 三种形态都必须通过；`not_found` 的 by_text 仍按 outcome 拒绝，
   failed 的 by_text 不得因 `not_attempted` 被洗成 PASS；
3. ui-spec 已证明多映射无消歧 → 静态 BLOCKER；
4. 同一 checkpoint 的结构化 `action.target_element_id` 与已绑定计划 action `by_id` 不同 → BLOCKER；无结构化绑定/仅散文不同 → 不判冲突；
5. 顶层 channel=hylyre 的入口不能编译，或首个 assertion 前无同 case action → 整份计划不运行，派生器不得生成 skip；
6. visual channel 的 per-TC 机器证据入口已完成；manual 无 writer/receipt 且永久不能产生 PASS；provider
   在本 plan 内固定 fail-closed，后续 per-TC 实现由 `e7cecd22` 单独验收；缺证据均留分母；
7. channel 变更进入 plan identity/review，P0 case 改成 visual/manual 仍不能绕过 runtime StepResult 义务；
8. `--report-reconcile-only` 仅要求 channel=hylyre 的 derived/trace/timing 集合精确相等，非 Hylyre TC 不误报 trace missing，并由各通道结果参与总分母；
9. legacy explicit skip 可读但新 writer 不再生成；无 StepResult 的 skip/blocked case → 0 failure route；
10. v1 `1 failed + 5 blocked/prior_step + 1 skipped/policy` → 仅 1 条 failure route；
11. `failed/failure.domain=capability` → 1 条 failed route，其 disposition=capability defer、0 coding；
12. `blocked/cause.type=capability` 根 step → 0 failure route + 1 capability defer，后续 prior_step 不重复；
13. `blocked/cause.type=infrastructure` 根 step → 0 failure route + 1 external/toolchain disposition；
14. blocked 携带 failure、未知 cause.type、cause variant 串字段 → Schema FAIL，不能进入 routing；
15. wrong-screen 首个 `failed/assertion.mismatch`、同 case 无较小 passed action → 1 条 testing route、0 coding；
16. 同 case action outcome passed 后 assertion mismatch → 可形成 1 条 coding candidate；
17. 两个实际 `outcome.status=failed` step → 2 条 route，证明没有粗暴 first-only 去重；
18. device-session 内 selector/assertion 根失败有 screenshot/ui_dump/visible-elements artifact；capture unavailable 不伪造且 evidence incomplete；
19. `0.4-p0 + hylyre.step-outcome/1` fixture 贯穿 normal/report-only，全 required gates 实际运行；
20. v1 trace 进入 legacy-only adapter、未知/未来 schema 进入正式入口 → 显式 unsupported/BLOCKER，禁止 `[]`、SKIP、中文 status/telemetry/log fallback。
21. optional no-VLM → `skipped/reason=expected_check.unavailable_no_vlm` + probe facts；required no-VLM → `blocked/cause=capability`；checked_vlm 因前序 action 失败 → prior_step；
22. 空 case/无可执行 step在 plan 边界 contract reject，不生成空 CaseResult/skipped；设备中途死亡按当前 failed、同 case 后缀 prior_step、后续 case root infrastructure 分型；
23. action 已 dispatch 但 `performed=false` 可与 failed/selector 合法组合，blocked 不得伪造 action observation；
24. unresolvable 必带 namespaced reason 与 dump/resolver/fragment facts，candidate 不可计算时为 null；
25. Schema 负责 variant 局部形状，verifier 复算 prior_step 根引用、CaseResult 与投影；旧 non-passed→failure 规则已删除；
26. builder/Schema/reducer fixture 全量，real plan/fake/steps-file 关键 conformance；atomic/MCP/session 各一 smoke，不跑全入口×全场景笛卡尔积。
27. empty/invalid plan → stdout 单一合法 pre-run reject JSON、exit=2、零设备调用且不创建/改写 trace/report；Maison 归 testing/plan contract。envelope 缺失/非法负例才进入无 trace crash 兜底；stderr 文本不参与分型，不要求错误聚合；
28. failure-boundary capture 只发生在真实 selector/assertion 根失败且每根最多一组；passed、blocked、skipped 与普通 step 不因本需求新增强制截图。

### T6 宿主/维护者身份隔离与 runtime hash 退场

- 本批只在独立 framework identity/boundary OpenSpec change strict 通过后实施；不得把删除旧机制的契约混进 testing change。
- 删除 harness 普通 phase 的 per-file `framework_integrity` hash 读取与 scoped Git dirty/HEAD 身份读取；移除 manifest sidecar selfcheck、独立 foreign-file、tmp integrity subtype、drift allowlist 与 goal 六 subtype恢复矩阵。新运行不产 `framework_integrity`/`framework_control_plane_dirty`；发布/Updater 侧 package verification 保留且不进入 phase checks。
- `docs/vendor/**` 作为开发交接材料移出 consumer 发布件；不是通过运行时 ignore 绕过。
- 更新 host agent templates/边界文档：普通 host task 的 framework 控制面必须由 task sandbox/read-only mount/受限 OS token 物理只读；runtime policy 目录继续可写。
- 定义 updater 为用户/CI 显式启动的既有集成操作；普通 host agent 不持有 updater 写 capability，不能通过 env/config 自提权。
- Windows 强隔离验收必须使用不同安全主体或 restricted token；同一用户无隔离时明确降级，不假报安全。验收按环境条件分支：有强隔离环境才要求 OS/sandbox deny，本机同用户只要求编辑工具守卫与盲区文档证据。
- 降级模式只保留现有 write guard：runtime write-allow path 继续可写，控制面编辑工具写入继续拒绝；明确 shell/脚本/场外进程盲区，不新增 detector、subtype、allowlist、hash、Git baseline 或 bypass。
- package identity 复用 manifest/sidecar 单一读取链；visual-feedback 不读宿主 HEAD、不二次哈希 sidecar；相同发布件在 dirty/staged/committed/untracked/非 Git 五种环境逐字段相同。

验收：强隔离分支中 host task 写控制面被 OS/sandbox 拒绝、Updater 可原子升级后恢复只读、runtime 仍可写；降级分支中编辑工具守卫有效且盲区被诚实声明；旧 HEAD 上覆盖完整新发布件产生 M/D/?? 且不提交时 init/catalog 正常；普通 phase 无 framework Git 子进程、无 manifest/selfcheck/foreign/hash/dirty 结果。

### T7a Phase 0 契约冻结与 Maison fixture 迁移

- 外部需求以 `docs/vendor/hylyre-0.5.0-执行观测与结果反馈协议重构需求.md` 为准，不再实施已撤销的 0.4.2 flat-field patch，也不存在 0.4.1 新语义中间消费期。
- Hylyre 在生产实现前交付并冻结：`output-schema.json` 0.4-p0、`step-outcome-v1.md`、规范性 builder 判定表、合法/非法 golden fixtures 与 `bc-openCard-1` 代表性 ledger。Phase 0 不安装宿主、不作为运行证据。
- 冻结四态 oneOf、failure/cause/reason type+namespaced code、capability/infrastructure probe facts、optional/required VLM、空 case、设备中途死亡、`performed=false+failed`、prior_step 根引用、selector unresolvable facts、tool_calls 映射及 Schema/builder/reducer/verifier 分工。
- `output-schema.json` 同时冻结 `pre_run_reject` definition：stdout 单一 JSON、exit=2、结构化 contract rejection、零设备调用且不创建/改写 trace/report；Maison result dispatcher 先识别该 envelope，缺失/非法才进入无 trace crash 兜底。四个 code 面明确为 failure/cause/reason/resolution，不遗漏 `resolution.reason_code`；不为 reject 新增错误聚合状态。
- Maison 直接消费同一 Schema/fixtures 建 schema dispatch/typed view；清点所有生产 `0.3-p0` 守卫，覆盖 `device-test-run`、`device-test-evidence`、`device-test-timings`、`check-testing`、selector/failure/P0/runtime-evidence/trace-outcome helpers。
- routing、selector、CaseResult、timing、normal/report-only required gates 全部先对 Phase 0 fixture 跑通；不得另抄同义 fixture、固化 flat 临时 reader、因 schema 不匹配静默 `[]`/SKIP 或回退中文 status/telemetry/log/tool_calls。
- Maison 既有“子进程崩溃且无 trace”的 stdout/stderr 分类器保留，它不读取/伪造 v1，不属于 flat-field 清理范围。

### T7b Hylyre 0.5.0 真实 source 集成

- 交付条件：source manifest/version/tree 一致；正式输出声明 `result_protocol=hylyre.step-outcome/1`；trace schema=`0.4-p0`；真实 builder/Schema/reducer/verifier 对 Phase 0 fixtures 全部 conformance。
- native/resolver/fake/plan/steps-file/CLI/MCP/session 必须共用单一瞬态 OperationOutcome→StepResult builder；禁止 fake 手拼、batch fallback 猜测、assertion None 默认通过、legacy status 反推新协议。
- real plan、fake、steps-file/batch 跑完整关键 conformance；atomic CLI、MCP、session 各跑至少一条 smoke，不做每入口×全场景笛卡尔积。
- 用真实 CLI 复验 empty/invalid pre-run reject 的 stdout/exit/零设备/零 trace-report，并以缺失/坏 envelope 负例确认 Maison crash fallback 的边界。
- CaseResult/Run outcome 只从 v1 reduce；verifier 复算 prior_step/三轴/投影，并删除旧 non-passed→failure 规则。legacy 只明确隔离/unsupported-for-evidence，不要求 0.3 迁移工具或完整读取兼容。
- failure/cause/reason、selector request/resolution 与 failure-boundary artifact 使用真实 source 复验；unresolvable 必带 reason/facts，请求 ID 不得冒充 selected。
- failure-boundary artifact 限于真实 selector/assertion 根失败、每根最多一组；不得外溢到每步截图、成功路径取证或 blocked/skipped 重复采集。
- Maison 换接真实 source，将最低版本/trace 门提升到 0.5.0/0.4-p0；0.3 只可选诊断且不能闭合 evidence，未知 schema BLOCKER。selector resolution、cause facts、disabled/no-VLM/checked_vlm-blocked 与 report-only 全链通过后才允许进入 T8。

### T8 宿主回灌与收口

- **宿主动作（用户触发）**：bc-openCard-1 顶层 30 条先由宿主测试计划作者明确并 review `execution_channel`；这是 consumer `test-plan.md` 变更，不由 Maison plan 实施 agent 擅自修改。指引必须明示：任一 TC 标为 `manual` 都会让本 feature 的 testing 保持 FAIL/UNVERIFIED，无法 PASS，这是已冻结设计而非执行器 bug。hylyre 通道必须完整包含入口 producer，不得因 ui-spec WARN 改成 skip，不得临时关 cold restart、人工预导航或使用坐标绕过。
- 新 timestamp 计划按旧版已验证顺序真实进入 card pack/add-card/collapsed/expanded/all-banks；任一 hylyre case 编译失败则不启动设备。
- 真实验收：至少一条 action 与一条 presence assertion 有
  `selector.resolution.state=unique,candidate_count=1,selected.id=实际 canonical target`——该项验收
  **限定为 `by_id` 断言**（`by_text` 在 native 路径上合法为 `passed+not_attempted`，不得据此判失败，
  也不得用它冒充身份证明）；resolver 解析文本节点时 `selected.id=null`+`bounds` 非空同样合法。
  一条 forbidden absence 必须是
  `resolution.state=not_found,candidate_count=0,selected=null`；TC-015 精确执行到
  `more_mini_logo_psbc`。selector/assertion 根失败必须带 failure-boundary screen artifact；failed route
  基数等于实际 failed step，blocked capability/infrastructure 分别投一个 defer/external disposition，
  prior_step 不放大。
- 对同一 run 执行 report-only；trace 字节不变、零设备调用。
- 收口报告分为 selector/runtime identity、execution_channel/coverage、Step Outcome/failure routing、Hylyre 0.5.0、framework identity/release boundary 五栏，各栏独立列证据与 PASS/FAIL；testing 业务 FAIL 不抹掉身份/打包机制证据，强隔离环境缺席也不否决诚实的降级分支。总体 plan 仍需所有适用栏完成，不用一个总 verdict 互相连坐。
- 更新原 plan/OpenSpec 状态时按 todo 事实逐项完成，不因宿主业务 verdict=FAIL 把已交付机制长期留 `in_progress`。

---

## 四、验收场景

1. **静态未知不误杀**：`card_category_row_c1` 不在 feature ui-spec 时给 WARN，仍可进入 runtime；真机按 Phase 0 §6.1 的合法形态（`by_id` 的 unique/1/实际 selected，或 native `by_text` 的 passed+not_attempted）通过。
2. **确定错误仍前置拒绝**：非法 match、ui-spec 已知多映射无消歧、富文本聚合父 target 继续 BLOCKER；acceptance 冲突只认同一 checkpoint 结构化绑定 action 的 `target_element_id != by_id`，散文不判。
3. **派生器无 skip 权且 setup 先行**：channel=hylyre 的任一入口不能编译，或首 assertion 前无同 case action，整份计划不运行；产物不得新增 `explicit_skip_tc_ids`。
4. **执行通道有去向且不能洗绿**：visual 只凭已完成的 per-TC 机器证据；manual 无 PASS writer、任一
   manual TC 都使 feature testing 继续 FAIL/UNVERIFIED；provider 在 `e7cecd22` 实现前继续
   fail-closed；P0 runtime 义务不因改 channel 消失。
5. **通道精确对账**：derived/trace/timing 仅与 `channel=hylyre` 集合精确闭合；非 Hylyre TC 由各通道对账并保留总分母，report-only 不误报 trace missing。
6. **首失败不膨胀**：一个 v1 root failed 后 5 blocked/prior_step + 1 skipped/policy，只产生一个 responsibility route；无 StepResult 的 legacy skip/blocked case 产生 0 route。
7. **capability/external 有生产者**：failed capability 的唯一 route 投 capability defer；blocked/capability 产生 0 route + 1 defer；blocked/infrastructure 产生 0 route + 1 external disposition；prior_step 不重复。
8. **wrong-screen 不假投 coding**：同 case 无较小 `action outcome=passed` 的首 assertion mismatch 留 testing、零 coding；具备该前置事实才允许 coding candidate。
9. **expected policy 非 capability**：`disabled_by_flag/empty` 的 expected_check skipped/policy 不产生 capability defer。
10. **Outcome 非法组合不可表达**：四种 outcome 由 oneOf 约束；`cause.type` 仅
    `prior_step|capability|infrastructure`，blocked 禁 failure、skipped 禁 failure，未知 type/串字段 schema FAIL。
11. **selector 与失败现场真实**：presence/absence/action 按 failure domain/code 对称；resolution 状态机守
    not_found=0/null、unique=1/(id 或 bounds 非空)、ambiguous=N/null、not_attempted=null/null；
    `not_attempted` 不改判 outcome 也不给 identity credit；device-session 内 selector/assertion 根失败附
    screenshot/ui_dump/visible-elements artifact，不能只靠 diagnostic 自证。
12. **schema 切换不 fail-open**：`0.4-p0 + result_protocol v1` 的 normal/report-only 全 required gates 实际运行；0.3 只读诊断；v1 进入 legacy-only adapter或未知 schema 必须显式 BLOCKER，不能 `[]`/SKIP/legacy fallback。
13. **强身份隔离（条件验收）**：仅在有 restricted token/ACL/只读挂载时，证明 host consumer task 对 framework 控制面物理只读、Maison maintainer/updater 才可写，且 host agent 无法通过 config/env 自提权。
14. **降级诚实（同用户环境验收）**：只保留合作式编辑工具 guard，明确 shell/脚本/场外进程盲区；不记录 tree/ref baseline，不新增 Git/hash detector。
15. **运行时 Git/hash 退场**：普通 phase 不读取/重算 per-file manifest、不读取 framework scope Git status/HEAD，不再输出 `framework_integrity`、dirty/selfcheck/foreign/tmp/subtype 家族；发布/集成仍校验包一次，package identity 非阻断。
16. **发布边界正确**：`docs/vendor/**` 不进入 consumer 包；runtime policy 目录在只读控制面下仍可正常写。
17. **独立收口**：testing/Hylyre 与 framework identity/release boundary 分栏裁决、各自 OpenSpec change 验收，不因业务 FAIL 互相抹除证据。
18. **原链不回归**：legacy 不洗白、native 优先、report-only、singleton 去重全部保持；定向测试、`npm test`、typecheck、OpenSpec strict、plan-version、diff/LF 全绿。

---

## 五、边界与不做

- 不新增 app-level selector registry、navigation sidecar、setup manifest 或屏幕状态机；不做 ui-spec/acceptance/contracts 白名单并集。
- acceptance/contracts 通常只用于静态 WARN 的解释与责任提示，不授权 PASS；唯一 BLOCKER 例外是同一 checkpoint 已结构化绑定 action 后 `target_element_id` 与计划 `by_id` 明确不等，不解析散文抽取 ID。
- 不把 dump/cache、源码字符串搜索或一次历史真机命中升级为静态 canonical 真值；当前 run 的 StepResult 才是执行真值。
- 不允许派生器按字符/能力猜 execution_channel，也不允许编译失败自动改 skip。
- 不为 manual channel 新建人工证据提交、`confirmed_by`、quality receipt 或 resume 放行；它在本期就是不能关闭质量门的显式义务。
- 不为快速回灌关闭 cold restart、人工预导航、坐标点击或手改旧 timestamp 计划。
- 不让 Maison重解释 Hylyre taxonomy，不从 `error/notes` 猜 assertion/selector。
- 不新增第二套持久化 ledger，也不由 Maison 自建平行 status/failure taxonomy；唯一结果协议以
  Hylyre 0.5.0 `outcome/failure/cause/reason`、namespaced code 与 Schema oneOf 为准。blocked
  禁止 failure、skipped 禁止 failure；Maison 只做既定 responsibility/disposition 投影。
- 不在每个 consumer helper 散落 schema 猜测或“未知即不适用”；版本分派只在统一 parse boundary，
  required gate 对未知 schema 一律 fail-closed。
- 不新增 semantic hash、normalized-text hash、consumer sidecar、签名字段、身份 env/config、外部 trust DB 或 drift allowlist；普通 phase 不保留 runtime hash 核心。
- 不用 Git tree/ref install baseline、HEAD tree 对比或 Git dirty 替代已否决的 runtime hash；宿主 Git 状态与 Maison 无关。
- 不用事后 detector 冒充强身份隔离；同一用户环境只保留合作式编辑守卫并承认盲区。
- 不把 `selected.bounds` 非空设成所有 native selector 成功的硬条件，也**不把
  `unique/1/selected.id` 当成所有 selector 成功的统一硬条件**——Phase 0 §6.1 明确 native 路径上
  身份不可见时合法产生 `passed+not_attempted`。硬条件是：成败读 `outcome`；`unique` 必须
  candidate_count=1 且 `selected.id`/`bounds` 至少一个非空且禁 request 回填；`not_attempted`
  不给 identity credit。不按 `request.kind` 写固定旁路。
- 不把 framework identity/boundary delta 塞进 testing OpenSpec change；两个领域各自 strict/验收/archive。
- 不发布或集成 Hylyre/Maison 中间运行版本；Phase 0 只是冻结契约与 fixtures，不进入宿主、不能作为完成证据。
- 不为 0.3-p0/0.2 建 evidence 迁移工具或承诺完整读取兼容；只做显式隔离/可选诊断。
- 不做 atomic/MCP/session × 全场景笛卡尔积；完整语义矩阵集中在 builder/Schema/reducer，非关键入口每入口一条 smoke。
- 不为“Hylyre 进程未产 trace 即意外崩溃”新增持久化协议；保留现有 subprocess 分类器且禁止它伪造 v1。可预期的 pre-run plan reject 按 T7a stdout envelope 处理，不属于 crash。
- 不处理 NFR 计时/FPS/内存 provider，也不处理历史 p0-skip t7 run。

---

## 六、验证与交付顺序

```text
T1 testing change + 独立 framework identity/boundary change，各自 strict
├─ testing 前置：T2 selector → T3 channel/setup
├─ framework lane：T6 强隔离或诚实守卫降级 + runtime Git/hash 退场
└─ vendor Phase 0：冻结 Schema/协议/builder 表/golden fixtures
   ├─ Hylyre 并行实现 0.5.0（Phase 1）
   └─ Maison T7a typed consumer + T4 routing/cause disposition + fixture 全链
→ T7b 真实 source 集成：关键入口 conformance + 非关键入口 smoke
→ T5 定向/全链回归
   （不产生中间运行版本；final production 不得先固化 0.3 flat 字段再二次改形；
    selector resolution、schema fail-closed、cause/reason facts 与真实 source 未通过时禁止进入 T8）
→ T8 用户触发宿主新 timestamp 回灌 + report-only
→ 五个子系统分栏收口，原 plan/change 状态按各自事实更新
```

验证遵守比例原则：纯文档/状态修订不重复全测；testing 与 framework 两条生产逻辑分别跑其定向/typecheck，合并候选后只跑一次最终全量；宿主只在 T7b 的真实 Step Outcome + selector resolution 硬依赖全部通过并集成新候选字节后跑一次完整 device testing，不用每个小改重复真机。强隔离证据只在环境具备时采，当前同用户 Windows 不因此阻塞降级栏收口。
