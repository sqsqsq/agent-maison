---
name: testing 证据消费收编 — StepResult 唯一真源与推测退场
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan。**外部前置**：Hylyre 按需求文档
# docs/vendor/hylyre-断言与证据完整性需求.md 交付修复版（StepResult ledger、verdict
# 三轴 execution/verification/evidence、failure 两级分类、match 契约统一）——本 plan 的
# T1/T3/T4/T5/T6 以三重判据门控其交付，T2/T7 不依赖、可先行。
# v1（2026-08-30）：宿主 bc-openCard-1 testing 回灌 + hylyre 空断言事故立项；codex 综合
# 评审（十三节）定稿方向，本仓坐标全部本轮亲核：
# [实证1] p0-semantic-gates.ts:14 头注释自述「当前 Hylyre trace 无 step 级运行时观测」
#   ——门禁只验计划形态（:277 ACTION_KINDS、:451 动作指向 checkpoint）+ trace case
#   状态字符串（:316/:417 ==='通过'）。Hylyre 空断言（wait_for 假通过）因此**穿透**
#   maison，p0_semantic_coverage_integrity 判 PASS（宿主实锤）。
# [实证2] check-testing.ts:2332 p0_runtime_step_evidence 在 provider
#   runtime_step_telemetry capability 缺席时 SKIP——普通交互式 testing 可在无 runtime
#   checkpoint 证据下宣称语义覆盖 PASS。
# [实证3] 我方 provider 显式传 --skip-assert-expected（device-test-run.ts:1690），
#   check-testing.ts:835 已列 WEAKENING_FLAGS 监控——弱化在场但产物无 expected-check
#   模式可审计（hylyre C-2）。
# [实证4] profiles/hmos-app/harness/hylyre-runtime-telemetry.py 以 monkey-patch Hylyre
#   私有 _execute_one_step 抓 pre/post dump 等——为补 trace 缺步骤证据而建的临时桥，
#   原生 StepResult 上线后须退场（禁双真源）。
# [实证5] hylyre 版本读取链已存在（device-test-run.ts:90-118，hylyre-ready.meta.json
#   → manifest.hylyre_version）——三重判据门禁有现成挂点。
# v2（2026-08-30，需求文档终审轮联动对齐）：coverage 归属定稿——Hylyre 只出
#   execution/verification/evidence 三轴，coverage/quality axes/release verdict 由
#   maison 基于 steps[] 自算；assertion coverage 判据=StepResult.role（接口冻结见需求
#   文档 P1-8）；candidate_policy 字段撤销（require_unique 为 Hylyre 契约默认，消歧用
#   既有 index/scope/within/all）；--skip-assert-expected 处置改「凭 expected_check_mode
#   产物不凭旗标」；富文本按责任分流不统一记 skip（plan T5 原表述即如此，维持）。
# v3（2026-08-30，需求文档三轮收口联动）：接口终版补齐 CaseResult.evidence 轴与
#   StepResult.failure_code 两级分类（+通用 evidence 证据落点）——T1 的证据完整性消费
#   与 T3 的归因路由以此为机器字段依据；消费纪律追加「不以 error 字符串做主路由」。
# v4（2026-08-30，吸收 codex 首轮 plan review 2P0+4P1，逐条核实后修订）：
# [P0-① 采纳] T1 使用了不存在的字段——plan 各处的 verification=verified/unchecked 与
#   StepResult.verification 均非冻结接口成员（CaseResult.verification=passed|failed|
#   inconclusive；StepResult 只有 role/status）。判据定稿：case.execution==completed ∧
#   case.verification==passed ∧ case.evidence==complete ∧ checkpoint.required_element_ids
#   均映射到 role=assertion,status=passed 的步骤 ∧ forbidden_element_ids 均映射到相应
#   absence assertion,status=passed——补上此前遗漏的 forbidden 与 CaseResult.evidence
#   消费。todo/overview/T1/验收 1、3 全部同步。
# [P0-② 采纳] explicit skip 无 StepResult 可分型——derive manifest 只有裸 id 清单
#   （derived-hylyre-plan.ts:111，本轮实证），未执行 case 不存在 failure_kind。定稿：
#   已执行 case 的 failed/skipped 消费 Hylyre 两级分类；explicit skip/未执行且无机器
#   原因 → 保持 testing FAIL、不得自动投 coding；仅当既有 capability resolution 明确
#   证明 provider 缺失才 capability defer；禁止从 TC 名称/报告散文推断责任。撤回
#   「宿主 7 条自动落 capability defer」的断言。此项反转 active
#   p0-skip-repair-subtraction 的「explicit-only→code_regression」契约——须正式修订
#   该 change 而非只改生产代码（并入 T8）。
# [P1-③ 采纳] T5 违反 selector SSOT 边界（selector-contract.ts:4 原话「运行时 dump/
#   snapshot cache 只能发现候选，不能成为 selector 真值」，本轮实证）。拆两层：静态门
#   =ui-spec canonical 节点集内 substring 映射唯一或带显式 index/scope/within/all；
#   运行时门=StepResult.candidate_count==1 或显式消歧生效；dump 仅派生建议/WARN，
#   不参与静态授权 PASS。
# [P1-④ 采纳] legacy 假通过残留——三重判据不满足时不止 wait/toast 型不可信：action-only
#   无断言、expected 未检查、旧 case 无 evidence 轴同样可能沿「计划形态×case 状态」进
#   语义通过。定稿：**三重判据不满足时任何 legacy case 状态都不得单独贡献
#   verification=passed**；默认=testing completion 要求升级 Hylyre 后重跑；有限兼容仅当
#   既有 runtime telemetry 已完整证明特定 checkpoint（action hit + required/forbidden
#   观测 + 身份绑定），该 checkpoint 可作 legacy evidence，其余一律 inconclusive。T6 同步：
#   旧 telemetry 只能证明它实际采到的 checkpoint，禁止合成虚构的通用 StepResult ledger。
# [P1-⑤ 采纳] T7 假定的 report-only 入口不存在——--sync-closure 不跑脚本 harness 也不
#   重算 report checks（harness-runner.ts:407-411），完整 check-testing 必跑
#   build/install/run。定稿：新增 testing 专属 --report-reconcile-only 模式，最低契约：
#   只读既有 authoritative trace/test-plan/timing/build-install-run meta；不调用
#   hvigor/hdc/Hylyre/视觉采集；重跑全部 report/static checks；产出完整重算的
#   script-report/summary/quality axes（非局部 patch）；authoritative trace 字节不变；
#   不新增 phase/sidecar。
# [P1-⑥ 采纳] 补 OpenSpec/契约同步（新增 T8）：新建 openspec change、修订 harness-gates/
#   testing phase rules canonical requirements、正式修订 p0-skip-repair-subtraction 的
#   完成结论、同步 device-testing SKILL/profile addendum/runbook、定向测试后 strict
#   validate。非阻断校准：frontmatter「verdict 四轴」改三轴。
# v5（2026-08-30，吸收 codex 二轮 4P1 残留清理，无新扩面）：
# [①] T3 路由表改三列制、严格取冻结枚举（assertion_failure 这类混造值清除——kind=
#   assertion + code=assertion_mismatch）；[②] 三节旧证据总则从"只点名 wait/toast"
#   同步为"任何 legacy 旧通过均不得单独贡献 passed"四型齐列（与 T4 一致）；[③] 边界节
#   NFR 行修正——provider 建成前 explicit skip 保持 testing FAIL 不自动投 coding，
#   provider 给出机器缺失事实后才 capability defer（消除与 P0-②/验收 5 的直接冲突）；
# [④] T8 拆两段式 T8a（第一刀前 change+delta+strict validate）/T8b（实现后收口），
#   执行顺序钉死 T8a→T2/T7→Hylyre 交付→T1/T3/T4/T5/T6→T8b——OpenSpec 是 canonical
#   前置非补文档。
# [codex 裁决要点收录] 唯一数据链=test-plan.hylyre.md → trace.json CaseResult.steps[]
#   → check-testing → 既有 summary/quality axes/repair candidates；不新增
#   step-evidence sidecar / selector ledger / assertion registry / Toast sidecar /
#   第二套 case 状态 / 从日志重建 StepResult；不按版本号盲信（版本+schema+必需字段
#   三重判据）；旧断言证据标 legacy_assertion_evidence_untrusted 不删历史；
#   「含数字就 contains」类机械启发式禁止——match 选择由 acceptance 意图决定；
#   运行时 exact→contains 自动放宽禁止，放宽=新 timestamp 重派生（既有纪律）。
todos:
  - id: t1-evidence-reconciliation
    content: T1 证据对账重键：p0 语义门改「计划要求×StepResult 对账」——判据=case.execution==completed ∧ case.verification==passed ∧ case.evidence==complete ∧ required_element_ids 映射 role=assertion,status=passed 步骤 ∧ forbidden_element_ids 映射 absence assertion,status=passed；interactive 与 goal 同源消费（goal 保留身份绑定增强）；通过分子只计满足全判据的 case。【依赖 hylyre 交付】
    status: completed
  - id: t2-derivation-compile-hardening
    content: T2 派生编译强化（可先行）：Step 4.5 正式 by_text 显式 match + 既有 index/scope/within/all 消歧键（require_unique 是 Hylyre 契约默认，不造 candidate_policy 字段）；放宽走新 timestamp 重派生纪律；禁运行时改写 selector；禁字符特征启发式。
    status: completed
  - id: t3-failure-kind-routing
    content: T3 失败归因接入：**已执行 case** 的 failed/skipped 消费 hylyre failure_kind/failure_code 两级路由；**explicit skip/未执行 case 无机器原因 → 保持 testing FAIL、不自动投 coding**（仅既有 capability resolution 证明 provider 缺失才 defer；禁按 TC 名称/散文推断）；p0-skip-repair-subtraction 契约反转经 T8 正式修订。【依赖 hylyre 交付】
    status: completed
  - id: t4-version-gate-and-legacy
    content: T4 三重判据门禁（版本+trace schema+StepResult 必需字段，挂 hylyre-ready.meta 链）；不满足时**任何 legacy case 状态都不得单独贡献 verification=passed**（不止 wait/toast 型）——默认 completion 要求升级后重跑，有限兼容仅限既有 telemetry 完整证明的 checkpoint，其余 inconclusive；不删历史。【与 T1 同开关落地】
    status: completed
  - id: t5-selector-contract-and-richtext
    content: T5 selector 契约门两层分型：静态门=ui-spec canonical 集内 substring 映射唯一或显式 index/scope/within/all（dump 仅建议/WARN，不参与授权——守 selector-contract SSOT 边界）；运行时门=StepResult.candidate_count==1 或显式消歧生效；富文本片段须声明独立 target，inline_target_unresolvable 走既有责任路由，禁点父中心。【依赖 hylyre 交付】
    status: completed
  - id: t6-telemetry-retirement
    content: T6 telemetry monkey-patch 退场：原生 StepResult 在场只认原生；过渡期旧 schema 用现有 telemetry；双在场一致性检查；最终删除。【依赖 hylyre 交付】
    status: completed
  - id: t7-report-reconcile-only-mode
    content: T7 新增 testing 专属 --report-reconcile-only 模式（可先行；既有入口经核实均不满足——sync-closure 不重算 report checks、完整 check-testing 必跑设备）：只读既有 trace/plan/timing/meta，零 hvigor/hdc/Hylyre/视觉调用，重跑全部 report/static checks 产出完整重算 summary（非局部 patch），trace 字节不变，不新建 phase/sidecar。
    status: completed
  - id: t8-openspec-and-contract-sync
    content: T8 契约同步（两段式）：T8a **第一刀代码前**新建 openspec change + delta + 修订 p0-skip-repair-subtraction 完成结论 + strict validate；T8b 实现后 tasks/SKILL/addendum/runbook 收口 + 再次 strict validate。执行顺序钉死：T8a → T2/T7 先行 → Hylyre 交付 → T1/T3/T4/T5/T6 → T8b。
    status: completed
