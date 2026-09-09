---
name: 六阶段重构 B06 — 四主格差异验收与发布就绪施工图
overview: 本地只做矩阵证据清单、每格精确运行单、次要格静态/生产函数核对、收益与缺口登记表、候选件与迁移说明收口；C-U 合并回归与 C-N/X-U/X-N 三个差异格、golden 采集与 promote 全部由用户在验收宿主触发。未实测的格一律不写 PASS。
version: 3.0.0
todos:
  - id: b06-detail-from-local-evidence
    content: 依据 B01–B05 的**本地**证据（18 笔提交、候选件 4c95abad、各批 §7 与实施记录）加"用户尚未触发的宿主检查点"细化本施工图；不把宿主结果当已有输入，不重新规划前五批。
    status: completed
  - id: b06-matrix-evidence-inventory
    content: 本地可做——按 D2 出「格 × 证据等级 × 缺口」清单 + 「五批 host todo × §7.2 观察点」逐项映射表，次要格逐条回既有 suite / 生产函数核对，未跑项登记为缺口并保持对应 todo pending，不新增支持、不新增 suite。
    status: completed
  - id: b06-benefit-and-gap-ledger
    content: 本地可做——按 D5 建收益与缺口登记表模板，本地能填的先填，宿主字段留空待 §7.2 回填；不建 A/B 或基准平台。
    status: completed
  - id: b06-candidate-and-migration-final
    content: 本地可做——按 D6 给 MIGRATION.md 补一节 3.0.x 索引（只索引，不重写既有五节），核对候选件字节身份与运行说明；openspec 归档不在本批。
    status: completed
  - id: b06-golden-feature-decision
    content: 调度者已裁定走 D7 方案 (b)（弃 (a) 宿主改名）——evaluator 加 `--feature`（默认 `bc-openCard`，不传时行为逐字不变），贯通**全部** FEATURE 消费点与导出 API `GoldenEvalInput.feature`；已实施并附默认等值回归（consumer-golden 21→24 例）。consumer-golden 无 openspec spec 条款，故只登记进 MIGRATION 与本 plan，不开新 change 目录。仍是 §7.2-E 的**本地前置**。
    status: completed
  - id: b06-candidate-rebuild-after-d7
    content: 本地前置——D7 (b) 落地且 MIGRATION 索引段落盘后按总plan §6 重建候选件；§7.2 共同前置与 E 的 zip 路径 / sha256 / manifest SHA 由重建后的 manifest 取值填入，旧候选件的实跑只作旧版本回归证据。
    status: completed
  - id: b06-host-merged-cu-run
    content: 用户触发——按 §7.2-A 一张运行单跑完 B01–B05 合并 C-U（spec→testing 窗口），跑完**立即**执行 §7.2-E 保存报告；自然运行未命中 B01/B02 触发条件的项按 §7.2-G 隔离场景补跑，未命中即保持 pending。
    status: completed
  - id: b06-host-diff-cells
    content: 用户触发——按 §7.2-B/C/D 跑 C-N / X-U / X-N 三个差异格（各自选定片段与判据，须在 A 的 evaluator 报告保存之后）；任一格未跑即保持 pending，不用回放冒充。
    status: completed
  - id: b06-host-golden-and-promote
    content: 用户 2026-09-09 已确认采用 bc-openCard-1 原始三屏需求作为 golden 发布基线（收起态、展开态、全部银行）；旧十屏不再用于本次发布。新候选件集成后用包内 evaluator 带 --feature bc-openCard-1 验证，同包绑定且 verdict=PASS 才具备 promote 前提；本地新基线对旧包产物的诊断 PASS 不冒充正式候选件验收。正式 promote 不是本 plan 的完成前置。
    status: pending
  - id: b06-host-b07-reacceptance
    content: 用户触发——B07（视觉回修归因与 golden 复用校验，plan 6e4a2c8b）本地完成并进候选件后，按 §7.2 P0.5 裁定 golden 适用性，以用户指定的窗口做范围明确的补验收（不再起同条件 spec→testing 长 run 只为复现）；结果回填 §6 登记表。B07 的完成判据不含此项。 **09-07 已跑：run 20260907T063800Z-26c3b0，B07 目标行为实测成立（三轮拦下 minor、零候选、零回退）；run 因缺口①②③ HALTED/no_progress_visual_gap，见 §6 登记表。**
    status: completed
  - id: b06-host-b08-reacceptance
    content: 用户触发——B08（复用证据绑定与长图推导，plan 9b2d5e7c）本地完成并进候选件后，按 §7.2 P0.5 裁定 golden 适用性，跑 testing→testing 截断窗口；观察 i2 类复用轮是否直接闭合、代理与外层执行键是否相等（不再交替真跑）、两张长图屏是否有 `_derived-ref` 派生参考且 verifier 终判；结果回填 §6 登记表。B08 的完成判据不含此项。
    status: completed
  - id: b06-release-readiness-closeout
    content: 本地与宿主两侧真实完成后才回填登记表、勾各批 host todo 与总 plan 里程碑；不为过门禁提前勾完成。
    status: pending
---

# B06施工图

> 当前 golden 基线：用户于 2026-09-09 明确采用原始三屏需求，当前执行口径见 §11；此前十屏契约与失败记录保留作历史，不再作为本次发布的页面范围。

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。批次门（总plan §1/§5）：宿主回归只有两个检查点——B02 后与 B06。**第一个检查点用户尚未触发**（证据见 §1），所以 B06 是这两个检查点的**唯一一次**合并执行。原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)。

**本批与前五批的形状不同**：B01–B05 是"改生产代码 + 本地验收"，B06 的核心内容是**用户触发的宿主验收**与发布就绪。实施方本地能自主完成的只有五件事（§4 的 L0–L4）；四主格的真实结论、golden 与 promote 前提**只能**由用户在验收宿主产出。因此本文档的 §7 分成 **7.1 本地命令**与 **7.2 由用户在验收宿主执行的运行单**两段，任何一条宿主命令都不得由实施方自动执行。

## 1. 问题边界

**已确立的本地事实（逐条核实过）。**

| 事实 | 核实方式 |
|---|---|
| B01–B05 共 **18 笔**提交（`fd8b321f`…`8b2bd819`） | `git log --oneline c1208c1f..HEAD` 得 19 笔，末笔 `0b54198a`（plan 1741b6f2）不属本组 |
| 工作树干净，HEAD=`8b2bd819` | `git status --short` 空 |
| 候选件 `dist/candidates/framework-3.0.0-candidate.zip` sha256 `4c95abad37c7d8e5fddee27b358cee4522017d8a31a4a4994b3106c4f60b3436` | `sha256sum` 与 manifest 的 `sha256` 逐字相等；`inZipManifest.sha256 = ec601b75105def08aa031c7f89bc0cfaf3c18e33348e5cd70c77eb6b3b411a37`（promote 与 evaluator 的 `--expected-manifest-sha` 用它） |
| 该候选件已跑通 typecheck / unit / fixtures 46 / consumer smoke / zip 校验 | [B05 plan](pipeline_b05_phase_contracts_7b3e9a15.plan.md):530 的 `candidate:build` 记录；**unit 用例条数未落盘**（该记录只写"unit 全过"），要引用具体数字须按 §7.1 重跑一次取尾行 |
| 五个 openspec change 未归档 | `ls openspec/changes/` 得五项，与 B01–B05 一一对应 |

**用户尚未触发第一个宿主检查点。** 只读 `D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-1/goal-runs/` 只有 `20260905T103028Z-79d3fd` 一个目录——即 B01/B02 立项时引用的那个**旧**样本，B01–B05 交付后没有任何新 run。所以提纲里"前批均已有C-U宿主反馈""不等此批才首次上宿主"两句**与事实相反**，本次细化据 §8 改掉：B06 的 C-U 是**首次**跑到新代码的 goal run，不是"复用已有实跑"。

**本批要回答的三个问题**：①B01–B05 的行为改动在真实模型下是否成立（C-U）；②C-N/X-U/X-N 与 C-U 的真实差异是什么（不是 adapter.yaml 声明了什么）；③候选件能否进入 promote 前提（golden evaluator PASS）。前两个只能由宿主回答，第三个已在本地发现一个**结构性阻断**（D7）。

## 2. 非目标

- 不重跑、不重新规划 B01–B05 的本地验收；不越批热修生产代码（发现缺陷按总plan §6 回开发仓修 + 重建候选件，走新 change）。
- 不为 K 格 / A 格新增真实支持、不新增 suite、不新增 adapter 能力字段（总plan §4）。
- 不做 A/B 或基准平台；收益只从既有 events / summary / build / UT / device 日志提取（总plan §6）。
- 不触碰宿主工程：唯一允许的宿主动作是**只读** `doc/features/bc-openCard-1/goal-runs`；替换 framework、物化 `.claude`/`.cac`/`.codex`、启动 goal 或设备运行，一律由用户触发。
- 不热改候选件解压后的 `framework/` 源码（MIGRATION.md:643 的集成契约 + consumer 写保护）。
- openspec changes 的归档（`/opsx-archive`）是发布运维动作，不在本批；正式 `candidate:promote` 也不是本 plan 完成的前置。

## 3. 决策纪要

### D0：保留的真源与状态

候选件字节身份、`scripts/candidate-release.mjs` 的 build/promote 两段、`harness/scripts/consumer-golden/` 的 contract 与 evaluator、各批 §7 的完成判据、`b0X-host-acceptance` 五条 pending todo——全部保留原样，B06 只**消费**，不改写。

### D1：两个检查点合并为一张运行单，窗口必须到 testing

总plan §1 定的第一个检查点窗口是 `spec→ut`（B02 §7），B03–B05 的回归并入 B06。B06 只跑一条链就同时满足两者，**但窗口必须是 `--start spec --end testing`**，理由是硬的：consumer golden evaluator 的 `run_binding` 检查要求该 run 有 **testing** 阶段的 `verdict=PASS/advance` 且其后有成功 `run_end`（[evaluate-bc-opencard.ts](../../harness/scripts/consumer-golden/evaluate-bc-opencard.ts):155–204），`--end ut` 的 run 不可能通过。此前给用户的合并命令写的是 `--start spec --end ut`，本批据此改为 `--end testing`（见 §7.2-A）。代价：窗口更长、包含真机装机与 device-testing，失败面更大；换来的是一次运行同时喂满两个检查点与 golden 三步的第 2 步。

### D2：四主格各写"前置 / 命令 / 观察点 / 证据路径 / 判定"，入口逐条核实

| 格 | 入口（已核实） | 与 C-U 的**结构性**差异（不是声明差异） |
|---|---|---|
| C-U | `goal-runner.ts --adapter claude`，`--detach`（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):4232–4243 的 usage 块） | 基准 |
| C-N | 物化后的 `.claude/commands/<phase>.md` 斜杠命令（六个 feature 阶段模板见 `agents/claude/templates/commands/`），阶段内自跑 `harness-runner.ts --phase <p> --feature <f>` | 无 goal 身份（`attended-goal-context.unit.test.ts`:198 "manual harness remains unbound"）；verifier 由会话自己用 Task 派发、**报告由调用方写**（[framework-agent-execution.mdc](../../agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc):35）；harness FAIL 后须**自己**重跑本阶段（B01 MIGRATION.md:229 明写 goal 与非 goal 在这一点上不同） |
| X-U | `goal-runner.ts --adapter codex`（[agents/codex/adapter.yaml](../../agents/codex/adapter.yaml):53 `goal_capability` 校验通过：`in_session_reconcile`/`phase_context_isolation`/`supports_resume`/`handoff: bidirectional` 齐备，`external_runner.unattended` 在场） | 终态来自 `codex exec --json` 的 turn JSONL 而非 stream-json；**`image_input: none`**（:27），且 `tool_event_provenance` 刻意保持 `none`（:53 段注释 + MIGRATION.md 版本记录第 6 条）→ [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):7630 的 `structured_events` 前置不成立 → **spec 轮根本不发 `spec_refs_receipt_produced`**，不签 `vl_multimodal` |
| X-N | 物化后的 `AGENTS.md`（模板 [templates/AGENTS.md.template](../../templates/AGENTS.md.template):86–96 路由表）+ `.codex/skills/<phase>/SKILL.md` 跳板 + `.codex/rules/`（codex adapter `commands: null`，**没有**斜杠命令面） | 与 C-N 共用同一份 verifier 协议文本，但入口是"读 AGENTS.md 路由表"而非斜杠命令；同样无 goal 身份、无 hook 依赖 |

**视觉轴是 X 两格的最大差异，且必须当成预期行为而不是缺陷**：delegated visual provider（codex 的 `visual_provider`，:47）**不参与** [effective-vision-context.ts](../../harness/scripts/utils/effective-vision-context.ts):69 的 `resolveCapabilityAxis`——该函数只看 primary adapter，且三个来源**有优先级**：`vision.image_input_override`（:79，scope=`run_probed`）> fresh 且可采信的 canary（:88–102，scope=`run_probed`）> adapter 声明兜底（:104–116，scope=`adapter_declared`，evidence.reason 明写"未经实测，仅表示可尝试"）。**codex 的 `image_input: none` 只是第三档兜底**，不是"canary 轴实测为 none"——宿主若配了 override 或跑过 canary，轴值由那两档决定。所以 X 格的正确产物是 `verified: unverified`，但**具体落成 FAIL 还是 WARN 要看宿主实际分支**，见 §7.2-C 的**四分支**验收表（第 2 轮拆出：`verified=verified` 分支里串了两道门，只有第二道的签名链失败才是四态拒签且恒 BLOCKER/FAIL）；只有真 FAIL 时才谈 `failure_kind_classified=spec_capture_gap`（[goal-failure-classifier.ts](../../harness/scripts/utils/goal-failure-classifier.ts):638 + :650 精确 id 集）。

### D3：次要格只做静态 / 生产函数 / 回放 / fixture，逐条落到既有 suite

`harness/tests/run-unit.ts` 的 id 已逐条核对（**注意**：任务简报里的 `goal-adapter-capability` 在仓内实为 `goal-adapter-routing`，:245）：`codeagent-adapter`(:299)、`goal-adapter-routing`(:245)、`goal-runner-testing-integrity`(:204)、`codex-terminal-closure`(:169)、`agent-invoke-settle`(:300)、`attended-goal-context`(:64)、`adapter-bridge`(:264)。

**已核实的一处缺口（如实登记，不新增 suite）**：`goal-adapter-routing` 的四个用例全部用**合成 fixture**（:28–33 的 `legacy/missing capability` 等），仓内**没有**任何测试把 `routeGoalCapability` 喂真实的 `agents/codeagent/adapter.yaml`。K-A 的 manual 回退结论目前只能由"静态读 + 生产函数现场调用"给出：codeagent 的 `goal_capability`（:66–73）**没有** `in_session_reconcile` / `phase_context_isolation` 两个字段，而 [goal-adapter-capability.ts](../../harness/scripts/utils/goal-adapter-capability.ts):304–309 的 attended 分支要求两者同时为 true 才 `in_session`，否则 `manual`。§7.1 用一条 `ts-node -e` 现场跑生产函数取真值，证据等级记 **生产函数**，不记实测，也不为它建测试。

### D4：主格未跑即 pending，绝不用回放冒充

四主格任一格没有真实 run，对应 todo 保持 pending，登记表该行写"未实测"，`b0X-host-acceptance` 五条一并保持 pending。次要格一律不写 PASS，只写覆盖等级与缺口（总plan §4）。诚实标注优先于表格好看。

### D5：收益与缺口登记表只从既有日志提取

字段固定为：`格 / adapter / 模式 / 覆盖阶段 / 版本与模型可得性 / 证据路径 / 证据等级（实测·生产函数·静态·回放·fixture）/ 结论 / 缺口`。收益字段从既有产物取，不新增埋点：

- **UT 出包**（B03 D1）：`hvigor-ut-build.<module>.meta.json` 的 `durationMs`（[hvigor-runner.ts](../../profiles/hmos-app/harness/hvigor-runner.ts):1877 定 log 名，:261–265 派生同名 `.meta.json`，:1756 落盘）。**口径警告**：该值是 `Date.now() - t0`（:1763），即**本次真实发生的那次构建**的耗时，**不是被消除的第二次构建的耗时**——被消除的那次根本没跑，没有任何产物可读。登记表只写观测值与取数路径，**不得**称之为"节省量"。**路径纠正**：该文件落在 `featurePhaseReportsDir(projectRoot, feature, 'ut')`，而 `DEFAULT_PATHS.reports_dir_pattern = 'doc/features/<feature>/<phase>/reports'`（[harness/config.ts](../../harness/config.ts):601）——即 `doc/features/<feature>/ut/reports/hvigor-ut-build.<module>.meta.json`（**多一层 `reports/`**）。B03 §7 与 MIGRATION.md:531 都漏了 `reports/` 这一层，§7.2 的取数命令按核实结果写，并先打印宿主 `paths.reports_dir_pattern` 确认（宿主可能是显式旧值）。
- **UT 执行键**（B03 D2）：`<同一 reports 目录>/<stamp>/ut/execution-key.json` 与逐模块 `frozen.ut-result.<module>.json` / `frozen.hdc-test.<module>.log`（[execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts):163–180 的扫描形状、:77–78 的冻结件名；[ut-host-impl.ts](../../profiles/hmos-app/harness/ut-host-impl.ts):1060/1069 的 `reportsBase`/`runDir`）。**列文件不等于验收行为**：复用是否真的命中，唯一机读锚是 `ut_hvigor_test` check 的 details 里那行 `execution_key: <前16位>（同键复用 <stamp>：<reason>` / `本轮真跑：<reason>）`（[ut-host-impl.ts](../../profiles/hmos-app/harness/ut-host-impl.ts):1090 的 `decideReuse`、:1097 的 `reusedRun`、:1098 组装 `reuseNote`，:1234/:1260/:1273 三处落进 details）；命中复用轮**一条装机/执行 hdc 都不发**（:1102–1103 只回填冻结件后按盘重建）。首轮必然是"本轮真跑"，**必须有第二次同输入 UT 调用**才能观察到复用分支。
- **B02**：`events.jsonl` 里 spec closure-only 轮**无** `capability_receipt` 事件（全仓 grep 确认该事件在生产代码中已无任何产出点），`spec_refs_receipt_produced` 带 `carried_over` 计数（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):7657 取值、:7670 落字段）。**两个前置**：① 该事件只在 `tool_event_provenance === 'structured_events'` 时发（:7630），codex 格恒不发；② `carried_over` 是"沿用本 run 先前 invocation 的读图记录张数"，**首个 invocation 恒为 0**——只有 spec 跑到第二轮才可能 >0，所以观察点必须写成 `carried_over>0` 且指明是第二轮。
- **B01**：负面裁决轮出现 `next_action=run_verifier_for_repair` → verifier request → 回修候选 → 回 coding（MIGRATION.md:223–235）。**该字段在 harness summary，不在 events**（[harness-runner.ts](../../harness/harness-runner.ts):1973 的 `next_action: decideNextAction(...)`，:2548 是唯一返回该值的分支）；**触发条件很窄**（[verifier-plan.ts](../../harness/scripts/utils/verifier-plan.ts):256 `canProduceVerifierRequest`）：只有 `review` 阶段的产品负面裁决（:297，report_validity=PASS 且 BLOCKER FAIL 全为负面裁决闭环项）或 `ut` 阶段归因全为 `code_regression` 的真实断言失败（:334）才进 `repair_diagnosis`，且还要求当前 subject **没有**可用 verifier 正文（harness-runner.ts:1982）。产品一次跑对就不会命中——见 §7.2-G。
- **B04**：PASS + 无 blocker + **且无 runtime 失败事实**的轮才**不含** `failure_kind_classified`（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):8202–8212 的 `hasRuntimeFailureEvidence` 共 **10 个或项**：operator interrupt / 超时 / API 断流哨兵 / agent 无输出 / agent 失败 / 非零 harness 退出 / closure 定稿异常 / interaction 哨兵 / 可回修缺陷非空 / 未验证项非空，任一为真都仍算失败事实）——观察时须把这三个条件并列核对，不能只看 "PASS 且 blockers 空"。另一半接收项是**既往报告回落与 reused 标记**：`reused_from_prior_review: true` 的置位条件是"**当前 subject 报告加载不通过**（[goal-phase-snapshot.ts](../../harness/scripts/utils/goal-phase-snapshot.ts):85）**且**回落到 `summary.verifier_closure.reviewed_subject_id` 后加载成功（:91–93）"，落点是 **goal-report.json 的 `phases[].verifier_evidence`**（[goal-report-generator.ts](../../harness/scripts/utils/goal-report-generator.ts):133 + goal-phase-runtime.ts:9102/:9136），不是快照目录里的文件；`completed_with_prior_review` 本身**不是**充分条件。`ui_spec_fidelity_gate` 的归因为 `spec_capture_gap`（MIGRATION.md:571/580）**仅在它真 FAIL 时**成立。
- **B05**：默认不写 `evidence_profile` 时逐一等值 strict；显式 `balanced` 才降档（[runtime-policy.ts](../../harness/scripts/utils/runtime-policy.ts):412 的早退分支 + MIGRATION.md:603）。**观察产物纠正**：`evidence_policy_snapshot` **不是 events 字段**——它经 `finalizePhaseClosure` 的 `persistPhaseState` 回调写进 `.current-phase.json`（[check-receipt.ts](../../harness/scripts/check-receipt.ts):1199–1214），而 goal 编排下 [phase-state.ts](../../harness/scripts/utils/phase-state.ts):219–220 的 `if (isGoalOrchestrationEnv()) return;` **直接早退不写盘**。goal run 里可读的真源只有两个：check-receipt 打印的 `HARNESS_EVIDENCE_POLICY profile_resolved=... verifier=... trace=... exploration=...` 行（check-receipt.ts:1176）与 `phase_verdict` 事件本身。**默认路径就是回归**；显式 `balanced` 与 n/a 出口两项**不在必跑项内，也不能用"可选"宣称完成**——未跑即按 §6 登记为缺口并保持 `b05-host-acceptance` pending。

