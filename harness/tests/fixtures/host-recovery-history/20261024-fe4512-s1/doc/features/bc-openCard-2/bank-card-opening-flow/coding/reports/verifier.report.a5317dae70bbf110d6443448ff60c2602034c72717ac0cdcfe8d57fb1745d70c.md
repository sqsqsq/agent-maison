| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/ai-prompt.md:1575-1611`：`coding_compile`、`coding_hvigor_build`、`coding_run_status` 均在 PASS 列表，脚本汇总为 0 FAIL / 0 BLOCKER。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:42-181` 串联候选加载、选卡、OTP、保存和 RESULT 状态；`BankCardSelectionPage.ets:20-71` 生产页面实际消费该协调入口。 |
| error_handling_completeness | PASS | MAJOR | BD-1 至 BD-4 分别由 `BankCardOpeningService.ets:66-67,113-115,161-201`、`OtpService.ets:20-71`、`BankCardRepository.ets:151-169` 和 Sheet 生命周期清理覆盖。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:30-144` 声明的模型和接口与 `BankCardOpeningService.ets:125-181`、`BankCardRepository.ets:151-174`、`OpeningNavigationService.ets:7-15` 等实现签名一致。 |
| component_props_consistency | FAIL | MAJOR | `contracts.yaml:187-199` 声明 `OtpVerificationSheet.candidate @Prop` 和 `resendCode`，实际 `OtpVerificationSheet.ets:7-17,45-51` 无该 Prop、改由未登记的 `openingService` 输入，并将事件命名为 `sendCode`。 |
| data_ownership_compliance | PASS | MAJOR | `BankCardSelectionPage.ets:19-31` 通过 Repository/Service 获取和保存数据；RDB 操作仅存在于 `BankCardRepository.ets:31-134` 的 data 层。 |
| simulation_data_isolation | PASS | MINOR | 银行、卡片 mock 全部封装于 `BankRepository.ets:9-209`，presentation 未读取 `isMock` 或模拟标记。 |
| spec_acceptance_to_code | PASS | MAJOR | AC-1..AC-6 可分别定位到双入口 Sheet、候选掩码、OTP 状态机、RDB 保存、结果页清栈和 Phone 路由集合；例如 `CardTypeSheet.ets:14-35`、`OtpService.ets:20-71`、`OpeningNavigationService.ets:7-15`、`WalletDestinationRegistry.ets:9-21`。 |
| reference_crosscheck | WARN | MAJOR | `coding/upstream-issues.md:7` 引用 `script-report.json:1012-1018` 为 named handler 证据，但实际对应检查在 `script-report.json:1029-1035`；对象仍可定位且为 PASS。 |
| visual_parity_backstop | WARN | MAJOR | `fidelity-intent.json:3-6` 为 `pixel_1to1 + best_effort`；脚本 `visual_parity` PASS，但 `ui-spec.yaml:2` 仍是 `verified: unverified`，结果插画为已登记 placeholder 视觉债务。 |
| visual_multimodal_parity | SKIP | MAJOR | 当前 verifier 无图像输入能力；按提示要求降级，未声称观察过四张参考图。 |

```issue-verification
- issue: UP-001
  verdict: confirmed
  evidence: "责任文件与原问题：framework/profiles/hmos-app/harness/named-handler.ts；问题描述为旧轮次曾报告 named_business_handler 解析异常、当前应已关闭；修复建议原文为“无需修改；保留历史记录并以当前 harness 结果为准。” 当前 doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/script-report.json:1029-1035 确认 named_business_handler=PASS。问题表所写 :1012-1018 行号已漂移，但关闭结论成立。"
```

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T17:17:35.505Z"
  checks:
    - id: component_props_consistency
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:187-199
        把 OtpVerificationSheet 的输入声明为 candidate: BankCardCandidate @Prop，
        并登记 resendCode 事件。实际
        02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets:7-17
        没有 candidate，而是接收未登记的 BankCardOpeningService；重发入口位于 :45-51，
        名称为 sendCode。父页在 BankCardSelectionPage.ets:70-79 传入 openingService。
        当前运行语义可成立，但组件公开输入和事件名称未与机器契约一致。
      suggestion: |
        由组件契约责任方确认本次“共享 openingService”重组后更新 components 契约；
        若契约不得变，则 coding 恢复 candidate @Prop 与 resendCode 命名，并用契约允许的方式
        连接协调服务。不要同时保留两个卡片状态真源。
    - id: reference_crosscheck
      status: WARN
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/coding/upstream-issues.md:7
        把 named_business_handler PASS 定位到 script-report.json:1012-1018；
        该范围实际是 arkui_clip_overlap_risk。正确对象位于
        coding/reports/script-report.json:1029-1035，状态确为 PASS。
        这是定位漂移，不改变结论。
      suggestion: |
        后续维护问题表时把证据位置更新到 script-report.json:1029-1035；
        不需要修改产品代码或 framework。
    - id: visual_parity_backstop
      status: WARN
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/fidelity-intent.json:3-6
        声明 effective_fidelity=pixel_1to1、acceptance_strictness=best_effort；
        ui-spec.yaml:2 仍为 verified: unverified，且 ui-spec.yaml:458、527-551
        明确登记结果引导插画 placeholder/major 视觉债务。脚本 visual_parity 已 PASS，
        因而当前不构成 coding BLOCKER，但不能据此宣称像素保真或发布就绪。
      suggestion: |
        在后续 testing 使用当前构建取得四个目标屏的原生截图和结构化视觉复核；
        保留已登记债务，直到真实插画及布局差异被修复并重验。
    - id: visual_multimodal_parity
      status: SKIP
      severity: MAJOR
      details: |
        视觉多模态层已降级（adapter 不支持图像）。本 verifier 未读取或观察参考图像，
        仅使用 ui-spec、OCR 派生产物和源码进行文本语义核对。
      suggestion: |
        由既定的视觉 reviewer/device-testing 阶段逐屏核对参考图与设备截图。
  summary:
    total: 11
    pass: 7
    fail: 1
    warn: 2
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: a5317dae70bbf110d6443448ff60c2602034c72717ac0cdcfe8d57fb1745d70c
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
