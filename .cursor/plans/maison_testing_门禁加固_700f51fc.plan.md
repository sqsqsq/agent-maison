---
name: maison testing 门禁加固
overview: 基于 bc-openCard 实践案例，加固 AgentMaison（在研窗口 2.4.0）的 testing 阶段门禁、goal-runner 完成裁决与 ArkUI 静态规则，杜绝「真机 trace 失败/超时但 goal-report 仍 COMPLETED」的假完成，并补齐 UI 入口覆盖与 visual 回环阻断。
version: 2.4.0
todos:
  - id: p1-device-run-gate
    content: check-testing.ts device_test_run 成功分支：读 trace.outcome/failed/blocked，partial/failed 或有失败阻塞 case → BLOCKER FAIL
    status: completed
  - id: p2-report-trace-reconcile
    content: check-testing.ts 新增 report_trace_reconciliation(BLOCKER)：定位本轮 trace.json，全量比对顶层 test-report 执行状态/结论与 cases[].status/outcome
    status: completed
  - id: p3-verifier-testing
    content: verify-testing.md 检查7 改为必读 trace+全量核对，新增 outcome!=success 不许 PASS 规则，强化 pass_criteria_met
    status: completed
  - id: p4-goal-runner-closure
    content: "goal-runner: PASS 后自跑 --sync-closure；SummaryJson+resolvePhaseHarnessVerdict 增 closure/receipt/timeout，open/timeout 不 advance；resolveGoalRunStatus 超时未闭环→非 COMPLETED；闭环 halt override 插在现有 interactionSentinel/no_progress_guard 之后并复用 halt_reason(closure_open/receipt_missing/agent_timeout_unclosed)，不动 DETERMINISTIC_GATE_BLOCKER_IDS"
    status: completed
  - id: p5-arkui-rules
    content: coding-rules.overlay.yaml + coding-host-rules.ts 新增 arkui_bindsheet_double_close(BLOCKER)/arkui_push_without_guard(MAJOR)/arkui_singleton_flow_multi_subscriber(MAJOR)，含豁免注释约定
    status: completed
  - id: p6-ui-entry-coverage
    content: 派生计划 schema 加 entry_ui 字段(derive-hint/derived-hylyre-plan + SKILL 每入口各派生一条)；check-testing.ts 新增 ui_entry_coverage 用 linked_flow+entry_ui+calls 结构化匹配，P0 缺覆盖→BLOCKER，非 P0→MAJOR，缺字段→WARN 降级；verify-testing 同步
    status: completed
  - id: p7-visual-pending-overlay
    content: visual-diff-check.ts new_or_changed+P0 全 pending→BLOCKER FAIL；visual-diff-capture.ts 把 P0 Sheet/Dialog overlay 纳入 visual target
    status: completed
  - id: specs-docs
    content: testing-rules.yaml / coding-rules.overlay.yaml 登记新 check id 与严重度；更新 runbook/SKILL/verify prompts
    status: completed
  - id: tests-acceptance
    content: 补齐各项 harness 单测并 cd harness && npm test 全 PASS；bc-openCard 案例复跑验证；不动 package.json.version
    status: completed
isProject: false
---

## 背景与目标

本窗口 `package.json.version = 2.4.0`，**不动版本号**。所有改动均属发布内容（`harness/` `specs/` `profiles/` `skills/`），完成后须 `cd harness && npm test` 全 PASS（BLOCKER）。

codex 提的 7 点已逐一定位根因，按用户决策：**全做**，门禁修复采用**硬 BLOCKER**。

本 plan frontmatter 已绑定 `version: 2.4.0`（紧随 name/overview）。

## 改造点

### 点1 — device_test_run 不能把 partial/失败判 PASS（BLOCKER）

- 现状：[profiles/hmos-app/harness/providers/device-test-run.ts](profiles/hmos-app/harness/providers/device-test-run.ts) L1404-1410 的 `run.ok` 只看「exit=0 或有 trace.cases」；[harness/scripts/check-testing.ts](harness/scripts/check-testing.ts) L1966-1977 据此无条件判 PASS。
- 改：在 check-testing 的 device_test_run 成功分支后，读 `run.trace.outcome` 与 `failed_count`/`blocked_count`。当 `outcome ∈ {partial,failed,aborted}` 或有失败/阻塞 case → 该 check 改判 **BLOCKER FAIL**（保留 trace/report 路径与失败分类摘要于 details）。`run.ok=false`（崩溃）仍 BLOCKER FAIL 不变。
- 语义区分：`run.ok` = 自动化未崩溃；`device_test_run` 门禁 = 自动化产物达标。二者解耦但门禁以后者为准。

