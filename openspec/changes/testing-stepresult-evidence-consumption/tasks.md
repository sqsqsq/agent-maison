## 1. T8a canonical contract

- [x] 1.1 Create the canonical StepResult/CaseResult evidence, three-axis coverage, failure routing, selector, legacy, telemetry, and report-only deltas; revise `p0-skip-repair-subtraction` explicit-skip routing and pass strict OpenSpec validation before production code.
- [x] 1.2 Update `specs/phase-rules/testing-rules.yaml` to match the canonical StepResult evidence and report-only contracts without adding a phase or sidecar.

## 2. T2 derived-plan compilation

- [x] 2.1 Strengthen the existing derive Step 4.5 path so formal `by_text` selectors explicitly declare only `match: exact|contains`, selected from acceptance intent and never from character heuristics; every formal linter/suggested-fix/example path must preserve that contract.
- [x] 2.2 Reuse existing `index`, `scope`, `within`, and `all` disambiguators and preserve the fresh-timestamp re-derive/re-run rule; do not add `candidate_policy` or runtime exact-to-contains fallback.
- [x] 2.3 Add focused derive/compiler regression coverage for explicit match, illegal values, disambiguation, unchanged source/dump authorization boundaries, and non-violating formal suggested fixes.

## 3. T7 report-only reconciliation

- [x] 3.1 Implement testing-only `--report-reconcile-only` over existing trace, plan, timing, build/install/run metadata and route it through the complete report/static checks and existing summary/quality-axis writers; reject cross-run path, fingerprint, timestamp, feature, and exact-case-set mismatches.
- [x] 3.2 Prove no hvigor, hdc, Hylyre, device, visual-capture, or executable lifecycle-hook calls from the real CLI; preserve authoritative trace bytes; recompute all derived report/summary/quality-axis/repair-candidate outputs and final case durations.
- [x] 3.3 Update device-testing report-generation instructions for skip denominators, final reuse state, final timing, and per-case durations; add focused helper and command-level no-device regression coverage.

## 4. Hylyre-gated evidence consumption (T1/T3/T4/T5/T6)

- [x] 4.1 After the external three-part gate is satisfied (minimum version, trace schema, required fields), consume native `CaseResult.steps[]` for P0/acceptance coverage in interactive and goal testing; retain goal identity binding, bind trace/plan/StepResult sequence to the existing run identity receipt, and make required/forbidden assertion reconciliation fail-closed.
- [x] 4.2 Implement frozen `outcome.failure.domain`/`outcome.failure.code` routing for executed `outcome.status=failed` cases (v1 four-way discriminated variant, never flat `failure_kind`/`failure_code`), keep explicit skip/unexecuted cases across all top-level priorities as testing FAIL with zero automatic coding candidates, and route structured coding/spec/plan owners through the existing repair-candidate writer; only existing machine-proven capability absence may defer.
- [x] 4.3 Enforce legacy untrusted handling and bounded telemetry compatibility; native StepResult wins in dual presence, no synthetic ledger is generated, and the monkey-patch is removed only after the transition contract is satisfied. A native-capable preflight followed by malformed trace data remains an ordinary testing failure.
- [x] 4.4 Enforce canonical static selector gates, runtime candidate-count/disambiguation gates, and rich-text `inline_target_unresolvable` responsibility routing through one shared planned-step normalizer, without parent-center clicks, OCR, or coordinate estimation.
- [x] 4.5 Add the required conformance/regression cases for failed assertions, inconclusive/incomplete evidence, forbidden absence, three gate negatives, legacy wait/action-only cases, capability/assertion routes, explicit skip on every priority, bound-plan replay, selector target identity, native timing, and native/telemetry precedence.

## 5. Staged contract and verification

- [x] 5.1 This-stage verification: update the OpenSpec contract, device-testing Skill, hmos-app profile addendum, and testing/runbook documentation; record the external Hylyre three-part gate status and keep Hylyre-dependent tasks pending when any fact is absent; run the focused checks for the completed stage work.
- [ ] 5.2 T8b final closeout after tasks 4.1–4.5 are implemented: update all task statuses, rerun strict OpenSpec validation, focused/full tests, plan/version and diff checks, and verify the native/legacy transition end to end. No release/version bump or host device reflash is part of this task.

## 6. 首次宿主回灌纠偏（plan a6c4e9f2）

外部依赖：Hylyre Phase 0 契约冻结包（`output-schema.json` 0.4-p0 / `step-outcome-v1.md` /
builder 判定表 / golden fixtures）**已通过独立 review 并落位**（tree `cc738c27…1bae`），
此条外部阻塞已解除。

协议文本统一（2026-08-31 完成）：`specs/runtime-step-evidence/spec.md`、
`specs/harness-gates/spec.md` 与 4.2 原先仍写 `Hylyre 0.4.0+ / trace 0.3-p0 /
failure_kind / failure_code`，与 0.5.0 / 0.4-p0 / Step Outcome v1 并存两套；归档会把旧协议
合入 canonical，已全部改到 v1 口径。

