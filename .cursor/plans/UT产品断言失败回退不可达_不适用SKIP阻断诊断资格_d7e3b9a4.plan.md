---
name: UT 产品断言失败回退不可达（不适用 SKIP 阻断诊断资格）
version: 3.1.0
overview: >
  UT 产品断言失败 → coding 的唯一候选 ut_product_assertion_failure 依赖诊断 verifier，而诊断资格
  canProduceVerifierRequest 把任何 BLOCKER SKIP 当"门禁没跑完"拒绝。宿主 UT 报告恒带 3 项"已确认不适用"
  的 BLOCKER SKIP，于是 UT→coding 回退结构性不可达，只会同签名 no_progress_guard 停机。修法只复用既有缝
  CHECK_NOT_APPLICABLE_MARKER / isCheckNotApplicable（plan 7b3e9a15 B05 D2）：资格判定认标注，check-ut 与
  hmos-app coding-host-rules 只给"已确认不适用"的 SKIP 出口打标；status/severity/details 一字不改。不写代码，待 review。
todos:
  - id: nas-fix
    content: 笔一——按 §2 落改法 A（verifier-plan 资格认标注）+ 改法 B（check-ut 19 处、coding-host-rules 2 处打标）+ §2.6 诊断 prompt 说明同步 + §2.5 openspec change；按 §5 ①②⑤ 补单测；迭代跑目标套件，收口跑一次全量，结果记 §8。
    status: completed
  - id: nas-real-chain
    content: 笔二——按 §5 ③ 在笔一之上重做 RC-9b（UT→coding）：核对夹具剩余未打标 BLOCKER SKIP、只在 RC-9b 场景补 DAG 材料；跑通则登记（release-only，耗时以实测为准）并做反向变异，跑不通如实记未覆盖；结果记 §8。
    status: completed
---

# UT 产品断言失败回退不可达（不适用 SKIP 阻断诊断资格）

