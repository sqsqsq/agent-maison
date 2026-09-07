---
name: 六阶段重构 B07 — 视觉回修归因与 golden 复用校验施工图
overview: 视觉信号进回修候选时按 defect 严重度分流（minor 不产 coding 候选、留在既有视觉债务台账），T8 hard 命中不得被转录成 minor；testing 同键复用时若当前设了 golden contract，仍走既有采集入口而不是把 visual_diff_capture 直接记 PASS；golden contract 的适用性在 B06 运行单 A 启动前裁定。预算、量测、defect schema、verifier 指引一律不动。B07 只做本地修复；宿主补验收归 B06。
version: 3.0.0
todos:
  - id: b07-plan-review
    content: 施工图由用户评审（plan 阶段不走 dev/review 循环）；codex 只读评审第 1 轮四处补正已落盘（§8）。评审通过后进入实施，实施与检视按循环协议（Opus 实施、codex review、三轮熔断、通过即提交）。
    status: pending
  - id: b07-collector-severity
    content: 按 D1 改 collectActionableDefects §A：结构化 defect severity=minor 不产候选（console 一行计数），major/blocker 照旧；不解析 note、不读 `[owner=…]` 前缀、不加字段。
    status: pending
  - id: b07-hard-floor
    content: 按 D2 在 visual_diff_finding_transcription 对账里加"hard 命中被转录为 minor"一档，与 hard 未落账同 ratchet（hard 合同 FAIL / best_effort 沿既有 WARN）；warn 档 T8 不受影响。
    status: pending
  - id: b07-reuse-golden-capture
    content: 按 D3 改 check-testing 复用分支：MAISON_GOLDEN_CONTRACT 生效时不再直接 PASS visual_diff_capture，而是调用既有 runDeviceVisualDiffCapture 入口（只补采集，不重跑 device_test/UT），nav 参数读顶层已回填的 device-test-run.meta.json；两分支的 visual_diff_capture details 都带 golden_contract 身份。
    status: pending
  - id: b07-b06-runsheet
    content: 按 D4：B06 §7.2 新增 P0.5 golden 适用性裁定（A 启动前）、A 命令的 golden 首段改为条件、E 的"样本不适用"记法、禁止运行中清空变量；B06 新增 `b06-host-b07-reacceptance` 待办。已在 plan 阶段落盘（09-07），实施时只核对不重写。
    status: completed
  - id: b07-spec-docs
    content: 按 D6：一个新 change 目录两条 delta（候选严重度门槛；复用不绕过 golden 采集）+ MIGRATION 3.0.x 两行。总 plan §5 行与里程碑已在 plan 阶段落盘。
    status: pending
  - id: b07-local-acceptance
    content: V1–V6 全绿 + typecheck + LF 扫描 + 根 AGENTS 要求的一次 `cd harness && npm test` 全量（改动发布内容）；文案返修不重复全测。候选件重建与宿主验收不在本批。
    status: pending
---

# B07 施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。B07 是 B06 宿主取证（run `20260906T143404Z-ab463c`）暴露出的两处**框架侧**缺陷的最小修复，前置是"B06 已取证"，不是"B06 已完成"；B06 保持未完成，其已有证据全部复用。不重开 B01–B05，不把修复塞进 B06 验收计划。原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)。

**完成边界（codex plan review 第 1 轮 #4）**：B07 的完成 = 本地修复 + §7 判据；宿主补验收是 B06 的 `b06-host-b07-reacceptance`（用户触发、窗口由用户定），不在本批待办与判据内。

**本批的证据门槛**：每条 D 以"具体代码分支 + 宿主现场可复现输入"为前提。核实后不成立或不该改的一律写进 D5 并**不改**。

## 1. 问题边界

宿主 run `20260906T143404Z-ab463c`（只读）终态：`run_end HALTED / backtrack_limit（2/2）/ TERMINAL`。testing-i13 的 `phase_verdict`：`verdict=PASS`、`harness_exit=0`、`blockers=[]`、`failure_kind_classified=code_regression`、`assess_recommendation.action=rerun_phase → coding`、`reconcile_observation.deterministic_defects` 12 条、`repair_convergence.open_signal_count=12 / attempted_signal_count=1`。两次已用回退都是真修复（review CR-001 → coding；testing 缺第七行 → coding），第三次请求是本批要修的错误。

**① 12 条视觉信号全部被转成 coding 候选，严重度与归属在转换中丢失。**

