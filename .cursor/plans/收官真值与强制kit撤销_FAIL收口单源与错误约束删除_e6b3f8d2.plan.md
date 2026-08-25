---
name: 收官真值与强制 kit 撤销 — 完成≠通过、错误约束删除与活性真值
version: 3.0.0
todos:
  - id: t1-turn-closure-truth
    content: "P0 · Codex --json terminal 收口。`agents/codex/adapter.yaml`：声明 `output_delivery: streaming`、`usage_capture: stdout_json`（fromStdoutJson 已读 turn.completed.usage，usage-capture.ts:89-99，不新增枚举）；**`tool_event_provenance` 保持 `none`**——该字段是「工具调用证据可审计」能力（图片读取事件入册制，docs/operations/adapter-tool-event-provenance.md、critic-receipt-producer.ts:14-18 注册表仅 claude/codeagent），Codex stdout 有 terminal JSONL ≠ 工具调用可审计，不得混同，也**不新增 `terminal_event_provenance` 字段**（仅 Codex 需要，adapter 专属 argv+parser 足够）。`--json` 由 codexArgv 独立追加（不借工具证据字段触发）；terminal parser 由 Codex adapter 启用、**直接消费 stdout chunk**（跨 chunk 行缓冲，不要求产出 agent-events.jsonl）：`turn.completed` → 设 `completionObserved` 进既有 grace/kill（R8 互斥原语复用，agent-invoke.ts:1289-1321）；`turn.failed` → 设内部 `terminalFailureObserved` 布尔事实，可走同一 settle/grace 收纳，`completionObserved` 恒 false，最终 `exitCode===0` 时规范化非零（复用 :1351 timedOut/silentKilled 同款，保住 goal-runner-phase.ts:151 agentFailed 语义）；**其余事件含顶层 `error` 一律只记 `agent_invoke_end` 诊断 excerpt**——不设 completionObserved、不触发 settle、**不进入 api_disconnected/failure classifier/retry 判据**（error 非契约终态，error→重试成功→turn.completed 是合法序列；codex 的 `parseHeadlessApiError` 保持现状 null，拿到真实断流终局 fixture 能区分中间重试与最终断流后另行接入）。文档明确：Codex `--json` 本轮只提供 terminal/usage 事实，不提升图片或工具调用证明力。agent-output.log 继续保存原始 JSONL（内容级消费者闭合三处已判定：interaction sentinel 系 chrys 专用不适用；API sentinel 文本锚定对 codex 本就未实测、保持不适用；critic outputHash 与 output bytes 内容无关）。fixture：turn.completed、turn.failed、半行分块、probe 竞争、**error→后续 turn.completed 不提前杀进程**；回归：codex argv 含 `--json` 但 capability `tool_event_provenance` 仍为 none、且不尝试签发 verified critic receipt。同批删除 silent watchdog 生产链（agent-invoke.ts:61-62、:1268-1280 写侧，读侧容忍历史字段）；并入探针文档归位：phase-completion-probe.ts 自述改「PASS 形态闭环证据加速器；evidence 条件（:188）与 invocation 绑定（:267）两问分立」，OpenSpec 同步；FAIL 收口责任明示：有 terminal 契约的 adapter 由本条承接，无契约 adapter 依赖自然退出+hard timeout，不用无效回执冒充信号。"
    status: completed
  - id: t3-revoke-mandatory-ui-kit
    content: "P0 · 撤销强制 Maison UI kit——删除错误约束，复用既有宿主组件契约链。本次宿主死锁重新归因：不是 plan 少了一道 kit 门禁，而是 framework 把具体 Maison 组件错误升级成了强制产品契约（并经 `paths.ui_kit_target_dir` 四级解析要求宿主指定 vendoring 落点，harness/config.ts:341、ui-kit-scaffolder.ts:50-94）——删除错误约束比在 plan 阶段提前满足错误约束更简单。**①删除源码 vendoring**：`profiles/hmos-app/ui-kit/**`（模板+blocks.json）、`ui-kit-scaffolder.ts`、`ui-kit-conformance-check.ts`、`ui-kit-anchors.ts`、对应单测、`harness/package.json` 的 `ui-kit:scaffold`。**②删除目标目录机制**：`FrameworkPaths.ui_kit_target_dir`、四级 resolver、配置/Skill/文档/报错中的相关说明；不用 contracts 推导新 target——无 scaffold 后不再需要 target 概念。**③删除 Maison 专属契约（含 anchor/selector 链的明确删除语义，非中性化保存）**：`UiSpecComponentNode.block` 与 JSON schema 的 `block` 字段、`BLOCK_SEMANTIC_NODES`、Maison component/file/anchor/hash 契约、`ui_kit_*` check id、blocking class `ui_kit_conformance`、quality-axes 'ui_kit_' 前缀映射（quality-axes.ts:103）；`selector-contract` 不再读 `blocks.json`（:56-58）、不再生成 `maison:` canonical anchor 与 suffix contract，selector 查询回归普通 ui-spec node.id/text；`device-test-evidence` 删除 `maison:` 特殊解析的**全部三处**分支（:280 的 normalizeRuntimeAnchor 节点匹配、:302-306、:500 的第二个 startsWith('maison:')）及对 ui-kit-anchors 的 import（:21），只消费既有 bare ID/text；同步更新 `derive-hylyre-plan-hint` payload 与相关 unit/fixture；**不把 ui-kit-anchors.ts 改名搬成「通用 anchor」文件，不保留第二套锚点机制**；存量带 `maison:` selector 的业务产物在 MIGRATION 说明需重新生成（新宿主 smoke 已规定新 run，正好覆盖）。**页面身份判据迁移（maison: 的第二职责，独立于 kit）**：visual-diff-capture 现由 `maison:<feature>:` 推导应用页面组件前缀（appComponentIdPrefixes，:840-844）并借它区分「应用错页 mismatched」与锁屏/桌面等系统态（:932-938）——删除后页面身份直接复用既有 `visual-diff-nav` screen identity 声明为 SSOT：只收集各屏 `all_of`/`any_of` 的**正向 ID**、按**精确 ID** 判应用页面在场（**不得使用 none_of**——:929-931 已证伪其所有权证明力；不新增前缀/注册表/anchor 文件）；三态语义：目标屏正向 ID 命中 → `matched`；目标未命中但其他已声明屏正向 ID 命中 → `mismatched`；仅 text/route 或系统树无任何已声明 ID → `probe_failed`——不得把视觉错页从确定性 mismatched 降级成普遍 probe_failed。**`scaffold_contract_drift` 完整删除**：共享类型、device-test-evidence（:523）、goal-runner 的 actionable 分类（:2190，其现行为仍会要求产品注入已撤销的 canonical anchor）、回修文案与测试全链清除。引用面按 active tree 零残留门槛收口（见 t7），**不写死文件计数**；已知面含 goal-reconcile-observation、visual-debt、spec-ui-spec-check、visual-diff-check、coding-visual-parity-check、device-test-evidence、asset-integrity 的 kit 兜底文案（:248）、device attribution fixture README、golden visual-debt.json 的 `ui_kit_runtime_conformance`；独立的素材占位入口由 `ui-kit:placeholders` 改名 `asset:placeholders`（asset-placeholder-cli 能力保留、与 kit 解耦）；归档 OpenSpec/历史 plan 不回写。**④保留通用结构语义**：`nav_bar`/`list_row`/`sheet_scaffold` 等继续作为普通 `type` 语义词，不绑定 Maison 实现。**⑤复用既有链路并收紧「产品所有权子集」为硬地板**：ui-spec P0 node → visual-parity.contract_component → contracts.components → contracts.files → 既有源码结构匹配与 runtime visual/layout 检查。现状该链**不是**硬地板（宿主默认 `coding.visual_parity_enforcement=warn`，config-defaults.json:65；warn/reachable 下结构问题只产 MAJOR/WARN，ui-spec-shared.ts:286-292；off 在映射检查前 SKIP，plan-visual-parity-check.ts:52-56；contracts.components 为空反而跳过存在性检查，:161-166；且无 components[].file ∈ contracts.files 校验）——在既有 `visual_parity_coverage` 内收紧三项 ownership/traceability，**不受 enforcement=warn|reachable|off 降级**：UI feature 的 P0 节点必须有 `contract_component`；对应组件必须真实存在于 `contracts.components`（数组为空也判失败）；组件 `file` 必须存在于 `contracts.files`。assets/tokens/结构相似度等视觉质量项继续遵守原 enforcement。**不新增 check id/状态/classifier、不新增通用 kit classifier、不新增 anchor 体系**。盲档视觉地板语义由该既有覆盖链承接（接受精度差异，在 blind-visual-hardening 修订中如实记录）。**⑥OpenSpec 按职责修订在研 change**（blind-visual-hardening 未归档、55/57，blind-ui-kit 是其新增 capability——base specs 从未接纳过它）：撤回 `blind-ui-kit` capability、删除其 spec、tasks 5.x 删除/标记撤回、清理 proposal/design/artifact layout/MIGRATION/replay runbook 中的 kit 内容、P1-G/M4 不再要求 Maison 三段闭环；**不在 e6 的新 change 里叠一份 kit 删除 delta**。门禁贡献契约保留一句纪律：suggestion 不得指令越出该阶段 SKILL 权限的动作，且给出的入口必须可执行。"
    status: completed
  - id: t4-liveness-output-stall
    content: "P1 · 活性分离工作面与控制面，观测不干预。现状 activityTypes 含 runner 自写 heartbeat（goal-progress.ts:600-601）恒 ACTIVE，outputSignal='unchanged'（:699-704）只进 signals。修复：存在未闭合 invoke、outputSignal='unchanged'、且**该 run events 的 `adapter_probe.output_delivery`**（缺失即 unknown，历史 run 不被现行 adapter.yaml 重释）为 'streaming' 时，state 降既有枚举 `SUSPECTED_STALL`；查进度补「agent 输出已停滞 X 分钟」，X=now−agentOutputMtime（不得用含 heartbeat 的 seconds_since_activity）。unknown/buffered 不降级。不触发 kill/恢复，不新增枚举或第二 reducer。"
    status: completed
  - id: t5-timeout-prompt-honesty
    content: "P1 · 超时不得遮蔽新鲜质量事实。events 两轴本就正交（i3 verdict 同带 timed_out 与 failure_kind），失真仅在 retry prompt 组装硬写「Prior attempt TIMED OUT — NOT a content failure」（goal-runner.ts:3160、:3261）。修复：同 invoke 存在新鲜 harness FAIL 时两轴并陈，删除无条件断言；纯超时保持既有文案。只改话术层。"
    status: completed
  - id: t7-regression-openspec-smoke
    content: "回归、契约与收口（验收可复现）。OpenSpec 两条线：①修订在研 blind-visual-hardening（kit 撤回，见 t3⑥）；②e6 新 change 只承载 goal-runner terminal 收口 + codex adapter（--json/output_delivery/usage）+ liveness + timeout prompt——不把 kit 删除与 goal terminal 包装成新大 capability。回归：terminal parser 真实 fixture（completed/failed/半行/probe 竞争/error→completed 不早杀）；turn.failed+exit 0 规范化非零且 agentFailed 保留；codex argv 含 --json 但 tool_event_provenance=none 且不签发 verified critic receipt；无 `ui_kit_target_dir` 配置正常运行；不再产生任何 `ui_kit_*` check；盲档 P0 节点映射到宿主产品组件时 plan/coding 正常通过；**所有权子集硬地板五态回归**：默认 `warn` 下 P0 缺 `contract_component` 仍 BLOCKER、显式 `off` 下同样 BLOCKER、`contracts.components` 为空判失败、组件 file 未进 `contracts.files` 判失败、完整映射 PASS；selector 回归 bare ID/text 后 device-test-evidence 与 derive-hylyre-plan-hint 单测/fixture 全绿；**页面身份三态回归**（目标屏正向 ID 命中=matched / 他屏正向 ID 命中=mismatched / 仅 text/route 或无声明 ID=probe_failed，确保删 kit 不顺带删应用所有权判据）；**精确删除门槛**（替代不可执行的裸 `maison` 全匹配——`agentmaison://`、`~/.maison/`、`MaisonDeviceUnlock`/`MaisonGuardian`、`maison:placeholder` 均为合法命名空间）：断言被删文件/目录不存在；token 级搜索 `ui_kit_target_dir`、`maison_ui_kit`、`ui-kit:scaffold`、旧 `ui-kit:placeholders`、`blind-ui-kit`、`ui-kit-anchors`、九个 Maison 组件名、`scaffold_contract_drift`、旧 canonical-anchor 格式与解析代码零命中；`blocks.json` 只查原 kit 精确路径不禁通用文件名；范围排除 `openspec/changes/archive/**` 与历史 plans，不依赖人工文件计数；prompt 两轴并陈；liveness fake clock 单测 + unknown/buffered 豁免 + adapter_probe 读源断言；watchdog 删除读侧兼容。全量 `cd harness && npm test` + `npm run openspec:validate`。宿主 smoke（新 run_id，不 resume halt 旧 run，不执行 scaffold）：验证既有 CommUI/feature 产品组件映射可闭环；宿主不生成 `maison_ui_kit` 文件；新 run 不再出现 `ui_kit_not_materialized`/`ui_scope_violation` 双输；coding FAIL 分钟级收口用受控 fixture/E2E（不赌真实模型 FAIL）；真实 codex smoke 验 turn.completed/usage 非 null/宿主 argv，failed 分流用真实捕获 fixture。**诚实边界：本轮消除的是 ~60 分钟收口空等与错误 kit 重试，不承诺缩短 spec/plan/coding 单 turn 推理时长。** smoke 全过前两条 OpenSpec 线均不 archive。"
    status: pending
