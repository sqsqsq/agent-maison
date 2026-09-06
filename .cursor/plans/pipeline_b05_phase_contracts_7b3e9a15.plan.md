---
name: 六阶段重构 B05 — 既有策略配置与适用性出口施工图
overview: 显式 evidence_profile=balanced 在 goal/headless 生效（默认仍 strict）；plan 对确实不涉及的模型/服务/页面接受依据明确的不适用出口；verify-ut 的单 expect 硬判改为线索；剩余三处过时硬文案对齐。可测性前移保持 cancelled。
version: 3.0.0
todos:
  - id: b05-detail-after-b04
    content: 按 runtime-policy/check-plan/check-ut 的静态调用链与 B01–B04 已落地的降级事实，把四项细化为具体改法、代价、提交边界与命令。
    status: completed
  - id: b05-quality-policy
    content: 按 D1 删掉 resolveEvidencePolicy/resolveProfileLabel 的 mode 早退；无配置在三 mode 恒 strict 不变，显式 balanced 在 goal/headless 同样生效并沿用既有保留集。降档范围分两条轴分别落地——verifier 只关 plan/review/ut/testing 四阶段，trace 对六个 feature phase 一律降 optional（含 spec/coding）。另补 policy off ≠ 忽略：当前 subject 已有有效 verifier FAIL 报告时，check-receipt 与 summary writer 仍保留否决与候选消费。
    status: completed
  - id: b05-facts-and-prompts
    content: 按 D4 只改已确认与代码矛盾的硬文案（business-ut :121 与 :122 两句一起、device-testing review_closure_attestation、check-testing.ts:6095 JSDoc 末句、runbook report-only 前置），不重写历史计划、不碰已由 B01 修好的处。
    status: completed
  - id: b05-plan-applicability
    content: 按 D2 给 data_model_typed / interface_signatures_complete / component_tree_per_page 加「依据明确的不适用」出口；可用性前提写死为 contracts 在场、解析成功、该集合无 shape_issues，三类不成立一律落回今天的判定；假 n/a 仍 FAIL（阻断力随各 check 既有 severity，MAJOR 的那一个不构成阶段阻断），不新增适用性账本。
    status: completed
  - id: b05-test-quality
    content: 按 D3 改 verify-ut 第 4B 条第 5 项的单 expect 硬判，并给 4B 第 2 条与检查 4 第 1 条加纯函数/单规则用例的适用范围限定（流程类用例的要求逐字保留）；同批对齐 it_drives_flow 建议措辞；检查 4 第 2/3 条与 DAG/mock 项不动。
    status: completed
  - id: b05-testability-frontload
    content: 本轮取消可测性前移体系和测试质量体系重写；没有宿主浪费证据不增加设计机制，后续需重新登记。
    status: cancelled
  - id: b05-local-acceptance
    content: 完成 V1 至 V8 的验收——真实 policy→resolveVerifierPlan→已导出 writeRunSummaryBase 的产物断言、真实 SpecLoader + check-plan 导出函数的 n/a 正反例与三条真源不可信负例、goalIdentity 走 goal 态的 check-receipt 用例与闭环负例、整份物化 prompt 的一致性断言，OpenSpec delta 与 MIGRATION 同步、candidate 本地验收。
    status: completed
  - id: b05-host-acceptance
    content: 并入 B06 的 C-U 回归：宿主实测 balanced 显式配置、n/a 出口与数量口径，本批不单独触发宿主窗口。
    status: pending
---

# B05施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。批次门（总plan §1/§5）：B05 在 B04 **本地**验收后细化实施，B03–B05 只做本地验收，宿主回归并入 B06。原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)。

**本批的证据门槛**：每条 D 必须以"具体代码分支 + 可触发的输入"为前提；核实后不成立的写进 D5 并**不改**。四项逐条核实后三项成立（D1/D2/D3）、一项收缩为三处文案（D4）。

## 1. 问题边界

**① 显式 balanced 配置在 goal/headless 被无条件丢弃（F08）。** [runtime-policy.ts](../../harness/scripts/utils/runtime-policy.ts):408–410 在 `ctx.mode !== 'interactive'` 时直接 `return { ...STRICT_EVIDENCE }`——**config 参数根本不参与求解**；:411–412 的"无 balanced → strict"这一支永远轮不到 goal。`resolveProfileLabel`（:93）同一形状。触发输入：宿主 `framework.config.json` 写 `evidence_profile: "balanced"`，[harness-runner.ts](../../harness/harness-runner.ts):800–802 照常把它传进来，而 :786 把 mode 定成 `'goal'` → 早退。

生产端只有两个求解点，mode 取值**只可能是 goal 或 interactive**（harness-runner.ts:786 与 [check-receipt.ts](../../harness/scripts/check-receipt.ts):283 都是 `isGoalOrchestrationEnv() || isAgentSideGoalHarness() ? 'goal' : 'interactive'`）——`'headless'` 在生产里从不被装配，只出现在单测。"attended / detached"不在这条轴上：它是 run owner（[phase-state.ts](../../harness/scripts/utils/phase-state.ts):200 `resolveRunOwnerKind` → `'session' | 'process'`），只进 check-receipt.ts:288 的 `can_prompt_user`，与 evidence 求解零耦合。

**② plan 的三个"必须有代码块"检查没有不适用出口。** [check-plan.ts](../../harness/scripts/check-plan.ts):501 `checkDataModelTyped`：无「数据模型定义」章节（:504）或章节内无含 `interface|class|enum|type` 的代码块（:513）→ BLOCKER FAIL；:538 `checkInterfaceSignaturesComplete` 同形（:541 / :549）；:584 `checkComponentTreePerPage` 无「页面组件树」章节 → MAJOR FAIL（:587）。三者都只认代码块，**没有任何 n/a 分支**（全文件零 `不适用` 字样）。

触发输入：一个纯逻辑/无新页面的 feature——`contracts.yaml` 的 `data_models` / `interfaces` / `components`（[types.ts](../../harness/scripts/utils/types.ts):266 / :284 / :297）全空，plan 里没有可写的模型或页面树，作者只能编造一个空 `interface` 去过门。

