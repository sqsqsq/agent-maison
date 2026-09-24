---
name: best_effort 下 must_fix 升级与回退（宿主开卡回灌）
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g8-real-host-development-and-governance
relation: core
layer: change-unit
goal_requires: []
goal_provides:
  - best-effort-visual-residual-tiering
real_host_validation: >
  宿主 bc-openCard-2/open-card-flow-v2（acceptance_strictness=best_effort、effective=pixel_1to1）下一次 testing
  出现执行者自报的局部样式差（形如 i11 的 tonal 关闭按钮：warn + must_fix + 自报 major shape_mismatch）时：
  script-report 的 visual_diff 仍 WARN，structured 带 downgraded_screens 且 channel_evidence_usable=true；
  details 有「按档位降级」行；visual-debt.json 逐屏开 debt:visual_diff:<screen>；events 无
  reason=repair_candidates 的 phase_backtrack_requested；summary 的 visual 轴 UNVERIFIED、
  completion=FUNCTIONALLY_COMPLETE_VISUAL_PENDING、release=BLOCKED。
parallel_authority_added: false
overview: >
  宿主 run 20260920T100035Z-f829b8 的 testing i11：执行者把两处「关闭按钮应为 tonal 圆底」写成 warn + must_fix +
  major shape_mismatch，在 best_effort 档下照样把整轮视觉证据判死（3 条 testing BLOCKER）并回退 coding 重跑
  review/ut。根因：must_fix 与 defect severity 的消费点都不看严格度档位，而 best_effort 的承诺（「质量缺口记视觉
  债务、不硬阻断」）既没传到 testing 执行者，也没在机器侧兑现。本 plan 用一个判定函数把「soft 档下自报的非
  blocker 残差」从一档降到债务，消费点复用既有通道。不写代码，待 review。
todos:
  - id: ber-gate
    content: 按 §4.1–§4.4 落判定函数、gate 披露与 payload 字段、证据资格、债务账本、runtime 候选跳过；补 §5 T1–T7。
    status: completed
  - id: ber-text
    content: 按 §4.5 改 prompt / skill 措辞与 §4.6 规格；验证与实施记录按 §7 / §9。
    status: completed
---

# best_effort 下 must_fix 升级与回退（宿主开卡回灌）

