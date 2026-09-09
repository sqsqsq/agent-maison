---
name: 六阶段重构 B04 — 失败归因与 prior review 消费一致施工图
overview: 无失败事实的 attempt 不再被标注 code_regression；ui_spec_fidelity_gate 的缺证类失败归入既有 spec_capture_gap；goal 快照对 completed_with_prior_review 补既有 reviewed_subject 回落。one-shot 与新变化范围调度保持 cancelled。
version: 3.0.0
todos:
  - id: b04-detail-after-b03
    content: 按宿主 run 20260905T103028Z-79d3fd 的 events 证据与静态调用链细化归因和 prior review 消费两项，明确具体分支、文件、代价及验收命令。
    status: completed
  - id: b04-failure-attribution
    content: 按 D1/D2 修正无失败事实轮与 ui_spec_fidelity_gate 缺证被默认 code_regression；复用既有 FailureKind 与结构化 blocker 字段，不建新根因系统。
    status: completed
  - id: b04-prior-review-consumers
    content: 按 D3 只改 goal 快照这一处矛盾（沿用既往 PASS 时报"无 verifier 证据"）；其余消费者核实无缺陷不改，复用政策不动。
    status: completed
  - id: b04-effective-attempt
    content: 本轮暂不实施one-shot与无进展改造；函数复现不足以推翻08-26熔断经验，等真实浪费证据后重新登记。
    status: cancelled
  - id: b04-change-scope
    content: 本轮取消新增变化范围补查调度；继续使用已有revalidate/风险分级，不建语义diff或新状态。
    status: cancelled
  - id: b04-local-acceptance
    content: 完成 V1 至 V7 的真实 classifier/phase_verdict 生产路径与真实 loader/finalizer/快照测试、OpenSpec delta 与 MIGRATION 同步、candidate 本地验收。
    status: completed
  - id: b04-host-acceptance
    content: 并入B06的C-U回归：在宿主实测归因话术与 prior review 呈现与实际一致，本批不单独触发宿主窗口。
    status: completed
---

# B04施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。批次门（总plan §1/§5）：B04 在 B03 **本地**验收后细化实施，B03–B05 只做本地验收，宿主回归并入 B06。原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)。

**本批的证据门槛**：每条 D 必须以"具体代码分支 + 可触发的输入"为前提。核实后不成立的一律写进 D4 并**不改**；本批允许只剩一项。以下两项均已逐行核实成立，故保留两项。

## 1. 问题边界

宿主只读样本 `20260905T103028Z-79d3fd/events.jsonl`（250 行，只读该文件，未触碰宿主其它路径）给出两个**互不相同**的误归因现场。

**① 没有任何失败事实的 attempt 被标成 `code_regression`。** 第 85 行 spec-i3：`verdict=PASS`、`harness_exit=0`、`agent_failed=false`、`stale_summary=false`、`blockers: []`、`advance_blocked=true` / `advance_block_reason=closure_open`、`action=retry`，却带 `failure_kind_classified: "code_regression"`，且 `reconcile_observation.phase_outcome.failure_kind` 同值。

代码路径已逐行核实：`resolveClosureAdvanceBlock`（[goal-runner-phase.ts](../../harness/scripts/utils/goal-runner-phase.ts):128–145）在"脚本 PASS + 回执必需 + closure 未 closed"时返回 `closure_open`——这是工作流状态，与产品代码无关。而 [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):8155 仍无条件调 `classifyFailureKind`，该函数在无 blocker、无 agent 级信号时一路穿到 [goal-failure-classifier.ts](../../harness/scripts/utils/goal-failure-classifier.ts):639 的 catch-all `return 'code_regression'`。事件的唯一把关是 :824 的 `hasEvidence = input.decisionSummary !== null || input.hasRuntimeFailureEvidence`——**"本轮有 summary"被当成了"本轮有失败"**，PASS summary 非 null 即放行。

现有的 P1-8 拦截确实存在但覆盖不全：[goal-reconcile-boundary.ts](../../harness/scripts/utils/goal-reconcile-boundary.ts):51 只在 `verdict === 'PASS' && action === 'advance'` 时 `delete verdictEvent.failure_kind_classified`；本例 `action='retry'` → 不删。goal-phase-runtime.ts:8941 的自述（"全部 advance 事件带着 code_regression 字样，事后排障已实际造成误导"）就是这条拦截的立项理由，现场证明它漏了 PASS+retry 这一支。

影响面（非仅观感）：`deriveContinuationFromEvents`（goal-runner-phase.ts:1109–1112）回读该字段，把这一轮记成 `{cause:'content_retry', failureKind:'code_regression'}` 带进 `--resume`；`phase_outcome.failure_kind` 与 `assess_recommendation.reason` 同源污染。prompt 侧已被 goal-phase-runtime.ts:6249–6251 的 `verdict === 'FAIL' || 'INCOMPLETE'` 前置门挡住，**不受影响**（不夸大）。

**② `ui_spec_fidelity_gate` 的缺证失败被归 `code_regression`。** 第 104 行 spec-i4：`verdict=FAIL`、`blocker_signature=ui_spec_fidelity_gate`、`blockers:[{id:'ui_spec_fidelity_gate', actionability:'unknown'}]`、`failure_kind_classified: "code_regression"`。同一 run 里 spec-i3 与 spec-i5 各有一条 `capability_receipt`（第 79/116 行），**spec-i4 没有**——即该 invoke 本身没有视觉能力金丝雀，属"缺证"。

该 check 的四个 FAIL 出口（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):296 / :334 / :375，其中 :334 由 :311 的 `severestVlFailureKind` 选四态词）**全部**是"验读证据没建立起来"：`unreachable`（本执行形态结构性不可达）、`not_probed`（本 run 无金丝雀）、`not_yet`（回执尚未签发）、`mismatch`（读的图与材料不符）、以及 :375 的"有视觉能力却没核对原图"。没有一支指向产品源码。而 `classifyFailureKind` 的归类链（:611 deterministic / :632 toolchain / :633 capture / :634 visual_gap / :638 spec_capture_gap）没有一条命中该 id：`DETERMINISTIC_GATE_BLOCKER_IDS`（:246–264）不含它，`isVisualGapBlockerId` 要求 `visual_diff` 前缀，`isSpecCaptureGapBlockerId`（:644–646）只认 `capture_completeness` 前缀 → 落 :639 catch-all。

