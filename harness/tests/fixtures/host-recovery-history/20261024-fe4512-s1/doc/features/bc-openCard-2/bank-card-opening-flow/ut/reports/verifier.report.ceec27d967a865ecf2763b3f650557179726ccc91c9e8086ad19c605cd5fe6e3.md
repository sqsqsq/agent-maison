| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| state_model_completeness | FAIL | MAJOR | `use-cases.yaml:47-59` 只有 `phases`，成功与失败均终止于过载态 `RESULT`，无 `fields/errorCode` 区分结果。 |
| ui_bindings_completeness | FAIL | MAJOR | `use-cases.yaml:25-46` 未绑定 `CardTypeSheet` 的卡型选择/继续动作；`expected_port_calls` 中的 `BankRepository`、`OtpService`、`OpeningNavigationService` 也未与边界/动作声明闭合。 |
| handler_reachable | FAIL | MAJOR | 声明的四个 calls 均为 UI 私有方法（`AddBankCardPage.ets:62`、`BankCardSelectionPage.ets:54`、`OtpVerificationSheet.ets:111`、`BankCardOpeningResultPage.ets:14`），UT 未直接驱动这些入口。 |
| end_to_end_driving | FAIL | BLOCKER | `[BRANCH-BR-SUCCESS]` 用例仅驱动 session 门禁（`bank_open_card_ut.test.ets:32-54`）；保存另在 `:163-185`，且没有用例覆盖 `OpeningNavigationService.finish`，不满足 `use-cases.yaml:53-59` 的完整阶段与调用序列。 |
| business_assertion_value | PASS | BLOCKER | `bank_open_card_ut.test.ets:66-84,126-146,163-207` 分别精确断言 OTP 状态/调用次数、事务序列、成功失败结果和回滚。 |
| mock_plan_traceability | WARN | BLOCKER | `mock-plan.yaml:18-40` 声明 `save_success/save_failure/list_empty/otp_send_success`，UT 以默认行为和 `shouldFail` 切换（`bank_open_card_ut.test.ets:163-185`），未按 preset 名显式追溯；当前未形成覆盖缺口。 |
| branch_coverage_semantic | FAIL | MAJOR | `acceptance.yaml:122-169` 定义 BD-1/2/3/4，但 `use-cases.yaml:49-59` 仅登记保存成功/失败两支，缺验证失败、倒计时重发和用户取消分支。 |
| device_ac_delegation | PASS | BLOCKER | `acceptance.yaml:13-15,33-35,53-55,73-75,94-96,114-116,131-169` 的 both/device 项均有可执行 `device_focus`，both 项同时有 `ut_focus`。 |
| stub_reasonableness | PASS | MAJOR | `SpyBankCardOpeningDependencies.ets:8-87` 替身字段和方法匹配模型/边界，异常由被测服务统一映射，且 Spy 未复制业务判断。 |
| test_isolation | PASS | MAJOR | `bank_open_card_ut.test.ets:32-227` 每个用例重新创建 session/service/spy；静态 completion context 在 `:115-120,152-155` 内显式清理。 |
| reference_crosscheck | FAIL | MAJOR | `use-cases.yaml:53-59` 要求完整阶段及 `OpeningNavigationService.finish`，但 `[BRANCH-BR-SUCCESS]` 标签实际只覆盖 session 门禁（测试 `:32-54`）；branch 标签含义与原文不一致。 |

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T17:09:28.418Z"
  checks:
    - id: state_model_completeness
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:47-59 仅声明 phases；
        BR-SUCCESS 与 BR-FAILURE 都以 RESULT 结束，且没有 fields、result/errorCode
        可区分成功与失败。SAVING 后的业务终态语义因此无法由状态模型核对。
      suggestion: |
        plan owner 在 use-cases.yaml 中补充成功/失败可区分的终态或结果字段，
        并让 expected_phase_seq 与该模型一致。
    - id: ui_bindings_completeness
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:25-41 覆盖入口页、选卡页、OTP 弹层和结果页，却遗漏实际参与流程的
        CardTypeSheet 及其卡型选择/继续入口。use-cases.yaml:54,59 又引用
        BankRepository.getCards、OtpService.sendMockCode、OpeningNavigationService.finish，
        但现有绑定/边界未完整表达这些调用的归属。
      suggestion: |
        plan owner 补齐 CardTypeSheet 的命名动作，并统一 ui_bindings、
        data_boundaries 与 expected_port_calls；路由仍作为协调动作表达，不混入数据边界。
    - id: handler_reachable
      status: FAIL
      severity: MAJOR
      details: |
        use-cases.yaml:29,33,37,41 声明的 openCardTypeSheet、
        openOtpVerificationSheet、saveSelectedCard、finishOpeningFlow 均是 UI 私有方法：
        AddBankCardPage.ets:62-66、BankCardSelectionPage.ets:54-59、
        OtpVerificationSheet.ets:111-126、BankCardOpeningResultPage.ets:14-16。
        bank_open_card_ut.test.ets 未调用这些声明入口，只分别测试底层 session/service。
      suggestion: |
        plan/coding owner 将 ui_bindings 指向可脱离 ArkUI 驱动的真实命名协调入口，
        或修订映射以准确反映当前可测业务入口；随后由 UT owner 调用该入口。
    - id: end_to_end_driving
      status: FAIL
      severity: BLOCKER
      details: |
        use-cases.yaml:53-54 要求成功分支经历
        ENTRY→TYPE_SELECTED→CARD_SELECTED→OTP_ACTIVE→SAVING→RESULT，
        并调用 BankRepository.getCards、OtpService.sendMockCode、
        BankCardRepository.save、OpeningNavigationService.finish。
        唯一带 [BRANCH-BR-SUCCESS] 的测试 bank_open_card_ut.test.ets:32-54
        只验证 BankCardOpeningSession 门禁，没有边界调用或保存/完成导航；
        :163-173 另测保存成功，也没有 OTP、阶段序列或 finish。
        因而没有任何一个 it 端到端驱动声明分支。
      suggestion: |
        若现有非 UI 协调入口不足，交 coding owner 建立可测的真实协调入口并重走 review；
        随后 UT owner 用 Spy 驱动单个成功/失败流程，断言中间/终态和完整调用序列。
    - id: mock_plan_traceability
      status: WARN
      severity: BLOCKER
      details: |
        mock-plan.yaml:18-40 的 preset id 未在 UT 中出现。SpyBankCardRepository
        通过 shouldFail（SpyBankCardOpeningDependencies.ets:23,31）切换分支，
        SpyOtpService 使用默认成功行为；语义覆盖存在，但 preset→分支→it 的名字级追溯不足。
        list_empty 也未在当前开卡 UT 中引用。
      suggestion: |
        UT owner 让 Spy 提供与 mock-plan 一致的命名 preset 方法或在测试中明确标注映射；
        若 list_empty 对当前分支不适用，则由 plan/UT owner从本 feature 的 mock-plan 移除。
    - id: branch_coverage_semantic
      status: FAIL
      severity: MAJOR
      details: |
        acceptance.yaml:122-169 明确 BD-1 输入不完整、BD-2 重发门禁、
        BD-3 持久化失败、BD-4 中途取消。use-cases.yaml:49-59 仅登记
        BR-SUCCESS 与 BR-FAILURE（保存失败），未把 BD-1、BD-2、BD-4 建模为分支。
        UT 虽有局部规则测试，但 use-case 分支规约仍不完整。
      suggestion: |
        plan owner为验证失败、重发门禁和用户取消补充分支及 linked_acceptance，
        再由 UT owner把现有局部用例或新增流程用例映射到这些分支。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        [BRANCH-BR-SUCCESS] 在 bank_open_card_ut.test.ets:32 标注于仅覆盖门禁的用例，
        与 use-cases.yaml:53-54 定义的完整成功序列及四个 expected_port_calls 不一致。
        use-cases.yaml:54,59 对 OpeningNavigationService.finish 的引用亦无对应 UT 调用证据。
      suggestion: |
        UT owner不要用完整 branch 标签标记局部规则测试；将标签放到真正覆盖完整分支的用例，
        或由 plan owner把规约拆成与实际可独立验证的分支/规则引用。
  summary:
    total: 11
    pass: 4
    fail: 6
    warn: 1
    blockers: 1
    verdict: FAIL
