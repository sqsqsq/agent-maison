| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| state_model_completeness | FAIL | MAJOR | `use-cases.yaml:47-59` 仅声明阶段，成功与失败共用 `RESULT`，没有 `success/errorCode` 等字段区分终态。 |
| ui_bindings_completeness | FAIL | MAJOR | `use-cases.yaml:25-46` 遗漏实际流程中的 `CardTypeSheet`，且分支声明的 `BankRepository/OtpService/OpeningNavigationService` 未进入 `data_boundaries`。 |
| handler_reachable | FAIL | MAJOR | `use-cases.yaml:29-41` 的四个 calls 均为私有 UI 方法；UT 未调用它们，`BankCardOpeningService.ets:11-64` 也没有覆盖完整流程的协调入口。 |
| end_to_end_driving | FAIL | BLOCKER | `bank_open_card_ut.test.ets:32-84,163-185` 分别测试 session、OTP、保存片段，没有一个用例驱动 `use-cases.yaml:53-59` 的完整阶段与边界序列。 |
| business_assertion_value | PASS | BLOCKER | `bank_open_card_ut.test.ets:66-84,126-146,163-207` 对门禁、倒计时、事务序列、成功/失败结果及回滚均有可使错误实现失败的精确断言。 |
| mock_plan_traceability | WARN | BLOCKER | `mock-plan.yaml:38-40` 的 `otp_send_success` 未被 DAG 以 `spy_preset` 引用；两条 DAG 仅引用 `save_success/save_failure`。 |
| branch_coverage_semantic | WARN | MAJOR | `use-cases.yaml:49-59` 只有保存成功/失败分支；`acceptance.yaml:122-169` 的输入不完整、重复发送和中途取消没有对应 branch。 |
| device_ac_delegation | PASS | BLOCKER | `acceptance.yaml:5-169` 所有 `both/device` AC、BD 均有非空 `device_focus`，`both` 项同时具有 `ut_focus`。 |
| stub_reasonableness | PASS | MAJOR | `SpyBankCardOpeningDependencies.ets:8-87` 覆盖 `sendMockCode/save/list` 及存储事务方法，字段和值域与生产模型一致且只做预设回放和调用记录。 |
| test_isolation | PASS | MAJOR | `bank_open_card_ut.test.ets:32-225` 各用例重新创建 session/service/spy；静态 completion context 在使用前清理并被消费或再次清理。 |
| reference_crosscheck | FAIL | MAJOR | 失败 DAG `:8,42` 引用 `AC-6`，但 `use-cases.yaml:57` 的 `BR-FAILURE` 关联 `AC-4/AC-5/BD-3`；成功 DAG也遗漏分支关联的 `AC-5`。 |

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T17:12:37.109Z"
  checks:
    - id: state_model_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:47-59
        只定义 phases，成功与失败分支使用完全相同的阶段序列和 RESULT 终态，
        没有 success、errorCode 或 failureReason 字段表达分支结果。
      suggestion: |
        plan/use-cases owner 应补充结果字段或区分终态，并使每条分支的预期状态序列与之对齐。
    - id: ui_bindings_completeness
      status: FAIL
      severity: MAJOR
      details: |
        contracts.yaml:235-243 明确流程包含 CardTypeSheet、候选加载、OTP 发送、保存和完成导航；
        use-cases.yaml:25-46 未绑定 CardTypeSheet，data_boundaries 也仅声明 BankCardRepository，
        与 branches.expected_port_calls 中的 BankRepository、OtpService、OpeningNavigationService 不一致。
      suggestion: |
        plan/use-cases owner 补齐 CardTypeSheet 绑定，并按 contracts 的真实流程重新登记外部边界；
        路由等非数据依赖应以适合其性质的设计表达，不要伪装成存储边界。
    - id: handler_reachable
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:29-41 声明 openCardTypeSheet、openOtpVerificationSheet、
        saveSelectedCard、finishOpeningFlow；源码分别位于 AddBankCardPage.ets:62-66、
        BankCardSelectionPage.ets:54-59、OtpVerificationSheet.ets:111-126、
        BankCardOpeningResultPage.ets:14-16，均是私有 UI 方法。
        bank_open_card_ut.test.ets 未调用这些入口，而 BankCardOpeningService.ets:11-64
        只提供规则转换和单次保存，不承载声明的完整协调语义。
      suggestion: |
        先由 plan owner 消除 contracts.yaml 与 use-cases.yaml 对协调责任的冲突：
        若完整协调属于 domain，则登记真实协调契约后交 coding 实现；
        若仍由页面分段协调，则修订 use-case 和 UT 目标，不以 UT 反推未设计的生产入口。
    - id: end_to_end_driving
      status: FAIL
      severity: BLOCKER
      details: |
        use-cases.yaml:53-59 要求 ENTRY→TYPE_SELECTED→CARD_SELECTED→OTP_ACTIVE→SAVING→RESULT，
        成功分支还要求四个依赖调用。bank_open_card_ut.test.ets:32-84 分段验证 session 与 OTP，
        :163-185 仅从 saveCandidate 驱动一次保存；没有任何 it 同时驱动完整阶段、
        断言中间态并核对完整调用序列，且缺少 BR-SUCCESS/BR-FAILURE 用例标签。
      suggestion: |
        由 plan owner先裁定完整流程的真实协调责任。若保留 use-cases.yaml 当前语义，
        coding owner 应按重签后的 contracts 提供非 UI 协调入口，再由 UT owner各写一个
        BR-SUCCESS/BR-FAILURE 流程用例，断言阶段迁移、边界顺序和最终结果。
    - id: mock_plan_traceability
      status: WARN
      severity: BLOCKER
      details: |
        mock-plan.yaml:38-40 定义 otp_send_success，但 success/failure DAG 均未引用该 preset；
        两条 DAG 只从 OTP_ACTIVE 开始并引用 save_success/save_failure。
        UT 的 SpyOtpService 默认成功行为语义可用，但 preset→DAG→UT 的名称追踪不完整。
      suggestion: |
        在上游协调模型确定后，让涉及 OTP 的 DAG 节点显式引用 otp_send_success，
        或删除不属于目标流程的孤立 preset；避免在设计未裁定前扩充替身体系。
    - id: branch_coverage_semantic
      status: WARN
      severity: MAJOR
      details: |
        use-cases.yaml:49-59 仅建模保存成功和失败。
        acceptance.yaml:122-169 另有 BD-1 输入不完整、BD-2 重复发送、BD-4 中途取消；
        当前材料未说明这些异常为何不属于 UC-1 的 branches。
      suggestion: |
        plan/use-cases owner明确这些异常是 UC-1 分支还是独立规则；属于流程分支的补 branch id、
        phase sequence 与 not_called，纯状态规则则明确其独立测试边界。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        bank_card_opening_failure.dag.yaml:8,42 将 BR-FAILURE 关联 AC-6，
        但 use-cases.yaml:57 将该分支关联 AC-4、AC-5、BD-3，且 acceptance.yaml:107-120
        的 AC-6 是旧导航链回归，并非保存失败。
        bank_card_opening_success.dag.yaml:8,42 也遗漏 use-cases.yaml:52 声明的 AC-5；
        UT 中没有 BR-SUCCESS/BR-FAILURE 标签。
      suggestion: |
        UT owner在上游语义裁定后统一 use-case、DAG 和测试标签：
        失败分支改回 AC-4/AC-5/BD-3，成功分支补齐或合理拆分 AC-5，并增加对应 branch 用例。
  summary:
    total: 11
    pass: 4
    fail: 5
    warn: 2
    blockers: 1
    verdict: FAIL