overview: >
  宿主 run 20260825T011950Z-eddfb2（Codex CLI，bc-openCard-1）09:20 起跑、12:11 halt 终局。
  两条独立根因：①盲档事故后引入的强制 Maison kit 把具体组件错误升级为产品契约，framework
  侵入宿主组件所有权（ui_kit_target_dir 四级解析要宿主指定 vendoring 落点）——spec 强制声明
  64 个 kit block，而 plan/contracts/coding 权限结构上不可满足，coding 陷入「不 scaffold →
  未物化、scaffold → 越界」双输，3 次重试烧尽 halt；②FAIL turn 无收口信号（探针只识别 PASS
  闭环证据、codex 长 turn 退出不可靠、watchdog 禁用），空等 90min 硬超时 ≈60min 纯浪费，期间
  活性恒报 ACTIVE、retry prompt 还宣称「NOT a content failure」。本 plan：删除错误 kit 约束
  （复用既有 visual-parity + contracts 产品组件链，修订在研 blind-visual-hardening OpenSpec），
  并修复独立存在的 terminal/liveness/话术缺口（codex --json 两终态收口、tool_event_provenance
  保持 none、error 仅诊断、活性分离工作面）。详细契约见各 todo（唯一实施载体）。
isProject: false
---

# 收官真值与强制 kit 撤销：完成≠通过、错误约束删除与活性真值（e6b3f8d2）