### D6：MIGRATION 只补一节索引

B01–B05 已各自追加过节（MIGRATION.md:223 / :236 / :519 / :567 / :603+:618+:628），内容不重写。**只补一节 3.0.x 汇总索引**：列出五批各自的小节标题与一句话摘要 + 唯一需要消费者动手的动作（B01 的重新物化 `.claude/agents/verifier.md`、`phase-executor.md` 与 Stop hook，`.cac` 同；其余四批均"消费者无需动手"）。顺带记录一处结构不齐：B01/B02 两节是 `###`（挂在 :6 的 3.0.0 大节下），B03–B05 是 `##`——索引段照实指路，**不**为了统一层级去改既有五节标题（改标题会打断已发出的锚点引用，收益为零）。

### D7：evaluator 硬编码 feature 与宿主唯一 feature 冲突（**已裁定走 (b)，是 §7.2-E 的本地前置**）

`evaluate-bc-opencard.ts`:28 写死 `const FEATURE = 'bc-openCard'`，CLI 只收 `--project-root` / `--run-id` / `--expected-manifest-sha` / `--out`（:522–525 的 `argOf` + :527 的 `main`），**没有** `--feature`；`bc-opencard.golden-contract.json` 的 `"feature"` 也是 `bc-openCard`。而验收宿主 `doc/features/` 下**只有** `bc-openCard-1`。于是 evaluator 会去读不存在的 `doc/features/bc-openCard/goal-runs/<runId>/events.jsonl`（:123 的 `featureDir` + :155 的 `eventsPath`），`run_binding` 必 FAIL → `verdict=FAIL` → `promoteCandidate` 在 [candidate-release.mjs](../../scripts/candidate-release.mjs):188 抛错。**这条与 B01–B05 的改动无关，是 2026-08-12 golden 立项时的 feature 名与今天宿主基线的漂移**。

已裁定：**走 (b)**（弃 (a) 宿主改名——等于在宿主新建 feature 从 spec 跑起，与"复用有效上游"冲突）。**(b) 不是三行**，`FEATURE` 有四个消费点，缺一个就是半通：

| # | 位置 | 用途 |
|---|---|---|
| 1 | `evaluate-bc-opencard.ts`:98 | `resolveCurrentBuildFingerprint(projectRoot, FEATURE, 'testing')`——当前 build 指纹，喂 `build_binding_available` 与 `build_binding` |
| 2 | :123 | `featureDir(projectRoot, FEATURE)`——`goal-runs/<runId>/events.jsonl`（`run_binding`）、`device-testing/**`（`screen_identity` / `no_crash`）的根 |
| 3 | :349 | `featurePhaseReportsDir(projectRoot, FEATURE, 'coding', frameworkRoot)`——素材门读的 coding `summary.json` |
| 4 | :506 | 报告体的 `feature` 字段（promote 与人读的溯源锚） |

**(b) 的实施口径**（独立提交，不夹带进 B06 的文档提交）：CLI 加 `--feature`，**默认值仍为 `bc-openCard`**；导出 API `evaluateConsumerGolden` 的 `GoldenEvalInput` 同步加可选 `feature`（否则包内其它调用方与测试拿不到该轴），四处消费点全部改读解析后的值；回归须包含"不传 `--feature` 时四处取值与今日逐一等值"一条，证明默认行为零变化。落地后按总plan §6 **重建候选件**——`b06-candidate-rebuild-after-d7`。

**登记方式（已核实）**：`openspec/specs/` 下**没有** consumer-golden 相关能力（三十个 spec 目录逐个核对，唯一提及 `consumer-golden` 的是已归档的 `changes/archive/2026-09-03-golden-nav-target-unification/tasks.md`），evaluator 属发布内容里的运维脚本而非受 spec 约束的能力面。按仓库约定**不开新 change 目录**，只登记进 [MIGRATION.md](../../MIGRATION.md) 的 3.0.x 小节与本 plan。

**对运行单的影响**：§7.2 共同前置与 E 里的 zip 路径、`sha256`、`--expected-manifest-sha` 全部改成"重建后填入"占位，取值命令写在 §7.2 开头。当前候选件（zip `4c95abad…3436` / in-zip manifest `ec601b75…1a37`）**仍可跑**，但它的 evaluator 没有 `--feature`，跑出来只能作**旧版本回归证据**，不构成 promote 前提。

### D8：规格与文档同步

本批不改 openspec spec（无生产行为变化）。文档面只两处：MIGRATION 的索引段（D6）、本 plan 的登记表与修订记录。D7 (b) 的 evaluator 改动连同它的 delta 属于**新 change**，不进本批提交；它与随后的候选件重建是 §7.2-E 的**前置**，不是本批的产物。

## 4. 文件与提交边界

L0–L4 是本地可审查变更组；H1–H4 无本地产物，只有回填。

| 组 | 类型 | 文件 | 内容 |
|---|---|---|---|
| L0 | 本地 | 本文件 | 提纲→施工图（本次） |
| L1 | 本地 | 本文件 §6 | 「格 × 证据等级 × 缺口」清单，次要格逐条落既有 suite id / 生产函数 |
| L2 | 本地 | 本文件 §6 | 收益与缺口登记表**模板**，本地能填的先填 |
| L3 | 本地 | [MIGRATION.md](../../MIGRATION.md) | 追加一节 3.0.x 汇总索引（D6），不改既有五节 |
| L4 | 本地 | 本文件 §3 D7 | 冲突登记 + 已裁定的 (b) 实施口径与四个消费点 |
| P1 | **本批之外**的独立提交 | `harness/scripts/consumer-golden/evaluate-bc-opencard.ts` + `harness/tests/unit/consumer-golden.unit.test.ts` + `scripts/candidate-release.mjs` + MIGRATION 的 3.0.x 小节 | D7 (b)：CLI `--feature` + `GoldenEvalInput.feature`，四处消费点贯通，默认值回归；`candidate:build` 的第 3 步提示同步带 `--feature`。**无 openspec spec 条款 → 不开 change 目录**（D7 已核实）。**不进本批文档提交** |
| P2 | **本批之外**的发布运维 | `dist/candidates/**` | P1 与 L3 落盘后重建候选件，产出新 zip / sha256 / in-zip manifest sha |
| H1–H5 | 用户触发 | 无 | §7.2 五张运行单的结果回填进 L2 的表 |

本批提交面：不新增生产文件、不新增 suite、不改 adapter.yaml、不改 openspec spec。提交只有一笔文档（本 plan + MIGRATION 的**索引段**）；**不自动 commit**。

P1 的四个文件另走一笔提交（evaluator + 其 unit 用例 + `candidate-release.mjs` 提示 + MIGRATION 的 **`--feature` 小节**）——两笔在 MIGRATION.md 上有交集，落提交时按小节拆开，别把索引段和 `--feature` 段混进同一笔。P2（候选件重建）由调度者跑，不产生本地待提交文件。

## 5. 接受的准确性边界

| 取舍 | 接受的边界 | 仍须保证 |
|---|---|---|
| 主格差异只跑一条真实贯穿链（C-U），另三格跑真实差异片段（总plan §4） | C-N/X-U/X-N 不各自重新开发同一需求，六阶段公共契约在这三格只被部分穿过 | 每格必须有**真实 agent 调用**与真实 harness 产物；片段的起点须是有效上游，不是构造的假状态 |
| K-A 的 manual 结论来自生产函数现场调用（D3） | 没有一条覆盖真实 codeagent adapter 的自动化断言，未来改坏 `goal_capability` 不会被测试拦住 | 结论写"生产函数"等级、附现场输出；如实登记这条缺口，不新增 suite 掩盖它 |
| A 格用生产 bridge fixture（`goal-runner-testing-integrity` 的真实 `AttendedGoalPhaseExecutor`，:788/:3825） | 证明的是编排接线，不是真人在场时的交互体验 | 明确标"未实测"，不写 PASS |
| X 格签不出 `vl_multimodal` 终签（D2） | 缺的是**终签这一步**，不等于 pixel_1to1 整体能力不可用——delegated visual provider 仍可看图，只是不进 `resolveCapabilityAxis`；`fidelity_target=pixel_1to1` 的 hard contract 在 X 格没有终签证据可依 | 这是**预期行为**不是缺陷；产物固定是 `verified: unverified`，但**严重度随宿主 `spec.ui_spec_enforcement` 与 canary 分支变化**（§7.2-C 四分支表）；只有实际落 FAIL 时才核 `failure_kind_classified=spec_capture_gap`，WARN 分支不得据此宣称验收了 B04 |
| 收益只从既有日志提取（D5） | 没有对照组，"节省了多少"是单点观测不是统计结论 | 只登记实测数值与取数路径，不推断趋势、不承诺百分比；`durationMs` 是**发生过的那次**构建耗时，不得改写成"被省下的耗时" |
| 窗口拉到 testing（D1） | 失败面含真机装机/设备，非框架缺陷也会中断 | 产品 FAIL 是合法中间态；须区分"框架缺陷"与"产品缺陷"再决定是否回开发仓 |
| B05 只验默认 strict（D5） | 显式 balanced 与「依据明确的 n/a」出口的宿主行为**都不在必跑项**：默认 strict 结构上进不了 balanced 分支（[runtime-policy.ts](../../harness/scripts/utils/runtime-policy.ts):412 早退），也不会触发 [check-plan.ts](../../harness/scripts/check-plan.ts):528 的 n/a 出口 | 默认路径本身就是回归；**未跑的两项按 §6 映射表登记为缺口并保持 `b05-host-acceptance` pending，不得用"可选"宣称完成**。balanced 加跑时须同时核对 `verifier_not_pass` 仍能拦下（B05 D1 的 off≠忽略） |

## 6. 验收用例

**证据等级定义**：`实测`=验收宿主真实 run；`生产函数`=开发仓现场调用生产函数取真值；`静态`=读 adapter.yaml / 模板 / 路由表；`fixture`=既有 suite 的合成或录制夹具；`回放`=既有宿主样本只读回读。

| 格 | 等级 | 落点 | 已知缺口 |
|---|---|---|---|
| C-U | 实测（§7.2-A，`spec→testing`） | 新 goal run 的 `events.jsonl` / 各阶段 `summary.json` / `goal-report.md` / check-receipt stdout | 未触发前恒 pending；A1/A3/A5 三条的触发条件很窄，未命中即"未覆盖"（补跑见 G） |
| C-N | 实测（§7.2-B，只跑 `review`） | `<feature>/review/reports/summary.json` + 会话写出的 `verifier.report.<subject>.md` | 只跑差异片段，不穿满六阶段；harness 首轮直接 PASS 未签 request 时观察点②③ 未覆盖 |
| X-U | 实测（§7.2-C，只跑 `review→ut`） | 同 C-U，另加 codex turn JSONL 终态与 `usage` | **视觉轴不在本窗口**（`ui_spec_fidelity_gate` 是 spec 门）→ 未跑 G③ 即未覆盖 |
| X-N | 实测（§7.2-D，只跑 `review`） | 同 C-N，入口改 AGENTS.md 路由表 → `.codex/skills` 跳板 | 同 C-N |
| K-N | 静态 | `codeagent-adapter`:156（`.cac` 全集 + AGENTS.md 入口）、:194（commands 归一化等值）、:363（共享 rules 中性化） | 无本机 `codeagentcli` 实跑条件 |
| K-U | 静态 + fixture | `codeagent-adapter`:241（`goal_capability` 逐字段等值 + `validateGoalCapabilityForRunner` 通过）、:287（argv 同构、stdin 喂 prompt） | 同上；等值不等于可调用 |
| K-A | 生产函数（§7.1） | `routeGoalCapability(loadGoalCapability(root,'codeagent'),'attended')` → `manual` | **无自动化断言覆盖真实 adapter**（D3） |
| C-A / X-A | fixture / 回放 | `goal-runner-testing-integrity`:788 真实 `AttendedGoalPhaseExecutor`、:3825 B02-V5③（attended 只发 `skipped` 不覆盖回执）；`attended-goal-context`:51–198（run+feature+lease 校验、callback 落设备证据、manual 不绑定） | callback / waiting / resume 的真人交互未实测 |

**本地复验记录（2026-09-06，工作树 HEAD=`8b2bd819`）**——上一轮只核对了 `run-unit.ts` 的 suite id，未逐条打开 suite 文件核行号；本轮把三处补齐，**全部逐字命中，无需订正**：

| 复验对象 | 复验方式 | 结果 |
|---|---|---|
| `codeagent-adapter`（K-N / K-U） | `grep -n "name: '" harness/tests/unit/codeagent-adapter.unit.test.ts` | :156「loadAdapter: codeagent yaml 可解析，AGENTS.md 入口，.cac 产物全集」、:194「commands 归一化等值」、:241「goal_capability 与 claude 逐字段等值；runner 校验通过」、:287「defaultHeadlessInvokePlan argv 同构，stdin 喂 prompt」、:363「共享 rules 已中性化」——五处行号与 §6 引用**逐一相等** |
| `codex-terminal-closure`（X-U 底座） | `grep -n "run(results, '" harness/tests/unit/codex-terminal-closure.unit.test.ts` | :158 / :165 / :219 / :230 / :247 / :288 / :300 / :321 / :338 / :349 / :396 十一处**逐一相等**（该文件用 `run(results, '<name>', …)` 形态，不是对象数组，上一轮的 `name:` 正则匹配不到——这是行号一直没被复验的原因） |
| `goal-runner-testing-integrity`（C-A / X-A） | `sed -n '786,792p;3823,3829p'` | :788 = `new AttendedGoalPhaseExecutor(...)`、:3825 = `test('B02-V5③ attended 轮不生产/不覆盖 refs 回执…')`——**相等** |
| `attended-goal-context`:198 | `sed -n '196,200p'` | :198 = `name: 'manual harness remains unbound even when an active run exists'`——**相等** |
| K-A 生产函数现场取值 | §7.1 的 `npx ts-node --project harness/tsconfig.json -e "…routeGoalCapability(loadGoalCapability(cwd,'codeagent'),'attended')"` | 原样输出：`{"kind":"manual","reason":"adapter 不支持 phase 隔离，回退为手动 harness+assess"}`——与 §7.1 注释里记录的上一轮取值**逐字相同**，D3 的"缺 `in_session_reconcile` / `phase_context_isolation` 两字段 → manual"结论成立 |

**X-U 的静态与 fixture 底座（已核实，供实测对照）**：`codex-terminal-closure` 覆盖 `turn.completed` 独享 completed 分类(:158)、`turn.failed` 终态(:165)、半行分块与 flush(:219/:230)、双终态由 failed 仲裁(:247)、`codex argv 含 --json 且不依赖 tool_event_provenance 触发`(:288)、adapter 声明三字段(:300)、`resolveHeadlessInvokePlan(codex)` 运行时真值带 `--json`(:321)、`usage_capture=stdout_json` 直读 usage(:338)、exit 0 的 terminal 失败规范化为非零(:349)、金丝雀答卷经 codex 信封投影可解析(:396)。实测只需确认真实 run 与这些夹具结论一致，不重复验证解析器本身。

**收益与缺口登记表（模板，宿主字段留空待回填）**

| 格 | adapter/模式 | 覆盖阶段 | 版本/模型 | 证据路径 | 等级 | 结论 | 缺口 |
|---|---|---|---|---|---|---|---|
| C-U | claude / unattended | spec→testing | 待填 | 待填 | 待填 | 待填 | A1/A3/A5 未命中项待登记 |
| C-N | claude / 非goal | review | 待填 | 待填 | 待填 | 待填 | 片段格，不穿满六阶段 |
| X-U | codex / unattended | review→ut | 待填 | 待填 | 待填 | 待填 | 视觉轴不在窗口内（须 G③ 补） |
| X-N | codex / 非goal | review | 待填 | 待填 | 待填 | 待填 | 片段格，不穿满六阶段 |
| K-N/K-U | codeagent | — | — | `codeagent-adapter` 各例 | 静态/fixture | 未实测 | 无本机 CLI |
| K-A | codeagent / attended | — | — | §7.1 现场输出 | 生产函数 | manual 回退 | 无自动化断言 |
| C-A/X-A | attended | — | — | 上表 fixture | fixture/回放 | 未实测 | 真人交互未验 |

**批次级收益与缺口登记表（L2 模板；本地列已填，宿主列待 §7.2 回填）**

规则：`观测值` 只写**读到的原值**，不写推断、不写百分比、不写"节省量"（D5 / §5）。`等级` 取 `实测 / 生产函数 / 静态 / 回放 / fixture` 之一，本地列不得写"实测"。未取数的格子写 `待填（<哪张运行单>）`，**不写"可选"**。

