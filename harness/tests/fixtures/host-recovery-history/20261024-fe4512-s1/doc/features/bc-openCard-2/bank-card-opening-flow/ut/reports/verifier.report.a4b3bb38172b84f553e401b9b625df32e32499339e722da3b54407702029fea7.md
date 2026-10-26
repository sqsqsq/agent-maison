| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| state_model_completeness | FAIL | MAJOR | `use-cases.yaml:47-58` 仅有共用 `RESULT` 且无 fields；`plan/plan.md:267-278` 明确区分 `ResultSuccess`、`ResultFailure`、取消回退与 `Completed`。 |
| ui_bindings_completeness | FAIL | MAJOR | `use-cases.yaml:25-46` 遗漏 `CardTypeSheet`，且只登记 `BankCardRepository`；`plan/plan.md:264` 明确列出四个数据边界。 |
| handler_reachable | FAIL | MAJOR | `use-cases.yaml:29-41` 的 calls 均指向 private UI 方法；UT 实际驱动的是 `BankCardOpeningService.begin/loadCandidates/startOtp/completeOpening`（`bank_open_card_ut.test.ets:179-192`）。 |
| end_to_end_driving | PASS | BLOCKER | `bank_open_card_ut.test.ets:165-208,210-250` 驱动真实 coordinator，断言完整阶段序列、结果、边界调用及持久化载荷。 |
| business_assertion_value | PASS | BLOCKER | `bank_open_card_ut.test.ets:34-315` 对门禁、掩码、OTP、取消、原子保存、成功/失败结果及清理均有可使错误实现失败的业务断言。 |
| mock_plan_traceability | FAIL | BLOCKER | `mock-plan.yaml:19-36` 的预设与实际替身不一致：`save_success` 声明返回固定对象、`save_failure` 抛 `RDB_SAVE_FAILED`，实际 Spy 返回输入并抛 `mock save failed`（`SpyBankCardOpeningDependencies.ets:41-47`）。 |
| branch_coverage_semantic | FAIL | MAJOR | `plan/plan.md:264,267-278` 要求非法输入、倒计时重发、中途取消及成功/失败终态；`use-cases.yaml:49-59` 仅登记保存成功和保存失败。 |
| device_ac_delegation | PASS | BLOCKER | `acceptance.yaml:13-15,33-35,53-55,73-75,94-96,114-116,131-169` 为所有 both/device AC/BD 提供了对应 `ut_focus`/`device_focus`。 |
| stub_reasonableness | PASS | MAJOR | `SpyBankCardOpeningDependencies.ets:10-99` 的替身字段、返回类型和调用日志与被替代接口一致，异常开关仅用于测试预设。 |
| test_isolation | PASS | MAJOR | `bank_open_card_ut.test.ets:34-315` 各用例均在用例体内新建 session/service/spy；静态完成上下文在使用前显式 clear。 |
| reference_crosscheck | FAIL | MAJOR | 失败 DAG 将保存失败关联到 `AC-6`（`bank_card_opening_failure.dag.yaml:8,42`），但 `acceptance.yaml:107-120` 的 AC-6 是既有导航注册回归；含义不一致。 |

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T17:27:51.667Z"
  checks:
    - id: state_model_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:47-58
        只声明 ENTRY、TYPE_SELECTED、CARD_SELECTED、OTP_ACTIVE、SAVING、RESULT，
        成功与失败共用 RESULT，且没有 success/errorCode/result 等 fields。
        doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:267-278
        则明确存在 ResultSuccess、ResultFailure、Completed 和两个取消回退分支。
      suggestion: |
        plan owner 修订 use-cases.yaml，使状态模型覆盖成功/失败终态、完成态和取消回退，
        并声明区分结果的字段；不要修改产品源码来迁就规约。
    - id: ui_bindings_completeness
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:25-41 未登记 plan/plan.md:179-188 的 CardTypeSheet；
        use-cases.yaml:42-46 仅登记 BankCardRepository，但 plan/plan.md:262-264
        明确该流程依赖 BankRepository、OtpService、BankCardRepository、
        OpeningNavigationService。
      suggestion: |
        plan owner 补齐 CardTypeSheet 绑定以及四个真实边界，并保持 UI/导航对象不混入
        data_boundaries。
    - id: handler_reachable
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:29-41 声明 openCardTypeSheet、openOtpVerificationSheet、
        saveSelectedCard、finishOpeningFlow；这些符号分别是 private UI 方法
        （AddBankCardPage.ets:62、BankCardSelectionPage.ets:58、
        OtpVerificationSheet.ets:97、BankCardOpeningResultPage.ets:14）。
        UT 未且按 UI 禁入规则不能直接调用它们；真实 UT 入口是
        BankCardOpeningService 的 begin/loadCandidates/startOtp/completeOpening
        （bank_open_card_ut.test.ets:179-192）。
      suggestion: |
        plan owner 将 user_actions.calls 映射到可由 UI 调用、UT 可直接驱动的既有
        coordinator 方法；UI 私有方法可作为接线事实保留在 contracts/plan 中。
    - id: mock_plan_traceability
      status: FAIL
      severity: BLOCKER
      details: |
        mock-plan.yaml:33-36 声明 save_success 返回一份固定 StoredCard，
        save_failure 抛出 Error('RDB_SAVE_FAILED')；实际
        SpyBankCardOpeningDependencies.ets:41-47 返回传入 card，
        失败时抛出 Error('mock save failed')。
        mock-plan.yaml:19-20 的 cards_for_selected_bank 还声明返回空数组，
        而成功流程在 bank_open_card_ut.test.ets:176 使用非空 candidate。
        因此 preset、实际替身和用例分支不是同一套语义。
      suggestion: |
        UT owner 统一 mock-plan、Spy 和用例：让预设准确表达并驱动当前 Spy 行为，
        或把 Spy 调整为显式选择这些预设；不得修改业务源码。
    - id: branch_coverage_semantic
      status: FAIL
      severity: MAJOR
      details: |
        plan/plan.md:264 明确分支包括成功、保存失败、非法输入、倒计时重发和中途取消，
        状态图 plan/plan.md:267-278 也包含取消回退及分裂终态；
        use-cases.yaml:49-59 仅登记 BR-SUCCESS、BR-FAILURE。
        虽然 UT 已覆盖部分规则，导航规约本身仍缺分支。
      suggestion: |
        plan owner 在 use-cases.yaml 补充非法输入、重发门禁与取消分支，
        并引用现有 AC/BD；随后让 DAG/UT 标签对齐这些 branch id。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        bank_card_opening_failure.dag.yaml:8,42 将保存失败分支关联 AC-6；
        acceptance.yaml:107-120 的 AC-6 实际要求既有导航目的地与往返链保持可用，
        与保存失败无关。该 DAG 的 AC 引用发生语义漂移。
      suggestion: |
        UT owner 从失败 DAG 移除 AC-6，保留 AC-4/BD-3 等真实关联；
        导航注册回归继续由 WalletDestinationRegistry.test.ets 的 AC-6 用例证明。
  summary:
    total: 11
    pass: 5
    fail: 6
    warn: 0
    blockers: 1
    verdict: FAIL
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: a4b3bb38172b84f553e401b9b625df32e32499339e722da3b54407702029fea7
verdict: FAIL
blocker_count: 1
<!-- /maison-verifier-result:v1 -->