状态：**v7 定稿（六轮评审通过，2026-08-25），待开工**

## 1. 因果链（run 20260825T011950Z-eddfb2 终局复盘，已按新归因改写）

```text
盲档事故后引入强制 Maison kit（blind-visual-hardening，未归档在研 change）
  → framework 侵入宿主产品组件所有权：
     spec 强制声明 64 个 kit block · ui_kit_target_dir 要宿主指定 vendoring 落点
  → plan/contracts/coding 权限结构上不可满足：
     plan 冻结 contracts 不含 kit（也无门禁要求含）· coding 只读 contracts
     → 不 scaffold → ui_kit_not_materialized；scaffold → ui_scope_violation（双输）
  → 重试与超时机制放大问题：
     coding i3 10:58 打完终稿自证 FAIL，但收口信号全灭（探针只识别 PASS 闭环证据、
     codex 长 turn 退出不可靠、watchdog 禁用）→ 空等 90min 硬超时
     kit 缺口无归属路由 → agent_fixable → i4/i5 误重试 → halt（12:11），全程未回退 plan
     期间活性恒 ACTIVE（heartbeat 计入 activity）· retry prompt 宣称「NOT a content failure」
     i5 还撞出 scaffold 官方入口 tsconfig 采用缺陷——强制机制连自带工具都不可执行
  → 本轮处置：删除错误约束（kit 撤销，复用既有产品组件契约链）
     + 修复独立存在的 terminal / liveness / 话术缺口
```

