| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| state_model_completeness | FAIL | MAJOR | `use-cases.yaml:47-59` 仍以共用 `RESULT` 表示成功/失败且无 fields；`plan/plan.md:267-278` 区分 `ResultSuccess`、`ResultFailure`、取消回退与 `Completed`。 |
| ui_bindings_completeness | FAIL | MAJOR | `use-cases.yaml:25-46` 未登记 `CardTypeSheet`，且仅声明 `BankCardRepository`；`plan/plan.md:264` 声明四个流程边界。 |
| handler_reachable | FAIL | MAJOR | `use-cases.yaml:29-41` 的 calls 指向 private UI 方法；UT 实际驱动 `BankCardOpeningService` 方法（`bank_open_card_ut.test.ets:179-192`）。 |
| end_to_end_driving | PASS | BLOCKER | `bank_open_card_ut.test.ets:165-250` 驱动真实 coordinator，并断言完整阶段序列、结果、调用日志和持久化载荷。 |
| business_assertion_value | PASS | BLOCKER | `bank_open_card_ut.test.ets:34-315` 覆盖门禁、掩码、OTP、取消、原子保存及成功/失败结果，断言可识别错误实现。 |
| mock_plan_traceability | PASS | BLOCKER | `mock-plan.yaml:19-36` 已与实际 Spy 对齐：候选返回 `this.cards`、成功返回输入卡、失败抛 `mock save failed`（`SpyBankCardOpeningDependencies.ets:14-17,41-47`）。 |
| branch_coverage_semantic | FAIL | MAJOR | `plan/plan.md:264,267-278` 要求非法输入、重发、取消和分裂终态；`use-cases.yaml:49-59` 仍仅登记保存成功/失败。 |
| device_ac_delegation | PASS | BLOCKER | `acceptance.yaml:13-169` 为所有 both/device AC/BD 提供了对应 `ut_focus` 和 `device_focus`。 |
| stub_reasonableness | PASS | MAJOR | `SpyBankCardOpeningDependencies.ets:10-99` 的字段、返回类型、异常开关和调用日志与对应边界一致。 |
| test_isolation | PASS | MAJOR | `bank_open_card_ut.test.ets:34-315` 各用例独立创建 session/service/spy，静态完成上下文使用前显式清理。 |
| reference_crosscheck | FAIL | MAJOR | `bank_card_opening_failure.dag.yaml:8,42` 将保存失败关联到 AC-6，但 `acceptance.yaml:107-120` 的 AC-6 是既有导航链回归。 |

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T17:30:15.515Z"
  checks:
    - id: state_model_completeness
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:47-59 只声明共用 RESULT 且没有结果字段；
        plan/plan.md:267-278 明确区分成功、失败、完成和取消回退状态。
      suggestion: |
        由 plan owner 补齐状态和区分结果的字段；不要为此修改产品源码。
    - id: ui_bindings_completeness
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:25-46 未登记 CardTypeSheet，data_boundaries 仅包含
        BankCardRepository；plan/plan.md:262-264 明确列出 BankRepository、
        OtpService、BankCardRepository、OpeningNavigationService。
      suggestion: |
        由 plan owner 补齐 UI 绑定及真实数据边界。
    - id: handler_reachable
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:29-41 声明的 calls 是 private UI 方法；
        UT 按 UI 禁入约束实际驱动 bank_open_card_ut.test.ets:179-192 的
        BankCardOpeningService coordinator 方法。
      suggestion: |
        将 user_actions.calls 映射到既有、可直接测试的 coordinator 业务入口；
        UI 私有方法继续作为接线事实记录。
    - id: branch_coverage_semantic
      status: FAIL
      severity: MAJOR
      details: |
        plan/plan.md:264,267-278 要求成功、保存失败、非法输入、倒计时重发、
        中途取消以及成功/失败终态；use-cases.yaml:49-59 仅有两个保存分支。
      suggestion: |
        由 plan owner 补充其余 branch，并引用现有 AC/BD 和对应 UT。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        bank_card_opening_failure.dag.yaml:8,42 将保存失败关联 AC-6；
        acceptance.yaml:107-120 的 AC-6 实际是既有导航注册和往返链回归。
      suggestion: |
        从失败 DAG 移除 AC-6，保留 AC-4/BD-3 等真实关联。
  summary:
    total: 11
    pass: 6
    fail: 5
    warn: 0
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 678e41878826f95d36ad11f3437e530f91db4a149b93bb5fa3bd6ce0040ccf59
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