宿主 `device-testing/device-screenshots/visual-diff.json`：3 屏 verdict=warn，defects 共 12 条，**severity 全部 `minor`**；6 条 must_fix 全部以 `[owner=spec]` 开头。其中 10 条 source.producer=T8（B1_layout_group_divergent ×6、B2_group_container_missing ×1、B3_order_inverted ×2、A1_forbidden_overlap_unlocatable ×1），2 条 class=other、无 producer（expanded / all_banks 两屏参考图为 4350 / 8312 px 长图，被 `visual_reference_viewport` 整屏剔出比对，verifier 如实标"保真度 UNKNOWN"）。verifier 在 note 里写明"--measure 实测行高 168 / 节距 169–170 与参考图一致——声明口径差，非渲染缺陷"。

代码链：[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):2246–2380 `collectActionableDefects` §A 的过滤只有三件事——屏 verdict∈{warn,fail}（①）、must_fix 非空（②）、截图/build 身份绑定（③④）；过关后**每条结构化 defect 各成一条 actionable**，不读 `defect.severity`、不读 must_fix 文本、不区分 T8 档位。[repair-candidates.ts](../../harness/scripts/utils/repair-candidates.ts):765–790 `actionableDefectsToCandidates` 把 `category` 写死 `'coding'`。[assess.ts](../../harness/scripts/utils/assess.ts):805–840：候选非空 → `rerun_phase` → `backtrack_to_phase`。于是 minor 声明差与证据缺口以 coding 候选身份吃掉了最后一次回退。

**verifier 为什么写成 warn+must_fix**：B1/B2/B3 在 [layout-oracle-check.ts](../../profiles/hmos-app/harness/layout-oracle-check.ts):539/563/592 是 `'warn'` 档；T8 warn 命中产出 `visual_diff_layout_invariants` MAJOR WARN（[visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts):2283–2292），既阻断 candidate-pass 又要求"落账"（:2533–2545），而 warn 屏 must_fix 空又是 T4 BLOCKER（:689–705）。verifier 在门禁允许的形态里只能写 warn+must_fix 并用自由文本标 owner；框架另一条合法形态"pass + minor defect（无需修）"（:693 注释、:1377–1379 只禁 pass 屏登记 blocker/major）它没选。**本批不改 verifier 指引，不改 T8 档位**：无论 verifier 选哪种形态，minor 都不该成为 coding 候选。

**② testing 同键复用把 golden 约束绕掉了。**

[check-testing.ts](../../harness/scripts/check-testing.ts):4425–4437 testing 执行键 `flags` 只有 `--skip-assert-expected` 与 `HARNESS_DEVICE_TEST_COLD_RESTART`，`MAISON_GOLDEN_CONTRACT` 不入键；:4732–4740 复用分支直接推一条 `visual_diff_capture PASS "同键复用：设备截图沿用被复用 run 的产物"`，:4742 的采集入口 `runDeviceVisualDiffCapture` 只在 `!reusable` 时调用。golden 模式的"本 run 强制重采 + forbidden 证据生产"（[visual-diff-capture.ts](../../profiles/hmos-app/harness/visual-diff-capture.ts):1128–1160、:1363–1420）在复用路径上根本不运行。

宿主现场：i13 代理在 golden fail-closed BLOCKER（contract 十屏在本需求无法解析为 capture target）之后执行了 `env -u MAISON_GOLDEN_CONTRACT npx ts-node harness-runner.ts --phase testing …`，随后同键复用、capture 记 PASS。i13 的 PASS 因此不能证明 golden 条件通过；evaluator 的 `captured_in_run` / HomeTab 证据检查会把它判 FAIL（[evaluate-bc-opencard.ts](../../harness/scripts/consumer-golden/evaluate-bc-opencard.ts):255–275、:433–460），这一层保留不动。

**③ golden contract 与当前需求基线不匹配（验收配置，不是代码）。** `bc-opencard.golden-contract.json` 立项于十屏富需求，当前基线（原始需求 3 张参考图）不含短信验证/添加成功等屏。既不能要求产品补出需求之外的页面，也不能从产物反推缩减 contract。B06 运行单 A 的启动命令（[pipeline_b06](pipeline_b06_matrix_acceptance_4d9c1f72.plan.md) §7.2-A）在起 run 前**无条件**设十屏 golden，D3 修好复用校验后 A 会原样再撞一次——所以适用性必须在 **A 启动前**裁定（D4）。

## 2. 非目标

