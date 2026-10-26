| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| state_model_completeness | FAIL | MAJOR | `use-cases.yaml:47-58` 仅声明六个 phase，未声明 `fields`；成功与失败均终止于 `RESULT`，没有 `success/errorCode` 字段区分结果语义。 |
| ui_bindings_completeness | FAIL | MAJOR | `use-cases.yaml:25-46` 缺少 `CardTypeSheet` 绑定，且 `data_boundaries` 只登记 `BankCardRepository`，而 `:54-59` 又声明 `BankRepository/OtpService/OpeningNavigationService` 调用。 |
| handler_reachable | FAIL | MAJOR | `use-cases.yaml:29-41` 的四个 calls 均为 UI 私有方法；UT 实际驱动的是 `BankCardOpeningService` 方法（`bank_open_card_ut.test.ets:179-191`），未直接调用任何已声明 handler。 |
| end_to_end_driving | PASS | BLOCKER | `bank_open_card_ut.test.ets:165-250` 通过 coordinator 完整驱动成功/失败分支，断言六阶段迁移、完整卡号及 repository/OTP 调用记录；其余目标为可独立判错的单规则测试。 |
| business_assertion_value | PASS | BLOCKER | `bank_open_card_ut.test.ets:194-207,236-249,280-295` 同时断言状态序列、业务结果、调用序列和回滚/无半写语义。 |
| mock_plan_traceability | WARN | BLOCKER | `mock-plan.yaml:19-55` 的 cards/save/OTP presets 均有等价 Spy 行为，但 `list_empty`（`:41-42`）未被 DAG 或 UT 使用。 |
| branch_coverage_semantic | FAIL | MAJOR | `acceptance.yaml:123-169` 定义 BD-1、BD-2、BD-4 异常语义；`use-cases.yaml:49-59` 仅有保存成功/失败两个 branches，未登记输入门禁、重复发送和取消分支。 |
| device_ac_delegation | PASS | BLOCKER | `acceptance.yaml:5-169` 的所有 `both/device` 项均有非空 `device_focus`，`both` 项同时具有 `ut_focus`；AC-5 明确委派真实导航栈与返回手势。 |
| stub_reasonableness | PASS | MAJOR | `SpyBankCardOpeningDependencies.ets:10-99` 的替身字段和返回类型与生产边界一致，条件仅用于选择失败 preset，并完整记录保存、事务和回滚调用。 |
| test_isolation | PASS | MAJOR | `bank_open_card_ut.test.ets:165-250` 每个流程用例独立创建 service/spy/session；`bank_list_legacy_ut.test.ets:21-27` 在 `beforeEach` 重建 repository 与 spy。 |
| reference_crosscheck | FAIL | MAJOR | failure DAG `:8` 将保存失败错误关联到 AC-6，但 `use-cases.yaml:55-59` 的 BR-FAILURE 关联 AC-4/AC-5/BD-3；success DAG `:8-9` 又把仅驱动 `saveCandidate` 的图关联到 AC-1/2/3 与 BD-1/2/4。 |

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T18:26:08.939Z"
  checks:
    - id: state_model_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:47-58
        只列出 ENTRY→RESULT 的阶段集合，未声明 state_model.fields；BR-SUCCESS 与
        BR-FAILURE 使用相同终态序列，无法从状态模型区分成功、失败及 RDB 错误码。
      suggestion: |
        plan/use-case owner 在 state_model 补充 resultSuccess、errorCode 等实际业务字段，
        并为两个结果分支声明对应字段预期；无需修改产品源码。
    - id: ui_bindings_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:25-46
        流程绑定包含入口页、选卡页、OTP 和结果页，但遗漏实际承载卡型单选与继续动作的
        CardTypeSheet。data_boundaries 仅声明 BankCardRepository，然而同文件 :54-59
        的 expected_port_calls 还引用 BankRepository、OtpService 和 OpeningNavigationService。
      suggestion: |
        plan/use-case owner补齐 CardTypeSheet 绑定，并使 data_boundaries 与实际外部边界、
        expected_port_calls 保持同一套声明。
    - id: handler_reachable
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:29-41 声明
        openCardTypeSheet/openOtpVerificationSheet/saveSelectedCard/finishOpeningFlow。
        它们分别是 AddBankCardPage.ets:64、AllBanksPage.ets:67、
        BankCardSelectionPage.ets:58、OtpVerificationSheet.ets:97 和
        BankCardOpeningResultPage.ets:14 的 UI 私有方法；UT 则在
        bank_open_card_ut.test.ets:179-191 驱动 BankCardOpeningService 的公开业务方法，
        没有直接调用上述 calls。
      suggestion: |
        plan/use-case owner把可由 UT 消费的业务动作映射到 coordinator 方法，并保留 UI
        私有方法作为设备层绑定；不要为满足 UT 而暴露或修改 UI 私有方法。
    - id: mock_plan_traceability
      status: WARN
      severity: BLOCKER
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/ut/mock-plan.yaml:41-42
        声明 list_empty，但两份 flow DAG 仅引用 save_success/save_failure，当前 UT 也未调用
        SpyBankCardRepository.list。其余 cards_for_selected_bank、save_success/save_failure、
        otp_send_success 均可对应到 bank_open_card_ut.test.ets:176-207,210-249 的等价 Spy 设置。
      suggestion: |
        UT owner 删除无当前场景用途的 list_empty preset，或在确有 list 空态验收义务时补充
        对应 DAG/UT 引用。
    - id: branch_coverage_semantic
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:123-169 定义了输入不完整、
        倒计时内重复发送和中途取消三类边界；use-cases.yaml:49-59 只登记保存成功与保存失败，
        尽管 bank_open_card_ut.test.ets:34-55,68-85,92-110 已实际测试这些规则。
      suggestion: |
        plan/use-case owner补登记 BD-1、BD-2、BD-4 对应 branches，并链接现有 UT；无需新增
        重复测试。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        ut/reports/flow-dag/bank_card_opening_failure.dag.yaml:8 将保存失败图链接 AC-6，
        但 AC-6 在 acceptance.yaml:107-120 是旧导航链回归，且 BR-FAILURE 在
        use-cases.yaml:55-59 只链接 AC-4、AC-5、BD-3。success DAG :8-9 以 saveCandidate
        为入口，却链接 AC-1/2/3 和 BD-1/2/4，节点并未驱动这些选择、OTP 与取消规则。
      suggestion: |
        UT owner收窄两份 DAG 的 linked_acceptance/linked_boundaries 至节点实际覆盖范围；
        其他规则由现有独立 UT 或新增的对应 branch/DAG 建立引用。
  summary:
    total: 11
    pass: 5
    fail: 5
    warn: 1
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 3156e8875702299d4468b153f91edf6210baccc22d88c1847fd58aed9d329a37
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