修复原则：**一个问题一个权威；错误的权威直接删除，不为它修配套。**「turn 结束」归 invoke 层且成功/失败分流（completed 才是完成，failed 保失败语义，error 只是诊断）；「能否推进」唯一归 gate；产品组件归属唯一归宿主（ui-spec→visual-parity→contracts 既有链），framework 不得指定宿主源码形态；transport/quality 两轴正交；没有真实信号的路径诚实接受 timeout 兜底，不造假信号。

## 2. 已核实事实

| # | 事实 | 证据 |
|---|---|---|
| 1 | codex 自然退出不可依赖：spec/plan/i3 长 turn 全靠 kill，i4/i5 短 turn 自然 exit 0 | 宿主 events :43、:86、:186、:198/:214 |
| 2 | i3 于 02:58:52Z 打完终稿（tokens used 445,503 + 自证 FAIL/应回退 plan），此后输出 65 分钟零变化，空等至 90min 硬超时 | 11:50 实读 log 尾部；events :125-186 |
| 3 | 完成探针四条件含 receipt_status=passed+closure=closed；真实 FAIL 回执依设计恒为骨架（runner 每 invoke 前 force 写骨架、prompt 明令 FAIL 不得声称完成、宿主终局回执即骨架）——FAIL 收口只能走 adapter terminal 契约 | phase-completion-probe.ts:183-190；goal-runner.ts:6104-6114、:3141；宿主 phase-completion-receipt.md |
| 4 | `agentFailed = exitCode!==0 && completionObserved!==true`——terminal 吞并 failed 或 failed 后 exit 0 都会洗白失败；timedOut/silentKilled 已有 exit 0→1 规范化先例 | goal-runner-phase.ts:151-155；agent-invoke.ts:1351 |
| 5 | codex JSONL 契约：turn.completed/turn.failed 是 turn 终态，`error` 仅是事件、非保证终态（error→重试成功→completed 合法）；本机 `--json` 可用 | 官方非交互文档；本机 help |
| 6 | `tool_event_provenance` 是「工具调用证据可审计」能力（图片读取事件入册制），SSOT 明确 codex 暂 none 待实测；解析器注册表仅 claude/codeagent——Codex stdout 有 terminal JSONL ≠ 工具调用可审计 | docs/operations/adapter-tool-event-provenance.md（codex 行）；critic-receipt-producer.ts:14-18、:67-70 |
| 7 | codex 断流吐法未实测，`parseHeadlessApiError` 对 codex 现状即 null——error 事件不得供给 api_disconnected | goal-headless-sentinel.ts:209 |
| 8 | usage stdout_json 解析器已读 turn.completed.usage——无需新增枚举；本次 run usage 全 null、output_delivery=unknown（adapter 零声明） | usage-capture.ts:89-99；宿主 events :2、:43 |
| 9 | watchdog 默认 0 禁用、goal-runner 无 opt-in——从未生效的第二判死权威 | agent-invoke.ts:61-62；grep 为空 |
| 10 | **强制 kit 是未归档在研 change 引入的**：blind-visual-hardening 任务 55/57、`blind-ui-kit` 为其新增 capability——base specs 从未接纳，撤回在研 change 即可，无需「先加后删」 | openspec/changes/blind-visual-hardening/proposal.md:21、specs/blind-ui-kit/、tasks.md |
| 11 | `ui_kit_target_dir` 机制=framework 要求宿主指定 Maison vendoring 落点（显式配置→common 唯一推导→outer_layers→halt 四级解析）——侵入宿主源码形态决定权 | harness/config.ts:341；ui-kit-scaffolder.ts:7、:50-94 |
| 12 | kit 约束集对守规 agent 结构性不可满足：spec 强制声明 64 block（spec-ui-spec-check 强制）、contracts 冻结 21 项不含 kit、plan 门禁 0 处 kit 校验、coding 只读——不 scaffold→未物化、scaffold→越界双输（i4 实锤 9 个 ui_scope_violation，codex 复核观察） | 宿主 contracts.yaml、ui-spec.yaml；plan-visual-parity-check.ts grep；skills/feature/coding/SKILL.md:40-45；events :190/:202 |
| 13 | kit 缺口无机器归属（注册表仅 ui_scope_violation→plan）→ 缺省 agent_fixable → assess 连推 rerun coding → 3 次重试烧尽 halt（12:11），未回退 plan，总时长 ~2h51m | repair-candidates.ts:379-385；宿主 events :186-220 |
| 14 | scaffold 官方入口在宿主 Node v24 模块解析崩溃（harness 外入口未采用 CommonJS tsconfig）——强制机制自带工具不可执行，`agent_fixable` 双重失真 | 宿主 i5 终稿；评审复现（--project 后 dry-run 正常） |
| 15 | 既有承接链存在但**现状不是硬地板**：宿主默认 `coding.visual_parity_enforcement=warn`；warn/reachable 下结构问题只产 MAJOR/WARN；off 在映射检查前 SKIP；`contracts.components` 为空反而跳过存在性检查；无 components[].file ∈ contracts.files 校验——删 kit 后须在既有 `visual_parity_coverage` 内收紧不受降级的所有权子集（t3⑤） | config-defaults.json:65；ui-spec-shared.ts:286-292；plan-visual-parity-check.ts:52-56、:141-150、:161-166；visual-structure-parity.ts:126-130 |
| 16 | kit 引用面**跨出 conformance 链**，不得写死计数：device-test-evidence 直接 import ui-kit-anchors 并解析 `maison:` selector；selector-contract 直接读 blocks.json（derive-hylyre-plan-hint 与 testing 继续消费）；asset-integrity 文案以 kit 兜底；npm script `ui-kit:placeholders`（CLI 本体是独立素材占位能力）；device attribution fixture README、golden visual-debt.json 亦有残留 | device-test-evidence.ts:21、:302-306；selector-contract.ts:56-58；asset-integrity.ts:248；asset-placeholder-cli.ts:14 + harness/package.json:21；本轮 grep 盘面 |
| 17 | 超时不遮蔽 events 层 quality 轴（i3 verdict 同带 timed_out 与 failure_kind），失真仅在 retry prompt「NOT a content failure」断言 | 宿主 events :186/:190；goal-runner.ts:3160、:3261 |
| 18 | 活性把 runner 自写 heartbeat 计入 activityTypes 恒 ACTIVE；outputSignal='unchanged' 只进 signals 不进 state | goal-progress.ts:600-601、:699-715 |
| 19 | agent-output.log 每 invoke `flags:'w'` 覆盖（i4/i5 铲掉 i3 终稿）——invoke 级证据保全已另立项 | agent-invoke.ts:1176；任务卡 task_839076e3 |
| 20 | 三阶段单 turn 本身即重（spec 36min/17.4MB、plan 33min、coding 30min/445k tokens）——本 plan 不处理，诚实边界见 t7 | 宿主 events、log 尺寸 |
| 21 | `maison:` anchor 兼任**独立于 kit 的视觉页面身份判据**：visual-diff-capture 由 `maison:<feature>:` 推导应用页面组件前缀并据此分 mismatched/系统态（none_of 当所有权证明已被仓内证伪）；device-test-evidence 另有 :280/:500 两处 anchor 依赖未入 v6 清单；`scaffold_contract_drift` 贯穿 device evidence、goal-runner actionable 分类与共享类型 | visual-diff-capture.ts:840-844、:929-938；device-test-evidence.ts:280、:500、:523；goal-runner.ts:2190 |
| 22 | 裸 `maison` 匹配不可执行：`MaisonDeviceUnlock:<serial>` 凭据目标、`~/.maison/` 信任注册表、`agentmaison://` schema、`maison:placeholder` 素材能力均为须保留的合法命名空间 | device-credential-store.ts:101、:590-595；confirmation-receipt.ts:131；本轮 grep |