overview: >
  宿主实锤：Hylyre 空断言穿透 maison——p0 语义门只验「计划长得像有断言」+ trace case
  状态字符串，runtime evidence 在普通 testing 又被 capability SKIP，于是「wait_for 假
  通过」直达 p0_semantic PASS。配套改造收敛为一句话：以 Hylyre 新 CaseResult.steps[]
  为唯一执行证据，接入既有 check-testing→summary→quality axes→repair candidates 链，
  删除旧推测与临时 telemetry；不新增 sidecar/registry/状态机/平行真源。运行前 maison
  把自然语言编译成显式契约（match + 既有消歧键；coverage 由 maison 自算），运行后用 acceptance 对账 Hylyre
  的确定性证据；通过分子只认满足全判据的 case（execution=completed ∧ verification=passed
  ∧ evidence=complete ∧ required/forbidden 断言步骤全 passed）；旧断言证据以三重判据划界标
  untrusted。T2/T7 不依赖 hylyre 可先行，其余以三重判据门控交付。
---

# testing 证据消费收编：StepResult 唯一真源与推测退场（d8b3f6a1）

状态：已闭环（2026-09-03）。T2/T7 先行落地；T1/T3/T4/T5/T6 在 Hylyre 0.5.x 交付后于 change testing-stepresult-evidence-consumption（已归档，tasks 4.1–4.5/5.2 全勾）落地；T8b 收口随 a6c4e9f2 T8 完成。t1/t3/t5/t8 frontmatter 此前漏翻，2026-09-03 按用户裁决补置 completed。
触发：宿主 bc-openCard-1 testing 回灌暴露 Hylyre `wait_for` 空断言（TC-015 断言不存在元素判"通过"）后复盘：**maison 自身的消费面让空断言畅通无阻**——这不是可选配套，Hylyre 修好后若 maison 不改，旧"case 通过 + 计划含 wait_for"仍继续假判。配套需求文档见 [docs/vendor/hylyre-断言与证据完整性需求.md](../../docs/vendor/hylyre-断言与证据完整性需求.md)。