代价具体：`priorFailureKind === 'code_regression'` 触发 goal-phase-runtime.ts:3568–3585 的分支，指导语是"查 goal-run 起始 commit 以来改过的文件、把上一轮为排障做的改动**先 revert 掉**"——对一个缺视觉回执的 spec 阶段是错向指令。分类器 :635–637 的自述已经写明"事故 i3/i4 即被误标"，指的正是本 run 的这两个 invoke。

**③ prior review 消费者一致性：只有一处真矛盾。** `completed_with_prior_review` 由 [verifier-evidence.ts](../../harness/scripts/utils/verifier-evidence.ts):186–208 派生，各消费者呈现见下表（逐点核实）：

| 消费者 | 落点 | 沿用既往 PASS 时呈现 | 判定 |
|---|---|---|---|
| check-receipt 机器面 | [check-receipt.ts](../../harness/scripts/check-receipt.ts):710–731 | `observed.verifier='provided'` + WARN `verifier_prior_pass_reused` + `summary.verifier_closure` | 诚实（同一 summary 内三者并陈） |
| check-receipt 控制台 | check-receipt.ts:1117 | "…，沿用既往 PASS（completed_with_prior_review）" | 诚实 |
| finalizer | [phase-closure-finalizer.ts](../../harness/scripts/utils/phase-closure-finalizer.ts):646–658 | 稳定写入 `readiness_signals: semantic_not_reverified`（status=unknown） | 诚实 |
| revalidate | [revalidate.ts](../../harness/scripts/utils/revalidate.ts):114/234/247 | flag `semantic_not_reverified` + 控制台 ⚠ | 诚实 |
| 回执投影 | [receipt-scaffold.ts](../../harness/scripts/utils/receipt-scaffold.ts):128 | 依次试 `verifier_subject_id` → `verifier_closure.reviewed_subject_id`，投影被沿用的那份 | 诚实 |
| 非 goal NEXT | [harness-runner.ts](../../harness/harness-runner.ts):2249–2251 / 2445–2461 | 当前 subject 无报告 → `run_verifier_then_receipt`（"去跑 verifier"） | 见 D4-a，不是矛盾 |
| **goal 快照** | [goal-phase-snapshot.ts](../../harness/scripts/utils/goal-phase-snapshot.ts):71–87 | `loadVerifierEvidence` 只认**当前 subject** → `verifier_evidence: null` + `snapshot_files['verifier.report.md'] = null` | **矛盾** |

快照有**两个**调用点：`action === 'advance'`（goal-phase-runtime.ts:9074，闭环之后）与 `defer_external_and_continue_if_allowed` / `defer_external_and_halt`（:9107，**外部阻塞挂起**，不是 advance）。前者是本条的主现场：同一个 `phases/<phase>/harness/` 目录里，`summary.json` 副本写着"沿用既往 PASS 闭环、材料未重审"，而 `verifier_evidence` 与 `verifier.report.md` 都是 null——run 存档丢掉了这次闭环真正依据的那份报告，只读 goal 存档的下游会读成"这阶段根本没有可采信的 verifier 结论"。receipt-scaffold.ts:128 已有逐字可复用的回落写法，快照是**唯一**没做的消费者。

defer 调用点同一函数、同一修复，**无须单独改**：它多半在闭环之前触发，`summary.verifier_closure` 尚未落盘 → 回落读不到 `reviewed_subject_id` → 行为与今天逐字相同（`verifier_evidence: null` + 文件 null）；若该 phase 确已闭过环再被外部阻塞挂起，它顺带也归档被沿用的那份报告，与 advance 支同样诚实。故本条只改函数体，不区分调用点。

## 2. 非目标

- 不改 prior review 的**复用政策**：`findPriorPassVerifierEvidence` 的择新规则、"从未 PASS 过仍是 BLOCKER"、WARN `verifier_prior_pass_reused` 的 id 与 MAJOR 严重度、`current_material_not_reverified` 的 diff 口径一律不动。
- 不新增 `FailureKind` 成员、不新增 `CheckStatus`、不新增 check id、不新增 blocker schema 字段、不新增 `EvidenceValidationStatus` 成员（如 `reused`）、不建第二套根因推理器。
- 不改 `SIGNATURE_HALT_KINDS` / `CUMULATIVE_HALT_FAMILY` / `EXTERNAL_RETRY_RESPONSIBILITY_KINDS` / `DETERMINISTIC_GATE_BLOCKER_IDS` 的成员，不改 `resolveBlockerActionability` 注册表，不改熔断阈值。
- 不改 B02 的 vl 四态判定（`verifyVlSigningChain` / `severestVlFailureKind`）、不改 `ui_spec_fidelity_gate` 的严重度阶梯与软档规则、不改视觉能力探测。
- 不改 B03 的执行键复用与报告分层，不改 one-shot / 有效重试 / 变化范围调度（两条 todo 维持 cancelled，只表示退出本轮实施范围）。
- 不动 goal report 的 MD 渲染（`verifier_evidence` 今天就不进正文，本批不新开渲染面）。

## 3. 决策纪要

### D0：保留的真源与状态

保留：`classifyFailureKind` 的判定顺序与全部现有分支（只增一个 id 落位）；`buildCurrentAttemptFailureProjection` 的返回结构与 `blockerSignature` 计算（PASS 无 blocker 时 `buildEffectiveBlockerSignature` 本就返回 `''`，本批不改变它）；goal-reconcile-boundary.ts:51 的 PASS+advance 抹除（保留，不因新增前置门而删——两道互不依赖）；`deriveVerifierClosureRecord` 与 check-receipt 的全部沿用判据。变化只发生在"这一轮到底有没有失败事实"和"这份缺证/沿用记录被投影成了什么"两处。

### D1：无失败事实的 attempt 不得被打上失败归因

把 goal-phase-runtime.ts:824 的 `hasEvidence` 收紧一句：`decisionSummary !== null` 不再单独成立，必须**该 summary 本身表达了失败**——`verdict !== 'PASS'` 或 `blockers` 非空；`hasRuntimeFailureEvidence`（:8193–8203，含 `harnessExit !== 0`、`closureFinalizationError !== null`、`agent_failed`、超时/断流/中断/空产出、`actionableResult.defects/unverified` 非空）逐字不动，仍单独充分。