- 不改回退预算、不加"预算耗尽即完成"规则（D5-1）。
- 不给 defect 加 owner/repair_owner 字段，不解析 `[owner=…]` 自由文本，不做"回 spec"路由（D5-2；codex 09-07 同意）。
- 不改 T8 探测、档位表、量测坐标口径（D5-3）；不改 `visual_reference_viewport` 的长图剔除（D5-4）。
- 不把 golden 身份加进执行键（D3 说明），不动 UT 复用。
- 不改 verifier 模板/prompt（D5-5）；不给 evaluator CLI 加 `--contract`（D5-7）。
- 不建候选账本、签名、状态机、裁决层；不建"每需求自动生成 golden"；不新增全局硬门禁。
- 不重建候选件、不跑宿主长 run（归 B06 补验收，用户触发）。

## 3. 决策纪要

### D0：保留的真源与状态

`summary.repair_candidates[]` 仍是候选唯一真源；signal@1 身份、`computeDefectFingerprint`、repair_convergence、no_progress_fuse、backtrack 预算、visual-debt 台账（[visual-debt.ts](../../harness/scripts/utils/visual-debt.ts)）、execution-key 同键复用与冻结件回填、golden 采集的 `captured_in_run` 戳与 evaluator 的 run 绑定——全部保留，B07 只在它们之间**接对线**。

### D1：候选收集按 defect 严重度分流（唯一的收集器改动）

落点：`collectActionableDefects` §A，[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):2322–2370 的 `for (const { d, fp } of structural)` 循环。

规则（结构化字段，零文本解析）：
- `d.severity === 'minor'` → **不产 actionable**，计数；循环结束后若计数>0，`console.warn('[actionable] <screen>: N 条 minor 视觉信号不产回修候选（留视觉债务台账 / 报告 WARN）')`。provider 源（`source.producer==='visual_provider'`）同样适用。
- `major` / `blocker` → 与现状逐字相同（含 signal@1 身份、指令拼装、指纹）。
- 纯文本 must_fix 兜底（无结构化 defect）→ **不动**（legacy 语义；pixel_1to1 P0 屏的转录门禁已要求逐条锚定，走不到这里）。
- `unverified` 通路（③④身份不齐）→ **不动**。

对宿主 i13 的**决策重放**：12 条 minor → 0 候选 → assess 不再 `rerun_phase` → 不会请求第三次回退；`visual_diff must_fix=6` WARN 照旧进 visual-debt（`needs_fix`，阻断 release）。这只说明"移除无效候选后不再错误回退"，**不承诺**旧 run `20260906T143404Z-ab463c` 会变成 COMPLETED——它已是结构性 TERMINAL，不改写终态。这也是 D5-1 不需要新完成规则的原因。

证据缺口（长图剔除、未挂载不可求值）不另立规则：它们由 verifier 以 minor 登记即被本条覆盖；verifier 若判 major，就是它的结构化裁决，照常进候选。

### D2：T8 hard 命中不得被转录成 minor（守住"机器确定性错误仍进回修"）

落点：`visual_diff_finding_transcription` 对账 ①，[visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts):2473–2496。现在 `matched` 是布尔；改成取到匹配的 defect（三种匹配路径任一命中即取该 defect），当 `finding.tier === 'hard'` 且匹配 defect `severity === 'minor'` → 归入新列表 `downgradedHard`，与 `unloggedHard` 同 ratchet、同 hit id，line 文案独立：`【t2 hard 命中被降级】T8 hard 命中转录为 minor（机器确定性证据不得降级）：<labels>——severity 至少 major`。`transcriptionDirty` 随 FAIL 置位（与 unloggedHard 同）。

**strictness 口径**（codex #注1）：该路径的 `pixel1to1` 来自 `isHardPixelContract(ctx)`（:1408）——**hard 合同下 FAIL；best_effort 沿既有 `fidelityRatchetFailOrWarn` 的 WARN 策略**。不因本条新增全局硬门禁。

不动的：warn 档（B1/B2/B3）转录成 minor 完全合法；模板推荐值仍是 `severity: 'major'`（:2500–2512，不改）。

### D3：复用分支不绕过 golden 采集（只补采集，不重跑执行）

落点：[check-testing.ts](../../harness/scripts/check-testing.ts):4732–4786。

