| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| five_layer_compliance | PASS | BLOCKER | `plan/plan.md:55-69` 的 Phone→WalletMain/AccountManager、WalletMain→AccountManager/SystemBase、AccountManager→SystemBase 均符合 `doc/architecture.md:52-68`。 |
| module_internal_layer_compliance | PASS | BLOCKER | `plan/plan.md:75-120` 将模型、Repository、Service、页面/组件分别置于 data、domain、presentation，并约定跨模块经 `index.ets`。 |
| module_minimality | PASS | MAJOR | `plan/plan.md:63-67` 仅修改 WalletMain、AccountManager、Phone，与 `change-unit.yaml:210-290` 的 CU touches 一致。 |
| feature_split_accuracy | PASS | MAJOR | `plan/plan.md:42-49` 的职责拆分对应 `component-blueprint.yaml:556-562,901-933` 的 WalletMain、Phone、AccountManager owner。 |
| data_type_legality | PASS | BLOCKER | `plan/plan.md:127-168` 仅使用 ArkTS 基础类型、`Resource`、已定义枚举、数组与合法可空类型。 |
| no_tbd_in_p0_p1 | PASS | BLOCKER | 三份 plan 产物未发现 P0/P1 未决标记；`plan/plan.md:123` 的“后续 UT 阶段”是已确定的阶段归属。 |
| architecture_doc_consistency | PASS | MAJOR | `plan/plan.md:30-40` 明确 `architecture_impact: none`，且分层、依赖和 `index.ets` 出口与 `doc/architecture.md:48-68` 一致。 |
| navigation_flow_consistency | PASS | MAJOR | `plan/plan.md:283-304` 覆盖双入口、选卡、OTP、成功回首页及失败回 AddBankCardPage，与 `spec/spec.md:188-205` 一致。 |
| acceptance_to_interface | FAIL | MAJOR | `acceptance.yaml:46-55,135-145` 的可隔离倒计时/重发义务未进入 `plan.md:231,239-256`、`contracts.yaml:120-123,187-199`、`use-cases.yaml:34-59` 的施工契约。 |
| reference_crosscheck | PASS | MAJOR | `plan/plan.md:310-318` 的 F1–F7 对应 `spec/spec.md:113-123`；模块与出口引用对应 `contracts.yaml:6-28`、`doc/architecture.md:68,76-82`。 |

```yaml
verification_result:
  phase: "plan"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-26T08:23:43.208Z"
  checks:
    - id: acceptance_to_interface
      status: FAIL
      severity: MAJOR
      acceptance_ids: [AC-3, BD-2]
      affected_files:
        - doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md
        - doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml
        - doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml
      details: |
        `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:46-55` 要求 UT 可驱动六位数字校验、60 秒倒计时状态机和重发门禁，`:135-145` 进一步要求验证倒计时期间重复点击被忽略、归零后一次点击重启。当前 `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:231` 仍把 otp/countdown/sending 描述为 UI `@State + setInterval`，`:239-256` 只列 `OtpService.sendMockCode`，没有状态推进、重发、输入更新、提交门禁与取消入口。`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:120-123,187-199` 和 `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:34-59` 同样只契约发送接口及 UI 事件。真实生产入口已经存在于 `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets:11-84` 的 `OtpVerificationState`，并由 `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:70-115,184-202` 委托，但 plan 产物未承诺这些可隔离业务接口，无法保证 AC-3/BD-2 的 unit 层验收。
      suggestion: |
        由 plan 责任方同步修改 plan.md、contracts.yaml 和 use-cases.yaml：契约化 `OtpVerificationState.start/resend/tick/updateOtp/canSubmit/cancel`，以及生产调用实际使用的 `BankCardOpeningService.startOtp/resendOtp/tickOtp/updateOtp/canSubmit/cancelOtp`；在用例端口调用中覆盖首次发送、倒计时推进、重复重发拒绝、归零重启、合法输入与取消生命周期。UI 仅负责时钟驱动和响应式投影。
  summary:
    total: 10
    pass: 9
    fail: 1
    warn: 0
    blockers: 0
    verdict: PASS
```

```issue-verification
- issue: acceptance_to_interface
  verdict: confirmed
  repair_owner: plan
  evidence: doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md、contracts.yaml、use-cases.yaml | AC-3/BD-2 明确要求 unit 可驱动倒计时状态机和重发门禁；真实非 UI 状态对象及生产委托入口存在于 OtpService.ets:11-84、BankCardOpeningService.ets:70-115,184-202，但三份施工契约仍只声明 sendMockCode 与 UI @State/事件。 | plan 责任方应将 OTP 状态接口、生产委托入口和对应端口调用完整写入三份产物。
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 75dbc0c98f4e64523e441d554a0cb6da4dda9c11bd1cab61a9b6dc13dbb9ab0c
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