> 需求输入：调度者任务（codex 警告：技术死锁修好后，低影响偏差仍会让 testing 反复回退 coding）；用户 09-21 裁决
> 见 [判定分级](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §1.1；本题在
> [视觉账本自检行收养](视觉账本自检行收养_宿主开卡回灌_6279fcd7.plan.md) §4b 已建议单列。代码基线：main 7753c18f。

## 1. 现场证据（只读）

- **must_fix 原文**（`device-testing/device-screenshots/visual-diff.json:37`、`:94`）：「cts_close（CardTypeSheet.ets:64-69）改为 tonal 圆形按钮：约 40vp 正圆浅灰底……当前真机为无底的裸 ×，与 ui-spec.yaml:16 variant: tonal 不符」；sms_close 同形（ui-spec 未声明 variant，note 写「pixel_1to1 以参考图为准」）。两屏 `verdict: warn`。
- **谁写的**：testing 执行者手写（i11 的 `phase_verdict.agent_stderr_excerpt`：「已写入 visual-diff.json must_fix（两屏 verdict=warn，defect shape_mismatch/major）」；文件 mtime 04:13:25Z 在 i11 窗口内，见 6279fcd7 §4b）。不是 harness 规则生成。
- **defects**：`:40` / `:97` 各一条 `class: shape_mismatch, severity: major, must_fix_refs: [0]`，**无 `source` 字段**（非 T8 转录）；cts 屏另 4 条 minor（协议色、文案、按钮宽、logo）。`region_attest` 该区域 `diff_logged / vl_screening / codex-native`。
- **gate 结果**（`testing/reports/script-report.json:797-826`）：`visual_diff` `MAJOR/WARN`；`structured.channel_evidence_usable=false`、`evidence_block_owner=coding`——整轮视觉证据的**消费资格被否决**（不是逐屏 `evaluation_invalidated`）。
- **传播**（`goal-runs/.../events.jsonl`）：`:362` `phase_verdict FAIL`，`blocker_signature=negative_verdict_closure|p0_coverage_integrity|p0_semantic_coverage_integrity|testing_channel_evidence_obligation|testing_run_status`；`:363` `phase_backtrack_requested reason=repair_candidates invalidated_phases=[coding,review,ut]`，两个候选正是这两条 major。
- **有效档位取值链**（`fidelity_target` 与 strictness 是两根独立轴）：
  1. `spec/spec.md:32` `fidelity_target: pixel_1to1` 只是 SSOT 的**投影**（`check-spec.ts:255-266` 失配即 BLOCKER）。
  2. SSOT `spec/reports/fidelity-intent.json`：`inferred/selected/effective=pixel_1to1`、`clamped=false`、`acceptance_strictness=best_effort`。strictness 由 `detectAcceptanceStrictness`（`fidelity-shared.ts:256-266`）从需求文本求得——需求有 1:1 强措辞但无「必须/不接受降级」类 hard 措辞；路由见 `resolveFidelityRoutingDecision`（`:739-779`）。
  3. canary 钳制：`capability-snapshot.json` `vision.verdict=true (probe:tool_read)`、`vision_mode=native` → 不钳。
  4. harness 上下文：`resolveHarnessFidelityContextFields`（`harness-runner.ts:263-335`）→ `fidelityTarget=pixel_1to1`（`:293-320`）、`acceptanceStrictness=SSOT ?? best_effort`（`:326`）。
  5. 裁决谓词：`isHardPixelContract`（`fidelity-shared.ts:682-684`）= effective pixel ∧ hard → **false**；`isPixelExecutionTarget`（`:677`）→ true（只管采集/提取）。`fidelityRatchetFailOrWarn`（`:1052-1062`）在 `visual-diff-check.ts` 各处被 `pixel1to1 ? ratchet : {MAJOR, WARN}` 包住（`pixel1to1` 即 `:1489` 的 `isHardPixelContract`，变量名有误导）→ 本现场 must_fix / `blockingDefectPass` / placement 等**走该包装的命中**为 MAJOR/WARN；跨档位的命中不受影响（如 `evaluation_invalidated` 恒 BLOCKER/FAIL，`:1631-1649`；tamper 恒 BLOCKER）。

## 2. 机制现状：must_fix / severity 的消费点

| 消费点 | 当前语义 | hard 档应当 | soft 档（非 hard）应当 |
|---|---|---|---|
| gate hit：must_fix / fail 屏（`visual-diff-check.ts:2586-2596`）、pass 屏 blocker/major（`blockingDefectPass` `:1459-1461` → hit `:2444-2458`） | 按档位：hard BLOCKER/FAIL，soft MAJOR/WARN | 不变 | 不变（仍 WARN），但区分出「按档位降级」的屏并在 details 披露 |
| `channel_evidence_usable`（`:2979-2987`，e7a2c4f1 §3.1） | `productTruthIntact` = 无 fail / must_fix ∧ `blockingDefectPass` 空 ∧ 无 placement fail_signals —— **不看档位** | 不变 | 自报非 blocker 残差不否决；fail、blocker、确定性信号仍否决 |
| 逐屏证据资格（`execution-channel-evidence.ts:276`） | 只认 `verdict === 'pass'` | 不变 | 降级屏的 `warn` 也算可用（结论照旧由 debt 披露） |
| 候选路由（`goal-phase-runtime.ts:2373-2463` `collectActionableDefects`） | warn/fail ∧ must_fix 非空 → 每条非 minor defect 一个候选（B07 D1 只跳 minor）—— **不看档位** | 不变 | 降级屏整屏不产候选 |
| 回退判定（`:8373-8393` → assess → `:363` 型事件） | 有候选即 `repair_candidates` 回退，失效后缀按 `resolveInvalidatablePhases` | 不变 | 无候选即不回退（失效范围算法不动） |
| 视觉债务（`visual-debt.ts:155-210`） | 只 FAIL 或非 MINOR SKIP 开账（`:163-167`）；PASS/WARN 关账（a3f7c1d9 D3(b)） | 不变 | 降级屏必须入账（兑现 prompt 已有承诺「recorded as visual debt」；与 D3(e)「缺陷入账、披露用 WARN」同义） |
| prompt / skill | capability 块 `goal-phase-runtime.ts:1449` 说 best_effort「do NOT hard-block」，但 `resolvePhaseCapabilityAdvisory` `:2819` 只给 spec/plan/coding，**testing 看不到**；testing 重试指引 `:1944` 末句「缺 by_id 记 must_fix」、`:1945`「任何非空 must_fix 都会回退 coding」；skill `device-testing-workflow-detail.md:63` 「G3 样式/布局不符进 must_fix」、`:74` 把「P0 warn 必须带 must_fix」写成 pixel_1to1 语义（门禁实际只在 hard 生效，`visual-diff-check.ts:1656`） | 不变 | 措辞与机器同口径（§4.5） |

另：已核实与本题无关、不动的消费点——`hasActionableVisualResidual`（`:824-837`，只喂熔断，熔断 BLOCKER 只在 hard，`:2891`）；t2 must_fix 锚定门（`:2711`，hard 才跑）；T4 warn 无 must_fix（`:1656`，hard 才跑）。

**与既有原则的一致性**：`phase-transition-policy.ts:41-44`（d8c5f3a7 T4）规定「确定性 P0 缺陷触发回修与 strictness 解耦」——本 plan 只降**自报**残差，确定性信号（T8 转录、placement fail_signals、T1、render_visibility、TC 断言）一律不受档位影响，与之不冲突。

## 3. 判定

**问题**：best_effort 下局部样式差是 defect（披露 + 债务）还是 must_fix（一档回退）？
**答**：是 defect。must_fix 只是「回修指令」的载体，它的档位取决于它所指的事实：按 e7a2c4f1 §1.1 一句话判别（放过它用户会不会拿到坏产品），关闭按钮缺 tonal 底色不影响核心操作、结果、关键信息可读——属质量残差。

**规则**（本文「hard 档」一律指**硬像素契约** `effective=pixel_1to1 ∧ acceptance_strictness=hard`，谓词 `isHardPixelContract` `fidelity-shared.ts:682`；「soft 档」= 其否定，含 best_effort 任意目标与 hard 的非 pixel 目标；hard 档一字不改）：一个屏是「按档位降级的残差屏」当且仅当同时满足——

1. `verdict ∈ {pass, warn}`（`fail` 是执行者显式声明的产品失败，保持一档）；
2. 无 `severity: blocker` 的 defect；无**确定性来源**的 major defect（`t8FindingIdOf(d.source)` 非空，`visual-diff-check.ts:117`）；
3. 每条 `must_fix[i]` 都被至少一条 defect 以 `must_fix_refs` 引用（**未锚定的纯文本 must_fix 不降级**，因为它没有 severity 可读，保守留一档）；
4. 至少一条**自报 major** defect（无 T8 来源）。纯 minor 屏（含 T8 minor、must_fix 全锚定）**不入降级、不开阻断债务**，照旧走 B07 D1 minor 规则（`goal-runner/spec.md:899-903`：零候选、WARN 披露、不留阻断债务）。

降级对象因此精确为：**含至少一条自报 major、无 blocker、无 T8 源 major、must_fix 全锚定的 pass / warn 屏**；该屏上并存的 minor 随屏入账（屏级 scope），不单独开账。

由此：执行者 / VL（含 `visual_provider`）自报的 major 样式差 → 披露 + 债务、不回退；**缺 `by_id` 锚点仍是一档**——它是可测性缺陷，写成 blocker defect 或未锚定 must_fix 都不满足条件 2/3；`verdict=fail`、T8 转录的 major、placement fail_signals、T1 / render_visibility / TC 断言都不走这条规则。severity 仍是 `{blocker, major, minor}` 既有枚举，只补一行定义（§4.5），不新造分级表。

## 4. 修法（最小、复用既有通道）

### 4.1 判定函数与 gate（`profiles/hmos-app/harness/visual-diff-check.ts`）

- 新增导出纯函数 `isTierDowngradedResidual(screen, hardPixel): boolean`，实现 §3 四条；这是**唯一**判定点，其余消费者只读它的物化结果。
- `checkVisualDiffCore` 内算 `downgraded = rep.screens.filter(s => isTierDowngradedResidual(s, pixel1to1))`：
  - `productTruthIntact`（`:2979-2982`）第一合取项与 `blockingDefectPass` 都排除 `downgraded` 中的屏；placement fail 项不动。`evidence_block_owner` 随之自然变化。
  - must_fix hit（`:2586`）与 `blockingDefectPass` hit（`:2444`）的屏清单剔除降级屏；降级屏另写一行进**同一 `visual_diff` hit**（MAJOR/WARN，档位与现在相同）：「【按档位降级（acceptance_strictness=best_effort）】以下屏的 must_fix / major 缺陷为自报样式残差，记视觉债务、不驱动回退：<screen>(<class@element>…)」。不加 check id。
  - `VisualDiffStructuredPayload`（`:854`）加 `downgraded_screens: string[]`，与 `placement_verified_screens` 同一条落盘通道（进程内 → `script-report.json`，不回写 `visual-diff.json`）。

### 4.2 证据资格（`harness/scripts/utils/execution-channel-evidence.ts`）

`loadVisualScreenVerdicts` 逐屏：`usable = verdict === 'pass' || (verdict === 'warn' && downgraded.has(id))`，`downgraded` 取自已传入的 `opts.visualGate.structured.downgraded_screens`（缺字段 = 空集 = 现状）。新鲜度 / hash / invalidated 复核顺序不变。`visualGateAllowsEvidence` 不动。

### 4.3 债务账本（`harness/scripts/utils/visual-debt.ts`）

**窄例外，只对降级屏**：四态规则（FAIL / 非 MINOR SKIP 开账，PASS / WARN 关账，全 MINOR SKIP / 缺席保留）对其余一切来源与其余 WARN 原样不变。`deriveVisualDebt` 对 `visual_diff`：本轮该 check 的 `structured.downgraded_screens` 非空时，仅为这些屏开账——`scopesOf` 为这些屏产出 `debt:visual_diff:<screen>`（summary 追加「（屏 X，按档位降级的自报残差）」）；若同时有 FAIL / 非 MINOR SKIP，再保留既有 check 级 `debt:visual_diff`。下一轮该屏不再降级（修好或已无残差）→ 走既有「历史 scope 本轮不再命中即 closed」。aggregate 状态仍 WARN，所以 §4.2 的证据资格不受影响；债务压 testing visual 轴 → release BLOCKED 走既有 `applyVisualDebtPipeline`（`harness-runner.ts:1914-1927`）。

### 4.4 runtime 候选（`harness/scripts/goal-phase-runtime.ts`）

`collectActionableDefects` 增加可选入参 `downgradedVisualScreens?: ReadonlySet<string>`；在 `:2375`（must_fix 非空之后、身份校验之前）命中即 `continue`，并照 `:2462` 的 minor 日志打一行「按档位降级，不产回修候选」。调用点 `:8375` 从**本次 fresh** `script-report.json` 的 `visual_diff.structured.downgraded_screens` 取值——读法照搬 `:9334-9336`（同样以 `freshSummary && summaryAbsPath` 为前提）；不 fresh / 缺字段 → 空集 → 现状行为（多回退，不假 PASS）。runtime **不自己推导档位**，只消费 gate 的物化结论。

### 4.5 prompt 与 skill 措辞（原位改句，不加段）

- `goal-phase-runtime.ts:1449`：best_effort 行改为「自报的样式/布局残差写成 defects（major/minor）并记视觉债务：不阻断阶段推进、不驱动回退，但**仍阻断发布**直到修复重验；fail、blocker、确定性信号、缺测试锚点仍回 coding」。
- `:1944` 末句：缺 `by_id` 锚点「记为 severity=blocker 的 defect 并以 must_fix 锚定」；`:1945`：改为「硬像素契约（pixel_1to1 ∧ hard）：任何非空 must_fix 回退；否则（strictness 见 spec/reports/fidelity-intent.json）：只有 fail、blocker、确定性信号与**未被 defect 锚定的 must_fix** 回退，其余由 gate 按档位降级记债务——不阻断推进、仍阻断发布」。testing 不注入 capability 块（见 §6 不做）。
- `skills/reference/device-testing-workflow-detail.md:63` G3 句尾补「best_effort 下不符记 defects（major/minor）、不写 must_fix」，并补 severity 一行定义：blocker = 核心操作走不通 / 结果错 / 关键信息缺失或不可读 / 截错屏 / 缺测试锚点；major = 明显偏离参考但不影响前述；minor = 细微残差。`:74`「P0 pixel_1to1 warn 屏必须带 must_fix」限定为「硬像素契约（pixel_1to1 ∧ hard）」。`skills/feature/device-testing/SKILL.md:67` 同步半句。先量行数，文档行数预算是硬门禁。

### 4.6 规格同步

被本方案直接改写的条款全部列出（其余 WARN 仍按原四态，`downgraded_screens` 只写成窄例外）：

| 位置 | 现文 | 改为 |
|---|---|---|
| `openspec/specs/visual-diff/spec.md:8`、Scenario `:12-15` | pass + blocker/major：pixel_1to1 → FAIL，else WARN | 补 soft 档降级规则（§3 四条）；新增 Scenario：soft 自报 major → WARN + `downgraded_screens` + 入账；T8 源 major / blocker / fail 仍否决证据 |
| `openspec/specs/visual-diff/spec.md:532`（Requirement「Visual debt settles by structured kind…」） | PASS/WARN 关闭全部历史条目；WARN 不是债务、MUST NOT block release | 加一句窄例外：`visual_diff` 的 `structured.downgraded_screens` 所列屏逐屏开 `debt:visual_diff:<screen>` 并阻断发布；其余 WARN 规则不变；补 Scenario「降级屏 WARN 开账，同轮非降级屏的历史条目照旧按 WARN 关账」 |
| `openspec/specs/feature-artifact-layout/spec.md:288` 与 Scenario `:298-302` | `closed` = PASS 或 WARN | 同一窄例外半句；`:298` Scenario 补「除非该屏列于 downgraded_screens」 |
| `openspec/specs/goal-runner/spec.md:885`（Requirement「Visual signals are adjudicated…」第二段） | major/blocker「materialize exactly as before」 | 限定为硬像素契约或确定性来源 / blocker；soft 档降级屏零候选、记一行日志 |
| `openspec/specs/goal-runner/spec.md:905-908` Scenario | a major defect still materializes unchanged | 限定前提（T8 源 major）；新增 Scenario：soft 档自报 major 的降级屏零候选、不回退 |
| `openspec/specs/goal-runner/spec.md:883`（同一 Requirement 第一段） | 通过校验的 delegated provider 载荷走既有 provider 路径**直接物化**候选 | 加窄例外：soft 档下 provider 自报的 major 若使该屏落入降级集，同样不物化；provider 的 blocker 照旧物化 |
| `openspec/specs/visual-diff/spec.md:417`（Requirement「Critic loop replaces single-round…」） | critic 出 must_fix → coding 修 → 重判，直到 pass（无 open major、must_fix 空） | 加窄例外：soft 档降级屏的 must_fix 不进自动回修环，以债务承载；「machine-verified pass」措辞不变（降级屏不是 pass 结论，visual 轴保持 UNVERIFIED） |
| `openspec/specs/visual-diff/spec.md:534`（defect 用 FAIL、disclosure 用 WARN） | 缺陷类来源须报 MAJOR FAIL | 加窄例外：`visual_diff` 降级屏是缺陷但 aggregate 保持 WARN（FAIL 会让证据资格拒收），入账由 `downgraded_screens` 承担；其余来源不变 |
| `openspec/specs/visual-diff/spec.md:547-549` Scenario | WARN hit 关闭该来源条目 | 补「`downgraded_screens` 所列屏的条目除外」；其余 WARN 关账不变 |
- e7a2c4f1 §1.1 表「视觉逐屏 fail 或 must_fix」为一档——在本 plan 实施记录与 e7a2c4f1 §10 各记一句「soft 档由本 plan 细化」，不改其正文判据。

## 5. 反例与测试

- **T1 hard 不变**（`visual-fidelity`）：pixel_1to1 + hard，i11 两屏同形 → `downgraded_screens=[]`、`channel_evidence_usable=false`；`collectActionableDefects` 两个候选（`device-test-backtrack` 或 `goal-runner-repair-convergence`）。
- **T2 soft 主正例（宿主形态）**：pixel_1to1 + best_effort，夹具取 i11 两屏原样（含 minor 与 `vl_screening` attest）→ `downgraded_screens` 两屏、`channel_evidence_usable=true`、details 含「按档位降级」；`deriveVisualDebt` 开 2 条 `debt:visual_diff:<screen>`；`loadVisualScreenVerdicts` 两 warn 屏 usable；传入降级集后零候选。runtime 链（`goal-runner-testing-integrity`）：无 `phase_backtrack_requested`、visual 轴 UNVERIFIED、release BLOCKED。**实施注**：该文件 helper 的默认 harness 桩（`:554`、`:702` 一带）会自造 summary / report，必须让 script-report 由真实 gate 写出、债务由真实 `applyVisualDebtPipeline` 投影、runtime 读的是这份真实报告——不得用默认桩覆盖，否则验不到 §4.4 接线。
- **T3 缺锚点仍一档**：soft，(a) 未锚定纯文本 must_fix「缺 by_id 锚点 X」；(b) blocker defect 锚定 → 两者都不降级、证据拒、产候选。
- **T4 确定性仍一档**：soft，带合法 T8 来源对象的 major（`source: {producer:'T8', finding_id:<非空>, signal:<非空>}`，形状见 schema `visual-diff-check.ts:566-569`，否则先撞 schema 错误验不到本条） → 不降级、拒、产候选；placement fail_signals 沿用 P3-T2b②。
- **T5 fail 仍一档**：soft，`verdict=fail` 且只有自报 major → 不降级、拒、产候选。
- **T5b 纯 minor 不入降级**：复用 B07 夹具（`device-test-backtrack.unit.test.ts:715` 的 `t8(...)` 默认 minor + 全锚定 must_fix），soft 档 → `downgraded_screens` 不含该屏、`deriveVisualDebt` 不为其开阻断条目、零候选（`goal-runner/spec.md:899-903` 原样成立）；同屏再加一条自报 major → 进入降级并开账。
- **T6 改判 e7a2c4f1 P3-T2b①**（`visual-fidelity.unit.test.ts:4125-4135`，原断言 `channel_evidence_usable === false` 即拒绝证据）：soft pass 屏 + 自报 major → 可用 + 入账；soft pass 屏 + blocker → 仍拒；同夹具 hard → 仍拒。用例名与注释写明改判理由指向本 plan §3。
- **T7 假 PASS 锚**：P3-T5 三向量（`explicit_skip` 洗白 / `semantic_layout` 自声明降档 / `*_FAST_PATH`）原样重跑须仍拒；T2 结束态断言 visual 轴**不是 PASS**、completion 为 `FUNCTIONALLY_COMPLETE_VISUAL_PENDING`。
- **变异**（单变量，验完还原）：去掉 `hardPixel` 守卫 → T1 红；去掉 T8 源条件 → T4 红；去掉条件 3 → T3a 红；§4.2 不读降级集 → T2 证据断言红；§4.3 分支删掉 → T2 债务断言红。

## 6. 保留 / 裁剪 / 不做

- **保留**：hard 档全部判据与回退；`verdict=fail`、blocker、T8 转录、placement fail_signals、T1、render_visibility、TC 断言的一档地位；B07 D1 minor 不产候选；`visualGateAllowsEvidence` 状态规则；`resolveInvalidatablePhases`；熔断只在 hard 裁决；债务四态规则本身。
- **裁剪**：soft 档下自报非 blocker 残差的三项资格——否决证据、产回退候选、以 WARN 关账逃出债务。
- **不做**：新 check id / 分级表 / severity 映射配置；把残差 hit 改 MAJOR FAIL 入账（aggregate 会变 FAIL，`visualGateAllowsEvidence` 随即拒证据，重新制造 BLOCKER）；runtime 自行重算档位（第二条推导路径）；把 capability 块扩到 testing（牵动 `buildUnattendedExecutionBlock` 与 closure 块的 advisory 分支）；纯 minor + 全锚定 must_fix 的 warn 屏在 soft 档仍否决证据（must_fix 非空）却零候选的既有缺口（B07 宿主 i13 形态，沿既有 minor 规则，本 plan 不改）；「pass + blocker 屏否决证据却不产候选」的既有缺口（hard 档同样存在，另议）；soft 档 T8 hard 未转录只 WARN 的既有边界。

## 7. 验证与提交划分

- 迭代：`npm run typecheck`；`cd harness && npm run test:unit -- --filter visual-fidelity`、`execution-channel-evidence`、`visual-debt`、`device-test-backtrack`、`goal-runner-repair-convergence`、`goal-runner-testing-integrity`、`testing-trace-gates`；完整输出先写日志再 grep。`npm run openspec:validate`。
- 收口一次：`cd harness && npm test`；`node scripts/check-plan-version.mjs`；`git diff --check`；node 扫行尾 LF。
- 提交一笔（判定、四个消费点、措辞、规格、测试同笔；拆开会有「证据可用但仍回退」或「不回退但不入账」的中间态）。不打包、不改宿主。

## 8. 风险（重点：假 PASS 回潮）

- **与 3.0.0 事故链的区别**：`semantic_layout` 自声明是**执行者可写的档位声明**绕过了**确定性**硬门禁。本 plan 的开关是 strictness，来自需求文本、落在 spec-owned 的 SSOT（`goal-preflight.ts:687` 被 spec closure 冻结，testing 期改动即上游漂移），执行者改不了；被降级的只有**执行者自己报出的** major 条目——它本来就可以不报（写 pass + 空 defects），降级没有给它新的放行能力；确定性信号全部不经本规则。降级结果不是 PASS：债务开账、visual 轴 UNVERIFIED、release BLOCKED、test-report 须按 `visual_debt_disclosure` 披露。T7 锁这条。
- **少报严重度**：真正影响关键信息的缺陷（如 a70eb7 i8「的验证码。」被截出屏外）若被自报成 major 会只进债务。soft 档可用的兜底只有跨档位的确定性通道：placement fail_signals（`:1764` 起，不受档位守卫）、TC 断言、render_visibility；**T1 锚点文本缺失不算**——它受硬像素谓词守卫（`visual-diff-check.ts:1706` `if (pixel1to1 && uiDoc)`），best_effort 下根本不跑。另加 §4.5 的 severity 定义。a70eb7 i8 同屏有 T8 转录的顺序颠倒，整屏不降级，回放仍回退（与 e7a2c4f1 P3-T15 一致）。**放弃的准确性**：best_effort 特性不再由 loop 自动修 major 样式差，只记债务；要自动修，需求须写出 hard 措辞。
- **反向改判 e7a2c4f1 P3-T2b①**：旧用例断言的是「拒绝证据」（`visual-fidelity.unit.test.ts:4131-4135`），由 codex review 以「已知 major 缺陷 + 屏 pass 被绑成 covered」为由加入。本 plan 降级的对象精确为 §3 条件 4 下的那句定义（至少一条自报 major、无 blocker、无 T8 源 major、must_fix 全锚定的 pass / warn 屏；纯 minor 屏不在内）：它的证据可被绑定消费，但同时入账阻断 release——「证据可用」不再等于「视觉已验证」。codex 第一轮已认可（D1）。
- **操作性出路**：降级残差留在债务里不影响阶段推进与功能完成；要清偿，可在后续 coding slice 修复后重跑受影响验收，该屏不再降级即按既有规则关账。债务清偿前不能发布；人工确认不能清债——legacy `accepted` 会被重新投影为 open（`visual-debt.ts:125-129`），新条目不接受 `accepted_by` / receipt。
- **runtime 读 script-report**：不 fresh 或缺字段时退回现状（多回退），方向安全；代价是 gate 与 runtime 在该情形下不一致（证据可用却仍回退）。

**设计裁决（codex 第一轮全部认可）**：D1 上条改判；D2 债务走「payload 字段 + reducer 分支」而非 FAIL（§6 理由）；D3 T8 转录的 major 在 soft 档留一档（纯按 severity 更简单，但会让 a70eb7 型确定性布局缺陷停止回修，违背 d8c5f3a7 T4）；D4 未锚定 must_fix 保守不降级（执行者写纯文本即可绕过降级，只会多回退）；D5 testing prompt 用静态双分支文字而非注入档位。

## 9. 实施记录

实施顺序：6279fcd7 收口 → 本 plan → 14771034 C3。

### 9.1 本轮实施（2026-09-24，基线 main 48673094，未 commit）

**生产**
- `profiles/hmos-app/harness/visual-diff-check.ts`：新增导出 `isTierDowngradedResidual(screen, hardPixel)`（§3 四条，唯一判定点）；`checkVisualDiffCore` 把 `pixel1to1` 上移到 `blockingDefectPass` 之前，算 `downgradedScreens`；`blockingDefectPass`、must_fix 命中行、`productTruthIntact` 第一合取项剔除降级屏；降级屏另写一行 `visual_diff` MAJOR/WARN「【按档位降级（fidelity=…、acceptance_strictness=…，非硬像素契约）】…<screen>(<class@element>…)」；`VisualDiffStructuredPayload.downgraded_screens` 随 `checks[].structured` 落盘。
- `harness/scripts/utils/execution-channel-evidence.ts`：`loadVisualScreenVerdicts` 逐屏 `usable = pass || (warn && downgraded.has(id))`，降级集取自 `opts.visualGate.structured.downgraded_screens`（缺字段=空集）。
- `harness/scripts/utils/visual-debt.ts`：`deriveVisualDebt` 对 `visual_diff` 读 kind 归集结果的 `downgraded_screens`，逐屏 `debt:visual_diff:<screen>`（summary 追加「按档位降级的自报残差」）；有 FAIL/非 MINOR SKIP 时保留 check 级条目；其余四态规则不动。
- `harness/scripts/goal-phase-runtime.ts`：`collectActionableDefects` 第 5 个可选入参 `downgradedVisualScreens`，在 must_fix 非空之后、身份校验之前命中即 `continue` + 一行日志；调用点经新增的私有 `readFreshDowngradedVisualScreens(freshSummary ? summaryAbsPath : null)` 从 fresh summary 同目录 `script-report.json` 读取（不 fresh / 缺文件 / 缺字段 / 解析失败=空集）。

**文案**：`goal-phase-runtime.ts` capability 块 best_effort 行、`VISUAL_GAP_RETRY_GUIDANCE_TESTING` 第 3 条末句与第 4 条（§4.5）；`skills/reference/device-testing-workflow-detail.md:63`（G3 句尾 + severity 定义内联在 severity 枚举后）、`:74`（限定硬像素契约）；`skills/feature/device-testing/SKILL.md:67` 半句。均原位改句，行数不变。

**规格**（直接改 `openspec/specs`，与 48673094 同一范式）：`visual-diff`（:8 Requirement 补降级规则 + 新 Scenario；:417 critic loop 窄例外；:532 债务窄例外，含「minor 不独立开账或延续债务」；:534 defect/disclosure 窄例外；:547-549 Scenario 补一句 + 新 Scenario「降级屏开账、其余历史照旧 WARN 关账、accepted 不能清债」）；`feature-artifact-layout`（:288 窄例外半句、:298 Scenario 限定）；`goal-runner`（:883 provider 窄例外、:885 限定 + 零候选一行日志、:905 Scenario 前提限定 T8 源 + 新 Scenario soft 零候选/不回退/hard 回退）。`visual-diff` 第一条 Requirement 的 Enforcement 补 `execution-channel-evidence.ts`、`visual-debt.ts`。

**测试映射**
- T1：`visual-fidelity`「6644ea45 T1 hard」+ `device-test-backtrack`「6644ea45 T1 hard」+ `goal-runner-testing-integrity`「6644ea45 T1 runtime hard」（需求 hard 措辞 → 冻结 SSOT hard → 不降级 → repair_candidates 回退）。
- T2：`visual-fidelity`「6644ea45 T2 soft」（gate / details / 债务 / 逐屏证据 + 去字段回到现状）+ `device-test-backtrack`「6644ea45 T2 soft」（零候选 + 逐屏日志）+ `goal-runner-testing-integrity`「6644ea45 T2/T7 runtime soft」（runChain 新增 `testingGateChecks` 选项：真实 `checkVisualDiff` 以生产 `resolveHarnessFidelityContextFields` 档位跑，结论原样写 `script-report.json`，再交真实 `writeRunSummaryBase`/`applyVisualDebtPipeline`；runtime 读这份报告）。
- T3/T4/T5：`visual-fidelity`「6644ea45 T3/T4/T5」（T3a 未锚定、T3b blocker 锚定、T4 合法 T8 源对象、T5 verdict=fail；同轮 sms 屏仍降级作对照）。
- T5b：`device-test-backtrack`「6644ea45 T5b」（B07 i13 夹具原样：不降级、零债务、零候选；加一条自报 major 才降级、开账、零候选；不传降级集=1 条候选）。
- T6：`visual-fidelity` P3-T2b 改判（用例名写明 6644ea45 T6）：soft pass+自报 major → 可用+降级+开账；同夹具 hard → 仍拒；soft pass+blocker → 仍拒。
- T7：P3-T5 原样重跑；runtime soft 用例断言 visual 轴 UNVERIFIED、release BLOCKED、completion FUNCTIONALLY_COMPLETE_VISUAL_PENDING。
- 债务 reducer：`visual-debt`「6644ea45 窄例外」（开账 / 同轮历史 WARN 关账 / 下一轮不再降级关账 / FAIL 并存 / legacy accepted 不能清债）。

**假 PASS 防线反例（§8）**
- 档位来自需求文本冻结：runtime「T1 runtime hard」——同一 visual-diff，只改需求措辞 → 生产 `resolveHarnessFidelityContextFields` 读到 hard → 不降级、repair_candidates 回退；soft 用例断言解析值为 pixel_1to1 + best_effort。
- 只降自报条目：T4（合法 T8 源 major 不降级）、T3c（blocker 与自报 major 并存不降级）、T5b（纯 minor 不降级）。
- 确定性信号不走此规则：T4；P3-T2b② placement fail_signals 原样仍拒。
- 降级后非 PASS：runtime soft 断言 visual 轴 UNVERIFIED、release BLOCKED、completion FUNCTIONALLY_COMPLETE_VISUAL_PENDING、`visual-debt.json` 逐屏 open；P3-T5 三向量原样通过。
- 人工确认不能清债：`visual-debt`「6644ea45 窄例外」legacy `accepted` 条目仍降级 → 重投影 open、`accepted_by` 被剥离。

**变异**（单变量，脚本改后即还原，`git diff` 与 grep 复核已还原）：M1 去 `hardPixel` 守卫 → visual-fidelity T1 + P3-T2b、device-test-backtrack T1 红；M2 去 T8 源条件 → T4 红；M3 去锚定条件 → T3a 红；M4 去 verdict 条件 → T5 红；M5 去 blocker 条件 → T3c 红；M6 条件 4 恒真 → T5b 红；M7 `productTruthIntact` 不剔降级屏 → T2 红；M8 `blockingDefectPass` 不剔 → P3-T2b 红；M9 must_fix 命中行不剔 → T2 红；M10 §4.2 不读降级集 → T2 证据断言红；M11 §4.3 分支失效 → visual-debt 窄例外 + T2 + P3-T2b 红；M12 runtime 跳过分支失效 → device-test-backtrack T2 + T5b 红；M13 调用点不读 fresh 报告 → runtime soft 用例红（79/1）。13/13 全红。

**验证**（完整输出先落 scratchpad 日志再 grep）
| 命令 | 结果 |
|---|---|
| `cd harness && npm run typecheck` | PASS |
| `--filter visual-fidelity` / `device-test-backtrack` / `visual-debt` / `execution-channel-evidence` / `goal-runner-repair-convergence` / `goal-runner-testing-integrity` / `testing-trace-gates` / `goal-headless-guard` | 144/0、25/0、35/0、21/0、27/0、80/0、32/0、133/0 |
| `npm run openspec:validate`（含 enforcement 路径） | 47/47 PASS，enforcement PASS |
| `cd harness && npm test`（收口一次） | unit **4758/0**，fixtures **46/0**，exit 0 |
| `npm run test:unit -- --release --filter real-chain` | real-chain 3/0、real-chain-seams 6/0 |
| `node scripts/check-plan-version.mjs` / `git diff --check` / node 扫 CR 字节 | PASS / 空 / 15 个改动文件 CR=0 |

**与 plan 的偏差（放弃的准确性）**
1. §4.4「读法照搬 :9334-9336」：抽成私有 `readFreshDowngradedVisualScreens` 并加 try/catch——解析失败按空集（现状，多回退），原写法会抛。放弃的准确性：无；报告损坏时不再中断 runtime，而是退回多回退。
2. §3 条件 2「`t8FindingIdOf` 非空」实现为 `!== undefined`（producer=T8 即算确定性，含 finding_id 为空的畸形源）。放弃的准确性：畸形 T8 源的 major 也留一档（只会多回退）。
3. §4.1 披露行文字：plan 写「acceptance_strictness=best_effort」，实现打印本轮实际 `fidelity=…、acceptance_strictness=…`（soft 档还含 hard 的非 pixel 目标，写死 best_effort 会说错）。
4. §4.5 severity 定义：plan 写「补一行」，实现内联到 `:63` 的 severity 枚举后（不增行，规避行数预算）；`:1449` 措辞按 codex 第三轮收窄为「带自报 major 的屏记债、仅 minor 只披露」。
5. §4.6 额外：`visual-diff` 第一条 Requirement 的 Enforcement 补两文件（该条款现在约束证据资格与债务两处消费点）。
6. §5 T2 runtime：runChain 新增测试选项 `testingGateChecks`；testing 报告只含真实 `visual_diff` 结论 + 一条假的 functional PASS（`test_plan_exists`，让 lattice 有功能轴执行事实）；OCR 桩为「能力缺失」，覆盖由 vl_screening region_attest 承担。放弃的准确性：没有跑真实 testing harness 的其余检查（设备/trace/报告类），只证明视觉通道 → 债务 → runtime 候选这条链。
7. §5 T1 额外加了 runtime hard 用例（plan 只列 visual-fidelity / device-test-backtrack），用于锁「档位来自需求文本冻结」。

### 9.2 codex code review 返修（2026-09-24，1 阻断 + 2 建议，均实读核实属实）

- **P1 同名屏互相豁免**：解析器接受重复 `screen_id`，原实现按记录判定、按 ID 豁免 → 同 ID「fail/blocker 记录 + 合格残差记录」时整个 ID 进降级集，fail 记录丢失证据否决、runtime 两条记录都跳过、回修候选丢失。修：gate 物化降级集**按 ID 保守汇总**（同 ID 任一记录不满足四条件则整 ID 不降级，`visual-diff-check.ts` 降级集计算处多一行 delete）；payload 改输出去重 ID 集；消费者不变。反例：`goal-runner-testing-integrity`「6644ea45 同名屏」——生产 `checkVisualDiff` → `collectActionableDefects`，fail / blocker × 同 ID 两种记录顺序共 4 组：该 ID 不降级、证据否决、候选保留、对照屏 sms 仍降级零候选。规格 `visual-diff` 降级条款补「按 id 保守汇总」一句。
- **建议 1 新鲜度描述**（已被 §9.3 取代，改为实质修复）：原采纳收窄——runtime 以 `freshSummary` 代理 `script-report.json` 新鲜度，不对报告单独做身份校验（harness 同轮先写报告再写 summary）。helper 注释与 `goal-runner` 规格同步改为「fresh phase summary 旁的 script-report.json，summary 新鲜度为代理」；上文 §9.1「本次 fresh `script-report.json`」一律按此理解。放弃的准确性：若报告与 summary 被分别篡改/残留（新 summary + 陈旧报告），runtime 会信陈旧报告的降级集；未加身份机制。
- **建议 2 措辞**：`visual-diff` 旧 Scenario「pass with blocking defect」THEN 改为「硬像素契约 FAIL、否则 WARN，且拒绝证据，降级残差除外」；`goal-phase-runtime.ts` 重试指引第 4 条补「minor-only residuals are disclosure only, no debt」。
- **变异 M14**：删按 ID 汇总那一行 → `goal-runner-testing-integrity` 80/1，恰为新反例红；已还原。
- **返修验证**（按调度不跑全量）：typecheck PASS；`--filter visual-fidelity` 144/0、`device-test-backtrack` 25/0、`goal-runner-testing-integrity` 81/0；`openspec:validate` 47/47 + enforcement PASS。

### 9.3 codex 第二轮返修（2026-09-24，同名屏核实闭合；建议 1 升为阻断）

- **P1 陈旧降级名单吞掉本轮 fail/blocker 候选**（属实）：`--sync-closure` 或报告生成前的失败出口只重写 summary、不重写 `script-report.json`，而 runtime 只凭 summary mtime 判 fresh → 旧报告的 `downgraded_screens` 被读、本轮 fail 屏在 collector 直接跳过。§9.2 的「以 freshSummary 代理」收窄作废。修（不加身份机制、复用既有字段）：`readFreshDowngradedVisualScreens` 另收本轮 gate 身份 `{runId, attemptId, startedAtMs}`，名单只在「报告 mtime ≥ 本 attempt gate 起点（`harnessStartedAtMs`）」且「payload 既有 `goal_run_id` / `attempt_id` 等于 `manifest.run_id` / `visualAttemptId`」时采信；否则空集（回旧行为、多回退）。调用点与 `collectActionableDefects` 入参注释、helper 注释（限定「完整检查链才同轮重写报告，`--sync-closure` / 报告前失败出口不覆盖」）、`goal-runner` 规格同步。
- **反例**（经 `runGoalRuntimeChain`，`goal-runner-testing-integrity`「6644ea45 旧报告降级名单」两例）：首轮 testing 执行者把 card_type_sheet 写成 fail（身份齐备、must_fix 锚定），gate 走真实 writer 写 LEDGER 类 BLOCKER summary、不写报告；盘上旧报告列两屏降级。① 本 attempt 身份、mtime 早于 gate 起点（锁 mtime 判据）；② 上一 attempt 身份（i1）、mtime 被刷进 gate 窗口（锁身份判据）。两例均断言盘上仍是旧报告，且出现 `reason=repair_candidates` 的回退。放弃的准确性：用例②用 `utimesSync` 模拟「复制/还原刷新 mtime」；AgentCtx 新增 `goalAttemptId`（取 invoke 注入的 `MAISON_GOAL_ATTEMPT`）。
- 同一 attempt 内 gate 起点之后、由非 gate 进程写出的报告仍会被采信（身份与时间都对得上）；本 plan 不再加身份机制。
- **变异**（脚本改后即还原）：M15 去身份比对 → `goal-runner-testing-integrity` 82/1，恰为反例②红；M16 去 mtime 比对 → 82/1，恰为反例①红。
- **返修验证**（按调度不跑全量）：typecheck PASS；`--filter visual-fidelity` 144/0、`goal-runner-testing-integrity` 83/0；`openspec:validate` 47/47 + enforcement PASS。

**不确定点**
- 宿主验收（plan 头 `real_host_validation`）未做；本会话不碰宿主。
- runtime soft 用例的 run_end 状态未断言（只断言无回退、无 halt、testing 一次、summary 投影与债务）；release BLOCKED 下 run 终局标签沿既有逻辑。

Review：codex 第一轮 D1–D5 认可、1 阻断 + 3 建议 + 事实修正，已逐条实读核实后改——§4.6 补齐被直接改写的条款（`visual-diff:532`、`feature-artifact-layout:288/298-302`、`goal-runner:885` Requirement），`downgraded_screens` 写成只对降级屏的窄例外（§4.3、§4.6）；§4.5 静态提示写明「不阻断推进、仍阻断发布」并保留「未锚定 must_fix 不降级」，hard 档统一按 `pixel_1to1 ∧ hard` 描述（§3）；§8 补操作性出路与「人工确认不能清债」；§5 T2 实施注（真实 gate + 债务投影 + runtime 读真实报告）、T4 用合法 T8 来源对象；行号改 `:1449/:2819/:1944/:1945`；§1 事实 3 限定受 ratchet 包装的命中、事实 4 改「整轮消费资格被否决」、§2 债务行补非 MINOR SKIP；§8 D1 前提改为旧用例「拒绝证据」、降级对象精确化、T1 受硬像素谓词守卫不作 best_effort 兜底。
codex 第二轮 2 阻断 + 1 校正，已实读核实后改——§4.6 表补 `visual-diff:417/534/547-549`、`goal-runner:883` 四条窄例外；§3 条件 4 收紧为「至少一条自报 major」，纯 minor 屏不入降级、不开阻断债务（与 `goal-runner:899-903` 一致），§8 降级对象定义与之统一，§5 补 T5b（复用 B07 夹具）、§6 登记纯 minor 屏否决证据却零候选的既有缺口；§4.4 行号改 `:8375` / `:9334-9336`，§2 回退行改 `:8373-8393`。