---

## 一、问题陈述与定性

maison 在 testing 证据链上有四处结构性弱点（全部本仓坐标实锤，见 frontmatter 实证 1-4）：

1. **语义门验形不验实**：`p0_semantic_coverage_integrity` 的判据 =「动作指向 checkpoint target ∧ 其后存在 wait_for(required_element_id) ∧ trace case 状态==='通过'」——三者都不证明 wait_for 真命中、元素真出现、selector 无歧义、expected 真检查过。计划形态被当成了 runtime 证据。
2. **runtime 证据双轨**：`p0_runtime_step_evidence` 仅在 telemetry capability 在场时生效，普通交互式 testing SKIP——"元素实际是否出现"在非 goal 场景降为不可检查。
3. **case 状态即验收**：通过率把"动作链执行完成"当"验收通过"，Hylyre 的 execution/verification 之分（其 P0-7 交付后）无消费面。
4. **归因一刀切**：`p0_coverage_integrity` 把 explicit skip 整体投 `code_regression → coding`——可测性缺口、测量能力缺口、富文本寻址缺口、设备断连四类不同责任被混投（宿主 10 条跳过中 7 条实为能力缺口）。

定性：**运行前编译不显式（match/消歧交给执行器默认值），运行后对账不落地（信状态字符串不信步骤证据）**。修复方向不是造新系统，是把 Hylyre 新证据接进既有链，并让旧推测退场。