### 点2 — 新增 test-report ↔ trace 全量对账 checker（BLOCKER）

- 现状：check-testing 仅做 plan↔report 的 TC 编号双向一致（`plan_to_report_consistency`），无任何读 `trace.json` 与顶层报告状态比对的检查。
- 新增 checker `report_trace_reconciliation`（BLOCKER）：**唯一可信源 = device_test_run 本轮选中的 `testing/reports/<ts>/hylyre/trace.json`**（复用 device_test_run 同款派生目录 mtime 选取逻辑得到的 `run.tracePath`）；**显式禁止**读取顶层可被 agent 回填的 `testing/reports/trace.json`（若存在二者不一致，以 hylyre/ 子目录原始 trace 为准并在 details 标注来源路径）。解析顶层 [test-report.md](doc) 「测试执行结果」表（复用现有 `execution_result_table` 的表解析）得到 `TC → 状态`；与 hylyre `trace.cases[].id/status` 全量比对。
- FAIL 条件：报告写「通过」但 hylyre trace 为「失败/阻塞」；报告结论 verdict=「达标」但 hylyre `trace.outcome != success`；hylyre trace 有失败 case 而报告未登记；选中 trace 路径无法定位或非本轮派生目录产物。

### 点3 — verifier-testing 必读 trace、全量核对（不止抽样）

- 现状：[harness/prompts/verify-testing.md](harness/prompts/verify-testing.md) L63 检查7 只要求「抽样 3-5 条失败/阻塞/跳过」。
- 改 prompt：检查7 改为**必读 trace.json**、**全量核对**每个 `cases[].id/status` 与顶层报告执行状态一致；新增硬规则「`trace.outcome != success` 时不允许 verdict=PASS」；同步强化检查6 `pass_criteria_met`（结论须与 trace 实际一致，不只与报告内自洽）。

### 点4 — goal-runner 超时/receipt 缺失不得 COMPLETED

- 根因（**本地 headless 改动后仍成立**）：[harness/scripts/utils/goal-runner-phase.ts](harness/scripts/utils/goal-runner-phase.ts) `resolvePhaseHarnessVerdict` 仍仅信 fresh `summary.verdict`；[goal-runner.ts](harness/scripts/goal-runner.ts) verdict 区块（约 L1090-1152）的 `SummaryJson`（L122-134）不含、也不读 `receipt_status`/`closure_status`；[phase-transition-policy.ts](harness/scripts/utils/phase-transition-policy.ts) `resolveGoalRunStatus` 只看 halted/deferred/reachedEnd。
- 改（稳健方案，goal-runner 自持闭环校验）：
  1. fresh PASS summary 后，goal-runner 主动调用 `harness-runner --sync-closure`（复用 [phase-state.ts](harness/scripts/utils/phase-state.ts) 的 `runSyncClosure` → check-receipt），读回 `closure_status`/`receipt_status`。
  2. 扩展 `SummaryJson` 接口 + `readPhaseSummary` 解析新增 `closure_status`/`receipt_status`；`resolvePhaseHarnessVerdict` 增 `closureStatus`/`receiptStatus`/`agentTimedOut` 入参。PASS 仅当 `closure_status==='closed'`（对 `phases_disabled`/global phase 不适用 receipt 时维持原行为）才 advance；PASS 但 `closure_status==='open'`（receipt missing/failed）或 `agentTimedOut` → 不 advance，按 retry 处理，预算耗尽则 halt。
  3. `resolveGoalRunStatus`：带 `agent_timed_out` 且未闭环的 phase → 至少 PARTIAL/HALTED，绝不 COMPLETED。与既有 `detectHalfCompletedPhaseRecovery`（已要求 receipt closed）保持一致。

#### 与本地 headless guard 合流（实施约束，避免 halt 互相覆盖）