## 3. 明确裁剪

- **撤销而非修补强制 kit**：v4 的 blocks.json 注册表、共享 loader、`ui_kit_contract_gap` 路由、contracts ⊇ scaffolder 全输出集、scaffolder 双入口修复、enforcement=off kit 特判**全部取消**——机制连同其配套一起删除（t3）。
- **不新增 `terminal_event_provenance` 字段**（仅 codex 需要，adapter 专属 argv+parser 足够）；**tool_event_provenance 不因 --json 升格**（工具证据入册制不动）。
- **error 不进 api_disconnected/failure classifier/retry 判据**；codex `parseHeadlessApiError` 保持 null，待真实断流终局 fixture 再议。
- **撤回探针行为修改**（真实 FAIL 三条件不可达，事实 #3）；探针只做文档归位（并入 t1）。
- **不追 codex 进程钉住根因**；**无 terminal 契约 adapter 的 FAIL 不造假信号**，诚实接受 timeout 兜底。
- **invoke 级日志保全另立项**（任务卡已挂，事实 #19）；**不动文书面与单 turn 基线**（事实 #20）；**不改 90min timeout 数值**；**不改 3/30 预算语义**；**不新增 liveness 枚举或第二真源**；**不建 suggestion×SKILL 扫描器**。

## 4. 实施与提交边界

```text
OpenSpec 两条线（不合并、均待宿主 smoke 后 archive）
  A. 修订在研 blind-visual-hardening：撤回 blind-ui-kit capability + 删 spec + tasks 5.x 撤回
     + proposal/design/artifact-layout/MIGRATION/replay-runbook 清理 + P1-G/M4 去 Maison 闭环
  B. e6 新 change：goal-runner terminal 收口 + codex adapter（--json/output_delivery/usage）
     + liveness + timeout prompt

  → t1 P0：codex --json 两终态收口（tool_event_provenance 保持 none；error 仅诊断）
           + watchdog 删除 + 探针文档归位
  → t3 P0：撤销强制 Maison UI kit（vendoring/target-dir/专属契约三段删除 + 复用既有链 + OpenSpec A）
  → t4 P1：liveness 工作/控制面分离
  → t5 P1：超时 prompt 两轴并陈
  → t7：针对性回归 + 全量 harness + openspec:validate + 新宿主 run smoke（无 scaffold）
```

t1 与 t3 分别提交（invoke 层+adapter 契约 vs kit 删除+OpenSpec A）；t4/t5 各自小提交。实施阶段只允许更新 todo 状态与实施记录，不改写裁决。todo content 是唯一实施契约载体，其他节不复述实施细节。

## 5. 评审吸收纪要

**v1 → v2（codex 复核 + run 终局）**：收口信号改 `--json` 结构化事件（弃文本 marker）；kit 门禁扩为可实施性并补事实路由；修正「从不自然退出」「streamed」失真；新增超时话术、invoke 级日志；吸收 scaffold 宿主崩溃。

**v2 → v3（评审意见 2）**：terminal 成功/失败分流；撤回探针三条件行为修改（真实 FAIL 回执恒为骨架）；kit 权威逐项冻结载体；证据不可变原则；liveness 读源与计时口径；验收可复现化；usage 不加枚举。

**v3 → v4（评审意见 3）**：terminal 只认两个契约终态（error 降纯诊断、failed 补 exit 0 规范化）；T6 移出另立项；blocks.json 单源补 scaffolder 消费面；文档去重（t2 并入 t1，todo 定为唯一契约载体）。

