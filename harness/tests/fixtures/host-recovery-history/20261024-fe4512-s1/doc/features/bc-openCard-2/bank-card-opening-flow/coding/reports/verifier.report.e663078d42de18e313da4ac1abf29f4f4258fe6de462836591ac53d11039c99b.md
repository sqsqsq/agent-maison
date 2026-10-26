| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/summary.json`：`coding_run_status.status=PASS`、`can_claim_done=true`、`coding_compile: PASS`。 |
| business_logic_correctness | PASS | MAJOR | `CardTypeSheet.ets:7-24,126-139` 显式选择后才继续；`OtpVerificationSheet.ets:98-117` 保存成功/失败统一生成结果；`OpeningNavigationService.ets:7-15` 按结果定向清栈。 |
| error_handling_completeness | PASS | MAJOR | `CardTypeSheet.ets:21-24`、`BankCardSelectionPage.ets:46-50`、`OtpVerificationSheet.ets:44-57,98-117`、`BankCardRepository.ets:47-76` 分别覆盖 BD-1～BD-4 的门禁、重发、保存异常和取消生命周期。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:86-144` 与 `BankCardRepository.ets:47-128`、`BankCardOpeningService.ets:7-40`、`OpeningNavigationService.ets:7-15`、`OtpService.ets:2-5` 的类、参数及返回类型一致。 |
| component_props_consistency | WARN | MAJOR | `contracts.yaml:187-199` 登记事件名 `resendCode`，实际实现为 `OtpVerificationSheet.ets:44-57` 的 `sendCode`；行为存在但契约命名漂移。 |
| data_ownership_compliance | PASS | MAJOR | `OtpVerificationSheet.ets:105-110` 通过 Repository 持久化；mock 候选集中在 `BankRepository.ets:9-209`，presentation 未直接操作 RDB/AppStorage。 |
| simulation_data_isolation | PASS | MINOR | `BankRepository.ets:9-209`、`OtpService.ets:1-5`、`AccountService.ets:9,45,63` 封装银行、卡片、短信和手机号 mock，页面未判断 `isMock`。 |
| spec_acceptance_to_code | WARN | MAJOR | AC-1～AC-6 均有静态入口，但 AC-3 的倒计时/重发状态机仅存在于私有 ArkUI 方法 `OtpVerificationSheet.ets:44-77`，尚缺无需 UI runtime 可直接驱动的真实业务入口；应由后续 UT 阶段核实覆盖能力。 |
| reference_crosscheck | PASS | MAJOR | `string.json:376-377` 的两个格式参数由 `BankCardSelectionPage.ets:175` 传入当前银行名和卡型；路由常量由 `Phone/pages/index.ets:29-36` 与 WalletMain 导出共同装配。 |
| visual_parity_backstop | WARN | MAJOR | `spec/reports/fidelity-intent.json` 为 `pixel_1to1 + best_effort`；脚本 visual parity PASS，但 `BankCardOpeningResultPage.ets:54-59` 仍使用已披露的引导占位图，且 ui-spec 保持 unverified。 |
| visual_multimodal_parity | SKIP | MAJOR | 视觉多模态层已降级（adapter 不支持图像）。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T16:38:15.922Z"
  checks:
    - id: component_props_consistency
      status: WARN
      severity: MAJOR
      details: |
        `doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:187-199`
        将验证码重发事件登记为 `resendCode`，源码实际命名为
        `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets:44-57`
        的 `sendCode`。按钮在 `:179-191` 确实调用该实现，属于命名漂移，当前没有证据表明产品行为缺失。
      suggestion: |
        由 plan/契约责任方在后续合法修订中把事件名与实际命名统一；不要为纯命名漂移改动已工作的交互。
    - id: spec_acceptance_to_code
      status: WARN
      severity: MAJOR
      details: |
        AC-3/BD-2 声明 `ut_layer: both`，但倒计时、归零与重发门禁目前只在
        `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets:44-77`
        的私有 ArkUI 方法中。静态实现满足页面行为，但当前材料未证明 UT 能在不实例化 UI runtime
        的情况下驱动真实状态机。
      suggestion: |
        后续 UT 阶段先尝试驱动真实入口；若无法覆盖，应回设计/编码责任链补最小的纯业务状态接缝，
        不以 helper 复制逻辑代签真实流程。
    - id: visual_parity_backstop
      status: WARN
      severity: MAJOR
      details: |
        `doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/fidelity-intent.json`
        指定 `acceptance_strictness=best_effort`，因此视觉残差不构成本阶段 BLOCKER。
        `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets:54-59`
        仍渲染 `result_payment_guide_placeholder`；ui-spec verified=unverified，完整像素保真尚无终签。
      suggestion: |
        保留为已披露视觉债务，由后续 delegated visual review/testing 获取设备证据；
        发布前替换真实引导素材并重新验证。
    - id: visual_multimodal_parity
      status: SKIP
      severity: MAJOR
      details: |
        视觉多模态层已降级（adapter 不支持图像）。
      suggestion: |
        由具备图像输入能力的 delegated visual reviewer 在设备捕获阶段逐屏复核。
  summary:
    total: 11
    pass: 7
    fail: 0
    warn: 3
    blockers: 0
    verdict: PASS
```

```issue-verification
- issue: UP-001
  verdict: refuted
  evidence: "问题表原文：旧轮次曾报告 `named_business_handler` 解析异常；当前可读证据 `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/script-report.json:1012` 至 `:1018` 显示该检查已为 PASS，因此本轮不再存在可交接的上游缺陷。涉及文件原登记为 `framework/profiles/hmos-app/harness/named-handler.ts`，修复建议原文为“无需修改；保留历史记录并以当前 harness 结果为准。” 本轮 ai-prompt 脚本报告的 `passed_check_ids` 再次包含 `named_business_handler`，故当前缺陷已不存在，且不应修改 framework。"
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: e663078d42de18e313da4ac1abf29f4f4258fe6de462836591ac53d11039c99b
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