- 把 :4742–4786 的采集块提成同函数内的局部闭包 `captureIfUiChanged(logPath)`（内容逐字不动）。
- `run.ok && !reusable` → 调 `captureIfUiChanged(run.logPath)`（现状）。
- `run.ok && reusable`：`const goldenEnv = loadGoldenContractFromEnv(ctx.projectRoot)`；`goldenEnv.targets !== null`（golden 生效）→ **不推**"同键复用 PASS"那条，改调 `captureIfUiChanged(<logPath>)`；否则保持现状那条 PASS。
- **nav 参数来源（codex #2 修正）**：`readDeviceTestRunHylyreNavOpts(logPath)` 读 `dirname(logPath)/device-test-run.meta.json`；`adoptFrozenRunArtifactsForReuse`（:4013–4021）已把 `frozen.device-test-run.meta.json` 回填到**顶层** `reportsDir`（[execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts):71，execution 组）。因此复用分支传入的 `logPath` 取 `path.join(featurePhaseReportsDir(...), 'visual-diff-capture.reuse.log')`——dirname 即顶层 reportsDir，读到的就是被复用 run 的真实启动参数（宿主现场：`omitBundle=true, hypiumPageName=PhoneAbility`）。**不得**用 `reusable.runDir` 拼路径（读不到 meta，退回 `omitBundle:false`），**不得**传 `''`。`logPath` 在截图/dump/nav 三个 builder 里都是可选的日志落点，用该路径即可。
- `ready`（:4334）、`hapHolder`、`bundleName` 在复用分支均已就绪，不需要新装配。
- 采集入口本身不改：golden 模式下"未在本 run 采过的 contract 屏强制重采、forbidden 证据生产"是既有行为；同一 goal run 内第二次 harness 调用会按 `captured_in_run === runIdNow` 跳采，复用收益保留。
- **两分支**的 `visual_diff_capture` 行 details 追加 `golden_contract=<contract 文件 sha256 前 16 位>|none`（`runDeviceVisualDiffCapture` :4862 已装载 goldenEnv，取 `process.env.MAISON_GOLDEN_CONTRACT` 指向文件算 hash；复用 PASS 行同样追加）。普通测试结论与 golden 结论由此在同一报告里分开可读，不另加检查项。

golden 身份**不入执行键**：入键会让 golden 开/关都触发整套 device_test 重跑，违背"只补采集"。代价见 §5。

### D4：golden 适用性在 A 启动前裁定（B06 运行单，已于 plan 阶段落盘）

codex #1：适用性放在 E 太晚，且不能拿"spec 缺屏"当 N/A 的依据——基线匹配时 spec 漏屏正是 golden 要抓的错误。改为 [pipeline_b06](pipeline_b06_matrix_acceptance_4d9c1f72.plan.md) §7.2 **共同前置 P0.5**：

1. **A 启动前**对照**独立确认的需求基线**（原始需求文 + 用户确认的屏清单；不是本 run 产物，也不是 spec 自己）与 contract `positive_screens`。匹配 → A 命令保留 `$env:MAISON_GOLDEN_CONTRACT=…` 首段，之后 spec 漏屏、采集缺屏一律是**真实 FAIL**。不匹配 → A 去掉首段，不带 golden。
2. **E 的记法**：不匹配基线上的 run，evaluator 照跑、报告照存，结论保留 **FAIL** 原样并注明"验收样本不适用（contract 立项需求 ≠ 当前基线）"；**不记 N/A、不改写历史结果、不从产物反推 contract**；promote 前提在该基线上不成立，如实登记。
3. **纪律**：执行 harness 期间不得 `env -u` / 清空 `MAISON_GOLDEN_CONTRACT`；golden fail-closed BLOCKER 是验收结论，出现即停、回到 P0.5 重裁。
4. 当前 bc-openCard-1 基线（原始需求 3 图）与十屏 contract 不匹配（run `20260906T143404Z-ab463c` 已证）——除非用户另行确认基线，A 不带 golden；B06 新增待办 `b06-host-b07-reacceptance`（用户触发）承接 B07 之后的补验收。

### D5：核实后不改（七项）