改一处，三个下游同时纠正：`phase_verdict.failure_kind_classified`（:8942）、`phase_outcome.failure_kind`（:8793 的 `meta.failure_kind ?? failureKindForEvent`，`meta` 在无 blocker 时本就为空）、**halted phase outcome 的诊断字段**（:9338 起的 `outcomes.push({ … halted: true … })`，:9360–9362 条件式写入 `failure_kind_classified`，缺省即不写——它进的是 `outcomes[]` → goal-report JSON，**不是** `phase_halt` 事件）。schema 侧已核实无阻碍：`reconcile-observation.schema.json` 的 `phase_outcome.failure_kind` 非 required。第三个出口只在**halt 轮**取值，而 halt 轮必然带 runtime 失败事实或 blocker，实际不受 D1 影响——列它是为穷尽 `failureKindForEvent` 的消费面，不是宣称它会变。

**不改** :8155 的 `baseFailureKind` 局部值——`resolveAssessHaltIncident`（goal-failure-classifier.ts:216–234）仍按原样收到它，而该函数的 `exhausted` 判据要求 `verdict !== 'PASS'`，PASS 轮恒走 `framework_bug` fail-closed 分支，与本批无关。收紧局部值会把一条与本批无关的 halt 归属搅进来。

**放弃的准确性**：①`blockerSignature` 在 hasEvidence 转 false 时由 `''` 变 `''`（无变化），但若将来出现"PASS + 非空 blockers"的畸形 summary，本条的 `blockers` 非空分支仍让它保留签名——保守。②PASS 轮不再留下任何 kind 字样，事后排障要靠 `advance_block_reason` 与 `assess_recommendation.reason` 定位；这正是 P1-8 立项时接受的代价，本批只是把它补齐到 retry 支。③`deriveContinuationFromEvents` 对该轮返回 `{cause:'content_retry'}` 且不带 `failureKind`——消费者只有 goal-phase-runtime.ts:6283 的 `=== 'test_contract'` 判断，行为不变。

### D2：`ui_spec_fidelity_gate` 归入既有 `spec_capture_gap`

`isSpecCaptureGapBlockerId`（goal-failure-classifier.ts:644–646）由纯前缀改为"前缀 ∪ 精确 id"，加入 `ui_spec_fidelity_gate`——与同文件既有的 `isCaptureBlockerId`（:131–133，前缀 ∪ `CAPTURE_BLOCKER_IDS`）、`isToolchainBlockerId`（:136–138，前缀 ∪ `TOOLCHAIN_BLOCKER_IDS`）**同一写法**。一行改动，一个文件。

**不走 CheckResult.failure_kind 通道**（虽然 [summary-blockers.ts](../../harness/scripts/utils/summary-blockers.ts):42 的 `c.failure_kind → blocker.classification` 链路可用）：那要改 profile 侧四个 FAIL 出口 + 分类器加一条 classification 分支，而四个出口的归属**完全一致**，按 id 落位是更短、更不易漂移的等价做法。B02 的四态词继续只做人读措辞（`details` / `suggestion`），不升格进 `FailureKind` 词汇表。

行为面已逐项核实**只有归因与 prompt 分支两处变化**：`spec_capture_gap` 不在 `SIGNATURE_HALT_KINDS`（:161–167）、不在 `CUMULATIVE_HALT_FAMILY`（:178–180）、不在 `EXTERNAL_RETRY_RESPONSIBILITY_KINDS`（:195–203）——与 `code_regression` 今天的待遇逐字相同，熔断、累计 halt、耗尽责任归属全部不变；`resolveBlockerActionability`（:303–315）按 id/classification 判，本批不动，该 blocker 仍是 `agent_fixable`，回喂与签名过滤不变；`refineFailureKindWithTrustedDeviceEvidence`（goal-phase-runtime.ts:2077–2087）只窄化 `code_regression`，spec 阶段无 device evidence，不受影响。

**正确的下一步不靠新话术**：改后 :3568 的 revert 指导不再触发，而 `extractPriorFailureContext`（goal-phase-runtime.ts:1006–1018）本就把 blocker 的 `details_excerpt` 与 `suggestion` 逐条喂回 prompt——B02 已在 :318–332 为四态各写好"出路"。故本批**不新增 `priorFailureKind === 'spec_capture_gap'` 的 prompt 分支**（会与 suggestion 重复）。

**不承诺 prompt 里出现 `[spec_capture_gap]` 标签**（codex plan review 第 1 轮 finding 3）：:1008 的 `const kind = b.classification ?? ''` 读的是 **blocker 的 `classification`**，其来源是 [summary-blockers.ts](../../harness/scripts/utils/summary-blockers.ts):42 的 `CheckResult.failure_kind`；本批只改分类器的**返回值**，不回写该字段。故 §5 的"四个出口的 blocker `classification` 仍为空"与此处一致——改后 prompt 里这一条仍是无标签的 `- ui_spec_fidelity_gate` + `details` + `suggestion`。

**放弃的准确性**：①`mismatch`（读了图但与材料不符）与 `not_probed` 共用一个 kind——两者的差别只在 `suggestion` 里，事件层看不出。分开需要新 FailureKind，与"不新增分类"相冲。②`spec_capture_gap` 的原始注释说"主出口=actionability 聚合层即时求人"，那是 `capture_completeness*` 的路由；`ui_spec_fidelity_gate` 没有对应的 actionability 注册项，仍走 agent 重试。本批**不给它加注册项**——加了等于新建一条求人路径，属 B05 的策略面。

### D3：goal 快照对沿用既往 PASS 的证据回落

`snapshotPhaseHarness`（goal-phase-snapshot.ts:71）的单次 `loadVerifierEvidence` 改为**照抄 receipt-scaffold.ts:128 的既有形状**：依次试 `summary.verifier_subject_id` 与 `summary.verifier_closure.reviewed_subject_id`，用同一个 `loadVerifierEvidenceForSubject` 取第一份验真通过的证据，复制它作为 `verifier.report.md` 并填 `verifier_evidence`。summary 由同目录已复制的 `summary.json` 读（快照点在闭环之后，`verifier_closure` 已落盘），**不新读第二份文件**——:68–70 注释禁止的是"loader 结果与复制文件不同源"，本条两者仍同源。

`PhaseSnapshotVerifierEvidence`（:31–35）加一个可选 `reused_from_prior_review?: true`，只在回落命中时置位，让下游能区分"当前材料审过"与"沿用旧审"。**不加第二个 subject 字段**——`subject_id` 已经是被沿用那份的 id，与 `summary.verifier_closure.reviewed_subject_id` 对得上。

**放弃的准确性**：①快照里的 `verifier.report.md` 可能不是针对当前材料的报告；靠 `reused_from_prior_review` 与同目录 summary 的 `verifier_closure` / `semantic_not_reverified` 三处并陈防误读，不改文件名（下游按固定名读存档，:12–15）。②goal report MD 仍不渲染该字段（非目标），存档诚实即止。