**v4 → v5（评审意见 4，方向修正）**：①[P0] `tool_event_provenance` 保持 none——v4 把「stdout 有 terminal JSONL」误声明为「工具调用可审计」，会虚增 critic 证明力（SSOT 与注册表实证，事实 #6）；`--json` 由 codexArgv 独立追加，parser 直接吃 stdout chunk，不要求 agent-events.jsonl，补「argv 有 --json 但 capability=none 且不签发 verified receipt」回归。②[P0] t3 由「修好强制 kit」整体改为「撤销强制 kit」——用户裁决 `ui_kit_target_dir` 显式配置机制不合理，重新归因：不是 plan 少门禁，而是 framework 把 Maison 组件错误升级为强制产品契约（事实 #11/#12）；删除错误约束比提前满足它更简单，既有 visual-parity+contracts 链承接（事实 #15），v4 全部 kit 配套机制取消。③[P1] error 不供给 api_disconnected（error→重试成功→completed 合法序列会造成对成功 invocation 的误重试；codex 断流解析现状即 null，事实 #7）。④[P1] OpenSpec 修订在研 blind-visual-hardening（kit 从未进 base specs，撤回在研 change 而非叠删除 delta，事实 #10）；e6 新 change 只承载 terminal/adapter/liveness/prompt。⑤[P2] 标题、因果链、事实表、验收整体按「撤销」改写；smoke 去 scaffold、验证产品组件映射闭环；补诚实边界（本轮消除空等与误重试，不承诺缩短单 turn 推理时长）。

**v5 → v6（评审意见 5，删除路径三缺口）**：①[P0] v5 断言「P0 缺映射由既有 visual_parity_coverage 阻断」与生产事实不符——宿主默认 enforcement=warn 只出 MAJOR/WARN、off 提前 SKIP、components 空数组跳过存在性检查、无 file∈contracts.files 校验（事实 #15 改写）；t3⑤ 改为在既有 `visual_parity_coverage` 内收紧三项 ownership/traceability 硬地板（P0 有 contract_component、组件真实在 contracts.components 且空数组判失败、组件 file 在 contracts.files），不受 enforcement 降级，视觉质量项照旧；t7 补 warn/off/空数组/file 缺失/完整 PASS 五态回归。②[P0] 删除 ui-kit-anchors 会打断仍在运行的设备证据与 selector 链（device-test-evidence import + maison: 分支、selector-contract 读 blocks.json，事实 #16）；t3③ 冻结明确删除语义：selector 回归 bare ID/text、删 maison: 分支、更新 derive-hylyre-plan-hint 与 fixture、不建「通用 anchor」第二套机制、存量 maison: selector 走 MIGRATION 重新生成。③[P1] 删除盘面去掉写死的「10 文件」，补 asset-integrity 文案、`ui-kit:placeholders`→`asset:placeholders` 改名（能力保留、与 kit 解耦）、fixture README、golden visual-debt、device-test-evidence；t7 增 active tree 零残留门槛（排除 openspec 归档与历史 plans），归档不回写。

**v6 → v7（评审意见 6，删除边界二缺口）**：①[P0] `maison:` anchor 兼任独立于 kit 的**视觉页面身份判据**（事实 #21：visual-diff-capture 由 maison: 前缀分「应用错页 mismatched」与系统态；device-test-evidence 另有 :280/:500 两处依赖漏列；scaffold_contract_drift 贯穿 goal-runner actionable 分类）——照 v6 清单实施要么编译断裂、要么把视觉错页降级成普遍 probe_failed。t3③ 补页面身份迁移：复用既有 visual-diff-nav screen identity 声明为唯一真源，只取 all_of/any_of 正向 ID 按精确 ID 判在场（不得用 none_of——仓内已证伪其所有权证明力），三态语义冻结（matched/mismatched/probe_failed）；scaffold_contract_drift 全链删除；t7 补三态身份回归。仍符合「不建第二套 anchor 机制」——只是让既有 screen identity 声明真正成为唯一真源。②[P1] 零残留表达式 `ui_kit|maison|blocks.json` 不可执行（事实 #22：裸 maison 误伤凭据/信任注册表/schema/素材能力）——t7 改为精确删除门槛：被删文件不存在断言 + token 级清单（ui_kit_target_dir、maison_ui_kit、ui-kit:scaffold、旧 ui-kit:placeholders、blind-ui-kit、ui-kit-anchors、九个 Maison 组件名、scaffold_contract_drift、旧 canonical-anchor 格式/解析）+ blocks.json 仅查原 kit 路径，不匹配普通 maison。

## 6. 实施记录

> 实施期只追加事实，不改写第 1–5 节的裁决。

### t1 · Codex --json terminal 收口（2026-08-25，已完成）

**真实样本采集**：本机 `codex-cli 0.149.0` 实跑三份 `codex exec --json`，落 fixture
（`harness/tests/unit/fixtures/codex-terminal-*.jsonl` + 同目录 README 记采法/脱敏范围）。
`error → 后续 turn.completed` 一份由两份真实样本的**原始行拼接**而成（未新增/改写字段）。
生产 argv 形态（`--ask-for-approval never exec --sandbox danger-full-access --json`）
另跑一次真实 smoke：`turn.completed` + `usage` 非 null，exit 0。

**落地面**
- `agents/codex/adapter.yaml`：`output_delivery: streaming`、`usage_capture: stdout_json`；
  `tool_event_provenance` 保持缺省 `none`（注释写明理由），未新增 `terminal_event_provenance`。