| 批次 | 观察点 | 取数命令 | 观测值 | 等级 | 缺口 |
|---|---|---|---|---|---|
| 共同 | 候选件字节身份（zip） | `node -e "console.log(require('./dist/candidates/framework-3.0.0-candidate.manifest.json').sha256)"` | `4c95abad37c7d8e5fddee27b358cee4522017d8a31a4a4994b3106c4f60b3436` | 静态（读 manifest） | **D7 (b) 之前构建**，其包内 evaluator 无 `--feature` → §7.2-E 恒 FAIL；须按 `b06-candidate-rebuild-after-d7` 重建后重取三值 |
| 共同 | 候选件 in-zip manifest sha（promote / `--expected-manifest-sha` 用它） | 同上，取 `.inZipManifest.sha256` | `ec601b75105def08aa031c7f89bc0cfaf3c18e33348e5cd70c77eb6b3b411a37` | 静态（读 manifest） | 同上 |
| 共同 | 本地单测总量（§1 指出 B05 记录只写"unit 全过"，条数从未落盘） | `npm --prefix harness run test:unit`（取尾行） | `309 个 suite / 3889 passed, 0 failed`（2026-09-06 本轮实跑；含本批新增 3 例） | fixture | 这是**开发仓**回归量，与宿主行为无关，不得当作四主格证据 |
| 共同 | 本批新增用例（D7 (b) 默认等值回归） | `npm --prefix harness run test:unit -- --filter consumer-golden` | `Suite [consumer-golden] PASS=24 FAIL=0`（改动前 21 → 新增 3） | fixture | 只证明默认路径零行为变化，不证明宿主 `bc-openCard-1` 目录下能跑通——那要 §7.2-E |
| B01 | 回修链是否成立（负面诊断 → 回退 coding → 闭环） | §7.2-A3 / G① 四步判据 | 待填（§7.2-A 或 G①） | 待填 | 自然 C-U 一次跑对即不命中；只到"签发"不算闭环 |
| B01 | 本地 review 轮数（返修成本，非收益） | 读 B01 plan 修订记录 | codex review **三轮**收敛（[b01 plan](pipeline_b01_verifier_repair_3a7f9c12.plan.md):277/:302/:318） | 静态 | 轮数只反映本地把关强度，不构成行为证据 |
| B02 | closure-only 轮无 `capability_receipt`、spec 不重考 | §7.2-A1 / G② 第 3–4 步 | 待填（§7.2-A 或 G②） | 待填 | 首轮直接闭环即进不了该分支 |
| B02 | `spec_refs_receipt_produced.carried_over > 0`（第 2 轮） | §7.2-A2 / G② 第 5 步 | 待填 | 待填 | 只跑一轮 spec → 恒 0，登记未覆盖 |
| B02 | 本地 review 轮数 | 读 B02 plan 修订记录 | codex review **两轮**收敛（[b02 plan](pipeline_b02_vision_evidence_8d2b4f60.plan.md):286/:368/:382） | 静态 | 同上 |
| B03 | UT 出包耗时（**发生过的那次**，不是被消除的那次） | `Get-Content …\ut\reports\hvigor-ut-build.<module>.meta.json \| ConvertFrom-Json \| Select durationMs, exitCode` | 待填（§7.2-F） | 待填 | **口径纪律**：只记观测值，禁止改写成"节省 X 秒"（D5 / F②） |
| B03 | 执行键复用是否真命中 | §7.2-F① 的**配对副本** `script-report.run1/run2.json` 的 `execution_key:` 行 | 待填（run1=本轮真跑 / run2=同键复用 `<stamp>`） | 待填 | 只跑一次、或没在各自调用后立即存副本 → 半边证据，不构成 B03 验收 |
| B03 | report-only 分层三态 | §7.2-F③ 的 `--report-reconcile-only` 调用 + `script-report.reportonly.json` | 待填（PASS / WARN / FAIL 分开记） | 待填 | A 的带设备 testing 报告里**没有**这条 check；FAIL 支须隔离副本构造 |
| B03 | 本地 review 轮数 | 读 B03 plan 修订记录 | codex review **两轮**收敛（[b03 plan](pipeline_b03_execution_reuse_5e1c7a93.plan.md):311/:555） | 静态 | 同上 |
| B04 | 无失败事实的轮不含 `failure_kind_classified` | §7.2-A4（10 个或项全假） | 待填（§7.2-A） | 待填 | 三条件任一不成立即"条件未成立"，不是回归 |
| B04 | `reused_from_prior_review` 与实际一致 | §7.2-A5，读 `goal-report.json` 的 `phases[].verifier_evidence` | 待填（§7.2-A） | 待填 | 置位需"当前报告不可用 + 历史回落成功"两条同时成立；只有 `completed_with_prior_review` 不算 |
| B04 | `ui_spec_fidelity_gate` 归 `spec_capture_gap` | §7.2-C 四分支表 + goal-failure-classifier.ts:638/:650 | 待填（§7.2-C 或 G③） | 待填 | **只有实际 FAIL 时**才核；软档 WARN 支不产生该归因 |
| B04 | 本地 review 轮数 | 读 B04 plan 修订记录 | codex review **一轮** approve（[b04 plan](pipeline_b04_scoped_recovery_2f8a6d40.plan.md):323） | 静态 | 同上 |
| B05 | 默认 `profile_resolved=strict` | §7.2-A6 的**显式 check-receipt 重跑 + Tee-Object 存日志** | 待填（§7.2-A） | 待填 | goal 内那次 check-receipt 的 stdout 成功时被丢弃，不采集就永远读不到 |
| B05 | `it_drives_flow` 命中哪一支 | §7.2-A7，读 ut 的 `script-report.json` | 待填（SKIP / PASS / WARN） | 待填 | 命中 SKIP/PASS 也算"数量口径"接收项未覆盖 |
| B05 | 显式 balanced / n/a 出口 | §7.2-G④ | 待填（默认配置结构上进不去） | 待填 | **不在必跑项**，未跑即缺口，`b05-host-acceptance` 保持 pending |
| B05 | 本地 review 轮数 | 读 B05 plan 修订记录 | codex review **三轮** + 调度者把关（[b05 plan](pipeline_b05_phase_contracts_7b3e9a15.plan.md):409/:462/:490/:524） | 静态 | 同上 |
| B06 | 本批施工图 review 轮数 | 读本文件 §8 | codex plan review **两轮**（第 1 轮 10 条 / 第 2 轮 8 条，全数采纳） | 静态 | 施工图审得再细也不替代宿主实测 |
| B07 | minor 视觉信号不产 coding 候选（D1） | `goal-runs/20260907T063800Z-26c3b0/detach.log` grep `[actionable]` | `add_bank_card_collapsed: 9 条`（i1/i2/i3）、`add_bank_card_expanded: 2 条`、`all_banks: 1 条`（i2）；三轮 `deterministic_defects=[]`；全 run 无 `phase_backtrack_requested`，`backtracks_used=0` | 实测 | — |
| B07 | 12 条 minor 下 harness 的裁决 | 同上 detach.log:1229–1288（i2） | `WARN [MAJOR] visual_diff … must_fix=6 … defects=12`；`Total 60 / FAIL 0 / WARN 4`；`Blockers: 0`；`Verdict: PASS`；`can_claim_done=YES` | 实测 | i2 随即被 `unverifiable_must_fix` 判 retry（缺口①） |
| B07 | golden 身份披露（D3） | `testing/reports/script-report.json` 的 `visual_diff_capture` details | `screens=2 / preserved_build_valid=1 / golden_contract=none` | 实测 | "同键复用 PASS"那条未观测到（i3 外层 harness 真跑，缺口②） |
| B07 | run 终态 | `goal-runs/20260907T063800Z-26c3b0/events.jsonl:110` | `run_end status=HALTED halt_reason=no_progress_visual_gap run_disposition=TERMINAL`；i1 FAIL→retry、i2 PASS→retry、i3 FAIL→halt（retries 2/2） | 实测 | 缺口①②③，均非 B07 改动引起 |
| B07 | E（P0.5 判不匹配，照跑照存） | `goal-runs/20260907T063800Z-26c3b0/golden-report.json` | `verdict=FAIL`：FAIL 7（run_binding、ten_fixed_screens_exact_set、verdict_all_pass、screenshot_binding、required_assets、forbidden_HomeTab、key_overlays_and_completion）/ PASS 8；exact_set 缺 9 屏、多 2 屏 | 实测 | 验收样本不适用（contract 立项需求 ≠ 当前基线），不改写 |
| B03（补） | 执行键复用是否真命中 | `testing/reports/*/hylyre/execution-key.json`（09-06 17:51 起 5 条） | 键交替：`21071a69…(hap=null)` 06:44 / `a7685ee1…(hap=20956575)` 07:08 / `21071a69…` 07:24 / `a7685ee1…` 07:40；i2 外层 harness 07:18:19–07:18:52（33 s）复用 070508Z（`capture_not_run`）；i3 外层因"最新 run 072045Z 是其他 execution key"真跑 20 例 + 装机 | 实测 | 缺口② |

**B07 补验收暴露的缺口（09-07，均已核到代码分支；是否进 B08 由用户定）**

① **同键复用 × 证据时间窗**：`goal-phase-runtime.ts`:2211–2220 要求 `device-test-run.meta.json` 的 `run_started_at/run_ended_at` 落在本 attempt 的 harness 窗口内；同键复用回填的是被复用 run 的冻结 meta，时间必在窗外 → `unverifiable_must_fix` → retry。复用一旦发生就必被否决，B03 的复用收益在 goal 模式下归零并额外消耗 retry 预算。
② **执行键记录被 hap=null 的代理内部调用污染**：testing 代理自己跑的 `harness-runner --phase testing` 落下 `hap_sha256_full=null` 的成功记录；`execution-key.ts`:204–221 `decideReuse` 只看最新一条 → 外层 harness 看到"最新是其他 key"→ 每轮真跑 20 例 + 装机。
③ **重采后 reference_viewport 剔除屏留 pending**：i3 重采后 `add_bank_card_expanded` / `all_banks`（参考图 4350 / 8312 px 长图）verifier 未终判（critic `unread_screenshots=1`），P0 未覆盖 → `visual_diff` FAIL → retries 耗尽 → `no_progress_visual_gap`。上一 run 同两屏被判 warn+UNKNOWN，本次留 pending，是 verifier 行为差异；需求资产（整页长图）是根因。
④ i2 `verdict=PASS + action=retry`（理由 unverifiable 证据）却带 `failure_kind_classified=code_regression`，与 B04 A4 口径待核。

**各批触及的 suite（供回归定位，非行为证据）**——由 `git diff --name-only <批区间> -- 'harness/tests/unit/*' 'profiles/*/harness/*test*'` 现取：

| 批 | 提交区间 | 触及的 suite |
|---|---|---|
| B01 | `fd8b321f~1..020f64c7` | `context-facts` / `goal-phase-runtime` / `repair-candidates` / `verifier-plan` / `verifier-production-routing` |
| B02 | `020f64c7..22294d81` | `critic-receipt-producer` / `effective-vision-context` / `goal-canary-pin-binding-d7f3a9c4` / `goal-runner-phase` / `goal-runner-testing-integrity` / `host-runtime-truth` / `visual-fidelity` |
| B03 | `22294d81..d3a47a70` | `device-test-timings` / `execution-key` / `goal-headless-guard` / `hdc-runner` / `hvigor-build-verdict` / `testing-trace-gates` / `ut-module-selection`（另含 profiles 侧 `device-test-timings.ts` / `test-report-writer.ts` / `ut-hvigor-test-failure.ts`） |
| B04 | `d3a47a70..08fe47d1` | `blocker-actionability` / `goal-headless-guard` / `goal-runner-testing-integrity` / `verifier-evidence` |
| B05 | `08fe47d1..8b2bd819` | `check-receipt-policy` / `context-facts` / `contract-reference-closure` / `runtime-policy` / `verifier-plan` / `verifier-production-routing` |

逐批收益行的取数路径见 D5 与 §7.2-F。

**五批 host todo → 运行单观察点逐项映射（收口条件；未跑项即缺口，不得以"可选"结案）**

| 批 | host todo 的接收项（原文口径） | 落到哪张运行单的哪个观察点 | 未跑时的处置 |
|---|---|---|---|
| B01 | 负面诊断 → owner 修复 → 窗口闭环 | §7.2-G-①（**goal 补跑**，review 阶段注入可控产品缺陷）四步判据：① `summary.json` 的 `next_action=run_verifier_for_repair` + `verifier_request` + `repair_candidates` 非空；② `events.jsonl` 的 `phase_backtrack_requested{from_phase:review, to_phase:coding, reason:'repair_candidates'}`（goal-phase-runtime.ts:9227–9241）；③ 其后 coding 真被重跑；④ review 再拿 `PASS/advance` 且 `run_end` 成功 | 自然 C-U 一次跑对即**不会**命中（D5 已列窄条件）；只跑手动 `--phase review` 只能到 ①，②–④ 属 goal 编排；未命中或停在 ① → `b01-host-acceptance` 保持 pending |
| B01 | 无直接回归 | §7.2-A：`--start spec --end testing` 全链无新增 blocker、`run_end.status ∈ {COMPLETED, CHAIN_SLICE_COMPLETED}` | 链未跑完即 pending |
| B02 | 纯收口轮不重考 | §7.2-A：closure-only 轮（前轮 `phase_verdict` 为 `PASS + advance_blocked + retry`，[goal-runner-phase.ts](../../harness/scripts/utils/goal-runner-phase.ts):1122）里**无** `capability_receipt` 事件、spec 不因此重跑 | 首轮 harness 直接 PASS+closed 时进不了该分支 → §7.2-G-② |
| B02 | 不拒签 / 负面结果可回修 | §7.2-A：spec **第二轮**的 `spec_refs_receipt_produced` 带 `carried_over>0`、`status ∈ {complete, partial}` | 只有一轮 spec → `carried_over` 恒 0，登记为未覆盖 |
| B03 | 重复消除量 | §7.2-F：`ut_hvigor_test` details 里的 `execution_key:` 行——**第一次**必为「本轮真跑」，**第二次同输入**才应出现「同键复用 `<stamp>`」且该轮零 hdc 装机/执行 | 只跑一次 UT → 只能登记「真跑」半边，复用分支未覆盖 |
| B03 | 真实测试不漏 | §7.2-F①：复用轮逐模块 `frozen.ut-result.<module>.json` 回填后的结果与真跑轮逐一相等（读两份**配对副本**，不读被覆盖的现场文件）；§7.2-F③：**另跑一次** `--phase testing --report-reconcile-only`，读 `report_reconcile_only` 的 hard / derived 两桶（[check-testing.ts](../../harness/scripts/check-testing.ts):2713–2717 分桶、:2729–2730 三态） | A 的带设备 testing 报告里**没有**这条 check（分支决策 check-testing.ts:5873）——不显式调用就等于没验收；三态分开记，FAIL 支须隔离副本构造，未做即缺口 |
| B04 | 归因话术与实际一致 | §7.2-A：PASS + 无 blocker + **无 runtime 失败事实**（D5 列的六个或项全假）的轮不含 `failure_kind_classified`；§7.2-C：X 格 `ui_spec_fidelity_gate` **实际 FAIL 时**归 `spec_capture_gap` | X 格落 WARN 分支 → 归因项未覆盖，如实登记 |
| B04 | prior review 呈现与实际一致 | §7.2-A5：**`goal-report.json` 的 `phases[]`** 里该 phase outcome 的 `verifier_evidence.reused_from_prior_review === true` 且 `subject_id` 等于 `summary.verifier_closure.reviewed_subject_id`（不是快照目录里的文件） | 置位需**同时**满足"当前 subject 报告加载不通过 + 回落 subject 加载成功"（goal-phase-snapshot.ts:85/:91–93）。只出现 `completed_with_prior_review` 而当前报告可用 → 该标记本就不置位 → 登记未覆盖，不判回归 |
| B05 | 默认 strict | §7.2-A：每阶段 check-receipt 的 `HARNESS_EVIDENCE_POLICY profile_resolved=strict` 行 | 必跑项 |
| B05 | 显式 balanced | **不在必跑项**：默认配置结构上进不了该分支（runtime-policy.ts:412） | 登记为缺口，`b05-host-acceptance` 保持 pending |
| B05 | n/a 出口 | **不在必跑项**：需 plan 章节写「不适用：<依据>」且 contracts 对应集合为空（check-plan.ts:528 三条前提） | 同上 |
| B05 | 数量口径 | §7.2-A7：ut 轮 `it_drives_flow` 命中**哪一支**（[check-ut.ts](../../harness/scripts/check-ut.ts):2201 SKIP / :2244 PASS / :2257 WARN，severity 三支恒 MAJOR），verify-ut 硬判文案已改 | ut 轮未跑即 pending；**跑了但命中 SKIP/PASS 也算未覆盖**——只有 WARN 支才验证到"数量不足不再判 FAIL"，如实登记缺口，不用 PASS 冒充 |

## 7. 命令与完成判据

### 7.1 本地命令（开发仓根，实施方执行）

    node scripts/check-plan-version.mjs
    npm run openspec:validate
    # K-A 生产函数现场取值（D3）。仓根没有 tsconfig.json，裸 `ts-node -e` 会以
    # `Unexpected token 'export'` 失败——必须显式 --project 指到 harness 的配置。
    npx ts-node --project harness/tsconfig.json -e "const m=require('./harness/scripts/utils/goal-adapter-capability');console.log(JSON.stringify(m.routeGoalCapability(m.loadGoalCapability(process.cwd(),'codeagent'),'attended')))"
    # 实测输出（本次核实）：{"kind":"manual","reason":"adapter 不支持 phase 隔离，回退为手动 harness+assess"}
    # 需要引用 unit 用例条数时才跑（§1：B05 记录只写"unit 全过"）
    npm --prefix harness run test:unit

**P1（D7 (b) 的 evaluator 改动）另加两条**——它是生产改动，按总plan §6"生产改动 typecheck 和目标测试"：

    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter consumer-golden   # suite id 见 run-unit.ts:151

纯文档改动（L0–L4）只需前两条 + LF 扫描（`node -e` 扫改动文件的 `\r` 计数，不目视）；本批**不跑** `candidate:build`——候选件字节身份已由 §1 的 sha256 核实，重建是 P2（D7 (b) 落地之后）的事，由调度者统一跑，不在实施方的命令面里。

### 7.2 由用户在验收宿主执行的运行单

> 以下每一条都**由用户在验收宿主执行**。实施方不代跑、不代替换 framework、不代物化。优先在隔离验收副本上做（总plan §6）。
>
> **全部命令按 PowerShell 单行写**（宿主是 Windows PowerShell 5.1：无 `&&`、反斜杠不是续行符），每条自带 `Set-Location`，不依赖上一条留下的 cwd。占位符 `<hostRoot>` = 宿主工程根（含 `framework/` 与 `doc/` 的那一级）。

**执行顺序是硬约束（见下方"为什么 E 必须紧跟 A"）**：共同前置 → **A** → **E**（立刻，且保存报告）→ B / C / D 任意序 → F → G（仅补跑未命中项）。

#### 共同前置（一次）

**P0. 取候选件真值**（D7 (b) + 候选件重建完成后，在**开发仓**执行，把三个值抄进下面的占位符）：

    Set-Location <devRepoRoot>; node -e "const m=require('./dist/candidates/framework-3.0.0-candidate.manifest.json');console.log('zip=',m.zipPath);console.log('zipSha256=',m.sha256);console.log('inZipManifestSha=',m.inZipManifest.sha256)"

> 重建前的旧值是 zip `4c95abad…3436` / in-zip manifest `ec601b75…1a37`。用旧候选件跑出的结果只能作**旧版本回归证据**（其 evaluator 无 `--feature`，§7.2-E 必 FAIL），**不构成 promote 前提**（D7）。

**P1.** 把 `<重建后的 zip 路径>`（sha256 = `<重建后填入>`）解压覆盖到宿主 `<hostRoot>/framework/`，**不得**热改解压后的源码（MIGRATION.md:643）。

**P2.** 重新物化 adapters——B01 明确要求重新物化 `.claude/agents/verifier.md`、`phase-executor.md` 与 Stop hook（`.cac` 同，MIGRATION.md:229）；X 两格另需 `.codex` bundle。智能 UPDATE 快捷路径（[framework-init SKILL](../../skills/project/framework-init/SKILL.md):163–171）：

    Set-Location <hostRoot>\framework\harness; npx ts-node scripts/init-orchestrate.ts --scope project --project-root <hostRoot> --smart-auto --materialized-adapters claude,codex,codeagent

**P3. 记录分支变量与有效运行身份**（决定 C 格与 B05 观察点怎么判，跑之前先读，别事后猜）：

    Set-Location <hostRoot>; node -e "const c=require('./framework.config.json');console.log('reports_dir_pattern=',c.paths.reports_dir_pattern);console.log('ui_spec_enforcement=',c.spec&&c.spec.ui_spec_enforcement);console.log('project.agent_adapter=',c.agent_adapter);console.log('evidence_profile=',c.evidence_profile)"
    Set-Location <hostRoot>; node -e "const fs=require('fs');const p='framework.local.json';console.log(fs.existsSync(p)?'local.agent_adapter='+(JSON.parse(fs.readFileSync(p,'utf-8')).agent_adapter??'(缺)'):'framework.local.json 不存在')"

**只读 project config 会漏掉权威身份。** `framework.local.json > agent_adapter` 才是运行身份 SSOT（[framework-local-config.ts](../../harness/scripts/utils/framework-local-config.ts):19/:511，[goal-preflight.ts](../../harness/scripts/utils/goal-preflight.ts):100 优先读它），并且它对 goal 与非 goal 两侧都生效——`resolvePhasePersonalPrerequisites` 无条件把 `agent_adapter` 放进每个 phase 的 personal 前置（[phase-personal-prerequisites.ts](../../harness/scripts/utils/phase-personal-prerequisites.ts):25）。

**P3b. 每格开跑前先核对有效身份，不一致就显式切换**（这条以前不在运行单里，导致 §7.2-C 的裸 `--adapter codex` 必被拒）：

| local `agent_adapter` | 要跑的格 | 怎么做 |
|---|---|---|
| 与该格 adapter 相同 | 任意 | 直接跑，命令里的 `--adapter` 可留可去（`local_config` 优先，goal-preflight.ts:135） |
| 与该格 adapter **不同** | A / C（goal） | 命令加 `--adapter <该格 adapter> --override-adapter`。裸 `--adapter codex` 会被 goal-preflight.ts:127–132 直接 BLOCKER 拒绝（"framework.local.json 记录运行身份 X，本次却请求 Y"） |
| 与该格 adapter **不同** | B / D（非 goal） | 走 `record-adapter` 永久改，**两条命令见下方 P3b-1**。裸 `npx ts-node scripts/init-orchestrate.ts --scope personal --project-root <hostRoot>` **不切换身份**：不带 `--execute` 时它只打印任务计划 JSON 就 `process.exit(0)`（[init-orchestrate.ts](../../harness/scripts/init-orchestrate.ts):1371/:1420），既不交互选择也不写 local |