- **位置**：closure/timeout gate 作为**追加的 halt override**，插在 verdict 区块**现有 `interactionSentinel` 与 `shouldHaltNoProgress` 两个 override 之后**（约 L1117-1132），仅当二者**未**已置 halt 时才生效——不得覆盖既有 `headless_interaction_required` / `no_progress_guard` 语义。
- **复用 halt_reason 通道**：沿用 `phase_verdict` 事件与 [goal-report-generator.ts](harness/scripts/utils/goal-report-generator.ts) `GoalPhaseOutcome.halt_reason`（已存在），新增取值如 `closure_open` / `receipt_missing` / `agent_timeout_unclosed`，使 goal-report 清晰区分多种 halt，而非新造 halt 体系。
- **机制取舍（确定走 resolvePhaseHarnessVerdict 直接判不 advance）**：本 plan **不新增** closure/receipt 类 BLOCKER id，闭环门控走 `resolvePhaseHarnessVerdict` + verdict 区块 override 直接判不 advance；因此**无需**改动 [goal-failure-classifier.ts](harness/scripts/utils/goal-failure-classifier.ts) 的 `DETERMINISTIC_GATE_BLOCKER_IDS`（该清单仅供 no-progress guard 识别确定性 blocker，与本门控正交）。
- **测试合流**：新增单测与既有 [goal-headless-guard.unit.test.ts](harness/tests/unit/goal-headless-guard.unit.test.ts) 同挂 `harness/tests/run-unit.ts`，须共存不冲突（同一 fixture 下 `headless_interaction_required` 优先级高于 `closure_open`）。

### 点5 — 新增 ArkUI 静态规则（coding 阶段拦截）

- 现状：`coding.lint: arkts_lint` 在 [profiles/hmos-app/profile.yaml](profiles/hmos-app/profile.yaml) 已声明但**未实现 provider**；仅有正则 analyzer + hvigor 编译。
- 在 [coding-rules.overlay.yaml](profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml) 新增规则 id，并在 [coding-host-rules.ts](profiles/hmos-app/harness/coding-host-rules.ts) 用正则行扫描实现（沿用 [ast-analyzer.ts](profiles/hmos-app/harness/ast-analyzer.ts) 套路）：
  - `arkui_bindsheet_double_close`（**BLOCKER**）：`bindSheet(` 的 builder 内出现自定义 `sys.symbol.xmark`/自绘关闭按钮，但 options 未显式 `showClose: false`。
  - `arkui_push_without_guard`（MAJOR）：`onChange`/`@Watch`/`syncFromFlow` 回调内直接 `pushPath(`/`pushPathByName(` 且无一次性消费 guard（消费后置位/清标志）。
  - `arkui_singleton_flow_multi_subscriber`（MAJOR）：多个 `NavDestination`/组件订阅同一 singleton Flow 且对同一 `showXSheet` 触发 Sheet。
- 误报缓解：限定 diff/变更文件范围，给出明确 suggestion 与豁免注释约定（如 `// arkui-lint:allow <rule>`）。

### 点6 — device-testing 覆盖 UI 入口分支（非仅 happy path）

- 现状：testing 覆盖以 [acceptance.yaml](doc) `device_focus` 为 SSOT；脚本层无「同一业务多 UI 入口各测一次」规则。`ui_bindings` 仅驱动 coding 命名/UT branch。
- 改：在 check-testing 新增 `ui_entry_coverage`：从 `use-cases.yaml > ui_bindings` 构建 `calls(业务符号) → ui 入口集合`；对入口数 >1 的业务调用（如 `flow.selectBank` 有 `BankCardAddPage` 与 `AllBanksPage` 两处入口）：
  - **校验对象 = 派生 Hylyre 计划实际覆盖**（`testing/reports/<ts>/hylyre/test-plan.hylyre.md` 的派生用例/步骤），而非仅顶层 test-plan.md 文本提及。即每个 UI 入口都须有对应的派生 Hylyre 用例/步骤，真实执行一次该业务路径（如各跑一次 `flow.selectBank`）。
  - **严重度分级**：业务调用关联 **P0** 入口且缺任一入口的派生覆盖 → **BLOCKER FAIL**；非 P0 多入口缺覆盖 → MAJOR。
  - **入口↔派生用例映射（结构化优先，杜绝脆弱文本匹配）**：主路径用派生用例的**结构化字段** `linked_flow` + `entry_ui` + `calls` 精确匹配（`entry_ui` 为本 plan 在派生计划 schema 中**新增**的入口标识字段，取自 `ui_bindings[].ui`）。派生侧（device-testing SKILL + `test-plan-derive-hint.ts`/`derived-hylyre-plan.ts`）须为每个多入口业务调用的每个入口各产一条带 `entry_ui` 的派生用例并据此填字段。
  - **文本匹配仅作降级兜底**：当派生用例缺结构化字段时，回退按入口 UI 名称在派生步骤 `selector`/页面锚点文本匹配，但**降级为 WARN 提示「派生计划未携带 entry_ui，建议补结构化字段」**，不以脆弱文本匹配直接判 P0 BLOCKER（避免误报/漏报）。