**三者的严重度与"章节在但内容不合格"出口并不同形**（codex 一轮 low 订正，V4 基线据此校正）：`data_model_typed` 与 `interface_signatures_complete` 是 BLOCKER，`component_tree_per_page` 是 **MAJOR**；且 `component_tree_per_page` 在**章节在场、无页面子章节**时（:591–592）落的是 `MAJOR` / **WARN**，不是 FAIL——n/a 出口插在 `getSectionContent` 之后，它的"改前基线"就是这条 WARN 而非 FAIL。`interface_signatures_complete` 同样有两个 BLOCKER/**WARN** 出口（:568 无方法签名、:578 签名不完整），但它们在代码块判定**之后**，n/a 出口够不到。

**真源在场并无保证**（codex 一轮 high 订正，逐行核实）：check-plan.ts:985 `if (!contracts)` 的出口是 :991 `status: 'SKIP'`（severity BLOCKER）——**SKIP 不是 FAIL**，summary-blockers.ts:40 只收 `FAIL + BLOCKER`，故 contracts 缺失时该 check 不阻断、后三项照常执行。解析失败同理：spec-loader.ts:176 `loadYamlMappingOrNull` 在根节点非 mapping 时返回 null → `contracts` 根本不挂载（`undefined`）。更隐蔽的第三类：spec-loader.ts:489–495 的 `normalizeArrayField` 把 `data_models: {}` 这类非数组真值**归空数组 + 记 `shape_issues`**（:491 push、:494 `obj[field] = []`），三个集合逐一经它（:189/:190/:191）——即"集合为空"既可能是"确实没有"，也可能是"写错形状被归空"。`shape_issues` 只在 **runner** 侧升 FAIL（harness-runner.ts:1086–1096 `feature_spec_shape` BLOCKER FAIL），只调三个导出函数的单测路径拿不到这道门。故 n/a 出口的可用性前提必须由 D2 自己写死，不能假定上游已挡。章节标题本身由 `required_chapters`（:222–229，BLOCKER）单独把关，与本条无关。

**③ verify-ut 用断言数量硬判 FAIL。** [verify-ut.md](../../harness/prompts/verify-ut.md):156（检查 4B `business_assertion_value`【BLOCKER】第 5 条）：「例如每个 it 只有 1 个 expect……判定 FAIL」。这是纯数量判据：一个用单条精确断言完整验证纯函数的 it 会被判 BLOCKER FAIL，而一个堆了三条 `assertLargerThan(0)` 的空壳用例反而过关。脚本侧的同类启发式**已经**是 WARN——[check-ut.ts](../../harness/scripts/check-ut.ts):2196 `it_drives_flow` 的 `severity: 'MAJOR'` / `status: 'WARN'`（:2261 / :2262），只是它的 suggestion（:2265–2267）仍把 `≥2 expect` 写成目标，与 verifier 的硬判互相加强。

**④ 剩余 F09：三处硬文案与代码相反（逐处核实，只列确认矛盾的）。** B01 已修的四处（plan/coding Skill 的 MUST subagent、goal prompt 的 attestation BLOCKER、device-testing 的 region_attest 必需、verify-ut 前置 4）不重复改。全仓 `grep -rn "BLOCKER" skills/ harness/prompts/ agents/*/templates` 后逐条对照代码，剩下三处**确认**矛盾：

| 落点 | 写的 | 代码实际 |
|---|---|---|
| [business-ut-workflow-detail.md](../../skills/reference/business-ut-workflow-detail.md):121 **与** :122（相邻两句，同一条退出路径） | :121「runner 回退 coding owner 完成改造，并**完整重走 review→ut→testing**」；:122「`ut_no_src_mutation` 对 review 闭环后的任一产品源码漂移**保持 BLOCKER**」+「**出路只有两条**」 | check-ut.ts:1162 `utDriftTieredWarn` = `severity: 'MAJOR'`（:1168）/ `status: 'WARN'`（:1169）；其 suggestion（:1182）明写「**不必重走整套 review 闭环**」，按分级补一次对应复核即可——:121 的"完整重走"与 :122 的"只有两条"同属被代码推翻的同一条路径 |
| [device-testing-workflow-detail.md](../../skills/reference/device-testing-workflow-detail.md):97 | 「源码变更都会被 `review_closure_attestation` **拦下，须回跑 review 重审**」 | [check-testing.ts](../../harness/scripts/check-testing.ts) `checkReviewClosureAttestationGate`（:6097）的四个出口：:6103 `MINOR`/`SKIP`、:6113 `MAJOR`/`WARN`（缺基线）、:6129 `MAJOR`/`WARN`（有漂移）、:6145 `MAJOR`/`PASS`——**无一 BLOCKER**，全是分级复核；`harness-gates` spec:829 已按 WARN 定稿 |
| check-testing.ts:**6095** 的函数 JSDoc 末句 | 「任何差异/缺 attestation → **BLOCKER**，指引回跑 review 闭环」 | 同函数 :6107–6108 注释明写「**不再一刀 BLOCKER**……按风险分级」，函数体（:6113/:6129）即分级 WARN——同一函数头尾自相矛盾 |

`ut_no_src_mutation` 仍保留 BLOCKER FAIL 的三支（check-ut.ts:1224–1240 闭环状态不可核实 fail-closed、:1289–1300 git 不可运行、:1355 git fallback 域）**与上表无关**，一律不动——上表三处说的都是"review 已正式闭环 + attestation 基线"这一支。

## 2. 非目标

- 不改质量目标与红线：`product_behavior_switch_scan`、`p0_coverage_integrity`、pixel_1to1 门禁组、manual/batch 授权、设备凭据与硬预算一律不动。显式 balanced **只改变证据工作量**，不放行任何真实失败。
- 不发明风险评分器、不新增 `EvidenceLevel` / `EvidenceValidationStatus` 成员、不新增 profile 档位、不新增 check id、不改 `resolveVerifierPlan` 的四问顺序（[verifier-plan.ts](../../harness/scripts/utils/verifier-plan.ts):126–160，`interactive/headless/goal 解析结果一致`的约束继续成立）。
- 不给 `balanced_verifier_retained_phases` 接线（见 D5-a），不动 `DEFAULT_BALANCED_VERIFIER_RETAINED_PHASES`（runtime-policy.ts:389）的成员。
- 不新增"适用性账本"文件或注册表；不引入任何名字含 `exemption` 的结构——`goal-runtime-structural-acceptance` 的 structural 10/13（[该套件](../../harness/tests/unit/goal-runtime-structural-acceptance.unit.test.ts):252–262）对 check-plan.ts 扫描 `exemptions?` 正则，命中即 FAIL。
- 不改 `required_chapters`（章节仍必须在场）、不改 `spec_mapping_table` / `scope_*` / contracts 闭包类检查、不改 [plan-rules.overlay.yaml](../../profiles/hmos-app/phase-rules-overlays/plan-rules.overlay.yaml) 的 severity 声明。
- 不改 verify-ut 检查 4（`end_to_end_driving`，:131–146）**对流程类用例**的真实流程/中间态与终态/`not_called` 要求——D3 只给它加一句"纯函数/单规则用例"的适用范围限定（codex 一轮 medium 采纳后的范围，见 D3），流程类用例的三项判定逐字不变；不改 4C `mock_plan_traceability` 与 DAG 相关项，不改 `it_drives_flow` 的 severity/status。
- 不重写测试体系、不重分配阶段角色、不重构 native /goal（`b05-testability-frontload` 维持 cancelled，只表示退出本轮实施范围）。

## 3. 决策纪要

### D0：保留的真源与状态

保留：`resolveEvidencePolicy` 的 lite 优先分支（:405–407）与 `LITE_EVIDENCE` / `STRICT_EVIDENCE` 常量逐字不动；`resolveVerifierPlan` 的判定顺序与全部出口话术；check-receipt 的两层快照组装（check-receipt.ts:1134 `buildEvidencePolicySnapshot`，`off → skipped_by_policy` 由它统一钉死）；check-plan 的章节存在性与 contracts 闭包判定；`it_drives_flow` 的 MAJOR WARN 与 `utDriftTieredWarn` 的分级复核清单。变化只发生在"config 要不要参与 goal 的求解""章节确实不涉及时怎么如实标注""数量是不是判据"三处。

### D1：显式 `evidence_profile: balanced` 在 goal/headless 同样生效

删掉 runtime-policy.ts:408–410 的 `ctx.mode !== 'interactive'` 早退，`resolveProfileLabel`:93 同一行同样删。**删除即完整实现**——:411–412 的"config 不是 balanced → STRICT"这一支承接全部缺省情形，所以无配置时三个 mode 的输出与今天逐字相同（default 等值不变式不破）。保留集沿用 `DEFAULT_BALANCED_VERIFIER_RETAINED_PHASES = ['spec','coding']`（:389），不新增第二套。

行为表（full track；lite 恒 minimal，不受影响）：

| ctx.mode | 无 `evidence_profile` / `strict` | `evidence_profile: balanced` |
|---|---|---|
| interactive | strict：verifier/trace/exploration=required，receipt=not_applicable | balanced：保留集 phase verifier=required、其余 off；trace=optional（**六阶段一律**）；exploration=required（**今天已如此**） |
| goal（生产里 goal 与 headless 同一条分支） | strict（**逐字不变**） | **改后**：与 interactive×balanced 逐一相同 |
| attended / detached（run owner session/process） | 不参与求解，两态输出恒相同 | 同左 |

**两根轴的降档范围不同，必须分别列明**（codex 一轮 medium 订正）：runtime-policy.ts:416 的 `retained.includes(ctx.phase) ? 'required' : 'off'` 是**唯一**按 phase 分流的一行；:418 的 `trace: 'optional'` 是**无条件**的，对 balanced 下**全部六个** feature phase（含保留集里的 spec/coding）生效。所以受影响面是"verifier 四阶段关闭 + trace 六阶段降 optional"，不是同一个四阶段集合。

受影响的三根轴（改后 goal×balanced 下）：

- **verifier（plan / review / ut / testing 四个 phase 关闭）** — [workflows/spec-driven.workflow.yaml](../../workflows/spec-driven.workflow.yaml):63 / :71 / :83 / :91 / :99 / :107 六个 feature phase 全声明了 `verifier_prompt`，保留集只含 spec/coding，故这四个 phase 的 verifier 变 off → `resolveVerifierPlan` 返回 `disabled` / `policy_off` → harness-runner.ts:1168 的 Step 4 资格判定拿到 `planMode='disabled'`，不生成 request/subject/ai-prompt，check-receipt 不再**要求**该轴（"不要求"≠"忽略"，见下）。spec / coding 两个保留 phase 的 verifier 一字不降。
- **trace（六个 phase 全部降 optional，含 spec / coding）** — check-receipt.ts:794 / :824 的 `policy.trace === 'required'` 分支不再命中，"trace 缺失"由 FAIL 降 WARN；"提供但损坏"仍恒 BLOCKER（:782–790 注释即此意，不动）。**保留阶段也降**——spec/coding 的 verifier 还必需，trace 却已 optional，这是真实行为，验收须有一条专门用例钉住（V2）。

  **"提供但损坏恒 BLOCKER"在 legacy 回执路径上并不成立，本批须一并收口**（codex 二轮 medium 新增；逐行核实）。check-receipt.ts:**819** `traceProvided = tj.exists === true && Boolean(tj.path);`——legacy（非 slim）分支**只按回执自报的 `exists`/`path` 决定要不要去看磁盘**；:820–845 的损坏判定（`trace_json_file_not_found` / `trace_json_not_parseable`，恒 BLOCKER）全在 `traceProvided === true` 的 else 里。于是"canonical 路径上躺着一份损坏 trace.json，回执却写 `trace_json: {}`"这一组合下：strict 走 :828–840 的两条 `exists=false` / `path 缺失` BLOCKER（还算拦住），**goal×balanced 直接落 :842 的 `trace_json_missing_optional` MAJOR WARN**——损坏证据被回执的一句自报藏掉，且恰恰是 D1 放宽 trace 之后才暴露出来的洞。slim 分支（:788–800）早已是**磁盘直查** canonical 路径，没有这个问题。

  修法与 slim 同源、不新增 id：legacy 分支的 `traceProvided` 先按 **canonical 路径磁盘存在性**判定（盘上有文件即"提供了"，无论回执怎么写），回执的 `tj.path` 只在磁盘 canonical 缺席时作为兼容回退路径参与判定；损坏判定（不存在 / 不是合法 JSON）照旧恒 BLOCKER。**以盘上文件为准、不信回执声明**——回执手填字段早已退出裁决权威（同文件 :677 注释），trace 是最后一处还在信它的地方。验收负例见 V3。
- **receipt** — 两档同为 `not_applicable`，**零变化**（07a41ec6 T4 起 receipt 已退出闭环输入）。`exploration` 两档同为 required，check-receipt.ts:869–879 不受影响。

**policy off = "不要求"，不等于"忽略"**（codex 一轮 high；本条是 D1 的必要补丁，不是可选加固）。今天的两个消费点在 disabled 下是**完全不读**：check-receipt.ts:680 的 `verifierPlan.mode === 'disabled'` 分支直接写 `observed.verifier = 'skipped_by_policy'` 后 `console.log` 收尾，`loadVerifierEvidence` 一次都不调；负面否决（`verifier_not_pass`，:746）只活在 :700 起的 enabled 分支里。writer 侧同形：harness-runner.ts:2058 `resolveVerifierEvidenceState` 首行 `if (mode !== 'enabled') return 'not_applicable';`，其结果既喂 `decideNextAction`（:1961–1962）又与 `verifierReportText` 一并决定回修候选（:2016 起 `buildSummaryRepairCandidates`）。合起来的后果：goal×balanced 下，**同一份材料上已经存在的一份有效 verifier FAIL 报告会被静默丢弃**——脚本 PASS 即放行，而这份报告恰恰是"实现没解决需求"的唯一证据。这是把"降低证据工作量"错做成"洗掉已有的负面结论"，不可接受。

故 D1 除删两行早退外，**还须**：当前 subject 若已有一份**有效**（`loadVerifierEvidence` 判 ok：subject 回显匹配 + verdict 终态自洽）的 verifier 报告且 verdict ≠ PASS 时，check-receipt 在 disabled 分支仍保留 `verifier_not_pass` 否决、writer 仍按 `fail` 取该轴证据状态并照常参与候选组装；报告**缺席**时才是零要求、不阻断（这正是 balanced 想买到的东西）。实现上不新增 check id、不新增状态成员——复用既有 `verifier_not_pass` 与既有 `'fail'` 枚举值。

**writer 侧的链要闭合到底，只改 `resolveVerifierEvidenceState` 不够**（codex 二轮 partial→补齐；逐行核实）。disabled 下 writer 一路上有**四个**都以"本轮签发的 subject"为唯一锚的消费点，只翻转第一个会留三处静默丢弃：

| # | 落点 | disabled 现状 | S0b 后 |
|---|---|---|---|
| ① | harness-runner.ts:**2058** `resolveVerifierEvidenceState` 首行 `if (mode !== 'enabled') return 'not_applicable';` | 恒 not_applicable | 沿用到的有效非 PASS 报告 → `'fail'` |
| ② | :**1900** `loadVerifierReportTextOrNull(..., { subjectId: verifierIssued?.subjectId ?? null })` | `verifierIssued` 为 null → 传 `null` → loader 首行 `if (!opts.subjectId) return null` → **候选正文恒 null**，`buildSummaryRepairCandidates` 零候选 | 传沿用到的 subject，正文照常进候选组装 |
| ③ | :**2450** `decideNextAction` 的 `if (mode === 'disabled') return 'fill_receipt_then_sync_closure';` 排在 `switch (verifierEvidence)` **之前** | 即使 ① 已判 fail 也先返回闭环指令，`case 'fail'` 永远读不到 | `verifierEvidence === 'fail'` 的判定**前置**于 disabled 早退，落 `fix_verifier_findings_then_rerun_harness` |
| ④ | :**1990–1992** summary 的 `verifier_subject_id` / `verifier_request` / `verifier_report` 三字段以 `verifierIssued ? … : {}` 条件写入 | 落盘 summary **移除** subject → 下一环 check-receipt 的 `loadVerifierEvidence`（以磁盘 summary 现值为锚）读不到任何 subject，否决在 receipt 侧同样落空 | 沿用时保留 `verifier_subject_id` + `verifier_report`（**不**写 `verifier_request`——本轮没签发新凭证） |

**"当前材料 subject"怎么取（取舍见下方"本条放弃的准确性"④；本段经 codex 实施 review 第 1 轮 high 重写）**：disabled 时 Step 4 被 policy 关闭 → 无 `contextFiles`/`templateText`/`phaseRuleText` → 无法重算 subject。取**上一轮落盘 summary 的 `verifier_subject_id`**，再拿它签发时落盘的材料视图（`verifier.material.<subject>.json`）与**本轮以 policy 无关输入重算**的材料视图逐面比较。参与比较的只有材料视图里 policy 无关的三面：**phase 输入/产物文件哈希**（`resolvePhaseEvidenceManifest`，与 policy 无关）+ **`gate_fingerprint`** + **`script_checks` 投影**。重算复用生产同一个 `buildVerifierMaterialView`（`phaseRuleText`/`templateText` 传空串、`contextFiles` 传空表——这三面在 disabled 下取不到，**明确排除**在比较之外）。

**刻意不用 `source_commit_sha` / `worktree_digest`**（codex 一轮 high；原写法用它们当三锚是错的）：二者早已退出 subject 派生（verifier-request.ts `canonicalRequestInput` 的注释即写明"随任何无关提交/工作区改动变化，进 subject 只会无效换代"），且 `worktree_digest` 把 `framework.config.json` 算在内（worktree-digest.ts `ROOT_CONFIG_PATHSPECS`）。用它们当沿用判据时，"strict 轮脚本 PASS + verifier FAIL → 只把 `evidence_profile` 改成 balanced"这一步就会因摘要漂移丢弃 subject，writer 否决与候选一并落空、check-receipt 放行——那是**少否决**，恰是本条要堵的洞，超出已接受偏差。

V8 因此必须经**真实 writer**（`writeRunSummaryBase`）再验 check-receipt，不得手写 summary 冒充沿用态——手写 summary 只能证明 check-receipt 一侧，恰好绕过 ②③④ 这三处。

**本条放弃的准确性**：①"有效报告"的判据仍只是 subject 回显 + verdict 自洽，报告正文可被编辑而不被机器识别（与 harness-runner.ts:2010–2011 注释里已明确放弃的那条同源）；②磁盘上属于**其它** subject 的旧 FAIL 报告仍不激活本轴（`plan a9d4e7c2` 的否决闸不动）——只认当前 subject，宁可漏否决也不让陈旧结论借尸还魂；③balanced 下这四个阶段不会**签发**新 request，所以"已有有效 FAIL"只可能来自 strict 轮或人工投递的那一次审查，覆盖面天然有限。④**沿用判据只覆盖材料视图里 policy 无关的三面**（phase 输入/产物文件 + `gate_fingerprint` + `script_checks`）——模板、phase 规则文本、`contextFiles`（源码/用例/图片）三面在 disabled 下取不到，明确排除。所以"prompt 模板或被审源码已改，而 manifest 文件与脚本结论未变"的情形仍会沿用旧 FAIL。后果是**多否决**而非少否决；解除它需要跑一轮 strict（或保留集内的 phase）让 verifier 自己撤回结论——这与"只有 verifier 能收回 verifier 的负面结论"一致，不给"改配置即洗白"留口子。⑤签发时没有落盘材料视图的旧凭证（更早世代）无从核实身份，一律不沿用。

`resolveProfileLabel` 的现存唯一消费者是 check-receipt.ts:294（写进 `evidence_policy_snapshot.profile_resolved` 与控制台）——archive 里 `shouldAutoConfirmCorrectionLayer` 那条消费链已随 07a41ec6 T1 退场，全仓 grep `auto_confirm_eligible` 只剩 [correction-state.ts](../../harness/scripts/utils/correction-state.ts):44 的类型字段，无计算方。故本条不会顺带改变修正确认路径。

**放弃的准确性**：①goal×balanced 下 plan/review/ut/testing 四个阶段**不再有 verifier 语义审查**——脚本门禁、编译/执行、契约闭包、范围与漂移判定全部照常，但"实现是否真的解决了需求"这一层在这四个阶段没有第二双眼睛；这是用户显式配置换来的证据工作量下降，默认 strict 不动，且保留集里的 spec/coding 仍必审。②trace 缺失在 balanced 下只 WARN，且范围是**六个 feature phase**（不是 verifier 那四个）——连仍需 verifier 的 spec/coding 也可能没有 trace，事后无法从 trace 复原任一阶段的执行细节。③本条**不加任何护栏**阻止宿主误配 balanced——档位已写进 `evidence_policy_snapshot.profile_resolved` 与控制台，`framework.config.json` 是用户自己的声明，再加一层确认等于新建停等路径。④[config.ts](../../harness/config.ts):459–463 的字段注释写着"只在 mode==='interactive' 分支参与求解；headless/goal 恒强制 strict"——**同批改掉**，否则留一条与代码相反的说明。

### D2：plan 对确实不涉及项的「依据明确的不适用」出口

check-plan.ts 新增一个共享纯函数（命名避开 `exemption`，如 `resolveSectionApplicability`），签名为"章节正文 + contracts 侧计数 + 该集合的 shape_issues 命中"。

**可用性前提写死在函数里**（codex 一轮 high；§1-② 已核实上游并不保证）。只有下面三条**同时**成立才允许走 n/a：

1. `ctx.featureSpec.contracts` 在场（不是 `undefined`）；
2. contracts.yaml 解析成功（同上一条——解析失败时 loader 根本不挂载，两种情形在这里合流）；
3. `ctx.featureSpec.shape_issues` 里**没有**指向该集合的留痕。

三条里任一不成立 → 函数返回 null，**落回今天的判定**（缺章 FAIL / 无代码块 FAIL / 无子章节 WARN），绝不给 SKIP。判据复用既有 `shape_issues`（types.ts:506，由 spec-loader.ts:491 写入），**不新增**第二套形状真源、不新增 check id。这条前提直接堵掉最危险的一类：`data_models: {}` 被 normalizeArrayField 归空后长度为 0，若只看"数组为空"就会把一份写错形状的 contracts 判成"确实不涉及"。

三种返回：

- 三条前提成立、章节里有 `不适用：<依据>` 行 **且** 对应 contracts 数组为空 → `CheckResult{ status: 'SKIP' }`（severity 保持各自原值），details 写明判据来源（`contracts.data_models` 长度 0）与作者给的依据；
- 三条前提成立、章节里有该行 **但** contracts 对应数组非空 → **假 n/a**，返回原 severity 的 **FAIL**，details 点名 contracts 里实际存在的条目，suggestion 指"删掉不适用声明并按 contracts 补齐"；
- 否则返回 null，走今天的全部判定，一字不改。

三个调用点各加两行：`checkDataModelTyped`（判据 `contracts.data_models`）、`checkInterfaceSignaturesComplete`（`contracts.interfaces`）、`checkComponentTreePerPage`（`contracts.components`）。插在 `getSectionContent` 成功之后、代码块/子章节判定之前；"整章缺失"（:504 / :541 / :587）仍 FAIL——章节在场由 `required_chapters` 独立要求，n/a 是"章节在、内容如实标注不适用"。

**下游语义按各自 severity 分别核实**（codex 一轮 low 订正——原文把三者当同一档写，对 MAJOR 的那一个不成立）：

| 下游 | `data_model_typed` / `interface_signatures_complete`（BLOCKER） | `component_tree_per_page`（**MAJOR**） |
|---|---|---|
| blocker 聚合（[summary-blockers.ts](../../harness/scripts/utils/summary-blockers.ts):40 `status==='FAIL' && severity==='BLOCKER'`） | 真 n/a 的 SKIP 不进；假 n/a 的 FAIL **进** blocker、阻断本阶段 | SKIP 不进；假 n/a 的 FAIL **也不进** blocker——它是 check FAIL，**不构成阶段阻断** |
| failures-only 控制台（[report-generator.ts](../../harness/scripts/utils/report-generator.ts):641 `FAIL \|\| WARN \|\| (SKIP && BLOCKER)`） | SKIP 照常显示（不静默） | SKIP + MAJOR **被隐藏**，只在 `--verbose` 下可见；FAIL 仍显示 |
| 质量轴（[quality-axes.ts](../../harness/scripts/utils/quality-axes.ts):243 / :336） | SKIP 不计 executed，plan 阶段其余 check 仍在，轴不塌成 UNVERIFIED | 同左 |

据此把承诺改准：**"假 n/a 仍 FAIL"是 check 级承诺，只有两个 BLOCKER 项同时构成阶段阻断**；`component_tree_per_page` 的假 n/a 与它今天的整章缺失一样，是 MAJOR FAIL——不阻断，本批**不为它提级**（提 severity 属改质量红线，见 §2）。展示面同理：真 n/a 的 SKIP 在两个 BLOCKER 项上进 failures-only 控制台，在 `component_tree_per_page` 上不进——这不额外配置，与该 check 今天的 MAJOR 待遇一致。

假 n/a 的新 FAIL **自带 suggestion**，故 [blocker-suggestion-ratchet](../../harness/tests/unit/blocker-suggestion-ratchet.unit.test.ts):45 的 `check-plan.ts: 13` 基线只会持平或下降（只减不增，不会因新增构造 FAIL）。

**放弃的准确性**：①判据只看 contracts 数组是否为空，不校验"contracts 本身是不是漏声明了模型"——那属 spec→plan 追溯与契约闭包的职责（不动）。作者若同时在 contracts 里漏声明并在 plan 写 n/a，本出口拦不住；代价接受，理由是不新建第二套适用性真源。②`component_tree_per_page` 的判据用 `contracts.components` 整体为空，不区分"页面组件"与"普通组件"（`kind` 字段的语义没有机器约束）——宁可让"有组件但无页面"的 feature 仍走原判定，也不猜 kind。③不做 workflow/profile 级的"这个 profile 根本没有页面"推断。④contracts 缺失/解析失败时 n/a 一律不成立，作者会拿到"未找到章节/无代码块"这类**看起来答非所问**的 FAIL，而不是"contracts 读不出来"——本批不改 `contract_file_reference_closure` 的 SKIP（那是既有设计，属另一个 change），代价是这类场景的诊断话术仍绕一层；换来的是 n/a 出口在真源不可信时**绝不放行**。

### D3：数量只是线索，判据是"错误实现会不会让测试失败"

verify-ut.md:156 第 5 条整条改写：删去"每个 it 只有 1 个 expect"这一数量判据，改为——判据是**该 it 若被错误实现是否会失败**、以及**是否覆盖了该规则的边界/异常**；单个精确断言完整验证一个纯函数是合法形态；"只测 repository 静态数据结构而 acceptance 要求业务流程"这一支**保留**（它判的是测错了对象，不是数量）。

**只改第 5 条不够——须同时给出适用范围**（codex 一轮 medium；否则单断言纯函数仍被别的保留条款判 FAIL）。逐行核实：verify-ut.md:153（4B 第 2 条）**无条件**要求"happy path 至少包含三类断言中的两类"；:135–139（检查 4 第 1 条）要求每个 `it` 同时满足命名入口驱动 + 调用序列断言 + "状态多阶段断言：`expect` 至少 2 次且覆盖中间态与终态"，:141–144 判定"任一项不成立 → FAIL（BLOCKER）"。一个纯函数用例既无 data_boundary 替身可断言调用序列，也没有中间态可断——按现行文本它在**检查 4 与 4B 第 2 条上各挂一次**，第 5 条改不改都一样。

故 D3 的改法是：在检查 4 第 1 条与 4B 第 2 条各加一句适用范围限定——

- **纯函数 / 单规则用例**（无 data_boundary 替身、无多阶段状态迁移）：只要求"错误实现会让该 it 失败"+"覆盖该规则的边界/异常"，检查 4 的调用序列与中间态两项按**不适用**处理（不是"不成立"），4B 第 2 条的"两类断言"不作要求；
- **流程类用例**（驱动 coordinator / 涉及 data_boundary / 有阶段迁移）：检查 4 的三项与 4B 第 2 条的两类断言要求**逐字保留**，判定逻辑不变。

判据是用例形态，不是作者声称——形态由被测对象决定（有替身/有阶段就是流程类），verifier 按代码判，不接受"我说它是纯函数"。4B 的 1、3、4 条（业务规则可陈述、异常 path 的错误状态/回滚/`not_called`、Spy 预设与场景相关）逐字不动；检查 4 的第 2、3 条（`expected_phase_sequence` 对照、无 use-cases 时的退化判定）与 4C 不动；:259–260 的严重度表不动。V7 因此要检查**整份物化 prompt** 的一致性——三处（:135–144 / :153 / :156）不能只改其一。

check-ut.ts:2265–2267 的两条 suggestion 同批对齐措辞：把"应 ≥2 次""至少包含 ≥2 个 expect"改成"数量是本 WARN 的触发线索，不是判据；请确认该 it 覆盖了命名入口驱动、调用序列与状态迁移"。**severity/status 一字不改**（已核实为 MAJOR/WARN），判定表达式（:2229–2234）也不改——它只决定要不要提示。

**放弃的准确性**：①去掉数量硬判后，verifier 判"形式化 UT"更依赖语义判断，弱模型可能漏判一批真·空壳用例；对冲是 `it_drives_flow` 的 WARN 与检查 4 的三项硬要求都还在。②`it_drives_flow` 的启发式本身仍会对合法的单断言纯函数用例报 WARN——本批只让它的建议不再指向数字，不改判定，避免动一个已在 WARN 档的静态规则。

### D4：过时硬文案对齐（不扩面）

按 §1-④ 表逐处改：

- **business-ut-workflow-detail.md:121 与 :122 一起改**（codex 一轮 medium：两句是同一条退出路径的相邻两半，只改 :122 会留下 :121 的"完整重走 review→ut→testing"与代码的分级复核继续矛盾）。:122 的"保持 BLOCKER"改为"attestation 基线下按风险分级记 MAJOR WARN，纪律不变"，同句的"**出路只有两条**"改为"按 check-ut.ts:1182 suggestion 给出的分级复核处置"；:121 的"完整重走 review→ut→testing"改为"回 coding 纳入实现并按分级补对应复核（不必重走整套 review 闭环）"。该段其余关于禁止提交换基线、禁止删闭环产物的内容全部保留。
- **device-testing-workflow-detail.md:97**："拦下，须回跑 review 重审"改为"由 `review_closure_attestation` 分级列出所需的一次复核并如实标注未复核"（同文件 :93–96 的 `*_FAST_PATH` 红线是**另一条真 BLOCKER**，一字不动）。
- **check-testing.ts:6095**（不是原写的 :6089–6093——逐行核实后 JSDoc 块是 :6091–6096，矛盾句在 :6095）：末句"任何差异/缺 attestation → BLOCKER，指引回跑 review 闭环"改成与同函数 :6107–6108 注释一致的分级表述。
- 顺带一处同源：[goal-mode-runbook.md](../../docs/operations/goal-mode-runbook.md):148 仍把"agent 已写好 test-report.md"当作 `--report-reconcile-only` 的前置，与 B03 后的实际（harness 生成报告，见 device-testing-workflow-detail.md:90）相反，删该前置从句。

**放弃的准确性**：只改这五处（含 :121 这一句）；`skills/` 下其余数百处 BLOCKER 字样已逐条对照过代码、未发现新矛盾（见 D5-c），但本批不做全仓穷尽证明。

### D5：核实后无缺陷、不改（三项）

- **a. `balanced_verifier_retained_phases` 未接线，是既有设计不是缺陷。** 该字段只声明在 runtime-policy.ts:363 的 `EvidenceProfileConfig`，[config.ts](../../harness/config.ts) 的 `FrameworkConfig` 里**没有**对应字段，两个生产调用点（harness-runner.ts:800–802、check-receipt.ts:292）都只传 `evidence_profile`。故生产中保留集恒为默认 `{spec, coding}`。给它接线等于新增一个能改变闭环要求的 config 面，收益只是让保留集可调——**不做**，D1 的行为表按默认集写死。
- **b. `it_drives_flow` 的严重度无需降级。** 已逐行核实 severity=MAJOR、status=WARN（check-ut.ts:2261 / :2262），提纲里"原已 WARN，保持"的判断成立，本批只动 suggestion 文本（D3）。
- **c. `report_reconcile_only` 的 soft 桶与 B02 四态在文档侧无矛盾。** check-testing.ts:2711–2745 的"hard 缺口 FAIL / 只有派生缺口 WARN（severity 仍 BLOCKER）"是 B03 的既有分桶；`grep -rn "派生统计\|report-reconcile-only" skills/ harness/prompts/` 未命中任何把派生缺口写成 FAIL 的句子（唯一相关的 runbook 前置属另一问题，见 D4）。B02 的四态词（`unreachable` / `not_probed` / `not_yet` / `mismatch`）在 `skills/` 与 `harness/prompts/` 下**零命中**——它们只活在 profile 侧 check 的 `details`/`suggestion` 里，没有需要同步的文案面。三项均**不改**。

### D6：规格与文档同步

最小 OpenSpec change `phase-contracts-and-applicability`，两份 delta：

| spec | 修改 |
|---|---|
| [runtime-policy](../../openspec/specs/runtime-policy/spec.md) 的 `Evidence matrix resolution`（requirement 正文 :22 + **该 requirement 下的全部两条 scenario** :24–26 / :28–30）+ 另一 requirement `Pure policy resolver set` 下的 :90–92 `headless 强制 strict` scenario | MODIFIED：①:22 正文——balanced 的适用条件由"仅交互态"改为"任意 mode 下由 config 显式声明"，缺省仍 strict，并删去末句"headless/goal MUST 恒按 strict 求解"；②:24–26 scenario——`receipt=required` 纠正为 `not_applicable`（07a41ec6 T4 起代码即如此），trace 明写 optional；③:28–30 scenario `goal-mode 无视 balanced` ——**必须改**（codex 一轮 medium：原 plan 漏了它，留着就与 D1 直接对立），改为"goal-runner 驱动同一 feature 且 config 声明 balanced → 与 interactive 逐一相同（保留集外 verifier=off、trace=optional）"；④:90–92 scenario 改成"config **未**声明降档时 headless/goal 仍 strict"，且其"全凭证 required"改为**逐轴准确表述**（verifier=required、trace=required、exploration=required、**receipt=not_applicable**）——strict 从来不是"全 required" |
| [harness-gates](../../openspec/specs/harness-gates/spec.md):32–47 的 `Phase check scripts enforce phase-rules` | ADDED 三条 scenario：contracts 对应集合为空、无该集合 shape_issues 且章节声明依据时 SHALL 记 SKIP 而非 FAIL；contracts 非空却声明不适用时 SHALL 仍 FAIL；**contracts 缺失/解析失败/该集合有 shape_issues 时 SHALL NOT 接受不适用声明**（落回原判定） |

[MIGRATION.md](../../MIGRATION.md) 增一节（插在 :603「把 framework 发布件集成到目标工程」之前，与 B03/B04 同位）：显式 `evidence_profile: balanced` 现在在 goal/headless 生效，代价分两条**范围不同**的轴（codex 一轮 medium：不得合并成同一个四阶段集合）——**verifier**：plan/review/ut/testing 四阶段 off，spec/coding 仍 required；**trace**：六个 feature phase **全部**降 optional（含仍需 verifier 的 spec/coding），"提供但损坏"仍恒 BLOCKER。**缺省不写该字段的工程零变化**。同节写明：policy off 只是"不要求"，当前 subject 已有的有效 verifier FAIL 报告仍照常否决（D1）。plan 三章节可用 `不适用：<依据>` 声明，判据是 contracts 对应集合为空**且真源可信**（contracts 在场、解析成功、该集合无形状留痕）；verify-ut 不再按 expect 数量判 FAIL，纯函数/单规则用例与流程类用例的要求分列。同批改 config.ts:459–463 的字段注释（D1-④）。不改任何 Skill 的行为要求——D4 的几处只是把描述改回与代码一致。

## 4. 文件与提交边界

S0 至 S4 是可审查提交/变更组，不要求自动 git commit。

| 组 | 文件/函数 | 内容与验证 |
|---|---|---|
| S0 F08 策略 | runtime-policy.ts:93 与 :408–410（删两处 mode 早退）、:395–399 的求解注释、config.ts:459–463 字段注释 | D1；V1/V2/V3；常量与 lite 分支零改动 |
| **S0b policy off ≠ 忽略** | check-receipt.ts:680 disabled 分支（当前 subject 已有有效 FAIL 报告时保留 `verifier_not_pass` 否决）、check-receipt.ts:**819** legacy trace 改 canonical 磁盘直查（不信回执自报）、harness-runner.ts **四处**：:2058 `resolveVerifierEvidenceState` 返回 `'fail'`、:1900 候选正文按沿用 subject 读取、:2450 `decideNextAction` 把 `'fail'` 前置于 disabled 早退、:1990–1992 summary 保留 `verifier_subject_id`/`verifier_report` | D1 补丁；**V8**（经真实 writer → check-receipt）+ **V3 的 trace 损坏负例**；不新增 check id / 状态成员；报告缺席且 trace 未损坏时行为与 S0 后逐字相同 |
| S1 plan 不适用出口 | check-plan.ts 新共享纯函数（含 contracts 在场 + 解析成功 + 该集合无 `shape_issues` 三条前提）+ :501/:538/:584 三个 check 各两行 + 三处 `export`（供 V4 走真实函数） | D2；V4；`required_chapters` 与 contracts 闭包零改动；`shape_issues` 只读不写 |
| S2 数量口径 | verify-ut.md:156（整条改写）+ :153（4B 第 2 条加适用范围）+ :135–144（检查 4 第 1 条加适用范围）、check-ut.ts:2265–2267（两条 suggestion） | D3；V5/V7；severity/status/判定式与检查 4 第 2/3 条、4C 零改动 |
| S3 剩余 F09 文案 | business-ut-workflow-detail.md:**121 与 :122**、device-testing-workflow-detail.md:97、check-testing.ts:**6095** JSDoc 末句、goal-mode-runbook.md:148 | D4；V5；五处纯文案，零行为 |
| S4 规格与验收 | OpenSpec change `phase-contracts-and-applicability` 两份 delta、MIGRATION、既有套件扩展 | D6 与 §7；不夹带 B06 生产改动 |

扩展现有套件，不新建 suite（已核对各套件既有 import 面与夹具）：`runtime-policy`（V2 纯函数真值表，:238–249 与 :261–268 两例须翻转，另加保留阶段 trace 例）、`verifier-plan`（V1，:49–63 已有"policy 一律经 `resolveEvidencePolicy` 求解"的同源写法；产物断言改经已导出的 `writeRunSummaryBase`）、`check-receipt-policy`（V3 与 **V8**，:275–342 已有 balanced×保留/非保留 phase 与 trace 降档三例；:50 已有 `claimedAttemptId` 夹具形参、:359/:382 已示范 `goalIdentity` 用法）、`contract-reference-closure`（V4，:51–87 的 `withProject` 已用**真实** `SpecLoader`（:83）造 `FeatureSpec.contracts`，:89–102 已示范怎么拼真实 `CheckContext` 调 check-plan 的导出函数）、`context-facts`（V5，:95–147 那条"文案对齐"case 正是 B01 放 verify-ut 守卫的地方，:138–145）、`verifier-production-routing`（V7，:110–147 已有 `assembleAIPrompt` → 落盘 `ai-prompt.md` 的读法，:55 已有真实 `HARNESS_ROOT`）。

## 5. 接受的准确性边界

| 取舍 | 接受的边界 | 仍须保证 |
|---|---|---|
| goal×balanced 生效（D1） | **plan/review/ut/testing 四阶段**无 verifier 语义审查（spec/coding 不在此列） | 默认 strict 零变化；spec/coding 仍必审；脚本门禁/编译/执行/契约闭包/范围漂移全部不降；档位写进 `profile_resolved` 与控制台 |
| trace 降 optional（D1） | **六个 feature phase 全部**的 trace 缺失只 WARN——**含 spec/coding 这两个 verifier 仍必需的保留阶段**（runtime-policy.ts:418 无条件，只有 :416 的 verifier 按 phase 分流） | "提供但损坏"仍恒 BLOCKER；exploration 仍 required；receipt 两档同为 not_applicable；保留阶段缺 trace 的行为由 V2 专门钉住 |
| policy off 只免"要求"（D1 补丁） | 只认**当前 subject** 的报告；别的 subject 的旧 FAIL 不激活本轴；正文可被编辑而不被机器识别 | 当前 subject 已有有效（subject 回显 + verdict 自洽）FAIL 报告时，check-receipt 仍否决、writer 仍按 `fail` 消费候选；材料未变时脚本 PASS 不构成放行 |
| 保留集不可配（D5-a） | 宿主无法调整 `{spec, coding}` | 行为表按默认集写死，不新增 config 面；要改就是另一个 change |
| n/a 判据只看 contracts 空集（D2） | contracts 自身漏声明时 n/a 拦不住 | 假 n/a（contracts 非空却写 n/a）仍 FAIL；章节仍必须在场 |
| n/a 需真源可信（D2） | contracts 缺失/解析失败/该集合有 `shape_issues` 时作者拿到的是原判定的 FAIL 文案，不是"真源读不出来" | 这三类**一律不满足 n/a**，落回今天的判定；判据复用既有 `shape_issues`，不新建第二套形状真源 |
| 阻断力随各 check 既有 severity（D2） | `component_tree_per_page` 是 **MAJOR**：它的假 n/a FAIL 不进 blocker 聚合（summary-blockers.ts:40）、真 n/a 的 SKIP 不进 failures-only 控制台（report-generator.ts:641） | **不为它提 severity**（属改质量红线）；两个 BLOCKER 项的假 n/a 仍构成阶段阻断、真 n/a 的 SKIP 仍显示；承诺按"check FAIL"与"阶段阻断"分别陈述，不混为一谈 |
| 组件树按 `components` 整体判空（D2） | "有组件无页面"的 feature 仍走原判定 | 不猜 `kind` 语义，不为它新增 schema 字段 |
| 数量不再是判据（D3） | verifier 漏判空壳用例的风险上升 | **流程类用例**的检查 4 三项硬要求、4C、`it_drives_flow` WARN、脚本侧覆盖门禁全部保留；豁免只给形态上确实是纯函数/单规则的用例 |
| F09 只改五处（D4） | 不做全仓穷尽证明 | 五处均附代码行号对照；B01 已修处不重复动；真 BLOCKER（FAST_PATH 红线等）一字不改 |

## 6. 验收用例

**生产接线要求。** 策略用例一律经**真实 `resolveEvidencePolicy` → 真实 `resolveVerifierPlan` → 真实 summary writer**这条链。

V1 的接法**经 codex 一轮 medium 订正**：`resolveVerifierRequestEligibility` 定义在 harness-runner.ts:**1485** 且**没有 `export`**（:1168 与 :1878 都只是调用点），单测拿不到它——原写法不可实现。改为复用**已导出**的 `writeRunSummaryBase`（harness-runner.ts:1738）：把真实 policy → 真实 `resolveVerifierPlan` 的结果按 `opts.verifierPlan` 传进去，它内部会调同一个 `resolveVerifierRequestEligibility`（:1878），于是签发与否**仍由生产判据决定**，断言落在它的可观测产物上——`summary.verifier_subject_id` / `verifier_request` / `verifier_report`（:1990–1992 的条件字段）与 `summary.ai_prompt`（:1949）在 review 下**全部缺席**、在 spec 下**全部在场**。**不得**手搓 `policy` 字面量冒充。

**只调 writer 还不够，V1 必须补上 prompt 装配这一前置**（codex 二轮 partial→补齐；逐行核实）：`issueVerifierRequest` 在 harness-runner.ts:**2100–2103** 读不到 `<reports>/ai-prompt.md` 时直接 `return null`（`promptRaw === null` → warn "ai-prompt.md 不可读，本轮不生成 verifier 调用凭证"），writer **自己不生成 prompt**。所以"空目录直调 writer"在 spec 与 review 两侧都会零产物：spec 侧拿不到 plan 承诺的"四字段与 `ai-prompt.md` 全部在场"，review 侧的"全部缺席"也只证明了目录是空的，与 policy 无关——正是本 plan §6 禁止的"套件全绿当证据"。

改为**走真实 Step 4 装配 → writer**这条完整链，且 Step 4 的门控用生产的同一个谓词（`canProduceVerifierRequest`，verifier-plan.ts:256，已 `export`；harness-runner.ts:1168 与 :1878 的 `resolveVerifierRequestEligibility` 只是它的两个包装调用点）：

- `phase='review'`（goal×balanced）：policy → `plan.mode==='disabled'`/`reason==='policy_off'` → 谓词判**不放行** → **Step 4 不执行**（生产 :1170–1172 打印"跳过 AI Harness prompt 装配"）→ 无 `ai-prompt.md` → writer 零 verifier 字段。断言必须写成"**Step 4 因 policy 被关闭**"（先断言 `plan.mode==='disabled' && plan.reason==='policy_off'` 与谓词 `allowed===false`，再断言产物缺席），**不得**写成"空目录里没有 prompt"；
- `phase='spec'`（同 config）：policy → `plan.mode==='enabled'`/`reason==='policy_required'` → 谓词放行 → 以**真实 `assembleAIPrompt`**（真实 `HARNESS_ROOT` + `plan.verifier_prompt`）落盘 `ai-prompt.md` → writer 签发 → 四字段与磁盘 `ai-prompt.md` 全部在场。

V3 走 `check-receipt-policy` 的既有子进程真实跑法（已核实，见该行）。n/a 用例（V4）一律经**真实 `SpecLoader` + 真实 check-plan 导出函数**跑临时工程夹具，不手拼 `FeatureSpec`；其中"真源不可信"三类负例须经**真实 checker / runner 入口**观察（`feature_spec_shape` 由 harness-runner.ts:1086 产出，只调导出函数看不到它）。文案改动（V5/V7）由**读真实文件**的守卫 + 真实 `assembleAIPrompt` 落盘物化双锁。

**改前必红的适用面**：只有**本批新增的缺陷断言**要求改前红、改后绿——V1（goal×balanced→review 无 request/subject）、V2 的两条翻转例 + 保留阶段 trace 例、V3（含 trace 损坏负例）、V4 的三条真 n/a、V5 的五条文案守卫、V8 的闭环负例、**V7 中新增的文案断言**。V6 是既有不变式护栏（默认等值、lite 恒 minimal、红线零耦合、ratchet 不超基线），**V7 的既有装配通路测试**（`verifier-production-routing`:125 / :153 / :176 用 sentinel 模板，与 verify-ut.md 正文无关）改前改后均绿——codex 一轮 low：两者必须分开列，不得把"套件全绿"当成新断言的证据。

**V4 的三条"真源不可信"负例是护栏、不是缺陷断言**（codex 二轮 low 订正）：它们断言的是"不出现 SKIP、保持原判定"，而 S1 之前 check-plan.ts 全文件零 `不适用` 字样、三个 check 根本没有任何 SKIP 出口（`grep -c 不适用 harness/scripts/check-plan.ts` = 0），所以这三条**改前就已经绿**。把它们列进"改前必红"是假反证——改为与 V6 同档的**改前改后均绿的回归护栏**：它们的价值在于锁死 S1 之后 n/a 出口不会在真源不可信时放行，而不是证明 S1 修好了什么。

| ID | 输入 | 必须观察到 |
|---|---|---|
| V1 | `verifier-plan` 套件：真实 `resolveEvidencePolicy('full', ctx('goal',<phase>), { evidence_profile:'balanced' })` → 真实 `resolveVerifierPlan({ phase, track:'full', runtimeMode:'goal', policy, workflowVerifierPrompt: workflowVerifierPrompt(spec, phase), adapterHasVerifierSubagent:true })` → **真实 Step 4 门控**（`canProduceVerifierRequest`，verifier-plan.ts:256）→ 放行时以真实 `assembleAIPrompt`（真实 `HARNESS_ROOT` + `plan.verifier_prompt`）落盘 `ai-prompt.md` → **`writeRunSummaryBase(root, report, frameworkRoot, { verifierPlan: plan })`**（已导出，harness-runner.ts:1738；内部走同一个未导出的 `resolveVerifierRequestEligibility`:1878）；`phase='review'` 与 `phase='spec'` 两跑对照 | review：`policy.verifier==='off'`、`plan.mode==='disabled'`、`plan.reason==='policy_off'`，**且 Step 4 门控 `allowed===false`、reason 指向 plan disabled**（先断言这一条，再断言产物）——落盘 summary 无 `verifier_subject_id` / `verifier_request` / `verifier_report` / `ai_prompt`、磁盘无 `ai-prompt.md`；spec：`policy.verifier==='required'`、`plan.mode==='enabled'`、`reason==='policy_required'`、门控 `allowed===true`，装配后四个字段与 `ai-prompt.md` **全部在场**。**改前 review 实得 required/enabled、门控放行、四字段在场**（config 被早退丢弃） |
| V2 | `runtime-policy` 套件：翻转 :238–249（goal/headless×balanced）与 :261–268 最后一行（`resolveProfileLabel('full', ctx('goal'), balanced)`）；新增无配置在 interactive/headless/goal 三态的 strict 真值表；**新增保留阶段 trace 例**：`resolveEvidencePolicy('full', ctx('goal','spec'), balanced)` 与 `ctx('goal','coding')` | 三 mode×balanced 输出与 interactive×balanced 逐一相同（trace=optional、非保留 phase verifier=off）；`profile_resolved==='balanced'`；无配置三态恒 strict；**保留阶段例：`verifier==='required'` 的同时 `trace==='optional'`**——钉住"verifier 四阶段 / trace 六阶段"两个范围不相等（codex 一轮 medium）。**改前两条翻转例与保留阶段例实得 strict** |
| V3 | `check-receipt-policy` 套件：既有 `buildProject('review', { evidenceProfile:'balanced', omitVerifier:true, omitTrace:true, claimedAttemptId:'i8' })`，经既有 `tryValidateReceipt(..., { goalIdentity:{ runId:'run-X', attemptId:'i8', attemptPhase:'review' } })` 走 goal 态（该 opts 在 [phase-state.ts](../../harness/scripts/utils/phase-state.ts):344 声明，:383–385 注入 `MAISON_GOAL_RUN_ID`/`ATTEMPT`/`ATTEMPT_PHASE`，:407 spawn 子进程）；stdout 用例（:322–347）沿用**直接 `spawnSync`** | 退出码与 interactive 同例一致（verifier 缺失 PASS、trace 缺失只 WARN）；stdout 含 `profile_resolved=balanced`。**改前实得 strict → verifier 缺失 FAIL**。**已核实**（codex 一轮 medium）：①夹具默认写 legacy receipt（:183 起，无 `claimed_attempt_id`），goal 态下 check-receipt.ts:1053 `!claimedAttempt` 会独立报 `receipt_attempt_identity` BLOCKER，污染本用例——故必须传 `claimedAttemptId` 且与 `goalIdentity.attemptId` 相等；②`opts.claimedAttemptId` 该套件**已有**（:50 声明、:191 写入），不需新增夹具形参；③run helper **不需要** `env?` 形参——`goalIdentity` 已是既有的 env 注入通道；④该 receipt 非 slim（无 `receipt_schema`），check-receipt.ts:526 的 slim run-identity 门不触发。**另加 trace 损坏负例**（codex 二轮 medium）：canonical 路径写一份**非法 JSON** 的 `trace.json`，回执写 `trace_json: {}`（声明缺失），goal×balanced 下必须仍是 `trace_json_not_parseable` **BLOCKER**、退出码非 0——**改前实得 `trace_json_missing_optional` MAJOR WARN + 退出码 0**（回执自报把损坏藏掉）；同配置的对照例（canonical 无 trace.json + 回执 `{}`）仍 PASS |
| V4 | `contract-reference-closure` 套件：`withProject` 造工程，每组写 plan.md（章节在场，正文一行 `不适用：<依据>`）+ contracts.yaml，分别调真实 `checkDataModelTyped` / `checkInterfaceSignaturesComplete` / `checkComponentTreePerPage`；每个 check 一对正/反例；**另加三条"真源不可信"负例**（contracts.yaml 缺失 / 根节点非 mapping 解析失败 / `data_models: {}` 被归空并留 `shape_issues`），负例经真实 checker 或 runner 入口观察 | 正例（对应 contracts 集合为空且无该集合 `shape_issues`）：`status==='SKIP'`，details 含判据来源与作者依据；反例（contracts 里有条目却写 n/a）：`status==='FAIL'`、severity 与今天相同、details 点名 contracts 条目、`suggestion` 非空。三条真源负例：**一律不得出现 SKIP**——落回今天的判定（`data_model_typed`/`interface_signatures_complete` FAIL、`component_tree_per_page` 按其原出口），且 `shape_issues` 那条经 runner 入口另见 `feature_spec_shape` BLOCKER FAIL。**改前基线**（codex 一轮 low 校正）：`data_model_typed` / `interface_signatures_complete` 的正例实得 **BLOCKER FAIL**；`component_tree_per_page` 的正例实得 **MAJOR WARN**（check-plan.ts:591–592「无页面子章节」），**不是 FAIL**。**三条真源不可信负例属改前改后均绿的回归护栏**（codex 二轮 low）：S1 之前三个 check 无任何 SKIP 出口（`grep -c 不适用 harness/scripts/check-plan.ts` = 0），"不出现 SKIP"本就成立，不得列为改前必红 |
| V5 | `context-facts` 套件 :95 那条 case 内追加**五**条文本守卫（读真实文件） | verify-ut.md 不再含"只有 1 个 expect"式数量硬判、且仍含检查 4 的中间态/终态与异常 path 要求（**对流程类用例**）；business-ut-workflow-detail.md **既不含"保持 BLOCKER"也不含 :121 的"完整重走 review→ut→testing"**（两句合为一条守卫的两个断言）；device-testing-workflow-detail.md 不含"拦下"+"回跑 review 重审"、且仍含 `*_FAST_PATH` 红线；check-testing.ts:6095 的 JSDoc 不再含"任何差异/缺 attestation → BLOCKER"；goal-mode-runbook.md 不再把"agent 已写好 test-report.md"当 report-only 前置。**五条改前均红** |
| V6 | 既有不变式护栏（改前改后均绿）：`runtime-policy` :290–306 键集、:308–328 红线文件零耦合扫描、lite 恒 minimal（:194–207）；`blocker-suggestion-ratchet` 全量；`goal-runtime-structural-acceptance` structural 10/13 | 键集恒四项；五个红线文件仍不含 evidence 符号；lite 输出不变；check-plan.ts 违规计数 ≤13；check-plan.ts 不含 `exemption` 类命名 |
| V7 | `verifier-production-routing` 套件：以**真实** harness 根（该套件 :55 已有 `HARNESS_ROOT = path.resolve(__dirname,'..','..')`）+ `verifierPromptRel: 'prompts/verify-ut.md'`（真实 UT 模板）调 `assembleAIPrompt`，读回落盘的 `ai-prompt.md`（:147 的既有读法） | 落盘正文（**整份物化 prompt**，非单句）三处一致：含改写后的第 5 条判据句、4B 第 2 条与检查 4 第 1 条各自的适用范围限定句；不含"只有 1 个 expect"；检查 4 第 2/3 条与 4C 正文原样在内。**已核实**（codex 一轮 low）：只需把既有的 `fakeHarness` 换成 `HARNESS_ROOT`，临时工程 `root`、`reportsDirOf` 读法与真实 `harness/prompts/verify-ut.md` 均已在场，不需新夹具。**本行的文案断言是新增缺陷断言、改前必红**；同套件 :125 / :153 / :176 的既有装配通路测试（sentinel 模板）**改前改后均绿**，不得混为一谈 |
| **V8**（新增，D1 补丁） | `check-receipt-policy` 套件：`buildProject('review', { evidenceProfile:'balanced', claimedAttemptId:'i8' })`，当前 subject 上写入一份有效 verifier 报告（subject 回显匹配、`verdict: FAIL`），然后**经真实 writer 重写 summary**——真实 `resolveEvidencePolicy('full', ctx('goal','review'), balanced)` → 真实 `resolveVerifierPlan` → `writeRunSummaryBase(root, <脚本全 PASS 的 ScriptReport>, FRAMEWORK_ROOT, { verifierPlan })`（**不得**手写 summary 冒充沿用态，见 §6 生产接线要求）；再经 `goalIdentity` 走 goal 态跑 check-receipt | writer 侧：`summary.verifier_subject_id` **仍在场**（沿用）、`summary.verifier_report` 在场、**无** `verifier_request`（本轮未签发）、`next_action==='fix_verifier_findings_then_rerun_harness'`。check-receipt 侧**仍不放行**：`verifier_not_pass` BLOCKER 在场、退出码非 0——policy off 只免除"要求提供"，不免除"已有的负面结论"。对照例：同配置但**无**该报告 → writer 零 verifier 字段、check-receipt PASS（这才是 balanced 买到的东西）。**改前（仅删两行早退、不加 S0b）实得：writer 丢弃 subject、`next_action==='fill_receipt_then_sync_closure'`、check-receipt PASS** |

B06 登记项（本批不做）：bc-openCard-1 的 C-U 回归核对——宿主声明 balanced 时四阶段确实不再签发 verifier request 且闭环不要求该轴、**六阶段（含 spec/coding）的 trace 确实只 WARN**、**已有的有效 verifier FAIL 仍能拦下 balanced 轮**、真 n/a 的 plan 能过门而假 n/a 仍被拦、单精确断言的 UT 不再被 verifier 判 FAIL 而空壳用例仍被判出。

## 7. 命令与完成判据

开发仓根执行。[select-suites.ts](../../harness/tests/utils/select-suites.ts) 按 `suite.id.includes(filter)` 选套件；以下过滤串已按 `run-unit.ts` 全部 261 个 `id:` 加 profile 自动发现结果比对为**唯一**命中：`runtime-policy`（不误命中 goal-runner-policy / check-receipt-policy / init-update-policy / phase-transition-policy）、`verifier-plan`、`check-receipt-policy`、`contract-reference-closure`、`context-facts`、`verifier-production-routing`、`blocker-suggestion-ratchet`、`goal-runtime-structural-acceptance`。不拼接多个 id。

    node scripts/check-plan-version.mjs
    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter runtime-policy
    npm --prefix harness run test:unit -- --filter verifier-plan
    npm --prefix harness run test:unit -- --filter check-receipt-policy
    npm --prefix harness run test:unit -- --filter contract-reference-closure
    npm --prefix harness run test:unit -- --filter context-facts
    npm --prefix harness run test:unit -- --filter verifier-production-routing
    npm --prefix harness run test:unit -- --filter blocker-suggestion-ratchet
    npm --prefix harness run test:unit -- --filter goal-runtime-structural-acceptance
    npm run openspec:validate
    npm run candidate:build

纯文案返修只查相关 diff/plan；生产变更跑目标检查。`candidate:build` 含 typecheck、unit 全量、fixture、consumer smoke 与 zip 校验，作全量验收，不在它前后另跑重复 `npm test`。

**本地完成 = 本批完成**（总plan §1/§5：B05 只做本地验收）：V1 至 **V8** 通过（新增缺陷断言 V1/V2/V3/V4/V5/**V8** 与 **V7 的文案断言**须先确认改前红；V6 与 **V7 的既有装配通路测试**改前改后均绿，见 §6）、OpenSpec delta 与 MIGRATION 同步、候选件可交用户，即可置 `b05-local-acceptance` completed。`b05-host-acceptance` 保持 pending 直到 B06 的 C-U 回归覆盖本批窗口——**不得**用本地通过冒充宿主证据。

## 8. 修订记录

### 2026-09-06：提纲细化为施工图（未实施、未提交）

- 批次门对齐总plan §1/§5：删去提纲里"依赖B04宿主反馈""根据前批宿主反馈""闭环后进入B06差异验收"三处表述，改为静态调用链 + 已落地代码事实为据；`b05-host-acceptance` 改为并入 B06；`b05-testability-frontload` 维持 cancelled。
- F08 逐行核实后确认为"config 参数在 goal 分支根本不参与求解"（runtime-policy.ts:408–410），修法收敛为**删两行早退**——缺省 strict 由既有 :411–412 分支承接，default 等值不变式自动保住。同时核实 mode 在生产里只有 goal/interactive 两值、attended/detached 属 run owner 与本轴无关，据此重写行为表，不按提纲的三态臆造。
- 受影响面按真实 workflow 声明穷尽：六个 feature phase 全有 `verifier_prompt`，保留集 `{spec, coding}` 故受影响的正是 plan/review/ut/testing 四个；trace 降 optional、receipt 两档同为 not_applicable（零变化）逐条核对 check-receipt 的消费点。
- `balanced_verifier_retained_phases` 经核实**未接线**（FrameworkConfig 无此字段、两个调用点都不传），写进 D5-a 并明确不改；`resolveProfileLabel` 的第二个消费者（correction 自动确认）经 grep 确认已随 07a41ec6 T1 退场，故本条无额外影响面。
- plan n/a 出口按三个 check 的实际 FAIL 出口设计，并核实了 SKIP 的四个下游语义（blocker 聚合/控制台显示/质量轴计数/ratchet），确认无需另配；假 n/a 用带 suggestion 的 FAIL 以免顶破 ratchet 基线；命名避开 `exemption` 以免撞 structural 10/13 源码扫描。
- 数量项按提纲核实后拆成两半：`it_drives_flow` 的 severity/status **确认已是 MAJOR WARN、不改**（写进 D5-b），只动 suggestion 措辞；verify-ut 的硬判在 :156 第 5 条，只改这一条，检查 4/4C 与严重度表不动。
- 剩余 F09 全仓 grep 后**只列三处确认矛盾**（+1 同源 runbook 前置），逐处附代码行号对照；`report_reconcile_only` 与 B02 四态经核实在文档侧零矛盾，写进 D5-c 并不改。
- 全部落点行号为本次核实时的实际位置（工作树含 B01–B04 已实施改动与若干未提交改动），实施时须以当时行号为准。

### 2026-09-06：codex plan review 第 1 轮（全部采纳，未实施）

每条均已回代码逐行复核，行号为复核时实际位置。

| # | 级别 | 问题 | 修正落点 |
|---|---|---|---|
| 1 | high | D2 的 contracts 可用性前提**错误**：check-plan.ts:985 在 contracts 缺失时返回的是 :991 `status:'SKIP'`（不是 FAIL），summary-blockers.ts:40 只收 `FAIL+BLOCKER` → 不阻断、后三项照常执行；spec-loader.ts:489–495 `normalizeArrayField` 还会把 `data_models: {}` 归空并只记 `shape_issues`（:491/:494），而 `shape_issues` 只在 runner 侧升 FAIL（harness-runner.ts:1086–1096），只调三个导出函数的单测路径拿不到 | §1-② 换成「真源在场并无保证」段并附三类实证；D2 把 n/a 前提**写死**为「contracts 在场 + 解析成功 + 该集合无 `shape_issues`」，三类不成立一律落回今天的判定；D2 放弃的准确性加 ④；§5 加「n/a 需真源可信」行；V4 加三条真源不可信负例并要求经真实 checker/runner 入口；D6 的 harness-gates delta 由两条 scenario 增为三条；S1 文件行同步 |
| 2 | high | D1 关轴也会**忽略已有 verifier FAIL**：check-receipt.ts:680 的 disabled 分支完全不读报告（负面否决 `verifier_not_pass` 在 :746，只活在 :700 起的 enabled 分支），harness-runner.ts:2058 `resolveVerifierEvidenceState` 首行直接 `return 'not_applicable'`（其结果喂 :1961–1962 `decideNextAction` 与 :2016 候选组装）→ goal×balanced 下同材料已有的有效负面报告被静默丢弃 | D1 新增「policy off = 不要求，不等于忽略」段与「本条放弃的准确性」三条；§4 加 **S0b** 组（两处落点，复用既有 `verifier_not_pass` 与 `'fail'` 枚举，不新增 check id/状态成员）；§5 加「policy off 只免"要求"」行；§6 新增 **V8** 闭环负例（脚本 PASS + 有效 verifier FAIL + 材料未变 → 仍不放行，对照例无报告 → PASS）；MIGRATION 与 B06 登记项同步 |
| 3 | medium | D3 只改第 5 条不够：单断言纯函数仍被保留条款判 FAIL——verify-ut.md:153（4B 第 2 条）**无条件**要求「happy path 至少两类断言」，:135–139（检查 4 第 1 条）要求调用序列 + 中间态/终态，:141–144 判「任一项不成立 → FAIL(BLOCKER)」 | D3 新增「只改第 5 条不够」段：给 4B 第 2 条与检查 4 第 1 条各加适用范围——纯函数/单规则用例只要求「错误实现会失败 + 覆盖该规则边界」，**流程类用例逐字保留**；判据是用例形态不是作者声称；§2 非目标同步限定；S2 落点由一处扩为三处；V7 改为检查**整份物化 prompt** 的三处一致性 |
| 4 | medium | V1 引用的 `resolveVerifierRequestEligibility` 定义在 harness-runner.ts:**1485** 且**无 `export`**（:1168 与 :1878 均为调用点），单测拿不到——原写法不可实现 | §6「生产接线要求」改为复用已导出的 `writeRunSummaryBase`（:1738），把真实 policy→plan 结果按 `opts.verifierPlan` 传入（内部走同一个 :1878 的资格判定）；V1 断言改落在产物上：review 下 `verifier_subject_id`/`verifier_request`/`verifier_report`（:1990–1992）与 `ai_prompt`（:1949）全缺席、spec 下全在场 |
| 5 | medium | V3 的「待核实」可静态定案，且原设计会踩独立 BLOCKER：夹具默认写 legacy receipt（:183 起无 `claimed_attempt_id`），goal 态下 check-receipt.ts:1053 `!claimedAttempt` 报 `receipt_attempt_identity` BLOCKER；stdout 用例（:322–347）本就是直接 `spawnSync`、无本地 helper | V3 行改为：传既有的 `claimedAttemptId`（:50 声明、:191 写入）+ 经既有 `goalIdentity`（phase-state.ts:344 声明、:383–385 注入三个 env、:407 spawn）走 goal 态，**不需**新增 `env?` 形参；stdout 检查沿用直接 spawn；另核实该 receipt 非 slim，check-receipt.ts:526 的 slim run-identity 门不触发。**「待核实」全部删除** |
| 6 | medium | D4 的两处引用有误：business-ut-workflow-detail.md **:121**「完整重走 review→ut→testing」与 :122「出路只有两条」是同一条退出路径的相邻两半，只改 :122 会留矛盾（check-ut.ts:1182 suggestion 明写「不必重走整套 review 闭环」）；JSDoc 矛盾句在 check-testing.ts:**6095**（原写 :6089–6093），纠偏注释在 :6107–6108，四个出口是 :6103/:6113/:6129/:6145（原写 :6104/:6113/:6126） | §1-④ 表三行全部重写并附准确行号；D4 改为逐条列出、:121 与 :122 一起改；S3 落点与「只改这五处」同步；V5 由四条守卫增为五条（新增 check-testing.ts:6095 JSDoc 守卫，business-ut 一条守两句） |
| 7 | medium | D6 漏改 scenario：runtime-policy/spec.md **:28** 的 `goal-mode 无视 balanced` 仍与 D1 直接对立，**:26** 仍写 `receipt=required`；且 :90–92 的「全凭证 required」不准确——strict 的 receipt 是 `not_applicable` | D6 表的 runtime-policy 行重写为四项 MODIFIED：:22 正文（删「headless/goal MUST 恒按 strict」）、:24–26（receipt 纠正为 not_applicable、trace 明写 optional）、**:28–30（goal-mode 无视 balanced 必须改）**、:90–92（strict 改为逐轴准确表述） |
| 8 | medium | D1 的 trace 降档范围少算：runtime-policy.ts:**416** 只有 verifier 按保留集分流，:418 的 `trace:'optional'` 对**全部六个** balanced phase 生效（含 spec/coding） | D1 新增「两根轴的降档范围不同」段并把受影响面拆成 verifier / trace / receipt 三个条目分列；行为表 interactive 行注明「六阶段一律」；§5 的 trace 行重写；MIGRATION 分两条范围不同的轴陈述；V2 新增保留阶段 trace 例（`verifier==='required'` 同时 `trace==='optional'`）；B06 登记项加该条 |
| 9 | low | D2/V4 的下游与基线承诺对 MAJOR 那一个不成立：`component_tree_per_page` 章节在场但无子章节时原结果是 check-plan.ts:591–592 的 `MAJOR`/**WARN**（非 FAIL）；`SKIP+MAJOR` 被 failures-only 隐藏（report-generator.ts:641 只放 `SKIP+BLOCKER`）；`FAIL+MAJOR` 不进 blocker 聚合（summary-blockers.ts:40） | 保留既定 severity（**不提级**）。§1-② 新增「三者的严重度与出口并不同形」段；D2 的下游语义改成按 severity 分列的表 + 「check FAIL ≠ 阶段阻断」的承诺修正；§5 新增「阻断力随各 check 既有 severity」行；V4 的改前基线按 check 分别写明（两个 BLOCKER FAIL / 一个 MAJOR WARN） |
| 10 | low | V7 未区分「新增文案断言改前必红」与「既有装配通路测试始终绿」，且「待核实」可静态定案 | §6「改前必红的适用面」把两者分开列；V7 行注明只需把 `fakeHarness` 换成该套件 :55 已有的真实 `HARNESS_ROOT` + 真实 `prompts/verify-ut.md`，临时工程与 `reportsDirOf` 读法均已在场、不需新夹具，**「待核实」删除**；§7 完成判据同步为「V1 至 V8，V7 的文案断言须改前红、其既有装配通路测试改前改后均绿」 |

### 2026-09-06：codex plan review 第 2 轮（全部采纳，未实施）

| # | 级别 | 问题 | 修正落点 |
|---|---|---|---|
| 1 | partial→补齐 | S0b 的 writer 链未闭合：只翻转 `resolveVerifierEvidenceState`（harness-runner.ts:2058）不够——:1900 的候选正文按 `verifierIssued?.subjectId ?? null` 取，disabled 下恒传 null → `loadVerifierReportTextOrNull` 首行返回 null → 零候选；:2450 的 `if (mode === 'disabled') return 'fill_receipt_then_sync_closure'` 排在 `switch (verifierEvidence)` 之前，`case 'fail'` 永远读不到；:1990–1992 的条件字段还会把 `verifier_subject_id` 从落盘 summary 里移除，下一环 check-receipt 的 `loadVerifierEvidence`（以磁盘 summary 为锚）因此也读不到 | D1「policy off ≠ 忽略」段新增四落点表 + 「当前材料 subject 怎么取」段（disabled 下 `buildVerifierMaterialView` 的输入不存在，改为"上一轮 summary 的 subject + `gate_fingerprint`/`source_commit_sha`/`worktree_digest` 三锚全等"这一充分排除条件）；「本条放弃的准确性」加 ④；§4 S0b 落点由两处扩为**五处**；V8 改为**经真实 writer 再验 check-receipt**并加 writer 侧四项断言 |
| 2 | partial→补齐 | V1 缺 prompt 装配前置：`issueVerifierRequest`（harness-runner.ts:2100–2103）读不到 `ai-prompt.md` 就 `return null`，writer 自身不生成 prompt——空目录直调 writer 时 spec 侧拿不到承诺的四字段，review 侧的"全部缺席"只证明目录是空的 | §6 生产接线要求新增一段：V1 走**真实 Step 4 装配 → writer**，Step 4 门控用生产同一谓词 `canProduceVerifierRequest`（verifier-plan.ts:256，已导出）；spec 侧以真实 `assembleAIPrompt` + 真实 `HARNESS_ROOT` 落盘 prompt。V1 行断言改为**先断言 Step 4 被 policy 关闭**（`plan.mode==='disabled'`/`reason==='policy_off'` + 门控 `allowed===false`）再断言产物缺席 |
| 3 | medium（新） | D1/trace：check-receipt.ts:819 `traceProvided = tj.exists === true && Boolean(tj.path)`——legacy 分支只按**回执自报**决定要不要看磁盘，损坏判定全在 `traceProvided===true` 的 else 里。"canonical 路径有损坏 trace.json + 回执写 `trace_json: {}`"时，strict 还能靠 `exists=false` BLOCKER 兜住，**goal×balanced 直落 `trace_json_missing_optional` MAJOR WARN**，损坏证据被藏；slim 分支（:788–800）早已磁盘直查、无此问题 | D1 的 trace 条目新增收口段：legacy 分支改为**以 canonical 路径磁盘存在性为准**（回执 `tj.path` 只作 canonical 缺席时的兼容回退），损坏（不存在 / 非法 JSON）恒 BLOCKER 不变、不新增 id；§4 S0b 落点加 check-receipt.ts:819；V3 加「损坏文件在场 + 回执声明缺失」的 goal×balanced 负例（改前实得 WARN + 退出码 0） |
| 4 | low（新） | §6 把 V4 的三条真源不可信负例（缺 contracts / 解析失败 / `shape_issues` → 不出现 SKIP、保持原判定）列进"改前必红"，但 S1 之前三个 check 根本没有 SKIP 出口（check-plan.ts 全文件零 `不适用` 字样，`grep -c` = 0），这三条改前就绿——假反证 | §6「改前必红的适用面」把三条真源负例从缺陷断言里移出并说明理由；V4 行注明它们是**改前改后均绿的回归护栏**（与 V6 同档），价值在锁死 n/a 出口在真源不可信时不放行 |

## 实施记录

### 2026-09-06：S0–S4 实施 + 本地验收（未提交、未跑宿主）

行号为实施后的实际位置。每组按"落点 → 行为变化 → 反证"记。

#### S0 F08 策略（D1）

| 落点 | 行为变化 |
|---|---|
| [runtime-policy.ts](../../harness/scripts/utils/runtime-policy.ts):93（`resolveProfileLabel`）、:408–410（`resolveEvidencePolicy`） | 两处 `ctx.mode !== 'interactive'` 早退**删除**。缺省由既有 `config?.evidence_profile !== 'balanced' → STRICT` 分支承接，三个 mode 无配置时输出逐字不变；显式 balanced 在 goal/headless 与 interactive 逐一相同 |
| runtime-policy.ts:391–405 求解注释 | 重写：不再写"非 interactive 强制 STRICT"，改为写明两根轴的不同范围（verifier 按保留集分流四阶段、trace 无条件降六阶段）与"policy off ≠ 忽略" |
| [config.ts](../../harness/config.ts):456–462 `evidence_profile` 字段注释 | 删掉"只在 mode==='interactive' 分支参与求解；headless/goal 恒强制 strict"这句与代码相反的说明 |

常量（`STRICT_EVIDENCE` / `LITE_EVIDENCE` / `DEFAULT_BALANCED_VERIFIER_RETAINED_PHASES`）与 lite 优先分支**零改动**。

#### S0b policy off ≠ 忽略（D1 补丁，五处落点）

| 落点 | 行为变化 |
|---|---|
| [harness-runner.ts](../../harness/harness-runner.ts):2110–2160 新增 `resolveCarriedVerifierSubject` | disabled 时读**上一轮落盘 summary** 的 `verifier_subject_id`，要求该 summary 的 `gate_fingerprint` / `source_commit_sha` / `worktree_digest` 与本轮重算值**全等**，且 `loadVerifierEvidenceForSubject` 验真通过且 verdict ≠ PASS，才沿用（**沿用判据已被 codex 一轮 high 推翻，改法见下方"codex review 第 1 轮返修"**） |
| harness-runner.ts:2085–2100 `resolveVerifierEvidenceState` | 新增 `carriedFail` 形参：`mode !== 'enabled'` 时由恒 `not_applicable` 改为"沿用到就报 `'fail'`" |
| harness-runner.ts:1900–1920 候选正文 | `loadVerifierReportTextOrNull` 的 `subjectId` 由 `verifierIssued?.subjectId ?? null` 改为 `anchoredSubjectId`（签发的 ∪ 沿用的），disabled 下不再恒零候选 |
| harness-runner.ts:2455–2460 `decideNextAction` | `verifierEvidence === 'fail'` 的判定**前置**于 `if (mode === 'disabled')` 早退，并从 switch 里移除重复的 `case 'fail'` |
| harness-runner.ts:2005–2018 summary 条件字段 | 沿用态写 `verifier_subject_id` + `verifier_report`（**不写** `verifier_request`——本轮没签发新凭证） |
| [check-receipt.ts](../../harness/scripts/check-receipt.ts):680–703 disabled 分支 | 先 `loadVerifierEvidence`，验真通过且 verdict ≠ PASS → 保留 `verifier_not_pass` BLOCKER（复用既有 id，话术补上"关轴只免除要求提供"）；缺席/PASS 才走原来的 `skipped_by_policy` / `not_applicable` |
| check-receipt.ts:842–862 + :884–902 legacy trace | `traceProvided` 改为**canonical 路径磁盘直查优先**，回执 `tj.path` 只在 canonical 缺席时兜底；canonical 在盘上时一律解析（`schema_valid: false` 自报不再跳过损坏判定）。issue id 与 severity 全部不变 |

**与 plan 不同的取舍（已回写 D1，见 §3「当前材料 subject 怎么取」与「本条放弃的准确性」④）**：plan 原写"复用 `buildVerifierMaterialView` 重算当前材料 subject"。逐行核实后**不可实现**——disabled 时 Step 4 被 policy 关闭，`contextFiles` / `templateText` / `phaseRuleText` 在 writer 里根本不存在。改为三锚全等的**充分排除条件**。放弃的准确性：`prompt_sha256` / `material_sha256` 这两个 subject 派生输入算不出来，"三锚未动而 phase 输入文件已改"仍会沿用旧 FAIL——多否决而非少否决；解除需跑一轮 strict 让 verifier 自己撤回结论。

**顺带修的一处**（V8 暴露）：harness-runner.ts:2225–2245 `resolveGitHeadSha` 的 `cachedHeadSha` 是**全局单值**缓存。writer 已 `export`，单进程内为两个不同工程各写一次 summary 是合法调用（V8 与 V8 对照例即如此），全局缓存会把第一个工程的 HEAD 算到第二个头上，落一份 `source_commit_sha` 与自身 HEAD 不符的 summary（check-receipt 侧表现为 `slim_summary_source_sha_stale`）。改为**按 projectRoot 分键**；生产语义不变（一个进程一个工程）。

#### S1 plan 不适用出口（D2）

| 落点 | 行为变化 |
|---|---|
| [check-plan.ts](../../harness/scripts/check-plan.ts):501–566 新增 `resolveSectionApplicability`（已 `export`） | 三 check 共用的纯函数。三条可用性前提写死在函数里：contracts 在场（缺失/解析失败时 loader 不挂载，两情形合流）+ 该集合无 `shape_issues` 留痕。任一不成立返回 `null` → 落回今天的全部判定 |
| check-plan.ts:569 / :613 / :665 三个 check | 各加两行，插在 `getSectionContent` 成功之后、代码块/子章节判定之前；severity 由调用点保留（两个 BLOCKER、`component_tree_per_page` MAJOR），三处加 `export` 供 V4 走真实函数 |

命名避开 `exemption`（`goal-runtime-structural-acceptance` structural 10/13 的源码正则）。`required_chapters`、contracts 闭包判定、`shape_issues` 写入面**零改动**（只读）。

#### S2 数量口径（D3）

| 落点 | 行为变化 |
|---|---|
| [verify-ut.md](../../harness/prompts/verify-ut.md):134–138（检查 4 第 1 条前的适用范围段） | 新增：纯函数/单规则用例的调用序列与中间态两项按**不适用**处理；流程类用例三项逐字适用。判定逻辑第 4 条同步改为"**适用的**各项" |
| verify-ut.md:157（4B 第 2 条） | 句末加适用范围：只对流程类用例要求"两类断言" |
| verify-ut.md:160（4B 第 5 条） | 整条改写：判据是"该 `it` 若被错误实现会不会失败 + 是否覆盖边界/异常"，单条精确断言是合法形态；"只测 repository 静态数据结构"这一支保留 |
| [check-ut.ts](../../harness/scripts/check-ut.ts):2264–2269 两条 suggestion | 措辞改为"数量是本 WARN 的触发线索，不是判据" |

检查 4 第 2/3 条、4C、严重度表、`it_drives_flow` 的 severity/status/判定式（:2229–2234）**零改动**。

#### S3 剩余 F09 文案（D4，五处纯文案零行为）

[business-ut-workflow-detail.md](../../skills/reference/business-ut-workflow-detail.md):121（删"完整重走 review→ut→testing"）与 :122（"保持 BLOCKER"→"按风险分级记 MAJOR WARN"、"出路只有两条"→按 check-ut suggestion 的分级复核清单）；[device-testing-workflow-detail.md](../../skills/reference/device-testing-workflow-detail.md):97（"拦下，须回跑 review 重审"→分级列出所需的一次复核）；[check-testing.ts](../../harness/scripts/check-testing.ts):6095 JSDoc 末句（与同函数 :6107–6108 的纠偏注释对齐）；[goal-mode-runbook.md](../../docs/operations/goal-mode-runbook.md):148（删"agent 已写好 test-report.md"前置）。`*_FAST_PATH` 红线、禁止提交换基线、禁止删闭环产物全部一字未动。

#### S4 规格与文档（D6）

新增 OpenSpec change [`phase-contracts-and-applicability`](../../openspec/changes/phase-contracts-and-applicability/)：`proposal.md` + `tasks.md` + 两份 delta。`runtime-policy` delta 覆盖 `Evidence matrix resolution` 正文与其全部 scenario（含**必须改**的"goal-mode 无视 balanced"，已改为"goal 同样按声明求解"）、新增"保留阶段两轴范围不相等"与"关轴不免除已有负面结论"两条 scenario，以及 `Pure policy resolver set` 下的 `headless 强制 strict`（改为"**未**声明降档时仍 strict"，且 strict 逐轴准确表述——receipt 是 `not_applicable`）。`harness-gates` delta 加三条 scenario（真 n/a SKIP、假 n/a FAIL、真源不可信一律不接受）。[MIGRATION.md](../../MIGRATION.md) 增三节（插在「把 framework 发布件集成到目标工程」之前，与 B03/B04 同位）。

### 验收结果（V1–V8）

全部经生产接线：策略走真实 `resolveEvidencePolicy` → `resolveVerifierPlan` → 真实 Step 4 门控（`canProduceVerifierRequest`）→ 真实 `assembleAIPrompt` → 真实 `writeRunSummaryBase`；n/a 走真实 `SpecLoader` + check-plan 导出函数；V3/V8 的 check-receipt 走真 spawn 子进程 + `MAISON_GOAL_*` 身份注入。

| ID | 套件 | 结果 | 反证（改前红） |
|---|---|---|---|
| V1 | `verifier-plan` ⑧ | PASS（8/8） | 恢复两行早退 → ⑧ FAIL（7 PASS / 1 FAIL）：review 实得 enabled、门控放行、四字段在场 |
| V2 | `runtime-policy` | PASS（21/21） | 恢复两行早退 → 2 FAIL（三态 balanced 例、`resolveProfileLabel` 例） |
| V3 | `check-receipt-policy` 两条 | PASS（13/13） | 恢复两行早退 → goal×balanced 例 FAIL；单独回退 trace 磁盘直查 → 损坏 trace 例 FAIL（实得 `trace_json_missing_optional` + exit 0） |
| V4 | `contract-reference-closure` | PASS（32/32） | 停用三个调用点 → 正例/反例 2 FAIL（`data_model_typed` 实得 BLOCKER FAIL「未找到包含 interface/class/enum 的代码块」）；**三条真源不可信护栏改前改后均绿**（已按 codex 二轮 low 从"改前必红"移出） |
| V5 | `context-facts` 五条守卫 | PASS（19/19） | 五条守卫的正则对 `git show HEAD:` 原文逐条命中/未命中，全部证实改前红 |
| V6 | `blocker-suggestion-ratchet` / `goal-runtime-structural-acceptance` | PASS（3/3、13/13） | 护栏，改前改后均绿：ratchet 未超基线、check-plan.ts 不含 `exemption` 类命名 |
| V7 | `verifier-production-routing` K | PASS（12/12） | 把 verify-ut.md 换回 HEAD 版 → K FAIL；同套件 A/B/C 的既有 sentinel 装配通路**改前改后均绿** |
| V8 | `check-receipt-policy` 两条 | PASS | 单独回退 S0b（writer 沿用 + check-receipt disabled 分支）→ V8 FAIL、**V8 对照例仍绿**（护栏方向正确） |

新增/改写的套件用例：`runtime-policy` 2 条（1 翻转 + 1 新增）+ `resolveProfileLabel` 例翻转；`verifier-plan` 1 条；`check-receipt-policy` 4 条 + 夹具加 `corruptTrace` 形参；`contract-reference-closure` 5 条 + `withProject` 支持 `null`（不写 contracts.yaml）；`context-facts` 五条守卫（并入既有文案 case）；`verifier-production-routing` 1 条。**未新建 suite**。

**全量回归**：`npm --prefix harness run test:unit`（309 个套件、3880 条）**3880 passed / 0 failed**——本批改动面覆盖 harness-runner / check-plan / check-receipt / check-ut / check-testing，只跑 §7 的 8 个过滤串不足以排除旁路回归，故另跑一次全量。

### 2026-09-06：codex review 第 1 轮返修（未提交、未跑宿主）

两条全部采纳并落地。行号为返修后实际位置。

#### ① [high] 沿用判据改按「既有材料身份」，不再用 HEAD / worktree_digest

**问题成立（已逐行核实）**：`canonicalRequestInput`（[verifier-request.ts](../../harness/scripts/utils/verifier-request.ts):67–79）只把 `feature`/`phase`/`prompt_path`/`material_sha256`/`gate_fingerprint` 入 subject——`source_commit_sha` / `worktree_digest` **早已退出 subject 派生**，用它们的漂移证明"材料换代"不成立；而 `worktree_digest` 又把 `framework.config.json` 算在内（[worktree-digest.ts](../../harness/scripts/utils/worktree-digest.ts):32–39 `ROOT_CONFIG_PATHSPECS`）。合起来：strict 轮脚本 PASS + verifier FAIL 之后，**只把 `evidence_profile` 改成 balanced** 就让摘要漂移 → writer 丢弃 subject → 否决与候选一并落空、check-receipt 放行。这是**少否决**，超出已接受偏差。

| 落点 | 改法 |
|---|---|
| [harness-runner.ts](../../harness/harness-runner.ts):2121–2178 `resolveCarriedVerifierSubject` | 形参由 `identity{gateFingerprint,sourceCommitSha,worktreeDigest}` 收敛为单个 `gateFingerprint`。判据改为：读上一轮 summary 的 subject → `readVerifierMaterialOrNull(dir, subject)` 取**签发时落盘的材料视图** → 与本轮 `buildVerifierMaterialView`（policy 无关调用：`phaseRuleText:''`、`templateText:''`、`contextFiles:[]`，只吃 manifest 文件 + gate + `report.checks`）逐面比较。材料视图缺席（更早世代的凭证）→ 不沿用 |
| harness-runner.ts:2180–2185 新增 `carriedMaterialStillCurrent` | 比较面三项：`gate_fingerprint`、`script_checks` 投影、**本轮材料面里的每个文件**在签发时视图中同路径同哈希（签发时多出来的 contextFiles 条目不参与——disabled 下算不出来） |
| harness-runner.ts:1900 调用点 | 同步收敛为 `(…, opts?.verifierPlan?.mode, gateFingerprint ?? null)` |
| harness-runner.ts:37–41 import | 加 `readVerifierMaterialOrNull`（复用生产同一材料视图模块，不新建第二套指纹） |
| [check-receipt.ts](../../harness/scripts/check-receipt.ts):685–688 注释 | "三锚全等前提"改为"签发时材料视图 vs 本轮重算的 policy 无关材料面"（该分支代码零改动） |

已按 codex 要求优先复用 `buildVerifierMaterialView`（只传文件与 gate 的 policy 无关调用），未另写一套文件哈希。放弃的准确性已回写 D1「本条放弃的准确性」④⑤：模板/phase 规则/contextFiles 三面排除在比较外（多否决方向），无材料视图的旧凭证不沿用。

**真实回归（`check-receipt-policy`，全部经真实 policy → 真实 `resolveVerifierPlan` → 真实 `writeRunSummaryBase` → 真 spawn check-receipt）**：

- `V8（B05 S0b，codex 一轮 high 返修）：strict 轮有效 FAIL 后仅改 evidence_profile=balanced —— writer 仍沿用 subject，check-receipt 仍否决`：strict 轮真实 writer 签发 subject 并落盘 `verifier.material.<subject>.json` → 同 subject 发 `verdict: FAIL` 报告 → **唯一变量**改 `framework.config.json` 的 `evidence_profile` → balanced 轮 writer 仍沿用（`verifier_subject_id` 相等、无 `verifier_request`、`next_action==='fix_verifier_findings_then_rerun_harness'`）→ check-receipt 退出码非 0 且含 `verifier_not_pass`。用例内另钉一条构造性断言：改档位后 `computeProductWorktreeDigest` 必与 strict 轮 summary 的 `worktree_digest` **不等**（旧判据必失配的机制证据）。
- `V8 材料真变对照（B05 S0b）：改 phase 产物文件后 → 旧 FAIL 不再沿用，writer 零 verifier 字段`：同上但在 balanced 轮前写出 `review-report.md`（`resolvePhaseEvidenceManifest` 的 phase 产物，哈希 null → 实值）→ 不沿用、`next_action==='fill_receipt_then_sync_closure'`。
- 既有 `V8 对照（无报告）` 逐字保留。

**反证**（临时把沿用判据改回三锚，日志 `fix1-crp-counterproof.log` / `fix1-crp-counterproof2.log`）：`V8 … 返修` FAIL，报文 `writer 必须沿用 strict 轮那个 subject（改档位不构成材料换代）；实得 undefined`——即 codex 描述的丢弃。返修后 16/16 绿。

#### ② [medium] 真 n/a 的 BLOCKER SKIP 排除出 writer 的 `blocking_skips`

**问题成立**：SKIP+BLOCKER 的既有语义是"门禁没跑完"，真 n/a 进 `blocking_skips` 后，[harness-runner.ts](../../harness/harness-runner.ts):2523 的 `effectiveVerdict==='PASS' && blockingSkips.length>0` 提前返回 `review_blocking_skips_then_verifier`，绕过 disabled 与 verifier FAIL 两条分支。

| 落点 | 改法 |
|---|---|
| [types.ts](../../harness/scripts/utils/types.ts):565–578 | 新增 `CHECK_NOT_APPLICABLE_MARKER` 与 `isCheckNotApplicable(check)`（读 `CheckResult.structured.applicability`，形状不符一律 false）——写读两端共用一处，不新增 check id、不新增字段 |
| [check-plan.ts](../../harness/scripts/check-plan.ts):526 返回类型 + :562–572 SKIP 出口 | 真 n/a 的返回值加 `structured: { applicability: CHECK_NOT_APPLICABLE_MARKER }`。**status/severity 一字不改**——展示面（report-generator.ts:641）、blocker 聚合（summary-blockers.ts:40）、质量轴计数口径全部不动 |
| harness-runner.ts:1775–1780 `blockingSkips` | 过滤条件加 `&& !isCheckNotApplicable(c)` |

**测试**：

- `contract-reference-closure` 的 V4 正例（真实 `SpecLoader` + 真实三个 check）追加断言：三条真 n/a 的 SKIP 必须带 `structured.applicability='not_applicable'`。32/32 绿。
- `check-receipt-policy` 新增两条 writer 动作断言，n/a check 由**真实 `checkDataModelTyped`** 产出（不手搓 `structured`）：
  - `B05 D2（codex 一轮 medium 返修）：真 n/a 的 BLOCKER SKIP 不进 blocking_skips —— goal×balanced 下不指向未签发的 verifier`：其余全 PASS → `next_action==='fill_receipt_then_sync_closure'`、`blocking_skips` 为空；
  - `B05 D2（codex 一轮 medium 返修）：真 n/a SKIP + 已有 verifier FAIL → next_action 仍是 fix_verifier_findings_then_rerun_harness`：两轮同一份 ScriptReport（`script_checks` 是材料面的一部分），沿用 subject 且给出修缺陷指令。

**反证**（临时去掉过滤，同上日志）：两条均 FAIL，第一条报文 `disabled 下不得把调用方指向本轮未签发的 verifier（其余全 PASS 时走闭环指令），实得 review_blocking_skips_then_verifier`；第二条报文列出 `blocking_skips` 里那条 `data_model_typed`。

#### ③ 规格与迁移说明同步（两条返修的连带面）

沿用判据写在三处对外文本里，全部改准（原文与 MIGRATION.md:202「subject 派生不含 `source_commit_sha` / `worktree_digest`」自相矛盾）：[MIGRATION.md](../../MIGRATION.md):616（改为"材料身份未变"，并写明改档位不构成材料换代、模板/源码两面排除）、[proposal.md](../../openspec/changes/phase-contracts-and-applicability/proposal.md):21、[tasks.md](../../openspec/changes/phase-contracts-and-applicability/tasks.md):11。另加 tasks 4.4（n/a 标注 + `blocking_skips` 排除）与 [harness-gates delta](../../openspec/changes/phase-contracts-and-applicability/specs/harness-gates/spec.md) 的一条 requirement 段落 + 第四条 scenario（真 n/a 的 SKIP 不阻断、`next_action` 不指向未签发的 verifier）。`runtime-policy` delta 的两条 scenario 只描述"仍否决"，与判据无关，**不改**。`npm run openspec:validate` 35/35 绿（日志 `fix1-openspec.log`）。

#### 返修验证

`npm --prefix harness run typecheck` 绿（日志 `fix1-typecheck-3.log`）。目标套件全绿：`check-receipt-policy` 16/16、`verifier-production-routing` 12/12、`verifier-plan` 8/8、`contract-reference-closure` 32/32、`runtime-policy` 21/21、`verifier-material` 3/3、`verifier-evidence` 11/11。旁路面另跑（按"谁读 `blocking_skips` / `verifier_subject_id` / `structured`"grep 选的套件）：`blocked-capability-projection` 22/22、`e2e-spec-requirement-closure` 7/7、`phase-closure-finalizer` 20/20、`receipt-slim` 28/28、`repair-candidates` 33/33、`summary-schema` 7/7。§7 的两条护栏串同样绿：`blocker-suggestion-ratchet` 3/3、`goal-runtime-structural-acceptance` 13/13。**注意**：`--filter check-plan` 实测命中 **0 个套件**（`select-suites.ts` 按 `suite.id.includes(filter)` 选，`run-unit.ts` 里没有任何 id 含 `check-plan`；控制台那一大段输出是 runner 自身的 profile 自动发现在跑 goal 链，不是用例）。check-plan 的改动面由 `contract-reference-closure`（32/32，驱动三个**真实**导出函数）+ 上述两条源码扫描护栏覆盖，无缺口——**不要**把这个过滤串写进任何完成判据。`candidate:build` **未跑**（调度者另有一次在跑）。

### 2026-09-06：codex review 第 2 轮返修（未提交、未跑宿主）

两条全部采纳并落地。行号为返修后实际位置。

#### ① [medium] 沿用判据的文件面改**双向**核对（漏掉可选输入被删）

**问题成立（已逐行核实）**：`resolvePhaseEvidenceManifest`（[phase-evidence-manifest.ts](../../harness/scripts/utils/phase-evidence-manifest.ts):360–362 / :366–369 / :411–414）的**可选**条目一律"存在才纳入"——文件被删后整条从 manifest 消失。`carriedMaterialStillCurrent` 原来只遍历 `current.files`，本轮 manifest 里没有的路径永远看不到，于是"strict 签发后删掉 review 的可选输入 `spec.md`（`OPTIONAL_FEATURE_FILES_BY_PHASE.review`），其余材料与脚本投影不变，再切 balanced"实得 still-current → 沿用旧 FAIL。（REQUIRED 条目无此洞：缺席时仍进 manifest，`sha256: null` 与旧哈希失配。）

| 落点 | 改法 |
|---|---|
| [phase-evidence-manifest.ts](../../harness/scripts/utils/phase-evidence-manifest.ts):470–504 新增 `phaseEvidenceManifestCandidatePaths`（已 `export`） | 该 phase 的 manifest 面**候选**路径全集（不看存在性，含 `artifactReadCandidatePaths` 的 legacy 读回退路径）。表沿用本模块与 spec-loader 的既有 SSOT（REQUIRED/OPTIONAL 输入 + 产出 overlay 三表），**不另立手写表**。reports/ 下的运行期产出**不进**集合——`buildVerifierMaterialView` 本就把它们排除出 manifest 面，那里出现的 trace/visual-diff 是 contextFiles 送进去的、属排除面（进集合会把 context 面误当 manifest 面比较，反向变成少否决） |
| [harness-runner.ts](../../harness/harness-runner.ts):2180–2210 `carriedMaterialStillCurrent` | 新增 `manifestFace` 形参。文件面双向：本轮每个文件在旧视图同路径同哈希（原有正向）**＋** 旧视图里属于 manifest 面的文件本轮必须仍在且同哈希（新增反向）。context-only 条目（contextFiles 的源码/用例/图片）继续排除 |
| harness-runner.ts:2158–2163 调用点 / :42 import | 传入 `phaseEvidenceManifestCandidatePaths({projectRoot, feature, phase})`；新增该 import |

`gate_fingerprint` / `script_checks` 两面与"改档位不构成材料换代"的既有语义**零变化**（V8 与 V8 材料真变对照两条原样绿）。

**新增用例**（`check-receipt-policy`，真实 writer：strict 轮真实签发 + 落材料视图 → 同 subject 发 FAIL → 改档位 → 删可选输入 → `writeRunSummaryBase`）：`V8 可选输入被删（B05 S0b，codex 二轮 medium 返修）：strict 签发后删除可选 manifest 输入 → 切 balanced 不沿用`。断言三条：不写 `verifier_subject_id` / 不写 `verifier_report` / `next_action==='fill_receipt_then_sync_closure'`。用例内先用既有 `phaseOutputRelPath` 钉住"`spec.md` 在场时确实进材料面"的构造性前提。

**反证**（临时删掉反向那段循环、改回单向，日志 `fix2-crp-counterproof.log:45`）：该用例 FAIL，报文 `可选 manifest 输入被删=材料换代，不得沿用旧 subject；实得 "4c68be0c2269…"`——即 codex 描述的错误沿用。恢复后 17/17 绿。

#### ② [low] proposal「放弃的准确性」③ 与第 21 行/MIGRATION 的判据对齐

[proposal.md](../../openspec/changes/phase-contracts-and-applicability/proposal.md):37 第③项原写"five subject inputs 中的三个锚"并称 phase 输入变化仍沿用 FAIL——与第 21 行（材料身份三面）及 MIGRATION.md:616 冲突，是一轮返修的漏改。改为：比较面＝manifest 文件哈希（**双向**，可选输入被删算变更）+ `gate_fingerprint` + `script_checks` 投影；排除项＝prompt 模板 / phase 规则文本 / `contextFiles`（源码、用例、图片），排除面变化仍沿用旧 FAIL（多否决方向），解除需跑一轮 strict 让 verifier 自己撤回。

#### 返修验证（日志目录同上，`fix2-` 前缀）

`npm --prefix harness run typecheck` 绿（`fix2-typecheck.log`）。`check-receipt-policy` **17/17**（`fix2-crp.log:32`）、`verifier-material` 3/3（`fix2-verifier-material.log`）、`verifier-production-routing` 12/12（`fix2-vpr.log`）、`phase-evidence-manifest` 14/14（`fix2-pem.log`，本轮新增导出所在模块的旁路面）。`npm run openspec:validate` 35/35 绿（`fix2-openspec.log`）。`candidate:build` **未跑**；未 commit；宿主未跑。

### 2026-09-06：codex review 第 3 轮返修（未提交、未跑宿主）

唯一一条 medium，采纳并落地。行号为返修后实际位置。

#### ① [medium] 候选集与材料视图共用**同一条** reports 排除谓词

**问题成立（已逐行核实并实测复现）**：二轮新增的 `phaseEvidenceManifestCandidatePaths` 直接铺开 REQUIRED/OPTIONAL/产出三表，没有套 `buildVerifierMaterialView` 的 reports/receipt 排除规则。配置 `reports_dir_pattern: "doc/features/<feature>/<phase>"`（reports 目录=phase 目录）时，`review-report.md` 落在 reports 面内：构建器把它当运行期产出**排除**出 manifest 面，它只能经 `contextFiles`（`collectContextFiles` 的 review 分支）进签发时视图；而候选集仍把它算作 manifest 面 → 二轮的**反向**比较在本轮视图里永远找不到它 → 材料一字未变、仅切 balanced 也判 not-current → writer 丢弃 subject → strict 轮的 FAIL 否决落空（**少否决**，与一轮 high 同向）。

| 落点 | 改法 |
|---|---|
| [phase-evidence-manifest.ts](../../harness/scripts/utils/phase-evidence-manifest.ts):528 新增 `createRuntimeArtifactPredicate`（已 `export`） | 排除谓词的**唯一来源**：`reportsRel = featurePhaseReportsDir(...)` 相对路径，命中 `rel === reportsRel` / `rel.startsWith(reportsRel + '/')` / basename 为 `phase-completion-receipt.md`。规则整段从 verifier-material 迁入，**不复制第二份** |
| [verifier-material.ts](../../harness/scripts/utils/verifier-material.ts):22 / :105 | `buildVerifierMaterialView` 改调该谓词（原地内联的 `isRuntimeArtifact` 与本地 `reportsRel` 删除，连带删掉 `featurePhaseReportsDir` 的 import）。行为逐字不变 |
| phase-evidence-manifest.ts:482–508 `phaseEvidenceManifestCandidatePaths` | 新增 `frameworkRoot?` 形参；三表与 `PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE` 的每条候选路径经 `add()` 过谓词，命中排除的不入集合 |
| [harness-runner.ts](../../harness/harness-runner.ts):2158–2165 调用点 / :2188–2196 判据注释 | 候选集调用传 `frameworkRoot`（与同处 `buildVerifierMaterialView` 同参解析 reports 目录，否则自定义 pattern 下两边算出不同目录）；注释补记 reports 面内的产物同属排除面 |

**依赖方向**：谓词放在 `phase-evidence-manifest.ts`（verifier-material 已单向依赖它），避免 verifier-material ← → phase-evidence-manifest 环形 import。

**新增用例**（`check-receipt-policy`，真实 writer；夹具 `buildProject` 加 `reportsInPhaseDir` 选项，`reports_dir_pattern` 与 reportsDir 全部由一个 `reportsRelDir` 派生；`issueStrictSubject` 加可选 `contextFiles` 形参、reports 目录改走生产 `featurePhaseReportsDir`）：

- `V8 reports 落在 phase 目录（B05 S0b，codex 三轮 medium 返修）：材料未变仅切 balanced → 仍沿用 FAIL`：先钉两条构造性前提——`review-report.md` 经 contextFiles **在**签发时视图内、在 manifest 面（contextFiles 为空）**不在**；再 strict 真实签发 + 同 subject 发 FAIL → 唯一变量切 balanced → 断言 `verifier_subject_id` 相等、`verifier_report` 在场、`next_action==='fix_verifier_findings_then_rerun_harness'`。
- `V8 reports 内文件变化（B05 S0b，codex 三轮 medium 返修）：reports 面内产物改动 → 仍沿用 FAIL`：对照条，切档后再改 `review-report.md` 与 `trace.json` 字节，仍须沿用。与既有「V8 材料真变对照」互为镜像——同一个 `review-report.md`，缺省布局下算 manifest 面（改了不沿用），pattern 覆盖到 phase 目录时算排除面（改了仍沿用）。

**反证**（临时把候选集的 `add()` 改回无条件 `out.add(rel)`，日志 `fix3-crp-counterproof.log:45/47`）：两条新用例双双 FAIL，报文 `材料未变必须沿用 strict 轮 subject（reports 面的条目不算 manifest 面）；实得 undefined` 与 `reports 面内的改动不构成材料换代，须继续沿用；实得 undefined`——即 codex 描述的 subject 丢弃。恢复后 19/19 绿。

#### 返修验证（日志目录同上，`fix3-` 前缀）

`npm --prefix harness run typecheck` 绿（`fix3-typecheck-final.log`）。`check-receipt-policy` **19/19**（`fix3-crp-final.log:32`，17→19）、`verifier-material` 3/3（`fix3-verifier-material.log`）、`phase-evidence-manifest` 14/14（`fix3-phase-evidence-manifest.log`）、`verifier-production-routing` 12/12（`fix3-verifier-production-routing.log`）。四文件 LF 经 node 扫过。规格/文档面**零改动**——本条只统一两处实现的口径，判据语义（manifest 文件双向 + gate + `script_checks`；模板/phase 规则/contextFiles 排除）与 MIGRATION.md:616、proposal.md:21/37 的表述一致。`candidate:build` **未跑**；未 commit；宿主未跑。

### 未做 / 待办

- `npm run candidate:build` **未跑**（调度者在 review 后统一跑）。
- 宿主实测未做，`b05-host-acceptance` 保持 pending，并入 B06 的 C-U 回归。
- 未 commit。

### 2026-09-06：codex review 三轮 + 调度者把关、候选件产出、本地验收完成（调度记录）

- plan review：第 1 轮 2 high + 6 medium + 2 low 全采纳；第 2 轮 8 resolved + 2 partial + 1 medium + 1 low 并入实施派发。
- 实施 review：第 1 轮 1 high + 1 medium（配置切换即丢 FAIL、真 n/a 进 blocking_skips）；第 2 轮 1 medium + 1 low（单向比较漏可选输入删除、proposal 文案）；第 3 轮 1 medium（候选路径集未复用 reports 排除）。三轮熔断后剩余 medium 由 Opus 修、**调度者自行核对**（谓词共享来源 createRuntimeArtifactPredicate、两处消费、目标套件 19/3/14、反证日志）后放行，未起第四轮 codex。
- 最终 `candidate:build`（scratchpad b05/candidate-build-4.log）见下一条记录；提交分四笔（策略与 off≠忽略 / plan n/a 出口 / UT 数量口径与文案 / plan 与 OpenSpec），不带署名。
- `b05-local-acceptance` 置 completed（本地完成 = 本批完成）；`b05-host-acceptance` 保持 pending，并入 B06。
- 最终 `candidate:build`（b05/candidate-build-4.log）：typecheck 通过、unit 全过、fixtures 46/46、consumer smoke 全段通过，`[candidate] BUILT`，zip sha256 `4c95abad37c7d8e5fddee27b358cee4522017d8a31a4a4994b3106c4f60b3436`。