## 二、目标模型

**唯一数据链**（禁止任何平行真源）：

```
Maison test-plan.hylyre.md（编译产物：显式 match / 既有消歧键 index·scope·within·all / checkpoint）
        ↓
Hylyre trace.json / CaseResult.steps[]（唯一执行证据真源）
        ↓
Maison check-testing（对账：计划要求 × StepResult 实际验证）
        ↓
既有 summary / quality axes / repair candidates（零新增载体）
```

**职责两句话**：运行前，maison 把自然语言编译成明确测试契约；运行后，maison 用 acceptance 对账 Hylyre 的确定性证据。

**明确不做**（codex 十三节，逐条冻结）：不重写 Hylyre selector resolver；不自己监听 Toast；不从 Hylyre 日志重建 StepResult；不实现富文本 OCR/坐标估算点击；不在运行时自动 exact→contains；不新建 step-evidence sidecar / selector ledger / 第二套 case 状态；不把 Hylyre failure taxonomy 复制一份重新解释。

**通过语义重定义**（T1 核心；字段严格取冻结接口，禁止另造 `verified/unchecked` 类枚举）：

```
acceptance/P0 通过分子 = 满足全部判据的 case：
  case.execution == "completed"
∧ case.verification == "passed"
∧ case.evidence == "complete"
∧ checkpoint.required_element_ids 均映射到 role="assertion" ∧ status="passed" 的步骤
∧ checkpoint.forbidden_element_ids 均映射到相应 absence assertion ∧ status="passed"

verification=inconclusive / evidence=incomplete → 未覆盖分母（不是通过、也不伪装失败）
--skip-assert-expected ≠ 全 case 未验证：expected_check_mode 落盘后，确定性 assertion
steps 已覆盖 checkpoint 的 case 仍入分子；无 assertion step 且 expected 未检查 → 不得计通过
执行统计可另行展示 Hylyre 步骤 status（信息面，不入裁决分子）
```