### D4：核实后无缺陷、不改（三项）

- **a. 非 goal NEXT 与 check-receipt 的"矛盾"不成立。** `decideNextAction`（harness-runner.ts:2445–2461）按 `resolveVerifierEvidenceState` 的**当前 subject** 状态分流：当前 subject 无报告 → `run_verifier_then_receipt`（去审）；已 PASS → `fill_receipt_then_sync_closure`，其话术 :2250 明写"**当前审查材料**的 verifier 证据已验真可复用"，条件与措辞一致。沿用既往 PASS 是 check-receipt 在"调度方没去审"时的兜底（MIGRATION.md:194 的 WARN 形态），不是首选路径。NEXT 说"去审"、receipt 说"没审就沿用"是**设计上的先后**，不是同一状态的两种说法。改它等于改复用政策（非目标）。
- **b. `observed.verifier='provided'` 不是洗绿。** check-receipt.ts:717 与 :743 同值，但两者写进同一份 summary 时必然伴随 `verifier_closure`（:1158 经 finalizer）与 `readiness_signals.semantic_not_reverified`（phase-closure-finalizer.ts:649–656）。`EvidenceValidationStatus` 里加 `reused` 是新状态（非目标），收益只是省一次并读。**不改**。
- **c. goal report 生成器无缺陷。** [goal-report-generator.ts](../../harness/scripts/utils/goal-report-generator.ts):133 只声明 `verifier_evidence` 字段，MD 渲染面从不输出它——它既不宣称 PASS 也不宣称未审，无可矛盾。D3 修好上游的 null 之后，本文件零改动。

### D5：规格与文档同步

最小 OpenSpec change `attribution-and-prior-review-consistency`，两份 delta：

| spec | 修改 |
|---|---|
| [goal-runner](../../openspec/specs/goal-runner/spec.md):354 所属 requirement | MODIFIED：本 attempt 没有失败事实（脚本 PASS、无 blocker、无 agent/harness/closure 级失败信号）时 SHALL NOT 输出 `failure_kind_classified` 与 `phase_outcome.failure_kind`——`advance_blocked` 的 retry 轮同样适用；ui-spec 保真门的缺证类失败 SHALL 归既有 `spec_capture_gap`，MUST NOT 落 `code_regression`，且 MUST NOT 新增 signature/累计 halt 或新分类（与 :136 的 `external_block` 条款同形） |
| [harness-gates](../../openspec/specs/harness-gates/spec.md):2170 所属 requirement | ADDED 一条 scenario：以 `completed_with_prior_review` 闭环时，run 级阶段存档 SHALL 归档被沿用的那份 verifier 报告并标注其为沿用，MUST NOT 记为"无可采信的 verifier 结论" |

[MIGRATION.md](../../MIGRATION.md) 增一节：**PASS、无 blocker 且无 runtime 失败事实**的轮次不再输出 `failure_kind_classified` 与 `phase_outcome.failure_kind`（旧 run 的该字段只作历史读）、`ui_spec_fidelity_gate` 的归因由 `code_regression` 改 `spec_capture_gap`、goal 阶段存档在沿用既往 PASS 时会出现 `verifier.report.md` 且带 `reused_from_prior_review`。不改 skills 提示词（本批没有改变 agent 该做什么）。

第一句**不得**写成"PASS 轮不再出现 `failure_kind_classified`"（codex plan review 第 1 轮 finding 5）：D1 保留 `hasRuntimeFailureEvidence` 逐字不动，PASS 轮若同时带超时、`agent_failed`、`harnessExit !== 0`、closure 定稿错误、可信缺陷等任一 runtime 失败事实（goal-phase-runtime.ts:8193–8203 的析取项），该字段照常输出——过宽的写法会让宿主按"PASS 就一定没有 kind"排障。

## 4. 文件与提交边界

S0 至 S3 是可审查提交/变更组，不要求自动 git commit。

| 组 | 文件/函数 | 内容与验证 |
|---|---|---|
| S0 无失败事实不打归因 | goal-phase-runtime.ts:813–833 `buildCurrentAttemptFailureProjection`（收紧 `hasEvidence`） | D1；V1/V2；:8155/:8988 的局部 kind 逐字不动 |
| S1 缺证归 spec_capture_gap | goal-failure-classifier.ts:644–646 `isSpecCaptureGapBlockerId`（前缀 ∪ 精确 id） | D2；V3/V4；三个 halt 集合与 actionability 注册表零改动 |
| S2 快照证据回落 | goal-phase-snapshot.ts:31–35 `PhaseSnapshotVerifierEvidence` 加 `reused_from_prior_review?`、:71–87 改双 subject 回落（照抄 receipt-scaffold.ts:128 形状） | D3；V5/V6；不改快照文件名与 `PHASE_SNAPSHOT_FILES` |
| S3 规格与验收 | OpenSpec change `attribution-and-prior-review-consistency` 两份 delta、MIGRATION、既有套件扩展 | D5 与 §7；不夹带 B05/B06 生产改动 |

扩展现有套件，不新建 suite（归位已核对各套件既有 import 面与 fixture）：`goal-runner-testing-integrity`（V1/V3，已有真实 closure 重试轮与 `realSpecFidelityGate` 两个现成场景）、`blocker-actionability`（V4，`spec_capture_gap` 的既有断言就在此）、`goal-headless-guard`（V2 的投影纯函数与源码守卫）、`verifier-evidence`（V5/V6，已有 `completed_with_prior_review` 夹具）、`visual-fidelity`（V7 的四态回归护栏）。

## 5. 接受的准确性边界