1. **回退预算 / "预算耗尽即完成"**：两次已用回退都是真修复；D1 之后同样输入不再产生第三次请求。预算是防真实问题无限循环的护栏，不动。此前调度者提出的 COMPLETED_WITH_DEBT 建议撤回。
2. **defect owner 字段 / 回 spec 路由**：minor 声明差回 spec 会触发 spec→plan→coding→review→ut→testing 整链重跑，为几条声明措辞付整链成本，违背效率优先；既有 `CorrectionCategory` 已能表达 spec/plan，真需要时加一个可选字段即可，本批不加。codex 09-07 同意。
3. **T8 档位与量测坐标**：B 类 warn 档正确（"声明的同行/同组关系未实现"本来就是观测不是断言）；bbox 口径疑点没有制造错误回修的证据（本次错误来自收集器不是 T8），不动。
4. **`visual_reference_viewport` 长图剔除**：是需求资产问题（整页拼接图 vs 单视口），框架如实标 UNKNOWN 是对的；不做切片比对。
5. **verifier 模板 / prompt**：不改。verifier 已有"pass + minor defect"形态可选；D1 让两种形态殊途同归。
6. **B06 golden fixture 本身**（`bc-opencard.golden-contract.json`）：保留给十屏富需求回归，不缩、不改名。
7. **evaluator CLI `--contract`**（codex #3）：`main()` 只读 `--project-root/--run-id/--feature/--expected-manifest-sha/--out`（[evaluate-bc-opencard.ts](../../harness/scripts/consumer-golden/evaluate-bc-opencard.ts):535–546），`contractPath` 只在导出 API 上。本批**不加**，D4 也不再写"换 contract 跑 E"的路径——当前没有这条需求；将来若要在其他基线上跑 E，加参数是一小处代码 + 一条用例，届时另行登记。

### D6：规格与文档同步

- openspec：新 change 目录 `visual-repair-severity-and-golden-reuse`，两条 delta：① repair candidates——结构化视觉 defect 仅 major/blocker 产 coding 候选，T8 hard 命中转录 severity 下限 major；② device execution reuse——同键复用不得跳过当前生效的 golden 采集要求，`visual_diff_capture` 披露 golden contract 身份。实施时先核 `openspec/specs/` 是否已有对应 requirement（MODIFIED 优先于 ADDED）。
- [MIGRATION.md](../../MIGRATION.md) 3.0.x 小节两行（行为变化 + 放弃的准确性）。
- 总 plan §5 B07 行与 B06 补验收里程碑：已于 plan 阶段落盘。

## 4. 文件与提交边界

| 组 | 文件 | 内容 |
|---|---|---|
| C1 生产 + 单测 | `harness/scripts/goal-phase-runtime.ts`（D1）、`profiles/hmos-app/harness/visual-diff-check.ts`（D2）、`harness/scripts/check-testing.ts`（D3）、`harness/tests/unit/device-test-backtrack.unit.test.ts`（V1/V2）、`harness/tests/unit/visual-fidelity.unit.test.ts` 或既有 transcription 用例所在 suite（V3）、`harness/tests/unit/golden-nav-capture-wiring.unit.test.ts`（V4/V5）、`harness/tests/unit/goal-runner-repair-convergence.unit.test.ts`（V6） | 一笔提交 |
| C2 规格 | `openspec/changes/visual-repair-severity-and-golden-reuse/**`、`MIGRATION.md` | 一笔提交 |
| C3 文档 | 本 plan 实施记录（B06 §7.2 与总 plan 的修订已在 plan 阶段随本文件一并落盘，实施时只补实施记录） | 一笔提交 |

提交按循环协议：codex review 通过后由调度者提交；不加 Claude 署名。

## 5. 接受的准确性边界（放弃的准确性）

- **D1**：verifier 若把真实产品缺陷误标 minor，本批不会为它产 coding 候选——它留在报告 WARN 与视觉债务台账里，等 verifier 下一轮或人工升级。换来的是 minor 永远不再消耗回退预算。
- **D2** 只守 hard 档；warn 档 T8（B 类）转录成 minor 后不进回修，这是本批的目的，不是遗漏。best_effort 合同下仍只 WARN，沿既有策略。
- **D3** 不入执行键、不防 `env -u`：代理清掉 golden 变量，框架无法知道"本应有 golden"；能做的只是把 `golden_contract=none` 写进报告，并靠 evaluator 的 run 绑定把这种 PASS 判 FAIL（既有）。防篡改不是优先级。
- **D4**：不匹配基线上的 E 记"FAIL——样本不适用"，意味着该基线上 promote 前提仍未建立；这是事实登记，不是放行。

## 6. 验收用例