## 三、外部前置与三重判据

**门禁判据 = Hylyre 版本 ≥ 最低修复版 ∧ trace schema 支持 StepResult ∧ StepResult 必需字段在场**——三者同时满足才走新消费路径；不按版本号盲信。挂点复用既有 `hylyre-ready.meta.json → manifest.hylyre_version` 链（实证 5）。

**旧证据处置**（与新路径同一开关落地，防中间态）：三重判据不满足时，**任何 legacy case 的旧"通过"状态均不得单独贡献 verification=passed**——native `wait_for`/`wait_gone`/旧 `assert_toast` 型、action-only 无断言型、expected 未检查型、无 evidence 轴型均属此类；消费侧标 `legacy_assertion_evidence_untrusted` 并指引重跑相关用例（有限兼容边界见 T4）；**历史文件不删除**。

## 四、实施批次（待 review 后动手；依赖标注见各条）

### T1 证据对账重键【依赖 hylyre StepResult + 三轴交付】
- `p0-semantic-gates.ts`：判据从「计划形态 × case 状态」改为「**计划要求（应验什么）× StepResult（实际验了什么）对账**」——按二节判据全量执行：required_element_ids 对 `role="assertion" ∧ status="passed"` 步骤、**forbidden_element_ids 对相应 absence assertion**、并消费 `case.evidence` 轴；计划结构仍负责"应该验证什么"，不再兼任证据。字段一律取冻结接口成员（StepResult 无 verification 字段，判定用 `role+status`）。
- `p0_runtime_step_evidence`：普通 testing 与 goal 同源消费同一 runtime evidence（StepResult 即观测源，telemetry capability 不再是先决）；goal 正式 gate 保留 run/attempt/HAP/设备身份的额外绑定，**只增不减**。
- 通过分子重定义按二节；assertion coverage 的判据取 StepResult 的 **`role: action|assertion`** 字段（接口冻结见需求文档 P1-8，两侧不得各自维护"哪些 kind 算断言"清单）；`--skip-assert-expected` 的处置改为**凭产物不凭旗标**——消费 `expected_check_mode` 四态判定 expected 是否被检查，是否继续传旗标由运行策略决定（WEAKENING_FLAGS 监控保留为兜底）。