| 取舍 | 接受的边界 | 仍须保证 |
|---|---|---|
| PASS 轮不写归因（D1） | 事后排障在该轮读不到任何 kind 字样 | `advance_block_reason` / `assess_recommendation.reason` / blocker 列表照常落盘；FAIL/INCOMPLETE 与一切 runtime 失败事实一字不改 |
| 只收紧投影、不收紧局部 kind（D1） | `resolveAssessHaltIncident` 仍收到 `code_regression` | 该函数在 PASS 轮恒走 fail-closed 分支，与本批无关；不为对齐字面而改一条无关 halt 归属 |
| 缺证四态共用一个 kind（D2） | 事件层分不出 `mismatch` 与 `not_probed` | 差别在 blocker 的 `details`/`suggestion`，两者都逐条进重试回喂；B02 的四态措辞一字不改 |
| 不给该 id 加 actionability 注册项（D2） | 结构性不可达（`unreachable`）仍按 agent 可修重试 | 出路正是"诚实改 verified: unverified"，agent 确实可执行；求人路径属 B05 策略面 |
| 归因用 id 落位而非 `failure_kind` 字段（D2） | profile 侧四个出口的 blocker `classification` 仍为空 | 四个出口归属一致，id 落位等价；`summary-blockers` 链路保持不变，不新增 schema 值 |
| 快照归档被沿用的报告（D3） | 存档里的 `verifier.report.md` 可能不针对当前材料 | `reused_from_prior_review` + 同目录 `verifier_closure` + `semantic_not_reverified` 三处并陈；文件名与快照集合不变 |
| 复用政策不动（D4-a/b） | NEXT 说"去审"、receipt 兜底沿用的先后关系保留 | 沿用仍带 MAJOR WARN 与未重审材料差异；"从未 PASS 过仍是 BLOCKER"不变 |

## 6. 验收用例

**生产接线要求。** 归因用例一律经**真实 classifier + 真实 summary writer + 真实 phase_verdict 事件生产路径**：`goal-runner-testing-integrity.unit.test.ts` 的 `runGoalRuntimeChain` 用 `__testing_set*` 缝在进程内跑真实 phase 循环，`realSpecFidelityGate: true`（:388/:517–553）让**真实** `checkUiSpecFidelityGate` 在 runtime 内产出 FAIL，经真实 `writeRunSummaryBase`（→ `buildSummaryBlockers`）落盘、由 runner 读回喂进 `classifyFailureKind`，结论落在 `probe.events` 的 `phase_verdict.failure_kind_classified`（既有断言写法见 :2573）。**不得**用直调 `classifyFailureKind` 冒充端到端（那证不了 check→summary→runner 三段接线）；纯函数断言只作为补充护栏单列（V2/V4）。

**PASS 轮的 writer 缺口（codex plan review 第 1 轮 finding 1）**：该套件的 fake harness 只在 **FAIL** 出口走真实 writer（:600 `writeRunSummaryBase`），**PASS** 出口是 :658 手写 `summary.json`。V1 的被测轮恰恰是 PASS 轮——若只在 `assertB02ClosureOnlyRound` 加断言，`decisionSummary` 来自手写 JSON，`check → summary writer → runner` 三段里的中段仍是假的，不满足本节要求。故 V1 的目标轮**必须把 PASS 出口也接到真实 `writeRunSummaryBase`**（见 V1 行）。V3 走 FAIL 出口，路径本就成立，**不动**。

prior review 用例一律经**真实 loader/finalizer/快照函数**：`loadVerifierEvidenceForSubject` + `deriveVerifierClosureRecord` + `finalizePhaseClosure` + `snapshotPhaseHarness`，不手工拼 summary 字段。

**改前必红的适用面**：只有**本批新增的缺陷断言**要求改前红、改后绿（V1 的"不含 `failure_kind_classified`"、V3 的 `spec_capture_gap`、V5 的三项快照断言）。V6 的两条反例（①当前证据优先、②无证据返回 null）是 `goal-phase-snapshot.ts`:71 的**现有**行为，V7 的 B02 四态护栏也不依赖 D1–D3——这三条**改前改后均绿**，作用是锁住"没被顺手改坏"，不是反证。

| ID | 输入 | 必须观察到 |
|---|---|---|
| V1 | 真实 closure 重试轮：沿用 `goal-runner-testing-integrity.unit.test.ts:3572–3588` 的既有造法（spec 首轮 receipt 探针 failed → `PASS + advance_blocked + retry`，**保留**该 receipt 探针失败注入），并把这一轮的 PASS summary **接到真实 writer**——fake harness 的 PASS 出口（:658 手写 `summary.json`）按开关改由真实 `writeRunSummaryBase` 落盘，再经 runner 读回 → 真实 `classifyFailureKind` → `phase_verdict`。断言写在 `assertB02ClosureOnlyRound` 内 | 该 `phase_verdict` 事件**不含** `failure_kind_classified` 字段，且 `reconcile_observation.phase_outcome` 不含 `failure_kind`；同一事件的 `verdict='PASS'` / `advance_blocked=true` / `action='retry'` 逐字不变。**改前实得 `code_regression`**（复现宿主第 85 行） |
| V2 | 纯函数护栏：`buildCurrentAttemptFailureProjection` 四组入参——①PASS summary + 无 blocker + `hasRuntimeFailureEvidence=false`；②同①但 `hasRuntimeFailureEvidence=true`；③FAIL summary；④PASS summary + 非空 blockers | ①`failureKindForEvent` 缺席、`blockerSignature===''`；②③④均保留 `failureKindForEvent`。归 `goal-headless-guard`（该套件已有 :534 的 `failure_kind_classified: currentFailureProjection.failureKindForEvent` 源码守卫，须同步确认它仍成立） |
| V3 | 端到端：沿用 `B02-V1b`（:3663–3682，参考图未读 → 真实 gate FAIL，details 含"验证不通过"= `mismatch` 态），加断言 | `probe.events` 中该 spec 轮的 `failure_kind_classified === 'spec_capture_gap'`；gate 的 FAIL 与 runtime 重跑 spec 的既有断言不变。**改前实得 `code_regression`**（复现宿主第 104 行的归因） |
| V4 | 纯函数护栏（`blocker-actionability`，与 :122–130 既有用例同形）：`classifyFailureKind({blockers:[{id:'ui_spec_fidelity_gate'}]})`；并断言集合成员 | 返回 `spec_capture_gap`；`SIGNATURE_HALT_KINDS` / `CUMULATIVE_HALT_FAMILY` / `EXTERNAL_RETRY_RESPONSIBILITY_KINDS` 均不含它；`resolveBlockerActionability` 仍返回 `agent_fixable`；`capture_completeness_external` 的既有归类不变 |
| V5 | 真实 prior review 闭环后快照：造 subject A 的 PASS 报告 → 材料变更产生 subject B（无报告）→ 走真实 check-receipt/finalizer 闭环 → 调 `snapshotPhaseHarness` | 快照 `verifier_evidence.subject_id === A`、`verdict==='PASS'`、`reused_from_prior_review === true`；`snapshot_files['verifier.report.md']` 非 null 且字节等于 A 的报告；同目录 `summary.json` 副本的 `verifier_closure.mode==='completed_with_prior_review'` 且 `readiness_signals` 含 `semantic_not_reverified`。**改前实得 `verifier_evidence: null` + 文件 null** |
| V6 | 反例守卫，两例：①当前 subject 自己有验真 PASS 报告（无 `verifier_closure`）；②本 phase 从未 PASS 过（`verifier_closure` 为 null，check-receipt 仍 BLOCKER） | ①快照取当前 subject，**不带** `reused_from_prior_review`（回落不得抢在当前证据之前）；②`verifier_evidence` 仍为 null、报告文件仍 null——不得凭空回落到一份 FAIL 或不存在的报告 |
| V7 | B02 四态回归护栏（`visual-fidelity` / `goal-canary-pin-binding-d7f3a9c4`:472–485 既有用例） | 四态的 `details` / `suggestion` 措辞、severity 阶梯、软档规则逐字不变——证明 D2 只改归因落位，没有碰 B02 的判定 |