- 新增 `harness/scripts/utils/codex-terminal-events.ts`：行缓冲扫描器 + 单行分类纯函数。
  只认两终态；顶层 `error` 仅记诊断；item 级错误（`item.type=error` / `item.error`）一律 other。
- `agent-invoke.ts`：`codexArgv` **尾部**独立追加 `--json`（保住 c9f4e7a2/d7f3a9c4 已验证的
  `exec [--model <v>] --sandbox <m>` 顺序）；stdout chunk 直喂扫描器（不产 agent-events.jsonl）；
  `observeCompletion`/`observeTerminalFailure` 共用 `armSettleGrace`（R8 互斥原语复用）——
  failed 恒不置 `completionObserved`、**不取消 hard timeout**，exit 0 规范化非零；
  新增结果字段 `terminal_failure_observed` / `terminal_error_excerpt`。
- **silent watchdog 生产链删除**：常量/选项/定时器/`killTree('silent')` 全删；
  `silent_killed?` 字段保留供读侧兼容历史事件（源码锚定回归钉死写侧零残留）。
- `goal-runner.ts`：`agent_invoke_end` 增补两个 terminal 字段（`GoalRunEvent` 同步）。
- `phase-completion-probe.ts`：**文档归位**（判据一字未改）——自述改「PASS 形态闭环证据
  加速器」，写明放宽四条件=死修复+轮内自修复误杀，FAIL 收口归 adapter terminal 契约；
  并明确 evidence 齐全与 invocation 绑定是两个分立问题。
- `docs/operations/adapter-tool-event-provenance.md`：codex 行改写——`--json` 只提供
  terminal/usage，`tool_event_provenance` 恒 none，不进 `IMAGE_READ_PARSERS`。

**连带修复（`--json` 的必然面，非扩面）**：codex stdout 变 JSONL 后，金丝雀/inline 判卷的
行锚 `^KEY=value$` 在信封上恒空——不投影会把「作答了」误判成「没作答」（与 claude
stream-json 同一类问题）。新增 `extractCodexAgentMessageText`（按序拼 `agent_message`，
无 `turn.completed` → null 不判卷）与 `resolveCanaryStdoutEnvelope` 方言解析，
goal-preflight 与 goal-runner inline canary 两处判卷同源接入；claude 家族行为零变化。

**验收**：`npm run typecheck` 0 · `npm run test:unit` 3510/3510（基线 3483 → +27） ·
`npm run test:fixtures` 44/44 · `node scripts/check-plan-version.mjs` PASS。

### t3 · 撤销强制 Maison UI kit（2026-08-25，已完成）

**①源码 vendoring 删除**：`profiles/hmos-app/ui-kit/**`（九模板 + block 清单）、scaffolder、
三段闭环 check、实例锚点模块、对应单测整体删除；`ui-kit:scaffold` npm 入口删除。
原单测里**与 kit 无关**的素材占位用例（占位 marker / 三态 plan / no-clobber / 占位 CLI 边界 /
`$r` 引用模块限定 / 资源名 schema 边界）迁入新套 `asset-placeholder.unit.test.ts`（11 例）。

**②目标目录机制删除**：`FrameworkPaths` 的 kit 目标目录字段与四级 resolver 一并消失。

**③专属契约删除（明确删除语义，非中性化）**：ui-spec `node.block` 字段（TS 类型 + JSON
schema + 校验分支 + 三方漂移键集）、block↔组件映射、`ui_kit_*` check id 与
`ui_kit_conformance` blocking class、quality-axes `ui_kit_` 族前缀、visual-debt 标签、
selector-contract 不再读 block 清单也不再产 canonical anchor / suffix 契约（查询回归
`screen_id`/`node_id`/`text`/`cardinality`），device-test-evidence 三处 `maison:` 分支与
锚点 import 全删，锚点漂移缺陷分类整链清除（共享类型 / evidence / goal-runner actionable
分类与回修文案 / profile addendum）。

**页面身份迁移**：`appComponentIdPrefixes`（`maison:<feature>:` 前缀推导）→
`declaredScreenIdentityIds`：取**全部已声明屏**的 `all_of`/`any_of` **正向 id**，按**精确 id**
判在场；`none_of` 明确不作所有权证明。三态语义冻结并加回归
（`t3_page_identity_three_states_frozen`：matched / mismatched / probe_failed ×2 / none_of 反例）。
**精度边界（如实记录）**：设备停在**未被任何屏声明**的应用页时，按契约只能判 probe_failed
（旧前缀机制会判 mismatched）。生产上 `screenIdentity` 覆盖 P0 ∪ golden 全部目标屏，
故常见错页仍是确定性 mismatched；MIGRATION 已建议每个目标屏至少配一个 id 锚点。

**④通用结构语义保留**：`nav_bar`/`list_row`/`sheet_scaffold` 等词继续作为 ui-spec canonical
`type`（枚举更名 `STRUCTURAL_SEMANTIC_TYPE_ENUM`），不绑定实现。
**判断留痕**：layout-oracle 的 locator 分母原有一条「`node.block` → locator-required」分支，
**选择直接删除而非平移到通用 type**——平移会把 S6 特意收窄过的分母重新放宽（结构语义
类型恒入分母、nav 在场时也拿交互类型凑分母），那是用新约束替换旧约束；本轮只删错误约束。
这些节点照常经 identity / nav 触达 / bbox / 交互回退四条既有规则参与判定。

