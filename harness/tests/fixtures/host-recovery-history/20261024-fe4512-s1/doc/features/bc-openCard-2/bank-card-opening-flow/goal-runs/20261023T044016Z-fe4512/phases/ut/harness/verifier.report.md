| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| state_model_completeness | FAIL | MAJOR | `use-cases.yaml:47-59` 仅声明六个 phase，成功/失败均落入同一 `RESULT`，未声明 `success/errorMessage` 等判别字段；源码实际以 `openingResult` 区分结果（`BankCardOpeningService.ets:27-28,149-180`）。 |
| ui_bindings_completeness | FAIL | MAJOR | `use-cases.yaml:25-46` 缺少 `CardTypeSheet` 的选卡型/继续绑定，且 `data_boundaries` 只有 `BankCardRepository`，但同文件 `:54` 明示还调用 `BankRepository.getCards`、`OtpService.sendMockCode`。 |
| handler_reachable | FAIL | MAJOR | `use-cases.yaml:29,33,37,41` 的 calls 均指向 private UI 包装方法（如 `BankCardSelectionPage.ets:58`、`OtpVerificationSheet.ets:101`），UT 实际驱动的是 coordinator 方法 `begin/loadCandidates/startOtp/completeOpening`（`bank_open_card_ut.test.ets:179-191`），声明入口与可测业务入口不一致。 |
| end_to_end_driving | PASS | BLOCKER | 成功/失败流程均驱动真实 `BankCardOpeningService`，断言完整 phase 序列、结果与边界 callLog（`bank_open_card_ut.test.ets:165-249`）；其余用例为独立规则/持久化原子性测试。 |
| business_assertion_value | PASS | BLOCKER | happy path 同时断言状态序列、结果、三类边界调用及保存载荷（`bank_open_card_ut.test.ets:194-207`）；失败路径断言错误码、未保存及调用记录（`:236-249`）。 |
| mock_plan_traceability | WARN | BLOCKER | 保存成功/失败 DAG 正确引用 `save_success/save_failure`（两份 DAG `:25-31`），但 `cards_for_selected_bank`、`otp_send_success` 仅由 UT 等价赋值/默认行为实现（`bank_open_card_ut.test.ets:176,185`），DAG 无对应 preset 引用。 |
| branch_coverage_semantic | FAIL | MAJOR | `use-cases.yaml:49-59` 仅有保存成功/失败两支；acceptance 中倒计时重发、用户取消/返回等独立异常语义（`acceptance.yaml:135-169`）未形成 branch，虽 UT 在 `bank_open_card_ut.test.ets:68-110` 有局部覆盖。 |
| device_ac_delegation | PASS | BLOCKER | 所有 `both/device` 项均有可执行 `device_focus`，并与 `ut_focus` 分工（`acceptance.yaml:13-15,33-35,53-55,73-75,94-96,114-116,131-169`）。 |
| stub_reasonableness | PASS | MAJOR | 三个边界 Spy 使用真实模型类型并仅记录调用/注入成功失败，RDB store 覆盖事务回滚（`SpyBankCardOpeningDependencies.ets:10-99`）。 |
| test_isolation | PASS | MAJOR | 每个用例在本地重新构造 service/session/spy；静态完成上下文在消费测试前显式 clear（`bank_open_card_ut.test.ets:117-121`），无跨用例共享可变替身。 |
| reference_crosscheck | FAIL | MAJOR | failure DAG `:8-9,41-46` 将持久化失败错误地关联 `AC-6`，而 `AC-6` 是旧导航链回归（`acceptance.yaml:107-116`）；同时遗漏 use-case `BR-FAILURE` 声明的 `AC-5/BD-3` 对齐。 |

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:26:42.402Z"
  checks:
    - id: state_model_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:47-59 的成功与失败分支共享 RESULT，且 state_model 未声明结果判别字段。实际源码 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:27-28,149-180 通过 OpeningResult.success/errorMessage 区分结果，规约未表达这一语义。
      suggestion: |
        plan/use-case owner 在 state_model 中登记结果字段及其含义，明确 RESULT 下 success 与 errorMessage 的分支判别；无需为此新增状态机或 UseCase 类。
    - id: ui_bindings_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:25-41 未登记 CardTypeSheet 的卡型选择与继续动作；:42-46 仅登记 BankCardRepository，但 :54 的预期调用还包含 BankRepository.getCards 与 OtpService.sendMockCode。
      suggestion: |
        plan/use-case owner补齐 CardTypeSheet 绑定，并把 BankRepository、OtpService 作为真实外部依赖登记；导航仍保留为 UI/device 责任，不混入 data_boundaries。
    - id: handler_reachable
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:29,33,37,41 声明的是 private UI 包装方法；例如 BankCardSelectionPage.ets:58 的 openOtpVerificationSheet 与 OtpVerificationSheet.ets:101 的 saveSelectedCard。UT 按 UI 禁入规则实际驱动 BankCardOpeningService.begin/loadCandidates/startOtp/completeOpening（bank_open_card_ut.test.ets:179-191），因此 calls 并非本阶段可直接验证的命名业务入口。
      suggestion: |
        plan/use-case owner将 user_actions.calls 映射到对应的 coordinator 业务方法，UI 私有方法可作为触发位置说明；不要让 UT import ArkUI 页面。
    - id: mock_plan_traceability
      status: WARN
      severity: BLOCKER
      details: |
        save_success/save_failure 已由两份 DAG 的 save 节点引用；但 mock-plan.yaml:19-20 的 cards_for_selected_bank 与 :53-55 的 otp_send_success 没有 DAG spy_preset 引用，UT 仅以 bankRepository.cards 赋值和 SpyOtpService 默认成功表达同等预设（bank_open_card_ut.test.ets:176,185）。
      suggestion: |
        UT owner在下次维护流程 DAG 时，为候选加载和 OTP 发送节点补对应 spy_preset；当前真实断言与执行已覆盖，不阻塞闭环。
    - id: branch_coverage_semantic
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:49-59 仅登记 BR-SUCCESS 与 BR-FAILURE。acceptance.yaml:135-169 还定义倒计时重复发送、归零重发以及半模态关闭/页面返回清理；这些虽由 bank_open_card_ut.test.ets:68-110 验证，却未在 use-case branches 中表达。
      suggestion: |
        plan/use-case owner补充 OTP 重发边界与 user_cancel 分支，并关联 BD-2/BD-4；复用现有 UT，不新增平行流程实现。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        bank_card_opening_failure.dag.yaml:8,41-42 将保存失败关联到 AC-6，但 acceptance.yaml:107-116 的 AC-6 是旧导航链保持可用；该 DAG 同时未对齐 use-cases.yaml:55-59 为 BR-FAILURE 声明的 AC-5、BD-3。
      suggestion: |
        UT owner修正 failure DAG 的 linked_acceptance/linked_boundaries，使保存失败指向 AC-4、BD-3；真实导航回归 AC-6 保留在路由注册 UT 与 device testing。
  summary:
    total: 11
    pass: 5
    fail: 5
    warn: 1
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 70d5cfb7984adb3fe742db90409c6978a935e95cf8b1de4bf5a85bbab3393f6b
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