**P3b-1. 非交互切换运行身份（B / D 格用；`<targetAdapter>` = `claude` 或 `codex`）。** `record-adapter` 的写盘输入是 `executionContext.activeAdapter`（[init-task-executor.ts](../../harness/scripts/utils/init-task-executor.ts):618–620 的 `updateLocalConfig`），只能经 `--execute` + staging JSON 注入；`--decision-file` / `--context-file` 必须是**绝对路径且不在 `framework/harness` 内**（:1226–1243，建议就放系统临时目录）。`decision_mode: smart` + `tasks: []` 时五个 personal 任务全部隐式解析为 `run`（[init-orchestrate.ts](../../harness/scripts/init-orchestrate.ts):841–842 → :150–156），因此决策文件可直接照抄：

    Set-Location <hostRoot>\framework\harness; New-Item -ItemType Directory -Force "$env:TEMP\framework-init-b06" | Out-Null; Set-Content -Encoding utf8 "$env:TEMP\framework-init-b06\decision.json" '{"schema_version":"1.0","scope":"personal","decision_mode":"smart","plan_generated_at":"b06","tasks":[],"materialized_adapters":[]}'; Set-Content -Encoding utf8 "$env:TEMP\framework-init-b06\context.json" '{"activeAdapter":"<targetAdapter>"}'
    Set-Location <hostRoot>\framework\harness; npx ts-node scripts/init-orchestrate.ts --execute --scope personal --project-root <hostRoot> --decision-file "$env:TEMP\framework-init-b06\decision.json" --context-file "$env:TEMP\framework-init-b06\context.json"

**判成功**：第二条打印的任务表里 `record-adapter … executed 已写入 framework.local.json agent_adapter=<targetAdapter>`，退出码 0；随后用 P3 第二条命令复核 local。**前置**：目标 adapter 的入口产物必须已物化（claude=`CLAUDE.md`、codex=`AGENTS.md`；P2 已做），否则 `assert-active-adapter-materialized` failed、`record-adapter` 被跳过、身份不变。`--select-adapter` **不能**用于切换——local 已有合法身份时 `ensurePersonalSetup` 直接返 `adapter_conflict`（[personal-setup-gate.ts](../../harness/scripts/utils/personal-setup-gate.ts):591–607）；`--smart-auto` 同样不行（personal 的 staging context 不含 `activeAdapter`，record-adapter 会 throw）。本轮已在开发机以一份临时工程实测该两条命令：executed=5 / failed=0，`framework.local.json > agent_adapter` 由 `claude` 改为 `codex`。

> **`--override-adapter` 有持久副作用**：preflight 全过后它会 `recordAdapterToLocal` 回写 framework.local.json（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):5153–5157）。所以 A（claude）跑完再跑 C（codex，带 override）后，local 已是 `codex`——**回头再跑任何 claude 格都要再 override 一次**。
>
> **替代方案（推荐，且与 §7.2-E 的"独立验收副本"同一份拷贝）**：claude 两格与 codex 两格各用一份 `<hostRoot>` 拷贝，各自 framework.local.json 记各自 adapter，全程零 override、零回写，也顺带解决 E 的共享产物覆盖问题。**二选一，不得两者都不做。**

**P0.5 golden 适用性裁定（A 启动前，一次；B07 plan review #1）**：对照**独立确认的需求基线**（原始需求文 + 用户确认的屏清单——不是本 run 的产物，也不是 spec 自己）与 contract `positive_screens`（十屏）。**匹配** → A 命令保留 `$env:MAISON_GOLDEN_CONTRACT = …;` 首段，之后 spec 漏屏、采集缺屏一律是**真实 FAIL**（那正是 golden 要抓的）。**不匹配** → A 去掉首段、不带 golden；E 仍照跑并保存报告，结论保留 FAIL 原样并注明「验收样本不适用（contract 立项需求 ≠ 当前基线）」——不记 N/A、不改写历史结果、不从产物反推 contract；promote 前提在该基线上不成立，如实登记。**执行 harness 期间不得 `env -u` / 清空该变量**：golden fail-closed BLOCKER 是验收结论，出现即停、回到本条重裁。当前 bc-openCard-1 基线（原始需求 3 图）与十屏 contract **不匹配**（run `20260906T143404Z-ab463c` 已证：contract 屏无法解析为 capture target）——除非用户另行确认基线，A 不带 golden。

#### A. C-U 合并回归（同时验收第一个检查点与 B03–B05）

    $env:MAISON_GOLDEN_CONTRACT = 'framework/harness/scripts/consumer-golden/bc-opencard.golden-contract.json'; Set-Location <hostRoot>\framework\harness; npx ts-node scripts/goal-runner.ts --feature bc-openCard-1 --adapter claude --requirement-file '<hostRoot>\doc\features\原始需求\1-1-银行卡\原始需求.md' --start spec --end testing --detach