- [x] 6.1 T1（Maison 独立部分）：把 selector 开放世界语义、`execution_channel` 编译期分派、
      manual 无质量 PASS 载体、Hylyre case setup/action 先行、通道精确对账、单一 fail-closed
      dispatch 纪律与 failure route 基数不变式写入本 change 的 delta，并 strict validate。
- [x] 6.2a M1 第一步：Phase 0 冻结包落位（`harness/tests/fixtures/hylyre-contracts-0.4-p0/`，
      现为 tree `cc738c272324…1bae` / 226 文件，含 Q5+Q8 冻结）+ 落位自证测试 + 逐面契约对账 + 8 问答案固化
      （见 inventory §七/§八）。对账发现 1 项阻断差异（D1：native 路径 by_text 的
      resolution 为 not_attempted，与 plan §2.1 的 unique/1/selected 硬条件冲突）、
      2 项记录项，均已登记未自行兼容。
- [x] 6.2b M1 typed consumer 基座：统一 `(schema_version, result_protocol)` dispatch
      （`hylyre-result-protocol.ts`：v1 / legacy-unsupported / unsupported 三态，无第四种静默不适用）、
      D1 selector 身份判据、v1 责任路由与 cause disposition（`hylyre-failure-routing-v1.ts`）、
      Q5 artifact 按 trace 目录解析 + 逃逸 + sha256（`hylyre-artifact-resolution.ts`）。
      断言全部以冻结包 golden 为 oracle，不另抄同义 fixture。
- [x] 6.2 T1（Hylyre 依赖部分）：Phase 0 冻结包 review PASS 后，按冻结契约补齐 Step Outcome v1
      的 typed 消费契约（outcome variants、四个 code 面、selector request/resolution、artifacts、
      CaseResult/RunResult reduce），完成契约对账并再次 strict validate。
- [x] 6.3 T2 静态部分：`selector-contract.ts` 把 feature ui-spec miss 从 BLOCKER 降为 WARN，
      保留非法 match、ui-spec 已证明的多映射无消歧、富文本聚合父目标为 BLOCKER，并新增
      「同一 checkpoint 结构化绑定 `target_element_id` ≠ 计划 `by_id`」这一唯一散文外冲突判据。
- [x] 6.5 T3：顶层 test-plan 模板/解析/结构门加入每 TC 唯一 `execution_channel`（含同 TC 重复行
      整体拒绝）；声明在任何 build/install/device 动作**之前**解析，不闭合即零设备动作；派生器只编译
      `hylyre` 集合、不写新 `explicit_skip_tc_ids`、任一 hylyre case 编译失败即整份不运行；
      首个 assertion 前必须有同 case action；derived/trace/timing 精确集合只取 `channel=hylyre`。
- [x] 6.5a T3 fail-closed 兜底：非 Hylyre 通道被移出精确对账后，必须由显式义务载体裁决——
      manual 按冻结设计无机器 PASS 载体；visual/provider 的 per-TC 证据绑定尚未建立，在建立前
      同样留在分母 FAIL/UNVERIFIED，不得靠报告行自称通过。
- [x] 6.2d T4 返修（2026-08-31，外部 review 之后）：`requireV1ForGate` 由类型断言改为
      三层 fail-closed（dispatch 键 → 冻结 `output-schema.json` 运行期校验 → 跨行不变量）；
      schema 取自随发布件下发的 vendored contracts（`harness/tests/**` 命中发布排除，不可作生产源）；
      `lite-json-schema` 补齐组合关键字并新增加载期 `auditSchemaSupport` fail-closed；
      新增 `hylyre-crossrow-verifier`（移植自冻结包 `reference_reducer.py::verify_trace`）；
      `device-test-run` 删除第二套 0.3 步骤形状与手写校验器；两个 required gate 由静默
      `return []` 改为显式 BLOCKER；`evaluateHylyreRunOutcome` 切断 legacy 中文 status 回落；
      Q5 artifact（含 realpath containment）接入 required gate，Q8 随跨行 verifier 进入生产；
      测试口径改为消费冻结包 golden 全集，新增 `hylyre-frozen-conformance` 套件。
- [x] 6.5b-1 T3 visual per-TC 证据绑定（`execution-channel-evidence.ts`）：
      TC 的结构化「关联 AC」→ acceptance checkpoint 的 pre/post_screen →
      **feature 目录**下 authoritative `visual-diff.json` 的同名 screen，
      并复用既有 `validateVisualDiffJson` / `isStaleVisualDiffVerdict` /
      `isMissingEvaluatedScreenshotHash` 复核截图 hash、build 指纹与评估新鲜度。
      门禁独立为 `checkChannelEvidenceObligation`，由主链在 **visual 检查之后**调用并消费
      本轮 `visual_diff` 的实际结论——证据义务不得早于证据产生。
      （返修记录：第一版读错路径（phase reports 而非 feature 目录）、自造只读 verdict 的
      弱解析器、门跑在 visual 之前，且测试正例绕过生产 loader 因而全没暴露；
      现测试全部走生产路径，含默认目录/旧 build/截图 hash 失配/缺 evaluated hash/
      evaluation_invalidated/手改极简 JSON 六类负例。）