B06 登记项（本批不做）：bc-openCard-1 的 C-U 回归核对——同类现场的 `failure_kind_classified` 不再出现无根据的 `code_regression`，且 goal 存档在沿用既往 PASS 时能读到被沿用的报告。

## 7. 命令与完成判据

开发仓根执行。[select-suites.ts](../../harness/tests/utils/select-suites.ts) 按 `suite.id.includes(filter)` 选套件；以下过滤串均已核对为**唯一**命中（脚本枚举 `run-unit.ts` 全部 `id:` 加 profile 自动发现结果比对）：`goal-runner-testing-integrity`、`blocker-actionability`、`goal-headless-guard`、`verifier-evidence`（不误命中 verifier-plan/material/production-routing）、`visual-fidelity`、`goal-canary-pin-binding`（命中 `goal-canary-pin-binding-d7f3a9c4`）。不拼接多个 id。

    node scripts/check-plan-version.mjs
    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter goal-runner-testing-integrity
    npm --prefix harness run test:unit -- --filter blocker-actionability
    npm --prefix harness run test:unit -- --filter goal-headless-guard
    npm --prefix harness run test:unit -- --filter verifier-evidence
    npm --prefix harness run test:unit -- --filter visual-fidelity
    npm --prefix harness run test:unit -- --filter goal-canary-pin-binding
    npm run openspec:validate
    npm run candidate:build

纯文案返修只查相关 diff/plan；生产变更跑目标检查。`candidate:build` 含 typecheck、unit 全量、fixture、consumer smoke 与 zip 校验，作全量验收，不在它前后另跑重复 `npm test`。

**本地完成 = 本批完成**（总plan §1/§5：B04 只做本地验收）：V1 至 V7 通过（其中**新增的缺陷断言**——V1/V3/V5——须先确认改前红；V6/V7 是既有行为护栏，改前改后均绿，见 §6）、OpenSpec delta 与 MIGRATION 同步、候选件可交用户，即可置 `b04-local-acceptance` completed 并进 B05 细化。`b04-host-acceptance` 保持 pending 直到 B06 的 C-U 回归覆盖本批窗口——**不得**用本地通过冒充宿主证据。

## 8. 修订记录

### 2026-09-06：提纲细化为施工图（未实施、未提交）

- 批次门对齐总plan §1/§5：删去提纲里"依赖B03宿主反馈""根据B01至B03宿主反馈""闭环后才进B05"三处表述，改为宿主只读 events 证据 + 静态调用链为据；`b04-host-acceptance` 改为并入 B06；`b04-effective-attempt` / `b04-change-scope` 维持 cancelled。
- 归因项按"具体分支 + 触发输入"拆成两条独立缺陷（D1 无失败事实轮 / D2 缺证归因），分别由宿主 events 第 85 行与第 104 行坐实，并逐行核实了各自的代码路径与影响面（含"prompt 侧已被 6249 前置门挡住"这类**不成立**的影响，如实缩小）。
- prior review 项按七个消费者逐点核对，**只有 goal 快照一处真矛盾**；其余三处核实无缺陷写入 D4 并明确不改（NEXT 与 receipt 的先后不是矛盾、`observed.verifier='provided'` 有同 summary 并陈、report generator 根本不渲染）。据此 D3 只改一个文件一个函数。
- 归因修正路径两选一后取"精确 id 落位"（一行、一文件），放弃"CheckResult.failure_kind → blocker.classification"通道（四个出口归属一致时它更长且多一处漂移点），理由与两条链路的核实结果写进 D2。
- 全部落点行号为本次核实时的实际位置（B03 已实施、工作树含 B03 未提交改动）。`spec_capture_gap` 现存消费者经全仓 grep 确认只有分类器自身两处（声明 :25 与出口 :638），故 D2 的行为影响面可穷尽。

### 2026-09-06：codex plan review 第 1 轮（全部采纳，未实施）

| # | 级别 | 问题 | 修正落点 |
|---|---|---|---|
| 1 | medium | §6/V1 引用的夹具在 `goal-runner-testing-integrity.unit.test.ts`:658 **手写** PASS `summary.json`，只有 FAIL 分支（:600）走真实 `writeRunSummaryBase`——仅给 `assertB02ClosureOnlyRound` 加断言，中段 writer 仍是假的，不满足 §6"真实 summary writer"要求 | §6 新增「PASS 轮的 writer 缺口」段；V1 行改为：保留既有 receipt 探针失败注入，同时把 PASS 出口按开关接到真实 `writeRunSummaryBase` 再进真实 classifier → `phase_verdict`。V3 走 FAIL 出口，路径已成立，不动 |
| 2 | medium | §6 与 §7 的"每条改前必红"不成立：V6①（当前证据优先）、V6②（无证据返回 null）是 `goal-phase-snapshot.ts`:71 的现有行为，V7 的 B02 四态护栏也不依赖 D1–D3 | §6 新增「改前必红的适用面」段、§7 完成判据同步：只有新增缺陷断言（V1/V3/V5）要求改前红；V6/V7 改前改后均绿，作用是锁"没被顺手改坏" |
| 3 | low | D2 承诺 prompt 里出现 `[spec_capture_gap]` 标签不成立——goal-phase-runtime.ts:1008 读的是 blocker 的 `classification`（来源 summary-blockers.ts:42 的 `CheckResult.failure_kind`），改分类器返回值不回写该字段，与 §5「classification 仍为空」自相矛盾 | D2 删去括号标签的承诺，只保留"移除 revert 指导、继续回喂 `details_excerpt`/`suggestion`"，并显式写明改后该条仍是无标签形态 |
| 4 | low | D1/D3 的调用点清单有误：:9338 起是 `outcomes.push({… halted: true …})`，:9360–9362 是 halted phase outcome 的条件字段而**非** `phase_halt` 事件；D3 说的 :9107 属 external defer 而非 advance | D1 第三出口改称「halted phase outcome → goal-report JSON」并注明它只在 halt 轮取值、实际不受 D1 影响；D3 补列 defer 调用点及"闭环前无 `verifier_closure` → 行为逐字不变"的说明 |
| 5 | low | D5 的 MIGRATION 表述"PASS 轮不再出现 `failure_kind_classified`"过宽——D1 保留 `hasRuntimeFailureEvidence`（goal-phase-runtime.ts:8193–8203 的超时/`agent_failed`/非零退出/closure 错误/可信缺陷等），PASS+失败事实的轮次照常输出 | D5 改为「PASS、无 blocker 且无 runtime 失败事实的轮次」，并附一句禁止写回过宽表述的理由 |

