| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| five_layer_compliance | PASS | BLOCKER | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:55-69` 的依赖边符合 `doc/architecture.md:52-68`。 |
| module_internal_layer_compliance | PASS | BLOCKER | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:75-120` 将模型、Repository、Service、页面/组件分别置于 data、domain、presentation。 |
| module_minimality | PASS | MAJOR | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:63-67` 仅修改 WalletMain、AccountManager、Phone，与 CU touches 投影一致。 |
| feature_split_accuracy | PASS | MAJOR | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:42-49,310-316` 将开卡业务归 WalletMain、账号手机号归 AccountManager、目的页装配归 Phone。 |
| data_type_legality | PASS | BLOCKER | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:127-168` 仅使用 ArkTS 基础类型、`Resource`、已定义枚举、数组与合法可空类型。 |
| no_tbd_in_p0_p1 | PASS | BLOCKER | 三份 plan 产物未发现 P0/P1 未决标记；`doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:123` 的“后续 UT 阶段”是已确定的阶段归属。 |
| architecture_doc_consistency | PASS | MAJOR | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:30-40` 声明 `architecture_impact: none`。 |
| navigation_flow_consistency | PASS | MAJOR | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:283-304` 覆盖双入口、选卡、OTP、成功回首页及失败回 AddBankCardPage。 |
| acceptance_to_interface | FAIL | MAJOR | `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:46-55,135-145` 的可隔离 OTP 状态机义务未进入三份 plan 责任产物。 |
| reference_crosscheck | PASS | MAJOR | `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:310-316` 的 F1–F7 对应验收条目，模块、依赖和出口引用对应 `contracts.yaml:6-28` 与 `doc/architecture.md:48-82`。 |

```yaml
verification_result:
  phase: "plan"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-26T08:27:53.292Z"
  checks:
    - id: acceptance_to_interface
      status: FAIL
      severity: MAJOR
      acceptance_ids: [AC-3, BD-2]
      affected_files:
        - doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml
        - doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md
        - doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml
      details: |
        验收要求：`doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:46-55` 将 AC-3 定义为 `ut_layer: both`，要求 UT 可驱动六位数字校验、60 秒倒计时状态机和重发门禁；`doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:135-145` 将 BD-2 定义为 `ut_layer: both`，要求倒计时期间重复发送被忽略、归零后一次点击重启 60 秒。责任产物缺口：`doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:231` 仍将 mobile、otp、countdown、sending、saving 设计为 OtpVerificationSheet 持有的 UI `@State + setInterval`；`doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:239-256` 仅列出 `OtpService.sendMockCode` 和静态 `isValidOtp`，未声明状态推进、重发、输入更新、提交门禁与取消接口。`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:120-123` 仅契约 `OtpService.sendMockCode`，`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:234-243` 仍把倒计时、重发门禁、输入和清理由 OtpVerificationSheet/Timer 承担。`doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:34-59` 仅登记 `submit_otp → saveSelectedCard` 及 `OtpService.sendMockCode`，没有首次发送、tick、倒计时内拒绝重发、归零重启、输入过滤、提交门禁或取消的可驱动端口调用。现有源码真实入口：`02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets:11-84` 已实现 `OtpVerificationState.start/resend/tick/updateOtp/canSubmit/cancel`；`02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:70-115,184-202` 已通过 `startOtp/resendOtp/tickOtp/updateOtp/canSubmit/cancelOtp` 委托这些状态能力。因此缺口是三份 plan 责任产物未契约当前真实生产入口，不能据其保证 AC-3/BD-2 的 unit 层验收。
      suggestion: |
        由 plan 责任方同步修改 `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md`、`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml` 和 `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml`：契约化 `OtpVerificationState.start/resend/tick/updateOtp/canSubmit/cancel` 以及生产调用实际使用的 `BankCardOpeningService.startOtp/resendOtp/tickOtp/updateOtp/canSubmit/cancelOtp`；在用例端口调用中覆盖首次发送、倒计时推进、重复重发拒绝、归零重启、合法输入与取消生命周期。UI 仅负责时钟驱动和响应式投影。
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
  evidence: doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml、doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md、doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml | 验收要求：`doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:46-55` 将 AC-3 定义为 `ut_layer: both`，要求 UT 可驱动六位数字校验、60 秒倒计时状态机和重发门禁；`doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml:135-145` 将 BD-2 定义为 `ut_layer: both`，要求倒计时期间重复发送被忽略、归零后一次点击重启 60 秒。责任产物缺口：`doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:231` 仍将 mobile、otp、countdown、sending、saving 设计为 OtpVerificationSheet 持有的 UI `@State + setInterval`；`doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md:239-256` 仅列出 `OtpService.sendMockCode` 和静态 `isValidOtp`，未声明状态推进、重发、输入更新、提交门禁与取消接口。`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:120-123` 仅契约 `OtpService.sendMockCode`，`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:234-243` 仍把倒计时、重发门禁、输入和清理由 OtpVerificationSheet/Timer 承担。`doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml:34-59` 仅登记 `submit_otp → saveSelectedCard` 及 `OtpService.sendMockCode`，没有首次发送、tick、倒计时内拒绝重发、归零重启、输入过滤、提交门禁或取消的可驱动端口调用。现有源码真实入口：`02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets:11-84` 已实现 `OtpVerificationState.start/resend/tick/updateOtp/canSubmit/cancel`；`02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:70-115,184-202` 已通过 `startOtp/resendOtp/tickOtp/updateOtp/canSubmit/cancelOtp` 委托这些状态能力。因此缺口是三份 plan 责任产物未契约当前真实生产入口，不能据其保证 AC-3/BD-2 的 unit 层验收。；由 plan 责任方同步修改 `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md`、`doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml` 和 `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml`：契约化 `OtpVerificationState.start/resend/tick/updateOtp/canSubmit/cancel` 以及生产调用实际使用的 `BankCardOpeningService.startOtp/resendOtp/tickOtp/updateOtp/canSubmit/cancelOtp`；在用例端口调用中覆盖首次发送、倒计时推进、重复重发拒绝、归零重启、合法输入与取消生命周期。UI 仅负责时钟驱动和响应式投影。 | 当前源码已经提供无需 UI runtime 即可驱动的 OTP 状态入口，AC-3/BD-2 的 unit/both 义务有效；三份施工契约尚未投影这些真实入口，故问题确认且 repair_owner 为 plan。
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: c1c2dd1567e9d06ebbffc8bcc8e4515e3f6231f6a940e070916149bf6088dfd8
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