- [x] 6.5b-2 scope disposition：provider per-TC binding 已转交独立 plan
      `e7cecd22`（`.cursor/plans/provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md`）；
      当前 change 不再跟踪其实现，也不新增未来 provider envelope 字段。现有行为继续冻结为
      fail-closed：feature/capability 级 resolved 不是 TC 执行证据，所有缺 per-TC machine evidence 的
      provider TC 仍为 FAIL/UNVERIFIED。该项完成的是 scope disposition，**不声称 binding 已实现**。
- [x] 6.5b-3 T3 manual：按冻结设计**永久 fail-closed**，无机器质量 PASS 载体。
- [x] 6.2c 0.3-p0 守卫迁移收口（曾于 2026-08-31 从 [x] 撤回——当时只完成信封层，
      合法 golden 仍被 native gate 拒绝；同日完成内核层返修后重新置为完成，判据见报告 §7）：
      G1–G12 与 F1–F6 全部改走 `requireV1ForGate`，
      旧 selector/routing 模块与 legacy telemetry 桥删除，最低版本/trace/协议门提升到
      0.5.0 / 0.4-p0 / hylyre.step-outcome/1（见 inventory §十）。
- [x] 6.4 T2 运行时部分：`hylyre-selector-gates-v1` 已接线——只消费身份事实与状态机
      不变量，不裁决成败、不做 canonical ui-spec 封闭世界判定。
- [x] 6.6 T4：最终 routing 只消费 typed v1 outcome（`collectFailureRoutesV1` 已接线，
      含 cause disposition 投影）。
- [x] 6.6b T4：复核发现的不是基数溢出而是**缺陷身份漂移**——route/disposition 的 check id
      原为位置序号（`testing_failure_routing_${index+1}`），而 `item_fingerprint` 由
      `(id, files, summary)` 派生，该指纹正是 goal 防震荡 attempted 集合的键与
      `roundFingerprintOfCandidates` 的输入。靠前缺陷被修掉后序号整体前移，同一缺陷
      换 id、换指纹 → 被当成全新候选重投，防震荡与"已尝试"记账同时失效。
      id 改为缺陷身份式（case + step，跨行 verifier 已保证 step index 唯一），
      并加回归直接钉"同一缺陷跨轮 id 与 item_fingerprint 稳定"。
      同轮修掉夹具 `failingTraceObject` 用 0.3 裸码 `assertion_mismatch` 的问题
      （冻结 domainCodeAgreement 要求首段等于 domain，应为 `assertion.mismatch`；
      原用例只断言 FAIL，被 schema 拒绝也是 FAIL，因此一直掩盖着）。
- [x] 6.7 T5：Phase 0 golden 已贯穿 normal required gates 与 `--report-reconcile-only`：
      normal 直接消费 vendored `bc-opencard-1` / blocked capability / device death /
      capture-unavailable 四份 trace，钉 route/disposition 基数、attempted infrastructure、
      failure-boundary 与 legacy/未知 schema fail-closed；report-only 正例与 native binding
      改为从 `all-passed.json` 派生宿主 identity，不再手拼 v1 trace，并继续由真实 CLI 证明
      trace 字节不变且零 provider/device/hook 调用。
- [x] 6.7a T7b 第一步：vendor 初次接入 0.5.0 plain-source（309 文件 / tree `351f61ab…1380`），
      `contracts_tree_sha256` 与冻结包三方一致，wheel 不引入；vendor README、keys.ts 头注、
      fields.md 版本节同步；vendor fake runner 端到端单测改断言 v1 并复核 dispatch 可接受。
      2026-09-01 同版本修复件整体替换为 309 文件 / tree `8f00a37f…d38d`；路径集合不变，
      5 个内容差异均属于 steps-file fake 接线/共享 builder/结果投影，contracts tree 不变。
- [x] 6.7b T7b：真实 0.5.0 source 的发布关键入口与非关键 smoke 已完成：
      - real plan / fake：vendored CLI 真实输出通过 `requireV1ForGate` + native evidence gate；
      - steps-file / fake：默认套件先源码级证明 fake return 早于 live session/Hypium，随后真实执行
        `run --steps-file --use-fakes`；零设备痕迹，产出 0.4-p0 + v1，Case/Run/reducer/tool_calls
        经两道生产门自洽，无 0.3 flat 字段；离线 assertion 如实 blocked/capability，CLI exit=1；
      - pre-run reject：exit=2、stdout 单一冻结 envelope、零设备、既有 trace/report 字节不变；
      - atomic / MCP / session：复用与 clean commit `0220b5d…` 和 source tree `8f00a37f…d38d`
        绑定的上游 Phase 1 conformance，分别以 FakeUiDriver、注入 agent、真实 FastMCP client
        端到端执行，3/0；不是 import smoke，也未移入 T8。
- [ ] 6.8 T7b/T8：真实 0.5.0 source 接入与宿主回灌收口（用户单独触发，不由本 change 的实施代理发起）。