```

```issue-verification
- issue: UT-001
  verdict: confirmed
  evidence: "原问题/依据：已由 `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:68` 提供无 ArkUI 的 session。原修复建议：无；按现有入口补 UT。源码 `BankCardOpeningService.ets:68-125` 确有可独立实例化的 BankCardOpeningSession，UT `bank_open_card_ut.test.ets:32-54,90-109,213-226` 已覆盖门禁、取消和重置。"
```

```issue-verification
- issue: UT-002
  verdict: confirmed
  evidence: "原问题/依据：已由 `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets:22` 与 `:140` 提供 store/构造注入。原修复建议：无；用 Spy store 验证事务与幂等。源码 `BankCardRepository.ets:22-24,137-145` 确有 BankCardStore 与构造注入；UT `bank_open_card_ut.test.ets:126-146,191-207` 已断言事务、幂等与回滚序列。"
```

```issue-verification
- issue: UT-003
  verdict: confirmed
  evidence: "原问题/依据：已由 `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets:9` 提供 Phone 实际消费的纯函数入口。原修复建议：无；在 Phone ohosTest 覆盖新旧目的页。源码 `WalletDestinationRegistry.ets:9-17` 暴露目的页集合；测试 `WalletDestinationRegistry.test.ets:9-16` 同时断言旧入口及新增开卡目的页。"
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: ceec27d967a865ecf2763b3f650557179726ccc91c9e8086ad19c605cd5fe6e3
verdict: FAIL
blocker_count: 1
<!-- /maison-verifier-result:v1 -->