```

```issue-verification
- issue: UT-004
  verdict: unclear
  evidence: doc/features/bc-openCard-2/bank-card-opening-flow/ut/testability-audit.md:62；原问题/依据＋修复建议：`doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:53` 要求成功分支经历完整阶段并调用四个边界，但 `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:11` 仅提供转换、保存与分离的 session，当前没有一个可脱离 ArkUI 驱动完整分支的真实入口。；在现有 service 内补齐最小协调入口和可注入完成策略，页面消费该入口；完成 coding 后定向 review，再回 UT 写单个成功/失败分支用例。事实核对：use-cases.yaml:53-59 确实声明完整阶段和多边界序列，而 BankCardOpeningService.ets:11-126 没有相应协调入口；但 contracts.yaml:234-243 明确把完整流程编排分散给 CardTypeSheet、BankCardSelectionPage、OtpVerificationSheet 和结果页，且 contracts.yaml:98-108 未登记完整协调方法。因此“当前无法按 use-case 做端到端 UT”成立，但直接归责 coding 并新增协调入口与现行 contracts 冲突；应先由 plan/use-cases owner裁定并重签责任，再决定是否产生 coding repair。
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 2b978a65cde9d86a01a9ce3359f339aef6123f799bf985126a12c0478412c85c
verdict: FAIL
blocker_count: 1
<!-- /maison-verifier-result:v1 -->