### T2 派生编译强化【可先行；hylyre P0-4 后全域生效】
- Step 4.5 派生计划：正式 `by_text` **一律显式写 `match`**（exact/contains 由 acceptance 意图决定——金额/日期可能正是精确断言对象，**禁止**"含数字就 contains"类字符特征启发式）；action 多候选默认失败是 **Hylyre 契约**（require_unique），我方不重复声明字段，需要消歧时用既有 `index/scope/within/all` 键显式书写。
- selector 来源沿既有 contracts→plan→ui-spec/dump 链；**禁止**运行时改写。
- exact 失败判断应放宽时：**新 timestamp 目录重派生**（selector 变化可审计）→ 重跑——沿用既有"不手改旧运行目录"纪律，零新机制。
- 先行说明：resolver 域今天已认 `match:"exact"`/缺省 contains，显式书写立即消除该域的默认值依赖；native 域待 hylyre P0-4 统一后同语义生效。

### T3 失败归因接入【依赖 hylyre failure 分类交付】
- 消费约定（接口冻结见需求文档 P1-8）：**先按 `failure_kind` 四大类做稳定路由，仅精细归责时看 `failure_code`；不以 `error` 字符串做主路由**。路由表严格取冻结枚举值（三列制，杜绝再造 `assertion_failure` 类第三方枚举）：

| failure_kind | failure_code | maison 责任路由 |
|---|---|---|
| assertion | assertion_mismatch | 默认 coding/product |
| selector | selector_not_found / selector_ambiguous | testing 先判 selector 陈旧/重派生；必要时 plan 补锚点 |
| selector | inline_target_unresolvable | coding 补 anchor，或 spec/plan 补交互目标定义 |
| capability | capability_unsupported | capability defer——**不投 coding** |
| infrastructure | device_unavailable / driver_failure | external/toolchain |

- **消费域切分（P0-② 定稿）**：上表只适用于**已执行 case**（存在 StepResult）；explicit skip / 未执行 case（derive manifest 仅裸 id 清单，无机器原因）→ **保持 testing FAIL、不得自动投 coding**——仅当既有 capability resolution 明确证明 provider 缺失才落 capability defer；禁止从 TC 名称或报告散文推断责任。宿主 7 条 NFR/几何/时延用例**不会被自动分型**（撤回 v1 断言），其出路是 capability provider 建设（独立后续）或人工归责。
- 此项反转 active `p0-skip-repair-subtraction` 的「explicit-only → code_regression → coding 候选」契约——**须经 T8 正式修订该 change**，不得只改生产代码。

### T4 三重判据门禁与旧证据划界【与 T1 同一开关】
- 三重判据实现挂 `hylyre-ready.meta` 链；满足 → 新路径启用，legacy 标记逻辑对新 trace 天然不命中。
- 不满足 → 新对账路径不启用，且**任何 legacy case 状态都不得单独贡献 `verification=passed`**——不止 wait/toast 型：action-only 无断言、expected 未检查、无 evidence 轴的旧"通过"一律同罪（consume 侧标 `legacy_assertion_evidence_untrusted`，不改历史文件）。
- 处置双档：**默认**=testing completion 要求升级 Hylyre 后重跑；**有限兼容**=仅当既有 runtime telemetry 已完整证明特定 checkpoint（action hit + required/forbidden 观测 + 身份绑定齐备）时，该 checkpoint 可作 legacy evidence，其余一律 inconclusive。门禁话术指引"升级 Hylyre 后重跑相关用例"。