**⑤所有权硬地板**（复用 `visual_parity_coverage`，未新增 check id/状态/classifier）：
P0 节点须有 `contract_component`、组件须真实存在于 `contracts.components`（**空数组也判失败**）、
组件 `file` 须在 `contracts.files`——三项**不受 `visual_parity_enforcement=warn|reachable|off`
降级**；visual-parity.yaml 缺失/不可解析且有 P0 节点时同为硬地板缺口。视觉质量项照旧遵守
档位（`off` 且所有权通过 → 视觉项 SKIP，详情如实写明所有权已校验）。六态回归已加。

**⑥OpenSpec A 线**：撤回 `blind-ui-kit` capability（删 spec 目录）、proposal 的 d3 改写为
「已撤回 + 撤回理由 + 诚实精度边界」、Capabilities/Affected specs/Breaking 同步、design 的
锚点小节与 kit 回滚项标注作废、tasks 第 5 节整段改写为撤回记录（5.R/5.R2/5.R3）、
P1-G 的 M4 判据换成产品组件所有权链 + `runtime_mount_conformance`。
**未在 e6 新 change 里叠 kit 删除 delta**。

**夹具迁移（保持仓内字节原样）**：`device-attribution` 历史真机产物不改字节；消费方单测在
**物化进临时目录时**过一层契约迁移器 `migrateKitAnchors`（`maison:<f>:<s>:<node>` → 裸末段；
唯一非机械映射 `sheet_scaffold-next` → `sms_next_btn`，依据是该夹具自带 ui-spec 声明的
`sms_verify.action_button`）。归因语义（跨帧 `product_state` / 零命中 `product_actionable` /
无 spec 依据 `test_contract`）因此继续用真实数据回归；原「纯锚点漂移」用例随分类删除。
golden `visual-debt.json` 移除已失效的 `ui_kit_runtime_conformance` 条目（该套的断言不依赖它）。

**删除验收**：新增 `ui-kit-revocation.unit.test.ts`——被删文件/目录不存在 + token 级清单
（含九个 Maison 组件名）在 active tree 零命中 + `blocks.json` 只查原 kit 精确路径 +
**合法命名空间反向断言**（`MaisonDeviceUnlock`/`agentmaison://`/`maison:placeholder` 不得被误删）。
扫描排除 `openspec/changes/archive/**`、`.cursor/plans/**`、`dist/**`（已构建发布件，下次
`release:pack` 重生成）、运行期产物目录。**两处显式豁免并各配反向断言**：
①迁移公告文档（MIGRATION / 在研 change 三件）必须写出被删机制原名才说得清迁移；
②`device-test-backtrack` 用已撤销分类字面量构造「历史 evidence 不再驱动回修」的读侧夹具。

**验收**：`npm run typecheck` 0 · `npm run test:unit` 3503/3503 · `npm run test:fixtures` 44/44 ·
`npm run openspec:validate` 41/41 · `node scripts/check-plan-version.mjs` PASS。

### t4 · liveness 工作面/控制面分离（2026-08-25，已完成）

`computeLiveness` 增三合取降级：**存在未闭合 invoke** ∧ `outputSignal='unchanged'` ∧
**本 run events 的 `adapter_probe.output_delivery='streaming'`** → 状态降既有枚举
`SUSPECTED_STALL`。读源刻意是**事件**而非现行 `adapter.yaml`（历史 run 不被今天的声明
重新解释，新增纯函数 `resolveRunOutputDelivery`，缺失/非法值一律 unknown）。
`buffered`/`unknown` 不降级——那两档日志本就可能整段憋着，据此降级即误报。
只从 `ACTIVE`/`QUIET` 抬（`ORPHAN_SUSPECTED`/`STALLED`/`ATTENTION` 是更强的控制面结论）。

**只观测不干预**：不触发 kill/恢复，未新增枚举，未新增第二 reducer。

查进度新增独立一行「agent 输出已停滞 X 分钟」，X=now−agent-output.log mtime
（snapshot 新增 `agent_output_stalled_ms`）——**不复用**含 runner heartbeat 的
`seconds_since_activity`：那正是立项事故里把"agent 早不吐字"读成"刚刚还活着"的字段。

回归 5 例（fake clock 固定时钟）：降级正例 + buffered/unknown/缺声明三态豁免 +
三合取缺一不降（invoke 已闭合 / 输出仍更新 / 无日志）+ 读源断言 + 查进度渲染口径。
验收：typecheck 0 · unit 3508/3508 · fixtures 44/44。

### t5 · 超时 prompt 两轴并陈（2026-08-25，已完成）

**只改话术层，判据面零改动**：events 两轴本就正交（超时 attempt 的 `phase_verdict` 同带
`timed_out` 与 harness 精修的 `failure_kind`），失真只在 prompt 组装处无条件硬写
「Prior attempt TIMED OUT — NOT a content failure」。

新增纯函数 `findLatestInvokeHarnessFailure(events, phase)`：窗口分法与
`deriveContinuationFromEvents` 同源（最后一个 `agent_invoke_start` → 配对
`agent_invoke_end` → 窗口内 `phase_verdict`），只认**同 invoke 的新鲜质量事实**
（FAIL/INCOMPLETE），上一 attempt 的旧 FAIL、PASS、崩在 agent 段一律返回 null。

prompt 两处（续作块块头/正文、priorFailureKind='agent_timeout' 分支）改为：
有同 invoke 质量事实 → **两轴并陈**（transport 说超时+产物在盘、quality 说 harness 判了
什么 kind、并明确"别当成只是超时"）；**纯超时保持既有文案一字不改**。

回归 3 例：窗口判据五态（同 invoke FAIL / PASS / 无 end / 旧 attempt / 跨 phase）+
并陈形态断言（含"不得再出现 NOT a content failure"）+ 纯超时文案不变。
验收：typecheck 0 · unit 3511/3511 · fixtures 44/44。