| # | 场景 | 输入 | 期望 |
|---|---|---|---|
| V1 | minor 不产候选 | 按宿主 i13 形状造 visual-diff.json：3 屏 warn、12 条 minor defect（10 条 T8 源、2 条 other 无源）、must_fix 带 `[owner=spec]`、身份绑定齐全 | `collectActionableDefects` 的 visual actionable 为 0；unverified 为 0；console 含"minor 视觉信号不产回修候选" |
| V2 | major 仍进候选 | V1 同 fixture，把一条 T8 defect severity 改 major | 恰 1 条 actionable，`source=visual_diff`、`signal_identity=true`、fingerprint 与改动前该条逐字相同；经 `actionableDefectsToCandidates` category=coding |
| V3 | hard 降级被拦 | P0 屏，T8 hard 发现（A1_forbidden_overlap）被一条 severity=minor、finding_id 对上的 defect"消账"；分别在 hard 合同（`isHardPixelContract=true`）与 best_effort 两种 ctx 下跑 | `visual_diff_finding_transcription` 命中"hard 命中被降级"：hard 合同 → FAIL 且 `fingerprintable=false`；best_effort → WARN（沿既有 ratchet）。同发现改 major → 该 hit 消失 |
| V4 | golden 生效时复用不绕过 | check-testing 生产接线：同键可复用 run 就绪、顶层已回填 `device-test-run.meta.json`（`omit_bundle_for_hylyre=true`），设 `MAISON_GOLDEN_CONTRACT` 指向合法 contract，注入 mock 传输面 | 没有"同键复用…PASS"那条 `visual_diff_capture`；`runDeviceVisualDiffCapture` 被调用（mock 记录导航/截图事件），nav 以 `omitBundle=true` 调用；capture 行 details 含 `golden_contract=<sha16>`；device_test 未重跑（`reused_by_execution_key=true` 不变） |
| V5 | 无 golden 时复用不变 | V4 去掉 env | 与改动前逐字相同的 PASS 行 + `golden_contract=none`；mock 零事件 |
| V6 | 移除无效候选后的决策重放 | 以宿主 i13 的观测形状构造：verdict PASS、`repair_candidates=[]`（D1 后的产物）、`visual_diff` WARN、backtracks_used=2 | `assess` 不返回 `rerun_phase`/`backtrack_to_phase`；不断言任何 run 终态变化（旧 TERMINAL 不改写） |

## 7. 命令与完成判据

    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter device-test-backtrack
    npm --prefix harness run test:unit -- --filter visual-fidelity
    npm --prefix harness run test:unit -- --filter golden-nav-capture-wiring
    npm --prefix harness run test:unit -- --filter goal-runner-repair-convergence
    node <scratch>/lf-scan.js（改动文件全 LF）
    cd harness && npm test（改动发布内容，根 AGENTS.md:68 要求全量 PASS；代码定稿后跑一次，纯文案返修不重复）

完成判据：V1–V6 全绿；改动前后 `device-test-backtrack` / `golden-nav-capture-wiring` 既有用例数不减；openspec `validate` 通过；全量 `npm test` 一次 PASS。候选件重建、宿主验收与 B06 §6 登记表回填**不在本批**（归 B06 `b06-host-b07-reacceptance`，用户触发）。

## 8. 修订记录

### 2026-09-07：施工图（未评审、未实施、未提交）

依据：宿主 run `20260906T143404Z-ab463c` 只读取证 + codex 09-07 意见（两项必修、预算不动、夹具错配归验收配置）+ 调度者对源码的逐条核实（§1 引用行号）。

### 2026-09-07：codex 只读 plan review 第 1 轮（四处补正 + 两条说明，全部采纳；plan 校验 PASS）

- #1 P1 → D4 重写：适用性裁定移到 B06 §7.2 共同前置 P0.5（A 启动前），依据是独立确认的需求基线而非 spec 缺屏；不匹配时 E 保留 FAIL 并注"样本不适用"，不记 N/A、不改写历史。B06 §7.2-A 命令的 golden 首段改为条件。
- #2 P1 → D3 修正：复用分支的 nav 参数改读顶层已回填的 `device-test-run.meta.json`（`logPath` 取顶层 reportsDir 下路径），删除 `omitBundle:false` 兜底与 §5 对应的"准确性代价"。
- #3 P2 → D5-7：`--contract` 未接 CLI，删除 D4 里"换 contract 跑 E"的路径，本批不加参数。
- #4 P2 → 待办与判据统一：删 `b07-host-acceptance`，宿主补验收移到 B06 `b06-host-b07-reacceptance`；总 plan §5 补 B07 里程碑；§7 加根 AGENTS 的一次全量 `npm test`。
- 说明 1 → D2/V3 写明 strictness：hard 合同 FAIL、best_effort 沿既有 WARN。
- 说明 2 → D1/V6 改为"决策重放"，不承诺旧 TERMINAL run 变 COMPLETED。
- 分歧收口：minor 留债务台账、不回 spec、不加 owner 字段——codex 同意。

## 实施记录

（待实施）