### T5 selector 契约门分型 + 富文本责任路由【依赖 hylyre match 契约/错误分类】
- `derived_selector_contract`（check-testing）分型校验，**两层分离**（守 [selector-contract.ts:4](../../profiles/hmos-app/harness/selector-contract.ts) 的 SSOT 边界"运行时 dump/snapshot cache 只能发现候选，不能成为 selector 真值"）：
  - **静态门（编译期授权）**：`match=exact` → 与 canonical ui-spec text 精确等值；`match=contains` → 在当前 screen 的 ui-spec canonical 节点集内该 substring 映射**唯一**，或 selector 带显式 `index/scope/within/all`；**dump 只用于派生建议/WARN，不参与静态授权 PASS**（离线派生、设备断连、陈旧 dump 不得改变同一 selector 的合法性）。
  - **运行时门（执行期验证）**：Hylyre StepResult 的 `candidate_count==1`，或显式消歧确实生效。
  复用现有 selector contract，不建第二套契约文件。
- 富文本片段：须 ui-spec/contracts 声明其为**独立交互 target**，否则不得仅凭聚合 Text 包含子串判 selector 合法；Hylyre 返回 `inline_target_unresolvable` 时按既有责任路由分流（声明了 anchor 产品未挂载→coding；需求未定义该目标→spec/plan；dump 暂不可读→testing 重试/external）——**禁止**改成"点父 Row 中心"继续。

### T6 telemetry 退场【依赖 hylyre StepResult 上线】
- 消费优先级：原生 StepResult 在场 → **只认原生**；旧 schema → 现有 `hylyre-runtime-telemetry.py` 过渡；双在场 → 一致性检查（不一致按原生并告警）。
- **过渡期边界（P1-④ 联动）**：旧 telemetry 只能证明**它实际采到的 checkpoint**（pre/post dump + actual_hit 齐备者），**禁止**据其合成一份虚构的通用 StepResult ledger 冒充新证据。
- 过渡期结束后删除 monkey-patch（私有 `_execute_one_step` 挂钩是脆弱面，不得长期保留两套 runtime step 真源）。

### T7 `--report-reconcile-only` 模式【可先行】
- 现状与前提核实：**既有入口均不满足**——`--sync-closure` 不跑脚本 harness、不重算 report checks（[harness-runner.ts:407-411](../../harness/harness-runner.ts)）；完整 check-testing 必跑 build/install/run（check-testing.ts:3695 起）。"复用现成入口"不可执行，须新增 testing 专属模式。
- 定稿最低契约：**只读**既有 authoritative trace、test-plan、timing、build/install/run meta；**零调用** hvigor/hdc/Hylyre/视觉采集；**重跑全部 report/static checks** 并产出一份**完整重算**的 script-report/summary/quality axes（不是局部 patch 旧 summary）；authoritative trace 字节保持不变；不新增 phase、不新增 sidecar。
- 定稿顺序：run 产 trace → agent 基于 trace/timing 生成 report → `--report-reconcile-only` 收尾。宿主暴露的三处报告纪律（跳过统计笔误、复用轮引用首轮真编数据、未按最终 timing 回填）写进 device-testing SKILL 的报告生成步骤。

### T8 OpenSpec 与契约同步（两段式，前置+收口）
- **T8a（第一刀代码之前）**：新建 openspec change（testing 证据消费语义：权威证据=StepResult 对账、通过判据、legacy 划界、selector 两层门、report-reconcile-only 模式）+ `harness-gates`/testing phase rules delta + **正式修订 active `p0-skip-repair-subtraction`** 的「explicit-only → code_regression」完成结论（T3 反转其契约，不得只改生产代码留下已证伪的规范）；`openspec:validate --strict` 通过后才动生产代码。
- **T8b（实现完成后）**：tasks 勾账、device-testing SKILL / hmos-app profile addendum / runbook 同步、再次 strict validate 收口。