- 同步在 verify-testing.md 增加语义检查项「多 UI 入口覆盖」，并在 [device-testing SKILL](skills/feature/device-testing/SKILL.md) 派生步骤补充「按 ui_bindings 入口枚举、每入口各派生一条 Hylyre 用例」的指引。

### 点7 — visual 回环 pending 阻断 + overlay 纳入截图目标

- 现状：[visual-diff-check.ts](profiles/hmos-app/harness/visual-diff-check.ts) L378-393 全屏 pending 仅 MAJOR WARN；`can_claim_done`（check-testing L2099）只计 BLOCKER FAIL/SKIP；overlay 默认不进自动截图（[visual-diff-capture.ts](profiles/hmos-app/harness/visual-diff-capture.ts) L110-115 仅取 P0 非 lightweight 顶层屏）。
- 改：
  1. visual_diff：当 spec UI change=`new_or_changed` 且存在 P0 非 lightweight 目标但有效屏全 pending → 升 **BLOCKER FAIL**（自动令 can_claim_done=NO），suggestion 提示完成 VL/导航 overlay 后重采。设备降级/无设备仍 SKIP（`HARNESS_VISUAL_DIFF_DEGRADED`/`HARNESS_SKIP_HVIGOR`）。
  2. 采集侧：把 P0 的 Sheet/Dialog `overlay_panel` 纳入 visual target——允许 device-testing 导航到 overlay 后补 shot，并在 visual-diff.json 标注 overlay 屏，避免「双 X」这类 overlay 缺陷天然漏检。

## 规约与文档同步

- [specs/phase-rules/testing-rules.yaml](specs/phase-rules/testing-rules.yaml)：登记新 check id（`report_trace_reconciliation` BLOCKER、`ui_entry_coverage` P0→BLOCKER/非 P0→MAJOR）及 device_test_run/visual_diff 严重度语义更新。
- [coding-rules.overlay.yaml](profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml)：登记三条 ArkUI 规则。
- 更新 verify-testing.md / device-testing SKILL / 相关 runbook。

## 验收（BLOCKER）

- 新增/更新 harness 单测：device_test_run partial→FAIL、report↔trace 对账、goal-runner closure 门控（PASS+open→不 advance / timeout→非 COMPLETED）、三条 ArkUI 规则、ui_entry_coverage、visual pending→BLOCKER。
- **核心复现 fixture（必加，端到端串联点1/2/4）**：构造一组测试输入 = Hylyre `trace.outcome=partial`（含失败 TC）+ 顶层 test-report.md 写成 `outcome=success`/全通过/达标 + summary.json `verdict=PASS, receipt_status=missing, closure_status=open`。断言：
  - `device_test_run` 判 **BLOCKER FAIL**（点1）；
  - `report_trace_reconciliation` 判 **BLOCKER FAIL**（点2，且证据来自 hylyre/ 子目录 trace 而非顶层回填 trace）；
  - `testing_run_status.can_claim_done=NO`；
  - goal-runner 该 phase **不 advance**，最终 goal status **不得 COMPLETED**（点4）。
- 另加 fixture：`flow.selectBank` 两入口仅派生覆盖其一 → `ui_entry_coverage` 判 **BLOCKER FAIL**（点6 P0）。
- `cd harness && npm test` 全 PASS。
- 用 bc-openCard 案例复跑验证：partial trace 不再 PASS、goal-report 不再 COMPLETED、双 X 与重复拉起在 coding 阶段被规则命中、两个银行入口各跑一次 `flow.selectBank`。
- 不改 `package.json.version`（保持 2.4.0）；不触碰发布门禁顺延/bump。