## 实施记录

### 2026-09-06 · S0 无失败事实不打归因（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/goal-phase-runtime.ts`:829–833 | `buildCurrentAttemptFailureProjection` 里 `hasEvidence` 收紧：新增 `summaryStatesFailure`（`decisionSummary !== null && (verdict !== 'PASS' \|\| blockers 非空)`），`hasEvidence = summaryStatesFailure \|\| input.hasRuntimeFailureEvidence`。`hasRuntimeFailureEvidence` 的析取项（:8193–8203）与 :8155/:8988 的局部 kind 逐字未动 |

**行为变化一句话**：脚本 PASS、零 blocker、且无任何 runtime 失败事实的那一轮，`phase_verdict.failure_kind_classified`、`reconcile_observation.phase_outcome.failure_kind`、blocker 签名三者同时缺席；`verdict` / `advance_blocked` / `action` 与 FAIL/INCOMPLETE 轮一字不变。

**验证**

- `--filter goal-headless-guard` 126 passed / 0 failed（含新增 B04-V2，:515）
- 反证：把 `hasEvidence` 换回旧式 → 125 passed / **1 failed**（B04-V2）
- 端到端反证见 S3 的 V1 表格

**取舍**

- 缺 `verdict` 的 summary 走 fail-closed（`undefined !== 'PASS'` 为真 → 仍算失败）。**放弃的准确性**：一份坏 summary 会保留归因；反向（当成 PASS 而吞掉 kind）会把真失败洗绿，不取。B04-V2 末段锁住这一条。

### 2026-09-06 · S1 缺证归 spec_capture_gap（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/utils/goal-failure-classifier.ts`:650 / :654–655 | 新增 `SPEC_CAPTURE_GAP_BLOCKER_IDS = new Set(['ui_spec_fidelity_gate'])`；`isSpecCaptureGapBlockerId` 由纯前缀改为「前缀 ∪ 精确 id」，与同文件 `isCaptureBlockerId`（:131）/`isToolchainBlockerId`（:137）同一写法。判定链顺序（:638）与其余分支未动 |

**行为变化一句话**：`ui_spec_fidelity_gate` 作 blocker 的轮次归 `spec_capture_gap`，`code_regression` 的 revert 指导（goal-phase-runtime.ts:3568）不再触发；三个 halt 集合、actionability 注册表、blocker schema 零改动。

**验证**

- `--filter blocker-actionability` 14 passed / 0 failed（含新增 B04-V4，:141）
- 反证：把谓词换回纯前缀 → 13 passed / **1 failed**（B04-V4）

### 2026-09-06 · S2 快照证据回落（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/utils/goal-phase-snapshot.ts`:9 / :41 / :83–96 / :111 / :118–130 | import 增 `loadVerifierEvidenceForSubject`；`PhaseSnapshotVerifierEvidence` 加可选 `reused_from_prior_review?: true`；`snapshotPhaseHarness` 的单次 loader 改为「当前 subject 优先 → 回落 `summary.verifier_closure.reviewed_subject_id`」（照抄 receipt-scaffold.ts:128 形状），命中回落时复制被沿用的报告并置位；新增 `readReusedSubjectId` 从**已复制进快照目录**的 `summary.json` 取 subject（缺文件/坏 JSON/无字段=null，不抛） |

**行为变化一句话**：以 `completed_with_prior_review` 闭环的 phase，其 run 级存档不再是 `verifier_evidence: null` + `verifier.report.md: null`，而是归档被沿用的那份报告并标注 `reused_from_prior_review`；当前 subject 自己有报告、以及本 phase 从未 PASS 过这两条，行为逐字不变。

**验证**

- `--filter verifier-evidence` 11 passed / 0 failed（含新增 B04-V5 / B04-V6，:558/:559）
- 反证：停用回落分支 → B04-V5 **FAIL**（「快照应归档被沿用的 subject A，实得 null」），B04-V6 **仍 PASS**——与 §6「V6 改前改后均绿」一致

**取舍**

- 回落读的是快照目录里刚复制的 `summary.json`（与 loader 的锚同源），不新读第三份文件，保住 :68–70 注释禁止的「loader 结果与复制文件不同源」。
- **未区分 advance / defer 两个调用点**（goal-phase-runtime.ts:9074 / :9107）：同一函数、同一修复；defer 多在闭环前触发，读不到 `verifier_closure` → 行为与今天逐字相同。与 §1 修正后的表述一致。

### 2026-09-06 · S3 规格与验收（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `openspec/changes/attribution-and-prior-review-consistency/proposal.md` / `tasks.md` | 新建 change（Why / What Changes / Impact 含「放弃的准确性」七条；tasks 五组） |
| `.../specs/goal-runner/spec.md` | MODIFIED「Retry prompts carry continuation context…」：加两段——无失败事实轮不得输出归因（含 `advance_blocked` 的 retry 轮、缺 `verdict` fail-closed）、ui-spec 保真门缺证归既有 `spec_capture_gap` 且不得新增分类/halt 集合成员；加三条 scenario |
| `.../specs/harness-gates/spec.md` | MODIFIED「check-receipt adjudicates verifier evidence by subject echo」：加一段——沿用闭环时 run 级存档须归档被沿用的报告并标注沿用、当前证据优先、从未 PASS 不得回落；加两条 scenario |
| `MIGRATION.md` | 新增「失败归因与 prior review 消费一致」一节（四小节 + 复用政策未改声明），插在「把 framework 发布件集成到目标工程」之前 |
| `harness/tests/unit/goal-runner-testing-integrity.unit.test.ts` | 新增 opts `realPassSummaryWriter`（:398）；hoist `specGateChecks`（:527/:565）；PASS 出口的真实 writer 支路（:686–719）；manifest+指针块抽成 `writeManifestAndPointer()`（:668，两条出口共用）；`assertB02ClosureOnlyRound` 加 V1 归因断言（:3657）；B02-V1 开关（:3689）；B02-V1b 加 V3 端到端断言（:3769） |