**执行顺序（钉死）**：`T8a → T2/T7（可先行）→ Hylyre 交付 → T1/T3/T4/T5/T6 → T8b`。

## 五、验收场景（完成判据）

1. **空断言穿透关死**：构造 case 旧状态"通过"但对应 required 断言步骤 `status!=passed`（或 `case.verification=inconclusive`）→ `p0_semantic_coverage_integrity` 不得 PASS（宿主 TC-015 形态的构造性回归）。
2. **双轨归一**：普通 interactive testing 在 StepResult 在场时 runtime evidence 非 SKIP，与 goal 同源；goal 身份绑定不减。
3. **通过语义全判据**：`verification=inconclusive` 或 `evidence=incomplete` 的用例不入通过分子、入未覆盖分母；**forbidden_element_ids 缺 absence 断言或其 status!=passed → 不入分子**；有确定性 assertion 覆盖 checkpoint 的用例在 `--skip-assert-expected` 下（凭 `expected_check_mode` 产物）仍入分子。
4. **三重判据**：旧版本/旧 schema/缺字段任一不满足 → **任何 legacy"通过"不得单独贡献 passed**（wait/toast 型、action-only 型、无 evidence 轴型各一例）且指引重跑；telemetry 完整证明的 checkpoint 走有限兼容；三者齐 → 新路径生效（含中间态构造：版本新但字段缺）。
5. **归因分型（域切分）**：已执行 case 的 `capability_unsupported` 落 capability defer 不产 coding 候选、`assertion_mismatch` 照投 coding；**explicit skip（无 StepResult）→ testing FAIL 保持、零自动 coding 候选**。
6. **selector 门两层**：静态门——ui-spec canonical 集内 substring 唯一通过、多映射无消歧拒、canonical 不包含拒、富文本未声明独立 target 拒，**dump 内容变化不改变静态结论**；运行时门——`candidate_count>1` 无消歧拒。
7. **telemetry 单真源**：双在场时以原生为准且不一致告警；仅旧 schema 时 telemetry 只认领它实际采到的 checkpoint（不合成通用 ledger）。
8. **`--report-reconcile-only`**：跑通且零设备调用（hvigor/hdc/Hylyre/视觉全无）；产出完整重算 summary；trace 字节不变；`test_report: MISSING` 顺序倒挂消失。
9. **契约同步**：openspec change 落地、`p0-skip-repair-subtraction` 修订记录在案、`openspec:validate --strict` 全绿。
10. 全量 `npm test` / `check-plan-version` 全绿；goal 侧既有语义零变化。

## 六、边界与悬置（防膨胀）

- **不做清单**见二节（冻结，评审轮不得往回加：无 OCR、无运行时放宽、无 sidecar/ledger/第二状态源）。
- layout oracle 的重复元素/顺序语义校准（宿主 T8 `bank_row_chevron` 疑似误报）：**独立后续**，不混入本 plan。
- NFR 计时/FPS/内存的 capability provider 建设：独立后续；**建成前对应 explicit skip 保持 testing FAIL、不得自动投 coding**——只有 provider/capability resolution 能给出机器缺失事实后，才可落 capability defer（与 T3 域切分一致）。
- Hylyre 交付节奏为外部依赖，**执行顺序钉死**：`T8a`（openspec change 创建 + delta + strict validate）最先 → `T2/T7` 先行 → Hylyre 交付（三重判据满足）→ `T1/T3/T4/T5/T6` → `T8b`（tasks/docs 收口 + 再次 strict validate）。OpenSpec 是 canonical contract 前置，不是最后补文档的步骤；三重判据是 T1 系的唯一开关，不做中间态兼容层。
- 宿主回灌（升级 Hylyre + 重跑 testing）用户驱动，不入本 plan 交付物。
- goal 侧发布权责、UT/attestation 链、verifier 证据链（a9d4e7c2 已交付）一概不动。