> 需求输入：调度者 2026-09-24 派发；缺口由 [f3b8d261](coding越界集合承接UT产出_真实链路回灌_f3b8d261.plan.md) §8.3 RC-9b 实验定位。
> 代码基线：main 815cd996（工作树另有他人在制品：real-chain-seams / real-chain-host / run-unit 与两份 plan，本 plan 不碰）。
> 三档（[e7a2c4f1](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §1.1）：这是**第二档形状项挡住第一档产品真值路径**——
> "不适用"被读成"没跑成"，挡掉的是产品断言失败的责任回退。修的是判读，不放宽任何真"没跑成"的保护。

## 1. 缺陷与证据

| # | 位置 | 事实 |
|---|---|---|
| 1 | `repair-candidates.ts:600-631` | `ut_product_assertion_failure` 三条合取之③要求 `verifierReportText` 里 `end_to_end_driving`/`business_assertion_value` 均 PASS → 必须先有诊断 verifier |
| 2 | `verifier-plan.ts:256-343` | 诊断资格唯一判定 `canProduceVerifierRequest`；`harness-runner.ts:1727-1748` `resolveVerifierRequestEligibility` 是唯一装配点（Step 4 `:1355` 与 writer `:2129` 共用）。`:273-279` 对**任何** BLOCKER SKIP 直接 NOT_ALLOWED；`VerifierEligibilityCheck`（`:184-191`）无 `structured`、不调谓词 |
| 3 | 宿主 run f829b8 `phases/ut/harness/script-report.json`（只读） | verdict PASS、62 checks，恒带 3 项 BLOCKER SKIP 且全是已确认不适用：`ut_unsupported_targets_handled`「无 L3 记录」（`check-ut.ts:3587-3595`）、`ut_hypium_mockkit_policy`「未导入 MockKit/when」（`:3770-3778`）、`origin_tag_required`「无 characterization DAG」（`:2634-2642`）。同 run coding 另有 2 项：`module_config_registered`「无新增模块需要注册」、`page_registration`「无 NavDestination 页面」（均在 `profiles/hmos-app/harness/coding-host-rules.ts:316-320 / :514-522`，**不在** check-coding.ts）；review/testing 为 0 |
| 4 | 推论 | 宿主 UT 一旦 `ut_hvigor_test` FAIL/code_regression：诊断不签发 → 候选不产 → ut 二轮同签名 `no_progress_guard` 停机。RC-9b 在夹具上已复现（f3b8d261 §8.3：去掉 20 项 BLOCKER SKIP 即 `allowed:true, kind:repair_diagnosis`） |
| 5 | 既有缝 | `types.ts:613-626` `CHECK_NOT_APPLICABLE_MARKER` + `isCheckNotApplicable`。生产打标三处：`check-plan.ts:575`（经 `resolveSectionApplicability` 三处出口）；`check-ut.ts:3661`（presence 不需要 test double，仅 `resolvedInputs` 分支，severity=MINOR）；`check-ut.ts:4298-4313` `checkUtMockPlanRequirements` 整组处理——现代调用、audit 已加载、mock-plan 非 invalid 且 presence 判不适用时，组内（parseable/present/typed/contracts_consistent）SKIP 统一改 MINOR 并打标，生产入口 `:4489` 调用。唯一消费 `harness-runner.ts:2024-2025` `blockingSkips` |
| 6 | 规格 | `openspec/specs/harness-gates/spec.md:2379`（review 形态"no BLOCKER SKIP"）、`:2380`（ut 形态"no other BLOCKER FAIL or SKIP"）、`:2397`（负例场景）。其余 verifier 资格相关条目（`:1985` 能力解析、`:2410` 诊断 next_action）不涉 SKIP，不动 |

`canProduceVerifierRequest` 只有 review 与 ut 两个诊断分支，coding 无诊断分支——coding 两处打标**不服务**本缺口，只修 §2.4 的 next_action（B05 同类），见 §2.3。

## 2. 设计

### 2.1 改法 A：资格判定认标注（`harness/scripts/utils/verifier-plan.ts`）
- `VerifierEligibilityCheck` 加可选 `structured?: unknown`（`CheckResult` 结构兼容，调用方零改动）。
- `:274` `blockerSkips` 过滤加 `&& !isCheckNotApplicable(c)`；谓词从 `./types` 值导入（types.ts 只有 type-only 导入，无环）；`:183` 注释改为"只取形状与一个纯谓词"。
- review / ut 两分支一并生效（review 宿主 0 项，行为不变）；`:245-253` 表格注释"无 BLOCKER SKIP"改"无未标注不适用的 BLOCKER SKIP"。

### 2.2 改法 B：check-ut 出口打标（`harness/scripts/check-ut.ts`，60 处 `status: 'SKIP'`）
**打标判据**：出口所在分支已**确认本判据的对象不存在**（配置未声明 / 模式裁定 / 已加载输入里没有该对象 / 可选输入经能力声明合法缺席）→ 打标。工件缺失或无效、由他门先行阻断、执行没跑成 → 不打标。MAJOR/MINOR 出口不打标（两个消费点都只看 BLOCKER，打了无消费）。
**兜底论证**：打标只断言"本判据不适用"；输入缺席由**同一报告里未打标的缺席出口**或 presence FAIL / blocked capability 继续挡。例：acceptance 缺席时 2890/3517 虽打标，同报告 2946/3037 未打标照挡；无 DAG 时 2640 打标，dag_* 九处未打标照挡。
**写法**：沿 check-plan 口径，出口对象内加 `structured: { applicability: CHECK_NOT_APPLICABLE_MARKER }`，status/severity/details 一字不改。

| 类 | 行号 : check id | 出口语义 | 打标 |
|---|---|---|---|
| N1 | 1987 ut_import_whitelist | 合并后 phase-rules 未声明该规则 | 是 |
| N2 | 2430 acceptance_coverage · 2722 branch_coverage_full · 3119 ut_case_per_unit_ac | 全部 flow_type=characterization（`dagsAllCharacterization` 空集为 false，不会误中） | 是 |
| N3 | 2640 origin_tag_required | 无 characterization DAG（**宿主**） | 是 |
| N4 | 3593 ut_unsupported_targets_handled | audit 已加载且无 L3 记录（**宿主**） | 是 |
| N5 | 3659 ut_mock_plan_present | 无需 test double 的记录；现代路径已由 3661 + `:4308-4312` 整组处理打标，**本 plan 不改**；legacy 路径不扩（单打 presence 解不了阻断，同组 3404/3897/3938 仍留 BLOCKER SKIP；整组扩到 legacy 属扩 scope，见 §7） | 已有 |
| N6 | 3776 ut_hypium_mockkit_policy | 责任域 UT 未导入 MockKit/when（**宿主**）；UT 文件缺席由 770 等未打标出口挡 | 是 |
| N7 | 2890 ut_coverage_evidence_present · 3517 ut_testability_audit_present · 2957 ut_coverage_evidence_mappings_complete · 3048 ut_coverage_evidence_resolves · 3141 ut_case_per_unit_ac | 无 unit/both（P0/P1）范围 | 是 |
| N8 | 1519 usecase_spec_schema · 1611 named_business_handler · 1646 usecase_ui_bindings_nonempty · 1757 dag_linked_usecase · 2062 boundaries_all_stubbed · 2733 branch_coverage_full | use-cases.yaml 缺席：`skills/feature/business-ut/contract.yaml:9,16` 声明 use_cases=enhancement / `on_missing: prune`；legacy 下 `usecase_spec_recommended` 仅 MINOR。存在但无效走 shape_issues / blocked capability | 是 |
| N9 | 4376 modeSkip（featureGate 覆盖的全部 id） | 工作模式 repair_existing_ut / cover_existing_code 裁定需求工件门禁不适用 | 是 |
| M1 | 409 dag_files_parseable · 490 dag_schema_compliance · 565 dag_node_type_valid · 637 dag_acyclic · 718 dag_source_file_exists · 1393 mock_stub_for_async · 1767 dag_linked_usecase · 2452 acceptance_coverage · 2540 dag_to_source · 4003 dag_spy_preset_resolvable | 工件缺失：DAG 是 UT 自产（contract `ut_source_and_dag`） | 否 |
| M2 | 770 ut_assertion_exists · 2011 ut_import_whitelist · 2072 boundaries_all_stubbed · 2150 it_name_has_ac_or_branch_tag · 2743 branch_coverage_full | 工件缺失：无 UT 文件 | 否 |
| M3 | 2441 acceptance_coverage · 2946 ut_coverage_evidence_mappings_complete · 3037 ut_coverage_evidence_resolves · 3130 ut_case_per_unit_ac | 工件缺失/无效：无 acceptance.yaml 或无 criteria | 否 |
| M4 | 3458 skipBecauseArtifactInvalid（多 id） · 3948 ut_mock_plan_contracts_consistent（mock-plan 有条目而 contracts 无 interfaces） | 工件无效 | 否 |
| M5 | 4570 / 4578 ut_hvigor_test · ut_run | 执行没跑成（ut.compile profile SKIP） | 否 |
| U1 | 3404 ut_*_parseable（缺席，"由 presence gate 决定"）· 3580 ut_unsupported_targets_handled（audit 缺席）· 2967 mappings_complete（coverage-evidence 非 loaded）· 3897 ut_mock_plan_typed · 3938 ut_mock_plan_contracts_consistent（无 mock-plan 或 spies 空） | 上游/他门已阻断或裁决（mock-plan 组 3404/3897/3938 在现代路径 presence 判不适用时已被 `:4308-4312` 降 MINOR 打标，出口本身不改） | 否 |
| — | 1485(MINOR) · 1694 · 1705 · 1853 · 1917 · 2210 · 2288 · 2362 · 2373 · 2683 · 3225 · 3239（MAJOR） | 非 BLOCKER，无消费点 | 否 |

合计 60 = **已确认不适用 20 处（N1–N9；本 plan 新打标 19 处，N5 已有处理不改）** + 工件缺失/无效/没跑成 23 处（M1–M5）+ 上游已阻断 5 处（U1）+ 非 BLOCKER 12 处。宿主 3 项全落新打标的 N 类。
（行号为 815cd996 的 `status: 'SKIP'` 所在行。）

### 2.3 coding 两处（`profiles/hmos-app/harness/coding-host-rules.ts`，宿主实证）
`:316` module_config_registered（`missing=0 ∧ newModules=0` 才 SKIP）、`:521` page_registration（无 `nav_destination`，spec `:1946` 明文 MAY SKIP）同写法打标（常量从 `harness/scripts/utils/types` 导入；该文件 `:5` 现为同路径 type-only import，补一个值导入）。
只影响 coding PASS 报告的 `blocking_skips`/next_action，与 UT→coding 无关；B05 同类既有不一致，按"既有不一致完整修正"纳入，**两行，可整体剔除而不影响本缺口**。spec/plan/review/testing 其余 checker 不扫：宿主实证 0 项、且无诊断分支消费；后续触发条件=宿主某阶段 PASS 报告再现"已确认不适用"的 BLOCKER SKIP 并使 next_action 落 `review_blocking_skips_then_verifier`，或新增诊断分支。

### 2.4 连带行为变化（写明，属修正）
- `harness-runner.ts:2024` `blocking_skips` 随打标缩小：宿主 UT / coding PASS 报告 `blocking_skips` 变空，next_action 从 `review_blocking_skips_then_verifier` 变为正常闭环指令（B05 D2 同理由）。
- 诊断资格：UT 报告仅含已标注 SKIP + `ut_hvigor_test` FAIL/code_regression + 编译 PASS → `repair_diagnosis`；review 同理（宿主无实例）。
- 诊断 prompt 说明文案随之改写（§2.6），内嵌报告投影不变。
- 不变：status/severity/details、verdict、blocker 计数、质量轴、展示面；未打标的 SKIP 照旧阻断资格与 blocking_skips；标注**不改变 BLOCKER FAIL 的既有资格判定**——既有的可诊断产品失败例外（ut：`ut_hvigor_test` FAIL/code_regression 且编译 PASS；review：负面裁决两 id）保留，其余 BLOCKER FAIL 不因标注获得豁免。

### 2.5 规格（openspec change `ut-diagnosis-not-applicable-skips`）
proposal.md + tasks.md + `specs/harness-gates/spec.md` delta：MODIFIED「A diagnosable product failure still issues a verifier request」（全文复制后改）——
review / ut 两形态的"BLOCKER SKIP"改为"BLOCKER SKIP not carrying the confirmed not-applicable marker"，并明写"the marker exempts only a `SKIP`; it does not change how a BLOCKER `FAIL` is judged — the existing diagnosable product-failure exceptions stay as they are, and no other BLOCKER `FAIL` becomes eligible because of the marker"（ut 形态拆成"no other BLOCKER FAIL, and no BLOCKER SKIP other than a marked one"）；诊断 prompt 说明须与此一致（§2.6）；补一句"UT and hmos-app coding host checkers mark only exits that have confirmed the judged object is absent; missing/invalid artifacts, upstream-blocked and not-executed exits stay unmarked"；Enforcement 增 `harness/scripts/check-ut.ts`、`profiles/hmos-app/harness/coding-host-rules.ts`；:2397 场景同改；新增两场景（标注 SKIP + code_regression → 签发；未标注同形 → 不签发）。`npm run openspec:validate` 须过。归档随发布流程，不在本 plan。

### 2.6 诊断 prompt 说明同步（codex 一轮 P2）
改法 A 放行后，`report-generator.ts:283` `projectScriptReportForPrompt` 原样保留非 PASS 检查（含已标注 SKIP），`:409` 把诊断正文接进 prompt，而 `:309` 仍写"除它们之外本轮**没有**其它 BLOCKER 级 FAIL/SKIP"——与内嵌报告矛盾。
- `:309` 改为"除它们之外本轮没有其它 BLOCKER 级 FAIL，也没有未标注为已确认不适用的 BLOCKER SKIP（报告里带 `structured.applicability=not_applicable` 的 SKIP 是判据不适用，不是没跑完）"；`:295` 函数注释同改。
- `harness/prompts/verify-ut.md:41` 诊断例外句"且没有其它 BLOCKER FAIL/SKIP"改为"且没有其它 BLOCKER FAIL，也没有未标注为已确认不适用的 BLOCKER SKIP"（与 `:309` 共用同一短语，同一事实的另一承载处；§5 ⑤ 断言两处都不含旧句 `FAIL/SKIP`、都含新短语）。`agents/{claude,codex}/templates/agents/verifier.*` 只写"没有其它 BLOCKER 阻塞"，仍成立，不改。
- 只改文案，不加协议、字段或门禁。

## 3. 保留 / 裁剪双清单
**保留**：资格判定顺序与其余条件（planMode、blocked capability、编译 PASS、归因逐条 code_regression、report_validity）；SKIP 的 status/severity/details；B05 既有打标与消费；所有未打标出口的阻断语义。
**裁剪**：`VerifierEligibilityCheck` 注释中"不依赖 types.ts"的限制（改为允许一个纯谓词）；诊断说明 `report-generator.ts:309` / `verify-ut.md:41` 的"无 BLOCKER SKIP"断言（原位改写）。`check-ut.ts:3661`、`:4308-4312` 的既有整组处理原样保留。新增接线唯一：`isCheckNotApplicable` 进 `canProduceVerifierRequest`，复用目标 = `harness-runner.ts:2025` 同一谓词。

## 4. 否决方案
- (a) 直接放宽为"BLOCKER SKIP 不阻断诊断"：丢掉真"没跑成"（DAG/UT 文件/工件无效/执行未跑）的保护，诊断会在半份材料上签发。
- (b) 新增 `skip_kind` 字段或新 check id：与 `structured.applicability` 平行的第二套"不适用"概念，两个消费点须各认一套。
- (c) 按 details 正则识别"跳过/不适用"：文案耦合，60 处文案任一改写即静默翻转；且"跳过"字样同时出现在没跑成/工件缺失出口（4004、4571）。

## 5. 验证
① `verifier-plan.unit.test.ts`：打标 n/a BLOCKER SKIP + 编译 PASS + `ut_hvigor_test` FAIL/code_regression → `allowed/repair_diagnosis`；同形未打标 → 仍 NOT_ALLOWED（既有 `:300` review 负例保持）；review 打标 SKIP + 负面裁决 → 放行。
② check-ut 单测（新增于既有 UT 套件，如 `ut-contract-caliber.unit.test.ts`）：用**真实 checker 函数**产出宿主三条并断言 `isCheckNotApplicable` 为真——`checkUtUnsupportedTargetsHandled`、`checkOriginTagRequired` 当前未导出，沿 `check-plan.ts:579` 先例加 `export`（仅供单测走真实函数）；`checkUtHypiumMockkitPolicy`、`checkUseCaseSpecSchema` 已导出。反向：`checkUtUnsupportedTargetsHandled` audit 缺席（3580）、`checkDagFilesParseable` 无 DAG（409）→ 断言**未**打标。再用 `coding-host-rules` 真实函数断言两处打标。
③ real-chain（笔二）：见 §6。
⑤ prompt 装配与模板：沿 `verifier-production-routing.unit.test.ts:1096-1107` 既有诊断说明断言补一条——带诊断说明的正文**不含**旧句"没有**其它 BLOCKER 级 FAIL/SKIP"、含新短语"也没有未标注为已确认不适用的 BLOCKER SKIP"；同一用例再读 `harness/prompts/verify-ut.md` 原文断言其不含旧句"且没有其它 BLOCKER FAIL/SKIP"、含同一新短语（两处承载一起锁）；常规请求正文一字不变的既有断言保持。
④ 迭代只跑 `--filter verifier-plan`、`--filter verifier-production-routing`、`--filter ut-`、`--filter contract-reference-closure`、`--filter coding-host`（按实际套件名）；笔一收口跑一次 `cd harness && npm test`（日志落文件再 grep）；`npm run typecheck`、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`、node 扫改动文件无 CR。

## 6. 分笔与依赖
**笔一**（nas-fix）：§2.1–2.6 + §5 ①②④⑤。生产改动 5 文件（verifier-plan.ts / check-ut.ts / coding-host-rules.ts / report-generator.ts / prompts/verify-ut.md；types.ts 不改）+ 测试（verifier-plan / check-ut 所在 UT 套件 / coding-host / verifier-production-routing）+ openspec change。
**笔二**（nas-real-chain）：**须等**工作树里 real-chain-seams / real-chain-host / run-unit 他人在制品落库后再动。
1. 复原 f3b8d261 §8.3 的 RC-9b 构造（UT 执行替身按源码判 FAIL/code_regression、coding 缺陷、ut 第 2 轮起的 verifier 报告），在笔一之上实跑，把落盘 `ut/reports/script-report.json` 剩余**未打标** BLOCKER SKIP 逐条列出。
2. 夹具 20 项预计：可打标 10 项（ut_import_whitelist、origin_tag_required、ut_unsupported_targets_handled、ut_hypium_mockkit_policy + N8 六项 use-cases）；须补材料 9 项（M1 的 DAG 九项，dag_linked_usecase 因 use-cases 在先走 N8）；1 项 f3b8d261 未留全名单，待本步落盘核对。
3. 只在 RC-9b 场景的 UT 回调里写一份最小 DAG（`doc/features/<f>/ut/reports/flow-dag/*.dag.yaml`，UT 自有目录）：节点源文件指向 BankService/BankRepository、linked_acceptance 覆盖 AC-2、spy preset 引 mock-plan 的 `empty`；**不改正例链 `writeUtMaterials`**。
4. 跑通 → 登记 RC-9b（seams，release-only，预算以实测为准，参考 RC-9 单独进程 145.1 s / 套件内 80.5 s）为 UT→coding 正例。断言顺序仿 RC-9（`real-chain-seams.unit.test.ts:979-988`）：先断回退事件（`phase_backtrack_requested` from=ut、to=coding；reason 以生产事件实值为准，RC-9 为 repair_candidates），再断 ut summary 的 `verifier_subject_id` 与 `ut_product_assertion_failure` 候选，最后断 coding 次轮 PASS。反向变异：去掉 §2.1 过滤条件 → RC-9b 必红于"没有发生回退"；`git checkout` 还原。
5. 跑不通（DAG 引出新 BLOCKER FAIL 超出路径范围、或第 20 项属 M/U 类且补料代价过大）→ 如实记未覆盖与原因，不改生产凑；real-chain-host.ts:445-450「不可达」注释按实情改写。

## 7. 放弃的准确性与不确定点
- **N8 use-cases 归"不适用"**是本 plan 的判断，依据是 business-ut contract 的 enhancement/prune 声明；若评审认定 legacy 模式下缺席应算"工件缺失"，退回不打标，笔二夹具须另补 use-cases.yaml（plan 阶段工件，改动面大，RC-9b 很可能记未覆盖）。
- **N7 2890/3517** 在 acceptance 缺席时也会打标，依赖同报告 M3 未打标出口兜底（§2.2 兜底论证），不在出口内再加 acceptance 在场条件。
- **mock-plan 组的 legacy 路径**：现代调用下"不需要 test double"已由 `check-ut.ts:4308-4312` 整组降 MINOR 并打标，不阻断诊断；只有**未获整组处理的 legacy 调用**（无 `resolvedInputs`）里，无 mock-plan 文件时 `ut_mock_plan_parseable`（3404）、`ut_mock_plan_present`（3659）、`ut_mock_plan_typed`（3897）、`ut_mock_plan_contracts_consistent`（3938）仍留 BLOCKER SKIP 挡住诊断。宿主 run 与夹具均无此形态，本 plan 不扩。触发条件=legacy 调用出现不需要 test double、且 UT 真失败的宿主 run。
- coding 两处与本缺口无关（§2.3），纳入只为 next_action 一致。
- 夹具第 20 项身份未知（§6.2）。

## 8. 实施记录

### 8.1 笔一 nas-fix（2026-09-24，基线 main 797f7af6；目标文件自 815cd996 起未变，§2.2 行号有效）

**出口核对**：按 HEAD 逐处核对 §2.2 表 60 处 `status: 'SKIP'`（行号与表一致），N1–N4、N6–N9 共 19 处出口语义均与表相符，无需记偏差；N5（`:3661` / `:4327-4331` 整组处理）原样未动。

**改动文件**
- 生产（5）：`harness/scripts/utils/verifier-plan.ts`（`VerifierEligibilityCheck.structured?`、`blockerSkips` 加 `!isCheckNotApplicable(c)`、`./types` 值导入、`:183`/表格注释）；`harness/scripts/check-ut.ts`（19 处打标 + 导入常量 + `checkOriginTagRequired`/`checkUtUnsupportedTargetsHandled` 加 `export` 供单测）；`profiles/hmos-app/harness/coding-host-rules.ts`（2 处打标，`:316` 只在 SKIP 分支带标，补值导入）；`harness/scripts/utils/report-generator.ts`（`formatRepairDiagnosisNotice` 说明句与函数注释）；`harness/prompts/verify-ut.md:41`。
- 测试（4）：`verifier-plan.unit.test.ts`（①：宿主三条打标 SKIP + code_regression → repair_diagnosis；同形未打标 → none；打标与未打标混合 → 挡；带标注的 BLOCKER FAIL 不获豁免；review 负面裁决 + 打标 SKIP → 放行）；`ut-contract-caliber.unit.test.ts`（②：真实函数产出宿主三条 + usecase_spec_schema 打标；反例 audit 缺席 3580、无 DAG 409 未打标）；`contracts-cross-consumer-closure.unit.test.ts`（②：经生产 loader 的 `runStructureChecks` 断言 page_registration / module_config_registered 两处打标；反例 build-profile.json5 缺席的 SKIP 不打标）；`verifier-production-routing.unit.test.ts`（⑤：诊断正文不含旧句、含新短语；同用例读 verify-ut.md 原文同样断言；常规正文断言保持）。
- openspec：`openspec/changes/ut-diagnosis-not-applicable-skips/`（proposal / tasks / `specs/harness-gates/spec.md` MODIFIED 整条复制后改 + 两条新场景，Enforcement 增 check-ut.ts、coding-host-rules.ts）。

**验证**
- `npm run typecheck`（harness）EXIT=0。
- 目标套件：verifier-plan 8/8、verifier-production-routing 12/12、ut-contract-caliber 17/17、contracts-cross-consumer-closure 9/9、contract-reference-closure 32/32、blocker-suggestion-ratchet 3/3。（实际套件名：plan 所写 `ut-` / `coding-host` 过滤对应 ut-contract-caliber / contracts-cross-consumer-closure；coding host 结构检查的既有测试在后者。）
- 反向变异：去掉 `verifier-plan.ts` 的 `!isCheckNotApplicable(c)` → verifier-plan 7/8 红于"标注不适用的 BLOCKER SKIP + code_regression 应放行诊断"；已从备份还原。
- `npm run openspec:validate` 48/48 + enforcement PASS；`node scripts/check-plan-version.mjs` PASS；node 扫改动/新增 15 个文件无 CR；`git diff --check` 干净。
- 全量 `cd harness && npm test`（收口一次，日志落文件后 grep）：EXIT=0；typecheck 通过，test:unit 4777 passed / 0 failed，test:fixtures 46 passed / 0 failed。

**偏差 / 放弃的准确性**
- `report-generator.ts` 说明句按 §2.6 逐字改写，原句"**没有**"的加粗随之去掉（纯排版）。
- 未改 `MIGRATION.md:366`（发布件，D1 引入时的迁移说明仍写"无 BLOCKER SKIP / 无其它 BLOCKER FAIL/SKIP"）：不在 §2.6 改动清单，零 scope 外改动；该句描述的是当时版本行为，是否在本窗口 RELEASE-NOTES/MIGRATION 补一句由调度者裁决。
- 迭代期间 contracts-cross-consumer 新用例首跑红一次：测试夹具写的 build-profile.json5 用了无引号键，生产 `parseJson5` 解析失败走 WARN 分支；改为标准 JSON 引号键后通过（夹具问题，未动生产）。

**不确定点**
- N9 `modeSkip` 覆盖 featureGate 下全部 id（含 `context_exploration_gate`、`upstream_verdict_gate`、`acceptance_yaml_structure`、`dag_files_parseable`），repair_existing_ut / cover_existing_code 模式下这些 SKIP 均打标，依 §2.2 表 N9 原判执行；若评审认为 upstream_verdict_gate 不属"需求工件门禁"，只需把该 id 移出 featureGate 或在 modeSkip 内排除。
- §7 其余不确定点（N8 归属、N7 兜底、mock-plan legacy 路径、夹具第 20 项）未变，留笔二核对。

### 8.2 笔一 codex review 返修（2026-09-24）
- **P2 已修**：`check-ut.ts` `checkNamedBusinessHandler`（N8 的 1611 出口）原按 `scan.skip` 无条件打标，但 `named-handler.ts:17` 在 profile 模块加载失败/未导出时同样返回 `skip:true`（`profile-host-loader.ts:98` 吞加载异常）——检查没执行却被标不适用。改为只在 `loadUseCaseSpec(ctx)` 确认 use-cases 缺席时打标；use-cases 在场而 scanner 返回 skip → 保留**未标注** SKIP。status/severity/details 与 loader 协议不动；该函数加 `export`（仅供单测走真实函数，沿 check-plan.ts:579 先例）。因此 check-ut 打标出口仍是 19 处，其中 1611 由无条件打标改为条件打标。
- 新增真实 checker 反例（`ut-contract-caliber`）：临时 profile 的 `harness/named-handler.js` 加载即抛错 + use-cases 在场 → 不得带标注；同一 profile、use-cases 缺席 → 打标。反向变异（恢复无条件打标）→ 该用例红，已还原。
- 验证：`npm run typecheck` EXIT=0；ut-contract-caliber 18/18、verifier-plan 8/8；按协调方指示本轮不跑全量（8.1 的全量结果不含本返修）。
- `MIGRATION.md:366` 由协调方同步为新口径（本笔不改）。
- 表述精确化（偏差记录，不改设计正文）：§2.2 表 N2 的口径准确说法是"所有**声明了** flow_type 的 DAG 都是 characterization"（`coverage-evidence.ts:206` `dagsAllCharacterization`：未声明 flow_type 的 DAG 不参与判定，全部未声明时为 false）。

### 8.3 笔二 nas-real-chain（2026-09-24，基线 main 29bc55bd；只改测试，未 commit）

**改动**（零生产改动）
- `harness/tests/utils/real-chain-host.ts`：UT 执行替身 `checkUtHvigorTest` 加唯一渲染规则（执行的 UT 正文含 `openCard(` 且 BankService 源码缺 `!!id` → FAIL `failure_kind=code_regression`、`affected_files=[BankService.ets]`，details 带「失败归因：code_regression」；否则 PASS，正例材料不触发）；文件尾「已知上限」3 改写为 RC-9b 已驱动 + 剩余上限。
- `harness/tests/unit/real-chain-seams.unit.test.ts`：新增并登记 `rc9bUtBacktrackThroughCoding`（第 8 条）；`runGateHarness` 加可选 `role='agent'`（不写 gate 标）与可缺省时钟；头注释 / RC-9 段注释同步。
- `harness/tests/run-unit.ts`：仅注释（seams 条目含 RC-9b），登记方式不变，仍 releaseOnly。

**§6.1 剩余未打标 BLOCKER SKIP**（笔一之上、无 DAG 的首跑落盘 `ut/reports/script-report.json`，共 10 项，其余 10 项已带标注）：
DAG 类 9 项——`dag_files_parseable`、`dag_schema_compliance`、`dag_node_type_valid`、`dag_acyclic`、`dag_source_file_exists`、`dag_spy_preset_resolvable`、`mock_stub_for_async`、`acceptance_coverage`、`dag_to_source`（与 §6.2 预计一致）；
第 20 项 = `ut_mock_plan_contracts_consistent`（check-ut.ts:3962「feature 缺少 contracts.yaml interfaces[]」，§2.2 M4 工件无效、不打标）：正例材料 mock-plan 为 BankRepository 声明 spy 而 contracts `interfaces: []`。

**补料**（只在 RC-9b，正例链 `writeUtMaterials` / `writePlanMaterials` 不变）
- UT 回调写 `doc/features/<f>/ut/reports/flow-dag/open_card.dag.yaml`：顶层与 assertion 节点 `linked_acceptance: [AC-2]`；`n_list` async_call → BankRepository.list（`class: BankRepository`、`stub_strategy: spy`、`spy_preset: empty`）；`n_open` → BankService.openCard；`n_assert` assertion。
- plan 回调在 contracts.yaml 补 `interfaces: [BankRepository.list(): string[]]`（写法同 RC-1 `addNeverCreatedContractFile`）。补后回退时刻 ut 报告未标注 BLOCKER SKIP = 0，DAG 未引出新 BLOCKER FAIL，唯一 BLOCKER FAIL 即 `ut_hvigor_test`。

**实跑中新发现（未改生产，交调度者裁决）**：按 §6.1 原构造（ut 第 2 轮起才发布 verifier 报告），笔一修复生效——第 2 轮 ut summary 已有 `verifier_subject_id` 与 `ut_product_assertion_failure` 候选——但**仍无回退**：第 2 轮 blocker 签名不变（`ut_hvigor_test`）、watched 集（候选/affected 文件 = BankService，UT 无权改）零变化，`shouldHaltNoProgress`（goal-phase-runtime.ts:9006，位于回退路由之前）判 `no_progress_guard` HALTED，`artifact_delta=unchanged`。而第 1 轮 gate 的 NEXT 指引正是让 agent「投 verifier、写报告、重跑 harness」——若 agent 把这步留到 runtime 的下一轮，宿主同样会在第 2 轮被停机。
- 因此 RC-9b 的构造改为**诊断在 ut 同一轮内完成**：UT 回调像宿主 agent 那样自跑一次 harness（agent 侧：轮次身份三键 + 设备目标，无 `MAISON_GOAL_GATE_HARNESS`），读本轮 subject、发布 verifier 报告，外层 gate 以同一 subject 读到 → 第 1 轮即回退。
- **放弃的准确性**：「报告留到下一轮才发布」的两轮形态未覆盖，且实测不可达（上段）。这是生产侧 runtime 判停顺序问题，超出本 plan 范围，未修、未登记为测试；是否另立 plan 由调度者定。

**RC-9b 判据（顺序仿 RC-9）与结果**：① `phase_backtrack_requested` from=ut、to=coding、reason=`repair_candidates`（生产实值；invalidated_phases=[coding, review]），coding/review/ut 回退后各有新 `phase_start`；② 回退时 ut summary verdict=FAIL、`verifier_subject_id` 为 64 位 hex、`repair_candidates` 含 `ut_product_assertion_failure`（category=coding、source_phase=ut、files ∋ BankService），回退事件携带同一候选，回退时刻未标注 BLOCKER SKIP 为空；③ 回退后首次 coding 指令含候选 id，coding 次轮首个 verdict=PASS，其后 ut 重验 PASS，终局 coding/review/ut PASS+closed。链随范围延伸进 testing（本条不写 test-plan，testing halt，不断言）。

**耗时**：单独进程 134.2 s；套件内 76.8 s；`--release --filter real-chain-seams` 8/0，墙钟 353 s。

**反向变异**：去掉 `verifier-plan.ts` `blockerSkips` 过滤里的 `&& !isCheckNotApplicable(c)` → RC-9b 红于「没有发生回退」（101.2 s）；`git checkout -- harness/scripts/utils/verifier-plan.ts` 还原，`git status` 中 verifier-plan.ts 不在改动列表。

**验证**：`npm run typecheck` EXIT=0；`npm run test:unit -- --release --filter real-chain-seams` 8 passed / 0 failed；`git diff --check` 无输出；node 逐字节扫 3 个测试文件 + 本 plan 无 CR。按调度要求未跑全量。

**不确定点**
- 迭代与套件实跑时工作树含他人在制品 `harness/scripts/utils/revalidate.ts`（provision 整拷 harness，故被一并带入）；结论未单独在不含该改动的树上复跑。
- agent 侧自跑 harness 的环境按 `runGateHarness` 逐键重建、只去掉 gate 标；runtime 注入给 agent 的完整 `extraEnv` 夹具拿不到（`AgentCtx` 只暴露 runId / goalAttemptId），设备目标沿用与默认就绪门桩同值的 `RC4_DEVICE_ENV`。

**调度者追补（codex code review 两条 P3，2026-09-24）**：RC-9b 段注释"ut 第 2 轮起发布"改为"同轮内（agent 自检取得 subject 后）发布"；候选身份断言追加 summary 与回退事件的 `item_fingerprint` 相等（不再只比固定 id/类别/文件）。复跑 `--release --filter real-chain-seams` 8/0（RC-9b 73.0 s）。codex 判定：agent 同轮自检取得 subject 对准生产（MIGRATION.md:367 口径，subject 经 harness-runner.ts:2515 生产签发、`skipSummaryPatch` 不伪造 identity）；跨轮才补齐 verifier 证据时 `shouldHaltNoProgress`（goal-phase-runtime.ts:9007）早于回退执行（:9782）会吞掉迟到候选，建议单独立小 plan——**本 plan 不扩面，是否立项由用户定**。