窗口按 D1 是 `--start spec --end testing`（此前给用户的是 `--end ut`，结构上过不了 evaluator 的 `run_binding`）。golden env **必须在起 run 的同一 shell、起 run 之前**设（candidate-release.mjs:135–146 的三步之二），否则采集仍是 P0-only。**首段是否保留由 P0.5 决定**：判「匹配」保留；判「不匹配」（当前 bc-openCard-1 基线即如此）去掉 `$env:MAISON_GOLDEN_CONTRACT = …;` 再起 run。**证据路径**：`<hostRoot>\doc\features\bc-openCard-1\goal-runs\<runId>\`。

**观察点（逐条给出真实落点，不要去 events 里找不在那儿的字段）**：

| # | 批 | 观察什么 | 在哪读 | 条件/陷阱 |
|---|---|---|---|---|
| A1 | B02 | closure-only 轮**无** `capability_receipt` 事件 | `goal-runs/<runId>/events.jsonl` | 先确认该轮**是** closure-only：其**前一条**同 phase `phase_verdict` 为 `verdict=PASS` ∧ `advance_blocked=true` ∧ `action=retry`（goal-runner-phase.ts:1122）。首轮就 `closure_status=closed` 时不存在该轮 → 记未覆盖，走 G② |
| A2 | B02 | `spec_refs_receipt_produced` 的 `carried_over>0` | 同上 | 只在 claude 格发（provenance 前置，goal-phase-runtime.ts:7630）；**首个 invocation 恒为 0**，须看 spec 的第 2 轮 |
| A3 | B01 | `next_action=run_verifier_for_repair` → `verifier_request` → `repair_candidates` → 下一轮回 coding | **失败轮的 harness `summary.json`**（不是 events；harness-runner.ts:1973 / :2006 / :2051） | 只有 review 负面裁决或 ut 全 `code_regression` 才进（verifier-plan.ts:297/:334），产品一次跑对即不命中 → 走 G① |
| A4 | B04 | PASS 且无 blocker 且**无 runtime 失败事实**的轮不含 `failure_kind_classified` | `events.jsonl` 的 `phase_verdict` | 三个条件并列核对；`hasRuntimeFailureEvidence`（goal-phase-runtime.ts:8202–8212）是 **10 个或项**，须**全假**：`operatorInterrupt`（:8203）/ `invoke.timed_out`（:8204）/ `apiErrorSentinel !== null`（:8205）/ `agentNoOutput`（:8206）/ `resolved.agent_failed`（:8207）/ `harnessExit !== 0` / `closureFinalizationError !== null` / `interactionSentinel !== null` / `defects.length > 0` / `unverified.length > 0`。上一版只列了六项，漏掉 operator interrupt、API 断流、no-output、interaction sentinel 四项——漏项会把"其实有失败事实"的轮误判成 B04 的接收项 |
| A5 | B04 | `reused_from_prior_review` 与实际一致 | **`goal-runs/<runId>/goal-report.json` 的 `phases[]`**——每个 outcome 的 `verifier_evidence.reused_from_prior_review`（[goal-report-generator.ts](../../harness/scripts/utils/goal-report-generator.ts):133 字段定义，[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):9102/:9136 把 `snapshotPhaseHarness` 的返回值挂进 outcome） | **落点纠正**：`phases/<phase>/harness/` 快照目录里只有复制过去的文件（summary.json / verifier.report.md 等），**没有** `verifier_evidence` 这份数据——它只存在于 goal-report.json 的 phases[]。**条件纠正**：置位要同时满足两条（[goal-phase-snapshot.ts](../../harness/scripts/utils/goal-phase-snapshot.ts):83–93/:111）——① 当前 subject 的报告**加载不通过**（`!loaded.ok`，:85）；② 从**快照里那份** summary 的 `verifier_closure.reviewed_subject_id` 回落读取**成功**（`fallback.ok`，:91–93）。只出现 `completed_with_prior_review` 而当前报告仍可用时，`reused_from_prior_review` **本就不会置位**，此时记"条件未成立/未覆盖"，**不得**据此判 B04 回归 |
| A6 | B05 | `profile_resolved=strict` | **check-receipt 的 stdout 行** `HARNESS_EVIDENCE_POLICY profile_resolved=… verifier=… trace=… exploration=…`（check-receipt.ts:1176–1178） | **两处都读不到，必须专门采集**：① 不是 events 字段——`evidence_policy_snapshot` 走 phase-state 回调，goal 编排在 phase-state.ts:219–220 早退不写盘；② `phase_verdict` 事件也不含任何 policy 字段（字段全集见 goal-phase-runtime.ts:8936–8975 的 `verdictEvent` + [goal-reconcile-boundary.ts](../../harness/scripts/utils/goal-reconcile-boundary.ts):43–48 只补 `action` / `reconcile_observation` / `assess_recommendation`）；③ goal 内部那次 check-receipt 是 `spawnSync` 子进程，**成功时 stdout 被直接丢弃**（phase-state.ts:411–412 只回 `{status:'passed', receipt_path, exit_code:0}`，不带 stdout）。**采集步骤**：每个阶段闭环后，在宿主另跑一次只读校验并把输出存证——`Set-Location <hostRoot>\framework\harness; npx ts-node scripts/check-receipt.ts --feature bc-openCard-1 --phase <p> --project-root <hostRoot> --skip-state-sync 2>&1 \| Tee-Object -FilePath <evidenceDir>\check-receipt.<p>.log`（参数取自 phase-state.ts:389–401 的同款 argv；`--skip-state-sync` 保证不改盘上状态），再 `Select-String -Path <evidenceDir>\check-receipt.<p>.log -Pattern 'HARNESS_EVIDENCE_POLICY'` |
| A7 | B05 | `it_drives_flow` 的**实际分支**与判定式一致 | ut 阶段 `script-report.json` 里该 check 的 `status` | **它不是恒 WARN**（[check-ut.ts](../../harness/scripts/check-ut.ts):2200–2270 三支，severity 恒 MAJOR）：无 UT 文件 → `SKIP`（:2201–2208）；有文件且 `weak.length === 0` → **`PASS`**（:2244–2256）；只有存在驱动力不足的 `it()` 才 → `WARN`（:2257–2270）。**按实际命中的那一支如实记**；产品 UT 写得达标时命中 PASS 是正常的，那意味着"数量口径不再判 FAIL"这条接收项**本轮未被触发验证**——登记为未覆盖并保持 `b05-host-acceptance` pending，**不得**把 PASS 当作"数量口径已验收" |

**判定**：真实 goal 调用发生 + A1–A7 逐条按上表条件读到（条件不成立的按"未覆盖"如实登记，**不写 PASS**）+ 无新增 blocker + `run_end.status ∈ {COMPLETED, CHAIN_SLICE_COMPLETED}` = C-U 通过。产品 FAIL 是合法中间态，须回 owner 修好并闭环。

#### E. golden evaluator（**A 一结束就跑，先于 B/C/D**）

    Set-Location <hostRoot>\framework\harness; npx ts-node scripts/consumer-golden/evaluate-bc-opencard.ts --project-root <hostRoot> --run-id <A的goalRunId> --feature bc-openCard-1 --expected-manifest-sha <重建后填入的 inZipManifestSha> --out <hostRoot>\doc\consumer-golden-report-A.json

**为什么 E 必须紧跟 A、且必须先保存报告**——evaluator 读的是**当前共享产物**，不是 A 的快照，同 feature 上任何后续运行都会把它们覆盖：

- coding 素材门读 `<feature>/coding/reports/summary.json` 并要求 `summary.run_id === <runId>`（evaluate-bc-opencard.ts:349/:361）；
- 十屏要求 `captured_in_run === <runId>`（:257–268）、`evaluated_screenshot_hash` 等于**盘上当前字节**（:280–293）、`evaluated_build_fingerprint` 等于**当前安装 build**（:295–307）；
- `run_binding` 要求该 run 最新 testing `verdict=PASS/action=advance` 且其**之后**有 `run_end ∈ {CHAIN_SLICE_COMPLETED, COMPLETED}`（:148–204）。

因此 A→B→C→D→E 的顺序会让 A 的证据被 B/C/D 覆盖，evaluator 必然 FAIL 且无法区分"框架回归失败"与"证据被覆盖"。**若无法保证顺序**，替代方案是给差异格用**独立验收副本**（另一份 `<hostRoot>` 拷贝），两者取其一，不得两者都不做。

另需宿主 `visual-diff-nav` 配置含 HomeTab 到达步骤，否则负向证据不生产、`ten_fixed_screens_exact_set` 与 forbidden 项必 FAIL。**判定**：`verdict=PASS` → 具备 promote 前提；任一 FAIL 先按 items 的 detail 分清是"证据绑定问题"还是"产品/框架问题"，不要一律记成回归失败。 P0.5 判「不匹配」的 run：evaluator 照跑、报告照存，结论保留 **FAIL** 原样并注明「验收样本不适用（contract 立项需求 ≠ 当前基线）」；不记 N/A、不改写历史结果、不从产物反推 contract。

#### B. C-N（Claude 非 goal）——只跑 review 阶段

**前置（P3b）**：本格要求 local `agent_adapter=claude`。若上一格是 codex 且用了 `--override-adapter`，local 已被回写成 `codex`——先按 P3b 的 `record-adapter` 那行改回（或用 claude 侧的独立副本）。

**入口**：Claude 交互会话里用物化后的斜杠命令 `/code-review`（模板 `agents/claude/templates/commands/code-review.md`；Skill→phase 映射见 [code-review/SKILL.md](../../skills/feature/code-review/SKILL.md):82，`code-review` → `--phase review`）。**有效上游**=A 已闭环的 coding 产物，不重写六阶段。会话内自跑：

    Set-Location <hostRoot>\framework\harness; npx ts-node harness-runner.ts --phase review --feature bc-openCard-1

**结束条件**：harness `verdict=PASS` ∧ `check-receipt` exit 0（阶段闭环判定，SKILL.md「阶段闭环判定」节）。**观察点**：① 无 goal 身份——`goal-runs/` 下**不新增** run 目录，manifest / run-control 不被绑定（`attended-goal-context`:198 "manual harness remains unbound" 的实测对照）；② harness 打印 `verifier.request.<subject>.json` 路径后，由**会话自己**用 Task 派发 `subagent_type: verifier`，并把回复**原样全文** Write 进 `summary.verifier_report` 指向的路径（`<reports>/verifier.report.<subject>.md`）；③ harness FAIL 时由**调用方自己**重跑本阶段（与 goal 的"回传本轮由外层重跑"不同，MIGRATION.md:229）。**证据路径**：`<hostRoot>\doc\features\bc-openCard-1\review\reports\summary.json` + 同目录 `verifier.report.<subject>.md`。**判定**：三条观察点齐 = C-N 通过；②③ 任一未发生（如 harness 直接 PASS 未签 request）→ 该条记未覆盖，不写 PASS。

#### C. X-U（Codex goal）——只跑 `review → ut`

    Set-Location <hostRoot>\framework\harness; npx ts-node scripts/goal-runner.ts --feature bc-openCard-1 --adapter codex --override-adapter --requirement-file '<hostRoot>\doc\features\原始需求\1-1-银行卡\原始需求.md' --start review --end ut --detach

**`--override-adapter` 不是可选修饰**（P3b）：A 跑完后 framework.local.json 记的是 `claude`，此时裸 `--adapter codex` 被 goal-preflight.ts:127–132 判 BLOCKER 拒启动。若走"独立验收副本"方案且该副本的 local 已是 `codex`，则去掉 `--override-adapter`（也可连 `--adapter` 一并去掉，local_config 优先）。跑完记得复核 local 已被回写为 `codex`（goal-phase-runtime.ts:5153–5157），回头跑 claude 格要再 override。

窗口刻意避开 spec（不重写六阶段）与 testing（不重复真机装机）；`review → ut` 在链序内合法（`FEATURE_PHASE_ORDER`，[upstream-verdict-gate.ts](../../harness/scripts/utils/upstream-verdict-gate.ts):23；`resolveAutoChain` 只拒 `startIdx > endIdx`，[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts):240）。**`--requirement-file` 不能省**：`start_phase` 非链首会触发截断链 preflight，它用 `manifest.requirement` 现算血缘哈希去比对上游 closure，requirement 缺失/空白直接 BLOCKER 拒启动（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):5036–5050）。**须与 A 用同一份需求文件**，否则上游 closure 判 stale、preflight 不放行——这正是"起点必须是有效上游"的机器口径（§5）。**观察点**：① 终态来自 `codex exec --json` 的 turn JSONL（`turn.completed` / `turn.failed`），`usage` 从末行读到（对照 `codex-terminal-closure` 的 :158/:165/:321/:338）；② verifier 子 agent 照常起（`agents/codex/adapter.yaml`:35 `verifier_subagent: true`），不因缺 Claude hook 被撤销；③ goal 身份成立（新 `goal-runs/<runId>/` + run-control）。

**视觉轴不在本窗口**：`ui_spec_fidelity_gate` 是 **spec 阶段**的门（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):274），`review → ut` 不经过它 → 该项**登记为未覆盖**，要补按 G-③。补跑时按**实际分支**判，别套四态：

| # | 宿主实际状态 | 走哪支 | 预期产物 |
|---|---|---|---|
| ① | `verified: verified` 但 `verified_method` 缺失/`none`/`human_gate` | :290 的**普通无效方法**分支（`soft = enforcement ∈ {warn, reachable}`，:291） | 软档 WARN/MAJOR，严格档 FAIL/BLOCKER（severity 表达式 :299）。这**不是**四态拒签，只是"方法值不合法" |
| ② | `verified: verified` + method 合法，但 `verifyVlSigningChain` 有 failure（:307–308） | **真正的四态拒签**（`unreachable` / `not_probed` / `not_yet` / `mismatch` 选词，headline 见 :313–318） | **恒 `severity: 'BLOCKER'` + `status: 'FAIL'`（:337–338，无 soft 三元运算）——软档不豁免、不得预期 WARN**。codex 格**只有在 spec 产物被改写成 `verified: verified` 时**才可能落此支（`unreachable`/`not_probed` 选词）；保持诚实 `unverified` 就走③/④，见 G③ |
| ③ | `verified: unverified`（含 legacy `human_confirmed` 归一，:288）+ 无 fresh `canary=tool_read` | :360 起的诚实说明分支 | 软档 **WARN/MAJOR**（可继续）、严格档 FAIL/BLOCKER（:378）——**软档下不是拒签，也不产生 `failure_kind_classified`** |
| ④ | `verified: unverified` + hard `pixel_1to1` + fresh `canary=tool_read` | :365 起的 `sightedPixel1to1` | 无条件 FAIL/BLOCKER（:378 的三元第一支），软档不豁免 |

> ①②的差别是本表上一版写错的地方：`verified=verified` 分支里其实**串了两道门**——先 :290 判 method 值是否合法（软档可 WARN），过了才 :307 走签名链验证；四态拒签只发生在**第二道**，而且它的 severity/status 是字面量常数，没有 soft 分支。把①的软档 WARN 当成"四态拒签的软档形态"会把一次真 BLOCKER 记成通过。

**只有实际落 FAIL 时**才核 `failure_kind_classified === 'spec_capture_gap'`（goal-failure-classifier.ts:638/:650）。

**判定**：①②③ 齐**且**满足闭环——`review` 与 `ut` 两个阶段各有 `phase_verdict{verdict=PASS, action=advance}`，`run_end.status ∈ {COMPLETED, CHAIN_SLICE_COMPLETED}`——才算 X-U 的终态/verifier/身份三项通过。**`turn.failed` 之后 `run_end.status=HALTED` 不算通过**：观察点①（终态解析正确）成立只证明 codex 信封解析对了，不证明 `review→ut` 这段链在 codex 下能走完；总plan:103 要求"必须有真实goal调用、目标生产行为及无直接回归"，中途 HALTED 是产品/框架失败的合法中间态，须回 owner 修好并重跑到闭环，不得当作"X-U 已验收"。视觉轴项按上表结论单独记，未补跑即"未覆盖（预期，结构性原因见 D2）"。

#### D. X-N（Codex 非 goal）——只跑 review 阶段

**前置（P3b）**：本格要求 local `agent_adapter=codex`。B 跑完后 local 是 `claude`——先按 P3b 的 `record-adapter` 那行改成 codex（或用 codex 侧的独立副本）。

**入口**：Codex 会话按物化后的 `AGENTS.md` 路由表（模板 [templates/AGENTS.md.template](../../templates/AGENTS.md.template):84–91 的阶段 Skill 总表 + :96 的执行规则）→ `.codex/skills/<phase>/SKILL.md` 跳板 → `framework/skills/feature/code-review/SKILL.md`（codex adapter `commands: null`，**没有**斜杠命令面）。会话内自跑与 B 完全相同的一行：

    Set-Location <hostRoot>\framework\harness; npx ts-node harness-runner.ts --phase review --feature bc-openCard-1

**结束条件**同 B。**观察点**：① 入口路径是"读 AGENTS.md 路由表 → SKILL"而非斜杠命令（会话记录里可查）；② 无 hook 依赖、无 goal 身份（`goal-runs/` 不新增）；③ 报告由会话写出（与 B② 同一份共享 verifier 协议文本，`.codex/rules`）；④ 终态块契约成立。**证据路径**同 B。**判定**：与 B 逐条对照——四条齐且与 B 的差异只在①，即 X-N 通过。

#### F. UT 复用与 report-only 分层取数（B03，UT 窗口跑过后）

    Set-Location <hostRoot>; Get-Content .\doc\features\bc-openCard-1\ut\reports\hvigor-ut-build.<module>.meta.json | ConvertFrom-Json | Select-Object durationMs, exitCode
    Set-Location <hostRoot>; Get-ChildItem -Recurse .\doc\features\bc-openCard-1\ut\reports\*\ut\execution-key.json | Select-Object FullName, LastWriteTime
    Set-Location <hostRoot>; Select-String -Path .\doc\features\bc-openCard-1\ut\reports\script-report.json -Pattern 'execution_key:'

> reports 落点以 P3 打印的 `reports_dir_pattern` 为准（默认 `doc/features/<feature>/<phase>/reports`，[config.ts](../../harness/config.ts):601；B03 §7 与 MIGRATION.md:531 漏了 `reports/` 这一层）。

- **F①（配对观察，缺一不可；两次调用都由 F 自己发起）**：`script-report.json` 是**同 feature 同 phase 的共享文件**，每次 UT 调用都写同一个路径（[report-generator.ts](../../harness/scripts/utils/report-generator.ts):147 恒 `path.join(dir, 'script-report.json')` + `writeFileSync`）——A 的 goal UT 与 C 的 `review → ut` 窗口写的是同一份，**谁都别指望回头读**。上一版把"第 1 次保存"挂在 A 的 UT 上，却把 F 整段排在 B/C/D 之后，与总顺序自相矛盾（C 的 UT 早把它覆盖了）。**改为：F 不依赖任何格留下的现场，自己连跑两次配对调用**（总顺序不变，F 仍在 B/C/D 之后）：

      # 先建证据目录（一次）
      Set-Location <hostRoot>; New-Item -ItemType Directory -Force <evidenceDir>\ut-pair | Out-Null
      # 第 1 次：强制真跑（--force-device 直接短路复用判定，保证 run1 一定是真跑）
      Set-Location <hostRoot>\framework\harness; npx ts-node harness-runner.ts --phase ut --feature bc-openCard-1 --force-device --summary --failures-only
      # 跑完立刻存
      Set-Location <hostRoot>; Copy-Item .\doc\features\bc-openCard-1\ut\reports\script-report.json <evidenceDir>\ut-pair\script-report.run1.json; Copy-Item .\doc\features\bc-openCard-1\ut\reports\summary.json <evidenceDir>\ut-pair\summary.run1.json
      # 第 2 次：同一输入、不加任何强制参数
      Set-Location <hostRoot>\framework\harness; npx ts-node harness-runner.ts --phase ut --feature bc-openCard-1 --summary --failures-only
      # 跑完立刻存（此时 run1 的副本已在盘上，不会被覆盖）
      Set-Location <hostRoot>; Copy-Item .\doc\features\bc-openCard-1\ut\reports\script-report.json <evidenceDir>\ut-pair\script-report.run2.json; Copy-Item .\doc\features\bc-openCard-1\ut\reports\summary.json <evidenceDir>\ut-pair\summary.run2.json
      # 对两份副本读复用行（不要读共享目录里的现场文件）
      Set-Location <hostRoot>; Select-String -Path <evidenceDir>\ut-pair\script-report.run1.json,<evidenceDir>\ut-pair\script-report.run2.json -Pattern 'execution_key:'

  **第 1 次为什么必须带 `--force-device`**：A/C 已经在同一份 reports 下留了同键成功 run，不加的话第一次调用就直接命中复用、配对不成立。`--force-device` 是 harness-runner 的既有开关（[harness-runner.ts](../../harness/harness-runner.ts):344 声明 / :433 帮助文案 / :678 `forceDevice` / :988 下传），在 UT leg 上把复用判定整段短路：`ctx.forceDevice → { reusable: null, reason: '--force-device：用户要求真跑' }`（[ut-host-impl.ts](../../profiles/hmos-app/harness/ut-host-impl.ts):1085）。**两次调用之间不得改产品源码、不得插入别的 UT/coding 动作**——输入一变执行键就变，第 2 次照样真跑。

  `script-report.run1.json` 应读到「**本轮真跑**：\<reason\>」，`script-report.run2.json` 应读到「**同键复用 `<stamp>`**：\<reason\>」，且第二轮 **0 次装机 / 0 次执行 hdc**（ut-host-impl.ts:1090/:1097/:1103，details 落点 :1234/:1260/:1273）。**前提：run1 必须绿**——`decideReuse` 只认 `outcome === 'success'` 的最新同键 run（[execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts):223；`roundOk` 的写入判据 ut-host-impl.ts:1137），run1 有用例失败时第 2 次仍是真跑，F① 记未覆盖、不得改判。**只跑一次、或跑了两次但没在各自调用后立即存副本，都不构成 B03 的行为验收。**

- **F①b（逐模块结果一致——`script-report.json` 证不了，必须比冻结件）**：PASS 支的 details 只写**整轮聚合数** `total=… passed=… failed=…`（ut-host-impl.ts:1242 的 `perModule.reduce`，文案 :1256–1259），**没有逐模块结果**；逐模块事实在每个 run 目录的冻结件里——`<reports>\<stamp>\ut\` 下有 `execution-key.json` 与逐模块 `frozen.ut-result.<module>.json` / `frozen.hdc-test.<module>.log`（文件名由 [execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts):75–80 的 `utFrozenRunArtifacts` 现算，冻结点 ut-host-impl.ts:1132，复用轮的回填点 :1103）。**复用轮同样写自己的 run 目录与冻结件**（记录/冻结块对真跑与复用两条路径共用，ut-host-impl.ts:1129–1149），所以两次调用各留一份可比对的副本。取证与比较：

      # ① 两次调用的 execution-key 记录（目录名是可排序 UTC 时间戳，扫描口径同 execution-key.ts:164）
      Set-Location <hostRoot>; Get-ChildItem .\doc\features\bc-openCard-1\ut\reports -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'ut\execution-key.json') } | Sort-Object Name -Descending | Select-Object -First 2 | ForEach-Object { $j = Get-Content (Join-Path $_.FullName 'ut\execution-key.json') -Raw | ConvertFrom-Json; "$($_.Name) key=$($j.execution_key.Substring(0,16)) outcome=$($j.outcome) timing_complete=$($j.timing_complete) frozen=$($j.frozen_files -join ',')" }
      # ② 逐模块冻结结果按哈希比对（run1=较早那条，run2=最新那条）
      Set-Location <hostRoot>; $d=@(Get-ChildItem .\doc\features\bc-openCard-1\ut\reports -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'ut\execution-key.json') } | Sort-Object Name -Descending | Select-Object -First 2); Get-ChildItem (Join-Path $d[1].FullName 'ut') -Filter 'frozen.*' | ForEach-Object { $a=(Get-FileHash $_.FullName).Hash; $p2=Join-Path $d[0].FullName ('ut\' + $_.Name); $b=if (Test-Path $p2) { (Get-FileHash $p2).Hash } else { '(缺)' }; "$($_.Name) equal=$($a -eq $b) run1=$a run2=$b" }
      # ③ 只在 equal=False 时看差在哪
      Set-Location <hostRoot>; Compare-Object (Get-Content <run1Dir>\ut\frozen.ut-result.<module>.json) (Get-Content <run2Dir>\ut\frozen.ut-result.<module>.json)

  **判据**：① 两份 `execution_key` **相等**（其余字段天然不同：`run_started_at`、`frozen_files` 顺序、`outcome`——**只比 `execution_key`，不要整文件比**），且 run1 的 `outcome=success`；② 每个 `frozen.ut-result.<module>.json` 与 `frozen.hdc-test.<module>.log` 两轮 `equal=True`——复用轮的这份是 run1 的冻结件走"回填顶层 → 解析 → 重新序列化 → 再冻结"一圈得来的（:1103 → :1132），预期逐字节相同。**哈希不等不等于回归**：先用 ③ 看差的是不是实质字段（`executed` / `exitCode` / `testResult.total|passed|failed|failures`），实质字段不同才是"复用改变了结果"，只差时间戳一类的按"序列化噪声"如实注明。**缺任一模块的冻结件 = 复用本就不该发生**（`decideReuse` 的 `missingExecution` 会拒绝复用，execution-key.ts:230–236），此时 run2 的复用行也会写成"重新真跑"，两处对不上即为框架回归。
- **F②（口径纪律）**：`durationMs` 是**本次真实发生**的那次构建耗时（hvigor-runner.ts:1763），**不是**被消除的第二次构建的耗时。登记表只记观测值 + 取数路径，写"一次 spawn + 日志不被覆盖"这一可证事实，**不写"节省了 X 秒"**。
- **F③（report-only 分层单独验收——须真的调一次，不能只读 A 留下的报告）**：`report_reconcile_only` 这个 check **只在 report-only 模式下产出**（[check-testing.ts](../../harness/scripts/check-testing.ts):5873 的 `shouldRunDevicePipeline(channelDeclaration, Boolean(ctx.reportReconcileOnly))` 决定走设备管线还是 report-only 分支），而 A 的 testing 阶段是**正常带设备**跑的——它的 `script-report.json` 里根本没有这条 check。**必须显式调用**：

      # testing 阶段闭环后（先把 A 的 testing 报告存证，同 F① 的理由）
      Set-Location <hostRoot>; New-Item -ItemType Directory -Force <evidenceDir>\testing | Out-Null; Copy-Item .\doc\features\bc-openCard-1\testing\reports\script-report.json <evidenceDir>\testing\script-report.device.json
      Set-Location <hostRoot>\framework\harness; npx ts-node harness-runner.ts --phase testing --feature bc-openCard-1 --report-reconcile-only --summary
      Set-Location <hostRoot>; Copy-Item .\doc\features\bc-openCard-1\testing\reports\script-report.json <evidenceDir>\testing\script-report.reportonly.json

  参数约束（[harness-runner.ts](../../harness/harness-runner.ts):714–715）：`--report-reconcile-only` **仅适用于带 feature 的 testing 阶段**，且**不能**与 `--sync-closure` 同时用（:567–568）；该模式跳过设备前置（:877）与 personal setup 门（:739）。

  **两桶场景**（check-testing.ts:2711–2745）：`hardIssues`（`issues` ∪ 命中性能 TC 的耗时缺口，:2713–2716）非空 → **FAIL**；`hardIssues` 空而 `derivedIssues`（`softIssues` 去掉性能类，:2717）非空 → **WARN** 且带 `failure_kind: 'derived_statistic_unavailable'`（:2739）；两桶皆空 → **PASS**（:2729–2730 的三元）。severity 三态恒 `BLOCKER`（:2735，即既有"BLOCKER 级 WARN"形态）——**别把 severity 当判据**。

  取 `<evidenceDir>\testing\script-report.reportonly.json` 里该 check 的 `status` + `details`，把 details 里逐条缺口按 hard / derived 归位记进登记表；**PASS / WARN / FAIL 三态分开记**，不能只记"过了"。想额外验 FAIL 支须在**隔离副本**上删掉某份 authoritative trace 或 test-plan 再跑一次 report-only（属 G 类隔离场景，不做也不阻断，登记为缺口）。

#### G. 隔离场景补跑（仅当 A/C 的对应观察点未自然命中；**用户在隔离验收副本上触发**）

> 前置：**先做完 E 并保存报告**（G 会改动共享产物，跑完 G 就不能再评 A 的 golden）。G 的每一项都是"没命中就登记 pending"，**不做也不阻断本批的其余结论**。

- **G①（补 B01 的回修链，对应 A3）**：目标是在**一条链内**跑出"review 负面裁决 → 候选 → 回退 coding → coding 重跑 → review 闭环 → `run_end` 成功"。

  **窗口必须是 `--start coding --end review`，`--start review --end review` 结构上跑不出回退**：回退目标是在**当前 run 的 chain 里**按名字找的——`const targetIdxBt = targetPhaseBt ? chain.indexOf(targetPhaseBt) : -1`（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):9158），`targetIdxBt < 0` 即改判 `action='halt'` / `haltReason='backtrack_target_absent'`（:9175–9183）。`--start review --end review` 的 chain 只有 `[review]`，`coding` 缺席 → 候选签发得再漂亮也只能 halt，第 2–4 步永远不成立。`--start coding --end review` 的 chain 是 `[coding, review]`，`targetIdxBt=0`，回退后 `phaseIdx = targetIdxBt - 1`（:9282）使下一轮落回 coding。

  **必须用 goal 跑，不能只跑 `harness-runner --phase review`**：B01 的接收项原文是"负面诊断 → owner 修复 → **窗口闭环**"，而"回退到 coding 再跑、再回 review 闭环"这段编排**只存在于 goal 编排里**——非 goal 下 harness FAIL 是由调用方自己决定重跑什么（MIGRATION.md:229），跑一条手动 `--phase review` 顶多证明 request 被签发了，证明不了自动回退与闭环。

  **步骤（次序是硬约束：窗口首个阶段就是 coding，缺陷必须在起 run 之前注入）**：

  1. **注入可控产品缺陷（在隔离副本上，`coding` 起跑前）**：只改**产品源码**，使某条**已在 `acceptance.yaml` 里、且不在本轮 `plan.md`/`contracts.yaml` 变更范围内**的 AC 明确不成立。选"plan 没点名的那条"是为了让缺陷活过 coding 第 1 轮——链首那轮 coding 是按 plan 实施，没有理由回头重写它；而 review 是按 `acceptance.yaml` 逐条核，照样能抓到。
     > **不得改 `spec.md` / `acceptance.yaml` / `plan.md` / `contracts.yaml`**：这四份是 spec/plan 两阶段 evidence manifest 的 outputs（[phase-evidence-manifest.ts](../../harness/scripts/utils/phase-evidence-manifest.ts):114–116），改一个字节就让上游判 stale，截断链 preflight 直接 BLOCKER 拒启动（goal-phase-runtime.ts:5068–5074）。产品源码**不在** manifest 的 inputs/outputs 集合里（条目只收 feature 工件 + `reports/` 产出，:359–370/:420–425），所以注入缺陷本身不污染上游血缘。
  2. **核对身份**（P3b；本格是 claude goal 格）。
  3. **起 run**（隔离副本）：

         Set-Location <isolatedRoot>\framework\harness; npx ts-node scripts/goal-runner.ts --feature bc-openCard-1 --adapter claude --requirement-file '<isolatedRoot>\doc\features\原始需求\1-1-银行卡\原始需求.md' --start coding --end review --detach

     > **截断链 preflight 对 `--start coding` 的上游要求**（chain[0] 非链首即触发，goal-phase-runtime.ts:5039）：upstream = `spec` + `plan` 两阶段（`fullWorkflowChain.slice(0, indexOf('coding'))`，链序 `spec/plan/coding/review/ut/testing` 见 [upstream-verdict-gate.ts](../../harness/scripts/utils/upstream-verdict-gate.ts):23）。三条硬要求：① `--requirement-file` 不能省且须**与 A 同源**（现算血缘哈希比对上游 closure，requirement 缺失/空白直接 BLOCKER，:5046–5053）；② `spec`、`plan` 各有 phase-evidence-manifest 且判 `fresh`（:5068–5074）；③ `upstream` 不含 `review` → **不要求** `review-closure-attestation.json`（:5072–5073）——这一条比 `--start review` 起跑**更松**（后者 upstream 含 `coding`，多一道血缘）。

  **判据（四步，缺一不算闭环）**：
  1. **签发**：失败轮的 harness `summary.json` 里 `next_action=run_verifier_for_repair`（harness-runner.ts:1973 的 `decideNextAction`）→ `verifier_request` 指向新签 request → `repair_candidates` 非空；
  2. **回退事件**：`events.jsonl` 出现 `phase_backtrack_requested`，其 `from_phase=review`、`to_phase=coding`、`reason='repair_candidates'`、`candidates` 非空（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):9227–9241 的 emit 点；同一 emit 的另一形态 `reason='upstream_gap'` 属上游缺口，不是本项）。**若读到 `phase_halt{halt_reason='backtrack_target_absent'}`，说明窗口开错了（chain 里没有 coding），改用本节的窗口重跑，不得记成"回退未触发"**；
  3. **coding 真被重跑**：该 `phase_backtrack_requested` **之后**出现 `phase=coding` 的 `agent_invoke_start` 与 `phase_verdict`（回退窗口的计数口径见 goal-phase-runtime.ts:2013–2028——窗口由一条 request 开启，窗口内目标 phase 的 `agent_process_settled`/`phase_verdict` 才计入 attempted）。**本窗口链首本来就有一轮 coding，别拿它冒充回退证据**：只认 `phase_backtrack_requested` 之后的那一轮；
  4. **闭环**：coding 之后 review 再跑一轮并拿到 `phase_verdict{verdict=PASS, action=advance}`，`run_end.status ∈ {COMPLETED, CHAIN_SLICE_COMPLETED}`。**停在 HALTED 或停在第 2 步只算"签发链成立"，不算 B01 的窗口闭环**——如实分成两行登记。

  **缺陷没活到 review 的情形**（coding 第 1 轮顺手把它改回来了 → review 首轮就 `PASS/advance`、全程无 `phase_backtrack_requested`）：**如实登记未覆盖**，`b01-host-acceptance` 保持 pending，可换一条 plan 未点名的 AC 重试；**不得**改判，也不得手工往 events 里补。

  缺陷用完须还原，且**不得**在正式验收副本上做。

- **G②（补 B02 的 closure-only 轮，对应 A1/A2）**：目标是让 spec 首轮走到"harness `verdict=PASS` 但回执未闭环"，下一轮即 closure-only（goal-runner-phase.ts:1122）。

  **`reason` 纠正——"缺 verifier 报告"走的是 `closure_open`，不是 `receipt_missing`**：`receiptStatus` 取自 summary 的 `receipt_status`，其值来自 `tryValidateReceipt`（harness-runner.ts:2328）；当前 subject 没有可用 verifier 正文时 check-receipt 判 FAIL、退出码 1，`tryValidateReceipt` 因此返回 **`status: 'failed'`**（[phase-state.ts](../../harness/scripts/utils/phase-state.ts):414–420），而 `resolveClosureAdvanceBlock` 只在 `receiptStatus === 'missing'` 时才给 `receipt_missing`（[goal-runner-phase.ts](../../harness/scripts/utils/goal-runner-phase.ts):141–143），落到最后一行 → **`{blocked: true, reason: 'closure_open'}`**（:144）。上一版按 `receipt_missing` 找证据会找不到，进而误判"分支没走到"。

  **必须新开 run，且缺口必须造在首次闭环之前**（上一版的"删报告再 `--resume`"两头都不成立）：

  - **封卷 run 拒绝一切重启**：`findLastRunEnd` 命中 `CHAIN_SLICE_COMPLETED` / `COMPLETED` 即打印 sealed BLOCKER 并 `return 1`，`--resume` / `--manifest` / `--force` / `--force-resume` 一律无效（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):4843–4850）。所以 A 那类已闭环的 run 不能拿来改造，只能新开。
  - **闭环之后再删报告也造不出缺口**：当前 subject 报告缺失时 check-receipt 先找**本 phase 既往 PASS 报告**沿用（[check-receipt.ts](../../harness/scripts/check-receipt.ts):730–732），命中就只出 `verifier_prior_pass_reused` MAJOR **WARN**（:749）、check-receipt 仍退出 0 → `receipt_status='passed'`，根本不落 `closure_open`。只有该 phase 从未有过 PASS 报告时才走 `verifier_evidence_report_missing` BLOCKER（:759）。

  **补跑步骤**（隔离副本；`<isolatedRoot>` 是一份**没跑过 spec** 的干净拷贝，若跑过先删掉 `doc\features\bc-openCard-1\spec\reports\verifier.report.*.md`）：
  1. **起 run 之前**先摘掉物化的 verifier 子代理，制造"报告写不出来"：

         Set-Location <isolatedRoot>; Remove-Item .\.claude\agents\verifier.md

     verifier 计划的 enabled/disabled 只看 `agents/claude/adapter.yaml` 的 `verifier_subagent: true`（[verifier-plan.ts](../../harness/scripts/utils/verifier-plan.ts):137–146 的 `adapterHasVerifierSubagent`），**与该文件是否物化无关** → 计划仍是 enabled，harness 照常签发 request 并写 `summary.verifier_subject_id`，而 phase agent 起不了 `subagent_type=verifier`、写不出 `<reports>/verifier.report.<subject>.md`（投递指令见 goal-phase-runtime.ts:1051–1052）→ check-receipt 落 `verifier_evidence_report_missing` BLOCKER、退出 1 → `tryValidateReceipt` 返 `'failed'` → `closure_open`。**跑完须还原**：重跑 P2 那条 `--smart-auto` 智能 UPDATE 即可把 `.claude/agents/verifier.md` 物化回来。
  2. 起 spec 窗口的 goal run（不带 `--resume`）：

         Set-Location <isolatedRoot>\framework\harness; npx ts-node scripts/goal-runner.ts --feature bc-openCard-1 --adapter claude --requirement-file '<isolatedRoot>\doc\features\原始需求\1-1-银行卡\原始需求.md' --start spec --end spec --detach

     若首轮因"起不了子代理"直接判非 PASS（agent 报错退出），该轮不构成 closure-only 的前置条件 → 如实登记未覆盖，不得改判；
  3. **读第 1 轮的 `phase_verdict`**：应为 `verdict=PASS` ∧ `advance_blocked=true` ∧ `advance_block_reason='closure_open'` ∧ `action='retry'`（字段落点 goal-phase-runtime.ts:8957–8958）——**这一条就是"下一轮是 closure-only"的机器判据**；
  4. 读第 2 轮（closure-only 轮）：`events.jsonl` 该轮内**无** `capability_receipt` 事件、spec 正文不因此重写；
  5. 读第 2 轮的 `spec_refs_receipt_produced.carried_over > 0`（首个 invocation 恒 0，见 A2）。

  第 3–5 步全成立才算 B02 两条接收项都覆盖；只到第 4 步（进了 closure-only 但第 2 轮没发 `spec_refs_receipt_produced`）就只勾"纯收口轮不重考"，`carried_over` 那条仍记未覆盖。

- **G③（补 X 格视觉轴，对应 C 的未覆盖项）**：在隔离副本上跑一段 **codex goal 的 spec 窗口**（`--adapter codex --requirement-file <同一份> --start spec --end spec`；`startIdx === endIdx` 合法，phase-transition-policy.ts:240 只拒 start 晚于 end），核对 `spec_refs_receipt_produced` **一条都不发**（provenance 前置 goal-phase-runtime.ts:7630 不成立）、`ui-spec.yaml` 保持 `verified: unverified`，并按 C 的**四分支表**判 `ui_spec_fidelity_gate` 的实际严重度。**该窗口会重写 spec 产物**，只能在隔离副本上做。

  **预期按分支写，不预设"恒落②"**：保持 `verified: unverified` 就**进不了①②**——`verified === 'verified'` 是那两支的唯一入口（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):288，四态拒签在 :307–308 之后），所以要求 unverified 又断言四态拒签是自相矛盾。unverified 下落 ③ 还是 ④ 由**两个宿主变量**决定，跑之前用 P3 的打印值先定：

  | `isHardPixelContract`（`fidelity_target=pixel_1to1` ∧ `acceptance_strictness=hard`，[fidelity-shared.ts](../../harness/scripts/utils/fidelity-shared.ts):678–679） | 该副本 `framework.local.json > vision.canary` | `spec.ui_spec_enforcement` | 预期 |
  |---|---|---|---|
  | 成立 | fresh 且 `verdict=tool_read`（按 local 的 `agent_adapter`=codex 核新鲜度，[multimodal-probe.ts](../../harness/scripts/utils/multimodal-probe.ts):343–352） | 任意 | **④：FAIL / BLOCKER**，软档不豁免（:378–379 三元第一支） |
  | 成立但无 fresh `tool_read` canary，或不成立 | 无 / 非 tool_read / 已过期 | `warn` 或 `reachable` | **③：WARN / MAJOR**，可继续，**不产生 `failure_kind_classified`** |
  | 同上 | 同上 | 其它（默认 strict） | **③：FAIL / BLOCKER**（:360 的 `soft` 为假） |

  只有实际落 FAIL 的那两种情形才核 `failure_kind_classified='spec_capture_gap'`（goal-failure-classifier.ts:638/:650）；落 WARN 时 B04 的归因项如实记未覆盖。
- **G④（补 B05 的 balanced 与 n/a，对应 §6 映射表两行）**：隔离副本上显式写 `evidence_profile: balanced` 后重跑一个阶段，核对 `HARNESS_EVIDENCE_POLICY profile_resolved=balanced` 且**保留集外**阶段的 verifier 转 off、`verifier_not_pass` 仍能拦下（B05 D1 的 off≠忽略）；n/a 出口需 plan 章节写「不适用：<依据>」且 contracts 对应集合为空（check-plan.ts:528 的三条前提全成立）。两项均**不跑也可以**，但那样必须在 §6 映射表里记缺口并保持 `b05-host-acceptance` pending。

### 完成判据

**本地完成**（L0–L4）：本 plan 细化通过评审、§6 三张表（证据等级 / 收益登记 / 五批 host todo 映射）就位、MIGRATION 索引段落盘、D7 已按 (b) 定案并写出四个消费点与实施口径、`check-plan-version` 与 `openspec:validate` 绿。本地完成**不等于**本批完成。

**§7.2 的前置**（不属本批提交，但 §7.2-E 跑不出 PASS 就永远缺 promote 前提）：P1（D7 (b) 的 evaluator `--feature`，独立 change）与 P2（候选件重建 + 三个真值填进运行单占位符）。**在这两项完成前跑 §7.2，A/B/C/D/F 的结论仍然有效，只有 E 恒 FAIL**——那是 feature 名不匹配，不是框架回归。

**本批完成**：四主格各有真实结论（未跑的格、以及 §6 映射表里未命中的接收项，一律保持 pending 并如实标注"未覆盖"而非"可选"）、登记表宿主字段回填、`b01`–`b05` 五条 `host-acceptance` 由真实证据勾掉。**只有到这一步**才勾 `b06-accept-matrix-delivery` 与总plan 里程碑。golden evaluator `verdict=PASS` 只是 promote 的**前提**；正式 `candidate:promote` 与 openspec 归档在本 plan 之后，不作为完成前置（总plan §6）。**不得**用本地通过、fixture 或回放冒充宿主证据。

## 8. 修订记录

### 2026-09-06：提纲细化为施工图（未实施、未提交）

- **纠正提纲与事实相反的两处表述**：只读宿主 `goal-runs/` 只有 09-05 的旧样本，B01–B05 交付后零新 run，故"前批均已有C-U宿主反馈""不等此批才首次上宿主"删除，改为 §1 的"用户尚未触发第一个检查点"。提纲 todo `b06-detail-from-host-evidence` 相应改名为 `b06-detail-from-local-evidence`，依据改成"B01–B05 本地证据 + 尚未触发的宿主检查点"。
- **todo 按"本地可做 / 用户触发"两分**（本地 5 条含细化本身，用户触发 4 条），§7 同步拆成 7.1 / 7.2 两段，宿主命令一律写成运行单。
- **窗口从 `--end ut` 改为 `--end testing`**（D1）：evaluator 的 `run_binding` 要求 testing 阶段 PASS/advance 且其后有成功 `run_end`，`--end ut` 结构性不可能通过。
- **发现并登记 D7（阻断 promote）**：`evaluate-bc-opencard.ts`:28 写死 `FEATURE='bc-openCard'`、CLI 无 `--feature`，而宿主唯一 feature 是 `bc-openCard-1`。给两条出路并推荐最短的 (b)，但明确须用户裁定、且属新 change 不夹带进本批。
- **纠正两处路径与一处 suite id**：`hvigor-ut-build.<module>.meta.json` 与 `execution-key.json` 实际落在 `<phase>/reports/` 下（`DEFAULT_PATHS.reports_dir_pattern`，config.ts:601），B03 §7 与 MIGRATION.md:531 均漏了 `reports/`；简报里的 `goal-adapter-capability` 在仓内实为 `goal-adapter-routing`（run-unit.ts:245）。
- **K-A 覆盖缺口如实登记**（D3）：`goal-adapter-routing` 四例全用合成 fixture，仓内无测试喂真实 codeagent adapter；结论改由 §7.1 一条 `ts-node -e` 现场调生产函数取值，等级记"生产函数"，不新增 suite。
- **X 格视觉轴定性为预期行为而非缺陷**（D2/D5）：`resolveEffectiveVisionContext` 只看 primary adapter，delegated visual provider 不参与该轴；codex `image_input: none` + `tool_event_provenance: none` → 不签 `vl_multimodal`，正确产物是四态拒签 + `verified: unverified`，且其归因应为 `spec_capture_gap`——顺带成为 B02/B04 在 X 格的验收点。
- **MIGRATION 只补索引不重写**（D6），并记录 B01/B02 与 B03–B05 的标题层级不齐但**不改**（会打断已发出的锚点，收益为零）。
- 全部行号为本次核实时的实际位置（工作树 HEAD=`8b2bd819`、干净）。

### 2026-09-06：codex 对施工图的 adversarial review 第 1 轮（10 条 finding 全数采纳，未实施、未提交）

| # | 级别 | codex 指出的问题 | 本轮修订落点 |
|---|---|---|---|
| 1 | high | D7 裁定没接进运行单：共同前置仍指旧 zip、E 无 `--feature` 且钉死旧 manifest SHA；且 `FEATURE` 另有多个消费点（evaluate-bc-opencard.ts:98 指纹、:349 coding 报告等），"三行改动"低估 | D7 改写为**已裁定 (b) + 四个消费点表 + 实施口径**（CLI `--feature` 默认 `bc-openCard` 不变、`GoldenEvalInput.feature` 同步、默认等值回归）；新增 todo `b06-candidate-rebuild-after-d7`；§4 加 P1/P2 两行（本批之外）；§7.2 加 **P0 取值命令**，zip/sha256/manifest SHA 全改占位符；旧候选件明确只作旧版本回归证据 |
| 2 | high | golden 裁决必须早于同 feature 的差异运行：evaluator 读**当前共享** coding summary 并要求 `run_id` 相等（:349/:358），十屏要求本 run 采集（:257）、当前字节（:280）与当前 build（:296） | §7.2 顶部写死执行顺序 **前置 → A → E（立刻保存报告）→ B/C/D → F → G**；E 段单列"为什么 E 必须紧跟 A"并逐条附行号；给出"独立验收副本"作二选一替代 |
| 3 | high | spec→testing 不保证触发 B01/B02：closure-only 需前轮 `PASS+advance_blocked+retry`（goal-runner-phase.ts:1122）；诊断 verifier 只在 review 负面裁决或 ut 全 `code_regression` 时签发（verifier-plan.ts:297/:334）且需缺可用报告（harness-runner.ts:1982）；`carried_over` 可能为 0（goal-phase-runtime.ts:7657） | A 段观察点改为 **A1–A7 逐条表**，每条写明真实落点与触发条件；`carried_over` 改为 `carried_over>0` 且指明"须看 spec 第 2 轮"；新增 **§7.2-G 隔离场景补跑运行单**（G① 注入可控产品缺陷触发 B01 回修链、G② 造 `receipt_missing` 触发 closure-only）；未命中一律保持 pending |
| 4 | high | B03 取数不能替代行为验收：列执行键文件证明不了命中复用分支（ut-host-impl.ts:1082 附近）；未覆盖 `report_reconcile_only` 的 hard/derived 分层（check-testing.ts:2711）；`durationMs` 是保留下来的构建耗时而非被消除的第二次构建 | F 段重写为 **F①配对观察 / F②口径纪律 / F③report-only 分层**：F① 要求"内外层同输入两次 UT 调用"并读 `execution_key:` 行的复用 reason，缺第二次即补一次；F③ 单独验收 hard=FAIL / 仅 derived=WARN 两桶；D5 与 §5 同步加"不得称节省量" |
| 5 | high | 收口条件遗漏 B04/B05 接收项：B04 的既往报告回落与 `reused` 标记（goal-phase-snapshot.ts:79/:111）未进运行单；B05 的 balanced 与 n/a 在默认 strict 下结构上进不去（runtime-policy.ts:412 / check-plan.ts:528） | §6 新增**「五批 host todo → 运行单观察点」12 行映射表**，逐项给落点与"未跑时的处置"；A5 观察点补 `reused_from_prior_review`；balanced/n/a 明确登记为缺口、`b05-host-acceptance` 保持 pending，并列进 G④；§5 对应边界行改写 |
| 6 | medium | 观察字段放错产物：`next_action` 在 harness summary（harness-runner.ts:1973）；`evidence_policy_snapshot` 经 phase-state 回调保存（check-receipt.ts:1199）而 goal 编排在 phase-state.ts:219 早退不写；PASS 无 blocker 仍可能有 runtime 失败事实（goal-phase-runtime.ts:8202） | A3 改指"失败轮的 harness `summary.json`"；A6 改指 check-receipt stdout 的 `HARNESS_EVIDENCE_POLICY` 行（check-receipt.ts:1176）与 `phase_verdict`，并写明 events 里没有该字段；A4 补"无 runtime 失败事实"六个或项 |
| 7 | medium | X 格要求同时出现的结果属不同分支：四态拒签只在 `verified=verified` 分支（spec-ui-spec-check.ts:288）；诚实 `verified: unverified`（:360）产生普通说明、软档可 WARN；adapter 声明不能代替 override/canary 实际结果（effective-vision-context.ts:69–116） | D2 段改写：`resolveCapabilityAxis` 三来源**有优先级**，codex 的 `image_input: none` 只是 `adapter_declared` 兜底，不是"canary 实测"；C 段给**三分支验收表**（四态拒签 / 诚实 unverified 软档 WARN / `sightedPixel1to1` 无条件 FAIL），只在实际 FAIL 时核 `spec_capture_gap`；§5 把"无法终签"与 pixel_1to1 整体能力拆开表述 |
| 8 | medium | 宿主命令 shell 与 cwd 不闭合：A 在 `framework/harness`，E 却写 `harness/scripts/...`；标 PowerShell 却用 Bash 反斜杠续行 | §7.2 全部命令改为**带 `Set-Location` 的 PowerShell 单行**（PS 5.1 无 `&&`、反斜杠非续行符）；E 统一在 `framework/harness` 下跑 `scripts/consumer-golden/evaluate-bc-opencard.ts`；F 的 `cat`/`ls -l` 换成 `Get-Content`/`Get-ChildItem`/`Select-String` |
| 9 | medium | 差异格缺可执行片段与独立判定：C-N/X-N 未选定 feature、阶段、有效上游、结束条件，X-U 直接复制整条 A；Skill 名与 harness phase 有映射 | B/C/D 各选定一个片段并写全入口/命令/结束条件/判定：**B=C-N 只跑 `review`**（`/code-review` → `--phase review`，SKILL.md:82）、**C=X-U 跑 `--start review --end ut`**（另核实截断链 preflight 要求 `--requirement-file` 与 A 同源，goal-phase-runtime.ts:5036–5050）、**D=X-N 只跑 `review`**（AGENTS.md 路由表 :84–91/:96 → `.codex/skills` 跳板）；附 Skill→phase 映射（`code-review`→review、`business-ut`→ut，business-ut/SKILL.md:157） |
| 10 | medium | K-A 现场取值命令在仓根不可执行（仓根无 `tsconfig.json`，报 `Unexpected token 'export'`） | §7.1 改为 `npx ts-node --project harness/tsconfig.json -e "…"` 并附**本次实测输出** `{"kind":"manual","reason":"adapter 不支持 phase 隔离，回退为手动 harness+assess"}` |

- 本轮另核实并写入的机器事实：`resolveAutoChain` 只拒 `startIdx > endIdx`（phase-transition-policy.ts:240），故 `--start review --end ut` 与 `--start spec --end spec` 均合法；`framework.config.json` 的 `evidence_profile` 是顶层键（config.ts:465），`ui_spec_enforcement` 在 `spec` 下（harness-runner.ts:956）——§7.2 的 P3 一次性打印这两项与 `reports_dir_pattern`、`agent_adapter`，避免事后猜分支。
- 既定裁决未被推翻：宿主动作仍由用户触发、K/A 不新增支持、不热改候选件、版本不 bump、openspec 归档仍属发布运维、D7 仍走 (b) 且作为独立 change。

### 2026-09-06：codex 对施工图的 plan review 第 2 轮（8 条 finding 全数采纳，未提交）

| # | 级别 | codex 指出的问题 | 本轮修订落点（行号为核实时实际位置） |
|---|---|---|---|
| 1 | partial（承第 1 轮 #3） | §7.2-G① 只写手动 `--phase review`，证明不了 B01 要求的"自动回退并闭环"；G② 把"缺 verifier"的 block reason 误写成 `receipt_missing` | G① 改为 **goal 补跑**（`--start review --end review`，或 `--start coding --end review`）+ **四步判据**：签发 → `phase_backtrack_requested{from_phase:review,to_phase:coding,reason:'repair_candidates'}`（goal-phase-runtime.ts:9227–9241）→ coding 真被重跑（窗口口径 :2013–2028）→ review 再 `PASS/advance` 且 `run_end` 成功；停在第 2 步只算"签发链成立"。G② 按真实路径改写：check-receipt 退出 1 → `tryValidateReceipt` 返 `'failed'`（[phase-state.ts](../../harness/scripts/utils/phase-state.ts):414–420），`receiptStatus==='missing'` 不成立（[goal-runner-phase.ts](../../harness/scripts/utils/goal-runner-phase.ts):141–143）→ 落 **`closure_open`**（:144）；补跑步骤改读 `advance_block_reason='closure_open'`（事件字段 goal-phase-runtime.ts:8957–8958）。§6 映射表 B01 行同步 |
| 2 | partial（承第 1 轮 #4） | F① 在 C 格 UT 之后才读共享 `script-report.json`，那时它已被覆盖；F③ 只写"取 script-report 里该 check"，没写它**怎么才会存在** | F① 改为**每次 UT 调用后立即 `Copy-Item` 保存配对副本**到 `<evidenceDir>\ut-pair\`，`Select-String` 只读副本不读现场。F③ 补**实际调用**：`--phase testing --feature <f> --report-reconcile-only --summary`——A 的 testing 是带设备跑的，其报告里根本没有 `report_reconcile_only` 这条 check（分支决策点 [check-testing.ts](../../harness/scripts/check-testing.ts):5873 的 `shouldRunDevicePipeline`）；另补参数约束（[harness-runner.ts](../../harness/harness-runner.ts):714–715 仅 testing+feature、:567–568 与 `--sync-closure` 互斥、:877/:739 跳设备与 personal 门）与两桶归属（check-testing.ts:2713–2717 分桶、:2729–2730 三态、:2735 severity 恒 BLOCKER、:2739 `derived_statistic_unavailable`） |
| 3 | partial（承第 1 轮 #5） | `verifier_evidence.reused_from_prior_review` 的落点写成快照目录，且把 `completed_with_prior_review` 当充分条件 | A5 与 §6 映射表 B04 行改写：落点是 **`goal-report.json` 的 `phases[].verifier_evidence`**（[goal-report-generator.ts](../../harness/scripts/utils/goal-report-generator.ts):133 字段、goal-phase-runtime.ts:9102/:9136 挂载），快照目录里只有复制的文件；置位须**同时**满足"当前 subject 加载不通过（[goal-phase-snapshot.ts](../../harness/scripts/utils/goal-phase-snapshot.ts):85）+ 回落 subject 加载成功（:91–93）"，仅有 `completed_with_prior_review` 时该标记本就不置位，记未覆盖而非回归。D5 的 B04 条目同步（原引 `:79` 亦纠正为 `:85`） |
| 4 | partial（承第 1 轮 #6） | A6 没有 stdout 采集步骤（goal 内部那次 check-receipt 成功时 stdout 被丢弃）；A4 的"无 runtime 失败事实"只列了六个或项 | A6 补**三条读不到的理由**（events 无该字段 / `phase_verdict` 无 policy 字段，字段全集见 goal-phase-runtime.ts:8936–8975 + [goal-reconcile-boundary.ts](../../harness/scripts/utils/goal-reconcile-boundary.ts):43–48 / [phase-state.ts](../../harness/scripts/utils/phase-state.ts):411–412 成功时只回三字段不带 stdout）与**显式采集命令**（另跑 `check-receipt.ts … --skip-state-sync` 并 `Tee-Object` 存日志，argv 照 phase-state.ts:389–401）。A4 与 D5 的 B04 条目补全 `hasRuntimeFailureEvidence` 的 **10 个或项**（goal-phase-runtime.ts:8202–8212），补上原先漏的 operator interrupt / API 断流哨兵 / agent 无输出 / interaction 哨兵 |
| 5 | partial（承第 1 轮 #7） | C 表把"method 缺失/none/human_gate"当成四态拒签的软档形态；真正的四态拒签恒 BLOCKER/FAIL | C 表拆成**四行**并加说明段：① :290 的普通无效方法分支（`soft` 见 :291，severity :299，可 WARN）；② :307–308 的 `verifyVlSigningChain` 失败 = **真正四态拒签**，`severity:'BLOCKER'` / `status:'FAIL'` 是字面量（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):337–338），**软档不得预期 WARN**；③ :360 诚实 unverified 软档 WARN；④ :365/:378 的 `sightedPixel1to1` 无条件 FAIL |
| 6 | partial（承第 1 轮 #9） | C（X-U）的判定只列①②③三项，没有"链真的走完"这一条 | C 判定补：`review` 与 `ut` 各有 `phase_verdict{PASS, advance}` + `run_end.status ∈ {COMPLETED, CHAIN_SLICE_COMPLETED}`；**`turn.failed` 后 `run_end=HALTED` 不得算通过**（观察点①只证明 codex 信封解析对，不证明链闭环），依据[总plan](pipeline_master_9c6e2a41.plan.md):103 |
| 7 | **high（新）** | §7.2 的 adapter 切换根本没接进运行单：local 身份为 `claude` 时 §7.2-C:298 的裸 `--adapter codex` 会被直接拒；P3 只读 project config，漏掉权威身份 | P3 补读 **`framework.local.json > agent_adapter`**（[framework-local-config.ts](../../harness/scripts/utils/framework-local-config.ts):19/:511，[goal-preflight.ts](../../harness/scripts/utils/goal-preflight.ts):100 优先读它；非 goal 侧同样受制于 [phase-personal-prerequisites.ts](../../harness/scripts/utils/phase-personal-prerequisites.ts):25 无条件的 `agent_adapter` 前置）。新增 **P3b 每格前核对表**：goal 格用 `--adapter <x> --override-adapter`（裸请求被 goal-preflight.ts:127–132 BLOCKER），非 goal 格走 `init-orchestrate.ts --scope personal` 的 `record-adapter`（[init-task-planner.ts](../../harness/scripts/utils/init-task-planner.ts):315，官方两条出路话术 [personal-setup-gate.ts](../../harness/scripts/utils/personal-setup-gate.ts):605）；并写明 `--override-adapter` **会回写 local**（goal-phase-runtime.ts:5153–5157），故推荐 claude/codex 各用独立验收副本（与 E 的副本方案同一份）。C 命令补 `--override-adapter`，B/D 各补一行身份前置 |
| 8 | **medium（新）** | A7 把 `it_drives_flow` 的条件性 WARN 写成恒值 | A7 与 §6 映射表 B05「数量口径」行改写为**三支实录**（[check-ut.ts](../../harness/scripts/check-ut.ts):2201 无文件 SKIP / :2244 无弱用例 PASS / :2257 有弱用例才 WARN，severity 三支恒 MAJOR）；明确"跑了但命中 SKIP/PASS 也算该接收项未覆盖"，保持 `b05-host-acceptance` pending，不用 PASS 冒充 |

- 本轮另核实的机器事实：`--override-adapter` 的回写发生在 preflight 全过、run 即将 commit 之后（goal-phase-runtime.ts:5149–5157），`--dry-run` 组合不写盘；`report_reconcile_only` 的 severity 三态恒 `BLOCKER`，判据只看 `status`。
- 既定裁决仍未被推翻：宿主动作由用户触发、K/A 不新增支持、不热改候选件、版本不 bump、openspec 归档属发布运维、D7 走 (b) 且作为独立 change。

### 2026-09-06：codex 运行单复核第 2 轮（3 条 finding 全数采纳，只改 §7.2 与 §8，未实施、未提交）

- **G① 默认窗口跑不出规定回退（medium）**：`--start review --end review` 的 chain 只有 `[review]`，回退目标按 `chain.indexOf(targetPhase)` 解析（goal-phase-runtime.ts:9158），`coding` 缺席即 `< 0` → 改判 `halt` / `backtrack_target_absent`（:9175–9183），四步判据的第 2–4 步结构上不可能成立。**窗口改为 `--start coding --end review`**（`targetIdxBt=0`，回退后 `phaseIdx = targetIdxBt - 1` 落回 coding，:9282），并据此重排步骤：缺陷在 **coding 起跑前**注入、只改产品源码（`spec.md`/`acceptance.yaml`/`plan.md`/`contracts.yaml` 是 spec/plan 的 evidence manifest outputs，phase-evidence-manifest.ts:114–116，动一字节即上游 stale → preflight BLOCKER，goal-phase-runtime.ts:5068–5074；产品源码不在条目集内，:359–370/:420–425），选"plan 未点名但 `acceptance.yaml` 已覆盖"的 AC 让缺陷活过链首那轮 coding。核实并写入 `--start coding` 的截断链 preflight 上游要求（:5039 触发，upstream=`spec`+`plan`，链序 upstream-verdict-gate.ts:23）：`--requirement-file` 须与 A 同源（:5046–5053）、两阶段 manifest 判 fresh（:5068–5074）、**不要求** `review-closure-attestation.json`（`upstream` 不含 review，:5072–5073，比 `--start review` 起跑更松）。判据第 2 步补 `backtrack_target_absent` 的排错口径，第 3 步补"链首那轮 coding 不算回退证据"，另补"缺陷被链首 coding 顺手修掉 → 如实登记未覆盖"。
- **F① 配对取证时机与执行顺序冲突（medium）**：总顺序是 A → E → B/C/D → F，而上一版把"第 1 次保存"挂在 A 的 UT 上——C 的 `review → ut` 早已把共享 `script-report.json` 原地覆盖（report-generator.ts:147 恒写同一路径）。**取 codex 给的第二条出路**：F 不再依赖任何格的现场，**自带两次配对调用**（同输入连跑两次 UT harness，总顺序不变）。第 1 次必须带 `--force-device`——A/C 已留下同键成功 run，不加就直接命中复用；该开关在 UT leg 上短路复用判定（harness-runner.ts:344/:433/:678/:988 → ut-host-impl.ts:1085）。另补"两次调用之间不得改产品源码/插入别的 UT 动作"（换执行键即第二次照样真跑）与"run1 必须绿"（`decideReuse` 只认 `outcome==='success'`，execution-key.ts:223）两条前提。
- **F① 保存文件证不了逐模块一致（medium）**：`ut_hvigor_test` 的 PASS details 只有整轮聚合数 `total/passed/failed`（ut-host-impl.ts:1242 的 reduce、:1256–1259 文案），逐模块事实在冻结件里。新增 **F①b**：核实文件名为 `frozen.ut-result.<module>.json` / `frozen.hdc-test.<module>.log`（execution-key.ts:75–80 的 `utFrozenRunArtifacts`），落点 `<reports>\<stamp>\ut\`，且**复用轮同样写自己的 run 目录与冻结件**（记录/冻结块对两条路径共用，ut-host-impl.ts:1129–1149）；给出三条 PowerShell 单行——`Get-ChildItem` 按目录名倒序定位最新两条 run（扫描口径同 execution-key.ts:164）打印 `execution_key`/`outcome`/`frozen_files`、`Get-FileHash` 逐冻结件比对、`Compare-Object` 只在不等时看差异；判据写明"只比 `execution_key` 不比整文件""哈希不等先分清序列化噪声与实质字段""冻结件缺失时复用本就不该发生（missingExecution 拒绝复用，execution-key.ts:230–236）"。

## 实施记录

### 2026-09-06：codex plan review 第 2 轮八处修正 + 本地 todo 实施（未提交、未跑宿主、未重建候选件）

工作树 HEAD=`8b2bd819`（`git log --oneline c1208c1f..HEAD` 得 19 笔，末笔 `0b54198a` 不属本组 → B01–B05 共 **18 笔**，与 §1 记录一致）。行号为实施后的实际位置。

#### ① 八处施工图修正（步骤一）

逐条落点见 §8「codex plan review 第 2 轮」表，不在此重复。八处修正**只改本 plan 正文**，无生产代码改动。

#### ② D7 (b)：evaluator `--feature`（唯一生产改动，属独立提交）

| 落点 | 行为变化 |
|---|---|
| [evaluate-bc-opencard.ts](../../harness/scripts/consumer-golden/evaluate-bc-opencard.ts):32–33 | `const FEATURE = 'bc-openCard'` → `const DEFAULT_FEATURE = 'bc-openCard'`（加 JSDoc 说明它是 `--feature` / `GoldenEvalInput.feature` 的缺省值） |
| :72–73 `GoldenEvalInput` | 新增可选 `feature?: string`（导出 API 同步开轴，否则包内其它调用方与测试拿不到） |
| :125 `evaluateConsumerGolden` | 新增 `const feature = input.feature?.trim() || DEFAULT_FEATURE;`——**空白串也回落默认**（`--feature ""` 不得把 featureDir 打歪） |
| :99/:105 `currentBuildFpOf` | 签名加 `feature: string`，`resolveCurrentBuildFingerprint(projectRoot, feature, 'testing')`（**消费点 1**：build 指纹，喂 `build_binding_available` / `build_binding`） |
| :131 | `featureDir(projectRoot, feature)`（**消费点 2**：`goal-runs/<runId>/events.jsonl` 的 `run_binding`、`device-testing/**` 的 `screen_identity` / `no_crash` / forbidden 的根） |
| :208 | `currentBuildFpOf(projectRoot, feature)` 调用点同步 |
| :349 | `featurePhaseReportsDir(projectRoot, feature, 'coding', frameworkRoot)`（**消费点 3**：素材门读的 coding `summary.json`） |
| :506 | 报告体 `feature: FEATURE` → `feature`（**消费点 4**：promote 与人读的溯源锚） |
| :528–536 CLI `main` | 用法行补 `[--feature <name>（缺省 bc-openCard）]`；`evaluateConsumerGolden({… feature: argOf(argv, '--feature')})` |
| :17–24 文件头 CLI 注释 | 补 `--feature` 与"默认值下逐字不变"的口径说明 |
| [candidate-release.mjs](../../scripts/candidate-release.mjs):145–149 | `candidate:build` 打印的第 3 步 evaluator 命令补 `--feature <宿主 feature 目录名>`，并加两行说明为什么不传会必 FAIL |
| [MIGRATION.md](../../MIGRATION.md) 新增「3.0.x：consumer golden evaluator 加 `--feature`」小节 | 非 Breaking；写明默认值零变化 + 消费者动作（宿主 feature 目录名不是 `bc-openCard` 时须显式传） |

**登记方式**：`openspec/specs/` 三十个目录逐个核对，**没有** consumer-golden 相关能力（唯一提及处是已归档的 `changes/archive/2026-09-03-golden-nav-target-unification/tasks.md`）。按仓库约定不开新 change 目录，只登记 MIGRATION + 本 plan（D7 已补记）。

**回归**（[consumer-golden.unit.test.ts](../../harness/tests/unit/consumer-golden.unit.test.ts)，在既有套件里扩，不新建 suite；`run-unit.ts`:151 的 id 仍是 `consumer-golden`）：`setupHost()` 加可选 `feature` 形参（默认 `FEATURE`，内部三处 `FEATURE` 改读形参），新增三例——

| 用例 | 反证什么 |
|---|---|
| 「默认等值回归：显式传 feature=bc-openCard 与不传，报告除 generated_at 外逐字节相等」 | 四个消费点全部投影进这份报告（`feature` 字段 / featureDir → 十屏与事件与 forbidden 项 / reportsDir → `required_assets` / 指纹 → `build_binding*`），逐字节相等即**默认行为零变化**；另断言空白 `feature` 回落默认 |
| 「feature 贯通：宿主目录名为 bc-openCard-1 时，传 feature 全项 PASS；不传则默认名读不到产物」 | 正向证明四处都真的切换了；反向证明不传时 `run_binding` / `build_binding_available` / `required_assets` 三项**同时** FAIL——正是 D7 描述的宿主阻断形态 |
| 「CLI：--feature 被真正解析（flag 名回归；不传时仍是默认 feature）」 | 直接调导出的 `main(argv)`，防 flag 名写错却被 API 层测试掩盖（源码树无 `RELEASE-MANIFEST.sha256` → `candidate_binding` 必 FAIL，故只断言 flag 解析与 `run_binding`，不断言总裁决） |

`consumer-golden` 套件由 **21 例 → 24 例**，全 PASS。

#### ③ b06-matrix-evidence-inventory（L1）

§6 首表（九格 × 等级 × 落点 × 缺口）**未改结论**，只补一张「本地复验记录」表：上一轮只核对了 `run-unit.ts` 的 suite id，未打开 suite 文件核行号。本轮把三处补齐——`codeagent-adapter` 五处、`codex-terminal-closure` 十一处、`goal-runner-testing-integrity` 两处、`attended-goal-context` 一处，**逐一命中，零订正**。另记：`codex-terminal-closure` 用 `run(results, '<name>', …)` 形态而非对象数组，上一轮的 `name:` 正则匹配不到，这是它一直没被复验的原因。K-A 现场取值原样记入：`{"kind":"manual","reason":"adapter 不支持 phase 隔离，回退为手动 harness+assess"}`，与上一轮取值逐字相同。

#### ④ b06-benefit-and-gap-ledger（L2）

§6 在既有「格级」登记表之外新增「批次级收益与缺口登记表」，列为 **批次 / 观察点 / 取数命令 / 观测值 / 等级 / 缺口**，并写死两条纪律：观测值只写读到的原值（不写百分比、不写"节省量"）；未取数写「待填（\<哪张运行单\>）」而非"可选"。本地能填的已填——候选件 zip sha `4c95abad…3436` / in-zip manifest sha `ec601b75…1a37`（**且如实标注它是 D7 (b) 之前构建的，其包内 evaluator 无 `--feature`，§7.2-E 恒 FAIL**）、本地单测总量、consumer-golden 21→24、五批各自的 codex review 轮数（B01 三轮 / B02 两轮 / B03 两轮 / B04 一轮 approve / B05 三轮 + 调度者把关 / B06 施工图两轮）。另附「各批触及的 suite」表（`git diff --name-only` 现取），标明只作回归定位、**不是行为证据**。

#### ⑤ b06-candidate-and-migration-final（L3）

[MIGRATION.md](../../MIGRATION.md) 新增「3.0.x 索引：六阶段重构 B01–B05」一节——五行表，每行 = 小节标题 + 一句话 + 消费者动作，**只索引不重写既有五节**；明确唯一需要动手的是 B01（重新物化 `.claude/agents/verifier.md`、`phase-executor.md` 与 Stop hook，`.cac` 同），其余四批"无需动手"。按 D6 如实记录 B01/B02 是 `###`、B03–B05 是 `##` 的层级不齐，并写明**不改**（改标题会打断已发出的锚点）。openspec 五个 change 目录逐个核对齐全（各含 `proposal.md` / `tasks.md` / `specs/`），与 B01–B05 一一对应，归档仍不在本批。

#### ⑥ 保持 pending 的项（未做，原因如实）

- `b06-candidate-rebuild-after-d7`：**本地不跑 `candidate:build`**，由调度者统一跑；跑完才把新的 zip / sha256 / in-zip manifest sha 填进 §7.2 的 P0 占位符与上表。
- 四条宿主 todo（`b06-host-merged-cu-run` / `b06-host-diff-cells` / `b06-host-golden-and-promote` / `b06-release-readiness-closeout`）与 `b01`–`b05` 五条 `host-acceptance`：全部由用户在验收宿主触发，未跑即 pending，不用 fixture / 回放冒充。

### 验收结果

| # | 命令 | 结果 |
|---|---|---|
| V1 | `node scripts/check-plan-version.mjs` | **PASS**（`mode=default current=3.0.0`） |
| V2 | `npm --prefix harness run typecheck` | **PASS**（exit 0，`tsc --noEmit -p tsconfig.typecheck.json` 无输出） |
| V3 | `npm --prefix harness run test:unit -- --filter consumer-golden` | **PASS=24 FAIL=0**（改动前 21，新增 3 例；suite id 取自 run-unit.ts:151） |
| V4 | `npm --prefix harness run test:unit`（全量，§1 指出条数从未落盘，本轮取值） | **PASS**（`309` 个 suite，`3889 passed, 0 failed`——§1 缺的 unit 条数由本轮补上） |
| V5 | `npm run openspec:validate` | **PASS**（`Totals: 35 passed, 0 failed`；含五个 change 与三十个 spec，另 `[openspec-enforcement] PASS`） |
| V6 | 行尾 LF（node 扫本轮五个改动文件） | **PASS**（五个改动文件的 CR 字节计数均为 0） |

**`--feature` 默认值下 evaluator 行为逐字不变的验证**：由 V3 的「默认等值回归」用例给出——它复用既有 golden 夹具造健康宿主，把"不传 `feature`"与"显式传 `bc-openCard`"两份报告除 `generated_at` 外做**逐字节字符串比较**，相等才通过；四个消费点的取值全部投影进这份报告（报告体 `feature` 字段、featureDir 派生的十屏/事件/forbidden 项、reportsDir 派生的 `required_assets` 项、指纹派生的 `build_binding*` 项），故它同时覆盖"四处取值逐一等值"。另加一条空白串回落断言。

### 2026-09-06：codex 实施 review 第 1 轮（运行单，只改 §7.2 与 §8，未实施、未提交）

- **P3b B/D 格切换命令不可执行（high）**：裸 `init-orchestrate --scope personal` 不带 `--execute` 只打印计划就 `process.exit(0)`（init-orchestrate.ts:1371/:1420），既不交互也不写 local——照抄会让 local=`claude` 的机器进 D 格时身份仍是 claude。新增 **P3b-1 两条可执行命令**（`--execute` + 临时目录里的 `decision.json`/`context.json`，`context.activeAdapter` 是 `record-adapter` 的唯一写盘输入，init-task-executor.ts:618–620；staging 路径须绝对且在 harness 外，init-orchestrate.ts:1226–1243；`tasks: []` + `decision_mode: smart` 全部隐式解析为 run，:841–842/:150–156），并写明 `--select-adapter` 与 `--smart-auto` 都切不了（personal-setup-gate.ts:591–607 的 `adapter_conflict`）。**本轮在开发机以临时工程实测该两条命令**：executed=5 / failed=0，`agent_adapter` claude→codex。
- **G② 用已封卷 run resume 不成立（medium）**：成功封卷的 run 拒绝一切启动面（goal-phase-runtime.ts:4843–4850，`--resume/--manifest/--force/--force-resume` 均无效），且**闭环之后**再删报告会命中"沿用本 phase 既往 PASS"（check-receipt.ts:730–732 → `verifier_prior_pass_reused` 只是 WARN、:749），check-receipt 仍退出 0，造不出 `closure_open`。改为**新开隔离 run**，并把缺口安排在**首轮闭环之前**：起 run 前 `Remove-Item .\.claude\agents\verifier.md`——verifier 计划的 enabled 只看 `agents/claude/adapter.yaml` 的 `verifier_subagent`（verifier-plan.ts:137–146），与物化无关，故 request 照签而报告写不出 → `verifier_evidence_report_missing` BLOCKER（check-receipt.ts:759）→ `tryValidateReceipt=failed` → `closure_open`；并补"跑完还原"与"首轮判非 PASS 则登记未覆盖"两条。
- **G③ 视觉预期与输入自相矛盾（medium）**：要求保持 `verified: unverified` 却断言恒落②四态拒签，而②只在 `verified === 'verified'` 时才进（spec-ui-spec-check.ts:288/:307–308）。删掉"codex 格恒落②"，改成按 `isHardPixelContract`（fidelity-shared.ts:678–679）× fresh `canary=tool_read`（multimodal-probe.ts:343–352）× `ui_spec_enforcement` 的**三行分支表**（④ 无条件 FAIL / ③ 软档 WARN / ③ 严格档 FAIL，:360/:378–379），只有真 FAIL 才核 `spec_capture_gap`；§7.2-C 四分支表②行的同一处"codex 格恒落此支"一并收口。

### 2026-09-06：D7 后候选件重建完成（调度记录）

- evaluator `--feature` 已提交 f9b7088e；`npm run candidate:build`（scratchpad b06/candidate-build-1.log）：typecheck 通过、unit 3889/3889、fixtures 46/46、consumer smoke 全段通过、`[candidate] BUILT`。
- **P0 真值（用户可直接抄，或按 P0 命令自取）**：zip = `dist/candidates/framework-3.0.0-candidate.zip`，zip sha256 = `81ccabafdfb3dd58b21b5b6c7aaaa1273481fb8c99307e97c0f00fa7157cd84c`，in-zip manifest sha256 = `85cd283f7a17eb178b458b887d9740b8fe1e9663ccb3fb4d8b8352b02310d7cd`（`--expected-manifest-sha` 用后者）。
- 运行单经 codex 实施 review 第 1 轮三处修订后再复核；`b06-candidate-rebuild-after-d7` 置 completed。四条宿主 todo 与 `b06-release-readiness-closeout` 保持 pending，由用户触发。

### 2026-09-07：B07 plan review 引发的运行单修订（只改 §7.2 与 frontmatter，未跑宿主、未提交）

codex 对 B07 施工图的 #1/#4：golden 适用性裁定前移到 §7.2 共同前置 **P0.5**（A 启动前，依据独立确认的需求基线）；A 命令的 golden 首段改为按 P0.5 条件保留；E 对不匹配基线的 run 保留 FAIL 并注「验收样本不适用」，不记 N/A；新增待办 `b06-host-b07-reacceptance`（用户触发）承接 B07 之后的补验收，B07 自身不含宿主判据。run `20260906T143404Z-ab463c` 的 E 结论按此记法，不改写。

### 2026-09-07：B07 补验收回填（宿主 run 20260907T063800Z-26c3b0，未提交候选件、未改宿主）

截断窗口 `--start testing --end testing`、不设 golden（P0.5）。D1 实测成立；golden_contract=none 披露成立；E 如实 FAIL 并标不适用。run 未闭环：HALTED / no_progress_visual_gap，原因是 §6 新登记的缺口①②③（复用证据被时间窗否决、hap=null 记录污染执行键、长图屏重采后留 pending），与 B07 改动无关。`b06-host-b07-reacceptance` 勾完成（动作已做、结果已记），`b06-host-merged-cu-run` 等其余宿主待办保持 pending。

## 10. 2026-09-08 版本收尾登记（当前状态）

本节为当前证据与剩余验收的唯一索引；上文施工图、旧表与运行单保留作历史依据，不因回填改写设计。用户授权执行发布收尾第 1–3 项：核实、回填、状态同步与已完成 change 归档；本轮未执行宿主回归、golden、打包或 promote。

### 已核实的宿主证据

宿主：`D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-1`。旧 run A=`20260908T011803Z-deb77f`（包源码 `1d82b276`，PARTIAL）；新 run B=`20260908T130534Z-73fc05`（包源码 `bb4aed6734e4b9f007c17f6f3fd81d2f813106b6`）。B 的 events.jsonl:3 记录 supersede A，六阶段 PASS/advance，:122 为 CHAIN_SLICE_COMPLETED；只读调用安装版 verifyFeatureCompletion 返回 VALID、reasons=[]。原件/投影 original_sha256=`3b4edd82c0795d7420aa8247674a3f4dd31f4c09780a7836633f8d68ba8a0536`。A 的 PARTIAL 保留原样，不改称成功。

| 观察点 | 当前证据 | 收口情况 |
|---|---|---|
| C-U 全链最终完成 | B 六阶段 closed/PASS，run_end 成功、verify=VALID | 已覆盖正常全链；b06-host-merged-cu-run 仍包含专项分支与 E 报告，暂不整体关闭 |
| B01 负面诊断→owner 修复 | A review-i5 FAIL → coding-i6 PASS → review-i7 PASS；B 最终 VALID | B01 host todo 与总 plan B01 关闭 |
| B02 收口与证据复用 | A spec-i1 PASS/closure_open/retry；i2 refs complete/carried_over=3、advance；无 capability_receipt；B 一轮 spec 通过 | B02 host todo 与总 plan B02 关闭 |
| B03 UT 与设备同键复用 | B ut_hvigor_test PASS，13/13，同键复用 20260908T132915Z-016；testing device_test_run 同键复用 20260908T133416Z-536 | 复用命中已覆盖；成对结果对账、report-only 三态尚未登记，B03 host 保留 pending |
| B04 prior review 与无失败归因 | A/B goal-report coding/review/ut/testing 有 reused_from_prior_review；B 六个 phase_verdict PASS、无 failure_kind_classified | 这两项已覆盖；X-U 的 spec_capture_gap 实际 FAIL 分支未覆盖，B04 host 保留 pending |
| B05 默认配置与数量检查 | B it_drives_flow=PASS（基础 ≥2 expect）；没有 balanced/n/a 的实测证据 | 不把 PASS 当数量 WARN 分支覆盖；B05 host 保留 pending |
| B08 复用证据与长图推导 | A/B 最终 gate 同键复用且设备证据写出；B 无重试/回退并最终 VALID；两张长图有顶部推导、三屏 pass | b06-host-b08-reacceptance 关闭。采用本次已授权整链 supersede 回归中的 testing 覆盖原截断窗口观察点，无需再单独跑一次 |
| a3f7c1d9 完成判据 | B 零检查面 NOT_APPLICABLE、asset 继承 PASS、native 无 runtime_fidelity 仍通过、四条债务 closed | 本地与宿主回归完成，见该 plan 最新实施记录 |
| 视觉与能力披露 | B testing COMPLETE_WITH_GAPS / READY；P0 13/13，manual 缺口不计 PASS | 已接受的披露不追加测试；与 golden 指定样本验收区分 |

### 唯一剩余验收清单（按现有待办归属，无新增测试机制）

| 现有待办/责任 | 尚缺什么 | 最小下一步与可复用项 |
|---|---|---|
| B06 b06-host-diff-cells | C-N（Claude 非goal review）、X-U（Codex goal review→ut）、X-N（Codex 非goal review）真实结果 | 只跑原 §7.2-B/C/D 差异片段；先按 E 保存主格证据或使用独立验收副本，避免覆盖现场；不再跑第二条完整 C-U |
| B03 host（B06 §7.2-F） | 真跑/复用的配对 UT 结果逐模块一致性；report-only hard/derived 三态记录 | 先查已有 run 冻结件可否直接形成配对；能取证就不跑；不足才补 F 的最小片段，FAIL 分支按原计划在隔离副本处理 |
| B04 host（B06 §7.2-C/G③） | ui_spec_fidelity_gate 实际 FAIL 时是否归 spec_capture_gap | 与 X-U 补验收合并；已有 prior review 与 PASS 无失败归因证据不重验 |
| B05 host（B06 §7.2-A6/G④） | 默认 strict 原始策略输出、显式 balanced、plan n/a、数量不足 WARN 分支 | 先查现有日志；实际缺失的按既有场景补最小片段，不为制造 WARN 改产品，不把本地单测当宿主实测 |
| d2f7a9c4 t6-verify-and-host | attended、interactive、Codex 阶段闭环 | Claude unattended 原场景已验；interactive/Codex 尽量与三差异格共用；attended 按原待办另补一个阶段。模板子线程冒烟不等于阶段闭环 |
| adhoc-device-entry-gate tasks 4.5（原 change 管理） | device:ready 真机解锁与 ad-hoc dump-ui 入口 | 短设备入口复验；goal 中设备就绪事件不能替代 ad-hoc 入口验收。本地 plan 已完成，不为此重开开发任务 |
| B06 b06-host-golden-and-promote | 最终候选件对应、样本适用的 golden evaluator PASS | A/B 均未设 golden（B 明确按用户回归指令执行）；现有报告不能冒充 golden。先核 §7.2 P0.5 样本适用性，再安排原 E；不以已接受的长图披露阻止普通需求完成 |
| B06 b06-release-readiness-closeout / 总 plan | 上述真实结果回填、未完待办关闭、最终发布门禁 | 本轮不提前勾选。发布说明/changelog 与最终包复核属于后续收尾步骤；宿主测试通过的包优先复用，不为文档回填重复跑测试 |

### 当前包与发布边界

宿主安装包源码为 bb4aed67（含 R8、B08、Codex verifier 与 a3f7c1d9）；本次成功不是旧 1d82b276 包的结果。阶段 READY/feature VALID 不等于 Maison 3.0.0 已发布。candidate/promote 的同包身份与 golden 前提需在后续发布步骤核对。本节不重建候选件，不改旧 run，也不改已接受的视觉口径。

包身份补核：当前 candidate built_at=2026-09-08T11:26:37.817Z，complete=true，consumer smoke=2026-09-08T11:28:48.454Z；zip sha256=7e1472c011b46b77eb1131b8cac892ca63c5b11d4c42e6ca57b12f9de6814656；in-zip manifest sha256=8ada2693d26f8615362e4d071daba6882931433a630a46d8e8194744b3680087，与宿主安装 manifest 实际字节一致。后续发布优先沿用这份已验收 candidate，不为本轮 dev-only 回填重新打包。

本轮归档：verifier-repair-diagnostics、vision-evidence-material-binding、phase-contracts-and-applicability、codex-verifier-subagent-template、visual-repair-severity-and-golden-reuse、reuse-evidence-binding-and-reference-derivation、completion-native-runtime-and-visual-debt（均在 openspec/changes/archive/2026-09-08-*，规格已同步）。B05 归档仅表示该 change 已完成的本地实施，不替代仍 pending 的 B05 host todo。剩余活动 change 为 execution-reuse-and-report-layering、attribution-and-prior-review-consistency、adhoc-device-entry-gate，均仅余宿主待办。

### 2026-09-08 继续收尾：先复用已有证据

- 实证文件统一放 [.cursor/verification/3.0.0-closeout-20260908](../verification/3.0.0-closeout-20260908/README.md)。
- B03：既有 UT run 20260908T132915Z-016 与 20260908T133016Z-874 的 execution_key 相等、outcome 均 success；逐模块 frozen.ut-result.WalletMain.json 与 frozen.hdc-test.WalletMain.log SHA 完全相等。F①b 的逐模块结果一致性已有证据，无须为此再跑 UT；F① 的强制真跑/复用配对操作与 F③ report-only 三态仍按原判据区分，不把冻结件比较说成新设备执行。
- B05：对宿主现有 ut 阶段实际跑 check-receipt --skip-state-sync，exit 0、PASS，HARNESS_EVIDENCE_POLICY profile_resolved=strict。仅该阶段的默认策略输出已取证，不替代 balanced/n/a 或数量 WARN 分支。
- 已执行 E：安装版 evaluator 对 73fc05 输出 FAIL（原样保存 golden-73fc05.json）。candidate_binding、run_binding、build_binding_available、required_assets、no_must_fix 等 PASS；失败为 ten_fixed_screens_exact_set、forbidden_HomeTab、key_overlays_and_completion。当前已确认三屏需求与旧十屏 contract 不匹配，不能以此要求当前产品扩建页面；发布验收基线已向用户澄清，未改 contract、不伪造 PASS。

- C-N 已执行真实 Claude 非 goal review（claude -p 会话，日志 claude-nongoal-review.jsonl）：22/22 PASS、closure closed、check-receipt exit 0、local adapter 保持 claude、无新增 goal run。框架沿用 prior PASS，未实际派发新 verifier，未触发失败重跑；主流程已覆盖，原运行单的条件分支仍按未触发披露，不制造失败。
- X-U 已按 §7.2-C 启动 Codex goal review→ut，run 20260908T143359Z-3b4759；尚在运行，本行不记完成。--override-adapter 会切换 local 到 codex，差异验收结束后恢复原 claude 身份。
- adhoc-device-entry-gate 的外置宿主待办已完成：device-ready 真机解锁并复验 + ad-hoc dump-ui 经过 device_gate、exit 0。对应 change tasks 4.5 已关闭，无需再补该项。
- default strict 已补 spec/plan/coding/ut/testing 五阶段 check-receipt 的原始输出（均 exit 0），review 的实际输出见 C-N 会话日志。

- 设备入口变更已归档为 openspec/changes/archive/2026-09-08-adhoc-device-entry-gate 并同步规范；活动 change 现余 B03/B04 两项。发布说明已改为验收中，并纠正 manual 缺口、长图披露、release-only 集成、消费者不跑开发仓单测等过时口径；changelog 已刷新。

### 2026-09-08 差异模式与 report-only 结果

- X-U：真实 Codex goal run 20260908T143359Z-3b4759，review/ut 均 PASS/advance，run_end=CHAIN_SLICE_COMPLETED。Codex JSON 终态/usage 与 verifier 子代理均实际发生；verifier 的 reference_crosscheck 为 MAJOR FAIL（旧 review 文档引用了旧视觉状态），整体终态 PASS，未触发产品回修。证据：verification 目录的 codex-goal-report.json、codex-goal-events.json，以及宿主 run 内两阶段 agent-output.log。
- X-N：当前 Codex 会话直接调用正式非 goal review harness（复用刚完成的源码审查），22/22 PASS、closure closed、check-receipt exit 0；goal-runs 目录无新增。日志 codex-nongoal-review.log、check-receipt.review.codex.log。没有额外创建一个 Codex CLI 会话重读全部材料。个人身份已通过原 recordAdapterToLocal 恢复 claude。
- 差异主流程已都有实际运行；C-N 的新 verifier 派发与失败重跑未触发，X-U 的 spec_capture_gap 分支不在 review→ut 窗口内，按原条款保留未覆盖，不整体关闭 b06-host-diff-cells。
- F③ 实际 report-only CLI 发现 BLOCKER：build=13:49:00、install=13:49:03，复用 run 起止=13:34:18–13:37:34；原检查仍强制 install≤run_start。该 run/HAP 已按执行键复用，这一时间比较误拒；原始 FAIL 留在 testing-report-only.log、testing-script-report.reportonly.json。
- 本地最小修复：check-testing 对最新记录按既有 decideReuse、当前 HAP/trace 摘要与路径绑定核验；仅该条件成立时接受重装晚于旧执行，run 内部顺序与 build/install 顺序仍检查。不改宿主 framework、不改时间戳。目标 testing-trace-gates 31/0、typecheck 通过；本地修正 checker 只读同一份未变宿主证据得到 report_reconcile_only PASS（reportonly-local-fix-host-evidence.json），这不是已部署版本回归通过。全测记录后补。
- 非 goal 回归与 F③ 会重写共享 phase 产物：当前宿主 testing summary 是本次 report-only 的 FAIL/open，review 的非 goal manifest 不含原 goal requirement 绑定；故当前完成投影已 INVALID。旧成功 run/完成原件与 golden 原始报告均保留，未手改凭证或恢复假绿。后续部署修复版并按最终验收基线收尾，不能再把当前状态表述为 VALID。
- 本次生产修复尚未入 candidate；前一条“文档回填无需重打”仅适用于此前纯文档阶段。该修复验收/提交后需要新候选件，并按变更范围复验，不重新做整套产品设计。

- d2f7a9c4 T6：本轮 C-N 已实跑非 goal review 并闭环，X-U 已实跑 Codex review→ut 并闭环，X-N 当前 Codex 会话非 goal review 也闭环；其剩余真实模式缺口收窄为 attended 阶段（不拿 detached X-U 冒充 attended）。
- X-U 写入观测仅有 UT 构建生成的三个 BuildProfile.ets（AccountManager/CommFunc/CommUI），未修改业务实现或 UT 源码；该片段 UT 为实际执行 13/13，不宣称全程零设备执行。

全量验证完成：结果：3960 passed, 0 failed (共 3960)；结果：46 passed, 0 failed (共 46)。typecheck 随 npm test 通过；OpenSpec strict/enforcement、plan 开发校验与 git diff --check 通过。生产修复未提交、未打包、未部署；完整日志 .cursor/verification/3.0.0-closeout-20260908/full-harness-test.log。

## 11. 2026-09-09 用户确认三屏 golden 基线

用户明确选择三屏，不再要求旧十屏样本。依据宿主原始需求 doc/features/原始需求/1-1-银行卡/原始需求.md（SHA256 e306d003101f4230618ae39e001af8ed72c94ab4c03d3b67dac5ddf1b9dbfc3c）：页面说明与资源表仅为收起态、展开态、全部银行；卡类型半模态明确暂不实现。发布契约固定为 add_bank_card_collapsed、add_bank_card_expanded、all_banks，不从当前 ui-spec 或截图数量反推。

- bc-opencard.golden-contract.json 改为三屏，删除旧短信/完成页/卡详情/选卡等范围及 HomeTab 专项负向采集要求；原需求的旧路由兼容仍由已有验收/真机用例负责，不因换基线删除。
- evaluator 精确集合检查改为 fixed_screens_exact_set，说明按契约数量生成；截图/构建/run 绑定、素材、崩溃、未修复缺陷检查保留。没有半模态/完成页义务时明确说明“不要求”，不声称已采集。
- 旧十屏仅保留为单测临时输入，验证聚合器的集合、overlay 和 forbidden 通用能力；新三屏正例、漏屏和替换屏反例独立覆盖发布真件，采集 env 装载器也直接断言三屏映射。
- 目标验证：consumer-golden 26/0，golden-capture-targets 8/0，typecheck PASS。新 evaluator + 新契约只读现有宿主 run 73fc05 的产物，14 项诊断全 PASS；结果封装为 local_baseline_diagnostic，见 .cursor/verification/3.0.0-golden-three-screen-20260909/existing-host-diagnostic.json，不可用于 promote。此前旧十屏 FAIL 报告原样保留。
- 当前宿主仍安装 bb4aed67，尚未包含本次三屏契约和上一轮 report-only 时间链修复；不热改宿主 framework、不声称已用新包验收。代码验证完成后再按同包原则处理候选件与正式 evaluator，host/golden 待办保持 pending。
- 顶部一屏外未验证和已接受 minor 差异只披露、不单独阻断，不再询问此项。

三屏基线全量验证完成：结果：3962 passed, 0 failed (共 3962)；结果：46 passed, 0 failed (共 46)；typecheck、plan 开发校验、OpenSpec strict/enforcement、git diff --check 均通过。日志 .cursor/verification/3.0.0-golden-three-screen-20260909/full-harness-test.log。尚未提交、构建或部署新候选件，正式 golden 待办不提前关闭。

## 12. 2026-09-09 提交、同包回归与专项收尾

- 开发仓提交 453a4df68fb72fa515500848720a3ee28887bbe1；candidate:build exit 0，全量3962/0、fixtures46/0、typecheck、zip校验、consumer lifecycle smoke通过。zip SHA c1285f7322bf38db9cea56edfd5f7207bb97b49564deb6855ce18e8b071abfbb；包内 manifest SHA 8783a8df3202f53099e87be1d3506cf90355ed00ed528994f295ce74c11224b9。
- 同包已装宿主，保留旧包备份 .framework-backup/release-3.0.0-20260909/previous-framework；正式 report-reconcile-only exit 0。B03同键配对沿用既有证据，host todo完成并归档。
- B05在同包隔离宿主正式CLI命中 balanced verifier=off、三项n/a SKIP+not_applicable、单expect MAJOR WARN；分支观察通过，不把故意不完整的隔离场景整体FAIL写成PASS。host todo完成。
- d2 attended review：20260909T012304Z-0e9d23 经正式host bridge和隔离phase代理，review PASS/advance、22/22、receipt closed；run总态PARTIAL受副本其他阶段故意FAIL影响，阶段闭环要求已满足。T6完成。
- B04隔离Codex attended spec负例：20260909T012757Z-77b2c9，ui_spec_fidelity_gate FAIL被唯一runtime归spec_capture_gap，随后owner停止场景，HALTED原样留存。此项通过真实共同runtime替代G③原detached启动形态；X-U正常流程仍用09-08实证，不混称。B04 host完成并归档。
- 主宿主回归run 20260909T011221Z-710361：先发现Claude OAuth过期，代理未执行；真机遭USB连接方式系统弹窗遮挡，已用Back关闭。切Codex续跑时代理误将新版安装的6个文件git restore为旧HEAD；driver已中止、从原候选ZIP重新安装，并在宿主仅提交framework安装基线583281c4（业务代码未提交或修改）。混版轮证据不用于发布。现已再次从同一run续跑，结果待正式终态和golden。
- 三个差异模式主流程此前已实跑；C-N新verifier派发/失败重跑两项未触发，且Claude当前登录过期。已向用户提出仅将这两项作为非阻断披露的明确裁定；未收到确认前不关闭对应B06待办，不改原计划正文。
- 证据索引：.cursor/verification/3.0.0-golden-three-screen-20260909/README.md。当前发布门仅余B06与总计划；正式promote尚未执行。

### 2026-09-09 用户关闭未触发条件分支，收口范围确认

用户答复“全关闭”：C-N 新 verifier 派发与失败后重跑两个未触发分支以非阻断披露收口，不声称这两项已实测 PASS。已有 C-U 六阶段成功 run 73fc05 及 B01/B02 实证足以关闭合并回归待办；C-N/X-U/X-N 主流程均实际运行，关闭差异格待办。最新同包 golden 与正式发布仍由各自待办承接，不用旧成功 run 替代。

最新宿主事实：710361 于 02:20Z HALTED/content_retry_exhausted。17 条 Hylyre 用例、build/install、visual/asset/evidence 均已 PASS；当前唯一实质阻断是 upstream_verdict_gate，testing_run_status 为其汇总。原因精确为 driver 在 review/UT 通过后切换 Claude→Codex 并 rebase adapter_model_pin，改变该 run manifest，使 review/UT manifest 绑定 stale；不是产品失败，也不是视觉分数不足。剩余最小收尾为新建固定 adapter/model 的 review→ut→testing 窗口，优先复用已有执行证据，完成 verify-feature-completion 与同包 golden 后再 promote。无需重写 spec/plan、产品代码或增加新机制。