**验证（plan §7 命令表，逐条）**

| 命令 | 结果 | 日志 |
|---|---|---|
| `node scripts/check-plan-version.mjs` | PASS（mode=default current=3.0.0） | `check-plan-version.log` |
| `npm --prefix harness run typecheck` | PASS | `typecheck.log` |
| `--filter goal-runner-testing-integrity` | 63 passed / 0 failed | `final-goal-runner-testing-integrity.log` |
| `--filter blocker-actionability` | 14 passed / 0 failed | `final-blocker-actionability.log` |
| `--filter goal-headless-guard` | 126 passed / 0 failed | `final-goal-headless-guard.log` |
| `--filter verifier-evidence` | 11 passed / 0 failed | `final-verifier-evidence.log` |
| `--filter visual-fidelity` | 126 passed / 0 failed（改前同为 126/0） | `final-visual-fidelity.log` / `v7-before-visual-fidelity.log` |
| `--filter goal-canary-pin-binding` | 18 passed / 0 failed（改前同为 18/0） | `final-goal-canary-pin-binding.log` / `v7-before-goal-canary-pin-binding.log` |
| `npm run openspec:validate` | 34 passed / 0 failed（含 `change/attribution-and-prior-review-consistency`） | `openspec-1.log` |
| `npm run candidate:build` | **未跑**——按本轮分工由调度者在 review 后统一执行 | — |

**改前必红（新增缺陷断言）**

| V | 改前实得 | 改后 |
|---|---|---|
| V1 | `{"failure_kind_classified":"code_regression"}`（PASS+advance_blocked+retry 轮，复现宿主第 85 行） | 字段缺席 |
| V2 | B04-V2 FAIL | PASS |
| V3 | 三条 `{"blocker_signature":"ui_spec_fidelity_gate","failure_kind_classified":"code_regression"}`（复现宿主第 104 行） | 全部 `spec_capture_gap` |
| V4 | B04-V4 FAIL | PASS |
| V5 | 「快照应归档被沿用的 subject A，实得 null」 | subject=A / PASS / `reused_from_prior_review=true` / 报告字节相等 |
| V6 / V7 | 改前即绿（既有行为护栏） | 仍绿 |

**偏离 plan**

1. **V1 的目标轮需要补一条 functional 轴的 PASS check**。`ui_spec_fidelity_gate` 命中 `ui_spec_` 前缀落 **visual** 轴（quality-axes.ts:109），只喂它给真实 writer 时 functional 轴零执行 → 如实判 `UNVERIFIED` → 整份 summary 投影成 `INCOMPLETE`（实测 `verdict=INCOMPLETE` / `completion_status=FUNCTIONAL_PENDING`），造不出 V1 要的 PASS 轮。做法是在 fake harness 的 PASS 出口补一条真实 spec 门禁本就会产出的 `spec_file_exists`（check-spec.ts:1486）PASS check。**放弃的准确性**：该 check 的结论由 fake harness 给定，不是真跑出来的；但归因链的被测段（blocker 集合 → `classifyFailureKind` → `phase_verdict`）全部来自真实 writer 与真实 classifier，V1 要证的三段接线未被绕过。
2. **真实 writer 支路做成 opt-in（`realPassSummaryWriter`），未整体替换 PASS 出口**。整体替换会改变该套件全部 63 例的 summary 形状（`verdict` / `next_action` / `quality_axes` / `release_readiness` 全部改由 writer 派生），与本批范围无关。**放弃的准确性**：其余用例的 PASS summary 仍是手写形态——它们本就不测归因链。
3. **manifest + 回执指针块抽成 `writeManifestAndPointer()`**：真实 writer 支路提前 return，两条出口必须落同一份 manifest，否则新支路的 `lineage_fresh` 巡检面与旧支路不一致。纯提取，正文未改。
4. **`npm run candidate:build` 未执行**：本轮分工由调度者在 review 后统一跑，故 §7 该行留空；`b04-local-acceptance` 待其通过后才可置 completed。

### 2026-09-06：codex review 一轮 approve、候选件产出、本地验收完成（调度记录）

- plan review：第 1 轮 2 medium + 3 low（V1 真实 writer、改前必红适用面、D2 标签承诺、调用点归属、MIGRATION 措辞）全采纳并入实施。
- 实施 review：第 1 轮 approve、无 finding（typecheck、六套件 408/408、openspec 严格校验）。只读审查，逐文件哈希核对工作树未被 review 改动（快照撞见既有测试 spec-requirement-provenance 的临时夹具目录，已自行清理）。
- `candidate:build`（scratchpad b04/candidate-build-1.log）：typecheck 通过、unit 3868/3868、fixtures 46/46、consumer smoke 全段通过，`[candidate] BUILT`，zip sha256 `251776d27bf322c3b3e7d948db36254ba1644b14574b5569fc3274e1a605a9d2`。
- 提交：分三笔（D1/D2 归因 / D3 快照回落 / plan 与 OpenSpec 与测试接线），不带署名。
- 实施类 todo 与 `b04-local-acceptance` 置 completed（本地完成 = 本批完成）；`b04-host-acceptance` 保持 pending，并入 B06 的 C-U 回归。

### 2026-09-09 宿主归因负例收尾

同包宿主隔离副本通过正式 Codex attended goal bridge + 独立 spec phase executor 执行负例：strict + verified:unverified，真实 ui_spec_fidelity_gate 为唯一 BLOCKER FAIL；唯一 runtime 产出 phase_verdict.failure_kind_classified=spec_capture_gap、action=retry，未归 code_regression。run=20260909T012757Z-77b2c9；捕获后由 owner 以 waiting 停止，HALTED 原样保留，不称需求通过。本次用真实 attended Codex 进入同一 GoalPhaseRuntime 取代原 G③ 的 detached spec 命令，避免为同一分类器再次启动完整模型修复；差异模式 X-U 的正常闭环沿用 09-08 独立实跑。prior-review 归档与无失败归因也沿用既有 A/B 及本次 attended review。证据：.cursor/verification/3.0.0-golden-three-screen-20260909/b04-spec-gap-*。
